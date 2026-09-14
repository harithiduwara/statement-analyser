import { useCallback, useMemo, useState } from 'react';
import type { Statement } from '@/domain/types';
import { extractTextLayer } from '@/parsing/pdf';
import { assessTextLayer } from '@/parsing/scan';
import { parseDocument } from '@/parsing/parser';
import { reconcile } from '@/analysis/reconcile';
import { explainFailure } from '@/parsing/capabilities';
import type { Reconciliation } from '@/domain/types';
import '@/parsing/seylan';

/**
 * In-memory library of parsed statements.
 *
 * Nothing is persisted yet: statements live for the lifetime of the tab and
 * are gone on reload. Opt-in IndexedDB persistence is a later step, and until
 * it exists "not stored at all" is the safer default rather than a half-done
 * store nobody asked to opt into.
 */

export type FileState =
  | { kind: 'parsing'; fileName: string }
  | {
      kind: 'ocr';
      fileName: string;
      page: number;
      pageCount: number;
      progress: number;
      status: string;
    }
  | { kind: 'ok'; fileName: string; statement: Statement; reconciliation: Reconciliation }
  | { kind: 'duplicate'; fileName: string; existingFileName: string; statementId: string }
  | {
      kind: 'conflict';
      fileName: string;
      existingFileName: string;
      statementId: string;
      detail: string;
    }
  | { kind: 'error'; fileName: string; message: string };

export interface Library {
  files: FileState[];
  statements: Statement[];
  addFiles: (files: readonly File[]) => Promise<void>;
  clearAll: () => void;
  busy: boolean;
}

/**
 * Two statements are the same cycle when issuer, card and statement date
 * agree -- that is `Statement.id`. Re-uploading the same cycle is common
 * (files get renamed, downloaded twice, or exported per-card) and must never
 * silently double every total, so it is refused rather than merged.
 *
 * A same-cycle file whose figures differ is a louder problem than a duplicate:
 * one of the two readings is wrong, or the bank reissued the statement. That
 * is reported separately so it cannot be mistaken for a harmless repeat.
 */
function compareWithExisting(
  incoming: Statement,
  existing: Statement,
): { kind: 'duplicate' } | { kind: 'conflict'; detail: string } {
  const differences: string[] = [];
  if (existing.closingBalance !== incoming.closingBalance) {
    differences.push(
      `closing balance ${existing.closingBalance.toFixed(2)} vs ${incoming.closingBalance.toFixed(2)}`,
    );
  }
  if (existing.openingBalance !== incoming.openingBalance) {
    differences.push(
      `opening balance ${existing.openingBalance.toFixed(2)} vs ${incoming.openingBalance.toFixed(2)}`,
    );
  }
  if (existing.transactions.length !== incoming.transactions.length) {
    differences.push(
      `${existing.transactions.length} vs ${incoming.transactions.length} transactions`,
    );
  }
  return differences.length === 0
    ? { kind: 'duplicate' }
    : { kind: 'conflict', detail: differences.join('; ') };
}

export function useStatementLibrary(): Library {
  const [files, setFiles] = useState<FileState[]>([]);
  const [busy, setBusy] = useState(false);

  const statements = useMemo(
    () => files.flatMap((f) => (f.kind === 'ok' ? [f.statement] : [])),
    [files],
  );

  const addFiles = useCallback(async (incoming: readonly File[]) => {
    if (incoming.length === 0) return;
    setBusy(true);

    // Placeholders first, so a slow parse shows progress per file.
    setFiles((prev) => [
      ...prev,
      ...incoming.map((f): FileState => ({ kind: 'parsing', fileName: f.name })),
    ]);

    for (const file of incoming) {
      const outcome = await parseOne(file, (progress) => {
        setFiles((prev) =>
          prev.map((f) =>
            f.fileName === file.name && (f.kind === 'parsing' || f.kind === 'ocr')
              ? { kind: 'ocr', fileName: file.name, ...progress }
              : f,
          ),
        );
      });

      // Dedupe inside the state update rather than against a snapshot, so two
      // files dropped together cannot both pass the check and both be added.
      setFiles((prev) => {
        const resolved =
          outcome.kind === 'parsed'
            ? resolveAgainstLibrary(prev, file.name, outcome.statement)
            : outcome.state;
        return replaceFirstParsing(prev, file.name, resolved);
      });
    }

    setBusy(false);
  }, []);

  const clearAll = useCallback(() => setFiles([]), []);

  return { files, statements, addFiles, clearAll, busy };
}

type ParseOutcome =
  | { kind: 'parsed'; statement: Statement }
  | { kind: 'failed'; state: FileState };

async function parseOne(
  file: File,
  onOcrProgress: (progress: {
    page: number;
    pageCount: number;
    progress: number;
    status: string;
  }) => void,
): Promise<ParseOutcome> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const layer = await extractTextLayer(bytes, { fileName: file.name });
    const assessment = assessTextLayer(layer);

    /*
     * A statement with no usable text layer is an image. Rather than refusing
     * it, read it with character recognition -- and record that this is what
     * happened, because a figure read off a picture has to earn belief that a
     * figure read from a text layer does not.
     */
    let source: 'text' | 'ocr' = 'text';
    let ocrConfidence: number | undefined;
    let toParse = layer;

    if (assessment.verdict !== 'text') {
      const { ocrDocument } = await import('@/parsing/ocr');
      const ocr = await ocrDocument(bytes, {
        fileName: file.name,
        onProgress: onOcrProgress,
      });
      toParse = ocr.layer;
      source = 'ocr';
      ocrConfidence = ocr.confidence;
    }

    const result = parseDocument(toParse);
    if (!result.ok || !result.statement) {
      return {
        kind: 'failed',
        state: {
          kind: 'error',
          fileName: file.name,
          message:
            source === 'ocr'
              ? `${result.error ?? 'The parser returned no statement.'} This file was a scan, ` +
                `so the text was read by character recognition — a poor scan can leave the layout ` +
                `unrecognisable even when individual words come out.`
              : (result.error ?? 'The parser returned no statement.'),
        },
      };
    }

    return {
      kind: 'parsed',
      statement: {
        ...result.statement,
        source,
        ...(ocrConfidence === undefined ? {} : { ocrConfidence }),
      },
    };
  } catch (err) {
    return {
      kind: 'failed',
      state: {
        kind: 'error',
        fileName: file.name,
        // A raw engine error here is almost always an unsupported browser
        // rather than a bad file, and saying which is the whole difference.
        message: explainFailure(err),
      },
    };
  }
}

/** Accept the statement, or refuse it as a repeat of one already loaded. */
function resolveAgainstLibrary(
  library: readonly FileState[],
  fileName: string,
  statement: Statement,
): FileState {
  const existing = library.find(
    (f): f is Extract<FileState, { kind: 'ok' }> =>
      f.kind === 'ok' && f.statement.id === statement.id,
  );
  if (!existing) {
    return { kind: 'ok', fileName, statement, reconciliation: reconcile(statement) };
  }
  return toDuplicateState(fileName, statement, existing);
}

function toDuplicateState(
  fileName: string,
  statement: Statement,
  existing: Extract<FileState, { kind: 'ok' }>,
): FileState {
  const comparison = compareWithExisting(statement, existing.statement);
  return comparison.kind === 'duplicate'
    ? {
        kind: 'duplicate',
        fileName,
        existingFileName: existing.fileName,
        statementId: statement.id,
      }
    : {
        kind: 'conflict',
        fileName,
        existingFileName: existing.fileName,
        statementId: statement.id,
        detail: comparison.detail,
      };
}

/** Swap the placeholder for this file's real outcome, leaving others alone. */
function replaceFirstParsing(
  list: readonly FileState[],
  fileName: string,
  next: FileState,
): FileState[] {
  const index = list.findIndex((f) => f.kind === 'parsing' && f.fileName === fileName);
  if (index === -1) return [...list, next];
  const copy = [...list];
  copy[index] = next;
  return copy;
}
