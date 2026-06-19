// src/main/services/banking-payroll-features.ts
//
// Batch 3 — Banking, Reconciliation, and Payroll features (F36-F50).

import * as db from '../database';
import { v4 as uuid } from 'uuid';

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

// ── F36: Bank rule engine ─────────────────────────────────────

export interface BankRule {
  id?: string;
  company_id: string;
  rule_name: string;
  match_field: 'description' | 'memo' | 'payee' | 'amount';
  match_type: 'contains' | 'equals' | 'starts_with' | 'ends_with' | 'regex' | 'between';
  match_value: string;
  match_value_2?: string;
  apply_category_id?: string;
  apply_vendor_id?: string;
  apply_tags?: string[];
  priority?: number;
}

export function upsertBankRule(rule: BankRule): any {
  const dbi = db.getDb();
  const id = rule.id || uuid();
  if (rule.id) {
    dbi.prepare(`UPDATE bank_categorization_rules SET rule_name = ?, match_field = ?, match_type = ?, match_value = ?, match_value_2 = ?, apply_category_id = ?, apply_vendor_id = ?, apply_tags = ?, priority = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(rule.rule_name, rule.match_field, rule.match_type, rule.match_value, rule.match_value_2 || null, rule.apply_category_id || null, rule.apply_vendor_id || null, JSON.stringify(rule.apply_tags || []), rule.priority ?? 100, id);
  } else {
    dbi.prepare(`INSERT INTO bank_categorization_rules (id, company_id, rule_name, match_field, match_type, match_value, match_value_2, apply_category_id, apply_vendor_id, apply_tags, priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, rule.company_id, rule.rule_name, rule.match_field, rule.match_type, rule.match_value, rule.match_value_2 || null, rule.apply_category_id || null, rule.apply_vendor_id || null, JSON.stringify(rule.apply_tags || []), rule.priority ?? 100);
  }
  return dbi.prepare('SELECT * FROM bank_categorization_rules WHERE id = ?').get(id);
}

export function listBankRules(companyId: string): any[] {
  return db.getDb().prepare('SELECT * FROM bank_categorization_rules WHERE company_id = ? AND is_active = 1 ORDER BY priority, rule_name').all(companyId) as any[];
}

export function matchBankRule(rule: any, txn: { description?: string; memo?: string; payee?: string; amount?: number }): boolean {
  const fieldVal = String((txn as any)[rule.match_field] || '').toLowerCase();
  const matchVal = String(rule.match_value || '').toLowerCase();
  if (rule.match_field === 'amount') {
    const a = txn.amount || 0;
    const v1 = parseFloat(rule.match_value);
    if (rule.match_type === 'between') {
      const v2 = parseFloat(rule.match_value_2 || '0');
      return a >= v1 && a <= v2;
    }
    if (rule.match_type === 'equals') return Math.abs(a - v1) < 0.005;
    return false;
  }
  switch (rule.match_type) {
    case 'contains': return fieldVal.includes(matchVal);
    case 'equals': return fieldVal === matchVal;
    case 'starts_with': return fieldVal.startsWith(matchVal);
    case 'ends_with': return fieldVal.endsWith(matchVal);
    case 'regex': try { return new RegExp(rule.match_value, 'i').test((txn as any)[rule.match_field] || ''); } catch { return false; }
    default: return false;
  }
}

export function applyRulesToTransactions(companyId: string, txnIds?: string[]): { matched: number; updated: number } {
  const dbi = db.getDb();
  const rules = listBankRules(companyId);
  if (rules.length === 0) return { matched: 0, updated: 0 };
  let txns: any[];
  if (txnIds && txnIds.length > 0) {
    const placeholders = txnIds.map(() => '?').join(',');
    txns = dbi.prepare(`SELECT * FROM bank_transactions WHERE id IN (${placeholders})`).all(...txnIds) as any[];
  } else {
    txns = dbi.prepare(`SELECT * FROM bank_transactions WHERE company_id = ? AND category_id IS NULL`).all(companyId) as any[];
  }
  let matched = 0, updated = 0;
  for (const t of txns) {
    for (const r of rules) {
      if (matchBankRule(r, t)) {
        matched++;
        dbi.prepare(`UPDATE bank_transactions SET category_id = ?, vendor_id = ? WHERE id = ?`).run(r.apply_category_id || null, r.apply_vendor_id || null, t.id);
        dbi.prepare(`UPDATE bank_categorization_rules SET times_matched = times_matched + 1, last_matched_at = datetime('now') WHERE id = ?`).run(r.id);
        updated++;
        break;
      }
    }
  }
  return { matched, updated };
}

// ── F37: Auto-match reconciliation ────────────────────────────

export function autoMatchReconciliation(companyId: string, accountId: string, dateWindow: number = 3): { matches: number; suggestions: any[] } {
  const dbi = db.getDb();
  // Pull unmatched bank txns and unmatched ledger entries
  const bankTxns = dbi.prepare(`SELECT * FROM bank_transactions WHERE company_id = ? AND account_id = ? AND cleared_at IS NULL`).all(companyId, accountId) as any[];
  // For our schema, ledger entries are in journal_entry_lines/payments/expenses
  // For simplicity, match against payments and expenses with same account
  const ledgerHits: any[] = [];
  try {
    const payments = dbi.prepare(`SELECT id, amount, date, 'payment' AS source FROM payments WHERE date IS NOT NULL`).all() as any[];
    const expenses = dbi.prepare(`SELECT id, amount, date, 'expense' AS source FROM expenses WHERE company_id = ? AND COALESCE(deleted_at, '') = ''`).all(companyId) as any[];
    ledgerHits.push(...payments, ...expenses);
  } catch { /* */ }

  const suggestions: any[] = [];
  let matches = 0;
  for (const bt of bankTxns) {
    const candidates = ledgerHits.filter((l) => {
      if (Math.abs(Math.abs(l.amount) - Math.abs(bt.amount)) > 0.005) return false;
      const d1 = new Date((bt.date || bt.posted_date) + 'T00:00:00').getTime();
      const d2 = new Date(l.date + 'T00:00:00').getTime();
      return Math.abs(d1 - d2) <= dateWindow * 86400000;
    });
    if (candidates.length === 1) {
      // Auto-match — single candidate within window
      suggestions.push({ bank_txn_id: bt.id, ledger_id: candidates[0].id, ledger_source: candidates[0].source, confidence: 'high', auto_matched: true });
      matches++;
    } else if (candidates.length > 1) {
      suggestions.push({ bank_txn_id: bt.id, candidates: candidates.slice(0, 5), confidence: 'ambiguous', auto_matched: false });
    }
  }
  return { matches, suggestions };
}

// ── F38: Duplicate transaction detection ──────────────────────

export function detectDuplicateTransactions(companyId: string, daysWindow: number = 3): any[] {
  const dbi = db.getDb();
  const dupes: any[] = [];
  try {
    const rows = dbi.prepare(`
      SELECT t1.id AS id1, t2.id AS id2, t1.amount, t1.date, t1.description
      FROM bank_transactions t1
      JOIN bank_transactions t2 ON t1.id < t2.id
        AND t1.company_id = t2.company_id
        AND t1.account_id = t2.account_id
        AND ABS(t1.amount - t2.amount) < 0.005
        AND ABS(julianday(t1.date) - julianday(t2.date)) <= ?
      WHERE t1.company_id = ?
        AND t1.is_duplicate_of IS NULL
        AND t2.is_duplicate_of IS NULL
    `).all(daysWindow, companyId) as any[];
    for (const r of rows) {
      dupes.push(r);
    }
  } catch { /* schema mismatch */ }
  return dupes;
}

export function flagDuplicateTransaction(txnId: string, duplicateOf: string, confidence: number = 0.9): boolean {
  return db.getDb().prepare('UPDATE bank_transactions SET is_duplicate_of = ?, duplicate_confidence = ? WHERE id = ?').run(duplicateOf, confidence, txnId).changes > 0;
}

// ── F39: Multi-bank transfer detection ────────────────────────

export function detectTransfers(companyId: string, dateWindow: number = 2): any[] {
  const dbi = db.getDb();
  try {
    // Pairs of transactions: outflow on one account + inflow on another, same amount, within N days
    return dbi.prepare(`
      SELECT t1.id AS outflow_id, t2.id AS inflow_id, t1.amount, t1.date AS outflow_date, t2.date AS inflow_date,
             t1.account_id AS from_account, t2.account_id AS to_account
      FROM bank_transactions t1
      JOIN bank_transactions t2 ON t1.id != t2.id
        AND t1.company_id = t2.company_id
        AND t1.account_id != t2.account_id
        AND ABS(t1.amount + t2.amount) < 0.005
        AND t1.amount < 0 AND t2.amount > 0
        AND ABS(julianday(t1.date) - julianday(t2.date)) <= ?
        AND t1.transfer_match_id IS NULL
        AND t2.transfer_match_id IS NULL
      WHERE t1.company_id = ?
    `).all(dateWindow, companyId) as any[];
  } catch { return []; }
}

export function confirmTransfer(outflowId: string, inflowId: string): boolean {
  const matchId = uuid();
  const dbi = db.getDb();
  dbi.prepare('UPDATE bank_transactions SET transfer_match_id = ? WHERE id IN (?, ?)').run(matchId, outflowId, inflowId);
  return true;
}

// ── F40: Balance projection ───────────────────────────────────

export function projectBankBalance(companyId: string, accountId: string, daysAhead: number = 30): { current_balance: number; projected_balance: number; inflows: number; outflows: number; days: number } {
  const dbi = db.getDb();
  // Current balance from account
  const acct = dbi.prepare(`SELECT * FROM accounts WHERE id = ? AND company_id = ?`).get(accountId, companyId) as any;
  const current = acct?.balance || 0;
  // Projected inflows: unpaid invoices due within window
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() + daysAhead);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  let inflows = 0, outflows = 0;
  try {
    const inv = dbi.prepare(`SELECT COALESCE(SUM(COALESCE(balance_due, total)), 0) AS total FROM invoices WHERE company_id = ? AND status IN ('sent','partial','unpaid') AND due_date <= ? AND COALESCE(deleted_at, '') = ''`).get(companyId, cutoffStr) as any;
    inflows = inv?.total || 0;
  } catch { /* */ }
  try {
    const bills = dbi.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM bills WHERE company_id = ? AND status IN ('open','overdue') AND due_date <= ? AND COALESCE(deleted_at, '') = ''`).get(companyId, cutoffStr) as any;
    outflows = bills?.total || 0;
  } catch { /* */ }
  return { current_balance: round2(current), projected_balance: round2(current + inflows - outflows), inflows: round2(inflows), outflows: round2(outflows), days: daysAhead };
}

// ── F41: CSV mapper ───────────────────────────────────────────

export function upsertCsvMapping(record: { id?: string; company_id: string; bank_name: string; mapping_json: any; date_format?: string; date_column: string; description_column: string; amount_column: string; debit_column?: string; credit_column?: string; skip_rows?: number }): any {
  const dbi = db.getDb();
  const id = record.id || uuid();
  const mapping = typeof record.mapping_json === 'string' ? record.mapping_json : JSON.stringify(record.mapping_json);
  if (record.id) {
    dbi.prepare(`UPDATE bank_csv_mappings SET bank_name = ?, mapping_json = ?, date_format = ?, date_column = ?, description_column = ?, amount_column = ?, debit_column = ?, credit_column = ?, skip_rows = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(record.bank_name, mapping, record.date_format || 'YYYY-MM-DD', record.date_column, record.description_column, record.amount_column, record.debit_column || null, record.credit_column || null, record.skip_rows ?? 0, id);
  } else {
    dbi.prepare(`INSERT INTO bank_csv_mappings (id, company_id, bank_name, mapping_json, date_format, date_column, description_column, amount_column, debit_column, credit_column, skip_rows) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, record.company_id, record.bank_name, mapping, record.date_format || 'YYYY-MM-DD', record.date_column, record.description_column, record.amount_column, record.debit_column || null, record.credit_column || null, record.skip_rows ?? 0);
  }
  return dbi.prepare('SELECT * FROM bank_csv_mappings WHERE id = ?').get(id);
}

export function listCsvMappings(companyId: string): any[] {
  return db.getDb().prepare('SELECT * FROM bank_csv_mappings WHERE company_id = ? ORDER BY bank_name').all(companyId) as any[];
}

// ── F42: Reconciliation history viewer ────────────────────────

export function getReconciliationHistory(companyId: string, accountId?: string, limit: number = 50): any[] {
  const dbi = db.getDb();
  try {
    let sql = `SELECT m.*, b.date AS bank_date, b.description AS bank_desc, b.amount AS bank_amount FROM bank_reconciliation_matches m LEFT JOIN bank_transactions b ON b.id = m.bank_transaction_id`;
    const params: any[] = [];
    const wheres: string[] = [];
    if (accountId) { wheres.push('b.account_id = ?'); params.push(accountId); }
    wheres.push('m.reconciled_at IS NOT NULL');
    if (wheres.length) sql += ' WHERE ' + wheres.join(' AND ');
    sql += ' ORDER BY m.reconciled_at DESC LIMIT ?';
    params.push(limit);
    return dbi.prepare(sql).all(...params) as any[];
  } catch { return []; }
}

// ── F43: Outstanding deposit tracker ──────────────────────────

export function getOutstandingDeposits(companyId: string): any[] {
  const dbi = db.getDb();
  try {
    return dbi.prepare(`SELECT * FROM bank_transactions WHERE company_id = ? AND deposited_at IS NOT NULL AND cleared_at IS NULL AND amount > 0 ORDER BY deposited_at`).all(companyId) as any[];
  } catch { return []; }
}

// ── F44: Salary review tracker ────────────────────────────────

export function recordSalaryReview(record: { id?: string; company_id: string; employee_id: string; review_date: string; prior_salary: number; new_salary: number; reviewer_id?: string; rating?: string; notes?: string; effective_date?: string }): any {
  const dbi = db.getDb();
  const id = record.id || uuid();
  const pctChange = record.prior_salary > 0 ? round2(((record.new_salary - record.prior_salary) / record.prior_salary) * 100) : 0;
  dbi.prepare(`INSERT INTO employee_salary_reviews (id, company_id, employee_id, review_date, prior_salary, new_salary, pct_change, reviewer_id, rating, notes, effective_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, record.company_id, record.employee_id, record.review_date, record.prior_salary, record.new_salary, pctChange, record.reviewer_id || null, record.rating || null, record.notes || '', record.effective_date || null);
  return dbi.prepare('SELECT * FROM employee_salary_reviews WHERE id = ?').get(id);
}

export function getSalaryReviews(employeeId: string): any[] {
  return db.getDb().prepare('SELECT * FROM employee_salary_reviews WHERE employee_id = ? ORDER BY review_date DESC').all(employeeId) as any[];
}

// ── F45: Pay stub bulk download (returns array of stub data for ZIP) ──

export function getPayStubsForBulkDownload(companyId: string, opts: { year?: number; quarter?: number; employee_id?: string }): any[] {
  const dbi = db.getDb();
  let start = '', end = '';
  if (opts.year && opts.quarter) {
    const sm = (opts.quarter - 1) * 3 + 1;
    start = `${opts.year}-${String(sm).padStart(2, '0')}-01`;
    const em = opts.quarter * 3;
    end = `${opts.year}-${String(em).padStart(2, '0')}-${new Date(opts.year, em, 0).getDate()}`;
  } else if (opts.year) {
    start = `${opts.year}-01-01`;
    end = `${opts.year}-12-31`;
  } else {
    return [];
  }
  let sql = `SELECT s.*, r.pay_date, e.name AS employee_name FROM pay_stubs s JOIN payroll_runs r ON r.id = s.payroll_run_id LEFT JOIN employees e ON e.id = s.employee_id WHERE r.company_id = ? AND r.pay_date BETWEEN ? AND ? AND COALESCE(r.deleted_at, '') = ''`;
  const params: any[] = [companyId, start, end];
  if (opts.employee_id) { sql += ' AND s.employee_id = ?'; params.push(opts.employee_id); }
  sql += ' ORDER BY r.pay_date, e.name';
  return dbi.prepare(sql).all(...params) as any[];
}

// ── F46: Time-off balances ────────────────────────────────────

export function setTimeOffBalance(record: { id?: string; company_id: string; employee_id: string; time_off_type: string; accrual_rate_hours_per_period?: number; accrual_period?: string; max_carryover_hours?: number; current_balance_hours?: number }): any {
  const dbi = db.getDb();
  const id = record.id || uuid();
  dbi.prepare(`
    INSERT INTO employee_time_off_balances (id, company_id, employee_id, time_off_type, accrual_rate_hours_per_period, accrual_period, max_carryover_hours, current_balance_hours)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id, employee_id, time_off_type) DO UPDATE SET
      accrual_rate_hours_per_period = excluded.accrual_rate_hours_per_period,
      accrual_period = excluded.accrual_period,
      max_carryover_hours = excluded.max_carryover_hours,
      current_balance_hours = excluded.current_balance_hours,
      updated_at = datetime('now')
  `).run(id, record.company_id, record.employee_id, record.time_off_type, record.accrual_rate_hours_per_period ?? 0, record.accrual_period || 'pay_period', record.max_carryover_hours ?? 0, record.current_balance_hours ?? 0);
  return dbi.prepare('SELECT * FROM employee_time_off_balances WHERE company_id = ? AND employee_id = ? AND time_off_type = ?').get(record.company_id, record.employee_id, record.time_off_type);
}

export function requestTimeOff(record: { company_id: string; employee_id: string; time_off_type: string; start_date: string; end_date: string; hours_requested: number; notes?: string }): any {
  const dbi = db.getDb();
  const id = uuid();
  dbi.prepare(`INSERT INTO time_off_requests (id, company_id, employee_id, time_off_type, start_date, end_date, hours_requested, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, record.company_id, record.employee_id, record.time_off_type, record.start_date, record.end_date, record.hours_requested, record.notes || '');
  return dbi.prepare('SELECT * FROM time_off_requests WHERE id = ?').get(id);
}

export function approveTimeOff(requestId: string, approvedBy: string): boolean {
  const dbi = db.getDb();
  const req = dbi.prepare('SELECT * FROM time_off_requests WHERE id = ?').get(requestId) as any;
  if (!req) return false;
  dbi.prepare(`UPDATE time_off_requests SET status = 'approved', approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(approvedBy, requestId);
  // Decrement balance
  dbi.prepare(`UPDATE employee_time_off_balances SET current_balance_hours = current_balance_hours - ?, ytd_used_hours = ytd_used_hours + ?, updated_at = datetime('now') WHERE company_id = ? AND employee_id = ? AND time_off_type = ?`)
    .run(req.hours_requested, req.hours_requested, req.company_id, req.employee_id, req.time_off_type);
  return true;
}

export function getTimeOffBalances(companyId: string, employeeId?: string): any[] {
  const dbi = db.getDb();
  if (employeeId) return dbi.prepare('SELECT * FROM employee_time_off_balances WHERE company_id = ? AND employee_id = ?').all(companyId, employeeId) as any[];
  return dbi.prepare('SELECT * FROM employee_time_off_balances WHERE company_id = ?').all(companyId) as any[];
}

// ── F47: Bonus calculator ─────────────────────────────────────

export function calculateBonus(opts: { employee_salary: number; bonus_type: 'pct_of_salary' | 'flat' | 'pct_of_target_met'; bonus_value: number; target_met_pct?: number }): { gross: number; supplemental_fed_tax: number; supplemental_ss: number; supplemental_medicare: number; net_estimate: number } {
  let gross = 0;
  switch (opts.bonus_type) {
    case 'pct_of_salary': gross = opts.employee_salary * (opts.bonus_value / 100); break;
    case 'flat': gross = opts.bonus_value; break;
    case 'pct_of_target_met':
      const targetMet = Math.max(0, Math.min(1.5, (opts.target_met_pct || 100) / 100));
      gross = opts.employee_salary * (opts.bonus_value / 100) * targetMet;
      break;
  }
  gross = round2(gross);
  const fed = round2(gross * 0.22);       // Supplemental wage flat 22% (IRS Pub 15-T)
  const ss = round2(gross * 0.062);
  const medicare = round2(gross * 0.0145);
  return { gross, supplemental_fed_tax: fed, supplemental_ss: ss, supplemental_medicare: medicare, net_estimate: round2(gross - fed - ss - medicare) };
}

// ── F48: State tax rate viewer ────────────────────────────────

const STATE_TAX_RATES_2025: Record<string, { type: 'flat' | 'progressive'; rate?: number; brackets?: any[] }> = {
  UT: { type: 'flat', rate: 0.0455 },
  CO: { type: 'flat', rate: 0.044 },
  ID: { type: 'flat', rate: 0.058 },
  IL: { type: 'flat', rate: 0.0495 },
  IN: { type: 'flat', rate: 0.0305 },
  KY: { type: 'flat', rate: 0.045 },
  MA: { type: 'flat', rate: 0.05 },
  MI: { type: 'flat', rate: 0.0425 },
  NC: { type: 'flat', rate: 0.045 },
  NH: { type: 'flat', rate: 0 },        // No wage tax, just investment income
  PA: { type: 'flat', rate: 0.0307 },
  AK: { type: 'flat', rate: 0 },
  FL: { type: 'flat', rate: 0 },
  NV: { type: 'flat', rate: 0 },
  SD: { type: 'flat', rate: 0 },
  TN: { type: 'flat', rate: 0 },
  TX: { type: 'flat', rate: 0 },
  WA: { type: 'flat', rate: 0 },
  WY: { type: 'flat', rate: 0 },
  // Progressive states summarized
  CA: { type: 'progressive', brackets: [{ min: 0, max: 10412, rate: 0.01 }, { min: 10412, max: 24684, rate: 0.02 }, { min: 24684, max: 38959, rate: 0.04 }, { min: 38959, max: 54081, rate: 0.06 }, { min: 54081, max: 68350, rate: 0.08 }, { min: 68350, max: 349137, rate: 0.093 }, { min: 349137, max: 418961, rate: 0.103 }, { min: 418961, max: 698271, rate: 0.113 }, { min: 698271, max: Infinity, rate: 0.123 }] },
  NY: { type: 'progressive', brackets: [{ min: 0, max: 8500, rate: 0.04 }, { min: 8500, max: 11700, rate: 0.045 }, { min: 11700, max: 13900, rate: 0.0525 }, { min: 13900, max: 80650, rate: 0.055 }, { min: 80650, max: 215400, rate: 0.06 }, { min: 215400, max: 1077550, rate: 0.0685 }, { min: 1077550, max: Infinity, rate: 0.0965 }] },
};

export function getStateTaxRates(state: string): any {
  return STATE_TAX_RATES_2025[state.toUpperCase()] || { type: 'flat', rate: 0, note: 'State not in lookup table — verify with state DOR directly.' };
}

// ── F49: Payroll cost forecast ────────────────────────────────

export function forecastPayrollCost(companyId: string, monthsAhead: number = 6): { months: Array<{ month: string; employees: number; gross: number; employer_cost: number }> } {
  const dbi = db.getDb();
  const today = new Date();
  const months: any[] = [];
  // Pull current active employees
  let employees: any[] = [];
  try {
    employees = dbi.prepare(`SELECT * FROM employees WHERE company_id = ? AND COALESCE(status, 'active') = 'active' AND COALESCE(deleted_at, '') = ''`).all(companyId) as any[];
  } catch { /* */ }

  for (let i = 0; i < monthsAhead; i++) {
    const m = new Date(today.getFullYear(), today.getMonth() + i, 1);
    const monthKey = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
    let gross = 0;
    for (const e of employees) {
      // Salaried: divide annual / 12. Hourly: assume default hours * rate * 4.33 weeks
      if (e.pay_type === 'salary') {
        gross += (e.pay_rate || 0) / 12;
      } else {
        gross += (e.pay_rate || 0) * 40 * 4.33;
      }
    }
    // Employer cost ≈ gross × 1.10 (SS+Medicare 7.65% + FUTA + benefits estimate)
    const employerCost = gross * 1.10;
    months.push({ month: monthKey, employees: employees.length, gross: round2(gross), employer_cost: round2(employerCost) });
  }
  return { months };
}

// ── F50: New-hire onboarding checklist ────────────────────────

export const DEFAULT_ONBOARDING_ITEMS = [
  { key: 'w4_collected', label: 'W-4 collected', due_offset_days: 0 },
  { key: 'i9_section_1', label: 'I-9 Section 1 completed by employee', due_offset_days: 0 },
  { key: 'i9_section_2', label: 'I-9 Section 2 completed (employer verify docs)', due_offset_days: 3 },
  { key: 'state_w4_collected', label: 'State withholding form collected', due_offset_days: 3 },
  { key: 'direct_deposit_setup', label: 'Direct deposit information collected', due_offset_days: 7 },
  { key: 'benefits_enrollment', label: 'Benefits enrollment completed', due_offset_days: 30 },
  { key: 'handbook_acknowledged', label: 'Employee handbook acknowledged', due_offset_days: 7 },
  { key: 'emergency_contact', label: 'Emergency contact form completed', due_offset_days: 7 },
  { key: 'equipment_issued', label: 'Equipment/laptop issued', due_offset_days: 0 },
  { key: 'system_access', label: 'System access provisioned', due_offset_days: 1 },
  { key: 'orientation_completed', label: 'Orientation completed', due_offset_days: 14 },
  { key: 'training_assigned', label: 'Initial training assigned', due_offset_days: 7 },
];

export function createOnboardingChecklist(companyId: string, employeeId: string, hireDate: string, templateId?: string): { created: number; items: any[] } {
  const dbi = db.getDb();
  let items = DEFAULT_ONBOARDING_ITEMS;
  if (templateId) {
    const tpl = dbi.prepare('SELECT items_json FROM onboarding_templates WHERE id = ?').get(templateId) as any;
    if (tpl) { try { items = JSON.parse(tpl.items_json); } catch { /* fallback */ } }
  }
  const hireD = new Date(hireDate + 'T00:00:00');
  const created: any[] = [];
  for (const item of items) {
    const due = new Date(hireD);
    due.setDate(due.getDate() + (item.due_offset_days || 0));
    const id = uuid();
    dbi.prepare(`INSERT INTO onboarding_assignments (id, company_id, employee_id, template_id, item_key, item_label, due_date) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, companyId, employeeId, templateId || null, item.key, item.label, due.toISOString().slice(0, 10));
    created.push(dbi.prepare('SELECT * FROM onboarding_assignments WHERE id = ?').get(id));
  }
  return { created: created.length, items: created };
}

export function completeOnboardingItem(id: string, completedBy: string, notes?: string): boolean {
  return db.getDb().prepare(`UPDATE onboarding_assignments SET completed = 1, completed_at = datetime('now'), completed_by = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`).run(completedBy, notes || '', id).changes > 0;
}

export function getOnboardingProgress(employeeId: string): { items: any[]; completed: number; total: number; pct: number; overdue: number } {
  const dbi = db.getDb();
  const items = dbi.prepare('SELECT * FROM onboarding_assignments WHERE employee_id = ? ORDER BY due_date').all(employeeId) as any[];
  const completed = items.filter((i) => i.completed === 1).length;
  const today = new Date().toISOString().slice(0, 10);
  const overdue = items.filter((i) => i.completed === 0 && i.due_date && i.due_date < today).length;
  return { items, completed, total: items.length, pct: items.length > 0 ? round2((completed / items.length) * 100) : 0, overdue };
}
