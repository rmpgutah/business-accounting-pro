import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { readFileSync } from 'fs';
const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'));

// Strip the in-memory Electron mock so the web build uses the real /api/rpc bridge.
const stripDevMock: Plugin = {
  name: 'strip-dev-mock',
  transformIndexHtml(html: string) {
    // Remove the comment + <script> block that sets up window.electronAPI
    return html.replace(
      /\s*<!-- Browser dev mock[\s\S]*?<\/script>/,
      '',
    );
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), stripDevMock],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  // Absolute base so all asset URLs work from any SPA route
  base: '/',
  root: './src/renderer',
  build: {
    outDir: '../../cloudflare-app/dist/web',
    emptyOutDir: true,
    minify: 'terser',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@renderer': path.resolve(__dirname, './src/renderer'),
      '@shared': path.resolve(__dirname, './src/shared'),
    },
  },
});
