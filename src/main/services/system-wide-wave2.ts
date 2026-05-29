// ─── System-Wide Wave 2: 50 features (SW51–SW100) ────────
// Fixed Assets, Budgets, Documents, Time Tracking, Automations, Quotes

import { randomUUID as uuid } from 'crypto';
import * as db from '../database';
const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);
const round2 = (n: number) => Math.round((n || 0) * 100) / 100;

// ═══ SW51–SW60: Fixed Assets ═════════════════════════════
export function assetDashboard(cid: string) {
  const dbi = db.getDb();
  const total = (dbi.prepare(`SELECT COUNT(*) c FROM fixed_assets WHERE company_id = ? AND status = 'active'`).get(cid) as any)?.c || 0;
  const totalValue = (dbi.prepare(`SELECT COALESCE(SUM(purchase_price),0) t FROM fixed_assets WHERE company_id = ? AND status = 'active'`).get(cid) as any)?.t || 0;
  const totalDepreciation = (dbi.prepare(`SELECT COALESCE(SUM(accumulated_depreciation),0) t FROM fixed_assets WHERE company_id = ? AND status = 'active'`).get(cid) as any)?.t || 0;
  const disposed = (dbi.prepare(`SELECT COUNT(*) c FROM fixed_assets WHERE company_id = ? AND status = 'disposed'`).get(cid) as any)?.c || 0;
  return { activeAssets: total, totalPurchaseValue: round2(totalValue), accumulatedDepreciation: round2(totalDepreciation), netBookValue: round2(totalValue - totalDepreciation), disposedCount: disposed };
}
export function assetsByCategory(cid: string) {
  return db.getDb().prepare(`SELECT COALESCE(NULLIF(asset_type,''),'Other') AS category, COUNT(*) AS count, ROUND(SUM(purchase_price),2) AS total_value, ROUND(SUM(accumulated_depreciation),2) AS total_depreciation FROM fixed_assets WHERE company_id = ? AND status = 'active' GROUP BY category ORDER BY total_value DESC`).all(cid);
}
export function assetsNeedingDepreciation(cid: string) {
  return db.getDb().prepare(`SELECT id, name, purchase_price, accumulated_depreciation, useful_life_months, purchase_date, depreciation_method FROM fixed_assets WHERE company_id = ? AND status = 'active' AND depreciation_method IS NOT NULL ORDER BY purchase_date`).all(cid);
}
export function assetDepreciationSchedule(assetId: string) {
  return db.getDb().prepare(`SELECT * FROM asset_depreciation_entries WHERE asset_id = ? ORDER BY period_date`).all(assetId);
}
export function assetsExpiringWarranty(cid: string, days = 90) {
  try { return db.getDb().prepare(`SELECT aw.*, fa.name AS asset_name FROM asset_warranties aw JOIN fixed_assets fa ON fa.id = aw.asset_id WHERE fa.company_id = ? AND aw.expiry_date <= date('now', '+' || ? || ' days') AND aw.expiry_date >= date('now') ORDER BY aw.expiry_date`).all(cid, days); } catch { return []; }
}
export function assetInsuranceSummary(cid: string) {
  try { return db.getDb().prepare(`SELECT ai.*, fa.name AS asset_name FROM asset_insurance ai JOIN fixed_assets fa ON fa.id = ai.asset_id WHERE fa.company_id = ? ORDER BY ai.expiry_date`).all(cid); } catch { return []; }
}
export function recentAssetDisposals(cid: string) {
  return db.getDb().prepare(`SELECT * FROM fixed_assets WHERE company_id = ? AND status = 'disposed' ORDER BY disposal_date DESC LIMIT 20`).all(cid);
}
export function assetSearch(cid: string, query: string) {
  const q = `%${query.toLowerCase()}%`;
  return db.getDb().prepare(`SELECT * FROM fixed_assets WHERE company_id = ? AND (lower(name) LIKE ? OR lower(serial_number) LIKE ? OR lower(asset_tag) LIKE ?) LIMIT 30`).all(cid, q, q, q);
}
export function totalAssetValue(cid: string) {
  return db.getDb().prepare(`SELECT ROUND(SUM(purchase_price),2) AS gross, ROUND(SUM(accumulated_depreciation),2) AS depreciation, ROUND(SUM(purchase_price - COALESCE(accumulated_depreciation,0)),2) AS net FROM fixed_assets WHERE company_id = ? AND status = 'active'`).get(cid);
}
export function assetsByLocation(cid: string) {
  return db.getDb().prepare(`SELECT COALESCE(NULLIF(location,''),'Unassigned') AS location, COUNT(*) AS count, ROUND(SUM(purchase_price),2) AS value FROM fixed_assets WHERE company_id = ? AND status = 'active' GROUP BY location ORDER BY value DESC`).all(cid);
}

// ═══ SW61–SW70: Budgets & Forecasting ════════════════════
export function budgetDashboard(cid: string) {
  const dbi = db.getDb();
  const active = (dbi.prepare(`SELECT COUNT(*) c FROM budgets WHERE company_id = ? AND status = 'active'`).get(cid) as any)?.c || 0;
  const totalBudgeted = (dbi.prepare(`SELECT COALESCE(SUM(bl.amount),0) t FROM budget_lines bl JOIN budgets b ON b.id = bl.budget_id WHERE b.company_id = ? AND b.status = 'active'`).get(cid) as any)?.t || 0;
  return { activeBudgets: active, totalBudgeted: round2(totalBudgeted) };
}
export function budgetVsActual(cid: string, budgetId: string) {
  return db.getDb().prepare(`SELECT bl.category, bl.amount AS budgeted, COALESCE((SELECT SUM(e.amount) FROM expenses e LEFT JOIN categories c ON c.id = e.category_id WHERE e.company_id = ? AND c.name = bl.category AND e.deleted_at IS NULL),0) AS actual, ROUND(COALESCE((SELECT SUM(e.amount) FROM expenses e LEFT JOIN categories c ON c.id = e.category_id WHERE e.company_id = ? AND c.name = bl.category AND e.deleted_at IS NULL),0) - bl.amount, 2) AS variance FROM budget_lines bl WHERE bl.budget_id = ? ORDER BY bl.category`).all(cid, cid, budgetId);
}
export function budgetUtilization(cid: string) {
  return db.getDb().prepare(`SELECT b.name, ROUND(SUM(bl.amount),2) AS budgeted, ROUND(COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.company_id = ? AND e.deleted_at IS NULL AND e.date BETWEEN b.start_date AND b.end_date),0),2) AS actual FROM budgets b JOIN budget_lines bl ON bl.budget_id = b.id WHERE b.company_id = ? AND b.status = 'active' GROUP BY b.id`).all(cid, cid);
}
export function categoriesOverBudget(cid: string) {
  return db.getDb().prepare(`SELECT bl.category, bl.amount AS budgeted, COALESCE((SELECT SUM(e.amount) FROM expenses e LEFT JOIN categories c ON c.id = e.category_id WHERE e.company_id = ? AND c.name = bl.category AND strftime('%Y-%m', e.date) = strftime('%Y-%m', 'now') AND e.deleted_at IS NULL),0) AS actual FROM budget_lines bl JOIN budgets b ON b.id = bl.budget_id WHERE b.company_id = ? AND b.status = 'active' HAVING actual > budgeted ORDER BY actual DESC`).all(cid, cid);
}
export function budgetForecast(cid: string) {
  const dbi = db.getDb();
  const monthlyAvg = (dbi.prepare(`SELECT ROUND(SUM(amount) / 6.0, 2) AS avg FROM expenses WHERE company_id = ? AND date >= date('now','-6 months') AND deleted_at IS NULL`).get(cid) as any)?.avg || 0;
  const budget = (dbi.prepare(`SELECT COALESCE(SUM(bl.amount),0) t FROM budget_lines bl JOIN budgets b ON b.id = bl.budget_id WHERE b.company_id = ? AND b.status = 'active'`).get(cid) as any)?.t || 0;
  return { monthlyAvgSpend: round2(monthlyAvg), monthlyBudget: round2(budget / 12), annualizedSpend: round2(monthlyAvg * 12), annualBudget: round2(budget), projectedVariance: round2(monthlyAvg * 12 - budget) };
}
export function listBudgets(cid: string) {
  return db.getDb().prepare(`SELECT * FROM budgets WHERE company_id = ? ORDER BY status DESC, start_date DESC`).all(cid);
}
export function budgetLineDetails(budgetId: string) {
  return db.getDb().prepare(`SELECT * FROM budget_lines WHERE budget_id = ? ORDER BY category`).all(budgetId);
}
export function createBudget(cid: string, budget: any) {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO budgets (id, company_id, name, start_date, end_date, status, created_at, updated_at) VALUES (?,?,?,?,?,'active',datetime('now'),datetime('now'))`).run(id, cid, budget.name, budget.start_date, budget.end_date);
  return { id };
}
export function addBudgetLine(budgetId: string, line: any) {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO budget_lines (id, budget_id, category, amount, created_at) VALUES (?,?,?,?,datetime('now'))`).run(id, budgetId, line.category, line.amount);
  return { id };
}
export function deleteBudgetLine(id: string) { db.getDb().prepare('DELETE FROM budget_lines WHERE id = ?').run(id); }

// ═══ SW71–SW80: Documents & Email ════════════════════════
export function documentDashboard(cid: string) {
  const dbi = db.getDb();
  const total = (dbi.prepare(`SELECT COUNT(*) c FROM documents WHERE company_id = ?`).get(cid) as any)?.c || 0;
  const recent = (dbi.prepare(`SELECT COUNT(*) c FROM documents WHERE company_id = ? AND created_at >= date('now','-7 days')`).get(cid) as any)?.c || 0;
  return { totalDocuments: total, addedLastWeek: recent };
}
export function documentSearch(cid: string, query: string) {
  const q = `%${query.toLowerCase()}%`;
  return db.getDb().prepare(`SELECT * FROM documents WHERE company_id = ? AND (lower(name) LIKE ? OR lower(description) LIKE ?) ORDER BY created_at DESC LIMIT 30`).all(cid, q, q);
}
export function documentsByEntity(cid: string, entityType: string, entityId: string) {
  return db.getDb().prepare(`SELECT * FROM documents WHERE company_id = ? AND entity_type = ? AND entity_id = ? ORDER BY created_at DESC`).all(cid, entityType, entityId);
}
export function recentDocuments(cid: string, limit = 20) {
  return db.getDb().prepare(`SELECT * FROM documents WHERE company_id = ? ORDER BY created_at DESC LIMIT ?`).all(cid, limit);
}
export function emailLogDashboard(cid: string) {
  const dbi = db.getDb();
  const total = (dbi.prepare(`SELECT COUNT(*) c FROM email_log WHERE company_id = ?`).get(cid) as any)?.c || 0;
  const thisMonth = (dbi.prepare(`SELECT COUNT(*) c FROM email_log WHERE company_id = ? AND substr(sent_at,1,7) = substr(date('now'),1,7)`).get(cid) as any)?.c || 0;
  return { totalEmails: total, sentThisMonth: thisMonth };
}
export function emailHistory(cid: string, limit = 30) {
  return db.getDb().prepare(`SELECT * FROM email_log WHERE company_id = ? ORDER BY sent_at DESC LIMIT ?`).all(cid, limit);
}
export function emailByRecipient(cid: string) {
  return db.getDb().prepare(`SELECT recipient, COUNT(*) AS count, MAX(sent_at) AS last_sent FROM email_log WHERE company_id = ? GROUP BY recipient ORDER BY count DESC LIMIT 20`).all(cid);
}
export function notificationStats(cid: string) {
  const dbi = db.getDb();
  const total = (dbi.prepare(`SELECT COUNT(*) c FROM notifications WHERE company_id = ?`).get(cid) as any)?.c || 0;
  const unread = (dbi.prepare(`SELECT COUNT(*) c FROM notifications WHERE company_id = ? AND is_read = 0`).get(cid) as any)?.c || 0;
  const byType = dbi.prepare(`SELECT type, COUNT(*) AS count FROM notifications WHERE company_id = ? GROUP BY type ORDER BY count DESC`).all(cid);
  return { total, unread, byType };
}
export function auditLogSummary(cid: string, days = 7) {
  return db.getDb().prepare(`SELECT entity_type, action, COUNT(*) AS count FROM audit_log WHERE company_id = ? AND created_at >= date('now', '-' || ? || ' days') GROUP BY entity_type, action ORDER BY count DESC LIMIT 30`).all(cid, days);
}
export function auditLogSearch(cid: string, query: string) {
  const q = `%${query.toLowerCase()}%`;
  return db.getDb().prepare(`SELECT * FROM audit_log WHERE company_id = ? AND (lower(entity_type) LIKE ? OR lower(action) LIKE ?) ORDER BY created_at DESC LIMIT 50`).all(cid, q, q);
}

// ═══ SW81–SW90: Time Tracking & Quotes ═══════════════════
export function timeTrackingDashboard(cid: string) {
  const dbi = db.getDb();
  const thisWeek = (dbi.prepare(`SELECT COALESCE(SUM(hours),0) t, COUNT(*) c FROM time_entries WHERE company_id = ? AND date >= date('now','weekday 0','-7 days')`).get(cid) as any);
  const thisMonth = (dbi.prepare(`SELECT COALESCE(SUM(hours),0) t FROM time_entries WHERE company_id = ? AND substr(date,1,7) = substr(date('now'),1,7)`).get(cid) as any)?.t || 0;
  const billableRate = (dbi.prepare(`SELECT ROUND(CAST(SUM(CASE WHEN is_billable = 1 THEN hours ELSE 0 END) AS REAL) / NULLIF(SUM(hours),0) * 100, 1) AS rate FROM time_entries WHERE company_id = ? AND date >= date('now','-30 days')`).get(cid) as any)?.rate || 0;
  return { weeklyHours: round2(thisWeek?.t || 0), weeklyEntries: thisWeek?.c || 0, monthlyHours: round2(thisMonth), billableRate: round2(billableRate) };
}
export function timeByEmployee(cid: string, startDate?: string, endDate?: string) {
  let sql = `SELECT e.name, te.employee_id, ROUND(SUM(te.hours),2) AS total_hours, SUM(CASE WHEN te.is_billable = 1 THEN te.hours ELSE 0 END) AS billable_hours FROM time_entries te LEFT JOIN employees e ON e.id = te.employee_id WHERE te.company_id = ?`;
  const p: any[] = [cid];
  if (startDate) { sql += ' AND te.date >= ?'; p.push(startDate); }
  if (endDate) { sql += ' AND te.date <= ?'; p.push(endDate); }
  return db.getDb().prepare(sql + ' GROUP BY te.employee_id ORDER BY total_hours DESC').all(...p);
}
export function timeByProject(cid: string) {
  return db.getDb().prepare(`SELECT p.name AS project_name, ROUND(SUM(te.hours),2) AS total_hours, COUNT(DISTINCT te.employee_id) AS team_members FROM time_entries te JOIN projects p ON p.id = te.project_id WHERE te.company_id = ? AND te.date >= date('now','-30 days') GROUP BY p.id ORDER BY total_hours DESC`).all(cid);
}
export function unbilledTime(cid: string) {
  return db.getDb().prepare(`SELECT te.*, e.name AS employee_name, p.name AS project_name FROM time_entries te LEFT JOIN employees e ON e.id = te.employee_id LEFT JOIN projects p ON p.id = te.project_id WHERE te.company_id = ? AND te.is_billable = 1 AND te.is_invoiced = 0 ORDER BY te.date DESC LIMIT 50`).all(cid);
}
export function weeklyTimeReport(cid: string) {
  return db.getDb().prepare(`SELECT date, ROUND(SUM(hours),2) AS total_hours, COUNT(*) AS entries FROM time_entries WHERE company_id = ? AND date >= date('now','-28 days') GROUP BY date ORDER BY date`).all(cid);
}
export function quotesDashboard(cid: string) {
  const dbi = db.getDb();
  const active = (dbi.prepare(`SELECT COUNT(*) c, COALESCE(SUM(total),0) t FROM quotes WHERE company_id = ? AND status IN ('draft','sent')`).get(cid) as any);
  const converted = (dbi.prepare(`SELECT COUNT(*) c FROM quotes WHERE company_id = ? AND status = 'accepted' AND created_at >= date('now','-90 days')`).get(cid) as any)?.c || 0;
  const total90 = (dbi.prepare(`SELECT COUNT(*) c FROM quotes WHERE company_id = ? AND created_at >= date('now','-90 days')`).get(cid) as any)?.c || 0;
  return { activeQuotes: active?.c || 0, activePipelineValue: round2(active?.t || 0), conversionRate: total90 > 0 ? round2((converted / total90) * 100) : 0, convertedLast90: converted };
}
export function quotesByStatus(cid: string) {
  return db.getDb().prepare(`SELECT status, COUNT(*) AS count, ROUND(SUM(total),2) AS total FROM quotes WHERE company_id = ? GROUP BY status ORDER BY count DESC`).all(cid);
}
export function quoteConversionFunnel(cid: string) {
  const dbi = db.getDb();
  const draft = (dbi.prepare(`SELECT COUNT(*) c FROM quotes WHERE company_id = ? AND status = 'draft'`).get(cid) as any)?.c || 0;
  const sent = (dbi.prepare(`SELECT COUNT(*) c FROM quotes WHERE company_id = ? AND status = 'sent'`).get(cid) as any)?.c || 0;
  const accepted = (dbi.prepare(`SELECT COUNT(*) c FROM quotes WHERE company_id = ? AND status = 'accepted'`).get(cid) as any)?.c || 0;
  const declined = (dbi.prepare(`SELECT COUNT(*) c FROM quotes WHERE company_id = ? AND status = 'declined'`).get(cid) as any)?.c || 0;
  return { draft, sent, accepted, declined, winRate: (sent + accepted + declined) > 0 ? round2((accepted / (sent + accepted + declined)) * 100) : 0 };
}
export function topQuotesByValue(cid: string, limit = 10) {
  return db.getDb().prepare(`SELECT q.*, c.name AS client_name FROM quotes q LEFT JOIN clients c ON c.id = q.client_id WHERE q.company_id = ? ORDER BY q.total DESC LIMIT ?`).all(cid, limit);
}
export function expiredQuotes(cid: string) {
  return db.getDb().prepare(`SELECT q.*, c.name AS client_name FROM quotes q LEFT JOIN clients c ON c.id = q.client_id WHERE q.company_id = ? AND q.status IN ('draft','sent') AND q.expiry_date < date('now') ORDER BY q.expiry_date DESC`).all(cid);
}

// ═══ SW91–SW100: Automations & Cross-Module ══════════════
export function automationsDashboard(cid: string) {
  const dbi = db.getDb();
  const rules = (dbi.prepare(`SELECT COUNT(*) c FROM rules WHERE company_id = ? AND is_active = 1`).get(cid) as any)?.c || 0;
  const recentLogs = (dbi.prepare(`SELECT COUNT(*) c FROM rule_logs WHERE company_id = ? AND created_at >= date('now','-7 days')`).get(cid) as any)?.c || 0;
  return { activeRules: rules, ruleExecutionsLast7Days: recentLogs };
}
export function ruleExecutionHistory(cid: string, limit = 30) {
  return db.getDb().prepare(`SELECT rl.*, r.name AS rule_name FROM rule_logs rl LEFT JOIN rules r ON r.id = rl.rule_id WHERE rl.company_id = ? ORDER BY rl.created_at DESC LIMIT ?`).all(cid, limit);
}
export function crossModuleSummary(cid: string) {
  const dbi = db.getDb();
  const modules: Record<string, number> = {};
  const counts = [
    ['Clients', `SELECT COUNT(*) c FROM clients WHERE company_id = ? AND deleted_at IS NULL`],
    ['Invoices', `SELECT COUNT(*) c FROM invoices WHERE company_id = ?`],
    ['Expenses', `SELECT COUNT(*) c FROM expenses WHERE company_id = ? AND deleted_at IS NULL`],
    ['Bills', `SELECT COUNT(*) c FROM bills WHERE company_id = ?`],
    ['Projects', `SELECT COUNT(*) c FROM projects WHERE company_id = ?`],
    ['Employees', `SELECT COUNT(*) c FROM employees WHERE company_id = ? AND status = 'active'`],
    ['Vendors', `SELECT COUNT(*) c FROM vendors WHERE company_id = ? AND deleted_at IS NULL`],
    ['Loans', `SELECT COUNT(*) c FROM loans WHERE company_id = ? AND deleted_at IS NULL`],
    ['Quotes', `SELECT COUNT(*) c FROM quotes WHERE company_id = ?`],
    ['Fixed Assets', `SELECT COUNT(*) c FROM fixed_assets WHERE company_id = ?`],
    ['Inventory Items', `SELECT COUNT(*) c FROM inventory_items WHERE company_id = ?`],
    ['Time Entries', `SELECT COUNT(*) c FROM time_entries WHERE company_id = ?`],
    ['Documents', `SELECT COUNT(*) c FROM documents WHERE company_id = ?`],
    ['Bank Accounts', `SELECT COUNT(*) c FROM bank_accounts WHERE company_id = ?`],
  ];
  for (const [name, sql] of counts) {
    try { modules[name] = (dbi.prepare(sql).get(cid) as any)?.c || 0; } catch { modules[name] = 0; }
  }
  return modules;
}
export function recentSystemActivity(cid: string, limit = 50) {
  return db.getDb().prepare(`SELECT entity_type, action, entity_id, created_at, created_by FROM audit_log WHERE company_id = ? ORDER BY created_at DESC LIMIT ?`).all(cid, limit);
}
export function cashFlowSummary(cid: string) {
  const dbi = db.getDb();
  const inflows = (dbi.prepare(`SELECT COALESCE(SUM(amount),0) t FROM payments WHERE company_id = ? AND date >= date('now','-30 days')`).get(cid) as any)?.t || 0;
  const outflows = (dbi.prepare(`SELECT COALESCE(SUM(amount),0) t FROM expenses WHERE company_id = ? AND date >= date('now','-30 days') AND deleted_at IS NULL`).get(cid) as any)?.t || 0;
  const billsPaid = (dbi.prepare(`SELECT COALESCE(SUM(amount),0) t FROM bill_payments WHERE company_id = ? AND date >= date('now','-30 days')`).get(cid) as any)?.t || 0;
  return { inflows30d: round2(inflows), outflows30d: round2(outflows + billsPaid), netCashFlow: round2(inflows - outflows - billsPaid) };
}
export function taxSummaryYTD(cid: string) {
  const dbi = db.getDb();
  const revenue = (dbi.prepare(`SELECT COALESCE(SUM(total),0) t FROM invoices WHERE company_id = ? AND strftime('%Y', issue_date) = strftime('%Y', 'now')`).get(cid) as any)?.t || 0;
  const expenses = (dbi.prepare(`SELECT COALESCE(SUM(amount),0) t FROM expenses WHERE company_id = ? AND strftime('%Y', date) = strftime('%Y', 'now') AND deleted_at IS NULL`).get(cid) as any)?.t || 0;
  const taxPaid = (dbi.prepare(`SELECT COALESCE(SUM(amount),0) t FROM tax_payments WHERE company_id = ? AND strftime('%Y', date) = strftime('%Y', 'now')`).get(cid) as any)?.t || 0;
  return { ytdRevenue: round2(revenue), ytdExpenses: round2(expenses), netIncome: round2(revenue - expenses), ytdTaxPaid: round2(taxPaid) };
}
export function upcomingDeadlines(cid: string, days = 30) {
  const deadlines: any[] = [];
  const dbi = db.getDb();
  // Invoice due dates
  const invDue = dbi.prepare(`SELECT id, 'Invoice ' || invoice_number AS title, due_date, total AS amount, 'invoice' AS type FROM invoices WHERE company_id = ? AND status IN ('sent','partial') AND due_date >= date('now') AND due_date <= date('now', '+' || ? || ' days') ORDER BY due_date`).all(cid, days) as any[];
  deadlines.push(...invDue);
  // Bill due dates
  const billDue = dbi.prepare(`SELECT id, 'Bill ' || bill_number AS title, due_date, total AS amount, 'bill' AS type FROM bills WHERE company_id = ? AND status IN ('pending','received','approved') AND due_date >= date('now') AND due_date <= date('now', '+' || ? || ' days') ORDER BY due_date`).all(cid, days) as any[];
  deadlines.push(...billDue);
  // Loan payments
  try {
    const loanDue = dbi.prepare(`SELECT id, 'Loan: ' || name AS title, next_payment_due AS due_date, payment_amount AS amount, 'loan' AS type FROM loans WHERE company_id = ? AND status = 'active' AND next_payment_due >= date('now') AND next_payment_due <= date('now', '+' || ? || ' days') AND deleted_at IS NULL`).all(cid, days) as any[];
    deadlines.push(...loanDue);
  } catch {}
  return deadlines.sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
}
export function globalSearch(cid: string, query: string) {
  const q = `%${query.toLowerCase()}%`;
  const results: any[] = [];
  const dbi = db.getDb();
  try { const r = dbi.prepare(`SELECT id, name AS title, 'client' AS type FROM clients WHERE company_id = ? AND lower(name) LIKE ? LIMIT 5`).all(cid, q) as any[]; results.push(...r); } catch {}
  try { const r = dbi.prepare(`SELECT id, invoice_number AS title, 'invoice' AS type FROM invoices WHERE company_id = ? AND lower(invoice_number) LIKE ? LIMIT 5`).all(cid, q) as any[]; results.push(...r); } catch {}
  try { const r = dbi.prepare(`SELECT id, description AS title, 'expense' AS type FROM expenses WHERE company_id = ? AND lower(description) LIKE ? AND deleted_at IS NULL LIMIT 5`).all(cid, q) as any[]; results.push(...r); } catch {}
  try { const r = dbi.prepare(`SELECT id, name AS title, 'vendor' AS type FROM vendors WHERE company_id = ? AND lower(name) LIKE ? AND deleted_at IS NULL LIMIT 5`).all(cid, q) as any[]; results.push(...r); } catch {}
  try { const r = dbi.prepare(`SELECT id, name AS title, 'employee' AS type FROM employees WHERE company_id = ? AND lower(name) LIKE ? LIMIT 5`).all(cid, q) as any[]; results.push(...r); } catch {}
  try { const r = dbi.prepare(`SELECT id, name AS title, 'project' AS type FROM projects WHERE company_id = ? AND lower(name) LIKE ? LIMIT 5`).all(cid, q) as any[]; results.push(...r); } catch {}
  return results;
}
export function dataIntegrityCheck(cid: string) {
  const dbi = db.getDb();
  const issues: { table: string; issue: string; count: number }[] = [];
  // Invoices with no client
  const noClient = (dbi.prepare(`SELECT COUNT(*) c FROM invoices WHERE company_id = ? AND (client_id IS NULL OR client_id = '')`).get(cid) as any)?.c || 0;
  if (noClient > 0) issues.push({ table: 'invoices', issue: 'Missing client', count: noClient });
  // Expenses with no category
  const noCat = (dbi.prepare(`SELECT COUNT(*) c FROM expenses WHERE company_id = ? AND (category_id IS NULL OR category_id = '') AND deleted_at IS NULL`).get(cid) as any)?.c || 0;
  if (noCat > 0) issues.push({ table: 'expenses', issue: 'Missing category', count: noCat });
  // Employees with no email
  const noEmail = (dbi.prepare(`SELECT COUNT(*) c FROM employees WHERE company_id = ? AND status = 'active' AND (email IS NULL OR email = '')`).get(cid) as any)?.c || 0;
  if (noEmail > 0) issues.push({ table: 'employees', issue: 'Missing email', count: noEmail });
  // Unbalanced JEs
  const unbalanced = (dbi.prepare(`SELECT COUNT(*) c FROM journal_entries je WHERE je.company_id = ? AND je.is_posted = 1 AND ABS((SELECT COALESCE(SUM(debit - credit),0) FROM journal_entry_lines WHERE journal_entry_id = je.id)) > 0.01`).get(cid) as any)?.c || 0;
  if (unbalanced > 0) issues.push({ table: 'journal_entries', issue: 'Unbalanced posted entries', count: unbalanced });
  return { issues, totalIssues: issues.reduce((s, i) => s + i.count, 0), clean: issues.length === 0 };
}
