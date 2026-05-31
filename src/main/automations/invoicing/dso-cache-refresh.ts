// src/main/automations/invoicing/dso-cache-refresh.ts
//
// DSO Cache Refresh
// -----------------
// Recomputes Days-Sales-Outstanding (DSO) per client and persists the
// result into the invoice_dso_cache table for fast dashboard reads.
//
// DSO answers "on average, how many days does it take this client to
// pay us?" We use the classic trailing-window formula:
//
//     DSO = (ending AR balance / credit sales in window) * window_days
//
// over a trailing 365-day window (anchored on ctx.todayISO / local today).
//   • ending AR balance = sum of outstanding balances (total - amount_paid,
//     epsilon-settled) on the client's invoices that have been issued
//     (status != draft/cancelled).
//   • credit sales      = sum of invoice totals issued within the window.
//
// Design notes:
//   • BEST-EFFORT: run() never throws. Any failure degrades to ok:false.
//   • IDEMPOTENT: the cache row is keyed (company_id, client_id) and we
//     UPSERT — re-running the same day overwrites rather than duplicates.
//   • The invoice_dso_cache table may not pre-exist in schema.sql, so we
//     create it defensively with CREATE TABLE IF NOT EXISTS guarded in
//     try/catch. No money is moved, no email sent.
//   • Scoped per company_id; iterates all companies (or ctx.companyId).

import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

const WINDOW_DAYS = 365;
const EPSILON = 0.005;

function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function dateMinusDays(isoDate: string, days: number): string {
  const dt = new Date(`${isoDate}T12:00:00`);
  dt.setDate(dt.getDate() - days);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  let affected = 0;

  let database: any;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  // Defensively ensure the cache table exists.
  try {
    database.prepare(`
      CREATE TABLE IF NOT EXISTS invoice_dso_cache (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        dso_days REAL DEFAULT 0,
        ar_balance REAL DEFAULT 0,
        credit_sales REAL DEFAULT 0,
        window_days INTEGER DEFAULT 365,
        as_of_date TEXT,
        computed_at TEXT DEFAULT (datetime('now')),
        UNIQUE(company_id, client_id)
      )
    `).run();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Could not ensure invoice_dso_cache table: ${err?.message || err}` };
  }

  let companies: { id: string }[] = [];
  try {
    if (ctx?.companyId) {
      companies = [{ id: ctx.companyId }];
    } else {
      companies = (database.prepare(`SELECT id FROM companies`).all() as any[]).map((r) => ({ id: r.id }));
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
  }

  const today = ctx?.todayISO || localTodayISO();
  const windowStart = dateMinusDays(today, WINDOW_DAYS);

  const upsert = database.prepare(`
    INSERT INTO invoice_dso_cache
      (id, company_id, client_id, dso_days, ar_balance, credit_sales, window_days, as_of_date, computed_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(company_id, client_id) DO UPDATE SET
      dso_days = excluded.dso_days,
      ar_balance = excluded.ar_balance,
      credit_sales = excluded.credit_sales,
      window_days = excluded.window_days,
      as_of_date = excluded.as_of_date,
      computed_at = datetime('now')
  `);

  for (const { id: companyId } of companies) {
    let rows: any[] = [];
    try {
      // Per-client AR balance (issued, non-cancelled invoices) and
      // trailing-window credit sales.
      rows = database.prepare(`
        SELECT
          client_id,
          SUM(
            CASE WHEN (COALESCE(total,0) - COALESCE(amount_paid,0)) > ?
                 THEN (COALESCE(total,0) - COALESCE(amount_paid,0))
                 ELSE 0 END
          ) AS ar_balance,
          SUM(
            CASE WHEN issue_date >= ? THEN COALESCE(total,0) ELSE 0 END
          ) AS credit_sales
        FROM invoices
        WHERE company_id = ?
          AND status NOT IN ('draft','cancelled')
        GROUP BY client_id
      `).all(EPSILON, windowStart, companyId) as any[];
    } catch (err: any) {
      warnings.push(`Company ${companyId}: query failed: ${err?.message || err}`);
      continue;
    }

    for (const r of rows) {
      const clientId = r.client_id;
      if (!clientId) continue;
      const arBalance = Number(r.ar_balance) || 0;
      const creditSales = Number(r.credit_sales) || 0;
      // Avoid divide-by-zero: a client with no credit sales in the
      // window has an undefined DSO; record 0 days with the raw figures.
      const dsoDays = creditSales > EPSILON
        ? (arBalance / creditSales) * WINDOW_DAYS
        : 0;
      const rounded = Math.round(dsoDays * 100) / 100;

      try {
        upsert.run(
          `dso_${companyId}_${clientId}`,
          companyId,
          clientId,
          rounded,
          Math.round(arBalance * 100) / 100,
          Math.round(creditSales * 100) / 100,
          WINDOW_DAYS,
          today,
        );
        affected++;
      } catch (err: any) {
        warnings.push(`Company ${companyId} client ${clientId}: upsert failed: ${err?.message || err}`);
      }
    }
  }

  return {
    ok: true,
    affected,
    detail: `Refreshed DSO cache for ${affected} client(s) across ${companies.length} company(ies) as of ${today}.`,
    warnings: warnings.length ? warnings : undefined,
  };
}

export const automation: AutomationModule = {
  id: 'dso-cache-refresh',
  name: 'DSO Cache Refresh',
  domain: 'invoicing',
  trigger: 'daily',
  run,
};
