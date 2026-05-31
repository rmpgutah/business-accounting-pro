// src/main/automations/payroll-hr/upcoming-payroll-reminder.ts
//
// Upcoming Payroll Reminder
//
// Queues an in-app notification ahead of a payroll run's pay_date so
// the operator funds/processes payroll on time. The brief referred to
// "pay_periods" — this app has no such table; the equivalent live data
// is in `payroll_runs` (pay_period_start/end + pay_date). We remind on
// runs whose pay_date falls within a lead window (default 3 days) and
// that have not yet been paid.
//
// Design choices:
//  • Best-effort & NEVER throws — every db op is guarded; on any error
//    we degrade to { ok:false, affected:0, ... }.
//  • Idempotent — before inserting we check for an existing reminder
//    notification (same type + entity_id) so re-running the same day
//    (or any day) cannot double-queue.
//  • QUEUES a notification only. Never moves money, never sends email.
//  • Settled/owed semantics N/A here; we gate on status != 'paid'.
//  • Scoped by company_id, iterating all companies (or ctx.companyId).
//  • "Today" uses ctx.todayISO when provided, else local YYYY-MM-DD.

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

const REMINDER_TYPE = 'payroll_upcoming_reminder';
const LEAD_DAYS = 3; // remind when pay_date is within this many days

function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(isoDate: string, days: number): string {
  // Anchor at noon LOCAL to avoid DST edge cases.
  const dt = new Date(`${isoDate}T12:00:00`);
  dt.setDate(dt.getDate() + days);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];

  let database: ReturnType<typeof db.getDb>;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

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

  let selectRuns: any;
  let checkNotif: any;
  let insertNotif: any;
  try {
    selectRuns = database.prepare(`
      SELECT id, pay_period_start, pay_period_end, pay_date, status
      FROM payroll_runs
      WHERE company_id = ?
        AND status != 'paid'
        AND pay_date IS NOT NULL
        AND pay_date != ''
        AND pay_date >= ?
        AND pay_date <= ?
    `);
    checkNotif = database.prepare(`
      SELECT 1 FROM notifications
      WHERE company_id = ? AND type = ? AND entity_type = 'payroll_run' AND entity_id = ?
      LIMIT 1
    `);
    insertNotif = database.prepare(`
      INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, 'payroll_run', ?, 0, datetime('now'))
    `);
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Required table unavailable: ${err?.message || err}` };
  }

  const today = ctx?.todayISO || localTodayISO();
  const windowEnd = addDays(today, LEAD_DAYS);
  let affected = 0;

  for (const { id: companyId } of companies) {
    try {
      const runs = (selectRuns.all(companyId, today, windowEnd) as any[]) as Array<{
        id: string; pay_period_start: string; pay_period_end: string; pay_date: string; status: string;
      }>;

      for (const r of runs) {
        try {
          const exists = checkNotif.get(companyId, REMINDER_TYPE, r.id);
          if (exists) continue; // idempotent: already reminded for this run

          const title = `Upcoming payroll on ${r.pay_date}`;
          const message =
            `Payroll for period ${r.pay_period_start} to ${r.pay_period_end} pays on ${r.pay_date}. ` +
            `Status: ${r.status}. Review and process before the pay date.`;
          insertNotif.run(randomUUID(), companyId, REMINDER_TYPE, title, message, r.id);
          affected++;
        } catch (innerErr: any) {
          warnings.push(`Run ${r.id}: ${innerErr?.message || innerErr}`);
        }
      }
    } catch (err: any) {
      warnings.push(`Company ${companyId}: ${err?.message || err}`);
    }
  }

  return {
    ok: true,
    affected,
    detail: affected > 0
      ? `Queued ${affected} upcoming-payroll reminder(s) within ${LEAD_DAYS} day(s).`
      : `No upcoming payroll runs within ${LEAD_DAYS} day(s) needed a reminder.`,
    warnings: warnings.length ? warnings : undefined,
  };
}

export const automation: AutomationModule = {
  id: 'upcoming-payroll-reminder',
  name: 'Upcoming Payroll Reminder',
  domain: 'payroll-hr',
  trigger: 'daily',
  run,
};
