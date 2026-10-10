import type { IpcMain } from 'electron';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';
import { syncPush } from '../../sync';
import { recordRelationBidirectional } from '../../integrations/entity-graph';
import { eventBus } from '../../services/EventBus';
import * as db from '../../database';
import type { IpcDeps } from '../core/types';
import {
  processRecurringTemplates,
  getLastProcessedAt,
  getRecurringHistory,
} from '../../services/recurring-processor';

export function registerInvoicesIpc(ipcMain: IpcMain, deps: IpcDeps): void {
  const {
    scheduleAutoBackup,
    findClosedPeriod,
    postJournalEntry,
    localToday,
    getPortalExpiryDays,
  } = deps;

  // ─── Itemization Wave (F841-F862) — `iz:*` namespace ──
  const iz = () => require('../../services/itemization-features');

  ipcMain.handle('iz:tpl:save', (_e, p: any) => iz().saveItemizationTemplate(p));

  ipcMain.handle('iz:tpl:list', (_e, { user_id }: any = {}) =>
    iz().listItemizationTemplates(user_id),
  );

  ipcMain.handle('iz:tpl:load', (_e, { id }: any) => iz().loadItemizationTemplate(id));

  ipcMain.handle('iz:tpl:delete', (_e, { id }: any) => iz().deleteItemizationTemplate(id));

  ipcMain.handle('iz:tpl:update', (_e, { id, patch }: any) =>
    iz().updateItemizationTemplate(id, patch),
  );

  ipcMain.handle('iz:tpl:share', (_e, { id, visibility }: any) =>
    iz().shareItemizationTemplate(id, visibility),
  );

  ipcMain.handle('iz:bulk:parse', (_e, { text }: any) => iz().parseBulkLines(text || ''));

  ipcMain.handle('iz:split-evenly', (_e, { total, count, base_description }: any) =>
    iz().splitEvenly(total, count, base_description),
  );

  ipcMain.handle('iz:line:duplicate', (_e, { line }: any) => iz().duplicateLine(line));

  ipcMain.handle('iz:autocomplete:descriptions', (_e, opts: any = {}) =>
    iz().recentLineDescriptions(opts),
  );

  ipcMain.handle('iz:autocomplete:inventory', (_e, { query, limit }: any) =>
    iz().searchInventoryForLine(query, limit || 10),
  );

  ipcMain.handle('iz:tax-breakdown', (_e, { lines }: any) =>
    iz().taxBreakdownByJurisdiction(lines || []),
  );

  ipcMain.handle('iz:line:effective', (_e, { line }: any) => iz().computeLineEffectiveAmount(line));

  ipcMain.handle('iz:contributions', (_e, { lines }: any) => iz().lineContributions(lines || []));

  ipcMain.handle('iz:bulk:apply-tax', (_e, { lines, rate }: any) =>
    iz().applyTaxRateToAll(lines || [], rate),
  );

  ipcMain.handle('iz:bulk:tax-exempt', (_e, { lines, exempt }: any) =>
    iz().setAllTaxExempt(lines || [], exempt),
  );

  ipcMain.handle('iz:reorder', (_e, { lines, from, to }: any) =>
    iz().reorderLines(lines || [], from, to),
  );

  ipcMain.handle('iz:validate', (_e, { lines }: any) => iz().validateLines(lines || []));

  ipcMain.handle('iz:rollup:category', (_e, { lines, names }: any) =>
    iz().categoryRollupForLines(lines || [], names || {}),
  );

  ipcMain.handle('iz:rollup:project', (_e, { lines, names }: any) =>
    iz().projectRollupForLines(lines || [], names || {}),
  );

  ipcMain.handle('iz:tpl:top', (_e, { limit }: any = {}) => iz().topTemplatesReport(limit || 10));

  ipcMain.handle('iz:summary', (_e, { lines }: any) => iz().summarizeLineSet(lines || []));

  // ─── Invoice Upgrades Wave (F893-F922) — `iu:*` namespace ──
  const iu = () => require('../../services/invoice-upgrades-features');

  // Batch IA: Builder UX
  ipcMain.handle('iu:tpl:save', (_e, p: any) => iu().saveInvoiceLineTemplate(p));

  ipcMain.handle('iu:tpl:list', (_e, { user_id }: any = {}) =>
    iu().listInvoiceLineTemplates(user_id),
  );

  ipcMain.handle('iu:tpl:load', (_e, { id }: any) => iu().loadInvoiceLineTemplate(id));

  ipcMain.handle('iu:time:pull', (_e, { project_id, rate, merge_by }: any) =>
    iu().pullTimeEntriesAsLines(project_id, { rate, merge_by }),
  );

  ipcMain.handle('iu:bulk:parse', (_e, { text }: any) => iu().parseInvoiceBulkLines(text || ''));

  // Batch IB: Smart Inference
  ipcMain.handle('iu:smart:due-date', (_e, { client_id, fallback_days, issue_date }: any) =>
    iu().predictSmartDueDate(client_id, { fallback_days, issue_date }),
  );

  ipcMain.handle('iu:fx:preview', (_e, { amount, from, to }: any) =>
    iu().previewCurrencyConversion(amount, from, to),
  );

  ipcMain.handle('iu:credit:apply', (_e, p: any) => iu().applyCreditToInvoice(p));

  ipcMain.handle('iu:progress:pct', (_e, { invoice_id }: any) =>
    iu().progressBillingPercentage(invoice_id),
  );

  ipcMain.handle('iu:late-fee:preview', (_e, { invoice_id }: any) =>
    iu().previewLateFee(invoice_id),
  );

  // Batch IC: Client Engagement
  ipcMain.handle('iu:view:log', (_e, p: any) => iu().logInvoiceView(p));

  ipcMain.handle('iu:view:history', (_e, { invoice_id }: any) =>
    iu().getInvoiceViewHistory(invoice_id),
  );

  ipcMain.handle('iu:email-tpl:save', (_e, p: any) => iu().saveInvoiceEmailTemplate(p));

  ipcMain.handle('iu:email-tpl:resolve', (_e, p: any) => iu().resolveEmailTemplate(p));

  ipcMain.handle('iu:email:thank-you', (_e, { invoice_id }: any) =>
    iu().generateThankYouNote(invoice_id),
  );

  // Batch ID: Workflow
  ipcMain.handle('iu:approval:create-rule', (_e, p: any) => iu().createInvoiceApprovalRule(p));

  ipcMain.handle('iu:approval:route', (_e, { invoice_id }: any) =>
    iu().routeInvoiceApproval(invoice_id),
  );

  ipcMain.handle('iu:payment:suggest', (_e, p: any) => iu().suggestPaymentMatches(p));

  ipcMain.handle('iu:credit-memo:issue', (_e, p: any) => iu().issueCreditMemo(p));

  ipcMain.handle('iu:writeoff', (_e, { invoice_id, reason, actor_user_id }: any) =>
    iu().writeOffInvoice(invoice_id, reason, actor_user_id),
  );

  // Batch IE: Analytics
  ipcMain.handle('iu:dso', (_e, opts: any = {}) => iu().computeDsoForClient(opts));

  ipcMain.handle('iu:top-clients', (_e, opts: any = {}) => iu().topRevenueClients(opts));

  ipcMain.handle('iu:aging', (_e, { client_id }: any = {}) => iu().arAgingByBucket(client_id));

  ipcMain.handle('iu:cashflow:projection', (_e, { days_ahead }: any = {}) =>
    iu().cashFlowProjection(days_ahead || 90),
  );

  ipcMain.handle('iu:collection:score', (_e, { invoice_id }: any) =>
    iu().computeCollectionScore(invoice_id),
  );

  // Batch IF: Bulk Ops
  ipcMain.handle('iu:bulk:remind', (_e, { invoice_ids, cadence, actor_user_id }: any) =>
    iu().bulkSendReminders(invoice_ids || [], { cadence, actor_user_id }),
  );

  ipcMain.handle('iu:bulk:apply-payment', (_e, p: any) => iu().bulkApplyPayment(p));

  ipcMain.handle('iu:bulk:void', (_e, { invoice_ids, reason, actor_user_id }: any) =>
    iu().bulkVoidInvoices(invoice_ids || [], reason, actor_user_id),
  );

  ipcMain.handle('iu:bulk:mark-sent', (_e, { invoice_ids, sent_by }: any) =>
    iu().bulkMarkSent(invoice_ids || [], sent_by),
  );

  ipcMain.handle('iu:bulk:export-manifest', (_e, { invoice_ids }: any) =>
    iu().bulkExportManifest(invoice_ids || []),
  );

  // ─── Invoice Wave II (F923-F962) — `iw:*` namespace ──
  const iw = () => require('../../services/invoice-wave2-features');

  // Batch IG: Recurring & Subscriptions
  ipcMain.handle('iw:recurring:run', () => iw().runRecurringInvoicesDue());

  ipcMain.handle('iw:metrics:mrr', () => iw().computeSubscriptionMetrics());

  ipcMain.handle('iw:proration', (_e, p: any) => iw().calculateProration(p));

  ipcMain.handle('iw:trials:expiring', (_e, { days_ahead }: any = {}) =>
    iw().trialsAboutToExpire(days_ahead || 3),
  );

  ipcMain.handle('iw:sub:auto-renew', (_e, { subscription_id, auto_renew }: any) =>
    iw().setSubscriptionAutoRenewal(subscription_id, !!auto_renew),
  );

  // Batch IH: PDF & Brand Customization
  ipcMain.handle('iw:brand:upsert', (_e, p: any) => iw().upsertBrandProfile(p));

  ipcMain.handle('iw:brand:list', () => iw().listBrandProfiles());

  ipcMain.handle('iw:brand:default', () => iw().getDefaultBrandProfile());

  ipcMain.handle('iw:watermark', (_e, { invoice_id }: any) => iw().watermarkForInvoice(invoice_id));

  ipcMain.handle('iw:preview-html', (_e, { invoice_id, brand_profile_id }: any) =>
    iw().previewInvoiceHtml(invoice_id, brand_profile_id),
  );

  // Batch II: Quote-to-Invoice
  ipcMain.handle('iw:quote:convert', (_e, p: any) => iw().convertQuoteToInvoice(p));

  ipcMain.handle('iw:quote:funnel', (_e, opts: any = {}) => iw().quoteFunnelMetrics(opts));

  ipcMain.handle('iw:quote:auto-convert', () => iw().autoConvertAcceptedQuotes());

  ipcMain.handle('iw:quote:revisions', (_e, { quote_id }: any) =>
    iw().quoteRevisionHistory(quote_id),
  );

  ipcMain.handle('iw:quote:expired', () => iw().expiredQuotesNeedingFollowup());

  // Batch IJ: Discounts & Promotions
  ipcMain.handle('iw:coupon:upsert', (_e, p: any) => iw().upsertCoupon(p));

  ipcMain.handle('iw:coupon:validate', (_e, { code, opts }: any) =>
    iw().validateCoupon(code, opts || {}),
  );

  ipcMain.handle('iw:coupon:redeem', (_e, p: any) => iw().redeemCoupon(p));

  ipcMain.handle('iw:coupon:report', () => iw().couponPerformanceReport());

  ipcMain.handle('iw:volume-discount', (_e, { quantity, tiers }: any) =>
    iw().calculateVolumeDiscount(quantity, tiers || []),
  );

  // Batch IK: Payment Processing
  ipcMain.handle('iw:payment-intent:create', (_e, p: any) => iw().createPaymentIntent(p));

  ipcMain.handle('iw:qr:payload', (_e, { invoice_id, base_url }: any) =>
    iw().generatePaymentQrPayload(invoice_id, base_url),
  );

  ipcMain.handle('iw:bank-transfer:instructions', (_e, { invoice_id }: any) =>
    iw().bankTransferInstructions(invoice_id),
  );

  ipcMain.handle('iw:payment:method-ranking', () => iw().paymentMethodSuccessRanking());

  ipcMain.handle('iw:payment:retry-queue', () => iw().failedPaymentRetryQueue());

  // Batch IL: International
  ipcMain.handle('iw:i18n:labels', (_e, { lang }: any) => iw().getInvoiceI18nLabels(lang || 'en'));

  ipcMain.handle('iw:vat:validate', (_e, { country, vat_number }: any) =>
    iw().validateVatNumber(country || '', vat_number || ''),
  );

  ipcMain.handle('iw:reverse-charge', (_e, p: any) => iw().shouldApplyReverseCharge(p));

  ipcMain.handle('iw:tax:country-rules', (_e, { country }: any) =>
    iw().countryTaxRules(country || 'US'),
  );

  ipcMain.handle('iw:fx:exposure', () => iw().currencyExposureReport());

  // Batch IM: Workflow Automation
  ipcMain.handle('iw:workflow:create', (_e, p: any) => iw().createWorkflowRule(p));

  ipcMain.handle('iw:workflow:evaluate', (_e, p: any) => iw().evaluateWorkflowRules(p));

  ipcMain.handle('iw:predict:payment-date', (_e, { invoice_id }: any) =>
    iw().predictPaymentDate(invoice_id),
  );

  ipcMain.handle('iw:suggest:classification', (_e, { client_id }: any) =>
    iw().suggestInvoiceClassification(client_id),
  );

  ipcMain.handle('iw:approval:required', (_e, { invoice_id }: any) =>
    iw().shouldRequireApproval(invoice_id),
  );

  // Batch IN: Client Portal & Reporting
  ipcMain.handle('iw:portal:token', (_e, p: any) => iw().issueClientPortalToken(p));

  ipcMain.handle('iw:statement', (_e, p: any) => iw().clientStatement(p));

  ipcMain.handle('iw:forecast:revenue', (_e, { weeks_ahead }: any = {}) =>
    iw().revenueForecast(weeks_ahead || 12),
  );

  ipcMain.handle('iw:ltv', (_e, { client_id }: any) => iw().computeClientLtv(client_id));

  ipcMain.handle('iw:churn:predict', (_e, { client_id }: any) =>
    iw().predictClientChurn(client_id),
  );

  // ─── Invoice Wave 3 (80 features: IV1–IV80) ───────────
  const iv3 = () => require('../../services/invoice-wave3-features');

  // Coupons (IV1-IV8)
  ipcMain.handle('iv:coupons', (_e, { activeOnly }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().listCoupons(c, !!activeOnly) : [];
  });

  ipcMain.handle('iv:coupon:upsert', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return iv3().upsertCoupon({ ...p, company_id: c });
  });

  ipcMain.handle('iv:coupon:delete', (_e, { id }: any) => {
    iv3().deleteCoupon(id);
    return { ok: true };
  });

  ipcMain.handle('iv:coupon:redeem', (_e, { code, invoiceId, invoiceTotal }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().redeemCoupon(c, code, invoiceId, invoiceTotal) : {};
  });

  ipcMain.handle('iv:coupon:history', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().couponRedemptionHistory(c) : [];
  });

  ipcMain.handle('iv:coupon:summary', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().couponSummary(c) : {};
  });

  ipcMain.handle('iv:coupon:validate', (_e, { code }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().validateCoupon(c, code) : {};
  });

  ipcMain.handle('iv:coupon:expired', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().expiredCoupons(c) : [];
  });

  // Credit memos (IV9-IV14)
  ipcMain.handle('iv:credit-memos', (_e, opts: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().listCreditMemos(c, opts.clientId) : [];
  });

  ipcMain.handle('iv:credit-memo:create', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return iv3().createCreditMemo({ ...p, company_id: c });
  });

  ipcMain.handle('iv:credit-memo:apply', (_e, { memoId, toInvoiceId }: any) =>
    iv3().applyCreditMemo(memoId, toInvoiceId),
  );

  ipcMain.handle('iv:credit-memo:void', (_e, { id }: any) => {
    iv3().voidCreditMemo(id);
    return { ok: true };
  });

  ipcMain.handle('iv:credit-memo:summary', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().creditMemoSummary(c) : {};
  });

  ipcMain.handle('iv:client-credit', (_e, { clientId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().clientCreditBalance(c, clientId) : {};
  });

  // Payment plans (IV15-IV20)
  ipcMain.handle('iv:payment-plan:create', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return iv3().createPaymentPlan({ ...p, company_id: c });
  });

  ipcMain.handle('iv:payment-plans', (_e, opts: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().listPaymentPlans(c, opts.invoiceId) : [];
  });

  ipcMain.handle('iv:payment-plan:installments', (_e, { planId }: any) =>
    iv3().paymentPlanInstallments(planId),
  );

  ipcMain.handle('iv:installment:pay', (_e, { installmentId, amount }: any) =>
    iv3().recordInstallmentPayment(installmentId, amount),
  );

  ipcMain.handle('iv:installments:overdue', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().overdueInstallments(c) : [];
  });

  ipcMain.handle('iv:payment-plan:cancel', (_e, { planId }: any) => {
    iv3().cancelPaymentPlan(planId);
    return { ok: true };
  });

  // Collection scores (IV21-IV26)
  ipcMain.handle('iv:collection-score', (_e, { invoiceId }: any) =>
    iv3().computeCollectionScore(invoiceId),
  );

  ipcMain.handle('iv:collection-scores:bulk', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().bulkComputeCollectionScores(c) : {};
  });

  ipcMain.handle('iv:collection-board', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().collectionScoreBoard(c) : [];
  });

  ipcMain.handle('iv:dso', (_e, { days }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().computeDSO(c, days || 90) : {};
  });

  ipcMain.handle('iv:dso-by-client', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().dsoByClient(c) : [];
  });

  ipcMain.handle('iv:dso-trend', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().dsoTrend(c) : [];
  });

  // Approval workflow (IV27-IV32)
  ipcMain.handle('iv:approval-rules', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().listApprovalRules(c) : [];
  });

  ipcMain.handle('iv:approval-rule:upsert', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return iv3().upsertApprovalRule({ ...p, company_id: c });
  });

  ipcMain.handle('iv:approval-rule:delete', (_e, { id }: any) => {
    iv3().deleteApprovalRule(id);
    return { ok: true };
  });

  ipcMain.handle('iv:submit-for-approval', (_e, { invoiceId, submittedBy }: any) =>
    iv3().submitForApproval(invoiceId, submittedBy),
  );

  ipcMain.handle('iv:approve', (_e, { invoiceId, approverUserId, comment }: any) =>
    iv3().approveInvoice(invoiceId, approverUserId, comment),
  );

  ipcMain.handle('iv:approval-history', (_e, { invoiceId }: any) =>
    iv3().approvalHistory(invoiceId),
  );

  // Templates (IV33-IV38)
  ipcMain.handle('iv:templates', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().listInvoiceTemplates(c) : [];
  });

  ipcMain.handle('iv:template:upsert', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return iv3().upsertInvoiceTemplate({ ...p, company_id: c });
  });

  ipcMain.handle('iv:template:delete', (_e, { id }: any) => {
    iv3().deleteInvoiceTemplate(id);
    return { ok: true };
  });

  ipcMain.handle('iv:line-templates', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().listLineTemplates(c) : [];
  });

  ipcMain.handle('iv:line-template:upsert', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return iv3().upsertLineTemplate({ ...p, company_id: c });
  });

  ipcMain.handle('iv:line-template:delete', (_e, { id }: any) => {
    iv3().deleteLineTemplate(id);
    return { ok: true };
  });

  // Email & view tracking (IV39-IV44)
  ipcMain.handle('iv:log-email', (_e, p: any) => iv3().logInvoiceEmail(p));

  ipcMain.handle('iv:email-history', (_e, { invoiceId }: any) =>
    iv3().invoiceEmailHistory(invoiceId),
  );

  ipcMain.handle('iv:log-view', (_e, p: any) => iv3().logInvoiceView(p));

  ipcMain.handle('iv:view-history', (_e, { invoiceId }: any) =>
    iv3().invoiceViewHistory(invoiceId),
  );

  ipcMain.handle('iv:view-stats', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().invoiceViewStats(c) : [];
  });

  ipcMain.handle('iv:unviewed', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().unviewedInvoices(c) : [];
  });

  // Attachments & activity (IV45-IV50)
  ipcMain.handle('iv:attachments', (_e, { invoiceId }: any) => iv3().listAttachments(invoiceId));

  ipcMain.handle('iv:attachment:add', (_e, p: any) => iv3().addAttachment(p));

  ipcMain.handle('iv:attachment:delete', (_e, { id }: any) => {
    iv3().deleteAttachment(id);
    return { ok: true };
  });

  ipcMain.handle('iv:log-activity', (_e, p: any) => iv3().logActivity(p));

  ipcMain.handle('iv:activity-log', (_e, { invoiceId }: any) => iv3().activityLog(invoiceId));

  ipcMain.handle('iv:recent-activity', (_e, { limit }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().recentActivity(c, limit || 30) : [];
  });

  // Analytics (IV51-IV60)
  ipcMain.handle('iv:dashboard', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().invoiceDashboard(c) : {};
  });

  ipcMain.handle('iv:revenue-by-month', (_e, { months }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().revenueByMonth(c, months || 12) : [];
  });

  ipcMain.handle('iv:collection-rate', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().collectionRate(c) : {};
  });

  ipcMain.handle('iv:avg-payment-days', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().avgPaymentDays(c) : {};
  });

  ipcMain.handle('iv:by-status', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().invoicesByStatus(c) : [];
  });

  ipcMain.handle('iv:top-clients', (_e, { limit }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().topClientsRevenue(c, limit || 10) : [];
  });

  ipcMain.handle('iv:aging', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().invoiceAging(c) : [];
  });

  ipcMain.handle('iv:growth-rate', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().invoiceGrowthRate(c) : [];
  });

  ipcMain.handle('iv:avg-size', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().avgInvoiceSize(c) : {};
  });

  ipcMain.handle('iv:by-day-of-week', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().invoicesByDayOfWeek(c) : [];
  });

  // Workflow & smart filters (IV61-IV70)
  ipcMain.handle('iv:smart-filters', (_e, opts: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().listSmartFilters(c, opts.userId) : [];
  });

  ipcMain.handle('iv:smart-filter:upsert', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return iv3().upsertSmartFilter({ ...p, company_id: c });
  });

  ipcMain.handle('iv:smart-filter:delete', (_e, { id }: any) => {
    iv3().deleteSmartFilter(id);
    return { ok: true };
  });

  ipcMain.handle('iv:workflow-rules', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().listWorkflowRules(c) : [];
  });

  ipcMain.handle('iv:workflow-rule:upsert', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return iv3().upsertWorkflowRule({ ...p, company_id: c });
  });

  ipcMain.handle('iv:workflow-rule:delete', (_e, { id }: any) => {
    iv3().deleteWorkflowRule(id);
    return { ok: true };
  });

  ipcMain.handle('iv:batch-send', (_e, { invoiceIds }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().batchSendInvoices(c, invoiceIds) : {};
  });

  ipcMain.handle('iv:batch-void', (_e, { invoiceIds }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().batchVoidInvoices(c, invoiceIds) : {};
  });

  ipcMain.handle('iv:duplicate', (_e, { invoiceId }: any) => iv3().duplicateInvoice(invoiceId));

  ipcMain.handle('iv:payment-method-breakdown', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().paymentMethodBreakdown(c) : [];
  });

  // Reports & health (IV71-IV80)
  ipcMain.handle('iv:by-client', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().invoicesByClient(c) : [];
  });

  ipcMain.handle('iv:unpaid-summary', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().unpaidInvoicesSummary(c) : [];
  });

  ipcMain.handle('iv:late-fee-report', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().lateFeeReport(c) : [];
  });

  ipcMain.handle('iv:recurring-summary', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().recurringInvoiceSummary(c) : {};
  });

  ipcMain.handle('iv:export', (_e, opts: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().invoiceExportData(c, opts.startDate, opts.endDate) : [];
  });

  ipcMain.handle('iv:search', (_e, { query, limit }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().invoiceSearchFullText(c, query, limit) : [];
  });

  ipcMain.handle('iv:portal-health', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().invoicePortalHealth(c) : {};
  });

  ipcMain.handle('iv:quarterly', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().invoiceQuarterlyComparison(c) : [];
  });

  ipcMain.handle('iv:client-payment-behavior', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().clientPaymentBehavior(c) : [];
  });

  ipcMain.handle('iv:by-client-list', () => {
    const c = db.getCurrentCompanyId();
    return c ? iv3().invoicesByClient(c) : [];
  });

  // ─── P1.12: Duplicate-Invoice Detector ────────────────────
  // Returns suspiciously similar invoices for the same client created
  // in the recent past. Caller (InvoiceForm) decides whether to
  // surface a confirm modal — this handler is purely a query.
  //
  // Match criteria (all required):
  //   • same client_id
  //   • total within ±$0.01 of the candidate
  //   • due_date within ±3 days (or both null)
  //   • created within last 60 days (avoids matching last year's same-amount invoices)
  //   • exclude the candidate itself when editing
  //
  // Returns up to 3 matches sorted by created_at DESC. Empty array
  // means no duplicates → caller saves without prompting.
  ipcMain.handle(
    'invoice:check-duplicates',
    (
      _event,
      payload: {
        client_id: string;
        total: number;
        due_date: string | null;
        excludeId?: string | null;
      },
    ) => {
      try {
        const companyId = db.getCurrentCompanyId();
        if (!companyId) return { duplicates: [] };
        if (!payload.client_id || !Number.isFinite(payload.total)) return { duplicates: [] };

        const dbInstance = db.getDb();
        // Date window: ±3 days. If candidate has no due_date, only match
        // against other invoices that also have no due_date.
        let dueWhereClause = 'AND due_date IS NULL';
        const params: any[] = [companyId, payload.client_id];
        if (payload.due_date) {
          // Anchor at noon LOCAL to dodge timezone day-shifts.
          const dueTs = new Date(`${payload.due_date}T12:00:00`).getTime();
          const lo = new Date(dueTs - 3 * 86_400_000);
          const hi = new Date(dueTs + 3 * 86_400_000);
          const fmt = (d: Date) =>
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          dueWhereClause = 'AND due_date BETWEEN ? AND ?';
          params.push(fmt(lo), fmt(hi));
        }
        // 60-day creation window: matches typical recurring/monthly cadence
        // without flagging last year's same-amount invoice.
        params.push(payload.total - 0.01, payload.total + 0.01);
        if (payload.excludeId) params.push(payload.excludeId);

        const sql = `
        SELECT id, invoice_number, total, due_date, status, created_at
        FROM invoices
        WHERE company_id = ?
          AND client_id = ?
          ${dueWhereClause}
          AND total BETWEEN ? AND ?
          AND created_at >= datetime('now', '-60 days')
          ${payload.excludeId ? 'AND id != ?' : ''}
        ORDER BY created_at DESC
        LIMIT 3
      `;
        const rows = dbInstance.prepare(sql).all(...params) as any[];
        return { duplicates: rows };
      } catch (err: any) {
        // Defensive: never block save on a duplicate-check failure.
        // Return empty list and log so the caller proceeds normally.
        console.warn('[invoice:check-duplicates] failed:', err?.message);
        return { duplicates: [] };
      }
    },
  );

  // ─── Atomic invoice save (header + line items in one transaction) ─────────
  // Prevents orphaned invoice headers when a line item insert fails.
  ipcMain.handle(
    'invoice:save',
    async (
      _event,
      {
        invoiceId,
        invoiceData,
        lineItems,
        isEdit,
      }: {
        invoiceId: string | null;
        invoiceData: Record<string, any>;
        lineItems: Array<Record<string, any>>;
        isEdit: boolean;
      },
    ) => {
      const _invoiceNumberForError = invoiceData?.invoice_number;
      try {
        const companyId = db.getCurrentCompanyId();
        if (!companyId) {
          return { error: 'No active company selected. Please select a company and try again.' };
        }
        const rawDb = db.getDb();

        // P1.14: capture pre-update snapshot for field-level diff in
        // audit log. Only matters on edit (creates have no prior state).
        const oldInvoice: any = isEdit && invoiceId ? db.getById('invoices', invoiceId) : null;

        // D3: Period close gate — refuse to mutate any record dated
        // within an active closed period. Both new + existing date are
        // checked so you can't move a record OUT of a closed period
        // either. (companyId is guaranteed non-null by the early check above.)
        const period = findClosedPeriod(companyId, invoiceData.issue_date || '');
        if (period) {
          throw new Error(
            'Cannot save: ' +
              invoiceData.issue_date +
              ' falls in a closed accounting period (' +
              period.period_start +
              ' to ' +
              period.period_end +
              '). Reopen the period in Settings to make changes.',
          );
        }
        if (oldInvoice?.issue_date && oldInvoice.issue_date !== invoiceData.issue_date) {
          const oldPeriod = findClosedPeriod(companyId, oldInvoice.issue_date);
          if (oldPeriod) {
            throw new Error(
              'Cannot save: original date ' +
                oldInvoice.issue_date +
                ' falls in a closed accounting period (' +
                oldPeriod.period_start +
                ' to ' +
                oldPeriod.period_end +
                ').',
            );
          }
        }

        const saveFn = rawDb.transaction(() => {
          let savedId: string;

          if (isEdit && invoiceId) {
            db.update('invoices', invoiceId, invoiceData);
            savedId = invoiceId;
            // Replace line items atomically
            const oldLines = db.queryAll('invoice_line_items', { invoice_id: invoiceId });
            for (const ol of oldLines) db.remove('invoice_line_items', ol.id);
          } else {
            const record = db.create('invoices', { ...invoiceData, company_id: companyId });
            savedId = record.id;
          }

          for (let i = 0; i < lineItems.length; i++) {
            db.create('invoice_line_items', {
              ...lineItems[i],
              invoice_id: savedId,
              sort_order: i,
            });
          }

          // Post the auto-JE inside the same transaction so a JE failure rolls
          // back the invoice — otherwise a partial-failure leaves an invoice with
          // no matching ledger entry and you can't re-run because the invoice
          // already exists.
          if (!isEdit && companyId) {
            const total = Number(invoiceData.total || invoiceData.subtotal) || 0;
            if (total > 0) {
              const invoiceNum = invoiceData.invoice_number || savedId.substring(0, 8);
              // CALC: FX — multi-currency invoice JE must be posted in the
              // company's reporting currency (USD). When invoice.currency !=
              // USD, multiply by exchange_rate (units of USD per 1 unit of
              // invoice currency). Default = 1.0 for USD-denominated invoices.
              const invCurrency = String(invoiceData.currency || 'USD').toUpperCase();
              const fxRate = Number(invoiceData.exchange_rate);
              const usdRate =
                invCurrency === 'USD' ? 1 : Number.isFinite(fxRate) && fxRate > 0 ? fxRate : 1;
              const totalUsd = Math.round(total * usdRate * 100) / 100;
              const fxNote =
                invCurrency === 'USD' ? '' : ` (orig ${total} ${invCurrency} @ ${usdRate})`;
              postJournalEntry(
                rawDb,
                companyId,
                invoiceData.issue_date || localToday(),
                `Invoice created - #${invoiceNum}`,
                [
                  {
                    nameHint: 'Receivable',
                    debit: totalUsd,
                    credit: 0,
                    note: `AR for Invoice #${invoiceNum}${fxNote}`,
                  },
                  {
                    nameHint: 'Revenue',
                    debit: 0,
                    credit: totalUsd,
                    note: `Revenue from Invoice #${invoiceNum}${fxNote}`,
                  },
                ],
              );
            }
          }

          return savedId;
        });

        const savedId = saveFn();
        // P1.14: emit field-level diff to audit_log on edit. Wrapped in
        // try/catch so an audit-log failure never surfaces as "Failed to
        // save invoice" — the invoice is already committed at this point.
        try {
          if (companyId) {
            if (isEdit && oldInvoice) {
              const newInvoice = db.getById('invoices', savedId);
              const changes: Record<string, { old: any; new: any }> = {};
              for (const key of Object.keys(invoiceData)) {
                if (oldInvoice[key] !== newInvoice?.[key]) {
                  changes[key] = { old: oldInvoice[key], new: newInvoice?.[key] };
                }
              }
              db.logAudit(companyId, 'invoices', savedId, 'update', changes);
            } else {
              db.logAudit(companyId, 'invoices', savedId, 'create');
            }
          }
        } catch (auditErr) {
          console.warn(
            'invoice:save audit logging failed (invoice was saved):',
            (auditErr as Error)?.message,
          );
        }

        // Record ad-hoc entity relations (advisory — never blocks the save).
        try {
          if (companyId) {
            // (invoice ↔ client) — bidirectional, relation: 'billed_to'
            if (invoiceData?.client_id) {
              recordRelationBidirectional(
                companyId,
                'invoice',
                savedId,
                'client',
                String(invoiceData.client_id),
                'billed_to',
                { created_via: invoiceData.created_via_recurring ? 'recurring' : 'manual' },
              );
            }
            // (invoice ↔ time_entry) for each id in any line item's time_entry_ids CSV.
            for (const li of lineItems || []) {
              const csv: string = (li?.time_entry_ids ?? '') as string;
              if (!csv) continue;
              for (const teId of String(csv)
                .split(',')
                .map((s: string) => s.trim())
                .filter(Boolean)) {
                recordRelationBidirectional(
                  companyId,
                  'invoice',
                  savedId,
                  'time_entry',
                  teId,
                  'billed',
                );
              }
            }
          }
        } catch (err) {
          console.warn('invoice:save recordRelation failed:', (err as Error)?.message);
        }

        scheduleAutoBackup();

        // Reactive engine: emit invoice lifecycle events to drive workflows.
        try {
          if (companyId && savedId) {
            await eventBus
              .emit({
                type: isEdit ? 'invoice.updated' : 'invoice.created',
                companyId,
                entityType: 'invoice',
                entityId: savedId,
                data: {
                  total: invoiceData?.total,
                  client_id: invoiceData?.client_id,
                  status: invoiceData?.status,
                },
              })
              .catch(() => {});
          }
        } catch {
          /* fire-and-forget */
        }

        return { id: savedId };
      } catch (err) {
        console.error('invoice:save failed:', err);
        const msg = err instanceof Error ? err.message : String(err);
        // Translate raw SQLite constraint messages into user-friendly errors.
        if (/UNIQUE constraint failed:.*invoices\.invoice_number/i.test(msg)) {
          return {
            error: `Invoice number${_invoiceNumberForError ? ` ${_invoiceNumberForError}` : ''} already exists in this company. Pick a different number.`,
          };
        }
        if (/UNIQUE constraint failed:.*journal_entries/i.test(msg)) {
          return { error: 'A journal entry numbering conflict occurred. Please try saving again.' };
        }
        if (/FOREIGN KEY constraint failed/i.test(msg)) {
          return {
            error: 'The selected client or account no longer exists. Please refresh and try again.',
          };
        }
        if (/NOT NULL constraint failed/i.test(msg)) {
          return {
            error: 'A required field is missing. Please fill in all required fields and try again.',
          };
        }
        return { error: msg };
      }
    },
  );

  ipcMain.handle('invoice:generate-token', (_event, invoiceId: string) => {
    const dbInstance = db.getDb();
    // PORTAL: a stale (expires_at=0) row counts as "no usable token" so the
    // user gets a fresh one after Disable; otherwise idempotent.
    const existing = dbInstance
      .prepare(`SELECT token, expires_at FROM invoice_tokens WHERE invoice_id = ?`)
      .get(invoiceId) as any;
    if (existing && existing.expires_at && existing.expires_at > 0) {
      return { token: existing.token };
    }

    const token = crypto.randomBytes(32).toString('hex');
    const invoice = dbInstance
      .prepare(`SELECT due_date FROM invoices WHERE id = ?`)
      .get(invoiceId) as any;
    const dueTs = invoice?.due_date ? new Date(invoice.due_date).getTime() : Date.now();
    const companyId = db.getCurrentCompanyId() ?? '';
    const expiryDays = getPortalExpiryDays(companyId);
    const expiresAt = Math.floor(dueTs / 1000) + expiryDays * 86400;
    const tokenId = uuid();

    // If a stale row existed, replace it rather than insert (uniq on invoice_id).
    if (existing) {
      dbInstance.prepare(`DELETE FROM invoice_tokens WHERE invoice_id = ?`).run(invoiceId);
    }

    dbInstance
      .prepare(
        `
      INSERT INTO invoice_tokens (id, invoice_id, company_id, token, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `,
      )
      .run(tokenId, invoiceId, companyId, token, expiresAt);

    // Push the new token to the VPS replica IMMEDIATELY so the portal
    // URL works the moment it's shared. Without this, the user would
    // hit "Invoice not found" until the next auto-backup tick (30s+).
    // Fire-and-forget — failure just means the token reaches the VPS
    // on the next regular sync. Localhost path stays usable either way.
    syncPush({
      table_name: 'invoice_tokens',
      operation: 'insert',
      record_id: tokenId,
      company_id: companyId,
      payload: {
        id: tokenId,
        invoice_id: invoiceId,
        company_id: companyId,
        token,
        expires_at: expiresAt,
      },
    } as any).catch((err) => {
      console.warn(
        '[portal] immediate token sync failed (will retry on next backup):',
        err?.message ?? err,
      );
    });

    return { token };
  });

  // ─── Invoice Portal Token: info / regenerate / disable ──
  // PORTAL: returns the current token row plus the most recent
  // 'portal_view' audit entry (if any). Audit entries originate on the
  // VPS replica when a recipient opens the portal; they only land on the
  // desktop once the next server→desktop sync runs, so the renderer must
  // tolerate "no entry yet" and show "Not available yet".
  ipcMain.handle('invoice:token-info', (_event, invoiceId: string) => {
    try {
      const dbInstance = db.getDb();
      const tokenRow = dbInstance
        .prepare(`SELECT token, expires_at FROM invoice_tokens WHERE invoice_id = ?`)
        .get(invoiceId) as any;
      let lastView: any = null;
      try {
        lastView = dbInstance
          .prepare(
            `SELECT timestamp, changes FROM audit_log
           WHERE entity_type = 'invoice' AND entity_id = ? AND action = 'portal_view'
           ORDER BY timestamp DESC LIMIT 1`,
          )
          .get(invoiceId) as any;
      } catch {
        /* table may differ on legacy DBs */
      }
      return { token: tokenRow?.token ?? null, expiresAt: tokenRow?.expires_at ?? 0, lastView };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('invoice:regenerate-token', (_event, invoiceId: string) => {
    try {
      const dbInstance = db.getDb();
      const companyId = db.getCurrentCompanyId() ?? '';
      // INVALIDATION: mark the old row as expired so any link already shared
      // stops working. We then delete it so the new token can take its place
      // (invoice_id is effectively unique per token row in this codebase).
      const old = dbInstance
        .prepare(`SELECT id, token FROM invoice_tokens WHERE invoice_id = ?`)
        .get(invoiceId) as any;
      if (old) {
        dbInstance.prepare(`UPDATE invoice_tokens SET expires_at = 0 WHERE id = ?`).run(old.id);
        // Push the invalidation NOW so the VPS replica also rejects the old link.
        syncPush({
          table_name: 'invoice_tokens',
          operation: 'update',
          record_id: old.id,
          company_id: companyId,
          payload: {
            id: old.id,
            invoice_id: invoiceId,
            company_id: companyId,
            token: old.token,
            expires_at: 0,
          },
        } as any).catch(() => {});
        dbInstance.prepare(`DELETE FROM invoice_tokens WHERE id = ?`).run(old.id);
      }
      // Mint fresh.
      const token = crypto.randomBytes(32).toString('hex');
      const invoice = dbInstance
        .prepare(`SELECT due_date FROM invoices WHERE id = ?`)
        .get(invoiceId) as any;
      const dueTs = invoice?.due_date ? new Date(invoice.due_date).getTime() : Date.now();
      const expiryDays = getPortalExpiryDays(companyId);
      const expiresAt = Math.floor(dueTs / 1000) + expiryDays * 86400;
      const tokenId = uuid();
      dbInstance
        .prepare(
          `
        INSERT INTO invoice_tokens (id, invoice_id, company_id, token, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `,
        )
        .run(tokenId, invoiceId, companyId, token, expiresAt);
      syncPush({
        table_name: 'invoice_tokens',
        operation: 'insert',
        record_id: tokenId,
        company_id: companyId,
        payload: {
          id: tokenId,
          invoice_id: invoiceId,
          company_id: companyId,
          token,
          expires_at: expiresAt,
        },
      } as any).catch(() => {});
      if (companyId)
        db.logAudit(companyId, 'invoice', invoiceId, 'update', {
          _action: 'portal_token_regenerated',
        });
      return { token, expiresAt };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('invoice:disable-token', (_event, invoiceId: string) => {
    try {
      const dbInstance = db.getDb();
      const companyId = db.getCurrentCompanyId() ?? '';
      const row = dbInstance
        .prepare(`SELECT id, token FROM invoice_tokens WHERE invoice_id = ?`)
        .get(invoiceId) as any;
      if (!row) return { ok: true, alreadyDisabled: true };
      dbInstance.prepare(`UPDATE invoice_tokens SET expires_at = 0 WHERE id = ?`).run(row.id);
      syncPush({
        table_name: 'invoice_tokens',
        operation: 'update',
        record_id: row.id,
        company_id: companyId,
        payload: {
          id: row.id,
          invoice_id: invoiceId,
          company_id: companyId,
          token: row.token,
          expires_at: 0,
        },
      } as any).catch(() => {});
      if (companyId)
        db.logAudit(companyId, 'invoice', invoiceId, 'update', {
          _action: 'portal_token_disabled',
        });
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // ─── Invoice Reminders ────────────────────────────────
  ipcMain.handle('invoice:schedule-reminders', (_event, { invoiceId }: { invoiceId: string }) => {
    const invoice = db.getDb().prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId) as any;
    if (!invoice || !invoice.due_date) return { scheduled: 0 };

    const dueDate = new Date(invoice.due_date);
    const reminders = [
      { type: 'before_due', date: new Date(dueDate.getTime() - 3 * 86400000) },
      { type: 'on_due', date: dueDate },
      { type: 'overdue_7', date: new Date(dueDate.getTime() + 7 * 86400000) },
      { type: 'overdue_14', date: new Date(dueDate.getTime() + 14 * 86400000) },
      { type: 'overdue_30', date: new Date(dueDate.getTime() + 30 * 86400000) },
    ].filter((r) => r.date >= new Date());

    // Clear existing pending reminders
    db.getDb()
      .prepare("DELETE FROM invoice_reminders WHERE invoice_id = ? AND status = 'pending'")
      .run(invoiceId);

    const stmt = db
      .getDb()
      .prepare(
        'INSERT INTO invoice_reminders (id, invoice_id, reminder_type, scheduled_date) VALUES (?, ?, ?, ?)',
      );
    for (const r of reminders) {
      stmt.run(uuid(), invoiceId, r.type, r.date.toISOString().split('T')[0]);
    }
    scheduleAutoBackup();
    return { scheduled: reminders.length };
  });

  ipcMain.handle('invoice:list-reminders', (_event, { invoiceId }: { invoiceId: string }) => {
    return db
      .getDb()
      .prepare('SELECT * FROM invoice_reminders WHERE invoice_id = ? ORDER BY scheduled_date')
      .all(invoiceId);
  });

  ipcMain.handle('invoice:debt-link', (_event, { invoiceId }: { invoiceId: string }) => {
    try {
      return (
        db
          .getDb()
          .prepare('SELECT * FROM invoice_debt_links WHERE invoice_id = ?')
          .get(invoiceId) || null
      );
    } catch {
      return null;
    }
  });

  ipcMain.handle(
    'invoice:overdue-candidates',
    (_event, { companyId, thresholdDays = 30 }: { companyId: string; thresholdDays?: number }) => {
      try {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - thresholdDays);
        const cutoffStr = cutoff.toISOString().slice(0, 10);
        return db
          .getDb()
          .prepare(
            `
        SELECT i.*, c.name as client_name
        FROM invoices i
        LEFT JOIN clients c ON c.id = i.client_id
        WHERE i.company_id = ?
          AND i.status IN ('overdue', 'sent')
          AND i.due_date <= ?
          AND i.id NOT IN (SELECT invoice_id FROM invoice_debt_links)
      `,
          )
          .all(companyId, cutoffStr);
      } catch {
        return [];
      }
    },
  );

  ipcMain.handle(
    'invoice:convert-to-debt',
    (_event, { invoiceId, companyId }: { invoiceId: string; companyId: string }) => {
      try {
        const inv = db.getById('invoices', invoiceId);
        if (!inv) return { error: 'Invoice not found' };
        const client = inv.client_id ? db.getById('clients', inv.client_id) : null;
        const balance = (inv.total || 0) - (inv.amount_paid || 0);

        const debt = db.create('debts', {
          company_id: companyId,
          type: 'receivable',
          debtor_type: client ? 'client' : 'custom',
          debtor_id: inv.client_id || null,
          debtor_name: client?.name || inv.client_name || 'Unknown',
          debtor_email: client?.email || null,
          debtor_phone: client?.phone || null,
          original_amount: balance,
          balance_due: balance,
          due_date: inv.due_date,
          delinquent_date: inv.due_date,
          source_type: 'invoice',
          source_id: invoiceId,
          status: 'active',
          current_stage: 'reminder',
          priority: 'medium',
        });

        db.create('debt_pipeline_stages', { debt_id: debt.id, stage: 'reminder' });
        db.create('invoice_debt_links', { invoice_id: invoiceId, debt_id: debt.id });
        db.update('invoices', invoiceId, { status: 'overdue' });

        // (debt ↔ invoice) bidirectional, relation: 'collected_for'
        try {
          recordRelationBidirectional(
            companyId,
            'debt',
            debt.id,
            'invoice',
            invoiceId,
            'collected_for',
            { converted_at: new Date().toISOString(), balance },
          );
        } catch (err) {
          console.warn('invoice:convert-to-debt recordRelation failed:', (err as Error)?.message);
        }

        scheduleAutoBackup();
        return { debt_id: debt.id };
      } catch (err: any) {
        return { error: err.message };
      }
    },
  );

  // ─── Invoice Settings ──────────────────────────────────
  ipcMain.handle('invoice:get-settings', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    let row = db
      .getDb()
      .prepare('SELECT * FROM invoice_settings WHERE company_id = ?')
      .get(companyId) as any;
    if (!row) {
      // Auto-create defaults on first access
      row = db.create('invoice_settings', {
        company_id: companyId,
        accent_color: '#2563eb',
        template_style: 'classic',
        show_logo: 1,
        show_tax_column: 1,
        show_payment_terms: 1,
        footer_text: '',
        default_notes: '',
        default_terms_text: '',
        default_due_days: 30,
      });
    }
    return row;
  });

  ipcMain.handle('invoice:save-settings', (_event, data: Record<string, any>) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { error: 'No active company' };
    try {
      const existing = db
        .getDb()
        .prepare('SELECT id FROM invoice_settings WHERE company_id = ?')
        .get(companyId) as any;
      let result: any;
      if (existing) {
        db.update('invoice_settings', existing.id, data);
        result = db
          .getDb()
          .prepare('SELECT * FROM invoice_settings WHERE company_id = ?')
          .get(companyId);
      } else {
        result = db.create('invoice_settings', { ...data, company_id: companyId });
      }
      scheduleAutoBackup();
      return result;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── Invoice Catalog Items ────────────────────────────
  ipcMain.handle('invoice:catalog-list', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return [];
    return db
      .getDb()
      .prepare('SELECT * FROM invoice_catalog_items WHERE company_id = ? ORDER BY name')
      .all(companyId);
  });

  ipcMain.handle('invoice:catalog-save', (_event, data: Record<string, any>) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { error: 'No active company' };
    try {
      if (data.id) {
        db.update('invoice_catalog_items', data.id, data);
        scheduleAutoBackup();
        return db.getById('invoice_catalog_items', data.id);
      }
      const created = db.create('invoice_catalog_items', { ...data, company_id: companyId });
      scheduleAutoBackup();
      return created;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('invoice:catalog-delete', (_event, id: string) => {
    try {
      db.remove('invoice_catalog_items', id);
      scheduleAutoBackup();
      return { success: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── Invoice Payment Schedule ──────────────────────────
  ipcMain.handle('invoice:payment-schedule-list', (_event, invoiceId: string) => {
    try {
      return db.queryAll(
        'invoice_payment_schedule',
        { invoice_id: invoiceId },
        { field: 'sort_order', dir: 'asc' },
      );
    } catch {
      return [];
    }
  });

  ipcMain.handle(
    'invoice:payment-schedule-save',
    (_event, { invoiceId, milestones }: { invoiceId: string; milestones: any[] }) => {
      try {
        // Delete existing milestones for this invoice, then re-insert
        db.getDb()
          .prepare('DELETE FROM invoice_payment_schedule WHERE invoice_id = ?')
          .run(invoiceId);
        const inserted = milestones.map((m, idx) => {
          const row = db.create('invoice_payment_schedule', {
            id: m.id || undefined,
            invoice_id: invoiceId,
            milestone_label: m.milestone_label || '',
            due_date: m.due_date || '',
            amount: Number(m.amount || 0),
            paid: m.paid ? 1 : 0,
            sort_order: idx,
          });
          return row;
        });
        scheduleAutoBackup();
        return inserted;
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // ─── Invoice Record Payment ───────────────────────────────
  // Consolidated handler: creates payment record, updates invoice status,
  // and posts DR Cash / CR Accounts Receivable journal entry in one transaction.
  ipcMain.handle(
    'invoice:record-payment',
    async (_event, { invoiceId, amount, date, method, reference }: any) => {
      if (!amount || amount <= 0) return { error: 'Amount must be greater than zero' };
      const companyId = db.getCurrentCompanyId();
      if (!companyId) throw new Error('No active company');
      const dbInstance = db.getDb();

      // D3: period close gate
      {
        const period = findClosedPeriod(companyId, date);
        if (period) {
          return {
            error:
              'Cannot record payment: ' +
              date +
              ' falls in a closed accounting period (' +
              period.period_start +
              ' to ' +
              period.period_end +
              '). Reopen the period in Settings.',
          };
        }
      }

      const tx = (dbInstance as any).transaction(() => {
        const paymentId = uuid();
        (dbInstance as any)
          .prepare(
            `
        INSERT INTO payments (id, company_id, invoice_id, amount, date, payment_method, reference)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
          )
          .run(
            paymentId,
            companyId,
            invoiceId,
            amount,
            date,
            method || 'transfer',
            reference || '',
          );

        const invoice = (dbInstance as any)
          .prepare('SELECT * FROM invoices WHERE id = ?')
          .get(invoiceId);
        if (!invoice) throw new Error('Invoice not found');

        // INTEGRITY: roundCents prevents float-drift in amount_paid across
        // repeated partial payments (e.g. 100 + 0.1 + 0.2 = 100.30000000000001).
        const newAmountPaid = db.roundCents((invoice.amount_paid || 0) + Number(amount));
        const newStatus = newAmountPaid >= db.roundCents(invoice.total) ? 'paid' : 'partial';

        (dbInstance as any)
          .prepare(
            `UPDATE invoices SET amount_paid = ?, status = ?, updated_at = datetime('now') WHERE id = ?`,
          )
          .run(newAmountPaid, newStatus, invoiceId);

        postJournalEntry(
          dbInstance,
          companyId,
          date,
          `Payment received - ${invoice.invoice_number}`,
          [
            {
              nameHint: 'Cash',
              debit: amount,
              credit: 0,
              note: `Cash received for ${invoice.invoice_number}`,
            },
            {
              nameHint: 'Receivable',
              debit: 0,
              credit: amount,
              note: `Clear AR for ${invoice.invoice_number}`,
            },
          ],
        );

        return { paymentId, newStatus, newAmountPaid };
      });

      const result = tx();
      // Without scheduleAutoBackup the VPS backup would miss new payments —
      // user-visible because the dashboard still shows them, but a fresh
      // restore would lose every payment until the next mutation that
      // happens to schedule a backup.
      scheduleAutoBackup();

      // Reactive engine: emit payment + (optionally) invoice.paid events.
      try {
        await eventBus
          .emit({
            type: 'payment.received',
            companyId,
            entityType: 'invoice',
            entityId: invoiceId,
            data: { amount, method },
          })
          .catch(() => {});
        if (result?.newStatus === 'paid') {
          await eventBus
            .emit({
              type: 'invoice.paid',
              companyId,
              entityType: 'invoice',
              entityId: invoiceId,
              data: { total: amount },
            })
            .catch(() => {});
        }
      } catch {
        /* fire-and-forget */
      }

      return result;
    },
  );

  ipcMain.handle(
    'invoice:from-time-entries',
    (_event, { project_id, company_id }: { project_id: string; company_id: string }) => {
      const entries = db
        .getDb()
        .prepare(
          `
      SELECT te.*, e.name as employee_name, e.pay_rate, p.client_id, p.name as project_name
      FROM time_entries te
      JOIN employees e ON te.employee_id = e.id
      JOIN projects p ON te.project_id = p.id
      WHERE te.project_id = ? AND te.company_id = ? AND te.is_invoiced = 0
    `,
        )
        .all(project_id, company_id) as any[];
      if (entries.length === 0) return { error: 'No unbilled time entries for this project.' };
      const client_id = entries[0].client_id;
      const project_name = entries[0].project_name;
      const byEmployee: Record<string, { name: string; minutes: number; rate: number }> = {};
      for (const e of entries) {
        if (!byEmployee[e.employee_id])
          byEmployee[e.employee_id] = {
            name: e.employee_name,
            minutes: 0,
            rate: Number(e.pay_rate ?? 0),
          };
        byEmployee[e.employee_id].minutes += Number(e.duration_minutes ?? 0);
      }
      const lines = Object.values(byEmployee).map((emp) => ({
        description: `${emp.name} — ${project_name}`,
        quantity: parseFloat((emp.minutes / 60).toFixed(2)),
        unit_price: emp.rate,
        tax_rate: 0,
      }));
      return { client_id, lines, entry_ids: entries.map((e: any) => e.id) };
    },
  );

  // ─── Invoice from billable expenses ─────────────────────
  // Bundles unbilled billable expense items into an invoice prefill. Two
  // billable modes mix here:
  //   1. WHOLE EXPENSE — expense.is_billable=1: every line becomes an invoice
  //      line at the expense's amount (or per-line amount if itemized), with
  //      optional markup_pct applied.
  //   2. PER LINE — expense_line_items.is_billable=1 on a non-billable header:
  //      only those specific lines surface.
  // billed_invoice_id (on either row) suppresses re-billing.
  ipcMain.handle(
    'invoice:from-billable-expenses',
    (
      _event,
      {
        client_id,
        project_id,
        company_id,
      }: {
        client_id?: string;
        project_id?: string;
        company_id: string;
      },
    ) => {
      const rawDb = db.getDb();
      const whereClient = client_id ? 'AND e.client_id = ?' : '';
      const whereProject = project_id ? 'AND e.project_id = ?' : '';
      const params: any[] = [company_id];
      if (client_id) params.push(client_id);
      if (project_id) params.push(project_id);

      // Lines from header-billable expenses (no per-line client_id needed)
      const headerLines = rawDb
        .prepare(
          `
      SELECT e.id as expense_id, e.description as expense_desc, e.date,
             e.amount as expense_amount, e.tax_amount as expense_tax,
             e.markup_pct, e.client_id, e.project_id,
             li.id as line_id, li.description as line_desc,
             li.quantity, li.unit_price, li.amount as line_amount,
             li.is_billable as line_billable, li.billed_invoice_id as line_billed
      FROM expenses e
      LEFT JOIN expense_line_items li ON li.expense_id = e.id
      WHERE e.company_id = ?
        ${whereClient}
        ${whereProject}
        AND e.is_billable = 1
        AND (e.billed_invoice_id IS NULL OR e.billed_invoice_id = '')
    `,
        )
        .all(...params) as any[];

      // Lines from per-line-billable rows on header-NON-billable expenses
      const perLineBillable = rawDb
        .prepare(
          `
      SELECT e.id as expense_id, e.description as expense_desc, e.date,
             e.markup_pct, e.client_id, e.project_id,
             li.id as line_id, li.description as line_desc,
             li.quantity, li.unit_price, li.amount as line_amount,
             li.is_billable as line_billable, li.billed_invoice_id as line_billed
      FROM expense_line_items li
      JOIN expenses e ON e.id = li.expense_id
      WHERE e.company_id = ?
        ${whereClient}
        ${whereProject}
        AND (e.is_billable = 0 OR e.is_billable IS NULL)
        AND li.is_billable = 1
        AND (li.billed_invoice_id IS NULL OR li.billed_invoice_id = '')
    `,
        )
        .all(...params) as any[];

      const lines: any[] = [];
      const expenseIds = new Set<string>();
      const lineIds = new Set<string>();

      // Header-billable: prefer line breakdown when present, else single-line
      // fallback using the expense amount.
      const byExpense = new Map<string, any[]>();
      for (const r of headerLines) {
        if (!byExpense.has(r.expense_id)) byExpense.set(r.expense_id, []);
        byExpense.get(r.expense_id)!.push(r);
      }
      for (const [expenseId, rows] of byExpense) {
        const first = rows[0];
        const markup = 1 + Number(first.markup_pct || 0) / 100;
        const hasLines = rows.some((r) => r.line_id);
        if (hasLines) {
          for (const r of rows.filter((r) => r.line_id)) {
            lines.push({
              description: `${first.expense_desc || 'Expense'} — ${r.line_desc || ''}`.trim(),
              quantity: Number(r.quantity || 1),
              unit_price: Number(r.unit_price || 0) * markup,
              tax_rate: 0,
            });
            lineIds.add(r.line_id);
          }
        } else {
          lines.push({
            description: first.expense_desc || `Expense ${first.date || ''}`,
            quantity: 1,
            unit_price: Number(first.expense_amount || 0) * markup,
            tax_rate: 0,
          });
        }
        expenseIds.add(expenseId);
      }

      // Per-line billable on otherwise non-billable expenses
      for (const r of perLineBillable) {
        const markup = 1 + Number(r.markup_pct || 0) / 100;
        lines.push({
          description: `${r.expense_desc || 'Expense'} — ${r.line_desc || ''}`.trim(),
          quantity: Number(r.quantity || 1),
          unit_price: Number(r.unit_price || 0) * markup,
          tax_rate: 0,
        });
        lineIds.add(r.line_id);
      }

      // Billable mileage trips for the same client/project. Mileage is billed at
      // the IRS rate stored on each trip; no markup is applied — clients see the
      // statutory rate so this is auditable for reimbursement disputes.
      const mileageParams: any[] = [company_id];
      if (client_id) mileageParams.push(client_id);
      if (project_id) mileageParams.push(project_id);
      const mileageRows = rawDb
        .prepare(
          `
      SELECT id, trip_date, purpose, start_location, end_location,
             miles, rate_per_mile, deduction_amount, client_id, project_id
      FROM mileage_log
      WHERE company_id = ?
        ${client_id ? 'AND client_id = ?' : ''}
        ${project_id ? 'AND project_id = ?' : ''}
        AND is_billable = 1
        AND (billed_invoice_id IS NULL OR billed_invoice_id = '')
    `,
        )
        .all(...mileageParams) as any[];
      const mileageIds: string[] = [];
      for (const m of mileageRows) {
        const route = [m.start_location, m.end_location].filter(Boolean).join(' → ');
        const desc = `Mileage · ${m.trip_date}${m.purpose ? ` — ${m.purpose}` : ''}${route ? ` (${route})` : ''}`;
        lines.push({
          description: desc,
          quantity: Number(m.miles || 0),
          unit_price: Number(m.rate_per_mile || 0),
          tax_rate: 0,
        });
        mileageIds.push(m.id);
      }

      if (lines.length === 0) {
        return { error: 'No unbilled billable expenses or mileage for this selection.' };
      }

      // Resolve the client to attach (caller-supplied wins; else first source row)
      const resolvedClient =
        client_id ||
        headerLines[0]?.client_id ||
        perLineBillable[0]?.client_id ||
        mileageRows[0]?.client_id ||
        '';
      return {
        client_id: resolvedClient,
        lines,
        expense_ids: Array.from(expenseIds),
        line_ids: Array.from(lineIds),
        mileage_ids: mileageIds,
      };
    },
  );

  // ─── Invoice: Apply Late Fees ─────────────────────────────
  ipcMain.handle('invoice:apply-late-fees', () => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return { applied: 0 };
      const dbInstance = db.getDb();
      const _today = localToday();
      const overdue = dbInstance
        .prepare(
          `
        SELECT id, total, late_fee_pct, late_fee_grace_days, due_date
        FROM invoices
        WHERE company_id = ? AND status IN ('sent','overdue','partial')
          AND late_fee_pct > 0 AND late_fee_applied = 0
          AND due_date != '' AND due_date IS NOT NULL
      `,
        )
        .all(companyId) as any[];

      let applied = 0;
      const applyTx = dbInstance.transaction(() => {
        for (const inv of overdue) {
          const daysOverdue = Math.floor(
            (Date.now() - new Date(inv.due_date).getTime()) / 86_400_000,
          );
          if (daysOverdue <= (inv.late_fee_grace_days || 0)) continue;
          const feeAmount = Math.round((inv.total || 0) * (inv.late_fee_pct / 100) * 100) / 100;
          if (feeAmount <= 0) continue;
          dbInstance
            .prepare(
              `
            UPDATE invoices SET late_fee_amount = ?, late_fee_applied = 1, status = 'overdue', updated_at = datetime('now')
            WHERE id = ?
          `,
            )
            .run(feeAmount, inv.id);
          applied++;
        }
      });
      applyTx();
      if (applied > 0) scheduleAutoBackup();
      return { applied };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  // ─── Invoice: Run Dunning ────────────────────────────────
  ipcMain.handle('invoice:run-dunning', () => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return { advanced: 0 };
      const dbInstance = db.getDb();
      const overdue = dbInstance
        .prepare(
          `
        SELECT id, due_date, dunning_stage, client_id
        FROM invoices
        WHERE company_id = ? AND status IN ('sent','overdue','partial')
          AND due_date != '' AND due_date IS NOT NULL
      `,
        )
        .all(companyId) as any[];

      // Dunning thresholds: stage 0→1 at 7d, 1→2 at 14d, 2→3 at 30d, 3→4 at 45d
      const thresholds = [7, 14, 30, 45];
      let advanced = 0;
      const dunningTx = dbInstance.transaction(() => {
        for (const inv of overdue) {
          const daysOverdue = Math.floor(
            (Date.now() - new Date(inv.due_date).getTime()) / 86_400_000,
          );
          const currentStage = inv.dunning_stage || 0;
          if (currentStage >= 4) continue;
          const nextThreshold = thresholds[currentStage];
          if (daysOverdue >= nextThreshold) {
            dbInstance
              .prepare(
                `UPDATE invoices SET dunning_stage = ?, updated_at = datetime('now') WHERE id = ?`,
              )
              .run(currentStage + 1, inv.id);
            advanced++;
          }
        }
      });
      dunningTx();
      if (advanced > 0) scheduleAutoBackup();
      return { advanced };
    } catch (err: any) {
      return { error: err.message };
    }
  });
  // Auto-dunning: run now / preview what would be actioned.
  ipcMain.handle('dunning:run', () => {
    try {
      const { runAutoDunning } = require('../../services/auto-dunning');
      const r = runAutoDunning();
      scheduleAutoBackup();
      return r;
    } catch (err: any) {
      return {
        invoicesProcessed: 0,
        remindersQueued: 0,
        collectionsSuggested: 0,
        errors: [err?.message],
      };
    }
  });
  ipcMain.handle('dunning:preview', () => {
    try {
      const { getDunningPreview } = require('../../services/auto-dunning');
      return getDunningPreview(db.getCurrentCompanyId());
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  // ─── P6.69: iCal export ────────────────────────────────
  ipcMain.handle('cal:export-invoices-ics', () => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No active company' };
      const { exportInvoiceDueDates } = require('../../services/ical-export');
      return { ics: exportInvoiceDueDates(cid) };
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  // ─── Recurring Transaction Processing ────────────────
  ipcMain.handle('recurring:process-now', () => {
    const companyId = db.getCurrentCompanyId();
    const result = processRecurringTemplates(companyId || undefined);
    // Reactive engine: emit recurring.processed.
    try {
      if (companyId) {
        eventBus
          .emit({
            type: 'recurring.processed',
            companyId,
            entityType: 'recurring',
            entityId: '',
            data: { result },
          })
          .catch(() => {});
      }
    } catch {
      /* fire-and-forget */
    }
    return result;
  });
  ipcMain.handle('recurring:last-processed', () => {
    return getLastProcessedAt();
  });
  ipcMain.handle('recurring:history', (_event, opts?: { templateId?: string }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return [];
    return getRecurringHistory(companyId, opts?.templateId);
  });
  // ─── Credit Notes ─────────────────────────────────────────

  ipcMain.handle('credit-notes:next-number', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return 'CN-1001';
    const dbInstance = db.getDb();
    const row = dbInstance
      .prepare(
        `SELECT credit_number FROM credit_notes WHERE company_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(companyId) as any;
    if (!row) return 'CN-1001';
    const match = row.credit_number.match(/(\d+)$/);
    if (!match) return 'CN-1001';
    const next = parseInt(match[1], 10) + 1;
    return `CN-${String(next).padStart(4, '0')}`;
  });
  ipcMain.handle(
    'credit-notes:apply',
    (
      _event,
      {
        creditNoteId,
        invoiceId,
        amount,
      }: { creditNoteId: string; invoiceId: string; amount: number },
    ) => {
      const dbInstance = db.getDb();
      const applyTx = dbInstance.transaction(() => {
        const cn = dbInstance
          .prepare('SELECT * FROM credit_notes WHERE id = ?')
          .get(creditNoteId) as any;
        if (!cn) throw new Error('Credit note not found');
        const available = cn.total - (cn.amount_applied || 0);
        const applyAmt = Math.min(amount, available);

        const invoice = dbInstance
          .prepare('SELECT * FROM invoices WHERE id = ?')
          .get(invoiceId) as any;
        if (!invoice) throw new Error('Invoice not found');

        const newAmountPaid = (invoice.amount_paid || 0) + applyAmt;
        const newStatus =
          newAmountPaid >= invoice.total ? 'paid' : newAmountPaid > 0 ? 'partial' : invoice.status;

        dbInstance
          .prepare(
            `UPDATE invoices SET amount_paid = ?, status = ?, updated_at = datetime('now') WHERE id = ?`,
          )
          .run(newAmountPaid, newStatus, invoiceId);

        const newApplied = (cn.amount_applied || 0) + applyAmt;
        const cnStatus = newApplied >= cn.total ? 'applied' : 'open';
        dbInstance
          .prepare(
            `UPDATE credit_notes SET amount_applied = ?, status = ?, updated_at = datetime('now') WHERE id = ?`,
          )
          .run(newApplied, cnStatus, creditNoteId);

        return { applied: applyAmt, invoiceStatus: newStatus, creditNoteStatus: cnStatus };
      });
      const result = applyTx();
      scheduleAutoBackup();
      return result;
    },
  );
  // ─── Quotes ──────────────────────────────────────────────
  ipcMain.handle('quotes:next-number', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return 'QT-1001';
    // Use last quote_number instead of COUNT to avoid duplicates after deletions
    const row = db
      .getDb()
      .prepare(
        `SELECT quote_number FROM quotes WHERE company_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(companyId) as any;
    if (!row?.quote_number) return 'QT-1001';
    const match = row.quote_number.match(/(\d+)$/);
    if (!match) return 'QT-1001';
    const next = parseInt(match[1], 10) + 1;
    const prefix = row.quote_number.slice(0, row.quote_number.length - match[1].length);
    return `${prefix}${String(next).padStart(match[1].length, '0')}`;
  });
  ipcMain.handle('quotes:convert-to-invoice', (_event, { quoteId }: { quoteId: string }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) throw new Error('No active company');
    const dbInstance = db.getDb();

    const convertTx = dbInstance.transaction(() => {
      const quote = dbInstance.prepare('SELECT * FROM quotes WHERE id = ?').get(quoteId) as any;
      if (!quote) throw new Error('Quote not found');
      const lines = dbInstance
        .prepare('SELECT * FROM quote_line_items WHERE quote_id = ? ORDER BY sort_order')
        .all(quoteId) as any[];

      // Generate invoice number from last existing number (avoids duplicates on deletion)
      const lastInv = dbInstance
        .prepare(
          `SELECT invoice_number FROM invoices WHERE company_id = ? ORDER BY created_at DESC LIMIT 1`,
        )
        .get(quote.company_id) as any;
      let invoiceNumber = 'INV-1001';
      if (lastInv?.invoice_number) {
        const m = lastInv.invoice_number.match(/(\d+)$/);
        if (m) {
          const prefix = lastInv.invoice_number.slice(
            0,
            lastInv.invoice_number.length - m[1].length,
          );
          invoiceNumber = `${prefix}${String(parseInt(m[1], 10) + 1).padStart(m[1].length, '0')}`;
        }
      }

      const invoiceId = uuid();
      dbInstance
        .prepare(
          `INSERT INTO invoices (id, company_id, invoice_number, client_id, issue_date, due_date, subtotal, tax_amount, discount_amount, total, notes, terms, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
        )
        .run(
          invoiceId,
          quote.company_id,
          invoiceNumber,
          quote.client_id,
          new Date().toISOString().split('T')[0],
          new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
          quote.subtotal,
          quote.tax_amount,
          quote.discount_amount,
          quote.total,
          quote.notes,
          quote.terms,
        );

      for (const line of lines) {
        dbInstance
          .prepare(
            'INSERT INTO invoice_line_items (id, invoice_id, description, quantity, unit_price, tax_rate, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(
            uuid(),
            invoiceId,
            line.description,
            line.quantity,
            line.unit_price,
            line.tax_rate,
            line.amount,
            line.sort_order,
          );
      }

      dbInstance
        .prepare(
          "UPDATE quotes SET status = 'converted', converted_invoice_id = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .run(invoiceId, quoteId);
      return { invoice_id: invoiceId };
    });

    const convertResult = convertTx();
    scheduleAutoBackup();
    // Reactive engine: emit quote.converted for workflows.
    try {
      if (companyId && quoteId && convertResult?.invoice_id) {
        eventBus
          .emit({
            type: 'quote.converted',
            companyId,
            entityType: 'quote',
            entityId: quoteId,
            data: { invoice_id: convertResult.invoice_id },
          })
          .catch(() => {});
      }
    } catch {
      /* fire-and-forget */
    }
    return convertResult;
  });
}
