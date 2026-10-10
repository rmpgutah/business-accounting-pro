import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { createTestDb } from '../../test/createTestDb';
import { createIpcDeps } from '../core/deps';
import { registerHrPayrollIpc } from './hr-payroll';
import * as db from '../../database';

// The mock ipcMain exposes invoke/reset, which the real IpcMain type lacks.
const ipc = ipcMain as unknown as {
  invoke(channel: string, ...args: unknown[]): Promise<any>;
  reset(): void;
};

describe('hr-payroll domain', () => {
  const scheduleAutoBackup = vi.fn();
  let companyId: string;

  beforeEach(() => {
    ipc.reset();
    scheduleAutoBackup.mockClear();
    companyId = createTestDb().companyId;
    registerHrPayrollIpc(ipcMain, { ...createIpcDeps(), scheduleAutoBackup });
  });

  it('hr:benefit-plans (lazy-required service) returns an array', async () => {
    const res = await ipc.invoke('hr:benefit-plans');
    expect(Array.isArray(res)).toBe(true);
  });

  it('payroll:pto-policy-save creates a policy and schedules a backup', async () => {
    const res = await ipc.invoke('payroll:pto-policy-save', { name: 'Vacation' });
    expect(res.error).toBeUndefined();
    const rows = db
      .getDb()
      .prepare('SELECT id FROM pto_policies WHERE company_id = ?')
      .all(companyId);
    expect(rows).toHaveLength(1);
    expect(scheduleAutoBackup).toHaveBeenCalled();
  });

  it('tax:get-utah-config returns null when no config exists for the year', async () => {
    expect(await ipc.invoke('tax:get-utah-config', { year: 2026 })).toBeNull();
  });

  it('tax:save-utah-config persists the config and schedules a backup', async () => {
    const res = await ipc.invoke('tax:save-utah-config', {
      year: 2026,
      config: { sui_rate: 0.02 },
    });
    expect(res.success).toBe(true);
    const row = db
      .getDb()
      .prepare('SELECT sui_rate FROM utah_withholding_config WHERE company_id = ? AND tax_year = ?')
      .get(companyId, 2026) as any;
    expect(row.sui_rate).toBe(0.02);
    expect(scheduleAutoBackup).toHaveBeenCalled();
  });
});
