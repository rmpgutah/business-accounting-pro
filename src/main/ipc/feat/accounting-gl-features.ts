import type { IpcMain } from 'electron';
import type { IpcDeps } from '../core/types';
import { featHandlers, type FeatSpec } from '../core/featHandlers';
import { svc } from '../core/svc';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ACCOUNTING_GL_FEAT: Record<string, FeatSpec<any>> = {
  'feat:recurring-je:upsert': {
    call: (s, r: any, { cid }) => s.upsertRecurringJE({ ...r, company_id: cid }),
    mutates: true,
  },
  'feat:recurring-je:list': {
    call: (s, { active_only }: any = {}, { cid }) => s.listRecurringJEs(cid!, { active_only }),
    requiresCompany: [],
  },
  'feat:recurring-je:due': {
    call: (s, _p: any, { cid }) => s.dueRecurringJEs(cid!),
    requiresCompany: [],
  },
  'feat:recurring-je:advance': { call: (s, { id }: any) => s.advanceRecurringJE(id) },
  'feat:recurring-je:pause': {
    call: (s, { id, paused }: any) => ({ ok: s.pauseRecurringJE(id, paused !== false) }),
  },
  'feat:reversing-je:mark': {
    call: (s, { je_id, reverse_on_date }: any) => ({
      ok: s.markJEReversing(je_id, reverse_on_date),
    }),
    mutates: true,
  },
  'feat:reversing-je:link': {
    call: (s, { original_je_id, reversing_je_id }: any) => ({
      ok: s.linkReversingJE(original_je_id, reversing_je_id),
    }),
  },
  'feat:reversing-je:due': {
    call: (s, _p: any, { cid }) => s.dueReversingEntries(cid!),
    requiresCompany: [],
  },
  'feat:je-template:upsert': {
    call: (s, t: any, { cid }) => s.upsertJETemplate({ ...t, company_id: cid }),
    mutates: true,
  },
  'feat:je-template:list': {
    call: (s, { category }: any = {}, { cid }) => s.listJETemplates(cid!, category),
    requiresCompany: [],
  },
  'feat:je-template:use': {
    call: (s, { id }: any) => {
      s.incrementTemplateUse(id);
      return { ok: true };
    },
  },
  'feat:je-fx:calc': {
    call: (s, { amount, from_rate, to_rate }: any) =>
      s.calcFxAdjustment(amount, from_rate, to_rate),
    mutates: true,
  },
  'feat:ic-je:pair': {
    call: (s, opts: any) =>
      s.pairInterCompanyJEs(
        opts.parent_je_id,
        opts.counterparty_je_id,
        opts.parent_company_id,
        opts.counterparty_company_id,
        opts.notes,
      ),
  },
  'feat:ic-je:list': {
    call: (s, _p: any, { cid }) => s.listInterCompanyPairs(cid!),
    requiresCompany: [],
  },
  'feat:je-import:start': {
    call: (s, { file_name, imported_by }: any, { cid }) =>
      s.startJEImport(cid!, file_name, imported_by),
    mutates: true,
    requiresCompany: null,
  },
  'feat:je-import:finish': {
    call: (s, { id, ...summary }: any) => ({ ok: s.finishJEImport(id, summary) }),
  },
  'feat:je-import:list': {
    call: (s, { limit }: any = {}, { cid }) => s.listJEImports(cid!, limit),
    requiresCompany: [],
  },
  'feat:je:clone-lines': { call: (s, { source_je_id }: any) => s.cloneJELines(source_je_id) },
  'feat:je-attach:add': { call: (s, a: any) => s.addJEAttachment(a), mutates: true },
  'feat:je-attach:list': { call: (s, { je_id }: any) => s.listJEAttachments(je_id) },
  'feat:alloc-rule:upsert': {
    call: (s, r: any, { cid }) => s.upsertAllocationRule({ ...r, company_id: cid }),
    mutates: true,
  },
  'feat:alloc-rule:apply': {
    call: (s, { rule_id, amount }: any) => s.applyAllocation(rule_id, amount),
    mutates: true,
  },
  'feat:alloc-rule:list': {
    call: (s, _p: any, { cid }) => s.listAllocationRules(cid!),
    requiresCompany: [],
  },
  'feat:narrative:upsert': {
    call: (s, n: any, { cid }) => s.upsertNarrative({ ...n, company_id: cid }),
    mutates: true,
  },
  'feat:narrative:render': {
    call: (s, { slug, vars }: any, { cid }) => s.renderNarrative(cid!, slug, vars || {}),
    requiresCompany: '',
  },
  'feat:narrative:list': {
    call: (s, _p: any, { cid }) => s.listNarratives(cid!),
    requiresCompany: [],
  },
  'feat:je:proof': { call: (s, { lines }: any) => s.proofJELines(lines || []) },
  'feat:je:batch-post': { call: (s, { ids }: any) => s.batchPostJEs(ids || []) },
  'feat:je-comment:add': {
    call: (s, { je_id, user_id, user_email, comment }: any) =>
      s.addJEComment(je_id, user_id, user_email, comment),
    mutates: true,
  },
  'feat:je-comment:list': { call: (s, { je_id }: any) => s.listJEComments(je_id) },
  'feat:account:set-parent': {
    call: (s, { account_id, parent_account_id }: any) => ({
      ok: s.setAccountParent(account_id, parent_account_id),
    }),
    mutates: true,
  },
  'feat:account:tree': {
    call: (s, _p: any, { cid }) => s.getAccountTree(cid!),
    requiresCompany: [],
  },
  'feat:account:merge': {
    call: (s, { primary_id, duplicate_ids }: any) =>
      s.mergeAccounts(primary_id, duplicate_ids || []),
  },
  'feat:account:renumber': {
    call: (s, { account_id, new_code, renamed_by, notes }: any) =>
      s.renumberAccount(account_id, new_code, renamed_by, notes),
  },
  'feat:account:roll-up': {
    call: (s, { as_of_date }: any = {}, { cid }) => s.rollUpAccountBalances(cid!, as_of_date),
    requiresCompany: [],
  },
  'feat:account:set-suspense': {
    call: (s, { account_id, is_suspense }: any) => ({
      ok: s.setAsSuspense(account_id, is_suspense !== false),
    }),
    mutates: true,
  },
  'feat:account:get-suspense': {
    call: (s, _p: any, { cid }) => s.getSuspenseAccount(cid!),
    requiresCompany: null,
  },
  'feat:account:close': {
    call: (s, { account_id, reason }: any) => ({ ok: s.closeAccount(account_id, reason) }),
  },
  'feat:account:reopen': {
    call: (s, { account_id }: any) => ({ ok: s.reopenAccount(account_id) }),
  },
  'feat:account:set-tax-mapping': {
    call: (s, { account_id, tax_line_code, tax_form }: any) => ({
      ok: s.setAccountTaxMapping(account_id, tax_line_code, tax_form),
    }),
    mutates: true,
  },
  'feat:account:by-tax-line': {
    call: (s, { tax_line_code }: any, { cid }) => s.getAccountsByTaxLine(cid!, tax_line_code),
    requiresCompany: [],
  },
  'feat:account:set-cash-flow': {
    call: (s, { account_id, section, subsection }: any) => ({
      ok: s.setAccountCashFlowMapping(account_id, section, subsection),
    }),
    mutates: true,
  },
  'feat:opening-balance:set': {
    call: (s, b: any, { cid }) => s.setOpeningBalance({ ...b, company_id: cid }),
    mutates: true,
  },
  'feat:opening-balance:list': {
    call: (s, { as_of_date }: any = {}, { cid }) => s.listOpeningBalances(cid!, as_of_date),
    requiresCompany: [],
  },
  'feat:close-tpl:upsert': {
    call: (s, t: any, { cid }) => s.upsertCloseTemplate({ ...t, company_id: cid }),
    mutates: true,
  },
  'feat:close-tpl:list': {
    call: (s, _p: any, { cid }) => s.listCloseTemplates(cid!),
    requiresCompany: [],
  },
  'feat:accrual:create': {
    call: (s, a: any, { cid }) => s.createAccrual({ ...a, company_id: cid }),
    mutates: true,
  },
  'feat:accrual:post': {
    call: (s, { id, posted_je_id }: any) => ({ ok: s.postAccrual(id, posted_je_id) }),
    mutates: true,
  },
  'feat:accrual:due-reversals': {
    call: (s, _p: any, { cid }) => s.dueAccrualReversals(cid!),
    requiresCompany: [],
  },
  'feat:accrual:mark-reversed': {
    call: (s, { id, reversal_je_id }: any) => ({ ok: s.markAccrualReversed(id, reversal_je_id) }),
    mutates: true,
  },
  'feat:accrual:list': {
    call: (s, opts: any = {}, { cid }) => s.listAccruals(cid!, opts),
    requiresCompany: [],
  },
  'feat:prepaid:create': {
    call: (svc, s: any, { cid }) => svc.createPrepaidSchedule({ ...s, company_id: cid }),
    mutates: true,
  },
  'feat:prepaid:recognize': {
    call: (s, { id, recognition_date, posted_je_id }: any) =>
      s.recognizePrepaid(id, recognition_date, posted_je_id),
  },
  'feat:prepaid:due': {
    call: (s, _p: any, { cid }) => s.duePrepaidRecognitions(cid!),
    requiresCompany: [],
  },
  'feat:prepaid:list': {
    call: (s, opts: any = {}, { cid }) => s.listPrepaidSchedules(cid!, opts),
    requiresCompany: [],
  },
  'feat:deferred-rev:create': {
    call: (svc, s: any, { cid }) => svc.createDeferredRevenueSchedule({ ...s, company_id: cid }),
    mutates: true,
  },
  'feat:deferred-rev:recognize': {
    call: (s, { id, recognition_date, posted_je_id }: any) =>
      s.recognizeDeferredRevenue(id, recognition_date, posted_je_id),
  },
  'feat:deferred-rev:due': {
    call: (s, _p: any, { cid }) => s.dueDeferredRevenue(cid!),
    requiresCompany: [],
  },
  'feat:deferred-rev:list': {
    call: (s, _p: any, { cid }) => s.listDeferredRevenue(cid!),
    requiresCompany: [],
  },
  'feat:auto:bank-fee': {
    call: (s, { amount, account_id, description }: any, { cid }) =>
      s.autoBookBankFee(cid!, amount, account_id, description),
    requiresCompany: null,
  },
  'feat:auto:interest-accrual': {
    call: (s, { amount, account_id, description }: any, { cid }) =>
      s.autoBookInterestAccrual(cid!, amount, account_id, description),
    requiresCompany: null,
  },
  'feat:period:is-locked': {
    call: (s, { date }: any, { cid }) => s.isPeriodLocked(cid!, date),
    requiresCompany: false,
  },
  'feat:close:quarter-checklist': {
    call: (s, { quarter_end_date }: any, { cid }) => s.quarterEndChecklist(cid!, quarter_end_date),
    requiresCompany: null,
  },
  'feat:close:year-end': {
    call: (s, opts: any, { cid }) => s.runYearEndClose({ ...opts, company_id: cid! }),
    requiresCompany: null,
  },
  'feat:close:list-year-ends': {
    call: (s, _p: any, { cid }) => s.listYearEndCloses(cid!),
    requiresCompany: [],
  },
  'feat:asset:dispose': { call: (s, d: any, { cid }) => s.disposeAsset({ ...d, company_id: cid }) },
  'feat:asset:disposals': {
    call: (s, _p: any, { cid }) => s.listAssetDisposals(cid!),
    requiresCompany: [],
  },
  'feat:asset:transfer': {
    call: (s, t: any, { cid }) => s.transferAsset({ ...t, company_id: cid }),
  },
  'feat:asset:transfers': { call: (s, { asset_id }: any) => s.listAssetTransfers(asset_id) },
  'feat:asset:partial-dispose': {
    call: (s, d: any, { cid }) => s.partialDispose({ ...d, company_id: cid }),
  },
  'feat:asset:impair': { call: (s, i: any, { cid }) => s.impairAsset({ ...i, company_id: cid }) },
  'feat:asset:impairments': {
    call: (s, _p: any, { cid }) => s.listImpairments(cid!),
    requiresCompany: [],
  },
  'feat:asset:revalue': { call: (s, r: any, { cid }) => s.revalueAsset({ ...r, company_id: cid }) },
  'feat:asset:componentize': {
    call: (s, { parent_asset_id, components }: any) =>
      s.componentizeAsset(parent_asset_id, components || []),
  },
  'feat:aro:create': {
    call: (s, a: any, { cid }) => s.createARO({ ...a, company_id: cid }),
    mutates: true,
  },
  'feat:aro:list': { call: (s, _p: any, { cid }) => s.listAROs(cid!), requiresCompany: [] },
  'feat:asset-ins:upsert': {
    call: (s, i: any, { cid }) => s.upsertAssetInsurance({ ...i, company_id: cid }),
    mutates: true,
  },
  'feat:asset-ins:list': { call: (s, { asset_id }: any) => s.listAssetInsurance(asset_id) },
  'feat:asset-warranty:upsert': {
    call: (s, w: any, { cid }) => s.upsertAssetWarranty({ ...w, company_id: cid }),
    mutates: true,
  },
  'feat:asset-warranty:list': { call: (s, { asset_id }: any) => s.listAssetWarranties(asset_id) },
  'feat:asset-warranty:expiring': {
    call: (s, { days_ahead }: any = {}, { cid }) => s.expiringWarranties(cid!, days_ahead || 60),
    requiresCompany: [],
  },
  'feat:asset:set-convention': {
    call: (s, { asset_id, convention }: any) => ({
      ok: s.setDepreciationConvention(asset_id, convention),
    }),
    mutates: true,
  },
  'feat:contract:upsert': {
    call: (s, c: any, { cid }) => s.upsertContract({ ...c, company_id: cid }),
    mutates: true,
  },
  'feat:contract:list': {
    call: (s, opts: any = {}, { cid }) => s.listContracts(cid!, opts),
    requiresCompany: [],
  },
  'feat:obligation:upsert': { call: (s, o: any) => s.upsertObligation(o), mutates: true },
  'feat:obligation:list': { call: (s, { contract_id }: any) => s.listObligations(contract_id) },
  'feat:contract-mod:log': { call: (s, m: any) => s.logContractModification(m), mutates: true },
  'feat:contract-mod:list': {
    call: (s, { contract_id }: any) => s.listContractModifications(contract_id),
  },
  'feat:ssp:upsert': {
    call: (svc, s: any, { cid }) => svc.upsertSSP({ ...s, company_id: cid }),
    mutates: true,
  },
  'feat:ssp:list': { call: (s, _p: any, { cid }) => s.listSSPs(cid!), requiresCompany: [] },
  'feat:var-consid:record': {
    call: (s, v: any) => s.recordVariableConsideration(v),
    mutates: true,
  },
  'feat:rev-milestone:create': { call: (s, m: any) => s.createRevenueMilestone(m), mutates: true },
  'feat:rev-milestone:complete': {
    call: (s, { milestone_id, completion_date, posted_je_id }: any) =>
      s.completeMilestone(milestone_id, completion_date, posted_je_id),
    mutates: true,
  },
  'feat:rev-milestone:list': {
    call: (s, { obligation_id }: any) => s.listMilestones(obligation_id),
  },
  'feat:sub-waterfall': {
    call: (s, { months_ahead }: any = {}, { cid }) =>
      s.subscriptionWaterfall(cid!, months_ahead || 12),
    requiresCompany: [],
  },
  'feat:bundle:allocate': {
    call: (s, { items, transaction_price }: any) =>
      s.allocateBundleRevenue(items || [], transaction_price),
  },
  'feat:returns-reserve:calc': {
    call: (s, { period_start, period_end, historical_rate }: any, { cid }) =>
      s.calculateReturnsReserve(cid!, period_start, period_end, historical_rate),
    mutates: true,
    requiresCompany: null,
  },
  'feat:returns-reserve:list': {
    call: (s, _p: any, { cid }) => s.listReturnsReserves(cid!),
    requiresCompany: [],
  },
  'feat:rebate:upsert': {
    call: (s, r: any, { cid }) => s.upsertRebateAccrual({ ...r, company_id: cid }),
    mutates: true,
  },
  'feat:rebate:list': {
    call: (s, _p: any, { cid }) => s.listRebateAccruals(cid!),
    requiresCompany: [],
  },
  'feat:comm-defer:create': {
    call: (s, c: any, { cid }) => s.deferCommission({ ...c, company_id: cid }),
    mutates: true,
  },
  'feat:comm-defer:amortize': {
    call: (s, { deferral_id, amount }: any) => s.amortizeCommission(deferral_id, amount),
  },
  'feat:comm-defer:list': {
    call: (s, _p: any, { cid }) => s.listCommissionDeferrals(cid!),
    requiresCompany: [],
  },
};

export function registerAccountingGlFeaturesFeat(ipcMain: IpcMain, deps: IpcDeps): void {
  featHandlers(ipcMain, deps, svc('accounting-gl-features'), ACCOUNTING_GL_FEAT);
}
