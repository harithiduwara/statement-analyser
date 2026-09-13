/**
 * Standard-14 Helvetica advance widths, in 1/1000 em.
 * Only needed so fixture PDFs can right-align their amount columns the way a
 * real statement does -- column alignment is what the parser keys off, so a
 * fixture with left-aligned amounts would not exercise the real code path.
 */
const REGULAR: Record<string, number> = {
  ' ': 278, '!': 278, '"': 355, '#': 556, $: 556, '%': 889, '&': 667, "'": 191,
  '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333, '.': 278, '/': 278,
  ':': 278, ';': 278, '<': 584, '=': 584, '>': 584, '?': 556, '@': 1015,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278,
  J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  '[': 278, '\\': 278, ']': 278, '^': 469, _: 556, '`': 333,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222,
  j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333,
  s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  '{': 334, '|': 260, '}': 334, '~': 584,
};

const BOLD: Record<string, number> = {
  ...REGULAR,
  ':': 333, ';': 333, '!': 333, '?': 611, '@': 975, '&': 722,
  A: 722, B: 722, E: 667, I: 278, J: 556, K: 722, L: 611, R: 722,
  a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278,
  j: 278, k: 556, l: 278, m: 889, n: 611, o: 611, p: 611, q: 611, r: 389,
  s: 556, t: 333, u: 611, v: 556, w: 778, x: 556, y: 556, z: 500,
};

for (const d of '0123456789') {
  REGULAR[d] = 556;
  BOLD[d] = 556;
}

/** Advance width of `text` at `size` points. */
export function textWidth(text: string, size: number, bold = false): number {
  const table = bold ? BOLD : REGULAR;
  let total = 0;
  for (const ch of text) total += table[ch] ?? 556;
  return (total / 1000) * size;
}
