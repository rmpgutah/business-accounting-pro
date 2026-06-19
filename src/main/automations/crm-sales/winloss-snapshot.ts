// src/main/automations/crm-sales/winloss-snapshot.ts
//
// Win/Loss Snapshot — crm-sales automation
//
// Once a month, freezes a win/loss summary of the company's quotes
// (the closest thing this accounting app has to a sales pipeline) for
// the most recently COMPLETED calendar month into a self-owned
// `win_loss_analysis` table. This gives the CRM/sales module a stable
// historical series ("we won 12 of 18 quotes worth $42k in April")
// without recomputing from live quote rows that keep mutating.
//
// Win/loss classification (by quote status):
//   - won  : 'accepted', 'converted'
//   - lost : 'rejected', 'expired'
//   - open : 'draft', 'sent'  (not counted toward win OR loss)
//
// The snapshot is keyed by the quote's issue_date month, so re-running
// a later month never disturbs an earlier snapshot.
//
// SAFETY / DESIGN:
//   - Never throws — all DB work is wrapped; returns ok:false on error.
//   - Owns its output table: CREATE TABLE IF NOT EXISTS, so it works
//     even though win_loss_analysis is not in schema.sql.
//   - Idempotent — a UNIQUE(company_id, period_month) index plus
//     INSERT OR IGNORE means re-running the same month is a no-op.
//   - Read-only against quotes; only writes its own snapshot rows.
//   - Scoped per company via SELECT id FROM companies.

import * as db from '../../database';

export interface AutomationResult {
  ok: boolean;
  affected: number;
  detail: string;
  warnings?: string[];
}

export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

// Local YYYY-MM-DD (matches overdue-checker.ts) — avoids UTC date drift.
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Given an ISO date, return the previous calendar month as YYYY-MM.
function previousMonth(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(isoDate);
  let year: number;
  let month: number; // 1-12
  if (m) {
    year = parseInt(m[1], 10);
    month = parseInt(m[2], 10);
  } else {
    const d = new Date();
    year = d.getFullYear();
    month = d.getMonth() + 1;
  }
  month -= 1;
  if (month < 1) {
    month = 12;
    year -= 1;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

const WON_STATUSES = ['accepted', 'converted'];
const LOST_STATUSES = ['rejected', 'expired'];

function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  let affected = 0;

  let database: ReturnType<typeof db.getDb>;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  // Ensure our output table exists (this automation owns it).
  try {
    database.prepare(`
      CREATE TABLE IF NOT EXISTS win_loss_analysis (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        period_month TEXT NOT NULL,
        total_quotes INTEGER DEFAULT 0,
        won_count INTEGER DEFAULT 0,
        lost_count INTEGER DEFAULT 0,
        open_count INTEGER DEFAULT 0,
        won_value REAL DEFAULT 0,
        lost_value REAL DEFAULT 0,
        win_rate REAL DEFAULT 0,
        snapshot_date TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `).run();
    database.prepare(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_win_loss_company_period
      ON win_loss_analysis(company_id, period_month)
    `).run();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to ensure win_loss_analysis table: ${err?.message || err}` };
  }

  const today = ctx?.todayISO || localTodayISO();
  const period = previousMonth(today); // e.g. '2026-04'
  const periodStart = `${period}-01`;
  // Exclusive upper bound = first day of the snapshot's following month
  // = the first day of THIS month derived from `today`.
  const todayMonthMatch = /^(\d{4})-(\d{2})/.exec(today);
  const periodEndExclusive = todayMonthMatch
    ? `${todayMonthMatch[1]}-${todayMonthMatch[2]}-01`
    : `${period}-31`; // defensive fallback

  // Resolve target companies.
  let companies: { id: string }[] = [];
  try {
    if (ctx?.companyId) {
      companies = [{ id: ctx.companyId }];
    } else {
      companies = (database.prepare(`SELECT id FROM companies`).all() as any[]) as { id: string }[];
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
  }

  const insert = database.prepare(`
    INSERT OR IGNORE INTO win_loss_analysis
      (id, company_id, period_month, total_quotes, won_count, lost_count,
       open_count, won_value, lost_value, win_rate, snapshot_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const { id: companyId } of companies) {
    try {
      const rows = (database.prepare(`
        SELECT
          COALESCE(status, 'draft') AS status,
          COALESCE(total, 0) AS total
        FROM quotes
        WHERE company_id = ?
          AND issue_date IS NOT NULL
          AND issue_date >= ?
          AND issue_date < ?
      `).all(companyId, periodStart, periodEndExclusive) as any[]) as Array<{ status: string; total: number }>;

      let won = 0;
      let lost = 0;
      let open = 0;
      let wonValue = 0;
      let lostValue = 0;

      for (const r of rows) {
        const status = String(r.status || '').toLowerCase();
        const total = Number(r.total) || 0;
        if (WON_STATUSES.includes(status)) {
          won++;
          wonValue += total;
        } else if (LOST_STATUSES.includes(status)) {
          lost++;
          lostValue += total;
        } else {
          open++;
        }
      }

      const decided = won + lost;
      const winRate = decided > 0 ? won / decided : 0;
      const id = `wla_${companyId}_${period}`;

      const info = insert.run(
        id,
        companyId,
        period,
        rows.length,
        won,
        lost,
        open,
        Math.round(wonValue * 100) / 100,
        Math.round(lostValue * 100) / 100,
        Math.round(winRate * 10000) / 10000,
        today,
      );
      // changes === 0 means the snapshot already existed (idempotent skip).
      if (info.changes > 0) affected++;
    } catch (err: any) {
      warnings.push(`Company ${companyId}: ${err?.message || err}`);
    }
  }

  return {
    ok: true,
    affected,
    detail: `Snapshotted win/loss for ${period} across ${companies.length} compan${companies.length === 1 ? 'y' : 'ies'}; ${affected} new snapshot row(s).`,
    warnings: warnings.length ? warnings : undefined,
  };
}

export const automation: AutomationModule = {
  id: 'winloss-snapshot',
  name: 'Win/Loss Snapshot',
  domain: 'crm-sales',
  trigger: 'monthly',
  run,
};
