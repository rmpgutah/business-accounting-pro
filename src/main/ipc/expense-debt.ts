// src/main/ipc/expense-debt.ts
//
// Debt-Collection Expense Wave + Expense Allocation Engine.
//
//  A. Collection costs — expenses linked to a debt (related_debt_id) with a
//     cost type, recoverable flag, and recovery tracking. Recoverable costs
//     can be applied to the debt's balance (fees_accrued) idempotently.
//     Cost-to-collect ROI is computed per debt and per portfolio.
//
//  B. Allocations — split any expense across N targets (client / project /
//     debt / department / custom) by percent or fixed amount. Replace-all
//     save semantics inside a transaction; denormalized allocation_count on
//     the expense row keeps list rendering join-free. Saved templates let
//     users reuse common splits.
//
// Registered from registerIpcHandlers() via registerExpenseDebtIpc().

import { IpcMain } from 'electron';
import { v4 as uuid } from 'uuid';
import * as db from '../database';

interface ExpenseDebtIpcDeps {
  scheduleAutoBackup: () => void;
}

const COST_TYPES = new Set([
  '', 'court_fee', 'filing_fee', 'legal_fee', 'process_server',
  'skip_tracing', 'agency_commission', 'credit_report', 'postage',
  'travel', 'other',
]);

const ALLOC_TARGET_TYPES = new Set(['client', 'project', 'debt', 'department', 'category', 'custom']);

export function registerExpenseDebtIpc(ipcMain: IpcMain, deps: ExpenseDebtIpcDeps): void {
  const { scheduleAutoBackup } = deps;

  // ─── A. COLLECTION COSTS ───────────────────────────────────────────

  // Linked expenses + roll-up for one debt. Powers the Collection Costs
  // panel on DebtDetail: cost rows, totals by recoverability, recovery
  // progress, and ROI (recovered payments vs money spent collecting).
  ipcMain.handle('debts:collection-costs', (_e, { debt_id }: { debt_id: string }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid || !debt_id) return { error: 'No debt' };
      const dbi = db.getDb();

      const rows = dbi.prepare(`
        SELECT id, date, description, amount, tax_amount, collection_cost_type,
               is_recoverable, recovery_status, recovered_amount, recovered_date,
               added_to_debt, vendor_id, receipt_path
        FROM expenses
        WHERE company_id = ? AND related_debt_id = ? AND COALESCE(deleted_at, '') = ''
        ORDER BY date DESC
      `).all(cid, debt_id) as any[];

      const debt = dbi.prepare(
        'SELECT id, debtor_name, original_amount, payments_made, balance_due, fees_accrued, status, COALESCE(expense_budget, 0) AS expense_budget FROM debts WHERE id = ? AND company_id = ?'
      ).get(debt_id, cid) as any;
      if (!debt) return { error: 'Debt not found' };

      const total = (sel: (r: any) => boolean, pick: (r: any) => number) =>
        Math.round(rows.filter(sel).reduce((s, r) => s + (pick(r) || 0), 0) * 100) / 100;

      const totalCosts = total(() => true, (r) => (r.amount || 0) + (r.tax_amount || 0));
      const recoverable = total((r) => !!r.is_recoverable, (r) => (r.amount || 0) + (r.tax_amount || 0));
      const appliedToDebt = total((r) => !!r.added_to_debt, (r) => (r.amount || 0) + (r.tax_amount || 0));
      const pendingApply = total((r) => !!r.is_recoverable && !r.added_to_debt, (r) => (r.amount || 0) + (r.tax_amount || 0));
      const recovered = total(() => true, (r) => r.recovered_amount || 0);

      // ROI: payments collected on the debt per dollar of collection spend.
      // null (not 0) when nothing has been spent — "no spend yet" and
      // "spent with zero return" are different stories.
      const roi = totalCosts > 0
        ? Math.round(((debt.payments_made || 0) / totalCosts) * 100) / 100
        : null;
      // Cost-to-collect ratio: spend as a share of what's been recovered.
      const costToCollect = (debt.payments_made || 0) > 0
        ? Math.round((totalCosts / debt.payments_made) * 10000) / 100 // percent
        : null;

      return {
        costs: rows,
        summary: {
          total_costs: totalCosts,
          recoverable,
          non_recoverable: Math.round((totalCosts - recoverable) * 100) / 100,
          applied_to_debt: appliedToDebt,
          pending_apply: pendingApply,
          recovered,
          roi,
          cost_to_collect_pct: costToCollect,
          payments_made: debt.payments_made || 0,
          balance_due: debt.balance_due || 0,
          expense_budget: debt.expense_budget || 0,
          over_budget: (debt.expense_budget || 0) > 0 && totalCosts > debt.expense_budget,
        },
      };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // Roll all recoverable, not-yet-applied costs into the debt's balance.
  // Idempotent: each expense is marked added_to_debt=1 inside the same
  // transaction that bumps fees_accrued/balance_due, so re-running applies
  // nothing. Writes a debt_audit_log entry for the paper trail.
  ipcMain.handle('debts:apply-recoverable-costs', (_e, { debt_id }: { debt_id: string }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid || !debt_id) return { error: 'No debt' };
      const dbi = db.getDb();

      const result = dbi.transaction(() => {
        const pending = dbi.prepare(`
          SELECT id, amount, tax_amount FROM expenses
          WHERE company_id = ? AND related_debt_id = ? AND is_recoverable = 1
            AND COALESCE(added_to_debt, 0) = 0 AND COALESCE(deleted_at, '') = ''
        `).all(cid, debt_id) as any[];

        const sum = Math.round(pending.reduce((s, r) => s + (r.amount || 0) + (r.tax_amount || 0), 0) * 100) / 100;
        if (sum <= 0) return { applied: 0, count: 0 };

        dbi.prepare(`
          UPDATE debts SET
            fees_accrued = COALESCE(fees_accrued, 0) + ?,
            balance_due = COALESCE(balance_due, 0) + ?,
            updated_at = datetime('now')
          WHERE id = ? AND company_id = ?
        `).run(sum, sum, debt_id, cid);

        const mark = dbi.prepare('UPDATE expenses SET added_to_debt = 1 WHERE id = ?');
        for (const r of pending) mark.run(r.id);

        try {
          dbi.prepare(`
            INSERT INTO debt_audit_log (id, company_id, debt_id, action, detail, created_at)
            VALUES (?, ?, ?, 'collection_costs_applied', ?, datetime('now'))
          `).run(uuid(), cid, debt_id, `Applied ${pending.length} recoverable collection cost(s) totaling ${sum.toFixed(2)} to balance`);
        } catch { /* audit table shape may differ across installs — non-fatal */ }

        return { applied: sum, count: pending.length };
      })();

      scheduleAutoBackup();
      return { ok: true, ...result };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // Mark a single collection cost's recovery outcome (recovered amount and
  // date, or unrecoverable). Used inline from the Collection Costs panel.
  ipcMain.handle('expenses:set-recovery', (_e, payload: {
    expense_id: string; recovery_status: string; recovered_amount?: number; recovered_date?: string;
  }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No company' };
      const status = ['', 'pending', 'recovered', 'unrecoverable'].includes(payload.recovery_status)
        ? payload.recovery_status : 'pending';
      const dbi = db.getDb();
      dbi.prepare(`
        UPDATE expenses SET
          recovery_status = ?,
          recovered_amount = ?,
          recovered_date = ?,
          updated_at = datetime('now')
        WHERE id = ? AND company_id = ?
      `).run(
        status,
        Math.max(0, Number(payload.recovered_amount) || 0),
        payload.recovered_date || null,
        payload.expense_id, cid,
      );
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // Portfolio-level collection-cost analytics: spend by cost type and by
  // debt, with portfolio ROI. Powers the debt dashboard cost insights.
  ipcMain.handle('debts:collection-cost-analytics', () => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { by_type: [], by_debt: [], portfolio: {} };
      const dbi = db.getDb();

      const byType = dbi.prepare(`
        SELECT COALESCE(NULLIF(collection_cost_type, ''), 'other') AS cost_type,
               COUNT(*) AS count,
               ROUND(SUM(amount + COALESCE(tax_amount, 0)), 2) AS total
        FROM expenses
        WHERE company_id = ? AND related_debt_id IS NOT NULL AND related_debt_id != ''
          AND COALESCE(deleted_at, '') = ''
        GROUP BY cost_type ORDER BY total DESC
      `).all(cid) as any[];

      const byDebt = dbi.prepare(`
        SELECT e.related_debt_id AS debt_id, d.debtor_name,
               ROUND(SUM(e.amount + COALESCE(e.tax_amount, 0)), 2) AS total_costs,
               d.payments_made, d.balance_due, d.status
        FROM expenses e
        JOIN debts d ON d.id = e.related_debt_id
        WHERE e.company_id = ? AND COALESCE(e.deleted_at, '') = ''
        GROUP BY e.related_debt_id ORDER BY total_costs DESC LIMIT 25
      `).all(cid) as any[];

      const totals = dbi.prepare(`
        SELECT ROUND(COALESCE(SUM(e.amount + COALESCE(e.tax_amount, 0)), 0), 2) AS spend
        FROM expenses e
        WHERE e.company_id = ? AND e.related_debt_id IS NOT NULL AND e.related_debt_id != ''
          AND COALESCE(e.deleted_at, '') = ''
      `).get(cid) as any;
      const collected = dbi.prepare(
        "SELECT ROUND(COALESCE(SUM(payments_made), 0), 2) AS collected FROM debts WHERE company_id = ?"
      ).get(cid) as any;

      return {
        by_type: byType,
        by_debt: byDebt,
        portfolio: {
          total_spend: totals?.spend || 0,
          total_collected: collected?.collected || 0,
          roi: (totals?.spend || 0) > 0
            ? Math.round(((collected?.collected || 0) / totals.spend) * 100) / 100
            : null,
        },
      };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // ─── B. EXPENSE ALLOCATIONS ────────────────────────────────────────

  ipcMain.handle('expenses:allocations:get', (_e, { expense_id }: { expense_id: string }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid || !expense_id) return [];
      return db.getDb().prepare(
        'SELECT * FROM expense_allocations WHERE company_id = ? AND expense_id = ? ORDER BY created_at'
      ).all(cid, expense_id);
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // Replace-all save. Validates target types, clamps percents, and checks
  // the split adds up: percent-mode rows must total ≤ 100 (+0.01 float
  // slack); amount-mode rows must total ≤ the expense total. Mixed mode is
  // allowed — percents are resolved against the expense total at read time.
  ipcMain.handle('expenses:allocations:save', (_e, payload: {
    expense_id: string;
    allocations: Array<{
      target_type: string; target_id?: string; target_name?: string;
      percent?: number; amount?: number; is_billable?: boolean; note?: string;
    }>;
  }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No company' };
      const dbi = db.getDb();

      const exp = dbi.prepare(
        'SELECT id, amount, tax_amount FROM expenses WHERE id = ? AND company_id = ?'
      ).get(payload.expense_id, cid) as any;
      if (!exp) return { error: 'Expense not found' };
      const expTotal = Math.round(((exp.amount || 0) + (exp.tax_amount || 0)) * 100) / 100;

      const rows = (payload.allocations || [])
        .filter((a) => ALLOC_TARGET_TYPES.has(a.target_type))
        .map((a) => ({
          target_type: a.target_type,
          target_id: String(a.target_id || ''),
          target_name: String(a.target_name || '').slice(0, 200),
          percent: Math.max(0, Math.min(100, Number(a.percent) || 0)),
          amount: Math.max(0, Math.round((Number(a.amount) || 0) * 100) / 100),
          is_billable: a.is_billable ? 1 : 0,
          note: String(a.note || '').slice(0, 500),
        }))
        // a row must allocate SOMETHING
        .filter((a) => a.percent > 0 || a.amount > 0);

      const pctSum = rows.reduce((s, r) => s + (r.percent || 0), 0);
      if (pctSum > 100.01) return { error: `Percent allocations total ${pctSum.toFixed(1)}% — cannot exceed 100%` };
      const amtSum = Math.round(rows.reduce((s, r) => s + (r.amount || 0), 0) * 100) / 100;
      const pctAsAmt = Math.round(((pctSum / 100) * expTotal) * 100) / 100;
      if (expTotal > 0 && amtSum + pctAsAmt > expTotal + 0.01) {
        return { error: `Allocations total ${(amtSum + pctAsAmt).toFixed(2)} — exceeds the expense total ${expTotal.toFixed(2)}` };
      }

      dbi.transaction(() => {
        dbi.prepare('DELETE FROM expense_allocations WHERE expense_id = ? AND company_id = ?')
          .run(payload.expense_id, cid);
        const ins = dbi.prepare(`
          INSERT INTO expense_allocations
            (id, company_id, expense_id, target_type, target_id, target_name, percent, amount, is_billable, note)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const r of rows) {
          ins.run(uuid(), cid, payload.expense_id, r.target_type, r.target_id, r.target_name, r.percent, r.amount, r.is_billable, r.note);
        }
        dbi.prepare('UPDATE expenses SET allocation_count = ? WHERE id = ?')
          .run(rows.length, payload.expense_id);
      })();

      scheduleAutoBackup();
      return { ok: true, count: rows.length };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // Allocation roll-up by target — "where is the money actually going?"
  // Percent rows are resolved against each expense's total at query time so
  // edits to the expense amount stay consistent automatically.
  ipcMain.handle('expenses:allocation-summary', (_e, opts?: { target_type?: string; from?: string; to?: string }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return [];
      const dbi = db.getDb();
      const where: string[] = ["a.company_id = ?", "COALESCE(e.deleted_at, '') = ''"];
      const params: any[] = [cid];
      if (opts?.target_type && ALLOC_TARGET_TYPES.has(opts.target_type)) {
        where.push('a.target_type = ?'); params.push(opts.target_type);
      }
      if (opts?.from) { where.push('e.date >= ?'); params.push(opts.from); }
      if (opts?.to) { where.push('e.date <= ?'); params.push(opts.to); }

      return dbi.prepare(`
        SELECT a.target_type, a.target_id,
               COALESCE(NULLIF(a.target_name, ''), a.target_id) AS target_name,
               COUNT(DISTINCT a.expense_id) AS expense_count,
               ROUND(SUM(
                 CASE WHEN a.amount > 0 THEN a.amount
                      ELSE (a.percent / 100.0) * (e.amount + COALESCE(e.tax_amount, 0))
                 END
               ), 2) AS allocated_total,
               SUM(a.is_billable) AS billable_count
        FROM expense_allocations a
        JOIN expenses e ON e.id = a.expense_id
        WHERE ${where.join(' AND ')}
        GROUP BY a.target_type, a.target_id
        ORDER BY allocated_total DESC
      `).all(...params);
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // ─── Allocation templates ──────────────────────────────────────────

  ipcMain.handle('expense-alloc-templates:list', () => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return [];
      return db.getDb().prepare(
        'SELECT * FROM expense_allocation_templates WHERE company_id = ? ORDER BY name'
      ).all(cid);
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('expense-alloc-templates:save', (_e, payload: { id?: string; name: string; splits: any[] }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No company' };
      const name = String(payload.name || '').trim().slice(0, 100);
      if (!name) return { error: 'Template name required' };
      const splits = JSON.stringify(
        (payload.splits || []).filter((s: any) => ALLOC_TARGET_TYPES.has(s?.target_type)).slice(0, 20)
      );
      const dbi = db.getDb();
      if (payload.id) {
        dbi.prepare(
          "UPDATE expense_allocation_templates SET name = ?, splits = ?, updated_at = datetime('now') WHERE id = ? AND company_id = ?"
        ).run(name, splits, payload.id, cid);
        return { ok: true, id: payload.id };
      }
      const id = uuid();
      dbi.prepare(
        'INSERT INTO expense_allocation_templates (id, company_id, name, splits) VALUES (?, ?, ?, ?)'
      ).run(id, cid, name, splits);
      scheduleAutoBackup();
      return { ok: true, id };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('expense-alloc-templates:delete', (_e, { id }: { id: string }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No company' };
      db.getDb().prepare('DELETE FROM expense_allocation_templates WHERE id = ? AND company_id = ?').run(id, cid);
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // Validate a cost type string (exposed so the renderer can share the list).
  ipcMain.handle('expenses:collection-cost-types', () => Array.from(COST_TYPES).filter(Boolean));
}
