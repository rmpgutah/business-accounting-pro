-- Business Accounting Pro — Database Schema

-- Users & Authentication (local accounts, hashed passwords)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'owner',   -- owner | admin | accountant | viewer
  avatar_color TEXT DEFAULT '#3b82f6',
  last_login TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Maps users to companies (multi-tenant: one user can access multiple companies)
CREATE TABLE IF NOT EXISTS user_companies (
  user_id TEXT NOT NULL REFERENCES users(id),
  company_id TEXT NOT NULL REFERENCES companies(id),
  role TEXT DEFAULT 'owner',
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, company_id)
);

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  legal_name TEXT DEFAULT '',
  tax_id TEXT DEFAULT '',
  address_line1 TEXT DEFAULT '',
  address_line2 TEXT DEFAULT '',
  city TEXT DEFAULT '',
  state TEXT DEFAULT '',
  zip TEXT DEFAULT '',
  country TEXT DEFAULT 'US',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  website TEXT DEFAULT '',
  fiscal_year_start INTEGER DEFAULT 1,
  industry TEXT DEFAULT '',
  logo_path TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('asset','liability','equity','revenue','expense')),
  subtype TEXT DEFAULT '',
  description TEXT DEFAULT '',
  is_active INTEGER DEFAULT 1,
  parent_id TEXT REFERENCES accounts(id),
  balance REAL DEFAULT 0,
  custom_fields TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(company_id, code)
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  entry_number TEXT NOT NULL,
  date TEXT NOT NULL,
  description TEXT DEFAULT '',
  reference TEXT DEFAULT '',
  is_adjusting INTEGER DEFAULT 0,
  is_posted INTEGER DEFAULT 0,
  created_by TEXT DEFAULT '',
  custom_fields TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(company_id, entry_number)
);

CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id TEXT PRIMARY KEY,
  journal_entry_id TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  description TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  type TEXT DEFAULT 'company' CHECK(type IN ('individual','company')),
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  address_line1 TEXT DEFAULT '',
  address_line2 TEXT DEFAULT '',
  city TEXT DEFAULT '',
  state TEXT DEFAULT '',
  zip TEXT DEFAULT '',
  country TEXT DEFAULT 'US',
  payment_terms INTEGER DEFAULT 30,
  tax_id TEXT DEFAULT '',
  status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive','prospect')),
  notes TEXT DEFAULT '',
  tags TEXT DEFAULT '[]',
  portal_token TEXT,
  custom_fields TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  tax_id TEXT DEFAULT '',
  payment_terms INTEGER DEFAULT 30,
  notes TEXT DEFAULT '',
  status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
  custom_fields TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  client_id TEXT REFERENCES clients(id),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'active' CHECK(status IN ('active','completed','on_hold','archived')),
  budget REAL DEFAULT 0,
  budget_type TEXT DEFAULT 'none' CHECK(budget_type IN ('fixed','hourly','none')),
  hourly_rate REAL DEFAULT 0,
  start_date TEXT,
  end_date TEXT,
  tags TEXT DEFAULT '[]',
  custom_fields TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recurring_templates (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  type TEXT NOT NULL CHECK(type IN ('invoice','expense')),
  name TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK(frequency IN ('weekly','biweekly','monthly','quarterly','annually')),
  next_date TEXT NOT NULL,
  end_date TEXT,
  is_active INTEGER DEFAULT 1,
  template_data TEXT DEFAULT '{}',
  last_generated TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  invoice_number TEXT NOT NULL,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft','sent','paid','overdue','cancelled','partial')),
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  subtotal REAL DEFAULT 0,
  tax_amount REAL DEFAULT 0,
  discount_amount REAL DEFAULT 0,
  total REAL DEFAULT 0,
  amount_paid REAL DEFAULT 0,
  notes TEXT DEFAULT '',
  terms TEXT DEFAULT '',
  is_recurring INTEGER DEFAULT 0,
  recurring_template_id TEXT REFERENCES recurring_templates(id),
  custom_fields TEXT DEFAULT '{}',
  rules_applied TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(company_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity REAL DEFAULT 1,
  unit_price REAL DEFAULT 0,
  amount REAL DEFAULT 0,
  tax_rate REAL DEFAULT 0,
  account_id TEXT REFERENCES accounts(id),
  project_id TEXT REFERENCES projects(id),
  time_entry_ids TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  vendor_id TEXT REFERENCES vendors(id),
  category_id TEXT DEFAULT '',
  account_id TEXT REFERENCES accounts(id),
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  tax_amount REAL DEFAULT 0,
  description TEXT DEFAULT '',
  reference TEXT DEFAULT '',
  is_billable INTEGER DEFAULT 0,
  is_reimbursable INTEGER DEFAULT 0,
  reimbursed INTEGER DEFAULT 0,
  reimbursed_date TEXT DEFAULT '',
  project_id TEXT REFERENCES projects(id),
  client_id TEXT REFERENCES clients(id),
  receipt_path TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','paid')),
  payment_method TEXT DEFAULT '',
  is_recurring INTEGER DEFAULT 0,
  recurring_template_id TEXT REFERENCES recurring_templates(id),
  tags TEXT DEFAULT '[]',
  custom_fields TEXT DEFAULT '{}',
  rules_applied TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  email TEXT DEFAULT '',
  type TEXT DEFAULT 'employee' CHECK(type IN ('employee','contractor')),
  pay_type TEXT DEFAULT 'hourly' CHECK(pay_type IN ('salary','hourly')),
  pay_rate REAL DEFAULT 0,
  pay_schedule TEXT DEFAULT 'biweekly' CHECK(pay_schedule IN ('weekly','biweekly','semimonthly','monthly')),
  filing_status TEXT DEFAULT 'single',
  federal_allowances INTEGER DEFAULT 0,
  state TEXT DEFAULT '',
  state_allowances INTEGER DEFAULT 0,
  start_date TEXT,
  end_date TEXT,
  ssn_last4 TEXT DEFAULT '',
  status TEXT DEFAULT 'active' CHECK(status IN ('active','inactive')),
  custom_fields TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  pay_period_start TEXT NOT NULL,
  pay_period_end TEXT NOT NULL,
  pay_date TEXT NOT NULL,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft','processed','paid')),
  total_gross REAL DEFAULT 0,
  total_net REAL DEFAULT 0,
  total_taxes REAL DEFAULT 0,
  total_deductions REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pay_stubs (
  id TEXT PRIMARY KEY,
  payroll_run_id TEXT NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL REFERENCES employees(id),
  hours_regular REAL DEFAULT 0,
  hours_overtime REAL DEFAULT 0,
  gross_pay REAL DEFAULT 0,
  federal_tax REAL DEFAULT 0,
  state_tax REAL DEFAULT 0,
  social_security REAL DEFAULT 0,
  medicare REAL DEFAULT 0,
  other_deductions REAL DEFAULT 0,
  net_pay REAL DEFAULT 0,
  ytd_gross REAL DEFAULT 0,
  ytd_taxes REAL DEFAULT 0,
  ytd_net REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS time_entries (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  employee_id TEXT REFERENCES employees(id),
  client_id TEXT REFERENCES clients(id),
  project_id TEXT REFERENCES projects(id),
  date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  duration_minutes INTEGER DEFAULT 0,
  description TEXT DEFAULT '',
  is_billable INTEGER DEFAULT 1,
  is_invoiced INTEGER DEFAULT 0,
  invoice_id TEXT REFERENCES invoices(id),
  hourly_rate REAL DEFAULT 0,
  tags TEXT DEFAULT '[]',
  custom_fields TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tax_categories (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  schedule_c_line TEXT DEFAULT '',
  is_deductible INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tax_payments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  type TEXT NOT NULL,
  amount REAL NOT NULL,
  date TEXT NOT NULL,
  period TEXT DEFAULT '',
  year INTEGER NOT NULL,
  confirmation_number TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  period TEXT DEFAULT 'monthly' CHECK(period IN ('monthly','quarterly','annual')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','closed')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS budget_lines (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES accounts(id),
  category TEXT DEFAULT '',
  amount REAL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  sku TEXT DEFAULT '',
  description TEXT DEFAULT '',
  category TEXT DEFAULT '',
  quantity REAL DEFAULT 0,
  unit_cost REAL DEFAULT 0,
  reorder_point REAL DEFAULT 0,
  is_asset INTEGER DEFAULT 0,
  depreciation_method TEXT DEFAULT 'none',
  useful_life_years INTEGER DEFAULT 0,
  salvage_value REAL DEFAULT 0,
  purchase_date TEXT,
  custom_fields TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  account_number_last4 TEXT DEFAULT '',
  institution TEXT DEFAULT '',
  account_id TEXT REFERENCES accounts(id),
  current_balance REAL DEFAULT 0,
  last_reconciled_date TEXT,
  last_reconciled_balance REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id TEXT PRIMARY KEY,
  bank_account_id TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  description TEXT DEFAULT '',
  amount REAL NOT NULL,
  type TEXT CHECK(type IN ('debit','credit')),
  reference TEXT DEFAULT '',
  is_matched INTEGER DEFAULT 0,
  matched_entry_id TEXT REFERENCES journal_entries(id),
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','matched','excluded')),
  imported_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER DEFAULT 0,
  mime_type TEXT DEFAULT '',
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  tags TEXT DEFAULT '[]',
  description TEXT DEFAULT '',
  uploaded_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('create','update','delete')),
  changes TEXT DEFAULT '{}',
  performed_by TEXT DEFAULT '',
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT DEFAULT '',
  entity_type TEXT,
  entity_id TEXT,
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stripe_transactions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  stripe_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK(type IN ('payment','refund','payout','fee')),
  amount REAL NOT NULL,
  fee REAL DEFAULT 0,
  net REAL DEFAULT 0,
  currency TEXT DEFAULT 'usd',
  description TEXT DEFAULT '',
  customer_id TEXT DEFAULT '',
  client_id TEXT REFERENCES clients(id),
  invoice_id TEXT REFERENCES invoices(id),
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','matched','excluded')),
  stripe_created TEXT,
  synced_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS email_log (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  recipient TEXT NOT NULL,
  subject TEXT DEFAULT '',
  body_preview TEXT DEFAULT '',
  entity_type TEXT DEFAULT '',
  entity_id TEXT DEFAULT '',
  status TEXT DEFAULT 'sent' CHECK(status IN ('sent','failed')),
  error TEXT,
  sent_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS custom_field_defs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  entity_type TEXT NOT NULL,
  field_name TEXT NOT NULL,
  field_label TEXT NOT NULL,
  field_type TEXT DEFAULT 'text' CHECK(field_type IN ('text','number','date','select','boolean')),
  options TEXT DEFAULT '[]',
  is_required INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(company_id, entity_type, field_name)
);

CREATE TABLE IF NOT EXISTS saved_views (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  module TEXT NOT NULL,
  name TEXT NOT NULL,
  filters TEXT DEFAULT '{}',
  sort TEXT DEFAULT '{}',
  columns TEXT DEFAULT '[]',
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  key TEXT NOT NULL,
  value TEXT DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(company_id, key)
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  type TEXT DEFAULT 'expense' CHECK(type IN ('income','expense')),
  color TEXT DEFAULT '#6b7280',
  icon TEXT DEFAULT '',
  description TEXT DEFAULT '',
  is_active INTEGER DEFAULT 1,
  parent_id TEXT REFERENCES categories(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  amount REAL NOT NULL,
  date TEXT NOT NULL,
  payment_method TEXT DEFAULT '',
  reference TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bank_reconciliation_matches (
  id TEXT PRIMARY KEY,
  bank_transaction_id TEXT NOT NULL REFERENCES bank_transactions(id),
  journal_entry_id TEXT REFERENCES journal_entries(id),
  journal_entry_line_id TEXT REFERENCES journal_entry_lines(id),
  match_type TEXT DEFAULT 'manual' CHECK(match_type IN ('manual','auto')),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_accounts_company ON accounts(company_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_company_date ON journal_entries(company_id, date);
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_entry ON journal_entry_lines(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_clients_company ON clients(company_id);
CREATE INDEX IF NOT EXISTS idx_invoices_company_status ON invoices(company_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_expenses_company_date ON expenses(company_id, date);
CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_company_date ON time_entries(company_id, date);
CREATE INDEX IF NOT EXISTS idx_time_entries_project ON time_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_projects_company ON projects(company_id);
CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_notifications_company_read ON notifications(company_id, is_read);
CREATE INDEX IF NOT EXISTS idx_documents_entity ON documents(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_account ON bank_transactions(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_stripe_transactions_company ON stripe_transactions(company_id);

-- ═══════════════════════════════════════════════════════
-- STRIPE OFFLINE CACHE
-- Generic per-resource cache so the Stripe browser works
-- without network. Each row is one Stripe object, keyed by
-- (company, resource, stripe_id). `data` is the raw JSON
-- returned by Stripe so downstream code can rehydrate it.
-- ═══════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS stripe_cache (
  id TEXT PRIMARY KEY,                              -- uuid, not the stripe id
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,                           -- e.g. 'charges', 'customers'
  stripe_id TEXT NOT NULL,                          -- the Stripe object's id
  data TEXT NOT NULL,                               -- JSON payload
  stripe_created INTEGER,                           -- unix seconds from object.created (if present)
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_stale INTEGER NOT NULL DEFAULT 0,              -- marked true when a write was queued offline
  UNIQUE(company_id, resource, stripe_id)
);
CREATE INDEX IF NOT EXISTS idx_stripe_cache_res ON stripe_cache(company_id, resource, synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_cache_created ON stripe_cache(company_id, resource, stripe_created DESC);

-- Queue for write operations performed while offline. Drained on reconnect.
CREATE TABLE IF NOT EXISTS stripe_offline_queue (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  action TEXT NOT NULL,                             -- list/create/update/delete/custom action name
  stripe_id TEXT,                                   -- target object id if update/delete/custom
  params TEXT,                                      -- JSON encoded params
  idempotency_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_attempt_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  status TEXT NOT NULL DEFAULT 'pending'            -- pending | done | failed
);
CREATE INDEX IF NOT EXISTS idx_stripe_queue_pending ON stripe_offline_queue(company_id, status);

-- Per-resource sync metadata — drives "last updated" badge and incremental fetch cursors.
CREATE TABLE IF NOT EXISTS stripe_sync_state (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  resource TEXT NOT NULL,
  last_synced_at TEXT,
  last_ok_at TEXT,
  last_error TEXT,
  UNIQUE(company_id, resource)
);

-- ═══════════════════════════════════════════════════════
-- ENTERPRISE ADDITIONS v2.0
-- ═══════════════════════════════════════════════════════

-- Accounts Payable: Vendor Bills
CREATE TABLE IF NOT EXISTS bills (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  vendor_id TEXT REFERENCES vendors(id),
  bill_number TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('draft','pending','received','approved','partial','paid','overdue','void')),
  issue_date TEXT NOT NULL,
  due_date TEXT,
  subtotal REAL DEFAULT 0,
  tax_amount REAL DEFAULT 0,
  discount_amount REAL DEFAULT 0,
  total REAL DEFAULT 0,
  amount_paid REAL DEFAULT 0,
  notes TEXT DEFAULT '',
  reference TEXT DEFAULT '',
  account_id TEXT REFERENCES accounts(id),
  custom_fields TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(company_id, bill_number)
);

CREATE TABLE IF NOT EXISTS bill_line_items (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  description TEXT DEFAULT '',
  quantity REAL DEFAULT 1,
  unit_price REAL DEFAULT 0,
  amount REAL DEFAULT 0,
  tax_rate REAL DEFAULT 0,
  account_id TEXT REFERENCES accounts(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bill_payments (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  bill_id TEXT NOT NULL REFERENCES bills(id),
  amount REAL NOT NULL,
  date TEXT NOT NULL,
  payment_method TEXT DEFAULT 'check',
  reference TEXT DEFAULT '',
  account_id TEXT REFERENCES accounts(id),
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

-- Purchase Orders
CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  vendor_id TEXT REFERENCES vendors(id),
  po_number TEXT NOT NULL,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft','sent','approved','partially_received','received','cancelled')),
  issue_date TEXT NOT NULL,
  expected_date TEXT,
  subtotal REAL DEFAULT 0,
  tax_amount REAL DEFAULT 0,
  total REAL DEFAULT 0,
  notes TEXT DEFAULT '',
  terms TEXT DEFAULT '',
  approved_by TEXT DEFAULT '',
  approved_at TEXT,
  custom_fields TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(company_id, po_number)
);

CREATE TABLE IF NOT EXISTS po_line_items (
  id TEXT PRIMARY KEY,
  po_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  description TEXT DEFAULT '',
  quantity REAL DEFAULT 1,
  unit_price REAL DEFAULT 0,
  amount REAL DEFAULT 0,
  quantity_received REAL DEFAULT 0,
  account_id TEXT REFERENCES accounts(id),
  item_id TEXT REFERENCES inventory_items(id),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Fixed Assets & Depreciation
CREATE TABLE IF NOT EXISTS fixed_assets (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  asset_code TEXT DEFAULT '',
  category TEXT DEFAULT 'equipment',
  description TEXT DEFAULT '',
  purchase_date TEXT NOT NULL,
  purchase_price REAL DEFAULT 0,
  salvage_value REAL DEFAULT 0,
  useful_life_years REAL DEFAULT 5,
  depreciation_method TEXT DEFAULT 'straight_line' CHECK(depreciation_method IN ('straight_line','double_declining','sum_of_years_digits','units_of_production')),
  asset_account_id TEXT REFERENCES accounts(id),
  depreciation_account_id TEXT REFERENCES accounts(id),
  accumulated_depreciation_account_id TEXT REFERENCES accounts(id),
  current_book_value REAL DEFAULT 0,
  accumulated_depreciation REAL DEFAULT 0,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','disposed','fully_depreciated')),
  serial_number TEXT DEFAULT '',
  location TEXT DEFAULT '',
  disposal_date TEXT,
  disposal_amount REAL DEFAULT 0,
  notes TEXT DEFAULT '',
  custom_fields TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS asset_depreciation_entries (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
  period_date TEXT NOT NULL,
  period_label TEXT DEFAULT '',
  depreciation_amount REAL DEFAULT 0,
  accumulated_depreciation REAL DEFAULT 0,
  book_value REAL DEFAULT 0,
  journal_entry_id TEXT REFERENCES journal_entries(id),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Bank Auto-Categorization Rules
CREATE TABLE IF NOT EXISTS bank_rules (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  priority INTEGER DEFAULT 0,
  match_type TEXT DEFAULT 'contains' CHECK(match_type IN ('contains','starts_with','ends_with','exact','regex')),
  match_field TEXT DEFAULT 'description' CHECK(match_field IN ('description','amount','reference')),
  match_value TEXT NOT NULL,
  amount_min REAL,
  amount_max REAL,
  transaction_type TEXT DEFAULT 'any' CHECK(transaction_type IN ('debit','credit','any','')),
  action_account_id TEXT REFERENCES accounts(id),
  action_category_id TEXT REFERENCES categories(id),
  action_vendor_id TEXT REFERENCES vendors(id),
  action_description TEXT DEFAULT '',
  times_applied INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Tax Rate Library
CREATE TABLE IF NOT EXISTS tax_rates (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  rate REAL NOT NULL,
  type TEXT DEFAULT 'sales' CHECK(type IN ('sales','purchase','compound','vat')),
  is_default INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  description TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Credit Notes
CREATE TABLE IF NOT EXISTS credit_notes (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  client_id TEXT REFERENCES clients(id),
  invoice_id TEXT REFERENCES invoices(id),
  credit_number TEXT NOT NULL,
  status TEXT DEFAULT 'open' CHECK(status IN ('draft','open','applied','void')),
  issue_date TEXT NOT NULL,
  subtotal REAL DEFAULT 0,
  tax_amount REAL DEFAULT 0,
  total REAL DEFAULT 0,
  amount_applied REAL DEFAULT 0,
  notes TEXT DEFAULT '',
  reason TEXT DEFAULT '',
  custom_fields TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(company_id, credit_number)
);

CREATE TABLE IF NOT EXISTS credit_note_items (
  id TEXT PRIMARY KEY,
  credit_note_id TEXT NOT NULL REFERENCES credit_notes(id) ON DELETE CASCADE,
  description TEXT DEFAULT '',
  quantity REAL DEFAULT 1,
  unit_price REAL DEFAULT 0,
  amount REAL DEFAULT 0,
  tax_rate REAL DEFAULT 0,
  account_id TEXT REFERENCES accounts(id),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Departments / Cost Centers (Dimensional Analysis)
CREATE TABLE IF NOT EXISTS dimensions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  type TEXT DEFAULT 'department' CHECK(type IN ('department','cost_center','location','project_type','region')),
  parent_id TEXT REFERENCES dimensions(id),
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(company_id, code)
);

-- Employee Deductions & Benefits
CREATE TABLE IF NOT EXISTS employee_deductions (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  name TEXT NOT NULL,
  type TEXT DEFAULT 'deduction' CHECK(type IN ('deduction','benefit','garnishment','retirement')),
  calculation TEXT DEFAULT 'fixed' CHECK(calculation IN ('fixed','percentage')),
  amount REAL DEFAULT 0,
  is_pretax INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  effective_date TEXT,
  end_date TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Dynamic Federal Tax Brackets (multi-year, auto-updating)
CREATE TABLE IF NOT EXISTS federal_tax_brackets (
  id TEXT PRIMARY KEY,
  tax_year INTEGER NOT NULL,
  filing_status TEXT NOT NULL CHECK(filing_status IN ('single','married_jointly','married_separately','head_of_household')),
  bracket_min REAL NOT NULL,
  bracket_max REAL,  -- NULL = no upper limit
  rate REAL NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tax_year, filing_status, bracket_min)
);

-- Federal Payroll Constants (FICA, FUTA, standard deductions by year)
CREATE TABLE IF NOT EXISTS federal_payroll_constants (
  id TEXT PRIMARY KEY,
  tax_year INTEGER NOT NULL UNIQUE,
  ss_wage_base REAL NOT NULL,
  ss_rate REAL NOT NULL DEFAULT 0.062,
  medicare_rate REAL NOT NULL DEFAULT 0.0145,
  medicare_additional_rate REAL NOT NULL DEFAULT 0.009,
  medicare_additional_threshold_single REAL NOT NULL DEFAULT 200000,
  medicare_additional_threshold_married REAL NOT NULL DEFAULT 250000,
  futa_rate REAL NOT NULL DEFAULT 0.006,
  futa_wage_base REAL NOT NULL DEFAULT 7000,
  standard_deduction_single REAL NOT NULL,
  standard_deduction_married REAL NOT NULL,
  standard_deduction_hoh REAL NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- State Tax Rates
CREATE TABLE IF NOT EXISTS state_tax_rates (
  id TEXT PRIMARY KEY,
  tax_year INTEGER NOT NULL,
  state_code TEXT NOT NULL,
  state_name TEXT NOT NULL,
  rate REAL NOT NULL,
  flat_rate INTEGER DEFAULT 0,  -- 1 if flat rate, 0 if progressive
  wage_base REAL,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(tax_year, state_code)
);

-- Report Templates (saved configurations)
CREATE TABLE IF NOT EXISTS report_templates (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  report_type TEXT NOT NULL,
  name TEXT NOT NULL,
  config TEXT DEFAULT '{}',
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Exchange Rates
CREATE TABLE IF NOT EXISTS exchange_rates (
  id TEXT PRIMARY KEY,
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  rate REAL NOT NULL,
  effective_date TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(from_currency, to_currency, effective_date)
);

-- ─── Enterprise Indexes ─────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_bills_company_status ON bills(company_id, status);
CREATE INDEX IF NOT EXISTS idx_bills_vendor ON bills(vendor_id);
CREATE INDEX IF NOT EXISTS idx_bill_payments_bill ON bill_payments(bill_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_company ON purchase_orders(company_id, status);
CREATE INDEX IF NOT EXISTS idx_fixed_assets_company ON fixed_assets(company_id, status);
CREATE INDEX IF NOT EXISTS idx_asset_depreciation_asset ON asset_depreciation_entries(asset_id);
CREATE INDEX IF NOT EXISTS idx_bank_rules_company ON bank_rules(company_id, is_active);
CREATE INDEX IF NOT EXISTS idx_credit_notes_company ON credit_notes(company_id, status);
CREATE INDEX IF NOT EXISTS idx_credit_notes_client ON credit_notes(client_id);
CREATE INDEX IF NOT EXISTS idx_dimensions_company ON dimensions(company_id);
CREATE INDEX IF NOT EXISTS idx_employee_deductions_employee ON employee_deductions(employee_id);
CREATE INDEX IF NOT EXISTS idx_federal_brackets_year ON federal_tax_brackets(tax_year, filing_status);
CREATE INDEX IF NOT EXISTS idx_state_tax_year ON state_tax_rates(tax_year, state_code);

-- ─── Sync & Intelligence Tables ──────────────────────────
-- Sync queue (offline support)
CREATE TABLE IF NOT EXISTS sync_queue (
  id TEXT PRIMARY KEY,
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('create','update','delete')),
  record_id TEXT NOT NULL,
  company_id TEXT,
  payload TEXT NOT NULL,
  queued_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  attempts INTEGER NOT NULL DEFAULT 0
);

-- Invoice tokens (portal links)
CREATE TABLE IF NOT EXISTS invoice_tokens (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL UNIQUE,
  company_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- Automation rules
CREATE TABLE IF NOT EXISTS automation_rules (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  trigger_type TEXT NOT NULL,
  trigger_config TEXT NOT NULL DEFAULT '{}',
  conditions TEXT NOT NULL DEFAULT '[]',
  actions TEXT NOT NULL DEFAULT '[]',
  last_run_at INTEGER,
  run_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS automation_run_log (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  ran_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  status TEXT NOT NULL CHECK(status IN ('pass','fail','skip')),
  detail TEXT
);

CREATE TABLE IF NOT EXISTS financial_anomalies (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  anomaly_type TEXT NOT NULL,
  description TEXT NOT NULL,
  amount REAL,
  category TEXT,
  detected_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  dismissed INTEGER NOT NULL DEFAULT 0
);

-- Rules Engine
CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  category TEXT NOT NULL CHECK(category IN ('bank','automation','pricing','tax','approval','alert')),
  name TEXT NOT NULL,
  priority INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  trigger TEXT NOT NULL CHECK(trigger IN ('on_save','scheduled','manual')),
  conditions TEXT DEFAULT '[]',
  actions TEXT DEFAULT '[]',
  applied_count INTEGER DEFAULT 0,
  last_run_at TEXT,
  last_alerted_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rules_company_category ON rules(company_id, category, is_active);

CREATE TABLE IF NOT EXISTS approval_queue (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  record_type TEXT NOT NULL CHECK(record_type IN ('invoice','expense','bill')),
  record_id TEXT NOT NULL,
  rule_id TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  rule_name TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_approval_queue_company ON approval_queue(company_id, status);

-- ─── Debt Collection ────────────────────────────────────
CREATE TABLE IF NOT EXISTS debts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  type TEXT NOT NULL CHECK(type IN ('receivable','payable')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','in_collection','legal','settled','written_off','disputed','bankruptcy')),
  debtor_id TEXT,
  debtor_type TEXT DEFAULT 'custom' CHECK(debtor_type IN ('client','vendor','employee','custom')),
  debtor_name TEXT NOT NULL DEFAULT '',
  debtor_email TEXT DEFAULT '',
  debtor_phone TEXT DEFAULT '',
  debtor_address TEXT DEFAULT '',
  source_type TEXT DEFAULT 'manual' CHECK(source_type IN ('invoice','bill','manual')),
  source_id TEXT,
  original_amount REAL NOT NULL DEFAULT 0,
  interest_accrued REAL NOT NULL DEFAULT 0,
  fees_accrued REAL NOT NULL DEFAULT 0,
  payments_made REAL NOT NULL DEFAULT 0,
  balance_due REAL NOT NULL DEFAULT 0,
  interest_rate REAL DEFAULT 0,
  interest_type TEXT DEFAULT 'simple' CHECK(interest_type IN ('simple','compound')),
  interest_start_date TEXT,
  compound_frequency INTEGER DEFAULT 12,
  due_date TEXT,
  delinquent_date TEXT,
  statute_of_limitations_date TEXT,
  statute_years INTEGER,
  jurisdiction TEXT DEFAULT '',
  priority TEXT DEFAULT 'medium' CHECK(priority IN ('low','medium','high','critical')),
  current_stage TEXT DEFAULT 'reminder' CHECK(current_stage IN ('reminder','warning','final_notice','demand_letter','collections_agency','legal_action','judgment','garnishment')),
  assigned_to TEXT DEFAULT '',
  hold INTEGER DEFAULT 0,
  hold_reason TEXT DEFAULT '',
  agency_name TEXT DEFAULT '',
  agency_contact TEXT DEFAULT '',
  agency_reference TEXT DEFAULT '',
  agency_commission_rate REAL DEFAULT 0,
  settlement_amount REAL,
  write_off_reason TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_debts_company_type ON debts(company_id, type);
CREATE INDEX IF NOT EXISTS idx_debts_company_status ON debts(company_id, status);
CREATE INDEX IF NOT EXISTS idx_debts_company_stage ON debts(company_id, current_stage);
CREATE INDEX IF NOT EXISTS idx_debts_debtor ON debts(debtor_id, debtor_type);

CREATE TABLE IF NOT EXISTS debt_contacts (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('debtor','guarantor','attorney','witness','collections_agent','judge','mediator')),
  name TEXT NOT NULL DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  company TEXT DEFAULT '',
  bar_number TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_debt_contacts_debt ON debt_contacts(debt_id);

CREATE TABLE IF NOT EXISTS debt_communications (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('email','phone','letter','in_person','legal_filing','text','fax')),
  direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
  subject TEXT DEFAULT '',
  body TEXT DEFAULT '',
  outcome TEXT DEFAULT '',
  contact_id TEXT REFERENCES debt_contacts(id),
  template_used TEXT DEFAULT '',
  attachments_json TEXT DEFAULT '[]',
  logged_by TEXT DEFAULT '',
  logged_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_debt_comms_debt ON debt_communications(debt_id);

CREATE TABLE IF NOT EXISTS debt_payments (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  amount REAL NOT NULL DEFAULT 0,
  method TEXT DEFAULT 'other' CHECK(method IN ('cash','check','card','wire','ach','garnishment','settlement','other')),
  reference_number TEXT DEFAULT '',
  received_date TEXT NOT NULL,
  applied_to_principal REAL DEFAULT 0,
  applied_to_interest REAL DEFAULT 0,
  applied_to_fees REAL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_debt_payments_debt ON debt_payments(debt_id);

CREATE TABLE IF NOT EXISTS debt_pipeline_stages (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  entered_at TEXT NOT NULL DEFAULT (datetime('now')),
  exited_at TEXT,
  auto_advanced INTEGER DEFAULT 0,
  advanced_by TEXT DEFAULT '',
  notes TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_debt_stages_debt ON debt_pipeline_stages(debt_id);

CREATE TABLE IF NOT EXISTS debt_evidence (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('contract','invoice','communication','payment_record','delivery_proof','signed_agreement','witness_statement','photo','other')),
  title TEXT NOT NULL DEFAULT '',
  description TEXT DEFAULT '',
  file_path TEXT DEFAULT '',
  file_name TEXT DEFAULT '',
  date_of_evidence TEXT,
  court_relevance TEXT DEFAULT 'medium' CHECK(court_relevance IN ('high','medium','low')),
  admitted INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_debt_evidence_debt ON debt_evidence(debt_id);

CREATE TABLE IF NOT EXISTS debt_legal_actions (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK(action_type IN ('demand_letter','small_claims','civil_suit','arbitration','mediation','garnishment_order','lien')),
  filing_date TEXT,
  court_name TEXT DEFAULT '',
  court_address TEXT DEFAULT '',
  case_number TEXT DEFAULT '',
  hearing_date TEXT,
  hearing_time TEXT DEFAULT '',
  judge_name TEXT DEFAULT '',
  status TEXT DEFAULT 'preparing' CHECK(status IN ('preparing','filed','served','hearing_scheduled','in_progress','judgment','appeal','closed')),
  outcome TEXT DEFAULT '',
  judgment_amount REAL,
  judgment_date TEXT,
  attorney_id TEXT REFERENCES debt_contacts(id),
  court_costs REAL DEFAULT 0,
  checklist_json TEXT DEFAULT '[]',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_debt_legal_debt ON debt_legal_actions(debt_id);

CREATE TABLE IF NOT EXISTS debt_automation_rules (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  debt_id TEXT,
  from_stage TEXT NOT NULL,
  to_stage TEXT NOT NULL,
  days_after_entry INTEGER NOT NULL DEFAULT 14,
  condition_json TEXT DEFAULT '{}',
  action TEXT NOT NULL DEFAULT 'advance_stage' CHECK(action IN ('advance_stage','send_template','create_notification','flag_review')),
  template_name TEXT DEFAULT '',
  require_review INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_debt_auto_company ON debt_automation_rules(company_id);

CREATE TABLE IF NOT EXISTS debt_templates (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('reminder','warning','final_notice','demand_letter','custom')),
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  severity TEXT DEFAULT 'formal' CHECK(severity IN ('friendly','formal','final')),
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_debt_templates_company ON debt_templates(company_id);

-- ─── Quotes / Estimates ─────────────────────────────────
CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  quote_number TEXT NOT NULL,
  client_id TEXT REFERENCES clients(id),
  client_name TEXT DEFAULT '',
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft','sent','accepted','rejected','expired','converted')),
  issue_date TEXT NOT NULL,
  valid_until TEXT,
  subtotal REAL DEFAULT 0,
  tax_amount REAL DEFAULT 0,
  discount_amount REAL DEFAULT 0,
  total REAL DEFAULT 0,
  notes TEXT DEFAULT '',
  terms TEXT DEFAULT '',
  converted_invoice_id TEXT REFERENCES invoices(id),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_quotes_company ON quotes(company_id, status);

CREATE TABLE IF NOT EXISTS quote_line_items (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  description TEXT NOT NULL DEFAULT '',
  quantity REAL DEFAULT 1,
  unit_price REAL DEFAULT 0,
  tax_rate REAL DEFAULT 0,
  amount REAL DEFAULT 0,
  sort_order INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_quote_lines_quote ON quote_line_items(quote_id);

-- Invoice Reminders
CREATE TABLE IF NOT EXISTS invoice_reminders (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL CHECK(reminder_type IN ('before_due','on_due','overdue_7','overdue_14','overdue_30','overdue_60','custom')),
  scheduled_date TEXT NOT NULL,
  sent_at TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','sent','skipped','failed')),
  message TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_invoice_reminders_invoice ON invoice_reminders(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_reminders_status ON invoice_reminders(status, scheduled_date);
