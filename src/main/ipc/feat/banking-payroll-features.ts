import type { IpcMain } from 'electron';
import type { IpcDeps } from '../core/types';
import { featHandlers, type FeatSpec } from '../core/featHandlers';
import { svc } from '../core/svc';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const BANKING_PAYROLL_FEAT: Record<string, FeatSpec<any>> = {
  'feat:bank-rule:upsert': {
    call: (s, rule: any, { cid }) => s.upsertBankRule({ ...rule, company_id: cid }),
    mutates: true,
  },
  'feat:bank-rule:list': {
    call: (s, _p: any, { cid }) => s.listBankRules(cid!),
    requiresCompany: [],
  },
  'feat:bank-rule:apply': {
    call: (s, { txn_ids }: any = {}, { cid }) => s.applyRulesToTransactions(cid!, txn_ids),
    mutates: true,
    requiresCompany: { matched: 0, updated: 0 },
  },
  'feat:recon:auto-match': {
    call: (s, { account_id, date_window }: any, { cid }) =>
      s.autoMatchReconciliation(cid!, account_id, date_window),
    requiresCompany: { matches: 0, suggestions: [] },
  },
  'feat:bank-tx:duplicates': {
    call: (s, { days_window }: any = {}, { cid }) =>
      s.detectDuplicateTransactions(cid!, days_window),
    requiresCompany: [],
  },
  'feat:bank-tx:flag-duplicate': {
    call: (s, { txn_id, duplicate_of, confidence }: any) => ({
      ok: s.flagDuplicateTransaction(txn_id, duplicate_of, confidence),
    }),
    mutates: true,
  },
  'feat:bank-tx:transfers': {
    call: (s, { date_window }: any = {}, { cid }) => s.detectTransfers(cid!, date_window),
    requiresCompany: [],
  },
  'feat:bank-tx:confirm-transfer': {
    call: (s, { outflow_id, inflow_id }: any) => ({
      ok: s.confirmTransfer(outflow_id, inflow_id),
    }),
    mutates: true,
  },
  'feat:bank:project-balance': {
    call: (s, { account_id, days_ahead }: any, { cid }) =>
      s.projectBankBalance(cid!, account_id, days_ahead),
    requiresCompany: null,
  },
  'feat:csv-mapping:upsert': {
    call: (s, record: any, { cid }) => s.upsertCsvMapping({ ...record, company_id: cid }),
    mutates: true,
  },
  'feat:csv-mapping:list': {
    call: (s, _p: any, { cid }) => s.listCsvMappings(cid!),
    requiresCompany: [],
  },
  'feat:recon:history': {
    call: (s, { account_id, limit }: any = {}, { cid }) =>
      s.getReconciliationHistory(cid!, account_id, limit),
    requiresCompany: [],
  },
  'feat:bank:outstanding-deposits': {
    call: (s, _p: any, { cid }) => s.getOutstandingDeposits(cid!),
    requiresCompany: [],
  },
  'feat:salary-review:record': {
    call: (s, record: any, { cid }) => s.recordSalaryReview({ ...record, company_id: cid }),
    mutates: true,
  },
  'feat:salary-review:list': {
    call: (s, { employee_id }: any) => s.getSalaryReviews(employee_id),
  },
  'feat:pay-stubs:bulk': {
    call: (s, opts: any, { cid }) => s.getPayStubsForBulkDownload(cid!, opts),
    mutates: true,
    requiresCompany: [],
  },
  'feat:time-off:set-balance': {
    call: (s, record: any, { cid }) => s.setTimeOffBalance({ ...record, company_id: cid }),
    mutates: true,
  },
  'feat:time-off:request': {
    call: (s, record: any, { cid }) => s.requestTimeOff({ ...record, company_id: cid }),
    mutates: true,
  },
  'feat:time-off:approve': {
    call: (s, { request_id, approved_by }: any) => ({
      ok: s.approveTimeOff(request_id, approved_by),
    }),
    mutates: true,
  },
  'feat:time-off:balances': {
    call: (s, { employee_id }: any = {}, { cid }) => s.getTimeOffBalances(cid!, employee_id),
    requiresCompany: [],
  },
  'feat:bonus:calculate': { call: (s, opts: any) => s.calculateBonus(opts) },
  'feat:state-tax:rates': { call: (s, { state }: any) => s.getStateTaxRates(state) },
  'feat:payroll:forecast': {
    call: (s, { months_ahead }: any = {}, { cid }) => s.forecastPayrollCost(cid!, months_ahead),
    requiresCompany: null,
  },
  'feat:onboarding:create': {
    call: (s, { employee_id, hire_date, template_id }: any, { cid }) =>
      s.createOnboardingChecklist(cid!, employee_id, hire_date, template_id),
    mutates: true,
    requiresCompany: null,
  },
  'feat:onboarding:complete': {
    call: (s, { id, completed_by, notes }: any) => ({
      ok: s.completeOnboardingItem(id, completed_by, notes),
    }),
    mutates: true,
  },
  'feat:onboarding:progress': {
    call: (s, { employee_id }: any) => s.getOnboardingProgress(employee_id),
  },
};

export function registerBankingPayrollFeaturesFeat(ipcMain: IpcMain, deps: IpcDeps): void {
  featHandlers(ipcMain, deps, svc('banking-payroll-features'), BANKING_PAYROLL_FEAT);
}
