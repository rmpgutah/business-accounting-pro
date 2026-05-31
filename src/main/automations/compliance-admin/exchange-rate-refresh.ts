// src/main/automations/compliance-admin/exchange-rate-refresh.ts
//
// Exchange Rate Refresh
// ─────────────────────
// Keeps the global `exchange_rates` table "fresh" for every currency
// pair that is actively in use, WITHOUT any network access.
//
// How it stays current without the internet:
//   For each distinct (from_currency, to_currency) pair that already
//   has at least one rate row, we find the most recent row (by
//   effective_date) and — if there is no row dated TODAY yet — we
//   carry that latest rate forward by inserting a today-dated row.
//   This means downstream conversion lookups that key on
//   effective_date <= today always find a row stamped for today
//   instead of an arbitrarily stale date.
//
// Notes:
//   • exchange_rates is a GLOBAL table (no company_id column in
//     schema.sql), so this runs once, not per-company.
//   • IDEMPOTENT: the table has UNIQUE(from_currency,to_currency,
//     effective_date); we also pre-check existence, so re-running the
//     same day inserts nothing and double-counts nothing.
//   • BEST-EFFORT: never throws. All db work is wrapped in try/catch
//     and any failure degrades to { ok:false, affected:0 }.
//   • No money moved, no trades, no external calls — pure carry-forward.

import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

// Local YYYY-MM-DD — matches how effective_date (TEXT) is stored and
// mirrors src/main/crons/overdue-checker.ts's localTodayISO().
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

  let database: any;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  // Latest known rate per (from,to) pair, excluding any pair that
  // already has a row for today. We compute the carry-forward value
  // from existing rows only — no network.
  let pairs: Array<{ from_currency: string; to_currency: string; rate: number; effective_date: string }> = [];
  try {
    pairs = (database.prepare(`
      SELECT e.from_currency AS from_currency,
             e.to_currency   AS to_currency,
             e.rate          AS rate,
             e.effective_date AS effective_date
      FROM exchange_rates e
      JOIN (
        SELECT from_currency, to_currency, MAX(effective_date) AS max_date
        FROM exchange_rates
        WHERE effective_date IS NOT NULL AND effective_date != ''
        GROUP BY from_currency, to_currency
      ) latest
        ON latest.from_currency = e.from_currency
       AND latest.to_currency   = e.to_currency
       AND latest.max_date      = e.effective_date
      WHERE e.effective_date < ?
        AND e.rate IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM exchange_rates x
          WHERE x.from_currency = e.from_currency
            AND x.to_currency   = e.to_currency
            AND x.effective_date = ?
        )
    `).all(today, today) as any[]);
  } catch (err: any) {
    // Most likely the exchange_rates table does not exist on this DB.
    return { ok: false, affected: 0, detail: `exchange_rates query failed: ${err?.message || err}` };
  }

  if (pairs.length === 0) {
    return { ok: true, affected: 0, detail: 'All active currency pairs already current for today.' };
  }

  let affected = 0;
  try {
    const insert = database.prepare(`
      INSERT OR IGNORE INTO exchange_rates (id, from_currency, to_currency, rate, effective_date, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `);
    const tx = database.transaction((rows: typeof pairs) => {
      for (const p of rows) {
        const rate = Number(p.rate);
        if (!Number.isFinite(rate) || rate <= 0) {
          warnings.push(`Skipped ${p.from_currency}->${p.to_currency}: non-positive rate.`);
          continue;
        }
        const id = `fxr_${today}_${p.from_currency}_${p.to_currency}`;
        const info = insert.run(id, p.from_currency, p.to_currency, rate, today);
        if (info && info.changes) affected += info.changes;
      }
    });
    tx(pairs);
  } catch (err: any) {
    return {
      ok: false,
      affected,
      detail: `Carry-forward insert failed after ${affected} row(s): ${err?.message || err}`,
      warnings: warnings.length ? warnings : undefined,
    };
  }

  return {
    ok: true,
    affected,
    detail: `Carried forward ${affected} currency-pair rate(s) to ${today}.`,
    warnings: warnings.length ? warnings : undefined,
  };
}

export const automation: AutomationModule = {
  id: 'exchange-rate-refresh',
  name: 'Exchange Rate Refresh',
  domain: 'compliance-admin',
  trigger: 'daily',
  run,
};
