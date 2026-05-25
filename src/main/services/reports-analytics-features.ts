// src/main/services/reports-analytics-features.ts
//
// Batch 4 — Reports & Analytics features (F51-F60).

import * as db from '../database';
import { v4 as uuid } from 'uuid';

const round2 = (n: number): number => Math.round(n * 100) / 100;

// ── F51: Period-over-period comparison ────────────────────────

export function periodOverPeriod(companyId: string, opts: { metric: 'revenue' | 'expenses' | 'profit' | 'invoice_count' | 'expense_count'; current_start: string; current_end: string; comparison_period: 'prior_period' | 'prior_year' }): { current: number; previous: number; change: number; pct_change: number; current_range: string; previous_range: string } {
  const dbi = db.getDb();
  const cs = new Date(opts.current_start + 'T00:00:00');
  const ce = new Date(opts.current_end + 'T00:00:00');
  const days = Math.round((ce.getTime() - cs.getTime()) / 86400000) + 1;
  let prevStart: Date, prevEnd: Date;
  if (opts.comparison_period === 'prior_year') {
    prevStart = new Date(cs); prevStart.setFullYear(prevStart.getFullYear() - 1);
    prevEnd = new Date(ce); prevEnd.setFullYear(prevEnd.getFullYear() - 1);
  } else {
    prevEnd = new Date(cs); prevEnd.setDate(prevEnd.getDate() - 1);
    prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - days + 1);
  }
  const pStartStr = prevStart.toISOString().slice(0, 10);
  const pEndStr = prevEnd.toISOString().slice(0, 10);
  const calc = (start: string, end: string): number => {
    let v = 0;
    try {
      if (opts.metric === 'revenue' || opts.metric === 'invoice_count') {
        const r = dbi.prepare(`SELECT ${opts.metric === 'revenue' ? 'COALESCE(SUM(total), 0)' : 'COUNT(*)'} AS v FROM invoices WHERE company_id = ? AND issue_date BETWEEN ? AND ? AND status NOT IN ('voided','cancelled','draft') AND COALESCE(deleted_at, '') = ''`).get(companyId, start, end) as any;
        v = r?.v || 0;
      } else if (opts.metric === 'expenses' || opts.metric === 'expense_count') {
        const r = dbi.prepare(`SELECT ${opts.metric === 'expenses' ? 'COALESCE(SUM(amount), 0)' : 'COUNT(*)'} AS v FROM expenses WHERE company_id = ? AND date BETWEEN ? AND ? AND COALESCE(deleted_at, '') = ''`).get(companyId, start, end) as any;
        v = r?.v || 0;
      } else if (opts.metric === 'profit') {
        const inv = dbi.prepare(`SELECT COALESCE(SUM(total), 0) AS v FROM invoices WHERE company_id = ? AND issue_date BETWEEN ? AND ? AND status NOT IN ('voided','cancelled','draft') AND COALESCE(deleted_at, '') = ''`).get(companyId, start, end) as any;
        const exp = dbi.prepare(`SELECT COALESCE(SUM(amount), 0) AS v FROM expenses WHERE company_id = ? AND date BETWEEN ? AND ? AND COALESCE(deleted_at, '') = ''`).get(companyId, start, end) as any;
        v = (inv?.v || 0) - (exp?.v || 0);
      }
    } catch { /* */ }
    return v;
  };
  const current = round2(calc(opts.current_start, opts.current_end));
  const previous = round2(calc(pStartStr, pEndStr));
  const change = round2(current - previous);
  const pctChange = previous !== 0 ? round2((change / Math.abs(previous)) * 100) : 0;
  return { current, previous, change, pct_change: pctChange, current_range: `${opts.current_start} → ${opts.current_end}`, previous_range: `${pStartStr} → ${pEndStr}` };
}

// ── F52: Top 10 customers by revenue ──────────────────────────

export function topCustomers(companyId: string, opts: { start_date: string; end_date: string; limit?: number; by?: 'revenue' | 'invoice_count' }): any[] {
  const dbi = db.getDb();
  const limit = Math.min(50, opts.limit || 10);
  const orderBy = opts.by === 'invoice_count' ? 'invoice_count' : 'revenue';
  return dbi.prepare(`
    SELECT i.client_id, c.name AS client_name, c.email AS client_email,
      COUNT(i.id) AS invoice_count,
      COALESCE(SUM(i.total), 0) AS revenue,
      COALESCE(SUM(COALESCE(i.amount_paid, 0)), 0) AS paid,
      MAX(i.issue_date) AS last_invoice_date
    FROM invoices i
    LEFT JOIN clients c ON c.id = i.client_id
    WHERE i.company_id = ?
      AND i.issue_date BETWEEN ? AND ?
      AND i.status NOT IN ('voided','cancelled','draft')
      AND COALESCE(i.deleted_at, '') = ''
    GROUP BY i.client_id, c.name, c.email
    ORDER BY ${orderBy} DESC
    LIMIT ?
  `).all(companyId, opts.start_date, opts.end_date, limit) as any[];
}

// ── F53: Customer lifetime value ──────────────────────────────

export function customerLifetimeValue(companyId: string, clientId?: string): any {
  const dbi = db.getDb();
  if (clientId) {
    const r = dbi.prepare(`
      SELECT
        COUNT(id) AS total_invoices,
        COALESCE(SUM(total), 0) AS total_revenue,
        COALESCE(SUM(COALESCE(amount_paid, 0)), 0) AS total_collected,
        MIN(issue_date) AS first_invoice,
        MAX(issue_date) AS last_invoice
      FROM invoices
      WHERE company_id = ? AND client_id = ? AND status NOT IN ('voided','cancelled','draft') AND COALESCE(deleted_at, '') = ''
    `).get(companyId, clientId) as any;
    let monthsActive = 0;
    if (r?.first_invoice && r?.last_invoice) {
      const f = new Date(r.first_invoice + 'T00:00:00'), l = new Date(r.last_invoice + 'T00:00:00');
      monthsActive = Math.max(1, Math.round((l.getTime() - f.getTime()) / (30 * 86400000)));
    }
    return { client_id: clientId, total_revenue: round2(r?.total_revenue || 0), total_collected: round2(r?.total_collected || 0), invoice_count: r?.total_invoices || 0, first_invoice: r?.first_invoice, last_invoice: r?.last_invoice, months_active: monthsActive, avg_monthly_revenue: monthsActive > 0 ? round2((r?.total_revenue || 0) / monthsActive) : 0 };
  }
  // All clients
  return dbi.prepare(`
    SELECT c.id AS client_id, c.name AS client_name,
      COALESCE(SUM(i.total), 0) AS total_revenue,
      COUNT(i.id) AS invoice_count,
      MIN(i.issue_date) AS first_invoice,
      MAX(i.issue_date) AS last_invoice
    FROM clients c
    LEFT JOIN invoices i ON i.client_id = c.id AND i.status NOT IN ('voided','cancelled','draft') AND COALESCE(i.deleted_at, '') = ''
    WHERE c.company_id = ? AND COALESCE(c.deleted_at, '') = ''
    GROUP BY c.id, c.name
    ORDER BY total_revenue DESC
  `).all(companyId) as any[];
}

// ── F54: Customer churn prediction ────────────────────────────

export function predictChurn(companyId: string, opts?: { lookback_days?: number; gap_threshold_days?: number }): any[] {
  const dbi = db.getDb();
  const lookback = opts?.lookback_days || 365;
  const gapThreshold = opts?.gap_threshold_days || 90;
  const today = new Date(); const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - lookback);
  const rows = dbi.prepare(`
    SELECT c.id AS client_id, c.name AS client_name, c.email,
      MAX(i.issue_date) AS last_invoice,
      COUNT(i.id) AS invoice_count,
      COALESCE(SUM(i.total), 0) AS total_revenue
    FROM clients c
    LEFT JOIN invoices i ON i.client_id = c.id AND i.issue_date >= ? AND i.status NOT IN ('voided','cancelled','draft')
    WHERE c.company_id = ? AND COALESCE(c.deleted_at, '') = ''
    GROUP BY c.id, c.name, c.email
    HAVING COUNT(i.id) > 0
  `).all(cutoff.toISOString().slice(0, 10), companyId) as any[];
  const todayStr = today.toISOString().slice(0, 10);
  return rows.map((r) => {
    const lastDate = r.last_invoice ? new Date(r.last_invoice + 'T00:00:00') : null;
    const daysSinceLast = lastDate ? Math.round((today.getTime() - lastDate.getTime()) / 86400000) : 999;
    let churnRisk = 'low';
    let riskScore = 0;
    if (daysSinceLast > gapThreshold * 2) { churnRisk = 'high'; riskScore = 80 + Math.min(20, Math.floor(daysSinceLast / 30)); }
    else if (daysSinceLast > gapThreshold) { churnRisk = 'medium'; riskScore = 40 + Math.floor((daysSinceLast - gapThreshold) / 7); }
    else { churnRisk = 'low'; riskScore = Math.max(0, 20 - Math.floor((gapThreshold - daysSinceLast) / 7)); }
    return { ...r, days_since_last: daysSinceLast, churn_risk: churnRisk, risk_score: riskScore, as_of: todayStr };
  }).sort((a, b) => b.risk_score - a.risk_score);
}

// ── F55: Profit margin by service/product ─────────────────────

export function profitMarginByService(companyId: string, opts: { start_date: string; end_date: string }): any[] {
  const dbi = db.getDb();
  try {
    return dbi.prepare(`
      SELECT li.description AS service,
        COUNT(li.id) AS line_count,
        COALESCE(SUM(li.quantity * li.unit_price), 0) AS revenue,
        AVG(li.unit_price) AS avg_price
      FROM invoice_line_items li
      JOIN invoices i ON i.id = li.invoice_id
      WHERE i.company_id = ?
        AND i.issue_date BETWEEN ? AND ?
        AND i.status NOT IN ('voided','cancelled','draft')
        AND COALESCE(i.deleted_at, '') = ''
        AND COALESCE(li.row_type, 'item') = 'item'
      GROUP BY li.description
      ORDER BY revenue DESC
    `).all(companyId, opts.start_date, opts.end_date) as any[];
  } catch { return []; }
}

// ── F56: Department / cost-center P&L ─────────────────────────

export function departmentPnL(companyId: string, opts: { start_date: string; end_date: string }): any[] {
  const dbi = db.getDb();
  try {
    // Use project as the department/cost-center proxy
    return dbi.prepare(`
      SELECT p.id AS dept_id, p.name AS department,
        COALESCE(SUM(DISTINCT i.total), 0) AS revenue,
        COALESCE(SUM(DISTINCT e.amount), 0) AS expenses,
        COALESCE(SUM(DISTINCT i.total), 0) - COALESCE(SUM(DISTINCT e.amount), 0) AS profit
      FROM projects p
      LEFT JOIN invoices i ON i.project_id = p.id AND i.issue_date BETWEEN ? AND ?
      LEFT JOIN expenses e ON e.project_id = p.id AND e.date BETWEEN ? AND ?
      WHERE p.company_id = ?
      GROUP BY p.id, p.name
      ORDER BY profit DESC
    `).all(opts.start_date, opts.end_date, opts.start_date, opts.end_date, companyId) as any[];
  } catch { return []; }
}

// ── F57: Vendor spending YoY ──────────────────────────────────

export function vendorSpendingYoY(companyId: string, opts?: { years?: number }): any[] {
  const dbi = db.getDb();
  const years = opts?.years || 3;
  const currentYear = new Date().getFullYear();
  try {
    const sql = `
      SELECT v.id AS vendor_id, v.name AS vendor_name,
        strftime('%Y', e.date) AS year,
        COALESCE(SUM(e.amount), 0) AS spend
      FROM vendors v
      LEFT JOIN expenses e ON e.vendor_id = v.id AND COALESCE(e.deleted_at, '') = ''
      WHERE v.company_id = ? AND COALESCE(v.deleted_at, '') = ''
        AND CAST(strftime('%Y', e.date) AS INTEGER) >= ?
      GROUP BY v.id, v.name, strftime('%Y', e.date)
      ORDER BY v.name, year
    `;
    const rows = dbi.prepare(sql).all(companyId, currentYear - years) as any[];
    // Pivot to vendor → {year: spend}
    const byVendor: Record<string, any> = {};
    for (const r of rows) {
      if (!byVendor[r.vendor_id]) byVendor[r.vendor_id] = { vendor_id: r.vendor_id, vendor_name: r.vendor_name, by_year: {} };
      byVendor[r.vendor_id].by_year[r.year] = round2(r.spend);
    }
    return Object.values(byVendor);
  } catch { return []; }
}

// ── F58: AR aging email blast templates ───────────────────────

export const DEFAULT_COLLECTION_TEMPLATES = [
  { aging_bucket: '1-30', tone: 'friendly', subject: 'Friendly reminder: Invoice {{invoice_number}}', body: 'Hi {{client_name}},\n\nThis is a friendly reminder that invoice {{invoice_number}} for {{amount}} was due on {{due_date}}. If you\'ve already sent payment, please disregard this message. Otherwise, we\'d appreciate your prompt attention.\n\nThank you!' },
  { aging_bucket: '31-60', tone: 'friendly', subject: 'Past due: Invoice {{invoice_number}}', body: 'Hi {{client_name}},\n\nInvoice {{invoice_number}} for {{amount}} is now {{days_overdue}} days past due. Please remit payment at your earliest convenience or contact us to discuss a payment plan.\n\nThank you.' },
  { aging_bucket: '61-90', tone: 'firm', subject: 'Urgent: Past-due invoice {{invoice_number}}', body: '{{client_name}},\n\nInvoice {{invoice_number}} for {{amount}} is now {{days_overdue}} days past due. We require immediate payment to avoid escalation. Please contact us within 7 days.' },
  { aging_bucket: '90+', tone: 'final', subject: 'FINAL NOTICE: Invoice {{invoice_number}}', body: '{{client_name}},\n\nThis is our FINAL notice regarding invoice {{invoice_number}} for {{amount}}, which is {{days_overdue}} days past due. If payment is not received within 14 days, we will pursue collection through legal means.' },
];

export function upsertCollectionTemplate(t: { id?: string; company_id: string; template_name: string; aging_bucket: string; subject: string; body: string; tone?: string }): any {
  const dbi = db.getDb();
  const id = t.id || uuid();
  if (t.id) {
    dbi.prepare(`UPDATE ar_collection_templates SET template_name = ?, aging_bucket = ?, subject = ?, body = ?, tone = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(t.template_name, t.aging_bucket, t.subject, t.body, t.tone || 'friendly', id);
  } else {
    dbi.prepare(`INSERT INTO ar_collection_templates (id, company_id, template_name, aging_bucket, subject, body, tone) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, t.company_id, t.template_name, t.aging_bucket, t.subject, t.body, t.tone || 'friendly');
  }
  return dbi.prepare('SELECT * FROM ar_collection_templates WHERE id = ?').get(id);
}

export function listCollectionTemplates(companyId: string): any[] {
  return db.getDb().prepare('SELECT * FROM ar_collection_templates WHERE company_id = ? AND is_active = 1 ORDER BY aging_bucket').all(companyId) as any[];
}

export function generateCollectionEmail(template: any, invoice: any, client: any): { to: string; subject: string; body: string } {
  const today = new Date().toISOString().slice(0, 10);
  const overdueDays = invoice.due_date ? Math.max(0, Math.round((new Date(today).getTime() - new Date(invoice.due_date).getTime()) / 86400000)) : 0;
  const substitute = (s: string) => s
    .replace(/\{\{client_name\}\}/g, client.name || '')
    .replace(/\{\{invoice_number\}\}/g, invoice.invoice_number || '')
    .replace(/\{\{amount\}\}/g, `$${(invoice.balance_due || invoice.total || 0).toFixed(2)}`)
    .replace(/\{\{due_date\}\}/g, invoice.due_date || '')
    .replace(/\{\{days_overdue\}\}/g, String(overdueDays));
  return { to: client.email || '', subject: substitute(template.subject), body: substitute(template.body) };
}

// ── F59: Year-end tax summary auto-gen ────────────────────────

export function yearEndTaxSummary(companyId: string, year: number): any {
  const dbi = db.getDb();
  const start = `${year}-01-01`, end = `${year}-12-31`;
  let revenue = 0, expenses = 0, payroll = 0, taxes_paid = 0;
  try {
    revenue = (dbi.prepare(`SELECT COALESCE(SUM(total), 0) AS v FROM invoices WHERE company_id = ? AND issue_date BETWEEN ? AND ? AND status NOT IN ('voided','cancelled','draft') AND COALESCE(deleted_at, '') = ''`).get(companyId, start, end) as any)?.v || 0;
    expenses = (dbi.prepare(`SELECT COALESCE(SUM(amount), 0) AS v FROM expenses WHERE company_id = ? AND date BETWEEN ? AND ? AND COALESCE(deleted_at, '') = ''`).get(companyId, start, end) as any)?.v || 0;
    payroll = (dbi.prepare(`SELECT COALESCE(SUM(s.gross_pay), 0) AS v FROM pay_stubs s JOIN payroll_runs r ON r.id = s.payroll_run_id WHERE r.company_id = ? AND r.pay_date BETWEEN ? AND ?`).get(companyId, start, end) as any)?.v || 0;
  } catch { /* */ }
  const netProfit = revenue - expenses - payroll;
  return {
    year,
    revenue: round2(revenue),
    expenses: round2(expenses),
    payroll: round2(payroll),
    net_profit: round2(netProfit),
    estimated_se_tax: round2(netProfit > 0 ? netProfit * 0.9235 * 0.153 : 0),
    estimated_qbi_deduction: round2(netProfit > 0 ? netProfit * 0.20 : 0),
    taxes_paid: round2(taxes_paid),
    forms_to_file: netProfit > 0
      ? ['Schedule C', 'Schedule SE', 'Form 1040', 'Form 8995 (QBI)']
      : ['Schedule C (loss)', 'Form 1040'],
  };
}

// ── F60: Custom dashboard widgets ─────────────────────────────

export const WIDGET_TYPES = [
  'kpi.revenue_ytd', 'kpi.expenses_ytd', 'kpi.profit_ytd', 'kpi.cash_balance',
  'kpi.outstanding_ar', 'kpi.outstanding_ap', 'kpi.dso', 'kpi.dpo',
  'chart.revenue_by_month', 'chart.expense_by_category', 'chart.cash_flow',
  'list.top_customers', 'list.overdue_invoices', 'list.recent_activity',
  'list.churn_risk', 'list.budget_alerts',
  'forecast.cash_balance_30d', 'forecast.payroll_cost',
];

export function listDashboardWidgets(userId: string, companyId: string): any[] {
  return db.getDb().prepare('SELECT * FROM dashboard_widgets WHERE user_id = ? AND company_id = ? AND is_visible = 1 ORDER BY position_y, position_x').all(userId, companyId) as any[];
}

export function upsertDashboardWidget(w: { id?: string; user_id: string; company_id: string; widget_type: string; widget_config?: any; position_x?: number; position_y?: number; width?: number; height?: number; is_visible?: boolean }): any {
  const dbi = db.getDb();
  const id = w.id || uuid();
  const cfg = typeof w.widget_config === 'string' ? w.widget_config : JSON.stringify(w.widget_config || {});
  if (w.id) {
    dbi.prepare(`UPDATE dashboard_widgets SET widget_type = ?, widget_config = ?, position_x = ?, position_y = ?, width = ?, height = ?, is_visible = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(w.widget_type, cfg, w.position_x ?? 0, w.position_y ?? 0, w.width ?? 4, w.height ?? 2, w.is_visible === false ? 0 : 1, id);
  } else {
    dbi.prepare(`INSERT INTO dashboard_widgets (id, user_id, company_id, widget_type, widget_config, position_x, position_y, width, height, is_visible) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, w.user_id, w.company_id, w.widget_type, cfg, w.position_x ?? 0, w.position_y ?? 0, w.width ?? 4, w.height ?? 2, w.is_visible === false ? 0 : 1);
  }
  return dbi.prepare('SELECT * FROM dashboard_widgets WHERE id = ?').get(id);
}

export function removeDashboardWidget(id: string): boolean {
  return db.getDb().prepare('DELETE FROM dashboard_widgets WHERE id = ?').run(id).changes > 0;
}
