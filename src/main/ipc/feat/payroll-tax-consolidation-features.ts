import type { IpcMain } from 'electron';
import type { IpcDeps } from '../core/types';
import { featHandlers, type FeatSpec } from '../core/featHandlers';
import { svc } from '../core/svc';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const PAYROLL_TAX_CONSOLIDATION_FEAT: Record<string, FeatSpec<any>> = {
  'feat:state-wh:upsert': { call: (s, t: any) => s.upsertStateWithholding(t), mutates: true },
  'feat:state-wh:calc': { call: (s, opts: any) => s.calcStateWithholding(opts), mutates: true },
  'feat:garn:upsert': {
    call: (s, g: any, { cid }) => s.upsertGarnishment({ ...g, company_id: cid }),
    mutates: true,
  },
  'feat:garn:calc': {
    call: (s, { employee_id, disposable_earnings }: any) =>
      s.calcGarnishmentDeductions(employee_id, disposable_earnings),
    mutates: true,
  },
  'feat:garn:list': {
    call: (s, opts: any = {}, { cid }) => s.listGarnishments(cid!, opts),
    requiresCompany: [],
  },
  'feat:retire:upsert': {
    call: (s, r: any, { cid }) => s.upsertRetirement({ ...r, company_id: cid }),
    mutates: true,
  },
  'feat:retire:calc': {
    call: (s, { employee_id, period_wages }: any) =>
      s.calcRetirementContribution(employee_id, period_wages),
    mutates: true,
  },
  'feat:s125:upsert': {
    call: (svc, s: any, { cid }) => svc.upsertSection125({ ...s, company_id: cid }),
    mutates: true,
  },
  'feat:s125:list': { call: (s, { employee_id }: any) => s.listSection125ForEmployee(employee_id) },
  'feat:pto-rule:upsert': {
    call: (s, r: any, { cid }) => s.upsertPTORule({ ...r, company_id: cid }),
    mutates: true,
  },
  'feat:pto-rule:list': {
    call: (s, _p: any, { cid }) => s.listPTORules(cid!),
    requiresCompany: [],
  },
  'feat:emp-state:set': {
    call: (s, opts: any, { cid }) => s.setEmployeeStateAllocation({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:emp-state:get': {
    call: (s, { employee_id }: any) => s.getEmployeeStateAllocations(employee_id),
  },
  'feat:wcomp:upsert': {
    call: (s, c: any, { cid }) => s.upsertWorkersCompClass({ ...c, company_id: cid }),
    mutates: true,
  },
  'feat:wcomp:calc': {
    call: (s, { state_code, class_code, payroll }: any, { cid }) =>
      s.calcWorkersCompPremium(cid!, state_code, class_code, payroll),
    mutates: true,
    requiresCompany: 0,
  },
  'feat:recip:upsert': {
    call: (s, { work_state, resident_state, has_reciprocity, certificate_form }: any) =>
      s.upsertReciprocity(work_state, resident_state, has_reciprocity, certificate_form),
    mutates: true,
  },
  'feat:recip:check': {
    call: (s, { work_state, resident_state }: any) => s.hasReciprocity(work_state, resident_state),
  },
  'feat:w2:run': {
    call: (s, opts: any, { cid }) => s.createW2Run({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:dd-batch:build': {
    call: (s, opts: any, { cid }) => s.buildNACHABatch({ ...opts, company_id: cid }),
  },
  'feat:dd-batch:list': {
    call: (s, { limit }: any = {}, { cid }) => s.listDirectDepositBatches(cid!, limit),
    requiresCompany: [],
  },
  'feat:nexus:upsert': {
    call: (s, n: any, { cid }) => s.upsertNexus({ ...n, company_id: cid }),
    mutates: true,
  },
  'feat:nexus:evaluate': {
    call: (s, _p: any, { cid }) => s.evaluateNexus(cid!),
    requiresCompany: [],
  },
  'feat:tax-juris:upsert': { call: (s, j: any) => s.upsertJurisdiction(j), mutates: true },
  'feat:tax-juris:by-zip': { call: (s, { zip }: any) => s.lookupTaxRateByZip(zip) },
  'feat:exempt-cert:upsert': {
    call: (s, c: any, { cid }) => s.upsertExemptionCert({ ...c, company_id: cid }),
    mutates: true,
  },
  'feat:exempt-cert:check': {
    call: (s, { customer_id, state_code }: any, { cid }) =>
      s.isCustomerExempt(cid!, customer_id, state_code),
    requiresCompany: false,
  },
  'feat:exempt-cert:list': {
    call: (s, opts: any = {}, { cid }) => s.listExemptionCerts(cid!, opts),
    requiresCompany: [],
  },
  'feat:use-tax:record': {
    call: (s, u: any, { cid }) => s.recordUseTax({ ...u, company_id: cid }),
    mutates: true,
  },
  'feat:tax-sched:upsert': {
    call: (svc, s: any, { cid }) => svc.upsertFilingSchedule({ ...s, company_id: cid }),
    mutates: true,
  },
  'feat:tax-sched:upcoming': {
    call: (s, { days_ahead }: any = {}, { cid }) => s.listUpcomingFilings(cid!, days_ahead || 30),
    requiresCompany: [],
  },
  'feat:tax-liab:record': {
    call: (s, l: any, { cid }) => s.recordSalesTaxLiability({ ...l, company_id: cid }),
    mutates: true,
  },
  'feat:tax-liab:mark-paid': {
    call: (s, { id, payment_je_id }: any) => ({ ok: s.markTaxPaid(id, payment_je_id) }),
    mutates: true,
  },
  'feat:tax-liab:list': {
    call: (s, opts: any = {}, { cid }) => s.listTaxLiability(cid!, opts),
    requiresCompany: [],
  },
  'feat:tax-holiday:upsert': { call: (s, h: any) => s.upsertSalesTaxHoliday(h), mutates: true },
  'feat:tax-holiday:active': {
    call: (s, { state_code }: any = {}) => s.listActiveSalesTaxHolidays(state_code),
  },
  'feat:entity:set-sub': {
    call: (s, { parent_id, child_id, ownership_pct, method, notes }: any) =>
      s.setSubsidiary(parent_id, child_id, ownership_pct, method, notes),
    mutates: true,
  },
  'feat:entity:hierarchy': { call: (s, { parent_id }: any) => s.getEntityHierarchy(parent_id) },
  'feat:elim-rule:upsert': { call: (s, r: any) => s.upsertElimRule(r), mutates: true },
  'feat:elim-rule:list': { call: (s, { parent_id }: any) => s.listElimRules(parent_id) },
  'feat:consol:generate': { call: (s, opts: any) => s.generateConsolidatedStatement(opts) },
  'feat:fx-translation:record': {
    call: (s, t: any) => s.recordCurrencyTranslation(t),
    mutates: true,
  },
  'feat:minority:calc': { call: (s, opts: any) => s.calcMinorityInterest(opts), mutates: true },
  'feat:goodwill:record': { call: (s, g: any) => s.recordGoodwill(g), mutates: true },
  'feat:goodwill:impair': {
    call: (s, { goodwill_id, impairment_amount }: any) => ({
      ok: s.recordGoodwillImpairment(goodwill_id, impairment_amount),
    }),
    mutates: true,
  },
  'feat:equity-inv:upsert': { call: (s, e: any) => s.upsertEquityInvestment(e), mutates: true },
  'feat:equity-inv:record-income': {
    call: (s, { investment_id, investee_income }: any) =>
      s.recordEquityShareIncome(investment_id, investee_income),
    mutates: true,
  },
  'feat:equity-inv:list': {
    call: (s, { investor_company_id }: any) => s.listEquityInvestments(investor_company_id),
  },
};

export function registerPayrollTaxConsolidationFeaturesFeat(ipcMain: IpcMain, deps: IpcDeps): void {
  featHandlers(
    ipcMain,
    deps,
    svc('payroll-tax-consolidation-features'),
    PAYROLL_TAX_CONSOLIDATION_FEAT,
  );
}
