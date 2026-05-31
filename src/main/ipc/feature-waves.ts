// src/main/ipc/feature-waves.ts
//
// Thin "feature wave" IPC handlers extracted from the ipc/index.ts monolith.
// These are the contiguous single-namespace delegation waves, each fronting a
// dedicated service module via a small `() => require(...)` accessor:
//   iz: itemization · eu/ex: expense upgrades & wave 3 · iu/iw/iv: invoice
//   upgrades, wave II, wave 3 · la/lf/lk: loan advanced, full-system, linkage.
// Registered from registerIpcHandlers() via registerFeatureWavesIpc(ipcMain).
// The only shared dependency is the database.

import { IpcMain } from 'electron';
import * as db from '../database';

export function registerFeatureWavesIpc(ipcMain: IpcMain): void {
  // ─── Itemization Wave (F841-F862) — `iz:*` namespace ──
  const iz = () => require('../services/itemization-features');
  ipcMain.handle('iz:tpl:save', (_e, p: any) => iz().saveItemizationTemplate(p));
  ipcMain.handle('iz:tpl:list', (_e, { user_id }: any = {}) => iz().listItemizationTemplates(user_id));
  ipcMain.handle('iz:tpl:load', (_e, { id }: any) => iz().loadItemizationTemplate(id));
  ipcMain.handle('iz:tpl:delete', (_e, { id }: any) => iz().deleteItemizationTemplate(id));
  ipcMain.handle('iz:tpl:update', (_e, { id, patch }: any) => iz().updateItemizationTemplate(id, patch));
  ipcMain.handle('iz:tpl:share', (_e, { id, visibility }: any) => iz().shareItemizationTemplate(id, visibility));
  ipcMain.handle('iz:bulk:parse', (_e, { text }: any) => iz().parseBulkLines(text || ''));
  ipcMain.handle('iz:split-evenly', (_e, { total, count, base_description }: any) => iz().splitEvenly(total, count, base_description));
  ipcMain.handle('iz:line:duplicate', (_e, { line }: any) => iz().duplicateLine(line));
  ipcMain.handle('iz:autocomplete:descriptions', (_e, opts: any = {}) => iz().recentLineDescriptions(opts));
  ipcMain.handle('iz:autocomplete:inventory', (_e, { query, limit }: any) => iz().searchInventoryForLine(query, limit || 10));
  ipcMain.handle('iz:tax-breakdown', (_e, { lines }: any) => iz().taxBreakdownByJurisdiction(lines || []));
  ipcMain.handle('iz:line:effective', (_e, { line }: any) => iz().computeLineEffectiveAmount(line));
  ipcMain.handle('iz:contributions', (_e, { lines }: any) => iz().lineContributions(lines || []));
  ipcMain.handle('iz:bulk:apply-tax', (_e, { lines, rate }: any) => iz().applyTaxRateToAll(lines || [], rate));
  ipcMain.handle('iz:bulk:tax-exempt', (_e, { lines, exempt }: any) => iz().setAllTaxExempt(lines || [], exempt));
  ipcMain.handle('iz:reorder', (_e, { lines, from, to }: any) => iz().reorderLines(lines || [], from, to));
  ipcMain.handle('iz:validate', (_e, { lines }: any) => iz().validateLines(lines || []));
  ipcMain.handle('iz:rollup:category', (_e, { lines, names }: any) => iz().categoryRollupForLines(lines || [], names || {}));
  ipcMain.handle('iz:rollup:project', (_e, { lines, names }: any) => iz().projectRollupForLines(lines || [], names || {}));
  ipcMain.handle('iz:tpl:top', (_e, { limit }: any = {}) => iz().topTemplatesReport(limit || 10));
  ipcMain.handle('iz:summary', (_e, { lines }: any) => iz().summarizeLineSet(lines || []));

  // ─── Expense Upgrades Wave (F863-F892) — `eu:*` namespace ──
  const eu = () => require('../services/expense-upgrades-features');
  // Batch EA: Bulk Operations
  ipcMain.handle('eu:bulk:approval', (_e, p: any) => eu().bulkSetApprovalStatus(p));
  ipcMain.handle('eu:bulk:recategorize', (_e, { expense_ids, category_id }: any) => eu().bulkRecategorize(expense_ids || [], category_id));
  ipcMain.handle('eu:bulk:assign-project', (_e, { expense_ids, project_id }: any) => eu().bulkAssignProject(expense_ids || [], project_id));
  ipcMain.handle('eu:bulk:reimbursed', (_e, { expense_ids, reimbursed, date }: any) => eu().bulkMarkReimbursed(expense_ids || [], reimbursed, date));
  ipcMain.handle('eu:bulk:tag', (_e, { expense_ids, add, remove }: any) => eu().bulkTag(expense_ids || [], add || [], remove || []));
  ipcMain.handle('eu:bulk:delete', (_e, { expense_ids }: any) => eu().bulkDelete(expense_ids || []));
  // Batch EB: Search & Smart Filters
  ipcMain.handle('eu:filter:save', (_e, p: any) => eu().saveSmartFilter(p));
  ipcMain.handle('eu:filter:list', (_e, { user_id }: any = {}) => eu().listSmartFilters(user_id));
  ipcMain.handle('eu:filter:presets', () => eu().getSystemFilterPresets());
  ipcMain.handle('eu:vendor:quickfind', (_e, { query, limit }: any) => eu().quickFindVendors(query || '', limit || 10));
  ipcMain.handle('eu:filter:by-amount', (_e, p: any) => eu().filterByAmount(p));
  ipcMain.handle('eu:filter:by-attachment', (_e, { has_receipt, limit }: any) => eu().filterByAttachment(!!has_receipt, limit || 200));
  // Batch EC: Hygiene & Duplicates
  ipcMain.handle('eu:dupes:scan', (_e, opts: any = {}) => eu().scanDuplicates(opts));
  ipcMain.handle('eu:receipts:missing', (_e, { days }: any = {}) => eu().expensesMissingReceipts(days || 7));
  ipcMain.handle('eu:dupes:resolve', (_e, { match_id, resolution }: any) => eu().resolveDuplicateMatch(match_id, resolution));
  ipcMain.handle('eu:hygiene:compute', (_e, { expense_id }: any) => eu().computeHygieneScore(expense_id));
  ipcMain.handle('eu:hygiene:report', (_e, opts: any = {}) => eu().bulkHygieneReport(opts));
  // Batch ED: Approval Workflow
  ipcMain.handle('eu:approval:create-rule', (_e, p: any) => eu().createApprovalRule(p));
  ipcMain.handle('eu:approval:route', (_e, { expense_id }: any) => eu().routeApprovalForExpense(expense_id));
  ipcMain.handle('eu:approval:delegate', (_e, p: any) => eu().createApprovalDelegation(p));
  ipcMain.handle('eu:approval:history', (_e, { expense_id }: any) => eu().getApprovalHistory(expense_id));
  ipcMain.handle('eu:approval:sla', (_e, { days }: any = {}) => eu().approvalSlaReport(days || 90));
  // Batch EE: Insights
  ipcMain.handle('eu:insights:top-vendors', (_e, opts: any = {}) => eu().topVendorsBySpend(opts));
  ipcMain.handle('eu:insights:category-rollup', (_e, opts: any = {}) => eu().categorySpendRollup(opts));
  ipcMain.handle('eu:insights:anomalies', (_e, { threshold }: any = {}) => eu().detectExpenseAnomalies(threshold || 2.5));
  ipcMain.handle('eu:insights:monthly-trend', (_e, { months_back }: any = {}) => eu().monthlyTrend(months_back || 12));
  ipcMain.handle('eu:insights:burn-down', (_e, { month }: any = {}) => eu().budgetBurnDown(month));
  // Batch EF: UX Power
  ipcMain.handle('eu:recurring:detect', () => eu().detectRecurringCandidates());
  ipcMain.handle('eu:draft:save', (_e, p: any) => eu().saveExpenseDraft(p));
  ipcMain.handle('eu:draft:get', (_e, { user_id }: any = {}) => eu().getLatestDraft(user_id));
  ipcMain.handle('eu:draft:clear', (_e, { user_id }: any = {}) => eu().clearDraft(user_id));

  // ─── Expense Wave 3 (80 features: EX1–EX80) ───────────
  const ex3 = () => require('../services/expense-wave3-features');
  // Smart Automation (EX1-EX10)
  ipcMain.handle('ex:auto-split-project', (_e, { expenseId }: any) => ex3().autoSplitByProject(expenseId));
  ipcMain.handle('ex:detect-recurring', () => { const c = db.getCurrentCompanyId(); return c ? ex3().detectRecurringPatterns(c) : []; });
  ipcMain.handle('ex:categorization-accuracy', () => { const c = db.getCurrentCompanyId(); return c ? ex3().categorizationAccuracy(c) : {}; });
  ipcMain.handle('ex:spending-velocity', (_e, { days }: any = {}) => { const c = db.getCurrentCompanyId(); return c ? ex3().spendingVelocity(c, days || 7) : {}; });
  ipcMain.handle('ex:find-duplicates', () => { const c = db.getCurrentCompanyId(); return c ? ex3().findDuplicateExpenses(c) : []; });
  ipcMain.handle('ex:forecast-next-month', () => { const c = db.getCurrentCompanyId(); return c ? ex3().forecastNextMonth(c) : {}; });
  ipcMain.handle('ex:vendor-anomalies', (_e, { threshold }: any = {}) => { const c = db.getCurrentCompanyId(); return c ? ex3().vendorAnomalies(c, threshold || 2) : []; });
  ipcMain.handle('ex:unmatched-receipts', () => { const c = db.getCurrentCompanyId(); return c ? ex3().unmatchedReceipts(c) : []; });
  ipcMain.handle('ex:expense-aging', () => { const c = db.getCurrentCompanyId(); return c ? ex3().expenseAging(c) : []; });
  ipcMain.handle('ex:auto-tag', (_e, { rules }: any) => { const c = db.getCurrentCompanyId(); return c ? ex3().autoTagExpenses(c, rules || []) : {}; });
  // Analytics (EX11-EX20)
  ipcMain.handle('ex:spending-by-day', () => { const c = db.getCurrentCompanyId(); return c ? ex3().spendingByDayOfWeek(c) : []; });
  ipcMain.handle('ex:submission-patterns', () => { const c = db.getCurrentCompanyId(); return c ? ex3().submissionPatterns(c) : []; });
  ipcMain.handle('ex:category-trends', () => { const c = db.getCurrentCompanyId(); return c ? ex3().categoryTrends(c) : []; });
  ipcMain.handle('ex:vendor-loyalty', () => { const c = db.getCurrentCompanyId(); return c ? ex3().vendorLoyaltyScores(c) : []; });
  ipcMain.handle('ex:tax-deduction-summary', (_e, { year }: any = {}) => { const c = db.getCurrentCompanyId(); return c ? ex3().taxDeductionSummary(c, year) : []; });
  ipcMain.handle('ex:expense-revenue-ratio', () => { const c = db.getCurrentCompanyId(); return c ? ex3().expenseToRevenueRatio(c) : {}; });
  ipcMain.handle('ex:spending-heatmap', (_e, { weeks }: any = {}) => { const c = db.getCurrentCompanyId(); return c ? ex3().spendingHeatmap(c, weeks || 12) : []; });
  ipcMain.handle('ex:monthly-growth', () => { const c = db.getCurrentCompanyId(); return c ? ex3().monthlyGrowthRate(c) : []; });
  ipcMain.handle('ex:category-concentration', () => { const c = db.getCurrentCompanyId(); return c ? ex3().categoryConcentration(c) : {}; });
  ipcMain.handle('ex:budget-burn-rate', () => { const c = db.getCurrentCompanyId(); return c ? ex3().budgetBurnRate(c) : []; });
  // Workflow (EX21-EX30)
  ipcMain.handle('ex:check-policy', (_e, p: any) => { const c = db.getCurrentCompanyId(); return c ? ex3().checkPolicyViolations(c, p) : {}; });
  ipcMain.handle('ex:approval-chain', (_e, { amount }: any) => { const c = db.getCurrentCompanyId(); return c ? ex3().getApprovalChain(c, amount) : {}; });
  ipcMain.handle('ex:batch-approve', (_e, { expenseIds, approvedBy }: any) => { const c = db.getCurrentCompanyId(); return c ? ex3().batchApprove(c, expenseIds, approvedBy) : {}; });
  ipcMain.handle('ex:batch-reject', (_e, { expenseIds, reason }: any) => { const c = db.getCurrentCompanyId(); return c ? ex3().batchReject(c, expenseIds, reason) : {}; });
  ipcMain.handle('ex:generate-report', (_e, p: any) => { const c = db.getCurrentCompanyId(); return c ? ex3().generateExpenseReport(c, p) : {}; });
  ipcMain.handle('ex:void-expense', (_e, { expenseId, reason }: any) => { const c = db.getCurrentCompanyId(); return c ? ex3().voidExpense(c, expenseId, reason) : {}; });
  ipcMain.handle('ex:split-expense', (_e, { expenseId, splits }: any) => ex3().splitExpense(expenseId, splits));
  ipcMain.handle('ex:request-clarification', (_e, { expenseId, question }: any) => { const c = db.getCurrentCompanyId(); return c ? ex3().requestClarification(c, expenseId, question) : {}; });
  ipcMain.handle('ex:submit-on-behalf', (_e, p: any) => { const c = db.getCurrentCompanyId(); return c ? ex3().submitOnBehalf(c, p.data, p.onBehalfOf) : {}; });
  ipcMain.handle('ex:escalate-stale', (_e, { days }: any = {}) => { const c = db.getCurrentCompanyId(); return c ? ex3().escalateStaleExpenses(c, days || 7) : {}; });
  // Reporting (EX31-EX40)
  ipcMain.handle('ex:by-employee', (_e, opts: any = {}) => { const c = db.getCurrentCompanyId(); return c ? ex3().expenseByEmployee(c, opts.startDate, opts.endDate) : []; });
  ipcMain.handle('ex:by-payment-method', () => { const c = db.getCurrentCompanyId(); return c ? ex3().expenseByPaymentMethod(c) : []; });
  ipcMain.handle('ex:yoy-comparison', () => { const c = db.getCurrentCompanyId(); return c ? ex3().yearOverYearExpenses(c) : []; });
  ipcMain.handle('ex:largest', (_e, { limit }: any = {}) => { const c = db.getCurrentCompanyId(); return c ? ex3().largestExpenses(c, limit || 20) : []; });
  ipcMain.handle('ex:uncategorized', () => { const c = db.getCurrentCompanyId(); return c ? ex3().uncategorizedExpenses(c) : []; });
  ipcMain.handle('ex:missing-receipts', (_e, { threshold }: any = {}) => { const c = db.getCurrentCompanyId(); return c ? ex3().missingReceiptsReport(c, threshold || 25) : []; });
  ipcMain.handle('ex:reimbursement-aging', () => { const c = db.getCurrentCompanyId(); return c ? ex3().reimbursementAging(c) : []; });
  ipcMain.handle('ex:project-summary', () => { const c = db.getCurrentCompanyId(); return c ? ex3().projectExpenseSummary(c) : []; });
  ipcMain.handle('ex:vendor-trend', (_e, { vendorId }: any) => { const c = db.getCurrentCompanyId(); return c ? ex3().vendorSpendingTrend(c, vendorId) : []; });
  ipcMain.handle('ex:export-csv', (_e, opts: any = {}) => { const c = db.getCurrentCompanyId(); return c ? ex3().exportExpensesCSV(c, opts.startDate, opts.endDate) : []; });
  // Integration (EX41-EX50)
  ipcMain.handle('ex:billable-by-client', () => { const c = db.getCurrentCompanyId(); return c ? ex3().billableExpensesByClient(c) : []; });
  ipcMain.handle('ex:unmatched-bank-txns', () => { const c = db.getCurrentCompanyId(); return c ? ex3().unmatchedBankTransactionsForExpenses(c) : []; });
  ipcMain.handle('ex:loan-linked', () => { const c = db.getCurrentCompanyId(); return c ? ex3().loanLinkedExpenses(c) : []; });
  ipcMain.handle('ex:payroll-linked', () => { const c = db.getCurrentCompanyId(); return c ? ex3().payrollLinkedExpenses(c) : []; });
  ipcMain.handle('ex:convert-to-bill', (_e, { expenseId }: any) => ex3().convertExpenseToBill(expenseId));
  ipcMain.handle('ex:mark-billable', (_e, { expenseId, clientId }: any) => { const c = db.getCurrentCompanyId(); return c ? ex3().markBillable(c, expenseId, clientId) : {}; });
  ipcMain.handle('ex:link-project-budget', (_e, { expenseId, projectId }: any) => { const c = db.getCurrentCompanyId(); return c ? ex3().linkToProjectWithBudgetCheck(c, expenseId, projectId) : {}; });
  ipcMain.handle('ex:calc-mileage', (_e, { miles, year }: any) => ex3().calculateMileage(miles, year));
  ipcMain.handle('ex:convert-currency', (_e, p: any) => ex3().convertCurrency(p.amount, p.from, p.to, p.rate));
  ipcMain.handle('ex:to-invoice-line', (_e, { expenseId }: any) => ex3().expenseToInvoiceLine(expenseId));
  // Compliance (EX51-EX60)
  ipcMain.handle('ex:per-diem', (_e, p: any) => ex3().calculatePerDiem(p.location || 'standard', p.days, p.mealsIncluded));
  ipcMain.handle('ex:audit-trail', (_e, { expenseId }: any) => ex3().expenseAuditTrail(expenseId));
  ipcMain.handle('ex:policy-compliance', () => { const c = db.getCurrentCompanyId(); return c ? ex3().policyComplianceReport(c) : {}; });
  ipcMain.handle('ex:weekend-expenses', () => { const c = db.getCurrentCompanyId(); return c ? ex3().flagWeekendExpenses(c) : []; });
  ipcMain.handle('ex:round-number', () => { const c = db.getCurrentCompanyId(); return c ? ex3().roundNumberExpenses(c) : []; });
  ipcMain.handle('ex:dept-budget-variance', () => { const c = db.getCurrentCompanyId(); return c ? ex3().deptBudgetVariance(c) : []; });
  ipcMain.handle('ex:tax-deductible-breakdown', (_e, { year }: any = {}) => { const c = db.getCurrentCompanyId(); return c ? ex3().taxDeductibleBreakdown(c, year) : {}; });
  ipcMain.handle('ex:submission-timeliness', () => { const c = db.getCurrentCompanyId(); return c ? ex3().submissionTimeliness(c) : {}; });
  ipcMain.handle('ex:employee-monthly-spending', (_e, { month }: any = {}) => { const c = db.getCurrentCompanyId(); return c ? ex3().employeeMonthlySpending(c, month) : []; });
  ipcMain.handle('ex:mileage-rates', () => ex3().mileageRateHistory());
  // Batch ops (EX61-EX70)
  ipcMain.handle('ex:batch-recategorize', (_e, { expenseIds, categoryId }: any) => { const c = db.getCurrentCompanyId(); return c ? ex3().batchRecategorize(c, expenseIds, categoryId) : {}; });
  ipcMain.handle('ex:batch-tax-deductible', (_e, { expenseIds, deductible }: any) => { const c = db.getCurrentCompanyId(); return c ? ex3().batchMarkTaxDeductible(c, expenseIds, deductible) : {}; });
  ipcMain.handle('ex:batch-assign-project', (_e, { expenseIds, projectId }: any) => { const c = db.getCurrentCompanyId(); return c ? ex3().batchAssignProject(c, expenseIds, projectId) : {}; });
  ipcMain.handle('ex:batch-payment-method', (_e, { expenseIds, method }: any) => { const c = db.getCurrentCompanyId(); return c ? ex3().batchChangePaymentMethod(c, expenseIds, method) : {}; });
  ipcMain.handle('ex:data-quality', (_e, { expenseId }: any) => ex3().expenseDataQuality(expenseId));
  ipcMain.handle('ex:bulk-data-quality', () => { const c = db.getCurrentCompanyId(); return c ? ex3().bulkDataQuality(c) : {}; });
  ipcMain.handle('ex:merge-vendor', (_e, { fromVendorId, toVendorId }: any) => { const c = db.getCurrentCompanyId(); return c ? ex3().mergeVendorOnExpenses(c, fromVendorId, toVendorId) : {}; });
  ipcMain.handle('ex:find-orphans', () => ex3().findOrphanExpenses());
  ipcMain.handle('ex:batch-reimburse', (_e, { expenseIds }: any) => { const c = db.getCurrentCompanyId(); return c ? ex3().batchMarkReimbursed(c, expenseIds) : {}; });
  ipcMain.handle('ex:create-template', (_e, p: any) => { const c = db.getCurrentCompanyId(); return c ? ex3().createExpenseTemplate(c, p) : {}; });
  // UX (EX71-EX80)
  ipcMain.handle('ex:dashboard', () => { const c = db.getCurrentCompanyId(); return c ? ex3().expenseDashboard(c) : {}; });
  ipcMain.handle('ex:recent-vendors', (_e, { limit }: any = {}) => { const c = db.getCurrentCompanyId(); return c ? ex3().recentVendors(c, limit || 10) : []; });
  ipcMain.handle('ex:recent-categories', (_e, { limit }: any = {}) => { const c = db.getCurrentCompanyId(); return c ? ex3().recentCategories(c, limit || 10) : []; });
  ipcMain.handle('ex:count-by-status', () => { const c = db.getCurrentCompanyId(); return c ? ex3().expenseCountByStatus(c) : []; });
  ipcMain.handle('ex:avg-processing-time', () => { const c = db.getCurrentCompanyId(); return c ? ex3().avgProcessingTime(c) : {}; });
  ipcMain.handle('ex:tags-summary', () => { const c = db.getCurrentCompanyId(); return c ? ex3().expenseTagsSummary(c) : []; });
  ipcMain.handle('ex:quarterly-comparison', () => { const c = db.getCurrentCompanyId(); return c ? ex3().quarterlyComparison(c) : []; });
  ipcMain.handle('ex:full-text-search', (_e, { query, limit }: any) => { const c = db.getCurrentCompanyId(); return c ? ex3().fullTextSearch(c, query, limit) : []; });
  ipcMain.handle('ex:toggle-star', (_e, { expenseId }: any) => { const c = db.getCurrentCompanyId(); return c ? ex3().toggleStarExpense(c, expenseId) : {}; });
  ipcMain.handle('ex:portal-health', () => { const c = db.getCurrentCompanyId(); return c ? ex3().portalHealthCheck(c) : {}; });

  // ─── Invoice Upgrades Wave (F893-F922) — `iu:*` namespace ──
  const iu = () => require('../services/invoice-upgrades-features');
  // Batch IA: Builder UX
  ipcMain.handle('iu:tpl:save', (_e, p: any) => iu().saveInvoiceLineTemplate(p));
  ipcMain.handle('iu:tpl:list', (_e, { user_id }: any = {}) => iu().listInvoiceLineTemplates(user_id));
  ipcMain.handle('iu:tpl:load', (_e, { id }: any) => iu().loadInvoiceLineTemplate(id));
  ipcMain.handle('iu:time:pull', (_e, { project_id, rate, merge_by }: any) => iu().pullTimeEntriesAsLines(project_id, { rate, merge_by }));
  ipcMain.handle('iu:bulk:parse', (_e, { text }: any) => iu().parseInvoiceBulkLines(text || ''));
  // Batch IB: Smart Inference
  ipcMain.handle('iu:smart:due-date', (_e, { client_id, fallback_days, issue_date }: any) => iu().predictSmartDueDate(client_id, { fallback_days, issue_date }));
  ipcMain.handle('iu:fx:preview', (_e, { amount, from, to }: any) => iu().previewCurrencyConversion(amount, from, to));
  ipcMain.handle('iu:credit:apply', (_e, p: any) => iu().applyCreditToInvoice(p));
  ipcMain.handle('iu:progress:pct', (_e, { invoice_id }: any) => iu().progressBillingPercentage(invoice_id));
  ipcMain.handle('iu:late-fee:preview', (_e, { invoice_id }: any) => iu().previewLateFee(invoice_id));
  // Batch IC: Client Engagement
  ipcMain.handle('iu:view:log', (_e, p: any) => iu().logInvoiceView(p));
  ipcMain.handle('iu:view:history', (_e, { invoice_id }: any) => iu().getInvoiceViewHistory(invoice_id));
  ipcMain.handle('iu:email-tpl:save', (_e, p: any) => iu().saveInvoiceEmailTemplate(p));
  ipcMain.handle('iu:email-tpl:resolve', (_e, p: any) => iu().resolveEmailTemplate(p));
  ipcMain.handle('iu:email:thank-you', (_e, { invoice_id }: any) => iu().generateThankYouNote(invoice_id));
  // Batch ID: Workflow
  ipcMain.handle('iu:approval:create-rule', (_e, p: any) => iu().createInvoiceApprovalRule(p));
  ipcMain.handle('iu:approval:route', (_e, { invoice_id }: any) => iu().routeInvoiceApproval(invoice_id));
  ipcMain.handle('iu:payment:suggest', (_e, p: any) => iu().suggestPaymentMatches(p));
  ipcMain.handle('iu:credit-memo:issue', (_e, p: any) => iu().issueCreditMemo(p));
  ipcMain.handle('iu:writeoff', (_e, { invoice_id, reason, actor_user_id }: any) => iu().writeOffInvoice(invoice_id, reason, actor_user_id));
  // Batch IE: Analytics
  ipcMain.handle('iu:dso', (_e, opts: any = {}) => iu().computeDsoForClient(opts));
  ipcMain.handle('iu:top-clients', (_e, opts: any = {}) => iu().topRevenueClients(opts));
  ipcMain.handle('iu:aging', (_e, { client_id }: any = {}) => iu().arAgingByBucket(client_id));
  ipcMain.handle('iu:cashflow:projection', (_e, { days_ahead }: any = {}) => iu().cashFlowProjection(days_ahead || 90));
  ipcMain.handle('iu:collection:score', (_e, { invoice_id }: any) => iu().computeCollectionScore(invoice_id));
  // Batch IF: Bulk Ops
  ipcMain.handle('iu:bulk:remind', (_e, { invoice_ids, cadence, actor_user_id }: any) => iu().bulkSendReminders(invoice_ids || [], { cadence, actor_user_id }));
  ipcMain.handle('iu:bulk:apply-payment', (_e, p: any) => iu().bulkApplyPayment(p));
  ipcMain.handle('iu:bulk:void', (_e, { invoice_ids, reason, actor_user_id }: any) => iu().bulkVoidInvoices(invoice_ids || [], reason, actor_user_id));
  ipcMain.handle('iu:bulk:mark-sent', (_e, { invoice_ids, sent_by }: any) => iu().bulkMarkSent(invoice_ids || [], sent_by));
  ipcMain.handle('iu:bulk:export-manifest', (_e, { invoice_ids }: any) => iu().bulkExportManifest(invoice_ids || []));

  // ─── Invoice Wave II (F923-F962) — `iw:*` namespace ──
  const iw = () => require('../services/invoice-wave2-features');
  // Batch IG: Recurring & Subscriptions
  ipcMain.handle('iw:recurring:run', () => iw().runRecurringInvoicesDue());
  ipcMain.handle('iw:metrics:mrr', () => iw().computeSubscriptionMetrics());
  ipcMain.handle('iw:proration', (_e, p: any) => iw().calculateProration(p));
  ipcMain.handle('iw:trials:expiring', (_e, { days_ahead }: any = {}) => iw().trialsAboutToExpire(days_ahead || 3));
  ipcMain.handle('iw:sub:auto-renew', (_e, { subscription_id, auto_renew }: any) => iw().setSubscriptionAutoRenewal(subscription_id, !!auto_renew));
  // Batch IH: PDF & Brand Customization
  ipcMain.handle('iw:brand:upsert', (_e, p: any) => iw().upsertBrandProfile(p));
  ipcMain.handle('iw:brand:list', () => iw().listBrandProfiles());
  ipcMain.handle('iw:brand:default', () => iw().getDefaultBrandProfile());
  ipcMain.handle('iw:watermark', (_e, { invoice_id }: any) => iw().watermarkForInvoice(invoice_id));
  ipcMain.handle('iw:preview-html', (_e, { invoice_id, brand_profile_id }: any) => iw().previewInvoiceHtml(invoice_id, brand_profile_id));
  // Batch II: Quote-to-Invoice
  ipcMain.handle('iw:quote:convert', (_e, p: any) => iw().convertQuoteToInvoice(p));
  ipcMain.handle('iw:quote:funnel', (_e, opts: any = {}) => iw().quoteFunnelMetrics(opts));
  ipcMain.handle('iw:quote:auto-convert', () => iw().autoConvertAcceptedQuotes());
  ipcMain.handle('iw:quote:revisions', (_e, { quote_id }: any) => iw().quoteRevisionHistory(quote_id));
  ipcMain.handle('iw:quote:expired', () => iw().expiredQuotesNeedingFollowup());
  // Batch IJ: Discounts & Promotions
  ipcMain.handle('iw:coupon:upsert', (_e, p: any) => iw().upsertCoupon(p));
  ipcMain.handle('iw:coupon:validate', (_e, { code, opts }: any) => iw().validateCoupon(code, opts || {}));
  ipcMain.handle('iw:coupon:redeem', (_e, p: any) => iw().redeemCoupon(p));
  ipcMain.handle('iw:coupon:report', () => iw().couponPerformanceReport());
  ipcMain.handle('iw:volume-discount', (_e, { quantity, tiers }: any) => iw().calculateVolumeDiscount(quantity, tiers || []));
  // Batch IK: Payment Processing
  ipcMain.handle('iw:payment-intent:create', (_e, p: any) => iw().createPaymentIntent(p));
  ipcMain.handle('iw:qr:payload', (_e, { invoice_id, base_url }: any) => iw().generatePaymentQrPayload(invoice_id, base_url));
  ipcMain.handle('iw:bank-transfer:instructions', (_e, { invoice_id }: any) => iw().bankTransferInstructions(invoice_id));
  ipcMain.handle('iw:payment:method-ranking', () => iw().paymentMethodSuccessRanking());
  ipcMain.handle('iw:payment:retry-queue', () => iw().failedPaymentRetryQueue());
  // Batch IL: International
  ipcMain.handle('iw:i18n:labels', (_e, { lang }: any) => iw().getInvoiceI18nLabels(lang || 'en'));
  ipcMain.handle('iw:vat:validate', (_e, { country, vat_number }: any) => iw().validateVatNumber(country || '', vat_number || ''));
  ipcMain.handle('iw:reverse-charge', (_e, p: any) => iw().shouldApplyReverseCharge(p));
  ipcMain.handle('iw:tax:country-rules', (_e, { country }: any) => iw().countryTaxRules(country || 'US'));
  ipcMain.handle('iw:fx:exposure', () => iw().currencyExposureReport());
  // Batch IM: Workflow Automation
  ipcMain.handle('iw:workflow:create', (_e, p: any) => iw().createWorkflowRule(p));
  ipcMain.handle('iw:workflow:evaluate', (_e, p: any) => iw().evaluateWorkflowRules(p));
  ipcMain.handle('iw:predict:payment-date', (_e, { invoice_id }: any) => iw().predictPaymentDate(invoice_id));
  ipcMain.handle('iw:suggest:classification', (_e, { client_id }: any) => iw().suggestInvoiceClassification(client_id));
  ipcMain.handle('iw:approval:required', (_e, { invoice_id }: any) => iw().shouldRequireApproval(invoice_id));
  // Batch IN: Client Portal & Reporting
  ipcMain.handle('iw:portal:token', (_e, p: any) => iw().issueClientPortalToken(p));
  ipcMain.handle('iw:statement', (_e, p: any) => iw().clientStatement(p));
  ipcMain.handle('iw:forecast:revenue', (_e, { weeks_ahead }: any = {}) => iw().revenueForecast(weeks_ahead || 12));
  ipcMain.handle('iw:ltv', (_e, { client_id }: any) => iw().computeClientLtv(client_id));
  ipcMain.handle('iw:churn:predict', (_e, { client_id }: any) => iw().predictClientChurn(client_id));

  // ─── Invoice Wave 3 (80 features: IV1–IV80) ───────────
  const iv3 = () => require('../services/invoice-wave3-features');
  // Coupons (IV1-IV8)
  ipcMain.handle('iv:coupons', (_e, { activeOnly }: any = {}) => { const c = db.getCurrentCompanyId(); return c ? iv3().listCoupons(c, !!activeOnly) : []; });
  ipcMain.handle('iv:coupon:upsert', (_e, p: any) => { const c = db.getCurrentCompanyId(); return iv3().upsertCoupon({ ...p, company_id: c }); });
  ipcMain.handle('iv:coupon:delete', (_e, { id }: any) => { iv3().deleteCoupon(id); return { ok: true }; });
  ipcMain.handle('iv:coupon:redeem', (_e, { code, invoiceId, invoiceTotal }: any) => { const c = db.getCurrentCompanyId(); return c ? iv3().redeemCoupon(c, code, invoiceId, invoiceTotal) : {}; });
  ipcMain.handle('iv:coupon:history', () => { const c = db.getCurrentCompanyId(); return c ? iv3().couponRedemptionHistory(c) : []; });
  ipcMain.handle('iv:coupon:summary', () => { const c = db.getCurrentCompanyId(); return c ? iv3().couponSummary(c) : {}; });
  ipcMain.handle('iv:coupon:validate', (_e, { code }: any) => { const c = db.getCurrentCompanyId(); return c ? iv3().validateCoupon(c, code) : {}; });
  ipcMain.handle('iv:coupon:expired', () => { const c = db.getCurrentCompanyId(); return c ? iv3().expiredCoupons(c) : []; });
  // Credit memos (IV9-IV14)
  ipcMain.handle('iv:credit-memos', (_e, opts: any = {}) => { const c = db.getCurrentCompanyId(); return c ? iv3().listCreditMemos(c, opts.clientId) : []; });
  ipcMain.handle('iv:credit-memo:create', (_e, p: any) => { const c = db.getCurrentCompanyId(); return iv3().createCreditMemo({ ...p, company_id: c }); });
  ipcMain.handle('iv:credit-memo:apply', (_e, { memoId, toInvoiceId }: any) => iv3().applyCreditMemo(memoId, toInvoiceId));
  ipcMain.handle('iv:credit-memo:void', (_e, { id }: any) => { iv3().voidCreditMemo(id); return { ok: true }; });
  ipcMain.handle('iv:credit-memo:summary', () => { const c = db.getCurrentCompanyId(); return c ? iv3().creditMemoSummary(c) : {}; });
  ipcMain.handle('iv:client-credit', (_e, { clientId }: any) => { const c = db.getCurrentCompanyId(); return c ? iv3().clientCreditBalance(c, clientId) : {}; });
  // Payment plans (IV15-IV20)
  ipcMain.handle('iv:payment-plan:create', (_e, p: any) => { const c = db.getCurrentCompanyId(); return iv3().createPaymentPlan({ ...p, company_id: c }); });
  ipcMain.handle('iv:payment-plans', (_e, opts: any = {}) => { const c = db.getCurrentCompanyId(); return c ? iv3().listPaymentPlans(c, opts.invoiceId) : []; });
  ipcMain.handle('iv:payment-plan:installments', (_e, { planId }: any) => iv3().paymentPlanInstallments(planId));
  ipcMain.handle('iv:installment:pay', (_e, { installmentId, amount }: any) => iv3().recordInstallmentPayment(installmentId, amount));
  ipcMain.handle('iv:installments:overdue', () => { const c = db.getCurrentCompanyId(); return c ? iv3().overdueInstallments(c) : []; });
  ipcMain.handle('iv:payment-plan:cancel', (_e, { planId }: any) => { iv3().cancelPaymentPlan(planId); return { ok: true }; });
  // Collection scores (IV21-IV26)
  ipcMain.handle('iv:collection-score', (_e, { invoiceId }: any) => iv3().computeCollectionScore(invoiceId));
  ipcMain.handle('iv:collection-scores:bulk', () => { const c = db.getCurrentCompanyId(); return c ? iv3().bulkComputeCollectionScores(c) : {}; });
  ipcMain.handle('iv:collection-board', () => { const c = db.getCurrentCompanyId(); return c ? iv3().collectionScoreBoard(c) : []; });
  ipcMain.handle('iv:dso', (_e, { days }: any = {}) => { const c = db.getCurrentCompanyId(); return c ? iv3().computeDSO(c, days || 90) : {}; });
  ipcMain.handle('iv:dso-by-client', () => { const c = db.getCurrentCompanyId(); return c ? iv3().dsoByClient(c) : []; });
  ipcMain.handle('iv:dso-trend', () => { const c = db.getCurrentCompanyId(); return c ? iv3().dsoTrend(c) : []; });
  // Approval workflow (IV27-IV32)
  ipcMain.handle('iv:approval-rules', () => { const c = db.getCurrentCompanyId(); return c ? iv3().listApprovalRules(c) : []; });
  ipcMain.handle('iv:approval-rule:upsert', (_e, p: any) => { const c = db.getCurrentCompanyId(); return iv3().upsertApprovalRule({ ...p, company_id: c }); });
  ipcMain.handle('iv:approval-rule:delete', (_e, { id }: any) => { iv3().deleteApprovalRule(id); return { ok: true }; });
  ipcMain.handle('iv:submit-for-approval', (_e, { invoiceId, submittedBy }: any) => iv3().submitForApproval(invoiceId, submittedBy));
  ipcMain.handle('iv:approve', (_e, { invoiceId, approverUserId, comment }: any) => iv3().approveInvoice(invoiceId, approverUserId, comment));
  ipcMain.handle('iv:approval-history', (_e, { invoiceId }: any) => iv3().approvalHistory(invoiceId));
  // Templates (IV33-IV38)
  ipcMain.handle('iv:templates', () => { const c = db.getCurrentCompanyId(); return c ? iv3().listInvoiceTemplates(c) : []; });
  ipcMain.handle('iv:template:upsert', (_e, p: any) => { const c = db.getCurrentCompanyId(); return iv3().upsertInvoiceTemplate({ ...p, company_id: c }); });
  ipcMain.handle('iv:template:delete', (_e, { id }: any) => { iv3().deleteInvoiceTemplate(id); return { ok: true }; });
  ipcMain.handle('iv:line-templates', () => { const c = db.getCurrentCompanyId(); return c ? iv3().listLineTemplates(c) : []; });
  ipcMain.handle('iv:line-template:upsert', (_e, p: any) => { const c = db.getCurrentCompanyId(); return iv3().upsertLineTemplate({ ...p, company_id: c }); });
  ipcMain.handle('iv:line-template:delete', (_e, { id }: any) => { iv3().deleteLineTemplate(id); return { ok: true }; });
  // Email & view tracking (IV39-IV44)
  ipcMain.handle('iv:log-email', (_e, p: any) => iv3().logInvoiceEmail(p));
  ipcMain.handle('iv:email-history', (_e, { invoiceId }: any) => iv3().invoiceEmailHistory(invoiceId));
  ipcMain.handle('iv:log-view', (_e, p: any) => iv3().logInvoiceView(p));
  ipcMain.handle('iv:view-history', (_e, { invoiceId }: any) => iv3().invoiceViewHistory(invoiceId));
  ipcMain.handle('iv:view-stats', () => { const c = db.getCurrentCompanyId(); return c ? iv3().invoiceViewStats(c) : []; });
  ipcMain.handle('iv:unviewed', () => { const c = db.getCurrentCompanyId(); return c ? iv3().unviewedInvoices(c) : []; });
  // Attachments & activity (IV45-IV50)
  ipcMain.handle('iv:attachments', (_e, { invoiceId }: any) => iv3().listAttachments(invoiceId));
  ipcMain.handle('iv:attachment:add', (_e, p: any) => iv3().addAttachment(p));
  ipcMain.handle('iv:attachment:delete', (_e, { id }: any) => { iv3().deleteAttachment(id); return { ok: true }; });
  ipcMain.handle('iv:log-activity', (_e, p: any) => iv3().logActivity(p));
  ipcMain.handle('iv:activity-log', (_e, { invoiceId }: any) => iv3().activityLog(invoiceId));
  ipcMain.handle('iv:recent-activity', (_e, { limit }: any = {}) => { const c = db.getCurrentCompanyId(); return c ? iv3().recentActivity(c, limit || 30) : []; });
  // Analytics (IV51-IV60)
  ipcMain.handle('iv:dashboard', () => { const c = db.getCurrentCompanyId(); return c ? iv3().invoiceDashboard(c) : {}; });
  ipcMain.handle('iv:revenue-by-month', (_e, { months }: any = {}) => { const c = db.getCurrentCompanyId(); return c ? iv3().revenueByMonth(c, months || 12) : []; });
  ipcMain.handle('iv:collection-rate', () => { const c = db.getCurrentCompanyId(); return c ? iv3().collectionRate(c) : {}; });
  ipcMain.handle('iv:avg-payment-days', () => { const c = db.getCurrentCompanyId(); return c ? iv3().avgPaymentDays(c) : {}; });
  ipcMain.handle('iv:by-status', () => { const c = db.getCurrentCompanyId(); return c ? iv3().invoicesByStatus(c) : []; });
  ipcMain.handle('iv:top-clients', (_e, { limit }: any = {}) => { const c = db.getCurrentCompanyId(); return c ? iv3().topClientsRevenue(c, limit || 10) : []; });
  ipcMain.handle('iv:aging', () => { const c = db.getCurrentCompanyId(); return c ? iv3().invoiceAging(c) : []; });
  ipcMain.handle('iv:growth-rate', () => { const c = db.getCurrentCompanyId(); return c ? iv3().invoiceGrowthRate(c) : []; });
  ipcMain.handle('iv:avg-size', () => { const c = db.getCurrentCompanyId(); return c ? iv3().avgInvoiceSize(c) : {}; });
  ipcMain.handle('iv:by-day-of-week', () => { const c = db.getCurrentCompanyId(); return c ? iv3().invoicesByDayOfWeek(c) : []; });
  // Workflow & smart filters (IV61-IV70)
  ipcMain.handle('iv:smart-filters', (_e, opts: any = {}) => { const c = db.getCurrentCompanyId(); return c ? iv3().listSmartFilters(c, opts.userId) : []; });
  ipcMain.handle('iv:smart-filter:upsert', (_e, p: any) => { const c = db.getCurrentCompanyId(); return iv3().upsertSmartFilter({ ...p, company_id: c }); });
  ipcMain.handle('iv:smart-filter:delete', (_e, { id }: any) => { iv3().deleteSmartFilter(id); return { ok: true }; });
  ipcMain.handle('iv:workflow-rules', () => { const c = db.getCurrentCompanyId(); return c ? iv3().listWorkflowRules(c) : []; });
  ipcMain.handle('iv:workflow-rule:upsert', (_e, p: any) => { const c = db.getCurrentCompanyId(); return iv3().upsertWorkflowRule({ ...p, company_id: c }); });
  ipcMain.handle('iv:workflow-rule:delete', (_e, { id }: any) => { iv3().deleteWorkflowRule(id); return { ok: true }; });
  ipcMain.handle('iv:batch-send', (_e, { invoiceIds }: any) => { const c = db.getCurrentCompanyId(); return c ? iv3().batchSendInvoices(c, invoiceIds) : {}; });
  ipcMain.handle('iv:batch-void', (_e, { invoiceIds }: any) => { const c = db.getCurrentCompanyId(); return c ? iv3().batchVoidInvoices(c, invoiceIds) : {}; });
  ipcMain.handle('iv:duplicate', (_e, { invoiceId }: any) => iv3().duplicateInvoice(invoiceId));
  ipcMain.handle('iv:payment-method-breakdown', () => { const c = db.getCurrentCompanyId(); return c ? iv3().paymentMethodBreakdown(c) : []; });
  // Reports & health (IV71-IV80)
  ipcMain.handle('iv:by-client', () => { const c = db.getCurrentCompanyId(); return c ? iv3().invoicesByClient(c) : []; });
  ipcMain.handle('iv:unpaid-summary', () => { const c = db.getCurrentCompanyId(); return c ? iv3().unpaidInvoicesSummary(c) : []; });
  ipcMain.handle('iv:late-fee-report', () => { const c = db.getCurrentCompanyId(); return c ? iv3().lateFeeReport(c) : []; });
  ipcMain.handle('iv:recurring-summary', () => { const c = db.getCurrentCompanyId(); return c ? iv3().recurringInvoiceSummary(c) : {}; });
  ipcMain.handle('iv:export', (_e, opts: any = {}) => { const c = db.getCurrentCompanyId(); return c ? iv3().invoiceExportData(c, opts.startDate, opts.endDate) : []; });
  ipcMain.handle('iv:search', (_e, { query, limit }: any) => { const c = db.getCurrentCompanyId(); return c ? iv3().invoiceSearchFullText(c, query, limit) : []; });
  ipcMain.handle('iv:portal-health', () => { const c = db.getCurrentCompanyId(); return c ? iv3().invoicePortalHealth(c) : {}; });
  ipcMain.handle('iv:quarterly', () => { const c = db.getCurrentCompanyId(); return c ? iv3().invoiceQuarterlyComparison(c) : []; });
  ipcMain.handle('iv:client-payment-behavior', () => { const c = db.getCurrentCompanyId(); return c ? iv3().clientPaymentBehavior(c) : []; });
  ipcMain.handle('iv:by-client-list', () => { const c = db.getCurrentCompanyId(); return c ? iv3().invoicesByClient(c) : []; });

  // ─── Loan Wave (F963-F992) — `la:*` namespace ──
  const la = () => require('../services/loan-advanced-features');
  // Batch LA: Refinance & Modifications
  ipcMain.handle('la:refi:compare', (_e, p: any) => la().refinanceScenarioComparison(p));
  ipcMain.handle('la:refi:execute', (_e, p: any) => la().executeRefinance(p));
  ipcMain.handle('la:mod:apply', (_e, p: any) => la().applyLoanModification(p));
  ipcMain.handle('la:lump-principal', (_e, p: any) => la().lumpSumPrincipalPayment(p));
  ipcMain.handle('la:biweekly:impact', (_e, { loan_id }: any) => la().biweeklyConversionImpact(loan_id));
  // Batch LB: Collateral & Documents
  ipcMain.handle('la:collateral:attach', (_e, p: any) => la().attachCollateral(p));
  ipcMain.handle('la:doc:attach', (_e, p: any) => la().attachLoanDocument(p));
  ipcMain.handle('la:collateral:revalue', (_e, { id, new_value, appraisal_date }: any) => la().revalueCollateral(id, new_value, appraisal_date));
  ipcMain.handle('la:ltv', (_e, { loan_id }: any) => la().computeLtv(loan_id));
  ipcMain.handle('la:loans-by-asset', (_e, { asset_id }: any) => la().loansSecuredByAsset(asset_id));
  // Batch LC: Covenants & Compliance
  ipcMain.handle('la:covenant:create', (_e, p: any) => la().createCovenant(p));
  ipcMain.handle('la:covenant:measure', (_e, { id }: any) => la().computeCovenantStatus(id));
  ipcMain.handle('la:covenant:breaches', () => la().listCovenantBreaches());
  ipcMain.handle('la:compliance:certificate', (_e, opts: any = {}) => la().generateComplianceCertificate(opts));
  ipcMain.handle('la:covenant:upcoming', (_e, { days_ahead }: any = {}) => la().upcomingCovenantMeasurements(days_ahead || 30));
  // Batch LD: ARM
  ipcMain.handle('la:arm:schedule', (_e, p: any) => la().scheduleArmReset(p));
  ipcMain.handle('la:arm:upcoming', (_e, { days_ahead }: any = {}) => la().upcomingArmResets(days_ahead || 90));
  ipcMain.handle('la:arm:apply', (_e, { id }: any) => la().applyArmReset(id));
  ipcMain.handle('la:recast', (_e, { loan_id }: any) => la().recastSchedule(loan_id));
  ipcMain.handle('la:stress:rate-shock', (_e, { loan_id, shock_pct }: any) => la().rateShockStressTest(loan_id, shock_pct));
  // Batch LE: Escrow & PMI
  ipcMain.handle('la:escrow:record', (_e, p: any) => la().recordEscrowEntry(p));
  ipcMain.handle('la:escrow:analysis', (_e, { loan_id, year }: any) => la().annualEscrowAnalysis(loan_id, year));
  ipcMain.handle('la:pmi:setup', (_e, p: any) => la().setupPmi(p));
  ipcMain.handle('la:pmi:check-cancel', (_e, { loan_id }: any) => la().checkPmiCancellation(loan_id));
  ipcMain.handle('la:insurance:link', (_e, { collateral_id, policy_id }: any) => la().linkInsuranceToCollateral(collateral_id, policy_id));
  // Batch LF: Tax & Portfolio
  ipcMain.handle('la:1098:generate', (_e, { loan_id, tax_year }: any) => la().generate1098(loan_id, tax_year));
  ipcMain.handle('la:deductible-interest', (_e, { loan_id, tax_year, business_use_pct }: any) => la().computeDeductibleInterest(loan_id, tax_year, business_use_pct));
  ipcMain.handle('la:dscr', () => la().computeDscr());
  ipcMain.handle('la:debt-to-equity', () => la().computeDebtToEquity());
  ipcMain.handle('la:portfolio:dashboard', () => la().loanPortfolioDashboard());

  // ─── Loan Full-System Wave (F993-F1052) — `lf:*` namespace ──
  const lf = () => require('../services/loan-full-system');
  // LG type-specific calculations
  ipcMain.handle('lf:idr:calc', (_e, p: any) => lf().calculateIdrPayment(p));
  ipcMain.handle('lf:pslf:track', (_e, p: any) => lf().trackPslfPayment(p));
  ipcMain.handle('lf:heloc:phase-calc', (_e, p: any) => lf().helocPhaseCalculator(p));
  ipcMain.handle('lf:construction:project', (_e, p: any) => lf().constructionLoanProjection(p));
  ipcMain.handle('lf:reverse:options', (_e, p: any) => lf().reverseMortgageOptions(p));
  ipcMain.handle('lf:cc:payoff', (_e, p: any) => lf().creditCardPayoff(p));
  ipcMain.handle('lf:lease-vs-buy', (_e, p: any) => lf().leaseVsBuyComparison(p));
  ipcMain.handle('lf:auto:afford', (_e, p: any) => lf().autoLoanAffordability(p));
  ipcMain.handle('lf:sba:eligible', (_e, p: any) => lf().sbaEligibilityCheck(p));
  ipcMain.handle('lf:margin:call', (_e, p: any) => lf().marginCallCalculator(p));
  // LH advanced math
  ipcMain.handle('lf:pv', (_e, p: any) => lf().presentValue(p));
  ipcMain.handle('lf:fv', (_e, p: any) => lf().futureValue(p));
  ipcMain.handle('lf:npv', (_e, { cash_flows, discount_rate_pct }: any) => lf().calculateNpv(cash_flows || [], discount_rate_pct));
  ipcMain.handle('lf:irr', (_e, { cash_flows, max_iter, tolerance }: any) => lf().calculateIrr(cash_flows || [], max_iter, tolerance));
  ipcMain.handle('lf:apr-to-apy', (_e, { apr_pct, compounds }: any) => lf().aprToApy(apr_pct, compounds || 12));
  ipcMain.handle('lf:apy-to-apr', (_e, { apy_pct, compounds }: any) => lf().apyToApr(apy_pct, compounds || 12));
  ipcMain.handle('lf:apr-with-fees', (_e, p: any) => lf().calculateAprWithFees(p));
  ipcMain.handle('lf:yield-maintenance', (_e, p: any) => lf().yieldMaintenancePenalty(p));
  ipcMain.handle('lf:defeasance', (_e, p: any) => lf().defeasanceCost(p));
  ipcMain.handle('lf:duration', (_e, p: any) => lf().modifiedDuration(p));
  ipcMain.handle('lf:cecl', (_e, p: any) => lf().cecLossReserve(p));
  ipcMain.handle('lf:tax-equiv-yield', (_e, p: any) => lf().taxEquivalentYield(p));
  // LI applications & origination
  ipcMain.handle('lf:app:create', (_e, p: any) => lf().createLoanApplication(p));
  ipcMain.handle('lf:prequal', (_e, p: any) => lf().preQualify(p));
  ipcMain.handle('lf:1003', (_e, { borrower_id, application_id }: any) => lf().generate1003Form(borrower_id, application_id));
  ipcMain.handle('lf:underwriting:checklist', (_e, { application_id }: any) => lf().underwritingChecklist(application_id));
  ipcMain.handle('lf:loan-estimate', (_e, { application_id }: any) => lf().generateLoanEstimate(application_id));
  ipcMain.handle('lf:cd:generate', (_e, { loan_id }: any) => lf().generateClosingDisclosure(loan_id));
  ipcMain.handle('lf:til:generate', (_e, { loan_id }: any) => lf().generateTilDisclosure(loan_id));
  ipcMain.handle('lf:promissory:create', (_e, p: any) => lf().createPromissoryNote(p));
  ipcMain.handle('lf:committee:package', (_e, { application_id }: any) => lf().loanCommitteePackage(application_id));
  ipcMain.handle('lf:borrower:upsert', (_e, p: any) => lf().upsertBorrowerProfile(p));
  // LJ risk & compliance
  ipcMain.handle('lf:credit:update', (_e, { borrower_id, score, source }: any) => lf().updateCreditScore(borrower_id, score, source));
  ipcMain.handle('lf:dti', (_e, { borrower_id, additional_monthly_payment }: any) => lf().calculateBorrowerDti(borrower_id, additional_monthly_payment || 0));
  ipcMain.handle('lf:reserve:portfolio', (_e, opts: any = {}) => lf().portfolioLossReserve(opts));
  ipcMain.handle('lf:dscr:weighted', () => lf().riskWeightedDscr());
  ipcMain.handle('lf:hmda', (_e, { application_id }: any) => lf().hmdaReportingFields(application_id));
  ipcMain.handle('lf:fair-lending', () => lf().fairLendingCheck());
  ipcMain.handle('lf:risk-grade:assign', (_e, p: any) => lf().assignRiskGrade(p));
  ipcMain.handle('lf:watchlist', () => lf().loanWatchlist());
  ipcMain.handle('lf:charge-off', (_e, p: any) => lf().chargeOffLoan(p));
  ipcMain.handle('lf:recovery', (_e, p: any) => lf().recordRecovery(p));
  // LK specialized products
  ipcMain.handle('lf:heloc:draw', (_e, p: any) => lf().helocRecordDraw(p));
  ipcMain.handle('lf:heloc:to-repayment', (_e, p: any) => lf().helocTransitionToRepayment(p));
  ipcMain.handle('lf:construction:draw', (_e, p: any) => lf().createConstructionDraw(p));
  ipcMain.handle('lf:bridge:calc', (_e, p: any) => lf().bridgeLoanCalculator(p));
  ipcMain.handle('lf:lease:classify', (_e, p: any) => lf().classifyLease(p));
  ipcMain.handle('lf:sale-leaseback', (_e, p: any) => lf().saleLeasebackAnalysis(p));
  ipcMain.handle('lf:factoring', (_e, p: any) => lf().factoringAnalysis(p));
  ipcMain.handle('lf:mca', (_e, p: any) => lf().mcaAnalysis(p));
  ipcMain.handle('lf:afr', (_e, { term_category }: any) => lf().getCurrentAfr(term_category || 'mid'));
  ipcMain.handle('lf:loc:track', (_e, p: any) => lf().trackLetterOfCredit(p));
  // LL portfolio analytics
  ipcMain.handle('lf:portfolio:aging', () => lf().portfolioAging());
  ipcMain.handle('lf:portfolio:vintage', () => lf().vintageAnalysis());
  ipcMain.handle('lf:portfolio:concentration', () => lf().concentrationRisk());
  ipcMain.handle('lf:nim', (_e, { months }: any = {}) => lf().netInterestMargin(months || 12));
  ipcMain.handle('lf:loan:yield', (_e, { loan_id }: any) => lf().loanYield(loan_id));
  ipcMain.handle('lf:charge-off:rate', () => lf().chargeOffRate());
  ipcMain.handle('lf:recovery:rate', () => lf().recoveryRate());
  ipcMain.handle('lf:delinquency:rate', () => lf().delinquencyRate());
  ipcMain.handle('lf:portfolio:stress', (_e, p: any) => lf().portfolioStressTest(p));
  ipcMain.handle('lf:reserves:required', () => lf().requiredReserves());

  // ─── Loan Linkage Wave (F1053-F1062) — `lk:*` namespace ──
  const lk = () => require('../services/loan-linkage-features');
  ipcMain.handle('lk:record-payment', (_e, p: any) => lk().recordPaymentWithExpense(p));
  ipcMain.handle('lk:link-bank-tx', (_e, p: any) => lk().linkBankTxToLoanPmt(p));
  ipcMain.handle('lk:expenses-for-loan', (_e, { loan_id, opts }: any) => lk().expensesForLoan(loan_id, opts || {}));
  ipcMain.handle('lk:suggest-loan-for-bank-tx', (_e, p: any) => lk().suggestLoanForBankTx(p));
  ipcMain.handle('lk:auto-gl-accounts', (_e, { loan_id }: any) => lk().autoCreateGlAccountsForLoan(loan_id));
  ipcMain.handle('lk:retrolink', (_e, { expense_id, loan_id, loan_payment_id }: any) => lk().retroLinkExpenseToLoan(expense_id, loan_id, loan_payment_id));
  ipcMain.handle('lk:linkage-dashboard', () => lk().loanLinkageDashboard());
  ipcMain.handle('lk:generate-bill', (_e, p: any) => lk().generateBillForUpcomingPayment(p));
  ipcMain.handle('lk:cashflow-timeline', (_e, { loan_id, opts }: any) => lk().loanCashflowTimeline(loan_id, opts || {}));
  ipcMain.handle('lk:loan-context-for-expense', (_e, { expense_id }: any) => lk().loanContextForExpense(expense_id));
  // Global backfill — reconcile ALL existing loan payments into the
  // expense ledger. Defaults to the active company; pass {all:true}
  // to process every company. Idempotent.
  ipcMain.handle('lk:backfill-expenses', (_e, payload?: { all?: boolean }) => {
    try {
      const cid = payload?.all ? undefined : (db.getCurrentCompanyId() || undefined);
      return lk().backfillLoanPaymentExpenses(cid);
    } catch (e: any) { return { error: e?.message }; }
  });
}
