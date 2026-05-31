// src/main/automations/reporting-finance/monthly-financial-snapshot.ts
//
// Monthly Financial Snapshot
// ---------------------------
// Captures a per-company monthly snapshot of revenue, expenses and net
// income into the `analytics_snapshots` table so the dashboard /
// reporting layer can trend month-over-month performance without
// re-aggregating the entire ledger every render.
//
// Design notes:
//  • trigger = 'monthly' — runs once per period. Snapshots the PREVIOUS
//    completed month (the just-closed period) which is the period users
//    care about at month start. If todayISO is mid-month it still keys
//    off the prior full month.
//  • IDEMPOTENT — one row per (company_id, period). Re-running upserts
//    the same row (INSERT OR REPLACE on a UNIQUE key) rather than
//    duplicating. Re-running the same day produces no net new rows.
//  • The `analytics_snapshots` table may not exist yet in older DBs, so
//    we CREATE TABLE IF NOT EXISTS defensively before writing. This is a
//    pure additive analytics cache; it never mutates source ledgers.
//  • Revenue = sum of invoice `total` for invoices issued in-period that
//    are not draft/cancelled. Expenses = sum of `expenses.amount` dated
//    in-period. Net = revenue - expenses. No money is moved.
//  • run() is BEST-EFFORT and never throws — every db call is guarded.

import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Given an ISO date, return the [start, endExclusive, label] of the
// PREVIOUS calendar month relative to that date.
function prevMonthRange(todayISO: string): { start: string; endExclusive: string; period: string } {
  // Anchor at noon local to avoid DST/TZ edge shifts.
  const base = new Date(`${todayISO}T12:00:00`);
  if (isNaN(base.getTime())) {
    const now = new Date();
    base.setTime(now.getTime());
  }
  // First day of the month that contains `base`.
  const firstOfThisMonth = new Date(base.getFullYear(), base.getMonth(), 1, 12, 0, 0);
  // Previous month start.
  const prevStart = new Date(firstOfThisMonth.getFullYear(), firstOfThisMonth.getMonth() - 1, 1, 12, 0, 0);
  const fmt = (d: Date) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };
  return {
    start: fmt(prevStart),
    endExclusive: fmt(firstOfThisMonth),
    period: `${prevStart.getFullYear()}-${String(prevStart.getMonth() + 1).padStart(2, '0')}`,
  };
}

export const automation: AutomationModule = {
  id: 'monthly-financial-snapshot',
  name: 'Monthly Financial Snapshot',
  domain: 'reporting-finance',
  trigger: 'monthly',
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
    const warnings: string[] = [];
    let affected = 0;

    let database;
    try {
      database = db.getDb();
    } catch (err: any) {
      return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
    }

    const today = ctx?.todayISO || localTodayISO();
    const { start, endExclusive, period } = prevMonthRange(today);

    // Ensure the analytics cache table exists (additive, idempotent).
    try {
      database.prepare(`
        CREATE TABLE IF NOT EXISTS analytics_snapshots (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          period TEXT NOT NULL,
          revenue REAL DEFAULT 0,
          expenses REAL DEFAULT 0,
          net REAL DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now')),
          UNIQUE(company_id, period)
        )
      `).run();
    } catch (err: any) {
      return { ok: false, affected: 0, detail: `Failed to ensure analytics_snapshots: ${err?.message || err}` };
    }

    // Resolve the set of companies to snapshot.
    let companies: { id: string }[] = [];
    try {
      if (ctx?.companyId) {
        companies = [{ id: ctx.companyId }];
      } else {
        companies = database.prepare(`SELECT id FROM companies`).all() as { id: string }[];
      }
    } catch (err: any) {
      return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
    }

    if (companies.length === 0) {
      return { ok: true, affected: 0, detail: `No companies to snapshot for ${period}` };
    }

    const upsert = (() => {
      try {
        return database.prepare(`
          INSERT INTO analytics_snapshots (id, company_id, period, revenue, expenses, net, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
          ON CONFLICT(company_id, period) DO UPDATE SET
            revenue = excluded.revenue,
            expenses = excluded.expenses,
            net = excluded.net,
            updated_at = datetime('now')
        `);
      } catch {
        return null;
      }
    })();

    if (!upsert) {
      return { ok: false, affected: 0, detail: 'Failed to prepare upsert statement' };
    }

    for (const { id: companyId } of companies) {
      let revenue = 0;
      let expenses = 0;

      // Revenue: invoices issued in-period, excluding draft/cancelled.
      try {
        const row = database.prepare(`
          SELECT COALESCE(SUM(total), 0) AS revenue
          FROM invoices
          WHERE company_id = ?
            AND status NOT IN ('draft', 'cancelled')
            AND issue_date IS NOT NULL
            AND issue_date >= ?
            AND issue_date < ?
        `).get(companyId, start, endExclusive) as any;
        revenue = Number(row?.revenue || 0);
      } catch (err: any) {
        warnings.push(`Revenue query failed for ${companyId}: ${err?.message || err}`);
        continue;
      }

      // Expenses: expense rows dated in-period.
      try {
        const row = database.prepare(`
          SELECT COALESCE(SUM(amount), 0) AS expenses
          FROM expenses
          WHERE company_id = ?
            AND date IS NOT NULL
            AND date >= ?
            AND date < ?
        `).get(companyId, start, endExclusive) as any;
        expenses = Number(row?.expenses || 0);
      } catch (err: any) {
        warnings.push(`Expense query failed for ${companyId}: ${err?.message || err}`);
        continue;
      }

      const net = revenue - expenses;
      const snapshotId = `snap_${companyId}_${period}`;

      try {
        upsert.run(snapshotId, companyId, period, revenue, expenses, net);
        affected++;
      } catch (err: any) {
        warnings.push(`Upsert failed for ${companyId}: ${err?.message || err}`);
      }
    }

    return {
      ok: true,
      affected,
      detail: `Snapshotted ${affected} company period(s) for ${period}`,
      ...(warnings.length ? { warnings } : {}),
    };
  },
};
