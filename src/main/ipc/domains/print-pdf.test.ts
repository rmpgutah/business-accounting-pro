import { describe, it, expect, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { createTestDb } from '../../test/createTestDb';
import { createIpcDeps } from '../core/deps';
import { registerPrintPdfIpc } from './print-pdf';
import * as db from '../../database';

// The mock ipcMain exposes invoke/reset, which the real IpcMain type lacks.
const ipc = ipcMain as unknown as {
  invoke(channel: string, ...args: unknown[]): Promise<any>;
  reset(): void;
};

describe('print-pdf domain', () => {
  let companyId: string;

  beforeEach(() => {
    ipc.reset();
    companyId = createTestDb().companyId;
    registerPrintPdfIpc(ipcMain, createIpcDeps());
  });

  it('print:save-pdf resolves without error (mock save dialog is cancelled)', async () => {
    const res = await ipc.invoke('print:save-pdf', { html: '<p>hi</p>', title: 'Smoke' });
    expect(res.error).toBeUndefined();
  });

  it('debt:export-bundle builds the case-file HTML and reaches the save dialog without error', async () => {
    const debt = db.create('debts', {
      company_id: companyId,
      type: 'receivable',
      debtor_name: 'Smoke Debtor',
      original_amount: 100,
      status: 'active',
    });
    const res = await ipc.invoke('debt:export-bundle', { debtId: debt.id });
    expect(res.error).toBeUndefined();
  });
});
