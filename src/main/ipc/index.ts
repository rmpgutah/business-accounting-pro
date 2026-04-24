import { ipcMain, BrowserWindow, dialog, shell } from 'electron';
import { v4 as uuid } from 'uuid';
import * as db from '../database';
import crypto from 'crypto';
import { syncPush } from '../sync';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { generateInvoicePDF, buildInvoiceHTML } from '../services/pdf-generator';
import { sendInvoiceEmail } from '../services/email-sender';
import { registerStripeIpc } from '../integrations/stripe';
import { processRecurringTemplates, getLastProcessedAt, getRecurringHistory } from '../services/recurring-processor';
import { runNotificationChecks, getNotificationPreferences, updateNotificationPreferences } from '../services/notification-engine';
import {
  openPrintPreview,
  saveHTMLAsPDF,
  printHTML,
  htmlToPDFBuffer,
  buildPdfFilename,
  openPathInOS,
  revealInFolder,
  type PDFOptions,
} from '../services/print-preview';
import { promises as fsp } from 'fs';
import { evaluateRules, mergePatches, rulesAppliedSummary } from '../rules';
import http from 'http';
import https from 'https';

// ─── Server Sync Config ──────────────────────────────────
const SYNC_SERVER = process.env.SYNC_SERVER_URL || 'https://accounting.rmpgutah.us';

// Debounced auto-backup: waits 30s after last write, then uploads DB to server
let autoBackupTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAutoBackup() {
  if (autoBackupTimer) clearTimeout(autoBackupTimer);
  autoBackupTimer = setTimeout(async () => {
    try {
      const dbPath = db.getDbPath();
      if (!fs.existsSync(dbPath)) return;
      try { db.getDb().pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}

      const fileData = fs.readFileSync(dbPath);
      const email = getLastLoginEmail();
      if (!email) return;

      const secret = process.env.SYNC_SECRET || 'bap-sync-default';
      const signature = crypto.createHmac('sha256', secret).update(fileData).digest('hex');

      const url = new URL(`${SYNC_SERVER}/api/backup/upload`);
      const isHttps = url.protocol === 'https:';
      const transport = isHttps ? https : http;

      const req = transport.request({
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': fileData.length,
          'x-bap-signature': signature,
          'x-bap-email': email,
        },
      }, (res) => {
        let body = '';
        res.on('data', (chunk: string) => body += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            console.log('Auto-backup uploaded successfully');
          } else {
            console.warn('Auto-backup response:', res.statusCode, body);
          }
        });
      });
      req.on('error', (err) => console.warn('Auto-backup failed (network):', err.message));
      req.write(fileData);
      req.end();
    } catch (err) {
      console.warn('Auto-backup error:', err);
    }
  }, 30000); // 30 second debounce
}

let _lastLoginEmail: string | null = null;
function setLastLoginEmail(email: string) { _lastLoginEmail = email; }
function getLastLoginEmail(): string | null { return _lastLoginEmail; }

// Helper: download backup from server
function downloadBackup(email: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const url = new URL(`${SYNC_SERVER}/api/backup/download/${encodeURIComponent(email)}`);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const req = transport.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'GET',
    }, (res) => {
      if (res.statusCode !== 200) { resolve(null); return; }
      const ct = res.headers['content-type'] || '';
      if (ct.includes('text/html') || ct.includes('text/plain')) { res.resume(); resolve(null); return; }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        // Validate SQLite magic header before accepting
        const SQLITE_MAGIC = Buffer.from('SQLite format 3\0');
        if (buf.length < 16 || !buf.slice(0, 16).equals(SQLITE_MAGIC)) { resolve(null); return; }
        resolve(buf);
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

// Helper: register user on server (fire-and-forget)
function serverRegister(email: string, password: string, displayName: string, userId: string) {
  try {
    const payload = JSON.stringify({ email, password, displayName, userId });
    const url = new URL(`${SYNC_SERVER}/api/auth/register`);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const req = transport.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let body = '';
      res.on('data', (c: string) => body += c);
      res.on('end', () => console.log('Server register:', res.statusCode, body));
    });
    req.on('error', (err) => console.warn('Server register failed:', err.message));
    req.write(payload);
    req.end();
  } catch (err) {
    console.warn('Server register error:', err);
  }
}

// ─── CSV Helpers (shared by import/export handlers) ──────
function escapeCSVField(val: any): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  return str.includes(',') || str.includes('"') || str.includes('\n')
    ? `"${str.replace(/"/g, '""')}"`
    : str;
}

function rowsToCSV(rows: any[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  return [
    headers.join(','),
    ...rows.map(row => headers.map(h => escapeCSVField(row[h])).join(',')),
  ].join('\n');
}

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === '\n' && !inQuotes) {
      lines.push(current);
      current = '';
    } else if (ch === '\r' && !inQuotes) {
      // skip carriage returns
    } else {
      current += ch;
    }
  }
  if (current) lines.push(current);

  const splitLine = (line: string): string[] => {
    const fields: string[] = [];
    let field = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (q && line[i + 1] === '"') { field += '"'; i++; }
        else q = !q;
      } else if (c === ',' && !q) {
        fields.push(field);
        field = '';
      } else {
        field += c;
      }
    }
    fields.push(field);
    return fields;
  };

  const headers = lines.length > 0 ? splitLine(lines[0]) : [];
  const rows = lines.slice(1).filter(l => l.trim()).map(splitLine);
  return { headers, rows };
}

// ─── Password Hashing (pbkdf2 — no external deps) ──────
function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, s, 100000, 64, 'sha512').toString('hex');
  return { hash: `${s}:${hash}`, salt: s };
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const check = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return hash === check;
}

// ─── Category Seed Definitions ──────────────────────────
const DEFAULT_CATEGORIES: Array<{ name: string; type: 'expense' | 'income'; color: string; icon: string; description: string }> = [
  // Office & Administration
  { name: 'Office Supplies',                type: 'expense', color: '#6366f1', icon: '📎', description: 'Pens, paper, binders, and general office supplies' },
  { name: 'Postage & Shipping',             type: 'expense', color: '#6366f1', icon: '📦', description: 'Stamps, courier services, and shipping costs' },
  { name: 'Printing & Copying',             type: 'expense', color: '#6366f1', icon: '🖨️', description: 'Print and photocopy expenses' },
  { name: 'Software Subscriptions',         type: 'expense', color: '#6366f1', icon: '💻', description: 'SaaS tools, apps, and software licenses' },
  { name: 'Computer Equipment',             type: 'expense', color: '#6366f1', icon: '🖥️', description: 'Laptops, desktops, peripherals, and accessories' },
  { name: 'Office Furniture',               type: 'expense', color: '#6366f1', icon: '🪑', description: 'Desks, chairs, shelving, and office fixtures' },
  { name: 'Phone & Internet',               type: 'expense', color: '#6366f1', icon: '📱', description: 'Business phone lines and internet service' },
  { name: 'Web Hosting',                    type: 'expense', color: '#6366f1', icon: '🌐', description: 'Domain registration and web hosting fees' },
  { name: 'Cloud Services',                 type: 'expense', color: '#6366f1', icon: '☁️', description: 'Cloud storage, AWS, Azure, GCP, and similar services' },
  { name: 'IT Support',                     type: 'expense', color: '#6366f1', icon: '🔧', description: 'Technical support and managed IT services' },
  // Travel & Transport
  { name: 'Airfare',                        type: 'expense', color: '#f59e0b', icon: '✈️', description: 'Business flights and airline tickets' },
  { name: 'Hotel & Lodging',                type: 'expense', color: '#f59e0b', icon: '🏨', description: 'Hotel stays and temporary accommodations' },
  { name: 'Car Rental',                     type: 'expense', color: '#f59e0b', icon: '🚗', description: 'Rental vehicles for business travel' },
  { name: 'Mileage & Fuel',                 type: 'expense', color: '#f59e0b', icon: '⛽', description: 'Personal vehicle mileage reimbursement and fuel costs' },
  { name: 'Parking & Tolls',                type: 'expense', color: '#f59e0b', icon: '🅿️', description: 'Parking fees and toll charges' },
  { name: 'Meals & Entertainment (Travel)', type: 'expense', color: '#f59e0b', icon: '🍽️', description: 'Meals during business travel' },
  { name: 'Public Transit',                 type: 'expense', color: '#f59e0b', icon: '🚇', description: 'Subway, bus, and public transportation' },
  { name: 'Rideshare & Taxi',               type: 'expense', color: '#f59e0b', icon: '🚕', description: 'Uber, Lyft, and taxi fares' },
  // Marketing & Sales
  { name: 'Advertising',                    type: 'expense', color: '#ec4899', icon: '📣', description: 'General advertising and promotional campaigns' },
  { name: 'Social Media Ads',               type: 'expense', color: '#ec4899', icon: '📱', description: 'Facebook, Instagram, LinkedIn, and other paid social ads' },
  { name: 'Print Materials',                type: 'expense', color: '#ec4899', icon: '🗞️', description: 'Brochures, flyers, business cards, and print ads' },
  { name: 'Trade Shows & Events',           type: 'expense', color: '#ec4899', icon: '🎪', description: 'Conference fees, booth costs, and event sponsorships' },
  { name: 'Sponsorships',                   type: 'expense', color: '#ec4899', icon: '🤝', description: 'Brand sponsorships and partnerships' },
  { name: 'PR & Communications',            type: 'expense', color: '#ec4899', icon: '📰', description: 'Public relations, press releases, and media outreach' },
  { name: 'Market Research',                type: 'expense', color: '#ec4899', icon: '🔍', description: 'Surveys, research services, and competitive analysis' },
  { name: 'Photography & Video',            type: 'expense', color: '#ec4899', icon: '📷', description: 'Professional photography and video production' },
  // Professional Services
  { name: 'Accounting & Bookkeeping',       type: 'expense', color: '#14b8a6', icon: '📊', description: 'CPA, bookkeeper, and accounting services' },
  { name: 'Legal Fees',                     type: 'expense', color: '#14b8a6', icon: '⚖️', description: 'Attorney fees, contracts, and legal advice' },
  { name: 'Consulting',                     type: 'expense', color: '#14b8a6', icon: '💼', description: 'Business consultants and advisory services' },
  { name: 'Recruiting & HR',                type: 'expense', color: '#14b8a6', icon: '👥', description: 'Staffing agencies and HR consulting' },
  { name: 'Training & Education',           type: 'expense', color: '#14b8a6', icon: '📚', description: 'Employee training, courses, and workshops' },
  { name: 'Certification & Licensing',      type: 'expense', color: '#14b8a6', icon: '📜', description: 'Professional certifications and license fees' },
  // Facilities
  { name: 'Rent & Lease',                   type: 'expense', color: '#8b5cf6', icon: '🏢', description: 'Office, retail, or warehouse rent and lease payments' },
  { name: 'Utilities (Electric)',           type: 'expense', color: '#8b5cf6', icon: '⚡', description: 'Electricity bills' },
  { name: 'Utilities (Gas)',                type: 'expense', color: '#8b5cf6', icon: '🔥', description: 'Natural gas bills' },
  { name: 'Utilities (Water)',              type: 'expense', color: '#8b5cf6', icon: '💧', description: 'Water and sewer bills' },
  { name: 'Janitorial & Cleaning',          type: 'expense', color: '#8b5cf6', icon: '🧹', description: 'Cleaning services and janitorial supplies' },
  { name: 'Repairs & Maintenance',          type: 'expense', color: '#8b5cf6', icon: '🔨', description: 'Building and equipment repairs' },
  { name: 'Security',                       type: 'expense', color: '#8b5cf6', icon: '🔒', description: 'Security systems, guards, and monitoring services' },
  { name: 'Property Insurance',             type: 'expense', color: '#8b5cf6', icon: '🏠', description: 'Building and property insurance premiums' },
  // Payroll & HR
  { name: 'Salaries & Wages',               type: 'expense', color: '#0ea5e9', icon: '💰', description: 'Regular employee salaries and hourly wages' },
  { name: 'Contract Labor',                 type: 'expense', color: '#0ea5e9', icon: '📋', description: 'Payments to independent contractors and freelancers' },
  { name: 'Employee Benefits',              type: 'expense', color: '#0ea5e9', icon: '🎁', description: 'Non-insurance employee benefits and perks' },
  { name: 'Health Insurance',               type: 'expense', color: '#0ea5e9', icon: '🏥', description: 'Employer-paid health, dental, and vision premiums' },
  { name: 'Retirement Contributions',       type: 'expense', color: '#0ea5e9', icon: '🏦', description: '401(k) and pension employer contributions' },
  { name: 'Payroll Taxes',                  type: 'expense', color: '#0ea5e9', icon: '🧾', description: 'Employer-side FICA, FUTA, and SUTA taxes' },
  { name: 'Workers Compensation',           type: 'expense', color: '#0ea5e9', icon: '🦺', description: 'Workers compensation insurance premiums' },
  // Finance & Banking
  { name: 'Bank Fees',                      type: 'expense', color: '#ef4444', icon: '🏦', description: 'Monthly maintenance fees and bank service charges' },
  { name: 'Credit Card Fees',               type: 'expense', color: '#ef4444', icon: '💳', description: 'Merchant processing and credit card transaction fees' },
  { name: 'Loan Interest',                  type: 'expense', color: '#ef4444', icon: '📈', description: 'Interest paid on business loans and lines of credit' },
  { name: 'Late Fees',                      type: 'expense', color: '#ef4444', icon: '⏰', description: 'Late payment penalties and fees' },
  { name: 'Wire Transfer Fees',             type: 'expense', color: '#ef4444', icon: '🔄', description: 'Domestic and international wire transfer charges' },
  { name: 'Currency Exchange',              type: 'expense', color: '#ef4444', icon: '💱', description: 'Foreign currency exchange fees and losses' },
  // Cost of Goods
  { name: 'Inventory Purchases',            type: 'expense', color: '#f97316', icon: '📦', description: 'Finished goods purchased for resale' },
  { name: 'Raw Materials',                  type: 'expense', color: '#f97316', icon: '🪨', description: 'Raw materials used in production' },
  { name: 'Packaging Materials',            type: 'expense', color: '#f97316', icon: '📫', description: 'Boxes, bags, and packaging supplies' },
  { name: 'Freight & Delivery',             type: 'expense', color: '#f97316', icon: '🚚', description: 'Shipping and freight costs for inbound goods' },
  { name: 'Customs & Duties',               type: 'expense', color: '#f97316', icon: '🛃', description: 'Import duties, tariffs, and customs fees' },
  // Insurance
  { name: 'General Liability',              type: 'expense', color: '#64748b', icon: '🛡️', description: 'General liability insurance premiums' },
  { name: 'Professional Liability (E&O)',   type: 'expense', color: '#64748b', icon: '📑', description: 'Errors and omissions insurance' },
  { name: 'Commercial Auto',                type: 'expense', color: '#64748b', icon: '🚗', description: 'Business vehicle insurance premiums' },
  { name: 'Directors & Officers',           type: 'expense', color: '#64748b', icon: '👔', description: 'D&O liability insurance' },
  // Taxes & Licenses
  { name: 'Business Licenses',              type: 'expense', color: '#78716c', icon: '📋', description: 'Business operating licenses and permits' },
  { name: 'State Taxes',                    type: 'expense', color: '#78716c', icon: '🏛️', description: 'State income and franchise taxes' },
  { name: 'Local Taxes',                    type: 'expense', color: '#78716c', icon: '🏙️', description: 'City, county, and local business taxes' },
  { name: 'Sales Tax Paid',                 type: 'expense', color: '#78716c', icon: '🧾', description: 'Sales taxes remitted to tax authorities' },
  { name: 'Import Duties',                  type: 'expense', color: '#78716c', icon: '🛂', description: 'Duties on imported goods' },
  // Miscellaneous Expense
  { name: 'Meals & Entertainment',          type: 'expense', color: '#a3a3a3', icon: '🍽️', description: 'Business meals and client entertainment' },
  { name: 'Subscriptions & Dues',           type: 'expense', color: '#a3a3a3', icon: '📰', description: 'Industry memberships, publications, and dues' },
  { name: 'Charitable Donations',           type: 'expense', color: '#a3a3a3', icon: '❤️', description: 'Charitable contributions from the business' },
  { name: 'Depreciation Expense',           type: 'expense', color: '#a3a3a3', icon: '📉', description: 'Scheduled depreciation on fixed assets' },
  { name: 'Amortization',                   type: 'expense', color: '#a3a3a3', icon: '📊', description: 'Amortization of intangible assets' },
  { name: 'Bad Debt Expense',               type: 'expense', color: '#a3a3a3', icon: '💸', description: 'Uncollectable accounts written off' },
  { name: 'Miscellaneous Expense',          type: 'expense', color: '#a3a3a3', icon: '📁', description: 'Other business expenses not classified elsewhere' },
  // Revenue
  { name: 'Product Sales',                  type: 'income',  color: '#22c55e', icon: '🛒', description: 'Revenue from selling physical or digital products' },
  { name: 'Service Revenue',                type: 'income',  color: '#22c55e', icon: '🔧', description: 'Revenue from rendering services' },
  { name: 'Consulting Revenue',             type: 'income',  color: '#22c55e', icon: '💼', description: 'Consulting and advisory fees earned' },
  { name: 'Subscription Revenue',           type: 'income',  color: '#22c55e', icon: '🔄', description: 'Recurring subscription or membership income' },
  { name: 'Licensing Revenue',              type: 'income',  color: '#22c55e', icon: '📜', description: 'Income from licensing intellectual property' },
  { name: 'Commission Income',              type: 'income',  color: '#22c55e', icon: '💰', description: 'Commissions earned on sales or referrals' },
  { name: 'Royalty Income',                 type: 'income',  color: '#22c55e', icon: '👑', description: 'Royalties received from IP or content licensing' },
  // Other Income
  { name: 'Interest Income',                type: 'income',  color: '#4ade80', icon: '📈', description: 'Interest earned on deposits and investments' },
  { name: 'Dividend Income',                type: 'income',  color: '#4ade80', icon: '💵', description: 'Dividends received from investments' },
  { name: 'Rental Income',                  type: 'income',  color: '#4ade80', icon: '🏠', description: 'Income from renting property or equipment' },
  { name: 'Gain on Asset Sale',             type: 'income',  color: '#4ade80', icon: '📊', description: 'Profit from selling business assets' },
  { name: 'Grant Income',                   type: 'income',  color: '#4ade80', icon: '🏆', description: 'Government or foundation grant awards' },
  { name: 'Refunds Received',               type: 'income',  color: '#4ade80', icon: '↩️', description: 'Vendor refunds and rebates received' },
  { name: 'Other Income',                   type: 'income',  color: '#4ade80', icon: '➕', description: 'Miscellaneous income not classified elsewhere' },
];

function seedDefaultCategories(companyId: string): { seeded: boolean; count: number } {
  const dbInstance = db.getDb();
  const existing = dbInstance.prepare('SELECT COUNT(*) as cnt FROM categories WHERE company_id = ?').get(companyId) as { cnt: number };
  if (existing && existing.cnt > 0) {
    return { seeded: false, count: existing.cnt };
  }
  const insertStmt = dbInstance.prepare(`
    INSERT OR IGNORE INTO categories (id, company_id, name, type, color, icon, description, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `);
  const insertMany = dbInstance.transaction((rows: typeof DEFAULT_CATEGORIES) => {
    for (const row of rows) {
      insertStmt.run(uuid(), companyId, row.name, row.type, row.color, row.icon, row.description);
    }
  });
  insertMany(DEFAULT_CATEGORIES);
  return { seeded: true, count: DEFAULT_CATEGORIES.length };
}

// ─── Journal Entry Auto-Poster ────────────────────────────
// Posts a balanced journal entry when the required accounts are found.
// Silently no-ops if any account is missing — best-effort for companies
// that haven't configured a full chart of accounts.
function postJournalEntry(
  dbInstance: ReturnType<typeof db.getDb>,
  companyId: string,
  date: string,
  description: string,
  lines: Array<{ nameHint: string; debit: number; credit: number; note?: string }>
): void {
  const resolved: Array<{ accountId: string; debit: number; credit: number; note: string }> = [];
  for (const line of lines) {
    const acct = (dbInstance as any).prepare(
      `SELECT id FROM accounts WHERE company_id = ? AND is_active = 1 AND name LIKE ? LIMIT 1`
    ).get(companyId, `%${line.nameHint}%`) as any;
    if (!acct) return; // skip whole entry if any account is missing
    resolved.push({ accountId: acct.id, debit: line.debit, credit: line.credit, note: line.note ?? '' });
  }

  const lastJE = (dbInstance as any).prepare(
    `SELECT entry_number FROM journal_entries WHERE company_id = ? ORDER BY created_at DESC LIMIT 1`
  ).get(companyId) as any;
  let nextNum = 'JE-1001';
  if (lastJE?.entry_number) {
    const m = lastJE.entry_number.match(/(\d+)$/);
    if (m) {
      const prefix = lastJE.entry_number.slice(0, lastJE.entry_number.length - m[1].length);
      nextNum = `${prefix}${String(parseInt(m[1], 10) + 1).padStart(m[1].length, '0')}`;
    }
  }

  const jeId = uuid();
  (dbInstance as any).prepare(`
    INSERT INTO journal_entries (id, company_id, entry_number, date, description, is_posted)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(jeId, companyId, nextNum, date, description);

  for (const line of resolved) {
    (dbInstance as any).prepare(`
      INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit, credit, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uuid(), jeId, line.accountId, line.debit, line.credit, line.note);
  }
}

export function registerIpcHandlers(): void {
  // Stripe integration — online-first with local SQLite cache fallback,
  // lives in its own module so the renderer can use Stripe offline.
  registerStripeIpc(ipcMain);

  // ─── Input Validation Helpers ──────────────────────────
  const VALID_TABLES = new Set([
    'invoices', 'invoice_line_items', 'expenses', 'expense_line_items',
    'clients', 'vendors', 'accounts', 'journal_entries', 'journal_entry_lines',
    'projects', 'employees', 'employee_deductions', 'time_entries',
    'categories', 'payments', 'budgets', 'budget_lines',
    'bank_accounts', 'bank_transactions', 'bank_reconciliation_matches',
    'documents', 'recurring_templates', 'tax_categories', 'tax_payments',
    'inventory_items', 'inventory_movements', 'quotes', 'quote_line_items',
    'bills', 'bill_line_items', 'bill_payments', 'purchase_orders', 'po_line_items',
    'fixed_assets', 'asset_depreciation_entries',
    'debts', 'debt_contacts', 'debt_communications', 'debt_payments',
    'debt_pipeline_stages', 'debt_evidence', 'debt_legal_actions',
    'debt_notes', 'debt_promises', 'debt_payment_plans', 'debt_plan_installments',
    'debt_settlements', 'debt_compliance_log', 'debt_disputes', 'debt_audit_log',
    'debt_payment_matches', 'debt_automation_rules', 'debt_templates',
    'companies', 'users', 'user_companies', 'settings', 'notifications',
    'audit_log', 'email_log', 'stripe_transactions',
    'invoice_settings', 'invoice_catalog_items', 'invoice_reminders',
    'invoice_payment_schedule', 'invoice_tokens', 'invoice_debt_links',
    'client_contacts', 'credit_notes', 'credit_note_items',
    'rules', 'rule_logs', 'saved_views', 'custom_field_defs',
    'payroll_runs', 'pay_stubs', 'federal_payroll_constants',
    'pto_policies', 'pto_balances', 'pto_transactions',
    'state_tax_brackets', 'approval_queue',
  ]);

  function validateTable(table: string): boolean {
    return VALID_TABLES.has(table);
  }

  // ─── Generic CRUD ────────────────────────────────────
  ipcMain.handle('db:query', (_event, { table, filters, sort, limit, offset }) => {
    if (!validateTable(table)) return [];
    return db.queryAll(table, filters, sort, limit, offset);
  });

  ipcMain.handle('db:get', (_event, { table, id }) => {
    if (!validateTable(table)) return null;
    return db.getById(table, id);
  });

  // Tables that do NOT have a company_id column (child/junction tables)
  // WARNING: only list tables whose schema truly has no company_id column.
  // payments and categories both have company_id NOT NULL — never put them here.
  const tablesWithoutCompanyId = new Set([
    'invoice_line_items', 'journal_entry_lines', 'pay_stubs',
    'budget_lines', 'bank_transactions', 'bank_reconciliation_matches',
    'users', 'user_companies',
    // Enterprise v2 child tables — no company_id column in schema
    // NOTE: bill_payments DOES have company_id, so it is NOT listed here
    'bill_line_items', 'po_line_items',
    'asset_depreciation_entries', 'credit_note_items',
    // Debt collection child tables — company_id lives on parent `debts` table
    'debt_contacts', 'debt_communications', 'debt_payments',
    'debt_pipeline_stages', 'debt_evidence', 'debt_legal_actions', 'debt_notes',
    'quote_line_items',
    // Invoice reminders — company_id lives on parent `invoices` table
    'invoice_reminders',
    // Invoice settings & catalog — company_id injected by their own handlers
    'invoice_settings', 'invoice_catalog_items',
    // Invoice payment schedule — company_id lives on parent `invoices` table
    'invoice_payment_schedule',
    // Track 1 child tables — company_id lives on parent table
    'client_contacts', 'debt_promises',
    // Debt & Invoice Enhancement child tables — company_id lives on parent table
    'debt_payment_plans', 'debt_plan_installments', 'debt_settlements',
    'debt_compliance_log', 'invoice_debt_links',
    'expense_line_items', 'debt_disputes',
    'debt_audit_log', 'debt_payment_matches',
  ]);

  ipcMain.handle('db:create', (_event, { table, data }) => {
    if (!validateTable(table)) return { error: 'Invalid table' };
    try {
      const companyId = db.getCurrentCompanyId();
      const payload = tablesWithoutCompanyId.has(table)
        ? { ...data }
        : { ...data, company_id: companyId };
      // Apply rules for invoices
      if (table === 'invoices' && payload.company_id) {
        const pricingResults = evaluateRules({ category: 'pricing', record: payload, company_id: String(payload.company_id), db: db.getDb() });
        const taxResults     = evaluateRules({ category: 'tax',     record: payload, company_id: String(payload.company_id), db: db.getDb() });
        Object.assign(payload, mergePatches([...pricingResults, ...taxResults]));
        payload.rules_applied = rulesAppliedSummary([...pricingResults, ...taxResults]);
      }
      // Apply tax rules for expenses
      if (table === 'expenses' && payload.company_id) {
        const taxResults = evaluateRules({ category: 'tax', record: payload, company_id: String(payload.company_id), db: db.getDb() });
        Object.assign(payload, mergePatches(taxResults));
        payload.rules_applied = rulesAppliedSummary(taxResults);
      }
      // Apply approval rules for invoices, expenses, bills
      if ((table === 'invoices' || table === 'expenses' || table === 'bills') && payload.company_id) {
        const approvalResults = evaluateRules({ category: 'approval', record: { ...payload, _type: table }, company_id: String(payload.company_id), db: db.getDb() });
        if (approvalResults.some(r => r.matched)) payload.status = 'pending_approval';
      }
      const record = db.create(table, payload);
      if (companyId) db.logAudit(companyId, table, record.id, 'create');
      // Debt child table audit
      const DEBT_CHILD_AUDIT: Record<string, string> = {
        debt_payments: 'payment_recorded',
        debt_communications: 'communication_logged',
        debt_disputes: 'dispute_filed',
      };
      if (DEBT_CHILD_AUDIT[table] && (data.debt_id || payload.debt_id)) {
        logDebtAudit(data.debt_id || payload.debt_id, DEBT_CHILD_AUDIT[table], table, '', record?.id || '');
      }
      syncPush({ table, operation: 'create', id: record.id as string, data: payload as Record<string, unknown>, companyId: companyId ?? '', timestamp: Date.now() }).catch(() => {});
      scheduleAutoBackup();
      return record;
    } catch (err) {
      console.error(`db:create [${table}] failed:`, err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('db:update', (_event, { table, id, data }) => {
    if (!validateTable(table)) return { error: 'Invalid table' };
    try {
      const old = db.getById(table, id);
      const record = db.update(table, id, data);
      const companyId = db.getCurrentCompanyId();
      if (companyId && old) {
        const changes: Record<string, any> = {};
        for (const key of Object.keys(data)) {
          if (old[key] !== record[key]) {
            changes[key] = { old: old[key], new: record[key] };
          }
        }
        db.logAudit(companyId, table, id, 'update', changes);
      }
      // Debt audit: log each changed field
      if (table === 'debts' && id && old) {
        try {
          const newRow = db.getById('debts', id) as any;
          if (newRow) {
            for (const key of Object.keys(data)) {
              const oldVal = String((old as any)[key] ?? '');
              const newVal = String(newRow[key] ?? '');
              if (oldVal !== newVal) {
                logDebtAudit(id, 'field_edit', key, oldVal, newVal);
              }
            }
          }
        } catch (_) {}
      }
      syncPush({ table, operation: 'update', id, data: { id, ...data } as Record<string, unknown>, companyId: companyId ?? '', timestamp: Date.now() }).catch(() => {});
      scheduleAutoBackup();
      return record;
    } catch (err) {
      console.error(`db:update [${table}:${id}] failed:`, err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('db:delete', (_event, { table, id }) => {
    if (!validateTable(table)) return { error: 'Invalid table' };
    try {
      // Debt child table audit — read debt_id before deletion
      const DEBT_AUDIT_TABLES = ['debt_payments', 'debt_communications', 'debt_evidence', 'debt_legal_actions',
        'debt_settlements', 'debt_disputes', 'debt_contacts', 'debt_promises', 'debt_notes'];
      if (DEBT_AUDIT_TABLES.includes(table)) {
        try {
          const row = db.getById(table, id) as any;
          if (row?.debt_id) logDebtAudit(row.debt_id, 'record_deleted', table, id, '');
        } catch (_) {}
      }
      const companyId = db.getCurrentCompanyId();
      if (companyId) db.logAudit(companyId, table, id, 'delete');
      db.remove(table, id);
      syncPush({ table, operation: 'delete', id, data: { id }, companyId: companyId ?? '', timestamp: Date.now() }).catch(() => {});
      scheduleAutoBackup();
    } catch (err) {
      console.error(`db:delete [${table}:${id}] failed:`, err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── Raw Query (for reports/aggregations) ────────────
  ipcMain.handle('db:raw-query', (_event, { sql, params }) => {
    return db.runQuery(sql, params);
  });

  // ─── Atomic invoice save (header + line items in one transaction) ─────────
  // Prevents orphaned invoice headers when a line item insert fails.
  ipcMain.handle('invoice:save', (_event, { invoiceId, invoiceData, lineItems, isEdit }: {
    invoiceId: string | null;
    invoiceData: Record<string, any>;
    lineItems: Array<Record<string, any>>;
    isEdit: boolean;
  }) => {
    try {
      const companyId = db.getCurrentCompanyId();
      const rawDb = db.getDb();

      const saveFn = rawDb.transaction(() => {
        let savedId: string;

        if (isEdit && invoiceId) {
          db.update('invoices', invoiceId, invoiceData);
          savedId = invoiceId;
          // Replace line items atomically
          const oldLines = db.queryAll('invoice_line_items', { invoice_id: invoiceId });
          for (const ol of oldLines) db.remove('invoice_line_items', ol.id);
        } else {
          const record = db.create('invoices', { ...invoiceData, company_id: companyId });
          savedId = record.id;
        }

        for (let i = 0; i < lineItems.length; i++) {
          db.create('invoice_line_items', { ...lineItems[i], invoice_id: savedId, sort_order: i });
        }

        return savedId;
      });

      const savedId = saveFn();
      if (companyId) db.logAudit(companyId, 'invoices', savedId, isEdit ? 'update' : 'create');
      return { id: savedId };
    } catch (err) {
      console.error('invoice:save failed:', err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── Atomic expense save (header + line items in one transaction) ─────────
  ipcMain.handle('expense:save', (_event, { expenseId, expenseData, lineItems, isEdit }: {
    expenseId: string | null;
    expenseData: Record<string, any>;
    lineItems: Array<Record<string, any>>;
    isEdit: boolean;
  }) => {
    for (const li of lineItems) {
      if (li.quantity != null && li.quantity < 0) return { error: 'Quantity cannot be negative' };
      if (li.unit_price != null && li.unit_price < 0) return { error: 'Unit price cannot be negative' };
    }
    try {
      const companyId = db.getCurrentCompanyId();
      const rawDb = db.getDb();

      const saveFn = rawDb.transaction(() => {
        let savedId: string;

        // Auto-calculate amount from line items when present
        if (lineItems.length > 0) {
          expenseData.amount = lineItems.reduce((sum: number, li: any) => sum + ((li.quantity || 1) * (li.unit_price || 0)), 0);
        }

        if (isEdit && expenseId) {
          db.update('expenses', expenseId, expenseData);
          savedId = expenseId;
          // Replace line items atomically
          const oldLines = db.queryAll('expense_line_items', { expense_id: expenseId });
          for (const ol of oldLines) db.remove('expense_line_items', ol.id);
        } else {
          // Apply tax rules on create
          if (companyId) {
            const taxResults = evaluateRules({ category: 'tax', record: { ...expenseData, company_id: companyId }, company_id: companyId, db: rawDb });
            Object.assign(expenseData, mergePatches(taxResults));
            expenseData.rules_applied = rulesAppliedSummary(taxResults);
            // Apply approval rules
            const approvalResults = evaluateRules({ category: 'approval', record: { ...expenseData, _type: 'expenses', company_id: companyId }, company_id: companyId, db: rawDb });
            if (approvalResults.some((r: any) => r.matched)) expenseData.status = 'pending_approval';
          }
          const record = db.create('expenses', { ...expenseData, company_id: companyId });
          savedId = record.id;
        }

        // Insert new line items
        for (let i = 0; i < lineItems.length; i++) {
          db.create('expense_line_items', {
            ...lineItems[i],
            expense_id: savedId,
            amount: (lineItems[i].quantity || 1) * (lineItems[i].unit_price || 0),
            sort_order: i,
          });
        }

        // Auto-create document record for receipt attachment
        if (expenseData.receipt_path) {
          const fileName = expenseData.receipt_path.split(/[\\/]/).pop() || 'receipt';
          const existingDoc = rawDb.prepare(
            "SELECT id FROM documents WHERE entity_type = 'expense' AND entity_id = ? LIMIT 1"
          ).get(savedId) as any;
          if (!existingDoc) {
            db.create('documents', {
              company_id: companyId,
              filename: fileName,
              file_path: expenseData.receipt_path,
              file_size: 0,
              mime_type: '',
              entity_type: 'expense',
              entity_id: savedId,
              tags: '["receipt"]',
              description: 'Expense receipt',
            });
          }
        }

        return savedId;
      });

      const savedId = saveFn();
      if (companyId) db.logAudit(companyId, 'expenses', savedId, isEdit ? 'update' : 'create');
      scheduleAutoBackup();
      return { id: savedId };
    } catch (err) {
      console.error('expense:save failed:', err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── Company Management ──────────────────────────────
  ipcMain.handle('company:list', () => {
    const companies = db.queryAll('companies');
    // Auto-switch to the first company if currentCompanyId is not yet set
    // (happens on cold start before renderer calls company:switch)
    if (!db.getCurrentCompanyId() && companies.length > 0) {
      db.switchCompany(companies[0].id);
    }
    return companies;
  });

  ipcMain.handle('company:get', (_event, id) => {
    return db.getById('companies', id);
  });

  ipcMain.handle('company:create', (_event, data) => {
    const company = db.create('companies', data);
    db.seedDefaultAccounts(company.id);
    // Seed default categories for new company
    seedDefaultCategories(company.id);
    db.switchCompany(company.id);
    return company;
  });

  ipcMain.handle('company:update', (_event, { id, data }) => {
    return db.update('companies', id, data);
  });

  ipcMain.handle('company:switch', (_event, companyId) => {
    db.switchCompany(companyId);
  });

  // ─── Global Search ───────────────────────────────────
  ipcMain.handle('search:global', (_event, query) => {
    if (!query || query.length > 200) return [];
    const results: Array<{ type: string; id: string; title: string; subtitle: string }> = [];
    const q = `%${query}%`;
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return results;

    const dbInstance = db.getDb();

    const clients = dbInstance.prepare(
      'SELECT id, name, email FROM clients WHERE company_id = ? AND (name LIKE ? OR email LIKE ?) LIMIT 5'
    ).all(companyId, q, q) as any[];
    for (const c of clients) {
      results.push({ type: 'client', id: c.id, title: c.name, subtitle: c.email || '' });
    }

    const invoices = dbInstance.prepare(
      'SELECT id, invoice_number, status FROM invoices WHERE company_id = ? AND invoice_number LIKE ? LIMIT 5'
    ).all(companyId, q) as any[];
    for (const i of invoices) {
      results.push({ type: 'invoice', id: i.id, title: `Invoice ${i.invoice_number}`, subtitle: i.status });
    }

    const expenses = dbInstance.prepare(
      'SELECT id, description, amount FROM expenses WHERE company_id = ? AND description LIKE ? LIMIT 5'
    ).all(companyId, q) as any[];
    for (const e of expenses) {
      results.push({ type: 'expense', id: e.id, title: e.description || 'Expense', subtitle: `$${e.amount}` });
    }

    const projects = dbInstance.prepare(
      'SELECT id, name, status FROM projects WHERE company_id = ? AND name LIKE ? LIMIT 5'
    ).all(companyId, q) as any[];
    for (const p of projects) {
      results.push({ type: 'project', id: p.id, title: p.name, subtitle: p.status });
    }

    return results.slice(0, 20);
  });

  // ─── Notifications ───────────────────────────────────
  ipcMain.handle('notification:list', (_event, opts = {}) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return [];
    const filters: Record<string, any> = { company_id: companyId };
    if (opts.unread_only) filters.is_read = 0;
    return db.queryAll('notifications', filters, { field: 'created_at', dir: 'desc' }, 50);
  });

  ipcMain.handle('notification:mark-read', (_event, id) => {
    db.update('notifications', id, { is_read: 1 });
  });

  // ─── Dashboard Aggregation ───────────────────────────
  ipcMain.handle('dashboard:stats', (_event, { startDate, endDate }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    const dbInstance = db.getDb();

    // Current period
    const revenue = dbInstance.prepare(
      'SELECT COALESCE(SUM(amount_paid), 0) as total FROM invoices WHERE company_id = ? AND issue_date >= ? AND issue_date <= ?'
    ).get(companyId, startDate, endDate) as any;

    const expenseTotal = dbInstance.prepare(
      'SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE company_id = ? AND date >= ? AND date <= ?'
    ).get(companyId, startDate, endDate) as any;

    const outstanding = dbInstance.prepare(
      "SELECT COALESCE(SUM(total - amount_paid), 0) as total, COUNT(*) as count FROM invoices WHERE company_id = ? AND status IN ('sent', 'overdue', 'partial')"
    ).get(companyId) as any;

    const overdue = dbInstance.prepare(
      "SELECT COUNT(*) as count FROM invoices WHERE company_id = ? AND status = 'overdue'"
    ).get(companyId) as any;

    // Previous period of same length for change percentages
    const start = new Date(startDate);
    const end = new Date(endDate);
    const periodMs = end.getTime() - start.getTime();
    const prevEnd = new Date(start.getTime() - 1); // day before current start
    const prevStart = new Date(prevEnd.getTime() - periodMs);
    const prevStartStr = prevStart.toISOString().slice(0, 10);
    const prevEndStr = prevEnd.toISOString().slice(0, 10);

    const prevRevenue = dbInstance.prepare(
      'SELECT COALESCE(SUM(amount_paid), 0) as total FROM invoices WHERE company_id = ? AND issue_date >= ? AND issue_date <= ?'
    ).get(companyId, prevStartStr, prevEndStr) as any;

    const prevExpense = dbInstance.prepare(
      'SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE company_id = ? AND date >= ? AND date <= ?'
    ).get(companyId, prevStartStr, prevEndStr) as any;

    const curRevenue = revenue?.total || 0;
    const curExpenses = expenseTotal?.total || 0;
    const curNet = curRevenue - curExpenses;
    const prvRevenue = prevRevenue?.total || 0;
    const prvExpenses = prevExpense?.total || 0;
    const prvNet = prvRevenue - prvExpenses;

    const pctChange = (cur: number, prev: number): number => {
      if (prev === 0) return cur > 0 ? 100 : 0;
      return ((cur - prev) / Math.abs(prev)) * 100;
    };

    return {
      revenue: curRevenue,
      revenueChange: pctChange(curRevenue, prvRevenue),
      expenses: curExpenses,
      expensesChange: pctChange(curExpenses, prvExpenses),
      netIncome: curNet,
      netIncomeChange: pctChange(curNet, prvNet),
      outstanding: outstanding?.total || 0,
      outstandingChange: 0,
      outstandingCount: outstanding?.count || 0,
      overdueCount: overdue?.count || 0,
    };
  });

  // ─── Cash Flow Data ──────────────────────────────────
  ipcMain.handle('dashboard:cashflow', (_event, { startDate, endDate }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return [];
    const dbInstance = db.getDb();

    const inflow = dbInstance.prepare(
      "SELECT strftime('%Y-%m', issue_date) as month, SUM(amount_paid) as total FROM invoices WHERE company_id = ? AND issue_date >= ? AND issue_date <= ? GROUP BY month ORDER BY month"
    ).all(companyId, startDate, endDate) as any[];

    const outflow = dbInstance.prepare(
      "SELECT strftime('%Y-%m', date) as month, SUM(amount) as total FROM expenses WHERE company_id = ? AND date >= ? AND date <= ? GROUP BY month ORDER BY month"
    ).all(companyId, startDate, endDate) as any[];

    const months = new Set([...inflow.map((r: any) => r.month), ...outflow.map((r: any) => r.month)]);
    const sorted = Array.from(months).sort();

    return sorted.map(month => ({
      month,
      income: inflow.find((r: any) => r.month === month)?.total || 0,
      expenses: outflow.find((r: any) => r.month === month)?.total || 0,
    }));
  });

  // ─── File Dialog ────────────────────────────────────────
  ipcMain.handle('dialog:open-file', async (_event, options?: { filters?: Array<{ name: string; extensions: string[] }> }) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: options?.filters || [{ name: 'All Files', extensions: ['*'] }],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const filePath = result.filePaths[0];
    const stats = fs.statSync(filePath);
    return { path: filePath, name: path.basename(filePath), size: stats.size };
  });

  // ─── PDF Generate (Invoice) — Download via Save Dialog ──
  // Accepts optional pre-built HTML from the renderer so the saved PDF
  // matches the preview exactly (including settings, payment schedule, etc.)
  ipcMain.handle('invoice:generate-pdf', async (
    _event,
    payload: string | {
      invoiceId: string;
      html?: string;
      pdfOptions?: PDFOptions;
      openAfterSave?: boolean;
      revealAfterSave?: boolean;
    }
  ) => {
    const invoiceId = typeof payload === 'string' ? payload : payload.invoiceId;
    const providedHTML = typeof payload === 'string' ? undefined : payload.html;
    const pdfOptions = typeof payload === 'string' ? undefined : payload.pdfOptions;
    const openAfterSave = typeof payload === 'string' ? false : !!payload.openAfterSave;
    const revealAfterSave = typeof payload === 'string' ? false : !!payload.revealAfterSave;

    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { error: 'No company selected' };

    const invoice = db.getById('invoices', invoiceId);
    if (!invoice) return { error: 'Invoice not found' };

    // Default filename: invoice-{number}-{yyyy-MM-dd}.pdf
    const defaultName = buildPdfFilename('invoice', String(invoice.invoice_number || invoiceId));
    const { filePath, canceled } = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      // showOverwriteConfirmation defaults to true, but be explicit for clarity.
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    });

    if (canceled || !filePath) return { cancelled: true };

    try {
      let pdfBuffer: Buffer;
      if (providedHTML) {
        pdfBuffer = await htmlToPDFBuffer(providedHTML, pdfOptions);
      } else {
        const dbInstance = db.getDb();
        const client = db.getById('clients', invoice.client_id);
        const company = db.getById('companies', companyId);
        const lineItems = dbInstance.prepare(
          'SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY sort_order'
        ).all(invoiceId) as any[];
        pdfBuffer = await generateInvoicePDF(invoice, company, client, lineItems, pdfOptions);
      }
      // Async write — caller must not see "saved" before bytes are on disk.
      await fsp.writeFile(filePath, pdfBuffer);

      // Compliance: log PDF export of a financial document.
      try {
        db.logAudit(companyId, 'invoices', invoiceId, 'export_pdf', { path: filePath });
      } catch { /* audit is best-effort */ }

      if (openAfterSave) {
        const openErr = await openPathInOS(filePath);
        if (openErr) console.warn('openPath failed:', openErr);
      } else if (revealAfterSave) {
        revealInFolder(filePath);
      }

      return { path: filePath };
    } catch (err: any) {
      // Surface disk-full / permission-denied / EACCES to the renderer.
      return { error: err?.message || 'PDF generation failed' };
    }
  });

  // ─── Batch PDF Export ──────────────────────────────────
  ipcMain.handle('invoice:batch-pdf', async (
    event,
    {
      invoiceIds,
      pdfOptions,
      mode,
    }: {
      invoiceIds: string[];
      pdfOptions?: PDFOptions;
      // 'combined' = single PDF with page breaks; 'separate' = one PDF per invoice into a folder.
      mode?: 'combined' | 'separate';
    }
  ) => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return { error: 'No company selected' };
      if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
        return { error: 'No invoices selected' };
      }

      const dbInstance = db.getDb();
      const company = db.getById('companies', companyId);

      // Progress helper — stream to the caller so a long batch shows a bar.
      const sendProgress = (current: number, total: number, label: string) => {
        try { event.sender.send('invoice:batch-pdf:progress', { current, total, label }); }
        catch { /* receiver may be gone */ }
      };

      if (mode === 'separate') {
        // Ask for a directory; write one PDF per invoice, serially.
        const { filePaths, canceled } = await dialog.showOpenDialog({
          properties: ['openDirectory', 'createDirectory'],
        });
        if (canceled || !filePaths?.[0]) return { cancelled: true };
        const outDir = filePaths[0];
        const written: string[] = [];
        for (let i = 0; i < invoiceIds.length; i++) {
          const invId = invoiceIds[i];
          const invoice = db.getById('invoices', invId);
          if (!invoice) continue;
          const client = db.getById('clients', invoice.client_id);
          const lineItems = dbInstance.prepare(
            'SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY sort_order'
          ).all(invId) as any[];
          const html = buildInvoiceHTML(company, client, invoice, lineItems);
          sendProgress(i + 1, invoiceIds.length, `Invoice ${invoice.invoice_number}`);
          // Serialize — printToPDF is heavy, racing many in parallel OOMs Electron.
          const buf = await htmlToPDFBuffer(html, pdfOptions);
          const name = buildPdfFilename('invoice', String(invoice.invoice_number || invId));
          const full = path.join(outDir, name);
          await fsp.writeFile(full, buf);
          written.push(full);
          try { db.logAudit(companyId, 'invoices', invId, 'export_pdf', { path: full, batch: true }); }
          catch { /* audit best-effort */ }
        }
        return { dir: outDir, files: written, count: written.length };
      }

      // Combined mode
      const defaultName = buildPdfFilename('invoices-batch', String(invoiceIds.length));
      const { filePath, canceled } = await dialog.showSaveDialog({
        defaultPath: defaultName,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
        properties: ['showOverwriteConfirmation', 'createDirectory'],
      });
      if (canceled || !filePath) return { cancelled: true };

      const allHtml: string[] = [];
      const processedIds: string[] = [];
      for (let i = 0; i < invoiceIds.length; i++) {
        const invId = invoiceIds[i];
        const invoice = db.getById('invoices', invId);
        if (!invoice) continue;
        const client = db.getById('clients', invoice.client_id);
        const lineItems = dbInstance.prepare(
          'SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY sort_order'
        ).all(invId) as any[];
        sendProgress(i + 1, invoiceIds.length, `Invoice ${invoice.invoice_number}`);
        allHtml.push(buildInvoiceHTML(company, client, invoice, lineItems));
        processedIds.push(invId);
      }

      const combinedHTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        @media print { .page-break { page-break-before: always; } }
        .page-break { page-break-before: always; }
      </style></head><body>
        ${allHtml.map((h, i) => {
          const body = h.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] || h;
          return i === 0 ? body : `<div class="page-break"></div>${body}`;
        }).join('')}
      </body></html>`;

      const pdfBuffer = await htmlToPDFBuffer(combinedHTML, pdfOptions);
      await fsp.writeFile(filePath, pdfBuffer);
      for (const id of processedIds) {
        try { db.logAudit(companyId, 'invoices', id, 'export_pdf', { path: filePath, batch: true }); }
        catch { /* audit best-effort */ }
      }
      return { path: filePath, count: allHtml.length };
    } catch (err: any) {
      return { error: err?.message || 'Batch PDF failed' };
    }
  });

  // NOTE: invoice:preview-pdf removed — the renderer now uses print:preview
  // with client-generated HTML (see InvoiceDetail.handlePreview). That path
  // respects invoice_settings and payment_schedule; the old server template
  // did not.

  // ─── Email Invoice ─────────────────────────────────────
  // Accepts optional pre-built HTML from the renderer so the PDF attachment
  // matches what the user sees in the preview (including logo, accent color,
  // template style, column config, payment schedule, watermark, footer).
  // Falls back to the server-side template only if no HTML is provided.
  ipcMain.handle('invoice:send-email', async (_event, payload: string | { invoiceId: string; html?: string }) => {
    // Back-compat: old callers passed the invoiceId as a bare string.
    const invoiceId = typeof payload === 'string' ? payload : payload.invoiceId;
    const providedHTML = typeof payload === 'string' ? undefined : payload.html;

    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { error: 'No company selected' };

    const dbInstance = db.getDb();
    const invoice = db.getById('invoices', invoiceId);
    if (!invoice) return { error: 'Invoice not found' };

    const client = db.getById('clients', invoice.client_id);
    const company = db.getById('companies', companyId);

    try {
      // Generate PDF to temp location — prefer renderer-built HTML (uses settings),
      // fall back to the basic server template if none was supplied.
      let pdfBuffer: Buffer;
      if (providedHTML) {
        pdfBuffer = await htmlToPDFBuffer(providedHTML);
      } else {
        const lineItems = dbInstance.prepare(
          'SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY sort_order'
        ).all(invoiceId) as any[];
        pdfBuffer = await generateInvoicePDF(invoice, company, client, lineItems);
      }

      // Write temp PDF into an isolated subdir so we can clean it up later
      // without racing against other exports. Filename matches the new
      // {doctype}-{id}-{date}.pdf convention.
      const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'bap-invoice-'));
      const pdfPath = path.join(
        tmpDir,
        buildPdfFilename('invoice', String(invoice.invoice_number || invoiceId))
      );
      await fsp.writeFile(pdfPath, pdfBuffer);

      // Schedule cleanup — mail client has the handle open by now; give it
      // 10 minutes and then reap. Best-effort, silent on failure.
      setTimeout(() => {
        fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }, 10 * 60 * 1000);

      // Open email client with pre-filled content
      const emailResult = await sendInvoiceEmail(invoice, company, client);

      if (emailResult.success) {
        const previousStatus = invoice.status;
        // Update invoice status to sent if still draft
        if (previousStatus === 'draft') {
          db.update('invoices', invoiceId, { status: 'sent' });
        }

        // Log the email
        const emailId = crypto.randomUUID();
        const now = new Date().toISOString();
        dbInstance.prepare(
          'INSERT INTO email_log (id, company_id, recipient, subject, body_preview, entity_type, entity_id, status, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).run(
          emailId,
          companyId,
          client?.email || '',
          `Invoice ${invoice.invoice_number} from ${company?.name || ''}`,
          'Mail client opened with PDF attached from temp folder',
          'invoice',
          invoiceId,
          'sent',
          now
        );

        // Reveal the PDF in filesystem so user can attach it
        revealInFolder(pdfPath);
        try {
          db.logAudit(companyId, 'invoices', invoiceId, 'email_pdf', { pdfPath });
        } catch { /* audit best-effort */ }
        scheduleAutoBackup();

        return {
          success: true,
          pdfPath,
          newStatus: previousStatus === 'draft' ? 'sent' : previousStatus,
        };
      }

      return { ...emailResult, pdfPath };
    } catch (err: any) {
      return { error: err?.message || 'Failed to send email' };
    }
  });

  // ─── Invoice Portal Token ──────────────────────────────
  ipcMain.handle('invoice:generate-token', (_event, invoiceId: string) => {
    const dbInstance = db.getDb();
    const existing = dbInstance.prepare(
      `SELECT token FROM invoice_tokens WHERE invoice_id = ?`
    ).get(invoiceId) as any;
    if (existing) return { token: existing.token };

    const token = crypto.randomBytes(32).toString('hex');
    const invoice = dbInstance.prepare(`SELECT due_date FROM invoices WHERE id = ?`).get(invoiceId) as any;
    const dueTs = invoice?.due_date
      ? new Date(invoice.due_date).getTime()
      : Date.now();
    const expiresAt = Math.floor(dueTs / 1000) + 90 * 86400;
    const companyId = db.getCurrentCompanyId() ?? '';

    dbInstance.prepare(`
      INSERT INTO invoice_tokens (id, invoice_id, company_id, token, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(uuid(), invoiceId, companyId, token, expiresAt);

    return { token };
  });

  // ─── Invoice Reminders ────────────────────────────────
  ipcMain.handle('invoice:schedule-reminders', (_event, { invoiceId }: { invoiceId: string }) => {
    const invoice = db.getDb().prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId) as any;
    if (!invoice || !invoice.due_date) return { scheduled: 0 };

    const dueDate = new Date(invoice.due_date);
    const reminders = [
      { type: 'before_due', date: new Date(dueDate.getTime() - 3 * 86400000) },
      { type: 'on_due', date: dueDate },
      { type: 'overdue_7', date: new Date(dueDate.getTime() + 7 * 86400000) },
      { type: 'overdue_14', date: new Date(dueDate.getTime() + 14 * 86400000) },
      { type: 'overdue_30', date: new Date(dueDate.getTime() + 30 * 86400000) },
    ].filter(r => r.date >= new Date());

    // Clear existing pending reminders
    db.getDb().prepare("DELETE FROM invoice_reminders WHERE invoice_id = ? AND status = 'pending'").run(invoiceId);

    const stmt = db.getDb().prepare('INSERT INTO invoice_reminders (id, invoice_id, reminder_type, scheduled_date) VALUES (?, ?, ?, ?)');
    for (const r of reminders) {
      stmt.run(uuid(), invoiceId, r.type, r.date.toISOString().split('T')[0]);
    }
    return { scheduled: reminders.length };
  });

  ipcMain.handle('invoice:list-reminders', (_event, { invoiceId }: { invoiceId: string }) => {
    return db.getDb().prepare('SELECT * FROM invoice_reminders WHERE invoice_id = ? ORDER BY scheduled_date').all(invoiceId);
  });

  ipcMain.handle('invoice:debt-link', (_event, { invoiceId }: { invoiceId: string }) => {
    try {
      return db.getDb().prepare('SELECT * FROM invoice_debt_links WHERE invoice_id = ?').get(invoiceId) || null;
    } catch { return null; }
  });

  ipcMain.handle('debt:invoice-link', (_event, { debtId }: { debtId: string }) => {
    try {
      return db.getDb().prepare('SELECT * FROM invoice_debt_links WHERE debt_id = ?').get(debtId) || null;
    } catch { return null; }
  });

  ipcMain.handle('invoice:overdue-candidates', (_event, { companyId, thresholdDays = 30 }: { companyId: string; thresholdDays?: number }) => {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - thresholdDays);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      return db.getDb().prepare(`
        SELECT i.*, c.name as client_name
        FROM invoices i
        LEFT JOIN clients c ON c.id = i.client_id
        WHERE i.company_id = ?
          AND i.status IN ('overdue', 'sent')
          AND i.due_date <= ?
          AND i.id NOT IN (SELECT invoice_id FROM invoice_debt_links)
      `).all(companyId, cutoffStr);
    } catch { return []; }
  });

  ipcMain.handle('invoice:convert-to-debt', (_event, { invoiceId, companyId }: { invoiceId: string; companyId: string }) => {
    try {
      const inv = db.getById('invoices', invoiceId) as any;
      if (!inv) return { error: 'Invoice not found' };
      const client = inv.client_id ? db.getById('clients', inv.client_id) as any : null;
      const balance = (inv.total || 0) - (inv.amount_paid || 0);

      const debt = db.create('debts', {
        company_id: companyId,
        type: 'receivable',
        debtor_type: client ? 'client' : 'custom',
        debtor_id: inv.client_id || null,
        debtor_name: client?.name || inv.client_name || 'Unknown',
        debtor_email: client?.email || null,
        debtor_phone: client?.phone || null,
        original_amount: balance,
        balance_due: balance,
        due_date: inv.due_date,
        delinquent_date: inv.due_date,
        source_type: 'invoice',
        source_id: invoiceId,
        status: 'active',
        current_stage: 'reminder',
        priority: 'medium',
      }) as any;

      db.create('debt_pipeline_stages', { debt_id: debt.id, stage: 'reminder' });
      db.create('invoice_debt_links', { invoice_id: invoiceId, debt_id: debt.id });
      db.update('invoices', invoiceId, { status: 'overdue' });

      scheduleAutoBackup();
      return { debt_id: debt.id };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  // ─── Invoice Settings ──────────────────────────────────
  ipcMain.handle('invoice:get-settings', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    let row = db.getDb().prepare('SELECT * FROM invoice_settings WHERE company_id = ?').get(companyId) as any;
    if (!row) {
      // Auto-create defaults on first access
      row = db.create('invoice_settings', {
        company_id: companyId,
        accent_color: '#2563eb',
        template_style: 'classic',
        show_logo: 1,
        show_tax_column: 1,
        show_payment_terms: 1,
        footer_text: '',
        default_notes: '',
        default_terms_text: '',
        default_due_days: 30,
      });
    }
    return row;
  });

  ipcMain.handle('invoice:save-settings', (_event, data: Record<string, any>) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { error: 'No active company' };
    try {
      const existing = db.getDb().prepare('SELECT id FROM invoice_settings WHERE company_id = ?').get(companyId) as any;
      if (existing) {
        db.update('invoice_settings', existing.id, data);
        return db.getDb().prepare('SELECT * FROM invoice_settings WHERE company_id = ?').get(companyId);
      } else {
        return db.create('invoice_settings', { ...data, company_id: companyId });
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── Invoice Catalog Items ────────────────────────────
  ipcMain.handle('invoice:catalog-list', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return [];
    return db.getDb().prepare('SELECT * FROM invoice_catalog_items WHERE company_id = ? ORDER BY name').all(companyId);
  });

  ipcMain.handle('invoice:catalog-save', (_event, data: Record<string, any>) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { error: 'No active company' };
    try {
      if (data.id) {
        db.update('invoice_catalog_items', data.id, data);
        return db.getById('invoice_catalog_items', data.id);
      }
      return db.create('invoice_catalog_items', { ...data, company_id: companyId });
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('invoice:catalog-delete', (_event, id: string) => {
    try {
      db.remove('invoice_catalog_items', id);
      return { success: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── Invoice Payment Schedule ──────────────────────────
  ipcMain.handle('invoice:payment-schedule-list', (_event, invoiceId: string) => {
    try {
      return db.queryAll('invoice_payment_schedule', { invoice_id: invoiceId }, { field: 'sort_order', dir: 'asc' });
    } catch (err) {
      return [];
    }
  });

  ipcMain.handle('invoice:payment-schedule-save', (_event, { invoiceId, milestones }: { invoiceId: string; milestones: any[] }) => {
    try {
      // Delete existing milestones for this invoice, then re-insert
      db.getDb().prepare('DELETE FROM invoice_payment_schedule WHERE invoice_id = ?').run(invoiceId);
      const inserted = milestones.map((m, idx) => {
        const row = db.create('invoice_payment_schedule', {
          id: m.id || undefined,
          invoice_id: invoiceId,
          milestone_label: m.milestone_label || '',
          due_date: m.due_date || '',
          amount: Number(m.amount || 0),
          paid: m.paid ? 1 : 0,
          sort_order: idx,
        });
        return row;
      });
      scheduleAutoBackup();
      return inserted;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── Client Contacts ──────────────────────────────────
  ipcMain.handle('client:contacts-list', (_event, clientId: string) => {
    try {
      return db.queryAll('client_contacts', { client_id: clientId }, { field: 'is_primary', dir: 'desc' });
    } catch { return []; }
  });

  ipcMain.handle('client:contacts-save', (_event, { clientId, contacts }: { clientId: string; contacts: any[] }) => {
    try {
      const saveContacts = db.getDb().transaction(() => {
        db.getDb().prepare('DELETE FROM client_contacts WHERE client_id = ?').run(clientId);
        return contacts.map((c) => db.create('client_contacts', {
          id: c.id || undefined,
          client_id: clientId,
          name: c.name || '',
          title: c.title || '',
          email: c.email || '',
          phone: c.phone || '',
          is_primary: c.is_primary ? 1 : 0,
        }));
      });
      const inserted = saveContacts();
      scheduleAutoBackup();
      return inserted;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── Debt Promises ────────────────────────────────────
  ipcMain.handle('debt:promises-list', (_event, debtId: string) => {
    try {
      return db.queryAll('debt_promises', { debt_id: debtId }, { field: 'promised_date', dir: 'desc' });
    } catch { return []; }
  });

  ipcMain.handle('debt:promise-save', (_event, data: Record<string, any>) => {
    try {
      const result = db.create('debt_promises', {
        debt_id: data.debt_id,
        promised_date: data.promised_date || '',
        promised_amount: Number(data.promised_amount || 0),
        kept: data.kept ? 1 : 0,
        notes: data.notes || '',
      });
      logDebtAudit(data.debt_id, 'promise_recorded', 'promised_date', '', (data.promised_date || '') + ' $' + (data.promised_amount || 0));
      scheduleAutoBackup();
      return result;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('debt:promise-update', (_event, { id, kept, notes }: { id: string; kept: boolean; notes?: string }) => {
    try {
      const promise = db.getDb().prepare('SELECT debt_id FROM debt_promises WHERE id = ?').get(id) as any;
      const result = db.update('debt_promises', id, { kept: kept ? 1 : 0, notes: notes || '' });
      if (promise?.debt_id) logDebtAudit(promise.debt_id, 'promise_updated', 'kept', '', kept ? 'kept' : 'broken');
      scheduleAutoBackup();
      return result;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── Debt Portfolio Report Data ───────────────────────
  ipcMain.handle('debt:portfolio-report-data', (_event, { companyId }: { companyId: string }) => {
    try {
      const dbConn = db.getDb();
      const debts = dbConn.prepare(`SELECT * FROM debts WHERE company_id = ? AND status != 'written_off'`).all(companyId);
      const payments = dbConn.prepare(`
        SELECT dp.*, d.company_id FROM debt_payments dp
        JOIN debts d ON dp.debt_id = d.id
        WHERE d.company_id = ?
      `).all(companyId);
      const today = new Date();
      const startOfYear = new Date(today.getFullYear(), 0, 1).toISOString().slice(0, 10);
      const paymentsYtd = payments.filter((p: any) => p.received_date >= startOfYear);
      const collectedYtd = paymentsYtd.reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
      return { debts, payments, collectedYtd };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── CSV Export ────────────────────────────────────────
  // ─── Auth ──────────────────────────────────────────────

  ipcMain.handle('auth:register', (_event, { email, password, displayName }: { email: string; password: string; displayName: string }) => {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Invalid email format' };
    if (!password || password.length < 6) return { error: 'Password must be at least 6 characters' };
    // Check if any users exist (first user becomes owner)
    const existing = db.runQuery('SELECT COUNT(*) as count FROM users');
    const isFirst = existing[0]?.count === 0;

    // Check email uniqueness
    const dup = db.runQuery('SELECT id FROM users WHERE email = ?', [email]);
    if (dup.length > 0) throw new Error('An account with this email already exists');

    const { hash } = hashPassword(password);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.execQuery(
      'INSERT INTO users (id, email, display_name, password_hash, role, last_login, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, email, displayName, hash, isFirst ? 'owner' : 'accountant', now, now, now]
    );

    // Also register on server (non-blocking)
    setLastLoginEmail(email);
    serverRegister(email, password, displayName, id);
    scheduleAutoBackup();

    return { id, email, display_name: displayName, role: isFirst ? 'owner' : 'accountant', avatar_color: '#3b82f6' };
  });

  ipcMain.handle('auth:login', async (_event, { email, password }: { email: string; password: string }) => {
    let rows = db.runQuery('SELECT * FROM users WHERE email = ?', [email]);

    // If user not found locally, try restoring from server backup
    if (rows.length === 0) {
      console.log('User not found locally, checking server for backup...');
      const backup = await downloadBackup(email);
      if (backup && backup.length > 1000) {
        // Restore the backup
        const dbPath = db.getDbPath();
        try {
          db.getDb().pragma('wal_checkpoint(TRUNCATE)');
        } catch (_) {}
        fs.writeFileSync(dbPath, backup);
        console.log(`Restored ${backup.length} byte backup from server for ${email}`);
        // Reinitialize database
        db.reinitDatabase();
        rows = db.runQuery('SELECT * FROM users WHERE email = ?', [email]);
      }
    }

    if (rows.length === 0) throw new Error('Invalid email or password');

    const user = rows[0];
    if (!verifyPassword(password, user.password_hash)) throw new Error('Invalid email or password');

    // Update last_login
    db.execQuery('UPDATE users SET last_login = ? WHERE id = ?', [new Date().toISOString(), user.id]);
    setLastLoginEmail(email);

    // Get user's companies
    const companies = db.runQuery(
      'SELECT c.*, uc.role as user_role FROM companies c JOIN user_companies uc ON c.id = uc.company_id WHERE uc.user_id = ?',
      [user.id]
    );

    // Upload current DB to server (non-blocking)
    scheduleAutoBackup();

    return {
      user: { id: user.id, email: user.email, display_name: user.display_name, role: user.role, avatar_color: user.avatar_color },
      companies,
    };
  });

  ipcMain.handle('auth:has-users', () => {
    try {
      const rows = db.runQuery('SELECT COUNT(*) as count FROM users');
      return rows[0]?.count > 0;
    } catch (err) {
      console.error('auth:has-users failed:', err);
      return false;
    }
  });

  ipcMain.handle('auth:list-users', () => {
    try {
      return db.runQuery('SELECT id, email, display_name, role, avatar_color, last_login FROM users ORDER BY created_at');
    } catch (err) {
      console.error('auth:list-users failed:', err);
      return [];
    }
  });

  ipcMain.handle('auth:link-user-company', (_event, { userId, companyId, role }: { userId: string; companyId: string; role?: string }) => {
    // SQLite's INSERT OR IGNORE does NOT suppress FOREIGN KEY violations — catch explicitly.
    // If the user doesn't exist in the DB (stale localStorage), skip the link gracefully.
    try {
      db.execQuery(
        'INSERT OR IGNORE INTO user_companies (user_id, company_id, role) VALUES (?, ?, ?)',
        [userId, companyId, role || 'owner']
      );
    } catch (_) {
      // FOREIGN KEY failure: user not in DB (stale session). Company still usable.
    }
    return true;
  });

  ipcMain.handle('auth:validate-session', (_event, { userId }: { userId: string }) => {
    try {
      const rows = db.runQuery('SELECT id, email, display_name, role, avatar_color FROM users WHERE id = ?', [userId]);
      return rows.length > 0 ? rows[0] : null;
    } catch {
      return null;
    }
  });

  ipcMain.handle('export:csv', async (_event, { table, filters }: { table: string; filters?: Record<string, any> }) => {
    if (!validateTable(table)) return { error: 'Invalid table' };
    const rows = db.queryAll(table, filters || {});
    if (rows.length === 0) return { error: 'No data to export' };

    const csv = rowsToCSV(rows);

    const { filePath } = await dialog.showSaveDialog({
      defaultPath: `${table}-export.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });

    if (!filePath) return { cancelled: true };
    fs.writeFileSync(filePath, csv, 'utf-8');
    return { path: filePath };
  });

  // ─── Batch Update ──────────────────────────────────────
  ipcMain.handle('batch:update', (_event, { table, ids, data }: { table: string; ids: string[]; data: Record<string, any> }) => {
    const companyId = db.getCurrentCompanyId();
    const results: any[] = [];
    for (const id of ids) {
      const old = db.getById(table, id);
      const record = db.update(table, id, data);
      if (companyId && old) {
        const changes: Record<string, any> = {};
        for (const key of Object.keys(data)) {
          if (old[key] !== record[key]) {
            changes[key] = { old: old[key], new: record[key] };
          }
        }
        db.logAudit(companyId, table, id, 'update', changes);
      }
      results.push(record);
    }
    return results;
  });

  // ─── Batch Delete ──────────────────────────────────────
  ipcMain.handle('batch:delete', (_event, { table, ids }: { table: string; ids: string[] }) => {
    const companyId = db.getCurrentCompanyId();
    for (const id of ids) {
      if (companyId) db.logAudit(companyId, table, id, 'delete');
      db.remove(table, id);
    }
    return { deleted: ids.length };
  });

  // ─── CSV Import: Preview ──────────────────────────────
  ipcMain.handle('import:preview-csv', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePaths.length) return null;

    const importPath = result.filePaths[0];
    const content = fs.readFileSync(importPath, 'utf-8');
    const { headers, rows } = parseCSV(content);

    return {
      filePath: importPath,
      fileName: path.basename(importPath),
      headers,
      previewRows: rows.slice(0, 5),
      totalRows: rows.length,
    };
  });

  // ─── CSV Import: Execute ──────────────────────────────
  ipcMain.handle('import:execute', (_event, {
    filePath: importFilePath,
    columnMapping,
    targetTable,
  }: {
    filePath: string;
    columnMapping: Record<string, string>;
    targetTable: string;
  }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { error: 'No company selected' };

    const content = fs.readFileSync(importFilePath, 'utf-8');
    const { headers, rows } = parseCSV(content);

    let imported = 0;
    let skipped = 0;
    const importErrors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      try {
        const row = rows[i];
        const record: Record<string, any> = { company_id: companyId };

        for (const [csvCol, dbCol] of Object.entries(columnMapping)) {
          if (!dbCol || dbCol === '(skip)') continue;
          const idx = headers.indexOf(csvCol);
          if (idx === -1) continue;
          record[dbCol] = row[idx] ?? '';
        }

        const hasData = Object.values(record).some(v => v !== '' && v !== companyId);
        if (!hasData) { skipped++; continue; }

        db.create(targetTable, record);
        imported++;
      } catch (err: any) {
        skipped++;
        importErrors.push(`Row ${i + 2}: ${err.message || 'Unknown error'}`);
      }
    }

    return { imported, skipped, errors: importErrors.slice(0, 20), total: rows.length };
  });

  // ─── Full Backup: Export all tables as ZIP ─────────────
  ipcMain.handle('export:full-backup', async () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { error: 'No company selected' };

    const { filePath: zipPath } = await dialog.showSaveDialog({
      defaultPath: `backup-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
    });

    if (!zipPath) return { cancelled: true };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bap-backup-'));

    // Tables with direct company_id column
    const directTables = [
      'clients', 'invoices', 'expenses', 'vendors', 'accounts',
      'journal_entries', 'projects', 'employees', 'time_entries',
      'categories', 'payments', 'budgets', 'bank_accounts', 'documents',
      'recurring_templates', 'tax_categories', 'tax_payments', 'inventory_items',
    ];

    // Child tables without company_id — filter through parent FK
    const childTableQueries: Record<string, string> = {
      invoice_line_items: `SELECT li.* FROM invoice_line_items li
        JOIN invoices i ON li.invoice_id = i.id WHERE i.company_id = ?`,
      journal_entry_lines: `SELECT jl.* FROM journal_entry_lines jl
        JOIN journal_entries je ON jl.journal_entry_id = je.id WHERE je.company_id = ?`,
      pay_stubs: `SELECT ps.* FROM pay_stubs ps
        JOIN payroll_runs pr ON ps.payroll_run_id = pr.id WHERE pr.company_id = ?`,
      budget_lines: `SELECT bl.* FROM budget_lines bl
        JOIN budgets b ON bl.budget_id = b.id WHERE b.company_id = ?`,
      bank_transactions: `SELECT bt.* FROM bank_transactions bt
        JOIN bank_accounts ba ON bt.bank_account_id = ba.id WHERE ba.company_id = ?`,
    };

    const exportedFiles: string[] = [];
    const dbInstance = db.getDb();

    // Export direct-company tables
    for (const tbl of directTables) {
      try {
        const tblRows = db.queryAll(tbl, { company_id: companyId });
        if (tblRows.length === 0) continue;
        const csvContent = rowsToCSV(tblRows);
        const csvFilePath = path.join(tmpDir, `${tbl}.csv`);
        fs.writeFileSync(csvFilePath, csvContent, 'utf-8');
        exportedFiles.push(csvFilePath);
      } catch {
        // Skip tables that error (schema mismatch, etc.)
      }
    }

    // Export child tables filtered via parent join
    for (const [tbl, sql] of Object.entries(childTableQueries)) {
      try {
        const tblRows = dbInstance.prepare(sql).all(companyId) as any[];
        if (tblRows.length === 0) continue;
        const csvContent = rowsToCSV(tblRows);
        const csvFilePath = path.join(tmpDir, `${tbl}.csv`);
        fs.writeFileSync(csvFilePath, csvContent, 'utf-8');
        exportedFiles.push(csvFilePath);
      } catch {
        // Skip on error
      }
    }

    if (exportedFiles.length === 0) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return { error: 'No data to export' };
    }

    try {
      const { execFileSync } = require('child_process');
      const fileNames = exportedFiles.map(f => path.basename(f));
      execFileSync('zip', ['-j', zipPath, ...fileNames], { cwd: tmpDir });
    } catch {
      const fallbackDir = zipPath.replace('.zip', '-csvs');
      if (!fs.existsSync(fallbackDir)) fs.mkdirSync(fallbackDir, { recursive: true });
      for (const f of exportedFiles) {
        fs.copyFileSync(f, path.join(fallbackDir, path.basename(f)));
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return { path: fallbackDir, format: 'folder' };
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
    return { path: zipPath, format: 'zip', tableCount: exportedFiles.length };
  });

  // ─── Recurring Transaction Processing ────────────────
  ipcMain.handle('recurring:process-now', () => {
    const companyId = db.getCurrentCompanyId();
    return processRecurringTemplates(companyId || undefined);
  });

  ipcMain.handle('recurring:last-processed', () => {
    return getLastProcessedAt();
  });

  ipcMain.handle('recurring:history', (_event, opts?: { templateId?: string }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return [];
    return getRecurringHistory(companyId, opts?.templateId);
  });

  // ─── Notification Engine ─────────────────────────────
  ipcMain.handle('notification:run-checks', () => {
    const companyId = db.getCurrentCompanyId();
    return runNotificationChecks(companyId || undefined);
  });

  ipcMain.handle('notification:clear-all', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return;
    const dbInstance = db.getDb();
    dbInstance.prepare(
      "DELETE FROM notifications WHERE company_id = ? AND is_read = 1"
    ).run(companyId);
  });

  ipcMain.handle('notification:dismiss', (_event, id: string) => {
    db.remove('notifications', id);
  });

  ipcMain.handle('notification:preferences', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return {};
    return getNotificationPreferences(companyId);
  });

  ipcMain.handle('notification:update-preferences', (_event, prefs: Record<string, boolean>) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return;
    updateNotificationPreferences(companyId, prefs);
  });

  // ─── Enhanced Dashboard Activity ─────────────────────
  ipcMain.handle('dashboard:activity', (_event, opts?: { entityType?: string; limit?: number }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return [];
    const dbInstance = db.getDb();

    let sql = `
      SELECT al.*,
        CASE
          WHEN al.entity_type = 'invoices' THEN (
            SELECT json_object('invoice_number', i.invoice_number, 'total', i.total, 'client_name', c.name)
            FROM invoices i LEFT JOIN clients c ON i.client_id = c.id WHERE i.id = al.entity_id
          )
          WHEN al.entity_type = 'expenses' THEN (
            SELECT json_object('description', e.description, 'amount', e.amount, 'vendor_name', v.name)
            FROM expenses e LEFT JOIN vendors v ON e.vendor_id = v.id WHERE e.id = al.entity_id
          )
          WHEN al.entity_type = 'clients' THEN (
            SELECT json_object('name', cl.name, 'email', cl.email)
            FROM clients cl WHERE cl.id = al.entity_id
          )
          WHEN al.entity_type = 'payments' THEN (
            SELECT json_object('amount', p.amount, 'invoice_number', i.invoice_number)
            FROM payments p LEFT JOIN invoices i ON p.invoice_id = i.id WHERE p.id = al.entity_id
          )
          ELSE NULL
        END as entity_details
      FROM audit_log al
      WHERE al.company_id = ?
    `;
    const params: any[] = [companyId];

    if (opts?.entityType && opts.entityType !== 'all') {
      sql += ' AND al.entity_type = ?';
      params.push(opts.entityType);
    }

    sql += ' ORDER BY al.timestamp DESC LIMIT ?';
    params.push(opts?.limit || 15);

    return dbInstance.prepare(sql).all(...params);
  });

  // ─── Journal Entry Auto-Number ───────────────────────────
  // Bug fix: journal_entries.entry_number is NOT NULL + UNIQUE; nothing in
  // the generic db:create path generates it, so every create crashed.
  ipcMain.handle('journal:next-number', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return 'JE-1001';
    const dbInstance = db.getDb();
    const row = dbInstance.prepare(
      "SELECT entry_number FROM journal_entries WHERE company_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get(companyId) as any;
    if (row?.entry_number) {
      const match = row.entry_number.match(/(\d+)$/);
      if (match) {
        const next = parseInt(match[1], 10) + 1;
        const prefix = row.entry_number.slice(0, row.entry_number.length - match[1].length);
        return `${prefix}${String(next).padStart(match[1].length, '0')}`;
      }
    }
    return 'JE-1001';
  });

  // ─── Invoice Record Payment ───────────────────────────────
  // Consolidated handler: creates payment record, updates invoice status,
  // and posts DR Cash / CR Accounts Receivable journal entry in one transaction.
  ipcMain.handle('invoice:record-payment', (_event, { invoiceId, amount, date, method, reference }: any) => {
    if (!amount || amount <= 0) return { error: 'Amount must be greater than zero' };
    const companyId = db.getCurrentCompanyId();
    if (!companyId) throw new Error('No active company');
    const dbInstance = db.getDb();

    const tx = (dbInstance as any).transaction(() => {
      const paymentId = uuid();
      (dbInstance as any).prepare(`
        INSERT INTO payments (id, company_id, invoice_id, amount, date, payment_method, reference)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(paymentId, companyId, invoiceId, amount, date, method || 'transfer', reference || '');

      const invoice = (dbInstance as any).prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId) as any;
      if (!invoice) throw new Error('Invoice not found');

      const newAmountPaid = (invoice.amount_paid || 0) + amount;
      const newStatus = newAmountPaid >= invoice.total ? 'paid' : 'partial';

      (dbInstance as any).prepare(`UPDATE invoices SET amount_paid = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(newAmountPaid, newStatus, invoiceId);

      postJournalEntry(dbInstance, companyId, date, `Payment received - ${invoice.invoice_number}`, [
        { nameHint: 'Cash', debit: amount, credit: 0, note: `Cash received for ${invoice.invoice_number}` },
        { nameHint: 'Receivable', debit: 0, credit: amount, note: `Clear AR for ${invoice.invoice_number}` },
      ]);

      return { paymentId, newStatus, newAmountPaid };
    });

    return tx();
  });

  // ─── Payroll YTD Totals ───────────────────────────────────
  // Bug fix: PayrollRunner always set ytd_gross/taxes/net to 0 because
  // there was no backend call to fetch cumulative YTD from existing stubs.
  ipcMain.handle('payroll:ytd-totals', (_event, { employeeId, year }: { employeeId: string; year: number }) => {
    const dbInstance = db.getDb();
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const row = dbInstance.prepare(`
      SELECT
        COALESCE(SUM(ps.gross_pay), 0) AS ytd_gross,
        COALESCE(SUM(ps.federal_tax + ps.state_tax + ps.social_security + ps.medicare), 0) AS ytd_taxes,
        COALESCE(SUM(ps.net_pay), 0) AS ytd_net
      FROM pay_stubs ps
      JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
      WHERE ps.employee_id = ?
        AND pr.pay_date >= ?
        AND pr.pay_date <= ?
        AND pr.status != 'draft'
    `).get(employeeId, yearStart, yearEnd) as any;
    return {
      ytd_gross: row?.ytd_gross ?? 0,
      ytd_taxes: row?.ytd_taxes ?? 0,
      ytd_net: row?.ytd_net ?? 0,
    };
  });

  // ─── Payroll Process (with journal entry) ────────────────────
  // Creates payroll_run + pay_stubs in a transaction and posts
  // DR Wages/Salary Expense / CR Wages Payable journal entry.
  ipcMain.handle('payroll:process', (_event, {
    periodStart, periodEnd, payDate,
    totalGross, totalTaxes, totalNet,
    stubs, // Array<{ employeeId, hours, grossPay, federalTax, stateTax, ss, medicare, netPay, ytdGross, ytdTaxes, ytdNet, preTaxDeductions?, postTaxDeductions?, deductionDetail? }>
    runType,
  }: any) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) throw new Error('No active company');
    const dbInstance = db.getDb();

    // BUG 1: Check for duplicate payroll run
    const existingRun = (dbInstance as any).prepare(
      `SELECT id FROM payroll_runs WHERE company_id = ? AND pay_period_start = ? AND pay_period_end = ?`
    ).get(companyId, periodStart, periodEnd) as any;
    if (existingRun) {
      return { error: 'A payroll run already exists for this period. Delete the existing run first to reprocess.' };
    }

    const tx = (dbInstance as any).transaction(() => {
      const runId = uuid();
      (dbInstance as any).prepare(`
        INSERT INTO payroll_runs (id, company_id, pay_period_start, pay_period_end, pay_date, status, total_gross, total_taxes, total_deductions, total_net, run_type)
        VALUES (?, ?, ?, ?, ?, 'processed', ?, ?, 0, ?, ?)
      `).run(runId, companyId, periodStart, periodEnd, payDate, totalGross, totalTaxes, totalNet, runType || 'regular');

      for (const s of stubs) {
        (dbInstance as any).prepare(`
          INSERT INTO pay_stubs (id, payroll_run_id, employee_id, hours_regular, hours_overtime, gross_pay, federal_tax, state_tax, social_security, medicare, other_deductions, net_pay, ytd_gross, ytd_taxes, ytd_net, pretax_deductions, posttax_deductions, deduction_detail)
          VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
        `).run(uuid(), runId, s.employeeId, s.hours, s.grossPay, s.federalTax, s.stateTax, s.ss, s.medicare, s.netPay, s.ytdGross, s.ytdTaxes, s.ytdNet, s.preTaxDeductions || 0, s.postTaxDeductions || 0, s.deductionDetail || '{}');
      }

      // BUG 4: Break out taxes into separate GL lines instead of single lumped "Tax" line
      const totalFederalTax = stubs.reduce((sum: number, s: any) => sum + (s.federalTax || 0), 0);
      const totalStateTax = stubs.reduce((sum: number, s: any) => sum + (s.stateTax || 0), 0);
      const totalSS = stubs.reduce((sum: number, s: any) => sum + (s.ss || 0), 0);
      const totalMedicare = stubs.reduce((sum: number, s: any) => sum + (s.medicare || 0), 0);

      postJournalEntry(dbInstance, companyId, payDate, `Payroll - ${periodStart} to ${periodEnd}`, [
        { nameHint: 'Wages Expense', debit: totalGross, credit: 0, note: 'Gross wages' },
        { nameHint: 'Wages Payable', debit: 0, credit: totalNet, note: 'Net wages payable' },
        { nameHint: 'Federal Withholding', debit: 0, credit: totalFederalTax, note: 'Federal income tax withheld' },
        { nameHint: 'State Withholding', debit: 0, credit: totalStateTax, note: 'State income tax withheld' },
        { nameHint: 'Social Security Payable', debit: 0, credit: totalSS, note: 'Employee SS withholding' },
        { nameHint: 'Medicare Payable', debit: 0, credit: totalMedicare, note: 'Employee Medicare withholding' },
      ]);

      return { runId };
    });

    const result = tx();
    scheduleAutoBackup();
    return result;
  });

  // ─── Settings get / set ───────────────────────────────────
  // Bug fix: settings module queried all companies' settings because
  // api.query('settings') had no company_id filter; also needed
  // a key-value interface to read/write individual settings cleanly.
  ipcMain.handle('settings:get', (_event, key: string) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    const dbInstance = db.getDb();
    const row = dbInstance.prepare(
      "SELECT value FROM settings WHERE company_id = ? AND key = ?"
    ).get(companyId, key) as any;
    return row?.value ?? null;
  });

  ipcMain.handle('settings:set', (_event, { key, value }: { key: string; value: string }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return;
    const dbInstance = db.getDb();
    const existing = dbInstance.prepare(
      "SELECT id FROM settings WHERE company_id = ? AND key = ?"
    ).get(companyId, key) as any;
    if (existing) {
      dbInstance.prepare(
        "UPDATE settings SET value = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(value, existing.id);
    } else {
      db.create('settings', { company_id: companyId, key, value });
    }
  });

  // ─── Settings list (company-scoped) ──────────────────────
  // Bug fix: api.query('settings') returned all companies' settings.
  // This handler scopes to the current company.
  ipcMain.handle('settings:list', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return [];
    return db.queryAll('settings', { company_id: companyId });
  });

  // ─── Print / Preview System ─────────────────────────────
  ipcMain.handle('print:preview', (_event, { html, title }: { html: string; title: string }) => {
    openPrintPreview(html, title);
    return { success: true };
  });

  ipcMain.handle('print:save-pdf', async (
    _event,
    {
      html,
      title,
      doctype,
      identifier,
      pdfOptions,
      openAfterSave,
      revealAfterSave,
    }: {
      html: string;
      title: string;
      doctype?: string;
      identifier?: string;
      pdfOptions?: PDFOptions;
      openAfterSave?: boolean;
      revealAfterSave?: boolean;
    }
  ) => {
    const defaultFilename = buildPdfFilename(doctype || 'document', identifier || title);
    const result = await saveHTMLAsPDF(html, title, { ...pdfOptions, defaultFilename });
    if (result.path) {
      if (openAfterSave) {
        const err = await openPathInOS(result.path);
        if (err) console.warn('openPath failed:', err);
      } else if (revealAfterSave) {
        revealInFolder(result.path);
      }
    }
    return result;
  });

  ipcMain.handle('print:print', async (_event, { html }: { html: string }) => {
    try {
      await printHTML(html);
      return { success: true };
    } catch (err: any) {
      return { error: err?.message || 'Print failed' };
    }
  });

  // ═══════════════════════════════════════════════════════════
  // ENTERPRISE FEATURES v2.0
  // ═══════════════════════════════════════════════════════════

  // ─── Financial Reports ────────────────────────────────────

  ipcMain.handle('reports:profit-loss', (_event, { startDate, endDate }: { startDate: string; endDate: string }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    const dbInstance = db.getDb();

    // Revenue accounts
    const revenue = dbInstance.prepare(`
      SELECT a.id, a.code, a.name, a.subtype,
        COALESCE(SUM(jel.credit - jel.debit), 0) as net_amount
      FROM accounts a
      LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
      LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
        AND je.company_id = ? AND je.is_posted = 1
        AND je.date >= ? AND je.date <= ?
      WHERE a.company_id = ? AND a.type = 'revenue' AND a.is_active = 1
      GROUP BY a.id ORDER BY a.code
    `).all(companyId, startDate, endDate, companyId) as any[];

    // COGS accounts (expense subtype = cogs)
    const cogs = dbInstance.prepare(`
      SELECT a.id, a.code, a.name, a.subtype,
        COALESCE(SUM(jel.debit - jel.credit), 0) as net_amount
      FROM accounts a
      LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
      LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
        AND je.company_id = ? AND je.is_posted = 1
        AND je.date >= ? AND je.date <= ?
      WHERE a.company_id = ? AND a.type = 'expense'
        AND (a.subtype LIKE '%cogs%' OR a.subtype LIKE '%cost_of%')
        AND a.is_active = 1
      GROUP BY a.id ORDER BY a.code
    `).all(companyId, startDate, endDate, companyId) as any[];

    // Operating expense accounts
    const expenses = dbInstance.prepare(`
      SELECT a.id, a.code, a.name, a.subtype,
        COALESCE(SUM(jel.debit - jel.credit), 0) as net_amount
      FROM accounts a
      LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
      LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
        AND je.company_id = ? AND je.is_posted = 1
        AND je.date >= ? AND je.date <= ?
      WHERE a.company_id = ? AND a.type = 'expense'
        AND a.subtype NOT LIKE '%cogs%' AND a.subtype NOT LIKE '%cost_of%'
        AND a.is_active = 1
      GROUP BY a.id ORDER BY a.code
    `).all(companyId, startDate, endDate, companyId) as any[];

    // Also pull from invoices/expenses tables (cash-basis supplement)
    const cashRevenue = dbInstance.prepare(`
      SELECT COALESCE(SUM(amount_paid), 0) as total
      FROM invoices WHERE company_id = ? AND status IN ('paid','partial')
        AND issue_date >= ? AND issue_date <= ?
    `).get(companyId, startDate, endDate) as any;

    const cashExpenses = dbInstance.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total
      FROM expenses WHERE company_id = ? AND date >= ? AND date <= ?
    `).get(companyId, startDate, endDate) as any;

    const totalRevenue = revenue.reduce((s: number, r: any) => s + (r.net_amount || 0), 0);
    const totalCogs = cogs.reduce((s: number, r: any) => s + (r.net_amount || 0), 0);
    const totalExpenses = expenses.reduce((s: number, r: any) => s + (r.net_amount || 0), 0);
    const grossProfit = totalRevenue - totalCogs;
    const operatingIncome = grossProfit - totalExpenses;

    return {
      startDate, endDate,
      revenue,
      cogs,
      expenses,
      totalRevenue,
      totalCogs,
      grossProfit,
      totalExpenses,
      operatingIncome,
      netIncome: operatingIncome,
      // Cash-basis supplements (used when GL has no posted entries)
      cashRevenue: cashRevenue?.total || 0,
      cashExpenses: cashExpenses?.total || 0,
    };
  });

  ipcMain.handle('reports:balance-sheet', (_event, { asOfDate }: { asOfDate: string }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    const dbInstance = db.getDb();

    const getAccountBalances = (type: string) => dbInstance.prepare(`
      SELECT a.id, a.code, a.name, a.subtype, a.parent_id,
        COALESCE(a.balance, 0) +
        COALESCE((
          SELECT SUM(jel.debit - jel.credit)
          FROM journal_entry_lines jel
          JOIN journal_entries je ON je.id = jel.journal_entry_id
          WHERE jel.account_id = a.id AND je.company_id = ? AND je.is_posted = 1 AND je.date <= ?
        ), 0) as balance
      FROM accounts a
      WHERE a.company_id = ? AND a.type = ? AND a.is_active = 1
      ORDER BY a.code
    `).all(companyId, asOfDate, companyId, type) as any[];

    const assets = getAccountBalances('asset');
    const liabilities = getAccountBalances('liability');
    const equity = getAccountBalances('equity');

    // Retained earnings = cumulative net income
    const retainedEarnings = dbInstance.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN a.type = 'revenue' THEN jel.credit - jel.debit ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN a.type = 'expense' THEN jel.debit - jel.credit ELSE 0 END), 0) as retained
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.journal_entry_id
      JOIN accounts a ON a.id = jel.account_id
      WHERE je.company_id = ? AND je.is_posted = 1 AND je.date <= ?
    `).get(companyId, asOfDate) as any;

    const totalAssets = assets.reduce((s: number, a: any) => s + (a.balance || 0), 0);
    const totalLiabilities = liabilities.reduce((s: number, a: any) => s + Math.abs(a.balance || 0), 0);
    const totalEquity = equity.reduce((s: number, a: any) => s + Math.abs(a.balance || 0), 0);
    const retained = retainedEarnings?.retained || 0;

    return {
      asOfDate,
      assets,
      liabilities,
      equity,
      totalAssets,
      totalLiabilities,
      totalEquity,
      retainedEarnings: retained,
      totalLiabilitiesAndEquity: totalLiabilities + totalEquity + retained,
    };
  });

  ipcMain.handle('reports:trial-balance', (_event, { startDate, endDate }: { startDate: string; endDate: string }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    const dbInstance = db.getDb();

    const rows = dbInstance.prepare(`
      SELECT
        a.code, a.name, a.type, a.subtype,
        COALESCE(SUM(CASE WHEN je.date >= ? THEN jel.debit ELSE 0 END), 0) as period_debit,
        COALESCE(SUM(CASE WHEN je.date >= ? THEN jel.credit ELSE 0 END), 0) as period_credit,
        COALESCE(SUM(jel.debit), 0) as total_debit,
        COALESCE(SUM(jel.credit), 0) as total_credit,
        COALESCE(a.balance, 0) as opening_balance
      FROM accounts a
      LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
      LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
        AND je.company_id = ? AND je.is_posted = 1 AND je.date <= ?
      WHERE a.company_id = ? AND a.is_active = 1
      GROUP BY a.id
      HAVING total_debit > 0 OR total_credit > 0 OR opening_balance != 0
      ORDER BY a.type, a.code
    `).all(startDate, startDate, companyId, endDate, companyId) as any[];

    const totalDebits = rows.reduce((s: number, r: any) => s + (r.period_debit || 0), 0);
    const totalCredits = rows.reduce((s: number, r: any) => s + (r.period_credit || 0), 0);

    return { startDate, endDate, rows, totalDebits, totalCredits, isBalanced: Math.abs(totalDebits - totalCredits) < 0.01 };
  });

  ipcMain.handle('reports:ar-aging', (_event, { asOfDate }: { asOfDate: string }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    const dbInstance = db.getDb();

    const invoices = dbInstance.prepare(`
      SELECT i.*, c.name as client_name,
        CAST(julianday(?) - julianday(i.due_date) AS INTEGER) as days_overdue,
        i.total - i.amount_paid as balance_due
      FROM invoices i
      JOIN clients c ON c.id = i.client_id
      WHERE i.company_id = ? AND i.status IN ('sent','partial','overdue')
        AND i.issue_date <= ? AND (i.total - i.amount_paid) > 0
      ORDER BY i.due_date ASC
    `).all(asOfDate, companyId, asOfDate) as any[];

    const buckets = {
      current: [] as any[],
      days1_30: [] as any[],
      days31_60: [] as any[],
      days61_90: [] as any[],
      over90: [] as any[],
    };

    let totalCurrent = 0, total1_30 = 0, total31_60 = 0, total61_90 = 0, totalOver90 = 0;

    for (const inv of invoices) {
      const days = inv.days_overdue || 0;
      const bal = inv.balance_due || 0;
      if (days <= 0) { buckets.current.push(inv); totalCurrent += bal; }
      else if (days <= 30) { buckets.days1_30.push(inv); total1_30 += bal; }
      else if (days <= 60) { buckets.days31_60.push(inv); total31_60 += bal; }
      else if (days <= 90) { buckets.days61_90.push(inv); total61_90 += bal; }
      else { buckets.over90.push(inv); totalOver90 += bal; }
    }

    return {
      asOfDate, buckets,
      totals: { current: totalCurrent, days1_30: total1_30, days31_60: total31_60, days61_90: total61_90, over90: totalOver90 },
      grandTotal: totalCurrent + total1_30 + total31_60 + total61_90 + totalOver90,
    };
  });

  ipcMain.handle('reports:ap-aging', (_event, { asOfDate }: { asOfDate: string }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    const dbInstance = db.getDb();

    const bills = dbInstance.prepare(`
      SELECT b.*, v.name as vendor_name,
        CAST(julianday(?) - julianday(b.due_date) AS INTEGER) as days_overdue,
        b.total - b.amount_paid as balance_due
      FROM bills b
      LEFT JOIN vendors v ON v.id = b.vendor_id
      WHERE b.company_id = ? AND b.status IN ('received','approved','partial','overdue')
        AND (b.total - b.amount_paid) > 0
      ORDER BY b.due_date ASC
    `).all(asOfDate, companyId) as any[];

    const buckets = { current: [] as any[], days1_30: [] as any[], days31_60: [] as any[], days61_90: [] as any[], over90: [] as any[] };
    let totalCurrent = 0, total1_30 = 0, total31_60 = 0, total61_90 = 0, totalOver90 = 0;

    for (const bill of bills) {
      const days = bill.days_overdue || 0;
      const bal = bill.balance_due || 0;
      if (days <= 0) { buckets.current.push(bill); totalCurrent += bal; }
      else if (days <= 30) { buckets.days1_30.push(bill); total1_30 += bal; }
      else if (days <= 60) { buckets.days31_60.push(bill); total31_60 += bal; }
      else if (days <= 90) { buckets.days61_90.push(bill); total61_90 += bal; }
      else { buckets.over90.push(bill); totalOver90 += bal; }
    }

    return {
      asOfDate, buckets,
      totals: { current: totalCurrent, days1_30: total1_30, days31_60: total31_60, days61_90: total61_90, over90: totalOver90 },
      grandTotal: totalCurrent + total1_30 + total31_60 + total61_90 + totalOver90,
    };
  });

  ipcMain.handle('reports:general-ledger', (_event, { startDate, endDate, accountId }: { startDate: string; endDate: string; accountId?: string }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    const dbInstance = db.getDb();

    let sql = `
      SELECT
        a.code as account_code, a.name as account_name, a.type as account_type,
        je.date, je.entry_number, je.description as entry_description, je.reference,
        jel.description as line_description, jel.debit, jel.credit,
        jel.account_id
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.journal_entry_id
      JOIN accounts a ON a.id = jel.account_id
      WHERE je.company_id = ? AND je.is_posted = 1
        AND je.date >= ? AND je.date <= ?
    `;
    const params: any[] = [companyId, startDate, endDate];

    if (accountId) {
      sql += ' AND jel.account_id = ?';
      params.push(accountId);
    }
    sql += ' ORDER BY a.code, je.date, je.entry_number';

    const lines = dbInstance.prepare(sql).all(...params) as any[];

    // Group by account
    const byAccount: Record<string, { account_code: string; account_name: string; account_type: string; lines: any[]; totalDebit: number; totalCredit: number; netBalance: number }> = {};
    for (const line of lines) {
      const key = line.account_id;
      if (!byAccount[key]) {
        byAccount[key] = {
          account_code: line.account_code,
          account_name: line.account_name,
          account_type: line.account_type,
          lines: [],
          totalDebit: 0,
          totalCredit: 0,
          netBalance: 0,
        };
      }
      byAccount[key].lines.push(line);
      byAccount[key].totalDebit += line.debit || 0;
      byAccount[key].totalCredit += line.credit || 0;
      byAccount[key].netBalance = byAccount[key].totalDebit - byAccount[key].totalCredit;
    }

    return { startDate, endDate, accounts: Object.values(byAccount) };
  });

  ipcMain.handle('reports:vendor-spend', (_event, { startDate, endDate }: { startDate: string; endDate: string }) => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return [];
      return db.getDb().prepare(`
        SELECT v.id, v.name as vendor_name,
          COUNT(e.id) as transaction_count,
          COALESCE(SUM(e.amount), 0) as total_spend,
          COALESCE(AVG(e.amount), 0) as avg_transaction,
          MIN(e.date) as first_transaction,
          MAX(e.date) as last_transaction
        FROM vendors v
        LEFT JOIN expenses e ON e.vendor_id = v.id AND e.company_id = ? AND e.date BETWEEN ? AND ?
        WHERE v.company_id = ?
        GROUP BY v.id, v.name
        HAVING total_spend > 0
        ORDER BY total_spend DESC
      `).all(companyId, startDate, endDate, companyId);
    } catch (err: any) {
      return [];
    }
  });

  ipcMain.handle('reports:cash-flow', (_event, { startDate, endDate }: { startDate: string; endDate: string }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    const dbInstance = db.getDb();

    // Operating: cash received from customers
    const cashFromCustomers = dbInstance.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM payments
      WHERE company_id = ? AND date >= ? AND date <= ?
    `).get(companyId, startDate, endDate) as any;

    // Operating: cash paid to vendors (expenses)
    const cashToVendors = dbInstance.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM expenses
      WHERE company_id = ? AND date >= ? AND date <= ? AND status IN ('paid','approved')
    `).get(companyId, startDate, endDate) as any;

    // Operating: cash paid for bills
    const cashToBills = dbInstance.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM bill_payments
      WHERE company_id = ? AND date >= ? AND date <= ?
    `).get(companyId, startDate, endDate) as any;

    // Investing: asset purchases
    const assetPurchases = dbInstance.prepare(`
      SELECT COALESCE(SUM(purchase_price), 0) as total FROM fixed_assets
      WHERE company_id = ? AND purchase_date >= ? AND purchase_date <= ?
    `).get(companyId, startDate, endDate) as any;

    // Investing: asset disposals
    const assetDisposals = dbInstance.prepare(`
      SELECT COALESCE(SUM(disposal_amount), 0) as total FROM fixed_assets
      WHERE company_id = ? AND disposal_date >= ? AND disposal_date <= ? AND status = 'disposed'
    `).get(companyId, startDate, endDate) as any;

    const operatingInflows = cashFromCustomers?.total || 0;
    const operatingOutflows = (cashToVendors?.total || 0) + (cashToBills?.total || 0);
    const netOperating = operatingInflows - operatingOutflows;

    const investingInflows = assetDisposals?.total || 0;
    const investingOutflows = assetPurchases?.total || 0;
    const netInvesting = investingInflows - investingOutflows;

    // Financing: loan proceeds (credits to liability accounts = cash in)
    const loanProceeds = dbInstance.prepare(`
      SELECT COALESCE(SUM(jel.credit), 0) as total
      FROM journal_entry_lines jel
      JOIN journal_entries je ON jel.journal_entry_id = je.id
      JOIN accounts a ON jel.account_id = a.id
      WHERE je.company_id = ? AND je.date >= ? AND je.date <= ?
        AND a.type IN ('liability') AND a.subtype IN ('long_term_liability','notes_payable','loan')
    `).get(companyId, startDate, endDate) as any;

    // Financing: loan repayments (debits to liability accounts = cash out)
    const loanRepayments = dbInstance.prepare(`
      SELECT COALESCE(SUM(jel.debit), 0) as total
      FROM journal_entry_lines jel
      JOIN journal_entries je ON jel.journal_entry_id = je.id
      JOIN accounts a ON jel.account_id = a.id
      WHERE je.company_id = ? AND je.date >= ? AND je.date <= ?
        AND a.type IN ('liability') AND a.subtype IN ('long_term_liability','notes_payable','loan')
    `).get(companyId, startDate, endDate) as any;

    // Financing: owner contributions (credits to equity = cash in)
    const equityContributions = dbInstance.prepare(`
      SELECT COALESCE(SUM(jel.credit), 0) as total
      FROM journal_entry_lines jel
      JOIN journal_entries je ON jel.journal_entry_id = je.id
      JOIN accounts a ON jel.account_id = a.id
      WHERE je.company_id = ? AND je.date >= ? AND je.date <= ?
        AND a.type = 'equity' AND a.subtype NOT IN ('retained_earnings','net_income')
    `).get(companyId, startDate, endDate) as any;

    // Financing: owner distributions (debits to equity = cash out)
    const equityDistributions = dbInstance.prepare(`
      SELECT COALESCE(SUM(jel.debit), 0) as total
      FROM journal_entry_lines jel
      JOIN journal_entries je ON jel.journal_entry_id = je.id
      JOIN accounts a ON jel.account_id = a.id
      WHERE je.company_id = ? AND je.date >= ? AND je.date <= ?
        AND a.type = 'equity' AND a.subtype NOT IN ('retained_earnings','net_income')
    `).get(companyId, startDate, endDate) as any;

    const financingInflows = (loanProceeds?.total || 0) + (equityContributions?.total || 0);
    const financingOutflows = (loanRepayments?.total || 0) + (equityDistributions?.total || 0);
    const netFinancing = financingInflows - financingOutflows;

    const netChange = netOperating + netInvesting + netFinancing;

    // Opening cash
    const openingCash = dbInstance.prepare(`
      SELECT COALESCE(SUM(current_balance), 0) as total FROM bank_accounts WHERE company_id = ?
    `).get(companyId) as any;

    return {
      startDate, endDate,
      operating: {
        inflows: [{ label: 'Cash received from customers', amount: operatingInflows }],
        outflows: [
          { label: 'Payments to vendors (expenses)', amount: cashToVendors?.total || 0 },
          { label: 'Payments to vendors (bills)', amount: cashToBills?.total || 0 },
        ],
        net: netOperating,
      },
      investing: {
        inflows: [{ label: 'Proceeds from asset disposals', amount: investingInflows }],
        outflows: [{ label: 'Purchase of fixed assets', amount: investingOutflows }],
        net: netInvesting,
      },
      financing: {
        inflows: [
          { label: 'Proceeds from loans / borrowings', amount: loanProceeds?.total || 0 },
          { label: 'Owner / equity contributions', amount: equityContributions?.total || 0 },
        ],
        outflows: [
          { label: 'Loan repayments', amount: loanRepayments?.total || 0 },
          { label: 'Owner distributions / dividends', amount: equityDistributions?.total || 0 },
        ],
        net: netFinancing,
      },
      netChange,
      openingCash: openingCash?.total || 0,
      closingCash: (openingCash?.total || 0) + netChange,
    };
  });

  // ─── Bills / Accounts Payable ─────────────────────────────

  ipcMain.handle('bills:next-number', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return 'BILL-1001';
    const dbInstance = db.getDb();
    const row = dbInstance.prepare(`
      SELECT bill_number FROM bills WHERE company_id = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(companyId) as any;
    if (!row) return 'BILL-1001';
    const match = row.bill_number.match(/(\d+)$/);
    if (!match) return 'BILL-1001';
    const next = parseInt(match[1], 10) + 1;
    const prefix = row.bill_number.replace(/\d+$/, '');
    return `${prefix}${String(next).padStart(4, '0')}`;
  });

  ipcMain.handle('bills:pay', (_event, { billId, amount, date, accountId, paymentMethod, reference, notes }: any) => {
    if (!amount || amount <= 0) return { error: 'Amount must be greater than zero' };
    const companyId = db.getCurrentCompanyId();
    if (!companyId) throw new Error('No active company');
    const dbInstance = db.getDb();

    const payTx = dbInstance.transaction(() => {
      const paymentId = uuid();
      dbInstance.prepare(`
        INSERT INTO bill_payments (id, company_id, bill_id, amount, date, payment_method, reference, account_id, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(paymentId, companyId, billId, amount, date, paymentMethod || 'check', reference || '', accountId || null, notes || '');

      const bill = dbInstance.prepare('SELECT * FROM bills WHERE id = ?').get(billId) as any;
      if (!bill) throw new Error('Bill not found');

      const newAmountPaid = (bill.amount_paid || 0) + amount;
      let newStatus = bill.status;
      if (newAmountPaid >= bill.total) {
        newStatus = 'paid';
      } else if (newAmountPaid > 0) {
        newStatus = 'partial';
      }

      dbInstance.prepare(`UPDATE bills SET amount_paid = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(newAmountPaid, newStatus, billId);

      postJournalEntry(dbInstance, companyId, date, `Bill payment - ${bill.bill_number || billId}`, [
        { nameHint: 'Payable', debit: amount, credit: 0, note: `AP cleared for bill ${bill.bill_number || billId}` },
        { nameHint: 'Cash', debit: 0, credit: amount, note: `Cash paid for bill ${bill.bill_number || billId}` },
      ]);

      return { paymentId, newStatus, newAmountPaid };
    });

    return payTx();
  });

  ipcMain.handle('bills:stats', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { total_unpaid: 0, overdue: 0, due_soon: 0, paid_this_month: 0 };
    const dbInstance = db.getDb();

    const row = dbInstance.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN status NOT IN ('paid','void','draft') THEN total - amount_paid ELSE 0 END), 0) as total_unpaid,
        COALESCE(SUM(CASE WHEN due_date < date('now') AND status NOT IN ('paid','void','draft') THEN total - amount_paid ELSE 0 END), 0) as overdue,
        COALESCE(SUM(CASE WHEN due_date BETWEEN date('now') AND date('now', '+7 days') AND status NOT IN ('paid','void','draft') THEN total - amount_paid ELSE 0 END), 0) as due_soon,
        COALESCE(SUM(CASE WHEN status = 'paid' AND strftime('%Y-%m', updated_at) = strftime('%Y-%m', 'now') THEN amount_paid ELSE 0 END), 0) as paid_this_month
      FROM bills WHERE company_id = ?
    `).get(companyId);
    return row;
  });

  ipcMain.handle('bills:overdue-check', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return 0;
    const dbInstance = db.getDb();
    const result = dbInstance.prepare(`
      UPDATE bills SET status = 'overdue', updated_at = datetime('now')
      WHERE company_id = ? AND status IN ('pending','received','approved','partial')
        AND due_date < date('now')
    `).run(companyId);
    return result.changes;
  });

  // ─── Purchase Orders ──────────────────────────────────────

  ipcMain.handle('po:next-number', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return 'PO-1001';
    const dbInstance = db.getDb();
    const row = dbInstance.prepare(`SELECT po_number FROM purchase_orders WHERE company_id = ? ORDER BY created_at DESC LIMIT 1`).get(companyId) as any;
    if (!row) return 'PO-1001';
    const match = row.po_number.match(/(\d+)$/);
    if (!match) return 'PO-1001';
    const next = parseInt(match[1], 10) + 1;
    return `PO-${String(next).padStart(4, '0')}`;
  });

  ipcMain.handle('po:approve', (_event, { poId, approvedBy }: { poId: string; approvedBy?: string }) => {
    const dbInstance = db.getDb();
    dbInstance.prepare(`UPDATE purchase_orders SET status = 'approved', approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
      .run(approvedBy || '', poId);
    return { success: true };
  });

  ipcMain.handle('po:convert-bill', (_event, { poId }: { poId: string }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) throw new Error('No active company');
    const dbInstance = db.getDb();

    const convertTx = dbInstance.transaction(() => {
      const po = dbInstance.prepare('SELECT * FROM purchase_orders WHERE id = ?').get(poId) as any;
      if (!po) throw new Error('PO not found');

      const poItems = dbInstance.prepare('SELECT * FROM po_line_items WHERE po_id = ?').all(poId) as any[];

      // Generate bill number
      const row = dbInstance.prepare(`SELECT bill_number FROM bills WHERE company_id = ? ORDER BY created_at DESC LIMIT 1`).get(companyId) as any;
      let billNumber = 'BILL-1001';
      if (row) {
        const match = row.bill_number.match(/(\d+)$/);
        if (match) billNumber = `BILL-${String(parseInt(match[1], 10) + 1).padStart(4, '0')}`;
      }

      const billId = uuid();
      dbInstance.prepare(`
        INSERT INTO bills (id, company_id, vendor_id, bill_number, status, issue_date, due_date, subtotal, total, notes, reference)
        VALUES (?, ?, ?, ?, 'received', date('now'), date('now', '+30 days'), ?, ?, ?, ?)
      `).run(billId, companyId, po.vendor_id, billNumber, po.subtotal || 0, po.total || 0, po.notes || '', `PO: ${po.po_number}`);

      for (const item of poItems) {
        dbInstance.prepare(`
          INSERT INTO bill_line_items (id, bill_id, description, quantity, unit_price, amount, account_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(uuid(), billId, item.description, item.quantity, item.unit_price, item.amount, item.account_id);
      }

      dbInstance.prepare(`UPDATE purchase_orders SET status = 'received', updated_at = datetime('now') WHERE id = ?`).run(poId);

      return { billId, billNumber };
    });

    return convertTx();
  });

  // ─── Fixed Assets ─────────────────────────────────────────

  ipcMain.handle('assets:next-code', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return 'AST-001';
    const dbInstance = db.getDb();
    const row = dbInstance.prepare(`SELECT asset_code FROM fixed_assets WHERE company_id = ? ORDER BY created_at DESC LIMIT 1`).get(companyId) as any;
    if (!row?.asset_code) return 'AST-001';
    const match = row.asset_code.match(/(\d+)$/);
    if (!match) return 'AST-001';
    const next = parseInt(match[1], 10) + 1;
    return `AST-${String(next).padStart(3, '0')}`;
  });

  ipcMain.handle('assets:schedule', (_event, { assetId }: { assetId: string }) => {
    const dbInstance = db.getDb();
    const asset = dbInstance.prepare('SELECT * FROM fixed_assets WHERE id = ?').get(assetId) as any;
    if (!asset) return [];

    const schedule: any[] = [];
    const cost = asset.purchase_price || 0;
    const salvage = asset.salvage_value || 0;
    const life = asset.useful_life_years || 5;
    const startDate = new Date(asset.purchase_date);
    let bookValue = cost;
    const depreciable = cost - salvage;

    for (let year = 1; year <= life; year++) {
      let annualDep = 0;
      if (asset.depreciation_method === 'straight_line') {
        annualDep = depreciable / life;
      } else if (asset.depreciation_method === 'double_declining') {
        annualDep = Math.min(bookValue * (2 / life), bookValue - salvage);
      } else if (asset.depreciation_method === 'sum_of_years_digits') {
        const remaining = life - year + 1;
        const sumYears = (life * (life + 1)) / 2;
        annualDep = (remaining / sumYears) * depreciable;
      }
      annualDep = Math.max(0, annualDep);
      bookValue = Math.max(salvage, bookValue - annualDep);
      const d = new Date(startDate);
      d.setFullYear(d.getFullYear() + year);
      schedule.push({
        year,
        period: d.toISOString().slice(0, 10),
        depreciation_amount: annualDep,
        accumulated: cost - bookValue,
        book_value: bookValue,
      });
    }
    return schedule;
  });

  ipcMain.handle('assets:run-depreciation', (_event, { periodDate }: { periodDate: string }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) throw new Error('No active company');
    const dbInstance = db.getDb();

    const assets = dbInstance.prepare(`
      SELECT * FROM fixed_assets WHERE company_id = ? AND status = 'active'
    `).all(companyId) as any[];

    let processed = 0;
    const depTx = dbInstance.transaction(() => {
      for (const asset of assets) {
        // Check if already depreciated this period
        const existing = dbInstance.prepare(`
          SELECT id FROM asset_depreciation_entries WHERE asset_id = ? AND period_date = ?
        `).get(asset.id, periodDate);
        if (existing) continue;

        const cost = asset.purchase_price || 0;
        const salvage = asset.salvage_value || 0;
        const life = asset.useful_life_years || 5;
        const depreciable = cost - salvage;
        const accum = asset.accumulated_depreciation || 0;

        let monthlyDep = 0;
        if (asset.depreciation_method === 'straight_line') {
          monthlyDep = depreciable / (life * 12);
        } else if (asset.depreciation_method === 'double_declining') {
          const bookValue = cost - accum;
          monthlyDep = (bookValue * (2 / life)) / 12;
        }

        monthlyDep = Math.min(monthlyDep, Math.max(0, (cost - accum - salvage)));
        if (monthlyDep <= 0) continue;

        const newAccum = accum + monthlyDep;
        const newBookValue = cost - newAccum;
        const entryId = uuid();

        dbInstance.prepare(`
          INSERT INTO asset_depreciation_entries (id, asset_id, period_date, period_label, depreciation_amount, accumulated_depreciation, book_value)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(entryId, asset.id, periodDate, periodDate.slice(0, 7), monthlyDep, newAccum, newBookValue);

        dbInstance.prepare(`
          UPDATE fixed_assets SET accumulated_depreciation = ?, current_book_value = ?,
            status = CASE WHEN ? <= ? THEN 'fully_depreciated' ELSE status END,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(newAccum, newBookValue, newBookValue, salvage + 0.01, asset.id);

        processed++;
      }
    });
    depTx();
    return { processed };
  });

  // ─── Bank Rules ───────────────────────────────────────────

  ipcMain.handle('bank-rules:apply', (_event, { transactionIds }: { transactionIds?: string[] }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { applied: 0 };
    const dbInstance = db.getDb();

    const rules = dbInstance.prepare(`
      SELECT * FROM bank_rules WHERE company_id = ? AND is_active = 1
      ORDER BY priority DESC, created_at ASC
    `).all(companyId) as any[];

    let txQuery = `SELECT * FROM bank_transactions bt JOIN bank_accounts ba ON ba.id = bt.bank_account_id WHERE ba.company_id = ? AND bt.status = 'pending'`;
    const txParams: any[] = [companyId];
    if (transactionIds?.length) {
      txQuery += ` AND bt.id IN (${transactionIds.map(() => '?').join(',')})`;
      txParams.push(...transactionIds);
    }
    const transactions = dbInstance.prepare(txQuery).all(...txParams) as any[];

    let applied = 0;
    const applyTx = dbInstance.transaction(() => {
      for (const tx of transactions) {
        for (const rule of rules) {
          let matches = false;
          const fieldValue = String(tx[rule.match_field] || '').toLowerCase();
          const matchVal = (rule.match_value || '').toLowerCase();

          switch (rule.match_type) {
            case 'contains': matches = fieldValue.includes(matchVal); break;
            case 'starts_with': matches = fieldValue.startsWith(matchVal); break;
            case 'ends_with': matches = fieldValue.endsWith(matchVal); break;
            case 'exact': matches = fieldValue === matchVal; break;
            case 'regex': try { matches = new RegExp(matchVal, 'i').test(fieldValue); } catch { matches = false; } break;
          }

          if (rule.amount_min != null && tx.amount < rule.amount_min) matches = false;
          if (rule.amount_max != null && tx.amount > rule.amount_max) matches = false;
          if (rule.transaction_type && tx.type !== rule.transaction_type) matches = false;

          if (matches) {
            dbInstance.prepare(`UPDATE bank_transactions SET status = 'categorized', description = COALESCE(NULLIF(?, ''), description) WHERE id = ?`)
              .run(rule.action_description || '', tx.id);
            dbInstance.prepare(`UPDATE bank_rules SET times_applied = times_applied + 1, updated_at = datetime('now') WHERE id = ?`).run(rule.id);
            applied++;
            break; // first matching rule wins
          }
        }
      }
    });
    applyTx();
    return { applied };
  });

  // ─── Credit Notes ─────────────────────────────────────────

  ipcMain.handle('credit-notes:next-number', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return 'CN-1001';
    const dbInstance = db.getDb();
    const row = dbInstance.prepare(`SELECT credit_number FROM credit_notes WHERE company_id = ? ORDER BY created_at DESC LIMIT 1`).get(companyId) as any;
    if (!row) return 'CN-1001';
    const match = row.credit_number.match(/(\d+)$/);
    if (!match) return 'CN-1001';
    const next = parseInt(match[1], 10) + 1;
    return `CN-${String(next).padStart(4, '0')}`;
  });

  ipcMain.handle('credit-notes:apply', (_event, { creditNoteId, invoiceId, amount }: { creditNoteId: string; invoiceId: string; amount: number }) => {
    const dbInstance = db.getDb();
    const applyTx = dbInstance.transaction(() => {
      const cn = dbInstance.prepare('SELECT * FROM credit_notes WHERE id = ?').get(creditNoteId) as any;
      if (!cn) throw new Error('Credit note not found');
      const available = cn.total - (cn.amount_applied || 0);
      const applyAmt = Math.min(amount, available);

      const invoice = dbInstance.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId) as any;
      if (!invoice) throw new Error('Invoice not found');

      const newAmountPaid = (invoice.amount_paid || 0) + applyAmt;
      const newStatus = newAmountPaid >= invoice.total ? 'paid' : newAmountPaid > 0 ? 'partial' : invoice.status;

      dbInstance.prepare(`UPDATE invoices SET amount_paid = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(newAmountPaid, newStatus, invoiceId);

      const newApplied = (cn.amount_applied || 0) + applyAmt;
      const cnStatus = newApplied >= cn.total ? 'applied' : 'open';
      dbInstance.prepare(`UPDATE credit_notes SET amount_applied = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(newApplied, cnStatus, creditNoteId);

      return { applied: applyAmt, invoiceStatus: newStatus, creditNoteStatus: cnStatus };
    });
    return applyTx();
  });

  // ─── Dynamic Tax Configuration ────────────────────────────

  ipcMain.handle('tax:seed-year', (_event, { year }: { year: number }) => {
    const dbInstance = db.getDb();
    const taxData: Record<number, any> = {
      2024: {
        constants: { ss_wage_base: 168600, standard_deduction_single: 14600, standard_deduction_married: 29200, standard_deduction_hoh: 21900 },
        brackets: {
          single:             [[0, 11600, 0.10], [11600, 47150, 0.12], [47150, 100525, 0.22], [100525, 191950, 0.24], [191950, 243725, 0.32], [243725, 609350, 0.35], [609350, null, 0.37]],
          married_jointly:    [[0, 23200, 0.10], [23200, 94300, 0.12], [94300, 201050, 0.22], [201050, 383900, 0.24], [383900, 487450, 0.32], [487450, 731200, 0.35], [731200, null, 0.37]],
          married_separately: [[0, 11600, 0.10], [11600, 47150, 0.12], [47150, 100525, 0.22], [100525, 191950, 0.24], [191950, 243725, 0.32], [243725, 365675, 0.35], [365675, null, 0.37]],
          head_of_household:  [[0, 16550, 0.10], [16550, 63100, 0.12], [63100, 100500, 0.22], [100500, 191950, 0.24], [191950, 243700, 0.32], [243700, 609350, 0.35], [609350, null, 0.37]],
        },
      },
      2025: {
        constants: { ss_wage_base: 176100, standard_deduction_single: 15000, standard_deduction_married: 30000, standard_deduction_hoh: 22500 },
        brackets: {
          single:             [[0, 11925, 0.10], [11925, 48475, 0.12], [48475, 103350, 0.22], [103350, 197300, 0.24], [197300, 250525, 0.32], [250525, 626350, 0.35], [626350, null, 0.37]],
          married_jointly:    [[0, 23850, 0.10], [23850, 96950, 0.12], [96950, 206700, 0.22], [206700, 394600, 0.24], [394600, 501050, 0.32], [501050, 751600, 0.35], [751600, null, 0.37]],
          married_separately: [[0, 11925, 0.10], [11925, 48475, 0.12], [48475, 103350, 0.22], [103350, 197300, 0.24], [197300, 250525, 0.32], [250525, 375975, 0.35], [375975, null, 0.37]],
          head_of_household:  [[0, 17000, 0.10], [17000, 64850, 0.12], [64850, 103350, 0.22], [103350, 197300, 0.24], [197300, 250500, 0.32], [250500, 626350, 0.35], [626350, null, 0.37]],
        },
      },
      2026: {
        constants: { ss_wage_base: 182100, standard_deduction_single: 15400, standard_deduction_married: 30800, standard_deduction_hoh: 23100 },
        brackets: {
          single:             [[0, 12250, 0.10], [12250, 49800, 0.12], [49800, 106200, 0.22], [106200, 202750, 0.24], [202750, 257500, 0.32], [257500, 643750, 0.35], [643750, null, 0.37]],
          married_jointly:    [[0, 24500, 0.10], [24500, 99600, 0.12], [99600, 212400, 0.22], [212400, 405500, 0.24], [405500, 515000, 0.32], [515000, 772500, 0.35], [772500, null, 0.37]],
          married_separately: [[0, 12250, 0.10], [12250, 49800, 0.12], [49800, 106200, 0.22], [106200, 202750, 0.24], [202750, 257500, 0.32], [257500, 386250, 0.35], [386250, null, 0.37]],
          head_of_household:  [[0, 17500, 0.10], [17500, 66700, 0.12], [66700, 106200, 0.22], [106200, 202750, 0.24], [202750, 257475, 0.32], [257475, 643750, 0.35], [643750, null, 0.37]],
        },
      },
    };

    const data = taxData[year];
    if (!data) return { success: false, message: `No data for year ${year}` };

    const seedTx = dbInstance.transaction(() => {
      // Upsert constants
      const existing = dbInstance.prepare('SELECT id FROM federal_payroll_constants WHERE tax_year = ?').get(year);
      const c = data.constants;
      if (existing) {
        dbInstance.prepare(`UPDATE federal_payroll_constants SET ss_wage_base = ?, standard_deduction_single = ?, standard_deduction_married = ?, standard_deduction_hoh = ? WHERE tax_year = ?`)
          .run(c.ss_wage_base, c.standard_deduction_single, c.standard_deduction_married, c.standard_deduction_hoh, year);
      } else {
        dbInstance.prepare(`INSERT INTO federal_payroll_constants (id, tax_year, ss_wage_base, ss_rate, medicare_rate, medicare_additional_rate, medicare_additional_threshold_single, medicare_additional_threshold_married, futa_rate, futa_wage_base, standard_deduction_single, standard_deduction_married, standard_deduction_hoh) VALUES (?, ?, ?, 0.062, 0.0145, 0.009, 200000, 250000, 0.006, 7000, ?, ?, ?)`)
          .run(uuid(), year, c.ss_wage_base, c.standard_deduction_single, c.standard_deduction_married, c.standard_deduction_hoh);
      }

      // Upsert brackets
      const statusMap: Record<string, string> = { single: 'single', married_jointly: 'married_jointly', married_separately: 'married_separately', head_of_household: 'head_of_household' };
      for (const [status, brackets] of Object.entries(data.brackets)) {
        for (const [min, max, rate] of brackets as any[]) {
          const existBracket = dbInstance.prepare('SELECT id FROM federal_tax_brackets WHERE tax_year = ? AND filing_status = ? AND bracket_min = ?').get(year, statusMap[status], min);
          if (existBracket) {
            dbInstance.prepare('UPDATE federal_tax_brackets SET bracket_max = ?, rate = ? WHERE id = ?').run(max, rate, (existBracket as any).id);
          } else {
            dbInstance.prepare('INSERT INTO federal_tax_brackets (id, tax_year, filing_status, bracket_min, bracket_max, rate) VALUES (?, ?, ?, ?, ?, ?)').run(uuid(), year, statusMap[status], min, max, rate);
          }
        }
      }
    });
    seedTx();
    return { success: true, year };
  });

  ipcMain.handle('tax:get-brackets', (_event, { year }: { year: number }) => {
    const dbInstance = db.getDb();
    const rawBrackets = dbInstance.prepare('SELECT * FROM federal_tax_brackets WHERE tax_year = ? ORDER BY filing_status, bracket_min').all(year) as any[];
    const constants = dbInstance.prepare('SELECT * FROM federal_payroll_constants WHERE tax_year = ?').get(year);

    // Group brackets by filing status, mapping DB names to UI names
    const statusToUI: Record<string, string> = {
      single: 'single',
      married_jointly: 'married_filing_jointly',
      married_separately: 'married_filing_separately',
      head_of_household: 'head_of_household',
    };
    const brackets: Record<string, any[]> = {};
    for (const b of rawBrackets) {
      const uiKey = statusToUI[b.filing_status] ?? b.filing_status;
      if (!brackets[uiKey]) brackets[uiKey] = [];
      brackets[uiKey].push({ min: b.bracket_min, max: b.bracket_max, rate: b.rate });
    }
    return { brackets, constants };
  });

  ipcMain.handle('tax:calculate-withholding', (_event, { grossPay, filingStatus, allowances, year, ytdGross }: { grossPay: number; filingStatus: string; allowances: number; year: number; ytdGross: number }) => {
    const dbInstance = db.getDb();
    const constants = dbInstance.prepare('SELECT * FROM federal_payroll_constants WHERE tax_year = ?').get(year) as any;
    if (!constants) return { federal: 0, ss: 0, medicare: 0, total: 0 };

    const brackets = dbInstance.prepare('SELECT * FROM federal_tax_brackets WHERE tax_year = ? AND filing_status = ? ORDER BY bracket_min').all(year, filingStatus) as any[];

    // Annualize
    const annualized = grossPay * 26; // biweekly assumption
    const stdDed = filingStatus === 'married_jointly' ? constants.standard_deduction_married : filingStatus === 'head_of_household' ? constants.standard_deduction_hoh : constants.standard_deduction_single;
    const taxableAnnual = Math.max(0, annualized - stdDed - (allowances * 4300));

    let annualFederal = 0;
    for (const bracket of brackets) {
      if (taxableAnnual <= bracket.bracket_min) break;
      const upper = bracket.bracket_max ?? Infinity;
      const taxable = Math.min(taxableAnnual, upper) - bracket.bracket_min;
      annualFederal += taxable * bracket.rate;
    }
    const federal = annualFederal / 26;

    // FICA
    const ssRemaining = Math.max(0, constants.ss_wage_base - ytdGross);
    const ssWages = Math.min(grossPay, ssRemaining);
    const ss = ssWages * constants.ss_rate;
    const medicare = grossPay * constants.medicare_rate;

    return {
      federal: Math.round(federal * 100) / 100,
      ss: Math.round(ss * 100) / 100,
      medicare: Math.round(medicare * 100) / 100,
      total: Math.round((federal + ss + medicare) * 100) / 100,
    };
  });

  ipcMain.handle('tax:available-years', () => {
    const dbInstance = db.getDb();
    const years = dbInstance.prepare('SELECT DISTINCT tax_year FROM federal_payroll_constants ORDER BY tax_year DESC').all() as any[];
    return years.map((r: any) => r.tax_year);
  });

  ipcMain.handle('tax:auto-seed-current-year', () => {
    const currentYear = new Date().getFullYear();
    const dbInstance = db.getDb();
    const exists = dbInstance.prepare('SELECT id FROM federal_payroll_constants WHERE tax_year = ?').get(currentYear);
    if (exists) return { seeded: false, year: currentYear };
    // Trigger seeding via the seed handler
    return { seeded: true, year: currentYear, message: 'Use tax:seed-year to seed data for ' + currentYear };
  });

  // ─── Categories: Seed Defaults ───────────────────────────
  ipcMain.handle('categories:seed-defaults', (_event, { company_id }: { company_id: string }) => {
    return seedDefaultCategories(company_id);
  });

  // ─── Automation Rules ──────────────────────────────
  ipcMain.handle('automations:list', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return [];
    return db.getDb().prepare(
      `SELECT * FROM automation_rules WHERE company_id = ? ORDER BY created_at DESC`
    ).all(companyId);
  });

  ipcMain.handle('automations:toggle', (_e, ruleId: string) => {
    db.getDb().prepare(
      `UPDATE automation_rules SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?`
    ).run(ruleId);
  });

  ipcMain.handle('automations:run-log', (_e, ruleId: string) =>
    db.getDb().prepare(
      `SELECT * FROM automation_run_log WHERE rule_id = ? ORDER BY ran_at DESC LIMIT 50`
    ).all(ruleId)
  );

  ipcMain.handle('automations:create', (_e, rule: {
    name: string; trigger_type: string; trigger_config: string;
    conditions: string; actions: string;
  }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { error: 'No active company' };
    try {
      const record = db.create('automation_rules', {
        name: rule.name,
        trigger_type: rule.trigger_type,
        trigger_config: rule.trigger_config || '{}',
        conditions: rule.conditions || '[]',
        actions: rule.actions || '[]',
        is_active: 1,
        company_id: companyId,
      });
      return record;
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('automations:delete', (_e, ruleId: string) => {
    try {
      db.getDb().prepare(`DELETE FROM automation_rules WHERE id = ?`).run(ruleId);
      db.getDb().prepare(`DELETE FROM automation_run_log WHERE rule_id = ?`).run(ruleId);
      return { ok: true };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('automations:update', (_e, { id, name, trigger_type, trigger_config, conditions, actions }: any) => {
    try {
      db.getDb().prepare(
        `UPDATE automation_rules SET name=?, trigger_type=?, trigger_config=?, conditions=?, actions=? WHERE id=?`
      ).run(name, trigger_type, trigger_config || '{}', conditions || '[]', actions || '[]', id);
      return { ok: true };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  // ─── Financial Intelligence ─────────────────────────
  ipcMain.handle('intelligence:anomalies', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return [];
    return db.getDb().prepare(
      `SELECT * FROM financial_anomalies WHERE company_id = ? AND dismissed = 0 ORDER BY detected_at DESC LIMIT 20`
    ).all(companyId);
  });

  ipcMain.handle('intelligence:dismiss-anomaly', (_e, id: string) => {
    db.getDb().prepare(`UPDATE financial_anomalies SET dismissed = 1 WHERE id = ?`).run(id);
  });

  // ─── Inventory Stock Movements ─────────────────────────
  ipcMain.handle('inventory:movements', (_e, itemId: string) => {
    return db.getDb().prepare(
      `SELECT * FROM inventory_movements WHERE item_id = ? ORDER BY created_at DESC LIMIT 100`
    ).all(itemId);
  });

  ipcMain.handle('inventory:adjust', (_e, { itemId, type, quantity, unitCost, reference, notes }: {
    itemId: string; type: string; quantity: number; unitCost: number; reference: string; notes: string;
  }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { error: 'No active company' };
    const rawDb = db.getDb();
    try {
      const adjust = rawDb.transaction(() => {
        // Record the movement
        db.create('inventory_movements', {
          item_id: itemId,
          company_id: companyId,
          type,
          quantity,
          unit_cost: unitCost || 0,
          reference: reference || '',
          notes: notes || '',
        });

        // Update the inventory item's quantity
        const delta = type === 'out' ? -Math.abs(quantity) : Math.abs(quantity);
        rawDb.prepare(
          `UPDATE inventory_items SET quantity = quantity + ?, updated_at = datetime('now') WHERE id = ?`
        ).run(delta, itemId);

        const item = rawDb.prepare(`SELECT quantity FROM inventory_items WHERE id = ?`).get(itemId) as any;
        return { ok: true, newQuantity: item?.quantity ?? 0 };
      });
      return adjust();
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('inventory:low-stock', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return [];
    return db.getDb().prepare(
      `SELECT id, name, sku, quantity, reorder_point, reorder_qty, unit_cost
       FROM inventory_items
       WHERE company_id = ? AND reorder_point > 0 AND quantity <= reorder_point
       ORDER BY (quantity - reorder_point) ASC`
    ).all(companyId);
  });

  ipcMain.handle('intelligence:cash-projection', (_e, { days }: { days: number }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { inflow: [], outflow: [] };
    const d = Math.min(Math.max(Number.isFinite(Number(days)) ? Number(days) : 30, 1), 90);
    const dbInstance = db.getDb();
    const inflow = dbInstance.prepare(`
      SELECT SUM(total) as amount, due_date
      FROM invoices
      WHERE company_id = ? AND status NOT IN ('paid','void','draft')
        AND due_date BETWEEN date('now') AND date('now', '+${d} days')
      GROUP BY due_date ORDER BY due_date
    `).all(companyId);
    const outflow = dbInstance.prepare(`
      SELECT SUM(total_amount) as amount, due_date
      FROM bills
      WHERE company_id = ? AND status NOT IN ('paid','void','draft')
        AND due_date BETWEEN date('now') AND date('now', '+${d} days')
      GROUP BY due_date ORDER BY due_date
    `).all(companyId);
    return { inflow, outflow };
  });

  // ─── Rules Engine ────────────────────────────────────────
  ipcMain.handle('rules:list', (_event, { company_id, category }: { company_id: string; category?: string }) => {
    let sql = `SELECT * FROM rules WHERE company_id = ?`;
    const params: unknown[] = [company_id];
    if (category) { sql += ` AND category = ?`; params.push(category); }
    sql += ` ORDER BY priority ASC`;
    return db.getDb().prepare(sql).all(...params);
  });

  ipcMain.handle('rules:create', (_event, data: Record<string, unknown>) => {
    const id = uuid();
    const row = { id, ...data, created_at: new Date().toISOString() };
    db.getDb().prepare(`
      INSERT INTO rules (id, company_id, category, name, priority, is_active, trigger, conditions, actions, created_at)
      VALUES (@id, @company_id, @category, @name, @priority, @is_active, @trigger, @conditions, @actions, @created_at)
    `).run(row);
    return { id };
  });

  ipcMain.handle('rules:update', (_event, { id, data }: { id: string; data: Record<string, unknown> }) => {
    const sets = Object.keys(data).map(k => `${k} = @${k}`).join(', ');
    db.getDb().prepare(`UPDATE rules SET ${sets} WHERE id = @id`).run({ ...data, id });
    return { ok: true };
  });

  ipcMain.handle('rules:delete', (_event, id: string) => {
    db.getDb().prepare(`DELETE FROM rules WHERE id = ?`).run(id);
    return { ok: true };
  });

  ipcMain.handle('approval:list', (_event, { company_id, status }: { company_id: string; status?: string }) => {
    let sql = `SELECT aq.*, r.category FROM approval_queue aq LEFT JOIN rules r ON aq.rule_id = r.id WHERE aq.company_id = ?`;
    const params: unknown[] = [company_id];
    if (status) { sql += ` AND aq.status = ?`; params.push(status); }
    sql += ` ORDER BY aq.created_at DESC`;
    return db.getDb().prepare(sql).all(...params);
  });

  ipcMain.handle('approval:resolve', (_event, { id, status, notes }: { id: string; status: 'approved' | 'rejected'; notes?: string }) => {
    db.getDb().prepare(`UPDATE approval_queue SET status = ?, notes = ?, resolved_at = datetime('now') WHERE id = ?`).run(status, notes ?? null, id);
    return { ok: true };
  });

  ipcMain.handle('approval:pending-count', (_event, company_id: string) => {
    const row = db.getDb().prepare(`SELECT COUNT(*) as count FROM approval_queue WHERE company_id = ? AND status = 'pending'`).get(company_id) as { count: number };
    return row.count;
  });

  ipcMain.handle('record:clone', (_event, { table, id }: { table: string; id: string }) => {
    const CLONEABLE_TABLES = ['invoices', 'expenses', 'bills'];
    if (!CLONEABLE_TABLES.includes(table)) return { error: 'Invalid table' };
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { error: 'No active company' };
    const dbInstance = db.getDb();
    const original = dbInstance.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!original) return { error: 'Not found' };
    const newId = uuid();
    const today = new Date().toISOString().split('T')[0];
    const clone: Record<string, unknown> = { ...original, id: newId, created_at: new Date().toISOString(), status: 'draft', rules_applied: '[]' };

    if (table === 'invoices') {
      // Generate next invoice number to satisfy NOT NULL + UNIQUE constraint
      const lastInv = dbInstance.prepare(`SELECT invoice_number FROM invoices WHERE company_id = ? ORDER BY created_at DESC LIMIT 1`).get(companyId) as any;
      let nextInvNumber = 'INV-1001';
      if (lastInv?.invoice_number) {
        const m = lastInv.invoice_number.match(/(\d+)$/);
        if (m) {
          const prefix = lastInv.invoice_number.slice(0, lastInv.invoice_number.length - m[1].length);
          nextInvNumber = `${prefix}${String(parseInt(m[1], 10) + 1).padStart(m[1].length, '0')}`;
        }
      }
      clone.invoice_number = nextInvNumber;
      clone.issue_date = today;
      delete clone.paid_date;
      clone.amount_paid = 0;
    }

    if (table === 'bills') {
      // Generate next bill number
      const lastBill = dbInstance.prepare(`SELECT bill_number FROM bills WHERE company_id = ? ORDER BY created_at DESC LIMIT 1`).get(companyId) as any;
      let nextBillNumber = 'BILL-1001';
      if (lastBill?.bill_number) {
        const m = lastBill.bill_number.match(/(\d+)$/);
        if (m) {
          const prefix = lastBill.bill_number.slice(0, lastBill.bill_number.length - m[1].length);
          nextBillNumber = `${prefix}${String(parseInt(m[1], 10) + 1).padStart(m[1].length, '0')}`;
        }
      }
      clone.bill_number = nextBillNumber;
      clone.issue_date = today;
      clone.amount_paid = 0;
    }

    if (table === 'expenses') { clone.date = today; }

    const cloneTx = dbInstance.transaction(() => {
      const cols = Object.keys(clone);
      dbInstance.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(c => '@' + c).join(',')})`).run(clone);

      // Clone child line items
      const LINE_ITEM_TABLES: Record<string, string> = {
        invoices: 'invoice_line_items',
        bills: 'bill_line_items',
        expenses: 'expense_line_items',
      };
      const lineTable = LINE_ITEM_TABLES[table];
      const parentCol = table === 'invoices' ? 'invoice_id' : table === 'bills' ? 'bill_id' : 'expense_id';
      if (lineTable) {
        const lines = dbInstance.prepare(`SELECT * FROM ${lineTable} WHERE ${parentCol} = ?`).all(id) as any[];
        for (const line of lines) {
          const newLine = { ...line, id: uuid(), [parentCol]: newId };
          const lineCols = Object.keys(newLine);
          dbInstance.prepare(`INSERT INTO ${lineTable} (${lineCols.join(',')}) VALUES (${lineCols.map(c => '@' + c).join(',')})`).run(newLine);
        }
      }
    });
    cloneTx();
    scheduleAutoBackup();
    return { id: newId };
  });

  ipcMain.handle('invoice:from-time-entries', (_event, { project_id, company_id }: { project_id: string; company_id: string }) => {
    const entries = db.getDb().prepare(`
      SELECT te.*, e.name as employee_name, e.pay_rate, p.client_id, p.name as project_name
      FROM time_entries te
      JOIN employees e ON te.employee_id = e.id
      JOIN projects p ON te.project_id = p.id
      WHERE te.project_id = ? AND te.company_id = ? AND te.is_invoiced = 0
    `).all(project_id, company_id) as any[];
    if (entries.length === 0) return { error: 'No unbilled time entries for this project.' };
    const client_id = entries[0].client_id;
    const project_name = entries[0].project_name;
    const byEmployee: Record<string, { name: string; minutes: number; rate: number }> = {};
    for (const e of entries) {
      if (!byEmployee[e.employee_id]) byEmployee[e.employee_id] = { name: e.employee_name, minutes: 0, rate: Number(e.pay_rate ?? 0) };
      byEmployee[e.employee_id].minutes += Number(e.duration_minutes ?? 0);
    }
    const lines = Object.values(byEmployee).map(emp => ({
      description: `${emp.name} — ${project_name}`,
      quantity: parseFloat((emp.minutes / 60).toFixed(2)),
      unit_price: emp.rate,
      tax_rate: 0,
    }));
    return { client_id, lines, entry_ids: entries.map((e: any) => e.id) };
  });

  // ─── Debt Collection ────────────────────────────────────

  const DEBT_STAGE_ORDER = ['reminder','warning','final_notice','demand_letter','collections_agency','legal_action','judgment','garnishment'];

  function calculateDebtInterest(principal: number, rate: number, type: string, startDate: string, compoundFreq: number): number {
    if (!startDate || rate <= 0) return 0;
    const days = Math.max(0, Math.floor((Date.now() - new Date(startDate).getTime()) / 86400000));
    if (days === 0) return 0;
    if (type === 'compound') {
      const years = days / 365;
      return principal * (Math.pow(1 + rate / compoundFreq, compoundFreq * years) - 1);
    }
    return principal * rate * (days / 365);
  }

  // ─── Audit Log Helper ──────────────────────────────────
  // Immutable chain-of-custody logging. Called by every debt-mutating handler.
  // MUST NEVER throw — audit is a side-effect, not a gate.
  function logDebtAudit(
    debtId: string,
    action: string,
    fieldName: string = '',
    oldValue: string = '',
    newValue: string = '',
    performedBy: string = 'user'
  ): void {
    try {
      const dbInstance = db.getDb();
      dbInstance.prepare(`
        INSERT INTO debt_audit_log (id, debt_id, action, field_name, old_value, new_value, performed_by, performed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(uuid(), debtId, action, fieldName, oldValue, newValue, performedBy);
    } catch (_) { /* audit logging must never crash the primary operation */ }
  }

  // ─── Debt: Audit Log Query ────────────────────────────
  ipcMain.handle('debt:audit-log', (_event, { debtId, limit }: { debtId: string; limit?: number }) => {
    try {
      return db.getDb().prepare(
        'SELECT * FROM debt_audit_log WHERE debt_id = ? ORDER BY performed_at DESC LIMIT ?'
      ).all(debtId, limit || 200);
    } catch (_) {
      return [];
    }
  });

  ipcMain.handle('debt:generate-court-packet', async (_event, { debtId }: { debtId: string }) => {
    try {
      const dbInstance = db.getDb();
      const companyId = db.getCurrentCompanyId();
      const debt = db.getById('debts', debtId);
      if (!debt) return { error: 'Debt not found' };
      const company = companyId ? db.getById('companies', companyId) : null;

      const communications = dbInstance.prepare('SELECT * FROM debt_communications WHERE debt_id = ? ORDER BY logged_at ASC').all(debtId);
      const payments = dbInstance.prepare('SELECT * FROM debt_payments WHERE debt_id = ? ORDER BY received_date ASC').all(debtId);
      const evidence = dbInstance.prepare('SELECT * FROM debt_evidence WHERE debt_id = ? ORDER BY date_of_evidence ASC').all(debtId);
      const compliance = dbInstance.prepare('SELECT * FROM debt_compliance_log WHERE debt_id = ? ORDER BY event_date ASC').all(debtId);
      const auditLog = dbInstance.prepare('SELECT * FROM debt_audit_log WHERE debt_id = ? ORDER BY performed_at ASC').all(debtId);
      const settlements = dbInstance.prepare('SELECT * FROM debt_settlements WHERE debt_id = ? ORDER BY created_at ASC').all(debtId);
      const contacts = dbInstance.prepare('SELECT * FROM debt_contacts WHERE debt_id = ? ORDER BY role ASC').all(debtId);
      const disputes = dbInstance.prepare('SELECT * FROM debt_disputes WHERE debt_id = ? ORDER BY created_at ASC').all(debtId);
      const legalActions = dbInstance.prepare('SELECT * FROM debt_legal_actions WHERE debt_id = ? ORDER BY created_at ASC').all(debtId);

      return { debt, company, communications, payments, evidence, compliance, auditLog, settlements, contacts, disputes, legalActions };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('debt:batch-recalc-interest', () => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return { updated: 0 };
      const dbInstance = db.getDb();

      const debts = dbInstance.prepare(`
        SELECT id, original_amount, interest_rate, interest_type,
               compound_frequency, interest_start_date, interest_accrued,
               fees_accrued, payments_made
        FROM debts
        WHERE company_id = ? AND status NOT IN ('settled','written_off') AND interest_rate > 0
      `).all(companyId) as any[];

      let updated = 0;
      const recalcTx = dbInstance.transaction(() => {
        for (const d of debts) {
          if (!d.interest_start_date) continue;
          const days = Math.max(0, (Date.now() - new Date(d.interest_start_date).getTime()) / 86_400_000);
          const years = days / 365.25;
          let interest: number;

          if (d.interest_type === 'compound') {
            const n = d.compound_frequency || 12;
            interest = d.original_amount * Math.pow(1 + d.interest_rate / n, n * years) - d.original_amount;
          } else {
            interest = d.original_amount * d.interest_rate * years;
          }

          interest = Math.round(interest * 100) / 100;
          const oldInterest = d.interest_accrued || 0;
          const newBalance = d.original_amount + interest + (d.fees_accrued || 0) - (d.payments_made || 0);

          dbInstance.prepare(`
            UPDATE debts SET interest_accrued = ?, balance_due = ?, updated_at = datetime('now') WHERE id = ?
          `).run(interest, Math.round(newBalance * 100) / 100, d.id);

          logDebtAudit(d.id, 'interest_recalculated', 'interest_accrued',
            String(oldInterest.toFixed(2)), String(interest.toFixed(2)), 'system');
          updated++;
        }
      });
      recalcTx();
      if (updated > 0) scheduleAutoBackup();
      return { updated };
    } catch (err: any) {
      return { error: err.message, updated: 0 };
    }
  });

  ipcMain.handle('debt:smart-recommendations', (_event, { companyId }: { companyId: string }) => {
    try {
      const dbInstance = db.getDb();
      const today = new Date().toISOString().slice(0, 10);
      const recommendations: Array<{ debtId: string; debtorName: string; recommendation: string; reason: string; priority: string }> = [];

      const debts = dbInstance.prepare(`
        SELECT d.*,
          (SELECT AVG(CAST(julianday(COALESCE(ps.exited_at, datetime('now'))) - julianday(ps.entered_at) AS REAL))
           FROM debt_pipeline_stages ps WHERE ps.debt_id = d.id) as avg_days_in_stage,
          (SELECT COUNT(*) FROM debt_promises dp WHERE dp.debt_id = d.id AND dp.kept = 0 AND dp.promised_date < ?) as broken_promises,
          (SELECT COUNT(*) FROM debt_legal_actions la WHERE la.debt_id = d.id) as legal_action_count,
          (SELECT COUNT(*) FROM debt_settlements s WHERE s.debt_id = d.id) as settlement_count,
          (SELECT COUNT(*) FROM debt_plan_installments pi
           JOIN debt_payment_plans pp ON pi.plan_id = pp.id
           WHERE pp.debt_id = d.id AND pi.paid = 0 AND pi.due_date < ?) as missed_installments
        FROM debts d
        WHERE d.company_id = ? AND d.status NOT IN ('settled','written_off')
        ORDER BY d.balance_due DESC
        LIMIT 100
      `).all(today, today, companyId) as any[];

      // Pipeline velocity averages (for "2x average" rule)
      const stageAvgs = dbInstance.prepare(`
        SELECT stage, AVG(CAST(julianday(COALESCE(exited_at, datetime('now'))) - julianday(entered_at) AS REAL)) as avg_days
        FROM debt_pipeline_stages ps
        JOIN debts d ON ps.debt_id = d.id
        WHERE d.company_id = ?
        GROUP BY stage
      `).all(companyId) as any[];
      const stageAvgMap: Record<string, number> = {};
      for (const sa of stageAvgs) stageAvgMap[sa.stage] = sa.avg_days || 30;

      for (const d of debts) {
        const daysDelinquent = d.delinquent_date
          ? Math.floor((Date.now() - new Date(d.delinquent_date).getTime()) / 86_400_000)
          : 0;
        const currentStageAvg = stageAvgMap[d.current_stage] || 30;
        const daysInCurrentStage = d.avg_days_in_stage || 0;

        // Rule 1: Statute expiring within 90 days
        if (d.statute_of_limitations_date) {
          const daysToStatute = Math.floor((new Date(d.statute_of_limitations_date).getTime() - Date.now()) / 86_400_000);
          if (daysToStatute <= 90 && daysToStatute > 0 && d.legal_action_count === 0) {
            recommendations.push({
              debtId: d.id, debtorName: d.debtor_name,
              recommendation: 'URGENT: File before statute expires',
              reason: `Statute expires in ${daysToStatute} days (${d.statute_of_limitations_date}). No legal action filed.`,
              priority: 'critical'
            });
            continue;
          }
        }

        // Rule 2: Broken promises >= 2 AND pre-legal
        if (d.broken_promises >= 2 && !['legal_action', 'judgment', 'garnishment'].includes(d.current_stage)) {
          recommendations.push({
            debtId: d.id, debtorName: d.debtor_name,
            recommendation: 'Escalate — multiple broken promises',
            reason: `${d.broken_promises} broken promises. Currently in ${d.current_stage} stage.`,
            priority: 'high'
          });
          continue;
        }

        // Rule 3: High risk + no legal action
        if (d.balance_due > 5000 && daysDelinquent > 120 && d.legal_action_count === 0) {
          recommendations.push({
            debtId: d.id, debtorName: d.debtor_name,
            recommendation: 'Recommend legal action',
            reason: `Balance $${d.balance_due.toFixed(0)}, ${daysDelinquent} days delinquent, no legal action filed.`,
            priority: 'high'
          });
          continue;
        }

        // Rule 4: Payment plan failing (2+ missed installments)
        if (d.missed_installments >= 2) {
          recommendations.push({
            debtId: d.id, debtorName: d.debtor_name,
            recommendation: 'Payment plan failing — renegotiate or escalate',
            reason: `${d.missed_installments} missed installments on active payment plan.`,
            priority: 'high'
          });
          continue;
        }

        // Rule 5: No settlement offered for large old debts
        if (d.balance_due > 5000 && daysDelinquent > 120 && d.settlement_count === 0) {
          recommendations.push({
            debtId: d.id, debtorName: d.debtor_name,
            recommendation: 'Consider settlement offer at 70%',
            reason: `Balance $${d.balance_due.toFixed(0)}, ${daysDelinquent} days delinquent, no settlement offered.`,
            priority: 'medium'
          });
          continue;
        }

        // Rule 6: Days in stage > 2x average
        if (daysInCurrentStage > currentStageAvg * 2 && currentStageAvg > 0) {
          recommendations.push({
            debtId: d.id, debtorName: d.debtor_name,
            recommendation: 'Consider advancing to next stage',
            reason: `${Math.round(daysInCurrentStage)} days in ${d.current_stage} (avg: ${Math.round(currentStageAvg)} days).`,
            priority: 'medium'
          });
          continue;
        }

        // Rule 7: C&D active + no legal counsel
        if (d.cease_desist_active && d.legal_action_count === 0) {
          recommendations.push({
            debtId: d.id, debtorName: d.debtor_name,
            recommendation: 'Legal counsel needed — C&D limits options',
            reason: 'Cease & desist is active but no legal action or counsel assigned.',
            priority: 'high'
          });
        }
      }

      // Sort: critical first, then high, then medium
      const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2 };
      recommendations.sort((a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9));

      return recommendations.slice(0, 20);
    } catch (err: any) {
      console.error('debt:smart-recommendations error:', err);
      return [];
    }
  });

  ipcMain.handle('debt:stats', (_event, { companyId }: { companyId: string }) => {
    const row = db.getDb().prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN status NOT IN ('settled','written_off') THEN balance_due ELSE 0 END), 0) as total_outstanding,
        COALESCE(SUM(CASE WHEN status = 'in_collection' THEN 1 ELSE 0 END), 0) as in_collection,
        COALESCE(SUM(CASE WHEN status = 'legal' THEN 1 ELSE 0 END), 0) as legal_active,
        COALESCE((SELECT SUM(dp.amount) FROM debt_payments dp JOIN debts d ON dp.debt_id = d.id WHERE d.company_id = ? AND strftime('%Y-%m', dp.received_date) = strftime('%Y-%m', 'now')), 0) as collected_this_month,
        COALESCE(SUM(CASE WHEN status = 'written_off' AND strftime('%Y', updated_at) = strftime('%Y', 'now') THEN original_amount ELSE 0 END), 0) as writeoffs_ytd
      FROM debts WHERE company_id = ?
    `).get(companyId, companyId) as any;
    return row;
  });

  ipcMain.handle('debt:calculate-interest', (_event, { debtId }: { debtId: string }) => {
    const debt = db.getDb().prepare('SELECT * FROM debts WHERE id = ?').get(debtId) as any;
    if (!debt) return { interest: 0, total: 0 };
    const interest = calculateDebtInterest(
      debt.original_amount, debt.interest_rate, debt.interest_type,
      debt.interest_start_date, debt.compound_frequency
    );
    const rounded = Math.round(interest * 100) / 100;
    db.getDb().prepare('UPDATE debts SET interest_accrued = ?, balance_due = original_amount + ? + fees_accrued - payments_made, updated_at = datetime(\'now\') WHERE id = ?').run(rounded, rounded, debtId);
    return { interest: rounded, total: debt.original_amount + rounded + debt.fees_accrued - debt.payments_made };
  });

  ipcMain.handle('debt:advance-stage', (_event, { debtId, notes }: { debtId: string; notes?: string }) => {
    const debt = db.getDb().prepare('SELECT * FROM debts WHERE id = ?').get(debtId) as any;
    if (!debt) throw new Error('Debt not found');
    const oldStage = debt.current_stage || '';
    const currentIdx = DEBT_STAGE_ORDER.indexOf(debt.current_stage);
    if (currentIdx < 0 || currentIdx >= DEBT_STAGE_ORDER.length - 1) return;
    const nextStage = DEBT_STAGE_ORDER[currentIdx + 1];
    // Close current stage
    db.getDb().prepare('UPDATE debt_pipeline_stages SET exited_at = datetime(\'now\') WHERE debt_id = ? AND stage = ? AND exited_at IS NULL').run(debtId, debt.current_stage);
    // Open next stage
    db.getDb().prepare('INSERT INTO debt_pipeline_stages (id, debt_id, stage, notes) VALUES (?, ?, ?, ?)').run(uuid(), debtId, nextStage, notes || '');
    // Update debt
    const newStatus = ['legal_action','judgment','garnishment'].includes(nextStage) ? 'legal' : 'in_collection';
    db.getDb().prepare('UPDATE debts SET current_stage = ?, status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(nextStage, newStatus, debtId);
    logDebtAudit(debtId, 'stage_advance', 'current_stage', oldStage, nextStage);
    scheduleAutoBackup();
  });

  ipcMain.handle('debt:hold-toggle', (_event, { debtId, hold, reason }: { debtId: string; hold: boolean; reason?: string }) => {
    db.getDb().prepare('UPDATE debts SET hold = ?, hold_reason = ?, updated_at = datetime(\'now\') WHERE id = ?').run(hold ? 1 : 0, reason || '', debtId);
    logDebtAudit(debtId, 'hold_toggle', 'hold', hold ? '0' : '1', hold ? '1' : '0');
    scheduleAutoBackup();
  });

  ipcMain.handle('debt:assign-collector', (_event, { debtId, collectorId }: { debtId: string; collectorId: string | null }) => {
    try {
      const oldDebt = db.getById('debts', debtId) as any;
      db.update('debts', debtId, { assigned_collector_id: collectorId || null });
      logDebtAudit(debtId, 'assignment_change', 'assigned_collector_id', oldDebt?.assigned_collector_id || '', collectorId || '');
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('debt:import-overdue', (_event, { companyId, daysThreshold }: { companyId: string; daysThreshold: number }) => {
    const dbInstance = db.getDb();
    const overdue = dbInstance.prepare(`
      SELECT i.*, c.name as client_name, c.email as client_email, c.phone as client_phone,
             c.address_line1 || ' ' || c.city || ' ' || c.state || ' ' || c.zip as client_address
      FROM invoices i
      LEFT JOIN clients c ON i.client_id = c.id
      WHERE i.company_id = ? AND i.status = 'overdue'
      AND julianday('now') - julianday(i.due_date) >= ?
      AND i.id NOT IN (SELECT source_id FROM debts WHERE source_type = 'invoice' AND company_id = ?)
    `).all(companyId, daysThreshold, companyId) as any[];

    const importTx = dbInstance.transaction(() => {
      let imported = 0;
      for (const inv of overdue) {
        const id = uuid();
        const balance = (inv.total || inv.amount || 0) - (inv.amount_paid || 0);
        dbInstance.prepare(`
          INSERT INTO debts (id, company_id, type, status, debtor_id, debtor_type, debtor_name, debtor_email, debtor_phone, debtor_address, source_type, source_id, original_amount, balance_due, due_date, delinquent_date, current_stage)
          VALUES (?, ?, 'receivable', 'active', ?, 'client', ?, ?, ?, ?, 'invoice', ?, ?, ?, ?, ?, 'reminder')
        `).run(id, companyId, inv.client_id || '', inv.client_name || 'Unknown', inv.client_email || '', inv.client_phone || '', inv.client_address || '', inv.id, balance, balance, inv.due_date || '', inv.due_date || '');
        dbInstance.prepare('INSERT INTO debt_pipeline_stages (id, debt_id, stage) VALUES (?, ?, ?)').run(uuid(), id, 'reminder');
        imported++;
      }
      return { imported };
    });

    return importTx();
  });

  ipcMain.handle('debt:generate-demand-letter', (_event, { debtId, templateId }: { debtId: string; templateId: string }) => {
    const debt = db.getDb().prepare('SELECT * FROM debts WHERE id = ?').get(debtId) as any;
    const template = db.getDb().prepare('SELECT * FROM debt_templates WHERE id = ?').get(templateId) as any;
    if (!debt || !template) return { html: '' };
    const company = db.getDb().prepare('SELECT * FROM companies WHERE id = ?').get(debt.company_id) as any;

    // Escape merge VALUES (from DB) so debtor data can't break template HTML.
    // Template body/subject itself is admin-authored and may legitimately contain HTML,
    // so we don't escape those — only the values substituted into them.
    const escVal = (s: unknown): string => {
      if (s === null || s === undefined) return '';
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    };
    const fmtMoney = (n: number) =>
      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
    const fmtDate = (d: unknown) => {
      if (!d) return '';
      try {
        const s = String(d);
        const dt = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T12:00:00') : new Date(s);
        if (isNaN(dt.getTime())) return escVal(s);
        return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      } catch { return escVal(d); }
    };

    const total = (debt.original_amount || 0) + (debt.interest_accrued || 0) + (debt.fees_accrued || 0) - (debt.payments_made || 0);
    const daysOverdue = debt.delinquent_date ? Math.floor((Date.now() - new Date(debt.delinquent_date).getTime()) / 86400000) : 0;
    const demandDeadlineDate = new Date(Date.now() + 10 * 86400000);

    const companyAddr = [company?.address_line1, company?.city, company?.state, company?.zip].filter(Boolean).join(', ');

    const fields: Record<string, string> = {
      '{{debtor_name}}': escVal(debt.debtor_name),
      '{{debtor_address}}': escVal(debt.debtor_address),
      '{{original_amount}}': fmtMoney(debt.original_amount),
      '{{interest_accrued}}': fmtMoney(debt.interest_accrued),
      '{{fees_accrued}}': fmtMoney(debt.fees_accrued),
      '{{total_due}}': fmtMoney(total),
      '{{due_date}}': fmtDate(debt.due_date),
      '{{demand_deadline}}': fmtDate(demandDeadlineDate.toISOString().split('T')[0]),
      '{{days_overdue}}': String(daysOverdue),
      '{{company_name}}': escVal(company?.name),
      '{{company_address}}': escVal(companyAddr),
      '{{company_phone}}': escVal(company?.phone),
      '{{company_email}}': escVal(company?.email),
    };

    let body = template.body || '';
    let subject = template.subject || '';
    for (const [key, val] of Object.entries(fields)) {
      body = body.split(key).join(val);
      subject = subject.split(key).join(val);
    }

    // Wrap in a print-ready letterhead for proper PDF output
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Demand Letter</title><style>
      * { box-sizing: border-box; }
      body { font-family: 'Georgia', 'Times New Roman', serif; color: #0f172a; padding: 60px; max-width: 720px; margin: 0 auto; font-size: 13px; line-height: 1.65; background: #fff; }
      h2 { font-size: 18px; font-weight: 700; color: #0f172a; border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin: 0 0 24px; }
      .letter-body { white-space: pre-wrap; }
    </style></head><body>
      <h2>${subject}</h2>
      <div class="letter-body">${body}</div>
    </body></html>`;

    return { html };
  });

  ipcMain.handle('debt:export-bundle', async (_event, { debtId }: { debtId: string }) => {
    const debt = db.getDb().prepare('SELECT * FROM debts WHERE id = ?').get(debtId) as any;
    if (!debt) return { error: 'Debt not found' };
    const company = db.getDb().prepare('SELECT * FROM companies WHERE id = ?').get(debt.company_id) as any;
    const payments = db.getDb().prepare('SELECT * FROM debt_payments WHERE debt_id = ? ORDER BY received_date').all(debtId) as any[];
    const comms = db.getDb().prepare('SELECT * FROM debt_communications WHERE debt_id = ? ORDER BY logged_at').all(debtId) as any[];
    const evidence = db.getDb().prepare('SELECT * FROM debt_evidence WHERE debt_id = ? ORDER BY date_of_evidence').all(debtId) as any[];
    const legalActions = db.getDb().prepare('SELECT * FROM debt_legal_actions WHERE debt_id = ? ORDER BY created_at').all(debtId) as any[];
    const stages = db.getDb().prepare('SELECT * FROM debt_pipeline_stages WHERE debt_id = ? ORDER BY entered_at').all(debtId) as any[];

    // ── Formatting helpers ────────────────────────────────
    const esc = (s: unknown): string => {
      if (s === null || s === undefined || s === '') return '';
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    };
    const fmtMoney = (n: unknown): string =>
      new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0);
    const fmtDate = (d: unknown): string => {
      if (!d) return '\u2014';
      try {
        const s = String(d);
        // Date-only (YYYY-MM-DD) → parse as local noon to avoid TZ shifting the day
        const dt = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T12:00:00') : new Date(s);
        if (isNaN(dt.getTime())) return esc(s);
        return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      } catch { return esc(d); }
    };
    const fmtDateTime = (d: unknown): string => {
      if (!d) return '\u2014';
      try {
        const dt = new Date(String(d));
        if (isNaN(dt.getTime())) return esc(d);
        return dt.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      } catch { return esc(d); }
    };
    // "collections_agency" → "Collections Agency"
    const titleCase = (s: unknown): string => {
      if (!s) return '\u2014';
      return String(s).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    };
    const sanitizeFilename = (s: string): string =>
      s.replace(/[\/\\?%*:|"<>]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Case File';

    const total = (debt.original_amount || 0) + (debt.interest_accrued || 0) + (debt.fees_accrued || 0) - (debt.payments_made || 0);

    let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Debt Case File</title><style>
      * { box-sizing: border-box; }
      body { font-family: -apple-system, 'Segoe UI', Arial, sans-serif; color: #0f172a; padding: 40px; font-size: 13px; line-height: 1.5; }
      h1 { font-size: 22px; border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin: 0 0 16px; }
      h2 { font-size: 15px; margin: 28px 0 10px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; color: #0f172a; }
      p { margin: 4px 0; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
      th, td { border: 1px solid #cbd5e1; padding: 6px 10px; text-align: left; vertical-align: top; }
      th { background: #f1f5f9; font-weight: 700; color: #475569; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px; }
      .label { font-weight: 600; width: 180px; color: #475569; }
      .meta { color: #64748b; font-size: 11px; margin-bottom: 4px; }
      .empty { color: #94a3b8; font-style: italic; padding: 8px 0; }
      .cover-line { padding: 3px 0; }
      .num { text-align: right; font-variant-numeric: tabular-nums; }
      .comm-card { margin-bottom: 14px; border: 1px solid #e2e8f0; border-radius: 3px; padding: 10px 12px; }
      .comm-subject { font-weight: 700; color: #0f172a; }
      .comm-body { white-space: pre-wrap; color: #334155; margin-top: 4px; }
    </style></head><body>`;

    // Cover
    html += `<h1>Debt Collection Case File</h1>`;
    html += `<p class="cover-line"><strong>Debtor:</strong> ${esc(debt.debtor_name)}</p>`;
    html += `<p class="cover-line"><strong>Company:</strong> ${esc(company?.name || '')}</p>`;
    html += `<p class="cover-line"><strong>Generated:</strong> ${fmtDateTime(new Date())}</p>`;
    html += `<p class="cover-line"><strong>Total Due:</strong> ${fmtMoney(total)}</p>`;

    // Debt Summary
    html += `<h2>1. Debt Summary</h2><table>`;
    const summaryRows: [string, string][] = [
      ['Type', titleCase(debt.type)],
      ['Status', titleCase(debt.status)],
      ['Original Amount', fmtMoney(debt.original_amount)],
      ['Interest Accrued', fmtMoney(debt.interest_accrued)],
      ['Fees', fmtMoney(debt.fees_accrued)],
      ['Payments Made', fmtMoney(debt.payments_made)],
      ['Balance Due', fmtMoney(total)],
      ['Due Date', fmtDate(debt.due_date)],
      ['Delinquent Date', fmtDate(debt.delinquent_date)],
      ['Interest Rate', `${((debt.interest_rate || 0) * 100).toFixed(2)}% (${esc(debt.interest_type || 'simple')})`],
      ['Jurisdiction', esc(debt.jurisdiction) || '\u2014'],
      ['Current Stage', titleCase(debt.current_stage)],
    ];
    for (const [label, value] of summaryRows) {
      html += `<tr><td class="label">${esc(label)}</td><td>${value}</td></tr>`;
    }
    html += `</table>`;

    // Payment History
    html += `<h2>2. Payment History</h2>`;
    if (payments.length === 0) {
      html += `<div class="empty">No payments recorded.</div>`;
    } else {
      html += `<table><thead><tr><th>Date</th><th class="num">Amount</th><th>Method</th><th>Reference</th><th>Notes</th></tr></thead><tbody>`;
      for (const p of payments) {
        html += `<tr>
          <td>${fmtDate(p.received_date)}</td>
          <td class="num">${fmtMoney(p.amount)}</td>
          <td>${titleCase(p.method)}</td>
          <td>${esc(p.reference_number) || '\u2014'}</td>
          <td>${esc(p.notes)}</td>
        </tr>`;
      }
      html += `</tbody></table>`;
    }

    // Communication Log
    html += `<h2>3. Communication Log</h2>`;
    if (comms.length === 0) {
      html += `<div class="empty">No communications recorded.</div>`;
    } else {
      for (const c of comms) {
        html += `<div class="comm-card">
          <div class="meta">${fmtDateTime(c.logged_at)} \u2022 ${titleCase(c.type)} \u2022 ${titleCase(c.direction)}</div>
          <div class="comm-subject">${esc(c.subject) || '(No subject)'}</div>
          <div class="comm-body">${esc(c.body)}</div>
          ${c.outcome ? `<div style="margin-top:6px;color:#64748b;"><em>Outcome:</em> ${esc(c.outcome)}</div>` : ''}
        </div>`;
      }
    }

    // Evidence Timeline
    html += `<h2>4. Evidence Timeline</h2>`;
    if (evidence.length === 0) {
      html += `<div class="empty">No evidence items.</div>`;
    } else {
      html += `<table><thead><tr><th>Date</th><th>Type</th><th>Title</th><th>Description</th><th>Relevance</th></tr></thead><tbody>`;
      for (const e of evidence) {
        html += `<tr>
          <td>${fmtDate(e.date_of_evidence)}</td>
          <td>${titleCase(e.type)}</td>
          <td>${esc(e.title)}</td>
          <td>${esc(e.description)}</td>
          <td>${titleCase(e.court_relevance)}</td>
        </tr>`;
      }
      html += `</tbody></table>`;
    }

    // Interest Breakdown
    html += `<h2>5. Interest Calculation</h2>`;
    html += `<p><strong>Type:</strong> ${titleCase(debt.interest_type || 'simple')} &nbsp;|&nbsp; <strong>Rate:</strong> ${((debt.interest_rate || 0) * 100).toFixed(2)}% &nbsp;|&nbsp; <strong>Start:</strong> ${fmtDate(debt.interest_start_date)}</p>`;
    html += `<p><strong>Accrued:</strong> ${fmtMoney(debt.interest_accrued)}</p>`;

    // Legal Actions
    html += `<h2>6. Legal Actions</h2>`;
    if (legalActions.length === 0) {
      html += `<div class="empty">No legal actions.</div>`;
    } else {
      for (const la of legalActions) {
        html += `<div style="margin-bottom:12px;padding:10px 12px;border:1px solid #e2e8f0;border-radius:3px;">`;
        html += `<p><strong>${titleCase(la.action_type)}</strong> \u2014 Status: ${titleCase(la.status)} | Case: ${esc(la.case_number) || '\u2014'}</p>`;
        if (la.hearing_date) html += `<p class="meta">Hearing: ${fmtDate(la.hearing_date)} ${esc(la.hearing_time) || ''}</p>`;
        if (la.judgment_amount) html += `<p class="meta">Judgment: ${fmtMoney(la.judgment_amount)}</p>`;
        html += `</div>`;
      }
    }

    // Pipeline History
    html += `<h2>7. Pipeline History</h2>`;
    html += `<table><thead><tr><th>Stage</th><th>Entered</th><th>Exited</th><th>Auto</th><th>Notes</th></tr></thead><tbody>`;
    for (const s of stages) {
      html += `<tr>
        <td>${titleCase(s.stage)}</td>
        <td>${fmtDateTime(s.entered_at)}</td>
        <td>${s.exited_at ? fmtDateTime(s.exited_at) : '\u2014'}</td>
        <td>${s.auto_advanced ? 'Yes' : 'No'}</td>
        <td>${esc(s.notes)}</td>
      </tr>`;
    }
    html += `</tbody></table>`;

    html += `</body></html>`;

    const safeName = sanitizeFilename(debt.debtor_name || 'Unknown');
    const result = await saveHTMLAsPDF(html, `Debt Case File \u2014 ${safeName}`, {
      defaultFilename: buildPdfFilename('debt-case', safeName),
    });
    if (result.path) {
      const companyId = db.getCurrentCompanyId();
      if (companyId) {
        try { db.logAudit(companyId, 'debts', debt.id, 'export_pdf', { path: result.path }); }
        catch { /* audit best-effort */ }
      }
    }
    // Preserve old contract: return the path string (empty if cancelled).
    return result.path || '';
  });

  ipcMain.handle('debt:seed-automation', (_event, { companyId }: { companyId: string }) => {
    const existing = db.getDb().prepare('SELECT COUNT(*) as cnt FROM debt_automation_rules WHERE company_id = ?').get(companyId) as any;
    if (existing.cnt > 0) return;
    const defaults: Array<{ from: string; to: string; days: number; action: string; review: number }> = [
      { from: 'reminder', to: 'warning', days: 14, action: 'advance_stage', review: 0 },
      { from: 'warning', to: 'final_notice', days: 14, action: 'advance_stage', review: 0 },
      { from: 'final_notice', to: 'demand_letter', days: 7, action: 'advance_stage', review: 0 },
      { from: 'demand_letter', to: 'collections_agency', days: 14, action: 'flag_review', review: 1 },
      { from: 'collections_agency', to: 'legal_action', days: 30, action: 'flag_review', review: 1 },
    ];
    const stmt = db.getDb().prepare('INSERT INTO debt_automation_rules (id, company_id, from_stage, to_stage, days_after_entry, action, require_review) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const d of defaults) stmt.run(uuid(), companyId, d.from, d.to, d.days, d.action, d.review);
  });

  ipcMain.handle('debt:seed-templates', (_event, { companyId }: { companyId: string }) => {
    const existing = db.getDb().prepare('SELECT COUNT(*) as cnt FROM debt_templates WHERE company_id = ?').get(companyId) as any;
    if (existing.cnt > 0) return;
    const templates = [
      {
        name: 'Friendly Reminder', type: 'reminder', severity: 'friendly',
        subject: 'Friendly Reminder \u2014 Payment Due',
        body: 'Dear {{debtor_name}},\n\nThis is a friendly reminder that your payment of {{total_due}} was due on {{due_date}}. If you have already sent your payment, please disregard this notice.\n\nIf you have any questions about your balance, please don\'t hesitate to contact us at {{company_phone}} or {{company_email}}.\n\nThank you for your prompt attention to this matter.\n\nSincerely,\n{{company_name}}'
      },
      {
        name: 'Formal Warning', type: 'warning', severity: 'formal',
        subject: 'Important Notice \u2014 Past Due Balance of {{total_due}}',
        body: 'Dear {{debtor_name}},\n\nDespite our previous correspondence, your account remains past due in the amount of {{total_due}}. This balance has been outstanding for {{days_overdue}} days.\n\nPlease be advised that interest continues to accrue on this balance at the applicable rate. The current interest charged is {{interest_accrued}}.\n\nWe request immediate payment within 14 days of this notice. Failure to remit payment may result in further collection action.\n\nPlease direct payment or inquiries to:\n{{company_name}}\n{{company_address}}\n{{company_phone}}\n{{company_email}}'
      },
      {
        name: 'Final Demand', type: 'demand_letter', severity: 'final',
        subject: 'FINAL DEMAND \u2014 Immediate Payment Required',
        body: 'RE: Past Due Account \u2014 {{total_due}}\n\nDear {{debtor_name}},\n\nThis letter serves as FINAL DEMAND for payment of the outstanding balance of {{total_due}}, which includes:\n\n  Original Amount: {{original_amount}}\n  Accrued Interest: {{interest_accrued}}\n  Fees: {{fees_accrued}}\n\nThis amount has been past due since {{due_date}} ({{days_overdue}} days).\n\nYOU MUST REMIT FULL PAYMENT BY {{demand_deadline}}.\n\nFailure to pay by this date will result in this matter being referred for legal action, which may include filing a lawsuit to recover the full amount owed plus court costs, attorney fees, and any additional interest permitted by law.\n\nThis is not a threat but a statement of our intent to pursue all available legal remedies.\n\n{{company_name}}\n{{company_address}}\n{{company_phone}}'
      },
    ];
    const stmt = db.getDb().prepare('INSERT INTO debt_templates (id, company_id, name, type, subject, body, severity, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, 1)');
    for (const t of templates) stmt.run(uuid(), companyId, t.name, t.type, t.subject, t.body, t.severity);
  });

  ipcMain.handle('debt:run-escalation', (_event, { companyId }: { companyId: string }) => {
    const rules = db.getDb().prepare('SELECT * FROM debt_automation_rules WHERE company_id = ? AND enabled = 1 AND debt_id IS NULL').all(companyId) as any[];
    let advanced = 0, flagged = 0;
    for (const rule of rules) {
      const debts = db.getDb().prepare(`
        SELECT d.id FROM debts d
        JOIN debt_pipeline_stages dps ON dps.debt_id = d.id AND dps.stage = d.current_stage AND dps.exited_at IS NULL
        WHERE d.company_id = ? AND d.current_stage = ? AND d.hold = 0
        AND d.status NOT IN ('settled','written_off','bankruptcy')
        AND julianday('now') - julianday(dps.entered_at) >= ?
      `).all(companyId, rule.from_stage, rule.days_after_entry) as any[];
      for (const debt of debts) {
        if (rule.require_review) {
          flagged++;
        } else {
          // Auto-advance
          const currentDebt = db.getDb().prepare('SELECT current_stage FROM debts WHERE id = ?').get(debt.id) as any;
          const currentIdx = DEBT_STAGE_ORDER.indexOf(currentDebt.current_stage);
          if (currentIdx >= 0 && currentIdx < DEBT_STAGE_ORDER.length - 1) {
            const nextStage = DEBT_STAGE_ORDER[currentIdx + 1];
            db.getDb().prepare('UPDATE debt_pipeline_stages SET exited_at = datetime(\'now\') WHERE debt_id = ? AND stage = ? AND exited_at IS NULL').run(debt.id, currentDebt.current_stage);
            db.getDb().prepare('INSERT INTO debt_pipeline_stages (id, debt_id, stage, auto_advanced) VALUES (?, ?, ?, 1)').run(uuid(), debt.id, nextStage);
            const newStatus = ['legal_action','judgment','garnishment'].includes(nextStage) ? 'legal' : 'in_collection';
            db.getDb().prepare('UPDATE debts SET current_stage = ?, status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(nextStage, newStatus, debt.id);
            advanced++;
          }
        }
      }
    }
    return { advanced, flagged };
  });

  ipcMain.handle('debt:analytics', (_event, { companyId, startDate, endDate }: { companyId: string; startDate: string; endDate: string }) => {
    // Collection rate by month
    const collectionByMonth = db.getDb().prepare(`
      SELECT strftime('%Y-%m', dp.received_date) as month, SUM(dp.amount) as total
      FROM debt_payments dp JOIN debts d ON dp.debt_id = d.id
      WHERE d.company_id = ? AND dp.received_date BETWEEN ? AND ?
      GROUP BY month ORDER BY month
    `).all(companyId, startDate, endDate);

    // Aging breakdown
    const aging = db.getDb().prepare(`
      SELECT
        CASE
          WHEN julianday('now') - julianday(delinquent_date) <= 30 THEN '0-30'
          WHEN julianday('now') - julianday(delinquent_date) <= 60 THEN '31-60'
          WHEN julianday('now') - julianday(delinquent_date) <= 90 THEN '61-90'
          WHEN julianday('now') - julianday(delinquent_date) <= 120 THEN '91-120'
          WHEN julianday('now') - julianday(delinquent_date) <= 180 THEN '121-180'
          ELSE '180+'
        END as bucket,
        COUNT(*) as count, SUM(balance_due) as total
      FROM debts WHERE company_id = ? AND status NOT IN ('settled','written_off') AND delinquent_date IS NOT NULL
      GROUP BY bucket
    `).all(companyId);

    // Recovery by stage
    const recoveryByStage = db.getDb().prepare(`
      SELECT current_stage as stage, COUNT(*) as count
      FROM debts WHERE company_id = ? AND status IN ('settled','written_off')
      GROUP BY current_stage
    `).all(companyId);

    // Top debtors
    const topDebtors = db.getDb().prepare(`
      SELECT debtor_name, SUM(balance_due) as total
      FROM debts WHERE company_id = ? AND status NOT IN ('settled','written_off')
      GROUP BY debtor_name ORDER BY total DESC LIMIT 10
    `).all(companyId);

    // Pipeline velocity
    const velocity = db.getDb().prepare(`
      SELECT stage, AVG(julianday(exited_at) - julianday(entered_at)) as avg_days
      FROM debt_pipeline_stages WHERE exited_at IS NOT NULL
      AND debt_id IN (SELECT id FROM debts WHERE company_id = ?)
      GROUP BY stage
    `).all(companyId);

    return { collectionByMonth, aging, recoveryByStage, topDebtors, velocity };
  });

  // ─── Debt Payment Plans ───────────────────────────────────
  ipcMain.handle('debt:payment-plan-get', (_event, { debtId }) => {
    try {
      const plan = db.queryAll('debt_payment_plans', { debt_id: debtId })[0] || null;
      if (!plan) return null;
      const installments = db.queryAll('debt_plan_installments', { plan_id: plan.id },
        { field: 'due_date', dir: 'asc' });
      return { ...plan, installments };
    } catch { return null; }
  });

  ipcMain.handle('debt:payment-plan-save', (_event, data) => {
    try {
      const { debt_id, installment_amount, frequency, start_date, total_installments, notes } = data;
      // Delete existing plan+installments for this debt
      const existing = db.queryAll('debt_payment_plans', { debt_id })[0];
      if (existing) {
        db.getDb().prepare('DELETE FROM debt_plan_installments WHERE plan_id = ?').run(existing.id);
        db.remove('debt_payment_plans', existing.id);
      }
      // Create new plan
      const plan = db.create('debt_payment_plans', {
        debt_id, installment_amount, frequency,
        start_date, total_installments: total_installments || 1,
        notes: notes || '', status: 'active'
      });
      // Generate installments
      const freqDays: Record<string, number> = { weekly: 7, biweekly: 14, monthly: 30 };
      const days = freqDays[frequency] || 30;
      let d = new Date(start_date + 'T12:00:00');
      for (let i = 0; i < (total_installments || 1); i++) {
        db.create('debt_plan_installments', {
          plan_id: plan.id,
          due_date: d.toISOString().slice(0, 10),
          amount: installment_amount,
          paid: 0,
        });
        d.setDate(d.getDate() + days);
      }
      logDebtAudit(debt_id, 'plan_created', 'payment_plan', '', installment_amount ? '$' + installment_amount + ' plan' : 'Plan saved');
      scheduleAutoBackup();
      return db.queryAll('debt_plan_installments', { plan_id: plan.id }, { field: 'due_date', dir: 'asc' });
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('debt:plan-installment-toggle', (_event, { installmentId, paid }) => {
    try {
      db.update('debt_plan_installments', installmentId, {
        paid: paid ? 1 : 0,
        paid_date: paid ? new Date().toISOString().slice(0, 10) : '',
      });
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('debt:settlements-list', (_event, { debtId }) => {
    try {
      return db.queryAll('debt_settlements', { debt_id: debtId }, { field: 'created_at', dir: 'desc' });
    } catch { return []; }
  });

  ipcMain.handle('debt:settlement-save', (_event, data) => {
    try {
      const { debt_id, offer_amount, balance_due, offered_date, notes } = data;
      const offer_pct = balance_due > 0 ? (offer_amount / balance_due) * 100 : 0;
      const result = db.create('debt_settlements', {
        debt_id, offer_amount, offer_pct, offered_date,
        notes: notes || '', response: 'pending',
      });
      logDebtAudit(debt_id, 'settlement_offered', 'offer_amount', '', String(offer_amount || 0));
      scheduleAutoBackup();
      return result;
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('debt:settlement-respond', (_event, { settlementId, response, counter_amount }) => {
    try {
      const data: any = { response };
      if (response === 'accepted') data.accepted_date = new Date().toISOString().slice(0, 10);
      if (counter_amount != null) data.counter_amount = counter_amount;
      db.update('debt_settlements', settlementId, data);
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('debt:settlement-accept', (_event, { debtId, settlementId, offer_amount }) => {
    try {
      db.update('debt_settlements', settlementId, {
        response: 'accepted',
        accepted_date: new Date().toISOString().slice(0, 10),
      });
      db.update('debts', debtId, { status: 'settled', balance_due: offer_amount });
      logDebtAudit(debtId, 'settlement_accepted', 'status', 'in_collection', 'settled');
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('debt:compliance-list', (_event, { debtId }) => {
    try {
      return db.queryAll('debt_compliance_log', { debt_id: debtId }, { field: 'event_date', dir: 'desc' });
    } catch { return []; }
  });

  ipcMain.handle('debt:compliance-save', (_event, data) => {
    try {
      const result = db.create('debt_compliance_log', data);
      logDebtAudit(data.debt_id, 'compliance_event', 'event_type', '', data.event_type || '');
      scheduleAutoBackup();
      return result;
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('debt:check-auto-advance', (_event, { companyId, thresholdDays = 30 }) => {
    try {
      const STAGE_ORDER = ['reminder', 'warning', 'final_notice', 'demand_letter', 'collections_agency', 'legal_action'];
      const debts = db.queryAll('debts', { company_id: companyId, auto_advance_enabled: 1 });
      let advanced = 0;
      const now = new Date();

      for (const debt of debts) {
        const stageIdx = STAGE_ORDER.indexOf((debt as any).current_stage);
        if (stageIdx < 0 || stageIdx >= STAGE_ORDER.length - 1) continue;

        const lastActivity = new Date((debt as any).updated_at || (debt as any).created_at);
        const daysSince = Math.floor((now.getTime() - lastActivity.getTime()) / 86400000);

        if (daysSince >= thresholdDays) {
          const nextStage = STAGE_ORDER[stageIdx + 1];
          db.update('debts', (debt as any).id, { current_stage: nextStage });
          db.create('debt_pipeline_stages', { debt_id: (debt as any).id, stage: nextStage, auto_advanced: 1, advanced_by: 'system' });
          db.create('debt_communications', {
            debt_id: (debt as any).id,
            type: 'letter',
            direction: 'outbound',
            subject: 'Auto-advance notification',
            body: `Auto-advanced from ${(debt as any).current_stage} to ${nextStage} after ${daysSince} days of inactivity.`,
            outcome: 'auto_advanced',
            logged_by: 'system',
          });
          advanced++;
        }
      }

      if (advanced > 0) scheduleAutoBackup();
      return { advanced };
    } catch (err: any) {
      return { error: err.message, advanced: 0 };
    }
  });

  // ─── Debt Activity Timeline ──────────────────────────────
  ipcMain.handle('debt:activity-timeline', (_event, { debtId }: { debtId: string }) => {
    try {
      const dbConn = db.getDb();
      const events: Array<{ id: string; ts: string; kind: string; label: string; detail: string; icon: string }> = [];

      // Communications
      const comms = dbConn.prepare(
        `SELECT id, type, direction, subject, outcome, logged_at FROM debt_communications WHERE debt_id = ? ORDER BY logged_at DESC`
      ).all(debtId) as any[];
      for (const c of comms) {
        const dir = c.direction === 'inbound' ? '← Inbound' : '→ Outbound';
        events.push({ id: c.id, ts: c.logged_at, kind: 'comm', label: `${dir} ${c.type}`, detail: c.subject || c.outcome || '', icon: 'comm' });
      }

      // Stage changes
      const stages = dbConn.prepare(
        `SELECT id, stage, entered_at, exited_at, notes FROM debt_pipeline_stages WHERE debt_id = ? ORDER BY entered_at DESC`
      ).all(debtId) as any[];
      for (const s of stages) {
        events.push({ id: s.id, ts: s.entered_at, kind: 'stage', label: `Stage: ${s.stage.replace(/_/g, ' ')}`, detail: s.notes || '', icon: 'stage' });
      }

      // Payments
      const payments = dbConn.prepare(
        `SELECT id, amount, received_date, payment_method, notes FROM debt_payments WHERE debt_id = ? ORDER BY received_date DESC`
      ).all(debtId) as any[];
      for (const p of payments) {
        events.push({ id: p.id, ts: p.received_date + 'T00:00:00', kind: 'payment', label: `Payment received: $${Number(p.amount).toFixed(2)}`, detail: [p.payment_method, p.notes].filter(Boolean).join(' — '), icon: 'payment' });
      }

      // Promises
      const promises = dbConn.prepare(
        `SELECT id, promised_date, promised_amount, kept, notes FROM debt_promises WHERE debt_id = ? ORDER BY promised_date DESC`
      ).all(debtId) as any[];
      for (const p of promises) {
        const status = p.kept ? 'Kept' : (p.promised_date < new Date().toISOString().slice(0, 10) ? 'Broken' : 'Pending');
        events.push({ id: p.id, ts: p.promised_date + 'T00:00:00', kind: 'promise', label: `Promise to pay $${Number(p.promised_amount).toFixed(2)} — ${status}`, detail: p.notes || '', icon: 'promise' });
      }

      // Compliance events
      const compliance = dbConn.prepare(
        `SELECT id, event_type, event_date, notes FROM debt_compliance_log WHERE debt_id = ? ORDER BY event_date DESC`
      ).all(debtId) as any[];
      for (const c of compliance) {
        events.push({ id: c.id, ts: c.event_date + 'T00:00:00', kind: 'compliance', label: `Compliance: ${c.event_type.replace(/_/g, ' ')}`, detail: c.notes || '', icon: 'compliance' });
      }

      // Settlements
      const settlements = dbConn.prepare(
        `SELECT id, offer_amount, response, offered_date, notes FROM debt_settlements WHERE debt_id = ? ORDER BY offered_date DESC`
      ).all(debtId) as any[];
      for (const s of settlements) {
        events.push({ id: s.id, ts: s.offered_date + 'T00:00:00', kind: 'settlement', label: `Settlement offer: $${Number(s.offer_amount).toFixed(2)} — ${s.response}`, detail: s.notes || '', icon: 'settlement' });
      }

      // Quick notes
      const notes = dbConn.prepare(
        `SELECT id, note, created_at FROM debt_notes WHERE debt_id = ? ORDER BY created_at DESC`
      ).all(debtId) as any[];
      for (const n of notes) {
        events.push({ id: n.id, ts: n.created_at, kind: 'note', label: 'Note', detail: n.note, icon: 'note' });
      }

      // Sort descending by timestamp
      events.sort((a, b) => (b.ts > a.ts ? 1 : b.ts < a.ts ? -1 : 0));
      return events;
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('debt:quick-note', (_event, { debtId, note }: { debtId: string; note: string }) => {
    try {
      const result = db.create('debt_notes', { debt_id: debtId, note, created_by: 'user' });
      logDebtAudit(debtId, 'note_added', 'notes', '', note.substring(0, 100));
      scheduleAutoBackup();
      return result;
    } catch (err: any) {
      return { error: err.message };
    }
  });

  // ─── Debt: Add Fee ────────────────────────────────────────
  ipcMain.handle('debt:add-fee', (_event, { debtId, amount, feeType, description }: { debtId: string; amount: number; feeType: string; description: string }) => {
    if (!amount || amount <= 0) return { error: 'Fee amount must be greater than zero' };
    try {
      const dbInstance = db.getDb();
      const addFeeTx = dbInstance.transaction(() => {
        dbInstance.prepare(
          `UPDATE debts SET fees_accrued = fees_accrued + ?, balance_due = balance_due + ?, updated_at = datetime('now') WHERE id = ?`
        ).run(amount, amount, debtId);
        // Log as activity note
        db.create('debt_notes', {
          debt_id: debtId,
          note: `Fee added: $${amount.toFixed(2)} (${feeType}) — ${description || 'No description'}`,
          created_by: 'system',
        });
      });
      addFeeTx();
      logDebtAudit(debtId, 'fee_added', 'fees_accrued', '', amount.toFixed(2) + ' (' + feeType + ')');
      scheduleAutoBackup();
      return { success: true };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  // ─── Debt: Collector Performance ─────────────────────────
  ipcMain.handle('debt:collector-performance', (_event, { startDate, endDate }: { startDate?: string; endDate?: string }) => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return [];
      const dbInstance = db.getDb();
      const dateFilter = startDate && endDate
        ? `AND d.created_at BETWEEN '${startDate}' AND '${endDate}'`
        : '';
      const rows = dbInstance.prepare(`
        SELECT
          u.id as collector_id,
          u.name as collector_name,
          COUNT(DISTINCT d.id) as active_cases,
          COALESCE(SUM(d.original_amount), 0) as total_owed,
          COALESCE(SUM(d.payments_made), 0) as total_collected,
          CASE WHEN SUM(d.original_amount) > 0
            THEN ROUND(SUM(d.payments_made) * 100.0 / SUM(d.original_amount), 1)
            ELSE 0 END as recovery_rate,
          COALESCE(AVG(
            CASE WHEN d.payments_made > 0
              THEN CAST(julianday((SELECT MIN(dp.received_date) FROM debt_payments dp WHERE dp.debt_id = d.id)) - julianday(d.delinquent_date) AS INTEGER)
              ELSE NULL END
          ), 0) as avg_days_to_first_payment
        FROM users u
        INNER JOIN debts d ON d.assigned_collector_id = u.id AND d.company_id = ?
        ${dateFilter}
        GROUP BY u.id, u.name
        ORDER BY total_collected DESC
      `).all(companyId);
      return rows;
    } catch (err: any) {
      console.error('debt:collector-performance error:', err);
      return [];
    }
  });

  // ─── Debt: Collector Dashboard ────────────────────────────
  ipcMain.handle('debt:collector-dashboard', (_event, { companyId }: { companyId: string }) => {
    try {
      const dbInstance = db.getDb();
      const today = new Date().toISOString().slice(0, 10);
      const weekAhead = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

      const brokenPromises = dbInstance.prepare(`
        SELECT dp.*, d.debtor_name, d.balance_due, d.id as debt_id
        FROM debt_promises dp
        JOIN debts d ON dp.debt_id = d.id
        WHERE d.company_id = ? AND dp.kept = 0 AND dp.promised_date < ?
        ORDER BY dp.promised_date DESC LIMIT 25
      `).all(companyId, today);

      const overdueInstallments = dbInstance.prepare(`
        SELECT dpi.*, dpp.debt_id, d.debtor_name, d.balance_due
        FROM debt_plan_installments dpi
        JOIN debt_payment_plans dpp ON dpi.plan_id = dpp.id
        JOIN debts d ON dpp.debt_id = d.id
        WHERE d.company_id = ? AND dpi.paid = 0 AND dpi.due_date < ?
        ORDER BY dpi.due_date ASC LIMIT 25
      `).all(companyId, today);

      const upcomingHearings = dbInstance.prepare(`
        SELECT dla.*, d.debtor_name, d.balance_due, d.id as debt_id
        FROM debt_legal_actions dla
        JOIN debts d ON dla.debt_id = d.id
        WHERE d.company_id = ? AND dla.hearing_date BETWEEN ? AND ?
        ORDER BY dla.hearing_date ASC LIMIT 25
      `).all(companyId, today, weekAhead);

      const followUpsDue = dbInstance.prepare(`
        SELECT dc.*, d.debtor_name, d.balance_due, d.id as debt_id
        FROM debt_communications dc
        JOIN debts d ON dc.debt_id = d.id
        WHERE d.company_id = ? AND dc.next_action_date <= ? AND dc.next_action_date != ''
        ORDER BY dc.next_action_date ASC LIMIT 25
      `).all(companyId, today);

      return { brokenPromises, overdueInstallments, upcomingHearings, followUpsDue };
    } catch (err: any) {
      console.error('debt:collector-dashboard error:', err);
      return { brokenPromises: [], overdueInstallments: [], upcomingHearings: [], followUpsDue: [] };
    }
  });

  // ─── Debt: Upcoming Installments ─────────────────────────
  ipcMain.handle('debt:upcoming-installments', (_event, { debtId }: { debtId: string }) => {
    try {
      const dbInstance = db.getDb();
      const rows = dbInstance.prepare(`
        SELECT dpi.*, dpp.debt_id
        FROM debt_plan_installments dpi
        JOIN debt_payment_plans dpp ON dpi.plan_id = dpp.id
        WHERE dpp.debt_id = ?
        ORDER BY dpi.due_date ASC
      `).all(debtId);
      return rows;
    } catch (err: any) {
      return [];
    }
  });

  // ─── Debt: Upload Document ───────────────────────────────
  ipcMain.handle('debt:upload-document', async (_event, { debtId, filePath, fileName, fileSize }: { debtId: string; filePath: string; fileName: string; fileSize: number }) => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) throw new Error('No active company');
      const result = db.create('documents', {
        company_id: companyId,
        filename: fileName,
        file_path: filePath,
        file_size: fileSize || 0,
        mime_type: '',
        entity_type: 'debt',
        entity_id: debtId,
        tags: '[]',
        description: '',
      });
      scheduleAutoBackup();
      return result;
    } catch (err: any) {
      return { error: err.message };
    }
  });

  // ─── Debt: Bank Payment Matching ─────────────────────────────
  ipcMain.handle('debt:match-bank-payments', () => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return { auto_matched: 0, suggested: 0 };
      const dbInstance = db.getDb();

      // Get credit-side bank transactions not already matched
      const txns = dbInstance.prepare(`
        SELECT bt.* FROM bank_transactions bt
        JOIN bank_accounts ba ON bt.bank_account_id = ba.id
        WHERE ba.company_id = ? AND bt.type = 'credit'
          AND bt.id NOT IN (SELECT bank_transaction_id FROM debt_payment_matches)
          AND bt.id NOT IN (SELECT COALESCE(reference_number, '') FROM debt_payments WHERE reference_number IS NOT NULL AND reference_number != '')
        ORDER BY bt.date DESC LIMIT 200
      `).all(companyId) as any[];

      // Get active debts for matching
      const debts = dbInstance.prepare(`
        SELECT d.id, d.debtor_name, d.balance_due, d.source_id, i.invoice_number
        FROM debts d
        LEFT JOIN invoices i ON d.source_id = i.id
        WHERE d.company_id = ? AND d.status NOT IN ('settled', 'written_off') AND d.balance_due > 0
      `).all(companyId) as any[];

      let autoMatched = 0;
      let suggested = 0;

      const matchTx = dbInstance.transaction(() => {
        for (const txn of txns) {
          const memo = (txn.description || txn.reference || '').toLowerCase();
          let matched = false;

          // Auto-match: check if memo contains an invoice number or debt source_id prefix
          for (const debt of debts) {
            const invoiceNum = (debt.invoice_number || '').toLowerCase();
            const sourcePrefix = (debt.source_id || '').substring(0, 8).toLowerCase();

            if (invoiceNum && memo.includes(invoiceNum)) {
              db.create('debt_payments', {
                debt_id: debt.id,
                amount: txn.amount,
                method: 'ach',
                reference_number: txn.id,
                received_date: txn.date || new Date().toISOString().slice(0, 10),
                applied_to_principal: txn.amount,
                applied_to_interest: 0,
                applied_to_fees: 0,
                notes: 'Auto-matched from bank import: ' + (txn.description || ''),
              });

              db.create('debt_payment_matches', {
                bank_transaction_id: txn.id,
                debt_id: debt.id,
                match_type: 'auto',
                confidence: 0.95,
                status: 'accepted',
              });

              logDebtAudit(debt.id, 'payment_recorded', 'amount', '', String(txn.amount) + ' (auto-matched from bank)');
              autoMatched++;
              matched = true;
              break;
            }

            if (sourcePrefix && sourcePrefix.length >= 6 && memo.includes(sourcePrefix)) {
              db.create('debt_payments', {
                debt_id: debt.id,
                amount: txn.amount,
                method: 'ach',
                reference_number: txn.id,
                received_date: txn.date || new Date().toISOString().slice(0, 10),
                applied_to_principal: txn.amount,
                applied_to_interest: 0,
                applied_to_fees: 0,
                notes: 'Auto-matched from bank import: ' + (txn.description || ''),
              });

              db.create('debt_payment_matches', {
                bank_transaction_id: txn.id,
                debt_id: debt.id,
                match_type: 'auto',
                confidence: 0.85,
                status: 'accepted',
              });

              logDebtAudit(debt.id, 'payment_recorded', 'amount', '', String(txn.amount) + ' (auto-matched from bank)');
              autoMatched++;
              matched = true;
              break;
            }
          }

          if (matched) continue;

          // Suggested match: amount within $0.01 of a debt's balance
          for (const debt of debts) {
            if (Math.abs(txn.amount - debt.balance_due) <= 0.01) {
              db.create('debt_payment_matches', {
                bank_transaction_id: txn.id,
                debt_id: debt.id,
                match_type: 'suggested',
                confidence: 0.7,
                status: 'pending',
              });
              suggested++;
              break;
            }
          }
        }
      });
      matchTx();
      if (autoMatched > 0) scheduleAutoBackup();
      return { auto_matched: autoMatched, suggested };
    } catch (err: any) {
      return { error: err.message, auto_matched: 0, suggested: 0 };
    }
  });

  ipcMain.handle('debt:list-pending-matches', () => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return [];
      return db.getDb().prepare(`
        SELECT dpm.*, bt.date as txn_date, bt.amount as txn_amount, bt.description as txn_memo,
               d.debtor_name, d.balance_due
        FROM debt_payment_matches dpm
        JOIN bank_transactions bt ON dpm.bank_transaction_id = bt.id
        JOIN debts d ON dpm.debt_id = d.id
        WHERE d.company_id = ? AND dpm.status = 'pending'
        ORDER BY dpm.created_at DESC
      `).all(companyId);
    } catch (_) { return []; }
  });

  ipcMain.handle('debt:accept-match', (_event, { matchId }: { matchId: string }) => {
    try {
      const dbInstance = db.getDb();
      const match = dbInstance.prepare('SELECT * FROM debt_payment_matches WHERE id = ?').get(matchId) as any;
      if (!match) return { error: 'Match not found' };

      const txn = dbInstance.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(match.bank_transaction_id) as any;
      if (!txn) return { error: 'Transaction not found' };

      db.create('debt_payments', {
        debt_id: match.debt_id,
        amount: txn.amount,
        method: 'ach',
        reference_number: txn.id,
        received_date: txn.date || new Date().toISOString().slice(0, 10),
        applied_to_principal: txn.amount,
        applied_to_interest: 0,
        applied_to_fees: 0,
        notes: 'Matched from bank import: ' + (txn.description || ''),
      });

      dbInstance.prepare('UPDATE debt_payment_matches SET status = ? WHERE id = ?').run('accepted', matchId);
      logDebtAudit(match.debt_id, 'payment_recorded', 'amount', '', String(txn.amount) + ' (bank match accepted)');
      scheduleAutoBackup();
      return { success: true };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('debt:reject-match', (_event, { matchId }: { matchId: string }) => {
    try {
      db.getDb().prepare('UPDATE debt_payment_matches SET status = ? WHERE id = ?').run('rejected', matchId);
      return { success: true };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  // ─── Invoice: Apply Late Fees ─────────────────────────────
  ipcMain.handle('invoice:apply-late-fees', () => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return { applied: 0 };
      const dbInstance = db.getDb();
      const today = new Date().toISOString().slice(0, 10);
      const overdue = dbInstance.prepare(`
        SELECT id, total, late_fee_pct, late_fee_grace_days, due_date
        FROM invoices
        WHERE company_id = ? AND status IN ('sent','overdue','partial')
          AND late_fee_pct > 0 AND late_fee_applied = 0
          AND due_date != '' AND due_date IS NOT NULL
      `).all(companyId) as any[];

      let applied = 0;
      const applyTx = dbInstance.transaction(() => {
        for (const inv of overdue) {
          const daysOverdue = Math.floor((Date.now() - new Date(inv.due_date).getTime()) / 86_400_000);
          if (daysOverdue <= (inv.late_fee_grace_days || 0)) continue;
          const feeAmount = Math.round((inv.total || 0) * (inv.late_fee_pct / 100) * 100) / 100;
          if (feeAmount <= 0) continue;
          dbInstance.prepare(`
            UPDATE invoices SET late_fee_amount = ?, late_fee_applied = 1, status = 'overdue', updated_at = datetime('now')
            WHERE id = ?
          `).run(feeAmount, inv.id);
          applied++;
        }
      });
      applyTx();
      if (applied > 0) scheduleAutoBackup();
      return { applied };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  // ─── Invoice: Run Dunning ────────────────────────────────
  ipcMain.handle('invoice:run-dunning', () => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return { advanced: 0 };
      const dbInstance = db.getDb();
      const overdue = dbInstance.prepare(`
        SELECT id, due_date, dunning_stage, client_id
        FROM invoices
        WHERE company_id = ? AND status IN ('sent','overdue','partial')
          AND due_date != '' AND due_date IS NOT NULL
      `).all(companyId) as any[];

      // Dunning thresholds: stage 0→1 at 7d, 1→2 at 14d, 2→3 at 30d, 3→4 at 45d
      const thresholds = [7, 14, 30, 45];
      let advanced = 0;
      const dunningTx = dbInstance.transaction(() => {
        for (const inv of overdue) {
          const daysOverdue = Math.floor((Date.now() - new Date(inv.due_date).getTime()) / 86_400_000);
          const currentStage = inv.dunning_stage || 0;
          if (currentStage >= 4) continue;
          const nextThreshold = thresholds[currentStage];
          if (daysOverdue >= nextThreshold) {
            dbInstance.prepare(`UPDATE invoices SET dunning_stage = ?, updated_at = datetime('now') WHERE id = ?`).run(currentStage + 1, inv.id);
            advanced++;
          }
        }
      });
      dunningTx();
      if (advanced > 0) scheduleAutoBackup();
      return { advanced };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  // ─── Payroll: Employee Summary ───────────────────────────
  ipcMain.handle('payroll:employee-summary', (_event, { employeeId }: { employeeId: string }) => {
    try {
      const dbInstance = db.getDb();
      const year = new Date().getFullYear();
      const yearStart = `${year}-01-01`;
      const yearEnd = `${year}-12-31`;
      const ytd = dbInstance.prepare(`
        SELECT
          COALESCE(SUM(gross_pay), 0) as ytd_gross,
          COALESCE(SUM(net_pay), 0) as ytd_net,
          COALESCE(SUM(federal_tax + state_tax + social_security + medicare), 0) as ytd_taxes,
          COALESCE(SUM(total_deductions), 0) as ytd_deductions,
          COUNT(*) as pay_count,
          MAX(pr.pay_date) as last_pay_date
        FROM pay_stubs ps
        JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
        WHERE ps.employee_id = ? AND pr.pay_date BETWEEN ? AND ?
      `).get(employeeId, yearStart, yearEnd) as any;

      const deductions = dbInstance.prepare(`
        SELECT * FROM employee_deductions WHERE employee_id = ? AND (end_date IS NULL OR end_date >= ?)
        ORDER BY type, name
      `).all(employeeId, yearStart);

      return { ytd: ytd || {}, deductions };
    } catch (err: any) {
      return { ytd: {}, deductions: [] };
    }
  });

  // ─── Reports: Budget vs Actual ───────────────────────────
  ipcMain.handle('reports:budget-vs-actual', (_event, { budgetId }: { budgetId: string }) => {
    try {
      const dbInstance = db.getDb();
      const budget = dbInstance.prepare('SELECT * FROM budgets WHERE id = ?').get(budgetId) as any;
      if (!budget) return { error: 'Budget not found' };

      const lines = dbInstance.prepare('SELECT * FROM budget_lines WHERE budget_id = ? ORDER BY category').all(budgetId) as any[];
      const companyId = budget.company_id;

      // Get actual expenses grouped by category for the budget period
      const actuals = dbInstance.prepare(`
        SELECT c.name as category, COALESCE(SUM(e.amount), 0) as actual
        FROM expenses e
        LEFT JOIN categories c ON e.category_id = c.id
        WHERE e.company_id = ? AND e.date BETWEEN ? AND ?
        GROUP BY c.name
      `).all(companyId, budget.start_date, budget.end_date) as any[];

      const actualMap = new Map(actuals.map((a: any) => [a.category, a.actual]));

      const comparison = lines.map((line: any) => {
        const actual = actualMap.get(line.category) || 0;
        const variance = line.amount - actual;
        const variancePct = line.amount > 0 ? Math.round((variance / line.amount) * 100) : 0;
        return {
          category: line.category,
          budgeted: line.amount,
          actual,
          variance,
          variance_pct: variancePct,
        };
      });

      return { budget, comparison };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  // ─── Quotes ──────────────────────────────────────────────
  ipcMain.handle('quotes:next-number', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return 'QT-1001';
    // Use last quote_number instead of COUNT to avoid duplicates after deletions
    const row = db.getDb().prepare(`SELECT quote_number FROM quotes WHERE company_id = ? ORDER BY created_at DESC LIMIT 1`).get(companyId) as any;
    if (!row?.quote_number) return 'QT-1001';
    const match = row.quote_number.match(/(\d+)$/);
    if (!match) return 'QT-1001';
    const next = parseInt(match[1], 10) + 1;
    const prefix = row.quote_number.slice(0, row.quote_number.length - match[1].length);
    return `${prefix}${String(next).padStart(match[1].length, '0')}`;
  });

  ipcMain.handle('quotes:convert-to-invoice', (_event, { quoteId }: { quoteId: string }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) throw new Error('No active company');
    const dbInstance = db.getDb();

    const convertTx = dbInstance.transaction(() => {
      const quote = dbInstance.prepare('SELECT * FROM quotes WHERE id = ?').get(quoteId) as any;
      if (!quote) throw new Error('Quote not found');
      const lines = dbInstance.prepare('SELECT * FROM quote_line_items WHERE quote_id = ? ORDER BY sort_order').all(quoteId) as any[];

      // Generate invoice number from last existing number (avoids duplicates on deletion)
      const lastInv = dbInstance.prepare(`SELECT invoice_number FROM invoices WHERE company_id = ? ORDER BY created_at DESC LIMIT 1`).get(quote.company_id) as any;
      let invoiceNumber = 'INV-1001';
      if (lastInv?.invoice_number) {
        const m = lastInv.invoice_number.match(/(\d+)$/);
        if (m) {
          const prefix = lastInv.invoice_number.slice(0, lastInv.invoice_number.length - m[1].length);
          invoiceNumber = `${prefix}${String(parseInt(m[1], 10) + 1).padStart(m[1].length, '0')}`;
        }
      }

      const invoiceId = uuid();
      dbInstance.prepare(`INSERT INTO invoices (id, company_id, invoice_number, client_id, issue_date, due_date, subtotal, tax_amount, discount_amount, total, notes, terms, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`).run(
        invoiceId, quote.company_id, invoiceNumber, quote.client_id, new Date().toISOString().split('T')[0],
        new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
        quote.subtotal, quote.tax_amount, quote.discount_amount, quote.total, quote.notes, quote.terms
      );

      for (const line of lines) {
        dbInstance.prepare('INSERT INTO invoice_line_items (id, invoice_id, description, quantity, unit_price, tax_rate, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
          uuid(), invoiceId, line.description, line.quantity, line.unit_price, line.tax_rate, line.amount, line.sort_order
        );
      }

      dbInstance.prepare("UPDATE quotes SET status = 'converted', converted_invoice_id = ?, updated_at = datetime('now') WHERE id = ?").run(invoiceId, quoteId);
      return { invoice_id: invoiceId };
    });

    return convertTx();
  });

  // ─── Client Insights ─────────────────────────────────────
  ipcMain.handle('client:insights', (_event, { clientId }: { clientId: string }) => {
    const dbI = db.getDb();

    const invoiced = dbI.prepare('SELECT COALESCE(SUM(total), 0) as total FROM invoices WHERE client_id = ?').get(clientId) as any;
    const paid = dbI.prepare('SELECT COALESCE(SUM(amount_paid), 0) as total FROM invoices WHERE client_id = ?').get(clientId) as any;
    const outstanding = dbI.prepare("SELECT COALESCE(SUM(total - amount_paid), 0) as total FROM invoices WHERE client_id = ? AND status NOT IN ('paid','void','cancelled')").get(clientId) as any;
    const avgDays = dbI.prepare("SELECT AVG(julianday(updated_at) - julianday(issue_date)) as avg_days FROM invoices WHERE client_id = ? AND status = 'paid'").get(clientId) as any;
    const statusBreakdown = dbI.prepare('SELECT status, COUNT(*) as count FROM invoices WHERE client_id = ? GROUP BY status').all(clientId);
    const paymentHistory = dbI.prepare(`
      SELECT strftime('%Y-%m', updated_at) as month, SUM(amount_paid) as total
      FROM invoices WHERE client_id = ? AND status = 'paid'
      GROUP BY month ORDER BY month DESC LIMIT 12
    `).all(clientId);
    const projects = dbI.prepare("SELECT COUNT(*) as count FROM projects WHERE client_id = ? AND status != 'completed'").get(clientId) as any;
    const lifetime = dbI.prepare('SELECT COALESCE(SUM(amount_paid), 0) as total FROM invoices WHERE client_id = ?').get(clientId) as any;

    return {
      total_invoiced: invoiced?.total || 0,
      total_paid: paid?.total || 0,
      outstanding: outstanding?.total || 0,
      avg_payment_days: Math.round(avgDays?.avg_days || 0),
      status_breakdown: statusBreakdown,
      payment_history: paymentHistory,
      active_projects: projects?.count || 0,
      lifetime_value: lifetime?.total || 0,
    };
  });

  // ─── Project Profitability ───────────────────────────────
  ipcMain.handle('project:profitability', (_event, { projectId }: { projectId: string }) => {
    const dbI = db.getDb();

    // Revenue = sum of line item amounts on invoices linked to this project
    // (invoices don't have project_id; the link is via invoice_line_items.project_id)
    const revenue = dbI.prepare(`
      SELECT COALESCE(SUM(ili.amount), 0) as total
      FROM invoice_line_items ili
      JOIN invoices i ON i.id = ili.invoice_id
      WHERE ili.project_id = ?
        AND i.status IN ('sent', 'paid', 'partial')
    `).get(projectId) as any;
    const costs = dbI.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE project_id = ?').get(projectId) as any;
    const timeCost = dbI.prepare(`
      SELECT COALESCE(SUM(te.duration_minutes / 60.0 * COALESCE(e.pay_rate, 0)), 0) as total
      FROM time_entries te LEFT JOIN employees e ON te.employee_id = e.id
      WHERE te.project_id = ?
    `).get(projectId) as any;
    const hours = dbI.prepare('SELECT COALESCE(SUM(duration_minutes), 0) as total FROM time_entries WHERE project_id = ?').get(projectId) as any;
    const project = dbI.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as any;

    const totalRevenue = revenue?.total || 0;
    const totalCosts = (costs?.total || 0) + (timeCost?.total || 0);
    const profit = totalRevenue - totalCosts;
    const margin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0;

    return {
      revenue: totalRevenue,
      direct_costs: costs?.total || 0,
      labor_costs: timeCost?.total || 0,
      total_costs: totalCosts,
      profit,
      margin: Math.round(margin * 10) / 10,
      total_hours: Math.round((hours?.total || 0) / 60 * 10) / 10,
      effective_rate: hours?.total > 0 ? Math.round(totalRevenue / ((hours.total || 1) / 60) * 100) / 100 : 0,
      budget: project?.budget || 0,
      budget_used_pct: project?.budget > 0 ? Math.round(totalCosts / project.budget * 1000) / 10 : 0,
    };
  });

  // ─── Database Backup to VPS ────────────────────────────
  ipcMain.handle('backup:to-vps', async () => {
    try {
      const dbPath = db.getDbPath();
      if (!fs.existsSync(dbPath)) return { error: 'Database file not found' };

      // Checkpoint WAL to ensure all data is in the main file
      try { db.getDb().pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T').join('_');
      const remotePath = `/var/www/accounting.rmpgutah.us/backups/accounting_${timestamp}.db`;
      const latestPath = `/var/www/accounting.rmpgutah.us/backups/accounting_latest.db`;
      const sshKey = path.join(os.homedir(), '.ssh', 'id_ed25519_deploy');
      const vpsHost = '194.113.64.90';
      const vpsUser = 'root';

      const { execFileSync } = require('child_process');

      // Ensure remote backup directory exists
      execFileSync('ssh', ['-i', sshKey, '-o', 'StrictHostKeyChecking=no', `${vpsUser}@${vpsHost}`, 'mkdir -p /var/www/accounting.rmpgutah.us/backups'], { timeout: 10000 });

      // Upload timestamped backup
      execFileSync('scp', ['-i', sshKey, '-o', 'StrictHostKeyChecking=no', dbPath, `${vpsUser}@${vpsHost}:${remotePath}`], { timeout: 30000 });

      // Copy as "latest" for easy restore
      execFileSync('ssh', ['-i', sshKey, '-o', 'StrictHostKeyChecking=no', `${vpsUser}@${vpsHost}`, `cp '${remotePath}' '${latestPath}'`], { timeout: 10000 });

      // Clean old backups (keep last 30)
      execFileSync('ssh', ['-i', sshKey, '-o', 'StrictHostKeyChecking=no', `${vpsUser}@${vpsHost}`, 'cd /var/www/accounting.rmpgutah.us/backups && ls -t accounting_*.db | tail -n +31 | xargs -r rm --'], { timeout: 10000 });

      const stats = fs.statSync(dbPath);
      return { success: true, size: stats.size, timestamp, remotePath };
    } catch (err: any) {
      console.error('VPS backup failed:', err);
      return { error: err?.message || 'Backup failed' };
    }
  });

  // ─── Analytics Dashboard ──────────────────────────────
  ipcMain.handle('analytics:dashboard-data', (_event, { companyId }: { companyId: string }) => {
    try {
      const d = db.getDb();
      const today = new Date();
      const months = Array.from({ length: 12 }, (_, i) => {
        const dt = new Date(today.getFullYear(), today.getMonth() - 11 + i, 1);
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
      });
      const firstMonth = months[0] + '-01';

      const revenueByMonth = d.prepare(`
        SELECT strftime('%Y-%m', issue_date) as month, COALESCE(SUM(total),0) as total
        FROM invoices WHERE company_id = ? AND status IN ('paid','sent','partial')
        AND issue_date >= ? GROUP BY month`).all(companyId, firstMonth);

      const expenseByMonth = d.prepare(`
        SELECT strftime('%Y-%m', date) as month, COALESCE(SUM(amount),0) as total
        FROM expenses WHERE company_id = ? AND date >= ? GROUP BY month`).all(companyId, firstMonth);

      const arAging = d.prepare(`
        SELECT
          SUM(CASE WHEN julianday('now') - julianday(due_date) <= 0 THEN total - amount_paid ELSE 0 END) as current_amt,
          SUM(CASE WHEN julianday('now') - julianday(due_date) BETWEEN 1 AND 30 THEN total - amount_paid ELSE 0 END) as days_1_30,
          SUM(CASE WHEN julianday('now') - julianday(due_date) BETWEEN 31 AND 60 THEN total - amount_paid ELSE 0 END) as days_31_60,
          SUM(CASE WHEN julianday('now') - julianday(due_date) > 60 THEN total - amount_paid ELSE 0 END) as days_60_plus
        FROM invoices WHERE company_id = ? AND status IN ('sent','overdue','partial')`).get(companyId);

      const topClients = d.prepare(`
        SELECT c.name as client_name, COALESCE(SUM(i.total),0) as total_revenue
        FROM invoices i JOIN clients c ON i.client_id = c.id
        WHERE i.company_id = ? AND i.status IN ('paid','sent','partial')
        GROUP BY c.id ORDER BY total_revenue DESC LIMIT 8`).all(companyId);

      const totalInvoiced = d.prepare(`SELECT COALESCE(SUM(total),0) as v FROM invoices WHERE company_id = ? AND status != 'draft'`).get(companyId) as any;
      const totalPaid = d.prepare(`SELECT COALESCE(SUM(total),0) as v FROM invoices WHERE company_id = ? AND status = 'paid'`).get(companyId) as any;
      const totalExpenses = d.prepare(`SELECT COALESCE(SUM(amount),0) as v FROM expenses WHERE company_id = ?`).get(companyId) as any;
      const overdueCount = d.prepare(`SELECT COUNT(*) as v FROM invoices WHERE company_id = ? AND status = 'overdue'`).get(companyId) as any;
      const sentCount = d.prepare(`SELECT COUNT(*) as v FROM invoices WHERE company_id = ? AND status IN ('sent','overdue','partial')`).get(companyId) as any;
      const avgDso = d.prepare(`
        SELECT AVG(julianday(updated_at) - julianday(issue_date)) as v
        FROM invoices WHERE company_id = ? AND status = 'paid' AND updated_at IS NOT NULL`).get(companyId) as any;

      const collectionRate = totalInvoiced.v > 0 ? totalPaid.v / totalInvoiced.v : 1;
      const expenseRatio = totalInvoiced.v > 0 ? totalExpenses.v / totalInvoiced.v : 0;
      const overdueRate = sentCount.v > 0 ? 1 - (overdueCount.v / sentCount.v) : 1;
      const dso = Number(avgDso.v || 0);
      const dsoScore = dso <= 30 ? 20 : dso <= 45 ? 15 : dso <= 60 ? 10 : 5;
      const healthScore = Math.round(
        Math.min(collectionRate, 1) * 30 +
        Math.max(0, Math.min(1 - expenseRatio, 1)) * 25 +
        Math.min(overdueRate, 1) * 25 +
        dsoScore
      );

      return { months, revenueByMonth, expenseByMonth, arAging, topClients, healthScore, dso };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── PTO ─────────────────────────────────────────────
  ipcMain.handle('payroll:pto-policies', (_event, { companyId }: { companyId: string }) => {
    try { return db.queryAll('pto_policies', { company_id: companyId }); }
    catch { return []; }
  });

  ipcMain.handle('payroll:pto-policy-save', (_event, data: Record<string, any>) => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (data.id) return db.update('pto_policies', data.id, data);
      return db.create('pto_policies', { ...data, company_id: companyId });
    } catch (err) { return { error: err instanceof Error ? err.message : String(err) }; }
  });

  ipcMain.handle('payroll:pto-balances', (_event, { companyId }: { companyId: string }) => {
    try {
      return db.getDb().prepare(`
        SELECT pb.*, e.name as employee_name, pp.name as policy_name
        FROM pto_balances pb
        JOIN employees e ON pb.employee_id = e.id
        LEFT JOIN pto_policies pp ON pb.policy_id = pp.id
        WHERE e.company_id = ?
        ORDER BY e.name`).all(companyId);
    } catch { return []; }
  });

  ipcMain.handle('payroll:pto-adjust', (_event, { employeeId, policyId, hours, note }: { employeeId: string; policyId: string; hours: number; note: string }) => {
    try {
      const d = db.getDb();
      const existing = d.prepare('SELECT * FROM pto_balances WHERE employee_id = ? AND policy_id = ?').get(employeeId, policyId) as any;
      if (existing) {
        db.update('pto_balances', existing.id, { balance_hours: Number(existing.balance_hours) + hours });
      } else {
        db.create('pto_balances', { employee_id: employeeId, policy_id: policyId, balance_hours: hours, used_hours_ytd: 0, accrued_hours_ytd: Math.max(0, hours) });
      }
      db.create('pto_transactions', { employee_id: employeeId, policy_id: policyId, type: 'adjustment', hours, note: note || 'Manual adjustment' });
      scheduleAutoBackup();
      return { success: true };
    } catch (err) { return { error: err instanceof Error ? err.message : String(err) }; }
  });

  // ─── State Tax Rate ───────────────────────────────────
  ipcMain.handle('payroll:state-tax-rate', (_event, { state, grossPay, allowances, periodsPerYear }: { state: string; grossPay: number; allowances: number; periodsPerYear: number }) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { stateTaxEngine } = require('../services/StateTaxEngine');
      const withholding = stateTaxEngine.getStateWithholding(state, grossPay, allowances, periodsPerYear);
      const sdi = stateTaxEngine.getSdiWithholding(state, grossPay);
      return { withholding, sdi, total: withholding + sdi };
    } catch (err) {
      return { withholding: grossPay * 0.05, sdi: 0, total: grossPay * 0.05 };
    }
  });

  ipcMain.handle('backup:restore-from-vps', async () => {
    try {
      const dbPath = db.getDbPath();
      const sshKey = path.join(os.homedir(), '.ssh', 'id_ed25519_deploy');
      const vpsHost = '194.113.64.90';
      const vpsUser = 'root';
      const remotePath = `/var/www/accounting.rmpgutah.us/backups/accounting_latest.db`;
      const localBackup = dbPath + '.pre-restore-backup';

      const { execFileSync } = require('child_process');

      // Make local backup first
      if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, localBackup);

      // Download latest from VPS
      execFileSync('scp', ['-i', sshKey, '-o', 'StrictHostKeyChecking=no', `${vpsUser}@${vpsHost}:${remotePath}`, dbPath], { timeout: 30000 });

      return { success: true, message: 'Database restored from VPS. Restart app to apply.' };
    } catch (err: any) {
      console.error('VPS restore failed:', err);
      return { error: err?.message || 'Restore failed' };
    }
  });
}

