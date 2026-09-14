import { describe, expect, it } from 'vitest';
import { assessTextLayer, needsOcr } from '@/parsing/scan';
import {
  meanConfidence,
  ocrPageToLayer,
  MIN_DIGIT_WORD_CONFIDENCE,
  MIN_WORD_CONFIDENCE,
  type OcrWord,
} from '@/parsing/ocrGeometry';
import { readFileSync } from 'node:fs';
import { buildLines } from '@/parsing/textLayer';
import type { DocumentLayer } from '@/parsing/textLayer';
import { statement, txn } from './helpers/build';
import { buildPortfolio } from '@/analysis/portfolio';

function layer(pages: { text: string }[][]): DocumentLayer {
  return {
    fileName: 'x.pdf',
    pages: pages.map((items, i) => ({
      pageNumber: i + 1,
      width: 595,
      height: 842,
      items: items.map((item, j) => ({
        text: item.text,
        x: 40,
        y: 800 - j * 12,
        width: item.text.length * 4,
        height: 8,
      })),
    })),
  };
}

describe('deciding whether a PDF needs OCR', () => {
  it('accepts a real text layer', () => {
    const dense = layer([[{ text: 'x'.repeat(3_000) }]]);
    const a = assessTextLayer(dense);
    expect(a.verdict).toBe('text');
    expect(needsOcr(dense)).toBe(false);
  });

  it('calls a page with no text at all an image', () => {
    const a = assessTextLayer(layer([[]]));
    expect(a.verdict).toBe('empty');
    expect(a.reason).toMatch(/image/i);
  });

  it('sees through a thin text layer stamped on a scan', () => {
    // A scanner adds a page number; the statement itself is still a picture.
    const a = assessTextLayer(layer([[{ text: 'Page 1 of 2' }], [{ text: 'Page 2 of 2' }]]));
    expect(a.verdict).toBe('imaged');
    expect(a.totalChars).toBeLessThan(30);
    expect(a.reason).toMatch(/OCR/);
  });

  it('does not send a whole document to OCR for one sparse page', () => {
    // Page two of a statement is often nearly empty. Page one is not.
    const a = assessTextLayer(layer([[{ text: 'y'.repeat(2_500) }], [{ text: 'Page 2 of 2' }]]));
    expect(a.verdict).toBe('text');
    expect(a.pagesWithNoText).toBe(0);
  });
});

describe('OCR words to positioned text', () => {
  const word = (text: string, x0: number, y0: number, x1: number, y1: number, confidence = 90): OcrWord =>
    ({ text, bbox: { x0, y0, x1, y1 }, confidence });

  it('flips the vertical axis from bitmap space to PDF space', () => {
    // OCR counts y downward from the top; everything downstream counts it
    // upward from the bottom. Getting this wrong turns the page over without
    // throwing, and the columns still look plausible.
    const page = ocrPageToLayer({
      pageNumber: 1,
      bitmapWidth: 2480,
      bitmapHeight: 3508,
      scale: 4,
      words: [word('TOP', 100, 40, 200, 80), word('BOTTOM', 100, 3400, 200, 3440)],
    });

    const top = page.items.find((i) => i.text === 'TOP')!;
    const bottom = page.items.find((i) => i.text === 'BOTTOM')!;
    expect(top.y).toBeGreaterThan(bottom.y);
    expect(page.width).toBe(620);
    expect(page.height).toBe(877);
    expect(top.x).toBe(25);
    expect(top.width).toBe(25);
  });

  it('puts words back into rows and columns the parser can read', () => {
    const page = ocrPageToLayer({
      pageNumber: 1,
      bitmapWidth: 2480,
      bitmapHeight: 3508,
      scale: 4,
      words: [
        word('10/08', 160, 1000, 300, 1032),
        word('09/08', 340, 1000, 480, 1032),
        word('CEFT', 740, 1000, 860, 1032),
        word('PAYMENT', 880, 1000, 1100, 1032),
        word('12,000.00CR', 1900, 1000, 2200, 1032),
        word('11/08', 160, 1060, 300, 1092),
      ],
    });
    const lines = buildLines(page);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.text).toMatch(/^10\/08\s+09\/08\s+CEFT PAYMENT\s+12,000\.00CR$/);
  });

  it('groups a row by overlap, so the amount stays with its description', () => {
    /*
     * The failure this prevents, observed on a real scan: OCR box bottoms
     * move with whatever a word contains, so baseline grouping put every
     * amount on a line of its own and five of eleven transactions vanished.
     * These boxes share a printed row but differ at the bottom edge.
     */
    const page = ocrPageToLayer({
      pageNumber: 1,
      bitmapWidth: 1241,
      bitmapHeight: 1754,
      scale: 2.08,
      words: [
        word('11/08', 80, 400, 140, 424),
        word('11/08', 170, 402, 230, 427), // a couple of pixels lower
        word('SEYLAN', 380, 399, 460, 423),
        word('EASY', 470, 399, 520, 428), // 'Y' drops the box bottom
        word('27,777.77', 980, 401, 1090, 425),
        word('12/08', 80, 440, 140, 464), // the next printed row
      ],
    });
    const lines = buildLines(page);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.text).toContain('27,777.77');
    expect(lines[0]!.text).toContain('SEYLAN');
    expect(lines[1]!.text).toBe('12/08');
  });

  it('keeps a low-confidence word when it carries digits', () => {
    // A masked reference and a crowded figure are exactly the tokens the
    // engine is least sure about, and a dropped figure is invisible whereas
    // a misread one is caught by the arithmetic.
    const page = ocrPageToLayer({
      pageNumber: 1,
      bitmapWidth: 1000,
      bitmapHeight: 1000,
      scale: 1,
      words: [
        word('****1236', 100, 100, 200, 120, MIN_DIGIT_WORD_CONFIDENCE + 1),
        word('~~~', 300, 100, 340, 120, MIN_DIGIT_WORD_CONFIDENCE + 1),
      ],
    });
    expect(page.items.map((i) => i.text)).toEqual(['****1236']);
  });

  it('drops low-confidence noise rather than letting it reach the amount column', () => {
    const page = ocrPageToLayer({
      pageNumber: 1,
      bitmapWidth: 1000,
      bitmapHeight: 1000,
      scale: 2,
      words: [
        word('1,234.56', 100, 100, 200, 120, 95),
        word('|,', 300, 100, 320, 120, MIN_WORD_CONFIDENCE - 1),
      ],
    });
    expect(page.items.map((i) => i.text)).toEqual(['1,234.56']);
  });

  it('reports mean confidence over the words it kept', () => {
    const input = {
      pageNumber: 1,
      bitmapWidth: 100,
      bitmapHeight: 100,
      scale: 1,
      words: [word('a', 0, 0, 1, 1, 80), word('b', 0, 0, 1, 1, 100), word('c', 0, 0, 1, 1, 10)],
    };
    // The 10%-confidence word is discarded, so it must not drag the mean down.
    expect(meanConfidence([input])).toBe(90);
  });
});

describe('the OCR engine never reaches off-origin', () => {
  it('pins every asset path, because the library defaults to a CDN', () => {
    /*
     * tesseract.js falls back to `cdn.jsdelivr.net` for its core and language
     * data when these are not set. That would be an off-origin request on a
     * page whose whole claim is that it makes none -- so the pinning is
     * asserted here rather than left to a reviewer to notice.
     */
    const source = readFileSync('src/parsing/ocr.ts', 'utf8');
    for (const option of ['workerPath', 'corePath', 'langPath']) {
      expect(source, option).toMatch(new RegExp(`${option}:`));
    }
    expect(source).not.toMatch(/cdn\.|jsdelivr|unpkg|https?:\/\//);
    // The paths resolve against the page, so they follow it to any host.
    expect(source).toMatch(/new URL\('tesseract\/', document\.baseURI\)/);
  });
});

describe('trusting an OCR reading', () => {
  const rows = [
    txn({ post: '2026-03-10', description: 'KEELLS SUPER', amount: 20_000 }),
    txn({ post: '2026-03-20', description: 'PAYMENT - THANK YOU', amount: -5_000 }),
  ];

  it('believes a scan whose arithmetic closes, and says why', () => {
    const scanned = statement({ date: '2026-04-06', opening: 100_000, transactions: rows, source: 'ocr', ocrConfidence: 91 });
    const p = buildPortfolio([scanned]);
    const finding = p.anomalies.find((a) => a.kind === 'ocr-verified');
    expect(finding?.severity).toBe('info');
    expect(finding?.detail).toMatch(/misread digit would have broken that/);
    // Descriptions are not covered by any sum, and the wording says so.
    expect(finding?.detail).toMatch(/Descriptions are not checked/);
  });

  it('refuses to believe a scan whose arithmetic does not close', () => {
    const scanned = statement({
      date: '2026-04-06',
      opening: 100_000,
      transactions: rows,
      closingOverride: 114_999, // a digit read wrong
      source: 'ocr',
      ocrConfidence: 88,
    });
    const p = buildPortfolio([scanned]);
    const finding = p.anomalies.find((a) => a.kind === 'ocr-unverified');
    expect(finding?.severity).toBe('critical');
    expect(finding?.detail).toMatch(/not trustworthy/);
    // And it is not quietly reported as an ordinary reconciliation failure.
    expect(p.anomalies.some((a) => a.kind === 'reconciliation')).toBe(false);
  });

  it('says nothing about OCR for a statement that had a text layer', () => {
    const p = buildPortfolio([statement({ date: '2026-04-06', opening: 100_000, transactions: rows })]);
    expect(p.anomalies.some((a) => a.kind.startsWith('ocr'))).toBe(false);
  });
});
