import type { DocumentLayer, PageLayer, TextItem } from './textLayer';

/**
 * pdf.js boundary.
 *
 * Everything downstream works on `DocumentLayer`, so the rest of the codebase
 * has no pdf.js dependency and the parsers are testable from recorded layers.
 *
 * No network, no remote font or CMap fetching: `getDocument` is given bytes
 * that came from a local `File`, and every option that could reach out is
 * turned off. Statement bytes never leave the page.
 */

/**
 * The `legacy` build is used in both environments deliberately. pdf.js's
 * modern build calls `Promise.try`, which Node 22 does not implement, so the
 * test suite cannot run against it; and using a different build in tests than
 * in the browser would mean the parsers are never exercised against the code
 * that actually ships. One build, one code path.
 */
type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

let modulePromise: Promise<PdfJsModule> | undefined;

async function loadPdfJs(): Promise<PdfJsModule> {
  modulePromise ??= (async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    await configureWorker(pdfjs);
    return pdfjs;
  })();
  return modulePromise;
}

/**
 * Worker location, when something has set it explicitly.
 *
 * Node has no bundler to rewrite the bare specifier below, so the test setup
 * resolves the worker itself and calls `setPdfWorkerSrc`. Keeping that out of
 * this module means no `node:` import reaches the browser bundle -- Vite would
 * otherwise externalise them into a stub chunk shipped to every visitor.
 */
let workerSrcOverride: string | undefined;

export function setPdfWorkerSrc(src: string): void {
  workerSrcOverride = src;
}

async function configureWorker(pdfjs: PdfJsModule): Promise<void> {
  const options = pdfjs.GlobalWorkerOptions;
  if (options.workerSrc) return;

  options.workerSrc =
    workerSrcOverride ??
    // Vite rewrites this to the hashed asset it emits, relative to the page.
    new URL('pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href;
}

export interface ExtractOptions {
  fileName: string;
  /** Abort a runaway parse rather than hanging the tab. */
  maxPages?: number;
}

/** Extract a positioned text layer from PDF bytes. */
export async function extractTextLayer(
  data: Uint8Array | ArrayBuffer,
  options: ExtractOptions,
): Promise<DocumentLayer> {
  const pdfjs = await loadPdfJs();
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

  const task = pdfjs.getDocument({
    // pdf.js transfers and neuters the buffer it is handed; copy so callers
    // can re-read the same File (e.g. to retry with another parser).
    data: bytes.slice(),
    useWorkerFetch: false,
    disableFontFace: true,
    // Text extraction needs no glyph outlines; quieten the standard-font
    // warning that follows from deliberately configuring no font URL.
    verbosity: 0,
    // No standard-font or CMap URL is configured, so pdf.js cannot fetch.
  });

  const doc = await task.promise;
  try {
    const pageCount = Math.min(doc.numPages, options.maxPages ?? 64);
    const pages: PageLayer[] = [];

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const items: TextItem[] = [];

        for (const raw of content.items) {
          if (!('str' in raw)) continue; // a marked-content boundary, not text
          const transform = raw.transform;
          const x = transform[4] ?? 0;
          const y = transform[5] ?? 0;
          // transform[3] is the vertical scale, which for ordinary horizontal
          // text is the effective font size.
          const height = Math.abs(transform[3] ?? raw.height ?? 0) || raw.height || 8;
          items.push({
            text: raw.str,
            x,
            y,
            width: raw.width ?? 0,
            height,
            fontName: raw.fontName,
          });
        }

        pages.push({
          pageNumber,
          width: viewport.width,
          height: viewport.height,
          items,
        });
      } finally {
        page.cleanup();
      }
    }

    return { fileName: options.fileName, pages };
  } finally {
    // `destroy` lives on the loading task, not the document proxy.
    await task.destroy();
  }
}

/** Extract directly from a browser `File`. */
export async function extractFromFile(file: File): Promise<DocumentLayer> {
  const buffer = await file.arrayBuffer();
  return extractTextLayer(buffer, { fileName: file.name });
}
