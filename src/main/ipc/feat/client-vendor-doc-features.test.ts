import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { createTestDb } from '../../test/createTestDb';
import { createIpcDeps } from '../core/deps';
import { registerClientVendorDocFeaturesFeat } from './client-vendor-doc-features';

// The mock ipcMain exposes invoke/reset, which the real IpcMain type lacks.
const ipc = ipcMain as unknown as {
  invoke(channel: string, ...args: unknown[]): Promise<any>;
  reset(): void;
};

const MUTATES = [
  'feat:client:merge',
  'feat:tag:add',
  'feat:tag:remove',
  'feat:communication:log',
  'feat:vendor:set-contract',
  'feat:document:set-expiration',
  'feat:document:add-version',
  'feat:document:set-encrypted',
];
const READS = ['feat:client:find-duplicates', 'feat:tag:list-entity'];

describe('client-vendor-doc-features feat table', () => {
  const scheduleAutoBackup = vi.fn();

  beforeEach(() => {
    ipc.reset();
    scheduleAutoBackup.mockClear();
    createTestDb();
    registerClientVendorDocFeaturesFeat(ipcMain, { ...createIpcDeps(), scheduleAutoBackup });
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
    console.log('client-vendor-doc-features: mutates=' + MUTATES.length + ' errored=' + errored);
  });

  it('read entries do not throw', async () => {
    for (const channel of READS) {
      await ipc.invoke(channel, {});
      expect(true).toBe(true);
    }
  });
});
