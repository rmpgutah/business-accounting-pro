import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { v4 as uuid } from 'uuid';

let db: Database.Database | null = null;
let currentCompanyId: string | null = null;

export function getDbPath(): string {
  const userDataPath = app.getPath('userData');
  const dbDir = path.join(userDataPath, 'databases');
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  return path.join(dbDir, 'accounting.db');
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export function initDatabase(): Database.Database {
  const dbPath = getDbPath();
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Load and apply schema
  const schemaPath = path.join(__dirname, 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schema);
  }

  // ─── Column migrations (safe — catch errors for already-existing columns) ──
  const migrations: string[] = [
    "ALTER TABLE categories ADD COLUMN color TEXT DEFAULT '#6b7280'",
    "ALTER TABLE categories ADD COLUMN icon TEXT DEFAULT ''",
    "ALTER TABLE categories ADD COLUMN is_active INTEGER DEFAULT 1",
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch (_) { /* column already exists — ignore */ }
  }

  return db;
}

export function switchCompany(companyId: string): void {
  currentCompanyId = companyId;
}

export function getCurrentCompanyId(): string | null {
  return currentCompanyId;
}

// ─── Generic CRUD ────────────────────────────────────────

export function queryAll(
  table: string,
  filters: Record<string, any> = {},
  sort?: { field: string; dir: 'asc' | 'desc' },
  limit?: number,
  offset?: number
): any[] {
  const conditions: string[] = [];
  const params: any[] = [];

  for (const [key, value] of Object.entries(filters)) {
    if (value === null) {
      conditions.push(`${key} IS NULL`);
    } else if (Array.isArray(value)) {
      conditions.push(`${key} IN (${value.map(() => '?').join(',')})`);
      params.push(...value);
    } else if (key.endsWith('_gte')) {
      const col = key.slice(0, -4);
      conditions.push(`${col} >= ?`);
      params.push(value);
    } else if (key.endsWith('_lte')) {
      const col = key.slice(0, -4);
      conditions.push(`${col} <= ?`);
      params.push(value);
    } else if (key.endsWith('_like')) {
      const col = key.slice(0, -5);
      conditions.push(`${col} LIKE ?`);
      params.push(value);
    } else if (key.endsWith('_ne')) {
      const col = key.slice(0, -3);
      conditions.push(`${col} != ?`);
      params.push(value);
    } else {
      conditions.push(`${key} = ?`);
      params.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
    }
  }

  let sql = `SELECT * FROM ${table}`;
  if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`;
  if (sort) sql += ` ORDER BY ${sort.field} ${sort.dir.toUpperCase()}`;
  if (limit) sql += ` LIMIT ${limit}`;
  if (offset) sql += ` OFFSET ${offset}`;

  return getDb().prepare(sql).all(...params);
}

export function getById(table: string, id: string): any {
  return getDb().prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
}

export function create(table: string, data: Record<string, any>): any {
  const id = data.id || uuid();
  const record = { ...data, id };

  const serialized: Record<string, any> = {};
  for (const [key, value] of Object.entries(record)) {
    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
      serialized[key] = JSON.stringify(value);
    } else if (typeof value === 'boolean') {
      serialized[key] = value ? 1 : 0;
    } else {
      serialized[key] = value;
    }
  }

  const keys = Object.keys(serialized);
  const placeholders = keys.map(() => '?').join(', ');
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`;

  getDb().prepare(sql).run(...keys.map(k => serialized[k]));
  return getById(table, id);
}

// Tables that do NOT have an updated_at column.
// Adding a table missing from this set causes every update() call on it
// to append ", updated_at = datetime('now')" → immediate SQLite crash.
const tablesWithoutUpdatedAt = new Set([
  // Child / junction tables (original)
  'invoice_line_items',
  'journal_entry_lines',
  'pay_stubs',
  'budget_lines',
  'bank_reconciliation_matches',
  // Financial record tables (append-only by design)
  'payments',          // has created_at only
  'tax_payments',      // has created_at only
  'tax_categories',    // has created_at only
  // Transaction / log tables (immutable after insert)
  'bank_transactions', // has imported_at only
  'audit_log',         // has timestamp only
  'email_log',         // has sent_at only
  'stripe_transactions', // has synced_at only
  // Metadata / reference tables
  'documents',         // has uploaded_at only
  'notifications',     // has created_at only
  'custom_field_defs', // has created_at only
  'saved_views',       // has created_at only
  'user_companies',    // has created_at only
]);

export function update(table: string, id: string, data: Record<string, any>): any {
  const serialized: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
      serialized[key] = JSON.stringify(value);
    } else if (typeof value === 'boolean') {
      serialized[key] = value ? 1 : 0;
    } else {
      serialized[key] = value;
    }
  }

  const sets = Object.keys(serialized).map(k => `${k} = ?`).join(', ');
  const updatedAtClause = tablesWithoutUpdatedAt.has(table) ? '' : ", updated_at = datetime('now')";
  const sql = `UPDATE ${table} SET ${sets}${updatedAtClause} WHERE id = ?`;

  getDb().prepare(sql).run(...Object.values(serialized), id);
  return getById(table, id);
}

export function remove(table: string, id: string): void {
  getDb().prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
}

export function logAudit(
  companyId: string,
  entityType: string,
  entityId: string,
  action: 'create' | 'update' | 'delete',
  changes: Record<string, any> = {}
): void {
  create('audit_log', {
    company_id: companyId,
    entity_type: entityType,
    entity_id: entityId,
    action,
    changes,
    performed_by: 'user',
  });
}

export function runQuery(sql: string, params: any[] = []): any[] {
  return getDb().prepare(sql).all(...params);
}

export function execQuery(sql: string, params: any[] = []): void {
  getDb().prepare(sql).run(...params);
}

// ─── Seed Default Chart of Accounts ──────────────────────

export function seedDefaultAccounts(companyId: string): void {
  // Guard: skip if accounts already exist for this company (prevents UNIQUE crash on double-call)
  const existing = getDb()
    .prepare('SELECT COUNT(*) as count FROM accounts WHERE company_id = ?')
    .get(companyId) as { count: number };
  if (existing?.count > 0) return;

  const defaults = [
    { code: '1000', name: 'Cash', type: 'asset', subtype: 'current' },
    { code: '1010', name: 'Checking Account', type: 'asset', subtype: 'bank' },
    { code: '1020', name: 'Savings Account', type: 'asset', subtype: 'bank' },
    { code: '1100', name: 'Accounts Receivable', type: 'asset', subtype: 'current' },
    { code: '1200', name: 'Prepaid Expenses', type: 'asset', subtype: 'current' },
    { code: '1500', name: 'Equipment', type: 'asset', subtype: 'fixed' },
    { code: '1510', name: 'Accumulated Depreciation', type: 'asset', subtype: 'contra' },
    { code: '2000', name: 'Accounts Payable', type: 'liability', subtype: 'current' },
    { code: '2100', name: 'Credit Card', type: 'liability', subtype: 'current' },
    { code: '2200', name: 'Payroll Liabilities', type: 'liability', subtype: 'current' },
    { code: '2300', name: 'Sales Tax Payable', type: 'liability', subtype: 'current' },
    { code: '2400', name: 'Federal Tax Payable', type: 'liability', subtype: 'current' },
    { code: '2410', name: 'State Tax Payable', type: 'liability', subtype: 'current' },
    { code: '3000', name: "Owner's Equity", type: 'equity', subtype: 'owner' },
    { code: '3100', name: "Owner's Draw", type: 'equity', subtype: 'draw' },
    { code: '3200', name: 'Retained Earnings', type: 'equity', subtype: 'retained' },
    { code: '4000', name: 'Service Revenue', type: 'revenue', subtype: 'operating' },
    { code: '4100', name: 'Consulting Revenue', type: 'revenue', subtype: 'operating' },
    { code: '4200', name: 'Project Revenue', type: 'revenue', subtype: 'operating' },
    { code: '4900', name: 'Other Income', type: 'revenue', subtype: 'other' },
    { code: '5000', name: 'Cost of Services', type: 'expense', subtype: 'cogs' },
    { code: '6000', name: 'Advertising & Marketing', type: 'expense', subtype: 'operating' },
    { code: '6100', name: 'Bank Fees', type: 'expense', subtype: 'operating' },
    { code: '6200', name: 'Contractors', type: 'expense', subtype: 'operating' },
    { code: '6300', name: 'Insurance', type: 'expense', subtype: 'operating' },
    { code: '6400', name: 'Office Supplies', type: 'expense', subtype: 'operating' },
    { code: '6500', name: 'Professional Fees', type: 'expense', subtype: 'operating' },
    { code: '6600', name: 'Rent', type: 'expense', subtype: 'operating' },
    { code: '6700', name: 'Software & Subscriptions', type: 'expense', subtype: 'operating' },
    { code: '6800', name: 'Travel & Meals', type: 'expense', subtype: 'operating' },
    { code: '6900', name: 'Utilities', type: 'expense', subtype: 'operating' },
    { code: '7000', name: 'Payroll Expense', type: 'expense', subtype: 'payroll' },
    { code: '7100', name: 'Payroll Tax Expense', type: 'expense', subtype: 'payroll' },
    { code: '7200', name: 'Depreciation Expense', type: 'expense', subtype: 'operating' },
    { code: '7500', name: 'Stripe Processing Fees', type: 'expense', subtype: 'operating' },
    { code: '9000', name: 'Miscellaneous Expense', type: 'expense', subtype: 'other' },
  ];

  for (const acct of defaults) {
    create('accounts', { company_id: companyId, ...acct });
  }
}
