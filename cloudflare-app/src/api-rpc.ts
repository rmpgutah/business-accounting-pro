// Generic D1 RPC handler — mirrors the Electron IPC channel surface so the
// React renderer can call the exact same api.ts methods in both Electron and
// web mode.  The caller is always identified by their JWT company_id (cid).

import { hashPassword, verifyPassword, signJWT, setSessionCookie } from './auth';

function uuid(): string {
  return crypto.randomUUID();
}

// Tables that are scoped to a company — the WHERE clause always includes
// company_id = ?.  Junction / child tables are excluded (they use a parent FK).
const COMPANY_SCOPED = new Set([
  'accounts', 'journal_entries', 'journal_entry_lines',
  'expenses', 'expense_attachments', 'expense_split_items',
  'income_entries', 'invoices', 'invoice_line_items', 'payments',
  'clients', 'vendors', 'categories', 'companies',
  'employees', 'payroll_runs', 'payroll_items', 'time_entries',
  'projects', 'project_tasks', 'mileage_log',
  'inventory_items', 'inventory_transactions',
  'budgets', 'budget_items', 'bank_accounts', 'bank_transactions',
  'tax_profiles', 'tax_entries', 'recurring_transactions',
  'documents', 'fixed_assets', 'asset_depreciation_schedules',
  'purchase_orders', 'po_line_items', 'bills', 'bill_line_items',
  'debt_collection_cases', 'automation_rules', 'bank_rules',
  'chart_of_accounts', 'loans', 'loan_payments',
  'notifications', 'custom_reports', 'audit_log',
  'email_templates', 'stripe_settings', 'api_keys', 'webhooks',
  'client_portal_settings', 'corp_cards',
  'kpi_snapshots', 'forecast_scenarios', 'search_index',
]);

// Tables whose rows do NOT have an updated_at column (match desktop list)
const NO_UPDATED_AT = new Set([
  'user_companies', 'invoice_line_items', 'po_line_items', 'bill_line_items',
  'journal_entry_lines', 'payroll_items', 'project_tasks', 'budget_items',
  'expense_split_items', 'asset_depreciation_schedules', 'inventory_transactions',
  'loan_payments', 'expense_attachments',
]);

function hasCompanyId(table: string): boolean {
  return COMPANY_SCOPED.has(table);
}

// ─── db:query ────────────────────────────────────────────────────────────────
async function dbQuery(
  db: D1Database,
  cid: string,
  { table, filters, sort, limit = 500, offset = 0 }: {
    table: string;
    filters?: Record<string, any>;
    sort?: { field: string; dir: 'asc' | 'desc' };
    limit?: number;
    offset?: number;
  },
): Promise<any[]> {
  const clauses: string[] = [];
  const vals: any[] = [];

  if (hasCompanyId(table)) {
    clauses.push('company_id = ?');
    vals.push(cid);
  }

  if (filters) {
    for (const [k, v] of Object.entries(filters)) {
      if (v === null) {
        clauses.push(`${k} IS NULL`);
      } else if (Array.isArray(v)) {
        if (v.length === 0) return [];
        clauses.push(`${k} IN (${v.map(() => '?').join(',')})`);
        vals.push(...v);
      } else {
        clauses.push(`${k} = ?`);
        vals.push(v);
      }
    }
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const order = sort ? `ORDER BY ${sort.field} ${sort.dir.toUpperCase()}` : '';
  const sql = `SELECT * FROM ${table} ${where} ${order} LIMIT ? OFFSET ?`;
  vals.push(limit, offset);

  const res = await db.prepare(sql).bind(...vals).all();
  return (res.results as any[]) || [];
}

// ─── db:get ──────────────────────────────────────────────────────────────────
async function dbGet(
  db: D1Database,
  cid: string,
  { table, id }: { table: string; id: string },
): Promise<any> {
  const companyClause = hasCompanyId(table) ? ' AND company_id = ?' : '';
  const vals: any[] = [id];
  if (hasCompanyId(table)) vals.push(cid);
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?${companyClause}`).bind(...vals).first();
}

// ─── db:create ───────────────────────────────────────────────────────────────
async function dbCreate(
  db: D1Database,
  cid: string,
  { table, data }: { table: string; data: Record<string, any> },
): Promise<{ id: string }> {
  const id = data.id || uuid();
  const row: Record<string, any> = { ...data, id };
  if (hasCompanyId(table) && !row.company_id) row.company_id = cid;
  if (!NO_UPDATED_AT.has(table)) row.updated_at = new Date().toISOString();

  const cols = Object.keys(row);
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  await db.prepare(sql).bind(...Object.values(row)).run();
  return { id };
}

// ─── db:update ───────────────────────────────────────────────────────────────
async function dbUpdate(
  db: D1Database,
  cid: string,
  { table, id, data }: { table: string; id: string; data: Record<string, any> },
): Promise<{ ok: boolean }> {
  const row: Record<string, any> = { ...data };
  delete row.id;
  delete row.company_id;
  if (!NO_UPDATED_AT.has(table)) row.updated_at = new Date().toISOString();

  const sets = Object.keys(row).map(k => `${k} = ?`).join(', ');
  const vals = [...Object.values(row), id];
  const companyClause = hasCompanyId(table) ? ' AND company_id = ?' : '';
  if (hasCompanyId(table)) vals.push(cid);

  await db.prepare(`UPDATE ${table} SET ${sets} WHERE id = ?${companyClause}`).bind(...vals).run();
  return { ok: true };
}

// ─── db:delete ───────────────────────────────────────────────────────────────
async function dbDelete(
  db: D1Database,
  cid: string,
  { table, id }: { table: string; id: string },
): Promise<{ ok: boolean }> {
  const companyClause = hasCompanyId(table) ? ' AND company_id = ?' : '';
  const vals: any[] = [id];
  if (hasCompanyId(table)) vals.push(cid);
  await db.prepare(`DELETE FROM ${table} WHERE id = ?${companyClause}`).bind(...vals).run();
  return { ok: true };
}

// ─── db:raw-query ─────────────────────────────────────────────────────────────
// Only SELECT is allowed — write operations must go through the typed channels.
async function dbRawQuery(
  db: D1Database,
  _cid: string,
  { sql, params }: { sql: string; params?: any[] },
): Promise<any[]> {
  const norm = sql.trim().toUpperCase();
  if (!norm.startsWith('SELECT') && !norm.startsWith('WITH')) {
    throw new Error('raw-query: only SELECT statements are allowed in web mode');
  }
  const res = await db.prepare(sql).bind(...(params || [])).all();
  return (res.results as any[]) || [];
}

// ─── auth channels ──────────────────────────────────────────────────────────
async function hasUsers(db: D1Database): Promise<boolean> {
  const row = await db.prepare('SELECT 1 FROM users LIMIT 1').first();
  return !!row;
}

async function listUsers(db: D1Database, _cid: string): Promise<any[]> {
  const res = await db.prepare(
    'SELECT id, email, display_name, role, avatar_color, last_login FROM users ORDER BY last_login DESC'
  ).all();
  return (res.results as any[]) || [];
}

async function authLogin(
  db: D1Database,
  _cid: string,
  { email, password }: { email: string; password: string },
  jwtSecret: string,
): Promise<{ user: any; companies: any[] }> {
  const row = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email.toLowerCase()).first<any>();
  if (!row) throw new Error('Invalid credentials');
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) throw new Error('Invalid credentials');

  // Update last_login
  await db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").bind(row.id).run();

  const cidRow = await db.prepare(
    'SELECT c.* FROM companies c JOIN user_companies uc ON uc.company_id = c.id WHERE uc.user_id = ? LIMIT 1'
  ).bind(row.id).first<any>();
  const companies = cidRow ? [cidRow] : [];

  return {
    user: {
      id: row.id,
      email: row.email,
      display_name: row.display_name,
      role: row.role,
      avatar_color: row.avatar_color || '#10b981',
    },
    companies,
  };
}

async function authRegister(
  db: D1Database,
  { email, password, displayName }: { email: string; password: string; displayName: string },
  jwtSecret: string,
): Promise<any> {
  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email.toLowerCase()).first();
  if (existing) throw new Error('Email already registered');

  const userId = uuid();
  const companyId = uuid();
  const hash = await hashPassword(password);

  await db.batch([
    db.prepare('INSERT INTO users (id, email, display_name, password_hash, role, avatar_color) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(userId, email.toLowerCase(), displayName, hash, 'owner', '#10b981'),
    db.prepare('INSERT INTO companies (id, name) VALUES (?, ?)')
      .bind(companyId, `${displayName}'s Business`),
    db.prepare('INSERT INTO user_companies (user_id, company_id, role) VALUES (?, ?, ?)')
      .bind(userId, companyId, 'owner'),
  ]);

  return { id: userId, email: email.toLowerCase(), display_name: displayName, role: 'owner', avatar_color: '#10b981' };
}

// ─── company channels ────────────────────────────────────────────────────────
async function companyList(db: D1Database, cid: string): Promise<any[]> {
  const res = await db.prepare(
    'SELECT c.* FROM companies c JOIN user_companies uc ON uc.company_id = c.id WHERE c.id = ? LIMIT 20'
  ).bind(cid).all();
  return (res.results as any[]) || [];
}

async function companyGet(db: D1Database, cid: string, id: string): Promise<any> {
  return db.prepare('SELECT * FROM companies WHERE id = ?').bind(id || cid).first();
}

// ─── dashboard channels ──────────────────────────────────────────────────────
async function dashboardStats(
  db: D1Database,
  cid: string,
  { startDate, endDate }: { startDate: string; endDate: string },
): Promise<any> {
  const [expR, incR, invR, arR] = await db.batch([
    db.prepare(`SELECT COALESCE(SUM(amount + COALESCE(tax_amount,0)),0) AS v FROM expenses WHERE company_id = ? AND date BETWEEN ? AND ?`).bind(cid, startDate, endDate),
    db.prepare(`SELECT COALESCE(SUM(amount),0) AS v FROM income_entries WHERE company_id = ? AND date BETWEEN ? AND ?`).bind(cid, startDate, endDate),
    db.prepare(`SELECT COALESCE(SUM(total),0) AS v FROM invoices WHERE company_id = ? AND date BETWEEN ? AND ?`).bind(cid, startDate, endDate),
    db.prepare(`SELECT COALESCE(SUM(total - amount_paid),0) AS v FROM invoices WHERE company_id = ? AND status NOT IN ('paid','void','draft')`).bind(cid),
  ]);
  return {
    totalExpenses: Number((expR.results?.[0] as any)?.v || 0),
    totalIncome: Number((incR.results?.[0] as any)?.v || 0),
    totalInvoiced: Number((invR.results?.[0] as any)?.v || 0),
    outstandingAR: Number((arR.results?.[0] as any)?.v || 0),
    netProfit: Number((incR.results?.[0] as any)?.v || 0) - Number((expR.results?.[0] as any)?.v || 0),
  };
}

async function dashboardCashflow(
  db: D1Database,
  cid: string,
  { startDate, endDate }: { startDate: string; endDate: string },
): Promise<any[]> {
  const [expR, incR] = await db.batch([
    db.prepare(`SELECT substr(date,1,7) AS month, SUM(amount + COALESCE(tax_amount,0)) AS amount FROM expenses WHERE company_id = ? AND date BETWEEN ? AND ? GROUP BY month ORDER BY month`).bind(cid, startDate, endDate),
    db.prepare(`SELECT substr(date,1,7) AS month, SUM(amount) AS amount FROM income_entries WHERE company_id = ? AND date BETWEEN ? AND ? GROUP BY month ORDER BY month`).bind(cid, startDate, endDate),
  ]);
  const exp = Object.fromEntries(((expR.results as any[]) || []).map((r: any) => [r.month, r.amount]));
  const inc = Object.fromEntries(((incR.results as any[]) || []).map((r: any) => [r.month, r.amount]));
  const months = Array.from(new Set([...Object.keys(exp), ...Object.keys(inc)])).sort();
  return months.map(month => ({ month, income: Number(inc[month] || 0), expenses: Number(exp[month] || 0) }));
}

// ─── Main dispatch ───────────────────────────────────────────────────────────
export async function handleRpc(
  channel: string,
  args: any[],
  cid: string,
  db: D1Database,
  jwtSecret: string,
): Promise<any> {
  switch (channel) {
    case 'db:query':      return dbQuery(db, cid, args[0]);
    case 'db:get':        return dbGet(db, cid, args[0]);
    case 'db:create':     return dbCreate(db, cid, args[0]);
    case 'db:update':     return dbUpdate(db, cid, args[0]);
    case 'db:delete':     return dbDelete(db, cid, args[0]);
    case 'db:raw-query':  return dbRawQuery(db, cid, args[0]);
    case 'auth:has-users': return hasUsers(db);
    case 'auth:list-users': return listUsers(db, cid);
    case 'auth:login':    return authLogin(db, cid, args[0], jwtSecret);
    case 'auth:register': return authRegister(db, args[0], jwtSecret);
    case 'company:list':  return companyList(db, cid);
    case 'company:get':   return companyGet(db, cid, args[0]);
    case 'company:switch': return { ok: true }; // cookie already carries cid; full switch needs a new JWT
    case 'dashboard:stats':    return dashboardStats(db, cid, args[0]);
    case 'dashboard:cashflow': return dashboardCashflow(db, cid, args[0]);
    // Channels that don't have a meaningful web equivalent — return safe stubs
    case 'auth:resume-session':
    case 'auth:logout':
    case 'search:backfill':
    case 'notification:mark-all-read':
      return { ok: true };
    default:
      // Return empty/null rather than erroring so the UI degrades gracefully
      return null;
  }
}
