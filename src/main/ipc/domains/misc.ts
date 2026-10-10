import { dialog, shell } from 'electron';
import type { IpcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import type { IpcDeps } from '../core/types';

export function registerMiscIpc(ipcMain: IpcMain, _deps: IpcDeps): void {
  // ─── File Dialog ────────────────────────────────────────
  ipcMain.handle(
    'dialog:open-file',
    async (_event, options?: { filters?: Array<{ name: string; extensions: string[] }> }) => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: options?.filters || [{ name: 'All Files', extensions: ['*'] }],
      });
      if (result.canceled || !result.filePaths.length) return null;
      const filePath = result.filePaths[0];
      const stats = fs.statSync(filePath);
      return { path: filePath, name: path.basename(filePath), size: stats.size };
    },
  );
  // SECURITY: only http(s) URLs reach the OS shell; rejects mailto/file/etc.
  ipcMain.handle('shell:open-external', (_event, url: string) => {
    if (typeof url !== 'string') return { ok: false };
    if (!/^https?:\/\//i.test(url)) return { ok: false };
    try {
      shell.openExternal(url).catch(() => {});
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message };
    }
  });
}
