import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { createTestDb } from '../../test/createTestDb';
import { createIpcDeps } from '../core/deps';
import { registerDbCrudIpc } from './db-crud';
import * as db from '../../database';

// The mock ipcMain exposes invoke/reset, which the real IpcMain type lacks.
const ipc = ipcMain as unknown as {
  invoke(channel: string, ...args: unknown[]): Promise<any>;
  reset(): void;
};

describe('db-crud domain', () => {
  const scheduleAutoBackup = vi.fn();

  beforeEach(() => {
    ipc.reset();
    scheduleAutoBackup.mockClear();
    createTestDb();
    registerDbCrudIpc(ipcMain, { ...createIpcDeps(), scheduleAutoBackup });
  });

  it('db:query on clients returns an empty list', async () => {
    expect(await ipc.invoke('db:query', { table: 'clients' })).toEqual([]);
  });

  it('db:create on clients returns an id and schedules a backup', async () => {
    const res = await ipc.invoke('db:create', { table: 'clients', data: { name: 'Acme' } });
    expect(res.error).toBeUndefined();
    expect(res.id).toBeTruthy();
    expect(scheduleAutoBackup).toHaveBeenCalled();
  });

  it('batch:update updates every id and schedules a backup', async () => {
    const a = await ipc.invoke('db:create', { table: 'clients', data: { name: 'Acme' } });
    const b = await ipc.invoke('db:create', { table: 'clients', data: { name: 'Beta' } });
    scheduleAutoBackup.mockClear();
    const res = await ipc.invoke('batch:update', {
      table: 'clients',
      ids: [a.id, b.id],
      data: { notes: 'bulk' },
    });
    expect(res).toHaveLength(2);
    const rows = db.getDb().prepare("SELECT id FROM clients WHERE notes = 'bulk'").all();
    expect(rows).toHaveLength(2);
    expect(scheduleAutoBackup).toHaveBeenCalled();
  });
});
