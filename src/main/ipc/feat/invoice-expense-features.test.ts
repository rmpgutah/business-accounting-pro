import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { createTestDb } from '../../test/createTestDb';
import { createIpcDeps } from '../core/deps';
import { registerInvoiceExpenseFeaturesFeat } from './invoice-expense-features';

// The mock ipcMain exposes invoke/reset, which the real IpcMain type lacks.
const ipc = ipcMain as unknown as {
  invoke(channel: string, ...args: unknown[]): Promise<any>;
  reset(): void;
};

const MUTATES = [
  'feat:invoice:late-fee:apply',
  'feat:invoice:reminders:schedule',
  'feat:invoice:reminders:mark-sent',
  'feat:invoice:recalc-payment-state',
  'feat:credit-memo:create',
  'feat:credit-memo:apply',
  'feat:invoice:templates:upsert',
  'feat:invoice:exchange-rate',
  'feat:invoice:deposit',
  'feat:budget-alert:upsert',
  'feat:expense:split:create',
  'feat:reimbursement:create',
  'feat:reimbursement:approve',
  'feat:reimbursement:reject',
  'feat:reimbursement:pay',
  'feat:per-diem:upsert',
];
const READS = ['feat:invoice:late-fee:compute', 'feat:invoice:reminders:pending'];

describe('invoice-expense-features feat table', () => {
  const scheduleAutoBackup = vi.fn();

  beforeEach(() => {
    ipc.reset();
    scheduleAutoBackup.mockClear();
    createTestDb();
    registerInvoiceExpenseFeaturesFeat(ipcMain, { ...createIpcDeps(), scheduleAutoBackup });
  });

  it('every mutating entry schedules a backup once per non-error result', async () => {
    let errored = 0;
    for (const channel of MUTATES) {
      scheduleAutoBackup.mockClear();
      const res = await ipc.invoke(channel, {});
      if (res && typeof res === 'object' && 'error' in res) {
        errored++;
        expect(scheduleAutoBackup, channel).not.toHaveBeenCalled();
      } else {
        expect(scheduleAutoBackup, channel).toHaveBeenCalledTimes(1);
      }
    }
    console.log('invoice-expense-features: mutates=' + MUTATES.length + ' errored=' + errored);
  });

  it('read entries do not throw', async () => {
    for (const channel of READS) {
      await ipc.invoke(channel, {});
      expect(true).toBe(true);
    }
  });
});
