import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const COMPAT_PATH = fileURLToPath(new URL('./src/parsing/compat.js', import.meta.url));

/**
 * Prepend the compatibility shims to the pdf.js worker bundle.
 *
 * A worker has its own global scope, so the shims installed on the page never
 * reach it -- and the worker is where pdf.js does most of its work. The worker
 * is copied through as an asset rather than compiled with the app, so this is
 * the point at which it can be reached.
 *
 * If no worker asset is found the build fails rather than shipping a bundle
 * that works on this machine and throws on an older phone.
 */
function pdfWorkerCompat(): Plugin {
  return {
    name: 'pdfjs-worker-compat',
    apply: 'build',
    generateBundle(_options, bundle) {
      const prelude = readFileSync(COMPAT_PATH, 'utf8');
      let patched = 0;

      for (const [fileName, output] of Object.entries(bundle)) {
        if (!fileName.includes('pdf.worker')) continue;

        if (output.type === 'chunk') {
          output.code = `${prelude}\n${output.code}`;
          patched += 1;
          continue;
        }
        // An asset referenced through `new URL(..., import.meta.url)` is
        // carried through as raw bytes, not as a string.
        const source = output.source;
        const text =
          typeof source === 'string' ? source : new TextDecoder().decode(source);
        output.source = `${prelude}\n${text}`;
        patched += 1;
      }

      if (patched === 0) {
        this.error(
          'pdfjs-worker-compat found no pdf.worker asset to patch. The worker would ship ' +
            'without the Promise.withResolvers shim and fail on Safari below 17.4.',
        );
      }
    },
  };
}

// Static build. No server, no proxy, no API target -- statement data never
// leaves the browser, so there is nothing for a dev server to forward.
export default defineConfig({
  plugins: [react(), pdfWorkerCompat()],
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    /*
     * Targets chosen for the devices this actually runs on, not for the
     * newest syntax available. Safari 15 is iOS 15, which plenty of iPhones
     * still run; leaving the target at es2022 shipped untranspiled syntax
     * those devices cannot parse.
     */
    target: ['es2020', 'safari15', 'chrome90', 'firefox90', 'edge90'],
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('pdfjs-dist')) return 'pdfjs';
          if (id.includes('recharts') || id.includes('d3-')) return 'charts';
          if (id.includes('exceljs')) return 'excel';
          return undefined;
        },
      },
    },
  },
  worker: { format: 'es' },
});
