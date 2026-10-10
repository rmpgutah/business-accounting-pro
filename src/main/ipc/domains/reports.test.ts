import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { createTestDb } from '../../test/createTestDb';
import { createIpcDeps } from '../core/deps';
import { registerReportsIpc } from './reports';
import * as db from '../../database';

// The mock ipcMain exposes invoke/reset, which the real IpcMain type lacks.
const ipc = ipcMain as unknown as {
  invoke(channel: string, ...args: unknown[]): Promise<any>;
  reset(): void;
};

describe('reports domain', () => {
  const scheduleAutoBackup = vi.fn();
  let companyId: string;

  beforeEach(() => {
    ipc.reset();
    scheduleAutoBackup.mockClear();
    companyId = createTestDb().companyId;
    registerReportsIpc(ipcMain, { ...createIpcDeps(), scheduleAutoBackup });
  });

  it('rpt:def:list (lazy-required service) returns an array', async () => {
    const res = await ipc.invoke('rpt:def:list');
    expect(Array.isArray(res)).toBe(true);
  });

  it('reports:profit-loss returns without error', async () => {
    const res = await ipc.invoke('reports:profit-loss', {
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
    expect(res?.error).toBeUndefined();
  });

  it('rpt:def:create persists a definition', async () => {
    const res = await ipc.invoke('rpt:def:create', { name: 'My report' });
    expect(res.error).toBeUndefined();
    const rows = db
      .getDb()
      .prepare('SELECT id FROM report_definitions WHERE company_id = ?')
      .all(companyId);
    expect(rows).toHaveLength(1);
    // The original handlers never scheduled a backup for this domain (moved verbatim).
    expect(scheduleAutoBackup).not.toHaveBeenCalled();
  });

  it('dashboard:stats returns stats for the period without error', async () => {
    const res = await ipc.invoke('dashboard:stats', {
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
    expect(res?.error).toBeUndefined();
    expect(res).toBeTruthy();
    expect(scheduleAutoBackup).not.toHaveBeenCalled();
  });
});
