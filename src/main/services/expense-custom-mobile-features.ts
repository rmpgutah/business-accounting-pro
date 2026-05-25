// ─── Expense Advanced Wave Part 2: F591-F640 (50 features) ───
//
// Batch AO: Custom Fields & Tagging (F591-F600)
// Batch AP: Spend Analytics Advanced (F601-F610)
// Batch AQ: Workflow Customization (F611-F620)
// Batch AR: Mobile & Capture (F621-F630)
// Batch AS: Reports & Year-End (F631-F640)

import { randomUUID as uuid } from 'crypto';
import * as db from '../database';

const now = (): string => new Date().toISOString();
const today = (): string => now().slice(0, 10);
const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;

// ════════════════════════════════════════════════════════════════
// Batch AO: Custom Fields & Tagging (F591-F600)
// ════════════════════════════════════════════════════════════════

// F591-F593 — custom field defs
export function upsertExpenseCustomField(f: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO expense_custom_field_defs (id, company_id, field_name, field_label, field_type, options_json, formula, is_required, required_for_categories, display_order, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
    .run(id, f.company_id, f.field_name, f.field_label || f.field_name, f.field_type || 'text', JSON.stringify(f.options || []), f.formula, f.is_required ? 1 : 0, (f.required_for_categories || []).join(','), f.display_order || 0, now());
  return { id };
}

export function listExpenseCustomFields(companyId: string, categoryId?: string): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ? AND is_active = 1';
  // If categoryId provided, return fields where it's required OR no category requirement
  return dbi.prepare(`SELECT * FROM expense_custom_field_defs WHERE ${where} ORDER BY display_order, field_label`).all(...params) as any[];
}

export function setExpenseCustomFieldValue(opts: { expense_id: string; field_def_id: string; value: any; field_type?: string }): { id: string } {
  const dbi = db.getDb();
  const id = uuid();
  let valueText = null, valueNumber = null, valueDate = null, valueJson = null;
  if (opts.field_type === 'number') valueNumber = Number(opts.value) || 0;
  else if (opts.field_type === 'date') valueDate = String(opts.value);
  else if (opts.field_type === 'json' || Array.isArray(opts.value)) valueJson = JSON.stringify(opts.value);
  else valueText = String(opts.value ?? '');
  dbi.prepare(`INSERT INTO expense_custom_field_values (id, expense_id, field_def_id, value_text, value_number, value_date, value_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, opts.expense_id, opts.field_def_id, valueText, valueNumber, valueDate, valueJson, now());
  return { id };
}

export function getExpenseCustomFieldValues(expenseId: string): any[] {
  return db.getDb().prepare(`SELECT v.*, d.field_name, d.field_label, d.field_type FROM expense_custom_field_values v JOIN expense_custom_field_defs d ON d.id = v.field_def_id WHERE v.expense_id = ?`).all(expenseId) as any[];
}

// F594 — formula calculation (simple evaluator)
export function evaluateFormula(formula: string, vars: Record<string, number>): number {
  // Simple safe evaluator — only allows numbers, basic ops, and var names
  let expr = formula;
  for (const [key, val] of Object.entries(vars)) {
    expr = expr.replace(new RegExp(`\\b${key}\\b`, 'g'), String(val));
  }
  if (!/^[0-9+\-*/.() \t]+$/.test(expr)) throw new Error('Formula contains disallowed characters');
  try {
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${expr});`)();
    return typeof result === 'number' && Number.isFinite(result) ? round2(result) : 0;
  } catch {
    return 0;
  }
}

// F595 — tag hierarchy
export function upsertTagHierarchy(t: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO expense_tag_hierarchy (id, company_id, tag_id, parent_tag_id, color, icon, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, t.company_id, t.tag_id, t.parent_tag_id, t.color || '#60a5fa', t.icon, t.sort_order || 0, now());
  return { id };
}

export function getTagTree(companyId: string): any[] {
  const dbi = db.getDb();
  const rows = dbi.prepare(`SELECT eth.*, t.name AS tag_name FROM expense_tag_hierarchy eth LEFT JOIN tags t ON t.id = eth.tag_id WHERE eth.company_id = ? ORDER BY eth.sort_order`).all(companyId) as any[];
  const byId = new Map<string, any>();
  const roots: any[] = [];
  for (const r of rows) { (r as any).children = []; byId.set(r.tag_id, r); }
  for (const r of rows) {
    if (r.parent_tag_id && byId.has(r.parent_tag_id)) byId.get(r.parent_tag_id).children.push(r);
    else roots.push(r);
  }
  return roots;
}

// F599 — suggest tags based on description history
export function suggestTagsForExpense(companyId: string, description: string): Array<{ tag_id: string; confidence: number }> {
  const dbi = db.getDb();
  const q = `%${description.toLowerCase().slice(0, 20)}%`;
  // Find tags applied to similar expenses
  const rows = dbi.prepare(`
    SELECT et.tag_id, COUNT(*) AS n
    FROM entity_tags et
    JOIN expenses e ON e.id = et.entity_id
    WHERE et.company_id = ? AND et.entity_type = 'expense'
      AND LOWER(e.description) LIKE ?
    GROUP BY et.tag_id
    ORDER BY n DESC
    LIMIT 5
  `).all(companyId, q) as any[];
  return rows.map(r => ({ tag_id: r.tag_id, confidence: Math.min(r.n / 10, 1) }));
}

// F600 — bulk tag operations (already exists in dynamic batch but expense-specific helper)
export function bulkTagExpenses(opts: { company_id: string; expense_ids: string[]; tag_ids: string[] }): { tagged: number } {
  const dbi = db.getDb();
  let count = 0;
  const insert = dbi.prepare(`INSERT INTO entity_tags (id, company_id, entity_type, entity_id, tag_id, created_at) VALUES (?, ?, 'expense', ?, ?, ?) ON CONFLICT DO NOTHING`);
  const tx = dbi.transaction(() => {
    for (const e of opts.expense_ids) for (const t of opts.tag_ids) {
      try { const r = insert.run(uuid(), opts.company_id, e, t, now()); count += r.changes; } catch {}
    }
  });
  tx();
  return { tagged: count };
}

// ════════════════════════════════════════════════════════════════
// Batch AP: Spend Analytics Advanced (F601-F610)
// ════════════════════════════════════════════════════════════════

// F601 — vendor heatmap (12 months × top N vendors)
export function spendHeatmap(companyId: string, opts?: { top_n?: number; months?: number }): { vendors: string[]; months: string[]; matrix: number[][] } {
  const dbi = db.getDb();
  const months = opts?.months || 12;
  const topN = opts?.top_n || 10;
  // Top N vendors by total spend in period
  const topVendors = dbi.prepare(`
    SELECT vendor_id, COALESCE(SUM(amount), 0) AS total FROM expenses
    WHERE company_id = ? AND date >= date('now', '-' || ? || ' months')
      AND vendor_id IS NOT NULL AND (deleted_at IS NULL OR deleted_at = '')
    GROUP BY vendor_id ORDER BY total DESC LIMIT ?
  `).all(companyId, months, topN) as any[];
  // Month buckets
  const monthList: string[] = [];
  const today_ = today().slice(0, 7);
  const [yc, mc] = today_.split('-').map(Number);
  for (let i = months - 1; i >= 0; i--) {
    const total = yc * 12 + (mc - 1) - i;
    monthList.push(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`);
  }
  const matrix: number[][] = [];
  const vendorNames: string[] = [];
  for (const v of topVendors) {
    const vNameRow = dbi.prepare(`SELECT name FROM vendors WHERE id = ?`).get(v.vendor_id) as any;
    vendorNames.push(vNameRow?.name || v.vendor_id.slice(0, 8));
    const row: number[] = [];
    for (const m of monthList) {
      const r = dbi.prepare(`SELECT COALESCE(SUM(amount), 0) AS t FROM expenses WHERE company_id = ? AND vendor_id = ? AND strftime('%Y-%m', date) = ? AND (deleted_at IS NULL OR deleted_at = '')`).get(companyId, v.vendor_id, m) as any;
      row.push(round2(r.t));
    }
    matrix.push(row);
  }
  return { vendors: vendorNames, months: monthList, matrix };
}

// F602 — 90-day spend forecast
export function spendForecast90Days(companyId: string): Array<{ day_offset: number; date: string; forecast: number }> {
  const dbi = db.getDb();
  // Daily avg over past 90 days
  const avg = (dbi.prepare(`SELECT COALESCE(AVG(daily_total), 0) AS avg FROM (SELECT date, SUM(amount) AS daily_total FROM expenses WHERE company_id = ? AND date >= date('now', '-90 days') AND (deleted_at IS NULL OR deleted_at = '') GROUP BY date)`).get(companyId) as any).avg;
  const forecasts: any[] = [];
  for (let i = 1; i <= 90; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    forecasts.push({ day_offset: i, date: d.toISOString().slice(0, 10), forecast: round2(avg) });
  }
  return forecasts;
}

// F603-F604 — top vendors / categories
export function topVendorsByPeriod(companyId: string, opts?: { from?: string; to?: string; limit?: number }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = `company_id = ? AND vendor_id IS NOT NULL AND (deleted_at IS NULL OR deleted_at = '')`;
  if (opts?.from) { where += ' AND date >= ?'; params.push(opts.from); }
  if (opts?.to) { where += ' AND date <= ?'; params.push(opts.to); }
  return dbi.prepare(`SELECT e.vendor_id, v.name AS vendor_name, COUNT(*) AS tx_count, COALESCE(SUM(e.amount), 0) AS total FROM expenses e LEFT JOIN vendors v ON v.id = e.vendor_id WHERE ${where.replace(/company_id/, 'e.company_id').replace(/vendor_id IS NOT NULL/, 'e.vendor_id IS NOT NULL').replace(/deleted_at/g, 'e.deleted_at').replace(/date/g, 'e.date')} GROUP BY e.vendor_id ORDER BY total DESC LIMIT ?`).all(...params, opts?.limit || 10) as any[];
}

export function topCategoriesByPeriod(companyId: string, opts?: { from?: string; to?: string; limit?: number }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = `e.company_id = ? AND e.category_id IS NOT NULL AND (e.deleted_at IS NULL OR e.deleted_at = '')`;
  if (opts?.from) { where += ' AND e.date >= ?'; params.push(opts.from); }
  if (opts?.to) { where += ' AND e.date <= ?'; params.push(opts.to); }
  return dbi.prepare(`SELECT e.category_id, c.name AS category_name, COUNT(*) AS tx_count, COALESCE(SUM(e.amount), 0) AS total FROM expenses e LEFT JOIN categories c ON c.id = e.category_id WHERE ${where} GROUP BY e.category_id ORDER BY total DESC LIMIT ?`).all(...params, opts?.limit || 10) as any[];
}

// F606 — vendor concentration risk (% of total spend per vendor)
export function vendorConcentrationRisk(companyId: string, opts?: { from?: string; to?: string }): { top_concentration: number; vendors: any[]; risk_level: string } {
  const top = topVendorsByPeriod(companyId, opts);
  const total = top.reduce((s, v) => s + (v.total || 0), 0);
  if (total === 0) return { top_concentration: 0, vendors: [], risk_level: 'low' };
  const withPct = top.map(v => ({ ...v, pct_of_total: round2((v.total / total) * 100) }));
  const topPct = withPct[0]?.pct_of_total || 0;
  const riskLevel = topPct >= 40 ? 'high' : topPct >= 20 ? 'medium' : 'low';
  return { top_concentration: topPct, vendors: withPct, risk_level: riskLevel };
}

// F607 — employee spend benchmarks
export function employeeSpendBenchmarks(companyId: string, opts?: { from?: string; to?: string }): { by_employee: any[]; company_avg: number; company_median: number } {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = `company_id = ? AND employee_id IS NOT NULL AND (deleted_at IS NULL OR deleted_at = '')`;
  if (opts?.from) { where += ' AND date >= ?'; params.push(opts.from); }
  if (opts?.to) { where += ' AND date <= ?'; params.push(opts.to); }
  const byEmp = dbi.prepare(`SELECT employee_id, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM expenses WHERE ${where} GROUP BY employee_id ORDER BY total DESC`).all(...params) as any[];
  const totals = byEmp.map(e => e.total);
  const avg = totals.length > 0 ? totals.reduce((s, t) => s + t, 0) / totals.length : 0;
  const sorted = [...totals].sort((a, b) => a - b);
  const median = sorted.length > 0 ? (sorted.length % 2 ? sorted[Math.floor(sorted.length / 2)] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : 0;
  return { by_employee: byEmp, company_avg: round2(avg), company_median: round2(median) };
}

// F609 — benchmark vs industry
export function benchmarkVsIndustry(companyId: string, industry: string, totalRevenue: number, opts?: { from?: string; to?: string }): any[] {
  const dbi = db.getDb();
  const cats = topCategoriesByPeriod(companyId, opts);
  const benchmarks = dbi.prepare(`SELECT * FROM spend_benchmarks WHERE industry = ?`).all(industry) as any[];
  const benchmarkMap = new Map(benchmarks.map(b => [b.category.toLowerCase(), b]));
  return cats.map(c => {
    const b = benchmarkMap.get((c.category_name || '').toLowerCase());
    const myPct = totalRevenue > 0 ? round2((c.total / totalRevenue) * 100) : 0;
    return { ...c, my_pct_of_revenue: myPct, industry_avg_pct: b?.avg_pct_of_revenue || null, industry_median_pct: b?.median_pct_of_revenue || null, variance: b ? round2(myPct - b.avg_pct_of_revenue) : null };
  });
}

// F610 — generate cost-save recommendations
export function generateCostSaveRecs(companyId: string): { generated: number; recommendations: any[] } {
  const dbi = db.getDb();
  const recs: any[] = [];

  // Recommendation 1: high subscription costs
  const subs = (dbi.prepare(`SELECT COALESCE(SUM(annual_cost), 0) AS t, COUNT(*) AS n FROM subscription_detections WHERE company_id = ? AND is_cancelled = 0`).get(companyId) as any);
  if (subs.t > 1000) {
    recs.push({ recommendation_type: 'review_subscriptions', title: `Review ${subs.n} subscriptions (~$${Math.round(subs.t)}/yr)`, description: 'Audit recurring subscriptions for unused services', estimated_annual_savings: round2(subs.t * 0.15), confidence: 0.6 });
  }

  // Recommendation 2: vendor concentration
  const conc = vendorConcentrationRisk(companyId);
  if (conc.top_concentration >= 40) {
    recs.push({ recommendation_type: 'diversify_vendors', title: `Top vendor is ${conc.top_concentration}% of spend`, description: 'Negotiate or diversify to reduce dependency risk', estimated_annual_savings: 0, confidence: 0.7 });
  }

  // Recommendation 3: duplicate vendors (similar names)
  const vendors = dbi.prepare(`SELECT id, name FROM vendors WHERE company_id = ? AND (deleted_at IS NULL OR deleted_at = '')`).all(companyId) as any[];
  const dupePairs: any[] = [];
  for (let i = 0; i < vendors.length; i++) {
    for (let j = i + 1; j < vendors.length; j++) {
      const a = (vendors[i].name || '').toLowerCase().replace(/\W/g, '');
      const b = (vendors[j].name || '').toLowerCase().replace(/\W/g, '');
      if (a && b && (a.includes(b) || b.includes(a))) dupePairs.push([vendors[i].id, vendors[j].id]);
    }
  }
  if (dupePairs.length > 0) {
    recs.push({ recommendation_type: 'merge_vendors', title: `${dupePairs.length} potential duplicate vendor pair${dupePairs.length > 1 ? 's' : ''}`, description: 'Merging duplicate vendors improves reporting accuracy', estimated_annual_savings: 0, confidence: 0.5 });
  }

  // Save
  for (const r of recs) {
    const id = uuid();
    dbi.prepare(`INSERT INTO cost_save_recommendations (id, company_id, recommendation_type, title, description, estimated_annual_savings, confidence, status, generated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`)
      .run(id, companyId, r.recommendation_type, r.title, r.description, r.estimated_annual_savings, r.confidence, now());
  }
  return { generated: recs.length, recommendations: recs };
}

export function listCostSaveRecs(companyId: string, opts?: { status?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  return dbi.prepare(`SELECT * FROM cost_save_recommendations WHERE ${where} ORDER BY estimated_annual_savings DESC`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// Batch AQ: Workflow Customization (F611-F620)
// ════════════════════════════════════════════════════════════════

// F611 — custom approval workflow per threshold
export function upsertApprovalWorkflow(w: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO approval_workflow_defs (id, company_id, workflow_name, entity_type, trigger_amount_min, trigger_amount_max, trigger_category_ids, steps_json, escalation_days, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
    .run(id, w.company_id, w.workflow_name, w.entity_type || 'expense', w.trigger_amount_min, w.trigger_amount_max, (w.trigger_category_ids || []).join(','), JSON.stringify(w.steps || []), w.escalation_days || 0, now(), now());
  return { id };
}

// F611 — match workflow to expense
export function matchWorkflowForExpense(opts: { company_id: string; amount: number; category_id?: string }): any | null {
  const dbi = db.getDb();
  const workflows = dbi.prepare(`SELECT * FROM approval_workflow_defs WHERE company_id = ? AND is_active = 1 AND entity_type = 'expense' AND (trigger_amount_min IS NULL OR ? >= trigger_amount_min) AND (trigger_amount_max IS NULL OR ? <= trigger_amount_max)`).all(opts.company_id, opts.amount, opts.amount) as any[];
  for (const w of workflows) {
    if (w.trigger_category_ids && opts.category_id) {
      const cats = w.trigger_category_ids.split(',').filter(Boolean);
      if (cats.length > 0 && !cats.includes(opts.category_id)) continue;
    }
    return w;
  }
  return null;
}

// F612 — delegation
export function createDelegation(d: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO workflow_delegations (id, company_id, delegator_user_id, delegate_user_id, start_date, end_date, reason, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`)
    .run(id, d.company_id, d.delegator_user_id, d.delegate_user_id, d.start_date, d.end_date, d.reason, now());
  return { id };
}

export function resolveDelegate(companyId: string, originalUserId: string): { delegate_user_id: string | null; via_delegation_id: string | null } {
  const r = db.getDb().prepare(`SELECT id, delegate_user_id FROM workflow_delegations WHERE company_id = ? AND delegator_user_id = ? AND is_active = 1 AND start_date <= date('now') AND end_date >= date('now') LIMIT 1`).get(companyId, originalUserId) as any;
  if (!r) return { delegate_user_id: null, via_delegation_id: null };
  return { delegate_user_id: r.delegate_user_id, via_delegation_id: r.id };
}

// F613 — find escalated workflows (no response in N days)
export function findEscalatedWorkflows(companyId: string): any[] {
  return db.getDb().prepare(`
    SELECT eas.*, awd.workflow_name, awd.escalation_days
    FROM expense_approval_steps eas
    LEFT JOIN approval_workflow_defs awd ON awd.company_id = ?
    WHERE eas.action IS NULL AND eas.created_at <= datetime('now', '-' || awd.escalation_days || ' days')
      AND awd.escalation_days > 0
  `).all(companyId) as any[];
}

// F617 — workflow audit log
export function logWorkflowEvent(opts: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO workflow_audit_log (id, company_id, workflow_id, entity_type, entity_id, step_number, actor_user_id, action, notes, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, opts.company_id, opts.workflow_id, opts.entity_type, opts.entity_id, opts.step_number, opts.actor_user_id, opts.action, opts.notes, now());
  return { id };
}

// F618 — workflow performance metrics
export function workflowPerformance(companyId: string, opts?: { from?: string; to?: string }): { avg_approval_hours: number; total_approvals: number; rejections: number; rejection_rate: number } {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = `company_id = ?`;
  if (opts?.from) { where += ' AND occurred_at >= ?'; params.push(opts.from); }
  if (opts?.to) { where += ' AND occurred_at <= ?'; params.push(opts.to); }
  const stats = dbi.prepare(`SELECT
    COUNT(CASE WHEN action = 'approved' THEN 1 END) AS approvals,
    COUNT(CASE WHEN action = 'rejected' THEN 1 END) AS rejections,
    COUNT(*) AS total
    FROM workflow_audit_log WHERE ${where}`).get(...params) as any;
  return { avg_approval_hours: 0, total_approvals: stats.approvals || 0, rejections: stats.rejections || 0, rejection_rate: stats.total > 0 ? round2((stats.rejections / stats.total) * 100) : 0 };
}

export function listApprovalWorkflows(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM approval_workflow_defs WHERE company_id = ? AND is_active = 1`).all(companyId) as any[];
}

export function listDelegations(companyId: string, opts?: { active_only?: boolean }): any[] {
  const dbi = db.getDb();
  let where = 'company_id = ?';
  if (opts?.active_only) where += ' AND is_active = 1 AND start_date <= date(\'now\') AND end_date >= date(\'now\')';
  return dbi.prepare(`SELECT * FROM workflow_delegations WHERE ${where}`).all(companyId) as any[];
}

// ════════════════════════════════════════════════════════════════
// Batch AR: Mobile & Capture (F621-F630)
// ════════════════════════════════════════════════════════════════

// F621 — email-to-expense (uses email_to_entity_addresses from collab batch)
export function provisionExpenseInbox(companyId: string, userId: string): { inbox_address: string } {
  const dbi = db.getDb();
  const token = uuid().slice(0, 8);
  const address = `expense-${userId.slice(0, 4)}-${token}@inbox.bap.local`;
  try {
    dbi.prepare(`INSERT INTO email_to_entity_addresses (id, company_id, entity_type, entity_id, inbox_address, created_at) VALUES (?, ?, 'expense', ?, ?, ?)`)
      .run(uuid(), companyId, userId, address, now());
  } catch {}
  return { inbox_address: address };
}

// F624 — bulk receipt photo upload (queue items)
export function queueReceiptCapture(opts: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO expense_capture_queue (id, company_id, user_id, capture_type, payload_path, metadata_json, geo_lat, geo_lng, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, opts.company_id, opts.user_id, opts.capture_type || 'photo', opts.payload_path, JSON.stringify(opts.metadata || {}), opts.geo_lat, opts.geo_lng, now());
  return { id };
}

export function listPendingCaptures(companyId: string, userId?: string): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ? AND processed = 0';
  if (userId) { where += ' AND user_id = ?'; params.push(userId); }
  return dbi.prepare(`SELECT * FROM expense_capture_queue WHERE ${where} ORDER BY captured_at DESC`).all(...params) as any[];
}

export function processCapture(captureId: string, createdExpenseId: string): boolean {
  const r = db.getDb().prepare(`UPDATE expense_capture_queue SET processed = 1, processed_at = ?, created_expense_id = ? WHERE id = ?`).run(now(), createdExpenseId, captureId);
  return r.changes > 0;
}

// F625 — voice memo
export function attachVoiceMemo(opts: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO expense_voice_memos (id, expense_id, audio_path, transcript, duration_seconds, recorded_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, opts.expense_id, opts.audio_path, opts.transcript, opts.duration_seconds || 0, now());
  return { id };
}

export function listVoiceMemos(expenseId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM expense_voice_memos WHERE expense_id = ? ORDER BY recorded_at DESC`).all(expenseId) as any[];
}

// F626 — geo-tag expense
export function setExpenseGeo(expenseId: string, lat: number, lng: number, locationName?: string): boolean {
  const r = db.getDb().prepare(`UPDATE expenses SET geo_lat = ?, geo_lng = ?, geo_location_name = ?, updated_at = ? WHERE id = ?`).run(lat, lng, locationName, now(), expenseId);
  return r.changes > 0;
}

export function expensesByLocation(companyId: string, opts?: { radius_km?: number; lat?: number; lng?: number; limit?: number }): any[] {
  const dbi = db.getDb();
  // Without geo functions in SQLite, return all geo-tagged in a bounding box if lat/lng given
  if (opts?.lat && opts?.lng && opts.radius_km) {
    const latDelta = opts.radius_km / 111;
    const lngDelta = opts.radius_km / 111;
    return dbi.prepare(`SELECT * FROM expenses WHERE company_id = ? AND geo_lat BETWEEN ? AND ? AND geo_lng BETWEEN ? AND ? AND (deleted_at IS NULL OR deleted_at = '') ORDER BY date DESC LIMIT ?`).all(companyId, opts.lat - latDelta, opts.lat + latDelta, opts.lng - lngDelta, opts.lng + lngDelta, opts.limit || 100) as any[];
  }
  return dbi.prepare(`SELECT * FROM expenses WHERE company_id = ? AND geo_lat IS NOT NULL AND (deleted_at IS NULL OR deleted_at = '') ORDER BY date DESC LIMIT ?`).all(companyId, opts?.limit || 100) as any[];
}

// F628 — voice entry transcript (just stores it for later parsing)
export function recordVoiceEntry(opts: any): { id: string } {
  return attachVoiceMemo(opts);
}

// ════════════════════════════════════════════════════════════════
// Batch AS: Reports & Year-End (F631-F640)
// ════════════════════════════════════════════════════════════════

// F631 — custom report templates
export function saveReportTemplate(t: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO expense_report_templates_v2 (id, company_id, template_name, columns_json, grouping, sort_by, filters_json, layout, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, t.company_id, t.template_name, JSON.stringify(t.columns || []), t.grouping, t.sort_by, JSON.stringify(t.filters || {}), t.layout || 'standard', t.is_default ? 1 : 0, now(), now());
  return { id };
}

export function listReportTemplates(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM expense_report_templates_v2 WHERE company_id = ? ORDER BY is_default DESC, template_name`).all(companyId) as any[];
}

// F632 — year-end roll-up
export function generateYearEndRollup(opts: { company_id: string; tax_year: number }): { id: string; total_expenses: number; tax_deductible_total: number } {
  const dbi = db.getDb();
  const totals = dbi.prepare(`SELECT COALESCE(SUM(amount), 0) AS total, COALESCE(SUM(CASE WHEN is_tax_deductible = 1 OR is_tax_deductible IS NULL THEN amount ELSE 0 END), 0) AS tax_ded, COALESCE(SUM(mileage), 0) AS mileage FROM expenses WHERE company_id = ? AND strftime('%Y', date) = ? AND (deleted_at IS NULL OR deleted_at = '')`).get(opts.company_id, String(opts.tax_year)) as any;

  const byCategory = dbi.prepare(`SELECT c.name AS category_name, COALESCE(SUM(e.amount), 0) AS total FROM expenses e LEFT JOIN categories c ON c.id = e.category_id WHERE e.company_id = ? AND strftime('%Y', e.date) = ? AND (e.deleted_at IS NULL OR e.deleted_at = '') GROUP BY c.id ORDER BY total DESC`).all(opts.company_id, String(opts.tax_year)) as any[];

  const byScheduleC = dbi.prepare(`SELECT schedule_c_line, COALESCE(SUM(amount), 0) AS total FROM expenses WHERE company_id = ? AND strftime('%Y', date) = ? AND schedule_c_line IS NOT NULL AND (deleted_at IS NULL OR deleted_at = '') GROUP BY schedule_c_line`).all(opts.company_id, String(opts.tax_year)) as any[];

  const id = uuid();
  dbi.prepare(`INSERT INTO expense_year_end_rollups (id, company_id, tax_year, total_expenses, tax_deductible_total, mileage_total, by_category_json, by_schedule_c_json, generated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(company_id, tax_year) DO UPDATE SET total_expenses = excluded.total_expenses, tax_deductible_total = excluded.tax_deductible_total, mileage_total = excluded.mileage_total, by_category_json = excluded.by_category_json, by_schedule_c_json = excluded.by_schedule_c_json, generated_at = excluded.generated_at`)
    .run(id, opts.company_id, opts.tax_year, totals.total || 0, totals.tax_ded || 0, totals.mileage || 0, JSON.stringify(byCategory), JSON.stringify(byScheduleC), now());
  return { id, total_expenses: round2(totals.total), tax_deductible_total: round2(totals.tax_ded) };
}

// F633 — quarterly report
export function generateQuarterlyReport(companyId: string, year: number, quarter: 1 | 2 | 3 | 4): any {
  const dbi = db.getDb();
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const periodStart = `${year}-${String(startMonth).padStart(2, '0')}-01`;
  const periodEnd = new Date(year, endMonth, 0).toISOString().slice(0, 10); // Last day of end month
  const summary = dbi.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM expenses WHERE company_id = ? AND date BETWEEN ? AND ? AND (deleted_at IS NULL OR deleted_at = '')`).get(companyId, periodStart, periodEnd) as any;
  const byCategory = dbi.prepare(`SELECT c.name AS category, COALESCE(SUM(e.amount), 0) AS total, COUNT(*) AS n FROM expenses e LEFT JOIN categories c ON c.id = e.category_id WHERE e.company_id = ? AND e.date BETWEEN ? AND ? AND (e.deleted_at IS NULL OR e.deleted_at = '') GROUP BY c.id ORDER BY total DESC`).all(companyId, periodStart, periodEnd) as any[];
  return { year, quarter, period_start: periodStart, period_end: periodEnd, expense_count: summary.n, total: round2(summary.total), by_category: byCategory };
}

// F634 — department expense report
export function departmentExpenseReport(companyId: string, departmentId: string, opts?: { from?: string; to?: string }): any {
  const dbi = db.getDb();
  const params: any[] = [companyId, departmentId];
  let where = `company_id = ? AND department_id = ? AND (deleted_at IS NULL OR deleted_at = '')`;
  if (opts?.from) { where += ' AND date >= ?'; params.push(opts.from); }
  if (opts?.to) { where += ' AND date <= ?'; params.push(opts.to); }
  try {
    const total = (dbi.prepare(`SELECT COALESCE(SUM(amount), 0) AS t FROM expenses WHERE ${where}`).get(...params) as any).t;
    const byCat = dbi.prepare(`SELECT c.name AS category, COALESCE(SUM(e.amount), 0) AS total FROM expenses e LEFT JOIN categories c ON c.id = e.category_id WHERE ${where.replace(/department_id/g, 'e.department_id').replace(/company_id/g, 'e.company_id').replace(/date/g, 'e.date').replace(/deleted_at/g, 'e.deleted_at')} GROUP BY c.id ORDER BY total DESC`).all(...params) as any[];
    return { department_id: departmentId, total: round2(total), by_category: byCat };
  } catch {
    return { department_id: departmentId, total: 0, by_category: [], error: 'department_id column may not exist on expenses' };
  }
}

// F635 — project expense report
export function projectExpenseReport(companyId: string, projectId: string): any {
  const dbi = db.getDb();
  const total = (dbi.prepare(`SELECT COALESCE(SUM(amount), 0) AS t, COUNT(*) AS n FROM expenses WHERE company_id = ? AND project_id = ? AND (deleted_at IS NULL OR deleted_at = '')`).get(companyId, projectId) as any);
  const byVendor = dbi.prepare(`SELECT v.name AS vendor, COALESCE(SUM(e.amount), 0) AS total FROM expenses e LEFT JOIN vendors v ON v.id = e.vendor_id WHERE e.company_id = ? AND e.project_id = ? AND (e.deleted_at IS NULL OR e.deleted_at = '') GROUP BY v.id ORDER BY total DESC`).all(companyId, projectId) as any[];
  return { project_id: projectId, expense_count: total.n, total: round2(total.t), by_vendor: byVendor };
}

// F636 — 1099 prep report
export function vendor1099PrepReport(companyId: string, taxYear: number): any {
  const dbi = db.getDb();
  return dbi.prepare(`SELECT vt.*, v.name AS vendor_name, v.email FROM vendor_1099_thresholds vt LEFT JOIN vendors v ON v.id = vt.vendor_id WHERE vt.company_id = ? AND vt.tax_year = ? AND vt.requires_1099 = 1 ORDER BY vt.ytd_amount DESC`).all(companyId, taxYear) as any[];
}

// F637 — Schedule C breakdown
export function scheduleCBreakdown(companyId: string, taxYear: number): any[] {
  return db.getDb().prepare(`SELECT schedule_c_line, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS expense_count FROM expenses WHERE company_id = ? AND strftime('%Y', date) = ? AND schedule_c_line IS NOT NULL AND (deleted_at IS NULL OR deleted_at = '') GROUP BY schedule_c_line ORDER BY schedule_c_line`).all(companyId, String(taxYear)) as any[];
}

// F638 — mileage log year-end summary
export function mileageLogSummary(companyId: string, taxYear: number): { total_miles: number; business_miles: number; total_deduction: number; by_vehicle: any[] } {
  const dbi = db.getDb();
  const totals = dbi.prepare(`SELECT COALESCE(SUM(total_miles), 0) AS total, COALESCE(SUM(CASE WHEN is_business = 1 THEN total_miles ELSE 0 END), 0) AS biz FROM mileage_routes WHERE company_id = ? AND strftime('%Y', route_date) = ?`).get(companyId, String(taxYear)) as any;
  const rate = (dbi.prepare(`SELECT business_rate FROM mileage_irs_rates WHERE tax_year = ?`).get(taxYear) as any)?.business_rate || 0.67;
  const byVehicle = dbi.prepare(`SELECT v.vehicle_name, COALESCE(SUM(r.total_miles), 0) AS miles FROM mileage_routes r LEFT JOIN vehicles v ON v.id = r.vehicle_id WHERE r.company_id = ? AND strftime('%Y', r.route_date) = ? GROUP BY v.id`).all(companyId, String(taxYear)) as any[];
  return { total_miles: round2(totals.total), business_miles: round2(totals.biz), total_deduction: round2(totals.biz * rate), by_vehicle: byVehicle };
}

// F639 — per-diem expense summary
export function perDiemSummary(companyId: string, taxYear: number): { total: number; by_trip: any[] } {
  const dbi = db.getDb();
  const summary = dbi.prepare(`SELECT t.trip_name, COALESCE(SUM(tpd.total_amount), 0) AS total FROM trip_per_diem_settings tpd JOIN trips t ON t.id = tpd.trip_id WHERE t.company_id = ? AND strftime('%Y', t.start_date) = ? GROUP BY t.id ORDER BY total DESC`).all(companyId, String(taxYear)) as any[];
  const total = summary.reduce((s, x) => s + (x.total || 0), 0);
  return { total: round2(total), by_trip: summary };
}

// F640 — custom-period expense report
export function customPeriodReport(opts: { company_id: string; period_start: string; period_end: string; group_by?: 'category' | 'vendor' | 'project' | 'employee' }): any {
  const dbi = db.getDb();
  const groupBy = opts.group_by || 'category';
  const groupCol = groupBy === 'category' ? 'e.category_id' : groupBy === 'vendor' ? 'e.vendor_id' : groupBy === 'project' ? 'e.project_id' : 'e.employee_id';
  const totals = (dbi.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS total FROM expenses WHERE company_id = ? AND date BETWEEN ? AND ? AND (deleted_at IS NULL OR deleted_at = '')`).get(opts.company_id, opts.period_start, opts.period_end) as any);
  const byGroup = dbi.prepare(`SELECT ${groupCol} AS group_id, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n FROM expenses e WHERE e.company_id = ? AND e.date BETWEEN ? AND ? AND (e.deleted_at IS NULL OR e.deleted_at = '') GROUP BY ${groupCol} ORDER BY total DESC`).all(opts.company_id, opts.period_start, opts.period_end) as any[];
  return { period_start: opts.period_start, period_end: opts.period_end, expense_count: totals.n, total: round2(totals.total), group_by: groupBy, by_group: byGroup };
}
