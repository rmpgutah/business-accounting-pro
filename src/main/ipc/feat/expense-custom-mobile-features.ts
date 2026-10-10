import type { IpcMain } from 'electron';
import type { IpcDeps } from '../core/types';
import { featHandlers, type FeatSpec } from '../core/featHandlers';
import { svc } from '../core/svc';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const EXPENSE_CUSTOM_MOBILE_FEAT: Record<string, FeatSpec<any>> = {
  'feat:exp-cf:upsert': {
    call: (s, f: any, { cid }) => s.upsertExpenseCustomField({ ...f, company_id: cid }),
    mutates: true,
  },
  'feat:exp-cf:list': {
    call: (s, { category_id }: any = {}, { cid }) => s.listExpenseCustomFields(cid!, category_id),
    requiresCompany: [],
  },
  'feat:exp-cf:set-value': {
    call: (s, opts: any) => s.setExpenseCustomFieldValue(opts),
    mutates: true,
  },
  'feat:exp-cf:get-values': {
    call: (s, { expense_id }: any) => s.getExpenseCustomFieldValues(expense_id),
  },
  'feat:exp-formula:eval': {
    call: (s, { formula, vars }: any) => s.evaluateFormula(formula, vars || {}),
  },
  'feat:tag-hier:upsert': {
    call: (s, t: any, { cid }) => s.upsertTagHierarchy({ ...t, company_id: cid }),
    mutates: true,
  },
  'feat:tag-hier:tree': { call: (s, _p: any, { cid }) => s.getTagTree(cid!), requiresCompany: [] },
  'feat:tags:suggest': {
    call: (s, { description }: any, { cid }) => s.suggestTagsForExpense(cid!, description),
    requiresCompany: [],
  },
  'feat:exp:bulk-tag': {
    call: (s, opts: any, { cid }) => s.bulkTagExpenses({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:spend:heatmap': {
    call: (s, opts: any = {}, { cid }) => s.spendHeatmap(cid!, opts),
    requiresCompany: null,
  },
  'feat:spend:forecast-90d': {
    call: (s, _p: any, { cid }) => s.spendForecast90Days(cid!),
    requiresCompany: [],
  },
  'feat:spend:top-vendors': {
    call: (s, opts: any = {}, { cid }) => s.topVendorsByPeriod(cid!, opts),
    requiresCompany: [],
  },
  'feat:spend:top-categories': {
    call: (s, opts: any = {}, { cid }) => s.topCategoriesByPeriod(cid!, opts),
    requiresCompany: [],
  },
  'feat:spend:concentration': {
    call: (s, opts: any = {}, { cid }) => s.vendorConcentrationRisk(cid!, opts),
    requiresCompany: null,
  },
  'feat:spend:employee-benchmarks': {
    call: (s, opts: any = {}, { cid }) => s.employeeSpendBenchmarks(cid!, opts),
    requiresCompany: null,
  },
  'feat:spend:benchmark-vs-industry': {
    call: (s, { industry, total_revenue, ...opts }: any, { cid }) =>
      s.benchmarkVsIndustry(cid!, industry, total_revenue, opts),
    requiresCompany: [],
  },
  'feat:cost-save:generate': {
    call: (s, _p: any, { cid }) => s.generateCostSaveRecs(cid!),
    requiresCompany: null,
  },
  'feat:cost-save:list': {
    call: (s, opts: any = {}, { cid }) => s.listCostSaveRecs(cid!, opts),
    requiresCompany: [],
  },
  'feat:wf-def:upsert': {
    call: (s, w: any, { cid }) => s.upsertApprovalWorkflow({ ...w, company_id: cid }),
    mutates: true,
  },
  'feat:wf-def:match': {
    call: (s, opts: any, { cid }) => s.matchWorkflowForExpense({ ...opts, company_id: cid! }),
    requiresCompany: null,
  },
  'feat:wf-def:list': {
    call: (s, _p: any, { cid }) => s.listApprovalWorkflows(cid!),
    requiresCompany: [],
  },
  'feat:delegation:create': {
    call: (s, d: any, { cid }) => s.createDelegation({ ...d, company_id: cid }),
    mutates: true,
  },
  'feat:delegation:resolve': {
    call: (s, { user_id }: any, { cid }) => s.resolveDelegate(cid!, user_id),
    requiresCompany: null,
  },
  'feat:delegation:list': {
    call: (s, opts: any = {}, { cid }) => s.listDelegations(cid!, opts),
    requiresCompany: [],
  },
  'feat:wf:escalated': {
    call: (s, _p: any, { cid }) => s.findEscalatedWorkflows(cid!),
    requiresCompany: [],
  },
  'feat:wf:log': {
    call: (s, opts: any, { cid }) => s.logWorkflowEvent({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:wf:performance': {
    call: (s, opts: any = {}, { cid }) => s.workflowPerformance(cid!, opts),
    requiresCompany: null,
  },
  'feat:exp-inbox:provision': {
    call: (s, { user_id }: any, { cid }) => s.provisionExpenseInbox(cid!, user_id),
    mutates: true,
    requiresCompany: null,
  },
  'feat:capture:queue': {
    call: (s, opts: any, { cid }) => s.queueReceiptCapture({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:capture:pending': {
    call: (s, { user_id }: any = {}, { cid }) => s.listPendingCaptures(cid!, user_id),
    mutates: true,
    requiresCompany: [],
  },
  'feat:capture:process': {
    call: (s, { capture_id, created_expense_id }: any) => ({
      ok: s.processCapture(capture_id, created_expense_id),
    }),
    mutates: true,
  },
  'feat:voice-memo:attach': { call: (s, opts: any) => s.attachVoiceMemo(opts), mutates: true },
  'feat:voice-memo:list': { call: (s, { expense_id }: any) => s.listVoiceMemos(expense_id) },
  'feat:exp:set-geo': {
    call: (s, { expense_id, lat, lng, location_name }: any) => ({
      ok: s.setExpenseGeo(expense_id, lat, lng, location_name),
    }),
    mutates: true,
  },
  'feat:exp:by-location': {
    call: (s, opts: any = {}, { cid }) => s.expensesByLocation(cid!, opts),
    requiresCompany: [],
  },
  'feat:voice-entry:record': { call: (s, opts: any) => s.recordVoiceEntry(opts), mutates: true },
  'feat:exp-rpt-tpl:save': {
    call: (s, t: any, { cid }) => s.saveReportTemplate({ ...t, company_id: cid }),
    mutates: true,
  },
  'feat:exp-rpt-tpl:list': {
    call: (s, _p: any, { cid }) => s.listReportTemplates(cid!),
    requiresCompany: [],
  },
  'feat:year-end:rollup': {
    call: (s, { tax_year }: any, { cid }) =>
      s.generateYearEndRollup({ company_id: cid!, tax_year }),
    mutates: true,
    requiresCompany: null,
  },
  'feat:quarterly:report': {
    call: (s, { year, quarter }: any, { cid }) => s.generateQuarterlyReport(cid!, year, quarter),
    requiresCompany: null,
  },
  'feat:dept:report': {
    call: (s, { department_id, ...opts }: any, { cid }) =>
      s.departmentExpenseReport(cid!, department_id, opts),
    requiresCompany: null,
  },
  'feat:proj-exp:report': {
    call: (s, { project_id }: any, { cid }) => s.projectExpenseReport(cid!, project_id),
    requiresCompany: null,
  },
  'feat:1099-prep:report': {
    call: (s, { tax_year }: any, { cid }) => s.vendor1099PrepReport(cid!, tax_year),
    requiresCompany: [],
  },
  'feat:schedule-c:breakdown': {
    call: (s, { tax_year }: any, { cid }) => s.scheduleCBreakdown(cid!, tax_year),
    requiresCompany: [],
  },
  'feat:mileage-log:summary': {
    call: (s, { tax_year }: any, { cid }) => s.mileageLogSummary(cid!, tax_year),
    requiresCompany: null,
  },
  'feat:perdiem:summary': {
    call: (s, { tax_year }: any, { cid }) => s.perDiemSummary(cid!, tax_year),
    requiresCompany: null,
  },
  'feat:custom-period:report': {
    call: (s, opts: any, { cid }) => s.customPeriodReport({ ...opts, company_id: cid! }),
    requiresCompany: null,
  },
};

export function registerExpenseCustomMobileFeaturesFeat(ipcMain: IpcMain, deps: IpcDeps): void {
  featHandlers(ipcMain, deps, svc('expense-custom-mobile-features'), EXPENSE_CUSTOM_MOBILE_FEAT);
}
