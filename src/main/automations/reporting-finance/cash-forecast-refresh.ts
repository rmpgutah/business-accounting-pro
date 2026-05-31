// src/main/automations/reporting-finance/cash-forecast-refresh.ts
//
// Cash Forecast Refresh
//
// Rebuilds a DIRECT cash-flow forecast for each company from open
// Accounts-Receivable (invoices owed to us) and Accounts-Payable
// (bills we owe). For every open invoice/bill with a remaining
// balance > epsilon, we emit one forecast LINE bucketed by due_date
// (inflow for AR, outflow for AP). A per-company forecast HEADER row
// summarises projected net cash movement.
//
// Design choices:
//
//  • Tables (direct_cash_forecasts / cash_forecast_lines) are NOT in
//    schema.sql, so we CREATE TABLE IF NOT EXISTS defensively before
//    touching them. All work is wrapped in try/catch — run() never throws.
//
//  • IDEMPOTENT per day: we key the header on (company_id, forecast_date)
//    where forecast_date === today. A re-run on the same day DELETEs the
//    prior day's header + its lines (CASCADE) and rebuilds — so totals are
//    always fresh, never doubled.
//
//  • "Owed" is decided by BALANCE (total - amount_paid) > 0.005, never by
//    the status string. Paid/void/cancelled rows with zero balance are
//    skipped even if mis-stamped.
//
//  • READ-ONLY toward business data: we only write forecast tables. No
//    money moves, no emails, no status flips.
//
//  • daily trigger — AR/AP balances drift every day as payments land.

import * as db from '../../database';
import { randomUUID } from 'crypto';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

const EPSILON = 0.005;

// Today as YYYY-MM-DD in LOCAL timezone (matches overdue-checker.ts).
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function ensureTables(database: any): void {
  database.prepare(`
    CREATE TABLE IF NOT EXISTS direct_cash_forecasts (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      forecast_date TEXT NOT NULL,
      total_inflow REAL DEFAULT 0,
      total_outflow REAL DEFAULT 0,
      net_cash REAL DEFAULT 0,
      open_ar_count INTEGER DEFAULT 0,
      open_ap_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(company_id, forecast_date)
    )
  `).run();
  database.prepare(`
    CREATE TABLE IF NOT EXISTS cash_forecast_lines (
      id TEXT PRIMARY KEY,
      forecast_id TEXT NOT NULL REFERENCES direct_cash_forecasts(id) ON DELETE CASCADE,
      company_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      reference TEXT DEFAULT '',
      expected_date TEXT,
      amount REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
  // Ensure ON DELETE CASCADE actually fires for line cleanup.
  try { database.pragma('foreign_keys = ON'); } catch { /* best-effort */ }
}

function refreshCompany(database: any, companyId: string, today: string): number {
  // Rebuild today's header from scratch — delete prior run + cascade lines.
  const existing = database.prepare(
    `SELECT id FROM direct_cash_forecasts WHERE company_id = ? AND forecast_date = ?`
  ).get(companyId, today) as { id?: string } | undefined;
  if (existing?.id) {
    // Explicit line delete in case FK cascade is unavailable.
    try { database.prepare(`DELETE FROM cash_forecast_lines WHERE forecast_id = ?`).run(existing.id); } catch { /* */ }
    database.prepare(`DELETE FROM direct_cash_forecasts WHERE id = ?`).run(existing.id);
  }

  const forecastId = randomUUID();

  // ── AR: open invoices owed to us (inflows) ──────────────
  const arRows = database.prepare(`
    SELECT id, invoice_number, due_date,
           COALESCE(total, 0) AS total, COALESCE(amount_paid, 0) AS amount_paid
    FROM invoices
    WHERE company_id = ?
      AND status NOT IN ('paid','cancelled')
      AND (COALESCE(total, 0) - COALESCE(amount_paid, 0)) > ?
  `).all(companyId, EPSILON) as any[];

  // ── AP: open bills we owe (outflows) ────────────────────
  const apRows = database.prepare(`
    SELECT id, bill_number, due_date,
           COALESCE(total, 0) AS total, COALESCE(amount_paid, 0) AS amount_paid
    FROM bills
    WHERE company_id = ?
      AND status NOT IN ('paid','void')
      AND (COALESCE(total, 0) - COALESCE(amount_paid, 0)) > ?
  `).all(companyId, EPSILON) as any[];

  let totalInflow = 0;
  let totalOutflow = 0;
  const lines: Array<[string, string, string, string, string, string, string | null, number]> = [];

  for (const r of arRows) {
    const bal = Number(r.total) - Number(r.amount_paid);
    if (!(bal > EPSILON)) continue;
    totalInflow += bal;
    lines.push([
      randomUUID(), forecastId, companyId, 'inflow', 'invoice',
      String(r.id), (r.due_date as string) || null, bal,
    ]);
  }
  for (const r of apRows) {
    const bal = Number(r.total) - Number(r.amount_paid);
    if (!(bal > EPSILON)) continue;
    totalOutflow += bal;
    lines.push([
      randomUUID(), forecastId, companyId, 'outflow', 'bill',
      String(r.id), (r.due_date as string) || null, bal,
    ]);
  }

  const insertHeader = database.prepare(`
    INSERT INTO direct_cash_forecasts
      (id, company_id, forecast_date, total_inflow, total_outflow, net_cash,
       open_ar_count, open_ap_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `);
  const insertLine = database.prepare(`
    INSERT INTO cash_forecast_lines
      (id, forecast_id, company_id, direction, source_type, source_id, expected_date, amount)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = database.transaction(() => {
    insertHeader.run(
      forecastId, companyId, today,
      totalInflow, totalOutflow, totalInflow - totalOutflow,
      arRows.length, apRows.length,
    );
    for (const l of lines) {
      insertLine.run(l[0], l[1], l[2], l[3], l[4], l[5], l[6], l[7]);
    }
  });
  tx();

  return lines.length;
}

function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  let database: any;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  try {
    ensureTables(database);
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to ensure forecast tables: ${err?.message || err}` };
  }

  const today = ctx?.todayISO || localTodayISO();

  // Resolve target company list.
  let companyIds: string[] = [];
  try {
    if (ctx?.companyId) {
      companyIds = [ctx.companyId];
    } else {
      const current = db.getCurrentCompanyId();
      if (current) {
        companyIds = [current];
      } else {
        const rows = database.prepare(`SELECT id FROM companies`).all() as any[];
        companyIds = rows.map((r) => String(r.id));
      }
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
  }

  if (companyIds.length === 0) {
    return { ok: true, affected: 0, detail: 'No companies to forecast.' };
  }

  let affected = 0;
  let succeeded = 0;
  for (const companyId of companyIds) {
    try {
      affected += refreshCompany(database, companyId, today);
      succeeded++;
    } catch (err: any) {
      warnings.push(`Company ${companyId}: ${err?.message || err}`);
    }
  }

  if (succeeded === 0) {
    return {
      ok: false,
      affected: 0,
      detail: `Cash forecast refresh failed for all ${companyIds.length} company(ies).`,
      warnings: warnings.length ? warnings : undefined,
    };
  }

  return {
    ok: true,
    affected,
    detail: `Refreshed cash forecast for ${succeeded}/${companyIds.length} company(ies); ${affected} forecast line(s) for ${today}.`,
    warnings: warnings.length ? warnings : undefined,
  };
}

export const automation: AutomationModule = {
  id: 'cash-forecast-refresh',
  name: 'Cash Forecast Refresh',
  domain: 'reporting-finance',
  trigger: 'daily',
  run,
};
