import type { IpcMain } from 'electron';
import type { IpcDeps } from '../core/types';
import { featHandlers } from '../core/featHandlers';
import { svc } from '../core/svc';

export function registerAutomationFeaturesFeat(ipcMain: IpcMain, deps: IpcDeps): void {
  featHandlers(ipcMain, deps, svc('automation-features'), {
    'feat:workflow:upsert': {
      call: (s, w: any, { cid }) => s.upsertWorkflow({ ...w, company_id: cid }),
      mutates: true,
    },
    'feat:workflow:list': {
      call: (s, { active_only }: any = {}, { cid }) => s.listWorkflows(cid!, !!active_only),
      requiresCompany: [],
    },
    'feat:workflow:trigger': {
      call: (s, { trigger_type, payload }: any, { cid }) =>
        s.triggerWorkflows(cid!, trigger_type, payload || {}),
      mutates: true,
      requiresCompany: [],
    },
    'feat:scheduled-task:upsert': {
      call: (s, t: any, { cid }) => s.upsertScheduledTask({ ...t, company_id: cid }),
      mutates: true,
    },
    'feat:scheduled-task:list': {
      call: (s, _p: any, { cid }) => s.listScheduledTasks(cid!),
      requiresCompany: [],
    },
    'feat:scheduled-task:due': { call: (s) => s.dueScheduledTasks() },
    'feat:scheduled-task:mark-run': {
      call: (s, { id, status, next_run_at }: any) => ({
        ok: s.markScheduledTaskRun(id, status, next_run_at),
      }),
      mutates: true,
    },
    'feat:approval-chain:upsert': {
      call: (s, c: any, { cid }) => s.upsertApprovalChain({ ...c, company_id: cid }),
      mutates: true,
    },
    'feat:approval:start': {
      call: (s, { chain_id, entity_type, entity_id, submitted_by }: any) =>
        s.startApprovalInstance(chain_id, entity_type, entity_id, submitted_by),
      mutates: true,
    },
    'feat:approval:act': {
      call: (s, { instance_id, action, actor_id, comment }: any) =>
        s.actOnApproval(instance_id, action, actor_id, comment),
    },
    'feat:approval:pending': {
      call: (s, { approver_user_id }: any = {}, { cid }) =>
        s.pendingApprovals(cid!, approver_user_id),
      requiresCompany: [],
    },
    'feat:email-template:upsert': {
      call: (s, t: any, { cid }) => s.upsertEmailTemplate({ ...t, company_id: cid }),
      mutates: true,
    },
    'feat:email-template:list': {
      call: (s, { category }: any = {}, { cid }) => s.listEmailTemplates(cid!, category),
      requiresCompany: [],
    },
    'feat:email-template:render': {
      call: (s, { template_id, data }: any) => s.renderEmailTemplate(template_id, data || {}),
    },
    'feat:webhook:upsert': {
      call: (s, w: any, { cid }) => s.upsertWebhookSubscription({ ...w, company_id: cid }),
      mutates: true,
    },
    'feat:webhook:record-delivery': {
      call: (
        s,
        { subscription_id, event_type, payload, response_status, response_body, duration_ms }: any,
      ) => {
        s.recordWebhookDelivery(
          subscription_id,
          event_type,
          payload,
          response_status,
          response_body,
          duration_ms,
        );
        return { ok: true };
      },
      mutates: true,
    },
    'feat:auto-categorize:learn': {
      call: (s, { description_pattern, vendor_id, category_id }: any, { cid }) => {
        s.recordAutoCategorizeAccept(cid, description_pattern, vendor_id || null, category_id);
        return { ok: true };
      },
      mutates: true,
    },
    'feat:auto-categorize:suggest': {
      call: (s, { description, vendor_id }: any, { cid }) =>
        s.getAutoCategorizeSuggestion(cid!, description, vendor_id),
      requiresCompany: null,
    },
    'feat:auto-archive:run': {
      call: (s, _p: any, { cid }) => s.runAutoArchive(cid!),
      mutates: true,
      requiresCompany: { invoices_archived: 0, bills_archived: 0 },
    },
    'feat:triggered-action:log': {
      call: (
        s,
        { trigger_source, entity_type, entity_id, action_type, action_result }: any,
        { cid },
      ) => {
        s.logTriggeredAction(
          cid,
          trigger_source,
          entity_type,
          entity_id,
          action_type,
          action_result,
        );
        return { ok: true };
      },
      mutates: true,
    },
    'feat:triggered-action:list': {
      call: (s, opts: any = {}, { cid }) => s.listTriggeredActions(cid!, opts),
      requiresCompany: [],
    },
    'feat:sla:upsert': {
      call: (svc, s, { cid }) => svc.upsertSLA({ ...s, company_id: cid }),
      mutates: true,
    },
    'feat:sla:list': { call: (s, _p: any, { cid }) => s.listSLAs(cid!), requiresCompany: [] },
    'feat:saved-search:upsert': {
      call: (svc, s, { cid }) => svc.upsertSavedSearch({ ...s, company_id: cid }),
      mutates: true,
    },
    'feat:saved-search:list': {
      call: (s, { user_id, module }: any, { cid }) => s.listSavedSearches(user_id, cid!, module),
      requiresCompany: [],
    },
    'feat:bulk-op:log': {
      call: (s, op: any, { cid }) => s.logBulkOperation(cid, op),
      mutates: true,
    },
    'feat:bulk-op:list': {
      call: (s, opts: any = {}, { cid }) => s.listBulkOperations(cid!, opts),
      requiresCompany: [],
    },
    'feat:quick-action:upsert': {
      call: (s, a: any, { cid }) => s.upsertQuickAction({ ...a, company_id: cid }),
      mutates: true,
    },
    'feat:quick-action:list': {
      call: (s, { user_id }: any, { cid }) => s.listQuickActions(user_id, cid!),
      requiresCompany: [],
    },
  });
}
