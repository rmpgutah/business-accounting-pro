// ─── Wave 3 Part 1: F351-F380 (30 features) ───
//
// Batch S: Payroll Deep-Dive (F351-F360)
// Batch T: Sales Tax Engine (F361-F370)
// Batch U: Multi-Entity Consolidation (F371-F380)

import { randomUUID as uuid } from 'crypto';
import * as db from '../database';

const now = (): string => new Date().toISOString();
const today = (): string => now().slice(0, 10);
const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;

// ════════════════════════════════════════════════════════════════
// Batch S: Payroll Deep-Dive (F351-F360)
// ════════════════════════════════════════════════════════════════

// F351 — state withholding lookup
export function upsertStateWithholding(t: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO state_withholding_tables (id, state_code, filing_status, income_low, income_high, base_tax, marginal_rate, standard_deduction, allowance_value, effective_year) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, t.state_code, t.filing_status, t.income_low || 0, t.income_high || 999999999, t.base_tax || 0, t.marginal_rate || 0, t.standard_deduction || 0, t.allowance_value || 0, t.effective_year);
  return { id };
}

export function calcStateWithholding(opts: { state_code: string; filing_status: string; annual_wages: number; allowances?: number; year?: number }): { tax: number; bracket: any | null } {
  const dbi = db.getDb();
  const year = opts.year || new Date().getFullYear();
  const brackets = dbi.prepare(`SELECT * FROM state_withholding_tables WHERE state_code = ? AND filing_status = ? AND effective_year = ? ORDER BY income_low`).all(opts.state_code, opts.filing_status, year) as any[];
  if (brackets.length === 0) return { tax: 0, bracket: null };
  // Subtract standard deduction + allowances
  const taxableIncome = Math.max(0, opts.annual_wages - (brackets[0].standard_deduction || 0) - ((opts.allowances || 0) * (brackets[0].allowance_value || 0)));
  for (const b of brackets) {
    if (taxableIncome >= b.income_low && taxableIncome <= b.income_high) {
      const tax = round2((b.base_tax || 0) + (taxableIncome - b.income_low) * (b.marginal_rate || 0) / 100);
      return { tax, bracket: b };
    }
  }
  return { tax: 0, bracket: null };
}

// F352 — garnishments
export function upsertGarnishment(g: any): { id: string } {
  const dbi = db.getDb();
  const id = g.id || uuid();
  if (g.id) {
    dbi.prepare(`UPDATE garnishments SET garnishment_type = ?, case_number = ?, creditor = ?, amount_per_period = ?, percent_of_disposable = ?, max_total = ?, end_date = ?, status = ?, priority = ?, notes = ?, updated_at = ? WHERE id = ?`)
      .run(g.garnishment_type, g.case_number, g.creditor, g.amount_per_period || 0, g.percent_of_disposable || 0, g.max_total, g.end_date, g.status, g.priority || 1, g.notes, now(), g.id);
  } else {
    dbi.prepare(`INSERT INTO garnishments (id, company_id, employee_id, garnishment_type, case_number, creditor, amount_per_period, percent_of_disposable, max_total, start_date, end_date, status, priority, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, g.company_id, g.employee_id, g.garnishment_type || 'wage', g.case_number, g.creditor, g.amount_per_period || 0, g.percent_of_disposable || 0, g.max_total, g.start_date || today(), g.end_date, g.status || 'active', g.priority || 1, g.notes, now(), now());
  }
  return { id };
}

export function calcGarnishmentDeductions(employeeId: string, disposableEarnings: number): { total_deducted: number; per_garnishment: any[]; remaining_balance: number } {
  const dbi = db.getDb();
  const active = dbi.prepare(`SELECT * FROM garnishments WHERE employee_id = ? AND status = 'active' ORDER BY priority`).all(employeeId) as any[];
  let totalDeducted = 0;
  const perGarn: any[] = [];
  for (const g of active) {
    let amount = g.amount_per_period || 0;
    if (g.percent_of_disposable > 0) {
      amount = Math.max(amount, disposableEarnings * g.percent_of_disposable / 100);
    }
    if (g.max_total && g.deducted_to_date + amount > g.max_total) {
      amount = Math.max(0, g.max_total - g.deducted_to_date);
    }
    amount = round2(amount);
    totalDeducted += amount;
    perGarn.push({ garnishment_id: g.id, amount });
  }
  return { total_deducted: round2(totalDeducted), per_garnishment: perGarn, remaining_balance: round2(disposableEarnings - totalDeducted) };
}

export function listGarnishments(companyId: string, opts?: { employee_id?: string; status?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.employee_id) { where += ' AND employee_id = ?'; params.push(opts.employee_id); }
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  return dbi.prepare(`SELECT * FROM garnishments WHERE ${where} ORDER BY priority`).all(...params) as any[];
}

// F353 — retirement contributions
export function upsertRetirement(r: any): { id: string } {
  const dbi = db.getDb();
  const id = r.id || uuid();
  if (r.id) {
    dbi.prepare(`UPDATE retirement_contributions SET plan_type = ?, contribution_percent = ?, contribution_amount_flat = ?, employer_match_percent = ?, employer_match_cap_percent = ?, annual_limit = ?, catch_up_eligible = ?, catch_up_amount = ?, vesting_schedule = ?, status = ?, updated_at = ? WHERE id = ?`)
      .run(r.plan_type, r.contribution_percent || 0, r.contribution_amount_flat || 0, r.employer_match_percent || 0, r.employer_match_cap_percent || 0, r.annual_limit || 23000, r.catch_up_eligible ? 1 : 0, r.catch_up_amount || 0, r.vesting_schedule, r.status, now(), r.id);
  } else {
    dbi.prepare(`INSERT INTO retirement_contributions (id, company_id, employee_id, plan_type, contribution_percent, contribution_amount_flat, employer_match_percent, employer_match_cap_percent, annual_limit, catch_up_eligible, catch_up_amount, vesting_schedule, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, r.company_id, r.employee_id, r.plan_type || '401k', r.contribution_percent || 0, r.contribution_amount_flat || 0, r.employer_match_percent || 0, r.employer_match_cap_percent || 0, r.annual_limit || 23000, r.catch_up_eligible ? 1 : 0, r.catch_up_amount || 0, r.vesting_schedule, 'active', now(), now());
  }
  return { id };
}

export function calcRetirementContribution(employeeId: string, periodWages: number): { employee_contribution: number; employer_match: number; total: number } {
  const dbi = db.getDb();
  const r = dbi.prepare(`SELECT * FROM retirement_contributions WHERE employee_id = ? AND status = 'active' LIMIT 1`).get(employeeId) as any;
  if (!r) return { employee_contribution: 0, employer_match: 0, total: 0 };
  const limit = (r.annual_limit || 0) + (r.catch_up_eligible ? (r.catch_up_amount || 0) : 0);
  let empContrib = r.contribution_amount_flat || (periodWages * (r.contribution_percent || 0) / 100);
  if (r.ytd_employee_contribution + empContrib > limit) empContrib = Math.max(0, limit - r.ytd_employee_contribution);
  const matchableWages = Math.min(periodWages, periodWages * (r.employer_match_cap_percent || 0) / 100);
  const employerMatch = matchableWages * (r.employer_match_percent || 0) / 100;
  return { employee_contribution: round2(empContrib), employer_match: round2(employerMatch), total: round2(empContrib + employerMatch) };
}

// F354 — Section 125 cafeteria plans
export function upsertSection125(s: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO section_125_plans (id, company_id, employee_id, benefit_type, employee_contribution_per_period, employer_contribution_per_period, is_pretax, annual_election, elected_at, effective_from, effective_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, s.company_id, s.employee_id, s.benefit_type, s.employee_contribution_per_period || 0, s.employer_contribution_per_period || 0, s.is_pretax === false ? 0 : 1, s.annual_election || 0, s.elected_at || now(), s.effective_from, s.effective_to);
  return { id };
}

export function listSection125ForEmployee(employeeId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM section_125_plans WHERE employee_id = ? AND (effective_to IS NULL OR effective_to >= date('now'))`).all(employeeId) as any[];
}

// F355 — PTO accrual rules + apply accrual
export function upsertPTORule(r: any): { id: string } {
  const id = r.id || uuid();
  const dbi = db.getDb();
  if (r.id) {
    dbi.prepare(`UPDATE pto_accrual_rules SET rule_name = ?, pto_type = ?, accrual_rate_hours_per_period = ?, accrual_frequency = ?, max_balance_hours = ?, carryover_max_hours = ?, eligibility_tenure_months = ?, applies_to_role = ?, is_active = ?, updated_at = ? WHERE id = ?`)
      .run(r.rule_name, r.pto_type, r.accrual_rate_hours_per_period || 0, r.accrual_frequency, r.max_balance_hours, r.carryover_max_hours, r.eligibility_tenure_months || 0, r.applies_to_role, r.is_active === false ? 0 : 1, now(), r.id);
  } else {
    dbi.prepare(`INSERT INTO pto_accrual_rules (id, company_id, rule_name, pto_type, accrual_rate_hours_per_period, accrual_frequency, max_balance_hours, carryover_max_hours, eligibility_tenure_months, applies_to_role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, r.company_id, r.rule_name, r.pto_type || 'vacation', r.accrual_rate_hours_per_period || 0, r.accrual_frequency || 'monthly', r.max_balance_hours, r.carryover_max_hours, r.eligibility_tenure_months || 0, r.applies_to_role, 1, now(), now());
  }
  return { id };
}

export function listPTORules(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM pto_accrual_rules WHERE company_id = ? AND is_active = 1`).all(companyId) as any[];
}

// F356 — multi-state employee allocation
export function setEmployeeStateAllocation(opts: { company_id: string; employee_id: string; allocations: Array<{ state_code: string; allocation_percent: number; is_resident?: boolean }> }): { saved: number } {
  const dbi = db.getDb();
  // Replace all existing for this employee
  dbi.prepare(`DELETE FROM employee_state_allocations WHERE employee_id = ?`).run(opts.employee_id);
  let saved = 0;
  const insert = dbi.prepare(`INSERT INTO employee_state_allocations (id, company_id, employee_id, state_code, allocation_percent, is_resident, effective_from, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const a of opts.allocations) {
    insert.run(uuid(), opts.company_id, opts.employee_id, a.state_code, a.allocation_percent, a.is_resident ? 1 : 0, today(), now());
    saved++;
  }
  return { saved };
}

export function getEmployeeStateAllocations(employeeId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM employee_state_allocations WHERE employee_id = ?`).all(employeeId) as any[];
}

// F357 — workers comp classes
export function upsertWorkersCompClass(c: any): { id: string; rate_per_100: number } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO workers_comp_classes (id, company_id, class_code, state_code, description, rate_per_100, effective_from, effective_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, c.company_id, c.class_code, c.state_code, c.description, c.rate_per_100 || 0, c.effective_from, c.effective_to);
  return { id, rate_per_100: c.rate_per_100 || 0 };
}

export function calcWorkersCompPremium(companyId: string, stateCode: string, classCode: string, payroll: number): number {
  const r = db.getDb().prepare(`SELECT rate_per_100 FROM workers_comp_classes WHERE company_id = ? AND state_code = ? AND class_code = ? AND (effective_to IS NULL OR effective_to >= date('now')) ORDER BY effective_from DESC LIMIT 1`).get(companyId, stateCode, classCode) as any;
  if (!r) return 0;
  return round2((payroll / 100) * r.rate_per_100);
}

// F358 — state reciprocity
export function upsertReciprocity(workState: string, residentState: string, hasReciprocity: boolean, certificateForm?: string): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO state_reciprocity (id, work_state, resident_state, has_reciprocity, certificate_form) VALUES (?, ?, ?, ?, ?) ON CONFLICT(work_state, resident_state) DO UPDATE SET has_reciprocity = excluded.has_reciprocity, certificate_form = excluded.certificate_form`)
    .run(id, workState, residentState, hasReciprocity ? 1 : 0, certificateForm);
  return { id };
}

export function hasReciprocity(workState: string, residentState: string): boolean {
  const r = db.getDb().prepare(`SELECT has_reciprocity FROM state_reciprocity WHERE work_state = ? AND resident_state = ?`).get(workState, residentState) as any;
  return !!r?.has_reciprocity;
}

// F359 — W-2 year end
export function createW2Run(opts: { company_id: string; tax_year: number; submitted_by?: string }): { id: string } {
  const dbi = db.getDb();
  // Aggregate from payroll history for the year
  const stats = (dbi.prepare(`
    SELECT COUNT(DISTINCT employee_id) AS empc, COALESCE(SUM(gross_wages), 0) AS total_wages,
      COALESCE(SUM(federal_withheld), 0) AS fed_wh,
      COALESCE(SUM(ss_withheld), 0) AS ss_wh,
      COALESCE(SUM(medicare_withheld), 0) AS med_wh
    FROM pay_stubs WHERE strftime('%Y', pay_period_end) = ?
  `).get(String(opts.tax_year)) || {}) as any;
  const id = uuid();
  dbi.prepare(`INSERT INTO w2_year_end_runs (id, company_id, tax_year, employee_count, total_wages, total_federal_withheld, total_ss_withheld, total_medicare_withheld, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?) ON CONFLICT(company_id, tax_year) DO UPDATE SET employee_count = excluded.employee_count, total_wages = excluded.total_wages, total_federal_withheld = excluded.total_federal_withheld`)
    .run(id, opts.company_id, opts.tax_year, stats.empc || 0, stats.total_wages || 0, stats.fed_wh || 0, stats.ss_wh || 0, stats.med_wh || 0, now());
  return { id };
}

// F360 — Direct deposit NACHA batch
export function buildNACHABatch(opts: { company_id: string; payroll_run_id?: string; batch_date: string; effective_date: string; deposits: Array<{ payee_name: string; routing_number: string; account_number_last4: string; account_type?: string; amount: number }> }): { id: string; nacha_content: string } {
  const id = uuid();
  let total = 0;
  for (const d of opts.deposits) total += d.amount;
  // Simplified NACHA-style header
  const lines = [
    `101 ${'IMMD'.padEnd(10)} ${opts.batch_date.replace(/-/g, '')} ${'BAP'.padEnd(15)}`,
    `5200${'BAP-PAYROLL'.padEnd(16)}${opts.effective_date.replace(/-/g, '')}`,
    ...opts.deposits.map(d => `622${d.routing_number}${d.account_number_last4.padStart(17, '0')}${String(Math.round(d.amount * 100)).padStart(10, '0')}${d.payee_name.padEnd(22)}`),
    `820${String(opts.deposits.length).padStart(6, '0')}${String(Math.round(total * 100)).padStart(12, '0')}`,
    `9${String(opts.deposits.length).padStart(6, '0')}`,
  ];
  const nachaContent = lines.join('\n');
  db.getDb().prepare(`INSERT INTO direct_deposit_batches (id, company_id, payroll_run_id, batch_date, effective_date, total_amount, item_count, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?)`)
    .run(id, opts.company_id, opts.payroll_run_id, opts.batch_date, opts.effective_date, round2(total), opts.deposits.length, now());
  return { id, nacha_content: nachaContent };
}

export function listDirectDepositBatches(companyId: string, limit: number = 50): any[] {
  return db.getDb().prepare(`SELECT * FROM direct_deposit_batches WHERE company_id = ? ORDER BY batch_date DESC LIMIT ?`).all(companyId, limit) as any[];
}

// ════════════════════════════════════════════════════════════════
// Batch T: Sales Tax Engine (F361-F370)
// ════════════════════════════════════════════════════════════════

// F361 — nexus tracking
export function upsertNexus(n: any): { id: string } {
  const dbi = db.getDb();
  const id = n.id || uuid();
  if (n.id) {
    dbi.prepare(`UPDATE sales_tax_nexus SET nexus_type = ?, threshold_amount = ?, threshold_transactions = ?, is_active = ?, registration_number = ?, notes = ? WHERE id = ?`)
      .run(n.nexus_type, n.threshold_amount, n.threshold_transactions, n.is_active ? 1 : 0, n.registration_number, n.notes, n.id);
  } else {
    dbi.prepare(`INSERT INTO sales_tax_nexus (id, company_id, state_code, nexus_type, threshold_amount, threshold_transactions, registration_number, is_active, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?) ON CONFLICT(company_id, state_code) DO UPDATE SET threshold_amount = excluded.threshold_amount, threshold_transactions = excluded.threshold_transactions, registration_number = excluded.registration_number`)
      .run(id, n.company_id, n.state_code, n.nexus_type || 'economic', n.threshold_amount || 100000, n.threshold_transactions || 200, n.registration_number, n.notes, now());
  }
  return { id };
}

export function evaluateNexus(companyId: string): Array<{ state_code: string; threshold_met: boolean; sales_pct: number; tx_pct: number; should_register: boolean }> {
  const dbi = db.getDb();
  const states = dbi.prepare(`SELECT * FROM sales_tax_nexus WHERE company_id = ?`).all(companyId) as any[];
  const result: any[] = [];
  for (const s of states) {
    const salesPct = s.threshold_amount ? (s.ytd_sales / s.threshold_amount) * 100 : 0;
    const txPct = s.threshold_transactions ? (s.ytd_transactions / s.threshold_transactions) * 100 : 0;
    const thresholdMet = salesPct >= 100 || txPct >= 100;
    result.push({ state_code: s.state_code, threshold_met: thresholdMet, sales_pct: round2(salesPct), tx_pct: round2(txPct), should_register: thresholdMet && !s.nexus_established_date });
  }
  return result;
}

// F362-F363 — jurisdiction rates lookup
export function upsertJurisdiction(j: any): { id: string; combined_rate: number } {
  const id = uuid();
  const combined = round2((j.state_rate || 0) + (j.county_rate || 0) + (j.city_rate || 0) + (j.special_rate || 0));
  db.getDb().prepare(`INSERT INTO sales_tax_jurisdictions (id, state_code, county, city, zip_code, state_rate, county_rate, city_rate, special_rate, combined_rate, effective_from, effective_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, j.state_code, j.county, j.city, j.zip_code, j.state_rate || 0, j.county_rate || 0, j.city_rate || 0, j.special_rate || 0, combined, j.effective_from, j.effective_to);
  return { id, combined_rate: combined };
}

export function lookupTaxRateByZip(zip: string): any | null {
  return db.getDb().prepare(`SELECT * FROM sales_tax_jurisdictions WHERE zip_code = ? ORDER BY effective_from DESC LIMIT 1`).get(zip) || null;
}

// F364 — exemption certificates
export function upsertExemptionCert(c: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO tax_exemption_certificates (id, company_id, customer_id, certificate_number, exemption_type, issuing_state, issue_date, expiration_date, file_path, is_active, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`)
    .run(id, c.company_id, c.customer_id, c.certificate_number, c.exemption_type || 'resale', c.issuing_state, c.issue_date, c.expiration_date, c.file_path, c.notes, now(), now());
  return { id };
}

export function isCustomerExempt(companyId: string, customerId: string, stateCode?: string): boolean {
  const dbi = db.getDb();
  const params: any[] = [companyId, customerId];
  let where = `company_id = ? AND customer_id = ? AND is_active = 1 AND (expiration_date IS NULL OR expiration_date >= date('now'))`;
  if (stateCode) { where += ' AND issuing_state = ?'; params.push(stateCode); }
  const r = dbi.prepare(`SELECT id FROM tax_exemption_certificates WHERE ${where} LIMIT 1`).get(...params);
  return !!r;
}

export function listExemptionCerts(companyId: string, opts?: { customer_id?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.customer_id) { where += ' AND customer_id = ?'; params.push(opts.customer_id); }
  return dbi.prepare(`SELECT * FROM tax_exemption_certificates WHERE ${where} ORDER BY expiration_date`).all(...params) as any[];
}

// F365 — use tax
export function recordUseTax(u: any): { id: string; use_tax_due: number } {
  const id = uuid();
  const taxDue = round2((u.taxable_amount || 0) * (u.rate || 0) / 100);
  db.getDb().prepare(`INSERT INTO use_tax_accruals (id, company_id, purchase_date, vendor_id, purchase_state, use_state, taxable_amount, rate, use_tax_due, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
    .run(id, u.company_id, u.purchase_date, u.vendor_id, u.purchase_state, u.use_state, u.taxable_amount || 0, u.rate || 0, taxDue, u.notes, now());
  return { id, use_tax_due: taxDue };
}

// F366 — filing schedule
export function upsertFilingSchedule(s: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO sales_tax_filing_schedule (id, company_id, state_code, filing_frequency, due_day_of_period, next_filing_due, is_active, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?) ON CONFLICT(company_id, state_code, filing_frequency) DO UPDATE SET due_day_of_period = excluded.due_day_of_period, next_filing_due = excluded.next_filing_due`)
    .run(id, s.company_id, s.state_code, s.filing_frequency || 'monthly', s.due_day_of_period || 20, s.next_filing_due, s.notes, now());
  return { id };
}

export function listUpcomingFilings(companyId: string, daysAhead: number = 30): any[] {
  return db.getDb().prepare(`SELECT * FROM sales_tax_filing_schedule WHERE company_id = ? AND is_active = 1 AND next_filing_due <= date('now', '+' || ? || ' days') ORDER BY next_filing_due`).all(companyId, daysAhead) as any[];
}

// F367-F368 — liability ledger + remittance
export function recordSalesTaxLiability(l: any): { id: string; net_due: number } {
  const id = uuid();
  const netDue = round2((l.tax_owed || 0) + (l.penalty || 0) - (l.discount_amount || 0) + (l.adjustments || 0));
  db.getDb().prepare(`INSERT INTO sales_tax_liability (id, company_id, state_code, period_start, period_end, taxable_sales, non_taxable_sales, tax_collected, tax_owed, adjustments, discount_amount, penalty, net_due, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`)
    .run(id, l.company_id, l.state_code, l.period_start, l.period_end, l.taxable_sales || 0, l.non_taxable_sales || 0, l.tax_collected || 0, l.tax_owed || 0, l.adjustments || 0, l.discount_amount || 0, l.penalty || 0, netDue, now());
  return { id, net_due: netDue };
}

export function markTaxPaid(id: string, paymentJeId?: string): boolean {
  const r = db.getDb().prepare(`UPDATE sales_tax_liability SET status = 'paid', paid_at = ?, payment_je_id = ?, paid_amount = net_due WHERE id = ?`).run(now(), paymentJeId, id);
  return r.changes > 0;
}

export function listTaxLiability(companyId: string, opts?: { state_code?: string; status?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.state_code) { where += ' AND state_code = ?'; params.push(opts.state_code); }
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  return dbi.prepare(`SELECT * FROM sales_tax_liability WHERE ${where} ORDER BY period_end DESC`).all(...params) as any[];
}

// F370 — sales tax holidays
export function upsertSalesTaxHoliday(h: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO sales_tax_holidays (id, state_code, holiday_name, start_date, end_date, eligible_categories, max_item_price, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, h.state_code, h.holiday_name, h.start_date, h.end_date, h.eligible_categories, h.max_item_price, h.notes);
  return { id };
}

export function listActiveSalesTaxHolidays(stateCode?: string): any[] {
  const dbi = db.getDb();
  const params: any[] = [];
  let where = `start_date <= date('now') AND end_date >= date('now')`;
  if (stateCode) { where += ' AND state_code = ?'; params.push(stateCode); }
  return dbi.prepare(`SELECT * FROM sales_tax_holidays WHERE ${where}`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// Batch U: Multi-Entity Consolidation (F371-F380)
// ════════════════════════════════════════════════════════════════

// F371 — parent-subsidiary hierarchy
export function setSubsidiary(parentId: string, childId: string, ownershipPct: number, method: string = 'full', notes?: string): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO entity_hierarchy (id, parent_company_id, child_company_id, ownership_percent, consolidation_method, effective_from, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(parent_company_id, child_company_id) DO UPDATE SET ownership_percent = excluded.ownership_percent, consolidation_method = excluded.consolidation_method, notes = excluded.notes`)
    .run(id, parentId, childId, ownershipPct, method, today(), notes, now());
  return { id };
}

export function getEntityHierarchy(parentId: string): any[] {
  return db.getDb().prepare(`SELECT eh.*, c.name AS child_name FROM entity_hierarchy eh LEFT JOIN companies c ON c.id = eh.child_company_id WHERE eh.parent_company_id = ?`).all(parentId) as any[];
}

// F372 — intercompany elimination rules
export function upsertElimRule(r: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO intercompany_elim_rules (id, parent_company_id, rule_name, debit_account_pattern, credit_account_pattern, elimination_account_id, is_active, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`)
    .run(id, r.parent_company_id, r.rule_name, r.debit_account_pattern, r.credit_account_pattern, r.elimination_account_id, r.notes, now());
  return { id };
}

export function listElimRules(parentId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM intercompany_elim_rules WHERE parent_company_id = ? AND is_active = 1`).all(parentId) as any[];
}

// F373-F374 — consolidated statements
export function generateConsolidatedStatement(opts: { parent_company_id: string; statement_type: 'balance_sheet' | 'income_statement'; period_end: string; generated_by?: string }): { id: string; consolidated_total: number } {
  const dbi = db.getDb();
  const subs = dbi.prepare(`SELECT * FROM entity_hierarchy WHERE parent_company_id = ? AND consolidation_method IN ('full','proportional')`).all(opts.parent_company_id) as any[];
  const companyIds = [opts.parent_company_id, ...subs.map((s: any) => s.child_company_id)];
  const placeholders = companyIds.map(() => '?').join(',');

  // Aggregate balances by account
  const acctTypeFilter = opts.statement_type === 'balance_sheet'
    ? "a.account_type IN ('asset','current_asset','fixed_asset','other_asset','liability','current_liability','long_term_liability','other_liability','equity')"
    : "a.account_type IN ('revenue','other_income','expense','other_expense','cost_of_sales')";

  const data = dbi.prepare(`
    SELECT a.account_type, a.code, a.name, je.company_id, COALESCE(SUM(jel.debit - jel.credit), 0) AS net
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.is_posted = 1 AND je.entry_date <= ?
    JOIN accounts a ON a.id = jel.account_id
    WHERE je.company_id IN (${placeholders}) AND ${acctTypeFilter}
    GROUP BY a.code, a.account_type, je.company_id
  `).all(opts.period_end, ...companyIds) as any[];

  // Roll up by account_type
  const rollup: Record<string, number> = {};
  let total = 0;
  for (const r of data) {
    rollup[r.account_type] = (rollup[r.account_type] || 0) + r.net;
    total += r.net;
  }

  const id = uuid();
  dbi.prepare(`INSERT INTO consolidated_statements (id, parent_company_id, statement_type, period_end, consolidated_data_json, generated_at, generated_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, opts.parent_company_id, opts.statement_type, opts.period_end, JSON.stringify({ rollup, by_company_data: data }), now(), opts.generated_by);
  return { id, consolidated_total: round2(total) };
}

// F375 — currency translation
export function recordCurrencyTranslation(t: any): { id: string; cta_adjustment: number } {
  const id = uuid();
  // CTA = (assets - liabilities) * (spot - historical)
  const cta = round2((t.subsidiary_equity || 0) * ((t.spot_rate || 0) - (t.historical_rate || 0)));
  db.getDb().prepare(`INSERT INTO currency_translations (id, company_id, period_end, functional_currency, reporting_currency, spot_rate, average_rate, historical_rate, cta_adjustment, method, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, t.company_id, t.period_end, t.functional_currency, t.reporting_currency || 'USD', t.spot_rate, t.average_rate, t.historical_rate, cta, t.method || 'current_rate', now());
  return { id, cta_adjustment: cta };
}

// F376 — minority interest
export function calcMinorityInterest(opts: { parent_company_id: string; subsidiary_company_id: string; period_end: string; subsidiary_equity: number }): { id: string; minority_interest_amount: number } {
  const dbi = db.getDb();
  const hierarchy = dbi.prepare(`SELECT ownership_percent FROM entity_hierarchy WHERE parent_company_id = ? AND child_company_id = ?`).get(opts.parent_company_id, opts.subsidiary_company_id) as any;
  if (!hierarchy) throw new Error('Subsidiary relationship not found');
  const minorityPct = 100 - (hierarchy.ownership_percent || 0);
  const amount = round2(opts.subsidiary_equity * minorityPct / 100);
  const id = uuid();
  dbi.prepare(`INSERT INTO minority_interests (id, parent_company_id, subsidiary_company_id, period_end, subsidiary_equity, minority_percent, minority_interest_amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, opts.parent_company_id, opts.subsidiary_company_id, opts.period_end, opts.subsidiary_equity, minorityPct, amount, now());
  return { id, minority_interest_amount: amount };
}

// F377 — goodwill tracking
export function recordGoodwill(g: any): { id: string; goodwill: number } {
  const id = uuid();
  const goodwill = round2((g.purchase_price || 0) - ((g.fair_value_assets || 0) - (g.fair_value_liabilities || 0)));
  db.getDb().prepare(`INSERT INTO goodwill_tracking (id, acquiring_company_id, acquired_company_id, acquisition_date, purchase_price, fair_value_assets, fair_value_liabilities, goodwill_initial, goodwill_current, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, g.acquiring_company_id, g.acquired_company_id, g.acquisition_date, g.purchase_price, g.fair_value_assets, g.fair_value_liabilities, goodwill, goodwill, g.notes, now());
  return { id, goodwill };
}

export function recordGoodwillImpairment(goodwillId: string, impairmentAmount: number): boolean {
  const r = db.getDb().prepare(`UPDATE goodwill_tracking SET goodwill_current = MAX(0, goodwill_current - ?), accumulated_impairment = accumulated_impairment + ?, last_test_date = ? WHERE id = ?`).run(impairmentAmount, impairmentAmount, today(), goodwillId);
  return r.changes > 0;
}

// F378 — equity method investments
export function upsertEquityInvestment(e: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO equity_method_investments (id, investor_company_id, investee_company_id, investee_name, ownership_percent, initial_investment, current_carrying_value, acquired_date, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, e.investor_company_id, e.investee_company_id, e.investee_name, e.ownership_percent, e.initial_investment, e.initial_investment, e.acquired_date, e.notes, now(), now());
  return { id };
}

export function recordEquityShareIncome(investmentId: string, investeeIncome: number): { share_amount: number; new_carrying_value: number } {
  const dbi = db.getDb();
  const inv = dbi.prepare(`SELECT * FROM equity_method_investments WHERE id = ?`).get(investmentId) as any;
  if (!inv) throw new Error('Investment not found');
  const share = round2(investeeIncome * (inv.ownership_percent || 0) / 100);
  const newCarrying = round2((inv.current_carrying_value || 0) + share);
  dbi.prepare(`UPDATE equity_method_investments SET cumulative_share_of_income = cumulative_share_of_income + ?, current_carrying_value = ?, updated_at = ? WHERE id = ?`).run(share, newCarrying, now(), investmentId);
  return { share_amount: share, new_carrying_value: newCarrying };
}

export function listEquityInvestments(investorCompanyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM equity_method_investments WHERE investor_company_id = ?`).all(investorCompanyId) as any[];
}
