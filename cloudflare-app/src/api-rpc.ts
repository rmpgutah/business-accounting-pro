// Generic D1 RPC handler — mirrors the Electron IPC channel surface so the
// React renderer can call the exact same api.ts methods in both Electron and
// web mode. The caller is always identified by their JWT company_id (cid).

import { hashPassword, verifyPassword, signJWT, setSessionCookie } from './auth';

function uuid(): string {
  return crypto.randomUUID();
}

// ─── Table name aliases ───────────────────────────────────────────────────────
// D1 schema uses shorter/different names for some tables vs the desktop schema.
// CRUD channels resolve through this map before hitting SQL so the React app
// can use the same table names it uses against Electron.
const TABLE_ALIASES: Record<string, string> = {
  journal_entry_lines:         'journal_entry_lines', // real table in D1 now
  recurring_transactions:      'recurring_templates',
  automation_rules:            'rules',
  bank_rules:                  'rules',
  custom_reports:              'saved_reports',
  chart_of_accounts:           'accounts',
  payroll_items:               'pay_stubs',
  budget_items:                'budget_lines',
  asset_depreciation_schedules:'asset_depreciation_entries',
};

function resolveTable(table: string): string {
  return TABLE_ALIASES[table] ?? table;
}

// ─── Company-scoped tables ────────────────────────────────────────────────────
// Only tables that physically have a company_id column go here — this drives
// automatic WHERE company_id = ? injection in all CRUD operations.
// VIEWs that alias a company-scoped table are also included.
const COMPANY_SCOPED = new Set([
  // Core business entities
  'accounts', 'chart_of_accounts',
  'journal_entries',
  'expenses',
  'income_entries',                // VIEW → payments
  'invoices', 'payments',
  'clients', 'vendors', 'categories',
  'employees', 'payroll_runs',     // pay_stubs has no company_id (child of run)
  'time_entries',
  'projects',
  'mileage_log',
  'inventory_items',
  'budgets',                       // budget_lines has no company_id
  'bank_accounts', 'bank_transactions',
  'documents',
  'fixed_assets',                  // asset_depreciation_entries has no company_id
  'purchase_orders',               // po_line_items has no company_id
  'bills',                         // bill_line_items has no company_id
  'loans',
  'notifications',
  'recurring_templates', 'recurring_transactions',
  'audit_log',
  'saved_reports', 'custom_reports',
  'rules', 'automation_rules', 'bank_rules',
  'debts', 'receipts', 'quotes',
]);

// ─── Tables without an updated_at column ────────────────────────────────────
// If a table is listed here, dbCreate / dbUpdate won't inject updated_at.
const NO_UPDATED_AT = new Set([
  // Junction / child tables (confirmed no updated_at)
  'user_companies',
  'invoice_line_items',
  'po_line_items',
  'bill_line_items',
  'quote_line_items',
  'expense_line_items',
  'journal_lines',           // D1 native name
  'journal_entry_lines',     // desktop / new table name
  'pay_stubs', 'payroll_items',
  'budget_lines', 'budget_items',
  'asset_depreciation_entries', 'asset_depreciation_schedules',
  // Other tables confirmed without updated_at
  'payments',
  'categories',
  'bank_transactions',
  'receipts',
  'documents',
  'audit_log',
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
  const resolved = resolveTable(table);
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
  const sql = `SELECT * FROM ${resolved} ${where} ${order} LIMIT ? OFFSET ?`;
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
  const resolved = resolveTable(table);
  const companyClause = hasCompanyId(table) ? ' AND company_id = ?' : '';
  const vals: any[] = [id];
  if (hasCompanyId(table)) vals.push(cid);
  return db.prepare(`SELECT * FROM ${resolved} WHERE id = ?${companyClause}`).bind(...vals).first();
}

// ─── db:create ───────────────────────────────────────────────────────────────
async function dbCreate(
  db: D1Database,
  cid: string,
  { table, data }: { table: string; data: Record<string, any> },
): Promise<{ id: string }> {
  const resolved = resolveTable(table);
  const id = data.id || uuid();
  const row: Record<string, any> = { ...data, id };
  if (hasCompanyId(table) && !row.company_id) row.company_id = cid;
  if (!NO_UPDATED_AT.has(table)) row.updated_at = new Date().toISOString();

  const cols = Object.keys(row);
  const sql = `INSERT INTO ${resolved} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  await db.prepare(sql).bind(...Object.values(row)).run();
  return { id };
}

// ─── db:update ───────────────────────────────────────────────────────────────
async function dbUpdate(
  db: D1Database,
  cid: string,
  { table, id, data }: { table: string; id: string; data: Record<string, any> },
): Promise<{ ok: boolean }> {
  const resolved = resolveTable(table);
  const row: Record<string, any> = { ...data };
  delete row.id;
  delete row.company_id;
  if (!NO_UPDATED_AT.has(table)) row.updated_at = new Date().toISOString();

  const sets = Object.keys(row).map(k => `${k} = ?`).join(', ');
  const vals = [...Object.values(row), id];
  const companyClause = hasCompanyId(table) ? ' AND company_id = ?' : '';
  if (hasCompanyId(table)) vals.push(cid);

  await db.prepare(`UPDATE ${resolved} SET ${sets} WHERE id = ?${companyClause}`).bind(...vals).run();
  return { ok: true };
}

// ─── db:delete ───────────────────────────────────────────────────────────────
async function dbDelete(
  db: D1Database,
  cid: string,
  { table, id }: { table: string; id: string },
): Promise<{ ok: boolean }> {
  const resolved = resolveTable(table);
  const companyClause = hasCompanyId(table) ? ' AND company_id = ?' : '';
  const vals: any[] = [id];
  if (hasCompanyId(table)) vals.push(cid);
  await db.prepare(`DELETE FROM ${resolved} WHERE id = ?${companyClause}`).bind(...vals).run();
  return { ok: true };
}

// ─── db:raw-query ─────────────────────────────────────────────────────────────
// Only SELECT/WITH allowed — write operations must go through the typed channels.
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
  // display_name was added via migration; alias name as fallback just in case.
  const res = await db.prepare(
    `SELECT id, email,
            COALESCE(display_name, name) AS display_name,
            role,
            COALESCE(avatar_color, '#10b981') AS avatar_color,
            last_login
     FROM users ORDER BY last_login DESC`
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

  // Stamp last_login (column added via migration)
  await db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").bind(row.id).run();

  const cidRes = await db.prepare(
    'SELECT c.* FROM companies c JOIN user_companies uc ON uc.company_id = c.id WHERE uc.user_id = ? LIMIT 1'
  ).bind(row.id).first<any>();
  const companies = cidRes ? [cidRes] : [];

  return {
    user: {
      id: row.id,
      email: row.email,
      display_name: row.display_name || row.name || row.email,
      role: row.role,
      avatar_color: row.avatar_color || '#10b981',
    },
    companies,
  };
}

async function authRegister(
  db: D1Database,
  { email, password, displayName }: { email: string; password: string; displayName: string },
  _jwtSecret: string,
): Promise<any> {
  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email.toLowerCase()).first();
  if (existing) throw new Error('Email already registered');

  const userId = uuid();
  const companyId = uuid();
  const hash = await hashPassword(password);

  // Insert both `name` (original column) and `display_name` (added via migration)
  await db.batch([
    db.prepare(
      'INSERT INTO users (id, email, name, display_name, password_hash, role, avatar_color) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(userId, email.toLowerCase(), displayName, displayName, hash, 'owner', '#10b981'),
    db.prepare('INSERT INTO companies (id, name) VALUES (?, ?)')
      .bind(companyId, `${displayName}'s Business`),
    db.prepare('INSERT INTO user_companies (user_id, company_id, role) VALUES (?, ?, ?)')
      .bind(userId, companyId, 'owner'),
  ]);

  return {
    user: {
      id: userId,
      email: email.toLowerCase(),
      display_name: displayName,
      role: 'owner',
      avatar_color: '#10b981',
    },
    companies: [{ id: companyId, name: `${displayName}'s Business` }],
  };
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

async function companyCreate(
  db: D1Database,
  userId: string,
  { name, email, phone, address, tax_id, currency }: Record<string, any>,
): Promise<{ id: string }> {
  const id = uuid();
  await db.batch([
    db.prepare('INSERT INTO companies (id, name, email, phone, address, tax_id, currency) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, name, email || null, phone || null, address || null, tax_id || null, currency || 'USD'),
    db.prepare('INSERT INTO user_companies (user_id, company_id, role) VALUES (?, ?, ?)')
      .bind(userId, id, 'owner'),
  ]);
  return { id };
}

async function companyUpdate(
  db: D1Database,
  cid: string,
  { id, data }: { id: string; data: Record<string, any> },
): Promise<{ ok: boolean }> {
  const row = { ...data };
  delete row.id;
  const sets = Object.keys(row).map(k => `${k} = ?`).join(', ');
  await db.prepare(`UPDATE companies SET ${sets} WHERE id = ?`).bind(...Object.values(row), id || cid).run();
  return { ok: true };
}

// ─── dashboard channels ──────────────────────────────────────────────────────
// income_entries is a VIEW backed by payments (added via D1 migration) so the
// same SQL works without changes.
async function dashboardStats(
  db: D1Database,
  cid: string,
  { startDate, endDate }: { startDate: string; endDate: string },
): Promise<any> {
  const [expR, incR, invR, arR] = await db.batch([
    db.prepare(
      `SELECT COALESCE(SUM(amount + COALESCE(tax_amount,0)),0) AS v
       FROM expenses WHERE company_id = ? AND date BETWEEN ? AND ?`
    ).bind(cid, startDate, endDate),
    db.prepare(
      `SELECT COALESCE(SUM(amount),0) AS v
       FROM income_entries WHERE company_id = ? AND date BETWEEN ? AND ?`
    ).bind(cid, startDate, endDate),
    db.prepare(
      `SELECT COALESCE(SUM(total),0) AS v
       FROM invoices WHERE company_id = ? AND date BETWEEN ? AND ?`
    ).bind(cid, startDate, endDate),
    db.prepare(
      `SELECT COALESCE(SUM(total - amount_paid),0) AS v
       FROM invoices WHERE company_id = ? AND status NOT IN ('paid','void','draft')`
    ).bind(cid),
  ]);
  const totalIncome   = Number((incR.results?.[0] as any)?.v || 0);
  const totalExpenses = Number((expR.results?.[0] as any)?.v || 0);
  return {
    totalExpenses,
    totalIncome,
    totalInvoiced: Number((invR.results?.[0] as any)?.v || 0),
    outstandingAR: Number((arR.results?.[0] as any)?.v || 0),
    netProfit: totalIncome - totalExpenses,
  };
}

async function dashboardCashflow(
  db: D1Database,
  cid: string,
  { startDate, endDate }: { startDate: string; endDate: string },
): Promise<any[]> {
  const [expR, incR] = await db.batch([
    db.prepare(
      `SELECT substr(date,1,7) AS month, SUM(amount + COALESCE(tax_amount,0)) AS amount
       FROM expenses WHERE company_id = ? AND date BETWEEN ? AND ?
       GROUP BY month ORDER BY month`
    ).bind(cid, startDate, endDate),
    db.prepare(
      `SELECT substr(date,1,7) AS month, SUM(amount) AS amount
       FROM income_entries WHERE company_id = ? AND date BETWEEN ? AND ?
       GROUP BY month ORDER BY month`
    ).bind(cid, startDate, endDate),
  ]);
  const exp = Object.fromEntries(((expR.results as any[]) || []).map((r: any) => [r.month, r.amount]));
  const inc = Object.fromEntries(((incR.results as any[]) || []).map((r: any) => [r.month, r.amount]));
  const months = Array.from(new Set([...Object.keys(exp), ...Object.keys(inc)])).sort();
  return months.map(month => ({
    month,
    income:   Number(inc[month] || 0),
    expenses: Number(exp[month] || 0),
  }));
}

// ─── Main dispatch ───────────────────────────────────────────────────────────
export async function handleRpc(
  channel: string,
  args: any[],
  cid: string,
  db: D1Database,
  jwtSecret: string,
  userId?: string,
): Promise<any> {
  switch (channel) {
    // ── Generic CRUD ─────────────────────────────────────────────────────────
    case 'db:query':     return dbQuery(db, cid, args[0]);
    case 'db:get':       return dbGet(db, cid, args[0]);
    case 'db:create':    return dbCreate(db, cid, args[0]);
    case 'db:update':    return dbUpdate(db, cid, args[0]);
    case 'db:delete':    return dbDelete(db, cid, args[0]);
    case 'db:raw-query': return dbRawQuery(db, cid, args[0]);

    // ── Auth ─────────────────────────────────────────────────────────────────
    case 'auth:has-users':  return hasUsers(db);
    case 'auth:list-users': return listUsers(db, cid);
    case 'auth:login':      return authLogin(db, cid, args[0], jwtSecret);
    case 'auth:register':   return authRegister(db, args[0], jwtSecret);

    // ── Company ──────────────────────────────────────────────────────────────
    case 'company:list':   return companyList(db, cid);
    case 'company:get':    return companyGet(db, cid, args[0]);
    case 'company:create': return companyCreate(db, userId ?? '', args[0]);
    case 'company:update': return companyUpdate(db, cid, args[0]);
    case 'company:switch': return { ok: true }; // cookie carries cid; full switch needs new JWT

    // ── Dashboard ────────────────────────────────────────────────────────────
    case 'dashboard:stats':    return dashboardStats(db, cid, args[0]);
    case 'dashboard:cashflow': return dashboardCashflow(db, cid, args[0]);

    // ── Vendor delete (hard-delete variant with FK cleanup) ──────────────────
    case 'vendors:delete': {
      const { id } = args[0] || {};
      if (!id) return { ok: false };
      await db.batch([
        db.prepare('UPDATE expenses SET vendor_id = NULL WHERE vendor_id = ? AND company_id = ?').bind(id, cid),
        db.prepare('DELETE FROM vendors WHERE id = ? AND company_id = ?').bind(id, cid),
      ]);
      return { ok: true };
    }

    // ── Notifications ────────────────────────────────────────────────────────
    case 'notification:list': {
      const { unread_only } = args[0] || {};
      const where = unread_only ? 'WHERE company_id = ? AND is_read = 0' : 'WHERE company_id = ?';
      const res = await db.prepare(
        `SELECT * FROM notifications ${where} ORDER BY created_at DESC LIMIT 100`
      ).bind(cid).all();
      return (res.results as any[]) || [];
    }
    case 'notification:mark-read': {
      await db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND company_id = ?')
        .bind(args[0], cid).run();
      return { ok: true };
    }
    case 'notification:mark-all-read': {
      const r = await db.prepare('UPDATE notifications SET is_read = 1 WHERE company_id = ?')
        .bind(cid).run();
      return (r as any).meta?.changes ?? 0;
    }
    case 'notification:dismiss':
    case 'notification:clear-all':
    case 'notification:run-checks':
    case 'notification:preferences':
    case 'notification:update-preferences':
      return { ok: true };

    // ── Safe stubs — desktop-only or not yet implemented ─────────────────────
    case 'auth:resume-session':
    case 'auth:logout':
    case 'auth:validate-session':
    case 'auth:link-user-company':
    case 'auth:delete-account':
    case 'search:backfill':
    case 'search:global':
    case 'search:index':
    case 'invoice:generate-pdf':
    case 'invoice:send-email':
    case 'invoice:generate-token':
    case 'invoice:token-info':
    case 'invoice:regenerate-token':
    case 'invoice:disable-token':
    case 'invoice:get-settings':
    case 'invoice:save-settings':
    case 'invoice:catalog-list':
    case 'invoice:catalog-save':
    case 'invoice:catalog-delete':
    case 'invoice:payment-schedule-list':
    case 'invoice:payment-schedule-save':
    case 'invoice:schedule-reminders':
    case 'invoice:list-reminders':
    case 'invoice:debt-link':
    case 'invoice:overdue-candidates':
    case 'invoice:convert-to-debt':
    case 'client:contacts-list':
    case 'client:contacts-save':
    case 'debt:promises-list':
    case 'debt:promise-save':
    case 'debt:promise-update':
    case 'debt:portfolio-report-data':
    case 'debt:assign-collector':
    case 'debt:portal-token-info':
    case 'debt:regenerate-portal-token':
    case 'debt:disable-portal-token':
    case 'debt:invoice-link':
    case 'portal:base-url':
    case 'portal-integration:get':
    case 'portal-integration:save':
    case 'portal-integration:test':
    case 'shell:open-external':
    case 'dialog:open-file':
    case 'export:csv':
    case 'export:full-backup':
    case 'import:preview-csv':
    case 'import:execute':
    case 'batch:update':
    case 'batch:delete':
    case 'action:invoke':
    case 'recurring:process-now':
    case 'recurring:last-processed':
    case 'recurring:history':
    case 'accounts:suggest-code':
      return null;

    default:
      // Unknown channels return null — the UI degrades gracefully (empty state).
      return null;
  }
}
