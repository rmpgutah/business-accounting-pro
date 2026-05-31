// src/main/automations/payroll-hr/review-anniversary-reminder.ts
//
// Review Anniversary Reminder — queues an in-app reminder notification
// for every active employee whose work anniversary (based on
// employees.start_date / hire date) is approaching, so the user can
// schedule a performance review BEFORE the anniversary passes.
//
// Design:
//  • Trigger: 'daily' — the "anniversary within N days" window shifts
//    each calendar day, so a daily scan is the right cadence.
//  • Best-effort: run() NEVER throws. Any failure degrades to ok:false.
//  • Queues a row into `notifications` (does NOT email anyone). Mirrors
//    the queue-don't-send pattern of bill-due-reminder.ts.
//  • Idempotent: one reminder per employee per anniversary YEAR. The
//    dedupe key is entity_id + type + the anniversary year tag embedded
//    in the message, so re-running the same day — or any later day in
//    the same window — never inserts a duplicate.
//  • Skips contractors and inactive/terminated employees.
//
// Schema used (verified against database/schema.sql):
//   employees(id, company_id, name, type, start_date, end_date, status)
//   notifications(id, company_id, type, title, message, entity_type,
//                 entity_id, is_read, created_at)

import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

// Look-ahead window: remind when an anniversary is within this many days.
const WINDOW_DAYS = 14;
const NOTIFICATION_TYPE = 'review_anniversary_reminder';

// Today as YYYY-MM-DD in LOCAL timezone — matches how start_date is
// stored (TEXT YYYY-MM-DD), mirroring overdue-checker.ts.
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Parse a YYYY-MM-DD prefix; returns null if not parseable.
function parseYMD(s: string | null | undefined): { y: number; m: number; d: number } | null {
  if (!s || typeof s !== 'string') return null;
  const match = s.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const y = Number(match[1]); const m = Number(match[2]); const d = Number(match[3]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

// Days from `today` (YYYY-MM-DD) until the NEXT occurrence of the hire
// month/day on/after today. 0 means the anniversary is today. Returns
// the days-until and the calendar year the next anniversary falls in.
function daysUntilNextAnniversary(
  today: { y: number; m: number; d: number },
  hire: { m: number; d: number }
): { days: number; anniversaryYear: number } {
  const todayMs = new Date(today.y, today.m - 1, today.d, 12, 0, 0).getTime();
  // Candidate: anniversary in current year (Feb-29 hires fall back to a
  // valid date via JS Date rollover, which is acceptable for reminders).
  let annYear = today.y;
  let annMs = new Date(annYear, hire.m - 1, hire.d, 12, 0, 0).getTime();
  if (annMs < todayMs) {
    annYear = today.y + 1;
    annMs = new Date(annYear, hire.m - 1, hire.d, 12, 0, 0).getTime();
  }
  const days = Math.round((annMs - todayMs) / 86_400_000);
  return { days, anniversaryYear: annYear };
}

function genId(): string {
  return `rar_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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

  const todayISO = ctx?.todayISO || localTodayISO();
  const todayParts = parseYMD(todayISO);
  if (!todayParts) {
    return { ok: false, affected: 0, detail: `Invalid todayISO: ${todayISO}` };
  }

  // Determine target companies.
  let companies: { id: string }[] = [];
  try {
    if (ctx?.companyId) {
      companies = [{ id: ctx.companyId }];
    } else {
      let current: string | null | undefined;
      try { current = db.getCurrentCompanyId?.(); } catch { /* optional */ }
      if (current) {
        companies = [{ id: current }];
      } else {
        companies = (database.prepare(`SELECT id FROM companies`).all() as any[]) as { id: string }[];
      }
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
  }

  let insertStmt: import('better-sqlite3').Statement;
  let dupStmt: import('better-sqlite3').Statement;
  try {
    insertStmt = database.prepare(`
      INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, 'employee', ?, 0, datetime('now'))
    `);
    // Dedupe: same employee + same reminder type + same anniversary-year tag.
    dupStmt = database.prepare(`
      SELECT 1 FROM notifications
      WHERE company_id = ? AND type = ? AND entity_id = ? AND message LIKE ?
      LIMIT 1
    `);
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `notifications table unavailable: ${err?.message || err}` };
  }

  for (const { id: companyId } of companies) {
    let employees: Array<{
      id: string; name: string; type: string | null;
      start_date: string | null; end_date: string | null; status: string | null;
    }> = [];
    try {
      employees = (database.prepare(`
        SELECT id, name, type, start_date, end_date, status
        FROM employees
        WHERE company_id = ?
          AND COALESCE(status, 'active') = 'active'
          AND COALESCE(type, 'employee') = 'employee'
          AND start_date IS NOT NULL
          AND start_date != ''
      `).all(companyId) as any[]) as typeof employees;
    } catch (err: any) {
      warnings.push(`Employee scan (company ${companyId}): ${err?.message || err}`);
      continue;
    }

    for (const emp of employees) {
      const hire = parseYMD(emp.start_date);
      if (!hire) continue;

      // Skip employees with a populated end_date (terminated/departing).
      if (emp.end_date && parseYMD(emp.end_date)) continue;

      const { days, anniversaryYear } = daysUntilNextAnniversary(todayParts, { m: hire.m, d: hire.d });
      if (days < 0 || days > WINDOW_DAYS) continue;

      const yearsOfService = Math.max(0, anniversaryYear - hire.y);
      // First-anniversary (0 years completed = brand new) still worth a review.
      const yearTag = `[anniv:${anniversaryYear}]`;

      try {
        const exists = dupStmt.get(companyId, NOTIFICATION_TYPE, emp.id, `%${yearTag}%`);
        if (exists) continue;
      } catch (err: any) {
        warnings.push(`Dedupe check failed (employee ${emp.id}): ${err?.message || err}`);
        continue;
      }

      const whenLabel = days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`;
      const title = `Performance review due: ${emp.name}`;
      const message =
        `${emp.name} reaches ${yearsOfService} year${yearsOfService === 1 ? '' : 's'} of service ` +
        `(hire anniversary ${whenLabel}). Schedule a performance review. ${yearTag}`;

      try {
        insertStmt.run(genId(), companyId, NOTIFICATION_TYPE, title, message, emp.id);
        affected++;
      } catch (err: any) {
        warnings.push(`Insert failed (employee ${emp.id}): ${err?.message || err}`);
      }
    }
  }

  const detail = affected > 0
    ? `Queued ${affected} review-anniversary reminder${affected === 1 ? '' : 's'}.`
    : 'No employees due for a review-anniversary reminder.';

  return { ok: true, affected, detail, ...(warnings.length ? { warnings } : {}) };
}

export const automation: AutomationModule = {
  id: 'review-anniversary-reminder',
  name: 'Review Anniversary Reminder',
  domain: 'payroll-hr',
  trigger: 'daily',
  run,
};
