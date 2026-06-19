// ─── HR Suite Features: 50 functions (HR1–HR50) ───────────
//
// Wires up 10 unwired tables (benefit_plans, benefit_enrollments,
// overtime_rules, time_off_requests, time_off_accruals,
// employee_salary_reviews, employee_state_allocations,
// onboarding_templates, onboarding_assignments, pay_schedule_templates)
// + adds computed analytics, dashboards, and process functions.

import { randomUUID as uuid } from 'crypto';
import * as db from '../database';

const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);
const round2 = (n: number) => Math.round((n || 0) * 100) / 100;

// ════════════════════════════════════════════════════════════
// HR1–HR5: Benefit Plans CRUD + Summary
// ════════════════════════════════════════════════════════════
export function listBenefitPlans(companyId: string, activeOnly = false) {
  const w = activeOnly ? ' AND active = 1' : '';
  return db.getDb().prepare(`SELECT * FROM benefit_plans WHERE company_id = ?${w} ORDER BY plan_type, plan_name`).all(companyId);
}
export function upsertBenefitPlan(plan: any) {
  const dbi = db.getDb();
  if (plan.id) { const sets = Object.entries(plan).filter(([k]) => k !== 'id').map(([k]) => `${k} = ?`); dbi.prepare(`UPDATE benefit_plans SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...Object.entries(plan).filter(([k]) => k !== 'id').map(([, v]) => v), plan.id); return plan; }
  const id = uuid(); dbi.prepare(`INSERT INTO benefit_plans (id, company_id, plan_name, plan_type, provider, employee_cost, employer_cost, pre_tax, active, created_at) VALUES (?,?,?,?,?,?,?,?,1,datetime('now'))`).run(id, plan.company_id, plan.plan_name, plan.plan_type, plan.provider || '', plan.employee_cost || 0, plan.employer_cost || 0, plan.pre_tax ? 1 : 0); return { ...plan, id };
}
export function deleteBenefitPlan(id: string) { db.getDb().prepare('DELETE FROM benefit_plans WHERE id = ?').run(id); }
export function benefitPlanSummary(companyId: string) {
  const dbi = db.getDb();
  const plans = dbi.prepare('SELECT * FROM benefit_plans WHERE company_id = ? AND active = 1').all(companyId) as any[];
  const enrollments = dbi.prepare('SELECT * FROM benefit_enrollments WHERE company_id = ? AND status = \'active\'').all(companyId) as any[];
  const totalEmployerCost = enrollments.reduce((s: number, e: any) => s + (e.employer_contribution || 0), 0);
  const totalEmployeeCost = enrollments.reduce((s: number, e: any) => s + (e.employee_contribution || 0), 0);
  return { plans: plans.length, activeEnrollments: enrollments.length, totalEmployerCost: round2(totalEmployerCost), totalEmployeeCost: round2(totalEmployeeCost) };
}
export function benefitPlanEnrollees(planId: string) {
  return db.getDb().prepare(`SELECT be.*, e.name AS employee_name FROM benefit_enrollments be LEFT JOIN employees e ON e.id = be.employee_id WHERE be.plan_id = ? AND be.status = 'active' ORDER BY e.name`).all(planId);
}

// ════════════════════════════════════════════════════════════
// HR6–HR10: Benefit Enrollments CRUD + Employee Benefits View
// ════════════════════════════════════════════════════════════
export function enrollEmployee(enrollment: any) {
  const id = uuid(); db.getDb().prepare(`INSERT INTO benefit_enrollments (id, company_id, employee_id, plan_id, enrolled_at, ends_at, employee_contribution, employer_contribution, coverage_level, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))`).run(id, enrollment.company_id, enrollment.employee_id, enrollment.plan_id, enrollment.enrolled_at || today(), enrollment.ends_at || null, enrollment.employee_contribution || 0, enrollment.employer_contribution || 0, enrollment.coverage_level || 'employee', 'active'); return { id };
}
export function terminateEnrollment(id: string, endDate?: string) {
  db.getDb().prepare(`UPDATE benefit_enrollments SET status = 'terminated', ends_at = ?, updated_at = datetime('now') WHERE id = ?`).run(endDate || today(), id);
}
export function employeeBenefits(employeeId: string) {
  return db.getDb().prepare(`SELECT be.*, bp.plan_name, bp.plan_type, bp.provider FROM benefit_enrollments be JOIN benefit_plans bp ON bp.id = be.plan_id WHERE be.employee_id = ? ORDER BY be.status DESC, bp.plan_type`).all(employeeId);
}
export function updateEnrollment(id: string, data: any) {
  const sets = Object.entries(data).filter(([k]) => k !== 'id').map(([k]) => `${k} = ?`);
  if (sets.length === 0) return;
  db.getDb().prepare(`UPDATE benefit_enrollments SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...Object.entries(data).filter(([k]) => k !== 'id').map(([, v]) => v), id);
}
export function benefitsCostPerEmployee(companyId: string) {
  return db.getDb().prepare(`SELECT e.id, e.name, COALESCE(SUM(be.employee_contribution),0) AS employee_total, COALESCE(SUM(be.employer_contribution),0) AS employer_total FROM employees e LEFT JOIN benefit_enrollments be ON be.employee_id = e.id AND be.status = 'active' WHERE e.company_id = ? AND e.status = 'active' GROUP BY e.id ORDER BY employer_total DESC`).all(companyId);
}

// ════════════════════════════════════════════════════════════
// HR11–HR15: Overtime Rules CRUD + Calculator
// ════════════════════════════════════════════════════════════
export function listOvertimeRules(companyId: string) { return db.getDb().prepare('SELECT * FROM overtime_rules WHERE company_id = ? AND is_active = 1 ORDER BY state_code').all(companyId); }
export function upsertOvertimeRule(rule: any) {
  const dbi = db.getDb();
  if (rule.id) { dbi.prepare(`UPDATE overtime_rules SET rule_name=?,state_code=?,daily_threshold_hours=?,weekly_threshold_hours=?,double_time_threshold_hours=?,ot_multiplier=?,double_time_multiplier=?,is_active=? WHERE id=?`).run(rule.rule_name, rule.state_code || null, rule.daily_threshold_hours ?? 8, rule.weekly_threshold_hours ?? 40, rule.double_time_threshold_hours ?? null, rule.ot_multiplier ?? 1.5, rule.double_time_multiplier ?? 2.0, rule.is_active ? 1 : 0, rule.id); return rule; }
  const id = uuid(); dbi.prepare(`INSERT INTO overtime_rules (id, company_id, rule_name, state_code, daily_threshold_hours, weekly_threshold_hours, double_time_threshold_hours, ot_multiplier, double_time_multiplier, is_active, created_at) VALUES (?,?,?,?,?,?,?,?,?,1,datetime('now'))`).run(id, rule.company_id, rule.rule_name, rule.state_code || null, rule.daily_threshold_hours ?? 8, rule.weekly_threshold_hours ?? 40, rule.double_time_threshold_hours ?? null, rule.ot_multiplier ?? 1.5, rule.double_time_multiplier ?? 2.0); return { ...rule, id };
}
export function deleteOvertimeRule(id: string) { db.getDb().prepare('DELETE FROM overtime_rules WHERE id = ?').run(id); }
export function calculateOvertime(companyId: string, hoursWorked: { daily: number; weekly: number }, stateCode?: string) {
  const rules = db.getDb().prepare('SELECT * FROM overtime_rules WHERE company_id = ? AND is_active = 1' + (stateCode ? ' AND (state_code = ? OR state_code IS NULL)' : '')).all(companyId, ...(stateCode ? [stateCode] : [])) as any[];
  const rule = rules[0]; if (!rule) return { regular: hoursWorked.weekly, overtime: 0, doubletime: 0 };
  let ot = 0, dt = 0;
  const dailyOT = Math.max(0, hoursWorked.daily - (rule.daily_threshold_hours || 8));
  const weeklyOT = Math.max(0, hoursWorked.weekly - (rule.weekly_threshold_hours || 40));
  ot = Math.max(dailyOT, weeklyOT);
  if (rule.double_time_threshold_hours) { dt = Math.max(0, hoursWorked.daily - rule.double_time_threshold_hours); ot = Math.max(0, ot - dt); }
  return { regular: round2(hoursWorked.weekly - ot - dt), overtime: round2(ot), doubletime: round2(dt), otMultiplier: rule.ot_multiplier, dtMultiplier: rule.double_time_multiplier };
}
export function overtimeSummary(companyId: string, startDate: string, endDate: string) {
  return db.getDb().prepare(`SELECT e.id, e.name, COALESCE(SUM(te.hours),0) AS total_hours, COALESCE(SUM(CASE WHEN te.is_overtime = 1 THEN te.hours ELSE 0 END),0) AS ot_hours FROM employees e LEFT JOIN time_entries te ON te.employee_id = e.id AND te.date >= ? AND te.date <= ? WHERE e.company_id = ? AND e.status = 'active' GROUP BY e.id HAVING total_hours > 0 ORDER BY ot_hours DESC`).all(startDate, endDate, companyId);
}

// ════════════════════════════════════════════════════════════
// HR16–HR22: Time-Off Requests + Accruals
// ════════════════════════════════════════════════════════════
export function submitTimeOffRequest(req: any) {
  const id = uuid(); db.getDb().prepare(`INSERT INTO time_off_requests (id, company_id, employee_id, time_off_type, start_date, end_date, hours_requested, status, notes, requested_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'),datetime('now'))`).run(id, req.company_id, req.employee_id, req.time_off_type, req.start_date, req.end_date, req.hours_requested, 'pending', req.notes || ''); return { id };
}
export function approveTimeOffRequest(id: string, approvedBy: string) {
  db.getDb().prepare(`UPDATE time_off_requests SET status = 'approved', approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(approvedBy, id);
}
export function denyTimeOffRequest(id: string, reason?: string) {
  db.getDb().prepare(`UPDATE time_off_requests SET status = 'denied', notes = COALESCE(notes,'') || ? , updated_at = datetime('now') WHERE id = ?`).run(reason ? '\nDenied: ' + reason : '', id);
}
export function cancelTimeOffRequest(id: string) {
  db.getDb().prepare(`UPDATE time_off_requests SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`).run(id);
}
export function listTimeOffRequests(companyId: string, filters?: { employeeId?: string; status?: string }) {
  let sql = `SELECT tor.*, e.name AS employee_name FROM time_off_requests tor LEFT JOIN employees e ON e.id = tor.employee_id WHERE tor.company_id = ?`;
  const params: any[] = [companyId];
  if (filters?.employeeId) { sql += ' AND tor.employee_id = ?'; params.push(filters.employeeId); }
  if (filters?.status) { sql += ' AND tor.status = ?'; params.push(filters.status); }
  sql += ' ORDER BY tor.start_date DESC';
  return db.getDb().prepare(sql).all(...params);
}
export function pendingTimeOffCount(companyId: string) {
  return (db.getDb().prepare(`SELECT COUNT(*) AS c FROM time_off_requests WHERE company_id = ? AND status = 'pending'`).get(companyId) as any)?.c || 0;
}
export function timeOffCalendar(companyId: string, month: string) {
  return db.getDb().prepare(`SELECT tor.*, e.name AS employee_name FROM time_off_requests tor LEFT JOIN employees e ON e.id = tor.employee_id WHERE tor.company_id = ? AND tor.status IN ('approved','pending') AND tor.start_date <= ? AND tor.end_date >= ? ORDER BY tor.start_date`).all(companyId, month + '-31', month + '-01');
}

// ════════════════════════════════════════════════════════════
// HR23–HR27: Time-Off Accruals CRUD + Processing
// ════════════════════════════════════════════════════════════
export function listTimeOffAccruals(employeeId: string) { return db.getDb().prepare('SELECT * FROM time_off_accruals WHERE employee_id = ? ORDER BY accrual_type').all(employeeId); }
export function upsertTimeOffAccrual(accrual: any) {
  const dbi = db.getDb();
  if (accrual.id) { dbi.prepare(`UPDATE time_off_accruals SET accrual_type=?,accrual_method=?,rate_per_period=?,rate_per_hour_worked=?,cap_hours=?,carryover_cap=?,updated_at=datetime('now') WHERE id=?`).run(accrual.accrual_type, accrual.accrual_method || 'per_pay', accrual.rate_per_period || 0, accrual.rate_per_hour_worked || 0, accrual.cap_hours ?? null, accrual.carryover_cap ?? null, accrual.id); return accrual; }
  const id = uuid(); dbi.prepare(`INSERT INTO time_off_accruals (id, company_id, employee_id, accrual_type, accrual_method, rate_per_period, rate_per_hour_worked, cap_hours, carryover_cap, current_balance, ytd_accrued, ytd_used, created_at) VALUES (?,?,?,?,?,?,?,?,?,0,0,0,datetime('now'))`).run(id, accrual.company_id, accrual.employee_id, accrual.accrual_type, accrual.accrual_method || 'per_pay', accrual.rate_per_period || 0, accrual.rate_per_hour_worked || 0, accrual.cap_hours ?? null, accrual.carryover_cap ?? null); return { ...accrual, id };
}
export function runAccrualForEmployee(employeeId: string, hoursWorked?: number) {
  const dbi = db.getDb();
  const accruals = dbi.prepare('SELECT * FROM time_off_accruals WHERE employee_id = ?').all(employeeId) as any[];
  let totalAccrued = 0;
  for (const a of accruals) {
    let add = a.accrual_method === 'per_hour' ? (a.rate_per_hour_worked || 0) * (hoursWorked || 0) : (a.rate_per_period || 0);
    let newBal = (a.current_balance || 0) + add;
    if (a.cap_hours != null && newBal > a.cap_hours) { add = Math.max(0, a.cap_hours - (a.current_balance || 0)); newBal = a.cap_hours; }
    if (add > 0) {
      dbi.prepare(`UPDATE time_off_accruals SET current_balance = ?, ytd_accrued = COALESCE(ytd_accrued,0) + ?, last_accrued_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(round2(newBal), round2(add), a.id);
      totalAccrued += add;
    }
  }
  return { accrued: round2(totalAccrued), policies: accruals.length };
}
export function deductTimeOff(employeeId: string, type: string, hours: number) {
  const a = db.getDb().prepare('SELECT * FROM time_off_accruals WHERE employee_id = ? AND accrual_type = ?').get(employeeId, type) as any;
  if (!a) return { error: 'No accrual policy for ' + type };
  if ((a.current_balance || 0) < hours) return { error: 'Insufficient balance: ' + round2(a.current_balance) + 'h available' };
  db.getDb().prepare(`UPDATE time_off_accruals SET current_balance = COALESCE(current_balance,0) - ?, ytd_used = COALESCE(ytd_used,0) + ?, updated_at = datetime('now') WHERE id = ?`).run(round2(hours), round2(hours), a.id);
  return { ok: true, new_balance: round2((a.current_balance || 0) - hours) };
}

// ════════════════════════════════════════════════════════════
// HR28–HR32: Employee Salary Reviews
// ════════════════════════════════════════════════════════════
export function listSalaryReviews(employeeId: string) { return db.getDb().prepare('SELECT * FROM employee_salary_reviews WHERE employee_id = ? ORDER BY review_date DESC').all(employeeId); }
export function createSalaryReview(review: any) {
  const id = uuid(); const pct = review.prior_salary > 0 ? round2(((review.new_salary - review.prior_salary) / review.prior_salary) * 100) : 0;
  db.getDb().prepare(`INSERT INTO employee_salary_reviews (id, company_id, employee_id, review_date, review_period_start, review_period_end, prior_salary, new_salary, pct_change, reviewer_id, rating, notes, effective_date, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`).run(id, review.company_id, review.employee_id, review.review_date, review.review_period_start || null, review.review_period_end || null, review.prior_salary, review.new_salary, pct, review.reviewer_id || null, review.rating || null, review.notes || '', review.effective_date || review.review_date); return { id, pct_change: pct };
}
export function deleteSalaryReview(id: string) { db.getDb().prepare('DELETE FROM employee_salary_reviews WHERE id = ?').run(id); }
export function salaryReviewDashboard(companyId: string) {
  const dbi = db.getDb();
  const total = (dbi.prepare('SELECT COUNT(*) c FROM employee_salary_reviews WHERE company_id = ?').get(companyId) as any)?.c || 0;
  const avgChange = (dbi.prepare('SELECT AVG(pct_change) a FROM employee_salary_reviews WHERE company_id = ?').get(companyId) as any)?.a || 0;
  const overdue = (dbi.prepare(`SELECT COUNT(DISTINCT e.id) c FROM employees e LEFT JOIN employee_salary_reviews sr ON sr.employee_id = e.id WHERE e.company_id = ? AND e.status = 'active' AND (sr.id IS NULL OR sr.review_date < date('now','-365 days'))`).get(companyId) as any)?.c || 0;
  return { totalReviews: total, avgPctChange: round2(avgChange), overdueForReview: overdue };
}
export function employeesDueForReview(companyId: string, monthsThreshold = 12) {
  return db.getDb().prepare(`SELECT e.id, e.name, e.start_date, MAX(sr.review_date) AS last_review FROM employees e LEFT JOIN employee_salary_reviews sr ON sr.employee_id = e.id WHERE e.company_id = ? AND e.status = 'active' GROUP BY e.id HAVING last_review IS NULL OR last_review < date('now', '-' || ? || ' months') ORDER BY last_review`).all(companyId, monthsThreshold);
}

// ════════════════════════════════════════════════════════════
// HR33–HR36: Employee State Allocations (multi-state)
// ════════════════════════════════════════════════════════════
export function listStateAllocations(employeeId: string) { return db.getDb().prepare('SELECT * FROM employee_state_allocations WHERE employee_id = ? ORDER BY allocation_percent DESC').all(employeeId); }
export function upsertStateAllocation(alloc: any) {
  const dbi = db.getDb();
  if (alloc.id) { dbi.prepare(`UPDATE employee_state_allocations SET state_code=?,allocation_percent=?,is_resident=?,effective_from=?,effective_to=? WHERE id=?`).run(alloc.state_code, alloc.allocation_percent ?? 100, alloc.is_resident ? 1 : 0, alloc.effective_from || null, alloc.effective_to || null, alloc.id); return alloc; }
  const id = uuid(); dbi.prepare(`INSERT INTO employee_state_allocations (id, company_id, employee_id, state_code, allocation_percent, is_resident, effective_from, effective_to, created_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))`).run(id, alloc.company_id, alloc.employee_id, alloc.state_code, alloc.allocation_percent ?? 100, alloc.is_resident ? 1 : 0, alloc.effective_from || null, alloc.effective_to || null); return { ...alloc, id };
}
export function deleteStateAllocation(id: string) { db.getDb().prepare('DELETE FROM employee_state_allocations WHERE id = ?').run(id); }
export function multiStateSummary(companyId: string) {
  return db.getDb().prepare(`SELECT esa.state_code, COUNT(DISTINCT esa.employee_id) AS employee_count, AVG(esa.allocation_percent) AS avg_allocation FROM employee_state_allocations esa JOIN employees e ON e.id = esa.employee_id WHERE e.company_id = ? AND e.status = 'active' GROUP BY esa.state_code ORDER BY employee_count DESC`).all(companyId);
}

// ════════════════════════════════════════════════════════════
// HR37–HR40: Pay Schedule Templates
// ════════════════════════════════════════════════════════════
export function listPaySchedules(companyId: string) { return db.getDb().prepare('SELECT * FROM pay_schedule_templates WHERE company_id = ? AND active = 1 ORDER BY schedule_name').all(companyId); }
export function upsertPaySchedule(sched: any) {
  const dbi = db.getDb();
  if (sched.id) { dbi.prepare(`UPDATE pay_schedule_templates SET schedule_name=?,frequency=?,first_period_start=?,pay_day_offset=?,cutoff_offset=?,weekend_handling=?,active=?,updated_at=datetime('now') WHERE id=?`).run(sched.schedule_name, sched.frequency || 'biweekly', sched.first_period_start || null, sched.pay_day_offset ?? 5, sched.cutoff_offset ?? 2, sched.weekend_handling || 'before', sched.active ? 1 : 0, sched.id); return sched; }
  const id = uuid(); dbi.prepare(`INSERT INTO pay_schedule_templates (id, company_id, schedule_name, frequency, first_period_start, pay_day_offset, cutoff_offset, weekend_handling, active, created_at) VALUES (?,?,?,?,?,?,?,?,1,datetime('now'))`).run(id, sched.company_id, sched.schedule_name, sched.frequency || 'biweekly', sched.first_period_start || null, sched.pay_day_offset ?? 5, sched.cutoff_offset ?? 2, sched.weekend_handling || 'before'); return { ...sched, id };
}
export function deletePaySchedule(id: string) { db.getDb().prepare('DELETE FROM pay_schedule_templates WHERE id = ?').run(id); }
export function nextPayDates(companyId: string, count = 6) {
  const scheds = db.getDb().prepare('SELECT * FROM pay_schedule_templates WHERE company_id = ? AND active = 1').all(companyId) as any[];
  const results: any[] = [];
  for (const s of scheds) {
    const start = s.first_period_start ? new Date(s.first_period_start + 'T12:00:00') : new Date();
    const freq = s.frequency || 'biweekly';
    const stepDays = freq === 'weekly' ? 7 : freq === 'biweekly' ? 14 : freq === 'monthly' ? 30 : freq === 'semimonthly' ? 15 : 14;
    const dates: string[] = [];
    let cursor = new Date(start);
    while (dates.length < count) {
      const payDay = new Date(cursor.getTime() + (s.pay_day_offset || 5) * 86400000);
      const d = payDay.toISOString().slice(0, 10);
      if (d >= today()) dates.push(d);
      cursor = new Date(cursor.getTime() + stepDays * 86400000);
      if (cursor.getTime() > Date.now() + 365 * 86400000) break;
    }
    results.push({ schedule_name: s.schedule_name, frequency: freq, dates });
  }
  return results;
}

// ════════════════════════════════════════════════════════════
// HR41–HR45: Onboarding Templates + Template-Based Assignments
// ════════════════════════════════════════════════════════════
export function listOnboardingTemplates(companyId: string) { return db.getDb().prepare('SELECT * FROM onboarding_templates WHERE company_id = ? ORDER BY is_default DESC, template_name').all(companyId); }
export function upsertOnboardingTemplate(tpl: any) {
  const dbi = db.getDb();
  if (tpl.id) { dbi.prepare(`UPDATE onboarding_templates SET template_name=?,items_json=?,is_default=?,updated_at=datetime('now') WHERE id=?`).run(tpl.template_name, JSON.stringify(tpl.items || []), tpl.is_default ? 1 : 0, tpl.id); return tpl; }
  const id = uuid(); dbi.prepare(`INSERT INTO onboarding_templates (id, company_id, template_name, items_json, is_default, created_at, updated_at) VALUES (?,?,?,?,?,datetime('now'),datetime('now'))`).run(id, tpl.company_id, tpl.template_name, JSON.stringify(tpl.items || []), tpl.is_default ? 1 : 0); return { ...tpl, id };
}
export function deleteOnboardingTemplate(id: string) { db.getDb().prepare('DELETE FROM onboarding_templates WHERE id = ?').run(id); }
export function applyOnboardingTemplate(companyId: string, employeeId: string, templateId: string) {
  const tpl = db.getDb().prepare('SELECT * FROM onboarding_templates WHERE id = ? AND company_id = ?').get(templateId, companyId) as any;
  if (!tpl) return { error: 'Template not found' };
  const items = JSON.parse(tpl.items_json || '[]');
  const dbi = db.getDb();
  let created = 0;
  for (const item of items) {
    const id = uuid();
    dbi.prepare(`INSERT INTO onboarding_assignments (id, company_id, employee_id, template_id, item_key, item_label, due_date, completed, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,0,'',datetime('now'),datetime('now'))`).run(id, companyId, employeeId, templateId, item.key || item.label?.toLowerCase().replace(/\s+/g, '_') || uuid(), item.label || '', item.due_date || null);
    created++;
  }
  return { ok: true, created };
}
export function listOnboardingAssignments(employeeId: string) {
  return db.getDb().prepare('SELECT * FROM onboarding_assignments WHERE employee_id = ? ORDER BY completed, due_date').all(employeeId);
}
export function toggleOnboardingAssignment(id: string, done: boolean, completedBy?: string) {
  db.getDb().prepare(`UPDATE onboarding_assignments SET completed = ?, completed_at = ?, completed_by = ?, updated_at = datetime('now') WHERE id = ?`).run(done ? 1 : 0, done ? now() : null, completedBy || null, id);
}

// ════════════════════════════════════════════════════════════
// HR46–HR50: HR Dashboard Analytics
// ════════════════════════════════════════════════════════════
export function hrDashboard(companyId: string) {
  const dbi = db.getDb();
  const activeCount = (dbi.prepare(`SELECT COUNT(*) c FROM employees WHERE company_id = ? AND status = 'active'`).get(companyId) as any)?.c || 0;
  const inactiveCount = (dbi.prepare(`SELECT COUNT(*) c FROM employees WHERE company_id = ? AND status = 'inactive'`).get(companyId) as any)?.c || 0;
  const pendingTimeOff = pendingTimeOffCount(companyId);
  const overdueReviews = (salaryReviewDashboard(companyId)).overdueForReview;
  const benefitSummary = benefitPlanSummary(companyId);
  const newHires30d = (dbi.prepare(`SELECT COUNT(*) c FROM employees WHERE company_id = ? AND start_date >= date('now','-30 days')`).get(companyId) as any)?.c || 0;
  const terminatedThisYear = (dbi.prepare(`SELECT COUNT(*) c FROM employees WHERE company_id = ? AND status = 'inactive' AND end_date >= date('now','start of year')`).get(companyId) as any)?.c || 0;
  const avgTenureDays = (dbi.prepare(`SELECT AVG(CAST(julianday('now') - julianday(start_date) AS INTEGER)) a FROM employees WHERE company_id = ? AND status = 'active' AND start_date IS NOT NULL`).get(companyId) as any)?.a || 0;
  const avgTenureYears = round2(avgTenureDays / 365);
  const headcountByDept = dbi.prepare(`SELECT COALESCE(NULLIF(department,''),'Unassigned') AS department, COUNT(*) AS count FROM employees WHERE company_id = ? AND status = 'active' GROUP BY department ORDER BY count DESC`).all(companyId);
  const headcountByType = dbi.prepare(`SELECT employment_type, COUNT(*) AS count FROM employees WHERE company_id = ? AND status = 'active' GROUP BY employment_type`).all(companyId);
  return {
    activeEmployees: activeCount, inactiveEmployees: inactiveCount,
    pendingTimeOffRequests: pendingTimeOff, overdueForReview: overdueReviews,
    activeBenefitPlans: benefitSummary.plans, benefitEnrollments: benefitSummary.activeEnrollments,
    monthlyBenefitCost: round2(benefitSummary.totalEmployerCost),
    newHiresLast30Days: newHires30d, terminatedThisYear: terminatedThisYear,
    avgTenureYears, headcountByDept, headcountByType,
  };
}
export function turnoverRate(companyId: string, year?: number) {
  const y = year || new Date().getFullYear();
  const dbi = db.getDb();
  const start = (dbi.prepare(`SELECT COUNT(*) c FROM employees WHERE company_id = ? AND start_date < '${y}-01-01'`).get(companyId) as any)?.c || 0;
  const end = (dbi.prepare(`SELECT COUNT(*) c FROM employees WHERE company_id = ? AND (status = 'active' OR (status = 'inactive' AND end_date >= '${y}-12-31'))`).get(companyId) as any)?.c || 0;
  const terms = (dbi.prepare(`SELECT COUNT(*) c FROM employees WHERE company_id = ? AND status = 'inactive' AND end_date >= '${y}-01-01' AND end_date <= '${y}-12-31'`).get(companyId) as any)?.c || 0;
  const avg = (start + end) / 2;
  return { year: y, terminations: terms, avgHeadcount: round2(avg), turnoverPct: avg > 0 ? round2((terms / avg) * 100) : 0 };
}
export function payrollCostSummary(companyId: string) {
  const dbi = db.getDb();
  const totalGross = (dbi.prepare(`SELECT COALESCE(SUM(gross_pay),0) t FROM pay_stubs WHERE company_id = ?`).get(companyId) as any)?.t || 0;
  const totalNet = (dbi.prepare(`SELECT COALESCE(SUM(net_pay),0) t FROM pay_stubs WHERE company_id = ?`).get(companyId) as any)?.t || 0;
  const totalTaxes = (dbi.prepare(`SELECT COALESCE(SUM(total_taxes),0) t FROM pay_stubs WHERE company_id = ?`).get(companyId) as any)?.t || 0;
  const runCount = (dbi.prepare(`SELECT COUNT(*) c FROM payroll_runs WHERE company_id = ?`).get(companyId) as any)?.c || 0;
  return { totalGross: round2(totalGross), totalNet: round2(totalNet), totalTaxes: round2(totalTaxes), payrollRuns: runCount };
}
export function anniversariesThisMonth(companyId: string) {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return db.getDb().prepare(`SELECT id, name, start_date, CAST((julianday('now') - julianday(start_date)) / 365 AS INTEGER) AS years FROM employees WHERE company_id = ? AND status = 'active' AND start_date IS NOT NULL AND substr(start_date,6,2) = ? ORDER BY substr(start_date,9,2)`).all(companyId, m);
}
export function birthdaysThisMonth(companyId: string) {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  try {
    return db.getDb().prepare(`SELECT id, name, date_of_birth FROM employees WHERE company_id = ? AND status = 'active' AND date_of_birth IS NOT NULL AND substr(date_of_birth,6,2) = ? ORDER BY substr(date_of_birth,9,2)`).all(companyId, m);
  } catch { return []; }
}
