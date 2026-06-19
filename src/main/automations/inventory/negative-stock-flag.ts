// src/main/automations/inventory/negative-stock-flag.ts
//
// Negative Stock Flag — daily automation.
//
// Scans inventory_items across all companies for a negative on-hand
// quantity (inventory_items.quantity < 0, which signals over-sale /
// data-entry error / out-of-order receipts) and QUEUES a notification
// so the user is alerted in-app. It NEVER moves money or mutates the
// item itself — it only writes an advisory notification row.
//
// Idempotent: before inserting, it checks for an existing UNREAD
// notification of the same type pointing at the same item, so
// re-running the same day (or any day while the negative state
// persists) does not pile up duplicate alerts.
//
// Style/db patterns mirror src/main/crons/overdue-checker.ts.

import { randomUUID } from 'crypto';
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

const NOTIFICATION_TYPE = 'inventory_negative_stock';

export const automation: AutomationModule = {
  id: 'negative-stock-flag',
  name: 'Negative Stock Flag',
  domain: 'inventory',
  trigger: 'daily',
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
    const warnings: string[] = [];
    let affected = 0;

    let database;
    try {
      database = db.getDb();
    } catch (err: any) {
      return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
    }

    // Determine which companies to scan.
    let companyIds: string[] = [];
    try {
      const scoped = ctx?.companyId || db.getCurrentCompanyId();
      if (scoped) {
        companyIds = [scoped];
      } else {
        const rows = database.prepare(`SELECT id FROM companies`).all() as any[];
        companyIds = rows.map((r) => String(r.id));
      }
    } catch (err: any) {
      return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
    }

    for (const companyId of companyIds) {
      try {
        const negatives = database.prepare(`
          SELECT id, name, sku, quantity
          FROM inventory_items
          WHERE company_id = ?
            AND COALESCE(quantity, 0) < 0
        `).all(companyId) as any[];

        for (const item of negatives) {
          try {
            // Idempotency guard: skip if an unread alert already exists
            // for this item.
            const existing = database.prepare(`
              SELECT id FROM notifications
              WHERE company_id = ?
                AND type = ?
                AND entity_type = 'inventory_item'
                AND entity_id = ?
                AND is_read = 0
              LIMIT 1
            `).get(companyId, NOTIFICATION_TYPE, String(item.id)) as any;

            if (existing) continue;

            const qty = Number(item.quantity) || 0;
            const label = item.sku ? `${item.name} (${item.sku})` : item.name;

            database.prepare(`
              INSERT INTO notifications
                (id, company_id, type, title, message, entity_type, entity_id, is_read)
              VALUES (?, ?, ?, ?, ?, 'inventory_item', ?, 0)
            `).run(
              randomUUID(),
              companyId,
              NOTIFICATION_TYPE,
              'Negative stock detected',
              `${label} has a negative on-hand quantity of ${qty}. Review for over-sale or data-entry errors.`,
              String(item.id),
            );
            affected++;
          } catch (itemErr: any) {
            warnings.push(`Item ${item?.id ?? '?'}: ${itemErr?.message || itemErr}`);
          }
        }
      } catch (companyErr: any) {
        warnings.push(`Company ${companyId}: ${companyErr?.message || companyErr}`);
      }
    }

    return {
      ok: true,
      affected,
      detail: affected > 0
        ? `Queued ${affected} negative-stock notification(s) across ${companyIds.length} company(ies).`
        : `No new negative-stock items found across ${companyIds.length} company(ies).`,
      ...(warnings.length ? { warnings } : {}),
    };
  },
};
