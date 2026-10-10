import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { createTestDb } from '../../test/createTestDb';
import { createIpcDeps } from '../core/deps';
import { registerClientsVendorsIpc } from './clients-vendors';
import * as db from '../../database';

// The mock ipcMain exposes invoke/reset, which the real IpcMain type lacks.
const ipc = ipcMain as unknown as {
  invoke(channel: string, ...args: unknown[]): Promise<any>;
  reset(): void;
};

describe('clients-vendors domain', () => {
  const scheduleAutoBackup = vi.fn();
  let companyId: string;

  beforeEach(() => {
    ipc.reset();
    scheduleAutoBackup.mockClear();
    companyId = createTestDb().companyId;
    registerClientsVendorsIpc(ipcMain, { ...createIpcDeps(), scheduleAutoBackup });
  });

  it('tags:list returns an array', async () => {
    const res = await ipc.invoke('tags:list', { companyId });
    expect(Array.isArray(res)).toBe(true);
  });

  it('vn:dashboard (lazy-required service) does not error', async () => {
    const res = await ipc.invoke('vn:dashboard', { vendorId: 'no-such-vendor' });
    expect(res?.error).toBeUndefined();
  });

  it('tags:create inserts a tag and schedules a backup', async () => {
    const res = await ipc.invoke('tags:create', {
      company_id: companyId,
      name: 'VIP',
      color: '#000000',
    });
    expect(res?.error).toBeUndefined();
    const rows = db.getDb().prepare('SELECT id FROM tags WHERE name = ?').all('VIP');
    expect(rows).toHaveLength(1);
    expect(scheduleAutoBackup).toHaveBeenCalled();
  });
});
