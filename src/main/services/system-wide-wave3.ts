// ─── System-Wide Wave 3: 50 features (SW101–SW150) ───────
// Taxes, Purchase Orders, KPI, Stripe, Companies, Advanced Reports

import { randomUUID as uuid } from 'crypto';
import * as db from '../database';
const round2 = (n: number) => Math.round((n || 0) * 100) / 100;

// ═══ SW101–SW110: Tax & Compliance ═══════════════════════
export function taxDashboard(cid: string) {
  const dbi = db.getDb();
  const ytdTaxPaid = (dbi.prepare(`SELECT COALESCE(SUM(amount),0) t FROM tax_payments WHERE company_id = ? AND strftime('%Y', date) = strftime('%Y', 'now')`).get(cid) as any)?.t || 0;
  const pendingPayments = (dbi.prepare(`SELECT COUNT(*) c FROM tax_payments WHERE company_id = ? AND status = 'pending'`).get(cid) as any)?.c || 0;
  return { ytdTaxPaid: round2(ytdTaxPaid), pendingPayments };
}
export function taxPaymentHistory(cid: string) {
  return db.getDb().prepare(`SELECT * FROM tax_payments WHERE company_id = ? ORDER BY date DESC LIMIT 30`).all(cid);
}
export function taxCategorySummary(cid: string) {
  // Roll expenses up to their tax category via categories.tax_category_id.
  // (Previously joined expenses.category_id = tax_categories.id, which never
  // matched, and selected a non-existent tc.rate column.)
  return db.getDb().prepare(
    `SELECT tc.name, tc.schedule_c_line, tc.is_deductible,
            COUNT(DISTINCT e.id) AS expense_count,
            ROUND(COALESCE(SUM(e.amount), 0), 2) AS total
     FROM tax_categories tc
     LEFT JOIN categories c ON c.tax_category_id = tc.id AND c.company_id = tc.company_id
     LEFT JOIN expenses e ON e.category_id = c.id AND e.deleted_at IS NULL
     WHERE tc.company_id = ?
     GROUP BY tc.id ORDER BY total DESC, tc.name`
  ).all(cid);
}
export function salesTaxLiability(cid: string) {
  return db.getDb().prepare(`SELECT COALESCE(SUM(tax_amount),0) AS collected_tax, COALESCE((SELECT SUM(amount) FROM tax_payments WHERE company_id = ? AND strftime('%Y', date) = strftime('%Y', 'now') AND payment_type = 'sales_tax'),0) AS remitted, COALESCE(SUM(tax_amount),0) - COALESCE((SELECT SUM(amount) FROM tax_payments WHERE company_id = ? AND strftime('%Y', date) = strftime('%Y', 'now') AND payment_type = 'sales_tax'),0) AS outstanding FROM invoices WHERE company_id = ? AND strftime('%Y', issue_date) = strftime('%Y', 'now')`).get(cid, cid, cid);
}
export function deductibleExpensesSummary(cid: string, year?: number) {
  const y = year || new Date().getFullYear();
  // Roll deductible expenses up by Schedule C line when the category is mapped
  // to a tax category; otherwise fall back to the raw category name.
  return db.getDb().prepare(
    `SELECT COALESCE(NULLIF(tc.schedule_c_line, ''), c.name, 'Uncategorized') AS category,
            tc.schedule_c_line AS schedule_c_line,
            tc.name AS tax_category,
            ROUND(SUM(e.amount), 2) AS total
     FROM expenses e
     LEFT JOIN categories c ON c.id = e.category_id
     LEFT JOIN tax_categories tc ON tc.id = c.tax_category_id
     WHERE e.company_id = ? AND e.tax_deductible = 1
       AND strftime('%Y', e.date) = ? AND e.deleted_at IS NULL
     GROUP BY COALESCE(NULLIF(tc.schedule_c_line, ''), c.name, 'Uncategorized')
     ORDER BY total DESC`
  ).all(cid, String(y));
}
export function estimatedTaxQuarterly(cid: string) {
  const dbi = db.getDb();
  const ytdIncome = (dbi.prepare(`SELECT COALESCE(SUM(amount_paid),0) t FROM invoices WHERE company_id = ? AND strftime('%Y', issue_date) = strftime('%Y', 'now')`).get(cid) as any)?.t || 0;
  const ytdExpenses = (dbi.prepare(`SELECT COALESCE(SUM(amount),0) t FROM expenses WHERE company_id = ? AND strftime('%Y', date) = strftime('%Y', 'now') AND deleted_at IS NULL`).get(cid) as any)?.t || 0;
  const taxableIncome = ytdIncome - ytdExpenses;
  const estimatedRate = 0.25; // simplified
  return { ytdIncome: round2(ytdIncome), ytdExpenses: round2(ytdExpenses), taxableIncome: round2(taxableIncome), estimatedAnnualTax: round2(taxableIncome * estimatedRate), quarterlyEstimate: round2(taxableIncome * estimatedRate / 4) };
}
export function form1099Summary(cid: string, year?: number) {
  const y = year || new Date().getFullYear();
  return db.getDb().prepare(`SELECT v.id, v.name, v.tax_id_last4, ROUND(SUM(e.amount),2) AS total_paid FROM expenses e JOIN vendors v ON v.id = e.vendor_id WHERE e.company_id = ? AND strftime('%Y', e.date) = ? AND e.deleted_at IS NULL AND v.is_1099_eligible = 1 GROUP BY v.id HAVING total_paid >= 600 ORDER BY total_paid DESC`).all(cid, String(y));
}
export function payrollTaxSummaryYTD(cid: string) {
  return db.getDb().prepare(`SELECT ROUND(SUM(COALESCE(federal_tax,0)),2) AS federal, ROUND(SUM(COALESCE(social_security_tax,0)),2) AS social_security, ROUND(SUM(COALESCE(medicare_tax,0)),2) AS medicare, ROUND(SUM(COALESCE(state_tax,0)),2) AS state, ROUND(SUM(COALESCE(total_taxes,0)),2) AS total FROM pay_stubs WHERE company_id = ? AND strftime('%Y', pay_date) = strftime('%Y', 'now')`).get(cid);
}
export function taxCalendar(cid: string) {
  const y = new Date().getFullYear();
  return [
    { date: `${y}-01-31`, title: 'W-2/1099 filing deadline', type: 'federal' },
    { date: `${y}-03-15`, title: 'S-Corp/Partnership tax return due', type: 'federal' },
    { date: `${y}-04-15`, title: 'Individual/C-Corp tax return due + Q1 estimated', type: 'federal' },
    { date: `${y}-06-15`, title: 'Q2 estimated tax payment', type: 'federal' },
    { date: `${y}-09-15`, title: 'Q3 estimated tax payment', type: 'federal' },
    { date: `${y}-10-15`, title: 'Extended return deadline', type: 'federal' },
    { date: `${y+1}-01-15`, title: 'Q4 estimated tax payment', type: 'federal' },
  ];
}
export function taxRateLookup(state?: string) {
  // Simplified federal + state rates
  const federal = { marginal_rate: 0.22, self_employment: 0.153, standard_deduction: 14600 };
  const stateRates: Record<string, number> = { UT: 0.0465, CA: 0.093, TX: 0, FL: 0, NY: 0.0685 };
  return { federal, stateRate: state ? (stateRates[state.toUpperCase()] ?? 0.05) : null, state };
}

// ═══ SW111–SW120: Purchase Orders ════════════════════════
export function purchaseOrderDashboard(cid: string) {
  const dbi = db.getDb();
  const open = dbi.prepare(`SELECT COUNT(*) c, COALESCE(SUM(total),0) t FROM purchase_orders WHERE company_id = ? AND status IN ('draft','sent','partial')`).get(cid) as any;
  const received = (dbi.prepare(`SELECT COUNT(*) c FROM purchase_orders WHERE company_id = ? AND status = 'received' AND substr(created_at,1,7) = substr(date('now'),1,7)`).get(cid) as any)?.c || 0;
  return { openPOs: open?.c || 0, openTotal: round2(open?.t || 0), receivedThisMonth: received };
}
export function poByVendor(cid: string) {
  return db.getDb().prepare(`SELECT v.name, COUNT(po.id) AS po_count, ROUND(SUM(po.total),2) AS total FROM purchase_orders po LEFT JOIN vendors v ON v.id = po.vendor_id WHERE po.company_id = ? GROUP BY v.id ORDER BY total DESC`).all(cid);
}
export function poByStatus(cid: string) {
  return db.getDb().prepare(`SELECT status, COUNT(*) AS count, ROUND(SUM(total),2) AS total FROM purchase_orders WHERE company_id = ? GROUP BY status ORDER BY count DESC`).all(cid);
}
export function overduePOs(cid: string) {
  return db.getDb().prepare(`SELECT po.*, v.name AS vendor_name FROM purchase_orders po LEFT JOIN vendors v ON v.id = po.vendor_id WHERE po.company_id = ? AND po.status IN ('sent','partial') AND po.expected_date < date('now') ORDER BY po.expected_date`).all(cid);
}
export function poSearch(cid: string, query: string) {
  const q = `%${query.toLowerCase()}%`;
  return db.getDb().prepare(`SELECT po.*, v.name AS vendor_name FROM purchase_orders po LEFT JOIN vendors v ON v.id = po.vendor_id WHERE po.company_id = ? AND (lower(po.po_number) LIKE ? OR lower(v.name) LIKE ?) ORDER BY po.created_at DESC LIMIT 30`).all(cid, q, q);
}
export function poMonthlyTrend(cid: string) {
  return db.getDb().prepare(`SELECT substr(created_at,1,7) AS month, COUNT(*) AS count, ROUND(SUM(total),2) AS total FROM purchase_orders WHERE company_id = ? AND created_at >= date('now','-12 months') GROUP BY month ORDER BY month`).all(cid);
}
export function poLineItems(poId: string) {
  return db.getDb().prepare(`SELECT * FROM po_line_items WHERE purchase_order_id = ? ORDER BY sort_order`).all(poId);
}
export function poReceivingHistory(cid: string) {
  return db.getDb().prepare(`SELECT po.po_number, v.name AS vendor_name, po.total, po.status, po.received_date FROM purchase_orders po LEFT JOIN vendors v ON v.id = po.vendor_id WHERE po.company_id = ? AND po.status = 'received' ORDER BY po.received_date DESC LIMIT 20`).all(cid);
}
export function convertPOToBill(poId: string) {
  const po = db.getDb().prepare('SELECT * FROM purchase_orders WHERE id = ?').get(poId) as any;
  if (!po) return { error: 'PO not found' };
  return { vendor_id: po.vendor_id, total: po.total, description: `Bill from PO ${po.po_number}`, po_number: po.po_number, note: 'Create a bill in Bills (AP) from this PO data' };
}
export function poApprovalStatus(cid: string) {
  return db.getDb().prepare(`SELECT status, COUNT(*) AS count FROM purchase_orders WHERE company_id = ? AND status IN ('draft','pending_approval','approved') GROUP BY status`).all(cid);
}

// ═══ SW121–SW130: KPI & Dashboard ════════════════════════
export function kpiOverview(cid: string) {
  const dbi = db.getDb();
  const revenue = (dbi.prepare(`SELECT COALESCE(SUM(amount_paid),0) t FROM invoices WHERE company_id = ? AND strftime('%Y-%m', issue_date) = strftime('%Y-%m', 'now')`).get(cid) as any)?.t || 0;
  const expenses = (dbi.prepare(`SELECT COALESCE(SUM(amount),0) t FROM expenses WHERE company_id = ? AND strftime('%Y-%m', date) = strftime('%Y-%m', 'now') AND deleted_at IS NULL`).get(cid) as any)?.t || 0;
  const ar = (dbi.prepare(`SELECT COALESCE(SUM(total - COALESCE(amount_paid,0)),0) t FROM invoices WHERE company_id = ? AND status IN ('sent','partial','overdue')`).get(cid) as any)?.t || 0;
  const ap = (dbi.prepare(`SELECT COALESCE(SUM(total - COALESCE(amount_paid,0)),0) t FROM bills WHERE company_id = ? AND status IN ('pending','received','approved','partial')`).get(cid) as any)?.t || 0;
  const cashBalance = (dbi.prepare(`SELECT COALESCE(SUM(current_balance),0) t FROM bank_accounts WHERE company_id = ?`).get(cid) as any)?.t || 0;
  return { mtdRevenue: round2(revenue), mtdExpenses: round2(expenses), netIncome: round2(revenue - expenses), outstandingAR: round2(ar), outstandingAP: round2(ap), cashBalance: round2(cashBalance), currentRatio: ap > 0 ? round2((cashBalance + ar) / ap) : 0 };
}
export function revenueVsExpenseTrend(cid: string, months = 12) {
  const results: any[] = [];
  const dbi = db.getDb();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const rev = (dbi.prepare(`SELECT COALESCE(SUM(amount_paid),0) t FROM invoices WHERE company_id = ? AND strftime('%Y-%m', issue_date) = ?`).get(cid, ym) as any)?.t || 0;
    const exp = (dbi.prepare(`SELECT COALESCE(SUM(amount),0) t FROM expenses WHERE company_id = ? AND strftime('%Y-%m', date) = ? AND deleted_at IS NULL`).get(cid, ym) as any)?.t || 0;
    results.push({ month: ym, revenue: round2(rev), expenses: round2(exp), net: round2(rev - exp) });
  }
  return results;
}
export function profitMarginTrend(cid: string) {
  const trend = revenueVsExpenseTrend(cid, 12) as any[];
  return trend.map(m => ({ ...m, margin: m.revenue > 0 ? round2((m.net / m.revenue) * 100) : 0 }));
}
export function operatingMetrics(cid: string) {
  const dbi = db.getDb();
  const employees = (dbi.prepare(`SELECT COUNT(*) c FROM employees WHERE company_id = ? AND status = 'active'`).get(cid) as any)?.c || 0;
  const ytdRev = (dbi.prepare(`SELECT COALESCE(SUM(amount_paid),0) t FROM invoices WHERE company_id = ? AND strftime('%Y', issue_date) = strftime('%Y', 'now')`).get(cid) as any)?.t || 0;
  return { employees, revenuePerEmployee: employees > 0 ? round2(ytdRev / employees) : 0, ytdRevenue: round2(ytdRev) };
}
export function quickRatios(cid: string) {
  const dbi = db.getDb();
  const cash = (dbi.prepare(`SELECT COALESCE(SUM(current_balance),0) t FROM bank_accounts WHERE company_id = ?`).get(cid) as any)?.t || 0;
  const ar = (dbi.prepare(`SELECT COALESCE(SUM(total - COALESCE(amount_paid,0)),0) t FROM invoices WHERE company_id = ? AND status IN ('sent','partial','overdue')`).get(cid) as any)?.t || 0;
  const ap = (dbi.prepare(`SELECT COALESCE(SUM(total - COALESCE(amount_paid,0)),0) t FROM bills WHERE company_id = ? AND status IN ('pending','received','approved','partial')`).get(cid) as any)?.t || 0;
  const inventory = (dbi.prepare(`SELECT COALESCE(SUM(quantity * unit_cost),0) t FROM inventory_items WHERE company_id = ?`).get(cid) as any)?.t || 0;
  return { cashRatio: ap > 0 ? round2(cash / ap) : 0, quickRatio: ap > 0 ? round2((cash + ar) / ap) : 0, currentRatio: ap > 0 ? round2((cash + ar + inventory) / ap) : 0, workingCapital: round2(cash + ar + inventory - ap) };
}
export function monthOverMonthGrowth(cid: string) {
  const dbi = db.getDb();
  const thisMonth = (dbi.prepare(`SELECT COALESCE(SUM(amount_paid),0) t FROM invoices WHERE company_id = ? AND strftime('%Y-%m', issue_date) = strftime('%Y-%m', 'now')`).get(cid) as any)?.t || 0;
  const lastMonth = (dbi.prepare(`SELECT COALESCE(SUM(amount_paid),0) t FROM invoices WHERE company_id = ? AND strftime('%Y-%m', issue_date) = strftime('%Y-%m', date('now','-1 month'))`).get(cid) as any)?.t || 0;
  return { thisMonth: round2(thisMonth), lastMonth: round2(lastMonth), growth: lastMonth > 0 ? round2(((thisMonth - lastMonth) / lastMonth) * 100) : 0 };
}
export function burnRate(cid: string) {
  const dbi = db.getDb();
  const cash = (dbi.prepare(`SELECT COALESCE(SUM(current_balance),0) t FROM bank_accounts WHERE company_id = ?`).get(cid) as any)?.t || 0;
  const monthlyBurn = (dbi.prepare(`SELECT ROUND(SUM(amount) / 6.0, 2) t FROM expenses WHERE company_id = ? AND date >= date('now','-6 months') AND deleted_at IS NULL`).get(cid) as any)?.t || 0;
  return { cashOnHand: round2(cash), monthlyBurn: round2(monthlyBurn), runwayMonths: monthlyBurn > 0 ? round2(cash / monthlyBurn) : 999 };
}
export function revenueByService(cid: string) {
  return db.getDb().prepare(`SELECT COALESCE(NULLIF(ili.description,''),'Other') AS service, COUNT(DISTINCT i.id) AS invoice_count, ROUND(SUM(ili.amount),2) AS total FROM invoice_line_items ili JOIN invoices i ON i.id = ili.invoice_id WHERE i.company_id = ? AND i.issue_date >= date('now','-12 months') GROUP BY service ORDER BY total DESC LIMIT 15`).all(cid);
}
export function topExpenseCategories(cid: string) {
  return db.getDb().prepare(`SELECT c.name, ROUND(SUM(e.amount),2) AS total, COUNT(*) AS count FROM expenses e LEFT JOIN categories c ON c.id = e.category_id WHERE e.company_id = ? AND e.date >= date('now','-12 months') AND e.deleted_at IS NULL GROUP BY c.name ORDER BY total DESC LIMIT 10`).all(cid);
}
export function financialSnapshot(cid: string) {
  const kpi = kpiOverview(cid);
  const ratios = quickRatios(cid);
  const br = burnRate(cid);
  return { ...kpi, ...ratios, monthlyBurn: br.monthlyBurn, runwayMonths: br.runwayMonths };
}

// ═══ SW131–SW140: Stripe & Payments ══════════════════════
export function stripeSyncSummary(cid: string) {
  const dbi = db.getDb();
  const total = (dbi.prepare(`SELECT COUNT(*) c FROM stripe_transactions WHERE company_id = ?`).get(cid) as any)?.c || 0;
  const payments = (dbi.prepare(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) t FROM stripe_transactions WHERE company_id = ? AND type = 'payment'`).get(cid) as any);
  const refunds = (dbi.prepare(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) t FROM stripe_transactions WHERE company_id = ? AND type = 'refund'`).get(cid) as any);
  const fees = (dbi.prepare(`SELECT COALESCE(SUM(fee),0) t FROM stripe_transactions WHERE company_id = ?`).get(cid) as any)?.t || 0;
  return { totalTransactions: total, paymentCount: payments?.c || 0, paymentTotal: round2(payments?.t || 0), refundCount: refunds?.c || 0, refundTotal: round2(refunds?.t || 0), totalFees: round2(fees) };
}
export function stripeRecentTransactions(cid: string, limit = 20) {
  return db.getDb().prepare(`SELECT * FROM stripe_transactions WHERE company_id = ? ORDER BY created_at DESC LIMIT ?`).all(cid, limit);
}
export function stripeMonthlyTrend(cid: string) {
  return db.getDb().prepare(`SELECT strftime('%Y-%m', created_at) AS month, SUM(CASE WHEN type='payment' THEN amount ELSE 0 END) AS payments, SUM(CASE WHEN type='refund' THEN amount ELSE 0 END) AS refunds, SUM(fee) AS fees FROM stripe_transactions WHERE company_id = ? AND created_at >= date('now','-12 months') GROUP BY month ORDER BY month`).all(cid);
}
export function stripeFeeSummary(cid: string) {
  return db.getDb().prepare(`SELECT strftime('%Y-%m', created_at) AS month, ROUND(SUM(fee),2) AS total_fees, ROUND(SUM(net),2) AS total_net, ROUND(SUM(amount),2) AS total_gross FROM stripe_transactions WHERE company_id = ? AND type = 'payment' GROUP BY month ORDER BY month DESC LIMIT 12`).all(cid);
}
export function unmatchedStripeTransactions(cid: string) {
  return db.getDb().prepare(`SELECT * FROM stripe_transactions WHERE company_id = ? AND invoice_id IS NULL AND type = 'payment' ORDER BY created_at DESC LIMIT 30`).all(cid);
}
export function paymentMethodStats(cid: string) {
  return db.getDb().prepare(`SELECT COALESCE(NULLIF(payment_method,''),'other') AS method, COUNT(*) AS count, ROUND(SUM(amount),2) AS total FROM payments WHERE company_id = ? GROUP BY method ORDER BY total DESC`).all(cid);
}
export function averagePaymentSize(cid: string) {
  return db.getDb().prepare(`SELECT ROUND(AVG(amount),2) AS avg_payment, ROUND(MIN(amount),2) AS min_payment, ROUND(MAX(amount),2) AS max_payment, COUNT(*) AS total_payments FROM payments WHERE company_id = ? AND date >= date('now','-12 months')`).get(cid);
}
export function paymentsByMonth(cid: string) {
  return db.getDb().prepare(`SELECT strftime('%Y-%m', date) AS month, COUNT(*) AS count, ROUND(SUM(amount),2) AS total FROM payments WHERE company_id = ? AND date >= date('now','-12 months') GROUP BY month ORDER BY month`).all(cid);
}
export function overduePayments(cid: string) {
  return db.getDb().prepare(`SELECT i.id, i.invoice_number, i.total, i.amount_paid, ROUND(i.total - COALESCE(i.amount_paid,0),2) AS balance, i.due_date, c.name AS client_name, CAST(julianday('now') - julianday(i.due_date) AS INTEGER) AS days_overdue FROM invoices i LEFT JOIN clients c ON c.id = i.client_id WHERE i.company_id = ? AND i.status IN ('sent','partial','overdue') AND i.due_date < date('now') ORDER BY days_overdue DESC`).all(cid);
}
export function paymentForecast(cid: string, weeks = 4) {
  const results: any[] = [];
  for (let i = 0; i < weeks; i++) {
    const d = new Date(); d.setDate(d.getDate() + i * 7);
    const start = d.toISOString().slice(0, 10); d.setDate(d.getDate() + 6);
    const end = d.toISOString().slice(0, 10);
    const r = db.getDb().prepare(`SELECT COALESCE(SUM(total - COALESCE(amount_paid,0)),0) t FROM invoices WHERE company_id = ? AND due_date >= ? AND due_date <= ? AND status IN ('sent','partial')`).get(cid, start, end) as any;
    results.push({ week: i + 1, start, end, expectedCollections: round2(r?.t || 0) });
  }
  return results;
}

// ═══ SW141–SW150: Company & Advanced ═════════════════════
export function companyDashboard(cid: string) {
  const kpi = kpiOverview(cid);
  const dbi = db.getDb();
  const employees = (dbi.prepare(`SELECT COUNT(*) c FROM employees WHERE company_id = ? AND status = 'active'`).get(cid) as any)?.c || 0;
  const clients = (dbi.prepare(`SELECT COUNT(*) c FROM clients WHERE company_id = ? AND deleted_at IS NULL`).get(cid) as any)?.c || 0;
  const vendors = (dbi.prepare(`SELECT COUNT(*) c FROM vendors WHERE company_id = ? AND deleted_at IS NULL`).get(cid) as any)?.c || 0;
  const loans = (dbi.prepare(`SELECT COUNT(*) c FROM loans WHERE company_id = ? AND status = 'active' AND deleted_at IS NULL`).get(cid) as any)?.c || 0;
  return { ...kpi, activeEmployees: employees, activeClients: clients, activeVendors: vendors, activeLoans: loans };
}
export function companyGrowthMetrics(cid: string) {
  const dbi = db.getDb();
  const metrics: any[] = [];
  for (let y = new Date().getFullYear() - 2; y <= new Date().getFullYear(); y++) {
    const rev = (dbi.prepare(`SELECT COALESCE(SUM(amount_paid),0) t FROM invoices WHERE company_id = ? AND strftime('%Y', issue_date) = ?`).get(cid, String(y)) as any)?.t || 0;
    const exp = (dbi.prepare(`SELECT COALESCE(SUM(amount),0) t FROM expenses WHERE company_id = ? AND strftime('%Y', date) = ? AND deleted_at IS NULL`).get(cid, String(y)) as any)?.t || 0;
    const clients = (dbi.prepare(`SELECT COUNT(*) c FROM clients WHERE company_id = ? AND strftime('%Y', created_at) = ?`).get(cid, String(y)) as any)?.c || 0;
    metrics.push({ year: y, revenue: round2(rev), expenses: round2(exp), netIncome: round2(rev - exp), newClients: clients });
  }
  return metrics;
}
export function companyComparison(cid: string) {
  const dbi = db.getDb();
  const companies = dbi.prepare(`SELECT id, name FROM companies ORDER BY name`).all() as any[];
  return companies.map((c: any) => {
    const rev = (dbi.prepare(`SELECT COALESCE(SUM(amount_paid),0) t FROM invoices WHERE company_id = ? AND strftime('%Y', issue_date) = strftime('%Y', 'now')`).get(c.id) as any)?.t || 0;
    const exp = (dbi.prepare(`SELECT COALESCE(SUM(amount),0) t FROM expenses WHERE company_id = ? AND strftime('%Y', date) = strftime('%Y', 'now') AND deleted_at IS NULL`).get(c.id) as any)?.t || 0;
    return { id: c.id, name: c.name, ytdRevenue: round2(rev), ytdExpenses: round2(exp), netIncome: round2(rev - exp) };
  });
}
export function recurringRevenueSummary(cid: string) {
  const r = db.getDb().prepare(`SELECT COUNT(*) c, COALESCE(SUM(total),0) t FROM invoices WHERE company_id = ? AND is_recurring = 1 AND strftime('%Y', issue_date) = strftime('%Y', 'now')`).get(cid) as any;
  return { recurringInvoices: r?.c || 0, recurringRevenue: round2(r?.t || 0) };
}
export function customerLifetimeValue(cid: string) {
  return db.getDb().prepare(`SELECT c.id, c.name, ROUND(SUM(i.amount_paid),2) AS ltv, COUNT(i.id) AS invoice_count, MIN(i.issue_date) AS first_invoice, MAX(i.issue_date) AS last_invoice, ROUND(julianday(MAX(i.issue_date)) - julianday(MIN(i.issue_date)),0) AS relationship_days FROM clients c JOIN invoices i ON i.client_id = c.id WHERE c.company_id = ? AND i.status IN ('paid','partial') GROUP BY c.id ORDER BY ltv DESC LIMIT 20`).all(cid);
}
export function vendorDependencyAnalysis(cid: string) {
  return db.getDb().prepare(`SELECT v.id, v.name, COUNT(e.id) AS transaction_count, ROUND(SUM(e.amount),2) AS total_spend, ROUND(SUM(e.amount) / NULLIF((SELECT SUM(amount) FROM expenses WHERE company_id = ? AND deleted_at IS NULL),0) * 100, 1) AS pct_of_total_spend FROM vendors v JOIN expenses e ON e.vendor_id = v.id WHERE v.company_id = ? AND e.deleted_at IS NULL GROUP BY v.id ORDER BY total_spend DESC LIMIT 15`).all(cid, cid);
}
export function profitByMonth(cid: string) {
  return revenueVsExpenseTrend(cid, 12);
}
export function annualSummary(cid: string, year?: number) {
  const y = year || new Date().getFullYear();
  const dbi = db.getDb();
  const rev = (dbi.prepare(`SELECT COALESCE(SUM(amount_paid),0) t FROM invoices WHERE company_id = ? AND strftime('%Y', issue_date) = ?`).get(cid, String(y)) as any)?.t || 0;
  const exp = (dbi.prepare(`SELECT COALESCE(SUM(amount),0) t FROM expenses WHERE company_id = ? AND strftime('%Y', date) = ? AND deleted_at IS NULL`).get(cid, String(y)) as any)?.t || 0;
  const invoiceCount = (dbi.prepare(`SELECT COUNT(*) c FROM invoices WHERE company_id = ? AND strftime('%Y', issue_date) = ?`).get(cid, String(y)) as any)?.c || 0;
  const expenseCount = (dbi.prepare(`SELECT COUNT(*) c FROM expenses WHERE company_id = ? AND strftime('%Y', date) = ? AND deleted_at IS NULL`).get(cid, String(y)) as any)?.c || 0;
  const newClients = (dbi.prepare(`SELECT COUNT(*) c FROM clients WHERE company_id = ? AND strftime('%Y', created_at) = ?`).get(cid, String(y)) as any)?.c || 0;
  return { year: y, revenue: round2(rev), expenses: round2(exp), netIncome: round2(rev - exp), profitMargin: rev > 0 ? round2(((rev - exp) / rev) * 100) : 0, invoicesSent: invoiceCount, expensesRecorded: expenseCount, newClients };
}
export function systemUsageStats(cid: string) {
  const dbi = db.getDb();
  const actions7d = (dbi.prepare(`SELECT COUNT(*) c FROM audit_log WHERE company_id = ? AND created_at >= date('now','-7 days')`).get(cid) as any)?.c || 0;
  const actions30d = (dbi.prepare(`SELECT COUNT(*) c FROM audit_log WHERE company_id = ? AND created_at >= date('now','-30 days')`).get(cid) as any)?.c || 0;
  const topActions = dbi.prepare(`SELECT action, entity_type, COUNT(*) AS count FROM audit_log WHERE company_id = ? AND created_at >= date('now','-7 days') GROUP BY action, entity_type ORDER BY count DESC LIMIT 10`).all(cid);
  return { actionsLast7Days: actions7d, actionsLast30Days: actions30d, topActions };
}
export function fullSystemReport(cid: string) {
  return {
    company: companyDashboard(cid),
    financial: financialSnapshot(cid),
    growth: companyGrowthMetrics(cid),
    burn: burnRate(cid),
  };
}
