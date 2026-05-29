// ─── HR Suite Wave 3: 50 features (HR101–HR150) ──────────
//
// COBRA records, direct deposit accounts/batches, life event changes,
// W-2 year-end runs, check print runs, state reciprocity, payroll
// journal links, garnishments (legacy table), advanced employee
// analytics, scheduling/forecasting, and HR action workflows.

import { randomUUID as uuid } from 'crypto';
import * as db from '../database';

const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);
const round2 = (n: number) => Math.round((n || 0) * 100) / 100;

// ════════════════════════════════════════════════════════════
// HR101–HR106: COBRA Records CRUD + Workflow
// ════════════════════════════════════════════════════════════
export function listCobraRecords(companyId: string, employeeId?: string) {
  let sql = 'SELECT cr.*, e.name AS employee_name FROM cobra_records cr LEFT JOIN employees e ON e.id = cr.employee_id WHERE cr.company_id = ?';
  const p: any[] = [companyId]; if (employeeId) { sql += ' AND cr.employee_id = ?'; p.push(employeeId); }
  return db.getDb().prepare(sql + ' ORDER BY cr.event_date DESC').all(...p);
}
export function upsertCobraRecord(rec: any) {
  const dbi = db.getDb();
  if (rec.id) { dbi.prepare(`UPDATE cobra_records SET qualifying_event=?,event_date=?,notice_sent_at=?,election_deadline=?,coverage_start=?,coverage_end=?,monthly_premium=?,status=?,updated_at=datetime('now') WHERE id=?`).run(rec.qualifying_event, rec.event_date, rec.notice_sent_at || null, rec.election_deadline || null, rec.coverage_start || null, rec.coverage_end || null, rec.monthly_premium ?? 0, rec.status || 'pending', rec.id); return rec; }
  const id = uuid(); dbi.prepare(`INSERT INTO cobra_records (id, company_id, employee_id, qualifying_event, event_date, notice_sent_at, election_deadline, coverage_start, coverage_end, monthly_premium, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`).run(id, rec.company_id, rec.employee_id, rec.qualifying_event, rec.event_date, rec.notice_sent_at || null, rec.election_deadline || null, rec.coverage_start || null, rec.coverage_end || null, rec.monthly_premium ?? 0, rec.status || 'pending'); return { ...rec, id };
}
export function deleteCobraRecord(id: string) { db.getDb().prepare('DELETE FROM cobra_records WHERE id = ?').run(id); }
export function cobraPendingNotices(companyId: string) {
  return db.getDb().prepare(`SELECT cr.*, e.name AS employee_name FROM cobra_records cr LEFT JOIN employees e ON e.id = cr.employee_id WHERE cr.company_id = ? AND cr.notice_sent_at IS NULL AND cr.status = 'pending' ORDER BY cr.event_date`).all(companyId);
}
export function markCobraNoticeSent(id: string) {
  db.getDb().prepare(`UPDATE cobra_records SET notice_sent_at = datetime('now'), election_deadline = date('now', '+60 days'), status = 'notified', updated_at = datetime('now') WHERE id = ?`).run(id);
}
export function cobraSummary(companyId: string) {
  const dbi = db.getDb();
  const total = (dbi.prepare('SELECT COUNT(*) c FROM cobra_records WHERE company_id = ?').get(companyId) as any)?.c || 0;
  const pending = (dbi.prepare(`SELECT COUNT(*) c FROM cobra_records WHERE company_id = ? AND status = 'pending'`).get(companyId) as any)?.c || 0;
  const active = (dbi.prepare(`SELECT COUNT(*) c FROM cobra_records WHERE company_id = ? AND status IN ('elected','active')`).get(companyId) as any)?.c || 0;
  const monthlyRevenue = (dbi.prepare(`SELECT COALESCE(SUM(monthly_premium),0) t FROM cobra_records WHERE company_id = ? AND status IN ('elected','active')`).get(companyId) as any)?.t || 0;
  return { total, pending, activeCoverage: active, monthlyPremiumIncome: round2(monthlyRevenue) };
}

// ════════════════════════════════════════════════════════════
// HR107–HR112: Direct Deposit Accounts + Batches
// ════════════════════════════════════════════════════════════
export function listDirectDepositAccounts(companyId: string, employeeId?: string) {
  let sql = 'SELECT dda.*, e.name AS employee_name FROM direct_deposit_accounts dda LEFT JOIN employees e ON e.id = dda.employee_id WHERE dda.company_id = ?';
  const p: any[] = [companyId]; if (employeeId) { sql += ' AND dda.employee_id = ?'; p.push(employeeId); }
  return db.getDb().prepare(sql + ' ORDER BY dda.priority').all(...p);
}
export function upsertDirectDeposit(acct: any) {
  const dbi = db.getDb();
  if (acct.id) { dbi.prepare(`UPDATE direct_deposit_accounts SET routing_last4=?,account_last4=?,account_type=?,allocation_type=?,allocation_value=?,priority=?,bank_name=?,verified=?,active=?,updated_at=datetime('now') WHERE id=?`).run(acct.routing_last4, acct.account_last4, acct.account_type || 'checking', acct.allocation_type || 'remainder', acct.allocation_value ?? 100, acct.priority ?? 1, acct.bank_name || '', acct.verified ? 1 : 0, acct.active !== false ? 1 : 0, acct.id); return acct; }
  const id = uuid(); dbi.prepare(`INSERT INTO direct_deposit_accounts (id, company_id, employee_id, routing_last4, account_last4, account_type, allocation_type, allocation_value, priority, bank_name, verified, active, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,datetime('now'))`).run(id, acct.company_id, acct.employee_id, acct.routing_last4 || '', acct.account_last4 || '', acct.account_type || 'checking', acct.allocation_type || 'remainder', acct.allocation_value ?? 100, acct.priority ?? 1, acct.bank_name || '', acct.verified ? 1 : 0); return { ...acct, id };
}
export function deleteDirectDeposit(id: string) { db.getDb().prepare('DELETE FROM direct_deposit_accounts WHERE id = ?').run(id); }
export function listDirectDepositBatches(companyId: string) {
  return db.getDb().prepare('SELECT * FROM direct_deposit_batches WHERE company_id = ? ORDER BY batch_date DESC').all(companyId);
}
export function createDirectDepositBatch(batch: any) {
  const id = uuid(); db.getDb().prepare(`INSERT INTO direct_deposit_batches (id, company_id, payroll_run_id, batch_date, effective_date, total_amount, item_count, status, created_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))`).run(id, batch.company_id, batch.payroll_run_id || null, batch.batch_date || today(), batch.effective_date || today(), batch.total_amount ?? 0, batch.item_count ?? 0, 'draft'); return { id };
}
export function submitDirectDepositBatch(id: string) {
  db.getDb().prepare(`UPDATE direct_deposit_batches SET status = 'submitted', submitted_at = datetime('now') WHERE id = ?`).run(id);
}

// ════════════════════════════════════════════════════════════
// HR113–HR117: Life Event Changes
// ════════════════════════════════════════════════════════════
export function listLifeEvents(companyId: string, employeeId?: string) {
  let sql = 'SELECT lec.*, e.name AS employee_name FROM life_event_changes lec LEFT JOIN employees e ON e.id = lec.employee_id WHERE lec.company_id = ?';
  const p: any[] = [companyId]; if (employeeId) { sql += ' AND lec.employee_id = ?'; p.push(employeeId); }
  return db.getDb().prepare(sql + ' ORDER BY lec.event_date DESC').all(...p);
}
export function createLifeEvent(evt: any) {
  const id = uuid(); const windowEnd = evt.benefits_window_end || new Date(new Date(evt.event_date || today()).getTime() + 30 * 86400000).toISOString().slice(0, 10);
  db.getDb().prepare(`INSERT INTO life_event_changes (id, company_id, employee_id, event_type, event_date, benefits_window_end, documentation_path, benefits_updated, notes, created_at) VALUES (?,?,?,?,?,?,?,0,?,datetime('now'))`).run(id, evt.company_id, evt.employee_id, evt.event_type, evt.event_date || today(), windowEnd, evt.documentation_path || null, evt.notes || '');
  return { id, benefits_window_end: windowEnd };
}
export function markLifeEventProcessed(id: string) {
  db.getDb().prepare(`UPDATE life_event_changes SET benefits_updated = 1, updated_at = datetime('now') WHERE id = ?`).run(id);
}
export function pendingLifeEvents(companyId: string) {
  return db.getDb().prepare(`SELECT lec.*, e.name AS employee_name FROM life_event_changes lec LEFT JOIN employees e ON e.id = lec.employee_id WHERE lec.company_id = ? AND lec.benefits_updated = 0 AND lec.benefits_window_end >= date('now') ORDER BY lec.benefits_window_end`).all(companyId);
}
export function deleteLifeEvent(id: string) { db.getDb().prepare('DELETE FROM life_event_changes WHERE id = ?').run(id); }

// ════════════════════════════════════════════════════════════
// HR118–HR122: W-2 Year-End Runs
// ════════════════════════════════════════════════════════════
export function listW2Runs(companyId: string) { return db.getDb().prepare('SELECT * FROM w2_year_end_runs WHERE company_id = ? ORDER BY tax_year DESC').all(companyId); }
export function getW2Run(companyId: string, year: number) { return db.getDb().prepare('SELECT * FROM w2_year_end_runs WHERE company_id = ? AND tax_year = ?').get(companyId, year); }
export function generateW2Run(companyId: string, year: number) {
  const dbi = db.getDb();
  const stubs = dbi.prepare(`SELECT employee_id, SUM(gross_pay) AS wages, SUM(COALESCE(federal_tax,0)) AS fed, SUM(COALESCE(social_security_tax,0)) AS ss, SUM(COALESCE(medicare_tax,0)) AS med FROM pay_stubs WHERE company_id = ? AND strftime('%Y', pay_date) = ? GROUP BY employee_id`).all(companyId, String(year)) as any[];
  const totalWages = stubs.reduce((s, r) => s + (r.wages || 0), 0);
  const totalFed = stubs.reduce((s, r) => s + (r.fed || 0), 0);
  const totalSS = stubs.reduce((s, r) => s + (r.ss || 0), 0);
  const totalMed = stubs.reduce((s, r) => s + (r.med || 0), 0);
  const existing = dbi.prepare('SELECT id FROM w2_year_end_runs WHERE company_id = ? AND tax_year = ?').get(companyId, year) as any;
  if (existing) {
    dbi.prepare(`UPDATE w2_year_end_runs SET employee_count=?,total_wages=?,total_federal_withheld=?,total_ss_withheld=?,total_medicare_withheld=?,status='draft' WHERE id=?`).run(stubs.length, round2(totalWages), round2(totalFed), round2(totalSS), round2(totalMed), existing.id);
    return { id: existing.id, updated: true, employees: stubs.length };
  }
  const id = uuid(); dbi.prepare(`INSERT INTO w2_year_end_runs (id, company_id, tax_year, employee_count, total_wages, total_federal_withheld, total_ss_withheld, total_medicare_withheld, status, created_at) VALUES (?,?,?,?,?,?,?,?,'draft',datetime('now'))`).run(id, companyId, year, stubs.length, round2(totalWages), round2(totalFed), round2(totalSS), round2(totalMed));
  return { id, created: true, employees: stubs.length };
}
export function submitW2Run(id: string, submittedBy: string) {
  db.getDb().prepare(`UPDATE w2_year_end_runs SET status = 'submitted', submitted_at = datetime('now'), submitted_by = ? WHERE id = ?`).run(submittedBy, id);
}
export function w2PerEmployeeDetail(companyId: string, year: number) {
  return db.getDb().prepare(`SELECT ps.employee_id, e.name, e.ssn_last4, SUM(ps.gross_pay) AS total_wages, SUM(COALESCE(ps.federal_tax,0)) AS federal_withheld, SUM(COALESCE(ps.social_security_tax,0)) AS ss_withheld, SUM(COALESCE(ps.medicare_tax,0)) AS medicare_withheld, SUM(COALESCE(ps.state_tax,0)) AS state_withheld FROM pay_stubs ps JOIN employees e ON e.id = ps.employee_id WHERE ps.company_id = ? AND strftime('%Y', ps.pay_date) = ? GROUP BY ps.employee_id ORDER BY e.name`).all(companyId, String(year));
}

// ════════════════════════════════════════════════════════════
// HR123–HR126: Check Print Runs
// ════════════════════════════════════════════════════════════
export function listCheckPrintRuns(companyId: string) { return db.getDb().prepare('SELECT * FROM check_print_runs WHERE company_id = ? ORDER BY created_at DESC').all(companyId); }
export function createCheckPrintRun(run: any) {
  const id = uuid(); db.getDb().prepare(`INSERT INTO check_print_runs (id, company_id, pay_run_id, starting_check_number, check_count, total_amount, bank_account_id, status, created_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))`).run(id, run.company_id, run.pay_run_id, run.starting_check_number ?? 1001, run.check_count ?? 0, run.total_amount ?? 0, run.bank_account_id || null, 'pending'); return { id };
}
export function markChecksPrinted(id: string) { db.getDb().prepare(`UPDATE check_print_runs SET status = 'printed', printed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(id); }
export function voidCheckRun(id: string) { db.getDb().prepare(`UPDATE check_print_runs SET status = 'voided', voided_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(id); }

// ════════════════════════════════════════════════════════════
// HR127–HR130: State Reciprocity + Payroll Journal Links
// ════════════════════════════════════════════════════════════
export function listStateReciprocity() { return db.getDb().prepare('SELECT * FROM state_reciprocity ORDER BY work_state, resident_state').all(); }
export function checkReciprocity(workState: string, residentState: string) {
  const r = db.getDb().prepare('SELECT * FROM state_reciprocity WHERE work_state = ? AND resident_state = ?').get(workState, residentState) as any;
  return r ? { hasReciprocity: !!r.has_reciprocity, certificateForm: r.certificate_form, notes: r.notes } : { hasReciprocity: false, certificateForm: null, notes: 'No reciprocity record found' };
}
export function listPayrollJournalLinks(companyId: string) { return db.getDb().prepare('SELECT pjl.*, pr.pay_period_start, pr.pay_period_end FROM payroll_journal_links pjl LEFT JOIN payroll_runs pr ON pr.id = pjl.pay_run_id WHERE pjl.company_id = ? ORDER BY pjl.posted_at DESC').all(companyId); }
export function createPayrollJournalLink(link: any) {
  const id = uuid(); db.getDb().prepare(`INSERT INTO payroll_journal_links (id, company_id, pay_run_id, journal_entry_id, posted_at, debit_total, credit_total, created_at) VALUES (?,?,?,?,datetime('now'),?,?,datetime('now'))`).run(id, link.company_id, link.pay_run_id, link.journal_entry_id, link.debit_total ?? 0, link.credit_total ?? 0); return { id };
}

// ════════════════════════════════════════════════════════════
// HR131–HR135: Legacy Garnishments CRUD (the older table)
// ════════════════════════════════════════════════════════════
export function listGarnishments(companyId: string, employeeId?: string) {
  let sql = 'SELECT g.*, e.name AS employee_name FROM garnishments g LEFT JOIN employees e ON e.id = g.employee_id WHERE g.company_id = ?';
  const p: any[] = [companyId]; if (employeeId) { sql += ' AND g.employee_id = ?'; p.push(employeeId); }
  return db.getDb().prepare(sql + ' ORDER BY g.priority').all(...p);
}
export function upsertGarnishment(g: any) {
  const dbi = db.getDb();
  if (g.id) { dbi.prepare(`UPDATE garnishments SET garnishment_type=?,case_number=?,creditor=?,amount_per_period=?,percent_of_disposable=?,max_total=?,start_date=?,end_date=?,status=?,priority=?,notes=?,updated_at=datetime('now') WHERE id=?`).run(g.garnishment_type || 'wage', g.case_number || '', g.creditor || '', g.amount_per_period ?? 0, g.percent_of_disposable ?? 0, g.max_total ?? null, g.start_date || null, g.end_date || null, g.status || 'active', g.priority ?? 1, g.notes || '', g.id); return g; }
  const id = uuid(); dbi.prepare(`INSERT INTO garnishments (id, company_id, employee_id, garnishment_type, case_number, creditor, amount_per_period, percent_of_disposable, max_total, deducted_to_date, start_date, end_date, status, priority, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,datetime('now'))`).run(id, g.company_id, g.employee_id, g.garnishment_type || 'wage', g.case_number || '', g.creditor || '', g.amount_per_period ?? 0, g.percent_of_disposable ?? 0, g.max_total ?? null, g.start_date || null, g.end_date || null, g.status || 'active', g.priority ?? 1, g.notes || ''); return { ...g, id };
}
export function deleteGarnishment(id: string) { db.getDb().prepare('DELETE FROM garnishments WHERE id = ?').run(id); }
export function recordGarnishmentPayment(id: string, amount: number) {
  db.getDb().prepare(`UPDATE garnishments SET deducted_to_date = COALESCE(deducted_to_date,0) + ?, updated_at = datetime('now') WHERE id = ?`).run(round2(amount), id);
  const g = db.getDb().prepare('SELECT * FROM garnishments WHERE id = ?').get(id) as any;
  if (g?.max_total && (g.deducted_to_date || 0) >= g.max_total) db.getDb().prepare(`UPDATE garnishments SET status = 'completed', end_date = ?, updated_at = datetime('now') WHERE id = ?`).run(today(), id);
}
export function activeGarnishmentTotal(companyId: string) {
  const r = db.getDb().prepare(`SELECT COALESCE(SUM(amount_per_period),0) AS per_period, COUNT(*) AS count, COUNT(DISTINCT employee_id) AS employees FROM garnishments WHERE company_id = ? AND status = 'active'`).get(companyId) as any;
  return { perPeriodTotal: round2(r?.per_period || 0), activeCount: r?.count || 0, affectedEmployees: r?.employees || 0 };
}

// ════════════════════════════════════════════════════════════
// HR136–HR140: Advanced Payroll Analytics
// ════════════════════════════════════════════════════════════
export function payrollByMonth(companyId: string, months = 12) {
  const results: any[] = [];
  const dbi = db.getDb();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const r = dbi.prepare(`SELECT COALESCE(SUM(gross_pay),0) AS gross, COALESCE(SUM(net_pay),0) AS net, COALESCE(SUM(total_taxes),0) AS taxes, COUNT(*) AS stubs FROM pay_stubs WHERE company_id = ? AND substr(pay_date,1,7) = ?`).get(companyId, ym) as any;
    results.push({ month: ym, gross: round2(r?.gross || 0), net: round2(r?.net || 0), taxes: round2(r?.taxes || 0), stubs: r?.stubs || 0 });
  }
  return results;
}
export function avgPayByDepartment(companyId: string) {
  return db.getDb().prepare(`SELECT COALESCE(NULLIF(department,''),'Unassigned') AS department, pay_type, ROUND(AVG(pay_rate),2) AS avg_rate, COUNT(*) AS count FROM employees WHERE company_id = ? AND status = 'active' GROUP BY department, pay_type ORDER BY department`).all(companyId);
}
export function payrollTaxLiability(companyId: string, year?: number) {
  const y = year || new Date().getFullYear();
  return db.getDb().prepare(`SELECT SUM(COALESCE(federal_tax,0)) AS federal, SUM(COALESCE(social_security_tax,0)) AS ss, SUM(COALESCE(medicare_tax,0)) AS medicare, SUM(COALESCE(state_tax,0)) AS state, SUM(COALESCE(total_taxes,0)) AS total FROM pay_stubs WHERE company_id = ? AND strftime('%Y', pay_date) = ?`).get(companyId, String(y));
}
export function highestPaidByDepartment(companyId: string) {
  return db.getDb().prepare(`SELECT e.*, ROW_NUMBER() OVER (PARTITION BY COALESCE(NULLIF(department,''),'Unassigned') ORDER BY CASE WHEN pay_type='salary' THEN pay_rate ELSE pay_rate*2080 END DESC) AS rank FROM employees e WHERE e.company_id = ? AND e.status = 'active'`).all(companyId).filter((r: any) => r.rank === 1);
}
export function payStubSearch(companyId: string, opts: { employeeId?: string; startDate?: string; endDate?: string; limit?: number }) {
  let sql = 'SELECT ps.*, e.name AS employee_name FROM pay_stubs ps LEFT JOIN employees e ON e.id = ps.employee_id WHERE ps.company_id = ?';
  const p: any[] = [companyId];
  if (opts.employeeId) { sql += ' AND ps.employee_id = ?'; p.push(opts.employeeId); }
  if (opts.startDate) { sql += ' AND ps.pay_date >= ?'; p.push(opts.startDate); }
  if (opts.endDate) { sql += ' AND ps.pay_date <= ?'; p.push(opts.endDate); }
  sql += ' ORDER BY ps.pay_date DESC LIMIT ?';
  p.push(opts.limit || 50);
  return db.getDb().prepare(sql).all(...p);
}

// ════════════════════════════════════════════════════════════
// HR141–HR145: Workforce Planning + Forecasting
// ════════════════════════════════════════════════════════════
export function headcountForecast(companyId: string, monthsAhead = 6) {
  const dbi = db.getDb();
  const current = (dbi.prepare(`SELECT COUNT(*) c FROM employees WHERE company_id = ? AND status = 'active'`).get(companyId) as any)?.c || 0;
  const avgMonthlyHires = (dbi.prepare(`SELECT COUNT(*) / 12.0 AS avg FROM employees WHERE company_id = ? AND start_date >= date('now','-365 days')`).get(companyId) as any)?.avg || 0;
  const avgMonthlyTerms = (dbi.prepare(`SELECT COUNT(*) / 12.0 AS avg FROM employees WHERE company_id = ? AND status = 'inactive' AND end_date >= date('now','-365 days')`).get(companyId) as any)?.avg || 0;
  const forecast: any[] = [];
  let projected = current;
  for (let i = 1; i <= monthsAhead; i++) {
    projected = Math.round(projected + avgMonthlyHires - avgMonthlyTerms);
    const d = new Date(); d.setMonth(d.getMonth() + i);
    forecast.push({ month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, projected });
  }
  return { currentHeadcount: current, avgMonthlyHires: round2(avgMonthlyHires), avgMonthlyTerminations: round2(avgMonthlyTerms), forecast };
}
export function laborBudgetVariance(companyId: string) {
  const dbi = db.getDb();
  const actualMonthly = (dbi.prepare(`SELECT COALESCE(SUM(gross_pay),0) t FROM pay_stubs WHERE company_id = ? AND substr(pay_date,1,7) = substr(date('now'),1,7)`).get(companyId) as any)?.t || 0;
  const budgeted = (dbi.prepare(`SELECT COALESCE(SUM(bl.amount),0) t FROM budget_lines bl JOIN budgets b ON b.id = bl.budget_id WHERE b.company_id = ? AND b.status = 'active' AND lower(bl.category) LIKE '%payroll%'`).get(companyId) as any)?.t || 0;
  return { actualMonthlyPayroll: round2(actualMonthly), budgetedPayroll: round2(budgeted), variance: round2(actualMonthly - budgeted), overBudget: actualMonthly > budgeted };
}
export function departmentStaffingLevels(companyId: string) {
  return db.getDb().prepare(`SELECT COALESCE(NULLIF(department,''),'Unassigned') AS department, SUM(CASE WHEN employment_type = 'full-time' THEN 1 ELSE 0 END) AS full_time, SUM(CASE WHEN employment_type = 'part-time' THEN 1 ELSE 0 END) AS part_time, SUM(CASE WHEN employment_type = 'contractor' OR type = 'contractor' THEN 1 ELSE 0 END) AS contractors, COUNT(*) AS total FROM employees WHERE company_id = ? AND status = 'active' GROUP BY department ORDER BY total DESC`).all(companyId);
}
export function fteCount(companyId: string) {
  const dbi = db.getDb();
  const ft = (dbi.prepare(`SELECT COUNT(*) c FROM employees WHERE company_id = ? AND status = 'active' AND employment_type = 'full-time'`).get(companyId) as any)?.c || 0;
  const pt = (dbi.prepare(`SELECT COUNT(*) c FROM employees WHERE company_id = ? AND status = 'active' AND employment_type = 'part-time'`).get(companyId) as any)?.c || 0;
  return { fullTime: ft, partTime: pt, estimatedFTE: round2(ft + pt * 0.5), totalHeadcount: ft + pt };
}
export function seasonalHiringPattern(companyId: string) {
  return db.getDb().prepare(`SELECT substr(start_date,6,2) AS month, COUNT(*) AS hires FROM employees WHERE company_id = ? AND start_date IS NOT NULL GROUP BY month ORDER BY month`).all(companyId);
}

// ════════════════════════════════════════════════════════════
// HR146–HR150: HR Action Log + Misc
// ════════════════════════════════════════════════════════════
export function hrActionLog(companyId: string, days = 30) {
  return db.getDb().prepare(`SELECT * FROM audit_log WHERE company_id = ? AND entity_type IN ('employees','employee_equipment','employee_reviews','employee_disciplinary','employee_credentials','employee_checklist_items','benefit_enrollments','time_off_requests','garnishment_orders','cobra_records') AND created_at >= datetime('now', '-' || ? || ' days') ORDER BY created_at DESC LIMIT 100`).all(companyId, days);
}
export function employeeCostBreakdown(employeeId: string) {
  const dbi = db.getDb();
  const emp = dbi.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId) as any;
  if (!emp) return null;
  const annualPay = emp.pay_type === 'salary' ? emp.pay_rate : (emp.pay_rate || 0) * 2080;
  const benefits = (dbi.prepare(`SELECT COALESCE(SUM(employer_contribution),0) t FROM benefit_enrollments WHERE employee_id = ? AND status = 'active'`).get(employeeId) as any)?.t || 0;
  const retirement = (dbi.prepare(`SELECT COALESCE(SUM(ytd_employer_contribution),0) t FROM retirement_contributions WHERE employee_id = ? AND status = 'active'`).get(employeeId) as any)?.t || 0;
  const equipment = (dbi.prepare(`SELECT COALESCE(SUM(value),0) t FROM employee_equipment WHERE employee_id = ? AND (disposition IS NULL OR disposition = 'in_use')`).get(employeeId) as any)?.t || 0;
  return { employeeName: emp.name, annualizedPay: round2(annualPay), annualBenefitsCost: round2(benefits * 12), ytdRetirementMatch: round2(retirement), equipmentValue: round2(equipment), totalCostEstimate: round2(annualPay + benefits * 12 + retirement) };
}
export function employeeTimelineSummary(employeeId: string) {
  const dbi = db.getDb();
  const events: any[] = [];
  const emp = dbi.prepare('SELECT name, start_date, end_date, status FROM employees WHERE id = ?').get(employeeId) as any;
  if (emp?.start_date) events.push({ date: emp.start_date, type: 'hired', detail: 'Hired' });
  if (emp?.end_date) events.push({ date: emp.end_date, type: 'terminated', detail: 'Employment ended' });
  const reviews = dbi.prepare('SELECT review_date, overall_rating, review_period FROM employee_reviews WHERE employee_id = ? ORDER BY review_date').all(employeeId) as any[];
  for (const r of reviews) events.push({ date: r.review_date, type: 'review', detail: `Performance review: ${r.overall_rating}/5 (${r.review_period || ''})` });
  const comp = dbi.prepare('SELECT change_date, change_type, old_amount, new_amount FROM compensation_history WHERE employee_id = ? ORDER BY change_date').all(employeeId) as any[];
  for (const c of comp) events.push({ date: c.change_date, type: 'compensation', detail: `${c.change_type}: $${c.old_amount} → $${c.new_amount}` });
  const disc = dbi.prepare('SELECT incident_date, severity, description FROM employee_disciplinary WHERE employee_id = ? ORDER BY incident_date').all(employeeId) as any[];
  for (const d of disc) events.push({ date: d.incident_date, type: 'disciplinary', detail: `${d.severity}: ${d.description?.slice(0, 80) || ''}` });
  return events.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}
export function companyOrgSummary(companyId: string) {
  const dbi = db.getDb();
  const byDept = dbi.prepare(`SELECT COALESCE(NULLIF(department,''),'Unassigned') AS department, COUNT(*) AS count FROM employees WHERE company_id = ? AND status = 'active' GROUP BY department ORDER BY count DESC`).all(companyId);
  const byRole = dbi.prepare(`SELECT COALESCE(NULLIF(role,''),'Unspecified') AS role, COUNT(*) AS count FROM employees WHERE company_id = ? AND status = 'active' GROUP BY role ORDER BY count DESC`).all(companyId);
  const avgTenure = (dbi.prepare(`SELECT AVG(julianday('now') - julianday(start_date)) / 365 AS years FROM employees WHERE company_id = ? AND status = 'active' AND start_date IS NOT NULL`).get(companyId) as any)?.years || 0;
  return { byDepartment: byDept, byRole, avgTenureYears: round2(avgTenure) };
}
export function hrComplianceChecklist(companyId: string) {
  const dbi = db.getDb();
  const checks: { item: string; status: 'pass' | 'warn' | 'fail'; detail: string }[] = [];
  const activeEmployees = (dbi.prepare(`SELECT COUNT(*) c FROM employees WHERE company_id = ? AND status = 'active'`).get(companyId) as any)?.c || 0;
  const i9Count = (dbi.prepare(`SELECT COUNT(*) c FROM compliance_documents WHERE company_id = ? AND form_type = 'I-9' AND status = 'current'`).get(companyId) as any)?.c || 0;
  checks.push({ item: 'I-9 on file for all active employees', status: i9Count >= activeEmployees ? 'pass' : 'fail', detail: `${i9Count} of ${activeEmployees} employees have current I-9` });
  const w4Count = (dbi.prepare(`SELECT COUNT(*) c FROM employees WHERE company_id = ? AND status = 'active' AND w4_filing_status IS NOT NULL AND w4_filing_status != ''`).get(companyId) as any)?.c || 0;
  checks.push({ item: 'W-4 on file for all active employees', status: w4Count >= activeEmployees ? 'pass' : 'warn', detail: `${w4Count} of ${activeEmployees} have W-4 data` });
  const expiredDocs = (dbi.prepare(`SELECT COUNT(*) c FROM compliance_documents WHERE company_id = ? AND status = 'expired'`).get(companyId) as any)?.c || 0;
  checks.push({ item: 'No expired compliance documents', status: expiredDocs === 0 ? 'pass' : 'fail', detail: `${expiredDocs} expired documents` });
  const missingEmergency = (dbi.prepare(`SELECT COUNT(*) c FROM employees WHERE company_id = ? AND status = 'active' AND (emergency_contact_name IS NULL OR emergency_contact_name = '')`).get(companyId) as any)?.c || 0;
  checks.push({ item: 'Emergency contacts on file', status: missingEmergency === 0 ? 'pass' : 'warn', detail: `${missingEmergency} employees missing emergency contact` });
  return checks;
}
