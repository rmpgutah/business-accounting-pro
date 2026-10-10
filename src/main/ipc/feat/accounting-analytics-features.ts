import type { IpcMain } from 'electron';
import type { IpcDeps } from '../core/types';
import { featHandlers, type FeatSpec } from '../core/featHandlers';
import { svc } from '../core/svc';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ACCOUNTING_ANALYTICS_FEAT: Record<string, FeatSpec<any>> = {
  'feat:cost-center:upsert': {
    call: (s, c: any, { cid }) => s.upsertCostCenter({ ...c, company_id: cid }),
    mutates: true,
  },
  'feat:cost-center:list': {
    call: (s, { active_only }: any = {}, { cid }) => s.listCostCenters(cid!, !!active_only),
    requiresCompany: [],
  },
  'feat:cost-alloc:upsert': {
    call: (s, r: any, { cid }) => s.upsertCostAllocationRule({ ...r, company_id: cid }),
    mutates: true,
  },
  'feat:cost-alloc:run': {
    call: (s, { rule_id, amount }: any) => s.runCostAllocation(rule_id, amount),
    mutates: true,
  },
  'feat:cost-alloc:list': {
    call: (s, _p: any, { cid }) => s.listAllocationRulesF(cid!),
    requiresCompany: [],
  },
  'feat:dept:upsert': {
    call: (s, d: any, { cid }) => s.upsertDepartment({ ...d, company_id: cid }),
    mutates: true,
  },
  'feat:dept:list': {
    call: (s, { active_only }: any = {}, { cid }) => s.listDepartments(cid!, !!active_only),
    requiresCompany: [],
  },
  'feat:dept:pl': {
    call: (s, { department_id, period_start, period_end }: any, { cid }) =>
      s.departmentPL(cid!, department_id, period_start, period_end),
    requiresCompany: null,
  },
  'feat:cost-pool:upsert': {
    call: (s, p: any, { cid }) => s.upsertCostPool({ ...p, company_id: cid }),
    mutates: true,
  },
  'feat:cost-pool:list': {
    call: (s, _p: any, { cid }) => s.listCostPools(cid!),
    requiresCompany: [],
  },
  'feat:std-cost:upsert': {
    call: (svc, s: any, { cid }) => svc.upsertStandardCost({ ...s, company_id: cid }),
    mutates: true,
  },
  'feat:std-cost:list': {
    call: (s, opts: any = {}, { cid }) => s.listStandardCosts(cid!, opts),
    requiresCompany: [],
  },
  'feat:variance:calc': {
    call: (s, v: any, { cid }) => s.calculateVariance({ ...v, company_id: cid }),
    mutates: true,
  },
  'feat:variance:list': {
    call: (s, opts: any = {}, { cid }) => s.listVarianceAnalyses(cid!, opts),
    requiresCompany: [],
  },
  'feat:overhead:upsert': {
    call: (s, r: any, { cid }) => s.upsertOverheadRate({ ...r, company_id: cid }),
    mutates: true,
  },
  'feat:overhead:apply': {
    call: (s, { rate_id, units }: any) => s.applyOverhead(rate_id, units),
    mutates: true,
  },
  'feat:overhead:list': {
    call: (s, _p: any, { cid }) => s.listOverheadRates(cid!),
    requiresCompany: [],
  },
  'feat:wip:upsert': {
    call: (s, w: any, { cid }) => s.upsertWIP({ ...w, company_id: cid }),
    mutates: true,
  },
  'feat:wip:list': {
    call: (s, opts: any = {}, { cid }) => s.listWIP(cid!, opts),
    requiresCompany: [],
  },
  'feat:cogs:compute': {
    call: (s, { period_start, period_end }: any, { cid }) =>
      s.computeCOGS(cid!, period_start, period_end),
    requiresCompany: null,
  },
  'feat:burden:upsert': {
    call: (s, b: any, { cid }) => s.upsertBurdenRate({ ...b, company_id: cid }),
    mutates: true,
  },
  'feat:burden:list': {
    call: (s, _p: any, { cid }) => s.listBurdenRates(cid!),
    requiresCompany: [],
  },
  'feat:tb-snap:capture': {
    call: (s, { period_end, fiscal_year }: any, { cid }) =>
      s.captureTBSnapshot(cid!, period_end, fiscal_year),
    mutates: true,
    requiresCompany: null,
  },
  'feat:tb-snap:compare': {
    call: (s, { period_end_1, period_end_2 }: any, { cid }) =>
      s.compareTBSnapshots(cid!, period_end_1, period_end_2),
    requiresCompany: [],
  },
  'feat:tb-snap:list': {
    call: (s, _p: any, { cid }) => s.listTBSnapshots(cid!),
    requiresCompany: [],
  },
  'feat:materiality:calc': {
    call: (s, m: any, { cid }) => s.calculateMateriality({ ...m, company_id: cid }),
    mutates: true,
  },
  'feat:materiality:list': {
    call: (s, _p: any, { cid }) => s.listMaterialityCalcs(cid!),
    requiresCompany: [],
  },
  'feat:audit-sample:generate': {
    call: (s, opts: any, { cid }) => s.generateAuditSample({ ...opts, company_id: cid }),
  },
  'feat:audit-sample:list': {
    call: (s, _p: any, { cid }) => s.listAuditSamples(cid!),
    requiresCompany: [],
  },
  'feat:audit-confirm:upsert': {
    call: (s, c: any, { cid }) => s.upsertAuditConfirmation({ ...c, company_id: cid }),
    mutates: true,
  },
  'feat:audit-confirm:list': {
    call: (s, opts: any = {}, { cid }) => s.listAuditConfirmations(cid!, opts),
    requiresCompany: [],
  },
  'feat:walkthrough:record': {
    call: (s, w: any, { cid }) => s.recordWalkthrough({ ...w, company_id: cid }),
    mutates: true,
  },
  'feat:walkthrough:list': {
    call: (s, _p: any, { cid }) => s.listWalkthroughs(cid!),
    requiresCompany: [],
  },
  'feat:sod:declare': {
    call: (s, c: any, { cid }) => s.declareSoDConflict({ ...c, company_id: cid }),
  },
  'feat:sod:assign': {
    call: (s, a: any, { cid }) => s.assignUserFunction({ ...a, company_id: cid }),
  },
  'feat:sod:check': {
    call: (s, { user_id }: any, { cid }) => s.checkSoDForUser(cid!, user_id),
    requiresCompany: null,
  },
  'feat:sod:list': { call: (s, _p: any, { cid }) => s.listSoDConflicts(cid!), requiresCompany: [] },
  'feat:rcsa:upsert': {
    call: (s, r: any, { cid }) => s.upsertRCSA({ ...r, company_id: cid }),
    mutates: true,
  },
  'feat:rcsa:list': {
    call: (s, opts: any = {}, { cid }) => s.listRCSAs(cid!, opts),
    requiresCompany: [],
  },
  'feat:audit-issue:upsert': {
    call: (s, i: any, { cid }) => s.upsertAuditIssue({ ...i, company_id: cid }),
    mutates: true,
  },
  'feat:audit-issue:resolve': {
    call: (s, { id, resolution_notes }: any) => ({ ok: s.resolveAuditIssue(id, resolution_notes) }),
  },
  'feat:audit-issue:list': {
    call: (s, opts: any = {}, { cid }) => s.listAuditIssues(cid!, opts),
    requiresCompany: [],
  },
  'feat:control-def:log': {
    call: (s, d: any, { cid }) => s.logControlDeficiency({ ...d, company_id: cid }),
    mutates: true,
  },
  'feat:control-def:remediate': { call: (s, { id }: any) => ({ ok: s.remediateDeficiency(id) }) },
  'feat:control-def:list': {
    call: (s, opts: any = {}, { cid }) => s.listControlDeficiencies(cid!, opts),
    requiresCompany: [],
  },
  'feat:auditor-inq:log': {
    call: (s, i: any, { cid }) => s.logAuditorInquiry({ ...i, company_id: cid }),
    mutates: true,
  },
  'feat:auditor-inq:respond': {
    call: (s, { id, response_text, response_by, supporting_docs }: any) => ({
      ok: s.respondToInquiry(id, response_text, response_by, supporting_docs),
    }),
  },
  'feat:auditor-inq:list': {
    call: (s, opts: any = {}, { cid }) => s.listAuditorInquiries(cid!, opts),
    requiresCompany: [],
  },
  'feat:roll-fcst:upsert': {
    call: (s, f: any, { cid }) => s.upsertRollingForecast({ ...f, company_id: cid }),
    mutates: true,
  },
  'feat:roll-fcst:set-lines': {
    call: (s, { forecast_id, lines }: any) => s.setForecastLines(forecast_id, lines || []),
    mutates: true,
  },
  'feat:roll-fcst:get-lines': {
    call: (s, { forecast_id }: any) => s.getForecastLines(forecast_id),
  },
  'feat:roll-fcst:list': {
    call: (s, _p: any, { cid }) => s.listRollingForecasts(cid!),
    requiresCompany: [],
  },
  'feat:scenario:create': {
    call: (svc, s: any, { cid }) => svc.createScenario({ ...s, company_id: cid }),
    mutates: true,
  },
  'feat:scenario:apply': {
    call: (s, { base_lines, assumptions }: any) =>
      s.applyAssumptions(base_lines || [], assumptions || {}),
    mutates: true,
  },
  'feat:scenario:list': {
    call: (s, _p: any, { cid }) => s.listScenarios(cid!),
    requiresCompany: [],
  },
  'feat:variance-expl:record': {
    call: (s, v: any, { cid }) => s.recordVarianceExplanation({ ...v, company_id: cid }),
    mutates: true,
  },
  'feat:variance-expl:list': {
    call: (s, opts: any = {}, { cid }) => s.listVarianceExplanations(cid!, opts),
    requiresCompany: [],
  },
  'feat:driver:upsert': {
    call: (s, d: any, { cid }) => s.upsertBudgetDriver({ ...d, company_id: cid }),
    mutates: true,
  },
  'feat:driver:project': {
    call: (s, { driver_id, periods }: any) => s.projectFromDriver(driver_id, periods),
  },
  'feat:driver:list': {
    call: (s, _p: any, { cid }) => s.listBudgetDrivers(cid!),
    requiresCompany: [],
  },
  'feat:budget-cons:create': {
    call: (s, c: any, { cid }) => s.createBudgetConsolidation({ ...c, company_id: cid }),
    mutates: true,
  },
  'feat:budget-cons:approve': {
    call: (s, { id, approved_by }: any) => ({ ok: s.approveBudgetConsolidation(id, approved_by) }),
    mutates: true,
  },
  'feat:budget-cons:list': {
    call: (s, _p: any, { cid }) => s.listBudgetConsolidations(cid!),
    requiresCompany: [],
  },
  'feat:budget-appr:log': {
    call: (s, a: any, { cid }) => s.logBudgetApproval({ ...a, company_id: cid }),
    mutates: true,
  },
  'feat:budget-appr:list': { call: (s, { budget_id }: any) => s.listBudgetApprovals(budget_id) },
  'feat:fcst-acc:record': {
    call: (s, a: any, { cid }) => s.recordForecastAccuracy({ ...a, company_id: cid }),
    mutates: true,
  },
  'feat:fcst-acc:summary': {
    call: (s, { forecast_id }: any = {}, { cid }) => s.summarizeForecastAccuracy(cid!, forecast_id),
    requiresCompany: null,
  },
  'feat:direct-cash:upsert': {
    call: (s, f: any, { cid }) => s.upsertDirectCashForecast({ ...f, company_id: cid }),
    mutates: true,
  },
  'feat:direct-cash:list': {
    call: (s, { limit }: any = {}, { cid }) => s.listDirectCashForecasts(cid!, limit),
    requiresCompany: [],
  },
  'feat:headcount:upsert': {
    call: (s, h: any, { cid }) => s.upsertHeadcountBudget({ ...h, company_id: cid }),
    mutates: true,
  },
  'feat:headcount:list': {
    call: (s, opts: any = {}, { cid }) => s.listHeadcountBudgets(cid!, opts),
    requiresCompany: [],
  },
  'feat:capex:upsert': {
    call: (s, c: any, { cid }) => s.upsertCapEx({ ...c, company_id: cid }),
    mutates: true,
  },
  'feat:capex:approve': {
    call: (s, { id, approved_cost, approved_by }: any) => ({
      ok: s.approveCapEx(id, approved_cost, approved_by),
    }),
    mutates: true,
  },
  'feat:capex:list': {
    call: (s, opts: any = {}, { cid }) => s.listCapEx(cid!, opts),
    requiresCompany: [],
  },
  'feat:stmt-cfg:upsert': {
    call: (s, c: any, { cid }) => s.upsertStatementConfig({ ...c, company_id: cid }),
    mutates: true,
  },
  'feat:stmt-cfg:list': {
    call: (s, { statement_type }: any = {}, { cid }) =>
      s.listStatementConfigs(cid!, statement_type),
    requiresCompany: [],
  },
  'feat:common-size': {
    call: (s, { lines, base_amount }: any) => s.commonSizeStatement(lines || [], base_amount),
  },
  'feat:ratios:calc': {
    call: (s, { as_of_date }: any, { cid }) => s.calculateRatios(cid!, as_of_date),
    mutates: true,
    requiresCompany: null,
  },
  'feat:ratios:list': {
    call: (s, { limit }: any = {}, { cid }) => s.listRatios(cid!, limit),
    requiresCompany: [],
  },
  'feat:kpi:upsert': {
    call: (s, k: any, { cid }) => s.upsertKPI({ ...k, company_id: cid }),
    mutates: true,
  },
  'feat:kpi:list': { call: (s, _p: any, { cid }) => s.listKPIs(cid!), requiresCompany: [] },
  'feat:footnote:upsert': {
    call: (s, f: any, { cid }) => s.upsertFootnote({ ...f, company_id: cid }),
    mutates: true,
  },
  'feat:footnote:list': {
    call: (s, opts: any = {}, { cid }) => s.listFootnotes(cid!, opts),
    requiresCompany: [],
  },
};

export function registerAccountingAnalyticsFeaturesFeat(ipcMain: IpcMain, deps: IpcDeps): void {
  featHandlers(ipcMain, deps, svc('accounting-analytics-features'), ACCOUNTING_ANALYTICS_FEAT);
}
