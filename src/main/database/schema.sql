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
  project_id TEXT REFERENCES projects(id),
  client_id TEXT REFERENCES clients(id),
  receipt_path TEXT,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','paid')),
  payment_method TEXT DEFAULT '',
  is_recurring INTEGER DEFAULT 0,
  recurring_template_id TEXT REFERENCES recurring_templates(id),
  tags TEXT DEFAULT '[]',
  custom_fields TEXT DEFAULT '{}',
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
  description TEXT DEFAULT '',
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
