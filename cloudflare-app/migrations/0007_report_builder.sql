-- 0007 — Report Builder.
-- saved_reports: user-built reports that can be re-run from /app/reports/<id>.
-- The query is a parameterized aggregation expressed as a small JSON config
-- (source table, group_by columns, aggregations, optional filters).
-- The Worker translates the config to a safe parameterized SQL query —
-- there's no free-text SQL surface from the UI.

CREATE TABLE IF NOT EXISTS saved_reports (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL,
  user_id      TEXT,
  name         TEXT NOT NULL,
  description  TEXT,
  config       TEXT NOT NULL DEFAULT '{}',  -- JSON: { source, group_by[], aggregations[], filters[] }
  chart_type   TEXT DEFAULT 'table',         -- 'table' | 'bar' | 'pie'
  is_pinned    INTEGER DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reports_company ON saved_reports(company_id);
