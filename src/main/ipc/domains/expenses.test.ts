import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { createTestDb } from '../../test/createTestDb';
import { createIpcDeps } from '../core/deps';
import { registerExpensesIpc } from './expenses';
import * as db from '../../database';

// The mock ipcMain exposes invoke/reset, which the real IpcMain type lacks.
const ipc = ipcMain as unknown as {
  invoke(channel: string, ...args: unknown[]): Promise<any>;
  reset(): void;
};

describe('expenses domain', () => {
  const scheduleAutoBackup = vi.fn();

  beforeEach(() => {
    ipc.reset();
    scheduleAutoBackup.mockClear();
    createTestDb();
    registerExpensesIpc(ipcMain, { ...createIpcDeps(), scheduleAutoBackup });
  });

  it('mileage:list returns an array', async () => {
    const res = await ipc.invoke('mileage:list');
    expect(Array.isArray(res)).toBe(true);
  });

  it('expense:save creates an expense and schedules a backup', async () => {
    const res = await ipc.invoke('expense:save', {
      expenseId: null,
      isEdit: false,
      expenseData: {
        date: '2026-01-15',
        amount: 42.5,
        description: 'Smoke expense',
        status: 'pending',
      },
      lineItems: [],
    });
    expect(res.error).toBeUndefined();
    const rows = db
      .getDb()
      .prepare('SELECT id FROM expenses WHERE description = ?')
      .all('Smoke expense');
    expect(rows).toHaveLength(1);
    expect(scheduleAutoBackup).toHaveBeenCalled();
  });
});
