import type { IpcMain } from 'electron';
import type { IpcDeps } from '../core/types';
import { featHandlers, type FeatSpec } from '../core/featHandlers';
import { svc } from '../core/svc';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const INVOICE_PAYMENT_FEAT: Record<string, FeatSpec<any>> = {
  'feat:rec-inv:upsert': {
    call: (s, t: any, { cid }) => s.upsertRecurringInvoice({ ...t, company_id: cid }),
    mutates: true,
  },
  'feat:rec-inv:list': {
    call: (s, { active_only }: any = {}, { cid }) => s.listRecurringInvoices(cid!, !!active_only),
    requiresCompany: [],
  },
  'feat:rec-inv:due': {
    call: (s, _p: any, { cid }) => s.dueRecurringInvoices(cid!),
    requiresCompany: [],
  },
  'feat:rec-inv:advance': {
    call: (s, { id, generated_invoice_id }: any) =>
      s.advanceRecurringInvoice(id, generated_invoice_id),
  },
  'feat:inv-approval:log': { call: (s, opts: any) => s.logInvoiceApproval(opts), mutates: true },
  'feat:inv-approval:list': {
    call: (s, { invoice_id }: any) => s.listInvoiceApprovals(invoice_id),
  },
  'feat:inv-email:log': { call: (s, e: any) => s.logInvoiceEmail(e), mutates: true },
  'feat:inv-email:opened': {
    call: (s, { tracking_pixel_id }: any) => ({ ok: s.recordEmailOpen(tracking_pixel_id) }),
    mutates: true,
  },
  'feat:inv-email:clicked': {
    call: (s, { tracking_pixel_id }: any) => ({ ok: s.recordEmailClick(tracking_pixel_id) }),
    mutates: true,
  },
  'feat:latefee:upsert': {
    call: (s, p: any, { cid }) => s.upsertLateFeePolicy({ ...p, company_id: cid }),
    mutates: true,
  },
  'feat:latefee:calc': { call: (s, opts: any) => s.calcLateFee(opts), mutates: true },
  'feat:pay-terms:upsert': {
    call: (s, t: any, { cid }) => s.upsertPaymentTerms({ ...t, company_id: cid }),
    mutates: true,
  },
  'feat:pay-terms:list': {
    call: (s, _p: any, { cid }) => s.listPaymentTerms(cid!),
    mutates: true,
    requiresCompany: [],
  },
  'feat:early-disc:calc': {
    call: (s, { invoice_id, payment_date }: any) =>
      s.calcEarlyPaymentDiscount(invoice_id, payment_date),
    mutates: true,
  },
  'feat:prog-bill:create': {
    call: (s, p: any, { cid }) => s.createProgressBilling({ ...p, company_id: cid }),
    mutates: true,
  },
  'feat:prog-bill:release': {
    call: (s, { schedule_id, ...opts }: any) => s.releaseProgressBilling(schedule_id, opts),
  },
  'feat:prog-bill:list': {
    call: (s, _p: any, { cid }) => s.listProgressBilling(cid!),
    requiresCompany: [],
  },
  'feat:retainer:create': {
    call: (s, r: any, { cid }) => s.createRetainer({ ...r, company_id: cid }),
    mutates: true,
  },
  'feat:retainer:drawdown': {
    call: (s, { retainer_id, amount, reason, invoice_id }: any) =>
      s.drawdownRetainer(retainer_id, amount, reason, invoice_id),
  },
  'feat:retainer:list': {
    call: (s, opts: any = {}, { cid }) => s.listRetainers(cid!, opts),
    requiresCompany: [],
  },
  'feat:pay-plan:create': {
    call: (s, p: any, { cid }) => s.createPaymentPlan({ ...p, company_id: cid }),
    mutates: true,
  },
  'feat:pay-plan:pay-installment': {
    call: (s, { installment_id, amount }: any) => ({
      ok: s.payInstallment(installment_id, amount),
    }),
    mutates: true,
  },
  'feat:pay-plan:list': {
    call: (s, opts: any = {}, { cid }) => s.listPaymentPlans(cid!, opts),
    mutates: true,
    requiresCompany: [],
  },
  'feat:inv-attach:add': { call: (s, a: any) => s.addInvoiceAttachment(a), mutates: true },
  'feat:inv-attach:list': {
    call: (s, { invoice_id }: any) => s.listInvoiceAttachments(invoice_id),
  },
  'feat:pay-link:create': {
    call: (s, opts: any, { cid }) => s.createPaymentLink({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:pay-link:consume': {
    call: (s, { short_code, amount }: any) => s.consumePaymentLink(short_code, amount),
    mutates: true,
  },
  'feat:reminder:upsert': {
    call: (s, c: any, { cid }) => s.upsertReminderCadence({ ...c, company_id: cid }),
    mutates: true,
  },
  'feat:reminder:list': {
    call: (s, _p: any, { cid }) => s.listReminderCadences(cid!),
    requiresCompany: [],
  },
  'feat:pay-retry:record': {
    call: (s, opts: any, { cid }) => s.recordPaymentRetry({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:pay:apply-partial': {
    call: (s, { invoice_id, amount }: any) => s.applyPartialPayment(invoice_id, amount),
    mutates: true,
  },
  'feat:cust-credit:add': {
    call: (s, opts: any, { cid }) => s.addCustomerCredit({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:cust-credit:apply': {
    call: (s, opts: any, { cid }) => s.applyCustomerCredit({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:cust-credit:get': { call: (s, { customer_id }: any) => s.getCustomerCredit(customer_id) },
  'feat:refund:record': {
    call: (s, r: any, { cid }) => s.recordRefund({ ...r, company_id: cid }),
    mutates: true,
  },
  'feat:refund:list': {
    call: (s, opts: any = {}, { cid }) => s.listRefunds(cid!, opts),
    requiresCompany: [],
  },
  'feat:chargeback:record': {
    call: (s, c: any, { cid }) => s.recordChargeback({ ...c, company_id: cid }),
    mutates: true,
  },
  'feat:chargeback:resolve': {
    call: (s, { id, resolution, resolved_at }: any) => ({
      ok: s.resolveChargeback(id, resolution, resolved_at),
    }),
  },
  'feat:cust-pm:add': {
    call: (s, m: any, { cid }) => s.addCustomerPaymentMethod({ ...m, company_id: cid }),
    mutates: true,
  },
  'feat:cust-pm:list': {
    call: (s, { customer_id }: any) => s.listCustomerPaymentMethods(customer_id),
  },
  'feat:check-print:record': {
    call: (s, j: any, { cid }) => s.recordCheckPrintJob({ ...j, company_id: cid }),
    mutates: true,
  },
  'feat:check-print:list': {
    call: (s, { limit }: any = {}, { cid }) => s.listCheckPrintJobs(cid!, limit),
    requiresCompany: [],
  },
  'feat:crypto:record': {
    call: (s, p: any, { cid }) => s.recordCryptoPayment({ ...p, company_id: cid }),
    mutates: true,
  },
  'feat:sub-plan:upsert': {
    call: (s, p: any, { cid }) => s.upsertSubscriptionPlan({ ...p, company_id: cid }),
    mutates: true,
  },
  'feat:sub-plan:list': {
    call: (s, _p: any, { cid }) => s.listSubscriptionPlans(cid!),
    requiresCompany: [],
  },
  'feat:sub:change-plan': {
    call: (s, { subscription_id, new_plan_id }: any) =>
      s.changePlanWithProration(subscription_id, new_plan_id),
  },
  'feat:sub:pause': {
    call: (s, { id, resume_date }: any) => ({ ok: s.pauseSubscription(id, resume_date) }),
  },
  'feat:sub:resume': { call: (s, { id }: any) => ({ ok: s.resumeSubscription(id) }) },
  'feat:sub:cancel': {
    call: (s, { id, at_period_end }: any) => ({ ok: s.cancelSubscription(id, at_period_end) }),
  },
  'feat:usage:record': {
    call: (s, u: any, { cid }) => s.recordUsage({ ...u, company_id: cid }),
    mutates: true,
  },
  'feat:usage:list': {
    call: (s, opts: any = {}, { cid }) => s.listUsage(cid!, opts),
    requiresCompany: [],
  },
  'feat:pricing-tier:upsert': {
    call: (s, t: any, { cid }) => s.upsertPricingTier({ ...t, company_id: cid }),
    mutates: true,
  },
  'feat:pricing-tier:calc': {
    call: (s, { plan_id, quantity }: any) => s.calcTieredCharge(plan_id, quantity),
    mutates: true,
  },
  'feat:mrr:calc': {
    call: (s, { snapshot_date }: any = {}, { cid }) => s.calculateMRR(cid!, snapshot_date),
    mutates: true,
    requiresCompany: null,
  },
  'feat:churn:calc': {
    call: (s, { period_start, period_end }: any, { cid }) =>
      s.calculateChurn(cid!, period_start, period_end),
    mutates: true,
    requiresCompany: null,
  },
  'feat:credit:set-limit': {
    call: (s, { customer_id, limit }: any) => ({ ok: s.setCreditLimit(customer_id, limit) }),
    mutates: true,
  },
  'feat:credit:check': {
    call: (s, { customer_id, additional_charge }: any) =>
      s.checkCreditLimit(customer_id, additional_charge),
  },
  'feat:credit:set-hold': {
    call: (s, { customer_id, hold, reason }: any) => ({
      ok: s.setCreditHold(customer_id, hold, reason),
    }),
    mutates: true,
  },
  'feat:aging:calc': {
    call: (s, { as_of_date }: any = {}, { cid }) => s.calcAgingBuckets(cid!, as_of_date),
    mutates: true,
    requiresCompany: null,
  },
  'feat:statement:generate': {
    call: (s, opts: any, { cid }) => s.generateStatement({ ...opts, company_id: cid }),
  },
  'feat:dunning:log': {
    call: (s, opts: any, { cid }) => s.logDunningEvent({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:writeoff:bad-debt': {
    call: (s, opts: any, { cid }) => s.writeOffBadDebt({ ...opts, company_id: cid }),
  },
  'feat:doubtful:calc': {
    call: (s, opts: any, { cid }) => s.calcAllowanceForDoubtful({ ...opts, company_id: cid }),
    mutates: true,
  },
  'feat:agency:handoff': {
    call: (s, opts: any, { cid }) => s.handOffToCollectionAgency({ ...opts, company_id: cid }),
  },
  'feat:agency:record-recovery': {
    call: (s, { handoff_id, recovered_amount }: any) => ({
      ok: s.recordAgencyRecovery(handoff_id, recovered_amount),
    }),
    mutates: true,
  },
  'feat:agency:list': {
    call: (s, opts: any = {}, { cid }) => s.listCollectionHandoffs(cid!, opts),
    requiresCompany: [],
  },
  'feat:sub:create': {
    call: (svc, s: any, { cid }) => svc.createSubscription({ ...s, company_id: cid }),
    mutates: true,
  },
  'feat:dunning-seq:create': {
    call: (svc, s: any, { cid }) => svc.createDunningSequence({ ...s, company_id: cid }),
    mutates: true,
  },
};

export function registerInvoicePaymentFeaturesFeat(ipcMain: IpcMain, deps: IpcDeps): void {
  featHandlers(ipcMain, deps, svc('invoice-payment-features'), INVOICE_PAYMENT_FEAT);
}
