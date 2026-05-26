// ─── Expense Upgrades Wave: F863-F892 (30 features) ───
//
// Batch EA: Bulk Operations              (F863-F868)
// Batch EB: Search & Smart Filters       (F869-F874)
// Batch EC: Duplicate Detection & Hygiene (F875-F879)
// Batch ED: Approval Workflow            (F880-F884)
// Batch EE: Insights & Analytics         (F885-F889)
// Batch EF: UX Power                     (F890-F892)
//
// Design notes:
// 1. Bulk operations wrap in a SINGLE transaction so partial-failure
//    rolls back (no half-applied bulk).
// 2. Duplicate detection uses a deterministic score (vendor + amount + date
//    proximity) — not ML. Explainable, fast, no model deps.
// 3. Hygiene scores are 0-100 from a fixed rubric: receipt presence,
//    category, vendor, description, deductibility flag, approval status.
//    Cached in expense_hygiene_scores so list rendering doesn't recompute.

import { randomUUID as uuid } from 'crypto';
import * as db from '../database';

const now = (): string => new Date().toISOString();
const today = (): string => now().slice(0, 10);
const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;

// Helper: get expense IDs as a parameterized IN clause
function inClause(ids: string[]): { sql: string; params: string[] } {
  const placeholders = ids.map(() => '?').join(',');
  return { sql: placeholders, params: ids };
}

// ════════════════════════════════════════════════════════════════════
// Batch EA: Bulk Operations (F863-F868)
// ════════════════════════════════════════════════════════════════════

// F863: Bulk approve / reject expenses (single transaction)
export function bulkSetApprovalStatus(opts: { expense_ids: string[]; status: 'approved' | 'rejected' | 'pending'; comment?: string; actor_user_id?: string }) {
  try {
    const { expense_ids, status, comment, actor_user_id } = opts;
    if (!expense_ids?.length) return { updated: 0 };
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const { sql, params } = inClause(expense_ids);
    const txn = dbi.transaction(() => {
      dbi.prepare(`UPDATE expenses SET approval_status = ?, status = CASE WHEN ? = 'approved' THEN 'approved' WHEN ? = 'rejected' THEN 'rejected' ELSE status END, updated_at = ? WHERE company_id = ? AND id IN (${sql})`)
        .run(status, status, status, now(), cid, ...params);
      // Audit-log each approval action
      const histStmt = dbi.prepare(`INSERT INTO expense_approval_history (id, company_id, expense_id, actor_user_id, action, comment) VALUES (?, ?, ?, ?, ?, ?)`);
      for (const eid of expense_ids) histStmt.run(uuid(), cid, eid, actor_user_id || null, status, comment || null);
    });
    txn();
    return { updated: expense_ids.length, status };
  } catch (e: any) { return { error: e.message }; }
}

// F864: Bulk re-categorize a set of expenses
export function bulkRecategorize(expenseIds: string[], categoryId: string) {
  try {
    if (!expenseIds?.length) return { updated: 0 };
    const { sql, params } = inClause(expenseIds);
    const r = db.getDb().prepare(`UPDATE expenses SET category_id = ?, updated_at = ? WHERE company_id = ? AND id IN (${sql})`)
      .run(categoryId, now(), db.getCurrentCompanyId(), ...params);
    return { updated: r.changes };
  } catch (e: any) { return { error: e.message }; }
}

// F865: Bulk assign expenses to a project
export function bulkAssignProject(expenseIds: string[], projectId: string | null) {
  try {
    if (!expenseIds?.length) return { updated: 0 };
    const { sql, params } = inClause(expenseIds);
    const r = db.getDb().prepare(`UPDATE expenses SET project_id = ?, updated_at = ? WHERE company_id = ? AND id IN (${sql})`)
      .run(projectId, now(), db.getCurrentCompanyId(), ...params);
    return { updated: r.changes };
  } catch (e: any) { return { error: e.message }; }
}

// F866: Bulk mark as reimbursed (with optional reimbursement date)
export function bulkMarkReimbursed(expenseIds: string[], reimbursed: boolean, reimbursedDate?: string) {
  try {
    if (!expenseIds?.length) return { updated: 0 };
    const { sql, params } = inClause(expenseIds);
    const r = db.getDb().prepare(`UPDATE expenses SET reimbursed = ?, reimbursed_date = ?, updated_at = ? WHERE company_id = ? AND id IN (${sql})`)
      .run(reimbursed ? 1 : 0, reimbursed ? (reimbursedDate || today()) : null, now(), db.getCurrentCompanyId(), ...params);
    return { updated: r.changes };
  } catch (e: any) { return { error: e.message }; }
}

// F867: Bulk add/remove tags on a set of expenses
// Merges with existing tags (additive); skips dupes.
export function bulkTag(expenseIds: string[], tagsToAdd: string[], tagsToRemove: string[] = []) {
  try {
    if (!expenseIds?.length) return { updated: 0 };
    const dbi = db.getDb();
    const cid = db.getCurrentCompanyId();
    let updated = 0;
    const txn = dbi.transaction(() => {
      for (const id of expenseIds) {
        const row = dbi.prepare(`SELECT tags FROM expenses WHERE id = ? AND company_id = ?`).get(id, cid) as any;
        if (!row) continue;
        const cur = String(row.tags || '').split(',').map((s: string) => s.trim()).filter(Boolean);
        const set = new Set(cur);
        for (const t of tagsToAdd) set.add(t);
        for (const t of tagsToRemove) set.delete(t);
        dbi.prepare(`UPDATE expenses SET tags = ?, updated_at = ? WHERE id = ?`).run([...set].join(', '), now(), id);
        updated++;
      }
    });
    txn();
    return { updated };
  } catch (e: any) { return { error: e.message }; }
}

// F868: Bulk delete (soft delete via deleted_at)
export function bulkDelete(expenseIds: string[]) {
  try {
    if (!expenseIds?.length) return { deleted: 0 };
    const { sql, params } = inClause(expenseIds);
    const r = db.getDb().prepare(`UPDATE expenses SET deleted_at = ?, updated_at = ? WHERE company_id = ? AND id IN (${sql})`)
      .run(now(), now(), db.getCurrentCompanyId(), ...params);
    return { deleted: r.changes };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch EB: Search & Smart Filters (F869-F874)
// ════════════════════════════════════════════════════════════════════

// F869: Save the current filter set as a named "smart filter"
export function saveSmartFilter(opts: { name: string; filter: any; user_id?: string }) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO expense_smart_filters (id, company_id, user_id, name, filter_json) VALUES (?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.user_id || null, opts.name, JSON.stringify(opts.filter || {}));
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F870: List smart filters available (system presets + user-saved)
export function listSmartFilters(userId?: string) {
  try {
    return db.getDb().prepare(`SELECT * FROM expense_smart_filters WHERE company_id = ? AND (is_system = 1 OR user_id = ?) ORDER BY is_system DESC, times_used DESC, name`)
      .all(db.getCurrentCompanyId(), userId || '');
  } catch (e: any) { return { error: e.message }; }
}

// F871: Get built-in smart filter presets — these don't need to be saved
export function getSystemFilterPresets(): Array<{ name: string; description: string; filter: any }> {
  return [
    { name: 'Pending > 30 days', description: 'Approval is overdue', filter: { approval_status: 'pending', max_days_since_submit: -30 } },
    { name: 'Missing receipt', description: 'No attached receipt', filter: { has_receipt: false } },
    { name: 'Over $1,000', description: 'Large expenses', filter: { min_amount: 1000 } },
    { name: 'This month', description: 'Current month only', filter: { date_preset: 'mtd' } },
    { name: 'Last quarter', description: 'Previous fiscal quarter', filter: { date_preset: 'last_quarter' } },
    { name: 'My reimbursables', description: 'Unreimbursed billable expenses', filter: { is_reimbursable: 1, reimbursed: 0 } },
    { name: 'Non-deductible', description: 'Flagged not tax-deductible', filter: { is_tax_deductible: 0 } },
    { name: 'Has comments', description: 'Approval discussion', filter: { has_approval_history: true } },
    { name: 'Anomalies', description: 'Possible duplicates or outliers', filter: { has_duplicate_match: true } },
    { name: 'Low hygiene', description: 'Hygiene score < 60', filter: { max_hygiene_score: 60 } },
  ];
}

// F872: Run a quick-find search across vendor names (recent + frequency-ranked)
export function quickFindVendors(query: string, limit = 10) {
  try {
    const q = `%${(query || '').toLowerCase()}%`;
    return db.getDb().prepare(`SELECT v.id, v.name, COUNT(e.id) expense_count, MAX(e.date) last_used,
      SUM(e.amount) total_spent
      FROM vendors v
      LEFT JOIN expenses e ON e.vendor_id = v.id AND e.deleted_at IS NULL
      WHERE v.company_id = ? AND LOWER(v.name) LIKE ?
      GROUP BY v.id, v.name
      ORDER BY expense_count DESC, last_used DESC NULLS LAST
      LIMIT ?`).all(db.getCurrentCompanyId(), q, limit);
  } catch (e: any) { return []; }
}

// F873: Filter expenses by amount range with operators
export function filterByAmount(opts: { op: '>' | '<' | '=' | '>=' | '<=' | 'between'; value: number; value2?: number; limit?: number }) {
  try {
    let where = 'company_id = ? AND deleted_at IS NULL';
    const params: any[] = [db.getCurrentCompanyId()];
    if (opts.op === 'between' && opts.value2 != null) {
      where += ' AND amount BETWEEN ? AND ?';
      params.push(Math.min(opts.value, opts.value2), Math.max(opts.value, opts.value2));
    } else {
      const op = opts.op === '=' ? '=' : opts.op;
      where += ` AND amount ${op} ?`;
      params.push(opts.value);
    }
    params.push(opts.limit || 200);
    return db.getDb().prepare(`SELECT id, date, vendor_id, amount, description FROM expenses WHERE ${where} ORDER BY date DESC LIMIT ?`).all(...params);
  } catch (e: any) { return { error: e.message }; }
}

// F874: Filter by attachment status — has receipt vs missing
export function filterByAttachment(hasReceipt: boolean, limit = 200) {
  try {
    const where = hasReceipt
      ? `(receipt_path IS NOT NULL AND length(receipt_path) > 0) OR (receipts_json IS NOT NULL AND receipts_json != '[]' AND receipts_json != '')`
      : `(receipt_path IS NULL OR length(receipt_path) = 0) AND (receipts_json IS NULL OR receipts_json = '[]' OR receipts_json = '')`;
    return db.getDb().prepare(`SELECT id, date, vendor_id, amount, description, receipt_path FROM expenses WHERE company_id = ? AND deleted_at IS NULL AND (${where}) ORDER BY date DESC LIMIT ?`)
      .all(db.getCurrentCompanyId(), limit);
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch EC: Duplicate Detection & Hygiene (F875-F879)
// ════════════════════════════════════════════════════════════════════

// F875: Scan for likely duplicate expenses — vendor + amount + date proximity
export function scanDuplicates(opts?: { date_window_days?: number; amount_tolerance_cents?: number; min_confidence?: number }) {
  try {
    const dwd = opts?.date_window_days ?? 5;
    const atc = (opts?.amount_tolerance_cents ?? 1) / 100;
    const minConf = opts?.min_confidence ?? 0.7;
    const dbi = db.getDb();
    const cid = db.getCurrentCompanyId();
    const expenses = dbi.prepare(`SELECT id, vendor_id, amount, date, description FROM expenses WHERE company_id = ? AND deleted_at IS NULL ORDER BY date DESC LIMIT 1000`).all(cid) as any[];
    // Group by vendor for O(N) scan within each group
    const byVendor: Record<string, any[]> = {};
    for (const e of expenses) {
      const k = e.vendor_id || '__none__';
      if (!byVendor[k]) byVendor[k] = [];
      byVendor[k].push(e);
    }
    const matches: any[] = [];
    for (const group of Object.values(byVendor)) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i], b = group[j];
          const amountDelta = Math.abs((a.amount || 0) - (b.amount || 0));
          if (amountDelta > atc) continue;
          const dateA = new Date(a.date + 'T00:00:00Z').getTime();
          const dateB = new Date(b.date + 'T00:00:00Z').getTime();
          const dayDelta = Math.abs((dateA - dateB) / 86400000);
          if (dayDelta > dwd) continue;
          // Confidence: amount-exact = 0.5; date-same = 0.3; description-similar = 0.2
          let conf = 0.5;
          conf += (1 - (dayDelta / Math.max(1, dwd))) * 0.3;
          if ((a.description || '').toLowerCase() === (b.description || '').toLowerCase()) conf += 0.2;
          conf = Math.min(1, conf);
          if (conf < minConf) continue;
          const reasons: string[] = ['vendor match', 'amount match'];
          if (dayDelta === 0) reasons.push('same date');
          else reasons.push(`${Math.round(dayDelta)} days apart`);
          if ((a.description || '').toLowerCase() === (b.description || '').toLowerCase()) reasons.push('description match');
          matches.push({ expense_id: a.id, duplicate_of_id: b.id, confidence: round2(conf), match_reasons: reasons, a, b });
        }
      }
    }
    // Persist new matches; skip already-detected
    const insert = dbi.prepare(`INSERT OR IGNORE INTO expense_duplicate_matches (id, company_id, expense_id, duplicate_of_id, confidence, match_reasons_json) VALUES (?, ?, ?, ?, ?, ?)`);
    for (const m of matches) {
      insert.run(uuid(), cid, m.expense_id, m.duplicate_of_id, m.confidence, JSON.stringify(m.match_reasons));
    }
    return { matches_found: matches.length, matches };
  } catch (e: any) { return { error: e.message }; }
}

// F876: List expenses without receipts that are older than N days
export function expensesMissingReceipts(olderThanDays = 7) {
  try {
    const cutoff = new Date(Date.now() - olderThanDays * 86400000).toISOString().slice(0, 10);
    return db.getDb().prepare(`SELECT id, date, vendor_id, amount, description FROM expenses
      WHERE company_id = ? AND deleted_at IS NULL AND date <= ?
        AND (receipt_path IS NULL OR length(receipt_path) = 0)
        AND (receipts_json IS NULL OR receipts_json = '[]' OR receipts_json = '')
      ORDER BY date ASC LIMIT 200`)
      .all(db.getCurrentCompanyId(), cutoff);
  } catch (e: any) { return { error: e.message }; }
}

// F877: Resolve a duplicate match — mark as kept / merged / not-a-dupe
export function resolveDuplicateMatch(matchId: string, resolution: 'kept' | 'merged' | 'not_duplicate') {
  try {
    db.getDb().prepare(`UPDATE expense_duplicate_matches SET resolved = ?, resolution = ? WHERE id = ? AND company_id = ?`)
      .run(now(), resolution, matchId, db.getCurrentCompanyId());
    return { resolved: true };
  } catch (e: any) { return { error: e.message }; }
}

// F878: Compute hygiene score for one expense (0-100) and cache the result
export function computeHygieneScore(expenseId: string): { score: number; issues: string[] } {
  try {
    const e = db.getDb().prepare(`SELECT * FROM expenses WHERE id = ? AND company_id = ?`).get(expenseId, db.getCurrentCompanyId()) as any;
    if (!e) return { score: 0, issues: ['not found'] };
    let score = 100;
    const issues: string[] = [];
    // Receipt presence (-25)
    const hasReceipt = (e.receipt_path && e.receipt_path.length > 0) || (e.receipts_json && e.receipts_json !== '[]' && e.receipts_json !== '');
    if (!hasReceipt) { score -= 25; issues.push('No receipt attached'); }
    // Category (-15)
    if (!e.category_id) { score -= 15; issues.push('No category assigned'); }
    // Vendor (-15)
    if (!e.vendor_id) { score -= 15; issues.push('No vendor selected'); }
    // Description (-10)
    if (!e.description || e.description.trim().length < 3) { score -= 10; issues.push('Missing or too-short description'); }
    // Approval (-10)
    if (e.approval_status === 'rejected') { score -= 10; issues.push('Approval rejected'); }
    if (e.approval_status === 'pending' || !e.approval_status) {
      // age penalty if pending > 30 days
      const ageDays = e.created_at ? Math.floor((Date.now() - new Date(e.created_at).getTime()) / 86400000) : 0;
      if (ageDays > 30) { score -= 10; issues.push(`Pending approval for ${ageDays} days`); }
    }
    // Tax-deductibility flag explicitly set (-5 if null/uncertain)
    if (e.is_tax_deductible == null) { score -= 5; issues.push('Tax-deductibility not specified'); }
    // Has duplicate match (-20)
    const dupRow = db.getDb().prepare(`SELECT COUNT(*) c FROM expense_duplicate_matches WHERE company_id = ? AND (expense_id = ? OR duplicate_of_id = ?) AND (resolved IS NULL OR resolution != 'not_duplicate')`)
      .get(db.getCurrentCompanyId(), expenseId, expenseId) as any;
    if ((dupRow?.c || 0) > 0) { score -= 20; issues.push('Possible duplicate detected'); }
    score = Math.max(0, score);
    // Cache it
    try {
      db.getDb().prepare(`INSERT INTO expense_hygiene_scores (id, company_id, expense_id, score, issues_json) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(expense_id) DO UPDATE SET score = excluded.score, issues_json = excluded.issues_json, computed_at = datetime('now')`)
        .run(uuid(), db.getCurrentCompanyId(), expenseId, score, JSON.stringify(issues));
    } catch (_) {}
    return { score, issues };
  } catch (e: any) { return { score: 0, issues: [e.message] }; }
}

// F879: Bulk hygiene report — score every expense and return distribution
export function bulkHygieneReport(opts?: { limit?: number; recompute?: boolean }) {
  try {
    const dbi = db.getDb();
    const cid = db.getCurrentCompanyId();
    const rows = dbi.prepare(`SELECT id FROM expenses WHERE company_id = ? AND deleted_at IS NULL ORDER BY date DESC LIMIT ?`).all(cid, opts?.limit || 500) as any[];
    let computed = 0;
    let totalScore = 0;
    const buckets = { excellent: 0, good: 0, fair: 0, poor: 0 };
    for (const r of rows) {
      let scoreRow: any = null;
      if (!opts?.recompute) {
        scoreRow = dbi.prepare(`SELECT score, issues_json FROM expense_hygiene_scores WHERE expense_id = ?`).get(r.id);
      }
      const result = scoreRow ? { score: scoreRow.score, issues: JSON.parse(scoreRow.issues_json || '[]') } : computeHygieneScore(r.id);
      const s = result.score || 0;
      totalScore += s;
      if (s >= 90) buckets.excellent++;
      else if (s >= 70) buckets.good++;
      else if (s >= 50) buckets.fair++;
      else buckets.poor++;
      computed++;
    }
    return {
      total_expenses: computed,
      avg_score: computed > 0 ? Math.round(totalScore / computed) : 0,
      distribution: buckets,
    };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch ED: Approval Workflow (F880-F884)
// ════════════════════════════════════════════════════════════════════

// F880: Create an approval rule
export function createApprovalRule(opts: any) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO expense_approval_rules (id, company_id, name, priority, min_amount, max_amount, category_id, project_id, vendor_id, payment_method, is_billable, is_reimbursable, approver_user_id, approver_role, require_n_approvers, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
      .run(id, db.getCurrentCompanyId(), opts.name, opts.priority || 100, opts.min_amount || null, opts.max_amount || null, opts.category_id || null, opts.project_id || null, opts.vendor_id || null, opts.payment_method || null,
        opts.is_billable == null ? null : (opts.is_billable ? 1 : 0),
        opts.is_reimbursable == null ? null : (opts.is_reimbursable ? 1 : 0),
        opts.approver_user_id || null, opts.approver_role || null, opts.require_n_approvers || 1);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F881: Determine which approval rule applies to an expense (priority-ordered)
export function routeApprovalForExpense(expenseId: string) {
  try {
    const e = db.getDb().prepare(`SELECT * FROM expenses WHERE id = ? AND company_id = ?`).get(expenseId, db.getCurrentCompanyId()) as any;
    if (!e) return { matched: false };
    const rules = db.getDb().prepare(`SELECT * FROM expense_approval_rules WHERE company_id = ? AND active = 1 ORDER BY priority ASC`).all(db.getCurrentCompanyId()) as any[];
    for (const r of rules) {
      if (r.min_amount != null && e.amount < r.min_amount) continue;
      if (r.max_amount != null && e.amount > r.max_amount) continue;
      if (r.category_id && e.category_id !== r.category_id) continue;
      if (r.project_id && e.project_id !== r.project_id) continue;
      if (r.vendor_id && e.vendor_id !== r.vendor_id) continue;
      if (r.payment_method && e.payment_method !== r.payment_method) continue;
      if (r.is_billable != null && (e.is_billable || 0) !== r.is_billable) continue;
      if (r.is_reimbursable != null && (e.is_reimbursable || 0) !== r.is_reimbursable) continue;
      // Resolve delegation if approver is OOO
      const approver = resolveCurrentApprover(r.approver_user_id);
      return { matched: true, rule_id: r.id, rule_name: r.name, approver_user_id: approver, require_n_approvers: r.require_n_approvers || 1 };
    }
    return { matched: false };
  } catch (e: any) { return { error: e.message }; }
}

// Helper: resolve approver through active delegations
function resolveCurrentApprover(originalApproverId: string | null): string | null {
  if (!originalApproverId) return null;
  try {
    const todayStr = today();
    const delegation = db.getDb().prepare(`SELECT delegate_user_id FROM expense_approval_delegations WHERE company_id = ? AND delegator_user_id = ? AND active = 1 AND starts_at <= ? AND ends_at >= ? LIMIT 1`)
      .get(db.getCurrentCompanyId(), originalApproverId, todayStr, todayStr) as any;
    return delegation?.delegate_user_id || originalApproverId;
  } catch (_) { return originalApproverId; }
}

// F882: Create an out-of-office delegation
export function createApprovalDelegation(opts: { delegator_user_id: string; delegate_user_id: string; starts_at: string; ends_at: string; reason?: string }) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO expense_approval_delegations (id, company_id, delegator_user_id, delegate_user_id, starts_at, ends_at, reason, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`)
      .run(id, db.getCurrentCompanyId(), opts.delegator_user_id, opts.delegate_user_id, opts.starts_at, opts.ends_at, opts.reason || null);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F883: Get approval history for an expense (timeline view)
export function getApprovalHistory(expenseId: string) {
  try {
    return db.getDb().prepare(`SELECT h.*, u.name actor_name FROM expense_approval_history h
      LEFT JOIN users u ON h.actor_user_id = u.id
      WHERE h.expense_id = ? AND h.company_id = ?
      ORDER BY h.created_at ASC`)
      .all(expenseId, db.getCurrentCompanyId());
  } catch (e: any) { return []; }
}

// F884: Approval SLA report — avg time from submitted → approved per approver
export function approvalSlaReport(days = 90) {
  try {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    return db.getDb().prepare(`SELECT actor_user_id, COUNT(*) approvals, AVG(julianday(h.created_at) - julianday(e.created_at)) * 24 avg_hours
      FROM expense_approval_history h
      INNER JOIN expenses e ON h.expense_id = e.id
      WHERE h.company_id = ? AND h.action = 'approved' AND h.created_at >= ?
      GROUP BY actor_user_id ORDER BY avg_hours ASC`)
      .all(db.getCurrentCompanyId(), cutoff);
  } catch (e: any) { return []; }
}

// ════════════════════════════════════════════════════════════════════
// Batch EE: Insights & Analytics (F885-F889)
// ════════════════════════════════════════════════════════════════════

// F885: Top vendors by spend (with month/year filters)
export function topVendorsBySpend(opts?: { since?: string; until?: string; limit?: number }) {
  try {
    const since = opts?.since || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const until = opts?.until || today();
    return db.getDb().prepare(`SELECT v.id, v.name, COUNT(e.id) expense_count, SUM(e.amount + COALESCE(e.tax_amount, 0)) total_spent, MAX(e.date) last_date
      FROM expenses e
      LEFT JOIN vendors v ON e.vendor_id = v.id
      WHERE e.company_id = ? AND e.deleted_at IS NULL AND e.date BETWEEN ? AND ?
      GROUP BY v.id, v.name
      ORDER BY total_spent DESC
      LIMIT ?`).all(db.getCurrentCompanyId(), since, until, opts?.limit || 10);
  } catch (e: any) { return []; }
}

// F886: Category spend rollup
export function categorySpendRollup(opts?: { since?: string; until?: string }) {
  try {
    const since = opts?.since || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const until = opts?.until || today();
    return db.getDb().prepare(`SELECT c.id, c.name, c.color, COUNT(e.id) expense_count, SUM(e.amount + COALESCE(e.tax_amount, 0)) total_spent
      FROM expenses e
      LEFT JOIN categories c ON e.category_id = c.id
      WHERE e.company_id = ? AND e.deleted_at IS NULL AND e.date BETWEEN ? AND ?
      GROUP BY c.id, c.name, c.color
      ORDER BY total_spent DESC`)
      .all(db.getCurrentCompanyId(), since, until);
  } catch (e: any) { return []; }
}

// F887: Anomaly detection — flag expenses that are ≥ N× the rolling category average
export function detectExpenseAnomalies(thresholdMultiplier = 2.5) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    // Compute per-category average over last 90 days
    const averages = dbi.prepare(`SELECT category_id, AVG(amount) avg_amount, COUNT(*) sample_size
      FROM expenses WHERE company_id = ? AND deleted_at IS NULL AND date >= date('now', '-90 days')
      AND category_id IS NOT NULL GROUP BY category_id HAVING sample_size >= 3`).all(cid) as any[];
    const avgMap = Object.fromEntries(averages.map((a: any) => [a.category_id, a.avg_amount]));
    const recent = dbi.prepare(`SELECT e.id, e.date, e.amount, e.description, e.category_id, c.name category_name
      FROM expenses e LEFT JOIN categories c ON e.category_id = c.id
      WHERE e.company_id = ? AND e.deleted_at IS NULL AND e.date >= date('now', '-30 days')
      ORDER BY e.date DESC`).all(cid) as any[];
    const anomalies = recent.filter((e: any) => {
      const avg = avgMap[e.category_id];
      if (!avg || avg <= 0) return false;
      return e.amount >= avg * thresholdMultiplier;
    }).map((e: any) => ({
      ...e,
      category_avg: round2(avgMap[e.category_id]),
      multiplier: round2(e.amount / avgMap[e.category_id]),
    }));
    return anomalies;
  } catch (e: any) { return []; }
}

// F888: Monthly spend trend — 12-month sparkline data
export function monthlyTrend(monthsBack = 12) {
  try {
    return db.getDb().prepare(`SELECT substr(date, 1, 7) month, SUM(amount + COALESCE(tax_amount, 0)) total, COUNT(*) count
      FROM expenses
      WHERE company_id = ? AND deleted_at IS NULL AND date >= date('now', '-' || ? || ' months')
      GROUP BY month ORDER BY month ASC`)
      .all(db.getCurrentCompanyId(), monthsBack);
  } catch (e: any) { return []; }
}

// F889: Budget burn-down per category (current month spend vs budget)
export function budgetBurnDown(month?: string) {
  try {
    const m = month || today().slice(0, 7);
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    // Spend per category this month
    const spend = dbi.prepare(`SELECT category_id, SUM(amount + COALESCE(tax_amount, 0)) spent FROM expenses
      WHERE company_id = ? AND deleted_at IS NULL AND substr(date, 1, 7) = ? AND category_id IS NOT NULL
      GROUP BY category_id`).all(cid, m) as any[];
    // Budget per category (if budgets table has rows for this month)
    let budgets: any[] = [];
    try {
      budgets = dbi.prepare(`SELECT category_id, amount budget FROM budget_lines WHERE company_id = ? AND period_start <= ? AND period_end >= ? AND category_id IS NOT NULL`)
        .all(cid, m + '-31', m + '-01') as any[];
    } catch (_) {}
    const budgetMap = Object.fromEntries(budgets.map((b: any) => [b.category_id, b.budget]));
    return spend.map((s: any) => {
      const budget = budgetMap[s.category_id] || 0;
      const pct = budget > 0 ? round2((s.spent / budget) * 100) : null;
      return { category_id: s.category_id, spent: round2(s.spent), budget: round2(budget), pct_of_budget: pct, status: pct == null ? 'no_budget' : pct >= 100 ? 'over' : pct >= 80 ? 'warning' : 'on_track' };
    });
  } catch (e: any) { return []; }
}

// ════════════════════════════════════════════════════════════════════
// Batch EF: UX Power (F890-F892)
// ════════════════════════════════════════════════════════════════════

// F890: Detect potentially recurring expenses (3+ similar charges with consistent cadence)
export function detectRecurringCandidates() {
  try {
    const cid = db.getCurrentCompanyId();
    const candidates = db.getDb().prepare(`SELECT vendor_id, amount, COUNT(*) freq, MIN(date) first_seen, MAX(date) last_seen,
      (julianday(MAX(date)) - julianday(MIN(date))) / (COUNT(*) - 1) avg_cadence_days
      FROM expenses
      WHERE company_id = ? AND deleted_at IS NULL AND vendor_id IS NOT NULL
      AND date >= date('now', '-365 days')
      GROUP BY vendor_id, amount
      HAVING freq >= 3
      ORDER BY freq DESC LIMIT 20`).all(cid) as any[];
    return candidates.map((c: any) => ({
      ...c,
      cadence: c.avg_cadence_days >= 25 && c.avg_cadence_days <= 35 ? 'monthly'
        : c.avg_cadence_days >= 6 && c.avg_cadence_days <= 8 ? 'weekly'
          : c.avg_cadence_days >= 13 && c.avg_cadence_days <= 15 ? 'biweekly'
            : c.avg_cadence_days >= 85 && c.avg_cadence_days <= 95 ? 'quarterly'
              : c.avg_cadence_days >= 360 && c.avg_cadence_days <= 370 ? 'annual'
                : 'irregular',
      avg_cadence_days: round2(c.avg_cadence_days),
    }));
  } catch (e: any) { return []; }
}

// F891: Save expense draft (auto-save support — overwrites latest per user)
export function saveExpenseDraft(opts: { user_id?: string; draft: any }) {
  try {
    const cid = db.getCurrentCompanyId();
    const userId = opts.user_id || '';
    const existing = db.getDb().prepare(`SELECT id FROM expense_drafts WHERE company_id = ? AND user_id = ? LIMIT 1`).get(cid, userId) as any;
    if (existing) {
      db.getDb().prepare(`UPDATE expense_drafts SET draft_json = ?, last_saved_at = ? WHERE id = ?`)
        .run(JSON.stringify(opts.draft || {}), now(), existing.id);
      return { id: existing.id, saved: true };
    }
    const id = uuid();
    db.getDb().prepare(`INSERT INTO expense_drafts (id, company_id, user_id, draft_json, last_saved_at) VALUES (?, ?, ?, ?, ?)`)
      .run(id, cid, userId, JSON.stringify(opts.draft || {}), now());
    return { id, saved: true };
  } catch (e: any) { return { error: e.message }; }
}

// F892: Recover latest expense draft for a user
export function getLatestDraft(userId?: string) {
  try {
    const cid = db.getCurrentCompanyId();
    const row = db.getDb().prepare(`SELECT * FROM expense_drafts WHERE company_id = ? AND user_id = ? ORDER BY last_saved_at DESC LIMIT 1`)
      .get(cid, userId || '') as any;
    if (!row) return null;
    return { id: row.id, draft: JSON.parse(row.draft_json || '{}'), last_saved_at: row.last_saved_at };
  } catch (e: any) { return { error: e.message }; }
}

// Bonus utility (not counted in F863-F892): clear all drafts for current user
export function clearDraft(userId?: string) {
  try {
    db.getDb().prepare(`DELETE FROM expense_drafts WHERE company_id = ? AND user_id = ?`).run(db.getCurrentCompanyId(), userId || '');
    return { cleared: true };
  } catch (e: any) { return { error: e.message }; }
}
