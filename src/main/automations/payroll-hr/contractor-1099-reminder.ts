// src/main/automations/payroll-hr/contractor-1099-reminder.ts
//
// Contractor 1099 Reminder
// ------------------------
// Near calendar year-end, scan reportable contractor payments
// (contractor_pay_items.reportable_1099 = 1) aggregated by vendor for
// the current tax year. Any vendor whose YTD reportable total meets the
// IRS 1099-NEC reporting threshold ($600) gets a QUEUED reminder row in
// the `notifications` table so the user remembers to issue a Form 1099.
//
// Safety / design:
//  • NEVER throws — all db work is wrapped; returns ok:false on error.
//  • NEVER moves money or sends external mail — only queues an in-app
//    notification (best-effort reminder).
//  • IDEMPOTENT — re-running the same tax year does not duplicate a
//    reminder: we check for an existing notification keyed by
//    entity_type='vendor' + entity_id=vendor + a year-stamped type.
//  • Gated to "near year-end" (Nov/Dec) plus a January grace window so
//    a fresh-year run still nudges for the just-closed year. Outside
//    that window the run is a no-op (ok:true, affected:0).
//  • Scoped by company_id; iterates all companies unless ctx.companyId.
//  • Money threshold uses the IRS $600 floor with a 0.005 epsilon.
//
// Trigger: 'monthly' — there is no 'yearly' trigger; monthly cadence is
// cheap and the run self-gates to the year-end window.

import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

// IRS 1099-NEC reporting threshold (USD).
const THRESHOLD_1099 = 600;
const EPSILON = 0.005;

function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
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
  const month = parseInt(today.slice(5, 7), 10);
  const todayYear = parseInt(today.slice(0, 4), 10);
  if (!Number.isFinite(todayYear) || !Number.isFinite(month)) {
    return { ok: false, affected: 0, detail: `Bad today value: ${today}` };
  }

  // Year-end window: Nov (11) and Dec (12) reminding for the current
  // year; January reminding for the just-closed prior year.
  let taxYear: number;
  if (month >= 11) {
    taxYear = todayYear;
  } else if (month === 1) {
    taxYear = todayYear - 1;
  } else {
    return { ok: true, affected: 0, detail: `Outside year-end window (month ${month}); no-op` };
  }

  // Year-stamped notification type makes idempotency per-year cheap.
  const notifType = `contractor_1099_reminder_${taxYear}`;
  const yearStart = `${taxYear}-01-01`;
  const yearEnd = `${taxYear}-12-31`;

  // Resolve target companies.
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

  for (const { id: companyId } of companies) {
    let vendors: Array<{ vendor_id: string; ytd: number }> = [];
    try {
      // Aggregate reportable YTD by vendor, scoped to the tax year via
      // the parent pay run's pay_date. reportable_1099 = 1 only.
      vendors = (database.prepare(`
        SELECT cpi.vendor_id AS vendor_id, SUM(COALESCE(cpi.amount, 0)) AS ytd
        FROM contractor_pay_items cpi
        INNER JOIN contractor_pay_runs cpr ON cpr.id = cpi.contractor_pay_run_id
        WHERE cpi.company_id = ?
          AND cpi.reportable_1099 = 1
          AND cpi.vendor_id IS NOT NULL
          AND cpi.vendor_id != ''
          AND cpr.pay_date IS NOT NULL
          AND cpr.pay_date >= ?
          AND cpr.pay_date <= ?
        GROUP BY cpi.vendor_id
      `).all(companyId, yearStart, yearEnd) as any[]) as Array<{ vendor_id: string; ytd: number }>;
    } catch (err: any) {
      warnings.push(`Aggregate failed (company ${companyId}): ${err?.message || err}`);
      continue;
    }

    for (const v of vendors) {
      const ytd = Number(v.ytd || 0);
      // Threshold check with epsilon — meets $600 floor.
      if (ytd + EPSILON < THRESHOLD_1099) continue;

      try {
        // Idempotency: skip if a reminder for this vendor + tax year
        // already exists.
        const existing = database.prepare(`
          SELECT id FROM notifications
          WHERE company_id = ? AND type = ? AND entity_type = 'vendor' AND entity_id = ?
          LIMIT 1
        `).get(companyId, notifType, v.vendor_id) as any;
        if (existing) continue;

        let vendorName = 'Contractor';
        try {
          const vr = database.prepare(`SELECT name FROM vendors WHERE id = ? AND company_id = ?`)
            .get(v.vendor_id, companyId) as any;
          if (vr?.name) vendorName = String(vr.name);
        } catch { /* name lookup best-effort */ }

        const id = (typeof (globalThis as any).crypto?.randomUUID === 'function')
          ? (globalThis as any).crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

        database.prepare(`
          INSERT INTO notifications
            (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
          VALUES (?, ?, ?, ?, ?, 'vendor', ?, 0, datetime('now'))
        `).run(
          id,
          companyId,
          notifType,
          `1099 needed: ${vendorName}`,
          `${vendorName} received $${ytd.toFixed(2)} in reportable payments for ${taxYear} (>= $${THRESHOLD_1099} threshold). Issue Form 1099-NEC.`,
          v.vendor_id,
        );
        affected++;
      } catch (err: any) {
        warnings.push(`Queue failed (vendor ${v.vendor_id}): ${err?.message || err}`);
      }
    }
  }

  return {
    ok: true,
    affected,
    detail: `Queued ${affected} 1099 reminder(s) for tax year ${taxYear}`,
    ...(warnings.length ? { warnings } : {}),
  };
}

export const automation: AutomationModule = {
  id: 'contractor-1099-reminder',
  name: 'Contractor 1099 Reminder',
  domain: 'payroll-hr',
  trigger: 'monthly',
  run,
};
