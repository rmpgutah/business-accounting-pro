/**
 * Portal API — public-facing endpoints for invoice recipients.
 *
 * Authentication: token-only. Every endpoint takes :token (UUID) in the path
 * and looks it up in `invoice_tokens`. No session, no JWT, no cookies.
 *
 * Endpoints:
 *   GET  /portal/:token              — SPA shell (HTML)
 *   GET  /portal/:token/data         — invoice + lineItems + company (PUBLIC fields only)
 *   GET  /portal/:token/receipt      — printable HTML receipt
 *   GET  /portal/:token/pay-link     — { payment_link_url: string | null }    (#9)
 *   POST /portal/:token/dispute      — { reason } -> { ok, dispute_id }       (#10)
 *   GET  /portal/:token/comments     — list of public comments                (#11)
 *   POST /portal/:token/comments     — { body, sender_name, sender_email }    (#12)
 *   GET  /portal/:token/payment-schedule — milestones for invoice             (#13)
 *
 * Rate limits (in addition to the global apiLimiter):
 *   - tokenLookupLimiter: 60/min per IP on every /portal/:token/* path
 *   - postSubmitLimiter:  5/hour per IP+token on dispute and comment POSTs
 *
 * Public response fields (NEVER return these private columns):
 *   invoices: internal_notes, created_by, cost_basis, margin, stripe_*
 *   companies: tax_id, stripe_customer_id, internal_notes, created_by
 *
 * On success: { ok: true, ...data }. On failure:
 *   400 { error } malformed body
 *   404 { error } unknown token
 *   410 { error } expired token
 *   429 { error } rate-limited
 *   403 { error } origin mismatch (CSRF)
 *
 * CSRF defense (#5): POST endpoints validate Origin header against
 * PORTAL_PUBLIC_ORIGIN (or PUBLIC_BASE_URL). Falls back to same-host check.
 */
import { Router, Request, Response, NextFunction } from 'express';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from 'express-rate-limit';
import { db } from '../db';

export const portalRouter = Router();

// ---------- Migrations (idempotent) ---------- (#14)
function ensurePortalTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS portal_disputes (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      invoice_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      submitted_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      ip TEXT,
      status TEXT NOT NULL DEFAULT 'open'
    );
    CREATE INDEX IF NOT EXISTS idx_portal_disputes_invoice
      ON portal_disputes(invoice_id, submitted_at);

    CREATE TABLE IF NOT EXISTS portal_comments (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      invoice_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      sender_email TEXT,
      body TEXT NOT NULL,
      ip TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      is_business_reply INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_portal_comments_token_created
      ON portal_comments(token, created_at);
    CREATE INDEX IF NOT EXISTS idx_portal_comments_invoice_created
      ON portal_comments(invoice_id, created_at);

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      company_id TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_log_entity
      ON audit_log(entity_type, entity_id, created_at);
  `);
}
try { ensurePortalTables(); } catch { /* db init may run later; retry on use */ }

// ---------- Rate limiters ----------
// (#1) Per-IP rate limit for token validation paths — 60/min.
export const tokenLookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many portal requests, please slow down' },
});

// (#8) Per-IP+token limit for write endpoints — 5/hour.
const postSubmitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => `${req.ip}|${req.params.token || ''}`,
  message: { error: 'Too many submissions, please try again later' },
});

// ---------- Helpers ----------
type TokenRow = { invoice_id: string; company_id: string; expires_at: number };

function lookupToken(token: string): TokenRow | null {
  // Token compare delegated to SQLite's bytewise WHERE — no app-level
  // string compare exists elsewhere, so no timing channel to harden. (#2)
  const row = db.prepare(
    `SELECT invoice_id, company_id, expires_at FROM invoice_tokens WHERE token = ?`
  ).get(token) as TokenRow | undefined;
  return row || null;
}

// (#3) Single source of truth for token lookup + expiry enforcement.
function resolveToken(req: Request, res: Response): TokenRow | null {
  const row = lookupToken(String(req.params.token));
  if (!row) {
    res.status(404).json({ error: 'Invoice not found' });
    return null;
  }
  if (row.expires_at < Math.floor(Date.now() / 1000)) {
    res.status(410).json({ error: 'Link expired' });
    return null;
  }
  return row;
}

// (#5) Origin / Referer check for POST endpoints.
function checkOrigin(req: Request): boolean {
  const origin = (req.headers.origin as string) || (req.headers.referer as string) || '';
  if (!origin) return false;
  let originHost: string;
  try { originHost = new URL(origin).host; } catch { return false; }

  const envAllowed = (process.env.PORTAL_PUBLIC_ORIGIN || process.env.PUBLIC_BASE_URL || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  for (const a of envAllowed) {
    try { if (new URL(a).host === originHost) return true; } catch { /* ignore */ }
  }
  const hostHdr = (req.headers.host as string) || '';
  if (hostHdr && hostHdr === originHost) return true;
  return false;
}

function originGuard(req: Request, res: Response, next: NextFunction) {
  if (!checkOrigin(req)) {
    res.status(403).json({ error: 'Origin not allowed' });
    return;
  }
  next();
}

// (#4) Strip private fields from invoice/company before returning.
const PRIVATE_INVOICE_FIELDS = new Set([
  'internal_notes', 'created_by', 'cost_basis', 'margin',
  'stripe_customer_id', 'stripe_charge_id', 'stripe_invoice_id',
  'stripe_payment_intent_id',
]);
const PRIVATE_COMPANY_FIELDS = new Set([
  'tax_id', 'stripe_customer_id', 'stripe_account_id',
  'internal_notes', 'created_by',
]);
const PRIVATE_LINE_ITEM_FIELDS = new Set(['cost_basis', 'margin', 'created_by']);

function stripFields<T extends Record<string, any>>(
  row: T | undefined | null,
  blocklist: Set<string>,
): T | null {
  if (!row) return null;
  const out: Record<string, any> = {};
  for (const k of Object.keys(row)) {
    if (!blocklist.has(k)) out[k] = row[k];
  }
  return out as T;
}

// (#7) Comment input validators.
function validEmail(s: string): boolean {
  if (typeof s !== 'string' || s.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
function sanitizePlainText(s: string, max: number): string {
  // Strip HTML tags and ASCII control chars; cap length.
  return String(s)
    // eslint-disable-next-line no-control-regex
    .replace(/<[^>]*>/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]/g, '')
    .slice(0, max)
    .trim();
}

// (#6) Audit-log helper.
function logPortalView(invoiceId: string, companyId: string, req: Request) {
  try {
    db.prepare(
      `INSERT INTO audit_log (id, action, entity_type, entity_id, company_id, metadata)
       VALUES (?, 'portal_view', 'invoice', ?, ?, ?)`
    ).run(uuidv4(), invoiceId, companyId, JSON.stringify({ ip: req.ip || null, ua: req.headers['user-agent'] || null }));
  } catch (e) {
    console.warn('portal audit_log write failed:', (e as Error).message);
  }
}

// Per-IP token-lookup rate limit on every /:token/<sub> path.
portalRouter.use('/:token/:_sub', tokenLookupLimiter);

portalRouter.get('/:token/data', (req, res) => {
  ensurePortalTables();
  const tokenRow = resolveToken(req, res);
  if (!tokenRow) return;

  const invoiceRaw = db.prepare(`SELECT * FROM invoices WHERE id = ?`).get(tokenRow.invoice_id) as any;
  if (!invoiceRaw) return res.status(404).json({ error: 'Invoice not found in replica' });

  const lineItemsRaw = db.prepare(
    `SELECT * FROM invoice_line_items WHERE invoice_id = ?`
  ).all(tokenRow.invoice_id) as any[];

  const companyRaw = db.prepare(`SELECT * FROM companies WHERE id = ?`).get(tokenRow.company_id) as any;

  const invoice = stripFields(invoiceRaw, PRIVATE_INVOICE_FIELDS);
  const lineItems = lineItemsRaw.map(li => stripFields(li, PRIVATE_LINE_ITEM_FIELDS));
  const company = stripFields(companyRaw, PRIVATE_COMPANY_FIELDS);

  // (#6) Record portal view for activity timeline.
  logPortalView(tokenRow.invoice_id, tokenRow.company_id, req);

  res.json({ ok: true, invoice, lineItems, company });
});

portalRouter.get('/:token/receipt', (req, res) => {
  const tokenRow = resolveToken(req, res);
  if (!tokenRow) return;

  const invoice = db.prepare(`SELECT * FROM invoices WHERE id = ?`).get(tokenRow.invoice_id) as any;
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const company = db.prepare(`SELECT * FROM companies WHERE id = ?`).get(tokenRow.company_id) as any;
  const payments = db.prepare(
    `SELECT * FROM payments WHERE invoice_id = ? ORDER BY date DESC`
  ).all(tokenRow.invoice_id);

  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
  const companyName = company?.name || 'Company';
  const companyAddr = [company?.address_line1, company?.city, company?.state, company?.zip].filter(Boolean).join(', ');

  const paymentRows = (payments as any[]).map((p: any) =>
    `<tr><td style="padding:8px 12px;border:1px solid #ddd;">${p.date || ''}</td>
     <td style="padding:8px 12px;border:1px solid #ddd;text-align:right;font-family:monospace;">${fmt(p.amount)}</td>
     <td style="padding:8px 12px;border:1px solid #ddd;">${p.payment_method || ''}</td>
     <td style="padding:8px 12px;border:1px solid #ddd;font-family:monospace;">${p.reference || '—'}</td></tr>`
  ).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 40px auto; padding: 0 20px; color: #111; }
    h1 { font-size: 22px; margin-bottom: 4px; }
    .meta { font-size: 13px; color: #555; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { background: #f0f0f0; padding: 8px 12px; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; border: 1px solid #ddd; }
    .total { margin-top: 20px; text-align: right; font-size: 16px; font-weight: 700; }
    .badge { display: inline-block; padding: 3px 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; border-radius: 3px; }
    .paid { background: #dcfce7; color: #166534; }
    .partial { background: #f3e8ff; color: #6b21a8; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #ddd; font-size: 11px; color: #777; text-align: center; }
  </style></head><body>
    <h1>Payment Receipt</h1>
    <div class="meta">
      ${companyName}<br>${companyAddr || ''}<br>
      Invoice #${invoice.invoice_number} &middot;
      <span class="badge ${invoice.status === 'paid' ? 'paid' : 'partial'}">${invoice.status === 'paid' ? 'Paid in Full' : 'Partial Payment'}</span>
    </div>
    <table>
      <thead><tr><th>Date</th><th style="text-align:right">Amount</th><th>Method</th><th>Reference</th></tr></thead>
      <tbody>${paymentRows || '<tr><td colspan="4" style="padding:12px;text-align:center;color:#999;">No payments recorded</td></tr>'}</tbody>
    </table>
    <div class="total">Total Paid: ${fmt(invoice.amount_paid)} of ${fmt(invoice.total)}</div>
    ${invoice.status === 'paid' ? '<p style="color:#166534;font-weight:600;margin-top:12px;text-align:right;">This invoice has been paid in full. Thank you.</p>' : `<p style="color:#6b21a8;margin-top:12px;text-align:right;">Remaining balance: ${fmt(invoice.total - invoice.amount_paid)}</p>`}
    <div class="footer">Receipt generated by ${companyName} &middot; ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
  </body></html>`;

  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

// ---------- GET /:token/pay-link ---------- (#9)
portalRouter.get('/:token/pay-link', (req, res) => {
  const tokenRow = resolveToken(req, res);
  if (!tokenRow) return;

  let payment_link_url: string | null = null;
  try {
    const row = db.prepare(
      `SELECT payment_link_url FROM invoice_payment_links WHERE invoice_id = ? ORDER BY created_at DESC LIMIT 1`
    ).get(tokenRow.invoice_id) as { payment_link_url?: string } | undefined;
    if (row?.payment_link_url) payment_link_url = row.payment_link_url;
  } catch { /* table may not exist */ }

  if (!payment_link_url) {
    try {
      const row = db.prepare(
        `SELECT value FROM stripe_cache WHERE key = ?`
      ).get(`payment_link:${tokenRow.invoice_id}`) as { value?: string } | undefined;
      if (row?.value) {
        try {
          const parsed = JSON.parse(row.value);
          payment_link_url = parsed?.url || parsed?.payment_link_url || null;
        } catch { payment_link_url = row.value; }
      }
    } catch { /* table may not exist */ }
  }

  res.json({ ok: true, payment_link_url });
});

// ---------- POST /:token/dispute ---------- (#10)
portalRouter.post('/:token/dispute', originGuard, postSubmitLimiter, (req, res) => {
  ensurePortalTables();
  const tokenRow = resolveToken(req, res);
  if (!tokenRow) return;

  const reasonRaw = req.body?.reason;
  if (typeof reasonRaw !== 'string' || !reasonRaw.trim()) {
    return res.status(400).json({ error: 'reason is required' });
  }
  const reason = sanitizePlainText(reasonRaw, 5000);
  if (!reason) return res.status(400).json({ error: 'reason is empty after sanitization' });

  const id = uuidv4();
  db.prepare(
    `INSERT INTO portal_disputes (id, token, invoice_id, company_id, reason, ip, status)
     VALUES (?, ?, ?, ?, ?, ?, 'open')`
  ).run(id, req.params.token, tokenRow.invoice_id, tokenRow.company_id, reason, req.ip || null);

  try {
    db.prepare(
      `INSERT INTO audit_log (id, action, entity_type, entity_id, company_id, metadata)
       VALUES (?, 'portal_dispute', 'invoice', ?, ?, ?)`
    ).run(uuidv4(), tokenRow.invoice_id, tokenRow.company_id, JSON.stringify({ ip: req.ip || null, dispute_id: id }));
  } catch { /* ignore */ }

  res.json({ ok: true, dispute_id: id });
});

// ---------- GET /:token/comments ---------- (#11)
portalRouter.get('/:token/comments', (req, res) => {
  ensurePortalTables();
  const tokenRow = resolveToken(req, res);
  if (!tokenRow) return;

  const rows = db.prepare(
    `SELECT sender_name, body, created_at, is_business_reply
       FROM portal_comments
      WHERE invoice_id = ?
      ORDER BY created_at ASC
      LIMIT 100`
  ).all(tokenRow.invoice_id) as any[];

  res.json({ ok: true, comments: rows });
});

// ---------- POST /:token/comments ---------- (#12)
portalRouter.post('/:token/comments', originGuard, postSubmitLimiter, (req, res) => {
  ensurePortalTables();
  const tokenRow = resolveToken(req, res);
  if (!tokenRow) return;

  const { body, sender_name, sender_email } = req.body || {};
  if (typeof body !== 'string' || !body.trim()) {
    return res.status(400).json({ error: 'body is required' });
  }
  if (typeof sender_name !== 'string' || !sender_name.trim()) {
    return res.status(400).json({ error: 'sender_name is required' });
  }
  if (typeof sender_email !== 'string' || !validEmail(sender_email)) {
    return res.status(400).json({ error: 'sender_email is invalid' });
  }
  const cleanName = sanitizePlainText(sender_name, 100);
  const cleanBody = sanitizePlainText(body, 2000);
  if (!cleanName || !cleanBody) {
    return res.status(400).json({ error: 'name or body is empty after sanitization' });
  }

  const id = uuidv4();
  db.prepare(
    `INSERT INTO portal_comments
       (id, token, invoice_id, company_id, sender_name, sender_email, body, ip, is_business_reply)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
  ).run(
    id, req.params.token, tokenRow.invoice_id, tokenRow.company_id,
    cleanName, sender_email.toLowerCase(), cleanBody, req.ip || null,
  );

  try {
    db.prepare(
      `INSERT INTO audit_log (id, action, entity_type, entity_id, company_id, metadata)
       VALUES (?, 'portal_comment', 'invoice', ?, ?, ?)`
    ).run(uuidv4(), tokenRow.invoice_id, tokenRow.company_id, JSON.stringify({ ip: req.ip || null, comment_id: id }));
  } catch { /* ignore */ }

  res.json({ ok: true, comment_id: id });
});

// ---------- GET /:token/payment-schedule ---------- (#13)
portalRouter.get('/:token/payment-schedule', (req, res) => {
  const tokenRow = resolveToken(req, res);
  if (!tokenRow) return;

  let milestones: any[] = [];
  try {
    milestones = db.prepare(
      `SELECT id, milestone_label, due_date, amount, paid
         FROM invoice_payment_schedule
        WHERE invoice_id = ?
        ORDER BY sort_order ASC`
    ).all(tokenRow.invoice_id) as any[];
  } catch { milestones = []; }

  res.json({ ok: true, milestones });
});

// SPA fallback — must remain last so deeper routes match first.
portalRouter.get('/:token', (_req, res) => {
  res.sendFile('index.html', {
    root: path.join(__dirname, '..', '..', 'portal', 'dist')
  });
});
