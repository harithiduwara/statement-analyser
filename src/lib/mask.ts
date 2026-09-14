/**
 * Card-number masking.
 *
 * Applied at the point of extraction, before anything reaches application
 * state. A full PAN must never be stored, rendered, persisted or exported --
 * so the parsers call `maskCardNumber` on the raw header match and discard
 * the original string in the same expression.
 */

/**
 * A PAN-shaped run: 13-19 digits, optionally separated by spaces, dashes or
 * `*`. Thirteen is the floor because that is the shortest real card number
 * (Visa); shorter runs are something else, and on a Seylan statement they are
 * the twelve-digit per-transaction auth reference, which must survive intact.
 */
const PAN_RE = /\b(?:\d[\s*x-]?){12,22}\d\b/gi;

/**
 * Reduce a printed card/account number to its last four digits.
 * `40463300****2470` -> `2470`
 * `4046 3300 XXXX 2470` -> `2470`
 * Returns `undefined` when fewer than four digits are present.
 */
export function maskCardNumber(input: string | undefined | null): string | undefined {
  if (!input) return undefined;
  const digits = input.replace(/\D/g, '');
  if (digits.length < 4) return undefined;
  return digits.slice(-4);
}

/** Display form for a mask: `2470` -> `•••• 2470`. */
export function formatMask(mask: string): string {
  return `•••• ${mask}`;
}

/**
 * Defensive scrub for any string that might reach state, a log, or an export.
 * Replaces anything PAN-shaped with its last four digits.
 */
export function scrubPan(text: string): string {
  return text.replace(PAN_RE, (match) => {
    const digits = match.replace(/\D/g, '');
    if (digits.length < 13) return match; // too short to be a PAN; leave alone
    return `****${digits.slice(-4)}`;
  });
}
