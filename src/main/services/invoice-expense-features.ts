// src/main/services/invoice-expense-features.ts
//
// Batch 2 — Invoicing & Expense features (F16-F35, 20 features).
// Combined into one file because they share entity types and most
// are small CRUD or computation helpers.

import * as db from '../database';
import { v4 as uuid } from 'uuid';

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

// ── F16: Invoice late-fee auto-calc ───────────────────────────

export function computeLateFee(invoiceId: string): { invoice_id: string; late_fee_applied: number; days_overdue: number; will_apply: boolean } {
  const dbi = db.getDb();
  const inv = dbi.prepare(`SELECT id, due_date, total, amount_paid, late_fee_rate_pct, late_fee_grace_days, late_fee_applied, status FROM invoices WHERE id = ?`).get(invoiceId) as any;
  if (!inv || inv.status === 'paid' || inv.status === 'voided') return { invoice_id: invoiceId, late_fee_applied: 0, days_overdue: 0, will_apply: false };

  const today = new Date().toISOString().slice(0, 10);
  if (!inv.due_date || today <= inv.due_date) return { invoice_id: invoiceId, late_fee_applied: inv.late_fee_applied || 0, days_overdue: 0, will_apply: false };

  const daysOverdue = Math.floor((new Date(today + 'T00:00:00').getTime() - new Date(inv.due_date + 'T00:00:00').getTime()) / 86400000);
  const grace = inv.late_fee_grace_days || 0;
  if (daysOverdue <= grace) return { invoice_id: invoiceId, late_fee_applied: 0, days_overdue: daysOverdue, will_apply: false };

  // Get default rate from company if invoice-level not set
  let rate = inv.late_fee_rate_pct;
  if (!rate) {
    const company = dbi.prepare('SELECT default_late_fee_rate_pct FROM companies WHERE id = (SELECT company_id FROM invoices WHERE id = ?)').get(invoiceId) as any;
    rate = company?.default_late_fee_rate_pct || 1.5;
  }
  const unpaidBalance = Math.max(0, (inv.total || 0) - (inv.amount_paid || 0));
  // Monthly compounded — typical commercial practice
  const monthsOverdue = (daysOverdue - grace) / 30;
  const fee = round2(unpaidBalance * (rate / 100) * monthsOverdue);
  return { invoice_id: invoiceId, late_fee_applied: fee, days_overdue: daysOverdue, will_apply: fee > 0.005 };
}

export function applyLateFee(invoiceId: string): { ok: boolean; applied: number } {
  const dbi = db.getDb();
  const calc = computeLateFee(invoiceId);
  if (!calc.will_apply) return { ok: false, applied: 0 };
  dbi.prepare(`UPDATE invoices SET late_fee_applied = ?, balance_due = (total - amount_paid + ?) WHERE id = ?`).run(calc.late_fee_applied, calc.late_fee_applied, invoiceId);
  return { ok: true, applied: calc.late_fee_applied };
}

// ── F17: Scheduled invoice reminders ──────────────────────────

export interface InvoiceReminderSchedule {
  invoice_id: string;
  days_after_due: number;
  template_id?: string;
}

export function scheduleInvoiceReminders(invoiceId: string, days: number[]): number {
  const dbi = db.getDb();
  const inv = dbi.prepare('SELECT due_date FROM invoices WHERE id = ?').get(invoiceId) as any;
  if (!inv?.due_date) return 0;
  const due = new Date(inv.due_date + 'T09:00:00');
  let created = 0;
  for (const d of days) {
    const schedDate = new Date(due);
    schedDate.setDate(schedDate.getDate() + d);
    dbi.prepare(`INSERT INTO invoice_reminder_schedules (id, invoice_id, days_after_due, scheduled_at) VALUES (?, ?, ?, ?)`)
      .run(uuid(), invoiceId, d, schedDate.toISOString());
    created++;
  }
  return created;
}

export function pendingReminders(asOf?: string): any[] {
  const dbi = db.getDb();
  const cutoff = asOf || new Date().toISOString();
  return dbi.prepare(`
    SELECT r.*, i.invoice_number, i.client_id, i.total, i.balance_due
    FROM invoice_reminder_schedules r
    JOIN invoices i ON i.id = r.invoice_id
    WHERE r.scheduled_at <= ? AND r.sent_at IS NULL AND r.cancelled_at IS NULL
    ORDER BY r.scheduled_at
  `).all(cutoff) as any[];
}

export function markReminderSent(reminderId: string): boolean {
  const dbi = db.getDb();
  return dbi.prepare(`UPDATE invoice_reminder_schedules SET sent_at = datetime('now') WHERE id = ?`).run(reminderId).changes > 0;
}

// ── F18: Partial payment tracking helpers ─────────────────────

export function recalcInvoicePaymentState(invoiceId: string): { amount_paid: number; balance_due: number; status: string } {
  const dbi = db.getDb();
  const r = dbi.prepare(`SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE invoice_id = ?`).get(invoiceId) as any;
  const inv = dbi.prepare(`SELECT total, late_fee_applied FROM invoices WHERE id = ?`).get(invoiceId) as any;
  const paid = round2(r?.paid || 0);
  const total = round2((inv?.total || 0) + (inv?.late_fee_applied || 0));
  const balance = round2(Math.max(0, total - paid));
  let status = 'partial';
  if (paid <= 0.005) status = 'unpaid';
  else if (balance <= 0.005) status = 'paid';
  dbi.prepare(`UPDATE invoices SET amount_paid = ?, balance_due = ?, status = ?, last_payment_date = (SELECT MAX(date) FROM payments WHERE invoice_id = ?) WHERE id = ?`)
    .run(paid, balance, status, invoiceId, invoiceId);
  return { amount_paid: paid, balance_due: balance, status };
}

// ── F19: Credit memos / refunds ───────────────────────────────

export interface CreditMemo {
  id?: string;
  company_id: string;
  client_id: string;
  invoice_id?: string;
  memo_number: string;
  issue_date: string;
  reason?: string;
  amount: number;
  notes?: string;
}

export function createCreditMemo(memo: CreditMemo): any {
  const dbi = db.getDb();
  const id = memo.id || uuid();
  dbi.prepare(`INSERT INTO credit_memos (id, company_id, client_id, invoice_id, memo_number, issue_date, reason, amount, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, memo.company_id, memo.client_id, memo.invoice_id || null, memo.memo_number, memo.issue_date, memo.reason || '', memo.amount, memo.notes || '');
  return dbi.prepare('SELECT * FROM credit_memos WHERE id = ?').get(id);
}

export function applyCreditMemo(memoId: string, invoiceId: string, amount: number): { ok: boolean; applied: number; remaining: number } {
  const dbi = db.getDb();
  const memo = dbi.prepare('SELECT * FROM credit_memos WHERE id = ?').get(memoId) as any;
  if (!memo) return { ok: false, applied: 0, remaining: 0 };
  const available = (memo.amount || 0) - (memo.amount_applied || 0);
  const toApply = Math.min(amount, available);
  if (toApply <= 0) return { ok: false, applied: 0, remaining: available };

  dbi.prepare(`UPDATE credit_memos SET amount_applied = amount_applied + ?, status = CASE WHEN amount_applied + ? >= amount THEN 'fully_applied' ELSE 'partially_applied' END, updated_at = datetime('now') WHERE id = ?`)
    .run(toApply, toApply, memoId);

  // Apply as a payment to the invoice
  const paymentId = uuid();
  dbi.prepare(`INSERT INTO payments (id, invoice_id, amount, date, method, notes) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(paymentId, invoiceId, toApply, new Date().toISOString().slice(0, 10), 'credit_memo', 'Applied credit memo ' + memo.memo_number);

  recalcInvoicePaymentState(invoiceId);
  return { ok: true, applied: toApply, remaining: available - toApply };
}

export function listCreditMemos(companyId: string, clientId?: string): any[] {
  const dbi = db.getDb();
  if (clientId) {
    return dbi.prepare('SELECT * FROM credit_memos WHERE company_id = ? AND client_id = ? ORDER BY issue_date DESC').all(companyId, clientId) as any[];
  }
  return dbi.prepare('SELECT * FROM credit_memos WHERE company_id = ? ORDER BY issue_date DESC').all(companyId) as any[];
}

// ── F20: Invoice batch send (collects invoice IDs; UI sends emails) ──

export function getBatchSendCandidates(companyId: string, opts?: { status?: string; days_overdue?: number }): any[] {
  const dbi = db.getDb();
  let sql = `SELECT i.id, i.invoice_number, i.total, i.balance_due, i.due_date, i.client_id, c.name AS client_name, c.email AS client_email FROM invoices i LEFT JOIN clients c ON c.id = i.client_id WHERE i.company_id = ? AND COALESCE(i.deleted_at, '') = ''`;
  const params: any[] = [companyId];
  if (opts?.status) { sql += ' AND i.status = ?'; params.push(opts.status); }
  if (opts?.days_overdue) { sql += ` AND i.due_date <= date('now', ?)`; params.push(`-${opts.days_overdue} days`); }
  sql += ' ORDER BY i.due_date';
  return dbi.prepare(sql).all(...params) as any[];
}

// ── F21-F22: Invoice templates with prefixes ──────────────────

export function listInvoiceTemplates(companyId: string): any[] {
  return db.getDb().prepare('SELECT * FROM invoice_templates WHERE company_id = ? ORDER BY is_default DESC, template_name').all(companyId) as any[];
}

export function upsertInvoiceTemplate(t: { id?: string; company_id: string; template_name: string; template_data: any; number_prefix?: string; is_default?: boolean }): any {
  const dbi = db.getDb();
  const id = t.id || uuid();
  const data = typeof t.template_data === 'string' ? t.template_data : JSON.stringify(t.template_data);
  if (t.is_default) {
    dbi.prepare('UPDATE invoice_templates SET is_default = 0 WHERE company_id = ?').run(t.company_id);
  }
  if (t.id) {
    dbi.prepare(`UPDATE invoice_templates SET template_name = ?, template_data = ?, number_prefix = ?, is_default = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(t.template_name, data, t.number_prefix || '', t.is_default ? 1 : 0, id);
  } else {
    dbi.prepare(`INSERT INTO invoice_templates (id, company_id, template_name, template_data, number_prefix, is_default) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, t.company_id, t.template_name, data, t.number_prefix || '', t.is_default ? 1 : 0);
  }
  return dbi.prepare('SELECT * FROM invoice_templates WHERE id = ?').get(id);
}

// ── F23: Invoice currency conversion ──────────────────────────

export function setInvoiceExchangeRate(invoiceId: string, rate: number): boolean {
  const dbi = db.getDb();
  const inv = dbi.prepare('SELECT total FROM invoices WHERE id = ?').get(invoiceId) as any;
  if (!inv) return false;
  const reportingTotal = round2((inv.total || 0) * rate);
  return dbi.prepare(`UPDATE invoices SET exchange_rate = ?, reporting_currency_total = ? WHERE id = ?`).run(rate, reportingTotal, invoiceId).changes > 0;
}

// ── F24: Deposit / down-payment tracking ──────────────────────

export function setInvoiceDeposit(invoiceId: string, depositRequired: number, depositDueDate?: string): boolean {
  return db.getDb().prepare(`UPDATE invoices SET deposit_required = ?, deposit_due_date = ? WHERE id = ?`).run(depositRequired, depositDueDate || null, invoiceId).changes > 0;
}

// ── F27: Category budget alerts ───────────────────────────────

export function upsertBudgetAlert(record: { id?: string; company_id: string; category_id: string; period: 'monthly' | 'quarterly' | 'annual'; budget_amount: number; alert_threshold_pct?: number }): any {
  const dbi = db.getDb();
  const id = record.id || uuid();
  if (record.id) {
    dbi.prepare(`UPDATE category_budget_alerts SET budget_amount = ?, period = ?, alert_threshold_pct = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(record.budget_amount, record.period, record.alert_threshold_pct ?? 80, id);
  } else {
    dbi.prepare(`INSERT INTO category_budget_alerts (id, company_id, category_id, period, budget_amount, alert_threshold_pct) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, record.company_id, record.category_id, record.period, record.budget_amount, record.alert_threshold_pct ?? 80);
  }
  return dbi.prepare('SELECT * FROM category_budget_alerts WHERE id = ?').get(id);
}

export function checkBudgetAlerts(companyId: string): Array<{ category_id: string; period: string; budget: number; spent: number; pct: number; alert: boolean }> {
  const dbi = db.getDb();
  const alerts = dbi.prepare('SELECT * FROM category_budget_alerts WHERE company_id = ? AND is_active = 1').all(companyId) as any[];
  const now = new Date();
  const out: any[] = [];
  for (const a of alerts) {
    let start = '';
    let end = '';
    if (a.period === 'monthly') {
      start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const next = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      end = next.toISOString().slice(0, 10);
    } else if (a.period === 'quarterly') {
      const q = Math.floor(now.getMonth() / 3);
      start = `${now.getFullYear()}-${String(q * 3 + 1).padStart(2, '0')}-01`;
      const end3 = new Date(now.getFullYear(), q * 3 + 3, 0);
      end = end3.toISOString().slice(0, 10);
    } else {
      start = `${now.getFullYear()}-01-01`;
      end = `${now.getFullYear()}-12-31`;
    }
    const spent = (dbi.prepare(`SELECT COALESCE(SUM(amount), 0) AS s FROM expenses WHERE company_id = ? AND category_id = ? AND date BETWEEN ? AND ? AND COALESCE(deleted_at, '') = ''`).get(companyId, a.category_id, start, end) as any)?.s || 0;
    const pct = a.budget_amount > 0 ? (spent / a.budget_amount) * 100 : 0;
    out.push({ category_id: a.category_id, period: a.period, budget: a.budget_amount, spent: round2(spent), pct: round2(pct), alert: pct >= a.alert_threshold_pct });
  }
  return out;
}

// ── F28: Vendor auto-suggest ──────────────────────────────────

export function suggestVendors(companyId: string, prefix?: string, limit: number = 10): any[] {
  const dbi = db.getDb();
  // Rank by recency × frequency
  const sql = `
    SELECT v.id, v.name,
      COUNT(e.id) AS uses,
      MAX(e.date) AS last_used
    FROM vendors v
    LEFT JOIN expenses e ON e.vendor_id = v.id AND COALESCE(e.deleted_at, '') = ''
    WHERE v.company_id = ?
      AND COALESCE(v.deleted_at, '') = ''
      ${prefix ? "AND LOWER(v.name) LIKE ?" : ''}
    GROUP BY v.id, v.name
    ORDER BY uses DESC, last_used DESC
    LIMIT ?
  `;
  const params = prefix ? [companyId, `${prefix.toLowerCase()}%`, limit] : [companyId, limit];
  return dbi.prepare(sql).all(...params) as any[];
}

// ── F29: Expense splitting ────────────────────────────────────

export function createExpenseSplit(expenseId: string, splits: Array<{ category_id?: string; description?: string; amount: number }>): { ok: boolean; total_split: number; expense_total: number; balanced: boolean } {
  const dbi = db.getDb();
  const exp = dbi.prepare('SELECT amount FROM expenses WHERE id = ?').get(expenseId) as any;
  if (!exp) return { ok: false, total_split: 0, expense_total: 0, balanced: false };

  // Replace any existing splits
  dbi.prepare('DELETE FROM expense_splits WHERE expense_id = ?').run(expenseId);
  let total = 0;
  for (const s of splits) {
    const pct = exp.amount > 0 ? (s.amount / exp.amount) * 100 : 0;
    dbi.prepare(`INSERT INTO expense_splits (id, expense_id, category_id, description, amount, pct) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(uuid(), expenseId, s.category_id || null, s.description || '', s.amount, pct);
    total += s.amount;
  }
  return { ok: true, total_split: round2(total), expense_total: exp.amount, balanced: Math.abs(total - exp.amount) < 0.01 };
}

export function getExpenseSplits(expenseId: string): any[] {
  return db.getDb().prepare('SELECT * FROM expense_splits WHERE expense_id = ?').all(expenseId) as any[];
}

// ── F31: Reimbursement workflow ───────────────────────────────

export function createReimbursement(record: { company_id: string; employee_id: string; submitted_by: string; expense_ids: string[]; notes?: string }): any {
  const dbi = db.getDb();
  const id = uuid();
  // Sum amounts from the expense IDs
  const placeholders = record.expense_ids.map(() => '?').join(',');
  const r = dbi.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE id IN (${placeholders})`).get(...record.expense_ids) as any;
  const total = round2(r?.total || 0);
  dbi.prepare(`INSERT INTO expense_reimbursements (id, company_id, employee_id, submitted_by, total_amount, notes) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, record.company_id, record.employee_id, record.submitted_by, total, record.notes || '');
  // Link items
  for (const expId of record.expense_ids) {
    const exp = dbi.prepare('SELECT amount FROM expenses WHERE id = ?').get(expId) as any;
    if (exp) {
      dbi.prepare(`INSERT INTO expense_reimbursement_items (id, reimbursement_id, expense_id, amount) VALUES (?, ?, ?, ?)`)
        .run(uuid(), id, expId, exp.amount);
    }
  }
  return dbi.prepare('SELECT * FROM expense_reimbursements WHERE id = ?').get(id);
}

export function approveReimbursement(id: string, approvedBy: string): boolean {
  return db.getDb().prepare(`UPDATE expense_reimbursements SET status = 'approved', approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(approvedBy, id).changes > 0;
}

export function rejectReimbursement(id: string, rejectedReason: string): boolean {
  return db.getDb().prepare(`UPDATE expense_reimbursements SET status = 'rejected', rejected_reason = ?, updated_at = datetime('now') WHERE id = ?`).run(rejectedReason, id).changes > 0;
}

export function payReimbursement(id: string, paymentMethod: string): boolean {
  return db.getDb().prepare(`UPDATE expense_reimbursements SET status = 'paid', paid_at = datetime('now'), payment_method = ?, updated_at = datetime('now') WHERE id = ?`).run(paymentMethod, id).changes > 0;
}

export function listReimbursements(companyId: string, status?: string): any[] {
  const dbi = db.getDb();
  if (status) return dbi.prepare('SELECT * FROM expense_reimbursements WHERE company_id = ? AND status = ? ORDER BY submitted_at DESC').all(companyId, status) as any[];
  return dbi.prepare('SELECT * FROM expense_reimbursements WHERE company_id = ? ORDER BY submitted_at DESC').all(companyId) as any[];
}

// ── F32: Per-diem rates ───────────────────────────────────────

export function upsertPerDiemRate(record: { id?: string; company_id: string; city: string; state: string; effective_year: number; lodging_rate: number; meals_rate: number; incidentals_rate?: number; notes?: string }): any {
  const dbi = db.getDb();
  const id = record.id || uuid();
  if (record.id) {
    dbi.prepare(`UPDATE per_diem_rates SET lodging_rate = ?, meals_rate = ?, incidentals_rate = ?, notes = ? WHERE id = ?`)
      .run(record.lodging_rate, record.meals_rate, record.incidentals_rate ?? 5, record.notes || '', id);
  } else {
    dbi.prepare(`INSERT INTO per_diem_rates (id, company_id, city, state, effective_year, lodging_rate, meals_rate, incidentals_rate, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, record.company_id, record.city, record.state, record.effective_year, record.lodging_rate, record.meals_rate, record.incidentals_rate ?? 5, record.notes || '');
  }
  return dbi.prepare('SELECT * FROM per_diem_rates WHERE id = ?').get(id);
}

export function lookupPerDiem(companyId: string, city: string, state: string, year: number): any | null {
  const dbi = db.getDb();
  return dbi.prepare('SELECT * FROM per_diem_rates WHERE company_id = ? AND LOWER(city) = LOWER(?) AND UPPER(state) = UPPER(?) AND effective_year = ?')
    .get(companyId, city, state, year) as any || null;
}

// ── F33: Bulk re-categorize ───────────────────────────────────

export function bulkRecategorizeExpenses(expenseIds: string[], newCategoryId: string): { updated: number } {
  if (expenseIds.length === 0) return { updated: 0 };
  const dbi = db.getDb();
  const placeholders = expenseIds.map(() => '?').join(',');
  const r = dbi.prepare(`UPDATE expenses SET category_id = ?, updated_at = datetime('now') WHERE id IN (${placeholders})`).run(newCategoryId, ...expenseIds);
  return { updated: r.changes };
}

// ── F34: Expense report builder ───────────────────────────────

export function buildExpenseReport(companyId: string, opts: { start_date: string; end_date: string; employee_id?: string; category_id?: string; vendor_id?: string }): { rows: any[]; total: number; by_category: Record<string, number>; by_vendor: Record<string, number> } {
  const dbi = db.getDb();
  const params: any[] = [companyId, opts.start_date, opts.end_date];
  let sql = `SELECT e.*, c.name AS category_name, v.name AS vendor_name FROM expenses e LEFT JOIN categories c ON c.id = e.category_id LEFT JOIN vendors v ON v.id = e.vendor_id WHERE e.company_id = ? AND e.date BETWEEN ? AND ? AND COALESCE(e.deleted_at, '') = ''`;
  if (opts.employee_id) { sql += ' AND e.employee_id = ?'; params.push(opts.employee_id); }
  if (opts.category_id) { sql += ' AND e.category_id = ?'; params.push(opts.category_id); }
  if (opts.vendor_id) { sql += ' AND e.vendor_id = ?'; params.push(opts.vendor_id); }
  sql += ' ORDER BY e.date DESC';
  const rows = dbi.prepare(sql).all(...params) as any[];
  let total = 0;
  const byCat: Record<string, number> = {};
  const byVendor: Record<string, number> = {};
  for (const r of rows) {
    total += r.amount || 0;
    const cat = r.category_name || '(uncategorized)';
    const vendor = r.vendor_name || '(no vendor)';
    byCat[cat] = round2((byCat[cat] || 0) + (r.amount || 0));
    byVendor[vendor] = round2((byVendor[vendor] || 0) + (r.amount || 0));
  }
  return { rows, total: round2(total), by_category: byCat, by_vendor: byVendor };
}

// ── F35: Expense duplicate detection ──────────────────────────

export function findExpenseDuplicates(companyId: string, expense: { date: string; amount: number; vendor_id?: string; description?: string }, daysWindow: number = 5): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId, expense.amount];
  let sql = `SELECT * FROM expenses WHERE company_id = ? AND amount = ? AND COALESCE(deleted_at, '') = ''`;
  if (expense.vendor_id) { sql += ' AND vendor_id = ?'; params.push(expense.vendor_id); }
  // Within N days window
  sql += ` AND date BETWEEN date(?, '-${daysWindow} days') AND date(?, '+${daysWindow} days')`;
  params.push(expense.date, expense.date);
  return dbi.prepare(sql).all(...params) as any[];
}
