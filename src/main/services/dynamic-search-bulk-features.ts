// ─── Dynamic Wave Part 1: F261-F300 (40 features) ───
//
// Batch J: Global Search & Find (F261-F270)
// Batch K: Notifications & Alerts (F271-F280)
// Batch L: Import / Export Engines (F281-F290)
// Batch M: Bulk Actions Engine (F291-F300)

import { randomUUID as uuid } from 'crypto';
import * as db from '../database';

const now = (): string => new Date().toISOString();
const today = (): string => now().slice(0, 10);

// ════════════════════════════════════════════════════════════════
// Batch J: Global Search & Find (F261-F270)
// ════════════════════════════════════════════════════════════════

// F261 — globalSearch: ranks results across multiple entity types
export function globalSearch(companyId: string, query: string, opts?: { limit?: number; entity_types?: string[] }): Array<{ type: string; id: string; label: string; secondary?: string; rank: number }> {
  const dbi = db.getDb();
  const q = `%${query.toLowerCase()}%`;
  const limit = Math.min(opts?.limit || 25, 200);
  const types = opts?.entity_types || ['client', 'vendor', 'invoice', 'expense', 'bill', 'account', 'project', 'asset'];
  const results: any[] = [];

  const search = (type: string, sql: string, params: any[]) => {
    try {
      const rows = dbi.prepare(sql).all(...params) as any[];
      for (const r of rows) {
        results.push({ type, id: r.id, label: r.label, secondary: r.secondary, rank: r.rank || 1 });
      }
    } catch {}
  };

  if (types.includes('client')) {
    search('client', `SELECT id, name AS label, email AS secondary, (CASE WHEN LOWER(name) LIKE ? THEN 3 ELSE 1 END) AS rank FROM clients WHERE company_id = ? AND (LOWER(name) LIKE ? OR LOWER(email) LIKE ?) AND (deleted_at IS NULL OR deleted_at = '') LIMIT 10`, [`%${query.toLowerCase()}%`, companyId, q, q]);
  }
  if (types.includes('vendor')) {
    search('vendor', `SELECT id, name AS label, email AS secondary, 1 AS rank FROM vendors WHERE company_id = ? AND (LOWER(name) LIKE ? OR LOWER(email) LIKE ?) AND (deleted_at IS NULL OR deleted_at = '') LIMIT 10`, [companyId, q, q]);
  }
  if (types.includes('invoice')) {
    search('invoice', `SELECT id, invoice_number AS label, status AS secondary, 2 AS rank FROM invoices WHERE company_id = ? AND (LOWER(invoice_number) LIKE ? OR LOWER(notes) LIKE ?) AND (deleted_at IS NULL OR deleted_at = '') LIMIT 10`, [companyId, q, q]);
  }
  if (types.includes('expense')) {
    search('expense', `SELECT id, description AS label, date AS secondary, 1 AS rank FROM expenses WHERE company_id = ? AND LOWER(description) LIKE ? AND (deleted_at IS NULL OR deleted_at = '') LIMIT 10`, [companyId, q]);
  }
  if (types.includes('bill')) {
    search('bill', `SELECT id, bill_number AS label, status AS secondary, 1 AS rank FROM bills WHERE company_id = ? AND (LOWER(bill_number) LIKE ? OR LOWER(notes) LIKE ?) AND (deleted_at IS NULL OR deleted_at = '') LIMIT 10`, [companyId, q, q]);
  }
  if (types.includes('account')) {
    search('account', `SELECT id, name AS label, code AS secondary, 1 AS rank FROM accounts WHERE company_id = ? AND (LOWER(name) LIKE ? OR LOWER(code) LIKE ?) AND (deleted_at IS NULL OR deleted_at = '') LIMIT 10`, [companyId, q, q]);
  }
  if (types.includes('project')) {
    search('project', `SELECT id, name AS label, status AS secondary, 1 AS rank FROM projects WHERE company_id = ? AND LOWER(name) LIKE ? AND (deleted_at IS NULL OR deleted_at = '') LIMIT 10`, [companyId, q]);
  }
  if (types.includes('asset')) {
    search('asset', `SELECT id, name AS label, asset_code AS secondary, 1 AS rank FROM fixed_assets WHERE company_id = ? AND (LOWER(name) LIKE ? OR LOWER(asset_code) LIKE ?) LIMIT 10`, [companyId, q, q]);
  }

  return results.sort((a, b) => b.rank - a.rank).slice(0, limit);
}

// F262 — recordSearchHistory
export function recordSearchHistory(userId: string, companyId: string | null, query: string, resultCount: number): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO search_history (id, user_id, company_id, query, result_count, searched_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, userId, companyId, query, resultCount, now());
  return { id };
}

// F263 — listRecentSearches
export function listRecentSearches(userId: string, limit: number = 10): any[] {
  return db.getDb().prepare(`SELECT DISTINCT query, MAX(searched_at) AS searched_at, MAX(result_count) AS result_count FROM search_history WHERE user_id = ? GROUP BY query ORDER BY searched_at DESC LIMIT ?`).all(userId, Math.min(limit, 100)) as any[];
}

// F264 — listRecentlyViewed
export function listRecentlyViewed(userId: string, opts?: { entity_type?: string; limit?: number }): any[] {
  const dbi = db.getDb();
  const params: any[] = [userId];
  let where = 'user_id = ?';
  if (opts?.entity_type) { where += ' AND entity_type = ?'; params.push(opts.entity_type); }
  return dbi.prepare(`SELECT DISTINCT entity_type, entity_id, entity_label, MAX(viewed_at) AS viewed_at FROM recently_viewed_entities WHERE ${where} GROUP BY entity_type, entity_id ORDER BY viewed_at DESC LIMIT ?`).all(...params, Math.min(opts?.limit || 20, 100)) as any[];
}

// F265 — recordEntityView
export function recordEntityView(userId: string, companyId: string, entityType: string, entityId: string, entityLabel?: string): void {
  const dbi = db.getDb();
  dbi.prepare(`INSERT INTO recently_viewed_entities (id, user_id, company_id, entity_type, entity_id, entity_label, viewed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(uuid(), userId, companyId, entityType, entityId, entityLabel || null, now());
  // Trim to last 500 entries per user
  dbi.prepare(`DELETE FROM recently_viewed_entities WHERE user_id = ? AND id NOT IN (SELECT id FROM recently_viewed_entities WHERE user_id = ? ORDER BY viewed_at DESC LIMIT 500)`).run(userId, userId);
}

// F266 — pinEntity
export function pinEntity(userId: string, companyId: string, entityType: string, entityId: string, entityLabel?: string): { id: string; was_already_pinned: boolean } {
  const dbi = db.getDb();
  const existing = dbi.prepare(`SELECT id FROM pinned_entities WHERE user_id = ? AND entity_type = ? AND entity_id = ?`).get(userId, entityType, entityId) as any;
  if (existing) return { id: existing.id, was_already_pinned: true };
  const id = uuid();
  dbi.prepare(`INSERT INTO pinned_entities (id, user_id, company_id, entity_type, entity_id, entity_label, pinned_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, userId, companyId, entityType, entityId, entityLabel || null, now());
  return { id, was_already_pinned: false };
}

export function unpinEntity(userId: string, entityType: string, entityId: string): boolean {
  const r = db.getDb().prepare(`DELETE FROM pinned_entities WHERE user_id = ? AND entity_type = ? AND entity_id = ?`).run(userId, entityType, entityId);
  return r.changes > 0;
}

// F267 — listPinnedEntities
export function listPinnedEntities(userId: string, entityType?: string): any[] {
  const dbi = db.getDb();
  const params: any[] = [userId];
  let where = 'user_id = ?';
  if (entityType) { where += ' AND entity_type = ?'; params.push(entityType); }
  return dbi.prepare(`SELECT * FROM pinned_entities WHERE ${where} ORDER BY pinned_at DESC`).all(...params) as any[];
}

// F268 — searchByPattern (entity-specific with regex-like LIKE)
export function searchByPattern(companyId: string, pattern: string, entityType: string, opts?: { limit?: number }): any[] {
  return globalSearch(companyId, pattern, { limit: opts?.limit || 50, entity_types: [entityType] });
}

// F269 — fuzzyMatchEntity (Levenshtein-light: tokens overlap)
export function fuzzyMatchEntity(companyId: string, name: string, entityType: 'client' | 'vendor' = 'vendor', threshold: number = 0.5): Array<{ id: string; name: string; score: number }> {
  const dbi = db.getDb();
  const table = entityType === 'client' ? 'clients' : 'vendors';
  const all = dbi.prepare(`SELECT id, name FROM ${table} WHERE company_id = ? AND (deleted_at IS NULL OR deleted_at = '')`).all(companyId) as any[];
  const targetTokens = name.toLowerCase().split(/\W+/).filter(Boolean);
  if (targetTokens.length === 0) return [];
  const results: any[] = [];
  for (const row of all) {
    const tokens = (row.name || '').toLowerCase().split(/\W+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const overlap = targetTokens.filter(t => tokens.some((ot: string) => ot.includes(t) || t.includes(ot))).length;
    const score = overlap / Math.max(targetTokens.length, tokens.length);
    if (score >= threshold) results.push({ id: row.id, name: row.name, score: Math.round(score * 100) / 100 });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 10);
}

// F270 — crossReferenceEntity (find related entities)
export function crossReferenceEntity(companyId: string, entityType: string, entityId: string): { invoices: any[]; expenses: any[]; bills: any[]; payments: any[] } {
  const dbi = db.getDb();
  const result = { invoices: [] as any[], expenses: [] as any[], bills: [] as any[], payments: [] as any[] };
  try {
    if (entityType === 'client') {
      result.invoices = dbi.prepare(`SELECT id, invoice_number, total, status FROM invoices WHERE company_id = ? AND client_id = ? AND (deleted_at IS NULL OR deleted_at = '') ORDER BY issue_date DESC LIMIT 50`).all(companyId, entityId) as any[];
    } else if (entityType === 'vendor') {
      result.bills = dbi.prepare(`SELECT id, bill_number, total, status FROM bills WHERE company_id = ? AND vendor_id = ? AND (deleted_at IS NULL OR deleted_at = '') ORDER BY bill_date DESC LIMIT 50`).all(companyId, entityId) as any[];
      result.expenses = dbi.prepare(`SELECT id, description, amount, date FROM expenses WHERE company_id = ? AND vendor_id = ? AND (deleted_at IS NULL OR deleted_at = '') ORDER BY date DESC LIMIT 50`).all(companyId, entityId) as any[];
    } else if (entityType === 'invoice') {
      result.payments = dbi.prepare(`SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC`).all(entityId) as any[];
    }
  } catch {}
  return result;
}

// ════════════════════════════════════════════════════════════════
// Batch K: Notifications & Alerts (F271-F280)
// ════════════════════════════════════════════════════════════════

// F271 — createNotification
export function createNotification(opts: { user_id: string; company_id?: string; type: string; title: string; body?: string; entity_type?: string; entity_id?: string; priority?: string; action_url?: string }): { id: string } {
  const dbi = db.getDb();
  const id = uuid();
  try {
    dbi.prepare(`INSERT INTO notifications (id, user_id, company_id, notification_type, title, body, entity_type, entity_id, priority, action_url, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`)
      .run(id, opts.user_id, opts.company_id || null, opts.type, opts.title, opts.body || null, opts.entity_type || null, opts.entity_id || null, opts.priority || 'normal', opts.action_url || null, now());
  } catch (e: any) {
    // Some schemas use different column names; try a minimal insert
    dbi.prepare(`INSERT INTO notifications (id, user_id, notification_type, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, opts.user_id, opts.type, opts.title, opts.body || null, now());
  }
  return { id };
}

// F272 — listUserNotifications
export function listUserNotifications(userId: string, opts?: { unread_only?: boolean; limit?: number }): any[] {
  const dbi = db.getDb();
  const params: any[] = [userId];
  let where = `user_id = ? AND (snoozed_until IS NULL OR snoozed_until < datetime('now'))`;
  if (opts?.unread_only) where += ' AND is_read = 0';
  return dbi.prepare(`SELECT * FROM notifications WHERE ${where} ORDER BY created_at DESC LIMIT ?`).all(...params, Math.min(opts?.limit || 50, 500)) as any[];
}

// F273 — markNotificationRead
export function markNotificationRead(id: string): boolean {
  const r = db.getDb().prepare(`UPDATE notifications SET is_read = 1 WHERE id = ?`).run(id);
  return r.changes > 0;
}

// F274 — markAllRead
export function markAllRead(userId: string): number {
  return db.getDb().prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0`).run(userId).changes;
}

// F275 — snoozeNotification
export function snoozeNotification(id: string, untilDate: string): boolean {
  const r = db.getDb().prepare(`UPDATE notifications SET snoozed_until = ? WHERE id = ?`).run(untilDate, id);
  return r.changes > 0;
}

// F276 — setNotificationPreference
export function setNotificationPreference(opts: { user_id: string; company_id?: string; notification_type: string; channel?: string; is_enabled?: boolean; quiet_hours_start?: string; quiet_hours_end?: string }): { id: string } {
  const dbi = db.getDb();
  const id = uuid();
  dbi.prepare(`INSERT INTO notification_preferences (id, user_id, company_id, notification_type, channel, is_enabled, quiet_hours_start, quiet_hours_end) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, notification_type, channel) DO UPDATE SET is_enabled = excluded.is_enabled, quiet_hours_start = excluded.quiet_hours_start, quiet_hours_end = excluded.quiet_hours_end`)
    .run(id, opts.user_id, opts.company_id || null, opts.notification_type, opts.channel || 'in_app', opts.is_enabled === false ? 0 : 1, opts.quiet_hours_start || null, opts.quiet_hours_end || null);
  return { id };
}

// F277 — getNotificationPrefs
export function getNotificationPrefs(userId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM notification_preferences WHERE user_id = ?`).all(userId) as any[];
}

// F278 — createAlertRule
export function createAlertRule(rule: any): { id: string } {
  const dbi = db.getDb();
  const id = uuid();
  dbi.prepare(`INSERT INTO alert_rules (id, company_id, name, entity_type, criteria_json, action_type, action_config_json, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, rule.company_id, rule.name, rule.entity_type || null, JSON.stringify(rule.criteria || {}), rule.action_type || 'notify', JSON.stringify(rule.action_config || {}), rule.is_active === false ? 0 : 1, now(), now());
  return { id };
}

// F279 — evaluateAlertRules
export function evaluateAlertRules(companyId: string, entityType: string, entityData: any): Array<{ rule_id: string; rule_name: string; matched: boolean }> {
  const dbi = db.getDb();
  const rules = dbi.prepare(`SELECT * FROM alert_rules WHERE company_id = ? AND entity_type = ? AND is_active = 1`).all(companyId, entityType) as any[];
  const matches: any[] = [];
  for (const r of rules) {
    try {
      const crit = JSON.parse(r.criteria_json || '{}');
      const matched = matchesCriteria(entityData, crit);
      if (matched) {
        dbi.prepare(`UPDATE alert_rules SET last_fired_at = ?, fire_count = fire_count + 1 WHERE id = ?`).run(now(), r.id);
        matches.push({ rule_id: r.id, rule_name: r.name, matched: true });
      }
    } catch {}
  }
  return matches;
}

function matchesCriteria(data: any, criteria: any): boolean {
  if (!criteria || typeof criteria !== 'object') return false;
  for (const [field, expected] of Object.entries(criteria)) {
    const actual = data?.[field];
    if (typeof expected === 'object' && expected !== null) {
      const exp: any = expected;
      if ('gt' in exp && !(Number(actual) > exp.gt)) return false;
      if ('lt' in exp && !(Number(actual) < exp.lt)) return false;
      if ('gte' in exp && !(Number(actual) >= exp.gte)) return false;
      if ('lte' in exp && !(Number(actual) <= exp.lte)) return false;
      if ('eq' in exp && actual !== exp.eq) return false;
      if ('contains' in exp && !String(actual || '').toLowerCase().includes(String(exp.contains).toLowerCase())) return false;
    } else if (actual !== expected) return false;
  }
  return true;
}

// F280 — buildDigestEmail
export function buildDigestEmail(userId: string, period: 'daily' | 'weekly' = 'daily'): { user_id: string; period: string; notification_count: number; html: string } {
  const dbi = db.getDb();
  const days = period === 'weekly' ? 7 : 1;
  const notes = dbi.prepare(`SELECT title, body, notification_type, created_at FROM notifications WHERE user_id = ? AND created_at >= datetime('now', '-' || ? || ' days') ORDER BY created_at DESC LIMIT 50`).all(userId, days) as any[];
  const html = `<h2>Your ${period} digest (${notes.length} updates)</h2><ul>${notes.map(n => `<li><strong>${n.title}</strong>${n.body ? `<br/>${n.body}` : ''}</li>`).join('')}</ul>`;
  return { user_id: userId, period, notification_count: notes.length, html };
}

// ════════════════════════════════════════════════════════════════
// Batch L: Import / Export Engines (F281-F290)
// ════════════════════════════════════════════════════════════════

// F281 — parseCSVForImport
export function parseCSVForImport(text: string): { headers: string[]; rows: Array<Record<string, string>>; row_count: number } {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [], row_count: 0 };
  const headers = parseCsvLine(lines[0]);
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = cells[idx] || ''; });
    rows.push(row);
  }
  return { headers, rows, row_count: rows.length };
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { cells.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  cells.push(cur);
  return cells.map(c => c.trim());
}

// F282 — detectColumnMapping (auto-match by name similarity)
export function detectColumnMapping(headers: string[], entityType: 'expense' | 'invoice' | 'client' | 'vendor' | 'bill'): Record<string, string> {
  const targetSchemas: Record<string, string[]> = {
    expense: ['date', 'amount', 'description', 'vendor_id', 'category_id', 'notes'],
    invoice: ['invoice_number', 'client_id', 'total', 'issue_date', 'due_date', 'status'],
    client: ['name', 'email', 'phone', 'address', 'city', 'state', 'zip'],
    vendor: ['name', 'email', 'phone', 'address', 'tax_id'],
    bill: ['bill_number', 'vendor_id', 'total', 'bill_date', 'due_date'],
  };
  const target = targetSchemas[entityType] || [];
  const mapping: Record<string, string> = {};
  for (const header of headers) {
    const normalized = header.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const field of target) {
      const fieldNorm = field.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normalized === fieldNorm || normalized.includes(fieldNorm) || fieldNorm.includes(normalized)) {
        mapping[header] = field;
        break;
      }
    }
  }
  return mapping;
}

// F283 — validateImportRows
export function validateImportRows(rows: Array<Record<string, any>>, mapping: Record<string, string>, entityType: string): { valid: number; invalid: number; errors: Array<{ row: number; field: string; error: string }> } {
  const errors: any[] = [];
  let valid = 0;
  const requiredByEntity: Record<string, string[]> = {
    expense: ['date', 'amount'],
    invoice: ['invoice_number', 'total'],
    client: ['name'],
    vendor: ['name'],
    bill: ['bill_number', 'total'],
  };
  const required = requiredByEntity[entityType] || [];
  rows.forEach((row, i) => {
    let rowValid = true;
    const mapped: Record<string, any> = {};
    for (const [src, tgt] of Object.entries(mapping)) mapped[tgt] = row[src];
    for (const req of required) {
      if (!mapped[req] || String(mapped[req]).trim() === '') {
        errors.push({ row: i + 1, field: req, error: 'Required field missing' });
        rowValid = false;
      }
    }
    if (mapped.amount && isNaN(Number(mapped.amount))) {
      errors.push({ row: i + 1, field: 'amount', error: 'Invalid number' });
      rowValid = false;
    }
    if (rowValid) valid++;
  });
  return { valid, invalid: rows.length - valid, errors };
}

// F284 — saveImportTemplate
export function saveImportTemplate(t: any): { id: string } {
  const dbi = db.getDb();
  const id = uuid();
  dbi.prepare(`INSERT INTO import_templates (id, company_id, name, entity_type, column_mapping_json, default_values_json, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`)
    .run(id, t.company_id, t.name, t.entity_type, JSON.stringify(t.column_mapping || {}), JSON.stringify(t.default_values || {}), now(), now());
  return { id };
}

// F285 — listImportTemplates
export function listImportTemplates(companyId: string, entityType?: string): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ? AND is_active = 1';
  if (entityType) { where += ' AND entity_type = ?'; params.push(entityType); }
  return dbi.prepare(`SELECT * FROM import_templates WHERE ${where} ORDER BY use_count DESC, name`).all(...params) as any[];
}

// F286 — exportToCSV
export function exportToCSV(rows: Array<Record<string, any>>, columns: string[]): string {
  const escape = (val: any) => {
    if (val === null || val === undefined) return '';
    const s = String(val);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const headerLine = columns.join(',');
  const dataLines = rows.map(r => columns.map(c => escape(r[c])).join(','));
  return [headerLine, ...dataLines].join('\n');
}

// F287 — exportToQuickBooksIIF (transaction format)
export function exportToQuickBooksIIF(transactions: Array<{ date: string; account: string; payee: string; amount: number; memo?: string; docnum?: string }>): string {
  const lines = [
    '!TRNS\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO',
    '!SPL\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO',
    '!ENDTRNS',
  ];
  for (const tx of transactions) {
    lines.push(`TRNS\tCHECK\t${tx.date}\t${tx.account}\t${tx.payee}\t${-tx.amount}\t${tx.docnum || ''}\t${tx.memo || ''}`);
    lines.push(`SPL\tCHECK\t${tx.date}\t${tx.account}\t${tx.payee}\t${tx.amount}\t${tx.memo || ''}`);
    lines.push(`ENDTRNS`);
  }
  return lines.join('\n');
}

// F288 — createExportJob
export function createExportJob(j: any): { id: string } {
  const dbi = db.getDb();
  const id = uuid();
  dbi.prepare(`INSERT INTO export_jobs (id, company_id, job_name, entity_type, format, filters_json, schedule_cron, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
    .run(id, j.company_id, j.job_name, j.entity_type, j.format || 'csv', JSON.stringify(j.filters || {}), j.schedule_cron || null, now(), now());
  return { id };
}

// F289 — listExportJobs
export function listExportJobs(companyId: string, activeOnly: boolean = true): any[] {
  const dbi = db.getDb();
  let where = 'company_id = ?';
  if (activeOnly) where += ' AND is_active = 1';
  return dbi.prepare(`SELECT * FROM export_jobs WHERE ${where} ORDER BY job_name`).all(companyId) as any[];
}

// F290 — markExportRun
export function markExportRun(jobId: string, outputPath?: string): boolean {
  const r = db.getDb().prepare(`UPDATE export_jobs SET last_run_at = ?, output_path = ? WHERE id = ?`).run(now(), outputPath || null, jobId);
  return r.changes > 0;
}

// ════════════════════════════════════════════════════════════════
// Batch M: Bulk Actions Engine (F291-F300)
// ════════════════════════════════════════════════════════════════

// F291 — bulkUpdate (with snapshot for undo)
export function bulkUpdate(opts: { company_id: string; user_id?: string; entity_type: string; ids: string[]; fields: Record<string, any> }): { updated: number; snapshot_id: string } {
  const dbi = db.getDb();
  if (!opts.ids || opts.ids.length === 0) return { updated: 0, snapshot_id: '' };
  // Snapshot original data first
  const placeholders = opts.ids.map(() => '?').join(',');
  const original = dbi.prepare(`SELECT * FROM ${opts.entity_type} WHERE id IN (${placeholders})`).all(...opts.ids) as any[];
  const snapshotId = uuid();
  dbi.prepare(`INSERT INTO bulk_undo_snapshots (id, company_id, user_id, operation_type, entity_type, entity_ids, original_data_json, changed_fields_json, undo_expires_at, performed_at) VALUES (?, ?, ?, 'update', ?, ?, ?, ?, datetime('now', '+1 day'), ?)`)
    .run(snapshotId, opts.company_id, opts.user_id || null, opts.entity_type, opts.ids.join(','), JSON.stringify(original), JSON.stringify(opts.fields), now());

  // Build SET clause
  const setClause = Object.keys(opts.fields).map(k => `${k} = ?`).join(', ');
  const values = Object.values(opts.fields);
  const sql = `UPDATE ${opts.entity_type} SET ${setClause} WHERE id IN (${placeholders})`;
  const r = dbi.prepare(sql).run(...values, ...opts.ids);
  return { updated: r.changes, snapshot_id: snapshotId };
}

// F292 — bulkDelete (soft if column exists; with snapshot)
export function bulkDelete(opts: { company_id: string; user_id?: string; entity_type: string; ids: string[]; soft?: boolean }): { deleted: number; snapshot_id: string } {
  const dbi = db.getDb();
  if (!opts.ids || opts.ids.length === 0) return { deleted: 0, snapshot_id: '' };
  const placeholders = opts.ids.map(() => '?').join(',');
  const original = dbi.prepare(`SELECT * FROM ${opts.entity_type} WHERE id IN (${placeholders})`).all(...opts.ids) as any[];
  const snapshotId = uuid();
  dbi.prepare(`INSERT INTO bulk_undo_snapshots (id, company_id, user_id, operation_type, entity_type, entity_ids, original_data_json, undo_expires_at, performed_at) VALUES (?, ?, ?, 'delete', ?, ?, ?, datetime('now', '+1 day'), ?)`)
    .run(snapshotId, opts.company_id, opts.user_id || null, opts.entity_type, opts.ids.join(','), JSON.stringify(original), now());

  let r;
  if (opts.soft) {
    try {
      r = dbi.prepare(`UPDATE ${opts.entity_type} SET deleted_at = ? WHERE id IN (${placeholders})`).run(now(), ...opts.ids);
    } catch {
      r = dbi.prepare(`DELETE FROM ${opts.entity_type} WHERE id IN (${placeholders})`).run(...opts.ids);
    }
  } else {
    r = dbi.prepare(`DELETE FROM ${opts.entity_type} WHERE id IN (${placeholders})`).run(...opts.ids);
  }
  return { deleted: r.changes, snapshot_id: snapshotId };
}

// F293 — bulkArchive (alias for soft-delete with archive intent)
export function bulkArchive(opts: { company_id: string; user_id?: string; entity_type: string; ids: string[] }): { archived: number; snapshot_id: string } {
  const r = bulkDelete({ ...opts, soft: true });
  return { archived: r.deleted, snapshot_id: r.snapshot_id };
}

// F294 — bulkChangeStatus
export function bulkChangeStatus(opts: { company_id: string; user_id?: string; entity_type: string; ids: string[]; status: string }): { updated: number; snapshot_id: string } {
  return bulkUpdate({ ...opts, fields: { status: opts.status } });
}

// F295 — bulkAssign
export function bulkAssign(opts: { company_id: string; user_id?: string; entity_type: string; ids: string[]; assignee_field?: string; assignee_id: string }): { updated: number; snapshot_id: string } {
  const field = opts.assignee_field || 'assigned_to';
  return bulkUpdate({ ...opts, fields: { [field]: opts.assignee_id } });
}

// F296 — bulkTag (uses existing entity_tags table)
export function bulkTag(opts: { company_id: string; entity_type: string; entity_ids: string[]; tag_ids: string[] }): { tagged: number } {
  const dbi = db.getDb();
  let count = 0;
  const insert = dbi.prepare(`INSERT INTO entity_tags (id, company_id, entity_type, entity_id, tag_id, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`);
  const tx = dbi.transaction(() => {
    for (const eId of opts.entity_ids) {
      for (const tId of opts.tag_ids) {
        try {
          const r = insert.run(uuid(), opts.company_id, opts.entity_type, eId, tId, now());
          count += r.changes;
        } catch {}
      }
    }
  });
  tx();
  return { tagged: count };
}

// F297 — bulkUntag
export function bulkUntag(opts: { entity_type: string; entity_ids: string[]; tag_ids: string[] }): { untagged: number } {
  const dbi = db.getDb();
  const eIdPh = opts.entity_ids.map(() => '?').join(',');
  const tIdPh = opts.tag_ids.map(() => '?').join(',');
  const r = dbi.prepare(`DELETE FROM entity_tags WHERE entity_type = ? AND entity_id IN (${eIdPh}) AND tag_id IN (${tIdPh})`).run(opts.entity_type, ...opts.entity_ids, ...opts.tag_ids);
  return { untagged: r.changes };
}

// F298 — listUndoableOperations
export function listUndoableOperations(companyId: string, userId?: string, limit: number = 20): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = `company_id = ? AND is_undoable = 1 AND undone_at IS NULL AND (undo_expires_at IS NULL OR undo_expires_at > datetime('now'))`;
  if (userId) { where += ' AND user_id = ?'; params.push(userId); }
  return dbi.prepare(`SELECT id, operation_type, entity_type, entity_ids, performed_at, undo_expires_at FROM bulk_undo_snapshots WHERE ${where} ORDER BY performed_at DESC LIMIT ?`).all(...params, Math.min(limit, 200)) as any[];
}

// F299 — undoBulkOperation
export function undoBulkOperation(snapshotId: string): { restored: number; operation_type: string } {
  const dbi = db.getDb();
  const snap = dbi.prepare(`SELECT * FROM bulk_undo_snapshots WHERE id = ? AND is_undoable = 1 AND undone_at IS NULL`).get(snapshotId) as any;
  if (!snap) throw new Error('Snapshot not found or already undone');
  if (snap.undo_expires_at && snap.undo_expires_at < now()) throw new Error('Undo window expired');

  const originalData = JSON.parse(snap.original_data_json || '[]');
  let restored = 0;
  const tx = dbi.transaction(() => {
    if (snap.operation_type === 'update') {
      // Restore each row
      const changedFields = JSON.parse(snap.changed_fields_json || '{}');
      const fields = Object.keys(changedFields);
      for (const row of originalData) {
        const setClause = fields.map(f => `${f} = ?`).join(', ');
        const values = fields.map(f => row[f]);
        try {
          const r = dbi.prepare(`UPDATE ${snap.entity_type} SET ${setClause} WHERE id = ?`).run(...values, row.id);
          restored += r.changes;
        } catch {}
      }
    } else if (snap.operation_type === 'delete') {
      // Re-insert each row (for soft-delete, just clear deleted_at)
      for (const row of originalData) {
        try {
          dbi.prepare(`UPDATE ${snap.entity_type} SET deleted_at = NULL WHERE id = ?`).run(row.id);
          restored++;
        } catch {
          // Hard delete — try to re-insert
          const keys = Object.keys(row);
          const placeholders = keys.map(() => '?').join(',');
          try {
            dbi.prepare(`INSERT INTO ${snap.entity_type} (${keys.join(',')}) VALUES (${placeholders})`).run(...Object.values(row));
            restored++;
          } catch {}
        }
      }
    }
    dbi.prepare(`UPDATE bulk_undo_snapshots SET undone_at = ? WHERE id = ?`).run(now(), snapshotId);
  });
  tx();
  return { restored, operation_type: snap.operation_type };
}

// F300 — createUndoSnapshot (manual snapshot for any operation)
export function createUndoSnapshot(opts: { company_id: string; user_id?: string; operation_type: string; entity_type: string; entity_ids: string[]; original_data: any }): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO bulk_undo_snapshots (id, company_id, user_id, operation_type, entity_type, entity_ids, original_data_json, undo_expires_at, performed_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+1 day'), ?)`)
    .run(id, opts.company_id, opts.user_id || null, opts.operation_type, opts.entity_type, opts.entity_ids.join(','), JSON.stringify(opts.original_data), now());
  return { id };
}
