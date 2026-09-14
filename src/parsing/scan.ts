import type { DocumentLayer } from './textLayer';

/**
 * Deciding whether a PDF needs OCR.
 *
 * A statement exported by a bank carries a real text layer -- thousands of
 * characters per page. A scanned or photographed one carries an image and
 * little or nothing else. Some carry a thin layer: a page number stamped by a
 * scanner, or a watermark, with the statement itself still a picture. All
 * three cases are separated by the same measure, the amount of text actually
 * present on the densest page.
 */

/**
 * Characters on the densest page, below which a document is treated as
 * imaged. A real statement page runs to several thousand; a scanner's page
 * stamp is a handful. Nothing legitimate sits between.
 */
const MIN_CHARS_ON_DENSEST_PAGE = 200;

export type TextLayerVerdict = 'text' | 'imaged' | 'empty';

export interface TextLayerAssessment {
  verdict: TextLayerVerdict;
  /** Characters found on the page that has the most. */
  charsOnDensestPage: number;
  totalChars: number;
  pageCount: number;
  pagesWithNoText: number;
  /** Plain-language reason, shown to the reader when OCR is offered. */
  reason: string;
}

export function assessTextLayer(doc: DocumentLayer): TextLayerAssessment {
  const perPage = doc.pages.map((page) =>
    page.items.reduce((total, item) => total + item.text.trim().length, 0),
  );
  const charsOnDensestPage = perPage.reduce((max, n) => Math.max(max, n), 0);
  const totalChars = perPage.reduce((sum, n) => sum + n, 0);
  const pagesWithNoText = perPage.filter((n) => n === 0).length;
  const pageCount = doc.pages.length;

  if (pageCount === 0) {
    return {
      verdict: 'empty',
      charsOnDensestPage: 0,
      totalChars: 0,
      pageCount: 0,
      pagesWithNoText: 0,
      reason: 'This PDF has no pages.',
    };
  }

  if (charsOnDensestPage >= MIN_CHARS_ON_DENSEST_PAGE) {
    return {
      verdict: 'text',
      charsOnDensestPage,
      totalChars,
      pageCount,
      pagesWithNoText,
      reason: `Readable text layer: ${totalChars} characters across ${pageCount} page(s).`,
    };
  }

  return {
    verdict: totalChars === 0 ? 'empty' : 'imaged',
    charsOnDensestPage,
    totalChars,
    pageCount,
    pagesWithNoText,
    reason:
      totalChars === 0
        ? `No text at all across ${pageCount} page(s) — the statement is an image, so it has to be read by OCR.`
        : `Only ${totalChars} characters across ${pageCount} page(s), too little to be the statement — ` +
          `the figures are an image, so they have to be read by OCR.`,
  };
}

/** True when the document needs OCR before it can be parsed. */
export function needsOcr(doc: DocumentLayer): boolean {
  return assessTextLayer(doc).verdict !== 'text';
}
