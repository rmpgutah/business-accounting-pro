// src/main/services/month-end-close.ts
//
// AREA 3 — One-Click Month-End Close
//
// Orchestrates the repetitive, error-prone end-of-month bookkeeping
// ritual into a single user-triggered action. The accountant clicks
// "Close <Month>" and this service runs every preparatory step in
// sequence, recording the outcome of each one so the UI can render a
// checklist-style report ("P&L snapshot OK · 2 warnings · 0 errors").
//
// Design choices (mirrors the cron pattern in src/main/crons/*):
//
//   • Best-effort + never throws. Each step is wrapped in its own
//     try/catch and appended to result.steps[] with an 'ok' | 'warn'
//     | 'skipped' status. A failure in one step does NOT abort the
//     others — a month-end close is informational/preparatory, so we
//     want the user to see ALL findings, not bail on the first hiccup.
//
//   • Idempotent. Re-running for the same period recomputes snapshots
//     and re-flags warnings; it writes a fresh period_close_log row
//     each non-dry run (an append-only audit trail of close attempts).
//
//   • dryRun (preview) does everything EXCEPT mutate: no status
//     reconciliation writes, no period_close_log row, no period lock.
//     getMonthEndPreview() is just runMonthEndClose({ dryRun: true }).
//
//   • Money comparisons use a 0.005 epsilon (a balance is considered
//     settled when (total - amount_paid) <= 0.005).
//
//   • The optional period LOCK on a real close uses the existing
//     period_locks table (id, company_id, period_start, period_end,
//     locked_through_date, locked_by, reason). We DO insert a lock on
//     non-dry runs, but ALSO emit a warning telling the integrator to
//     confirm this is the lock mechanism their UI reads, since the app
//     also has a separate closed_periods table.
//
//   • Pure-ish: "today"/period boundaries are derived from the year
//     and month the caller passes, never from a hidden system-clock
//     read inside helpers.

import type { Database } from 'better-sqlite3';
import * as db from '../database';

export interface MonthEndCloseResult {
  period: string; // "2026-05" label
  steps: Array<{ name: string; status: 'ok' | 'warn' | 'skipped'; detail: string }>;
  warnings: string[];
  errors: string[];
}

const EPS = 0.005;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// Last day of the given month (handles leap years via JS Date day-0 trick).
function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

interface PeriodBounds {
  label: string;     // "2026-05"
  start: string;     // "2026-05-01"
  end: string;       // "2026-05-31"
}

function computePeriod(year: number, month: number): PeriodBounds {
  const mm = pad2(month);
  const start = `${year}-${mm}-01`;
  const end = `${year}-${mm}-${pad2(lastDayOfMonth(year, month))}`;
  return { label: `${year}-${mm}`, start, end };
}

function genId(): string {
  // Match the loose id convention used elsewhere (db.create uses uuid,
  // but for raw INSERTs we mint a sortable unique id).
  return `mec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function runMonthEndClose(opts: {
  companyId: string;
  year: number;
  month: number;
  dryRun?: boolean;
}): MonthEndCloseResult {
  const { companyId, year, month } = opts;
  const dryRun = opts.dryRun === true;
  const bounds = computePeriod(year, month);

  const result: MonthEndCloseResult = {
    period: bounds.label,
    steps: [],
    warnings: [],
    errors: [],
  };

  const step = (name: string, status: 'ok' | 'warn' | 'skipped', detail: string) => {
    result.steps.push({ name, status, detail });
    if (status === 'warn') result.warnings.push(`${name}: ${detail}`);
  };

  // Validate inputs early — never throw, just record an error.
  if (!companyId || !Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    result.errors.push(`Invalid period inputs (companyId="${companyId}", year=${year}, month=${month}).`);
    return result;
  }

  let database: Database;
  try {
    database = db.getDb();
  } catch (err: any) {
    result.errors.push(`Database not ready: ${err?.message || err}`);
    return result;
  }

  // ── Step 1: Reconcile invoice/bill status for the period ──────────
  // The status-reconcile cron may not exist yet; require it lazily and
  // degrade gracefully if it's absent. Skip the mutation entirely on
  // a dry run.
  try {
    if (dryRun) {
      step('Reconcile invoice/bill status', 'skipped', 'Dry run — status reconciliation not executed.');
    } else {
      let reconcile: any = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('../crons/status-reconcile');
        reconcile = mod?.runStatusReconcile || mod?.default || null;
      } catch {
        reconcile = null;
      }
      if (typeof reconcile === 'function') {
        const r = reconcile({ companyId });
        const flipped =
          (r?.invoicesFixed ?? r?.invoicesFlipped ?? 0) +
          (r?.billsFixed ?? r?.billsFlipped ?? 0);
        step('Reconcile invoice/bill status', 'ok', `status-reconcile ran (${flipped} record(s) updated).`);
      } else {
        step(
          'Reconcile invoice/bill status',
          'skipped',
          "status-reconcile module not found — skipped (integrator: add src/main/crons/status-reconcile.ts to enable)."
        );
      }
    }
  } catch (err: any) {
    step('Reconcile invoice/bill status', 'warn', `Reconcile failed: ${err?.message || err}`);
  }

  // ── Step 2: Snapshot P&L numbers for the month ────────────────────
  // revenue  = sum of invoice subtotal for invoices ISSUED in the month
  //            (subtotal is pre-tax, pre-discount = the FINAL-PRICE
  //            revenue invariant), excluding cancelled.
  // expenses = sum of expense amount INCURRED in the month.
  // payroll  = sum of payroll_runs.total_gross with pay_date in month.
  let revenue = 0;
  let expensesTotal = 0;
  let payrollGross = 0;
  try {
    const rev = database.prepare(`
      SELECT COALESCE(SUM(subtotal), 0) AS v
      FROM invoices
      WHERE company_id = ?
        AND issue_date >= ? AND issue_date <= ?
        AND status != 'cancelled'
    `).get(companyId, bounds.start, bounds.end) as { v: number };
    revenue = Number(rev?.v || 0);

    const exp = database.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS v
      FROM expenses
      WHERE company_id = ?
        AND date >= ? AND date <= ?
    `).get(companyId, bounds.start, bounds.end) as { v: number };
    expensesTotal = Number(exp?.v || 0);

    const pay = database.prepare(`
      SELECT COALESCE(SUM(total_gross), 0) AS v
      FROM payroll_runs
      WHERE company_id = ?
        AND pay_date >= ? AND pay_date <= ?
    `).get(companyId, bounds.start, bounds.end) as { v: number };
    payrollGross = Number(pay?.v || 0);

    const netIncome = revenue - expensesTotal;
    step(
      'P&L snapshot',
      'ok',
      `Revenue ${revenue.toFixed(2)} · Expenses ${expensesTotal.toFixed(2)} · ` +
        `Payroll gross ${payrollGross.toFixed(2)} · Net ${netIncome.toFixed(2)}`
    );
  } catch (err: any) {
    step('P&L snapshot', 'warn', `Snapshot failed: ${err?.message || err}`);
  }

  // ── Step 3: Flag UNREMITTED taxes ─────────────────────────────────
  // (a) Sales tax billed (invoice tax_amount on issued invoices in the
  //     month) that has not been remitted. We have no remittance table
  //     wired here, so we surface the BILLED amount as a remittance
  //     reminder (warn if > 0).
  // (b) Payroll taxes withheld (employee fed+state+SS+medicare on pay
  //     stubs whose run pay_date falls in the month) not yet remitted.
  try {
    const salesTaxRow = database.prepare(`
      SELECT COALESCE(SUM(tax_amount), 0) AS v
      FROM invoices
      WHERE company_id = ?
        AND issue_date >= ? AND issue_date <= ?
        AND status != 'cancelled'
    `).get(companyId, bounds.start, bounds.end) as { v: number };
    const salesTaxBilled = Number(salesTaxRow?.v || 0);

    const payrollTaxRow = database.prepare(`
      SELECT COALESCE(SUM(ps.federal_tax + ps.state_tax + ps.social_security + ps.medicare), 0) AS v
      FROM pay_stubs ps
      JOIN payroll_runs pr ON pr.id = ps.payroll_run_id
      WHERE pr.company_id = ?
        AND pr.pay_date >= ? AND pr.pay_date <= ?
    `).get(companyId, bounds.start, bounds.end) as { v: number };
    const payrollTaxWithheld = Number(payrollTaxRow?.v || 0);

    if (salesTaxBilled > EPS || payrollTaxWithheld > EPS) {
      step(
        'Unremitted taxes',
        'warn',
        `Sales tax billed-not-remitted ${salesTaxBilled.toFixed(2)} · ` +
          `Payroll taxes withheld-not-remitted ${payrollTaxWithheld.toFixed(2)} — confirm remittance before close.`
      );
    } else {
      step('Unremitted taxes', 'ok', 'No outstanding sales or payroll tax liabilities for the period.');
    }
  } catch (err: any) {
    step('Unremitted taxes', 'warn', `Tax flag check failed: ${err?.message || err}`);
  }

  // ── Step 4: Flag still-open / overdue A/R as of period end ────────
  // Any invoice issued on/before period end that is not paid/cancelled
  // and still carries a balance (total - amount_paid > epsilon).
  try {
    const arRow = database.prepare(`
      SELECT
        COUNT(*) AS cnt,
        COALESCE(SUM(COALESCE(total,0) - COALESCE(amount_paid,0)), 0) AS bal
      FROM invoices
      WHERE company_id = ?
        AND issue_date <= ?
        AND status NOT IN ('paid', 'cancelled', 'draft')
        AND (COALESCE(total,0) - COALESCE(amount_paid,0)) > ?
    `).get(companyId, bounds.end, EPS) as { cnt: number; bal: number };
    const openCount = Number(arRow?.cnt || 0);
    const openBalance = Number(arRow?.bal || 0);

    if (openCount > 0) {
      step(
        'Open A/R at period end',
        'warn',
        `${openCount} unpaid invoice(s) totalling ${openBalance.toFixed(2)} outstanding as of ${bounds.end}.`
      );
    } else {
      step('Open A/R at period end', 'ok', 'No outstanding receivables as of period end.');
    }
  } catch (err: any) {
    step('Open A/R at period end', 'warn', `A/R check failed: ${err?.message || err}`);
  }

  // ── Step 5: Write period_close_log + (optional) lock the period ───
  // On dry run we write nothing — just record intent. On a real close
  // we append a period_close_log row and insert a period_locks row,
  // then warn the integrator to confirm the lock table matches their UI.
  try {
    if (dryRun) {
      step('Record close + lock period', 'skipped', 'Dry run — no log row or period lock written.');
    } else {
      const netIncome = revenue - expensesTotal;
      const closedBy = ''; // No authenticated-user id is threaded into services; left blank.
      const notes = JSON.stringify({
        revenue, expenses: expensesTotal, payrollGross, netIncome,
        source: 'month-end-close',
      });

      const logId = genId();
      database.prepare(`
        INSERT INTO period_close_log
          (id, company_id, period_start, period_end, closed_at, closed_by, closing_je_id, net_income, notes)
        VALUES (?, ?, ?, ?, datetime('now'), ?, '', ?, ?)
      `).run(logId, companyId, bounds.start, bounds.end, closedBy, netIncome, notes);

      // Best-effort audit trail.
      try {
        db.logAudit(companyId, 'period_close_log', logId, 'month_end_close', {
          period: bounds.label, revenue, expenses: expensesTotal, payrollGross, netIncome,
        });
      } catch { /* audit best-effort */ }

      // Optional period lock via existing period_locks table.
      let lockNote = '';
      try {
        const lockId = genId();
        database.prepare(`
          INSERT INTO period_locks
            (id, company_id, period_start, period_end, locked_through_date, locked_by, reason)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(lockId, companyId, bounds.start, bounds.end, bounds.end, closedBy, `Month-end close ${bounds.label}`);
        lockNote = ` Period locked through ${bounds.end} (period_locks id=${lockId}).`;
      } catch (lockErr: any) {
        lockNote = ` Period lock NOT written: ${lockErr?.message || lockErr}.`;
      }

      step('Record close + lock period', 'ok', `period_close_log id=${logId}.${lockNote}`);
      // Tell the integrator to verify the lock target — the app also has
      // a separate closed_periods table some UIs read instead.
      result.warnings.push(
        'Record close + lock period: integrator must confirm period_locks is the lock mechanism your UI reads ' +
          '(a separate closed_periods table also exists). Reconcile if the close should write there instead.'
      );
    }
  } catch (err: any) {
    step('Record close + lock period', 'warn', `Failed to record close: ${err?.message || err}`);
  }

  return result;
}

export function getMonthEndPreview(
  companyId: string,
  year: number,
  month: number
): MonthEndCloseResult {
  return runMonthEndClose({ companyId, year, month, dryRun: true });
}
