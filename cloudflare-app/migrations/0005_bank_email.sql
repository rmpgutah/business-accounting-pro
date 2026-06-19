-- 0005 — Bank reconciliation + email sending.
-- bank_accounts: the user's actual bank accounts (checking, savings, credit).
-- bank_transactions: imported from CSV/OFX, awaiting match.
-- bank_recon_matches: links a bank txn to an expense / payment / etc.
-- email_log: outbound mail audit trail (who sent what to whom, when).

CREATE TABLE IF NOT EXISTS bank_accounts (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL,
  name         TEXT NOT NULL,
  type         TEXT DEFAULT 'checking',  -- checking | savings | credit_card | line_of_credit
  bank_name    TEXT,
  account_last4 TEXT,
  current_balance REAL DEFAULT 0,
  reconciled_balance REAL DEFAULT 0,
  reconciled_through_date TEXT,
  currency     TEXT DEFAULT 'USD',
  is_active    INTEGER DEFAULT 1,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bank_company ON bank_accounts(company_id);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL,
  bank_account_id TEXT NOT NULL,
  date            TEXT NOT NULL,
  description     TEXT,
  amount          REAL NOT NULL,        -- negative = debit, positive = credit
  balance_after   REAL,
  reference       TEXT,
  is_reconciled   INTEGER DEFAULT 0,
  matched_entity_type TEXT,             -- 'expense' | 'invoice' | 'payment' | 'transfer'
  matched_entity_id   TEXT,
  imported_from   TEXT,                 -- 'csv' | 'ofx' | 'manual'
  raw_data        TEXT,                 -- JSON of original import row (for debug)
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bank_txn_account_date ON bank_transactions(bank_account_id, date);
CREATE INDEX IF NOT EXISTS idx_bank_txn_unreconciled ON bank_transactions(company_id, is_reconciled);

CREATE TABLE IF NOT EXISTS email_log (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL,
  user_id      TEXT,
  to_email     TEXT NOT NULL,
  from_email   TEXT,
  subject      TEXT,
  body_preview TEXT,                    -- first 500 chars, audit-friendly
  related_entity_type TEXT,             -- 'invoice' | 'quote' | 'statement'
  related_entity_id   TEXT,
  status       TEXT DEFAULT 'sent',     -- queued | sent | failed | bounced
  error_message TEXT,
  sent_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_email_company_date ON email_log(company_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_entity ON email_log(related_entity_type, related_entity_id);
