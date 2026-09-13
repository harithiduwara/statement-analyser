import { textWidth } from './helveticaWidths';

/**
 * Minimal PDF writer for test fixtures.
 *
 * Fixtures are generated from a declarative layout rather than checked in as
 * binaries, so no real statement ever lands in the repository and every
 * fixture's content is reviewable as source. The output is a genuine PDF with
 * a real text layer, so tests run the same pdf.js path the browser does.
 */

export interface PlacedText {
  /** Left edge (or right edge when `align` is `right`), in points. */
  x: number;
  /** Baseline, in points, measured from the bottom of the page. */
  y: number;
  text: string;
  size?: number;
  bold?: boolean;
  align?: 'left' | 'right';
}

export interface PageSpec {
  width?: number;
  height?: number;
  items: PlacedText[];
}

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function contentStream(page: PageSpec): string {
  const parts: string[] = [];
  for (const item of page.items) {
    const size = item.size ?? 8;
    const font = item.bold ? '/F2' : '/F1';
    const width = textWidth(item.text, size, item.bold ?? false);
    const x = item.align === 'right' ? item.x - width : item.x;
    parts.push(
      `BT ${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${item.y.toFixed(2)} Tm (${escapeText(item.text)}) Tj ET`,
    );
  }
  return parts.join('\n');
}

/** Build a PDF byte buffer from page specs. */
export function makePdf(pages: PageSpec[]): Uint8Array {
  const chunks: string[] = [];
  const offsets: number[] = [];
  let position = 0;

  const push = (s: string): void => {
    chunks.push(s);
    position += Buffer.byteLength(s, 'latin1');
  };

  const startObject = (): void => {
    offsets.push(position);
  };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  const pageCount = pages.length;
  // Object numbering: 1 catalog, 2 pages, then per page [page, contents],
  // then 2 font objects at the end.
  const pageObjNum = (i: number): number => 3 + i * 2;
  const contentObjNum = (i: number): number => 4 + i * 2;
  const fontRegularNum = 3 + pageCount * 2;
  const fontBoldNum = fontRegularNum + 1;

  startObject();
  push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);

  startObject();
  const kids = pages.map((_, i) => `${pageObjNum(i)} 0 R`).join(' ');
  push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>\nendobj\n`);

  pages.forEach((page, i) => {
    const w = page.width ?? A4_WIDTH;
    const h = page.height ?? A4_HEIGHT;
    startObject();
    push(
      `${pageObjNum(i)} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w.toFixed(2)} ${h.toFixed(2)}] ` +
        `/Resources << /Font << /F1 ${fontRegularNum} 0 R /F2 ${fontBoldNum} 0 R >> >> ` +
        `/Contents ${contentObjNum(i)} 0 R >>\nendobj\n`,
    );

    const stream = contentStream(page);
    startObject();
    push(
      `${contentObjNum(i)} 0 obj\n<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream\nendobj\n`,
    );
  });

  startObject();
  push(`${fontRegularNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`);
  startObject();
  push(`${fontBoldNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`);

  const xrefStart = position;
  const objectCount = offsets.length + 1; // +1 for the free object 0
  let xref = `xref\n0 ${objectCount}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${objectCount} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

  return new Uint8Array(Buffer.from(chunks.join(''), 'latin1'));
}

/** Convenience builder that tracks a cursor down the page. */
export class PageBuilder {
  private readonly items: PlacedText[] = [];
  y: number;

  constructor(
    readonly width = A4_WIDTH,
    readonly height = A4_HEIGHT,
    startY?: number,
  ) {
    this.y = startY ?? height - 48;
  }

  at(x: number, text: string, opts: Omit<PlacedText, 'x' | 'y' | 'text'> = {}): this {
    this.items.push({ x, y: this.y, text, ...opts });
    return this;
  }

  rightAt(x: number, text: string, opts: Omit<PlacedText, 'x' | 'y' | 'text' | 'align'> = {}): this {
    this.items.push({ x, y: this.y, text, align: 'right', ...opts });
    return this;
  }

  down(points = 12): this {
    this.y -= points;
    return this;
  }

  build(): PageSpec {
    return { width: this.width, height: this.height, items: this.items };
  }
}
