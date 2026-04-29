import { v4 as uuid } from 'uuid';
import * as db from '../database';
import { eventBus, EventPayload } from './EventBus';

interface Condition {
  field: string;
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in' | 'exists';
  value: any;
}

interface Action {
  type: 'log_to_je' | 'send_notification' | 'update_field' | 'create_task' | 'webhook' | 'log_audit' | 'trigger_macro';
  config: Record<string, any>;
}

interface WorkflowDefinition {
  id: string;
  company_id: string;
  name: string;
  trigger_type: string;
  trigger_config_json: string;
  conditions_json: string;
  actions_json: string;
  is_active: number;
  rate_limit_per_hour: number;
}

class WorkflowEngine {
  private subscribed = false;

  start() {
    if (this.subscribed) return;
    this.subscribed = true;
    eventBus.onAny(async (payload) => {
      await this.handleEvent(payload);
    });
  }

  private async handleEvent(payload: EventPayload) {
    let workflows: WorkflowDefinition[] = [];
    try {
      workflows = db.getDb().prepare(
        `SELECT * FROM workflow_definitions WHERE company_id = ? AND is_active = 1 AND trigger_type = 'event'`
      ).all(payload.companyId) as WorkflowDefinition[];
    } catch (err) {
      console.warn('[WorkflowEngine] Failed to load workflows:', err);
      return;
    }

    for (const wf of workflows) {
      try {
        const triggerCfg = JSON.parse(wf.trigger_config_json || '{}');
        if (triggerCfg.event_type !== payload.type) continue;
        if (wf.rate_limit_per_hour > 0) {
          const recent = db.getDb().prepare(
            `SELECT COUNT(*) as c FROM workflow_executions WHERE workflow_id = ? AND triggered_at >= datetime('now', '-1 hour')`
          ).get(wf.id) as any;
          if (recent.c >= wf.rate_limit_per_hour) continue;
        }

        const conditions: Condition[] = JSON.parse(wf.conditions_json || '[]');
        const data = payload.data || {};
        const allMatch = conditions.every(c => evaluateCondition(c, data));
        if (!allMatch) continue;

        const actions: Action[] = JSON.parse(wf.actions_json || '[]');
        await this.executeWorkflow(wf, payload, actions);
      } catch (err) {
        console.warn(`[WorkflowEngine] Workflow ${wf.id} error:`, err);
      }
    }
  }

  private async executeWorkflow(wf: WorkflowDefinition, payload: EventPayload, actions: Action[]) {
    const execId = uuid();
    const startedAt = Date.now();
    db.getDb().prepare(
      `INSERT INTO workflow_executions (id, workflow_id, status, payload_json) VALUES (?, ?, 'running', ?)`
    ).run(execId, wf.id, JSON.stringify(payload));

    let status = 'success';
    let errorMsg = '';
    try {
      for (const action of actions) {
        await this.executeAction(action, payload);
      }
    } catch (err: any) {
      status = 'failed';
      errorMsg = err?.message || 'unknown error';
    }

    const duration = Date.now() - startedAt;
    db.getDb().prepare(
      `UPDATE workflow_executions SET status = ?, completed_at = datetime('now'), error_message = ?, duration_ms = ? WHERE id = ?`
    ).run(status, errorMsg, duration, execId);
  }

  private async executeAction(action: Action, payload: EventPayload) {
    switch (action.type) {
      case 'log_audit':
        break;
      case 'send_notification':
        try {
          db.getDb().prepare(
            `INSERT INTO notifications (id, company_id, type, message, entity_type, entity_id, read_status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, datetime('now'))`
          ).run(
            uuid(),
            payload.companyId,
            action.config.notification_type || 'info',
            action.config.message || `Workflow triggered by ${payload.type}`,
            payload.entityType || '',
            payload.entityId || ''
          );
        } catch {}
        break;
      case 'webhook':
        break;
      case 'trigger_macro':
        break;
      default:
        console.log(`[WorkflowEngine] Unknown action: ${action.type}`);
    }
  }
}

function evaluateCondition(cond: Condition, data: Record<string, any>): boolean {
  const fieldVal = data[cond.field];
  switch (cond.op) {
    case 'eq': return fieldVal === cond.value;
    case 'neq': return fieldVal !== cond.value;
    case 'gt': return Number(fieldVal) > Number(cond.value);
    case 'gte': return Number(fieldVal) >= Number(cond.value);
    case 'lt': return Number(fieldVal) < Number(cond.value);
    case 'lte': return Number(fieldVal) <= Number(cond.value);
    case 'contains': return String(fieldVal || '').includes(String(cond.value));
    case 'in': return Array.isArray(cond.value) && cond.value.includes(fieldVal);
    case 'exists': return fieldVal !== undefined && fieldVal !== null && fieldVal !== '';
    default: return false;
  }
}

export const workflowEngine = new WorkflowEngine();
