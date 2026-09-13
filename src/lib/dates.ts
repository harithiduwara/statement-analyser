import type { IsoDate } from '@/domain/types';

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Pivot for two-digit years. Statements are contemporary documents, so a
 * two-digit year below the pivot is 20xx and at or above it is 19xx.
 * 80 puts the boundary far from any plausible statement date.
 */
const TWO_DIGIT_YEAR_PIVOT = 80;

function expandYear(raw: string): number {
  const n = Number(raw);
  if (raw.length === 4) return n;
  return n < TWO_DIGIT_YEAR_PIVOT ? 2000 + n : 1900 + n;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Build an ISO date, validating that the calendar date actually exists. */
export function toIso(year: number, month: number, day: number): IsoDate | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return undefined; // e.g. 31/02
  }
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * `DD/MM/YY`, `DD/MM/YYYY`, `DD-MM-YYYY`, `DD.MM.YY`.
 * Day-first, because that is the Sri Lankan convention on both issuers.
 */
const NUMERIC_RE = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/;

/** `06 MAR 2026`, `06-Mar-26`, `6 March 2026`. */
const ALPHA_RE = /^(\d{1,2})[\s\-]([A-Za-z]{3,9})[\s\-,]*(\d{2}|\d{4})$/;

/** `MAR 06, 2026` / `March 6 2026`. */
const ALPHA_FIRST_RE = /^([A-Za-z]{3,9})[\s\-]+(\d{1,2})[\s,]+(\d{2}|\d{4})$/;

/**
 * Parse a printed date to ISO. Returns `undefined` rather than a guess.
 *
 * Nothing in this codebase may assume a statement falls on a particular day
 * of the month -- issuers drift the cycle by a day or three. Cycle ordering
 * is always by parsed date, never by an assumed day number.
 */
export function parseDate(input: string | undefined | null): IsoDate | undefined {
  if (!input) return undefined;
  const s = input.trim().replace(/\s+/g, ' ');
  if (s === '') return undefined;

  let m = NUMERIC_RE.exec(s);
  if (m && m[1] && m[2] && m[3]) {
    return toIso(expandYear(m[3]), Number(m[2]), Number(m[1]));
  }

  m = ALPHA_RE.exec(s);
  if (m && m[1] && m[2] && m[3]) {
    const month = MONTHS[m[2].toLowerCase().slice(0, 4)] ?? MONTHS[m[2].toLowerCase().slice(0, 3)];
    if (month) return toIso(expandYear(m[3]), month, Number(m[1]));
  }

  m = ALPHA_FIRST_RE.exec(s);
  if (m && m[1] && m[2] && m[3]) {
    const month = MONTHS[m[1].toLowerCase().slice(0, 4)] ?? MONTHS[m[1].toLowerCase().slice(0, 3)];
    if (month) return toIso(expandYear(m[3]), month, Number(m[2]));
  }

  return undefined;
}

/** Parse a date, throwing with field context when it is required. */
export function requireDate(input: string | undefined | null, field: string): IsoDate {
  const parsed = parseDate(input);
  if (parsed === undefined) {
    throw new Error(`Could not parse required date for "${field}": ${JSON.stringify(input)}`);
  }
  return parsed;
}

/**
 * Resolve a `DD/MM` row that printed no year, by choosing the year that puts
 * the date closest to (but generally at or before) the statement date.
 */
export function resolveYearlessDate(
  day: number,
  month: number,
  statementDate: IsoDate,
): IsoDate | undefined {
  const stYear = Number(statementDate.slice(0, 4));
  const candidates = [stYear - 1, stYear, stYear + 1]
    .map((y) => toIso(y, month, day))
    .filter((d): d is IsoDate => d !== undefined);
  if (candidates.length === 0) return undefined;

  let best = candidates[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const distance = Math.abs(daysBetween(c, statementDate));
    if (distance < bestDistance) {
      best = c;
      bestDistance = distance;
    }
  }
  return best;
}

/** Whole days from `a` to `b`; negative when `b` precedes `a`. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** `YYYY-MM` bucket key for monthly aggregation. */
export function monthKey(date: IsoDate): string {
  return date.slice(0, 7);
}

/** Add whole months to a `YYYY-MM` key. */
export function addMonths(key: string, delta: number): string {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const total = year * 12 + (month - 1) + delta;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/** `2026-03` -> `Mar 2026`. */
export function formatMonthKey(key: string): string {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = Number(key.slice(5, 7));
  return `${names[month - 1] ?? '???'} ${key.slice(0, 4)}`;
}

/** `2026-03-15` -> `15 Mar 2026`. */
export function formatDate(date: IsoDate): string {
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = Number(date.slice(5, 7));
  return `${date.slice(8, 10)} ${names[month - 1] ?? '???'} ${date.slice(0, 4)}`;
}
