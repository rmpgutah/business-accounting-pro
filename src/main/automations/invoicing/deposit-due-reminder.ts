// src/main/automations/invoicing/deposit-due-reminder.ts
//
// Deposit Due Reminder
//
// Queues a reminder (row in invoice_reminders) for any invoice whose
// outstanding deposit is coming due within the next 3 days, i.e.
// deposit_required > deposit_paid AND deposit_due_date is in
// [today, today+3].
//
// IMPORTANT SCHEMA NOTE: as of this writing the `invoices` table in
// schema.sql does NOT define deposit_required / deposit_paid /
// deposit_due_date columns. These may be added by a later migration.
// Rather than hard-fail, we probe the live table with PRAGMA
// table_info at runtime: if the columns are absent we degrade
// gracefully to { ok:false, ... } with a warning and act on nothing.
//
// Design choices (mirrors src/main/crons/overdue-checker.ts style):
//  • Best-effort: run() never throws; every db call is guarded.
//  • Idempotent: before inserting we check no pending deposit reminder
//    already exists for that invoice (marked via a stable message
//    prefix). Re-running the same day is a no-op.
//  • QUEUES only — writes a pending invoice_reminders row. Never sends
//    email or moves money.
//  • "owed" decided by BALANCE with a 0.005 epsilon, never by status.
//  • Scoped per company; iterates all companies (or ctx.companyId).

import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

const EPS = 0.005;
const REMINDER_PREFIX = '[deposit-due]';

// Today as YYYY-MM-DD in LOCAL timezone — matches how dates are
// stored (TEXT YYYY-MM-DD) and how overdue-checker computes "today".
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

function randomId(): string {
  return 'depremind_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  let affected = 0;

  let database;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  // Verify required deposit columns actually exist on `invoices`.
  try {
    const cols = (database.prepare(`PRAGMA table_info(invoices)`).all() as any[])
      .map((c) => String(c?.name || ''));
    const required = ['deposit_required', 'deposit_paid', 'deposit_due_date'];
    const missing = required.filter((c) => !cols.includes(c));
    if (missing.length > 0) {
      return {
        ok: false,
        affected: 0,
        detail: `Deposit columns not present on invoices table; nothing to do.`,
        warnings: [`Missing columns: ${missing.join(', ')}`],
      };
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to inspect invoices schema: ${err?.message || err}` };
  }

  // Ensure the queue table exists.
  try {
    const t = database.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='invoice_reminders'`
    ).get();
    if (!t) {
      return { ok: false, affected: 0, detail: `invoice_reminders table not found; cannot queue.` };
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to verify invoice_reminders: ${err?.message || err}` };
  }

  // Resolve target companies.
  let companies: { id: string }[] = [];
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

  const today = ctx?.todayISO || localTodayISO();
  const windowEnd = datePlusDays(today, 3);

  const findExisting = database.prepare(
    `SELECT id FROM invoice_reminders
       WHERE invoice_id = ? AND status = 'pending' AND message LIKE ?`
  );
  const insertReminder = database.prepare(
    `INSERT INTO invoice_reminders (id, invoice_id, reminder_type, scheduled_date, status, message)
     VALUES (?, ?, 'custom', ?, 'pending', ?)`
  );

  for (const { id: companyId } of companies) {
    let candidates: any[] = [];
    try {
      candidates = database.prepare(`
        SELECT id, invoice_number,
               COALESCE(deposit_required, 0) AS deposit_required,
               COALESCE(deposit_paid, 0)     AS deposit_paid,
               deposit_due_date
          FROM invoices
         WHERE company_id = ?
           AND status NOT IN ('paid', 'cancelled')
           AND deposit_due_date IS NOT NULL
           AND deposit_due_date != ''
           AND deposit_due_date >= ?
           AND deposit_due_date <= ?
           AND COALESCE(deposit_required, 0) - COALESCE(deposit_paid, 0) > ?
      `).all(companyId, today, windowEnd, EPS) as any[];
    } catch (err: any) {
      warnings.push(`Scan failed (company ${companyId}): ${err?.message || err}`);
      continue;
    }

    for (const inv of candidates) {
      const outstanding = Number(inv.deposit_required || 0) - Number(inv.deposit_paid || 0);
      if (!(outstanding > EPS)) continue; // BALANCE-based settled check

      try {
        const exists = findExisting.get(inv.id, `${REMINDER_PREFIX}%`);
        if (exists) continue; // idempotent: already queued

        const msg = `${REMINDER_PREFIX} Deposit of ${outstanding.toFixed(2)} due ${inv.deposit_due_date} ` +
          `for invoice ${inv.invoice_number || inv.id}.`;
        insertReminder.run(randomId(), inv.id, inv.deposit_due_date, msg);
        affected++;
      } catch (err: any) {
        warnings.push(`Queue failed for invoice ${inv.id}: ${err?.message || err}`);
      }
    }
  }

  const detail = `Queued ${affected} deposit-due reminder(s) for the next 3 days.`;
  return warnings.length > 0
    ? { ok: true, affected, detail, warnings }
    : { ok: true, affected, detail };
}

export const automation: AutomationModule = {
  id: 'deposit-due-reminder',
  name: 'Deposit Due Reminder',
  domain: 'invoicing',
  trigger: 'daily',
  run,
};
