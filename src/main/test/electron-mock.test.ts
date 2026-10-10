import { describe, it, expect } from 'vitest';
import { ipcMain as electronIpcMain } from 'electron';

// The mock exposes test-only helpers (invoke/channels/reset) beyond Electron's IpcMain type.
const ipcMain = electronIpcMain as any;

describe('electron mock wiring', () => {
  it('native require("electron") resolves to the same mock as the import', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const required = require('electron');
    expect(required.ipcMain.handle).toBe(ipcMain.handle);
  });

  it('lazily required services that import electron load without throwing', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    expect(() => require('../services/print-preview')).not.toThrow();
  });
});

describe('ipcMain mock', () => {
  it('invoke on an unregistered channel rejects', async () => {
    await expect(ipcMain.invoke('nope')).rejects.toThrow("No handler registered for 'nope'");
  });

  it('registering the same channel twice throws', () => {
    ipcMain.handle('dup', () => 1);
    expect(() => ipcMain.handle('dup', () => 2)).toThrow(/second handler/);
  });

  it('channels() lists registered names and reset() empties', async () => {
    ipcMain.handle('a', () => 'x');
    ipcMain.handle('b', (_e, v) => v);
    expect(ipcMain.channels()).toEqual(['a', 'b']);
    expect(await ipcMain.invoke('b', 7)).toBe(7);
    ipcMain.reset();
    expect(ipcMain.channels()).toEqual([]);
  });
});
