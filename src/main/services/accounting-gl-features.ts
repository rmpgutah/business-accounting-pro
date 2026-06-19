// ─── Accounting Deep-Dive Part 1: F171-F225 (55 features) ───
//
// Batch A: GL & JE Operations (F171-F185)
// Batch B: Chart of Accounts (F186-F195)
// Batch C: Period Close + Adjustments (F196-F205)
// Batch D: Fixed Assets Advanced (F206-F215)
// Batch E: Revenue Recognition (F216-F225)

import { randomUUID as uuid } from 'crypto';
import * as db from '../database';

const now = (): string => new Date().toISOString();
const today = (): string => now().slice(0, 10);
const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  if (d.getUTCDate() !== day) d.setUTCDate(0); // clamp to last day
  return d.toISOString().slice(0, 10);
}

// ════════════════════════════════════════════════════════════════
// Batch A: GL & JE Operations
// ════════════════════════════════════════════════════════════════

// F171 — recurring journal entries
export function upsertRecurringJE(r: any): any {
  const dbi = db.getDb();
  const id = r.id || uuid();
  if (r.id) {
    dbi.prepare(`UPDATE recurring_je_definitions SET name = ?, description = ?, frequency = ?, start_date = ?, end_date = ?, next_run_date = ?, template_lines_json = ?, auto_post = ?, is_paused = ?, notes = ?, updated_at = ? WHERE id = ?`)
      .run(r.name, r.description || null, r.frequency || 'monthly', r.start_date, r.end_date || null, r.next_run_date, JSON.stringify(r.template_lines || []), r.auto_post ? 1 : 0, r.is_paused ? 1 : 0, r.notes || null, now(), r.id);
  } else {
    dbi.prepare(`INSERT INTO recurring_je_definitions (id, company_id, name, description, frequency, start_date, end_date, next_run_date, template_lines_json, auto_post, is_paused, notes, created_at, updated_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`)
      .run(id, r.company_id, r.name, r.description || null, r.frequency || 'monthly', r.start_date, r.end_date || null, r.next_run_date || r.start_date, JSON.stringify(r.template_lines || []), r.auto_post ? 1 : 0, r.notes || null, now(), now(), r.created_by || null);
  }
  return { id, ...r };
}

export function listRecurringJEs(companyId: string, opts?: { active_only?: boolean }): any[] {
  const dbi = db.getDb();
  let where = 'company_id = ?';
  if (opts?.active_only) where += ' AND is_paused = 0';
  return dbi.prepare(`SELECT * FROM recurring_je_definitions WHERE ${where} ORDER BY next_run_date ASC`).all(companyId) as any[];
}

export function dueRecurringJEs(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM recurring_je_definitions WHERE company_id = ? AND is_paused = 0 AND next_run_date <= date('now') AND (end_date IS NULL OR end_date >= date('now')) ORDER BY next_run_date ASC`).all(companyId) as any[];
}

export function advanceRecurringJE(id: string): { next_run_date: string; run_count: number } {
  const dbi = db.getDb();
  const r = dbi.prepare(`SELECT * FROM recurring_je_definitions WHERE id = ?`).get(id) as any;
  if (!r) throw new Error('Recurring JE not found');
  const months = r.frequency === 'monthly' ? 1 : r.frequency === 'quarterly' ? 3 : r.frequency === 'annual' ? 12 : 0;
  const days = r.frequency === 'weekly' ? 7 : r.frequency === 'biweekly' ? 14 : r.frequency === 'daily' ? 1 : 0;
  let nextRun = r.next_run_date;
  if (months > 0) nextRun = addMonths(nextRun, months);
  else if (days > 0) {
    const d = new Date(nextRun + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    nextRun = d.toISOString().slice(0, 10);
  }
  const newCount = (r.run_count || 0) + 1;
  dbi.prepare(`UPDATE recurring_je_definitions SET last_run_date = ?, next_run_date = ?, run_count = ?, updated_at = ? WHERE id = ?`)
    .run(today(), nextRun, newCount, now(), id);
  return { next_run_date: nextRun, run_count: newCount };
}

export function pauseRecurringJE(id: string, paused: boolean = true): boolean {
  const r = db.getDb().prepare(`UPDATE recurring_je_definitions SET is_paused = ?, updated_at = ? WHERE id = ?`).run(paused ? 1 : 0, now(), id);
  return r.changes > 0;
}

// F172 — reversing JE link
export function markJEReversing(jeId: string, reverseOnDate: string): boolean {
  const r = db.getDb().prepare(`UPDATE journal_entries SET is_reversing = 1, reverse_on_date = ? WHERE id = ?`).run(reverseOnDate, jeId);
  return r.changes > 0;
}

export function linkReversingJE(originalJeId: string, reversingJeId: string): boolean {
  const dbi = db.getDb();
  dbi.prepare(`UPDATE journal_entries SET reversing_je_id = ?, reversed_at = ? WHERE id = ?`).run(reversingJeId, now(), originalJeId);
  return true;
}

export function dueReversingEntries(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM journal_entries WHERE company_id = ? AND is_reversing = 1 AND reverse_on_date <= date('now') AND reversing_je_id IS NULL AND is_posted = 1`).all(companyId) as any[];
}

// F173 — JE templates
export function upsertJETemplate(t: any): any {
  const dbi = db.getDb();
  const id = t.id || uuid();
  if (t.id) {
    dbi.prepare(`UPDATE je_templates SET name = ?, description = ?, category = ?, lines_json = ?, is_active = ?, updated_at = ? WHERE id = ?`)
      .run(t.name, t.description || null, t.category || 'general', JSON.stringify(t.lines || []), t.is_active === false ? 0 : 1, now(), t.id);
  } else {
    dbi.prepare(`INSERT INTO je_templates (id, company_id, name, description, category, lines_json, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, t.company_id, t.name, t.description || null, t.category || 'general', JSON.stringify(t.lines || []), t.is_active === false ? 0 : 1, now(), now());
  }
  return { id, ...t };
}

export function listJETemplates(companyId: string, category?: string): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ? AND is_active = 1';
  if (category) { where += ' AND category = ?'; params.push(category); }
  return dbi.prepare(`SELECT * FROM je_templates WHERE ${where} ORDER BY use_count DESC, name ASC`).all(...params) as any[];
}

export function incrementTemplateUse(id: string): void {
  db.getDb().prepare(`UPDATE je_templates SET use_count = use_count + 1 WHERE id = ?`).run(id);
}

// F174 — multi-currency JE (FX info stored on JE row, calculation helper)
export function calcFxAdjustment(amount: number, fromRate: number, toRate: number): number {
  if (!fromRate || !toRate) return 0;
  return round2(amount * (toRate - fromRate));
}

// F175 — inter-company JE pairing
export function pairInterCompanyJEs(parentJeId: string, counterpartyJeId: string, parentCompanyId: string, counterpartyCompanyId: string, notes?: string): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO inter_company_je_pairs (id, parent_je_id, counterparty_je_id, parent_company_id, counterparty_company_id, paired_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, parentJeId, counterpartyJeId, parentCompanyId, counterpartyCompanyId, now(), notes || null);
  return { id };
}

export function listInterCompanyPairs(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM inter_company_je_pairs WHERE parent_company_id = ? OR counterparty_company_id = ? ORDER BY paired_date DESC`).all(companyId, companyId) as any[];
}

// F176 — JE bulk import session
export function startJEImport(companyId: string, fileName: string, importedBy?: string): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO je_import_sessions (id, company_id, file_name, row_count, imported_at, imported_by) VALUES (?, ?, ?, 0, ?, ?)`)
    .run(id, companyId, fileName, now(), importedBy || null);
  return { id };
}

export function finishJEImport(sessionId: string, summary: { row_count: number; success_count: number; error_count: number; errors: any[] }): boolean {
  const r = db.getDb().prepare(`UPDATE je_import_sessions SET row_count = ?, success_count = ?, error_count = ?, errors_json = ? WHERE id = ?`)
    .run(summary.row_count, summary.success_count, summary.error_count, JSON.stringify(summary.errors || []), sessionId);
  return r.changes > 0;
}

export function listJEImports(companyId: string, limit: number = 50): any[] {
  return db.getDb().prepare(`SELECT * FROM je_import_sessions WHERE company_id = ? ORDER BY imported_at DESC LIMIT ?`).all(companyId, Math.min(limit, 500)) as any[];
}

// F177 — JE clone with date shift (helper returns line array to feed into JE creation)
export function cloneJELines(sourceJeId: string): any[] {
  return db.getDb().prepare(`SELECT account_id, debit, credit, description FROM journal_entry_lines WHERE journal_entry_id = ? ORDER BY rowid`).all(sourceJeId) as any[];
}

// F178 — JE attachments
export function addJEAttachment(a: any): any {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO je_attachments (id, je_id, file_name, file_path, mime_type, file_size, uploaded_at, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, a.je_id, a.file_name, a.file_path || null, a.mime_type || null, a.file_size || 0, now(), a.uploaded_by || null);
  return { id };
}

export function listJEAttachments(jeId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM je_attachments WHERE je_id = ? ORDER BY uploaded_at DESC`).all(jeId) as any[];
}

// F179 — pause/resume already in pauseRecurringJE

// F180 — JE allocation rules
export function upsertAllocationRule(r: any): any {
  const dbi = db.getDb();
  const id = r.id || uuid();
  if (r.id) {
    dbi.prepare(`UPDATE je_allocation_rules SET name = ?, source_account_id = ?, allocation_method = ?, targets_json = ?, is_active = ?, updated_at = ? WHERE id = ?`)
      .run(r.name, r.source_account_id || null, r.allocation_method || 'percent', JSON.stringify(r.targets || []), r.is_active === false ? 0 : 1, now(), r.id);
  } else {
    dbi.prepare(`INSERT INTO je_allocation_rules (id, company_id, name, source_account_id, allocation_method, targets_json, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, r.company_id, r.name, r.source_account_id || null, r.allocation_method || 'percent', JSON.stringify(r.targets || []), r.is_active === false ? 0 : 1, now(), now());
  }
  return { id, ...r };
}

export function applyAllocation(ruleId: string, totalAmount: number): any[] {
  const dbi = db.getDb();
  const rule = dbi.prepare(`SELECT * FROM je_allocation_rules WHERE id = ?`).get(ruleId) as any;
  if (!rule) throw new Error('Rule not found');
  const targets = JSON.parse(rule.targets_json || '[]');
  const lines: any[] = [];
  if (rule.allocation_method === 'percent') {
    for (const t of targets) {
      lines.push({ account_id: t.account_id, amount: round2(totalAmount * (t.percent || 0) / 100), description: t.label || null });
    }
  } else if (rule.allocation_method === 'fixed') {
    for (const t of targets) {
      lines.push({ account_id: t.account_id, amount: round2(t.amount || 0), description: t.label || null });
    }
  } else if (rule.allocation_method === 'evenly') {
    const each = round2(totalAmount / Math.max(targets.length, 1));
    for (const t of targets) {
      lines.push({ account_id: t.account_id, amount: each, description: t.label || null });
    }
  }
  return lines;
}

export function listAllocationRules(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM je_allocation_rules WHERE company_id = ? ORDER BY name`).all(companyId) as any[];
}

// F181 — auto-allocation by cost center (uses allocation rules)
// F182 — narratives
export function upsertNarrative(n: any): any {
  const dbi = db.getDb();
  const id = n.id || uuid();
  if (n.id) {
    dbi.prepare(`UPDATE je_narratives SET template_text = ? WHERE id = ?`).run(n.template_text, n.id);
  } else {
    dbi.prepare(`INSERT INTO je_narratives (id, company_id, slug, template_text, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(company_id, slug) DO UPDATE SET template_text = excluded.template_text`)
      .run(id, n.company_id, n.slug, n.template_text, now());
  }
  return { id, ...n };
}

export function renderNarrative(companyId: string, slug: string, vars: Record<string, any>): string {
  const r = db.getDb().prepare(`SELECT template_text FROM je_narratives WHERE company_id = ? AND slug = ?`).get(companyId, slug) as any;
  if (!r) return '';
  let txt = r.template_text;
  for (const [k, v] of Object.entries(vars)) txt = txt.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v ?? ''));
  db.getDb().prepare(`UPDATE je_narratives SET use_count = use_count + 1 WHERE company_id = ? AND slug = ?`).run(companyId, slug);
  return txt;
}

export function listNarratives(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM je_narratives WHERE company_id = ? ORDER BY use_count DESC`).all(companyId) as any[];
}

// F183 — JE proof (balance check)
export function proofJELines(lines: Array<{ debit?: number; credit?: number }>): { total_debit: number; total_credit: number; difference: number; is_balanced: boolean } {
  const totalDebit = round2(lines.reduce((s, l) => s + (l.debit || 0), 0));
  const totalCredit = round2(lines.reduce((s, l) => s + (l.credit || 0), 0));
  const diff = round2(totalDebit - totalCredit);
  return { total_debit: totalDebit, total_credit: totalCredit, difference: diff, is_balanced: Math.abs(diff) < 0.005 };
}

// F184 — batch posting
export function batchPostJEs(jeIds: string[]): { posted: number; failed: number; errors: any[] } {
  const dbi = db.getDb();
  let posted = 0, failed = 0;
  const errors: any[] = [];
  const tx = dbi.transaction(() => {
    for (const id of jeIds) {
      try {
        // Validate balance before post
        const lines = dbi.prepare(`SELECT debit, credit FROM journal_entry_lines WHERE journal_entry_id = ?`).all(id) as any[];
        const proof = proofJELines(lines);
        if (!proof.is_balanced) {
          failed++;
          errors.push({ id, error: `Unbalanced: debit=${proof.total_debit} credit=${proof.total_credit}` });
          continue;
        }
        dbi.prepare(`UPDATE journal_entries SET is_posted = 1, updated_at = ? WHERE id = ? AND is_posted = 0`).run(now(), id);
        posted++;
      } catch (e: any) {
        failed++;
        errors.push({ id, error: e?.message });
      }
    }
  });
  tx();
  return { posted, failed, errors };
}

// F185 — JE comments (use existing je_comments table)
export function addJEComment(jeId: string, userId: string, userEmail: string, comment: string): any {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO je_comments (id, je_id, user_id, user_email, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, jeId, userId, userEmail, comment, now());
  return { id };
}

export function listJEComments(jeId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM je_comments WHERE je_id = ? ORDER BY created_at ASC`).all(jeId) as any[];
}

// ════════════════════════════════════════════════════════════════
// Batch B: Chart of Accounts (F186-F195)
// ════════════════════════════════════════════════════════════════

// F186 — account hierarchy
export function setAccountParent(accountId: string, parentAccountId: string | null): boolean {
  const dbi = db.getDb();
  let depth = 0;
  if (parentAccountId) {
    const parent = dbi.prepare(`SELECT level_depth FROM accounts WHERE id = ?`).get(parentAccountId) as any;
    depth = (parent?.level_depth || 0) + 1;
  }
  const r = dbi.prepare(`UPDATE accounts SET parent_account_id = ?, level_depth = ?, updated_at = ? WHERE id = ?`).run(parentAccountId, depth, now(), accountId);
  return r.changes > 0;
}

export function getAccountTree(companyId: string): any[] {
  const dbi = db.getDb();
  const all = dbi.prepare(`SELECT id, code, name, parent_account_id, account_type, level_depth, (deleted_at IS NULL OR deleted_at = '') AS is_active FROM accounts WHERE company_id = ?`).all(companyId) as any[];
  const map = new Map<string, any>();
  const roots: any[] = [];
  for (const a of all) { (a as any).children = []; map.set(a.id, a); }
  for (const a of all) {
    if (a.parent_account_id && map.has(a.parent_account_id)) {
      map.get(a.parent_account_id).children.push(a);
    } else {
      roots.push(a);
    }
  }
  return roots;
}

// F187 — account merge
export function mergeAccounts(primaryId: string, duplicateIds: string[]): { merged: number; affected_je_lines: number } {
  const dbi = db.getDb();
  let totalLines = 0;
  const tx = dbi.transaction(() => {
    for (const dupId of duplicateIds) {
      const r = dbi.prepare(`UPDATE journal_entry_lines SET account_id = ? WHERE account_id = ?`).run(primaryId, dupId);
      totalLines += r.changes;
      dbi.prepare(`UPDATE accounts SET deleted_at = ?, closed_reason = 'Merged into ' || ? WHERE id = ?`).run(now(), primaryId, dupId);
    }
  });
  tx();
  return { merged: duplicateIds.length, affected_je_lines: totalLines };
}

// F188 — renumber log
export function renumberAccount(accountId: string, newCode: string, renamedBy?: string, notes?: string): any {
  const dbi = db.getDb();
  const acct = dbi.prepare(`SELECT code, company_id FROM accounts WHERE id = ?`).get(accountId) as any;
  if (!acct) throw new Error('Account not found');
  const logId = uuid();
  dbi.prepare(`INSERT INTO account_renumber_log (id, company_id, account_id, old_code, new_code, renamed_by, renamed_at, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(logId, acct.company_id, accountId, acct.code, newCode, renamedBy || null, now(), notes || null);
  dbi.prepare(`UPDATE accounts SET code = ?, updated_at = ? WHERE id = ?`).run(newCode, now(), accountId);
  return { id: logId, old_code: acct.code, new_code: newCode };
}

// F189 — roll-up reporting
export function rollUpAccountBalances(companyId: string, asOfDate?: string): any[] {
  const dbi = db.getDb();
  const date = asOfDate || today();
  const balances = dbi.prepare(`
    SELECT a.id, a.code, a.name, a.parent_account_id, a.account_type,
      COALESCE(SUM(jel.debit) - SUM(jel.credit), 0) AS balance
      FROM accounts a
      LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
      LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.is_posted = 1 AND je.entry_date <= ?
     WHERE a.company_id = ? AND (a.deleted_at IS NULL OR a.deleted_at = '')
     GROUP BY a.id
  `).all(date, companyId) as any[];

  // Roll-up child balances into parents
  const map = new Map<string, any>();
  for (const a of balances) { (a as any).rolled_up_balance = a.balance; map.set(a.id, a); }
  for (const a of balances) {
    let parentId = a.parent_account_id;
    while (parentId && map.has(parentId)) {
      map.get(parentId).rolled_up_balance += a.balance;
      parentId = map.get(parentId).parent_account_id;
    }
  }
  return balances;
}

// F190 — suspense
export function setAsSuspense(accountId: string, isSuspense: boolean = true): boolean {
  const r = db.getDb().prepare(`UPDATE accounts SET is_suspense = ?, updated_at = ? WHERE id = ?`).run(isSuspense ? 1 : 0, now(), accountId);
  return r.changes > 0;
}

export function getSuspenseAccount(companyId: string): any | null {
  return db.getDb().prepare(`SELECT * FROM accounts WHERE company_id = ? AND is_suspense = 1 LIMIT 1`).get(companyId) || null;
}

// F191 — close account
export function closeAccount(accountId: string, reason?: string): boolean {
  const r = db.getDb().prepare(`UPDATE accounts SET closed_at = ?, closed_reason = ?, updated_at = ? WHERE id = ?`).run(now(), reason || null, now(), accountId);
  return r.changes > 0;
}

export function reopenAccount(accountId: string): boolean {
  const r = db.getDb().prepare(`UPDATE accounts SET closed_at = NULL, closed_reason = NULL, updated_at = ? WHERE id = ?`).run(now(), accountId);
  return r.changes > 0;
}

// F192 — tax-line mapping
export function setAccountTaxMapping(accountId: string, taxLineCode: string | null, taxForm?: string | null): boolean {
  const r = db.getDb().prepare(`UPDATE accounts SET tax_line_code = ?, tax_form = ?, updated_at = ? WHERE id = ?`).run(taxLineCode, taxForm || null, now(), accountId);
  return r.changes > 0;
}

export function getAccountsByTaxLine(companyId: string, taxLineCode: string): any[] {
  return db.getDb().prepare(`SELECT * FROM accounts WHERE company_id = ? AND tax_line_code = ?`).all(companyId, taxLineCode) as any[];
}

// F193 — cash-flow mapping
export function setAccountCashFlowMapping(accountId: string, section: string, subsection?: string | null): boolean {
  const r = db.getDb().prepare(`UPDATE accounts SET cash_flow_section = ?, cash_flow_subsection = ?, updated_at = ? WHERE id = ?`).run(section, subsection || null, now(), accountId);
  return r.changes > 0;
}

// F194 — default mapping for templates (uses je_templates lines)
// F195 — opening balances
export function setOpeningBalance(b: any): any {
  const dbi = db.getDb();
  const id = uuid();
  dbi.prepare(`INSERT INTO opening_balances (id, company_id, account_id, as_of_date, debit_balance, credit_balance, fiscal_year, notes, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(company_id, account_id, as_of_date) DO UPDATE SET debit_balance = excluded.debit_balance, credit_balance = excluded.credit_balance, notes = excluded.notes`)
    .run(id, b.company_id, b.account_id, b.as_of_date, b.debit_balance || 0, b.credit_balance || 0, b.fiscal_year || null, b.notes || null, now());
  return { id, ...b };
}

export function listOpeningBalances(companyId: string, asOfDate?: string): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (asOfDate) { where += ' AND as_of_date = ?'; params.push(asOfDate); }
  return dbi.prepare(`SELECT * FROM opening_balances WHERE ${where} ORDER BY as_of_date DESC, account_id`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// Batch C: Period Close + Adjustments (F196-F205)
// ════════════════════════════════════════════════════════════════

// F196 — close templates
export function upsertCloseTemplate(t: any): any {
  const dbi = db.getDb();
  const id = t.id || uuid();
  if (t.id) {
    dbi.prepare(`UPDATE period_close_templates SET name = ?, period_type = ?, tasks_json = ?, is_default = ?, updated_at = ? WHERE id = ?`)
      .run(t.name, t.period_type || 'monthly', JSON.stringify(t.tasks || []), t.is_default ? 1 : 0, now(), t.id);
  } else {
    dbi.prepare(`INSERT INTO period_close_templates (id, company_id, name, period_type, tasks_json, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, t.company_id, t.name, t.period_type || 'monthly', JSON.stringify(t.tasks || []), t.is_default ? 1 : 0, now(), now());
  }
  return { id, ...t };
}

export function listCloseTemplates(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM period_close_templates WHERE company_id = ? ORDER BY is_default DESC, name`).all(companyId) as any[];
}

// F197 — accrual entries
export function createAccrual(a: any): any {
  const dbi = db.getDb();
  const id = uuid();
  dbi.prepare(`INSERT INTO accrual_entries (id, company_id, accrual_type, description, accrual_date, reverse_date, amount, debit_account_id, credit_account_id, status, supporting_doc, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`)
    .run(id, a.company_id, a.accrual_type || 'expense', a.description, a.accrual_date, a.reverse_date || null, a.amount || 0, a.debit_account_id || null, a.credit_account_id || null, a.supporting_doc || null, a.notes || null, now(), a.created_by || null);
  return { id };
}

export function postAccrual(accrualId: string, postedJeId: string): boolean {
  const r = db.getDb().prepare(`UPDATE accrual_entries SET posted_je_id = ?, status = 'posted' WHERE id = ?`).run(postedJeId, accrualId);
  return r.changes > 0;
}

// F198 — due reversals
export function dueAccrualReversals(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM accrual_entries WHERE company_id = ? AND status = 'posted' AND is_reversed = 0 AND reverse_date <= date('now')`).all(companyId) as any[];
}

export function markAccrualReversed(accrualId: string, reversalJeId: string): boolean {
  const r = db.getDb().prepare(`UPDATE accrual_entries SET is_reversed = 1, reversal_je_id = ?, status = 'reversed' WHERE id = ?`).run(reversalJeId, accrualId);
  return r.changes > 0;
}

export function listAccruals(companyId: string, opts?: { status?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  return dbi.prepare(`SELECT * FROM accrual_entries WHERE ${where} ORDER BY accrual_date DESC`).all(...params) as any[];
}

// F199 — prepaid amortization
export function createPrepaidSchedule(s: any): any {
  const dbi = db.getDb();
  const id = uuid();
  const periods = s.amortization_periods || 12;
  const periodAmount = round2((s.total_amount || 0) / periods);
  dbi.prepare(`INSERT INTO prepaid_schedules (id, company_id, description, vendor_id, total_amount, start_date, end_date, amortization_periods, period_amount, prepaid_account_id, expense_account_id, status, next_recognition_date, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`)
    .run(id, s.company_id, s.description, s.vendor_id || null, s.total_amount || 0, s.start_date, s.end_date, periods, periodAmount, s.prepaid_account_id || null, s.expense_account_id || null, s.start_date, s.notes || null, now(), now());
  return { id, period_amount: periodAmount };
}

export function recognizePrepaid(scheduleId: string, recognitionDate: string, postedJeId?: string): { recognized_amount: number; periods_remaining: number } {
  const dbi = db.getDb();
  const s = dbi.prepare(`SELECT * FROM prepaid_schedules WHERE id = ?`).get(scheduleId) as any;
  if (!s) throw new Error('Schedule not found');
  if (s.periods_recognized >= s.amortization_periods) throw new Error('Already fully recognized');
  const recId = uuid();
  dbi.prepare(`INSERT INTO prepaid_recognitions (id, schedule_id, recognition_date, amount, posted_je_id, posted_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(recId, scheduleId, recognitionDate, s.period_amount, postedJeId || null, now());
  const newCount = s.periods_recognized + 1;
  const nextDate = addMonths(recognitionDate, 1);
  const status = newCount >= s.amortization_periods ? 'completed' : 'active';
  dbi.prepare(`UPDATE prepaid_schedules SET periods_recognized = ?, next_recognition_date = ?, status = ?, updated_at = ? WHERE id = ?`)
    .run(newCount, nextDate, status, now(), scheduleId);
  return { recognized_amount: s.period_amount, periods_remaining: s.amortization_periods - newCount };
}

export function duePrepaidRecognitions(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM prepaid_schedules WHERE company_id = ? AND status = 'active' AND next_recognition_date <= date('now')`).all(companyId) as any[];
}

export function listPrepaidSchedules(companyId: string, opts?: { status?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  return dbi.prepare(`SELECT * FROM prepaid_schedules WHERE ${where} ORDER BY next_recognition_date`).all(...params) as any[];
}

// F200 — deferred revenue (parallel to prepaid)
export function createDeferredRevenueSchedule(s: any): any {
  const dbi = db.getDb();
  const id = uuid();
  const periods = s.recognition_periods || 12;
  const periodAmount = round2((s.total_amount || 0) / periods);
  dbi.prepare(`INSERT INTO deferred_revenue_schedules (id, company_id, description, client_id, invoice_id, total_amount, start_date, end_date, recognition_periods, period_amount, deferred_account_id, revenue_account_id, status, next_recognition_date, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`)
    .run(id, s.company_id, s.description, s.client_id || null, s.invoice_id || null, s.total_amount || 0, s.start_date, s.end_date, periods, periodAmount, s.deferred_account_id || null, s.revenue_account_id || null, s.start_date, s.notes || null, now(), now());
  return { id, period_amount: periodAmount };
}

export function recognizeDeferredRevenue(scheduleId: string, recognitionDate: string, postedJeId?: string): { recognized_amount: number; periods_remaining: number } {
  const dbi = db.getDb();
  const s = dbi.prepare(`SELECT * FROM deferred_revenue_schedules WHERE id = ?`).get(scheduleId) as any;
  if (!s) throw new Error('Schedule not found');
  if (s.periods_recognized >= s.recognition_periods) throw new Error('Already fully recognized');
  const recId = uuid();
  dbi.prepare(`INSERT INTO deferred_revenue_recognitions (id, schedule_id, recognition_date, amount, posted_je_id, posted_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(recId, scheduleId, recognitionDate, s.period_amount, postedJeId || null, now());
  const newCount = s.periods_recognized + 1;
  const nextDate = addMonths(recognitionDate, 1);
  const status = newCount >= s.recognition_periods ? 'completed' : 'active';
  dbi.prepare(`UPDATE deferred_revenue_schedules SET periods_recognized = ?, next_recognition_date = ?, status = ?, updated_at = ? WHERE id = ?`)
    .run(newCount, nextDate, status, now(), scheduleId);
  return { recognized_amount: s.period_amount, periods_remaining: s.recognition_periods - newCount };
}

export function dueDeferredRevenue(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM deferred_revenue_schedules WHERE company_id = ? AND status = 'active' AND next_recognition_date <= date('now')`).all(companyId) as any[];
}

export function listDeferredRevenue(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM deferred_revenue_schedules WHERE company_id = ? ORDER BY next_recognition_date`).all(companyId) as any[];
}

// F201, F202 — auto bank-fee/interest entries (helper: creates accrual record)
export function autoBookBankFee(companyId: string, amount: number, accountId: string, description?: string): any {
  return createAccrual({ company_id: companyId, accrual_type: 'bank_fee', description: description || 'Bank service charge', accrual_date: today(), amount, credit_account_id: accountId });
}

export function autoBookInterestAccrual(companyId: string, amount: number, accountId: string, description?: string): any {
  return createAccrual({ company_id: companyId, accrual_type: 'interest', description: description || 'Interest accrual', accrual_date: today(), amount, credit_account_id: accountId });
}

// F203 — period lock override (helper checks)
export function isPeriodLocked(companyId: string, date: string): boolean {
  const r = db.getDb().prepare(`SELECT id FROM period_locks WHERE company_id = ? AND ? BETWEEN period_start AND period_end AND is_locked = 1 LIMIT 1`).get(companyId, date) as any;
  return !!r;
}

// F204 — quarter-end procedure runner (returns checklist)
export function quarterEndChecklist(companyId: string, quarterEndDate: string): { items: Array<{ task: string; complete: boolean }> } {
  const items = [
    { task: 'All bank reconciliations complete', complete: false },
    { task: 'Accruals booked', complete: dueAccrualReversals(companyId).length === 0 },
    { task: 'Prepaid expenses amortized', complete: duePrepaidRecognitions(companyId).length === 0 },
    { task: 'Deferred revenue recognized', complete: dueDeferredRevenue(companyId).length === 0 },
    { task: 'Fixed asset depreciation posted', complete: false },
    { task: 'Tax provision calculated', complete: false },
    { task: 'Inter-company eliminations', complete: false },
    { task: 'Trial balance reviewed', complete: false },
    { task: 'Financial statements drafted', complete: false },
    { task: 'Management review complete', complete: false },
  ];
  return { items };
}

// F205 — year-end close
export function runYearEndClose(opts: { company_id: string; fiscal_year: number; retained_earnings_account_id: string; income_summary_account_id: string; closed_by?: string }): any {
  const dbi = db.getDb();
  const yearStart = `${opts.fiscal_year}-01-01`;
  const yearEnd = `${opts.fiscal_year}-12-31`;
  // Compute net income for the year: sum revenue accounts - sum expense accounts
  const revRow = dbi.prepare(`SELECT COALESCE(SUM(jel.credit - jel.debit), 0) AS rev FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id JOIN accounts a ON a.id = jel.account_id WHERE je.company_id = ? AND je.is_posted = 1 AND je.entry_date BETWEEN ? AND ? AND a.account_type IN ('revenue','other_income')`).get(opts.company_id, yearStart, yearEnd) as any;
  const expRow = dbi.prepare(`SELECT COALESCE(SUM(jel.debit - jel.credit), 0) AS exp FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id JOIN accounts a ON a.id = jel.account_id WHERE je.company_id = ? AND je.is_posted = 1 AND je.entry_date BETWEEN ? AND ? AND a.account_type IN ('expense','other_expense','cost_of_sales')`).get(opts.company_id, yearStart, yearEnd) as any;
  const netIncome = round2((revRow.rev || 0) - (expRow.exp || 0));

  const id = uuid();
  dbi.prepare(`INSERT INTO year_end_close_runs (id, company_id, fiscal_year, closed_at, closed_by, retained_earnings_account_id, income_summary_account_id, net_income, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, opts.company_id, opts.fiscal_year, now(), opts.closed_by || null, opts.retained_earnings_account_id, opts.income_summary_account_id, netIncome, `Closing JE: NI=${netIncome}`);
  return { id, fiscal_year: opts.fiscal_year, net_income: netIncome };
}

export function listYearEndCloses(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM year_end_close_runs WHERE company_id = ? ORDER BY fiscal_year DESC`).all(companyId) as any[];
}

// ════════════════════════════════════════════════════════════════
// Batch D: Fixed Assets Advanced (F206-F215)
// ════════════════════════════════════════════════════════════════

// F206 — disposal
export function disposeAsset(d: any): any {
  const dbi = db.getDb();
  const asset = dbi.prepare(`SELECT current_book_value, accumulated_depreciation FROM fixed_assets WHERE id = ?`).get(d.asset_id) as any;
  if (!asset) throw new Error('Asset not found');
  const bookValue = asset.current_book_value || 0;
  const gainLoss = round2((d.proceeds || 0) - bookValue);
  const id = uuid();
  dbi.prepare(`INSERT INTO asset_disposals (id, company_id, asset_id, disposal_date, disposal_method, proceeds, book_value_at_disposal, gain_loss, accumulated_depreciation, posted_je_id, notes, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, d.company_id, d.asset_id, d.disposal_date, d.disposal_method || 'sale', d.proceeds || 0, bookValue, gainLoss, asset.accumulated_depreciation || 0, d.posted_je_id || null, d.notes || null, now(), d.created_by || null);
  dbi.prepare(`UPDATE fixed_assets SET status = 'disposed', disposal_date = ?, disposal_amount = ?, updated_at = ? WHERE id = ?`).run(d.disposal_date, d.proceeds || 0, now(), d.asset_id);
  return { id, gain_loss: gainLoss, book_value_at_disposal: bookValue };
}

export function listAssetDisposals(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM asset_disposals WHERE company_id = ? ORDER BY disposal_date DESC`).all(companyId) as any[];
}

// F207 — transfer
export function transferAsset(t: any): any {
  const dbi = db.getDb();
  const id = uuid();
  dbi.prepare(`INSERT INTO asset_transfers (id, company_id, asset_id, transfer_date, from_location, to_location, from_cost_center, to_cost_center, transferred_by, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, t.company_id, t.asset_id, t.transfer_date, t.from_location || null, t.to_location || null, t.from_cost_center || null, t.to_cost_center || null, t.transferred_by || null, t.notes || null, now());
  if (t.to_location) dbi.prepare(`UPDATE fixed_assets SET location = ?, updated_at = ? WHERE id = ?`).run(t.to_location, now(), t.asset_id);
  return { id };
}

export function listAssetTransfers(assetId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM asset_transfers WHERE asset_id = ? ORDER BY transfer_date DESC`).all(assetId) as any[];
}

// F208 — partial disposal (helper that creates disposal for portion)
export function partialDispose(d: { company_id: string; asset_id: string; disposal_date: string; proportion: number; proceeds: number; notes?: string }): any {
  const dbi = db.getDb();
  const asset = dbi.prepare(`SELECT current_book_value, accumulated_depreciation FROM fixed_assets WHERE id = ?`).get(d.asset_id) as any;
  if (!asset) throw new Error('Asset not found');
  const portionBV = round2((asset.current_book_value || 0) * d.proportion);
  const portionAccDep = round2((asset.accumulated_depreciation || 0) * d.proportion);
  const result = disposeAsset({ company_id: d.company_id, asset_id: d.asset_id, disposal_date: d.disposal_date, disposal_method: 'partial_sale', proceeds: d.proceeds, notes: `Partial disposal (${(d.proportion * 100).toFixed(1)}%): ${d.notes || ''}` });
  // Reduce remaining values on asset
  const newBV = round2((asset.current_book_value || 0) - portionBV);
  const newAccDep = round2((asset.accumulated_depreciation || 0) - portionAccDep);
  dbi.prepare(`UPDATE fixed_assets SET current_book_value = ?, accumulated_depreciation = ?, status = 'active', updated_at = ? WHERE id = ?`).run(newBV, newAccDep, now(), d.asset_id);
  return { ...result, proportion: d.proportion, remaining_book_value: newBV };
}

// F209 — impairment
export function impairAsset(i: any): any {
  const dbi = db.getDb();
  const asset = dbi.prepare(`SELECT current_book_value FROM fixed_assets WHERE id = ?`).get(i.asset_id) as any;
  if (!asset) throw new Error('Asset not found');
  const preValue = asset.current_book_value || 0;
  const loss = round2(preValue - (i.recoverable_amount || 0));
  if (loss <= 0) throw new Error('Recoverable amount must be less than current book value');
  const id = uuid();
  dbi.prepare(`INSERT INTO asset_impairments (id, company_id, asset_id, impairment_date, pre_impairment_value, recoverable_amount, impairment_loss, reason, posted_je_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, i.company_id, i.asset_id, i.impairment_date, preValue, i.recoverable_amount || 0, loss, i.reason || null, i.posted_je_id || null, now(), i.created_by || null);
  dbi.prepare(`UPDATE fixed_assets SET current_book_value = ?, updated_at = ? WHERE id = ?`).run(i.recoverable_amount || 0, now(), i.asset_id);
  return { id, impairment_loss: loss };
}

export function listImpairments(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM asset_impairments WHERE company_id = ? ORDER BY impairment_date DESC`).all(companyId) as any[];
}

// F210 — revaluation
export function revalueAsset(r: any): any {
  const dbi = db.getDb();
  const asset = dbi.prepare(`SELECT current_book_value FROM fixed_assets WHERE id = ?`).get(r.asset_id) as any;
  if (!asset) throw new Error('Asset not found');
  const oldValue = asset.current_book_value || 0;
  const surplus = round2((r.new_value || 0) - oldValue);
  const id = uuid();
  dbi.prepare(`INSERT INTO asset_revaluations (id, company_id, asset_id, revaluation_date, old_value, new_value, revaluation_surplus, method, appraised_by, posted_je_id, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, r.company_id, r.asset_id, r.revaluation_date, oldValue, r.new_value || 0, surplus, r.method || null, r.appraised_by || null, r.posted_je_id || null, r.notes || null, now());
  dbi.prepare(`UPDATE fixed_assets SET current_book_value = ?, updated_at = ? WHERE id = ?`).run(r.new_value || 0, now(), r.asset_id);
  return { id, revaluation_surplus: surplus };
}

// F211 — componentization (helper that creates child assets)
export function componentizeAsset(parentAssetId: string, components: Array<{ name: string; allocated_cost: number; useful_life_years: number; depreciation_method?: string }>): { children_created: number } {
  const dbi = db.getDb();
  const parent = dbi.prepare(`SELECT * FROM fixed_assets WHERE id = ?`).get(parentAssetId) as any;
  if (!parent) throw new Error('Parent asset not found');
  let created = 0;
  const tx = dbi.transaction(() => {
    for (const c of components) {
      const childId = uuid();
      dbi.prepare(`INSERT INTO fixed_assets (id, company_id, name, asset_code, category, description, purchase_date, purchase_price, useful_life_years, depreciation_method, asset_account_id, depreciation_account_id, accumulated_depreciation_account_id, current_book_value, status, component_parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`)
        .run(childId, parent.company_id, c.name, `${parent.asset_code}-${created + 1}`, parent.category, `Component of ${parent.name}`, parent.purchase_date, c.allocated_cost, c.useful_life_years, c.depreciation_method || parent.depreciation_method, parent.asset_account_id, parent.depreciation_account_id, parent.accumulated_depreciation_account_id, c.allocated_cost, parentAssetId, now(), now());
      created++;
    }
  });
  tx();
  return { children_created: created };
}

// F212 — ARO
export function createARO(a: any): any {
  const presentValue = a.estimated_cost / Math.pow(1 + (a.discount_rate || 0) / 100, yearsBetween(a.obligation_date, a.settlement_date || addMonths(a.obligation_date, 120)));
  const id = uuid();
  db.getDb().prepare(`INSERT INTO asset_retirement_obligations (id, company_id, asset_id, obligation_date, estimated_cost, discount_rate, settlement_date, present_value, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
    .run(id, a.company_id, a.asset_id, a.obligation_date, a.estimated_cost || 0, a.discount_rate || 0, a.settlement_date || null, round2(presentValue), a.notes || null, now());
  return { id, present_value: round2(presentValue) };
}

function yearsBetween(d1: string, d2: string): number {
  return Math.max(1, (new Date(d2).getTime() - new Date(d1).getTime()) / (1000 * 60 * 60 * 24 * 365.25));
}

export function listAROs(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM asset_retirement_obligations WHERE company_id = ? ORDER BY settlement_date`).all(companyId) as any[];
}

// F213 — asset insurance
export function upsertAssetInsurance(i: any): any {
  const dbi = db.getDb();
  const id = i.id || uuid();
  if (i.id) {
    dbi.prepare(`UPDATE asset_insurance SET policy_number = ?, carrier = ?, coverage_amount = ?, annual_premium = ?, deductible = ?, effective_date = ?, expiry_date = ?, notes = ?, updated_at = ? WHERE id = ?`)
      .run(i.policy_number || null, i.carrier || null, i.coverage_amount || 0, i.annual_premium || 0, i.deductible || 0, i.effective_date || null, i.expiry_date || null, i.notes || null, now(), i.id);
  } else {
    dbi.prepare(`INSERT INTO asset_insurance (id, company_id, asset_id, policy_number, carrier, coverage_amount, annual_premium, deductible, effective_date, expiry_date, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, i.company_id, i.asset_id, i.policy_number || null, i.carrier || null, i.coverage_amount || 0, i.annual_premium || 0, i.deductible || 0, i.effective_date || null, i.expiry_date || null, i.notes || null, now(), now());
  }
  return { id, ...i };
}

export function listAssetInsurance(assetId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM asset_insurance WHERE asset_id = ? ORDER BY expiry_date DESC`).all(assetId) as any[];
}

// F214 — warranty
export function upsertAssetWarranty(w: any): any {
  const id = w.id || uuid();
  db.getDb().prepare(`INSERT INTO asset_warranties (id, company_id, asset_id, warranty_provider, warranty_type, start_date, end_date, coverage_description, contact_info, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, w.company_id, w.asset_id, w.warranty_provider || null, w.warranty_type || 'standard', w.start_date || null, w.end_date || null, w.coverage_description || null, w.contact_info || null, w.notes || null, now());
  return { id };
}

export function listAssetWarranties(assetId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM asset_warranties WHERE asset_id = ? ORDER BY end_date DESC`).all(assetId) as any[];
}

export function expiringWarranties(companyId: string, daysAhead: number = 60): any[] {
  return db.getDb().prepare(`SELECT * FROM asset_warranties WHERE company_id = ? AND end_date <= date('now', '+' || ? || ' days') AND end_date >= date('now') ORDER BY end_date`).all(companyId, daysAhead) as any[];
}

// F215 — depreciation convention is set as column on fixed_assets
export function setDepreciationConvention(assetId: string, convention: 'full_month' | 'mid_month' | 'half_year' | 'mid_quarter'): boolean {
  const r = db.getDb().prepare(`UPDATE fixed_assets SET depreciation_convention = ?, updated_at = ? WHERE id = ?`).run(convention, now(), assetId);
  return r.changes > 0;
}

// ════════════════════════════════════════════════════════════════
// Batch E: Revenue Recognition (F216-F225)
// ════════════════════════════════════════════════════════════════

// F216 — contracts + obligations
export function upsertContract(c: any): any {
  const dbi = db.getDb();
  const id = c.id || uuid();
  if (c.id) {
    dbi.prepare(`UPDATE revenue_contracts SET client_id = ?, contract_number = ?, contract_name = ?, contract_date = ?, effective_date = ?, end_date = ?, total_contract_value = ?, payment_terms = ?, status = ?, notes = ?, updated_at = ? WHERE id = ?`)
      .run(c.client_id || null, c.contract_number || null, c.contract_name, c.contract_date || null, c.effective_date || null, c.end_date || null, c.total_contract_value || 0, c.payment_terms || null, c.status || 'active', c.notes || null, now(), c.id);
  } else {
    dbi.prepare(`INSERT INTO revenue_contracts (id, company_id, client_id, contract_number, contract_name, contract_date, effective_date, end_date, total_contract_value, payment_terms, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, c.company_id, c.client_id || null, c.contract_number || null, c.contract_name, c.contract_date || null, c.effective_date || null, c.end_date || null, c.total_contract_value || 0, c.payment_terms || null, c.status || 'active', c.notes || null, now(), now());
  }
  return { id, ...c };
}

export function upsertObligation(o: any): any {
  const dbi = db.getDb();
  const id = o.id || uuid();
  if (o.id) {
    dbi.prepare(`UPDATE performance_obligations SET description = ?, standalone_selling_price = ?, allocated_amount = ?, recognition_pattern = ?, start_date = ?, end_date = ?, status = ?, revenue_account_id = ?, notes = ? WHERE id = ?`)
      .run(o.description, o.standalone_selling_price || 0, o.allocated_amount || 0, o.recognition_pattern || 'point_in_time', o.start_date || null, o.end_date || null, o.status || 'pending', o.revenue_account_id || null, o.notes || null, o.id);
  } else {
    dbi.prepare(`INSERT INTO performance_obligations (id, contract_id, description, standalone_selling_price, allocated_amount, recognition_pattern, start_date, end_date, status, revenue_account_id, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`)
      .run(id, o.contract_id, o.description, o.standalone_selling_price || 0, o.allocated_amount || 0, o.recognition_pattern || 'point_in_time', o.start_date || null, o.end_date || null, o.revenue_account_id || null, o.notes || null, now());
  }
  return { id, ...o };
}

export function listObligations(contractId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM performance_obligations WHERE contract_id = ? ORDER BY start_date`).all(contractId) as any[];
}

export function listContracts(companyId: string, opts?: { status?: string; client_id?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  if (opts?.client_id) { where += ' AND client_id = ?'; params.push(opts.client_id); }
  return dbi.prepare(`SELECT * FROM revenue_contracts WHERE ${where} ORDER BY contract_date DESC`).all(...params) as any[];
}

// F217 — contract modifications
export function logContractModification(m: any): any {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO contract_modifications (id, contract_id, modification_date, modification_type, value_change, scope_change, accounting_treatment, notes, approved_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, m.contract_id, m.modification_date, m.modification_type || null, m.value_change || 0, m.scope_change || null, m.accounting_treatment || null, m.notes || null, m.approved_by || null, now());
  return { id };
}

export function listContractModifications(contractId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM contract_modifications WHERE contract_id = ? ORDER BY modification_date DESC`).all(contractId) as any[];
}

// F218 — SSP
export function upsertSSP(s: any): any {
  const id = s.id || uuid();
  db.getDb().prepare(`INSERT INTO standalone_selling_prices (id, company_id, product_or_service, ssp_value, ssp_method, effective_from, effective_to, range_low, range_high, last_validated, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, s.company_id, s.product_or_service, s.ssp_value || 0, s.ssp_method || 'observable', s.effective_from || null, s.effective_to || null, s.range_low || null, s.range_high || null, s.last_validated || null, s.notes || null, now());
  return { id };
}

export function listSSPs(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM standalone_selling_prices WHERE company_id = ? ORDER BY product_or_service`).all(companyId) as any[];
}

// F219 — variable consideration
export function recordVariableConsideration(v: any): any {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO variable_consideration_adjustments (id, contract_id, obligation_id, adjustment_type, estimated_amount, estimation_method, constraint_applied, constraint_amount, as_of_date, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, v.contract_id, v.obligation_id || null, v.adjustment_type || null, v.estimated_amount || 0, v.estimation_method || null, v.constraint_applied ? 1 : 0, v.constraint_amount || 0, v.as_of_date || today(), v.notes || null, now());
  return { id };
}

// F220 — milestone-based release
export function createRevenueMilestone(m: any): any {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO revenue_milestones (id, obligation_id, milestone_name, target_date, amount_to_release, status, notes, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`)
    .run(id, m.obligation_id, m.milestone_name, m.target_date || null, m.amount_to_release || 0, m.notes || null, now());
  return { id };
}

export function completeMilestone(milestoneId: string, completionDate: string, postedJeId?: string): { released_amount: number } {
  const dbi = db.getDb();
  const m = dbi.prepare(`SELECT * FROM revenue_milestones WHERE id = ?`).get(milestoneId) as any;
  if (!m) throw new Error('Milestone not found');
  dbi.prepare(`UPDATE revenue_milestones SET completion_date = ?, status = 'completed', posted_je_id = ? WHERE id = ?`).run(completionDate, postedJeId || null, milestoneId);
  // Update obligation revenue_recognized
  dbi.prepare(`UPDATE performance_obligations SET revenue_recognized = revenue_recognized + ? WHERE id = ?`).run(m.amount_to_release, m.obligation_id);
  return { released_amount: m.amount_to_release };
}

export function listMilestones(obligationId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM revenue_milestones WHERE obligation_id = ? ORDER BY target_date`).all(obligationId) as any[];
}

// F221 — subscription waterfall (computed from deferred revenue schedules)
export function subscriptionWaterfall(companyId: string, monthsAhead: number = 12): Array<{ month: string; recognized: number; remaining: number }> {
  const dbi = db.getDb();
  const schedules = dbi.prepare(`SELECT * FROM deferred_revenue_schedules WHERE company_id = ? AND status = 'active'`).all(companyId) as any[];
  const result: Array<{ month: string; recognized: number; remaining: number }> = [];
  let cursor = today().slice(0, 7) + '-01';
  for (let i = 0; i < monthsAhead; i++) {
    let monthRec = 0;
    let monthRem = 0;
    for (const s of schedules) {
      if (s.next_recognition_date <= cursor) monthRec += s.period_amount;
      monthRem += s.period_amount * (s.recognition_periods - s.periods_recognized);
    }
    result.push({ month: cursor.slice(0, 7), recognized: round2(monthRec), remaining: round2(monthRem) });
    cursor = addMonths(cursor, 1);
  }
  return result;
}

// F222 — bundled product revenue allocation (allocate transaction price across SSPs)
export function allocateBundleRevenue(items: Array<{ obligation_id: string; ssp: number }>, transactionPrice: number): Array<{ obligation_id: string; allocated: number }> {
  const totalSsp = items.reduce((s, i) => s + (i.ssp || 0), 0);
  if (totalSsp === 0) return items.map(i => ({ obligation_id: i.obligation_id, allocated: 0 }));
  return items.map(i => ({ obligation_id: i.obligation_id, allocated: round2(transactionPrice * (i.ssp / totalSsp)) }));
}

// F223 — returns reserve
export function calculateReturnsReserve(companyId: string, periodStart: string, periodEnd: string, historicalRate: number): any {
  const dbi = db.getDb();
  const revRow = dbi.prepare(`SELECT COALESCE(SUM(total), 0) AS r FROM invoices WHERE company_id = ? AND issue_date BETWEEN ? AND ? AND status NOT IN ('void','cancelled') AND (deleted_at IS NULL OR deleted_at = '')`).get(companyId, periodStart, periodEnd) as any;
  const reserveAmount = round2((revRow.r || 0) * (historicalRate / 100));
  const id = uuid();
  dbi.prepare(`INSERT INTO returns_reserves (id, company_id, period_start, period_end, historical_return_rate, revenue_in_period, reserve_amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, companyId, periodStart, periodEnd, historicalRate, revRow.r || 0, reserveAmount, now());
  return { id, revenue_in_period: revRow.r, reserve_amount: reserveAmount };
}

export function listReturnsReserves(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM returns_reserves WHERE company_id = ? ORDER BY period_end DESC`).all(companyId) as any[];
}

// F224 — rebate accruals
export function upsertRebateAccrual(r: any): any {
  const dbi = db.getDb();
  const id = r.id || uuid();
  const accrued = round2((r.sales_basis || 0) * (r.rebate_rate || 0) / 100);
  if (r.id) {
    dbi.prepare(`UPDATE rebate_accruals SET program_name = ?, customer_id = ?, accrual_period_start = ?, accrual_period_end = ?, sales_basis = ?, rebate_rate = ?, accrued_amount = ?, paid_amount = ?, status = ?, notes = ? WHERE id = ?`)
      .run(r.program_name, r.customer_id || null, r.accrual_period_start || null, r.accrual_period_end || null, r.sales_basis || 0, r.rebate_rate || 0, accrued, r.paid_amount || 0, r.status || 'accruing', r.notes || null, r.id);
  } else {
    dbi.prepare(`INSERT INTO rebate_accruals (id, company_id, program_name, customer_id, accrual_period_start, accrual_period_end, sales_basis, rebate_rate, accrued_amount, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'accruing', ?, ?)`)
      .run(id, r.company_id, r.program_name, r.customer_id || null, r.accrual_period_start || null, r.accrual_period_end || null, r.sales_basis || 0, r.rebate_rate || 0, accrued, r.notes || null, now());
  }
  return { id, accrued_amount: accrued };
}

export function listRebateAccruals(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM rebate_accruals WHERE company_id = ? ORDER BY accrual_period_end DESC`).all(companyId) as any[];
}

// F225 — commission deferral (ASC 340-40)
export function deferCommission(c: any): any {
  const periodAmount = round2((c.capitalized_amount || c.commission_amount || 0) / (c.amortization_period_months || 36));
  const id = uuid();
  db.getDb().prepare(`INSERT INTO commission_deferrals (id, company_id, rep_id, contract_id, commission_amount, capitalized_amount, amortization_period_months, start_date, period_amount, status, deferred_asset_account_id, expense_account_id, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`)
    .run(id, c.company_id, c.rep_id || null, c.contract_id || null, c.commission_amount || 0, c.capitalized_amount || c.commission_amount || 0, c.amortization_period_months || 36, c.start_date || today(), periodAmount, c.deferred_asset_account_id || null, c.expense_account_id || null, c.notes || null, now());
  return { id, period_amount: periodAmount };
}

export function amortizeCommission(deferralId: string, amount: number): { amortized_to_date: number; status: string } {
  const dbi = db.getDb();
  const d = dbi.prepare(`SELECT * FROM commission_deferrals WHERE id = ?`).get(deferralId) as any;
  if (!d) throw new Error('Deferral not found');
  const newAmortized = round2((d.amortized_to_date || 0) + amount);
  const status = newAmortized >= (d.capitalized_amount || 0) ? 'completed' : 'active';
  dbi.prepare(`UPDATE commission_deferrals SET amortized_to_date = ?, status = ? WHERE id = ?`).run(newAmortized, status, deferralId);
  return { amortized_to_date: newAmortized, status };
}

export function listCommissionDeferrals(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM commission_deferrals WHERE company_id = ? ORDER BY start_date DESC`).all(companyId) as any[];
}
