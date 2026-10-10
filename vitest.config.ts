import { defineConfig } from 'vitest/config';
import path from 'path';

const aliases = {
  '@': path.resolve(__dirname, 'src'),
  '@renderer': path.resolve(__dirname, 'src/renderer'),
  '@shared': path.resolve(__dirname, 'src/shared'),
  '@main': path.resolve(__dirname, 'src/main'),
};

export default defineConfig({
  test: {
    coverage: { provider: 'v8', reporter: ['text', 'html'], include: ['src/**/*.ts', 'src/**/*.tsx'] },
    projects: [
      {
        test: {
          name: 'main',
          environment: 'node',
          include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts', 'eslint-rules/**/*.test.mjs'],
          setupFiles: ['src/main/test/setup.ts'],
        },
        resolve: { alias: { ...aliases, electron: path.resolve(__dirname, 'src/main/test/electron-mock.ts') } },
      },
      {
        test: { name: 'renderer', environment: 'jsdom', include: ['src/renderer/**/*.test.{ts,tsx}'] },
        resolve: { alias: aliases },
      },
    ],
  },
});
