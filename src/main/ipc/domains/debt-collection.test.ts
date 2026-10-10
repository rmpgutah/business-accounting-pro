import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { createTestDb } from '../../test/createTestDb';
import { createIpcDeps } from '../core/deps';
import { registerDebtCollectionIpc } from './debt-collection';
import * as db from '../../database';

// The mock ipcMain exposes invoke/reset, which the real IpcMain type lacks.
const ipc = ipcMain as unknown as {
  invoke(channel: string, ...args: unknown[]): Promise<any>;
  reset(): void;
};

describe('debt-collection domain', () => {
  const scheduleAutoBackup = vi.fn();
  let companyId: string;

  beforeEach(() => {
    ipc.reset();
    scheduleAutoBackup.mockClear();
    companyId = createTestDb().companyId;
    registerDebtCollectionIpc(ipcMain, { ...createIpcDeps(), scheduleAutoBackup });
  });

  it('dc:by-stage (lazy-required service) returns an array', async () => {
    const res = await ipc.invoke('dc:by-stage');
    expect(Array.isArray(res)).toBe(true);
  });

  it('debt:stats returns without error', async () => {
    const res = await ipc.invoke('debt:stats', { companyId });
    expect(res?.error).toBeUndefined();
  });

  it('debt:campaign-save creates a campaign and schedules a backup', async () => {
    const res = await ipc.invoke('debt:campaign-save', { name: 'Q1 push' });
    expect(res.error).toBeUndefined();
    const rows = db
      .getDb()
      .prepare('SELECT id FROM debt_campaigns WHERE company_id = ?')
      .all(companyId);
    expect(rows).toHaveLength(1);
    expect(scheduleAutoBackup).toHaveBeenCalled();
  });
});
