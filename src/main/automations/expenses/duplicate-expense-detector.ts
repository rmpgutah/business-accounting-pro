// src/main/automations/expenses/duplicate-expense-detector.ts
//
// Duplicate Expense Detector
//
// Flags expenses that share the same amount + vendor_id + date — a
// classic double-entry mistake (paid twice, imported twice, or hand-
// keyed on top of a bank-feed row). It does NOT delete or modify the
// expenses themselves; it QUEUES a notification per duplicate group so
// the user can review and decide.
//
// Safety / design:
//  • Best-effort: run() never throws. Any DB error → { ok:false }.
//  • Idempotent: each duplicate group gets a deterministic entity_id
//    ('dup-exp:<vendor_id>|<date>|<amount>'). Before inserting a
//    notification we check none already exists with that type+entity_id,
//    so re-running the same day (or every day) never double-queues.
//  • Company-scoped: iterates all companies via SELECT id FROM companies,
//    or honours ctx.companyId when provided.
//  • Only considers rows with a real vendor_id (NULL/'' vendor groups are
//    not meaningful "same vendor" duplicates) and a non-empty date.
//  • Amount comparison uses a 0.005 epsilon by rounding to cents before
//    grouping, so 10.00 and 10.004 collapse together.

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

function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  const today = ctx?.todayISO || localTodayISO();
  let affected = 0;

  let database: ReturnType<typeof db.getDb>;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  // Resolve target companies.
  let companies: { id: string }[] = [];
  try {
    if (ctx?.companyId) {
      companies = [{ id: ctx.companyId }];
    } else {
      companies = (database.prepare(`SELECT id FROM companies`).all() as any[]).map(
        (r) => ({ id: String(r.id) })
      );
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
  }

  let groupsFound = 0;

  for (const { id: companyId } of companies) {
    try {
      // Group expenses by vendor_id + date + rounded amount (cents),
      // keeping only groups with 2+ members. ROUND(amount,2) collapses
      // sub-cent differences (0.005 epsilon territory).
      const groups = database.prepare(`
        SELECT vendor_id            AS vendor_id,
               date                 AS date,
               ROUND(amount, 2)     AS amt,
               COUNT(*)             AS cnt,
               GROUP_CONCAT(id)     AS ids
        FROM expenses
        WHERE company_id = ?
          AND vendor_id IS NOT NULL
          AND vendor_id != ''
          AND date IS NOT NULL
          AND date != ''
        GROUP BY vendor_id, date, ROUND(amount, 2)
        HAVING COUNT(*) > 1
      `).all(companyId) as any[];

      for (const g of groups) {
        groupsFound++;
        const vendorId = String(g.vendor_id);
        const date = String(g.date);
        const amt = Number(g.amt) || 0;
        const count = Number(g.cnt) || 0;
        const entityId = `dup-exp:${vendorId}|${date}|${amt.toFixed(2)}`;

        // Idempotency guard — already queued for this group?
        let exists = false;
        try {
          const row = database.prepare(`
            SELECT 1 FROM notifications
            WHERE company_id = ? AND type = 'duplicate_expense' AND entity_id = ?
            LIMIT 1
          `).get(companyId, entityId);
          exists = !!row;
        } catch {
          // If the check fails we conservatively skip inserting to avoid
          // spamming duplicates; surface as a warning.
          warnings.push(`Idempotency check failed for ${companyId}/${entityId}`);
          continue;
        }
        if (exists) continue;

        // Resolve a friendly vendor name (best-effort).
        let vendorName = vendorId;
        try {
          const v = database.prepare(`SELECT name FROM vendors WHERE id = ?`).get(vendorId) as any;
          if (v?.name) vendorName = String(v.name);
        } catch { /* vendor name best-effort */ }

        const id = `dupexp_${companyId}_${date}_${vendorId}_${amt.toFixed(2)}`
          .replace(/[^a-zA-Z0-9_]/g, '_');

        try {
          database.prepare(`
            INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
            VALUES (?, ?, 'duplicate_expense', ?, ?, 'expense', ?, 0, datetime('now'))
          `).run(
            id,
            companyId,
            'Possible duplicate expense',
            `${count} expenses of ${amt.toFixed(2)} for ${vendorName} on ${date} — review for duplicates. (ids: ${String(g.ids || '')})`,
            entityId
          );
          affected++;
        } catch (err: any) {
          warnings.push(`Insert failed for ${companyId}/${entityId}: ${err?.message || err}`);
        }
      }
    } catch (err: any) {
      warnings.push(`Scan failed for company ${companyId}: ${err?.message || err}`);
    }
  }

  return {
    ok: true,
    affected,
    detail: `Scanned ${companies.length} company(ies) on ${today}; ${groupsFound} duplicate group(s) found, ${affected} new notification(s) queued.`,
    ...(warnings.length ? { warnings } : {}),
  };
}

export const automation: AutomationModule = {
  id: 'duplicate-expense-detector',
  name: 'Duplicate Expense Detector',
  domain: 'expenses',
  trigger: 'daily',
  run,
};
