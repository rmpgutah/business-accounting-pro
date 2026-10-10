import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { createTestDb } from '../../test/createTestDb';
import { createIpcDeps } from '../core/deps';
import { registerSyncBackupIpc } from './sync-backup';
import * as db from '../../database';

// The mock ipcMain exposes invoke/reset, which the real IpcMain type lacks.
const ipc = ipcMain as unknown as {
  invoke(channel: string, ...args: unknown[]): Promise<any>;
  reset(): void;
};

describe('sync-backup domain', () => {
  const scheduleAutoBackup = vi.fn();
  let companyId: string;

  beforeEach(() => {
    ipc.reset();
    scheduleAutoBackup.mockClear();
    companyId = createTestDb().companyId;
    registerSyncBackupIpc(ipcMain, { ...createIpcDeps(), scheduleAutoBackup });
  });

  // NOTE: no handler in this domain mutates local data (they push to / pull
  // from a remote server), and none calls scheduleAutoBackup, so these
  // cases assert settings persisted in the DB drive the result and that the
  // backup spy is NOT called.
  it('cloud:bootstrap-users reports a missing Cloud Sync URL', async () => {
    const res = await ipc.invoke('cloud:bootstrap-users');
    expect(res.error).toMatch(/Cloud Sync URL not set/);
    expect(scheduleAutoBackup).not.toHaveBeenCalled();
  });

  it('cloud:bootstrap-users reports a missing Cloud Sync token once the URL is stored', async () => {
    db.getDb()
      .prepare('INSERT INTO settings (id, company_id, key, value) VALUES (?, ?, ?, ?)')
      .run('s1', companyId, 'cloud_sync_url', 'https://cloud.test/');
    const res = await ipc.invoke('cloud:bootstrap-users');
    expect(res.error).toMatch(/Cloud Sync Token not set/);
    expect(scheduleAutoBackup).not.toHaveBeenCalled();
  });
});
