// ─── Dynamic Wave Part 2: F301-F350 (50 features) ───
//
// Batch N: Smart Helpers (F301-F310)
// Batch O: Keyboard & Macros (F311-F320)
// Batch P: Report Engine (F321-F330)
// Batch Q: Webhook Delivery (F331-F340)
// Batch R: Real-time + Activity (F341-F350)

import { randomUUID as uuid, createHmac } from 'crypto';
import * as db from '../database';

const now = (): string => new Date().toISOString();
const today = (): string => now().slice(0, 10);
const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;

// ════════════════════════════════════════════════════════════════
// Batch N: Smart Helpers (F301-F310)
// ════════════════════════════════════════════════════════════════

// F301 — detectAnomalies (expenses far from category mean)
export function detectAnomalies(companyId: string, opts?: { lookback_days?: number; z_threshold?: number }): any[] {
  const dbi = db.getDb();
  const days = opts?.lookback_days || 90;
  const zThreshold = opts?.z_threshold || 2.5;
  const recent = dbi.prepare(`SELECT id, amount, description, category_id, date FROM expenses WHERE company_id = ? AND date >= date('now', '-' || ? || ' days') AND (deleted_at IS NULL OR deleted_at = '')`).all(companyId, days) as any[];
  // Group by category, compute mean + stddev, flag z > threshold
  const byCategory = new Map<string, number[]>();
  for (const e of recent) {
    if (!e.category_id) continue;
    if (!byCategory.has(e.category_id)) byCategory.set(e.category_id, []);
    byCategory.get(e.category_id)!.push(e.amount || 0);
  }
  const stats = new Map<string, { mean: number; stddev: number }>();
  for (const [cat, vals] of byCategory) {
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const variance = vals.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / vals.length;
    stats.set(cat, { mean, stddev: Math.sqrt(variance) });
  }
  const anomalies: any[] = [];
  for (const e of recent) {
    if (!e.category_id) continue;
    const s = stats.get(e.category_id);
    if (!s || s.stddev === 0) continue;
    const z = Math.abs(((e.amount || 0) - s.mean) / s.stddev);
    if (z >= zThreshold) {
      anomalies.push({ entity_id: e.id, description: e.description, amount: e.amount, date: e.date, category_id: e.category_id, z_score: round2(z), reason: `${round2(z)}σ from category mean (${round2(s.mean)})` });
    }
  }
  // Record top 50
  const recordInsert = dbi.prepare(`INSERT INTO smart_detections (id, company_id, detection_type, entity_type, entity_id, score, severity, reasoning_json, detected_at) VALUES (?, ?, 'anomaly', 'expense', ?, ?, ?, ?, ?)`);
  for (const a of anomalies.slice(0, 50)) {
    recordInsert.run(uuid(), companyId, a.entity_id, a.z_score, a.z_score > 3.5 ? 'high' : 'medium', JSON.stringify(a), now());
  }
  return anomalies;
}

// F302 — suggestCategoryByDescription (uses auto_categorize_learnings from F86)
export function suggestCategoryByDescription(companyId: string, description: string, vendorId?: string): { category_id: string | null; confidence: number; source: string } {
  const dbi = db.getDb();
  // First try vendor-based lookup
  if (vendorId) {
    const recent = dbi.prepare(`SELECT category_id, COUNT(*) AS n FROM expenses WHERE company_id = ? AND vendor_id = ? AND category_id IS NOT NULL AND (deleted_at IS NULL OR deleted_at = '') GROUP BY category_id ORDER BY n DESC LIMIT 1`).get(companyId, vendorId) as any;
    if (recent) return { category_id: recent.category_id, confidence: Math.min(recent.n / 10, 1), source: 'vendor_history' };
  }
  // Then try description pattern matching
  try {
    const patterns = dbi.prepare(`SELECT * FROM auto_categorize_learnings WHERE company_id = ? ORDER BY confidence DESC`).all(companyId) as any[];
    const descLower = description.toLowerCase();
    for (const p of patterns) {
      if (descLower.includes((p.description_pattern || '').toLowerCase())) {
        return { category_id: p.category_id, confidence: p.confidence || 0.5, source: 'pattern_match' };
      }
    }
  } catch {}
  return { category_id: null, confidence: 0, source: 'no_match' };
}

// F303 — predictPaymentDate (avg days-to-pay for client)
export function predictPaymentDate(companyId: string, invoiceId: string): { predicted_payment_date: string | null; confidence: number; avg_days_to_pay: number; sample_size: number } {
  const dbi = db.getDb();
  const inv = dbi.prepare(`SELECT client_id, issue_date, due_date FROM invoices WHERE id = ?`).get(invoiceId) as any;
  if (!inv || !inv.client_id) return { predicted_payment_date: null, confidence: 0, avg_days_to_pay: 0, sample_size: 0 };
  // Average days from issue to payment for this client's past invoices
  const stats = dbi.prepare(`SELECT AVG(julianday(p.date) - julianday(i.issue_date)) AS avg_days, COUNT(*) AS n FROM invoices i JOIN payments p ON p.invoice_id = i.id WHERE i.company_id = ? AND i.client_id = ? AND i.status = 'paid'`).get(companyId, inv.client_id) as any;
  const avgDays = Math.round(stats.avg_days || 0);
  if (!avgDays || stats.n === 0) return { predicted_payment_date: inv.due_date, confidence: 0, avg_days_to_pay: 0, sample_size: 0 };
  const d = new Date(inv.issue_date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + avgDays);
  return { predicted_payment_date: d.toISOString().slice(0, 10), confidence: Math.min(stats.n / 5, 1), avg_days_to_pay: avgDays, sample_size: stats.n };
}

// F304 — smartFillFromPrevious (fill new entity fields from most recent similar)
export function smartFillFromPrevious(companyId: string, entityType: 'expense' | 'bill', context: { vendor_id?: string; description?: string }): Record<string, any> {
  const dbi = db.getDb();
  let row: any = null;
  if (entityType === 'expense' && context.vendor_id) {
    row = dbi.prepare(`SELECT * FROM expenses WHERE company_id = ? AND vendor_id = ? AND (deleted_at IS NULL OR deleted_at = '') ORDER BY date DESC LIMIT 1`).get(companyId, context.vendor_id);
  } else if (entityType === 'bill' && context.vendor_id) {
    row = dbi.prepare(`SELECT * FROM bills WHERE company_id = ? AND vendor_id = ? AND (deleted_at IS NULL OR deleted_at = '') ORDER BY bill_date DESC LIMIT 1`).get(companyId, context.vendor_id);
  }
  if (!row) return {};
  // Return likely-reusable fields (exclude IDs, dates, amounts)
  return {
    category_id: row.category_id,
    project_id: row.project_id,
    payment_method: row.payment_method,
    notes_template: row.notes ? row.notes.slice(0, 100) : null,
    is_tax_deductible: row.is_tax_deductible,
    is_billable: row.is_billable,
  };
}

// F305 — canonicalizeVendorName (find canonical or create mapping)
export function canonicalizeVendorName(companyId: string, inputName: string): { canonical_vendor_id: string | null; confidence: number; from_cache: boolean } {
  const dbi = db.getDb();
  const key = inputName.trim().toLowerCase();
  // Check cache
  const cached = dbi.prepare(`SELECT * FROM vendor_canonicalizations WHERE company_id = ? AND LOWER(input_pattern) = ?`).get(companyId, key) as any;
  if (cached) {
    dbi.prepare(`UPDATE vendor_canonicalizations SET match_count = match_count + 1 WHERE id = ?`).run(cached.id);
    return { canonical_vendor_id: cached.canonical_vendor_id, confidence: cached.confidence, from_cache: true };
  }
  // Fuzzy match against existing vendors
  const vendors = dbi.prepare(`SELECT id, name FROM vendors WHERE company_id = ? AND (deleted_at IS NULL OR deleted_at = '')`).all(companyId) as any[];
  let bestMatch: any = null;
  let bestScore = 0;
  for (const v of vendors) {
    const score = tokenOverlap(key, (v.name || '').toLowerCase());
    if (score > bestScore) { bestScore = score; bestMatch = v; }
  }
  if (bestMatch && bestScore >= 0.6) {
    // Cache the mapping
    dbi.prepare(`INSERT INTO vendor_canonicalizations (id, company_id, input_pattern, canonical_vendor_id, confidence, match_count, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)`).run(uuid(), companyId, inputName, bestMatch.id, bestScore, now());
    return { canonical_vendor_id: bestMatch.id, confidence: bestScore, from_cache: false };
  }
  return { canonical_vendor_id: null, confidence: 0, from_cache: false };
}

function tokenOverlap(a: string, b: string): number {
  const ta = a.split(/\W+/).filter(Boolean);
  const tb = b.split(/\W+/).filter(Boolean);
  if (ta.length === 0 || tb.length === 0) return 0;
  const overlap = ta.filter(t => tb.some(bt => bt.includes(t) || t.includes(bt))).length;
  return overlap / Math.max(ta.length, tb.length);
}

// F306 — matchTransactionToInvoice (bank tx → invoice)
export function matchTransactionToInvoice(companyId: string, transactionId: string, opts?: { tolerance_days?: number; tolerance_amount_percent?: number }): { matches: Array<{ invoice_id: string; invoice_number: string; amount: number; score: number }> } {
  const dbi = db.getDb();
  const tx = dbi.prepare(`SELECT * FROM bank_transactions WHERE id = ?`).get(transactionId) as any;
  if (!tx) return { matches: [] };
  const tolDays = opts?.tolerance_days || 5;
  const tolPct = opts?.tolerance_amount_percent || 0.02;
  const minAmt = (tx.amount || 0) * (1 - tolPct);
  const maxAmt = (tx.amount || 0) * (1 + tolPct);
  const candidates = dbi.prepare(`SELECT id, invoice_number, total, due_date FROM invoices WHERE company_id = ? AND status NOT IN ('paid','void','cancelled') AND total BETWEEN ? AND ? AND ABS(julianday(?) - julianday(due_date)) <= ? AND (deleted_at IS NULL OR deleted_at = '')`).all(companyId, Math.abs(minAmt), Math.abs(maxAmt), tx.transaction_date, tolDays) as any[];
  const matches = candidates.map(c => ({
    invoice_id: c.id, invoice_number: c.invoice_number, amount: c.total,
    score: 1 - Math.abs((Math.abs(tx.amount) - c.total) / c.total) - Math.abs(daysBetween(tx.transaction_date, c.due_date)) / (tolDays * 10),
  })).sort((a, b) => b.score - a.score);
  return { matches };
}

function daysBetween(d1: string, d2: string): number {
  return Math.round((new Date(d1).getTime() - new Date(d2).getTime()) / 86400000);
}

// F307 — calculateLatePaymentRisk
export function calculateLatePaymentRisk(companyId: string, customerId: string): { risk_score: number; risk_level: string; factors: string[] } {
  const dbi = db.getDb();
  const stats = dbi.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN julianday(COALESCE((SELECT MAX(date) FROM payments WHERE invoice_id = invoices.id), date('now'))) - julianday(due_date) > 0 THEN 1 ELSE 0 END) AS late_count, AVG(CASE WHEN julianday(COALESCE((SELECT MAX(date) FROM payments WHERE invoice_id = invoices.id), date('now'))) - julianday(due_date) > 0 THEN julianday(COALESCE((SELECT MAX(date) FROM payments WHERE invoice_id = invoices.id), date('now'))) - julianday(due_date) END) AS avg_days_late FROM invoices WHERE company_id = ? AND client_id = ?`).get(companyId, customerId) as any;
  const total = stats.total || 0;
  const lateRate = total > 0 ? (stats.late_count || 0) / total : 0;
  const avgDaysLate = stats.avg_days_late || 0;
  // 0-1 score: weighted combo
  const score = Math.min(lateRate * 0.6 + Math.min(avgDaysLate / 30, 1) * 0.4, 1);
  const level = score < 0.25 ? 'low' : score < 0.55 ? 'medium' : score < 0.80 ? 'high' : 'critical';
  const factors = [
    `${Math.round(lateRate * 100)}% of ${total} invoices paid late`,
    avgDaysLate ? `Avg ${Math.round(avgDaysLate)} days late when late` : 'No late payments',
  ];
  return { risk_score: round2(score), risk_level: level, factors };
}

// F308 — forecastNextPeriod (linear regression on monthly totals)
export function forecastNextPeriod(companyId: string, accountId: string, periods: number = 3): Array<{ period: string; forecast: number; lower: number; upper: number }> {
  const dbi = db.getDb();
  const history = dbi.prepare(`SELECT strftime('%Y-%m', je.entry_date) AS period, SUM(jel.debit - jel.credit) AS net FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id WHERE je.company_id = ? AND jel.account_id = ? AND je.is_posted = 1 AND je.entry_date >= date('now', '-24 months') GROUP BY period ORDER BY period`).all(companyId, accountId) as any[];
  if (history.length < 3) return [];
  // Simple linear regression: y = a + b*x where x is period index
  const n = history.length;
  const xs = history.map((_, i) => i);
  const ys = history.map(h => h.net || 0);
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;
  const num = xs.reduce((s, x, i) => s + (x - meanX) * (ys[i] - meanY), 0);
  const den = xs.reduce((s, x) => s + (x - meanX) ** 2, 0);
  const slope = den === 0 ? 0 : num / den;
  const intercept = meanY - slope * meanX;
  // Residual stddev for confidence interval
  const residuals = ys.map((y, i) => y - (intercept + slope * xs[i]));
  const residStd = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / n);
  const forecasts: any[] = [];
  for (let i = 0; i < periods; i++) {
    const x = n + i;
    const f = intercept + slope * x;
    const period = nextPeriodLabel(history[n - 1].period, i + 1);
    forecasts.push({ period, forecast: round2(f), lower: round2(f - 1.96 * residStd), upper: round2(f + 1.96 * residStd) });
  }
  return forecasts;
}

function nextPeriodLabel(baseYearMonth: string, offset: number): string {
  const [y, m] = baseYearMonth.split('-').map(Number);
  const total = y * 12 + (m - 1) + offset;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

// F309 — recommendActions (top N suggested tasks for user)
export function recommendActions(companyId: string, userId: string, limit: number = 5): any[] {
  const dbi = db.getDb();
  const recs: any[] = [];

  // Overdue invoices
  const overdueCount = (dbi.prepare(`SELECT COUNT(*) AS n FROM invoices WHERE company_id = ? AND status NOT IN ('paid','void','cancelled') AND due_date < date('now') AND (deleted_at IS NULL OR deleted_at = '')`).get(companyId) as any).n;
  if (overdueCount > 0) recs.push({ type: 'overdue_invoices', title: `${overdueCount} overdue invoice${overdueCount > 1 ? 's' : ''}`, description: 'Send payment reminders or call clients', action_url: '/invoices?status=overdue', priority: 90 });

  // Unposted JEs
  const unpostedCount = (dbi.prepare(`SELECT COUNT(*) AS n FROM journal_entries WHERE company_id = ? AND is_posted = 0 AND (deleted_at IS NULL OR deleted_at = '')`).get(companyId) as any).n;
  if (unpostedCount > 0) recs.push({ type: 'unposted_je', title: `${unpostedCount} draft journal entr${unpostedCount > 1 ? 'ies' : 'y'}`, description: 'Review and post pending entries', action_url: '/accounts?tab=journal', priority: 70 });

  // Unreconciled bank transactions
  try {
    const unrecon = (dbi.prepare(`SELECT COUNT(*) AS n FROM bank_transactions WHERE company_id = ? AND (is_reconciled = 0 OR is_reconciled IS NULL)`).get(companyId) as any).n;
    if (unrecon > 0) recs.push({ type: 'unreconciled_bank', title: `${unrecon} unreconciled bank transaction${unrecon > 1 ? 's' : ''}`, description: 'Match transactions to invoices/expenses', action_url: '/bank-recon', priority: 60 });
  } catch {}

  // Due accruals
  try {
    const dueAcc = (dbi.prepare(`SELECT COUNT(*) AS n FROM accrual_entries WHERE company_id = ? AND status = 'posted' AND is_reversed = 0 AND reverse_date <= date('now')`).get(companyId) as any).n;
    if (dueAcc > 0) recs.push({ type: 'reverse_accruals', title: `${dueAcc} accrual${dueAcc > 1 ? 's' : ''} due for reversal`, description: 'Post reversing entries for period close', action_url: '/accounts?tab=accruals', priority: 65 });
  } catch {}

  // Expiring contracts (warranty/insurance)
  try {
    const expiring = (dbi.prepare(`SELECT COUNT(*) AS n FROM asset_warranties WHERE company_id = ? AND end_date <= date('now', '+30 days') AND end_date >= date('now')`).get(companyId) as any).n;
    if (expiring > 0) recs.push({ type: 'expiring_warranties', title: `${expiring} warrant${expiring > 1 ? 'ies' : 'y'} expiring soon`, description: 'Review and renew before expiration', action_url: '/fixed-assets', priority: 50 });
  } catch {}

  // Save top N to recommendations table
  const insert = dbi.prepare(`INSERT INTO recommendations (id, user_id, company_id, recommendation_type, title, description, action_url, priority, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const sorted = recs.sort((a, b) => b.priority - a.priority).slice(0, limit);
  for (const r of sorted) {
    insert.run(uuid(), userId, companyId, r.type, r.title, r.description, r.action_url, r.priority, now());
  }
  return sorted;
}

// F310 — detectDuplicateEntries
export function detectDuplicateEntries(companyId: string, entityType: 'expense' | 'bill' = 'expense', lookbackDays: number = 30): Array<{ id_a: string; id_b: string; reason: string }> {
  const dbi = db.getDb();
  const table = entityType === 'bill' ? 'bills' : 'expenses';
  const amtCol = entityType === 'bill' ? 'total' : 'amount';
  const dateCol = entityType === 'bill' ? 'bill_date' : 'date';
  const dupes = dbi.prepare(`SELECT a.id AS id_a, b.id AS id_b, a.${amtCol} AS amt, a.${dateCol} AS dt FROM ${table} a JOIN ${table} b ON b.id > a.id AND b.vendor_id = a.vendor_id AND ABS(b.${amtCol} - a.${amtCol}) < 0.01 AND b.${dateCol} = a.${dateCol} WHERE a.company_id = ? AND a.${dateCol} >= date('now', '-' || ? || ' days') AND (a.deleted_at IS NULL OR a.deleted_at = '')`).all(companyId, lookbackDays) as any[];
  return dupes.map(d => ({ id_a: d.id_a, id_b: d.id_b, reason: `Same vendor, same amount ($${d.amt}), same date (${d.dt})` }));
}

// ════════════════════════════════════════════════════════════════
// Batch O: Keyboard & Macros (F311-F320)
// ════════════════════════════════════════════════════════════════

// F311 — registerCommand (server-side registry of commands)
export function registerCommand(c: { command_id: string; label: string; category?: string; scope?: string; default_hotkey?: string; description?: string }): { id: string } {
  const dbi = db.getDb();
  const id = uuid();
  dbi.prepare(`INSERT INTO command_registry (id, command_id, label, category, scope, default_hotkey, description, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?) ON CONFLICT(command_id) DO UPDATE SET label = excluded.label, category = excluded.category, scope = excluded.scope, default_hotkey = excluded.default_hotkey, description = excluded.description`)
    .run(id, c.command_id, c.label, c.category || null, c.scope || 'global', c.default_hotkey || null, c.description || null, now());
  return { id };
}

// F312 — listCommands
export function listCommands(opts?: { category?: string; scope?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [];
  let where = 'is_active = 1';
  if (opts?.category) { where += ' AND category = ?'; params.push(opts.category); }
  if (opts?.scope) { where += ' AND scope = ?'; params.push(opts.scope); }
  return dbi.prepare(`SELECT * FROM command_registry WHERE ${where} ORDER BY category, label`).all(...params) as any[];
}

// F313 — searchCommands (cmd-palette autocomplete)
export function searchCommands(query: string, limit: number = 20): any[] {
  const dbi = db.getDb();
  const q = `%${query.toLowerCase()}%`;
  return dbi.prepare(`SELECT * FROM command_registry WHERE is_active = 1 AND (LOWER(label) LIKE ? OR LOWER(description) LIKE ?) ORDER BY label LIMIT ?`).all(q, q, Math.min(limit, 200)) as any[];
}

// F314 — recordMacro (uses existing macros table)
export function recordMacroStart(userId: string, name: string, scope?: string): { id: string } {
  const dbi = db.getDb();
  const id = uuid();
  try {
    dbi.prepare(`INSERT INTO macros (id, user_id, name, scope, steps_json, created_at) VALUES (?, ?, ?, ?, '[]', ?)`).run(id, userId, name, scope || 'global', now());
  } catch {
    dbi.prepare(`INSERT INTO macros (id, user_id, name, steps, created_at) VALUES (?, ?, ?, '[]', ?)`).run(id, userId, name, now());
  }
  return { id };
}

// F315 — saveMacroSteps
export function saveMacroSteps(macroId: string, steps: any[]): boolean {
  const dbi = db.getDb();
  try {
    const r = dbi.prepare(`UPDATE macros SET steps_json = ? WHERE id = ?`).run(JSON.stringify(steps), macroId);
    return r.changes > 0;
  } catch {
    const r = dbi.prepare(`UPDATE macros SET steps = ? WHERE id = ?`).run(JSON.stringify(steps), macroId);
    return r.changes > 0;
  }
}

// F316 — getMacroSteps
export function getMacroSteps(macroId: string): any[] {
  const dbi = db.getDb();
  const m = dbi.prepare(`SELECT * FROM macros WHERE id = ?`).get(macroId) as any;
  if (!m) return [];
  try { return JSON.parse(m.steps_json || m.steps || '[]'); } catch { return []; }
}

// F317 — listMacros
export function listMacros(userId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM macros WHERE user_id = ? ORDER BY name`).all(userId) as any[];
}

// F318 — saveWorkspaceLayout
export function saveWorkspaceLayout(opts: { user_id: string; company_id?: string; name: string; layout: any; is_default?: boolean }): { id: string } {
  const dbi = db.getDb();
  const id = uuid();
  if (opts.is_default) dbi.prepare(`UPDATE workspace_layouts SET is_default = 0 WHERE user_id = ?`).run(opts.user_id);
  dbi.prepare(`INSERT INTO workspace_layouts (id, user_id, company_id, name, layout_json, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, opts.user_id, opts.company_id || null, opts.name, JSON.stringify(opts.layout), opts.is_default ? 1 : 0, now(), now());
  return { id };
}

// F319 — loadWorkspaceLayout
export function loadWorkspaceLayout(userId: string, name?: string): any {
  const dbi = db.getDb();
  let row;
  if (name) {
    row = dbi.prepare(`SELECT * FROM workspace_layouts WHERE user_id = ? AND name = ?`).get(userId, name);
  } else {
    row = dbi.prepare(`SELECT * FROM workspace_layouts WHERE user_id = ? AND is_default = 1 LIMIT 1`).get(userId)
       || dbi.prepare(`SELECT * FROM workspace_layouts WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1`).get(userId);
  }
  if (!row) return null;
  try { (row as any).layout = JSON.parse((row as any).layout_json || '{}'); } catch { (row as any).layout = {}; }
  return row;
}

// F320 — listWorkspaceLayouts
export function listWorkspaceLayouts(userId: string): any[] {
  return db.getDb().prepare(`SELECT id, name, is_default, created_at, updated_at FROM workspace_layouts WHERE user_id = ? ORDER BY is_default DESC, name`).all(userId) as any[];
}

// ════════════════════════════════════════════════════════════════
// Batch P: Report Engine (F321-F330)
// ════════════════════════════════════════════════════════════════

// F321 — createCustomReport
export function createCustomReport(r: any): { id: string } {
  const dbi = db.getDb();
  const id = uuid();
  dbi.prepare(`INSERT INTO custom_reports (id, company_id, name, description, report_type, definition_json, is_published, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, r.company_id, r.name, r.description || null, r.report_type || 'tabular', JSON.stringify(r.definition || {}), r.is_published ? 1 : 0, r.created_by || null, now(), now());
  return { id };
}

// F322 — runCustomReport (executes a stored definition against the DB)
export function runCustomReport(reportId: string, params?: Record<string, any>): { rows: any[]; columns: string[]; row_count: number; duration_ms: number } {
  const dbi = db.getDb();
  const startTime = Date.now();
  const r = dbi.prepare(`SELECT * FROM custom_reports WHERE id = ?`).get(reportId) as any;
  if (!r) throw new Error('Report not found');
  const def = JSON.parse(r.definition_json || '{}');
  // Whitelist of safe SELECT queries — must start with SELECT
  let sql = String(def.sql || '');
  if (!/^\s*SELECT\s+/i.test(sql)) throw new Error('Only SELECT queries allowed');
  if (/;\s*DROP|;\s*DELETE|;\s*INSERT|;\s*UPDATE/i.test(sql)) throw new Error('Disallowed multi-statement');
  // Bind params positionally
  const paramValues = (def.params || []).map((p: string) => (params || {})[p] ?? null);
  let rows: any[] = [];
  try {
    rows = dbi.prepare(sql).all(...paramValues) as any[];
  } catch (e: any) {
    // Record failed execution
    dbi.prepare(`INSERT INTO report_executions (id, report_id, executed_at, duration_ms, row_count, status, error_message) VALUES (?, ?, ?, ?, 0, 'failed', ?)`)
      .run(uuid(), reportId, now(), Date.now() - startTime, e?.message || 'Unknown error');
    throw e;
  }
  const columns = rows.length > 0 ? Object.keys(rows[0]) : (def.columns || []);
  const duration = Date.now() - startTime;
  dbi.prepare(`INSERT INTO report_executions (id, report_id, executed_at, duration_ms, row_count, status) VALUES (?, ?, ?, ?, ?, 'success')`)
    .run(uuid(), reportId, now(), duration, rows.length);
  return { rows, columns, row_count: rows.length, duration_ms: duration };
}

// F323 — buildPivotTable
export function buildPivotTable(rows: any[], opts: { row_field: string; col_field: string; value_field: string; agg?: 'sum' | 'avg' | 'count' | 'min' | 'max' }): { row_labels: string[]; col_labels: string[]; data: Record<string, Record<string, number>>; totals: { rows: Record<string, number>; cols: Record<string, number>; grand: number } } {
  const agg = opts.agg || 'sum';
  const rowLabels = Array.from(new Set(rows.map(r => String(r[opts.row_field])))).sort();
  const colLabels = Array.from(new Set(rows.map(r => String(r[opts.col_field])))).sort();
  const data: Record<string, Record<string, number>> = {};
  const rowTotals: Record<string, number> = {};
  const colTotals: Record<string, number> = {};
  let grand = 0;
  for (const rl of rowLabels) { data[rl] = {}; rowTotals[rl] = 0; for (const cl of colLabels) data[rl][cl] = 0; }
  for (const cl of colLabels) colTotals[cl] = 0;
  // Aggregate
  const counts: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const rl = String(r[opts.row_field]);
    const cl = String(r[opts.col_field]);
    const v = Number(r[opts.value_field]) || 0;
    if (!counts[rl]) counts[rl] = {};
    counts[rl][cl] = (counts[rl][cl] || 0) + 1;
    if (agg === 'sum' || agg === 'avg') data[rl][cl] += v;
    else if (agg === 'count') data[rl][cl] = counts[rl][cl];
    else if (agg === 'min') data[rl][cl] = data[rl][cl] === 0 ? v : Math.min(data[rl][cl], v);
    else if (agg === 'max') data[rl][cl] = Math.max(data[rl][cl], v);
  }
  if (agg === 'avg') {
    for (const rl of rowLabels) for (const cl of colLabels) if (counts[rl]?.[cl]) data[rl][cl] = data[rl][cl] / counts[rl][cl];
  }
  for (const rl of rowLabels) for (const cl of colLabels) { rowTotals[rl] += data[rl][cl]; colTotals[cl] += data[rl][cl]; grand += data[rl][cl]; }
  return { row_labels: rowLabels, col_labels: colLabels, data, totals: { rows: rowTotals, cols: colTotals, grand: round2(grand) } };
}

// F324 — saveReportSchedule
export function saveReportSchedule(s: any): { id: string } {
  const dbi = db.getDb();
  const id = uuid();
  dbi.prepare(`INSERT INTO report_schedules (id, report_id, schedule_cron, recipients_json, format, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)`)
    .run(id, s.report_id, s.schedule_cron, JSON.stringify(s.recipients || []), s.format || 'pdf', now());
  return { id };
}

// F325 — listScheduledReports
export function listScheduledReports(companyId: string): any[] {
  return db.getDb().prepare(`SELECT rs.*, cr.name AS report_name FROM report_schedules rs JOIN custom_reports cr ON cr.id = rs.report_id WHERE cr.company_id = ? ORDER BY cr.name`).all(companyId) as any[];
}

// F326 — listDueReports (for cron worker)
export function listDueReports(): any[] {
  return db.getDb().prepare(`SELECT * FROM report_schedules WHERE is_active = 1 AND (next_run_at IS NULL OR next_run_at <= datetime('now'))`).all() as any[];
}

// F327 — markReportRun
export function markReportRun(scheduleId: string, nextRunAt?: string): boolean {
  const r = db.getDb().prepare(`UPDATE report_schedules SET last_run_at = ?, next_run_at = ?, run_count = run_count + 1 WHERE id = ?`).run(now(), nextRunAt || null, scheduleId);
  return r.changes > 0;
}

// F328 — comparePeriods (run same report against two periods)
export function comparePeriods(reportId: string, paramsA: Record<string, any>, paramsB: Record<string, any>): { period_a: any; period_b: any; deltas: Record<string, number> } {
  const a = runCustomReport(reportId, paramsA);
  const b = runCustomReport(reportId, paramsB);
  const deltas: Record<string, number> = {};
  // If both have numeric columns, compute row-by-row deltas where row keys match
  if (a.rows.length > 0 && b.rows.length > 0) {
    const numericCols = a.columns.filter(c => typeof a.rows[0][c] === 'number');
    for (const col of numericCols) {
      const totalA = a.rows.reduce((s, r) => s + (r[col] || 0), 0);
      const totalB = b.rows.reduce((s, r) => s + (r[col] || 0), 0);
      deltas[col] = round2(totalB - totalA);
    }
  }
  return { period_a: a, period_b: b, deltas };
}

// F329 — listReportExecutions
export function listReportExecutions(reportId: string, limit: number = 20): any[] {
  return db.getDb().prepare(`SELECT * FROM report_executions WHERE report_id = ? ORDER BY executed_at DESC LIMIT ?`).all(reportId, Math.min(limit, 200)) as any[];
}

// F330 — listCustomReports
export function listCustomReports(companyId: string, opts?: { published_only?: boolean }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.published_only) where += ' AND is_published = 1';
  return dbi.prepare(`SELECT id, name, description, report_type, is_published, created_at, updated_at FROM custom_reports WHERE ${where} ORDER BY name`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// Batch Q: Webhook Delivery Engine (F331-F340)
// ════════════════════════════════════════════════════════════════

// F331 — registerWebhook (uses existing webhook_subscriptions)
export function registerWebhook(opts: { company_id: string; url: string; event_types: string[]; secret?: string }): { id: string; secret: string } {
  const dbi = db.getDb();
  const secret = opts.secret || `whsec_${uuid().replace(/-/g, '')}`;
  const id = uuid();
  dbi.prepare(`INSERT INTO webhook_subscriptions (id, company_id, url, event_types, secret_key, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)`)
    .run(id, opts.company_id, opts.url, JSON.stringify(opts.event_types), secret, now());
  return { id, secret };
}

// F332 — signPayload (HMAC-SHA256)
export function signPayload(payload: any, secret: string): string {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return createHmac('sha256', secret).update(body).digest('hex');
}

// F333 — verifySignature
export function verifySignature(payload: any, signature: string, secret: string): boolean {
  return signPayload(payload, secret) === signature;
}

// F334 — queueWebhookDelivery
export function queueWebhookDelivery(opts: { subscription_id: string; event_type: string; payload: any }): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO webhook_queue (id, subscription_id, event_type, payload_json, status, queued_at, next_attempt_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)`)
    .run(id, opts.subscription_id, opts.event_type, JSON.stringify(opts.payload), now(), now());
  return { id };
}

// F335 — listDueWebhookDeliveries (for worker)
export function listDueWebhookDeliveries(limit: number = 50): any[] {
  return db.getDb().prepare(`SELECT * FROM webhook_queue WHERE status = 'queued' AND next_attempt_at <= datetime('now') ORDER BY queued_at ASC LIMIT ?`).all(Math.min(limit, 500)) as any[];
}

// F336 — recordDeliveryAttempt (exponential backoff retry)
export function recordDeliveryAttempt(queueId: string, success: boolean, errorMessage?: string): { status: string; next_attempt_at: string | null } {
  const dbi = db.getDb();
  const q = dbi.prepare(`SELECT * FROM webhook_queue WHERE id = ?`).get(queueId) as any;
  if (!q) throw new Error('Queue entry not found');
  const attempts = (q.attempts || 0) + 1;
  if (success) {
    dbi.prepare(`UPDATE webhook_queue SET status = 'delivered', attempts = ?, completed_at = ? WHERE id = ?`).run(attempts, now(), queueId);
    return { status: 'delivered', next_attempt_at: null };
  }
  if (attempts >= 8) {
    // Dead letter
    dbi.prepare(`UPDATE webhook_queue SET status = 'dead_letter', attempts = ?, last_error = ?, completed_at = ? WHERE id = ?`).run(attempts, errorMessage || 'Max retries exceeded', now(), queueId);
    return { status: 'dead_letter', next_attempt_at: null };
  }
  // Exponential backoff: 30s * 2^attempts, capped at 1 hour
  const backoffSec = Math.min(30 * Math.pow(2, attempts), 3600);
  const nextAttempt = new Date(Date.now() + backoffSec * 1000).toISOString();
  dbi.prepare(`UPDATE webhook_queue SET status = 'queued', attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ?`).run(attempts, errorMessage || null, nextAttempt, queueId);
  return { status: 'queued', next_attempt_at: nextAttempt };
}

// F337 — listWebhookDeliveries (audit)
export function listWebhookDeliveries(opts?: { subscription_id?: string; status?: string; limit?: number }): any[] {
  const dbi = db.getDb();
  const params: any[] = [];
  let where = '1=1';
  if (opts?.subscription_id) { where += ' AND subscription_id = ?'; params.push(opts.subscription_id); }
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  return dbi.prepare(`SELECT * FROM webhook_queue WHERE ${where} ORDER BY queued_at DESC LIMIT ?`).all(...params, Math.min(opts?.limit || 100, 1000)) as any[];
}

// F338 — retryDeadLetter
export function retryDeadLetter(queueId: string): boolean {
  const r = db.getDb().prepare(`UPDATE webhook_queue SET status = 'queued', attempts = 0, next_attempt_at = datetime('now'), last_error = NULL WHERE id = ? AND status = 'dead_letter'`).run(queueId);
  return r.changes > 0;
}

// F339 — webhookStats
export function webhookStats(companyId: string, hours: number = 24): { queued: number; delivered: number; dead_letter: number; avg_attempts: number } {
  const dbi = db.getDb();
  const r = dbi.prepare(`SELECT
    SUM(CASE WHEN wq.status = 'queued' THEN 1 ELSE 0 END) AS queued,
    SUM(CASE WHEN wq.status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
    SUM(CASE WHEN wq.status = 'dead_letter' THEN 1 ELSE 0 END) AS dead_letter,
    AVG(wq.attempts) AS avg_attempts
    FROM webhook_queue wq
    JOIN webhook_subscriptions ws ON ws.id = wq.subscription_id
   WHERE ws.company_id = ? AND wq.queued_at >= datetime('now', '-' || ? || ' hours')`).get(companyId, hours) as any;
  return { queued: r.queued || 0, delivered: r.delivered || 0, dead_letter: r.dead_letter || 0, avg_attempts: round2(r.avg_attempts || 0) };
}

// F340 — fireWebhookForEvent (helper that queues all matching subscriptions)
export function fireWebhookForEvent(companyId: string, eventType: string, payload: any): { queued_count: number } {
  const dbi = db.getDb();
  const subs = dbi.prepare(`SELECT id, event_types FROM webhook_subscriptions WHERE company_id = ? AND is_active = 1`).all(companyId) as any[];
  let count = 0;
  for (const sub of subs) {
    let events: string[] = [];
    try { events = JSON.parse(sub.event_types || '[]'); } catch {}
    if (events.includes(eventType) || events.includes('*')) {
      queueWebhookDelivery({ subscription_id: sub.id, event_type: eventType, payload });
      count++;
    }
  }
  return { queued_count: count };
}

// ════════════════════════════════════════════════════════════════
// Batch R: Real-time + Activity (F341-F350)
// ════════════════════════════════════════════════════════════════

// F341 — recordActivity (feed entry)
export function recordActivity(a: { company_id: string; user_id?: string; user_email?: string; action: string; entity_type?: string; entity_id?: string; entity_label?: string; metadata?: any }): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO activity_feed (id, company_id, user_id, user_email, action, entity_type, entity_id, entity_label, metadata_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, a.company_id, a.user_id || null, a.user_email || null, a.action, a.entity_type || null, a.entity_id || null, a.entity_label || null, JSON.stringify(a.metadata || {}), now());
  return { id };
}

// F342 — listActivityFeed
export function listActivityFeed(companyId: string, opts?: { user_id?: string; entity_type?: string; entity_id?: string; limit?: number; since?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.user_id) { where += ' AND user_id = ?'; params.push(opts.user_id); }
  if (opts?.entity_type) { where += ' AND entity_type = ?'; params.push(opts.entity_type); }
  if (opts?.entity_id) { where += ' AND entity_id = ?'; params.push(opts.entity_id); }
  if (opts?.since) { where += ' AND occurred_at >= ?'; params.push(opts.since); }
  return dbi.prepare(`SELECT * FROM activity_feed WHERE ${where} ORDER BY occurred_at DESC LIMIT ?`).all(...params, Math.min(opts?.limit || 100, 1000)) as any[];
}

// F343 — lockEntity (acquire exclusive edit lock with TTL)
export function lockEntity(opts: { entity_type: string; entity_id: string; user_id: string; user_email?: string; ttl_seconds?: number }): { acquired: boolean; locked_by?: string; expires_at?: string } {
  const dbi = db.getDb();
  const ttl = opts.ttl_seconds || 300; // 5 min default
  // Clean expired
  dbi.prepare(`DELETE FROM entity_locks WHERE expires_at < datetime('now')`).run();
  // Check existing
  const existing = dbi.prepare(`SELECT * FROM entity_locks WHERE entity_type = ? AND entity_id = ?`).get(opts.entity_type, opts.entity_id) as any;
  if (existing) {
    if (existing.user_id === opts.user_id) {
      // Same user — refresh
      const newExpires = new Date(Date.now() + ttl * 1000).toISOString();
      dbi.prepare(`UPDATE entity_locks SET expires_at = ? WHERE id = ?`).run(newExpires, existing.id);
      return { acquired: true, locked_by: opts.user_id, expires_at: newExpires };
    }
    return { acquired: false, locked_by: existing.user_email || existing.user_id, expires_at: existing.expires_at };
  }
  const id = uuid();
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  dbi.prepare(`INSERT INTO entity_locks (id, entity_type, entity_id, user_id, user_email, locked_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, opts.entity_type, opts.entity_id, opts.user_id, opts.user_email || null, now(), expiresAt);
  return { acquired: true, locked_by: opts.user_id, expires_at: expiresAt };
}

// F344 — unlockEntity
export function unlockEntity(entityType: string, entityId: string, userId: string): boolean {
  const r = db.getDb().prepare(`DELETE FROM entity_locks WHERE entity_type = ? AND entity_id = ? AND user_id = ?`).run(entityType, entityId, userId);
  return r.changes > 0;
}

// F345 — checkEntityLock
export function checkEntityLock(entityType: string, entityId: string): { is_locked: boolean; locked_by?: string; expires_at?: string } {
  const dbi = db.getDb();
  dbi.prepare(`DELETE FROM entity_locks WHERE expires_at < datetime('now')`).run();
  const lock = dbi.prepare(`SELECT * FROM entity_locks WHERE entity_type = ? AND entity_id = ?`).get(entityType, entityId) as any;
  if (!lock) return { is_locked: false };
  return { is_locked: true, locked_by: lock.user_email || lock.user_id, expires_at: lock.expires_at };
}

// F346 — heartbeatPresence
export function heartbeatPresence(opts: { user_id: string; company_id?: string; current_page?: string; current_entity_type?: string; current_entity_id?: string }): boolean {
  const dbi = db.getDb();
  dbi.prepare(`INSERT INTO user_presence (id, user_id, company_id, current_page, current_entity_type, current_entity_id, last_heartbeat_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET company_id = excluded.company_id, current_page = excluded.current_page, current_entity_type = excluded.current_entity_type, current_entity_id = excluded.current_entity_id, last_heartbeat_at = excluded.last_heartbeat_at`)
    .run(uuid(), opts.user_id, opts.company_id || null, opts.current_page || null, opts.current_entity_type || null, opts.current_entity_id || null, now());
  return true;
}

// F347 — listActivePresence (users active in last N seconds)
export function listActivePresence(companyId: string, secondsWindow: number = 90): any[] {
  return db.getDb().prepare(`SELECT * FROM user_presence WHERE company_id = ? AND last_heartbeat_at >= datetime('now', '-' || ? || ' seconds')`).all(companyId, secondsWindow) as any[];
}

// F348 — listUsersOnEntity (who else is viewing this entity right now)
export function listUsersOnEntity(entityType: string, entityId: string, secondsWindow: number = 60): any[] {
  return db.getDb().prepare(`SELECT user_id, company_id, last_heartbeat_at FROM user_presence WHERE current_entity_type = ? AND current_entity_id = ? AND last_heartbeat_at >= datetime('now', '-' || ? || ' seconds')`).all(entityType, entityId, secondsWindow) as any[];
}

// F349 — activitySummary (count of actions by type today)
export function activitySummary(companyId: string, opts?: { hours?: number }): Array<{ action: string; entity_type: string | null; count: number; latest_at: string }> {
  const hours = opts?.hours || 24;
  return db.getDb().prepare(`SELECT action, entity_type, COUNT(*) AS count, MAX(occurred_at) AS latest_at FROM activity_feed WHERE company_id = ? AND occurred_at >= datetime('now', '-' || ? || ' hours') GROUP BY action, entity_type ORDER BY count DESC`).all(companyId, hours) as any[];
}

// F350 — cleanExpiredLocks (worker helper)
export function cleanExpiredLocks(): { cleaned: number } {
  const r = db.getDb().prepare(`DELETE FROM entity_locks WHERE expires_at < datetime('now')`).run();
  return { cleaned: r.changes };
}
