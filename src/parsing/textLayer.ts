/**
 * Positional text model.
 *
 * Statement columns are established by x-position, not by whitespace in a
 * flattened string. A naive `textContent.items.map(i => i.str).join(' ')`
 * loses the column structure entirely and merges the description column into
 * the amount column -- which is exactly how sign and alignment bugs get in.
 *
 * Parsers therefore run against `Line`s built from positioned items, and the
 * pdf.js dependency lives behind this boundary so tests can feed a recorded
 * layer without a PDF at all.
 */

export interface TextItem {
  text: string;
  /** Left edge, in PDF user units, origin bottom-left. */
  x: number;
  /** Baseline y, in PDF user units, origin bottom-left. */
  y: number;
  width: number;
  height: number;
  fontName?: string;
}

export interface PageLayer {
  pageNumber: number;
  width: number;
  height: number;
  items: TextItem[];
  /**
   * How the items were obtained. OCR boxes are far noisier vertically than
   * PDF text positions, so rows are grouped differently -- see `buildLines`.
   */
  source?: 'text' | 'ocr';
}

export interface DocumentLayer {
  fileName: string;
  pages: PageLayer[];
}

export interface Line {
  pageNumber: number;
  /** Representative baseline y for the row. */
  y: number;
  items: TextItem[];
  /**
   * Items joined with gap-aware spacing: a horizontal gap wider than roughly
   * one space becomes visible whitespace, so column boundaries survive into
   * the string form and regexes can rely on them.
   */
  text: string;
}

/** Items whose baselines differ by less than this are on the same row. */
const DEFAULT_Y_TOLERANCE = 2.2;

/** A gap wider than this many multiples of the glyph height becomes a space. */
const SPACE_GAP_RATIO = 0.22;

/** Drop items that are pure whitespace or zero-width artefacts. */
function isMeaningful(item: TextItem): boolean {
  return item.text.trim().length > 0;
}

/**
 * Group a page's items into rows, then order each row left to right.
 *
 * Two strategies, because the two sources of items behave differently.
 *
 * A PDF places every glyph on an exact baseline, so items on a row share a y
 * to within a rounding error and proximity grouping is both correct and
 * cheap. OCR reports a box drawn around the ink it found, whose bottom edge
 * moves with whatever the word happens to contain -- a descender, a comma, a
 * stray speck -- so on a single printed row the boxes can differ by several
 * points. Grouping those by baseline proximity tears rows apart: the amount
 * ends up on a line of its own, separated from the description it belongs to,
 * and the row silently stops being a transaction.
 *
 * So OCR rows are grouped by vertical overlap instead: two boxes belong to
 * the same row when they overlap by more than half the shorter one's height,
 * which is true of words printed side by side and false of words printed on
 * consecutive lines, regardless of what letters they contain.
 */
export function buildLines(page: PageLayer, yTolerance = DEFAULT_Y_TOLERANCE): Line[] {
  const items = page.items.filter(isMeaningful);
  if (items.length === 0) return [];

  const rows =
    page.source === 'ocr' ? groupByOverlap(items) : groupByBaseline(items, yTolerance);

  return rows.map((row) => {
    const ordered = [...row].sort((a, b) => a.x - b.x);
    return {
      pageNumber: page.pageNumber,
      y: ordered.reduce((acc, i) => acc + i.y, 0) / ordered.length,
      items: ordered,
      text: joinItems(ordered),
    };
  });
}

function groupByBaseline(items: readonly TextItem[], yTolerance: number): TextItem[][] {
  // Top-down: PDF y grows upward, statements read downward.
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);

  const rows: TextItem[][] = [];
  let current: TextItem[] = [];
  let currentY = Number.NaN;

  for (const item of sorted) {
    const tolerance = Math.max(yTolerance, item.height * 0.4);
    if (current.length === 0 || Math.abs(item.y - currentY) <= tolerance) {
      if (current.length === 0) currentY = item.y;
      current.push(item);
    } else {
      rows.push(current);
      current = [item];
      currentY = item.y;
    }
  }
  if (current.length > 0) rows.push(current);
  return rows;
}

/** Fraction of the shorter box that must overlap for two words to share a row. */
const OVERLAP_RATIO = 0.5;

function groupByOverlap(items: readonly TextItem[]): TextItem[][] {
  const sorted = [...items].sort((a, b) => b.y + b.height - (a.y + a.height) || a.x - b.x);

  const rows: TextItem[][] = [];
  let current: TextItem[] = [];
  // The row's extent grows as words join it, so a tall word and a short one
  // on the same printed line still meet.
  let top = 0;
  let bottom = 0;

  for (const item of sorted) {
    const itemTop = item.y + item.height;
    const itemBottom = item.y;

    if (current.length === 0) {
      current = [item];
      top = itemTop;
      bottom = itemBottom;
      continue;
    }

    const overlap = Math.min(top, itemTop) - Math.max(bottom, itemBottom);
    const shorter = Math.min(top - bottom, item.height);
    if (shorter > 0 && overlap >= shorter * OVERLAP_RATIO) {
      current.push(item);
      top = Math.max(top, itemTop);
      bottom = Math.min(bottom, itemBottom);
    } else {
      rows.push(current);
      current = [item];
      top = itemTop;
      bottom = itemBottom;
    }
  }
  if (current.length > 0) rows.push(current);
  return rows;
}

/** Join a row's items, materialising horizontal gaps as spaces. */
export function joinItems(items: readonly TextItem[]): string {
  let out = '';
  let prevEnd: number | undefined;
  let prevHeight = 10;

  for (const item of items) {
    const text = item.text;
    if (out === '') {
      out = text;
    } else {
      const gap = item.x - (prevEnd ?? item.x);
      const threshold = Math.max(prevHeight, item.height) * SPACE_GAP_RATIO;
      const endsWithSpace = /\s$/.test(out);
      const startsWithSpace = /^\s/.test(text);
      if (gap > threshold && !endsWithSpace && !startsWithSpace) {
        out += gap > threshold * 4 ? '  ' : ' ';
      }
      out += text;
    }
    prevEnd = item.x + item.width;
    prevHeight = item.height;
  }
  return out.replace(/[ \t]+$/g, '');
}

/** All lines across a document, in reading order. */
export function allLines(doc: DocumentLayer, yTolerance?: number): Line[] {
  return doc.pages.flatMap((p) => buildLines(p, yTolerance));
}

/** Flattened text of the whole document -- for issuer detection only. */
export function documentText(doc: DocumentLayer): string {
  return doc.pages
    .map((p) => buildLines(p).map((l) => l.text).join('\n'))
    .join('\n');
}

/** Items on a line whose horizontal span overlaps `[from, to)`. */
export function itemsInXRange(line: Line, from: number, to: number): TextItem[] {
  return line.items.filter((i) => i.x + i.width > from && i.x < to);
}

/** Text of a line restricted to an x band, e.g. one column of a grid. */
export function textInXRange(line: Line, from: number, to: number): string {
  return joinItems(itemsInXRange(line, from, to)).trim();
}

/** First line matching a pattern, searching in reading order. */
export function findLine(lines: readonly Line[], pattern: RegExp): Line | undefined {
  return lines.find((l) => pattern.test(l.text));
}

/** All lines matching a pattern. */
export function findLines(lines: readonly Line[], pattern: RegExp): Line[] {
  return lines.filter((l) => pattern.test(l.text));
}

/**
 * Find a label on a line and return the text to its right.
 *
 * Statement header grids print `Label   Value` with the value at an arbitrary
 * x. Anchoring on the label item's right edge rather than on string offsets
 * keeps this correct when the label itself is split across several items
 * (which pdf.js does routinely, e.g. `Cre` + `dit Limit`).
 */
export function valueRightOfLabel(line: Line, label: RegExp): string | undefined {
  const matchEnd = labelEndX(line, label);
  if (matchEnd === undefined) return undefined;
  const right = line.items.filter((i) => i.x >= matchEnd - 0.5);
  if (right.length === 0) return undefined;
  return joinItems(right).trim();
}

/** Right edge x of the last item that participates in the label match. */
export function labelEndX(line: Line, label: RegExp): number | undefined {
  if (!label.test(line.text)) return undefined;

  // Walk items left to right, accumulating text, until the accumulated
  // prefix contains the label. The item that completes it gives the x.
  let acc = '';
  let prevEnd: number | undefined;
  let prevHeight = 10;
  for (const item of line.items) {
    if (acc !== '') {
      const gap = item.x - (prevEnd ?? item.x);
      if (gap > Math.max(prevHeight, item.height) * SPACE_GAP_RATIO) acc += ' ';
    }
    acc += item.text;
    prevEnd = item.x + item.width;
    prevHeight = item.height;
    if (label.test(acc)) return item.x + item.width;
  }
  return undefined;
}

/**
 * Cluster the x positions of a set of lines into column boundaries.
 * Used to discover the amount column on statements whose layout shifts.
 */
export function inferColumnEdges(lines: readonly Line[], gapThreshold = 6): number[] {
  const xs = lines.flatMap((l) => l.items.map((i) => i.x)).sort((a, b) => a - b);
  const edges: number[] = [];
  let prev: number | undefined;
  for (const x of xs) {
    if (prev === undefined || x - prev > gapThreshold) edges.push(x);
    prev = x;
  }
  return edges;
}

/** Right edge of the rightmost item on a line. */
export function lineRightEdge(line: Line): number {
  return line.items.reduce((max, i) => Math.max(max, i.x + i.width), 0);
}
