import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { readFileSync } from 'fs';
const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  base: './',
  root: './src/renderer',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    // Use terser, not the default esbuild minifier. esbuild has a name-collision
    // bug that can rename a nested variable (e.g. ExpenseForm's `capWarning`) and
    // a top-level lazy-ESM init function to the SAME short name (`st`), leaving an
    // undefined `st()` call at module init → "st is not defined" crash when the
    // Expenses chunk loads. terser's renamer doesn't hit this. tsc stays clean
    // because the defect is purely in the minify pass, not the source.
    minify: 'terser',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@renderer': path.resolve(__dirname, './src/renderer'),
      '@shared': path.resolve(__dirname, './src/shared'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
