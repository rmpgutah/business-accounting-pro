import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { createTestDb } from '../../test/createTestDb';
import { createIpcDeps } from '../core/deps';
import { registerAccountsGlIpc } from './accounts-gl';
import * as db from '../../database';

// The mock ipcMain exposes invoke/reset, which the real IpcMain type lacks.
const ipc = ipcMain as unknown as {
  invoke(channel: string, ...args: unknown[]): Promise<any>;
  reset(): void;
};

describe('accounts-gl domain', () => {
  const scheduleAutoBackup = vi.fn();
  let companyId: string;

  beforeEach(() => {
    ipc.reset();
    scheduleAutoBackup.mockClear();
    companyId = createTestDb().companyId;
    registerAccountsGlIpc(ipcMain, { ...createIpcDeps(), scheduleAutoBackup });
  });

  it('accounts:stats returns an array', async () => {
    const res = await ipc.invoke('accounts:stats', { companyId });
    expect(Array.isArray(res)).toBe(true);
  });

  it('accounts:set-opening-balance posts a balanced two-line JE and schedules a backup', async () => {
    const acct = db.create('accounts', {
      company_id: companyId,
      code: '1000',
      name: 'Cash',
      type: 'asset',
    });
    const res = await ipc.invoke('accounts:set-opening-balance', {
      companyId,
      accountId: acct.id,
      amount: 250,
      date: '2026-01-01',
    });
    expect(res.error).toBeUndefined();
    expect(res.entry_id).toBeTruthy();
    const lines = db
      .getDb()
      .prepare('SELECT debit, credit FROM journal_entry_lines WHERE journal_entry_id = ?')
      .all(res.entry_id) as Array<{ debit: number; credit: number }>;
    expect(lines).toHaveLength(2);
    expect(lines.reduce((s, l) => s + l.debit, 0)).toBe(lines.reduce((s, l) => s + l.credit, 0));
    expect(scheduleAutoBackup).toHaveBeenCalled();
  });

  it('assets:next-code starts at AST-001 for a company with no assets', async () => {
    expect(await ipc.invoke('assets:next-code')).toBe('AST-001');
  });

  it('assets:delete (hard) removes the asset and schedules a backup', async () => {
    const asset = db.create('fixed_assets', {
      company_id: companyId,
      asset_code: 'AST-001',
      name: 'Laptop',
      purchase_date: '2026-01-01',
      purchase_price: 1000,
    });
    const res = await ipc.invoke('assets:delete', { id: asset.id, hard: true });
    expect(res.error).toBeUndefined();
    expect(res.ok).toBe(true);
    const rows = db.getDb().prepare('SELECT id FROM fixed_assets WHERE id = ?').all(asset.id);
    expect(rows).toHaveLength(0);
    expect(scheduleAutoBackup).toHaveBeenCalled();
  });
});
