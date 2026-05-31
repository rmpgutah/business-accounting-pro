// src/main/automations/inventory/dead-stock-flag.ts
//
// Dead Stock Flag automation.
//
// Flags inventory_items that have had NO inventory_movements in the
// last N days (default 90) as "dead stock" by QUEUEING a notification.
// Capital tied up in stock that never moves is a real cost; surfacing
// it lets the user discount/liquidate/return it.
//
// Design notes:
//   • Best-effort: run() NEVER throws. Any DB error degrades to
//     { ok:false } with a warning.
//   • Idempotent: before queueing a notification for an item we check
//     that an unread dead-stock notification for that item doesn't
//     already exist. Re-running the same day (or while still unread)
//     is a no-op.
//   • Never moves money / sends email — only writes a notification row.
//   • inventory_movements is created via migration (database/index.ts),
//     not schema.sql, so all access is wrapped defensively in try/catch.
//   • "no movements" includes items that have a movement row but whose
//     most-recent movement is older than the cutoff, AND items with
//     zero movement rows entirely (but only if the item is older than
//     the cutoff, so brand-new items aren't flagged immediately).

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

const DEAD_STOCK_DAYS = 90;
const NOTIF_TYPE = 'dead_stock';

function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// today minus N days as YYYY-MM-DD (local, noon-anchored to dodge DST).
function dateMinusDays(isoDate: string, days: number): string {
  const dt = new Date(`${isoDate}T12:00:00`);
  dt.setDate(dt.getDate() - days);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function genId(): string {
  return `ds_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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
  const cutoff = dateMinusDays(today, DEAD_STOCK_DAYS);

  // Determine which companies to scan.
  let companies: { id: string }[] = [];
  try {
    if (ctx?.companyId) {
      companies = [{ id: ctx.companyId }];
    } else {
      const current = (() => { try { return db.getCurrentCompanyId(); } catch { return null; } })();
      if (current) {
        companies = [{ id: current }];
      } else {
        companies = (database.prepare(`SELECT id FROM companies`).all() as any[]) as { id: string }[];
      }
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
  }

  // Prepared statements (guarded — tables may not exist on old DBs).
  let selectItems: any;
  let lastMovement: any;
  let existingNotif: any;
  let insertNotif: any;
  try {
    selectItems = database.prepare(`
      SELECT id, name, quantity, unit_cost, created_at
      FROM inventory_items
      WHERE company_id = ?
    `);
    lastMovement = database.prepare(`
      SELECT MAX(created_at) AS last_at
      FROM inventory_movements
      WHERE company_id = ? AND item_id = ?
    `);
    existingNotif = database.prepare(`
      SELECT id FROM notifications
      WHERE company_id = ? AND type = ? AND entity_type = 'inventory_item'
        AND entity_id = ? AND is_read = 0
      LIMIT 1
    `);
    insertNotif = database.prepare(`
      INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, 'inventory_item', ?, 0, datetime('now'))
    `);
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Required table missing: ${err?.message || err}` };
  }

  for (const { id: companyId } of companies) {
    let items: any[] = [];
    try {
      items = selectItems.all(companyId) as any[];
    } catch (err: any) {
      warnings.push(`Item scan (company ${companyId}): ${err?.message || err}`);
      continue;
    }

    for (const item of items) {
      try {
        // Only consider items that have existed at least DEAD_STOCK_DAYS,
        // so freshly-added inventory isn't flagged before it could move.
        const createdDay = String(item.created_at || '').slice(0, 10);
        if (createdDay && createdDay > cutoff) continue;

        // Most recent movement date for this item.
        let lastAt: string | null = null;
        try {
          const row = lastMovement.get(companyId, item.id) as { last_at?: string } | undefined;
          lastAt = row?.last_at ?? null;
        } catch {
          // inventory_movements unavailable — skip this company gracefully.
          warnings.push(`Movements table unavailable (company ${companyId})`);
          break;
        }

        const lastDay = lastAt ? String(lastAt).slice(0, 10) : null;
        // Dead if: no movement ever, OR last movement before cutoff.
        const isDead = !lastDay || lastDay <= cutoff;
        if (!isDead) continue;

        // Idempotency — skip if an unread dead-stock notice already exists.
        const dupe = existingNotif.get(companyId, NOTIF_TYPE, item.id);
        if (dupe) continue;

        const qty = Number(item.quantity || 0);
        const value = qty * Number(item.unit_cost || 0);
        const title = `Dead stock: ${item.name || 'Unnamed item'}`;
        const message = lastDay
          ? `No movement since ${lastDay} (>${DEAD_STOCK_DAYS} days). On hand: ${qty}, value ~${value.toFixed(2)}.`
          : `No recorded movements (>${DEAD_STOCK_DAYS} days). On hand: ${qty}, value ~${value.toFixed(2)}.`;

        insertNotif.run(genId(), companyId, NOTIF_TYPE, title, message, item.id);
        affected++;

        try {
          db.logAudit(companyId, 'inventory_items', item.id, 'dead_stock_flag', {
            last_movement: lastDay,
            cutoff,
            quantity: qty,
            value,
            automation: 'dead-stock-flag',
          });
        } catch { /* audit best-effort */ }
      } catch (err: any) {
        warnings.push(`Item ${item?.id} (company ${companyId}): ${err?.message || err}`);
      }
    }
  }

  return {
    ok: true,
    affected,
    detail: `Flagged ${affected} dead-stock item(s) (no movement in ${DEAD_STOCK_DAYS} days).`,
    ...(warnings.length ? { warnings } : {}),
  };
}

export const automation: AutomationModule = {
  id: 'dead-stock-flag',
  name: 'Dead Stock Flag',
  domain: 'inventory',
  trigger: 'weekly',
  run,
};
