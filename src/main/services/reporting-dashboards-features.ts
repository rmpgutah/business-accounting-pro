// ─── Reporting & Dashboards Wave: F741-F840 (100 features) ───
//
// Batch RA: Custom Report Builder          (F741-F750)
// Batch RB: Saved Views & Templates        (F751-F760)
// Batch RC: Scheduled Reports & Email      (F761-F770)
// Batch RD: KPI Widgets & Metrics          (F771-F780)
// Batch RE: Drill-down & Filters           (F781-F790)
// Batch RF: Financial Statement Engines    (F791-F800)
// Batch RG: Variance & Comparison          (F801-F810)
// Batch RH: Dashboard Layouts              (F811-F820)
// Batch RI: Executive Summary & Narrative  (F821-F830)
// Batch RJ: Export, Snapshots & Sharing    (F831-F840)
//
// Design notes:
// 1. `report_definitions` is the SPEC; `report_runs` is the EXECUTION. The
//    split lets users edit a report without losing prior result history.
// 2. SQL templates use {{placeholder}} substitution and a whitelist regex
//    /^[A-Za-z0-9_]+$/ on parameter names to prevent SQL injection (still
//    parameterized at execute time — placeholders only fill in identifiers
//    like column/table names that can't be parameterized).
// 3. KPI snapshots are append-only — never UPDATE a snapshot, INSERT a new
//    one. That gives free time-series for sparklines and trend deltas.
// 4. Every expensive aggregation goes through report_pin_cache with TTL
//    so dashboards stay snappy.

import { randomUUID as uuid } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import * as db from '../database';

const now = (): string => new Date().toISOString();
const today = (): string => now().slice(0, 10);
const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;

function exportsDir(): string {
  try {
    const dir = path.join(app.getPath('userData'), 'report-exports');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch (_) {
    return '/tmp';
  }
}

// SECURITY: SQL identifier whitelist. SQLite can't parameterize column/table
// names, so substitution requires a strict regex. Returns true ONLY for
// "safe" identifiers (alphanumeric + underscore).
function isSafeIdentifier(s: string): boolean {
  return typeof s === 'string' && /^[A-Za-z0-9_]+$/.test(s) && s.length <= 64;
}

function fillTemplate(template: string, vars: Record<string, any>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key) => {
    const v = vars[key];
    if (v === undefined || v === null) return '';
    // Only allow safe identifiers for direct substitution; anything else
    // should be a SQL parameter, not a template fill.
    if (!isSafeIdentifier(String(v))) throw new Error(`Unsafe template var: ${key}`);
    return String(v);
  });
}

// ════════════════════════════════════════════════════════════════════
// Batch RA: Custom Report Builder (F741-F750)
// ════════════════════════════════════════════════════════════════════

// F741: Create a custom report definition
export function createReportDefinition(opts: any) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO report_definitions (id, company_id, name, slug, category, source_table, sql_template, columns_json, filters_json, grouping, sort_by, chart_type, permission_level, owner_user_id, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.name, opts.slug || null, opts.category || 'custom', opts.source_table || null, opts.sql_template || null, JSON.stringify(opts.columns || []), JSON.stringify(opts.filters || []), opts.grouping || null, opts.sort_by || null, opts.chart_type || null, opts.permission_level || 'private', opts.owner_user_id || null, opts.description || null);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F742: List report definitions for current company (+ optional category filter)
export function listReportDefinitions(filter?: { category?: string; permission_level?: string }) {
  try {
    const where: string[] = ['company_id = ?'];
    const params: any[] = [db.getCurrentCompanyId()];
    if (filter?.category) { where.push('category = ?'); params.push(filter.category); }
    if (filter?.permission_level) { where.push('permission_level = ?'); params.push(filter.permission_level); }
    return db.getDb().prepare(`SELECT * FROM report_definitions WHERE ${where.join(' AND ')} ORDER BY name`).all(...params);
  } catch (e: any) { return { error: e.message }; }
}

// F743: Update a report definition
export function updateReportDefinition(id: string, patch: any) {
  try {
    const cols = ['name', 'slug', 'category', 'source_table', 'sql_template', 'grouping', 'sort_by', 'chart_type', 'permission_level', 'description'];
    const sets: string[] = []; const vals: any[] = [];
    for (const c of cols) if (patch[c] !== undefined) { sets.push(`${c} = ?`); vals.push(patch[c]); }
    if (patch.columns !== undefined) { sets.push(`columns_json = ?`); vals.push(JSON.stringify(patch.columns)); }
    if (patch.filters !== undefined) { sets.push(`filters_json = ?`); vals.push(JSON.stringify(patch.filters)); }
    if (sets.length === 0) return { skipped: true };
    sets.push('updated_at = ?'); vals.push(now());
    vals.push(id, db.getCurrentCompanyId());
    db.getDb().prepare(`UPDATE report_definitions SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`).run(...vals);
    return { updated: true };
  } catch (e: any) { return { error: e.message }; }
}

// F744: Delete a report definition (and orphan its runs)
export function deleteReportDefinition(id: string) {
  try {
    db.getDb().prepare(`DELETE FROM report_definitions WHERE id = ? AND company_id = ?`).run(id, db.getCurrentCompanyId());
    return { deleted: true };
  } catch (e: any) { return { error: e.message }; }
}

// F745: Execute a report and store the run (frozen snapshot of result rows)
export function runReport(reportId: string, params?: Record<string, any>) {
  try {
    const def = db.getDb().prepare('SELECT * FROM report_definitions WHERE id = ? AND company_id = ?').get(reportId, db.getCurrentCompanyId()) as any;
    if (!def) return { error: 'Report not found' };
    const start = Date.now();
    const runId = uuid();
    const startedAt = now();
    let rows: any[] = [];
    let status = 'success';
    let errorMessage: string | null = null;

    try {
      if (def.sql_template) {
        const sql = fillTemplate(def.sql_template, params || {});
        // Always inject company_id as a bound parameter so the report can't
        // accidentally cross tenants.
        if (sql.includes(':company_id')) {
          rows = db.getDb().prepare(sql).all({ company_id: db.getCurrentCompanyId(), ...(params || {}) }) as any[];
        } else {
          rows = db.getDb().prepare(sql).all(...(Object.values(params || {}))) as any[];
        }
      } else if (def.source_table && isSafeIdentifier(def.source_table)) {
        rows = db.getDb().prepare(`SELECT * FROM ${def.source_table} WHERE company_id = ? LIMIT 1000`).all(db.getCurrentCompanyId()) as any[];
      }
    } catch (sqlErr: any) {
      status = 'error';
      errorMessage = sqlErr.message;
    }

    const elapsed = Date.now() - start;
    const finishedAt = now();
    const resultPath = path.join(exportsDir(), `${runId}.json`);
    try { fs.writeFileSync(resultPath, JSON.stringify(rows)); } catch (_) {}

    db.getDb().prepare(`INSERT INTO report_runs (id, company_id, report_definition_id, parameters_json, row_count, elapsed_ms, result_path, result_summary_json, status, error_message, started_at, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(runId, db.getCurrentCompanyId(), reportId, JSON.stringify(params || {}), rows.length, elapsed, resultPath, JSON.stringify({ first_row: rows[0] || null }), status, errorMessage, startedAt, finishedAt);

    return { run_id: runId, status, row_count: rows.length, elapsed_ms: elapsed, rows: rows.slice(0, 500) };
  } catch (e: any) { return { error: e.message }; }
}

// F746: Get rows from a prior report run (paginated, reads from disk snapshot)
export function getReportRunRows(runId: string, offset = 0, limit = 100) {
  try {
    const run = db.getDb().prepare(`SELECT result_path FROM report_runs WHERE id = ? AND company_id = ?`).get(runId, db.getCurrentCompanyId()) as any;
    if (!run?.result_path || !fs.existsSync(run.result_path)) return { rows: [], total: 0 };
    const rows = JSON.parse(fs.readFileSync(run.result_path, 'utf8'));
    return { rows: rows.slice(offset, offset + limit), total: rows.length, offset, limit };
  } catch (e: any) { return { error: e.message }; }
}

// F747: List recent runs for a report (perf history)
export function listReportRuns(reportId: string, limit = 20) {
  try {
    return db.getDb().prepare(`SELECT id, status, row_count, elapsed_ms, started_at FROM report_runs WHERE report_definition_id = ? AND company_id = ? ORDER BY started_at DESC LIMIT ?`)
      .all(reportId, db.getCurrentCompanyId(), limit);
  } catch (e: any) { return { error: e.message }; }
}

// F748: Clone a report definition (lets users fork a system report)
export function cloneReportDefinition(sourceId: string, newName: string) {
  try {
    const src = db.getDb().prepare('SELECT * FROM report_definitions WHERE id = ? AND company_id = ?').get(sourceId, db.getCurrentCompanyId()) as any;
    if (!src) return { error: 'Source not found' };
    const id = uuid();
    db.getDb().prepare(`INSERT INTO report_definitions (id, company_id, name, category, source_table, sql_template, columns_json, filters_json, grouping, sort_by, chart_type, permission_level, owner_user_id, is_system, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`)
      .run(id, db.getCurrentCompanyId(), newName, src.category, src.source_table, src.sql_template, src.columns_json, src.filters_json, src.grouping, src.sort_by, src.chart_type, 'private', src.owner_user_id, `Cloned from ${src.name}`);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F749: Validate a report definition's SQL template (dry-run with LIMIT 0)
export function validateReportSql(sqlTemplate: string, params?: Record<string, any>) {
  try {
    const sql = fillTemplate(sqlTemplate, params || {});
    // Wrap in LIMIT 0 to validate syntax without executing
    const wrapped = `SELECT * FROM (${sql}) AS _validation LIMIT 0`;
    db.getDb().prepare(wrapped).all();
    return { valid: true };
  } catch (e: any) { return { valid: false, error: e.message }; }
}

// F750: Get column metadata for a source table (drives the column picker UI)
export function getSourceColumns(sourceTable: string) {
  try {
    if (!isSafeIdentifier(sourceTable)) return { error: 'Invalid table name' };
    const info = db.getDb().prepare(`PRAGMA table_info(${sourceTable})`).all() as any[];
    const meta = db.getDb().prepare(`SELECT * FROM report_column_metadata WHERE company_id = ? AND source_table = ?`).all(db.getCurrentCompanyId(), sourceTable) as any[];
    return info.map((col: any) => {
      const m = meta.find((m: any) => m.column_name === col.name);
      return { name: col.name, type: col.type, display_name: m?.display_name || col.name, format_hint: m?.format_hint, is_drillable: !!m?.is_drillable, drill_target: m?.drill_target_table };
    });
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch RB: Saved Views & Templates (F751-F760)
// ════════════════════════════════════════════════════════════════════

// F751: Save a view (filters + columns + grouping) for a report
export function saveReportView(opts: any) {
  try {
    const id = uuid();
    if (opts.is_default) {
      db.getDb().prepare(`UPDATE report_saved_views SET is_default = 0 WHERE company_id = ? AND report_definition_id = ?`).run(db.getCurrentCompanyId(), opts.report_definition_id);
    }
    db.getDb().prepare(`INSERT INTO report_saved_views (id, company_id, report_definition_id, name, filters_json, columns_json, sort_by, grouping, owner_user_id, visibility, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.report_definition_id || null, opts.name, JSON.stringify(opts.filters || {}), JSON.stringify(opts.columns || []), opts.sort_by || null, opts.grouping || null, opts.owner_user_id || null, opts.visibility || 'private', opts.is_default ? 1 : 0);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F752: List saved views for a report (filtered by visibility + ownership)
export function listSavedViews(reportId: string, userId?: string) {
  try {
    return db.getDb().prepare(`SELECT * FROM report_saved_views WHERE company_id = ? AND report_definition_id = ? AND (visibility = 'company' OR visibility = 'team' OR owner_user_id = ?) ORDER BY is_default DESC, name`)
      .all(db.getCurrentCompanyId(), reportId, userId || '');
  } catch (e: any) { return { error: e.message }; }
}

// F753: Update a saved view
export function updateSavedView(id: string, patch: any) {
  try {
    const sets: string[] = []; const vals: any[] = [];
    if (patch.name !== undefined) { sets.push('name = ?'); vals.push(patch.name); }
    if (patch.filters !== undefined) { sets.push('filters_json = ?'); vals.push(JSON.stringify(patch.filters)); }
    if (patch.columns !== undefined) { sets.push('columns_json = ?'); vals.push(JSON.stringify(patch.columns)); }
    if (patch.sort_by !== undefined) { sets.push('sort_by = ?'); vals.push(patch.sort_by); }
    if (patch.grouping !== undefined) { sets.push('grouping = ?'); vals.push(patch.grouping); }
    if (patch.visibility !== undefined) { sets.push('visibility = ?'); vals.push(patch.visibility); }
    if (sets.length === 0) return { skipped: true };
    sets.push('updated_at = ?'); vals.push(now());
    vals.push(id, db.getCurrentCompanyId());
    db.getDb().prepare(`UPDATE report_saved_views SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`).run(...vals);
    return { updated: true };
  } catch (e: any) { return { error: e.message }; }
}

// F754: Delete a saved view
export function deleteSavedView(id: string) {
  try {
    db.getDb().prepare(`DELETE FROM report_saved_views WHERE id = ? AND company_id = ?`).run(id, db.getCurrentCompanyId());
    return { deleted: true };
  } catch (e: any) { return { error: e.message }; }
}

// F755: Set default view for a report (clears other defaults)
export function setDefaultView(viewId: string) {
  try {
    const v = db.getDb().prepare('SELECT report_definition_id FROM report_saved_views WHERE id = ? AND company_id = ?').get(viewId, db.getCurrentCompanyId()) as any;
    if (!v) return { error: 'View not found' };
    db.getDb().prepare(`UPDATE report_saved_views SET is_default = 0 WHERE company_id = ? AND report_definition_id = ?`).run(db.getCurrentCompanyId(), v.report_definition_id);
    db.getDb().prepare(`UPDATE report_saved_views SET is_default = 1, updated_at = ? WHERE id = ?`).run(now(), viewId);
    return { default_set: true };
  } catch (e: any) { return { error: e.message }; }
}

// F756: Apply a saved view to a report and run
export function runWithSavedView(viewId: string) {
  try {
    const v = db.getDb().prepare('SELECT * FROM report_saved_views WHERE id = ? AND company_id = ?').get(viewId, db.getCurrentCompanyId()) as any;
    if (!v) return { error: 'View not found' };
    return runReport(v.report_definition_id, JSON.parse(v.filters_json || '{}'));
  } catch (e: any) { return { error: e.message }; }
}

// F757: Create a narrative template (boilerplate for exec summaries)
export function createNarrativeTemplate(opts: any) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO narrative_templates (id, company_id, name, template_type, body_template, placeholders_json) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.name, opts.template_type || 'exec_summary', opts.body_template || '', JSON.stringify(opts.placeholders || []));
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F758: List narrative templates
export function listNarrativeTemplates(type?: string) {
  try {
    const where = type ? 'AND template_type = ?' : '';
    const params = type ? [db.getCurrentCompanyId(), type] : [db.getCurrentCompanyId()];
    return db.getDb().prepare(`SELECT * FROM narrative_templates WHERE company_id = ? ${where} ORDER BY name`).all(...params);
  } catch (e: any) { return { error: e.message }; }
}

// F759: Render a narrative template with vars substituted in
export function renderNarrative(templateId: string, vars: Record<string, any>) {
  try {
    const t = db.getDb().prepare('SELECT body_template FROM narrative_templates WHERE id = ? AND company_id = ?').get(templateId, db.getCurrentCompanyId()) as any;
    if (!t) return { error: 'Template not found' };
    const rendered = (t.body_template || '').replace(/\{\{(\w+)\}\}/g, (_m: string, key: string) => {
      const v = vars[key];
      return v === undefined || v === null ? '' : String(v);
    });
    return { rendered };
  } catch (e: any) { return { error: e.message }; }
}

// F760: Quick-share a saved view (returns a shareable view ID)
export function shareView(viewId: string, visibility: 'team' | 'company') {
  try {
    db.getDb().prepare(`UPDATE report_saved_views SET visibility = ?, updated_at = ? WHERE id = ? AND company_id = ?`)
      .run(visibility, now(), viewId, db.getCurrentCompanyId());
    return { shared: true, visibility };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch RC: Scheduled Reports & Email Delivery (F761-F770)
// ════════════════════════════════════════════════════════════════════

// F761: Schedule a report for periodic email
export function scheduleReport(opts: any) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO scheduled_reports (id, company_id, report_definition_id, saved_view_id, schedule_cron, schedule_preset, recipients_json, subject_template, body_template, format, next_run_at, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
      .run(id, db.getCurrentCompanyId(), opts.report_definition_id, opts.saved_view_id || null, opts.schedule_cron || null, opts.schedule_preset || 'monthly', JSON.stringify(opts.recipients || []), opts.subject_template || null, opts.body_template || null, opts.format || 'pdf', opts.next_run_at || null);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F762: List scheduled reports (due now or all)
export function listScheduledReports(filter?: { due_only?: boolean }) {
  try {
    const where = filter?.due_only ? `AND active = 1 AND next_run_at <= ?` : `AND active = 1`;
    const params: any[] = [db.getCurrentCompanyId()];
    if (filter?.due_only) params.push(now());
    return db.getDb().prepare(`SELECT * FROM scheduled_reports WHERE company_id = ? ${where} ORDER BY next_run_at`).all(...params);
  } catch (e: any) { return { error: e.message }; }
}

// F763: Trigger a scheduled report immediately (writes to history)
export function runScheduledReportNow(scheduledId: string) {
  try {
    const s = db.getDb().prepare('SELECT * FROM scheduled_reports WHERE id = ? AND company_id = ?').get(scheduledId, db.getCurrentCompanyId()) as any;
    if (!s) return { error: 'Scheduled report not found' };
    const run = runReport(s.report_definition_id, {}) as any;
    const historyId = uuid();
    db.getDb().prepare(`INSERT INTO scheduled_report_history (id, company_id, scheduled_report_id, fired_at, status, recipient_count, report_run_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(historyId, db.getCurrentCompanyId(), scheduledId, now(), run.status || 'success', (JSON.parse(s.recipients_json || '[]')).length, run.run_id || null);
    db.getDb().prepare(`UPDATE scheduled_reports SET last_run_at = ?, last_run_status = ?, updated_at = ? WHERE id = ?`)
      .run(now(), run.status || 'success', now(), scheduledId);
    return { history_id: historyId, run_id: run.run_id };
  } catch (e: any) { return { error: e.message }; }
}

// F764: Pause / resume a scheduled report
export function pauseScheduledReport(id: string, active: boolean) {
  try {
    db.getDb().prepare(`UPDATE scheduled_reports SET active = ?, updated_at = ? WHERE id = ? AND company_id = ?`)
      .run(active ? 1 : 0, now(), id, db.getCurrentCompanyId());
    return { active };
  } catch (e: any) { return { error: e.message }; }
}

// F765: Update schedule cadence
export function updateScheduleCadence(id: string, cron?: string, preset?: string, nextRunAt?: string) {
  try {
    db.getDb().prepare(`UPDATE scheduled_reports SET schedule_cron = ?, schedule_preset = ?, next_run_at = ?, updated_at = ? WHERE id = ? AND company_id = ?`)
      .run(cron || null, preset || null, nextRunAt || null, now(), id, db.getCurrentCompanyId());
    return { updated: true };
  } catch (e: any) { return { error: e.message }; }
}

// F766: View scheduled report history
export function scheduledReportHistory(scheduledId: string, limit = 20) {
  try {
    return db.getDb().prepare(`SELECT * FROM scheduled_report_history WHERE scheduled_report_id = ? AND company_id = ? ORDER BY fired_at DESC LIMIT ?`)
      .all(scheduledId, db.getCurrentCompanyId(), limit);
  } catch (e: any) { return { error: e.message }; }
}

// F767: Compute next-run datetime from a preset (daily/weekly/monthly)
export function computeNextRun(preset: string, fromDate?: string) {
  try {
    const base = new Date((fromDate || now()).slice(0, 19) + 'Z');
    if (preset === 'daily') base.setUTCDate(base.getUTCDate() + 1);
    else if (preset === 'weekly') base.setUTCDate(base.getUTCDate() + 7);
    else if (preset === 'biweekly') base.setUTCDate(base.getUTCDate() + 14);
    else if (preset === 'monthly') base.setUTCMonth(base.getUTCMonth() + 1);
    else if (preset === 'quarterly') base.setUTCMonth(base.getUTCMonth() + 3);
    else if (preset === 'yearly') base.setUTCFullYear(base.getUTCFullYear() + 1);
    return { next_run_at: base.toISOString() };
  } catch (e: any) { return { error: e.message }; }
}

// F768: Add recipients to a scheduled report
export function addReportRecipients(scheduledId: string, recipients: string[]) {
  try {
    const s = db.getDb().prepare('SELECT recipients_json FROM scheduled_reports WHERE id = ? AND company_id = ?').get(scheduledId, db.getCurrentCompanyId()) as any;
    const current = new Set(JSON.parse(s?.recipients_json || '[]'));
    for (const r of recipients) current.add(r);
    db.getDb().prepare(`UPDATE scheduled_reports SET recipients_json = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify([...current]), now(), scheduledId);
    return { recipient_count: current.size };
  } catch (e: any) { return { error: e.message }; }
}

// F769: Remove recipients
export function removeReportRecipients(scheduledId: string, recipients: string[]) {
  try {
    const s = db.getDb().prepare('SELECT recipients_json FROM scheduled_reports WHERE id = ? AND company_id = ?').get(scheduledId, db.getCurrentCompanyId()) as any;
    const remove = new Set(recipients);
    const filtered = JSON.parse(s?.recipients_json || '[]').filter((r: string) => !remove.has(r));
    db.getDb().prepare(`UPDATE scheduled_reports SET recipients_json = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(filtered), now(), scheduledId);
    return { recipient_count: filtered.length };
  } catch (e: any) { return { error: e.message }; }
}

// F770: Delete a scheduled report
export function deleteScheduledReport(id: string) {
  try {
    db.getDb().prepare(`DELETE FROM scheduled_reports WHERE id = ? AND company_id = ?`).run(id, db.getCurrentCompanyId());
    return { deleted: true };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch RD: KPI Widgets & Metrics (F771-F780)
// ════════════════════════════════════════════════════════════════════

// F771: Create a KPI definition with thresholds
export function createKpiDefinition(opts: any) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO kpi_definitions (id, company_id, key, name, description, formula, unit, direction, green_threshold, yellow_threshold, red_threshold, target, refresh_cadence, category, is_system) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(company_id, key) DO UPDATE SET name = excluded.name, description = excluded.description, formula = excluded.formula, unit = excluded.unit, direction = excluded.direction, green_threshold = excluded.green_threshold, yellow_threshold = excluded.yellow_threshold, red_threshold = excluded.red_threshold, target = excluded.target, refresh_cadence = excluded.refresh_cadence, category = excluded.category, updated_at = excluded.created_at`)
      .run(id, db.getCurrentCompanyId(), opts.key, opts.name, opts.description || null, opts.formula || null, opts.unit || null, opts.direction || 'higher_better', opts.green_threshold ?? null, opts.yellow_threshold ?? null, opts.red_threshold ?? null, opts.target ?? null, opts.refresh_cadence || 'daily', opts.category || null);
    return { id, key: opts.key };
  } catch (e: any) { return { error: e.message }; }
}

// F772: Record a KPI snapshot value (append-only — never updates)
export function recordKpiSnapshot(opts: { key: string; value: number; period_start?: string; period_end?: string; inputs?: any }) {
  try {
    const def = db.getDb().prepare('SELECT * FROM kpi_definitions WHERE company_id = ? AND key = ?').get(db.getCurrentCompanyId(), opts.key) as any;
    const severity = classifyKpiSeverity(opts.value, def);
    const id = uuid();
    db.getDb().prepare(`INSERT INTO kpi_snapshots (id, company_id, kpi_key, period_start, period_end, value, severity, inputs_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.key, opts.period_start || today(), opts.period_end || today(), opts.value, severity, JSON.stringify(opts.inputs || {}));
    return { id, severity };
  } catch (e: any) { return { error: e.message }; }
}

// Helper: classify a KPI value against its thresholds (returns 'green'|'yellow'|'red'|'unknown')
export function classifyKpiSeverity(value: number, def: any): string {
  if (!def) return 'unknown';
  const { direction, green_threshold, yellow_threshold, red_threshold } = def;
  if (green_threshold == null && yellow_threshold == null && red_threshold == null) return 'unknown';
  if (direction === 'higher_better') {
    if (green_threshold != null && value >= green_threshold) return 'green';
    if (yellow_threshold != null && value >= yellow_threshold) return 'yellow';
    return 'red';
  } else {
    // lower_better
    if (green_threshold != null && value <= green_threshold) return 'green';
    if (yellow_threshold != null && value <= yellow_threshold) return 'yellow';
    return 'red';
  }
}

// F773: Get the latest KPI value (current)
export function getKpiCurrent(key: string) {
  try {
    const snap = db.getDb().prepare(`SELECT * FROM kpi_snapshots WHERE company_id = ? AND kpi_key = ? ORDER BY snapshot_at DESC LIMIT 1`).get(db.getCurrentCompanyId(), key);
    const def = db.getDb().prepare(`SELECT * FROM kpi_definitions WHERE company_id = ? AND key = ?`).get(db.getCurrentCompanyId(), key);
    return { def, current: snap };
  } catch (e: any) { return { error: e.message }; }
}

// F774: KPI time series (for sparklines / trend charts)
export function getKpiTimeSeries(key: string, opts?: { from?: string; to?: string; limit?: number }) {
  try {
    const params: any[] = [db.getCurrentCompanyId(), key];
    let where = `company_id = ? AND kpi_key = ?`;
    if (opts?.from) { where += ` AND snapshot_at >= ?`; params.push(opts.from); }
    if (opts?.to) { where += ` AND snapshot_at <= ?`; params.push(opts.to); }
    params.push(opts?.limit || 90);
    return db.getDb().prepare(`SELECT snapshot_at, value, severity FROM kpi_snapshots WHERE ${where} ORDER BY snapshot_at DESC LIMIT ?`).all(...params);
  } catch (e: any) { return { error: e.message }; }
}

// F775: KPI delta vs prior period
export function kpiDelta(key: string, comparePeriodDays = 30) {
  try {
    const snaps = db.getDb().prepare(`SELECT * FROM kpi_snapshots WHERE company_id = ? AND kpi_key = ? ORDER BY snapshot_at DESC LIMIT 2`).all(db.getCurrentCompanyId(), key) as any[];
    if (snaps.length < 2) return { delta: null, reason: 'Need ≥2 snapshots' };
    const current = snaps[0].value || 0;
    const prior = snaps[1].value || 0;
    const delta = round2(current - prior);
    const deltaPct = prior === 0 ? null : round2((delta / Math.abs(prior)) * 100);
    return { current, prior, delta, delta_percent: deltaPct };
  } catch (e: any) { return { error: e.message }; }
}

// F776: Calculate built-in business KPIs (current ratio, DSO, gross margin, etc.)
export function recalculateBuiltInKpis() {
  try {
    const cid = db.getCurrentCompanyId();
    const dbConn = db.getDb();
    const out: any[] = [];

    // Current ratio = current_assets / current_liabilities (approximation from accounts)
    const assets = (dbConn.prepare(`SELECT COALESCE(SUM(balance), 0) t FROM accounts WHERE company_id = ? AND type = 'asset'`).get(cid) as any).t || 0;
    const liabs = (dbConn.prepare(`SELECT COALESCE(SUM(balance), 0) t FROM accounts WHERE company_id = ? AND type = 'liability'`).get(cid) as any).t || 0;
    const currentRatio = liabs === 0 ? 0 : round2(assets / liabs);
    recordKpiSnapshot({ key: 'current_ratio', value: currentRatio, inputs: { assets, liabs } });
    out.push({ key: 'current_ratio', value: currentRatio });

    // Gross margin (current FY estimate) — revenue + cogs from accounts
    const revenue = Math.abs((dbConn.prepare(`SELECT COALESCE(SUM(balance), 0) t FROM accounts WHERE company_id = ? AND type = 'revenue'`).get(cid) as any).t || 0);
    const cogs = (dbConn.prepare(`SELECT COALESCE(SUM(balance), 0) t FROM accounts WHERE company_id = ? AND (subtype = 'cogs' OR name LIKE '%COGS%')`).get(cid) as any).t || 0;
    const gm = revenue === 0 ? 0 : round2(((revenue - cogs) / revenue) * 100);
    recordKpiSnapshot({ key: 'gross_margin_pct', value: gm, inputs: { revenue, cogs } });
    out.push({ key: 'gross_margin_pct', value: gm });

    // DSO approximation
    const ar = (dbConn.prepare(`SELECT COALESCE(SUM(total - amount_paid), 0) t FROM invoices WHERE company_id = ? AND status IN ('sent', 'overdue', 'partial')`).get(cid) as any).t || 0;
    const dso = revenue === 0 ? 0 : round2((ar / revenue) * 365);
    recordKpiSnapshot({ key: 'dso', value: dso, inputs: { ar, revenue } });
    out.push({ key: 'dso', value: dso });

    return { kpis_updated: out.length, results: out };
  } catch (e: any) { return { error: e.message }; }
}

// F777: Set KPI target (separate from thresholds — for "% to goal" tracking)
export function setKpiTarget(key: string, target: number) {
  try {
    db.getDb().prepare(`UPDATE kpi_definitions SET target = ?, updated_at = ? WHERE company_id = ? AND key = ?`)
      .run(target, now(), db.getCurrentCompanyId(), key);
    return { key, target };
  } catch (e: any) { return { error: e.message }; }
}

// F778: KPI dashboard rollup — all KPIs with current values + severities
export function kpiDashboardRollup() {
  try {
    const defs = db.getDb().prepare(`SELECT * FROM kpi_definitions WHERE company_id = ?`).all(db.getCurrentCompanyId()) as any[];
    const out = defs.map(d => {
      const latest = db.getDb().prepare(`SELECT * FROM kpi_snapshots WHERE company_id = ? AND kpi_key = ? ORDER BY snapshot_at DESC LIMIT 1`).get(db.getCurrentCompanyId(), d.key) as any;
      return { ...d, current_value: latest?.value, current_severity: latest?.severity, last_snapshot_at: latest?.snapshot_at };
    });
    return out;
  } catch (e: any) { return { error: e.message }; }
}

// F779: Delete a KPI definition + its snapshots
export function deleteKpi(key: string) {
  try {
    const cid = db.getCurrentCompanyId();
    db.getDb().prepare(`DELETE FROM kpi_snapshots WHERE company_id = ? AND kpi_key = ?`).run(cid, key);
    db.getDb().prepare(`DELETE FROM kpi_definitions WHERE company_id = ? AND key = ?`).run(cid, key);
    return { deleted: true };
  } catch (e: any) { return { error: e.message }; }
}

// F780: Bulk-prune KPI snapshots older than N days (keep storage tight)
export function pruneKpiSnapshots(olderThanDays: number) {
  try {
    const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString();
    const r = db.getDb().prepare(`DELETE FROM kpi_snapshots WHERE company_id = ? AND snapshot_at < ?`).run(db.getCurrentCompanyId(), cutoff);
    return { pruned: r.changes };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch RE: Drill-down & Filters (F781-F790)
// ════════════════════════════════════════════════════════════════════

// F781: Record a drill (audit trail: user X drilled from report Y → entity Z)
export function recordDrill(opts: { user_id?: string; report_run_id?: string; target_table: string; target_id: string; path?: any }) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO report_drill_audit (id, company_id, user_id, report_run_id, drill_target_table, drill_target_id, drill_path_json) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.user_id || null, opts.report_run_id || null, opts.target_table, opts.target_id, JSON.stringify(opts.path || []));
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F782: Get drillable child rows for an entity (e.g., click an account → see GL postings)
export function drillIntoEntity(table: string, id: string) {
  try {
    if (!isSafeIdentifier(table)) return { error: 'Invalid table' };
    // Use journal entries as the default drill target for accounts
    if (table === 'accounts') {
      return db.getDb().prepare(`SELECT je.* FROM journal_entry_lines jel INNER JOIN journal_entries je ON jel.journal_entry_id = je.id WHERE jel.account_id = ? AND je.company_id = ? ORDER BY je.date DESC LIMIT 100`).all(id, db.getCurrentCompanyId());
    }
    if (table === 'vendors') {
      return db.getDb().prepare(`SELECT * FROM bills WHERE vendor_id = ? AND company_id = ? ORDER BY issue_date DESC LIMIT 100`).all(id, db.getCurrentCompanyId());
    }
    if (table === 'clients') {
      return db.getDb().prepare(`SELECT * FROM invoices WHERE client_id = ? AND company_id = ? ORDER BY issue_date DESC LIMIT 100`).all(id, db.getCurrentCompanyId());
    }
    return { rows: [], message: 'No drill-down configured for ' + table };
  } catch (e: any) { return { error: e.message }; }
}

// F783: Apply a filter set to a result row array (post-execution filter)
export function applyFiltersToRows(rows: any[], filters: any[]): any[] {
  try {
    return (rows || []).filter(row => {
      for (const f of filters || []) {
        const v = row[f.field];
        if (f.op === 'eq' && v !== f.value) return false;
        if (f.op === 'neq' && v === f.value) return false;
        if (f.op === 'gt' && !(v > f.value)) return false;
        if (f.op === 'lt' && !(v < f.value)) return false;
        if (f.op === 'gte' && !(v >= f.value)) return false;
        if (f.op === 'lte' && !(v <= f.value)) return false;
        if (f.op === 'in' && !((f.value || []) as any[]).includes(v)) return false;
        if (f.op === 'contains' && !String(v || '').toLowerCase().includes(String(f.value || '').toLowerCase())) return false;
        if (f.op === 'between' && !(v >= f.value?.[0] && v <= f.value?.[1])) return false;
      }
      return true;
    });
  } catch (e: any) { return [] as any[]; }
}

// F784: Group result rows by a column (returns { groupKey: rows[] })
export function groupResultRows(rows: any[], groupBy: string): Record<string, any[]> {
  try {
    const out: Record<string, any[]> = {};
    for (const r of rows || []) {
      const k = String(r[groupBy] ?? '__none__');
      if (!out[k]) out[k] = [];
      out[k].push(r);
    }
    return out;
  } catch (_) { return {}; }
}

// F785: Sort rows by a column
export function sortRows(rows: any[], sortBy: string, direction: 'asc' | 'desc' = 'asc'): any[] {
  try {
    const mult = direction === 'asc' ? 1 : -1;
    return [...(rows || [])].sort((a, b) => {
      const av = a[sortBy], bv = b[sortBy];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult;
      return String(av).localeCompare(String(bv)) * mult;
    });
  } catch (_) { return rows || []; }
}

// F786: Aggregate column values (sum/avg/min/max/count) — used by total rows
export function aggregateColumn(rows: any[], column: string, op: 'sum' | 'avg' | 'min' | 'max' | 'count'): number {
  try {
    const vals = (rows || []).map(r => Number(r[column] || 0)).filter(n => !isNaN(n));
    if (vals.length === 0) return 0;
    if (op === 'sum') return round2(vals.reduce((a, b) => a + b, 0));
    if (op === 'avg') return round2(vals.reduce((a, b) => a + b, 0) / vals.length);
    if (op === 'min') return Math.min(...vals);
    if (op === 'max') return Math.max(...vals);
    return vals.length;
  } catch (_) { return 0; }
}

// F787: Drill history for a user (audit trail: where have they been?)
export function userDrillHistory(userId: string, limit = 50) {
  try {
    return db.getDb().prepare(`SELECT * FROM report_drill_audit WHERE company_id = ? AND user_id = ? ORDER BY drilled_at DESC LIMIT ?`)
      .all(db.getCurrentCompanyId(), userId, limit);
  } catch (e: any) { return { error: e.message }; }
}

// F788: Most-drilled entities (which accounts/vendors/clients get the most attention?)
export function topDrilledEntities(table: string, days = 30) {
  try {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    return db.getDb().prepare(`SELECT drill_target_id, COUNT(*) drill_count FROM report_drill_audit WHERE company_id = ? AND drill_target_table = ? AND drilled_at >= ? GROUP BY drill_target_id ORDER BY drill_count DESC LIMIT 25`)
      .all(db.getCurrentCompanyId(), table, cutoff);
  } catch (e: any) { return { error: e.message }; }
}

// F789: Save a column-metadata override for a source table (drives column picker UI)
export function setColumnMetadata(opts: any) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO report_column_metadata (id, company_id, source_table, column_name, display_name, data_type, format_hint, is_visible, is_drillable, drill_target_table, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.source_table, opts.column_name, opts.display_name || null, opts.data_type || null, opts.format_hint || null, opts.is_visible ? 1 : 0, opts.is_drillable ? 1 : 0, opts.drill_target_table || null, opts.sort_order || 0);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F790: Get filter "preset" options (last 7 days, MTD, QTD, YTD, etc.)
export function getDateFilterPresets() {
  try {
    const todayStr = today();
    const t = new Date(todayStr + 'T00:00:00Z');
    const startOfMonth = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1)).toISOString().slice(0, 10);
    const startOfQuarter = new Date(Date.UTC(t.getUTCFullYear(), Math.floor(t.getUTCMonth() / 3) * 3, 1)).toISOString().slice(0, 10);
    const startOfYear = `${t.getUTCFullYear()}-01-01`;
    const sevenDaysAgo = new Date(t.getTime() - 7 * 86400000).toISOString().slice(0, 10);
    const thirtyDaysAgo = new Date(t.getTime() - 30 * 86400000).toISOString().slice(0, 10);
    return [
      { id: 'today', label: 'Today', from: todayStr, to: todayStr },
      { id: 'last7', label: 'Last 7 Days', from: sevenDaysAgo, to: todayStr },
      { id: 'last30', label: 'Last 30 Days', from: thirtyDaysAgo, to: todayStr },
      { id: 'mtd', label: 'Month-to-Date', from: startOfMonth, to: todayStr },
      { id: 'qtd', label: 'Quarter-to-Date', from: startOfQuarter, to: todayStr },
      { id: 'ytd', label: 'Year-to-Date', from: startOfYear, to: todayStr },
    ];
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch RF: Financial Statement Engines (F791-F800)
// ════════════════════════════════════════════════════════════════════

// F791: Generate a P&L (income statement) for a period
export function generateProfitAndLoss(rangeStart: string, rangeEnd: string) {
  try {
    const cid = db.getCurrentCompanyId();
    const lines = db.getDb().prepare(`SELECT a.id, a.name, a.type, a.subtype,
      COALESCE(SUM(jel.credit - jel.debit), 0) net
      FROM accounts a
      LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
      LEFT JOIN journal_entries je ON jel.journal_entry_id = je.id AND je.date BETWEEN ? AND ?
      WHERE a.company_id = ? AND a.type IN ('revenue', 'expense')
      GROUP BY a.id, a.name, a.type, a.subtype ORDER BY a.type, a.name`).all(rangeStart, rangeEnd, cid) as any[];
    const revenue = lines.filter(l => l.type === 'revenue').map(l => ({ ...l, net: round2(l.net) }));
    const expense = lines.filter(l => l.type === 'expense').map(l => ({ ...l, net: round2(Math.abs(l.net)) }));
    const totalRevenue = round2(revenue.reduce((s, l) => s + l.net, 0));
    const totalExpense = round2(expense.reduce((s, l) => s + l.net, 0));
    const netIncome = round2(totalRevenue - totalExpense);
    return { range_start: rangeStart, range_end: rangeEnd, revenue, expense, total_revenue: totalRevenue, total_expense: totalExpense, net_income: netIncome };
  } catch (e: any) { return { error: e.message }; }
}

// F792: Generate a Balance Sheet as of a date
export function generateBalanceSheet(asOfDate: string) {
  try {
    const cid = db.getCurrentCompanyId();
    const rows = db.getDb().prepare(`SELECT a.id, a.name, a.type, a.subtype,
      COALESCE(SUM(jel.debit - jel.credit), 0) balance
      FROM accounts a
      LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
      LEFT JOIN journal_entries je ON jel.journal_entry_id = je.id AND je.date <= ?
      WHERE a.company_id = ? AND a.type IN ('asset', 'liability', 'equity')
      GROUP BY a.id, a.name, a.type, a.subtype ORDER BY a.type, a.name`).all(asOfDate, cid) as any[];
    const assets = rows.filter(r => r.type === 'asset').map(r => ({ ...r, balance: round2(r.balance) }));
    const liabilities = rows.filter(r => r.type === 'liability').map(r => ({ ...r, balance: round2(-r.balance) }));
    const equity = rows.filter(r => r.type === 'equity').map(r => ({ ...r, balance: round2(-r.balance) }));
    const totalA = round2(assets.reduce((s, r) => s + r.balance, 0));
    const totalL = round2(liabilities.reduce((s, r) => s + r.balance, 0));
    const totalE = round2(equity.reduce((s, r) => s + r.balance, 0));
    return { as_of: asOfDate, assets, liabilities, equity, total_assets: totalA, total_liabilities: totalL, total_equity: totalE, balanced: Math.abs(totalA - (totalL + totalE)) < 0.01 };
  } catch (e: any) { return { error: e.message }; }
}

// F793: Cash Flow Statement (indirect method)
export function generateCashFlow(rangeStart: string, rangeEnd: string) {
  try {
    const pnl = generateProfitAndLoss(rangeStart, rangeEnd) as any;
    if (pnl.error) return pnl;
    // Operating activities: net income + non-cash + working capital changes
    const netIncome = pnl.net_income;
    // Approximation — production should split by D&A, AR change, AP change
    const cid = db.getCurrentCompanyId();
    const arChange = (db.getDb().prepare(`SELECT COALESCE(SUM(total - amount_paid), 0) ar FROM invoices WHERE company_id = ? AND issue_date BETWEEN ? AND ?`).get(cid, rangeStart, rangeEnd) as any).ar || 0;
    const apChange = (db.getDb().prepare(`SELECT COALESCE(SUM(total - amount_paid), 0) ap FROM bills WHERE company_id = ? AND issue_date BETWEEN ? AND ?`).get(cid, rangeStart, rangeEnd) as any).ap || 0;
    const operating = round2(netIncome - arChange + apChange);
    return { range_start: rangeStart, range_end: rangeEnd, net_income: netIncome, ar_change: -arChange, ap_change: apChange, operating_activities: operating };
  } catch (e: any) { return { error: e.message }; }
}

// F794: Trial Balance (snapshot of debits/credits per account)
export function generateTrialBalance(asOfDate: string) {
  try {
    const rows = db.getDb().prepare(`SELECT a.id, a.name, a.type,
      COALESCE(SUM(jel.debit), 0) total_debits,
      COALESCE(SUM(jel.credit), 0) total_credits
      FROM accounts a
      LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
      LEFT JOIN journal_entries je ON jel.journal_entry_id = je.id AND je.date <= ?
      WHERE a.company_id = ?
      GROUP BY a.id, a.name, a.type
      HAVING (total_debits > 0 OR total_credits > 0)
      ORDER BY a.type, a.name`).all(asOfDate, db.getCurrentCompanyId()) as any[];
    const totalD = round2(rows.reduce((s, r) => s + (r.total_debits || 0), 0));
    const totalC = round2(rows.reduce((s, r) => s + (r.total_credits || 0), 0));
    return { as_of: asOfDate, rows, total_debits: totalD, total_credits: totalC, balanced: Math.abs(totalD - totalC) < 0.01 };
  } catch (e: any) { return { error: e.message }; }
}

// F795: AR Aging (buckets: 0-30, 31-60, 61-90, 90+)
export function generateArAging() {
  try {
    const todayD = new Date(today() + 'T00:00:00Z').getTime();
    const inv = db.getDb().prepare(`SELECT i.id, i.client_id, c.name client_name, i.issue_date AS date, i.due_date, i.total, i.amount_paid FROM invoices i LEFT JOIN clients c ON i.client_id = c.id WHERE i.company_id = ? AND i.status IN ('sent', 'overdue', 'partial')`).all(db.getCurrentCompanyId()) as any[];
    const buckets = { current: 0, b30: 0, b60: 0, b90: 0, b90plus: 0 };
    const detail: any[] = [];
    for (const i of inv) {
      const due = new Date((i.due_date || i.date) + 'T00:00:00Z').getTime();
      const daysOver = Math.floor((todayD - due) / 86400000);
      const open = (i.total || 0) - (i.amount_paid || 0);
      let bucket = 'current';
      if (daysOver > 90) { buckets.b90plus += open; bucket = 'b90plus'; }
      else if (daysOver > 60) { buckets.b90 += open; bucket = 'b90'; }
      else if (daysOver > 30) { buckets.b60 += open; bucket = 'b60'; }
      else if (daysOver > 0) { buckets.b30 += open; bucket = 'b30'; }
      else { buckets.current += open; }
      detail.push({ id: i.id, client_name: i.client_name, open: round2(open), days_overdue: daysOver, bucket });
    }
    return { buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, round2(v as number)])), detail };
  } catch (e: any) { return { error: e.message }; }
}

// F796: AP Aging (mirror of AR for vendor bills)
export function generateApAging() {
  try {
    const todayD = new Date(today() + 'T00:00:00Z').getTime();
    const bills = db.getDb().prepare(`SELECT b.id, b.vendor_id, v.name vendor_name, b.issue_date AS date, b.due_date, b.total, b.amount_paid FROM bills b LEFT JOIN vendors v ON b.vendor_id = v.id WHERE b.company_id = ? AND b.status IN ('pending', 'received', 'approved', 'partial', 'overdue')`).all(db.getCurrentCompanyId()) as any[];
    const buckets = { current: 0, b30: 0, b60: 0, b90: 0, b90plus: 0 };
    const detail: any[] = [];
    for (const b of bills) {
      const due = new Date((b.due_date || b.date) + 'T00:00:00Z').getTime();
      const daysOver = Math.floor((todayD - due) / 86400000);
      const open = (b.total || 0) - (b.amount_paid || 0);
      let bucket = 'current';
      if (daysOver > 90) { buckets.b90plus += open; bucket = 'b90plus'; }
      else if (daysOver > 60) { buckets.b90 += open; bucket = 'b90'; }
      else if (daysOver > 30) { buckets.b60 += open; bucket = 'b60'; }
      else if (daysOver > 0) { buckets.b30 += open; bucket = 'b30'; }
      else { buckets.current += open; }
      detail.push({ id: b.id, vendor_name: b.vendor_name, open: round2(open), days_overdue: daysOver, bucket });
    }
    return { buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, round2(v as number)])), detail };
  } catch (e: any) { return { error: e.message }; }
}

// F797: Cash Position summary (sum of all cash + checking + savings accounts)
export function cashPositionSummary() {
  try {
    const cid = db.getCurrentCompanyId();
    const rows = db.getDb().prepare(`SELECT id, name, balance FROM accounts WHERE company_id = ? AND (subtype IN ('cash', 'checking', 'savings') OR name LIKE '%Cash%' OR name LIKE '%Bank%' OR name LIKE '%Checking%' OR name LIKE '%Savings%')`).all(cid) as any[];
    const total = round2(rows.reduce((s, r) => s + (r.balance || 0), 0));
    return { accounts: rows.map(r => ({ ...r, balance: round2(r.balance) })), total };
  } catch (e: any) { return { error: e.message }; }
}

// F798: Profit Margin trend (per month over last N months)
export function profitMarginTrend(months = 12) {
  try {
    const out: any[] = [];
    const todayD = new Date(today() + 'T00:00:00Z');
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(todayD.getUTCFullYear(), todayD.getUTCMonth() - i, 1));
      const start = d.toISOString().slice(0, 10);
      const endD = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
      const end = endD.toISOString().slice(0, 10);
      const pnl = generateProfitAndLoss(start, end) as any;
      const margin = (pnl.total_revenue || 0) === 0 ? 0 : round2((pnl.net_income / pnl.total_revenue) * 100);
      out.push({ month: start.slice(0, 7), revenue: pnl.total_revenue, net_income: pnl.net_income, margin_pct: margin });
    }
    return out;
  } catch (e: any) { return { error: e.message }; }
}

// F799: Working capital (current assets - current liabilities)
export function workingCapital() {
  try {
    const cid = db.getCurrentCompanyId();
    const ca = ((db.getDb().prepare(`SELECT COALESCE(SUM(balance), 0) t FROM accounts WHERE company_id = ? AND type = 'asset' AND (subtype IN ('cash', 'checking', 'ar', 'inventory') OR name LIKE '%Receivable%')`).get(cid) as any).t) || 0;
    const cl = ((db.getDb().prepare(`SELECT COALESCE(SUM(balance), 0) t FROM accounts WHERE company_id = ? AND type = 'liability' AND (subtype IN ('ap', 'short_term_debt', 'credit_card') OR name LIKE '%Payable%')`).get(cid) as any).t) || 0;
    return { current_assets: round2(ca), current_liabilities: round2(cl), working_capital: round2(ca - cl) };
  } catch (e: any) { return { error: e.message }; }
}

// F800: GL detail by account (drillable from balance sheet / P&L)
export function glDetailByAccount(accountId: string, rangeStart: string, rangeEnd: string) {
  try {
    return db.getDb().prepare(`SELECT je.id, je.date, je.memo, jel.type, jel.amount FROM journal_entry_lines jel INNER JOIN journal_entries je ON jel.journal_entry_id = je.id WHERE jel.account_id = ? AND je.company_id = ? AND je.date BETWEEN ? AND ? ORDER BY je.date`)
      .all(accountId, db.getCurrentCompanyId(), rangeStart, rangeEnd);
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch RG: Variance & Comparison (F801-F810)
// ════════════════════════════════════════════════════════════════════

// F801: Actual vs Budget variance (assumes a `budgets` table — graceful fallback)
export function actualVsBudget(rangeStart: string, rangeEnd: string) {
  try {
    const cid = db.getCurrentCompanyId();
    let budgetMap: Record<string, number> = {};
    try {
      const b = db.getDb().prepare(`SELECT account_id, SUM(amount) total FROM budget_lines WHERE company_id = ? AND period_start >= ? AND period_end <= ? GROUP BY account_id`).all(cid, rangeStart, rangeEnd) as any[];
      for (const r of b) budgetMap[r.account_id] = r.total;
    } catch (_) {/* no budget table — return zeros */}
    const pnl = generateProfitAndLoss(rangeStart, rangeEnd) as any;
    const lines = [...(pnl.revenue || []), ...(pnl.expense || [])].map((l: any) => {
      const budget = budgetMap[l.id] || 0;
      const variance = round2((l.net || 0) - budget);
      const variancePct = budget === 0 ? null : round2((variance / budget) * 100);
      return { id: l.id, name: l.name, type: l.type, actual: l.net, budget, variance, variance_pct: variancePct };
    });
    const id = uuid();
    db.getDb().prepare(`INSERT INTO variance_analyses (id, company_id, analysis_type, period_actual_start, period_actual_end, actual_total, compare_total, variance_amount, by_account_json, generated_at) VALUES (?, ?, 'actual_vs_budget', ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, cid, rangeStart, rangeEnd, pnl.net_income, 0, pnl.net_income, JSON.stringify(lines), now());
    return { analysis_id: id, lines, period_start: rangeStart, period_end: rangeEnd };
  } catch (e: any) { return { error: e.message }; }
}

// F802: Period-over-period (compare this month/quarter to last)
export function periodOverPeriod(rangeStartA: string, rangeEndA: string, rangeStartB: string, rangeEndB: string) {
  try {
    const pnlA = generateProfitAndLoss(rangeStartA, rangeEndA) as any;
    const pnlB = generateProfitAndLoss(rangeStartB, rangeEndB) as any;
    const delta = round2((pnlA.net_income || 0) - (pnlB.net_income || 0));
    const deltaPct = pnlB.net_income === 0 ? null : round2((delta / Math.abs(pnlB.net_income)) * 100);
    return { period_a: { start: rangeStartA, end: rangeEndA, net_income: pnlA.net_income, revenue: pnlA.total_revenue }, period_b: { start: rangeStartB, end: rangeEndB, net_income: pnlB.net_income, revenue: pnlB.total_revenue }, delta, delta_pct: deltaPct };
  } catch (e: any) { return { error: e.message }; }
}

// F803: Year-over-year comparison (this YTD vs last YTD)
export function yearOverYear(currentYear: number) {
  try {
    const todayStr = today();
    const startCurrent = `${currentYear}-01-01`;
    const startPrior = `${currentYear - 1}-01-01`;
    const endPrior = `${currentYear - 1}-${todayStr.slice(5, 10)}`;
    return periodOverPeriod(startCurrent, todayStr, startPrior, endPrior);
  } catch (e: any) { return { error: e.message }; }
}

// F804: Quarter-over-quarter
export function quarterOverQuarter(year: number, quarter: number) {
  try {
    const qStart = (y: number, q: number) => `${y}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`;
    const qEnd = (y: number, q: number) => {
      const d = new Date(Date.UTC(y, q * 3, 0));
      return d.toISOString().slice(0, 10);
    };
    const cur = { start: qStart(year, quarter), end: qEnd(year, quarter) };
    const prev = quarter === 1 ? { start: qStart(year - 1, 4), end: qEnd(year - 1, 4) } : { start: qStart(year, quarter - 1), end: qEnd(year, quarter - 1) };
    return periodOverPeriod(cur.start, cur.end, prev.start, prev.end);
  } catch (e: any) { return { error: e.message }; }
}

// F805: Cohort analysis trigger (calls dynamic-features wave's cohort builder if present)
export function buildCohortReport(rangeStart: string, rangeEnd: string) {
  try {
    const cid = db.getCurrentCompanyId();
    const rows = db.getDb().prepare(`SELECT substr(issue_date, 1, 7) cohort_month, COUNT(DISTINCT client_id) clients, SUM(total) revenue FROM invoices WHERE company_id = ? AND issue_date BETWEEN ? AND ? GROUP BY cohort_month ORDER BY cohort_month`).all(cid, rangeStart, rangeEnd) as any[];
    return { cohorts: rows.map(r => ({ ...r, revenue: round2(r.revenue || 0) })) };
  } catch (e: any) { return { error: e.message }; }
}

// F806: Top/bottom contributors (top 10 customers by revenue, etc.)
export function topContributors(metric: 'revenue' | 'expense' | 'invoices', rangeStart: string, rangeEnd: string, limit = 10) {
  try {
    const cid = db.getCurrentCompanyId();
    if (metric === 'revenue') {
      return db.getDb().prepare(`SELECT c.id, c.name, SUM(i.total) total FROM invoices i LEFT JOIN clients c ON i.client_id = c.id WHERE i.company_id = ? AND i.issue_date BETWEEN ? AND ? GROUP BY c.id, c.name ORDER BY total DESC LIMIT ?`).all(cid, rangeStart, rangeEnd, limit);
    }
    if (metric === 'expense') {
      return db.getDb().prepare(`SELECT v.id, v.name, SUM(e.amount) total FROM expenses e LEFT JOIN vendors v ON e.vendor_id = v.id WHERE e.company_id = ? AND e.date BETWEEN ? AND ? GROUP BY v.id, v.name ORDER BY total DESC LIMIT ?`).all(cid, rangeStart, rangeEnd, limit);
    }
    return db.getDb().prepare(`SELECT c.id, c.name, COUNT(*) count FROM invoices i LEFT JOIN clients c ON i.client_id = c.id WHERE i.company_id = ? AND i.issue_date BETWEEN ? AND ? GROUP BY c.id, c.name ORDER BY count DESC LIMIT ?`).all(cid, rangeStart, rangeEnd, limit);
  } catch (e: any) { return { error: e.message }; }
}

// F807: Save a period_comparison snapshot
export function savePeriodComparison(opts: any) {
  try {
    const id = uuid();
    const delta = round2((opts.value_a || 0) - (opts.value_b || 0));
    const deltaPct = opts.value_b === 0 ? null : round2((delta / Math.abs(opts.value_b)) * 100);
    db.getDb().prepare(`INSERT INTO period_comparisons (id, company_id, comparison_type, period_a_start, period_a_end, period_b_start, period_b_end, metric_key, value_a, value_b, delta, delta_percent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.comparison_type, opts.period_a_start, opts.period_a_end, opts.period_b_start, opts.period_b_end, opts.metric_key || null, opts.value_a, opts.value_b, delta, deltaPct);
    return { id, delta, delta_pct: deltaPct };
  } catch (e: any) { return { error: e.message }; }
}

// F808: List recent variance analyses
export function listVarianceAnalyses(limit = 20) {
  try {
    return db.getDb().prepare(`SELECT id, analysis_type, period_actual_start, period_actual_end, variance_amount, variance_percent, generated_at FROM variance_analyses WHERE company_id = ? ORDER BY generated_at DESC LIMIT ?`)
      .all(db.getCurrentCompanyId(), limit);
  } catch (e: any) { return { error: e.message }; }
}

// F809: Flag accounts where actual exceeds budget by N% (drives "over-budget" alerts)
export function overBudgetAccounts(thresholdPercent: number, rangeStart: string, rangeEnd: string) {
  try {
    const variance = actualVsBudget(rangeStart, rangeEnd) as any;
    if (variance.error) return variance;
    return (variance.lines || []).filter((l: any) => l.variance_pct != null && l.variance_pct >= thresholdPercent);
  } catch (e: any) { return { error: e.message }; }
}

// F810: Quick monthly summary card (one-row summary for the dashboard hero)
export function monthlySummaryCard(month?: string) {
  try {
    const m = month || today().slice(0, 7);
    const start = `${m}-01`;
    const endD = new Date(Date.UTC(parseInt(m.slice(0, 4)), parseInt(m.slice(5, 7)), 0));
    const end = endD.toISOString().slice(0, 10);
    const pnl = generateProfitAndLoss(start, end) as any;
    const cash = cashPositionSummary() as any;
    const ar = generateArAging() as any;
    return { month: m, revenue: pnl.total_revenue, expense: pnl.total_expense, net_income: pnl.net_income, cash_on_hand: cash.total, ar_total: round2(Object.values(ar.buckets || {}).reduce((s: number, v: any) => s + (v as number), 0)) };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch RH: Dashboard Layouts (F811-F820)
// ════════════════════════════════════════════════════════════════════

// F811: Create a dashboard
export function createDashboard(opts: any) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO dashboards (id, company_id, name, slug, layout, columns, owner_user_id, visibility, is_default, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.name, opts.slug || null, opts.layout || 'grid', opts.columns || 12, opts.owner_user_id || null, opts.visibility || 'private', opts.is_default ? 1 : 0, opts.description || null);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F812: Add a widget to a dashboard
export function addWidget(opts: any) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO dashboard_widgets (id, company_id, dashboard_id, widget_type, title, kpi_key, report_definition_id, config_json, position_x, position_y, width, height, refresh_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.dashboard_id, opts.widget_type, opts.title || null, opts.kpi_key || null, opts.report_definition_id || null, JSON.stringify(opts.config || {}), opts.position_x || 0, opts.position_y || 0, opts.width || 4, opts.height || 3, opts.refresh_seconds || 0);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F813: Update widget position/size (drag-to-rearrange)
export function moveWidget(widgetId: string, x: number, y: number, width?: number, height?: number) {
  try {
    const sets = ['position_x = ?', 'position_y = ?']; const vals: any[] = [x, y];
    if (width !== undefined) { sets.push('width = ?'); vals.push(width); }
    if (height !== undefined) { sets.push('height = ?'); vals.push(height); }
    sets.push('updated_at = ?'); vals.push(now());
    vals.push(widgetId, db.getCurrentCompanyId());
    db.getDb().prepare(`UPDATE dashboard_widgets SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`).run(...vals);
    return { moved: true };
  } catch (e: any) { return { error: e.message }; }
}

// F814: Get a dashboard with all widgets + each widget's live data
export function loadDashboard(dashboardId: string) {
  try {
    const d = db.getDb().prepare('SELECT * FROM dashboards WHERE id = ? AND company_id = ?').get(dashboardId, db.getCurrentCompanyId()) as any;
    if (!d) return { error: 'Dashboard not found' };
    const widgets = db.getDb().prepare('SELECT * FROM dashboard_widgets WHERE dashboard_id = ? AND company_id = ? ORDER BY position_y, position_x').all(dashboardId, db.getCurrentCompanyId()) as any[];
    const hydrated = widgets.map((w: any) => {
      let data: any = null;
      if (w.widget_type === 'kpi' && w.kpi_key) data = getKpiCurrent(w.kpi_key);
      else if (w.widget_type === 'kpi_trend' && w.kpi_key) data = getKpiTimeSeries(w.kpi_key, { limit: 30 });
      else if (w.widget_type === 'report' && w.report_definition_id) data = runReport(w.report_definition_id, {});
      return { ...w, config: JSON.parse(w.config_json || '{}'), data };
    });
    return { ...d, widgets: hydrated };
  } catch (e: any) { return { error: e.message }; }
}

// F815: List dashboards (filtered by visibility)
export function listDashboards(userId?: string) {
  try {
    return db.getDb().prepare(`SELECT * FROM dashboards WHERE company_id = ? AND (visibility = 'company' OR visibility = 'team' OR owner_user_id = ?) ORDER BY is_default DESC, name`)
      .all(db.getCurrentCompanyId(), userId || '');
  } catch (e: any) { return { error: e.message }; }
}

// F816: Delete a dashboard (cascades widgets)
export function deleteDashboard(id: string) {
  try {
    const cid = db.getCurrentCompanyId();
    db.getDb().prepare('DELETE FROM dashboard_widgets WHERE dashboard_id = ? AND company_id = ?').run(id, cid);
    db.getDb().prepare('DELETE FROM dashboards WHERE id = ? AND company_id = ?').run(id, cid);
    return { deleted: true };
  } catch (e: any) { return { error: e.message }; }
}

// F817: Save a dashboard version (snapshot the layout for rollback)
export function saveDashboardVersion(dashboardId: string, savedBy?: string, note?: string) {
  try {
    const widgets = db.getDb().prepare('SELECT * FROM dashboard_widgets WHERE dashboard_id = ? AND company_id = ?').all(dashboardId, db.getCurrentCompanyId());
    const versionCount = (db.getDb().prepare('SELECT COUNT(*) c FROM dashboard_versions WHERE dashboard_id = ? AND company_id = ?').get(dashboardId, db.getCurrentCompanyId()) as any).c || 0;
    const id = uuid();
    db.getDb().prepare(`INSERT INTO dashboard_versions (id, company_id, dashboard_id, version_number, snapshot_json, saved_by, note) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), dashboardId, versionCount + 1, JSON.stringify(widgets), savedBy || null, note || null);
    return { id, version_number: versionCount + 1 };
  } catch (e: any) { return { error: e.message }; }
}

// F818: Restore a dashboard version (replace current widgets with snapshot)
export function restoreDashboardVersion(versionId: string) {
  try {
    const v = db.getDb().prepare('SELECT * FROM dashboard_versions WHERE id = ? AND company_id = ?').get(versionId, db.getCurrentCompanyId()) as any;
    if (!v) return { error: 'Version not found' };
    db.getDb().prepare('DELETE FROM dashboard_widgets WHERE dashboard_id = ? AND company_id = ?').run(v.dashboard_id, db.getCurrentCompanyId());
    const widgets = JSON.parse(v.snapshot_json || '[]');
    for (const w of widgets) {
      db.getDb().prepare(`INSERT INTO dashboard_widgets (id, company_id, dashboard_id, widget_type, title, kpi_key, report_definition_id, config_json, position_x, position_y, width, height, refresh_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(uuid(), db.getCurrentCompanyId(), v.dashboard_id, w.widget_type, w.title, w.kpi_key, w.report_definition_id, w.config_json, w.position_x, w.position_y, w.width, w.height, w.refresh_seconds);
    }
    return { restored: true, widget_count: widgets.length };
  } catch (e: any) { return { error: e.message }; }
}

// F819: Share a dashboard with a user or role
export function shareDashboard(opts: any) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO dashboard_shares (id, company_id, dashboard_id, shared_with_user_id, shared_with_role, permission_level, shared_by) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.dashboard_id, opts.user_id || null, opts.role || null, opts.permission_level || 'view', opts.shared_by || null);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F820: Remove a widget
export function removeWidget(widgetId: string) {
  try {
    db.getDb().prepare(`DELETE FROM dashboard_widgets WHERE id = ? AND company_id = ?`).run(widgetId, db.getCurrentCompanyId());
    return { deleted: true };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch RI: Executive Summary & Narrative (F821-F830)
// ════════════════════════════════════════════════════════════════════

// F821: Generate an executive summary for a period (auto-narrative)
export function generateExecutiveSummary(rangeStart: string, rangeEnd: string) {
  try {
    const pnl = generateProfitAndLoss(rangeStart, rangeEnd) as any;
    const cash = cashPositionSummary() as any;
    const ar = generateArAging() as any;
    const wc = workingCapital() as any;
    const highlights: string[] = [];
    const risks: string[] = [];
    const recs: string[] = [];

    if (pnl.net_income > 0) highlights.push(`Net income of $${pnl.net_income.toLocaleString()} on $${(pnl.total_revenue || 0).toLocaleString()} revenue.`);
    if (pnl.net_income < 0) risks.push(`Period loss of $${Math.abs(pnl.net_income).toLocaleString()}.`);
    if ((ar.buckets?.b90plus || 0) > 0) risks.push(`$${ar.buckets.b90plus.toLocaleString()} in AR is 90+ days overdue.`);
    if ((cash.total || 0) < (pnl.total_expense || 0) / 3) risks.push(`Cash on hand is less than one month of expenses.`);
    if ((wc.working_capital || 0) < 0) risks.push(`Negative working capital: current liabilities exceed current assets by $${Math.abs(wc.working_capital).toLocaleString()}.`);
    if ((ar.buckets?.b90plus || 0) > 0) recs.push(`Initiate collections on the $${ar.buckets.b90plus.toLocaleString()} 90+ day AR balance.`);
    if (pnl.total_expense > pnl.total_revenue * 0.8) recs.push(`Operating expenses are ${round2((pnl.total_expense / pnl.total_revenue) * 100)}% of revenue — review cost structure.`);

    const summary = `For the period ${rangeStart} to ${rangeEnd}, the business posted ${pnl.net_income >= 0 ? 'a profit' : 'a loss'} of $${pnl.net_income.toLocaleString()} on $${(pnl.total_revenue || 0).toLocaleString()} of revenue. Cash on hand stands at $${(cash.total || 0).toLocaleString()}.`;

    const id = uuid();
    db.getDb().prepare(`INSERT INTO exec_summaries (id, company_id, period_start, period_end, summary_markdown, highlights_json, risks_json, recommendations_json, generated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'auto')`)
      .run(id, db.getCurrentCompanyId(), rangeStart, rangeEnd, summary, JSON.stringify(highlights), JSON.stringify(risks), JSON.stringify(recs));
    return { id, summary, highlights, risks, recommendations: recs, metrics: { pnl, cash, ar, working_capital: wc } };
  } catch (e: any) { return { error: e.message }; }
}

// F822: Update an exec summary (after human review)
export function updateExecutiveSummary(id: string, patch: { summary_markdown?: string; delivered_to?: string[] }) {
  try {
    const sets: string[] = []; const vals: any[] = [];
    if (patch.summary_markdown !== undefined) { sets.push('summary_markdown = ?'); vals.push(patch.summary_markdown); }
    if (patch.delivered_to !== undefined) { sets.push('delivered_to_json = ?'); vals.push(JSON.stringify(patch.delivered_to)); }
    if (sets.length === 0) return { skipped: true };
    sets.push('updated_at = ?'); vals.push(now());
    vals.push(id, db.getCurrentCompanyId());
    db.getDb().prepare(`UPDATE exec_summaries SET ${sets.join(', ')} WHERE id = ? AND company_id = ?`).run(...vals);
    return { updated: true };
  } catch (e: any) { return { error: e.message }; }
}

// F823: List exec summaries
export function listExecutiveSummaries(limit = 20) {
  try {
    return db.getDb().prepare(`SELECT id, period_start, period_end, generated_by, created_at FROM exec_summaries WHERE company_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(db.getCurrentCompanyId(), limit);
  } catch (e: any) { return { error: e.message }; }
}

// F824: Get an exec summary by id
export function getExecutiveSummary(id: string) {
  try {
    const r = db.getDb().prepare('SELECT * FROM exec_summaries WHERE id = ? AND company_id = ?').get(id, db.getCurrentCompanyId()) as any;
    if (!r) return null;
    return { ...r, highlights: JSON.parse(r.highlights_json || '[]'), risks: JSON.parse(r.risks_json || '[]'), recommendations: JSON.parse(r.recommendations_json || '[]') };
  } catch (e: any) { return { error: e.message }; }
}

// F825: Auto-generate a monthly exec summary (called by scheduler)
export function autoGenerateMonthlySummary(month?: string) {
  try {
    const m = month || today().slice(0, 7);
    const start = `${m}-01`;
    const end = new Date(Date.UTC(parseInt(m.slice(0, 4)), parseInt(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
    return generateExecutiveSummary(start, end);
  } catch (e: any) { return { error: e.message }; }
}

// F826: Add an annotation to a report run or dashboard widget
export function addAnnotation(opts: any) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO report_annotations (id, company_id, report_run_id, dashboard_id, widget_id, user_id, body, anchor_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.report_run_id || null, opts.dashboard_id || null, opts.widget_id || null, opts.user_id || null, opts.body, JSON.stringify(opts.anchor || {}));
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F827: List annotations on a report run or widget
export function listAnnotations(opts: { report_run_id?: string; widget_id?: string; dashboard_id?: string }) {
  try {
    const where: string[] = ['company_id = ?']; const params: any[] = [db.getCurrentCompanyId()];
    if (opts.report_run_id) { where.push('report_run_id = ?'); params.push(opts.report_run_id); }
    if (opts.widget_id) { where.push('widget_id = ?'); params.push(opts.widget_id); }
    if (opts.dashboard_id) { where.push('dashboard_id = ?'); params.push(opts.dashboard_id); }
    return db.getDb().prepare(`SELECT * FROM report_annotations WHERE ${where.join(' AND ')} ORDER BY created_at`).all(...params);
  } catch (e: any) { return { error: e.message }; }
}

// F828: Delete an annotation
export function deleteAnnotation(id: string) {
  try {
    db.getDb().prepare(`DELETE FROM report_annotations WHERE id = ? AND company_id = ?`).run(id, db.getCurrentCompanyId());
    return { deleted: true };
  } catch (e: any) { return { error: e.message }; }
}

// F829: Set up a report-driven alert (trigger when KPI crosses threshold)
export function createReportAlert(opts: any) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO report_alerts (id, company_id, kpi_key, report_definition_id, rule_type, threshold_value, comparison_op, notify_channel, recipients_json, cooldown_minutes, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
      .run(id, db.getCurrentCompanyId(), opts.kpi_key || null, opts.report_definition_id || null, opts.rule_type, opts.threshold_value || null, opts.comparison_op || '<', opts.notify_channel || 'in_app', JSON.stringify(opts.recipients || []), opts.cooldown_minutes || 60);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F830: Evaluate alerts (called by scheduler — fires events when conditions met)
export function evaluateAlerts() {
  try {
    const cid = db.getCurrentCompanyId();
    const alerts = db.getDb().prepare(`SELECT * FROM report_alerts WHERE company_id = ? AND active = 1`).all(cid) as any[];
    const fired: any[] = [];
    for (const a of alerts) {
      if (a.last_triggered_at) {
        const cooldownEnd = new Date(a.last_triggered_at).getTime() + (a.cooldown_minutes || 60) * 60000;
        if (Date.now() < cooldownEnd) continue;
      }
      if (a.kpi_key) {
        const cur = getKpiCurrent(a.kpi_key) as any;
        const v = cur?.current?.value;
        if (v == null) continue;
        const op = a.comparison_op;
        const t = a.threshold_value;
        const trigger = (op === '<' && v < t) || (op === '<=' && v <= t) || (op === '>' && v > t) || (op === '>=' && v >= t) || (op === '=' && v === t);
        if (trigger) {
          const eventId = uuid();
          db.getDb().prepare(`INSERT INTO report_alert_events (id, company_id, alert_id, fired_at, observed_value, notified_count) VALUES (?, ?, ?, ?, ?, ?)`)
            .run(eventId, cid, a.id, now(), v, (JSON.parse(a.recipients_json || '[]')).length);
          db.getDb().prepare(`UPDATE report_alerts SET last_triggered_at = ?, updated_at = ? WHERE id = ?`).run(now(), now(), a.id);
          fired.push({ alert_id: a.id, kpi: a.kpi_key, value: v, threshold: t });
        }
      }
    }
    return { evaluated: alerts.length, fired_count: fired.length, fired };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch RJ: Export, Snapshots & Sharing (F831-F840)
// ════════════════════════════════════════════════════════════════════

// F831: Export a report run to CSV
export function exportRunToCsv(runId: string): { path?: string; error?: string } {
  try {
    const rows = (getReportRunRows(runId, 0, 100000) as any).rows || [];
    if (rows.length === 0) return { error: 'No rows to export' };
    const headers = Object.keys(rows[0]);
    const escape = (v: any) => v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
    const csv = [headers.join(','), ...rows.map((r: any) => headers.map((h: string) => escape(r[h])).join(','))].join('\n');
    const outputPath = path.join(exportsDir(), `${runId}.csv`);
    fs.writeFileSync(outputPath, csv);
    const id = uuid();
    db.getDb().prepare(`INSERT INTO report_export_jobs (id, company_id, report_run_id, format, output_path, size_bytes, status, started_at, finished_at) VALUES (?, ?, ?, 'csv', ?, ?, 'success', ?, ?)`)
      .run(id, db.getCurrentCompanyId(), runId, outputPath, Buffer.byteLength(csv), now(), now());
    return { path: outputPath };
  } catch (e: any) { return { error: e.message }; }
}

// F832: Export a report run to HTML (pretty table for email body)
export function exportRunToHtml(runId: string, title?: string) {
  try {
    const rows = (getReportRunRows(runId, 0, 100000) as any).rows || [];
    if (rows.length === 0) return { error: 'No rows to export' };
    const headers = Object.keys(rows[0]);
    const escape = (v: any) => v == null ? '' : String(v).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string));
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escape(title || 'Report')}</title><style>body{font-family:system-ui,-apple-system,sans-serif;padding:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:8px 12px;text-align:left;font-size:14px}th{background:#f5f5f5;font-weight:600}tr:nth-child(even){background:#fafafa}</style></head><body><h1>${escape(title || 'Report')}</h1><table><thead><tr>${headers.map(h => `<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r: any) => `<tr>${headers.map((h: string) => `<td>${escape(r[h])}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
    const outputPath = path.join(exportsDir(), `${runId}.html`);
    fs.writeFileSync(outputPath, html);
    return { path: outputPath };
  } catch (e: any) { return { error: e.message }; }
}

// F833: Take a "pin" snapshot — caches an expensive aggregation for fast subsequent reads
export function pinSnapshot(key: string, valueGenerator: () => any, ttlSeconds = 3600) {
  try {
    const cid = db.getCurrentCompanyId();
    const value = valueGenerator();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    db.getDb().prepare(`INSERT INTO report_pin_cache (id, company_id, cache_key, cache_value_json, expires_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(company_id, cache_key) DO UPDATE SET cache_value_json = excluded.cache_value_json, expires_at = excluded.expires_at`)
      .run(uuid(), cid, key, JSON.stringify(value), expiresAt);
    return { cached: true, expires_at: expiresAt, value };
  } catch (e: any) { return { error: e.message }; }
}

// F834: Read a pinned snapshot (returns null if expired)
export function getPinnedSnapshot(key: string) {
  try {
    const row = db.getDb().prepare(`SELECT * FROM report_pin_cache WHERE company_id = ? AND cache_key = ?`).get(db.getCurrentCompanyId(), key) as any;
    if (!row) return null;
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
    return JSON.parse(row.cache_value_json || 'null');
  } catch (e: any) { return { error: e.message }; }
}

// F835: Pin a report or dashboard to user favorites
export function pinFavorite(opts: { user_id: string; report_definition_id?: string; dashboard_id?: string; pinned_order?: number }) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO report_favorites (id, company_id, user_id, report_definition_id, dashboard_id, pinned_order) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.user_id, opts.report_definition_id || null, opts.dashboard_id || null, opts.pinned_order || 0);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F836: List user's favorite reports + dashboards
export function listFavorites(userId: string) {
  try {
    return db.getDb().prepare(`SELECT * FROM report_favorites WHERE company_id = ? AND user_id = ? ORDER BY pinned_order, created_at`)
      .all(db.getCurrentCompanyId(), userId);
  } catch (e: any) { return { error: e.message }; }
}

// F837: Subscribe user to a report's in-app notification feed
export function subscribeToReport(opts: any) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO report_subscriptions (id, company_id, user_id, report_definition_id, dashboard_id, delivery_channel, cadence, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`)
      .run(id, db.getCurrentCompanyId(), opts.user_id, opts.report_definition_id || null, opts.dashboard_id || null, opts.delivery_channel || 'in_app', opts.cadence || 'daily');
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F838: Log a report-related audit event
export function logReportAuditEvent(opts: { user_id?: string; action: string; entity_type: string; entity_id: string; metadata?: any }) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO report_audit_log (id, company_id, user_id, action, entity_type, entity_id, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.user_id || null, opts.action, opts.entity_type, opts.entity_id, JSON.stringify(opts.metadata || {}));
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F839: Get the report audit log (who viewed/edited/exported what)
export function getReportAuditLog(filter?: { user_id?: string; action?: string; limit?: number }) {
  try {
    const where: string[] = ['company_id = ?']; const params: any[] = [db.getCurrentCompanyId()];
    if (filter?.user_id) { where.push('user_id = ?'); params.push(filter.user_id); }
    if (filter?.action) { where.push('action = ?'); params.push(filter.action); }
    params.push(filter?.limit || 100);
    return db.getDb().prepare(`SELECT * FROM report_audit_log WHERE ${where.join(' AND ')} ORDER BY logged_at DESC LIMIT ?`).all(...params);
  } catch (e: any) { return { error: e.message }; }
}

// F840: Build a "performance card" for a report — avg run time, failure rate, last 30 runs
export function reportPerformanceCard(reportId: string) {
  try {
    const runs = db.getDb().prepare(`SELECT status, elapsed_ms, started_at FROM report_runs WHERE report_definition_id = ? AND company_id = ? ORDER BY started_at DESC LIMIT 30`).all(reportId, db.getCurrentCompanyId()) as any[];
    if (runs.length === 0) return { report_id: reportId, runs_count: 0 };
    const successes = runs.filter(r => r.status === 'success');
    const avgMs = successes.length === 0 ? 0 : Math.round(successes.reduce((s, r) => s + (r.elapsed_ms || 0), 0) / successes.length);
    const failureRate = round2(((runs.length - successes.length) / runs.length) * 100);
    return { report_id: reportId, runs_count: runs.length, avg_elapsed_ms: avgMs, failure_rate_pct: failureRate, last_run_at: runs[0]?.started_at, runs };
  } catch (e: any) { return { error: e.message }; }
}
