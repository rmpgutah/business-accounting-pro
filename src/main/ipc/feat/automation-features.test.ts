import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { createTestDb } from '../../test/createTestDb';
import { createIpcDeps } from '../core/deps';
import { registerAutomationFeaturesFeat } from './automation-features';

// The mock ipcMain exposes invoke/reset, which the real IpcMain type lacks.
const ipc = ipcMain as unknown as {
  invoke(channel: string, ...args: unknown[]): Promise<any>;
  reset(): void;
};

const MUTATES = [
  'feat:workflow:upsert',
  'feat:workflow:trigger',
  'feat:scheduled-task:upsert',
  'feat:scheduled-task:mark-run',
  'feat:approval-chain:upsert',
  'feat:approval:start',
  'feat:email-template:upsert',
  'feat:webhook:upsert',
  'feat:webhook:record-delivery',
  'feat:auto-archive:run',
  'feat:triggered-action:log',
  'feat:sla:upsert',
  'feat:saved-search:upsert',
  'feat:bulk-op:log',
  'feat:quick-action:upsert',
];
const READS = ['feat:workflow:list', 'feat:scheduled-task:list'];

describe('automation-features feat table', () => {
  const scheduleAutoBackup = vi.fn();

  beforeEach(() => {
    ipc.reset();
    scheduleAutoBackup.mockClear();
    createTestDb();
    registerAutomationFeaturesFeat(ipcMain, { ...createIpcDeps(), scheduleAutoBackup });
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
    console.log('automation-features: mutates=' + MUTATES.length + ' errored=' + errored);
  });

  it('read entries do not throw', async () => {
    for (const channel of READS) {
      await ipc.invoke(channel, {});
      expect(true).toBe(true);
    }
  });
});
