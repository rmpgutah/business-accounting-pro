import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { createTestDb } from '../../test/createTestDb';
import { createIpcDeps } from '../core/deps';
import { registerLoansAdvancedIpc } from './loans-advanced';
import * as db from '../../database';

// The mock ipcMain exposes invoke/reset, which the real IpcMain type lacks.
const ipc = ipcMain as unknown as {
  invoke(channel: string, ...args: unknown[]): Promise<any>;
  reset(): void;
};

describe('loans-advanced domain', () => {
  const scheduleAutoBackup = vi.fn();
  let companyId: string;

  beforeEach(() => {
    ipc.reset();
    scheduleAutoBackup.mockClear();
    companyId = createTestDb().companyId;
    registerLoansAdvancedIpc(ipcMain, { ...createIpcDeps(), scheduleAutoBackup });
  });

  it('la:covenant:breaches (lazy-required service) returns an array', async () => {
    const res = await ipc.invoke('la:covenant:breaches');
    expect(Array.isArray(res)).toBe(true);
  });

  it('la:portfolio:dashboard returns without error', async () => {
    const res = await ipc.invoke('la:portfolio:dashboard');
    expect(res?.error).toBeUndefined();
  });

  it('lf:borrower:upsert persists a borrower profile', async () => {
    const res = await ipc.invoke('lf:borrower:upsert', { name: 'Jane Borrower' });
    expect(res.error).toBeUndefined();
    const rows = db
      .getDb()
      .prepare('SELECT id FROM borrower_profiles WHERE company_id = ?')
      .all(companyId);
    expect(rows).toHaveLength(1);
    // The original handlers never scheduled a backup for this domain (moved verbatim).
    expect(scheduleAutoBackup).not.toHaveBeenCalled();
  });
});
