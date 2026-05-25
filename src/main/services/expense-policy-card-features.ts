// ─── Expense Advanced Wave Part 1: F541-F590 (50 features) ───
//
// Batch AJ: Expense Policy Engine (F541-F550)
// Batch AK: Expense Templates & Auto-Fill (F551-F560)
// Batch AL: Corporate Card Management (F561-F570)
// Batch AM: Travel Expense Specialized (F571-F580)
// Batch AN: Mileage Advanced (F581-F590)

import { randomUUID as uuid } from 'crypto';
import * as db from '../database';

const now = (): string => new Date().toISOString();
const today = (): string => now().slice(0, 10);
const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;

// ════════════════════════════════════════════════════════════════
// Batch AJ: Expense Policy Engine (F541-F550)
// ════════════════════════════════════════════════════════════════

// F541 — upsert policy rule
export function upsertExpensePolicy(p: any): { id: string } {
  const dbi = db.getDb();
  const id = p.id || uuid();
  if (p.id) {
    dbi.prepare(`UPDATE expense_policies SET policy_name = ?, scope = ?, category_id = ?, vendor_id = ?, employee_id = ?, max_per_expense = ?, max_per_day = ?, max_per_month = ?, requires_receipt = ?, requires_approval_over = ?, enforcement = ?, is_active = ?, updated_at = ? WHERE id = ?`)
      .run(p.policy_name, p.scope || 'global', p.category_id, p.vendor_id, p.employee_id, p.max_per_expense, p.max_per_day, p.max_per_month, p.requires_receipt !== false ? 1 : 0, p.requires_approval_over || 0, p.enforcement || 'warn', p.is_active === false ? 0 : 1, now(), p.id);
  } else {
    dbi.prepare(`INSERT INTO expense_policies (id, company_id, policy_name, scope, category_id, vendor_id, employee_id, max_per_expense, max_per_day, max_per_month, requires_receipt, requires_approval_over, enforcement, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, p.company_id, p.policy_name, p.scope || 'global', p.category_id, p.vendor_id, p.employee_id, p.max_per_expense, p.max_per_day, p.max_per_month, p.requires_receipt !== false ? 1 : 0, p.requires_approval_over || 0, p.enforcement || 'warn', p.is_active === false ? 0 : 1, now(), now());
  }
  return { id };
}

export function listExpensePolicies(companyId: string, opts?: { scope?: string; active_only?: boolean }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.scope) { where += ' AND scope = ?'; params.push(opts.scope); }
  if (opts?.active_only) where += ' AND is_active = 1';
  return dbi.prepare(`SELECT * FROM expense_policies WHERE ${where}`).all(...params) as any[];
}

// F542-F543 — evaluate policy on submit
export function evaluatePolicies(opts: { company_id: string; expense_id: string; amount: number; category_id?: string; vendor_id?: string; employee_id?: string; has_receipt: boolean; date: string }): Array<{ policy_id: string; violation_type: string; message: string; severity: string }> {
  const dbi = db.getDb();
  // Match policies that apply to this expense (scope: global, category-specific, vendor-specific, employee-specific)
  const policies = dbi.prepare(`SELECT * FROM expense_policies WHERE company_id = ? AND is_active = 1 AND (
    scope = 'global'
    OR (scope = 'category' AND category_id = ?)
    OR (scope = 'vendor' AND vendor_id = ?)
    OR (scope = 'employee' AND employee_id = ?)
  )`).all(opts.company_id, opts.category_id, opts.vendor_id, opts.employee_id) as any[];

  const violations: any[] = [];
  for (const p of policies) {
    if (p.max_per_expense && opts.amount > p.max_per_expense) {
      violations.push({ policy_id: p.id, violation_type: 'max_per_expense', message: `Amount $${opts.amount.toFixed(2)} exceeds per-expense limit $${p.max_per_expense.toFixed(2)}`, severity: p.enforcement });
    }
    if (p.requires_receipt && !opts.has_receipt) {
      violations.push({ policy_id: p.id, violation_type: 'missing_receipt', message: 'Receipt required by policy', severity: p.enforcement });
    }
    if (p.requires_approval_over && opts.amount > p.requires_approval_over) {
      violations.push({ policy_id: p.id, violation_type: 'requires_approval', message: `Amount $${opts.amount.toFixed(2)} requires approval (threshold $${p.requires_approval_over.toFixed(2)})`, severity: 'info' });
    }
    // Daily / monthly limits — compare against ytd spend
    if (p.max_per_day && opts.employee_id) {
      const dayTotal = (dbi.prepare(`SELECT COALESCE(SUM(amount), 0) AS t FROM expenses WHERE company_id = ? AND employee_id = ? AND date = ? AND (deleted_at IS NULL OR deleted_at = '') AND id != ?`).get(opts.company_id, opts.employee_id, opts.date, opts.expense_id) as any).t;
      if (dayTotal + opts.amount > p.max_per_day) {
        violations.push({ policy_id: p.id, violation_type: 'max_per_day', message: `Daily total $${(dayTotal + opts.amount).toFixed(2)} exceeds daily limit $${p.max_per_day.toFixed(2)}`, severity: p.enforcement });
      }
    }
  }

  // Record violations
  for (const v of violations) {
    dbi.prepare(`INSERT INTO expense_policy_violations (id, company_id, expense_id, policy_id, violation_type, violation_message, severity, detected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(uuid(), opts.company_id, opts.expense_id, v.policy_id, v.violation_type, v.message, v.severity, now());
  }
  return violations;
}

export function acknowledgeViolation(id: string, userId: string): boolean {
  const r = db.getDb().prepare(`UPDATE expense_policy_violations SET acknowledged = 1, acknowledged_by = ?, acknowledged_at = ? WHERE id = ?`).run(userId, now(), id);
  return r.changes > 0;
}

export function listPolicyViolations(companyId: string, opts?: { expense_id?: string; acknowledged?: boolean }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.expense_id) { where += ' AND expense_id = ?'; params.push(opts.expense_id); }
  if (opts?.acknowledged !== undefined) { where += ' AND acknowledged = ?'; params.push(opts.acknowledged ? 1 : 0); }
  return dbi.prepare(`SELECT * FROM expense_policy_violations WHERE ${where} ORDER BY detected_at DESC`).all(...params) as any[];
}

// F548 — IRS mileage rate auto-update
export function upsertIRSRate(opts: { tax_year: number; business_rate: number; medical_rate?: number; moving_rate?: number; charitable_rate?: number; effective_from: string }): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO mileage_irs_rates (id, tax_year, business_rate, medical_rate, moving_rate, charitable_rate, effective_from) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(tax_year) DO UPDATE SET business_rate = excluded.business_rate, medical_rate = excluded.medical_rate, moving_rate = excluded.moving_rate, charitable_rate = excluded.charitable_rate, effective_from = excluded.effective_from`)
    .run(id, opts.tax_year, opts.business_rate, opts.medical_rate || 0, opts.moving_rate || 0, opts.charitable_rate || 14, opts.effective_from);
  return { id };
}

export function getCurrentIRSRate(taxYear?: number): { business_rate: number; medical_rate: number; charitable_rate: number } | null {
  const year = taxYear || new Date().getFullYear();
  return db.getDb().prepare(`SELECT business_rate, medical_rate, charitable_rate FROM mileage_irs_rates WHERE tax_year = ? OR effective_from <= date('now') ORDER BY tax_year DESC LIMIT 1`).get(year) as any || null;
}

// F549 — travel policy caps
export function upsertTravelCap(c: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO travel_policy_caps (id, company_id, destination_pattern, hotel_max_per_night, meals_max_per_day, incidentals_max_per_day, flight_class_max, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`)
    .run(id, c.company_id, c.destination_pattern, c.hotel_max_per_night, c.meals_max_per_day, c.incidentals_max_per_day, c.flight_class_max, now());
  return { id };
}

export function listTravelCaps(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM travel_policy_caps WHERE company_id = ? AND is_active = 1`).all(companyId) as any[];
}

// F550 — violation history per employee
export function violationsByEmployee(companyId: string, employeeId: string, monthsBack: number = 6): any[] {
  return db.getDb().prepare(`SELECT epv.*, e.description, e.amount FROM expense_policy_violations epv JOIN expenses e ON e.id = epv.expense_id WHERE epv.company_id = ? AND e.employee_id = ? AND epv.detected_at >= date('now', '-' || ? || ' months') ORDER BY epv.detected_at DESC`).all(companyId, employeeId, monthsBack) as any[];
}

// ════════════════════════════════════════════════════════════════
// Batch AK: Expense Templates & Auto-Fill (F551-F560)
// ════════════════════════════════════════════════════════════════

// F551-F552 — templates
export function saveExpenseTemplate(t: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO expense_templates_v2 (id, company_id, user_id, template_name, vendor_id, category_id, project_id, default_amount, description, is_tax_deductible, is_billable, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
    .run(id, t.company_id, t.user_id, t.template_name, t.vendor_id, t.category_id, t.project_id, t.default_amount || 0, t.description, t.is_tax_deductible !== false ? 1 : 0, t.is_billable ? 1 : 0, now(), now());
  return { id };
}

export function listExpenseTemplates(companyId: string, userId?: string): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ? AND is_active = 1';
  if (userId) { where += ' AND (user_id IS NULL OR user_id = ?)'; params.push(userId); }
  return dbi.prepare(`SELECT * FROM expense_templates_v2 WHERE ${where} ORDER BY use_count DESC, template_name`).all(...params) as any[];
}

// F553 — use template (increments counter)
export function useTemplate(templateId: string): any {
  const dbi = db.getDb();
  dbi.prepare(`UPDATE expense_templates_v2 SET use_count = use_count + 1, last_used_at = ?, updated_at = ? WHERE id = ?`).run(now(), now(), templateId);
  return dbi.prepare(`SELECT * FROM expense_templates_v2 WHERE id = ?`).get(templateId);
}

// F554 — suggested templates (top 5 by recent use)
export function suggestedTemplates(companyId: string, userId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM expense_templates_v2 WHERE company_id = ? AND (user_id IS NULL OR user_id = ?) AND is_active = 1 AND last_used_at IS NOT NULL ORDER BY last_used_at DESC LIMIT 5`).all(companyId, userId) as any[];
}

// F556 — subscription detection (detects recurring vendor charges)
export function detectSubscriptions(companyId: string, lookbackDays: number = 180): { detected: number; subscriptions: any[] } {
  const dbi = db.getDb();
  // Find vendors with 3+ similar-amount charges in the period
  const candidates = dbi.prepare(`
    SELECT vendor_id, ROUND(amount, 2) AS amt_rounded, COUNT(*) AS occurrences,
      MIN(date) AS first_date, MAX(date) AS last_date,
      (julianday(MAX(date)) - julianday(MIN(date))) / NULLIF(COUNT(*) - 1, 0) AS avg_days_between
    FROM expenses WHERE company_id = ? AND date >= date('now', '-' || ? || ' days') AND vendor_id IS NOT NULL
      AND (deleted_at IS NULL OR deleted_at = '')
    GROUP BY vendor_id, amt_rounded
    HAVING occurrences >= 3
  `).all(companyId, lookbackDays) as any[];

  const subscriptions: any[] = [];
  for (const c of candidates) {
    const days = c.avg_days_between || 0;
    let freq = 'irregular';
    if (days >= 25 && days <= 35) freq = 'monthly';
    else if (days >= 6 && days <= 8) freq = 'weekly';
    else if (days >= 13 && days <= 15) freq = 'biweekly';
    else if (days >= 85 && days <= 95) freq = 'quarterly';
    else if (days >= 360 && days <= 370) freq = 'annual';

    if (freq === 'irregular') continue;

    const annualMultiplier = freq === 'monthly' ? 12 : freq === 'weekly' ? 52 : freq === 'biweekly' ? 26 : freq === 'quarterly' ? 4 : 1;
    const annualCost = round2(c.amt_rounded * annualMultiplier);
    // Compute next expected date
    const lastDate = new Date(c.last_date + 'T12:00:00Z');
    lastDate.setUTCDate(lastDate.getUTCDate() + Math.round(days));
    const nextExpected = lastDate.toISOString().slice(0, 10);

    const id = uuid();
    dbi.prepare(`INSERT INTO subscription_detections (id, company_id, vendor_id, avg_amount, frequency, last_charge_date, next_expected_date, occurrence_count, annual_cost, is_confirmed, detected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`)
      .run(id, companyId, c.vendor_id, c.amt_rounded, freq, c.last_date, nextExpected, c.occurrences, annualCost, now());
    subscriptions.push({ id, vendor_id: c.vendor_id, amount: c.amt_rounded, frequency: freq, annual_cost: annualCost, occurrences: c.occurrences });
  }
  return { detected: subscriptions.length, subscriptions };
}

// F557 — subscription tracker summary
export function subscriptionAnnualSummary(companyId: string): { total_annual: number; subscription_count: number; by_subscription: any[] } {
  const dbi = db.getDb();
  const subs = dbi.prepare(`SELECT s.*, v.name AS vendor_name FROM subscription_detections s LEFT JOIN vendors v ON v.id = s.vendor_id WHERE s.company_id = ? AND s.is_cancelled = 0 ORDER BY s.annual_cost DESC`).all(companyId) as any[];
  const total = subs.reduce((s, x) => s + (x.annual_cost || 0), 0);
  return { total_annual: round2(total), subscription_count: subs.length, by_subscription: subs };
}

export function confirmSubscription(id: string, confirmed: boolean = true): boolean {
  const r = db.getDb().prepare(`UPDATE subscription_detections SET is_confirmed = ? WHERE id = ?`).run(confirmed ? 1 : 0, id);
  return r.changes > 0;
}

export function cancelSubscription(id: string): boolean {
  const r = db.getDb().prepare(`UPDATE subscription_detections SET is_cancelled = 1 WHERE id = ?`).run(id);
  return r.changes > 0;
}

// F560 — auto-tag rules engine
export function upsertAutoTagRule(r: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO auto_tag_rules (id, company_id, rule_name, description_pattern, vendor_pattern, amount_min, amount_max, tag_ids, category_id, project_id, priority, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
    .run(id, r.company_id, r.rule_name, r.description_pattern, r.vendor_pattern, r.amount_min, r.amount_max, (r.tag_ids || []).join(','), r.category_id, r.project_id, r.priority || 50, now());
  return { id };
}

export function applyAutoTagRules(opts: { company_id: string; expense_id: string; description: string; vendor_name?: string; amount: number }): { matched_rule_ids: string[]; suggested_tag_ids: string[]; suggested_category_id: string | null; suggested_project_id: string | null } {
  const dbi = db.getDb();
  const rules = dbi.prepare(`SELECT * FROM auto_tag_rules WHERE company_id = ? AND is_active = 1 ORDER BY priority DESC`).all(opts.company_id) as any[];
  const matched: string[] = [];
  const tags = new Set<string>();
  let category: string | null = null;
  let project: string | null = null;
  const descLower = opts.description.toLowerCase();
  const vendorLower = (opts.vendor_name || '').toLowerCase();
  for (const r of rules) {
    if (r.description_pattern && !descLower.includes(r.description_pattern.toLowerCase())) continue;
    if (r.vendor_pattern && !vendorLower.includes(r.vendor_pattern.toLowerCase())) continue;
    if (r.amount_min && opts.amount < r.amount_min) continue;
    if (r.amount_max && opts.amount > r.amount_max) continue;
    matched.push(r.id);
    (r.tag_ids || '').split(',').filter(Boolean).forEach((t: string) => tags.add(t));
    if (!category && r.category_id) category = r.category_id;
    if (!project && r.project_id) project = r.project_id;
    dbi.prepare(`UPDATE auto_tag_rules SET match_count = match_count + 1, last_matched_at = ? WHERE id = ?`).run(now(), r.id);
  }
  return { matched_rule_ids: matched, suggested_tag_ids: Array.from(tags), suggested_category_id: category, suggested_project_id: project };
}

export function listAutoTagRules(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM auto_tag_rules WHERE company_id = ? ORDER BY priority DESC, rule_name`).all(companyId) as any[];
}

// ════════════════════════════════════════════════════════════════
// Batch AL: Corporate Card Management (F561-F570)
// ════════════════════════════════════════════════════════════════

// F561 — register card
export function registerCorporateCard(c: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO corporate_cards (id, company_id, card_name, card_holder_user_id, card_holder_name, last4, brand, issuing_bank, credit_limit, available_credit, is_active, issued_date, expiration_month, expiration_year, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`)
    .run(id, c.company_id, c.card_name, c.card_holder_user_id, c.card_holder_name, c.last4, c.brand, c.issuing_bank, c.credit_limit || 0, c.credit_limit || 0, c.issued_date, c.expiration_month, c.expiration_year, c.notes, now(), now());
  return { id };
}

export function listCorporateCards(companyId: string, opts?: { active_only?: boolean; card_holder?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.active_only) where += ' AND is_active = 1';
  if (opts?.card_holder) { where += ' AND card_holder_user_id = ?'; params.push(opts.card_holder); }
  return dbi.prepare(`SELECT * FROM corporate_cards WHERE ${where}`).all(...params) as any[];
}

// F562 — match transaction to expense
export function matchCardTransaction(cardTxId: string, expenseId: string): boolean {
  const r = db.getDb().prepare(`UPDATE card_transactions SET matched_expense_id = ?, matched_at = ? WHERE id = ?`).run(expenseId, now(), cardTxId);
  return r.changes > 0;
}

// F563 — import card transactions
export function importCardTransactions(opts: { company_id: string; card_id: string; transactions: Array<{ transaction_date: string; posted_date?: string; amount: number; merchant_name: string; merchant_category?: string; description?: string; is_credit?: boolean }> }): { imported: number } {
  const dbi = db.getDb();
  const insert = dbi.prepare(`INSERT INTO card_transactions (id, company_id, card_id, transaction_date, posted_date, amount, merchant_name, merchant_category, description, is_credit, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let count = 0;
  const tx = dbi.transaction(() => {
    for (const t of opts.transactions) {
      insert.run(uuid(), opts.company_id, opts.card_id, t.transaction_date, t.posted_date || t.transaction_date, t.amount, t.merchant_name, t.merchant_category, t.description, t.is_credit ? 1 : 0, now());
      count++;
    }
  });
  tx();
  return { imported: count };
}

// F564 — card spend by user dashboard
export function cardSpendByUser(companyId: string, opts?: { from?: string; to?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = `cc.company_id = ? AND (ct.is_credit = 0 OR ct.is_credit IS NULL)`;
  if (opts?.from) { where += ' AND ct.transaction_date >= ?'; params.push(opts.from); }
  if (opts?.to) { where += ' AND ct.transaction_date <= ?'; params.push(opts.to); }
  return dbi.prepare(`SELECT cc.card_holder_user_id AS user_id, cc.card_holder_name AS user_name, COUNT(ct.id) AS tx_count, COALESCE(SUM(ct.amount), 0) AS total_spend, COUNT(CASE WHEN ct.matched_expense_id IS NULL THEN 1 END) AS unmatched_count FROM corporate_cards cc LEFT JOIN card_transactions ct ON ct.card_id = cc.id WHERE ${where} GROUP BY cc.card_holder_user_id, cc.card_holder_name ORDER BY total_spend DESC`).all(...params) as any[];
}

// F565 — unmatched card transactions queue
export function unmatchedCardTransactions(companyId: string, limit: number = 100): any[] {
  return db.getDb().prepare(`SELECT ct.*, cc.card_name, cc.last4 FROM card_transactions ct JOIN corporate_cards cc ON cc.id = ct.card_id WHERE ct.company_id = ? AND ct.matched_expense_id IS NULL AND (ct.is_credit = 0 OR ct.is_credit IS NULL) ORDER BY ct.transaction_date DESC LIMIT ?`).all(companyId, limit) as any[];
}

// F567 — disputes
export function disputeCardTransaction(opts: { company_id: string; card_transaction_id: string; dispute_reason: string; dispute_amount?: number }): { id: string } {
  const dbi = db.getDb();
  const tx = dbi.prepare(`SELECT amount FROM card_transactions WHERE id = ?`).get(opts.card_transaction_id) as any;
  const id = uuid();
  dbi.prepare(`INSERT INTO card_dispute_records (id, company_id, card_transaction_id, dispute_reason, dispute_amount, disputed_at, status) VALUES (?, ?, ?, ?, ?, ?, 'open')`)
    .run(id, opts.company_id, opts.card_transaction_id, opts.dispute_reason, opts.dispute_amount || tx?.amount || 0, now());
  dbi.prepare(`UPDATE card_transactions SET is_disputed = 1 WHERE id = ?`).run(opts.card_transaction_id);
  return { id };
}

// F568 — spend by merchant
export function cardSpendByMerchant(companyId: string, opts?: { from?: string; to?: string; limit?: number }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = `company_id = ? AND (is_credit = 0 OR is_credit IS NULL)`;
  if (opts?.from) { where += ' AND transaction_date >= ?'; params.push(opts.from); }
  if (opts?.to) { where += ' AND transaction_date <= ?'; params.push(opts.to); }
  return dbi.prepare(`SELECT merchant_name, COUNT(*) AS tx_count, COALESCE(SUM(amount), 0) AS total FROM card_transactions WHERE ${where} GROUP BY merchant_name ORDER BY total DESC LIMIT ?`).all(...params, opts?.limit || 25) as any[];
}

// F569 — reconcile (compute card balance from imported tx vs cleared expenses)
export function reconcileCard(cardId: string): { card_id: string; statement_balance: number; matched_expense_total: number; variance: number; unmatched_count: number } {
  const dbi = db.getDb();
  const stmt = (dbi.prepare(`SELECT COALESCE(SUM(amount), 0) AS bal FROM card_transactions WHERE card_id = ? AND (is_credit = 0 OR is_credit IS NULL)`).get(cardId) as any).bal;
  const matched = (dbi.prepare(`SELECT COALESCE(SUM(amount), 0) AS m FROM card_transactions WHERE card_id = ? AND matched_expense_id IS NOT NULL AND (is_credit = 0 OR is_credit IS NULL)`).get(cardId) as any).m;
  const unmatched = (dbi.prepare(`SELECT COUNT(*) AS n FROM card_transactions WHERE card_id = ? AND matched_expense_id IS NULL AND (is_credit = 0 OR is_credit IS NULL)`).get(cardId) as any).n;
  return { card_id: cardId, statement_balance: round2(stmt), matched_expense_total: round2(matched), variance: round2(stmt - matched), unmatched_count: unmatched };
}

// F570 — card spend rules
export function upsertCardSpendRule(r: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO card_spend_rules (id, company_id, card_id, rule_type, target_value, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)`)
    .run(id, r.company_id, r.card_id, r.rule_type || 'block_category', r.target_value, now());
  return { id };
}

// ════════════════════════════════════════════════════════════════
// Batch AM: Travel Expense Specialized (F571-F580)
// ════════════════════════════════════════════════════════════════

// F571 — trip create
export function createTrip(t: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO trips (id, company_id, user_id, trip_name, destination, start_date, end_date, purpose, total_budget, is_international, base_currency, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?)`)
    .run(id, t.company_id, t.user_id, t.trip_name, t.destination, t.start_date, t.end_date, t.purpose, t.total_budget || 0, t.is_international ? 1 : 0, t.base_currency || 'USD', t.notes, now(), now());
  return { id };
}

export function addExpenseToTrip(expenseId: string, tripId: string): boolean {
  const dbi = db.getDb();
  dbi.prepare(`UPDATE expenses SET trip_id = ?, updated_at = ? WHERE id = ?`).run(tripId, now(), expenseId);
  // Refresh trip totals
  const totals = dbi.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM expenses WHERE trip_id = ? AND (deleted_at IS NULL OR deleted_at = '')`).get(tripId) as any;
  dbi.prepare(`UPDATE trips SET expense_count = ?, total_actual = ?, updated_at = ? WHERE id = ?`).run(totals.n, totals.total, now(), tripId);
  return true;
}

// F572 — trip duration calculator
export function tripDays(tripId: string): { days: number; start_date: string; end_date: string } {
  const t = db.getDb().prepare(`SELECT start_date, end_date FROM trips WHERE id = ?`).get(tripId) as any;
  if (!t) throw new Error('Trip not found');
  const days = Math.ceil((new Date(t.end_date).getTime() - new Date(t.start_date).getTime()) / 86400000) + 1;
  return { days, start_date: t.start_date, end_date: t.end_date };
}

// F573 — trip per-diem auto-apply
export function applyTripPerDiem(opts: { trip_id: string; location: string; days: number; lodging_rate: number; meals_rate: number }): { id: string; total_amount: number } {
  const total = round2((opts.lodging_rate + opts.meals_rate) * opts.days);
  const id = uuid();
  db.getDb().prepare(`INSERT INTO trip_per_diem_settings (id, trip_id, location, days, lodging_rate, meals_rate, total_amount, applied) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`)
    .run(id, opts.trip_id, opts.location, opts.days, opts.lodging_rate, opts.meals_rate, total);
  return { id, total_amount: total };
}

// F574 — trip itinerary
export function addItineraryLeg(leg: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO trip_itinerary (id, trip_id, leg_number, leg_date, leg_type, from_location, to_location, arrival_time, departure_time, confirmation_number, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, leg.trip_id, leg.leg_number || 1, leg.leg_date, leg.leg_type, leg.from_location, leg.to_location, leg.arrival_time, leg.departure_time, leg.confirmation_number, leg.notes);
  return { id };
}

export function tripItinerary(tripId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM trip_itinerary WHERE trip_id = ? ORDER BY leg_number, leg_date`).all(tripId) as any[];
}

// F575 — trip pre-approval
export function preApproveTrip(tripId: string, approvedBy: string): boolean {
  const r = db.getDb().prepare(`UPDATE trips SET pre_approved = 1, pre_approved_by = ?, pre_approved_at = ?, updated_at = ? WHERE id = ?`).run(approvedBy, now(), now(), tripId);
  return r.changes > 0;
}

// F576 — trip cost summary
export function tripCostSummary(tripId: string): { trip_id: string; total_actual: number; budget: number; variance: number; expense_breakdown: any[]; per_diem_total: number } {
  const dbi = db.getDb();
  const t = dbi.prepare(`SELECT * FROM trips WHERE id = ?`).get(tripId) as any;
  if (!t) throw new Error('Trip not found');
  const byCategory = dbi.prepare(`SELECT c.name AS category_name, COUNT(*) AS n, COALESCE(SUM(e.amount), 0) AS total FROM expenses e LEFT JOIN categories c ON c.id = e.category_id WHERE e.trip_id = ? AND (e.deleted_at IS NULL OR e.deleted_at = '') GROUP BY c.id ORDER BY total DESC`).all(tripId) as any[];
  const perDiem = (dbi.prepare(`SELECT COALESCE(SUM(total_amount), 0) AS t FROM trip_per_diem_settings WHERE trip_id = ?`).get(tripId) as any).t;
  return { trip_id: tripId, total_actual: round2(t.total_actual), budget: round2(t.total_budget), variance: round2(t.total_actual - t.total_budget), expense_breakdown: byCategory, per_diem_total: round2(perDiem) };
}

export function listTrips(companyId: string, opts?: { user_id?: string; status?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.user_id) { where += ' AND user_id = ?'; params.push(opts.user_id); }
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  return dbi.prepare(`SELECT * FROM trips WHERE ${where} ORDER BY start_date DESC`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// Batch AN: Mileage Advanced (F581-F590)
// ════════════════════════════════════════════════════════════════

// F582 — state mileage rate
export function upsertStateMileageRate(opts: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO mileage_state_rates (id, state_code, rate_per_mile, effective_from, effective_to, notes) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, opts.state_code, opts.rate_per_mile, opts.effective_from, opts.effective_to, opts.notes);
  return { id };
}

// F583-F584 — multi-stop route
export function createMileageRoute(r: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO mileage_routes (id, company_id, expense_id, vehicle_id, user_id, route_date, purpose, total_miles, is_business, is_commute, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, r.company_id, r.expense_id, r.vehicle_id, r.user_id, r.route_date, r.purpose, r.total_miles || 0, r.is_business !== false ? 1 : 0, r.is_commute ? 1 : 0, now());
  return { id };
}

export function addRouteStop(s: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO mileage_route_stops (id, route_id, stop_order, location_address, arrival_time, miles_from_previous, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, s.route_id, s.stop_order || 1, s.location_address, s.arrival_time, s.miles_from_previous || 0, s.notes);
  return { id };
}

export function getRouteStops(routeId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM mileage_route_stops WHERE route_id = ? ORDER BY stop_order`).all(routeId) as any[];
}

// F586 — split business vs personal
export function splitMileage(opts: { total_miles: number; business_pct: number }): { business_miles: number; personal_miles: number } {
  return {
    business_miles: round2(opts.total_miles * (opts.business_pct / 100)),
    personal_miles: round2(opts.total_miles * (1 - opts.business_pct / 100)),
  };
}

// F587 — vehicle depreciation
export function upsertVehicleDepreciation(v: any): { id: string } {
  const dbi = db.getDb();
  const id = uuid();
  const annualDep = v.method === 'straight_line' ? round2(v.purchase_price / (v.useful_life_years || 5)) : 0;
  dbi.prepare(`INSERT INTO vehicle_depreciation (id, company_id, vehicle_id, purchase_price, purchase_date, useful_life_years, method, business_use_pct, annual_depreciation, accumulated_depreciation, last_calculated_year, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
    .run(id, v.company_id, v.vehicle_id, v.purchase_price || 0, v.purchase_date, v.useful_life_years || 5, v.method || 'straight_line', v.business_use_pct || 100, annualDep, new Date().getFullYear(), now());
  return { id };
}

// F588 — vehicle maintenance log
export function logVehicleMaintenance(m: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO vehicle_maintenance (id, company_id, vehicle_id, service_date, service_type, odometer_at_service, cost, vendor, expense_id, next_service_due_date, next_service_due_miles, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, m.company_id, m.vehicle_id, m.service_date, m.service_type, m.odometer_at_service, m.cost || 0, m.vendor, m.expense_id, m.next_service_due_date, m.next_service_due_miles, m.notes, now());
  return { id };
}

export function listVehicleMaintenance(vehicleId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM vehicle_maintenance WHERE vehicle_id = ? ORDER BY service_date DESC`).all(vehicleId) as any[];
}

export function upcomingMaintenanceDue(companyId: string, daysAhead: number = 60): any[] {
  return db.getDb().prepare(`SELECT vm.*, v.vehicle_name FROM vehicle_maintenance vm LEFT JOIN vehicles v ON v.id = vm.vehicle_id WHERE vm.company_id = ? AND vm.next_service_due_date BETWEEN date('now') AND date('now', '+' || ? || ' days') ORDER BY vm.next_service_due_date`).all(companyId, daysAhead) as any[];
}

// F590 — mileage method preference (per vehicle)
export function setMileageMethod(vehicleId: string, method: 'standard' | 'actual'): boolean {
  const r = db.getDb().prepare(`UPDATE vehicles SET mileage_method = ? WHERE id = ?`).run(method, vehicleId);
  return r.changes > 0;
}
