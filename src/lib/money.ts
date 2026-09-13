import { MONEY_EPSILON, type Money } from '@/domain/types';

/**
 * Matches an LKR amount as printed on a Sri Lankan statement:
 *   1,234.56      -> 1234.56
 *   1,234.56CR    -> -1234.56
 *   1,234.56 CR   -> -1234.56
 *   (1,234.56)    -> -1234.56
 *   -1,234.56     -> -1234.56
 *   1,234.56-     -> -1234.56   (trailing minus, used by some print drivers)
 *
 * The `CR` suffix is the important one: it is the bank's marker for a credit
 * and is the single most common source of sign errors in statement parsing.
 */
const AMOUNT_RE =
  /^\(?\s*(?<sign>[-+])?\s*(?<digits>\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(?<suffix>CR|DR|-)?\s*\)?$/i;

/** A bare amount token anywhere inside a line, used for scanning. */
export const AMOUNT_TOKEN_RE =
  /\(?\s*[-+]?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\s*(?:CR|DR)?\s*\)?/gi;

export interface ParsedAmount {
  value: Money;
  /** True when the source carried an explicit credit marker. */
  isCredit: boolean;
  raw: string;
}

/**
 * Parse a printed amount into a signed number.
 * Returns `undefined` for anything that is not an amount -- callers must
 * decide what to do rather than silently receiving 0.
 */
export function parseAmount(input: string | undefined | null): ParsedAmount | undefined {
  if (input == null) return undefined;
  const raw = input.trim();
  if (raw === '') return undefined;

  // A parenthesised amount is a credit even without a CR suffix.
  const parenthesised = raw.startsWith('(') && raw.endsWith(')');
  const m = AMOUNT_RE.exec(raw);
  if (!m?.groups) return undefined;

  const digits = m.groups.digits;
  if (digits === undefined) return undefined;

  const magnitude = Number(digits.replace(/,/g, ''));
  if (!Number.isFinite(magnitude)) return undefined;

  const suffix = m.groups.suffix?.toUpperCase();
  const isCredit =
    suffix === 'CR' || suffix === '-' || parenthesised || m.groups.sign === '-';

  return {
    value: isCredit ? -magnitude : magnitude,
    isCredit,
    raw,
  };
}

/** Parse an amount, throwing with context when the field is required. */
export function requireAmount(input: string | undefined | null, field: string): Money {
  const parsed = parseAmount(input);
  if (parsed === undefined) {
    throw new Error(`Could not parse required amount for "${field}": ${JSON.stringify(input)}`);
  }
  return parsed.value;
}

/** True when the token looks like a money amount (used for column detection). */
export function looksLikeAmount(token: string): boolean {
  return parseAmount(token) !== undefined && /\d/.test(token);
}

/** Money equality within the printed precision of a statement. */
export function moneyEquals(a: Money, b: Money, epsilon = MONEY_EPSILON): boolean {
  return Math.abs(a - b) < epsilon;
}

/** Round to the 2dp a statement is printed at, killing float drift. */
export function roundMoney(value: Money): Money {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Sum with rounding applied once at the end, not per addend. */
export function sumMoney(values: readonly Money[]): Money {
  return roundMoney(values.reduce((acc, v) => acc + v, 0));
}

/**
 * Format for display: credits in parentheses, never colour-coded.
 *   1234.5  -> "1,234.50"
 *  -1234.5  -> "(1,234.50)"
 *       0   -> "-"
 */
export function formatMoney(value: Money, opts: { zeroDash?: boolean } = {}): string {
  const { zeroDash = true } = opts;
  if (zeroDash && Math.abs(value) < MONEY_EPSILON) return '-';
  const body = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return value < 0 ? `(${body})` : body;
}

/** Excel number format mirroring `formatMoney`. */
export const EXCEL_MONEY_FORMAT = '#,##0.00;(#,##0.00);-';
