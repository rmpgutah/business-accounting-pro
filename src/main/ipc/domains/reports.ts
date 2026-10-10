import type { IpcMain } from 'electron';
import * as db from '../../database';
import type { IpcDeps } from '../core/types';

export function registerReportsIpc(ipcMain: IpcMain, _deps: IpcDeps): void {
  // ─── Reporting & Dashboards Wave (F741-F840) — 100 handlers under `rpt:*` ──
  const rpd = () => require('../../services/reporting-dashboards-features');
  // Batch RA: Custom Report Builder
  ipcMain.handle('rpt:def:create', (_e, p: any) => rpd().createReportDefinition(p));
  ipcMain.handle('rpt:def:list', (_e, f?: any) => rpd().listReportDefinitions(f || {}));
  ipcMain.handle('rpt:def:update', (_e, { id, patch }: any) =>
    rpd().updateReportDefinition(id, patch),
  );
  ipcMain.handle('rpt:def:delete', (_e, { id }: any) => rpd().deleteReportDefinition(id));
  ipcMain.handle('rpt:run', (_e, { report_id, params }: any) =>
    rpd().runReport(report_id, params || {}),
  );
  ipcMain.handle('rpt:run:rows', (_e, { run_id, offset, limit }: any) =>
    rpd().getReportRunRows(run_id, offset || 0, limit || 100),
  );
  ipcMain.handle('rpt:run:list', (_e, { report_id, limit }: any) =>
    rpd().listReportRuns(report_id, limit || 20),
  );
  ipcMain.handle('rpt:def:clone', (_e, { source_id, new_name }: any) =>
    rpd().cloneReportDefinition(source_id, new_name),
  );
  ipcMain.handle('rpt:sql:validate', (_e, { sql_template, params }: any) =>
    rpd().validateReportSql(sql_template, params || {}),
  );
  ipcMain.handle('rpt:source:columns', (_e, { source_table }: any) =>
    rpd().getSourceColumns(source_table),
  );
  // Batch RB: Saved Views
  ipcMain.handle('rpt:view:save', (_e, p: any) => rpd().saveReportView(p));
  ipcMain.handle('rpt:view:list', (_e, { report_id, user_id }: any) =>
    rpd().listSavedViews(report_id, user_id),
  );
  ipcMain.handle('rpt:view:update', (_e, { id, patch }: any) => rpd().updateSavedView(id, patch));
  ipcMain.handle('rpt:view:delete', (_e, { id }: any) => rpd().deleteSavedView(id));
  ipcMain.handle('rpt:view:set-default', (_e, { id }: any) => rpd().setDefaultView(id));
  ipcMain.handle('rpt:view:run', (_e, { id }: any) => rpd().runWithSavedView(id));
  ipcMain.handle('rpt:narrative:create', (_e, p: any) => rpd().createNarrativeTemplate(p));
  ipcMain.handle('rpt:narrative:list', (_e, { type }: any = {}) =>
    rpd().listNarrativeTemplates(type),
  );
  ipcMain.handle('rpt:narrative:render', (_e, { id, vars }: any) =>
    rpd().renderNarrative(id, vars || {}),
  );
  ipcMain.handle('rpt:view:share', (_e, { id, visibility }: any) =>
    rpd().shareView(id, visibility),
  );
  // Batch RC: Scheduled Reports
  ipcMain.handle('rpt:sched:create', (_e, p: any) => rpd().scheduleReport(p));
  ipcMain.handle('rpt:sched:list', (_e, f?: any) => rpd().listScheduledReports(f || {}));
  ipcMain.handle('rpt:sched:run-now', (_e, { id }: any) => rpd().runScheduledReportNow(id));
  ipcMain.handle('rpt:sched:pause', (_e, { id, active }: any) =>
    rpd().pauseScheduledReport(id, active),
  );
  ipcMain.handle('rpt:sched:update-cadence', (_e, { id, cron, preset, next_run_at }: any) =>
    rpd().updateScheduleCadence(id, cron, preset, next_run_at),
  );
  ipcMain.handle('rpt:sched:history', (_e, { id, limit }: any) =>
    rpd().scheduledReportHistory(id, limit || 20),
  );
  ipcMain.handle('rpt:sched:compute-next', (_e, { preset, from_date }: any) =>
    rpd().computeNextRun(preset, from_date),
  );
  ipcMain.handle('rpt:sched:add-recipients', (_e, { id, recipients }: any) =>
    rpd().addReportRecipients(id, recipients || []),
  );
  ipcMain.handle('rpt:sched:remove-recipients', (_e, { id, recipients }: any) =>
    rpd().removeReportRecipients(id, recipients || []),
  );
  ipcMain.handle('rpt:sched:delete', (_e, { id }: any) => rpd().deleteScheduledReport(id));
  // Batch RD: KPI Widgets
  ipcMain.handle('rpt:kpi:create', (_e, p: any) => rpd().createKpiDefinition(p));
  ipcMain.handle('rpt:kpi:snapshot', (_e, p: any) => rpd().recordKpiSnapshot(p));
  ipcMain.handle('rpt:kpi:current', (_e, { key }: any) => rpd().getKpiCurrent(key));
  ipcMain.handle('rpt:kpi:series', (_e, { key, opts }: any) =>
    rpd().getKpiTimeSeries(key, opts || {}),
  );
  ipcMain.handle('rpt:kpi:delta', (_e, { key, days }: any) => rpd().kpiDelta(key, days || 30));
  ipcMain.handle('rpt:kpi:recalc-builtin', () => rpd().recalculateBuiltInKpis());
  ipcMain.handle('rpt:kpi:set-target', (_e, { key, target }: any) =>
    rpd().setKpiTarget(key, target),
  );
  ipcMain.handle('rpt:kpi:rollup', () => rpd().kpiDashboardRollup());
  ipcMain.handle('rpt:kpi:delete', (_e, { key }: any) => rpd().deleteKpi(key));
  ipcMain.handle('rpt:kpi:prune', (_e, { days }: any) => rpd().pruneKpiSnapshots(days || 365));
  // Batch RE: Drill-down & Filters
  ipcMain.handle('rpt:drill:record', (_e, p: any) => rpd().recordDrill(p));
  ipcMain.handle('rpt:drill:into', (_e, { table, id }: any) => rpd().drillIntoEntity(table, id));
  ipcMain.handle('rpt:rows:filter', (_e, { rows, filters }: any) =>
    rpd().applyFiltersToRows(rows || [], filters || []),
  );
  ipcMain.handle('rpt:rows:group', (_e, { rows, group_by }: any) =>
    rpd().groupResultRows(rows || [], group_by),
  );
  ipcMain.handle('rpt:rows:sort', (_e, { rows, sort_by, direction }: any) =>
    rpd().sortRows(rows || [], sort_by, direction || 'asc'),
  );
  ipcMain.handle('rpt:rows:aggregate', (_e, { rows, column, op }: any) =>
    rpd().aggregateColumn(rows || [], column, op || 'sum'),
  );
  ipcMain.handle('rpt:drill:user-history', (_e, { user_id, limit }: any) =>
    rpd().userDrillHistory(user_id, limit || 50),
  );
  ipcMain.handle('rpt:drill:top-entities', (_e, { table, days }: any) =>
    rpd().topDrilledEntities(table, days || 30),
  );
  ipcMain.handle('rpt:col-meta:set', (_e, p: any) => rpd().setColumnMetadata(p));
  ipcMain.handle('rpt:filter:presets', () => rpd().getDateFilterPresets());
  // Batch RF: Financial Statements
  ipcMain.handle('rpt:pl', (_e, { start, end }: any) => rpd().generateProfitAndLoss(start, end));
  ipcMain.handle('rpt:bs', (_e, { as_of }: any) => rpd().generateBalanceSheet(as_of));
  ipcMain.handle('rpt:cf', (_e, { start, end }: any) => rpd().generateCashFlow(start, end));
  ipcMain.handle('rpt:tb', (_e, { as_of }: any) => rpd().generateTrialBalance(as_of));
  ipcMain.handle('rpt:ar-aging', () => rpd().generateArAging());
  ipcMain.handle('rpt:ap-aging', () => rpd().generateApAging());
  ipcMain.handle('rpt:cash-position', () => rpd().cashPositionSummary());
  ipcMain.handle('rpt:profit-margin-trend', (_e, { months }: any) =>
    rpd().profitMarginTrend(months || 12),
  );
  ipcMain.handle('rpt:working-capital', () => rpd().workingCapital());
  ipcMain.handle('rpt:gl-detail', (_e, { account_id, start, end }: any) =>
    rpd().glDetailByAccount(account_id, start, end),
  );
  // Batch RG: Variance
  ipcMain.handle('rpt:variance:actual-vs-budget', (_e, { start, end }: any) =>
    rpd().actualVsBudget(start, end),
  );
  ipcMain.handle('rpt:variance:pop', (_e, { start_a, end_a, start_b, end_b }: any) =>
    rpd().periodOverPeriod(start_a, end_a, start_b, end_b),
  );
  ipcMain.handle('rpt:variance:yoy', (_e, { year }: any) => rpd().yearOverYear(year));
  ipcMain.handle('rpt:variance:qoq', (_e, { year, quarter }: any) =>
    rpd().quarterOverQuarter(year, quarter),
  );
  ipcMain.handle('rpt:variance:cohort', (_e, { start, end }: any) =>
    rpd().buildCohortReport(start, end),
  );
  ipcMain.handle('rpt:top:contributors', (_e, { metric, start, end, limit }: any) =>
    rpd().topContributors(metric, start, end, limit || 10),
  );
  ipcMain.handle('rpt:period-comp:save', (_e, p: any) => rpd().savePeriodComparison(p));
  ipcMain.handle('rpt:variance:list', (_e, { limit }: any = {}) =>
    rpd().listVarianceAnalyses(limit || 20),
  );
  ipcMain.handle('rpt:variance:over-budget', (_e, { threshold_pct, start, end }: any) =>
    rpd().overBudgetAccounts(threshold_pct, start, end),
  );
  ipcMain.handle('rpt:monthly-summary-card', (_e, { month }: any = {}) =>
    rpd().monthlySummaryCard(month),
  );
  // Batch RH: Dashboards
  ipcMain.handle('rpt:dash:create', (_e, p: any) => rpd().createDashboard(p));
  ipcMain.handle('rpt:dash:add-widget', (_e, p: any) => rpd().addWidget(p));
  ipcMain.handle('rpt:dash:move-widget', (_e, { id, x, y, width, height }: any) =>
    rpd().moveWidget(id, x, y, width, height),
  );
  ipcMain.handle('rpt:dash:load', (_e, { id }: any) => rpd().loadDashboard(id));
  ipcMain.handle('rpt:dash:list', (_e, { user_id }: any = {}) => rpd().listDashboards(user_id));
  ipcMain.handle('rpt:dash:delete', (_e, { id }: any) => rpd().deleteDashboard(id));
  ipcMain.handle('rpt:dash:save-version', (_e, { id, saved_by, note }: any) =>
    rpd().saveDashboardVersion(id, saved_by, note),
  );
  ipcMain.handle('rpt:dash:restore-version', (_e, { id }: any) =>
    rpd().restoreDashboardVersion(id),
  );
  ipcMain.handle('rpt:dash:share', (_e, p: any) => rpd().shareDashboard(p));
  ipcMain.handle('rpt:dash:remove-widget', (_e, { id }: any) => rpd().removeWidget(id));
  // Batch RI: Executive Summary & Annotations
  ipcMain.handle('rpt:exec:generate', (_e, { start, end }: any) =>
    rpd().generateExecutiveSummary(start, end),
  );
  ipcMain.handle('rpt:exec:update', (_e, { id, patch }: any) =>
    rpd().updateExecutiveSummary(id, patch),
  );
  ipcMain.handle('rpt:exec:list', (_e, { limit }: any = {}) =>
    rpd().listExecutiveSummaries(limit || 20),
  );
  ipcMain.handle('rpt:exec:get', (_e, { id }: any) => rpd().getExecutiveSummary(id));
  ipcMain.handle('rpt:exec:auto-monthly', (_e, { month }: any = {}) =>
    rpd().autoGenerateMonthlySummary(month),
  );
  ipcMain.handle('rpt:annot:add', (_e, p: any) => rpd().addAnnotation(p));
  ipcMain.handle('rpt:annot:list', (_e, p: any) => rpd().listAnnotations(p || {}));
  ipcMain.handle('rpt:annot:delete', (_e, { id }: any) => rpd().deleteAnnotation(id));
  ipcMain.handle('rpt:alert:create', (_e, p: any) => rpd().createReportAlert(p));
  ipcMain.handle('rpt:alert:evaluate', () => rpd().evaluateAlerts());
  // Batch RJ: Export & Sharing
  ipcMain.handle('rpt:export:csv', (_e, { run_id }: any) => rpd().exportRunToCsv(run_id));
  ipcMain.handle('rpt:export:html', (_e, { run_id, title }: any) =>
    rpd().exportRunToHtml(run_id, title),
  );
  ipcMain.handle('rpt:pin:set', (_e, { key, value, ttl }: any) =>
    rpd().pinSnapshot(key, () => value, ttl || 3600),
  );
  ipcMain.handle('rpt:pin:get', (_e, { key }: any) => rpd().getPinnedSnapshot(key));
  ipcMain.handle('rpt:fav:pin', (_e, p: any) => rpd().pinFavorite(p));
  ipcMain.handle('rpt:fav:list', (_e, { user_id }: any) => rpd().listFavorites(user_id));
  ipcMain.handle('rpt:sub:create', (_e, p: any) => rpd().subscribeToReport(p));
  ipcMain.handle('rpt:audit:log', (_e, p: any) => rpd().logReportAuditEvent(p));
  ipcMain.handle('rpt:audit:get', (_e, f?: any) => rpd().getReportAuditLog(f || {}));
  ipcMain.handle('rpt:perf-card', (_e, { report_id }: any) =>
    rpd().reportPerformanceCard(report_id),
  );

  // ═══════════════════════════════════════════════════════════
  // ENTERPRISE FEATURES v2.0
  // ═══════════════════════════════════════════════════════════

  // ─── Financial Reports ────────────────────────────────────

  ipcMain.handle(
    'reports:profit-loss',
    (_event, { startDate, endDate }: { startDate: string; endDate: string }) => {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return null;
      const dbInstance = db.getDb();

      // Revenue accounts
      const revenue = dbInstance
        .prepare(
          `
      SELECT a.id, a.code, a.name, a.subtype,
        COALESCE(SUM(jel.credit - jel.debit), 0) as net_amount
      FROM accounts a
      LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
      LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
        AND je.company_id = ? AND je.is_posted = 1
        AND date(je.date) >= date(?) AND date(je.date) <= date(?) -- DATE: Item #7 — date() wrap so timestamp values match and end-day is inclusive.
      WHERE a.company_id = ? AND a.type = 'revenue' AND a.is_active = 1
      GROUP BY a.id ORDER BY a.code
    `,
        )
        .all(companyId, startDate, endDate, companyId) as any[];

      // COGS accounts (expense subtype = cogs)
      const cogs = dbInstance
        .prepare(
          `
      SELECT a.id, a.code, a.name, a.subtype,
        COALESCE(SUM(jel.debit - jel.credit), 0) as net_amount
      FROM accounts a
      LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
      LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
        AND je.company_id = ? AND je.is_posted = 1
        AND date(je.date) >= date(?) AND date(je.date) <= date(?) -- DATE: Item #7 — date() wrap so timestamp values match and end-day is inclusive.
      WHERE a.company_id = ? AND a.type = 'expense'
        AND (a.subtype LIKE '%cogs%' OR a.subtype LIKE '%cost_of%')
        AND a.is_active = 1
      GROUP BY a.id ORDER BY a.code
    `,
        )
        .all(companyId, startDate, endDate, companyId) as any[];

      // Operating expense accounts
      const expenses = dbInstance
        .prepare(
          `
      SELECT a.id, a.code, a.name, a.subtype,
        COALESCE(SUM(jel.debit - jel.credit), 0) as net_amount
      FROM accounts a
      LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
      LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
        AND je.company_id = ? AND je.is_posted = 1
        AND date(je.date) >= date(?) AND date(je.date) <= date(?) -- DATE: Item #7 — date() wrap so timestamp values match and end-day is inclusive.
      WHERE a.company_id = ? AND a.type = 'expense'
        AND a.subtype NOT LIKE '%cogs%' AND a.subtype NOT LIKE '%cost_of%'
        AND a.is_active = 1
      GROUP BY a.id ORDER BY a.code
    `,
        )
        .all(companyId, startDate, endDate, companyId) as any[];

      // Also pull from invoices/expenses tables (cash-basis supplement)
      const cashRevenue = dbInstance
        .prepare(
          `
      SELECT COALESCE(SUM(amount_paid), 0) as total
      FROM invoices WHERE company_id = ? AND status IN ('paid','partial')
        AND issue_date >= ? AND issue_date <= ?
    `,
        )
        .get(companyId, startDate, endDate) as any;

      const cashExpenses = dbInstance
        .prepare(
          `
      SELECT COALESCE(SUM(amount), 0) as total
      FROM expenses WHERE company_id = ? AND date >= ? AND date <= ?
    `,
        )
        .get(companyId, startDate, endDate) as any;

      const totalRevenue = revenue.reduce((s: number, r: any) => s + (r.net_amount || 0), 0);
      const totalCogs = cogs.reduce((s: number, r: any) => s + (r.net_amount || 0), 0);
      const totalExpenses = expenses.reduce((s: number, r: any) => s + (r.net_amount || 0), 0);
      const grossProfit = totalRevenue - totalCogs;
      const operatingIncome = grossProfit - totalExpenses;

      return {
        startDate,
        endDate,
        revenue,
        cogs,
        expenses,
        totalRevenue,
        totalCogs,
        grossProfit,
        totalExpenses,
        operatingIncome,
        netIncome: operatingIncome,
        // Cash-basis supplements (used when GL has no posted entries)
        cashRevenue: cashRevenue?.total || 0,
        cashExpenses: cashExpenses?.total || 0,
      };
    },
  );

  ipcMain.handle('reports:balance-sheet', (_event, { asOfDate }: { asOfDate: string }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    const dbInstance = db.getDb();

    const getAccountBalances = (type: string) =>
      dbInstance
        .prepare(
          `
      SELECT a.id, a.code, a.name, a.subtype, a.parent_id,
        COALESCE(a.balance, 0) +
        COALESCE((
          SELECT SUM(jel.debit - jel.credit)
          FROM journal_entry_lines jel
          JOIN journal_entries je ON je.id = jel.journal_entry_id
          WHERE jel.account_id = a.id AND je.company_id = ? AND je.is_posted = 1 AND date(je.date) <= date(?) /* DATE: Item #7 — wrap for inclusive end-of-day */
        ), 0) as balance
      FROM accounts a
      WHERE a.company_id = ? AND a.type = ? AND a.is_active = 1
      ORDER BY a.code
    `,
        )
        .all(companyId, asOfDate, companyId, type) as any[];

    const assets = getAccountBalances('asset');
    const liabilities = getAccountBalances('liability');
    const equity = getAccountBalances('equity');

    // Retained earnings = cumulative net income
    const retainedEarnings = dbInstance
      .prepare(
        `
      SELECT
        COALESCE(SUM(CASE WHEN a.type = 'revenue' THEN jel.credit - jel.debit ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN a.type = 'expense' THEN jel.debit - jel.credit ELSE 0 END), 0) as retained
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.journal_entry_id
      JOIN accounts a ON a.id = jel.account_id
      WHERE je.company_id = ? AND je.is_posted = 1 AND date(je.date) <= date(?) /* DATE: Item #7 — wrap for inclusive end-of-day */
    `,
      )
      .get(companyId, asOfDate) as any;

    const totalAssets = assets.reduce((s: number, a: any) => s + (a.balance || 0), 0);
    const totalLiabilities = liabilities.reduce(
      (s: number, a: any) => s + Math.abs(a.balance || 0),
      0,
    );
    const totalEquity = equity.reduce((s: number, a: any) => s + Math.abs(a.balance || 0), 0);
    const retained = retainedEarnings?.retained || 0;

    return {
      asOfDate,
      assets,
      liabilities,
      equity,
      totalAssets,
      totalLiabilities,
      totalEquity,
      retainedEarnings: retained,
      totalLiabilitiesAndEquity: totalLiabilities + totalEquity + retained,
    };
  });

  ipcMain.handle(
    'reports:trial-balance',
    (_event, { startDate, endDate }: { startDate: string; endDate: string }) => {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return null;
      const dbInstance = db.getDb();

      const rows = dbInstance
        .prepare(
          `
      SELECT
        a.code, a.name, a.type, a.subtype,
        COALESCE(SUM(CASE WHEN date(je.date) >= date(?) /* DATE: Item #7 — wrap for inclusive start-of-day */ THEN jel.debit ELSE 0 END), 0) as period_debit,
        COALESCE(SUM(CASE WHEN date(je.date) >= date(?) /* DATE: Item #7 — wrap for inclusive start-of-day */ THEN jel.credit ELSE 0 END), 0) as period_credit,
        COALESCE(SUM(jel.debit), 0) as total_debit,
        COALESCE(SUM(jel.credit), 0) as total_credit,
        COALESCE(a.balance, 0) as opening_balance
      FROM accounts a
      LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
      LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
        AND je.company_id = ? AND je.is_posted = 1 AND date(je.date) <= date(?) /* DATE: Item #7 — wrap for inclusive end-of-day */
      WHERE a.company_id = ? AND a.is_active = 1
      GROUP BY a.id
      HAVING total_debit > 0 OR total_credit > 0 OR opening_balance != 0
      ORDER BY a.type, a.code
    `,
        )
        .all(startDate, startDate, companyId, endDate, companyId) as any[];

      const totalDebits = rows.reduce((s: number, r: any) => s + (r.period_debit || 0), 0);
      const totalCredits = rows.reduce((s: number, r: any) => s + (r.period_credit || 0), 0);

      return {
        startDate,
        endDate,
        rows,
        totalDebits,
        totalCredits,
        isBalanced: Math.abs(totalDebits - totalCredits) < 0.01,
      };
    },
  );

  ipcMain.handle('reports:ar-aging', (_event, { asOfDate }: { asOfDate: string }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    const dbInstance = db.getDb();

    const invoices = dbInstance
      .prepare(
        `
      SELECT i.*, c.name as client_name,
        CAST(julianday(?) - julianday(i.due_date) AS INTEGER) as days_overdue,
        i.total - i.amount_paid as balance_due
      FROM invoices i
      JOIN clients c ON c.id = i.client_id
      WHERE i.company_id = ? AND i.status IN ('sent','partial','overdue')
        AND i.issue_date <= ? AND (i.total - i.amount_paid) > 0
      ORDER BY i.due_date ASC
    `,
      )
      .all(asOfDate, companyId, asOfDate) as any[];

    const buckets = {
      current: [] as any[],
      days1_30: [] as any[],
      days31_60: [] as any[],
      days61_90: [] as any[],
      over90: [] as any[],
    };

    let totalCurrent = 0,
      total1_30 = 0,
      total31_60 = 0,
      total61_90 = 0,
      totalOver90 = 0;

    for (const inv of invoices) {
      const days = inv.days_overdue || 0;
      const bal = inv.balance_due || 0;
      if (days <= 0) {
        buckets.current.push(inv);
        totalCurrent += bal;
      } else if (days <= 30) {
        buckets.days1_30.push(inv);
        total1_30 += bal;
      } else if (days <= 60) {
        buckets.days31_60.push(inv);
        total31_60 += bal;
      } else if (days <= 90) {
        buckets.days61_90.push(inv);
        total61_90 += bal;
      } else {
        buckets.over90.push(inv);
        totalOver90 += bal;
      }
    }

    return {
      asOfDate,
      buckets,
      totals: {
        current: totalCurrent,
        days1_30: total1_30,
        days31_60: total31_60,
        days61_90: total61_90,
        over90: totalOver90,
      },
      grandTotal: totalCurrent + total1_30 + total31_60 + total61_90 + totalOver90,
    };
  });

  ipcMain.handle('reports:ap-aging', (_event, { asOfDate }: { asOfDate: string }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    const dbInstance = db.getDb();

    const bills = dbInstance
      .prepare(
        `
      SELECT b.*, v.name as vendor_name,
        CAST(julianday(?) - julianday(b.due_date) AS INTEGER) as days_overdue,
        b.total - b.amount_paid as balance_due
      FROM bills b
      LEFT JOIN vendors v ON v.id = b.vendor_id
      WHERE b.company_id = ? AND b.status IN ('received','approved','partial','overdue')
        AND (b.total - b.amount_paid) > 0
      ORDER BY b.due_date ASC
    `,
      )
      .all(asOfDate, companyId) as any[];

    const buckets = {
      current: [] as any[],
      days1_30: [] as any[],
      days31_60: [] as any[],
      days61_90: [] as any[],
      over90: [] as any[],
    };
    let totalCurrent = 0,
      total1_30 = 0,
      total31_60 = 0,
      total61_90 = 0,
      totalOver90 = 0;

    for (const bill of bills) {
      const days = bill.days_overdue || 0;
      const bal = bill.balance_due || 0;
      if (days <= 0) {
        buckets.current.push(bill);
        totalCurrent += bal;
      } else if (days <= 30) {
        buckets.days1_30.push(bill);
        total1_30 += bal;
      } else if (days <= 60) {
        buckets.days31_60.push(bill);
        total31_60 += bal;
      } else if (days <= 90) {
        buckets.days61_90.push(bill);
        total61_90 += bal;
      } else {
        buckets.over90.push(bill);
        totalOver90 += bal;
      }
    }

    return {
      asOfDate,
      buckets,
      totals: {
        current: totalCurrent,
        days1_30: total1_30,
        days31_60: total31_60,
        days61_90: total61_90,
        over90: totalOver90,
      },
      grandTotal: totalCurrent + total1_30 + total31_60 + total61_90 + totalOver90,
    };
  });

  ipcMain.handle(
    'reports:general-ledger',
    (
      _event,
      { startDate, endDate, accountId }: { startDate: string; endDate: string; accountId?: string },
    ) => {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return null;
      const dbInstance = db.getDb();

      let sql = `
      SELECT
        a.code as account_code, a.name as account_name, a.type as account_type,
        je.date, je.entry_number, je.description as entry_description, je.reference,
        jel.description as line_description, jel.debit, jel.credit,
        jel.account_id
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.journal_entry_id
      JOIN accounts a ON a.id = jel.account_id
      WHERE je.company_id = ? AND je.is_posted = 1
        -- DATE: Item #7 — date() wrap on both sides so end-of-period is inclusive.
        AND date(je.date) >= date(?) AND date(je.date) <= date(?)
    `;
      const params: any[] = [companyId, startDate, endDate];

      if (accountId) {
        sql += ' AND jel.account_id = ?';
        params.push(accountId);
      }
      sql += ' ORDER BY a.code, je.date, je.entry_number';

      const lines = dbInstance.prepare(sql).all(...params) as any[];

      // Group by account
      const byAccount: Record<
        string,
        {
          account_code: string;
          account_name: string;
          account_type: string;
          lines: any[];
          totalDebit: number;
          totalCredit: number;
          netBalance: number;
        }
      > = {};
      for (const line of lines) {
        const key = line.account_id;
        if (!byAccount[key]) {
          byAccount[key] = {
            account_code: line.account_code,
            account_name: line.account_name,
            account_type: line.account_type,
            lines: [],
            totalDebit: 0,
            totalCredit: 0,
            netBalance: 0,
          };
        }
        byAccount[key].lines.push(line);
        byAccount[key].totalDebit += line.debit || 0;
        byAccount[key].totalCredit += line.credit || 0;
        byAccount[key].netBalance = byAccount[key].totalDebit - byAccount[key].totalCredit;
      }

      return { startDate, endDate, accounts: Object.values(byAccount) };
    },
  );

  ipcMain.handle(
    'reports:vendor-spend',
    (_event, { startDate, endDate }: { startDate: string; endDate: string }) => {
      try {
        const companyId = db.getCurrentCompanyId();
        if (!companyId) return [];
        return db
          .getDb()
          .prepare(
            `
        SELECT v.id, v.name as vendor_name,
          COUNT(e.id) as transaction_count,
          COALESCE(SUM(e.amount), 0) as total_spend,
          COALESCE(AVG(e.amount), 0) as avg_transaction,
          MIN(e.date) as first_transaction,
          MAX(e.date) as last_transaction
        FROM vendors v
        -- DATE: Item #6 — date() wraps both column and parameters so a stored
        -- timestamp ('2026-04-15 14:30:00') still matches a date-only filter,
        -- and end-of-period bounds are inclusive of the full day.
        LEFT JOIN expenses e ON e.vendor_id = v.id AND e.company_id = ? AND date(e.date) BETWEEN date(?) AND date(?)
        WHERE v.company_id = ?
        GROUP BY v.id, v.name
        HAVING total_spend > 0
        ORDER BY total_spend DESC
      `,
          )
          .all(companyId, startDate, endDate, companyId);
      } catch {
        return [];
      }
    },
  );

  // ─── P4.37: Customer Profitability Ranking ──────────────
  // Per-client revenue (paid invoice amounts in window) minus
  // direct costs (expenses tagged to that client_id) =
  // estimated profit. Sorted descending. Used to identify
  // "which clients are actually making us money."
  ipcMain.handle(
    'reports:customer-profitability',
    (
      _event,
      { startDate, endDate, limit }: { startDate: string; endDate: string; limit?: number },
    ) => {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return null;
      const dbInstance = db.getDb();

      const clients = dbInstance
        .prepare(
          `
      SELECT c.id, c.name, c.email,
        COALESCE(SUM(CASE WHEN i.issue_date BETWEEN ? AND ? THEN i.amount_paid ELSE 0 END), 0) AS revenue,
        COALESCE(SUM(CASE WHEN i.issue_date BETWEEN ? AND ? THEN (i.total - i.amount_paid) ELSE 0 END), 0) AS unpaid,
        COUNT(CASE WHEN i.issue_date BETWEEN ? AND ? THEN i.id END) AS invoice_count
      FROM clients c
      LEFT JOIN invoices i ON i.client_id = c.id AND i.company_id = c.company_id
      WHERE c.company_id = ?
        AND COALESCE(c.deleted_at, '') = ''
      GROUP BY c.id, c.name, c.email
    `,
        )
        .all(startDate, endDate, startDate, endDate, startDate, endDate, companyId) as any[];

      // Pull expenses-by-client from the expenses table. Some tenants
      // tag client_id directly; others put it in custom fields.
      const clientExpenses = dbInstance
        .prepare(
          `
      SELECT client_id, COALESCE(SUM(amount), 0) AS expense_total
      FROM expenses
      WHERE company_id = ?
        AND date BETWEEN ? AND ?
        AND COALESCE(deleted_at, '') = ''
        AND client_id IS NOT NULL
      GROUP BY client_id
    `,
        )
        .all(companyId, startDate, endDate) as any[];

      const expenseMap = new Map<string, number>();
      for (const e of clientExpenses) expenseMap.set(e.client_id, Number(e.expense_total) || 0);

      const ranked = clients
        .map((c) => {
          const revenue = Number(c.revenue) || 0;
          const expenses = expenseMap.get(c.id) || 0;
          const profit = revenue - expenses;
          const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
          return {
            client_id: c.id,
            client_name: c.name,
            client_email: c.email,
            invoice_count: c.invoice_count || 0,
            revenue,
            expenses,
            profit,
            margin_pct: Math.round(margin * 10) / 10,
            unpaid: Number(c.unpaid) || 0,
          };
        })
        .filter((r) => r.invoice_count > 0 || r.expenses > 0)
        .sort((a, b) => b.profit - a.profit);

      const cap = Math.max(1, limit || 50);
      const top = ranked.slice(0, cap);

      const totals = {
        revenue: ranked.reduce((s, r) => s + r.revenue, 0),
        expenses: ranked.reduce((s, r) => s + r.expenses, 0),
        profit: ranked.reduce((s, r) => s + r.profit, 0),
        unpaid: ranked.reduce((s, r) => s + r.unpaid, 0),
        client_count: ranked.length,
      };

      return { startDate, endDate, ranked: top, totals };
    },
  );

  // ─── P4.35: Cash Flow FORECAST (forward-looking) ────────
  // Existing reports:cash-flow is historical. This forecasts the
  // next N days using:
  //   • Open invoices' (total - amount_paid) as inflows on due_date
  //   • Open bills'    (total - amount_paid) as outflows on due_date
  //   • Recurring invoice/bill templates within the window
  //   • Optional: scheduled payroll runs as outflows
  // Returns daily projections + running balance starting from the
  // current bank-account aggregate.
  ipcMain.handle('reports:cash-flow-forecast', (_event, { days }: { days?: number }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    const dbInstance = db.getDb();
    const horizon = Math.max(1, Math.min(365, days || 90));

    // Starting bank balance: sum of asset accounts of type='asset' subtype='bank'.
    // Falls back to all asset accounts' balances if none flagged.
    let startingBalance = 0;
    try {
      const row = dbInstance
        .prepare(
          `
        SELECT COALESCE(SUM(balance), 0) AS bal
        FROM accounts
        WHERE company_id = ? AND type = 'asset'
          AND COALESCE(deleted_at, '') = ''
      `,
        )
        .get(companyId) as any;
      startingBalance = Number(row?.bal) || 0;
    } catch {
      /* skip */
    }

    const today = new Date().toISOString().slice(0, 10);
    const horizonDate = new Date(Date.now() + horizon * 86_400_000).toISOString().slice(0, 10);

    // Inflows: open invoices due in the horizon
    const inflows = dbInstance
      .prepare(
        `
      SELECT due_date AS date, (total - amount_paid) AS amount, invoice_number AS reference, 'invoice' AS source
      FROM invoices
      WHERE company_id = ?
        AND status NOT IN ('paid', 'voided', 'cancelled')
        AND due_date BETWEEN ? AND ?
        AND (total - amount_paid) > 0
        AND COALESCE(deleted_at, '') = ''
    `,
      )
      .all(companyId, today, horizonDate) as any[];

    // Outflows: open bills due in the horizon
    const outflows = dbInstance
      .prepare(
        `
      SELECT due_date AS date, (total - amount_paid) AS amount, bill_number AS reference, 'bill' AS source
      FROM bills
      WHERE company_id = ?
        AND status NOT IN ('paid', 'voided', 'cancelled')
        AND due_date BETWEEN ? AND ?
        AND (total - amount_paid) > 0
        AND COALESCE(deleted_at, '') = ''
    `,
      )
      .all(companyId, today, horizonDate) as any[];

    // Scheduled loan payments due in the horizon (P3.25 loan
    // tracking integration). These are firm scheduled outflows
    // even though they don't have a bill record.
    let loanOutflows: any[] = [];
    try {
      loanOutflows = dbInstance
        .prepare(
          `
        SELECT s.due_date AS date,
               (s.scheduled_payment + COALESCE(s.escrow_amount, 0)) AS amount,
               l.name AS reference,
               'loan' AS source
        FROM loan_payment_schedule s
        JOIN loans l ON l.id = s.loan_id
        WHERE l.company_id = ?
          AND l.status = 'active'
          AND COALESCE(l.deleted_at, '') = ''
          AND s.paid_status != 'paid'
          AND s.due_date BETWEEN ? AND ?
      `,
        )
        .all(companyId, today, horizonDate) as any[];
    } catch {
      // Loan tables may not exist in pre-migration DBs
    }
    outflows.push(...loanOutflows);

    // Build daily projection: inflow/outflow per day + running balance.
    const dayMap = new Map<string, { inflow: number; outflow: number; entries: any[] }>();
    for (let i = 0; i <= horizon; i++) {
      const d = new Date(Date.now() + i * 86_400_000).toISOString().slice(0, 10);
      dayMap.set(d, { inflow: 0, outflow: 0, entries: [] });
    }
    for (const inv of inflows) {
      const day = dayMap.get(inv.date);
      if (day) {
        day.inflow += Number(inv.amount) || 0;
        day.entries.push({ ...inv, type: 'inflow' });
      }
    }
    for (const bill of outflows) {
      const day = dayMap.get(bill.date);
      if (day) {
        day.outflow += Number(bill.amount) || 0;
        day.entries.push({ ...bill, type: 'outflow' });
      }
    }

    const projection: Array<{
      date: string;
      inflow: number;
      outflow: number;
      net: number;
      balance: number;
      entries: any[];
    }> = [];
    let running = startingBalance;
    for (const [date, info] of dayMap) {
      const net = info.inflow - info.outflow;
      running += net;
      projection.push({ date, ...info, net, balance: running });
    }
    projection.sort((a, b) => a.date.localeCompare(b.date));

    const totals = {
      inflow: projection.reduce((s, p) => s + p.inflow, 0),
      outflow: projection.reduce((s, p) => s + p.outflow, 0),
      net: projection.reduce((s, p) => s + p.net, 0),
      startingBalance,
      endingBalance: running,
    };

    // Find the lowest projected balance — the "danger day"
    let lowest = projection[0];
    for (const p of projection) if (p.balance < lowest.balance) lowest = p;

    return {
      horizon,
      startDate: today,
      endDate: horizonDate,
      projection,
      totals,
      lowestBalance: { date: lowest.date, balance: lowest.balance },
    };
  });

  ipcMain.handle(
    'reports:cash-flow',
    (_event, { startDate, endDate }: { startDate: string; endDate: string }) => {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return null;
      const dbInstance = db.getDb();

      // Operating: cash received from customers
      const cashFromCustomers = dbInstance
        .prepare(
          `
      SELECT COALESCE(SUM(amount), 0) as total FROM payments
      WHERE company_id = ? AND date >= ? AND date <= ?
    `,
        )
        .get(companyId, startDate, endDate) as any;

      // Operating: cash paid to vendors (expenses)
      const cashToVendors = dbInstance
        .prepare(
          `
      SELECT COALESCE(SUM(amount), 0) as total FROM expenses
      WHERE company_id = ? AND date >= ? AND date <= ? AND status IN ('paid','approved')
    `,
        )
        .get(companyId, startDate, endDate) as any;

      // Operating: cash paid for bills
      const cashToBills = dbInstance
        .prepare(
          `
      SELECT COALESCE(SUM(amount), 0) as total FROM bill_payments
      WHERE company_id = ? AND date >= ? AND date <= ?
    `,
        )
        .get(companyId, startDate, endDate) as any;

      // Investing: asset purchases
      const assetPurchases = dbInstance
        .prepare(
          `
      SELECT COALESCE(SUM(purchase_price), 0) as total FROM fixed_assets
      WHERE company_id = ? AND purchase_date >= ? AND purchase_date <= ?
    `,
        )
        .get(companyId, startDate, endDate) as any;

      // Investing: asset disposals
      const assetDisposals = dbInstance
        .prepare(
          `
      SELECT COALESCE(SUM(disposal_amount), 0) as total FROM fixed_assets
      WHERE company_id = ? AND disposal_date >= ? AND disposal_date <= ? AND status = 'disposed'
    `,
        )
        .get(companyId, startDate, endDate) as any;

      const operatingInflows = cashFromCustomers?.total || 0;
      const operatingOutflows = (cashToVendors?.total || 0) + (cashToBills?.total || 0);
      const netOperating = operatingInflows - operatingOutflows;

      const investingInflows = assetDisposals?.total || 0;
      const investingOutflows = assetPurchases?.total || 0;
      const netInvesting = investingInflows - investingOutflows;

      // Financing: loan proceeds (credits to liability accounts = cash in)
      const loanProceeds = dbInstance
        .prepare(
          `
      SELECT COALESCE(SUM(jel.credit), 0) as total
      FROM journal_entry_lines jel
      JOIN journal_entries je ON jel.journal_entry_id = je.id
      JOIN accounts a ON jel.account_id = a.id
      WHERE je.company_id = ? AND date(je.date) >= date(?) AND date(je.date) <= date(?) -- DATE: Item #7 — date() wrap so timestamp values match and end-day is inclusive.
        AND a.type IN ('liability') AND a.subtype IN ('long_term_liability','notes_payable','loan')
    `,
        )
        .get(companyId, startDate, endDate) as any;

      // Financing: loan repayments (debits to liability accounts = cash out)
      const loanRepayments = dbInstance
        .prepare(
          `
      SELECT COALESCE(SUM(jel.debit), 0) as total
      FROM journal_entry_lines jel
      JOIN journal_entries je ON jel.journal_entry_id = je.id
      JOIN accounts a ON jel.account_id = a.id
      WHERE je.company_id = ? AND date(je.date) >= date(?) AND date(je.date) <= date(?) -- DATE: Item #7 — date() wrap so timestamp values match and end-day is inclusive.
        AND a.type IN ('liability') AND a.subtype IN ('long_term_liability','notes_payable','loan')
    `,
        )
        .get(companyId, startDate, endDate) as any;

      // Financing: owner contributions (credits to equity = cash in)
      const equityContributions = dbInstance
        .prepare(
          `
      SELECT COALESCE(SUM(jel.credit), 0) as total
      FROM journal_entry_lines jel
      JOIN journal_entries je ON jel.journal_entry_id = je.id
      JOIN accounts a ON jel.account_id = a.id
      WHERE je.company_id = ? AND date(je.date) >= date(?) AND date(je.date) <= date(?) -- DATE: Item #7 — date() wrap so timestamp values match and end-day is inclusive.
        AND a.type = 'equity' AND a.subtype NOT IN ('retained_earnings','net_income')
    `,
        )
        .get(companyId, startDate, endDate) as any;

      // Financing: owner distributions (debits to equity = cash out)
      const equityDistributions = dbInstance
        .prepare(
          `
      SELECT COALESCE(SUM(jel.debit), 0) as total
      FROM journal_entry_lines jel
      JOIN journal_entries je ON jel.journal_entry_id = je.id
      JOIN accounts a ON jel.account_id = a.id
      WHERE je.company_id = ? AND date(je.date) >= date(?) AND date(je.date) <= date(?) -- DATE: Item #7 — date() wrap so timestamp values match and end-day is inclusive.
        AND a.type = 'equity' AND a.subtype NOT IN ('retained_earnings','net_income')
    `,
        )
        .get(companyId, startDate, endDate) as any;

      const financingInflows = (loanProceeds?.total || 0) + (equityContributions?.total || 0);
      const financingOutflows = (loanRepayments?.total || 0) + (equityDistributions?.total || 0);
      const netFinancing = financingInflows - financingOutflows;

      const netChange = netOperating + netInvesting + netFinancing;

      // Opening cash
      const openingCash = dbInstance
        .prepare(
          `
      SELECT COALESCE(SUM(current_balance), 0) as total FROM bank_accounts WHERE company_id = ?
    `,
        )
        .get(companyId) as any;

      return {
        startDate,
        endDate,
        operating: {
          inflows: [{ label: 'Cash received from customers', amount: operatingInflows }],
          outflows: [
            { label: 'Payments to vendors (expenses)', amount: cashToVendors?.total || 0 },
            { label: 'Payments to vendors (bills)', amount: cashToBills?.total || 0 },
          ],
          net: netOperating,
        },
        investing: {
          inflows: [{ label: 'Proceeds from asset disposals', amount: investingInflows }],
          outflows: [{ label: 'Purchase of fixed assets', amount: investingOutflows }],
          net: netInvesting,
        },
        financing: {
          inflows: [
            { label: 'Proceeds from loans / borrowings', amount: loanProceeds?.total || 0 },
            { label: 'Owner / equity contributions', amount: equityContributions?.total || 0 },
          ],
          outflows: [
            { label: 'Loan repayments', amount: loanRepayments?.total || 0 },
            { label: 'Owner distributions / dividends', amount: equityDistributions?.total || 0 },
          ],
          net: netFinancing,
        },
        netChange,
        openingCash: openingCash?.total || 0,
        closingCash: (openingCash?.total || 0) + netChange,
      };
    },
  );

  // ─── Reports: Budget vs Actual ───────────────────────────
  ipcMain.handle('reports:budget-vs-actual', (_event, { budgetId }: { budgetId: string }) => {
    try {
      const dbInstance = db.getDb();
      const budget = dbInstance.prepare('SELECT * FROM budgets WHERE id = ?').get(budgetId) as any;
      if (!budget) return { error: 'Budget not found' };

      const lines = dbInstance
        .prepare('SELECT * FROM budget_lines WHERE budget_id = ? ORDER BY category')
        .all(budgetId) as any[];
      const companyId = budget.company_id;

      // Get actual expenses grouped by category for the budget period
      const actuals = dbInstance
        .prepare(
          `
        SELECT c.name as category, COALESCE(SUM(e.amount), 0) as actual
        FROM expenses e
        LEFT JOIN categories c ON e.category_id = c.id
        -- DATE: Item #6 — date() wrap so end-of-period bounds are inclusive.
        WHERE e.company_id = ? AND date(e.date) BETWEEN date(?) AND date(?)
        GROUP BY c.name
      `,
        )
        .all(companyId, budget.start_date, budget.end_date) as any[];

      const actualMap = new Map(actuals.map((a: any) => [a.category, a.actual]));

      const comparison = lines.map((line: any) => {
        const actual = actualMap.get(line.category) || 0;
        const variance = line.amount - actual;
        const variancePct = line.amount > 0 ? Math.round((variance / line.amount) * 100) : 0;
        return {
          category: line.category,
          budgeted: line.amount,
          actual,
          variance,
          variance_pct: variancePct,
        };
      });

      return { budget, comparison };
    } catch (err: any) {
      return { error: err.message };
    }
  });
  // ─── Dashboard Aggregation ───────────────────────────
  ipcMain.handle('dashboard:stats', (_event, { startDate, endDate }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    const dbInstance = db.getDb();

    // Current period
    const revenue = dbInstance
      .prepare(
        'SELECT COALESCE(SUM(amount_paid), 0) as total FROM invoices WHERE company_id = ? AND issue_date >= ? AND issue_date <= ?',
      )
      .get(companyId, startDate, endDate) as any;

    const expenseTotal = dbInstance
      .prepare(
        'SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE company_id = ? AND date >= ? AND date <= ?',
      )
      .get(companyId, startDate, endDate) as any;

    const outstanding = dbInstance
      .prepare(
        "SELECT COALESCE(SUM(total - amount_paid), 0) as total, COUNT(*) as count FROM invoices WHERE company_id = ? AND status IN ('sent', 'overdue', 'partial')",
      )
      .get(companyId) as any;

    const overdue = dbInstance
      .prepare("SELECT COUNT(*) as count FROM invoices WHERE company_id = ? AND status = 'overdue'")
      .get(companyId) as any;

    // Previous period of same length for change percentages
    const start = new Date(startDate);
    const end = new Date(endDate);
    const periodMs = end.getTime() - start.getTime();
    const prevEnd = new Date(start.getTime() - 1); // day before current start
    const prevStart = new Date(prevEnd.getTime() - periodMs);
    const prevStartStr = prevStart.toISOString().slice(0, 10);
    const prevEndStr = prevEnd.toISOString().slice(0, 10);

    const prevRevenue = dbInstance
      .prepare(
        'SELECT COALESCE(SUM(amount_paid), 0) as total FROM invoices WHERE company_id = ? AND issue_date >= ? AND issue_date <= ?',
      )
      .get(companyId, prevStartStr, prevEndStr) as any;

    const prevExpense = dbInstance
      .prepare(
        'SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE company_id = ? AND date >= ? AND date <= ?',
      )
      .get(companyId, prevStartStr, prevEndStr) as any;

    const curRevenue = revenue?.total || 0;
    const curExpenses = expenseTotal?.total || 0;
    const curNet = curRevenue - curExpenses;
    const prvRevenue = prevRevenue?.total || 0;
    const prvExpenses = prevExpense?.total || 0;
    const prvNet = prvRevenue - prvExpenses;

    const pctChange = (cur: number, prev: number): number => {
      if (prev === 0) return cur > 0 ? 100 : 0;
      return ((cur - prev) / Math.abs(prev)) * 100;
    };

    return {
      revenue: curRevenue,
      revenueChange: pctChange(curRevenue, prvRevenue),
      expenses: curExpenses,
      expensesChange: pctChange(curExpenses, prvExpenses),
      netIncome: curNet,
      netIncomeChange: pctChange(curNet, prvNet),
      outstanding: outstanding?.total || 0,
      outstandingChange: 0,
      outstandingCount: outstanding?.count || 0,
      overdueCount: overdue?.count || 0,
    };
  });
  // ─── Cash Flow Data ──────────────────────────────────
  ipcMain.handle('dashboard:cashflow', (_event, { startDate, endDate }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return [];
    const dbInstance = db.getDb();

    const inflow = dbInstance
      .prepare(
        "SELECT strftime('%Y-%m', issue_date) as month, SUM(amount_paid) as total FROM invoices WHERE company_id = ? AND issue_date >= ? AND issue_date <= ? GROUP BY month ORDER BY month",
      )
      .all(companyId, startDate, endDate) as any[];

    const outflow = dbInstance
      .prepare(
        "SELECT strftime('%Y-%m', date) as month, SUM(amount) as total FROM expenses WHERE company_id = ? AND date >= ? AND date <= ? GROUP BY month ORDER BY month",
      )
      .all(companyId, startDate, endDate) as any[];

    const months = new Set([
      ...inflow.map((r: any) => r.month),
      ...outflow.map((r: any) => r.month),
    ]);
    const sorted = Array.from(months).sort();

    return sorted.map((month) => ({
      month,
      income: inflow.find((r: any) => r.month === month)?.total || 0,
      expenses: outflow.find((r: any) => r.month === month)?.total || 0,
    }));
  });
  // ─── Enhanced Dashboard Activity ─────────────────────
  ipcMain.handle('dashboard:activity', (_event, opts?: { entityType?: string; limit?: number }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return [];
    const dbInstance = db.getDb();

    let sql = `
      SELECT al.*,
        CASE
          WHEN al.entity_type = 'invoices' THEN (
            SELECT json_object('invoice_number', i.invoice_number, 'total', i.total, 'client_name', c.name)
            FROM invoices i LEFT JOIN clients c ON i.client_id = c.id WHERE i.id = al.entity_id
          )
          WHEN al.entity_type = 'expenses' THEN (
            SELECT json_object('description', e.description, 'amount', e.amount, 'vendor_name', v.name)
            FROM expenses e LEFT JOIN vendors v ON e.vendor_id = v.id WHERE e.id = al.entity_id
          )
          WHEN al.entity_type = 'clients' THEN (
            SELECT json_object('name', cl.name, 'email', cl.email)
            FROM clients cl WHERE cl.id = al.entity_id
          )
          WHEN al.entity_type = 'payments' THEN (
            SELECT json_object('amount', p.amount, 'invoice_number', i.invoice_number)
            FROM payments p LEFT JOIN invoices i ON p.invoice_id = i.id WHERE p.id = al.entity_id
          )
          ELSE NULL
        END as entity_details
      FROM audit_log al
      WHERE al.company_id = ?
    `;
    const params: any[] = [companyId];

    if (opts?.entityType && opts.entityType !== 'all') {
      sql += ' AND al.entity_type = ?';
      params.push(opts.entityType);
    }

    sql += ' ORDER BY al.timestamp DESC LIMIT ?';
    params.push(opts?.limit || 15);

    return dbInstance.prepare(sql).all(...params);
  });
  // ─── Project Profitability ───────────────────────────────
  ipcMain.handle('project:profitability', (_event, { projectId }: { projectId: string }) => {
    const dbI = db.getDb();

    // Revenue = sum of line item amounts on invoices linked to this project
    // (invoices don't have project_id; the link is via invoice_line_items.project_id)
    const revenue = dbI
      .prepare(
        `
      SELECT COALESCE(SUM(ili.amount), 0) as total
      FROM invoice_line_items ili
      JOIN invoices i ON i.id = ili.invoice_id
      WHERE ili.project_id = ?
        AND i.status IN ('sent', 'paid', 'partial')
    `,
      )
      .get(projectId) as any;
    const costs = dbI
      .prepare('SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE project_id = ?')
      .get(projectId) as any;
    const timeCost = dbI
      .prepare(
        `
      SELECT COALESCE(SUM(te.duration_minutes / 60.0 * COALESCE(e.pay_rate, 0)), 0) as total
      FROM time_entries te LEFT JOIN employees e ON te.employee_id = e.id
      WHERE te.project_id = ?
    `,
      )
      .get(projectId) as any;
    const hours = dbI
      .prepare(
        'SELECT COALESCE(SUM(duration_minutes), 0) as total FROM time_entries WHERE project_id = ?',
      )
      .get(projectId) as any;
    const project = dbI.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as any;

    const totalRevenue = revenue?.total || 0;
    const totalCosts = (costs?.total || 0) + (timeCost?.total || 0);
    const profit = totalRevenue - totalCosts;
    const margin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0;

    return {
      revenue: totalRevenue,
      direct_costs: costs?.total || 0,
      labor_costs: timeCost?.total || 0,
      total_costs: totalCosts,
      profit,
      margin: Math.round(margin * 10) / 10,
      total_hours: Math.round(((hours?.total || 0) / 60) * 10) / 10,
      effective_rate:
        hours?.total > 0 ? Math.round((totalRevenue / ((hours.total || 1) / 60)) * 100) / 100 : 0,
      budget: project?.budget || 0,
      budget_used_pct:
        project?.budget > 0 ? Math.round((totalCosts / project.budget) * 1000) / 10 : 0,
    };
  });
  // ─── Analytics Dashboard ──────────────────────────────
  ipcMain.handle('analytics:dashboard-data', (_event, { companyId }: { companyId: string }) => {
    try {
      const d = db.getDb();
      const today = new Date();
      const months = Array.from({ length: 12 }, (_, i) => {
        const dt = new Date(today.getFullYear(), today.getMonth() - 11 + i, 1);
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      });
      const firstMonth = months[0] + '-01';

      const revenueByMonth = d
        .prepare(
          `
        SELECT strftime('%Y-%m', issue_date) as month, COALESCE(SUM(total),0) as total
        FROM invoices WHERE company_id = ? AND status IN ('paid','sent','partial')
        AND issue_date >= ? GROUP BY month`,
        )
        .all(companyId, firstMonth);

      const expenseByMonth = d
        .prepare(
          `
        SELECT strftime('%Y-%m', date) as month, COALESCE(SUM(amount),0) as total
        FROM expenses WHERE company_id = ? AND date >= ? GROUP BY month`,
        )
        .all(companyId, firstMonth);

      const arAging = d
        .prepare(
          `
        SELECT
          SUM(CASE WHEN julianday('now') - julianday(due_date) <= 0 THEN total - amount_paid ELSE 0 END) as current_amt,
          SUM(CASE WHEN julianday('now') - julianday(due_date) BETWEEN 1 AND 30 THEN total - amount_paid ELSE 0 END) as days_1_30,
          SUM(CASE WHEN julianday('now') - julianday(due_date) BETWEEN 31 AND 60 THEN total - amount_paid ELSE 0 END) as days_31_60,
          SUM(CASE WHEN julianday('now') - julianday(due_date) > 60 THEN total - amount_paid ELSE 0 END) as days_60_plus
        FROM invoices WHERE company_id = ? AND status IN ('sent','overdue','partial')`,
        )
        .get(companyId);

      const topClients = d
        .prepare(
          `
        SELECT c.name as client_name, COALESCE(SUM(i.total),0) as total_revenue
        FROM invoices i JOIN clients c ON i.client_id = c.id
        WHERE i.company_id = ? AND i.status IN ('paid','sent','partial')
        GROUP BY c.id ORDER BY total_revenue DESC LIMIT 8`,
        )
        .all(companyId);

      const totalInvoiced = d
        .prepare(
          `SELECT COALESCE(SUM(total),0) as v FROM invoices WHERE company_id = ? AND status != 'draft'`,
        )
        .get(companyId) as any;
      const totalPaid = d
        .prepare(
          `SELECT COALESCE(SUM(total),0) as v FROM invoices WHERE company_id = ? AND status = 'paid'`,
        )
        .get(companyId) as any;
      const totalExpenses = d
        .prepare(`SELECT COALESCE(SUM(amount),0) as v FROM expenses WHERE company_id = ?`)
        .get(companyId) as any;
      const overdueCount = d
        .prepare(`SELECT COUNT(*) as v FROM invoices WHERE company_id = ? AND status = 'overdue'`)
        .get(companyId) as any;
      const sentCount = d
        .prepare(
          `SELECT COUNT(*) as v FROM invoices WHERE company_id = ? AND status IN ('sent','overdue','partial')`,
        )
        .get(companyId) as any;
      const avgDso = d
        .prepare(
          `
        SELECT AVG(julianday(updated_at) - julianday(issue_date)) as v
        FROM invoices WHERE company_id = ? AND status = 'paid' AND updated_at IS NOT NULL`,
        )
        .get(companyId) as any;

      const collectionRate = totalInvoiced.v > 0 ? totalPaid.v / totalInvoiced.v : 1;
      const expenseRatio = totalInvoiced.v > 0 ? totalExpenses.v / totalInvoiced.v : 0;
      const overdueRate = sentCount.v > 0 ? 1 - overdueCount.v / sentCount.v : 1;
      const dso = Number(avgDso.v || 0);
      const dsoScore = dso <= 30 ? 20 : dso <= 45 ? 15 : dso <= 60 ? 10 : 5;
      const healthScore = Math.round(
        Math.min(collectionRate, 1) * 30 +
          Math.max(0, Math.min(1 - expenseRatio, 1)) * 25 +
          Math.min(overdueRate, 1) * 25 +
          dsoScore,
      );

      return { months, revenueByMonth, expenseByMonth, arAging, topClients, healthScore, dso };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
}
