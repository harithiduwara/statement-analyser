import { describe, expect, it } from 'vitest';
import { classifyPdfError, extractTextLayer, PdfPasswordError } from '@/parsing/pdf';
import { makePdf } from './helpers/makePdf';
import { seylanStatementPages } from './fixtures/seylan';

describe('classifyPdfError', () => {
  it('reads a needs-password rejection as "required"', () => {
    const e = classifyPdfError({ name: 'PasswordException', code: 1 });
    expect(e).toBeInstanceOf(PdfPasswordError);
    expect(e?.reason).toBe('required');
  });

  it('reads a wrong-password rejection as "incorrect"', () => {
    expect(classifyPdfError({ name: 'PasswordException', code: 2 })?.reason).toBe('incorrect');
  });

  it('defaults an unspecified code to "required"', () => {
    expect(classifyPdfError({ name: 'PasswordException' })?.reason).toBe('required');
  });

  it('leaves any other failure alone', () => {
    expect(classifyPdfError(new Error('Invalid PDF structure'))).toBeUndefined();
    expect(classifyPdfError({ name: 'FormatError' })).toBeUndefined();
    expect(classifyPdfError(null)).toBeUndefined();
    expect(classifyPdfError('nope')).toBeUndefined();
  });

  it('is a named error carrying its reason', () => {
    const e = new PdfPasswordError('incorrect');
    expect(e.name).toBe('PdfPasswordError');
    expect(e.reason).toBe('incorrect');
  });
});

describe('password threading', () => {
  it('ignores a password on a PDF that is not encrypted', async () => {
    // Threading a password must not disturb the ordinary, unencrypted path.
    const bytes = makePdf(seylanStatementPages());
    const layer = await extractTextLayer(bytes, { fileName: 'seylan.pdf', password: 'unused' });
    expect(layer.pages.length).toBeGreaterThan(0);
  });
});
