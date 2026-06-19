// src/main/automations/ap-bills/bill-approval-sla-escalator.ts
//
// Bill Approval SLA Escalator
//
// Bills routed through the approval workflow land in `approval_queue`
// (record_type='bill', status='pending'). If a bill sits unapproved past
// its SLA window, this automation escalates it by QUEUEING a notification
// for the company so a human can act. It NEVER approves, pays, or emails
// anything directly — escalation is a flag, not an action.
//
// Design:
//  • Trigger: daily — SLA breaches are measured in days, not minutes.
//  • SLA window: per-company `settings` key 'bill_approval_sla_days'
//    (clamped [1,90]); defaults to 5 business-ish days.
//  • Idempotent: before queuing, checks that an UNREAD escalation
//    notification of the same type doesn't already exist for that queue
//    row. Re-running the same day is a no-op.
//  • Best-effort: every db op is wrapped in try/catch; run() never throws.
//  • Money/owed: not relevant here (no payment), but we still surface the
//    bill total so the notification is actionable.

import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

const SLA_DEFAULT_DAYS = 5;
const NOTIF_TYPE = 'bill_approval_sla_breach';

function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getSlaDays(database: any, companyId: string): number {
  try {
    const row = database.prepare(
      "SELECT value FROM settings WHERE company_id = ? AND key = 'bill_approval_sla_days'"
    ).get(companyId) as { value?: string } | undefined;
    const v = parseInt(row?.value ?? '', 10);
    if (Number.isFinite(v) && v >= 1) return Math.min(v, 90);
  } catch { /* fall through to default */ }
  return SLA_DEFAULT_DAYS;
}

function genId(): string {
  return `sla_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  let affected = 0;

  let database: any;
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
      companies = database.prepare(`SELECT id FROM companies`).all() as { id: string }[];
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
  }

  const today = ctx?.todayISO || localTodayISO();

  let insertNotif: any;
  let checkNotif: any;
  try {
    insertNotif = database.prepare(`
      INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, 'approval_queue', ?, 0, datetime('now'))
    `);
    // Idempotency guard: any prior unread escalation for this queue row.
    checkNotif = database.prepare(`
      SELECT 1 FROM notifications
      WHERE company_id = ? AND type = ? AND entity_type = 'approval_queue'
        AND entity_id = ? AND is_read = 0
      LIMIT 1
    `);
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `notifications table unavailable: ${err?.message || err}` };
  }

  for (const { id: companyId } of companies) {
    const slaDays = getSlaDays(database, companyId);

    let pending: any[] = [];
    try {
      // Bills still awaiting approval longer than the SLA window.
      // created_at is a datetime; julianday diff in days vs today (anchored
      // noon) gives elapsed days. We treat any breach > slaDays as escalatable.
      pending = database.prepare(`
        SELECT q.id AS queue_id, q.record_id AS bill_id, q.created_at AS queued_at,
               b.bill_number AS bill_number, b.total AS total, b.vendor_id AS vendor_id
        FROM approval_queue q
        LEFT JOIN bills b ON b.id = q.record_id
        WHERE q.company_id = ?
          AND q.record_type = 'bill'
          AND q.status = 'pending'
          AND q.created_at IS NOT NULL
          AND julianday(?) - julianday(date(q.created_at)) >= ?
      `).all(companyId, today, slaDays) as any[];
    } catch (err: any) {
      warnings.push(`Pending-approval scan (company ${companyId}): ${err?.message || err}`);
      continue;
    }

    for (const row of pending) {
      try {
        const already = checkNotif.get(companyId, NOTIF_TYPE, row.queue_id);
        if (already) continue; // idempotent: escalation already queued

        const billLabel = row.bill_number ? `Bill ${row.bill_number}` : `Bill (queue ${row.queue_id})`;
        const totalNum = Number(row.total || 0);
        const amountStr = Number.isFinite(totalNum) ? `$${totalNum.toFixed(2)}` : '';
        const msg = `${billLabel}${amountStr ? ` (${amountStr})` : ''} has been pending approval beyond the ${slaDays}-day SLA. Please review.`;

        insertNotif.run(genId(), companyId, NOTIF_TYPE, 'Bill approval overdue', msg, row.queue_id);
        affected++;

        try {
          db.logAudit(companyId, 'approval_queue', row.queue_id, 'sla_escalated', {
            bill_id: row.bill_id,
            bill_number: row.bill_number,
            total: row.total,
            queued_at: row.queued_at,
            sla_days: slaDays,
            automation: 'bill-approval-sla-escalator',
          });
        } catch { /* audit best-effort */ }
      } catch (err: any) {
        warnings.push(`Escalate queue ${row?.queue_id} (company ${companyId}): ${err?.message || err}`);
      }
    }
  }

  return {
    ok: true,
    affected,
    detail: affected > 0
      ? `Escalated ${affected} bill(s) past approval SLA.`
      : 'No bills past approval SLA.',
    ...(warnings.length ? { warnings } : {}),
  };
}

export const automation: AutomationModule = {
  id: 'bill-approval-sla-escalator',
  name: 'Bill Approval SLA Escalator',
  domain: 'ap-bills',
  trigger: 'daily',
  run,
};
