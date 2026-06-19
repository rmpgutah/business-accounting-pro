// src/main/automations/ap-bills/early-pay-discount-alert.ts
//
// Early-Pay Discount Alert
//
// Flags unpaid AP bills whose early-payment discount window is about to
// close (within 2 days). The discount window is modeled as
//   issue_date + vendor.payment_terms (days)
// since the schema stores the discount window length on the vendor's
// payment_terms and the negotiated discount as bills.discount_amount.
// A bill is considered to HAVE an early-pay discount only when it carries
// a positive discount_amount AND its vendor has a positive payment_terms.
//
// SAFETY / DESIGN:
//  • Best-effort: run() never throws; any DB error degrades to ok:false.
//  • Never moves money or pays bills — only QUEUES an in-app notification.
//  • Idempotent: skips a bill if an unread early-pay notification already
//    exists for it (matched by type + entity_id), so re-running the same
//    day does not duplicate alerts.
//  • "Owed" decided by BALANCE (total - amount_paid > 0.005), never by the
//    status string alone.
//  • Iterates every company (or ctx.companyId when provided).

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

const EPSILON = 0.005;

// Today as YYYY-MM-DD in LOCAL timezone (matches how *_date is stored).
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(isoDate: string, days: number): string | null {
  if (!isoDate) return null;
  const dt = new Date(`${isoDate}T12:00:00`);
  if (isNaN(dt.getTime())) return null;
  dt.setDate(dt.getDate() + days);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Whole days from `fromISO` to `toISO` (toISO - fromISO).
function daysBetween(fromISO: string, toISO: string): number | null {
  const a = new Date(`${fromISO}T12:00:00`);
  const b = new Date(`${toISO}T12:00:00`);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function genId(): string {
  return `epda_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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

  // Resolve company set.
  let companyIds: string[] = [];
  try {
    if (ctx?.companyId) {
      companyIds = [ctx.companyId];
    } else {
      let current: string | null = null;
      try { current = db.getCurrentCompanyId?.() ?? null; } catch { /* optional */ }
      if (current) {
        companyIds = [current];
      } else {
        const rows = database.prepare(`SELECT id FROM companies`).all() as any[];
        companyIds = rows.map((r) => r.id);
      }
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to resolve companies: ${err?.message || err}` };
  }

  for (const companyId of companyIds) {
    let bills: any[] = [];
    try {
      // Only bills that (a) are still owed by balance, (b) carry a discount,
      // and (c) have a vendor payment_terms window to anchor the deadline.
      bills = database.prepare(`
        SELECT b.id            AS id,
               b.bill_number   AS bill_number,
               b.issue_date    AS issue_date,
               b.total         AS total,
               b.amount_paid   AS amount_paid,
               b.discount_amount AS discount_amount,
               v.name          AS vendor_name,
               v.payment_terms AS payment_terms
        FROM bills b
        JOIN vendors v ON v.id = b.vendor_id
        WHERE b.company_id = ?
          AND b.status NOT IN ('paid', 'void', 'draft')
          AND COALESCE(b.discount_amount, 0) > 0
          AND COALESCE(v.payment_terms, 0) > 0
          AND b.issue_date IS NOT NULL
          AND b.issue_date != ''
      `).all(companyId) as any[];
    } catch (err: any) {
      warnings.push(`Bill scan failed (company ${companyId}): ${err?.message || err}`);
      continue;
    }

    for (const bill of bills) {
      try {
        const balance = Number(bill.total || 0) - Number(bill.amount_paid || 0);
        if (balance <= EPSILON) continue; // settled by balance, not status

        const terms = Number(bill.payment_terms || 0);
        if (!(terms > 0)) continue;

        const deadline = addDays(String(bill.issue_date), terms);
        if (!deadline) continue;

        const daysLeft = daysBetween(today, deadline);
        if (daysLeft === null) continue;

        // Window closes within the next 2 days (and not already past).
        if (daysLeft < 0 || daysLeft > 2) continue;

        // Idempotency: don't re-queue if an unread alert already exists.
        let existing: any;
        try {
          existing = database.prepare(`
            SELECT id FROM notifications
            WHERE company_id = ? AND type = 'ap_early_pay_discount'
              AND entity_type = 'bill' AND entity_id = ? AND is_read = 0
            LIMIT 1
          `).get(companyId, bill.id);
        } catch (err: any) {
          warnings.push(`Idempotency check failed (bill ${bill.id}): ${err?.message || err}`);
          continue;
        }
        if (existing) continue;

        const discount = Number(bill.discount_amount || 0);
        const title = `Early-pay discount closing for bill ${bill.bill_number || bill.id}`;
        const message =
          `Pay bill ${bill.bill_number || bill.id} from ${bill.vendor_name || 'vendor'} ` +
          `by ${deadline} (${daysLeft === 0 ? 'today' : `in ${daysLeft} day(s)`}) ` +
          `to keep the ${discount.toFixed(2)} early-payment discount. Balance owed: ${balance.toFixed(2)}.`;

        try {
          database.prepare(`
            INSERT INTO notifications
              (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
            VALUES (?, ?, 'ap_early_pay_discount', ?, ?, 'bill', ?, 0, datetime('now'))
          `).run(genId(), companyId, title, message, bill.id);
          affected++;
        } catch (err: any) {
          warnings.push(`Failed to queue notification (bill ${bill.id}): ${err?.message || err}`);
        }
      } catch (err: any) {
        warnings.push(`Bill ${bill?.id} error: ${err?.message || err}`);
      }
    }
  }

  return {
    ok: true,
    affected,
    detail: `Queued ${affected} early-pay discount alert(s) across ${companyIds.length} company(ies).`,
    warnings: warnings.length ? warnings : undefined,
  };
}

export const automation: AutomationModule = {
  id: 'early-pay-discount-alert',
  name: 'Early-Pay Discount Alert',
  domain: 'ap-bills',
  trigger: 'daily',
  run,
};
