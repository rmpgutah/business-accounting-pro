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
});
