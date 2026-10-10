import type { IpcMain } from 'electron';
import type { IpcDeps } from '../core/types';
import { featHandlers, type FeatSpec } from '../core/featHandlers';
import { svc } from '../core/svc';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DYNAMIC_SEARCH_BULK_FEAT: Record<string, FeatSpec<any>> = {
  'feat:search:global': {
    call: (s, { query, opts }: any, { cid }) => s.globalSearch(cid!, query, opts || {}),
    requiresCompany: [],
  },
  'feat:search:record-history': {
    call: (s, { user_id, query, result_count }: any, { cid }) =>
      s.recordSearchHistory(user_id, cid, query, result_count),
    mutates: true,
  },
  'feat:search:recent': {
    call: (s, { user_id, limit }: any) => s.listRecentSearches(user_id, limit),
  },
  'feat:recently-viewed:list': {
    call: (s, { user_id, ...opts }: any) => s.listRecentlyViewed(user_id, opts),
  },
  'feat:recently-viewed:record': {
    call: (s, { user_id, entity_type, entity_id, entity_label }: any, { cid }) => {
      s.recordEntityView(user_id, cid!, entity_type, entity_id, entity_label);
      return { ok: true };
    },
    mutates: true,
    requiresCompany: false,
  },
  'feat:pin:add': {
    call: (s, { user_id, entity_type, entity_id, entity_label }: any, { cid }) =>
      s.pinEntity(user_id, cid, entity_type, entity_id, entity_label),
    mutates: true,
  },
  'feat:pin:remove': {
    call: (s, { user_id, entity_type, entity_id }: any) => ({
      ok: s.unpinEntity(user_id, entity_type, entity_id),
    }),
    mutates: true,
  },
  'feat:pin:list': {
    call: (s, { user_id, entity_type }: any) => s.listPinnedEntities(user_id, entity_type),
  },
  'feat:search:pattern': {
    call: (s, { pattern, entity_type, opts }: any, { cid }) =>
      s.searchByPattern(cid!, pattern, entity_type, opts || {}),
    requiresCompany: [],
  },
  'feat:fuzzy-match': {
    call: (s, { name, entity_type, threshold }: any, { cid }) =>
      s.fuzzyMatchEntity(cid!, name, entity_type, threshold),
    requiresCompany: [],
  },
  'feat:cross-ref': {
    call: (s, { entity_type, entity_id }: any, { cid }) =>
      s.crossReferenceEntity(cid!, entity_type, entity_id),
    requiresCompany: null,
  },
  'feat:notif:create': {
    call: (s, opts: any, { cid }) => s.createNotification({ company_id: cid, ...opts }),
    mutates: true,
  },
  'feat:notif:list': {
    call: (s, { user_id, ...opts }: any) => s.listUserNotifications(user_id, opts),
  },
  'feat:notif:mark-read': {
    call: (s, { id }: any) => ({ ok: s.markNotificationRead(id) }),
    mutates: true,
  },
  'feat:notif:mark-all-read': {
    call: (s, { user_id }: any) => ({ marked: s.markAllRead(user_id) }),
    mutates: true,
  },
  'feat:notif:snooze': {
    call: (s, { id, until_date }: any) => ({ ok: s.snoozeNotification(id, until_date) }),
  },
  'feat:notif:set-pref': {
    call: (s, opts: any, { cid }) => s.setNotificationPreference({ company_id: cid, ...opts }),
    mutates: true,
  },
  'feat:notif:get-prefs': { call: (s, { user_id }: any) => s.getNotificationPrefs(user_id) },
  'feat:alert-rule:create': {
    call: (s, rule: any, { cid }) => s.createAlertRule({ ...rule, company_id: cid }),
    mutates: true,
  },
  'feat:alert-rule:evaluate': {
    call: (s, { entity_type, entity_data }: any, { cid }) =>
      s.evaluateAlertRules(cid!, entity_type, entity_data),
    requiresCompany: [],
  },
  'feat:digest:build': {
    call: (s, { user_id, period }: any) => s.buildDigestEmail(user_id, period || 'daily'),
  },
  'feat:csv:parse': { call: (s, { text }: any) => s.parseCSVForImport(text) },
  'feat:csv:detect-mapping': {
    call: (s, { headers, entity_type }: any) => s.detectColumnMapping(headers, entity_type),
  },
  'feat:csv:validate': {
    call: (s, { rows, mapping, entity_type }: any) =>
      s.validateImportRows(rows, mapping, entity_type),
  },
  'feat:import-tpl:save': {
    call: (s, tpl: any, { cid }) => s.saveImportTemplate({ ...tpl, company_id: cid }),
    mutates: true,
  },
  'feat:import-tpl:list': {
    call: (s, { entity_type }: any = {}, { cid }) => s.listImportTemplates(cid!, entity_type),
    mutates: true,
    requiresCompany: [],
  },
  'feat:export:csv': {
    call: (s, { rows, columns }: any) => s.exportToCSV(rows, columns),
    mutates: true,
  },
  'feat:export:iif': {
    call: (s, { transactions }: any) => s.exportToQuickBooksIIF(transactions),
    mutates: true,
  },
  'feat:export-job:create': {
    call: (s, j: any, { cid }) => s.createExportJob({ ...j, company_id: cid }),
    mutates: true,
  },
  'feat:export-job:list': {
    call: (s, { active_only }: any = {}, { cid }) => s.listExportJobs(cid!, active_only !== false),
    mutates: true,
    requiresCompany: [],
  },
  'feat:export-job:mark-run': {
    call: (s, { job_id, output_path }: any) => ({ ok: s.markExportRun(job_id, output_path) }),
    mutates: true,
  },
  'feat:bulk:update': {
    call: (s, opts: any, { cid }) => s.bulkUpdate({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:bulk:delete': {
    call: (s, opts: any, { cid }) => s.bulkDelete({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:bulk:archive': {
    call: (s, opts: any, { cid }) => s.bulkArchive({ ...opts, company_id: cid }),
  },
  'feat:bulk:change-status': {
    call: (s, opts: any, { cid }) => s.bulkChangeStatus({ ...opts, company_id: cid }),
  },
  'feat:bulk:assign': {
    call: (s, opts: any, { cid }) => s.bulkAssign({ ...opts, company_id: cid }),
  },
  'feat:bulk:tag': { call: (s, opts: any, { cid }) => s.bulkTag({ ...opts, company_id: cid }) },
  'feat:bulk:untag': { call: (s, opts: any) => s.bulkUntag(opts) },
  'feat:undo:list': {
    call: (s, { user_id, limit }: any = {}, { cid }) =>
      s.listUndoableOperations(cid!, user_id, limit),
    requiresCompany: [],
  },
  'feat:undo:apply': {
    call: (s, { snapshot_id }: any) => s.undoBulkOperation(snapshot_id),
    mutates: true,
  },
  'feat:undo:create-snapshot': {
    call: (s, opts: any, { cid }) => s.createUndoSnapshot({ ...opts, company_id: cid }),
    mutates: true,
  },
};

export function registerDynamicSearchBulkFeaturesFeat(ipcMain: IpcMain, deps: IpcDeps): void {
  featHandlers(ipcMain, deps, svc('dynamic-search-bulk-features'), DYNAMIC_SEARCH_BULK_FEAT);
}
