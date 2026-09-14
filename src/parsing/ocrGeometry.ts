import type { PageLayer, TextItem } from './textLayer';

/**
 * Converting OCR words into positioned text items.
 *
 * Kept separate from the OCR engine so the part most likely to be wrong --
 * the coordinate transform -- can be tested without running Tesseract.
 *
 * Two coordinate systems meet here. OCR reports pixel boxes on a rendered
 * bitmap with the origin at the TOP-left and y growing downward. The rest of
 * this codebase works in PDF user space: origin at the BOTTOM-left, y growing
 * upward, 72 units to the inch. Getting the flip wrong does not throw -- it
 * silently turns the statement upside down, so every row groups with the
 * wrong neighbours and the columns still look plausible.
 */

export interface OcrWord {
  text: string;
  /** Pixel box on the rendered page: x0,y0 top-left, x1,y1 bottom-right. */
  bbox: { x0: number; y0: number; x1: number; y1: number };
  /** Tesseract's own confidence, 0-100. */
  confidence: number;
}

export interface OcrPageInput {
  pageNumber: number;
  words: readonly OcrWord[];
  /** Rendered bitmap size, in pixels. */
  bitmapWidth: number;
  bitmapHeight: number;
  /** Pixels per PDF unit the page was rendered at. */
  scale: number;
}

/**
 * Words below this confidence are dropped. Tesseract emits low-confidence
 * noise from rules, logos and scan speckle; letting it through would put
 * phantom tokens into the amount column, where a phantom is worse than a gap.
 */
export const MIN_WORD_CONFIDENCE = 40;

/**
 * Words containing a digit are kept down to this lower floor.
 *
 * Tesseract is least sure about exactly the tokens that matter most here --
 * a masked reference like `****1236`, or a figure crowded against a rule --
 * and a dropped figure is invisible, whereas a misread one is caught by
 * `opening + charges - payments = closing` and by the per-card subtotals.
 * Given a choice between the two failure modes, take the one the arithmetic
 * can see.
 */
export const MIN_DIGIT_WORD_CONFIDENCE = 20;

function floorFor(text: string): number {
  return /\d/.test(text) ? MIN_DIGIT_WORD_CONFIDENCE : MIN_WORD_CONFIDENCE;
}

export function ocrPageToLayer(input: OcrPageInput): PageLayer {
  const { bitmapHeight, scale } = input;
  const items: TextItem[] = [];

  for (const word of input.words) {
    const text = word.text.trim();
    if (text === '') continue;
    if (word.confidence < floorFor(text)) continue;

    const left = word.bbox.x0 / scale;
    const right = word.bbox.x1 / scale;
    const heightPx = word.bbox.y1 - word.bbox.y0;

    items.push({
      text,
      x: left,
      // Flip to PDF space, and take the box's BOTTOM edge: that is where a
      // glyph's baseline sits, which is what row grouping keys on.
      y: (bitmapHeight - word.bbox.y1) / scale,
      width: Math.max(0, right - left),
      height: Math.max(1, heightPx / scale),
      fontName: 'ocr',
    });
  }

  return {
    pageNumber: input.pageNumber,
    width: input.bitmapWidth / scale,
    height: bitmapHeight / scale,
    items,
    source: 'ocr',
  };
}

/** Mean confidence over the words that survived the floor, 0-100. */
export function meanConfidence(pages: readonly OcrPageInput[]): number {
  const kept = pages.flatMap((p) =>
    p.words.filter((w) => w.text.trim() !== '' && w.confidence >= floorFor(w.text.trim())),
  );
  if (kept.length === 0) return 0;
  return kept.reduce((sum, w) => sum + w.confidence, 0) / kept.length;
}
