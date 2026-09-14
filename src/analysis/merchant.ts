/**
 * Merchant-name normalisation and similarity.
 *
 * Used to pair an origination debit with its reversal credit, and to key the
 * instalment register. Bank descriptions for the same merchant vary between
 * the purchase line and the instalment line -- location suffixes come and go,
 * the schedule marker is appended, the name gets truncated differently -- so
 * an exact match would miss most real pairs while a loose one would merge
 * unrelated merchants. Both failures are expensive: a missed pair overstates
 * charges, a false pair erases a real one.
 */

/** Words that carry no identity and would inflate any similarity score. */
const NOISE = new Set([
  'the', 'ltd', 'pvt', 'plc', 'company', 'co', 'lanka', 'srilanka', 'sri',
  'colombo', 'installment', 'instalment', 'repayment', 'processing', 'fees',
  'fee', 'easy', 'pay', 'easypay', 'sp', 'of', 'and',
]);

/**
 * Reduce a description to its identifying core:
 * `DAMRO - KOTTAWA INSTALLMENT REPAYMENT 1/36` -> `damro kottawa`
 */
export function normaliseMerchant(description: string): string {
  return tokens(description).join(' ');
}

export function tokens(description: string): string[] {
  return description
    .toUpperCase()
    // Drop the schedule marker and everything a plan line appends.
    .replace(/\b\d{1,3}\s*\/\s*\d{1,3}\b/g, ' ')
    .replace(/\bSP\s*\d{1,3}\s*OF\s*\d{1,3}\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .split(' ')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 1 && !NOISE.has(t) && !/^\d+$/.test(t));
}

/**
 * Similarity in [0, 1]: Jaccard over token sets, lifted when one name is a
 * prefix of the other (which is how truncation shows up).
 */
export function merchantSimilarity(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;

  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection += 1;
  const union = ta.size + tb.size - intersection;
  const jaccard = union === 0 ? 0 : intersection / union;

  // A truncated name is a subset of the fuller one, which Jaccard punishes
  // even though the identity is certain. Containment covers that case.
  const containment = intersection / Math.min(ta.size, tb.size);

  return Math.max(jaccard, containment * 0.95);
}

/** Default threshold. Chosen to accept truncation but reject sibling brands. */
export const MERCHANT_MATCH_THRESHOLD = 0.6;

export function merchantsMatch(a: string, b: string, threshold = MERCHANT_MATCH_THRESHOLD): boolean {
  return merchantSimilarity(a, b) >= threshold;
}
