import type { IpcMain } from 'electron';
import type { IpcDeps } from '../core/types';
import { featHandlers, type FeatSpec } from '../core/featHandlers';
import { svc } from '../core/svc';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const CRM_SALES_FEAT: Record<string, FeatSpec<any>> = {
  'feat:stage:upsert': {
    call: (svc, s: any, { cid }) => svc.upsertStage({ ...s, company_id: cid }),
    mutates: true,
  },
  'feat:stage:list': {
    call: (s, { active_only }: any = {}, { cid }) => s.listStages(cid!, !!active_only),
    requiresCompany: [],
  },
  'feat:stage:seed-defaults': {
    call: (s, _p: any, { cid }) => s.seedDefaultStages(cid!),
    mutates: true,
    requiresCompany: { seeded: 0 },
  },
  'feat:deal:upsert': {
    call: (s, d: any, { cid }) => s.upsertDeal({ ...d, company_id: cid }),
    mutates: true,
  },
  'feat:deal:move-stage': {
    call: (s, { deal_id, stage_id }: any) => s.moveDealStage(deal_id, stage_id),
    mutates: true,
  },
  'feat:deal:list': {
    call: (s, opts: any = {}, { cid }) => s.listDeals(cid!, opts),
    requiresCompany: [],
  },
  'feat:deal:pipeline-summary': {
    call: (s, _p: any, { cid }) => s.pipelineSummary(cid!),
    requiresCompany: [],
  },
  'feat:activity:log': {
    call: (s, a: any, { cid }) => s.logActivity({ ...a, company_id: cid }),
    mutates: true,
  },
  'feat:activity:list': { call: (s, { deal_id, limit }: any) => s.listActivities(deal_id, limit) },
  'feat:target:upsert': {
    call: (s, t: any, { cid }) => s.upsertTarget({ ...t, company_id: cid }),
    mutates: true,
  },
  'feat:target:refresh': {
    call: (s, { target_id }: any) => s.refreshTargetActuals(target_id),
    mutates: true,
  },
  'feat:target:list': {
    call: (s, opts: any = {}, { cid }) => s.listTargets(cid!, opts),
    requiresCompany: [],
  },
  'feat:perf:capture': {
    call: (s, opts: any, { cid }) => s.captureSalesPerformance(cid!, opts),
    mutates: true,
    requiresCompany: null,
  },
  'feat:perf:list': {
    call: (s, opts: any = {}, { cid }) => s.listPerformanceSnapshots(cid!, opts),
    requiresCompany: [],
  },
  'feat:lead-form:upsert': {
    call: (s, f: any, { cid }) => s.upsertLeadForm({ ...f, company_id: cid }),
    mutates: true,
  },
  'feat:lead-form:submit': {
    call: (s, { form_id, data, ip_address }: any) =>
      s.recordLeadSubmission(form_id, data, ip_address),
    mutates: true,
  },
  'feat:lead-form:list': {
    call: (s, { active_only }: any = {}, { cid }) => s.listLeadForms(cid!, !!active_only),
    requiresCompany: [],
  },
  'feat:lead-form:submissions': {
    call: (s, { form_id, limit }: any) => s.getLeadSubmissions(form_id, limit),
  },
  'feat:scoring:upsert': {
    call: (s, r: any, { cid }) => s.upsertScoringRule({ ...r, company_id: cid }),
    mutates: true,
  },
  'feat:scoring:score': {
    call: (s, { data }: any, { cid }) => s.scoreLead(cid!, data),
    requiresCompany: 0,
  },
  'feat:scoring:list': {
    call: (s, _p: any, { cid }) => s.listScoringRules(cid!),
    requiresCompany: [],
  },
  'feat:routing:upsert': {
    call: (s, r: any, { cid }) => s.upsertRoutingRule({ ...r, company_id: cid }),
    mutates: true,
  },
  'feat:routing:route': {
    call: (s, { data }: any, { cid }) => s.routeLead(cid!, data),
    requiresCompany: null,
  },
  'feat:routing:list': {
    call: (s, _p: any, { cid }) => s.listRoutingRules(cid!),
    requiresCompany: [],
  },
  'feat:territory:upsert': {
    call: (s, t: any, { cid }) => s.upsertTerritory({ ...t, company_id: cid }),
    mutates: true,
  },
  'feat:territory:list': {
    call: (s, { active_only }: any = {}, { cid }) => s.listTerritories(cid!, !!active_only),
    requiresCompany: [],
  },
  'feat:comm-plan:upsert': {
    call: (s, p: any, { cid }) => s.upsertCommissionPlan({ ...p, company_id: cid }),
    mutates: true,
  },
  'feat:comm-plan:list': {
    call: (s, { active_only }: any = {}, { cid }) => s.listCommissionPlans(cid!, !!active_only),
    requiresCompany: [],
  },
  'feat:comm:calc': {
    call: (s, { rep_id, plan_id, period_start, period_end }: any, { cid }) =>
      s.calculateCommission(cid!, rep_id, plan_id, period_start, period_end),
    mutates: true,
    requiresCompany: null,
  },
  'feat:comm:list': {
    call: (s, opts: any = {}, { cid }) => s.listCommissionCalculations(cid!, opts),
    requiresCompany: [],
  },
  'feat:comm:mark-paid': {
    call: (s, { id }: any) => ({ ok: s.markCommissionPaid(id) }),
    mutates: true,
  },
  'feat:discount:upsert': {
    call: (s, r: any, { cid }) => s.upsertDiscountRule({ ...r, company_id: cid }),
    mutates: true,
  },
  'feat:discount:evaluate': {
    call: (s, order: any, { cid }) => s.evaluateDiscountRules(cid!, order),
    requiresCompany: { discount_amount: 0, applied_rules: [] },
  },
  'feat:discount:list': {
    call: (s, _p: any, { cid }) => s.listDiscountRules(cid!),
    requiresCompany: [],
  },
  'feat:promo:upsert': {
    call: (s, p: any, { cid }) => s.upsertPromoCode({ ...p, company_id: cid }),
    mutates: true,
  },
  'feat:promo:redeem': {
    call: (s, { code, customer_id, order_total, invoice_id }: any, { cid }) =>
      s.redeemPromoCode(cid!, code, customer_id, order_total, invoice_id),
    mutates: true,
    requiresCompany: { success: false, reason: 'No company' },
  },
  'feat:promo:list': { call: (s, _p: any, { cid }) => s.listPromoCodes(cid!), requiresCompany: [] },
  'feat:loyalty:tier-upsert': {
    call: (s, t: any, { cid }) => s.upsertLoyaltyTier({ ...t, company_id: cid }),
    mutates: true,
  },
  'feat:loyalty:award': {
    call: (s, { customer_id, points, reason, invoice_id }: any, { cid }) =>
      s.awardPoints(cid!, customer_id, points, reason, invoice_id),
    mutates: true,
    requiresCompany: null,
  },
  'feat:loyalty:status': {
    call: (s, { customer_id }: any, { cid }) => s.getLoyaltyStatus(cid!, customer_id),
    requiresCompany: null,
  },
  'feat:loyalty:tiers': {
    call: (s, _p: any, { cid }) => s.listLoyaltyTiers(cid!),
    requiresCompany: [],
  },
  'feat:referral:record': {
    call: (s, r: any, { cid }) => s.recordReferral({ ...r, company_id: cid }),
    mutates: true,
  },
  'feat:referral:convert': {
    call: (s, { id, referee_customer_id }: any) => ({
      ok: s.convertReferral(id, referee_customer_id),
    }),
    mutates: true,
  },
  'feat:referral:pay-reward': {
    call: (s, { id }: any) => ({ ok: s.payReferralReward(id) }),
    mutates: true,
  },
  'feat:referral:list': {
    call: (s, opts: any = {}, { cid }) => s.listReferrals(cid!, opts),
    requiresCompany: [],
  },
  'feat:quote-tpl:set-lines': {
    call: (s, { template_id, lines }: any) => s.setQuoteTemplateLines(template_id, lines),
    mutates: true,
  },
  'feat:quote-tpl:get-lines': {
    call: (s, { template_id }: any) => s.getQuoteTemplateLines(template_id),
  },
  'feat:quote:log-conversion': {
    call: (s, { quote_id, invoice_id, converted_by, notes }: any, { cid }) =>
      s.logQuoteConversion(cid!, quote_id, invoice_id, converted_by, notes),
    mutates: true,
    requiresCompany: null,
  },
  'feat:quote:conversion-list': {
    call: (s, opts: any = {}, { cid }) => s.listQuoteConversions(cid!, opts),
    requiresCompany: [],
  },
  'feat:quote:sign': { call: (svc, s: any) => svc.signQuote(s), mutates: true },
  'feat:quote:signatures': { call: (s, { quote_id }: any) => s.getQuoteSignatures(quote_id) },
  'feat:rfp:upsert': {
    call: (s, r: any, { cid }) => s.upsertRFP({ ...r, company_id: cid }),
    mutates: true,
  },
  'feat:rfp:list': {
    call: (s, opts: any = {}, { cid }) => s.listRFPs(cid!, opts),
    requiresCompany: [],
  },
  'feat:win-loss:record': {
    call: (s, w: any, { cid }) => s.recordWinLoss({ ...w, company_id: cid }),
    mutates: true,
  },
  'feat:win-loss:summary': {
    call: (s, opts: any = {}, { cid }) => s.winLossSummary(cid!, opts),
    requiresCompany: null,
  },
  'feat:win-loss:list': {
    call: (s, { limit }: any = {}, { cid }) => s.listWinLossEntries(cid!, limit),
    requiresCompany: [],
  },
};

export function registerCrmSalesFeaturesFeat(ipcMain: IpcMain, deps: IpcDeps): void {
  featHandlers(ipcMain, deps, svc('crm-sales-features'), CRM_SALES_FEAT);
}
