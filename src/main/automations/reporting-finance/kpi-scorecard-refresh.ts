// src/main/automations/reporting-finance/kpi-scorecard-refresh.ts
//
// KPI Scorecard Refresh
//
// Recomputes the kpi_scorecard upsert row and appends a daily
// kpi_snapshots row for every active KPI defined in kpi_definitions,
// per company. This is a "sync/refresh" automation: it does NOT invent
// metric values out of thin air (formulas are user-defined strings we
// cannot safely evaluate here), it propagates the latest known value
// from the matching kpi_scorecard entry into the snapshot history and
// keeps the scorecard's threshold/target/severity metadata in lock-step
// with the definition.
//
// Design choices:
//
//  • Idempotent — one snapshot per (company, kpi_key, period_end=today).
//    Re-running the same day inserts nothing new (existence check first).
//
//  • Best-effort & never throws — every db touch is wrapped; on any
//    failure we degrade to { ok:false, ... } with a warning. Tables are
//    created at runtime in database/index.ts; if they are somehow absent
//    the try/catch turns the missing-table error into a soft failure.
//
//  • Moves no money, sends no email, executes nothing external. It only
//    writes scorecard/snapshot rows for reporting.
//
//  • Severity ('green'|'yellow'|'red') is derived from the definition's
//    thresholds and direction, so the stored snapshot.severity reflects
//    current standing without re-evaluating any formula.

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

function uuid(): string {
  // crypto.randomUUID is available in the Electron/Node runtime; guard anyway.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return (require('crypto').randomUUID as () => string)();
  } catch {
    return `kpi-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

// Map a numeric value + definition thresholds/direction to a severity band.
function severityFor(
  value: number,
  direction: string,
  green: number | null,
  yellow: number | null,
  red: number | null
): string {
  const higherBetter = (direction || 'higher_better') !== 'lower_better';
  const g = green;
  const r = red;
  if (g == null && r == null) return 'yellow';
  if (higherBetter) {
    if (g != null && value >= g) return 'green';
    if (r != null && value <= r) return 'red';
    return 'yellow';
  } else {
    if (g != null && value <= g) return 'green';
    if (r != null && value >= r) return 'red';
    return 'yellow';
  }
}

function num(v: any): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  let affected = 0;

  let database: import('better-sqlite3').Database;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  const today = ctx?.todayISO || localTodayISO();
  const nowFn = () => new Date().toISOString();

  // Resolve the set of companies to process.
  let companyIds: string[] = [];
  try {
    if (ctx?.companyId) {
      companyIds = [ctx.companyId];
    } else {
      const current = db.getCurrentCompanyId();
      if (current) {
        companyIds = [current];
      } else {
        const rows = database.prepare('SELECT id FROM companies').all() as any[];
        companyIds = rows.map((r) => String(r.id)).filter(Boolean);
      }
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to resolve companies: ${err?.message || err}` };
  }

  if (companyIds.length === 0) {
    return { ok: true, affected: 0, detail: 'No companies to process.' };
  }

  let companiesTouched = 0;

  for (const companyId of companyIds) {
    let defs: any[] = [];
    try {
      defs = database
        .prepare('SELECT * FROM kpi_definitions WHERE company_id = ?')
        .all(companyId) as any[];
    } catch (err: any) {
      warnings.push(`company ${companyId}: kpi_definitions unavailable (${err?.message || err})`);
      continue;
    }

    if (defs.length === 0) continue;
    companiesTouched++;

    for (const def of defs) {
      try {
        const key = String(def.key || '').trim();
        if (!key) continue;

        const direction = String(def.direction || 'higher_better');
        const green = num(def.green_threshold);
        const yellow = num(def.yellow_threshold);
        const red = num(def.red_threshold);
        const target = num(def.target);

        // Find the matching scorecard row to pull its current value.
        // Scorecard is keyed by kpi_name (no kpi_key column), so match on
        // either the definition name or key for resilience.
        let scoreRow: any;
        try {
          scoreRow = database
            .prepare(
              `SELECT * FROM kpi_scorecard
               WHERE company_id = ? AND (kpi_name = ? OR kpi_name = ?)
               ORDER BY updated_at DESC, created_at DESC LIMIT 1`
            )
            .get(companyId, def.name, key);
        } catch {
          scoreRow = undefined;
        }

        const currentValue = num(scoreRow?.current_value) ?? 0;
        const severity = severityFor(currentValue, direction, green, yellow, red);

        // ── Upsert / refresh the scorecard metadata from the definition ──
        try {
          if (scoreRow && scoreRow.id) {
            database
              .prepare(
                `UPDATE kpi_scorecard
                   SET kpi_name = ?, metric_type = ?, target_value = ?,
                       threshold_red = ?, threshold_green = ?, direction = ?,
                       last_calculated_at = ?, updated_at = ?
                 WHERE id = ? AND company_id = ?`
              )
              .run(
                def.name || key,
                def.category ?? scoreRow.metric_type ?? null,
                target ?? 0,
                red,
                green,
                direction,
                nowFn(),
                nowFn(),
                scoreRow.id,
                companyId
              );
            affected++;
          } else {
            // No scorecard entry yet — seed one so the dashboard has a row.
            database
              .prepare(
                `INSERT INTO kpi_scorecard
                   (id, company_id, kpi_name, metric_type, current_value,
                    target_value, threshold_red, threshold_green, direction,
                    last_calculated_at, calculation_method, sort_order,
                    is_active, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`
              )
              .run(
                uuid(),
                companyId,
                def.name || key,
                def.category ?? null,
                0,
                target ?? 0,
                red,
                green,
                direction,
                nowFn(),
                def.formula ?? null,
                nowFn(),
                nowFn()
              );
            affected++;
          }
        } catch (err: any) {
          warnings.push(`company ${companyId} kpi ${key}: scorecard write failed (${err?.message || err})`);
        }

        // ── Idempotent daily snapshot ──
        try {
          const existing = database
            .prepare(
              `SELECT id FROM kpi_snapshots
               WHERE company_id = ? AND kpi_key = ? AND period_end = ? LIMIT 1`
            )
            .get(companyId, key, today);
          if (!existing) {
            database
              .prepare(
                `INSERT INTO kpi_snapshots
                   (id, company_id, kpi_key, period_start, period_end,
                    value, severity, inputs_json, snapshot_at, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              )
              .run(
                uuid(),
                companyId,
                key,
                today,
                today,
                currentValue,
                severity,
                JSON.stringify({
                  target,
                  green_threshold: green,
                  yellow_threshold: yellow,
                  red_threshold: red,
                  direction,
                  source: scoreRow ? 'scorecard' : 'seed',
                }),
                nowFn(),
                nowFn()
              );
            affected++;
          }
        } catch (err: any) {
          warnings.push(`company ${companyId} kpi ${key}: snapshot write failed (${err?.message || err})`);
        }
      } catch (err: any) {
        warnings.push(`kpi processing error (${err?.message || err})`);
      }
    }
  }

  const detail = `Refreshed KPI scorecard/snapshots across ${companiesTouched} company(ies); ${affected} row writes for ${today}.`;
  const result: AutomationResult = { ok: true, affected, detail };
  if (warnings.length) result.warnings = warnings;
  return result;
}

export const automation: AutomationModule = {
  id: 'kpi-scorecard-refresh',
  name: 'KPI Scorecard Refresh',
  domain: 'reporting-finance',
  trigger: 'daily',
  run,
};
