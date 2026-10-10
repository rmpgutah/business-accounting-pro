import type { IpcMain } from 'electron';
import type { IpcDeps } from '../core/types';
import { featHandlers, type FeatSpec } from '../core/featHandlers';
import { svc } from '../core/svc';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const EXPENSE_FINANCE_FEAT: Record<string, FeatSpec<any>> = {
  'feat:exp-report:create': {
    call: (s, r: any, { cid }) => s.createExpenseReport({ ...r, company_id: cid }),
    mutates: true,
  },
  'feat:exp-report:add-expenses': {
    call: (s, { report_id, expense_ids }: any) => s.addExpensesToReport(report_id, expense_ids),
    mutates: true,
  },
  'feat:exp-report:submit': {
    call: (s, { report_id }: any) => ({ ok: s.submitExpenseReport(report_id) }),
    mutates: true,
  },
  'feat:exp-report:approve': {
    call: (s, { report_id, approved_by }: any) => ({
      ok: s.approveExpenseReport(report_id, approved_by),
    }),
    mutates: true,
  },
  'feat:exp-report:list': {
    call: (s, opts: any = {}, { cid }) => s.listExpenseReports(cid!, opts),
    requiresCompany: [],
  },
  'feat:perdiem:upsert': {
    call: (s, p: any, { cid }) => s.upsertPerDiem({ ...p, company_id: cid }),
    mutates: true,
  },
  'feat:perdiem:calc': {
    call: (s, { location, days, include_lodging }: any, { cid }) =>
      s.calcPerDiem(cid!, location, days, include_lodging),
    mutates: true,
    requiresCompany: null,
  },
  'feat:vehicle:upsert': {
    call: (s, v: any, { cid }) => s.upsertVehicle({ ...v, company_id: cid }),
    mutates: true,
  },
  'feat:vehicle:list': { call: (s, { user_id }: any) => s.listVehicles(user_id) },
  'feat:exp:recurring': {
    call: (s, _p: any, { cid }) => s.listRecurringExpenses(cid!),
    requiresCompany: [],
  },
  'feat:exp:forecast': {
    call: (s, { months_ahead }: any = {}, { cid }) => s.forecastExpenses(cid!, months_ahead || 3),
    requiresCompany: [],
  },
  'feat:vendor-1099:recalc': {
    call: (s, { tax_year, vendor_id }: any, { cid }) =>
      s.recalcVendor1099(cid!, tax_year, vendor_id),
    requiresCompany: null,
  },
  'feat:vendor-1099:required': {
    call: (s, { tax_year }: any, { cid }) => s.listVendors1099Required(cid!, tax_year),
    requiresCompany: [],
  },
  'feat:cat-budget:upsert': {
    call: (s, b: any, { cid }) => s.upsertCategoryBudget({ ...b, company_id: cid }),
    mutates: true,
  },
  'feat:cat-budget:refresh-actuals': {
    call: (s, { fiscal_year }: any, { cid }) => s.refreshCategoryActuals(cid!, fiscal_year),
    mutates: true,
    requiresCompany: null,
  },
  'feat:reimb:create': {
    call: (s, r: any, { cid }) => s.createReimbursement({ ...r, company_id: cid }),
    mutates: true,
  },
  'feat:reimb:paid': {
    call: (s, { id, je_id, payment_method }: any) => ({
      ok: s.markReimbursementPaid(id, je_id, payment_method),
    }),
    mutates: true,
  },
  'feat:exp:rebillable': {
    call: (s, { expense_id, client_id, markup_pct }: any) => ({
      ok: s.markExpenseRebillable(expense_id, client_id, markup_pct),
    }),
    mutates: true,
  },
  'feat:exp:rebillable-list': {
    call: (s, { client_id }: any = {}, { cid }) => s.listRebillableExpenses(cid!, client_id),
    requiresCompany: [],
  },
  'feat:exp:rebilled': {
    call: (s, { expense_id, invoice_id }: any) => ({
      ok: s.markExpenseRebilled(expense_id, invoice_id),
    }),
    mutates: true,
  },
  'feat:preapproval:request': {
    call: (s, p: any, { cid }) => s.requestPreApproval({ ...p, company_id: cid }),
  },
  'feat:preapproval:approve': {
    call: (s, { id, approved_by }: any) => ({ ok: s.approvePreApproval(id, approved_by) }),
    mutates: true,
  },
  'feat:preapproval:reject': {
    call: (s, { id, reason }: any) => ({ ok: s.rejectPreApproval(id, reason) }),
  },
  'feat:preapproval:list': {
    call: (s, opts: any = {}, { cid }) => s.listPreApprovals(cid!, opts),
    requiresCompany: [],
  },
  'feat:ar-aging:chart': {
    call: (s, { as_of_date }: any = {}, { cid }) => s.arAgingChart(cid!, as_of_date),
    requiresCompany: [],
  },
  'feat:ap-aging:chart': {
    call: (s, { as_of_date }: any = {}, { cid }) => s.apAgingChart(cid!, as_of_date),
    requiresCompany: [],
  },
  'feat:dso:calc': {
    call: (s, { period_days }: any = {}, { cid }) => s.calcDSO(cid!, period_days || 365),
    mutates: true,
    requiresCompany: null,
  },
  'feat:dpo:calc': {
    call: (s, { period_days }: any = {}, { cid }) => s.calcDPO(cid!, period_days || 365),
    mutates: true,
    requiresCompany: null,
  },
  'feat:ccc:calc': {
    call: (s, { period_days }: any = {}, { cid }) =>
      s.calcCashConversionCycle(cid!, period_days || 365),
    mutates: true,
    requiresCompany: null,
  },
  'feat:working-capital:calc': {
    call: (s, _p: any, { cid }) => s.calcWorkingCapital(cid!),
    mutates: true,
    requiresCompany: null,
  },
  'feat:burn:calc': {
    call: (s, { months_history }: any = {}, { cid }) => s.calcBurnRate(cid!, months_history || 3),
    mutates: true,
    requiresCompany: null,
  },
  'feat:runway:calc': {
    call: (s, { months_history }: any = {}, { cid }) => s.calcRunway(cid!, months_history || 3),
    mutates: true,
    requiresCompany: null,
  },
  'feat:ltv:calc': {
    call: (s, { customer_id }: any = {}, { cid }) => s.calcLTV(cid!, customer_id),
    mutates: true,
    requiresCompany: null,
  },
  'feat:cac:calc': {
    call: (s, { period_days }: any = {}, { cid }) => s.calcCAC(cid!, period_days || 365),
    mutates: true,
    requiresCompany: null,
  },
  'feat:ltv-cac:ratio': {
    call: (s, _p: any, { cid }) => s.calcLTVCACRatio(cid!),
    requiresCompany: null,
  },
  'feat:retention:calc': {
    call: (s, { period_start, period_end }: any, { cid }) =>
      s.calcRevenueRetention(cid!, period_start, period_end),
    mutates: true,
    requiresCompany: null,
  },
  'feat:cohort:build': {
    call: (s, _p: any, { cid }) => s.buildCohortAnalysis(cid!),
    requiresCompany: [],
  },
  'feat:1099-run:create': {
    call: (s, opts: any, { cid }) => s.createForm1099Run({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:1099-run:list': {
    call: (s, _p: any, { cid }) => s.listForm1099Runs(cid!),
    requiresCompany: [],
  },
  'feat:withhold:record': {
    call: (s, w: any, { cid }) => s.recordWithholding({ ...w, company_id: cid }),
    mutates: true,
  },
  'feat:qtax:record': {
    call: (s, q: any, { cid }) => s.recordQuarterlyEstimate({ ...q, company_id: cid }),
    mutates: true,
  },
  'feat:qtax:list': {
    call: (s, { tax_year }: any, { cid }) => s.listQuarterlyEstimates(cid!, tax_year),
    requiresCompany: [],
  },
  'feat:tax-prov:calc': {
    call: (s, opts: any, { cid }) => s.calcTaxProvision({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:rd-credit:calc': {
    call: (s, opts: any, { cid }) => s.calcRDCredit({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:179:elect': { call: (s, opts: any, { cid }) => s.elect179({ ...opts, company_id: cid }) },
  'feat:179:list': {
    call: (s, { tax_year }: any = {}, { cid }) => s.list179Elections(cid!, tax_year),
    requiresCompany: [],
  },
  'feat:vend-onboard:start': {
    call: (s, opts: any, { cid }) => s.startVendorOnboarding({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:vend-onboard:update': {
    call: (s, { id, items_completed }: any) => s.updateOnboardingProgress(id, items_completed),
    mutates: true,
  },
  'feat:w9:record': {
    call: (s, w: any, { cid }) => s.recordW9({ ...w, company_id: cid }),
    mutates: true,
  },
  'feat:w9:missing': {
    call: (s, _p: any, { cid }) => s.vendorsMissingW9(cid!),
    requiresCompany: [],
  },
  'feat:vend-ins:record': {
    call: (s, opts: any, { cid }) => s.recordVendorInsurance({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:vend-ins:expiring': {
    call: (s, { days_ahead }: any = {}, { cid }) =>
      s.expiringVendorInsurance(cid!, days_ahead || 30),
    requiresCompany: [],
  },
  'feat:vend:score': {
    call: (s, { vendor_id }: any, { cid }) => s.calcVendorScore(cid!, vendor_id),
    requiresCompany: null,
  },
  'feat:vend-disp:open': {
    call: (s, d: any, { cid }) => s.openVendorDispute({ ...d, company_id: cid }),
    mutates: true,
  },
  'feat:vend-disp:resolve': {
    call: (s, { id, resolution_amount, notes }: any) => ({
      ok: s.resolveVendorDispute(id, resolution_amount, notes),
    }),
  },
  'feat:vend-disp:list': {
    call: (s, opts: any = {}, { cid }) => s.listVendorDisputes(cid!, opts),
    requiresCompany: [],
  },
};

export function registerExpenseFinanceFeaturesFeat(ipcMain: IpcMain, deps: IpcDeps): void {
  featHandlers(ipcMain, deps, svc('expense-finance-features'), EXPENSE_FINANCE_FEAT);
}
