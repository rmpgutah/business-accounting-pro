// ─── Accounting Deep-Dive Part 2: F226-F260 (35 features) ───
//
// Batch F: Cost Accounting (F226-F235)
// Batch G: Audit & Controls (F236-F245)
// Batch H: Budgeting & Forecasting Advanced (F246-F255)
// Batch I: Financial Statements + Analysis (F256-F260)

import { randomUUID as uuid } from 'crypto';
import * as db from '../database';

const now = (): string => new Date().toISOString();
const today = (): string => now().slice(0, 10);
const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;

// ════════════════════════════════════════════════════════════════
// Batch F: Cost Accounting (F226-F235)
// ════════════════════════════════════════════════════════════════

// F226 — cost centers
export function upsertCostCenter(c: any): any {
  const dbi = db.getDb();
  const id = c.id || uuid();
  if (c.id) {
    dbi.prepare(`UPDATE cost_centers SET code = ?, name = ?, parent_id = ?, manager = ?, description = ?, is_active = ?, updated_at = ? WHERE id = ?`)
      .run(c.code, c.name, c.parent_id || null, c.manager || null, c.description || null, c.is_active === false ? 0 : 1, now(), c.id);
  } else {
    dbi.prepare(`INSERT INTO cost_centers (id, company_id, code, name, parent_id, manager, description, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, c.company_id, c.code, c.name, c.parent_id || null, c.manager || null, c.description || null, c.is_active === false ? 0 : 1, now(), now());
  }
  return { id, ...c };
}

export function listCostCenters(companyId: string, activeOnly: boolean = false): any[] {
  const dbi = db.getDb();
  let where = 'company_id = ?';
  if (activeOnly) where += ' AND is_active = 1';
  return dbi.prepare(`SELECT * FROM cost_centers WHERE ${where} ORDER BY code`).all(companyId) as any[];
}

// F227 — cost allocation rules
export function upsertCostAllocationRule(r: any): any {
  const dbi = db.getDb();
  const id = r.id || uuid();
  if (r.id) {
    dbi.prepare(`UPDATE cost_allocation_rules SET rule_name = ?, source_cost_center_id = ?, source_account_id = ?, allocation_method = ?, targets_json = ?, is_active = ?, run_frequency = ?, updated_at = ? WHERE id = ?`)
      .run(r.rule_name, r.source_cost_center_id || null, r.source_account_id || null, r.allocation_method || 'percent', JSON.stringify(r.targets || []), r.is_active === false ? 0 : 1, r.run_frequency || 'monthly', now(), r.id);
  } else {
    dbi.prepare(`INSERT INTO cost_allocation_rules (id, company_id, rule_name, source_cost_center_id, source_account_id, allocation_method, targets_json, is_active, run_frequency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, r.company_id, r.rule_name, r.source_cost_center_id || null, r.source_account_id || null, r.allocation_method || 'percent', JSON.stringify(r.targets || []), r.is_active === false ? 0 : 1, r.run_frequency || 'monthly', now(), now());
  }
  return { id, ...r };
}

export function runCostAllocation(ruleId: string, amount: number): { allocations: Array<{ target_cost_center_id: string; amount: number }>; total_allocated: number } {
  const dbi = db.getDb();
  const r = dbi.prepare(`SELECT * FROM cost_allocation_rules WHERE id = ?`).get(ruleId) as any;
  if (!r) throw new Error('Rule not found');
  const targets = JSON.parse(r.targets_json || '[]');
  const allocations: any[] = [];
  let total = 0;
  if (r.allocation_method === 'percent') {
    for (const t of targets) {
      const a = round2(amount * (t.percent || 0) / 100);
      allocations.push({ target_cost_center_id: t.cost_center_id, amount: a });
      total += a;
    }
  } else if (r.allocation_method === 'evenly') {
    const each = round2(amount / Math.max(targets.length, 1));
    for (const t of targets) { allocations.push({ target_cost_center_id: t.cost_center_id, amount: each }); total += each; }
  }
  dbi.prepare(`UPDATE cost_allocation_rules SET last_run_date = ? WHERE id = ?`).run(today(), ruleId);
  return { allocations, total_allocated: round2(total) };
}

export function listAllocationRulesF(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM cost_allocation_rules WHERE company_id = ? ORDER BY rule_name`).all(companyId) as any[];
}

// F228 — departments + department P&L
export function upsertDepartment(d: any): any {
  const dbi = db.getDb();
  const id = d.id || uuid();
  if (d.id) {
    dbi.prepare(`UPDATE departments SET code = ?, name = ?, manager_id = ?, parent_id = ?, description = ?, is_active = ?, updated_at = ? WHERE id = ?`)
      .run(d.code, d.name, d.manager_id || null, d.parent_id || null, d.description || null, d.is_active === false ? 0 : 1, now(), d.id);
  } else {
    dbi.prepare(`INSERT INTO departments (id, company_id, code, name, manager_id, parent_id, description, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, d.company_id, d.code, d.name, d.manager_id || null, d.parent_id || null, d.description || null, d.is_active === false ? 0 : 1, now(), now());
  }
  return { id, ...d };
}

export function listDepartments(companyId: string, activeOnly: boolean = false): any[] {
  const dbi = db.getDb();
  let where = 'company_id = ?';
  if (activeOnly) where += ' AND is_active = 1';
  return dbi.prepare(`SELECT * FROM departments WHERE ${where} ORDER BY code`).all(companyId) as any[];
}

export function departmentPL(companyId: string, departmentId: string, periodStart: string, periodEnd: string): { revenue: number; expenses: number; net_income: number; by_account: any[] } {
  // Note: this assumes journal_entry_lines has an optional department_id column; if not present, returns empty roll-up
  const dbi = db.getDb();
  let byAccount: any[] = [];
  try {
    byAccount = dbi.prepare(`
      SELECT a.id AS account_id, a.code, a.name, a.account_type,
        COALESCE(SUM(jel.credit - jel.debit), 0) AS net
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel.journal_entry_id
        JOIN accounts a ON a.id = jel.account_id
       WHERE je.company_id = ? AND je.is_posted = 1 AND je.entry_date BETWEEN ? AND ?
         AND jel.department_id = ?
         AND a.account_type IN ('revenue','other_income','expense','other_expense','cost_of_sales')
       GROUP BY a.id
       ORDER BY a.code
    `).all(companyId, periodStart, periodEnd, departmentId) as any[];
  } catch {
    // department_id may not exist on jel; fall through
    byAccount = [];
  }
  let revenue = 0;
  let expenses = 0;
  for (const a of byAccount) {
    if (['revenue', 'other_income'].includes(a.account_type)) revenue += a.net;
    else expenses += -a.net; // negate because expenses are debits
  }
  return { revenue: round2(revenue), expenses: round2(expenses), net_income: round2(revenue - expenses), by_account: byAccount };
}

// F229 — activity-based costing pools
export function upsertCostPool(p: any): any {
  const dbi = db.getDb();
  const id = p.id || uuid();
  const rate = (p.total_driver_units || 0) > 0 ? round2((p.total_cost || 0) / p.total_driver_units) : 0;
  if (p.id) {
    dbi.prepare(`UPDATE activity_cost_pools SET pool_name = ?, cost_driver = ?, total_cost = ?, total_driver_units = ?, rate = ?, period_start = ?, period_end = ?, is_active = ? WHERE id = ?`)
      .run(p.pool_name, p.cost_driver || null, p.total_cost || 0, p.total_driver_units || 0, rate, p.period_start || null, p.period_end || null, p.is_active === false ? 0 : 1, p.id);
  } else {
    dbi.prepare(`INSERT INTO activity_cost_pools (id, company_id, pool_name, cost_driver, total_cost, total_driver_units, rate, period_start, period_end, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, p.company_id, p.pool_name, p.cost_driver || null, p.total_cost || 0, p.total_driver_units || 0, rate, p.period_start || null, p.period_end || null, p.is_active === false ? 0 : 1, now());
  }
  return { id, rate };
}

export function listCostPools(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM activity_cost_pools WHERE company_id = ? ORDER BY pool_name`).all(companyId) as any[];
}

// F230 — standard costs
export function upsertStandardCost(s: any): any {
  const dbi = db.getDb();
  const id = s.id || uuid();
  if (s.id) {
    dbi.prepare(`UPDATE standard_costs SET item_id = ?, cost_category = ?, standard_unit_cost = ?, effective_from = ?, effective_to = ?, notes = ?, updated_at = ? WHERE id = ?`)
      .run(s.item_id || null, s.cost_category || null, s.standard_unit_cost || 0, s.effective_from || null, s.effective_to || null, s.notes || null, now(), s.id);
  } else {
    dbi.prepare(`INSERT INTO standard_costs (id, company_id, item_id, cost_category, standard_unit_cost, effective_from, effective_to, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, s.company_id, s.item_id || null, s.cost_category || null, s.standard_unit_cost || 0, s.effective_from || null, s.effective_to || null, s.notes || null, now(), now());
  }
  return { id, ...s };
}

export function listStandardCosts(companyId: string, opts?: { item_id?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.item_id) { where += ' AND item_id = ?'; params.push(opts.item_id); }
  return dbi.prepare(`SELECT * FROM standard_costs WHERE ${where} ORDER BY effective_from DESC`).all(...params) as any[];
}

// F231 — variance analysis
export function calculateVariance(v: any): any {
  const priceVar = round2(((v.actual_price || 0) - (v.standard_price || 0)) * (v.actual_quantity || 0));
  const qtyVar = round2(((v.actual_quantity || 0) - (v.standard_quantity || 0)) * (v.standard_price || 0));
  const totalVar = round2(priceVar + qtyVar);
  const id = uuid();
  db.getDb().prepare(`INSERT INTO cost_variance_analyses (id, company_id, period_start, period_end, item_id, standard_quantity, actual_quantity, standard_price, actual_price, price_variance, quantity_variance, total_variance, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, v.company_id, v.period_start, v.period_end, v.item_id || null, v.standard_quantity || 0, v.actual_quantity || 0, v.standard_price || 0, v.actual_price || 0, priceVar, qtyVar, totalVar, v.notes || null, now());
  return { id, price_variance: priceVar, quantity_variance: qtyVar, total_variance: totalVar };
}

export function listVarianceAnalyses(companyId: string, opts?: { item_id?: string; limit?: number }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.item_id) { where += ' AND item_id = ?'; params.push(opts.item_id); }
  return dbi.prepare(`SELECT * FROM cost_variance_analyses WHERE ${where} ORDER BY period_end DESC LIMIT ${Math.min(opts?.limit || 100, 1000)}`).all(...params) as any[];
}

// F232 — overhead rates
export function upsertOverheadRate(r: any): any {
  const id = r.id || uuid();
  db.getDb().prepare(`INSERT INTO overhead_rates (id, company_id, rate_name, cost_pool_id, basis, rate_per_unit, effective_from, effective_to, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, r.company_id, r.rate_name, r.cost_pool_id || null, r.basis || 'labor_hours', r.rate_per_unit || 0, r.effective_from || null, r.effective_to || null, r.notes || null, now());
  return { id };
}

export function applyOverhead(rateId: string, units: number): number {
  const r = db.getDb().prepare(`SELECT rate_per_unit FROM overhead_rates WHERE id = ?`).get(rateId) as any;
  return r ? round2((r.rate_per_unit || 0) * units) : 0;
}

export function listOverheadRates(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM overhead_rates WHERE company_id = ? ORDER BY effective_from DESC`).all(companyId) as any[];
}

// F233 — WIP
export function upsertWIP(w: any): any {
  const dbi = db.getDb();
  const id = w.id || uuid();
  const total = round2((w.materials_cost || 0) + (w.labor_cost || 0) + (w.overhead_cost || 0));
  if (w.id) {
    dbi.prepare(`UPDATE work_in_process SET completed_at = ?, materials_cost = ?, labor_cost = ?, overhead_cost = ?, total_wip = ?, status = ?, notes = ?, updated_at = ? WHERE id = ?`)
      .run(w.completed_at || null, w.materials_cost || 0, w.labor_cost || 0, w.overhead_cost || 0, total, w.status || 'in_process', w.notes || null, now(), w.id);
  } else {
    dbi.prepare(`INSERT INTO work_in_process (id, company_id, job_number, project_id, started_at, materials_cost, labor_cost, overhead_cost, total_wip, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'in_process', ?, ?, ?)`)
      .run(id, w.company_id, w.job_number || null, w.project_id || null, w.started_at || now(), w.materials_cost || 0, w.labor_cost || 0, w.overhead_cost || 0, total, w.notes || null, now(), now());
  }
  return { id, total_wip: total };
}

export function listWIP(companyId: string, opts?: { status?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  return dbi.prepare(`SELECT * FROM work_in_process WHERE ${where} ORDER BY started_at DESC`).all(...params) as any[];
}

// F234 — COGS engine (simple periodic calculation)
export function computeCOGS(companyId: string, periodStart: string, periodEnd: string): { opening_inventory: number; purchases: number; closing_inventory: number; cogs: number } {
  const dbi = db.getDb();
  // Use account_balance_history if present, otherwise fall back to inventory_value_history
  let opening = 0, closing = 0;
  try {
    const o = dbi.prepare(`SELECT total_value AS v FROM inventory_value_history WHERE company_id = ? AND snapshot_date < ? ORDER BY snapshot_date DESC LIMIT 1`).get(companyId, periodStart) as any;
    const c = dbi.prepare(`SELECT total_value AS v FROM inventory_value_history WHERE company_id = ? AND snapshot_date <= ? ORDER BY snapshot_date DESC LIMIT 1`).get(companyId, periodEnd) as any;
    opening = o?.v || 0;
    closing = c?.v || 0;
  } catch {}
  // Purchases approximated by sum of bill amounts in period
  const purch = dbi.prepare(`SELECT COALESCE(SUM(total), 0) AS p FROM bills WHERE company_id = ? AND bill_date BETWEEN ? AND ? AND (deleted_at IS NULL OR deleted_at = '')`).get(companyId, periodStart, periodEnd) as any;
  const purchases = purch.p || 0;
  const cogs = round2(opening + purchases - closing);
  return { opening_inventory: round2(opening), purchases: round2(purchases), closing_inventory: round2(closing), cogs };
}

// F235 — burden rates
export function upsertBurdenRate(b: any): any {
  const id = b.id || uuid();
  const loaded = round2((b.base_hourly_rate || 0) * (1 + (b.burden_rate_percent || 0) / 100));
  db.getDb().prepare(`INSERT INTO burden_rates (id, company_id, employee_class, base_hourly_rate, burden_rate_percent, fully_loaded_rate, effective_from, effective_to, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, b.company_id, b.employee_class || null, b.base_hourly_rate || 0, b.burden_rate_percent || 0, loaded, b.effective_from || null, b.effective_to || null, b.notes || null, now());
  return { id, fully_loaded_rate: loaded };
}

export function listBurdenRates(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM burden_rates WHERE company_id = ? ORDER BY effective_from DESC`).all(companyId) as any[];
}

// ════════════════════════════════════════════════════════════════
// Batch G: Audit & Controls (F236-F245)
// ════════════════════════════════════════════════════════════════

// F236 — TB comparison
export function captureTBSnapshot(companyId: string, periodEnd: string, fiscalYear?: number): any {
  const dbi = db.getDb();
  const rows = dbi.prepare(`
    SELECT a.id, a.code, a.name, a.account_type,
      COALESCE(SUM(jel.debit), 0) AS debit,
      COALESCE(SUM(jel.credit), 0) AS credit
      FROM accounts a
      LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
      LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.is_posted = 1 AND je.entry_date <= ?
     WHERE a.company_id = ? AND (a.deleted_at IS NULL OR a.deleted_at = '')
     GROUP BY a.id
  `).all(periodEnd, companyId) as any[];
  const totalD = rows.reduce((s, r) => s + (r.debit || 0), 0);
  const totalC = rows.reduce((s, r) => s + (r.credit || 0), 0);
  const id = uuid();
  dbi.prepare(`INSERT INTO tb_comparison_snapshots (id, company_id, period_end, fiscal_year, snapshot_data, total_debit, total_credit, is_balanced, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(company_id, period_end) DO UPDATE SET snapshot_data = excluded.snapshot_data, total_debit = excluded.total_debit, total_credit = excluded.total_credit, is_balanced = excluded.is_balanced`)
    .run(id, companyId, periodEnd, fiscalYear || null, JSON.stringify(rows), round2(totalD), round2(totalC), Math.abs(totalD - totalC) < 0.005 ? 1 : 0, now());
  return { id, total_debit: round2(totalD), total_credit: round2(totalC), is_balanced: Math.abs(totalD - totalC) < 0.005, account_count: rows.length };
}

export function compareTBSnapshots(companyId: string, periodEnd1: string, periodEnd2: string): { account_id: string; code: string; name: string; balance_1: number; balance_2: number; change: number; change_percent: number }[] {
  const dbi = db.getDb();
  const s1 = dbi.prepare(`SELECT snapshot_data FROM tb_comparison_snapshots WHERE company_id = ? AND period_end = ?`).get(companyId, periodEnd1) as any;
  const s2 = dbi.prepare(`SELECT snapshot_data FROM tb_comparison_snapshots WHERE company_id = ? AND period_end = ?`).get(companyId, periodEnd2) as any;
  if (!s1 || !s2) throw new Error('One or both snapshots missing');
  const rows1 = JSON.parse(s1.snapshot_data || '[]') as any[];
  const rows2 = JSON.parse(s2.snapshot_data || '[]') as any[];
  const map1 = new Map<string, any>();
  for (const r of rows1) map1.set(r.id, r);
  const result: any[] = [];
  for (const r of rows2) {
    const a = map1.get(r.id);
    const bal1 = a ? (a.debit - a.credit) : 0;
    const bal2 = r.debit - r.credit;
    const change = round2(bal2 - bal1);
    const pct = bal1 !== 0 ? round2((change / Math.abs(bal1)) * 100) : 0;
    result.push({ account_id: r.id, code: r.code, name: r.name, balance_1: round2(bal1), balance_2: round2(bal2), change, change_percent: pct });
  }
  return result;
}

export function listTBSnapshots(companyId: string): any[] {
  return db.getDb().prepare(`SELECT id, company_id, period_end, fiscal_year, total_debit, total_credit, is_balanced, created_at FROM tb_comparison_snapshots WHERE company_id = ? ORDER BY period_end DESC`).all(companyId) as any[];
}

// F237 — materiality
export function calculateMateriality(m: any): any {
  const overall = round2((m.benchmark_amount || 0) * (m.materiality_percent || 5) / 100);
  const performance = round2(overall * 0.75);
  const trivial = round2(overall * 0.05);
  const id = uuid();
  db.getDb().prepare(`INSERT INTO materiality_calcs (id, company_id, fiscal_year, benchmark_type, benchmark_amount, materiality_percent, overall_materiality, performance_materiality, trivial_threshold, rationale, determined_by, determined_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, m.company_id, m.fiscal_year, m.benchmark_type || 'pretax_income', m.benchmark_amount || 0, m.materiality_percent || 5, overall, performance, trivial, m.rationale || null, m.determined_by || null, now());
  return { id, overall_materiality: overall, performance_materiality: performance, trivial_threshold: trivial };
}

export function listMaterialityCalcs(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM materiality_calcs WHERE company_id = ? ORDER BY fiscal_year DESC`).all(companyId) as any[];
}

// F238 — audit sampling
export function generateAuditSample(opts: { company_id: string; population_description: string; population_items: any[]; sample_size: number; method?: 'random' | 'systematic' | 'stratified'; stratification?: string; auditor?: string }): any {
  const id = uuid();
  const method = opts.method || 'random';
  let selected: any[] = [];
  const pop = opts.population_items || [];
  const sampleSize = Math.min(opts.sample_size, pop.length);
  if (method === 'random') {
    const shuffled = [...pop].sort(() => Math.random() - 0.5);
    selected = shuffled.slice(0, sampleSize);
  } else if (method === 'systematic') {
    const step = Math.max(1, Math.floor(pop.length / sampleSize));
    for (let i = 0; i < sampleSize; i++) selected.push(pop[i * step]);
  } else if (method === 'stratified') {
    // Simple stratification by 3 buckets of equal size
    const buckets = 3;
    const perBucket = Math.floor(sampleSize / buckets);
    const popPerBucket = Math.floor(pop.length / buckets);
    for (let b = 0; b < buckets; b++) {
      const bucket = pop.slice(b * popPerBucket, (b + 1) * popPerBucket);
      const shuffled = [...bucket].sort(() => Math.random() - 0.5);
      selected.push(...shuffled.slice(0, perBucket));
    }
  }
  db.getDb().prepare(`INSERT INTO audit_samples (id, company_id, population_description, population_size, sample_size, sampling_method, stratification, selected_items_json, auditor, test_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, opts.company_id, opts.population_description, pop.length, selected.length, method, opts.stratification || null, JSON.stringify(selected), opts.auditor || null, today(), now());
  return { id, sample_size: selected.length, selected };
}

export function listAuditSamples(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM audit_samples WHERE company_id = ? ORDER BY test_date DESC`).all(companyId) as any[];
}

// F239 — audit confirmations
export function upsertAuditConfirmation(c: any): any {
  const dbi = db.getDb();
  const id = c.id || uuid();
  const discrepancy = round2((c.balance_confirmed || 0) - (c.balance_per_books || 0));
  if (c.id) {
    dbi.prepare(`UPDATE audit_confirmations SET confirmation_type = ?, third_party_name = ?, third_party_contact = ?, balance_per_books = ?, balance_confirmed = ?, confirmation_date = ?, sent_date = ?, response_received_date = ?, response_method = ?, discrepancy = ?, resolution = ?, status = ?, notes = ? WHERE id = ?`)
      .run(c.confirmation_type || 'ar', c.third_party_name, c.third_party_contact || null, c.balance_per_books || 0, c.balance_confirmed || 0, c.confirmation_date || null, c.sent_date || null, c.response_received_date || null, c.response_method || null, discrepancy, c.resolution || null, c.status || 'pending', c.notes || null, c.id);
  } else {
    dbi.prepare(`INSERT INTO audit_confirmations (id, company_id, confirmation_type, third_party_name, third_party_contact, balance_per_books, balance_confirmed, confirmation_date, sent_date, response_received_date, response_method, discrepancy, resolution, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
      .run(id, c.company_id, c.confirmation_type || 'ar', c.third_party_name, c.third_party_contact || null, c.balance_per_books || 0, c.balance_confirmed || 0, c.confirmation_date || null, c.sent_date || null, c.response_received_date || null, c.response_method || null, discrepancy, c.resolution || null, c.notes || null, now());
  }
  return { id, discrepancy };
}

export function listAuditConfirmations(companyId: string, opts?: { status?: string; confirmation_type?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  if (opts?.confirmation_type) { where += ' AND confirmation_type = ?'; params.push(opts.confirmation_type); }
  return dbi.prepare(`SELECT * FROM audit_confirmations WHERE ${where} ORDER BY confirmation_date DESC`).all(...params) as any[];
}

// F240 — walkthroughs
export function recordWalkthrough(w: any): any {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO audit_walkthroughs (id, company_id, process_name, walked_by, walkthrough_date, process_owner, inputs, activities, outputs, risks_identified, controls_identified, deficiencies_noted, document_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, w.company_id, w.process_name, w.walked_by || null, w.walkthrough_date || today(), w.process_owner || null, w.inputs || null, w.activities || null, w.outputs || null, w.risks_identified || null, w.controls_identified || null, w.deficiencies_noted || null, w.document_path || null, now());
  return { id };
}

export function listWalkthroughs(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM audit_walkthroughs WHERE company_id = ? ORDER BY walkthrough_date DESC`).all(companyId) as any[];
}

// F241 — SoD matrix
export function declareSoDConflict(c: any): any {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO sod_conflicts (id, company_id, conflicting_function_a, conflicting_function_b, risk_level, mitigation_required, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`)
    .run(id, c.company_id, c.conflicting_function_a, c.conflicting_function_b, c.risk_level || 'medium', c.mitigation_required || null, now());
  return { id };
}

export function assignUserFunction(a: any): any {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO sod_user_assignments (id, company_id, user_id, function_code, granted_at, granted_by) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, a.company_id, a.user_id, a.function_code, now(), a.granted_by || null);
  return { id };
}

export function checkSoDForUser(companyId: string, userId: string): { user_id: string; assigned_functions: string[]; conflicts: any[] } {
  const dbi = db.getDb();
  const funcs = (dbi.prepare(`SELECT DISTINCT function_code FROM sod_user_assignments WHERE company_id = ? AND user_id = ?`).all(companyId, userId) as any[]).map(r => r.function_code);
  const conflicts: any[] = [];
  for (let i = 0; i < funcs.length; i++) {
    for (let j = i + 1; j < funcs.length; j++) {
      const c = dbi.prepare(`SELECT * FROM sod_conflicts WHERE company_id = ? AND is_active = 1 AND ((conflicting_function_a = ? AND conflicting_function_b = ?) OR (conflicting_function_a = ? AND conflicting_function_b = ?)) LIMIT 1`).get(companyId, funcs[i], funcs[j], funcs[j], funcs[i]) as any;
      if (c) conflicts.push(c);
    }
  }
  return { user_id: userId, assigned_functions: funcs, conflicts };
}

export function listSoDConflicts(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM sod_conflicts WHERE company_id = ? AND is_active = 1`).all(companyId) as any[];
}

// F242 — RCSA
export function upsertRCSA(r: any): any {
  const dbi = db.getDb();
  const id = r.id || uuid();
  if (r.id) {
    dbi.prepare(`UPDATE rcsa_assessments SET assessment_name = ?, process_area = ?, risk_description = ?, inherent_likelihood = ?, inherent_impact = ?, control_description = ?, residual_likelihood = ?, residual_impact = ?, action_plan = ?, owner = ?, assessment_date = ?, next_review_date = ?, status = ? WHERE id = ?`)
      .run(r.assessment_name, r.process_area || null, r.risk_description || null, r.inherent_likelihood || 'medium', r.inherent_impact || 'medium', r.control_description || null, r.residual_likelihood || 'low', r.residual_impact || 'low', r.action_plan || null, r.owner || null, r.assessment_date || null, r.next_review_date || null, r.status || 'active', r.id);
  } else {
    dbi.prepare(`INSERT INTO rcsa_assessments (id, company_id, assessment_name, process_area, risk_description, inherent_likelihood, inherent_impact, control_description, residual_likelihood, residual_impact, action_plan, owner, assessment_date, next_review_date, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`)
      .run(id, r.company_id, r.assessment_name, r.process_area || null, r.risk_description || null, r.inherent_likelihood || 'medium', r.inherent_impact || 'medium', r.control_description || null, r.residual_likelihood || 'low', r.residual_impact || 'low', r.action_plan || null, r.owner || null, r.assessment_date || today(), r.next_review_date || null, now());
  }
  return { id };
}

export function listRCSAs(companyId: string, opts?: { status?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  return dbi.prepare(`SELECT * FROM rcsa_assessments WHERE ${where} ORDER BY assessment_date DESC`).all(...params) as any[];
}

// F243 — audit issues
export function upsertAuditIssue(i: any): any {
  const dbi = db.getDb();
  const id = i.id || uuid();
  const issueNumber = i.issue_number || `ISS-${Date.now().toString().slice(-6)}`;
  if (i.id) {
    dbi.prepare(`UPDATE audit_issues SET title = ?, severity = ?, category = ?, description = ?, root_cause = ?, recommendation = ?, management_response = ?, assigned_to = ?, target_resolution_date = ?, status = ?, resolved_at = ?, resolution_notes = ?, updated_at = ? WHERE id = ?`)
      .run(i.title, i.severity || 'medium', i.category || null, i.description || null, i.root_cause || null, i.recommendation || null, i.management_response || null, i.assigned_to || null, i.target_resolution_date || null, i.status || 'open', i.resolved_at || null, i.resolution_notes || null, now(), i.id);
  } else {
    dbi.prepare(`INSERT INTO audit_issues (id, company_id, issue_number, title, severity, category, description, root_cause, recommendation, management_response, assigned_to, target_resolution_date, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`)
      .run(id, i.company_id, issueNumber, i.title, i.severity || 'medium', i.category || null, i.description || null, i.root_cause || null, i.recommendation || null, i.management_response || null, i.assigned_to || null, i.target_resolution_date || null, now(), now());
  }
  return { id, issue_number: issueNumber };
}

export function resolveAuditIssue(id: string, resolutionNotes: string): boolean {
  const r = db.getDb().prepare(`UPDATE audit_issues SET status = 'resolved', resolved_at = ?, resolution_notes = ?, updated_at = ? WHERE id = ?`).run(now(), resolutionNotes, now(), id);
  return r.changes > 0;
}

export function listAuditIssues(companyId: string, opts?: { status?: string; severity?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  if (opts?.severity) { where += ' AND severity = ?'; params.push(opts.severity); }
  return dbi.prepare(`SELECT * FROM audit_issues WHERE ${where} ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, target_resolution_date ASC NULLS LAST`).all(...params) as any[];
}

// F244 — control deficiencies
export function logControlDeficiency(d: any): any {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO control_deficiencies (id, company_id, control_reference, deficiency_type, severity, description, impact, identified_date, identified_by, status, remediation_plan, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`)
    .run(id, d.company_id, d.control_reference || null, d.deficiency_type || 'design', d.severity || 'significant', d.description, d.impact || null, d.identified_date || today(), d.identified_by || null, d.remediation_plan || null, d.notes || null, now());
  return { id };
}

export function remediateDeficiency(id: string): boolean {
  const r = db.getDb().prepare(`UPDATE control_deficiencies SET status = 'remediated', remediated_at = ? WHERE id = ?`).run(now(), id);
  return r.changes > 0;
}

export function listControlDeficiencies(companyId: string, opts?: { status?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  return dbi.prepare(`SELECT * FROM control_deficiencies WHERE ${where} ORDER BY identified_date DESC`).all(...params) as any[];
}

// F245 — auditor inquiries
export function logAuditorInquiry(i: any): any {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO auditor_inquiries (id, company_id, auditor_firm, auditor_contact, inquiry_date, inquiry_subject, inquiry_text, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`)
    .run(id, i.company_id, i.auditor_firm || null, i.auditor_contact || null, i.inquiry_date || today(), i.inquiry_subject, i.inquiry_text || null, now());
  return { id };
}

export function respondToInquiry(id: string, responseText: string, responseBy?: string, supportingDocs?: string): boolean {
  const r = db.getDb().prepare(`UPDATE auditor_inquiries SET response_text = ?, response_date = ?, response_by = ?, supporting_docs = ?, status = 'responded' WHERE id = ?`).run(responseText, now(), responseBy || null, supportingDocs || null, id);
  return r.changes > 0;
}

export function listAuditorInquiries(companyId: string, opts?: { status?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  return dbi.prepare(`SELECT * FROM auditor_inquiries WHERE ${where} ORDER BY inquiry_date DESC`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// Batch H: Budgeting & Forecasting Advanced (F246-F255)
// ════════════════════════════════════════════════════════════════

// F246 — rolling forecasts
export function upsertRollingForecast(f: any): any {
  const dbi = db.getDb();
  const id = f.id || uuid();
  if (f.id) {
    dbi.prepare(`UPDATE rolling_forecasts SET forecast_name = ?, horizon_months = ?, base_period = ?, refresh_frequency = ?, methodology = ?, is_active = ?, updated_at = ? WHERE id = ?`)
      .run(f.forecast_name, f.horizon_months || 12, f.base_period, f.refresh_frequency || 'monthly', f.methodology || null, f.is_active === false ? 0 : 1, now(), f.id);
  } else {
    dbi.prepare(`INSERT INTO rolling_forecasts (id, company_id, forecast_name, horizon_months, base_period, refresh_frequency, methodology, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, f.company_id, f.forecast_name, f.horizon_months || 12, f.base_period, f.refresh_frequency || 'monthly', f.methodology || null, f.is_active === false ? 0 : 1, now(), now());
  }
  return { id };
}

export function setForecastLines(forecastId: string, lines: Array<{ account_id: string; period_month: string; forecasted_amount: number; notes?: string }>): { added: number } {
  const dbi = db.getDb();
  dbi.prepare(`DELETE FROM rolling_forecast_lines WHERE forecast_id = ?`).run(forecastId);
  const insert = dbi.prepare(`INSERT INTO rolling_forecast_lines (id, forecast_id, account_id, period_month, forecasted_amount, notes) VALUES (?, ?, ?, ?, ?, ?)`);
  const tx = dbi.transaction(() => {
    for (const l of lines) insert.run(uuid(), forecastId, l.account_id, l.period_month, l.forecasted_amount || 0, l.notes || null);
  });
  tx();
  dbi.prepare(`UPDATE rolling_forecasts SET last_refreshed_at = ? WHERE id = ?`).run(now(), forecastId);
  return { added: lines.length };
}

export function getForecastLines(forecastId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM rolling_forecast_lines WHERE forecast_id = ? ORDER BY period_month, account_id`).all(forecastId) as any[];
}

export function listRollingForecasts(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM rolling_forecasts WHERE company_id = ? ORDER BY base_period DESC`).all(companyId) as any[];
}

// F247 — what-if scenarios
export function createScenario(s: any): any {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO scenario_models (id, company_id, scenario_name, base_forecast_id, assumptions_json, projected_revenue, projected_expenses, projected_net_income, is_baseline, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, s.company_id, s.scenario_name, s.base_forecast_id || null, JSON.stringify(s.assumptions || {}), s.projected_revenue || 0, s.projected_expenses || 0, s.projected_net_income || 0, s.is_baseline ? 1 : 0, s.notes || null, now(), s.created_by || null);
  return { id };
}

export function applyAssumptions(baseLines: Array<{ account_id: string; period_month: string; forecasted_amount: number }>, assumptions: { revenue_growth_percent?: number; expense_growth_percent?: number; category_overrides?: Record<string, number> }): any[] {
  return baseLines.map(l => {
    let adj = l.forecasted_amount;
    if (assumptions.revenue_growth_percent !== undefined) adj = adj * (1 + assumptions.revenue_growth_percent / 100);
    if (assumptions.category_overrides && assumptions.category_overrides[l.account_id] !== undefined) adj = assumptions.category_overrides[l.account_id];
    return { ...l, adjusted_amount: round2(adj) };
  });
}

export function listScenarios(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM scenario_models WHERE company_id = ? ORDER BY created_at DESC`).all(companyId) as any[];
}

// F248 — variance explanations
export function recordVarianceExplanation(v: any): any {
  const variance = round2((v.actual_amount || 0) - (v.budgeted_amount || 0));
  const pct = (v.budgeted_amount || 0) !== 0 ? round2((variance / Math.abs(v.budgeted_amount)) * 100) : 0;
  const id = uuid();
  db.getDb().prepare(`INSERT INTO variance_explanations (id, company_id, period_month, account_id, budgeted_amount, actual_amount, variance, variance_percent, explanation, explained_by, explained_at, is_material, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, v.company_id, v.period_month, v.account_id || null, v.budgeted_amount || 0, v.actual_amount || 0, variance, pct, v.explanation || null, v.explained_by || null, v.explained_by ? now() : null, Math.abs(pct) >= 10 ? 1 : 0, now());
  return { id, variance, variance_percent: pct };
}

export function listVarianceExplanations(companyId: string, opts?: { period_month?: string; material_only?: boolean }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.period_month) { where += ' AND period_month = ?'; params.push(opts.period_month); }
  if (opts?.material_only) where += ' AND is_material = 1';
  return dbi.prepare(`SELECT * FROM variance_explanations WHERE ${where} ORDER BY ABS(variance_percent) DESC`).all(...params) as any[];
}

// F249 — driver-based budgeting
export function upsertBudgetDriver(d: any): any {
  const id = d.id || uuid();
  db.getDb().prepare(`INSERT INTO budget_drivers (id, company_id, driver_name, driver_type, base_value, rate_per_unit, affected_account_ids, period_start, period_end, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, d.company_id, d.driver_name, d.driver_type || 'units', d.base_value || 0, d.rate_per_unit || 0, (d.affected_account_ids || []).join(','), d.period_start || null, d.period_end || null, d.notes || null, now());
  return { id };
}

export function projectFromDriver(driverId: string, periods: number): Array<{ period: number; projected_amount: number }> {
  const d = db.getDb().prepare(`SELECT * FROM budget_drivers WHERE id = ?`).get(driverId) as any;
  if (!d) throw new Error('Driver not found');
  const result: any[] = [];
  for (let i = 0; i < periods; i++) {
    result.push({ period: i + 1, projected_amount: round2((d.base_value || 0) * (d.rate_per_unit || 0)) });
  }
  return result;
}

export function listBudgetDrivers(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM budget_drivers WHERE company_id = ? ORDER BY driver_name`).all(companyId) as any[];
}

// F250 — budget consolidation
export function createBudgetConsolidation(c: any): any {
  const dbi = db.getDb();
  const id = uuid();
  const ids = (c.source_budget_ids || []) as string[];
  let total = 0;
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    const r = dbi.prepare(`SELECT COALESCE(SUM(amount), 0) AS t FROM budget_lines WHERE budget_id IN (${placeholders})`).get(...ids) as any;
    total = r.t || 0;
  }
  dbi.prepare(`INSERT INTO budget_consolidations (id, company_id, consolidation_name, consolidation_type, fiscal_year, source_budget_ids, consolidated_total, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?)`)
    .run(id, c.company_id, c.consolidation_name, c.consolidation_type || 'bottom_up', c.fiscal_year || null, ids.join(','), round2(total), now());
  return { id, consolidated_total: round2(total) };
}

export function approveBudgetConsolidation(id: string, approvedBy: string): boolean {
  const r = db.getDb().prepare(`UPDATE budget_consolidations SET status = 'approved', approved_at = ?, approved_by = ? WHERE id = ?`).run(now(), approvedBy, id);
  return r.changes > 0;
}

export function listBudgetConsolidations(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM budget_consolidations WHERE company_id = ? ORDER BY fiscal_year DESC`).all(companyId) as any[];
}

// F251 — budget approval
export function logBudgetApproval(a: any): any {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO budget_approvals (id, company_id, budget_id, step_number, approver, action, acted_at, comment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, a.company_id, a.budget_id, a.step_number || 1, a.approver || null, a.action || null, a.action ? now() : null, a.comment || null, now());
  return { id };
}

export function listBudgetApprovals(budgetId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM budget_approvals WHERE budget_id = ? ORDER BY step_number, acted_at`).all(budgetId) as any[];
}

// F252 — forecast accuracy
export function recordForecastAccuracy(a: any): any {
  const absErr = Math.abs((a.actual_amount || 0) - (a.forecasted_amount || 0));
  const pctErr = (a.actual_amount || 0) !== 0 ? round2((absErr / Math.abs(a.actual_amount)) * 100) : 0;
  const bias = round2((a.forecasted_amount || 0) - (a.actual_amount || 0));
  const id = uuid();
  db.getDb().prepare(`INSERT INTO forecast_accuracy (id, company_id, forecast_id, period_month, forecasted_amount, actual_amount, absolute_error, percent_error, mape, bias, measured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, a.company_id, a.forecast_id || null, a.period_month, a.forecasted_amount || 0, a.actual_amount || 0, round2(absErr), pctErr, pctErr, bias, now());
  return { id, mape: pctErr, bias };
}

export function summarizeForecastAccuracy(companyId: string, forecastId?: string): { avg_mape: number; avg_bias: number; sample_size: number } {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (forecastId) { where += ' AND forecast_id = ?'; params.push(forecastId); }
  const r = dbi.prepare(`SELECT COALESCE(AVG(mape), 0) AS avg_mape, COALESCE(AVG(bias), 0) AS avg_bias, COUNT(*) AS n FROM forecast_accuracy WHERE ${where}`).get(...params) as any;
  return { avg_mape: round2(r.avg_mape), avg_bias: round2(r.avg_bias), sample_size: r.n };
}

// F253 — direct cash forecast
export function upsertDirectCashForecast(f: any): any {
  const closing = round2((f.opening_balance || 0) + (f.cash_in_collections || 0) + (f.cash_in_other || 0) - (f.cash_out_payroll || 0) - (f.cash_out_payables || 0) - (f.cash_out_tax || 0) - (f.cash_out_other || 0));
  const id = uuid();
  db.getDb().prepare(`INSERT INTO direct_cash_forecasts (id, company_id, forecast_date, week_ending, opening_balance, cash_in_collections, cash_in_other, cash_out_payroll, cash_out_payables, cash_out_tax, cash_out_other, closing_balance, minimum_balance_buffer, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, f.company_id, f.forecast_date || today(), f.week_ending, f.opening_balance || 0, f.cash_in_collections || 0, f.cash_in_other || 0, f.cash_out_payroll || 0, f.cash_out_payables || 0, f.cash_out_tax || 0, f.cash_out_other || 0, closing, f.minimum_balance_buffer || 0, f.notes || null, now());
  return { id, closing_balance: closing };
}

export function listDirectCashForecasts(companyId: string, limit: number = 26): any[] {
  return db.getDb().prepare(`SELECT * FROM direct_cash_forecasts WHERE company_id = ? ORDER BY week_ending DESC LIMIT ?`).all(companyId, Math.min(limit, 260)) as any[];
}

// F254 — headcount budget
export function upsertHeadcountBudget(h: any): any {
  const totalCost = round2((h.budgeted_count || 0) * (h.avg_salary || 0) * (1 + (h.benefits_rate || 0) / 100));
  const id = uuid();
  db.getDb().prepare(`INSERT INTO headcount_budgets (id, company_id, department_id, fiscal_year, period_month, role, budgeted_count, actual_count, avg_salary, benefits_rate, total_budget_cost, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, h.company_id, h.department_id || null, h.fiscal_year, h.period_month || null, h.role || null, h.budgeted_count || 0, h.actual_count || 0, h.avg_salary || 0, h.benefits_rate || 0, totalCost, h.notes || null, now());
  return { id, total_budget_cost: totalCost };
}

export function listHeadcountBudgets(companyId: string, opts?: { fiscal_year?: number; department_id?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.fiscal_year) { where += ' AND fiscal_year = ?'; params.push(opts.fiscal_year); }
  if (opts?.department_id) { where += ' AND department_id = ?'; params.push(opts.department_id); }
  return dbi.prepare(`SELECT * FROM headcount_budgets WHERE ${where} ORDER BY fiscal_year DESC, period_month`).all(...params) as any[];
}

// F255 — CapEx
export function upsertCapEx(c: any): any {
  const dbi = db.getDb();
  const id = c.id || uuid();
  if (c.id) {
    dbi.prepare(`UPDATE capex_plans SET project_name = ?, category = ?, department_id = ?, estimated_cost = ?, approved_cost = ?, actual_cost = ?, requested_date = ?, target_start_date = ?, target_completion_date = ?, actual_completion_date = ?, approval_status = ?, approved_by = ?, business_justification = ?, expected_roi = ?, payback_period_months = ?, asset_id = ?, notes = ?, updated_at = ? WHERE id = ?`)
      .run(c.project_name, c.category || 'equipment', c.department_id || null, c.estimated_cost || 0, c.approved_cost || 0, c.actual_cost || 0, c.requested_date || null, c.target_start_date || null, c.target_completion_date || null, c.actual_completion_date || null, c.approval_status || 'requested', c.approved_by || null, c.business_justification || null, c.expected_roi || null, c.payback_period_months || null, c.asset_id || null, c.notes || null, now(), c.id);
  } else {
    dbi.prepare(`INSERT INTO capex_plans (id, company_id, project_name, category, department_id, estimated_cost, requested_date, target_start_date, target_completion_date, approval_status, business_justification, expected_roi, payback_period_months, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', ?, ?, ?, ?, ?, ?)`)
      .run(id, c.company_id, c.project_name, c.category || 'equipment', c.department_id || null, c.estimated_cost || 0, c.requested_date || today(), c.target_start_date || null, c.target_completion_date || null, c.business_justification || null, c.expected_roi || null, c.payback_period_months || null, c.notes || null, now(), now());
  }
  return { id };
}

export function approveCapEx(id: string, approvedCost: number, approvedBy: string): boolean {
  const r = db.getDb().prepare(`UPDATE capex_plans SET approval_status = 'approved', approved_cost = ?, approved_by = ?, updated_at = ? WHERE id = ?`).run(approvedCost, approvedBy, now(), id);
  return r.changes > 0;
}

export function listCapEx(companyId: string, opts?: { approval_status?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.approval_status) { where += ' AND approval_status = ?'; params.push(opts.approval_status); }
  return dbi.prepare(`SELECT * FROM capex_plans WHERE ${where} ORDER BY requested_date DESC`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// Batch I: Financial Statements + Analysis (F256-F260)
// ════════════════════════════════════════════════════════════════

// F256 — financial statement configs
export function upsertStatementConfig(c: any): any {
  const dbi = db.getDb();
  const id = c.id || uuid();
  if (c.id) {
    dbi.prepare(`UPDATE financial_statement_configs SET config_name = ?, statement_type = ?, periods_json = ?, display_options_json = ?, show_percent_change = ?, show_common_size = ?, is_default = ?, updated_at = ? WHERE id = ?`)
      .run(c.config_name, c.statement_type || 'balance_sheet', JSON.stringify(c.periods || []), JSON.stringify(c.display_options || {}), c.show_percent_change ? 1 : 0, c.show_common_size ? 1 : 0, c.is_default ? 1 : 0, now(), c.id);
  } else {
    dbi.prepare(`INSERT INTO financial_statement_configs (id, company_id, config_name, statement_type, periods_json, display_options_json, show_percent_change, show_common_size, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, c.company_id, c.config_name, c.statement_type || 'balance_sheet', JSON.stringify(c.periods || []), JSON.stringify(c.display_options || {}), c.show_percent_change ? 1 : 0, c.show_common_size ? 1 : 0, c.is_default ? 1 : 0, now(), now());
  }
  return { id };
}

export function listStatementConfigs(companyId: string, statementType?: string): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (statementType) { where += ' AND statement_type = ?'; params.push(statementType); }
  return dbi.prepare(`SELECT * FROM financial_statement_configs WHERE ${where} ORDER BY is_default DESC, config_name`).all(...params) as any[];
}

// F257 — common-size helper
export function commonSizeStatement(lines: Array<{ account_id: string; amount: number; account_type?: string }>, baseAmount: number): Array<{ account_id: string; amount: number; percent_of_base: number }> {
  if (baseAmount === 0) return lines.map(l => ({ ...l, percent_of_base: 0 }));
  return lines.map(l => ({ ...l, percent_of_base: round2((l.amount / baseAmount) * 100) }));
}

// F258 — financial ratios
export function calculateRatios(companyId: string, asOfDate: string): any {
  const dbi = db.getDb();
  const accountBal = (type: string): number => {
    const r = dbi.prepare(`SELECT COALESCE(SUM(jel.debit - jel.credit), 0) AS bal FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id JOIN accounts a ON a.id = jel.account_id WHERE je.company_id = ? AND je.is_posted = 1 AND je.entry_date <= ? AND a.account_type = ?`).get(companyId, asOfDate, type) as any;
    return Math.abs(r?.bal || 0);
  };
  const currentAssets = accountBal('current_asset');
  const currentLiabilities = accountBal('current_liability');
  const totalAssets = accountBal('asset') + currentAssets + accountBal('fixed_asset') + accountBal('other_asset');
  const totalLiabilities = currentLiabilities + accountBal('long_term_liability') + accountBal('other_liability');
  const equity = accountBal('equity');
  const revenue = accountBal('revenue');
  const cogs = accountBal('cost_of_sales');
  const grossProfit = revenue - cogs;
  const operatingExpenses = accountBal('expense');
  const operatingIncome = grossProfit - operatingExpenses;
  const netIncome = operatingIncome; // simplified

  const current = currentLiabilities ? round2(currentAssets / currentLiabilities) : 0;
  const debtToEquity = equity ? round2(totalLiabilities / equity) : 0;
  const debtToAssets = totalAssets ? round2(totalLiabilities / totalAssets) : 0;
  const grossMargin = revenue ? round2((grossProfit / revenue) * 100) : 0;
  const operatingMargin = revenue ? round2((operatingIncome / revenue) * 100) : 0;
  const netMargin = revenue ? round2((netIncome / revenue) * 100) : 0;
  const roa = totalAssets ? round2((netIncome / totalAssets) * 100) : 0;
  const roe = equity ? round2((netIncome / equity) * 100) : 0;
  const workingCapital = round2(currentAssets - currentLiabilities);

  const id = uuid();
  dbi.prepare(`INSERT INTO financial_ratios (id, company_id, as_of_date, current_ratio, quick_ratio, debt_to_equity, debt_to_assets, gross_margin, operating_margin, net_margin, return_on_assets, return_on_equity, working_capital, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(company_id, as_of_date) DO UPDATE SET current_ratio = excluded.current_ratio, debt_to_equity = excluded.debt_to_equity, gross_margin = excluded.gross_margin, operating_margin = excluded.operating_margin, net_margin = excluded.net_margin, return_on_assets = excluded.return_on_assets, return_on_equity = excluded.return_on_equity, working_capital = excluded.working_capital`)
    .run(id, companyId, asOfDate, current, current, debtToEquity, debtToAssets, grossMargin, operatingMargin, netMargin, roa, roe, workingCapital, now());
  return { id, current_ratio: current, debt_to_equity: debtToEquity, debt_to_assets: debtToAssets, gross_margin: grossMargin, operating_margin: operatingMargin, net_margin: netMargin, return_on_assets: roa, return_on_equity: roe, working_capital: workingCapital };
}

export function listRatios(companyId: string, limit: number = 24): any[] {
  return db.getDb().prepare(`SELECT * FROM financial_ratios WHERE company_id = ? ORDER BY as_of_date DESC LIMIT ?`).all(companyId, Math.min(limit, 240)) as any[];
}

// F259 — KPI scorecard
export function upsertKPI(k: any): any {
  const dbi = db.getDb();
  const id = k.id || uuid();
  if (k.id) {
    dbi.prepare(`UPDATE kpi_scorecard SET kpi_name = ?, metric_type = ?, current_value = ?, target_value = ?, threshold_red = ?, threshold_green = ?, direction = ?, last_calculated_at = ?, calculation_method = ?, sort_order = ?, is_active = ?, updated_at = ? WHERE id = ?`)
      .run(k.kpi_name, k.metric_type || null, k.current_value || 0, k.target_value || 0, k.threshold_red || null, k.threshold_green || null, k.direction || 'higher_better', now(), k.calculation_method || null, k.sort_order || 0, k.is_active === false ? 0 : 1, now(), k.id);
  } else {
    dbi.prepare(`INSERT INTO kpi_scorecard (id, company_id, kpi_name, metric_type, current_value, target_value, threshold_red, threshold_green, direction, last_calculated_at, calculation_method, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, k.company_id, k.kpi_name, k.metric_type || null, k.current_value || 0, k.target_value || 0, k.threshold_red || null, k.threshold_green || null, k.direction || 'higher_better', now(), k.calculation_method || null, k.sort_order || 0, k.is_active === false ? 0 : 1, now(), now());
  }
  return { id };
}

export function listKPIs(companyId: string): Array<any & { status: 'red' | 'amber' | 'green' }> {
  const rows = db.getDb().prepare(`SELECT * FROM kpi_scorecard WHERE company_id = ? AND is_active = 1 ORDER BY sort_order, kpi_name`).all(companyId) as any[];
  return rows.map((k: any) => {
    let status: 'red' | 'amber' | 'green' = 'amber';
    if (k.direction === 'higher_better') {
      if (k.threshold_red !== null && k.current_value <= k.threshold_red) status = 'red';
      else if (k.threshold_green !== null && k.current_value >= k.threshold_green) status = 'green';
    } else {
      if (k.threshold_red !== null && k.current_value >= k.threshold_red) status = 'red';
      else if (k.threshold_green !== null && k.current_value <= k.threshold_green) status = 'green';
    }
    return { ...k, status };
  });
}

// F260 — statement footnotes
export function upsertFootnote(f: any): any {
  const dbi = db.getDb();
  const id = f.id || uuid();
  if (f.id) {
    dbi.prepare(`UPDATE statement_footnotes SET title = ?, content = ?, footnote_number = ?, sort_order = ?, is_published = ?, updated_at = ? WHERE id = ?`)
      .run(f.title || null, f.content, f.footnote_number || 1, f.sort_order || 0, f.is_published ? 1 : 0, now(), f.id);
  } else {
    dbi.prepare(`INSERT INTO statement_footnotes (id, company_id, fiscal_year, statement_type, footnote_number, title, content, sort_order, is_published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, f.company_id, f.fiscal_year || null, f.statement_type || null, f.footnote_number || 1, f.title || null, f.content, f.sort_order || 0, f.is_published ? 1 : 0, now(), now());
  }
  return { id };
}

export function listFootnotes(companyId: string, opts?: { fiscal_year?: number; statement_type?: string; published_only?: boolean }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.fiscal_year) { where += ' AND fiscal_year = ?'; params.push(opts.fiscal_year); }
  if (opts?.statement_type) { where += ' AND statement_type = ?'; params.push(opts.statement_type); }
  if (opts?.published_only) where += ' AND is_published = 1';
  return dbi.prepare(`SELECT * FROM statement_footnotes WHERE ${where} ORDER BY footnote_number, sort_order`).all(...params) as any[];
}
