// src/main/automations/tax/nexus-threshold-monitor.ts
//
// Nexus Threshold Monitor (automation slug: nexus-threshold-monitor)
//
// Flags states that are APPROACHING (or have crossed) an economic
// sales-tax nexus threshold in `sales_tax_nexus`. Each active state row
// tracks ytd_sales / ytd_transactions against threshold_amount /
// threshold_transactions. When a state reaches a warning band (>= 80% of
// either threshold) we record a flag so the user can register before they
// accrue uncollected tax liability.
//
// Design choices, mirroring src/main/crons/overdue-checker.ts:
//
//  • BEST-EFFORT & NEVER THROWS — every db touch is wrapped in try/catch;
//    any failure degrades to { ok:false, ... } or a per-company warning.
//
//  • QUEUES A FLAG, never sends email / moves money / registers anything.
//    The flag is an audit_log row (entity_type='sales_tax_nexus') that the
//    UI / a workflow can surface. We also stamp last_evaluated_at.
//
//  • IDEMPOTENT — before writing a flag we check audit_log for an existing
//    flag for the same nexus row, same severity band, on the same local
//    day. Re-running the same day produces zero duplicate flags.
//
//  • Decides by BALANCE/percent, not by any status string. Skips states
//    that are inactive (is_active=0) or already registered
//    (nexus_established_date set) — those have already acted.
//
//  • monthly trigger: economic-nexus YTD figures move slowly; a monthly
//    sweep is the natural cadence for "you're getting close, go register".

import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

// Local YYYY-MM-DD (matches overdue-checker.ts) — used as the idempotency key.
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Warning band: a state at or above this fraction of either threshold is
// "approaching". 1.0+ means the threshold is already met/exceeded.
const WARN_FRACTION = 0.8;

function severityFor(pct: number): 'met' | 'approaching' | null {
  if (pct >= 100) return 'met';
  if (pct >= WARN_FRACTION * 100) return 'approaching';
  return null;
}

function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  let affected = 0;

  let database: ReturnType<typeof db.getDb>;
  try {
    database = db.getDb();
  } catch (e: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${e?.message || e}` };
  }

  const today = ctx?.todayISO || localTodayISO();

  // Resolve scope: explicit ctx.companyId, else current company, else all.
  let companyIds: string[] = [];
  try {
    if (ctx?.companyId) {
      companyIds = [ctx.companyId];
    } else {
      let current: string | null = null;
      try { current = db.getCurrentCompanyId(); } catch { current = null; }
      if (current) {
        companyIds = [current];
      } else {
        const rows = database.prepare(`SELECT id FROM companies`).all() as any[];
        companyIds = rows.map((r) => String(r.id));
      }
    }
  } catch (e: any) {
    return { ok: false, affected: 0, detail: `Failed to resolve companies: ${e?.message || e}` };
  }

  if (companyIds.length === 0) {
    return { ok: true, affected: 0, detail: 'No companies to evaluate.' };
  }

  let evaluatedStates = 0;

  for (const companyId of companyIds) {
    let states: any[] = [];
    try {
      states = database.prepare(
        `SELECT id, state_code, nexus_type, threshold_amount, threshold_transactions,
                ytd_sales, ytd_transactions, nexus_established_date, is_active
         FROM sales_tax_nexus
         WHERE company_id = ? AND COALESCE(is_active, 1) = 1`
      ).all(companyId) as any[];
    } catch (e: any) {
      warnings.push(`company ${companyId}: nexus query failed: ${e?.message || e}`);
      continue;
    }

    for (const s of states) {
      evaluatedStates++;

      // Skip states already registered/established — they've already acted.
      if (s.nexus_established_date) {
        try {
          database.prepare(`UPDATE sales_tax_nexus SET last_evaluated_at = ? WHERE id = ?`)
            .run(today, s.id);
        } catch { /* best-effort */ }
        continue;
      }

      const thAmount = Number(s.threshold_amount) || 0;
      const thTx = Number(s.threshold_transactions) || 0;
      const ytdSales = Number(s.ytd_sales) || 0;
      const ytdTx = Number(s.ytd_transactions) || 0;

      const salesPct = thAmount > 0 ? (ytdSales / thAmount) * 100 : 0;
      const txPct = thTx > 0 ? (ytdTx / thTx) * 100 : 0;
      const peakPct = Math.max(salesPct, txPct);
      const severity = severityFor(peakPct);

      // Always stamp evaluation timestamp regardless of outcome.
      try {
        database.prepare(`UPDATE sales_tax_nexus SET last_evaluated_at = ? WHERE id = ?`)
          .run(today, s.id);
      } catch { /* best-effort */ }

      if (!severity) continue; // below warning band — nothing to flag

      // Idempotency: has this exact nexus row already been flagged at this
      // severity today? audit_log.changes is JSON text; match on the
      // sentinel fields we write below.
      let already = false;
      try {
        const existing = database.prepare(
          `SELECT changes FROM audit_log
           WHERE company_id = ? AND entity_type = 'sales_tax_nexus' AND entity_id = ?
             AND substr(timestamp, 1, 10) = ?
             AND changes LIKE '%"_action":"nexus_threshold_flag"%'`
        ).all(companyId, s.id, today) as any[];
        for (const row of existing) {
          try {
            const parsed = JSON.parse(row.changes || '{}');
            if (parsed && parsed.severity === severity) { already = true; break; }
          } catch { /* ignore unparsable rows */ }
        }
      } catch (e: any) {
        // If we cannot verify idempotency, skip writing to stay safe.
        warnings.push(`company ${companyId} ${s.state_code}: idempotency check failed: ${e?.message || e}`);
        continue;
      }

      if (already) continue;

      // Queue the flag via audit_log (no email, no money movement).
      try {
        db.logAudit(companyId, 'sales_tax_nexus', String(s.id), 'nexus_threshold_flag', {
          severity,
          state_code: s.state_code,
          nexus_type: s.nexus_type || 'economic',
          sales_pct: Math.round(salesPct * 100) / 100,
          tx_pct: Math.round(txPct * 100) / 100,
          ytd_sales: ytdSales,
          ytd_transactions: ytdTx,
          threshold_amount: thAmount,
          threshold_transactions: thTx,
          warn_fraction: WARN_FRACTION,
          evaluated_on: today,
          automation: 'nexus-threshold-monitor',
        });
        affected++;
      } catch (e: any) {
        warnings.push(`company ${companyId} ${s.state_code}: failed to write flag: ${e?.message || e}`);
      }
    }
  }

  const detail = `Evaluated ${evaluatedStates} active nexus state(s) across ${companyIds.length} company(ies); ` +
    `flagged ${affected} approaching/met threshold(s).`;

  return warnings.length
    ? { ok: true, affected, detail, warnings }
    : { ok: true, affected, detail };
}

export const automation: AutomationModule = {
  id: 'nexus-threshold-monitor',
  name: 'Nexus Threshold Monitor',
  domain: 'tax',
  trigger: 'monthly',
  run,
};
