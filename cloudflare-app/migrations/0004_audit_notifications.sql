-- 0004 — Audit log + notifications.
-- The audit log is append-only (no UPDATE/DELETE handlers in the worker);
-- notifications are user-scoped with a read flag.

CREATE TABLE IF NOT EXISTS audit_log (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL,
  user_id      TEXT,                  -- nullable for system events
  action       TEXT NOT NULL,         -- 'create' | 'update' | 'delete' | 'login' | ...
  entity_type  TEXT NOT NULL,         -- 'invoice' | 'expense' | 'user' | etc.
  entity_id    TEXT,
  description  TEXT,
  metadata     TEXT,                  -- JSON payload (field-level diff, etc.)
  ip_address   TEXT,
  user_agent   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_company_date ON audit_log(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS notifications (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL,
  user_id      TEXT,                  -- nullable means broadcast to all users
  kind         TEXT NOT NULL,         -- 'invoice_overdue' | 'low_inventory' | etc.
  title        TEXT NOT NULL,
  body         TEXT,
  link         TEXT,                  -- /app/invoices/<id> etc.
  is_read      INTEGER DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  read_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_notif_user_unread ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notif_company_date ON notifications(company_id, created_at DESC);
