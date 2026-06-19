-- 0003 — Round-out cloud schema to cover the remaining desktop modules.
-- New tables: purchase_orders + po_lines, inventory_items, fixed_assets,
-- loans, budgets, documents, recurring_templates, accounts (chart of
-- accounts), journal_entries + journal_lines, debts.
--
-- Schema mirrors desktop column names where reasonable; trimmed to the
-- subset the cloud actually uses (some desktop columns like detailed
-- audit/rules fields stay desktop-only).

CREATE TABLE IF NOT EXISTS purchase_orders (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL,
  vendor_id       TEXT,
  po_number       TEXT,
  date            TEXT NOT NULL,
  expected_date   TEXT,
  status          TEXT DEFAULT 'draft',  -- draft | sent | received | cancelled | closed
  subtotal        REAL DEFAULT 0,
  tax_amount      REAL DEFAULT 0,
  shipping_amount REAL DEFAULT 0,
  discount        REAL DEFAULT 0,
  total           REAL DEFAULT 0,
  currency        TEXT DEFAULT 'USD',
  notes           TEXT,
  terms           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_po_company_date ON purchase_orders(company_id, date);

CREATE TABLE IF NOT EXISTS po_line_items (
  id          TEXT PRIMARY KEY,
  po_id       TEXT NOT NULL,
  description TEXT,
  quantity    REAL DEFAULT 1,
  unit_price  REAL DEFAULT 0,
  amount      REAL DEFAULT 0,
  tax_rate    REAL DEFAULT 0,
  tax_amount  REAL DEFAULT 0,
  sort_order  INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_po_li ON po_line_items(po_id);

CREATE TABLE IF NOT EXISTS inventory_items (
  id            TEXT PRIMARY KEY,
  company_id    TEXT NOT NULL,
  sku           TEXT,
  name          TEXT NOT NULL,
  description   TEXT,
  unit_cost     REAL DEFAULT 0,
  unit_price    REAL DEFAULT 0,
  quantity_on_hand REAL DEFAULT 0,
  reorder_point REAL DEFAULT 0,
  unit_of_measure TEXT DEFAULT 'each',
  category      TEXT,
  status        TEXT DEFAULT 'active',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_inv_company ON inventory_items(company_id);
CREATE INDEX IF NOT EXISTS idx_inv_sku ON inventory_items(sku);

CREATE TABLE IF NOT EXISTS fixed_assets (
  id                TEXT PRIMARY KEY,
  company_id        TEXT NOT NULL,
  name              TEXT NOT NULL,
  category          TEXT,
  purchase_date     TEXT,
  purchase_cost     REAL DEFAULT 0,
  current_value     REAL DEFAULT 0,
  useful_life_years INTEGER DEFAULT 5,
  depreciation_method TEXT DEFAULT 'straight_line',
  accumulated_depreciation REAL DEFAULT 0,
  serial_number     TEXT,
  location          TEXT,
  status            TEXT DEFAULT 'active',  -- active | disposed | sold
  notes             TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fa_company ON fixed_assets(company_id);

CREATE TABLE IF NOT EXISTS loans (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL,
  name            TEXT NOT NULL,
  lender_name     TEXT,
  loan_type       TEXT DEFAULT 'term_loan',
  principal       REAL DEFAULT 0,
  current_balance REAL DEFAULT 0,
  interest_rate   REAL DEFAULT 0,
  rate_type       TEXT DEFAULT 'fixed',
  start_date      TEXT,
  term_months     INTEGER DEFAULT 60,
  payment_amount  REAL DEFAULT 0,
  status          TEXT DEFAULT 'active',
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_loans_company ON loans(company_id);

CREATE TABLE IF NOT EXISTS budgets (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL,
  name         TEXT NOT NULL,
  period       TEXT NOT NULL,           -- monthly | quarterly | annual
  category_id  TEXT,                    -- which expense category this caps
  budget_amount REAL DEFAULT 0,
  start_date   TEXT NOT NULL,
  end_date     TEXT,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_budgets_company ON budgets(company_id);

CREATE TABLE IF NOT EXISTS documents (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL,
  entity_type  TEXT,                   -- 'expense' | 'invoice' | 'client' | 'vendor' | etc.
  entity_id    TEXT,
  filename     TEXT NOT NULL,
  mime_type    TEXT,
  size_bytes   INTEGER DEFAULT 0,
  r2_key       TEXT,                   -- path in R2 bucket
  uploaded_at  TEXT NOT NULL DEFAULT (datetime('now')),
  uploaded_by  TEXT,
  notes        TEXT
);
CREATE INDEX IF NOT EXISTS idx_docs_company ON documents(company_id);
CREATE INDEX IF NOT EXISTS idx_docs_entity ON documents(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS recurring_templates (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL,
  type         TEXT NOT NULL,         -- 'expense' | 'invoice' | 'bill'
  name         TEXT NOT NULL,
  frequency    TEXT NOT NULL,         -- weekly | biweekly | monthly | quarterly | annual
  next_date    TEXT NOT NULL,
  last_run_date TEXT,
  is_active    INTEGER DEFAULT 1,
  template_data TEXT,                 -- JSON payload to instantiate
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_recur_company ON recurring_templates(company_id);

CREATE TABLE IF NOT EXISTS accounts (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL,
  code         TEXT,                   -- e.g. 1000, 2000 — for chart-of-accounts ordering
  name         TEXT NOT NULL,
  type         TEXT NOT NULL,          -- asset | liability | equity | income | expense
  subtype      TEXT,                   -- current_asset | fixed_asset | etc.
  description  TEXT,
  is_active    INTEGER DEFAULT 1,
  balance      REAL DEFAULT 0,
  parent_id    TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_accounts_company ON accounts(company_id);
CREATE INDEX IF NOT EXISTS idx_accounts_type ON accounts(type);

CREATE TABLE IF NOT EXISTS journal_entries (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL,
  date         TEXT NOT NULL,
  description  TEXT,
  reference    TEXT,
  is_adjusting INTEGER DEFAULT 0,
  status       TEXT DEFAULT 'posted',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_je_company_date ON journal_entries(company_id, date);

CREATE TABLE IF NOT EXISTS journal_lines (
  id           TEXT PRIMARY KEY,
  je_id        TEXT NOT NULL,
  account_id   TEXT NOT NULL,
  debit        REAL DEFAULT 0,
  credit       REAL DEFAULT 0,
  description  TEXT,
  sort_order   INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_je_lines ON journal_lines(je_id);

CREATE TABLE IF NOT EXISTS debts (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL,
  client_id       TEXT,
  account_name    TEXT NOT NULL,
  principal       REAL DEFAULT 0,
  current_balance REAL DEFAULT 0,
  stage           TEXT DEFAULT 'reminder',  -- reminder | warning | final_notice | demand_letter | collections_agency | legal_action | judgment | garnishment
  status          TEXT DEFAULT 'active',
  origin_invoice_id TEXT,
  interest_rate   REAL DEFAULT 0,
  start_date      TEXT,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_debts_company ON debts(company_id);

-- Categories (used by expenses + budgets). Lightweight subset of the
-- desktop categories table.
CREATE TABLE IF NOT EXISTS categories (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL,
  name         TEXT NOT NULL,
  type         TEXT DEFAULT 'expense',  -- expense | income
  color        TEXT,
  icon         TEXT,
  description  TEXT,
  monthly_cap  REAL DEFAULT 0,
  parent_id    TEXT,
  is_active    INTEGER DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_categories_company ON categories(company_id);

-- Settings: company-scoped key/value, shared with sync.
CREATE TABLE IF NOT EXISTS settings (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL,
  key          TEXT NOT NULL,
  value        TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, key)
);
