// ─── HR Suite Wave 2: 50 more features (HR51–HR100) ───────
//
// Wires garnishment_orders, workers_comp_classes, retirement_contributions,
// compliance_documents, year_end_summaries + adds computed analytics for
// labor cost, headcount forecasting, pay equity, tenure milestones,
// probation tracking, employee directory, org chart, and more.

import { randomUUID as uuid } from 'crypto';
import * as db from '../database';

const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);
const round2 = (n: number) => Math.round((n || 0) * 100) / 100;

// ════════════════════════════════════════════════════════════
// HR51–HR55: Garnishment Orders CRUD + Summary
// ════════════════════════════════════════════════════════════
export function listGarnishmentOrders(companyId: string, employeeId?: string) {
  let sql = 'SELECT go.*, e.name AS employee_name FROM garnishment_orders go LEFT JOIN employees e ON e.id = go.employee_id WHERE go.company_id = ?';
  const p: any[] = [companyId];
  if (employeeId) { sql += ' AND go.employee_id = ?'; p.push(employeeId); }
  sql += ' ORDER BY go.priority, go.starts_at';
  return db.getDb().prepare(sql).all(...p);
}
export function upsertGarnishmentOrder(order: any) {
  const dbi = db.getDb();
  if (order.id) { dbi.prepare(`UPDATE garnishment_orders SET order_number=?,garnishment_type=?,court_or_agency=?,creditor_name=?,total_amount=?,per_pay_amount=?,percent_of_disposable=?,priority=?,starts_at=?,ends_at=?,status=?,notes=?,updated_at=datetime('now') WHERE id=?`).run(order.order_number, order.garnishment_type, order.court_or_agency || '', order.creditor_name || '', order.total_amount ?? null, order.per_pay_amount ?? 0, order.percent_of_disposable ?? null, order.priority ?? 1, order.starts_at || null, order.ends_at || null, order.status || 'active', order.notes || '', order.id); return order; }
  const id = uuid(); dbi.prepare(`INSERT INTO garnishment_orders (id, company_id, employee_id, order_number, garnishment_type, court_or_agency, creditor_name, total_amount, per_pay_amount, percent_of_disposable, priority, starts_at, ends_at, accumulated, status, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,datetime('now'))`).run(id, order.company_id, order.employee_id, order.order_number || '', order.garnishment_type || 'wage', order.court_or_agency || '', order.creditor_name || '', order.total_amount ?? null, order.per_pay_amount ?? 0, order.percent_of_disposable ?? null, order.priority ?? 1, order.starts_at || null, order.ends_at || null, order.status || 'active', order.notes || ''); return { ...order, id };
}
export function deleteGarnishmentOrder(id: string) { db.getDb().prepare('DELETE FROM garnishment_orders WHERE id = ?').run(id); }
export function garnishmentSummary(companyId: string) {
  const dbi = db.getDb();
  const active = (dbi.prepare(`SELECT COUNT(*) c FROM garnishment_orders WHERE company_id = ? AND status = 'active'`).get(companyId) as any)?.c || 0;
  const totalPerPay = (dbi.prepare(`SELECT COALESCE(SUM(per_pay_amount),0) t FROM garnishment_orders WHERE company_id = ? AND status = 'active'`).get(companyId) as any)?.t || 0;
  const employeesAffected = (dbi.prepare(`SELECT COUNT(DISTINCT employee_id) c FROM garnishment_orders WHERE company_id = ? AND status = 'active'`).get(companyId) as any)?.c || 0;
  return { activeOrders: active, totalPerPayPeriod: round2(totalPerPay), employeesAffected };
}
export function recordGarnishmentDeduction(orderId: string, amount: number) {
  db.getDb().prepare(`UPDATE garnishment_orders SET accumulated = COALESCE(accumulated,0) + ?, updated_at = datetime('now') WHERE id = ?`).run(round2(amount), orderId);
  const order = db.getDb().prepare('SELECT * FROM garnishment_orders WHERE id = ?').get(orderId) as any;
  if (order?.total_amount && (order.accumulated || 0) >= order.total_amount) {
    db.getDb().prepare(`UPDATE garnishment_orders SET status = 'satisfied', ends_at = ?, updated_at = datetime('now') WHERE id = ?`).run(today(), orderId);
  }
}

// ════════════════════════════════════════════════════════════
// HR56–HR60: Workers' Comp Classes CRUD + Cost Estimator
// ════════════════════════════════════════════════════════════
export function listWorkersCompClasses(companyId: string) { return db.getDb().prepare('SELECT * FROM workers_comp_classes WHERE company_id = ? ORDER BY state_code, class_code').all(companyId); }
export function upsertWorkersCompClass(cls: any) {
  const dbi = db.getDb();
  if (cls.id) { dbi.prepare(`UPDATE workers_comp_classes SET class_code=?,state_code=?,description=?,rate_per_100=?,effective_from=?,effective_to=? WHERE id=?`).run(cls.class_code, cls.state_code, cls.description || '', cls.rate_per_100 ?? 0, cls.effective_from || null, cls.effective_to || null, cls.id); return cls; }
  const id = uuid(); dbi.prepare(`INSERT INTO workers_comp_classes (id, company_id, class_code, state_code, description, rate_per_100, effective_from, effective_to, created_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))`).run(id, cls.company_id, cls.class_code, cls.state_code, cls.description || '', cls.rate_per_100 ?? 0, cls.effective_from || null, cls.effective_to || null); return { ...cls, id };
}
export function deleteWorkersCompClass(id: string) { db.getDb().prepare('DELETE FROM workers_comp_classes WHERE id = ?').run(id); }
export function estimateWorkersCompCost(companyId: string, annualPayroll: number) {
  const classes = db.getDb().prepare('SELECT * FROM workers_comp_classes WHERE company_id = ? ORDER BY rate_per_100 DESC').all(companyId) as any[];
  if (classes.length === 0) return { estimated_annual_premium: 0, classes: [], note: 'No workers comp classes defined' };
  const avgRate = classes.reduce((s: number, c: any) => s + (c.rate_per_100 || 0), 0) / classes.length;
  return { estimated_annual_premium: round2((annualPayroll / 100) * avgRate), avg_rate_per_100: round2(avgRate), classes: classes.length };
}
export function workersCompByState(companyId: string) {
  return db.getDb().prepare(`SELECT state_code, COUNT(*) AS class_count, AVG(rate_per_100) AS avg_rate FROM workers_comp_classes WHERE company_id = ? GROUP BY state_code ORDER BY state_code`).all(companyId);
}

// ════════════════════════════════════════════════════════════
// HR61–HR66: Retirement / 401k Contributions CRUD + Analytics
// ════════════════════════════════════════════════════════════
export function listRetirementContributions(companyId: string, employeeId?: string) {
  let sql = 'SELECT rc.*, e.name AS employee_name FROM retirement_contributions rc LEFT JOIN employees e ON e.id = rc.employee_id WHERE rc.company_id = ?';
  const p: any[] = [companyId]; if (employeeId) { sql += ' AND rc.employee_id = ?'; p.push(employeeId); }
  return db.getDb().prepare(sql + ' ORDER BY e.name').all(...p);
}
export function upsertRetirementContribution(rc: any) {
  const dbi = db.getDb();
  if (rc.id) { dbi.prepare(`UPDATE retirement_contributions SET plan_type=?,contribution_percent=?,contribution_amount_flat=?,employer_match_percent=?,employer_match_cap_percent=?,annual_limit=?,catch_up_eligible=?,catch_up_amount=?,vesting_schedule=?,status=?,updated_at=datetime('now') WHERE id=?`).run(rc.plan_type || '401k', rc.contribution_percent ?? 0, rc.contribution_amount_flat ?? 0, rc.employer_match_percent ?? 0, rc.employer_match_cap_percent ?? 0, rc.annual_limit ?? 23000, rc.catch_up_eligible ? 1 : 0, rc.catch_up_amount ?? 0, rc.vesting_schedule || null, rc.status || 'active', rc.id); return rc; }
  const id = uuid(); dbi.prepare(`INSERT INTO retirement_contributions (id, company_id, employee_id, plan_type, contribution_percent, contribution_amount_flat, employer_match_percent, employer_match_cap_percent, ytd_employee_contribution, ytd_employer_contribution, annual_limit, catch_up_eligible, catch_up_amount, vesting_schedule, status, created_at) VALUES (?,?,?,?,?,?,?,?,0,0,?,?,?,?,?,datetime('now'))`).run(id, rc.company_id, rc.employee_id, rc.plan_type || '401k', rc.contribution_percent ?? 0, rc.contribution_amount_flat ?? 0, rc.employer_match_percent ?? 0, rc.employer_match_cap_percent ?? 0, rc.annual_limit ?? 23000, rc.catch_up_eligible ? 1 : 0, rc.catch_up_amount ?? 0, rc.vesting_schedule || null, rc.status || 'active'); return { ...rc, id };
}
export function deleteRetirementContribution(id: string) { db.getDb().prepare('DELETE FROM retirement_contributions WHERE id = ?').run(id); }
export function retirementSummary(companyId: string) {
  const dbi = db.getDb();
  const enrolled = (dbi.prepare(`SELECT COUNT(*) c FROM retirement_contributions WHERE company_id = ? AND status = 'active'`).get(companyId) as any)?.c || 0;
  const ytdEe = (dbi.prepare(`SELECT COALESCE(SUM(ytd_employee_contribution),0) t FROM retirement_contributions WHERE company_id = ?`).get(companyId) as any)?.t || 0;
  const ytdEr = (dbi.prepare(`SELECT COALESCE(SUM(ytd_employer_contribution),0) t FROM retirement_contributions WHERE company_id = ?`).get(companyId) as any)?.t || 0;
  return { enrolled, ytdEmployeeContributions: round2(ytdEe), ytdEmployerMatch: round2(ytdEr), totalRetirementCost: round2(ytdEe + ytdEr) };
}
export function retirementNearingLimit(companyId: string) {
  return db.getDb().prepare(`SELECT rc.*, e.name AS employee_name, round((rc.ytd_employee_contribution / rc.annual_limit) * 100, 1) AS pct_of_limit FROM retirement_contributions rc JOIN employees e ON e.id = rc.employee_id WHERE rc.company_id = ? AND rc.status = 'active' AND rc.ytd_employee_contribution > rc.annual_limit * 0.8 ORDER BY pct_of_limit DESC`).all(companyId);
}
export function recordRetirementContributionPayment(id: string, employeeAmount: number, employerAmount: number) {
  db.getDb().prepare(`UPDATE retirement_contributions SET ytd_employee_contribution = COALESCE(ytd_employee_contribution,0) + ?, ytd_employer_contribution = COALESCE(ytd_employer_contribution,0) + ?, updated_at = datetime('now') WHERE id = ?`).run(round2(employeeAmount), round2(employerAmount), id);
}

// ════════════════════════════════════════════════════════════
// HR67–HR71: Compliance Documents CRUD + Expiry Tracking
// ════════════════════════════════════════════════════════════
export function listComplianceDocs(companyId: string, personType?: string, personId?: string) {
  let sql = 'SELECT * FROM compliance_documents WHERE company_id = ?'; const p: any[] = [companyId];
  if (personType) { sql += ' AND person_type = ?'; p.push(personType); }
  if (personId) { sql += ' AND person_id = ?'; p.push(personId); }
  return db.getDb().prepare(sql + ' ORDER BY status, form_type').all(...p);
}
export function upsertComplianceDoc(doc: any) {
  const dbi = db.getDb();
  if (doc.id) { dbi.prepare(`UPDATE compliance_documents SET form_type=?,document_filename=?,effective_date=?,expires_at=?,section_1_complete=?,section_2_complete=?,section_3_complete=?,status=?,notes=? WHERE id=?`).run(doc.form_type, doc.document_filename || '', doc.effective_date || null, doc.expires_at || null, doc.section_1_complete ? 1 : 0, doc.section_2_complete ? 1 : 0, doc.section_3_complete ? 1 : 0, doc.status || 'current', doc.notes || '', doc.id); return doc; }
  const id = uuid(); dbi.prepare(`INSERT INTO compliance_documents (id, company_id, person_type, person_id, form_type, document_filename, effective_date, expires_at, section_1_complete, section_2_complete, section_3_complete, status, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`).run(id, doc.company_id, doc.person_type || 'employee', doc.person_id, doc.form_type, doc.document_filename || '', doc.effective_date || null, doc.expires_at || null, doc.section_1_complete ? 1 : 0, doc.section_2_complete ? 1 : 0, doc.section_3_complete ? 1 : 0, doc.status || 'current', doc.notes || ''); return { ...doc, id };
}
export function deleteComplianceDoc(id: string) { db.getDb().prepare('DELETE FROM compliance_documents WHERE id = ?').run(id); }
export function complianceExpiringSoon(companyId: string, daysAhead = 30) {
  const h = new Date(Date.now() + daysAhead * 86400000).toISOString().slice(0, 10);
  return db.getDb().prepare(`SELECT cd.*, e.name AS person_name FROM compliance_documents cd LEFT JOIN employees e ON e.id = cd.person_id AND cd.person_type = 'employee' WHERE cd.company_id = ? AND cd.expires_at IS NOT NULL AND cd.expires_at <= ? AND cd.status = 'current' ORDER BY cd.expires_at`).all(companyId, h);
}
export function complianceOverview(companyId: string) {
  const dbi = db.getDb();
  const total = (dbi.prepare('SELECT COUNT(*) c FROM compliance_documents WHERE company_id = ?').get(companyId) as any)?.c || 0;
  const current = (dbi.prepare(`SELECT COUNT(*) c FROM compliance_documents WHERE company_id = ? AND status = 'current'`).get(companyId) as any)?.c || 0;
  const expired = (dbi.prepare(`SELECT COUNT(*) c FROM compliance_documents WHERE company_id = ? AND status = 'expired'`).get(companyId) as any)?.c || 0;
  const pending = (dbi.prepare(`SELECT COUNT(*) c FROM compliance_documents WHERE company_id = ? AND status = 'pending'`).get(companyId) as any)?.c || 0;
  const byForm = dbi.prepare(`SELECT form_type, COUNT(*) AS count, SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) AS expired_count FROM compliance_documents WHERE company_id = ? GROUP BY form_type`).all(companyId);
  return { total, current, expired, pending, byForm };
}

// ════════════════════════════════════════════════════════════
// HR72–HR75: Year-End Summaries
// ════════════════════════════════════════════════════════════
export function getYearEndSummary(companyId: string, year: number) {
  return db.getDb().prepare('SELECT * FROM year_end_summaries WHERE company_id = ? AND tax_year = ?').get(companyId, year);
}
export function generateYearEndSummary(companyId: string, year: number) {
  const dbi = db.getDb();
  const stubs = dbi.prepare(`SELECT employee_id, SUM(gross_pay) AS gross, SUM(total_taxes) AS taxes, SUM(net_pay) AS net FROM pay_stubs WHERE company_id = ? AND strftime('%Y', pay_date) = ? GROUP BY employee_id`).all(companyId, String(year)) as any[];
  const totalGross = stubs.reduce((s, r) => s + (r.gross || 0), 0);
  const totalTaxes = stubs.reduce((s, r) => s + (r.taxes || 0), 0);
  const existing = dbi.prepare('SELECT id FROM year_end_summaries WHERE company_id = ? AND tax_year = ?').get(companyId, year) as any;
  if (existing) {
    dbi.prepare(`UPDATE year_end_summaries SET employee_count=?,total_gross=?,total_federal_withheld=?,by_employee_json=?,generated_at=datetime('now'),updated_at=datetime('now') WHERE id=?`).run(stubs.length, round2(totalGross), round2(totalTaxes), JSON.stringify(stubs), existing.id);
    return { id: existing.id, updated: true };
  }
  const id = uuid(); dbi.prepare(`INSERT INTO year_end_summaries (id, company_id, tax_year, employee_count, total_gross, total_federal_withheld, by_employee_json, generated_at, created_at) VALUES (?,?,?,?,?,?,?,datetime('now'),datetime('now'))`).run(id, companyId, year, stubs.length, round2(totalGross), round2(totalTaxes), JSON.stringify(stubs));
  return { id, created: true };
}
export function listYearEndSummaries(companyId: string) { return db.getDb().prepare('SELECT id, tax_year, employee_count, total_gross, total_federal_withheld, generated_at FROM year_end_summaries WHERE company_id = ? ORDER BY tax_year DESC').all(companyId); }
export function yearOverYearComparison(companyId: string) {
  return db.getDb().prepare(`SELECT tax_year, employee_count, total_gross, total_federal_withheld FROM year_end_summaries WHERE company_id = ? ORDER BY tax_year`).all(companyId);
}

// ════════════════════════════════════════════════════════════
// HR76–HR80: Labor Cost Analysis
// ════════════════════════════════════════════════════════════
export function laborCostByDepartment(companyId: string) {
  return db.getDb().prepare(`SELECT COALESCE(NULLIF(e.department,''),'Unassigned') AS department, COUNT(*) AS headcount, SUM(CASE WHEN e.pay_type='salary' THEN e.pay_rate ELSE e.pay_rate * 2080 END) AS annualized_labor, AVG(CASE WHEN e.pay_type='salary' THEN e.pay_rate ELSE e.pay_rate * 2080 END) AS avg_comp FROM employees e WHERE e.company_id = ? AND e.status = 'active' GROUP BY department ORDER BY annualized_labor DESC`).all(companyId);
}
export function laborCostByType(companyId: string) {
  return db.getDb().prepare(`SELECT COALESCE(NULLIF(employment_type,''),'full-time') AS emp_type, COUNT(*) AS headcount, SUM(CASE WHEN pay_type='salary' THEN pay_rate ELSE pay_rate * 2080 END) AS annualized_labor FROM employees WHERE company_id = ? AND status = 'active' GROUP BY emp_type`).all(companyId);
}
export function totalLaborCost(companyId: string) {
  const r = db.getDb().prepare(`SELECT SUM(CASE WHEN pay_type='salary' THEN pay_rate ELSE pay_rate * 2080 END) AS annual, COUNT(*) AS headcount FROM employees WHERE company_id = ? AND status = 'active'`).get(companyId) as any;
  return { annualLaborCost: round2(r?.annual || 0), headcount: r?.headcount || 0, monthlyBurn: round2((r?.annual || 0) / 12) };
}
export function costPerHire(companyId: string, year?: number) {
  const y = year || new Date().getFullYear();
  const dbi = db.getDb();
  const hires = (dbi.prepare(`SELECT COUNT(*) c FROM employees WHERE company_id = ? AND strftime('%Y', start_date) = ?`).get(companyId, String(y)) as any)?.c || 0;
  return { year: y, newHires: hires, note: 'Track recruiting costs in expenses with a "Recruiting" category to compute cost-per-hire' };
}
export function compensationDistribution(companyId: string) {
  return db.getDb().prepare(`SELECT CASE WHEN pay_type='salary' THEN CASE WHEN pay_rate < 30000 THEN '<30k' WHEN pay_rate < 50000 THEN '30-50k' WHEN pay_rate < 75000 THEN '50-75k' WHEN pay_rate < 100000 THEN '75-100k' ELSE '100k+' END ELSE CASE WHEN pay_rate < 15 THEN '<$15/hr' WHEN pay_rate < 25 THEN '$15-25/hr' WHEN pay_rate < 40 THEN '$25-40/hr' ELSE '$40+/hr' END END AS bracket, pay_type, COUNT(*) AS count FROM employees WHERE company_id = ? AND status = 'active' GROUP BY bracket, pay_type ORDER BY pay_type, bracket`).all(companyId);
}

// ════════════════════════════════════════════════════════════
// HR81–HR85: Employee Directory + Org Data
// ════════════════════════════════════════════════════════════
export function employeeDirectory(companyId: string) {
  return db.getDb().prepare(`SELECT id, name, email, phone, job_title, department, work_location, employment_type, status, start_date FROM employees WHERE company_id = ? AND status = 'active' ORDER BY name`).all(companyId);
}
export function headcountByMonth(companyId: string, months = 12) {
  const results: { month: string; active: number; hired: number; termed: number }[] = [];
  const dbi = db.getDb();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const eom = ym + '-31';
    const active = (dbi.prepare(`SELECT COUNT(*) c FROM employees WHERE company_id = ? AND start_date <= ? AND (status = 'active' OR (status = 'inactive' AND end_date > ?))`).get(companyId, eom, eom) as any)?.c || 0;
    const hired = (dbi.prepare(`SELECT COUNT(*) c FROM employees WHERE company_id = ? AND substr(start_date,1,7) = ?`).get(companyId, ym) as any)?.c || 0;
    const termed = (dbi.prepare(`SELECT COUNT(*) c FROM employees WHERE company_id = ? AND status = 'inactive' AND substr(end_date,1,7) = ?`).get(companyId, ym) as any)?.c || 0;
    results.push({ month: ym, active, hired, termed });
  }
  return results;
}
export function employeesByLocation(companyId: string) {
  return db.getDb().prepare(`SELECT COALESCE(NULLIF(work_location,''),'unspecified') AS location, COUNT(*) AS count FROM employees WHERE company_id = ? AND status = 'active' GROUP BY location ORDER BY count DESC`).all(companyId);
}
export function tenureMilestones(companyId: string) {
  return db.getDb().prepare(`SELECT id, name, start_date, CAST((julianday('now') - julianday(start_date)) / 365 AS INTEGER) AS years FROM employees WHERE company_id = ? AND status = 'active' AND start_date IS NOT NULL AND CAST((julianday('now') - julianday(start_date)) / 365 AS INTEGER) IN (1,3,5,10,15,20,25) ORDER BY years DESC, name`).all(companyId);
}
export function newHireReport(companyId: string, days = 90) {
  return db.getDb().prepare(`SELECT id, name, email, job_title, department, start_date, employment_type FROM employees WHERE company_id = ? AND status = 'active' AND start_date >= date('now', '-' || ? || ' days') ORDER BY start_date DESC`).all(companyId, days);
}

// ════════════════════════════════════════════════════════════
// HR86–HR90: Pay Equity + Compensation Analytics
// ════════════════════════════════════════════════════════════
export function payEquityByDepartment(companyId: string) {
  return db.getDb().prepare(`SELECT COALESCE(NULLIF(department,''),'Unassigned') AS department, pay_type, MIN(pay_rate) AS min_rate, MAX(pay_rate) AS max_rate, AVG(pay_rate) AS avg_rate, COUNT(*) AS count, MAX(pay_rate) - MIN(pay_rate) AS spread FROM employees WHERE company_id = ? AND status = 'active' GROUP BY department, pay_type ORDER BY department`).all(companyId);
}
export function payEquityByRole(companyId: string) {
  return db.getDb().prepare(`SELECT COALESCE(NULLIF(role,''),'Unspecified') AS role, pay_type, MIN(pay_rate) AS min_rate, MAX(pay_rate) AS max_rate, AVG(pay_rate) AS avg_rate, COUNT(*) AS count FROM employees WHERE company_id = ? AND status = 'active' AND pay_rate > 0 GROUP BY role, pay_type HAVING count > 1 ORDER BY role`).all(companyId);
}
export function compensationBenchmark(companyId: string) {
  const dbi = db.getDb();
  const avgSalary = (dbi.prepare(`SELECT AVG(pay_rate) a FROM employees WHERE company_id = ? AND status = 'active' AND pay_type = 'salary'`).get(companyId) as any)?.a || 0;
  const avgHourly = (dbi.prepare(`SELECT AVG(pay_rate) a FROM employees WHERE company_id = ? AND status = 'active' AND pay_type = 'hourly'`).get(companyId) as any)?.a || 0;
  const medianSalary = (dbi.prepare(`SELECT pay_rate FROM employees WHERE company_id = ? AND status = 'active' AND pay_type = 'salary' ORDER BY pay_rate LIMIT 1 OFFSET (SELECT COUNT(*)/2 FROM employees WHERE company_id = ? AND status = 'active' AND pay_type = 'salary')`).get(companyId, companyId) as any)?.pay_rate || 0;
  return { avgSalary: round2(avgSalary), avgHourly: round2(avgHourly), medianSalary: round2(medianSalary) };
}
export function recentRaises(companyId: string, days = 90) {
  return db.getDb().prepare(`SELECT ch.*, e.name AS employee_name FROM compensation_history ch JOIN employees e ON e.id = ch.employee_id WHERE ch.company_id = ? AND ch.change_date >= date('now', '-' || ? || ' days') ORDER BY ch.change_date DESC`).all(companyId, days);
}
export function topEarners(companyId: string, limit = 10) {
  return db.getDb().prepare(`SELECT id, name, pay_type, pay_rate, job_title, department FROM employees WHERE company_id = ? AND status = 'active' ORDER BY CASE WHEN pay_type = 'salary' THEN pay_rate ELSE pay_rate * 2080 END DESC LIMIT ?`).all(companyId, limit);
}

// ════════════════════════════════════════════════════════════
// HR91–HR95: Probation + Onboarding Progress
// ════════════════════════════════════════════════════════════
export function employeesOnProbation(companyId: string, probationDays = 90) {
  return db.getDb().prepare(`SELECT id, name, start_date, job_title, department, CAST(julianday('now') - julianday(start_date) AS INTEGER) AS days_employed, ? - CAST(julianday('now') - julianday(start_date) AS INTEGER) AS days_remaining FROM employees WHERE company_id = ? AND status = 'active' AND start_date IS NOT NULL AND julianday('now') - julianday(start_date) <= ? ORDER BY days_remaining`).all(probationDays, companyId, probationDays);
}
export function onboardingProgress(companyId: string) {
  return db.getDb().prepare(`SELECT oa.employee_id, e.name AS employee_name, COUNT(*) AS total_items, SUM(oa.completed) AS completed_items, ROUND(CAST(SUM(oa.completed) AS REAL) / COUNT(*) * 100, 0) AS pct_complete FROM onboarding_assignments oa JOIN employees e ON e.id = oa.employee_id WHERE oa.company_id = ? GROUP BY oa.employee_id ORDER BY pct_complete`).all(companyId);
}
export function onboardingOverdueItems(companyId: string) {
  return db.getDb().prepare(`SELECT oa.*, e.name AS employee_name FROM onboarding_assignments oa JOIN employees e ON e.id = oa.employee_id WHERE oa.company_id = ? AND oa.completed = 0 AND oa.due_date IS NOT NULL AND oa.due_date < date('now') ORDER BY oa.due_date`).all(companyId);
}
export function employeeRetentionRisk(companyId: string) {
  // Simple heuristic: employees with recent disciplinary actions, no recent review, or very short tenure
  const dbi = db.getDb();
  return dbi.prepare(`SELECT e.id, e.name, e.start_date, e.department, CAST(julianday('now') - julianday(e.start_date) AS INTEGER) AS tenure_days, (SELECT COUNT(*) FROM employee_disciplinary ed WHERE ed.employee_id = e.id AND ed.incident_date >= date('now','-180 days')) AS recent_incidents, (SELECT MAX(er.review_date) FROM employee_reviews er WHERE er.employee_id = e.id) AS last_review FROM employees e WHERE e.company_id = ? AND e.status = 'active' HAVING recent_incidents > 0 OR last_review IS NULL OR last_review < date('now','-365 days') ORDER BY recent_incidents DESC, tenure_days`).all(companyId);
}
export function employeeSatisfactionProxy(companyId: string) {
  // Proxy: avg review rating + time-off usage rate
  const dbi = db.getDb();
  const avgRating = (dbi.prepare(`SELECT AVG(er.overall_rating) a FROM employee_reviews er JOIN employees e ON e.id = er.employee_id WHERE e.company_id = ? AND e.status = 'active'`).get(companyId) as any)?.a || 0;
  const avgTimeOffUsed = (dbi.prepare(`SELECT AVG(toa.ytd_used) a FROM time_off_accruals toa JOIN employees e ON e.id = toa.employee_id WHERE e.company_id = ? AND e.status = 'active'`).get(companyId) as any)?.a || 0;
  return { avgPerformanceRating: round2(avgRating), avgTimeOffUsedHours: round2(avgTimeOffUsed) };
}

// ════════════════════════════════════════════════════════════
// HR96–HR100: Advanced Reports + Bulk Operations
// ════════════════════════════════════════════════════════════
export function fullEmployeeSnapshot(employeeId: string) {
  const dbi = db.getDb();
  const emp = dbi.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId) as any;
  if (!emp) return null;
  const equipment = dbi.prepare('SELECT * FROM employee_equipment WHERE employee_id = ?').all(employeeId);
  const credentials = dbi.prepare('SELECT * FROM employee_credentials WHERE employee_id = ?').all(employeeId);
  const reviews = dbi.prepare('SELECT * FROM employee_reviews WHERE employee_id = ? ORDER BY review_date DESC').all(employeeId);
  const disciplinary = dbi.prepare('SELECT * FROM employee_disciplinary WHERE employee_id = ? ORDER BY incident_date DESC').all(employeeId);
  const benefits = dbi.prepare('SELECT be.*, bp.plan_name, bp.plan_type FROM benefit_enrollments be JOIN benefit_plans bp ON bp.id = be.plan_id WHERE be.employee_id = ?').all(employeeId);
  let retirement: any[] = []; try { retirement = dbi.prepare('SELECT * FROM retirement_contributions WHERE employee_id = ?').all(employeeId); } catch {}
  let garnishments: any[] = []; try { garnishments = dbi.prepare('SELECT * FROM garnishment_orders WHERE employee_id = ?').all(employeeId); } catch {}
  let stateAllocs: any[] = []; try { stateAllocs = dbi.prepare('SELECT * FROM employee_state_allocations WHERE employee_id = ?').all(employeeId); } catch {}
  let compHistory: any[] = []; try { compHistory = dbi.prepare('SELECT * FROM compensation_history WHERE employee_id = ? ORDER BY change_date DESC').all(employeeId); } catch {}
  return { employee: emp, equipment, credentials, reviews, disciplinary, benefits, retirement, garnishments, stateAllocations: stateAllocs, compensationHistory: compHistory };
}
export function bulkStatusChange(companyId: string, employeeIds: string[], newStatus: string) {
  const dbi = db.getDb();
  const upd = dbi.prepare(`UPDATE employees SET status = ?, end_date = CASE WHEN ? = 'inactive' THEN date('now') ELSE end_date END, updated_at = datetime('now') WHERE id = ? AND company_id = ?`);
  const tx = dbi.transaction(() => { for (const id of employeeIds) upd.run(newStatus, newStatus, id, companyId); });
  tx();
  return { updated: employeeIds.length };
}
export function exportEmployeeRoster(companyId: string) {
  return db.getDb().prepare(`SELECT e.name, e.email, e.phone, e.type, e.employment_type, e.pay_type, e.pay_rate, e.pay_schedule, e.department, e.job_title, e.role, e.work_location, e.cost_class, e.state, e.start_date, e.end_date, e.status FROM employees e WHERE e.company_id = ? ORDER BY e.name`).all(companyId);
}
export function terminationReport(companyId: string, year?: number) {
  const y = year || new Date().getFullYear();
  return db.getDb().prepare(`SELECT id, name, department, job_title, start_date, end_date, CAST((julianday(end_date) - julianday(start_date)) / 365 AS REAL) AS tenure_years FROM employees WHERE company_id = ? AND status = 'inactive' AND strftime('%Y', end_date) = ? ORDER BY end_date DESC`).all(companyId, String(y));
}
export function companyWideHRMetrics(companyId: string) {
  const dbi = db.getDb();
  const headcount = (dbi.prepare(`SELECT COUNT(*) c FROM employees WHERE company_id = ? AND status = 'active'`).get(companyId) as any)?.c || 0;
  const avgPay = (dbi.prepare(`SELECT AVG(CASE WHEN pay_type='salary' THEN pay_rate ELSE pay_rate*2080 END) a FROM employees WHERE company_id = ? AND status = 'active'`).get(companyId) as any)?.a || 0;
  const openGarnishments = (dbi.prepare(`SELECT COUNT(*) c FROM garnishment_orders WHERE company_id = ? AND status = 'active'`).get(companyId) as any)?.c || 0;
  const activeEnrollments = (dbi.prepare(`SELECT COUNT(*) c FROM benefit_enrollments WHERE company_id = ? AND status = 'active'`).get(companyId) as any)?.c || 0;
  const pendingTimeOff = (dbi.prepare(`SELECT COUNT(*) c FROM time_off_requests WHERE company_id = ? AND status = 'pending'`).get(companyId) as any)?.c || 0;
  const overdueOnboarding = (dbi.prepare(`SELECT COUNT(*) c FROM onboarding_assignments WHERE company_id = ? AND completed = 0 AND due_date IS NOT NULL AND due_date < date('now')`).get(companyId) as any)?.c || 0;
  return { headcount, avgAnnualizedComp: round2(avgPay), openGarnishments, activeEnrollments, pendingTimeOff, overdueOnboarding };
}
