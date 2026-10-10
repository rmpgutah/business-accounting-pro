import type { IpcMain } from 'electron';
import type { IpcDeps } from '../core/types';
import { featHandlers, type FeatSpec } from '../core/featHandlers';
import { svc } from '../core/svc';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DYNAMIC_POWER_FEAT: Record<string, FeatSpec<any>> = {
  'feat:smart:anomalies': {
    call: (s, opts: any = {}, { cid }) => s.detectAnomalies(cid!, opts),
    requiresCompany: [],
  },
  'feat:smart:suggest-category': {
    call: (s, { description, vendor_id }: any, { cid }) =>
      s.suggestCategoryByDescription(cid!, description, vendor_id),
    requiresCompany: null,
  },
  'feat:smart:predict-payment': {
    call: (s, { invoice_id }: any, { cid }) => s.predictPaymentDate(cid!, invoice_id),
    requiresCompany: null,
  },
  'feat:smart:fill-from-previous': {
    call: (s, { entity_type, context }: any, { cid }) =>
      s.smartFillFromPrevious(cid!, entity_type, context || {}),
    requiresCompany: {},
  },
  'feat:smart:canonicalize-vendor': {
    call: (s, { input_name }: any, { cid }) => s.canonicalizeVendorName(cid!, input_name),
    requiresCompany: null,
  },
  'feat:smart:match-transaction': {
    call: (s, { transaction_id, opts }: any, { cid }) =>
      s.matchTransactionToInvoice(cid!, transaction_id, opts || {}),
    requiresCompany: { matches: [] },
  },
  'feat:smart:late-risk': {
    call: (s, { customer_id }: any, { cid }) => s.calculateLatePaymentRisk(cid!, customer_id),
    requiresCompany: null,
  },
  'feat:smart:forecast': {
    call: (s, { account_id, periods }: any, { cid }) =>
      s.forecastNextPeriod(cid!, account_id, periods || 3),
    requiresCompany: [],
  },
  'feat:smart:recommend': {
    call: (s, { user_id, limit }: any, { cid }) => s.recommendActions(cid!, user_id, limit),
    requiresCompany: [],
  },
  'feat:smart:detect-dupes': {
    call: (s, { entity_type, lookback_days }: any = {}, { cid }) =>
      s.detectDuplicateEntries(cid!, entity_type || 'expense', lookback_days || 30),
    requiresCompany: [],
  },
  'feat:cmd:register': { call: (s, c: any) => s.registerCommand(c) },
  'feat:cmd:list': { call: (s, opts: any = {}) => s.listCommands(opts) },
  'feat:cmd:search': { call: (s, { query, limit }: any) => s.searchCommands(query, limit) },
  'feat:macro:start': {
    call: (s, { user_id, name, scope }: any) => s.recordMacroStart(user_id, name, scope),
    mutates: true,
  },
  'feat:macro:save-steps': {
    call: (s, { macro_id, steps }: any) => ({ ok: s.saveMacroSteps(macro_id, steps) }),
    mutates: true,
  },
  'feat:macro:get-steps': { call: (s, { macro_id }: any) => s.getMacroSteps(macro_id) },
  'feat:macro:list': { call: (s, { user_id }: any) => s.listMacros(user_id) },
  'feat:layout:save': {
    call: (s, opts: any, { cid }) => s.saveWorkspaceLayout({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:layout:load': { call: (s, { user_id, name }: any) => s.loadWorkspaceLayout(user_id, name) },
  'feat:layout:list': { call: (s, { user_id }: any) => s.listWorkspaceLayouts(user_id) },
  'feat:custom-report:create': {
    call: (s, r: any, { cid }) => s.createCustomReport({ ...r, company_id: cid }),
    mutates: true,
  },
  'feat:custom-report:run': {
    call: (s, { report_id, params }: any) => s.runCustomReport(report_id, params),
    mutates: true,
  },
  'feat:pivot:build': { call: (s, { rows, opts }: any) => s.buildPivotTable(rows, opts) },
  'feat:report-sched:save': { call: (svc, s: any) => svc.saveReportSchedule(s), mutates: true },
  'feat:report-sched:list': {
    call: (s, _p: any, { cid }) => s.listScheduledReports(cid!),
    requiresCompany: [],
  },
  'feat:report-sched:due': { call: (s) => s.listDueReports() },
  'feat:report-sched:mark-run': {
    call: (s, { schedule_id, next_run_at }: any) => ({
      ok: s.markReportRun(schedule_id, next_run_at),
    }),
    mutates: true,
  },
  'feat:custom-report:compare': {
    call: (s, { report_id, params_a, params_b }: any) =>
      s.comparePeriods(report_id, params_a, params_b),
  },
  'feat:custom-report:executions': {
    call: (s, { report_id, limit }: any) => s.listReportExecutions(report_id, limit),
  },
  'feat:custom-report:list': {
    call: (s, opts: any = {}, { cid }) => s.listCustomReports(cid!, opts),
    requiresCompany: [],
  },
  'feat:webhook:register': {
    call: (s, opts: any, { cid }) => s.registerWebhook({ ...opts, company_id: cid }),
  },
  'feat:webhook:sign': {
    call: (s, { payload, secret }: any) => s.signPayload(payload, secret),
    mutates: true,
  },
  'feat:webhook:verify': {
    call: (s, { payload, signature, secret }: any) => s.verifySignature(payload, signature, secret),
  },
  'feat:webhook:queue': { call: (s, opts: any) => s.queueWebhookDelivery(opts), mutates: true },
  'feat:webhook:due': { call: (s, { limit }: any = {}) => s.listDueWebhookDeliveries(limit) },
  'feat:webhook:record-attempt': {
    call: (s, { queue_id, success, error_message }: any) =>
      s.recordDeliveryAttempt(queue_id, success, error_message),
    mutates: true,
  },
  'feat:webhook:deliveries': { call: (s, opts: any = {}) => s.listWebhookDeliveries(opts) },
  'feat:webhook:retry': { call: (s, { queue_id }: any) => ({ ok: s.retryDeadLetter(queue_id) }) },
  'feat:webhook:stats': {
    call: (s, { hours }: any = {}, { cid }) => s.webhookStats(cid!, hours),
    requiresCompany: null,
  },
  'feat:webhook:fire-event': {
    call: (s, { event_type, payload }: any, { cid }) =>
      s.fireWebhookForEvent(cid!, event_type, payload),
    requiresCompany: { queued_count: 0 },
  },
  'feat:activity:record': {
    call: (s, a: any, { cid }) => s.recordActivity({ ...a, company_id: cid }),
    mutates: true,
  },
  'feat:activity:feed': {
    call: (s, opts: any = {}, { cid }) => s.listActivityFeed(cid!, opts),
    requiresCompany: [],
  },
  'feat:lock:acquire': { call: (s, opts: any) => s.lockEntity(opts) },
  'feat:lock:release': {
    call: (s, { entity_type, entity_id, user_id }: any) => ({
      ok: s.unlockEntity(entity_type, entity_id, user_id),
    }),
  },
  'feat:lock:check': {
    call: (s, { entity_type, entity_id }: any) => s.checkEntityLock(entity_type, entity_id),
  },
  'feat:presence:heartbeat': {
    call: (s, opts: any, { cid }) => ({ ok: s.heartbeatPresence({ ...opts, company_id: cid }) }),
  },
  'feat:presence:active': {
    call: (s, { seconds_window }: any = {}, { cid }) => s.listActivePresence(cid!, seconds_window),
    requiresCompany: [],
  },
  'feat:presence:on-entity': {
    call: (s, { entity_type, entity_id, seconds_window }: any) =>
      s.listUsersOnEntity(entity_type, entity_id, seconds_window),
  },
  'feat:activity:summary': {
    call: (s, opts: any = {}, { cid }) => s.activitySummary(cid!, opts),
    requiresCompany: [],
  },
  'feat:lock:cleanup': { call: (s) => s.cleanExpiredLocks() },
};

export function registerDynamicPowerFeaturesFeat(ipcMain: IpcMain, deps: IpcDeps): void {
  featHandlers(ipcMain, deps, svc('dynamic-power-features'), DYNAMIC_POWER_FEAT);
}
