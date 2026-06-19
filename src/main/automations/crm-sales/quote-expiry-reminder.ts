// src/main/automations/crm-sales/quote-expiry-reminder.ts
//
// Quote Expiry Reminder
//
// Daily best-effort sweep over open quotes:
//   1. EXPIRE  — quotes whose valid_until date has passed are flipped
//      to status='expired' (only from draft/sent — never touch
//      accepted/rejected/converted, which carry meaning we must keep).
//   2. REMIND  — quotes expiring within a near window (default 3 days)
//      get a queued notification so sales can follow up before the
//      quote lapses. We QUEUE a notification row; we never send email.
//
// Safety / correctness:
//   • run() is best-effort and NEVER throws — all db work is wrapped.
//   • Idempotent: expiry only matches non-expired rows (the UPDATE is a
//     no-op on re-run); reminders dedupe by checking notifications for
//     an existing row of the same type/entity before inserting.
//   • Dates are local YYYY-MM-DD (matches valid_until TEXT storage),
//     mirroring src/main/crons/overdue-checker.ts.
//   • Scoped per company via SELECT id FROM companies.
//
// Schema used (verified in schema.sql):
//   quotes(id, company_id, quote_number, client_name, status, valid_until)
//   notifications(id, company_id, type, title, message, entity_type,
//                 entity_id, is_read, created_at)
//   audit_log via db.logAudit(); quote.expired via EventBus.

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

const REMINDER_WINDOW_DAYS = 3;
const NOTIFICATION_TYPE = 'quote_expiring_soon';

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

  const today = ctx?.todayISO || localTodayISO();
  const windowEnd = addDays(today, REMINDER_WINDOW_DAYS);

  // Determine target companies.
  let companies: { id: string }[] = [];
  try {
    if (ctx?.companyId) {
      companies = [{ id: ctx.companyId }];
    } else {
      let current: string | undefined;
      try { current = db.getCurrentCompanyId?.() as string | undefined; } catch { /* ignore */ }
      if (current) {
        companies = [{ id: current }];
      } else {
        companies = (database.prepare(`SELECT id FROM companies`).all() as any[]).map(
          (r) => ({ id: String(r.id) })
        );
      }
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
  }

  for (const { id: companyId } of companies) {
    // ── 1. EXPIRE past-due open quotes ────────────────────────────
    try {
      const candidates = database.prepare(`
        SELECT id, quote_number, client_name, valid_until, status
        FROM quotes
        WHERE company_id = ?
          AND status IN ('draft','sent')
          AND valid_until IS NOT NULL
          AND valid_until != ''
          AND valid_until < ?
      `).all(companyId, today) as any[];

      if (candidates.length > 0) {
        const update = database.prepare(
          `UPDATE quotes SET status = 'expired', updated_at = datetime('now') WHERE id = ?`
        );
        const tx = database.transaction((rows: any[]) => {
          for (const q of rows) update.run(String(q.id));
        });
        tx(candidates);

        for (const q of candidates) {
          affected++;
          try {
            db.logAudit(companyId, 'quotes', String(q.id), 'auto_expire', {
              previous_status: q.status,
              new_status: 'expired',
              valid_until: q.valid_until,
              automation: 'quote-expiry-reminder',
            });
          } catch { /* audit best-effort */ }
          try {
            const eb = require('../../services/EventBus');
            eb?.eventBus?.emit?.({
              type: 'quote.expired',
              entityType: 'quote',
              entityId: String(q.id),
              companyId,
              data: {
                quote_number: q.quote_number,
                client_name: q.client_name,
                valid_until: q.valid_until,
                source: 'quote_expiry_automation',
              },
            });
          } catch { /* event-bus best-effort */ }
        }
      }
    } catch (err: any) {
      warnings.push(`Expire scan (company ${companyId}): ${err?.message || err}`);
    }

    // ── 2. REMIND on quotes expiring within the window ────────────
    try {
      const dueSoon = database.prepare(`
        SELECT id, quote_number, client_name, valid_until
        FROM quotes
        WHERE company_id = ?
          AND status IN ('draft','sent')
          AND valid_until IS NOT NULL
          AND valid_until != ''
          AND valid_until >= ?
          AND valid_until <= ?
      `).all(companyId, today, windowEnd) as any[];

      for (const q of dueSoon) {
        const quoteId = String(q.id);
        // Idempotent: skip if a reminder for this quote already queued.
        let exists = false;
        try {
          const prior = database.prepare(`
            SELECT 1 FROM notifications
            WHERE company_id = ? AND type = ? AND entity_type = 'quote' AND entity_id = ?
            LIMIT 1
          `).get(companyId, NOTIFICATION_TYPE, quoteId);
          exists = !!prior;
        } catch {
          // notifications table/columns unavailable — degrade quietly.
          warnings.push('notifications table unavailable; reminders skipped');
          break;
        }
        if (exists) continue;

        try {
          db.create('notifications', {
            company_id: companyId,
            type: NOTIFICATION_TYPE,
            title: `Quote ${q.quote_number || ''} expiring soon`.trim(),
            message: `Quote ${q.quote_number || quoteId} for ${q.client_name || 'client'} is valid until ${q.valid_until}. Follow up before it expires.`,
            entity_type: 'quote',
            entity_id: quoteId,
            is_read: 0,
          });
          affected++;
        } catch (err: any) {
          warnings.push(`Reminder insert (quote ${quoteId}): ${err?.message || err}`);
        }
      }
    } catch (err: any) {
      warnings.push(`Reminder scan (company ${companyId}): ${err?.message || err}`);
    }
  }

  return {
    ok: true,
    affected,
    detail: `Expired/reminded across ${companies.length} company(ies); ${affected} actions`,
    ...(warnings.length ? { warnings } : {}),
  };
}

export const automation: AutomationModule = {
  id: 'quote-expiry-reminder',
  name: 'Quote Expiry Reminder',
  domain: 'crm-sales',
  trigger: 'daily',
  run,
};
