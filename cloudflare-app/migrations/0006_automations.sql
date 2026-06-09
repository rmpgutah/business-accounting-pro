-- 0006 — Rules / Automations engine.
-- A `rule` is: trigger (event name) + conditions (JSON) + actions (JSON).
-- Events are emitted by the Worker after every mutation; the engine
-- evaluates active rules and executes matching actions.
--
-- Rule JSON examples:
--   conditions: [{ field: 'amount', op: 'gt', value: 1000 }]
--   actions:    [{ kind: 'notify', title: 'Big expense', body: 'Over $1000' }]
--                [{ kind: 'set_field', field: 'status', value: 'pending_approval' }]
--                [{ kind: 'send_email', to: 'cfo@…', subject: 'Approval needed' }]

CREATE TABLE IF NOT EXISTS rules (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT,
  trigger      TEXT NOT NULL,            -- 'expense.create' | 'invoice.create' | 'bill.create' | 'invoice.overdue'
  conditions   TEXT NOT NULL DEFAULT '[]',  -- JSON array
  actions      TEXT NOT NULL DEFAULT '[]',  -- JSON array
  is_active    INTEGER DEFAULT 1,
  run_count    INTEGER DEFAULT 0,
  last_run_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rules_company_trigger ON rules(company_id, trigger, is_active);
