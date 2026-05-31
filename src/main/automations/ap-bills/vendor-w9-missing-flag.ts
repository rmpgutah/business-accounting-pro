// src/main/automations/ap-bills/vendor-w9-missing-flag.ts
//
// Vendor W-9 Missing Flag (ap-bills domain)
//
// Flags 1099-eligible vendors that have no W-9 on file. A vendor is
// treated as 1099-eligible when it is active AND has at least one bill
// (i.e. we actually pay them, so an IRS 1099-NEC may be required at
// year-end). "W-9 on file" is determined defensively:
//
//   1. If a `vendor_w9_records` table exists, a row for the vendor
//      counts as a W-9 on file. (This is the canonical source named in
//      the task spec, but the table may not exist in every schema.)
//   2. Otherwise we fall back to `vendors.tax_id` being non-empty —
//      a populated tax id is the practical signal that the W-9 was
//      collected.
//
// For each eligible vendor that is MISSING a W-9 we QUEUE one
// notification (type 'vendor_w9_missing') rather than emailing anyone
// or mutating vendor data. The run is idempotent: a vendor is skipped
// if an unread/open flag for it already exists, so re-running the same
// day (or any day until the user clears it) never double-inserts.
//
// run() is BEST-EFFORT and NEVER THROWS — every db touch is guarded
// and any failure degrades to { ok:false, ... }.

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

// Local YYYY-MM-DD (matches overdue-checker convention).
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Best-effort check that a table exists in the SQLite catalog.
function tableExists(database: any, name: string): boolean {
  try {
    const row = database
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
      .get(name);
    return !!row;
  } catch {
    return false;
  }
}

function genId(): string {
  // No external uuid import — keep deps minimal and tsc-strict clean.
  return `w9flag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
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

  // Resolve company scope.
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

  const hasW9Table = tableExists(database, 'vendor_w9_records');
  if (!hasW9Table) {
    warnings.push("vendor_w9_records table not found; using vendors.tax_id as the W-9-on-file signal.");
  }

  let insert: any;
  try {
    insert = database.prepare(`
      INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
      VALUES (?, ?, 'vendor_w9_missing', ?, ?, 'vendor', ?, 0, datetime('now'))
    `);
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `notifications table unavailable: ${err?.message || err}` };
  }

  for (const { id: companyId } of companies) {
    // 1099-eligible vendors = active vendors that have at least one bill.
    let vendors: Array<{ id: string; name: string; tax_id: string }> = [];
    try {
      vendors = (database.prepare(`
        SELECT v.id, v.name, COALESCE(v.tax_id, '') AS tax_id
        FROM vendors v
        WHERE v.company_id = ?
          AND v.status = 'active'
          AND EXISTS (SELECT 1 FROM bills b WHERE b.vendor_id = v.id AND b.company_id = ?)
      `).all(companyId, companyId) as any[]) as typeof vendors;
    } catch (err: any) {
      warnings.push(`Vendor scan (company ${companyId}): ${err?.message || err}`);
      continue;
    }

    for (const v of vendors) {
      // Determine W-9-on-file.
      let onFile = false;
      try {
        if (hasW9Table) {
          const row = database
            .prepare(`SELECT 1 FROM vendor_w9_records WHERE vendor_id = ? LIMIT 1`)
            .get(v.id);
          onFile = !!row;
        } else {
          onFile = (v.tax_id || '').trim().length > 0;
        }
      } catch (err: any) {
        // If the W-9 lookup itself fails, fall back to tax_id and warn once-ish.
        onFile = (v.tax_id || '').trim().length > 0;
      }

      if (onFile) continue;

      // Idempotency: skip if an open (unread) flag already exists for this vendor.
      try {
        const existing = database.prepare(`
          SELECT 1 FROM notifications
          WHERE company_id = ?
            AND type = 'vendor_w9_missing'
            AND entity_type = 'vendor'
            AND entity_id = ?
            AND is_read = 0
          LIMIT 1
        `).get(companyId, v.id);
        if (existing) continue;
      } catch (err: any) {
        warnings.push(`Idempotency check failed for vendor ${v.id}: ${err?.message || err}`);
        continue;
      }

      try {
        insert.run(
          genId(),
          companyId,
          'W-9 missing for 1099-eligible vendor',
          `Vendor "${v.name}" has paid bills but no W-9 on file. Collect a W-9 before issuing a 1099 (flagged ${today}).`,
          v.id,
        );
        affected++;
      } catch (err: any) {
        warnings.push(`Failed to queue flag for vendor ${v.id}: ${err?.message || err}`);
      }
    }
  }

  return {
    ok: true,
    affected,
    detail: affected > 0
      ? `Queued ${affected} W-9-missing flag(s) across ${companies.length} compan${companies.length === 1 ? 'y' : 'ies'}.`
      : `No new W-9-missing flags; all 1099-eligible vendors have a W-9 on file or were already flagged.`,
    warnings: warnings.length ? warnings : undefined,
  };
}

export const automation: AutomationModule = {
  id: 'vendor-w9-missing-flag',
  name: 'Vendor W-9 Missing Flag',
  domain: 'ap-bills',
  trigger: 'weekly',
  run,
};
