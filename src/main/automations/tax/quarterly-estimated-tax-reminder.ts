// src/main/automations/tax/quarterly-estimated-tax-reminder.ts
//
// Quarterly Estimated Tax Reminder
//
// Queues an in-app notification when a US federal quarterly estimated-tax
// due date is approaching, so the user doesn't miss an IRS deadline.
//
// NOTE ON SCHEMA: the spec referenced a `quarterly_tax_estimates` table,
// but that table does not exist in schema.sql. Rather than reference an
// unverified table (which would crash), this module derives the standard
// IRS estimated-tax due dates (Apr 15 / Jun 15 / Sep 15 / Jan 15) and
// reminds against those. It never moves money or sends external email —
// it only QUEUES a row into the existing `notifications` table.
//
// Design:
//  • BEST-EFFORT: run() never throws. All db work wrapped in try/catch.
//  • IDEMPOTENT: each (company, tax-year, quarter) reminder uses a stable
//    entity_id; we skip insert if a notification with that entity_id
//    already exists.
//  • Scoped per company via SELECT id FROM companies.
//  • Trigger: 'daily' — checks each day whether a deadline is within the
//    reminder window (default 14 days out, through the due date).

import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

// Local YYYY-MM-DD (matches overdue-checker.ts).
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(`${fromISO}T12:00:00`).getTime();
  const b = new Date(`${toISO}T12:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

// IRS quarterly estimated-tax due dates for a given tax year.
// Q4 of tax year N is due Jan 15 of year N+1.
function quarterDueDates(taxYear: number): Array<{ quarter: number; due: string; label: string }> {
  return [
    { quarter: 1, due: `${taxYear}-04-15`, label: `Q1 ${taxYear}` },
    { quarter: 2, due: `${taxYear}-06-15`, label: `Q2 ${taxYear}` },
    { quarter: 3, due: `${taxYear}-09-15`, label: `Q3 ${taxYear}` },
    { quarter: 4, due: `${taxYear + 1}-01-15`, label: `Q4 ${taxYear}` },
  ];
}

const REMINDER_WINDOW_DAYS = 14;

export const automation: AutomationModule = {
  id: 'quarterly-estimated-tax-reminder',
  name: 'Quarterly Estimated Tax Reminder',
  domain: 'tax',
  trigger: 'daily',
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
    const warnings: string[] = [];
    let affected = 0;

    let database;
    try {
      database = db.getDb();
    } catch (err: any) {
      return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
    }

    const today = ctx?.todayISO || localTodayISO();

    // Resolve company set.
    let companies: Array<{ id: string }> = [];
    try {
      if (ctx?.companyId) {
        companies = [{ id: ctx.companyId }];
      } else {
        companies = (database.prepare(`SELECT id FROM companies`).all() as any[])
          .map((r) => ({ id: String(r.id) }));
      }
    } catch (err: any) {
      return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
    }

    // Build candidate due dates spanning the prior, current, and next tax
    // year so a window crossing a year boundary (e.g. Jan 15) is covered.
    const curYear = parseInt(today.slice(0, 4), 10);
    const baseYears = [curYear - 1, curYear, curYear + 1].filter((y) => Number.isFinite(y));

    let insertStmt: any;
    let checkStmt: any;
    try {
      insertStmt = database.prepare(`
        INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
        VALUES (?, ?, 'tax_reminder', ?, ?, 'tax_estimate', ?, 0, datetime('now'))
      `);
      checkStmt = database.prepare(
        `SELECT 1 FROM notifications WHERE company_id = ? AND entity_id = ? LIMIT 1`
      );
    } catch (err: any) {
      return { ok: false, affected: 0, detail: `notifications table unavailable: ${err?.message || err}` };
    }

    for (const { id: companyId } of companies) {
      try {
        for (const year of baseYears) {
          for (const q of quarterDueDates(year)) {
            const daysOut = daysBetween(today, q.due);
            // Remind when the due date is within the window and not yet
            // past (daysOut between 0 and REMINDER_WINDOW_DAYS inclusive).
            if (daysOut < 0 || daysOut > REMINDER_WINDOW_DAYS) continue;

            // Stable idempotency key: one reminder per company/quarter/year.
            const entityId = `qtax-${year}-q${q.quarter}-${q.due}`;
            try {
              const exists = checkStmt.get(companyId, entityId);
              if (exists) continue;
            } catch {
              // If the existence check fails, skip to avoid duplicate spam.
              continue;
            }

            const title = `Estimated tax due ${q.due}`;
            const message =
              daysOut === 0
                ? `Federal estimated tax payment for ${q.label} is due TODAY (${q.due}).`
                : `Federal estimated tax payment for ${q.label} is due in ${daysOut} day(s) on ${q.due}.`;

            try {
              const id = `notif-${entityId}-${Date.now()}`;
              insertStmt.run(id, companyId, title, message, entityId);
              affected++;
            } catch (err: any) {
              warnings.push(`Insert failed (company ${companyId}, ${entityId}): ${err?.message || err}`);
            }
          }
        }
      } catch (err: any) {
        warnings.push(`Scan failed for company ${companyId}: ${err?.message || err}`);
      }
    }

    return {
      ok: true,
      affected,
      detail: affected > 0
        ? `Queued ${affected} estimated-tax reminder notification(s).`
        : 'No estimated-tax deadlines within the reminder window.',
      ...(warnings.length ? { warnings } : {}),
    };
  },
};
