import type { IpcMain } from 'electron';
import { v4 as uuid } from 'uuid';
import * as db from '../../database';
import { openPrintPreview } from '../../services/print-preview';
import type { IpcDeps } from '../core/types';
import { syncPush } from '../../sync';
import { SCHEDULE_C_BY_CATEGORY } from '../../services/schedule-c-map';
import { monthlyDepreciation } from '../../services/depreciation';
import { eventBus } from '../../services/EventBus';

// Backfill Schedule C line + deductibility onto EXISTING categories (companies
// seeded before the canonical mapping existed). Matches by exact category name
// and only fills rows whose schedule_c_line is still blank, so it never
// overwrites a value the user set by hand. Idempotent.
function backfillCategoryScheduleC(companyId: string): { updated: number } {
  const dbInstance = db.getDb();
  const upd = dbInstance.prepare(
    `UPDATE categories SET schedule_c_line = ?, is_deductible = ?
       WHERE company_id = ? AND name = ? AND (schedule_c_line IS NULL OR schedule_c_line = '')`,
  );
  let updated = 0;
  const tx = dbInstance.transaction(() => {
    for (const [name, sc] of Object.entries(SCHEDULE_C_BY_CATEGORY)) {
      const r = upd.run(sc.line, sc.deductible ? 1 : 0, companyId, name);
      updated += r.changes;
    }
  });
  tx();
  return { updated };
}

export function registerAccountsGlIpc(ipcMain: IpcMain, deps: IpcDeps): void {
  const {
    scheduleAutoBackup,
    findClosedPeriod,
    localToday,
    postJournalEntry,
    cleanupReferencesBeforeDelete,
    seedDefaultCategories,
  } = deps;

  // One-click month-end close (dry-run preview + real run).
  ipcMain.handle('close:preview-month', (_e, { year, month }: { year: number; month: number }) => {
    try {
      const { getMonthEndPreview } = require('../../services/month-end-close');
      return getMonthEndPreview(db.getCurrentCompanyId(), year, month);
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('close:run-month', (_e, { year, month }: { year: number; month: number }) => {
    try {
      const { runMonthEndClose } = require('../../services/month-end-close');
      const r = runMonthEndClose({
        companyId: db.getCurrentCompanyId(),
        year,
        month,
        dryRun: false,
      });
      try {
        scheduleAutoBackup();
      } catch {
        /* non-fatal */
      }
      return r;
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('period:list', () => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return [];
      return db
        .getDb()
        .prepare('SELECT * FROM closed_periods WHERE company_id = ? ORDER BY period_end DESC')
        .all(cid);
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('period:is-closed', (_event, { date }: { date: string }) => {
    const cid = db.getCurrentCompanyId();
    if (!cid || !date) return { is_closed: false };
    const period = findClosedPeriod(cid, date);
    return { is_closed: !!period, period };
  });

  ipcMain.handle(
    'period:close',
    (
      _event,
      payload: { period_start: string; period_end: string; reason?: string; closed_by?: string },
    ) => {
      try {
        const cid = db.getCurrentCompanyId();
        if (!cid) return { error: 'No active company' };
        if (!payload.period_start || !payload.period_end)
          return { error: 'period_start and period_end are required' };
        if (payload.period_start > payload.period_end)
          return { error: 'period_start must be on or before period_end' };

        // Detect overlap with existing active periods.
        const overlap = db
          .getDb()
          .prepare(
            'SELECT id FROM closed_periods WHERE company_id = ? AND is_active = 1 ' +
              'AND NOT (period_end < ? OR period_start > ?) LIMIT 1',
          )
          .get(cid, payload.period_start, payload.period_end) as any;
        if (overlap) return { error: 'Overlaps with an existing closed period' };

        const r = db.create('closed_periods', {
          company_id: cid,
          period_start: payload.period_start,
          period_end: payload.period_end,
          closed_by: payload.closed_by || '',
          close_reason: payload.reason || '',
        });
        db.logAudit(cid, 'closed_periods', r.id, 'period_close', {
          period_start: payload.period_start,
          period_end: payload.period_end,
          reason: payload.reason || '',
        });
        scheduleAutoBackup();
        return { ok: true, id: r.id };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  ipcMain.handle(
    'period:reopen',
    (_event, payload: { id: string; reason?: string; reopened_by?: string }) => {
      try {
        const cid = db.getCurrentCompanyId();
        if (!cid) return { error: 'No active company' };
        const period = db.getById('closed_periods', payload.id);
        if (!period || period.company_id !== cid) return { error: 'Period not found' };
        if (!period.is_active) return { error: 'Period is already reopened' };
        db.update('closed_periods', payload.id, {
          is_active: 0,
          reopened_at: new Date().toISOString(),
          reopened_by: payload.reopened_by || '',
          reopen_reason: payload.reason || '',
        });
        db.logAudit(cid, 'closed_periods', payload.id, 'period_reopen', {
          reason: payload.reason || '',
        });
        scheduleAutoBackup();
        return { ok: true };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  // ─── Chart of Accounts (CoA) Enhancements ──────────────────────
  ipcMain.handle(
    'accounts:suggest-code',
    (_event, { companyId, type }: { companyId: string; type: string }) => {
      try {
        const ranges: Record<string, [number, number]> = {
          asset: [1000, 1999],
          liability: [2000, 2999],
          equity: [3000, 3999],
          revenue: [4000, 4999],
          expense: [5000, 9999],
        };
        const range = ranges[type] || [1000, 9999];
        const rows = db.runQuery(
          `SELECT code FROM accounts WHERE company_id = ? AND CAST(code AS INTEGER) BETWEEN ? AND ? ORDER BY CAST(code AS INTEGER)`,
          [companyId, range[0], range[1]],
        );
        const used = new Set<number>(
          rows.map((r: any) => parseInt(r.code, 10)).filter((n: number) => !isNaN(n)),
        );
        let candidate = range[0];
        if (used.size > 0) {
          const max = Math.max(...Array.from(used));
          candidate = Math.floor(max / 10) * 10 + 10;
        }
        while (used.has(candidate) && candidate <= range[1]) candidate += 10;
        return { code: String(candidate), range };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  ipcMain.handle(
    'accounts:merge',
    (_event, { sourceId, targetId }: { sourceId: string; targetId: string }) => {
      try {
        const dbi = db.getDb();
        const tx = dbi.transaction(() => {
          dbi
            .prepare('UPDATE journal_entry_lines SET account_id = ? WHERE account_id = ?')
            .run(targetId, sourceId);
          try {
            dbi
              .prepare('UPDATE invoice_line_items SET account_id = ? WHERE account_id = ?')
              .run(targetId, sourceId);
          } catch {}
          try {
            dbi
              .prepare('UPDATE expenses SET account_id = ? WHERE account_id = ?')
              .run(targetId, sourceId);
          } catch {}
          try {
            dbi
              .prepare('UPDATE bills SET account_id = ? WHERE account_id = ?')
              .run(targetId, sourceId);
          } catch {}
          try {
            dbi
              .prepare('UPDATE bill_line_items SET account_id = ? WHERE account_id = ?')
              .run(targetId, sourceId);
          } catch {}
          try {
            dbi
              .prepare('UPDATE bill_payments SET account_id = ? WHERE account_id = ?')
              .run(targetId, sourceId);
          } catch {}
          try {
            dbi
              .prepare('UPDATE expense_line_items SET account_id = ? WHERE account_id = ?')
              .run(targetId, sourceId);
          } catch {}
          try {
            dbi
              .prepare('UPDATE bank_accounts SET account_id = ? WHERE account_id = ?')
              .run(targetId, sourceId);
          } catch {}
          try {
            dbi
              .prepare('UPDATE budget_lines SET account_id = ? WHERE account_id = ?')
              .run(targetId, sourceId);
          } catch {}
          try {
            dbi
              .prepare('UPDATE po_line_items SET account_id = ? WHERE account_id = ?')
              .run(targetId, sourceId);
          } catch {}
          try {
            dbi
              .prepare('UPDATE credit_note_items SET account_id = ? WHERE account_id = ?')
              .run(targetId, sourceId);
          } catch {}
          try {
            dbi
              .prepare('UPDATE accounts SET parent_id = ? WHERE parent_id = ?')
              .run(targetId, sourceId);
          } catch {}
          dbi.prepare('DELETE FROM accounts WHERE id = ?').run(sourceId);
        });
        tx();
        scheduleAutoBackup();
        return { success: true };
      } catch (err: any) {
        return { error: err?.message || String(err) };
      }
    },
  );

  ipcMain.handle(
    'accounts:bulk-toggle-active',
    (_event, { ids, isActive }: { ids: string[]; isActive: boolean }) => {
      try {
        const dbi = db.getDb();
        const stmt = dbi.prepare(
          "UPDATE accounts SET is_active = ?, updated_at = datetime('now') WHERE id = ?",
        );
        const tx = dbi.transaction((rows: string[]) => {
          for (const id of rows) stmt.run(isActive ? 1 : 0, id);
        });
        tx(ids);
        scheduleAutoBackup();
        return { success: true, count: ids.length };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  ipcMain.handle(
    'accounts:set-opening-balance',
    (
      _event,
      {
        companyId,
        accountId,
        amount,
        date,
      }: { companyId: string; accountId: string; amount: number; date: string },
    ) => {
      try {
        const dbi = db.getDb();
        const acct = dbi.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as any;
        if (!acct) return { error: 'Account not found' };
        let obe = dbi
          .prepare(
            "SELECT * FROM accounts WHERE company_id = ? AND name = 'Opening Balance Equity' LIMIT 1",
          )
          .get(companyId) as any;
        if (!obe) {
          obe = db.create('accounts', {
            company_id: companyId,
            code: '3900',
            name: 'Opening Balance Equity',
            type: 'equity',
            subtype: "Owner's Equity",
          });
        }
        const isDebitNormal = ['asset', 'expense'].includes(acct.type);
        const acctDebit = isDebitNormal ? amount : 0;
        const acctCredit = isDebitNormal ? 0 : amount;
        const obeDebit = isDebitNormal ? 0 : amount;
        const obeCredit = isDebitNormal ? amount : 0;
        const entryNumber = `OB-${Date.now()}`;
        const jeId = uuid();
        db.getDb()
          .prepare(
            `
        INSERT INTO journal_entries (id, company_id, entry_number, date, description, is_posted, is_adjusting)
        VALUES (?, ?, ?, ?, ?, 0, 1)
      `,
          )
          .run(jeId, companyId, entryNumber, date, `Opening balance: ${acct.name}`);
        db.create('journal_entry_lines', {
          journal_entry_id: jeId,
          account_id: accountId,
          debit: acctDebit,
          credit: acctCredit,
          description: 'Opening balance',
        });
        db.create('journal_entry_lines', {
          journal_entry_id: jeId,
          account_id: obe.id,
          debit: obeDebit,
          credit: obeCredit,
          description: 'Opening balance offset',
        });
        db.getDb()
          .prepare(
            "UPDATE journal_entries SET is_posted = 1, updated_at = datetime('now') WHERE id = ?",
          )
          .run(jeId);
        scheduleAutoBackup();
        return { success: true, entry_id: jeId };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  ipcMain.handle(
    'accounts:close-to-retained-earnings',
    (_event, { companyId, periodEndDate }: { companyId: string; periodEndDate: string }) => {
      try {
        const dbi = db.getDb();
        let re = dbi
          .prepare(
            "SELECT * FROM accounts WHERE company_id = ? AND name = 'Retained Earnings' LIMIT 1",
          )
          .get(companyId) as any;
        if (!re) {
          re = db.create('accounts', {
            company_id: companyId,
            code: '3200',
            name: 'Retained Earnings',
            type: 'equity',
            subtype: 'Retained Earnings',
          });
        }
        const accts = dbi
          .prepare(
            `SELECT a.id, a.type, a.name, COALESCE((SELECT SUM(jel.debit - jel.credit) FROM journal_entry_lines jel
            JOIN journal_entries je ON jel.journal_entry_id = je.id
            WHERE jel.account_id = a.id AND je.company_id = ? AND date(je.date) <= date(?) /* DATE: Item #7 — wrap for inclusive end-of-day */), 0) as net_dr
          FROM accounts a WHERE a.company_id = ? AND a.type IN ('revenue','expense')`,
          )
          .all(companyId, periodEndDate, companyId) as any[];
        const entryNumber = `CLOSE-${periodEndDate}`;
        const jeId = uuid();
        db.getDb()
          .prepare(
            `
        INSERT INTO journal_entries (id, company_id, entry_number, date, description, is_posted, is_adjusting)
        VALUES (?, ?, ?, ?, ?, 0, 1)
      `,
          )
          .run(
            jeId,
            companyId,
            entryNumber,
            periodEndDate,
            `Year-end closing entries — ${periodEndDate}`,
          );
        let reDr = 0,
          reCr = 0;
        for (const a of accts) {
          const net = Number(a.net_dr) || 0;
          if (Math.abs(net) < 0.005) continue;
          if (net > 0) {
            db.create('journal_entry_lines', {
              journal_entry_id: jeId,
              account_id: a.id,
              debit: 0,
              credit: net,
              description: `Close ${a.name}`,
            });
            reDr += net;
          } else {
            db.create('journal_entry_lines', {
              journal_entry_id: jeId,
              account_id: a.id,
              debit: -net,
              credit: 0,
              description: `Close ${a.name}`,
            });
            reCr += -net;
          }
        }
        const reNet = reCr - reDr;
        if (reNet > 0)
          db.create('journal_entry_lines', {
            journal_entry_id: jeId,
            account_id: re.id,
            debit: 0,
            credit: reNet,
            description: 'Net income to RE',
          });
        else if (reNet < 0)
          db.create('journal_entry_lines', {
            journal_entry_id: jeId,
            account_id: re.id,
            debit: -reNet,
            credit: 0,
            description: 'Net loss to RE',
          });
        db.getDb()
          .prepare(
            "UPDATE journal_entries SET is_posted = 1, updated_at = datetime('now') WHERE id = ?",
          )
          .run(jeId);
        scheduleAutoBackup();
        return { success: true, entry_id: jeId, accounts_closed: accts.length };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  ipcMain.handle('accounts:stats', (_event, { companyId }: { companyId: string }) => {
    try {
      return db.runQuery(
        `SELECT a.id, a.type,
          COALESCE((SELECT SUM(jel.debit - jel.credit) FROM journal_entry_lines jel
            JOIN journal_entries je ON jel.journal_entry_id = je.id
            WHERE jel.account_id = a.id AND je.company_id = ?), 0) as net_dr,
          (SELECT MAX(je.date) FROM journal_entry_lines jel
            JOIN journal_entries je ON jel.journal_entry_id = je.id
            WHERE jel.account_id = a.id AND je.company_id = ?) as last_txn_date,
          (SELECT COUNT(*) FROM journal_entry_lines jel
            JOIN journal_entries je ON jel.journal_entry_id = je.id
            WHERE jel.account_id = a.id AND je.company_id = ? AND je.date >= date('now','-90 days')) as activity_90d
        FROM accounts a WHERE a.company_id = ?`,
        [companyId, companyId, companyId, companyId],
      );
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle(
    'accounts:history-pdf',
    async (_event, { accountId, companyId }: { accountId: string; companyId: string }) => {
      try {
        const acct = db.getById('accounts', accountId);
        if (!acct) return { error: 'Account not found' };
        const lines = db.runQuery(
          `SELECT je.date, je.entry_number, je.description as je_desc, jel.debit, jel.credit, jel.description as line_desc
         FROM journal_entry_lines jel JOIN journal_entries je ON jel.journal_entry_id = je.id
         WHERE jel.account_id = ? AND je.company_id = ? ORDER BY je.date, je.entry_number`,
          [accountId, companyId],
        );
        const company = db.getById('companies', companyId) || {};
        let runningBal = 0;
        const rowHtml = lines
          .map((l: any) => {
            runningBal += (Number(l.debit) || 0) - (Number(l.credit) || 0);
            return `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${l.date}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee">${l.entry_number || ''}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee">${String(l.line_desc || l.je_desc || '').replace(/</g, '&lt;')}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${Number(l.debit || 0).toFixed(2)}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${Number(l.credit || 0).toFixed(2)}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${runningBal.toFixed(2)}</td></tr>`;
          })
          .join('');
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Account History — ${acct.code}</title>
        <style>body{font-family:system-ui,sans-serif;padding:24px;color:#111}h1{font-size:18px;margin:0 0 4px}h2{font-size:13px;color:#666;font-weight:normal;margin:0 0 16px}table{width:100%;border-collapse:collapse;font-size:11px}th{background:#f5f5f5;text-align:left;padding:6px 8px;border-bottom:2px solid #333}</style></head>
        <body><h1>${company.name || ''}</h1><h2>Account History — ${acct.code} ${acct.name}</h2>
        <p style="font-size:11px;color:#555">Type: ${acct.type} • Subtype: ${acct.subtype || '—'} • Generated: ${localToday()}</p>
        <table><thead><tr><th>Date</th><th>Entry #</th><th>Description</th><th style="text-align:right">Debit</th><th style="text-align:right">Credit</th><th style="text-align:right">Balance</th></tr></thead>
        <tbody>${rowHtml || '<tr><td colspan="6" style="padding:16px;text-align:center;color:#888">No transactions</td></tr>'}</tbody></table>
        </body></html>`;
        return await openPrintPreview(html, `Account ${acct.code} History`);
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  ipcMain.handle(
    'accounts:apply-template',
    (
      _event,
      {
        companyId,
        accounts,
      }: {
        companyId: string;
        accounts: Array<{ code: string; name: string; type: string; subtype?: string }>;
      },
    ) => {
      try {
        const dbi = db.getDb();
        const existing = new Set<string>(
          (
            dbi.prepare('SELECT code FROM accounts WHERE company_id = ?').all(companyId) as any[]
          ).map((r) => r.code),
        );
        let created = 0;
        const tx = dbi.transaction(() => {
          for (const a of accounts) {
            if (existing.has(a.code)) continue;
            db.create('accounts', { company_id: companyId, ...a });
            created++;
          }
        });
        tx();
        if (created > 0) scheduleAutoBackup();
        return { success: true, created };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  ipcMain.handle(
    'close:check-date-lock',
    (_e, { companyId, date }: { companyId: string; date: string }) => {
      try {
        const row = db
          .getDb()
          .prepare(
            `SELECT id, period_start, period_end, reason, locked_through_date
         FROM period_locks
         WHERE company_id = ? AND (unlocked_at IS NULL OR unlocked_at = '')
           AND (
             (period_start != '' AND period_end != '' AND ? >= period_start AND ? <= period_end)
             OR (locked_through_date != '' AND ? <= locked_through_date)
           )
         ORDER BY created_at DESC LIMIT 1`,
          )
          .get(companyId, date, date, date) as any;
        return { locked: !!row, lock: row || null };
      } catch (err: any) {
        return { locked: false, error: err?.message };
      }
    },
  );

  ipcMain.handle('close:list-locks', (_e, { companyId }: { companyId: string }) => {
    try {
      return db
        .getDb()
        .prepare(`SELECT * FROM period_locks WHERE company_id = ? ORDER BY created_at DESC`)
        .all(companyId);
    } catch {
      return [];
    }
  });

  ipcMain.handle(
    'close:lock-period',
    (_e, { companyId, periodStart, periodEnd, lockedBy, reason }: any) => {
      try {
        const id = uuid();
        db.getDb()
          .prepare(
            `INSERT INTO period_locks (id, company_id, period_start, period_end, locked_through_date, locked_by, reason, note)
         VALUES (?,?,?,?,?,?,?,?)`,
          )
          .run(
            id,
            companyId,
            periodStart || '',
            periodEnd || '',
            periodEnd || '',
            lockedBy || '',
            reason || '',
            reason || '',
          );
        db.logAudit(companyId, 'period_lock', id, 'create', { periodStart, periodEnd, reason });
        scheduleAutoBackup();
        return { id };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  ipcMain.handle('close:unlock-period', (_e, { lockId, unlockedBy, reason, override }: any) => {
    try {
      const lock = db.getDb().prepare(`SELECT * FROM period_locks WHERE id = ?`).get(lockId) as any;
      if (!lock) return { error: 'Lock not found' };
      db.getDb()
        .prepare(
          `UPDATE period_locks SET unlocked_at = datetime('now'), unlocked_by = ?, unlock_reason = ? WHERE id = ?`,
        )
        .run(unlockedBy || '', reason || '', lockId);
      db.logAudit(lock.company_id, 'period_lock', lockId, override ? 'override' : 'unlock', {
        reason,
        by: unlockedBy,
      });
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle(
    'close:checklist-list',
    (_e, { companyId, periodLabel }: { companyId: string; periodLabel: string }) => {
      try {
        return db
          .getDb()
          .prepare(
            `SELECT * FROM period_close_checklist WHERE company_id = ? AND period_label = ? ORDER BY created_at`,
          )
          .all(companyId, periodLabel);
      } catch {
        return [];
      }
    },
  );

  ipcMain.handle(
    'close:checklist-toggle',
    (_e, { companyId, periodLabel, itemKey, itemLabel, completed, skipped, by, note }: any) => {
      try {
        const existing = db
          .getDb()
          .prepare(
            `SELECT id FROM period_close_checklist WHERE company_id = ? AND period_label = ? AND item_key = ?`,
          )
          .get(companyId, periodLabel, itemKey) as any;
        const now = new Date().toISOString();
        if (existing) {
          db.getDb()
            .prepare(
              `UPDATE period_close_checklist SET completed_at = ?, completed_by = ?, skipped = ?, note = ? WHERE id = ?`,
            )
            .run(completed ? now : '', by || '', skipped ? 1 : 0, note || '', existing.id);
          scheduleAutoBackup();
          return { id: existing.id };
        }
        const id = uuid();
        db.getDb()
          .prepare(
            `INSERT INTO period_close_checklist (id, company_id, period_label, item_key, item_label, completed_at, completed_by, skipped, note)
         VALUES (?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            id,
            companyId,
            periodLabel,
            itemKey,
            itemLabel,
            completed ? now : '',
            by || '',
            skipped ? 1 : 0,
            note || '',
          );
        scheduleAutoBackup();
        return { id };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  function buildClosingPreview(companyId: string, periodStart: string, periodEnd: string) {
    const lines = db
      .getDb()
      .prepare(
        `SELECT a.id AS account_id, a.code, a.name, a.type,
              SUM(COALESCE(jel.debit,0)) AS debit_sum,
              SUM(COALESCE(jel.credit,0)) AS credit_sum
       FROM accounts a
       LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
       LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
         AND je.company_id = ? AND je.is_posted = 1
         AND date(je.date) >= date(?) AND date(je.date) <= date(?) -- DATE: Item #7 — date() wrap so timestamp values match and end-day is inclusive.
       WHERE a.company_id = ? AND a.type IN ('revenue','expense')
       GROUP BY a.id`,
      )
      .all(companyId, periodStart, periodEnd, companyId) as any[];

    const closing: Array<{
      account_id: string;
      code: string;
      name: string;
      type: string;
      debit: number;
      credit: number;
    }> = [];
    let netIncome = 0;
    for (const r of lines) {
      const revBal = (r.credit_sum || 0) - (r.debit_sum || 0);
      const expBal = (r.debit_sum || 0) - (r.credit_sum || 0);
      if (r.type === 'revenue') {
        if (Math.abs(revBal) < 0.005) continue;
        closing.push({
          account_id: r.account_id,
          code: r.code,
          name: r.name,
          type: r.type,
          debit: revBal,
          credit: 0,
        });
        netIncome += revBal;
      } else {
        if (Math.abs(expBal) < 0.005) continue;
        closing.push({
          account_id: r.account_id,
          code: r.code,
          name: r.name,
          type: r.type,
          debit: 0,
          credit: expBal,
        });
        netIncome -= expBal;
      }
    }
    const re = db
      .getDb()
      .prepare(
        `SELECT id, code, name FROM accounts WHERE company_id = ? AND subtype='retained' LIMIT 1`,
      )
      .get(companyId) as any;
    return { lines: closing, netIncome, retainedEarnings: re || null };
  }

  ipcMain.handle('close:closing-preview', (_e, { companyId, periodStart, periodEnd }: any) => {
    try {
      return buildClosingPreview(companyId, periodStart, periodEnd);
    } catch (err: any) {
      return { error: err?.message, lines: [], netIncome: 0, retainedEarnings: null };
    }
  });

  ipcMain.handle(
    'close:closing-commit',
    (_e, { companyId, periodStart, periodEnd, closedBy }: any) => {
      try {
        const preview = buildClosingPreview(companyId, periodStart, periodEnd);
        if (!preview.retainedEarnings) return { error: 'No Retained Earnings account found.' };
        if (!preview.lines.length) return { error: 'No revenue/expense balances to close.' };

        const dbInstance = db.getDb();
        const jeId = uuid();
        const logId = uuid();
        const lockId = uuid();
        const entryNumber = `CLOSE-${periodEnd}`;

        // INTEGRITY: period close writes JE header + JE lines + close_log + period_lock.
        // If any one fails the period would otherwise be left half-closed (orphan
        // JE, missing lock, etc.). Wrap the whole sequence atomically.
        const closeTx = dbInstance.transaction(() => {
          dbInstance
            .prepare(
              `INSERT INTO journal_entries (id, company_id, entry_number, date, description, is_posted, is_closing, posted_by)
           VALUES (?,?,?,?,?,0,1,?)`,
            )
            .run(
              jeId,
              companyId,
              entryNumber,
              periodEnd,
              `Year-end closing entries (${periodStart} to ${periodEnd})`,
              closedBy || '',
            );

          let lineNo = 0;
          for (const l of preview.lines) {
            dbInstance
              .prepare(
                `INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit, credit, description, sort_order)
             VALUES (?,?,?,?,?,?,?)`,
              )
              .run(
                uuid(),
                jeId,
                l.account_id,
                l.debit,
                l.credit,
                `Close ${l.code} ${l.name}`,
                lineNo++,
              );
          }
          const reDebit = preview.netIncome < 0 ? Math.abs(preview.netIncome) : 0;
          const reCredit = preview.netIncome > 0 ? preview.netIncome : 0;
          dbInstance
            .prepare(
              `INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit, credit, description, sort_order)
           VALUES (?,?,?,?,?,?,?)`,
            )
            .run(
              uuid(),
              jeId,
              preview.retainedEarnings.id,
              reDebit,
              reCredit,
              'To Retained Earnings',
              lineNo++,
            );
          dbInstance.prepare('UPDATE journal_entries SET is_posted = 1 WHERE id = ?').run(jeId);

          dbInstance
            .prepare(
              `INSERT INTO period_close_log (id, company_id, period_start, period_end, closed_at, closed_by, closing_je_id, net_income)
           VALUES (?,?,?,?,datetime('now'),?,?,?)`,
            )
            .run(logId, companyId, periodStart, periodEnd, closedBy || '', jeId, preview.netIncome);

          dbInstance
            .prepare(
              `INSERT INTO period_locks (id, company_id, period_start, period_end, locked_through_date, locked_by, reason)
           VALUES (?,?,?,?,?,?,?)`,
            )
            .run(
              lockId,
              companyId,
              periodStart,
              periodEnd,
              periodEnd,
              closedBy || '',
              'Year-end close',
            );
        });
        closeTx();

        db.logAudit(companyId, 'period_close', logId, 'create', {
          periodStart,
          periodEnd,
          netIncome: preview.netIncome,
          jeId,
        });
        scheduleAutoBackup();
        return { ok: true, journalEntryId: jeId, netIncome: preview.netIncome, logId };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  ipcMain.handle('close:log-list', (_e, { companyId }: { companyId: string }) => {
    try {
      return db
        .getDb()
        .prepare(
          `SELECT pcl.*, je.entry_number AS je_number
         FROM period_close_log pcl
         LEFT JOIN journal_entries je ON je.id = pcl.closing_je_id
         WHERE pcl.company_id = ? ORDER BY pcl.closed_at DESC`,
        )
        .all(companyId);
    } catch {
      return [];
    }
  });

  function _glBalanceFor(companyId: string, accountId: string, asOfDate: string): number {
    const r = db
      .getDb()
      .prepare(
        `SELECT SUM(COALESCE(jel.debit,0) - COALESCE(jel.credit,0)) AS bal
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       WHERE jel.account_id = ? AND je.company_id = ? AND je.is_posted = 1 AND date(je.date) <= date(?) /* DATE: Item #7 — wrap for inclusive end-of-day */`,
      )
      .get(accountId, companyId, asOfDate) as any;
    return r?.bal || 0;
  }

  function _subLedgerForAccount(
    companyId: string,
    account: any,
    asOfDate: string,
  ): { total: number; items: any[] } {
    const sub = (account.subtype || '').toLowerCase();
    const name = (account.name || '').toLowerCase();
    if (name.includes('receivable') || sub === 'ar') {
      const items = db
        .getDb()
        .prepare(
          `SELECT id, invoice_number AS reference, date, total - COALESCE(amount_paid,0) AS amount, client_id, status
         FROM invoices WHERE company_id = ? AND date <= ? AND COALESCE(amount_paid,0) < total`,
        )
        .all(companyId, asOfDate) as any[];
      return { total: items.reduce((s, i) => s + (i.amount || 0), 0), items };
    }
    if (name.includes('payable') && !name.includes('payroll') && !name.includes('tax')) {
      try {
        const items = db
          .getDb()
          .prepare(
            `SELECT id, bill_number AS reference, issue_date AS date, total - COALESCE(amount_paid,0) AS amount, vendor_id, status
           FROM bills WHERE company_id = ? AND issue_date <= ? AND COALESCE(amount_paid,0) < total`,
          )
          .all(companyId, asOfDate) as any[];
        return { total: items.reduce((s, i) => s + (i.amount || 0), 0), items };
      } catch {
        return { total: 0, items: [] };
      }
    }
    if (name.includes('inventory') || sub === 'inventory') {
      try {
        const items = db
          .getDb()
          .prepare(
            `SELECT id, sku AS reference, name, quantity AS qty, unit_cost,
                  quantity * unit_cost AS amount FROM inventory_items WHERE company_id = ?`,
          )
          .all(companyId) as any[];
        return { total: items.reduce((s, i) => s + (i.amount || 0), 0), items };
      } catch {
        return { total: 0, items: [] };
      }
    }
    return { total: 0, items: [] };
  }

  ipcMain.handle('recon:compute', (_e, { companyId, accountId, asOfDate }: any) => {
    try {
      const account = db.getById('accounts', accountId);
      if (!account) return { error: 'Account not found' };
      const sub = _subLedgerForAccount(companyId, account, asOfDate);
      const gl = _glBalanceFor(companyId, accountId, asOfDate);
      const glDisplay = account.type === 'liability' ? -gl : gl;
      return {
        account,
        asOfDate,
        sub_ledger_total: sub.total,
        gl_total: glDisplay,
        variance: sub.total - glDisplay,
        sub_ledger_items: sub.items,
      };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('recon:auto-match', (_e, { companyId, accountId, asOfDate }: any) => {
    try {
      const account = db.getById('accounts', accountId);
      if (!account) return { matches: [], suggestions: [] };
      const sub = _subLedgerForAccount(companyId, account, asOfDate);
      const glLines = db
        .getDb()
        .prepare(
          `SELECT jel.id, jel.debit, jel.credit, jel.description, je.entry_number, je.date
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         WHERE jel.account_id = ? AND je.company_id = ? AND je.is_posted = 1 AND date(je.date) <= date(?) /* DATE: Item #7 — wrap for inclusive end-of-day */`,
        )
        .all(accountId, companyId, asOfDate) as any[];

      const matches: any[] = [];
      const suggestions: any[] = [];
      for (const subItem of sub.items) {
        const refMatch = glLines.find(
          (g) =>
            subItem.reference &&
            (g.entry_number === subItem.reference ||
              (g.description || '').includes(subItem.reference)),
        );
        if (refMatch) {
          matches.push({ sub: subItem, gl: refMatch, reason: 'reference' });
          continue;
        }
        const subAmt = Math.abs(subItem.amount || 0);
        const subDate = new Date(subItem.date).getTime();
        const candidate = glLines.find((g) => {
          const glAmt = Math.abs((g.debit || 0) - (g.credit || 0));
          const dayDiff = Math.abs((new Date(g.date).getTime() - subDate) / 86400000);
          return Math.abs(glAmt - subAmt) <= 1 && dayDiff <= 3;
        });
        if (candidate) suggestions.push({ sub: subItem, gl: candidate, reason: 'amount+date' });
      }
      return { matches, suggestions };
    } catch (err: any) {
      return { error: err?.message, matches: [], suggestions: [] };
    }
  });

  ipcMain.handle('recon:save', (_e, data: any) => {
    try {
      const id = uuid();
      db.getDb()
        .prepare(
          `INSERT INTO account_reconciliations
         (id, company_id, account_id, as_of_date, sub_ledger_total, gl_total, variance, reconciled_at, reconciled_by, notes, matches)
         VALUES (?,?,?,?,?,?,?,datetime('now'),?,?,?)`,
        )
        .run(
          id,
          data.companyId,
          data.accountId,
          data.asOfDate,
          data.subLedgerTotal || 0,
          data.glTotal || 0,
          data.variance || 0,
          data.reconciledBy || '',
          data.notes || '',
          JSON.stringify(data.matches || []),
        );
      db.logAudit(data.companyId, 'account_reconciliation', id, 'create', {
        accountId: data.accountId,
        asOfDate: data.asOfDate,
      });
      scheduleAutoBackup();
      return { id };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('recon:history', (_e, { companyId, accountId }: any) => {
    try {
      if (accountId) {
        return db
          .getDb()
          .prepare(
            `SELECT r.*, a.code, a.name FROM account_reconciliations r LEFT JOIN accounts a ON a.id = r.account_id
           WHERE r.company_id = ? AND r.account_id = ? ORDER BY r.as_of_date DESC`,
          )
          .all(companyId, accountId);
      }
      return db
        .getDb()
        .prepare(
          `SELECT r.*, a.code, a.name FROM account_reconciliations r LEFT JOIN accounts a ON a.id = r.account_id
         WHERE r.company_id = ? ORDER BY r.as_of_date DESC`,
        )
        .all(companyId);
    } catch {
      return [];
    }
  });

  ipcMain.handle('recon:intercompany', () => {
    try {
      return db
        .getDb()
        .prepare(
          `SELECT a.company_id, c.name AS company_name, a.id AS account_id, a.code, a.name,
                SUM(COALESCE(jel.debit,0) - COALESCE(jel.credit,0)) AS balance
         FROM accounts a
         LEFT JOIN companies c ON c.id = a.company_id
         LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
         LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.is_posted = 1
         WHERE LOWER(a.name) LIKE '%due to%' OR LOWER(a.name) LIKE '%due from%' OR LOWER(a.name) LIKE '%intercompany%'
         GROUP BY a.id ORDER BY c.name, a.code`,
        )
        .all();
    } catch {
      return [];
    }
  });

  // F8: Detect dormant accounts
  ipcMain.handle(
    'accounts:detect-dormant',
    (_e, { companyId, months }: { companyId: string; months?: number }) => {
      try {
        const m = months || 12;
        const rows = db
          .getDb()
          .prepare(
            `SELECT a.id, a.code, a.name,
          (SELECT MAX(je.date) FROM journal_entry_lines jel
           JOIN journal_entries je ON jel.journal_entry_id = je.id
           WHERE jel.account_id = a.id AND je.company_id = ?) as last_date
         FROM accounts a WHERE a.company_id = ? AND COALESCE(a.deleted_at,'') = '' AND a.is_active = 1`,
          )
          .all(companyId, companyId) as any[];
        const cutoff = new Date();
        cutoff.setMonth(cutoff.getMonth() - m);
        const cutoffStr = cutoff.toISOString().slice(0, 10);
        const dormant = rows.filter((r) => !r.last_date || r.last_date < cutoffStr);
        return { dormant: dormant.map((r) => r.id), details: dormant };
      } catch (err: any) {
        return { error: err?.message, dormant: [] };
      }
    },
  );

  // F11: QuickBooks IIF import (parse !ACCNT lines)
  ipcMain.handle('accounts:parse-iif', (_e, { text }: { text: string }) => {
    try {
      const lines = text.split(/\r?\n/);
      let header: string[] = [];
      const out: Array<{ name: string; type: string; description?: string }> = [];
      const typeMap: Record<string, string> = {
        BANK: 'asset',
        AR: 'asset',
        AP: 'liability',
        OCASSET: 'asset',
        FIXASSET: 'asset',
        OASSET: 'asset',
        CCARD: 'liability',
        OCLIAB: 'liability',
        LTLIAB: 'liability',
        EQUITY: 'equity',
        INC: 'revenue',
        INCOME: 'revenue',
        OINC: 'revenue',
        EXP: 'expense',
        EXPENSE: 'expense',
        OEXP: 'expense',
        COGS: 'expense',
      };
      for (const ln of lines) {
        if (ln.startsWith('!ACCNT')) header = ln.split('\t');
        else if (ln.startsWith('ACCNT') && header.length) {
          const cells = ln.split('\t');
          const get = (k: string) => cells[header.indexOf(k)] || '';
          const name = get('NAME').trim();
          const accntType = get('ACCNTTYPE').trim().toUpperCase();
          if (!name) continue;
          out.push({ name, type: typeMap[accntType] || 'asset', description: get('DESC') });
        }
      }
      return { accounts: out };
    } catch (err: any) {
      return { error: err?.message, accounts: [] };
    }
  });

  // F11/F12: Bulk-create accounts from imported list
  ipcMain.handle(
    'accounts:bulk-create',
    (_e, { companyId, accounts }: { companyId: string; accounts: Array<any> }) => {
      try {
        const dbi = db.getDb();
        const existing = new Set<string>(
          (
            dbi.prepare('SELECT code FROM accounts WHERE company_id = ?').all(companyId) as any[]
          ).map((r) => r.code),
        );
        let created = 0;
        let skipped = 0;
        const tx = dbi.transaction(() => {
          for (const a of accounts) {
            if (!a.code || !a.name) {
              skipped++;
              continue;
            }
            if (existing.has(a.code)) {
              skipped++;
              continue;
            }
            db.create('accounts', {
              company_id: companyId,
              code: a.code,
              name: a.name,
              type: a.type || 'asset',
              subtype: a.subtype || '',
              description: a.description || '',
            });
            existing.add(a.code);
            created++;
          }
        });
        tx();
        if (created > 0) scheduleAutoBackup();
        return { success: true, created, skipped };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  // F13: TurboTax TXF export
  ipcMain.handle(
    'accounts:export-txf',
    (_e, { companyId, year }: { companyId: string; year: number }) => {
      try {
        const dbi = db.getDb();
        const accts = dbi
          .prepare(
            `SELECT a.id, a.code, a.name, a.type, a.tax_line FROM accounts a
         WHERE a.company_id = ? AND a.type IN ('revenue','expense') AND COALESCE(a.tax_line,'') != ''`,
          )
          .all(companyId) as any[];
        const start = `${year}-01-01`,
          end = `${year}-12-31`;
        const lines: string[] = [];
        lines.push(`V042`);
        lines.push(`ABusiness Accounting Pro`);
        lines.push(`D ${localToday().replace(/-/g, '/')}`);
        lines.push(`^`);
        for (const a of accts) {
          const balRow = dbi
            .prepare(
              `SELECT COALESCE(SUM(jel.debit - jel.credit),0) as bal FROM journal_entry_lines jel
           JOIN journal_entries je ON jel.journal_entry_id = je.id
           WHERE jel.account_id = ? AND je.company_id = ? AND date(je.date) >= date(?) AND date(je.date) <= date(?) -- DATE: Item #7 — date() wrap so timestamp values match and end-day is inclusive.`,
            )
            .get(a.id, companyId, start, end) as any;
          const sign = a.type === 'revenue' ? -1 : 1;
          const amt = sign * (Number(balRow?.bal) || 0);
          if (Math.abs(amt) < 0.005) continue;
          lines.push(`TS`);
          lines.push(`N${a.tax_line}`);
          lines.push(`C1`);
          lines.push(`L1`);
          lines.push(`$${amt.toFixed(2)}`);
          lines.push(`X${a.code} ${a.name}`);
          lines.push(`^`);
        }
        return { txf: lines.join('\n'), count: accts.length };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  // F15: Merge preview
  ipcMain.handle('accounts:merge-preview', (_e, { sourceId }: { sourceId: string }) => {
    try {
      const dbi = db.getDb();
      const count = (sql: string) => {
        try {
          const r = dbi.prepare(sql).get(sourceId) as any;
          return Number(r?.c) || 0;
        } catch {
          return 0;
        }
      };
      return {
        journal_lines: count('SELECT COUNT(*) as c FROM journal_entry_lines WHERE account_id = ?'),
        invoice_lines: count('SELECT COUNT(*) as c FROM invoice_line_items WHERE account_id = ?'),
        bills: count('SELECT COUNT(*) as c FROM bills WHERE account_id = ?'),
        expenses: count('SELECT COUNT(*) as c FROM expenses WHERE account_id = ?'),
        children: count('SELECT COUNT(*) as c FROM accounts WHERE parent_id = ?'),
      };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // F16: Account split
  ipcMain.handle(
    'accounts:split',
    (
      _e,
      {
        companyId,
        sourceAccountId,
        targetAccountId,
        dateFrom,
        dateTo,
        descriptionPattern,
      }: {
        companyId: string;
        sourceAccountId: string;
        targetAccountId: string;
        dateFrom: string;
        dateTo: string;
        descriptionPattern: string;
      },
    ) => {
      try {
        const dbi = db.getDb();
        const re = new RegExp(descriptionPattern || '.*', 'i');
        const lines = dbi
          .prepare(
            `SELECT jel.id, jel.description as ldesc, je.description as jdesc
         FROM journal_entry_lines jel JOIN journal_entries je ON jel.journal_entry_id = je.id
         WHERE jel.account_id = ? AND je.company_id = ? AND date(je.date) >= date(?) AND date(je.date) <= date(?) -- DATE: Item #7 — date() wrap so timestamp values match and end-day is inclusive.`,
          )
          .all(sourceAccountId, companyId, dateFrom, dateTo) as any[];
        const matchIds = lines
          .filter((l) => re.test(String(l.ldesc || '')) || re.test(String(l.jdesc || '')))
          .map((l) => l.id);
        const stmt = dbi.prepare('UPDATE journal_entry_lines SET account_id = ? WHERE id = ?');
        const tx = dbi.transaction((ids: string[]) => {
          for (const id of ids) stmt.run(targetAccountId, id);
        });
        tx(matchIds);
        db.logAudit(companyId, 'account', sourceAccountId, 'update', {
          _action: 'split',
          moved: matchIds.length,
          to: targetAccountId,
        });
        if (matchIds.length > 0) scheduleAutoBackup();
        return { success: true, moved: matchIds.length };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  // F17: Renumber with audit
  ipcMain.handle(
    'accounts:renumber',
    (
      _e,
      { companyId, accountId, newCode }: { companyId: string; accountId: string; newCode: string },
    ) => {
      try {
        const dbi = db.getDb();
        const acct = dbi.prepare('SELECT code FROM accounts WHERE id = ?').get(accountId) as any;
        if (!acct) return { error: 'Account not found' };
        dbi
          .prepare("UPDATE accounts SET code = ?, updated_at = datetime('now') WHERE id = ?")
          .run(newCode, accountId);
        db.logAudit(companyId, 'account', accountId, 'update', {
          _action: 'renumber',
          old_code: acct.code,
          new_code: newCode,
        });
        scheduleAutoBackup();
        return { success: true };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  // F18: Soft delete / restore
  ipcMain.handle('accounts:soft-delete', (_e, { accountId }: { accountId: string }) => {
    try {
      db.getDb()
        .prepare("UPDATE accounts SET deleted_at = datetime('now'), is_active = 0 WHERE id = ?")
        .run(accountId);
      scheduleAutoBackup();
      return { success: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('accounts:restore', (_e, { accountId }: { accountId: string }) => {
    try {
      db.getDb()
        .prepare("UPDATE accounts SET deleted_at = '', is_active = 1 WHERE id = ?")
        .run(accountId);
      scheduleAutoBackup();
      return { success: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // F19: Opening balance from prior TB import
  ipcMain.handle(
    'accounts:import-opening-tb',
    (
      _e,
      {
        companyId,
        date,
        rows,
      }: { companyId: string; date: string; rows: Array<{ code: string; balance: number }> },
    ) => {
      try {
        const dbi = db.getDb();
        let obe = dbi
          .prepare(
            "SELECT * FROM accounts WHERE company_id = ? AND name = 'Opening Balance Equity' LIMIT 1",
          )
          .get(companyId) as any;
        if (!obe) {
          obe = db.create('accounts', {
            company_id: companyId,
            code: '3900',
            name: 'Opening Balance Equity',
            type: 'equity',
            subtype: "Owner's Equity",
          });
        }
        const jeId = uuid();
        dbi
          .prepare(
            `
        INSERT INTO journal_entries (id, company_id, entry_number, date, description, is_posted, is_adjusting)
        VALUES (?, ?, ?, ?, ?, 0, 1)
      `,
          )
          .run(jeId, companyId, `OB-TB-${date}`, date, `Opening trial balance import`);
        let totalDr = 0,
          totalCr = 0,
          applied = 0,
          skipped = 0;
        for (const r of rows) {
          const a = dbi
            .prepare('SELECT * FROM accounts WHERE company_id = ? AND code = ?')
            .get(companyId, r.code) as any;
          if (!a) {
            skipped++;
            continue;
          }
          const amt = Number(r.balance) || 0;
          if (Math.abs(amt) < 0.005) continue;
          const isDebitNormal = ['asset', 'expense'].includes(a.type);
          const dr = (isDebitNormal && amt > 0) || (!isDebitNormal && amt < 0) ? Math.abs(amt) : 0;
          const cr = dr > 0 ? 0 : Math.abs(amt);
          db.create('journal_entry_lines', {
            journal_entry_id: jeId,
            account_id: a.id,
            debit: dr,
            credit: cr,
            description: 'Opening TB',
          });
          totalDr += dr;
          totalCr += cr;
          applied++;
        }
        const offset = totalDr - totalCr;
        if (Math.abs(offset) > 0.005) {
          db.create('journal_entry_lines', {
            journal_entry_id: jeId,
            account_id: obe.id,
            debit: offset < 0 ? -offset : 0,
            credit: offset > 0 ? offset : 0,
            description: 'OBE offset',
          });
        }
        dbi
          .prepare(
            "UPDATE journal_entries SET is_posted = 1, updated_at = datetime('now') WHERE id = ?",
          )
          .run(jeId);
        scheduleAutoBackup();
        return { success: true, entry_id: jeId, applied, skipped };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  // F25: Snapshot daily balances
  ipcMain.handle(
    'accounts:snapshot-balances',
    (_e, { companyId, date }: { companyId: string; date?: string }) => {
      try {
        const dbi = db.getDb();
        const d = date || localToday();
        const accts = dbi
          .prepare(
            `SELECT a.id,
          COALESCE((SELECT SUM(jel.debit - jel.credit) FROM journal_entry_lines jel
            JOIN journal_entries je ON jel.journal_entry_id = je.id
            WHERE jel.account_id = a.id AND je.company_id = ? AND date(je.date) <= date(?) /* DATE: Item #7 — wrap for inclusive end-of-day */),0) as bal
         FROM accounts a WHERE a.company_id = ? AND COALESCE(a.deleted_at,'') = ''`,
          )
          .all(companyId, d, companyId) as any[];
        const upsert = dbi.prepare(
          `INSERT INTO account_balance_history (id, date, account_id, balance) VALUES (?, ?, ?, ?)
         ON CONFLICT(date, account_id) DO UPDATE SET balance = excluded.balance`,
        );
        const tx = dbi.transaction(() => {
          for (const a of accts) upsert.run(uuid(), d, a.id, Number(a.bal) || 0);
        });
        tx();
        scheduleAutoBackup();
        return { success: true, count: accts.length, date: d };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  // F23: Natural-side check (warn helper)
  ipcMain.handle(
    'accounts:natural-side-check',
    (_e, { accountId, debit, credit }: { accountId: string; debit: number; credit: number }) => {
      try {
        const a = db
          .getDb()
          .prepare('SELECT type FROM accounts WHERE id = ?')
          .get(accountId) as any;
        if (!a) return { warn: false };
        const isDebitNormal = ['asset', 'expense'].includes(a.type);
        const unusual =
          (isDebitNormal && credit > 0 && debit === 0) ||
          (!isDebitNormal && debit > 0 && credit === 0);
        return { warn: unusual, message: unusual ? `Unusual side for ${a.type} account` : '' };
      } catch (err: any) {
        return { warn: false, error: err?.message };
      }
    },
  );

  // F24: Suggest account from description
  ipcMain.handle(
    'accounts:classify',
    (_e, { companyId, description }: { companyId: string; description: string }) => {
      try {
        const rules = db
          .getDb()
          .prepare(`SELECT pattern, account_id FROM account_classify_rules WHERE company_id = ?`)
          .all(companyId) as any[];
        for (const r of rules) {
          try {
            const re = new RegExp(r.pattern, 'i');
            if (re.test(description || '')) return { account_id: r.account_id, matched: r.pattern };
          } catch {
            /* invalid regex */
          }
        }
        return { account_id: null };
      } catch (err: any) {
        return { error: err?.message, account_id: null };
      }
    },
  );

  // F3: Watchlist threshold check (writes notification rows)
  ipcMain.handle('accounts:watchlist-check', (_e, { companyId }: { companyId: string }) => {
    try {
      const dbi = db.getDb();
      const watches = dbi.prepare('SELECT * FROM account_watches').all() as any[];
      let triggered = 0;
      for (const w of watches) {
        const sumRow = dbi
          .prepare(
            `SELECT COALESCE(SUM(ABS(jel.debit) + ABS(jel.credit)),0) as activity
           FROM journal_entry_lines jel JOIN journal_entries je ON jel.journal_entry_id = je.id
           WHERE jel.account_id = ? AND je.company_id = ? AND je.date >= date('now','-30 days')`,
          )
          .get(w.account_id, companyId) as any;
        const activity = Number(sumRow?.activity) || 0;
        if (w.threshold_amount > 0 && activity > w.threshold_amount) {
          try {
            db.create('notifications', {
              company_id: companyId,
              user_id: w.user_id || '',
              type: 'account_watch',
              message: `Account watch: 30-day activity ${activity.toFixed(2)} exceeds threshold ${Number(w.threshold_amount).toFixed(2)}`,
              entity_type: 'account',
              entity_id: w.account_id,
              is_read: 0,
            });
          } catch {
            /* notifications schema may differ */
          }
          triggered++;
        }
      }
      return { success: true, triggered };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // ─── JE round 2: undo recent N posted entries (creates reversing JEs) ──
  ipcMain.handle(
    'je:undo-recent',
    (_e, { companyId, n, userId }: { companyId: string; n: number; userId: string }) => {
      try {
        const dbInstance = db.getDb();
        const rows = dbInstance
          .prepare(
            `SELECT * FROM journal_entries
         WHERE company_id = ? AND is_posted = 1
           AND (posted_by = ? OR created_by = ?)
         ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC
         LIMIT ?`,
          )
          .all(companyId, userId, userId, Math.max(1, Math.min(n || 1, 50))) as any[];
        let count = 0;
        for (const je of rows) {
          const lines = dbInstance
            .prepare(`SELECT * FROM journal_entry_lines WHERE journal_entry_id = ?`)
            .all(je.id) as any[];
          const newId = uuid();
          const today = localToday();
          const numRow = dbInstance
            .prepare(
              "SELECT entry_number FROM journal_entries WHERE company_id = ? ORDER BY CAST(SUBSTR(entry_number, INSTR(entry_number, '-') + 1) AS INTEGER) DESC LIMIT 1",
            )
            .get(companyId) as any;
          let nextNum = 'JE-1001';
          if (numRow?.entry_number) {
            const m = numRow.entry_number.match(/(\d+)$/);
            if (m)
              nextNum =
                numRow.entry_number.slice(0, -m[1].length) +
                String(parseInt(m[1], 10) + 1).padStart(m[1].length, '0');
          }
          dbInstance
            .prepare(
              `INSERT INTO journal_entries (id, company_id, entry_number, date, description, reference, is_posted, reversed_from_id)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
            )
            .run(
              newId,
              companyId,
              nextNum,
              today,
              `Undo of ${je.entry_number}: ${(je.description || '').slice(0, 200)}`,
              je.reference || '',
              je.id,
            );
          for (let i = 0; i < lines.length; i++) {
            const l = lines[i];
            dbInstance
              .prepare(
                `INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit, credit, description, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
              )
              .run(
                uuid(),
                newId,
                l.account_id,
                l.credit || 0,
                l.debit || 0,
                l.description || '',
                i,
              );
          }
          dbInstance.prepare('UPDATE journal_entries SET is_posted = 1 WHERE id = ?').run(newId);
          count++;
        }
        if (count > 0) scheduleAutoBackup();
        return { count };
      } catch (err: any) {
        return { error: err?.message || 'undo failed' };
      }
    },
  );

  // ─── JE round 2: detect gaps in entry_number sequence ──
  ipcMain.handle('je:gap-detect', (_e, { companyId }: { companyId: string }) => {
    try {
      const rows = db
        .getDb()
        .prepare(
          `SELECT entry_number FROM journal_entries WHERE company_id = ? ORDER BY entry_number ASC`,
        )
        .all(companyId) as any[];
      const byPrefix: Record<string, Array<{ n: number; padLen: number }>> = {};
      for (const r of rows) {
        const m = (r.entry_number || '').match(/^(.*?)(\d+)$/);
        if (m) (byPrefix[m[1]] ||= []).push({ n: parseInt(m[2], 10), padLen: m[2].length });
      }
      const gaps: string[] = [];
      for (const [prefix, arr] of Object.entries(byPrefix)) {
        arr.sort((a, b) => a.n - b.n);
        for (let i = 1; i < arr.length; i++) {
          for (let g = arr[i - 1].n + 1; g < arr[i].n; g++) {
            gaps.push(`${prefix}${String(g).padStart(arr[i].padLen, '0')}`);
            if (gaps.length >= 25) return { gaps };
          }
        }
      }
      return { gaps };
    } catch (err: any) {
      return { gaps: [], error: err?.message };
    }
  });

  // ─── JE round 2: snapshot a JE into je_history before edits ──
  ipcMain.handle('je:snapshot', (_e, { jeId, userId }: { jeId: string; userId: string }) => {
    try {
      const dbi = db.getDb();
      const je = dbi.prepare(`SELECT * FROM journal_entries WHERE id = ?`).get(jeId) as any;
      if (!je) return { error: 'not found' };
      const lines = dbi
        .prepare(`SELECT * FROM journal_entry_lines WHERE journal_entry_id = ? ORDER BY sort_order`)
        .all(jeId) as any[];
      const version = (je.version ?? 1) as number;
      dbi
        .prepare(
          `INSERT INTO je_history (id, je_id, version, snapshot_json, changed_by) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(uuid(), jeId, version, JSON.stringify({ entry: je, lines }), userId || '');
      dbi.prepare(`UPDATE journal_entries SET version = ? WHERE id = ?`).run(version + 1, jeId);
      scheduleAutoBackup();
      return { ok: true, version };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('je:history-list', (_e, { jeId }: { jeId: string }) => {
    try {
      return db
        .getDb()
        .prepare(
          `SELECT id, version, changed_at, changed_by FROM je_history WHERE je_id = ? ORDER BY version DESC`,
        )
        .all(jeId);
    } catch {
      return [];
    }
  });

  ipcMain.handle(
    'je:history-rollback',
    (_e, { historyId, userId }: { historyId: string; userId: string }) => {
      try {
        const dbi = db.getDb();
        const h = dbi.prepare(`SELECT * FROM je_history WHERE id = ?`).get(historyId) as any;
        if (!h) return { error: 'not found' };
        const snap = JSON.parse(h.snapshot_json || '{}');
        if (!snap?.entry) return { error: 'bad snapshot' };
        const e = snap.entry;
        const cur = dbi.prepare(`SELECT * FROM journal_entries WHERE id = ?`).get(h.je_id) as any;
        if (cur) {
          const curLines = dbi
            .prepare(
              `SELECT * FROM journal_entry_lines WHERE journal_entry_id = ? ORDER BY sort_order`,
            )
            .all(h.je_id) as any[];
          dbi
            .prepare(
              `INSERT INTO je_history (id, je_id, version, snapshot_json, changed_by) VALUES (?, ?, ?, ?, ?)`,
            )
            .run(
              uuid(),
              h.je_id,
              cur.version ?? 1,
              JSON.stringify({ entry: cur, lines: curLines }),
              userId || '',
            );
        }
        dbi
          .prepare(
            `UPDATE journal_entries SET date=?, description=?, reference=?, class=?, version = COALESCE(version,1)+1 WHERE id=?`,
          )
          .run(e.date, e.description || '', e.reference || '', e.class || '', h.je_id);
        dbi.prepare(`DELETE FROM journal_entry_lines WHERE journal_entry_id = ?`).run(h.je_id);
        const lines = Array.isArray(snap.lines) ? snap.lines : [];
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          dbi
            .prepare(
              `INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit, credit, description, sort_order, line_memo)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              uuid(),
              h.je_id,
              l.account_id,
              l.debit || 0,
              l.credit || 0,
              l.description || '',
              i,
              l.line_memo || '',
            );
        }
        scheduleAutoBackup();
        return { ok: true };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  // 1. Soft vs hard lock — supersede check-date-lock
  ipcMain.handle(
    'close:check-date-lock-v2',
    (_e, { companyId, date }: { companyId: string; date: string }) => {
      try {
        const row = db
          .getDb()
          .prepare(
            `SELECT id, period_start, period_end, reason, locked_through_date, COALESCE(lock_level, 'hard') AS lock_level
         FROM period_locks
         WHERE company_id = ? AND (unlocked_at IS NULL OR unlocked_at = '')
           AND ((period_start != '' AND period_end != '' AND ? >= period_start AND ? <= period_end)
                OR (locked_through_date != '' AND ? <= locked_through_date))
         ORDER BY created_at DESC LIMIT 1`,
          )
          .get(companyId, date, date, date) as any;
        if (!row) return { locked: false, level: 'none', lock: null };
        return {
          locked: row.lock_level === 'hard',
          warn: row.lock_level === 'soft',
          level: row.lock_level,
          lock: row,
        };
      } catch (err: any) {
        return { locked: false, error: err?.message };
      }
    },
  );

  ipcMain.handle(
    'close:lock-period-v2',
    (_e, { companyId, periodStart, periodEnd, lockedBy, reason, lockLevel }: any) => {
      try {
        const id = uuid();
        db.getDb()
          .prepare(
            `INSERT INTO period_locks (id, company_id, period_start, period_end, locked_through_date, locked_by, reason, note, lock_level)
         VALUES (?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            id,
            companyId,
            periodStart || '',
            periodEnd || '',
            periodEnd || '',
            lockedBy || '',
            reason || '',
            reason || '',
            lockLevel === 'soft' ? 'soft' : 'hard',
          );
        db.logAudit(companyId, 'period_lock', id, 'create', {
          periodStart,
          periodEnd,
          reason,
          lockLevel,
        });
        scheduleAutoBackup();
        return { id };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  // 2. Pre-close report bundle
  ipcMain.handle('close:pre-close-bundle', (_e, { companyId, periodStart, periodEnd }: any) => {
    try {
      const tb = db
        .getDb()
        .prepare(
          `SELECT a.code, a.name, a.type,
                SUM(COALESCE(jel.debit,0)) AS debit_sum,
                SUM(COALESCE(jel.credit,0)) AS credit_sum
         FROM accounts a
         LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
         LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
           AND je.company_id = ? AND je.is_posted = 1 AND date(je.date) >= date(?) AND date(je.date) <= date(?) -- DATE: Item #7 — date() wrap so timestamp values match and end-day is inclusive.
         WHERE a.company_id = ?
         GROUP BY a.id ORDER BY a.code`,
        )
        .all(companyId, periodStart, periodEnd, companyId);
      const recons = db
        .getDb()
        .prepare(
          `SELECT r.*, a.code, a.name FROM account_reconciliations r
         LEFT JOIN accounts a ON a.id = r.account_id
         WHERE r.company_id = ? AND r.as_of_date <= ? ORDER BY r.as_of_date DESC LIMIT 50`,
        )
        .all(companyId, periodEnd);
      let openBills: any[] = [];
      try {
        openBills = db
          .getDb()
          .prepare(
            `SELECT bill_number, issue_date AS date, total - COALESCE(amount_paid,0) AS open_amount, status
           FROM bills WHERE company_id = ? AND COALESCE(amount_paid,0) < total AND issue_date <= ?`,
          )
          .all(companyId, periodEnd) as any[];
      } catch {
        /* table may not exist */
      }
      const openInvoices = db
        .getDb()
        .prepare(
          `SELECT invoice_number, date, total - COALESCE(amount_paid,0) AS open_amount, status
         FROM invoices WHERE company_id = ? AND COALESCE(amount_paid,0) < total AND date <= ?`,
        )
        .all(companyId, periodEnd);
      return { tb, recons, openBills, openInvoices };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // 3. Adjustment categorization breakdown
  ipcMain.handle('close:adjustment-breakdown', (_e, { companyId, periodStart, periodEnd }: any) => {
    try {
      return db
        .getDb()
        .prepare(
          `SELECT COALESCE(NULLIF(adjustment_category,''),'uncategorized') AS category,
                COUNT(*) AS count,
                SUM((SELECT SUM(COALESCE(debit,0)) FROM journal_entry_lines WHERE journal_entry_id = je.id)) AS total_debit
         FROM journal_entries je
         WHERE company_id = ? AND is_posted = 1 AND date >= ? AND date <= ?
         GROUP BY category ORDER BY total_debit DESC`,
        )
        .all(companyId, periodStart, periodEnd);
    } catch {
      return [];
    }
  });

  // 4. Email digest
  ipcMain.handle('close:email-digest', (_e, { companyId, logId }: any) => {
    try {
      const log = db
        .getDb()
        .prepare(`SELECT * FROM period_close_log WHERE id = ?`)
        .get(logId) as any;
      if (!log) return { error: 'close log not found' };
      const ps = log.period_start;
      const pe = log.period_end;
      const totals = db
        .getDb()
        .prepare(
          `SELECT a.type, SUM(COALESCE(jel.credit,0) - COALESCE(jel.debit,0)) AS net
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         JOIN accounts a ON a.id = jel.account_id
         WHERE je.company_id = ? AND je.is_posted = 1 AND date(je.date) >= date(?) AND date(je.date) <= date(?) -- DATE: Item #7 — date() wrap so timestamp values match and end-day is inclusive.
           AND a.type IN ('revenue','expense')
         GROUP BY a.type`,
        )
        .all(companyId, ps, pe) as any[];
      const rev = totals.find((t) => t.type === 'revenue')?.net || 0;
      const exp = -(totals.find((t) => t.type === 'expense')?.net || 0);
      const jeCount =
        (
          db
            .getDb()
            .prepare(
              `SELECT COUNT(*) AS c FROM journal_entries WHERE company_id = ? AND is_posted = 1 AND date >= ? AND date <= ?`,
            )
            .get(companyId, ps, pe) as any
        )?.c || 0;
      const recipients =
        (
          db
            .getDb()
            .prepare(`SELECT value FROM settings WHERE key = 'period_close_notify_emails'`)
            .get() as any
        )?.value || '';
      const html = `<h1>Period Close Digest: ${ps} → ${pe}</h1>
        <ul>
          <li>Revenue: ${rev.toFixed(2)}</li>
          <li>Expense: ${exp.toFixed(2)}</li>
          <li>Net income: ${(rev - exp).toFixed(2)}</li>
          <li>Posted JEs: ${jeCount}</li>
          <li>Closed by: ${log.closed_by}</li>
        </ul>
        <p>Recipients: ${recipients}</p>`;
      db.getDb()
        .prepare(`UPDATE period_close_log SET digest_html = ? WHERE id = ?`)
        .run(html, logId);
      return {
        html,
        recipients,
        totals: { revenue: rev, expense: exp, netIncome: rev - exp, jeCount },
      };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // 5. Period roll-forward (idempotent)
  ipcMain.handle('close:roll-forward', (_e, { companyId, logId }: any) => {
    try {
      const log = db
        .getDb()
        .prepare(`SELECT * FROM period_close_log WHERE id = ?`)
        .get(logId) as any;
      if (!log) return { error: 'log not found' };
      if (log.roll_forward_done) return { ok: true, alreadyDone: true };
      const balances = db
        .getDb()
        .prepare(
          `SELECT a.id AS account_id,
                SUM(COALESCE(jel.debit,0) - COALESCE(jel.credit,0)) AS balance
         FROM accounts a
         LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
         LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
           AND je.company_id = ? AND je.is_posted = 1 AND date(je.date) <= date(?) /* DATE: Item #7 — wrap for inclusive end-of-day */
         WHERE a.company_id = ? GROUP BY a.id`,
        )
        .all(companyId, log.period_end, companyId) as any[];
      let count = 0;
      for (const b of balances) {
        if (Math.abs(b.balance || 0) < 0.005) continue;
        try {
          db.getDb()
            .prepare(
              `INSERT INTO account_balance_history (id, company_id, account_id, as_of_date, balance, source)
             VALUES (?,?,?,?,?,?)`,
            )
            .run(uuid(), companyId, b.account_id, log.period_end, b.balance, 'period_roll_forward');
          count++;
        } catch {
          /* table may not exist */
        }
      }
      db.getDb()
        .prepare(`UPDATE period_close_log SET roll_forward_done = 1 WHERE id = ?`)
        .run(logId);
      scheduleAutoBackup();
      return { ok: true, snapshotCount: count };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // 6. Reopen preview / commit
  ipcMain.handle('close:reopen-preview', (_e, { logId }: any) => {
    try {
      const log = db
        .getDb()
        .prepare(`SELECT * FROM period_close_log WHERE id = ?`)
        .get(logId) as any;
      if (!log) return { error: 'log not found' };
      const closingJe = log.closing_je_id
        ? db
            .getDb()
            .prepare(
              `SELECT je.id, je.entry_number, je.date,
                (SELECT SUM(COALESCE(debit,0)) FROM journal_entry_lines WHERE journal_entry_id = je.id) AS total
         FROM journal_entries je WHERE je.id = ?`,
            )
            .get(log.closing_je_id)
        : null;
      return { log, closingJe };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('close:reopen-commit', (_e, { logId, reopenedBy, reason }: any) => {
    try {
      const log = db
        .getDb()
        .prepare(`SELECT * FROM period_close_log WHERE id = ?`)
        .get(logId) as any;
      if (!log) return { error: 'log not found' };
      if (log.closing_je_id) {
        const lines = db
          .getDb()
          .prepare(`SELECT * FROM journal_entry_lines WHERE journal_entry_id = ?`)
          .all(log.closing_je_id) as any[];
        if (lines.length) {
          const newId = uuid();
          db.getDb()
            .prepare(
              `INSERT INTO journal_entries (id, company_id, entry_number, date, description, is_posted, is_closing, posted_by, reversed_from_id)
             VALUES (?,?,?,?,?,0,1,?,?)`,
            )
            .run(
              newId,
              log.company_id,
              `REOPEN-${log.period_end}`,
              log.period_end,
              `Reverse closing entry (period reopen: ${reason || ''})`,
              reopenedBy || '',
              log.closing_je_id,
            );
          let lineNo = 0;
          for (const l of lines) {
            db.getDb()
              .prepare(
                `INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit, credit, description, sort_order)
               VALUES (?,?,?,?,?,?,?)`,
              )
              .run(
                uuid(),
                newId,
                l.account_id,
                l.credit || 0,
                l.debit || 0,
                `Reverse: ${l.description || ''}`,
                lineNo++,
              );
          }
          db.getDb().prepare('UPDATE journal_entries SET is_posted = 1 WHERE id = ?').run(newId);
        }
      }
      db.getDb()
        .prepare(
          `UPDATE period_locks SET unlocked_at = datetime('now'), unlocked_by = ?, unlock_reason = ?
         WHERE company_id = ? AND period_start = ? AND period_end = ? AND (unlocked_at IS NULL OR unlocked_at = '')`,
        )
        .run(
          reopenedBy || '',
          reason || 'period reopen',
          log.company_id,
          log.period_start,
          log.period_end,
        );
      db.getDb()
        .prepare(
          `UPDATE period_close_log SET reopened_at = datetime('now'), reopened_by = ? WHERE id = ?`,
        )
        .run(reopenedBy || '', logId);
      db.logAudit(log.company_id, 'period_close', logId, 'reopen', { reason, reopenedBy });
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // 8. Short-period close
  ipcMain.handle(
    'close:short-period-commit',
    (_e, { companyId, periodStart, periodEnd, closedBy, reason }: any) => {
      try {
        const lockId = uuid();
        db.getDb()
          .prepare(
            `INSERT INTO period_locks (id, company_id, period_start, period_end, locked_through_date, locked_by, reason, lock_level)
         VALUES (?,?,?,?,?,?,?,?)`,
          )
          .run(
            lockId,
            companyId,
            periodStart,
            periodEnd,
            periodEnd,
            closedBy || '',
            reason || `Short-period close ${periodStart} → ${periodEnd}`,
            'hard',
          );
        const logId = uuid();
        db.getDb()
          .prepare(
            `INSERT INTO period_close_log (id, company_id, period_start, period_end, closed_at, closed_by, net_income, is_short_period)
         VALUES (?,?,?,?,datetime('now'),?,0,1)`,
          )
          .run(logId, companyId, periodStart, periodEnd, closedBy || '');
        db.logAudit(companyId, 'period_close', logId, 'short_period_close', {
          periodStart,
          periodEnd,
          reason,
        });
        scheduleAutoBackup();
        return { ok: true, logId };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  // 9 & 10. Cycle dashboard / heat map
  ipcMain.handle('close:cycle-dashboard', (_e, { companyId }: any) => {
    try {
      const closes = db
        .getDb()
        .prepare(
          `SELECT period_start, period_end, closed_at, closed_by, net_income, is_short_period, reopened_at
         FROM period_close_log WHERE company_id = ? ORDER BY period_end DESC LIMIT 36`,
        )
        .all(companyId) as any[];
      const locks = db
        .getDb()
        .prepare(
          `SELECT period_start, period_end, locked_through_date, COALESCE(lock_level,'hard') AS lock_level, unlocked_at
         FROM period_locks WHERE company_id = ? ORDER BY created_at DESC LIMIT 60`,
        )
        .all(companyId) as any[];
      const checklists = db
        .getDb()
        .prepare(
          `SELECT period_label, COUNT(*) AS total, SUM(CASE WHEN completed_at != '' THEN 1 ELSE 0 END) AS done
         FROM period_close_checklist WHERE company_id = ? GROUP BY period_label`,
        )
        .all(companyId) as any[];
      return { closes, locks, checklists };
    } catch (err: any) {
      return { error: err?.message, closes: [], locks: [], checklists: [] };
    }
  });

  // 11. Recon items
  ipcMain.handle('recon:items-list', (_e, { companyId, accountId, asOfDate }: any) => {
    try {
      return db
        .getDb()
        .prepare(
          `SELECT * FROM account_reconciliation_items
         WHERE company_id = ? AND account_id = ? AND as_of_date = ? ORDER BY created_at`,
        )
        .all(companyId, accountId, asOfDate);
    } catch {
      return [];
    }
  });

  ipcMain.handle('recon:item-save', (_e, payload: any) => {
    try {
      const id = payload.id || uuid();
      const existing = payload.id
        ? db.getDb().prepare(`SELECT id FROM account_reconciliation_items WHERE id = ?`).get(id)
        : null;
      if (existing) {
        db.getDb()
          .prepare(
            `UPDATE account_reconciliation_items SET note = ?, status = ?, updated_at = datetime('now') WHERE id = ?`,
          )
          .run(payload.note || '', payload.status || 'open', id);
      } else {
        db.getDb()
          .prepare(
            `INSERT INTO account_reconciliation_items
           (id, company_id, account_id, as_of_date, transaction_id, transaction_kind, reference, amount, note, status, confidence, delta, rolled_from_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            id,
            payload.companyId,
            payload.accountId,
            payload.asOfDate || '',
            payload.transactionId || '',
            payload.transactionKind || '',
            payload.reference || '',
            payload.amount || 0,
            payload.note || '',
            payload.status || 'open',
            payload.confidence || 0,
            payload.delta || 0,
            payload.rolledFromId || '',
          );
      }
      scheduleAutoBackup();
      return { id };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // 12 & 20. Auto-match v2 with confidence stars + delta
  ipcMain.handle('recon:auto-match-v2', (_e, { companyId, accountId, asOfDate }: any) => {
    try {
      const account = db.getById('accounts', accountId);
      if (!account) return { matches: [], suggestions: [] };
      const subRes = db
        .getDb()
        .prepare(
          `SELECT id, invoice_number AS reference, date, total - COALESCE(amount_paid,0) AS amount
         FROM invoices WHERE company_id = ? AND date <= ? AND COALESCE(amount_paid,0) < total`,
        )
        .all(companyId, asOfDate) as any[];
      const glLines = db
        .getDb()
        .prepare(
          `SELECT jel.id, jel.debit, jel.credit, jel.description, je.entry_number, je.date
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         WHERE jel.account_id = ? AND je.company_id = ? AND je.is_posted = 1 AND date(je.date) <= date(?) /* DATE: Item #7 — wrap for inclusive end-of-day */`,
        )
        .all(accountId, companyId, asOfDate) as any[];

      const matches: any[] = [];
      const suggestions: any[] = [];
      for (const subItem of subRes) {
        const subAmt = Math.abs(subItem.amount || 0);
        const subDate = new Date(subItem.date).getTime();
        let bestG: any = null;
        let bestStars = 0;
        let bestReason = '';
        for (const g of glLines) {
          const glAmt = Math.abs((g.debit || 0) - (g.credit || 0));
          const exact = Math.abs(glAmt - subAmt) < 0.01;
          const close = Math.abs(glAmt - subAmt) <= 1;
          const dayDiff = Math.abs((new Date(g.date).getTime() - subDate) / 86400000);
          const refMatch =
            subItem.reference &&
            (g.entry_number === subItem.reference ||
              (g.description || '').includes(subItem.reference));
          let stars = 0;
          const reasons: string[] = [];
          if (exact) {
            stars += 2;
            reasons.push('amount-exact');
          } else if (close) {
            stars += 1;
            reasons.push('amount-close');
          }
          if (dayDiff <= 1) {
            stars += 2;
            reasons.push('date-1d');
          } else if (dayDiff <= 7) {
            stars += 1;
            reasons.push('date-7d');
          }
          if (refMatch) {
            stars += 1;
            reasons.push('reference');
          }
          if (stars > bestStars) {
            bestStars = stars;
            bestG = g;
            bestReason = reasons.join('+');
          }
        }
        if (bestG && bestStars >= 4) {
          const glAmt = Math.abs((bestG.debit || 0) - (bestG.credit || 0));
          matches.push({
            sub: subItem,
            gl: bestG,
            reason: bestReason,
            confidence: Math.min(5, bestStars),
            delta: glAmt - subAmt,
          });
        } else if (bestG && bestStars >= 2) {
          const glAmt = Math.abs((bestG.debit || 0) - (bestG.credit || 0));
          suggestions.push({
            sub: subItem,
            gl: bestG,
            reason: bestReason,
            confidence: Math.min(5, bestStars),
            delta: glAmt - subAmt,
          });
        }
      }
      return { matches, suggestions };
    } catch (err: any) {
      return { error: err?.message, matches: [], suggestions: [] };
    }
  });

  // 13. Import statement
  ipcMain.handle(
    'recon:import-statement',
    (_e, { companyId, accountId, asOfDate, statementBalance, rows, importedBy }: any) => {
      try {
        const id = uuid();
        db.getDb()
          .prepare(
            `INSERT INTO recon_imports (id, company_id, account_id, as_of_date, statement_balance, rows_json, imported_by)
         VALUES (?,?,?,?,?,?,?)`,
          )
          .run(
            id,
            companyId,
            accountId,
            asOfDate || '',
            statementBalance || 0,
            JSON.stringify(rows || []),
            importedBy || '',
          );
        scheduleAutoBackup();
        return { id };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  ipcMain.handle('recon:imports-list', (_e, { companyId, accountId }: any) => {
    try {
      return db
        .getDb()
        .prepare(
          `SELECT * FROM recon_imports WHERE company_id = ? AND account_id = ? ORDER BY imported_at DESC`,
        )
        .all(companyId, accountId);
    } catch {
      return [];
    }
  });

  // 15. Multi-account recon
  ipcMain.handle('recon:multi-compute', (_e, { companyId, asOfDate }: any) => {
    try {
      const accounts = db
        .getDb()
        .prepare(
          `SELECT id, code, name, type, subtype FROM accounts WHERE company_id = ?
         AND (LOWER(name) LIKE '%receivable%' OR LOWER(name) LIKE '%payable%' OR LOWER(name) LIKE '%inventory%')
         ORDER BY code`,
        )
        .all(companyId) as any[];
      return accounts.map((a) => {
        const gl = db
          .getDb()
          .prepare(
            `SELECT SUM(COALESCE(jel.debit,0) - COALESCE(jel.credit,0)) AS bal
           FROM journal_entry_lines jel
           JOIN journal_entries je ON je.id = jel.journal_entry_id
           WHERE jel.account_id = ? AND je.company_id = ? AND je.is_posted = 1 AND date(je.date) <= date(?) /* DATE: Item #7 — wrap for inclusive end-of-day */`,
          )
          .get(a.id, companyId, asOfDate) as any;
        const glBal = a.type === 'liability' ? -(gl?.bal || 0) : gl?.bal || 0;
        let subTotal = 0;
        const n = (a.name || '').toLowerCase();
        if (n.includes('receivable')) {
          const r = db
            .getDb()
            .prepare(
              `SELECT SUM(total - COALESCE(amount_paid,0)) AS s FROM invoices WHERE company_id = ? AND date <= ? AND COALESCE(amount_paid,0) < total`,
            )
            .get(companyId, asOfDate) as any;
          subTotal = r?.s || 0;
        } else if (n.includes('payable')) {
          try {
            const r = db
              .getDb()
              .prepare(
                `SELECT SUM(total - COALESCE(amount_paid,0)) AS s FROM bills WHERE company_id = ? AND issue_date <= ? AND COALESCE(amount_paid,0) < total`,
              )
              .get(companyId, asOfDate) as any;
            subTotal = r?.s || 0;
          } catch {
            /* */
          }
        }
        return {
          account_id: a.id,
          code: a.code,
          name: a.name,
          gl: glBal,
          sub: subTotal,
          variance: subTotal - glBal,
        };
      });
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // 16. Recon schedule
  ipcMain.handle('recon:schedule-list', (_e, { companyId }: any) => {
    try {
      return db
        .getDb()
        .prepare(
          `SELECT s.*, a.code, a.name FROM recon_schedule s
         LEFT JOIN accounts a ON a.id = s.account_id
         WHERE s.company_id = ? ORDER BY s.next_due`,
        )
        .all(companyId);
    } catch {
      return [];
    }
  });

  ipcMain.handle('recon:schedule-save', (_e, data: any) => {
    try {
      const id = data.id || uuid();
      const existing = data.id
        ? db.getDb().prepare(`SELECT id FROM recon_schedule WHERE id = ?`).get(id)
        : null;
      const today = new Date();
      const next = new Date(today);
      const f = data.frequency || 'monthly';
      if (f === 'weekly') next.setDate(next.getDate() + 7);
      else if (f === 'quarterly') next.setMonth(next.getMonth() + 3);
      else next.setMonth(next.getMonth() + 1);
      const nextStr = next.toISOString().slice(0, 10);
      if (existing) {
        db.getDb()
          .prepare(
            `UPDATE recon_schedule SET frequency = ?, threshold = ?, next_due = ? WHERE id = ?`,
          )
          .run(f, data.threshold || 0, data.nextDue || nextStr, id);
      } else {
        db.getDb()
          .prepare(
            `INSERT INTO recon_schedule (id, company_id, account_id, frequency, threshold, next_due)
           VALUES (?,?,?,?,?,?)`,
          )
          .run(id, data.companyId, data.accountId, f, data.threshold || 0, data.nextDue || nextStr);
      }
      scheduleAutoBackup();
      return { id };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('recon:schedule-delete', (_e, { id }: any) => {
    try {
      db.getDb().prepare(`DELETE FROM recon_schedule WHERE id = ?`).run(id);
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // 17. Variance threshold check
  ipcMain.handle('recon:auto-approve-check', (_e, { companyId, accountId, variance }: any) => {
    try {
      const sched = db
        .getDb()
        .prepare(
          `SELECT threshold FROM recon_schedule WHERE company_id = ? AND account_id = ? LIMIT 1`,
        )
        .get(companyId, accountId) as any;
      const threshold = sched?.threshold || 0;
      return { autoApprove: threshold > 0 && Math.abs(variance) <= threshold, threshold };
    } catch {
      return { autoApprove: false, threshold: 0 };
    }
  });

  // 18 & 19. Prior-period link + rollover
  ipcMain.handle('recon:prior-period', (_e, { companyId, accountId, asOfDate }: any) => {
    try {
      const prior = db
        .getDb()
        .prepare(
          `SELECT * FROM account_reconciliations WHERE company_id = ? AND account_id = ? AND as_of_date < ?
         ORDER BY as_of_date DESC LIMIT 1`,
        )
        .get(companyId, accountId, asOfDate) as any;
      if (!prior) return { prior: null, uncleared: [] };
      const uncleared = db
        .getDb()
        .prepare(
          `SELECT * FROM account_reconciliation_items WHERE recon_id = ? AND status = 'open'`,
        )
        .all(prior.id);
      return { prior, uncleared };
    } catch (err: any) {
      return { error: err?.message, prior: null, uncleared: [] };
    }
  });

  function ensureDefaultNumberSequences(companyId: string) {
    const defaults: Record<string, { prefix: string; padding: number }> = {
      invoice: { prefix: 'INV-{YYYY}-', padding: 5 },
      bill: { prefix: 'BILL-{YYYY}-', padding: 5 },
      journal_entry: { prefix: 'JE-{YYYY}-{MM}-', padding: 5 },
      debt: { prefix: 'DEBT-', padding: 5 },
      purchase_order: { prefix: 'PO-{YYYY}-', padding: 5 },
      quote: { prefix: 'QT-{YYYY}-', padding: 5 },
      expense: { prefix: 'EXP-', padding: 5 },
      project: { prefix: 'PRJ-{YYYY}-', padding: 4 },
    };
    for (const [entityType, cfg] of Object.entries(defaults)) {
      const existing = db
        .getDb()
        .prepare(`SELECT id FROM number_sequences WHERE company_id = ? AND entity_type = ?`)
        .get(companyId, entityType) as any;
      if (existing) continue;
      db.getDb()
        .prepare(
          `INSERT INTO number_sequences (id, company_id, entity_type, prefix, suffix, padding, current_value, reset_frequency)
         VALUES (?,?,?,?,?,?,?,?)`,
        )
        .run(uuid(), companyId, entityType, cfg.prefix, '', cfg.padding, 0, 'never');
    }
  }

  function resolveTokens(prefix: string, companyId: string): string {
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const yy = yyyy.slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const q = String(Math.floor(now.getMonth() / 3) + 1);
    let companyAbbr = '';
    try {
      const c = db.getById('companies', companyId);
      companyAbbr = (c?.name || '')
        .replace(/[^A-Za-z0-9]/g, '')
        .slice(0, 4)
        .toUpperCase();
    } catch {}
    return prefix
      .replace(/\{YYYY\}/g, yyyy)
      .replace(/\{YY\}/g, yy)
      .replace(/\{MM\}/g, mm)
      .replace(/\{Q\}/g, q)
      .replace(/\{COMPANY\}/g, companyAbbr);
  }

  function shouldReset(seq: any): boolean {
    if (!seq.last_reset_at || seq.reset_frequency === 'never') return false;
    const last = new Date(seq.last_reset_at);
    const now = new Date();
    if (seq.reset_frequency === 'yearly') return last.getFullYear() !== now.getFullYear();
    if (seq.reset_frequency === 'monthly')
      return last.getFullYear() !== now.getFullYear() || last.getMonth() !== now.getMonth();
    if (seq.reset_frequency === 'quarterly') {
      const lq = Math.floor(last.getMonth() / 3);
      const nq = Math.floor(now.getMonth() / 3);
      return last.getFullYear() !== now.getFullYear() || lq !== nq;
    }
    return false;
  }

  ipcMain.handle('numbering:list', (_e, { companyId }: any) => {
    try {
      ensureDefaultNumberSequences(companyId);
      return db
        .getDb()
        .prepare(`SELECT * FROM number_sequences WHERE company_id = ? ORDER BY entity_type`)
        .all(companyId);
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('numbering:save', (_e, { id, data }: any) => {
    try {
      if (id) db.update('number_sequences', id, data);
      else db.create('number_sequences', data);
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('numbering:preview', (_e, { companyId, entityType }: any) => {
    try {
      ensureDefaultNumberSequences(companyId);
      const seq = db
        .getDb()
        .prepare(`SELECT * FROM number_sequences WHERE company_id = ? AND entity_type = ?`)
        .get(companyId, entityType) as any;
      if (!seq) return { number: '' };
      let next = (seq.current_value || 0) + 1;
      if (shouldReset(seq)) next = 1;
      const padded = String(next).padStart(seq.padding || 5, '0');
      return {
        number: `${resolveTokens(seq.prefix || '', companyId)}${padded}${seq.suffix || ''}`,
      };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('numbering:generate', (_e, { companyId, entityType, reserve }: any) => {
    try {
      ensureDefaultNumberSequences(companyId);
      const seq = db
        .getDb()
        .prepare(`SELECT * FROM number_sequences WHERE company_id = ? AND entity_type = ?`)
        .get(companyId, entityType) as any;
      if (!seq) return { error: 'sequence not found' };
      let current = seq.current_value || 0;
      if (shouldReset(seq)) {
        current = 0;
        db.getDb()
          .prepare(`UPDATE number_sequences SET last_reset_at = datetime('now') WHERE id = ?`)
          .run(seq.id);
      }
      const next = current + 1;
      db.getDb()
        .prepare(
          `UPDATE number_sequences SET current_value = ?, updated_at = datetime('now') WHERE id = ?`,
        )
        .run(next, seq.id);
      const padded = String(next).padStart(seq.padding || 5, '0');
      const number = `${resolveTokens(seq.prefix || '', companyId)}${padded}${seq.suffix || ''}`;
      if (reserve) {
        const reserved = JSON.parse(seq.reserved_json || '[]');
        reserved.push({ value: next, number, reserved_at: new Date().toISOString() });
        db.getDb()
          .prepare(`UPDATE number_sequences SET reserved_json = ? WHERE id = ?`)
          .run(JSON.stringify(reserved), seq.id);
      }
      scheduleAutoBackup();
      return { number, value: next };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('numbering:release', (_e, { companyId, entityType, value }: any) => {
    try {
      const seq = db
        .getDb()
        .prepare(`SELECT * FROM number_sequences WHERE company_id = ? AND entity_type = ?`)
        .get(companyId, entityType) as any;
      if (!seq) return { error: 'sequence not found' };
      const reserved = JSON.parse(seq.reserved_json || '[]').filter((r: any) => r.value !== value);
      let cv = seq.current_value || 0;
      if (cv === value) cv -= 1;
      db.getDb()
        .prepare(`UPDATE number_sequences SET reserved_json = ?, current_value = ? WHERE id = ?`)
        .run(JSON.stringify(reserved), cv, seq.id);
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  const NUMBER_TABLE_MAP: Record<string, { table: string; col: string }> = {
    invoice: { table: 'invoices', col: 'invoice_number' },
    bill: { table: 'bills', col: 'bill_number' },
    quote: { table: 'quotes', col: 'quote_number' },
    purchase_order: { table: 'purchase_orders', col: 'po_number' },
    expense: { table: 'expenses', col: 'expense_number' },
    debt: { table: 'debts', col: 'debt_number' },
    journal_entry: { table: 'journal_entries', col: 'entry_number' },
  };

  ipcMain.handle('numbering:gaps', (_e, { companyId, entityType }: any) => {
    try {
      const t = NUMBER_TABLE_MAP[entityType];
      if (!t) return { gaps: [], note: 'No table mapping' };
      let rows: any[] = [];
      try {
        rows = db
          .getDb()
          .prepare(
            `SELECT ${t.col} AS num FROM ${t.table} WHERE company_id = ? AND ${t.col} IS NOT NULL AND ${t.col} != '' ORDER BY ${t.col}`,
          )
          .all(companyId);
      } catch {
        return { gaps: [], note: 'Number column not present' };
      }
      const nums = rows
        .map((r: any) => {
          const m = String(r.num).match(/(\d+)(?!.*\d)/);
          return m ? parseInt(m[1], 10) : null;
        })
        .filter((n): n is number => n !== null)
        .sort((a, b) => a - b);
      const gaps: number[] = [];
      for (let i = 1; i < nums.length; i++) {
        for (let g = nums[i - 1] + 1; g < nums[i]; g++) gaps.push(g);
      }
      return { gaps, total: nums.length, min: nums[0] || 0, max: nums[nums.length - 1] || 0 };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('numbering:renumber', (_e, { companyId, entityType, dryRun }: any) => {
    try {
      const t = NUMBER_TABLE_MAP[entityType];
      if (!t) return { error: 'No table mapping' };
      const seq = db
        .getDb()
        .prepare(`SELECT * FROM number_sequences WHERE company_id = ? AND entity_type = ?`)
        .get(companyId, entityType) as any;
      if (!seq) return { error: 'sequence not found' };
      let rows: any[] = [];
      try {
        rows = db
          .getDb()
          .prepare(
            `SELECT id, ${t.col} AS num FROM ${t.table} WHERE company_id = ? ORDER BY created_at`,
          )
          .all(companyId);
      } catch {
        return { error: 'Renumber not supported for this entity' };
      }
      const changes: Array<{ id: string; from: string; to: string }> = [];
      let n = 1;
      for (const r of rows) {
        const padded = String(n).padStart(seq.padding || 5, '0');
        const newNum = `${resolveTokens(seq.prefix || '', companyId)}${padded}${seq.suffix || ''}`;
        if (r.num !== newNum) changes.push({ id: r.id, from: r.num || '', to: newNum });
        n++;
      }
      if (!dryRun) {
        for (const c of changes) {
          try {
            db.getDb().prepare(`UPDATE ${t.table} SET ${t.col} = ? WHERE id = ?`).run(c.to, c.id);
            db.logAudit(companyId, entityType, c.id, 'renumber', { from: c.from, to: c.to });
          } catch {}
        }
        db.getDb()
          .prepare(
            `UPDATE number_sequences SET current_value = ?, updated_at = datetime('now') WHERE id = ?`,
          )
          .run(n - 1, seq.id);
      }
      if (!dryRun && changes.length > 0) scheduleAutoBackup();
      return { ok: true, changes, count: changes.length };
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  // ─── Fixed Asset delete (dedicated, supports full/permanent delete) ──
  // The generic db:delete only SOFT-deletes fixed_assets (it's in
  // SOFT_DELETE_TABLES → row kept, recoverable from Trash for 30 days). This
  // handler lets the user FULLY delete an asset: { hard:true } physically
  // removes the asset AND its depreciation history (asset_depreciation_entries,
  // via cleanupReferencesBeforeDelete) using the same removeHard path as
  // trash:purge. { hard:false } falls back to the recoverable soft delete.
  ipcMain.handle('assets:delete', (_event, { id, hard }: { id: string; hard?: boolean }) => {
    try {
      if (!id) return { error: 'No asset id' };
      const companyId = db.getCurrentCompanyId();
      const asset = db.getById('fixed_assets', id);
      if (!asset) return { error: 'Asset not found' };

      // Count depreciation rows that will be removed (for an honest UI message).
      let depEntries = 0;
      try {
        depEntries =
          (
            db
              .getDb()
              .prepare('SELECT COUNT(*) AS c FROM asset_depreciation_entries WHERE asset_id = ?')
              .get(id) as any
          )?.c || 0;
      } catch {
        /* table may not exist */
      }

      if (hard) {
        // True physical delete: clear FK children first, then remove the row.
        cleanupReferencesBeforeDelete('fixed_assets', id);
        db.removeHard('fixed_assets', id);
      } else {
        db.remove('fixed_assets', id); // soft delete → Trash (recoverable)
      }

      if (companyId) {
        try {
          db.logAudit(companyId, 'fixed_assets', id, hard ? 'hard_delete' : 'delete');
        } catch {
          /* non-fatal */
        }
      }
      syncPush({
        table: 'fixed_assets',
        operation: 'delete',
        id,
        data: { id },
        companyId: companyId ?? '',
        timestamp: Date.now(),
      }).catch(() => {});
      try {
        scheduleAutoBackup();
      } catch {
        /* non-fatal */
      }

      return {
        ok: true,
        hard: !!hard,
        asset_name: asset.name || asset.asset_code || id,
        depreciation_entries_removed: hard ? depEntries : 0,
      };
    } catch (err: any) {
      return { error: err?.message || 'Delete failed' };
    }
  });
  // ─── B14: Auto-reconciliation ─────────────────────────
  // Bulk-applies smart-match candidates above a confidence
  // threshold (default 90/100 — basically "amount + date both
  // exact"). Returns a summary of matches applied and skipped.
  // Runs synchronously inside a transaction so it's all-or-
  // nothing per call (caller can re-run with a lower threshold
  // if they want to apply riskier matches).
  ipcMain.handle(
    'payment:auto-reconcile',
    (_event, opts?: { threshold?: number; dryRun?: boolean }) => {
      try {
        const cid = db.getCurrentCompanyId();
        if (!cid) return { error: 'No active company' };
        const dbi = db.getDb();
        const threshold = Math.max(60, Math.min(100, opts?.threshold || 90));
        const dryRun = !!opts?.dryRun;

        const { suggestMatches } = require('../../services/payment-matcher');

        // Pull every unmatched positive bank deposit.
        // bank_transactions has no company_id column — filter through bank_accounts.
        const txns = dbi
          .prepare(
            'SELECT bt.id, bt.date, bt.description, bt.amount ' +
              'FROM bank_transactions bt ' +
              'JOIN bank_accounts ba ON ba.id = bt.bank_account_id ' +
              'WHERE ba.company_id = ? AND bt.amount > 0 AND bt.matched_entry_id IS NULL',
          )
          .all(cid) as Array<{ id: string; date: string; description: string; amount: number }>;

        const applied: Array<{
          txn_id: string;
          invoice_id: string;
          invoice_number: string;
          amount: number;
          score: number;
        }> = [];
        const skipped: Array<{ txn_id: string; reason: string }> = [];
        let conflictCount = 0; // multiple high-confidence candidates → ambiguous

        const tx = dbi.transaction(() => {
          for (const t of txns) {
            const candidates = suggestMatches({
              amount: t.amount,
              date: t.date,
              description: t.description || '',
              company_id: cid,
            }) as Array<any>;
            if (candidates.length === 0) {
              skipped.push({ txn_id: t.id, reason: 'no candidates' });
              continue;
            }
            const top = candidates[0];
            if (top.score < threshold) {
              skipped.push({
                txn_id: t.id,
                reason: 'top score ' + top.score + ' below threshold ' + threshold,
              });
              continue;
            }
            // Ambiguity guard: if the second-best is within 10 points,
            // skip — could be the wrong invoice. Hand off to human.
            if (candidates.length > 1 && top.score - candidates[1].score < 10) {
              conflictCount++;
              skipped.push({
                txn_id: t.id,
                reason: 'ambiguous (top=' + top.score + ', 2nd=' + candidates[1].score + ')',
              });
              continue;
            }
            // Period-close gate
            const period = findClosedPeriod(cid, t.date);
            if (period) {
              skipped.push({
                txn_id: t.id,
                reason: 'date in closed period ' + period.period_start + '..' + period.period_end,
              });
              continue;
            }

            if (!dryRun) {
              // Record payment. The real table is `payments` (there is no
              // `invoice_payments` table); columns match the canonical insert
              // used elsewhere (e.g. the manual record-payment handler). The
              // bank-transaction link is kept on bank_transactions.matched_entry_id
              // below, so no bank_transaction_id column is needed here.
              const pid = uuid();
              dbi
                .prepare(
                  'INSERT INTO payments (id, company_id, invoice_id, amount, date, payment_method, reference) ' +
                    'VALUES (?, ?, ?, ?, ?, ?, ?)',
                )
                .run(
                  pid,
                  cid,
                  top.invoice_id,
                  t.amount,
                  t.date,
                  'bank_transfer',
                  (t.description || '').slice(0, 60),
                );

              // Update invoice. Round to cents so repeated auto-matches don't
              // accumulate binary-float drift in amount_paid (0.1 + 0.2 = 0.300…04).
              const newPaid = Math.round((Number(top.amount_paid) + t.amount) * 100) / 100;
              const newStatus = newPaid + 0.005 >= top.total ? 'paid' : 'partial';
              dbi
                .prepare(
                  "UPDATE invoices SET amount_paid = ?, status = ?, updated_at = datetime('now') WHERE id = ?",
                )
                .run(newPaid, newStatus, top.invoice_id);

              // Mark bank transaction as matched.
              // bank_transactions has no updated_at column — omit it.
              dbi
                .prepare('UPDATE bank_transactions SET matched_entry_id = ? WHERE id = ?')
                .run(pid, t.id);

              db.logAudit(cid, 'invoices', top.invoice_id, 'auto_reconcile_match', {
                bank_txn_id: t.id,
                score: top.score,
                amount: t.amount,
              });
            }

            applied.push({
              txn_id: t.id,
              invoice_id: top.invoice_id,
              invoice_number: top.invoice_number,
              amount: t.amount,
              score: top.score,
            });
          }
        });
        tx();
        if (!dryRun) scheduleAutoBackup();
        return {
          ok: true,
          dry_run: dryRun,
          threshold,
          scanned: txns.length,
          applied: applied.length,
          skipped: skipped.length,
          ambiguous: conflictCount,
          applied_detail: applied,
          skipped_detail: skipped.slice(0, 20),
        };
      } catch (err: any) {
        return { error: err?.message || 'Auto-reconcile failed' };
      }
    },
  );
  // ─── B11: Smart payment matching for bank import lines ─
  ipcMain.handle(
    'payment:suggest-matches',
    (_event, opts: { amount: number; date: string; description: string }) => {
      try {
        const { suggestMatches } = require('../../services/payment-matcher');
        const cid = db.getCurrentCompanyId();
        if (!cid) return [];
        return suggestMatches({ ...opts, company_id: cid });
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );
  // ─── Journal Entry Auto-Number ───────────────────────────
  // Bug fix: journal_entries.entry_number is NOT NULL + UNIQUE; nothing in
  // the generic db:create path generates it, so every create crashed.
  ipcMain.handle('journal:next-number', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return 'JE-1001';
    const dbInstance = db.getDb();
    const row = dbInstance
      .prepare(
        "SELECT entry_number FROM journal_entries WHERE company_id = ? ORDER BY CAST(SUBSTR(entry_number, INSTR(entry_number, '-') + 1) AS INTEGER) DESC LIMIT 1",
      )
      .get(companyId) as any;
    if (row?.entry_number) {
      const match = row.entry_number.match(/(\d+)$/);
      if (match) {
        const next = parseInt(match[1], 10) + 1;
        const prefix = row.entry_number.slice(0, row.entry_number.length - match[1].length);
        return `${prefix}${String(next).padStart(match[1].length, '0')}`;
      }
    }
    return 'JE-1001';
  });
  // ─── GL Rebuild (retro-post missing journal entries) ──────
  // Scans all invoices, expenses, payments, and payroll runs,
  // posts JEs for any that don't have corresponding entries.
  ipcMain.handle('gl:rebuild', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { error: 'No active company' };
    const dbInstance = db.getDb();

    // Auto-posted JE description prefixes — used to identify machine-generated entries
    const AUTO_PREFIXES = [
      'Invoice created -',
      'Payment received -',
      'Expense recorded -',
      'Bill payment -',
      'Payroll -',
    ];

    try {
      // Wrap entire rebuild in a transaction for atomicity
      const rebuildFn = (dbInstance as any).transaction(() => {
        // ── Step 1: Delete all previously auto-posted JEs (clean slate) ──
        // Find auto-posted JE ids by description prefix
        const autoJEIds: string[] = [];
        for (const prefix of AUTO_PREFIXES) {
          const rows = (dbInstance as any)
            .prepare(`SELECT id FROM journal_entries WHERE company_id = ? AND description LIKE ?`)
            .all(companyId, `${prefix}%`) as any[];
          for (const r of rows) autoJEIds.push(r.id);
        }

        // CONCURRENCY: hoist prepared statements out of the loop. `prepare`
        // parses + caches each call; preparing inside a hot loop creates one
        // statement object per iteration instead of reusing a single one.
        const delLinesStmt = (dbInstance as any).prepare(
          `DELETE FROM journal_entry_lines WHERE journal_entry_id = ?`,
        );
        const delEntryStmt = (dbInstance as any).prepare(
          `DELETE FROM journal_entries WHERE id = ?`,
        );
        for (const jeId of autoJEIds) {
          delLinesStmt.run(jeId);
          delEntryStmt.run(jeId);
        }
        const deleted = autoJEIds.length;

        let posted = 0;

        // ── Step 2: Post invoice JEs (DR Receivable / CR Revenue) ──
        const invoices = (dbInstance as any)
          .prepare(
            `SELECT id, invoice_number, issue_date, total, subtotal FROM invoices WHERE company_id = ? AND status != 'draft'`,
          )
          .all(companyId) as any[];
        for (const inv of invoices) {
          const total = Number(inv.total || inv.subtotal) || 0;
          if (total <= 0) continue;
          const num = inv.invoice_number || inv.id.substring(0, 8);
          postJournalEntry(
            dbInstance,
            companyId,
            inv.issue_date || localToday(),
            `Invoice created - #${num}`,
            [
              { nameHint: 'Receivable', debit: total, credit: 0, note: `AR for Invoice #${num}` },
              {
                nameHint: 'Revenue',
                debit: 0,
                credit: total,
                note: `Revenue from Invoice #${num}`,
              },
            ],
          );
          posted++;
        }

        // ── Step 3: Post invoice payment JEs (DR Cash / CR Receivable) ──
        const payments = (dbInstance as any)
          .prepare(
            `SELECT p.*, i.invoice_number FROM payments p LEFT JOIN invoices i ON p.invoice_id = i.id WHERE p.company_id = ?`,
          )
          .all(companyId) as any[];
        for (const p of payments) {
          const amount = Number(p.amount) || 0;
          if (amount <= 0) continue;
          postJournalEntry(
            dbInstance,
            companyId,
            p.date || localToday(),
            `Payment received - ${p.invoice_number || p.invoice_id?.substring(0, 8) || 'unknown'}`,
            [
              { nameHint: 'Cash', debit: amount, credit: 0, note: 'Cash received' },
              { nameHint: 'Receivable', debit: 0, credit: amount, note: 'Clear AR' },
            ],
          );
          posted++;
        }

        // ── Step 4: Post expense JEs (DR [category] / CR Cash or Payable) ──
        const expenses = (dbInstance as any)
          .prepare(
            `SELECT e.id, e.description, e.date, e.amount, e.status, e.category_id,
                  COALESCE(c.name, '') as category_name
           FROM expenses e
           LEFT JOIN categories c ON e.category_id = c.id
           WHERE e.company_id = ?`,
          )
          .all(companyId) as any[];
        for (const exp of expenses) {
          const amount = Number(exp.amount) || 0;
          if (amount <= 0) continue;
          const isPaid = ['paid', 'approved'].includes(exp.status);
          const expenseHint = exp.category_name || 'Expense';
          postJournalEntry(
            dbInstance,
            companyId,
            exp.date || localToday(),
            `Expense recorded - ${exp.description || exp.id.substring(0, 8)}`,
            [
              {
                nameHint: expenseHint,
                debit: amount,
                credit: 0,
                note: exp.description || 'Expense',
              },
              {
                nameHint: isPaid ? 'Cash' : 'Payable',
                debit: 0,
                credit: amount,
                note: isPaid ? 'Cash paid' : 'Accounts Payable',
              },
            ],
          );
          posted++;
        }

        // ── Step 5: Post bill payment JEs (DR Payable / CR Cash) ──
        const billPayments = (dbInstance as any)
          .prepare(
            `SELECT bp.*, b.bill_number FROM bill_payments bp LEFT JOIN bills b ON bp.bill_id = b.id WHERE bp.company_id = ?`,
          )
          .all(companyId) as any[];
        for (const bp of billPayments) {
          const amount = Number(bp.amount) || 0;
          if (amount <= 0) continue;
          postJournalEntry(
            dbInstance,
            companyId,
            bp.date || localToday(),
            `Bill payment - ${bp.bill_number || bp.bill_id?.substring(0, 8) || 'unknown'}`,
            [
              { nameHint: 'Payable', debit: amount, credit: 0, note: 'AP cleared' },
              { nameHint: 'Cash', debit: 0, credit: amount, note: 'Cash paid' },
            ],
          );
          posted++;
        }

        return { deleted, posted };
      });

      const { deleted, posted } = rebuildFn();
      scheduleAutoBackup();
      return {
        posted,
        message: `Rebuilt GL: cleared ${deleted} old entries, posted ${posted} new journal entries.`,
      };
    } catch (err: any) {
      console.error('gl:rebuild failed:', err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
  // ─── Fixed Assets ─────────────────────────────────────────

  ipcMain.handle('assets:next-code', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return 'AST-001';
    const dbInstance = db.getDb();
    const row = dbInstance
      .prepare(
        `SELECT asset_code FROM fixed_assets WHERE company_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(companyId) as any;
    if (!row?.asset_code) return 'AST-001';
    const match = row.asset_code.match(/(\d+)$/);
    if (!match) return 'AST-001';
    const next = parseInt(match[1], 10) + 1;
    return `AST-${String(next).padStart(3, '0')}`;
  });
  ipcMain.handle('assets:schedule', (_event, { assetId }: { assetId: string }) => {
    const dbInstance = db.getDb();
    const asset = dbInstance.prepare('SELECT * FROM fixed_assets WHERE id = ?').get(assetId) as any;
    if (!asset) return [];

    const cents = (n: number) => Math.round(n * 100) / 100;

    const schedule: any[] = [];
    const cost = asset.purchase_price || 0;
    const salvage = asset.salvage_value || 0;
    const life = asset.useful_life_years || 5;
    const startDate = new Date(asset.purchase_date);
    let bookValue = cost;
    const depreciable = Math.max(0, cost - salvage);
    const method = asset.depreciation_method;

    // CALC: Mid-year purchase / actual-month convention (GAAP). An asset
    // placed in service mid-year takes only a partial year of depreciation
    // in year 1 (months remaining ÷ 12). The unused fraction rolls into
    // year (life+1). E.g. July 1 purchase: year1 = 6/12, year (life+1) = 6/12.
    // This matches the month-by-month accrual in `assets:run-depreciation`.
    const purchaseMonth = isNaN(startDate.getTime()) ? 1 : startDate.getMonth() + 1;
    const year1Fraction = (13 - purchaseMonth) / 12; // Jan=12/12 (1.0), Dec=1/12
    const totalYears = year1Fraction < 1 ? life + 1 : life;

    for (let year = 1; year <= totalYears; year++) {
      let annualDep = 0;
      const fraction =
        year === 1
          ? year1Fraction
          : year === totalYears && totalYears > life
            ? 1 - year1Fraction
            : 1;
      if (method === 'straight_line') {
        annualDep = (depreciable / life) * fraction;
      } else if (method === 'double_declining') {
        // Iterate on declining book value. Switch to straight-line over the
        // remaining life when SL would yield a larger deduction (standard
        // DDB-with-crossover convention used by IRS Pub 946 examples).
        const rate = 2 / life;
        const ddbDep = (bookValue - salvage) * rate;
        const remainingYears = Math.max(1, life - Math.min(year, life) + 1);
        const slDep = (bookValue - salvage) / remainingYears;
        annualDep = Math.max(ddbDep, slDep) * fraction;
      } else if (method === 'sum_of_years_digits') {
        const idx = Math.min(year, life);
        const remaining = life - idx + 1;
        const sumYears = (life * (life + 1)) / 2;
        annualDep = (remaining / sumYears) * depreciable * fraction;
      }

      // Salvage floor — never deduct more than the gap to salvage.
      annualDep = Math.max(0, Math.min(annualDep, bookValue - salvage));
      annualDep = cents(annualDep);

      // Last period absorbs rounding drift so the schedule closes exactly
      // on (cost - salvage). Without this 0.01-cent crumbs accumulate and
      // the final book value drifts off salvage by a few cents.
      if (year === totalYears) {
        const accumSoFar = schedule.reduce((s, e) => s + e.depreciation_amount, 0);
        annualDep = cents(depreciable - accumSoFar);
        if (annualDep < 0) annualDep = 0;
      }

      bookValue = cents(bookValue - annualDep);
      if (bookValue < salvage) bookValue = salvage;

      const d = new Date(startDate);
      d.setFullYear(d.getFullYear() + year);
      schedule.push({
        year,
        period: d.toISOString().slice(0, 10),
        period_label: `Year ${year}`,
        depreciation_amount: annualDep,
        accumulated: cents(cost - bookValue),
        accumulated_depreciation: cents(cost - bookValue),
        book_value: bookValue,
      });
    }
    return schedule;
  });
  ipcMain.handle(
    'assets:run-depreciation',
    (_event, { periodDate, assetId }: { periodDate: string; assetId?: string }) => {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) throw new Error('No active company');
      const dbInstance = db.getDb();

      // Honor an optional assetId so "run depreciation" on a selected subset only
      // touches those assets. Without it the handler depreciated EVERY active
      // asset on every call, ignoring the user's selection.
      const assets = (
        assetId
          ? dbInstance
              .prepare(
                `SELECT * FROM fixed_assets WHERE company_id = ? AND status = 'active' AND id = ?`,
              )
              .all(companyId, assetId)
          : dbInstance
              .prepare(`SELECT * FROM fixed_assets WHERE company_id = ? AND status = 'active'`)
              .all(companyId)
      ) as any[];

      let processed = 0;
      const depTx = dbInstance.transaction(() => {
        for (const asset of assets) {
          // Check if already depreciated this period
          const existing = dbInstance
            .prepare(
              `
          SELECT id FROM asset_depreciation_entries WHERE asset_id = ? AND period_date = ?
        `,
            )
            .get(asset.id, periodDate);
          if (existing) continue;

          const cost = asset.purchase_price || 0;
          const salvage = asset.salvage_value || 0;
          const accum = asset.accumulated_depreciation || 0;

          // Per-method monthly figure (incl. the formerly-missing SYD branch),
          // salvage-floored. See services/depreciation.ts (unit-tested).
          const monthlyDep = monthlyDepreciation(asset.depreciation_method, {
            cost,
            salvage,
            life: asset.useful_life_years || 5,
            accumulated: accum,
            purchaseDate: asset.purchase_date,
            periodDate,
          });
          if (monthlyDep <= 0) continue;

          const newAccum = accum + monthlyDep;
          const newBookValue = cost - newAccum;
          const entryId = uuid();

          dbInstance
            .prepare(
              `
          INSERT INTO asset_depreciation_entries (id, asset_id, period_date, period_label, depreciation_amount, accumulated_depreciation, book_value)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
            )
            .run(
              entryId,
              asset.id,
              periodDate,
              periodDate.slice(0, 7),
              monthlyDep,
              newAccum,
              newBookValue,
            );

          dbInstance
            .prepare(
              `
          UPDATE fixed_assets SET accumulated_depreciation = ?, current_book_value = ?,
            status = CASE WHEN ? <= ? THEN 'fully_depreciated' ELSE status END,
            updated_at = datetime('now')
          WHERE id = ?
        `,
            )
            .run(newAccum, newBookValue, newBookValue, salvage + 0.01, asset.id);

          processed++;
        }
      });
      depTx();
      if (processed > 0) scheduleAutoBackup();
      // Reactive engine: emit asset.depreciated when at least one asset was depreciated.
      try {
        if (companyId && processed > 0) {
          eventBus
            .emit({
              type: 'asset.depreciated',
              companyId,
              entityType: 'fixed_assets',
              entityId: '',
              data: { processed, period_date: periodDate },
            })
            .catch(() => {});
        }
      } catch {
        /* fire-and-forget */
      }
      return { processed };
    },
  );
  // ─── Bank Rules ───────────────────────────────────────────

  ipcMain.handle(
    'bank-rules:apply',
    (_event, { transactionIds }: { transactionIds?: string[] }) => {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return { applied: 0 };
      const dbInstance = db.getDb();

      const rules = dbInstance
        .prepare(
          `
      SELECT * FROM bank_rules WHERE company_id = ? AND is_active = 1
      ORDER BY priority DESC, created_at ASC
    `,
        )
        .all(companyId) as any[];

      let txQuery = `SELECT * FROM bank_transactions bt JOIN bank_accounts ba ON ba.id = bt.bank_account_id WHERE ba.company_id = ? AND bt.status = 'pending'`;
      const txParams: any[] = [companyId];
      if (transactionIds?.length) {
        txQuery += ` AND bt.id IN (${transactionIds.map(() => '?').join(',')})`;
        txParams.push(...transactionIds);
      }
      const transactions = dbInstance.prepare(txQuery).all(...txParams) as any[];

      let applied = 0;
      const applyTx = dbInstance.transaction(() => {
        for (const tx of transactions) {
          for (const rule of rules) {
            let matches = false;
            const fieldValue = String(tx[rule.match_field] || '').toLowerCase();
            const matchVal = (rule.match_value || '').toLowerCase();

            switch (rule.match_type) {
              case 'contains':
                matches = fieldValue.includes(matchVal);
                break;
              case 'starts_with':
                matches = fieldValue.startsWith(matchVal);
                break;
              case 'ends_with':
                matches = fieldValue.endsWith(matchVal);
                break;
              case 'exact':
                matches = fieldValue === matchVal;
                break;
              case 'regex':
                try {
                  matches = new RegExp(matchVal, 'i').test(fieldValue);
                } catch {
                  matches = false;
                }
                break;
            }

            if (rule.amount_min != null && tx.amount < rule.amount_min) matches = false;
            if (rule.amount_max != null && tx.amount > rule.amount_max) matches = false;
            if (rule.transaction_type && tx.type !== rule.transaction_type) matches = false;

            if (matches) {
              // NOTE: bank_transactions.status CHECK only allows
              // ('pending','matched','excluded') — writing 'categorized' here
              // threw a CHECK-constraint error that rolled back the whole batch,
              // so "Apply Rules" silently did nothing. The rule's meaningful
              // effect on a bank_transaction is the description rename (the table
              // has no category column to hold action_category_id/account_id);
              // leave status as 'pending' so the txn still flows to matching.
              dbInstance
                .prepare(
                  `UPDATE bank_transactions SET description = COALESCE(NULLIF(?, ''), description) WHERE id = ?`,
                )
                .run(rule.action_description || '', tx.id);
              dbInstance
                .prepare(
                  `UPDATE bank_rules SET times_applied = times_applied + 1, updated_at = datetime('now') WHERE id = ?`,
                )
                .run(rule.id);
              applied++;
              break; // first matching rule wins
            }
          }
        }
      });
      applyTx();
      if (applied > 0) scheduleAutoBackup();
      return { applied };
    },
  );
  // ─── Categories: Seed Defaults ───────────────────────────
  ipcMain.handle('categories:seed-defaults', (_event, { company_id }: { company_id: string }) => {
    const result = seedDefaultCategories(company_id);
    // Always backfill Schedule C lines — covers companies that were seeded
    // before the canonical mapping existed (fills the "—" lines on boot).
    const backfill = backfillCategoryScheduleC(company_id);
    scheduleAutoBackup();
    return { ...result, scheduleCBackfilled: backfill.updated };
  });
  // ─── Industry Presets: Apply ─────────────────────────────
  // Applies a full industry preset to a company in a single transaction.
  // Idempotent — re-applying never duplicates existing rows (matches by name/key).
  // The preset payload itself comes from the renderer (so we don't have to bundle
  // duplicate data in main); accountSeeds is the COA template's accounts list.
  ipcMain.handle(
    'industry:apply-preset',
    (
      _event,
      payload: {
        companyId: string;
        presetKey: string;
        preset: any;
        accountSeeds?: Array<{ code: string; name: string; type: string; subtype?: string }>;
      },
    ) => {
      const { companyId, presetKey, preset, accountSeeds = [] } = payload || ({} as any);
      if (!companyId || !preset) return { error: 'companyId and preset are required' };

      const dbInstance = db.getDb();
      const summary = {
        categoriesAdded: 0,
        categoriesSkipped: 0,
        vendorsAdded: 0,
        vendorsSkipped: 0,
        fieldsAdded: 0,
        fieldsSkipped: 0,
        accountsAdded: 0,
        accountsSkipped: 0,
        hintsAdded: 0,
      };

      try {
        const apply = dbInstance.transaction(() => {
          // 1) Accounts (from CoA template)
          const acctExisting = dbInstance
            .prepare('SELECT code FROM accounts WHERE company_id = ?')
            .all(companyId) as Array<{ code: string }>;
          const acctSet = new Set(acctExisting.map((a) => a.code));
          const insertAcct = dbInstance.prepare(
            `INSERT OR IGNORE INTO accounts (id, company_id, code, name, type, subtype, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)`,
          );
          for (const a of accountSeeds) {
            if (acctSet.has(a.code)) {
              summary.accountsSkipped++;
              continue;
            }
            insertAcct.run(uuid(), companyId, a.code, a.name, a.type, a.subtype || '');
            summary.accountsAdded++;
          }

          // 2) Categories — schema CHECK only allows income/expense, so 'cogs' maps to expense
          const catExisting = dbInstance
            .prepare('SELECT name FROM categories WHERE company_id = ?')
            .all(companyId) as Array<{ name: string }>;
          const catSet = new Set(catExisting.map((c) => c.name.toLowerCase()));
          const insertCat = dbInstance.prepare(
            `INSERT OR IGNORE INTO categories (id, company_id, name, type, color, description, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)`,
          );
          for (const c of preset.defaultCategories || []) {
            if (catSet.has(String(c.name).toLowerCase())) {
              summary.categoriesSkipped++;
              continue;
            }
            const dbType = c.type === 'income' ? 'income' : 'expense';
            insertCat.run(
              uuid(),
              companyId,
              c.name,
              dbType,
              c.color || '#6b7280',
              c.description || '',
            );
            summary.categoriesAdded++;
          }

          // 3) Vendors
          const venExisting = dbInstance
            .prepare('SELECT name FROM vendors WHERE company_id = ?')
            .all(companyId) as Array<{ name: string }>;
          const venSet = new Set(venExisting.map((v) => v.name.toLowerCase()));
          const insertVen = dbInstance.prepare(
            `INSERT OR IGNORE INTO vendors (id, company_id, name, notes, status) VALUES (?, ?, ?, ?, 'active')`,
          );
          for (const v of preset.defaultVendors || []) {
            if (venSet.has(String(v.name).toLowerCase())) {
              summary.vendorsSkipped++;
              continue;
            }
            insertVen.run(uuid(), companyId, v.name, v.notes || `Type: ${v.type || 'general'}`);
            summary.vendorsAdded++;
          }

          // 4) Custom field defs (idempotent via UNIQUE(company_id, entity_type, field_name))
          const insertField = dbInstance.prepare(
            `INSERT OR IGNORE INTO custom_field_defs (id, company_id, entity_type, field_name, field_label, field_type, options, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          );
          let fieldOrder = 0;
          for (const f of preset.industrySpecificFields || []) {
            const before = (
              dbInstance
                .prepare(
                  'SELECT COUNT(*) as cnt FROM custom_field_defs WHERE company_id = ? AND entity_type = ? AND field_name = ?',
                )
                .get(companyId, f.entity_type, f.key) as any
            ).cnt;
            if (before > 0) {
              summary.fieldsSkipped++;
              continue;
            }
            insertField.run(
              uuid(),
              companyId,
              f.entity_type,
              f.key,
              f.label,
              f.field_type,
              JSON.stringify(f.options || []),
              fieldOrder++,
            );
            summary.fieldsAdded++;
          }

          // 5) Persist the active preset key + invoice settings + setup hints (as settings rows)
          const upsertSetting = dbInstance.prepare(
            `INSERT INTO settings (id, company_id, key, value, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
           ON CONFLICT(company_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
          );
          upsertSetting.run(uuid(), companyId, 'industry_preset_key', presetKey);
          upsertSetting.run(
            uuid(),
            companyId,
            'industry_preset_applied_at',
            new Date().toISOString(),
          );

          if (preset.setupHints && Array.isArray(preset.setupHints)) {
            upsertSetting.run(
              uuid(),
              companyId,
              'industry_setup_hints',
              JSON.stringify(preset.setupHints),
            );
            summary.hintsAdded = preset.setupHints.length;
          }
          if (preset.dashboardWidgets && Array.isArray(preset.dashboardWidgets)) {
            upsertSetting.run(
              uuid(),
              companyId,
              'industry_dashboard_widgets',
              JSON.stringify(preset.dashboardWidgets),
            );
          }

          // 6) Invoice settings (merge into existing row or create one)
          const inv = preset.invoiceSettings || {};
          const invKeys = Object.keys(inv).filter(
            (k) => inv[k] !== undefined && inv[k] !== null && inv[k] !== '',
          );
          if (invKeys.length > 0) {
            const existing = dbInstance
              .prepare('SELECT id FROM invoice_settings WHERE company_id = ?')
              .get(companyId) as any;
            if (existing) {
              const sets = invKeys.map((k) => `${k} = ?`).join(', ');
              dbInstance
                .prepare(
                  `UPDATE invoice_settings SET ${sets}, updated_at = datetime('now') WHERE id = ?`,
                )
                .run(...invKeys.map((k) => inv[k]), existing.id);
            } else {
              const cols = ['id', 'company_id', ...invKeys];
              const vals = [uuid(), companyId, ...invKeys.map((k) => inv[k])];
              dbInstance
                .prepare(
                  `INSERT INTO invoice_settings (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
                )
                .run(...vals);
            }
          }

          // 7) Stamp company.industry
          dbInstance
            .prepare(`UPDATE companies SET industry = ?, updated_at = datetime('now') WHERE id = ?`)
            .run(presetKey, companyId);
        });
        apply();

        try {
          db.logAudit(companyId, 'companies', companyId, 'industry-preset-applied');
        } catch {
          /* audit best-effort */
        }
        scheduleAutoBackup();
        return { success: true, summary };
      } catch (err) {
        console.error('industry:apply-preset failed:', err);
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );
  // Returns a snapshot of existing rows so the renderer can compute a diff
  // before applying a preset (additive, never destructive).
  ipcMain.handle('industry:get-existing', (_event, { companyId }: { companyId: string }) => {
    if (!companyId) return null;
    const dbInstance = db.getDb();
    const categoryNames = (
      dbInstance
        .prepare('SELECT name FROM categories WHERE company_id = ?')
        .all(companyId) as Array<{ name: string }>
    ).map((r) => r.name);
    const vendorNames = (
      dbInstance.prepare('SELECT name FROM vendors WHERE company_id = ?').all(companyId) as Array<{
        name: string;
      }>
    ).map((r) => r.name);
    const fields = (
      dbInstance
        .prepare('SELECT entity_type, field_name FROM custom_field_defs WHERE company_id = ?')
        .all(companyId) as Array<{ entity_type: string; field_name: string }>
    ).map((r) => `${r.entity_type}:${r.field_name}`);
    const accountCodes = (
      dbInstance.prepare('SELECT code FROM accounts WHERE company_id = ?').all(companyId) as Array<{
        code: string;
      }>
    ).map((r) => r.code);
    return { categoryNames, vendorNames, fields, accountCodes };
  });
  // ─── Inventory Stock Movements ─────────────────────────
  ipcMain.handle('inventory:movements', (_e, itemId: string) => {
    return db
      .getDb()
      .prepare(
        `SELECT * FROM inventory_movements WHERE item_id = ? ORDER BY created_at DESC LIMIT 100`,
      )
      .all(itemId);
  });
  ipcMain.handle(
    'inventory:adjust',
    (
      _e,
      {
        itemId,
        type,
        quantity,
        unitCost,
        reference,
        notes,
      }: {
        itemId: string;
        type: string;
        quantity: number;
        unitCost: number;
        reference: string;
        notes: string;
      },
    ) => {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return { error: 'No active company' };
      const rawDb = db.getDb();
      try {
        const adjust = rawDb.transaction(() => {
          // Record the movement
          db.create('inventory_movements', {
            item_id: itemId,
            company_id: companyId,
            type,
            quantity,
            unit_cost: unitCost || 0,
            reference: reference || '',
            notes: notes || '',
          });

          // Capture pre-adjustment state for weighted-average costing.
          const before = rawDb
            .prepare(`SELECT quantity, unit_cost FROM inventory_items WHERE id = ?`)
            .get(itemId) as any;
          const oldQty = Number(before?.quantity) || 0;
          const oldCost = Number(before?.unit_cost) || 0;

          // Update the inventory item's quantity
          const delta = type === 'out' ? -Math.abs(quantity) : Math.abs(quantity);
          rawDb
            .prepare(
              `UPDATE inventory_items SET quantity = quantity + ?, updated_at = datetime('now') WHERE id = ?`,
            )
            .run(delta, itemId);

          // On a receipt at a real cost, roll unit_cost forward as a weighted
          // moving average. Previously unit_cost never changed on receipt, so the
          // item's value (qty × unit_cost), the Stock Value KPI and the valuation
          // exports all stayed wrong whenever stock came in at a new price.
          const recvQty = Math.abs(quantity);
          const recvCost = Number(unitCost) || 0;
          if (type !== 'out' && recvCost > 0 && oldQty + recvQty > 0) {
            const newCost =
              Math.round(((oldQty * oldCost + recvQty * recvCost) / (oldQty + recvQty)) * 10000) /
              10000;
            rawDb
              .prepare(`UPDATE inventory_items SET unit_cost = ? WHERE id = ?`)
              .run(newCost, itemId);
          }

          const item = rawDb
            .prepare(`SELECT quantity, reorder_point FROM inventory_items WHERE id = ?`)
            .get(itemId) as any;
          return {
            ok: true,
            newQuantity: item?.quantity ?? 0,
            reorderPoint: item?.reorder_point ?? 0,
          };
        });
        const r = adjust();
        scheduleAutoBackup();
        // Reactive engine: emit inventory.received / low_stock / out_of_stock.
        try {
          if (companyId && itemId) {
            if (type !== 'out') {
              eventBus
                .emit({
                  type: 'inventory.received',
                  companyId,
                  entityType: 'inventory_item',
                  entityId: itemId,
                  data: {
                    quantity,
                    unit_cost: unitCost || 0,
                    reference: reference || '',
                    new_quantity: r.newQuantity,
                  },
                })
                .catch(() => {});
            }
            if (r.newQuantity <= 0) {
              eventBus
                .emit({
                  type: 'inventory.out_of_stock',
                  companyId,
                  entityType: 'inventory_item',
                  entityId: itemId,
                  data: { new_quantity: r.newQuantity },
                })
                .catch(() => {});
            } else if ((r as any).reorderPoint > 0 && r.newQuantity <= (r as any).reorderPoint) {
              eventBus
                .emit({
                  type: 'inventory.low_stock',
                  companyId,
                  entityType: 'inventory_item',
                  entityId: itemId,
                  data: { new_quantity: r.newQuantity, reorder_point: (r as any).reorderPoint },
                })
                .catch(() => {});
            }
          }
        } catch {
          /* fire-and-forget */
        }
        return r;
      } catch (err: any) {
        return { error: err.message };
      }
    },
  );
  ipcMain.handle('inventory:low-stock', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return [];
    return db
      .getDb()
      .prepare(
        `SELECT id, name, sku, quantity, reorder_point, reorder_qty, unit_cost
       FROM inventory_items
       WHERE company_id = ? AND reorder_point > 0 AND quantity <= reorder_point
       ORDER BY (quantity - reorder_point) ASC`,
      )
      .all(companyId);
  });
  // F6: FX revaluation
  ipcMain.handle(
    'fx:revalue',
    (
      _e,
      {
        companyId,
        date,
        rates,
      }: { companyId: string; date: string; rates: Record<string, number> },
    ) => {
      try {
        const dbi = db.getDb();
        const fxAccts = dbi
          .prepare(
            `SELECT id, code, name, type, currency FROM accounts WHERE company_id = ? AND COALESCE(currency,'USD') != 'USD' AND COALESCE(deleted_at,'') = ''`,
          )
          .all(companyId) as any[];
        // Find / create FX gain & loss
        const findOrCreate = (name: string, code: string): string => {
          const ex = dbi
            .prepare('SELECT id FROM accounts WHERE company_id = ? AND name = ? LIMIT 1')
            .get(companyId, name) as any;
          if (ex?.id) return ex.id;
          const c = db.create('accounts', {
            company_id: companyId,
            code,
            name,
            type: name.includes('Loss') ? 'expense' : 'revenue',
            subtype: 'Other Income',
          });
          return c.id;
        };
        const gainId = findOrCreate('Unrealized FX Gain', '4910');
        const lossId = findOrCreate('Unrealized FX Loss', '7910');
        const jeId = uuid();
        dbi
          .prepare(
            `
        INSERT INTO journal_entries (id, company_id, entry_number, date, description, is_posted, is_adjusting)
        VALUES (?, ?, ?, ?, ?, 0, 1)
      `,
          )
          .run(jeId, companyId, `FX-${date}`, date, `FX revaluation as of ${date}`);
        let lines = 0;
        for (const a of fxAccts) {
          const rate = rates[a.currency] || 1;
          const balRow = dbi
            .prepare(
              `SELECT COALESCE(SUM(jel.debit - jel.credit),0) as bal FROM journal_entry_lines jel
           JOIN journal_entries je ON jel.journal_entry_id = je.id
           WHERE jel.account_id = ? AND je.company_id = ? AND date(je.date) <= date(?) /* DATE: Item #7 — wrap for inclusive end-of-day */`,
            )
            .get(a.id, companyId, date) as any;
          const currentBal = Number(balRow?.bal) || 0;
          const target = currentBal * rate;
          const diff = target - currentBal;
          if (Math.abs(diff) < 0.005) continue;
          const isDebitNormal = ['asset', 'expense'].includes(a.type);
          if (diff > 0) {
            db.create('journal_entry_lines', {
              journal_entry_id: jeId,
              account_id: a.id,
              debit: isDebitNormal ? diff : 0,
              credit: isDebitNormal ? 0 : diff,
              description: `FX adj ${a.code}`,
            });
            db.create('journal_entry_lines', {
              journal_entry_id: jeId,
              account_id: gainId,
              debit: 0,
              credit: diff,
              description: `FX gain ${a.code}`,
            });
          } else {
            const d = -diff;
            db.create('journal_entry_lines', {
              journal_entry_id: jeId,
              account_id: a.id,
              debit: isDebitNormal ? 0 : d,
              credit: isDebitNormal ? d : 0,
              description: `FX adj ${a.code}`,
            });
            db.create('journal_entry_lines', {
              journal_entry_id: jeId,
              account_id: lossId,
              debit: d,
              credit: 0,
              description: `FX loss ${a.code}`,
            });
          }
          lines++;
        }
        if (lines > 0)
          dbi
            .prepare(
              "UPDATE journal_entries SET is_posted = 1, updated_at = datetime('now') WHERE id = ?",
            )
            .run(jeId);
        scheduleAutoBackup();
        return { success: true, entry_id: jeId, accounts_revalued: lines };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );
}
