// src/main/automations/payroll-hr/overtime-threshold-alert.ts
//
// Overtime Threshold Alert
// ------------------------
// Flags employees whose logged time_entries are approaching the overtime
// threshold for the CURRENT pay-week (Mon–Sun). FLSA overtime accrues per
// workweek (>40h), so this runs weekly and looks at the running total for
// the in-progress week. When an active hourly employee crosses the warning
// fraction of the threshold (default 90% of 40h = 36h) — but has not yet been
// alerted for that week — we QUEUE a notification row. We never touch payroll,
// money, or send email directly.
//
// Style/patterns mirror src/main/crons/overdue-checker.ts and
// src/main/services/invoice-payment-features.ts (local YYYY-MM-DD date,
// per-company iteration, best-effort try/catch, cast rows as any[]).
//
// Idempotent: before inserting, we check whether a notification of this type
// already exists for the same employee + week. Re-running the same day (or
// hour) inserts nothing new.

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

const SLUG = 'overtime-threshold-alert';
const NOTIF_TYPE = 'overtime_threshold_alert';

// FLSA standard weekly overtime threshold (hours) and the warning fraction
// at which we alert (employee is "approaching" OT).
const OT_THRESHOLD_HOURS = 40;
const WARN_FRACTION = 0.9; // alert at 90% of the threshold (36h)

// Today as YYYY-MM-DD in LOCAL time — matches how time_entries.date is stored.
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function isoToParts(iso: string): Date {
  // Anchor at noon LOCAL to avoid DST edge cases.
  return new Date(`${iso}T12:00:00`);
}

function fmt(dt: Date): string {
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Monday-anchored workweek bounds [start, end] inclusive for the week
// containing `todayISO`.
function weekBounds(todayISO: string): { start: string; end: string } {
  const d = isoToParts(todayISO);
  const dow = d.getDay(); // 0=Sun..6=Sat
  const offsetToMonday = (dow + 6) % 7; // Mon->0, Sun->6
  const start = new Date(d);
  start.setDate(d.getDate() - offsetToMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start: fmt(start), end: fmt(end) };
}

function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  let affected = 0;

  let database: import('better-sqlite3').Database;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  const today = ctx?.todayISO || localTodayISO();
  const { start: weekStart, end: weekEnd } = weekBounds(today);
  const warnHours = OT_THRESHOLD_HOURS * WARN_FRACTION;

  // Resolve company scope.
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
    return { ok: false, affected: 0, detail: `Failed to resolve companies: ${err?.message || err}` };
  }

  if (companyIds.length === 0) {
    return { ok: true, affected: 0, detail: 'No companies to scan.' };
  }

  let scanned = 0;
  try {
    const insertStmt = database.prepare(`
      INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, 'employee', ?, 0, datetime('now'))
    `);
    const existsStmt = database.prepare(`
      SELECT 1 FROM notifications
      WHERE company_id = ?
        AND type = ?
        AND entity_id = ?
        AND message LIKE ?
      LIMIT 1
    `);

    for (const companyId of companyIds) {
      // Active hourly employees only — salaried staff are exempt from OT.
      let employees: any[] = [];
      try {
        employees = database.prepare(`
          SELECT id, name
          FROM employees
          WHERE company_id = ?
            AND status = 'active'
            AND pay_type = 'hourly'
        `).all(companyId) as any[];
      } catch (err: any) {
        warnings.push(`Employee scan failed (company ${companyId}): ${err?.message || err}`);
        continue;
      }

      for (const emp of employees) {
        scanned++;
        try {
          const agg = database.prepare(`
            SELECT COALESCE(SUM(duration_minutes), 0) AS mins
            FROM time_entries
            WHERE company_id = ?
              AND employee_id = ?
              AND date >= ?
              AND date <= ?
          `).get(companyId, emp.id, weekStart, weekEnd) as any;

          const hours = Number(agg?.mins || 0) / 60;
          if (!Number.isFinite(hours) || hours < warnHours) continue;

          // Idempotency tag — one alert per employee per workweek. We embed the
          // week-start in the message and match on it so a fresh week alerts again.
          const weekTag = `[week:${weekStart}]`;

          const already = existsStmt.get(companyId, NOTIF_TYPE, String(emp.id), `%${weekTag}%`);
          if (already) continue;

          const overThreshold = hours >= OT_THRESHOLD_HOURS;
          const title = overThreshold
            ? `Overtime reached: ${emp.name}`
            : `Approaching overtime: ${emp.name}`;
          const message =
            `${emp.name} has logged ${hours.toFixed(2)}h for the week of ${weekStart} ` +
            `(threshold ${OT_THRESHOLD_HOURS}h). ${weekTag}`;

          const notifId = `ota_${companyId}_${emp.id}_${weekStart}`.replace(/[^A-Za-z0-9_]/g, '_');

          insertStmt.run(notifId, companyId, NOTIF_TYPE, title, message, String(emp.id));
          affected++;

          try {
            db.logAudit(companyId, 'employees', String(emp.id), 'overtime_threshold_alert', {
              week_start: weekStart,
              week_end: weekEnd,
              hours: Number(hours.toFixed(2)),
              threshold_hours: OT_THRESHOLD_HOURS,
              over_threshold: overThreshold,
              automation: SLUG,
            });
          } catch {
            /* audit best-effort */
          }
        } catch (err: any) {
          warnings.push(`Employee ${emp?.id} (company ${companyId}): ${err?.message || err}`);
        }
      }
    }
  } catch (err: any) {
    return { ok: false, affected, detail: `Scan failed: ${err?.message || err}`, warnings };
  }

  const detail =
    `Scanned ${scanned} hourly employee(s) across ${companyIds.length} company(ies) ` +
    `for week ${weekStart}..${weekEnd}; queued ${affected} overtime alert(s).`;

  return warnings.length
    ? { ok: true, affected, detail, warnings }
    : { ok: true, affected, detail };
}

export const automation: AutomationModule = {
  id: SLUG,
  name: 'Overtime Threshold Alert',
  domain: 'payroll-hr',
  trigger: 'weekly',
  run,
};
