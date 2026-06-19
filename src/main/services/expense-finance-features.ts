// ─── Finance Wave Part 2: F471-F540 (50 features) ───
//
// Batch AD: Expense Advanced (F471-F485)
// Batch AG: Financial Analytics (F506-F520)
// Batch AH: Tax & Compliance (F521-F530)
// Batch AI: Vendor Management Advanced (F531-F540)

import { randomUUID as uuid } from 'crypto';
import * as db from '../database';

const now = (): string => new Date().toISOString();
const today = (): string => now().slice(0, 10);
const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;

// ════════════════════════════════════════════════════════════════
// Batch AD: Expense Advanced (F471-F485)
// ════════════════════════════════════════════════════════════════

// F471 — expense reports (group of expenses)
export function createExpenseReport(r: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO expense_reports (id, company_id, employee_id, report_name, period_start, period_end, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`)
    .run(id, r.company_id, r.employee_id, r.report_name, r.period_start, r.period_end, r.notes, now(), now());
  return { id };
}

export function addExpensesToReport(reportId: string, expenseIds: string[]): { added: number; total_amount: number } {
  const dbi = db.getDb();
  const placeholders = expenseIds.map(() => '?').join(',');
  const r = dbi.prepare(`UPDATE expenses SET expense_report_id = ? WHERE id IN (${placeholders})`).run(reportId, ...expenseIds);
  const totals = dbi.prepare(`SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt FROM expenses WHERE expense_report_id = ?`).get(reportId) as any;
  dbi.prepare(`UPDATE expense_reports SET total_amount = ?, expense_count = ?, updated_at = ? WHERE id = ?`).run(totals.total, totals.cnt, now(), reportId);
  return { added: r.changes, total_amount: round2(totals.total) };
}

export function submitExpenseReport(reportId: string): boolean {
  const r = db.getDb().prepare(`UPDATE expense_reports SET status = 'submitted', submitted_at = ?, updated_at = ? WHERE id = ? AND status = 'draft'`).run(now(), now(), reportId);
  return r.changes > 0;
}

export function approveExpenseReport(reportId: string, approvedBy: string): boolean {
  const r = db.getDb().prepare(`UPDATE expense_reports SET status = 'approved', approved_at = ?, approved_by = ?, updated_at = ? WHERE id = ?`).run(now(), approvedBy, now(), reportId);
  return r.changes > 0;
}

export function listExpenseReports(companyId: string, opts?: { employee_id?: string; status?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.employee_id) { where += ' AND employee_id = ?'; params.push(opts.employee_id); }
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  return dbi.prepare(`SELECT * FROM expense_reports WHERE ${where} ORDER BY created_at DESC`).all(...params) as any[];
}

// F473 — per-diem
export function upsertPerDiem(p: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO per_diem_rates (id, company_id, location, lodging_rate, meals_rate, incidentals_rate, effective_from, effective_to, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, p.company_id, p.location, p.lodging_rate || 0, p.meals_rate || 0, p.incidentals_rate || 0, p.effective_from, p.effective_to, now());
  return { id };
}

export function calcPerDiem(companyId: string, location: string, days: number, includeLodging: boolean = true): { lodging: number; meals: number; incidentals: number; total: number } {
  const r = db.getDb().prepare(`SELECT * FROM per_diem_rates WHERE company_id = ? AND location = ? AND (effective_to IS NULL OR effective_to >= date('now')) ORDER BY effective_from DESC LIMIT 1`).get(companyId, location) as any;
  if (!r) return { lodging: 0, meals: 0, incidentals: 0, total: 0 };
  const lodging = includeLodging ? round2(r.lodging_rate * days) : 0;
  const meals = round2(r.meals_rate * days);
  const incidentals = round2(r.incidentals_rate * days);
  return { lodging, meals, incidentals, total: round2(lodging + meals + incidentals) };
}

// F474 — vehicles + mileage
export function upsertVehicle(v: any): { id: string } {
  const id = uuid();
  const dbi = db.getDb();
  if (v.is_default) dbi.prepare(`UPDATE vehicles SET is_default = 0 WHERE user_id = ?`).run(v.user_id);
  dbi.prepare(`INSERT INTO vehicles (id, company_id, user_id, vehicle_name, make, model, year, plate_number, is_default, business_use_pct, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, v.company_id, v.user_id, v.vehicle_name, v.make, v.model, v.year, v.plate_number, v.is_default ? 1 : 0, v.business_use_pct || 100, now());
  return { id };
}

export function listVehicles(userId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM vehicles WHERE user_id = ? ORDER BY is_default DESC`).all(userId) as any[];
}

// F476 — recurring expenses (uses existing recurring patterns or simple model)
// (Re-uses recurring_je_definitions if present — adds an expense-shaped variant if needed.)
// For brevity, this is a list endpoint that pulls expenses tagged as recurring.
export function listRecurringExpenses(companyId: string): any[] {
  try {
    return db.getDb().prepare(`SELECT * FROM expenses WHERE company_id = ? AND is_recurring = 1 AND (deleted_at IS NULL OR deleted_at = '') ORDER BY date DESC LIMIT 100`).all(companyId) as any[];
  } catch { return []; }
}

// F477 — expense forecast based on history (simple month-over-month average)
export function forecastExpenses(companyId: string, monthsAhead: number = 3): Array<{ month: string; forecast: number; based_on_count: number }> {
  const dbi = db.getDb();
  const history = dbi.prepare(`SELECT strftime('%Y-%m', date) AS month, SUM(amount) AS total FROM expenses WHERE company_id = ? AND date >= date('now', '-12 months') AND (deleted_at IS NULL OR deleted_at = '') GROUP BY month ORDER BY month`).all(companyId) as any[];
  if (history.length === 0) return [];
  const avgMonthly = history.reduce((s, h) => s + (h.total || 0), 0) / history.length;
  const forecasts: any[] = [];
  let cursor = today().slice(0, 7);
  for (let i = 1; i <= monthsAhead; i++) {
    // Advance month
    const [y, m] = cursor.split('-').map(Number);
    const nextTotal = y * 12 + m;
    cursor = `${Math.floor(nextTotal / 12)}-${String((nextTotal % 12) + 1).padStart(2, '0')}`;
    forecasts.push({ month: cursor, forecast: round2(avgMonthly), based_on_count: history.length });
  }
  return forecasts;
}

// F478 — vendor 1099 thresholds + recalc
export function recalcVendor1099(companyId: string, taxYear: number, vendorId?: string): { updated: number; threshold_crossings: any[] } {
  const dbi = db.getDb();
  const params: any[] = [companyId, taxYear];
  let where = `company_id = ? AND strftime('%Y', date) = ?`;
  if (vendorId) { where += ' AND vendor_id = ?'; params.push(vendorId); }
  const sums = dbi.prepare(`SELECT vendor_id, COALESCE(SUM(amount), 0) AS ytd FROM expenses WHERE ${where} GROUP BY vendor_id`).all(...params, String(taxYear)) as any[];
  const crossings: any[] = [];
  let updated = 0;
  for (const s of sums) {
    if (!s.vendor_id) continue;
    const requires = s.ytd >= 600;
    const id = uuid();
    dbi.prepare(`INSERT INTO vendor_1099_thresholds (id, company_id, vendor_id, tax_year, ytd_amount, threshold, requires_1099, form_type, last_calculated_at) VALUES (?, ?, ?, ?, ?, 600, ?, '1099-NEC', ?) ON CONFLICT(company_id, vendor_id, tax_year) DO UPDATE SET ytd_amount = excluded.ytd_amount, requires_1099 = excluded.requires_1099, last_calculated_at = excluded.last_calculated_at`)
      .run(id, companyId, s.vendor_id, taxYear, round2(s.ytd), requires ? 1 : 0, now());
    updated++;
    if (requires) crossings.push({ vendor_id: s.vendor_id, ytd: round2(s.ytd) });
  }
  return { updated, threshold_crossings: crossings };
}

export function listVendors1099Required(companyId: string, taxYear: number): any[] {
  return db.getDb().prepare(`SELECT * FROM vendor_1099_thresholds WHERE company_id = ? AND tax_year = ? AND requires_1099 = 1`).all(companyId, taxYear) as any[];
}

// F479 — category budgets
export function upsertCategoryBudget(b: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO expense_category_budgets (id, company_id, category_id, fiscal_year, month, budget_amount, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, b.company_id, b.category_id, b.fiscal_year, b.month, b.budget_amount || 0, b.notes, now());
  return { id };
}

export function refreshCategoryActuals(companyId: string, fiscalYear: number): { updated: number } {
  const dbi = db.getDb();
  const actuals = dbi.prepare(`SELECT category_id, strftime('%m', date) AS month, COALESCE(SUM(amount), 0) AS total FROM expenses WHERE company_id = ? AND strftime('%Y', date) = ? AND (deleted_at IS NULL OR deleted_at = '') GROUP BY category_id, month`).all(companyId, String(fiscalYear)) as any[];
  let updated = 0;
  for (const a of actuals) {
    const r = dbi.prepare(`UPDATE expense_category_budgets SET actual_amount = ? WHERE company_id = ? AND category_id = ? AND fiscal_year = ? AND month = ?`).run(round2(a.total), companyId, a.category_id, fiscalYear, parseInt(a.month));
    updated += r.changes;
  }
  return { updated };
}

// F481 — reimbursements
export function createReimbursement(r: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO expense_reimbursements (id, company_id, employee_id, total_amount, period_start, period_end, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
    .run(id, r.company_id, r.employee_id, r.total_amount || 0, r.period_start, r.period_end, r.notes, now());
  return { id };
}

export function markReimbursementPaid(id: string, jeId?: string, paymentMethod?: string): boolean {
  const r = db.getDb().prepare(`UPDATE expense_reimbursements SET status = 'paid', paid_at = ?, je_id = ?, payment_method = ? WHERE id = ?`).run(now(), jeId, paymentMethod, id);
  return r.changes > 0;
}

// F484 — rebillable expense
export function markExpenseRebillable(expenseId: string, clientId: string, markupPct: number = 0): boolean {
  const r = db.getDb().prepare(`UPDATE expenses SET rebillable_to_client_id = ?, markup_pct = ?, updated_at = ? WHERE id = ?`).run(clientId, markupPct, now(), expenseId);
  return r.changes > 0;
}

export function listRebillableExpenses(companyId: string, clientId?: string): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = `company_id = ? AND rebillable_to_client_id IS NOT NULL AND rebilled_on_invoice_id IS NULL AND (deleted_at IS NULL OR deleted_at = '')`;
  if (clientId) { where += ' AND rebillable_to_client_id = ?'; params.push(clientId); }
  return dbi.prepare(`SELECT * FROM expenses WHERE ${where} ORDER BY date DESC`).all(...params) as any[];
}

export function markExpenseRebilled(expenseId: string, invoiceId: string): boolean {
  const r = db.getDb().prepare(`UPDATE expenses SET rebilled_on_invoice_id = ?, updated_at = ? WHERE id = ?`).run(invoiceId, now(), expenseId);
  return r.changes > 0;
}

// F485 — pre-approvals
export function requestPreApproval(p: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO expense_pre_approvals (id, company_id, employee_id, description, estimated_amount, category_id, purpose, requested_date, needed_by_date, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
    .run(id, p.company_id, p.employee_id, p.description, p.estimated_amount || 0, p.category_id, p.purpose, p.requested_date || today(), p.needed_by_date, now());
  return { id };
}

export function approvePreApproval(id: string, approvedBy: string): boolean {
  const r = db.getDb().prepare(`UPDATE expense_pre_approvals SET status = 'approved', approved_by = ?, approved_at = ? WHERE id = ? AND status = 'pending'`).run(approvedBy, now(), id);
  return r.changes > 0;
}

export function rejectPreApproval(id: string, reason: string): boolean {
  const r = db.getDb().prepare(`UPDATE expense_pre_approvals SET status = 'rejected', rejected_reason = ? WHERE id = ?`).run(reason, id);
  return r.changes > 0;
}

export function listPreApprovals(companyId: string, opts?: { status?: string; employee_id?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  if (opts?.employee_id) { where += ' AND employee_id = ?'; params.push(opts.employee_id); }
  return dbi.prepare(`SELECT * FROM expense_pre_approvals WHERE ${where} ORDER BY requested_date DESC`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// Batch AG: Financial Analytics (F506-F520)
// ════════════════════════════════════════════════════════════════

// F506-F507 — AR/AP aging chart data (returns data structure for charting)
export function arAgingChart(companyId: string, asOfDate?: string): any[] {
  // Reuses calcAgingBuckets from invoice-payment-features
  const { calcAgingBuckets } = require('./invoice-payment-features');
  const aging = calcAgingBuckets(companyId, asOfDate);
  return [
    { bucket: '0-30 days', amount: aging.bucket_0_30 },
    { bucket: '31-60 days', amount: aging.bucket_31_60 },
    { bucket: '61-90 days', amount: aging.bucket_61_90 },
    { bucket: '90+ days', amount: aging.bucket_90_plus },
  ];
}

export function apAgingChart(companyId: string, asOfDate?: string): any[] {
  const dbi = db.getDb();
  const date = asOfDate || today();
  const rows = dbi.prepare(`
    SELECT b.balance, b.due_date,
      CAST(julianday(?) - julianday(b.due_date) AS INTEGER) AS days_overdue
    FROM bills b WHERE b.company_id = ? AND b.status NOT IN ('paid','void','cancelled')
      AND (b.deleted_at IS NULL OR b.deleted_at = '') AND b.balance > 0
  `).all(date, companyId) as any[];
  const buckets = { '0_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0 };
  for (const r of rows) {
    const days = r.days_overdue || 0;
    let k: keyof typeof buckets;
    if (days < 31) k = '0_30';
    else if (days < 61) k = '31_60';
    else if (days < 91) k = '61_90';
    else k = '90_plus';
    buckets[k] += r.balance || 0;
  }
  return [
    { bucket: '0-30 days', amount: round2(buckets['0_30']) },
    { bucket: '31-60 days', amount: round2(buckets['31_60']) },
    { bucket: '61-90 days', amount: round2(buckets['61_90']) },
    { bucket: '90+ days', amount: round2(buckets['90_plus']) },
  ];
}

// F508-F510 — cash conversion cycle, DSO, DPO
export function calcDSO(companyId: string, periodDays: number = 365): { dso: number; ar_balance: number; period_revenue: number } {
  const dbi = db.getDb();
  const ar = dbi.prepare(`SELECT COALESCE(SUM(balance), 0) AS bal FROM invoices WHERE company_id = ? AND status NOT IN ('paid','void','cancelled') AND (deleted_at IS NULL OR deleted_at = '')`).get(companyId) as any;
  const rev = dbi.prepare(`SELECT COALESCE(SUM(total), 0) AS r FROM invoices WHERE company_id = ? AND issue_date >= date('now', '-' || ? || ' days') AND status NOT IN ('void','cancelled') AND (deleted_at IS NULL OR deleted_at = '')`).get(companyId, periodDays) as any;
  const dso = rev.r > 0 ? round2((ar.bal / rev.r) * periodDays) : 0;
  return { dso, ar_balance: round2(ar.bal), period_revenue: round2(rev.r) };
}

export function calcDPO(companyId: string, periodDays: number = 365): { dpo: number; ap_balance: number; period_purchases: number } {
  const dbi = db.getDb();
  const ap = dbi.prepare(`SELECT COALESCE(SUM(balance), 0) AS bal FROM bills WHERE company_id = ? AND status NOT IN ('paid','void','cancelled') AND (deleted_at IS NULL OR deleted_at = '')`).get(companyId) as any;
  const purch = dbi.prepare(`SELECT COALESCE(SUM(total), 0) AS p FROM bills WHERE company_id = ? AND bill_date >= date('now', '-' || ? || ' days') AND status NOT IN ('void','cancelled') AND (deleted_at IS NULL OR deleted_at = '')`).get(companyId, periodDays) as any;
  const dpo = purch.p > 0 ? round2((ap.bal / purch.p) * periodDays) : 0;
  return { dpo, ap_balance: round2(ap.bal), period_purchases: round2(purch.p) };
}

export function calcCashConversionCycle(companyId: string, periodDays: number = 365): { dso: number; dio: number; dpo: number; ccc: number } {
  const dso = calcDSO(companyId, periodDays).dso;
  const dpo = calcDPO(companyId, periodDays).dpo;
  // DIO (days inventory outstanding) — uses inventory value if available
  const dbi = db.getDb();
  let dio = 0;
  try {
    const inv = dbi.prepare(`SELECT COALESCE(SUM(quantity * unit_cost), 0) AS v FROM inventory_items WHERE company_id = ? AND (deleted_at IS NULL OR deleted_at = '')`).get(companyId) as any;
    const cogs = dbi.prepare(`SELECT COALESCE(SUM(jel.debit), 0) AS c FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id JOIN accounts a ON a.id = jel.account_id WHERE je.company_id = ? AND a.account_type = 'cost_of_sales' AND je.entry_date >= date('now', '-' || ? || ' days')`).get(companyId, periodDays) as any;
    dio = cogs.c > 0 ? round2((inv.v / cogs.c) * periodDays) : 0;
  } catch {}
  const ccc = round2(dso + dio - dpo);
  return { dso, dio, dpo, ccc };
}

// F511 — working capital + ratios
export function calcWorkingCapital(companyId: string): { current_assets: number; current_liabilities: number; working_capital: number; current_ratio: number; quick_ratio: number } {
  const dbi = db.getDb();
  const acctBal = (type: string): number => {
    const r = dbi.prepare(`SELECT COALESCE(SUM(jel.debit - jel.credit), 0) AS b FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id JOIN accounts a ON a.id = jel.account_id WHERE je.company_id = ? AND je.is_posted = 1 AND a.account_type = ?`).get(companyId, type) as any;
    return Math.abs(r?.b || 0);
  };
  const cash = acctBal('cash') + acctBal('bank');
  const ar = (dbi.prepare(`SELECT COALESCE(SUM(balance), 0) AS s FROM invoices WHERE company_id = ? AND status NOT IN ('paid','void','cancelled') AND (deleted_at IS NULL OR deleted_at = '')`).get(companyId) as any).s;
  const inv = acctBal('inventory') + acctBal('other_current_asset');
  const ca = acctBal('current_asset') + cash + ar + inv;
  const cl = acctBal('current_liability') + (dbi.prepare(`SELECT COALESCE(SUM(balance), 0) AS s FROM bills WHERE company_id = ? AND status NOT IN ('paid','void','cancelled') AND (deleted_at IS NULL OR deleted_at = '')`).get(companyId) as any).s;
  return {
    current_assets: round2(ca),
    current_liabilities: round2(cl),
    working_capital: round2(ca - cl),
    current_ratio: cl > 0 ? round2(ca / cl) : 0,
    quick_ratio: cl > 0 ? round2((ca - inv) / cl) : 0,
  };
}

// F514 — burn rate
export function calcBurnRate(companyId: string, monthsHistory: number = 3): { avg_monthly_burn: number; net_monthly_burn: number; months_of_history: number } {
  const dbi = db.getDb();
  const data = dbi.prepare(`SELECT strftime('%Y-%m', date) AS month, SUM(amount) AS exp FROM expenses WHERE company_id = ? AND date >= date('now', '-' || ? || ' months') AND (deleted_at IS NULL OR deleted_at = '') GROUP BY month`).all(companyId, monthsHistory) as any[];
  if (data.length === 0) return { avg_monthly_burn: 0, net_monthly_burn: 0, months_of_history: 0 };
  const avgExpenses = data.reduce((s, d) => s + (d.exp || 0), 0) / data.length;
  // Net burn = expenses - revenue
  const rev = dbi.prepare(`SELECT COALESCE(AVG(monthly_rev), 0) AS r FROM (SELECT strftime('%Y-%m', issue_date) AS month, SUM(total) AS monthly_rev FROM invoices WHERE company_id = ? AND issue_date >= date('now', '-' || ? || ' months') AND status NOT IN ('void','cancelled') AND (deleted_at IS NULL OR deleted_at = '') GROUP BY month)`).get(companyId, monthsHistory) as any;
  const netBurn = round2(avgExpenses - (rev.r || 0));
  return { avg_monthly_burn: round2(avgExpenses), net_monthly_burn: netBurn, months_of_history: data.length };
}

// F515 — runway
export function calcRunway(companyId: string, monthsHistory: number = 3): { runway_months: number; current_cash: number; monthly_net_burn: number } {
  const dbi = db.getDb();
  // Cash balance
  const cashAccts = dbi.prepare(`SELECT id FROM accounts WHERE company_id = ? AND (account_type IN ('cash','bank') OR LOWER(name) LIKE '%cash%' OR LOWER(name) LIKE '%bank%')`).all(companyId) as any[];
  let cash = 0;
  for (const a of cashAccts) {
    const r = dbi.prepare(`SELECT COALESCE(SUM(jel.debit - jel.credit), 0) AS b FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id WHERE jel.account_id = ? AND je.company_id = ? AND je.is_posted = 1`).get(a.id, companyId) as any;
    cash += r?.b || 0;
  }
  const burn = calcBurnRate(companyId, monthsHistory);
  const runwayMonths = burn.net_monthly_burn > 0 ? round2(cash / burn.net_monthly_burn) : 999;
  return { runway_months: runwayMonths, current_cash: round2(cash), monthly_net_burn: burn.net_monthly_burn };
}

// F516-F518 — LTV / CAC / ratio
export function calcLTV(companyId: string, customerId?: string): { ltv: number; avg_purchase: number; purchase_frequency: number; sample_size: number } {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = `company_id = ? AND status NOT IN ('void','cancelled') AND (deleted_at IS NULL OR deleted_at = '')`;
  if (customerId) { where += ' AND client_id = ?'; params.push(customerId); }
  const stats = dbi.prepare(`SELECT COUNT(DISTINCT client_id) AS customers, COUNT(*) AS purchases, COALESCE(SUM(total), 0) AS revenue, COALESCE(AVG(total), 0) AS avg_purchase FROM invoices WHERE ${where}`).get(...params) as any;
  if (stats.customers === 0) return { ltv: 0, avg_purchase: 0, purchase_frequency: 0, sample_size: 0 };
  const purchaseFreq = stats.purchases / stats.customers;
  const ltv = round2(stats.avg_purchase * purchaseFreq);
  return { ltv, avg_purchase: round2(stats.avg_purchase), purchase_frequency: round2(purchaseFreq), sample_size: stats.customers };
}

export function calcCAC(companyId: string, periodDays: number = 365): { cac: number; sales_marketing_cost: number; new_customers: number } {
  const dbi = db.getDb();
  // Find expenses tagged sales/marketing (heuristic: category name contains 'sales' or 'marketing')
  const cost = dbi.prepare(`SELECT COALESCE(SUM(e.amount), 0) AS c FROM expenses e LEFT JOIN categories cat ON cat.id = e.category_id WHERE e.company_id = ? AND e.date >= date('now', '-' || ? || ' days') AND (LOWER(cat.name) LIKE '%sales%' OR LOWER(cat.name) LIKE '%marketing%' OR LOWER(cat.name) LIKE '%advertis%') AND (e.deleted_at IS NULL OR e.deleted_at = '')`).get(companyId, periodDays) as any;
  // New customers = first invoice within period
  const newCust = dbi.prepare(`SELECT COUNT(DISTINCT client_id) AS n FROM invoices WHERE company_id = ? AND issue_date >= date('now', '-' || ? || ' days') AND client_id NOT IN (SELECT DISTINCT client_id FROM invoices WHERE company_id = ? AND issue_date < date('now', '-' || ? || ' days'))`).get(companyId, periodDays, companyId, periodDays) as any;
  const cac = newCust.n > 0 ? round2(cost.c / newCust.n) : 0;
  return { cac, sales_marketing_cost: round2(cost.c), new_customers: newCust.n || 0 };
}

export function calcLTVCACRatio(companyId: string): { ltv: number; cac: number; ratio: number; health: string } {
  const ltv = calcLTV(companyId).ltv;
  const cac = calcCAC(companyId).cac;
  const ratio = cac > 0 ? round2(ltv / cac) : 0;
  const health = ratio >= 3 ? 'healthy' : ratio >= 1.5 ? 'fair' : 'poor';
  return { ltv, cac, ratio, health };
}

// F519 — gross/net revenue retention
export function calcRevenueRetention(companyId: string, periodStart: string, periodEnd: string): { gross_retention: number; net_retention: number; starting_mrr: number; ending_mrr: number; churned_mrr: number; expansion_mrr: number } {
  const dbi = db.getDb();
  // Simplified — uses invoice totals as proxy for MRR
  const startCust = dbi.prepare(`SELECT DISTINCT client_id FROM invoices WHERE company_id = ? AND issue_date < ? AND status NOT IN ('void','cancelled') AND (deleted_at IS NULL OR deleted_at = '')`).all(companyId, periodStart) as any[];
  const startIds = startCust.map(c => c.client_id);
  if (startIds.length === 0) return { gross_retention: 0, net_retention: 0, starting_mrr: 0, ending_mrr: 0, churned_mrr: 0, expansion_mrr: 0 };
  const placeholders = startIds.map(() => '?').join(',');
  const startRev = dbi.prepare(`SELECT COALESCE(SUM(total), 0) AS r FROM invoices WHERE company_id = ? AND issue_date BETWEEN date(?, '-365 days') AND ? AND client_id IN (${placeholders}) AND status NOT IN ('void','cancelled') AND (deleted_at IS NULL OR deleted_at = '')`).get(companyId, periodStart, periodStart, ...startIds) as any;
  const endRev = dbi.prepare(`SELECT COALESCE(SUM(total), 0) AS r FROM invoices WHERE company_id = ? AND issue_date BETWEEN ? AND ? AND client_id IN (${placeholders}) AND status NOT IN ('void','cancelled') AND (deleted_at IS NULL OR deleted_at = '')`).get(companyId, periodStart, periodEnd, ...startIds) as any;
  const grossRet = startRev.r > 0 ? round2((endRev.r / startRev.r) * 100) : 0;
  return { gross_retention: grossRet, net_retention: grossRet, starting_mrr: round2(startRev.r), ending_mrr: round2(endRev.r), churned_mrr: 0, expansion_mrr: 0 };
}

// F520 — cohort analysis
export function buildCohortAnalysis(companyId: string): any[] {
  const dbi = db.getDb();
  // Group customers by first-invoice month, then track each cohort's retention over months
  const cohorts = dbi.prepare(`
    SELECT strftime('%Y-%m', MIN(issue_date)) AS cohort_month, client_id
    FROM invoices WHERE company_id = ? AND status NOT IN ('void','cancelled') AND (deleted_at IS NULL OR deleted_at = '')
    GROUP BY client_id
  `).all(companyId) as any[];
  // Build cohort buckets
  const byCohort = new Map<string, Set<string>>();
  for (const c of cohorts) {
    if (!byCohort.has(c.cohort_month)) byCohort.set(c.cohort_month, new Set());
    byCohort.get(c.cohort_month)!.add(c.client_id);
  }
  const result: any[] = [];
  for (const [cohort, customers] of byCohort) {
    for (let offset = 0; offset <= 12; offset++) {
      const cohortIds = Array.from(customers);
      const placeholders = cohortIds.map(() => '?').join(',');
      const targetMonth = addCohortMonths(cohort, offset);
      const active = dbi.prepare(`SELECT COUNT(DISTINCT client_id) AS n FROM invoices WHERE company_id = ? AND strftime('%Y-%m', issue_date) = ? AND client_id IN (${placeholders}) AND status NOT IN ('void','cancelled') AND (deleted_at IS NULL OR deleted_at = '')`).get(companyId, targetMonth, ...cohortIds) as any;
      const retention = customers.size > 0 ? round2((active.n / customers.size) * 100) : 0;
      result.push({ cohort_month: cohort, period_offset: offset, customers_remaining: active.n || 0, retention_pct: retention });
      // Save to table
      try {
        dbi.prepare(`INSERT INTO cohort_analysis (id, company_id, cohort_month, period_offset, customers_remaining, retention_pct, computed_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(company_id, cohort_month, period_offset) DO UPDATE SET customers_remaining = excluded.customers_remaining, retention_pct = excluded.retention_pct, computed_at = excluded.computed_at`)
          .run(uuid(), companyId, cohort, offset, active.n || 0, retention, now());
      } catch {}
    }
  }
  return result;
}

function addCohortMonths(yearMonth: string, offset: number): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const total = y * 12 + (m - 1) + offset;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

// ════════════════════════════════════════════════════════════════
// Batch AH: Tax & Compliance (F521-F530)
// ════════════════════════════════════════════════════════════════

// F521-F522 — 1099 generation
export function createForm1099Run(opts: { company_id: string; tax_year: number; form_type?: '1099-NEC' | '1099-MISC' }): { id: string; vendor_count: number; total_amount: number } {
  const dbi = db.getDb();
  const id = uuid();
  const vendors = listVendors1099Required(opts.company_id, opts.tax_year);
  const total = vendors.reduce((s, v) => s + (v.ytd_amount || 0), 0);
  dbi.prepare(`INSERT INTO form_1099_runs (id, company_id, tax_year, form_type, vendor_count, total_amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?) ON CONFLICT(company_id, tax_year, form_type) DO UPDATE SET vendor_count = excluded.vendor_count, total_amount = excluded.total_amount`)
    .run(id, opts.company_id, opts.tax_year, opts.form_type || '1099-NEC', vendors.length, round2(total), now());
  return { id, vendor_count: vendors.length, total_amount: round2(total) };
}

export function listForm1099Runs(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM form_1099_runs WHERE company_id = ? ORDER BY tax_year DESC`).all(companyId) as any[];
}

// F523 — withholding tracking
export function recordWithholding(w: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO withholding_tracking (id, company_id, vendor_id, withholding_type, rate, ytd_amount, tax_year, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, w.company_id, w.vendor_id, w.withholding_type || 'backup', w.rate || 0, w.ytd_amount || 0, w.tax_year, w.notes, now());
  return { id };
}

// F527 — quarterly estimates
export function recordQuarterlyEstimate(q: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO quarterly_tax_estimates (id, company_id, tax_year, quarter, federal_estimate, state_estimate, due_date, paid_at, paid_amount, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(company_id, tax_year, quarter) DO UPDATE SET federal_estimate = excluded.federal_estimate, state_estimate = excluded.state_estimate, paid_at = excluded.paid_at, paid_amount = excluded.paid_amount`)
    .run(id, q.company_id, q.tax_year, q.quarter, q.federal_estimate || 0, q.state_estimate || 0, q.due_date, q.paid_at, q.paid_amount || 0, q.notes, now());
  return { id };
}

export function listQuarterlyEstimates(companyId: string, taxYear: number): any[] {
  return db.getDb().prepare(`SELECT * FROM quarterly_tax_estimates WHERE company_id = ? AND tax_year = ? ORDER BY quarter`).all(companyId, taxYear) as any[];
}

// F528 — tax provision
export function calcTaxProvision(opts: { company_id: string; fiscal_year: number; book_income: number; permanent_differences?: number; temporary_differences?: number; federal_rate?: number; state_rate?: number }): { id: string; current_total: number; effective_rate: number } {
  const taxable = (opts.book_income || 0) + (opts.permanent_differences || 0) + (opts.temporary_differences || 0);
  const fedRate = opts.federal_rate ?? 21;
  const stateRate = opts.state_rate ?? 0;
  const currentFed = round2(taxable * fedRate / 100);
  const currentState = round2(taxable * stateRate / 100);
  const total = round2(currentFed + currentState);
  const dtl = round2((opts.temporary_differences || 0) * (fedRate + stateRate) / 100);
  const effectiveRate = opts.book_income !== 0 ? round2((total / opts.book_income) * 100) : 0;
  const id = uuid();
  db.getDb().prepare(`INSERT INTO tax_provision (id, company_id, fiscal_year, book_income, permanent_differences, temporary_differences, taxable_income, federal_rate, state_rate, current_federal_tax, current_state_tax, deferred_tax_liability, effective_tax_rate, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, opts.company_id, opts.fiscal_year, opts.book_income, opts.permanent_differences || 0, opts.temporary_differences || 0, taxable, fedRate, stateRate, currentFed, currentState, dtl, effectiveRate, now());
  return { id, current_total: total, effective_rate: effectiveRate };
}

// F529 — R&D tax credit
export function calcRDCredit(opts: any): { id: string; credit_amount: number } {
  const baseAmt = opts.base_amount || 0;
  const incremental = Math.max(0, (opts.qualified_research_expense || 0) - baseAmt);
  const credit = round2(incremental * (opts.credit_rate || 20) / 100);
  const id = uuid();
  db.getDb().prepare(`INSERT INTO rd_tax_credits (id, company_id, tax_year, qualified_research_expense, base_amount, incremental_qre, credit_rate, credit_amount, payroll_offset_election, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, opts.company_id, opts.tax_year, opts.qualified_research_expense || 0, baseAmt, incremental, opts.credit_rate || 20, credit, opts.payroll_offset_election ? 1 : 0, opts.notes, now());
  return { id, credit_amount: credit };
}

// F530 — Section 179 election
export function elect179(opts: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO section_179_elections (id, company_id, asset_id, tax_year, elected_amount, bonus_depreciation, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, opts.company_id, opts.asset_id, opts.tax_year, opts.elected_amount || 0, opts.bonus_depreciation ? 1 : 0, opts.notes, now());
  return { id };
}

export function list179Elections(companyId: string, taxYear?: number): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (taxYear) { where += ' AND tax_year = ?'; params.push(taxYear); }
  return dbi.prepare(`SELECT * FROM section_179_elections WHERE ${where}`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// Batch AI: Vendor Management Advanced (F531-F540)
// ════════════════════════════════════════════════════════════════

// F531 — onboarding checklist
export function startVendorOnboarding(opts: { company_id: string; vendor_id: string; checklist_items: any[] }): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO vendor_onboarding_checklists (id, company_id, vendor_id, checklist_items_json, items_completed, items_total, status, created_at) VALUES (?, ?, ?, ?, 0, ?, 'in_progress', ?)`)
    .run(id, opts.company_id, opts.vendor_id, JSON.stringify(opts.checklist_items || []), opts.checklist_items?.length || 0, now());
  return { id };
}

export function updateOnboardingProgress(id: string, itemsCompleted: number): { is_complete: boolean } {
  const dbi = db.getDb();
  const c = dbi.prepare(`SELECT items_total FROM vendor_onboarding_checklists WHERE id = ?`).get(id) as any;
  if (!c) throw new Error('Checklist not found');
  const isComplete = itemsCompleted >= c.items_total;
  dbi.prepare(`UPDATE vendor_onboarding_checklists SET items_completed = ?, status = ?, completed_at = ? WHERE id = ?`).run(itemsCompleted, isComplete ? 'completed' : 'in_progress', isComplete ? now() : null, id);
  return { is_complete: isComplete };
}

// F532 — W-9 records
export function recordW9(w: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO vendor_w9_records (id, company_id, vendor_id, legal_name, tin, tin_type, business_type, address, is_us_person, backup_withholding_subject, received_date, file_path, signature_present, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, w.company_id, w.vendor_id, w.legal_name, w.tin, w.tin_type, w.business_type, w.address, w.is_us_person !== false ? 1 : 0, w.backup_withholding_subject ? 1 : 0, w.received_date || today(), w.file_path, w.signature_present ? 1 : 0, now());
  return { id };
}

export function vendorsMissingW9(companyId: string): any[] {
  return db.getDb().prepare(`SELECT v.id, v.name, v.email FROM vendors v WHERE v.company_id = ? AND v.id NOT IN (SELECT vendor_id FROM vendor_w9_records WHERE company_id = ?) AND (v.deleted_at IS NULL OR v.deleted_at = '')`).all(companyId, companyId) as any[];
}

// F533 — vendor insurance
export function recordVendorInsurance(opts: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO vendor_insurance_policies (id, company_id, vendor_id, policy_type, carrier, policy_number, coverage_amount, effective_date, expiration_date, certificate_file_path, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, opts.company_id, opts.vendor_id, opts.policy_type, opts.carrier, opts.policy_number, opts.coverage_amount || 0, opts.effective_date, opts.expiration_date, opts.certificate_file_path, opts.notes, now());
  return { id };
}

export function expiringVendorInsurance(companyId: string, daysAhead: number = 30): any[] {
  return db.getDb().prepare(`SELECT vi.*, v.name AS vendor_name FROM vendor_insurance_policies vi LEFT JOIN vendors v ON v.id = vi.vendor_id WHERE vi.company_id = ? AND vi.expiration_date BETWEEN date('now') AND date('now', '+' || ? || ' days') ORDER BY vi.expiration_date`).all(companyId, daysAhead) as any[];
}

// F534 — performance score (composite)
export function calcVendorScore(companyId: string, vendorId: string): { score: number; on_time_payment_pct: number; quality_score: number; volume_total: number } {
  const dbi = db.getDb();
  // On-time delivery / payment % (uses paid_at vs due_date on bills)
  const billStats = dbi.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN paid_at IS NOT NULL AND date(paid_at) <= date(due_date) THEN 1 ELSE 0 END) AS on_time, COALESCE(SUM(total), 0) AS volume FROM bills WHERE company_id = ? AND vendor_id = ? AND status = 'paid' AND (deleted_at IS NULL OR deleted_at = '')`).get(companyId, vendorId) as any;
  const onTimePct = billStats.total > 0 ? round2((billStats.on_time / billStats.total) * 100) : 100;
  // Dispute count subtracts from quality
  const disputes = dbi.prepare(`SELECT COUNT(*) AS n FROM vendor_disputes WHERE company_id = ? AND vendor_id = ?`).get(companyId, vendorId) as any;
  const qualityScore = Math.max(0, 100 - (disputes.n || 0) * 10);
  const compositeScore = round2((onTimePct * 0.5 + qualityScore * 0.5));
  return { score: compositeScore, on_time_payment_pct: onTimePct, quality_score: qualityScore, volume_total: round2(billStats.volume) };
}

// F538 — vendor disputes
export function openVendorDispute(d: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO vendor_disputes (id, company_id, vendor_id, bill_id, dispute_amount, reason, status, opened_date, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`)
    .run(id, d.company_id, d.vendor_id, d.bill_id, d.dispute_amount || 0, d.reason, d.opened_date || today(), d.notes, now());
  return { id };
}

export function resolveVendorDispute(id: string, resolutionAmount: number, notes?: string): boolean {
  const r = db.getDb().prepare(`UPDATE vendor_disputes SET status = 'resolved', resolved_date = ?, resolution_amount = ?, notes = ? WHERE id = ?`).run(today(), resolutionAmount, notes, id);
  return r.changes > 0;
}

export function listVendorDisputes(companyId: string, opts?: { vendor_id?: string; status?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.vendor_id) { where += ' AND vendor_id = ?'; params.push(opts.vendor_id); }
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  return dbi.prepare(`SELECT * FROM vendor_disputes WHERE ${where} ORDER BY opened_date DESC`).all(...params) as any[];
}
