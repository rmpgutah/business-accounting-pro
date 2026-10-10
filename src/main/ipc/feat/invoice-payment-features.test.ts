import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { createTestDb } from '../../test/createTestDb';
import { createIpcDeps } from '../core/deps';
import {
  registerInvoicePaymentFeaturesFeat,
  INVOICE_PAYMENT_FEAT as TABLE,
} from './invoice-payment-features';
import { readFileSync } from 'fs';
import { join } from 'path';

// The mock ipcMain exposes invoke/reset, which the real IpcMain type lacks.
const ipc = ipcMain as unknown as {
  invoke(channel: string, ...args: unknown[]): Promise<any>;
  reset(): void;
};

const MUTATES = Object.entries(TABLE)
  .filter(([, e]) => e.mutates)
  .map(([ch]) => ch);
const READS = Object.keys(TABLE)
  .filter((ch) => !TABLE[ch].mutates)
  .slice(0, 2);

describe('invoice-payment-features feat table', () => {
  const scheduleAutoBackup = vi.fn();

  beforeEach(() => {
    ipc.reset();
    scheduleAutoBackup.mockClear();
    createTestDb();
    registerInvoicePaymentFeaturesFeat(ipcMain, { ...createIpcDeps(), scheduleAutoBackup });
  });

  it('derived mutates list is non-empty and matches the source count', () => {
    const src = readFileSync(join(__dirname, 'invoice-payment-features.ts'), 'utf8');
    expect(MUTATES.length).toBeGreaterThan(0);
    expect(MUTATES.length).toBe((src.match(/mutates: true/g) ?? []).length);
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
    console.log('invoice-payment-features: mutates=' + MUTATES.length + ' errored=' + errored);
  });

  it('read entries do not throw', async () => {
    for (const channel of READS) {
      // Reads with a `{}` payload may legitimately return { error }; the invoke must still resolve.
      const res = await ipc.invoke(channel, {});
      expect(res, channel).toBeDefined();
    }
  });
});
