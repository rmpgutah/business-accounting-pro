import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { createTestDb } from '../../test/createTestDb';
import { createIpcDeps } from '../core/deps';
import { registerInvoicesIpc } from './invoices';
import * as db from '../../database';

// The mock ipcMain exposes invoke/reset, which the real IpcMain type lacks.
const ipc = ipcMain as unknown as {
  invoke(channel: string, ...args: unknown[]): Promise<any>;
  reset(): void;
};

describe('invoices domain', () => {
  const scheduleAutoBackup = vi.fn();
  let companyId: string;

  beforeEach(() => {
    ipc.reset();
    scheduleAutoBackup.mockClear();
    companyId = createTestDb().companyId;
    registerInvoicesIpc(ipcMain, { ...createIpcDeps(), scheduleAutoBackup });
  });

  it('iv:coupons (lazy-required service) returns an array', async () => {
    const res = await ipc.invoke('iv:coupons');
    expect(Array.isArray(res)).toBe(true);
  });

  it('invoice:catalog-list returns without error', async () => {
    const res = await ipc.invoke('invoice:catalog-list');
    expect(res?.error).toBeUndefined();
  });

  it('invoice:save creates an invoice with a line item and schedules a backup', async () => {
    const client = db.create('clients', { company_id: companyId, name: 'Acme' });
    const res = await ipc.invoke('invoice:save', {
      invoiceId: null,
      isEdit: false,
      invoiceData: {
        client_id: client.id,
        invoice_number: 'INV-T-1',
        issue_date: '2026-01-15',
        due_date: '2026-02-15',
        subtotal: 100,
        total: 100,
        status: 'draft',
      },
      lineItems: [{ description: 'Work', quantity: 1, unit_price: 100, amount: 100 }],
    });
    expect(res.error).toBeUndefined();
    const rows = db
      .getDb()
      .prepare('SELECT id FROM invoices WHERE invoice_number = ?')
      .all('INV-T-1');
    expect(rows).toHaveLength(1);
    expect(scheduleAutoBackup).toHaveBeenCalled();
  });

  it('quotes:next-number starts at QT-1001 for a company with no quotes', async () => {
    expect(await ipc.invoke('quotes:next-number')).toBe('QT-1001');
  });

  it('credit-notes:apply applies the credit to the invoice and schedules a backup', async () => {
    const client = db.create('clients', { company_id: companyId, name: 'Acme' });
    const invoice = db.create('invoices', {
      company_id: companyId,
      client_id: client.id,
      invoice_number: 'INV-1',
      issue_date: '2026-01-01',
      due_date: '2026-02-01',
      total: 100,
    });
    const cn = db.create('credit_notes', {
      company_id: companyId,
      client_id: client.id,
      credit_number: 'CN-1',
      issue_date: '2026-01-02',
      total: 40,
    });
    const res = await ipc.invoke('credit-notes:apply', {
      creditNoteId: cn.id,
      invoiceId: invoice.id,
      amount: 40,
    });
    expect(res).toEqual({ applied: 40, invoiceStatus: 'partial', creditNoteStatus: 'applied' });
    const row = db
      .getDb()
      .prepare('SELECT amount_paid FROM invoices WHERE id = ?')
      .get(invoice.id) as any;
    expect(row.amount_paid).toBe(40);
    expect(scheduleAutoBackup).toHaveBeenCalled();
  });
});
