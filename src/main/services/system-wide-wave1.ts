// ─── System-Wide Wave 1: 50 features (SW1–SW50) ──────────
// Clients, Projects, Inventory, Bills/AP, Bank Recon

import { randomUUID as uuid } from 'crypto';
import * as db from '../database';
const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);
const round2 = (n: number) => Math.round((n || 0) * 100) / 100;

// ═══ SW1–SW10: Client Analytics & Management ═════════════
export function clientDashboard(cid: string) {
  const dbi = db.getDb();
  const active = (dbi.prepare(`SELECT COUNT(*) c FROM clients WHERE company_id = ? AND (deleted_at IS NULL)`).get(cid) as any)?.c || 0;
  const totalRevenue = (dbi.prepare(`SELECT COALESCE(SUM(amount_paid),0) t FROM invoices WHERE company_id = ?`).get(cid) as any)?.t || 0;
  const outstandingAR = (dbi.prepare(`SELECT COALESCE(SUM(total - COALESCE(amount_paid,0)),0) t FROM invoices WHERE company_id = ? AND status IN ('sent','partial','overdue')`).get(cid) as any)?.t || 0;
  const newThisMonth = (dbi.prepare(`SELECT COUNT(*) c FROM clients WHERE company_id = ? AND substr(created_at,1,7) = substr(date('now'),1,7)`).get(cid) as any)?.c || 0;
  return { activeClients: active, totalRevenue: round2(totalRevenue), outstandingAR: round2(outstandingAR), newClientsThisMonth: newThisMonth };
}
export function clientRevenueRanking(cid: string, limit = 20) {
  return db.getDb().prepare(`SELECT c.id, c.name, c.email, COUNT(i.id) AS invoice_count, ROUND(SUM(i.total),2) AS total_invoiced, ROUND(SUM(i.amount_paid),2) AS total_paid, ROUND(SUM(i.total - COALESCE(i.amount_paid,0)),2) AS outstanding FROM clients c LEFT JOIN invoices i ON i.client_id = c.id WHERE c.company_id = ? GROUP BY c.id ORDER BY total_invoiced DESC LIMIT ?`).all(cid, limit);
}
export function clientRetentionRate(cid: string) {
  const dbi = db.getDb();
  const total = (dbi.prepare(`SELECT COUNT(*) c FROM clients WHERE company_id = ?`).get(cid) as any)?.c || 0;
  const active = (dbi.prepare(`SELECT COUNT(DISTINCT client_id) c FROM invoices WHERE company_id = ? AND issue_date >= date('now','-12 months')`).get(cid) as any)?.c || 0;
  return { totalClients: total, activeInLast12Months: active, retentionRate: total > 0 ? round2((active / total) * 100) : 0 };
}
export function clientAcquisitionByMonth(cid: string, months = 12) {
  return db.getDb().prepare(`SELECT substr(created_at,1,7) AS month, COUNT(*) AS new_clients FROM clients WHERE company_id = ? AND created_at >= date('now', '-' || ? || ' months') GROUP BY month ORDER BY month`).all(cid, months);
}
export function clientsByType(cid: string) {
  return db.getDb().prepare(`SELECT COALESCE(NULLIF(type,''),'company') AS client_type, COUNT(*) AS count FROM clients WHERE company_id = ? AND (deleted_at IS NULL) GROUP BY client_type`).all(cid);
}
export function clientContactsList(cid: string) {
  return db.getDb().prepare(`SELECT cc.*, c.name AS client_name FROM client_contacts cc JOIN clients c ON c.id = cc.client_id WHERE c.company_id = ? ORDER BY c.name, cc.is_primary DESC`).all(cid);
}
export function clientsWithoutInvoices(cid: string) {
  return db.getDb().prepare(`SELECT c.id, c.name, c.email, c.created_at FROM clients c LEFT JOIN invoices i ON i.client_id = c.id WHERE c.company_id = ? AND i.id IS NULL AND c.deleted_at IS NULL ORDER BY c.created_at DESC`).all(cid);
}
export function clientGeography(cid: string) {
  return db.getDb().prepare(`SELECT COALESCE(NULLIF(state,''),'Unknown') AS state, COUNT(*) AS count FROM clients WHERE company_id = ? AND deleted_at IS NULL GROUP BY state ORDER BY count DESC`).all(cid);
}
export function topClientsByExpenses(cid: string) {
  return db.getDb().prepare(`SELECT c.id, c.name, COUNT(e.id) AS expense_count, ROUND(SUM(e.amount),2) AS total_expenses FROM expenses e JOIN clients c ON c.id = e.client_id WHERE e.company_id = ? AND e.deleted_at IS NULL GROUP BY c.id ORDER BY total_expenses DESC LIMIT 15`).all(cid);
}
export function clientCommunicationLog(cid: string, clientId: string) {
  return db.getDb().prepare(`SELECT * FROM email_log WHERE company_id = ? AND (recipient LIKE ? OR entity_id = ?) ORDER BY sent_at DESC LIMIT 20`).all(cid, `%${clientId}%`, clientId);
}

// ═══ SW11–SW20: Project Management ═══════════════════════
export function projectDashboard(cid: string) {
  const dbi = db.getDb();
  const active = (dbi.prepare(`SELECT COUNT(*) c FROM projects WHERE company_id = ? AND status = 'active'`).get(cid) as any)?.c || 0;
  const totalBudget = (dbi.prepare(`SELECT COALESCE(SUM(budget),0) t FROM projects WHERE company_id = ? AND status = 'active'`).get(cid) as any)?.t || 0;
  const totalSpent = (dbi.prepare(`SELECT COALESCE(SUM(e.amount),0) t FROM expenses e JOIN projects p ON p.id = e.project_id WHERE p.company_id = ? AND p.status = 'active' AND e.deleted_at IS NULL`).get(cid) as any)?.t || 0;
  const overBudget = (dbi.prepare(`SELECT COUNT(*) c FROM projects p WHERE p.company_id = ? AND p.status = 'active' AND p.budget > 0 AND (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE project_id = p.id AND deleted_at IS NULL) > p.budget`).get(cid) as any)?.c || 0;
  return { activeProjects: active, totalBudget: round2(totalBudget), totalSpent: round2(totalSpent), overBudgetCount: overBudget, utilizationPct: totalBudget > 0 ? round2((totalSpent / totalBudget) * 100) : 0 };
}
export function projectProfitability(cid: string) {
  return db.getDb().prepare(`SELECT p.id, p.name, p.budget, p.status, COALESCE((SELECT SUM(amount) FROM expenses WHERE project_id = p.id AND deleted_at IS NULL),0) AS expenses, COALESCE((SELECT SUM(i.total) FROM invoices i WHERE i.custom_fields LIKE '%' || p.id || '%'),0) AS revenue FROM projects p WHERE p.company_id = ? ORDER BY revenue DESC`).all(cid);
}
export function projectTimeTracking(cid: string, projectId: string) {
  return db.getDb().prepare(`SELECT te.*, e.name AS employee_name FROM time_entries te LEFT JOIN employees e ON e.id = te.employee_id WHERE te.project_id = ? AND te.company_id = ? ORDER BY te.date DESC LIMIT 50`).all(projectId, cid);
}
export function projectTimeSummary(cid: string) {
  return db.getDb().prepare(`SELECT p.id, p.name, COALESCE(SUM(te.hours),0) AS total_hours, COUNT(DISTINCT te.employee_id) AS team_size FROM projects p LEFT JOIN time_entries te ON te.project_id = p.id WHERE p.company_id = ? AND p.status = 'active' GROUP BY p.id ORDER BY total_hours DESC`).all(cid);
}
export function projectBudgetBurnRate(cid: string) {
  return db.getDb().prepare(`SELECT p.id, p.name, p.budget, COALESCE((SELECT SUM(amount) FROM expenses WHERE project_id = p.id AND deleted_at IS NULL),0) AS spent, ROUND(COALESCE((SELECT SUM(amount) FROM expenses WHERE project_id = p.id AND deleted_at IS NULL),0) / NULLIF(p.budget, 0) * 100, 1) AS burn_pct FROM projects p WHERE p.company_id = ? AND p.budget > 0 ORDER BY burn_pct DESC`).all(cid);
}
export function projectsByClient(cid: string) {
  return db.getDb().prepare(`SELECT c.name AS client_name, COUNT(p.id) AS project_count, SUM(CASE WHEN p.status = 'active' THEN 1 ELSE 0 END) AS active FROM projects p LEFT JOIN clients c ON c.id = p.client_id WHERE p.company_id = ? GROUP BY c.id ORDER BY project_count DESC`).all(cid);
}
export function projectMilestones(cid: string, projectId: string) {
  try { return db.getDb().prepare(`SELECT * FROM project_milestones WHERE project_id = ? ORDER BY due_date`).all(projectId); } catch { return []; }
}
export function overBudgetProjects(cid: string) {
  return db.getDb().prepare(`SELECT p.id, p.name, p.budget, COALESCE((SELECT SUM(amount) FROM expenses WHERE project_id = p.id AND deleted_at IS NULL),0) AS spent FROM projects p WHERE p.company_id = ? AND p.budget > 0 AND (SELECT COALESCE(SUM(amount),0) FROM expenses WHERE project_id = p.id AND deleted_at IS NULL) > p.budget ORDER BY spent DESC`).all(cid);
}
export function projectStatusBreakdown(cid: string) {
  return db.getDb().prepare(`SELECT status, COUNT(*) AS count FROM projects WHERE company_id = ? GROUP BY status ORDER BY count DESC`).all(cid);
}
export function recentProjectActivity(cid: string) {
  return db.getDb().prepare(`SELECT al.* FROM audit_log al WHERE al.company_id = ? AND al.entity_type = 'projects' ORDER BY al.created_at DESC LIMIT 20`).all(cid);
}

// ═══ SW21–SW30: Inventory Management ═════════════════════
export function inventoryDashboard(cid: string) {
  const dbi = db.getDb();
  const totalItems = (dbi.prepare(`SELECT COUNT(*) c FROM inventory_items WHERE company_id = ?`).get(cid) as any)?.c || 0;
  const totalValue = (dbi.prepare(`SELECT COALESCE(SUM(quantity * unit_cost),0) t FROM inventory_items WHERE company_id = ?`).get(cid) as any)?.t || 0;
  const lowStock = (dbi.prepare(`SELECT COUNT(*) c FROM inventory_items WHERE company_id = ? AND quantity <= reorder_point AND reorder_point > 0`).get(cid) as any)?.c || 0;
  const outOfStock = (dbi.prepare(`SELECT COUNT(*) c FROM inventory_items WHERE company_id = ? AND quantity <= 0`).get(cid) as any)?.c || 0;
  return { totalItems, totalValue: round2(totalValue), lowStockCount: lowStock, outOfStockCount: outOfStock };
}
export function lowStockItems(cid: string) {
  return db.getDb().prepare(`SELECT id, name, sku, quantity, reorder_point, unit_cost FROM inventory_items WHERE company_id = ? AND quantity <= reorder_point AND reorder_point > 0 ORDER BY quantity`).all(cid);
}
export function inventoryValuation(cid: string) {
  return db.getDb().prepare(`SELECT id, name, sku, quantity, unit_cost, ROUND(quantity * unit_cost, 2) AS total_value FROM inventory_items WHERE company_id = ? AND quantity > 0 ORDER BY total_value DESC`).all(cid);
}
export function inventoryMovementHistory(cid: string, itemId: string) {
  return db.getDb().prepare(`SELECT * FROM inventory_movements WHERE item_id = ? ORDER BY date DESC LIMIT 50`).all(itemId);
}
export function inventoryTurnoverRate(cid: string) {
  const dbi = db.getDb();
  const cogs = (dbi.prepare(`SELECT COALESCE(SUM(amount),0) t FROM expenses e JOIN categories c ON c.id = e.category_id WHERE e.company_id = ? AND lower(c.name) LIKE '%cost of goods%' AND e.date >= date('now','-12 months') AND e.deleted_at IS NULL`).get(cid) as any)?.t || 0;
  const avgInventory = (dbi.prepare(`SELECT COALESCE(SUM(quantity * unit_cost),0) / 2 t FROM inventory_items WHERE company_id = ?`).get(cid) as any)?.t || 1;
  return { cogs: round2(cogs), avgInventory: round2(avgInventory), turnoverRate: round2(cogs / avgInventory) };
}
export function inventoryByCategory(cid: string) {
  return db.getDb().prepare(`SELECT COALESCE(NULLIF(category,''),'Uncategorized') AS category, COUNT(*) AS item_count, ROUND(SUM(quantity * unit_cost),2) AS total_value FROM inventory_items WHERE company_id = ? GROUP BY category ORDER BY total_value DESC`).all(cid);
}
export function reorderSuggestions(cid: string) {
  return db.getDb().prepare(`SELECT id, name, sku, quantity, reorder_point, reorder_quantity, unit_cost, ROUND(reorder_quantity * unit_cost, 2) AS reorder_cost FROM inventory_items WHERE company_id = ? AND quantity <= reorder_point AND reorder_point > 0 AND reorder_quantity > 0 ORDER BY quantity`).all(cid);
}
export function inventoryAging(cid: string) {
  return db.getDb().prepare(`SELECT id, name, quantity, unit_cost, ROUND(quantity * unit_cost, 2) AS value, CAST(julianday('now') - julianday(COALESCE(last_received_date, created_at)) AS INTEGER) AS days_since_receipt FROM inventory_items WHERE company_id = ? AND quantity > 0 ORDER BY days_since_receipt DESC LIMIT 30`).all(cid);
}
export function inventorySearch(cid: string, query: string) {
  const q = `%${query.toLowerCase()}%`;
  return db.getDb().prepare(`SELECT * FROM inventory_items WHERE company_id = ? AND (lower(name) LIKE ? OR lower(sku) LIKE ? OR lower(description) LIKE ?) LIMIT 30`).all(cid, q, q, q);
}
export function inventoryValueTrend(cid: string) {
  try { return db.getDb().prepare(`SELECT date, SUM(quantity_change * unit_cost) AS value_change FROM inventory_movements im JOIN inventory_items ii ON ii.id = im.item_id WHERE ii.company_id = ? AND im.date >= date('now','-6 months') GROUP BY date ORDER BY date`).all(cid); } catch { return []; }
}

// ═══ SW31–SW40: Bills / Accounts Payable ═════════════════
export function billsDashboard(cid: string) {
  const dbi = db.getDb();
  const outstanding = dbi.prepare(`SELECT COUNT(*) c, COALESCE(SUM(total - COALESCE(amount_paid,0)),0) t FROM bills WHERE company_id = ? AND status IN ('pending','received','approved','partial')`).get(cid) as any;
  const overdue = dbi.prepare(`SELECT COUNT(*) c, COALESCE(SUM(total - COALESCE(amount_paid,0)),0) t FROM bills WHERE company_id = ? AND status IN ('pending','received','approved','partial') AND due_date < date('now')`).get(cid) as any;
  const paidThisMonth = dbi.prepare(`SELECT COUNT(*) c, COALESCE(SUM(amount_paid),0) t FROM bills WHERE company_id = ? AND status = 'paid' AND substr(due_date,1,7) = substr(date('now'),1,7)`).get(cid) as any;
  return { outstandingCount: outstanding?.c || 0, outstandingTotal: round2(outstanding?.t || 0), overdueCount: overdue?.c || 0, overdueTotal: round2(overdue?.t || 0), paidThisMonth: paidThisMonth?.c || 0, paidThisMonthTotal: round2(paidThisMonth?.t || 0) };
}
export function billsByVendor(cid: string) {
  return db.getDb().prepare(`SELECT v.id, v.name, COUNT(b.id) AS bill_count, ROUND(SUM(b.total),2) AS total, ROUND(SUM(b.total - COALESCE(b.amount_paid,0)),2) AS outstanding FROM bills b LEFT JOIN vendors v ON v.id = b.vendor_id WHERE b.company_id = ? GROUP BY v.id ORDER BY total DESC`).all(cid);
}
export function billsAging(cid: string) {
  const dbi = db.getDb();
  const buckets = [{ label: 'Current', min: -9999, max: 0 }, { label: '1-30', min: 1, max: 30 }, { label: '31-60', min: 31, max: 60 }, { label: '61-90', min: 61, max: 90 }, { label: '90+', min: 91, max: 9999 }];
  return buckets.map(b => {
    const r = dbi.prepare(`SELECT COUNT(*) c, COALESCE(SUM(total - COALESCE(amount_paid,0)),0) t FROM bills WHERE company_id = ? AND status IN ('pending','received','approved','partial') AND CAST(julianday('now') - julianday(due_date) AS INTEGER) >= ? AND CAST(julianday('now') - julianday(due_date) AS INTEGER) < ?`).get(cid, b.min, b.max + 1) as any;
    return { ...b, count: r?.c || 0, total: round2(r?.t || 0) };
  });
}
export function upcomingBillsDue(cid: string, days = 14) {
  return db.getDb().prepare(`SELECT b.*, v.name AS vendor_name FROM bills b LEFT JOIN vendors v ON v.id = b.vendor_id WHERE b.company_id = ? AND b.status IN ('pending','received','approved') AND b.due_date >= date('now') AND b.due_date <= date('now', '+' || ? || ' days') ORDER BY b.due_date`).all(cid, days);
}
export function billPaymentHistory(cid: string, billId: string) {
  return db.getDb().prepare(`SELECT * FROM bill_payments WHERE bill_id = ? ORDER BY date DESC`).all(billId);
}
export function cashOutflowForecast(cid: string, weeks = 8) {
  const results: any[] = [];
  for (let i = 0; i < weeks; i++) {
    const d = new Date(); d.setDate(d.getDate() + i * 7);
    const weekStart = d.toISOString().slice(0, 10);
    d.setDate(d.getDate() + 6);
    const weekEnd = d.toISOString().slice(0, 10);
    const r = db.getDb().prepare(`SELECT COALESCE(SUM(total - COALESCE(amount_paid,0)),0) t FROM bills WHERE company_id = ? AND due_date >= ? AND due_date <= ? AND status IN ('pending','received','approved','partial')`).get(cid, weekStart, weekEnd) as any;
    results.push({ week: i + 1, start: weekStart, end: weekEnd, amount: round2(r?.t || 0) });
  }
  return results;
}
export function billsMonthlyTrend(cid: string) {
  return db.getDb().prepare(`SELECT substr(due_date,1,7) AS month, COUNT(*) AS count, ROUND(SUM(total),2) AS total FROM bills WHERE company_id = ? AND due_date >= date('now','-12 months') GROUP BY month ORDER BY month`).all(cid);
}
export function recurringBills(cid: string) {
  return db.getDb().prepare(`SELECT b.*, v.name AS vendor_name FROM bills b LEFT JOIN vendors v ON v.id = b.vendor_id WHERE b.company_id = ? AND b.is_recurring = 1 ORDER BY b.due_date`).all(cid);
}
export function billsSearch(cid: string, query: string) {
  const q = `%${query.toLowerCase()}%`;
  return db.getDb().prepare(`SELECT b.*, v.name AS vendor_name FROM bills b LEFT JOIN vendors v ON v.id = b.vendor_id WHERE b.company_id = ? AND (lower(b.bill_number) LIKE ? OR lower(b.description) LIKE ? OR lower(v.name) LIKE ?) ORDER BY b.due_date DESC LIMIT 30`).all(cid, q, q, q);
}
export function apVsArSummary(cid: string) {
  const dbi = db.getDb();
  const ap = (dbi.prepare(`SELECT COALESCE(SUM(total - COALESCE(amount_paid,0)),0) t FROM bills WHERE company_id = ? AND status IN ('pending','received','approved','partial')`).get(cid) as any)?.t || 0;
  const ar = (dbi.prepare(`SELECT COALESCE(SUM(total - COALESCE(amount_paid,0)),0) t FROM invoices WHERE company_id = ? AND status IN ('sent','partial','overdue')`).get(cid) as any)?.t || 0;
  return { accountsPayable: round2(ap), accountsReceivable: round2(ar), netPosition: round2(ar - ap), ratio: ap > 0 ? round2(ar / ap) : 0 };
}

// ═══ SW41–SW50: Bank Reconciliation & Settings ═══════════
export function bankReconciliationSummary(cid: string) {
  const dbi = db.getDb();
  const accounts = dbi.prepare(`SELECT id, name, bank_name, current_balance, last_reconciled_date FROM bank_accounts WHERE company_id = ? ORDER BY name`).all(cid) as any[];
  const unmatched = (dbi.prepare(`SELECT COUNT(*) c FROM bank_transactions bt JOIN bank_accounts ba ON ba.id = bt.bank_account_id WHERE ba.company_id = ? AND bt.matched = 0`).get(cid) as any)?.c || 0;
  return { accounts, unmatchedTransactions: unmatched };
}
export function unmatchedTransactions(cid: string, limit = 50) {
  return db.getDb().prepare(`SELECT bt.*, ba.name AS account_name FROM bank_transactions bt JOIN bank_accounts ba ON ba.id = bt.bank_account_id WHERE ba.company_id = ? AND bt.matched = 0 ORDER BY bt.date DESC LIMIT ?`).all(cid, limit);
}
export function bankBalanceHistory(cid: string, accountId: string) {
  try { return db.getDb().prepare(`SELECT * FROM account_balance_history WHERE account_id = ? ORDER BY as_of_date DESC LIMIT 30`).all(accountId); } catch { return []; }
}
export function transactionsByCategory(cid: string) {
  return db.getDb().prepare(`SELECT COALESCE(bt.category,'Uncategorized') AS category, COUNT(*) AS count, ROUND(SUM(ABS(bt.amount)),2) AS total FROM bank_transactions bt JOIN bank_accounts ba ON ba.id = bt.bank_account_id WHERE ba.company_id = ? AND bt.date >= date('now','-3 months') GROUP BY category ORDER BY total DESC`).all(cid);
}
export function reconciliationProgress(cid: string) {
  const dbi = db.getDb();
  const total = (dbi.prepare(`SELECT COUNT(*) c FROM bank_transactions bt JOIN bank_accounts ba ON ba.id = bt.bank_account_id WHERE ba.company_id = ? AND bt.date >= date('now','-30 days')`).get(cid) as any)?.c || 0;
  const matched = (dbi.prepare(`SELECT COUNT(*) c FROM bank_transactions bt JOIN bank_accounts ba ON ba.id = bt.bank_account_id WHERE ba.company_id = ? AND bt.matched = 1 AND bt.date >= date('now','-30 days')`).get(cid) as any)?.c || 0;
  return { total, matched, unmatched: total - matched, matchRate: total > 0 ? round2((matched / total) * 100) : 100 };
}
export function listSettings(cid: string) {
  return db.getDb().prepare(`SELECT key, value FROM settings WHERE company_id = ? ORDER BY key`).all(cid);
}
export function getSetting(cid: string, key: string) {
  const r = db.getDb().prepare(`SELECT value FROM settings WHERE company_id = ? AND key = ?`).get(cid, key) as any;
  return r?.value || null;
}
export function setSetting(cid: string, key: string, value: string) {
  const dbi = db.getDb();
  const existing = dbi.prepare(`SELECT id FROM settings WHERE company_id = ? AND key = ?`).get(cid, key) as any;
  if (existing) dbi.prepare(`UPDATE settings SET value = ?, updated_at = datetime('now') WHERE id = ?`).run(value, existing.id);
  else db.create('settings', { company_id: cid, key, value });
}
export function companyProfile(cid: string) {
  return db.getDb().prepare(`SELECT * FROM companies WHERE id = ?`).get(cid);
}
export function systemHealthCheck(cid: string) {
  const dbi = db.getDb();
  const tables = (dbi.prepare(`SELECT COUNT(*) c FROM sqlite_master WHERE type = 'table'`).get() as any)?.c || 0;
  const dbSize = (dbi.prepare(`SELECT page_count * page_size AS size FROM pragma_page_count(), pragma_page_size()`).get() as any)?.size || 0;
  const integrity = (dbi.prepare(`PRAGMA integrity_check`).get() as any)?.integrity_check;
  return { tables, dbSizeBytes: dbSize, dbSizeMB: round2(dbSize / 1048576), integrityCheck: integrity || 'ok', companyId: cid };
}
