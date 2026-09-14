import { makePdf, type PageSpec } from './makePdf';
import { extractTextLayer } from '@/parsing/pdf';
import { parseDocument, type ParseResult } from '@/parsing/parser';
import '@/parsing/seylan';
import '@/parsing/sampath';

/** Render fixture pages to a PDF and run the full extract-and-parse pipeline. */
export async function parsePages(pages: PageSpec[], fileName: string): Promise<ParseResult> {
  const bytes = makePdf(pages);
  const doc = await extractTextLayer(bytes, { fileName });
  return parseDocument(doc);
}

/** As `parsePages`, but fails loudly instead of returning an error result. */
export async function parsePagesOrThrow(pages: PageSpec[], fileName: string) {
  const result = await parsePages(pages, fileName);
  if (!result.ok || !result.statement) {
    throw new Error(`Parse failed for ${fileName}: ${result.error ?? 'no statement returned'}`);
  }
  return result.statement;
}
