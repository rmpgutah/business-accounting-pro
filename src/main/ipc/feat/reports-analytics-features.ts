import type { IpcMain } from 'electron';
import type { IpcDeps } from '../core/types';
import { featHandlers, type FeatSpec } from '../core/featHandlers';
import { svc } from '../core/svc';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const REPORTS_ANALYTICS_FEAT: Record<string, FeatSpec<any>> = {
  'feat:report:period-over-period': {
    call: (s, opts: any, { cid }) => s.periodOverPeriod(cid!, opts),
    requiresCompany: null,
  },
  'feat:report:top-customers': {
    call: (s, opts: any, { cid }) => s.topCustomers(cid!, opts),
    requiresCompany: [],
  },
  'feat:report:clv': {
    call: (s, { client_id }: any = {}, { cid }) => s.customerLifetimeValue(cid!, client_id),
    requiresCompany: null,
  },
  'feat:report:churn-predict': {
    call: (s, opts: any = {}, { cid }) => s.predictChurn(cid!, opts),
    requiresCompany: [],
  },
  'feat:report:profit-by-service': {
    call: (s, opts: any, { cid }) => s.profitMarginByService(cid!, opts),
    requiresCompany: [],
  },
  'feat:report:dept-pnl': {
    call: (s, opts: any, { cid }) => s.departmentPnL(cid!, opts),
    requiresCompany: [],
  },
  'feat:report:vendor-yoy': {
    call: (s, opts: any = {}, { cid }) => s.vendorSpendingYoY(cid!, opts),
    requiresCompany: [],
  },
  'feat:collection-template:upsert': {
    call: (s, t: any, { cid }) => s.upsertCollectionTemplate({ ...t, company_id: cid }),
    mutates: true,
  },
  'feat:collection-template:list': {
    call: (s, _p: any, { cid }) => s.listCollectionTemplates(cid!),
    requiresCompany: [],
  },
  'feat:collection-template:render': {
    call: (s, { template, invoice, client }: any) =>
      s.generateCollectionEmail(template, invoice, client),
  },
  'feat:report:year-end-tax': {
    call: (s, { year }: any, { cid }) => s.yearEndTaxSummary(cid!, year),
    requiresCompany: null,
  },
  'feat:widgets:list': {
    call: (s, { user_id }: any, { cid }) => s.listDashboardWidgets(user_id, cid!),
    requiresCompany: [],
  },
  'feat:widgets:upsert': {
    call: (s, w: any, { cid }) => s.upsertDashboardWidget({ ...w, company_id: cid }),
    mutates: true,
  },
  'feat:widgets:remove': {
    call: (s, { id }: any) => ({ ok: s.removeDashboardWidget(id) }),
    mutates: true,
  },
};

export function registerReportsAnalyticsFeaturesFeat(ipcMain: IpcMain, deps: IpcDeps): void {
  featHandlers(ipcMain, deps, svc('reports-analytics-features'), REPORTS_ANALYTICS_FEAT);
}
