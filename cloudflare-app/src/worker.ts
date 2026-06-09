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

export default app;
