-- ─────────────────────────────────────────────────────────────────────────
-- BAP Cloud — D1 schema (initial).
--
-- This is a FOCUSED MIRROR of the desktop's 40+ table schema. Only the
-- tables needed for the three live web surfaces are materialized here:
--   • Auth (users, sessions)
--   • Companies + users-to-companies
--   • Clients, vendors, projects
--   • Expenses + expense_line_items (mirrors desktop columns)
--   • Invoices + invoice_line_items
--   • Mileage trips
--   • Sync state (push cursors, conflict log)
--   • Portal access tokens (client-facing magic links)
--
-- Tables NOT mirrored yet (extend as you bring more web surfaces online):
--   accounts/GL, bills/AP, payroll, debt collection, fixed assets, recurring,
--   forecasting, taxes, rules, automations, audit log.
-- ─────────────────────────────────────────────────────────────────────────

-- ─── Identity ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,     -- scrypt: see src/auth.ts
  name          TEXT,
  role          TEXT NOT NULL DEFAULT 'user',  -- 'owner' | 'user' | 'client'
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS companies (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  address     TEXT,
  tax_id      TEXT,
  currency    TEXT NOT NULL DEFAULT 'USD',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Many-to-many: a user can belong to multiple companies (consultants), and a
-- company can have multiple users (owner + staff).
CREATE TABLE IF NOT EXISTS user_companies (
  user_id    TEXT NOT NULL,
  company_id TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'member',  -- 'owner' | 'admin' | 'member'
  PRIMARY KEY (user_id, company_id)
);

-- ─── Core entities ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  name       TEXT NOT NULL,
  email      TEXT,
  phone      TEXT,
  address    TEXT,
  tax_id     TEXT,
  notes      TEXT,
  status     TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_clients_company ON clients(company_id);

CREATE TABLE IF NOT EXISTS vendors (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  name       TEXT NOT NULL,
  email      TEXT,
  phone      TEXT,
  address    TEXT,
  website    TEXT,
  tax_id     TEXT,
  status     TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vendors_company ON vendors(company_id);

CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  client_id  TEXT,
  name       TEXT NOT NULL,
  description TEXT,
  budget     REAL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'active',
  start_date TEXT,
  end_date   TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_projects_company ON projects(company_id);
CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id);

CREATE TABLE IF NOT EXISTS categories (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'expense',  -- expense | income
  color       TEXT,
  parent_id   TEXT
);
CREATE INDEX IF NOT EXISTS idx_cats_company ON categories(company_id);

-- ─── Expenses ───────────────────────────────────────────────
-- Columns mirror the desktop's expenses table, including the recently-added
-- shipping_* fields and billed_invoice_id. Anything the desktop syncs up MUST
-- be representable here or the sync will silently drop it.
CREATE TABLE IF NOT EXISTS expenses (
  id                   TEXT PRIMARY KEY,
  company_id           TEXT NOT NULL,
  date                 TEXT NOT NULL,
  amount               REAL NOT NULL DEFAULT 0,     -- pre-tax goods subtotal
  tax_amount           REAL DEFAULT 0,
  description          TEXT,
  category_id          TEXT,
  account_id           TEXT,
  vendor_id            TEXT,
  payment_method       TEXT,
  project_id           TEXT,
  client_id            TEXT,
  is_billable          INTEGER DEFAULT 0,
  is_reimbursable      INTEGER DEFAULT 0,
  reimbursed           INTEGER DEFAULT 0,
  reimbursed_date      TEXT,
  reference            TEXT,
  receipt_path         TEXT,
  receipts_json        TEXT,
  status               TEXT DEFAULT 'pending',
  approval_status      TEXT DEFAULT 'draft',
  currency             TEXT DEFAULT 'USD',
  exchange_rate        REAL DEFAULT 1,
  notes                TEXT,
  tags                 TEXT,
  discount_amount      REAL DEFAULT 0,
  discount_percent     REAL DEFAULT 0,
  merchant_location    TEXT,
  geo_location_name    TEXT,
  markup_pct           REAL DEFAULT 0,
  -- Shipping & Handling (mirrors desktop FINAL-PRICE v4)
  shipping_amount      REAL DEFAULT 0,
  shipping_tax_amount  REAL DEFAULT 0,
  shipping_speed       TEXT,
  shipping_taxable     INTEGER DEFAULT 0,
  shipping_scope       TEXT DEFAULT 'order',
  shipping_line_ref    TEXT,
  billed_invoice_id    TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_exp_company_date ON expenses(company_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_exp_client ON expenses(client_id);
CREATE INDEX IF NOT EXISTS idx_exp_project ON expenses(project_id);

CREATE TABLE IF NOT EXISTS expense_line_items (
  id                   TEXT PRIMARY KEY,
  expense_id           TEXT NOT NULL,
  description          TEXT,
  quantity             REAL DEFAULT 1,
  unit_price           REAL DEFAULT 0,
  amount               REAL DEFAULT 0,
  account_id           TEXT,
  category_id          TEXT,
  project_id           TEXT,
  client_id            TEXT,
  tax_rate             REAL DEFAULT 0,
  tax_amount           REAL DEFAULT 0,
  tax_jurisdictions    TEXT DEFAULT '[]',
  discount_amount      REAL DEFAULT 0,
  discount_percent     REAL DEFAULT 0,
  is_tax_deductible    INTEGER DEFAULT 1,
  is_tax_exempt        INTEGER DEFAULT 0,
  is_billable          INTEGER DEFAULT 0,
  billed_invoice_id    TEXT,
  notes                TEXT,
  item_type            TEXT DEFAULT 'item',
  tags                 TEXT DEFAULT '[]',
  sort_order           INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_eli_expense ON expense_line_items(expense_id);

-- ─── Invoices ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL,
  client_id       TEXT,
  invoice_number  TEXT,
  date            TEXT NOT NULL,
  due_date        TEXT,
  status          TEXT DEFAULT 'draft',  -- draft|sent|paid|overdue|partial|void
  subtotal        REAL DEFAULT 0,
  tax_amount      REAL DEFAULT 0,
  shipping_amount REAL DEFAULT 0,
  discount        REAL DEFAULT 0,
  total           REAL DEFAULT 0,
  amount_paid     REAL DEFAULT 0,
  currency        TEXT DEFAULT 'USD',
  notes           TEXT,
  terms           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_inv_company ON invoices(company_id);
CREATE INDEX IF NOT EXISTS idx_inv_client ON invoices(client_id);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id           TEXT PRIMARY KEY,
  invoice_id   TEXT NOT NULL,
  description  TEXT,
  quantity     REAL DEFAULT 1,
  unit_price   REAL DEFAULT 0,
  amount       REAL DEFAULT 0,
  tax_rate     REAL DEFAULT 0,
  tax_amount   REAL DEFAULT 0,
  project_id   TEXT,
  sort_order   INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ili_invoice ON invoice_line_items(invoice_id);

CREATE TABLE IF NOT EXISTS payments (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL,
  invoice_id    TEXT NOT NULL,
  date          TEXT NOT NULL,
  amount        REAL NOT NULL,
  payment_method TEXT,
  reference     TEXT,
  stripe_pi_id  TEXT,    -- Stripe PaymentIntent ID when paid via portal
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pmt_invoice ON payments(invoice_id);

-- ─── Mileage ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mileage_log (
  id                TEXT PRIMARY KEY,
  company_id        TEXT NOT NULL,
  trip_date         TEXT NOT NULL,
  purpose           TEXT,
  start_location    TEXT,
  end_location      TEXT,
  miles             REAL NOT NULL DEFAULT 0,
  rate_per_mile     REAL NOT NULL DEFAULT 0,
  deduction_amount  REAL NOT NULL DEFAULT 0,
  vehicle           TEXT,
  project_id        TEXT,
  client_id         TEXT,
  is_billable       INTEGER DEFAULT 0,
  billed_invoice_id TEXT,
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mile_company_date ON mileage_log(company_id, trip_date DESC);

-- ─── Sync ───────────────────────────────────────────────────
-- A row per (company_id, table_name) tracking the last-applied desktop
-- modification cursor. The desktop pushes rows whose updated_at > cursor,
-- and we advance the cursor after each successful upsert batch.
CREATE TABLE IF NOT EXISTS sync_cursors (
  company_id   TEXT NOT NULL,
  table_name   TEXT NOT NULL,
  last_synced  TEXT NOT NULL,    -- ISO timestamp the desktop reports
  rows_applied INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, table_name)
);

-- Append-only log of sync events for debugging when push/pull diverges from
-- the desktop's view of the world. Keep last 1000 per company; trim in a cron
-- later if it grows.
CREATE TABLE IF NOT EXISTS sync_log (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL,
  direction   TEXT NOT NULL,   -- 'push' | 'pull'
  table_name  TEXT,
  rows        INTEGER DEFAULT 0,
  error       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── Portal ─────────────────────────────────────────────────
-- Time-limited magic links the desktop can mint for a client. The client
-- visits accounting.rmpgutah.us/portal?token=… → exchanged for a session,
-- session lets them view their own invoices and pay.
CREATE TABLE IF NOT EXISTS portal_tokens (
  token       TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL,
  client_id   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_portal_client ON portal_tokens(client_id);

-- ─── Receipt files (R2 metadata) ────────────────────────────
-- The actual bytes live in R2 under `receipts/<company>/<expense>/<file>`.
-- This table indexes them so listing an expense's receipts is a single query.
CREATE TABLE IF NOT EXISTS receipts (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL,
  expense_id  TEXT NOT NULL,
  filename    TEXT NOT NULL,
  r2_key      TEXT NOT NULL,
  mime        TEXT,
  size        INTEGER,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rcp_expense ON receipts(expense_id);
