import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { v4 as uuid } from 'uuid';
import {
  TABLES_WITHOUT_UPDATED_AT,
  TABLES_WITH_DELETED_AT,
  SOFT_DELETE_TABLES,
} from './tableConfig';

// Aliases for backward compatibility with local references
const tablesWithoutUpdatedAt = TABLES_WITHOUT_UPDATED_AT;
const tablesWithDeletedAt = TABLES_WITH_DELETED_AT;
// Re-export for consumers like ipc/index.ts
export { SOFT_DELETE_TABLES } from './tableConfig';

let db: Database.Database | null = null;
let currentCompanyId: string | null = null;
// "WHO" SYSTEM (added 2026-05-25 during who-system review):
// Mirror of currentCompanyId for the authenticated user. Set from
// auth:login and cleared from auth:logout. Used by logAudit() and any
// other module that needs to record "who did this" without relying on
// the renderer to pass user_id (which is forgeable). The single-user
// model matches the current Electron app architecture — only one
// session can be active per main process at a time.
let currentUserId: string | null = null;
let currentUserEmail: string | null = null;

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

// INTEGRITY: round a money value to 2 decimal places to avoid float drift.
// Use at the DB write boundary anywhere we accumulate (e.g. amount_paid +=
// payment.amount). Without this, repeated additions silently produce values
// like 100.00000000000001 which break equality checks downstream.
export function roundCents(value: any): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

// P1.18: schema-version constant. Bump on backwards-INCOMPATIBLE
// changes (drop column, change CHECK). The DB records the highest
// version it's been touched by; if that exceeds APP_SCHEMA_VERSION,
// we refuse to open it rather than corrupt it. Additive migrations
// (ALTER ADD COLUMN, CREATE INDEX) don't need a bump.
const APP_SCHEMA_VERSION = 2;

// P2.20: Performance pragmas. WAL allows concurrent reads during
// writes. synchronous=NORMAL is safe under WAL. 64MB cache + 256MB
// mmap window covers a typical accounting DB without disk hits on
// hot tables.
function applyPerformancePragmas(database: Database.Database): void {
  try {
    database.pragma('journal_mode = WAL');
    database.pragma('synchronous = NORMAL');
    database.pragma('cache_size = -64000');
    database.pragma('mmap_size = 268435456');
    database.pragma('foreign_keys = ON');
    database.pragma('temp_store = MEMORY');
  } catch (err) {
    console.warn('[db] performance pragma application partial:', err);
  }
}

// P1.18: refuse to open a DB stamped by a newer app build.
function checkSchemaVersionOrThrow(database: Database.Database): void {
  try {
    const hasMeta = database.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_meta'"
    ).get();
    if (!hasMeta) return; // brand new DB
    const row = database.prepare(
      'SELECT version FROM schema_meta WHERE id = 1'
    ).get() as { version?: number } | undefined;
    const dbVersion = Number(row?.version ?? 1);
    if (dbVersion > APP_SCHEMA_VERSION) {
      throw new Error(
        'Database was last opened by a newer app build (schema v' + dbVersion +
        '; this app supports v' + APP_SCHEMA_VERSION + '). Refusing to open to prevent data corruption. ' +
        'Update the desktop app to the latest version, or restore a backup taken with this app version.'
      );
    }
  } catch (err: any) {
    if (err?.message?.includes('newer app build')) throw err;
    // schema_meta missing or unreadable — proceed (migrations will create it)
  }
}

export function initDatabase(): Database.Database {
  const dbPath = getDbPath();
  db = new Database(dbPath);
  applyPerformancePragmas(db);
  checkSchemaVersionOrThrow(db);

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
    // Catalog form needs a default quantity that auto-fills onto invoice
    // line items (e.g. "License Pack — 5 seats" defaults qty=5). Idempotent
    // ALTER (existing rows get DEFAULT 1).
    "ALTER TABLE invoice_catalog_items ADD COLUMN default_quantity REAL DEFAULT 1",
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
  // Expense line items (2026-04-08)
  `CREATE TABLE IF NOT EXISTS expense_line_items (
    id TEXT PRIMARY KEY,
    expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    description TEXT DEFAULT '',
    quantity REAL DEFAULT 1,
    unit_price REAL DEFAULT 0,
    amount REAL DEFAULT 0,
    account_id TEXT REFERENCES accounts(id),
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_expense_li_expense ON expense_line_items(expense_id)`,
  // Debt disputes (2026-04-08)
  `CREATE TABLE IF NOT EXISTS debt_disputes (
    id TEXT PRIMARY KEY,
    debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
    dispute_date TEXT DEFAULT (date('now')),
    reason TEXT NOT NULL DEFAULT 'other' CHECK(reason IN ('not_my_debt','wrong_amount','already_paid','statute_expired','identity_theft','other')),
    description TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','investigating','resolved','rejected')),
    resolution TEXT DEFAULT '',
    resolved_date TEXT,
    resolved_by TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_debt_disputes_debt ON debt_disputes(debt_id)`,
  // Debtor contact preferences (2026-04-08)
  "ALTER TABLE debts ADD COLUMN preferred_contact_method TEXT DEFAULT ''",
  "ALTER TABLE debts ADD COLUMN do_not_call INTEGER DEFAULT 0",
  "ALTER TABLE debts ADD COLUMN cease_desist_active INTEGER DEFAULT 0",
  // Invoice late fee & dunning (2026-04-08)
  "ALTER TABLE invoices ADD COLUMN late_fee_applied INTEGER DEFAULT 0",
  "ALTER TABLE invoices ADD COLUMN dunning_stage INTEGER DEFAULT 0",
  // Payroll run type (2026-04-08)
  "ALTER TABLE payroll_runs ADD COLUMN run_type TEXT DEFAULT 'regular'",
  // Invoice reorder + customizations (2026-04-10)
  // Per-line styling
  "ALTER TABLE invoice_line_items ADD COLUMN bold INTEGER DEFAULT 0",
  "ALTER TABLE invoice_line_items ADD COLUMN italic INTEGER DEFAULT 0",
  "ALTER TABLE invoice_line_items ADD COLUMN highlight_color TEXT DEFAULT ''",
  // Custom header field labels (per-company)
  "ALTER TABLE invoice_settings ADD COLUMN custom_field_1_label TEXT DEFAULT ''",
  "ALTER TABLE invoice_settings ADD COLUMN custom_field_2_label TEXT DEFAULT ''",
  "ALTER TABLE invoice_settings ADD COLUMN custom_field_3_label TEXT DEFAULT ''",
  "ALTER TABLE invoice_settings ADD COLUMN custom_field_4_label TEXT DEFAULT ''",
  // Custom header field values (per-invoice)
  "ALTER TABLE invoices ADD COLUMN custom_field_1 TEXT DEFAULT ''",
  "ALTER TABLE invoices ADD COLUMN custom_field_2 TEXT DEFAULT ''",
  "ALTER TABLE invoices ADD COLUMN custom_field_3 TEXT DEFAULT ''",
  "ALTER TABLE invoices ADD COLUMN custom_field_4 TEXT DEFAULT ''",
  // DC Immersive Workspace (2026-04-12)
  `CREATE TABLE IF NOT EXISTS debt_audit_log (
    id TEXT PRIMARY KEY,
    debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    field_name TEXT DEFAULT '',
    old_value TEXT DEFAULT '',
    new_value TEXT DEFAULT '',
    performed_by TEXT DEFAULT 'user',
    performed_at TEXT DEFAULT (datetime('now')),
    ip_address TEXT DEFAULT '',
    notes TEXT DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS idx_debt_audit_debt ON debt_audit_log(debt_id)`,
  `CREATE TABLE IF NOT EXISTS debt_payment_matches (
    id TEXT PRIMARY KEY,
    bank_transaction_id TEXT NOT NULL,
    debt_id TEXT NOT NULL,
    match_type TEXT NOT NULL CHECK(match_type IN ('auto','suggested')),
    confidence REAL DEFAULT 0,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_dpm_debt ON debt_payment_matches(debt_id)`,
  `CREATE INDEX IF NOT EXISTS idx_dpm_txn ON debt_payment_matches(bank_transaction_id)`,
  // Expense approval workflow (2026-04-12)
  "ALTER TABLE expenses ADD COLUMN approved_by TEXT DEFAULT ''",
  "ALTER TABLE expenses ADD COLUMN approved_date TEXT DEFAULT ''",
  "ALTER TABLE expenses ADD COLUMN rejection_reason TEXT DEFAULT ''",
  // Performance indexes (2026-04-12)
  "CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id)",
  "CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(company_id, status)",
  "CREATE INDEX IF NOT EXISTS idx_invoices_due ON invoices(company_id, due_date)",
  "CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(company_id, date)",
  "CREATE INDEX IF NOT EXISTS idx_expenses_vendor ON expenses(vendor_id)",
  "CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category_id)",
  "CREATE INDEX IF NOT EXISTS idx_accounts_company ON accounts(company_id, code)",
  "CREATE INDEX IF NOT EXISTS idx_je_company_date ON journal_entries(company_id, date)",
  "CREATE INDEX IF NOT EXISTS idx_jel_account ON journal_entry_lines(account_id)",
  "CREATE INDEX IF NOT EXISTS idx_time_entries_project ON time_entries(project_id)",
  "CREATE INDEX IF NOT EXISTS idx_documents_entity ON documents(entity_type, entity_id)",
  "CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id)",
  "CREATE INDEX IF NOT EXISTS idx_clients_company ON clients(company_id)",
  "CREATE INDEX IF NOT EXISTS idx_vendors_company ON vendors(company_id)",
  "CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id)",
  // ── Advanced Debt Collection Features (2026-04-23) ─────────────
  // Feature 1: Skip Trace Module
  `CREATE TABLE IF NOT EXISTS debt_skip_traces (
    id TEXT PRIMARY KEY,
    debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
    trace_date TEXT DEFAULT (date('now')),
    source TEXT DEFAULT '',
    address_tried TEXT DEFAULT '',
    phone_tried TEXT DEFAULT '',
    email_tried TEXT DEFAULT '',
    employer_found TEXT DEFAULT '',
    result TEXT DEFAULT 'pending' CHECK(result IN ('pending','verified','invalid','no_contact')),
    notes TEXT DEFAULT '',
    created_by TEXT DEFAULT 'user',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_skip_traces_debt ON debt_skip_traces(debt_id)`,
  // Feature 2: Debtor Financial Profile
  "ALTER TABLE debts ADD COLUMN debtor_ssn_last4 TEXT DEFAULT ''",
  "ALTER TABLE debts ADD COLUMN debtor_dob TEXT DEFAULT ''",
  "ALTER TABLE debts ADD COLUMN debtor_employer TEXT DEFAULT ''",
  "ALTER TABLE debts ADD COLUMN debtor_income_monthly REAL DEFAULT 0",
  "ALTER TABLE debts ADD COLUMN debtor_assets_description TEXT DEFAULT ''",
  "ALTER TABLE debts ADD COLUMN debtor_bank_name TEXT DEFAULT ''",
  // Feature 6: Debtor Credit Score Tracking
  "ALTER TABLE debts ADD COLUMN credit_score INTEGER DEFAULT 0",
  "ALTER TABLE debts ADD COLUMN credit_score_date TEXT DEFAULT ''",
  "ALTER TABLE debts ADD COLUMN credit_score_source TEXT DEFAULT ''",
  // Feature 10: Multi-Currency Debt Support
  "ALTER TABLE debts ADD COLUMN currency TEXT DEFAULT 'USD'",
  "ALTER TABLE debts ADD COLUMN exchange_rate REAL DEFAULT 1.0",
  // Feature 16: Interest Freeze/Resume
  "ALTER TABLE debts ADD COLUMN interest_frozen INTEGER DEFAULT 0",
  "ALTER TABLE debts ADD COLUMN interest_frozen_date TEXT DEFAULT ''",
  "ALTER TABLE debts ADD COLUMN interest_frozen_reason TEXT DEFAULT ''",
  // Feature 18: Collection Cost Tracking
  "ALTER TABLE debts ADD COLUMN collection_costs REAL DEFAULT 0",
  "ALTER TABLE debts ADD COLUMN agency_commission_rate REAL DEFAULT 0",
  "ALTER TABLE debts ADD COLUMN agency_commission_paid REAL DEFAULT 0",
  // Feature 24: Collection Campaign Manager
  `CREATE TABLE IF NOT EXISTS debt_campaigns (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT DEFAULT '',
    description TEXT DEFAULT '',
    status TEXT DEFAULT 'active' CHECK(status IN ('active','paused','completed')),
    target_stage TEXT DEFAULT '',
    target_age_min INTEGER DEFAULT 0,
    target_age_max INTEGER DEFAULT 999,
    letter_template_id TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // Pay stub deduction breakdown columns (2026-04-23)
  "ALTER TABLE pay_stubs ADD COLUMN pretax_deductions REAL DEFAULT 0",
  "ALTER TABLE pay_stubs ADD COLUMN posttax_deductions REAL DEFAULT 0",
  "ALTER TABLE pay_stubs ADD COLUMN deduction_detail TEXT DEFAULT '{}'",
  // Expense reimbursement tracking (2026-04-23)
  "ALTER TABLE expenses ADD COLUMN reimbursed INTEGER DEFAULT 0",
  "ALTER TABLE expenses ADD COLUMN reimbursed_date TEXT DEFAULT ''",
  // ── Cross-entity integration layer (2026-04-24) ────────────────────
  // NOTE: audit_log originally had CHECK(action IN ('create','update','delete'))
  // which silently rejects export_pdf/email_pdf/print rows. We can't safely
  // ALTER a CHECK constraint without a full table rebuild, and mid-release
  // rebuilds are fragile. Writers now try the CHECK'd insert and fall back
  // to a generic 'update' action if that fails — see logAudit().
  // Generic entity relations — one place to record "X touches Y" so the
  // Related panel doesn't need to know every table's join path. Populated
  // both explicitly (handlers can record custom relations, e.g. bill↔PO)
  // and implicitly (derived at query time from FK columns).
  `CREATE TABLE IF NOT EXISTS entity_relations (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    from_type TEXT NOT NULL,
    from_id TEXT NOT NULL,
    to_type TEXT NOT NULL,
    to_id TEXT NOT NULL,
    relation TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, from_type, from_id, to_type, to_id, relation)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_entity_rel_from ON entity_relations(company_id, from_type, from_id)",
  "CREATE INDEX IF NOT EXISTS idx_entity_rel_to   ON entity_relations(company_id, to_type, to_id)",
  // Stripe cache objects can link back to a local entity (invoice/client/
  // expense/bill). Keeps the bidirectional graph complete.
  "ALTER TABLE stripe_cache ADD COLUMN local_entity_type TEXT DEFAULT ''",
  "ALTER TABLE stripe_cache ADD COLUMN local_entity_id TEXT DEFAULT ''",
  "CREATE INDEX IF NOT EXISTS idx_stripe_cache_local ON stripe_cache(company_id, local_entity_type, local_entity_id)",
  // Feature 9: Payroll run notes
  "ALTER TABLE payroll_runs ADD COLUMN notes TEXT DEFAULT ''",
  // Feature 22: Employee count stored on payroll run
  "ALTER TABLE payroll_runs ADD COLUMN employee_count INTEGER DEFAULT 0",
  // Feature 6: Pay rate effective date for history tracking
  "ALTER TABLE employees ADD COLUMN pay_rate_effective_date TEXT DEFAULT ''",
  // Feature 20: Check number on pay stubs
  "ALTER TABLE pay_stubs ADD COLUMN check_number TEXT DEFAULT ''",
  // Company fiscal year end + base currency
  "ALTER TABLE companies ADD COLUMN fiscal_year_end TEXT DEFAULT '12'",
  "ALTER TABLE companies ADD COLUMN base_currency TEXT DEFAULT 'USD'",
  // Company bank info for check printing (2026-04-24)
  "ALTER TABLE companies ADD COLUMN bank_name TEXT DEFAULT ''",
  "ALTER TABLE companies ADD COLUMN bank_routing_number TEXT DEFAULT ''",
  "ALTER TABLE companies ADD COLUMN bank_account_number TEXT DEFAULT ''",
  "ALTER TABLE companies ADD COLUMN bank_fraction_code TEXT DEFAULT ''",
  // Admin signature for check printing (base64 data URL)
  "ALTER TABLE companies ADD COLUMN signature_image TEXT DEFAULT ''",
  // Per-tax YTD columns on pay_stubs for check printing (2026-04-24)
  "ALTER TABLE pay_stubs ADD COLUMN ytd_federal_tax REAL DEFAULT 0",
  "ALTER TABLE pay_stubs ADD COLUMN ytd_state_tax REAL DEFAULT 0",
  "ALTER TABLE pay_stubs ADD COLUMN ytd_social_security REAL DEFAULT 0",
  "ALTER TABLE pay_stubs ADD COLUMN ytd_medicare REAL DEFAULT 0",
  // Expense capture features (2026-04-23) — multi-currency, mileage, per-diem, additional receipts, foreign tax, notes
  "ALTER TABLE expenses ADD COLUMN currency TEXT DEFAULT 'USD'",
  "ALTER TABLE expenses ADD COLUMN exchange_rate REAL DEFAULT 1",
  "ALTER TABLE expenses ADD COLUMN tax_inclusive INTEGER DEFAULT 0",
  "ALTER TABLE expenses ADD COLUMN tax_rate REAL DEFAULT 0",
  // Header-level discount on expenses (added after Invoice Wave II — parity
  // with invoices.discount_pct + invoices.discount_amount). Math convention
  // matches invoices: discount is applied AFTER tax (does NOT reduce tax base).
  "ALTER TABLE expenses ADD COLUMN discount_amount REAL DEFAULT 0",
  "ALTER TABLE expenses ADD COLUMN discount_percent REAL DEFAULT 0",
  // Loan Linkage (F1053-F1062) — soft FKs to loans so an expense row
  // (typically the interest portion of a loan payment) can be traced back
  // to which loan it belonged to. Soft FKs (no REFERENCES) keep the columns
  // optional and avoid the cascading-delete complexity.
  "ALTER TABLE expenses ADD COLUMN related_loan_id TEXT",
  "ALTER TABLE expenses ADD COLUMN related_loan_payment_id TEXT",
  // Bidirectional link — loan_payment knows which expense was auto-created
  // for its interest portion. Allows cascade-delete and edit-sync between
  // the loan payment and the expense ledger.
  "ALTER TABLE loan_payments ADD COLUMN related_expense_id TEXT",
  // Second link for the PRINCIPAL-portion expense row. Each loan payment
  // now spawns two linked expense rows: interest (deductible) +
  // principal (non-deductible). Two named columns keep edit-sync
  // unambiguous — interest_amount syncs related_expense_id, principal_amount
  // syncs related_principal_expense_id.
  "ALTER TABLE loan_payments ADD COLUMN related_principal_expense_id TEXT",
  // Tags an expense row with which loan-payment component it represents,
  // so reverse lookups + reports can filter. 'interest' | 'principal' | ''
  "ALTER TABLE expenses ADD COLUMN loan_component TEXT DEFAULT ''",
  // Vendor Advanced Wave — extend vendors with fields exposed by the new
  // 6-tab VendorFormAdvanced. Many existing columns already covered by
  // earlier waves (vendor_type, w9_status, approval_status, diversity,
  // ach_routing, contract dates, performance counters) — these add the
  // missing pieces: multi-contact / multi-address JSON blobs, COI,
  // default GL accounts, credit limit, currency, website, business reg #.
  "ALTER TABLE vendors ADD COLUMN contacts_json TEXT DEFAULT '[]'",
  "ALTER TABLE vendors ADD COLUMN additional_addresses_json TEXT DEFAULT '[]'",
  "ALTER TABLE vendors ADD COLUMN coi_expiry TEXT",
  "ALTER TABLE vendors ADD COLUMN coi_amount REAL",
  "ALTER TABLE vendors ADD COLUMN default_expense_account_id TEXT",
  "ALTER TABLE vendors ADD COLUMN default_ap_account_id TEXT",
  "ALTER TABLE vendors ADD COLUMN credit_limit REAL DEFAULT 0",
  "ALTER TABLE vendors ADD COLUMN currency TEXT DEFAULT 'USD'",
  "ALTER TABLE vendors ADD COLUMN website TEXT",
  "ALTER TABLE vendors ADD COLUMN business_registration_no TEXT",
  "ALTER TABLE vendors ADD COLUMN onboarding_status TEXT DEFAULT 'in_progress'",
  "ALTER TABLE vendors ADD COLUMN preferred_payment_method TEXT",
  "ALTER TABLE expenses ADD COLUMN entry_mode TEXT DEFAULT 'standard'",
  "ALTER TABLE expenses ADD COLUMN odometer_start REAL DEFAULT 0",
  "ALTER TABLE expenses ADD COLUMN odometer_end REAL DEFAULT 0",
  "ALTER TABLE expenses ADD COLUMN miles REAL DEFAULT 0",
  "ALTER TABLE expenses ADD COLUMN mileage_rate REAL DEFAULT 0",
  "ALTER TABLE expenses ADD COLUMN per_diem_location TEXT DEFAULT ''",
  "ALTER TABLE expenses ADD COLUMN per_diem_days REAL DEFAULT 0",
  "ALTER TABLE expenses ADD COLUMN per_diem_rate REAL DEFAULT 0",
  // Fuel-mode columns (#.### precision — SQLite REAL preserves the exact
  // 3-decimal pump readings; cents-rounded total still lives in `amount`).
  "ALTER TABLE expenses ADD COLUMN fuel_gallons REAL DEFAULT 0",
  "ALTER TABLE expenses ADD COLUMN fuel_price_per_gallon REAL DEFAULT 0",
  "ALTER TABLE expenses ADD COLUMN fuel_grade TEXT DEFAULT ''",
  "ALTER TABLE expenses ADD COLUMN fuel_vehicle TEXT DEFAULT ''",
  "ALTER TABLE expenses ADD COLUMN fuel_odometer REAL DEFAULT 0",
  "ALTER TABLE expenses ADD COLUMN fuel_station TEXT DEFAULT ''",
  "ALTER TABLE expenses ADD COLUMN receipts_json TEXT DEFAULT '[]'",
  "ALTER TABLE expenses ADD COLUMN notes TEXT DEFAULT ''",
  // ── Expense categorization, tax & compliance metadata (2026-04-23) ──
  // Categorization
  "ALTER TABLE categories ADD COLUMN monthly_cap REAL DEFAULT 0",
  "ALTER TABLE categories ADD COLUMN default_account_id TEXT DEFAULT ''",
  "ALTER TABLE categories ADD COLUMN required_fields TEXT DEFAULT '[]'",
  "ALTER TABLE expenses ADD COLUMN expense_class TEXT DEFAULT ''",
  // Tax
  "ALTER TABLE expense_line_items ADD COLUMN tax_rate REAL DEFAULT 0",
  // Itemization Wave (F841-F862) — per-line accounting + flags
  "ALTER TABLE expense_line_items ADD COLUMN category_id TEXT",
  "ALTER TABLE expense_line_items ADD COLUMN project_id TEXT",
  "ALTER TABLE expense_line_items ADD COLUMN client_id TEXT",
  "ALTER TABLE expense_line_items ADD COLUMN discount_amount REAL DEFAULT 0",
  "ALTER TABLE expense_line_items ADD COLUMN discount_percent REAL DEFAULT 0",
  "ALTER TABLE expense_line_items ADD COLUMN is_tax_deductible INTEGER DEFAULT 1",
  "ALTER TABLE expense_line_items ADD COLUMN is_tax_exempt INTEGER DEFAULT 0",
  "ALTER TABLE expense_line_items ADD COLUMN notes TEXT",
  "ALTER TABLE expense_line_items ADD COLUMN item_type TEXT DEFAULT 'item'",
  "ALTER TABLE expense_line_items ADD COLUMN tags TEXT DEFAULT '[]'",
  "ALTER TABLE expense_line_items ADD COLUMN tax_amount REAL DEFAULT 0",
  "ALTER TABLE expense_line_items ADD COLUMN tax_jurisdictions TEXT DEFAULT '[]'",
  "ALTER TABLE expenses ADD COLUMN is_tax_deductible INTEGER DEFAULT 1",
  "ALTER TABLE expenses ADD COLUMN schedule_c_line TEXT DEFAULT ''",
  "ALTER TABLE expenses ADD COLUMN foreign_tax_amount REAL DEFAULT 0",
  "ALTER TABLE expenses ADD COLUMN tax_year_override INTEGER DEFAULT 0",
  "ALTER TABLE expenses ADD COLUMN vendor_is_1099 INTEGER DEFAULT 0",
  "ALTER TABLE expenses ADD COLUMN vendor_w9_status TEXT DEFAULT ''",
  // Compliance
  "ALTER TABLE expenses ADD COLUMN lost_receipt_affidavit TEXT DEFAULT ''",
  // ── Expense Approval & Reimbursement Workflow (2026-04-23) ─────────
  "ALTER TABLE expenses ADD COLUMN approval_status TEXT DEFAULT 'draft'",
  "ALTER TABLE expenses ADD COLUMN approver_id TEXT DEFAULT ''",
  "ALTER TABLE expenses ADD COLUMN approval_token TEXT DEFAULT ''",
  "ALTER TABLE expenses ADD COLUMN reimbursement_batch_id TEXT DEFAULT ''",
  "ALTER TABLE expenses ADD COLUMN payroll_run_id TEXT DEFAULT ''",
  "ALTER TABLE expenses ADD COLUMN is_locked INTEGER DEFAULT 0",
  "ALTER TABLE expenses ADD COLUMN policy_override_comment TEXT DEFAULT ''",
  "ALTER TABLE expenses ADD COLUMN submitted_at TEXT DEFAULT ''",
  "ALTER TABLE expenses ADD COLUMN employee_id TEXT DEFAULT ''",
  `CREATE TABLE IF NOT EXISTS expense_approval_steps (
    id TEXT PRIMARY KEY,
    expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL DEFAULT 0,
    approver_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    decided_at TEXT DEFAULT '',
    comment TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_eas_expense ON expense_approval_steps(expense_id)",
  "CREATE INDEX IF NOT EXISTS idx_eas_approver ON expense_approval_steps(approver_id, status)",
  `CREATE TABLE IF NOT EXISTS expense_comments (
    id TEXT PRIMARY KEY,
    expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    user_id TEXT DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_ecmt_expense ON expense_comments(expense_id)",
  `CREATE TABLE IF NOT EXISTS reimbursement_batches (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT NOT NULL DEFAULT '',
    period_start TEXT DEFAULT '',
    period_end TEXT DEFAULT '',
    total_amount REAL DEFAULT 0,
    expense_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'open',
    paid_date TEXT DEFAULT '',
    payroll_run_id TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_reim_batch_company ON reimbursement_batches(company_id, employee_id)",
  `CREATE TABLE IF NOT EXISTS period_locks (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    locked_through_date TEXT NOT NULL DEFAULT '',
    locked_by TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // ── Chart of Accounts enhancements (2026-04-23) ────────
  "ALTER TABLE accounts ADD COLUMN sort_order INTEGER DEFAULT 0",
  "ALTER TABLE accounts ADD COLUMN is_1099_eligible INTEGER DEFAULT 0",
  "ALTER TABLE accounts ADD COLUMN color TEXT DEFAULT ''",
  "ALTER TABLE accounts ADD COLUMN is_pinned INTEGER DEFAULT 0",
  "ALTER TABLE accounts ADD COLUMN is_locked INTEGER DEFAULT 0",
  "ALTER TABLE accounts ADD COLUMN requires_document INTEGER DEFAULT 0",
  "ALTER TABLE accounts ADD COLUMN rename_log TEXT DEFAULT '[]'",
  // ── Journal Entry feature pack (2026-04-23) ────────
  "ALTER TABLE journal_entries ADD COLUMN is_recurring INTEGER DEFAULT 0",
  "ALTER TABLE journal_entries ADD COLUMN recurring_template_id TEXT",
  "ALTER TABLE journal_entries ADD COLUMN is_reversing INTEGER DEFAULT 0",
  "ALTER TABLE journal_entries ADD COLUMN reverse_on_date TEXT",
  "ALTER TABLE journal_entries ADD COLUMN reversed_from_id TEXT",
  "ALTER TABLE journal_entries ADD COLUMN approval_status TEXT DEFAULT 'draft'",
  "ALTER TABLE journal_entries ADD COLUMN class TEXT DEFAULT ''",
  "ALTER TABLE journal_entries ADD COLUMN source_type TEXT DEFAULT ''",
  "ALTER TABLE journal_entries ADD COLUMN source_id TEXT DEFAULT ''",
  "ALTER TABLE journal_entry_lines ADD COLUMN line_memo TEXT DEFAULT ''",
  "ALTER TABLE journal_entry_lines ADD COLUMN sort_order INTEGER DEFAULT 0",
  `CREATE TABLE IF NOT EXISTS je_comments (
    id TEXT PRIMARY KEY,
    journal_entry_id TEXT NOT NULL,
    user_id TEXT DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_je_comments_entry ON je_comments(journal_entry_id)",
  // ── Trial Balance / General Ledger feature pack (2026-04-23) ────────
  "ALTER TABLE journal_entry_lines ADD COLUMN note TEXT DEFAULT ''",
  "ALTER TABLE journal_entries ADD COLUMN is_closing INTEGER DEFAULT 0",
  `CREATE TABLE IF NOT EXISTS tb_working_adjustments (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    debit REAL DEFAULT 0,
    credit REAL DEFAULT 0,
    memo TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_tb_adj_company ON tb_working_adjustments(company_id, period_start, period_end)",
  // ── Period close + Reconciliation + Compliance (2026-04-23) ────────
  `CREATE TABLE IF NOT EXISTS period_close_checklist (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    period_label TEXT NOT NULL DEFAULT '',
    item_label TEXT NOT NULL DEFAULT '',
    item_key TEXT DEFAULT '',
    completed_at TEXT DEFAULT '',
    completed_by TEXT DEFAULT '',
    skipped INTEGER DEFAULT 0,
    note TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_pcc_period ON period_close_checklist(company_id, period_label)",
  `CREATE TABLE IF NOT EXISTS period_close_log (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    period_start TEXT DEFAULT '',
    period_end TEXT DEFAULT '',
    closed_at TEXT DEFAULT '',
    closed_by TEXT DEFAULT '',
    closing_je_id TEXT DEFAULT '',
    net_income REAL DEFAULT 0,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_pcl_company ON period_close_log(company_id)",
  "ALTER TABLE period_locks ADD COLUMN period_start TEXT DEFAULT ''",
  "ALTER TABLE period_locks ADD COLUMN period_end TEXT DEFAULT ''",
  "ALTER TABLE period_locks ADD COLUMN reason TEXT DEFAULT ''",
  "ALTER TABLE period_locks ADD COLUMN unlocked_at TEXT DEFAULT ''",
  "ALTER TABLE period_locks ADD COLUMN unlocked_by TEXT DEFAULT ''",
  "ALTER TABLE period_locks ADD COLUMN unlock_reason TEXT DEFAULT ''",
  `CREATE TABLE IF NOT EXISTS account_reconciliations (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    as_of_date TEXT NOT NULL DEFAULT '',
    sub_ledger_total REAL DEFAULT 0,
    gl_total REAL DEFAULT 0,
    variance REAL DEFAULT 0,
    reconciled_at TEXT DEFAULT '',
    reconciled_by TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    matches TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_recon_acct ON account_reconciliations(company_id, account_id)",
  "ALTER TABLE accounts ADD COLUMN allow_direct_posting INTEGER DEFAULT 1",
  "ALTER TABLE accounts ADD COLUMN tax_line TEXT DEFAULT ''",
  "ALTER TABLE accounts ADD COLUMN attachment_required INTEGER DEFAULT 0",
  "ALTER TABLE accounts ADD COLUMN attachment_threshold REAL DEFAULT 0",
  "ALTER TABLE journal_entries ADD COLUMN approved_by TEXT DEFAULT ''",
  "ALTER TABLE journal_entries ADD COLUMN posted_by TEXT DEFAULT ''",
  // ── GL analytics: per-account monthly cap (2026-04-23) ────────
  "ALTER TABLE accounts ADD COLUMN monthly_cap REAL DEFAULT 0",
  // ── CoA round 2 (2026-04-23) ─────────────────────────────────
  // F1: Account groups
  `CREATE TABLE IF NOT EXISTS account_groups (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    color TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS account_group_members (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES account_groups(id) ON DELETE CASCADE,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(group_id, account_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agm_group ON account_group_members(group_id)`,
  `CREATE INDEX IF NOT EXISTS idx_agm_account ON account_group_members(account_id)`,
  // F2: Account permissions per role
  `CREATE TABLE IF NOT EXISTS account_permissions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT '',
    can_post INTEGER DEFAULT 1,
    can_view INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, account_id, role)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_acct_perm_acct ON account_permissions(account_id, role)`,
  // F3: Account watchlist
  `CREATE TABLE IF NOT EXISTS account_watches (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT '',
    account_id TEXT NOT NULL,
    threshold_amount REAL DEFAULT 0,
    notify_email TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_acct_watch_acct ON account_watches(account_id)`,
  // F4: Account aliases
  `CREATE TABLE IF NOT EXISTS account_aliases (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    alias TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_acct_alias_acct ON account_aliases(account_id)`,
  // F5/22: Multi-currency + sub-ledger + bank linkage + soft delete
  // SCHEMA: accounts.deleted_at is INTENTIONALLY a soft-delete column.
  // Existing journal_entry_lines that reference a soft-deleted account
  // continue to resolve via the live FK (no ON DELETE CASCADE on accounts),
  // which is the correct behaviour for an audit-trail system: GL history
  // must remain queryable even after the chart of accounts changes. List
  // queries hide soft-deleted rows via tablesWithDeletedAt auto-filter.
  "ALTER TABLE accounts ADD COLUMN currency TEXT DEFAULT 'USD'",
  "ALTER TABLE accounts ADD COLUMN bank_account_id TEXT DEFAULT ''",
  "ALTER TABLE accounts ADD COLUMN subledger_type TEXT DEFAULT 'none'",
  "ALTER TABLE accounts ADD COLUMN deleted_at TEXT DEFAULT ''",
  "ALTER TABLE accounts ADD COLUMN compliance_tags TEXT DEFAULT '[]'",
  // F10: Comments
  `CREATE TABLE IF NOT EXISTS account_comments (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    user_id TEXT DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_acct_comments_acct ON account_comments(account_id)`,
  // F24: Auto-categorize rules
  `CREATE TABLE IF NOT EXISTS account_classify_rules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    pattern TEXT NOT NULL DEFAULT '',
    account_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_acr_company ON account_classify_rules(company_id)`,
  // F25: Daily balance history
  `CREATE TABLE IF NOT EXISTS account_balance_history (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL DEFAULT '',
    account_id TEXT NOT NULL,
    balance REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(date, account_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_abh_acct_date ON account_balance_history(account_id, date)`,
  // ── TB/GL round 2 (2026-04-23) ───────────────────────────────
  // TB elimination entries (intercompany)
  `CREATE TABLE IF NOT EXISTS tb_elimination_entries (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL DEFAULT '',
    period_label TEXT NOT NULL DEFAULT '',
    account_id TEXT NOT NULL,
    amount REAL DEFAULT 0,
    memo TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tb_elim_period ON tb_elimination_entries(period_label, account_id)`,
  // GL line-level review/flag/approval columns
  "ALTER TABLE journal_entry_lines ADD COLUMN signed_off_by TEXT DEFAULT ''",
  "ALTER TABLE journal_entry_lines ADD COLUMN signed_off_at TEXT DEFAULT ''",
  "ALTER TABLE journal_entry_lines ADD COLUMN flagged INTEGER DEFAULT 0",
  "ALTER TABLE journal_entry_lines ADD COLUMN flag_reason TEXT DEFAULT ''",
  "ALTER TABLE journal_entry_lines ADD COLUMN question_flag INTEGER DEFAULT 0",
  "ALTER TABLE journal_entry_lines ADD COLUMN approval_step INTEGER DEFAULT 0",
  "ALTER TABLE journal_entry_lines ADD COLUMN is_credit_memo INTEGER DEFAULT 0",
  "ALTER TABLE journal_entry_lines ADD COLUMN is_accountant_adj INTEGER DEFAULT 0",
  "ALTER TABLE journal_entry_lines ADD COLUMN mention TEXT DEFAULT ''",
  // ── JE round 2 (2026-04-23) ───────────────────────────────
  "ALTER TABLE journal_entry_lines ADD COLUMN is_locked INTEGER DEFAULT 0",
  "ALTER TABLE journal_entries ADD COLUMN color TEXT DEFAULT ''",
  "ALTER TABLE journal_entries ADD COLUMN is_starred INTEGER DEFAULT 0",
  "ALTER TABLE journal_entries ADD COLUMN version INTEGER DEFAULT 1",
  `CREATE TABLE IF NOT EXISTS je_history (
    id TEXT PRIMARY KEY,
    je_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    snapshot_json TEXT NOT NULL DEFAULT '{}',
    changed_at TEXT DEFAULT (datetime('now')),
    changed_by TEXT DEFAULT ''
  )`,
  "CREATE INDEX IF NOT EXISTS idx_je_history_je ON je_history(je_id, version)",
  // ── Period Close + Reconciliation + Compliance round 2 (2026-04-23) ────────
  "ALTER TABLE period_locks ADD COLUMN lock_level TEXT DEFAULT 'hard'", // 'soft' | 'hard'
  "ALTER TABLE journal_entries ADD COLUMN adjustment_category TEXT DEFAULT ''",
  "ALTER TABLE journal_entries ADD COLUMN is_inter_period INTEGER DEFAULT 0",
  "ALTER TABLE journal_entries ADD COLUMN inter_period_pair_id TEXT DEFAULT ''",
  "ALTER TABLE period_close_log ADD COLUMN digest_html TEXT DEFAULT ''",
  "ALTER TABLE period_close_log ADD COLUMN roll_forward_done INTEGER DEFAULT 0",
  "ALTER TABLE period_close_log ADD COLUMN is_short_period INTEGER DEFAULT 0",
  "ALTER TABLE period_close_log ADD COLUMN reopened_at TEXT DEFAULT ''",
  "ALTER TABLE period_close_log ADD COLUMN reopened_by TEXT DEFAULT ''",
  "ALTER TABLE audit_log ADD COLUMN prev_hash TEXT DEFAULT ''",
  "ALTER TABLE audit_log ADD COLUMN row_hash TEXT DEFAULT ''",
  `CREATE TABLE IF NOT EXISTS account_reconciliation_items (
    id TEXT PRIMARY KEY,
    recon_id TEXT NOT NULL DEFAULT '',
    company_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    as_of_date TEXT NOT NULL DEFAULT '',
    transaction_id TEXT DEFAULT '',
    transaction_kind TEXT DEFAULT '',
    reference TEXT DEFAULT '',
    amount REAL DEFAULT 0,
    note TEXT DEFAULT '',
    status TEXT DEFAULT 'open',
    confidence INTEGER DEFAULT 0,
    delta REAL DEFAULT 0,
    rolled_from_id TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_recon_items_acct ON account_reconciliation_items(company_id, account_id, as_of_date)",
  `CREATE TABLE IF NOT EXISTS recon_schedule (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    frequency TEXT NOT NULL DEFAULT 'monthly',
    last_run TEXT DEFAULT '',
    next_due TEXT DEFAULT '',
    threshold REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_recon_sched ON recon_schedule(company_id, account_id)",
  `CREATE TABLE IF NOT EXISTS recon_imports (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    as_of_date TEXT DEFAULT '',
    statement_balance REAL DEFAULT 0,
    rows_json TEXT DEFAULT '[]',
    imported_at TEXT DEFAULT (datetime('now')),
    imported_by TEXT DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS sox_controls (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    code TEXT DEFAULT '',
    description TEXT DEFAULT '',
    owner TEXT DEFAULT '',
    frequency TEXT DEFAULT '',
    risk TEXT DEFAULT '',
    last_reviewed_at TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_sox_controls_company ON sox_controls(company_id)",
  `CREATE TABLE IF NOT EXISTS sox_control_tests (
    id TEXT PRIMARY KEY,
    control_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    tested_by TEXT DEFAULT '',
    tested_at TEXT DEFAULT '',
    result TEXT DEFAULT 'na',
    evidence TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_sox_tests_control ON sox_control_tests(control_id)",
  `CREATE TABLE IF NOT EXISTS je_approvals (
    id TEXT PRIMARY KEY,
    journal_entry_id TEXT NOT NULL,
    approver TEXT DEFAULT '',
    approved_at TEXT DEFAULT (datetime('now')),
    comment TEXT DEFAULT ''
  )`,
  "CREATE INDEX IF NOT EXISTS idx_je_approvals_je ON je_approvals(journal_entry_id)",
  // ── Universal Tags + Custom Fields (2026-04-23) ──
  `CREATE TABLE IF NOT EXISTS tag_groups (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#6b7280',
    allow_multiple INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#6b7280',
    group_id TEXT DEFAULT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_tags_company ON tags(company_id)",
  "CREATE INDEX IF NOT EXISTS idx_tags_group ON tags(group_id)",
  `CREATE TABLE IF NOT EXISTS entity_tags (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS uq_entity_tags ON entity_tags(company_id, entity_type, entity_id, tag_id)",
  "CREATE INDEX IF NOT EXISTS idx_entity_tags_lookup ON entity_tags(company_id, entity_type, entity_id)",
  "CREATE INDEX IF NOT EXISTS idx_entity_tags_tag ON entity_tags(tag_id)",
  `CREATE TABLE IF NOT EXISTS tag_rules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    entity_type TEXT NOT NULL,
    when_condition_json TEXT NOT NULL DEFAULT '{}',
    then_apply_tag_id TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS custom_field_definitions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    key TEXT NOT NULL,
    label TEXT NOT NULL,
    field_type TEXT NOT NULL DEFAULT 'text',
    options_json TEXT NOT NULL DEFAULT '{}',
    required INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    group_label TEXT NOT NULL DEFAULT '',
    validation_json TEXT NOT NULL DEFAULT '{}',
    show_on_print INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS uq_cfd_key ON custom_field_definitions(company_id, entity_type, key)",
  `CREATE TABLE IF NOT EXISTS custom_field_values (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    field_key TEXT NOT NULL,
    value_text TEXT DEFAULT NULL,
    value_number REAL DEFAULT NULL,
    value_date TEXT DEFAULT NULL,
    value_json TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS uq_cfv_entity_key ON custom_field_values(company_id, entity_type, entity_id, field_key)",
  "CREATE INDEX IF NOT EXISTS idx_cfv_lookup ON custom_field_values(company_id, entity_type, entity_id)",

  // ─── Workflow + Numbering + Email Templates (2026-04-23) ───
  // Custom statuses (feature 1)
  `CREATE TABLE IF NOT EXISTS custom_statuses (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    key TEXT NOT NULL,
    label TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#6b7280',
    icon TEXT NOT NULL DEFAULT 'Circle',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_terminal INTEGER NOT NULL DEFAULT 0,
    allows_edit INTEGER NOT NULL DEFAULT 1,
    requires_approval INTEGER NOT NULL DEFAULT 0,
    sla_max_days INTEGER DEFAULT NULL,
    notify_users TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS uq_custom_status ON custom_statuses(company_id, entity_type, key)",

  // Status transitions (feature 3)
  `CREATE TABLE IF NOT EXISTS status_transitions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    from_status TEXT NOT NULL,
    to_status TEXT NOT NULL,
    requires_role TEXT DEFAULT '',
    requires_comment INTEGER NOT NULL DEFAULT 0,
    requires_approval INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_status_trans ON status_transitions(company_id, entity_type)",

  // Status history (feature 8)
  `CREATE TABLE IF NOT EXISTS entity_status_history (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    from_status TEXT DEFAULT '',
    to_status TEXT NOT NULL,
    changed_at TEXT NOT NULL DEFAULT (datetime('now')),
    changed_by TEXT DEFAULT '',
    comment TEXT DEFAULT ''
  )`,
  "CREATE INDEX IF NOT EXISTS idx_status_hist ON entity_status_history(company_id, entity_type, entity_id)",

  // Number sequences (features 11–15)
  `CREATE TABLE IF NOT EXISTS number_sequences (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    prefix TEXT NOT NULL DEFAULT '',
    suffix TEXT NOT NULL DEFAULT '',
    padding INTEGER NOT NULL DEFAULT 5,
    current_value INTEGER NOT NULL DEFAULT 0,
    reset_frequency TEXT NOT NULL DEFAULT 'never',
    last_reset_at TEXT DEFAULT NULL,
    reserved_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS uq_number_seq ON number_sequences(company_id, entity_type)",

  // Email templates (feature 21)
  `CREATE TABLE IF NOT EXISTS email_templates (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    key TEXT NOT NULL,
    label TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    body_format TEXT NOT NULL DEFAULT 'markdown',
    available_tokens_json TEXT NOT NULL DEFAULT '[]',
    default_to TEXT DEFAULT '',
    default_cc TEXT DEFAULT '',
    default_bcc TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS uq_email_tmpl ON email_templates(company_id, key)",

  // Email template version history (feature 30)
  `CREATE TABLE IF NOT EXISTS email_template_history (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    snapshot_json TEXT NOT NULL DEFAULT '{}',
    changed_at TEXT NOT NULL DEFAULT (datetime('now')),
    changed_by TEXT DEFAULT ''
  )`,
  "CREATE INDEX IF NOT EXISTS idx_email_tmpl_hist ON email_template_history(template_id)",

  // Email schedules (feature 26)
  `CREATE TABLE IF NOT EXISTS email_schedules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    template_key TEXT NOT NULL,
    trigger_event TEXT NOT NULL DEFAULT '',
    delay_days INTEGER NOT NULL DEFAULT 0,
    condition_json TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_email_sched ON email_schedules(company_id)",
  // ── Per-entity classification systems (2026-04-23) ─────────────
  // Client classification (5)
  "ALTER TABLE clients ADD COLUMN tier TEXT DEFAULT ''",
  "ALTER TABLE clients ADD COLUMN segment TEXT DEFAULT ''",
  "ALTER TABLE clients ADD COLUMN lifecycle_stage TEXT DEFAULT ''",
  "ALTER TABLE clients ADD COLUMN risk_rating TEXT DEFAULT ''",
  // Vendor classification (5)
  "ALTER TABLE vendors ADD COLUMN vendor_type TEXT DEFAULT ''",
  "ALTER TABLE vendors ADD COLUMN approval_status TEXT DEFAULT 'approved'",
  "ALTER TABLE vendors ADD COLUMN form_1099_box TEXT DEFAULT ''",
  "ALTER TABLE vendors ADD COLUMN diversity TEXT DEFAULT '[]'",
  "ALTER TABLE vendors ADD COLUMN location_type TEXT DEFAULT ''",
  // Project classification (5)
  "ALTER TABLE projects ADD COLUMN phase TEXT DEFAULT ''",
  "ALTER TABLE projects ADD COLUMN methodology TEXT DEFAULT ''",
  "ALTER TABLE projects ADD COLUMN project_type TEXT DEFAULT ''",
  "ALTER TABLE projects ADD COLUMN priority TEXT DEFAULT ''",
  "ALTER TABLE projects ADD COLUMN health TEXT DEFAULT ''",
  // Debt classification (5) — debts.priority already exists; add the others
  "ALTER TABLE debts ADD COLUMN risk_category TEXT DEFAULT ''",
  "ALTER TABLE debts ADD COLUMN segment TEXT DEFAULT ''",
  "ALTER TABLE debts ADD COLUMN origination_type TEXT DEFAULT ''",
  "ALTER TABLE debts ADD COLUMN collectability TEXT DEFAULT ''",
  // Employee classification (5) — employees.department already exists
  "ALTER TABLE employees ADD COLUMN role TEXT DEFAULT ''",
  "ALTER TABLE employees ADD COLUMN work_location TEXT DEFAULT ''",
  "ALTER TABLE employees ADD COLUMN cost_class TEXT DEFAULT ''",
  // Asset / Inventory / Account classification
  "ALTER TABLE fixed_assets ADD COLUMN condition TEXT DEFAULT ''",
  "ALTER TABLE inventory_items ADD COLUMN category TEXT DEFAULT ''",
  "ALTER TABLE accounts ADD COLUMN business_purpose TEXT DEFAULT ''",
  "ALTER TABLE accounts ADD COLUMN criticality TEXT DEFAULT ''",
  // Classification settings (admin-tunable colors/thresholds)
  `CREATE TABLE IF NOT EXISTS classification_settings (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    dimension TEXT NOT NULL,
    value TEXT NOT NULL,
    color_override TEXT DEFAULT '',
    label_override TEXT DEFAULT '',
    threshold REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, dimension, value)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_class_settings_co ON classification_settings(company_id, dimension)",
  // Tax System (2026-04-27) — Employee W-4 fields for 2020+ W-4
  "ALTER TABLE employees ADD COLUMN w4_filing_status TEXT DEFAULT 'single'",
  "ALTER TABLE employees ADD COLUMN w4_step2_checkbox INTEGER DEFAULT 0",
  "ALTER TABLE employees ADD COLUMN w4_step3_dependent_credit REAL DEFAULT 0",
  "ALTER TABLE employees ADD COLUMN w4_step4a_other_income REAL DEFAULT 0",
  "ALTER TABLE employees ADD COLUMN w4_step4b_deductions REAL DEFAULT 0",
  "ALTER TABLE employees ADD COLUMN w4_step4c_extra_withholding REAL DEFAULT 0",
  "ALTER TABLE employees ADD COLUMN ut_exemptions INTEGER DEFAULT 1",
  "ALTER TABLE employees ADD COLUMN ut_additional_withholding REAL DEFAULT 0",
  "ALTER TABLE employees ADD COLUMN w4_received_date TEXT DEFAULT ''",
  // Tax System (2026-04-27) — Utah withholding config
  `CREATE TABLE IF NOT EXISTS utah_withholding_config (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    tax_year INTEGER NOT NULL,
    flat_rate REAL NOT NULL DEFAULT 0.0455,
    personal_exemption_credit REAL NOT NULL DEFAULT 393,
    sui_rate REAL NOT NULL DEFAULT 0.012,
    sui_wage_base REAL NOT NULL DEFAULT 44800,
    wc_rate REAL NOT NULL DEFAULT 0.008,
    wc_class_code TEXT DEFAULT '8810',
    wc_carrier TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, tax_year)
  )`,
  // Tax System (2026-04-27) — Tax filing period tracking
  `CREATE TABLE IF NOT EXISTS tax_filing_periods (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    tax_year INTEGER NOT NULL,
    quarter INTEGER NOT NULL,
    form_type TEXT NOT NULL,
    status TEXT DEFAULT 'not_filed',
    filed_date TEXT DEFAULT '',
    confirmation_number TEXT DEFAULT '',
    amount_due REAL DEFAULT 0,
    amount_paid REAL DEFAULT 0,
    payment_date TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, tax_year, quarter, form_type)
  )`,
  // Quote System Enhancements (2026-04-28) — 95 features across pipeline, analytics, follow-up
  "ALTER TABLE quotes ADD COLUMN po_number TEXT DEFAULT ''",
  "ALTER TABLE quotes ADD COLUMN job_reference TEXT DEFAULT ''",
  "ALTER TABLE quotes ADD COLUMN internal_notes TEXT DEFAULT ''",
  "ALTER TABLE quotes ADD COLUMN currency TEXT DEFAULT 'USD'",
  "ALTER TABLE quotes ADD COLUMN exchange_rate REAL DEFAULT 1.0",
  "ALTER TABLE quotes ADD COLUMN sales_rep_id TEXT DEFAULT ''",
  "ALTER TABLE quotes ADD COLUMN deal_size_category TEXT DEFAULT 'standard'",
  "ALTER TABLE quotes ADD COLUMN probability INTEGER DEFAULT 50",
  "ALTER TABLE quotes ADD COLUMN expected_close_date TEXT DEFAULT ''",
  "ALTER TABLE quotes ADD COLUMN lost_reason TEXT DEFAULT ''",
  "ALTER TABLE quotes ADD COLUMN won_date TEXT DEFAULT ''",
  "ALTER TABLE quotes ADD COLUMN sent_date TEXT DEFAULT ''",
  "ALTER TABLE quotes ADD COLUMN viewed_date TEXT DEFAULT ''",
  "ALTER TABLE quotes ADD COLUMN follow_up_date TEXT DEFAULT ''",
  "ALTER TABLE quotes ADD COLUMN tags TEXT DEFAULT '[]'",
  "ALTER TABLE quotes ADD COLUMN shipping_amount REAL DEFAULT 0",
  "ALTER TABLE quotes ADD COLUMN parent_quote_id TEXT DEFAULT NULL",
  "ALTER TABLE quotes ADD COLUMN revision_number INTEGER DEFAULT 1",
  "ALTER TABLE quote_line_items ADD COLUMN row_type TEXT DEFAULT 'item'",
  "ALTER TABLE quote_line_items ADD COLUMN discount_pct REAL DEFAULT 0",
  "ALTER TABLE quote_line_items ADD COLUMN tax_rate_override REAL DEFAULT -1",
  "ALTER TABLE quote_line_items ADD COLUMN unit_label TEXT DEFAULT ''",
  "ALTER TABLE quote_line_items ADD COLUMN item_code TEXT DEFAULT ''",
  `CREATE TABLE IF NOT EXISTS quote_activity_log (
    id TEXT PRIMARY KEY,
    quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    activity_type TEXT NOT NULL DEFAULT '',
    description TEXT DEFAULT '',
    user_name TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS quote_templates (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    description TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    terms TEXT DEFAULT '',
    line_items TEXT DEFAULT '[]',
    default_validity_days INTEGER DEFAULT 30,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_quote_activity_quote ON quote_activity_log(quote_id)",
  "CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(company_id, status)",
  "CREATE INDEX IF NOT EXISTS idx_quotes_client ON quotes(client_id)",
  "CREATE INDEX IF NOT EXISTS idx_quotes_follow_up ON quotes(company_id, follow_up_date)",
  // Advanced System (2026-04-28) — Cognitive Command Layer
  `CREATE TABLE IF NOT EXISTS custom_shortcuts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    key_combo TEXT NOT NULL,
    command_id TEXT NOT NULL,
    params_json TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS macros (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    description TEXT DEFAULT '',
    action_sequence_json TEXT NOT NULL DEFAULT '[]',
    is_shared INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS command_history (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    params_json TEXT DEFAULT '{}',
    executed_at TEXT DEFAULT (datetime('now')),
    result TEXT DEFAULT 'success',
    duration_ms INTEGER DEFAULT 0
  )`,
  // Advanced System (2026-04-28) — Reactive Engine
  `CREATE TABLE IF NOT EXISTS workflow_definitions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    description TEXT DEFAULT '',
    trigger_type TEXT NOT NULL DEFAULT 'event',
    trigger_config_json TEXT NOT NULL DEFAULT '{}',
    conditions_json TEXT NOT NULL DEFAULT '[]',
    actions_json TEXT NOT NULL DEFAULT '[]',
    is_active INTEGER DEFAULT 1,
    version INTEGER DEFAULT 1,
    parent_workflow_id TEXT DEFAULT NULL,
    rate_limit_per_hour INTEGER DEFAULT 0,
    requires_approval INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS workflow_executions (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
    triggered_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    payload_json TEXT DEFAULT '{}',
    result_json TEXT DEFAULT '{}',
    error_message TEXT DEFAULT '',
    duration_ms INTEGER DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS workflow_event_log (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    entity_type TEXT DEFAULT '',
    entity_id TEXT DEFAULT '',
    payload_json TEXT DEFAULT '{}',
    occurred_at TEXT DEFAULT (datetime('now'))
  )`,
  // Advanced System (2026-04-28) — Predictive Intelligence
  `CREATE TABLE IF NOT EXISTS pattern_cache (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    pattern_type TEXT NOT NULL,
    entity_type TEXT DEFAULT '',
    entity_id TEXT DEFAULT '',
    pattern_data_json TEXT NOT NULL DEFAULT '{}',
    confidence REAL DEFAULT 0,
    sample_size INTEGER DEFAULT 0,
    last_computed_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS predictions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    prediction_type TEXT NOT NULL,
    target_entity_type TEXT DEFAULT '',
    target_entity_id TEXT DEFAULT '',
    predicted_value REAL DEFAULT 0,
    confidence REAL DEFAULT 0,
    confidence_low REAL DEFAULT 0,
    confidence_high REAL DEFAULT 0,
    prediction_data_json TEXT DEFAULT '{}',
    computed_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS anomaly_log (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    anomaly_type TEXT NOT NULL,
    severity TEXT DEFAULT 'medium',
    details_json TEXT DEFAULT '{}',
    resolved INTEGER DEFAULT 0,
    resolved_at TEXT,
    resolved_by TEXT DEFAULT '',
    detected_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_command_history_user ON command_history(user_id, executed_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_workflow_event_log_type ON workflow_event_log(company_id, event_type, occurred_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow ON workflow_executions(workflow_id, triggered_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_pattern_cache_lookup ON pattern_cache(company_id, pattern_type, entity_id)",
  "CREATE INDEX IF NOT EXISTS idx_predictions_lookup ON predictions(company_id, prediction_type, target_entity_id)",
  "CREATE INDEX IF NOT EXISTS idx_anomaly_log_unresolved ON anomaly_log(company_id, resolved, detected_at DESC)",
  // Invoice System Enhancements (2026-04-29)
  "ALTER TABLE invoices ADD COLUMN auto_send_reminders INTEGER DEFAULT 0",
  "ALTER TABLE invoices ADD COLUMN payment_link TEXT DEFAULT ''",
  "ALTER TABLE invoices ADD COLUMN portal_viewed_count INTEGER DEFAULT 0",
  "ALTER TABLE invoices ADD COLUMN last_viewed_at TEXT DEFAULT ''",
  "ALTER TABLE invoices ADD COLUMN times_sent INTEGER DEFAULT 0",
  "ALTER TABLE invoices ADD COLUMN tags TEXT DEFAULT '[]'",
  "ALTER TABLE invoices ADD COLUMN priority TEXT DEFAULT 'normal'",
  "ALTER TABLE invoices ADD COLUMN sales_rep_id TEXT DEFAULT ''",
  "ALTER TABLE invoices ADD COLUMN deposit_required REAL DEFAULT 0",
  "ALTER TABLE invoices ADD COLUMN deposit_paid REAL DEFAULT 0",
  `CREATE TABLE IF NOT EXISTS invoice_activity_log (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    activity_type TEXT NOT NULL DEFAULT '',
    description TEXT DEFAULT '',
    user_name TEXT DEFAULT '',
    metadata_json TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_invoice_activity_invoice ON invoice_activity_log(invoice_id, created_at DESC)",
  // Expense System Enhancements (2026-04-29)
  "ALTER TABLE expenses ADD COLUMN merchant_location TEXT DEFAULT ''",
  "ALTER TABLE expenses ADD COLUMN tip_amount REAL DEFAULT 0",
  "ALTER TABLE expenses ADD COLUMN auto_categorized INTEGER DEFAULT 0",
  "ALTER TABLE expenses ADD COLUMN flagged_for_review INTEGER DEFAULT 0",
  "ALTER TABLE expenses ADD COLUMN flag_reason TEXT DEFAULT ''",
  "ALTER TABLE expenses ADD COLUMN expense_owner_id TEXT DEFAULT ''",
  `CREATE TABLE IF NOT EXISTS expense_activity_log (
    id TEXT PRIMARY KEY,
    expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
    activity_type TEXT NOT NULL DEFAULT '',
    description TEXT DEFAULT '',
    user_name TEXT DEFAULT '',
    metadata_json TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_expense_activity_expense ON expense_activity_log(expense_id, created_at DESC)",
  // Bills parity with Invoices (2026-04-29) — rich line items + custom fields
  "ALTER TABLE bills ADD COLUMN po_number TEXT DEFAULT ''",
  "ALTER TABLE bills ADD COLUMN job_reference TEXT DEFAULT ''",
  "ALTER TABLE bills ADD COLUMN internal_notes TEXT DEFAULT ''",
  "ALTER TABLE bills ADD COLUMN late_fee_pct REAL DEFAULT 0",
  "ALTER TABLE bills ADD COLUMN late_fee_grace_days INTEGER DEFAULT 0",
  "ALTER TABLE bills ADD COLUMN discount_pct REAL DEFAULT 0",
  "ALTER TABLE bills ADD COLUMN bill_type TEXT DEFAULT 'standard'",
  "ALTER TABLE bills ADD COLUMN currency TEXT DEFAULT 'USD'",
  "ALTER TABLE bills ADD COLUMN exchange_rate REAL DEFAULT 1.0",
  "ALTER TABLE bills ADD COLUMN terms_text TEXT DEFAULT ''",
  "ALTER TABLE bills ADD COLUMN terms TEXT DEFAULT ''",
  "ALTER TABLE bills ADD COLUMN shipping_amount REAL DEFAULT 0",
  "ALTER TABLE bills ADD COLUMN custom_field_1 TEXT DEFAULT ''",
  "ALTER TABLE bills ADD COLUMN custom_field_2 TEXT DEFAULT ''",
  "ALTER TABLE bills ADD COLUMN custom_field_3 TEXT DEFAULT ''",
  "ALTER TABLE bills ADD COLUMN custom_field_4 TEXT DEFAULT ''",
  "ALTER TABLE bill_line_items ADD COLUMN row_type TEXT DEFAULT 'item'",
  "ALTER TABLE bill_line_items ADD COLUMN unit_label TEXT DEFAULT ''",
  "ALTER TABLE bill_line_items ADD COLUMN item_code TEXT DEFAULT ''",
  "ALTER TABLE bill_line_items ADD COLUMN line_discount REAL DEFAULT 0",
  "ALTER TABLE bill_line_items ADD COLUMN line_discount_type TEXT DEFAULT 'percent'",
  "ALTER TABLE bill_line_items ADD COLUMN discount_pct REAL DEFAULT 0",
  "ALTER TABLE bill_line_items ADD COLUMN tax_rate_override REAL DEFAULT -1",
  "ALTER TABLE bill_line_items ADD COLUMN tax_amount REAL DEFAULT 0",
  "ALTER TABLE bill_line_items ADD COLUMN bold INTEGER DEFAULT 0",
  "ALTER TABLE bill_line_items ADD COLUMN italic INTEGER DEFAULT 0",
  "ALTER TABLE bill_line_items ADD COLUMN highlight_color TEXT DEFAULT ''",
  "ALTER TABLE bill_line_items ADD COLUMN sort_order INTEGER DEFAULT 0",
  "ALTER TABLE bill_line_items ADD COLUMN project_id TEXT DEFAULT NULL",
  // P1.4 — Custom letterhead image (2026-05-05)
  // letterhead_data: base64-encoded PNG/JPEG (full-width banner) — stored
  // inline so the image travels with backups and renders without external
  // assets. Capped at ~2MB after compression in the upload UI.
  // letterhead_position: 'top' renders above the header, 'replace' uses
  // the image AS the header (no co-name text). 'bottom' for footer-style.
  // letterhead_height: pixel height when rendered (defaults to 90px).
  "ALTER TABLE invoice_settings ADD COLUMN letterhead_data TEXT DEFAULT NULL",
  "ALTER TABLE invoice_settings ADD COLUMN letterhead_position TEXT DEFAULT 'top'",
  "ALTER TABLE invoice_settings ADD COLUMN letterhead_height INTEGER DEFAULT 90",

  // ── P1.18: Schema-version pinning ─────────────────────────────
  // Records the highest schema version the DB has been exposed to.
  // On startup, if the DB's stored version is HIGHER than this app
  // build's max known version, we refuse to open it — preventing a
  // user who just downgraded the app from corrupting newer data
  // (e.g. dropping a column they didn't know about).
  // Single-row table; APP_SCHEMA_VERSION is bumped each time we add
  // a column or table. The migrations array runs idempotently
  // regardless of version, so this is purely a safety guard for
  // backwards-incompatible changes.
  `CREATE TABLE IF NOT EXISTS schema_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL DEFAULT 1,
    last_migrated_at TEXT NOT NULL DEFAULT (datetime('now')),
    app_version TEXT DEFAULT ''
  )`,
  `INSERT OR IGNORE INTO schema_meta (id, version) VALUES (1, 1)`,

  // ── P2.20: Composite indices for common filter+sort patterns ────
  // The list views all filter by company_id and sort by date (or
  // status). Without composite indices, SQLite scans the table
  // and re-sorts in memory — fine at 1k rows, painful at 50k+.
  // These cover the hottest list-view queries.
  "CREATE INDEX IF NOT EXISTS idx_invoices_co_status_date ON invoices(company_id, status, due_date)",
  "CREATE INDEX IF NOT EXISTS idx_invoices_co_client_date ON invoices(company_id, client_id, issue_date)",
  "CREATE INDEX IF NOT EXISTS idx_bills_co_status_date ON bills(company_id, status, due_date)",
  "CREATE INDEX IF NOT EXISTS idx_bills_co_vendor_date ON bills(company_id, vendor_id, issue_date)",
  "CREATE INDEX IF NOT EXISTS idx_expenses_co_date ON expenses(company_id, date)",
  "CREATE INDEX IF NOT EXISTS idx_expenses_co_vendor_date ON expenses(company_id, vendor_id, date)",
  "CREATE INDEX IF NOT EXISTS idx_journal_entries_co_date ON journal_entries(company_id, date)",
  "CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id, timestamp DESC)",
  "CREATE INDEX IF NOT EXISTS idx_payments_invoice ON invoice_payments(invoice_id, payment_date)",
  "CREATE INDEX IF NOT EXISTS idx_clients_co_name ON clients(company_id, name)",
  "CREATE INDEX IF NOT EXISTS idx_vendors_co_name ON vendors(company_id, name)",

  // ── LOAN TRACKING SYSTEM (4 tables) ───────────────────────────
  //
  // Source of truth for any debt the company carries: mortgages,
  // auto loans, business loans, lines of credit, equipment financing.
  // Decoupled from the GL — postings to interest-expense / loan-
  // payable accounts happen via the existing JE system; this module
  // owns the amortization math + payment lifecycle.
  //
  // Design decisions:
  //   • Amortization schedule is PRE-COMPUTED on save (or recalc),
  //     not derived on-the-fly. Stored rows = single source of truth
  //     and supports rate changes (rebuild from change date forward).
  //   • Actual payments are separate from scheduled payments; they
  //     reference scheduled rows but can be partial / over /
  //     ahead-of-schedule. The current_balance is computed from
  //     actuals, never from schedule alone.
  //   • Loan events table is append-only audit (rate change,
  //     refinance, extension, lump-sum payment).
  //   • All amounts in the loan's currency (defaults USD).
  `CREATE TABLE IF NOT EXISTS loans (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,                              -- "BMO Mortgage 2024", "SBA Loan #12345"
    loan_type TEXT NOT NULL DEFAULT 'term_loan',     -- mortgage | auto | business | personal | line_of_credit | equipment | sba | other
    lender_name TEXT DEFAULT '',
    lender_contact TEXT DEFAULT '',
    account_number TEXT DEFAULT '',                  -- last4 only — full # in encrypted notes
    principal REAL NOT NULL,                         -- original loan amount
    interest_rate REAL NOT NULL,                     -- annual rate as decimal: 0.065 = 6.5%
    rate_type TEXT NOT NULL DEFAULT 'fixed',         -- fixed | variable | arm
    term_months INTEGER NOT NULL,                    -- 360 for 30-yr mortgage
    payment_frequency TEXT NOT NULL DEFAULT 'monthly', -- monthly | biweekly | weekly | quarterly | annual
    amortization_type TEXT NOT NULL DEFAULT 'standard', -- standard | interest_only | balloon | custom
    balloon_amount REAL DEFAULT 0,                   -- final balloon payment if applicable
    origination_date TEXT NOT NULL,                  -- YYYY-MM-DD when loan was originated
    first_payment_date TEXT NOT NULL,                -- YYYY-MM-DD of first scheduled payment
    payment_amount REAL DEFAULT 0,                   -- computed monthly payment (escrow excluded)
    escrow_per_payment REAL DEFAULT 0,               -- property tax + insurance per payment
    current_balance REAL DEFAULT 0,                  -- maintained as payments are recorded
    total_paid_to_date REAL DEFAULT 0,
    total_interest_paid REAL DEFAULT 0,
    total_principal_paid REAL DEFAULT 0,
    next_payment_due TEXT DEFAULT NULL,              -- denormalized: next unpaid scheduled date
    status TEXT NOT NULL DEFAULT 'active',           -- active | paid_off | refinanced | defaulted | closed
    currency TEXT NOT NULL DEFAULT 'USD',
    -- GL integration: which accounts to post to. nullable so module
    -- works standalone; bookkeeping users can wire later.
    liability_account_id TEXT DEFAULT NULL,          -- credit on origination, debit on principal payment
    interest_expense_account_id TEXT DEFAULT NULL,   -- debit on interest portion of each payment
    payment_source_account_id TEXT DEFAULT NULL,     -- bank account payments come FROM
    notes TEXT DEFAULT '',
    custom_fields TEXT DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT DEFAULT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_loans_co_status ON loans(company_id, status) WHERE deleted_at IS NULL",
  "CREATE INDEX IF NOT EXISTS idx_loans_next_due ON loans(company_id, next_payment_due) WHERE deleted_at IS NULL AND status = 'active'",

  // Pre-computed amortization rows. One row per scheduled payment.
  // Recreated when the loan's term/rate/principal changes.
  `CREATE TABLE IF NOT EXISTS loan_payment_schedule (
    id TEXT PRIMARY KEY,
    loan_id TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
    payment_number INTEGER NOT NULL,                 -- 1, 2, 3, ... term_months
    due_date TEXT NOT NULL,                          -- YYYY-MM-DD
    scheduled_payment REAL NOT NULL,                 -- principal + interest (excludes escrow)
    principal_amount REAL NOT NULL,
    interest_amount REAL NOT NULL,
    escrow_amount REAL DEFAULT 0,
    remaining_balance REAL NOT NULL,                 -- after this payment
    paid_status TEXT NOT NULL DEFAULT 'pending',     -- pending | paid | partial | skipped
    paid_amount REAL DEFAULT 0,                      -- summed from loan_payments matched to this row
    paid_date TEXT DEFAULT NULL,                     -- when fully paid
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_loan_sched_loan_due ON loan_payment_schedule(loan_id, due_date)",
  "CREATE INDEX IF NOT EXISTS idx_loan_sched_pending ON loan_payment_schedule(loan_id, paid_status) WHERE paid_status != 'paid'",

  // Actual payments made — can be partial, over, or extra-principal.
  // Linked to a scheduled row for normal payments, NULL for one-off
  // principal-only payments.
  `CREATE TABLE IF NOT EXISTS loan_payments (
    id TEXT PRIMARY KEY,
    loan_id TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
    schedule_id TEXT REFERENCES loan_payment_schedule(id) ON DELETE SET NULL,
    payment_date TEXT NOT NULL,                      -- YYYY-MM-DD
    amount REAL NOT NULL,                            -- total paid this transaction
    principal_amount REAL NOT NULL DEFAULT 0,        -- portion applied to principal
    interest_amount REAL NOT NULL DEFAULT 0,         -- portion applied to interest
    escrow_amount REAL DEFAULT 0,
    fees REAL DEFAULT 0,                             -- late fee, NSF, etc.
    payment_method TEXT DEFAULT 'ach',               -- ach | check | wire | cash | card
    reference TEXT DEFAULT '',                       -- check #, confirmation #
    is_extra_principal INTEGER NOT NULL DEFAULT 0,   -- one-off bonus principal payment
    bank_transaction_id TEXT DEFAULT NULL,           -- linked imported bank line
    journal_entry_id TEXT DEFAULT NULL,              -- linked GL posting
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_loan_payments_loan_date ON loan_payments(loan_id, payment_date DESC)",

  // Append-only audit / event log. Rate changes, refinances,
  // extensions, lump payoffs — anything that changes the loan's
  // terms.
  `CREATE TABLE IF NOT EXISTS loan_events (
    id TEXT PRIMARY KEY,
    loan_id TEXT NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,                        -- rate_change | refinance | extension | partial_payoff | full_payoff | note
    event_date TEXT NOT NULL,
    description TEXT DEFAULT '',
    -- Snapshot of changed values
    old_value TEXT DEFAULT '',
    new_value TEXT DEFAULT '',
    metadata_json TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_loan_events_loan ON loan_events(loan_id, event_date DESC)",

  // ── D3: Period Close + Lockdown ───────────────────────────────
  //
  // Records each closed accounting period. Once a period is closed,
  // any record dated within that period (invoices, bills, expenses,
  // journal entries, payments) becomes immutable — IPC handlers
  // check the closed_periods table before allowing INSERT / UPDATE
  // / DELETE on rows whose date falls in a closed range.
  //
  // Reopening a closed period requires a reason and writes an audit
  // entry — auditors love seeing this trail.
  //
  // Currently scoped per-company; future: per-fiscal-year so a Q1
  // close doesn't reopen when Q2 closes.
  `CREATE TABLE IF NOT EXISTS closed_periods (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    period_start TEXT NOT NULL,           -- YYYY-MM-DD inclusive
    period_end TEXT NOT NULL,             -- YYYY-MM-DD inclusive
    closed_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_by TEXT DEFAULT '',
    close_reason TEXT DEFAULT '',         -- "Year-end close 2025"
    reopened_at TEXT DEFAULT NULL,        -- nullable; non-null = was reopened
    reopened_by TEXT DEFAULT '',
    reopen_reason TEXT DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1, -- 0 = currently reopened
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_closed_periods_co_active ON closed_periods(company_id, is_active) WHERE is_active = 1",

  // ── A7: Line-item snippets / field templates ─────────────────
  // Reusable line-item presets users can drop onto invoices/quotes
  // /bills with one click. Saves "Standard hourly consulting" once,
  // reuses on every project.
  `CREATE TABLE IF NOT EXISTS line_item_snippets (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    quantity REAL NOT NULL DEFAULT 1,
    unit_label TEXT DEFAULT '',
    unit_price REAL NOT NULL DEFAULT 0,
    tax_rate REAL DEFAULT 0,
    item_code TEXT DEFAULT '',
    use_count INTEGER NOT NULL DEFAULT 0,
    last_used_at TEXT DEFAULT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_line_snippets_co_use ON line_item_snippets(company_id, use_count DESC)",

  // ── P4.49: Mileage log ────────────────────────────────────────
  // Records vehicle business miles for tax-deduction purposes.
  // The auto-computed `deduction_amount` uses the IRS-published
  // standard mileage rate for the trip's tax year, looked up from
  // the mileage_rates table (seeded with current+historical rates).
  `CREATE TABLE IF NOT EXISTS mileage_log (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    trip_date TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT '',
    start_location TEXT DEFAULT '',
    end_location TEXT DEFAULT '',
    miles REAL NOT NULL DEFAULT 0,
    rate_per_mile REAL NOT NULL DEFAULT 0,
    deduction_amount REAL NOT NULL DEFAULT 0,
    vehicle TEXT DEFAULT '',
    project_id TEXT DEFAULT NULL,
    client_id TEXT DEFAULT NULL,
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_mileage_co_date ON mileage_log(company_id, trip_date DESC)",

  // IRS standard mileage rates by year. Seeded at startup if empty.
  // Rates source: https://www.irs.gov/tax-professionals/standard-mileage-rates
  `CREATE TABLE IF NOT EXISTS mileage_rates (
    year INTEGER PRIMARY KEY,
    business_rate REAL NOT NULL,
    medical_rate REAL DEFAULT 0,
    charitable_rate REAL DEFAULT 0
  )`,

  // ── P6.70: Outbound webhook subscriptions ─────────────────────
  // Each row is a "fire HTTP POST when event_type happens for this
  // company" rule. event_type='*' matches all events.
  // secret is used for HMAC-SHA256 signing in X-BAP-Signature.
  `CREATE TABLE IF NOT EXISTS webhook_subscriptions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    target_url TEXT NOT NULL,
    secret TEXT DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    last_fired_at TEXT DEFAULT NULL,
    last_status TEXT DEFAULT '',
    retries INTEGER NOT NULL DEFAULT 0,
    description TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_webhook_subs_co_event ON webhook_subscriptions(company_id, event_type) WHERE enabled = 1",
  // Client Portal API integration (rmpgutahps.us, 2026-05-05)
  // portal_integration_settings: per-company config for the external
  // client-portal integration. The api_key column stores a base64
  // ciphertext produced by Electron's safeStorage (OS keychain backed).
  // We never write the plaintext key to disk — even DB backups expose
  // only the ciphertext, which is undecryptable without the OS keychain.
  // last_sync_at / last_test_at help the UI show health indicators.
  `CREATE TABLE IF NOT EXISTS portal_integration_settings (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL UNIQUE,
    portal_base_url TEXT NOT NULL DEFAULT 'https://rmpgutahps.us/client/login',
    api_key_encrypted TEXT DEFAULT NULL,
    api_endpoint TEXT NOT NULL DEFAULT 'https://rmpgutahps.us/api/v1',
    auth_scheme TEXT NOT NULL DEFAULT 'bearer',
    auto_sync_invoices INTEGER NOT NULL DEFAULT 0,
    last_sync_at TEXT DEFAULT NULL,
    last_sync_status TEXT DEFAULT NULL,
    last_test_at TEXT DEFAULT NULL,
    last_test_status TEXT DEFAULT NULL,
    last_test_message TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Health-check path is appended to api_endpoint for the test
  // connection. Empty string = ping the base URL itself. Common
  // Laravel/Express patterns: /health, /status, /api/v1/health.
  // ALTER added separately so existing rows pick up the default.
  "ALTER TABLE portal_integration_settings ADD COLUMN health_check_path TEXT DEFAULT '/health'",

  // ── P1.13: Soft-delete columns (2026-05-05) ───────────────────
  // Records with deleted_at IS NOT NULL are hidden from list/get
  // queries but remain physically present until the auto-purge cron
  // physically removes them after 30 days. Users can restore from
  // Settings → Trash within that window. Currently scoped to the
  // four most-deleted entities — clients/vendors deliberately
  // excluded because their FK references would orphan invoices/bills.
  "ALTER TABLE invoices ADD COLUMN deleted_at TEXT DEFAULT NULL",
  "ALTER TABLE bills ADD COLUMN deleted_at TEXT DEFAULT NULL",
  "ALTER TABLE expenses ADD COLUMN deleted_at TEXT DEFAULT NULL",
  "ALTER TABLE journal_entries ADD COLUMN deleted_at TEXT DEFAULT NULL",
  // Indexes — soft-deleted rows are a SMALL minority, so a partial
  // index keyed on deleted_at IS NULL gives effectively-free
  // filtering for the common case.
  "CREATE INDEX IF NOT EXISTS idx_invoices_not_deleted ON invoices(company_id) WHERE deleted_at IS NULL",
  "CREATE INDEX IF NOT EXISTS idx_bills_not_deleted ON bills(company_id) WHERE deleted_at IS NULL",
  "CREATE INDEX IF NOT EXISTS idx_expenses_not_deleted ON expenses(company_id) WHERE deleted_at IS NULL",
  "CREATE INDEX IF NOT EXISTS idx_journal_entries_not_deleted ON journal_entries(company_id) WHERE deleted_at IS NULL",

  // ── P1.11: Double-entry balance enforcement (DB triggers) ──────
  //
  // Belt + suspenders: the JS layer already validates balance, but
  // these triggers prevent corrupted data from EVER reaching the
  // tables — even if a bug, an interrupted transaction, or a
  // direct-SQL operator tries to insert unbalanced lines on a
  // POSTED journal entry. Drafts (is_posted=0) remain editable
  // mid-flow; the check only enforces when the entry is finalized.
  //
  // Tolerance: $0.005 to absorb floating-point rounding from REAL
  // arithmetic (better-sqlite3 stores debit/credit as REAL).
  //
  // Why three triggers on journal_entry_lines (INSERT/UPDATE/DELETE):
  // SQLite triggers fire per-row per-statement. A multi-line journal
  // can be inserted line-by-line; we want the *final* state of the
  // parent entry to balance. Each operation re-checks the parent's
  // total. If the parent is still a draft (is_posted=0), the WHEN
  // clause skips the trigger — line-level edits on drafts are free.
  //
  // Why one trigger on journal_entries: when a user flips is_posted
  // from 0→1, we must validate that the entry balances at THAT
  // moment. Without this, a user could insert unbalanced lines
  // while the entry is a draft, then flip is_posted=1 in a single
  // UPDATE — bypassing the line-level triggers.
  `DROP TRIGGER IF EXISTS trg_je_lines_balanced_after_insert`,
  `CREATE TRIGGER trg_je_lines_balanced_after_insert
   AFTER INSERT ON journal_entry_lines
   WHEN (SELECT is_posted FROM journal_entries WHERE id = NEW.journal_entry_id) = 1
   BEGIN
     SELECT CASE
       WHEN ABS(
         (SELECT COALESCE(SUM(debit), 0) FROM journal_entry_lines WHERE journal_entry_id = NEW.journal_entry_id)
         - (SELECT COALESCE(SUM(credit), 0) FROM journal_entry_lines WHERE journal_entry_id = NEW.journal_entry_id)
       ) > 0.005
       THEN RAISE(ABORT, 'Posted journal entry must balance: total debits must equal total credits')
     END;
   END`,
  `DROP TRIGGER IF EXISTS trg_je_lines_balanced_after_update`,
  `CREATE TRIGGER trg_je_lines_balanced_after_update
   AFTER UPDATE ON journal_entry_lines
   WHEN (SELECT is_posted FROM journal_entries WHERE id = NEW.journal_entry_id) = 1
   BEGIN
     SELECT CASE
       WHEN ABS(
         (SELECT COALESCE(SUM(debit), 0) FROM journal_entry_lines WHERE journal_entry_id = NEW.journal_entry_id)
         - (SELECT COALESCE(SUM(credit), 0) FROM journal_entry_lines WHERE journal_entry_id = NEW.journal_entry_id)
       ) > 0.005
       THEN RAISE(ABORT, 'Posted journal entry must balance: total debits must equal total credits')
     END;
   END`,
  `DROP TRIGGER IF EXISTS trg_je_lines_balanced_after_delete`,
  `CREATE TRIGGER trg_je_lines_balanced_after_delete
   AFTER DELETE ON journal_entry_lines
   WHEN (SELECT is_posted FROM journal_entries WHERE id = OLD.journal_entry_id) = 1
   BEGIN
     SELECT CASE
       WHEN ABS(
         (SELECT COALESCE(SUM(debit), 0) FROM journal_entry_lines WHERE journal_entry_id = OLD.journal_entry_id)
         - (SELECT COALESCE(SUM(credit), 0) FROM journal_entry_lines WHERE journal_entry_id = OLD.journal_entry_id)
       ) > 0.005
       THEN RAISE(ABORT, 'Posted journal entry must balance: cannot delete a line that would unbalance the entry')
     END;
   END`,
  // Trigger on journal_entries: when is_posted flips 0 → 1, validate
  // that the entry balances at that moment. Catches the case where
  // unbalanced draft lines were inserted under is_posted=0 and then
  // the user attempts to post the entry in a single UPDATE.
  // Also covers re-posting (1→1 update where lines may have changed
  // between is_posted-related transactions).
  `DROP TRIGGER IF EXISTS trg_je_balanced_on_post`,
  `CREATE TRIGGER trg_je_balanced_on_post
   AFTER UPDATE OF is_posted ON journal_entries
   WHEN NEW.is_posted = 1
   BEGIN
     SELECT CASE
       WHEN ABS(
         (SELECT COALESCE(SUM(debit), 0) FROM journal_entry_lines WHERE journal_entry_id = NEW.id)
         - (SELECT COALESCE(SUM(credit), 0) FROM journal_entry_lines WHERE journal_entry_id = NEW.id)
       ) > 0.005
       THEN RAISE(ABORT, 'Cannot post journal entry: total debits must equal total credits')
     END;
   END`,
  // ─── Wave 4: Compliance documents (W-4 / W-9 / I-9) ─────────
  // Stores forms RECEIVED from employees/vendors (paradigm-flip from
  // forms ISSUED by the business). Tracks expiration for W-9 annual
  // re-verification and I-9 retention rules.
  `CREATE TABLE IF NOT EXISTS compliance_documents (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    person_type TEXT NOT NULL CHECK(person_type IN ('employee','vendor','client')),
    person_id TEXT NOT NULL,
    form_type TEXT NOT NULL CHECK(form_type IN ('W-4','W-9','I-9','W-8BEN','W-8BEN-E','state-W-4')),
    document_id TEXT REFERENCES documents(id),
    document_filename TEXT DEFAULT '',
    effective_date TEXT,
    expires_at TEXT,
    section_1_complete INTEGER DEFAULT 0,
    section_2_complete INTEGER DEFAULT 0,
    section_3_complete INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'current' CHECK(status IN ('current','expired','pending','rejected','superseded')),
    notes TEXT DEFAULT '',
    metadata TEXT DEFAULT '{}',
    uploaded_at TEXT DEFAULT (datetime('now')),
    uploaded_by TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_compliance_docs_company ON compliance_documents(company_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_compliance_docs_person ON compliance_documents(person_type, person_id, form_type)`,
  `CREATE INDEX IF NOT EXISTS idx_compliance_docs_expires ON compliance_documents(expires_at, status)`,
  // Employee equipment (2026-05-21)
  `CREATE TABLE IF NOT EXISTS employee_equipment (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    item_name TEXT NOT NULL DEFAULT '',
    description TEXT DEFAULT '',
    serial_number TEXT DEFAULT '',
    model TEXT DEFAULT '',
    condition TEXT DEFAULT 'good' CHECK(condition IN ('new','excellent','good','fair','poor')),
    assigned_date TEXT DEFAULT (date('now')),
    return_date TEXT DEFAULT NULL,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_employee_equipment_employee ON employee_equipment(employee_id)`,
  // E-Sign documents (2026-05-21)
  `CREATE TABLE IF NOT EXISTS esign_documents (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    title TEXT NOT NULL DEFAULT '',
    description TEXT DEFAULT '',
    content TEXT DEFAULT '',
    content_hash TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending','signed','revoked')),
    created_by TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS esign_signatures (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES esign_documents(id) ON DELETE CASCADE,
    signer_type TEXT NOT NULL CHECK(signer_type IN ('admin','employee','user')),
    signer_id TEXT NOT NULL DEFAULT '',
    signer_name TEXT NOT NULL DEFAULT '',
    typed_name TEXT NOT NULL DEFAULT '',
    signature_hash TEXT NOT NULL DEFAULT '',
    signed_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS esign_permissions (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES esign_documents(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL DEFAULT '',
    permission_level TEXT NOT NULL DEFAULT 'view' CHECK(permission_level IN ('view','edit','sign','admin')),
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS esign_audit_log (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES esign_documents(id) ON DELETE CASCADE,
    action TEXT NOT NULL DEFAULT '',
    performed_by TEXT NOT NULL DEFAULT '',
    previous_hash TEXT DEFAULT '',
    new_hash TEXT DEFAULT '',
    details TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_esign_docs_company ON esign_documents(company_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_esign_signatures_doc ON esign_signatures(document_id)`,
  `CREATE INDEX IF NOT EXISTS idx_esign_permissions_doc ON esign_permissions(document_id)`,
  `CREATE INDEX IF NOT EXISTS idx_esign_audit_doc ON esign_audit_log(document_id)`,
  `CREATE INDEX IF NOT EXISTS idx_esign_audit_created ON esign_audit_log(created_at)`,
  // Soft-delete column additions for tables missing deleted_at (2026-05-21)
  "ALTER TABLE employees ADD COLUMN deleted_at TEXT DEFAULT NULL",
  "ALTER TABLE clients ADD COLUMN deleted_at TEXT DEFAULT NULL",
  "ALTER TABLE vendors ADD COLUMN deleted_at TEXT DEFAULT NULL",
  "ALTER TABLE projects ADD COLUMN deleted_at TEXT DEFAULT NULL",
  "ALTER TABLE quotes ADD COLUMN deleted_at TEXT DEFAULT NULL",
  "ALTER TABLE loans ADD COLUMN deleted_at TEXT DEFAULT NULL",
  "ALTER TABLE tags ADD COLUMN deleted_at TEXT DEFAULT NULL",
  "ALTER TABLE custom_field_definitions ADD COLUMN deleted_at TEXT DEFAULT NULL",
  "ALTER TABLE inventory_items ADD COLUMN deleted_at TEXT DEFAULT NULL",

  // ─── Batch 1: 15 admin/settings features ────────────────────

  // F1-F3: Custom fields system (clients, vendors, invoices)
  `CREATE TABLE IF NOT EXISTS custom_field_definitions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    entity_type TEXT NOT NULL CHECK(entity_type IN ('client','vendor','invoice','expense','employee','project')),
    field_key TEXT NOT NULL,
    field_label TEXT NOT NULL,
    field_type TEXT NOT NULL CHECK(field_type IN ('text','number','date','boolean','select','multiselect')),
    options_json TEXT DEFAULT '[]',
    required INTEGER DEFAULT 0,
    display_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, entity_type, field_key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_custom_fields_company_entity ON custom_field_definitions(company_id, entity_type, is_active)`,

  // F4: Role permissions matrix (extends users table)
  "ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'admin'",
  "ALTER TABLE users ADD COLUMN permissions_json TEXT DEFAULT '{}'",
  `CREATE TABLE IF NOT EXISTS user_role_templates (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    role_name TEXT NOT NULL,
    permissions_json TEXT NOT NULL DEFAULT '{}',
    is_system INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,

  // F5: 2FA TOTP setup
  "ALTER TABLE users ADD COLUMN totp_secret TEXT DEFAULT NULL",
  "ALTER TABLE users ADD COLUMN totp_enabled INTEGER DEFAULT 0",
  "ALTER TABLE users ADD COLUMN totp_backup_codes TEXT DEFAULT '[]'",

  // F6: Session timeout config (per company)
  "ALTER TABLE companies ADD COLUMN session_timeout_minutes INTEGER DEFAULT 480",

  // F7: Auto-backup schedule customization
  "ALTER TABLE companies ADD COLUMN backup_schedule TEXT DEFAULT 'on_change'",
  "ALTER TABLE companies ADD COLUMN backup_retain_count INTEGER DEFAULT 30",

  // F8: Theme customization (per user)
  "ALTER TABLE users ADD COLUMN theme_accent_color TEXT DEFAULT '#2563eb'",
  "ALTER TABLE users ADD COLUMN theme_font_size TEXT DEFAULT 'medium'",
  "ALTER TABLE users ADD COLUMN theme_density TEXT DEFAULT 'comfortable'",
  "ALTER TABLE users ADD COLUMN theme_mode TEXT DEFAULT 'dark'",

  // F9: Multi-fiscal-year support
  "ALTER TABLE companies ADD COLUMN fiscal_year_start_month INTEGER DEFAULT 1",
  "ALTER TABLE companies ADD COLUMN fiscal_year_start_day INTEGER DEFAULT 1",

  // F10-F11: Activity feed + audit log viewer
  // (audit_log table already exists — adding indices for the viewer)
  "CREATE INDEX IF NOT EXISTS idx_audit_log_company_ts ON audit_log(company_id, timestamp DESC)",
  "CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id, timestamp DESC)",
  "CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(performed_by, timestamp DESC)",

  // F12: Notification preferences per user
  `CREATE TABLE IF NOT EXISTS notification_preferences (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    notification_type TEXT NOT NULL,
    channel_email INTEGER DEFAULT 1,
    channel_in_app INTEGER DEFAULT 1,
    channel_desktop INTEGER DEFAULT 0,
    quiet_hours_start TEXT DEFAULT NULL,
    quiet_hours_end TEXT DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, company_id, notification_type)
  )`,

  // F13: Currency settings (functional + reporting + display)
  "ALTER TABLE companies ADD COLUMN functional_currency TEXT DEFAULT 'USD'",
  "ALTER TABLE companies ADD COLUMN reporting_currency TEXT DEFAULT 'USD'",
  "ALTER TABLE companies ADD COLUMN currency_display_format TEXT DEFAULT 'symbol_prefix'",

  // F14: Password complexity policy
  "ALTER TABLE companies ADD COLUMN password_min_length INTEGER DEFAULT 12",
  "ALTER TABLE companies ADD COLUMN password_require_special INTEGER DEFAULT 1",
  "ALTER TABLE companies ADD COLUMN password_require_number INTEGER DEFAULT 1",
  "ALTER TABLE companies ADD COLUMN password_require_mixed_case INTEGER DEFAULT 1",
  "ALTER TABLE companies ADD COLUMN password_rotation_days INTEGER DEFAULT 0",

  // F15: User invitation flow
  `CREATE TABLE IF NOT EXISTS user_invitations (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    email TEXT NOT NULL,
    role TEXT DEFAULT 'staff',
    invited_by TEXT NOT NULL,
    invitation_token TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    accepted_at TEXT DEFAULT NULL,
    accepted_by_user_id TEXT DEFAULT NULL,
    revoked_at TEXT DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_invitations_email ON user_invitations(email, accepted_at)",
  "CREATE INDEX IF NOT EXISTS idx_invitations_token ON user_invitations(invitation_token)",

  // ─── Batch 2: 20 invoicing & expense features ────────────────

  // F16: Invoice late-fee auto-calc
  "ALTER TABLE invoices ADD COLUMN late_fee_applied REAL DEFAULT 0",
  "ALTER TABLE invoices ADD COLUMN late_fee_rate_pct REAL DEFAULT 0",
  "ALTER TABLE invoices ADD COLUMN late_fee_grace_days INTEGER DEFAULT 0",
  "ALTER TABLE companies ADD COLUMN default_late_fee_rate_pct REAL DEFAULT 1.5",
  "ALTER TABLE companies ADD COLUMN default_late_fee_grace_days INTEGER DEFAULT 7",

  // F17: Scheduled invoice reminders
  `CREATE TABLE IF NOT EXISTS invoice_reminder_schedules (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL REFERENCES invoices(id),
    days_after_due INTEGER NOT NULL,
    template_id TEXT DEFAULT NULL,
    scheduled_at TEXT NOT NULL,
    sent_at TEXT DEFAULT NULL,
    cancelled_at TEXT DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_invoice_reminders_scheduled ON invoice_reminder_schedules(scheduled_at, sent_at, cancelled_at)",

  // F18: Partial payment tracking (existing payments table is fine; add summary cols on invoice)
  "ALTER TABLE invoices ADD COLUMN amount_paid REAL DEFAULT 0",
  "ALTER TABLE invoices ADD COLUMN balance_due REAL DEFAULT 0",
  "ALTER TABLE invoices ADD COLUMN last_payment_date TEXT DEFAULT NULL",

  // F19: Credit memos / refunds
  `CREATE TABLE IF NOT EXISTS credit_memos (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    client_id TEXT NOT NULL REFERENCES clients(id),
    invoice_id TEXT REFERENCES invoices(id),
    memo_number TEXT NOT NULL,
    issue_date TEXT NOT NULL,
    reason TEXT DEFAULT '',
    amount REAL NOT NULL,
    amount_applied REAL DEFAULT 0,
    status TEXT DEFAULT 'open' CHECK(status IN ('open','partially_applied','fully_applied','voided')),
    refund_method TEXT DEFAULT '',
    refunded_at TEXT DEFAULT NULL,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_credit_memos_client ON credit_memos(client_id, status)",

  // F20: Invoice batch send (no new schema — IPC handler)
  // F21: Invoice template library
  `CREATE TABLE IF NOT EXISTS invoice_templates (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    template_name TEXT NOT NULL,
    template_data TEXT NOT NULL DEFAULT '{}',
    number_prefix TEXT DEFAULT '',
    is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,

  // F22: Invoice number prefix per template — already in invoice_templates
  // F23: Invoice currency conversion display
  "ALTER TABLE invoices ADD COLUMN exchange_rate REAL DEFAULT 1.0",
  "ALTER TABLE invoices ADD COLUMN reporting_currency_total REAL DEFAULT 0",

  // F24: Invoice deposit/down-payment tracking
  "ALTER TABLE invoices ADD COLUMN deposit_required REAL DEFAULT 0",
  "ALTER TABLE invoices ADD COLUMN deposit_paid REAL DEFAULT 0",
  "ALTER TABLE invoices ADD COLUMN deposit_due_date TEXT DEFAULT NULL",

  // F25: Invoice line-item snippets — uses existing line_item_snippets table

  // F26: Expense receipt thumbnail (existing receipts/files; add cache col)
  "ALTER TABLE expenses ADD COLUMN receipt_thumbnail_path TEXT DEFAULT NULL",

  // F27: Expense category budget alerts
  `CREATE TABLE IF NOT EXISTS category_budget_alerts (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    category_id TEXT NOT NULL,
    period TEXT NOT NULL CHECK(period IN ('monthly','quarterly','annual')),
    budget_amount REAL NOT NULL,
    alert_threshold_pct REAL DEFAULT 80,
    last_alerted_at TEXT DEFAULT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,

  // F28: Expense vendor auto-suggest — uses frequency from existing data (no schema)

  // F29: Expense splitting across categories
  `CREATE TABLE IF NOT EXISTS expense_splits (
    id TEXT PRIMARY KEY,
    expense_id TEXT NOT NULL REFERENCES expenses(id),
    category_id TEXT,
    description TEXT DEFAULT '',
    amount REAL NOT NULL,
    pct REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_expense_splits_parent ON expense_splits(expense_id)",

  // F30: Expense mileage rates library — uses existing mileage_rates table

  // F31: Expense reimbursement workflow
  `CREATE TABLE IF NOT EXISTS expense_reimbursements (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    employee_id TEXT NOT NULL,
    submitted_at TEXT DEFAULT (datetime('now')),
    submitted_by TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','paid')),
    approved_by TEXT DEFAULT NULL,
    approved_at TEXT DEFAULT NULL,
    rejected_reason TEXT DEFAULT '',
    paid_at TEXT DEFAULT NULL,
    payment_method TEXT DEFAULT '',
    total_amount REAL NOT NULL DEFAULT 0,
    notes TEXT DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS expense_reimbursement_items (
    id TEXT PRIMARY KEY,
    reimbursement_id TEXT NOT NULL REFERENCES expense_reimbursements(id),
    expense_id TEXT NOT NULL REFERENCES expenses(id),
    amount REAL NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_reimbursements_employee ON expense_reimbursements(employee_id, status)",

  // F32: Per-diem rate lookup
  `CREATE TABLE IF NOT EXISTS per_diem_rates (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    effective_year INTEGER NOT NULL,
    lodging_rate REAL NOT NULL,
    meals_rate REAL NOT NULL,
    incidentals_rate REAL DEFAULT 5,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, city, state, effective_year)
  )`,

  // F33: Bulk re-categorize (no schema — IPC handler)
  // F34: Expense report builder (no schema — uses reports infra)

  // F35: Expense duplicate detection (no schema — runtime check)

  // ─── Batch 3: 15 banking / reconciliation / payroll features ────

  // F36: Bank rule engine (if memo contains X → categorize as Y)
  `CREATE TABLE IF NOT EXISTS bank_categorization_rules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    rule_name TEXT NOT NULL,
    match_field TEXT NOT NULL CHECK(match_field IN ('description','memo','payee','amount')),
    match_type TEXT NOT NULL CHECK(match_type IN ('contains','equals','starts_with','ends_with','regex','between')),
    match_value TEXT NOT NULL,
    match_value_2 TEXT DEFAULT NULL,
    apply_category_id TEXT,
    apply_vendor_id TEXT,
    apply_tags TEXT DEFAULT '[]',
    priority INTEGER DEFAULT 100,
    is_active INTEGER DEFAULT 1,
    times_matched INTEGER DEFAULT 0,
    last_matched_at TEXT DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_bank_rules_company ON bank_categorization_rules(company_id, is_active, priority)",

  // F37: Auto-match reconciliation (no schema — algorithm in service)
  // F38: Duplicate transaction warnings
  "ALTER TABLE bank_transactions ADD COLUMN is_duplicate_of TEXT DEFAULT NULL",
  "ALTER TABLE bank_transactions ADD COLUMN duplicate_confidence REAL DEFAULT 0",

  // F39: Multi-bank transfer detection
  "ALTER TABLE bank_transactions ADD COLUMN transfer_match_id TEXT DEFAULT NULL",
  "CREATE INDEX IF NOT EXISTS idx_bank_tx_transfer ON bank_transactions(transfer_match_id)",

  // F40: Bank balance projection (no schema — computed from scheduled inflows/outflows)
  // F41: Statement CSV mapper
  `CREATE TABLE IF NOT EXISTS bank_csv_mappings (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    bank_name TEXT NOT NULL,
    mapping_json TEXT NOT NULL DEFAULT '{}',
    date_format TEXT DEFAULT 'YYYY-MM-DD',
    date_column TEXT NOT NULL,
    description_column TEXT NOT NULL,
    amount_column TEXT NOT NULL,
    debit_column TEXT DEFAULT NULL,
    credit_column TEXT DEFAULT NULL,
    skip_rows INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,

  // F42: Reconciliation history viewer
  "ALTER TABLE bank_reconciliation_matches ADD COLUMN reconciled_at TEXT DEFAULT NULL",
  "ALTER TABLE bank_reconciliation_matches ADD COLUMN reconciled_by TEXT DEFAULT ''",

  // F43: Outstanding deposit tracker (deposited but not cleared)
  "ALTER TABLE bank_transactions ADD COLUMN deposited_at TEXT DEFAULT NULL",
  "ALTER TABLE bank_transactions ADD COLUMN cleared_at TEXT DEFAULT NULL",

  // F44: Salary annual review tracker
  `CREATE TABLE IF NOT EXISTS employee_salary_reviews (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    employee_id TEXT NOT NULL,
    review_date TEXT NOT NULL,
    review_period_start TEXT,
    review_period_end TEXT,
    prior_salary REAL,
    new_salary REAL,
    pct_change REAL,
    reviewer_id TEXT,
    rating TEXT,
    notes TEXT DEFAULT '',
    effective_date TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_salary_reviews_employee ON employee_salary_reviews(employee_id, review_date DESC)",

  // F45: Pay stub bulk ZIP download (no schema — service handler)

  // F46: Time-off balance tracker
  `CREATE TABLE IF NOT EXISTS employee_time_off_balances (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    employee_id TEXT NOT NULL,
    time_off_type TEXT NOT NULL CHECK(time_off_type IN ('pto','sick','personal','bereavement','jury','other')),
    accrual_rate_hours_per_period REAL DEFAULT 0,
    accrual_period TEXT DEFAULT 'pay_period' CHECK(accrual_period IN ('pay_period','monthly','annual')),
    max_carryover_hours REAL DEFAULT 0,
    current_balance_hours REAL DEFAULT 0,
    ytd_used_hours REAL DEFAULT 0,
    ytd_accrued_hours REAL DEFAULT 0,
    last_accrual_at TEXT DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, employee_id, time_off_type)
  )`,
  `CREATE TABLE IF NOT EXISTS time_off_requests (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    employee_id TEXT NOT NULL,
    time_off_type TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    hours_requested REAL NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','denied','cancelled')),
    requested_at TEXT DEFAULT (datetime('now')),
    approved_by TEXT DEFAULT NULL,
    approved_at TEXT DEFAULT NULL,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_time_off_employee ON time_off_requests(employee_id, status, start_date)",

  // F47: Bonus calculator (no schema — service computation)
  // F48: State tax rate viewer (uses existing utah_withholding_config etc.)
  // F49: Payroll cost forecast (no schema — derived from existing payroll data)

  // F50: New-hire onboarding checklist
  `CREATE TABLE IF NOT EXISTS onboarding_templates (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    template_name TEXT NOT NULL,
    items_json TEXT NOT NULL DEFAULT '[]',
    is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS onboarding_assignments (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    employee_id TEXT NOT NULL,
    template_id TEXT,
    item_key TEXT NOT NULL,
    item_label TEXT NOT NULL,
    due_date TEXT,
    completed INTEGER DEFAULT 0,
    completed_at TEXT DEFAULT NULL,
    completed_by TEXT DEFAULT NULL,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_onboarding_employee ON onboarding_assignments(employee_id, completed)",

  // ─── Batch 4: 10 reports/analytics features ──────────────────

  // F60: Custom dashboard widgets
  `CREATE TABLE IF NOT EXISTS dashboard_widgets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    company_id TEXT NOT NULL REFERENCES companies(id),
    widget_type TEXT NOT NULL,
    widget_config TEXT DEFAULT '{}',
    position_x INTEGER DEFAULT 0,
    position_y INTEGER DEFAULT 0,
    width INTEGER DEFAULT 4,
    height INTEGER DEFAULT 2,
    is_visible INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_dashboard_widgets_user ON dashboard_widgets(user_id, company_id, is_visible)",

  // F58: AR aging email blast templates
  `CREATE TABLE IF NOT EXISTS ar_collection_templates (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    template_name TEXT NOT NULL,
    aging_bucket TEXT NOT NULL CHECK(aging_bucket IN ('1-30','31-60','61-90','90+')),
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    tone TEXT DEFAULT 'friendly' CHECK(tone IN ('friendly','firm','final','legal')),
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,

  // ─── Batch 5: 10 client/vendor/document/compliance features ───

  // F61: Client merge (no schema — service handler)

  // F62: Client tag/label system
  `CREATE TABLE IF NOT EXISTS entity_tags (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    color TEXT DEFAULT '#6b7280',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, entity_type, entity_id, tag)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_entity_tags_lookup ON entity_tags(company_id, entity_type, entity_id)",
  "CREATE INDEX IF NOT EXISTS idx_entity_tags_search ON entity_tags(tag)",

  // F63: Client communication history log
  `CREATE TABLE IF NOT EXISTS client_communications (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    client_id TEXT NOT NULL REFERENCES clients(id),
    communication_type TEXT NOT NULL CHECK(communication_type IN ('email','call','meeting','note','sms','letter','other')),
    direction TEXT DEFAULT 'outbound' CHECK(direction IN ('inbound','outbound','internal')),
    subject TEXT DEFAULT '',
    body TEXT DEFAULT '',
    contact_name TEXT DEFAULT '',
    occurred_at TEXT DEFAULT (datetime('now')),
    recorded_by TEXT DEFAULT '',
    related_invoice_id TEXT REFERENCES invoices(id),
    related_quote_id TEXT,
    follow_up_date TEXT,
    follow_up_completed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_client_comms_client ON client_communications(client_id, occurred_at DESC)",

  // F64: Vendor 1099 status auto-check (no schema — service computation)
  // F65: Vendor performance scorecard
  "ALTER TABLE vendors ADD COLUMN on_time_payment_count INTEGER DEFAULT 0",
  "ALTER TABLE vendors ADD COLUMN late_payment_count INTEGER DEFAULT 0",
  "ALTER TABLE vendors ADD COLUMN quality_rating REAL DEFAULT 0",
  "ALTER TABLE vendors ADD COLUMN dispute_count INTEGER DEFAULT 0",
  "ALTER TABLE vendors ADD COLUMN avg_days_to_pay REAL DEFAULT 0",

  // F66: Vendor contract / agreement storage (uses existing documents table with entity_type='vendor_contract')
  "ALTER TABLE vendors ADD COLUMN contract_start_date TEXT DEFAULT NULL",
  "ALTER TABLE vendors ADD COLUMN contract_end_date TEXT DEFAULT NULL",
  "ALTER TABLE vendors ADD COLUMN contract_auto_renew INTEGER DEFAULT 0",
  "ALTER TABLE vendors ADD COLUMN contract_renewal_notice_days INTEGER DEFAULT 30",

  // F67: Document expiration reminders
  "ALTER TABLE documents ADD COLUMN expires_at TEXT DEFAULT NULL",
  "ALTER TABLE documents ADD COLUMN reminder_days_before INTEGER DEFAULT 30",
  "ALTER TABLE documents ADD COLUMN last_reminded_at TEXT DEFAULT NULL",

  // F68: Document version history
  `CREATE TABLE IF NOT EXISTS document_versions (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id),
    version_number INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER DEFAULT 0,
    file_hash TEXT DEFAULT '',
    uploaded_at TEXT DEFAULT (datetime('now')),
    uploaded_by TEXT DEFAULT '',
    comment TEXT DEFAULT '',
    UNIQUE(document_id, version_number)
  )`,
  "ALTER TABLE documents ADD COLUMN current_version INTEGER DEFAULT 1",

  // F69: Document tag system (reuses entity_tags table from F62)

  // F70: Document encrypted storage flag
  "ALTER TABLE documents ADD COLUMN is_encrypted INTEGER DEFAULT 0",
  "ALTER TABLE documents ADD COLUMN encryption_key_id TEXT DEFAULT NULL",

  // ─── Batch 6: 20 automation & workflow features ──────────────

  // F71-F75: Workflow framework — triggers, conditions, actions
  `CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    trigger_type TEXT NOT NULL,
    trigger_config TEXT DEFAULT '{}',
    conditions_json TEXT DEFAULT '[]',
    actions_json TEXT DEFAULT '[]',
    is_active INTEGER DEFAULT 1,
    last_run_at TEXT DEFAULT NULL,
    run_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS workflow_runs (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id),
    triggered_at TEXT DEFAULT (datetime('now')),
    trigger_payload TEXT DEFAULT '{}',
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','running','success','failed','skipped')),
    error_message TEXT DEFAULT '',
    actions_executed INTEGER DEFAULT 0,
    duration_ms INTEGER DEFAULT 0,
    completed_at TEXT DEFAULT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_workflows_company_active ON workflows(company_id, is_active)",
  "CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id, triggered_at DESC)",

  // F76: Scheduled tasks (cron-style)
  `CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    task_name TEXT NOT NULL,
    cron_expression TEXT NOT NULL,
    action_type TEXT NOT NULL,
    action_config TEXT DEFAULT '{}',
    is_active INTEGER DEFAULT 1,
    next_run_at TEXT NOT NULL,
    last_run_at TEXT DEFAULT NULL,
    last_run_status TEXT DEFAULT '',
    run_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run ON scheduled_tasks(is_active, next_run_at)",

  // F77-F79: Approval chains (multi-step)
  `CREATE TABLE IF NOT EXISTS approval_chains (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    chain_name TEXT NOT NULL,
    entity_type TEXT NOT NULL CHECK(entity_type IN ('invoice','expense','bill','purchase_order','time_entry','reimbursement')),
    trigger_threshold REAL DEFAULT 0,
    steps_json TEXT NOT NULL DEFAULT '[]',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS approval_instances (
    id TEXT PRIMARY KEY,
    chain_id TEXT NOT NULL REFERENCES approval_chains(id),
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    current_step INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled','expired')),
    submitted_by TEXT NOT NULL,
    submitted_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT DEFAULT NULL,
    steps_log TEXT DEFAULT '[]'
  )`,
  "CREATE INDEX IF NOT EXISTS idx_approval_inst_entity ON approval_instances(entity_type, entity_id, status)",

  // F80: Email templates library
  `CREATE TABLE IF NOT EXISTS email_templates (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    template_name TEXT NOT NULL,
    template_key TEXT NOT NULL,
    subject TEXT NOT NULL,
    body_html TEXT NOT NULL,
    body_text TEXT DEFAULT '',
    category TEXT DEFAULT '',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, template_key)
  )`,

  // F81-F82: Outbound webhook subscriptions
  // webhook_subscriptions already exists from earlier waves — add stats columns
  "ALTER TABLE webhook_subscriptions ADD COLUMN secret_key TEXT DEFAULT ''",
  "ALTER TABLE webhook_subscriptions ADD COLUMN last_delivered_at TEXT DEFAULT NULL",
  "ALTER TABLE webhook_subscriptions ADD COLUMN last_status_code INTEGER DEFAULT 0",
  "ALTER TABLE webhook_subscriptions ADD COLUMN consecutive_failures INTEGER DEFAULT 0",
  "ALTER TABLE webhook_subscriptions ADD COLUMN delivery_count INTEGER DEFAULT 0",
  `CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    response_status INTEGER DEFAULT 0,
    response_body TEXT DEFAULT '',
    attempted_at TEXT DEFAULT (datetime('now')),
    duration_ms INTEGER DEFAULT 0,
    succeeded INTEGER DEFAULT 0
  )`,
  "CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_sub ON webhook_deliveries(subscription_id, attempted_at DESC)",

  // F83: Auto-categorize learned rules
  `CREATE TABLE IF NOT EXISTS auto_categorize_learnings (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    description_pattern TEXT NOT NULL,
    vendor_id TEXT,
    suggested_category_id TEXT,
    confidence REAL DEFAULT 0,
    times_matched INTEGER DEFAULT 0,
    times_accepted INTEGER DEFAULT 0,
    last_seen_at TEXT DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, description_pattern, vendor_id)
  )`,

  // F84: Auto-archive policies
  "ALTER TABLE companies ADD COLUMN auto_archive_paid_invoices_days INTEGER DEFAULT 0",
  "ALTER TABLE companies ADD COLUMN auto_archive_closed_bills_days INTEGER DEFAULT 0",
  "ALTER TABLE invoices ADD COLUMN archived_at TEXT DEFAULT NULL",
  "ALTER TABLE bills ADD COLUMN archived_at TEXT DEFAULT NULL",

  // F85: Triggered actions log
  `CREATE TABLE IF NOT EXISTS triggered_actions_log (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    trigger_source TEXT NOT NULL,
    trigger_entity_type TEXT,
    trigger_entity_id TEXT,
    action_type TEXT NOT NULL,
    action_result TEXT DEFAULT '',
    triggered_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_triggered_actions_company ON triggered_actions_log(company_id, triggered_at DESC)",

  // F86: SLA tracking (e.g., invoice payment SLA)
  `CREATE TABLE IF NOT EXISTS sla_definitions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    sla_name TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    metric TEXT NOT NULL,
    target_value REAL NOT NULL,
    target_unit TEXT NOT NULL,
    severity TEXT DEFAULT 'medium',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  // F87-F88: Saved searches + filter presets
  `CREATE TABLE IF NOT EXISTS saved_searches (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    company_id TEXT NOT NULL REFERENCES companies(id),
    module TEXT NOT NULL,
    search_name TEXT NOT NULL,
    filters_json TEXT NOT NULL DEFAULT '{}',
    is_shared INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,

  // F89: Bulk operations log (undo)
  `CREATE TABLE IF NOT EXISTS bulk_operations_log (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id),
    operation_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_ids_json TEXT NOT NULL,
    changes_json TEXT NOT NULL,
    performed_by TEXT NOT NULL,
    performed_at TEXT DEFAULT (datetime('now')),
    can_undo INTEGER DEFAULT 1,
    undone_at TEXT DEFAULT NULL
  )`,

  // F90: Quick actions / shortcuts
  `CREATE TABLE IF NOT EXISTS quick_actions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    label TEXT NOT NULL,
    icon TEXT DEFAULT '',
    action_type TEXT NOT NULL,
    action_config TEXT DEFAULT '{}',
    sort_order INTEGER DEFAULT 0,
    is_pinned INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // ─── Batch 7: Banking, Treasury, Multi-Currency (F91-F110) ───
  // F91 — cash_position_snapshots (roll-up snapshots for trend chart)
  `CREATE TABLE IF NOT EXISTS cash_position_snapshots (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    snapshot_date TEXT NOT NULL,
    base_currency TEXT DEFAULT 'USD',
    total_cash REAL DEFAULT 0,
    total_ar REAL DEFAULT 0,
    total_ap REAL DEFAULT 0,
    accounts_breakdown TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, snapshot_date)
  )`,
  // F92 — cash_forecast_lines (daily projected cash by source)
  `CREATE TABLE IF NOT EXISTS cash_forecast_lines (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    forecast_date TEXT NOT NULL,
    projection_date TEXT NOT NULL,
    source_type TEXT,
    source_id TEXT,
    amount REAL DEFAULT 0,
    direction TEXT DEFAULT 'in',
    confidence REAL DEFAULT 1.0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_cash_forecast_co_date ON cash_forecast_lines(company_id, projection_date)",
  // F93 — fx_rates (historical FX with multi-source)
  `CREATE TABLE IF NOT EXISTS fx_rates (
    id TEXT PRIMARY KEY,
    rate_date TEXT NOT NULL,
    from_currency TEXT NOT NULL,
    to_currency TEXT NOT NULL,
    rate REAL NOT NULL,
    source TEXT DEFAULT 'manual',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(rate_date, from_currency, to_currency, source)
  )`,
  // F94 — fx_revaluation_runs (unrealized gain/loss on foreign-currency balances)
  `CREATE TABLE IF NOT EXISTS fx_revaluation_runs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    revaluation_date TEXT NOT NULL,
    base_currency TEXT DEFAULT 'USD',
    total_unrealized_gain REAL DEFAULT 0,
    total_unrealized_loss REAL DEFAULT 0,
    posted_je_id TEXT,
    breakdown_json TEXT DEFAULT '[]',
    is_posted INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    created_by TEXT
  )`,
  // F95 — additional currency columns on bank accounts (already via accounts.currency)
  "ALTER TABLE accounts ADD COLUMN account_native_currency TEXT DEFAULT 'USD'",
  "ALTER TABLE accounts ADD COLUMN last_fx_rate REAL DEFAULT 1.0",
  // F96 — wire_transfers
  `CREATE TABLE IF NOT EXISTS wire_transfers (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    transfer_date TEXT NOT NULL,
    from_account_id TEXT,
    to_beneficiary TEXT,
    amount REAL DEFAULT 0,
    currency TEXT DEFAULT 'USD',
    wire_fee REAL DEFAULT 0,
    intermediary_bank TEXT,
    reference_number TEXT,
    status TEXT DEFAULT 'pending',
    notes TEXT,
    posted_je_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // F97 — ach_batches + ach_batch_items
  `CREATE TABLE IF NOT EXISTS ach_batches (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    batch_date TEXT NOT NULL,
    effective_date TEXT NOT NULL,
    bank_account_id TEXT,
    sec_code TEXT DEFAULT 'CCD',
    company_entry_description TEXT,
    total_debit REAL DEFAULT 0,
    total_credit REAL DEFAULT 0,
    item_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'draft',
    nacha_file_path TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    submitted_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS ach_batch_items (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES ach_batches(id) ON DELETE CASCADE,
    payee_name TEXT NOT NULL,
    routing_number TEXT NOT NULL,
    account_number_last4 TEXT NOT NULL,
    account_type TEXT DEFAULT 'checking',
    amount REAL DEFAULT 0,
    direction TEXT DEFAULT 'credit',
    addenda TEXT,
    bill_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F98 — bank_fee_categories (auto-classification rules for service charges)
  `CREATE TABLE IF NOT EXISTS bank_fee_categories (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    pattern TEXT NOT NULL,
    category_id TEXT,
    expense_account_id TEXT,
    is_active INTEGER DEFAULT 1,
    match_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F99 — bank_match_attempts (fuzzy matcher audit)
  `CREATE TABLE IF NOT EXISTS bank_match_attempts (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    transaction_id TEXT NOT NULL,
    candidate_type TEXT,
    candidate_id TEXT,
    score REAL DEFAULT 0,
    accepted INTEGER DEFAULT 0,
    matched_at TEXT DEFAULT (datetime('now'))
  )`,
  // F100 — stop_payments
  `CREATE TABLE IF NOT EXISTS stop_payments (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    bank_account_id TEXT,
    check_number TEXT,
    amount REAL DEFAULT 0,
    payee TEXT,
    requested_date TEXT,
    effective_date TEXT,
    expires_at TEXT,
    reason TEXT,
    status TEXT DEFAULT 'active',
    fee REAL DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F101 — pending_deposits (float tracker)
  `CREATE TABLE IF NOT EXISTS pending_deposits (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    deposit_date TEXT,
    expected_clear_date TEXT,
    bank_account_id TEXT,
    amount REAL DEFAULT 0,
    deposit_type TEXT DEFAULT 'check',
    reference TEXT,
    status TEXT DEFAULT 'pending',
    cleared_at TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F102 — petty_cash_log
  `CREATE TABLE IF NOT EXISTS petty_cash_log (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    log_date TEXT NOT NULL,
    direction TEXT DEFAULT 'out',
    amount REAL DEFAULT 0,
    purpose TEXT,
    payee TEXT,
    receipt_path TEXT,
    custodian TEXT,
    posted_je_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F103 — treasury_investments
  `CREATE TABLE IF NOT EXISTS treasury_investments (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    instrument_type TEXT NOT NULL,
    institution TEXT,
    cusip TEXT,
    purchase_date TEXT,
    maturity_date TEXT,
    face_value REAL DEFAULT 0,
    purchase_price REAL DEFAULT 0,
    interest_rate REAL DEFAULT 0,
    interest_frequency TEXT DEFAULT 'monthly',
    status TEXT DEFAULT 'active',
    auto_roll INTEGER DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F104 — letters_of_credit
  `CREATE TABLE IF NOT EXISTS letters_of_credit (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    lc_number TEXT,
    lc_type TEXT DEFAULT 'standby',
    issuing_bank TEXT,
    beneficiary TEXT,
    face_amount REAL DEFAULT 0,
    currency TEXT DEFAULT 'USD',
    issue_date TEXT,
    expiry_date TEXT,
    status TEXT DEFAULT 'open',
    fee_accrued REAL DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F105 — loan_covenants
  // Loan Full-System Wave (F993-F1052) — 60 features covering all loan
  // types + advanced math + applications/origination + risk/compliance +
  // specialized products + portfolio analytics.
  `CREATE TABLE IF NOT EXISTS borrower_profiles (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    borrower_type TEXT DEFAULT 'individual',
    ssn_ein_last4 TEXT,
    date_of_birth_or_founded TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    credit_score INTEGER,
    credit_score_updated_at TEXT,
    annual_income REAL DEFAULT 0,
    monthly_debt REAL DEFAULT 0,
    employment_status TEXT,
    years_at_employer REAL,
    citizenship_status TEXT,
    kyc_status TEXT DEFAULT 'pending',
    kyc_completed_at TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS loan_applications (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    borrower_id TEXT,
    application_number TEXT,
    loan_type TEXT NOT NULL,
    requested_amount REAL NOT NULL,
    requested_term_months INTEGER,
    purpose TEXT,
    collateral_description TEXT,
    estimated_collateral_value REAL,
    estimated_rate REAL,
    status TEXT DEFAULT 'draft',
    decision TEXT,
    decision_reason TEXT,
    decided_at TEXT,
    decided_by TEXT,
    converted_loan_id TEXT,
    application_data_json TEXT DEFAULT '{}',
    submitted_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS loan_heloc_draws (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    loan_id TEXT NOT NULL,
    draw_date TEXT NOT NULL,
    draw_amount REAL NOT NULL,
    available_credit_before REAL,
    available_credit_after REAL,
    purpose TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS loan_construction_draws (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    loan_id TEXT NOT NULL,
    draw_number INTEGER NOT NULL,
    request_date TEXT NOT NULL,
    requested_amount REAL NOT NULL,
    approved_amount REAL,
    pct_complete REAL,
    inspector_name TEXT,
    inspection_date TEXT,
    notes TEXT,
    status TEXT DEFAULT 'pending',
    disbursed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS loan_lease_terms (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    loan_id TEXT NOT NULL UNIQUE,
    lease_type TEXT NOT NULL,
    asset_fmv REAL,
    lease_term_months INTEGER,
    economic_life_months INTEGER,
    residual_value REAL,
    bargain_purchase_option INTEGER DEFAULT 0,
    transfers_title INTEGER DEFAULT 0,
    classification TEXT,
    rou_asset_value REAL,
    lease_liability REAL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS loan_idr_plans (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    loan_id TEXT NOT NULL,
    plan_type TEXT NOT NULL,
    discretionary_income REAL,
    payment_pct REAL,
    monthly_payment_calculated REAL,
    annual_recertification_date TEXT,
    forgiveness_eligible_months INTEGER DEFAULT 0,
    forgiveness_total_required INTEGER DEFAULT 300,
    enrolled_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS loan_pslf_progress (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    loan_id TEXT NOT NULL UNIQUE,
    qualifying_employer_name TEXT,
    employment_certified_through TEXT,
    qualifying_payments_count INTEGER DEFAULT 0,
    payments_remaining INTEGER DEFAULT 120,
    next_eligible_date TEXT,
    status TEXT DEFAULT 'active',
    last_certified_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS loan_charge_offs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    loan_id TEXT NOT NULL,
    charge_off_date TEXT NOT NULL,
    principal_charged_off REAL NOT NULL,
    interest_charged_off REAL DEFAULT 0,
    fees_charged_off REAL DEFAULT 0,
    total_charged_off REAL NOT NULL,
    reason TEXT,
    approved_by TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS loan_recoveries (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    loan_id TEXT NOT NULL,
    charge_off_id TEXT,
    recovery_date TEXT NOT NULL,
    recovery_amount REAL NOT NULL,
    recovery_method TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS loan_risk_grades (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    loan_id TEXT NOT NULL,
    grade INTEGER NOT NULL,
    grade_label TEXT,
    factors_json TEXT DEFAULT '[]',
    assigned_by TEXT,
    assigned_at TEXT DEFAULT (datetime('now')),
    notes TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS loan_disclosures (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    loan_id TEXT,
    application_id TEXT,
    disclosure_type TEXT NOT NULL,
    document_name TEXT,
    delivery_method TEXT,
    sent_at TEXT,
    acknowledged_at TEXT,
    file_path TEXT,
    metadata_json TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS loan_promissory_notes (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    loan_id TEXT,
    note_number TEXT,
    borrower_name TEXT NOT NULL,
    lender_name TEXT NOT NULL,
    principal_amount REAL NOT NULL,
    interest_rate REAL,
    afr_rate REAL,
    use_afr INTEGER DEFAULT 0,
    payment_terms TEXT,
    maturity_date TEXT,
    signed_date TEXT,
    governing_state TEXT,
    document_path TEXT,
    status TEXT DEFAULT 'draft',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // Loan Wave (F963-F992) — 30 advanced loan features.
  // Collateral linkage — what asset secures the loan. Many-to-many because
  // a single asset can be cross-collateralized across multiple loans.
  `CREATE TABLE IF NOT EXISTS loan_collateral (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    loan_id TEXT NOT NULL,
    collateral_type TEXT NOT NULL,
    asset_id TEXT,
    description TEXT,
    original_value REAL DEFAULT 0,
    current_value REAL DEFAULT 0,
    last_appraisal_date TEXT,
    insurance_policy_id TEXT,
    is_primary INTEGER DEFAULT 1,
    cross_collateralized INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // Loan documents repository — note, agreement, disclosures, 1098, etc.
  `CREATE TABLE IF NOT EXISTS loan_documents (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    loan_id TEXT NOT NULL,
    document_type TEXT NOT NULL,
    name TEXT NOT NULL,
    file_path TEXT,
    expires_at TEXT,
    uploaded_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // Variable rate / ARM reset schedule. One row per scheduled rate change.
  // Type column distinguishes auto-reset from manual override.
  `CREATE TABLE IF NOT EXISTS loan_arm_schedule (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    loan_id TEXT NOT NULL,
    reset_date TEXT NOT NULL,
    reset_type TEXT DEFAULT 'auto',
    index_name TEXT,
    index_value REAL,
    margin REAL DEFAULT 0,
    new_rate REAL,
    periodic_cap REAL,
    lifetime_cap REAL,
    notes TEXT,
    applied INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // Escrow account ledger. Each deposit and disbursement is a row;
  // running balance is computed by summing.
  `CREATE TABLE IF NOT EXISTS loan_escrow_ledger (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    loan_id TEXT NOT NULL,
    transaction_date TEXT NOT NULL,
    transaction_type TEXT NOT NULL,
    amount REAL NOT NULL,
    category TEXT,
    payee TEXT,
    reference TEXT,
    running_balance REAL DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // PMI tracking — required when LTV > 80% on mortgages, auto-cancel at 78%
  `CREATE TABLE IF NOT EXISTS loan_pmi_tracking (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    loan_id TEXT NOT NULL UNIQUE,
    monthly_premium REAL DEFAULT 0,
    starts_at TEXT,
    auto_cancel_at_ltv REAL DEFAULT 78,
    request_cancellation_at_ltv REAL DEFAULT 80,
    current_ltv REAL,
    last_ltv_check_at TEXT,
    cancelled_at TEXT,
    cancellation_reason TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // Year-end 1098 mortgage interest statements. One row per loan per year.
  `CREATE TABLE IF NOT EXISTS loan_1098_filings (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    loan_id TEXT NOT NULL,
    tax_year INTEGER NOT NULL,
    box1_interest_received REAL DEFAULT 0,
    box2_outstanding_principal REAL DEFAULT 0,
    box3_origination_date TEXT,
    box4_refund_overpayment REAL DEFAULT 0,
    box5_mortgage_insurance REAL DEFAULT 0,
    box6_points_paid REAL DEFAULT 0,
    box7_address_same_as_collateral INTEGER DEFAULT 1,
    box8_property_address TEXT,
    box9_num_properties INTEGER DEFAULT 1,
    box10_other TEXT,
    box11_acquisition_date TEXT,
    pdf_path TEXT,
    transmitted_at TEXT,
    status TEXT DEFAULT 'draft',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    UNIQUE(company_id, loan_id, tax_year)
  )`,
  `CREATE TABLE IF NOT EXISTS loan_covenants (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    loan_id TEXT,
    covenant_name TEXT NOT NULL,
    metric TEXT,
    operator TEXT DEFAULT '>=',
    threshold_value REAL DEFAULT 0,
    measurement_frequency TEXT DEFAULT 'quarterly',
    next_measurement_date TEXT,
    last_measured_value REAL,
    last_measured_at TEXT,
    breach_status TEXT DEFAULT 'compliant',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F106 — sweep_rules
  `CREATE TABLE IF NOT EXISTS sweep_rules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    source_account_id TEXT,
    target_account_id TEXT,
    rule_type TEXT DEFAULT 'threshold',
    minimum_balance REAL DEFAULT 0,
    target_balance REAL DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    last_swept_at TEXT,
    last_swept_amount REAL DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F107 — inter_company_transfers
  `CREATE TABLE IF NOT EXISTS inter_company_transfers (
    id TEXT PRIMARY KEY,
    transfer_date TEXT NOT NULL,
    from_company_id TEXT NOT NULL,
    to_company_id TEXT NOT NULL,
    from_account_id TEXT,
    to_account_id TEXT,
    amount REAL DEFAULT 0,
    currency TEXT DEFAULT 'USD',
    purpose TEXT,
    status TEXT DEFAULT 'pending',
    from_je_id TEXT,
    to_je_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F108 — credit_card_statements + cc_statement_lines
  `CREATE TABLE IF NOT EXISTS credit_card_statements (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    card_account_id TEXT,
    statement_date TEXT NOT NULL,
    closing_date TEXT,
    due_date TEXT,
    new_balance REAL DEFAULT 0,
    minimum_payment REAL DEFAULT 0,
    is_reconciled INTEGER DEFAULT 0,
    reconciled_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS cc_statement_lines (
    id TEXT PRIMARY KEY,
    statement_id TEXT NOT NULL REFERENCES credit_card_statements(id) ON DELETE CASCADE,
    transaction_date TEXT NOT NULL,
    description TEXT,
    amount REAL DEFAULT 0,
    matched_expense_id TEXT,
    is_matched INTEGER DEFAULT 0
  )`,
  // F109 — lockbox_imports + lockbox_items
  `CREATE TABLE IF NOT EXISTS lockbox_imports (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    import_date TEXT NOT NULL,
    bank_account_id TEXT,
    file_path TEXT,
    total_amount REAL DEFAULT 0,
    item_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'imported',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS lockbox_items (
    id TEXT PRIMARY KEY,
    import_id TEXT NOT NULL REFERENCES lockbox_imports(id) ON DELETE CASCADE,
    customer_id TEXT,
    invoice_number TEXT,
    payment_date TEXT,
    amount REAL DEFAULT 0,
    match_status TEXT DEFAULT 'unmatched',
    matched_invoice_id TEXT,
    notes TEXT
  )`,
  // F110 — positive_pay_files
  `CREATE TABLE IF NOT EXISTS positive_pay_files (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    bank_account_id TEXT,
    file_date TEXT NOT NULL,
    file_format TEXT DEFAULT 'csv',
    check_count INTEGER DEFAULT 0,
    total_amount REAL DEFAULT 0,
    file_path TEXT,
    submitted INTEGER DEFAULT 0,
    submitted_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // ─── Batch 8: Inventory, Projects, Time (F111-F130) ───
  // F111 — warehouses
  `CREATE TABLE IF NOT EXISTS warehouses (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    address TEXT,
    is_default INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    UNIQUE(company_id, code)
  )`,
  // F112 — inventory_locations (bin/shelf within warehouse)
  `CREATE TABLE IF NOT EXISTS inventory_locations (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    location_code TEXT NOT NULL,
    aisle TEXT,
    rack TEXT,
    bin TEXT,
    capacity REAL DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_inv_loc_wh ON inventory_locations(warehouse_id)",
  // F113 — inventory_lots (lot/batch tracking)
  `CREATE TABLE IF NOT EXISTS inventory_lots (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    lot_number TEXT NOT NULL,
    warehouse_id TEXT,
    location_id TEXT,
    quantity REAL DEFAULT 0,
    unit_cost REAL DEFAULT 0,
    received_date TEXT,
    expiry_date TEXT,
    supplier_id TEXT,
    status TEXT DEFAULT 'available',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, item_id, lot_number)
  )`,
  // F114 — inventory_serial_numbers
  `CREATE TABLE IF NOT EXISTS inventory_serial_numbers (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    serial_number TEXT NOT NULL,
    lot_id TEXT,
    warehouse_id TEXT,
    location_id TEXT,
    status TEXT DEFAULT 'available',
    purchase_date TEXT,
    sold_date TEXT,
    customer_id TEXT,
    warranty_expires_at TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, item_id, serial_number)
  )`,
  // F115 — inventory_transfers
  `CREATE TABLE IF NOT EXISTS inventory_transfers (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    transfer_number TEXT,
    transfer_date TEXT NOT NULL,
    from_warehouse_id TEXT NOT NULL,
    to_warehouse_id TEXT NOT NULL,
    status TEXT DEFAULT 'draft',
    notes TEXT,
    item_count INTEGER DEFAULT 0,
    requested_by TEXT,
    shipped_at TEXT,
    received_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_transfer_items (
    id TEXT PRIMARY KEY,
    transfer_id TEXT NOT NULL REFERENCES inventory_transfers(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    lot_id TEXT,
    quantity REAL DEFAULT 0,
    unit_cost REAL DEFAULT 0,
    notes TEXT
  )`,
  // F116 — inventory_adjustments
  `CREATE TABLE IF NOT EXISTS inventory_adjustments (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    adjustment_number TEXT,
    adjustment_date TEXT NOT NULL,
    warehouse_id TEXT,
    reason TEXT,
    reason_code TEXT,
    total_value_change REAL DEFAULT 0,
    approved_by TEXT,
    approved_at TEXT,
    posted_je_id TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    created_by TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_adjustment_items (
    id TEXT PRIMARY KEY,
    adjustment_id TEXT NOT NULL REFERENCES inventory_adjustments(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    lot_id TEXT,
    quantity_change REAL DEFAULT 0,
    old_quantity REAL DEFAULT 0,
    new_quantity REAL DEFAULT 0,
    unit_cost REAL DEFAULT 0,
    value_change REAL DEFAULT 0
  )`,
  // F117 — stock_take_sessions
  `CREATE TABLE IF NOT EXISTS stock_take_sessions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    session_name TEXT,
    warehouse_id TEXT,
    start_date TEXT NOT NULL,
    completion_date TEXT,
    counted_by TEXT,
    status TEXT DEFAULT 'in_progress',
    total_items_counted INTEGER DEFAULT 0,
    variance_count INTEGER DEFAULT 0,
    adjustment_id TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS stock_take_counts (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES stock_take_sessions(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL,
    location_id TEXT,
    system_quantity REAL DEFAULT 0,
    counted_quantity REAL DEFAULT 0,
    variance REAL DEFAULT 0,
    notes TEXT,
    counted_at TEXT
  )`,
  // F118 — low_stock_alerts
  `CREATE TABLE IF NOT EXISTS low_stock_alerts (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    warehouse_id TEXT,
    threshold_quantity REAL DEFAULT 0,
    current_quantity REAL DEFAULT 0,
    severity TEXT DEFAULT 'warning',
    alerted_at TEXT,
    acknowledged_at TEXT,
    acknowledged_by TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F119 — inventory_valuation_methods (per company default + per item override)
  "ALTER TABLE companies ADD COLUMN inventory_valuation_method TEXT DEFAULT 'average'",
  "ALTER TABLE inventory_items ADD COLUMN valuation_method_override TEXT",
  "ALTER TABLE inventory_items ADD COLUMN minimum_stock REAL DEFAULT 0",
  "ALTER TABLE inventory_items ADD COLUMN maximum_stock REAL DEFAULT 0",
  // F120 — inventory_value_history (period-end COGS snapshots)
  `CREATE TABLE IF NOT EXISTS inventory_value_history (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    snapshot_date TEXT NOT NULL,
    method TEXT DEFAULT 'average',
    total_units REAL DEFAULT 0,
    total_value REAL DEFAULT 0,
    by_item_breakdown TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, snapshot_date)
  )`,
  // F121 — project_tasks
  `CREATE TABLE IF NOT EXISTS project_tasks (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    parent_task_id TEXT,
    task_name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'todo',
    priority TEXT DEFAULT 'medium',
    assigned_to TEXT,
    start_date TEXT,
    due_date TEXT,
    completed_at TEXT,
    estimated_hours REAL DEFAULT 0,
    actual_hours REAL DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_project_tasks_proj ON project_tasks(project_id, status)",
  // F122 — project_milestones
  `CREATE TABLE IF NOT EXISTS project_milestones (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    milestone_name TEXT NOT NULL,
    target_date TEXT,
    achieved_date TEXT,
    status TEXT DEFAULT 'pending',
    deliverables TEXT,
    payment_amount REAL DEFAULT 0,
    invoiced INTEGER DEFAULT 0,
    invoice_id TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // F123 — project_resources (team allocation)
  `CREATE TABLE IF NOT EXISTS project_resources (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    resource_type TEXT DEFAULT 'employee',
    employee_id TEXT,
    role TEXT,
    allocation_percent REAL DEFAULT 100,
    start_date TEXT,
    end_date TEXT,
    hourly_rate REAL DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // F124 — project_budgets
  `CREATE TABLE IF NOT EXISTS project_budgets (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    category TEXT NOT NULL,
    budgeted_amount REAL DEFAULT 0,
    actual_amount REAL DEFAULT 0,
    committed_amount REAL DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // F125 — project_risks
  `CREATE TABLE IF NOT EXISTS project_risks (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    risk_description TEXT NOT NULL,
    likelihood TEXT DEFAULT 'medium',
    impact TEXT DEFAULT 'medium',
    mitigation_plan TEXT,
    owner TEXT,
    status TEXT DEFAULT 'open',
    identified_date TEXT,
    closed_date TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // F126 — project_change_orders
  `CREATE TABLE IF NOT EXISTS project_change_orders (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    co_number TEXT,
    description TEXT NOT NULL,
    cost_change REAL DEFAULT 0,
    schedule_change_days INTEGER DEFAULT 0,
    requested_by TEXT,
    approved_by TEXT,
    approved_at TEXT,
    status TEXT DEFAULT 'pending',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // F127 — timesheet_periods
  `CREATE TABLE IF NOT EXISTS timesheet_periods (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    total_hours REAL DEFAULT 0,
    billable_hours REAL DEFAULT 0,
    overtime_hours REAL DEFAULT 0,
    status TEXT DEFAULT 'open',
    submitted_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, employee_id, period_start)
  )`,
  // F128 — timesheet_approvals
  `CREATE TABLE IF NOT EXISTS timesheet_approvals (
    id TEXT PRIMARY KEY,
    period_id TEXT NOT NULL REFERENCES timesheet_periods(id) ON DELETE CASCADE,
    step_number INTEGER DEFAULT 1,
    approver_id TEXT,
    action TEXT,
    acted_at TEXT,
    comment TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F129 — billable_time_summary cache (rebuilt periodically)
  `CREATE TABLE IF NOT EXISTS billable_time_summary (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    summary_date TEXT NOT NULL,
    project_id TEXT,
    client_id TEXT,
    employee_id TEXT,
    period_start TEXT,
    period_end TEXT,
    billable_hours REAL DEFAULT 0,
    non_billable_hours REAL DEFAULT 0,
    billable_amount REAL DEFAULT 0,
    invoiced_amount REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_bts_co_period ON billable_time_summary(company_id, period_start, period_end)",
  // F130 — project_profitability snapshots
  `CREATE TABLE IF NOT EXISTS project_profitability (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    snapshot_date TEXT NOT NULL,
    total_revenue REAL DEFAULT 0,
    total_costs REAL DEFAULT 0,
    labor_costs REAL DEFAULT 0,
    material_costs REAL DEFAULT 0,
    other_costs REAL DEFAULT 0,
    gross_profit REAL DEFAULT 0,
    margin_percent REAL DEFAULT 0,
    budget_variance REAL DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, project_id, snapshot_date)
  )`,
  // ─── Batch 9: CRM, Sales, Quotes (F131-F150) ───
  // F131 — sales_pipeline_stages
  `CREATE TABLE IF NOT EXISTS sales_pipeline_stages (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    stage_name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    probability_percent REAL DEFAULT 0,
    is_won INTEGER DEFAULT 0,
    is_lost INTEGER DEFAULT 0,
    color TEXT DEFAULT '#6366f1',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // F132 — deals (opportunities)
  `CREATE TABLE IF NOT EXISTS deals (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    deal_name TEXT NOT NULL,
    client_id TEXT,
    contact_name TEXT,
    contact_email TEXT,
    stage_id TEXT,
    estimated_value REAL DEFAULT 0,
    estimated_close_date TEXT,
    actual_close_date TEXT,
    probability_percent REAL DEFAULT 0,
    weighted_value REAL DEFAULT 0,
    assigned_to TEXT,
    source TEXT,
    territory_id TEXT,
    status TEXT DEFAULT 'open',
    won_reason TEXT,
    lost_reason TEXT,
    competitor TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_deals_co_stage ON deals(company_id, stage_id, status)",
  // F133 — deal_activities
  `CREATE TABLE IF NOT EXISTS deal_activities (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    deal_id TEXT NOT NULL,
    activity_type TEXT NOT NULL,
    activity_date TEXT,
    subject TEXT,
    description TEXT,
    duration_minutes INTEGER DEFAULT 0,
    outcome TEXT,
    next_action TEXT,
    next_action_date TEXT,
    performed_by TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F134 — sales_targets
  `CREATE TABLE IF NOT EXISTS sales_targets (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    rep_id TEXT,
    target_period TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    target_amount REAL DEFAULT 0,
    actual_amount REAL DEFAULT 0,
    deal_count_target INTEGER DEFAULT 0,
    actual_deal_count INTEGER DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F135 — sales_performance_snapshots
  `CREATE TABLE IF NOT EXISTS sales_performance_snapshots (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    snapshot_date TEXT NOT NULL,
    rep_id TEXT,
    period_start TEXT,
    period_end TEXT,
    deals_won INTEGER DEFAULT 0,
    deals_lost INTEGER DEFAULT 0,
    revenue_won REAL DEFAULT 0,
    pipeline_value REAL DEFAULT 0,
    average_deal_size REAL DEFAULT 0,
    win_rate REAL DEFAULT 0,
    avg_days_to_close REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F136 — lead_forms
  `CREATE TABLE IF NOT EXISTS lead_forms (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    form_name TEXT NOT NULL,
    fields_json TEXT DEFAULT '[]',
    is_active INTEGER DEFAULT 1,
    submission_count INTEGER DEFAULT 0,
    redirect_url TEXT,
    success_message TEXT,
    notify_emails TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS lead_form_submissions (
    id TEXT PRIMARY KEY,
    form_id TEXT NOT NULL REFERENCES lead_forms(id) ON DELETE CASCADE,
    submitted_at TEXT DEFAULT (datetime('now')),
    data_json TEXT NOT NULL,
    converted_to_lead_id TEXT,
    ip_address TEXT
  )`,
  // F137 — lead_scoring_rules
  `CREATE TABLE IF NOT EXISTS lead_scoring_rules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    rule_name TEXT NOT NULL,
    criteria_json TEXT NOT NULL,
    score_value INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // F138 — lead_routing_rules
  `CREATE TABLE IF NOT EXISTS lead_routing_rules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    rule_name TEXT NOT NULL,
    priority INTEGER DEFAULT 0,
    criteria_json TEXT NOT NULL,
    assign_to_user_id TEXT,
    assign_to_team_id TEXT,
    territory_id TEXT,
    is_active INTEGER DEFAULT 1,
    match_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // F139 — sales_territories
  `CREATE TABLE IF NOT EXISTS sales_territories (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    territory_name TEXT NOT NULL,
    region TEXT,
    countries TEXT,
    states TEXT,
    zip_prefixes TEXT,
    industry_focus TEXT,
    owner_user_id TEXT,
    notes TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // F140 — commission_plans
  `CREATE TABLE IF NOT EXISTS commission_plans (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    plan_name TEXT NOT NULL,
    effective_from TEXT,
    effective_to TEXT,
    plan_type TEXT DEFAULT 'percent',
    base_rate REAL DEFAULT 0,
    tiers_json TEXT DEFAULT '[]',
    accelerators_json TEXT DEFAULT '[]',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // F141 — commission_calculations
  `CREATE TABLE IF NOT EXISTS commission_calculations (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    rep_id TEXT NOT NULL,
    plan_id TEXT,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    revenue_basis REAL DEFAULT 0,
    base_commission REAL DEFAULT 0,
    accelerator_commission REAL DEFAULT 0,
    bonus REAL DEFAULT 0,
    adjustments REAL DEFAULT 0,
    total_commission REAL DEFAULT 0,
    paid INTEGER DEFAULT 0,
    paid_at TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F142 — discount_rules
  `CREATE TABLE IF NOT EXISTS discount_rules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    rule_name TEXT NOT NULL,
    rule_type TEXT DEFAULT 'volume',
    discount_percent REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    minimum_qty REAL DEFAULT 0,
    minimum_amount REAL DEFAULT 0,
    applies_to TEXT DEFAULT 'all',
    item_ids TEXT,
    customer_tier TEXT,
    effective_from TEXT,
    effective_to TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // F143 — promo_codes
  `CREATE TABLE IF NOT EXISTS promo_codes (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    code TEXT NOT NULL,
    description TEXT,
    discount_percent REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    max_redemptions INTEGER DEFAULT 0,
    redemption_count INTEGER DEFAULT 0,
    minimum_order_amount REAL DEFAULT 0,
    valid_from TEXT,
    valid_to TEXT,
    one_per_customer INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, code)
  )`,
  `CREATE TABLE IF NOT EXISTS promo_code_redemptions (
    id TEXT PRIMARY KEY,
    promo_code_id TEXT NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
    customer_id TEXT,
    invoice_id TEXT,
    order_total REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    redeemed_at TEXT DEFAULT (datetime('now'))
  )`,
  // F144 — loyalty_tiers + customer_loyalty
  `CREATE TABLE IF NOT EXISTS loyalty_tiers (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    tier_name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    minimum_spend REAL DEFAULT 0,
    minimum_points INTEGER DEFAULT 0,
    discount_percent REAL DEFAULT 0,
    earn_multiplier REAL DEFAULT 1.0,
    perks TEXT,
    color TEXT DEFAULT '#6366f1',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS customer_loyalty (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    tier_id TEXT,
    points_balance INTEGER DEFAULT 0,
    lifetime_spend REAL DEFAULT 0,
    lifetime_points INTEGER DEFAULT 0,
    last_activity_date TEXT,
    enrolled_date TEXT,
    expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    UNIQUE(company_id, customer_id)
  )`,
  `CREATE TABLE IF NOT EXISTS loyalty_transactions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    transaction_date TEXT DEFAULT (datetime('now')),
    direction TEXT DEFAULT 'earn',
    points INTEGER DEFAULT 0,
    reason TEXT,
    invoice_id TEXT,
    redemption_id TEXT
  )`,
  // F145 — customer_referrals
  `CREATE TABLE IF NOT EXISTS customer_referrals (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    referrer_customer_id TEXT NOT NULL,
    referee_name TEXT,
    referee_email TEXT,
    referee_customer_id TEXT,
    status TEXT DEFAULT 'pending',
    reward_amount REAL DEFAULT 0,
    reward_paid_at TEXT,
    converted_at TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F146 — quote_templates_v2 (rich templates with default lines)
  `CREATE TABLE IF NOT EXISTS quote_template_lines (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    item_id TEXT,
    description TEXT,
    quantity REAL DEFAULT 1,
    unit_price REAL DEFAULT 0,
    discount_percent REAL DEFAULT 0,
    tax_rate REAL DEFAULT 0,
    notes TEXT
  )`,
  // F147 — quote_conversion_log
  `CREATE TABLE IF NOT EXISTS quote_conversion_log (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    quote_id TEXT NOT NULL,
    invoice_id TEXT NOT NULL,
    conversion_date TEXT DEFAULT (datetime('now')),
    converted_by TEXT,
    notes TEXT
  )`,
  // F148 — quote_signatures (light e-sign)
  `CREATE TABLE IF NOT EXISTS quote_signatures (
    id TEXT PRIMARY KEY,
    quote_id TEXT NOT NULL,
    signer_name TEXT NOT NULL,
    signer_email TEXT,
    signature_data TEXT,
    signed_at TEXT DEFAULT (datetime('now')),
    ip_address TEXT,
    user_agent TEXT,
    status TEXT DEFAULT 'signed'
  )`,
  // F149 — rfp_tracking
  `CREATE TABLE IF NOT EXISTS rfp_tracking (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    rfp_number TEXT,
    title TEXT NOT NULL,
    issued_by TEXT,
    received_date TEXT,
    response_due_date TEXT,
    contract_value_estimate REAL DEFAULT 0,
    status TEXT DEFAULT 'evaluating',
    submitted_at TEXT,
    win_probability REAL DEFAULT 50,
    assigned_to TEXT,
    response_doc_url TEXT,
    decision_date TEXT,
    outcome TEXT,
    feedback TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // F150 — win_loss_analysis
  `CREATE TABLE IF NOT EXISTS win_loss_analysis (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    deal_id TEXT NOT NULL,
    outcome TEXT NOT NULL,
    primary_reason TEXT,
    secondary_reasons TEXT,
    competitor TEXT,
    price_pressure INTEGER DEFAULT 0,
    feature_gap TEXT,
    customer_feedback TEXT,
    lessons_learned TEXT,
    analyzed_by TEXT,
    analyzed_at TEXT DEFAULT (datetime('now'))
  )`,
  // ─── Batch 10: Compliance, Security, API (F151-F170) ───
  // F151 — data_retention_policies
  `CREATE TABLE IF NOT EXISTS data_retention_policies (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    policy_name TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    retention_days INTEGER DEFAULT 2555,
    action_after_retention TEXT DEFAULT 'archive',
    legal_basis TEXT,
    is_active INTEGER DEFAULT 1,
    last_applied_at TEXT,
    records_affected_last_run INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // F152 — data_subject_requests (DSR / GDPR-style)
  `CREATE TABLE IF NOT EXISTS data_subject_requests (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    request_type TEXT NOT NULL,
    subject_type TEXT,
    subject_id TEXT,
    subject_email TEXT,
    requested_at TEXT DEFAULT (datetime('now')),
    requested_by TEXT,
    status TEXT DEFAULT 'received',
    response_due_date TEXT,
    completed_at TEXT,
    fulfilled_by TEXT,
    export_path TEXT,
    notes TEXT,
    verification_method TEXT
  )`,
  // F153 — anonymization_log (audit of personal-data scrubs)
  `CREATE TABLE IF NOT EXISTS anonymization_log (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    subject_type TEXT,
    subject_id TEXT,
    fields_anonymized TEXT,
    performed_by TEXT,
    performed_at TEXT DEFAULT (datetime('now')),
    reason TEXT,
    dsr_id TEXT
  )`,
  // F154 — entity_audit_history (per-record change log)
  `CREATE TABLE IF NOT EXISTS entity_audit_history (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL,
    user_id TEXT,
    user_email TEXT,
    changes_json TEXT,
    ip_address TEXT,
    user_agent TEXT,
    occurred_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_eah_entity ON entity_audit_history(company_id, entity_type, entity_id)",
  // F155 — user_session_log
  `CREATE TABLE IF NOT EXISTS user_session_log (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    user_email TEXT,
    session_token TEXT,
    login_at TEXT DEFAULT (datetime('now')),
    logout_at TEXT,
    ip_address TEXT,
    user_agent TEXT,
    location_country TEXT,
    location_region TEXT,
    device_fingerprint TEXT,
    login_method TEXT,
    suspicious INTEGER DEFAULT 0,
    suspicious_reason TEXT,
    company_id TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_usl_user ON user_session_log(user_id, login_at)",
  // F156 — ip_access_whitelist
  `CREATE TABLE IF NOT EXISTS ip_access_whitelist (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    cidr_or_ip TEXT NOT NULL,
    label TEXT,
    added_by TEXT,
    is_active INTEGER DEFAULT 1,
    expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F157 — user_2fa
  `CREATE TABLE IF NOT EXISTS user_2fa (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    method TEXT DEFAULT 'totp',
    secret TEXT,
    is_enabled INTEGER DEFAULT 0,
    backup_codes TEXT,
    enabled_at TEXT,
    last_verified_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id)
  )`,
  // F158 — api_tokens
  `CREATE TABLE IF NOT EXISTS api_tokens (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    token_prefix TEXT,
    scopes TEXT DEFAULT '[]',
    issued_by TEXT,
    issued_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT,
    last_used_at TEXT,
    usage_count INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    revoked_at TEXT
  )`,
  // F159 — api_rate_limits
  `CREATE TABLE IF NOT EXISTS api_rate_limits (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    token_id TEXT,
    endpoint_pattern TEXT,
    requests_per_minute INTEGER DEFAULT 60,
    requests_per_day INTEGER DEFAULT 10000,
    burst_size INTEGER DEFAULT 10,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS api_request_log (
    id TEXT PRIMARY KEY,
    company_id TEXT,
    token_id TEXT,
    endpoint TEXT,
    method TEXT,
    status_code INTEGER,
    duration_ms INTEGER,
    ip_address TEXT,
    requested_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_arl_token_time ON api_request_log(token_id, requested_at)",
  // F160 — webhook_secret_rotations
  `CREATE TABLE IF NOT EXISTS webhook_secret_rotations (
    id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL,
    rotated_at TEXT DEFAULT (datetime('now')),
    rotated_by TEXT,
    old_secret_hash TEXT,
    new_secret_hash TEXT,
    reason TEXT
  )`,
  // F161 — pci_checklist_items
  `CREATE TABLE IF NOT EXISTS pci_checklist_items (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    requirement_number TEXT,
    requirement_text TEXT NOT NULL,
    sub_requirement TEXT,
    status TEXT DEFAULT 'not_applicable',
    evidence_path TEXT,
    last_assessed_at TEXT,
    next_assessment_due TEXT,
    assessor TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // F162 — soc2_controls
  `CREATE TABLE IF NOT EXISTS soc2_controls (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    trust_principle TEXT,
    control_id TEXT,
    control_description TEXT NOT NULL,
    implementation_status TEXT DEFAULT 'planned',
    owner TEXT,
    test_frequency TEXT DEFAULT 'annual',
    last_test_date TEXT,
    last_test_result TEXT,
    next_test_due TEXT,
    evidence_path TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // F163 — data_masking_rules
  `CREATE TABLE IF NOT EXISTS data_masking_rules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    field_path TEXT NOT NULL,
    mask_type TEXT DEFAULT 'full',
    visible_chars INTEGER DEFAULT 4,
    replacement_char TEXT DEFAULT '*',
    applies_to_roles TEXT,
    is_active INTEGER DEFAULT 1,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F164 — rtbf_requests (right-to-be-forgotten)
  `CREATE TABLE IF NOT EXISTS rtbf_requests (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    subject_email TEXT NOT NULL,
    subject_id TEXT,
    requested_at TEXT DEFAULT (datetime('now')),
    verification_method TEXT,
    verified_at TEXT,
    status TEXT DEFAULT 'pending',
    records_deleted_count INTEGER DEFAULT 0,
    records_anonymized_count INTEGER DEFAULT 0,
    records_retained_count INTEGER DEFAULT 0,
    retention_reason TEXT,
    completed_at TEXT,
    fulfilled_by TEXT,
    notes TEXT
  )`,
  // F165 — consent_records
  `CREATE TABLE IF NOT EXISTS consent_records (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    subject_type TEXT,
    subject_id TEXT,
    subject_email TEXT,
    consent_type TEXT NOT NULL,
    consent_version TEXT,
    granted INTEGER DEFAULT 1,
    granted_at TEXT DEFAULT (datetime('now')),
    withdrawn_at TEXT,
    ip_address TEXT,
    user_agent TEXT,
    proof_text TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_consent_subject ON consent_records(company_id, subject_id, consent_type)",
  // F166 — sub_processors
  `CREATE TABLE IF NOT EXISTS sub_processors (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    processor_name TEXT NOT NULL,
    processor_role TEXT,
    data_categories TEXT,
    location TEXT,
    transfer_mechanism TEXT,
    contract_url TEXT,
    dpa_signed_date TEXT,
    risk_rating TEXT DEFAULT 'low',
    review_frequency TEXT DEFAULT 'annual',
    last_review_date TEXT,
    next_review_due TEXT,
    is_active INTEGER DEFAULT 1,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // F167 — data_classifications
  `CREATE TABLE IF NOT EXISTS data_classifications (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    table_name TEXT NOT NULL,
    column_name TEXT,
    sensitivity_level TEXT DEFAULT 'internal',
    is_pii INTEGER DEFAULT 0,
    is_phi INTEGER DEFAULT 0,
    is_pci INTEGER DEFAULT 0,
    encryption_required INTEGER DEFAULT 0,
    access_restrictions TEXT,
    retention_class TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F168 — encryption_verification_log
  `CREATE TABLE IF NOT EXISTS encryption_verification_log (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    scope TEXT NOT NULL,
    verified_at TEXT DEFAULT (datetime('now')),
    verified_by TEXT,
    algorithm TEXT,
    key_id TEXT,
    is_compliant INTEGER DEFAULT 1,
    issues TEXT,
    notes TEXT
  )`,
  // F169 — backup_verification_log
  `CREATE TABLE IF NOT EXISTS backup_verification_log (
    id TEXT PRIMARY KEY,
    company_id TEXT,
    backup_type TEXT,
    backup_path TEXT,
    backup_size_bytes INTEGER DEFAULT 0,
    backup_date TEXT,
    verified_at TEXT DEFAULT (datetime('now')),
    verification_method TEXT,
    is_valid INTEGER DEFAULT 1,
    can_restore INTEGER DEFAULT 1,
    notes TEXT
  )`,
  // F170 — vulnerabilities
  `CREATE TABLE IF NOT EXISTS vulnerabilities (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    cve_id TEXT,
    title TEXT NOT NULL,
    severity TEXT DEFAULT 'medium',
    cvss_score REAL,
    affected_component TEXT,
    discovered_date TEXT,
    discovered_by TEXT,
    status TEXT DEFAULT 'open',
    remediation_plan TEXT,
    assigned_to TEXT,
    target_remediation_date TEXT,
    actual_remediation_date TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,

  // ═══════════════════════════════════════════════════════════════════
  //   ACCOUNTING DEEP-DIVE: 90 features (F171-F260)
  //   Batches A-I covering GL, COA, period close, fixed assets advanced,
  //   revenue recognition, cost accounting, audit, budgeting, financial
  //   statements + analysis.
  // ═══════════════════════════════════════════════════════════════════

  // ─── Batch A: GL & JE Operations (F171-F185) ───────────
  // F171 — recurring journal entries
  `CREATE TABLE IF NOT EXISTS recurring_je_definitions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    frequency TEXT DEFAULT 'monthly',
    start_date TEXT NOT NULL,
    end_date TEXT,
    next_run_date TEXT NOT NULL,
    last_run_date TEXT,
    template_lines_json TEXT DEFAULT '[]',
    auto_post INTEGER DEFAULT 0,
    is_paused INTEGER DEFAULT 0,
    run_count INTEGER DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    created_by TEXT
  )`,
  // F172 — reversing JE link (already-posted JE has a flag + linked reversal JE)
  "ALTER TABLE journal_entries ADD COLUMN is_reversing INTEGER DEFAULT 0",
  "ALTER TABLE journal_entries ADD COLUMN reversing_je_id TEXT",
  "ALTER TABLE journal_entries ADD COLUMN reverse_on_date TEXT",
  "ALTER TABLE journal_entries ADD COLUMN reversed_at TEXT",
  // F173 — JE templates
  `CREATE TABLE IF NOT EXISTS je_templates (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT DEFAULT 'general',
    lines_json TEXT DEFAULT '[]',
    is_active INTEGER DEFAULT 1,
    use_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // F174 — JE currency support
  "ALTER TABLE journal_entries ADD COLUMN currency TEXT DEFAULT 'USD'",
  "ALTER TABLE journal_entries ADD COLUMN exchange_rate REAL DEFAULT 1.0",
  "ALTER TABLE journal_entries ADD COLUMN fx_gain_loss_account_id TEXT",
  // F175 — inter-company JE pairing
  `CREATE TABLE IF NOT EXISTS inter_company_je_pairs (
    id TEXT PRIMARY KEY,
    parent_je_id TEXT NOT NULL,
    counterparty_je_id TEXT NOT NULL,
    parent_company_id TEXT NOT NULL,
    counterparty_company_id TEXT NOT NULL,
    paired_date TEXT DEFAULT (datetime('now')),
    notes TEXT
  )`,
  // F176 — JE bulk import session
  `CREATE TABLE IF NOT EXISTS je_import_sessions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    file_name TEXT,
    row_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    errors_json TEXT DEFAULT '[]',
    imported_at TEXT DEFAULT (datetime('now')),
    imported_by TEXT
  )`,
  // F180 — JE allocation rules
  `CREATE TABLE IF NOT EXISTS je_allocation_rules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    source_account_id TEXT,
    allocation_method TEXT DEFAULT 'percent',
    targets_json TEXT DEFAULT '[]',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // F182 — JE narrative templates
  `CREATE TABLE IF NOT EXISTS je_narratives (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    template_text TEXT NOT NULL,
    use_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, slug)
  )`,
  // F178 — JE attachments
  `CREATE TABLE IF NOT EXISTS je_attachments (
    id TEXT PRIMARY KEY,
    je_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT,
    mime_type TEXT,
    file_size INTEGER DEFAULT 0,
    uploaded_at TEXT DEFAULT (datetime('now')),
    uploaded_by TEXT
  )`,

  // ─── Batch B: Chart of Accounts (F186-F195) ───────────
  // F186 — account hierarchy (already has parent_id on accounts presumably; ensure)
  "ALTER TABLE accounts ADD COLUMN parent_account_id TEXT",
  "ALTER TABLE accounts ADD COLUMN level_depth INTEGER DEFAULT 0",
  "ALTER TABLE accounts ADD COLUMN roll_up_to_id TEXT",
  // F188 — account renumber log
  `CREATE TABLE IF NOT EXISTS account_renumber_log (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    old_code TEXT,
    new_code TEXT,
    renamed_by TEXT,
    renamed_at TEXT DEFAULT (datetime('now')),
    notes TEXT
  )`,
  // F190 — suspense account designation
  "ALTER TABLE accounts ADD COLUMN is_suspense INTEGER DEFAULT 0",
  // F191 — account close (use is_active flag if exists; add closed_at)
  "ALTER TABLE accounts ADD COLUMN closed_at TEXT",
  "ALTER TABLE accounts ADD COLUMN closed_reason TEXT",
  // F192 — account-to-tax-line mapping
  "ALTER TABLE accounts ADD COLUMN tax_line_code TEXT",
  "ALTER TABLE accounts ADD COLUMN tax_form TEXT",
  // F193 — account-to-cash-flow mapping
  "ALTER TABLE accounts ADD COLUMN cash_flow_section TEXT",
  "ALTER TABLE accounts ADD COLUMN cash_flow_subsection TEXT",
  // F195 — opening balances import
  `CREATE TABLE IF NOT EXISTS opening_balances (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    as_of_date TEXT NOT NULL,
    debit_balance REAL DEFAULT 0,
    credit_balance REAL DEFAULT 0,
    fiscal_year INTEGER,
    notes TEXT,
    imported_at TEXT DEFAULT (datetime('now')),
    posted_je_id TEXT,
    UNIQUE(company_id, account_id, as_of_date)
  )`,

  // ─── Batch C: Period Close + Adjustments (F196-F205) ───
  // F196 — period_close_checklist already exists; extend with template
  `CREATE TABLE IF NOT EXISTS period_close_templates (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    period_type TEXT DEFAULT 'monthly',
    tasks_json TEXT DEFAULT '[]',
    is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // F197 — accrual entries (separate workflow)
  `CREATE TABLE IF NOT EXISTS accrual_entries (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    accrual_type TEXT DEFAULT 'expense',
    description TEXT NOT NULL,
    accrual_date TEXT NOT NULL,
    reverse_date TEXT,
    amount REAL DEFAULT 0,
    debit_account_id TEXT,
    credit_account_id TEXT,
    posted_je_id TEXT,
    reversal_je_id TEXT,
    is_reversed INTEGER DEFAULT 0,
    status TEXT DEFAULT 'draft',
    supporting_doc TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    created_by TEXT
  )`,
  // F199 — prepaid amortization
  `CREATE TABLE IF NOT EXISTS prepaid_schedules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    description TEXT NOT NULL,
    vendor_id TEXT,
    total_amount REAL DEFAULT 0,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    amortization_periods INTEGER DEFAULT 12,
    period_amount REAL DEFAULT 0,
    prepaid_account_id TEXT,
    expense_account_id TEXT,
    status TEXT DEFAULT 'active',
    periods_recognized INTEGER DEFAULT 0,
    next_recognition_date TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS prepaid_recognitions (
    id TEXT PRIMARY KEY,
    schedule_id TEXT NOT NULL REFERENCES prepaid_schedules(id) ON DELETE CASCADE,
    recognition_date TEXT NOT NULL,
    amount REAL DEFAULT 0,
    posted_je_id TEXT,
    posted_at TEXT DEFAULT (datetime('now'))
  )`,
  // F200 — deferred revenue amortization
  `CREATE TABLE IF NOT EXISTS deferred_revenue_schedules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    description TEXT NOT NULL,
    client_id TEXT,
    invoice_id TEXT,
    total_amount REAL DEFAULT 0,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    recognition_periods INTEGER DEFAULT 12,
    period_amount REAL DEFAULT 0,
    deferred_account_id TEXT,
    revenue_account_id TEXT,
    status TEXT DEFAULT 'active',
    periods_recognized INTEGER DEFAULT 0,
    next_recognition_date TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS deferred_revenue_recognitions (
    id TEXT PRIMARY KEY,
    schedule_id TEXT NOT NULL REFERENCES deferred_revenue_schedules(id) ON DELETE CASCADE,
    recognition_date TEXT NOT NULL,
    amount REAL DEFAULT 0,
    posted_je_id TEXT,
    posted_at TEXT DEFAULT (datetime('now'))
  )`,
  // F205 — year-end closing entries
  `CREATE TABLE IF NOT EXISTS year_end_close_runs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    fiscal_year INTEGER NOT NULL,
    closed_at TEXT DEFAULT (datetime('now')),
    closed_by TEXT,
    retained_earnings_account_id TEXT,
    income_summary_account_id TEXT,
    net_income REAL DEFAULT 0,
    closing_je_id TEXT,
    notes TEXT,
    UNIQUE(company_id, fiscal_year)
  )`,

  // ─── Batch D: Fixed Assets Advanced (F206-F215) ───────
  // F206 — disposal log
  `CREATE TABLE IF NOT EXISTS asset_disposals (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    disposal_date TEXT NOT NULL,
    disposal_method TEXT DEFAULT 'sale',
    proceeds REAL DEFAULT 0,
    book_value_at_disposal REAL DEFAULT 0,
    gain_loss REAL DEFAULT 0,
    accumulated_depreciation REAL DEFAULT 0,
    posted_je_id TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    created_by TEXT
  )`,
  // F207 — transfers
  `CREATE TABLE IF NOT EXISTS asset_transfers (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    transfer_date TEXT NOT NULL,
    from_location TEXT,
    to_location TEXT,
    from_cost_center TEXT,
    to_cost_center TEXT,
    transferred_by TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F209 — impairment
  `CREATE TABLE IF NOT EXISTS asset_impairments (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    impairment_date TEXT NOT NULL,
    pre_impairment_value REAL DEFAULT 0,
    recoverable_amount REAL DEFAULT 0,
    impairment_loss REAL DEFAULT 0,
    reason TEXT,
    posted_je_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    created_by TEXT
  )`,
  // F210 — revaluation
  `CREATE TABLE IF NOT EXISTS asset_revaluations (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    revaluation_date TEXT NOT NULL,
    old_value REAL DEFAULT 0,
    new_value REAL DEFAULT 0,
    revaluation_surplus REAL DEFAULT 0,
    method TEXT,
    appraised_by TEXT,
    posted_je_id TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F212 — asset retirement obligations
  `CREATE TABLE IF NOT EXISTS asset_retirement_obligations (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    obligation_date TEXT NOT NULL,
    estimated_cost REAL DEFAULT 0,
    discount_rate REAL DEFAULT 0,
    settlement_date TEXT,
    present_value REAL DEFAULT 0,
    accretion_expense_to_date REAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F213 — asset insurance
  `CREATE TABLE IF NOT EXISTS asset_insurance (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    policy_number TEXT,
    carrier TEXT,
    coverage_amount REAL DEFAULT 0,
    annual_premium REAL DEFAULT 0,
    deductible REAL DEFAULT 0,
    effective_date TEXT,
    expiry_date TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // F214 — asset warranties
  `CREATE TABLE IF NOT EXISTS asset_warranties (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    warranty_provider TEXT,
    warranty_type TEXT DEFAULT 'standard',
    start_date TEXT,
    end_date TEXT,
    coverage_description TEXT,
    contact_info TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F215 — depreciation convention column
  "ALTER TABLE fixed_assets ADD COLUMN depreciation_convention TEXT DEFAULT 'full_month'",
  "ALTER TABLE fixed_assets ADD COLUMN component_parent_id TEXT",

  // ─── Batch E: Revenue Recognition (F216-F225) ─────────
  // F216 — ASC 606 contracts + performance obligations
  `CREATE TABLE IF NOT EXISTS revenue_contracts (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    client_id TEXT,
    contract_number TEXT,
    contract_name TEXT NOT NULL,
    contract_date TEXT,
    effective_date TEXT,
    end_date TEXT,
    total_contract_value REAL DEFAULT 0,
    payment_terms TEXT,
    status TEXT DEFAULT 'active',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS performance_obligations (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL REFERENCES revenue_contracts(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    standalone_selling_price REAL DEFAULT 0,
    allocated_amount REAL DEFAULT 0,
    recognition_pattern TEXT DEFAULT 'point_in_time',
    start_date TEXT,
    end_date TEXT,
    status TEXT DEFAULT 'pending',
    revenue_recognized REAL DEFAULT 0,
    revenue_account_id TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F217 — contract modifications log
  `CREATE TABLE IF NOT EXISTS contract_modifications (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL REFERENCES revenue_contracts(id) ON DELETE CASCADE,
    modification_date TEXT NOT NULL,
    modification_type TEXT,
    value_change REAL DEFAULT 0,
    scope_change TEXT,
    accounting_treatment TEXT,
    notes TEXT,
    approved_by TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F218 — SSP tracking
  `CREATE TABLE IF NOT EXISTS standalone_selling_prices (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    product_or_service TEXT NOT NULL,
    ssp_value REAL DEFAULT 0,
    ssp_method TEXT DEFAULT 'observable',
    effective_from TEXT,
    effective_to TEXT,
    range_low REAL,
    range_high REAL,
    last_validated TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F219 — variable consideration
  `CREATE TABLE IF NOT EXISTS variable_consideration_adjustments (
    id TEXT PRIMARY KEY,
    contract_id TEXT NOT NULL REFERENCES revenue_contracts(id) ON DELETE CASCADE,
    obligation_id TEXT,
    adjustment_type TEXT,
    estimated_amount REAL DEFAULT 0,
    estimation_method TEXT,
    constraint_applied INTEGER DEFAULT 0,
    constraint_amount REAL DEFAULT 0,
    as_of_date TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F220 — milestone-based revenue release
  `CREATE TABLE IF NOT EXISTS revenue_milestones (
    id TEXT PRIMARY KEY,
    obligation_id TEXT NOT NULL,
    milestone_name TEXT NOT NULL,
    target_date TEXT,
    completion_date TEXT,
    amount_to_release REAL DEFAULT 0,
    status TEXT DEFAULT 'pending',
    posted_je_id TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F223 — returns reserve
  `CREATE TABLE IF NOT EXISTS returns_reserves (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    historical_return_rate REAL DEFAULT 0,
    revenue_in_period REAL DEFAULT 0,
    reserve_amount REAL DEFAULT 0,
    posted_je_id TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F224 — rebate accruals
  `CREATE TABLE IF NOT EXISTS rebate_accruals (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    program_name TEXT NOT NULL,
    customer_id TEXT,
    accrual_period_start TEXT,
    accrual_period_end TEXT,
    sales_basis REAL DEFAULT 0,
    rebate_rate REAL DEFAULT 0,
    accrued_amount REAL DEFAULT 0,
    paid_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'accruing',
    posted_je_id TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F225 — sales commissions deferral (ASC 340-40)
  `CREATE TABLE IF NOT EXISTS commission_deferrals (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    rep_id TEXT,
    contract_id TEXT,
    commission_amount REAL DEFAULT 0,
    capitalized_amount REAL DEFAULT 0,
    amortization_period_months INTEGER DEFAULT 36,
    start_date TEXT,
    period_amount REAL DEFAULT 0,
    amortized_to_date REAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    deferred_asset_account_id TEXT,
    expense_account_id TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  // ─── Batch F: Cost Accounting (F226-F235) ─────────────
  // F226 — cost centers
  `CREATE TABLE IF NOT EXISTS cost_centers (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    parent_id TEXT,
    manager TEXT,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    UNIQUE(company_id, code)
  )`,
  // F227 — cost center allocation rules
  `CREATE TABLE IF NOT EXISTS cost_allocation_rules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    rule_name TEXT NOT NULL,
    source_cost_center_id TEXT,
    source_account_id TEXT,
    allocation_method TEXT DEFAULT 'percent',
    targets_json TEXT DEFAULT '[]',
    is_active INTEGER DEFAULT 1,
    run_frequency TEXT DEFAULT 'monthly',
    last_run_date TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // F228 — departments
  `CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    manager_id TEXT,
    parent_id TEXT,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    UNIQUE(company_id, code)
  )`,
  // F229 — ABC pools
  `CREATE TABLE IF NOT EXISTS activity_cost_pools (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    pool_name TEXT NOT NULL,
    cost_driver TEXT,
    total_cost REAL DEFAULT 0,
    total_driver_units REAL DEFAULT 0,
    rate REAL DEFAULT 0,
    period_start TEXT,
    period_end TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F230 — standard costs
  `CREATE TABLE IF NOT EXISTS standard_costs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    item_id TEXT,
    cost_category TEXT,
    standard_unit_cost REAL DEFAULT 0,
    effective_from TEXT,
    effective_to TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // F231 — variance analysis
  `CREATE TABLE IF NOT EXISTS cost_variance_analyses (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    item_id TEXT,
    standard_quantity REAL DEFAULT 0,
    actual_quantity REAL DEFAULT 0,
    standard_price REAL DEFAULT 0,
    actual_price REAL DEFAULT 0,
    price_variance REAL DEFAULT 0,
    quantity_variance REAL DEFAULT 0,
    total_variance REAL DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F232 — overhead absorption
  `CREATE TABLE IF NOT EXISTS overhead_rates (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    rate_name TEXT NOT NULL,
    cost_pool_id TEXT,
    basis TEXT DEFAULT 'labor_hours',
    rate_per_unit REAL DEFAULT 0,
    effective_from TEXT,
    effective_to TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F233 — WIP tracking
  `CREATE TABLE IF NOT EXISTS work_in_process (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    job_number TEXT,
    project_id TEXT,
    started_at TEXT,
    completed_at TEXT,
    materials_cost REAL DEFAULT 0,
    labor_cost REAL DEFAULT 0,
    overhead_cost REAL DEFAULT 0,
    total_wip REAL DEFAULT 0,
    status TEXT DEFAULT 'in_process',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // F235 — burden rates
  `CREATE TABLE IF NOT EXISTS burden_rates (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_class TEXT,
    base_hourly_rate REAL DEFAULT 0,
    burden_rate_percent REAL DEFAULT 0,
    fully_loaded_rate REAL DEFAULT 0,
    effective_from TEXT,
    effective_to TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  // ─── Batch G: Audit & Controls (F236-F245) ─────────────
  // F236 — TB comparison snapshots
  `CREATE TABLE IF NOT EXISTS tb_comparison_snapshots (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    period_end TEXT NOT NULL,
    fiscal_year INTEGER,
    snapshot_data TEXT DEFAULT '[]',
    total_debit REAL DEFAULT 0,
    total_credit REAL DEFAULT 0,
    is_balanced INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, period_end)
  )`,
  // F237 — materiality calculations
  `CREATE TABLE IF NOT EXISTS materiality_calcs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    fiscal_year INTEGER NOT NULL,
    benchmark_type TEXT DEFAULT 'pretax_income',
    benchmark_amount REAL DEFAULT 0,
    materiality_percent REAL DEFAULT 5,
    overall_materiality REAL DEFAULT 0,
    performance_materiality REAL DEFAULT 0,
    trivial_threshold REAL DEFAULT 0,
    rationale TEXT,
    determined_by TEXT,
    determined_at TEXT DEFAULT (datetime('now'))
  )`,
  // F238 — audit samples
  `CREATE TABLE IF NOT EXISTS audit_samples (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    population_description TEXT NOT NULL,
    population_size INTEGER DEFAULT 0,
    sample_size INTEGER DEFAULT 0,
    sampling_method TEXT DEFAULT 'random',
    stratification TEXT,
    selected_items_json TEXT DEFAULT '[]',
    auditor TEXT,
    test_date TEXT,
    results_summary TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F239 — audit confirmations
  `CREATE TABLE IF NOT EXISTS audit_confirmations (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    confirmation_type TEXT DEFAULT 'ar',
    third_party_name TEXT NOT NULL,
    third_party_contact TEXT,
    balance_per_books REAL DEFAULT 0,
    balance_confirmed REAL DEFAULT 0,
    confirmation_date TEXT,
    sent_date TEXT,
    response_received_date TEXT,
    response_method TEXT,
    discrepancy REAL DEFAULT 0,
    resolution TEXT,
    status TEXT DEFAULT 'pending',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F240 — walkthroughs
  `CREATE TABLE IF NOT EXISTS audit_walkthroughs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    process_name TEXT NOT NULL,
    walked_by TEXT,
    walkthrough_date TEXT,
    process_owner TEXT,
    inputs TEXT,
    activities TEXT,
    outputs TEXT,
    risks_identified TEXT,
    controls_identified TEXT,
    deficiencies_noted TEXT,
    document_path TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F241 — SoD matrix
  `CREATE TABLE IF NOT EXISTS sod_conflicts (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    conflicting_function_a TEXT NOT NULL,
    conflicting_function_b TEXT NOT NULL,
    risk_level TEXT DEFAULT 'medium',
    mitigation_required TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS sod_user_assignments (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    function_code TEXT NOT NULL,
    granted_at TEXT DEFAULT (datetime('now')),
    granted_by TEXT
  )`,
  // F242 — RCSA
  `CREATE TABLE IF NOT EXISTS rcsa_assessments (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    assessment_name TEXT NOT NULL,
    process_area TEXT,
    risk_description TEXT,
    inherent_likelihood TEXT DEFAULT 'medium',
    inherent_impact TEXT DEFAULT 'medium',
    control_description TEXT,
    residual_likelihood TEXT DEFAULT 'low',
    residual_impact TEXT DEFAULT 'low',
    action_plan TEXT,
    owner TEXT,
    assessment_date TEXT,
    next_review_date TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F243 — audit issues
  `CREATE TABLE IF NOT EXISTS audit_issues (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    issue_number TEXT,
    title TEXT NOT NULL,
    severity TEXT DEFAULT 'medium',
    category TEXT,
    description TEXT,
    root_cause TEXT,
    recommendation TEXT,
    management_response TEXT,
    assigned_to TEXT,
    target_resolution_date TEXT,
    status TEXT DEFAULT 'open',
    resolved_at TEXT,
    resolution_notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // F244 — control deficiencies
  `CREATE TABLE IF NOT EXISTS control_deficiencies (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    control_reference TEXT,
    deficiency_type TEXT DEFAULT 'design',
    severity TEXT DEFAULT 'significant',
    description TEXT NOT NULL,
    impact TEXT,
    identified_date TEXT,
    identified_by TEXT,
    status TEXT DEFAULT 'open',
    remediation_plan TEXT,
    remediated_at TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F245 — auditor inquiry log
  `CREATE TABLE IF NOT EXISTS auditor_inquiries (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    auditor_firm TEXT,
    auditor_contact TEXT,
    inquiry_date TEXT,
    inquiry_subject TEXT NOT NULL,
    inquiry_text TEXT,
    response_text TEXT,
    response_date TEXT,
    response_by TEXT,
    supporting_docs TEXT,
    status TEXT DEFAULT 'open',
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  // ─── Batch H: Budgeting & Forecasting Advanced (F246-F255) ───
  // F246 — rolling forecasts
  `CREATE TABLE IF NOT EXISTS rolling_forecasts (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    forecast_name TEXT NOT NULL,
    horizon_months INTEGER DEFAULT 12,
    base_period TEXT NOT NULL,
    last_refreshed_at TEXT,
    refresh_frequency TEXT DEFAULT 'monthly',
    methodology TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS rolling_forecast_lines (
    id TEXT PRIMARY KEY,
    forecast_id TEXT NOT NULL REFERENCES rolling_forecasts(id) ON DELETE CASCADE,
    account_id TEXT,
    period_month TEXT NOT NULL,
    forecasted_amount REAL DEFAULT 0,
    actual_amount REAL,
    variance REAL DEFAULT 0,
    notes TEXT
  )`,
  // F247 — what-if scenarios
  `CREATE TABLE IF NOT EXISTS scenario_models (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    scenario_name TEXT NOT NULL,
    base_forecast_id TEXT,
    assumptions_json TEXT DEFAULT '{}',
    projected_revenue REAL DEFAULT 0,
    projected_expenses REAL DEFAULT 0,
    projected_net_income REAL DEFAULT 0,
    is_baseline INTEGER DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    created_by TEXT
  )`,
  // F248 — variance explanations
  `CREATE TABLE IF NOT EXISTS variance_explanations (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    period_month TEXT NOT NULL,
    account_id TEXT,
    budgeted_amount REAL DEFAULT 0,
    actual_amount REAL DEFAULT 0,
    variance REAL DEFAULT 0,
    variance_percent REAL DEFAULT 0,
    explanation TEXT,
    explained_by TEXT,
    explained_at TEXT,
    is_material INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F249 — driver-based budgets
  `CREATE TABLE IF NOT EXISTS budget_drivers (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    driver_name TEXT NOT NULL,
    driver_type TEXT DEFAULT 'units',
    base_value REAL DEFAULT 0,
    rate_per_unit REAL DEFAULT 0,
    affected_account_ids TEXT,
    period_start TEXT,
    period_end TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F250 — budget consolidation
  `CREATE TABLE IF NOT EXISTS budget_consolidations (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    consolidation_name TEXT NOT NULL,
    consolidation_type TEXT DEFAULT 'bottom_up',
    fiscal_year INTEGER,
    source_budget_ids TEXT,
    consolidated_total REAL DEFAULT 0,
    status TEXT DEFAULT 'draft',
    approved_at TEXT,
    approved_by TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F251 — budget approval workflow
  `CREATE TABLE IF NOT EXISTS budget_approvals (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    budget_id TEXT NOT NULL,
    step_number INTEGER DEFAULT 1,
    approver TEXT,
    action TEXT,
    acted_at TEXT,
    comment TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F252 — forecast accuracy
  `CREATE TABLE IF NOT EXISTS forecast_accuracy (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    forecast_id TEXT,
    period_month TEXT NOT NULL,
    forecasted_amount REAL DEFAULT 0,
    actual_amount REAL DEFAULT 0,
    absolute_error REAL DEFAULT 0,
    percent_error REAL DEFAULT 0,
    mape REAL DEFAULT 0,
    bias REAL DEFAULT 0,
    measured_at TEXT DEFAULT (datetime('now'))
  )`,
  // F253 — direct method cash forecast
  `CREATE TABLE IF NOT EXISTS direct_cash_forecasts (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    forecast_date TEXT NOT NULL,
    week_ending TEXT NOT NULL,
    opening_balance REAL DEFAULT 0,
    cash_in_collections REAL DEFAULT 0,
    cash_in_other REAL DEFAULT 0,
    cash_out_payroll REAL DEFAULT 0,
    cash_out_payables REAL DEFAULT 0,
    cash_out_tax REAL DEFAULT 0,
    cash_out_other REAL DEFAULT 0,
    closing_balance REAL DEFAULT 0,
    minimum_balance_buffer REAL DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F254 — headcount budget
  `CREATE TABLE IF NOT EXISTS headcount_budgets (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    department_id TEXT,
    fiscal_year INTEGER NOT NULL,
    period_month TEXT,
    role TEXT,
    budgeted_count INTEGER DEFAULT 0,
    actual_count INTEGER DEFAULT 0,
    avg_salary REAL DEFAULT 0,
    benefits_rate REAL DEFAULT 0,
    total_budget_cost REAL DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F255 — CapEx planning
  `CREATE TABLE IF NOT EXISTS capex_plans (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    project_name TEXT NOT NULL,
    category TEXT DEFAULT 'equipment',
    department_id TEXT,
    estimated_cost REAL DEFAULT 0,
    approved_cost REAL DEFAULT 0,
    actual_cost REAL DEFAULT 0,
    requested_date TEXT,
    target_start_date TEXT,
    target_completion_date TEXT,
    actual_completion_date TEXT,
    approval_status TEXT DEFAULT 'requested',
    approved_by TEXT,
    business_justification TEXT,
    expected_roi REAL,
    payback_period_months INTEGER,
    asset_id TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,

  // ─── Batch I: Financial Statements + Analysis (F256-F260) ───
  // F256 — comparative statements config
  `CREATE TABLE IF NOT EXISTS financial_statement_configs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    config_name TEXT NOT NULL,
    statement_type TEXT DEFAULT 'balance_sheet',
    periods_json TEXT DEFAULT '[]',
    display_options_json TEXT DEFAULT '{}',
    show_percent_change INTEGER DEFAULT 1,
    show_common_size INTEGER DEFAULT 0,
    is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // F258 — financial ratios
  `CREATE TABLE IF NOT EXISTS financial_ratios (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    as_of_date TEXT NOT NULL,
    current_ratio REAL,
    quick_ratio REAL,
    cash_ratio REAL,
    debt_to_equity REAL,
    debt_to_assets REAL,
    times_interest_earned REAL,
    asset_turnover REAL,
    inventory_turnover REAL,
    receivables_turnover REAL,
    gross_margin REAL,
    operating_margin REAL,
    net_margin REAL,
    return_on_assets REAL,
    return_on_equity REAL,
    working_capital REAL,
    fiscal_year INTEGER,
    period_label TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, as_of_date)
  )`,
  // F259 — KPI scorecard
  `CREATE TABLE IF NOT EXISTS kpi_scorecard (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    kpi_name TEXT NOT NULL,
    metric_type TEXT,
    current_value REAL DEFAULT 0,
    target_value REAL DEFAULT 0,
    threshold_red REAL,
    threshold_green REAL,
    direction TEXT DEFAULT 'higher_better',
    last_calculated_at TEXT,
    calculation_method TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // F260 — statement footnotes
  `CREATE TABLE IF NOT EXISTS statement_footnotes (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    fiscal_year INTEGER,
    statement_type TEXT,
    footnote_number INTEGER DEFAULT 1,
    title TEXT,
    content TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    is_published INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,

  // ═══════════════════════════════════════════════════════════════════
  //   DYNAMIC WAVE: 90 runtime functions (F261-F350)
  //   New supporting tables (most batches reuse existing infrastructure).
  // ═══════════════════════════════════════════════════════════════════

  // ─── Batch J: Global Search (F261-F270) ───────────────
  `CREATE TABLE IF NOT EXISTS search_history (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    company_id TEXT,
    query TEXT NOT NULL,
    result_count INTEGER DEFAULT 0,
    searched_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_search_hist_user ON search_history(user_id, searched_at DESC)",
  `CREATE TABLE IF NOT EXISTS recently_viewed_entities (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    company_id TEXT,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    entity_label TEXT,
    viewed_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_recent_user ON recently_viewed_entities(user_id, viewed_at DESC)",
  `CREATE TABLE IF NOT EXISTS pinned_entities (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    company_id TEXT,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    entity_label TEXT,
    pinned_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, entity_type, entity_id)
  )`,

  // ─── Batch K: Notifications & Alerts (F271-F280) ──────
  `CREATE TABLE IF NOT EXISTS notification_preferences (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    company_id TEXT,
    notification_type TEXT NOT NULL,
    channel TEXT DEFAULT 'in_app',
    is_enabled INTEGER DEFAULT 1,
    quiet_hours_start TEXT,
    quiet_hours_end TEXT,
    UNIQUE(user_id, notification_type, channel)
  )`,
  `CREATE TABLE IF NOT EXISTS alert_rules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    entity_type TEXT,
    criteria_json TEXT NOT NULL,
    action_type TEXT DEFAULT 'notify',
    action_config_json TEXT DEFAULT '{}',
    is_active INTEGER DEFAULT 1,
    last_fired_at TEXT,
    fire_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // notifications table already exists; add snooze + escalation columns
  "ALTER TABLE notifications ADD COLUMN snoozed_until TEXT",
  "ALTER TABLE notifications ADD COLUMN escalated_at TEXT",
  "ALTER TABLE notifications ADD COLUMN escalation_count INTEGER DEFAULT 0",

  // ─── Batch L: Import / Export (F281-F290) ─────────────
  `CREATE TABLE IF NOT EXISTS import_templates (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    column_mapping_json TEXT NOT NULL,
    default_values_json TEXT DEFAULT '{}',
    is_active INTEGER DEFAULT 1,
    use_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS export_jobs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    job_name TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    format TEXT DEFAULT 'csv',
    filters_json TEXT DEFAULT '{}',
    schedule_cron TEXT,
    last_run_at TEXT,
    next_run_at TEXT,
    output_path TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,

  // ─── Batch M: Bulk Actions (F291-F300) ────────────────
  `CREATE TABLE IF NOT EXISTS bulk_undo_snapshots (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    user_id TEXT,
    operation_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_ids TEXT NOT NULL,
    original_data_json TEXT NOT NULL,
    changed_fields_json TEXT,
    is_undoable INTEGER DEFAULT 1,
    undo_expires_at TEXT,
    undone_at TEXT,
    performed_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_undo_co_perf ON bulk_undo_snapshots(company_id, performed_at DESC)",

  // ─── Batch N: Smart Helpers (F301-F310) ───────────────
  `CREATE TABLE IF NOT EXISTS smart_detections (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    detection_type TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    score REAL DEFAULT 0,
    severity TEXT DEFAULT 'info',
    reasoning_json TEXT DEFAULT '{}',
    dismissed_at TEXT,
    detected_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS vendor_canonicalizations (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    input_pattern TEXT NOT NULL,
    canonical_vendor_id TEXT NOT NULL,
    confidence REAL DEFAULT 1.0,
    match_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS recommendations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    recommendation_type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    action_url TEXT,
    priority INTEGER DEFAULT 50,
    dismissed_at TEXT,
    completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  // ─── Batch O: Keyboard & Macros (F311-F320) ───────────
  `CREATE TABLE IF NOT EXISTS workspace_layouts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    company_id TEXT,
    name TEXT NOT NULL,
    layout_json TEXT NOT NULL,
    is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS command_registry (
    id TEXT PRIMARY KEY,
    command_id TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    category TEXT,
    scope TEXT DEFAULT 'global',
    default_hotkey TEXT,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  // ─── Batch P: Report Engine (F321-F330) ───────────────
  `CREATE TABLE IF NOT EXISTS custom_reports (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    report_type TEXT DEFAULT 'tabular',
    definition_json TEXT NOT NULL,
    is_published INTEGER DEFAULT 0,
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS report_schedules (
    id TEXT PRIMARY KEY,
    report_id TEXT NOT NULL REFERENCES custom_reports(id) ON DELETE CASCADE,
    schedule_cron TEXT NOT NULL,
    recipients_json TEXT DEFAULT '[]',
    format TEXT DEFAULT 'pdf',
    is_active INTEGER DEFAULT 1,
    last_run_at TEXT,
    next_run_at TEXT,
    run_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS report_executions (
    id TEXT PRIMARY KEY,
    report_id TEXT NOT NULL,
    executed_at TEXT DEFAULT (datetime('now')),
    duration_ms INTEGER DEFAULT 0,
    row_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'success',
    output_path TEXT,
    error_message TEXT
  )`,

  // ─── Batch Q: Webhook Delivery (F331-F340) — reuses
  //     webhook_subscriptions + webhook_deliveries from F71-F90.
  //     Adds queue+retry tracking.
  `CREATE TABLE IF NOT EXISTS webhook_queue (
    id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    attempts INTEGER DEFAULT 0,
    next_attempt_at TEXT DEFAULT (datetime('now')),
    last_error TEXT,
    status TEXT DEFAULT 'queued',
    queued_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_webhook_q_status ON webhook_queue(status, next_attempt_at)",

  // ─── Batch R: Real-time + Activity (F341-F350) ────────
  `CREATE TABLE IF NOT EXISTS activity_feed (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    user_id TEXT,
    user_email TEXT,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    entity_label TEXT,
    metadata_json TEXT DEFAULT '{}',
    occurred_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_activity_co_time ON activity_feed(company_id, occurred_at DESC)",
  `CREATE TABLE IF NOT EXISTS entity_locks (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_email TEXT,
    locked_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    UNIQUE(entity_type, entity_id)
  )`,
  `CREATE TABLE IF NOT EXISTS user_presence (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    company_id TEXT,
    current_page TEXT,
    current_entity_type TEXT,
    current_entity_id TEXT,
    last_heartbeat_at TEXT DEFAULT (datetime('now'))
  )`,

  // ═══════════════════════════════════════════════════════════════════
  //   FEATURE EXPANSION WAVE 3: 90 features (F351-F440)
  //   Payroll, Sales Tax, Consolidation, Portals, Time, Documents,
  //   Collaboration, Integrations.
  // ═══════════════════════════════════════════════════════════════════

  // ─── Batch S: Payroll Deep-Dive (F351-F360) ───
  `CREATE TABLE IF NOT EXISTS state_withholding_tables (
    id TEXT PRIMARY KEY,
    state_code TEXT NOT NULL,
    filing_status TEXT NOT NULL,
    income_low REAL DEFAULT 0,
    income_high REAL DEFAULT 999999999,
    base_tax REAL DEFAULT 0,
    marginal_rate REAL DEFAULT 0,
    standard_deduction REAL DEFAULT 0,
    allowance_value REAL DEFAULT 0,
    effective_year INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS garnishments (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    garnishment_type TEXT DEFAULT 'wage',
    case_number TEXT,
    creditor TEXT,
    amount_per_period REAL DEFAULT 0,
    percent_of_disposable REAL DEFAULT 0,
    max_total REAL,
    deducted_to_date REAL DEFAULT 0,
    start_date TEXT,
    end_date TEXT,
    status TEXT DEFAULT 'active',
    priority INTEGER DEFAULT 1,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS retirement_contributions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    plan_type TEXT DEFAULT '401k',
    contribution_percent REAL DEFAULT 0,
    contribution_amount_flat REAL DEFAULT 0,
    employer_match_percent REAL DEFAULT 0,
    employer_match_cap_percent REAL DEFAULT 0,
    ytd_employee_contribution REAL DEFAULT 0,
    ytd_employer_contribution REAL DEFAULT 0,
    annual_limit REAL DEFAULT 23000,
    catch_up_eligible INTEGER DEFAULT 0,
    catch_up_amount REAL DEFAULT 0,
    vesting_schedule TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS section_125_plans (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    benefit_type TEXT NOT NULL,
    employee_contribution_per_period REAL DEFAULT 0,
    employer_contribution_per_period REAL DEFAULT 0,
    is_pretax INTEGER DEFAULT 1,
    annual_election REAL DEFAULT 0,
    elected_at TEXT,
    effective_from TEXT,
    effective_to TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS pto_accrual_rules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    rule_name TEXT NOT NULL,
    pto_type TEXT DEFAULT 'vacation',
    accrual_rate_hours_per_period REAL DEFAULT 0,
    accrual_frequency TEXT DEFAULT 'monthly',
    max_balance_hours REAL,
    carryover_max_hours REAL,
    carryover_resets_at TEXT,
    eligibility_tenure_months INTEGER DEFAULT 0,
    applies_to_role TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS employee_state_allocations (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    state_code TEXT NOT NULL,
    allocation_percent REAL DEFAULT 100,
    is_resident INTEGER DEFAULT 1,
    effective_from TEXT,
    effective_to TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS workers_comp_classes (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    class_code TEXT NOT NULL,
    state_code TEXT NOT NULL,
    description TEXT,
    rate_per_100 REAL DEFAULT 0,
    effective_from TEXT,
    effective_to TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS state_reciprocity (
    id TEXT PRIMARY KEY,
    work_state TEXT NOT NULL,
    resident_state TEXT NOT NULL,
    has_reciprocity INTEGER DEFAULT 1,
    certificate_form TEXT,
    notes TEXT,
    UNIQUE(work_state, resident_state)
  )`,
  `CREATE TABLE IF NOT EXISTS w2_year_end_runs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    tax_year INTEGER NOT NULL,
    employee_count INTEGER DEFAULT 0,
    total_wages REAL DEFAULT 0,
    total_federal_withheld REAL DEFAULT 0,
    total_ss_withheld REAL DEFAULT 0,
    total_medicare_withheld REAL DEFAULT 0,
    submitted_at TEXT,
    submitted_by TEXT,
    file_path TEXT,
    status TEXT DEFAULT 'draft',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, tax_year)
  )`,
  `CREATE TABLE IF NOT EXISTS direct_deposit_batches (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    payroll_run_id TEXT,
    batch_date TEXT NOT NULL,
    effective_date TEXT NOT NULL,
    total_amount REAL DEFAULT 0,
    item_count INTEGER DEFAULT 0,
    nacha_file_path TEXT,
    status TEXT DEFAULT 'draft',
    submitted_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  // ─── Batch T: Sales Tax Engine (F361-F370) ───
  `CREATE TABLE IF NOT EXISTS sales_tax_nexus (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    state_code TEXT NOT NULL,
    nexus_type TEXT DEFAULT 'economic',
    threshold_amount REAL DEFAULT 100000,
    threshold_transactions INTEGER DEFAULT 200,
    ytd_sales REAL DEFAULT 0,
    ytd_transactions INTEGER DEFAULT 0,
    nexus_established_date TEXT,
    registration_number TEXT,
    is_active INTEGER DEFAULT 1,
    last_evaluated_at TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, state_code)
  )`,
  `CREATE TABLE IF NOT EXISTS sales_tax_jurisdictions (
    id TEXT PRIMARY KEY,
    state_code TEXT NOT NULL,
    county TEXT,
    city TEXT,
    zip_code TEXT,
    state_rate REAL DEFAULT 0,
    county_rate REAL DEFAULT 0,
    city_rate REAL DEFAULT 0,
    special_rate REAL DEFAULT 0,
    combined_rate REAL DEFAULT 0,
    effective_from TEXT,
    effective_to TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_tax_juris_zip ON sales_tax_jurisdictions(zip_code)",
  `CREATE TABLE IF NOT EXISTS tax_exemption_certificates (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    certificate_number TEXT,
    exemption_type TEXT DEFAULT 'resale',
    issuing_state TEXT,
    issue_date TEXT,
    expiration_date TEXT,
    file_path TEXT,
    is_active INTEGER DEFAULT 1,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS use_tax_accruals (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    purchase_date TEXT NOT NULL,
    vendor_id TEXT,
    purchase_state TEXT,
    use_state TEXT NOT NULL,
    taxable_amount REAL DEFAULT 0,
    rate REAL DEFAULT 0,
    use_tax_due REAL DEFAULT 0,
    posted_je_id TEXT,
    status TEXT DEFAULT 'pending',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS sales_tax_filing_schedule (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    state_code TEXT NOT NULL,
    filing_frequency TEXT DEFAULT 'monthly',
    due_day_of_period INTEGER DEFAULT 20,
    next_filing_due TEXT,
    last_filed_at TEXT,
    is_active INTEGER DEFAULT 1,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, state_code, filing_frequency)
  )`,
  `CREATE TABLE IF NOT EXISTS sales_tax_liability (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    state_code TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    taxable_sales REAL DEFAULT 0,
    non_taxable_sales REAL DEFAULT 0,
    tax_collected REAL DEFAULT 0,
    tax_owed REAL DEFAULT 0,
    adjustments REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    penalty REAL DEFAULT 0,
    net_due REAL DEFAULT 0,
    status TEXT DEFAULT 'open',
    paid_amount REAL DEFAULT 0,
    paid_at TEXT,
    payment_je_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS sales_tax_holidays (
    id TEXT PRIMARY KEY,
    state_code TEXT NOT NULL,
    holiday_name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    eligible_categories TEXT,
    max_item_price REAL,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  // ─── Batch U: Multi-Entity Consolidation (F371-F380) ───
  `CREATE TABLE IF NOT EXISTS entity_hierarchy (
    id TEXT PRIMARY KEY,
    parent_company_id TEXT NOT NULL,
    child_company_id TEXT NOT NULL,
    ownership_percent REAL DEFAULT 100,
    consolidation_method TEXT DEFAULT 'full',
    effective_from TEXT,
    effective_to TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(parent_company_id, child_company_id)
  )`,
  `CREATE TABLE IF NOT EXISTS intercompany_elim_rules (
    id TEXT PRIMARY KEY,
    parent_company_id TEXT NOT NULL,
    rule_name TEXT NOT NULL,
    debit_account_pattern TEXT,
    credit_account_pattern TEXT,
    elimination_account_id TEXT,
    is_active INTEGER DEFAULT 1,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS consolidated_statements (
    id TEXT PRIMARY KEY,
    parent_company_id TEXT NOT NULL,
    statement_type TEXT DEFAULT 'balance_sheet',
    period_end TEXT NOT NULL,
    consolidated_data_json TEXT DEFAULT '{}',
    eliminations_data_json TEXT DEFAULT '{}',
    cta_amount REAL DEFAULT 0,
    minority_interest REAL DEFAULT 0,
    generated_at TEXT DEFAULT (datetime('now')),
    generated_by TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS currency_translations (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    period_end TEXT NOT NULL,
    functional_currency TEXT,
    reporting_currency TEXT DEFAULT 'USD',
    spot_rate REAL,
    average_rate REAL,
    historical_rate REAL,
    cta_adjustment REAL DEFAULT 0,
    method TEXT DEFAULT 'current_rate',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS minority_interests (
    id TEXT PRIMARY KEY,
    parent_company_id TEXT NOT NULL,
    subsidiary_company_id TEXT NOT NULL,
    period_end TEXT NOT NULL,
    subsidiary_equity REAL DEFAULT 0,
    minority_percent REAL DEFAULT 0,
    minority_interest_amount REAL DEFAULT 0,
    income_attributable REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS goodwill_tracking (
    id TEXT PRIMARY KEY,
    acquiring_company_id TEXT NOT NULL,
    acquired_company_id TEXT,
    acquisition_date TEXT,
    purchase_price REAL DEFAULT 0,
    fair_value_assets REAL DEFAULT 0,
    fair_value_liabilities REAL DEFAULT 0,
    goodwill_initial REAL DEFAULT 0,
    goodwill_current REAL DEFAULT 0,
    accumulated_impairment REAL DEFAULT 0,
    last_test_date TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS equity_method_investments (
    id TEXT PRIMARY KEY,
    investor_company_id TEXT NOT NULL,
    investee_company_id TEXT,
    investee_name TEXT NOT NULL,
    ownership_percent REAL DEFAULT 0,
    initial_investment REAL DEFAULT 0,
    current_carrying_value REAL DEFAULT 0,
    cumulative_share_of_income REAL DEFAULT 0,
    cumulative_distributions REAL DEFAULT 0,
    acquired_date TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,

  // ─── Batch V: Customer Portal (F381-F390) ───
  `CREATE TABLE IF NOT EXISTS portal_users (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    customer_id TEXT,
    vendor_id TEXT,
    portal_type TEXT DEFAULT 'customer',
    email TEXT NOT NULL,
    password_hash TEXT,
    full_name TEXT,
    is_active INTEGER DEFAULT 1,
    last_login_at TEXT,
    invited_at TEXT DEFAULT (datetime('now')),
    activated_at TEXT,
    invitation_token TEXT,
    UNIQUE(company_id, email, portal_type)
  )`,
  `CREATE TABLE IF NOT EXISTS portal_payments (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    portal_user_id TEXT NOT NULL,
    invoice_id TEXT,
    amount REAL DEFAULT 0,
    payment_method TEXT,
    stripe_payment_id TEXT,
    status TEXT DEFAULT 'pending',
    failure_reason TEXT,
    paid_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS portal_support_tickets (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    portal_user_id TEXT NOT NULL,
    ticket_number TEXT,
    subject TEXT NOT NULL,
    description TEXT,
    category TEXT DEFAULT 'general',
    priority TEXT DEFAULT 'normal',
    status TEXT DEFAULT 'open',
    assigned_to TEXT,
    resolved_at TEXT,
    response_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS portal_documents (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    portal_user_id TEXT NOT NULL,
    document_type TEXT,
    file_name TEXT NOT NULL,
    file_path TEXT,
    file_size INTEGER DEFAULT 0,
    mime_type TEXT,
    uploaded_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS portal_auto_pay (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    payment_method_id TEXT,
    is_enabled INTEGER DEFAULT 1,
    max_amount_per_charge REAL,
    enrolled_at TEXT DEFAULT (datetime('now')),
    canceled_at TEXT,
    UNIQUE(company_id, customer_id)
  )`,
  `CREATE TABLE IF NOT EXISTS portal_branding (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL UNIQUE,
    logo_url TEXT,
    primary_color TEXT DEFAULT '#3b82f6',
    accent_color TEXT,
    company_display_name TEXT,
    welcome_message TEXT,
    custom_css TEXT,
    favicon_url TEXT,
    support_email TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  )`,

  // ─── Batch W: Vendor Portal (F391-F400) ───
  `CREATE TABLE IF NOT EXISTS vendor_po_responses (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    po_id TEXT NOT NULL,
    portal_user_id TEXT,
    response_type TEXT NOT NULL,
    response_at TEXT DEFAULT (datetime('now')),
    rejection_reason TEXT,
    proposed_changes_json TEXT,
    notes TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS vendor_invoice_submissions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    portal_user_id TEXT NOT NULL,
    vendor_id TEXT NOT NULL,
    invoice_number TEXT,
    amount REAL DEFAULT 0,
    invoice_date TEXT,
    due_date TEXT,
    file_path TEXT,
    matched_bill_id TEXT,
    status TEXT DEFAULT 'submitted',
    rejection_reason TEXT,
    submitted_at TEXT DEFAULT (datetime('now')),
    reviewed_at TEXT,
    reviewed_by TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS vendor_ach_updates (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    vendor_id TEXT NOT NULL,
    portal_user_id TEXT,
    routing_number TEXT,
    account_number_last4 TEXT,
    account_type TEXT DEFAULT 'checking',
    micro_deposit_verified INTEGER DEFAULT 0,
    verification_attempts INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    submitted_at TEXT DEFAULT (datetime('now')),
    verified_at TEXT,
    approved_by TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS vendor_1099_downloads (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    vendor_id TEXT NOT NULL,
    portal_user_id TEXT,
    tax_year INTEGER NOT NULL,
    form_type TEXT DEFAULT '1099-NEC',
    file_path TEXT,
    downloaded_at TEXT DEFAULT (datetime('now')),
    ip_address TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS vendor_compliance_attestations (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    vendor_id TEXT NOT NULL,
    portal_user_id TEXT,
    attestation_type TEXT NOT NULL,
    attestation_text TEXT,
    answers_json TEXT DEFAULT '{}',
    is_compliant INTEGER DEFAULT 1,
    attested_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT
  )`,

  // ─── Batch X: Time Tracking deep-dive (F401-F410) ───
  `CREATE TABLE IF NOT EXISTS time_timers (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    project_id TEXT,
    task_id TEXT,
    started_at TEXT NOT NULL,
    paused_at TEXT,
    total_paused_seconds INTEGER DEFAULT 0,
    description TEXT,
    is_billable INTEGER DEFAULT 1,
    status TEXT DEFAULT 'running'
  )`,
  `CREATE TABLE IF NOT EXISTS billable_rates (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT,
    project_id TEXT,
    role TEXT,
    rate_per_hour REAL DEFAULT 0,
    currency TEXT DEFAULT 'USD',
    effective_from TEXT,
    effective_to TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS overtime_rules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    rule_name TEXT NOT NULL,
    state_code TEXT,
    daily_threshold_hours REAL DEFAULT 8,
    weekly_threshold_hours REAL DEFAULT 40,
    double_time_threshold_hours REAL,
    ot_multiplier REAL DEFAULT 1.5,
    double_time_multiplier REAL DEFAULT 2.0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS time_rounding_rules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    interval_minutes INTEGER DEFAULT 15,
    method TEXT DEFAULT 'nearest',
    applies_to TEXT DEFAULT 'all',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS calendar_event_sync (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    company_id TEXT,
    source TEXT DEFAULT 'google',
    external_event_id TEXT,
    title TEXT,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    project_id TEXT,
    converted_to_time_entry_id TEXT,
    synced_at TEXT DEFAULT (datetime('now')),
    UNIQUE(source, external_event_id)
  )`,
  `CREATE TABLE IF NOT EXISTS project_time_budgets (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    budgeted_hours REAL DEFAULT 0,
    consumed_hours REAL DEFAULT 0,
    alert_at_percent REAL DEFAULT 80,
    alert_fired_at TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    UNIQUE(company_id, project_id)
  )`,

  // ─── Batch Y: Document Intelligence (F411-F420) ───
  `CREATE TABLE IF NOT EXISTS document_classifications (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    detected_type TEXT,
    confidence REAL DEFAULT 0,
    extracted_fields_json TEXT DEFAULT '{}',
    classified_at TEXT DEFAULT (datetime('now')),
    method TEXT DEFAULT 'rule_based'
  )`,
  `CREATE TABLE IF NOT EXISTS document_extracted_fields (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    field_name TEXT NOT NULL,
    field_value TEXT,
    confidence REAL DEFAULT 0,
    extraction_method TEXT,
    verified INTEGER DEFAULT 0,
    extracted_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS bank_statement_imports (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    bank_account_id TEXT,
    statement_date TEXT NOT NULL,
    file_path TEXT,
    transactions_parsed INTEGER DEFAULT 0,
    transactions_matched INTEGER DEFAULT 0,
    opening_balance REAL DEFAULT 0,
    closing_balance REAL DEFAULT 0,
    parser_used TEXT,
    imported_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS contract_clauses (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    clause_type TEXT NOT NULL,
    clause_text TEXT,
    position_start INTEGER,
    position_end INTEGER,
    risk_level TEXT DEFAULT 'low',
    extracted_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS document_signing_workflows (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    document_id TEXT NOT NULL,
    workflow_name TEXT,
    status TEXT DEFAULT 'in_progress',
    current_step INTEGER DEFAULT 0,
    total_steps INTEGER DEFAULT 0,
    steps_json TEXT DEFAULT '[]',
    completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS document_retention_policies (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    document_type TEXT NOT NULL,
    retention_years INTEGER DEFAULT 7,
    auto_delete INTEGER DEFAULT 0,
    legal_hold_count INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  // ─── Batch Z: Collaboration (F421-F430) ───
  `CREATE TABLE IF NOT EXISTS user_mentions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    mentioned_user_id TEXT NOT NULL,
    mentioning_user_id TEXT,
    entity_type TEXT,
    entity_id TEXT,
    comment_id TEXT,
    context_text TEXT,
    is_read INTEGER DEFAULT 0,
    mentioned_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS entity_comments (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    parent_comment_id TEXT,
    user_id TEXT NOT NULL,
    user_email TEXT,
    body TEXT NOT NULL,
    is_internal INTEGER DEFAULT 0,
    edited_at TEXT,
    deleted_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_comments_entity ON entity_comments(company_id, entity_type, entity_id)",
  `CREATE TABLE IF NOT EXISTS comment_reactions (
    id TEXT PRIMARY KEY,
    comment_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    emoji TEXT NOT NULL,
    reacted_at TEXT DEFAULT (datetime('now')),
    UNIQUE(comment_id, user_id, emoji)
  )`,
  `CREATE TABLE IF NOT EXISTS internal_notes (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    body TEXT NOT NULL,
    is_pinned INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS entity_watchers (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    notify_on_update INTEGER DEFAULT 1,
    notify_on_comment INTEGER DEFAULT 1,
    notify_on_status_change INTEGER DEFAULT 1,
    watched_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, entity_type, entity_id)
  )`,
  `CREATE TABLE IF NOT EXISTS shared_drafts (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    draft_data_json TEXT NOT NULL,
    owner_user_id TEXT NOT NULL,
    shared_with_user_ids TEXT,
    assigned_to_user_id TEXT,
    status TEXT DEFAULT 'in_progress',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS email_to_entity_addresses (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    inbox_address TEXT NOT NULL UNIQUE,
    last_email_received_at TEXT,
    email_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    sender_user_id TEXT NOT NULL,
    recipient_user_id TEXT,
    channel_id TEXT,
    body TEXT NOT NULL,
    attachments_json TEXT DEFAULT '[]',
    read_at TEXT,
    sent_at TEXT DEFAULT (datetime('now'))
  )`,

  // ─── Batch AA: Integration Sync (F431-F440) ───
  `CREATE TABLE IF NOT EXISTS plaid_links (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    institution_name TEXT,
    institution_id TEXT,
    access_token_encrypted TEXT NOT NULL,
    item_id TEXT,
    linked_account_count INTEGER DEFAULT 0,
    last_sync_at TEXT,
    sync_cursor TEXT,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS plaid_synced_transactions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    plaid_link_id TEXT NOT NULL,
    external_transaction_id TEXT NOT NULL UNIQUE,
    bank_account_id TEXT,
    transaction_date TEXT NOT NULL,
    amount REAL DEFAULT 0,
    merchant_name TEXT,
    category TEXT,
    pending INTEGER DEFAULT 0,
    matched_entity_type TEXT,
    matched_entity_id TEXT,
    synced_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS quickbooks_exports (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    export_format TEXT DEFAULT 'iif',
    period_start TEXT,
    period_end TEXT,
    record_count INTEGER DEFAULT 0,
    file_path TEXT,
    status TEXT DEFAULT 'completed',
    exported_at TEXT DEFAULT (datetime('now')),
    exported_by TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS gmail_sync (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    company_id TEXT,
    gmail_message_id TEXT NOT NULL UNIQUE,
    subject TEXT,
    sender_email TEXT,
    received_at TEXT,
    body_snippet TEXT,
    attachment_count INTEGER DEFAULT 0,
    matched_entity_type TEXT,
    matched_entity_id TEXT,
    synced_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS cloud_storage_files (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    provider TEXT DEFAULT 'gdrive',
    external_file_id TEXT NOT NULL,
    file_name TEXT,
    file_size INTEGER DEFAULT 0,
    mime_type TEXT,
    folder_path TEXT,
    synced_at TEXT DEFAULT (datetime('now')),
    UNIQUE(provider, external_file_id)
  )`,
  `CREATE TABLE IF NOT EXISTS calendar_integrations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    company_id TEXT,
    provider TEXT DEFAULT 'google',
    calendar_id TEXT,
    access_token_encrypted TEXT,
    refresh_token_encrypted TEXT,
    last_sync_at TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS webhook_receiver_endpoints (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    endpoint_path TEXT NOT NULL UNIQUE,
    provider TEXT,
    shared_secret TEXT,
    is_active INTEGER DEFAULT 1,
    last_received_at TEXT,
    received_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  // ═══════════════════════════════════════════════════════════════════
  //   FINANCE WAVE: 100 features (F441-F540)
  //   Invoice + Expense + Payment + Subscriptions + Collections +
  //   Analytics + Tax + Vendor management upgrades
  // ═══════════════════════════════════════════════════════════════════

  // ─── Batch AB: Invoice Advanced (F441-F455) ───
  // F441 — line-item discount already on quote_line_items; ensure on invoice_line_items
  "ALTER TABLE invoice_line_items ADD COLUMN discount_pct REAL DEFAULT 0",
  "ALTER TABLE invoice_line_items ADD COLUMN discount_reason TEXT",
  // F443 — recurring templates
  `CREATE TABLE IF NOT EXISTS recurring_invoice_templates (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    template_name TEXT NOT NULL,
    client_id TEXT,
    frequency TEXT DEFAULT 'monthly',
    start_date TEXT NOT NULL,
    end_date TEXT,
    next_run_date TEXT NOT NULL,
    line_items_json TEXT DEFAULT '[]',
    notes TEXT,
    payment_terms TEXT,
    is_active INTEGER DEFAULT 1,
    auto_send INTEGER DEFAULT 0,
    run_count INTEGER DEFAULT 0,
    last_run_at TEXT,
    last_invoice_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // F444 — invoice approval workflow
  `CREATE TABLE IF NOT EXISTS invoice_approval_steps (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL,
    step_number INTEGER DEFAULT 1,
    approver_user_id TEXT,
    action TEXT,
    acted_at TEXT,
    comment TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F445-F446 — invoice email tracking
  `CREATE TABLE IF NOT EXISTS invoice_email_log (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    subject TEXT,
    sent_at TEXT DEFAULT (datetime('now')),
    sent_by TEXT,
    opened_at TEXT,
    opened_count INTEGER DEFAULT 0,
    clicked_at TEXT,
    tracking_pixel_id TEXT,
    delivery_status TEXT DEFAULT 'sent',
    bounce_reason TEXT
  )`,
  // F447 — late fee config
  `CREATE TABLE IF NOT EXISTS late_fee_policies (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    policy_name TEXT NOT NULL,
    fee_type TEXT DEFAULT 'percent',
    percent_rate REAL DEFAULT 0,
    flat_amount REAL DEFAULT 0,
    grace_period_days INTEGER DEFAULT 0,
    compound INTEGER DEFAULT 0,
    apply_frequency TEXT DEFAULT 'monthly',
    max_fees_count INTEGER DEFAULT 12,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F448 — early payment discount terms
  `CREATE TABLE IF NOT EXISTS payment_terms (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    terms_name TEXT NOT NULL,
    net_days INTEGER DEFAULT 30,
    discount_percent REAL DEFAULT 0,
    discount_days INTEGER DEFAULT 0,
    description TEXT,
    is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  "ALTER TABLE invoices ADD COLUMN payment_terms_id TEXT",
  "ALTER TABLE invoices ADD COLUMN early_discount_taken INTEGER DEFAULT 0",
  "ALTER TABLE invoices ADD COLUMN early_discount_amount REAL DEFAULT 0",
  // F450 — progress billing
  `CREATE TABLE IF NOT EXISTS progress_billing_schedules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    project_id TEXT,
    contract_total REAL DEFAULT 0,
    billed_to_date REAL DEFAULT 0,
    remaining_to_bill REAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS progress_billing_releases (
    id TEXT PRIMARY KEY,
    schedule_id TEXT NOT NULL REFERENCES progress_billing_schedules(id) ON DELETE CASCADE,
    release_date TEXT NOT NULL,
    percent_complete REAL DEFAULT 0,
    amount_to_bill REAL DEFAULT 0,
    invoice_id TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F451 — retainer invoicing
  `CREATE TABLE IF NOT EXISTS retainers (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    retainer_name TEXT NOT NULL,
    initial_amount REAL DEFAULT 0,
    current_balance REAL DEFAULT 0,
    minimum_balance REAL DEFAULT 0,
    auto_refill INTEGER DEFAULT 0,
    refill_amount REAL DEFAULT 0,
    start_date TEXT,
    end_date TEXT,
    status TEXT DEFAULT 'active',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS retainer_drawdowns (
    id TEXT PRIMARY KEY,
    retainer_id TEXT NOT NULL REFERENCES retainers(id) ON DELETE CASCADE,
    drawdown_date TEXT NOT NULL,
    amount REAL DEFAULT 0,
    reason TEXT,
    invoice_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F452 — deposits
  "ALTER TABLE invoices ADD COLUMN deposit_required INTEGER DEFAULT 0",
  "ALTER TABLE invoices ADD COLUMN deposit_amount REAL DEFAULT 0",
  "ALTER TABLE invoices ADD COLUMN deposit_paid_at TEXT",
  // F453 — scheduled send
  "ALTER TABLE invoices ADD COLUMN scheduled_send_at TEXT",
  // F454 — multi-payment plan
  `CREATE TABLE IF NOT EXISTS invoice_payment_plans (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    plan_name TEXT,
    total_amount REAL DEFAULT 0,
    installment_count INTEGER DEFAULT 0,
    installment_amount REAL DEFAULT 0,
    frequency TEXT DEFAULT 'monthly',
    start_date TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS invoice_payment_plan_installments (
    id TEXT PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES invoice_payment_plans(id) ON DELETE CASCADE,
    installment_number INTEGER DEFAULT 1,
    due_date TEXT NOT NULL,
    amount REAL DEFAULT 0,
    paid_amount REAL DEFAULT 0,
    paid_at TEXT,
    status TEXT DEFAULT 'pending'
  )`,
  // F455 — invoice attachments
  `CREATE TABLE IF NOT EXISTS invoice_attachments (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT,
    file_size INTEGER DEFAULT 0,
    mime_type TEXT,
    uploaded_at TEXT DEFAULT (datetime('now')),
    uploaded_by TEXT
  )`,

  // ─── Batch AC: Payment Processing (F456-F470) ───
  // F458 — payment links
  `CREATE TABLE IF NOT EXISTS payment_links (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    invoice_id TEXT,
    link_url TEXT,
    short_code TEXT NOT NULL UNIQUE,
    amount REAL DEFAULT 0,
    expires_at TEXT,
    click_count INTEGER DEFAULT 0,
    used_at TEXT,
    used_amount REAL,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F459 — reminder cadence per invoice
  `CREATE TABLE IF NOT EXISTS reminder_cadences (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    cadence_name TEXT NOT NULL,
    days_offsets TEXT NOT NULL,
    template_id TEXT,
    is_default INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F461 — failed payment retries
  `CREATE TABLE IF NOT EXISTS payment_retry_attempts (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    invoice_id TEXT,
    payment_method_id TEXT,
    attempt_number INTEGER DEFAULT 1,
    attempted_at TEXT DEFAULT (datetime('now')),
    next_attempt_at TEXT,
    failure_code TEXT,
    failure_message TEXT,
    final_status TEXT DEFAULT 'pending'
  )`,
  // F463 — credit memo / overpayment
  `CREATE TABLE IF NOT EXISTS customer_credit_balances (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    customer_id TEXT NOT NULL UNIQUE,
    balance REAL DEFAULT 0,
    last_applied_at TEXT,
    notes TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS customer_credit_transactions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    transaction_type TEXT NOT NULL,
    amount REAL DEFAULT 0,
    source_invoice_id TEXT,
    applied_to_invoice_id TEXT,
    notes TEXT,
    transaction_at TEXT DEFAULT (datetime('now'))
  )`,
  // F464 — refunds
  `CREATE TABLE IF NOT EXISTS refunds (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    invoice_id TEXT,
    payment_id TEXT,
    refund_amount REAL DEFAULT 0,
    refund_method TEXT,
    reason TEXT,
    refunded_at TEXT DEFAULT (datetime('now')),
    refunded_by TEXT,
    external_refund_id TEXT,
    status TEXT DEFAULT 'completed'
  )`,
  // F465 — chargeback log
  `CREATE TABLE IF NOT EXISTS chargebacks (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    invoice_id TEXT,
    payment_id TEXT,
    amount REAL DEFAULT 0,
    chargeback_date TEXT,
    reason_code TEXT,
    status TEXT DEFAULT 'disputed',
    evidence_submitted_at TEXT,
    resolution TEXT,
    resolved_at TEXT,
    fee REAL DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F466 — customer payment method preferences
  `CREATE TABLE IF NOT EXISTS customer_payment_methods (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    method_type TEXT NOT NULL,
    nickname TEXT,
    last4 TEXT,
    brand TEXT,
    is_default INTEGER DEFAULT 0,
    expires_month INTEGER,
    expires_year INTEGER,
    external_token TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F468 — check printing log
  `CREATE TABLE IF NOT EXISTS check_print_jobs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    bank_account_id TEXT,
    check_number_start INTEGER,
    check_number_end INTEGER,
    check_count INTEGER DEFAULT 0,
    total_amount REAL DEFAULT 0,
    pdf_path TEXT,
    printed_at TEXT DEFAULT (datetime('now')),
    printed_by TEXT,
    status TEXT DEFAULT 'printed'
  )`,
  // F470 — crypto payments
  `CREATE TABLE IF NOT EXISTS crypto_payments (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    invoice_id TEXT,
    currency TEXT NOT NULL,
    amount_crypto REAL DEFAULT 0,
    amount_usd_at_time REAL DEFAULT 0,
    wallet_address TEXT,
    tx_hash TEXT,
    confirmations INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    received_at TEXT DEFAULT (datetime('now'))
  )`,

  // ─── Batch AD: Expense Advanced (F471-F485) ───
  // F471 — expense reports (group of expenses)
  `CREATE TABLE IF NOT EXISTS expense_reports (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT,
    report_name TEXT NOT NULL,
    period_start TEXT,
    period_end TEXT,
    total_amount REAL DEFAULT 0,
    expense_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'draft',
    submitted_at TEXT,
    approved_at TEXT,
    approved_by TEXT,
    paid_at TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  "ALTER TABLE expenses ADD COLUMN expense_report_id TEXT",
  // F473 — per-diem
  `CREATE TABLE IF NOT EXISTS per_diem_rates (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    location TEXT NOT NULL,
    lodging_rate REAL DEFAULT 0,
    meals_rate REAL DEFAULT 0,
    incidentals_rate REAL DEFAULT 0,
    effective_from TEXT,
    effective_to TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F474 — mileage with multiple vehicles
  `CREATE TABLE IF NOT EXISTS vehicles (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    user_id TEXT,
    vehicle_name TEXT NOT NULL,
    make TEXT,
    model TEXT,
    year INTEGER,
    plate_number TEXT,
    is_default INTEGER DEFAULT 0,
    business_use_pct REAL DEFAULT 100,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F478 — 1099 thresholds
  `CREATE TABLE IF NOT EXISTS vendor_1099_thresholds (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    vendor_id TEXT NOT NULL,
    tax_year INTEGER NOT NULL,
    ytd_amount REAL DEFAULT 0,
    threshold REAL DEFAULT 600,
    requires_1099 INTEGER DEFAULT 0,
    form_type TEXT DEFAULT '1099-NEC',
    last_calculated_at TEXT,
    UNIQUE(company_id, vendor_id, tax_year)
  )`,
  // F479 — expense category budgets
  `CREATE TABLE IF NOT EXISTS expense_category_budgets (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    category_id TEXT,
    fiscal_year INTEGER NOT NULL,
    month INTEGER,
    budget_amount REAL DEFAULT 0,
    actual_amount REAL DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F481 — reimbursements (extends expense_reimbursements pattern if exists)
  `CREATE TABLE IF NOT EXISTS expense_reimbursements (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    total_amount REAL DEFAULT 0,
    period_start TEXT,
    period_end TEXT,
    status TEXT DEFAULT 'pending',
    approved_at TEXT,
    approved_by TEXT,
    paid_at TEXT,
    payment_method TEXT,
    je_id TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // F484 — rebillable expense flag
  "ALTER TABLE expenses ADD COLUMN rebillable_to_client_id TEXT",
  "ALTER TABLE expenses ADD COLUMN rebilled_on_invoice_id TEXT",
  "ALTER TABLE expenses ADD COLUMN markup_pct REAL DEFAULT 0",
  // F485 — pre-approval gates
  `CREATE TABLE IF NOT EXISTS expense_pre_approvals (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    description TEXT NOT NULL,
    estimated_amount REAL DEFAULT 0,
    category_id TEXT,
    purpose TEXT,
    requested_date TEXT,
    needed_by_date TEXT,
    status TEXT DEFAULT 'pending',
    approved_by TEXT,
    approved_at TEXT,
    rejected_reason TEXT,
    actual_expense_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  // ─── Batch AE: Billing & Subscriptions (F486-F495) ───
  `CREATE TABLE IF NOT EXISTS subscription_plans (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    plan_name TEXT NOT NULL,
    description TEXT,
    base_price REAL DEFAULT 0,
    billing_frequency TEXT DEFAULT 'monthly',
    trial_days INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    features_json TEXT DEFAULT '[]',
    tier INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    status TEXT DEFAULT 'trial',
    start_date TEXT NOT NULL,
    trial_end_date TEXT,
    current_period_start TEXT,
    current_period_end TEXT,
    next_renewal_date TEXT,
    canceled_at TEXT,
    cancel_at_period_end INTEGER DEFAULT 0,
    paused_at TEXT,
    resume_at TEXT,
    discount_code_id TEXT,
    discount_percent REAL DEFAULT 0,
    quantity INTEGER DEFAULT 1,
    custom_price REAL,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS subscription_proration_events (
    id TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL,
    event_type TEXT,
    old_plan_id TEXT,
    new_plan_id TEXT,
    proration_amount REAL DEFAULT 0,
    days_remaining INTEGER,
    invoice_id TEXT,
    event_date TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS usage_records (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    subscription_id TEXT,
    customer_id TEXT,
    metric_name TEXT NOT NULL,
    quantity REAL DEFAULT 0,
    recorded_at TEXT DEFAULT (datetime('now')),
    billed INTEGER DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS pricing_tiers (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    tier_min REAL DEFAULT 0,
    tier_max REAL,
    unit_price REAL DEFAULT 0,
    flat_fee REAL DEFAULT 0,
    sort_order INTEGER DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS mrr_arr_snapshots (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    snapshot_date TEXT NOT NULL,
    mrr REAL DEFAULT 0,
    arr REAL DEFAULT 0,
    new_mrr REAL DEFAULT 0,
    expansion_mrr REAL DEFAULT 0,
    contraction_mrr REAL DEFAULT 0,
    churned_mrr REAL DEFAULT 0,
    customer_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, snapshot_date)
  )`,

  // ─── Batch AF: Credit & Collections (F496-F505) ───
  "ALTER TABLE clients ADD COLUMN credit_limit REAL DEFAULT 0",
  "ALTER TABLE clients ADD COLUMN credit_hold INTEGER DEFAULT 0",
  "ALTER TABLE clients ADD COLUMN credit_hold_reason TEXT",
  "ALTER TABLE clients ADD COLUMN credit_score INTEGER",
  `CREATE TABLE IF NOT EXISTS customer_statements (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    statement_date TEXT NOT NULL,
    period_start TEXT,
    period_end TEXT,
    opening_balance REAL DEFAULT 0,
    invoices_total REAL DEFAULT 0,
    payments_total REAL DEFAULT 0,
    credits_total REAL DEFAULT 0,
    closing_balance REAL DEFAULT 0,
    pdf_path TEXT,
    sent_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS dunning_sequences (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    sequence_name TEXT NOT NULL,
    steps_json TEXT DEFAULT '[]',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS dunning_events (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    invoice_id TEXT NOT NULL,
    sequence_id TEXT,
    step_number INTEGER DEFAULT 1,
    sent_at TEXT DEFAULT (datetime('now')),
    method TEXT DEFAULT 'email',
    template_used TEXT,
    response_received_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS bad_debt_writeoffs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    customer_id TEXT,
    invoice_id TEXT,
    writeoff_amount REAL DEFAULT 0,
    writeoff_date TEXT NOT NULL,
    reason TEXT,
    posted_je_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    created_by TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS allowance_for_doubtful_accounts (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    period_end TEXT NOT NULL,
    method TEXT DEFAULT 'percent_of_sales',
    base_amount REAL DEFAULT 0,
    estimate_percent REAL DEFAULT 0,
    allowance_amount REAL DEFAULT 0,
    posted_je_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS collection_agency_handoffs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    invoice_id TEXT,
    customer_id TEXT,
    agency_name TEXT,
    handed_off_date TEXT,
    amount_assigned REAL DEFAULT 0,
    commission_rate REAL DEFAULT 0,
    recovered_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    closed_at TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  // ─── Batch AG: Financial Analytics (F506-F520) ───
  `CREATE TABLE IF NOT EXISTS analytics_snapshots (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    snapshot_date TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    metric_value REAL DEFAULT 0,
    metric_unit TEXT,
    metric_basis TEXT,
    computed_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, snapshot_date, metric_name)
  )`,
  `CREATE TABLE IF NOT EXISTS cohort_analysis (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    cohort_month TEXT NOT NULL,
    period_offset INTEGER NOT NULL,
    customers_remaining INTEGER DEFAULT 0,
    revenue_remaining REAL DEFAULT 0,
    retention_pct REAL DEFAULT 0,
    computed_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, cohort_month, period_offset)
  )`,

  // ─── Batch AH: Tax & Compliance (F521-F530) ───
  `CREATE TABLE IF NOT EXISTS form_1099_runs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    tax_year INTEGER NOT NULL,
    form_type TEXT DEFAULT '1099-NEC',
    vendor_count INTEGER DEFAULT 0,
    total_amount REAL DEFAULT 0,
    file_path TEXT,
    submitted_at TEXT,
    status TEXT DEFAULT 'draft',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, tax_year, form_type)
  )`,
  `CREATE TABLE IF NOT EXISTS withholding_tracking (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    vendor_id TEXT,
    withholding_type TEXT DEFAULT 'backup',
    rate REAL DEFAULT 0,
    ytd_amount REAL DEFAULT 0,
    tax_year INTEGER NOT NULL,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS quarterly_tax_estimates (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    tax_year INTEGER NOT NULL,
    quarter INTEGER NOT NULL,
    federal_estimate REAL DEFAULT 0,
    state_estimate REAL DEFAULT 0,
    due_date TEXT,
    paid_at TEXT,
    paid_amount REAL DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, tax_year, quarter)
  )`,
  `CREATE TABLE IF NOT EXISTS tax_provision (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    fiscal_year INTEGER NOT NULL,
    book_income REAL DEFAULT 0,
    permanent_differences REAL DEFAULT 0,
    temporary_differences REAL DEFAULT 0,
    taxable_income REAL DEFAULT 0,
    federal_rate REAL DEFAULT 21,
    state_rate REAL DEFAULT 0,
    current_federal_tax REAL DEFAULT 0,
    current_state_tax REAL DEFAULT 0,
    deferred_tax_asset REAL DEFAULT 0,
    deferred_tax_liability REAL DEFAULT 0,
    effective_tax_rate REAL DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS rd_tax_credits (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    tax_year INTEGER NOT NULL,
    qualified_research_expense REAL DEFAULT 0,
    base_amount REAL DEFAULT 0,
    incremental_qre REAL DEFAULT 0,
    credit_rate REAL DEFAULT 20,
    credit_amount REAL DEFAULT 0,
    payroll_offset_election INTEGER DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS section_179_elections (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    tax_year INTEGER NOT NULL,
    elected_amount REAL DEFAULT 0,
    bonus_depreciation INTEGER DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  // ─── Batch AI: Vendor Management Advanced (F531-F540) ───
  `CREATE TABLE IF NOT EXISTS vendor_onboarding_checklists (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    vendor_id TEXT NOT NULL,
    checklist_items_json TEXT DEFAULT '[]',
    items_completed INTEGER DEFAULT 0,
    items_total INTEGER DEFAULT 0,
    status TEXT DEFAULT 'in_progress',
    completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS vendor_w9_records (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    vendor_id TEXT NOT NULL,
    legal_name TEXT,
    tin TEXT,
    tin_type TEXT,
    business_type TEXT,
    address TEXT,
    is_us_person INTEGER DEFAULT 1,
    backup_withholding_subject INTEGER DEFAULT 0,
    received_date TEXT,
    file_path TEXT,
    signature_present INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS vendor_insurance_policies (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    vendor_id TEXT NOT NULL,
    policy_type TEXT NOT NULL,
    carrier TEXT,
    policy_number TEXT,
    coverage_amount REAL DEFAULT 0,
    effective_date TEXT,
    expiration_date TEXT,
    certificate_file_path TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS vendor_disputes (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    vendor_id TEXT NOT NULL,
    bill_id TEXT,
    dispute_amount REAL DEFAULT 0,
    reason TEXT,
    status TEXT DEFAULT 'open',
    opened_date TEXT,
    resolved_date TEXT,
    resolution_amount REAL DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  // ═══════════════════════════════════════════════════════════════════
  //   EXPENSE ADVANCED WAVE: 100 features (F541-F640)
  //   Policy engine, templates, card mgmt, travel, mileage, custom
  //   fields, spend analytics, workflows, mobile capture, reports.
  // ═══════════════════════════════════════════════════════════════════

  // ─── Batch AJ: Expense Policy Engine (F541-F550) ───
  `CREATE TABLE IF NOT EXISTS expense_policies (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    policy_name TEXT NOT NULL,
    scope TEXT DEFAULT 'global',
    category_id TEXT,
    vendor_id TEXT,
    employee_id TEXT,
    max_per_expense REAL,
    max_per_day REAL,
    max_per_month REAL,
    requires_receipt INTEGER DEFAULT 1,
    requires_approval_over REAL DEFAULT 0,
    enforcement TEXT DEFAULT 'warn',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS expense_policy_violations (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    expense_id TEXT NOT NULL,
    policy_id TEXT,
    violation_type TEXT,
    violation_message TEXT,
    severity TEXT DEFAULT 'warn',
    acknowledged INTEGER DEFAULT 0,
    acknowledged_by TEXT,
    acknowledged_at TEXT,
    detected_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS travel_policy_caps (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    destination_pattern TEXT,
    hotel_max_per_night REAL,
    meals_max_per_day REAL,
    incidentals_max_per_day REAL,
    flight_class_max TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  // ─── Batch AK: Expense Templates & Auto-Fill (F551-F560) ───
  `CREATE TABLE IF NOT EXISTS expense_templates_v2 (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    user_id TEXT,
    template_name TEXT NOT NULL,
    vendor_id TEXT,
    category_id TEXT,
    project_id TEXT,
    default_amount REAL,
    description TEXT,
    is_tax_deductible INTEGER DEFAULT 1,
    is_billable INTEGER DEFAULT 0,
    use_count INTEGER DEFAULT 0,
    last_used_at TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS subscription_detections (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    vendor_id TEXT,
    vendor_name_pattern TEXT,
    avg_amount REAL DEFAULT 0,
    frequency TEXT DEFAULT 'monthly',
    last_charge_date TEXT,
    next_expected_date TEXT,
    occurrence_count INTEGER DEFAULT 0,
    annual_cost REAL DEFAULT 0,
    is_confirmed INTEGER DEFAULT 0,
    is_cancelled INTEGER DEFAULT 0,
    notes TEXT,
    detected_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS auto_tag_rules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    rule_name TEXT NOT NULL,
    description_pattern TEXT,
    vendor_pattern TEXT,
    amount_min REAL,
    amount_max REAL,
    tag_ids TEXT,
    category_id TEXT,
    project_id TEXT,
    priority INTEGER DEFAULT 50,
    is_active INTEGER DEFAULT 1,
    match_count INTEGER DEFAULT 0,
    last_matched_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  // ─── Batch AL: Corporate Card Management (F561-F570) ───
  `CREATE TABLE IF NOT EXISTS corporate_cards (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    card_name TEXT NOT NULL,
    card_holder_user_id TEXT,
    card_holder_name TEXT,
    last4 TEXT,
    brand TEXT,
    issuing_bank TEXT,
    credit_limit REAL DEFAULT 0,
    current_balance REAL DEFAULT 0,
    available_credit REAL DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    issued_date TEXT,
    expiration_month INTEGER,
    expiration_year INTEGER,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS card_transactions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    card_id TEXT NOT NULL,
    transaction_date TEXT NOT NULL,
    posted_date TEXT,
    amount REAL DEFAULT 0,
    merchant_name TEXT,
    merchant_category TEXT,
    description TEXT,
    is_credit INTEGER DEFAULT 0,
    matched_expense_id TEXT,
    matched_at TEXT,
    is_disputed INTEGER DEFAULT 0,
    is_personal INTEGER DEFAULT 0,
    imported_at TEXT DEFAULT (datetime('now'))
  )`,
  "CREATE INDEX IF NOT EXISTS idx_card_tx_match ON card_transactions(company_id, matched_expense_id)",
  `CREATE TABLE IF NOT EXISTS card_dispute_records (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    card_transaction_id TEXT NOT NULL,
    dispute_reason TEXT,
    dispute_amount REAL DEFAULT 0,
    disputed_at TEXT DEFAULT (datetime('now')),
    resolution TEXT,
    resolved_at TEXT,
    status TEXT DEFAULT 'open'
  )`,
  `CREATE TABLE IF NOT EXISTS card_spend_rules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    card_id TEXT,
    rule_type TEXT DEFAULT 'block_category',
    target_value TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  // ─── Batch AM: Travel Expense Specialized (F571-F580) ───
  `CREATE TABLE IF NOT EXISTS trips (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    user_id TEXT,
    trip_name TEXT NOT NULL,
    destination TEXT,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    purpose TEXT,
    total_budget REAL DEFAULT 0,
    total_actual REAL DEFAULT 0,
    expense_count INTEGER DEFAULT 0,
    is_international INTEGER DEFAULT 0,
    base_currency TEXT DEFAULT 'USD',
    status TEXT DEFAULT 'planned',
    pre_approved INTEGER DEFAULT 0,
    pre_approved_by TEXT,
    pre_approved_at TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  "ALTER TABLE expenses ADD COLUMN trip_id TEXT",
  `CREATE TABLE IF NOT EXISTS trip_itinerary (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    leg_number INTEGER DEFAULT 1,
    leg_date TEXT,
    leg_type TEXT,
    from_location TEXT,
    to_location TEXT,
    arrival_time TEXT,
    departure_time TEXT,
    confirmation_number TEXT,
    notes TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS trip_per_diem_settings (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL,
    location TEXT NOT NULL,
    days INTEGER DEFAULT 0,
    lodging_rate REAL DEFAULT 0,
    meals_rate REAL DEFAULT 0,
    total_amount REAL DEFAULT 0,
    applied INTEGER DEFAULT 0
  )`,

  // ─── Batch AN: Mileage Advanced (F581-F590) ───
  `CREATE TABLE IF NOT EXISTS mileage_irs_rates (
    id TEXT PRIMARY KEY,
    tax_year INTEGER NOT NULL,
    business_rate REAL DEFAULT 0,
    medical_rate REAL DEFAULT 0,
    moving_rate REAL DEFAULT 0,
    charitable_rate REAL DEFAULT 14,
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    UNIQUE(tax_year)
  )`,
  `CREATE TABLE IF NOT EXISTS mileage_state_rates (
    id TEXT PRIMARY KEY,
    state_code TEXT NOT NULL,
    rate_per_mile REAL DEFAULT 0,
    effective_from TEXT NOT NULL,
    effective_to TEXT,
    notes TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS mileage_routes (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    expense_id TEXT,
    vehicle_id TEXT,
    user_id TEXT,
    route_date TEXT NOT NULL,
    purpose TEXT,
    total_miles REAL DEFAULT 0,
    is_business INTEGER DEFAULT 1,
    is_commute INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS mileage_route_stops (
    id TEXT PRIMARY KEY,
    route_id TEXT NOT NULL REFERENCES mileage_routes(id) ON DELETE CASCADE,
    stop_order INTEGER DEFAULT 1,
    location_address TEXT,
    arrival_time TEXT,
    miles_from_previous REAL DEFAULT 0,
    notes TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS vehicle_depreciation (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    vehicle_id TEXT NOT NULL,
    purchase_price REAL DEFAULT 0,
    purchase_date TEXT,
    useful_life_years INTEGER DEFAULT 5,
    method TEXT DEFAULT 'straight_line',
    business_use_pct REAL DEFAULT 100,
    annual_depreciation REAL DEFAULT 0,
    accumulated_depreciation REAL DEFAULT 0,
    last_calculated_year INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS vehicle_maintenance (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    vehicle_id TEXT NOT NULL,
    service_date TEXT NOT NULL,
    service_type TEXT,
    odometer_at_service INTEGER,
    cost REAL DEFAULT 0,
    vendor TEXT,
    expense_id TEXT,
    next_service_due_date TEXT,
    next_service_due_miles INTEGER,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  "ALTER TABLE vehicles ADD COLUMN mileage_method TEXT DEFAULT 'standard'",

  // ─── Batch AO: Custom Fields & Tagging (F591-F600) ───
  `CREATE TABLE IF NOT EXISTS expense_custom_field_defs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    field_name TEXT NOT NULL,
    field_label TEXT,
    field_type TEXT DEFAULT 'text',
    options_json TEXT,
    formula TEXT,
    is_required INTEGER DEFAULT 0,
    required_for_categories TEXT,
    display_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS expense_custom_field_values (
    id TEXT PRIMARY KEY,
    expense_id TEXT NOT NULL,
    field_def_id TEXT NOT NULL,
    value_text TEXT,
    value_number REAL,
    value_date TEXT,
    value_json TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS expense_tag_hierarchy (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    parent_tag_id TEXT,
    color TEXT DEFAULT '#60a5fa',
    icon TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  // ─── Batch AP: Spend Analytics Advanced (F601-F610) ───
  `CREATE TABLE IF NOT EXISTS spend_benchmarks (
    id TEXT PRIMARY KEY,
    industry TEXT NOT NULL,
    category TEXT NOT NULL,
    avg_pct_of_revenue REAL DEFAULT 0,
    median_pct_of_revenue REAL DEFAULT 0,
    benchmark_year INTEGER,
    sample_size INTEGER,
    source TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS cost_save_recommendations (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    recommendation_type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    estimated_annual_savings REAL DEFAULT 0,
    confidence REAL DEFAULT 0.5,
    related_vendor_id TEXT,
    related_category_id TEXT,
    status TEXT DEFAULT 'open',
    dismissed_reason TEXT,
    generated_at TEXT DEFAULT (datetime('now'))
  )`,

  // ─── Batch AQ: Workflow Customization (F611-F620) ───
  `CREATE TABLE IF NOT EXISTS approval_workflow_defs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    workflow_name TEXT NOT NULL,
    entity_type TEXT DEFAULT 'expense',
    trigger_amount_min REAL,
    trigger_amount_max REAL,
    trigger_category_ids TEXT,
    steps_json TEXT NOT NULL,
    escalation_days INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS workflow_delegations (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    delegator_user_id TEXT NOT NULL,
    delegate_user_id TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    reason TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS workflow_audit_log (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    workflow_id TEXT,
    entity_type TEXT,
    entity_id TEXT,
    step_number INTEGER,
    actor_user_id TEXT,
    action TEXT,
    notes TEXT,
    occurred_at TEXT DEFAULT (datetime('now'))
  )`,

  // ─── Batch AR: Mobile & Capture (F621-F630) ───
  `CREATE TABLE IF NOT EXISTS expense_capture_queue (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    user_id TEXT,
    capture_type TEXT DEFAULT 'photo',
    payload_path TEXT,
    metadata_json TEXT DEFAULT '{}',
    geo_lat REAL,
    geo_lng REAL,
    captured_at TEXT DEFAULT (datetime('now')),
    processed INTEGER DEFAULT 0,
    processed_at TEXT,
    created_expense_id TEXT
  )`,
  "ALTER TABLE expenses ADD COLUMN geo_lat REAL",
  "ALTER TABLE expenses ADD COLUMN geo_lng REAL",
  "ALTER TABLE expenses ADD COLUMN geo_location_name TEXT",
  `CREATE TABLE IF NOT EXISTS expense_voice_memos (
    id TEXT PRIMARY KEY,
    expense_id TEXT NOT NULL,
    audio_path TEXT,
    transcript TEXT,
    duration_seconds REAL,
    recorded_at TEXT DEFAULT (datetime('now'))
  )`,

  // ─── Batch AS: Reports & Year-End (F631-F640) ───
  `CREATE TABLE IF NOT EXISTS expense_report_templates_v2 (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    template_name TEXT NOT NULL,
    columns_json TEXT DEFAULT '[]',
    grouping TEXT,
    sort_by TEXT,
    filters_json TEXT DEFAULT '{}',
    layout TEXT DEFAULT 'standard',
    is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // Invoice Wave II (F923-F962) — 40 more upgrades covering MRR/recurring,
  // PDF brand customization, quote conversion, coupons, payment processing,
  // international, workflow rules, client portal & LTV/churn predictions.
  `CREATE TABLE IF NOT EXISTS pdf_brand_profiles (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    template_variant TEXT DEFAULT 'modern',
    logo_path TEXT,
    primary_color TEXT DEFAULT '#3b82f6',
    secondary_color TEXT DEFAULT '#94a3b8',
    accent_color TEXT DEFAULT '#22c55e',
    font_family TEXT DEFAULT 'system',
    footer_text TEXT,
    letterhead_html TEXT,
    is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS invoice_coupons (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    code TEXT NOT NULL,
    description TEXT,
    discount_type TEXT NOT NULL,
    discount_value REAL NOT NULL,
    min_amount REAL,
    max_uses INTEGER,
    times_used INTEGER DEFAULT 0,
    valid_from TEXT,
    valid_until TEXT,
    client_id TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    UNIQUE(company_id, code)
  )`,
  `CREATE TABLE IF NOT EXISTS invoice_coupon_redemptions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    coupon_id TEXT NOT NULL,
    invoice_id TEXT NOT NULL,
    discount_applied REAL NOT NULL,
    redeemed_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS payment_intents (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    invoice_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    external_intent_id TEXT,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'USD',
    status TEXT DEFAULT 'pending',
    payment_method_type TEXT,
    metadata_json TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS client_portal_tokens (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    scope TEXT DEFAULT 'invoices',
    invoice_id TEXT,
    expires_at TEXT,
    last_used_at TEXT,
    use_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS invoice_workflow_rules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    trigger_event TEXT NOT NULL,
    condition_json TEXT DEFAULT '{}',
    action_type TEXT NOT NULL,
    action_params_json TEXT DEFAULT '{}',
    priority INTEGER DEFAULT 100,
    active INTEGER DEFAULT 1,
    last_fired_at TEXT,
    fire_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS client_churn_predictions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    client_id TEXT NOT NULL UNIQUE,
    risk_score INTEGER NOT NULL,
    factors_json TEXT DEFAULT '[]',
    risk_level TEXT,
    days_since_last_invoice INTEGER,
    avg_payment_lag REAL,
    computed_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS client_ltv_snapshots (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    total_revenue REAL DEFAULT 0,
    paid_invoice_count INTEGER DEFAULT 0,
    avg_invoice_value REAL DEFAULT 0,
    first_invoice_date TEXT,
    last_invoice_date TEXT,
    months_active INTEGER DEFAULT 0,
    projected_ltv REAL DEFAULT 0,
    snapshot_at TEXT DEFAULT (datetime('now'))
  )`,
  // Invoice Upgrades Wave (F893-F922) — 30 serious upgrades across
  // builder UX, smart inference, client engagement, workflow,
  // analytics, bulk ops.
  `CREATE TABLE IF NOT EXISTS invoice_line_templates (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    lines_json TEXT NOT NULL DEFAULT '[]',
    times_used INTEGER DEFAULT 0,
    last_used_at TEXT,
    owner_user_id TEXT,
    visibility TEXT DEFAULT 'private',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS invoice_view_logs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    invoice_id TEXT NOT NULL,
    client_id TEXT,
    event_type TEXT NOT NULL,
    user_agent TEXT,
    ip_hash TEXT,
    referrer TEXT,
    metadata_json TEXT DEFAULT '{}',
    logged_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS invoice_email_templates_v2 (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    state TEXT,
    client_id TEXT,
    subject_template TEXT,
    body_template TEXT,
    is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS invoice_approval_rules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    priority INTEGER DEFAULT 100,
    min_amount REAL,
    max_amount REAL,
    client_id TEXT,
    approver_user_id TEXT,
    require_n_approvers INTEGER DEFAULT 1,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS invoice_payment_matches (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    invoice_id TEXT NOT NULL,
    bank_transaction_id TEXT,
    matched_amount REAL NOT NULL,
    confidence REAL DEFAULT 0,
    match_reasons_json TEXT DEFAULT '[]',
    status TEXT DEFAULT 'proposed',
    resolved_at TEXT,
    resolved_by TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS invoice_credit_memos (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    invoice_id TEXT NOT NULL,
    client_id TEXT,
    memo_number TEXT,
    amount REAL NOT NULL,
    reason TEXT,
    issued_date TEXT,
    applied_to_invoice_id TEXT,
    status TEXT DEFAULT 'issued',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS invoice_dso_cache (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    client_id TEXT,
    period_days INTEGER NOT NULL,
    dso_days REAL NOT NULL,
    sample_invoices INTEGER DEFAULT 0,
    computed_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, client_id, period_days)
  )`,
  `CREATE TABLE IF NOT EXISTS invoice_collection_scores (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    invoice_id TEXT NOT NULL UNIQUE,
    score INTEGER NOT NULL,
    factors_json TEXT DEFAULT '[]',
    risk_level TEXT,
    computed_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS invoice_smart_filters (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    user_id TEXT,
    name TEXT NOT NULL,
    filter_json TEXT NOT NULL DEFAULT '{}',
    is_system INTEGER DEFAULT 0,
    times_used INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  // Expense Upgrades Wave (F863-F892) — 30 upgrades across bulk ops,
  // smart filters, hygiene, approval workflow, insights, UX power.
  `CREATE TABLE IF NOT EXISTS expense_drafts (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    user_id TEXT,
    draft_json TEXT NOT NULL DEFAULT '{}',
    last_saved_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS expense_approval_rules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    priority INTEGER DEFAULT 100,
    min_amount REAL,
    max_amount REAL,
    category_id TEXT,
    project_id TEXT,
    vendor_id TEXT,
    payment_method TEXT,
    is_billable INTEGER,
    is_reimbursable INTEGER,
    approver_user_id TEXT,
    approver_role TEXT,
    require_n_approvers INTEGER DEFAULT 1,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS expense_approval_history (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    expense_id TEXT NOT NULL,
    actor_user_id TEXT,
    action TEXT NOT NULL,
    comment TEXT,
    metadata_json TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS expense_hygiene_scores (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    expense_id TEXT NOT NULL UNIQUE,
    score INTEGER NOT NULL,
    issues_json TEXT DEFAULT '[]',
    computed_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS expense_smart_filters (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    user_id TEXT,
    name TEXT NOT NULL,
    filter_json TEXT NOT NULL DEFAULT '{}',
    is_system INTEGER DEFAULT 0,
    times_used INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS expense_approval_delegations (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    delegator_user_id TEXT NOT NULL,
    delegate_user_id TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    reason TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS expense_duplicate_matches (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    expense_id TEXT NOT NULL,
    duplicate_of_id TEXT NOT NULL,
    confidence REAL NOT NULL,
    match_reasons_json TEXT DEFAULT '[]',
    resolved TEXT,
    resolution TEXT,
    detected_at TEXT DEFAULT (datetime('now'))
  )`,
  // Itemization Wave (F841-F862) — saved itemization templates so users
  // can reuse common line-item patterns (e.g. "Monthly office supplies",
  // "Travel reimbursement", "Marketing campaign breakdown").
  `CREATE TABLE IF NOT EXISTS expense_itemization_templates (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    lines_json TEXT NOT NULL DEFAULT '[]',
    times_used INTEGER DEFAULT 0,
    last_used_at TEXT,
    owner_user_id TEXT,
    visibility TEXT DEFAULT 'private',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS expense_year_end_rollups (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    tax_year INTEGER NOT NULL,
    total_expenses REAL DEFAULT 0,
    tax_deductible_total REAL DEFAULT 0,
    mileage_total REAL DEFAULT 0,
    by_category_json TEXT DEFAULT '[]',
    by_schedule_c_json TEXT DEFAULT '[]',
    generated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, tax_year)
  )`,
  // ─── Payroll Wave (F641-F740) ────────────────────────────────────
  // 40+ tables for pay-run engine, withholding, benefits, garnishments,
  // year-end filings (W-2, 940, 941), multi-state, workers comp, ACA.
  `CREATE TABLE IF NOT EXISTS pay_periods (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    pay_date TEXT NOT NULL,
    frequency TEXT DEFAULT 'biweekly',
    status TEXT DEFAULT 'open',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS pay_runs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    pay_period_id TEXT,
    run_number TEXT,
    run_type TEXT DEFAULT 'regular',
    status TEXT DEFAULT 'draft',
    total_gross REAL DEFAULT 0,
    total_net REAL DEFAULT 0,
    total_employer_tax REAL DEFAULT 0,
    total_employee_tax REAL DEFAULT 0,
    employee_count INTEGER DEFAULT 0,
    posted_at TEXT,
    posted_by TEXT,
    je_id TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS pay_run_items (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    pay_run_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    hours_regular REAL DEFAULT 0,
    hours_overtime REAL DEFAULT 0,
    hours_double_time REAL DEFAULT 0,
    hours_holiday REAL DEFAULT 0,
    hours_sick REAL DEFAULT 0,
    hours_vacation REAL DEFAULT 0,
    rate_regular REAL DEFAULT 0,
    rate_overtime REAL DEFAULT 0,
    gross_pay REAL DEFAULT 0,
    bonus REAL DEFAULT 0,
    commission REAL DEFAULT 0,
    pre_tax_deductions REAL DEFAULT 0,
    federal_withholding REAL DEFAULT 0,
    state_withholding REAL DEFAULT 0,
    local_withholding REAL DEFAULT 0,
    ss_employee REAL DEFAULT 0,
    medicare_employee REAL DEFAULT 0,
    addl_medicare REAL DEFAULT 0,
    suta REAL DEFAULT 0,
    futa REAL DEFAULT 0,
    sdi REAL DEFAULT 0,
    post_tax_deductions REAL DEFAULT 0,
    garnishments REAL DEFAULT 0,
    net_pay REAL DEFAULT 0,
    ss_employer REAL DEFAULT 0,
    medicare_employer REAL DEFAULT 0,
    futa_employer REAL DEFAULT 0,
    suta_employer REAL DEFAULT 0,
    benefits_employer REAL DEFAULT 0,
    pay_method TEXT DEFAULT 'check',
    check_number TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS paystubs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    pay_run_item_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    stub_number TEXT,
    pdf_path TEXT,
    ytd_gross REAL DEFAULT 0,
    ytd_net REAL DEFAULT 0,
    ytd_taxes REAL DEFAULT 0,
    ytd_deductions REAL DEFAULT 0,
    breakdown_json TEXT DEFAULT '{}',
    issued_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS federal_tax_tables (
    id TEXT PRIMARY KEY,
    tax_year INTEGER NOT NULL,
    filing_status TEXT NOT NULL,
    bracket_low REAL NOT NULL,
    bracket_high REAL,
    rate REAL NOT NULL,
    base_tax REAL DEFAULT 0,
    period_type TEXT DEFAULT 'annual',
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS state_tax_tables (
    id TEXT PRIMARY KEY,
    tax_year INTEGER NOT NULL,
    state_code TEXT NOT NULL,
    filing_status TEXT NOT NULL,
    bracket_low REAL NOT NULL,
    bracket_high REAL,
    rate REAL NOT NULL,
    base_tax REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS state_unemployment_rates (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    state_code TEXT NOT NULL,
    tax_year INTEGER NOT NULL,
    suta_rate REAL DEFAULT 0,
    wage_base REAL DEFAULT 0,
    effective_date TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    UNIQUE(company_id, state_code, tax_year)
  )`,
  `CREATE TABLE IF NOT EXISTS withholding_records (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    pay_run_item_id TEXT,
    tax_year INTEGER NOT NULL,
    quarter INTEGER,
    federal_withheld REAL DEFAULT 0,
    state_withheld REAL DEFAULT 0,
    local_withheld REAL DEFAULT 0,
    ss_withheld REAL DEFAULT 0,
    medicare_withheld REAL DEFAULT 0,
    record_date TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS employee_w4 (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    tax_year INTEGER NOT NULL,
    filing_status TEXT DEFAULT 'single',
    dependents INTEGER DEFAULT 0,
    other_income REAL DEFAULT 0,
    additional_withholding REAL DEFAULT 0,
    deductions REAL DEFAULT 0,
    multiple_jobs INTEGER DEFAULT 0,
    exempt INTEGER DEFAULT 0,
    signed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS benefit_plans (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    plan_name TEXT NOT NULL,
    plan_type TEXT NOT NULL,
    provider TEXT,
    employee_cost REAL DEFAULT 0,
    employer_cost REAL DEFAULT 0,
    pre_tax INTEGER DEFAULT 1,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS benefit_enrollments (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    plan_id TEXT NOT NULL,
    enrolled_at TEXT NOT NULL,
    ends_at TEXT,
    employee_contribution REAL DEFAULT 0,
    employer_contribution REAL DEFAULT 0,
    coverage_level TEXT DEFAULT 'employee',
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS deductions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    deduction_type TEXT NOT NULL,
    description TEXT,
    amount REAL DEFAULT 0,
    percent_of_gross REAL,
    pre_tax INTEGER DEFAULT 0,
    frequency TEXT DEFAULT 'each_pay',
    starts_at TEXT,
    ends_at TEXT,
    max_total REAL,
    accumulated REAL DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS retirement_contributions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    plan_type TEXT DEFAULT '401k',
    employee_percent REAL DEFAULT 0,
    employer_match_percent REAL DEFAULT 0,
    employer_match_cap REAL DEFAULT 0,
    ytd_employee REAL DEFAULT 0,
    ytd_employer REAL DEFAULT 0,
    catch_up INTEGER DEFAULT 0,
    tax_year INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS hsa_fsa_contributions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    account_type TEXT NOT NULL,
    annual_election REAL DEFAULT 0,
    per_pay_amount REAL DEFAULT 0,
    employer_contribution REAL DEFAULT 0,
    ytd_employee REAL DEFAULT 0,
    ytd_employer REAL DEFAULT 0,
    tax_year INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS garnishment_orders (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    order_number TEXT,
    garnishment_type TEXT NOT NULL,
    court_or_agency TEXT,
    creditor_name TEXT,
    total_amount REAL,
    per_pay_amount REAL DEFAULT 0,
    percent_of_disposable REAL,
    priority INTEGER DEFAULT 1,
    starts_at TEXT,
    ends_at TEXT,
    accumulated REAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS child_support_orders (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    case_number TEXT,
    state_agency TEXT,
    monthly_amount REAL DEFAULT 0,
    per_pay_amount REAL DEFAULT 0,
    arrears REAL DEFAULT 0,
    ccpa_limit REAL DEFAULT 0.5,
    payee_address TEXT,
    fips_code TEXT,
    medical_support INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS pay_advances (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    advance_amount REAL NOT NULL,
    advance_date TEXT,
    repayment_per_pay REAL DEFAULT 0,
    repayment_start TEXT,
    balance REAL DEFAULT 0,
    interest_rate REAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS bonuses (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    bonus_type TEXT DEFAULT 'discretionary',
    amount REAL DEFAULT 0,
    award_date TEXT,
    pay_date TEXT,
    pay_run_id TEXT,
    supplemental_rate REAL DEFAULT 0.22,
    reason TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS commissions_v2 (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    period_start TEXT,
    period_end TEXT,
    sales_amount REAL DEFAULT 0,
    commission_rate REAL DEFAULT 0,
    commission_amount REAL DEFAULT 0,
    tier_structure_json TEXT DEFAULT '[]',
    pay_run_id TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS overtime_rules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    rule_name TEXT NOT NULL,
    state_code TEXT,
    daily_threshold REAL DEFAULT 0,
    weekly_threshold REAL DEFAULT 40,
    double_time_after_hours REAL DEFAULT 0,
    seventh_day_double INTEGER DEFAULT 0,
    multiplier REAL DEFAULT 1.5,
    double_multiplier REAL DEFAULT 2,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS holiday_pay_rules (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    holiday_date TEXT NOT NULL,
    holiday_name TEXT,
    multiplier REAL DEFAULT 1.5,
    eligible_after_days INTEGER DEFAULT 0,
    applies_to TEXT DEFAULT 'all',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS time_off_accruals (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    accrual_type TEXT NOT NULL,
    accrual_method TEXT DEFAULT 'per_pay',
    rate_per_period REAL DEFAULT 0,
    rate_per_hour_worked REAL DEFAULT 0,
    cap_hours REAL,
    carryover_cap REAL,
    current_balance REAL DEFAULT 0,
    ytd_accrued REAL DEFAULT 0,
    ytd_used REAL DEFAULT 0,
    last_accrued_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS time_off_requests (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    request_type TEXT NOT NULL,
    starts_at TEXT,
    ends_at TEXT,
    hours_requested REAL DEFAULT 0,
    status TEXT DEFAULT 'pending',
    approver_id TEXT,
    approved_at TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS direct_deposit_batches (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    pay_run_id TEXT NOT NULL,
    batch_number TEXT,
    ach_file_path TEXT,
    total_amount REAL DEFAULT 0,
    item_count INTEGER DEFAULT 0,
    transmitted_at TEXT,
    status TEXT DEFAULT 'pending',
    nacha_hash TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS direct_deposit_accounts (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    routing_last4 TEXT,
    account_last4 TEXT,
    account_type TEXT DEFAULT 'checking',
    allocation_type TEXT DEFAULT 'remainder',
    allocation_value REAL DEFAULT 100,
    priority INTEGER DEFAULT 1,
    bank_name TEXT,
    verified INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS check_print_runs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    pay_run_id TEXT NOT NULL,
    starting_check_number INTEGER,
    check_count INTEGER DEFAULT 0,
    total_amount REAL DEFAULT 0,
    bank_account_id TEXT,
    printed_at TEXT,
    voided_at TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS contractor_pay_runs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    run_number TEXT,
    pay_date TEXT,
    contractor_count INTEGER DEFAULT 0,
    total_amount REAL DEFAULT 0,
    posted_at TEXT,
    status TEXT DEFAULT 'draft',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS contractor_pay_items (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    contractor_pay_run_id TEXT NOT NULL,
    vendor_id TEXT NOT NULL,
    description TEXT,
    amount REAL DEFAULT 0,
    pay_method TEXT DEFAULT 'check',
    reportable_1099 INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS form_w2_filings (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    tax_year INTEGER NOT NULL,
    employee_id TEXT NOT NULL,
    box1_wages REAL DEFAULT 0,
    box2_federal_tax REAL DEFAULT 0,
    box3_ss_wages REAL DEFAULT 0,
    box4_ss_tax REAL DEFAULT 0,
    box5_medicare_wages REAL DEFAULT 0,
    box6_medicare_tax REAL DEFAULT 0,
    box12_codes_json TEXT DEFAULT '[]',
    box14_other_json TEXT DEFAULT '[]',
    state_wages_json TEXT DEFAULT '[]',
    pdf_path TEXT,
    transmitted_at TEXT,
    status TEXT DEFAULT 'draft',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    UNIQUE(company_id, tax_year, employee_id)
  )`,
  `CREATE TABLE IF NOT EXISTS form_941_filings (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    tax_year INTEGER NOT NULL,
    quarter INTEGER NOT NULL,
    total_wages REAL DEFAULT 0,
    federal_tax_withheld REAL DEFAULT 0,
    ss_wages REAL DEFAULT 0,
    ss_tax REAL DEFAULT 0,
    medicare_wages REAL DEFAULT 0,
    medicare_tax REAL DEFAULT 0,
    addl_medicare_tax REAL DEFAULT 0,
    total_tax_liability REAL DEFAULT 0,
    deposits_made REAL DEFAULT 0,
    balance_due REAL DEFAULT 0,
    pdf_path TEXT,
    filed_at TEXT,
    status TEXT DEFAULT 'draft',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    UNIQUE(company_id, tax_year, quarter)
  )`,
  `CREATE TABLE IF NOT EXISTS form_940_filings (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    tax_year INTEGER NOT NULL,
    total_payments REAL DEFAULT 0,
    exempt_payments REAL DEFAULT 0,
    futa_wages REAL DEFAULT 0,
    futa_tax_before_adjustments REAL DEFAULT 0,
    credit_reduction REAL DEFAULT 0,
    futa_tax_after_adjustments REAL DEFAULT 0,
    deposits_made REAL DEFAULT 0,
    balance_due REAL DEFAULT 0,
    pdf_path TEXT,
    filed_at TEXT,
    status TEXT DEFAULT 'draft',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    UNIQUE(company_id, tax_year)
  )`,
  `CREATE TABLE IF NOT EXISTS form_1099_nec_filings (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    tax_year INTEGER NOT NULL,
    vendor_id TEXT NOT NULL,
    box1_nonemployee_comp REAL DEFAULT 0,
    box4_federal_withheld REAL DEFAULT 0,
    state_withheld_json TEXT DEFAULT '[]',
    pdf_path TEXT,
    transmitted_at TEXT,
    status TEXT DEFAULT 'draft',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    UNIQUE(company_id, tax_year, vendor_id)
  )`,
  `CREATE TABLE IF NOT EXISTS state_quarterly_filings (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    state_code TEXT NOT NULL,
    tax_year INTEGER NOT NULL,
    quarter INTEGER NOT NULL,
    form_type TEXT,
    total_wages REAL DEFAULT 0,
    taxable_wages REAL DEFAULT 0,
    tax_due REAL DEFAULT 0,
    employee_count INTEGER DEFAULT 0,
    pdf_path TEXT,
    filed_at TEXT,
    status TEXT DEFAULT 'draft',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    UNIQUE(company_id, state_code, tax_year, quarter)
  )`,
  `CREATE TABLE IF NOT EXISTS multi_state_allocations (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    state_code TEXT NOT NULL,
    allocation_percent REAL DEFAULT 0,
    work_location TEXT,
    effective_date TEXT,
    end_date TEXT,
    is_resident_state INTEGER DEFAULT 0,
    reciprocity_state TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS workers_comp_classifications (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    class_code TEXT NOT NULL,
    description TEXT,
    rate_per_100 REAL DEFAULT 0,
    state_code TEXT,
    effective_date TEXT,
    expiry_date TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS workers_comp_assignments (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    classification_id TEXT NOT NULL,
    effective_date TEXT,
    end_date TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS workers_comp_premium_calcs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    pay_run_id TEXT,
    employee_id TEXT NOT NULL,
    classification_id TEXT,
    payroll_amount REAL DEFAULT 0,
    rate_per_100 REAL DEFAULT 0,
    premium REAL DEFAULT 0,
    calc_date TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS aca_compliance_records (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    tax_year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    full_time INTEGER DEFAULT 0,
    hours_of_service REAL DEFAULT 0,
    offered_coverage INTEGER DEFAULT 0,
    coverage_code TEXT,
    safe_harbor_code TEXT,
    employee_share_lowest_cost REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    UNIQUE(company_id, employee_id, tax_year, month)
  )`,
  `CREATE TABLE IF NOT EXISTS cobra_records (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    qualifying_event TEXT NOT NULL,
    event_date TEXT NOT NULL,
    notice_sent_at TEXT,
    election_deadline TEXT,
    coverage_start TEXT,
    coverage_end TEXT,
    monthly_premium REAL DEFAULT 0,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS life_event_changes (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_date TEXT NOT NULL,
    benefits_window_end TEXT,
    documentation_path TEXT,
    benefits_updated INTEGER DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS compensation_history (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    change_date TEXT NOT NULL,
    change_type TEXT NOT NULL,
    old_amount REAL,
    new_amount REAL,
    old_rate_type TEXT,
    new_rate_type TEXT,
    reason TEXT,
    approved_by TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS gross_to_net_snapshots (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    pay_run_item_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    gross REAL DEFAULT 0,
    pre_tax_total REAL DEFAULT 0,
    taxable_gross REAL DEFAULT 0,
    tax_total REAL DEFAULT 0,
    post_tax_total REAL DEFAULT 0,
    garnishment_total REAL DEFAULT 0,
    net REAL DEFAULT 0,
    breakdown_json TEXT DEFAULT '{}',
    snapshot_date TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS payroll_journal_links (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    pay_run_id TEXT NOT NULL,
    journal_entry_id TEXT NOT NULL,
    posted_at TEXT,
    debit_total REAL DEFAULT 0,
    credit_total REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS pay_schedule_templates (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    schedule_name TEXT NOT NULL,
    frequency TEXT DEFAULT 'biweekly',
    first_period_start TEXT,
    pay_day_offset INTEGER DEFAULT 5,
    cutoff_offset INTEGER DEFAULT 2,
    weekend_handling TEXT DEFAULT 'before',
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS year_end_summaries (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    tax_year INTEGER NOT NULL,
    employee_count INTEGER DEFAULT 0,
    total_gross REAL DEFAULT 0,
    total_federal_withheld REAL DEFAULT 0,
    total_ss_employer REAL DEFAULT 0,
    total_medicare_employer REAL DEFAULT 0,
    total_futa REAL DEFAULT 0,
    total_suta REAL DEFAULT 0,
    by_employee_json TEXT DEFAULT '[]',
    generated_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    UNIQUE(company_id, tax_year)
  )`,
  // ─── Reporting & Dashboards Wave (F741-F840) ──────────────────────
  // Reporting is mostly read-side: definitions + snapshots, not transactions.
  // A "report" = definition (the spec) → run (an execution with frozen data).
  // Snapshots let you trend metrics over time without re-querying source rows.
  `CREATE TABLE IF NOT EXISTS report_definitions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT,
    category TEXT DEFAULT 'custom',
    source_table TEXT,
    sql_template TEXT,
    columns_json TEXT DEFAULT '[]',
    filters_json TEXT DEFAULT '[]',
    grouping TEXT,
    sort_by TEXT,
    chart_type TEXT,
    permission_level TEXT DEFAULT 'private',
    owner_user_id TEXT,
    is_system INTEGER DEFAULT 0,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS report_runs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    report_definition_id TEXT NOT NULL,
    run_by_user_id TEXT,
    parameters_json TEXT DEFAULT '{}',
    row_count INTEGER DEFAULT 0,
    elapsed_ms INTEGER DEFAULT 0,
    result_path TEXT,
    result_summary_json TEXT,
    status TEXT DEFAULT 'success',
    error_message TEXT,
    started_at TEXT,
    finished_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS report_saved_views (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    report_definition_id TEXT,
    name TEXT NOT NULL,
    filters_json TEXT DEFAULT '{}',
    columns_json TEXT DEFAULT '[]',
    sort_by TEXT,
    grouping TEXT,
    owner_user_id TEXT,
    visibility TEXT DEFAULT 'private',
    is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS scheduled_reports (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    report_definition_id TEXT NOT NULL,
    saved_view_id TEXT,
    schedule_cron TEXT,
    schedule_preset TEXT,
    recipients_json TEXT DEFAULT '[]',
    subject_template TEXT,
    body_template TEXT,
    format TEXT DEFAULT 'pdf',
    next_run_at TEXT,
    last_run_at TEXT,
    last_run_status TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS scheduled_report_history (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    scheduled_report_id TEXT NOT NULL,
    fired_at TEXT,
    status TEXT,
    recipient_count INTEGER DEFAULT 0,
    error_message TEXT,
    report_run_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS kpi_definitions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    key TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    formula TEXT,
    unit TEXT,
    direction TEXT DEFAULT 'higher_better',
    green_threshold REAL,
    yellow_threshold REAL,
    red_threshold REAL,
    target REAL,
    refresh_cadence TEXT DEFAULT 'daily',
    category TEXT,
    is_system INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT,
    UNIQUE(company_id, key)
  )`,
  `CREATE TABLE IF NOT EXISTS kpi_snapshots (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    kpi_key TEXT NOT NULL,
    period_start TEXT,
    period_end TEXT,
    value REAL,
    severity TEXT,
    inputs_json TEXT,
    snapshot_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS dashboards (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT,
    layout TEXT DEFAULT 'grid',
    columns INTEGER DEFAULT 12,
    owner_user_id TEXT,
    visibility TEXT DEFAULT 'private',
    is_default INTEGER DEFAULT 0,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS dashboard_widgets (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    dashboard_id TEXT NOT NULL,
    widget_type TEXT NOT NULL,
    title TEXT,
    kpi_key TEXT,
    report_definition_id TEXT,
    config_json TEXT DEFAULT '{}',
    position_x INTEGER DEFAULT 0,
    position_y INTEGER DEFAULT 0,
    width INTEGER DEFAULT 4,
    height INTEGER DEFAULT 3,
    refresh_seconds INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS variance_analyses (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    analysis_type TEXT NOT NULL,
    period_actual_start TEXT,
    period_actual_end TEXT,
    period_compare_start TEXT,
    period_compare_end TEXT,
    actual_total REAL,
    compare_total REAL,
    variance_amount REAL,
    variance_percent REAL,
    by_account_json TEXT,
    notes TEXT,
    generated_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS exec_summaries (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    period_start TEXT,
    period_end TEXT,
    summary_markdown TEXT,
    highlights_json TEXT DEFAULT '[]',
    risks_json TEXT DEFAULT '[]',
    recommendations_json TEXT DEFAULT '[]',
    generated_by TEXT DEFAULT 'auto',
    delivered_to_json TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS report_drill_audit (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    user_id TEXT,
    report_run_id TEXT,
    drill_target_table TEXT,
    drill_target_id TEXT,
    drill_path_json TEXT,
    drilled_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS report_export_jobs (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    report_run_id TEXT,
    format TEXT NOT NULL,
    output_path TEXT,
    size_bytes INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    started_at TEXT,
    finished_at TEXT,
    error_message TEXT,
    requested_by TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS narrative_templates (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    template_type TEXT,
    body_template TEXT,
    placeholders_json TEXT DEFAULT '[]',
    is_system INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS period_comparisons (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    comparison_type TEXT NOT NULL,
    period_a_start TEXT,
    period_a_end TEXT,
    period_b_start TEXT,
    period_b_end TEXT,
    metric_key TEXT,
    value_a REAL,
    value_b REAL,
    delta REAL,
    delta_percent REAL,
    computed_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS report_subscriptions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    report_definition_id TEXT,
    dashboard_id TEXT,
    delivery_channel TEXT DEFAULT 'in_app',
    cadence TEXT DEFAULT 'daily',
    last_delivered_at TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS dashboard_shares (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    dashboard_id TEXT NOT NULL,
    shared_with_user_id TEXT,
    shared_with_role TEXT,
    permission_level TEXT DEFAULT 'view',
    shared_by TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS report_alerts (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    kpi_key TEXT,
    report_definition_id TEXT,
    rule_type TEXT NOT NULL,
    threshold_value REAL,
    comparison_op TEXT DEFAULT '<',
    notify_channel TEXT DEFAULT 'in_app',
    recipients_json TEXT DEFAULT '[]',
    cooldown_minutes INTEGER DEFAULT 60,
    last_triggered_at TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS report_alert_events (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    alert_id TEXT NOT NULL,
    fired_at TEXT DEFAULT (datetime('now')),
    observed_value REAL,
    notified_count INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS report_column_metadata (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    source_table TEXT NOT NULL,
    column_name TEXT NOT NULL,
    display_name TEXT,
    data_type TEXT,
    format_hint TEXT,
    is_visible INTEGER DEFAULT 1,
    is_drillable INTEGER DEFAULT 0,
    drill_target_table TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS dashboard_versions (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    dashboard_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    snapshot_json TEXT,
    saved_by TEXT,
    note TEXT,
    saved_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS report_pin_cache (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    cache_key TEXT NOT NULL,
    cache_value_json TEXT,
    expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(company_id, cache_key)
  )`,
  `CREATE TABLE IF NOT EXISTS report_favorites (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    report_definition_id TEXT,
    dashboard_id TEXT,
    pinned_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS report_annotations (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    report_run_id TEXT,
    dashboard_id TEXT,
    widget_id TEXT,
    user_id TEXT,
    body TEXT,
    anchor_json TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS report_audit_log (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    user_id TEXT,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    metadata_json TEXT,
    logged_at TEXT DEFAULT (datetime('now'))
  )`,
  // ─── Data hygiene: remove orphaned invoice_tokens whose invoice_id
  // no longer exists. Tokens are ephemeral share links — when the
  // underlying invoice is hard-deleted, the token becomes dangling and
  // the schema validator flags it as an orphan FK. Idempotent + safe.
  "DELETE FROM invoice_tokens WHERE invoice_id NOT IN (SELECT id FROM invoices)",
  ];
  // SCHEMA: previously this loop swallowed ALL errors silently, so a
  // genuine schema problem (typo in CREATE TABLE, broken FK, etc.) was
  // indistinguishable from "column already exists" / "table already exists".
  // We now whitelist the known-idempotent error shapes and warn on anything
  // else so future destructive migrations surface in the logs.
  const isIdempotentMigrationError = (msg: string): boolean => {
    if (!msg) return false;
    return (
      /duplicate column name/i.test(msg) ||           // ALTER ADD COLUMN re-run
      /already exists/i.test(msg) ||                  // CREATE TABLE / INDEX re-run
      /index .* already exists/i.test(msg)
    );
  };
  for (const sql of migrations) {
    try {
      db.exec(sql);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (!isIdempotentMigrationError(msg)) {
        // eslint-disable-next-line no-console
        console.warn(`[migrations] non-idempotent error for SQL: ${sql.slice(0, 80)}… → ${msg}`);
      }
    }
  }

  // SCHEMA: minimal schema-version tracking. The migrations array above is
  // currently all-idempotent (ADD COLUMN / CREATE TABLE IF NOT EXISTS /
  // CREATE INDEX IF NOT EXISTS), so each migration tolerates being run on
  // every boot. If a future migration is NOT idempotent (e.g. UPDATE,
  // INSERT-without-guard, table rebuild), bump SCHEMA_VERSION below and run
  // the destructive step inside the `if (currentVersion < N)` block. We use
  // SQLite's built-in PRAGMA user_version rather than a `schema_migrations`
  // table because it requires zero extra DDL and is atomic per pragma write.
  try {
    const SCHEMA_VERSION = 2;
    const row = db.pragma('user_version', { simple: true }) as number;
    const currentVersion = typeof row === 'number' ? row : 0;

    // Version 2: Seed detailed tax-aligned expense accounts into existing companies
    if (currentVersion < 2) {
      const newAccounts: Array<{ code: string; name: string; type: string; subtype: string }> = [
        { code: '5000', name: 'Cost of Goods Sold', type: 'expense', subtype: 'cogs' },
        { code: '5200', name: 'Materials & Supplies (COGS)', type: 'expense', subtype: 'cogs' },
        { code: '5300', name: 'Freight & Shipping (COGS)', type: 'expense', subtype: 'cogs' },
        { code: '5400', name: 'Direct Labor', type: 'expense', subtype: 'cogs' },
        { code: '6050', name: 'Vehicle Expense', type: 'expense', subtype: 'operating' },
        { code: '6110', name: 'Credit Card Processing Fees', type: 'expense', subtype: 'operating' },
        { code: '6120', name: 'Stripe Processing Fees', type: 'expense', subtype: 'operating' },
        { code: '6150', name: 'Commissions & Fees', type: 'expense', subtype: 'operating' },
        { code: '6250', name: 'Depletion', type: 'expense', subtype: 'operating' },
        { code: '6310', name: 'Insurance — Health (Employees)', type: 'expense', subtype: 'operating' },
        { code: '6320', name: 'Insurance — Workers Comp', type: 'expense', subtype: 'operating' },
        { code: '6330', name: 'Insurance — Professional / E&O', type: 'expense', subtype: 'operating' },
        { code: '6340', name: 'Insurance — Vehicle', type: 'expense', subtype: 'operating' },
        { code: '6350', name: 'Insurance — Property', type: 'expense', subtype: 'operating' },
        { code: '6410', name: 'Postage & Shipping', type: 'expense', subtype: 'operating' },
        { code: '6420', name: 'Printing & Copying', type: 'expense', subtype: 'operating' },
        { code: '6450', name: 'Interest — Mortgage (Business)', type: 'expense', subtype: 'operating' },
        { code: '6460', name: 'Interest — Other Business Loans', type: 'expense', subtype: 'operating' },
        { code: '6500', name: 'Legal Fees', type: 'expense', subtype: 'operating' },
        { code: '6510', name: 'Accounting & Tax Preparation', type: 'expense', subtype: 'operating' },
        { code: '6520', name: 'Professional Services — Other', type: 'expense', subtype: 'operating' },
        { code: '6550', name: 'Rent — Office / Workspace', type: 'expense', subtype: 'operating' },
        { code: '6560', name: 'Rent — Equipment / Machinery', type: 'expense', subtype: 'operating' },
        { code: '6600', name: 'Repairs & Maintenance', type: 'expense', subtype: 'operating' },
        { code: '6650', name: 'Software & Subscriptions', type: 'expense', subtype: 'operating' },
        { code: '6660', name: 'Computer & IT Equipment', type: 'expense', subtype: 'operating' },
        { code: '6700', name: 'Taxes — Business License & Permits', type: 'expense', subtype: 'taxes' },
        { code: '6710', name: 'Taxes — Property', type: 'expense', subtype: 'taxes' },
        { code: '6720', name: 'Taxes — Sales / Use', type: 'expense', subtype: 'taxes' },
        { code: '6730', name: 'Taxes — State Franchise / Excise', type: 'expense', subtype: 'taxes' },
        { code: '6800', name: 'Travel — Airfare', type: 'expense', subtype: 'operating' },
        { code: '6810', name: 'Travel — Lodging', type: 'expense', subtype: 'operating' },
        { code: '6820', name: 'Travel — Ground Transportation', type: 'expense', subtype: 'operating' },
        { code: '6830', name: 'Meals — Business (50% deductible)', type: 'expense', subtype: 'operating' },
        { code: '6840', name: 'Entertainment (non-deductible)', type: 'expense', subtype: 'operating' },
        { code: '6850', name: 'Parking & Tolls', type: 'expense', subtype: 'operating' },
        { code: '6910', name: 'Utilities — Gas / Heating', type: 'expense', subtype: 'operating' },
        { code: '6920', name: 'Utilities — Water / Sewer', type: 'expense', subtype: 'operating' },
        { code: '6930', name: 'Utilities — Telephone / Internet', type: 'expense', subtype: 'operating' },
        { code: '6940', name: 'Utilities — Trash / Waste', type: 'expense', subtype: 'operating' },
        { code: '6950', name: 'Cell Phone', type: 'expense', subtype: 'operating' },
        { code: '7010', name: 'Payroll Tax Expense — FICA', type: 'expense', subtype: 'payroll' },
        { code: '7020', name: 'Payroll Tax Expense — FUTA', type: 'expense', subtype: 'payroll' },
        { code: '7030', name: 'Payroll Tax Expense — SUTA', type: 'expense', subtype: 'payroll' },
        { code: '7040', name: 'Employee Benefits', type: 'expense', subtype: 'payroll' },
        { code: '7050', name: 'Retirement Plan Contributions', type: 'expense', subtype: 'payroll' },
        { code: '7060', name: 'Workers Compensation Premium', type: 'expense', subtype: 'payroll' },
        { code: '7100', name: 'Officer Compensation', type: 'expense', subtype: 'payroll' },
        { code: '7210', name: 'Amortization Expense', type: 'expense', subtype: 'operating' },
        { code: '7220', name: 'Section 179 Expense', type: 'expense', subtype: 'operating' },
        { code: '7300', name: 'Education & Training', type: 'expense', subtype: 'operating' },
        { code: '7310', name: 'Conferences & Seminars', type: 'expense', subtype: 'operating' },
        { code: '7320', name: 'Dues & Memberships', type: 'expense', subtype: 'operating' },
        { code: '7330', name: 'Charitable Contributions', type: 'expense', subtype: 'operating' },
        { code: '7340', name: 'Books & Publications', type: 'expense', subtype: 'operating' },
        { code: '7400', name: 'Home Office — Direct Expenses', type: 'expense', subtype: 'operating' },
        { code: '7410', name: 'Home Office — Indirect Expenses', type: 'expense', subtype: 'operating' },
        { code: '8000', name: 'Bad Debts', type: 'expense', subtype: 'other' },
        { code: '8100', name: 'Penalties & Fines', type: 'expense', subtype: 'other' },
        { code: '8200', name: 'Loss on Disposal of Assets', type: 'expense', subtype: 'other' },
        { code: '8300', name: 'Foreign Currency Loss', type: 'expense', subtype: 'other' },
      ];
      try {
        const dbI = getDb();
        const companies = dbI.prepare('SELECT id FROM companies').all() as Array<{ id: string }>;
        const insertStmt = dbI.prepare(
          `INSERT OR IGNORE INTO accounts (id, company_id, code, name, type, subtype, is_active, balance)
           VALUES (?, ?, ?, ?, ?, ?, 1, 0)`
        );
        const seedTx = dbI.transaction(() => {
          for (const co of companies) {
            for (const acct of newAccounts) {
              // Skip if code already exists for this company
              const exists = dbI.prepare(
                'SELECT id FROM accounts WHERE company_id = ? AND code = ?'
              ).get(co.id, acct.code);
              if (!exists) {
                insertStmt.run(uuid(), co.id, acct.code, acct.name, acct.type, acct.subtype);
              }
            }
          }
        });
        seedTx();
      } catch (seedErr: any) {
        console.warn('[schema v2] Failed to seed new expense accounts:', seedErr?.message);
      }
    }

    if (currentVersion < SCHEMA_VERSION) {
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
    }
  } catch (_) { /* pragma failure is non-fatal */ }

  // Seed Utah state tax bracket (flat 4.55% per HB 106, 2025).
  try {
    const existing = db.prepare(
      `SELECT COUNT(*) as c FROM state_tax_brackets WHERE state = 'UT' AND year = 2025`
    ).get() as { c: number };
    if (!existing || existing.c === 0) {
      const id = `utbrk-2025-${Date.now()}`;
      db.prepare(
        `INSERT INTO state_tax_brackets (id, state, year, min_income, max_income, rate)
         VALUES (?, 'UT', 2025, 0, NULL, 0.0455)`
      ).run(id);
    }
  } catch (_) { /* ignore */ }

  // P4.49: seed IRS mileage rates (current + historical) for the
  // mileage_log auto-deduction calculation. Idempotent via INSERT OR IGNORE.
  try {
    const rates: Array<[number, number, number, number]> = [
      // [year, business, medical, charitable]
      [2024, 0.67, 0.21, 0.14],
      [2025, 0.70, 0.21, 0.14],
      [2026, 0.70, 0.21, 0.14], // mid-year update if/when IRS publishes
    ];
    const stmt = db.prepare(
      "INSERT OR IGNORE INTO mileage_rates (year, business_rate, medical_rate, charitable_rate) VALUES (?, ?, ?, ?)"
    );
    for (const r of rates) stmt.run(...r);
  } catch (_) { /* ignore */ }

  // P1.18: stamp the schema version + app version after migrations.
  // The version-pinning check at startup compares this against
  // APP_SCHEMA_VERSION; if a newer app wrote here, an older app
  // refuses to open the DB.
  try {
    const appVer = (require('electron').app?.getVersion?.() || '') as string;
    db.prepare(
      "UPDATE schema_meta SET version = ?, last_migrated_at = datetime('now'), app_version = ? WHERE id = 1"
    ).run(APP_SCHEMA_VERSION, appVer);
  } catch (_) { /* schema_meta may not exist on first-run pre-CREATE */ }

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

// ─── "WHO" SYSTEM accessors ──────────────────────────────
export function setCurrentUser(userId: string | null, userEmail: string | null = null): void {
  currentUserId = userId;
  currentUserEmail = userEmail;
}

export function getCurrentUserId(): string | null {
  return currentUserId;
}

export function getCurrentUserEmail(): string | null {
  return currentUserEmail;
}

export function clearCurrentUser(): void {
  currentUserId = null;
  currentUserEmail = null;
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

  // SCHEMA: auto-filter soft-deleted rows for tables with deleted_at.
  // Caller can override with `include_deleted: true` to see all rows.
  // The accounts table uses '' for live and a timestamp for deleted; tags/
  // custom_field_definitions use NULL for live. Cover both shapes.
  const includeDeleted = filters && (filters as any).include_deleted === true;
  if (filters && 'include_deleted' in filters) {
    delete (filters as any).include_deleted;
  }
  if (!includeDeleted && tablesWithDeletedAt.has(table)) {
    conditions.push(`COALESCE(deleted_at, '') = ''`);
  }

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

// ── P1.13: Soft-delete config ─────────────────────────────────
// Tables in this set get the soft-delete treatment: remove() sets
// deleted_at instead of physically removing the row; read helpers
// filter out soft-deleted records. Other tables behave as before
// (physical delete, no filter).
// SCHEMA: imported from tableConfig.ts as single source of truth.

export function getById(table: string, id: string): any {
  if (SOFT_DELETE_TABLES.has(table)) {
    return getDb().prepare(`SELECT * FROM ${table} WHERE id = ? AND deleted_at IS NULL`).get(id);
  }
  return getDb().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
}

// Bypasses the soft-delete filter — used by the Trash UI to load
// records the user is reviewing for restore/purge.
export function getByIdIncludingDeleted(table: string, id: string): any {
  return getDb().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
}

// Cache of known columns per table to avoid repeated PRAGMA queries.
// Cleared on schema reload (rare during runtime).
const tableColumnCache: Map<string, Set<string>> = new Map();

function getTableColumns(table: string): Set<string> {
  const cached = tableColumnCache.get(table);
  if (cached) return cached;
  try {
    const rows = getDb().prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    const cols = new Set(rows.map(r => r.name));
    tableColumnCache.set(table, cols);
    return cols;
  } catch {
    return new Set();
  }
}

export function create(table: string, data: Record<string, any>): any {
  const id = data.id || uuid();
  const record = { ...data, id };

  // SAFETY: filter out keys that aren't actual columns. Without this, a stale
  // form payload (e.g., a column added to the form but missing migration) blows
  // up the entire INSERT with "table has no column named X" — surfaced to the
  // user as "Failed to save". Now we silently drop unknown keys and log them.
  const knownCols = getTableColumns(table);
  const droppedKeys: string[] = [];

  const serialized: Record<string, any> = {};
  for (const [key, value] of Object.entries(record)) {
    if (knownCols.size > 0 && !knownCols.has(key)) {
      droppedKeys.push(key);
      continue;
    }
    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
      serialized[key] = JSON.stringify(value);
    } else if (typeof value === 'boolean') {
      serialized[key] = value ? 1 : 0;
    } else {
      serialized[key] = value;
    }
  }

  if (droppedKeys.length > 0) {
    console.warn(`[db.create:${table}] dropped unknown columns:`, droppedKeys);
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
// SCHEMA: tables that do NOT have an `updated_at` column. db.update() appends
// ", updated_at = datetime('now')" unless the table is in this set, so any
// table missing here AND missing the column will crash with
// "no such column: updated_at" on its first update.
// SCHEMA: tablesWithoutUpdatedAt imported from tableConfig.ts for single source of truth.
// Tables that do NOT have an updated_at column cause db.update() to append
// ", updated_at = datetime('now')" unless listed here, so missing a table
// from this set means an SQLite crash on first update.

// SCHEMA: tablesWithDeletedAt imported from tableConfig.ts for single source of truth.
// queryAll() auto-filters these to exclude soft-deleted rows unless the caller
// passes `include_deleted: true`.

export function update(table: string, id: string, data: Record<string, any>): any {
  // INTEGRITY: drop `id` and `created_at` defensively — these must never be
  // mutated. The IPC layer also strips them but a few internal callers go
  // through this path directly (e.g. when copying form state).
  if (data && typeof data === 'object') {
    if ('id' in data) delete (data as any).id;
    if ('created_at' in data) delete (data as any).created_at;
  }

  // SAFETY: filter out keys that aren't actual columns (matches db.create).
  const knownCols = getTableColumns(table);
  const droppedKeys: string[] = [];

  const serialized: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (knownCols.size > 0 && !knownCols.has(key)) {
      droppedKeys.push(key);
      continue;
    }
    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
      serialized[key] = JSON.stringify(value);
    } else if (typeof value === 'boolean') {
      serialized[key] = value ? 1 : 0;
    } else {
      serialized[key] = value;
    }
  }

  if (droppedKeys.length > 0) {
    console.warn(`[db.update:${table}] dropped unknown columns:`, droppedKeys);
  }

  if (Object.keys(serialized).length === 0) {
    // Nothing to update — return the existing row instead of building empty SQL.
    return getById(table, id);
  }

  const sets = Object.keys(serialized).map(k => `${k} = ?`).join(', ');
  const updatedAtClause = tablesWithoutUpdatedAt.has(table) ? '' : ", updated_at = datetime('now')";
  const sql = `UPDATE ${table} SET ${sets}${updatedAtClause} WHERE id = ?`;

  getDb().prepare(sql).run(...Object.values(serialized), id);
  return getById(table, id);
}

export function remove(table: string, id: string): void {
  // P1.13: soft-delete supported tables — sets deleted_at to now()
  // so the row stays physically present for 30 days, after which the
  // auto-purge cron physically removes it. User can restore from
  // Settings → Trash within that window.
  if (SOFT_DELETE_TABLES.has(table)) {
    getDb().prepare(
      `UPDATE ${table} SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL`
    ).run(id);
    return;
  }
  getDb().prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
}

// Force physical delete — used by Trash UI's "Purge" action and the
// auto-purge cron. Bypasses the soft-delete write entirely.
export function removeHard(table: string, id: string): void {
  getDb().prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
}

// Undo a soft-delete — used by Trash UI's "Restore" action. No-op
// for tables without deleted_at column.
export function restoreFromTrash(table: string, id: string): boolean {
  if (!SOFT_DELETE_TABLES.has(table)) return false;
  const result = getDb().prepare(
    `UPDATE ${table} SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL`
  ).run(id);
  return result.changes > 0;
}

// List all soft-deleted records across the supported tables for the
// active company. Returns up to `limit` per table sorted by deleted_at
// DESC so the most recently trashed appear first.
export function listTrash(companyId: string, limit: number = 100): Record<string, any[]> {
  const out: Record<string, any[]> = {};
  for (const table of SOFT_DELETE_TABLES) {
    try {
      out[table] = getDb().prepare(
        `SELECT * FROM ${table} WHERE company_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT ?`
      ).all(companyId, limit) as any[];
    } catch {
      out[table] = [];
    }
  }
  return out;
}

// Auto-purge: physically delete soft-deleted records older than the
// retention window. Called by the trash-purge cron daily. Returns
// per-table counts so the cron can log a summary.
export function purgeExpiredTrash(retentionDays: number = 30): Record<string, number> {
  const out: Record<string, number> = {};
  const cutoff = `datetime('now', '-${Math.max(1, Math.floor(retentionDays))} days')`;
  for (const table of SOFT_DELETE_TABLES) {
    try {
      const result = getDb().prepare(
        `DELETE FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}`
      ).run();
      out[table] = result.changes;
    } catch {
      out[table] = 0;
    }
  }
  return out;
}

export function logAudit(
  companyId: string,
  entityType: string,
  entityId: string,
  action: 'create' | 'update' | 'delete' | 'export_pdf' | 'email_pdf' | 'print' | (string & {}),
  changes: Record<string, any> = {}
): void {
  // Legacy CHECK constraint on audit_log.action only allows the original
  // three values; fall back to 'update' while preserving the real action
  // in `changes._action` so downstream UI still sees it.
  //
  // WHO: read from the module-level currentUserId/Email set by auth:login.
  // Falls back to 'system' for cron-triggered writes that run before any
  // user is logged in (e.g. boot-time migrations, auto-overdue checker).
  const actor = currentUserId
    ? (currentUserEmail ? `${currentUserEmail} (${currentUserId})` : currentUserId)
    : 'system';
  try {
    create('audit_log', {
      company_id: companyId,
      entity_type: entityType,
      entity_id: entityId,
      action,
      changes,
      performed_by: actor,
    });
  } catch (err: any) {
    if (/CHECK/i.test(err?.message ?? '')) {
      create('audit_log', {
        company_id: companyId,
        entity_type: entityType,
        entity_id: entityId,
        action: 'update',
        changes: { ...changes, _action: action },
        performed_by: actor,
      });
    } else {
      throw err;
    }
  }
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
    { code: '2210', name: 'FUTA Payable', type: 'liability', subtype: 'current' },        // FIX #1: employer FUTA
    { code: '2220', name: 'SUI Payable', type: 'liability', subtype: 'current' },         // FIX #1: employer SUI
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
    // ─── COGS (5000s) — IRS Schedule C Line 4 / Form 1120 Line 2 ───
    { code: '5000', name: 'Cost of Goods Sold', type: 'expense', subtype: 'cogs' },
    { code: '5100', name: 'Cost of Services', type: 'expense', subtype: 'cogs' },
    { code: '5200', name: 'Materials & Supplies (COGS)', type: 'expense', subtype: 'cogs' },
    { code: '5300', name: 'Freight & Shipping (COGS)', type: 'expense', subtype: 'cogs' },
    { code: '5400', name: 'Direct Labor', type: 'expense', subtype: 'cogs' },
    // ─── Operating Expenses (6000s) — IRS Schedule C Lines 8–27 ───
    { code: '6000', name: 'Advertising & Marketing', type: 'expense', subtype: 'operating' },    // Sch C Line 8
    { code: '6050', name: 'Vehicle Expense', type: 'expense', subtype: 'operating' },             // Sch C Line 9
    { code: '6100', name: 'Bank Fees & Service Charges', type: 'expense', subtype: 'operating' }, // Sch C Line 27a
    { code: '6110', name: 'Credit Card Processing Fees', type: 'expense', subtype: 'operating' },
    { code: '6120', name: 'Stripe Processing Fees', type: 'expense', subtype: 'operating' },
    { code: '6150', name: 'Commissions & Fees', type: 'expense', subtype: 'operating' },          // Sch C Line 10
    { code: '6200', name: 'Contract Labor', type: 'expense', subtype: 'operating' },              // Sch C Line 11
    { code: '6250', name: 'Depletion', type: 'expense', subtype: 'operating' },                   // Sch C Line 12
    { code: '6300', name: 'Insurance — General Liability', type: 'expense', subtype: 'operating' }, // Sch C Line 15
    { code: '6310', name: 'Insurance — Health (Employees)', type: 'expense', subtype: 'operating' },
    { code: '6320', name: 'Insurance — Workers Comp', type: 'expense', subtype: 'operating' },
    { code: '6330', name: 'Insurance — Professional / E&O', type: 'expense', subtype: 'operating' },
    { code: '6340', name: 'Insurance — Vehicle', type: 'expense', subtype: 'operating' },
    { code: '6350', name: 'Insurance — Property', type: 'expense', subtype: 'operating' },
    { code: '6400', name: 'Office Supplies', type: 'expense', subtype: 'operating' },             // Sch C Line 22
    { code: '6410', name: 'Postage & Shipping', type: 'expense', subtype: 'operating' },
    { code: '6420', name: 'Printing & Copying', type: 'expense', subtype: 'operating' },
    { code: '6450', name: 'Interest — Mortgage (Business)', type: 'expense', subtype: 'operating' }, // Sch C Line 16a
    { code: '6460', name: 'Interest — Other Business Loans', type: 'expense', subtype: 'operating' }, // Sch C Line 16b
    { code: '6500', name: 'Legal Fees', type: 'expense', subtype: 'operating' },                  // Sch C Line 17
    { code: '6510', name: 'Accounting & Tax Preparation', type: 'expense', subtype: 'operating' },
    { code: '6520', name: 'Professional Services — Other', type: 'expense', subtype: 'operating' },
    { code: '6550', name: 'Rent — Office / Workspace', type: 'expense', subtype: 'operating' },   // Sch C Line 20b
    { code: '6560', name: 'Rent — Equipment / Machinery', type: 'expense', subtype: 'operating' }, // Sch C Line 20a
    { code: '6600', name: 'Repairs & Maintenance', type: 'expense', subtype: 'operating' },       // Sch C Line 21
    { code: '6650', name: 'Software & Subscriptions', type: 'expense', subtype: 'operating' },
    { code: '6660', name: 'Computer & IT Equipment', type: 'expense', subtype: 'operating' },
    { code: '6700', name: 'Taxes — Business License & Permits', type: 'expense', subtype: 'taxes' }, // Sch C Line 23
    { code: '6710', name: 'Taxes — Property', type: 'expense', subtype: 'taxes' },
    { code: '6720', name: 'Taxes — Sales / Use', type: 'expense', subtype: 'taxes' },
    { code: '6730', name: 'Taxes — State Franchise / Excise', type: 'expense', subtype: 'taxes' },
    { code: '6800', name: 'Travel — Airfare', type: 'expense', subtype: 'operating' },            // Sch C Line 24a
    { code: '6810', name: 'Travel — Lodging', type: 'expense', subtype: 'operating' },
    { code: '6820', name: 'Travel — Ground Transportation', type: 'expense', subtype: 'operating' },
    { code: '6830', name: 'Meals — Business (50% deductible)', type: 'expense', subtype: 'operating' }, // Sch C Line 24b
    { code: '6840', name: 'Entertainment (non-deductible)', type: 'expense', subtype: 'operating' },
    { code: '6850', name: 'Parking & Tolls', type: 'expense', subtype: 'operating' },
    { code: '6900', name: 'Utilities — Electric', type: 'expense', subtype: 'operating' },        // Sch C Line 25
    { code: '6910', name: 'Utilities — Gas / Heating', type: 'expense', subtype: 'operating' },
    { code: '6920', name: 'Utilities — Water / Sewer', type: 'expense', subtype: 'operating' },
    { code: '6930', name: 'Utilities — Telephone / Internet', type: 'expense', subtype: 'operating' },
    { code: '6940', name: 'Utilities — Trash / Waste', type: 'expense', subtype: 'operating' },
    { code: '6950', name: 'Cell Phone', type: 'expense', subtype: 'operating' },
    // ─── Payroll (7000s) — IRS Schedule C Lines 14, 26 ───
    { code: '7000', name: 'Wages & Salaries', type: 'expense', subtype: 'payroll' },              // Sch C Line 26
    { code: '7010', name: 'Payroll Tax Expense — FICA', type: 'expense', subtype: 'payroll' },
    { code: '7020', name: 'Payroll Tax Expense — FUTA', type: 'expense', subtype: 'payroll' },
    { code: '7030', name: 'Payroll Tax Expense — SUTA', type: 'expense', subtype: 'payroll' },
    { code: '7040', name: 'Employee Benefits', type: 'expense', subtype: 'payroll' },             // Sch C Line 14
    { code: '7050', name: 'Retirement Plan Contributions', type: 'expense', subtype: 'payroll' },
    { code: '7060', name: 'Workers Compensation Premium', type: 'expense', subtype: 'payroll' },
    { code: '7100', name: 'Officer Compensation', type: 'expense', subtype: 'payroll' },          // Form 1120 Line 12
    // ─── Depreciation & Amortization (7200s) ───
    { code: '7200', name: 'Depreciation Expense', type: 'expense', subtype: 'operating' },        // Sch C Line 13
    { code: '7210', name: 'Amortization Expense', type: 'expense', subtype: 'operating' },
    { code: '7220', name: 'Section 179 Expense', type: 'expense', subtype: 'operating' },
    // ─── Education, Dues, Charitable (7300s) ───
    { code: '7300', name: 'Education & Training', type: 'expense', subtype: 'operating' },
    { code: '7310', name: 'Conferences & Seminars', type: 'expense', subtype: 'operating' },
    { code: '7320', name: 'Dues & Memberships', type: 'expense', subtype: 'operating' },
    { code: '7330', name: 'Charitable Contributions', type: 'expense', subtype: 'operating' },    // Form 1120 Line 19
    { code: '7340', name: 'Books & Publications', type: 'expense', subtype: 'operating' },
    // ─── Home Office (7400s) — Form 8829 ───
    { code: '7400', name: 'Home Office — Direct Expenses', type: 'expense', subtype: 'operating' },
    { code: '7410', name: 'Home Office — Indirect Expenses', type: 'expense', subtype: 'operating' },
    // ─── Bad Debt & Other (8000s–9000s) ───
    { code: '8000', name: 'Bad Debts', type: 'expense', subtype: 'other' },                       // Sch C Line 27a (bad debts)
    { code: '8100', name: 'Penalties & Fines', type: 'expense', subtype: 'other' },
    { code: '8200', name: 'Loss on Disposal of Assets', type: 'expense', subtype: 'other' },
    { code: '8300', name: 'Foreign Currency Loss', type: 'expense', subtype: 'other' },
    { code: '9000', name: 'Miscellaneous Expense', type: 'expense', subtype: 'other' },           // Sch C Line 27a catch-all
  ];

  for (const acct of defaults) {
    create('accounts', { company_id: companyId, ...acct });
  }
}
