import { joinItems, type Line, type TextItem } from './textLayer';

/**
 * Reader for the label/value grids that both issuers print above the
 * transaction list.
 *
 * The grid is a set of labels on one row with their values on the row beneath,
 * aligned by column. Reading it from flattened page text pairs values with the
 * wrong labels the moment a label wraps or a column is blank, so this works
 * from item positions instead.
 *
 * Two shapes are supported, tried in order:
 *   1. `Label   Value` on the same line.
 *   2. A label row followed by a value row, paired by column.
 */

export interface GridField {
  /** Stable key the parser asks for. */
  key: string;
  /** Pattern identifying the label, matched against joined line text. */
  label: RegExp;
}

export interface GridHit {
  key: string;
  value: string;
  /** How the value was found, for the parse report. */
  via: 'same-line' | 'column' | 'nearest-column';
  line: Line;
}

/** Horizontal gap, relative to glyph height, that separates two value tokens. */
const TOKEN_GAP_RATIO = 1.1;

/** Group a row's items into tokens, splitting on wide horizontal gaps. */
export function tokenise(line: Line): { text: string; x: number; right: number }[] {
  const tokens: { items: TextItem[] }[] = [];
  let current: TextItem[] = [];
  let prevEnd: number | undefined;
  let prevHeight = 10;

  for (const item of line.items) {
    const gap = prevEnd === undefined ? 0 : item.x - prevEnd;
    const threshold = Math.max(prevHeight, item.height) * TOKEN_GAP_RATIO;
    if (current.length > 0 && gap > threshold) {
      tokens.push({ items: current });
      current = [];
    }
    current.push(item);
    prevEnd = item.x + item.width;
    prevHeight = item.height;
  }
  if (current.length > 0) tokens.push({ items: current });

  return tokens.map(({ items }) => ({
    text: joinItems(items).trim(),
    x: items[0]!.x,
    right: items.reduce((max, i) => Math.max(max, i.x + i.width), 0),
  }));
}

function centre(token: { x: number; right: number }): number {
  return (token.x + token.right) / 2;
}

/**
 * Locate a label's horizontal span on a line, tolerating a label that pdf.js
 * split across several items.
 */
function labelSpan(line: Line, label: RegExp): { x: number; right: number } | undefined {
  if (!label.test(line.text)) return undefined;

  const tokens = tokenise(line);
  // A label is usually one token, but pdf.js does split labels, so windows of
  // adjacent tokens are tried too. Shortest window first, and only then left
  // to right: on a row carrying both `Min. Payment Due` and `Payment Due
  // Date`, a longest-first search would match the second label across the
  // span of the first and hand back a column three times too wide.
  for (let length = 1; length <= tokens.length; length += 1) {
    for (let start = 0; start + length <= tokens.length; start += 1) {
      const window = tokens.slice(start, start + length);
      const text = window.map((t) => t.text).join(' ');
      if (label.test(text)) {
        return { x: window[0]!.x, right: window[window.length - 1]!.right };
      }
    }
  }
  return undefined;
}

/**
 * Read a grid.
 *
 * `lines` should be the candidate region (typically the first page above the
 * transaction list). Every field is looked for independently, so a statement
 * that omits a field yields no hit for it rather than a shifted set of values.
 */
export function readGrid(lines: readonly Line[], fields: readonly GridField[]): Map<string, GridHit> {
  const out = new Map<string, GridHit>();

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const present = fields.filter((f) => f.label.test(line.text));
    if (present.length === 0) continue;

    // Shape 1: `Label  Value` on this line. Accept only when the text to the
    // right of the label is not itself another label on the same row.
    if (present.length === 1) {
      const field = present[0]!;
      if (!out.has(field.key)) {
        const span = labelSpan(line, field.label);
        if (span) {
          const rightTokens = tokenise(line).filter((t) => t.x >= span.right - 0.5);
          const value = rightTokens.map((t) => t.text).join(' ').trim();
          if (value !== '') {
            out.set(field.key, { key: field.key, value, via: 'same-line', line });
            continue;
          }
        }
      }
    }

    // Shape 2: labels here, values on the next row that carries any content.
    const valueLine = nextContentLine(lines, i);
    if (!valueLine) continue;

    const labelSpans = present
      .map((field) => ({ field, span: labelSpan(line, field.label) }))
      .filter((e): e is { field: GridField; span: { x: number; right: number } } => e.span !== undefined)
      .sort((a, b) => a.span.x - b.span.x);
    if (labelSpans.length === 0) continue;

    const valueTokens = tokenise(valueLine);
    if (valueTokens.length === 0) continue;

    // When the row is complete, order alone pairs them -- both rows read
    // left to right. Otherwise fall back to nearest column centre, which
    // handles a blank cell without shifting every later value by one.
    const allLabelsOnRow = fields.filter((f) => f.label.test(line.text)).length;
    const positional =
      labelSpans.length === valueTokens.length && labelSpans.length === allLabelsOnRow;

    labelSpans.forEach((entry, index) => {
      if (out.has(entry.field.key)) return;
      const token = positional
        ? valueTokens[index]
        : nearestToken(valueTokens, centre(entry.span));
      if (!token || token.text === '') return;
      out.set(entry.field.key, {
        key: entry.field.key,
        value: token.text,
        via: positional ? 'column' : 'nearest-column',
        line: valueLine,
      });
    });
  }

  return out;
}

function nextContentLine(lines: readonly Line[], index: number): Line | undefined {
  for (let i = index + 1; i < lines.length && i <= index + 3; i += 1) {
    const candidate = lines[i]!;
    if (candidate.text.trim() !== '') return candidate;
  }
  return undefined;
}

function nearestToken<T extends { x: number; right: number }>(
  tokens: readonly T[],
  target: number,
): T | undefined {
  let best: T | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const token of tokens) {
    const distance = Math.abs(centre(token) - target);
    if (distance < bestDistance) {
      best = token;
      bestDistance = distance;
    }
  }
  return best;
}
