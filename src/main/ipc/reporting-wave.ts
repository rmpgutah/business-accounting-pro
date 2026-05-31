// src/main/ipc/reporting-wave.ts
//
// Reporting & Dashboards Wave (F741-F840) — 100 thin `rpt:*` IPC handlers that
// delegate to services/reporting-dashboards-features. Extracted from the
// ipc/index.ts monolith and registered via registerReportingWaveIpc(ipcMain).

import { IpcMain } from 'electron';

export function registerReportingWaveIpc(ipcMain: IpcMain): void {
  // ─── Reporting & Dashboards Wave (F741-F840) — 100 handlers under `rpt:*` ──
  const rpd = () => require('../services/reporting-dashboards-features');
  // Batch RA: Custom Report Builder
  ipcMain.handle('rpt:def:create', (_e, p: any) => rpd().createReportDefinition(p));
  ipcMain.handle('rpt:def:list', (_e, f?: any) => rpd().listReportDefinitions(f || {}));
  ipcMain.handle('rpt:def:update', (_e, { id, patch }: any) => rpd().updateReportDefinition(id, patch));
  ipcMain.handle('rpt:def:delete', (_e, { id }: any) => rpd().deleteReportDefinition(id));
  ipcMain.handle('rpt:run', (_e, { report_id, params }: any) => rpd().runReport(report_id, params || {}));
  ipcMain.handle('rpt:run:rows', (_e, { run_id, offset, limit }: any) => rpd().getReportRunRows(run_id, offset || 0, limit || 100));
  ipcMain.handle('rpt:run:list', (_e, { report_id, limit }: any) => rpd().listReportRuns(report_id, limit || 20));
  ipcMain.handle('rpt:def:clone', (_e, { source_id, new_name }: any) => rpd().cloneReportDefinition(source_id, new_name));
  ipcMain.handle('rpt:sql:validate', (_e, { sql_template, params }: any) => rpd().validateReportSql(sql_template, params || {}));
  ipcMain.handle('rpt:source:columns', (_e, { source_table }: any) => rpd().getSourceColumns(source_table));
  // Batch RB: Saved Views
  ipcMain.handle('rpt:view:save', (_e, p: any) => rpd().saveReportView(p));
  ipcMain.handle('rpt:view:list', (_e, { report_id, user_id }: any) => rpd().listSavedViews(report_id, user_id));
  ipcMain.handle('rpt:view:update', (_e, { id, patch }: any) => rpd().updateSavedView(id, patch));
  ipcMain.handle('rpt:view:delete', (_e, { id }: any) => rpd().deleteSavedView(id));
  ipcMain.handle('rpt:view:set-default', (_e, { id }: any) => rpd().setDefaultView(id));
  ipcMain.handle('rpt:view:run', (_e, { id }: any) => rpd().runWithSavedView(id));
  ipcMain.handle('rpt:narrative:create', (_e, p: any) => rpd().createNarrativeTemplate(p));
  ipcMain.handle('rpt:narrative:list', (_e, { type }: any = {}) => rpd().listNarrativeTemplates(type));
  ipcMain.handle('rpt:narrative:render', (_e, { id, vars }: any) => rpd().renderNarrative(id, vars || {}));
  ipcMain.handle('rpt:view:share', (_e, { id, visibility }: any) => rpd().shareView(id, visibility));
  // Batch RC: Scheduled Reports
  ipcMain.handle('rpt:sched:create', (_e, p: any) => rpd().scheduleReport(p));
  ipcMain.handle('rpt:sched:list', (_e, f?: any) => rpd().listScheduledReports(f || {}));
  ipcMain.handle('rpt:sched:run-now', (_e, { id }: any) => rpd().runScheduledReportNow(id));
  ipcMain.handle('rpt:sched:pause', (_e, { id, active }: any) => rpd().pauseScheduledReport(id, active));
  ipcMain.handle('rpt:sched:update-cadence', (_e, { id, cron, preset, next_run_at }: any) => rpd().updateScheduleCadence(id, cron, preset, next_run_at));
  ipcMain.handle('rpt:sched:history', (_e, { id, limit }: any) => rpd().scheduledReportHistory(id, limit || 20));
  ipcMain.handle('rpt:sched:compute-next', (_e, { preset, from_date }: any) => rpd().computeNextRun(preset, from_date));
  ipcMain.handle('rpt:sched:add-recipients', (_e, { id, recipients }: any) => rpd().addReportRecipients(id, recipients || []));
  ipcMain.handle('rpt:sched:remove-recipients', (_e, { id, recipients }: any) => rpd().removeReportRecipients(id, recipients || []));
  ipcMain.handle('rpt:sched:delete', (_e, { id }: any) => rpd().deleteScheduledReport(id));
  // Batch RD: KPI Widgets
  ipcMain.handle('rpt:kpi:create', (_e, p: any) => rpd().createKpiDefinition(p));
  ipcMain.handle('rpt:kpi:snapshot', (_e, p: any) => rpd().recordKpiSnapshot(p));
  ipcMain.handle('rpt:kpi:current', (_e, { key }: any) => rpd().getKpiCurrent(key));
  ipcMain.handle('rpt:kpi:series', (_e, { key, opts }: any) => rpd().getKpiTimeSeries(key, opts || {}));
  ipcMain.handle('rpt:kpi:delta', (_e, { key, days }: any) => rpd().kpiDelta(key, days || 30));
  ipcMain.handle('rpt:kpi:recalc-builtin', () => rpd().recalculateBuiltInKpis());
  ipcMain.handle('rpt:kpi:set-target', (_e, { key, target }: any) => rpd().setKpiTarget(key, target));
  ipcMain.handle('rpt:kpi:rollup', () => rpd().kpiDashboardRollup());
  ipcMain.handle('rpt:kpi:delete', (_e, { key }: any) => rpd().deleteKpi(key));
  ipcMain.handle('rpt:kpi:prune', (_e, { days }: any) => rpd().pruneKpiSnapshots(days || 365));
  // Batch RE: Drill-down & Filters
  ipcMain.handle('rpt:drill:record', (_e, p: any) => rpd().recordDrill(p));
  ipcMain.handle('rpt:drill:into', (_e, { table, id }: any) => rpd().drillIntoEntity(table, id));
  ipcMain.handle('rpt:rows:filter', (_e, { rows, filters }: any) => rpd().applyFiltersToRows(rows || [], filters || []));
  ipcMain.handle('rpt:rows:group', (_e, { rows, group_by }: any) => rpd().groupResultRows(rows || [], group_by));
  ipcMain.handle('rpt:rows:sort', (_e, { rows, sort_by, direction }: any) => rpd().sortRows(rows || [], sort_by, direction || 'asc'));
  ipcMain.handle('rpt:rows:aggregate', (_e, { rows, column, op }: any) => rpd().aggregateColumn(rows || [], column, op || 'sum'));
  ipcMain.handle('rpt:drill:user-history', (_e, { user_id, limit }: any) => rpd().userDrillHistory(user_id, limit || 50));
  ipcMain.handle('rpt:drill:top-entities', (_e, { table, days }: any) => rpd().topDrilledEntities(table, days || 30));
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
  ipcMain.handle('rpt:profit-margin-trend', (_e, { months }: any) => rpd().profitMarginTrend(months || 12));
  ipcMain.handle('rpt:working-capital', () => rpd().workingCapital());
  ipcMain.handle('rpt:gl-detail', (_e, { account_id, start, end }: any) => rpd().glDetailByAccount(account_id, start, end));
  // Batch RG: Variance
  ipcMain.handle('rpt:variance:actual-vs-budget', (_e, { start, end }: any) => rpd().actualVsBudget(start, end));
  ipcMain.handle('rpt:variance:pop', (_e, { start_a, end_a, start_b, end_b }: any) => rpd().periodOverPeriod(start_a, end_a, start_b, end_b));
  ipcMain.handle('rpt:variance:yoy', (_e, { year }: any) => rpd().yearOverYear(year));
  ipcMain.handle('rpt:variance:qoq', (_e, { year, quarter }: any) => rpd().quarterOverQuarter(year, quarter));
  ipcMain.handle('rpt:variance:cohort', (_e, { start, end }: any) => rpd().buildCohortReport(start, end));
  ipcMain.handle('rpt:top:contributors', (_e, { metric, start, end, limit }: any) => rpd().topContributors(metric, start, end, limit || 10));
  ipcMain.handle('rpt:period-comp:save', (_e, p: any) => rpd().savePeriodComparison(p));
  ipcMain.handle('rpt:variance:list', (_e, { limit }: any = {}) => rpd().listVarianceAnalyses(limit || 20));
  ipcMain.handle('rpt:variance:over-budget', (_e, { threshold_pct, start, end }: any) => rpd().overBudgetAccounts(threshold_pct, start, end));
  ipcMain.handle('rpt:monthly-summary-card', (_e, { month }: any = {}) => rpd().monthlySummaryCard(month));
  // Batch RH: Dashboards
  ipcMain.handle('rpt:dash:create', (_e, p: any) => rpd().createDashboard(p));
  ipcMain.handle('rpt:dash:add-widget', (_e, p: any) => rpd().addWidget(p));
  ipcMain.handle('rpt:dash:move-widget', (_e, { id, x, y, width, height }: any) => rpd().moveWidget(id, x, y, width, height));
  ipcMain.handle('rpt:dash:load', (_e, { id }: any) => rpd().loadDashboard(id));
  ipcMain.handle('rpt:dash:list', (_e, { user_id }: any = {}) => rpd().listDashboards(user_id));
  ipcMain.handle('rpt:dash:delete', (_e, { id }: any) => rpd().deleteDashboard(id));
  ipcMain.handle('rpt:dash:save-version', (_e, { id, saved_by, note }: any) => rpd().saveDashboardVersion(id, saved_by, note));
  ipcMain.handle('rpt:dash:restore-version', (_e, { id }: any) => rpd().restoreDashboardVersion(id));
  ipcMain.handle('rpt:dash:share', (_e, p: any) => rpd().shareDashboard(p));
  ipcMain.handle('rpt:dash:remove-widget', (_e, { id }: any) => rpd().removeWidget(id));
  // Batch RI: Executive Summary & Annotations
  ipcMain.handle('rpt:exec:generate', (_e, { start, end }: any) => rpd().generateExecutiveSummary(start, end));
  ipcMain.handle('rpt:exec:update', (_e, { id, patch }: any) => rpd().updateExecutiveSummary(id, patch));
  ipcMain.handle('rpt:exec:list', (_e, { limit }: any = {}) => rpd().listExecutiveSummaries(limit || 20));
  ipcMain.handle('rpt:exec:get', (_e, { id }: any) => rpd().getExecutiveSummary(id));
  ipcMain.handle('rpt:exec:auto-monthly', (_e, { month }: any = {}) => rpd().autoGenerateMonthlySummary(month));
  ipcMain.handle('rpt:annot:add', (_e, p: any) => rpd().addAnnotation(p));
  ipcMain.handle('rpt:annot:list', (_e, p: any) => rpd().listAnnotations(p || {}));
  ipcMain.handle('rpt:annot:delete', (_e, { id }: any) => rpd().deleteAnnotation(id));
  ipcMain.handle('rpt:alert:create', (_e, p: any) => rpd().createReportAlert(p));
  ipcMain.handle('rpt:alert:evaluate', () => rpd().evaluateAlerts());
  // Batch RJ: Export & Sharing
  ipcMain.handle('rpt:export:csv', (_e, { run_id }: any) => rpd().exportRunToCsv(run_id));
  ipcMain.handle('rpt:export:html', (_e, { run_id, title }: any) => rpd().exportRunToHtml(run_id, title));
  ipcMain.handle('rpt:pin:set', (_e, { key, value, ttl }: any) => rpd().pinSnapshot(key, () => value, ttl || 3600));
  ipcMain.handle('rpt:pin:get', (_e, { key }: any) => rpd().getPinnedSnapshot(key));
  ipcMain.handle('rpt:fav:pin', (_e, p: any) => rpd().pinFavorite(p));
  ipcMain.handle('rpt:fav:list', (_e, { user_id }: any) => rpd().listFavorites(user_id));
  ipcMain.handle('rpt:sub:create', (_e, p: any) => rpd().subscribeToReport(p));
  ipcMain.handle('rpt:audit:log', (_e, p: any) => rpd().logReportAuditEvent(p));
  ipcMain.handle('rpt:audit:get', (_e, f?: any) => rpd().getReportAuditLog(f || {}));
  ipcMain.handle('rpt:perf-card', (_e, { report_id }: any) => rpd().reportPerformanceCard(report_id));

}
