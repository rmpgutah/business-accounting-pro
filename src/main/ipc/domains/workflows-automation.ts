import type { IpcMain } from 'electron';
import { v4 as uuid } from 'uuid';
import Anthropic from '@anthropic-ai/sdk';
import * as db from '../../database';
import { eventBus } from '../../services/EventBus';
import type { IpcDeps } from '../core/types';

// ─── B3 AI Copilot — active stream registry ──────────────
const copilotStreams = new Map<string, AbortController>();

export function registerWorkflowsAutomationIpc(ipcMain: IpcMain, deps: IpcDeps): void {
  const { scheduleAutoBackup, scheduleReindex } = deps;

  // ── Automation registry (75 modules across 13 domains) ──────
  // NOTE: channel renamed from 'automations:list' to avoid a DUPLICATE
  // ipcMain.handle registration. The renderer's Automations module uses the
  // table-based 'automations:list' defined later (automation_rules CRUD);
  // registering this service-based one under the same channel threw
  // "Attempted to register a second handler", aborting ALL handler
  // registration after this point (e.g. accounts:stats). Renamed so the
  // service-based registry list stays available without colliding.
  ipcMain.handle('automations:registry-list', () => {
    try {
      const { listAutomations } = require('../automations');
      return listAutomations();
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  ipcMain.handle('automations:run', (_e, { id }: { id: string }) => {
    try {
      const { runAutomation } = require('../automations');
      return runAutomation(id, { companyId: db.getCurrentCompanyId() });
    } catch (err: any) {
      return { ok: false, affected: 0, detail: err?.message };
    }
  });
  ipcMain.handle('automations:run-trigger', (_e, { trigger }: { trigger: string }) => {
    try {
      const { runAutomationsByTrigger } = require('../automations');
      return runAutomationsByTrigger(trigger, { companyId: db.getCurrentCompanyId() });
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  // ─── Automation Rules ──────────────────────────────
  ipcMain.handle('automations:list', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return [];
    return db
      .getDb()
      .prepare(`SELECT * FROM automation_rules WHERE company_id = ? ORDER BY created_at DESC`)
      .all(companyId);
  });
  ipcMain.handle('automations:toggle', (_e, ruleId: string) => {
    db.getDb()
      .prepare(
        `UPDATE automation_rules SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?`,
      )
      .run(ruleId);
    scheduleAutoBackup();
  });
  ipcMain.handle('automations:run-log', (_e, ruleId: string) =>
    db
      .getDb()
      .prepare(`SELECT * FROM automation_run_log WHERE rule_id = ? ORDER BY ran_at DESC LIMIT 50`)
      .all(ruleId),
  );
  ipcMain.handle(
    'automations:create',
    (
      _e,
      rule: {
        name: string;
        trigger_type: string;
        trigger_config: string;
        conditions: string;
        actions: string;
      },
    ) => {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return { error: 'No active company' };
      try {
        const record = db.create('automation_rules', {
          name: rule.name,
          trigger_type: rule.trigger_type,
          trigger_config: rule.trigger_config || '{}',
          conditions: rule.conditions || '[]',
          actions: rule.actions || '[]',
          is_active: 1,
          company_id: companyId,
        });
        scheduleAutoBackup();
        return record;
      } catch (err: any) {
        return { error: err.message };
      }
    },
  );
  ipcMain.handle('automations:delete', (_e, ruleId: string) => {
    try {
      db.getDb().prepare(`DELETE FROM automation_rules WHERE id = ?`).run(ruleId);
      db.getDb().prepare(`DELETE FROM automation_run_log WHERE rule_id = ?`).run(ruleId);
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err.message };
    }
  });
  ipcMain.handle(
    'automations:update',
    (_e, { id, name, trigger_type, trigger_config, conditions, actions }: any) => {
      try {
        db.getDb()
          .prepare(
            `UPDATE automation_rules SET name=?, trigger_type=?, trigger_config=?, conditions=?, actions=? WHERE id=?`,
          )
          .run(name, trigger_type, trigger_config || '{}', conditions || '[]', actions || '[]', id);
        scheduleAutoBackup();
        return { ok: true };
      } catch (err: any) {
        return { error: err.message };
      }
    },
  );
  // ─── Rules Engine ────────────────────────────────────────
  ipcMain.handle(
    'rules:list',
    (_event, { company_id, category }: { company_id: string; category?: string }) => {
      let sql = `SELECT * FROM rules WHERE company_id = ?`;
      const params: unknown[] = [company_id];
      if (category) {
        sql += ` AND category = ?`;
        params.push(category);
      }
      sql += ` ORDER BY priority ASC`;
      return db
        .getDb()
        .prepare(sql)
        .all(...params);
    },
  );
  ipcMain.handle('rules:create', (_event, data: Record<string, unknown>) => {
    try {
      const id = uuid();
      const row = { id, ...data, created_at: new Date().toISOString() };
      db.getDb()
        .prepare(
          `
        INSERT INTO rules (id, company_id, category, name, priority, is_active, trigger, conditions, actions, created_at)
        VALUES (@id, @company_id, @category, @name, @priority, @is_active, @trigger, @conditions, @actions, @created_at)
      `,
        )
        .run(row);
      scheduleAutoBackup();
      return { id };
    } catch (err: any) {
      return { error: err?.message || 'Failed to create rule' };
    }
  });
  ipcMain.handle(
    'rules:update',
    (_event, { id, data }: { id: string; data: Record<string, unknown> }) => {
      try {
        // Validate column names to prevent SQL injection
        const allowedColumns = new Set([
          'category',
          'name',
          'priority',
          'is_active',
          'trigger',
          'conditions',
          'actions',
          'company_id',
          'description',
          'updated_at',
        ]);
        const safeKeys = Object.keys(data).filter((k) => allowedColumns.has(k));
        if (safeKeys.length === 0) return { error: 'No valid fields to update' };
        const sets = safeKeys.map((k) => `${k} = @${k}`).join(', ');
        const updateData: Record<string, unknown> = {};
        for (const k of safeKeys) updateData[k] = data[k];
        db.getDb()
          .prepare(`UPDATE rules SET ${sets} WHERE id = @id`)
          .run({ ...updateData, id });
        scheduleAutoBackup();
        return { ok: true };
      } catch (err: any) {
        return { error: err?.message || 'Failed to update rule' };
      }
    },
  );
  ipcMain.handle('rules:delete', (_event, id: string) => {
    try {
      db.getDb().prepare(`DELETE FROM rules WHERE id = ?`).run(id);
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message || 'Failed to delete rule' };
    }
  });
  // ═══════════════════════════════════════════════════════════════════════
  // Workflow + Numbering + Email Templates (2026-04-23)
  // Features 1–30 — see CLAUDE.md domain spec
  // ═══════════════════════════════════════════════════════════════════════

  const ENTITY_TYPES = [
    'invoice',
    'quote',
    'expense',
    'bill',
    'debt',
    'project',
    'purchase_order',
    'journal_entry',
  ];
  const DEFAULT_STATUSES: Record<
    string,
    Array<{
      key: string;
      label: string;
      color: string;
      icon: string;
      sort_order: number;
      is_terminal?: number;
    }>
  > = {
    invoice: [
      { key: 'draft', label: 'Draft', color: '#9ca3af', icon: 'FileEdit', sort_order: 0 },
      { key: 'sent', label: 'Sent', color: '#3b82f6', icon: 'Send', sort_order: 1 },
      { key: 'partial', label: 'Partial', color: '#f59e0b', icon: 'PieChart', sort_order: 2 },
      {
        key: 'paid',
        label: 'Paid',
        color: '#10b981',
        icon: 'CheckCircle2',
        sort_order: 3,
        is_terminal: 1,
      },
      { key: 'overdue', label: 'Overdue', color: '#ef4444', icon: 'AlertCircle', sort_order: 4 },
      { key: 'void', label: 'Void', color: '#6b7280', icon: 'Ban', sort_order: 5, is_terminal: 1 },
    ],
    quote: [
      { key: 'draft', label: 'Draft', color: '#9ca3af', icon: 'FileEdit', sort_order: 0 },
      { key: 'sent', label: 'Sent', color: '#3b82f6', icon: 'Send', sort_order: 1 },
      {
        key: 'accepted',
        label: 'Accepted',
        color: '#10b981',
        icon: 'CheckCircle2',
        sort_order: 2,
        is_terminal: 1,
      },
      {
        key: 'declined',
        label: 'Declined',
        color: '#ef4444',
        icon: 'XCircle',
        sort_order: 3,
        is_terminal: 1,
      },
      {
        key: 'expired',
        label: 'Expired',
        color: '#6b7280',
        icon: 'Clock',
        sort_order: 4,
        is_terminal: 1,
      },
    ],
    expense: [
      { key: 'draft', label: 'Draft', color: '#9ca3af', icon: 'FileEdit', sort_order: 0 },
      { key: 'submitted', label: 'Submitted', color: '#3b82f6', icon: 'Send', sort_order: 1 },
      { key: 'approved', label: 'Approved', color: '#10b981', icon: 'CheckCircle2', sort_order: 2 },
      {
        key: 'reimbursed',
        label: 'Reimbursed',
        color: '#8b5cf6',
        icon: 'DollarSign',
        sort_order: 3,
        is_terminal: 1,
      },
      {
        key: 'rejected',
        label: 'Rejected',
        color: '#ef4444',
        icon: 'XCircle',
        sort_order: 4,
        is_terminal: 1,
      },
    ],
    bill: [
      { key: 'draft', label: 'Draft', color: '#9ca3af', icon: 'FileEdit', sort_order: 0 },
      { key: 'received', label: 'Received', color: '#3b82f6', icon: 'Inbox', sort_order: 1 },
      { key: 'approved', label: 'Approved', color: '#06b6d4', icon: 'CheckCircle2', sort_order: 2 },
      {
        key: 'paid',
        label: 'Paid',
        color: '#10b981',
        icon: 'DollarSign',
        sort_order: 3,
        is_terminal: 1,
      },
      { key: 'void', label: 'Void', color: '#6b7280', icon: 'Ban', sort_order: 4, is_terminal: 1 },
    ],
    debt: [
      { key: 'new', label: 'New', color: '#9ca3af', icon: 'AlertCircle', sort_order: 0 },
      {
        key: 'in_collection',
        label: 'In Collection',
        color: '#f59e0b',
        icon: 'Phone',
        sort_order: 1,
      },
      { key: 'promise', label: 'Promise', color: '#3b82f6', icon: 'HandCoins', sort_order: 2 },
      {
        key: 'paid',
        label: 'Paid',
        color: '#10b981',
        icon: 'CheckCircle2',
        sort_order: 3,
        is_terminal: 1,
      },
      {
        key: 'written_off',
        label: 'Written Off',
        color: '#6b7280',
        icon: 'Ban',
        sort_order: 4,
        is_terminal: 1,
      },
    ],
    project: [
      {
        key: 'planning',
        label: 'Planning',
        color: '#9ca3af',
        icon: 'ClipboardList',
        sort_order: 0,
      },
      { key: 'active', label: 'Active', color: '#3b82f6', icon: 'Activity', sort_order: 1 },
      { key: 'on_hold', label: 'On Hold', color: '#f59e0b', icon: 'Pause', sort_order: 2 },
      {
        key: 'completed',
        label: 'Completed',
        color: '#10b981',
        icon: 'CheckCircle2',
        sort_order: 3,
        is_terminal: 1,
      },
      {
        key: 'cancelled',
        label: 'Cancelled',
        color: '#6b7280',
        icon: 'Ban',
        sort_order: 4,
        is_terminal: 1,
      },
    ],
    purchase_order: [
      { key: 'draft', label: 'Draft', color: '#9ca3af', icon: 'FileEdit', sort_order: 0 },
      { key: 'sent', label: 'Sent', color: '#3b82f6', icon: 'Send', sort_order: 1 },
      {
        key: 'received',
        label: 'Received',
        color: '#10b981',
        icon: 'Package',
        sort_order: 2,
        is_terminal: 1,
      },
      {
        key: 'cancelled',
        label: 'Cancelled',
        color: '#6b7280',
        icon: 'Ban',
        sort_order: 3,
        is_terminal: 1,
      },
    ],
    journal_entry: [
      { key: 'draft', label: 'Draft', color: '#9ca3af', icon: 'FileEdit', sort_order: 0 },
      {
        key: 'posted',
        label: 'Posted',
        color: '#10b981',
        icon: 'CheckCircle2',
        sort_order: 1,
        is_terminal: 1,
      },
      {
        key: 'reversed',
        label: 'Reversed',
        color: '#ef4444',
        icon: 'Undo2',
        sort_order: 2,
        is_terminal: 1,
      },
    ],
  };
  function ensureDefaultStatuses(companyId: string) {
    for (const entityType of ENTITY_TYPES) {
      const existing = db
        .getDb()
        .prepare(
          `SELECT COUNT(*) AS c FROM custom_statuses WHERE company_id = ? AND entity_type = ?`,
        )
        .get(companyId, entityType) as any;
      if (existing?.c) continue;
      for (const s of DEFAULT_STATUSES[entityType] || []) {
        db.getDb()
          .prepare(
            `INSERT INTO custom_statuses (id, company_id, entity_type, key, label, color, icon, sort_order, is_terminal)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          )
          .run(
            uuid(),
            companyId,
            entityType,
            s.key,
            s.label,
            s.color,
            s.icon,
            s.sort_order,
            s.is_terminal || 0,
          );
      }
    }
  }
  ipcMain.handle('workflow:statuses-list', (_e, { companyId, entityType }: any) => {
    try {
      ensureDefaultStatuses(companyId);
      const rows = db
        .getDb()
        .prepare(
          `SELECT * FROM custom_statuses WHERE company_id = ? ${entityType ? 'AND entity_type = ?' : ''} ORDER BY entity_type, sort_order`,
        )
        .all(...(entityType ? [companyId, entityType] : [companyId]));
      return rows;
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  ipcMain.handle('workflow:transitions-list', (_e, { companyId, entityType }: any) => {
    try {
      const rows = db
        .getDb()
        .prepare(
          `SELECT * FROM status_transitions WHERE company_id = ? ${entityType ? 'AND entity_type = ?' : ''}`,
        )
        .all(...(entityType ? [companyId, entityType] : [companyId]));
      return rows;
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  ipcMain.handle(
    'workflow:transition-validate',
    (_e, { companyId, entityType, fromStatus, toStatus }: any) => {
      try {
        const transitions = db
          .getDb()
          .prepare(`SELECT * FROM status_transitions WHERE company_id = ? AND entity_type = ?`)
          .all(companyId, entityType) as any[];
        if (transitions.length === 0) return { allowed: true };
        const match = transitions.find(
          (t: any) => t.from_status === fromStatus && t.to_status === toStatus,
        );
        if (!match)
          return { allowed: false, reason: `Transition ${fromStatus} → ${toStatus} not allowed` };
        return {
          allowed: true,
          requiresComment: !!match.requires_comment,
          requiresApproval: !!match.requires_approval,
          requiresRole: match.requires_role || '',
        };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );
  ipcMain.handle('workflow:status-history', (_e, { companyId, entityType, entityId }: any) => {
    try {
      return db
        .getDb()
        .prepare(
          `SELECT * FROM entity_status_history WHERE company_id = ? AND entity_type = ? AND entity_id = ? ORDER BY changed_at DESC`,
        )
        .all(companyId, entityType, entityId);
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  ipcMain.handle(
    'workflow:status-change',
    (_e, { companyId, entityType, entityId, fromStatus, toStatus, comment, changedBy }: any) => {
      try {
        const trans = db
          .getDb()
          .prepare(`SELECT * FROM status_transitions WHERE company_id = ? AND entity_type = ?`)
          .all(companyId, entityType) as any[];
        if (trans.length > 0) {
          const match = trans.find(
            (t: any) => t.from_status === fromStatus && t.to_status === toStatus,
          );
          if (!match) return { error: `Transition ${fromStatus} → ${toStatus} not allowed` };
          if (match.requires_comment && !(comment || '').trim())
            return { error: 'Comment required for this transition' };
        }
        db.getDb()
          .prepare(
            `INSERT INTO entity_status_history (id, company_id, entity_type, entity_id, from_status, to_status, changed_by, comment)
         VALUES (?,?,?,?,?,?,?,?)`,
          )
          .run(
            uuid(),
            companyId,
            entityType,
            entityId,
            fromStatus || '',
            toStatus,
            changedBy || '',
            comment || '',
          );
        const status = db
          .getDb()
          .prepare(
            `SELECT notify_users FROM custom_statuses WHERE company_id = ? AND entity_type = ? AND key = ?`,
          )
          .get(companyId, entityType, toStatus) as any;
        if (status?.notify_users) {
          const users = String(status.notify_users)
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean);
          for (const u of users) {
            try {
              db.create('notifications', {
                company_id: companyId,
                user_id: u,
                type: 'status_change',
                title: `${entityType} status → ${toStatus}`,
                message: `${entityType} ${entityId} moved to ${toStatus}${comment ? ': ' + comment : ''}`,
                link: `/${entityType}s/${entityId}`,
              });
            } catch {}
          }
        }
        scheduleAutoBackup();
        return { ok: true };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );
  ipcMain.handle(
    'workflow:bulk-status-change',
    (_e, { companyId, entityType, entityIds, toStatus, comment, changedBy }: any) => {
      try {
        let success = 0;
        const errors: any[] = [];
        for (const id of entityIds) {
          try {
            let from = '';
            try {
              const tableName =
                entityType === 'journal_entry' ? 'journal_entries' : entityType + 's';
              const row = db
                .getDb()
                .prepare(`SELECT status FROM ${tableName} WHERE id = ?`)
                .get(id) as any;
              from = row?.status || '';
            } catch {}
            db.getDb()
              .prepare(
                `INSERT INTO entity_status_history (id, company_id, entity_type, entity_id, from_status, to_status, changed_by, comment)
             VALUES (?,?,?,?,?,?,?,?)`,
              )
              .run(
                uuid(),
                companyId,
                entityType,
                id,
                from,
                toStatus,
                changedBy || '',
                comment || '',
              );
            success++;
          } catch (e: any) {
            errors.push({ id, error: e?.message });
          }
        }
        if (success > 0) scheduleAutoBackup();
        return { ok: true, success, errors };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );
  // ─── Advanced System (2026-04-28) — Cognitive Command Layer IPC ────────
  ipcMain.handle('command:list', () => {
    const { commandRegistry } = require('../../services/CommandRegistry');
    return commandRegistry.all().map((c: any) => ({
      id: c.id,
      module: c.module,
      label: c.label,
      description: c.description,
      keywords: c.keywords,
      params: c.params,
      scope: c.scope,
    }));
  });
  ipcMain.handle('command:search', (_event, { query }: { query: string }) => {
    const { commandRegistry } = require('../../services/CommandRegistry');
    return commandRegistry.search(query).map((c: any) => ({
      id: c.id,
      module: c.module,
      label: c.label,
      description: c.description,
      keywords: c.keywords,
    }));
  });
  ipcMain.handle(
    'command:log-execution',
    (_event, { user_id, command_id, params, result, duration_ms }: any) => {
      const dbI = db.getDb();
      dbI
        .prepare(
          `INSERT INTO command_history (id, user_id, command_id, params_json, result, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          uuid(),
          user_id || 'anon',
          command_id,
          JSON.stringify(params || {}),
          result || 'success',
          duration_ms || 0,
        );
      return { success: true };
    },
  );
  ipcMain.handle(
    'command:history',
    (_event, { user_id, limit }: { user_id?: string; limit?: number }) => {
      const dbI = db.getDb();
      return dbI
        .prepare(
          `SELECT * FROM command_history WHERE user_id = ? ORDER BY executed_at DESC LIMIT ?`,
        )
        .all(user_id || 'anon', limit || 50);
    },
  );
  ipcMain.handle(
    'command:frequent',
    (_event, { user_id, limit }: { user_id?: string; limit?: number }) => {
      const dbI = db.getDb();
      return dbI
        .prepare(
          `SELECT command_id, COUNT(*) as count FROM command_history
       WHERE user_id = ? AND executed_at >= date('now', '-30 days')
       GROUP BY command_id ORDER BY count DESC LIMIT ?`,
        )
        .all(user_id || 'anon', limit || 10);
    },
  );
  // ─── Reactive Engine — Workflow Definitions, Executions, Events ────────
  ipcMain.handle('workflow:list', () => {
    const companyId = db.getCurrentCompanyId();
    return db
      .getDb()
      .prepare(`SELECT * FROM workflow_definitions WHERE company_id = ? ORDER BY name`)
      .all(companyId);
  });
  ipcMain.handle(
    'workflow:save',
    (
      _event,
      {
        id,
        name,
        description,
        trigger_type,
        trigger_config,
        conditions,
        actions,
        is_active,
        rate_limit_per_hour,
        requires_approval,
      }: any,
    ) => {
      const companyId = db.getCurrentCompanyId();
      const dbI = db.getDb();
      if (id) {
        dbI
          .prepare(
            `UPDATE workflow_definitions SET name = ?, description = ?, trigger_type = ?, trigger_config_json = ?, conditions_json = ?, actions_json = ?, is_active = ?, rate_limit_per_hour = ?, requires_approval = ?, updated_at = datetime('now') WHERE id = ?`,
          )
          .run(
            name || '',
            description || '',
            trigger_type || 'event',
            JSON.stringify(trigger_config || {}),
            JSON.stringify(conditions || []),
            JSON.stringify(actions || []),
            is_active ? 1 : 0,
            rate_limit_per_hour || 0,
            requires_approval ? 1 : 0,
            id,
          );
        scheduleAutoBackup();
        return { success: true, id };
      }
      const newId = uuid();
      dbI
        .prepare(
          `INSERT INTO workflow_definitions (id, company_id, name, description, trigger_type, trigger_config_json, conditions_json, actions_json, is_active, rate_limit_per_hour, requires_approval) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          newId,
          companyId,
          name || '',
          description || '',
          trigger_type || 'event',
          JSON.stringify(trigger_config || {}),
          JSON.stringify(conditions || []),
          JSON.stringify(actions || []),
          is_active ? 1 : 0,
          rate_limit_per_hour || 0,
          requires_approval ? 1 : 0,
        );
      scheduleAutoBackup();
      return { success: true, id: newId };
    },
  );
  ipcMain.handle('workflow:delete', (_event, { id }: { id: string }) => {
    db.getDb().prepare(`DELETE FROM workflow_definitions WHERE id = ?`).run(id);
    scheduleAutoBackup();
    return { success: true };
  });
  ipcMain.handle(
    'workflow:executions',
    (_event, { workflowId, limit }: { workflowId?: string; limit?: number }) => {
      const dbI = db.getDb();
      if (workflowId) {
        return dbI
          .prepare(
            `SELECT * FROM workflow_executions WHERE workflow_id = ? ORDER BY triggered_at DESC LIMIT ?`,
          )
          .all(workflowId, limit || 50);
      }
      const companyId = db.getCurrentCompanyId();
      return dbI
        .prepare(
          `SELECT we.* FROM workflow_executions we
       JOIN workflow_definitions wd ON wd.id = we.workflow_id
       WHERE wd.company_id = ? ORDER BY we.triggered_at DESC LIMIT ?`,
        )
        .all(companyId, limit || 50);
    },
  );
  ipcMain.handle('workflow:event-log', (_event, { limit }: { limit?: number }) => {
    const companyId = db.getCurrentCompanyId();
    return db
      .getDb()
      .prepare(
        `SELECT * FROM workflow_event_log WHERE company_id = ? ORDER BY occurred_at DESC LIMIT ?`,
      )
      .all(companyId, limit || 100);
  });
  ipcMain.handle(
    'workflow:emit-event',
    async (_event, { type, entityType, entityId, data }: any) => {
      const companyId = db.getCurrentCompanyId();
      await eventBus.emit({ type, companyId: companyId || '', entityType, entityId, data });
      return { success: true };
    },
  );
  // ─── Predictive Intelligence Layer ──────────────────────
  ipcMain.handle('intel:suggest-category', (_event, { vendor_id }: { vendor_id: string }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId || !vendor_id) return null;
    const { intelligenceService } = require('../../services/IntelligenceService');
    return intelligenceService.suggestCategory(companyId, vendor_id);
  });
  ipcMain.handle('intel:duplicate-invoices', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return [];
    const { intelligenceService } = require('../../services/IntelligenceService');
    return intelligenceService.detectDuplicateInvoices(companyId);
  });
  ipcMain.handle('intel:payroll-anomaly', (_event, { employee_id, gross }: any) => {
    const { intelligenceService } = require('../../services/IntelligenceService');
    return intelligenceService.detectPayrollAnomaly(employee_id, gross);
  });
  ipcMain.handle('intel:cash-forecast', (_event, { days_ahead }: { days_ahead: number }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    const { intelligenceService } = require('../../services/IntelligenceService');
    return intelligenceService.forecastCashFlow(companyId, days_ahead || 30);
  });
  ipcMain.handle('intel:predict-payment', (_event, { invoice_id }: { invoice_id: string }) => {
    const { intelligenceService } = require('../../services/IntelligenceService');
    return intelligenceService.predictPaymentDate(invoice_id);
  });
  ipcMain.handle('intel:refresh-patterns', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { success: false };
    const { intelligenceService } = require('../../services/IntelligenceService');
    intelligenceService.refreshPatterns(companyId);
    return { success: true };
  });
  ipcMain.handle('intel:list-anomalies', () => {
    const companyId = db.getCurrentCompanyId();
    return db
      .getDb()
      .prepare(
        `SELECT * FROM anomaly_log WHERE company_id = ? AND resolved = 0 ORDER BY detected_at DESC LIMIT 100`,
      )
      .all(companyId);
  });
  // ─── System-Wide Waves 1-3 (SW1–SW150) ──────────────────
  const sw1 = () => require('../../services/system-wide-wave1');
  const sw2 = () => require('../../services/system-wide-wave2');
  const sw3 = () => require('../../services/system-wide-wave3');
  // Clients (SW1-10)
  ipcMain.handle('sw:client-dashboard', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().clientDashboard(c) : {};
  });
  ipcMain.handle('sw:client-revenue-ranking', (_e, { limit }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().clientRevenueRanking(c, limit) : [];
  });
  ipcMain.handle('sw:client-retention', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().clientRetentionRate(c) : {};
  });
  ipcMain.handle('sw:client-acquisition', (_e, { months }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().clientAcquisitionByMonth(c, months) : [];
  });
  ipcMain.handle('sw:clients-by-type', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().clientsByType(c) : [];
  });
  ipcMain.handle('sw:client-contacts', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().clientContactsList(c) : [];
  });
  ipcMain.handle('sw:clients-no-invoices', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().clientsWithoutInvoices(c) : [];
  });
  ipcMain.handle('sw:client-geography', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().clientGeography(c) : [];
  });
  ipcMain.handle('sw:top-clients-expenses', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().topClientsByExpenses(c) : [];
  });
  ipcMain.handle('sw:client-comms', (_e, { clientId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().clientCommunicationLog(c, clientId) : [];
  });
  // Projects (SW11-20)
  ipcMain.handle('sw:project-dashboard', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().projectDashboard(c) : {};
  });
  ipcMain.handle('sw:project-profitability', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().projectProfitability(c) : [];
  });
  ipcMain.handle('sw:project-time', (_e, { projectId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().projectTimeTracking(c, projectId) : [];
  });
  ipcMain.handle('sw:project-time-summary', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().projectTimeSummary(c) : [];
  });
  ipcMain.handle('sw:project-burn', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().projectBudgetBurnRate(c) : [];
  });
  ipcMain.handle('sw:projects-by-client', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().projectsByClient(c) : [];
  });
  ipcMain.handle('sw:project-milestones', (_e, { projectId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().projectMilestones(c, projectId) : [];
  });
  ipcMain.handle('sw:over-budget-projects', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().overBudgetProjects(c) : [];
  });
  ipcMain.handle('sw:project-status', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().projectStatusBreakdown(c) : [];
  });
  ipcMain.handle('sw:project-activity', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().recentProjectActivity(c) : [];
  });
  // Inventory (SW21-30)
  ipcMain.handle('sw:inventory-dashboard', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().inventoryDashboard(c) : {};
  });
  ipcMain.handle('sw:low-stock', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().lowStockItems(c) : [];
  });
  ipcMain.handle('sw:inventory-valuation', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().inventoryValuation(c) : [];
  });
  ipcMain.handle('sw:inventory-movements', (_e, { itemId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().inventoryMovementHistory(c, itemId) : [];
  });
  ipcMain.handle('sw:inventory-turnover', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().inventoryTurnoverRate(c) : {};
  });
  ipcMain.handle('sw:inventory-by-category', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().inventoryByCategory(c) : [];
  });
  ipcMain.handle('sw:reorder-suggestions', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().reorderSuggestions(c) : [];
  });
  ipcMain.handle('sw:inventory-aging', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().inventoryAging(c) : [];
  });
  ipcMain.handle('sw:inventory-search', (_e, { query }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().inventorySearch(c, query) : [];
  });
  ipcMain.handle('sw:inventory-value-trend', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().inventoryValueTrend(c) : [];
  });
  // Bills/AP (SW31-40)
  ipcMain.handle('sw:bills-dashboard', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().billsDashboard(c) : {};
  });
  ipcMain.handle('sw:bills-by-vendor', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().billsByVendor(c) : [];
  });
  ipcMain.handle('sw:bills-aging', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().billsAging(c) : [];
  });
  ipcMain.handle('sw:upcoming-bills', (_e, { days }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().upcomingBillsDue(c, days) : [];
  });
  ipcMain.handle('sw:bill-payments', (_e, { billId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().billPaymentHistory(c, billId) : [];
  });
  ipcMain.handle('sw:cash-outflow-forecast', (_e, { weeks }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().cashOutflowForecast(c, weeks) : [];
  });
  ipcMain.handle('sw:bills-monthly', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().billsMonthlyTrend(c) : [];
  });
  ipcMain.handle('sw:recurring-bills', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().recurringBills(c) : [];
  });
  ipcMain.handle('sw:bills-search', (_e, { query }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().billsSearch(c, query) : [];
  });
  ipcMain.handle('sw:ap-vs-ar', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().apVsArSummary(c) : {};
  });
  // Bank/Settings (SW41-50)
  ipcMain.handle('sw:bank-recon-summary', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().bankReconciliationSummary(c) : {};
  });
  ipcMain.handle('sw:unmatched-txns', (_e, { limit }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().unmatchedTransactions(c, limit) : [];
  });
  ipcMain.handle('sw:bank-balance-history', (_e, { accountId }: any) =>
    sw1().bankBalanceHistory('', accountId),
  );
  ipcMain.handle('sw:txns-by-category', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().transactionsByCategory(c) : [];
  });
  ipcMain.handle('sw:recon-progress', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().reconciliationProgress(c) : {};
  });
  ipcMain.handle('sw:settings-list', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().listSettings(c) : [];
  });
  ipcMain.handle('sw:setting-get', (_e, { key }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().getSetting(c, key) : null;
  });
  ipcMain.handle('sw:setting-set', (_e, { key, value }: any) => {
    const c = db.getCurrentCompanyId();
    if (c) sw1().setSetting(c, key, value);
    return { ok: true };
  });
  ipcMain.handle('sw:company-profile', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().companyProfile(c) : null;
  });
  ipcMain.handle('sw:system-health', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw1().systemHealthCheck(c) : {};
  });
  // Fixed Assets (SW51-60)
  ipcMain.handle('sw:asset-dashboard', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().assetDashboard(c) : {};
  });
  ipcMain.handle('sw:assets-by-category', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().assetsByCategory(c) : [];
  });
  ipcMain.handle('sw:assets-depreciation', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().assetsNeedingDepreciation(c) : [];
  });
  ipcMain.handle('sw:asset-depreciation-schedule', (_e, { assetId }: any) =>
    sw2().assetDepreciationSchedule(assetId),
  );
  ipcMain.handle('sw:assets-warranty', (_e, { days }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().assetsExpiringWarranty(c, days) : [];
  });
  ipcMain.handle('sw:asset-insurance', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().assetInsuranceSummary(c) : [];
  });
  ipcMain.handle('sw:recent-disposals', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().recentAssetDisposals(c) : [];
  });
  ipcMain.handle('sw:asset-search', (_e, { query }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().assetSearch(c, query) : [];
  });
  ipcMain.handle('sw:total-asset-value', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().totalAssetValue(c) : {};
  });
  ipcMain.handle('sw:assets-by-location', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().assetsByLocation(c) : [];
  });
  // Budgets (SW61-70)
  ipcMain.handle('sw:budget-dashboard', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().budgetDashboard(c) : {};
  });
  ipcMain.handle('sw:budget-vs-actual', (_e, { budgetId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().budgetVsActual(c, budgetId) : [];
  });
  ipcMain.handle('sw:budget-utilization', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().budgetUtilization(c) : [];
  });
  ipcMain.handle('sw:over-budget-categories', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().categoriesOverBudget(c) : [];
  });
  ipcMain.handle('sw:budget-forecast', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().budgetForecast(c) : {};
  });
  ipcMain.handle('sw:budgets-list', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().listBudgets(c) : [];
  });
  ipcMain.handle('sw:budget-lines', (_e, { budgetId }: any) => sw2().budgetLineDetails(budgetId));
  ipcMain.handle('sw:budget-create', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().createBudget(c, p) : {};
  });
  ipcMain.handle('sw:budget-line-add', (_e, { budgetId, ...line }: any) =>
    sw2().addBudgetLine(budgetId, line),
  );
  ipcMain.handle('sw:budget-line-delete', (_e, { id }: any) => {
    sw2().deleteBudgetLine(id);
    return { ok: true };
  });
  // Documents/Email (SW71-80)
  ipcMain.handle('sw:doc-dashboard', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().documentDashboard(c) : {};
  });
  ipcMain.handle('sw:doc-search', (_e, { query }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().documentSearch(c, query) : [];
  });
  ipcMain.handle('sw:docs-by-entity', (_e, { entityType, entityId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().documentsByEntity(c, entityType, entityId) : [];
  });
  ipcMain.handle('sw:recent-docs', (_e, { limit }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().recentDocuments(c, limit) : [];
  });
  ipcMain.handle('sw:email-dashboard', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().emailLogDashboard(c) : {};
  });
  ipcMain.handle('sw:email-history', (_e, { limit }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().emailHistory(c, limit) : [];
  });
  ipcMain.handle('sw:email-by-recipient', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().emailByRecipient(c) : [];
  });
  ipcMain.handle('sw:notification-stats', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().notificationStats(c) : {};
  });
  ipcMain.handle('sw:audit-summary', (_e, { days }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().auditLogSummary(c, days) : [];
  });
  ipcMain.handle('sw:audit-search', (_e, { query }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().auditLogSearch(c, query) : [];
  });
  // Time/Quotes (SW81-90)
  ipcMain.handle('sw:time-dashboard', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().timeTrackingDashboard(c) : {};
  });
  ipcMain.handle('sw:time-by-employee', (_e, opts: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().timeByEmployee(c, opts.startDate, opts.endDate) : [];
  });
  ipcMain.handle('sw:time-by-project', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().timeByProject(c) : [];
  });
  ipcMain.handle('sw:unbilled-time', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().unbilledTime(c) : [];
  });
  ipcMain.handle('sw:weekly-time', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().weeklyTimeReport(c) : [];
  });
  ipcMain.handle('sw:quotes-dashboard', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().quotesDashboard(c) : {};
  });
  ipcMain.handle('sw:quotes-by-status', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().quotesByStatus(c) : [];
  });
  ipcMain.handle('sw:quote-funnel', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().quoteConversionFunnel(c) : {};
  });
  ipcMain.handle('sw:top-quotes', (_e, { limit }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().topQuotesByValue(c, limit) : [];
  });
  ipcMain.handle('sw:expired-quotes', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().expiredQuotes(c) : [];
  });
  // Automations/Cross (SW91-100)
  ipcMain.handle('sw:automations-dashboard', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().automationsDashboard(c) : {};
  });
  ipcMain.handle('sw:rule-history', (_e, { limit }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().ruleExecutionHistory(c, limit) : [];
  });
  ipcMain.handle('sw:cross-module-summary', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().crossModuleSummary(c) : {};
  });
  ipcMain.handle('sw:recent-activity', (_e, { limit }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().recentSystemActivity(c, limit) : [];
  });
  ipcMain.handle('sw:cash-flow-summary', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().cashFlowSummary(c) : {};
  });
  ipcMain.handle('sw:tax-summary-ytd', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().taxSummaryYTD(c) : {};
  });
  ipcMain.handle('sw:upcoming-deadlines', (_e, { days }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().upcomingDeadlines(c, days) : [];
  });
  ipcMain.handle('sw:global-search-v2', (_e, { query }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().globalSearch(c, query) : [];
  });
  ipcMain.handle('sw:data-integrity', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw2().dataIntegrityCheck(c) : {};
  });
  ipcMain.handle('sw:full-system-report', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().fullSystemReport(c) : {};
  });
  // Tax (SW101-110)
  ipcMain.handle('sw:tax-dashboard', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().taxDashboard(c) : {};
  });
  ipcMain.handle('sw:tax-payments', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().taxPaymentHistory(c) : [];
  });
  ipcMain.handle('sw:tax-categories', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().taxCategorySummary(c) : [];
  });
  ipcMain.handle('sw:sales-tax-liability', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().salesTaxLiability(c) : {};
  });
  ipcMain.handle('sw:deductible-summary', (_e, { year }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().deductibleExpensesSummary(c, year) : [];
  });
  ipcMain.handle('sw:estimated-tax', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().estimatedTaxQuarterly(c) : {};
  });
  ipcMain.handle('sw:1099-summary', (_e, { year }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().form1099Summary(c, year) : [];
  });
  ipcMain.handle('sw:payroll-tax-ytd', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().payrollTaxSummaryYTD(c) : {};
  });
  ipcMain.handle('sw:tax-calendar', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().taxCalendar(c) : [];
  });
  ipcMain.handle('sw:tax-rates', (_e, { state }: any = {}) => sw3().taxRateLookup(state));
  // PO (SW111-120)
  ipcMain.handle('sw:po-dashboard', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().purchaseOrderDashboard(c) : {};
  });
  ipcMain.handle('sw:po-by-vendor', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().poByVendor(c) : [];
  });
  ipcMain.handle('sw:po-by-status', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().poByStatus(c) : [];
  });
  ipcMain.handle('sw:overdue-pos', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().overduePOs(c) : [];
  });
  ipcMain.handle('sw:po-search', (_e, { query }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().poSearch(c, query) : [];
  });
  ipcMain.handle('sw:po-monthly', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().poMonthlyTrend(c) : [];
  });
  ipcMain.handle('sw:po-lines', (_e, { poId }: any) => sw3().poLineItems(poId));
  ipcMain.handle('sw:po-receiving', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().poReceivingHistory(c) : [];
  });
  ipcMain.handle('sw:po-to-bill', (_e, { poId }: any) => sw3().convertPOToBill(poId));
  ipcMain.handle('sw:po-approval-status', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().poApprovalStatus(c) : [];
  });
  // KPI (SW121-130)
  ipcMain.handle('sw:kpi-overview', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().kpiOverview(c) : {};
  });
  ipcMain.handle('sw:rev-vs-exp-trend', (_e, { months }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().revenueVsExpenseTrend(c, months) : [];
  });
  ipcMain.handle('sw:profit-margin-trend', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().profitMarginTrend(c) : [];
  });
  ipcMain.handle('sw:operating-metrics', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().operatingMetrics(c) : {};
  });
  ipcMain.handle('sw:quick-ratios', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().quickRatios(c) : {};
  });
  ipcMain.handle('sw:mom-growth', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().monthOverMonthGrowth(c) : {};
  });
  ipcMain.handle('sw:burn-rate', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().burnRate(c) : {};
  });
  ipcMain.handle('sw:revenue-by-service', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().revenueByService(c) : [];
  });
  ipcMain.handle('sw:top-expense-cats', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().topExpenseCategories(c) : [];
  });
  ipcMain.handle('sw:financial-snapshot', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().financialSnapshot(c) : {};
  });
  // Stripe/Payments (SW131-140)
  ipcMain.handle('sw:stripe-summary', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().stripeSyncSummary(c) : {};
  });
  ipcMain.handle('sw:stripe-recent', (_e, { limit }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().stripeRecentTransactions(c, limit) : [];
  });
  ipcMain.handle('sw:stripe-monthly', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().stripeMonthlyTrend(c) : [];
  });
  ipcMain.handle('sw:stripe-fees', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().stripeFeeSummary(c) : [];
  });
  ipcMain.handle('sw:stripe-unmatched', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().unmatchedStripeTransactions(c) : [];
  });
  ipcMain.handle('sw:payment-method-stats', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().paymentMethodStats(c) : [];
  });
  ipcMain.handle('sw:avg-payment-size', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().averagePaymentSize(c) : {};
  });
  ipcMain.handle('sw:payments-by-month', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().paymentsByMonth(c) : [];
  });
  ipcMain.handle('sw:overdue-payments', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().overduePayments(c) : [];
  });
  ipcMain.handle('sw:payment-forecast', (_e, { weeks }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().paymentForecast(c, weeks) : [];
  });
  // Company/Advanced (SW141-150)
  ipcMain.handle('sw:company-dashboard', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().companyDashboard(c) : {};
  });
  ipcMain.handle('sw:company-growth', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().companyGrowthMetrics(c) : [];
  });
  ipcMain.handle('sw:company-comparison', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().companyComparison(c) : [];
  });
  ipcMain.handle('sw:recurring-revenue', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().recurringRevenueSummary(c) : {};
  });
  ipcMain.handle('sw:customer-ltv', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().customerLifetimeValue(c) : [];
  });
  ipcMain.handle('sw:vendor-dependency', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().vendorDependencyAnalysis(c) : [];
  });
  ipcMain.handle('sw:profit-by-month', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().profitByMonth(c) : [];
  });
  ipcMain.handle('sw:annual-summary', (_e, { year }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().annualSummary(c, year) : {};
  });
  ipcMain.handle('sw:system-usage', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().systemUsageStats(c) : {};
  });
  ipcMain.handle('sw:full-report', () => {
    const c = db.getCurrentCompanyId();
    return c ? sw3().fullSystemReport(c) : {};
  });
  // ─── B3: AI Copilot ──────────────────────────────────────────────────────────

  ipcMain.handle(
    'copilot:ask',
    async (
      event,
      params: {
        streamId: string;
        messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      },
    ) => {
      const { streamId, messages } = params;
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        event.sender.send('copilot:chunk', {
          streamId,
          type: 'error',
          error: 'ANTHROPIC_API_KEY not configured. Add it to your .env file and restart.',
        });
        return null;
      }
      const companyId = db.getCurrentCompanyId();
      if (!companyId) {
        event.sender.send('copilot:chunk', {
          streamId,
          type: 'error',
          error: 'No active company selected.',
        });
        return null;
      }

      const abortController = new AbortController();
      copilotStreams.set(streamId, abortController);
      const anthropic = new Anthropic({ apiKey });

      const tools: Anthropic.Messages.Tool[] = [
        {
          name: 'search_records',
          description:
            'Search across invoices, expenses, clients, and vendors using full-text search. Returns up to 5 matching records.',
          input_schema: {
            type: 'object' as const,
            properties: {
              query: { type: 'string', description: 'The search query text' },
              entity_type: {
                type: 'string',
                enum: ['invoice', 'expense', 'client', 'vendor', 'any'],
                description: 'Filter by record type (default: any)',
              },
            },
            required: ['query'],
          },
        },
        {
          name: 'get_financial_summary',
          description:
            'Get total income (paid invoices), total expenses, and net profit for a date range.',
          input_schema: {
            type: 'object' as const,
            properties: {
              start_date: { type: 'string', description: 'Start date in YYYY-MM-DD format' },
              end_date: { type: 'string', description: 'End date in YYYY-MM-DD format' },
            },
            required: ['start_date', 'end_date'],
          },
        },
        {
          name: 'get_anomalies',
          description: 'List recently detected financial anomalies and duplicate invoice groups.',
          input_schema: { type: 'object' as const, properties: {}, required: [] },
        },
        {
          name: 'forecast_cash_flow',
          description:
            'Forecast cash flow for the next N days based on historical bank transaction patterns.',
          input_schema: {
            type: 'object' as const,
            properties: {
              days_ahead: {
                type: 'number',
                description: 'Number of days to forecast (default: 30, max: 90)',
              },
            },
            required: [],
          },
        },
        {
          name: 'propose_action',
          description:
            'Propose an action for the user to review and approve. Use this instead of executing mutations directly. The user sees a confirmation card.',
          input_schema: {
            type: 'object' as const,
            properties: {
              action_type: {
                type: 'string',
                enum: [
                  'navigate',
                  'create_invoice',
                  'create_expense',
                  'export_report',
                  'run_report',
                ],
                description: 'Type of action to propose',
              },
              description: {
                type: 'string',
                description: 'Clear human-readable description of what will happen if approved',
              },
              params: {
                type: 'object',
                description:
                  'Action parameters (module name for navigate, template data for create_*, report name for reports)',
              },
            },
            required: ['action_type', 'description'],
          },
        },
      ];

      function executeTool(toolName: string, input: Record<string, any>): string {
        try {
          switch (toolName) {
            case 'search_records': {
              const query = String(input.query ?? '').trim();
              if (!query) return JSON.stringify({ results: [] });
              const entityType = input.entity_type ?? 'any';
              const typeClause = entityType !== 'any' ? `AND entity_type = '${entityType}'` : '';
              const rows = db
                .getDb()
                .prepare(
                  `
              SELECT entity_type, entity_id, title, subtitle
              FROM search_index
              WHERE company_id = ? AND search_index MATCH ?
              ${typeClause}
              LIMIT 5
            `,
                )
                .all(companyId, query + '*') as Array<{
                entity_type: string;
                entity_id: string;
                title: string;
                subtitle: string;
              }>;
              return JSON.stringify({
                results: rows.map((r) => ({
                  type: r.entity_type,
                  id: r.entity_id,
                  title: r.title,
                  subtitle: r.subtitle,
                })),
              });
            }
            case 'get_financial_summary': {
              const { start_date, end_date } = input;
              const incomeRow = db
                .getDb()
                .prepare(
                  `SELECT COALESCE(SUM(total), 0) as total FROM invoices WHERE company_id = ? AND status = 'paid' AND issue_date BETWEEN ? AND ?`,
                )
                .get(companyId, start_date, end_date) as { total: number };
              const expenseRow = db
                .getDb()
                .prepare(
                  `SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE company_id = ? AND date BETWEEN ? AND ?`,
                )
                .get(companyId, start_date, end_date) as { total: number };
              const income = incomeRow?.total ?? 0;
              const expenses = expenseRow?.total ?? 0;
              return JSON.stringify({
                start_date,
                end_date,
                income,
                expenses,
                net: income - expenses,
              });
            }
            case 'get_anomalies': {
              const anomalies = db
                .getDb()
                .prepare(
                  `SELECT type, description, severity, detected_at FROM financial_anomalies WHERE company_id = ? ORDER BY detected_at DESC LIMIT 10`,
                )
                .all(companyId) as any[];
              const { intelligenceService } = require('../../services/IntelligenceService');
              const duplicates = intelligenceService.detectDuplicateInvoices(
                companyId,
              ) as string[][];
              return JSON.stringify({
                anomaly_count: anomalies.length,
                anomalies,
                duplicate_invoice_groups: duplicates,
              });
            }
            case 'forecast_cash_flow': {
              const daysAhead = Math.min(Number(input.days_ahead ?? 30), 90);
              const { intelligenceService } = require('../../services/IntelligenceService');
              const forecast = intelligenceService.forecastCashFlow(companyId, daysAhead) as {
                predicted: number;
                low: number;
                high: number;
              };
              return JSON.stringify({ days_ahead: daysAhead, ...forecast });
            }
            case 'propose_action': {
              const proposal = {
                proposalId: uuid(),
                action_type: input.action_type,
                description: input.description,
                params: input.params ?? {},
              };
              event.sender.send('copilot:chunk', { streamId, type: 'proposal', proposal });
              return JSON.stringify({
                status: 'proposal_shown_to_user',
                proposalId: proposal.proposalId,
              });
            }
            default:
              return JSON.stringify({ error: `Unknown tool: ${toolName}` });
          }
        } catch (err: any) {
          return JSON.stringify({ error: err?.message ?? 'Tool execution failed' });
        }
      }

      const apiMessages: Anthropic.Messages.MessageParam[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      try {
        let continueLoop = true;
        while (continueLoop) {
          if (abortController.signal.aborted) break;

          const stream = anthropic.messages.stream(
            {
              model: 'claude-opus-4-8',
              system: `You are an AI Copilot embedded in Business Accounting Pro, a professional desktop accounting application.
You have read-only access to the user's financial data via tools. Help them analyze finances, find records, spot anomalies, and forecast cash flow.
CRITICAL RULE: Never execute data mutations or money movements. Always use propose_action to suggest changes — the user must approve before anything is created or modified.
Be concise and data-driven. Format dollar amounts with $ and two decimal places. Use tables or bullet lists for structured data.`,
              messages: apiMessages,
              tools,
              thinking: { type: 'adaptive' },
              max_tokens: 4096,
            },
            { signal: abortController.signal },
          );

          stream.on('text', (text: string) => {
            event.sender.send('copilot:chunk', { streamId, type: 'delta', text });
          });

          const response = await stream.finalMessage();
          apiMessages.push({ role: 'assistant', content: response.content });

          if (response.stop_reason === 'tool_use') {
            const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
            for (const block of response.content) {
              if (block.type === 'tool_use') {
                event.sender.send('copilot:chunk', {
                  streamId,
                  type: 'tool_call',
                  toolName: block.name,
                });
                const result = executeTool(block.name, block.input as Record<string, any>);
                toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
              }
            }
            apiMessages.push({ role: 'user', content: toolResults });
          } else {
            continueLoop = false;
          }
        }
        event.sender.send('copilot:chunk', { streamId, type: 'done' });
        return { ok: true };
      } catch (err: any) {
        if (err?.name !== 'AbortError' && !abortController.signal.aborted) {
          event.sender.send('copilot:chunk', {
            streamId,
            type: 'error',
            error: err?.message ?? 'Unexpected error from AI service.',
          });
        } else {
          event.sender.send('copilot:chunk', { streamId, type: 'done' });
        }
        return null;
      } finally {
        copilotStreams.delete(streamId);
      }
    },
  );
  ipcMain.handle('copilot:stop', (_event, { streamId }: { streamId: string }) => {
    const ac = copilotStreams.get(streamId);
    if (ac) {
      ac.abort();
      copilotStreams.delete(streamId);
    }
    return { ok: true };
  });
  ipcMain.handle('copilot:threads:list', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return [];
    return db
      .getDb()
      .prepare(
        `SELECT id, title, created_at, updated_at FROM copilot_threads WHERE company_id = ? ORDER BY updated_at DESC LIMIT 20`,
      )
      .all(companyId);
  });
  ipcMain.handle('copilot:threads:load', (_event, { threadId }: { threadId: string }) => {
    const row = db
      .getDb()
      .prepare(`SELECT * FROM copilot_threads WHERE id = ?`)
      .get(threadId) as any;
    if (!row) return null;
    return { ...row, messages: JSON.parse(row.messages_json || '[]') };
  });
  ipcMain.handle(
    'copilot:threads:save',
    (_event, p: { threadId: string; title: string; messages: any[] }) => {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return null;
      const exists = db
        .getDb()
        .prepare(`SELECT id FROM copilot_threads WHERE id = ?`)
        .get(p.threadId);
      if (exists) {
        db.getDb()
          .prepare(
            `UPDATE copilot_threads SET title = ?, messages_json = ?, updated_at = datetime('now') WHERE id = ?`,
          )
          .run(p.title, JSON.stringify(p.messages), p.threadId);
      } else {
        db.getDb()
          .prepare(
            `INSERT INTO copilot_threads (id, company_id, title, messages_json) VALUES (?, ?, ?, ?)`,
          )
          .run(p.threadId, companyId, p.title, JSON.stringify(p.messages));
      }
      scheduleAutoBackup();
      return { ok: true };
    },
  );
  ipcMain.handle('copilot:threads:delete', (_event, { threadId }: { threadId: string }) => {
    db.getDb().prepare(`DELETE FROM copilot_threads WHERE id = ?`).run(threadId);
    scheduleAutoBackup();
    return { ok: true };
  });
  // ─── Global Search ───────────────────────────────────
  ipcMain.handle('search:index', (_e, { query, limit }: { query: string; limit?: number }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId || !query) return [];
    try {
      const { search } = require('../../services/intelligence/searchIndex');
      return search(db.getDb(), companyId, query, Math.min(limit || 20, 50));
    } catch (e) {
      console.warn('[search:index] failed', e);
      return [];
    }
  });
  ipcMain.handle('search:backfill', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { indexed: 0 };
    try {
      const { backfillCompany } = require('../../services/intelligence/searchIndex');
      return { indexed: backfillCompany(db.getDb(), companyId) };
    } catch (e) {
      console.warn('[search:backfill] failed', e);
      return { indexed: 0, error: String(e) };
    }
  });
  // Intelligence Core (B1) — role-checked mutation dispatch. Role enforced in main; never trust renderer.
  ipcMain.handle(
    'action:invoke',
    (_e, { actionId, params }: { actionId: string; params?: any }) => {
      const companyId = db.getCurrentCompanyId();
      const userId = db.getCurrentUserId();
      if (!companyId || !userId) return { error: 'Not authenticated' };
      const { MUTATE_ACTIONS, ROLE_RANK } = require('../../shared/action-registry');
      const action = MUTATE_ACTIONS.find((a: any) => a.id === actionId);
      if (!action) return { error: 'Unknown or non-mutating action' };
      // Role check — never trust the renderer.
      const userRow: any = db.runQuery('SELECT role FROM users WHERE id = ?', [userId])[0];
      const role = userRow?.role || 'viewer';
      if (action.requiredRole && (ROLE_RANK[role] ?? 0) < ROLE_RANK[action.requiredRole]) {
        return { error: `Requires ${action.requiredRole} role` };
      }
      try {
        let result: any;
        if (actionId === 'invoice.markPaid') {
          if (!params?.invoiceId) return { error: 'invoiceId required' };
          result = db.update('invoices', params.invoiceId, { status: 'paid' });
          db.logAudit(companyId, 'invoices', params.invoiceId, 'update', {
            status: { new: 'paid' },
          });
        } else if (actionId === 'client.createQuick') {
          if (!params?.name) return { error: 'name required' };
          result = db.create('clients', {
            company_id: companyId,
            name: params.name,
            email: params.email || '',
          });
          db.logAudit(companyId, 'clients', result.id, 'create');
        } else {
          return { error: 'No handler' };
        }
        scheduleReindex(
          actionId.startsWith('invoice') ? 'invoices' : 'clients',
          params.invoiceId || result.id,
          'upsert',
        );
        scheduleAutoBackup();
        return { ok: true, result };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  );
  ipcMain.handle('search:global', (_event, query) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId || !query || String(query).length > 200) return [];
    try {
      const { search } = require('../../services/intelligence/searchIndex');
      return search(db.getDb(), companyId, String(query), 20).map((h: any) => ({
        type: h.entity_type,
        id: h.entity_id,
        title: h.title,
        subtitle: h.subtitle || '',
      }));
    } catch (e) {
      console.warn('[search:global] failed', e);
      return [];
    }
  });
  // ─── Financial Intelligence ─────────────────────────
  ipcMain.handle('intelligence:anomalies', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return [];
    return db
      .getDb()
      .prepare(
        `SELECT * FROM financial_anomalies WHERE company_id = ? AND dismissed = 0 ORDER BY detected_at DESC LIMIT 20`,
      )
      .all(companyId);
  });
  ipcMain.handle('intelligence:dismiss-anomaly', (_e, id: string) => {
    db.getDb().prepare(`UPDATE financial_anomalies SET dismissed = 1 WHERE id = ?`).run(id);
    scheduleAutoBackup();
  });
  ipcMain.handle('intelligence:cash-projection', (_e, { days }: { days: number }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { inflow: [], outflow: [] };
    const d = Math.min(Math.max(Number.isFinite(Number(days)) ? Number(days) : 30, 1), 90);
    const dbInstance = db.getDb();
    const inflow = dbInstance
      .prepare(
        `
      SELECT SUM(total) as amount, due_date
      FROM invoices
      WHERE company_id = ? AND status NOT IN ('paid','void','draft')
        AND due_date BETWEEN date('now') AND date('now', '+' || ? || ' days')
      GROUP BY due_date ORDER BY due_date
    `,
      )
      .all(companyId, d);
    const outflow = dbInstance
      .prepare(
        `
      SELECT SUM(total_amount) as amount, due_date
      FROM bills
      WHERE company_id = ? AND status NOT IN ('paid','void','draft')
        AND due_date BETWEEN date('now') AND date('now', '+' || ? || ' days')
      GROUP BY due_date ORDER BY due_date
    `,
      )
      .all(companyId, d);
    return { inflow, outflow };
  });
  ipcMain.handle(
    'intelligence:entity-hint',
    (_e, { entityType, id }: { entityType: string; id: string }) => {
      const companyId = db.getCurrentCompanyId();
      if (!companyId || !id) return '';
      try {
        if (entityType === 'client') {
          const row: any = db.runQuery(
            `SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS amt FROM invoices
           WHERE company_id = ? AND client_id = ? AND status NOT IN ('paid','cancelled','draft')
             AND COALESCE(due_date,'') <> '' AND date(due_date) < date('now')`,
            [companyId, id],
          )[0];
          if (row?.n > 0)
            return `${row.n} overdue invoice${row.n > 1 ? 's' : ''} ($${Math.round(row.amt).toLocaleString()})`;
        } else if (entityType === 'vendor') {
          const row: any = db.runQuery(
            `SELECT COUNT(*) AS n FROM expenses WHERE company_id = ? AND vendor_id = ?
             AND instr(COALESCE(tags,''),'anomaly') > 0`,
            [companyId, id],
          )[0];
          if (row?.n > 0) return `${row.n} flagged charge${row.n > 1 ? 's' : ''}`;
        }
        return '';
      } catch {
        return '';
      }
    },
  );
  ipcMain.handle('shortcut:list', (_event, { user_id }: { user_id?: string }) => {
    const dbI = db.getDb();
    return dbI.prepare(`SELECT * FROM custom_shortcuts WHERE user_id = ?`).all(user_id || 'anon');
  });
  ipcMain.handle('shortcut:save', (_event, { user_id, key_combo, command_id, params }: any) => {
    const dbI = db.getDb();
    const existing = dbI
      .prepare(`SELECT id FROM custom_shortcuts WHERE user_id = ? AND key_combo = ?`)
      .get(user_id || 'anon', key_combo) as any;
    if (existing) {
      dbI
        .prepare(
          `UPDATE custom_shortcuts SET command_id = ?, params_json = ?, updated_at = datetime('now') WHERE id = ?`,
        )
        .run(command_id, JSON.stringify(params || {}), existing.id);
      scheduleAutoBackup();
      return { success: true, id: existing.id };
    }
    const id = uuid();
    dbI
      .prepare(
        `INSERT INTO custom_shortcuts (id, user_id, key_combo, command_id, params_json) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, user_id || 'anon', key_combo, command_id, JSON.stringify(params || {}));
    scheduleAutoBackup();
    return { success: true, id };
  });
  ipcMain.handle('shortcut:delete', (_event, { id }: { id: string }) => {
    db.getDb().prepare(`DELETE FROM custom_shortcuts WHERE id = ?`).run(id);
    scheduleAutoBackup();
    return { success: true };
  });
  ipcMain.handle('macro:list', (_event, { user_id }: { user_id?: string }) => {
    const companyId = db.getCurrentCompanyId();
    return db
      .getDb()
      .prepare(
        `SELECT * FROM macros WHERE (user_id = ? OR is_shared = 1) AND company_id = ? ORDER BY name`,
      )
      .all(user_id || 'anon', companyId);
  });
  ipcMain.handle(
    'macro:save',
    (_event, { id, user_id, name, description, action_sequence, is_shared }: any) => {
      const companyId = db.getCurrentCompanyId();
      const dbI = db.getDb();
      const seqJson = JSON.stringify(action_sequence || []);
      if (id) {
        dbI
          .prepare(
            `UPDATE macros SET name = ?, description = ?, action_sequence_json = ?, is_shared = ?, updated_at = datetime('now') WHERE id = ?`,
          )
          .run(name || '', description || '', seqJson, is_shared ? 1 : 0, id);
        return { success: true, id };
      }
      const newId = uuid();
      dbI
        .prepare(
          `INSERT INTO macros (id, user_id, company_id, name, description, action_sequence_json, is_shared) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          newId,
          user_id || 'anon',
          companyId,
          name || '',
          description || '',
          seqJson,
          is_shared ? 1 : 0,
        );
      scheduleAutoBackup();
      return { success: true, id: newId };
    },
  );
  ipcMain.handle('macro:delete', (_event, { id }: { id: string }) => {
    db.getDb().prepare(`DELETE FROM macros WHERE id = ?`).run(id);
    scheduleAutoBackup();
    return { success: true };
  });
}
