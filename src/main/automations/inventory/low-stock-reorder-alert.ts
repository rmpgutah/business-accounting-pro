// src/main/automations/inventory/low-stock-reorder-alert.ts
//
// Low Stock Reorder Alert
//
// Scans inventory_items per company and queues a row into
// low_stock_alerts whenever an item's on-hand quantity has fallen to
// or below its reorder_point. This is a best-effort, queue-only
// automation: it NEVER reorders, moves money, or sends external mail —
// it only writes an active alert row that the inventory UI surfaces.
//
// Idempotency: an item with an existing status='active' alert is
// skipped, so re-running the same day (or hourly) never produces
// duplicate alerts. When stock is replenished above the reorder point,
// any lingering active alert for that item is auto-resolved.
//
// Defensive: every db touch is wrapped in try/catch; on any failure the
// run degrades to { ok:false, affected:0 } with a warning rather than
// throwing. Queries are cast as any[] and only reference columns that
// exist in schema.sql (inventory_items) / database/index.ts migration
// F118 (low_stock_alerts).

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

// Local YYYY-MM-DD (matches overdue-checker.ts convention).
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function newId(): string {
  try {
    // crypto.randomUUID is available in Electron's Node runtime.
    return (globalThis as any).crypto?.randomUUID?.() ?? `lsa_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  } catch {
    return `lsa_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

const EPS = 0.005;

function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  let affected = 0;

  let database: ReturnType<typeof db.getDb>;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  const todayISO = ctx?.todayISO || localTodayISO();
  const nowStamp = `${todayISO} 00:00:00`;

  // Resolve the set of companies to scan.
  let companyIds: string[] = [];
  try {
    if (ctx?.companyId) {
      companyIds = [ctx.companyId];
    } else {
      const cur = (() => { try { return db.getCurrentCompanyId(); } catch { return null; } })();
      if (cur) {
        companyIds = [cur];
      } else {
        const rows = database.prepare(`SELECT id FROM companies`).all() as any[];
        companyIds = rows.map((r) => String(r.id));
      }
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to resolve companies: ${err?.message || err}` };
  }

  if (companyIds.length === 0) {
    return { ok: true, affected: 0, detail: 'No companies to scan.' };
  }

  // Prepared statements (guarded — if low_stock_alerts is absent we bail).
  let selectItems: any, selectActive: any, insertAlert: any, resolveAlert: any;
  try {
    selectItems = database.prepare(`
      SELECT id, name, sku, quantity, reorder_point
      FROM inventory_items
      WHERE company_id = ?
        AND COALESCE(reorder_point, 0) > 0
    `);
    selectActive = database.prepare(`
      SELECT id FROM low_stock_alerts
      WHERE company_id = ? AND item_id = ? AND status = 'active'
      LIMIT 1
    `);
    insertAlert = database.prepare(`
      INSERT INTO low_stock_alerts
        (id, company_id, item_id, threshold_quantity, current_quantity, severity, alerted_at, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'))
    `);
    resolveAlert = database.prepare(`
      UPDATE low_stock_alerts
      SET status = 'resolved', acknowledged_at = ?
      WHERE company_id = ? AND item_id = ? AND status = 'active'
    `);
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Schema unavailable (low_stock_alerts/inventory_items): ${err?.message || err}` };
  }

  let companiesScanned = 0;

  for (const companyId of companyIds) {
    let items: any[] = [];
    try {
      items = selectItems.all(companyId) as any[];
    } catch (err: any) {
      warnings.push(`Item scan failed (company ${companyId}): ${err?.message || err}`);
      continue;
    }
    companiesScanned++;

    for (const it of items) {
      const qty = Number(it.quantity || 0);
      const reorder = Number(it.reorder_point || 0);
      if (!(reorder > 0)) continue;

      // Low when on-hand is at or below the reorder point (epsilon-safe).
      const isLow = qty <= reorder + EPS;

      try {
        const existing = selectActive.get(companyId, it.id) as any;

        if (isLow) {
          if (existing) continue; // idempotent: already queued
          // Severity: 'critical' when fully depleted, else 'warning'.
          const severity = qty <= EPS ? 'critical' : 'warning';
          insertAlert.run(newId(), companyId, it.id, reorder, qty, severity, nowStamp);
          affected++;

          // Audit trail — best-effort, never fatal.
          try {
            db.logAudit(companyId, 'low_stock_alerts', String(it.id), 'low_stock_alert_queued', {
              item_id: it.id,
              name: it.name,
              sku: it.sku,
              quantity: qty,
              reorder_point: reorder,
              severity,
              source: 'low-stock-reorder-alert',
            });
          } catch { /* audit best-effort */ }
        } else if (existing) {
          // Stock replenished above reorder point — auto-resolve.
          resolveAlert.run(nowStamp, companyId, it.id);
          affected++;
        }
      } catch (err: any) {
        warnings.push(`Alert write failed (item ${it.id}): ${err?.message || err}`);
      }
    }
  }

  const detail = `Scanned ${companiesScanned} company(ies); ${affected} alert change(s) queued/resolved.`;
  return warnings.length
    ? { ok: true, affected, detail, warnings }
    : { ok: true, affected, detail };
}

export const automation: AutomationModule = {
  id: 'low-stock-reorder-alert',
  name: 'Low Stock Reorder Alert',
  domain: 'inventory',
  trigger: 'daily',
  run,
};
