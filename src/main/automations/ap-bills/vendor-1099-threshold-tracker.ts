// src/main/automations/ap-bills/vendor-1099-threshold-tracker.ts
//
// Vendor 1099 Threshold Tracker
//
// Flags vendors whose YTD payments cross the 1099 reporting threshold so
// the user can prepare 1099-NEC/1099-MISC forms at year end. Sums actual
// cash paid to each vendor (bill_payments rows in the current calendar
// year) and, when a vendor's YTD total >= the configured threshold,
// queues a notification.
//
// Design notes:
//  • The IRS 1099-NEC reporting threshold is $600. We read a per-company
//    override from settings key 'vendor_1099_threshold' if present, else
//    default to 600. (The assigned `vendor_1099_thresholds` table does
//    not exist in schema.sql, so we degrade gracefully to the settings
//    key / default rather than referencing an unverified table.)
//  • Idempotent: a notification of type 'vendor_1099_threshold' carrying
//    entity_id = vendorId is queued at most once per vendor per calendar
//    year. We check for an existing row (matched on the year embedded in
//    the message marker) before inserting.
//  • Best-effort: never throws. Any failure returns ok:false.
//  • Queues a notification only — never sends email or files forms.

import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

const SETTLED_EPSILON = 0.005; // money epsilon (unused for owed here, kept for consistency)
const DEFAULT_THRESHOLD = 600; // IRS 1099-NEC reporting floor (USD)

function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getThreshold(database: any, companyId: string): number {
  try {
    const row = database.prepare(
      "SELECT value FROM settings WHERE company_id = ? AND key = 'vendor_1099_threshold'"
    ).get(companyId) as { value?: string } | undefined;
    const v = parseFloat(row?.value ?? '');
    if (Number.isFinite(v) && v > 0) return v;
  } catch { /* fall through */ }
  return DEFAULT_THRESHOLD;
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

  const today = ctx?.todayISO || localTodayISO();
  const year = today.slice(0, 4);
  if (!/^\d{4}$/.test(year)) {
    return { ok: false, affected: 0, detail: `Invalid year derived from today '${today}'` };
  }
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  // Marker embedded in the notification message so we can dedupe per year.
  const yearMarker = `[1099:${year}]`;

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

  for (const { id: companyId } of companies) {
    let threshold = DEFAULT_THRESHOLD;
    try {
      threshold = getThreshold(database, companyId);

      // Sum YTD cash paid per vendor from bill_payments joined to bills.
      // Scoped by the company on both the payment and (defensively) the bill.
      const rows = database.prepare(`
        SELECT b.vendor_id AS vendor_id,
               COALESCE(SUM(bp.amount), 0) AS ytd_paid
        FROM bill_payments bp
        JOIN bills b ON b.id = bp.bill_id
        WHERE bp.company_id = ?
          AND b.company_id = ?
          AND b.vendor_id IS NOT NULL
          AND b.vendor_id != ''
          AND bp.date >= ?
          AND bp.date <= ?
        GROUP BY b.vendor_id
      `).all(companyId, companyId, yearStart, yearEnd) as Array<{ vendor_id: string; ytd_paid: number }>;

      for (const r of rows) {
        const ytd = Number(r.ytd_paid || 0);
        // Cross the threshold (>=), using epsilon to avoid float noise.
        if (ytd + SETTLED_EPSILON < threshold) continue;

        // Idempotency: already flagged this vendor for this year?
        const existing = database.prepare(`
          SELECT 1 FROM notifications
          WHERE company_id = ?
            AND type = 'vendor_1099_threshold'
            AND entity_type = 'vendor'
            AND entity_id = ?
            AND message LIKE ?
          LIMIT 1
        `).get(companyId, r.vendor_id, `%${yearMarker}%`) as any;
        if (existing) continue;

        // Resolve vendor name for a friendly notification.
        let vendorName = 'Vendor';
        try {
          const v = database.prepare(
            `SELECT name FROM vendors WHERE id = ? AND company_id = ?`
          ).get(r.vendor_id, companyId) as { name?: string } | undefined;
          if (v?.name) vendorName = v.name;
        } catch { /* name best-effort */ }

        const id = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        database.prepare(`
          INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
          VALUES (?, ?, 'vendor_1099_threshold', ?, ?, 'vendor', ?, 0, datetime('now'))
        `).run(
          id,
          companyId,
          `1099 threshold reached: ${vendorName}`,
          `${vendorName} has received $${ytd.toFixed(2)} in payments YTD (${year}), at or above the $${threshold.toFixed(2)} 1099 reporting threshold. Prepare a 1099 form. ${yearMarker}`,
          r.vendor_id,
        );
        affected++;

        try {
          db.logAudit(companyId, 'vendors', r.vendor_id, 'vendor_1099_flagged', {
            ytd_paid: ytd,
            threshold,
            year,
            automation: 'vendor-1099-threshold-tracker',
          });
        } catch { /* audit best-effort */ }
      }
    } catch (err: any) {
      warnings.push(`Company ${companyId}: ${err?.message || err}`);
    }
  }

  return {
    ok: true,
    affected,
    detail: affected > 0
      ? `Flagged ${affected} vendor(s) crossing the 1099 threshold for ${year}.`
      : `No new vendors crossed the 1099 threshold for ${year}.`,
    ...(warnings.length ? { warnings } : {}),
  };
}

export const automation: AutomationModule = {
  id: 'vendor-1099-threshold-tracker',
  name: 'Vendor 1099 Threshold Tracker',
  domain: 'ap-bills',
  trigger: 'monthly',
  run,
};
