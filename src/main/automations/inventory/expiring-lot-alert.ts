// src/main/automations/inventory/expiring-lot-alert.ts
//
// Expiring Lot Alert — flags inventory_lots rows whose expiry date is
// near (within a lookahead window) and QUEUES a notification per lot so
// the user can act (sell-through, markdown, write-off) before spoilage.
//
// Design notes:
//  • BEST-EFFORT: run() never throws. Every db access is wrapped in
//    try/catch and degrades to { ok:false, ... } with a warning.
//  • DEFENSIVE: the `inventory_lots` table is not guaranteed to exist in
//    this schema build. We probe it first; if absent we return ok:false
//    with a warning instead of crashing. We also tolerate variant column
//    names for the expiry date and remaining-quantity columns.
//  • IDEMPOTENT: before queueing we check the notifications table for an
//    existing unread alert of the same type for the same lot so a second
//    run on the same day does not duplicate.
//  • QUEUES ONLY: writes a row into `notifications` (entity_type='inventory_lot').
//    Never moves stock, never emails, never mutates the lot itself.
//  • Scoped per company_id; iterates all companies.

import { randomUUID } from 'crypto';
import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

// Days before expiry at which a lot is considered "nearing" expiry.
const LOOKAHEAD_DAYS = 30;

// Local YYYY-MM-DD (matches overdue-checker.ts; avoids UTC ±1 day drift).
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function datePlusDays(isoDate: string, days: number): string {
  const dt = new Date(`${isoDate}T12:00:00`); // anchor at noon to dodge DST edges
  dt.setDate(dt.getDate() + days);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Does a table exist?
function tableExists(database: any, table: string): boolean {
  try {
    const row = database.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`
    ).get(table) as { name?: string } | undefined;
    return !!row?.name;
  } catch {
    return false;
  }
}

// Return the set of column names present on a table.
function tableColumns(database: any, table: string): Set<string> {
  const cols = new Set<string>();
  try {
    const rows = database.prepare(`PRAGMA table_info(${table})`).all() as any[];
    for (const r of rows) if (r && typeof r.name === 'string') cols.add(r.name);
  } catch { /* ignore */ }
  return cols;
}

function pickColumn(cols: Set<string>, candidates: string[]): string | null {
  for (const c of candidates) if (cols.has(c)) return c;
  return null;
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

  // The lot table may not exist in this build — degrade quietly.
  if (!tableExists(database, 'inventory_lots')) {
    return {
      ok: false,
      affected: 0,
      detail: 'inventory_lots table not present in schema; nothing to scan.',
      warnings: ['inventory_lots table missing'],
    };
  }
  if (!tableExists(database, 'notifications')) {
    return {
      ok: false,
      affected: 0,
      detail: 'notifications table not present; cannot queue alerts.',
      warnings: ['notifications table missing'],
    };
  }

  const lotCols = tableColumns(database, 'inventory_lots');
  if (!lotCols.has('id') || !lotCols.has('company_id')) {
    return {
      ok: false,
      affected: 0,
      detail: 'inventory_lots missing required id/company_id columns.',
      warnings: ['inventory_lots shape unexpected'],
    };
  }

  // Resolve variant column names defensively.
  const expiryCol = pickColumn(lotCols, [
    'expiry_date', 'expiration_date', 'expires_at', 'expire_date', 'best_before',
  ]);
  if (!expiryCol) {
    return {
      ok: false,
      affected: 0,
      detail: 'inventory_lots has no recognizable expiry-date column.',
      warnings: ['no expiry column on inventory_lots'],
    };
  }
  // Optional columns — used for richer messaging / filtering when present.
  const qtyCol = pickColumn(lotCols, ['quantity_remaining', 'remaining_quantity', 'quantity', 'qty', 'quantity_on_hand']);
  const lotNoCol = pickColumn(lotCols, ['lot_number', 'lot_no', 'batch_number', 'batch_no', 'lot']);
  const itemIdCol = pickColumn(lotCols, ['item_id', 'inventory_item_id', 'product_id']);

  const today = ctx?.todayISO || localTodayISO();
  const windowEnd = datePlusDays(today, LOOKAHEAD_DAYS);

  // Companies to scan.
  let companies: { id: string }[] = [];
  try {
    if (ctx?.companyId) {
      companies = [{ id: ctx.companyId }];
    } else {
      companies = database.prepare(`SELECT id FROM companies`).all() as { id: string }[];
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
  }

  const NOTIF_TYPE = 'inventory_lot_expiring';
  const selectCols = [
    'id',
    `${expiryCol} AS expiry`,
    lotNoCol ? `${lotNoCol} AS lot_no` : `'' AS lot_no`,
    qtyCol ? `${qtyCol} AS qty` : `NULL AS qty`,
    itemIdCol ? `${itemIdCol} AS item_id` : `NULL AS item_id`,
  ].join(', ');

  // A lot is "nearing expiry" when its expiry date is within
  // [today, today+LOOKAHEAD] (still in date; expires soon). We treat
  // expiry stored as TEXT YYYY-MM-DD for lexical comparison.
  // Skip zero-quantity lots when a quantity column exists.
  const qtyFilter = qtyCol ? `AND COALESCE(${qtyCol}, 0) > 0.005` : '';
  const sql = `
    SELECT ${selectCols}
    FROM inventory_lots
    WHERE company_id = ?
      AND ${expiryCol} IS NOT NULL
      AND ${expiryCol} != ''
      AND ${expiryCol} >= ?
      AND ${expiryCol} <= ?
      ${qtyFilter}
  `;

  let scannedCompanies = 0;

  for (const { id: companyId } of companies) {
    let lots: Array<{ id: string; expiry: string; lot_no: string; qty: number | null; item_id: string | null }>;
    try {
      lots = database.prepare(sql).all(companyId, today, windowEnd) as any[];
      scannedCompanies++;
    } catch (err: any) {
      warnings.push(`Lot scan failed (company ${companyId}): ${err?.message || err}`);
      continue;
    }

    if (!lots.length) continue;

    let existsStmt: any;
    let insertStmt: any;
    try {
      existsStmt = database.prepare(
        `SELECT 1 FROM notifications
         WHERE company_id = ? AND type = ? AND entity_type = 'inventory_lot'
           AND entity_id = ? AND is_read = 0 LIMIT 1`
      );
      insertStmt = database.prepare(
        `INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
         VALUES (?, ?, ?, ?, ?, 'inventory_lot', ?, 0, datetime('now'))`
      );
    } catch (err: any) {
      warnings.push(`Notification prepare failed (company ${companyId}): ${err?.message || err}`);
      continue;
    }

    for (const lot of lots) {
      try {
        // Idempotency guard: skip if an unread alert already exists.
        const already = existsStmt.get(companyId, NOTIF_TYPE, lot.id);
        if (already) continue;

        const lotLabel = lot.lot_no ? `Lot ${lot.lot_no}` : `Lot ${lot.id}`;
        const qtyPart =
          lot.qty != null && Number.isFinite(Number(lot.qty))
            ? ` (${Number(lot.qty)} on hand)`
            : '';
        const title = `${lotLabel} expiring ${lot.expiry}`;
        const message = `${lotLabel}${qtyPart} expires on ${lot.expiry} (within ${LOOKAHEAD_DAYS} days). Review for sell-through, markdown, or write-off.`;

        insertStmt.run(randomUUID(), companyId, NOTIF_TYPE, title, message, lot.id);
        affected++;
      } catch (err: any) {
        warnings.push(`Queue failed for lot ${lot?.id} (company ${companyId}): ${err?.message || err}`);
      }
    }
  }

  return {
    ok: true,
    affected,
    detail: `Queued ${affected} expiring-lot alert(s) across ${scannedCompanies} company(ies); window ${today}..${windowEnd}.`,
    ...(warnings.length ? { warnings } : {}),
  };
}

export const automation: AutomationModule = {
  id: 'expiring-lot-alert',
  name: 'Expiring Lot Alert',
  domain: 'inventory',
  trigger: 'daily',
  run,
};
