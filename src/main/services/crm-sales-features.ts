// ─── Batch 9: CRM, Sales, Quotes (F131-F150) ───
//
// Sales pipeline + deal pipeline, deal activities, sales targets,
// performance snapshots, lead capture forms, scoring + routing rules,
// territories, commission plans/calcs, discount + promo + loyalty +
// referral systems, quote templates, quote→invoice conversion log,
// e-sign for quotes, RFP tracking, win/loss analysis.

import { randomUUID as uuid } from 'crypto';
import * as db from '../database';

const now = (): string => new Date().toISOString();
const today = (): string => now().slice(0, 10);

// ════════════════════════════════════════════════════════════════
// F131. Sales pipeline stages
// ════════════════════════════════════════════════════════════════
export function upsertStage(s: any): any {
  const dbi = db.getDb();
  const id = s.id || uuid();
  if (s.id) {
    dbi.prepare(`UPDATE sales_pipeline_stages SET stage_name = ?, sort_order = ?, probability_percent = ?, is_won = ?, is_lost = ?, color = ?, is_active = ?, updated_at = ? WHERE id = ?`)
      .run(s.stage_name, s.sort_order || 0, s.probability_percent || 0, s.is_won ? 1 : 0, s.is_lost ? 1 : 0, s.color || '#6366f1', s.is_active === false ? 0 : 1, now(), s.id);
  } else {
    dbi.prepare(`INSERT INTO sales_pipeline_stages (id, company_id, stage_name, sort_order, probability_percent, is_won, is_lost, color, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, s.company_id, s.stage_name, s.sort_order || 0, s.probability_percent || 0, s.is_won ? 1 : 0, s.is_lost ? 1 : 0, s.color || '#6366f1', s.is_active === false ? 0 : 1, now(), now());
  }
  return { id, ...s };
}

export function listStages(companyId: string, activeOnly: boolean = false): any[] {
  const dbi = db.getDb();
  let where = 'company_id = ?';
  if (activeOnly) where += ' AND is_active = 1';
  return dbi.prepare(`SELECT * FROM sales_pipeline_stages WHERE ${where} ORDER BY sort_order ASC`).all(companyId) as any[];
}

export function seedDefaultStages(companyId: string): { seeded: number } {
  const dbi = db.getDb();
  const existing = dbi.prepare(`SELECT COUNT(*) AS c FROM sales_pipeline_stages WHERE company_id = ?`).get(companyId) as any;
  if (existing.c > 0) return { seeded: 0 };
  const stages = [
    { name: 'Lead', prob: 10, won: 0, lost: 0, color: '#94a3b8' },
    { name: 'Qualified', prob: 25, won: 0, lost: 0, color: '#0ea5e9' },
    { name: 'Proposal', prob: 50, won: 0, lost: 0, color: '#8b5cf6' },
    { name: 'Negotiation', prob: 75, won: 0, lost: 0, color: '#f59e0b' },
    { name: 'Closed Won', prob: 100, won: 1, lost: 0, color: '#22c55e' },
    { name: 'Closed Lost', prob: 0, won: 0, lost: 1, color: '#ef4444' },
  ];
  const tx = dbi.transaction(() => {
    stages.forEach((s, i) => {
      dbi.prepare(`INSERT INTO sales_pipeline_stages (id, company_id, stage_name, sort_order, probability_percent, is_won, is_lost, color, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
        .run(uuid(), companyId, s.name, i, s.prob, s.won, s.lost, s.color, now(), now());
    });
  });
  tx();
  return { seeded: stages.length };
}

// ════════════════════════════════════════════════════════════════
// F132. Deals (opportunities)
// ════════════════════════════════════════════════════════════════
export function upsertDeal(d: any): any {
  const dbi = db.getDb();
  const id = d.id || uuid();
  // Compute weighted value
  const stageProb = d.stage_id ? (dbi.prepare(`SELECT probability_percent FROM sales_pipeline_stages WHERE id = ?`).get(d.stage_id) as any)?.probability_percent ?? 0 : (d.probability_percent || 0);
  const weighted = (d.estimated_value || 0) * (stageProb / 100);
  if (d.id) {
    dbi.prepare(`UPDATE deals SET deal_name = ?, client_id = ?, contact_name = ?, contact_email = ?, stage_id = ?, estimated_value = ?, estimated_close_date = ?, actual_close_date = ?, probability_percent = ?, weighted_value = ?, assigned_to = ?, source = ?, territory_id = ?, status = ?, won_reason = ?, lost_reason = ?, competitor = ?, notes = ?, updated_at = ? WHERE id = ?`)
      .run(d.deal_name, d.client_id || null, d.contact_name || null, d.contact_email || null, d.stage_id || null, d.estimated_value || 0, d.estimated_close_date || null, d.actual_close_date || null, stageProb, weighted, d.assigned_to || null, d.source || null, d.territory_id || null, d.status || 'open', d.won_reason || null, d.lost_reason || null, d.competitor || null, d.notes || null, now(), d.id);
  } else {
    dbi.prepare(`INSERT INTO deals (id, company_id, deal_name, client_id, contact_name, contact_email, stage_id, estimated_value, estimated_close_date, probability_percent, weighted_value, assigned_to, source, territory_id, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, d.company_id, d.deal_name, d.client_id || null, d.contact_name || null, d.contact_email || null, d.stage_id || null, d.estimated_value || 0, d.estimated_close_date || null, stageProb, weighted, d.assigned_to || null, d.source || null, d.territory_id || null, d.status || 'open', d.notes || null, now(), now());
  }
  return { id, weighted_value: weighted, ...d };
}

export function moveDealStage(dealId: string, stageId: string): { stage_id: string; weighted_value: number } {
  const dbi = db.getDb();
  const deal = dbi.prepare(`SELECT estimated_value FROM deals WHERE id = ?`).get(dealId) as any;
  const stage = dbi.prepare(`SELECT probability_percent, is_won, is_lost FROM sales_pipeline_stages WHERE id = ?`).get(stageId) as any;
  if (!deal || !stage) throw new Error('Deal or stage not found');
  const weighted = (deal.estimated_value || 0) * ((stage.probability_percent || 0) / 100);
  const status = stage.is_won ? 'won' : (stage.is_lost ? 'lost' : 'open');
  const closeDate = (stage.is_won || stage.is_lost) ? today() : null;
  dbi.prepare(`UPDATE deals SET stage_id = ?, probability_percent = ?, weighted_value = ?, status = ?, actual_close_date = COALESCE(?, actual_close_date), updated_at = ? WHERE id = ?`)
    .run(stageId, stage.probability_percent || 0, weighted, status, closeDate, now(), dealId);
  return { stage_id: stageId, weighted_value: weighted };
}

export function listDeals(companyId: string, opts?: { stage_id?: string; status?: string; assigned_to?: string; limit?: number }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.stage_id) { where += ' AND stage_id = ?'; params.push(opts.stage_id); }
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  if (opts?.assigned_to) { where += ' AND assigned_to = ?'; params.push(opts.assigned_to); }
  return dbi.prepare(`SELECT * FROM deals WHERE ${where} ORDER BY estimated_close_date ASC NULLS LAST LIMIT ${Math.min(opts?.limit || 200, 2000)}`).all(...params) as any[];
}

export function pipelineSummary(companyId: string): { stage_id: string; stage_name: string; deal_count: number; total_value: number; weighted_value: number }[] {
  const dbi = db.getDb();
  return dbi.prepare(`
    SELECT s.id AS stage_id, s.stage_name,
           COUNT(d.id) AS deal_count,
           COALESCE(SUM(d.estimated_value), 0) AS total_value,
           COALESCE(SUM(d.weighted_value), 0) AS weighted_value
      FROM sales_pipeline_stages s
      LEFT JOIN deals d ON d.stage_id = s.id AND d.status = 'open'
     WHERE s.company_id = ? AND s.is_active = 1
     GROUP BY s.id, s.stage_name, s.sort_order
     ORDER BY s.sort_order ASC
  `).all(companyId) as any[];
}

// ════════════════════════════════════════════════════════════════
// F133. Deal activities
// ════════════════════════════════════════════════════════════════
export function logActivity(a: any): any {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO deal_activities (id, company_id, deal_id, activity_type, activity_date, subject, description, duration_minutes, outcome, next_action, next_action_date, performed_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, a.company_id, a.deal_id, a.activity_type, a.activity_date || today(), a.subject || null, a.description || null, a.duration_minutes || 0, a.outcome || null, a.next_action || null, a.next_action_date || null, a.performed_by || null, now());
  return { id, ...a };
}

export function listActivities(dealId: string, limit: number = 100): any[] {
  return db.getDb().prepare(`SELECT * FROM deal_activities WHERE deal_id = ? ORDER BY activity_date DESC, created_at DESC LIMIT ?`).all(dealId, Math.min(limit, 1000)) as any[];
}

// ════════════════════════════════════════════════════════════════
// F134. Sales targets
// ════════════════════════════════════════════════════════════════
export function upsertTarget(t: any): any {
  const dbi = db.getDb();
  const id = t.id || uuid();
  if (t.id) {
    dbi.prepare(`UPDATE sales_targets SET rep_id = ?, target_period = ?, period_start = ?, period_end = ?, target_amount = ?, deal_count_target = ?, notes = ? WHERE id = ?`)
      .run(t.rep_id || null, t.target_period, t.period_start, t.period_end, t.target_amount || 0, t.deal_count_target || 0, t.notes || null, t.id);
  } else {
    dbi.prepare(`INSERT INTO sales_targets (id, company_id, rep_id, target_period, period_start, period_end, target_amount, deal_count_target, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, t.company_id, t.rep_id || null, t.target_period, t.period_start, t.period_end, t.target_amount || 0, t.deal_count_target || 0, t.notes || null, now());
  }
  return { id, ...t };
}

export function refreshTargetActuals(targetId: string): { actual_amount: number; actual_deal_count: number } {
  const dbi = db.getDb();
  const t = dbi.prepare(`SELECT * FROM sales_targets WHERE id = ?`).get(targetId) as any;
  if (!t) throw new Error('Target not found');
  const params: any[] = [t.company_id, t.period_start, t.period_end];
  let where = `company_id = ? AND actual_close_date BETWEEN ? AND ? AND status = 'won'`;
  if (t.rep_id) { where += ' AND assigned_to = ?'; params.push(t.rep_id); }
  const r = dbi.prepare(`SELECT COALESCE(SUM(estimated_value), 0) AS actual, COUNT(*) AS cnt FROM deals WHERE ${where}`).get(...params) as any;
  dbi.prepare(`UPDATE sales_targets SET actual_amount = ?, actual_deal_count = ? WHERE id = ?`).run(r.actual, r.cnt, targetId);
  return { actual_amount: r.actual, actual_deal_count: r.cnt };
}

export function listTargets(companyId: string, opts?: { rep_id?: string; period?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.rep_id) { where += ' AND rep_id = ?'; params.push(opts.rep_id); }
  if (opts?.period) { where += ' AND target_period = ?'; params.push(opts.period); }
  return dbi.prepare(`SELECT * FROM sales_targets WHERE ${where} ORDER BY period_start DESC`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// F135. Sales performance snapshots
// ════════════════════════════════════════════════════════════════
export function captureSalesPerformance(companyId: string, opts: { rep_id?: string; period_start: string; period_end: string }): any {
  const dbi = db.getDb();
  const params: any[] = [companyId, opts.period_start, opts.period_end];
  let where = `company_id = ? AND actual_close_date BETWEEN ? AND ?`;
  if (opts.rep_id) { where += ' AND assigned_to = ?'; params.push(opts.rep_id); }

  const stats = dbi.prepare(`
    SELECT
      SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) AS deals_won,
      SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) AS deals_lost,
      COALESCE(SUM(CASE WHEN status = 'won' THEN estimated_value ELSE 0 END), 0) AS revenue_won,
      COALESCE(AVG(CASE WHEN status = 'won' THEN estimated_value END), 0) AS avg_deal_size,
      COALESCE(AVG(CASE WHEN status = 'won' AND created_at IS NOT NULL AND actual_close_date IS NOT NULL THEN julianday(actual_close_date) - julianday(created_at) END), 0) AS avg_days_to_close
      FROM deals WHERE ${where}
  `).get(...params) as any;

  const pipelineParams: any[] = [companyId];
  let pipelineWhere = `company_id = ? AND status = 'open'`;
  if (opts.rep_id) { pipelineWhere += ' AND assigned_to = ?'; pipelineParams.push(opts.rep_id); }
  const pipeline = dbi.prepare(`SELECT COALESCE(SUM(weighted_value), 0) AS p FROM deals WHERE ${pipelineWhere}`).get(...pipelineParams) as any;

  const total = (stats.deals_won || 0) + (stats.deals_lost || 0);
  const winRate = total > 0 ? (stats.deals_won / total) * 100 : 0;

  const id = uuid();
  dbi.prepare(`INSERT INTO sales_performance_snapshots (id, company_id, snapshot_date, rep_id, period_start, period_end, deals_won, deals_lost, revenue_won, pipeline_value, average_deal_size, win_rate, avg_days_to_close, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, companyId, today(), opts.rep_id || null, opts.period_start, opts.period_end, stats.deals_won || 0, stats.deals_lost || 0, stats.revenue_won || 0, pipeline.p || 0, stats.avg_deal_size || 0, winRate, stats.avg_days_to_close || 0, now());
  return { id, deals_won: stats.deals_won, deals_lost: stats.deals_lost, revenue_won: stats.revenue_won, pipeline_value: pipeline.p, win_rate: winRate };
}

export function listPerformanceSnapshots(companyId: string, opts?: { rep_id?: string; limit?: number }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.rep_id) { where += ' AND rep_id = ?'; params.push(opts.rep_id); }
  return dbi.prepare(`SELECT * FROM sales_performance_snapshots WHERE ${where} ORDER BY snapshot_date DESC LIMIT ${Math.min(opts?.limit || 50, 500)}`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// F136. Lead forms
// ════════════════════════════════════════════════════════════════
export function upsertLeadForm(f: any): any {
  const dbi = db.getDb();
  const id = f.id || uuid();
  if (f.id) {
    dbi.prepare(`UPDATE lead_forms SET form_name = ?, fields_json = ?, is_active = ?, redirect_url = ?, success_message = ?, notify_emails = ?, updated_at = ? WHERE id = ?`)
      .run(f.form_name, JSON.stringify(f.fields || f.fields_json || []), f.is_active === false ? 0 : 1, f.redirect_url || null, f.success_message || null, f.notify_emails || null, now(), f.id);
  } else {
    dbi.prepare(`INSERT INTO lead_forms (id, company_id, form_name, fields_json, is_active, redirect_url, success_message, notify_emails, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, f.company_id, f.form_name, JSON.stringify(f.fields || []), f.is_active === false ? 0 : 1, f.redirect_url || null, f.success_message || null, f.notify_emails || null, now(), now());
  }
  return { id, ...f };
}

export function recordLeadSubmission(formId: string, data: Record<string, any>, ipAddress?: string): any {
  const dbi = db.getDb();
  const id = uuid();
  dbi.prepare(`INSERT INTO lead_form_submissions (id, form_id, submitted_at, data_json, ip_address) VALUES (?, ?, ?, ?, ?)`)
    .run(id, formId, now(), JSON.stringify(data), ipAddress || null);
  dbi.prepare(`UPDATE lead_forms SET submission_count = submission_count + 1 WHERE id = ?`).run(formId);
  return { id };
}

export function listLeadForms(companyId: string, activeOnly: boolean = false): any[] {
  const dbi = db.getDb();
  let where = 'company_id = ?';
  if (activeOnly) where += ' AND is_active = 1';
  return dbi.prepare(`SELECT * FROM lead_forms WHERE ${where} ORDER BY form_name ASC`).all(companyId) as any[];
}

export function getLeadSubmissions(formId: string, limit: number = 100): any[] {
  return db.getDb().prepare(`SELECT * FROM lead_form_submissions WHERE form_id = ? ORDER BY submitted_at DESC LIMIT ?`).all(formId, Math.min(limit, 1000)) as any[];
}

// ════════════════════════════════════════════════════════════════
// F137. Lead scoring rules
// ════════════════════════════════════════════════════════════════
export function upsertScoringRule(r: any): any {
  const dbi = db.getDb();
  const id = r.id || uuid();
  if (r.id) {
    dbi.prepare(`UPDATE lead_scoring_rules SET rule_name = ?, criteria_json = ?, score_value = ?, is_active = ?, updated_at = ? WHERE id = ?`)
      .run(r.rule_name, JSON.stringify(r.criteria || r.criteria_json || {}), r.score_value || 0, r.is_active === false ? 0 : 1, now(), r.id);
  } else {
    dbi.prepare(`INSERT INTO lead_scoring_rules (id, company_id, rule_name, criteria_json, score_value, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, r.company_id, r.rule_name, JSON.stringify(r.criteria || {}), r.score_value || 0, r.is_active === false ? 0 : 1, now(), now());
  }
  return { id, ...r };
}

export function scoreLead(companyId: string, leadData: Record<string, any>): number {
  const dbi = db.getDb();
  const rules = dbi.prepare(`SELECT * FROM lead_scoring_rules WHERE company_id = ? AND is_active = 1`).all(companyId) as any[];
  let total = 0;
  for (const r of rules) {
    try {
      const criteria = JSON.parse(r.criteria_json || '{}');
      if (matchesCriteria(leadData, criteria)) total += (r.score_value || 0);
    } catch {}
  }
  return total;
}

function matchesCriteria(data: any, criteria: any): boolean {
  if (!criteria || typeof criteria !== 'object') return false;
  for (const [field, expected] of Object.entries(criteria)) {
    const actual = data?.[field];
    if (typeof expected === 'object' && expected !== null) {
      const exp: any = expected;
      if ('eq' in exp && actual !== exp.eq) return false;
      if ('contains' in exp && !String(actual || '').toLowerCase().includes(String(exp.contains).toLowerCase())) return false;
      if ('gt' in exp && !(Number(actual) > exp.gt)) return false;
      if ('lt' in exp && !(Number(actual) < exp.lt)) return false;
      if ('in' in exp && Array.isArray(exp.in) && !exp.in.includes(actual)) return false;
    } else if (actual !== expected) return false;
  }
  return true;
}

export function listScoringRules(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM lead_scoring_rules WHERE company_id = ? ORDER BY score_value DESC`).all(companyId) as any[];
}

// ════════════════════════════════════════════════════════════════
// F138. Lead routing rules
// ════════════════════════════════════════════════════════════════
export function upsertRoutingRule(r: any): any {
  const dbi = db.getDb();
  const id = r.id || uuid();
  if (r.id) {
    dbi.prepare(`UPDATE lead_routing_rules SET rule_name = ?, priority = ?, criteria_json = ?, assign_to_user_id = ?, assign_to_team_id = ?, territory_id = ?, is_active = ?, updated_at = ? WHERE id = ?`)
      .run(r.rule_name, r.priority || 0, JSON.stringify(r.criteria || r.criteria_json || {}), r.assign_to_user_id || null, r.assign_to_team_id || null, r.territory_id || null, r.is_active === false ? 0 : 1, now(), r.id);
  } else {
    dbi.prepare(`INSERT INTO lead_routing_rules (id, company_id, rule_name, priority, criteria_json, assign_to_user_id, assign_to_team_id, territory_id, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, r.company_id, r.rule_name, r.priority || 0, JSON.stringify(r.criteria || {}), r.assign_to_user_id || null, r.assign_to_team_id || null, r.territory_id || null, r.is_active === false ? 0 : 1, now(), now());
  }
  return { id, ...r };
}

export function routeLead(companyId: string, leadData: Record<string, any>): { user_id: string | null; team_id: string | null; territory_id: string | null; matched_rule_id: string | null } {
  const dbi = db.getDb();
  const rules = dbi.prepare(`SELECT * FROM lead_routing_rules WHERE company_id = ? AND is_active = 1 ORDER BY priority DESC`).all(companyId) as any[];
  for (const r of rules) {
    try {
      const criteria = JSON.parse(r.criteria_json || '{}');
      if (matchesCriteria(leadData, criteria)) {
        dbi.prepare(`UPDATE lead_routing_rules SET match_count = match_count + 1 WHERE id = ?`).run(r.id);
        return { user_id: r.assign_to_user_id, team_id: r.assign_to_team_id, territory_id: r.territory_id, matched_rule_id: r.id };
      }
    } catch {}
  }
  return { user_id: null, team_id: null, territory_id: null, matched_rule_id: null };
}

export function listRoutingRules(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM lead_routing_rules WHERE company_id = ? ORDER BY priority DESC, match_count DESC`).all(companyId) as any[];
}

// ════════════════════════════════════════════════════════════════
// F139. Sales territories
// ════════════════════════════════════════════════════════════════
export function upsertTerritory(t: any): any {
  const dbi = db.getDb();
  const id = t.id || uuid();
  if (t.id) {
    dbi.prepare(`UPDATE sales_territories SET territory_name = ?, region = ?, countries = ?, states = ?, zip_prefixes = ?, industry_focus = ?, owner_user_id = ?, notes = ?, is_active = ?, updated_at = ? WHERE id = ?`)
      .run(t.territory_name, t.region || null, t.countries || null, t.states || null, t.zip_prefixes || null, t.industry_focus || null, t.owner_user_id || null, t.notes || null, t.is_active === false ? 0 : 1, now(), t.id);
  } else {
    dbi.prepare(`INSERT INTO sales_territories (id, company_id, territory_name, region, countries, states, zip_prefixes, industry_focus, owner_user_id, notes, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, t.company_id, t.territory_name, t.region || null, t.countries || null, t.states || null, t.zip_prefixes || null, t.industry_focus || null, t.owner_user_id || null, t.notes || null, t.is_active === false ? 0 : 1, now(), now());
  }
  return { id, ...t };
}

export function listTerritories(companyId: string, activeOnly: boolean = false): any[] {
  const dbi = db.getDb();
  let where = 'company_id = ?';
  if (activeOnly) where += ' AND is_active = 1';
  return dbi.prepare(`SELECT * FROM sales_territories WHERE ${where} ORDER BY territory_name ASC`).all(companyId) as any[];
}

// ════════════════════════════════════════════════════════════════
// F140. Commission plans
// ════════════════════════════════════════════════════════════════
export function upsertCommissionPlan(p: any): any {
  const dbi = db.getDb();
  const id = p.id || uuid();
  if (p.id) {
    dbi.prepare(`UPDATE commission_plans SET plan_name = ?, effective_from = ?, effective_to = ?, plan_type = ?, base_rate = ?, tiers_json = ?, accelerators_json = ?, is_active = ?, updated_at = ? WHERE id = ?`)
      .run(p.plan_name, p.effective_from || null, p.effective_to || null, p.plan_type || 'percent', p.base_rate || 0, JSON.stringify(p.tiers || p.tiers_json || []), JSON.stringify(p.accelerators || p.accelerators_json || []), p.is_active === false ? 0 : 1, now(), p.id);
  } else {
    dbi.prepare(`INSERT INTO commission_plans (id, company_id, plan_name, effective_from, effective_to, plan_type, base_rate, tiers_json, accelerators_json, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, p.company_id, p.plan_name, p.effective_from || null, p.effective_to || null, p.plan_type || 'percent', p.base_rate || 0, JSON.stringify(p.tiers || []), JSON.stringify(p.accelerators || []), p.is_active === false ? 0 : 1, now(), now());
  }
  return { id, ...p };
}

export function listCommissionPlans(companyId: string, activeOnly: boolean = false): any[] {
  const dbi = db.getDb();
  let where = 'company_id = ?';
  if (activeOnly) where += ' AND is_active = 1';
  return dbi.prepare(`SELECT * FROM commission_plans WHERE ${where} ORDER BY effective_from DESC`).all(companyId) as any[];
}

// ════════════════════════════════════════════════════════════════
// F141. Commission calculations
// ════════════════════════════════════════════════════════════════
export function calculateCommission(companyId: string, repId: string, planId: string, periodStart: string, periodEnd: string): any {
  const dbi = db.getDb();
  const plan = dbi.prepare(`SELECT * FROM commission_plans WHERE id = ?`).get(planId) as any;
  if (!plan) throw new Error('Plan not found');

  const revenueRow = dbi.prepare(`SELECT COALESCE(SUM(estimated_value), 0) AS r FROM deals WHERE company_id = ? AND assigned_to = ? AND status = 'won' AND actual_close_date BETWEEN ? AND ?`)
    .get(companyId, repId, periodStart, periodEnd) as any;
  const revenue = revenueRow.r || 0;

  let baseCommission = revenue * (plan.base_rate || 0) / 100;
  let acceleratorCommission = 0;

  // Tier-based: if revenue exceeds tier threshold, apply tier rate
  try {
    const tiers = JSON.parse(plan.tiers_json || '[]');
    for (const t of tiers) {
      if (revenue >= (t.threshold || 0)) {
        baseCommission = revenue * (t.rate || 0) / 100;
      }
    }
  } catch {}

  // Accelerators: bonus % above quota
  try {
    const accels = JSON.parse(plan.accelerators_json || '[]');
    for (const a of accels) {
      if (revenue >= (a.quota || 0)) {
        const above = revenue - (a.quota || 0);
        acceleratorCommission += above * (a.bonus_rate || 0) / 100;
      }
    }
  } catch {}

  const total = baseCommission + acceleratorCommission;
  const id = uuid();
  dbi.prepare(`INSERT INTO commission_calculations (id, company_id, rep_id, plan_id, period_start, period_end, revenue_basis, base_commission, accelerator_commission, total_commission, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, companyId, repId, planId, periodStart, periodEnd, revenue, baseCommission, acceleratorCommission, total, now());
  return { id, revenue_basis: revenue, base_commission: baseCommission, accelerator_commission: acceleratorCommission, total_commission: total };
}

export function listCommissionCalculations(companyId: string, opts?: { rep_id?: string; paid?: boolean }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.rep_id) { where += ' AND rep_id = ?'; params.push(opts.rep_id); }
  if (opts?.paid !== undefined) { where += ' AND paid = ?'; params.push(opts.paid ? 1 : 0); }
  return dbi.prepare(`SELECT * FROM commission_calculations WHERE ${where} ORDER BY period_start DESC`).all(...params) as any[];
}

export function markCommissionPaid(id: string): boolean {
  const r = db.getDb().prepare(`UPDATE commission_calculations SET paid = 1, paid_at = ? WHERE id = ?`).run(now(), id);
  return r.changes > 0;
}

// ════════════════════════════════════════════════════════════════
// F142. Discount rules
// ════════════════════════════════════════════════════════════════
export function upsertDiscountRule(r: any): any {
  const dbi = db.getDb();
  const id = r.id || uuid();
  if (r.id) {
    dbi.prepare(`UPDATE discount_rules SET rule_name = ?, rule_type = ?, discount_percent = ?, discount_amount = ?, minimum_qty = ?, minimum_amount = ?, applies_to = ?, item_ids = ?, customer_tier = ?, effective_from = ?, effective_to = ?, is_active = ?, updated_at = ? WHERE id = ?`)
      .run(r.rule_name, r.rule_type || 'volume', r.discount_percent || 0, r.discount_amount || 0, r.minimum_qty || 0, r.minimum_amount || 0, r.applies_to || 'all', r.item_ids || null, r.customer_tier || null, r.effective_from || null, r.effective_to || null, r.is_active === false ? 0 : 1, now(), r.id);
  } else {
    dbi.prepare(`INSERT INTO discount_rules (id, company_id, rule_name, rule_type, discount_percent, discount_amount, minimum_qty, minimum_amount, applies_to, item_ids, customer_tier, effective_from, effective_to, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, r.company_id, r.rule_name, r.rule_type || 'volume', r.discount_percent || 0, r.discount_amount || 0, r.minimum_qty || 0, r.minimum_amount || 0, r.applies_to || 'all', r.item_ids || null, r.customer_tier || null, r.effective_from || null, r.effective_to || null, r.is_active === false ? 0 : 1, now(), now());
  }
  return { id, ...r };
}

export function evaluateDiscountRules(companyId: string, order: { total: number; qty?: number; customer_tier?: string; item_ids?: string[] }): { discount_amount: number; applied_rules: any[] } {
  const dbi = db.getDb();
  const rules = dbi.prepare(`SELECT * FROM discount_rules WHERE company_id = ? AND is_active = 1 AND (effective_from IS NULL OR effective_from <= date('now')) AND (effective_to IS NULL OR effective_to >= date('now'))`).all(companyId) as any[];
  let discount = 0;
  const applied: any[] = [];
  for (const r of rules) {
    if (order.total < r.minimum_amount) continue;
    if (r.minimum_qty && (order.qty || 0) < r.minimum_qty) continue;
    if (r.customer_tier && r.customer_tier !== order.customer_tier) continue;
    const amt = r.discount_amount || (order.total * (r.discount_percent || 0) / 100);
    discount += amt;
    applied.push({ rule_id: r.id, rule_name: r.rule_name, amount: amt });
  }
  return { discount_amount: discount, applied_rules: applied };
}

export function listDiscountRules(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM discount_rules WHERE company_id = ? ORDER BY rule_name`).all(companyId) as any[];
}

// ════════════════════════════════════════════════════════════════
// F143. Promo codes
// ════════════════════════════════════════════════════════════════
export function upsertPromoCode(p: any): any {
  const dbi = db.getDb();
  const id = p.id || uuid();
  if (p.id) {
    dbi.prepare(`UPDATE promo_codes SET code = ?, description = ?, discount_percent = ?, discount_amount = ?, max_redemptions = ?, minimum_order_amount = ?, valid_from = ?, valid_to = ?, one_per_customer = ?, is_active = ? WHERE id = ?`)
      .run(p.code, p.description || null, p.discount_percent || 0, p.discount_amount || 0, p.max_redemptions || 0, p.minimum_order_amount || 0, p.valid_from || null, p.valid_to || null, p.one_per_customer ? 1 : 0, p.is_active === false ? 0 : 1, p.id);
  } else {
    dbi.prepare(`INSERT INTO promo_codes (id, company_id, code, description, discount_percent, discount_amount, max_redemptions, minimum_order_amount, valid_from, valid_to, one_per_customer, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, p.company_id, p.code, p.description || null, p.discount_percent || 0, p.discount_amount || 0, p.max_redemptions || 0, p.minimum_order_amount || 0, p.valid_from || null, p.valid_to || null, p.one_per_customer ? 1 : 0, p.is_active === false ? 0 : 1, now());
  }
  return { id, ...p };
}

export function redeemPromoCode(companyId: string, code: string, customerId: string | null, orderTotal: number, invoiceId?: string): { success: boolean; discount_amount?: number; reason?: string } {
  const dbi = db.getDb();
  const promo = dbi.prepare(`SELECT * FROM promo_codes WHERE company_id = ? AND code = ? AND is_active = 1`).get(companyId, code) as any;
  if (!promo) return { success: false, reason: 'Invalid code' };
  const today_ = today();
  if (promo.valid_from && promo.valid_from > today_) return { success: false, reason: 'Not yet valid' };
  if (promo.valid_to && promo.valid_to < today_) return { success: false, reason: 'Expired' };
  if (promo.max_redemptions && promo.redemption_count >= promo.max_redemptions) return { success: false, reason: 'Max redemptions reached' };
  if (orderTotal < promo.minimum_order_amount) return { success: false, reason: `Minimum order ${promo.minimum_order_amount} not met` };
  if (promo.one_per_customer && customerId) {
    const used = dbi.prepare(`SELECT id FROM promo_code_redemptions WHERE promo_code_id = ? AND customer_id = ? LIMIT 1`).get(promo.id, customerId);
    if (used) return { success: false, reason: 'Already redeemed by customer' };
  }
  const discountAmt = promo.discount_amount || (orderTotal * (promo.discount_percent || 0) / 100);
  dbi.prepare(`INSERT INTO promo_code_redemptions (id, promo_code_id, customer_id, invoice_id, order_total, discount_amount, redeemed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(uuid(), promo.id, customerId, invoiceId || null, orderTotal, discountAmt, now());
  dbi.prepare(`UPDATE promo_codes SET redemption_count = redemption_count + 1 WHERE id = ?`).run(promo.id);
  return { success: true, discount_amount: discountAmt };
}

export function listPromoCodes(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM promo_codes WHERE company_id = ? ORDER BY created_at DESC`).all(companyId) as any[];
}

// ════════════════════════════════════════════════════════════════
// F144. Loyalty program
// ════════════════════════════════════════════════════════════════
export function upsertLoyaltyTier(t: any): any {
  const dbi = db.getDb();
  const id = t.id || uuid();
  if (t.id) {
    dbi.prepare(`UPDATE loyalty_tiers SET tier_name = ?, sort_order = ?, minimum_spend = ?, minimum_points = ?, discount_percent = ?, earn_multiplier = ?, perks = ?, color = ?, updated_at = ? WHERE id = ?`)
      .run(t.tier_name, t.sort_order || 0, t.minimum_spend || 0, t.minimum_points || 0, t.discount_percent || 0, t.earn_multiplier || 1.0, t.perks || null, t.color || '#6366f1', now(), t.id);
  } else {
    dbi.prepare(`INSERT INTO loyalty_tiers (id, company_id, tier_name, sort_order, minimum_spend, minimum_points, discount_percent, earn_multiplier, perks, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, t.company_id, t.tier_name, t.sort_order || 0, t.minimum_spend || 0, t.minimum_points || 0, t.discount_percent || 0, t.earn_multiplier || 1.0, t.perks || null, t.color || '#6366f1', now(), now());
  }
  return { id, ...t };
}

export function awardPoints(companyId: string, customerId: string, points: number, reason: string, invoiceId?: string): any {
  const dbi = db.getDb();
  const dir = points >= 0 ? 'earn' : 'redeem';
  dbi.prepare(`INSERT INTO loyalty_transactions (id, company_id, customer_id, transaction_date, direction, points, reason, invoice_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(uuid(), companyId, customerId, now(), dir, points, reason, invoiceId || null);
  // Upsert customer_loyalty
  const existing = dbi.prepare(`SELECT * FROM customer_loyalty WHERE company_id = ? AND customer_id = ?`).get(companyId, customerId) as any;
  if (existing) {
    dbi.prepare(`UPDATE customer_loyalty SET points_balance = points_balance + ?, lifetime_points = lifetime_points + ?, last_activity_date = ?, updated_at = ? WHERE id = ?`)
      .run(points, Math.max(points, 0), today(), now(), existing.id);
  } else {
    dbi.prepare(`INSERT INTO customer_loyalty (id, company_id, customer_id, points_balance, lifetime_points, last_activity_date, enrolled_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(uuid(), companyId, customerId, points, Math.max(points, 0), today(), today(), now(), now());
  }
  return { points_added: points, direction: dir };
}

export function getLoyaltyStatus(companyId: string, customerId: string): any {
  const dbi = db.getDb();
  const status = dbi.prepare(`SELECT cl.*, lt.tier_name, lt.discount_percent, lt.color FROM customer_loyalty cl LEFT JOIN loyalty_tiers lt ON lt.id = cl.tier_id WHERE cl.company_id = ? AND cl.customer_id = ?`).get(companyId, customerId);
  return status || null;
}

export function listLoyaltyTiers(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM loyalty_tiers WHERE company_id = ? ORDER BY sort_order ASC`).all(companyId) as any[];
}

// ════════════════════════════════════════════════════════════════
// F145. Customer referrals
// ════════════════════════════════════════════════════════════════
export function recordReferral(r: any): any {
  const dbi = db.getDb();
  const id = uuid();
  dbi.prepare(`INSERT INTO customer_referrals (id, company_id, referrer_customer_id, referee_name, referee_email, referee_customer_id, status, reward_amount, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, r.company_id, r.referrer_customer_id, r.referee_name || null, r.referee_email || null, r.referee_customer_id || null, r.status || 'pending', r.reward_amount || 0, r.notes || null, now());
  return { id, ...r };
}

export function convertReferral(referralId: string, refereeCustomerId: string): boolean {
  const r = db.getDb().prepare(`UPDATE customer_referrals SET status = 'converted', referee_customer_id = ?, converted_at = ? WHERE id = ?`).run(refereeCustomerId, now(), referralId);
  return r.changes > 0;
}

export function payReferralReward(referralId: string): boolean {
  const r = db.getDb().prepare(`UPDATE customer_referrals SET status = 'paid', reward_paid_at = ? WHERE id = ? AND status = 'converted'`).run(now(), referralId);
  return r.changes > 0;
}

export function listReferrals(companyId: string, opts?: { status?: string; referrer_customer_id?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  if (opts?.referrer_customer_id) { where += ' AND referrer_customer_id = ?'; params.push(opts.referrer_customer_id); }
  return dbi.prepare(`SELECT * FROM customer_referrals WHERE ${where} ORDER BY created_at DESC`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// F146. Quote template lines (reusable rich templates)
// ════════════════════════════════════════════════════════════════
export function setQuoteTemplateLines(templateId: string, lines: Array<{ item_id?: string; description: string; quantity: number; unit_price: number; discount_percent?: number; tax_rate?: number; notes?: string }>): { added: number } {
  const dbi = db.getDb();
  // Clear and replace
  dbi.prepare(`DELETE FROM quote_template_lines WHERE template_id = ?`).run(templateId);
  const insert = dbi.prepare(`INSERT INTO quote_template_lines (id, template_id, sort_order, item_id, description, quantity, unit_price, discount_percent, tax_rate, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const tx = dbi.transaction(() => {
    lines.forEach((l, i) => {
      insert.run(uuid(), templateId, i, l.item_id || null, l.description, l.quantity || 1, l.unit_price || 0, l.discount_percent || 0, l.tax_rate || 0, l.notes || null);
    });
  });
  tx();
  return { added: lines.length };
}

export function getQuoteTemplateLines(templateId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM quote_template_lines WHERE template_id = ? ORDER BY sort_order ASC`).all(templateId) as any[];
}

// ════════════════════════════════════════════════════════════════
// F147. Quote→invoice conversion log
// ════════════════════════════════════════════════════════════════
export function logQuoteConversion(companyId: string, quoteId: string, invoiceId: string, convertedBy?: string, notes?: string): any {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO quote_conversion_log (id, company_id, quote_id, invoice_id, conversion_date, converted_by, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, companyId, quoteId, invoiceId, now(), convertedBy || null, notes || null);
  return { id };
}

export function listQuoteConversions(companyId: string, opts?: { quote_id?: string; limit?: number }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.quote_id) { where += ' AND quote_id = ?'; params.push(opts.quote_id); }
  return dbi.prepare(`SELECT * FROM quote_conversion_log WHERE ${where} ORDER BY conversion_date DESC LIMIT ${Math.min(opts?.limit || 100, 1000)}`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// F148. Quote signatures
// ════════════════════════════════════════════════════════════════
export function signQuote(s: { quote_id: string; signer_name: string; signer_email?: string; signature_data?: string; ip_address?: string; user_agent?: string }): any {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO quote_signatures (id, quote_id, signer_name, signer_email, signature_data, signed_at, ip_address, user_agent, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'signed')`)
    .run(id, s.quote_id, s.signer_name, s.signer_email || null, s.signature_data || null, now(), s.ip_address || null, s.user_agent || null);
  return { id, signed_at: now() };
}

export function getQuoteSignatures(quoteId: string): any[] {
  return db.getDb().prepare(`SELECT id, quote_id, signer_name, signer_email, signed_at, ip_address, status FROM quote_signatures WHERE quote_id = ? ORDER BY signed_at DESC`).all(quoteId) as any[];
}

// ════════════════════════════════════════════════════════════════
// F149. RFP tracking
// ════════════════════════════════════════════════════════════════
export function upsertRFP(r: any): any {
  const dbi = db.getDb();
  const id = r.id || uuid();
  if (r.id) {
    dbi.prepare(`UPDATE rfp_tracking SET rfp_number = ?, title = ?, issued_by = ?, received_date = ?, response_due_date = ?, contract_value_estimate = ?, status = ?, submitted_at = ?, win_probability = ?, assigned_to = ?, response_doc_url = ?, decision_date = ?, outcome = ?, feedback = ?, notes = ?, updated_at = ? WHERE id = ?`)
      .run(r.rfp_number || null, r.title, r.issued_by || null, r.received_date || null, r.response_due_date || null, r.contract_value_estimate || 0, r.status || 'evaluating', r.submitted_at || null, r.win_probability || 50, r.assigned_to || null, r.response_doc_url || null, r.decision_date || null, r.outcome || null, r.feedback || null, r.notes || null, now(), r.id);
  } else {
    dbi.prepare(`INSERT INTO rfp_tracking (id, company_id, rfp_number, title, issued_by, received_date, response_due_date, contract_value_estimate, status, win_probability, assigned_to, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, r.company_id, r.rfp_number || null, r.title, r.issued_by || null, r.received_date || null, r.response_due_date || null, r.contract_value_estimate || 0, r.status || 'evaluating', r.win_probability || 50, r.assigned_to || null, r.notes || null, now(), now());
  }
  return { id, ...r };
}

export function listRFPs(companyId: string, opts?: { status?: string; assigned_to?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  if (opts?.assigned_to) { where += ' AND assigned_to = ?'; params.push(opts.assigned_to); }
  return dbi.prepare(`SELECT * FROM rfp_tracking WHERE ${where} ORDER BY response_due_date ASC NULLS LAST`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// F150. Win/loss analysis
// ════════════════════════════════════════════════════════════════
export function recordWinLoss(w: any): any {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO win_loss_analysis (id, company_id, deal_id, outcome, primary_reason, secondary_reasons, competitor, price_pressure, feature_gap, customer_feedback, lessons_learned, analyzed_by, analyzed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, w.company_id, w.deal_id, w.outcome, w.primary_reason || null, w.secondary_reasons || null, w.competitor || null, w.price_pressure ? 1 : 0, w.feature_gap || null, w.customer_feedback || null, w.lessons_learned || null, w.analyzed_by || null, now());
  return { id, ...w };
}

export function winLossSummary(companyId: string, opts?: { from?: string; to?: string }): any {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.from) { where += ' AND analyzed_at >= ?'; params.push(opts.from); }
  if (opts?.to) { where += ' AND analyzed_at <= ?'; params.push(opts.to); }

  const byReason = dbi.prepare(`SELECT primary_reason, outcome, COUNT(*) AS cnt FROM win_loss_analysis WHERE ${where} GROUP BY primary_reason, outcome ORDER BY cnt DESC`).all(...params) as any[];
  const byCompetitor = dbi.prepare(`SELECT competitor, outcome, COUNT(*) AS cnt FROM win_loss_analysis WHERE ${where} AND competitor IS NOT NULL GROUP BY competitor, outcome ORDER BY cnt DESC`).all(...params) as any[];
  const totals = dbi.prepare(`SELECT outcome, COUNT(*) AS cnt FROM win_loss_analysis WHERE ${where} GROUP BY outcome`).all(...params) as any[];
  return { by_reason: byReason, by_competitor: byCompetitor, totals };
}

export function listWinLossEntries(companyId: string, limit: number = 100): any[] {
  return db.getDb().prepare(`SELECT * FROM win_loss_analysis WHERE company_id = ? ORDER BY analyzed_at DESC LIMIT ?`).all(companyId, Math.min(limit, 1000)) as any[];
}
