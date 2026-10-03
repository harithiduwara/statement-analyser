import { useCallback, useMemo, useState } from 'react';
import type { Statement } from '@/domain/types';
import { extractTextLayer, PdfPasswordError } from '@/parsing/pdf';
import { assessTextLayer } from '@/parsing/scan';
import { parseDocument } from '@/parsing/parser';
import { reconcile } from '@/analysis/reconcile';
import { explainFailure } from '@/parsing/capabilities';
import type { Reconciliation } from '@/domain/types';
import '@/parsing/seylan';
import '@/parsing/sampath';

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
  | { kind: 'error'; fileName: string; message: string }
  | { kind: 'password'; fileName: string; file: File; wrong: boolean };

export interface Library {
  files: FileState[];
  statements: Statement[];
  addFiles: (files: readonly File[]) => Promise<void>;
  /** Retry a password-protected file once the reader has entered its password. */
  submitPassword: (fileName: string, password: string) => Promise<void>;
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
      setFiles((prev) =>
        replaceFirstParsing(prev, file.name, outcomeToState(prev, file, outcome)),
      );
    }

    setBusy(false);
  }, []);

  /*
   * A locked file is parked in a `password` state holding the File itself.
   * When the reader supplies a password we re-run exactly the same parse with
   * it; a wrong one comes back as `password` again, flagged, for another try.
   * The password is never stored -- it lives only for the length of this call.
   */
  const submitPassword = useCallback(async (fileName: string, password: string) => {
    let file: File | undefined;
    setFiles((prev) => {
      const entry = prev.find(
        (f): f is Extract<FileState, { kind: 'password' }> =>
          f.kind === 'password' && f.fileName === fileName,
      );
      if (!entry) return prev;
      file = entry.file;
      return prev.map((f) =>
        f.kind === 'password' && f.fileName === fileName ? { kind: 'parsing', fileName } : f,
      );
    });
    if (!file) return;

    setBusy(true);
    const target = file;
    const outcome = await parseOne(
      target,
      (progress) => {
        setFiles((prev) =>
          prev.map((f) =>
            f.fileName === fileName && (f.kind === 'parsing' || f.kind === 'ocr')
              ? { kind: 'ocr', fileName, ...progress }
              : f,
          ),
        );
      },
      password,
    );
    setFiles((prev) =>
      replaceFirstParsing(prev, fileName, outcomeToState(prev, target, outcome)),
    );
    setBusy(false);
  }, []);

  const clearAll = useCallback(() => setFiles([]), []);

  return { files, statements, addFiles, submitPassword, clearAll, busy };
}

type ParseOutcome =
  | { kind: 'parsed'; statement: Statement }
  | { kind: 'needs-password'; reason: 'required' | 'incorrect' }
  | { kind: 'failed'; state: FileState };

/** Turn a parse outcome into the file's resting state. */
function outcomeToState(
  library: readonly FileState[],
  file: File,
  outcome: ParseOutcome,
): FileState {
  if (outcome.kind === 'parsed') return resolveAgainstLibrary(library, file.name, outcome.statement);
  if (outcome.kind === 'needs-password') {
    return { kind: 'password', fileName: file.name, file, wrong: outcome.reason === 'incorrect' };
  }
  return outcome.state;
}

async function parseOne(
  file: File,
  onOcrProgress: (progress: {
    page: number;
    pageCount: number;
    progress: number;
    status: string;
  }) => void,
  password?: string,
): Promise<ParseOutcome> {
  const withPassword = password === undefined ? {} : { password };
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const layer = await extractTextLayer(bytes, { fileName: file.name, ...withPassword });
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
        ...withPassword,
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
    // A locked PDF is not a failure -- it is a prompt waiting to happen.
    if (err instanceof PdfPasswordError) {
      return { kind: 'needs-password', reason: err.reason };
    }
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
