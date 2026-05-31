// src/main/automations/reporting-finance/cash-position-snapshot.ts
//
// Cash Position Snapshot
//
// Once per day, sums current_balance across all bank_accounts for each
// company and writes a single row per company per day into
// cash_position_snapshots. This gives the reporting/finance module a
// historical time-series of total cash on hand (for trend charts,
// runway estimates, etc.) without having to reconstruct it from
// transaction history.
//
// Design choices:
//  • Trigger = daily. Cash position is a once-a-day metric; finer
//    granularity adds noise without analytical value.
//  • Idempotent — keyed on (company_id, snapshot_date). Re-running the
//    same day UPSERTs the same row rather than appending a duplicate,
//    so a restart / manual re-run never double-counts.
//  • Defensive — the cash_position_snapshots table may not exist yet in
//    older schemas, so we CREATE TABLE IF NOT EXISTS up front. All db
//    work is wrapped in try/catch; run() never throws.
//  • Read-only against money tables (bank_accounts). It only writes to
//    its own snapshot table. No money is moved.

import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

// Today as YYYY-MM-DD in LOCAL timezone — matches other crons.
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  const today = ctx?.todayISO || localTodayISO();

  let database: ReturnType<typeof db.getDb>;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  // Ensure the snapshot table exists. Self-contained so the automation
  // works even if schema.sql hasn't been updated to include it.
  try {
    database.prepare(`
      CREATE TABLE IF NOT EXISTS cash_position_snapshots (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        snapshot_date TEXT NOT NULL,
        total_cash REAL NOT NULL DEFAULT 0,
        account_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE (company_id, snapshot_date)
      )
    `).run();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Could not ensure cash_position_snapshots table: ${err?.message || err}` };
  }

  // Determine the set of companies to snapshot.
  let companies: string[] = [];
  try {
    if (ctx?.companyId) {
      companies = [ctx.companyId];
    } else {
      const cur = (() => { try { return db.getCurrentCompanyId(); } catch { return null; } })();
      if (cur) {
        companies = [cur];
      } else {
        const rows = database.prepare(`SELECT id FROM companies`).all() as any[];
        companies = rows.map((r) => String(r.id));
      }
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
  }

  if (companies.length === 0) {
    return { ok: true, affected: 0, detail: 'No companies to snapshot.' };
  }

  let affected = 0;

  const upsert = database.prepare(`
    INSERT INTO cash_position_snapshots (id, company_id, snapshot_date, total_cash, account_count, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT (company_id, snapshot_date)
    DO UPDATE SET total_cash = excluded.total_cash, account_count = excluded.account_count
  `);

  for (const companyId of companies) {
    try {
      const agg = database.prepare(`
        SELECT
          COALESCE(SUM(COALESCE(current_balance, 0)), 0) AS total_cash,
          COUNT(*) AS account_count
        FROM bank_accounts
        WHERE company_id = ?
      `).get(companyId) as any;

      const totalCash = Number(agg?.total_cash ?? 0);
      const accountCount = Number(agg?.account_count ?? 0);
      const id = `cps_${companyId}_${today}`;

      upsert.run(id, companyId, today, totalCash, accountCount);
      affected++;
    } catch (err: any) {
      warnings.push(`Company ${companyId}: ${err?.message || err}`);
    }
  }

  const detail = `Snapshotted cash position for ${affected}/${companies.length} company(ies) on ${today}.`;
  return warnings.length > 0
    ? { ok: affected > 0, affected, detail, warnings }
    : { ok: true, affected, detail };
}

export const automation: AutomationModule = {
  id: 'cash-position-snapshot',
  name: 'Cash Position Snapshot',
  domain: 'reporting-finance',
  trigger: 'daily',
  run,
};
