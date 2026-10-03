import { describe, expect, it } from 'vitest';
import { buildImagePdf } from '@/export/chartImage';

// Not a real JPEG -- buildImagePdf embeds the bytes verbatim and never decodes
// them, so any payload exercises the structure and the byte-offset maths.
const payload = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

function latin1(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

describe('buildImagePdf', () => {
  it('emits a structurally valid single-page PDF', () => {
    const text = latin1(buildImagePdf([{ jpeg: payload, width: 100, height: 50, title: 'A (chart)' }]));
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('/Count 1');
    expect(text).toContain('/Filter /DCTDecode');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    // The title is escaped, parentheses and all.
    expect(text).toContain('(A \\(chart\\))');
  });

  it('writes one page per image', () => {
    const text = latin1(
      buildImagePdf([
        { jpeg: payload, width: 10, height: 10 },
        { jpeg: payload, width: 10, height: 10 },
      ]),
    );
    expect(text).toContain('/Count 2');
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBe(2);
  });

  it('writes an xref whose every entry points at its object', () => {
    const text = latin1(buildImagePdf([{ jpeg: payload, width: 10, height: 10, title: 'X' }]));
    const start = /startxref\s+(\d+)/.exec(text);
    expect(start).not.toBeNull();
    const xrefOffset = Number(start![1]);
    expect(text.slice(xrefOffset, xrefOffset + 4)).toBe('xref');

    const header = /xref\n0 (\d+)\n/.exec(text.slice(xrefOffset));
    expect(header).not.toBeNull();
    const size = Number(header![1]);
    const entriesAt = xrefOffset + header![0].length;
    // Entry 0 is the free head; 1..size-1 must each sit exactly on "N 0 obj".
    for (let n = 1; n < size; n += 1) {
      const entry = text.slice(entriesAt + n * 20, entriesAt + n * 20 + 20);
      const offset = Number(entry.slice(0, 10));
      const marker = `${n} 0 obj`;
      expect(text.slice(offset, offset + marker.length)).toBe(marker);
    }
  });
});
