import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Static build. No server, no proxy, no API target -- statement data never
// leaves the browser, so there is nothing for a dev server to forward.
export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
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
