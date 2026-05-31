// src/main/automations/tax/sales-tax-filing-reminder.ts
//
// Sales Tax Filing Reminder
//
// Scans sales_tax_filing_schedule rows and QUEUES an in-app notification
// for each active schedule whose next_filing_due falls within a lookahead
// window (or is already past-due). This NEVER sends external email, never
// files anything, and never moves money — it only writes notification rows.
//
// Design:
//  • Best-effort: run() never throws. All db work is wrapped in try/catch.
//  • Defensive: sales_tax_filing_schedule is created by a migration, not the
//    base schema.sql, so we verify the table exists at runtime and degrade
//    to { ok:false } with a warning if it's missing.
//  • Idempotent: a reminder for a given (schedule, due-date) is keyed by a
//    deterministic entity_id; we skip insertion if a matching notification
//    already exists. Re-running the same day is a no-op.
//  • Local YYYY-MM-DD "today" (matches overdue-checker.ts), comparing against
//    next_filing_due stored as TEXT YYYY-MM-DD.

import { randomUUID as uuid } from 'crypto';
import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

// Days before next_filing_due at which we start reminding.
const LOOKAHEAD_DAYS = 7;

function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(isoDate: string, days: number): string {
  const dt = new Date(`${isoDate}T12:00:00`);
  dt.setDate(dt.getDate() + days);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  let affected = 0;

  let database: ReturnType<typeof db.getDb>;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  // Verify the (migration-created) table exists before touching it.
  try {
    const exists = (database.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='sales_tax_filing_schedule'`
    ).get() as any) as { name?: string } | undefined;
    if (!exists || !exists.name) {
      return {
        ok: false,
        affected: 0,
        detail: 'sales_tax_filing_schedule table not present; nothing to remind on',
        warnings: ['table sales_tax_filing_schedule missing'],
      };
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Schema check failed: ${err?.message || err}` };
  }

  const today = ctx?.todayISO || localTodayISO();
  const windowEnd = addDays(today, LOOKAHEAD_DAYS);

  // Resolve company scope.
  let companyIds: string[] = [];
  try {
    if (ctx?.companyId) {
      companyIds = [ctx.companyId];
    } else {
      const cur = (() => { try { return db.getCurrentCompanyId(); } catch { return null; } })();
      if (cur) {
        companyIds = [cur];
      } else {
        companyIds = (database.prepare(`SELECT id FROM companies`).all() as any[])
          .map((r) => String(r.id));
      }
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to resolve companies: ${err?.message || err}` };
  }

  const insert = (() => {
    try {
      return database.prepare(
        `INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
         VALUES (?, ?, 'sales_tax_filing_due', ?, ?, 'sales_tax_filing_schedule', ?, 0, datetime('now'))`
      );
    } catch {
      return null;
    }
  })();

  if (!insert) {
    return { ok: false, affected: 0, detail: 'notifications table unavailable; cannot queue reminders' };
  }

  for (const companyId of companyIds) {
    try {
      // Due within the lookahead window OR already past-due (and not yet filed
      // for that period). We rely on next_filing_due being maintained elsewhere.
      const schedules = (database.prepare(
        `SELECT id, state_code, filing_frequency, next_filing_due, last_filed_at
         FROM sales_tax_filing_schedule
         WHERE company_id = ?
           AND COALESCE(is_active, 1) = 1
           AND next_filing_due IS NOT NULL
           AND next_filing_due != ''
           AND next_filing_due <= ?`
      ).all(companyId, windowEnd) as any[]);

      for (const s of schedules) {
        const due = String(s.next_filing_due);
        // Skip if already filed on/after the due date (period satisfied).
        if (s.last_filed_at && String(s.last_filed_at) >= due) continue;

        // Deterministic entity key: one reminder per schedule + due date.
        const entityId = `${String(s.id)}::${due}`;

        // Idempotency: skip if a reminder for this exact schedule+due exists.
        try {
          const dup = database.prepare(
            `SELECT 1 FROM notifications
             WHERE company_id = ? AND type = 'sales_tax_filing_due'
               AND entity_type = 'sales_tax_filing_schedule' AND entity_id = ?
             LIMIT 1`
          ).get(companyId, entityId);
          if (dup) continue;
        } catch {
          // If the dedupe probe fails, err on the side of NOT duplicating.
          continue;
        }

        const isPastDue = due < today;
        const state = s.state_code ? String(s.state_code) : 'sales tax';
        const freq = s.filing_frequency ? String(s.filing_frequency) : 'periodic';
        const title = isPastDue
          ? `Sales tax filing OVERDUE — ${state}`
          : `Sales tax filing due ${due} — ${state}`;
        const message = isPastDue
          ? `Your ${freq} ${state} sales tax filing was due ${due}. File as soon as possible.`
          : `Your ${freq} ${state} sales tax filing is due ${due}.`;

        try {
          insert.run(uuid(), companyId, title, message, entityId);
          affected++;
        } catch (err: any) {
          warnings.push(`insert failed (schedule ${String(s.id)}): ${err?.message || err}`);
        }
      }
    } catch (err: any) {
      warnings.push(`scan failed (company ${companyId}): ${err?.message || err}`);
    }
  }

  return {
    ok: true,
    affected,
    detail: affected > 0
      ? `Queued ${affected} sales tax filing reminder(s)`
      : 'No sales tax filing reminders due',
    ...(warnings.length ? { warnings } : {}),
  };
}

export const automation: AutomationModule = {
  id: 'sales-tax-filing-reminder',
  name: 'Sales Tax Filing Reminder',
  domain: 'tax',
  trigger: 'daily',
  run,
};
