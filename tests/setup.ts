import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { setPdfWorkerSrc } from '@/parsing/pdf';

/**
 * Point pdf.js at its worker for the Node test run. In the browser Vite
 * rewrites the specifier to a hashed asset; Node has no bundler to do that,
 * so the path is resolved here rather than inside shipped code.
 */
const require = createRequire(import.meta.url);
setPdfWorkerSrc(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href);
