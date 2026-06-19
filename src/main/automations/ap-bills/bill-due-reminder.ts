// src/main/automations/ap-bills/bill-due-reminder.ts
//
// Bill Due Reminder — queues an in-app reminder notification for every
// unpaid accounts-payable bill whose due_date falls within the next N
// days (default 5). This gives the user a heads-up to schedule payment
// BEFORE the bill goes overdue, complementing the overdue-checker cron
// (src/main/crons/overdue-checker.ts) which only fires AFTER due_date.
//
// Design:
//  • Trigger: 'daily' — due-soon windows shift each calendar day.
//  • Best-effort: run() never throws. Any failure degrades to ok:false.
//  • Queues a row into `notifications` (does NOT email or move money).
//  • Idempotent: one reminder per bill per due_date — re-running the
//    same day (or any later day before the bill is paid/repriced)
//    will not insert a duplicate, because we key the dedupe on
//    entity_id + type + the due_date embedded in the message.
//  • "Owed" is decided by BALANCE (total - amount_paid > 0.005), never
//    by the status string alone.

import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

const EPSILON = 0.005;
const WINDOW_DAYS = 5;
const NOTIFICATION_TYPE = 'bill_due_reminder';

// Today as YYYY-MM-DD in LOCAL timezone — matches how due_date is
// stored (TEXT YYYY-MM-DD), mirroring overdue-checker.ts.
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function datePlusDays(isoDate: string, days: number): string {
  // Anchor at noon LOCAL to avoid DST edge cases.
  const dt = new Date(`${isoDate}T12:00:00`);
  dt.setDate(dt.getDate() + days);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function genId(): string {
  return `bdr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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
  const windowEnd = datePlusDays(today, WINDOW_DAYS);

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
      VALUES (?, ?, ?, ?, ?, 'bill', ?, 0, datetime('now'))
    `);
    // Dedupe: same bill + same reminder type + same due_date tag already queued.
    dupStmt = database.prepare(`
      SELECT 1 FROM notifications
      WHERE company_id = ? AND type = ? AND entity_id = ? AND message LIKE ?
      LIMIT 1
    `);
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `notifications table unavailable: ${err?.message || err}` };
  }

  for (const { id: companyId } of companies) {
    let bills: Array<{
      id: string; bill_number: string; total: number; amount_paid: number;
      due_date: string; vendor_id: string | null;
    }> = [];
    try {
      bills = (database.prepare(`
        SELECT id, bill_number, COALESCE(total, 0) AS total,
               COALESCE(amount_paid, 0) AS amount_paid, due_date, vendor_id
        FROM bills
        WHERE company_id = ?
          AND status IN ('pending','received','approved','partial')
          AND due_date IS NOT NULL
          AND due_date != ''
          AND due_date >= ?
          AND due_date <= ?
      `).all(companyId, today, windowEnd) as any[]) as typeof bills;
    } catch (err: any) {
      warnings.push(`Bill scan failed (company ${companyId}): ${err?.message || err}`);
      continue;
    }

    for (const b of bills) {
      // Owed decided by BALANCE, not status.
      const balance = Number(b.total || 0) - Number(b.amount_paid || 0);
      if (balance <= EPSILON) continue;

      // Idempotency: tag the message with the due_date so a re-run (or a
      // later day within the window) does not double-queue for the same
      // due milestone.
      const dueTag = `[due:${b.due_date}]`;
      try {
        const exists = dupStmt.get(companyId, NOTIFICATION_TYPE, b.id, `%${dueTag}%`);
        if (exists) continue;
      } catch (err: any) {
        warnings.push(`Dedupe check failed (bill ${b.id}): ${err?.message || err}`);
        continue;
      }

      const daysUntil = Math.max(0, Math.floor(
        (new Date(`${b.due_date}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86_400_000
      ));
      const whenText = daysUntil === 0 ? 'today' : daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`;
      const title = `Bill ${b.bill_number} due ${whenText}`;
      const message = `Bill ${b.bill_number} has a balance of ${balance.toFixed(2)} due on ${b.due_date} (${whenText}). ${dueTag}`;

      try {
        insertStmt.run(genId(), companyId, NOTIFICATION_TYPE, title, message, b.id);
        affected++;
      } catch (err: any) {
        warnings.push(`Insert failed (bill ${b.id}): ${err?.message || err}`);
      }
    }
  }

  return {
    ok: true,
    affected,
    detail: affected === 0
      ? `No new due-soon bill reminders within ${WINDOW_DAYS} days.`
      : `Queued ${affected} bill-due reminder${affected === 1 ? '' : 's'} (next ${WINDOW_DAYS} days).`,
    ...(warnings.length ? { warnings } : {}),
  };
}

export const automation: AutomationModule = {
  id: 'bill-due-reminder',
  name: 'Bill Due Reminder',
  domain: 'ap-bills',
  trigger: 'daily',
  run,
};
