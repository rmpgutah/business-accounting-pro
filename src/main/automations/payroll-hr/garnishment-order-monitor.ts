// src/main/automations/payroll-hr/garnishment-order-monitor.ts
//
// Garnishment Order Monitor
//
// Scans active garnishment / child-support deductions (stored in
// employee_deductions with type='garnishment') and QUEUES a notification
// per active order so the next payroll run knows to process it. This
// NEVER moves money — it only flags. Re-running the same day is a no-op
// (idempotent: we skip orders that already have a notification queued
// today).
//
// Schema note: there are no standalone `garnishments` or
// `child_support_orders` tables. Garnishment orders live in
// `employee_deductions` with type='garnishment'. We treat all such
// active rows as garnishment orders to monitor. Everything is wrapped in
// try/catch and degrades to ok:false on any error.

import crypto from 'crypto';
import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

// Today as YYYY-MM-DD in LOCAL timezone (matches overdue-checker.ts).
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

  const today = ctx?.todayISO || localTodayISO();

  let database: ReturnType<typeof db.getDb>;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  // Resolve the set of companies to scan.
  let companies: { id: string }[] = [];
  try {
    if (ctx?.companyId) {
      companies = [{ id: ctx.companyId }];
    } else {
      const current = (() => { try { return db.getCurrentCompanyId(); } catch { return null; } })();
      if (current) {
        companies = [{ id: current }];
      } else {
        companies = (database.prepare(`SELECT id FROM companies`).all() as any[]).map(
          (r) => ({ id: String(r.id) })
        );
      }
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to resolve companies: ${err?.message || err}` };
  }

  if (companies.length === 0) {
    return { ok: true, affected: 0, detail: 'No companies to scan for garnishment orders.' };
  }

  let insertStmt: any;
  let existsStmt: any;
  let selectStmt: any;
  try {
    selectStmt = database.prepare(`
      SELECT id, employee_id, name, amount, effective_date, end_date
      FROM employee_deductions
      WHERE company_id = ?
        AND type = 'garnishment'
        AND COALESCE(is_active, 1) = 1
        AND (effective_date IS NULL OR effective_date = '' OR effective_date <= ?)
        AND (end_date IS NULL OR end_date = '' OR end_date >= ?)
    `);
    // Idempotency guard: has a "to process" notification already been
    // queued today for this specific garnishment order?
    existsStmt = database.prepare(`
      SELECT 1 FROM notifications
      WHERE company_id = ?
        AND type = 'garnishment_to_process'
        AND entity_type = 'employee_deduction'
        AND entity_id = ?
        AND substr(created_at, 1, 10) = ?
      LIMIT 1
    `);
    insertStmt = database.prepare(`
      INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
      VALUES (?, ?, 'garnishment_to_process', ?, ?, 'employee_deduction', ?, 0, datetime('now'))
    `);
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Schema mismatch preparing statements: ${err?.message || err}` };
  }

  for (const { id: companyId } of companies) {
    let orders: any[] = [];
    try {
      orders = selectStmt.all(companyId, today, today) as any[];
    } catch (err: any) {
      warnings.push(`Company ${companyId}: failed to read garnishment orders: ${err?.message || err}`);
      continue;
    }

    for (const order of orders) {
      try {
        const already = existsStmt.get(companyId, order.id, today);
        if (already) continue; // idempotent — already flagged today

        const label = order.name ? String(order.name) : 'Garnishment order';
        const amt = Number(order.amount || 0);
        const title = `Garnishment to process: ${label}`;
        const message =
          `Active garnishment/child-support order (${label}) for employee ${order.employee_id || 'unknown'} ` +
          `should be processed on the next payroll run.` +
          (amt > 0 ? ` Order amount: ${amt}.` : '');

        insertStmt.run(crypto.randomUUID(), companyId, title, message, order.id);
        affected++;
      } catch (err: any) {
        warnings.push(`Company ${companyId}, order ${order?.id}: failed to queue: ${err?.message || err}`);
      }
    }
  }

  const detail = affected > 0
    ? `Queued ${affected} active garnishment order(s) to be processed on the next payroll run.`
    : 'No new active garnishment orders to flag (all already queued or none active).';

  return { ok: true, affected, detail, ...(warnings.length ? { warnings } : {}) };
}

export const automation: AutomationModule = {
  id: 'garnishment-order-monitor',
  name: 'Garnishment Order Monitor',
  domain: 'payroll-hr',
  trigger: 'daily',
  run,
};
