// src/main/automations/ap-bills/duplicate-bill-detector.ts
//
// Duplicate Bill Detector
//
// Scans accounts-payable bills and flags likely duplicates: two or more
// bills for the SAME vendor with the SAME total that ALSO share either
// the same bill_number OR the same issue_date. Duplicate vendor bills are
// a classic source of double-payment; surfacing them lets a human review
// before money moves.
//
// Design:
//  • BEST-EFFORT: run() never throws. All db work is wrapped in try/catch
//    and degrades to { ok:false } with a warning on any error.
//  • Per-company: iterates every row in `companies` (or ctx.companyId).
//  • QUEUES a notification (type 'duplicate_bill') per duplicate group —
//    never moves money, never deletes, never sends external email.
//  • IDEMPOTENT: before inserting, checks notifications for an existing
//    row with the same type + entity_id (the canonical/first bill id of
//    the group). Re-running the same day inserts nothing new.
//  • Excludes void/draft bills — only real, actionable bills are grouped.

import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function genId(): string {
  return `dupbill_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  let affected = 0;

  const today = ctx?.todayISO || localTodayISO();

  let database: ReturnType<typeof db.getDb>;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  // Resolve which companies to scan.
  let companyIds: string[] = [];
  try {
    if (ctx?.companyId) {
      companyIds = [ctx.companyId];
    } else {
      const rows = database.prepare(`SELECT id FROM companies`).all() as any[];
      companyIds = rows.map((r) => String(r.id));
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
  }

  for (const companyId of companyIds) {
    let bills: any[] = [];
    try {
      bills = database.prepare(`
        SELECT id, vendor_id, bill_number, issue_date, total, status
        FROM bills
        WHERE company_id = ?
          AND status NOT IN ('void', 'draft')
          AND vendor_id IS NOT NULL
          AND vendor_id != ''
      `).all(companyId) as any[];
    } catch (err: any) {
      warnings.push(`Bill scan failed (company ${companyId}): ${err?.message || err}`);
      continue;
    }

    // Group by vendor_id + rounded total (2dp tolerance), then within each
    // group find sub-groups sharing bill_number or issue_date.
    const byVendorTotal = new Map<string, any[]>();
    for (const b of bills) {
      const total = Number(b.total || 0);
      const key = `${b.vendor_id}|${total.toFixed(2)}`;
      const arr = byVendorTotal.get(key);
      if (arr) arr.push(b);
      else byVendorTotal.set(key, [b]);
    }

    for (const group of byVendorTotal.values()) {
      if (group.length < 2) continue;

      // Within a same-vendor/same-total group, a duplicate requires also
      // matching bill_number OR issue_date. Build matched clusters.
      const clusters = new Map<string, any[]>();
      const addTo = (k: string, b: any) => {
        const arr = clusters.get(k);
        if (arr) arr.push(b);
        else clusters.set(k, [b]);
      };
      for (const b of group) {
        const num = String(b.bill_number || '').trim();
        const dt = String(b.issue_date || '').trim();
        // Two distinct keys so a bill joins both its number-cluster and
        // its date-cluster; a cluster with >=2 members is a duplicate set.
        if (num) addTo(`num:${num}`, b);
        if (dt) addTo(`date:${dt}`, b);
      }

      for (const cluster of clusters.values()) {
        if (cluster.length < 2) continue;

        // Canonical (earliest) bill id anchors idempotency for this group.
        const sorted = [...cluster].sort((a, b) => String(a.id).localeCompare(String(b.id)));
        const canonicalId = String(sorted[0].id);

        try {
          const existing = database.prepare(`
            SELECT id FROM notifications
            WHERE company_id = ? AND type = 'duplicate_bill' AND entity_id = ?
            LIMIT 1
          `).get(companyId, canonicalId) as any;
          if (existing) continue; // already flagged — idempotent skip
        } catch (err: any) {
          warnings.push(`Idempotency check failed (company ${companyId}): ${err?.message || err}`);
          continue;
        }

        const first = sorted[0];
        const total = Number(first.total || 0);
        const vendorId = String(first.vendor_id);
        const billNumbers = sorted.map((b) => String(b.bill_number || '')).join(', ');
        const message =
          `${sorted.length} bills for vendor share total ${total.toFixed(2)} ` +
          `(bill #: ${billNumbers}). Review for possible duplicate before paying.`;

        try {
          database.prepare(`
            INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
            VALUES (?, ?, 'duplicate_bill', ?, ?, 'bill', ?, 0, ?)
          `).run(
            genId(),
            companyId,
            'Possible duplicate bill',
            message,
            canonicalId,
            `${today}T00:00:00`,
          );
          affected++;
        } catch (err: any) {
          warnings.push(`Notification insert failed (company ${companyId}, vendor ${vendorId}): ${err?.message || err}`);
        }
      }
    }
  }

  const detail = affected > 0
    ? `Flagged ${affected} possible duplicate-bill group(s).`
    : `No new duplicate bills detected.`;

  return warnings.length > 0
    ? { ok: true, affected, detail, warnings }
    : { ok: true, affected, detail };
}

export const automation: AutomationModule = {
  id: 'duplicate-bill-detector',
  name: 'Duplicate Bill Detector',
  domain: 'ap-bills',
  trigger: 'daily',
  run,
};
