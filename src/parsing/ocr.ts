import type { DocumentLayer, PageLayer } from './textLayer';
import { meanConfidence, ocrPageToLayer, type OcrPageInput, type OcrWord } from './ocrGeometry';

/**
 * Optical character recognition for scanned statements.
 *
 * Runs entirely in the browser on a WebAssembly build of Tesseract. The engine,
 * its language data and its worker are served from this origin -- they are
 * copied into the build rather than fetched from a CDN, so a scanned statement
 * is no less private than a text one and the page still makes no off-origin
 * request. They are several megabytes, so they load only when a scanned file
 * is actually opened; a reader with ordinary statements never downloads them.
 *
 * What OCR produces is a *reading*, not the statement. Every figure it returns
 * could be wrong in a way that still looks like money. That is why nothing here
 * decides whether the result is trustworthy: it hands back positioned text like
 * any other source, and the reconciliation invariant -- which OCR cannot
 * accidentally satisfy -- is what decides whether the numbers are believed.
 */

/**
 * Render resolution. Tesseract is trained around 300 DPI; below ~200 the
 * thin strokes in a statement's figures start dropping out, and above 300
 * the memory cost on a phone outweighs the accuracy.
 */
const RENDER_DPI = 300;
const PDF_UNITS_PER_INCH = 72;

/** Guard against a malformed page asking for a gigapixel bitmap. */
const MAX_BITMAP_EDGE = 5000;

export interface OcrProgress {
  page: number;
  pageCount: number;
  /** 0-1 within the current page. */
  progress: number;
  status: string;
}

export interface OcrResult {
  layer: DocumentLayer;
  /** Mean word confidence, 0-100. */
  confidence: number;
  /** Words the confidence floor discarded, across the document. */
  discardedWords: number;
}

export interface OcrOptions {
  fileName: string;
  onProgress?: (progress: OcrProgress) => void;
  /** Abort a long run when the reader navigates away. */
  signal?: AbortSignal;
}

/** Where the engine's own files live, relative to the deployed page. */
function assetBase(): string {
  return new URL('tesseract/', document.baseURI).href;
}

type TesseractModule = typeof import('tesseract.js');

let modulePromise: Promise<TesseractModule> | undefined;

function loadTesseract(): Promise<TesseractModule> {
  // Deliberately dynamic: this pulls in megabytes, and a reader whose
  // statements have a text layer must never pay for it.
  modulePromise ??= import('tesseract.js');
  return modulePromise;
}

export async function ocrDocument(
  bytes: Uint8Array,
  options: OcrOptions,
): Promise<OcrResult> {
  const [{ createWorker }, { getPdfDocument }] = await Promise.all([
    loadTesseract(),
    import('./pdf'),
  ]);

  const base = assetBase();

  // Declared before the worker is created: its logger fires during load, and
  // reading these from the callback beforehand is a temporal-dead-zone error
  // that throws on every progress message.
  let currentPage = 0;
  let currentPageCount = 0;

  const worker = await createWorker('eng', 1, {
    workerPath: `${base}worker.min.js`,
    corePath: base,
    langPath: base,
    // The language file ships gzipped, as npm packages it.
    gzip: true,
    logger: (message) => {
      if (message.status && options.onProgress) {
        options.onProgress({
          page: currentPage,
          pageCount: currentPageCount,
          progress: message.progress ?? 0,
          status: message.status,
        });
      }
    },
  });

  try {
    const { doc, destroy } = await getPdfDocument(bytes);
    try {
      currentPageCount = doc.numPages;
      const pageInputs: OcrPageInput[] = [];
      const pages: PageLayer[] = [];

      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
        options.signal?.throwIfAborted();
        currentPage = pageNumber;

        const page = await doc.getPage(pageNumber);
        try {
          const input = await recognisePage(worker, page, pageNumber);
          pageInputs.push(input);
          pages.push(ocrPageToLayer(input));
        } finally {
          page.cleanup();
        }
      }

      const keptWords = pages.reduce((n, p) => n + p.items.length, 0);
      const allWords = pageInputs.reduce((n, p) => n + p.words.length, 0);

      return {
        layer: { fileName: options.fileName, pages },
        confidence: meanConfidence(pageInputs),
        discardedWords: allWords - keptWords,
      };
    } finally {
      await destroy();
    }
  } finally {
    await worker.terminate();
  }
}

type PdfPage = Awaited<
  ReturnType<Awaited<ReturnType<typeof import('./pdf').getPdfDocument>>['doc']['getPage']>
>;

async function recognisePage(
  worker: Awaited<ReturnType<TesseractModule['createWorker']>>,
  page: PdfPage,
  pageNumber: number,
): Promise<OcrPageInput> {
  const wanted = RENDER_DPI / PDF_UNITS_PER_INCH;
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(
    wanted,
    MAX_BITMAP_EDGE / Math.max(base.width, base.height),
  );
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('This browser would not provide a 2D canvas to render the page into.');

  // A scan is usually dark ink on white; painting the ground white first stops
  // a transparent background reading as black once it reaches the recogniser.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  // pdf.js needs the canvas itself as well as its context.
  await page.render({ canvasContext: context, canvas, viewport }).promise;

  const { data } = await worker.recognize(canvas, {}, { blocks: true });
  const words = collectWords(data);

  // Free the bitmap before the next page: several 300-DPI A4 pages at once
  // is enough to lose the tab on a phone.
  canvas.width = 0;
  canvas.height = 0;

  return {
    pageNumber,
    words,
    bitmapWidth: Math.ceil(viewport.width),
    bitmapHeight: Math.ceil(viewport.height),
    scale,
  };
}

/** Walk blocks -> paragraphs -> lines -> words, tolerating missing levels. */
function collectWords(data: { blocks?: unknown }): OcrWord[] {
  const words: OcrWord[] = [];
  const blocks = Array.isArray(data.blocks) ? data.blocks : [];

  for (const block of blocks) {
    for (const paragraph of childArray(block, 'paragraphs')) {
      for (const line of childArray(paragraph, 'lines')) {
        for (const word of childArray(line, 'words')) {
          const w = word as Partial<OcrWord>;
          if (typeof w.text !== 'string' || !w.bbox) continue;
          words.push({
            text: w.text,
            bbox: w.bbox,
            confidence: typeof w.confidence === 'number' ? w.confidence : 0,
          });
        }
      }
    }
  }
  return words;
}

function childArray(parent: unknown, key: string): unknown[] {
  if (typeof parent !== 'object' || parent === null) return [];
  const value = (parent as Record<string, unknown>)[key];
  return Array.isArray(value) ? value : [];
}
