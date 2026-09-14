/**
 * Copy the OCR engine's own files into `public/tesseract/`.
 *
 * Tesseract.js fetches its worker, its WebAssembly core and its language data
 * at runtime, and by default it fetches them from a CDN. That would be an
 * off-origin request carrying nothing sensitive but breaking the property the
 * whole app rests on -- that the page talks to nobody. Serving them from this
 * origin keeps a scanned statement exactly as private as a text one.
 *
 * Copied at build time rather than committed: they are ~9 MB of third-party
 * binaries whose version should follow package.json, not a stale checkout.
 */
import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'tesseract');

/*
 * The LSTM-only cores, in their `.wasm.js` form.
 *
 * That file embeds the WebAssembly binary as base64, so the separate `.wasm`
 * is never fetched and must not be shipped -- copying it would add 8 MB that
 * nothing ever asks for. Tesseract picks exactly one of these at runtime by
 * feature detection: relaxed SIMD where available, plain SIMD next, and the
 * baseline build for a browser with neither. All three are deployed so that
 * every browser has its one; each reader downloads only the one that fits.
 */
const CORE_VARIANTS = [
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js',
];

function resolveIn(pkg, file) {
  return join(dirname(require.resolve(`${pkg}/package.json`)), file);
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const copies = [
  [resolveIn('tesseract.js', 'dist/worker.min.js'), 'worker.min.js'],
  // The integer-quantised model: a third the size of the full one, and the
  // accuracy difference does not show on printed statement text.
  [resolveIn('@tesseract.js-data/eng', '4.0.0_best_int/eng.traineddata.gz'), 'eng.traineddata.gz'],
  ...CORE_VARIANTS.map((file) => [resolveIn('tesseract.js-core', file), file]),
];

let total = 0;
for (const [from, name] of copies) {
  await copyFile(from, join(outDir, name));
  total += (await stat(from)).size;
}

console.log(
  `[ocr-assets] ${copies.length} files, ${(total / 1048576).toFixed(1)} MB -> public/tesseract/`,
);
