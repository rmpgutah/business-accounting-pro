// ─── Batch 8: Inventory, Projects, Time (F111-F130) ───
//
// Multi-warehouse inventory, lot/serial tracking, transfers, adjustments,
// stock-takes, low-stock alerts, valuation methods, value snapshots,
// project tasks/milestones/resources/budgets/risks/change orders,
// timesheet periods + approvals, billable time summary, profitability.

import { randomUUID as uuid } from 'crypto';
import * as db from '../database';

const now = (): string => new Date().toISOString();
const today = (): string => now().slice(0, 10);

// ════════════════════════════════════════════════════════════════
// F111. Warehouses
// ════════════════════════════════════════════════════════════════
export function upsertWarehouse(w: { id?: string; company_id: string; code: string; name: string; address?: string; is_default?: boolean; is_active?: boolean; notes?: string }): any {
  const dbi = db.getDb();
  const id = w.id || uuid();
  if (w.id) {
    dbi.prepare(`UPDATE warehouses SET code = ?, name = ?, address = ?, is_default = ?, is_active = ?, notes = ?, updated_at = ? WHERE id = ?`)
      .run(w.code, w.name, w.address || null, w.is_default ? 1 : 0, w.is_active === false ? 0 : 1, w.notes || null, now(), w.id);
  } else {
    dbi.prepare(`INSERT INTO warehouses (id, company_id, code, name, address, is_default, is_active, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, w.company_id, w.code, w.name, w.address || null, w.is_default ? 1 : 0, w.is_active === false ? 0 : 1, w.notes || null, now(), now());
  }
  // Only one default warehouse per company
  if (w.is_default) {
    dbi.prepare(`UPDATE warehouses SET is_default = 0 WHERE company_id = ? AND id != ?`).run(w.company_id, id);
  }
  return { id, ...w };
}

export function listWarehouses(companyId: string, activeOnly: boolean = false): any[] {
  const dbi = db.getDb();
  let where = 'company_id = ?';
  if (activeOnly) where += ' AND is_active = 1';
  return dbi.prepare(`SELECT * FROM warehouses WHERE ${where} ORDER BY is_default DESC, name ASC`).all(companyId) as any[];
}

// ════════════════════════════════════════════════════════════════
// F112. Inventory locations (bin/shelf)
// ════════════════════════════════════════════════════════════════
export function upsertLocation(loc: { id?: string; company_id: string; warehouse_id: string; location_code: string; aisle?: string; rack?: string; bin?: string; capacity?: number; is_active?: boolean }): any {
  const dbi = db.getDb();
  const id = loc.id || uuid();
  if (loc.id) {
    dbi.prepare(`UPDATE inventory_locations SET location_code = ?, aisle = ?, rack = ?, bin = ?, capacity = ?, is_active = ? WHERE id = ?`)
      .run(loc.location_code, loc.aisle || null, loc.rack || null, loc.bin || null, loc.capacity || 0, loc.is_active === false ? 0 : 1, loc.id);
  } else {
    dbi.prepare(`INSERT INTO inventory_locations (id, company_id, warehouse_id, location_code, aisle, rack, bin, capacity, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, loc.company_id, loc.warehouse_id, loc.location_code, loc.aisle || null, loc.rack || null, loc.bin || null, loc.capacity || 0, loc.is_active === false ? 0 : 1, now());
  }
  return { id, ...loc };
}

export function listLocations(warehouseId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM inventory_locations WHERE warehouse_id = ? ORDER BY location_code ASC`).all(warehouseId) as any[];
}

// ════════════════════════════════════════════════════════════════
// F113. Inventory lots (batch tracking)
// ════════════════════════════════════════════════════════════════
export function upsertLot(lot: any): any {
  const dbi = db.getDb();
  const id = lot.id || uuid();
  if (lot.id) {
    dbi.prepare(`UPDATE inventory_lots SET warehouse_id = ?, location_id = ?, quantity = ?, unit_cost = ?, received_date = ?, expiry_date = ?, supplier_id = ?, status = ?, notes = ? WHERE id = ?`)
      .run(lot.warehouse_id || null, lot.location_id || null, lot.quantity || 0, lot.unit_cost || 0, lot.received_date || null, lot.expiry_date || null, lot.supplier_id || null, lot.status || 'available', lot.notes || null, lot.id);
  } else {
    dbi.prepare(`INSERT INTO inventory_lots (id, company_id, item_id, lot_number, warehouse_id, location_id, quantity, unit_cost, received_date, expiry_date, supplier_id, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, lot.company_id, lot.item_id, lot.lot_number, lot.warehouse_id || null, lot.location_id || null, lot.quantity || 0, lot.unit_cost || 0, lot.received_date || null, lot.expiry_date || null, lot.supplier_id || null, lot.status || 'available', lot.notes || null, now());
  }
  return { id, ...lot };
}

export function listLots(companyId: string, opts?: { item_id?: string; expiring_within_days?: number; status?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.item_id) { where += ' AND item_id = ?'; params.push(opts.item_id); }
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  if (opts?.expiring_within_days) {
    where += ` AND expiry_date <= date('now', '+' || ? || ' days') AND expiry_date IS NOT NULL`;
    params.push(opts.expiring_within_days);
  }
  return dbi.prepare(`SELECT * FROM inventory_lots WHERE ${where} ORDER BY expiry_date ASC NULLS LAST`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// F114. Inventory serial numbers
// ════════════════════════════════════════════════════════════════
export function upsertSerial(s: any): any {
  const dbi = db.getDb();
  const id = s.id || uuid();
  if (s.id) {
    dbi.prepare(`UPDATE inventory_serial_numbers SET lot_id = ?, warehouse_id = ?, location_id = ?, status = ?, purchase_date = ?, sold_date = ?, customer_id = ?, warranty_expires_at = ?, notes = ? WHERE id = ?`)
      .run(s.lot_id || null, s.warehouse_id || null, s.location_id || null, s.status || 'available', s.purchase_date || null, s.sold_date || null, s.customer_id || null, s.warranty_expires_at || null, s.notes || null, s.id);
  } else {
    dbi.prepare(`INSERT INTO inventory_serial_numbers (id, company_id, item_id, serial_number, lot_id, warehouse_id, location_id, status, purchase_date, sold_date, customer_id, warranty_expires_at, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, s.company_id, s.item_id, s.serial_number, s.lot_id || null, s.warehouse_id || null, s.location_id || null, s.status || 'available', s.purchase_date || null, s.sold_date || null, s.customer_id || null, s.warranty_expires_at || null, s.notes || null, now());
  }
  return { id, ...s };
}

export function listSerials(companyId: string, opts?: { item_id?: string; status?: string; customer_id?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.item_id) { where += ' AND item_id = ?'; params.push(opts.item_id); }
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  if (opts?.customer_id) { where += ' AND customer_id = ?'; params.push(opts.customer_id); }
  return dbi.prepare(`SELECT * FROM inventory_serial_numbers WHERE ${where} ORDER BY serial_number ASC`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// F115. Inventory transfers
// ════════════════════════════════════════════════════════════════
export function createTransfer(t: { company_id: string; transfer_date: string; from_warehouse_id: string; to_warehouse_id: string; requested_by?: string; items: Array<{ item_id: string; lot_id?: string; quantity: number; unit_cost?: number; notes?: string }>; notes?: string }): any {
  const dbi = db.getDb();
  const id = uuid();
  const transferNumber = `TR-${Date.now().toString().slice(-8)}`;
  dbi.prepare(`INSERT INTO inventory_transfers (id, company_id, transfer_number, transfer_date, from_warehouse_id, to_warehouse_id, status, notes, item_count, requested_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`)
    .run(id, t.company_id, transferNumber, t.transfer_date, t.from_warehouse_id, t.to_warehouse_id, t.notes || null, t.items.length, t.requested_by || null, now(), now());

  const insert = dbi.prepare(`INSERT INTO inventory_transfer_items (id, transfer_id, item_id, lot_id, quantity, unit_cost, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const tx = dbi.transaction(() => {
    for (const it of t.items) {
      insert.run(uuid(), id, it.item_id, it.lot_id || null, it.quantity, it.unit_cost || 0, it.notes || null);
    }
  });
  tx();
  return { id, transfer_number: transferNumber, item_count: t.items.length };
}

export function markTransferShipped(id: string): boolean {
  const r = db.getDb().prepare(`UPDATE inventory_transfers SET status = 'in_transit', shipped_at = ?, updated_at = ? WHERE id = ? AND status = 'draft'`).run(now(), now(), id);
  return r.changes > 0;
}

export function markTransferReceived(id: string): boolean {
  const r = db.getDb().prepare(`UPDATE inventory_transfers SET status = 'received', received_at = ?, updated_at = ? WHERE id = ? AND status = 'in_transit'`).run(now(), now(), id);
  return r.changes > 0;
}

export function listTransfers(companyId: string, opts?: { status?: string; from_warehouse_id?: string; to_warehouse_id?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  if (opts?.from_warehouse_id) { where += ' AND from_warehouse_id = ?'; params.push(opts.from_warehouse_id); }
  if (opts?.to_warehouse_id) { where += ' AND to_warehouse_id = ?'; params.push(opts.to_warehouse_id); }
  return dbi.prepare(`SELECT * FROM inventory_transfers WHERE ${where} ORDER BY transfer_date DESC`).all(...params) as any[];
}

export function getTransferItems(transferId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM inventory_transfer_items WHERE transfer_id = ?`).all(transferId) as any[];
}

// ════════════════════════════════════════════════════════════════
// F116. Inventory adjustments
// ════════════════════════════════════════════════════════════════
export function createAdjustment(a: { company_id: string; adjustment_date: string; warehouse_id?: string; reason?: string; reason_code?: string; created_by?: string; notes?: string; items: Array<{ item_id: string; lot_id?: string; old_quantity: number; new_quantity: number; unit_cost?: number }> }): any {
  const dbi = db.getDb();
  const id = uuid();
  const adjustmentNumber = `ADJ-${Date.now().toString().slice(-8)}`;
  let totalValueChange = 0;
  for (const it of a.items) {
    totalValueChange += (it.new_quantity - it.old_quantity) * (it.unit_cost || 0);
  }
  dbi.prepare(`INSERT INTO inventory_adjustments (id, company_id, adjustment_number, adjustment_date, warehouse_id, reason, reason_code, total_value_change, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, a.company_id, adjustmentNumber, a.adjustment_date, a.warehouse_id || null, a.reason || null, a.reason_code || null, totalValueChange, a.notes || null, now(), a.created_by || null);

  const insert = dbi.prepare(`INSERT INTO inventory_adjustment_items (id, adjustment_id, item_id, lot_id, quantity_change, old_quantity, new_quantity, unit_cost, value_change) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const tx = dbi.transaction(() => {
    for (const it of a.items) {
      const qtyChange = it.new_quantity - it.old_quantity;
      const valueChange = qtyChange * (it.unit_cost || 0);
      insert.run(uuid(), id, it.item_id, it.lot_id || null, qtyChange, it.old_quantity, it.new_quantity, it.unit_cost || 0, valueChange);
    }
  });
  tx();
  return { id, adjustment_number: adjustmentNumber, item_count: a.items.length, total_value_change: totalValueChange };
}

export function listAdjustments(companyId: string, opts?: { from?: string; to?: string; limit?: number }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.from) { where += ' AND adjustment_date >= ?'; params.push(opts.from); }
  if (opts?.to) { where += ' AND adjustment_date <= ?'; params.push(opts.to); }
  return dbi.prepare(`SELECT * FROM inventory_adjustments WHERE ${where} ORDER BY adjustment_date DESC LIMIT ${Math.min(opts?.limit || 100, 1000)}`).all(...params) as any[];
}

export function approveAdjustment(id: string, approvedBy: string): boolean {
  const r = db.getDb().prepare(`UPDATE inventory_adjustments SET approved_by = ?, approved_at = ? WHERE id = ? AND approved_at IS NULL`).run(approvedBy, now(), id);
  return r.changes > 0;
}

// ════════════════════════════════════════════════════════════════
// F117. Stock take sessions
// ════════════════════════════════════════════════════════════════
export function startStockTake(s: { company_id: string; session_name: string; warehouse_id?: string; counted_by?: string }): any {
  const dbi = db.getDb();
  const id = uuid();
  dbi.prepare(`INSERT INTO stock_take_sessions (id, company_id, session_name, warehouse_id, start_date, counted_by, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'in_progress', ?)`)
    .run(id, s.company_id, s.session_name, s.warehouse_id || null, today(), s.counted_by || null, now());
  return { id, status: 'in_progress' };
}

export function recordCount(sessionId: string, count: { item_id: string; location_id?: string; system_quantity: number; counted_quantity: number; notes?: string }): any {
  const id = uuid();
  const variance = count.counted_quantity - count.system_quantity;
  db.getDb().prepare(`INSERT INTO stock_take_counts (id, session_id, item_id, location_id, system_quantity, counted_quantity, variance, notes, counted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, sessionId, count.item_id, count.location_id || null, count.system_quantity, count.counted_quantity, variance, count.notes || null, now());
  // Update session totals
  db.getDb().prepare(`UPDATE stock_take_sessions SET total_items_counted = total_items_counted + 1, variance_count = variance_count + ? WHERE id = ?`)
    .run(Math.abs(variance) > 0.001 ? 1 : 0, sessionId);
  return { id, variance };
}

export function completeStockTake(sessionId: string): { variance_count: number; total_items_counted: number } {
  const dbi = db.getDb();
  dbi.prepare(`UPDATE stock_take_sessions SET status = 'completed', completion_date = ? WHERE id = ?`).run(today(), sessionId);
  return dbi.prepare(`SELECT total_items_counted, variance_count FROM stock_take_sessions WHERE id = ?`).get(sessionId) as any;
}

export function listStockTakes(companyId: string, opts?: { status?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  return dbi.prepare(`SELECT * FROM stock_take_sessions WHERE ${where} ORDER BY start_date DESC`).all(...params) as any[];
}

export function getStockTakeCounts(sessionId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM stock_take_counts WHERE session_id = ?`).all(sessionId) as any[];
}

// ════════════════════════════════════════════════════════════════
// F118. Low stock alerts
// ════════════════════════════════════════════════════════════════
export function scanLowStock(companyId: string): { alerts_created: number; alerts_resolved: number } {
  const dbi = db.getDb();
  // Find items where current quantity <= minimum_stock and minimum_stock > 0
  const lowItems = dbi.prepare(`
    SELECT id, name, COALESCE(quantity, 0) AS qty, COALESCE(minimum_stock, 0) AS min_stock
      FROM inventory_items
     WHERE company_id = ? AND COALESCE(minimum_stock, 0) > 0
       AND COALESCE(quantity, 0) <= COALESCE(minimum_stock, 0)
       AND (deleted_at IS NULL OR deleted_at = '')
  `).all(companyId) as any[];

  let created = 0, resolved = 0;
  const insert = dbi.prepare(`INSERT INTO low_stock_alerts (id, company_id, item_id, threshold_quantity, current_quantity, severity, alerted_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`);
  const existing = dbi.prepare(`SELECT id FROM low_stock_alerts WHERE company_id = ? AND item_id = ? AND status = 'active' LIMIT 1`);
  const tx = dbi.transaction(() => {
    for (const it of lowItems) {
      const has = existing.get(companyId, it.id);
      if (!has) {
        const severity = it.qty <= 0 ? 'critical' : (it.qty < it.min_stock * 0.5 ? 'high' : 'warning');
        insert.run(uuid(), companyId, it.id, it.min_stock, it.qty, severity, now(), now());
        created++;
      }
    }
    // Resolve alerts for items now above threshold
    const r = dbi.prepare(`
      UPDATE low_stock_alerts SET status = 'resolved'
       WHERE company_id = ? AND status = 'active'
         AND item_id IN (
           SELECT id FROM inventory_items
            WHERE company_id = ?
              AND COALESCE(quantity, 0) > COALESCE(minimum_stock, 0)
         )
    `).run(companyId, companyId);
    resolved = r.changes;
  });
  tx();
  return { alerts_created: created, alerts_resolved: resolved };
}

export function listLowStockAlerts(companyId: string, opts?: { status?: string; severity?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  if (opts?.severity) { where += ' AND severity = ?'; params.push(opts.severity); }
  return dbi.prepare(`SELECT * FROM low_stock_alerts WHERE ${where} ORDER BY alerted_at DESC`).all(...params) as any[];
}

export function acknowledgeAlert(id: string, acknowledgedBy: string): boolean {
  const r = db.getDb().prepare(`UPDATE low_stock_alerts SET acknowledged_at = ?, acknowledged_by = ? WHERE id = ?`).run(now(), acknowledgedBy, id);
  return r.changes > 0;
}

// ════════════════════════════════════════════════════════════════
// F119. Valuation methods
// ════════════════════════════════════════════════════════════════
export function setValuationMethod(companyId: string, method: 'fifo' | 'lifo' | 'average' | 'specific'): boolean {
  const r = db.getDb().prepare(`UPDATE companies SET inventory_valuation_method = ? WHERE id = ?`).run(method, companyId);
  return r.changes > 0;
}

export function getValuationMethod(companyId: string): string {
  const r = db.getDb().prepare(`SELECT inventory_valuation_method FROM companies WHERE id = ?`).get(companyId) as any;
  return r?.inventory_valuation_method || 'average';
}

// ════════════════════════════════════════════════════════════════
// F120. Inventory value snapshots
// ════════════════════════════════════════════════════════════════
export function captureInventoryValueSnapshot(companyId: string, snapshotDate?: string): any {
  const dbi = db.getDb();
  const date = snapshotDate || today();
  const method = getValuationMethod(companyId);
  const items = dbi.prepare(`
    SELECT id, name, sku, COALESCE(quantity, 0) AS qty, COALESCE(unit_cost, 0) AS cost
      FROM inventory_items
     WHERE company_id = ? AND (deleted_at IS NULL OR deleted_at = '')
  `).all(companyId) as any[];
  let totalUnits = 0;
  let totalValue = 0;
  const breakdown: any[] = [];
  for (const it of items) {
    const v = it.qty * it.cost;
    totalUnits += it.qty;
    totalValue += v;
    breakdown.push({ id: it.id, sku: it.sku, name: it.name, qty: it.qty, unit_cost: it.cost, value: v });
  }
  const id = uuid();
  dbi.prepare(`INSERT INTO inventory_value_history (id, company_id, snapshot_date, method, total_units, total_value, by_item_breakdown, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(company_id, snapshot_date) DO UPDATE SET total_units = excluded.total_units, total_value = excluded.total_value, by_item_breakdown = excluded.by_item_breakdown`)
    .run(id, companyId, date, method, totalUnits, totalValue, JSON.stringify(breakdown), now());
  return { id, snapshot_date: date, total_units: totalUnits, total_value: totalValue, method };
}

export function listInventoryValueHistory(companyId: string, limit: number = 90): any[] {
  return db.getDb().prepare(`SELECT id, company_id, snapshot_date, method, total_units, total_value, created_at FROM inventory_value_history WHERE company_id = ? ORDER BY snapshot_date DESC LIMIT ?`).all(companyId, Math.min(limit, 365)) as any[];
}

// ════════════════════════════════════════════════════════════════
// F121. Project tasks
// ════════════════════════════════════════════════════════════════
export function upsertTask(t: any): any {
  const dbi = db.getDb();
  const id = t.id || uuid();
  if (t.id) {
    dbi.prepare(`UPDATE project_tasks SET parent_task_id = ?, task_name = ?, description = ?, status = ?, priority = ?, assigned_to = ?, start_date = ?, due_date = ?, completed_at = ?, estimated_hours = ?, actual_hours = ?, sort_order = ?, updated_at = ? WHERE id = ?`)
      .run(t.parent_task_id || null, t.task_name, t.description || null, t.status || 'todo', t.priority || 'medium', t.assigned_to || null, t.start_date || null, t.due_date || null, t.completed_at || null, t.estimated_hours || 0, t.actual_hours || 0, t.sort_order || 0, now(), t.id);
  } else {
    dbi.prepare(`INSERT INTO project_tasks (id, company_id, project_id, parent_task_id, task_name, description, status, priority, assigned_to, start_date, due_date, completed_at, estimated_hours, actual_hours, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, t.company_id, t.project_id, t.parent_task_id || null, t.task_name, t.description || null, t.status || 'todo', t.priority || 'medium', t.assigned_to || null, t.start_date || null, t.due_date || null, t.completed_at || null, t.estimated_hours || 0, t.actual_hours || 0, t.sort_order || 0, now(), now());
  }
  return { id, ...t };
}

export function listTasks(projectId: string, opts?: { status?: string; assigned_to?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [projectId];
  let where = 'project_id = ?';
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  if (opts?.assigned_to) { where += ' AND assigned_to = ?'; params.push(opts.assigned_to); }
  return dbi.prepare(`SELECT * FROM project_tasks WHERE ${where} ORDER BY sort_order ASC, due_date ASC`).all(...params) as any[];
}

export function completeTask(id: string): boolean {
  const r = db.getDb().prepare(`UPDATE project_tasks SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?`).run(now(), now(), id);
  return r.changes > 0;
}

// ════════════════════════════════════════════════════════════════
// F122. Project milestones
// ════════════════════════════════════════════════════════════════
export function upsertMilestone(m: any): any {
  const dbi = db.getDb();
  const id = m.id || uuid();
  if (m.id) {
    dbi.prepare(`UPDATE project_milestones SET milestone_name = ?, target_date = ?, achieved_date = ?, status = ?, deliverables = ?, payment_amount = ?, invoiced = ?, invoice_id = ?, notes = ?, updated_at = ? WHERE id = ?`)
      .run(m.milestone_name, m.target_date || null, m.achieved_date || null, m.status || 'pending', m.deliverables || null, m.payment_amount || 0, m.invoiced ? 1 : 0, m.invoice_id || null, m.notes || null, now(), m.id);
  } else {
    dbi.prepare(`INSERT INTO project_milestones (id, company_id, project_id, milestone_name, target_date, status, deliverables, payment_amount, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, m.company_id, m.project_id, m.milestone_name, m.target_date || null, m.status || 'pending', m.deliverables || null, m.payment_amount || 0, m.notes || null, now(), now());
  }
  return { id, ...m };
}

export function listMilestones(projectId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM project_milestones WHERE project_id = ? ORDER BY target_date ASC`).all(projectId) as any[];
}

// ════════════════════════════════════════════════════════════════
// F123. Project resources
// ════════════════════════════════════════════════════════════════
export function upsertResource(r: any): any {
  const dbi = db.getDb();
  const id = r.id || uuid();
  if (r.id) {
    dbi.prepare(`UPDATE project_resources SET resource_type = ?, employee_id = ?, role = ?, allocation_percent = ?, start_date = ?, end_date = ?, hourly_rate = ?, notes = ?, updated_at = ? WHERE id = ?`)
      .run(r.resource_type || 'employee', r.employee_id || null, r.role || null, r.allocation_percent || 100, r.start_date || null, r.end_date || null, r.hourly_rate || 0, r.notes || null, now(), r.id);
  } else {
    dbi.prepare(`INSERT INTO project_resources (id, company_id, project_id, resource_type, employee_id, role, allocation_percent, start_date, end_date, hourly_rate, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, r.company_id, r.project_id, r.resource_type || 'employee', r.employee_id || null, r.role || null, r.allocation_percent || 100, r.start_date || null, r.end_date || null, r.hourly_rate || 0, r.notes || null, now(), now());
  }
  return { id, ...r };
}

export function listResources(projectId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM project_resources WHERE project_id = ?`).all(projectId) as any[];
}

// ════════════════════════════════════════════════════════════════
// F124. Project budgets
// ════════════════════════════════════════════════════════════════
export function upsertProjectBudget(b: any): any {
  const dbi = db.getDb();
  const id = b.id || uuid();
  if (b.id) {
    dbi.prepare(`UPDATE project_budgets SET category = ?, budgeted_amount = ?, actual_amount = ?, committed_amount = ?, notes = ?, updated_at = ? WHERE id = ?`)
      .run(b.category, b.budgeted_amount || 0, b.actual_amount || 0, b.committed_amount || 0, b.notes || null, now(), b.id);
  } else {
    dbi.prepare(`INSERT INTO project_budgets (id, company_id, project_id, category, budgeted_amount, actual_amount, committed_amount, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, b.company_id, b.project_id, b.category, b.budgeted_amount || 0, b.actual_amount || 0, b.committed_amount || 0, b.notes || null, now(), now());
  }
  return { id, ...b };
}

export function listProjectBudgets(projectId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM project_budgets WHERE project_id = ? ORDER BY category ASC`).all(projectId) as any[];
}

// ════════════════════════════════════════════════════════════════
// F125. Project risks
// ════════════════════════════════════════════════════════════════
export function upsertRisk(r: any): any {
  const dbi = db.getDb();
  const id = r.id || uuid();
  if (r.id) {
    dbi.prepare(`UPDATE project_risks SET risk_description = ?, likelihood = ?, impact = ?, mitigation_plan = ?, owner = ?, status = ?, identified_date = ?, closed_date = ?, updated_at = ? WHERE id = ?`)
      .run(r.risk_description, r.likelihood || 'medium', r.impact || 'medium', r.mitigation_plan || null, r.owner || null, r.status || 'open', r.identified_date || null, r.closed_date || null, now(), r.id);
  } else {
    dbi.prepare(`INSERT INTO project_risks (id, company_id, project_id, risk_description, likelihood, impact, mitigation_plan, owner, status, identified_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, r.company_id, r.project_id, r.risk_description, r.likelihood || 'medium', r.impact || 'medium', r.mitigation_plan || null, r.owner || null, r.status || 'open', r.identified_date || today(), now(), now());
  }
  return { id, ...r };
}

export function listRisks(projectId: string, openOnly: boolean = false): any[] {
  const dbi = db.getDb();
  let where = 'project_id = ?';
  if (openOnly) where += ` AND status = 'open'`;
  return dbi.prepare(`SELECT * FROM project_risks WHERE ${where}`).all(projectId) as any[];
}

// ════════════════════════════════════════════════════════════════
// F126. Project change orders
// ════════════════════════════════════════════════════════════════
export function upsertChangeOrder(co: any): any {
  const dbi = db.getDb();
  const id = co.id || uuid();
  const coNumber = co.co_number || `CO-${Date.now().toString().slice(-6)}`;
  if (co.id) {
    dbi.prepare(`UPDATE project_change_orders SET description = ?, cost_change = ?, schedule_change_days = ?, requested_by = ?, approved_by = ?, approved_at = ?, status = ?, notes = ?, updated_at = ? WHERE id = ?`)
      .run(co.description, co.cost_change || 0, co.schedule_change_days || 0, co.requested_by || null, co.approved_by || null, co.approved_at || null, co.status || 'pending', co.notes || null, now(), co.id);
  } else {
    dbi.prepare(`INSERT INTO project_change_orders (id, company_id, project_id, co_number, description, cost_change, schedule_change_days, requested_by, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, co.company_id, co.project_id, coNumber, co.description, co.cost_change || 0, co.schedule_change_days || 0, co.requested_by || null, co.status || 'pending', co.notes || null, now(), now());
  }
  return { id, co_number: coNumber, ...co };
}

export function approveChangeOrder(id: string, approvedBy: string): boolean {
  const r = db.getDb().prepare(`UPDATE project_change_orders SET status = 'approved', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'`).run(approvedBy, now(), now(), id);
  return r.changes > 0;
}

export function listChangeOrders(projectId: string, opts?: { status?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [projectId];
  let where = 'project_id = ?';
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  return dbi.prepare(`SELECT * FROM project_change_orders WHERE ${where} ORDER BY created_at DESC`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// F127. Timesheet periods
// ════════════════════════════════════════════════════════════════
export function openTimesheetPeriod(p: { company_id: string; employee_id: string; period_start: string; period_end: string }): any {
  const dbi = db.getDb();
  const id = uuid();
  try {
    dbi.prepare(`INSERT INTO timesheet_periods (id, company_id, employee_id, period_start, period_end, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)`)
      .run(id, p.company_id, p.employee_id, p.period_start, p.period_end, now());
    return { id, ...p, status: 'open' };
  } catch (e: any) {
    // Already exists — return existing
    const existing = dbi.prepare(`SELECT * FROM timesheet_periods WHERE company_id = ? AND employee_id = ? AND period_start = ?`).get(p.company_id, p.employee_id, p.period_start);
    return existing;
  }
}

export function submitTimesheet(periodId: string): { total_hours: number; billable_hours: number } {
  const dbi = db.getDb();
  // Roll up time entries
  const totals = dbi.prepare(`
    SELECT
      COALESCE(SUM(duration_minutes / 60.0), 0) AS total_hours,
      COALESCE(SUM(CASE WHEN is_billable = 1 THEN duration_minutes / 60.0 ELSE 0 END), 0) AS billable_hours,
      COALESCE(SUM(CASE WHEN duration_minutes / 60.0 > 8 THEN duration_minutes / 60.0 - 8 ELSE 0 END), 0) AS overtime_hours
      FROM time_entries
     WHERE employee_id = (SELECT employee_id FROM timesheet_periods WHERE id = ?)
       AND date BETWEEN (SELECT period_start FROM timesheet_periods WHERE id = ?)
                    AND (SELECT period_end FROM timesheet_periods WHERE id = ?)
  `).get(periodId, periodId, periodId) as any;

  dbi.prepare(`UPDATE timesheet_periods SET total_hours = ?, billable_hours = ?, overtime_hours = ?, status = 'submitted', submitted_at = ? WHERE id = ?`)
    .run(totals.total_hours, totals.billable_hours, totals.overtime_hours, now(), periodId);
  return { total_hours: totals.total_hours, billable_hours: totals.billable_hours };
}

export function listTimesheetPeriods(companyId: string, opts?: { employee_id?: string; status?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.employee_id) { where += ' AND employee_id = ?'; params.push(opts.employee_id); }
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  return dbi.prepare(`SELECT * FROM timesheet_periods WHERE ${where} ORDER BY period_start DESC`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// F128. Timesheet approvals
// ════════════════════════════════════════════════════════════════
export function approveTimesheet(periodId: string, approverId: string, action: 'approve' | 'reject', comment?: string): { status: string } {
  const dbi = db.getDb();
  const id = uuid();
  dbi.prepare(`INSERT INTO timesheet_approvals (id, period_id, step_number, approver_id, action, acted_at, comment, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?)`)
    .run(id, periodId, approverId, action, now(), comment || null, now());
  const status = action === 'approve' ? 'approved' : 'rejected';
  dbi.prepare(`UPDATE timesheet_periods SET status = ? WHERE id = ?`).run(status, periodId);
  return { status };
}

export function getTimesheetApprovals(periodId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM timesheet_approvals WHERE period_id = ? ORDER BY step_number, acted_at`).all(periodId) as any[];
}

// ════════════════════════════════════════════════════════════════
// F129. Billable time summary
// ════════════════════════════════════════════════════════════════
export function rebuildBillableTimeSummary(companyId: string, periodStart: string, periodEnd: string): any[] {
  const dbi = db.getDb();
  // Clear existing summaries for this period
  dbi.prepare(`DELETE FROM billable_time_summary WHERE company_id = ? AND period_start = ? AND period_end = ?`).run(companyId, periodStart, periodEnd);

  const rollups = dbi.prepare(`
    SELECT
      te.project_id,
      te.employee_id,
      p.client_id,
      SUM(CASE WHEN te.is_billable = 1 THEN te.duration_minutes / 60.0 ELSE 0 END) AS billable_hours,
      SUM(CASE WHEN te.is_billable = 0 OR te.is_billable IS NULL THEN te.duration_minutes / 60.0 ELSE 0 END) AS non_billable_hours,
      SUM(CASE WHEN te.is_billable = 1 THEN te.duration_minutes / 60.0 * COALESCE(te.hourly_rate, 0) ELSE 0 END) AS billable_amount
      FROM time_entries te
      LEFT JOIN projects p ON p.id = te.project_id
     WHERE te.company_id = ?
       AND te.date BETWEEN ? AND ?
     GROUP BY te.project_id, te.employee_id, p.client_id
  `).all(companyId, periodStart, periodEnd) as any[];

  const insert = dbi.prepare(`INSERT INTO billable_time_summary (id, company_id, summary_date, project_id, client_id, employee_id, period_start, period_end, billable_hours, non_billable_hours, billable_amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const tx = dbi.transaction(() => {
    for (const r of rollups) {
      insert.run(uuid(), companyId, today(), r.project_id, r.client_id, r.employee_id, periodStart, periodEnd, r.billable_hours || 0, r.non_billable_hours || 0, r.billable_amount || 0, now());
    }
  });
  tx();
  return rollups;
}

export function getBillableTimeSummary(companyId: string, opts?: { project_id?: string; client_id?: string; period_start?: string; period_end?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.project_id) { where += ' AND project_id = ?'; params.push(opts.project_id); }
  if (opts?.client_id) { where += ' AND client_id = ?'; params.push(opts.client_id); }
  if (opts?.period_start) { where += ' AND period_start >= ?'; params.push(opts.period_start); }
  if (opts?.period_end) { where += ' AND period_end <= ?'; params.push(opts.period_end); }
  return dbi.prepare(`SELECT * FROM billable_time_summary WHERE ${where} ORDER BY period_start DESC`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// F130. Project profitability
// ════════════════════════════════════════════════════════════════
export function captureProjectProfitability(companyId: string, projectId: string, snapshotDate?: string): any {
  const dbi = db.getDb();
  const date = snapshotDate || today();

  // Revenue: sum of invoices linked to project
  const revenueRow = dbi.prepare(`
    SELECT COALESCE(SUM(total), 0) AS total_revenue
      FROM invoices
     WHERE company_id = ? AND project_id = ?
       AND status NOT IN ('void','cancelled')
       AND (deleted_at IS NULL OR deleted_at = '')
  `).get(companyId, projectId) as any;
  const totalRevenue = revenueRow.total_revenue || 0;

  // Labor costs: time_entries * hourly_rate
  const laborRow = dbi.prepare(`
    SELECT COALESCE(SUM(duration_minutes / 60.0 * COALESCE(hourly_rate, 0)), 0) AS labor_costs
      FROM time_entries
     WHERE company_id = ? AND project_id = ?
  `).get(companyId, projectId) as any;
  const laborCosts = laborRow.labor_costs || 0;

  // Material/other costs: expenses + bills linked to project
  const expenseRow = dbi.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
      FROM expenses
     WHERE company_id = ? AND project_id = ?
       AND (deleted_at IS NULL OR deleted_at = '')
  `).get(companyId, projectId) as any;
  const materialCosts = expenseRow.total || 0;

  const totalCosts = laborCosts + materialCosts;
  const grossProfit = totalRevenue - totalCosts;
  const marginPercent = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

  // Budget variance
  const budgetRow = dbi.prepare(`SELECT COALESCE(SUM(budgeted_amount), 0) AS total_budget FROM project_budgets WHERE project_id = ?`).get(projectId) as any;
  const budgetVariance = totalCosts - (budgetRow.total_budget || 0);

  const id = uuid();
  dbi.prepare(`INSERT INTO project_profitability (id, company_id, project_id, snapshot_date, total_revenue, total_costs, labor_costs, material_costs, gross_profit, margin_percent, budget_variance, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(company_id, project_id, snapshot_date) DO UPDATE SET total_revenue = excluded.total_revenue, total_costs = excluded.total_costs, labor_costs = excluded.labor_costs, material_costs = excluded.material_costs, gross_profit = excluded.gross_profit, margin_percent = excluded.margin_percent, budget_variance = excluded.budget_variance`)
    .run(id, companyId, projectId, date, totalRevenue, totalCosts, laborCosts, materialCosts, grossProfit, marginPercent, budgetVariance, now());

  return { id, project_id: projectId, snapshot_date: date, total_revenue: totalRevenue, total_costs: totalCosts, labor_costs: laborCosts, material_costs: materialCosts, gross_profit: grossProfit, margin_percent: marginPercent, budget_variance: budgetVariance };
}

export function listProfitabilitySnapshots(companyId: string, opts?: { project_id?: string; limit?: number }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.project_id) { where += ' AND project_id = ?'; params.push(opts.project_id); }
  return dbi.prepare(`SELECT * FROM project_profitability WHERE ${where} ORDER BY snapshot_date DESC LIMIT ${Math.min(opts?.limit || 90, 365)}`).all(...params) as any[];
}
