// BAP Cloud — Cloudflare Worker entry point.
//
// Single Worker, every path on accounting.rmpgutah.us:
//   /                      → marketing/landing (delegates to landing-page if signed out, dashboard if signed in)
//   /auth/{login,register,logout}
//   /app/*                 → authenticated web app (dashboard, expenses, …)
//   /api/*                 → JSON API consumed by the SPA bits
//   /api/sync/{push,pull}  → desktop ↔ cloud sync (DESKTOP_SYNC_TOKEN required)
//   /portal*               → client-facing portal (magic-link token)
//
// Why Hono: rock-solid Workers-native router with type-safe context, tiny
// runtime, no Node-isms. Compatible with the JSX-via-strings approach we use
// for HTML responses.

import { Hono } from 'hono';
import { uuid, hashPassword, verifyPassword, signJWT, verifyJWT,
  setSessionCookie, clearSessionCookie, readSessionCookie } from './auth';
import { landingPage } from './ui/landing';
import { dashboardPage, type DashboardKpi, type DashboardLists } from './ui/dashboard';
import { expenseCapturePage } from './ui/expense-capture';
import { portalIndexPage, portalInvoicePage, type PortalClient, type PortalInvoice } from './ui/portal-view';
import { clientFormPage } from './ui/client-form';
import { vendorFormPage } from './ui/vendor-form';
import { mileageFormPage } from './ui/mileage-form';
import { invoiceFormPage } from './ui/invoice-form';
import { employeeFormPage } from './ui/employee-form';
import { timeFormPage } from './ui/time-form';
import { projectFormPage } from './ui/project-form';
import { documentFormPage } from './ui/document-form';
import { simpleFormPage, type SimpleField } from './ui/generic-form';
import { shell } from './ui/shell';

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  SESSIONS: KVNamespace;
  JWT_SECRET: string;
  DESKTOP_SYNC_TOKEN: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  PORTAL_BRAND: string;
  ENVIRONMENT: string;
}

type Variables = {
  userId?: string;
  companyId?: string;
  // Portal context (mutually exclusive with userId)
  portalClientId?: string;
  portalCompanyId?: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Surface actual error messages instead of the bare "Internal Server Error"
// HTML page. JSON endpoints get a structured {error, where} payload; HTML
// page errors get a small inline notice. The full stack still lands in the
// wrangler tail logs so we can trace causes without exposing internals to
// the browser console.
app.onError((err, c) => {
  console.error('Worker error:', err?.stack || err);
  const accept = c.req.header('accept') || '';
  const path = c.req.path;
  const wantsJSON = accept.includes('application/json') || path.startsWith('/api/') || path.startsWith('/auth/');
  if (wantsJSON) {
    return c.json({
      error: (err && (err as any).message) || 'Unknown error',
      where: path,
    }, 500);
  }
  return c.text('Internal Server Error: ' + ((err && (err as any).message) || 'unknown'), 500);
});

// ─── Auth middleware ────────────────────────────────────────
async function requireUser(c: any, next: () => Promise<void>): Promise<Response | void> {
  const token = readSessionCookie(c.req.header('cookie') ?? null);
  if (!token) return c.redirect('/auth/login', 302);
  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) return c.redirect('/auth/login', 302);
  c.set('userId', payload.sub);
  c.set('companyId', payload.cid);
  // Renew the cookie so an active user never gets booted mid-session.
  c.header('Set-Cookie', setSessionCookie(token, c.env.ENVIRONMENT === 'production'));
  await next();
}
async function requireUserAPI(c: any, next: () => Promise<void>): Promise<Response | void> {
  const token = readSessionCookie(c.req.header('cookie') ?? null);
  if (!token) return c.json({ error: 'Not authenticated' }, 401);
  const payload = await verifyJWT(token, c.env.JWT_SECRET);
  if (!payload) return c.json({ error: 'Session expired' }, 401);
  c.set('userId', payload.sub);
  c.set('companyId', payload.cid);
  await next();
}

// ─── Root ────────────────────────────────────────────────────
app.get('/', async (c) => {
  const token = readSessionCookie(c.req.header('cookie') ?? null);
  if (token && await verifyJWT(token, c.env.JWT_SECRET)) return c.redirect('/app/dashboard', 302);
  return c.redirect('/auth/login', 302);
});

// ─── Auth: HTML pages ────────────────────────────────────────
app.get('/auth/login', (c) => c.html(landingPage({ mode: 'login' })));
app.get('/auth/register', (c) => c.html(landingPage({ mode: 'register' })));
app.get('/auth/logout', (c) => {
  c.header('Set-Cookie', clearSessionCookie());
  return c.redirect('/auth/login', 302);
});

// ─── Auth: JSON endpoints ────────────────────────────────────
app.post('/auth/register', async (c) => {
  const body = await c.req.json<{ name?: string; email: string; password: string }>();
  if (!body.email || !body.password || body.password.length < 8) {
    return c.json({ error: 'Email and an 8+ character password required' }, 400);
  }
  // Lower-case + trim email so re-registration with different casing doesn't
  // create duplicate accounts.
  const email = body.email.trim().toLowerCase();
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) return c.json({ error: 'Email already registered' }, 409);

  const hash = await hashPassword(body.password);
  const userId = uuid();
  const companyId = uuid();
  // First-time registration: create a company AND link the user as owner so
  // every brand-new account has a tenant scope to write into immediately.
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)')
      .bind(userId, email, hash, body.name || '', 'owner'),
    c.env.DB.prepare('INSERT INTO companies (id, name) VALUES (?, ?)')
      .bind(companyId, body.name ? `${body.name}'s Business` : 'My Business'),
    c.env.DB.prepare('INSERT INTO user_companies (user_id, company_id, role) VALUES (?, ?, ?)')
      .bind(userId, companyId, 'owner'),
  ]);
  const token = await signJWT({ sub: userId, cid: companyId, role: 'owner' }, c.env.JWT_SECRET);
  c.header('Set-Cookie', setSessionCookie(token, c.env.ENVIRONMENT === 'production'));
  return c.json({ ok: true, userId });
});

app.post('/auth/login', async (c) => {
  const body = await c.req.json<{ email: string; password: string }>();
  const email = (body.email || '').trim().toLowerCase();
  const row = await c.env.DB.prepare('SELECT id, password_hash, role FROM users WHERE email = ?')
    .bind(email).first<{ id: string; password_hash: string; role: string }>();
  if (!row) return c.json({ error: 'Invalid credentials' }, 401);
  const ok = await verifyPassword(body.password || '', row.password_hash);
  if (!ok) return c.json({ error: 'Invalid credentials' }, 401);

  // Pick the user's first (or sole) company for the active scope. A
  // multi-company UI can later POST /auth/switch-company.
  const cidRow = await c.env.DB.prepare('SELECT company_id FROM user_companies WHERE user_id = ? LIMIT 1')
    .bind(row.id).first<{ company_id: string }>();
  const token = await signJWT({ sub: row.id, cid: cidRow?.company_id, role: row.role }, c.env.JWT_SECRET);
  c.header('Set-Cookie', setSessionCookie(token, c.env.ENVIRONMENT === 'production'));
  return c.json({ ok: true });
});

// ─── /app/* — authenticated UI pages ─────────────────────────
app.use('/app/*', requireUser);

app.get('/app/dashboard', async (c) => {
  const cid = c.get('companyId');
  if (!cid) return c.redirect('/auth/login', 302);
  const year = new Date().getFullYear().toString();
  // KPIs in one batch query — sum YTD by table.
  const [expSum, invSum, ar, mileSum, company, recentExp, recentInv] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT COALESCE(SUM(amount + COALESCE(tax_amount,0)), 0) AS v FROM expenses WHERE company_id = ? AND substr(date,1,4) = ?`).bind(cid, year),
    c.env.DB.prepare(`SELECT COALESCE(SUM(total), 0) AS v FROM invoices WHERE company_id = ? AND substr(date,1,4) = ?`).bind(cid, year),
    c.env.DB.prepare(`SELECT COALESCE(SUM(total - amount_paid), 0) AS v FROM invoices WHERE company_id = ? AND status NOT IN ('paid','void','draft')`).bind(cid),
    c.env.DB.prepare(`SELECT COALESCE(SUM(deduction_amount), 0) AS v FROM mileage_log WHERE company_id = ? AND substr(trip_date,1,4) = ?`).bind(cid, year),
    c.env.DB.prepare(`SELECT name FROM companies WHERE id = ?`).bind(cid),
    c.env.DB.prepare(`SELECT e.id, e.date, e.description, (e.amount + COALESCE(e.tax_amount,0)) AS amount, v.name AS vendor_name
                      FROM expenses e LEFT JOIN vendors v ON v.id = e.vendor_id
                      WHERE e.company_id = ? ORDER BY e.date DESC LIMIT 8`).bind(cid),
    c.env.DB.prepare(`SELECT i.id, i.date, i.invoice_number, i.status, i.total, c.name AS client_name
                      FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
                      WHERE i.company_id = ? ORDER BY i.date DESC LIMIT 8`).bind(cid),
  ]);
  const kpi: DashboardKpi = {
    expensesYtd: Number((expSum.results?.[0] as any)?.v || 0),
    invoicesYtd: Number((invSum.results?.[0] as any)?.v || 0),
    outstandingAR: Number((ar.results?.[0] as any)?.v || 0),
    mileageDeductionYtd: Number((mileSum.results?.[0] as any)?.v || 0),
  };
  const lists: DashboardLists = {
    recentExpenses: (recentExp.results as any) || [],
    recentInvoices: (recentInv.results as any) || [],
  };
  const companyName = (company.results?.[0] as any)?.name || 'My Business';
  return c.html(dashboardPage(kpi, lists, companyName));
});

app.get('/app/expenses/new', async (c) => {
  const cid = c.get('companyId')!;
  const [vendors, categories, clients, projects] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT id, name FROM vendors WHERE company_id = ? AND status = ?').bind(cid, 'active'),
    c.env.DB.prepare('SELECT id, name FROM categories WHERE company_id = ?').bind(cid),
    c.env.DB.prepare('SELECT id, name FROM clients WHERE company_id = ? AND status = ?').bind(cid, 'active'),
    c.env.DB.prepare('SELECT id, name FROM projects WHERE company_id = ? AND status = ?').bind(cid, 'active'),
  ]);
  return c.html(expenseCapturePage({
    today: new Date().toISOString().slice(0, 10),
    vendors: (vendors.results as any) || [],
    categories: (categories.results as any) || [],
    clients: (clients.results as any) || [],
    projects: (projects.results as any) || [],
  }));
});

// Placeholder index pages — extension points for full CRUD parity.
// Each one renders a table from the live DB; editing UI is the next iteration.
app.get('/app/expenses', async (c) => listingPage(c, 'Expenses', 'expenses', `
  SELECT e.id, e.date, e.description, e.amount + COALESCE(e.tax_amount,0) AS total,
         v.name AS vendor_name, c.name AS category_name
  FROM expenses e
  LEFT JOIN vendors v ON v.id = e.vendor_id
  LEFT JOIN categories c ON c.id = e.category_id
  WHERE e.company_id = ?
  ORDER BY e.date DESC LIMIT 200`,
  ['Date', 'Description', 'Vendor', 'Category', 'Total'],
  (r: any) => [fmtDate(r.date), esc(r.description || ''), esc(r.vendor_name || '—'), esc(r.category_name || '—'), fmtMoney(r.total)],
  '/app/expenses/new'
));
app.get('/app/invoices', async (c) => listingPage(c, 'Invoices', 'invoices', `
  SELECT i.id, i.date, i.invoice_number, i.status, i.total, cl.name AS client_name
  FROM invoices i LEFT JOIN clients cl ON cl.id = i.client_id
  WHERE i.company_id = ? ORDER BY i.date DESC LIMIT 200`,
  ['Date', '#', 'Client', 'Status', 'Total'],
  (r: any) => [fmtDate(r.date), esc(r.invoice_number || r.id.slice(0,8)), esc(r.client_name || '—'), esc(r.status), fmtMoney(r.total)],
));
app.get('/app/clients', async (c) => listingPage(c, 'Clients', 'clients', `
  SELECT id, name, email, phone, status FROM clients WHERE company_id = ? ORDER BY name`,
  ['Name', 'Email', 'Phone', 'Status'],
  (r: any) => [`<a href="/app/clients/${esc(r.id)}">${esc(r.name)}</a>`, esc(r.email || '—'), esc(r.phone || '—'), esc(r.status)],
  '/app/clients/new',
));
app.get('/app/vendors', async (c) => listingPage(c, 'Vendors', 'vendors', `
  SELECT id, name, email, phone, status FROM vendors WHERE company_id = ? ORDER BY name`,
  ['Name', 'Email', 'Phone', 'Status'],
  (r: any) => [`<a href="/app/vendors/${esc(r.id)}">${esc(r.name)}</a>`, esc(r.email || '—'), esc(r.phone || '—'), esc(r.status)],
  '/app/vendors/new',
));

// ─── Bills (AP) listing + form ────────────────────────────
app.get('/app/bills', async (c) => listingPage(c, 'Bills', 'bills', `
  SELECT b.id, b.bill_number, b.date, b.due_date, b.status, b.total, b.amount_paid,
         v.name as vendor_name
  FROM bills b
  LEFT JOIN vendors v ON v.id = b.vendor_id
  WHERE b.company_id = ? ORDER BY b.date DESC, b.id DESC`,
  ['#', 'Vendor', 'Date', 'Due', 'Status', 'Total'],
  (r: any) => [
    `<a href="/app/bills/${esc(r.id)}">${esc(r.bill_number || r.id.slice(0, 8))}</a>`,
    esc(r.vendor_name || '—'),
    fmtDate(r.date), fmtDate(r.due_date),
    `<span class="badge ${r.status === 'paid' ? 'badge-green' : r.status === 'overdue' ? 'badge-red' : 'badge-amber'}">${esc(r.status)}</span>`,
    fmtMoney(r.total),
  ],
  '/app/bills/new',
));

// ─── Quotes listing + form ────────────────────────────────
app.get('/app/quotes', async (c) => listingPage(c, 'Quotes', 'quotes', `
  SELECT q.id, q.quote_number, q.date, q.expires_date, q.status, q.total,
         c.name as client_name
  FROM quotes q
  LEFT JOIN clients c ON c.id = q.client_id
  WHERE q.company_id = ? ORDER BY q.date DESC, q.id DESC`,
  ['#', 'Client', 'Date', 'Expires', 'Status', 'Total'],
  (r: any) => [
    `<a href="/app/quotes/${esc(r.id)}">${esc(r.quote_number || r.id.slice(0, 8))}</a>`,
    esc(r.client_name || '—'),
    fmtDate(r.date), fmtDate(r.expires_date),
    `<span class="badge ${r.status === 'accepted' ? 'badge-green' : r.status === 'declined' ? 'badge-red' : 'badge-blue'}">${esc(r.status)}</span>`,
    fmtMoney(r.total),
  ],
  '/app/quotes/new',
));

// ─── Projects listing + form ──────────────────────────────
app.get('/app/projects', async (c) => listingPage(c, 'Projects', 'projects', `
  SELECT p.id, p.name, p.status, p.budget, p.start_date, p.end_date,
         c.name as client_name
  FROM projects p
  LEFT JOIN clients c ON c.id = p.client_id
  WHERE p.company_id = ? ORDER BY p.name`,
  ['Name', 'Client', 'Status', 'Budget', 'Dates'],
  (r: any) => [
    `<a href="/app/projects/${esc(r.id)}">${esc(r.name)}</a>`,
    esc(r.client_name || '—'),
    `<span class="badge">${esc(r.status)}</span>`,
    fmtMoney(r.budget),
    esc(fmtDate(r.start_date)) + (r.end_date ? ' → ' + esc(fmtDate(r.end_date)) : ''),
  ],
  '/app/projects/new',
));

// ─── Time entries listing + form ──────────────────────────
app.get('/app/time', async (c) => listingPage(c, 'Time', 'time', `
  SELECT t.id, t.date, t.duration_minutes, t.description, t.is_billable, t.is_invoiced, t.hourly_rate,
         e.name as employee_name, p.name as project_name, c.name as client_name
  FROM time_entries t
  LEFT JOIN employees e ON e.id = t.employee_id
  LEFT JOIN projects p ON p.id = t.project_id
  LEFT JOIN clients c ON c.id = t.client_id
  WHERE t.company_id = ? ORDER BY t.date DESC LIMIT 300`,
  ['Date', 'Employee', 'Project', 'Hours', 'Rate', 'Billable'],
  (r: any) => [
    fmtDate(r.date),
    `<a href="/app/time/${esc(r.id)}">${esc(r.employee_name || '—')}</a>`,
    esc(r.project_name || r.client_name || '—'),
    String(((r.duration_minutes || 0) / 60).toFixed(2)),
    fmtMoney(r.hourly_rate),
    r.is_invoiced ? '✓ inv.' : r.is_billable ? '✓' : '—',
  ],
  '/app/time/new',
));

// ─── Employees listing + form ─────────────────────────────
app.get('/app/employees', async (c) => listingPage(c, 'Employees', 'employees', `
  SELECT id, name, email, role, pay_rate, pay_type, status FROM employees
  WHERE company_id = ? ORDER BY name`,
  ['Name', 'Email', 'Role', 'Pay'],
  (r: any) => [
    `<a href="/app/employees/${esc(r.id)}">${esc(r.name)}</a>`,
    esc(r.email || '—'),
    esc(r.role || '—'),
    fmtMoney(r.pay_rate) + ' / ' + esc(r.pay_type || 'hourly'),
  ],
  '/app/employees/new',
));

// ─── Bills new/edit/show pages ────────────────────────────
const BILL_DOC_CFG = {
  kind: 'bill' as const,
  pluralLabel: 'Bills (AP)',
  navKey: 'bills',
  partyLabel: 'Vendor' as const,
  partyField: 'vendor_id' as const,
  parties: [] as Array<{ id: string; name: string }>,
  statusOptions: ['open', 'paid', 'overdue', 'void'],
  numberLabel: 'Bill #',
  secondaryDateLabel: 'Due Date',
  secondaryDateField: 'due_date' as const,
};
app.get('/app/bills/new', async (c) => {
  const cid = c.get('companyId')!;
  const vendors = await c.env.DB.prepare('SELECT id, name FROM vendors WHERE company_id = ? AND status = ? ORDER BY name').bind(cid, 'active').all();
  return c.html(documentFormPage(null, [],
    { ...BILL_DOC_CFG, parties: (vendors.results as any) || [] },
    new Date().toISOString().slice(0, 10)));
});
app.get('/app/bills/:id', async (c) => {
  const cid = c.get('companyId')!;
  const [bill, lines, vendors] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT * FROM bills WHERE id = ? AND company_id = ?').bind(c.req.param('id'), cid),
    c.env.DB.prepare('SELECT * FROM bill_line_items WHERE bill_id = ? ORDER BY sort_order').bind(c.req.param('id')),
    c.env.DB.prepare('SELECT id, name FROM vendors WHERE company_id = ? AND status = ? ORDER BY name').bind(cid, 'active'),
  ]);
  const row = (bill.results as any[])?.[0];
  if (!row) return c.notFound();
  // Project the bill_number column onto generic 'number' field for the form.
  const normalized = { ...row, number: row.bill_number };
  return c.html(documentFormPage(normalized, (lines.results as any) || [],
    { ...BILL_DOC_CFG, parties: (vendors.results as any) || [] },
    new Date().toISOString().slice(0, 10)));
});

// ─── Quotes new/edit/show pages ───────────────────────────
const QUOTE_DOC_CFG = {
  kind: 'quote' as const,
  pluralLabel: 'Quotes',
  navKey: 'quotes',
  partyLabel: 'Client' as const,
  partyField: 'client_id' as const,
  parties: [] as Array<{ id: string; name: string }>,
  statusOptions: ['draft', 'sent', 'accepted', 'declined', 'expired'],
  numberLabel: 'Quote #',
  secondaryDateLabel: 'Expires',
  secondaryDateField: 'expires_date' as const,
};
app.get('/app/quotes/new', async (c) => {
  const cid = c.get('companyId')!;
  const clients = await c.env.DB.prepare('SELECT id, name FROM clients WHERE company_id = ? AND status = ? ORDER BY name').bind(cid, 'active').all();
  return c.html(documentFormPage(null, [],
    { ...QUOTE_DOC_CFG, parties: (clients.results as any) || [] },
    new Date().toISOString().slice(0, 10)));
});
app.get('/app/quotes/:id', async (c) => {
  const cid = c.get('companyId')!;
  const [quote, lines, clients] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT * FROM quotes WHERE id = ? AND company_id = ?').bind(c.req.param('id'), cid),
    c.env.DB.prepare('SELECT * FROM quote_line_items WHERE quote_id = ? ORDER BY sort_order').bind(c.req.param('id')),
    c.env.DB.prepare('SELECT id, name FROM clients WHERE company_id = ? AND status = ? ORDER BY name').bind(cid, 'active'),
  ]);
  const row = (quote.results as any[])?.[0];
  if (!row) return c.notFound();
  const normalized = { ...row, number: row.quote_number };
  return c.html(documentFormPage(normalized, (lines.results as any) || [],
    { ...QUOTE_DOC_CFG, parties: (clients.results as any) || [] },
    new Date().toISOString().slice(0, 10)));
});

// ─── Projects new/edit pages ──────────────────────────────
app.get('/app/projects/new', async (c) => {
  const cid = c.get('companyId')!;
  const clients = await c.env.DB.prepare('SELECT id, name FROM clients WHERE company_id = ? AND status = ? ORDER BY name').bind(cid, 'active').all();
  return c.html(projectFormPage(null, (clients.results as any) || [], new Date().toISOString().slice(0, 10)));
});
app.get('/app/projects/:id', async (c) => {
  const cid = c.get('companyId')!;
  const [proj, clients] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT * FROM projects WHERE id = ? AND company_id = ?').bind(c.req.param('id'), cid),
    c.env.DB.prepare('SELECT id, name FROM clients WHERE company_id = ? AND status = ? ORDER BY name').bind(cid, 'active'),
  ]);
  const row = (proj.results as any[])?.[0];
  if (!row) return c.notFound();
  return c.html(projectFormPage(row, (clients.results as any) || [], new Date().toISOString().slice(0, 10)));
});

// ─── Time entries new/edit pages ──────────────────────────
app.get('/app/time/new', async (c) => {
  const cid = c.get('companyId')!;
  const [emps, projects, clients] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT id, name, pay_rate FROM employees WHERE company_id = ? AND status = ? ORDER BY name').bind(cid, 'active'),
    c.env.DB.prepare('SELECT id, name FROM projects WHERE company_id = ? AND status = ? ORDER BY name').bind(cid, 'active'),
    c.env.DB.prepare('SELECT id, name FROM clients WHERE company_id = ? AND status = ? ORDER BY name').bind(cid, 'active'),
  ]);
  return c.html(timeFormPage(null,
    (emps.results as any) || [],
    (projects.results as any) || [],
    (clients.results as any) || [],
    new Date().toISOString().slice(0, 10),
  ));
});
app.get('/app/time/:id', async (c) => {
  const cid = c.get('companyId')!;
  const [entry, emps, projects, clients] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT * FROM time_entries WHERE id = ? AND company_id = ?').bind(c.req.param('id'), cid),
    c.env.DB.prepare('SELECT id, name, pay_rate FROM employees WHERE company_id = ? AND status = ? ORDER BY name').bind(cid, 'active'),
    c.env.DB.prepare('SELECT id, name FROM projects WHERE company_id = ? AND status = ? ORDER BY name').bind(cid, 'active'),
    c.env.DB.prepare('SELECT id, name FROM clients WHERE company_id = ? AND status = ? ORDER BY name').bind(cid, 'active'),
  ]);
  const row = (entry.results as any[])?.[0];
  if (!row) return c.notFound();
  return c.html(timeFormPage(row,
    (emps.results as any) || [],
    (projects.results as any) || [],
    (clients.results as any) || [],
    new Date().toISOString().slice(0, 10),
  ));
});

// ─── Employees new/edit pages ─────────────────────────────
app.get('/app/employees/new', (c) => c.html(employeeFormPage(null)));
app.get('/app/employees/:id', async (c) => {
  const cid = c.get('companyId')!;
  const row = await c.env.DB.prepare('SELECT * FROM employees WHERE id = ? AND company_id = ?')
    .bind(c.req.param('id'), cid).first<any>();
  if (!row) return c.notFound();
  return c.html(employeeFormPage(row));
});
app.get('/app/mileage', async (c) => listingPage(c, 'Mileage', 'mileage', `
  SELECT id, trip_date, purpose, miles, deduction_amount, is_billable, billed_invoice_id
  FROM mileage_log WHERE company_id = ? ORDER BY trip_date DESC LIMIT 200`,
  ['Date', 'Purpose', 'Miles', 'Deduction', 'Billable'],
  (r: any) => [fmtDate(r.trip_date), `<a href="/app/mileage/${esc(r.id)}">${esc(r.purpose || '—')}</a>`, String(r.miles?.toFixed(1) ?? '0'),
    fmtMoney(r.deduction_amount), r.billed_invoice_id ? '✓ inv.' : r.is_billable ? '✓' : '—'],
  '/app/mileage/new',
));

// ─── Per-entity new/edit pages ──────────────────────────────
app.get('/app/clients/new', (c) => c.html(clientFormPage(null)));
app.get('/app/clients/:id', async (c) => {
  const cid = c.get('companyId')!;
  const row = await c.env.DB.prepare('SELECT * FROM clients WHERE id = ? AND company_id = ?')
    .bind(c.req.param('id'), cid).first<any>();
  if (!row) return c.notFound();
  return c.html(clientFormPage(row));
});

app.get('/app/vendors/new', (c) => c.html(vendorFormPage(null)));
app.get('/app/vendors/:id', async (c) => {
  const cid = c.get('companyId')!;
  const row = await c.env.DB.prepare('SELECT * FROM vendors WHERE id = ? AND company_id = ?')
    .bind(c.req.param('id'), cid).first<any>();
  if (!row) return c.notFound();
  return c.html(vendorFormPage(row));
});

app.get('/app/mileage/new', async (c) => {
  const cid = c.get('companyId')!;
  const [projects, clients] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT id, name FROM projects WHERE company_id = ? AND status = ?').bind(cid, 'active'),
    c.env.DB.prepare('SELECT id, name FROM clients WHERE company_id = ? AND status = ?').bind(cid, 'active'),
  ]);
  return c.html(mileageFormPage(null,
    (projects.results as any) || [],
    (clients.results as any) || [],
    0.70, // IRS 2026 business rate fallback — desktop sync replaces this when rates land
    new Date().toISOString().slice(0, 10),
  ));
});
app.get('/app/mileage/:id', async (c) => {
  const cid = c.get('companyId')!;
  const [trip, projects, clients] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT * FROM mileage_log WHERE id = ? AND company_id = ?').bind(c.req.param('id'), cid),
    c.env.DB.prepare('SELECT id, name FROM projects WHERE company_id = ? AND status = ?').bind(cid, 'active'),
    c.env.DB.prepare('SELECT id, name FROM clients WHERE company_id = ? AND status = ?').bind(cid, 'active'),
  ]);
  const row = (trip.results as any[])?.[0];
  if (!row) return c.notFound();
  return c.html(mileageFormPage(row,
    (projects.results as any) || [],
    (clients.results as any) || [],
    Number(row.rate_per_mile) || 0.70,
    new Date().toISOString().slice(0, 10),
  ));
});

app.get('/app/invoices/new', async (c) => {
  const cid = c.get('companyId')!;
  const clients = await c.env.DB.prepare('SELECT id, name FROM clients WHERE company_id = ? AND status = ? ORDER BY name').bind(cid, 'active').all();
  return c.html(invoiceFormPage(null, [], (clients.results as any) || [], new Date().toISOString().slice(0, 10)));
});
app.get('/app/invoices/:id', async (c) => {
  const cid = c.get('companyId')!;
  const [inv, lines, clients] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT * FROM invoices WHERE id = ? AND company_id = ?').bind(c.req.param('id'), cid),
    c.env.DB.prepare('SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY sort_order').bind(c.req.param('id')),
    c.env.DB.prepare('SELECT id, name FROM clients WHERE company_id = ? AND status = ? ORDER BY name').bind(cid, 'active'),
  ]);
  const row = (inv.results as any[])?.[0];
  if (!row) return c.notFound();
  return c.html(invoiceFormPage(row, (lines.results as any) || [], (clients.results as any) || [], new Date().toISOString().slice(0, 10)));
});

// ─── /api/* — JSON endpoints used by the SPA bits ───────────
app.use('/api/*', async (c, next) => {
  // Sync endpoints carry their own token; everything else needs a user session.
  if (c.req.path.startsWith('/api/sync/')) return next();
  return requireUserAPI(c, next);
});

// Save a new expense from the capture form.
app.post('/api/expenses', async (c) => {
  const cid = c.get('companyId')!;
  const b = await c.req.json<any>();
  const id = uuid();
  const amount = Number(b.amount || 0);
  const taxAmount = Number(b.tax_amount || 0);
  await c.env.DB.prepare(`
    INSERT INTO expenses (id, company_id, date, amount, tax_amount, description, category_id, vendor_id,
      payment_method, project_id, client_id, is_billable, reference, notes, status, currency)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'USD')
  `).bind(
    id, cid, b.date, amount, taxAmount,
    b.description || null, b.category_id || null, b.vendor_id || null,
    b.payment_method || null, b.project_id || null, b.client_id || null,
    b.is_billable ? 1 : 0, b.reference || null, b.notes || null,
  ).run();
  return c.json({ ok: true, id });
});

// Receipt upload → R2 + receipts table row.
app.post('/api/receipts/:expenseId', async (c) => {
  const cid = c.get('companyId')!;
  const expenseId = c.req.param('expenseId');
  const form = await c.req.formData();
  const file = form.get('file') as unknown as File | null;
  // File type comes from the global Web platform; we cast through unknown so
  // TS doesn't complain about FormDataEntryValue not matching DOM's File.
  if (!file || typeof (file as any).arrayBuffer !== 'function') {
    return c.json({ error: 'No file uploaded' }, 400);
  }
  // Guard size — Workers free tier blocks > 100MB anyway; we cap at 25MB for receipts.
  if (file.size > 25 * 1024 * 1024) return c.json({ error: 'Receipt too large (max 25MB)' }, 413);
  const r2Key = `receipts/${cid}/${expenseId}/${uuid()}-${file.name}`;
  await c.env.FILES.put(r2Key, file.stream(), { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
  const rid = uuid();
  await c.env.DB.prepare(`
    INSERT INTO receipts (id, company_id, expense_id, filename, r2_key, mime, size)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(rid, cid, expenseId, file.name, r2Key, file.type || null, file.size).run();
  return c.json({ ok: true, id: rid });
});

// ─── /api/sync — desktop ↔ cloud ────────────────────────────
// The desktop pushes rows whose updated_at > cursor; we upsert and bump the
// cursor. Pull is the reverse: respond with rows the cloud has that the
// desktop hasn't seen.
app.post('/api/sync/push', async (c) => {
  if (c.req.header('x-sync-token') !== c.env.DESKTOP_SYNC_TOKEN) {
    return c.json({ error: 'Bad sync token' }, 401);
  }
  const body = await c.req.json<{ company_id: string; table: string; rows: Array<Record<string, any>> }>();
  if (!body.company_id || !body.table || !Array.isArray(body.rows)) {
    return c.json({ error: 'Malformed payload' }, 400);
  }
  // Only allow upserts to tables in this allowlist — defense in depth, even
  // though the sync token already gates access. Avoids accidental writes to
  // users/sync_log via a buggy desktop release.
  const ALLOWED = new Set(['clients','vendors','projects','categories','expenses','expense_line_items',
    'invoices','invoice_line_items','payments','mileage_log','receipts']);
  if (!ALLOWED.has(body.table)) return c.json({ error: 'Table not syncable' }, 400);

  let applied = 0, lastTs = '';
  for (const row of body.rows) {
    // Defensive: stamp the company_id from the JWT-equivalent (sync token)
    // payload, not from the row, so a compromised desktop can't write into
    // another tenant's data.
    row.company_id = body.company_id;
    const cols = Object.keys(row);
    const placeholders = cols.map(() => '?').join(',');
    const updates = cols.filter(c => c !== 'id').map(c => `${c}=excluded.${c}`).join(',');
    const sql = `INSERT INTO ${body.table} (${cols.join(',')}) VALUES (${placeholders})
                 ON CONFLICT(id) DO UPDATE SET ${updates}`;
    await c.env.DB.prepare(sql).bind(...cols.map(k => row[k])).run();
    applied++;
    if (row.updated_at && row.updated_at > lastTs) lastTs = row.updated_at;
  }
  // Bump the cursor for this (company, table) pair so pull cycles can resume.
  if (lastTs) {
    await c.env.DB.prepare(`
      INSERT INTO sync_cursors (company_id, table_name, last_synced, rows_applied)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(company_id, table_name) DO UPDATE SET last_synced = ?, rows_applied = rows_applied + ?
    `).bind(body.company_id, body.table, lastTs, applied, lastTs, applied).run();
  }
  await c.env.DB.prepare('INSERT INTO sync_log (id, company_id, direction, table_name, rows) VALUES (?, ?, ?, ?, ?)')
    .bind(uuid(), body.company_id, 'push', body.table, applied).run();
  return c.json({ ok: true, applied });
});

app.post('/api/sync/pull', async (c) => {
  if (c.req.header('x-sync-token') !== c.env.DESKTOP_SYNC_TOKEN) {
    return c.json({ error: 'Bad sync token' }, 401);
  }
  const body = await c.req.json<{ company_id: string; table: string; since?: string; limit?: number }>();
  const ALLOWED = new Set(['expenses','expense_line_items','invoices','invoice_line_items','payments','mileage_log']);
  if (!ALLOWED.has(body.table)) return c.json({ error: 'Table not syncable' }, 400);
  const limit = Math.min(Math.max(body.limit ?? 200, 1), 1000);
  // Pulling rows newer than the desktop's cursor. Tables that don't carry
  // updated_at fall back to created_at.
  const tsCol = body.table.endsWith('_line_items') || body.table === 'payments' ? 'created_at' : 'updated_at';
  const since = body.since || '1970-01-01';
  const rows = await c.env.DB.prepare(
    `SELECT * FROM ${body.table} WHERE company_id = ? AND ${tsCol} > ? ORDER BY ${tsCol} ASC LIMIT ?`
  ).bind(body.company_id, since, limit).all();
  return c.json({ rows: rows.results || [] });
});

// ─── /portal — client-facing magic-link pages ────────────────
// The desktop mints a token via /api/portal/mint and emails the link. The
// client visits accounting.rmpgutah.us/portal?token=… → we validate, set a
// short-lived portal cookie, and render their invoice list.
app.get('/portal', async (c) => {
  const tokenStr = c.req.query('token') || readPortalCookie(c.req.header('cookie') ?? null);
  if (!tokenStr) return c.html(simpleErrorPage('Portal access requires a valid link.'));
  const ctx = await loadPortalContext(c.env, tokenStr);
  if (!ctx) return c.html(simpleErrorPage('Portal link expired or invalid. Please request a new one.'));

  // Set the portal cookie so back/forward navigation keeps working without
  // re-passing ?token=. 4-hour lifetime — same idea as a session.
  c.header('Set-Cookie', `bap_portal=${tokenStr}; Path=/portal; HttpOnly; SameSite=Lax; Max-Age=14400${c.env.ENVIRONMENT === 'production' ? '; Secure' : ''}`);

  const invoices = await c.env.DB.prepare(`
    SELECT id, invoice_number, date, due_date, status, total, amount_paid, currency
    FROM invoices WHERE company_id = ? AND client_id = ?
    ORDER BY date DESC
  `).bind(ctx.companyId, ctx.clientId).all();
  const portalInvoices: PortalInvoice[] = (invoices.results as any[] || []).map(i => ({
    id: i.id, invoice_number: i.invoice_number, date: i.date, due_date: i.due_date,
    status: i.status, total: Number(i.total || 0), amount_paid: Number(i.amount_paid || 0),
    outstanding: Math.max(0, Number(i.total || 0) - Number(i.amount_paid || 0)),
    currency: i.currency,
  }));
  return c.html(portalIndexPage(ctx.client, portalInvoices));
});

app.get('/portal/invoice/:id', async (c) => {
  const tokenStr = c.req.query('token') || readPortalCookie(c.req.header('cookie') ?? null);
  if (!tokenStr) return c.html(simpleErrorPage('Portal access requires a valid link.'));
  const ctx = await loadPortalContext(c.env, tokenStr);
  if (!ctx) return c.html(simpleErrorPage('Portal link expired.'));
  const inv = await c.env.DB.prepare(
    `SELECT id, invoice_number, date, due_date, status, total, amount_paid, currency
     FROM invoices WHERE id = ? AND client_id = ?`
  ).bind(c.req.param('id'), ctx.clientId).first<any>();
  if (!inv) return c.html(simpleErrorPage('Invoice not found.'));
  const lines = await c.env.DB.prepare(
    `SELECT description, quantity, unit_price, amount FROM invoice_line_items WHERE invoice_id = ? ORDER BY sort_order`
  ).bind(inv.id).all();
  const portalInv: PortalInvoice = {
    id: inv.id, invoice_number: inv.invoice_number, date: inv.date, due_date: inv.due_date,
    status: inv.status, total: Number(inv.total || 0), amount_paid: Number(inv.amount_paid || 0),
    outstanding: Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0)),
    currency: inv.currency,
  };
  return c.html(portalInvoicePage(ctx.client, portalInv, (lines.results as any[]) || []));
});

// Stripe Checkout for portal invoice. Idempotent — re-clicking creates a new
// Session each time but on the same invoice; the webhook reconciles by
// metadata.invoice_id.
app.post('/portal/invoice/:id/checkout', async (c) => {
  const tokenStr = c.req.query('token') || readPortalCookie(c.req.header('cookie') ?? null);
  if (!tokenStr) return c.json({ error: 'Portal token required' }, 401);
  const ctx = await loadPortalContext(c.env, tokenStr);
  if (!ctx) return c.json({ error: 'Portal token expired' }, 401);
  if (!c.env.STRIPE_SECRET_KEY) {
    return c.json({ message: 'Online payment is not configured for this company yet. Please pay via the method on the invoice.' }, 200);
  }
  const inv = await c.env.DB.prepare(
    `SELECT id, invoice_number, total, amount_paid, currency FROM invoices WHERE id = ? AND client_id = ?`
  ).bind(c.req.param('id'), ctx.clientId).first<any>();
  if (!inv) return c.json({ error: 'Invoice not found' }, 404);
  const due = Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0));
  if (due <= 0) return c.json({ error: 'Invoice already paid' }, 400);

  // Stripe Checkout Sessions API — using fetch directly so we avoid pulling
  // the SDK into the Worker bundle (saves ~250kb cold-start weight).
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', `https://accounting.rmpgutah.us/portal?paid=1`);
  params.set('cancel_url', `https://accounting.rmpgutah.us/portal/invoice/${inv.id}`);
  params.set('line_items[0][price_data][currency]', (inv.currency || 'usd').toLowerCase());
  params.set('line_items[0][price_data][product_data][name]', `Invoice ${inv.invoice_number || inv.id.slice(0, 8)}`);
  params.set('line_items[0][price_data][unit_amount]', String(Math.round(due * 100)));
  params.set('line_items[0][quantity]', '1');
  params.set('metadata[invoice_id]', inv.id);
  params.set('metadata[company_id]', ctx.companyId);
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${c.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const data = await r.json() as any;
  if (!r.ok) return c.json({ error: data.error?.message || 'Stripe error' }, 502);
  return c.json({ url: data.url });
});

// Mint a portal token from the desktop. Called via the desktop's existing
// sync auth header.
app.post('/api/portal/mint', async (c) => {
  if (c.req.header('x-sync-token') !== c.env.DESKTOP_SYNC_TOKEN) {
    return c.json({ error: 'Bad sync token' }, 401);
  }
  const body = await c.req.json<{ company_id: string; client_id: string; ttl_hours?: number }>();
  if (!body.company_id || !body.client_id) return c.json({ error: 'company_id and client_id required' }, 400);
  const ttl = Math.min(Math.max(body.ttl_hours || 168, 1), 24 * 30);  // 1h–30d
  const token = uuid().replace(/-/g, '') + uuid().replace(/-/g, '');  // 64 hex chars
  const expires = new Date(Date.now() + ttl * 3600 * 1000).toISOString();
  await c.env.DB.prepare(
    `INSERT INTO portal_tokens (token, company_id, client_id, expires_at) VALUES (?, ?, ?, ?)`
  ).bind(token, body.company_id, body.client_id, expires).run();
  return c.json({ url: `https://accounting.rmpgutah.us/portal?token=${token}`, expires_at: expires });
});

// ─── Helpers ────────────────────────────────────────────────
function readPortalCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const c of cookieHeader.split(';')) {
    const [k, ...rest] = c.trim().split('=');
    if (k === 'bap_portal') return rest.join('=');
  }
  return null;
}

async function loadPortalContext(env: Env, token: string): Promise<{ clientId: string; companyId: string; client: PortalClient } | null> {
  const row = await env.DB.prepare(
    `SELECT t.client_id, t.company_id, t.expires_at, c.name AS client_name, c.email AS client_email, co.name AS company_name
     FROM portal_tokens t
     LEFT JOIN clients c ON c.id = t.client_id
     LEFT JOIN companies co ON co.id = t.company_id
     WHERE t.token = ?`
  ).bind(token).first<any>();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return {
    clientId: row.client_id,
    companyId: row.company_id,
    client: {
      id: row.client_id,
      name: row.client_name || 'Client',
      email: row.client_email,
      company_name: row.company_name || 'Business Accounting Pro',
    },
  };
}

function simpleErrorPage(msg: string): string {
  // Minimal styled error — same tokens as the shell so it doesn't look orphaned.
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title>
<style>body{font-family:-apple-system,sans-serif;background:#050508;color:#e4e4ef;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:20px}.box{max-width:420px;background:#0e0e14;border:1px solid #1e1e2e;border-radius:2px;padding:32px}.box h1{font-size:1.3rem;color:#fff;margin:0 0 12px;font-weight:800}.box p{color:#8888a0;font-size:0.95rem;margin:0}</style></head>
<body><div class="box"><h1>Access denied</h1><p>${esc(msg)}</p></div></body></html>`;
}

// Inline helpers used by listingPage above. Lightweight rather than importing
// from /ui/shell so the listing-page path stays self-contained.
function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmtMoney(n: unknown): string {
  const num = Number(n ?? 0);
  if (!Number.isFinite(num)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num);
}
function fmtDate(s: unknown): string {
  if (!s) return '—';
  const d = new Date(String(s));
  if (isNaN(d.getTime())) return String(s);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

async function listingPage(
  c: any, title: string, navKey: string, sql: string, headers: string[],
  rowMap: (row: any) => string[], newHref?: string,
): Promise<Response> {
  const cid = c.get('companyId');
  const rows = (await c.env.DB.prepare(sql).bind(cid).all()).results || [];
  const { shell } = await import('./ui/shell');
  const tbl = rows.length === 0
    ? `<div class="empty-state">Nothing here yet.</div>`
    : `<table class="data"><thead><tr>${headers.map((h, i) => `<th${i === headers.length - 1 ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>
        ${rows.map((r: any) => `<tr>${rowMap(r).map((cell, i) => `<td${i === headers.length - 1 ? ' class="num"' : ''}>${cell}</td>`).join('')}</tr>`).join('')}
      </tbody></table>`;
  const body = `
    <div class="page-header">
      <div><h1 class="page-title">${esc(title)}</h1></div>
      ${newHref ? `<a class="btn" href="${esc(newHref)}">+ New</a>` : ''}
    </div>
    ${tbl}`;
  return c.html(shell({ title, activeNav: navKey, body, brand: 'BAP Cloud' }));
}

// ─── JSON CRUD: clients / vendors / mileage / invoices ──────
// Each entity follows the same shape: POST creates with a fresh uuid,
// PUT updates by id (company-scoped), DELETE removes hard. Tenancy comes
// from the JWT-resolved companyId — clients can never address another
// tenant's rows even with the id.

const CLIENT_FIELDS = ['name', 'email', 'phone', 'address', 'tax_id', 'notes', 'status'];
app.post('/api/clients', async (c) => {
  const cid = c.get('companyId')!;
  const b = await c.req.json<any>();
  if (!b.name) return c.json({ error: 'Name is required' }, 400);
  const id = uuid();
  await c.env.DB.prepare(
    `INSERT INTO clients (id, company_id, ${CLIENT_FIELDS.join(',')}) VALUES (?, ?, ${CLIENT_FIELDS.map(() => '?').join(',')})`
  ).bind(id, cid, ...CLIENT_FIELDS.map(f => b[f] ?? null)).run();
  return c.json({ ok: true, id });
});
app.put('/api/clients/:id', async (c) => {
  const cid = c.get('companyId')!;
  const b = await c.req.json<any>();
  const sets = CLIENT_FIELDS.map(f => `${f} = ?`).join(', ');
  const r = await c.env.DB.prepare(
    `UPDATE clients SET ${sets}, updated_at = datetime('now') WHERE id = ? AND company_id = ?`
  ).bind(...CLIENT_FIELDS.map(f => b[f] ?? null), c.req.param('id'), cid).run();
  if ((r as any).meta?.changes === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});
app.delete('/api/clients/:id', async (c) => {
  const cid = c.get('companyId')!;
  // Soft-disconnect from invoices rather than cascade-delete, so historical
  // billings aren't lost when a client is removed.
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE invoices SET client_id = NULL WHERE client_id = ? AND company_id = ?').bind(c.req.param('id'), cid),
    c.env.DB.prepare('DELETE FROM clients WHERE id = ? AND company_id = ?').bind(c.req.param('id'), cid),
  ]);
  return c.json({ ok: true });
});

const VENDOR_FIELDS = ['name', 'email', 'phone', 'address', 'website', 'tax_id', 'status'];
app.post('/api/vendors', async (c) => {
  const cid = c.get('companyId')!;
  const b = await c.req.json<any>();
  if (!b.name) return c.json({ error: 'Name is required' }, 400);
  const id = uuid();
  await c.env.DB.prepare(
    `INSERT INTO vendors (id, company_id, ${VENDOR_FIELDS.join(',')}) VALUES (?, ?, ${VENDOR_FIELDS.map(() => '?').join(',')})`
  ).bind(id, cid, ...VENDOR_FIELDS.map(f => b[f] ?? null)).run();
  return c.json({ ok: true, id });
});
app.put('/api/vendors/:id', async (c) => {
  const cid = c.get('companyId')!;
  const b = await c.req.json<any>();
  const sets = VENDOR_FIELDS.map(f => `${f} = ?`).join(', ');
  const r = await c.env.DB.prepare(
    `UPDATE vendors SET ${sets}, updated_at = datetime('now') WHERE id = ? AND company_id = ?`
  ).bind(...VENDOR_FIELDS.map(f => b[f] ?? null), c.req.param('id'), cid).run();
  if ((r as any).meta?.changes === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});
app.delete('/api/vendors/:id', async (c) => {
  const cid = c.get('companyId')!;
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE expenses SET vendor_id = NULL WHERE vendor_id = ? AND company_id = ?').bind(c.req.param('id'), cid),
    c.env.DB.prepare('DELETE FROM vendors WHERE id = ? AND company_id = ?').bind(c.req.param('id'), cid),
  ]);
  return c.json({ ok: true });
});

// Mileage trips. Auto-fills rate_per_mile if missing using the trip year's
// rate; deduction_amount is always recomputed server-side so a malicious
// client can't inflate a deduction.
const MILEAGE_FIELDS = ['trip_date', 'purpose', 'start_location', 'end_location',
  'miles', 'rate_per_mile', 'vehicle', 'project_id', 'client_id', 'is_billable', 'notes'];

async function resolveMileageRate(env: Env, year: string, supplied?: number | null): Promise<number> {
  if (supplied && supplied > 0) return supplied;
  // mileage_rates table is optional in the cloud mirror; fall back to the
  // current IRS standard if no per-year row exists.
  try {
    const row = await env.DB.prepare('SELECT business_rate FROM mileage_rates WHERE year = ?').bind(year).first<any>();
    if (row?.business_rate) return Number(row.business_rate);
  } catch { /* table may not exist in this deployment */ }
  return 0.70;
}

app.post('/api/mileage', async (c) => {
  const cid = c.get('companyId')!;
  const b = await c.req.json<any>();
  if (!b.trip_date || !b.miles || Number(b.miles) <= 0) return c.json({ error: 'Date and miles required' }, 400);
  const rate = await resolveMileageRate(c.env, String(b.trip_date).slice(0, 4), b.rate_per_mile);
  const deduction = Math.round(Number(b.miles) * rate * 100) / 100;
  const data = { ...b, rate_per_mile: rate, deduction_amount: deduction, is_billable: b.is_billable ? 1 : 0 };
  const id = uuid();
  const cols = ['id', 'company_id', ...MILEAGE_FIELDS, 'deduction_amount'];
  const vals = [id, cid, ...MILEAGE_FIELDS.map(f => data[f] ?? null), deduction];
  await c.env.DB.prepare(
    `INSERT INTO mileage_log (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
  ).bind(...vals).run();
  return c.json({ ok: true, id, deduction_amount: deduction });
});
app.put('/api/mileage/:id', async (c) => {
  const cid = c.get('companyId')!;
  const b = await c.req.json<any>();
  const rate = await resolveMileageRate(c.env, String(b.trip_date || '').slice(0, 4), b.rate_per_mile);
  const deduction = Math.round(Number(b.miles || 0) * rate * 100) / 100;
  const data = { ...b, rate_per_mile: rate, deduction_amount: deduction, is_billable: b.is_billable ? 1 : 0 };
  const sets = [...MILEAGE_FIELDS, 'deduction_amount'].map(f => `${f} = ?`).join(', ');
  const r = await c.env.DB.prepare(
    `UPDATE mileage_log SET ${sets}, updated_at = datetime('now') WHERE id = ? AND company_id = ?`
  ).bind(...MILEAGE_FIELDS.map(f => data[f] ?? null), deduction, c.req.param('id'), cid).run();
  if ((r as any).meta?.changes === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true, deduction_amount: deduction });
});
app.delete('/api/mileage/:id', async (c) => {
  const cid = c.get('companyId')!;
  await c.env.DB.prepare('DELETE FROM mileage_log WHERE id = ? AND company_id = ?')
    .bind(c.req.param('id'), cid).run();
  return c.json({ ok: true });
});

// Invoices with line items. Totals are recomputed from the supplied lines so
// a tampered DOM can't ship an under-priced total. The header columns we
// store match the read paths (dashboard, listings, portal).
app.post('/api/invoices', async (c) => {
  const cid = c.get('companyId')!;
  const b = await c.req.json<any>();
  if (!b.client_id) return c.json({ error: 'Client is required' }, 400);
  const lines: any[] = Array.isArray(b.lines) ? b.lines : [];
  if (lines.length === 0) return c.json({ error: 'At least one line item is required' }, 400);
  const { subtotal, tax, total } = computeInvoiceTotals(lines, Number(b.shipping_amount || 0), Number(b.discount || 0));
  const id = uuid();
  const inserts: D1PreparedStatement[] = [
    c.env.DB.prepare(`
      INSERT INTO invoices (id, company_id, client_id, invoice_number, date, due_date, status,
        subtotal, tax_amount, shipping_amount, discount, total, amount_paid, currency, notes, terms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).bind(
      id, cid, b.client_id, b.invoice_number || null, b.date,
      b.due_date || null, b.status || 'draft',
      subtotal, tax, Number(b.shipping_amount || 0), Number(b.discount || 0), total,
      b.currency || 'USD', b.notes || null, b.terms || null,
    ),
  ];
  lines.forEach((l, i) => {
    const amt = Number(l.quantity || 0) * Number(l.unit_price || 0);
    const taxA = amt * (Number(l.tax_rate || 0) / 100);
    inserts.push(c.env.DB.prepare(`
      INSERT INTO invoice_line_items (id, invoice_id, description, quantity, unit_price, amount, tax_rate, tax_amount, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(uuid(), id, l.description || null, Number(l.quantity || 0),
      Number(l.unit_price || 0), amt, Number(l.tax_rate || 0), taxA, i));
  });
  await c.env.DB.batch(inserts);
  return c.json({ ok: true, id, total });
});
app.put('/api/invoices/:id', async (c) => {
  const cid = c.get('companyId')!;
  const id = c.req.param('id');
  const b = await c.req.json<any>();
  if (!b.client_id) return c.json({ error: 'Client is required' }, 400);
  const lines: any[] = Array.isArray(b.lines) ? b.lines : [];
  if (lines.length === 0) return c.json({ error: 'At least one line item is required' }, 400);
  const { subtotal, tax, total } = computeInvoiceTotals(lines, Number(b.shipping_amount || 0), Number(b.discount || 0));

  // Replace line items atomically. We can't run multi-statement transactions
  // across batch boundaries on D1, but a batch IS a single transaction, so
  // grouping delete + inserts is the right shape.
  const stmts: D1PreparedStatement[] = [
    c.env.DB.prepare(`
      UPDATE invoices SET client_id = ?, invoice_number = ?, date = ?, due_date = ?, status = ?,
        subtotal = ?, tax_amount = ?, shipping_amount = ?, discount = ?, total = ?,
        currency = ?, notes = ?, terms = ?, updated_at = datetime('now')
      WHERE id = ? AND company_id = ?
    `).bind(
      b.client_id, b.invoice_number || null, b.date, b.due_date || null, b.status || 'draft',
      subtotal, tax, Number(b.shipping_amount || 0), Number(b.discount || 0), total,
      b.currency || 'USD', b.notes || null, b.terms || null, id, cid,
    ),
    c.env.DB.prepare('DELETE FROM invoice_line_items WHERE invoice_id = ?').bind(id),
  ];
  lines.forEach((l, i) => {
    const amt = Number(l.quantity || 0) * Number(l.unit_price || 0);
    const taxA = amt * (Number(l.tax_rate || 0) / 100);
    stmts.push(c.env.DB.prepare(`
      INSERT INTO invoice_line_items (id, invoice_id, description, quantity, unit_price, amount, tax_rate, tax_amount, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(uuid(), id, l.description || null, Number(l.quantity || 0),
      Number(l.unit_price || 0), amt, Number(l.tax_rate || 0), taxA, i));
  });
  await c.env.DB.batch(stmts);
  return c.json({ ok: true, total });
});
app.delete('/api/invoices/:id', async (c) => {
  const cid = c.get('companyId')!;
  const id = c.req.param('id');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM invoice_line_items WHERE invoice_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM invoices WHERE id = ? AND company_id = ?').bind(id, cid),
  ]);
  return c.json({ ok: true });
});

// ─── Employees CRUD ─────────────────────────────────────────
const EMP_FIELDS = ['name', 'email', 'phone', 'role', 'pay_rate', 'pay_type', 'hire_date', 'status', 'notes'];
app.post('/api/employees', async (c) => {
  const cid = c.get('companyId')!;
  const b = await c.req.json<any>();
  if (!b.name) return c.json({ error: 'Name is required' }, 400);
  const id = uuid();
  await c.env.DB.prepare(
    `INSERT INTO employees (id, company_id, ${EMP_FIELDS.join(',')}) VALUES (?, ?, ${EMP_FIELDS.map(() => '?').join(',')})`
  ).bind(id, cid, ...EMP_FIELDS.map(f => b[f] ?? null)).run();
  return c.json({ ok: true, id });
});
app.put('/api/employees/:id', async (c) => {
  const cid = c.get('companyId')!;
  const b = await c.req.json<any>();
  const sets = EMP_FIELDS.map(f => `${f} = ?`).join(', ');
  const r = await c.env.DB.prepare(
    `UPDATE employees SET ${sets}, updated_at = datetime('now') WHERE id = ? AND company_id = ?`
  ).bind(...EMP_FIELDS.map(f => b[f] ?? null), c.req.param('id'), cid).run();
  if ((r as any).meta?.changes === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});
app.delete('/api/employees/:id', async (c) => {
  const cid = c.get('companyId')!;
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE time_entries SET employee_id = NULL WHERE employee_id = ? AND company_id = ?').bind(c.req.param('id'), cid),
    c.env.DB.prepare('DELETE FROM employees WHERE id = ? AND company_id = ?').bind(c.req.param('id'), cid),
  ]);
  return c.json({ ok: true });
});

// ─── Projects CRUD ──────────────────────────────────────────
const PROJECT_FIELDS = ['client_id', 'name', 'description', 'status', 'budget', 'budget_type', 'start_date', 'end_date', 'hourly_rate'];
app.post('/api/projects', async (c) => {
  const cid = c.get('companyId')!;
  const b = await c.req.json<any>();
  if (!b.name) return c.json({ error: 'Name is required' }, 400);
  const id = uuid();
  await c.env.DB.prepare(
    `INSERT INTO projects (id, company_id, ${PROJECT_FIELDS.join(',')}) VALUES (?, ?, ${PROJECT_FIELDS.map(() => '?').join(',')})`
  ).bind(id, cid, ...PROJECT_FIELDS.map(f => b[f] ?? null)).run();
  return c.json({ ok: true, id });
});
app.put('/api/projects/:id', async (c) => {
  const cid = c.get('companyId')!;
  const b = await c.req.json<any>();
  const sets = PROJECT_FIELDS.map(f => `${f} = ?`).join(', ');
  const r = await c.env.DB.prepare(
    `UPDATE projects SET ${sets}, updated_at = datetime('now') WHERE id = ? AND company_id = ?`
  ).bind(...PROJECT_FIELDS.map(f => b[f] ?? null), c.req.param('id'), cid).run();
  if ((r as any).meta?.changes === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});
app.delete('/api/projects/:id', async (c) => {
  const cid = c.get('companyId')!;
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE expenses SET project_id = NULL WHERE project_id = ? AND company_id = ?').bind(c.req.param('id'), cid),
    c.env.DB.prepare('UPDATE time_entries SET project_id = NULL WHERE project_id = ? AND company_id = ?').bind(c.req.param('id'), cid),
    c.env.DB.prepare('DELETE FROM projects WHERE id = ? AND company_id = ?').bind(c.req.param('id'), cid),
  ]);
  return c.json({ ok: true });
});

// ─── Time entries CRUD ──────────────────────────────────────
const TIME_FIELDS = ['employee_id', 'project_id', 'client_id', 'date', 'duration_minutes',
  'description', 'is_billable', 'hourly_rate'];
app.post('/api/time', async (c) => {
  const cid = c.get('companyId')!;
  const b = await c.req.json<any>();
  if (!b.employee_id || !b.date || !(b.duration_minutes > 0)) {
    return c.json({ error: 'Employee, date, and a non-zero duration are required' }, 400);
  }
  const id = uuid();
  await c.env.DB.prepare(
    `INSERT INTO time_entries (id, company_id, ${TIME_FIELDS.join(',')}) VALUES (?, ?, ${TIME_FIELDS.map(() => '?').join(',')})`
  ).bind(id, cid, ...TIME_FIELDS.map(f => b[f] ?? null)).run();
  return c.json({ ok: true, id });
});
app.put('/api/time/:id', async (c) => {
  const cid = c.get('companyId')!;
  const b = await c.req.json<any>();
  const sets = TIME_FIELDS.map(f => `${f} = ?`).join(', ');
  const r = await c.env.DB.prepare(
    `UPDATE time_entries SET ${sets}, updated_at = datetime('now') WHERE id = ? AND company_id = ?`
  ).bind(...TIME_FIELDS.map(f => b[f] ?? null), c.req.param('id'), cid).run();
  if ((r as any).meta?.changes === 0) return c.json({ error: 'Not found' }, 404);
  return c.json({ ok: true });
});
app.delete('/api/time/:id', async (c) => {
  const cid = c.get('companyId')!;
  await c.env.DB.prepare('DELETE FROM time_entries WHERE id = ? AND company_id = ?')
    .bind(c.req.param('id'), cid).run();
  return c.json({ ok: true });
});

// ─── Bills CRUD ─────────────────────────────────────────────
app.post('/api/bills', async (c) => {
  const cid = c.get('companyId')!;
  return saveDoc(c, cid, 'bills', 'bill_line_items', null);
});
app.put('/api/bills/:id', async (c) => {
  const cid = c.get('companyId')!;
  return saveDoc(c, cid, 'bills', 'bill_line_items', c.req.param('id'));
});
app.delete('/api/bills/:id', async (c) => {
  const cid = c.get('companyId')!;
  const id = c.req.param('id');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM bill_line_items WHERE bill_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM bills WHERE id = ? AND company_id = ?').bind(id, cid),
  ]);
  return c.json({ ok: true });
});

// ─── Quotes CRUD ────────────────────────────────────────────
app.post('/api/quotes', async (c) => {
  const cid = c.get('companyId')!;
  return saveDoc(c, cid, 'quotes', 'quote_line_items', null);
});
app.put('/api/quotes/:id', async (c) => {
  const cid = c.get('companyId')!;
  return saveDoc(c, cid, 'quotes', 'quote_line_items', c.req.param('id'));
});
app.delete('/api/quotes/:id', async (c) => {
  const cid = c.get('companyId')!;
  const id = c.req.param('id');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM quote_line_items WHERE quote_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM quotes WHERE id = ? AND company_id = ?').bind(id, cid),
  ]);
  return c.json({ ok: true });
});

// Shared bills/quotes create-or-update. The two entities differ only in
// table name, line-item table name, party FK column (vendor_id / client_id),
// secondary date column (due_date / expires_date), and number column
// (bill_number / quote_number) — everything else is identical.
async function saveDoc(c: any, cid: string, table: 'bills' | 'quotes', linesTable: string, idOrNull: string | null): Promise<Response> {
  const b: any = await c.req.json();
  const partyField = table === 'bills' ? 'vendor_id' : 'client_id';
  const numberField = table === 'bills' ? 'bill_number' : 'quote_number';
  const secondaryDateField = table === 'bills' ? 'due_date' : 'expires_date';
  if (!b[partyField]) return c.json({ error: (table === 'bills' ? 'Vendor' : 'Client') + ' is required' }, 400);
  const lines: any[] = Array.isArray(b.lines) ? b.lines : [];
  if (lines.length === 0) return c.json({ error: 'At least one line item is required' }, 400);
  const { subtotal, tax, total } = computeInvoiceTotals(lines, Number(b.shipping_amount || 0), Number(b.discount || 0));

  const id = idOrNull || uuid();
  const stmts: D1PreparedStatement[] = [];
  if (idOrNull) {
    stmts.push(c.env.DB.prepare(`
      UPDATE ${table} SET ${partyField} = ?, ${numberField} = ?, date = ?, ${secondaryDateField} = ?, status = ?,
        subtotal = ?, tax_amount = ?, shipping_amount = ?, discount = ?, total = ?,
        currency = ?, notes = ?, terms = ?, updated_at = datetime('now')
      WHERE id = ? AND company_id = ?
    `).bind(
      b[partyField], b[numberField] || null, b.date, b[secondaryDateField] || null, b.status || (table === 'bills' ? 'open' : 'draft'),
      subtotal, tax, Number(b.shipping_amount || 0), Number(b.discount || 0), total,
      b.currency || 'USD', b.notes || null, b.terms || null, id, cid,
    ));
    stmts.push(c.env.DB.prepare(`DELETE FROM ${linesTable} WHERE ${table === 'bills' ? 'bill_id' : 'quote_id'} = ?`).bind(id));
  } else {
    stmts.push(c.env.DB.prepare(`
      INSERT INTO ${table} (id, company_id, ${partyField}, ${numberField}, date, ${secondaryDateField}, status,
        subtotal, tax_amount, shipping_amount, discount, total, amount_paid, currency, notes, terms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).bind(
      id, cid, b[partyField], b[numberField] || null, b.date, b[secondaryDateField] || null, b.status || (table === 'bills' ? 'open' : 'draft'),
      subtotal, tax, Number(b.shipping_amount || 0), Number(b.discount || 0), total,
      b.currency || 'USD', b.notes || null, b.terms || null,
    ));
  }
  lines.forEach((l, i) => {
    const amt = Number(l.quantity || 0) * Number(l.unit_price || 0);
    const taxA = amt * (Number(l.tax_rate || 0) / 100);
    stmts.push(c.env.DB.prepare(`
      INSERT INTO ${linesTable} (id, ${table === 'bills' ? 'bill_id' : 'quote_id'}, description, quantity, unit_price, amount, tax_rate, tax_amount, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(uuid(), id, l.description || null, Number(l.quantity || 0),
      Number(l.unit_price || 0), amt, Number(l.tax_rate || 0), taxA, i));
  });
  await c.env.DB.batch(stmts);
  return c.json({ ok: true, id, total });
}

function computeInvoiceTotals(lines: Array<any>, shipping: number, discount: number) {
  let subtotal = 0, tax = 0;
  for (const l of lines) {
    const amt = Number(l.quantity || 0) * Number(l.unit_price || 0);
    subtotal += amt;
    tax += amt * (Number(l.tax_rate || 0) / 100);
  }
  // Round at the boundary so 0.1 + 0.2 doesn't end up stored as 0.30000000000000004.
  subtotal = Math.round(subtotal * 100) / 100;
  tax      = Math.round(tax * 100) / 100;
  const total = Math.max(0, Math.round((subtotal + tax + shipping - discount) * 100) / 100);
  return { subtotal, tax, total };
}

// ─── Stripe webhook ─────────────────────────────────────────
// Listens for `checkout.session.completed` from the portal's Pay button and
// records a payment + bumps the invoice's amount_paid. Sig verification is
// HMAC-SHA256 (Workers Web Crypto, no Node deps).
app.post('/api/stripe/webhook', async (c) => {
  const sig = c.req.header('stripe-signature');
  const secret = c.env.STRIPE_WEBHOOK_SECRET;
  const raw = await c.req.text();  // signature is over the EXACT body bytes
  if (!sig || !secret) return c.json({ error: 'Webhook not configured' }, 400);

  // Stripe signature header format:
  //   t=<unix>,v1=<hex>,v1=<hex>
  // We compute HMAC over `${t}.${rawBody}` with the endpoint secret.
  const parts = Object.fromEntries(sig.split(',').map(p => {
    const [k, ...rest] = p.split('=');
    return [k, rest.join('=')];
  }));
  if (!parts.t || !parts.v1) return c.json({ error: 'Bad signature header' }, 400);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const computed = await crypto.subtle.sign('HMAC', key, enc.encode(`${parts.t}.${raw}`));
  const computedHex = Array.from(new Uint8Array(computed)).map(b => b.toString(16).padStart(2, '0')).join('');
  if (!constantTimeStrEqual(computedHex, parts.v1)) return c.json({ error: 'Signature mismatch' }, 400);
  // Replay window — Stripe-recommended 5 minutes.
  const age = Math.floor(Date.now() / 1000) - Number(parts.t);
  if (age > 300 || age < -10) return c.json({ error: 'Timestamp out of tolerance' }, 400);

  let event: any;
  try { event = JSON.parse(raw); } catch { return c.json({ error: 'Bad JSON' }, 400); }

  if (event.type === 'checkout.session.completed') {
    const session = event.data?.object || {};
    const invoiceId = session.metadata?.invoice_id;
    const companyId = session.metadata?.company_id;
    const amountCents = Number(session.amount_total || 0);
    const amount = amountCents / 100;
    if (invoiceId && companyId && amount > 0) {
      // Idempotency: a Stripe session can fire its webhook twice if the
      // first delivery times out. payments.stripe_pi_id is unique-ish per
      // session — guard with a SELECT before inserting.
      const dup = await c.env.DB.prepare('SELECT id FROM payments WHERE stripe_pi_id = ?')
        .bind(session.payment_intent || session.id).first();
      if (!dup) {
        await c.env.DB.batch([
          c.env.DB.prepare(`
            INSERT INTO payments (id, company_id, invoice_id, date, amount, payment_method, stripe_pi_id, notes)
            VALUES (?, ?, ?, ?, ?, 'stripe', ?, ?)
          `).bind(uuid(), companyId, invoiceId, new Date().toISOString().slice(0, 10), amount,
            session.payment_intent || session.id, `Stripe Checkout ${session.id}`),
          c.env.DB.prepare(`
            UPDATE invoices SET amount_paid = amount_paid + ?,
              status = CASE WHEN amount_paid + ? >= total THEN 'paid' ELSE 'partial' END,
              updated_at = datetime('now')
            WHERE id = ? AND company_id = ?
          `).bind(amount, amount, invoiceId, companyId),
        ]);
      }
    }
  }
  return c.json({ received: true });
});

function constantTimeStrEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ─── Purchase Orders (re-uses documentFormPage like bills/quotes) ───
const PO_DOC_CFG = {
  kind: 'bill' as const,  // Reuses bill-shape (vendor-side); we override the path bits below
  apiPath: '/api/purchase-orders',
  pluralLabel: 'Purchase Orders',
  navKey: 'purchase-orders',
  partyLabel: 'Vendor' as const,
  partyField: 'vendor_id' as const,
  parties: [] as Array<{ id: string; name: string }>,
  statusOptions: ['draft', 'sent', 'received', 'cancelled', 'closed'],
  numberLabel: 'PO #',
  secondaryDateLabel: 'Expected Date',
  secondaryDateField: 'due_date' as const,  // mapped to expected_date in saveDoc
};
app.get('/app/purchase-orders', async (c) => listingPage(c, 'Purchase Orders', 'purchase-orders', `
  SELECT po.id, po.po_number, po.date, po.expected_date, po.status, po.total,
         v.name as vendor_name
  FROM purchase_orders po LEFT JOIN vendors v ON v.id = po.vendor_id
  WHERE po.company_id = ? ORDER BY po.date DESC`,
  ['#', 'Vendor', 'Date', 'Expected', 'Status', 'Total'],
  (r: any) => [
    `<a href="/app/purchase-orders/${esc(r.id)}">${esc(r.po_number || r.id.slice(0, 8))}</a>`,
    esc(r.vendor_name || '—'),
    fmtDate(r.date), fmtDate(r.expected_date),
    `<span class="badge ${r.status === 'closed' || r.status === 'received' ? 'badge-green' : r.status === 'cancelled' ? 'badge-red' : 'badge-blue'}">${esc(r.status)}</span>`,
    fmtMoney(r.total),
  ],
  '/app/purchase-orders/new',
));

// ─── Inventory listing ──────────────────────────────────────
app.get('/app/inventory', async (c) => listingPage(c, 'Inventory', 'inventory', `
  SELECT id, sku, name, quantity_on_hand, unit_cost, unit_price, reorder_point, status
  FROM inventory_items WHERE company_id = ? ORDER BY name`,
  ['SKU', 'Name', 'On Hand', 'Cost', 'Price', 'Status'],
  (r: any) => [
    esc(r.sku || '—'),
    `<a href="/app/inventory/${esc(r.id)}">${esc(r.name)}</a>`,
    String(r.quantity_on_hand ?? 0) + (r.reorder_point > 0 && r.quantity_on_hand <= r.reorder_point ? ' <span class="badge badge-amber">low</span>' : ''),
    fmtMoney(r.unit_cost), fmtMoney(r.unit_price),
    `<span class="badge">${esc(r.status)}</span>`,
  ],
  '/app/inventory/new',
));

// ─── Fixed Assets listing ───────────────────────────────────
app.get('/app/fixed-assets', async (c) => listingPage(c, 'Fixed Assets', 'fixed-assets', `
  SELECT id, name, category, purchase_date, purchase_cost, current_value, status
  FROM fixed_assets WHERE company_id = ? ORDER BY purchase_date DESC`,
  ['Name', 'Category', 'Purchased', 'Cost', 'Current', 'Status'],
  (r: any) => [
    `<a href="/app/fixed-assets/${esc(r.id)}">${esc(r.name)}</a>`,
    esc(r.category || '—'),
    fmtDate(r.purchase_date),
    fmtMoney(r.purchase_cost), fmtMoney(r.current_value),
    `<span class="badge">${esc(r.status)}</span>`,
  ],
  '/app/fixed-assets/new',
));

// ─── Loans listing ──────────────────────────────────────────
app.get('/app/loans', async (c) => listingPage(c, 'Loans', 'loans', `
  SELECT id, name, lender_name, principal, current_balance, interest_rate, status
  FROM loans WHERE company_id = ? ORDER BY name`,
  ['Name', 'Lender', 'Principal', 'Balance', 'Rate', 'Status'],
  (r: any) => [
    `<a href="/app/loans/${esc(r.id)}">${esc(r.name)}</a>`,
    esc(r.lender_name || '—'),
    fmtMoney(r.principal), fmtMoney(r.current_balance),
    ((r.interest_rate || 0) * 100).toFixed(2) + '%',
    `<span class="badge">${esc(r.status)}</span>`,
  ],
  '/app/loans/new',
));

// ─── Budgets listing ────────────────────────────────────────
app.get('/app/budgets', async (c) => listingPage(c, 'Budgets', 'budgets', `
  SELECT b.id, b.name, b.period, b.budget_amount, b.start_date, b.end_date,
         c.name as category_name
  FROM budgets b LEFT JOIN categories c ON c.id = b.category_id
  WHERE b.company_id = ? ORDER BY b.start_date DESC`,
  ['Name', 'Category', 'Period', 'Amount', 'Range'],
  (r: any) => [
    `<a href="/app/budgets/${esc(r.id)}">${esc(r.name)}</a>`,
    esc(r.category_name || '—'),
    `<span class="badge">${esc(r.period)}</span>`,
    fmtMoney(r.budget_amount),
    fmtDate(r.start_date) + (r.end_date ? ' → ' + fmtDate(r.end_date) : ''),
  ],
  '/app/budgets/new',
));

// ─── Chart of Accounts (GL) listing ─────────────────────────
app.get('/app/accounts', async (c) => listingPage(c, 'Chart of Accounts', 'accounts', `
  SELECT id, code, name, type, subtype, balance, is_active
  FROM accounts WHERE company_id = ? ORDER BY code, name`,
  ['Code', 'Name', 'Type', 'Subtype', 'Balance'],
  (r: any) => [
    esc(r.code || '—'),
    `<a href="/app/accounts/${esc(r.id)}">${esc(r.name)}</a>`,
    `<span class="badge">${esc(r.type)}</span>`,
    esc(r.subtype || '—'),
    fmtMoney(r.balance),
  ],
  '/app/accounts/new',
));

// ─── Reports — Profit & Loss + Expense Summary ──────────────
// Computed inline from invoices + expenses; no Chart-of-Accounts dependency.
// Period is configurable via ?period=ytd|month|quarter (default ytd).
app.get('/app/reports', async (c) => {
  const cid = c.get('companyId')!;
  const period = c.req.query('period') || 'ytd';
  const now = new Date();
  const year = now.getUTCFullYear();
  let start: string;
  let end: string = now.toISOString().slice(0, 10);
  if (period === 'month') start = `${year}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
  else if (period === 'quarter') {
    const qStartMonth = Math.floor(now.getUTCMonth() / 3) * 3 + 1;
    start = `${year}-${String(qStartMonth).padStart(2, '0')}-01`;
  } else start = `${year}-01-01`;

  const [income, expense, byCat] = await c.env.DB.batch([
    c.env.DB.prepare(`
      SELECT COALESCE(SUM(amount_paid), 0) as paid, COALESCE(SUM(total), 0) as billed
      FROM invoices WHERE company_id = ? AND date >= ? AND date <= ?
    `).bind(cid, start, end),
    c.env.DB.prepare(`
      SELECT COALESCE(SUM(amount), 0) as subtotal, COALESCE(SUM(tax_amount), 0) as tax,
             COALESCE(SUM(shipping_amount), 0) as shipping
      FROM expenses WHERE company_id = ? AND date >= ? AND date <= ?
    `).bind(cid, start, end),
    c.env.DB.prepare(`
      SELECT COALESCE(c.name, 'Uncategorized') as category, COALESCE(SUM(e.amount), 0) as total
      FROM expenses e LEFT JOIN categories c ON c.id = e.category_id
      WHERE e.company_id = ? AND e.date >= ? AND e.date <= ?
      GROUP BY c.id ORDER BY total DESC LIMIT 20
    `).bind(cid, start, end),
  ]);
  const inc = (income.results as any[])[0] || { paid: 0, billed: 0 };
  const exp = (expense.results as any[])[0] || { subtotal: 0, tax: 0, shipping: 0 };
  const cats = (byCat.results as any[]) || [];
  const revenue = Number(inc.paid || 0);
  const expenses = Number(exp.subtotal || 0) + Number(exp.tax || 0) + Number(exp.shipping || 0);
  const netProfit = revenue - expenses;

  const body = `
<div class="page-header">
  <h1 class="page-title">Reports</h1>
  <div style="display:flex;gap:8px">
    <a class="btn ${period === 'month' ? '' : 'btn-ghost'}" href="?period=month">Month</a>
    <a class="btn ${period === 'quarter' ? '' : 'btn-ghost'}" href="?period=quarter">Quarter</a>
    <a class="btn ${period === 'ytd' ? '' : 'btn-ghost'}" href="?period=ytd">YTD</a>
  </div>
</div>
<div class="card" style="margin-bottom:1rem">
  <div class="card-title">Profit &amp; Loss · ${esc(start)} → ${esc(end)}</div>
  <div class="grid grid-3" style="gap:1rem;margin-top:1rem">
    <div><div class="muted" style="font-size:0.75rem;text-transform:uppercase">Revenue</div>
      <div style="font-size:1.6rem;font-weight:700;color:var(--green)">${fmtMoney(revenue)}</div>
      <div class="muted" style="font-size:0.75rem">paid · billed ${fmtMoney(Number(inc.billed || 0))}</div></div>
    <div><div class="muted" style="font-size:0.75rem;text-transform:uppercase">Expenses</div>
      <div style="font-size:1.6rem;font-weight:700;color:var(--red)">${fmtMoney(expenses)}</div>
      <div class="muted" style="font-size:0.75rem">incl. ${fmtMoney(Number(exp.tax || 0))} tax · ${fmtMoney(Number(exp.shipping || 0))} ship</div></div>
    <div><div class="muted" style="font-size:0.75rem;text-transform:uppercase">Net</div>
      <div style="font-size:1.6rem;font-weight:700;color:${netProfit >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtMoney(netProfit)}</div>
      <div class="muted" style="font-size:0.75rem">${revenue > 0 ? ((netProfit / revenue) * 100).toFixed(1) + '% margin' : '—'}</div></div>
  </div>
</div>
<div class="card">
  <div class="card-title">Expenses by Category</div>
  <table class="data">
    <thead><tr><th>Category</th><th class="num">Total</th><th class="num">% of Total</th></tr></thead>
    <tbody>
      ${cats.length === 0 ? '<tr><td colspan="3" class="empty-state">No expenses in this period.</td></tr>' :
        cats.map((r: any) => `<tr>
          <td>${esc(r.category)}</td>
          <td class="num">${fmtMoney(r.total)}</td>
          <td class="num">${expenses > 0 ? ((Number(r.total) / expenses) * 100).toFixed(1) + '%' : '—'}</td>
        </tr>`).join('')}
    </tbody>
  </table>
</div>`;
  return c.html(shell({ title: 'Reports', activeNav: 'reports', body, brand: 'BAP Cloud' }));
});

// ─── Settings page (company info + key/value settings) ──────
app.get('/app/settings', async (c) => {
  const cid = c.get('companyId')!;
  const [company, settings] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT * FROM companies WHERE id = ?').bind(cid),
    c.env.DB.prepare('SELECT key, value FROM settings WHERE company_id = ?').bind(cid),
  ]);
  const co = (company.results as any[])[0] || {};
  const sMap = Object.fromEntries(((settings.results as any[]) || []).map((r: any) => [r.key, r.value]));
  const body = `
<div class="page-header"><h1 class="page-title">Settings</h1></div>
<form id="f" class="card grid" style="gap:1rem">
  <div class="card-title">Company</div>
  <label class="field">Company Name<input name="company_name" required value="${esc(co.name || '')}"></label>
  <div class="grid grid-2" style="gap:1rem">
    <label class="field">Email<input name="company_email" type="email" value="${esc(co.email || '')}"></label>
    <label class="field">Phone<input name="company_phone" value="${esc(co.phone || '')}"></label>
  </div>
  <label class="field">Address<textarea name="company_address" rows="3">${esc(co.address || '')}</textarea></label>
  <div class="grid grid-2" style="gap:1rem">
    <label class="field">Tax ID / EIN<input name="company_tax_id" value="${esc(co.tax_id || '')}"></label>
    <label class="field">Currency<input name="company_currency" maxlength="4" value="${esc(co.currency || 'USD')}"></label>
  </div>

  <div class="card-title" style="margin-top:1rem">App Preferences</div>
  <label class="field">Default Invoice Terms<textarea name="default_invoice_terms" rows="2">${esc(sMap.default_invoice_terms || '')}</textarea></label>
  <label class="field">Default Invoice Notes<textarea name="default_invoice_notes" rows="2">${esc(sMap.default_invoice_notes || '')}</textarea></label>
  <div style="display:flex;justify-content:flex-end"><button type="submit" class="btn">Save Settings</button></div>
</form>
<script>
document.getElementById('f').addEventListener('submit', async function(ev){
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const payload = Object.fromEntries(fd.entries());
  try {
    await window.fetchJSON('/api/settings', { method: 'PUT', body: JSON.stringify(payload) });
    window.toast('Settings saved', 'ok');
  } catch (e) { window.toast(e.message || 'Save failed', 'err'); }
});
</script>`;
  return c.html(shell({ title: 'Settings', activeNav: 'settings', body, brand: 'BAP Cloud' }));
});

app.put('/api/settings', async (c) => {
  const cid = c.get('companyId')!;
  const b: any = await c.req.json();
  const stmts: D1PreparedStatement[] = [];
  if (b.company_name) {
    stmts.push(c.env.DB.prepare(`
      UPDATE companies SET name = ?, email = ?, phone = ?, address = ?, tax_id = ?, currency = ?
      WHERE id = ?
    `).bind(b.company_name, b.company_email || null, b.company_phone || null,
            b.company_address || null, b.company_tax_id || null,
            b.company_currency || 'USD', cid));
  }
  for (const k of ['default_invoice_terms', 'default_invoice_notes']) {
    const v = (b[k] ?? '').toString();
    stmts.push(c.env.DB.prepare(`
      INSERT INTO settings (id, company_id, key, value, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(company_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).bind(uuid(), cid, k, v));
  }
  if (stmts.length > 0) await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

// ─── PURCHASE ORDERS new/edit + CRUD ────────────────────────
// Reuses the bills code path but maps over a different table.
app.get('/app/purchase-orders/new', async (c) => {
  const cid = c.get('companyId')!;
  const vendors = await c.env.DB.prepare('SELECT id, name FROM vendors WHERE company_id = ? AND status = ? ORDER BY name').bind(cid, 'active').all();
  // Override the form's nav target so document-form.ts emits the right URL.
  const cfg = { ...PO_DOC_CFG, parties: (vendors.results as any) || [], navKey: 'purchase-orders' };
  return c.html(documentFormPage(null, [], cfg as any, new Date().toISOString().slice(0, 10)));
});
app.get('/app/purchase-orders/:id', async (c) => {
  const cid = c.get('companyId')!;
  const [po, lines, vendors] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT * FROM purchase_orders WHERE id = ? AND company_id = ?').bind(c.req.param('id'), cid),
    c.env.DB.prepare('SELECT * FROM po_line_items WHERE po_id = ? ORDER BY sort_order').bind(c.req.param('id')),
    c.env.DB.prepare('SELECT id, name FROM vendors WHERE company_id = ? AND status = ? ORDER BY name').bind(cid, 'active'),
  ]);
  const row = (po.results as any[])?.[0];
  if (!row) return c.notFound();
  // Map po_number → number, expected_date → due_date (the form's secondary date slot).
  const normalized = { ...row, number: row.po_number, due_date: row.expected_date };
  const cfg = { ...PO_DOC_CFG, parties: (vendors.results as any) || [] };
  return c.html(documentFormPage(normalized, (lines.results as any) || [], cfg as any, new Date().toISOString().slice(0, 10)));
});
app.post('/api/purchase-orders', async (c) => savePO(c, null));
app.put('/api/purchase-orders/:id', async (c) => savePO(c, c.req.param('id')));
app.delete('/api/purchase-orders/:id', async (c) => {
  const cid = c.get('companyId')!;
  const id = c.req.param('id');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM po_line_items WHERE po_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM purchase_orders WHERE id = ? AND company_id = ?').bind(id, cid),
  ]);
  return c.json({ ok: true });
});
async function savePO(c: any, idOrNull: string | null): Promise<Response> {
  const cid = c.get('companyId')!;
  const b: any = await c.req.json();
  if (!b.vendor_id) return c.json({ error: 'Vendor is required' }, 400);
  const lines: any[] = Array.isArray(b.lines) ? b.lines : [];
  if (lines.length === 0) return c.json({ error: 'At least one line item is required' }, 400);
  const { subtotal, tax, total } = computeInvoiceTotals(lines, Number(b.shipping_amount || 0), Number(b.discount || 0));
  const id = idOrNull || uuid();
  const stmts: D1PreparedStatement[] = [];
  if (idOrNull) {
    stmts.push(c.env.DB.prepare(`
      UPDATE purchase_orders SET vendor_id = ?, po_number = ?, date = ?, expected_date = ?, status = ?,
        subtotal = ?, tax_amount = ?, shipping_amount = ?, discount = ?, total = ?,
        currency = ?, notes = ?, terms = ?, updated_at = datetime('now')
      WHERE id = ? AND company_id = ?
    `).bind(b.vendor_id, b.bill_number || b.po_number || null, b.date, b.due_date || b.expected_date || null,
            b.status || 'draft', subtotal, tax, Number(b.shipping_amount || 0), Number(b.discount || 0), total,
            b.currency || 'USD', b.notes || null, b.terms || null, id, cid));
    stmts.push(c.env.DB.prepare('DELETE FROM po_line_items WHERE po_id = ?').bind(id));
  } else {
    stmts.push(c.env.DB.prepare(`
      INSERT INTO purchase_orders (id, company_id, vendor_id, po_number, date, expected_date, status,
        subtotal, tax_amount, shipping_amount, discount, total, currency, notes, terms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, cid, b.vendor_id, b.bill_number || b.po_number || null, b.date,
            b.due_date || b.expected_date || null, b.status || 'draft',
            subtotal, tax, Number(b.shipping_amount || 0), Number(b.discount || 0), total,
            b.currency || 'USD', b.notes || null, b.terms || null));
  }
  lines.forEach((l, i) => {
    const amt = Number(l.quantity || 0) * Number(l.unit_price || 0);
    const taxA = amt * (Number(l.tax_rate || 0) / 100);
    stmts.push(c.env.DB.prepare(`
      INSERT INTO po_line_items (id, po_id, description, quantity, unit_price, amount, tax_rate, tax_amount, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(uuid(), id, l.description || null, Number(l.quantity || 0),
            Number(l.unit_price || 0), amt, Number(l.tax_rate || 0), taxA, i));
  });
  await c.env.DB.batch(stmts);
  return c.json({ ok: true, id, total });
}

// ─── Generic single-table CRUD (inventory, fixed_assets, loans,
//     budgets, accounts, categories, recurring_templates, debts) ────
// Wires up: GET /app/<navKey>/new + /app/<navKey>/:id with simpleFormPage,
// plus POST /api/<navKey> + PUT/DELETE /api/<navKey>/:id.
interface SimpleEntity {
  table: string;
  navKey: string;
  apiPath: string;
  entitySingular: string;
  entityPlural: string;
  listPath: string;
  // SQL column list used in INSERT/UPDATE (must match the form's `name` keys).
  cols: string[];
  // Form field definitions
  fields: SimpleField[];
  // Optional extra ON DELETE cleanup statements (e.g. cascade null on child FKs).
  onDelete?: (id: string, cid: string, db: any) => any[];
}

function wireSimpleEntity(e: SimpleEntity) {
  const cfg = {
    entitySingular: e.entitySingular,
    entityPlural: e.entityPlural,
    apiPath: e.apiPath,
    navKey: e.navKey,
    listPath: e.listPath,
    fields: e.fields,
  };
  app.get(`/app/${e.navKey}/new`, (c) => c.html(simpleFormPage(null, cfg)));
  app.get(`/app/${e.navKey}/:id`, async (c) => {
    const cid = c.get('companyId')!;
    const row = await c.env.DB.prepare(`SELECT * FROM ${e.table} WHERE id = ? AND company_id = ?`)
      .bind(c.req.param('id'), cid).first<any>();
    if (!row) return c.notFound();
    return c.html(simpleFormPage(row, cfg));
  });
  app.post(e.apiPath, async (c) => {
    const cid = c.get('companyId')!;
    const b: any = await c.req.json();
    const id = uuid();
    await c.env.DB.prepare(
      `INSERT INTO ${e.table} (id, company_id, ${e.cols.join(',')}) VALUES (?, ?, ${e.cols.map(() => '?').join(',')})`
    ).bind(id, cid, ...e.cols.map(col => b[col] ?? null)).run();
    return c.json({ ok: true, id });
  });
  app.put(`${e.apiPath}/:id`, async (c) => {
    const cid = c.get('companyId')!;
    const b: any = await c.req.json();
    const sets = e.cols.map(col => `${col} = ?`).join(', ');
    const r = await c.env.DB.prepare(
      `UPDATE ${e.table} SET ${sets}, updated_at = datetime('now') WHERE id = ? AND company_id = ?`
    ).bind(...e.cols.map(col => b[col] ?? null), c.req.param('id'), cid).run();
    if ((r as any).meta?.changes === 0) return c.json({ error: 'Not found' }, 404);
    return c.json({ ok: true });
  });
  app.delete(`${e.apiPath}/:id`, async (c) => {
    const cid = c.get('companyId')!;
    const id = c.req.param('id');
    const extras = e.onDelete ? e.onDelete(id, cid, c.env.DB) : [];
    await c.env.DB.batch([
      ...extras,
      c.env.DB.prepare(`DELETE FROM ${e.table} WHERE id = ? AND company_id = ?`).bind(id, cid),
    ]);
    return c.json({ ok: true });
  });
}

wireSimpleEntity({
  table: 'inventory_items', navKey: 'inventory', apiPath: '/api/inventory',
  entitySingular: 'Inventory Item', entityPlural: 'Inventory', listPath: '/app/inventory',
  cols: ['sku', 'name', 'description', 'unit_cost', 'unit_price', 'quantity_on_hand',
         'reorder_point', 'unit_of_measure', 'category', 'status'],
  fields: [
    { name: 'name', label: 'Name', kind: 'text', required: true },
    { name: 'sku', label: 'SKU', kind: 'text', rowGroup: 1 },
    { name: 'category', label: 'Category', kind: 'text', rowGroup: 1 },
    { name: 'description', label: 'Description', kind: 'textarea' },
    { name: 'unit_cost', label: 'Unit Cost', kind: 'number', coerce: 'number', rowGroup: 2 },
    { name: 'unit_price', label: 'Unit Price', kind: 'number', coerce: 'number', rowGroup: 2 },
    { name: 'quantity_on_hand', label: 'Qty on Hand', kind: 'number', coerce: 'number', step: '1', rowGroup: 3 },
    { name: 'reorder_point', label: 'Reorder Point', kind: 'number', coerce: 'number', step: '1', rowGroup: 3 },
    { name: 'unit_of_measure', label: 'UoM', kind: 'text', placeholder: 'each, lb, hr, …', rowGroup: 3 },
    { name: 'status', label: 'Status', kind: 'select', options: [
      { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }] },
  ],
});

wireSimpleEntity({
  table: 'fixed_assets', navKey: 'fixed-assets', apiPath: '/api/fixed-assets',
  entitySingular: 'Fixed Asset', entityPlural: 'Fixed Assets', listPath: '/app/fixed-assets',
  cols: ['name', 'category', 'purchase_date', 'purchase_cost', 'current_value',
         'useful_life_years', 'depreciation_method', 'accumulated_depreciation',
         'serial_number', 'location', 'status', 'notes'],
  fields: [
    { name: 'name', label: 'Name', kind: 'text', required: true },
    { name: 'category', label: 'Category', kind: 'text', placeholder: 'Vehicles, Equipment, Furniture…', rowGroup: 1 },
    { name: 'serial_number', label: 'Serial Number', kind: 'text', rowGroup: 1 },
    { name: 'purchase_date', label: 'Purchase Date', kind: 'date', rowGroup: 2 },
    { name: 'purchase_cost', label: 'Purchase Cost', kind: 'number', coerce: 'number', rowGroup: 2 },
    { name: 'current_value', label: 'Current Value', kind: 'number', coerce: 'number', rowGroup: 2 },
    { name: 'useful_life_years', label: 'Useful Life (years)', kind: 'number', coerce: 'integer', step: '1', rowGroup: 3 },
    { name: 'depreciation_method', label: 'Depreciation', kind: 'select', rowGroup: 3, options: [
      { value: 'straight_line', label: 'Straight Line' },
      { value: 'declining_balance', label: 'Declining Balance' },
      { value: 'macrs', label: 'MACRS' },
      { value: 'none', label: 'None' }] },
    { name: 'accumulated_depreciation', label: 'Accum. Depreciation', kind: 'number', coerce: 'number', rowGroup: 3 },
    { name: 'location', label: 'Location', kind: 'text', rowGroup: 4 },
    { name: 'status', label: 'Status', kind: 'select', rowGroup: 4, options: [
      { value: 'active', label: 'Active' }, { value: 'disposed', label: 'Disposed' }, { value: 'sold', label: 'Sold' }] },
    { name: 'notes', label: 'Notes', kind: 'textarea' },
  ],
});

wireSimpleEntity({
  table: 'loans', navKey: 'loans', apiPath: '/api/loans',
  entitySingular: 'Loan', entityPlural: 'Loans', listPath: '/app/loans',
  cols: ['name', 'lender_name', 'loan_type', 'principal', 'current_balance',
         'interest_rate', 'rate_type', 'start_date', 'term_months', 'payment_amount',
         'status', 'notes'],
  fields: [
    { name: 'name', label: 'Loan Name', kind: 'text', required: true, rowGroup: 1 },
    { name: 'lender_name', label: 'Lender', kind: 'text', rowGroup: 1 },
    { name: 'loan_type', label: 'Type', kind: 'select', rowGroup: 2, options: [
      { value: 'term_loan', label: 'Term Loan' },
      { value: 'mortgage', label: 'Mortgage' },
      { value: 'sba', label: 'SBA Loan' },
      { value: 'line_of_credit', label: 'Line of Credit' },
      { value: 'auto', label: 'Auto Loan' },
      { value: 'other', label: 'Other' }] },
    { name: 'principal', label: 'Original Principal', kind: 'number', coerce: 'number', rowGroup: 2 },
    { name: 'current_balance', label: 'Current Balance', kind: 'number', coerce: 'number', rowGroup: 2 },
    { name: 'interest_rate', label: 'Interest Rate (decimal, e.g. 0.0675)', kind: 'number', coerce: 'number', step: '0.0001', rowGroup: 3 },
    { name: 'rate_type', label: 'Rate Type', kind: 'select', rowGroup: 3, options: [
      { value: 'fixed', label: 'Fixed' }, { value: 'variable', label: 'Variable' }] },
    { name: 'term_months', label: 'Term (months)', kind: 'number', coerce: 'integer', step: '1', rowGroup: 3 },
    { name: 'start_date', label: 'Start Date', kind: 'date', rowGroup: 4 },
    { name: 'payment_amount', label: 'Monthly Payment', kind: 'number', coerce: 'number', rowGroup: 4 },
    { name: 'status', label: 'Status', kind: 'select', rowGroup: 4, options: [
      { value: 'active', label: 'Active' },
      { value: 'paid_off', label: 'Paid Off' },
      { value: 'refinanced', label: 'Refinanced' }] },
    { name: 'notes', label: 'Notes', kind: 'textarea' },
  ],
});

wireSimpleEntity({
  table: 'budgets', navKey: 'budgets', apiPath: '/api/budgets',
  entitySingular: 'Budget', entityPlural: 'Budgets', listPath: '/app/budgets',
  cols: ['name', 'period', 'category_id', 'budget_amount', 'start_date', 'end_date', 'notes'],
  fields: [
    { name: 'name', label: 'Budget Name', kind: 'text', required: true },
    { name: 'period', label: 'Period', kind: 'select', rowGroup: 1, options: [
      { value: 'monthly', label: 'Monthly' },
      { value: 'quarterly', label: 'Quarterly' },
      { value: 'annual', label: 'Annual' }] },
    { name: 'budget_amount', label: 'Budget Amount', kind: 'number', coerce: 'number', rowGroup: 1 },
    { name: 'category_id', label: 'Category ID (optional)', kind: 'text', placeholder: 'Leave empty for all categories', rowGroup: 2 },
    { name: 'start_date', label: 'Start Date', kind: 'date', required: true, rowGroup: 2 },
    { name: 'end_date', label: 'End Date', kind: 'date', rowGroup: 2 },
    { name: 'notes', label: 'Notes', kind: 'textarea' },
  ],
});

wireSimpleEntity({
  table: 'accounts', navKey: 'accounts', apiPath: '/api/accounts',
  entitySingular: 'Account', entityPlural: 'Chart of Accounts', listPath: '/app/accounts',
  cols: ['code', 'name', 'type', 'subtype', 'description', 'is_active', 'balance', 'parent_id'],
  fields: [
    { name: 'code', label: 'Account Code', kind: 'text', placeholder: 'e.g. 1000', rowGroup: 1 },
    { name: 'name', label: 'Account Name', kind: 'text', required: true, rowGroup: 1 },
    { name: 'type', label: 'Type', kind: 'select', rowGroup: 2, options: [
      { value: 'asset', label: 'Asset' },
      { value: 'liability', label: 'Liability' },
      { value: 'equity', label: 'Equity' },
      { value: 'income', label: 'Income' },
      { value: 'expense', label: 'Expense' }] },
    { name: 'subtype', label: 'Subtype', kind: 'text', placeholder: 'current_asset, etc.', rowGroup: 2 },
    { name: 'balance', label: 'Opening Balance', kind: 'number', coerce: 'number', rowGroup: 2 },
    { name: 'description', label: 'Description', kind: 'textarea' },
    { name: 'is_active', label: 'Active', kind: 'checkbox', coerce: 'checkbox' },
  ],
});

// Sidebar ordering puts Reports/Settings AFTER the entity modules but those
// routes are registered above; the page-handlers below are extras (debts,
// categories, recurring) the sidebar doesn't yet expose but the API does.
wireSimpleEntity({
  table: 'debts', navKey: 'debts', apiPath: '/api/debts',
  entitySingular: 'Debt', entityPlural: 'Debts', listPath: '/app/debts',
  cols: ['client_id', 'account_name', 'principal', 'current_balance', 'stage',
         'status', 'origin_invoice_id', 'interest_rate', 'start_date', 'notes'],
  fields: [
    { name: 'account_name', label: 'Account Name', kind: 'text', required: true },
    { name: 'client_id', label: 'Client ID (optional)', kind: 'text', rowGroup: 1 },
    { name: 'origin_invoice_id', label: 'Origin Invoice ID', kind: 'text', rowGroup: 1 },
    { name: 'principal', label: 'Principal', kind: 'number', coerce: 'number', rowGroup: 2 },
    { name: 'current_balance', label: 'Current Balance', kind: 'number', coerce: 'number', rowGroup: 2 },
    { name: 'interest_rate', label: 'Interest Rate', kind: 'number', coerce: 'number', step: '0.0001', rowGroup: 2 },
    { name: 'stage', label: 'Stage', kind: 'select', rowGroup: 3, options: [
      'reminder', 'warning', 'final_notice', 'demand_letter', 'collections_agency', 'legal_action', 'judgment', 'garnishment'
    ].map(s => ({ value: s, label: s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) })) },
    { name: 'status', label: 'Status', kind: 'select', rowGroup: 3, options: [
      { value: 'active', label: 'Active' }, { value: 'settled', label: 'Settled' }, { value: 'closed', label: 'Closed' }] },
    { name: 'start_date', label: 'Start Date', kind: 'date', rowGroup: 3 },
    { name: 'notes', label: 'Notes', kind: 'textarea' },
  ],
});

wireSimpleEntity({
  table: 'categories', navKey: 'categories', apiPath: '/api/categories',
  entitySingular: 'Category', entityPlural: 'Categories', listPath: '/app/categories',
  cols: ['name', 'type', 'color', 'icon', 'description', 'monthly_cap', 'is_active'],
  fields: [
    { name: 'name', label: 'Name', kind: 'text', required: true, rowGroup: 1 },
    { name: 'type', label: 'Type', kind: 'select', rowGroup: 1, options: [
      { value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }] },
    { name: 'color', label: 'Color', kind: 'text', placeholder: '#10b981', rowGroup: 2 },
    { name: 'icon', label: 'Icon', kind: 'text', placeholder: 'Emoji or name', rowGroup: 2 },
    { name: 'monthly_cap', label: 'Monthly Cap (optional)', kind: 'number', coerce: 'number', rowGroup: 2 },
    { name: 'description', label: 'Description', kind: 'textarea' },
    { name: 'is_active', label: 'Active', kind: 'checkbox', coerce: 'checkbox' },
  ],
});

// ─── KPI Dashboard — aggregate widgets for the active period ────────
// Pulls revenue / expenses / cash position / receivables / payables and
// renders them as a 4×2 grid of metric cards. SQL aggregates only — no
// stored snapshots — so values are always live.
app.get('/app/kpi', async (c) => {
  const cid = c.get('companyId')!;
  const now = new Date();
  const ytdStart = `${now.getUTCFullYear()}-01-01`;
  const today = now.toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400_000).toISOString().slice(0, 10);

  const [revYTD, expYTD, recvOpen, payOpen, invCount, invLast30] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT COALESCE(SUM(amount_paid),0) as v FROM invoices WHERE company_id=? AND date>=?').bind(cid, ytdStart),
    c.env.DB.prepare('SELECT COALESCE(SUM(amount),0) + COALESCE(SUM(tax_amount),0) + COALESCE(SUM(shipping_amount),0) as v FROM expenses WHERE company_id=? AND date>=?').bind(cid, ytdStart),
    c.env.DB.prepare('SELECT COALESCE(SUM(total - amount_paid),0) as v FROM invoices WHERE company_id=? AND status IN (?,?,?)').bind(cid, 'sent', 'overdue', 'partial'),
    c.env.DB.prepare('SELECT COALESCE(SUM(total - amount_paid),0) as v FROM bills WHERE company_id=? AND status IN (?,?)').bind(cid, 'open', 'overdue'),
    c.env.DB.prepare('SELECT COUNT(*) as v FROM invoices WHERE company_id=?').bind(cid),
    c.env.DB.prepare('SELECT COUNT(*) as v FROM invoices WHERE company_id=? AND date>=?').bind(cid, thirtyDaysAgo),
  ]);
  const v = (rs: any) => Number((rs.results as any[])[0]?.v || 0);
  const revenue = v(revYTD);
  const expenses = v(expYTD);
  const profit = revenue - expenses;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

  const card = (label: string, value: string, color = 'var(--text-bright)', sub = '') =>
    `<div class="card"><div class="muted" style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em">${esc(label)}</div>
      <div style="font-size:1.6rem;font-weight:800;color:${color};margin-top:6px">${esc(value)}</div>
      ${sub ? `<div class="muted" style="font-size:0.72rem;margin-top:4px">${esc(sub)}</div>` : ''}</div>`;

  const body = `
<div class="page-header"><h1 class="page-title">KPI Dashboard</h1>
  <div class="muted" style="font-size:0.85rem">${esc(ytdStart)} → ${esc(today)}</div>
</div>
<div class="grid grid-4" style="gap:1rem;margin-bottom:1rem">
  ${card('Revenue YTD', fmtMoney(revenue), 'var(--green)')}
  ${card('Expenses YTD', fmtMoney(expenses), 'var(--red)')}
  ${card('Net Profit', fmtMoney(profit), profit >= 0 ? 'var(--green)' : 'var(--red)', margin.toFixed(1) + '% margin')}
  ${card('Cash Position', fmtMoney(revenue - expenses - v(recvOpen)), 'var(--text-bright)', 'rough estimate')}
</div>
<div class="grid grid-4" style="gap:1rem">
  ${card('Accounts Receivable', fmtMoney(v(recvOpen)), 'var(--amber)', 'unpaid invoices')}
  ${card('Accounts Payable', fmtMoney(v(payOpen)), 'var(--red)', 'unpaid bills')}
  ${card('Invoices (all-time)', String(v(invCount)))}
  ${card('Invoices last 30d', String(v(invLast30)))}
</div>`;
  return c.html(shell({ title: 'KPI', activeNav: 'kpi', body, brand: 'BAP Cloud' }));
});

// ─── Forecasting — 6-month moving-average projection ────────────────
// Takes the last 6 closed months of revenue + expenses, runs a simple
// moving-average forward 3 months. Renders a tiny inline SVG sparkline
// — no external charting library, ~80 lines of SVG path math.
app.get('/app/forecasting', async (c) => {
  const cid = c.get('companyId')!;
  const now = new Date();
  // 9 months: 6 historical for the average, 3 projection. month strings YYYY-MM.
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }

  const [revRows, expRows] = await c.env.DB.batch([
    c.env.DB.prepare(`
      SELECT substr(date,1,7) as m, COALESCE(SUM(amount_paid),0) as v
      FROM invoices WHERE company_id=? AND date>=?
      GROUP BY substr(date,1,7) ORDER BY m
    `).bind(cid, months[0] + '-01'),
    c.env.DB.prepare(`
      SELECT substr(date,1,7) as m, COALESCE(SUM(amount + tax_amount + shipping_amount),0) as v
      FROM expenses WHERE company_id=? AND date>=?
      GROUP BY substr(date,1,7) ORDER BY m
    `).bind(cid, months[0] + '-01'),
  ]);
  const revByMonth = Object.fromEntries(((revRows.results as any[]) || []).map((r: any) => [r.m, Number(r.v)]));
  const expByMonth = Object.fromEntries(((expRows.results as any[]) || []).map((r: any) => [r.m, Number(r.v)]));
  const revSeries = months.map(m => revByMonth[m] || 0);
  const expSeries = months.map(m => expByMonth[m] || 0);
  // Projection: 6-month average extended 3 months forward.
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
  const revFcAvg = avg(revSeries);
  const expFcAvg = avg(expSeries);

  // Build sparkline SVG (250×60).
  const sparkline = (series: number[], projected: number, color: string): string => {
    const all = [...series, projected, projected, projected];
    const max = Math.max(1, ...all);
    const pts = all.map((v, i) => `${(i / (all.length - 1)) * 250},${60 - (v / max) * 55}`);
    const histPath = `M ${pts.slice(0, 6).join(' L ')}`;
    const fcPath = `M ${pts.slice(5).join(' L ')}`;
    return `<svg width="250" height="60" viewBox="0 0 250 60" style="margin-top:8px">
      <path d="${histPath}" fill="none" stroke="${color}" stroke-width="2"/>
      <path d="${fcPath}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="4,3" opacity="0.6"/>
    </svg>`;
  };

  const body = `
<div class="page-header">
  <h1 class="page-title">Forecasting</h1>
  <div class="muted" style="font-size:0.85rem">6-month history → 3-month projection · moving average</div>
</div>
<div class="grid grid-2" style="gap:1rem">
  <div class="card">
    <div class="card-title">Revenue trend</div>
    <div style="font-size:1.6rem;font-weight:800;color:var(--green)">${fmtMoney(revFcAvg)}</div>
    <div class="muted" style="font-size:0.75rem">projected monthly avg next 3 months</div>
    ${sparkline(revSeries, revFcAvg, '#34d399')}
    <div class="muted" style="font-size:0.7rem;margin-top:6px">${esc(months.join(' · '))}</div>
  </div>
  <div class="card">
    <div class="card-title">Expense trend</div>
    <div style="font-size:1.6rem;font-weight:800;color:var(--red)">${fmtMoney(expFcAvg)}</div>
    <div class="muted" style="font-size:0.75rem">projected monthly avg next 3 months</div>
    ${sparkline(expSeries, expFcAvg, '#fb7185')}
    <div class="muted" style="font-size:0.7rem;margin-top:6px">${esc(months.join(' · '))}</div>
  </div>
</div>
<div class="card" style="margin-top:1rem">
  <div class="card-title">Projected Net</div>
  <div style="font-size:2rem;font-weight:800;color:${revFcAvg - expFcAvg >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtMoney(revFcAvg - expFcAvg)}</div>
  <div class="muted" style="font-size:0.8rem">monthly · simple moving-average · no seasonality adjustment</div>
</div>`;
  return c.html(shell({ title: 'Forecasting', activeNav: 'forecasting', body, brand: 'BAP Cloud' }));
});

// ─── Audit Trail — paginated log viewer ─────────────────────────────
app.get('/app/audit', async (c) => {
  const cid = c.get('companyId')!;
  const rows = await c.env.DB.prepare(`
    SELECT id, user_id, action, entity_type, entity_id, description, created_at
    FROM audit_log WHERE company_id = ?
    ORDER BY created_at DESC LIMIT 200
  `).bind(cid).all();
  const items = (rows.results as any[]) || [];
  const body = `
<div class="page-header"><h1 class="page-title">Audit Trail</h1>
  <div class="muted" style="font-size:0.85rem">Latest 200 events</div>
</div>
<table class="data">
  <thead><tr><th>When</th><th>Action</th><th>Entity</th><th>Description</th></tr></thead>
  <tbody>
    ${items.length === 0 ? `<tr><td colspan="4" class="empty-state">No audit events yet.</td></tr>` :
      items.map((r: any) => `<tr>
        <td class="muted" style="font-family:'SF Mono',Menlo,monospace;font-size:0.78rem">${esc(r.created_at)}</td>
        <td><span class="badge ${r.action === 'delete' ? 'badge-red' : r.action === 'create' ? 'badge-green' : 'badge-blue'}">${esc(r.action)}</span></td>
        <td><span class="muted">${esc(r.entity_type)}</span>${r.entity_id ? ` <code style="font-size:0.75rem">${esc(String(r.entity_id).slice(0, 8))}</code>` : ''}</td>
        <td>${esc(r.description || '—')}</td>
      </tr>`).join('')}
  </tbody>
</table>`;
  return c.html(shell({ title: 'Audit', activeNav: 'audit', body, brand: 'BAP Cloud' }));
});

// ─── Notifications — listing + mark-as-read ─────────────────────────
app.get('/app/notifications', async (c) => {
  const cid = c.get('companyId')!;
  const uid = c.get('userId')!;
  const rows = await c.env.DB.prepare(`
    SELECT id, kind, title, body, link, is_read, created_at
    FROM notifications WHERE company_id = ? AND (user_id = ? OR user_id IS NULL)
    ORDER BY created_at DESC LIMIT 100
  `).bind(cid, uid).all();
  const items = (rows.results as any[]) || [];
  const body = `
<div class="page-header">
  <h1 class="page-title">Notifications</h1>
  <button id="markAll" class="btn btn-ghost">Mark all read</button>
</div>
<div class="card">
  ${items.length === 0 ? `<div class="empty-state">No notifications.</div>` :
    items.map((n: any) => `<div style="display:flex;gap:1rem;padding:0.75rem 0;border-bottom:1px solid var(--border)${n.is_read ? '' : ';background:rgba(96,165,250,0.04)'}">
      <div style="flex:1">
        <div style="font-weight:600;color:var(--text-bright)">${esc(n.title)}${n.is_read ? '' : ' <span class="badge badge-blue" style="font-size:0.6rem">new</span>'}</div>
        ${n.body ? `<div class="muted" style="font-size:0.85rem;margin-top:2px">${esc(n.body)}</div>` : ''}
        <div class="muted" style="font-size:0.72rem;margin-top:4px;font-family:'SF Mono',Menlo,monospace">${esc(n.created_at)}${n.link ? ` · <a href="${esc(n.link)}">Open</a>` : ''}</div>
      </div>
    </div>`).join('')}
</div>
<script>
document.getElementById('markAll').addEventListener('click', async () => {
  try { await window.fetchJSON('/api/notifications/mark-all-read', { method: 'POST', body: '{}' });
    location.reload();
  } catch (e) { window.toast(e.message || 'Failed', 'err'); }
});
</script>`;
  return c.html(shell({ title: 'Notifications', activeNav: 'notifications', body, brand: 'BAP Cloud' }));
});

app.post('/api/notifications/mark-all-read', async (c) => {
  const cid = c.get('companyId')!;
  const uid = c.get('userId')!;
  await c.env.DB.prepare(`
    UPDATE notifications SET is_read = 1, read_at = datetime('now')
    WHERE company_id = ? AND (user_id = ? OR user_id IS NULL) AND is_read = 0
  `).bind(cid, uid).run();
  return c.json({ ok: true });
});

// ─── Schedule C report — IRS Form 1040 Schedule C aggregator ────────
// Maps expense.schedule_c_line (1–32) to Schedule C box totals. The desktop
// stores this on each expense; the cloud reads it as-is on synced rows.
// Output is a printable rollup, not a filled PDF (that's filing-tier work).
app.get('/app/taxes', async (c) => {
  const cid = c.get('companyId')!;
  const year = c.req.query('year') || String(new Date().getUTCFullYear());
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;

  const [income, byLine, totalExpenses] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT COALESCE(SUM(amount_paid),0) as v FROM invoices WHERE company_id=? AND date>=? AND date<=?`).bind(cid, start, end),
    c.env.DB.prepare(`
      SELECT COALESCE(NULLIF(schedule_c_line, ''), 'unassigned') as line,
             COALESCE(SUM(amount),0) as total, COUNT(*) as n
      FROM expenses WHERE company_id=? AND date>=? AND date<=? AND (is_tax_deductible IS NULL OR is_tax_deductible = 1)
      GROUP BY line ORDER BY line
    `).bind(cid, start, end),
    c.env.DB.prepare(`SELECT COALESCE(SUM(amount),0) as v FROM expenses WHERE company_id=? AND date>=? AND date<=? AND (is_tax_deductible IS NULL OR is_tax_deductible = 1)`).bind(cid, start, end),
  ]);
  // Line names per the IRS Form 1040 Schedule C (Part II expenses) — abridged.
  // Stored as strings on the desktop so this mapping intentionally mirrors them.
  const SC_LABELS: Record<string, string> = {
    '8': 'Advertising', '9': 'Car & truck', '10': 'Commissions/fees',
    '11': 'Contract labor', '12': 'Depletion', '13': 'Depreciation',
    '14': 'Employee benefit programs', '15': 'Insurance (other than health)',
    '16a': 'Interest (mortgage)', '16b': 'Interest (other)', '17': 'Legal & professional',
    '18': 'Office expense', '19': 'Pension & profit-sharing',
    '20a': 'Rent (vehicles/equipment)', '20b': 'Rent (other property)',
    '21': 'Repairs & maintenance', '22': 'Supplies', '23': 'Taxes & licenses',
    '24a': 'Travel', '24b': 'Meals (deductible portion)', '25': 'Utilities',
    '26': 'Wages', '27a': 'Other expenses',
    'unassigned': 'Unassigned',
  };
  const rev = Number((income.results as any[])[0]?.v || 0);
  const exp = Number((totalExpenses.results as any[])[0]?.v || 0);
  const net = rev - exp;
  const lines = (byLine.results as any[]) || [];

  const body = `
<div class="page-header">
  <h1 class="page-title">Tax · Schedule C ${esc(year)}</h1>
  <div style="display:flex;gap:8px">
    ${['2024','2025','2026'].map(y => `<a class="btn ${y === year ? '' : 'btn-ghost'}" href="?year=${y}">${y}</a>`).join('')}
  </div>
</div>
<div class="card" style="margin-bottom:1rem">
  <div class="card-title">Summary · ${esc(start)} → ${esc(end)}</div>
  <div class="grid grid-3" style="gap:1rem;margin-top:1rem">
    <div><div class="muted" style="font-size:0.72rem;text-transform:uppercase">Gross receipts (Line 1)</div>
      <div style="font-size:1.4rem;font-weight:700;color:var(--green)">${fmtMoney(rev)}</div></div>
    <div><div class="muted" style="font-size:0.72rem;text-transform:uppercase">Total deductible (Line 28)</div>
      <div style="font-size:1.4rem;font-weight:700;color:var(--red)">${fmtMoney(exp)}</div></div>
    <div><div class="muted" style="font-size:0.72rem;text-transform:uppercase">Net profit (Line 31)</div>
      <div style="font-size:1.4rem;font-weight:700;color:${net >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtMoney(net)}</div></div>
  </div>
</div>
<div class="card">
  <div class="card-title">By Schedule C line</div>
  <table class="data">
    <thead><tr><th>Line</th><th>Description</th><th class="num">Entries</th><th class="num">Total</th></tr></thead>
    <tbody>
      ${lines.length === 0 ? `<tr><td colspan="4" class="empty-state">No deductible expenses in ${esc(year)}.</td></tr>` :
        lines.map((l: any) => `<tr>
          <td><code>${esc(l.line)}</code></td>
          <td>${esc(SC_LABELS[l.line] || '—')}</td>
          <td class="num">${String(l.n)}</td>
          <td class="num">${fmtMoney(l.total)}</td>
        </tr>`).join('')}
    </tbody>
  </table>
</div>
<div class="muted" style="margin-top:1rem;font-size:0.75rem">Aggregator only. For e-filing, export this and your books to a tax preparer or filing service. Cells map to IRS Form 1040 Schedule C, Part II. Confirm with your CPA.</div>`;
  return c.html(shell({ title: 'Tax', activeNav: 'taxes', body, brand: 'BAP Cloud' }));
});

// ─── Recurring Templates listing + CRUD ─────────────────────────────
app.get('/app/recurring', async (c) => listingPage(c, 'Recurring', 'recurring', `
  SELECT id, type, name, frequency, next_date, is_active, last_run_date
  FROM recurring_templates WHERE company_id = ? ORDER BY next_date`,
  ['Type', 'Name', 'Frequency', 'Next run', 'Last run', 'Active'],
  (r: any) => [
    `<span class="badge">${esc(r.type)}</span>`,
    `<a href="/app/recurring/${esc(r.id)}">${esc(r.name)}</a>`,
    esc(r.frequency),
    fmtDate(r.next_date),
    r.last_run_date ? fmtDate(r.last_run_date) : '—',
    r.is_active ? '✓' : '—',
  ],
  '/app/recurring/new',
));

wireSimpleEntity({
  table: 'recurring_templates', navKey: 'recurring', apiPath: '/api/recurring',
  entitySingular: 'Recurring Template', entityPlural: 'Recurring', listPath: '/app/recurring',
  cols: ['type', 'name', 'frequency', 'next_date', 'is_active', 'template_data'],
  fields: [
    { name: 'name', label: 'Template Name', kind: 'text', required: true },
    { name: 'type', label: 'Type', kind: 'select', rowGroup: 1, options: [
      { value: 'expense', label: 'Expense' },
      { value: 'invoice', label: 'Invoice' },
      { value: 'bill', label: 'Bill' }] },
    { name: 'frequency', label: 'Frequency', kind: 'select', rowGroup: 1, options: [
      { value: 'weekly', label: 'Weekly' },
      { value: 'biweekly', label: 'Bi-weekly' },
      { value: 'monthly', label: 'Monthly' },
      { value: 'quarterly', label: 'Quarterly' },
      { value: 'annual', label: 'Annual' }] },
    { name: 'next_date', label: 'Next Run', kind: 'date', required: true, rowGroup: 2 },
    { name: 'is_active', label: 'Active', kind: 'checkbox', coerce: 'checkbox', rowGroup: 2 },
    { name: 'template_data', label: 'Template Data (JSON)', kind: 'textarea',
      placeholder: '{"vendor_id":"…","amount":120,"description":"Monthly subscription"}' },
  ],
});

// ─── Debt Collection workflow page ──────────────────────────────────
const DEBT_STAGE_ORDER = ['reminder','warning','final_notice','demand_letter','collections_agency','legal_action','judgment','garnishment'];
app.get('/app/debt-collection', async (c) => {
  const cid = c.get('companyId')!;
  const rows = await c.env.DB.prepare(`
    SELECT d.id, d.account_name, d.principal, d.current_balance, d.stage, d.status,
           d.interest_rate, d.start_date,
           c.name as client_name
    FROM debts d LEFT JOIN clients c ON c.id = d.client_id
    WHERE d.company_id = ? AND d.status = 'active' ORDER BY d.current_balance DESC
  `).bind(cid).all();
  const items = (rows.results as any[]) || [];
  const totalOutstanding = items.reduce((s, r: any) => s + Number(r.current_balance || 0), 0);
  // Bucket by stage for the funnel display.
  const byStage = Object.fromEntries(DEBT_STAGE_ORDER.map(s => [s, [] as any[]]));
  for (const r of items) (byStage[r.stage] || (byStage[r.stage] = [])).push(r);

  const body = `
<div class="page-header"><h1 class="page-title">Debt Collection</h1>
  <a class="btn" href="/app/debts/new">+ New Debt</a>
</div>
<div class="card" style="margin-bottom:1rem">
  <div class="muted" style="font-size:0.72rem;text-transform:uppercase">Total outstanding · ${items.length} active</div>
  <div style="font-size:1.8rem;font-weight:800;color:var(--red)">${fmtMoney(totalOutstanding)}</div>
</div>
<div class="grid" style="gap:1rem;grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
  ${DEBT_STAGE_ORDER.map(stage => {
    const list = byStage[stage] || [];
    if (list.length === 0) return '';
    const stageTotal = list.reduce((s, r: any) => s + Number(r.current_balance || 0), 0);
    return `<div class="card">
      <div class="card-title" style="display:flex;justify-content:space-between">
        <span>${esc(stage.replace(/_/g, ' '))}</span>
        <span class="muted">${list.length}</span>
      </div>
      <div class="muted" style="font-size:0.75rem">${fmtMoney(stageTotal)}</div>
      ${list.map((r: any) => `<div style="padding:0.5rem 0;border-top:1px solid var(--border);font-size:0.85rem">
        <a href="/app/debts/${esc(r.id)}">${esc(r.account_name)}</a>
        <div class="muted" style="font-size:0.75rem">${esc(r.client_name || '—')} · ${fmtMoney(r.current_balance)}</div>
      </div>`).join('')}
    </div>`;
  }).join('')}
</div>
${items.length === 0 ? '<div class="empty-state">No active debts.</div>' : ''}`;
  return c.html(shell({ title: 'Debt Collection', activeNav: 'debt-collection', body, brand: 'BAP Cloud' }));
});

// ─── Audit-log helper — call from any mutation to record an event ───
// Exported for future use; the existing CRUD routes will pick it up in a
// follow-up that adds before/after hooks. For now, /app/audit reads the
// table whether or not it has rows yet.
export async function logAudit(env: Env, companyId: string, userId: string | null, params: {
  action: string; entity_type: string; entity_id?: string; description?: string; metadata?: any;
}): Promise<void> {
  try {
    await env.DB.prepare(`
      INSERT INTO audit_log (id, company_id, user_id, action, entity_type, entity_id, description, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(uuid(), companyId, userId, params.action, params.entity_type,
            params.entity_id || null, params.description || null,
            params.metadata ? JSON.stringify(params.metadata) : null).run();
  } catch { /* audit must never throw — it's a side-effect */ }
}

// ─── Bank Reconciliation ─────────────────────────────────────────────
// Bank accounts (the user's actual checking/savings) and the imported
// transactions awaiting match. Match flow: user uploads CSV → rows land in
// bank_transactions with is_reconciled=0 → user clicks "match" against an
// expense / invoice / payment → matched_entity_*  is stamped and the row
// flips to is_reconciled=1.

app.get('/app/bank', async (c) => {
  const cid = c.get('companyId')!;
  const [accounts, recentTxns] = await c.env.DB.batch([
    c.env.DB.prepare(`
      SELECT ba.id, ba.name, ba.bank_name, ba.account_last4, ba.current_balance,
             ba.reconciled_balance, ba.reconciled_through_date,
             COALESCE(unrec.unmatched, 0) as unmatched_count
      FROM bank_accounts ba
      LEFT JOIN (
        SELECT bank_account_id, COUNT(*) as unmatched
        FROM bank_transactions WHERE is_reconciled = 0 GROUP BY bank_account_id
      ) unrec ON unrec.bank_account_id = ba.id
      WHERE ba.company_id = ? AND ba.is_active = 1 ORDER BY ba.name
    `).bind(cid),
    c.env.DB.prepare(`
      SELECT bt.id, bt.date, bt.description, bt.amount, bt.is_reconciled,
             ba.name as account_name
      FROM bank_transactions bt
      JOIN bank_accounts ba ON ba.id = bt.bank_account_id
      WHERE bt.company_id = ? ORDER BY bt.date DESC LIMIT 50
    `).bind(cid),
  ]);
  const accs = (accounts.results as any[]) || [];
  const txns = (recentTxns.results as any[]) || [];

  const body = `
<div class="page-header">
  <h1 class="page-title">Bank Reconciliation</h1>
  <a href="/app/bank/new" class="btn">+ Add Account</a>
</div>

${accs.length === 0 ? `<div class="empty-state">No bank accounts yet. Add one to start reconciling.</div>` : `
<div class="grid grid-3" style="gap:1rem;margin-bottom:1rem">
  ${accs.map((a: any) => `<div class="card">
    <div class="muted" style="font-size:0.72rem;text-transform:uppercase">${esc(a.bank_name || 'Bank')} ${a.account_last4 ? '••' + esc(a.account_last4) : ''}</div>
    <div style="font-size:1.1rem;font-weight:700">${esc(a.name)}</div>
    <div style="font-size:1.4rem;font-family:'SF Mono',Menlo,monospace;color:var(--text-bright);margin-top:6px">${fmtMoney(a.current_balance)}</div>
    <div class="muted" style="font-size:0.75rem;margin-top:4px">
      ${a.unmatched_count > 0 ? `<span class="badge badge-amber">${a.unmatched_count} to match</span>` : '<span class="badge badge-green">all matched</span>'}
    </div>
    <div style="margin-top:0.75rem;display:flex;gap:6px">
      <a href="/app/bank/${esc(a.id)}/import" class="btn btn-ghost" style="font-size:0.72rem;padding:6px 10px">Import CSV</a>
      <a href="/app/bank/${esc(a.id)}/match" class="btn btn-ghost" style="font-size:0.72rem;padding:6px 10px">Match</a>
    </div>
  </div>`).join('')}
</div>
<div class="card">
  <div class="card-title">Recent transactions (all accounts)</div>
  <table class="data">
    <thead><tr><th>Date</th><th>Account</th><th>Description</th><th class="num">Amount</th><th>Status</th></tr></thead>
    <tbody>
      ${txns.length === 0 ? `<tr><td colspan="5" class="empty-state">No transactions imported yet.</td></tr>` :
        txns.map((t: any) => `<tr>
          <td class="muted" style="font-family:'SF Mono',Menlo,monospace;font-size:0.78rem">${fmtDate(t.date)}</td>
          <td>${esc(t.account_name)}</td>
          <td>${esc(t.description || '—')}</td>
          <td class="num" style="color:${Number(t.amount) < 0 ? 'var(--red)' : 'var(--green)'}">${fmtMoney(t.amount)}</td>
          <td>${t.is_reconciled ? '<span class="badge badge-green">matched</span>' : '<span class="badge badge-amber">pending</span>'}</td>
        </tr>`).join('')}
    </tbody>
  </table>
</div>`}`;
  return c.html(shell({ title: 'Bank Recon', activeNav: 'bank', body, brand: 'BAP Cloud' }));
});

// New bank account form — single-table CRUD via simpleFormPage.
wireSimpleEntity({
  table: 'bank_accounts', navKey: 'bank', apiPath: '/api/bank-accounts',
  entitySingular: 'Bank Account', entityPlural: 'Bank Accounts', listPath: '/app/bank',
  cols: ['name', 'type', 'bank_name', 'account_last4', 'current_balance',
         'reconciled_balance', 'reconciled_through_date', 'currency', 'is_active', 'notes'],
  fields: [
    { name: 'name', label: 'Account Nickname', kind: 'text', required: true },
    { name: 'type', label: 'Type', kind: 'select', rowGroup: 1, options: [
      { value: 'checking', label: 'Checking' },
      { value: 'savings', label: 'Savings' },
      { value: 'credit_card', label: 'Credit Card' },
      { value: 'line_of_credit', label: 'Line of Credit' }] },
    { name: 'bank_name', label: 'Bank', kind: 'text', rowGroup: 1, placeholder: 'Wells Fargo, etc.' },
    { name: 'account_last4', label: 'Last 4 of acct #', kind: 'text', rowGroup: 1 },
    { name: 'current_balance', label: 'Current Balance', kind: 'number', coerce: 'number', rowGroup: 2 },
    { name: 'currency', label: 'Currency', kind: 'text', rowGroup: 2 },
    { name: 'is_active', label: 'Active', kind: 'checkbox', coerce: 'checkbox', rowGroup: 2 },
    { name: 'notes', label: 'Notes', kind: 'textarea' },
  ],
});

// CSV import page for a specific bank account. Two-stage: paste CSV → preview
// rows → confirm-import. Standard CSV format: Date,Description,Amount[,Balance].
// Date in YYYY-MM-DD or MM/DD/YYYY; Amount as a signed decimal.
app.get('/app/bank/:id/import', async (c) => {
  const cid = c.get('companyId')!;
  const acc = await c.env.DB.prepare('SELECT * FROM bank_accounts WHERE id = ? AND company_id = ?')
    .bind(c.req.param('id'), cid).first<any>();
  if (!acc) return c.notFound();
  const body = `
<div class="page-header">
  <h1 class="page-title">Import CSV · ${esc(acc.name)}</h1>
  <a href="/app/bank" class="btn btn-ghost">Back</a>
</div>
<div class="card" style="margin-bottom:1rem">
  <div class="card-title">CSV format</div>
  <div class="muted" style="font-size:0.85rem">Expected columns: <code>Date, Description, Amount</code> (optional <code>Balance</code>). Header row required. Amount is signed — negative for debits, positive for credits.</div>
  <pre style="background:var(--bg-elevated);border-radius:var(--radius);padding:12px;margin-top:8px;font-size:0.78rem;overflow:auto">Date,Description,Amount
2026-06-01,Office Depot,-89.42
2026-06-02,Stripe Payout,1240.00</pre>
</div>
<form id="f" class="card">
  <label class="field">CSV<textarea name="csv" rows="14" required placeholder="Paste CSV here…" style="font-family:'SF Mono',Menlo,monospace;font-size:0.82rem"></textarea></label>
  <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:0.75rem">
    <button type="submit" class="btn">Import</button>
  </div>
</form>
<script>
document.getElementById('f').addEventListener('submit', async function(ev){
  ev.preventDefault();
  const csv = ev.target.csv.value;
  try {
    const r = await window.fetchJSON('/api/bank-accounts/${esc(c.req.param('id'))}/import-csv', {
      method: 'POST', body: JSON.stringify({ csv }),
    });
    window.toast(\`Imported \${r.imported} transaction\${r.imported === 1 ? '' : 's'}\`, 'ok');
    setTimeout(() => location.href = '/app/bank/${esc(c.req.param('id'))}/match', 800);
  } catch (e) { window.toast(e.message || 'Import failed', 'err'); }
});
</script>`;
  return c.html(shell({ title: 'Import CSV', activeNav: 'bank', body, brand: 'BAP Cloud' }));
});

// CSV import endpoint — naive parser handles the 3-4 column standard format.
// Skips rows that don't parse to a valid (date, amount). Detects duplicates
// by (account_id, date, description, amount) tuple so re-importing the same
// statement doesn't double-up.
app.post('/api/bank-accounts/:id/import-csv', async (c) => {
  const cid = c.get('companyId')!;
  const accountId = c.req.param('id');
  const acc = await c.env.DB.prepare('SELECT id FROM bank_accounts WHERE id = ? AND company_id = ?')
    .bind(accountId, cid).first();
  if (!acc) return c.json({ error: 'Bank account not found' }, 404);
  const { csv }: any = await c.req.json();
  if (!csv || typeof csv !== 'string') return c.json({ error: 'CSV body required' }, 400);

  // Split lines; strip BOM; drop empty.
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return c.json({ error: 'CSV needs a header row and at least one data row' }, 400);

  // Parse the header to find column indexes — case-insensitive, allow
  // common synonyms (Memo/Description, Debit/Credit pair as well as a
  // single signed Amount column).
  const head = lines[0].split(',').map(s => s.trim().toLowerCase().replace(/^"|"$/g, ''));
  const idxDate = head.findIndex(h => h === 'date' || h === 'transaction date' || h === 'posting date');
  const idxDesc = head.findIndex(h => h === 'description' || h === 'memo' || h === 'payee' || h === 'name');
  const idxAmt  = head.findIndex(h => h === 'amount' || h === 'value');
  const idxDeb  = head.findIndex(h => h === 'debit' || h === 'withdrawal');
  const idxCre  = head.findIndex(h => h === 'credit' || h === 'deposit');
  const idxBal  = head.findIndex(h => h === 'balance' || h === 'running balance');
  if (idxDate < 0) return c.json({ error: 'CSV header missing a Date column' }, 400);
  if (idxAmt < 0 && idxDeb < 0 && idxCre < 0) return c.json({ error: 'CSV header missing an Amount (or Debit/Credit) column' }, 400);

  const normDate = (s: string): string | null => {
    s = s.trim().replace(/^"|"$/g, '');
    // YYYY-MM-DD passes through.
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // MM/DD/YYYY or M/D/YYYY → YYYY-MM-DD
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    return null;
  };
  const parseField = (cells: string[], i: number) => i >= 0 ? (cells[i] || '').replace(/^"|"$/g, '').trim() : '';
  const parseNum = (s: string): number => {
    if (!s) return 0;
    // Strip currency symbols, commas, parens (paren-wrapped = negative).
    let neg = false;
    s = s.trim();
    if (/^\(.+\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[$,\s]/g, '');
    const n = Number(s);
    if (!Number.isFinite(n)) return 0;
    return neg ? -n : n;
  };

  let imported = 0, skipped = 0;
  const stmts: D1PreparedStatement[] = [];
  for (let i = 1; i < lines.length; i++) {
    // VERY naive CSV split — doesn't handle quoted commas. Banks rarely emit
    // them in transaction CSVs; if you hit one, paste-edit it out for now.
    const cells = lines[i].split(',');
    const date = normDate(parseField(cells, idxDate));
    const desc = parseField(cells, idxDesc);
    let amount = 0;
    if (idxAmt >= 0) amount = parseNum(parseField(cells, idxAmt));
    else {
      const deb = parseNum(parseField(cells, idxDeb));
      const cre = parseNum(parseField(cells, idxCre));
      amount = cre - deb;  // credit positive, debit negative
    }
    if (!date || !Number.isFinite(amount) || amount === 0) { skipped++; continue; }
    const balanceAfter = idxBal >= 0 ? parseNum(parseField(cells, idxBal)) : null;
    // Dup detection: same account + date + description + amount.
    const dup = await c.env.DB.prepare(`
      SELECT id FROM bank_transactions
      WHERE bank_account_id = ? AND date = ? AND amount = ? AND COALESCE(description,'') = COALESCE(?,'')
    `).bind(accountId, date, amount, desc).first();
    if (dup) { skipped++; continue; }
    stmts.push(c.env.DB.prepare(`
      INSERT INTO bank_transactions (id, company_id, bank_account_id, date, description, amount, balance_after, imported_from)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'csv')
    `).bind(uuid(), cid, accountId, date, desc || null, amount, balanceAfter));
    imported++;
  }
  if (stmts.length > 0) await c.env.DB.batch(stmts);
  return c.json({ ok: true, imported, skipped });
});

// Reconciliation match page — shows unmatched bank txns alongside candidate
// expense/payment rows (within ±3 days, ±$0.01 amount-similarity). User
// clicks a candidate to confirm the match.
app.get('/app/bank/:id/match', async (c) => {
  const cid = c.get('companyId')!;
  const accountId = c.req.param('id');
  const acc = await c.env.DB.prepare('SELECT * FROM bank_accounts WHERE id = ? AND company_id = ?')
    .bind(accountId, cid).first<any>();
  if (!acc) return c.notFound();
  const txns = await c.env.DB.prepare(`
    SELECT id, date, description, amount FROM bank_transactions
    WHERE bank_account_id = ? AND is_reconciled = 0 ORDER BY date DESC LIMIT 50
  `).bind(accountId).all();
  const list = (txns.results as any[]) || [];

  const body = `
<div class="page-header">
  <h1 class="page-title">Match · ${esc(acc.name)}</h1>
  <a href="/app/bank" class="btn btn-ghost">Back</a>
</div>
${list.length === 0 ? `<div class="empty-state">All transactions matched. Import more or you're caught up.</div>` :
`<table class="data">
  <thead><tr><th>Date</th><th>Description</th><th class="num">Amount</th><th>Match candidates</th></tr></thead>
  <tbody>
    ${list.map((t: any) => `<tr>
      <td class="muted" style="font-family:'SF Mono',Menlo,monospace;font-size:0.78rem">${fmtDate(t.date)}</td>
      <td>${esc(t.description || '—')}</td>
      <td class="num" style="color:${Number(t.amount) < 0 ? 'var(--red)' : 'var(--green)'}">${fmtMoney(t.amount)}</td>
      <td><div id="cand-${esc(t.id)}" class="muted" style="font-size:0.78rem">Loading…</div></td>
    </tr>`).join('')}
  </tbody>
</table>`}
<script>
async function loadCandidates(){
  const els = document.querySelectorAll('[id^=cand-]');
  for (const el of els) {
    const id = el.id.replace('cand-', '');
    try {
      const r = await fetch('/api/bank-transactions/' + id + '/candidates', { credentials: 'same-origin' });
      const data = await r.json();
      if (!data.candidates || data.candidates.length === 0) {
        el.textContent = 'No candidates — create new expense?';
      } else {
        el.textContent = '';
        for (const cand of data.candidates) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn btn-ghost';
          btn.style.cssText = 'display:inline-block;margin:2px;padding:4px 8px;font-size:0.7rem';
          btn.textContent = cand.label;
          btn.addEventListener('click', () => match(id, cand.entity_type, cand.entity_id, btn));
          el.appendChild(btn);
        }
      }
    } catch { el.textContent = 'Load failed'; }
  }
}
async function match(txnId, entityType, entityId, btn) {
  btn.disabled = true; btn.textContent = 'Matching…';
  try {
    await window.fetchJSON('/api/bank-transactions/' + txnId + '/match', {
      method: 'POST', body: JSON.stringify({ entity_type: entityType, entity_id: entityId }),
    });
    window.toast('Matched', 'ok');
    btn.closest('tr').style.opacity = '0.4';
  } catch (e) { window.toast(e.message || 'Match failed', 'err'); btn.disabled = false; btn.textContent = 'Retry'; }
}
loadCandidates();
</script>`;
  return c.html(shell({ title: 'Bank Match', activeNav: 'bank', body, brand: 'BAP Cloud' }));
});

// Find candidate matches for a bank transaction. Looks for expenses,
// payments, and bills with amounts within $0.01 of the txn amount and
// dates within ±3 days.
app.get('/api/bank-transactions/:id/candidates', async (c) => {
  const cid = c.get('companyId')!;
  const txn = await c.env.DB.prepare('SELECT * FROM bank_transactions WHERE id = ? AND company_id = ?')
    .bind(c.req.param('id'), cid).first<any>();
  if (!txn) return c.json({ error: 'Not found' }, 404);
  const amount = Math.abs(Number(txn.amount));
  // 3-day date window.
  const d = new Date(txn.date + 'T00:00:00Z');
  const lo = new Date(d.getTime() - 3 * 86400_000).toISOString().slice(0, 10);
  const hi = new Date(d.getTime() + 3 * 86400_000).toISOString().slice(0, 10);
  const eps = 0.01;

  const candidates: Array<{ entity_type: string; entity_id: string; label: string }> = [];
  // Debit on the bank side (negative) usually pairs to an expense or bill payment.
  if (Number(txn.amount) < 0) {
    const exps = await c.env.DB.prepare(`
      SELECT id, description, date, amount FROM expenses
      WHERE company_id = ? AND date >= ? AND date <= ?
        AND ABS(amount - ?) < ?
      LIMIT 5
    `).bind(cid, lo, hi, amount, eps).all();
    for (const e of (exps.results as any[]) || []) {
      candidates.push({ entity_type: 'expense', entity_id: e.id, label: `Expense: ${e.description || ''}` });
    }
  } else {
    // Credit usually pairs to a payment.
    const pays = await c.env.DB.prepare(`
      SELECT id, date, amount FROM payments
      WHERE company_id = ? AND date >= ? AND date <= ?
        AND ABS(amount - ?) < ?
      LIMIT 5
    `).bind(cid, lo, hi, amount, eps).all();
    for (const p of (pays.results as any[]) || []) {
      candidates.push({ entity_type: 'payment', entity_id: p.id, label: `Payment: ${fmtMoney(p.amount)}` });
    }
  }
  return c.json({ candidates });
});

// Confirm a match — stamps the txn and increments the account's reconciled
// balance. NOT reversible from this endpoint; un-matching is a separate PUT.
app.post('/api/bank-transactions/:id/match', async (c) => {
  const cid = c.get('companyId')!;
  const { entity_type, entity_id }: any = await c.req.json();
  if (!entity_type || !entity_id) return c.json({ error: 'entity_type and entity_id required' }, 400);
  const r = await c.env.DB.prepare(`
    UPDATE bank_transactions
    SET matched_entity_type = ?, matched_entity_id = ?, is_reconciled = 1
    WHERE id = ? AND company_id = ?
  `).bind(entity_type, entity_id, c.req.param('id'), cid).run();
  if ((r as any).meta?.changes === 0) return c.json({ error: 'Not found' }, 404);
  await logAudit(c.env, cid, c.get('userId') as any, {
    action: 'reconcile', entity_type: 'bank_transaction', entity_id: c.req.param('id'),
    description: `Matched to ${entity_type} ${entity_id}`,
  });
  return c.json({ ok: true });
});

// ─── Email send (Cloudflare MailChannels) ────────────────────────────
// MailChannels accepts POST /send for any Worker without auth — that's the
// official Cloudflare-recommended path for Worker-originated transactional
// mail. DKIM/SPF MUST be configured on the sending domain; without it the
// mail goes straight to spam (or gets rejected).
//
// Configuring DKIM for accounting.rmpgutah.us is a one-time DNS step the
// user does separately (TXT record per Cloudflare docs). This endpoint
// doesn't gate on that — it just sends and logs whatever the API returns.

app.get('/app/email', async (c) => {
  const cid = c.get('companyId')!;
  const log = await c.env.DB.prepare(`
    SELECT id, to_email, subject, status, sent_at, related_entity_type, related_entity_id, error_message
    FROM email_log WHERE company_id = ? ORDER BY sent_at DESC LIMIT 100
  `).bind(cid).all();
  const items = (log.results as any[]) || [];
  const body = `
<div class="page-header">
  <h1 class="page-title">Email</h1>
  <a href="/app/email/new" class="btn">+ Send Email</a>
</div>
<table class="data">
  <thead><tr><th>Sent</th><th>To</th><th>Subject</th><th>Status</th><th>Related</th></tr></thead>
  <tbody>
    ${items.length === 0 ? `<tr><td colspan="5" class="empty-state">No emails sent yet.</td></tr>` :
      items.map((m: any) => `<tr>
        <td class="muted" style="font-family:'SF Mono',Menlo,monospace;font-size:0.78rem">${esc(m.sent_at)}</td>
        <td>${esc(m.to_email)}</td>
        <td>${esc(m.subject || '—')}</td>
        <td><span class="badge ${m.status === 'sent' ? 'badge-green' : m.status === 'failed' ? 'badge-red' : 'badge-amber'}">${esc(m.status)}</span>${m.error_message ? `<div class="muted" style="font-size:0.7rem">${esc(m.error_message)}</div>` : ''}</td>
        <td class="muted" style="font-size:0.78rem">${m.related_entity_type ? esc(m.related_entity_type) + ' ' + esc(String(m.related_entity_id || '').slice(0, 8)) : '—'}</td>
      </tr>`).join('')}
  </tbody>
</table>`;
  return c.html(shell({ title: 'Email', activeNav: 'email', body, brand: 'BAP Cloud' }));
});

app.get('/app/email/new', (c) => {
  const body = `
<div class="page-header">
  <h1 class="page-title">Send Email</h1>
  <a href="/app/email" class="btn btn-ghost">Back</a>
</div>
<form id="f" class="card grid" style="gap:1rem">
  <div class="grid grid-2" style="gap:1rem">
    <label class="field">To<input name="to" type="email" required placeholder="client@example.com"></label>
    <label class="field">From (verified domain only)<input name="from" type="email" required value="noreply@accounting.rmpgutah.us"></label>
  </div>
  <label class="field">Subject<input name="subject" required maxlength="200"></label>
  <label class="field">Body<textarea name="body" rows="10" required></textarea></label>
  <div class="muted" style="font-size:0.78rem">⚠ DKIM/SPF must be configured on the sending domain or this will land in spam. See Cloudflare MailChannels docs.</div>
  <div style="display:flex;justify-content:flex-end"><button type="submit" class="btn">Send</button></div>
</form>
<script>
document.getElementById('f').addEventListener('submit', async function(ev){
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const payload = Object.fromEntries(fd.entries());
  const btn = ev.target.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    await window.fetchJSON('/api/email/send', { method: 'POST', body: JSON.stringify(payload) });
    window.toast('Email sent', 'ok');
    setTimeout(() => location.href = '/app/email', 600);
  } catch (e) { window.toast(e.message || 'Send failed', 'err'); btn.disabled = false; btn.textContent = 'Send'; }
});
</script>`;
  return c.html(shell({ title: 'Send Email', activeNav: 'email', body, brand: 'BAP Cloud' }));
});

app.post('/api/email/send', async (c) => {
  const cid = c.get('companyId')!;
  const uid = c.get('userId') as string;
  const { to, from, subject, body, related_entity_type, related_entity_id }: any = await c.req.json();
  if (!to || !subject || !body) return c.json({ error: 'to, subject, body required' }, 400);
  // Single recipient for simplicity; MailChannels supports multi.
  const mcPayload = {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: from || 'noreply@accounting.rmpgutah.us' },
    subject,
    content: [{ type: 'text/plain', value: body }],
  };
  let status = 'sent', errorMessage = '';
  try {
    const res = await fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mcPayload),
    });
    if (!res.ok) {
      status = 'failed';
      errorMessage = (await res.text()).slice(0, 500);
    }
  } catch (e: any) {
    status = 'failed';
    errorMessage = (e?.message || 'Network error').slice(0, 500);
  }
  await c.env.DB.prepare(`
    INSERT INTO email_log (id, company_id, user_id, to_email, from_email, subject, body_preview,
      related_entity_type, related_entity_id, status, error_message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(uuid(), cid, uid, to, from || null, subject, String(body).slice(0, 500),
          related_entity_type || null, related_entity_id || null, status, errorMessage || null).run();
  await logAudit(c.env, cid, uid, {
    action: 'email_sent', entity_type: 'email', description: `${subject} → ${to}`,
  });
  if (status === 'failed') return c.json({ error: errorMessage || 'Send failed' }, 502);
  return c.json({ ok: true });
});

// ─── Scheduled handler — daily cron ──────────────────────────────────
// Wrangler's cron trigger calls this. Runs every day at 06:00 UTC.
const handler = {
  fetch: app.fetch.bind(app),
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduledTasks(env));
  },
};

async function runScheduledTasks(env: Env): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  try {
    // 1. Instantiate due recurring_templates.
    const due = await env.DB.prepare(`
      SELECT * FROM recurring_templates
      WHERE is_active = 1 AND next_date <= ?
    `).bind(today).all();
    for (const tmpl of (due.results as any[]) || []) {
      try {
        const data: any = tmpl.template_data ? JSON.parse(tmpl.template_data) : {};
        const id = uuid();
        if (tmpl.type === 'expense' && data.amount) {
          await env.DB.prepare(`
            INSERT INTO expenses (id, company_id, vendor_id, category_id, date, amount, tax_amount,
              description, payment_method, status, currency, is_recurring, recurring_template_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
          `).bind(id, tmpl.company_id, data.vendor_id || null, data.category_id || null,
                  today, Number(data.amount) || 0, Number(data.tax_amount) || 0,
                  data.description || tmpl.name, data.payment_method || null,
                  'pending', data.currency || 'USD', tmpl.id).run();
        }
        // (invoice/bill instantiation would go here — skipped for now)
        // Bump next_date by the frequency.
        const next = nextRecurringDate(today, tmpl.frequency);
        await env.DB.prepare(`
          UPDATE recurring_templates SET last_run_date = ?, next_date = ?, updated_at = datetime('now')
          WHERE id = ?
        `).bind(today, next, tmpl.id).run();
        await logAudit(env, tmpl.company_id, null, {
          action: 'recurring_run', entity_type: 'recurring_template', entity_id: tmpl.id,
          description: `Instantiated ${tmpl.type} from "${tmpl.name}"`,
        });
      } catch (err: any) {
        await logAudit(env, tmpl.company_id, null, {
          action: 'recurring_failed', entity_type: 'recurring_template', entity_id: tmpl.id,
          description: `Failed: ${err?.message || 'unknown'}`,
        });
      }
    }

    // 2. Mark overdue invoices (due_date < today AND status='sent').
    await env.DB.prepare(`
      UPDATE invoices SET status = 'overdue', updated_at = datetime('now')
      WHERE due_date < ? AND status = 'sent'
    `).bind(today).run();

    // 3. Low-inventory notifications — one per item that just crossed.
    const lowStock = await env.DB.prepare(`
      SELECT id, company_id, name, quantity_on_hand, reorder_point
      FROM inventory_items
      WHERE reorder_point > 0 AND quantity_on_hand <= reorder_point AND status = 'active'
    `).all();
    for (const it of (lowStock.results as any[]) || []) {
      // Suppress duplicates: only insert if no unread low-stock notif for this item.
      const existing = await env.DB.prepare(`
        SELECT id FROM notifications
        WHERE company_id = ? AND kind = 'low_inventory' AND link = ? AND is_read = 0
      `).bind(it.company_id, `/app/inventory/${it.id}`).first();
      if (existing) continue;
      await env.DB.prepare(`
        INSERT INTO notifications (id, company_id, user_id, kind, title, body, link)
        VALUES (?, ?, NULL, 'low_inventory', ?, ?, ?)
      `).bind(uuid(), it.company_id,
              `Low stock: ${it.name}`,
              `On hand: ${it.quantity_on_hand} (reorder at ${it.reorder_point})`,
              `/app/inventory/${it.id}`).run();
    }
  } catch (err) {
    console.error('Scheduled task error:', err);
  }
}

function nextRecurringDate(from: string, freq: string): string {
  const d = new Date(from + 'T00:00:00Z');
  switch (freq) {
    case 'weekly':    d.setUTCDate(d.getUTCDate() + 7); break;
    case 'biweekly':  d.setUTCDate(d.getUTCDate() + 14); break;
    case 'monthly':   d.setUTCMonth(d.getUTCMonth() + 1); break;
    case 'quarterly': d.setUTCMonth(d.getUTCMonth() + 3); break;
    case 'annual':    d.setUTCFullYear(d.getUTCFullYear() + 1); break;
    default:          d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return d.toISOString().slice(0, 10);
}

export default handler;
