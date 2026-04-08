import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { v4 as uuid } from 'uuid';

let db: Database.Database | null = null;
let currentCompanyId: string | null = null;

export function getDbPath(): string {
  const userDataPath = app.getPath('userData');
  // Place DB directly in userData — no subdirectory creation, avoids APFS orphan-inode race
  const dbPath = path.join(userDataPath, 'accounting.db');
  // One-time migration: move from old databases/ subdir if it exists and is accessible
  const legacyPath = path.join(userDataPath, 'databases', 'accounting.db');
  if (!fs.existsSync(dbPath) && fs.existsSync(legacyPath)) {
    try { fs.renameSync(legacyPath, dbPath); } catch (_) {}
  }
  return dbPath;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export function initDatabase(): Database.Database {
  const dbPath = getDbPath();
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Load and apply schema
  const schemaPath = path.join(__dirname, 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schema);
  }

  // ─── Column migrations (safe — catch errors for already-existing columns) ──
  const migrations: string[] = [
    "ALTER TABLE categories ADD COLUMN color TEXT DEFAULT '#6b7280'",
    "ALTER TABLE categories ADD COLUMN icon TEXT DEFAULT ''",
    "ALTER TABLE categories ADD COLUMN is_active INTEGER DEFAULT 1",
    // Rules engine additions (2026-04-01)
    "ALTER TABLE invoices ADD COLUMN rules_applied TEXT DEFAULT '[]'",
    "ALTER TABLE expenses ADD COLUMN rules_applied TEXT DEFAULT '[]'",
    // Dynamic invoices (2026-04-06)
    "ALTER TABLE invoices ADD COLUMN terms_text TEXT DEFAULT ''",
    `CREATE TABLE IF NOT EXISTS invoice_settings (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL UNIQUE,
      accent_color TEXT NOT NULL DEFAULT '#2563eb',
      logo_data TEXT DEFAULT NULL,
      template_style TEXT NOT NULL DEFAULT 'classic',
      show_logo INTEGER NOT NULL DEFAULT 1,
      show_tax_column INTEGER NOT NULL DEFAULT 1,
      show_payment_terms INTEGER NOT NULL DEFAULT 1,
      footer_text TEXT DEFAULT '',
      default_notes TEXT DEFAULT '',
      default_terms_text TEXT DEFAULT '',
      default_due_days INTEGER NOT NULL DEFAULT 30,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS invoice_catalog_items (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      unit_price REAL NOT NULL DEFAULT 0,
      tax_rate REAL NOT NULL DEFAULT 0,
      account_id TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    // Invoice Studio (2026-04-07) — rich row types, branding, payment schedule
    "ALTER TABLE invoice_line_items ADD COLUMN row_type TEXT DEFAULT 'item'",
    "ALTER TABLE invoice_line_items ADD COLUMN unit_label TEXT DEFAULT ''",
    "ALTER TABLE invoice_line_items ADD COLUMN item_code TEXT DEFAULT ''",
    "ALTER TABLE invoice_line_items ADD COLUMN line_discount REAL DEFAULT 0",
    "ALTER TABLE invoice_line_items ADD COLUMN line_discount_type TEXT DEFAULT 'percent'",
    "ALTER TABLE invoice_settings ADD COLUMN secondary_color TEXT DEFAULT '#64748b'",
    "ALTER TABLE invoice_settings ADD COLUMN watermark_text TEXT DEFAULT ''",
    "ALTER TABLE invoice_settings ADD COLUMN watermark_opacity REAL DEFAULT 0.06",
    "ALTER TABLE invoice_settings ADD COLUMN font_family TEXT DEFAULT 'system'",
    "ALTER TABLE invoice_settings ADD COLUMN header_layout TEXT DEFAULT 'logo-left'",
    "ALTER TABLE invoice_settings ADD COLUMN column_config TEXT DEFAULT '{}'",
    "ALTER TABLE invoice_settings ADD COLUMN payment_qr_url TEXT DEFAULT ''",
    "ALTER TABLE invoice_settings ADD COLUMN show_payment_qr INTEGER DEFAULT 0",
    "ALTER TABLE invoice_catalog_items ADD COLUMN item_code TEXT DEFAULT ''",
    "ALTER TABLE invoice_catalog_items ADD COLUMN unit_label TEXT DEFAULT ''",
    `CREATE TABLE IF NOT EXISTS invoice_payment_schedule (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      milestone_label TEXT NOT NULL DEFAULT '',
      due_date TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      paid INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    // Track 2: Enterprise foundations (2026-04-07)
  "ALTER TABLE employee_deductions ADD COLUMN employer_match REAL DEFAULT 0",
  "ALTER TABLE employee_deductions ADD COLUMN employer_match_type TEXT DEFAULT 'percent'",
  `CREATE TABLE IF NOT EXISTS state_tax_brackets (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  year INTEGER NOT NULL,
  min_income REAL NOT NULL DEFAULT 0,
  max_income REAL DEFAULT NULL,
  rate REAL NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
)`,
  `CREATE TABLE IF NOT EXISTS pto_policies (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  accrual_rate REAL NOT NULL DEFAULT 0,
  accrual_unit TEXT NOT NULL DEFAULT 'hours_per_pay_period',
  cap_hours REAL DEFAULT NULL,
  carry_over_limit REAL DEFAULT 0,
  available_after_days INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
)`,
  `CREATE TABLE IF NOT EXISTS pto_balances (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  policy_id TEXT NOT NULL,
  balance_hours REAL NOT NULL DEFAULT 0,
  used_hours_ytd REAL NOT NULL DEFAULT 0,
  accrued_hours_ytd REAL NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
)`,
  `CREATE TABLE IF NOT EXISTS pto_transactions (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  policy_id TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'accrual',
  hours REAL NOT NULL DEFAULT 0,
  note TEXT DEFAULT '',
  payroll_run_id TEXT DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now'))
)`,
  // Track 1: Data entry expansion (2026-04-07)
    "ALTER TABLE employees ADD COLUMN employment_type TEXT DEFAULT 'full-time'",
    "ALTER TABLE employees ADD COLUMN department TEXT DEFAULT ''",
    "ALTER TABLE employees ADD COLUMN job_title TEXT DEFAULT ''",
    "ALTER TABLE employees ADD COLUMN emergency_contact_name TEXT DEFAULT ''",
    "ALTER TABLE employees ADD COLUMN emergency_contact_phone TEXT DEFAULT ''",
    "ALTER TABLE employees ADD COLUMN routing_number TEXT DEFAULT ''",
    "ALTER TABLE employees ADD COLUMN account_number TEXT DEFAULT ''",
    "ALTER TABLE employees ADD COLUMN account_type TEXT DEFAULT 'checking'",
    "ALTER TABLE employees ADD COLUMN notes TEXT DEFAULT ''",
    "ALTER TABLE employees ADD COLUMN phone TEXT DEFAULT ''",
    "ALTER TABLE employees ADD COLUMN address_line1 TEXT DEFAULT ''",
    "ALTER TABLE employees ADD COLUMN address_line2 TEXT DEFAULT ''",
    "ALTER TABLE employees ADD COLUMN city TEXT DEFAULT ''",
    "ALTER TABLE employees ADD COLUMN zip TEXT DEFAULT ''",
    "ALTER TABLE employees ADD COLUMN ssn TEXT DEFAULT ''",
    "ALTER TABLE clients ADD COLUMN industry TEXT DEFAULT ''",
    "ALTER TABLE clients ADD COLUMN website TEXT DEFAULT ''",
    "ALTER TABLE clients ADD COLUMN company_size TEXT DEFAULT ''",
    "ALTER TABLE clients ADD COLUMN credit_limit REAL DEFAULT 0",
    "ALTER TABLE clients ADD COLUMN preferred_payment_method TEXT DEFAULT ''",
    "ALTER TABLE clients ADD COLUMN assigned_rep_id TEXT DEFAULT NULL",
    "ALTER TABLE clients ADD COLUMN internal_notes TEXT DEFAULT ''",
    "ALTER TABLE clients ADD COLUMN tags TEXT DEFAULT '[]'",
    `CREATE TABLE IF NOT EXISTS client_contacts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  title TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  is_primary INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
)`,
    "ALTER TABLE vendors ADD COLUMN w9_status TEXT DEFAULT 'not_collected'",
    "ALTER TABLE vendors ADD COLUMN is_1099_eligible INTEGER DEFAULT 0",
    "ALTER TABLE vendors ADD COLUMN ach_routing TEXT DEFAULT ''",
    "ALTER TABLE vendors ADD COLUMN ach_account TEXT DEFAULT ''",
    "ALTER TABLE vendors ADD COLUMN ach_account_type TEXT DEFAULT 'checking'",
    "ALTER TABLE vendors ADD COLUMN contract_start TEXT DEFAULT ''",
    "ALTER TABLE vendors ADD COLUMN contract_end TEXT DEFAULT ''",
    "ALTER TABLE vendors ADD COLUMN contract_notes TEXT DEFAULT ''",
    "ALTER TABLE debts ADD COLUMN employer_name TEXT DEFAULT ''",
    "ALTER TABLE debts ADD COLUMN employment_status TEXT DEFAULT 'unknown'",
    "ALTER TABLE debts ADD COLUMN monthly_income_estimate REAL DEFAULT 0",
    "ALTER TABLE debts ADD COLUMN best_contact_time TEXT DEFAULT ''",
    "ALTER TABLE debts ADD COLUMN debtor_attorney_name TEXT DEFAULT ''",
    "ALTER TABLE debts ADD COLUMN debtor_attorney_phone TEXT DEFAULT ''",
    "ALTER TABLE debt_communications ADD COLUMN outcome TEXT DEFAULT ''",
    "ALTER TABLE debt_communications ADD COLUMN next_action TEXT DEFAULT ''",
    "ALTER TABLE debt_communications ADD COLUMN next_action_date TEXT DEFAULT ''",
    "ALTER TABLE debt_communications ADD COLUMN promise_amount REAL DEFAULT 0",
    "ALTER TABLE debt_communications ADD COLUMN promise_date TEXT DEFAULT ''",
    `CREATE TABLE IF NOT EXISTS debt_promises (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  promised_date TEXT NOT NULL DEFAULT '',
  promised_amount REAL NOT NULL DEFAULT 0,
  kept INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
)`,
  // Debt & Invoice Enhancements (2026-04-07)
  "ALTER TABLE debts ADD COLUMN assigned_collector_id TEXT DEFAULT NULL",
  "ALTER TABLE debts ADD COLUMN auto_advance_enabled INTEGER DEFAULT 0",
  "ALTER TABLE invoices ADD COLUMN po_number TEXT DEFAULT ''",
  "ALTER TABLE invoices ADD COLUMN job_reference TEXT DEFAULT ''",
  "ALTER TABLE invoices ADD COLUMN internal_notes TEXT DEFAULT ''",
  "ALTER TABLE invoices ADD COLUMN late_fee_pct REAL DEFAULT 0",
  "ALTER TABLE invoices ADD COLUMN late_fee_grace_days INTEGER DEFAULT 0",
  "ALTER TABLE invoices ADD COLUMN discount_pct REAL DEFAULT 0",
  "ALTER TABLE invoice_line_items ADD COLUMN discount_pct REAL DEFAULT 0",
  "ALTER TABLE invoice_line_items ADD COLUMN tax_rate_override REAL DEFAULT -1",
  "ALTER TABLE clients ADD COLUMN default_payment_terms TEXT DEFAULT ''",
  "ALTER TABLE clients ADD COLUMN default_late_fee_pct REAL DEFAULT 0",
  `CREATE TABLE IF NOT EXISTS debt_payment_plans (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  installment_amount REAL NOT NULL DEFAULT 0,
  frequency TEXT NOT NULL DEFAULT 'monthly',
  start_date TEXT NOT NULL DEFAULT '',
  total_installments INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
)`,
  `CREATE TABLE IF NOT EXISTS debt_plan_installments (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES debt_payment_plans(id) ON DELETE CASCADE,
  due_date TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  paid INTEGER NOT NULL DEFAULT 0,
  paid_date TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
)`,
  `CREATE TABLE IF NOT EXISTS debt_settlements (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  offer_amount REAL NOT NULL DEFAULT 0,
  offer_pct REAL NOT NULL DEFAULT 0,
  offered_date TEXT NOT NULL DEFAULT '',
  response TEXT NOT NULL DEFAULT 'pending',
  counter_amount REAL DEFAULT 0,
  accepted_date TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
)`,
  `CREATE TABLE IF NOT EXISTS debt_compliance_log (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL DEFAULT '',
  event_date TEXT NOT NULL DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
)`,
  `CREATE TABLE IF NOT EXISTS invoice_debt_links (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  debt_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(invoice_id, debt_id)
)`,
  // Invoice type & currency enhancements (2026-04-07)
  "ALTER TABLE invoices ADD COLUMN invoice_type TEXT DEFAULT 'standard'",
  "ALTER TABLE invoices ADD COLUMN currency TEXT DEFAULT 'USD'",
  "ALTER TABLE invoices ADD COLUMN terms_accepted INTEGER DEFAULT 0",
  "ALTER TABLE invoices ADD COLUMN shipping_amount REAL DEFAULT 0",
  "ALTER TABLE invoice_line_items ADD COLUMN unit_label_override TEXT DEFAULT ''",
  "ALTER TABLE invoice_line_items ADD COLUMN sort_order INTEGER DEFAULT 0",
  `CREATE TABLE IF NOT EXISTS inventory_movements (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK(type IN ('in','out','adjustment','initial')),
    quantity REAL NOT NULL,
    unit_cost REAL DEFAULT 0,
    reference TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_by TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  "ALTER TABLE inventory_items ADD COLUMN reorder_qty REAL DEFAULT 0",
  // Debt notes table for quick internal annotations (2026-04-07)
  `CREATE TABLE IF NOT EXISTS debt_notes (
    id TEXT PRIMARY KEY,
    debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
    note TEXT NOT NULL DEFAULT '',
    created_by TEXT DEFAULT 'user',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_debt_notes_debt ON debt_notes(debt_id)`,
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch (_) { /* column already exists — ignore */ }
  }

  return db;
}

// Reinitialize database (used after restoring from backup)
export function reinitDatabase(): Database.Database {
  if (db) {
    try { db.close(); } catch (_) {}
  }
  return initDatabase();
}

export function switchCompany(companyId: string): void {
  currentCompanyId = companyId;
}

export function getCurrentCompanyId(): string | null {
  return currentCompanyId;
}

// ─── Generic CRUD ────────────────────────────────────────

export function queryAll(
  table: string,
  filters: Record<string, any> = {},
  sort?: { field: string; dir: 'asc' | 'desc' },
  limit?: number,
  offset?: number
): any[] {
  const conditions: string[] = [];
  const params: any[] = [];

  for (const [key, value] of Object.entries(filters)) {
    if (value === null) {
      conditions.push(`${key} IS NULL`);
    } else if (Array.isArray(value)) {
      conditions.push(`${key} IN (${value.map(() => '?').join(',')})`);
      params.push(...value);
    } else if (key.endsWith('_gte')) {
      const col = key.slice(0, -4);
      conditions.push(`${col} >= ?`);
      params.push(value);
    } else if (key.endsWith('_lte')) {
      const col = key.slice(0, -4);
      conditions.push(`${col} <= ?`);
      params.push(value);
    } else if (key.endsWith('_like')) {
      const col = key.slice(0, -5);
      conditions.push(`${col} LIKE ?`);
      params.push(value);
    } else if (key.endsWith('_ne')) {
      const col = key.slice(0, -3);
      conditions.push(`${col} != ?`);
      params.push(value);
    } else {
      conditions.push(`${key} = ?`);
      params.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
    }
  }

  let sql = `SELECT * FROM ${table}`;
  if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`;
  if (sort) sql += ` ORDER BY ${sort.field} ${sort.dir.toUpperCase()}`;
  if (limit) sql += ` LIMIT ${limit}`;
  if (offset) sql += ` OFFSET ${offset}`;

  return getDb().prepare(sql).all(...params);
}

export function getById(table: string, id: string): any {
  return getDb().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
}

export function create(table: string, data: Record<string, any>): any {
  const id = data.id || uuid();
  const record = { ...data, id };

  const serialized: Record<string, any> = {};
  for (const [key, value] of Object.entries(record)) {
    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
      serialized[key] = JSON.stringify(value);
    } else if (typeof value === 'boolean') {
      serialized[key] = value ? 1 : 0;
    } else {
      serialized[key] = value;
    }
  }

  const keys = Object.keys(serialized);
  const placeholders = keys.map(() => '?').join(', ');
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`;

  getDb().prepare(sql).run(...keys.map(k => serialized[k]));
  return getById(table, id);
}

// Tables that do NOT have an updated_at column.
// Adding a table missing from this set causes every update() call on it
// to append ", updated_at = datetime('now')" → immediate SQLite crash.
const tablesWithoutUpdatedAt = new Set([
  // Child / junction tables (original)
  'invoice_line_items',
  'journal_entry_lines',
  'pay_stubs',
  'budget_lines',
  'bank_reconciliation_matches',
  // Financial record tables (append-only by design)
  'payments',          // has created_at only
  'tax_payments',      // has created_at only
  'tax_categories',    // has created_at only
  // Transaction / log tables (immutable after insert)
  'bank_transactions', // has imported_at only
  'audit_log',         // has timestamp only
  'email_log',         // has sent_at only
  'stripe_transactions', // has synced_at only
  // Metadata / reference tables
  'documents',         // has uploaded_at only
  'notifications',     // has created_at only
  'custom_field_defs', // has created_at only
  'saved_views',       // has created_at only
  'user_companies',    // has created_at only
  // Debt collection child tables — created_at only
  'debt_contacts', 'debt_communications', 'debt_payments',
  'debt_pipeline_stages', 'debt_evidence',
  'quote_line_items',
  // Invoice reminders — created_at only
  'invoice_reminders',
  // Invoice payment schedule — created_at only
  'invoice_payment_schedule',
  // Track 1 child tables — created_at only
  'client_contacts', 'debt_promises',
  // Track 2 child tables — created_at only
  'state_tax_brackets', 'pto_transactions',
  // Debt & Invoice Enhancement child tables — created_at only
  'debt_payment_plans', 'debt_plan_installments', 'debt_settlements',
  'debt_compliance_log', 'invoice_debt_links',
]);

export function update(table: string, id: string, data: Record<string, any>): any {
  const serialized: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
      serialized[key] = JSON.stringify(value);
    } else if (typeof value === 'boolean') {
      serialized[key] = value ? 1 : 0;
    } else {
      serialized[key] = value;
    }
  }

  const sets = Object.keys(serialized).map(k => `${k} = ?`).join(', ');
  const updatedAtClause = tablesWithoutUpdatedAt.has(table) ? '' : ", updated_at = datetime('now')";
  const sql = `UPDATE ${table} SET ${sets}${updatedAtClause} WHERE id = ?`;

  getDb().prepare(sql).run(...Object.values(serialized), id);
  return getById(table, id);
}

export function remove(table: string, id: string): void {
  getDb().prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
}

export function logAudit(
  companyId: string,
  entityType: string,
  entityId: string,
  action: 'create' | 'update' | 'delete',
  changes: Record<string, any> = {}
): void {
  create('audit_log', {
    company_id: companyId,
    entity_type: entityType,
    entity_id: entityId,
    action,
    changes,
    performed_by: 'user',
  });
}

export function runQuery(sql: string, params: any[] = []): any[] {
  return getDb().prepare(sql).all(...params);
}

export function execQuery(sql: string, params: any[] = []): void {
  getDb().prepare(sql).run(...params);
}

// ─── Seed Default Chart of Accounts ──────────────────────

export function seedDefaultAccounts(companyId: string): void {
  // Guard: skip if accounts already exist for this company (prevents UNIQUE crash on double-call)
  const existing = getDb()
    .prepare('SELECT COUNT(*) as count FROM accounts WHERE company_id = ?')
    .get(companyId) as { count: number };
  if (existing?.count > 0) return;

  const defaults = [
    { code: '1000', name: 'Cash', type: 'asset', subtype: 'current' },
    { code: '1010', name: 'Checking Account', type: 'asset', subtype: 'bank' },
    { code: '1020', name: 'Savings Account', type: 'asset', subtype: 'bank' },
    { code: '1100', name: 'Accounts Receivable', type: 'asset', subtype: 'current' },
    { code: '1200', name: 'Prepaid Expenses', type: 'asset', subtype: 'current' },
    { code: '1500', name: 'Equipment', type: 'asset', subtype: 'fixed' },
    { code: '1510', name: 'Accumulated Depreciation', type: 'asset', subtype: 'contra' },
    { code: '2000', name: 'Accounts Payable', type: 'liability', subtype: 'current' },
    { code: '2100', name: 'Credit Card', type: 'liability', subtype: 'current' },
    { code: '2200', name: 'Payroll Liabilities', type: 'liability', subtype: 'current' },
    { code: '2300', name: 'Sales Tax Payable', type: 'liability', subtype: 'current' },
    { code: '2400', name: 'Federal Tax Payable', type: 'liability', subtype: 'current' },
    { code: '2410', name: 'State Tax Payable', type: 'liability', subtype: 'current' },
    { code: '3000', name: "Owner's Equity", type: 'equity', subtype: 'owner' },
    { code: '3100', name: "Owner's Draw", type: 'equity', subtype: 'draw' },
    { code: '3200', name: 'Retained Earnings', type: 'equity', subtype: 'retained' },
    { code: '4000', name: 'Service Revenue', type: 'revenue', subtype: 'operating' },
    { code: '4100', name: 'Consulting Revenue', type: 'revenue', subtype: 'operating' },
    { code: '4200', name: 'Project Revenue', type: 'revenue', subtype: 'operating' },
    { code: '4900', name: 'Other Income', type: 'revenue', subtype: 'other' },
    { code: '5000', name: 'Cost of Services', type: 'expense', subtype: 'cogs' },
    { code: '6000', name: 'Advertising & Marketing', type: 'expense', subtype: 'operating' },
    { code: '6100', name: 'Bank Fees', type: 'expense', subtype: 'operating' },
    { code: '6200', name: 'Contractors', type: 'expense', subtype: 'operating' },
    { code: '6300', name: 'Insurance', type: 'expense', subtype: 'operating' },
    { code: '6400', name: 'Office Supplies', type: 'expense', subtype: 'operating' },
    { code: '6500', name: 'Professional Fees', type: 'expense', subtype: 'operating' },
    { code: '6600', name: 'Rent', type: 'expense', subtype: 'operating' },
    { code: '6700', name: 'Software & Subscriptions', type: 'expense', subtype: 'operating' },
    { code: '6800', name: 'Travel & Meals', type: 'expense', subtype: 'operating' },
    { code: '6900', name: 'Utilities', type: 'expense', subtype: 'operating' },
    { code: '7000', name: 'Payroll Expense', type: 'expense', subtype: 'payroll' },
    { code: '7100', name: 'Payroll Tax Expense', type: 'expense', subtype: 'payroll' },
    { code: '7200', name: 'Depreciation Expense', type: 'expense', subtype: 'operating' },
    { code: '7500', name: 'Stripe Processing Fees', type: 'expense', subtype: 'operating' },
    { code: '9000', name: 'Miscellaneous Expense', type: 'expense', subtype: 'other' },
  ];

  for (const acct of defaults) {
    create('accounts', { company_id: companyId, ...acct });
  }
}
