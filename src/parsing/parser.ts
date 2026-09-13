import type { Issuer, ParseWarning, Statement } from '@/domain/types';
import type { DocumentLayer } from './textLayer';

/** Outcome of running one parser over one document. */
export interface ParseResult {
  ok: boolean;
  issuer?: Issuer;
  statement?: Statement;
  warnings: ParseWarning[];
  /** Set when parsing could not produce a statement at all. */
  error?: string;
  sourceFileName: string;
}

/**
 * One adapter per issuer. Adding a third bank is a new file implementing this
 * interface plus one `registerParser` call -- nothing else in the codebase
 * changes.
 */
export interface StatementParser {
  readonly issuer: Issuer;
  readonly label: string;
  /**
   * Confidence in [0, 1] that this parser handles the document, judged from
   * page text before any parsing is attempted. Above `DETECT_THRESHOLD` the
   * document is handed to `parse`.
   */
  detect(doc: DocumentLayer): number;
  parse(doc: DocumentLayer): ParseResult;
}

export const DETECT_THRESHOLD = 0.5;

const registry = new Map<Issuer, StatementParser>();

export function registerParser(parser: StatementParser): void {
  registry.set(parser.issuer, parser);
}

export function registeredParsers(): StatementParser[] {
  return [...registry.values()];
}

export interface Detection {
  parser: StatementParser;
  confidence: number;
}

/** Rank every registered parser against a document, best first. */
export function detectAll(doc: DocumentLayer): Detection[] {
  return registeredParsers()
    .map((parser) => ({ parser, confidence: parser.detect(doc) }))
    .sort((a, b) => b.confidence - a.confidence);
}

/** The best-matching parser, or `undefined` when nothing is confident enough. */
export function detectParser(doc: DocumentLayer): Detection | undefined {
  const best = detectAll(doc)[0];
  return best && best.confidence >= DETECT_THRESHOLD ? best : undefined;
}

/** Detect the issuer and parse, returning a failed result rather than throwing. */
export function parseDocument(doc: DocumentLayer): ParseResult {
  const detection = detectParser(doc);
  if (!detection) {
    const ranked = detectAll(doc)
      .map((d) => `${d.parser.label} ${(d.confidence * 100).toFixed(0)}%`)
      .join(', ');
    return {
      ok: false,
      warnings: [],
      error:
        `Could not identify the issuer of this statement.` +
        (ranked ? ` Best guesses: ${ranked}.` : ''),
      sourceFileName: doc.fileName,
    };
  }

  try {
    return detection.parser.parse(doc);
  } catch (err) {
    return {
      ok: false,
      issuer: detection.parser.issuer,
      warnings: [],
      error: err instanceof Error ? err.message : String(err),
      sourceFileName: doc.fileName,
    };
  }
}
