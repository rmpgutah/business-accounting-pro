import type { IpcMain } from 'electron';
import { dialog } from 'electron';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';
import fs from 'fs';
import { eventBus } from '../../services/EventBus';
import { evaluateRules, mergePatches, rulesAppliedSummary } from '../../rules';
import * as db from '../../database';
import type { IpcDeps } from '../core/types';
import { recordRelationBidirectional } from '../../integrations/entity-graph';

export function registerExpensesIpc(ipcMain: IpcMain, deps: IpcDeps): void {
  const { scheduleAutoBackup, findClosedPeriod, postJournalEntry, localToday, eu } = deps;

  // ─── Expense Upgrades Wave (F863-F892) — `eu:*` namespace ──
  // Batch EA: Bulk Operations
  ipcMain.handle('eu:bulk:approval', (_e, p: any) => eu().bulkSetApprovalStatus(p));

  ipcMain.handle('eu:bulk:recategorize', (_e, { expense_ids, category_id }: any) =>
    eu().bulkRecategorize(expense_ids || [], category_id),
  );

  ipcMain.handle('eu:bulk:assign-project', (_e, { expense_ids, project_id }: any) =>
    eu().bulkAssignProject(expense_ids || [], project_id),
  );

  ipcMain.handle('eu:bulk:reimbursed', (_e, { expense_ids, reimbursed, date }: any) =>
    eu().bulkMarkReimbursed(expense_ids || [], reimbursed, date),
  );

  ipcMain.handle('eu:bulk:tag', (_e, { expense_ids, add, remove }: any) =>
    eu().bulkTag(expense_ids || [], add || [], remove || []),
  );

  ipcMain.handle('eu:bulk:delete', (_e, { expense_ids }: any) =>
    eu().bulkDelete(expense_ids || []),
  );

  // Batch EB: Search & Smart Filters
  ipcMain.handle('eu:filter:save', (_e, p: any) => eu().saveSmartFilter(p));

  ipcMain.handle('eu:filter:list', (_e, { user_id }: any = {}) => eu().listSmartFilters(user_id));

  ipcMain.handle('eu:filter:presets', () => eu().getSystemFilterPresets());

  ipcMain.handle('eu:vendor:quickfind', (_e, { query, limit }: any) =>
    eu().quickFindVendors(query || '', limit || 10),
  );

  ipcMain.handle('eu:filter:by-amount', (_e, p: any) => eu().filterByAmount(p));

  ipcMain.handle('eu:filter:by-attachment', (_e, { has_receipt, limit }: any) =>
    eu().filterByAttachment(!!has_receipt, limit || 200),
  );

  // Batch EC: Hygiene & Duplicates
  ipcMain.handle('eu:dupes:scan', (_e, opts: any = {}) => eu().scanDuplicates(opts));

  ipcMain.handle('eu:receipts:missing', (_e, { days }: any = {}) =>
    eu().expensesMissingReceipts(days || 7),
  );

  ipcMain.handle('eu:dupes:resolve', (_e, { match_id, resolution }: any) =>
    eu().resolveDuplicateMatch(match_id, resolution),
  );

  ipcMain.handle('eu:hygiene:compute', (_e, { expense_id }: any) =>
    eu().computeHygieneScore(expense_id),
  );

  ipcMain.handle('eu:hygiene:report', (_e, opts: any = {}) => eu().bulkHygieneReport(opts));

  // Batch ED: Approval Workflow
  ipcMain.handle('eu:approval:create-rule', (_e, p: any) => eu().createApprovalRule(p));

  ipcMain.handle('eu:approval:route', (_e, { expense_id }: any) =>
    eu().routeApprovalForExpense(expense_id),
  );

  ipcMain.handle('eu:approval:delegate', (_e, p: any) => eu().createApprovalDelegation(p));

  ipcMain.handle('eu:approval:history', (_e, { expense_id }: any) =>
    eu().getApprovalHistory(expense_id),
  );

  ipcMain.handle('eu:approval:sla', (_e, { days }: any = {}) => eu().approvalSlaReport(days || 90));

  // Batch EE: Insights
  ipcMain.handle('eu:insights:top-vendors', (_e, opts: any = {}) => eu().topVendorsBySpend(opts));

  ipcMain.handle('eu:insights:category-rollup', (_e, opts: any = {}) =>
    eu().categorySpendRollup(opts),
  );

  ipcMain.handle('eu:insights:anomalies', (_e, { threshold }: any = {}) =>
    eu().detectExpenseAnomalies(threshold || 2.5),
  );

  ipcMain.handle('eu:insights:monthly-trend', (_e, { months_back }: any = {}) =>
    eu().monthlyTrend(months_back || 12),
  );

  ipcMain.handle('eu:insights:burn-down', (_e, { month }: any = {}) => eu().budgetBurnDown(month));

  // Batch EF: UX Power
  ipcMain.handle('eu:recurring:detect', () => eu().detectRecurringCandidates());

  ipcMain.handle('eu:draft:save', (_e, p: any) => eu().saveExpenseDraft(p));

  ipcMain.handle('eu:draft:get', (_e, { user_id }: any = {}) => eu().getLatestDraft(user_id));

  ipcMain.handle('eu:draft:clear', (_e, { user_id }: any = {}) => eu().clearDraft(user_id));

  // ─── Expense Wave 3 (80 features: EX1–EX80) ───────────
  const ex3 = () => require('../../services/expense-wave3-features');

  // Smart Automation (EX1-EX10)
  ipcMain.handle('ex:auto-split-project', (_e, { expenseId }: any) =>
    ex3().autoSplitByProject(expenseId),
  );

  ipcMain.handle('ex:detect-recurring', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().detectRecurringPatterns(c) : [];
  });

  ipcMain.handle('ex:categorization-accuracy', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().categorizationAccuracy(c) : {};
  });

  ipcMain.handle('ex:spending-velocity', (_e, { days }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().spendingVelocity(c, days || 7) : {};
  });

  ipcMain.handle('ex:find-duplicates', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().findDuplicateExpenses(c) : [];
  });

  ipcMain.handle('ex:forecast-next-month', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().forecastNextMonth(c) : {};
  });

  ipcMain.handle('ex:vendor-anomalies', (_e, { threshold }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().vendorAnomalies(c, threshold || 2) : [];
  });

  ipcMain.handle('ex:unmatched-receipts', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().unmatchedReceipts(c) : [];
  });

  ipcMain.handle('ex:expense-aging', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().expenseAging(c) : [];
  });

  ipcMain.handle('ex:auto-tag', (_e, { rules }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().autoTagExpenses(c, rules || []) : {};
  });

  // Analytics (EX11-EX20)
  ipcMain.handle('ex:spending-by-day', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().spendingByDayOfWeek(c) : [];
  });

  ipcMain.handle('ex:submission-patterns', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().submissionPatterns(c) : [];
  });

  ipcMain.handle('ex:category-trends', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().categoryTrends(c) : [];
  });

  ipcMain.handle('ex:vendor-loyalty', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().vendorLoyaltyScores(c) : [];
  });

  ipcMain.handle('ex:tax-deduction-summary', (_e, { year }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().taxDeductionSummary(c, year) : [];
  });

  ipcMain.handle('ex:expense-revenue-ratio', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().expenseToRevenueRatio(c) : {};
  });

  ipcMain.handle('ex:spending-heatmap', (_e, { weeks }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().spendingHeatmap(c, weeks || 12) : [];
  });

  ipcMain.handle('ex:monthly-growth', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().monthlyGrowthRate(c) : [];
  });

  ipcMain.handle('ex:category-concentration', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().categoryConcentration(c) : {};
  });

  ipcMain.handle('ex:budget-burn-rate', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().budgetBurnRate(c) : [];
  });

  // Workflow (EX21-EX30)
  ipcMain.handle('ex:check-policy', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().checkPolicyViolations(c, p) : {};
  });

  ipcMain.handle('ex:approval-chain', (_e, { amount }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().getApprovalChain(c, amount) : {};
  });

  ipcMain.handle('ex:batch-approve', (_e, { expenseIds, approvedBy }: any) => {
    const c = db.getCurrentCompanyId();
    if (!c) return {};
    const r = ex3().batchApprove(c, expenseIds, approvedBy);
    scheduleAutoBackup();
    return r;
  });

  ipcMain.handle('ex:batch-reject', (_e, { expenseIds, reason }: any) => {
    const c = db.getCurrentCompanyId();
    if (!c) return {};
    const r = ex3().batchReject(c, expenseIds, reason);
    scheduleAutoBackup();
    return r;
  });

  ipcMain.handle('ex:generate-report', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().generateExpenseReport(c, p) : {};
  });

  ipcMain.handle('ex:void-expense', (_e, { expenseId, reason }: any) => {
    const c = db.getCurrentCompanyId();
    if (!c) return {};
    const r = ex3().voidExpense(c, expenseId, reason);
    scheduleAutoBackup();
    return r;
  });

  ipcMain.handle('ex:split-expense', (_e, { expenseId, splits }: any) =>
    ex3().splitExpense(expenseId, splits),
  );

  ipcMain.handle('ex:request-clarification', (_e, { expenseId, question }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().requestClarification(c, expenseId, question) : {};
  });

  ipcMain.handle('ex:submit-on-behalf', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().submitOnBehalf(c, p.data, p.onBehalfOf) : {};
  });

  ipcMain.handle('ex:escalate-stale', (_e, { days }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().escalateStaleExpenses(c, days || 7) : {};
  });

  // Reporting (EX31-EX40)
  ipcMain.handle('ex:by-employee', (_e, opts: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().expenseByEmployee(c, opts.startDate, opts.endDate) : [];
  });

  ipcMain.handle('ex:by-payment-method', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().expenseByPaymentMethod(c) : [];
  });

  ipcMain.handle('ex:yoy-comparison', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().yearOverYearExpenses(c) : [];
  });

  ipcMain.handle('ex:largest', (_e, { limit }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().largestExpenses(c, limit || 20) : [];
  });

  ipcMain.handle('ex:uncategorized', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().uncategorizedExpenses(c) : [];
  });

  ipcMain.handle('ex:missing-receipts', (_e, { threshold }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().missingReceiptsReport(c, threshold || 25) : [];
  });

  ipcMain.handle('ex:reimbursement-aging', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().reimbursementAging(c) : [];
  });

  ipcMain.handle('ex:project-summary', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().projectExpenseSummary(c) : [];
  });

  ipcMain.handle('ex:vendor-trend', (_e, { vendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().vendorSpendingTrend(c, vendorId) : [];
  });

  ipcMain.handle('ex:export-csv', (_e, opts: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().exportExpensesCSV(c, opts.startDate, opts.endDate) : [];
  });

  // Integration (EX41-EX50)
  ipcMain.handle('ex:billable-by-client', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().billableExpensesByClient(c) : [];
  });

  ipcMain.handle('ex:unmatched-bank-txns', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().unmatchedBankTransactionsForExpenses(c) : [];
  });

  ipcMain.handle('ex:loan-linked', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().loanLinkedExpenses(c) : [];
  });

  ipcMain.handle('ex:payroll-linked', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().payrollLinkedExpenses(c) : [];
  });

  ipcMain.handle('ex:convert-to-bill', (_e, { expenseId }: any) =>
    ex3().convertExpenseToBill(expenseId),
  );

  ipcMain.handle('ex:mark-billable', (_e, { expenseId, clientId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().markBillable(c, expenseId, clientId) : {};
  });

  ipcMain.handle('ex:link-project-budget', (_e, { expenseId, projectId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().linkToProjectWithBudgetCheck(c, expenseId, projectId) : {};
  });

  ipcMain.handle('ex:calc-mileage', (_e, { miles, year }: any) =>
    ex3().calculateMileage(miles, year),
  );

  ipcMain.handle('ex:convert-currency', (_e, p: any) =>
    ex3().convertCurrency(p.amount, p.from, p.to, p.rate),
  );

  ipcMain.handle('ex:to-invoice-line', (_e, { expenseId }: any) =>
    ex3().expenseToInvoiceLine(expenseId),
  );

  // Compliance (EX51-EX60)
  ipcMain.handle('ex:per-diem', (_e, p: any) =>
    ex3().calculatePerDiem(p.location || 'standard', p.days, p.mealsIncluded),
  );

  ipcMain.handle('ex:audit-trail', (_e, { expenseId }: any) => ex3().expenseAuditTrail(expenseId));

  ipcMain.handle('ex:policy-compliance', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().policyComplianceReport(c) : {};
  });

  ipcMain.handle('ex:weekend-expenses', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().flagWeekendExpenses(c) : [];
  });

  ipcMain.handle('ex:round-number', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().roundNumberExpenses(c) : [];
  });

  ipcMain.handle('ex:dept-budget-variance', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().deptBudgetVariance(c) : [];
  });

  ipcMain.handle('ex:tax-deductible-breakdown', (_e, { year }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().taxDeductibleBreakdown(c, year) : {};
  });

  ipcMain.handle('ex:submission-timeliness', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().submissionTimeliness(c) : {};
  });

  ipcMain.handle('ex:employee-monthly-spending', (_e, { month }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().employeeMonthlySpending(c, month) : [];
  });

  ipcMain.handle('ex:mileage-rates', () => ex3().mileageRateHistory());

  // Batch ops (EX61-EX70)
  ipcMain.handle('ex:batch-recategorize', (_e, { expenseIds, categoryId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().batchRecategorize(c, expenseIds, categoryId) : {};
  });

  ipcMain.handle('ex:batch-tax-deductible', (_e, { expenseIds, deductible }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().batchMarkTaxDeductible(c, expenseIds, deductible) : {};
  });

  ipcMain.handle('ex:batch-assign-project', (_e, { expenseIds, projectId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().batchAssignProject(c, expenseIds, projectId) : {};
  });

  ipcMain.handle('ex:batch-payment-method', (_e, { expenseIds, method }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().batchChangePaymentMethod(c, expenseIds, method) : {};
  });

  ipcMain.handle('ex:data-quality', (_e, { expenseId }: any) =>
    ex3().expenseDataQuality(expenseId),
  );

  ipcMain.handle('ex:bulk-data-quality', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().bulkDataQuality(c) : {};
  });

  ipcMain.handle('ex:merge-vendor', (_e, { fromVendorId, toVendorId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().mergeVendorOnExpenses(c, fromVendorId, toVendorId) : {};
  });

  ipcMain.handle('ex:find-orphans', () => ex3().findOrphanExpenses());

  ipcMain.handle('ex:batch-reimburse', (_e, { expenseIds }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().batchMarkReimbursed(c, expenseIds) : {};
  });

  ipcMain.handle('ex:create-template', (_e, p: any) => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().createExpenseTemplate(c, p) : {};
  });

  // UX (EX71-EX80)
  ipcMain.handle('ex:dashboard', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().expenseDashboard(c) : {};
  });

  ipcMain.handle('ex:recent-vendors', (_e, { limit }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().recentVendors(c, limit || 10) : [];
  });

  ipcMain.handle('ex:recent-categories', (_e, { limit }: any = {}) => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().recentCategories(c, limit || 10) : [];
  });

  ipcMain.handle('ex:count-by-status', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().expenseCountByStatus(c) : [];
  });

  ipcMain.handle('ex:avg-processing-time', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().avgProcessingTime(c) : {};
  });

  ipcMain.handle('ex:tags-summary', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().expenseTagsSummary(c) : [];
  });

  ipcMain.handle('ex:quarterly-comparison', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().quarterlyComparison(c) : [];
  });

  ipcMain.handle('ex:full-text-search', (_e, { query, limit }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().fullTextSearch(c, query, limit) : [];
  });

  ipcMain.handle('ex:toggle-star', (_e, { expenseId }: any) => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().toggleStarExpense(c, expenseId) : {};
  });

  ipcMain.handle('ex:portal-health', () => {
    const c = db.getCurrentCompanyId();
    return c ? ex3().portalHealthCheck(c) : {};
  });

  // ─── B3: Auto-categorization for new expenses ─────────
  ipcMain.handle('expense:suggest-category', (_event, opts: any) => {
    try {
      const { suggestCategory } = require('../../services/auto-categorize');
      const cid = db.getCurrentCompanyId();
      if (!cid) return { category_id: null, confidence: 0, source: 'none' };
      return suggestCategory({ ...opts, company_id: cid });
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // ─── P4.49: Mileage log ────────────────────────────────
  // Auto-fills rate_per_mile from the mileage_rates table based on
  // the trip's tax year, then computes deduction_amount = miles * rate.
  // Allows manual override of rate by passing rate_per_mile explicitly.
  ipcMain.handle('mileage:list', (_event, opts?: { year?: number; limit?: number }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return [];
      const y = opts?.year;
      const lim = opts?.limit ?? 500;
      const sql =
        'SELECT * FROM mileage_log WHERE company_id = ? ' +
        (y ? 'AND substr(trip_date, 1, 4) = ? ' : '') +
        'ORDER BY trip_date DESC LIMIT ?';
      const params = y ? [cid, String(y), lim] : [cid, lim];
      return db
        .getDb()
        .prepare(sql)
        .all(...params);
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('mileage:save', (_event, payload: any) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No active company' };
      const tripYear = parseInt((payload.trip_date || '').slice(0, 4), 10);
      // Auto-fill rate if not provided.
      let rate = Number(payload.rate_per_mile ?? 0);
      if (!rate && tripYear) {
        const row = db
          .getDb()
          .prepare('SELECT business_rate FROM mileage_rates WHERE year = ?')
          .get(tripYear) as any;
        if (row?.business_rate) rate = Number(row.business_rate);
      }
      const miles = Number(payload.miles ?? 0);
      const deduction = Math.round(miles * rate * 100) / 100;
      const data = {
        ...payload,
        company_id: cid,
        rate_per_mile: rate,
        deduction_amount: deduction,
      };
      if (payload.id) {
        db.update('mileage_log', payload.id, data);
        scheduleAutoBackup();
        return db.getById('mileage_log', payload.id);
      }
      const created = db.create('mileage_log', data);
      scheduleAutoBackup();
      return created;
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('mileage:delete', (_event, { id }: { id: string }) => {
    try {
      db.removeHard('mileage_log', id);
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('mileage:summary', (_event, { year }: { year: number }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { totalMiles: 0, totalDeduction: 0, count: 0 };
      const row = db
        .getDb()
        .prepare(
          'SELECT COUNT(*) as count, COALESCE(SUM(miles), 0) as totalMiles, COALESCE(SUM(deduction_amount), 0) as totalDeduction ' +
            'FROM mileage_log WHERE company_id = ? AND substr(trip_date, 1, 4) = ?',
        )
        .get(cid, String(year)) as any;
      return row || { totalMiles: 0, totalDeduction: 0, count: 0 };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('mileage:current-rate', (_event, { year }: { year?: number }) => {
    try {
      const y = year || new Date().getFullYear();
      const row = db
        .getDb()
        .prepare(
          'SELECT business_rate, medical_rate, charitable_rate FROM mileage_rates WHERE year = ?',
        )
        .get(y) as any;
      return row || { business_rate: 0.7 }; // fallback to current default
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // ─── Atomic expense save (header + line items in one transaction) ─────────
  ipcMain.handle(
    'expense:save',
    async (
      _event,
      {
        expenseId,
        expenseData,
        lineItems,
        isEdit,
      }: {
        expenseId: string | null;
        expenseData: Record<string, any>;
        lineItems: Array<Record<string, any>>;
        isEdit: boolean;
      },
    ) => {
      // Negative quantities and unit prices are valid (credits, refunds, returns, adjustments).
      // No clamping here — the business logic upstream decides sign conventions.
      try {
        const companyId = db.getCurrentCompanyId();
        const rawDb = db.getDb();

        // P1.14: pre-update snapshot for field-level diff audit
        const oldExpense: any = isEdit && expenseId ? db.getById('expenses', expenseId) : null;

        // D3: Period close gate — same logic as invoice:save.
        const _cid = db.getCurrentCompanyId();
        if (_cid) {
          const period = findClosedPeriod(_cid, expenseData.date || '');
          if (period) {
            throw new Error(
              'Cannot save: ' +
                expenseData.date +
                ' falls in a closed accounting period (' +
                period.period_start +
                ' to ' +
                period.period_end +
                '). Reopen the period in Settings to make changes.',
            );
          }
          if (oldExpense?.date && oldExpense.date !== expenseData.date) {
            const oldPeriod = findClosedPeriod(_cid, oldExpense.date);
            if (oldPeriod) {
              throw new Error(
                'Cannot save: original date ' + oldExpense.date + ' is in a closed period.',
              );
            }
          }
        }

        // Net extended price for a line: gross (qty × unit_price) MINUS its
        // discount. A flat discount_amount takes priority over discount_percent
        // (same precedence as the ItemizationEditor). Clamped at 0 — a discount
        // can't make a line negative. This is what makes the per-line discount
        // actually reduce the saved expense amount (previously it was stored on
        // the line but never subtracted, so the expense total ignored it).
        const round2 = (n: number) => Math.round((n || 0) * 100) / 100;
        // Pre-tax, post-discount extended price for a line. Flat discount_amount
        // takes precedence over discount_percent (same as ItemizationEditor),
        // clamped at 0 — a discount can't make a line negative.
        const linePreTax = (li: any): number => {
          const gross = (li.quantity || 1) * (li.unit_price || 0);
          const flat = Number(li.discount_amount || 0);
          const pct = Number(li.discount_percent || 0);
          const disc = flat > 0 ? flat : pct > 0 ? gross * (pct / 100) : 0;
          return Math.max(0, gross - disc);
        };
        const lineNet = (li: any): number => round2(linePreTax(li));
        // Tax on a line. The ItemizationEditor recomputes tax_amount on every
        // edit (tax_rate %, jurisdictions, exemptions all folded in) and that
        // value backs the grand total the user sees, so we TRUST the supplied
        // tax_amount to stay WYSIWYG. We deliberately do NOT recompute from
        // tax_rate here: tax_rate is stored inconsistently across entry paths
        // (the UI treats it as a percentage and divides by 100, but tax-rule /
        // import flows store it as a fraction like 0.0765), so recomputing would
        // corrupt rule-/import-created expenses. tax_amount is the source of
        // truth; tax_rate is only a fallback when no tax_amount was provided.
        const lineTax = (li: any): number => {
          if (li.is_tax_exempt) return 0;
          const provided = Number(li.tax_amount);
          if (Number.isFinite(provided) && provided > 0) return round2(provided);
          const preTax = linePreTax(li);
          let jur: any = li.tax_jurisdictions;
          if (typeof jur === 'string') {
            try {
              jur = JSON.parse(jur);
            } catch {
              jur = [];
            }
          }
          if (Array.isArray(jur) && jur.length > 0) {
            return round2(
              jur.reduce((s: number, j: any) => s + preTax * ((Number(j.rate) || 0) / 100), 0),
            );
          }
          return round2(preTax * ((Number(li.tax_rate) || 0) / 100));
        };

        const saveFn = rawDb.transaction(() => {
          let savedId: string;

          // Auto-calculate amount + tax from line items when present. Per the
          // FINAL-PRICE invariant (see ExpenseList.expenseDisplayTotal), the
          // stored expense.amount is the PRE-TAX subtotal (sum of discounted line
          // extensions) and expense.tax_amount is the tax; the display layer
          // computes the tax-inclusive cost as amount + tax_amount − discount.
          // We must NOT roll tax into amount, or the list/detail would double-add
          // it. Populating tax_amount here is what actually puts tax in the cost
          // for line-item expenses that previously left the header tax_amount 0.
          if (lineItems.length > 0) {
            expenseData.amount = round2(
              lineItems.reduce((sum: number, li: any) => sum + lineNet(li), 0),
            );
            expenseData.tax_amount = round2(
              lineItems.reduce((sum: number, li: any) => sum + lineTax(li), 0),
            );
          }

          // Shipping & Handling tax. Shipping is stored SEPARATELY from amount/
          // tax_amount (so the goods subtotal and goods tax stay clean); the
          // display layer adds shipping_amount + shipping_tax_amount on top. When
          // shipping_taxable is set, we tax it at the EFFECTIVE goods rate
          // (goods tax ÷ goods subtotal) rather than any single header rate —
          // this is unambiguous across the inconsistent tax_rate storage and
          // matches the blended rate the buyer actually paid. Non-taxable
          // shipping (or a zero amount) yields zero shipping tax.
          const shippingAmt = round2(Number(expenseData.shipping_amount || 0));
          const shippingTaxable =
            expenseData.shipping_taxable === 1 || expenseData.shipping_taxable === true;
          if (shippingAmt > 0 && shippingTaxable) {
            const goodsSub = Number(expenseData.amount || 0);
            const goodsTax = Number(expenseData.tax_amount || 0);
            const effRate = goodsSub > 0 ? goodsTax / goodsSub : 0;
            expenseData.shipping_tax_amount = round2(shippingAmt * effRate);
          } else {
            expenseData.shipping_tax_amount = 0;
          }

          if (isEdit && expenseId) {
            db.update('expenses', expenseId, expenseData);
            savedId = expenseId;
            // Replace line items atomically
            const oldLines = db.queryAll('expense_line_items', { expense_id: expenseId });
            for (const ol of oldLines) db.remove('expense_line_items', ol.id);
          } else {
            // Apply tax rules on create
            if (companyId) {
              const taxResults = evaluateRules({
                category: 'tax',
                record: { ...expenseData, company_id: companyId },
                company_id: companyId,
                db: rawDb,
              });
              Object.assign(expenseData, mergePatches(taxResults));
              expenseData.rules_applied = rulesAppliedSummary(taxResults);
              // Apply approval rules
              const approvalResults = evaluateRules({
                category: 'approval',
                record: { ...expenseData, _type: 'expenses', company_id: companyId },
                company_id: companyId,
                db: rawDb,
              });
              if (approvalResults.some((r: any) => r.matched))
                expenseData.status = 'pending_approval';
            }
            const record = db.create('expenses', { ...expenseData, company_id: companyId });
            savedId = record.id;
          }

          // Insert new line items — store each line's NET (post-discount,
          // pre-tax) extended amount in `amount` and the server-computed tax in
          // `tax_amount`, so amount + tax_amount = the line's tax-inclusive total
          // and the per-line figures reconcile to the header total exactly.
          for (let i = 0; i < lineItems.length; i++) {
            db.create('expense_line_items', {
              ...lineItems[i],
              expense_id: savedId,
              amount: lineNet(lineItems[i]),
              tax_amount: lineTax(lineItems[i]),
              sort_order: i,
            });
          }

          // Auto-post JE for new expenses inside the same transaction so a
          // JE failure rolls back the expense — otherwise a partial-failure
          // leaves an expense with no matching ledger entry.
          if (!isEdit && companyId) {
            const amount = Number(expenseData.amount) || 0;
            if (amount > 0) {
              const desc = expenseData.description || 'Expense';
              const isPaid = expenseData.status === 'paid';
              let expenseHint = 'Expense';
              if (expenseData.category_id) {
                try {
                  const cat = rawDb
                    .prepare('SELECT name FROM categories WHERE id = ?')
                    .get(expenseData.category_id) as any;
                  if (cat?.name) expenseHint = cat.name;
                } catch {
                  /* ignore */
                }
              }
              postJournalEntry(
                rawDb,
                companyId,
                expenseData.date || localToday(),
                `Expense recorded - ${desc}`,
                [
                  { nameHint: expenseHint, debit: amount, credit: 0, note: desc },
                  {
                    nameHint: isPaid ? 'Cash' : 'Payable',
                    debit: 0,
                    credit: amount,
                    note: `${isPaid ? 'Cash paid' : 'AP'} for ${desc}`,
                  },
                ],
              );
            }
          }

          // Auto-create document record for receipt attachment
          if (expenseData.receipt_path) {
            const fileName = expenseData.receipt_path.split(/[\\/]/).pop() || 'receipt';
            const existingDoc = rawDb
              .prepare(
                "SELECT id FROM documents WHERE entity_type = 'expense' AND entity_id = ? LIMIT 1",
              )
              .get(savedId) as any;
            if (!existingDoc) {
              db.create('documents', {
                company_id: companyId,
                filename: fileName,
                file_path: expenseData.receipt_path,
                file_size: 0,
                mime_type: '',
                entity_type: 'expense',
                entity_id: savedId,
                tags: '["receipt"]',
                description: 'Expense receipt',
              });
            }
          }

          return savedId;
        });

        const savedId = saveFn();
        // P1.14: emit field-level diff to audit_log on edit.
        // Wrapped in try/catch so an audit-log failure never surfaces as
        // "Failed to save expense" — the expense is already committed.
        try {
          if (companyId) {
            if (isEdit && oldExpense) {
              const newExpense = db.getById('expenses', savedId);
              const changes: Record<string, { old: any; new: any }> = {};
              for (const key of Object.keys(expenseData)) {
                if (oldExpense[key] !== newExpense?.[key]) {
                  changes[key] = { old: oldExpense[key], new: newExpense?.[key] };
                }
              }
              db.logAudit(companyId, 'expenses', savedId, 'update', changes);
            } else {
              db.logAudit(companyId, 'expenses', savedId, 'create');
            }
          }
        } catch (auditErr) {
          console.warn(
            'expense:save audit logging failed (expense was saved):',
            (auditErr as Error)?.message,
          );
        }

        scheduleAutoBackup();

        // Reactive engine: emit expense lifecycle events to drive workflows.
        try {
          if (companyId && savedId) {
            await eventBus
              .emit({
                type: isEdit ? 'expense.updated' : 'expense.created',
                companyId,
                entityType: 'expense',
                entityId: savedId,
                data: {
                  amount: expenseData?.amount,
                  vendor_id: expenseData?.vendor_id,
                  category_id: expenseData?.category_id,
                  status: expenseData?.status,
                },
              })
              .catch(() => {});
          }
        } catch {
          /* fire-and-forget */
        }

        return { id: savedId };
      } catch (err) {
        console.error('expense:save failed:', err);
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // ─── Expense Approval & Reimbursement Workflow ────────────────────
  // Helper: get current setting
  const getCompanySetting = (companyId: string, key: string): string | null => {
    try {
      const row = db
        .getDb()
        .prepare('SELECT value FROM settings WHERE company_id=? AND key=?')
        .get(companyId, key) as any;
      return row?.value ?? null;
    } catch {
      return null;
    }
  };

  // Feature 9: Policy violation check
  ipcMain.handle(
    'expense:check-policy',
    (_event, { expense, lineItems: _lineItems }: { expense: any; lineItems?: any[] }) => {
      const violations: Array<{ code: string; message: string; severity: 'error' | 'warning' }> =
        [];
      const amount = Number(expense.amount || 0);
      if (amount > 500 && !expense.receipt_path) {
        violations.push({
          code: 'receipt_required',
          message: 'Expenses over $500 must have a receipt attached.',
          severity: 'error',
        });
      }
      if (amount > 1000 && !(expense.description || '').trim()) {
        violations.push({
          code: 'manager_comment_required',
          message: 'Expenses over $1,000 require a manager comment / detailed description.',
          severity: 'error',
        });
      }
      // Meal cap
      try {
        const cat = expense.category_id
          ? (db
              .getDb()
              .prepare('SELECT name FROM categories WHERE id=?')
              .get(expense.category_id) as any)
          : null;
        const name = (cat?.name || '').toLowerCase();
        if (name.includes('meal') || name.includes('lunch') || name.includes('entertainment')) {
          const attendees = Number(expense.attendees || expense.custom_fields?.attendees || 1) || 1;
          const perPerson = amount / attendees;
          if (perPerson > 50) {
            violations.push({
              code: 'meal_cap',
              message: `Meal cap exceeded: $${perPerson.toFixed(2)}/person (limit $50). Provide override comment.`,
              severity: 'warning',
            });
          }
        }
      } catch (_) {}
      return { violations };
    },
  );

  // Feature 23: Duplicate detection
  ipcMain.handle(
    'expense:check-duplicate',
    (
      _event,
      {
        companyId,
        vendorId,
        amount,
        date,
        excludeId,
      }: { companyId: string; vendorId?: string; amount: number; date: string; excludeId?: string },
    ) => {
      try {
        const rows = db
          .getDb()
          .prepare(
            `SELECT id, date, amount, description FROM expenses
         WHERE company_id=? AND amount=? AND date BETWEEN date(?, '-1 day') AND date(?, '+1 day')
         ${vendorId ? 'AND vendor_id=?' : ''}
         ${excludeId ? 'AND id!=?' : ''}
         LIMIT 5`,
          )
          .all(
            ...[
              companyId,
              amount,
              date,
              date,
              ...(vendorId ? [vendorId] : []),
              ...(excludeId ? [excludeId] : []),
            ],
          );
        return { duplicates: rows };
      } catch (err: any) {
        return { duplicates: [], error: err?.message };
      }
    },
  );

  // Feature 22: period lock check
  ipcMain.handle(
    'expense:check-period-lock',
    (_event, { companyId, date }: { companyId: string; date: string }) => {
      try {
        const lock = db
          .getDb()
          .prepare(
            `SELECT locked_through_date FROM period_locks WHERE company_id=? ORDER BY locked_through_date DESC LIMIT 1`,
          )
          .get(companyId) as any;
        const lockDate =
          lock?.locked_through_date || getCompanySetting(companyId, 'period_lock_date');
        if (lockDate && date <= lockDate) {
          return { locked: true, lockedThrough: lockDate };
        }
        return { locked: false };
      } catch {
        return { locked: false };
      }
    },
  );

  // Feature 11: list reimbursable expenses for an employee
  ipcMain.handle(
    'expense:reimbursable-for-employee',
    (
      _event,
      {
        companyId,
        employeeId,
        periodStart,
        periodEnd,
      }: { companyId: string; employeeId: string; periodStart?: string; periodEnd?: string },
    ) => {
      try {
        const params: any[] = [companyId, employeeId];
        let where = `e.company_id=? AND e.employee_id=? AND e.is_reimbursable=1 AND e.reimbursed=0
                   AND (e.approval_status='approved' OR e.status='approved')`;
        if (periodStart) {
          where += ` AND e.date >= ?`;
          params.push(periodStart);
        }
        if (periodEnd) {
          where += ` AND e.date <= ?`;
          params.push(periodEnd);
        }
        const rows = db
          .getDb()
          .prepare(
            `SELECT e.*, v.name AS vendor_name, c.name AS category_name
         FROM expenses e LEFT JOIN vendors v ON v.id=e.vendor_id
         LEFT JOIN categories c ON c.id=e.category_id
         WHERE ${where} ORDER BY e.date DESC`,
          )
          .all(...params);
        return { expenses: rows };
      } catch (err: any) {
        return { expenses: [], error: err?.message };
      }
    },
  );

  // Feature 13: per-employee reimbursement balance
  ipcMain.handle(
    'expense:reimbursement-balances',
    (_event, { companyId }: { companyId: string }) => {
      try {
        const rows = db
          .getDb()
          .prepare(
            `SELECT e.employee_id, COALESCE(emp.name,'(unassigned)') AS employee_name,
                COUNT(*) AS expense_count, SUM(e.amount) AS balance
         FROM expenses e
         LEFT JOIN employees emp ON emp.id=e.employee_id
         WHERE e.company_id=? AND e.is_reimbursable=1 AND e.reimbursed=0
           AND (e.approval_status='approved' OR e.status='approved')
         GROUP BY e.employee_id ORDER BY balance DESC`,
          )
          .all(companyId);
        return { balances: rows };
      } catch (err: any) {
        return { balances: [], error: err?.message };
      }
    },
  );

  // Feature 12: create reimbursement batch + mark expenses reimbursed
  ipcMain.handle(
    'reimbursement:create-batch',
    (
      _event,
      {
        companyId,
        employeeId,
        expenseIds,
        periodStart,
        periodEnd,
        notes,
      }: {
        companyId: string;
        employeeId: string;
        expenseIds: string[];
        periodStart?: string;
        periodEnd?: string;
        notes?: string;
      },
    ) => {
      try {
        const id = uuid();
        const dbi = db.getDb();
        const now = new Date().toISOString();
        const placeholders = expenseIds.map(() => '?').join(',');
        const totalRow = dbi
          .prepare(
            `SELECT COALESCE(SUM(amount),0) AS t FROM expenses WHERE id IN (${placeholders})`,
          )
          .get(...expenseIds) as any;
        const total = Number(totalRow?.t || 0);
        // INTEGRITY: insert batch row + update each expense in one transaction.
        // Otherwise a UPDATE failure leaves an empty batch with no expenses tied
        // to it, or partial expenses pointing to a batch whose status is wrong.
        const upd = dbi.prepare(
          `UPDATE expenses SET reimbursement_batch_id=?, reimbursed=1, reimbursed_date=?, status='paid' WHERE id=?`,
        );
        const tx = dbi.transaction((ids: string[]) => {
          dbi
            .prepare(
              `INSERT INTO reimbursement_batches (id, company_id, employee_id, period_start, period_end, total_amount, expense_count, status, notes) VALUES (?,?,?,?,?,?,?,?,?)`,
            )
            .run(
              id,
              companyId,
              employeeId,
              periodStart || '',
              periodEnd || '',
              total,
              ids.length,
              'open',
              notes || '',
            );
          for (const xid of ids) upd.run(id, now.slice(0, 10), xid);
        });
        tx(expenseIds);
        db.logAudit(companyId, 'reimbursement_batch', id, 'create', {
          employee_id: employeeId,
          total,
          count: expenseIds.length,
        });
        scheduleAutoBackup();
        return { id, total, count: expenseIds.length };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  // Feature 18: mark batch paid via payroll
  ipcMain.handle(
    'reimbursement:mark-paid-payroll',
    (_event, { batchId, payrollRunId }: { batchId: string; payrollRunId: string }) => {
      try {
        const dbi = db.getDb();
        dbi
          .prepare(
            `UPDATE reimbursement_batches SET status='paid', paid_date=date('now'), payroll_run_id=? WHERE id=?`,
          )
          .run(payrollRunId, batchId);
        dbi
          .prepare(`UPDATE expenses SET payroll_run_id=? WHERE reimbursement_batch_id=?`)
          .run(payrollRunId, batchId);
        scheduleAutoBackup();
        return { success: true };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  // Feature 16: aging — approved+unpaid older than N days
  ipcMain.handle(
    'reimbursement:aging',
    (_event, { companyId, days = 14 }: { companyId: string; days?: number }) => {
      try {
        const rows = db
          .getDb()
          .prepare(
            `SELECT e.*, emp.name AS employee_name,
                CAST(julianday('now') - julianday(COALESCE(NULLIF(e.submitted_at,''), e.date)) AS INTEGER) AS days_waiting
         FROM expenses e LEFT JOIN employees emp ON emp.id=e.employee_id
         WHERE e.company_id=? AND e.is_reimbursable=1 AND e.reimbursed=0
           AND (e.approval_status='approved' OR e.status='approved')
           AND julianday('now') - julianday(COALESCE(NULLIF(e.submitted_at,''), e.date)) >= ?
         ORDER BY days_waiting DESC`,
          )
          .all(companyId, days);
        return { rows };
      } catch (err: any) {
        return { rows: [], error: err?.message };
      }
    },
  );

  // Feature 4: approval queue for a user (current step assigned to them)
  ipcMain.handle(
    'expense:approval-queue',
    (_event, { companyId, userId }: { companyId: string; userId: string }) => {
      try {
        const dbi = db.getDb();
        // Gather expenses where they're the direct approver_id OR where there's a pending step assigned to them in sequence
        const directRows = dbi
          .prepare(
            `SELECT e.*, v.name AS vendor_name, emp.name AS employee_name
         FROM expenses e LEFT JOIN vendors v ON v.id=e.vendor_id LEFT JOIN employees emp ON emp.id=e.employee_id
         WHERE e.company_id=? AND e.approver_id=? AND e.approval_status IN ('submitted','in_review','needs_info')
         ORDER BY e.submitted_at DESC`,
          )
          .all(companyId, userId);
        const stepRows = dbi
          .prepare(
            `SELECT e.*, v.name AS vendor_name, emp.name AS employee_name, s.id AS step_id, s.step_order, s.created_at AS step_created
         FROM expense_approval_steps s
         JOIN expenses e ON e.id=s.expense_id
         LEFT JOIN vendors v ON v.id=e.vendor_id LEFT JOIN employees emp ON emp.id=e.employee_id
         WHERE s.approver_id=? AND s.status='pending' AND e.company_id=?
         AND s.step_order = (
           SELECT MIN(s2.step_order) FROM expense_approval_steps s2
           WHERE s2.expense_id=e.id AND s2.status='pending'
         )
         ORDER BY s.created_at ASC`,
          )
          .all(userId, companyId);
        return { direct: directRows, steps: stepRows };
      } catch (err: any) {
        return { direct: [], steps: [], error: err?.message };
      }
    },
  );

  // Feature 5/10: decide on a step (approve/reject) with audit trail
  ipcMain.handle(
    'expense:decide',
    (
      _event,
      {
        expenseId,
        userId,
        decision,
        comment,
        stepId,
      }: {
        expenseId: string;
        userId: string;
        decision: 'approve' | 'reject' | 'needs_info';
        comment?: string;
        stepId?: string;
      },
    ) => {
      try {
        const dbi = db.getDb();
        const exp = dbi.prepare('SELECT * FROM expenses WHERE id=?').get(expenseId) as any;
        if (!exp) return { error: 'Expense not found' };
        const previousStatus = exp.approval_status || 'submitted';

        // Multi-step path
        if (stepId) {
          dbi
            .prepare(
              `UPDATE expense_approval_steps SET status=?, comment=?, decided_at=datetime('now') WHERE id=?`,
            )
            .run(
              decision === 'approve'
                ? 'approved'
                : decision === 'reject'
                  ? 'rejected'
                  : 'needs_info',
              comment || '',
              stepId,
            );
          if (decision === 'reject') {
            dbi
              .prepare(
                `UPDATE expenses SET approval_status='rejected', rejection_reason=? WHERE id=?`,
              )
              .run(comment || '', expenseId);
          } else if (decision === 'needs_info') {
            dbi
              .prepare(`UPDATE expenses SET approval_status='needs_info' WHERE id=?`)
              .run(expenseId);
          } else {
            // any pending steps left?
            const left = dbi
              .prepare(
                `SELECT COUNT(*) AS c FROM expense_approval_steps WHERE expense_id=? AND status='pending'`,
              )
              .get(expenseId) as any;
            if (!left || left.c === 0) {
              dbi
                .prepare(
                  `UPDATE expenses SET approval_status='approved', status='approved', approved_by=?, approved_date=date('now') WHERE id=?`,
                )
                .run(userId, expenseId);
            } else {
              dbi
                .prepare(`UPDATE expenses SET approval_status='in_review' WHERE id=?`)
                .run(expenseId);
            }
          }
        } else {
          // Single approver
          const newStatus =
            decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'needs_info';
          if (decision === 'approve') {
            dbi
              .prepare(
                `UPDATE expenses SET approval_status='approved', status='approved', approved_by=?, approved_date=date('now') WHERE id=?`,
              )
              .run(userId, expenseId);
          } else if (decision === 'reject') {
            dbi
              .prepare(
                `UPDATE expenses SET approval_status='rejected', rejection_reason=? WHERE id=?`,
              )
              .run(comment || '', expenseId);
          } else {
            dbi
              .prepare(`UPDATE expenses SET approval_status='needs_info' WHERE id=?`)
              .run(expenseId);
          }
          db.logAudit(exp.company_id, 'expense', expenseId, 'update', {
            previous_status: previousStatus,
            new_status: newStatus,
            comment,
            decided_by: userId,
          });
        }

        // Always log a decision audit entry
        db.logAudit(exp.company_id, 'expense', expenseId, 'update', {
          decision,
          previous_status: previousStatus,
          comment,
          decided_by: userId,
        });

        // Comment record
        if (comment) {
          db.create('expense_comments', {
            expense_id: expenseId,
            user_id: userId,
            body: `[${decision}] ${comment}`,
          });
        }
        scheduleAutoBackup();
        return { success: true };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  // Feature 3: set up approval chain
  ipcMain.handle(
    'expense:set-approval-chain',
    (_event, { expenseId, approverIds }: { expenseId: string; approverIds: string[] }) => {
      try {
        const dbi = db.getDb();
        dbi.prepare('DELETE FROM expense_approval_steps WHERE expense_id=?').run(expenseId);
        const ins = dbi.prepare(
          `INSERT INTO expense_approval_steps (id, expense_id, step_order, approver_id, status) VALUES (?,?,?,?, 'pending')`,
        );
        approverIds.forEach((aid, idx) => ins.run(uuid(), expenseId, idx, aid));
        scheduleAutoBackup();
        return { success: true, count: approverIds.length };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  ipcMain.handle('expense:list-approval-steps', (_event, { expenseId }: { expenseId: string }) => {
    try {
      const rows = db
        .getDb()
        .prepare(
          `SELECT s.*, u.display_name AS approver_name FROM expense_approval_steps s
         LEFT JOIN users u ON u.id=s.approver_id WHERE s.expense_id=? ORDER BY s.step_order ASC`,
        )
        .all(expenseId);
      return { steps: rows };
    } catch (err: any) {
      return { steps: [], error: err?.message };
    }
  });

  // Feature 6: comments
  ipcMain.handle('expense:list-comments', (_event, { expenseId }: { expenseId: string }) => {
    try {
      const rows = db
        .getDb()
        .prepare(
          `SELECT c.*, u.display_name AS user_name FROM expense_comments c
         LEFT JOIN users u ON u.id=c.user_id WHERE c.expense_id=? ORDER BY c.created_at ASC`,
        )
        .all(expenseId);
      return { comments: rows };
    } catch (err: any) {
      return { comments: [], error: err?.message };
    }
  });

  ipcMain.handle(
    'expense:add-comment',
    (_event, { expenseId, userId, body }: { expenseId: string; userId: string; body: string }) => {
      try {
        const row = db.create('expense_comments', { expense_id: expenseId, user_id: userId, body });
        const exp = db
          .getDb()
          .prepare('SELECT company_id FROM expenses WHERE id=?')
          .get(expenseId) as any;
        if (exp)
          db.logAudit(exp.company_id, 'expense', expenseId, 'update', { _action: 'comment', body });
        scheduleAutoBackup();
        return { comment: row };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  // Feature 7: token + deep link
  ipcMain.handle('expense:generate-token', (_event, { expenseId }: { expenseId: string }) => {
    try {
      const token = crypto.randomBytes(24).toString('hex');
      db.getDb().prepare('UPDATE expenses SET approval_token=? WHERE id=?').run(token, expenseId);
      return { token, link: `bap://approve-expense?id=${expenseId}&token=${token}` };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle(
    'expense:validate-token',
    (_event, { expenseId, token }: { expenseId: string; token: string }) => {
      try {
        const row = db
          .getDb()
          .prepare('SELECT approval_token FROM expenses WHERE id=?')
          .get(expenseId) as any;
        return { valid: !!row && row.approval_token && row.approval_token === token };
      } catch (err: any) {
        return { valid: false, error: err?.message };
      }
    },
  );

  // Feature 1/8: submit expense (handles auto-approve threshold + delegation)
  ipcMain.handle(
    'expense:submit',
    (
      _event,
      {
        expenseId,
        submittedBy,
        approverId,
      }: { expenseId: string; submittedBy: string; approverId?: string },
    ) => {
      try {
        const dbi = db.getDb();
        const exp = dbi.prepare('SELECT * FROM expenses WHERE id=?').get(expenseId) as any;
        if (!exp) return { error: 'Expense not found' };
        const threshRaw = getCompanySetting(exp.company_id, 'auto_approve_under');
        const threshold = threshRaw ? Number(threshRaw) : 0;
        const previousStatus = exp.approval_status || 'draft';

        // delegation: if assigned approver has delegate_to and is currently delegating
        let finalApprover = approverId || exp.approver_id || '';
        if (finalApprover) {
          const delegate = getCompanySetting(exp.company_id, `delegate_to:${finalApprover}`);
          if (delegate) finalApprover = delegate;
        }

        if (threshold > 0 && Number(exp.amount) < threshold) {
          dbi
            .prepare(
              `UPDATE expenses SET approval_status='approved', status='approved', submitted_at=datetime('now'), approved_by='auto', approved_date=date('now') WHERE id=?`,
            )
            .run(expenseId);
          db.logAudit(exp.company_id, 'expense', expenseId, 'update', {
            _action: 'auto_approve',
            previous_status: previousStatus,
            new_status: 'approved',
            submitted_by: submittedBy,
          });
          scheduleAutoBackup();
          return { success: true, autoApproved: true };
        } else {
          dbi
            .prepare(
              `UPDATE expenses SET approval_status='submitted', submitted_at=datetime('now'), approver_id=? WHERE id=?`,
            )
            .run(finalApprover, expenseId);
          db.logAudit(exp.company_id, 'expense', expenseId, 'update', {
            _action: 'submit',
            previous_status: previousStatus,
            new_status: 'submitted',
            approver_id: finalApprover,
          });
          scheduleAutoBackup();
          return { success: true, approverId: finalApprover };
        }
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  // Feature 17: notify admin if balance > threshold
  ipcMain.handle(
    'reimbursement:check-threshold',
    (_event, { companyId, employeeId }: { companyId: string; employeeId: string }) => {
      try {
        const t = Number(getCompanySetting(companyId, 'reimbursement_notify_threshold') || 0);
        if (t <= 0) return { triggered: false };
        const row = db
          .getDb()
          .prepare(
            `SELECT COALESCE(SUM(amount),0) AS bal FROM expenses
         WHERE company_id=? AND employee_id=? AND is_reimbursable=1 AND reimbursed=0
           AND (approval_status='approved' OR status='approved')`,
          )
          .get(companyId, employeeId) as any;
        const bal = Number(row?.bal || 0);
        if (bal >= t) {
          try {
            db.create('notifications', {
              company_id: companyId,
              type: 'reimbursement_threshold',
              title: 'Reimbursement balance over threshold',
              message: `Employee has $${bal.toFixed(2)} in pending reimbursements (threshold $${t.toFixed(2)})`,
              severity: 'warning',
              entity_type: 'employee',
              entity_id: employeeId,
              is_read: 0,
            });
          } catch (_) {}
          return { triggered: true, balance: bal, threshold: t };
        }
        return { triggered: false, balance: bal, threshold: t };
      } catch (err: any) {
        return { triggered: false, error: err?.message };
      }
    },
  );

  // Feature 21: lock expense once paid
  ipcMain.handle(
    'expense:lock',
    (_event, { expenseId, locked }: { expenseId: string; locked: boolean }) => {
      try {
        db.getDb()
          .prepare('UPDATE expenses SET is_locked=? WHERE id=?')
          .run(locked ? 1 : 0, expenseId);
        scheduleAutoBackup();
        return { success: true };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );

  // Feature 24: SLA — list pending steps with days waiting
  ipcMain.handle('expense:approval-sla', (_event, { companyId }: { companyId: string }) => {
    try {
      const rows = db
        .getDb()
        .prepare(
          `SELECT s.id AS step_id, s.expense_id, s.approver_id, u.display_name AS approver_name,
                e.amount, e.description, e.submitted_at,
                CAST(julianday('now') - julianday(s.created_at) AS INTEGER) AS days_waiting
         FROM expense_approval_steps s
         JOIN expenses e ON e.id=s.expense_id
         LEFT JOIN users u ON u.id=s.approver_id
         WHERE e.company_id=? AND s.status='pending'
         ORDER BY days_waiting DESC`,
        )
        .all(companyId);
      return { rows };
    } catch (err: any) {
      return { rows: [], error: err?.message };
    }
  });

  // Reimbursement batch listing & detail
  ipcMain.handle('reimbursement:list-batches', (_event, { companyId }: { companyId: string }) => {
    try {
      const rows = db
        .getDb()
        .prepare(
          `SELECT b.*, emp.name AS employee_name FROM reimbursement_batches b
         LEFT JOIN employees emp ON emp.id=b.employee_id WHERE b.company_id=? ORDER BY b.created_at DESC`,
        )
        .all(companyId);
      return { batches: rows };
    } catch (err: any) {
      return { batches: [], error: err?.message };
    }
  });

  ipcMain.handle('reimbursement:batch-detail', (_event, { batchId }: { batchId: string }) => {
    try {
      const dbi = db.getDb();
      const batch = dbi
        .prepare(
          `SELECT b.*, emp.name AS employee_name, emp.email AS employee_email,
        emp.routing_number, emp.account_number, emp.account_type FROM reimbursement_batches b
        LEFT JOIN employees emp ON emp.id=b.employee_id WHERE b.id=?`,
        )
        .get(batchId);
      const expenses = dbi
        .prepare(
          `SELECT e.*, v.name AS vendor_name, c.name AS category_name FROM expenses e
        LEFT JOIN vendors v ON v.id=e.vendor_id LEFT JOIN categories c ON c.id=e.category_id
        WHERE e.reimbursement_batch_id=? ORDER BY e.date ASC`,
        )
        .all(batchId);
      return { batch, expenses };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // Feature 15: ACH-ready CSV (NACHA format too verbose — using simplified CSV stub)
  ipcMain.handle('reimbursement:ach-export', async (_event, { batchId }: { batchId: string }) => {
    try {
      const dbi = db.getDb();
      const batch = dbi
        .prepare(
          `SELECT b.*, emp.name AS employee_name, emp.routing_number, emp.account_number, emp.account_type, c.name AS company_name
        FROM reimbursement_batches b
        LEFT JOIN employees emp ON emp.id=b.employee_id
        LEFT JOIN companies c ON c.id=b.company_id WHERE b.id=?`,
        )
        .get(batchId) as any;
      if (!batch) return { error: 'Batch not found' };
      const lines: string[] = [];
      lines.push(
        'record_type,company,employee,routing,account,account_type,amount,effective_date,batch_id',
      );
      lines.push(
        `HEADER,"${batch.company_name || ''}","${batch.employee_name || ''}","${batch.routing_number || ''}","${batch.account_number || ''}","${batch.account_type || ''}",${Number(batch.total_amount).toFixed(2)},${batch.paid_date || localToday()},${batch.id}`,
      );
      lines.push(
        `ENTRY,,"${batch.employee_name || ''}","${batch.routing_number || ''}","${batch.account_number || ''}","${batch.account_type || ''}",${Number(batch.total_amount).toFixed(2)},,${batch.id}`,
      );
      const result = await dialog.showSaveDialog({
        title: 'Export ACH-ready CSV',
        defaultPath: `reimbursement-${batch.id}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });
      if (result.canceled || !result.filePath) return { cancelled: true };
      fs.writeFileSync(result.filePath, lines.join('\n'), 'utf-8');
      return { path: result.filePath };
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  // ─── B13: Tax deduction finder ─────────────────────────
  ipcMain.handle('tax:deduction-scan', (_event, opts?: { year?: number }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return null;
      const { scanDeductions } = require('../../services/tax-deduction-finder');
      return scanDeductions(cid, opts?.year);
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  // ─── B5: PDF/image receipt OCR + parsing ───────────────
  // Two flows:
  //   1. ocr:scan-receipt-file  — caller already has a path
  //   2. ocr:scan-receipt-pick  — opens a file dialog first
  // tesseract.js workers are ~50MB resident — lazy-loaded on first
  // call; shutdown on app quit (see main.ts).
  ipcMain.handle('ocr:scan-receipt-file', async (_event, { filePath }: { filePath: string }) => {
    try {
      const { scanReceipt } = require('../../services/receipt-ocr');
      const parsed = await scanReceipt(filePath);
      return { ok: true, parsed };
    } catch (err: any) {
      console.error('[ocr] scan failed:', err);
      return { ok: false, error: err?.message || 'OCR failed' };
    }
  });
  ipcMain.handle('ocr:scan-receipt-pick', async () => {
    try {
      const { filePaths, canceled } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'Receipts', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (canceled || !filePaths?.[0]) return { cancelled: true };
      const { scanReceipt } = require('../../services/receipt-ocr');
      const parsed = await scanReceipt(filePaths[0]);
      return { ok: true, parsed, filePath: filePaths[0] };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'OCR failed' };
    }
  });
  // ─── Bills / Accounts Payable ─────────────────────────────

  ipcMain.handle('bills:next-number', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return 'BILL-1001';
    const dbInstance = db.getDb();
    const row = dbInstance
      .prepare(
        `
      SELECT bill_number FROM bills WHERE company_id = ?
      ORDER BY created_at DESC LIMIT 1
    `,
      )
      .get(companyId) as any;
    if (!row) return 'BILL-1001';
    const match = row.bill_number.match(/(\d+)$/);
    if (!match) return 'BILL-1001';
    const next = parseInt(match[1], 10) + 1;
    const prefix = row.bill_number.replace(/\d+$/, '');
    return `${prefix}${String(next).padStart(4, '0')}`;
  });
  ipcMain.handle(
    'bills:pay',
    (_event, { billId, amount, date, accountId, paymentMethod, reference, notes }: any) => {
      if (!amount || amount <= 0) return { error: 'Amount must be greater than zero' };
      const companyId = db.getCurrentCompanyId();
      if (!companyId) throw new Error('No active company');
      const dbInstance = db.getDb();

      // D3: refuse to record a payment whose date falls in a closed period
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

      const payTx = dbInstance.transaction(() => {
        const paymentId = uuid();
        dbInstance
          .prepare(
            `
        INSERT INTO bill_payments (id, company_id, bill_id, amount, date, payment_method, reference, account_id, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
          )
          .run(
            paymentId,
            companyId,
            billId,
            amount,
            date,
            paymentMethod || 'check',
            reference || '',
            accountId || null,
            notes || '',
          );

        const bill = dbInstance.prepare('SELECT * FROM bills WHERE id = ?').get(billId) as any;
        if (!bill) throw new Error('Bill not found');

        // INTEGRITY: roundCents prevents float drift across multiple partial pays.
        const newAmountPaid = db.roundCents((bill.amount_paid || 0) + Number(amount));
        let newStatus = bill.status;
        if (newAmountPaid >= db.roundCents(bill.total)) {
          newStatus = 'paid';
        } else if (newAmountPaid > 0) {
          newStatus = 'partial';
        }

        dbInstance
          .prepare(
            `UPDATE bills SET amount_paid = ?, status = ?, updated_at = datetime('now') WHERE id = ?`,
          )
          .run(newAmountPaid, newStatus, billId);

        postJournalEntry(
          dbInstance,
          companyId,
          date,
          `Bill payment - ${bill.bill_number || billId}`,
          [
            {
              nameHint: 'Payable',
              debit: amount,
              credit: 0,
              note: `AP cleared for bill ${bill.bill_number || billId}`,
            },
            {
              nameHint: 'Cash',
              debit: 0,
              credit: amount,
              note: `Cash paid for bill ${bill.bill_number || billId}`,
            },
          ],
        );

        return { paymentId, newStatus, newAmountPaid };
      });

      const result = payTx();
      // (bill_payment ↔ bill) bidirectional with payment metadata for the timeline.
      try {
        recordRelationBidirectional(
          companyId,
          'bill_payment',
          result.paymentId,
          'bill',
          billId,
          'paid',
          { amount, date, payment_method: paymentMethod || 'check', reference: reference || '' },
        );
      } catch (err) {
        console.warn('bills:pay recordRelation failed:', (err as Error)?.message);
      }
      scheduleAutoBackup();
      // Reactive engine: emit bill.paid for workflows.
      try {
        if (companyId && billId) {
          eventBus
            .emit({
              type: result.newStatus === 'paid' ? 'bill.paid' : 'bill.updated',
              companyId,
              entityType: 'bill',
              entityId: billId,
              data: {
                payment_id: result.paymentId,
                amount,
                date,
                payment_method: paymentMethod || 'check',
                new_status: result.newStatus,
                amount_paid: result.newAmountPaid,
              },
            })
            .catch(() => {});
        }
      } catch {
        /* fire-and-forget */
      }
      return result;
    },
  );
  ipcMain.handle('bills:stats', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { total_unpaid: 0, overdue: 0, due_soon: 0, paid_this_month: 0 };
    const dbInstance = db.getDb();

    const row = dbInstance
      .prepare(
        `
      SELECT
        COALESCE(SUM(CASE WHEN status NOT IN ('paid','void','draft') THEN total - amount_paid ELSE 0 END), 0) as total_unpaid,
        COALESCE(SUM(CASE WHEN due_date < date('now') AND status NOT IN ('paid','void','draft') THEN total - amount_paid ELSE 0 END), 0) as overdue,
        COALESCE(SUM(CASE WHEN due_date BETWEEN date('now') AND date('now', '+7 days') AND status NOT IN ('paid','void','draft') THEN total - amount_paid ELSE 0 END), 0) as due_soon,
        COALESCE(SUM(CASE WHEN status = 'paid' AND strftime('%Y-%m', updated_at) = strftime('%Y-%m', 'now') THEN amount_paid ELSE 0 END), 0) as paid_this_month
      FROM bills WHERE company_id = ?
    `,
      )
      .get(companyId);
    return row;
  });
  ipcMain.handle('bills:overdue-check', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return 0;
    const dbInstance = db.getDb();
    const result = dbInstance
      .prepare(
        `
      UPDATE bills SET status = 'overdue', updated_at = datetime('now')
      WHERE company_id = ? AND status IN ('pending','received','approved','partial')
        AND due_date < date('now')
    `,
      )
      .run(companyId);
    if (result.changes > 0) scheduleAutoBackup();
    return result.changes;
  });
  // ─── Purchase Orders ──────────────────────────────────────

  ipcMain.handle('po:next-number', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return 'PO-1001';
    const dbInstance = db.getDb();
    const row = dbInstance
      .prepare(
        `SELECT po_number FROM purchase_orders WHERE company_id = ? ORDER BY created_at DESC LIMIT 1`,
      )
      .get(companyId) as any;
    if (!row) return 'PO-1001';
    const match = row.po_number.match(/(\d+)$/);
    if (!match) return 'PO-1001';
    const next = parseInt(match[1], 10) + 1;
    return `PO-${String(next).padStart(4, '0')}`;
  });
  ipcMain.handle(
    'po:approve',
    (_event, { poId, approvedBy }: { poId: string; approvedBy?: string }) => {
      const dbInstance = db.getDb();
      dbInstance
        .prepare(
          `UPDATE purchase_orders SET status = 'approved', approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
        )
        .run(approvedBy || '', poId);
      scheduleAutoBackup();
      return { success: true };
    },
  );
  ipcMain.handle('po:convert-bill', (_event, { poId }: { poId: string }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) throw new Error('No active company');
    const dbInstance = db.getDb();

    const convertTx = dbInstance.transaction(() => {
      const po = dbInstance.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(poId) as any;
      if (!po) throw new Error('PO not found');

      const poItems = dbInstance
        .prepare('SELECT * FROM po_line_items WHERE po_id = ?')
        .all(poId) as any[];

      // Generate bill number
      const row = dbInstance
        .prepare(
          `SELECT bill_number FROM bills WHERE company_id = ? ORDER BY created_at DESC LIMIT 1`,
        )
        .get(companyId) as any;
      let billNumber = 'BILL-1001';
      if (row) {
        const match = row.bill_number.match(/(\d+)$/);
        if (match) billNumber = `BILL-${String(parseInt(match[1], 10) + 1).padStart(4, '0')}`;
      }

      const billId = uuid();
      // Carry the PO's tax_amount onto the bill — omitting it left the bill's
      // subtotal+tax out of sync with its (tax-inclusive) total and undercounted
      // any tax reporting that reads bills.tax_amount.
      dbInstance
        .prepare(
          `
        INSERT INTO bills (id, company_id, vendor_id, bill_number, status, issue_date, due_date, subtotal, tax_amount, total, notes, reference)
        VALUES (?, ?, ?, ?, 'received', date('now'), date('now', '+30 days'), ?, ?, ?, ?, ?)
      `,
        )
        .run(
          billId,
          companyId,
          po.vendor_id,
          billNumber,
          po.subtotal || 0,
          po.tax_amount || 0,
          po.total || 0,
          po.notes || '',
          `PO: ${po.po_number}`,
        );

      for (const item of poItems) {
        dbInstance
          .prepare(
            `
          INSERT INTO bill_line_items (id, bill_id, description, quantity, unit_price, amount, account_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
          )
          .run(
            uuid(),
            billId,
            item.description,
            item.quantity,
            item.unit_price,
            item.amount,
            item.account_id,
          );
      }

      dbInstance
        .prepare(
          `UPDATE purchase_orders SET status = 'received', updated_at = datetime('now') WHERE id = ?`,
        )
        .run(poId);

      return { billId, billNumber };
    });

    const result = convertTx();
    // (bill ↔ purchase_order) bidirectional, relation: 'fulfills'
    try {
      recordRelationBidirectional(
        companyId,
        'bill',
        result.billId,
        'purchase_order',
        poId,
        'fulfills',
        { converted_at: new Date().toISOString(), bill_number: result.billNumber },
      );
    } catch (err) {
      console.warn('po:convert-bill recordRelation failed:', (err as Error)?.message);
    }
    scheduleAutoBackup();
    return result;
  });
  ipcMain.handle(
    'approval:list',
    (_event, { company_id, status }: { company_id: string; status?: string }) => {
      let sql = `SELECT aq.*, r.category FROM approval_queue aq LEFT JOIN rules r ON aq.rule_id = r.id WHERE aq.company_id = ?`;
      const params: unknown[] = [company_id];
      if (status) {
        sql += ` AND aq.status = ?`;
        params.push(status);
      }
      sql += ` ORDER BY aq.created_at DESC`;
      return db
        .getDb()
        .prepare(sql)
        .all(...params);
    },
  );
  ipcMain.handle(
    'approval:resolve',
    (
      _event,
      { id, status, notes }: { id: string; status: 'approved' | 'rejected'; notes?: string },
    ) => {
      try {
        db.getDb()
          .prepare(
            `UPDATE approval_queue SET status = ?, notes = ?, resolved_at = datetime('now') WHERE id = ?`,
          )
          .run(status, notes ?? null, id);
        scheduleAutoBackup();
        return { ok: true };
      } catch (err: any) {
        return { error: err?.message || 'Failed to resolve approval' };
      }
    },
  );
  ipcMain.handle('approval:pending-count', (_event, company_id: string) => {
    const row = db
      .getDb()
      .prepare(
        `SELECT COUNT(*) as count FROM approval_queue WHERE company_id = ? AND status = 'pending'`,
      )
      .get(company_id) as { count: number };
    return row.count;
  });
}
