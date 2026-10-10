import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { createTestDb } from '../../test/createTestDb';
import { createIpcDeps } from '../core/deps';
import { registerMiscIpc } from './misc';

// The mock ipcMain exposes invoke/reset, which the real IpcMain type lacks.
const ipc = ipcMain as unknown as {
  invoke(channel: string, ...args: unknown[]): Promise<any>;
  reset(): void;
};

describe('misc domain', () => {
  const scheduleAutoBackup = vi.fn();

  beforeEach(() => {
    ipc.reset();
    scheduleAutoBackup.mockClear();
    createTestDb();
    registerMiscIpc(ipcMain, { ...createIpcDeps(), scheduleAutoBackup });
  });

  // misc has no handler that touches the database or schedules a backup; the
  // "mutate" case asserts the OS-facing handler's result and that the spy is
  // NOT called.
  it('dialog:open-file returns null when the dialog is cancelled', async () => {
    expect(await ipc.invoke('dialog:open-file')).toBeNull();
  });

  it('shell:open-external accepts http(s) and rejects other schemes', async () => {
    expect(await ipc.invoke('shell:open-external', 'https://example.com')).toEqual({ ok: true });
    expect(await ipc.invoke('shell:open-external', 'file:///etc/passwd')).toEqual({ ok: false });
    expect(scheduleAutoBackup).not.toHaveBeenCalled();
  });
});
