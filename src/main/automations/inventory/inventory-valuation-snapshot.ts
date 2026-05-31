// src/main/automations/inventory/inventory-valuation-snapshot.ts
//
// Inventory Valuation Snapshot
// ----------------------------
// Once a day, compute the total inventory value per company
// (SUM(quantity * unit_cost) over inventory_items) and append a row
// to inventory_value_history. This builds a time-series the reports
// module can chart (inventory value trend over time).
//
// Design notes:
//  • BEST-EFFORT: run() never throws; any failure degrades to
//    { ok:false, affected:0, detail } so the scheduler keeps going.
//  • IDEMPOTENT: a UNIQUE(company_id, snapshot_date) constraint plus
//    INSERT OR IGNORE means re-running the same day is a no-op.
//  • DEFENSIVE: inventory_value_history is not in schema.sql, so we
//    CREATE TABLE IF NOT EXISTS it here. If inventory_items is missing
//    or anything else fails we warn and continue per-company.
//  • Reads NOTHING external, moves NO money — pure derived snapshot.

import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

// Local YYYY-MM-DD (mirrors crons/overdue-checker.ts) — snapshot_date
// is stored as TEXT and compared/keyed locally to avoid UTC drift.
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

  // Ensure the (non-schema) history table exists.
  try {
    database.prepare(`
      CREATE TABLE IF NOT EXISTS inventory_value_history (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        snapshot_date TEXT NOT NULL,
        total_value REAL NOT NULL DEFAULT 0,
        item_count INTEGER NOT NULL DEFAULT 0,
        total_quantity REAL NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(company_id, snapshot_date)
      )
    `).run();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Could not ensure inventory_value_history: ${err?.message || err}` };
  }

  // Determine company scope.
  let companies: { id: string }[] = [];
  try {
    const scoped = ctx?.companyId || db.getCurrentCompanyId();
    if (scoped) {
      companies = [{ id: scoped }];
    } else {
      companies = database.prepare(`SELECT id FROM companies`).all() as { id: string }[];
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to resolve companies: ${err?.message || err}` };
  }

  const insert = database.prepare(`
    INSERT OR IGNORE INTO inventory_value_history
      (id, company_id, snapshot_date, total_value, item_count, total_quantity, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  for (const { id: companyId } of companies) {
    try {
      const agg = database.prepare(`
        SELECT
          COUNT(*) AS item_count,
          COALESCE(SUM(COALESCE(quantity, 0) * COALESCE(unit_cost, 0)), 0) AS total_value,
          COALESCE(SUM(COALESCE(quantity, 0)), 0) AS total_quantity
        FROM inventory_items
        WHERE company_id = ?
      `).get(companyId) as { item_count: number; total_value: number; total_quantity: number } | undefined;

      const totalValue = Number(agg?.total_value || 0);
      const itemCount = Number(agg?.item_count || 0);
      const totalQty = Number(agg?.total_quantity || 0);

      const id = `ivh_${companyId}_${today}`;
      const res = insert.run(id, companyId, today, totalValue, itemCount, totalQty);
      if (res.changes > 0) affected++;
    } catch (err: any) {
      warnings.push(`Company ${companyId}: ${err?.message || err}`);
    }
  }

  const detail = affected > 0
    ? `Recorded ${affected} inventory valuation snapshot(s) for ${today}.`
    : `No new snapshots written for ${today} (already recorded or no companies).`;

  return { ok: true, affected, detail, warnings: warnings.length ? warnings : undefined };
}

export const automation: AutomationModule = {
  id: 'inventory-valuation-snapshot',
  name: 'Inventory Valuation Snapshot',
  domain: 'inventory',
  trigger: 'daily',
  run,
};
