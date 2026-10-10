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

  it('bills:next-number starts at BILL-1001 for a company with no bills', async () => {
    expect(await ipc.invoke('bills:next-number')).toBe('BILL-1001');
  });

  it('po:approve marks the purchase order approved and schedules a backup', async () => {
    const po = db.create('purchase_orders', {
      company_id: db.getCurrentCompanyId(),
      po_number: 'PO-1',
      issue_date: '2026-01-01',
    });
    const res = await ipc.invoke('po:approve', { poId: po.id, approvedBy: 'tester' });
    expect(res).toEqual({ success: true });
    const row = db
      .getDb()
      .prepare('SELECT status FROM purchase_orders WHERE id = ?')
      .get(po.id) as any;
    expect(row.status).toBe('approved');
    expect(scheduleAutoBackup).toHaveBeenCalled();
  });
});
