// src/main/automations/reporting-finance/financial-anomaly-detector.ts
//
// Financial Anomaly Detector
//
// Detects simple spending anomalies: for each expense category, compares the
// CURRENT calendar month's spend against the trailing 3-month average for that
// same category. If the current month exceeds the trailing average by a
// configurable multiple (default 2x) AND the absolute jump is material
// (>= $100 over baseline), it records a row in `financial_anomalies`.
//
// Design choices:
//  • Best-effort & never throws — all db work is wrapped in try/catch and the
//    run() returns { ok:false, ... } on any failure.
//  • Idempotent — before inserting we check that no anomaly of the same type +
//    category for the same detection period already exists (we encode the
//    period in the description so re-runs the same month don't double-insert).
//  • Read-only on financial data — only WRITES flag rows into
//    financial_anomalies. Never moves money or sends email.
//  • Monthly trigger — anomalies are computed against full calendar months, so
//    a daily run would be noisy mid-month. Monthly keeps it stable; the
//    idempotency guard makes accidental extra runs harmless.

import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

// Local YYYY-MM-DD (matches overdue-checker.ts convention).
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Given a YYYY-MM string, return the YYYY-MM that is `n` months earlier.
function monthMinus(yyyymm: string, n: number): string {
  const [y, m] = yyyymm.split('-').map((s) => parseInt(s, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return yyyymm;
  // m is 1-based; build a Date anchored mid-month to avoid DST/overflow.
  const dt = new Date(y, m - 1 - n, 15, 12, 0, 0);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  return `${yy}-${mm}`;
}

const SPIKE_MULTIPLE = 2;       // current >= avg * this
const MIN_ABSOLUTE_JUMP = 100;  // current - avg >= this (dollars)
const ANOMALY_TYPE = 'expense_spike';

function runDetector(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  let affected = 0;

  let database: ReturnType<typeof db.getDb>;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  const today = ctx?.todayISO || localTodayISO();
  const currentMonth = today.slice(0, 7); // YYYY-MM
  if (!/^\d{4}-\d{2}$/.test(currentMonth)) {
    return { ok: false, affected: 0, detail: `Invalid date: ${today}` };
  }

  // Trailing window = the 3 calendar months immediately before currentMonth.
  const trailStart = monthMinus(currentMonth, 3); // inclusive
  const trailEnd = monthMinus(currentMonth, 1);   // inclusive

  // Resolve target companies.
  let companies: { id: string }[] = [];
  try {
    if (ctx?.companyId) {
      companies = [{ id: ctx.companyId }];
    } else {
      const current = db.getCurrentCompanyId?.();
      if (current) {
        companies = [{ id: current }];
      } else {
        companies = (database.prepare(`SELECT id FROM companies`).all() as any[])
          .map((r) => ({ id: String(r.id) }));
      }
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
  }

  for (const { id: companyId } of companies) {
    try {
      // Current-month spend per category.
      const curRows = database.prepare(`
        SELECT COALESCE(NULLIF(category_id, ''), '(uncategorized)') AS cat,
               SUM(COALESCE(amount, 0)) AS total
        FROM expenses
        WHERE company_id = ?
          AND date IS NOT NULL
          AND substr(date, 1, 7) = ?
        GROUP BY cat
      `).all(companyId, currentMonth) as any[];

      if (!curRows || curRows.length === 0) continue;

      // Trailing 3-month spend per category (summed across the window).
      const trailRows = database.prepare(`
        SELECT COALESCE(NULLIF(category_id, ''), '(uncategorized)') AS cat,
               SUM(COALESCE(amount, 0)) AS total
        FROM expenses
        WHERE company_id = ?
          AND date IS NOT NULL
          AND substr(date, 1, 7) >= ?
          AND substr(date, 1, 7) <= ?
        GROUP BY cat
      `).all(companyId, trailStart, trailEnd) as any[];

      const trailByCat = new Map<string, number>();
      for (const r of trailRows) {
        trailByCat.set(String(r.cat), Number(r.total) || 0);
      }

      for (const r of curRows) {
        const cat = String(r.cat);
        const current = Number(r.total) || 0;
        const trailSum = trailByCat.get(cat) || 0;
        const avg = trailSum / 3; // trailing monthly average

        // Need a meaningful baseline to call something a "spike".
        if (avg <= 0) continue;
        if (current < avg * SPIKE_MULTIPLE) continue;
        if (current - avg < MIN_ABSOLUTE_JUMP) continue;

        const ratio = avg > 0 ? (current / avg) : 0;
        const description =
          `[${currentMonth}] Category "${cat}" spend $${current.toFixed(2)} is ` +
          `${ratio.toFixed(1)}x the trailing 3-month average ($${avg.toFixed(2)}).`;

        // Idempotency: skip if an undismissed anomaly for this type+category+
        // month already exists. We match the month via the description prefix.
        try {
          const existing = database.prepare(`
            SELECT id FROM financial_anomalies
            WHERE company_id = ?
              AND anomaly_type = ?
              AND category = ?
              AND description LIKE ?
            LIMIT 1
          `).get(companyId, ANOMALY_TYPE, cat, `[${currentMonth}]%`) as any;
          if (existing) continue;
        } catch (err: any) {
          warnings.push(`Idempotency check failed (company ${companyId}, cat ${cat}): ${err?.message || err}`);
          continue;
        }

        try {
          const id = (globalThis as any).crypto?.randomUUID
            ? (globalThis as any).crypto.randomUUID()
            : `anom_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
          database.prepare(`
            INSERT INTO financial_anomalies
              (id, company_id, anomaly_type, description, amount, category, dismissed)
            VALUES (?, ?, ?, ?, ?, ?, 0)
          `).run(id, companyId, ANOMALY_TYPE, description, current, cat);
          affected++;
        } catch (err: any) {
          warnings.push(`Insert failed (company ${companyId}, cat ${cat}): ${err?.message || err}`);
        }
      }
    } catch (err: any) {
      warnings.push(`Scan failed (company ${companyId}): ${err?.message || err}`);
    }
  }

  return {
    ok: true,
    affected,
    detail: affected > 0
      ? `Recorded ${affected} expense-spike anomal${affected === 1 ? 'y' : 'ies'} for ${currentMonth}.`
      : `No new expense anomalies detected for ${currentMonth}.`,
    ...(warnings.length ? { warnings } : {}),
  };
}

export const automation: AutomationModule = {
  id: 'financial-anomaly-detector',
  name: 'Financial Anomaly Detector',
  domain: 'reporting-finance',
  trigger: 'monthly',
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
    try {
      return runDetector(ctx);
    } catch (err: any) {
      return { ok: false, affected: 0, detail: `Unexpected error: ${err?.message || err}` };
    }
  },
};
