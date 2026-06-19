// src/main/ipc/debt-wave.ts
//
// Debt Collections 200 Wave — collectability scoring, portfolio action
// queue, per-case expense budgets, write-off cost sync, bulk expense
// linking, and employee wage-withholding agreements (per-paycheck
// deductions applied to a debt case, with a printable authorization form
// rendered renderer-side).
//
// Registered from registerIpcHandlers() via registerDebtWaveIpc().

import { IpcMain } from 'electron';
import { v4 as uuid } from 'uuid';
import * as db from '../database';

interface DebtWaveIpcDeps {
  scheduleAutoBackup: () => void;
}

export function registerDebtWaveIpc(ipcMain: IpcMain, deps: DebtWaveIpcDeps): void {
  const { scheduleAutoBackup } = deps;

  // ─── Collectability scoring ────────────────────────────────────────
  // Score 0-100 per active debt. Weighted components:
  //   recency of last payment (35) — money talks: recent payers keep paying
  //   age of debt (25)            — collectability decays hard with age
  //   stage (20)                  — early-stage cases outperform legal-stage
  //   promise history (10)        — kept promises predict payment
  //   balance size (10)           — small balances clear more often
  // Scores persist on the debt row so lists can sort without recompute.
  ipcMain.handle('debt:score-all', () => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { scored: 0, debts: [] };
      const dbi = db.getDb();

      const debts = dbi.prepare(`
        SELECT d.id, d.original_amount, d.balance_due, d.payments_made, d.current_stage,
               d.created_at, d.due_date, d.delinquent_date, d.debtor_name, d.status,
               (SELECT MAX(received_date) FROM debt_payments p WHERE p.debt_id = d.id) AS last_payment_date,
               (SELECT COUNT(*) FROM debt_promises pr WHERE pr.debt_id = d.id AND pr.kept = 1) AS promises_kept,
               (SELECT COUNT(*) FROM debt_promises pr WHERE pr.debt_id = d.id) AS promises_total
        FROM debts d
        WHERE d.company_id = ? AND d.status NOT IN ('settled', 'written_off')
      `).all(cid) as any[];

      const now = Date.now();
      const days = (iso: string | null): number | null => {
        if (!iso) return null;
        const t = new Date(String(iso).slice(0, 10) + 'T12:00:00').getTime();
        return Number.isFinite(t) ? Math.floor((now - t) / 86400000) : null;
      };

      const STAGE_SCORES: Record<string, number> = {
        reminder: 20, warning: 17, final_notice: 14, demand_letter: 11,
        collections_agency: 8, legal_action: 5, judgment: 8, garnishment: 12,
      };

      const update = dbi.prepare(
        "UPDATE debts SET collectability_score = ?, score_updated_at = datetime('now') WHERE id = ?"
      );
      const scored = debts.map((d) => {
        // Payment recency (35): paid within 30d → full; decays to 0 at 365d.
        const sincePay = days(d.last_payment_date);
        const payScore = sincePay == null ? (d.payments_made > 0 ? 5 : 0)
          : Math.max(0, 35 * (1 - Math.max(0, sincePay - 30) / 335));
        // Age (25): fresh debt → full; decays to 0 at 4 years.
        const age = days(d.delinquent_date || d.created_at) ?? 0;
        const ageScore = Math.max(0, 25 * (1 - age / 1460));
        // Stage (20)
        const stageScore = STAGE_SCORES[d.current_stage] ?? 10;
        // Promises (10): kept-ratio, neutral 5 when no history.
        const promiseScore = d.promises_total > 0 ? 10 * (d.promises_kept / d.promises_total) : 5;
        // Balance (10): ≤$500 → full; ≥$50k → 0 (log-ish linear cut).
        const bal = Math.max(0, d.balance_due || 0);
        const balScore = bal <= 500 ? 10 : Math.max(0, 10 * (1 - (bal - 500) / 49500));

        const score = Math.round(Math.min(100, Math.max(0, payScore + ageScore + stageScore + promiseScore + balScore)));
        update.run(score, d.id);
        return { id: d.id, debtor_name: d.debtor_name, balance_due: d.balance_due, score, stage: d.current_stage };
      }).sort((a, b) => b.score - a.score);

      scheduleAutoBackup();
      return { scored: scored.length, debts: scored };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // ─── Portfolio action queue ────────────────────────────────────────
  // "What should I work on today?" — one query pass over active cases
  // emitting prioritized recommendations. Pure read; no side effects.
  ipcMain.handle('debt:action-queue', () => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return [];
      const dbi = db.getDb();
      const actions: Array<{
        debt_id: string; debtor_name: string; balance_due: number;
        action: string; reason: string; severity: 'info' | 'warning' | 'urgent';
      }> = [];

      const safe = <T,>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };

      // 1. Stale cases — no communication or payment in 30+ days.
      const stale = safe(() => dbi.prepare(`
        SELECT d.id, d.debtor_name, d.balance_due,
          MAX(COALESCE(
            (SELECT MAX(c.sent_date) FROM debt_communications c WHERE c.debt_id = d.id),
            (SELECT MAX(p.received_date) FROM debt_payments p WHERE p.debt_id = d.id),
            substr(d.created_at, 1, 10)
          )) AS last_activity
        FROM debts d
        WHERE d.company_id = ? AND d.status IN ('active', 'in_collection') AND d.hold = 0
        GROUP BY d.id
        HAVING last_activity < date('now', '-30 days')
        ORDER BY d.balance_due DESC LIMIT 15
      `).all(cid), [] as any[]);
      for (const s of stale) {
        actions.push({
          debt_id: s.id, debtor_name: s.debtor_name, balance_due: s.balance_due,
          action: 'Follow up', reason: `No activity since ${s.last_activity}`, severity: 'warning',
        });
      }

      // 2. Statute of limitations expiring within 90 days — urgent.
      const sol = safe(() => dbi.prepare(`
        SELECT id, debtor_name, balance_due, statute_of_limitations_date
        FROM debts
        WHERE company_id = ? AND status NOT IN ('settled', 'written_off')
          AND statute_of_limitations_date IS NOT NULL AND statute_of_limitations_date != ''
          AND statute_of_limitations_date <= date('now', '+90 days')
          AND statute_of_limitations_date >= date('now')
        ORDER BY statute_of_limitations_date LIMIT 10
      `).all(cid), [] as any[]);
      for (const s of sol) {
        actions.push({
          debt_id: s.id, debtor_name: s.debtor_name, balance_due: s.balance_due,
          action: 'File before SOL', reason: `Statute of limitations ${s.statute_of_limitations_date}`, severity: 'urgent',
        });
      }

      // 3. Overdue payment-plan installments.
      const missed = safe(() => dbi.prepare(`
        SELECT d.id, d.debtor_name, d.balance_due, i.due_date, i.amount
        FROM debt_plan_installments i
        JOIN debt_payment_plans pl ON pl.id = i.plan_id
        JOIN debts d ON d.id = pl.debt_id
        WHERE d.company_id = ? AND i.paid = 0 AND i.due_date < date('now')
          AND pl.status = 'active' AND d.status NOT IN ('settled', 'written_off')
        ORDER BY i.due_date LIMIT 15
      `).all(cid), [] as any[]);
      for (const m of missed) {
        actions.push({
          debt_id: m.id, debtor_name: m.debtor_name, balance_due: m.balance_due,
          action: 'Chase missed installment', reason: `${Number(m.amount).toFixed(2)} due ${m.due_date}`, severity: 'urgent',
        });
      }

      // 4. Pending settlement offers older than 14 days.
      const offers = safe(() => dbi.prepare(`
        SELECT d.id, d.debtor_name, d.balance_due, s.offer_amount, s.offered_date
        FROM debt_settlements s JOIN debts d ON d.id = s.debt_id
        WHERE d.company_id = ? AND s.response = 'pending' AND s.offered_date < date('now', '-14 days')
        ORDER BY s.offered_date LIMIT 10
      `).all(cid), [] as any[]);
      for (const o of offers) {
        actions.push({
          debt_id: o.id, debtor_name: o.debtor_name, balance_due: o.balance_due,
          action: 'Respond to settlement offer', reason: `${Number(o.offer_amount).toFixed(2)} offered ${o.offered_date}`, severity: 'warning',
        });
      }

      // 5. Collection spend exceeding the case budget.
      const overBudget = safe(() => dbi.prepare(`
        SELECT d.id, d.debtor_name, d.balance_due, d.expense_budget,
               ROUND(COALESCE(SUM(e.amount + COALESCE(e.tax_amount, 0)), 0), 2) AS spend
        FROM debts d
        JOIN expenses e ON e.related_debt_id = d.id AND COALESCE(e.deleted_at, '') = ''
        WHERE d.company_id = ? AND d.expense_budget > 0
          AND d.status NOT IN ('settled', 'written_off')
        GROUP BY d.id HAVING spend > d.expense_budget
        ORDER BY spend - d.expense_budget DESC LIMIT 10
      `).all(cid), [] as any[]);
      for (const b of overBudget) {
        actions.push({
          debt_id: b.id, debtor_name: b.debtor_name, balance_due: b.balance_due,
          action: 'Review collection spend', reason: `Spend ${b.spend.toFixed(2)} exceeds budget ${Number(b.expense_budget).toFixed(2)}`, severity: 'warning',
        });
      }

      // Urgent first, then by balance descending within severity.
      const sevRank = { urgent: 0, warning: 1, info: 2 } as const;
      actions.sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || b.balance_due - a.balance_due);
      return actions.slice(0, 40);
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // ─── Per-case expense budget ───────────────────────────────────────
  ipcMain.handle('debt:set-expense-budget', (_e, { debt_id, budget }: { debt_id: string; budget: number }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No company' };
      db.getDb().prepare(
        "UPDATE debts SET expense_budget = ?, updated_at = datetime('now') WHERE id = ? AND company_id = ?"
      ).run(Math.max(0, Number(budget) || 0), debt_id, cid);
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // ─── Write-off cost sync ───────────────────────────────────────────
  // When a debt is written off, its recoverable costs are by definition
  // unrecoverable. One call flips every still-pending linked cost.
  ipcMain.handle('debts:mark-costs-unrecoverable', (_e, { debt_id }: { debt_id: string }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No company' };
      const r = db.getDb().prepare(`
        UPDATE expenses SET recovery_status = 'unrecoverable', updated_at = datetime('now')
        WHERE company_id = ? AND related_debt_id = ? AND is_recoverable = 1
          AND recovery_status NOT IN ('recovered', 'unrecoverable')
      `).run(cid, debt_id);
      return { ok: true, updated: r.changes };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // ─── Bulk expense → debt linking ───────────────────────────────────
  ipcMain.handle('expenses:bulk-link-debt', (_e, payload: {
    expense_ids: string[]; debt_id: string; cost_type?: string; is_recoverable?: boolean;
  }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No company' };
      const ids = (payload.expense_ids || []).filter(Boolean).slice(0, 200);
      if (!ids.length) return { error: 'No expenses selected' };
      const dbi = db.getDb();
      const debt = dbi.prepare('SELECT id FROM debts WHERE id = ? AND company_id = ?').get(payload.debt_id, cid);
      if (!debt) return { error: 'Debt not found' };

      const stmt = dbi.prepare(`
        UPDATE expenses SET related_debt_id = ?, collection_cost_type = ?, is_recoverable = ?, updated_at = datetime('now')
        WHERE id = ? AND company_id = ?
      `);
      let updated = 0;
      dbi.transaction(() => {
        for (const id of ids) {
          const r = stmt.run(payload.debt_id, payload.cost_type || 'other', payload.is_recoverable ? 1 : 0, id, cid);
          updated += r.changes;
        }
      })();
      scheduleAutoBackup();
      return { ok: true, updated };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // ─── Employee wage withholding ─────────────────────────────────────

  ipcMain.handle('hr:withholding:list', (_e, opts?: { employee_id?: string; debt_id?: string }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return [];
      const dbi = db.getDb();
      const where: string[] = ['w.company_id = ?'];
      const params: any[] = [cid];
      if (opts?.employee_id) { where.push('w.employee_id = ?'); params.push(opts.employee_id); }
      if (opts?.debt_id) { where.push('w.debt_id = ?'); params.push(opts.debt_id); }
      return dbi.prepare(`
        SELECT w.*, e.name AS employee_name, d.debtor_name, d.balance_due
        FROM employee_wage_withholdings w
        LEFT JOIN employees e ON e.id = w.employee_id
        LEFT JOIN debts d ON d.id = w.debt_id
        WHERE ${where.join(' AND ')}
        ORDER BY w.created_at DESC
      `).all(...params);
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('hr:withholding:save', (_e, payload: {
    id?: string; employee_id: string; debt_id: string; per_pay_amount: number;
    start_date?: string; agreement_signed_date?: string; notes?: string;
  }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No company' };
      const amount = Math.round((Number(payload.per_pay_amount) || 0) * 100) / 100;
      if (amount <= 0) return { error: 'Per-paycheck amount must be positive' };
      const dbi = db.getDb();

      const debt = dbi.prepare(
        "SELECT id FROM debts WHERE id = ? AND company_id = ? AND debtor_type = 'employee'"
      ).get(payload.debt_id, cid);
      if (!debt) return { error: 'Debt case not found (must be an employee-debtor case)' };

      if (payload.id) {
        dbi.prepare(`
          UPDATE employee_wage_withholdings SET per_pay_amount = ?, start_date = ?,
            agreement_signed_date = ?, notes = ?, updated_at = datetime('now')
          WHERE id = ? AND company_id = ?
        `).run(amount, payload.start_date || null, payload.agreement_signed_date || null,
          String(payload.notes || '').slice(0, 1000), payload.id, cid);
        return { ok: true, id: payload.id };
      }
      const id = uuid();
      dbi.prepare(`
        INSERT INTO employee_wage_withholdings
          (id, company_id, employee_id, debt_id, per_pay_amount, start_date, agreement_signed_date, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, cid, payload.employee_id, payload.debt_id, amount,
        payload.start_date || null, payload.agreement_signed_date || null,
        String(payload.notes || '').slice(0, 1000));
      scheduleAutoBackup();
      return { ok: true, id };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('hr:withholding:stop', (_e, { id }: { id: string }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No company' };
      db.getDb().prepare(
        "UPDATE employee_wage_withholdings SET status = 'stopped', end_date = date('now'), updated_at = datetime('now') WHERE id = ? AND company_id = ?"
      ).run(id, cid);
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // Record one paycheck's deduction: inserts a debt_payments row (method
  // 'garnishment' — the closest schema-checked method for wage
  // withholding), reduces the debt balance, bumps the withholding
  // counters, and auto-completes the agreement when the debt clears.
  ipcMain.handle('hr:withholding:record-deduction', (_e, { withholding_id, amount, pay_date }: {
    withholding_id: string; amount?: number; pay_date?: string;
  }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No company' };
      const dbi = db.getDb();
      const w = dbi.prepare(
        'SELECT * FROM employee_wage_withholdings WHERE id = ? AND company_id = ?'
      ).get(withholding_id, cid) as any;
      if (!w) return { error: 'Withholding not found' };
      if (w.status !== 'active') return { error: `Agreement is ${w.status}` };

      const debt = dbi.prepare('SELECT id, balance_due, payments_made FROM debts WHERE id = ?').get(w.debt_id) as any;
      if (!debt) return { error: 'Linked debt no longer exists' };

      // Never deduct more than the remaining balance.
      const requested = Math.round((Number(amount) || Number(w.per_pay_amount) || 0) * 100) / 100;
      const applied = Math.min(requested, Math.max(0, debt.balance_due || 0));
      if (applied <= 0) return { error: 'Debt balance is already zero' };
      const date = pay_date || new Date().toISOString().slice(0, 10);

      const result = dbi.transaction(() => {
        dbi.prepare(`
          INSERT INTO debt_payments (id, debt_id, amount, method, received_date, applied_to_principal, notes)
          VALUES (?, ?, ?, 'garnishment', ?, ?, ?)
        `).run(uuid(), w.debt_id, applied, date, applied, `Wage withholding ${withholding_id} payroll deduction`);

        const newBalance = Math.round(Math.max(0, (debt.balance_due || 0) - applied) * 100) / 100;
        dbi.prepare(`
          UPDATE debts SET payments_made = COALESCE(payments_made, 0) + ?, balance_due = ?,
            status = CASE WHEN ? <= 0 THEN 'settled' ELSE status END,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(applied, newBalance, newBalance, w.debt_id);

        dbi.prepare(`
          UPDATE employee_wage_withholdings SET
            total_withheld = COALESCE(total_withheld, 0) + ?,
            deduction_count = COALESCE(deduction_count, 0) + 1,
            status = CASE WHEN ? <= 0 THEN 'completed' ELSE status END,
            end_date = CASE WHEN ? <= 0 THEN date('now') ELSE end_date END,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(applied, newBalance, newBalance, withholding_id);

        return { applied, new_balance: newBalance, completed: newBalance <= 0 };
      })();

      scheduleAutoBackup();
      return { ok: true, ...result };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // Data payload for the printable wage-withholding agreement.
  ipcMain.handle('hr:withholding:agreement-data', (_e, { withholding_id }: { withholding_id: string }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No company' };
      const dbi = db.getDb();
      const w = dbi.prepare(
        'SELECT * FROM employee_wage_withholdings WHERE id = ? AND company_id = ?'
      ).get(withholding_id, cid) as any;
      if (!w) return { error: 'Withholding not found' };
      const employee = dbi.prepare('SELECT id, name, email, job_title, department, pay_schedule FROM employees WHERE id = ?').get(w.employee_id) as any;
      const debt = dbi.prepare('SELECT id, debtor_name, original_amount, balance_due, payments_made, notes FROM debts WHERE id = ?').get(w.debt_id) as any;
      const company = dbi.prepare('SELECT * FROM companies WHERE id = ?').get(cid) as any;
      return { withholding: w, employee, debt, company };
    } catch (err: any) {
      return { error: err?.message };
    }
  });
}
