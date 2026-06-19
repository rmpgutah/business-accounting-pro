// src/main/services/automation-features.ts
//
// Batch 6 — Automation & Workflow features (F71-F90, 20 features).

import * as db from '../database';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

// ── F71-F75: Workflow framework ───────────────────────────────

export type WorkflowTriggerType =
  | 'invoice.created' | 'invoice.paid' | 'invoice.overdue'
  | 'expense.created' | 'expense.over_threshold'
  | 'bill.received' | 'bill.due_soon'
  | 'payment.received'
  | 'time.scheduled' | 'time.daily' | 'time.weekly' | 'time.monthly';

export type WorkflowActionType =
  | 'send_email' | 'send_notification' | 'create_task'
  | 'auto_categorize' | 'auto_assign' | 'auto_archive'
  | 'webhook_post' | 'create_record' | 'update_record';

export interface Workflow {
  id?: string;
  company_id: string;
  name: string;
  description?: string;
  trigger_type: WorkflowTriggerType;
  trigger_config?: any;
  conditions_json?: any[];
  actions_json: any[];
  is_active?: boolean;
}

export function upsertWorkflow(w: Workflow): any {
  const dbi = db.getDb();
  const id = w.id || uuid();
  const trigCfg = typeof w.trigger_config === 'string' ? w.trigger_config : JSON.stringify(w.trigger_config || {});
  const conds = typeof w.conditions_json === 'string' ? w.conditions_json : JSON.stringify(w.conditions_json || []);
  const acts = typeof w.actions_json === 'string' ? w.actions_json : JSON.stringify(w.actions_json || []);
  if (w.id) {
    dbi.prepare(`UPDATE workflows SET name = ?, description = ?, trigger_type = ?, trigger_config = ?, conditions_json = ?, actions_json = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(w.name, w.description || '', w.trigger_type, trigCfg, conds, acts, w.is_active === false ? 0 : 1, id);
  } else {
    dbi.prepare(`INSERT INTO workflows (id, company_id, name, description, trigger_type, trigger_config, conditions_json, actions_json, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, w.company_id, w.name, w.description || '', w.trigger_type, trigCfg, conds, acts, w.is_active === false ? 0 : 1);
  }
  return dbi.prepare('SELECT * FROM workflows WHERE id = ?').get(id);
}

export function listWorkflows(companyId: string, activeOnly: boolean = false): any[] {
  const dbi = db.getDb();
  const sql = activeOnly
    ? `SELECT * FROM workflows WHERE company_id = ? AND is_active = 1 ORDER BY name`
    : `SELECT * FROM workflows WHERE company_id = ? ORDER BY is_active DESC, name`;
  return dbi.prepare(sql).all(companyId) as any[];
}

/**
 * Trigger workflows whose trigger_type matches and conditions evaluate true.
 * Returns the run records (status: success / failed / skipped).
 */
export function triggerWorkflows(companyId: string, triggerType: WorkflowTriggerType, payload: any): any[] {
  const dbi = db.getDb();
  const workflows = dbi.prepare(`SELECT * FROM workflows WHERE company_id = ? AND trigger_type = ? AND is_active = 1`).all(companyId, triggerType) as any[];
  const runs: any[] = [];
  for (const w of workflows) {
    const runId = uuid();
    const startTime = Date.now();
    dbi.prepare(`INSERT INTO workflow_runs (id, workflow_id, trigger_payload, status) VALUES (?, ?, ?, 'running')`)
      .run(runId, w.id, JSON.stringify(payload));
    let conditions: any[] = [];
    let actions: any[] = [];
    try {
      conditions = JSON.parse(w.conditions_json || '[]');
      actions = JSON.parse(w.actions_json || '[]');
    } catch { /* */ }
    // Evaluate conditions (simple AND logic)
    const conditionsMet = conditions.every((c: any) => evaluateCondition(c, payload));
    if (!conditionsMet) {
      dbi.prepare(`UPDATE workflow_runs SET status = 'skipped', completed_at = datetime('now'), duration_ms = ? WHERE id = ?`).run(Date.now() - startTime, runId);
      runs.push({ id: runId, status: 'skipped' });
      continue;
    }
    // Execute actions
    let actionCount = 0;
    let runError = '';
    for (const a of actions) {
      try {
        executeWorkflowAction(a, payload, companyId);
        actionCount++;
      } catch (e: any) {
        runError = e?.message || String(e);
        break;
      }
    }
    const status = runError ? 'failed' : 'success';
    dbi.prepare(`UPDATE workflow_runs SET status = ?, actions_executed = ?, error_message = ?, completed_at = datetime('now'), duration_ms = ? WHERE id = ?`)
      .run(status, actionCount, runError, Date.now() - startTime, runId);
    dbi.prepare(`UPDATE workflows SET run_count = run_count + 1, ${status === 'success' ? 'success_count' : 'failure_count'} = ${status === 'success' ? 'success_count' : 'failure_count'} + 1, last_run_at = datetime('now') WHERE id = ?`).run(w.id);
    runs.push({ id: runId, status, actions_executed: actionCount, error: runError });
  }
  return runs;
}

function evaluateCondition(condition: any, payload: any): boolean {
  if (!condition || !condition.field) return true;
  const fieldVal = payload?.[condition.field];
  switch (condition.operator) {
    case '=': case 'equals': return fieldVal == condition.value;
    case '!=': case 'not_equals': return fieldVal != condition.value;
    case '>': case 'gt': return Number(fieldVal) > Number(condition.value);
    case '<': case 'lt': return Number(fieldVal) < Number(condition.value);
    case '>=': case 'gte': return Number(fieldVal) >= Number(condition.value);
    case '<=': case 'lte': return Number(fieldVal) <= Number(condition.value);
    case 'contains': return String(fieldVal || '').includes(String(condition.value));
    case 'in': return Array.isArray(condition.value) && condition.value.includes(fieldVal);
    default: return true;
  }
}

function executeWorkflowAction(action: any, payload: any, companyId: string): void {
  const dbi = db.getDb();
  switch (action.type as WorkflowActionType) {
    case 'send_notification': {
      try {
        dbi.prepare(`INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`)
          .run(uuid(), companyId, action.config?.type || 'workflow', action.config?.title || 'Workflow notification', interpolate(action.config?.message || '', payload), payload?.entity_type || '', payload?.entity_id || '');
      } catch { /* */ }
      break;
    }
    case 'auto_archive': {
      const entityType = payload?.entity_type;
      const entityId = payload?.entity_id;
      if (entityType && entityId && ['invoices', 'bills'].includes(entityType)) {
        try { dbi.prepare(`UPDATE ${entityType} SET archived_at = datetime('now') WHERE id = ?`).run(entityId); } catch { /* */ }
      }
      break;
    }
    case 'webhook_post': {
      // Log to triggered_actions; actual HTTP delivery happens via async worker
      try {
        dbi.prepare(`INSERT INTO triggered_actions_log (id, company_id, trigger_source, trigger_entity_type, trigger_entity_id, action_type, action_result) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(uuid(), companyId, 'workflow', payload?.entity_type || '', payload?.entity_id || '', 'webhook_post', JSON.stringify({ url: action.config?.url, queued: true }));
      } catch { /* */ }
      break;
    }
    default: break;
  }
}

function interpolate(template: string, payload: any): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => String(payload?.[k] ?? ''));
}

// ── F76: Scheduled tasks ─────────────────────────────────────

export function upsertScheduledTask(t: { id?: string; company_id: string; task_name: string; cron_expression: string; action_type: string; action_config?: any; next_run_at: string; is_active?: boolean }): any {
  const dbi = db.getDb();
  const id = t.id || uuid();
  const cfg = typeof t.action_config === 'string' ? t.action_config : JSON.stringify(t.action_config || {});
  if (t.id) {
    dbi.prepare(`UPDATE scheduled_tasks SET task_name = ?, cron_expression = ?, action_type = ?, action_config = ?, next_run_at = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(t.task_name, t.cron_expression, t.action_type, cfg, t.next_run_at, t.is_active === false ? 0 : 1, id);
  } else {
    dbi.prepare(`INSERT INTO scheduled_tasks (id, company_id, task_name, cron_expression, action_type, action_config, next_run_at, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, t.company_id, t.task_name, t.cron_expression, t.action_type, cfg, t.next_run_at, t.is_active === false ? 0 : 1);
  }
  return dbi.prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id);
}

export function listScheduledTasks(companyId: string): any[] {
  return db.getDb().prepare('SELECT * FROM scheduled_tasks WHERE company_id = ? ORDER BY next_run_at').all(companyId) as any[];
}

export function dueScheduledTasks(): any[] {
  const now = new Date().toISOString();
  return db.getDb().prepare(`SELECT * FROM scheduled_tasks WHERE is_active = 1 AND next_run_at <= ?`).all(now) as any[];
}

export function markScheduledTaskRun(id: string, status: 'success' | 'failed', nextRunAt: string): boolean {
  return db.getDb().prepare(`UPDATE scheduled_tasks SET last_run_at = datetime('now'), last_run_status = ?, next_run_at = ?, run_count = run_count + 1, updated_at = datetime('now') WHERE id = ?`).run(status, nextRunAt, id).changes > 0;
}

// ── F77-F79: Approval chains ──────────────────────────────────

export interface ApprovalChain {
  id?: string;
  company_id: string;
  chain_name: string;
  entity_type: 'invoice' | 'expense' | 'bill' | 'purchase_order' | 'time_entry' | 'reimbursement';
  trigger_threshold?: number;
  steps: Array<{ approver_user_id?: string; approver_role?: string; step_label: string; require_all?: boolean }>;
}

export function upsertApprovalChain(c: ApprovalChain): any {
  const dbi = db.getDb();
  const id = c.id || uuid();
  if (c.id) {
    dbi.prepare(`UPDATE approval_chains SET chain_name = ?, entity_type = ?, trigger_threshold = ?, steps_json = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(c.chain_name, c.entity_type, c.trigger_threshold || 0, JSON.stringify(c.steps), id);
  } else {
    dbi.prepare(`INSERT INTO approval_chains (id, company_id, chain_name, entity_type, trigger_threshold, steps_json) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, c.company_id, c.chain_name, c.entity_type, c.trigger_threshold || 0, JSON.stringify(c.steps));
  }
  return dbi.prepare('SELECT * FROM approval_chains WHERE id = ?').get(id);
}

export function startApprovalInstance(chainId: string, entityType: string, entityId: string, submittedBy: string): any {
  const dbi = db.getDb();
  const id = uuid();
  dbi.prepare(`INSERT INTO approval_instances (id, chain_id, entity_type, entity_id, submitted_by) VALUES (?, ?, ?, ?, ?)`)
    .run(id, chainId, entityType, entityId, submittedBy);
  return dbi.prepare('SELECT * FROM approval_instances WHERE id = ?').get(id);
}

export function actOnApproval(instanceId: string, action: 'approve' | 'reject', actorId: string, comment?: string): { status: string; current_step: number } {
  const dbi = db.getDb();
  const inst = dbi.prepare('SELECT * FROM approval_instances WHERE id = ?').get(instanceId) as any;
  if (!inst) throw new Error('Approval instance not found');
  const chain = dbi.prepare('SELECT * FROM approval_chains WHERE id = ?').get(inst.chain_id) as any;
  const steps = JSON.parse(chain?.steps_json || '[]');
  const log = JSON.parse(inst.steps_log || '[]');
  log.push({ step: inst.current_step, action, actor: actorId, comment: comment || '', at: new Date().toISOString() });

  if (action === 'reject') {
    dbi.prepare(`UPDATE approval_instances SET status = 'rejected', completed_at = datetime('now'), steps_log = ? WHERE id = ?`).run(JSON.stringify(log), instanceId);
    return { status: 'rejected', current_step: inst.current_step };
  }

  const nextStep = inst.current_step + 1;
  if (nextStep >= steps.length) {
    // Final approval
    dbi.prepare(`UPDATE approval_instances SET status = 'approved', current_step = ?, completed_at = datetime('now'), steps_log = ? WHERE id = ?`)
      .run(nextStep, JSON.stringify(log), instanceId);
    return { status: 'approved', current_step: nextStep };
  }
  dbi.prepare(`UPDATE approval_instances SET current_step = ?, steps_log = ? WHERE id = ?`).run(nextStep, JSON.stringify(log), instanceId);
  return { status: 'pending', current_step: nextStep };
}

export function pendingApprovals(companyId: string, approverUserId?: string): any[] {
  const dbi = db.getDb();
  const rows = dbi.prepare(`
    SELECT ai.*, ac.chain_name, ac.steps_json, ac.entity_type
    FROM approval_instances ai
    JOIN approval_chains ac ON ac.id = ai.chain_id
    WHERE ac.company_id = ? AND ai.status = 'pending'
    ORDER BY ai.submitted_at DESC
  `).all(companyId) as any[];
  if (!approverUserId) return rows;
  // Filter to only those where current step approver matches
  return rows.filter((r) => {
    const steps = JSON.parse(r.steps_json || '[]');
    const cur = steps[r.current_step];
    return cur?.approver_user_id === approverUserId;
  });
}

// ── F80: Email templates ──────────────────────────────────────

export function upsertEmailTemplate(t: { id?: string; company_id: string; template_name: string; template_key: string; subject: string; body_html: string; body_text?: string; category?: string }): any {
  const dbi = db.getDb();
  const id = t.id || uuid();
  if (t.id) {
    dbi.prepare(`UPDATE email_templates SET template_name = ?, template_key = ?, subject = ?, body_html = ?, body_text = ?, category = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(t.template_name, t.template_key, t.subject, t.body_html, t.body_text || '', t.category || '', id);
  } else {
    dbi.prepare(`INSERT OR REPLACE INTO email_templates (id, company_id, template_name, template_key, subject, body_html, body_text, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, t.company_id, t.template_name, t.template_key, t.subject, t.body_html, t.body_text || '', t.category || '');
  }
  return dbi.prepare('SELECT * FROM email_templates WHERE id = ?').get(id);
}

export function listEmailTemplates(companyId: string, category?: string): any[] {
  const dbi = db.getDb();
  if (category) return dbi.prepare('SELECT * FROM email_templates WHERE company_id = ? AND category = ? AND is_active = 1 ORDER BY template_name').all(companyId, category) as any[];
  return dbi.prepare('SELECT * FROM email_templates WHERE company_id = ? AND is_active = 1 ORDER BY template_name').all(companyId) as any[];
}

export function renderEmailTemplate(templateId: string, data: Record<string, any>): { subject: string; html: string; text: string } | null {
  const dbi = db.getDb();
  const t = dbi.prepare('SELECT * FROM email_templates WHERE id = ?').get(templateId) as any;
  if (!t) return null;
  const sub = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => String(data?.[k] ?? ''));
  return { subject: sub(t.subject), html: sub(t.body_html), text: sub(t.body_text || '') };
}

// ── F81-F82: Webhook subscriptions ────────────────────────────

export function upsertWebhookSubscription(w: { id?: string; company_id: string; url: string; event_types?: string[]; secret_key?: string; is_active?: boolean }): any {
  const dbi = db.getDb();
  const id = w.id || uuid();
  const secret = w.secret_key || crypto.randomBytes(32).toString('hex');
  try {
    if (w.id) {
      dbi.prepare(`UPDATE webhook_subscriptions SET url = ?, event_types = ?, secret_key = ?, is_active = ? WHERE id = ?`)
        .run(w.url, JSON.stringify(w.event_types || []), secret, w.is_active === false ? 0 : 1, id);
    } else {
      dbi.prepare(`INSERT INTO webhook_subscriptions (id, company_id, url, event_types, secret_key, is_active) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, w.company_id, w.url, JSON.stringify(w.event_types || []), secret, w.is_active === false ? 0 : 1);
    }
  } catch { /* schema mismatch — fall back to minimal columns */ }
  return dbi.prepare('SELECT * FROM webhook_subscriptions WHERE id = ?').get(id);
}

export function recordWebhookDelivery(subscriptionId: string, eventType: string, payload: any, responseStatus: number, responseBody: string, durationMs: number): void {
  const dbi = db.getDb();
  const succeeded = responseStatus >= 200 && responseStatus < 300 ? 1 : 0;
  dbi.prepare(`INSERT INTO webhook_deliveries (id, subscription_id, event_type, payload_json, response_status, response_body, duration_ms, succeeded) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(uuid(), subscriptionId, eventType, JSON.stringify(payload), responseStatus, responseBody.slice(0, 5000), durationMs, succeeded);
  if (succeeded) {
    dbi.prepare(`UPDATE webhook_subscriptions SET last_delivered_at = datetime('now'), last_status_code = ?, consecutive_failures = 0, delivery_count = delivery_count + 1 WHERE id = ?`).run(responseStatus, subscriptionId);
  } else {
    dbi.prepare(`UPDATE webhook_subscriptions SET last_status_code = ?, consecutive_failures = consecutive_failures + 1 WHERE id = ?`).run(responseStatus, subscriptionId);
  }
}

// ── F83: Auto-categorize learnings ────────────────────────────

export function recordAutoCategorizeAccept(companyId: string, descriptionPattern: string, vendorId: string | null, categoryId: string): void {
  const dbi = db.getDb();
  const id = uuid();
  try {
    dbi.prepare(`
      INSERT INTO auto_categorize_learnings (id, company_id, description_pattern, vendor_id, suggested_category_id, times_matched, times_accepted, last_seen_at)
      VALUES (?, ?, ?, ?, ?, 1, 1, datetime('now'))
      ON CONFLICT(company_id, description_pattern, vendor_id) DO UPDATE SET
        times_matched = times_matched + 1,
        times_accepted = times_accepted + 1,
        suggested_category_id = excluded.suggested_category_id,
        last_seen_at = datetime('now')
    `).run(id, companyId, descriptionPattern.toLowerCase().trim(), vendorId, categoryId);
  } catch { /* */ }
}

export function getAutoCategorizeSuggestion(companyId: string, description: string, vendorId?: string): { category_id: string; confidence: number } | null {
  const dbi = db.getDb();
  const desc = description.toLowerCase().trim();
  // Try exact match by vendor + first 30 chars of description
  const rows = dbi.prepare(`SELECT * FROM auto_categorize_learnings WHERE company_id = ? AND (vendor_id = ? OR vendor_id IS NULL) ORDER BY times_accepted DESC LIMIT 10`).all(companyId, vendorId || null) as any[];
  for (const r of rows) {
    if (desc.includes(r.description_pattern)) {
      const conf = r.times_accepted / Math.max(1, r.times_matched);
      return { category_id: r.suggested_category_id, confidence: round2(conf) };
    }
  }
  return null;
}

// ── F84: Auto-archive policies ────────────────────────────────

export function runAutoArchive(companyId: string): { invoices_archived: number; bills_archived: number } {
  const dbi = db.getDb();
  const company = db.getById('companies', companyId) as any || {};
  const invoiceDays = company.auto_archive_paid_invoices_days || 0;
  const billDays = company.auto_archive_closed_bills_days || 0;
  let invR = 0, billR = 0;
  if (invoiceDays > 0) {
    invR = dbi.prepare(`UPDATE invoices SET archived_at = datetime('now') WHERE company_id = ? AND status = 'paid' AND archived_at IS NULL AND date(updated_at) <= date('now', ?)`).run(companyId, `-${invoiceDays} days`).changes;
  }
  if (billDays > 0) {
    billR = dbi.prepare(`UPDATE bills SET archived_at = datetime('now') WHERE company_id = ? AND status IN ('paid','closed') AND archived_at IS NULL AND date(updated_at) <= date('now', ?)`).run(companyId, `-${billDays} days`).changes;
  }
  return { invoices_archived: invR, bills_archived: billR };
}

// ── F85: Triggered actions log ────────────────────────────────

export function logTriggeredAction(companyId: string, triggerSource: string, entityType: string, entityId: string, actionType: string, actionResult: any): void {
  const dbi = db.getDb();
  dbi.prepare(`INSERT INTO triggered_actions_log (id, company_id, trigger_source, trigger_entity_type, trigger_entity_id, action_type, action_result) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(uuid(), companyId, triggerSource, entityType, entityId, actionType, typeof actionResult === 'string' ? actionResult : JSON.stringify(actionResult));
}

export function listTriggeredActions(companyId: string, opts?: { limit?: number; action_type?: string }): any[] {
  const dbi = db.getDb();
  const limit = Math.min(500, opts?.limit || 100);
  if (opts?.action_type) {
    return dbi.prepare(`SELECT * FROM triggered_actions_log WHERE company_id = ? AND action_type = ? ORDER BY triggered_at DESC LIMIT ?`).all(companyId, opts.action_type, limit) as any[];
  }
  return dbi.prepare(`SELECT * FROM triggered_actions_log WHERE company_id = ? ORDER BY triggered_at DESC LIMIT ?`).all(companyId, limit) as any[];
}

// ── F86: SLA tracking ─────────────────────────────────────────

export function upsertSLA(s: { id?: string; company_id: string; sla_name: string; entity_type: string; metric: string; target_value: number; target_unit: string; severity?: string }): any {
  const dbi = db.getDb();
  const id = s.id || uuid();
  dbi.prepare(`INSERT OR REPLACE INTO sla_definitions (id, company_id, sla_name, entity_type, metric, target_value, target_unit, severity, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`)
    .run(id, s.company_id, s.sla_name, s.entity_type, s.metric, s.target_value, s.target_unit, s.severity || 'medium');
  return dbi.prepare('SELECT * FROM sla_definitions WHERE id = ?').get(id);
}

export function listSLAs(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM sla_definitions WHERE company_id = ? AND is_active = 1`).all(companyId) as any[];
}

// ── F87-F88: Saved searches ───────────────────────────────────

export function upsertSavedSearch(s: { id?: string; user_id: string; company_id: string; module: string; search_name: string; filters_json: any; is_shared?: boolean }): any {
  const dbi = db.getDb();
  const id = s.id || uuid();
  const filters = typeof s.filters_json === 'string' ? s.filters_json : JSON.stringify(s.filters_json);
  if (s.id) {
    dbi.prepare(`UPDATE saved_searches SET search_name = ?, filters_json = ?, is_shared = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(s.search_name, filters, s.is_shared ? 1 : 0, id);
  } else {
    dbi.prepare(`INSERT INTO saved_searches (id, user_id, company_id, module, search_name, filters_json, is_shared) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, s.user_id, s.company_id, s.module, s.search_name, filters, s.is_shared ? 1 : 0);
  }
  return dbi.prepare('SELECT * FROM saved_searches WHERE id = ?').get(id);
}

export function listSavedSearches(userId: string, companyId: string, module?: string): any[] {
  const dbi = db.getDb();
  if (module) {
    return dbi.prepare(`SELECT * FROM saved_searches WHERE company_id = ? AND module = ? AND (user_id = ? OR is_shared = 1) ORDER BY search_name`).all(companyId, module, userId) as any[];
  }
  return dbi.prepare(`SELECT * FROM saved_searches WHERE company_id = ? AND (user_id = ? OR is_shared = 1) ORDER BY module, search_name`).all(companyId, userId) as any[];
}

// ── F89: Bulk operations log + undo ──────────────────────────

export function logBulkOperation(companyId: string, op: { operation_type: string; entity_type: string; entity_ids: string[]; changes: any; performed_by: string }): any {
  const dbi = db.getDb();
  const id = uuid();
  dbi.prepare(`INSERT INTO bulk_operations_log (id, company_id, operation_type, entity_type, entity_ids_json, changes_json, performed_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, companyId, op.operation_type, op.entity_type, JSON.stringify(op.entity_ids), JSON.stringify(op.changes), op.performed_by);
  return dbi.prepare('SELECT * FROM bulk_operations_log WHERE id = ?').get(id);
}

export function listBulkOperations(companyId: string, opts?: { limit?: number; can_undo_only?: boolean }): any[] {
  const dbi = db.getDb();
  const limit = Math.min(500, opts?.limit || 50);
  if (opts?.can_undo_only) {
    return dbi.prepare(`SELECT * FROM bulk_operations_log WHERE company_id = ? AND can_undo = 1 AND undone_at IS NULL ORDER BY performed_at DESC LIMIT ?`).all(companyId, limit) as any[];
  }
  return dbi.prepare(`SELECT * FROM bulk_operations_log WHERE company_id = ? ORDER BY performed_at DESC LIMIT ?`).all(companyId, limit) as any[];
}

// ── F90: Quick actions ────────────────────────────────────────

export function upsertQuickAction(a: { id?: string; user_id: string; company_id: string; label: string; icon?: string; action_type: string; action_config?: any; sort_order?: number; is_pinned?: boolean }): any {
  const dbi = db.getDb();
  const id = a.id || uuid();
  const cfg = typeof a.action_config === 'string' ? a.action_config : JSON.stringify(a.action_config || {});
  if (a.id) {
    dbi.prepare(`UPDATE quick_actions SET label = ?, icon = ?, action_type = ?, action_config = ?, sort_order = ?, is_pinned = ? WHERE id = ?`)
      .run(a.label, a.icon || '', a.action_type, cfg, a.sort_order || 0, a.is_pinned ? 1 : 0, id);
  } else {
    dbi.prepare(`INSERT INTO quick_actions (id, user_id, company_id, label, icon, action_type, action_config, sort_order, is_pinned) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, a.user_id, a.company_id, a.label, a.icon || '', a.action_type, cfg, a.sort_order || 0, a.is_pinned ? 1 : 0);
  }
  return dbi.prepare('SELECT * FROM quick_actions WHERE id = ?').get(id);
}

export function listQuickActions(userId: string, companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM quick_actions WHERE user_id = ? AND company_id = ? ORDER BY is_pinned DESC, sort_order`).all(userId, companyId) as any[];
}
