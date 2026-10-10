// @ts-ignore -- tsx/cjs has no type declarations; registers a .ts require hook for lazy require() in handlers
import 'tsx/cjs';
import Module from 'module';
import path from 'path';
import { afterEach } from 'vitest';
import { ipcMain } from 'electron';
import { closeTestDb } from './createTestDb';

// The Vite alias only covers imports Vite resolves. Route native require('electron')
// (e.g. lazily required services) to the same mock module.
const MOCK = path.resolve(__dirname, 'electron-mock.ts');
const origResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...rest: any[]) {
  if (request === 'electron') return MOCK;
  return origResolve.call(this, request, ...rest);
};

afterEach(() => {
  (ipcMain as any).reset?.();
  closeTestDb();
});
