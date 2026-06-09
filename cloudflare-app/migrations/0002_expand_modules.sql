-- 0002 — Expand cloud schema to match the desktop's core modules.
-- New tables: employees, time_entries, bills + bill_line_items, quotes +
-- quote_line_items. Mirrors the desktop column names so desktop sync flows
-- can replicate rows 1:1 without translation.

CREATE TABLE IF NOT EXISTS employees (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL,
  name          TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  role          TEXT,                -- 'employee' | 'contractor' | 'admin'
  pay_rate      REAL DEFAULT 0,      -- per-hour (for time-tracking)
  pay_type      TEXT DEFAULT 'hourly', -- 'hourly' | 'salary' | '1099'
  hire_date     TEXT,
  status        TEXT DEFAULT 'active',
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_employees_company ON employees(company_id);

CREATE TABLE IF NOT EXISTS time_entries (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL,
  employee_id      TEXT NOT NULL,
  project_id       TEXT,
  client_id        TEXT,
  date             TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  description      TEXT,
  is_billable      INTEGER DEFAULT 0,
  hourly_rate      REAL DEFAULT 0,   -- override on the entry; falls back to employee.pay_rate
  is_invoiced      INTEGER DEFAULT 0,
  invoice_id       TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_time_company_date ON time_entries(company_id, date);
CREATE INDEX IF NOT EXISTS idx_time_project ON time_entries(project_id);

CREATE TABLE IF NOT EXISTS bills (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL,
  vendor_id       TEXT,
  bill_number     TEXT,
  date            TEXT NOT NULL,
  due_date        TEXT,
  status          TEXT DEFAULT 'open',  -- 'open' | 'paid' | 'overdue' | 'void'
  subtotal        REAL DEFAULT 0,
  tax_amount      REAL DEFAULT 0,
  shipping_amount REAL DEFAULT 0,
  discount        REAL DEFAULT 0,
  total           REAL DEFAULT 0,
  amount_paid     REAL DEFAULT 0,
  currency        TEXT DEFAULT 'USD',
  notes           TEXT,
  terms           TEXT,
  reference       TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bills_company_date ON bills(company_id, date);
CREATE INDEX IF NOT EXISTS idx_bills_vendor ON bills(vendor_id);

CREATE TABLE IF NOT EXISTS bill_line_items (
  id          TEXT PRIMARY KEY,
  bill_id     TEXT NOT NULL,
  description TEXT,
  quantity    REAL DEFAULT 1,
  unit_price  REAL DEFAULT 0,
  amount      REAL DEFAULT 0,
  tax_rate    REAL DEFAULT 0,
  tax_amount  REAL DEFAULT 0,
  sort_order  INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_bill_li ON bill_line_items(bill_id);

CREATE TABLE IF NOT EXISTS quotes (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL,
  client_id       TEXT,
  quote_number    TEXT,
  date            TEXT NOT NULL,
  expires_date    TEXT,
  status          TEXT DEFAULT 'draft',  -- 'draft' | 'sent' | 'accepted' | 'declined' | 'expired'
  subtotal        REAL DEFAULT 0,
  tax_amount      REAL DEFAULT 0,
  shipping_amount REAL DEFAULT 0,
  discount        REAL DEFAULT 0,
  total           REAL DEFAULT 0,
  currency        TEXT DEFAULT 'USD',
  notes           TEXT,
  terms           TEXT,
  converted_invoice_id TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_quotes_company_date ON quotes(company_id, date);
CREATE INDEX IF NOT EXISTS idx_quotes_client ON quotes(client_id);

CREATE TABLE IF NOT EXISTS quote_line_items (
  id          TEXT PRIMARY KEY,
  quote_id    TEXT NOT NULL,
  description TEXT,
  quantity    REAL DEFAULT 1,
  unit_price  REAL DEFAULT 0,
  amount      REAL DEFAULT 0,
  tax_rate    REAL DEFAULT 0,
  tax_amount  REAL DEFAULT 0,
  sort_order  INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_quote_li ON quote_line_items(quote_id);

-- Projects table already exists in 0001_init.sql; add the optional columns
-- the desktop ProjectDetail page reads. ALTER is forgiving (errors-ignored
-- by the migration runner if the column already exists).
-- (Skipped here — D1 doesn't run "IF NOT EXISTS" on column adds; rely on
-- 0001 having defined a permissive enough schema. If you discover a missing
-- column, add it in a new migration 0003_xxx.sql rather than altering 0002.)
