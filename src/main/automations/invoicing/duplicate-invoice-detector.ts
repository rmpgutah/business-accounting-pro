// src/main/automations/invoicing/duplicate-invoice-detector.ts
//
// Duplicate Invoice Detector
//
// Flags invoices that share the same client_id + total + issue_date as
// potential duplicates. Groups are computed per company; any group with
// 2+ non-cancelled invoices is treated as a suspected duplicate cluster.
//
// SAFETY / DESIGN:
//  • Best-effort: run() never throws. All db work is wrapped in try/catch
//    and degrades to { ok:false } on any error.
//  • Idempotent: queues a notification per duplicate cluster, keyed by a
//    deterministic entity_id (client|date|total). Re-running the same day
//    skips clusters that already have a notification of this type — no
//    double-flagging, no money moved, no email sent.
//  • Scoped by company_id, iterating all companies (or ctx.companyId).
//  • Cancelled invoices are excluded so voided dupes don't trigger noise.

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
  return `dup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
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

  // Resolve company scope.
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

  try {
    const findGroups = database.prepare(`
      SELECT client_id, issue_date, total, COUNT(*) AS cnt, MIN(invoice_number) AS sample
      FROM invoices
      WHERE company_id = ?
        AND status != 'cancelled'
        AND client_id IS NOT NULL
        AND issue_date IS NOT NULL
        AND issue_date != ''
      GROUP BY client_id, issue_date, ROUND(COALESCE(total, 0), 2)
      HAVING cnt > 1
    `);

    const existsNotif = database.prepare(`
      SELECT 1 FROM notifications
      WHERE company_id = ? AND type = 'duplicate_invoice' AND entity_id = ?
      LIMIT 1
    `);

    const insertNotif = database.prepare(`
      INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
      VALUES (?, ?, 'duplicate_invoice', ?, ?, 'invoice', ?, 0, datetime('now'))
    `);

    for (const companyId of companyIds) {
      let groups: any[] = [];
      try {
        groups = findGroups.all(companyId) as any[];
      } catch (err: any) {
        warnings.push(`Scan failed for company ${companyId}: ${err?.message || err}`);
        continue;
      }

      for (const g of groups) {
        const totalVal = Number(g.total || 0);
        // Deterministic key — same cluster maps to the same entity_id,
        // making re-runs idempotent.
        const entityId = `${g.client_id}|${g.issue_date}|${totalVal.toFixed(2)}`;
        try {
          const already = existsNotif.get(companyId, entityId);
          if (already) continue;

          const title = `Possible duplicate invoices (${g.cnt})`;
          const message =
            `${g.cnt} invoices share client, issue date ${g.issue_date}, and total ${totalVal.toFixed(2)} ` +
            `(e.g. ${g.sample}). Detected ${today}. Review for duplicates.`;
          insertNotif.run(genId(), companyId, title, message, entityId);
          affected++;
        } catch (err: any) {
          warnings.push(`Flag failed (company ${companyId}, ${entityId}): ${err?.message || err}`);
        }
      }
    }
  } catch (err: any) {
    return { ok: false, affected, detail: `Detector error: ${err?.message || err}`, warnings: warnings.length ? warnings : undefined };
  }

  return {
    ok: true,
    affected,
    detail: `Flagged ${affected} potential duplicate invoice cluster(s) across ${companyIds.length} company(ies).`,
    warnings: warnings.length ? warnings : undefined,
  };
}

export const automation: AutomationModule = {
  id: 'duplicate-invoice-detector',
  name: 'Duplicate Invoice Detector',
  domain: 'invoicing',
  trigger: 'daily',
  run,
};
