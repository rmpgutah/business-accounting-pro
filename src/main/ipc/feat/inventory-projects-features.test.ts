import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { createTestDb } from '../../test/createTestDb';
import { createIpcDeps } from '../core/deps';
import { registerInventoryProjectsFeaturesFeat } from './inventory-projects-features';

// The mock ipcMain exposes invoke/reset, which the real IpcMain type lacks.
const ipc = ipcMain as unknown as {
  invoke(channel: string, ...args: unknown[]): Promise<any>;
  reset(): void;
};

const MUTATES = [
  'feat:stock-take:count',
  'feat:warehouse:upsert',
  'feat:location:upsert',
  'feat:lot:upsert',
  'feat:serial:upsert',
  'feat:transfer:create',
  'feat:transfer:ship',
  'feat:transfer:receive',
  'feat:adjustment:create',
  'feat:adjustment:approve',
  'feat:stock-take:start',
  'feat:stock-take:complete',
  'feat:low-stock:scan',
  'feat:low-stock:ack',
  'feat:valuation:set-method',
  'feat:inv-value:capture',
  'feat:task:upsert',
  'feat:task:complete',
  'feat:milestone:upsert',
  'feat:resource:upsert',
  'feat:proj-budget:upsert',
  'feat:risk:upsert',
  'feat:co:upsert',
  'feat:co:approve',
  'feat:timesheet:open',
  'feat:timesheet:submit',
  'feat:timesheet:approve',
  'feat:billable-summary:rebuild',
  'feat:profitability:capture',
];
const READS = ['feat:warehouse:list', 'feat:location:list'];

describe('inventory-projects-features feat table', () => {
  const scheduleAutoBackup = vi.fn();

  beforeEach(() => {
    ipc.reset();
    scheduleAutoBackup.mockClear();
    createTestDb();
    registerInventoryProjectsFeaturesFeat(ipcMain, { ...createIpcDeps(), scheduleAutoBackup });
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
    console.log('inventory-projects-features: mutates=' + MUTATES.length + ' errored=' + errored);
  });

  it('read entries do not throw', async () => {
    for (const channel of READS) {
      await ipc.invoke(channel, {});
      expect(true).toBe(true);
    }
  });
});
