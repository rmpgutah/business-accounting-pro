import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { createTestDb } from '../../test/createTestDb';
import { createIpcDeps } from '../core/deps';
import { registerTreasuryFeaturesFeat } from './treasury-features';

// The mock ipcMain exposes invoke/reset, which the real IpcMain type lacks.
const ipc = ipcMain as unknown as {
  invoke(channel: string, ...args: unknown[]): Promise<any>;
  reset(): void;
};

const MUTATES = [
  'feat:cash-position:capture',
  'feat:cash-forecast:rebuild',
  'feat:fx-rate:upsert',
  'feat:fx-revaluation:run',
  'feat:wire-transfer:upsert',
  'feat:ach-batch:create',
  'feat:ach-batch:mark-submitted',
  'feat:bank-fee-cat:upsert',
  'feat:bank-match:log',
  'feat:stop-payment:upsert',
  'feat:pending-deposit:upsert',
  'feat:petty-cash:log',
  'feat:treasury:upsert',
  'feat:loc:upsert',
  'feat:covenant:upsert',
  'feat:covenant:measure',
  'feat:sweep:upsert',
  'feat:inter-co:record',
  'feat:cc-stmt:upsert',
  'feat:cc-stmt:add-lines',
  'feat:lockbox:import',
  'feat:positive-pay:mark-submitted',
];
const READS = ['feat:cash-position:list', 'feat:cash-forecast:get'];

describe('treasury-features feat table', () => {
  const scheduleAutoBackup = vi.fn();

  beforeEach(() => {
    ipc.reset();
    scheduleAutoBackup.mockClear();
    createTestDb();
    registerTreasuryFeaturesFeat(ipcMain, { ...createIpcDeps(), scheduleAutoBackup });
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
    console.log('treasury-features: mutates=' + MUTATES.length + ' errored=' + errored);
  });

  it('read entries do not throw', async () => {
    for (const channel of READS) {
      await ipc.invoke(channel, {});
      expect(true).toBe(true);
    }
  });
});
