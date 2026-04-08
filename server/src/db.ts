import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function sanitizeIdentifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid SQL identifier: "${name}"`);
  }
  return name;
}

export let db: Database.Database;

export function initDb() {
  db = new Database(path.join(DATA_DIR, 'replica.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_log (
      id TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      operation TEXT NOT NULL CHECK(operation IN ('create','update','delete')),
      record_id TEXT NOT NULL,
      company_id TEXT,
      payload TEXT,
      synced_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS invoice_tokens (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL UNIQUE,
      company_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
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
  `);

  console.log('Server DB initialized');
}

export function applySync(payload: {
  table: string;
  operation: 'create' | 'update' | 'delete';
  id: string;
  data: Record<string, unknown>;
  companyId: string;
  timestamp: number;
}) {
  const { table, operation, id, data } = payload;

  const applyTransaction = db.transaction(() => {
    ensureTable(table, data);

    const safeTable = sanitizeIdentifier(table);

    if (operation === 'delete') {
      db.prepare(`DELETE FROM "${safeTable}" WHERE id = ?`).run(id);
      db.prepare(
        `INSERT INTO sync_log (id, table_name, operation, record_id, company_id, payload)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(uuidv4(), table, 'delete', id, payload.companyId, JSON.stringify({ id }));
      return;
    }

    const cols = Object.keys(data);
    if (cols.length === 0) return;

    if (operation === 'create') {
      const safeCols = cols.map(c => sanitizeIdentifier(c));
      const placeholders = safeCols.map(() => '?').join(', ');
      db.prepare(
        `INSERT OR REPLACE INTO "${safeTable}" (${safeCols.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`
      ).run(...cols.map(c => data[c] as any));
    } else {
      const safeCols = cols.filter(c => c !== 'id').map(c => sanitizeIdentifier(c));
      const sets = safeCols.map(c => `"${c}" = ?`).join(', ');
      const vals = cols.filter(c => c !== 'id').map(c => data[c]);
      db.prepare(`UPDATE "${safeTable}" SET ${sets} WHERE id = ?`).run(...vals, id);
    }

    db.prepare(
      `INSERT INTO sync_log (id, table_name, operation, record_id, company_id, payload)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(uuidv4(), table, operation, id, payload.companyId, JSON.stringify(data));
  });

  applyTransaction();
}

const createdTables = new Set<string>();

// Allowlist of tables that can be auto-created via sync
const ALLOWED_SYNC_TABLES = new Set([
  'invoices', 'invoice_line_items', 'expenses', 'clients', 'vendors', 'accounts',
  'journal_entries', 'journal_entry_lines', 'payments', 'categories', 'employees',
  'payroll_runs', 'pay_stubs', 'projects', 'time_entries', 'bills', 'bill_payments',
  'bill_line_items', 'purchase_orders', 'po_line_items', 'fixed_assets',
  'bank_accounts', 'bank_transactions', 'budgets', 'budget_lines', 'debts',
  'debt_communications', 'debt_contacts', 'quotes', 'quote_line_items',
  'inventory_items', 'inventory_movements', 'tax_rates', 'companies',
  'invoice_tokens', 'settings', 'automation_rules', 'recurring_templates',
]);

function ensureTable(table: string, sample: Record<string, unknown>) {
  const safeTable = sanitizeIdentifier(table);
  if (!ALLOWED_SYNC_TABLES.has(safeTable)) {
    throw new Error(`Table "${safeTable}" is not in the sync allowlist`);
  }
  if (createdTables.has(safeTable)) return;
  const cols = Object.keys(sample).map(c => {
    const safeCol = sanitizeIdentifier(c);
    return `"${safeCol}" TEXT`;
  }).join(', ');
  db.exec(`CREATE TABLE IF NOT EXISTS "${safeTable}" (${cols || '"id" TEXT PRIMARY KEY'})`);
  createdTables.add(safeTable);
}
