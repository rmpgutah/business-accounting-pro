import * as db from '../../database';
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import https from 'https';
import { v4 as uuid } from 'uuid';
import type { PDFMetadata } from '../../services/print-preview';
import { reindexEntity, removeFromIndex } from '../../services/intelligence/searchIndex';
import { INDEXED_TABLES } from '../../services/intelligence/indexConfig';
import { SCHEDULE_C_BY_CATEGORY } from '../../services/schedule-c-map';
import type { IpcDeps } from './types';

// ─── Server Sync Config ──────────────────────────────────
export const SYNC_SERVER = process.env.SYNC_SERVER_URL || 'https://accounting.rmpgutah.us';

// Debounced auto-backup: waits 30s after last write, then uploads DB to server
// CONCURRENCY: a single global timer is correct here — the SQLite file holds
// ALL companies for the logged-in user, and the backup is keyed on user email.
// Per-company debouncing would unnecessarily upload the same file N times.
let autoBackupTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAutoBackup() {
  if (autoBackupTimer) clearTimeout(autoBackupTimer);
  autoBackupTimer = setTimeout(async () => {
    try {
      const dbPath = db.getDbPath();
      if (!fs.existsSync(dbPath)) return;
      try {
        db.getDb().pragma('wal_checkpoint(TRUNCATE)');
      } catch (_) {}

      // Perf: async read so other IPC handlers aren't blocked while the DB
      // file is loaded into memory for HMAC + upload (runs every 30s).
      const fileData = await fs.promises.readFile(dbPath);
      const email = getLastLoginEmail();
      if (!email) return;

      const secret = process.env.SYNC_SECRET || 'bap-sync-default';
      const signature = crypto.createHmac('sha256', secret).update(fileData).digest('hex');

      const url = new URL(`${SYNC_SERVER}/api/backup/upload`);
      const isHttps = url.protocol === 'https:';
      const transport = isHttps ? https : http;

      const req = transport.request(
        {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': fileData.length,
            'x-bap-signature': signature,
            'x-bap-email': email,
          },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk: string) => (body += chunk));
          res.on('end', () => {
            if (res.statusCode === 200) {
              console.log('Auto-backup uploaded successfully');
            } else {
              console.warn('Auto-backup response:', res.statusCode, body);
            }
          });
        },
      );
      req.on('error', (err) => console.warn('Auto-backup failed (network):', err.message));
      req.write(fileData);
      req.end();
    } catch (err) {
      console.warn('Auto-backup error:', err);
    }
  }, 30000); // 30 second debounce
}

// Cancels any pending debounced backup (used before a restore-from-server so
// the pending upload cannot race the DB overwrite).
function cancelAutoBackup(): void {
  if (autoBackupTimer) {
    clearTimeout(autoBackupTimer);
    autoBackupTimer = null;
  }
}

let _lastLoginEmail: string | null = null;
function setLastLoginEmail(email: string | null) {
  _lastLoginEmail = email;
}
function getLastLoginEmail(): string | null {
  return _lastLoginEmail;
}

// ─── Journal Entry Auto-Poster ────────────────────────────
// ─── Account Lookup (multi-strategy) ─────────────────────
// Tries multiple strategies to find an account by name hint:
// 1. Exact name match
// 2. LIKE name match
// 3. Alias mapping (common name → default account names)
// 4. Type + subtype fallback
const ACCOUNT_ALIASES: Record<string, string[]> = {
  Cash: ['Cash', 'Checking Account', 'Bank Account'],
  Receivable: ['Accounts Receivable', 'Trade Receivable', 'A/R'],
  Payable: ['Accounts Payable', 'Trade Payable', 'A/P'],
  'Wages Expense': [
    'Wages & Salaries',
    'Payroll Expense',
    'Wages Expense',
    'Salary Expense',
    'Wage Expense',
  ],
  'Wages Payable': ['Payroll Liabilities', 'Wages Payable', 'Salary Payable', 'Payroll Payable'],
  'Federal Withholding': [
    'Federal Tax Payable',
    'Federal Withholding',
    'Federal Income Tax Payable',
  ],
  'State Withholding': ['State Tax Payable', 'State Withholding', 'State Income Tax Payable'],
  'Social Security Payable': [
    'Payroll Liabilities',
    'Social Security Payable',
    'FICA Payable',
    'Payroll Tax Expense — FICA',
  ],
  'Medicare Payable': [
    'Payroll Liabilities',
    'Medicare Payable',
    'FICA Payable',
    'Payroll Tax Expense — FICA',
  ],
  'FUTA Payable': [
    'Payroll Liabilities',
    'FUTA Payable',
    'Payroll Tax Expense — FUTA',
    'Federal Unemployment Payable',
  ],
  'SUI Payable': [
    'Payroll Liabilities',
    'SUI Payable',
    'SUTA Payable',
    'State Unemployment Payable',
    'Payroll Tax Expense — SUTA',
  ],
  Revenue: [
    'Service Revenue',
    'Sales Revenue',
    'Revenue',
    'Consulting Revenue',
    'Project Revenue',
    'Income',
  ],
  Expense: [
    'Cost of Services',
    'Cost of Goods Sold',
    'Office Supplies',
    'Miscellaneous Expense',
    'General Expense',
    'Operating Expense',
  ],
  Advertising: ['Advertising & Marketing', 'Marketing', 'Advertising'],
  'Bank Fees': ['Bank Fees & Service Charges', 'Bank Fees', 'Bank Charges', 'Service Charges'],
  Contractors: ['Contract Labor', 'Contractors', 'Subcontractors'],
  Insurance: ['Insurance — General Liability', 'Insurance', 'Business Insurance'],
  'Office Supplies': ['Office Supplies', 'Supplies'],
  'Professional Fees': [
    'Legal Fees',
    'Accounting & Tax Preparation',
    'Professional Services — Other',
    'Professional Fees',
    'Legal & Professional',
  ],
  Rent: ['Rent — Office / Workspace', 'Rent', 'Rent Expense', 'Office Rent'],
  Software: ['Software & Subscriptions', 'Software', 'Subscriptions'],
  Travel: ['Travel — Airfare', 'Travel — Lodging', 'Travel & Meals', 'Travel', 'Travel Expense'],
  Utilities: [
    'Utilities — Electric',
    'Utilities — Telephone / Internet',
    'Utilities',
    'Utility Expense',
  ],
  Depreciation: ['Depreciation Expense', 'Section 179 Expense', 'Amortization Expense'],
  Meals: ['Meals — Business (50% deductible)', 'Meals', 'Business Meals'],
  Vehicle: ['Vehicle Expense', 'Auto Expense', 'Mileage'],
  Repairs: ['Repairs & Maintenance', 'Repairs', 'Maintenance'],
  Interest: ['Interest — Other Business Loans', 'Interest Expense', 'Loan Interest'],
  Taxes: ['Taxes — Business License & Permits', 'Taxes — Property', 'Business Taxes'],
  Education: ['Education & Training', 'Training', 'Professional Development'],
  Dues: ['Dues & Memberships', 'Memberships', 'Professional Dues'],
  'Bad Debts': ['Bad Debts', 'Bad Debt Expense', 'Uncollectible Accounts'],
  Shipping: ['Postage & Shipping', 'Shipping', 'Postage', 'Freight'],
  'Processing Fees': [
    'Stripe Processing Fees',
    'Credit Card Processing Fees',
    'Payment Processing',
  ],
};

const ACCOUNT_TYPE_FALLBACK: Record<string, { type: string; subtype?: string }> = {
  Cash: { type: 'asset', subtype: 'current' },
  Receivable: { type: 'asset', subtype: 'current' },
  Payable: { type: 'liability', subtype: 'current' },
  'Wages Expense': { type: 'expense', subtype: 'payroll' },
  'Wages Payable': { type: 'liability', subtype: 'current' },
  'Federal Withholding': { type: 'liability', subtype: 'current' },
  'State Withholding': { type: 'liability', subtype: 'current' },
  'Social Security Payable': { type: 'liability', subtype: 'current' },
  'Medicare Payable': { type: 'liability', subtype: 'current' },
  'FUTA Payable': { type: 'liability', subtype: 'current' },
  'SUI Payable': { type: 'liability', subtype: 'current' },
  'Pre-tax Deductions Payable': { type: 'liability', subtype: 'current' },
  'Post-tax Deductions Payable': { type: 'liability', subtype: 'current' },
  Revenue: { type: 'revenue' },
  Expense: { type: 'expense', subtype: 'operating' },
  Advertising: { type: 'expense', subtype: 'operating' },
  'Bank Fees': { type: 'expense', subtype: 'operating' },
  Contractors: { type: 'expense', subtype: 'operating' },
  Insurance: { type: 'expense', subtype: 'operating' },
  'Office Supplies': { type: 'expense', subtype: 'operating' },
  'Professional Fees': { type: 'expense', subtype: 'operating' },
  Rent: { type: 'expense', subtype: 'operating' },
  Software: { type: 'expense', subtype: 'operating' },
  Travel: { type: 'expense', subtype: 'operating' },
  Utilities: { type: 'expense', subtype: 'operating' },
  Depreciation: { type: 'expense', subtype: 'operating' },
  Meals: { type: 'expense', subtype: 'operating' },
  Vehicle: { type: 'expense', subtype: 'operating' },
  Repairs: { type: 'expense', subtype: 'operating' },
  Interest: { type: 'expense', subtype: 'operating' },
  Taxes: { type: 'expense', subtype: 'taxes' },
  Education: { type: 'expense', subtype: 'operating' },
  Dues: { type: 'expense', subtype: 'operating' },
  'Bad Debts': { type: 'expense', subtype: 'other' },
  Shipping: { type: 'expense', subtype: 'operating' },
  'Processing Fees': { type: 'expense', subtype: 'operating' },
};

function findAccount(dbInstance: any, companyId: string, nameHint: string): string | null {
  // Determine expected account type (if known) to prevent cross-type matching
  const expectedType = ACCOUNT_TYPE_FALLBACK[nameHint]?.type;
  const typeFilter = expectedType ? ` AND type = '${expectedType}'` : '';

  // Strategy 1: Exact name match (type-filtered if known)
  let acct = dbInstance
    .prepare(
      `SELECT id FROM accounts WHERE company_id = ? AND is_active = 1 AND name = ?${typeFilter} LIMIT 1`,
    )
    .get(companyId, nameHint);
  if (acct) return acct.id;

  // Strategy 1b: Exact name match without type filter
  if (typeFilter) {
    acct = dbInstance
      .prepare(
        `SELECT id FROM accounts WHERE company_id = ? AND is_active = 1 AND name = ? LIMIT 1`,
      )
      .get(companyId, nameHint);
    if (acct) return acct.id;
  }

  // Strategy 2: LIKE match (type-filtered to prevent cross-type matches like "Prepaid Expenses" for expense hint)
  if (typeFilter) {
    acct = dbInstance
      .prepare(
        `SELECT id FROM accounts WHERE company_id = ? AND is_active = 1 AND name LIKE ?${typeFilter} ORDER BY code LIMIT 1`,
      )
      .get(companyId, `%${nameHint}%`);
    if (acct) return acct.id;
  } else {
    acct = dbInstance
      .prepare(
        `SELECT id FROM accounts WHERE company_id = ? AND is_active = 1 AND name LIKE ? ORDER BY code LIMIT 1`,
      )
      .get(companyId, `%${nameHint}%`);
    if (acct) return acct.id;
  }

  // Strategy 3: Try known aliases (exact match first, then LIKE)
  const aliases = ACCOUNT_ALIASES[nameHint];
  if (aliases) {
    for (const alias of aliases) {
      acct = dbInstance
        .prepare(
          `SELECT id FROM accounts WHERE company_id = ? AND is_active = 1 AND name = ? LIMIT 1`,
        )
        .get(companyId, alias);
      if (acct) return acct.id;
    }
    for (const alias of aliases) {
      acct = dbInstance
        .prepare(
          `SELECT id FROM accounts WHERE company_id = ? AND is_active = 1 AND name LIKE ? ORDER BY code LIMIT 1`,
        )
        .get(companyId, `%${alias}%`);
      if (acct) return acct.id;
    }
  }

  // Strategy 4: Fall back to type + subtype
  const fallback = ACCOUNT_TYPE_FALLBACK[nameHint];
  if (fallback) {
    // Try with subtype first
    if (fallback.subtype) {
      acct = dbInstance
        .prepare(
          `SELECT id FROM accounts WHERE company_id = ? AND is_active = 1 AND type = ? AND subtype = ? ORDER BY code LIMIT 1`,
        )
        .get(companyId, fallback.type, fallback.subtype);
      if (acct) return acct.id;
    }
    // Then try any account of that type
    acct = dbInstance
      .prepare(
        `SELECT id FROM accounts WHERE company_id = ? AND is_active = 1 AND type = ? ORDER BY code LIMIT 1`,
      )
      .get(companyId, fallback.type);
    if (acct) return acct.id;
  }

  return null;
}

// Posts a balanced journal entry using multi-strategy account lookup.
// Silently no-ops if any required account is missing — best-effort for
// companies that haven't configured a full chart of accounts.
function postJournalEntry(
  dbInstance: ReturnType<typeof db.getDb>,
  companyId: string,
  date: string,
  description: string,
  lines: Array<{ nameHint: string; debit: number; credit: number; note?: string }>,
): void {
  // Skip lines with zero amounts
  const nonZero = lines.filter((l) => l.debit > 0 || l.credit > 0);
  if (nonZero.length === 0) return;

  const resolved: Array<{ accountId: string; debit: number; credit: number; note: string }> = [];
  for (const line of nonZero) {
    const accountId = findAccount(dbInstance as any, companyId, line.nameHint);
    if (!accountId) {
      // SAFETY: a missing account means the entry would be silently dropped,
      // which surfaces upstream as "saved but no ledger record." Log so we
      // can spot the missing-account case in the console.
      console.warn(
        `[postJournalEntry] Could not resolve account for nameHint="${line.nameHint}". Skipping entire JE.`,
      );
      return;
    }
    resolved.push({ accountId, debit: line.debit, credit: line.credit, note: line.note ?? '' });
  }

  // BALANCE CHECK: validate locally BEFORE the trigger so we surface a
  // clearer error than the SQL "Posted journal entry must balance" rabbit
  // hole. The trigger fires from raw line totals — but if we round each
  // leg to cents BEFORE insert, both sides round identically and we
  // can't drift.
  const totalDebit = Math.round(resolved.reduce((s, l) => s + (l.debit || 0), 0) * 100) / 100;
  const totalCredit = Math.round(resolved.reduce((s, l) => s + (l.credit || 0), 0) * 100) / 100;
  if (Math.abs(totalDebit - totalCredit) > 0.005) {
    const lineSummary = resolved
      .map((l, i) => `  line ${i}: debit=${l.debit.toFixed(2)} credit=${l.credit.toFixed(2)}`)
      .join('\n');
    console.error(
      `[postJournalEntry] Unbalanced JE rejected before insert:\n  description="${description}"\n  total_debit=${totalDebit.toFixed(2)} total_credit=${totalCredit.toFixed(2)} diff=${(totalDebit - totalCredit).toFixed(4)}\n${lineSummary}`,
    );
    throw new Error(
      `Journal entry unbalanced: debits ${totalDebit.toFixed(2)} ≠ credits ${totalCredit.toFixed(2)} (diff ${(totalDebit - totalCredit).toFixed(2)}). Source: "${description}"`,
    );
  }
  // Round each line to cents to match the totals we just validated.
  for (const l of resolved) {
    l.debit = Math.round(l.debit * 100) / 100;
    l.credit = Math.round(l.credit * 100) / 100;
  }

  // Find the highest entry number by extracting the numeric suffix.
  // Cannot rely on created_at (same timestamp during bulk operations like gl:rebuild).
  const lastJE = (dbInstance as any)
    .prepare(
      `SELECT entry_number FROM journal_entries WHERE company_id = ?
     ORDER BY CAST(SUBSTR(entry_number, INSTR(entry_number, '-') + 1) AS INTEGER) DESC LIMIT 1`,
    )
    .get(companyId);
  let nextNum = 'JE-1001';
  if (lastJE?.entry_number) {
    const m = lastJE.entry_number.match(/(\d+)$/);
    if (m) {
      const prefix = lastJE.entry_number.slice(0, lastJE.entry_number.length - m[1].length);
      nextNum = `${prefix}${String(parseInt(m[1], 10) + 1).padStart(m[1].length, '0')}`;
    }
  }

  const jeId = uuid();
  // BUG FIX: insert as draft (is_posted=0) so line-level balance triggers
  // don't fire on the first line insert (which would see an unbalanced
  // single-sided entry). All lines are inserted first, then is_posted is
  // flipped to 1, which triggers trg_je_balanced_on_post to validate balance.
  (dbInstance as any)
    .prepare(
      `
    INSERT INTO journal_entries (id, company_id, entry_number, date, description, is_posted)
    VALUES (?, ?, ?, ?, ?, 0)
  `,
    )
    .run(jeId, companyId, nextNum, date, description);

  for (const line of resolved) {
    (dbInstance as any)
      .prepare(
        `
      INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit, credit, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      )
      .run(uuid(), jeId, line.accountId, line.debit, line.credit, line.note);
  }

  (dbInstance as any)
    .prepare(
      `
    UPDATE journal_entries SET is_posted = 1 WHERE id = ?
  `,
    )
    .run(jeId);
}

const VALID_TABLES = new Set([
  'invoices',
  'invoice_line_items',
  'expenses',
  'expense_line_items',
  'clients',
  'vendors',
  'accounts',
  'journal_entries',
  'journal_entry_lines',
  'projects',
  'employees',
  'employee_deductions',
  'time_entries',
  'categories',
  'payments',
  'budgets',
  'budget_lines',
  'bank_accounts',
  'bank_transactions',
  'bank_reconciliation_matches',
  'documents',
  'recurring_templates',
  'tax_categories',
  'tax_payments',
  'inventory_items',
  'inventory_movements',
  'quotes',
  'quote_line_items',
  'quote_activity_log',
  'quote_templates',
  'bills',
  'bill_line_items',
  'bill_payments',
  'purchase_orders',
  'po_line_items',
  'fixed_assets',
  'asset_depreciation_entries',
  'debts',
  'debt_contacts',
  'debt_communications',
  'debt_payments',
  'debt_pipeline_stages',
  'debt_evidence',
  'debt_legal_actions',
  'debt_notes',
  'debt_promises',
  'debt_payment_plans',
  'debt_plan_installments',
  'debt_settlements',
  'debt_compliance_log',
  'debt_disputes',
  'debt_audit_log',
  'debt_payment_matches',
  'debt_automation_rules',
  'debt_templates',
  'companies',
  'users',
  'user_companies',
  'settings',
  'notifications',
  'audit_log',
  'email_log',
  'stripe_transactions',
  'invoice_settings',
  'invoice_catalog_items',
  'invoice_reminders',
  'invoice_payment_schedule',
  'invoice_tokens',
  'invoice_debt_links',
  'client_contacts',
  'credit_notes',
  'credit_note_items',
  'rules',
  'rule_logs',
  'saved_views',
  'custom_field_defs',
  'payroll_runs',
  'pay_stubs',
  'federal_payroll_constants',
  'employee_equipment',
  'equipment_penalties',
  'employee_credentials',
  'employee_checklist_items',
  'employee_reviews',
  'employee_disciplinary',
  'pto_policies',
  'pto_balances',
  'pto_transactions',
  'departments',
  'state_tax_brackets',
  'approval_queue',
  'je_comments',
  // Workflow + numbering + email templates (2026-04-23)
  'custom_statuses',
  'status_transitions',
  'entity_status_history',
  'number_sequences',
  'email_templates',
  'email_template_history',
  'email_schedules',
]);

function validateTable(table: string): boolean {
  return VALID_TABLES.has(table);
}

// SECURITY: Tables that hold credentials/secrets must not be writable via the
// generic CRUD IPC — those mutations have to go through dedicated handlers
// (auth:register/auth:login etc.) that enforce password hashing, email
// uniqueness, and audit logging. Without this guard the renderer could
// INSERT a user with an attacker-controlled password_hash, or UPDATE another
// user's hash to log in as them.
const PROTECTED_TABLES = new Set(['users']);

// FK cleanup map: tables whose deletion requires nulling/deleting related rows
// because the referencing FKs are NOT ON DELETE CASCADE.
// Each entry returns SQL statements to run BEFORE the parent delete.
const cleanupReferencesBeforeDelete = (table: string, id: string): void => {
  const dbI = db.getDb();
  const run = (sql: string) => {
    try {
      dbI.prepare(sql).run(id);
    } catch {}
  };
  switch (table) {
    case 'invoices':
      // Delete payments (NOT NULL FK — can't null it)
      run(`DELETE FROM payments WHERE invoice_id = ?`);
      // Null FK references (optional FKs)
      run(`UPDATE time_entries SET invoice_id = NULL, is_invoiced = 0 WHERE invoice_id = ?`);
      run(`UPDATE stripe_transactions SET invoice_id = NULL WHERE invoice_id = ?`);
      run(`UPDATE credit_notes SET invoice_id = NULL WHERE invoice_id = ?`);
      run(`UPDATE quotes SET converted_invoice_id = NULL WHERE converted_invoice_id = ?`);
      run(`DELETE FROM invoice_debt_links WHERE invoice_id = ?`);
      run(`DELETE FROM invoice_reminders WHERE invoice_id = ?`);
      run(`DELETE FROM invoice_payment_schedule WHERE invoice_id = ?`);
      run(`DELETE FROM invoice_coupon_redemptions WHERE invoice_id = ?`);
      run(`DELETE FROM payment_intents WHERE invoice_id = ?`);
      // invoice_line_items has ON DELETE CASCADE, no manual cleanup needed
      break;
    case 'clients':
      // Null FKs in many tables that reference clients
      run(`UPDATE invoices SET client_id = NULL WHERE client_id = ?`);
      run(`UPDATE expenses SET client_id = NULL WHERE client_id = ?`);
      run(`UPDATE time_entries SET client_id = NULL WHERE client_id = ?`);
      run(`UPDATE projects SET client_id = NULL WHERE client_id = ?`);
      run(`UPDATE quotes SET client_id = NULL WHERE client_id = ?`);
      run(`UPDATE debts SET client_id = NULL WHERE client_id = ?`);
      run(`DELETE FROM client_contacts WHERE client_id = ?`);
      break;
    case 'vendors':
      run(`UPDATE expenses SET vendor_id = NULL WHERE vendor_id = ?`);
      run(`UPDATE bills SET vendor_id = NULL WHERE vendor_id = ?`);
      run(`UPDATE purchase_orders SET vendor_id = NULL WHERE vendor_id = ?`);
      break;
    case 'projects':
      run(`UPDATE expenses SET project_id = NULL WHERE project_id = ?`);
      run(`UPDATE time_entries SET project_id = NULL WHERE project_id = ?`);
      run(`UPDATE invoice_line_items SET project_id = NULL WHERE project_id = ?`);
      break;
    case 'employees':
      run(`UPDATE time_entries SET employee_id = NULL WHERE employee_id = ?`);
      run(`DELETE FROM employee_deductions WHERE employee_id = ?`);
      // pay_stubs has FK without cascade — but deleting an employee with
      // pay history would be destructive. Block with clear error if any.
      try {
        const stubs = dbI
          .prepare(`SELECT COUNT(*) as c FROM pay_stubs WHERE employee_id = ?`)
          .get(id) as any;
        if (stubs?.c > 0) {
          throw new Error(
            `Cannot delete employee with ${stubs.c} pay stub(s). Mark inactive instead.`,
          );
        }
      } catch (e: any) {
        if (e.message?.includes('Cannot delete')) throw e;
      }
      break;
    case 'bills':
      run(`DELETE FROM bill_payments WHERE bill_id = ?`);
      run(`DELETE FROM bill_line_items WHERE bill_id = ?`);
      break;
    case 'purchase_orders':
      run(`DELETE FROM po_line_items WHERE po_id = ?`);
      run(`UPDATE bills SET purchase_order_id = NULL WHERE purchase_order_id = ?`);
      break;
    case 'fixed_assets':
      run(`DELETE FROM asset_depreciation_entries WHERE asset_id = ?`);
      break;
    case 'budgets':
      run(`DELETE FROM budget_lines WHERE budget_id = ?`);
      break;
    case 'quotes':
      run(`DELETE FROM quote_line_items WHERE quote_id = ?`);
      break;
    case 'debts':
      // Most debt child tables have ON DELETE CASCADE in schema
      // but invoice_debt_links does not
      run(`DELETE FROM invoice_debt_links WHERE debt_id = ?`);
      break;
    case 'payroll_runs':
      run(`DELETE FROM pay_stubs WHERE payroll_run_id = ?`);
      break;
    case 'inventory_items':
      run(`DELETE FROM inventory_movements WHERE item_id = ?`);
      break;
    case 'accounts':
      // Accounts can't be deleted if they have journal entries — block
      try {
        const lines = dbI
          .prepare(`SELECT COUNT(*) as c FROM journal_entry_lines WHERE account_id = ?`)
          .get(id) as any;
        if (lines?.c > 0) {
          throw new Error(
            `Cannot delete account with ${lines.c} journal entry line(s). Use soft delete (mark inactive) instead.`,
          );
        }
      } catch (e: any) {
        if (e.message?.includes('Cannot delete')) throw e;
      }
      break;
    case 'departments':
      // Departments can't be deleted while employees are still assigned — block
      try {
        const assigned = dbI
          .prepare(`SELECT COUNT(*) as c FROM employees WHERE department_id = ?`)
          .get(id) as any;
        if (assigned?.c > 0) {
          throw new Error(
            `Cannot delete department with ${assigned.c} employee(s) assigned. Reassign them first.`,
          );
        }
      } catch (e: any) {
        if (e.message?.includes('Cannot delete')) throw e;
      }
      break;
  }
};

// Returns the active closed period covering the given date, or null.
function findClosedPeriod(
  companyId: string,
  date: string,
): { id: string; period_start: string; period_end: string; close_reason: string } | null {
  if (!companyId || !date) return null;
  try {
    return db
      .getDb()
      .prepare(
        'SELECT id, period_start, period_end, close_reason FROM closed_periods ' +
          'WHERE company_id = ? AND is_active = 1 AND period_start <= ? AND period_end >= ? LIMIT 1',
      )
      .get(companyId, date, date) as any;
  } catch {
    return null;
  }
}

function isRawQueryAllowed(sql: string): { ok: boolean; reason?: string } {
  if (typeof sql !== 'string' || !sql.trim()) return { ok: false, reason: 'Empty SQL' };
  // Strip string/identifier literals and comments before scanning for ';' — inline literals
  // can legitimately contain semicolons; we only want to block stacked statements.
  let stripped = sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/"(?:""|[^"])*"/g, '""');
  // Allow a single trailing semicolon
  stripped = stripped.replace(/;\s*$/, '');
  if (stripped.includes(';')) return { ok: false, reason: 'Multi-statement SQL not allowed' };
  const head = stripped.trim().toUpperCase();
  const FORBIDDEN = /\b(DROP|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|TRUNCATE)\b/;
  if (FORBIDDEN.test(head)) return { ok: false, reason: 'Forbidden SQL verb' };
  const ALLOWED_LEAD = /^(SELECT|WITH|INSERT|UPDATE|DELETE|REPLACE)\b/;
  if (!ALLOWED_LEAD.test(head))
    return { ok: false, reason: 'Only SELECT/WITH/INSERT/UPDATE/DELETE/REPLACE allowed' };
  // SECURITY: Block writes to credential tables and *modifications* to
  // audit tables via raw SQL. INSERT/DELETE on audit_log remain permitted
  // so legitimate flows (logging new events, full company wipe) work, but
  // UPDATE/REPLACE would let the renderer alter audit history in place.
  if (
    /^(UPDATE|REPLACE)\b/.test(head) &&
    /\b(users|audit_log|debt_audit_log|debt_compliance_log)\b/.test(head)
  ) {
    return {
      ok: false,
      reason: 'UPDATE/REPLACE on credential/audit tables not allowed via raw SQL',
    };
  }
  if (/^(INSERT|DELETE)\b/.test(head) && /\busers\b/.test(head)) {
    return {
      ok: false,
      reason: 'INSERT/DELETE on users not allowed via raw SQL — use auth handlers',
    };
  }
  return { ok: true };
}

// ─── PDF Metadata Builder (P1.6) ─────────────────────────
// Builds a PDFMetadata object that pdf-lib will write into the PDF
// Info dictionary. Pop into Finder "Get Info" or Adobe File →
// Properties to verify. Spotlight uses these fields for indexing.
function buildInvoiceMetadata(invoice: any, company: any, client: any): PDFMetadata {
  const num = invoice?.invoice_number || invoice?.id || '';
  const cur = (invoice?.currency || 'USD').toUpperCase();
  const total = Number(invoice?.total ?? invoice?.total_amount ?? 0);
  const totalStr = (() => {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(total);
    } catch {
      return `${cur} ${total.toFixed(2)}`;
    }
  })();
  const due = invoice?.due_date || '';
  const isCredit = invoice?.invoice_type === 'credit_note';
  const isQuote = invoice?.invoice_type === 'quote';
  const docType = isCredit ? 'Credit Note' : isQuote ? 'Quote' : 'Invoice';
  return {
    title: `${docType} ${num}${client?.name ? ' — ' + client.name : ''}`,
    author: company?.name || 'Business Accounting Pro',
    subject: `${docType} #${num} for ${totalStr}${due ? ' — Due ' + due : ''}`,
    keywords: [
      docType.toLowerCase(),
      String(num),
      client?.name || '',
      cur,
      invoice?.status || '',
      invoice?.po_number ? `po-${invoice.po_number}` : '',
    ].filter(Boolean),
    creator: 'Business Accounting Pro',
  };
}

function buildBillMetadata(bill: any, company: any, vendor: any): PDFMetadata {
  const num = bill?.bill_number || bill?.id || '';
  const cur = (bill?.currency || 'USD').toUpperCase();
  const total = Number(bill?.total ?? 0);
  const totalStr = (() => {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(total);
    } catch {
      return `${cur} ${total.toFixed(2)}`;
    }
  })();
  return {
    title: `Bill ${num}${vendor?.name ? ' — ' + vendor.name : ''}`,
    author: company?.name || 'Business Accounting Pro',
    subject: `Bill #${num} from ${vendor?.name || 'vendor'} for ${totalStr}`,
    keywords: ['bill', 'accounts-payable', String(num), vendor?.name || '', cur].filter(Boolean),
    creator: 'Business Accounting Pro',
  };
}

function buildPOMetadata(po: any, company: any, vendor: any): PDFMetadata {
  const num = po?.po_number || po?.id || '';
  const cur = (po?.currency || 'USD').toUpperCase();
  return {
    title: `Purchase Order ${num}${vendor?.name ? ' — ' + vendor.name : ''}`,
    author: company?.name || 'Business Accounting Pro',
    subject: `PO #${num} to ${vendor?.name || 'vendor'}`,
    keywords: ['purchase-order', 'po', String(num), vendor?.name || '', cur].filter(Boolean),
    creator: 'Business Accounting Pro',
  };
}

// DATE: today's date as YYYY-MM-DD in the user's local timezone. Use this
// instead of new Date().toISOString().slice(0,10), which UTC-shifts the day
// for any local time outside the [00:00, 24:00 - tzoffset] window. Affects
// JE posting dates, settlement accept dates, and any "now" we persist.
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Coalesce rapid re-index calls per (table,id) onto a microtask-ish timer so
// bulk writes don't thrash FTS. Best-effort; never throws into the write path.
const reindexTimers = new Map<string, NodeJS.Timeout>();
export function scheduleReindex(table: string, id: string, op: 'upsert' | 'delete'): void {
  if (!INDEXED_TABLES.has(table)) return;
  const key = `${table}:${id}`;
  const existing = reindexTimers.get(key);
  if (existing) clearTimeout(existing);
  reindexTimers.set(
    key,
    setTimeout(() => {
      reindexTimers.delete(key);
      try {
        const d = db.getDb();
        if (op === 'delete') removeFromIndex(d, table, id);
        else reindexEntity(d, table, id);
      } catch (e) {
        console.warn('[search-index] reindex failed', table, id, e);
      }
    }, 150),
  );
}

// ─── Audit Log Helper ──────────────────────────────────
// Immutable chain-of-custody logging. Called by every debt-mutating handler.
// MUST NEVER throw — audit is a side-effect, not a gate.
export function logDebtAudit(
  debtId: string,
  action: string,
  fieldName: string = '',
  oldValue: string = '',
  newValue: string = '',
  performedBy: string = 'user',
): void {
  try {
    const dbInstance = db.getDb();
    dbInstance
      .prepare(
        `
      INSERT INTO debt_audit_log (id, debt_id, action, field_name, old_value, new_value, performed_by, performed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `,
      )
      .run(uuid(), debtId, action, fieldName, oldValue, newValue, performedBy);
  } catch (_) {
    /* audit logging must never crash the primary operation */
  }
}

// ─── Category Seed Definitions ──────────────────────────
const DEFAULT_CATEGORIES: Array<{
  name: string;
  type: 'expense' | 'income';
  color: string;
  icon: string;
  description: string;
}> = [
  // Office & Administration
  {
    name: 'Office Supplies',
    type: 'expense',
    color: '#6366f1',
    icon: '📎',
    description: 'Pens, paper, binders, and general office supplies',
  },
  {
    name: 'Postage & Shipping',
    type: 'expense',
    color: '#6366f1',
    icon: '📦',
    description: 'Stamps, courier services, and shipping costs',
  },
  {
    name: 'Printing & Copying',
    type: 'expense',
    color: '#6366f1',
    icon: '🖨️',
    description: 'Print and photocopy expenses',
  },
  {
    name: 'Software Subscriptions',
    type: 'expense',
    color: '#6366f1',
    icon: '💻',
    description: 'SaaS tools, apps, and software licenses',
  },
  {
    name: 'Computer Equipment',
    type: 'expense',
    color: '#6366f1',
    icon: '🖥️',
    description: 'Laptops, desktops, peripherals, and accessories',
  },
  {
    name: 'Office Furniture',
    type: 'expense',
    color: '#6366f1',
    icon: '🪑',
    description: 'Desks, chairs, shelving, and office fixtures',
  },
  {
    name: 'Phone & Internet',
    type: 'expense',
    color: '#6366f1',
    icon: '📱',
    description: 'Business phone lines and internet service',
  },
  {
    name: 'Web Hosting',
    type: 'expense',
    color: '#6366f1',
    icon: '🌐',
    description: 'Domain registration and web hosting fees',
  },
  {
    name: 'Cloud Services',
    type: 'expense',
    color: '#6366f1',
    icon: '☁️',
    description: 'Cloud storage, AWS, Azure, GCP, and similar services',
  },
  {
    name: 'IT Support',
    type: 'expense',
    color: '#6366f1',
    icon: '🔧',
    description: 'Technical support and managed IT services',
  },
  // Travel & Transport
  {
    name: 'Airfare',
    type: 'expense',
    color: '#f59e0b',
    icon: '✈️',
    description: 'Business flights and airline tickets',
  },
  {
    name: 'Hotel & Lodging',
    type: 'expense',
    color: '#f59e0b',
    icon: '🏨',
    description: 'Hotel stays and temporary accommodations',
  },
  {
    name: 'Car Rental',
    type: 'expense',
    color: '#f59e0b',
    icon: '🚗',
    description: 'Rental vehicles for business travel',
  },
  {
    name: 'Mileage & Fuel',
    type: 'expense',
    color: '#f59e0b',
    icon: '⛽',
    description: 'Personal vehicle mileage reimbursement and fuel costs',
  },
  {
    name: 'Parking & Tolls',
    type: 'expense',
    color: '#f59e0b',
    icon: '🅿️',
    description: 'Parking fees and toll charges',
  },
  {
    name: 'Meals & Entertainment (Travel)',
    type: 'expense',
    color: '#f59e0b',
    icon: '🍽️',
    description: 'Meals during business travel',
  },
  {
    name: 'Public Transit',
    type: 'expense',
    color: '#f59e0b',
    icon: '🚇',
    description: 'Subway, bus, and public transportation',
  },
  {
    name: 'Rideshare & Taxi',
    type: 'expense',
    color: '#f59e0b',
    icon: '🚕',
    description: 'Uber, Lyft, and taxi fares',
  },
  // Marketing & Sales
  {
    name: 'Advertising',
    type: 'expense',
    color: '#ec4899',
    icon: '📣',
    description: 'General advertising and promotional campaigns',
  },
  {
    name: 'Social Media Ads',
    type: 'expense',
    color: '#ec4899',
    icon: '📱',
    description: 'Facebook, Instagram, LinkedIn, and other paid social ads',
  },
  {
    name: 'Print Materials',
    type: 'expense',
    color: '#ec4899',
    icon: '🗞️',
    description: 'Brochures, flyers, business cards, and print ads',
  },
  {
    name: 'Trade Shows & Events',
    type: 'expense',
    color: '#ec4899',
    icon: '🎪',
    description: 'Conference fees, booth costs, and event sponsorships',
  },
  {
    name: 'Sponsorships',
    type: 'expense',
    color: '#ec4899',
    icon: '🤝',
    description: 'Brand sponsorships and partnerships',
  },
  {
    name: 'PR & Communications',
    type: 'expense',
    color: '#ec4899',
    icon: '📰',
    description: 'Public relations, press releases, and media outreach',
  },
  {
    name: 'Market Research',
    type: 'expense',
    color: '#ec4899',
    icon: '🔍',
    description: 'Surveys, research services, and competitive analysis',
  },
  {
    name: 'Photography & Video',
    type: 'expense',
    color: '#ec4899',
    icon: '📷',
    description: 'Professional photography and video production',
  },
  // Professional Services
  {
    name: 'Accounting & Bookkeeping',
    type: 'expense',
    color: '#14b8a6',
    icon: '📊',
    description: 'CPA, bookkeeper, and accounting services',
  },
  {
    name: 'Legal Fees',
    type: 'expense',
    color: '#14b8a6',
    icon: '⚖️',
    description: 'Attorney fees, contracts, and legal advice',
  },
  {
    name: 'Consulting',
    type: 'expense',
    color: '#14b8a6',
    icon: '💼',
    description: 'Business consultants and advisory services',
  },
  {
    name: 'Recruiting & HR',
    type: 'expense',
    color: '#14b8a6',
    icon: '👥',
    description: 'Staffing agencies and HR consulting',
  },
  {
    name: 'Training & Education',
    type: 'expense',
    color: '#14b8a6',
    icon: '📚',
    description: 'Employee training, courses, and workshops',
  },
  {
    name: 'Certification & Licensing',
    type: 'expense',
    color: '#14b8a6',
    icon: '📜',
    description: 'Professional certifications and license fees',
  },
  // Facilities
  {
    name: 'Rent & Lease',
    type: 'expense',
    color: '#8b5cf6',
    icon: '🏢',
    description: 'Office, retail, or warehouse rent and lease payments',
  },
  {
    name: 'Utilities (Electric)',
    type: 'expense',
    color: '#8b5cf6',
    icon: '⚡',
    description: 'Electricity bills',
  },
  {
    name: 'Utilities (Gas)',
    type: 'expense',
    color: '#8b5cf6',
    icon: '🔥',
    description: 'Natural gas bills',
  },
  {
    name: 'Utilities (Water)',
    type: 'expense',
    color: '#8b5cf6',
    icon: '💧',
    description: 'Water and sewer bills',
  },
  {
    name: 'Janitorial & Cleaning',
    type: 'expense',
    color: '#8b5cf6',
    icon: '🧹',
    description: 'Cleaning services and janitorial supplies',
  },
  {
    name: 'Repairs & Maintenance',
    type: 'expense',
    color: '#8b5cf6',
    icon: '🔨',
    description: 'Building and equipment repairs',
  },
  {
    name: 'Security',
    type: 'expense',
    color: '#8b5cf6',
    icon: '🔒',
    description: 'Security systems, guards, and monitoring services',
  },
  {
    name: 'Property Insurance',
    type: 'expense',
    color: '#8b5cf6',
    icon: '🏠',
    description: 'Building and property insurance premiums',
  },
  // Payroll & HR
  {
    name: 'Salaries & Wages',
    type: 'expense',
    color: '#0ea5e9',
    icon: '💰',
    description: 'Regular employee salaries and hourly wages',
  },
  {
    name: 'Contract Labor',
    type: 'expense',
    color: '#0ea5e9',
    icon: '📋',
    description: 'Payments to independent contractors and freelancers',
  },
  {
    name: 'Employee Benefits',
    type: 'expense',
    color: '#0ea5e9',
    icon: '🎁',
    description: 'Non-insurance employee benefits and perks',
  },
  {
    name: 'Health Insurance',
    type: 'expense',
    color: '#0ea5e9',
    icon: '🏥',
    description: 'Employer-paid health, dental, and vision premiums',
  },
  {
    name: 'Retirement Contributions',
    type: 'expense',
    color: '#0ea5e9',
    icon: '🏦',
    description: '401(k) and pension employer contributions',
  },
  {
    name: 'Payroll Taxes',
    type: 'expense',
    color: '#0ea5e9',
    icon: '🧾',
    description: 'Employer-side FICA, FUTA, and SUTA taxes',
  },
  {
    name: 'Workers Compensation',
    type: 'expense',
    color: '#0ea5e9',
    icon: '🦺',
    description: 'Workers compensation insurance premiums',
  },
  // Finance & Banking
  {
    name: 'Bank Fees',
    type: 'expense',
    color: '#ef4444',
    icon: '🏦',
    description: 'Monthly maintenance fees and bank service charges',
  },
  {
    name: 'Credit Card Fees',
    type: 'expense',
    color: '#ef4444',
    icon: '💳',
    description: 'Merchant processing and credit card transaction fees',
  },
  {
    name: 'Loan Interest',
    type: 'expense',
    color: '#ef4444',
    icon: '📈',
    description: 'Interest paid on business loans and lines of credit',
  },
  {
    name: 'Late Fees',
    type: 'expense',
    color: '#ef4444',
    icon: '⏰',
    description: 'Late payment penalties and fees',
  },
  {
    name: 'Wire Transfer Fees',
    type: 'expense',
    color: '#ef4444',
    icon: '🔄',
    description: 'Domestic and international wire transfer charges',
  },
  {
    name: 'Currency Exchange',
    type: 'expense',
    color: '#ef4444',
    icon: '💱',
    description: 'Foreign currency exchange fees and losses',
  },
  // Cost of Goods
  {
    name: 'Inventory Purchases',
    type: 'expense',
    color: '#f97316',
    icon: '📦',
    description: 'Finished goods purchased for resale',
  },
  {
    name: 'Raw Materials',
    type: 'expense',
    color: '#f97316',
    icon: '🪨',
    description: 'Raw materials used in production',
  },
  {
    name: 'Packaging Materials',
    type: 'expense',
    color: '#f97316',
    icon: '📫',
    description: 'Boxes, bags, and packaging supplies',
  },
  {
    name: 'Freight & Delivery',
    type: 'expense',
    color: '#f97316',
    icon: '🚚',
    description: 'Shipping and freight costs for inbound goods',
  },
  {
    name: 'Customs & Duties',
    type: 'expense',
    color: '#f97316',
    icon: '🛃',
    description: 'Import duties, tariffs, and customs fees',
  },
  // Insurance
  {
    name: 'General Liability',
    type: 'expense',
    color: '#64748b',
    icon: '🛡️',
    description: 'General liability insurance premiums',
  },
  {
    name: 'Professional Liability (E&O)',
    type: 'expense',
    color: '#64748b',
    icon: '📑',
    description: 'Errors and omissions insurance',
  },
  {
    name: 'Commercial Auto',
    type: 'expense',
    color: '#64748b',
    icon: '🚗',
    description: 'Business vehicle insurance premiums',
  },
  {
    name: 'Directors & Officers',
    type: 'expense',
    color: '#64748b',
    icon: '👔',
    description: 'D&O liability insurance',
  },
  // Taxes & Licenses
  {
    name: 'Business Licenses',
    type: 'expense',
    color: '#78716c',
    icon: '📋',
    description: 'Business operating licenses and permits',
  },
  {
    name: 'State Taxes',
    type: 'expense',
    color: '#78716c',
    icon: '🏛️',
    description: 'State income and franchise taxes',
  },
  {
    name: 'Local Taxes',
    type: 'expense',
    color: '#78716c',
    icon: '🏙️',
    description: 'City, county, and local business taxes',
  },
  {
    name: 'Sales Tax Paid',
    type: 'expense',
    color: '#78716c',
    icon: '🧾',
    description: 'Sales taxes remitted to tax authorities',
  },
  {
    name: 'Import Duties',
    type: 'expense',
    color: '#78716c',
    icon: '🛂',
    description: 'Duties on imported goods',
  },
  // Miscellaneous Expense
  {
    name: 'Meals & Entertainment',
    type: 'expense',
    color: '#a3a3a3',
    icon: '🍽️',
    description: 'Business meals and client entertainment',
  },
  {
    name: 'Subscriptions & Dues',
    type: 'expense',
    color: '#a3a3a3',
    icon: '📰',
    description: 'Industry memberships, publications, and dues',
  },
  {
    name: 'Charitable Donations',
    type: 'expense',
    color: '#a3a3a3',
    icon: '❤️',
    description: 'Charitable contributions from the business',
  },
  {
    name: 'Depreciation Expense',
    type: 'expense',
    color: '#a3a3a3',
    icon: '📉',
    description: 'Scheduled depreciation on fixed assets',
  },
  {
    name: 'Amortization',
    type: 'expense',
    color: '#a3a3a3',
    icon: '📊',
    description: 'Amortization of intangible assets',
  },
  {
    name: 'Bad Debt Expense',
    type: 'expense',
    color: '#a3a3a3',
    icon: '💸',
    description: 'Uncollectable accounts written off',
  },
  {
    name: 'Miscellaneous Expense',
    type: 'expense',
    color: '#a3a3a3',
    icon: '📁',
    description: 'Other business expenses not classified elsewhere',
  },
  // Revenue
  {
    name: 'Product Sales',
    type: 'income',
    color: '#22c55e',
    icon: '🛒',
    description: 'Revenue from selling physical or digital products',
  },
  {
    name: 'Service Revenue',
    type: 'income',
    color: '#22c55e',
    icon: '🔧',
    description: 'Revenue from rendering services',
  },
  {
    name: 'Consulting Revenue',
    type: 'income',
    color: '#22c55e',
    icon: '💼',
    description: 'Consulting and advisory fees earned',
  },
  {
    name: 'Subscription Revenue',
    type: 'income',
    color: '#22c55e',
    icon: '🔄',
    description: 'Recurring subscription or membership income',
  },
  {
    name: 'Licensing Revenue',
    type: 'income',
    color: '#22c55e',
    icon: '📜',
    description: 'Income from licensing intellectual property',
  },
  {
    name: 'Commission Income',
    type: 'income',
    color: '#22c55e',
    icon: '💰',
    description: 'Commissions earned on sales or referrals',
  },
  {
    name: 'Royalty Income',
    type: 'income',
    color: '#22c55e',
    icon: '👑',
    description: 'Royalties received from IP or content licensing',
  },
  // Other Income
  {
    name: 'Interest Income',
    type: 'income',
    color: '#4ade80',
    icon: '📈',
    description: 'Interest earned on deposits and investments',
  },
  {
    name: 'Dividend Income',
    type: 'income',
    color: '#4ade80',
    icon: '💵',
    description: 'Dividends received from investments',
  },
  {
    name: 'Rental Income',
    type: 'income',
    color: '#4ade80',
    icon: '🏠',
    description: 'Income from renting property or equipment',
  },
  {
    name: 'Gain on Asset Sale',
    type: 'income',
    color: '#4ade80',
    icon: '📊',
    description: 'Profit from selling business assets',
  },
  {
    name: 'Grant Income',
    type: 'income',
    color: '#4ade80',
    icon: '🏆',
    description: 'Government or foundation grant awards',
  },
  {
    name: 'Refunds Received',
    type: 'income',
    color: '#4ade80',
    icon: '↩️',
    description: 'Vendor refunds and rebates received',
  },
  {
    name: 'Other Income',
    type: 'income',
    color: '#4ade80',
    icon: '➕',
    description: 'Miscellaneous income not classified elsewhere',
  },
];

export function seedDefaultCategories(companyId: string): { seeded: boolean; count: number } {
  const dbInstance = db.getDb();
  const existing = dbInstance
    .prepare('SELECT COUNT(*) as cnt FROM categories WHERE company_id = ?')
    .get(companyId) as { cnt: number };
  if (existing && existing.cnt > 0) {
    return { seeded: false, count: existing.cnt };
  }
  const insertStmt = dbInstance.prepare(`
    INSERT OR IGNORE INTO categories (id, company_id, name, type, color, icon, description, schedule_c_line, is_deductible, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `);
  const insertMany = dbInstance.transaction((rows: typeof DEFAULT_CATEGORIES) => {
    for (const row of rows) {
      const sc = SCHEDULE_C_BY_CATEGORY[row.name];
      insertStmt.run(
        uuid(),
        companyId,
        row.name,
        row.type,
        row.color,
        row.icon,
        row.description,
        sc ? sc.line : '',
        sc ? (sc.deductible ? 1 : 0) : 1,
      );
    }
  });
  insertMany(DEFAULT_CATEGORIES);
  return { seeded: true, count: DEFAULT_CATEGORIES.length };
}

const DEFAULT_EMAIL_TEMPLATES: Record<
  string,
  { label: string; subject: string; body: string; tokens: string[] }
> = {
  invoice_send: {
    label: 'Invoice — Send',
    subject: 'Invoice {{invoice_number}} from {{company_name}}',
    body: 'Hi {{client_name}},\n\nPlease find attached invoice **{{invoice_number}}** for **{{total_due}}** due on **{{due_date}}**.\n\nPay online: {{payment_link}}\n\nThanks,\n{{company_name}}',
    tokens: [
      'client_name',
      'invoice_number',
      'total_due',
      'due_date',
      'company_name',
      'payment_link',
    ],
  },
  payment_reminder_1: {
    label: 'Payment Reminder — First',
    subject: 'Friendly reminder: Invoice {{invoice_number}}',
    body: 'Hi {{client_name}},\n\nThis is a friendly reminder that invoice **{{invoice_number}}** for **{{total_due}}** was due on **{{due_date}}**.\n\nPay online: {{payment_link}}\n\nThanks,\n{{company_name}}',
    tokens: [
      'client_name',
      'invoice_number',
      'total_due',
      'due_date',
      'company_name',
      'payment_link',
    ],
  },
  payment_reminder_2: {
    label: 'Payment Reminder — Second',
    subject: 'Past due: Invoice {{invoice_number}} — {{days_overdue}} days',
    body: 'Hi {{client_name}},\n\nInvoice **{{invoice_number}}** for **{{total_due}}** is now **{{days_overdue}} days** past due.\n\nPlease remit payment as soon as possible: {{payment_link}}\n\nThanks,\n{{company_name}}',
    tokens: [
      'client_name',
      'invoice_number',
      'total_due',
      'due_date',
      'days_overdue',
      'company_name',
      'payment_link',
    ],
  },
  overdue_notice: {
    label: 'Overdue Notice',
    subject: 'OVERDUE: Invoice {{invoice_number}} — {{days_overdue}} days past due',
    body: 'Dear {{client_name}},\n\nDespite previous reminders, invoice **{{invoice_number}}** for **{{total_due}}** remains unpaid and is now **{{days_overdue}} days** overdue.\n\nThis matter requires your immediate attention.\n\n{{company_name}}',
    tokens: ['client_name', 'invoice_number', 'total_due', 'days_overdue', 'company_name'],
  },
  quote_send: {
    label: 'Quote — Send',
    subject: 'Quote {{invoice_number}} from {{company_name}}',
    body: 'Hi {{client_name}},\n\nPlease find attached quote **{{invoice_number}}** for **{{total_due}}**.\n\nThis quote is valid until **{{due_date}}**.\n\nThanks,\n{{company_name}}',
    tokens: ['client_name', 'invoice_number', 'total_due', 'due_date', 'company_name'],
  },
  statement: {
    label: 'Account Statement',
    subject: 'Statement of Account — {{client_name}}',
    body: 'Hi {{client_name}},\n\nPlease find attached your statement showing a balance of **{{total_due}}**.\n\nThanks,\n{{company_name}}',
    tokens: ['client_name', 'total_due', 'company_name'],
  },
  welcome: {
    label: 'Welcome',
    subject: 'Welcome to {{company_name}}',
    body: 'Hi {{client_name}},\n\nThanks for choosing **{{company_name}}**. We look forward to working with you.\n\nBest,\n{{company_name}}',
    tokens: ['client_name', 'company_name'],
  },
  demand_letter: {
    label: 'Demand Letter',
    subject: 'Final Demand — Invoice {{invoice_number}}',
    body: 'Dear {{client_name}},\n\nThis is a **final demand** for payment of invoice **{{invoice_number}}** in the amount of **{{total_due}}**, currently **{{days_overdue}} days** overdue.\n\nFailure to pay within 10 days may result in legal action.\n\n{{company_name}}',
    tokens: ['client_name', 'invoice_number', 'total_due', 'days_overdue', 'company_name'],
  },
};

export function ensureDefaultEmailTemplates(companyId: string) {
  for (const [key, t] of Object.entries(DEFAULT_EMAIL_TEMPLATES)) {
    const existing = db
      .getDb()
      .prepare(`SELECT id FROM email_templates WHERE company_id = ? AND key = ?`)
      .get(companyId, key) as any;
    if (existing) continue;
    const defaultTo = 'client.email';
    db.getDb()
      .prepare(
        `INSERT INTO email_templates (id, company_id, key, label, subject, body, body_format, available_tokens_json, default_to)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        uuid(),
        companyId,
        key,
        t.label,
        t.subject,
        t.body,
        'markdown',
        JSON.stringify(t.tokens),
        defaultTo,
      );
  }
}

export function resolveTemplateTokens(body: string, ctx: Record<string, any>): string {
  return body.replace(/\{\{\s*([\w_]+)\s*\}\}/g, (_m, key) => {
    const v = ctx[key];
    if (v === undefined || v === null) return `{{${key}}}`;
    return String(v);
  });
}

// Format an amount in a specific ISO 4217 currency (mirrors renderer's
// formatCurrency) so {{total_due}} reflects the document's currency
// rather than always defaulting to USD.
function fmtMoney(amount: number, currency?: string | null): string {
  const code = (currency || 'USD').toString().trim().toUpperCase();
  const n = Number.isFinite(amount) ? amount : 0;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(n);
  } catch {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
  }
}

// Resolve the portal deep-link for an invoice — looks up the token in
// invoice_tokens (creating one would require side effects, so we just
// look it up). Returns empty string if no token exists yet.
//
// The base URL supports three formats so admins can swap portal
// endpoints without recompiling:
//   1. {token} placeholder substitution
//   2. /login → appends ?invoice=<token> query param
//   3. anything else → appends /<token> path segment
// Default points at https://rmpgutahps.us/client/login (RMPG Pro
// Services portal). Override per-tenant via the portal_base_url
// setting (settings table, key='portal_base_url').
function buildPortalUrl(base: string, token: string): string {
  const url = (base || '').trim();
  if (!url) return '';
  if (url.includes('{token}')) return url.replace(/\{token\}/g, token);
  const noTrail = url.replace(/\/$/, '');
  if (/\/login$/i.test(noTrail)) return `${noTrail}?invoice=${encodeURIComponent(token)}`;
  return `${noTrail}/${token}`;
}

function resolvePortalLink(
  invoiceId: string,
  fallbackBase: string = 'https://rmpgutahps.us/client/login',
): string {
  try {
    // Allow per-company override via settings table
    const companyId = db.getCurrentCompanyId();
    let base = fallbackBase;
    if (companyId) {
      const setting = db
        .getDb()
        .prepare("SELECT value FROM settings WHERE company_id = ? AND key = 'portal_base_url'")
        .get(companyId) as any;
      if (setting?.value) base = setting.value;
    }
    const row = db
      .getDb()
      .prepare(
        `SELECT token FROM invoice_tokens WHERE invoice_id = ? AND expires_at > 0 ORDER BY expires_at DESC LIMIT 1`,
      )
      .get(invoiceId) as any;
    if (row?.token) return buildPortalUrl(base, row.token);
  } catch {
    /* ignore */
  }
  return '';
}

export function buildTemplateContext(
  companyId: string,
  entityType: string,
  entityId: string,
): Record<string, any> {
  const ctx: Record<string, any> = {};
  try {
    const co = db.getById('companies', companyId);
    ctx.company_name = co?.name || '';
    ctx.company_email = co?.email || '';
    ctx.company_phone = co?.phone || '';
  } catch {}
  try {
    if (entityType === 'invoice') {
      const inv = db.getById('invoices', entityId);
      if (inv) {
        ctx.invoice_number = inv.invoice_number || '';
        // Use real `total` field (schema correction) and honor currency
        const totalNum = Number(inv.total ?? inv.total_amount ?? 0);
        const paid = Number(inv.amount_paid ?? 0);
        ctx.total_due = fmtMoney(totalNum, inv.currency);
        ctx.balance_due = fmtMoney(Math.max(0, totalNum - paid), inv.currency);
        ctx.amount_paid = fmtMoney(paid, inv.currency);
        ctx.due_date = inv.due_date || '';
        ctx.issue_date = inv.issue_date || '';
        if (inv.due_date) {
          const days = Math.floor((Date.now() - new Date(inv.due_date).getTime()) / 86400000);
          ctx.days_overdue = String(Math.max(0, days));
        }
        if (inv.client_id) {
          const client = db.getById('clients', inv.client_id);
          ctx.client_name = client?.name || '';
          ctx.client_email = client?.email || '';
          ctx.client_phone = client?.phone || '';
        }
        // Deep-link to the per-invoice portal page (capability URL)
        ctx.payment_link = resolvePortalLink(inv.id);
        ctx.portal_link = ctx.payment_link;
      }
    } else if (entityType === 'quote') {
      const q = db.getById('quotes', entityId);
      if (q) {
        ctx.invoice_number = q.quote_number || '';
        const totalNum = Number(q.total ?? q.total_amount ?? 0);
        ctx.total_due = fmtMoney(totalNum, q.currency);
        ctx.due_date = q.valid_until || q.expires_at || '';
        ctx.issue_date = q.issue_date || '';
        if (q.client_id) {
          const client = db.getById('clients', q.client_id);
          ctx.client_name = client?.name || '';
          ctx.client_email = client?.email || '';
        }
      }
    } else if (entityType === 'debt') {
      const d = db.getById('debts', entityId);
      if (d) {
        ctx.invoice_number = d.debt_number || d.invoice_number || '';
        ctx.total_due = `$${Number(d.balance || d.original_amount || 0).toFixed(2)}`;
        ctx.due_date = d.original_due_date || '';
        if (d.original_due_date) {
          const days = Math.floor(
            (Date.now() - new Date(d.original_due_date).getTime()) / 86400000,
          );
          ctx.days_overdue = String(Math.max(0, days));
        }
        if (d.client_id) {
          const client = db.getById('clients', d.client_id);
          ctx.client_name = client?.name || '';
          ctx.client_email = client?.email || '';
        }
      }
    }
  } catch {}
  return ctx;
}

export function createIpcDeps(): IpcDeps {
  return Object.freeze({
    scheduleAutoBackup,
    cancelAutoBackup,
    getLastLoginEmail,
    setLastLoginEmail,
    findClosedPeriod,
    postJournalEntry,
    validateTable,
    cleanupReferencesBeforeDelete,
    isRawQueryAllowed,
    buildInvoiceMetadata,
    buildBillMetadata,
    buildPOMetadata,
    VALID_TABLES,
    PROTECTED_TABLES,
    scheduleReindex,
    logDebtAudit,
    seedDefaultCategories,
    localToday,
    ensureDefaultEmailTemplates,
    resolveTemplateTokens,
    buildTemplateContext,
  });
}
