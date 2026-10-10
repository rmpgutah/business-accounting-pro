import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { createTestDb } from '../../test/createTestDb';
import { createIpcDeps } from '../core/deps';
import { registerAdminSettingsIpc } from './admin-settings';
import * as db from '../../database';

// The mock ipcMain exposes invoke/reset, which the real IpcMain type lacks.
const ipc = ipcMain as unknown as {
  invoke(channel: string, ...args: unknown[]): Promise<any>;
  reset(): void;
};

describe('admin-settings domain', () => {
  const scheduleAutoBackup = vi.fn();
  let companyId: string;

  beforeEach(() => {
    ipc.reset();
    scheduleAutoBackup.mockClear();
    companyId = createTestDb().companyId;
    registerAdminSettingsIpc(ipcMain, { ...createIpcDeps(), scheduleAutoBackup });
  });

  it('snippets:list returns an array', async () => {
    const res = await ipc.invoke('snippets:list');
    expect(Array.isArray(res)).toBe(true);
  });

  it('snippets:save persists a snippet and schedules a backup', async () => {
    const res = await ipc.invoke('snippets:save', {
      name: 'Hourly rate',
      description: 'Consulting',
    });
    expect(res.error).toBeUndefined();
    const rows = db
      .getDb()
      .prepare('SELECT id FROM line_item_snippets WHERE company_id = ?')
      .all(companyId);
    expect(rows).toHaveLength(1);
    expect(scheduleAutoBackup).toHaveBeenCalled();
  });

  it('settings:set persists a setting, settings:get reads it, and a backup is scheduled', async () => {
    await ipc.invoke('settings:set', { key: 'theme', value: 'dark' });
    const row = db
      .getDb()
      .prepare('SELECT value FROM settings WHERE company_id = ? AND key = ?')
      .get(companyId, 'theme') as any;
    expect(row.value).toBe('dark');
    expect(scheduleAutoBackup).toHaveBeenCalled();
    const got = await ipc.invoke('settings:get', 'theme');
    expect(got).toBe('dark');
  });
});
