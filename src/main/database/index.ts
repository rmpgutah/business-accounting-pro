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

// INTEGRITY: round a money value to 2 decimal places to avoid float drift.
// Use at the DB write boundary anywhere we accumulate (e.g. amount_paid +=
// payment.amount). Without this, repeated additions silently produce values
// like 100.00000000000001 which break equality checks downstream.
export function roundCents(value: any): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
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
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch (_) { /* column already exists — ignore */ }
  }

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
  'expense_line_items', 'debt_disputes',
  // DC Immersive Workspace — created_at only
  'debt_audit_log', 'debt_payment_matches',
  // Advanced debt collection — created_at only
  'debt_skip_traces', 'debt_campaigns',
  // Expense workflow — created_at only
  'expense_approval_steps', 'expense_comments', 'reimbursement_batches', 'period_locks',
  // Period close + reconciliation + compliance
  'period_close_checklist', 'period_close_log', 'account_reconciliations',
  'recon_schedule', 'recon_imports',
  'sox_controls', 'sox_control_tests', 'je_approvals',
  // CoA round 2 — created_at only
  'account_group_members', 'account_permissions', 'account_watches',
  'account_aliases', 'account_comments', 'account_classify_rules',
  'account_balance_history',
  // Workflow + email templates child tables — created_at only
  'custom_statuses', 'status_transitions', 'entity_status_history',
  'email_template_history', 'email_schedules',
]);

export function update(table: string, id: string, data: Record<string, any>): any {
  // INTEGRITY: drop `id` and `created_at` defensively — these must never be
  // mutated. The IPC layer also strips them but a few internal callers go
  // through this path directly (e.g. when copying form state).
  if (data && typeof data === 'object') {
    if ('id' in data) delete (data as any).id;
    if ('created_at' in data) delete (data as any).created_at;
  }
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
  action: 'create' | 'update' | 'delete' | 'export_pdf' | 'email_pdf' | 'print' | (string & {}),
  changes: Record<string, any> = {}
): void {
  // Legacy CHECK constraint on audit_log.action only allows the original
  // three values; fall back to 'update' while preserving the real action
  // in `changes._action` so downstream UI still sees it.
  try {
    create('audit_log', {
      company_id: companyId,
      entity_type: entityType,
      entity_id: entityId,
      action,
      changes,
      performed_by: 'user',
    });
  } catch (err: any) {
    if (/CHECK/i.test(err?.message ?? '')) {
      create('audit_log', {
        company_id: companyId,
        entity_type: entityType,
        entity_id: entityId,
        action: 'update',
        changes: { ...changes, _action: action },
        performed_by: 'user',
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
