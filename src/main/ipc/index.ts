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
import { registerEntityGraphIpc, recordRelationBidirectional } from '../integrations/entity-graph';
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
import { calculateFullPayroll } from '../services/TaxCalculationEngine';
import { bootstrapBuiltinCommands } from '../services/CommandRegistry';
import { eventBus } from '../services/EventBus';
import { workflowEngine } from '../services/WorkflowEngine';
import http from 'http';
import https from 'https';

// ─── Server Sync Config ──────────────────────────────────
const SYNC_SERVER = process.env.SYNC_SERVER_URL || 'https://accounting.rmpgutah.us';

// Debounced auto-backup: waits 30s after last write, then uploads DB to server
// CONCURRENCY: a single global timer is correct here — the SQLite file holds
// ALL companies for the logged-in user, and the backup is keyed on user email.
// Per-company debouncing would unnecessarily upload the same file N times.
let autoBackupTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleAutoBackup() {
  if (autoBackupTimer) clearTimeout(autoBackupTimer);
  autoBackupTimer = setTimeout(async () => {
    try {
      const dbPath = db.getDbPath();
      if (!fs.existsSync(dbPath)) return;
      try { db.getDb().pragma('wal_checkpoint(TRUNCATE)'); } catch (_) {}

      // Perf: async read so other IPC handlers aren't blocked while the DB
      // file is loaded into memory for HMAC + upload (runs every 30s).
      const fileData = await fs.promises.readFile(dbPath);
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
// ─── Account Lookup (multi-strategy) ─────────────────────
// Tries multiple strategies to find an account by name hint:
// 1. Exact name match
// 2. LIKE name match
// 3. Alias mapping (common name → default account names)
// 4. Type + subtype fallback
const ACCOUNT_ALIASES: Record<string, string[]> = {
  'Cash':                  ['Cash', 'Checking Account', 'Bank Account'],
  'Receivable':            ['Accounts Receivable', 'Trade Receivable', 'A/R'],
  'Payable':               ['Accounts Payable', 'Trade Payable', 'A/P'],
  'Wages Expense':         ['Wages & Salaries', 'Payroll Expense', 'Wages Expense', 'Salary Expense', 'Wage Expense'],
  'Wages Payable':         ['Payroll Liabilities', 'Wages Payable', 'Salary Payable', 'Payroll Payable'],
  'Federal Withholding':   ['Federal Tax Payable', 'Federal Withholding', 'Federal Income Tax Payable'],
  'State Withholding':     ['State Tax Payable', 'State Withholding', 'State Income Tax Payable'],
  'Social Security Payable': ['Payroll Liabilities', 'Social Security Payable', 'FICA Payable', 'Payroll Tax Expense — FICA'],
  'Medicare Payable':      ['Payroll Liabilities', 'Medicare Payable', 'FICA Payable', 'Payroll Tax Expense — FICA'],
  'Revenue':               ['Service Revenue', 'Sales Revenue', 'Revenue', 'Consulting Revenue', 'Project Revenue', 'Income'],
  'Expense':               ['Cost of Services', 'Cost of Goods Sold', 'Office Supplies', 'Miscellaneous Expense', 'General Expense', 'Operating Expense'],
  'Advertising':           ['Advertising & Marketing', 'Marketing', 'Advertising'],
  'Bank Fees':             ['Bank Fees & Service Charges', 'Bank Fees', 'Bank Charges', 'Service Charges'],
  'Contractors':           ['Contract Labor', 'Contractors', 'Subcontractors'],
  'Insurance':             ['Insurance — General Liability', 'Insurance', 'Business Insurance'],
  'Office Supplies':       ['Office Supplies', 'Supplies'],
  'Professional Fees':     ['Legal Fees', 'Accounting & Tax Preparation', 'Professional Services — Other', 'Professional Fees', 'Legal & Professional'],
  'Rent':                  ['Rent — Office / Workspace', 'Rent', 'Rent Expense', 'Office Rent'],
  'Software':              ['Software & Subscriptions', 'Software', 'Subscriptions'],
  'Travel':                ['Travel — Airfare', 'Travel — Lodging', 'Travel & Meals', 'Travel', 'Travel Expense'],
  'Utilities':             ['Utilities — Electric', 'Utilities — Telephone / Internet', 'Utilities', 'Utility Expense'],
  'Depreciation':          ['Depreciation Expense', 'Section 179 Expense', 'Amortization Expense'],
  'Meals':                 ['Meals — Business (50% deductible)', 'Meals', 'Business Meals'],
  'Vehicle':               ['Vehicle Expense', 'Auto Expense', 'Mileage'],
  'Repairs':               ['Repairs & Maintenance', 'Repairs', 'Maintenance'],
  'Interest':              ['Interest — Other Business Loans', 'Interest Expense', 'Loan Interest'],
  'Taxes':                 ['Taxes — Business License & Permits', 'Taxes — Property', 'Business Taxes'],
  'Education':             ['Education & Training', 'Training', 'Professional Development'],
  'Dues':                  ['Dues & Memberships', 'Memberships', 'Professional Dues'],
  'Bad Debts':             ['Bad Debts', 'Bad Debt Expense', 'Uncollectible Accounts'],
  'Shipping':              ['Postage & Shipping', 'Shipping', 'Postage', 'Freight'],
  'Processing Fees':       ['Stripe Processing Fees', 'Credit Card Processing Fees', 'Payment Processing'],
};

const ACCOUNT_TYPE_FALLBACK: Record<string, { type: string; subtype?: string }> = {
  'Cash':                  { type: 'asset', subtype: 'current' },
  'Receivable':            { type: 'asset', subtype: 'current' },
  'Payable':               { type: 'liability', subtype: 'current' },
  'Wages Expense':         { type: 'expense', subtype: 'payroll' },
  'Wages Payable':         { type: 'liability', subtype: 'current' },
  'Federal Withholding':   { type: 'liability', subtype: 'current' },
  'State Withholding':     { type: 'liability', subtype: 'current' },
  'Social Security Payable': { type: 'liability', subtype: 'current' },
  'Medicare Payable':      { type: 'liability', subtype: 'current' },
  'Revenue':               { type: 'revenue' },
  'Expense':               { type: 'expense', subtype: 'operating' },
  'Advertising':           { type: 'expense', subtype: 'operating' },
  'Bank Fees':             { type: 'expense', subtype: 'operating' },
  'Contractors':           { type: 'expense', subtype: 'operating' },
  'Insurance':             { type: 'expense', subtype: 'operating' },
  'Office Supplies':       { type: 'expense', subtype: 'operating' },
  'Professional Fees':     { type: 'expense', subtype: 'operating' },
  'Rent':                  { type: 'expense', subtype: 'operating' },
  'Software':              { type: 'expense', subtype: 'operating' },
  'Travel':                { type: 'expense', subtype: 'operating' },
  'Utilities':             { type: 'expense', subtype: 'operating' },
  'Depreciation':          { type: 'expense', subtype: 'operating' },
  'Meals':                 { type: 'expense', subtype: 'operating' },
  'Vehicle':               { type: 'expense', subtype: 'operating' },
  'Repairs':               { type: 'expense', subtype: 'operating' },
  'Interest':              { type: 'expense', subtype: 'operating' },
  'Taxes':                 { type: 'expense', subtype: 'taxes' },
  'Education':             { type: 'expense', subtype: 'operating' },
  'Dues':                  { type: 'expense', subtype: 'operating' },
  'Bad Debts':             { type: 'expense', subtype: 'other' },
  'Shipping':              { type: 'expense', subtype: 'operating' },
  'Processing Fees':       { type: 'expense', subtype: 'operating' },
};

// DATE: today's date as YYYY-MM-DD in the user's local timezone. Use this
// instead of new Date().toISOString().slice(0,10), which UTC-shifts the day
// for any local time outside the [00:00, 24:00 - tzoffset] window. Affects
// JE posting dates, settlement accept dates, and any "now" we persist.
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function findAccount(dbInstance: any, companyId: string, nameHint: string): string | null {
  // Determine expected account type (if known) to prevent cross-type matching
  const expectedType = ACCOUNT_TYPE_FALLBACK[nameHint]?.type;
  const typeFilter = expectedType ? ` AND type = '${expectedType}'` : '';

  // Strategy 1: Exact name match (type-filtered if known)
  let acct = dbInstance.prepare(
    `SELECT id FROM accounts WHERE company_id = ? AND is_active = 1 AND name = ?${typeFilter} LIMIT 1`
  ).get(companyId, nameHint) as any;
  if (acct) return acct.id;

  // Strategy 1b: Exact name match without type filter
  if (typeFilter) {
    acct = dbInstance.prepare(
      `SELECT id FROM accounts WHERE company_id = ? AND is_active = 1 AND name = ? LIMIT 1`
    ).get(companyId, nameHint) as any;
    if (acct) return acct.id;
  }

  // Strategy 2: LIKE match (type-filtered to prevent cross-type matches like "Prepaid Expenses" for expense hint)
  if (typeFilter) {
    acct = dbInstance.prepare(
      `SELECT id FROM accounts WHERE company_id = ? AND is_active = 1 AND name LIKE ?${typeFilter} ORDER BY code LIMIT 1`
    ).get(companyId, `%${nameHint}%`) as any;
    if (acct) return acct.id;
  } else {
    acct = dbInstance.prepare(
      `SELECT id FROM accounts WHERE company_id = ? AND is_active = 1 AND name LIKE ? ORDER BY code LIMIT 1`
    ).get(companyId, `%${nameHint}%`) as any;
    if (acct) return acct.id;
  }

  // Strategy 3: Try known aliases (exact match first, then LIKE)
  const aliases = ACCOUNT_ALIASES[nameHint];
  if (aliases) {
    for (const alias of aliases) {
      acct = dbInstance.prepare(
        `SELECT id FROM accounts WHERE company_id = ? AND is_active = 1 AND name = ? LIMIT 1`
      ).get(companyId, alias) as any;
      if (acct) return acct.id;
    }
    for (const alias of aliases) {
      acct = dbInstance.prepare(
        `SELECT id FROM accounts WHERE company_id = ? AND is_active = 1 AND name LIKE ? ORDER BY code LIMIT 1`
      ).get(companyId, `%${alias}%`) as any;
      if (acct) return acct.id;
    }
  }

  // Strategy 4: Fall back to type + subtype
  const fallback = ACCOUNT_TYPE_FALLBACK[nameHint];
  if (fallback) {
    // Try with subtype first
    if (fallback.subtype) {
      acct = dbInstance.prepare(
        `SELECT id FROM accounts WHERE company_id = ? AND is_active = 1 AND type = ? AND subtype = ? ORDER BY code LIMIT 1`
      ).get(companyId, fallback.type, fallback.subtype) as any;
      if (acct) return acct.id;
    }
    // Then try any account of that type
    acct = dbInstance.prepare(
      `SELECT id FROM accounts WHERE company_id = ? AND is_active = 1 AND type = ? ORDER BY code LIMIT 1`
    ).get(companyId, fallback.type) as any;
    if (acct) return acct.id;
  }

  return null;
}

// Posts a balanced journal entry using multi-strategy account lookup.
// Silently no-ops if any required account is missing — best-effort for
// companies that haven't configured a full chart of accounts.
function postJournalEntry(
  dbInstance: ReturnType<typeof db.getDb>,
  companyId: string,
  date: string,
  description: string,
  lines: Array<{ nameHint: string; debit: number; credit: number; note?: string }>
): void {
  // Skip lines with zero amounts
  const nonZero = lines.filter(l => l.debit > 0 || l.credit > 0);
  if (nonZero.length === 0) return;

  const resolved: Array<{ accountId: string; debit: number; credit: number; note: string }> = [];
  for (const line of nonZero) {
    const accountId = findAccount(dbInstance as any, companyId, line.nameHint);
    if (!accountId) return; // skip whole entry if any account is missing
    resolved.push({ accountId, debit: line.debit, credit: line.credit, note: line.note ?? '' });
  }

  // Find the highest entry number by extracting the numeric suffix.
  // Cannot rely on created_at (same timestamp during bulk operations like gl:rebuild).
  const lastJE = (dbInstance as any).prepare(
    `SELECT entry_number FROM journal_entries WHERE company_id = ?
     ORDER BY CAST(SUBSTR(entry_number, INSTR(entry_number, '-') + 1) AS INTEGER) DESC LIMIT 1`
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

// CONCURRENCY: ipcMain.handle throws if the same channel is registered twice.
// Without this guard, calling registerIpcHandlers a second time (e.g. after a
// restore-from-backup reinit, or if main.ts startup runs twice) would crash
// the whole app the moment any handler-registration line runs. We register
// handlers exactly once for the lifetime of the main process.
let _ipcHandlersRegistered = false;

export function registerIpcHandlers(): void {
  if (_ipcHandlersRegistered) return;
  _ipcHandlersRegistered = true;

  // Advanced System (2026-04-28) — register built-in commands for Cmd+K palette
  // and ensure EventBus singleton is initialized.
  bootstrapBuiltinCommands();
  void eventBus;
  workflowEngine.start();

  // Stripe integration — online-first with local SQLite cache fallback,
  // lives in its own module so the renderer can use Stripe offline.
  registerStripeIpc(ipcMain);

  // Cross-entity integration layer — exposes `entity:graph` and
  // `entity:timeline` so any detail page can render related records +
  // audit/email/document timeline without hand-joining tables.
  registerEntityGraphIpc(ipcMain);

  // ─── Input Validation Helpers ──────────────────────────
  const VALID_TABLES = new Set([
    'invoices', 'invoice_line_items', 'expenses', 'expense_line_items',
    'clients', 'vendors', 'accounts', 'journal_entries', 'journal_entry_lines',
    'projects', 'employees', 'employee_deductions', 'time_entries',
    'categories', 'payments', 'budgets', 'budget_lines',
    'bank_accounts', 'bank_transactions', 'bank_reconciliation_matches',
    'documents', 'recurring_templates', 'tax_categories', 'tax_payments',
    'inventory_items', 'inventory_movements', 'quotes', 'quote_line_items',
    'quote_activity_log', 'quote_templates',
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
    'je_comments',
    // Workflow + numbering + email templates (2026-04-23)
    'custom_statuses', 'status_transitions', 'entity_status_history',
    'number_sequences', 'email_templates', 'email_template_history',
    'email_schedules',
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
    // Advanced debt collection child tables — company_id lives on parent
    'debt_skip_traces',
    // Quote system child tables — company_id lives on parent quotes table
    'quote_activity_log',
    // Invoice activity log — company_id lives on parent invoices table
    'invoice_activity_log',
    // Expense activity log — company_id lives on parent expenses table
    'expense_activity_log',
    // Advanced System (2026-04-28) — user-scoped or company_id absent
    'custom_shortcuts',
    'command_history',
    'workflow_executions',
    'workflow_event_log',
  ]);

  // SECURITY: Tables that hold credentials/secrets must not be writable via the
  // generic CRUD IPC — those mutations have to go through dedicated handlers
  // (auth:register/auth:login etc.) that enforce password hashing, email
  // uniqueness, and audit logging. Without this guard the renderer could
  // INSERT a user with an attacker-controlled password_hash, or UPDATE another
  // user's hash to log in as them.
  const PROTECTED_TABLES = new Set(['users']);
  ipcMain.handle('db:create', (_event, { table, data }) => {
    if (!validateTable(table)) return { error: 'Invalid table' };
    if (PROTECTED_TABLES.has(table)) return { error: `Direct writes to ${table} are not allowed — use dedicated handler` };
    try {
      const companyId = db.getCurrentCompanyId();
      // INTEGRITY: ignore any caller-supplied `id`. The renderer should never
      // pick primary keys — at best it hands us a stale uuid, at worst a
      // collision with an existing row. db.create() generates a uuid when id
      // is absent.
      if (data && typeof data === 'object' && 'id' in data) {
        delete (data as any).id;
      }
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
      // Reactive engine: emit semantic events for known table types so workflows can react.
      try {
        if (companyId && record?.id) {
          const eventTypeMap: Record<string, string> = {
            clients: 'client.created',
            vendors: 'vendor.created',
            time_entries: 'time.entry_created',
            quotes: 'quote.created',
            debts: 'debt.created',
            projects: 'project.created',
            budgets: 'budget.created',
            bills: 'bill.created',
            fixed_assets: 'asset.acquired',
          };
          const evtType = eventTypeMap[table];
          if (evtType) {
            eventBus.emit({
              type: evtType as any,
              companyId,
              entityType: table,
              entityId: record.id as string,
              data: payload as Record<string, any>,
            }).catch(() => {});
          }
        }
      } catch { /* fire-and-forget */ }
      return record;
    } catch (err) {
      console.error(`db:create [${table}] failed:`, err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('db:update', (_event, { table, id, data }) => {
    if (!validateTable(table)) return { error: 'Invalid table' };
    if (PROTECTED_TABLES.has(table)) return { error: `Direct writes to ${table} are not allowed — use dedicated handler` };
    // INTEGRITY: audit_log / debt_audit_log / debt_compliance_log are append-only.
    // Mutating audit rows defeats the purpose of having an audit trail.
    if (table === 'audit_log' || table === 'debt_audit_log' || table === 'debt_compliance_log') {
      return { error: `${table} is append-only` };
    }
    try {
      // INTEGRITY: never let the renderer rewrite `id` or `created_at` on update.
      // Both are sometimes hydrated into form state and would silently mutate
      // primary keys / row provenance if echoed back through the patch payload.
      if (data && typeof data === 'object') {
        delete (data as any).id;
        delete (data as any).created_at;
      }
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

  // FK cleanup map: tables whose deletion requires nulling/deleting related rows
  // because the referencing FKs are NOT ON DELETE CASCADE.
  // Each entry returns SQL statements to run BEFORE the parent delete.
  const cleanupReferencesBeforeDelete = (table: string, id: string): void => {
    const dbI = db.getDb();
    const run = (sql: string) => { try { dbI.prepare(sql).run(id); } catch {} };
    switch (table) {
      case 'invoices':
        // Delete payments (NOT NULL FK — can't null it)
        run(`DELETE FROM payments WHERE invoice_id = ?`);
        // Null FK references (optional FKs)
        run(`UPDATE time_entries SET invoice_id = NULL, is_invoiced = 0 WHERE invoice_id = ?`);
        run(`UPDATE stripe_transactions SET invoice_id = NULL WHERE invoice_id = ?`);
        run(`UPDATE credit_notes SET invoice_id = NULL WHERE invoice_id = ?`);
        run(`UPDATE quotes SET converted_invoice_id = NULL WHERE converted_invoice_id = ?`);
        run(`DELETE FROM invoice_debt_links WHERE invoice_id = ?`);
        run(`DELETE FROM invoice_reminders WHERE invoice_id = ?`);
        run(`DELETE FROM invoice_payment_schedule WHERE invoice_id = ?`);
        // invoice_line_items has ON DELETE CASCADE, no manual cleanup needed
        break;
      case 'clients':
        // Null FKs in many tables that reference clients
        run(`UPDATE invoices SET client_id = NULL WHERE client_id = ?`);
        run(`UPDATE expenses SET client_id = NULL WHERE client_id = ?`);
        run(`UPDATE time_entries SET client_id = NULL WHERE client_id = ?`);
        run(`UPDATE projects SET client_id = NULL WHERE client_id = ?`);
        run(`UPDATE quotes SET client_id = NULL WHERE client_id = ?`);
        run(`UPDATE debts SET client_id = NULL WHERE client_id = ?`);
        run(`DELETE FROM client_contacts WHERE client_id = ?`);
        break;
      case 'vendors':
        run(`UPDATE expenses SET vendor_id = NULL WHERE vendor_id = ?`);
        run(`UPDATE bills SET vendor_id = NULL WHERE vendor_id = ?`);
        run(`UPDATE purchase_orders SET vendor_id = NULL WHERE vendor_id = ?`);
        break;
      case 'projects':
        run(`UPDATE expenses SET project_id = NULL WHERE project_id = ?`);
        run(`UPDATE time_entries SET project_id = NULL WHERE project_id = ?`);
        run(`UPDATE invoice_line_items SET project_id = NULL WHERE project_id = ?`);
        break;
      case 'employees':
        run(`UPDATE time_entries SET employee_id = NULL WHERE employee_id = ?`);
        run(`DELETE FROM employee_deductions WHERE employee_id = ?`);
        // pay_stubs has FK without cascade — but deleting an employee with
        // pay history would be destructive. Block with clear error if any.
        try {
          const stubs = dbI.prepare(`SELECT COUNT(*) as c FROM pay_stubs WHERE employee_id = ?`).get(id) as any;
          if (stubs?.c > 0) {
            throw new Error(`Cannot delete employee with ${stubs.c} pay stub(s). Mark inactive instead.`);
          }
        } catch (e: any) { if (e.message?.includes('Cannot delete')) throw e; }
        break;
      case 'bills':
        run(`DELETE FROM bill_payments WHERE bill_id = ?`);
        run(`DELETE FROM bill_line_items WHERE bill_id = ?`);
        break;
      case 'purchase_orders':
        run(`DELETE FROM po_line_items WHERE po_id = ?`);
        run(`UPDATE bills SET purchase_order_id = NULL WHERE purchase_order_id = ?`);
        break;
      case 'fixed_assets':
        run(`DELETE FROM asset_depreciation_entries WHERE asset_id = ?`);
        break;
      case 'budgets':
        run(`DELETE FROM budget_lines WHERE budget_id = ?`);
        break;
      case 'quotes':
        run(`DELETE FROM quote_line_items WHERE quote_id = ?`);
        break;
      case 'debts':
        // Most debt child tables have ON DELETE CASCADE in schema
        // but invoice_debt_links does not
        run(`DELETE FROM invoice_debt_links WHERE debt_id = ?`);
        break;
      case 'payroll_runs':
        run(`DELETE FROM pay_stubs WHERE payroll_run_id = ?`);
        break;
      case 'inventory_items':
        run(`DELETE FROM inventory_movements WHERE item_id = ?`);
        break;
      case 'accounts':
        // Accounts can't be deleted if they have journal entries — block
        try {
          const lines = dbI.prepare(`SELECT COUNT(*) as c FROM journal_entry_lines WHERE account_id = ?`).get(id) as any;
          if (lines?.c > 0) {
            throw new Error(`Cannot delete account with ${lines.c} journal entry line(s). Use soft delete (mark inactive) instead.`);
          }
        } catch (e: any) { if (e.message?.includes('Cannot delete')) throw e; }
        break;
    }
  };

  ipcMain.handle('db:delete', (_event, { table, id }) => {
    if (!validateTable(table)) return { error: 'Invalid table' };
    if (PROTECTED_TABLES.has(table)) return { error: `Direct deletes from ${table} are not allowed — use dedicated handler` };
    // SECURITY: audit_log must be append-only. Without this guard the renderer
    // can wipe its own breadcrumb trail (delete-me-then-delete-evidence).
    if (table === 'audit_log' || table === 'debt_audit_log' || table === 'debt_compliance_log') {
      return { error: `${table} is append-only` };
    }
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
      // P1.13: skip FK cleanup for soft-deletable tables — the row
      // stays physically present so FK references remain valid.
      // Cleanup only happens when the auto-purge cron physically
      // removes the row 30 days later (via removeHard), at which
      // point the same logic runs.
      if (!db.SOFT_DELETE_TABLES.has(table)) {
        cleanupReferencesBeforeDelete(table, id);
      }
      db.remove(table, id);
      syncPush({ table, operation: 'delete', id, data: { id }, companyId: companyId ?? '', timestamp: Date.now() }).catch(() => {});
      scheduleAutoBackup();
    } catch (err) {
      console.error(`db:delete [${table}:${id}] failed:`, err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── P1.13: Trash (soft-delete recovery) ──────────────
  // Read-side counterpart to db.remove() now that supported tables
  // soft-delete. The Trash UI calls these to list / restore / purge
  // records the user has deleted within the 30-day retention window.

  ipcMain.handle('trash:list', () => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return { items: {} };
      const items = db.listTrash(companyId, 100);
      return { items };
    } catch (err: any) {
      return { error: err?.message || 'Failed to list trash' };
    }
  });

  ipcMain.handle('trash:restore', (_event, { table, id }: { table: string; id: string }) => {
    try {
      if (!db.SOFT_DELETE_TABLES.has(table)) return { error: `Table ${table} does not support restore` };
      const ok = db.restoreFromTrash(table, id);
      if (!ok) return { error: 'Record not in trash or already restored' };
      const companyId = db.getCurrentCompanyId();
      if (companyId) db.logAudit(companyId, table, id, 'trash_restore');
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message || 'Restore failed' };
    }
  });

  ipcMain.handle('trash:purge', (_event, { table, id }: { table: string; id: string }) => {
    try {
      if (!db.SOFT_DELETE_TABLES.has(table)) return { error: `Table ${table} does not support purge` };
      // Run FK cleanup now since this is a true physical delete.
      try { cleanupReferencesBeforeDelete(table, id); } catch (_) { /* best-effort */ }
      db.removeHard(table, id);
      const companyId = db.getCurrentCompanyId();
      if (companyId) db.logAudit(companyId, table, id, 'trash_purge');
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message || 'Purge failed' };
    }
  });

  ipcMain.handle('trash:empty', () => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return { ok: false, error: 'No active company' };
      // Empty Trash purges ALL soft-deleted records for the company,
      // regardless of age. (Auto-purge cron handles age-based culling.)
      let purged = 0;
      for (const table of db.SOFT_DELETE_TABLES) {
        const rows = db.getDb().prepare(
          `SELECT id FROM ${table} WHERE company_id = ? AND deleted_at IS NOT NULL`
        ).all(companyId) as Array<{ id: string }>;
        for (const r of rows) {
          try { cleanupReferencesBeforeDelete(table, r.id); } catch (_) {}
          db.removeHard(table, r.id);
          purged++;
        }
      }
      if (companyId) db.logAudit(companyId, 'trash', 'empty', 'trash_empty', { purged });
      scheduleAutoBackup();
      return { ok: true, purged };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Empty trash failed' };
    }
  });

  // ─── Orphan Detection ─────────────────────────────
  // INTEGRITY: scans for rows whose parent has been deleted out from under
  // them. SQLite's FK enforcement only catches new violations going forward;
  // historical data (pre-PRAGMA, manual deletes via raw SQL, etc.) can still
  // leave orphans. Reports counts only — does not auto-clean.
  ipcMain.handle('data:check-orphans', () => {
    try {
      const dbi = db.getDb();
      const checks: Array<{ kind: string; sql: string }> = [
        { kind: 'invoice_line_items_no_invoice',
          sql: `SELECT COUNT(*) AS c FROM invoice_line_items li
                 LEFT JOIN invoices i ON i.id = li.invoice_id
                 WHERE i.id IS NULL` },
        { kind: 'journal_entry_lines_no_account',
          sql: `SELECT COUNT(*) AS c FROM journal_entry_lines jel
                 LEFT JOIN accounts a ON a.id = jel.account_id
                 WHERE a.id IS NULL` },
        { kind: 'journal_entry_lines_no_entry',
          sql: `SELECT COUNT(*) AS c FROM journal_entry_lines jel
                 LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
                 WHERE je.id IS NULL` },
        { kind: 'payments_no_invoice',
          sql: `SELECT COUNT(*) AS c FROM payments p
                 LEFT JOIN invoices i ON i.id = p.invoice_id
                 WHERE i.id IS NULL` },
        { kind: 'expense_line_items_no_expense',
          sql: `SELECT COUNT(*) AS c FROM expense_line_items eli
                 LEFT JOIN expenses e ON e.id = eli.expense_id
                 WHERE e.id IS NULL` },
        { kind: 'debt_payments_no_debt',
          sql: `SELECT COUNT(*) AS c FROM debt_payments dp
                 LEFT JOIN debts d ON d.id = dp.debt_id
                 WHERE d.id IS NULL` },
        { kind: 'debt_communications_no_debt',
          sql: `SELECT COUNT(*) AS c FROM debt_communications dc
                 LEFT JOIN debts d ON d.id = dc.debt_id
                 WHERE d.id IS NULL` },
        { kind: 'bill_line_items_no_bill',
          sql: `SELECT COUNT(*) AS c FROM bill_line_items bli
                 LEFT JOIN bills b ON b.id = bli.bill_id
                 WHERE b.id IS NULL` },
        { kind: 'bill_payments_no_bill',
          sql: `SELECT COUNT(*) AS c FROM bill_payments bp
                 LEFT JOIN bills b ON b.id = bp.bill_id
                 WHERE b.id IS NULL` },
      ];
      const results: Record<string, number> = {};
      let total = 0;
      for (const chk of checks) {
        try {
          const row = dbi.prepare(chk.sql).get() as any;
          const n = Number(row?.c || 0);
          results[chk.kind] = n;
          total += n;
        } catch (_err) {
          // Table may not exist on older DBs — record -1 so caller can distinguish from 0.
          results[chk.kind] = -1;
        }
      }
      return { total, counts: results };
    } catch (err: any) {
      return { error: err?.message, total: 0, counts: {} };
    }
  });

  // ─── P1.15/P1.16/P1.17: Integrity check + cleanup ─────
  // These complement data:check-orphans with broader checks
  // (PRAGMA integrity_check, schema-drift validator, generic
  // FK-list orphan scanner). One-click cleanup endpoint NULLs
  // out the FK column on orphaned rows — irreversible, so the
  // UI confirms before invoking.
  ipcMain.handle('integrity:check', (_event, opts?: { skipOrphanScan?: boolean }) => {
    try {
      const { runIntegrityCheck } = require('../crons/integrity-check');
      return runIntegrityCheck(opts);
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  ipcMain.handle('integrity:cleanup-orphans', (_event, { target }: { target: string }) => {
    try {
      const { cleanupOrphans } = require('../crons/integrity-check');
      const r = cleanupOrphans(target);
      const cid = db.getCurrentCompanyId();
      if (cid) db.logAudit(cid, 'integrity', target, 'cleanup_orphans', { cleaned: r.cleaned });
      return r;
    } catch (err: any) {
      return { cleaned: 0, error: err?.message };
    }
  });
  // ─── A7: Line-item snippets (reusable templates) ──────
  ipcMain.handle('snippets:list', (_event, opts?: { category?: string }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return [];
      const sql = "SELECT * FROM line_item_snippets WHERE company_id = ? " +
                  (opts?.category ? "AND category = ? " : "") +
                  "ORDER BY use_count DESC, name ASC LIMIT 200";
      const params: any[] = [cid];
      if (opts?.category) params.push(opts.category);
      return db.getDb().prepare(sql).all(...params);
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  ipcMain.handle('snippets:save', (_event, payload: any) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No active company' };
      if (!payload?.name?.trim()) return { error: 'Name required' };
      const data = { ...payload, company_id: cid };
      if (payload.id) {
        db.update('line_item_snippets', payload.id, data);
        return db.getById('line_item_snippets', payload.id);
      }
      return db.create('line_item_snippets', data);
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('snippets:delete', (_event, { id }: { id: string }) => {
    try {
      db.removeHard('line_item_snippets', id);
      return { ok: true };
    } catch (err: any) { return { error: err?.message }; }
  });
  // Increments use_count + sets last_used_at when a snippet is
  // dropped onto a form. Called by the renderer's snippet picker.
  ipcMain.handle('snippets:track-use', (_event, { id }: { id: string }) => {
    try {
      db.getDb().prepare(
        "UPDATE line_item_snippets SET use_count = use_count + 1, last_used_at = datetime('now') WHERE id = ?"
      ).run(id);
      return { ok: true };
    } catch (err: any) { return { error: err?.message }; }
  });

  // ─── B5: PDF/image receipt OCR + parsing ───────────────
  // Two flows:
  //   1. ocr:scan-receipt-file  — caller already has a path
  //   2. ocr:scan-receipt-pick  — opens a file dialog first
  // tesseract.js workers are ~50MB resident — lazy-loaded on first
  // call; shutdown on app quit (see main.ts).
  ipcMain.handle('ocr:scan-receipt-file', async (_event, { filePath }: { filePath: string }) => {
    try {
      const { scanReceipt } = require('../services/receipt-ocr');
      const parsed = await scanReceipt(filePath);
      return { ok: true, parsed };
    } catch (err: any) {
      console.error('[ocr] scan failed:', err);
      return { ok: false, error: err?.message || 'OCR failed' };
    }
  });
  ipcMain.handle('ocr:scan-receipt-pick', async () => {
    try {
      const { filePaths, canceled } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'Receipts', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (canceled || !filePaths?.[0]) return { cancelled: true };
      const { scanReceipt } = require('../services/receipt-ocr');
      const parsed = await scanReceipt(filePaths[0]);
      return { ok: true, parsed, filePath: filePaths[0] };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'OCR failed' };
    }
  });

  // ─── B3: Auto-categorization for new expenses ─────────
  ipcMain.handle('expense:suggest-category', (_event, opts: any) => {
    try {
      const { suggestCategory } = require('../services/auto-categorize');
      const cid = db.getCurrentCompanyId();
      if (!cid) return { category_id: null, confidence: 0, source: 'none' };
      return suggestCategory({ ...opts, company_id: cid });
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // ─── B11: Smart payment matching for bank import lines ─
  ipcMain.handle('payment:suggest-matches', (_event, opts: { amount: number; date: string; description: string }) => {
    try {
      const { suggestMatches } = require('../services/payment-matcher');
      const cid = db.getCurrentCompanyId();
      if (!cid) return [];
      return suggestMatches({ ...opts, company_id: cid });
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // ─── P4.49: Mileage log ────────────────────────────────
  // Auto-fills rate_per_mile from the mileage_rates table based on
  // the trip's tax year, then computes deduction_amount = miles * rate.
  // Allows manual override of rate by passing rate_per_mile explicitly.
  ipcMain.handle('mileage:list', (_event, opts?: { year?: number; limit?: number }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return [];
      const y = opts?.year;
      const lim = opts?.limit ?? 500;
      const sql = "SELECT * FROM mileage_log WHERE company_id = ? " +
                  (y ? "AND substr(trip_date, 1, 4) = ? " : "") +
                  "ORDER BY trip_date DESC LIMIT ?";
      const params = y ? [cid, String(y), lim] : [cid, lim];
      return db.getDb().prepare(sql).all(...params);
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  ipcMain.handle('mileage:save', (_event, payload: any) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No active company' };
      const tripYear = parseInt((payload.trip_date || '').slice(0, 4), 10);
      // Auto-fill rate if not provided.
      let rate = Number(payload.rate_per_mile ?? 0);
      if (!rate && tripYear) {
        const row = db.getDb().prepare("SELECT business_rate FROM mileage_rates WHERE year = ?").get(tripYear) as any;
        if (row?.business_rate) rate = Number(row.business_rate);
      }
      const miles = Number(payload.miles ?? 0);
      const deduction = Math.round(miles * rate * 100) / 100;
      const data = {
        ...payload,
        company_id: cid,
        rate_per_mile: rate,
        deduction_amount: deduction,
      };
      if (payload.id) {
        db.update('mileage_log', payload.id, data);
        return db.getById('mileage_log', payload.id);
      }
      return db.create('mileage_log', data);
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  ipcMain.handle('mileage:delete', (_event, { id }: { id: string }) => {
    try {
      db.removeHard('mileage_log', id);
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  ipcMain.handle('mileage:summary', (_event, { year }: { year: number }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { totalMiles: 0, totalDeduction: 0, count: 0 };
      const row = db.getDb().prepare(
        "SELECT COUNT(*) as count, COALESCE(SUM(miles), 0) as totalMiles, COALESCE(SUM(deduction_amount), 0) as totalDeduction " +
        "FROM mileage_log WHERE company_id = ? AND substr(trip_date, 1, 4) = ?"
      ).get(cid, String(year)) as any;
      return row || { totalMiles: 0, totalDeduction: 0, count: 0 };
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  ipcMain.handle('mileage:current-rate', (_event, { year }: { year?: number }) => {
    try {
      const y = year || new Date().getFullYear();
      const row = db.getDb().prepare("SELECT business_rate, medical_rate, charitable_rate FROM mileage_rates WHERE year = ?").get(y) as any;
      return row || { business_rate: 0.70 }; // fallback to current default
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // ─── P6.69: iCal export ────────────────────────────────
  ipcMain.handle('cal:export-invoices-ics', () => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No active company' };
      const { exportInvoiceDueDates } = require('../services/ical-export');
      return { ics: exportInvoiceDueDates(cid) };
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  ipcMain.handle('cal:export-payroll-ics', () => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No active company' };
      const { exportPayrollSchedule } = require('../services/ical-export');
      return { ics: exportPayrollSchedule(cid) };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // ─── P6.70: Webhook subscriptions CRUD ─────────────────
  ipcMain.handle('webhooks:list', () => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return [];
      return db.getDb().prepare(
        "SELECT id, event_type, target_url, enabled, last_fired_at, last_status, description FROM webhook_subscriptions WHERE company_id = ? ORDER BY created_at DESC"
      ).all(cid);
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  ipcMain.handle('webhooks:save', (_event, payload: { id?: string; event_type: string; target_url: string; secret?: string; enabled?: number; description?: string }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No active company' };
      if (!payload.event_type || !payload.target_url) return { error: 'event_type and target_url required' };
      // Reject non-https URLs except localhost.
      try {
        const u = new URL(payload.target_url);
        if (u.protocol !== 'https:' && !(u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))) {
          return { error: 'Webhook target must be HTTPS (or http://localhost for testing)' };
        }
      } catch {
        return { error: 'Invalid target_url' };
      }
      if (payload.id) {
        db.update('webhook_subscriptions', payload.id, {
          event_type: payload.event_type,
          target_url: payload.target_url,
          secret: payload.secret ?? '',
          enabled: payload.enabled ?? 1,
          description: payload.description ?? '',
        });
        return { ok: true, id: payload.id };
      }
      const r = db.create('webhook_subscriptions', { ...payload, company_id: cid });
      return { ok: true, id: r.id };
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  ipcMain.handle('webhooks:delete', (_event, { id }: { id: string }) => {
    try {
      db.removeHard('webhook_subscriptions', id);
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('integrity:vacuum', () => {
    try {
      const { runVacuum } = require('../crons/integrity-check');
      const r = runVacuum();
      const cid = db.getCurrentCompanyId();
      if (cid) db.logAudit(cid, 'integrity', 'vacuum', 'vacuum', { sizeBefore: r.sizeBefore, sizeAfter: r.sizeAfter });
      return r;
    } catch (err: any) {
      return { ok: false, error: err?.message };
    }
  });

  // ─── Raw Query (for reports/aggregations) ────────────
  // SECURITY: The renderer can supply arbitrary SQL via this handler — historically a
  // privilege-escalation vector (renderer could DROP TABLE, ATTACH another DB, exfiltrate
  // password_hash via SELECT *, etc.). We don't have a small enough set of named queries to
  // switch to a strict allowlist without rewriting most reports/dashboards, so we apply a
  // SQL-shape filter:
  //   • Reject multi-statement SQL (any `;` outside string literals) — blocks stacked queries.
  //   • Reject DDL & sensitive verbs (DROP, ALTER, CREATE, ATTACH, DETACH, PRAGMA, VACUUM, REINDEX).
  //   • Allow only SELECT/WITH/INSERT/UPDATE/DELETE/REPLACE as the leading verb.
  // Any further tightening (e.g. table allowlist for writes) lives in the per-table CRUD handlers.
  function isRawQueryAllowed(sql: string): { ok: boolean; reason?: string } {
    if (typeof sql !== 'string' || !sql.trim()) return { ok: false, reason: 'Empty SQL' };
    // Strip string/identifier literals and comments before scanning for ';' — inline literals
    // can legitimately contain semicolons; we only want to block stacked statements.
    let stripped = sql
      .replace(/--[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/'(?:''|[^'])*'/g, "''")
      .replace(/"(?:""|[^"])*"/g, '""');
    // Allow a single trailing semicolon
    stripped = stripped.replace(/;\s*$/, '');
    if (stripped.includes(';')) return { ok: false, reason: 'Multi-statement SQL not allowed' };
    const head = stripped.trim().toUpperCase();
    const FORBIDDEN = /\b(DROP|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|TRUNCATE)\b/;
    if (FORBIDDEN.test(head)) return { ok: false, reason: 'Forbidden SQL verb' };
    const ALLOWED_LEAD = /^(SELECT|WITH|INSERT|UPDATE|DELETE|REPLACE)\b/;
    if (!ALLOWED_LEAD.test(head)) return { ok: false, reason: 'Only SELECT/WITH/INSERT/UPDATE/DELETE/REPLACE allowed' };
    // SECURITY: Block writes to credential tables and *modifications* to
    // audit tables via raw SQL. INSERT/DELETE on audit_log remain permitted
    // so legitimate flows (logging new events, full company wipe) work, but
    // UPDATE/REPLACE would let the renderer alter audit history in place.
    if (/^(UPDATE|REPLACE)\b/.test(head) && /\b(users|audit_log|debt_audit_log|debt_compliance_log)\b/.test(head)) {
      return { ok: false, reason: 'UPDATE/REPLACE on credential/audit tables not allowed via raw SQL' };
    }
    if (/^(INSERT|DELETE)\b/.test(head) && /\busers\b/.test(head)) {
      return { ok: false, reason: 'INSERT/DELETE on users not allowed via raw SQL — use auth handlers' };
    }
    return { ok: true };
  }
  ipcMain.handle('db:raw-query', (_event, { sql, params }) => {
    const check = isRawQueryAllowed(sql);
    if (!check.ok) {
      console.warn('db:raw-query rejected:', check.reason, sql?.slice(0, 200));
      return { error: `SQL rejected: ${check.reason}` };
    }
    return db.runQuery(sql, params);
  });

  // ─── P1.12: Duplicate-Invoice Detector ────────────────────
  // Returns suspiciously similar invoices for the same client created
  // in the recent past. Caller (InvoiceForm) decides whether to
  // surface a confirm modal — this handler is purely a query.
  //
  // Match criteria (all required):
  //   • same client_id
  //   • total within ±$0.01 of the candidate
  //   • due_date within ±3 days (or both null)
  //   • created within last 60 days (avoids matching last year's same-amount invoices)
  //   • exclude the candidate itself when editing
  //
  // Returns up to 3 matches sorted by created_at DESC. Empty array
  // means no duplicates → caller saves without prompting.
  ipcMain.handle('invoice:check-duplicates', (_event, payload: {
    client_id: string;
    total: number;
    due_date: string | null;
    excludeId?: string | null;
  }) => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return { duplicates: [] };
      if (!payload.client_id || !Number.isFinite(payload.total)) return { duplicates: [] };

      const dbInstance = db.getDb();
      // Date window: ±3 days. If candidate has no due_date, only match
      // against other invoices that also have no due_date.
      let dueWhereClause = 'AND due_date IS NULL';
      const params: any[] = [companyId, payload.client_id];
      if (payload.due_date) {
        // Anchor at noon LOCAL to dodge timezone day-shifts.
        const dueTs = new Date(`${payload.due_date}T12:00:00`).getTime();
        const lo = new Date(dueTs - 3 * 86_400_000);
        const hi = new Date(dueTs + 3 * 86_400_000);
        const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        dueWhereClause = 'AND due_date BETWEEN ? AND ?';
        params.push(fmt(lo), fmt(hi));
      }
      // 60-day creation window: matches typical recurring/monthly cadence
      // without flagging last year's same-amount invoice.
      params.push(payload.total - 0.01, payload.total + 0.01);
      if (payload.excludeId) params.push(payload.excludeId);

      const sql = `
        SELECT id, invoice_number, total, due_date, status, created_at
        FROM invoices
        WHERE company_id = ?
          AND client_id = ?
          ${dueWhereClause}
          AND total BETWEEN ? AND ?
          AND created_at >= datetime('now', '-60 days')
          ${payload.excludeId ? 'AND id != ?' : ''}
        ORDER BY created_at DESC
        LIMIT 3
      `;
      const rows = dbInstance.prepare(sql).all(...params) as any[];
      return { duplicates: rows };
    } catch (err: any) {
      // Defensive: never block save on a duplicate-check failure.
      // Return empty list and log so the caller proceeds normally.
      console.warn('[invoice:check-duplicates] failed:', err?.message);
      return { duplicates: [] };
    }
  });

  // ─── Atomic invoice save (header + line items in one transaction) ─────────
  // Prevents orphaned invoice headers when a line item insert fails.
  ipcMain.handle('invoice:save', async (_event, { invoiceId, invoiceData, lineItems, isEdit }: {
    invoiceId: string | null;
    invoiceData: Record<string, any>;
    lineItems: Array<Record<string, any>>;
    isEdit: boolean;
  }) => {
    const _invoiceNumberForError = invoiceData?.invoice_number;
    try {
      const companyId = db.getCurrentCompanyId();
      const rawDb = db.getDb();

      // P1.14: capture pre-update snapshot for field-level diff in
      // audit log. Only matters on edit (creates have no prior state).
      const oldInvoice: any = (isEdit && invoiceId) ? db.getById('invoices', invoiceId) : null;

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

        // Post the auto-JE inside the same transaction so a JE failure rolls
        // back the invoice — otherwise a partial-failure leaves an invoice with
        // no matching ledger entry and you can't re-run because the invoice
        // already exists.
        if (!isEdit && companyId) {
          const total = Number(invoiceData.total || invoiceData.subtotal) || 0;
          if (total > 0) {
            const invoiceNum = invoiceData.invoice_number || savedId.substring(0, 8);
            // CALC: FX — multi-currency invoice JE must be posted in the
            // company's reporting currency (USD). When invoice.currency !=
            // USD, multiply by exchange_rate (units of USD per 1 unit of
            // invoice currency). Default = 1.0 for USD-denominated invoices.
            const invCurrency = String(invoiceData.currency || 'USD').toUpperCase();
            const fxRate = Number(invoiceData.exchange_rate);
            const usdRate = invCurrency === 'USD'
              ? 1
              : (Number.isFinite(fxRate) && fxRate > 0 ? fxRate : 1);
            const totalUsd = Math.round(total * usdRate * 100) / 100;
            const fxNote = invCurrency === 'USD'
              ? ''
              : ` (orig ${total} ${invCurrency} @ ${usdRate})`;
            postJournalEntry(rawDb, companyId, invoiceData.issue_date || localToday(),
              `Invoice created - #${invoiceNum}`, [
                { nameHint: 'Receivable', debit: totalUsd, credit: 0, note: `AR for Invoice #${invoiceNum}${fxNote}` },
                { nameHint: 'Revenue', debit: 0, credit: totalUsd, note: `Revenue from Invoice #${invoiceNum}${fxNote}` },
              ]);
          }
        }

        return savedId;
      });

      const savedId = saveFn();
      // P1.14: emit field-level diff to audit_log on edit. Same shape
      // as the generic db:update handler so the entity-timeline summary
      // renders both kinds uniformly. Tracked fields are restricted to
      // those the form actually sends (invoiceData keys), so we don't
      // accidentally surface auto-managed columns like updated_at.
      if (companyId) {
        if (isEdit && oldInvoice) {
          const newInvoice = db.getById('invoices', savedId) as any;
          const changes: Record<string, { old: any; new: any }> = {};
          for (const key of Object.keys(invoiceData)) {
            if (oldInvoice[key] !== newInvoice?.[key]) {
              changes[key] = { old: oldInvoice[key], new: newInvoice?.[key] };
            }
          }
          db.logAudit(companyId, 'invoices', savedId, 'update', changes);
        } else {
          db.logAudit(companyId, 'invoices', savedId, 'create');
        }
      }

      // Record ad-hoc entity relations (advisory — never blocks the save).
      try {
        if (companyId) {
          // (invoice ↔ client) — bidirectional, relation: 'billed_to'
          if (invoiceData?.client_id) {
            recordRelationBidirectional(
              companyId, 'invoice', savedId, 'client', String(invoiceData.client_id),
              'billed_to',
              { created_via: invoiceData.created_via_recurring ? 'recurring' : 'manual' },
            );
          }
          // (invoice ↔ time_entry) for each id in any line item's time_entry_ids CSV.
          for (const li of lineItems || []) {
            const csv: string = (li?.time_entry_ids ?? '') as string;
            if (!csv) continue;
            for (const teId of String(csv).split(',').map((s: string) => s.trim()).filter(Boolean)) {
              recordRelationBidirectional(
                companyId, 'invoice', savedId, 'time_entry', teId, 'billed',
              );
            }
          }
        }
      } catch (err) {
        console.warn('invoice:save recordRelation failed:', (err as Error)?.message);
      }

      scheduleAutoBackup();

      // Reactive engine: emit invoice lifecycle events to drive workflows.
      try {
        if (companyId && savedId) {
          await eventBus.emit({
            type: isEdit ? 'invoice.updated' : 'invoice.created',
            companyId,
            entityType: 'invoice',
            entityId: savedId,
            data: {
              total: invoiceData?.total,
              client_id: invoiceData?.client_id,
              status: invoiceData?.status,
            },
          }).catch(() => {});
        }
      } catch { /* fire-and-forget */ }

      return { id: savedId };
    } catch (err) {
      console.error('invoice:save failed:', err);
      // INTEGRITY: translate the raw SQLite UNIQUE-constraint message into a
      // human-readable error citing the offending invoice number, so the user
      // sees "Invoice number INV-0042 already exists" instead of
      // "UNIQUE constraint failed: invoices.company_id, invoices.invoice_number".
      const msg = err instanceof Error ? err.message : String(err);
      if (/UNIQUE constraint failed:.*invoices\.invoice_number/i.test(msg)) {
        return { error: `Invoice number${_invoiceNumberForError ? ` ${_invoiceNumberForError}` : ''} already exists in this company. Pick a different number.` };
      }
      return { error: msg };
    }
  });

  // ─── Atomic expense save (header + line items in one transaction) ─────────
  ipcMain.handle('expense:save', async (_event, { expenseId, expenseData, lineItems, isEdit }: {
    expenseId: string | null;
    expenseData: Record<string, any>;
    lineItems: Array<Record<string, any>>;
    isEdit: boolean;
  }) => {
    // Negative quantities and unit prices are valid (credits, refunds, returns, adjustments).
    // No clamping here — the business logic upstream decides sign conventions.
    try {
      const companyId = db.getCurrentCompanyId();
      const rawDb = db.getDb();

      // P1.14: pre-update snapshot for field-level diff audit
      const oldExpense: any = (isEdit && expenseId) ? db.getById('expenses', expenseId) : null;

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

        // Auto-post JE for new expenses inside the same transaction so a
        // JE failure rolls back the expense — otherwise a partial-failure
        // leaves an expense with no matching ledger entry.
        if (!isEdit && companyId) {
          const amount = Number(expenseData.amount) || 0;
          if (amount > 0) {
            const desc = expenseData.description || 'Expense';
            const isPaid = expenseData.status === 'paid';
            let expenseHint = 'Expense';
            if (expenseData.category_id) {
              try {
                const cat = rawDb.prepare('SELECT name FROM categories WHERE id = ?').get(expenseData.category_id) as any;
                if (cat?.name) expenseHint = cat.name;
              } catch { /* ignore */ }
            }
            postJournalEntry(rawDb, companyId, expenseData.date || localToday(),
              `Expense recorded - ${desc}`, [
                { nameHint: expenseHint, debit: amount, credit: 0, note: desc },
                { nameHint: isPaid ? 'Cash' : 'Payable', debit: 0, credit: amount, note: `${isPaid ? 'Cash paid' : 'AP'} for ${desc}` },
              ]);
          }
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
      // P1.14: emit field-level diff to audit_log on edit
      if (companyId) {
        if (isEdit && oldExpense) {
          const newExpense = db.getById('expenses', savedId) as any;
          const changes: Record<string, { old: any; new: any }> = {};
          for (const key of Object.keys(expenseData)) {
            if (oldExpense[key] !== newExpense?.[key]) {
              changes[key] = { old: oldExpense[key], new: newExpense?.[key] };
            }
          }
          db.logAudit(companyId, 'expenses', savedId, 'update', changes);
        } else {
          db.logAudit(companyId, 'expenses', savedId, 'create');
        }
      }

      scheduleAutoBackup();

      // Reactive engine: emit expense lifecycle events to drive workflows.
      try {
        if (companyId && savedId) {
          await eventBus.emit({
            type: isEdit ? 'expense.updated' : 'expense.created',
            companyId,
            entityType: 'expense',
            entityId: savedId,
            data: {
              amount: expenseData?.amount,
              vendor_id: expenseData?.vendor_id,
              category_id: expenseData?.category_id,
              status: expenseData?.status,
            },
          }).catch(() => {});
        }
      } catch { /* fire-and-forget */ }

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
    scheduleAutoBackup();
    return company;
  });

  ipcMain.handle('company:update', (_event, { id, data }) => {
    const result = db.update('companies', id, data);
    scheduleAutoBackup();
    return result;
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

  // Perf: bulk mark-all-read replaces an N+1 loop in renderer (notifications/index.tsx)
  ipcMain.handle('notification:mark-all-read', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return 0;
    const dbInstance = db.getDb();
    const result = dbInstance.prepare(
      'UPDATE notifications SET is_read = 1 WHERE company_id = ? AND is_read = 0'
    ).run(companyId);
    return result.changes;
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

  // ─── PDF Metadata Builder (P1.6) ─────────────────────────
  // Builds a PDFMetadata object that pdf-lib will write into the PDF
  // Info dictionary. Pop into Finder "Get Info" or Adobe File →
  // Properties to verify. Spotlight uses these fields for indexing.
  function buildInvoiceMetadata(invoice: any, company: any, client: any): import('../services/print-preview').PDFMetadata {
    const num = invoice?.invoice_number || invoice?.id || '';
    const cur = (invoice?.currency || 'USD').toUpperCase();
    const total = Number(invoice?.total ?? invoice?.total_amount ?? 0);
    const totalStr = (() => {
      try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(total); }
      catch { return `${cur} ${total.toFixed(2)}`; }
    })();
    const due = invoice?.due_date || '';
    const isCredit = invoice?.invoice_type === 'credit_note';
    const isQuote = invoice?.invoice_type === 'quote';
    const docType = isCredit ? 'Credit Note' : isQuote ? 'Quote' : 'Invoice';
    return {
      title: `${docType} ${num}${client?.name ? ' — ' + client.name : ''}`,
      author: company?.name || 'Business Accounting Pro',
      subject: `${docType} #${num} for ${totalStr}${due ? ' — Due ' + due : ''}`,
      keywords: [
        docType.toLowerCase(),
        String(num),
        client?.name || '',
        cur,
        invoice?.status || '',
        invoice?.po_number ? `po-${invoice.po_number}` : '',
      ].filter(Boolean),
      creator: 'Business Accounting Pro',
    };
  }

  function buildBillMetadata(bill: any, company: any, vendor: any): import('../services/print-preview').PDFMetadata {
    const num = bill?.bill_number || bill?.id || '';
    const cur = (bill?.currency || 'USD').toUpperCase();
    const total = Number(bill?.total ?? 0);
    const totalStr = (() => {
      try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(total); }
      catch { return `${cur} ${total.toFixed(2)}`; }
    })();
    return {
      title: `Bill ${num}${vendor?.name ? ' — ' + vendor.name : ''}`,
      author: company?.name || 'Business Accounting Pro',
      subject: `Bill #${num} from ${vendor?.name || 'vendor'} for ${totalStr}`,
      keywords: ['bill', 'accounts-payable', String(num), vendor?.name || '', cur].filter(Boolean),
      creator: 'Business Accounting Pro',
    };
  }

  function buildPOMetadata(po: any, company: any, vendor: any): import('../services/print-preview').PDFMetadata {
    const num = po?.po_number || po?.id || '';
    const cur = (po?.currency || 'USD').toUpperCase();
    return {
      title: `Purchase Order ${num}${vendor?.name ? ' — ' + vendor.name : ''}`,
      author: company?.name || 'Business Accounting Pro',
      subject: `PO #${num} to ${vendor?.name || 'vendor'}`,
      keywords: ['purchase-order', 'po', String(num), vendor?.name || '', cur].filter(Boolean),
      creator: 'Business Accounting Pro',
    };
  }

  function buildExpenseMetadata(expense: any, company: any, vendor: any): import('../services/print-preview').PDFMetadata {
    const ref = expense?.reference || expense?.id || '';
    const cur = (expense?.currency || 'USD').toUpperCase();
    const amt = Number(expense?.amount ?? expense?.total ?? 0);
    const amtStr = (() => {
      try { return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(amt); }
      catch { return `${cur} ${amt.toFixed(2)}`; }
    })();
    return {
      title: `Expense ${ref}${vendor?.name ? ' — ' + vendor.name : ''}`,
      author: company?.name || 'Business Accounting Pro',
      subject: `Expense receipt for ${amtStr}${expense?.category ? ' (' + expense.category + ')' : ''}`,
      keywords: ['expense', 'receipt', String(ref), vendor?.name || '', expense?.category || '', cur].filter(Boolean),
      creator: 'Business Accounting Pro',
    };
  }

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
      // Build PDF metadata once — reused whether HTML is renderer-provided
      // or generated server-side. Sets Title/Author/Subject/Keywords on
      // the saved PDF for Spotlight + Adobe File → Properties visibility.
      const _client = db.getById('clients', invoice.client_id);
      const _company = db.getById('companies', companyId);
      const meta = buildInvoiceMetadata(invoice, _company, _client);
      const optsWithMeta = { ...(pdfOptions || {}), metadata: meta };

      let pdfBuffer: Buffer;
      if (providedHTML) {
        pdfBuffer = await htmlToPDFBuffer(providedHTML, optsWithMeta);
      } else {
        const dbInstance = db.getDb();
        const lineItems = dbInstance.prepare(
          'SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY sort_order'
        ).all(invoiceId) as any[];
        pdfBuffer = await generateInvoicePDF(invoice, _company, _client, lineItems, optsWithMeta);
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
      // 'combined' = single PDF with page breaks
      // 'separate' = one PDF per invoice into a folder
      // 'zip'      = one PDF per invoice, packaged into a single ZIP archive
      mode?: 'combined' | 'separate' | 'zip';
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

      // ── ZIP mode (P1.8) ──────────────────────────────────
      // One PDF per invoice, streamed into a single .zip archive
      // via the `archiver` library. Streaming avoids holding all PDF
      // buffers in memory at once — critical for batches of 100+
      // invoices where each PDF could be 100-300KB.
      if (mode === 'zip') {
        const archiver = (await import('archiver')).default;
        const fs = require('fs');
        const defaultZipName = buildPdfFilename('invoices', String(invoiceIds.length)).replace(/\.pdf$/, '.zip');
        const { filePath: zipPath, canceled } = await dialog.showSaveDialog({
          defaultPath: defaultZipName,
          filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
          properties: ['showOverwriteConfirmation', 'createDirectory'],
        });
        if (canceled || !zipPath) return { cancelled: true };

        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 6 } }); // PDFs compress poorly; level 6 is the speed/ratio sweet spot
        archive.pipe(output);

        // We need to await the stream finish AFTER all entries are appended.
        // Track this so the IPC handler resolves only when the file is closed.
        const closePromise = new Promise<void>((resolve, reject) => {
          output.on('close', () => resolve());
          output.on('error', reject);
          archive.on('error', reject);
        });

        const written: string[] = [];
        const skipped: string[] = [];

        for (let i = 0; i < invoiceIds.length; i++) {
          const invId = invoiceIds[i];
          const invoice = db.getById('invoices', invId);
          if (!invoice) {
            skipped.push(invId);
            continue;
          }
          const client = db.getById('clients', invoice.client_id);
          const lineItems = dbInstance.prepare(
            'SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY sort_order'
          ).all(invId) as any[];
          sendProgress(i + 1, invoiceIds.length, `Invoice ${invoice.invoice_number}`);
          try {
            const html = buildInvoiceHTML(company, client, invoice, lineItems);
            const meta = buildInvoiceMetadata(invoice, company, client);
            const buf = await htmlToPDFBuffer(html, { ...(pdfOptions || {}), metadata: meta });
            const entryName = buildPdfFilename('invoice', String(invoice.invoice_number || invId));
            archive.append(buf, { name: entryName });
            written.push(entryName);
            try { db.logAudit(companyId, 'invoices', invId, 'export_pdf', { archive: zipPath, entry: entryName, batch: true }); }
            catch { /* audit best-effort */ }
          } catch (renderErr: any) {
            // Don't abort the whole archive on a single render failure —
            // log the skip and continue. Caller sees `skipped[]` count.
            console.warn(`[batch-pdf:zip] render failed for ${invId}:`, renderErr?.message);
            skipped.push(invId);
          }
        }

        await archive.finalize();
        await closePromise;
        return { path: zipPath, count: written.length, skipped: skipped.length };
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
  ipcMain.handle('invoice:send-email', async (_event, payload: string | { invoiceId: string; html?: string; templateKey?: string }) => {
    // Back-compat: old callers passed the invoiceId as a bare string.
    const invoiceId = typeof payload === 'string' ? payload : payload.invoiceId;
    const providedHTML = typeof payload === 'string' ? undefined : payload.html;
    // Template selection: caller can pick invoice_send / payment_reminder_1 /
    // payment_reminder_2 / overdue_notice. Defaults to invoice_send for the
    // common "Send invoice" button. Falls back to hardcoded copy if the
    // template lookup fails (e.g. brand-new company before seeding).
    const templateKey = (typeof payload === 'string' ? undefined : payload.templateKey) || 'invoice_send';

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
      // Always populate PDF metadata so the recipient's PDF reader and
      // their OS Spotlight see meaningful Title/Author/Subject/Keywords.
      const meta = buildInvoiceMetadata(invoice, company, client);
      const optsWithMeta = { metadata: meta };
      let pdfBuffer: Buffer;
      if (providedHTML) {
        pdfBuffer = await htmlToPDFBuffer(providedHTML, optsWithMeta);
      } else {
        const lineItems = dbInstance.prepare(
          'SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY sort_order'
        ).all(invoiceId) as any[];
        pdfBuffer = await generateInvoicePDF(invoice, company, client, lineItems, optsWithMeta);
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

      // Open email client with pre-filled content. Prefer the customized
      // email template (Settings → Email Templates) so the user's brand
      // voice and layout are preserved. If the template lookup fails for
      // any reason, fall back to the hardcoded copy in email-sender.ts.
      let emailResult: { success: boolean; error?: string };
      try {
        ensureDefaultEmailTemplates(companyId);
        const tmpl = dbInstance.prepare(
          `SELECT * FROM email_templates WHERE company_id = ? AND key = ?`
        ).get(companyId, templateKey) as any;
        if (tmpl) {
          const ctx = buildTemplateContext(companyId, 'invoice', invoiceId);
          const subject = resolveTemplateTokens(tmpl.subject || '', ctx);
          const body = resolveTemplateTokens(tmpl.body || '', ctx);
          const to = (tmpl.default_to || '').includes('client.email')
            ? (client?.email || '')
            : (tmpl.default_to || client?.email || '');
          const params = new URLSearchParams();
          params.set('subject', subject);
          params.set('body', body);
          if (tmpl.default_cc) params.set('cc', tmpl.default_cc);
          if (tmpl.default_bcc) params.set('bcc', tmpl.default_bcc);
          const mailto = `mailto:${encodeURIComponent(to)}?${params.toString()}`;
          await shell.openExternal(mailto);
          emailResult = { success: true };
        } else {
          emailResult = await sendInvoiceEmail(invoice, company, client);
        }
      } catch (templateErr) {
        // Template path failed — surface to console but still attempt
        // hardcoded fallback so the user can send the invoice.
        console.warn('[email] template path failed, using fallback:', templateErr);
        emailResult = await sendInvoiceEmail(invoice, company, client);
      }

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
  // PORTAL: token-expiry default is configurable via the
  // `portal_token_expiry_days` setting (per-company). Falls back to 90.
  // Settings UI may write any positive integer; we clamp to [1, 3650]
  // to keep the math finite. Document this key alongside SYNC_SERVER.
  function getPortalExpiryDays(companyId: string): number {
    try {
      const row = db.getDb().prepare(
        "SELECT value FROM settings WHERE company_id = ? AND key = 'portal_token_expiry_days'"
      ).get(companyId) as any;
      const v = parseInt(row?.value ?? '', 10);
      if (Number.isFinite(v) && v > 0) return Math.min(v, 3650);
    } catch { /* fall through */ }
    return 90;
  }

  ipcMain.handle('invoice:generate-token', (_event, invoiceId: string) => {
    const dbInstance = db.getDb();
    // PORTAL: a stale (expires_at=0) row counts as "no usable token" so the
    // user gets a fresh one after Disable; otherwise idempotent.
    const existing = dbInstance.prepare(
      `SELECT token, expires_at FROM invoice_tokens WHERE invoice_id = ?`
    ).get(invoiceId) as any;
    if (existing && existing.expires_at && existing.expires_at > 0) {
      return { token: existing.token };
    }

    const token = crypto.randomBytes(32).toString('hex');
    const invoice = dbInstance.prepare(`SELECT due_date FROM invoices WHERE id = ?`).get(invoiceId) as any;
    const dueTs = invoice?.due_date
      ? new Date(invoice.due_date).getTime()
      : Date.now();
    const companyId = db.getCurrentCompanyId() ?? '';
    const expiryDays = getPortalExpiryDays(companyId);
    const expiresAt = Math.floor(dueTs / 1000) + expiryDays * 86400;
    const tokenId = uuid();

    // If a stale row existed, replace it rather than insert (uniq on invoice_id).
    if (existing) {
      dbInstance.prepare(`DELETE FROM invoice_tokens WHERE invoice_id = ?`).run(invoiceId);
    }

    dbInstance.prepare(`
      INSERT INTO invoice_tokens (id, invoice_id, company_id, token, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(tokenId, invoiceId, companyId, token, expiresAt);

    // Push the new token to the VPS replica IMMEDIATELY so the portal
    // URL works the moment it's shared. Without this, the user would
    // hit "Invoice not found" until the next auto-backup tick (30s+).
    // Fire-and-forget — failure just means the token reaches the VPS
    // on the next regular sync. Localhost path stays usable either way.
    syncPush({
      table_name: 'invoice_tokens',
      operation: 'insert',
      record_id: tokenId,
      company_id: companyId,
      payload: { id: tokenId, invoice_id: invoiceId, company_id: companyId, token, expires_at: expiresAt },
    } as any).catch((err) => {
      console.warn('[portal] immediate token sync failed (will retry on next backup):', err?.message ?? err);
    });

    return { token };
  });

  // ─── Invoice Portal Token: info / regenerate / disable ──
  // PORTAL: returns the current token row plus the most recent
  // 'portal_view' audit entry (if any). Audit entries originate on the
  // VPS replica when a recipient opens the portal; they only land on the
  // desktop once the next server→desktop sync runs, so the renderer must
  // tolerate "no entry yet" and show "Not available yet".
  ipcMain.handle('invoice:token-info', (_event, invoiceId: string) => {
    try {
      const dbInstance = db.getDb();
      const tokenRow = dbInstance.prepare(
        `SELECT token, expires_at FROM invoice_tokens WHERE invoice_id = ?`
      ).get(invoiceId) as any;
      let lastView: any = null;
      try {
        lastView = dbInstance.prepare(
          `SELECT timestamp, changes FROM audit_log
           WHERE entity_type = 'invoice' AND entity_id = ? AND action = 'portal_view'
           ORDER BY timestamp DESC LIMIT 1`
        ).get(invoiceId) as any;
      } catch { /* table may differ on legacy DBs */ }
      return { token: tokenRow?.token ?? null, expiresAt: tokenRow?.expires_at ?? 0, lastView };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('invoice:regenerate-token', (_event, invoiceId: string) => {
    try {
      const dbInstance = db.getDb();
      const companyId = db.getCurrentCompanyId() ?? '';
      // INVALIDATION: mark the old row as expired so any link already shared
      // stops working. We then delete it so the new token can take its place
      // (invoice_id is effectively unique per token row in this codebase).
      const old = dbInstance.prepare(
        `SELECT id, token FROM invoice_tokens WHERE invoice_id = ?`
      ).get(invoiceId) as any;
      if (old) {
        dbInstance.prepare(`UPDATE invoice_tokens SET expires_at = 0 WHERE id = ?`).run(old.id);
        // Push the invalidation NOW so the VPS replica also rejects the old link.
        syncPush({
          table_name: 'invoice_tokens',
          operation: 'update',
          record_id: old.id,
          company_id: companyId,
          payload: { id: old.id, invoice_id: invoiceId, company_id: companyId, token: old.token, expires_at: 0 },
        } as any).catch(() => {});
        dbInstance.prepare(`DELETE FROM invoice_tokens WHERE id = ?`).run(old.id);
      }
      // Mint fresh.
      const token = crypto.randomBytes(32).toString('hex');
      const invoice = dbInstance.prepare(`SELECT due_date FROM invoices WHERE id = ?`).get(invoiceId) as any;
      const dueTs = invoice?.due_date ? new Date(invoice.due_date).getTime() : Date.now();
      const expiryDays = getPortalExpiryDays(companyId);
      const expiresAt = Math.floor(dueTs / 1000) + expiryDays * 86400;
      const tokenId = uuid();
      dbInstance.prepare(`
        INSERT INTO invoice_tokens (id, invoice_id, company_id, token, expires_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(tokenId, invoiceId, companyId, token, expiresAt);
      syncPush({
        table_name: 'invoice_tokens',
        operation: 'insert',
        record_id: tokenId,
        company_id: companyId,
        payload: { id: tokenId, invoice_id: invoiceId, company_id: companyId, token, expires_at: expiresAt },
      } as any).catch(() => {});
      if (companyId) db.logAudit(companyId, 'invoice', invoiceId, 'update', { _action: 'portal_token_regenerated' });
      return { token, expiresAt };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('invoice:disable-token', (_event, invoiceId: string) => {
    try {
      const dbInstance = db.getDb();
      const companyId = db.getCurrentCompanyId() ?? '';
      const row = dbInstance.prepare(
        `SELECT id, token FROM invoice_tokens WHERE invoice_id = ?`
      ).get(invoiceId) as any;
      if (!row) return { ok: true, alreadyDisabled: true };
      dbInstance.prepare(`UPDATE invoice_tokens SET expires_at = 0 WHERE id = ?`).run(row.id);
      syncPush({
        table_name: 'invoice_tokens',
        operation: 'update',
        record_id: row.id,
        company_id: companyId,
        payload: { id: row.id, invoice_id: invoiceId, company_id: companyId, token: row.token, expires_at: 0 },
      } as any).catch(() => {});
      if (companyId) db.logAudit(companyId, 'invoice', invoiceId, 'update', { _action: 'portal_token_disabled' });
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // ─── Debt Portal Token: info / regenerate / disable ─────
  // The debt token is stored on the debts row itself (portal_token /
  // portal_token_expires_at columns added in round 2). If those columns
  // don't exist on a legacy DB we degrade silently rather than crashing.
  ipcMain.handle('debt:portal-token-info', (_event, { debtId }: { debtId: string }) => {
    try {
      const dbInstance = db.getDb();
      const debt = dbInstance.prepare(`SELECT * FROM debts WHERE id = ?`).get(debtId) as any;
      if (!debt) return { token: null, expiresAt: 0, lastView: null };
      let lastView: any = null;
      try {
        lastView = dbInstance.prepare(
          `SELECT timestamp, changes FROM audit_log
           WHERE entity_type = 'debt' AND entity_id = ? AND action = 'portal_view'
           ORDER BY timestamp DESC LIMIT 1`
        ).get(debtId) as any;
      } catch { /* ignore */ }
      return {
        token: debt.portal_token ?? null,
        expiresAt: debt.portal_token_expires_at ?? 0,
        lastView,
      };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('debt:regenerate-portal-token', (_event, { debtId }: { debtId: string }) => {
    try {
      const dbInstance = db.getDb();
      const companyId = db.getCurrentCompanyId() ?? '';
      const debt = dbInstance.prepare(`SELECT id FROM debts WHERE id = ?`).get(debtId) as any;
      if (!debt) return { error: 'Debt not found' };
      const token = crypto.randomBytes(32).toString('hex');
      const expiryDays = getPortalExpiryDays(companyId);
      const expiresAt = Math.floor(Date.now() / 1000) + expiryDays * 86400;
      // PORTAL: try to persist on the debts row; if those columns are missing
      // on an older DB, we still return the token so the immediate share works
      // (but skip sync since there's nothing to write).
      try {
        dbInstance.prepare(
          `UPDATE debts SET portal_token = ?, portal_token_expires_at = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(token, expiresAt, debtId);
        syncPush({
          table_name: 'debts',
          operation: 'update',
          record_id: debtId,
          company_id: companyId,
          payload: { id: debtId, portal_token: token, portal_token_expires_at: expiresAt },
        } as any).catch(() => {});
      } catch { /* legacy DB without columns */ }
      if (companyId) db.logAudit(companyId, 'debt', debtId, 'update', { _action: 'portal_token_regenerated' });
      const portalUrl = `${SYNC_SERVER}/portal/debt/${token}`;
      return { token, expiresAt, portalUrl };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('debt:disable-portal-token', (_event, { debtId }: { debtId: string }) => {
    try {
      const dbInstance = db.getDb();
      const companyId = db.getCurrentCompanyId() ?? '';
      try {
        dbInstance.prepare(
          `UPDATE debts SET portal_token_expires_at = 0, updated_at = datetime('now') WHERE id = ?`
        ).run(debtId);
        syncPush({
          table_name: 'debts',
          operation: 'update',
          record_id: debtId,
          company_id: companyId,
          payload: { id: debtId, portal_token_expires_at: 0 },
        } as any).catch(() => {});
      } catch { /* legacy DB */ }
      if (companyId) db.logAudit(companyId, 'debt', debtId, 'update', { _action: 'portal_token_disabled' });
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // PORTAL: lets the renderer build the portal URL using the configured
  // SYNC_SERVER without hard-coding the host. Returned here (rather than
  // computed in the renderer) so a future env-driven override flows through.
  ipcMain.handle('portal:base-url', () => {
    // Returns the customer-facing portal URL — what we embed in QR codes
    // and email merge variables. This is DIFFERENT from SYNC_SERVER:
    //   • SYNC_SERVER  = backend API the desktop app talks to for sync
    //   • portal URL   = where the recipient logs in / views their invoice
    // The user can override per-company via settings table key
    // 'portal_base_url'. Defaults to the RMPG Pro Services client portal.
    const companyId = db.getCurrentCompanyId();
    let baseUrl = 'https://rmpgutahps.us/client/login';
    if (companyId) {
      try {
        const setting = db.getDb().prepare(
          "SELECT value FROM settings WHERE company_id = ? AND key = 'portal_base_url'"
        ).get(companyId) as any;
        if (setting?.value) baseUrl = setting.value;
      } catch { /* fall through to default */ }
    }
    return { baseUrl };
  });

  // SECURITY: only http(s) URLs reach the OS shell; rejects mailto/file/etc.
  ipcMain.handle('shell:open-external', (_event, url: string) => {
    if (typeof url !== 'string') return { ok: false };
    if (!/^https?:\/\//i.test(url)) return { ok: false };
    try {
      shell.openExternal(url).catch(() => {});
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message };
    }
  });

  // ─── Client Portal Integration (rmpgutahps.us) ───────────
  // The API key is encrypted with Electron's safeStorage (OS keychain
  // backed) before being written to SQLite. Plaintext never touches
  // disk — DB backups expose only ciphertext, which is undecryptable
  // without the user's OS login.
  //
  // SECURITY NOTE: safeStorage availability depends on the OS keychain
  // being unlocked. On macOS/Windows this is normally true after login;
  // on Linux it requires libsecret. If safeStorage is unavailable, we
  // refuse to store the key and surface a clear error to the UI rather
  // than silently falling back to plaintext.
  function ensurePortalIntegrationRow(companyId: string): void {
    const existing = db.getDb().prepare(
      `SELECT id FROM portal_integration_settings WHERE company_id = ?`
    ).get(companyId) as any;
    if (existing) return;
    db.getDb().prepare(
      `INSERT INTO portal_integration_settings (id, company_id) VALUES (?, ?)`
    ).run(uuid(), companyId);
  }

  ipcMain.handle('portal-integration:get', (_event) => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return { error: 'No active company' };
      ensurePortalIntegrationRow(companyId);
      const row = db.getDb().prepare(
        `SELECT * FROM portal_integration_settings WHERE company_id = ?`
      ).get(companyId) as any;
      // Never return the ciphertext to the renderer — only a boolean
      // indicating whether a key is stored. Treats the API key as a
      // write-only field; user must rotate by entering a new value.
      return {
        portal_base_url: row?.portal_base_url || 'https://rmpgutahps.us/client/login',
        api_endpoint: row?.api_endpoint || 'https://rmpgutahps.us/api/v1',
        auth_scheme: row?.auth_scheme || 'bearer',
        health_check_path: row?.health_check_path ?? '/health',
        auto_sync_invoices: !!row?.auto_sync_invoices,
        api_key_set: !!row?.api_key_encrypted,
        last_sync_at: row?.last_sync_at || null,
        last_sync_status: row?.last_sync_status || null,
        last_test_at: row?.last_test_at || null,
        last_test_status: row?.last_test_status || null,
        last_test_message: row?.last_test_message || '',
      };
    } catch (err: any) {
      return { error: err?.message || 'Failed to load portal integration settings' };
    }
  });

  ipcMain.handle('portal-integration:save', async (_event, payload: {
    portal_base_url?: string;
    api_endpoint?: string;
    auth_scheme?: 'bearer' | 'apikey-header';
    health_check_path?: string;
    auto_sync_invoices?: boolean;
    api_key?: string;          // plaintext — encrypted before storage
    clear_api_key?: boolean;   // explicit signal to wipe the stored key
  }) => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return { error: 'No active company' };
      ensurePortalIntegrationRow(companyId);

      const { safeStorage } = await import('electron');
      const updates: Record<string, any> = {};
      if (payload.portal_base_url !== undefined) updates.portal_base_url = payload.portal_base_url;
      if (payload.api_endpoint !== undefined) updates.api_endpoint = payload.api_endpoint;
      if (payload.auth_scheme !== undefined) updates.auth_scheme = payload.auth_scheme;
      if (payload.health_check_path !== undefined) updates.health_check_path = payload.health_check_path;
      if (payload.auto_sync_invoices !== undefined) updates.auto_sync_invoices = payload.auto_sync_invoices ? 1 : 0;
      if (payload.clear_api_key) {
        updates.api_key_encrypted = null;
      } else if (payload.api_key !== undefined) {
        if (!safeStorage.isEncryptionAvailable()) {
          return { error: 'OS keychain is not available — cannot securely store API key. Unlock your keychain (macOS Keychain Access / Windows Credential Manager) and try again.' };
        }
        const cipher = safeStorage.encryptString(payload.api_key);
        updates.api_key_encrypted = cipher.toString('base64');
      }
      updates.updated_at = new Date().toISOString();

      const row = db.getDb().prepare(`SELECT id FROM portal_integration_settings WHERE company_id = ?`).get(companyId) as any;
      if (row) db.update('portal_integration_settings', row.id, updates);
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message || 'Failed to save portal integration settings' };
    }
  });

  // Decrypt the stored API key. Internal helper — NEVER expose this
  // via IPC. Returns null if no key is stored or decryption fails.
  async function getPortalApiKey(companyId: string): Promise<string | null> {
    try {
      const row = db.getDb().prepare(
        `SELECT api_key_encrypted FROM portal_integration_settings WHERE company_id = ?`
      ).get(companyId) as any;
      if (!row?.api_key_encrypted) return null;
      const { safeStorage } = await import('electron');
      if (!safeStorage.isEncryptionAvailable()) return null;
      const buf = Buffer.from(row.api_key_encrypted, 'base64');
      return safeStorage.decryptString(buf);
    } catch {
      return null;
    }
  }

  // Test the integration: makes an authenticated GET to the configured
  // endpoint and reports back. Endpoint convention assumed:
  //   GET <api_endpoint>/ping  → 200 OK with body { ok: true, ts }
  // If your portal uses a different health-check path, configure it
  // via api_endpoint (the path is appended to the base).
  ipcMain.handle('portal-integration:test', async (_event) => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return { ok: false, error: 'No active company' };
      ensurePortalIntegrationRow(companyId);
      const row = db.getDb().prepare(
        `SELECT api_endpoint, auth_scheme, health_check_path FROM portal_integration_settings WHERE company_id = ?`
      ).get(companyId) as any;
      const apiKey = await getPortalApiKey(companyId);
      if (!apiKey) {
        const msg = 'API key not configured';
        db.update('portal_integration_settings', (db.getDb().prepare(`SELECT id FROM portal_integration_settings WHERE company_id = ?`).get(companyId) as any).id, {
          last_test_at: new Date().toISOString(),
          last_test_status: 'no_key',
          last_test_message: msg,
        });
        return { ok: false, error: msg };
      }
      const endpoint = (row?.api_endpoint || 'https://rmpgutahps.us/api/v1').replace(/\/$/, '');
      const headers: Record<string, string> = { 'Accept': 'application/json' };
      if (row?.auth_scheme === 'apikey-header') {
        headers['X-API-Key'] = apiKey;
      } else {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
      // Configurable health-check path so users can adapt to whatever
      // endpoint their portal actually exposes (Laravel /health,
      // Express /status, REST /api/v1, etc.). Empty string = base URL.
      const rawPath = (row?.health_check_path ?? '/health').toString().trim();
      const path = rawPath && !rawPath.startsWith('/') ? `/${rawPath}` : rawPath;
      const url = `${endpoint}${path}`;
      const start = Date.now();
      const res = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(10_000) }).catch((err: any) => {
        throw new Error(`Network error: ${err?.message || err}`);
      });
      const elapsed = Date.now() - start;
      const txt = await res.text().catch(() => '');
      const status = res.ok ? 'success' : `http_${res.status}`;
      const message = res.ok
        ? `Connected (${elapsed}ms)`
        : `HTTP ${res.status} ${res.statusText} — ${txt.slice(0, 200)}`;
      const updateRow = db.getDb().prepare(`SELECT id FROM portal_integration_settings WHERE company_id = ?`).get(companyId) as any;
      if (updateRow) {
        db.update('portal_integration_settings', updateRow.id, {
          last_test_at: new Date().toISOString(),
          last_test_status: status,
          last_test_message: message,
        });
      }
      return { ok: res.ok, status: res.status, elapsedMs: elapsed, message };
    } catch (err: any) {
      const message = err?.message || 'Test failed';
      try {
        const companyId = db.getCurrentCompanyId();
        if (companyId) {
          const r = db.getDb().prepare(`SELECT id FROM portal_integration_settings WHERE company_id = ?`).get(companyId) as any;
          if (r) db.update('portal_integration_settings', r.id, {
            last_test_at: new Date().toISOString(),
            last_test_status: 'error',
            last_test_message: message,
          });
        }
      } catch { /* ignore */ }
      return { ok: false, error: message };
    }
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

      // (debt ↔ invoice) bidirectional, relation: 'collected_for'
      try {
        recordRelationBidirectional(
          companyId, 'debt', debt.id, 'invoice', invoiceId, 'collected_for',
          { converted_at: new Date().toISOString(), balance },
        );
      } catch (err) {
        console.warn('invoice:convert-to-debt recordRelation failed:', (err as Error)?.message);
      }

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
      let result: any;
      if (existing) {
        db.update('invoice_settings', existing.id, data);
        result = db.getDb().prepare('SELECT * FROM invoice_settings WHERE company_id = ?').get(companyId);
      } else {
        result = db.create('invoice_settings', { ...data, company_id: companyId });
      }
      scheduleAutoBackup();
      return result;
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
      // DATE: build Jan 1 string from the local year — toISOString() shifts day in non-UTC zones.
      const startOfYear = `${today.getFullYear()}-01-01`;
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
        // CONCURRENCY: cancel any pending auto-backup so it doesn't race
        // against the restore (would re-upload the soon-to-be-overwritten
        // empty DB right as we restore the real one), then close the DB
        // *before* overwriting the file so we don't tear out from under any
        // open prepared statements / WAL state.
        if (autoBackupTimer) {
          clearTimeout(autoBackupTimer);
          autoBackupTimer = null;
        }
        const dbPath = db.getDbPath();
        try {
          db.getDb().pragma('wal_checkpoint(TRUNCATE)');
          db.getDb().close();
        } catch (_) {}
        // Also remove -wal and -shm so the restored DB isn't paired with a
        // stale WAL from the old empty database.
        try { fs.unlinkSync(dbPath + '-wal'); } catch (_) {}
        try { fs.unlinkSync(dbPath + '-shm'); } catch (_) {}
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

  // SECURITY: Replaces a renderer-driven `DELETE FROM users` via rawQuery.
  // Routing account deletion through a named handler keeps the protected-table
  // guard intact and lets us scope the delete to the caller's own user id.
  ipcMain.handle('auth:delete-account', (_event, { userId }: { userId: string }) => {
    if (!userId || typeof userId !== 'string') return { error: 'Invalid userId' };
    try {
      db.execQuery('DELETE FROM user_companies WHERE user_id = ?', [userId]);
      db.execQuery('DELETE FROM users WHERE id = ?', [userId]);
      return { ok: true };
    } catch (err) {
      console.error('auth:delete-account failed:', err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
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
    if (results.length) scheduleAutoBackup();
    return results;
  });

  // ─── Batch Delete ──────────────────────────────────────
  ipcMain.handle('batch:delete', (_event, { table, ids }: { table: string; ids: string[] }) => {
    const companyId = db.getCurrentCompanyId();
    const errors: Array<{ id: string; error: string }> = [];
    let deleted = 0;
    for (const id of ids) {
      try {
        if (companyId) db.logAudit(companyId, table, id, 'delete');
        // Clean up FK references in related tables BEFORE the parent delete.
        cleanupReferencesBeforeDelete(table, id);
        db.remove(table, id);
        deleted++;
      } catch (err: any) {
        errors.push({ id, error: err?.message || 'unknown error' });
      }
    }
    if (deleted) scheduleAutoBackup();
    if (errors.length) {
      return { deleted, errors, error: `Deleted ${deleted} of ${ids.length}. ${errors.length} failed: ${errors.map(e => e.error).slice(0, 3).join('; ')}` };
    }
    return { deleted };
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
      defaultPath: `backup-${localToday()}.zip`,
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
    const result = processRecurringTemplates(companyId || undefined);
    // Reactive engine: emit recurring.processed.
    try {
      if (companyId) {
        eventBus.emit({
          type: 'recurring.processed',
          companyId,
          entityType: 'recurring',
          entityId: '',
          data: { result },
        }).catch(() => {});
      }
    } catch { /* fire-and-forget */ }
    return result;
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
      "SELECT entry_number FROM journal_entries WHERE company_id = ? ORDER BY CAST(SUBSTR(entry_number, INSTR(entry_number, '-') + 1) AS INTEGER) DESC LIMIT 1"
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

  // ─── GL Rebuild (retro-post missing journal entries) ──────
  // Scans all invoices, expenses, payments, and payroll runs,
  // posts JEs for any that don't have corresponding entries.
  ipcMain.handle('gl:rebuild', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { error: 'No active company' };
    const dbInstance = db.getDb();

    // Auto-posted JE description prefixes — used to identify machine-generated entries
    const AUTO_PREFIXES = [
      'Invoice created -', 'Payment received -', 'Expense recorded -',
      'Bill payment -', 'Payroll -',
    ];

    try {
      // Wrap entire rebuild in a transaction for atomicity
      const rebuildFn = (dbInstance as any).transaction(() => {
        // ── Step 1: Delete all previously auto-posted JEs (clean slate) ──
        // Find auto-posted JE ids by description prefix
        const autoJEIds: string[] = [];
        for (const prefix of AUTO_PREFIXES) {
          const rows = (dbInstance as any).prepare(
            `SELECT id FROM journal_entries WHERE company_id = ? AND description LIKE ?`
          ).all(companyId, `${prefix}%`) as any[];
          for (const r of rows) autoJEIds.push(r.id);
        }

        // CONCURRENCY: hoist prepared statements out of the loop. `prepare`
        // parses + caches each call; preparing inside a hot loop creates one
        // statement object per iteration instead of reusing a single one.
        const delLinesStmt = (dbInstance as any).prepare(`DELETE FROM journal_entry_lines WHERE journal_entry_id = ?`);
        const delEntryStmt = (dbInstance as any).prepare(`DELETE FROM journal_entries WHERE id = ?`);
        for (const jeId of autoJEIds) {
          delLinesStmt.run(jeId);
          delEntryStmt.run(jeId);
        }
        const deleted = autoJEIds.length;

        let posted = 0;

        // ── Step 2: Post invoice JEs (DR Receivable / CR Revenue) ──
        const invoices = (dbInstance as any).prepare(
          `SELECT id, invoice_number, issue_date, total, subtotal FROM invoices WHERE company_id = ? AND status != 'draft'`
        ).all(companyId) as any[];
        for (const inv of invoices) {
          const total = Number(inv.total || inv.subtotal) || 0;
          if (total <= 0) continue;
          const num = inv.invoice_number || inv.id.substring(0, 8);
          postJournalEntry(dbInstance, companyId, inv.issue_date || localToday(),
            `Invoice created - #${num}`, [
              { nameHint: 'Receivable', debit: total, credit: 0, note: `AR for Invoice #${num}` },
              { nameHint: 'Revenue', debit: 0, credit: total, note: `Revenue from Invoice #${num}` },
            ]);
          posted++;
        }

        // ── Step 3: Post invoice payment JEs (DR Cash / CR Receivable) ──
        const payments = (dbInstance as any).prepare(
          `SELECT p.*, i.invoice_number FROM payments p LEFT JOIN invoices i ON p.invoice_id = i.id WHERE p.company_id = ?`
        ).all(companyId) as any[];
        for (const p of payments) {
          const amount = Number(p.amount) || 0;
          if (amount <= 0) continue;
          postJournalEntry(dbInstance, companyId, p.date || localToday(),
            `Payment received - ${p.invoice_number || p.invoice_id?.substring(0, 8) || 'unknown'}`, [
              { nameHint: 'Cash', debit: amount, credit: 0, note: 'Cash received' },
              { nameHint: 'Receivable', debit: 0, credit: amount, note: 'Clear AR' },
            ]);
          posted++;
        }

        // ── Step 4: Post expense JEs (DR [category] / CR Cash or Payable) ──
        const expenses = (dbInstance as any).prepare(
          `SELECT e.id, e.description, e.date, e.amount, e.status, e.category_id,
                  COALESCE(c.name, '') as category_name
           FROM expenses e
           LEFT JOIN categories c ON e.category_id = c.id
           WHERE e.company_id = ?`
        ).all(companyId) as any[];
        for (const exp of expenses) {
          const amount = Number(exp.amount) || 0;
          if (amount <= 0) continue;
          const isPaid = ['paid', 'approved'].includes(exp.status);
          const expenseHint = exp.category_name || 'Expense';
          postJournalEntry(dbInstance, companyId, exp.date || localToday(),
            `Expense recorded - ${exp.description || exp.id.substring(0, 8)}`, [
              { nameHint: expenseHint, debit: amount, credit: 0, note: exp.description || 'Expense' },
              { nameHint: isPaid ? 'Cash' : 'Payable', debit: 0, credit: amount, note: isPaid ? 'Cash paid' : 'Accounts Payable' },
            ]);
          posted++;
        }

        // ── Step 5: Post bill payment JEs (DR Payable / CR Cash) ──
        const billPayments = (dbInstance as any).prepare(
          `SELECT bp.*, b.bill_number FROM bill_payments bp LEFT JOIN bills b ON bp.bill_id = b.id WHERE bp.company_id = ?`
        ).all(companyId) as any[];
        for (const bp of billPayments) {
          const amount = Number(bp.amount) || 0;
          if (amount <= 0) continue;
          postJournalEntry(dbInstance, companyId, bp.date || localToday(),
            `Bill payment - ${bp.bill_number || bp.bill_id?.substring(0, 8) || 'unknown'}`, [
              { nameHint: 'Payable', debit: amount, credit: 0, note: 'AP cleared' },
              { nameHint: 'Cash', debit: 0, credit: amount, note: 'Cash paid' },
            ]);
          posted++;
        }

        return { deleted, posted };
      });

      const { deleted, posted } = rebuildFn();
      scheduleAutoBackup();
      return { posted, message: `Rebuilt GL: cleared ${deleted} old entries, posted ${posted} new journal entries.` };
    } catch (err: any) {
      console.error('gl:rebuild failed:', err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ─── Invoice Record Payment ───────────────────────────────
  // Consolidated handler: creates payment record, updates invoice status,
  // and posts DR Cash / CR Accounts Receivable journal entry in one transaction.
  ipcMain.handle('invoice:record-payment', async (_event, { invoiceId, amount, date, method, reference }: any) => {
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

      // INTEGRITY: roundCents prevents float-drift in amount_paid across
      // repeated partial payments (e.g. 100 + 0.1 + 0.2 = 100.30000000000001).
      const newAmountPaid = db.roundCents((invoice.amount_paid || 0) + Number(amount));
      const newStatus = newAmountPaid >= db.roundCents(invoice.total) ? 'paid' : 'partial';

      (dbInstance as any).prepare(`UPDATE invoices SET amount_paid = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(newAmountPaid, newStatus, invoiceId);

      postJournalEntry(dbInstance, companyId, date, `Payment received - ${invoice.invoice_number}`, [
        { nameHint: 'Cash', debit: amount, credit: 0, note: `Cash received for ${invoice.invoice_number}` },
        { nameHint: 'Receivable', debit: 0, credit: amount, note: `Clear AR for ${invoice.invoice_number}` },
      ]);

      return { paymentId, newStatus, newAmountPaid };
    });

    const result = tx();
    // Without scheduleAutoBackup the VPS backup would miss new payments —
    // user-visible because the dashboard still shows them, but a fresh
    // restore would lose every payment until the next mutation that
    // happens to schedule a backup.
    scheduleAutoBackup();

    // Reactive engine: emit payment + (optionally) invoice.paid events.
    try {
      await eventBus.emit({
        type: 'payment.received',
        companyId,
        entityType: 'invoice',
        entityId: invoiceId,
        data: { amount, method },
      }).catch(() => {});
      if (result?.newStatus === 'paid') {
        await eventBus.emit({
          type: 'invoice.paid',
          companyId,
          entityType: 'invoice',
          entityId: invoiceId,
          data: { total: amount },
        }).catch(() => {});
      }
    } catch { /* fire-and-forget */ }

    return result;
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
        COALESCE(SUM(ps.net_pay), 0) AS ytd_net,
        COALESCE(SUM(ps.federal_tax), 0) AS ytd_federal_tax,
        COALESCE(SUM(ps.state_tax), 0) AS ytd_state_tax,
        COALESCE(SUM(ps.social_security), 0) AS ytd_social_security,
        COALESCE(SUM(ps.medicare), 0) AS ytd_medicare
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
      ytd_federal_tax: row?.ytd_federal_tax ?? 0,
      ytd_state_tax: row?.ytd_state_tax ?? 0,
      ytd_social_security: row?.ytd_social_security ?? 0,
      ytd_medicare: row?.ytd_medicare ?? 0,
    };
  });

  // ─── Payroll Process (with journal entry) ────────────────────
  // Creates payroll_run + pay_stubs in a transaction and posts
  // DR Wages/Salary Expense / CR Wages Payable journal entry.
  ipcMain.handle('payroll:process', (_event, {
    periodStart, periodEnd, payDate,
    totalGross, totalTaxes, totalNet,
    stubs, // Array<{ employeeId, hours, hoursOvertime, grossPay, federalTax, stateTax, ss, medicare, netPay, ytdGross, ytdTaxes, ytdNet, preTaxDeductions?, postTaxDeductions?, deductionDetail? }>
    runType,
    notes,
    employeeCount,
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
        INSERT INTO payroll_runs (id, company_id, pay_period_start, pay_period_end, pay_date, status, total_gross, total_taxes, total_deductions, total_net, run_type, notes, employee_count)
        VALUES (?, ?, ?, ?, ?, 'processed', ?, ?, 0, ?, ?, ?, ?)
      `).run(runId, companyId, periodStart, periodEnd, payDate, totalGross, totalTaxes, totalNet, runType || 'regular', notes || '', employeeCount || stubs.length);

      // Feature 20: Auto-generate sequential check numbers
      let lastCheckNum = 1000;
      try {
        const lastCheck = (dbInstance as any).prepare(
          `SELECT check_number FROM pay_stubs WHERE check_number != '' ORDER BY CAST(check_number AS INTEGER) DESC LIMIT 1`
        ).get() as any;
        if (lastCheck?.check_number) {
          lastCheckNum = parseInt(lastCheck.check_number, 10) || 1000;
        }
      } catch { /* ignore — column may not exist yet */ }

      for (const s of stubs) {
        lastCheckNum++;
        const checkNumber = String(lastCheckNum).padStart(6, '0');

        // Compute per-tax YTD by summing all prior stubs for this employee in the same year
        const payYear = (payDate || '').substring(0, 4);
        let ytdFederal = s.federalTax || 0, ytdState = s.stateTax || 0, ytdSS = s.ss || 0, ytdMedicare = s.medicare || 0;
        if (payYear && s.employeeId) {
          try {
            const prior = (dbInstance as any).prepare(`
              SELECT COALESCE(SUM(ps.federal_tax), 0) AS f, COALESCE(SUM(ps.state_tax), 0) AS st,
                     COALESCE(SUM(ps.social_security), 0) AS ss, COALESCE(SUM(ps.medicare), 0) AS m
              FROM pay_stubs ps JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
              WHERE ps.employee_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ? AND pr.status != 'draft'
            `).get(s.employeeId, `${payYear}-01-01`, `${payYear}-12-31`) as any;
            if (prior) { ytdFederal += prior.f || 0; ytdState += prior.st || 0; ytdSS += prior.ss || 0; ytdMedicare += prior.m || 0; }
          } catch { /* ignore */ }
        }

        (dbInstance as any).prepare(`
          INSERT INTO pay_stubs (id, payroll_run_id, employee_id, hours_regular, hours_overtime, gross_pay, federal_tax, state_tax, social_security, medicare, other_deductions, net_pay, ytd_gross, ytd_taxes, ytd_net, pretax_deductions, posttax_deductions, deduction_detail, check_number, ytd_federal_tax, ytd_state_tax, ytd_social_security, ytd_medicare)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(uuid(), runId, s.employeeId, s.hours, s.hoursOvertime || 0, s.grossPay, s.federalTax, s.stateTax, s.ss, s.medicare, s.netPay, s.ytdGross, s.ytdTaxes, s.ytdNet, s.preTaxDeductions || 0, s.postTaxDeductions || 0, s.deductionDetail || '{}', checkNumber, ytdFederal, ytdState, ytdSS, ytdMedicare);
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

      // ── PTO Auto-Accrual ──
      // For each employee in this run, check if they have PTO policies and accrue hours
      try {
        const ptoPolicies = (dbInstance as any).prepare(
          'SELECT pb.*, pp.accrual_rate, pp.accrual_unit, pp.cap_hours, pp.name as policy_name FROM pto_balances pb JOIN pto_policies pp ON pb.policy_id = pp.id WHERE pb.employee_id IN (' + stubs.map(() => '?').join(',') + ')'
        ).all(...stubs.map((s: any) => s.employeeId)) as any[];

        for (const pb of ptoPolicies) {
          // Calculate accrual amount based on unit
          let accrualHours = 0;
          if (pb.accrual_unit === 'hours_per_pay_period') {
            accrualHours = pb.accrual_rate;
          } else if (pb.accrual_unit === 'annual') {
            // Divide annual rate by number of pay periods (assume 26 for biweekly)
            accrualHours = pb.accrual_rate / 26;
          } else if (pb.accrual_unit === 'monthly') {
            accrualHours = pb.accrual_rate; // 1 accrual per monthly run
          }

          if (accrualHours <= 0) continue;

          // Check cap
          const newBalance = (pb.balance_hours || 0) + accrualHours;
          const cappedBalance = pb.cap_hours ? Math.min(newBalance, pb.cap_hours) : newBalance;
          const actualAccrual = cappedBalance - (pb.balance_hours || 0);

          if (actualAccrual <= 0) continue;

          // Update balance
          (dbInstance as any).prepare(
            'UPDATE pto_balances SET balance_hours = ?, accrued_hours_ytd = accrued_hours_ytd + ?, updated_at = datetime(\'now\') WHERE id = ?'
          ).run(cappedBalance, actualAccrual, pb.id);

          // Log transaction
          (dbInstance as any).prepare(
            'INSERT INTO pto_transactions (id, employee_id, policy_id, type, hours, note, payroll_run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))'
          ).run(uuid(), pb.employee_id, pb.policy_id, 'accrual', actualAccrual, `Auto-accrual from payroll run ${periodStart} - ${periodEnd}`, runId);
        }
      } catch (ptoErr) {
        console.warn('PTO accrual skipped:', ptoErr);
        // PTO accrual is non-critical — don't fail the payroll run
      }

      return { runId };
    });

    const result = tx();
    scheduleAutoBackup();
    // Reactive engine: emit payroll.processed event.
    try {
      if (companyId && result?.runId) {
        eventBus.emit({
          type: 'payroll.processed',
          companyId,
          entityType: 'payroll_run',
          entityId: result.runId,
          data: {
            totalGross,
            totalNet,
            totalTaxes,
            employeeCount: employeeCount || stubs.length,
            periodStart,
            periodEnd,
            payDate,
          },
        }).catch(() => {});
      }
    } catch { /* fire-and-forget */ }
    return result;
  });

  // ─── Payroll Edit (replace existing run) ────────────────
  // Mirrors payroll:process but UPDATEs the existing run, deletes
  // and re-inserts pay_stubs, and reverses + reposts the GL entry.
  ipcMain.handle('payroll:edit', (_event, {
    runId,
    periodStart, periodEnd, payDate,
    totalGross, totalTaxes, totalNet,
    stubs,
    runType,
    notes,
    employeeCount,
  }: any) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) throw new Error('No active company');
    if (!runId) return { error: 'runId is required for edit' };
    const dbInstance = db.getDb();

    // Verify run exists and belongs to this company
    const existing = (dbInstance as any).prepare(
      `SELECT id, pay_date, pay_period_start FROM payroll_runs WHERE id = ? AND company_id = ?`
    ).get(runId, companyId) as any;
    if (!existing) return { error: 'Payroll run not found' };

    const tx = (dbInstance as any).transaction(() => {
      // 1. Delete existing pay stubs
      (dbInstance as any).prepare(`DELETE FROM pay_stubs WHERE payroll_run_id = ?`).run(runId);

      // 2. Delete the previously auto-posted journal entry for this run
      const oldJE = (dbInstance as any).prepare(
        `SELECT id FROM journal_entries WHERE company_id = ? AND description LIKE ?`
      ).get(companyId, `Payroll - ${existing.pay_period_start}%`) as any;
      if (oldJE) {
        (dbInstance as any).prepare(`DELETE FROM journal_entry_lines WHERE journal_entry_id = ?`).run(oldJE.id);
        (dbInstance as any).prepare(`DELETE FROM journal_entries WHERE id = ?`).run(oldJE.id);
      }

      // 3. Update the run row with new totals + period info
      (dbInstance as any).prepare(`
        UPDATE payroll_runs SET pay_period_start = ?, pay_period_end = ?, pay_date = ?, total_gross = ?, total_taxes = ?, total_net = ?, run_type = ?, notes = ?, employee_count = ?, updated_at = datetime('now')
        WHERE id = ? AND company_id = ?
      `).run(periodStart, periodEnd, payDate, totalGross, totalTaxes, totalNet, runType || 'regular', notes || '', employeeCount || stubs.length, runId, companyId);

      // 4. Insert new stubs (mirror payroll:process logic)
      let lastCheckNum = 1000;
      try {
        const lastCheck = (dbInstance as any).prepare(
          `SELECT check_number FROM pay_stubs WHERE check_number != '' ORDER BY CAST(check_number AS INTEGER) DESC LIMIT 1`
        ).get() as any;
        if (lastCheck?.check_number) {
          lastCheckNum = parseInt(lastCheck.check_number, 10) || 1000;
        }
      } catch { /* ignore */ }

      for (const s of stubs) {
        lastCheckNum++;
        const checkNumber = String(lastCheckNum).padStart(6, '0');

        const payYear = (payDate || '').substring(0, 4);
        let ytdFederal = s.federalTax || 0, ytdState = s.stateTax || 0, ytdSS = s.ss || 0, ytdMedicare = s.medicare || 0;
        if (payYear && s.employeeId) {
          try {
            // Exclude THIS run from the YTD sum (we just deleted its stubs but be explicit)
            const prior = (dbInstance as any).prepare(`
              SELECT COALESCE(SUM(ps.federal_tax), 0) AS f, COALESCE(SUM(ps.state_tax), 0) AS st,
                     COALESCE(SUM(ps.social_security), 0) AS ss, COALESCE(SUM(ps.medicare), 0) AS m
              FROM pay_stubs ps JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
              WHERE ps.employee_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ? AND pr.status != 'draft' AND pr.id != ?
            `).get(s.employeeId, `${payYear}-01-01`, `${payYear}-12-31`, runId) as any;
            if (prior) { ytdFederal += prior.f || 0; ytdState += prior.st || 0; ytdSS += prior.ss || 0; ytdMedicare += prior.m || 0; }
          } catch { /* ignore */ }
        }

        (dbInstance as any).prepare(`
          INSERT INTO pay_stubs (id, payroll_run_id, employee_id, hours_regular, hours_overtime, gross_pay, federal_tax, state_tax, social_security, medicare, other_deductions, net_pay, ytd_gross, ytd_taxes, ytd_net, pretax_deductions, posttax_deductions, deduction_detail, check_number, ytd_federal_tax, ytd_state_tax, ytd_social_security, ytd_medicare)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(uuid(), runId, s.employeeId, s.hours, s.hoursOvertime || 0, s.grossPay, s.federalTax, s.stateTax, s.ss, s.medicare, s.netPay, s.ytdGross, s.ytdTaxes, s.ytdNet, s.preTaxDeductions || 0, s.postTaxDeductions || 0, s.deductionDetail || '{}', checkNumber, ytdFederal, ytdState, ytdSS, ytdMedicare);
      }

      // 5. Re-post journal entry with updated totals
      const totalFederalTax = stubs.reduce((sum: number, s: any) => sum + (s.federalTax || 0), 0);
      const totalStateTax = stubs.reduce((sum: number, s: any) => sum + (s.stateTax || 0), 0);
      const totalSS = stubs.reduce((sum: number, s: any) => sum + (s.ss || 0), 0);
      const totalMedicare = stubs.reduce((sum: number, s: any) => sum + (s.medicare || 0), 0);

      postJournalEntry(dbInstance, companyId, payDate, `Payroll - ${periodStart} to ${periodEnd}`, [
        { nameHint: 'Wages Expense', debit: totalGross, credit: 0, note: 'Gross wages (edited)' },
        { nameHint: 'Wages Payable', debit: 0, credit: totalNet, note: 'Net wages payable' },
        { nameHint: 'Federal Withholding', debit: 0, credit: totalFederalTax, note: 'Federal income tax withheld' },
        { nameHint: 'State Withholding', debit: 0, credit: totalStateTax, note: 'State income tax withheld' },
        { nameHint: 'Social Security Payable', debit: 0, credit: totalSS, note: 'Employee SS withholding' },
        { nameHint: 'Medicare Payable', debit: 0, credit: totalMedicare, note: 'Employee Medicare withholding' },
      ]);
    });
    tx();

    scheduleAutoBackup();

    // Emit event for workflows
    try {
      eventBus.emit({
        type: 'payroll.processed',
        companyId,
        entityType: 'payroll_run',
        entityId: runId,
        data: {
          totalGross,
          totalNet,
          totalTaxes,
          employeeCount: employeeCount || stubs.length,
          periodStart,
          periodEnd,
          payDate,
          edited: true,
        },
      }).catch(() => {});
    } catch { /* fire-and-forget */ }

    return { success: true, runId };
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
      scheduleAutoBackup();
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
        AND date(je.date) >= date(?) AND date(je.date) <= date(?) -- DATE: Item #7 — date() wrap so timestamp values match and end-day is inclusive.
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
        AND date(je.date) >= date(?) AND date(je.date) <= date(?) -- DATE: Item #7 — date() wrap so timestamp values match and end-day is inclusive.
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
        AND date(je.date) >= date(?) AND date(je.date) <= date(?) -- DATE: Item #7 — date() wrap so timestamp values match and end-day is inclusive.
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
          WHERE jel.account_id = a.id AND je.company_id = ? AND je.is_posted = 1 AND date(je.date) <= date(?) /* DATE: Item #7 — wrap for inclusive end-of-day */
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
      WHERE je.company_id = ? AND je.is_posted = 1 AND date(je.date) <= date(?) /* DATE: Item #7 — wrap for inclusive end-of-day */
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
        COALESCE(SUM(CASE WHEN date(je.date) >= date(?) /* DATE: Item #7 — wrap for inclusive start-of-day */ THEN jel.debit ELSE 0 END), 0) as period_debit,
        COALESCE(SUM(CASE WHEN date(je.date) >= date(?) /* DATE: Item #7 — wrap for inclusive start-of-day */ THEN jel.credit ELSE 0 END), 0) as period_credit,
        COALESCE(SUM(jel.debit), 0) as total_debit,
        COALESCE(SUM(jel.credit), 0) as total_credit,
        COALESCE(a.balance, 0) as opening_balance
      FROM accounts a
      LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
      LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
        AND je.company_id = ? AND je.is_posted = 1 AND date(je.date) <= date(?) /* DATE: Item #7 — wrap for inclusive end-of-day */
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
        -- DATE: Item #7 — date() wrap on both sides so end-of-period is inclusive.
        AND date(je.date) >= date(?) AND date(je.date) <= date(?)
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
        -- DATE: Item #6 — date() wraps both column and parameters so a stored
        -- timestamp ('2026-04-15 14:30:00') still matches a date-only filter,
        -- and end-of-period bounds are inclusive of the full day.
        LEFT JOIN expenses e ON e.vendor_id = v.id AND e.company_id = ? AND date(e.date) BETWEEN date(?) AND date(?)
        WHERE v.company_id = ?
        GROUP BY v.id, v.name
        HAVING total_spend > 0
        ORDER BY total_spend DESC
      `).all(companyId, startDate, endDate, companyId);
    } catch (err: any) {
      return [];
    }
  });

  // ─── P4.37: Customer Profitability Ranking ──────────────
  // Per-client revenue (paid invoice amounts in window) minus
  // direct costs (expenses tagged to that client_id) =
  // estimated profit. Sorted descending. Used to identify
  // "which clients are actually making us money."
  ipcMain.handle('reports:customer-profitability', (_event, { startDate, endDate, limit }: { startDate: string; endDate: string; limit?: number }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    const dbInstance = db.getDb();

    const clients = dbInstance.prepare(`
      SELECT c.id, c.name, c.email,
        COALESCE(SUM(CASE WHEN i.issue_date BETWEEN ? AND ? THEN i.amount_paid ELSE 0 END), 0) AS revenue,
        COALESCE(SUM(CASE WHEN i.issue_date BETWEEN ? AND ? THEN (i.total - i.amount_paid) ELSE 0 END), 0) AS unpaid,
        COUNT(CASE WHEN i.issue_date BETWEEN ? AND ? THEN i.id END) AS invoice_count
      FROM clients c
      LEFT JOIN invoices i ON i.client_id = c.id AND i.company_id = c.company_id
      WHERE c.company_id = ?
        AND COALESCE(c.deleted_at, '') = ''
      GROUP BY c.id, c.name, c.email
    `).all(startDate, endDate, startDate, endDate, startDate, endDate, companyId) as any[];

    // Pull expenses-by-client from the expenses table. Some tenants
    // tag client_id directly; others put it in custom fields.
    const clientExpenses = dbInstance.prepare(`
      SELECT client_id, COALESCE(SUM(amount), 0) AS expense_total
      FROM expenses
      WHERE company_id = ?
        AND date BETWEEN ? AND ?
        AND COALESCE(deleted_at, '') = ''
        AND client_id IS NOT NULL
      GROUP BY client_id
    `).all(companyId, startDate, endDate) as any[];

    const expenseMap = new Map<string, number>();
    for (const e of clientExpenses) expenseMap.set(e.client_id, Number(e.expense_total) || 0);

    const ranked = clients
      .map((c) => {
        const revenue = Number(c.revenue) || 0;
        const expenses = expenseMap.get(c.id) || 0;
        const profit = revenue - expenses;
        const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
        return {
          client_id: c.id,
          client_name: c.name,
          client_email: c.email,
          invoice_count: c.invoice_count || 0,
          revenue,
          expenses,
          profit,
          margin_pct: Math.round(margin * 10) / 10,
          unpaid: Number(c.unpaid) || 0,
        };
      })
      .filter((r) => r.invoice_count > 0 || r.expenses > 0)
      .sort((a, b) => b.profit - a.profit);

    const cap = Math.max(1, limit || 50);
    const top = ranked.slice(0, cap);

    const totals = {
      revenue: ranked.reduce((s, r) => s + r.revenue, 0),
      expenses: ranked.reduce((s, r) => s + r.expenses, 0),
      profit: ranked.reduce((s, r) => s + r.profit, 0),
      unpaid: ranked.reduce((s, r) => s + r.unpaid, 0),
      client_count: ranked.length,
    };

    return { startDate, endDate, ranked: top, totals };
  });

  // ─── P4.35: Cash Flow FORECAST (forward-looking) ────────
  // Existing reports:cash-flow is historical. This forecasts the
  // next N days using:
  //   • Open invoices' (total - amount_paid) as inflows on due_date
  //   • Open bills'    (total - amount_paid) as outflows on due_date
  //   • Recurring invoice/bill templates within the window
  //   • Optional: scheduled payroll runs as outflows
  // Returns daily projections + running balance starting from the
  // current bank-account aggregate.
  ipcMain.handle('reports:cash-flow-forecast', (_event, { days }: { days?: number }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    const dbInstance = db.getDb();
    const horizon = Math.max(1, Math.min(365, days || 90));

    // Starting bank balance: sum of asset accounts of type='asset' subtype='bank'.
    // Falls back to all asset accounts' balances if none flagged.
    let startingBalance = 0;
    try {
      const row = dbInstance.prepare(`
        SELECT COALESCE(SUM(balance), 0) AS bal
        FROM accounts
        WHERE company_id = ? AND type = 'asset'
          AND COALESCE(deleted_at, '') = ''
      `).get(companyId) as any;
      startingBalance = Number(row?.bal) || 0;
    } catch { /* skip */ }

    const today = new Date().toISOString().slice(0, 10);
    const horizonDate = new Date(Date.now() + horizon * 86_400_000).toISOString().slice(0, 10);

    // Inflows: open invoices due in the horizon
    const inflows = dbInstance.prepare(`
      SELECT due_date AS date, (total - amount_paid) AS amount, invoice_number AS reference, 'invoice' AS source
      FROM invoices
      WHERE company_id = ?
        AND status NOT IN ('paid', 'voided', 'cancelled')
        AND due_date BETWEEN ? AND ?
        AND (total - amount_paid) > 0
        AND COALESCE(deleted_at, '') = ''
    `).all(companyId, today, horizonDate) as any[];

    // Outflows: open bills due in the horizon
    const outflows = dbInstance.prepare(`
      SELECT due_date AS date, (total - amount_paid) AS amount, bill_number AS reference, 'bill' AS source
      FROM bills
      WHERE company_id = ?
        AND status NOT IN ('paid', 'voided', 'cancelled')
        AND due_date BETWEEN ? AND ?
        AND (total - amount_paid) > 0
        AND COALESCE(deleted_at, '') = ''
    `).all(companyId, today, horizonDate) as any[];

    // Build daily projection: inflow/outflow per day + running balance.
    const dayMap = new Map<string, { inflow: number; outflow: number; entries: any[] }>();
    for (let i = 0; i <= horizon; i++) {
      const d = new Date(Date.now() + i * 86_400_000).toISOString().slice(0, 10);
      dayMap.set(d, { inflow: 0, outflow: 0, entries: [] });
    }
    for (const inv of inflows) {
      const day = dayMap.get(inv.date);
      if (day) {
        day.inflow += Number(inv.amount) || 0;
        day.entries.push({ ...inv, type: 'inflow' });
      }
    }
    for (const bill of outflows) {
      const day = dayMap.get(bill.date);
      if (day) {
        day.outflow += Number(bill.amount) || 0;
        day.entries.push({ ...bill, type: 'outflow' });
      }
    }

    const projection: Array<{ date: string; inflow: number; outflow: number; net: number; balance: number; entries: any[] }> = [];
    let running = startingBalance;
    for (const [date, info] of dayMap) {
      const net = info.inflow - info.outflow;
      running += net;
      projection.push({ date, ...info, net, balance: running });
    }
    projection.sort((a, b) => a.date.localeCompare(b.date));

    const totals = {
      inflow: projection.reduce((s, p) => s + p.inflow, 0),
      outflow: projection.reduce((s, p) => s + p.outflow, 0),
      net: projection.reduce((s, p) => s + p.net, 0),
      startingBalance,
      endingBalance: running,
    };

    // Find the lowest projected balance — the "danger day"
    let lowest = projection[0];
    for (const p of projection) if (p.balance < lowest.balance) lowest = p;

    return {
      horizon,
      startDate: today,
      endDate: horizonDate,
      projection,
      totals,
      lowestBalance: { date: lowest.date, balance: lowest.balance },
    };
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
      WHERE je.company_id = ? AND date(je.date) >= date(?) AND date(je.date) <= date(?) -- DATE: Item #7 — date() wrap so timestamp values match and end-day is inclusive.
        AND a.type IN ('liability') AND a.subtype IN ('long_term_liability','notes_payable','loan')
    `).get(companyId, startDate, endDate) as any;

    // Financing: loan repayments (debits to liability accounts = cash out)
    const loanRepayments = dbInstance.prepare(`
      SELECT COALESCE(SUM(jel.debit), 0) as total
      FROM journal_entry_lines jel
      JOIN journal_entries je ON jel.journal_entry_id = je.id
      JOIN accounts a ON jel.account_id = a.id
      WHERE je.company_id = ? AND date(je.date) >= date(?) AND date(je.date) <= date(?) -- DATE: Item #7 — date() wrap so timestamp values match and end-day is inclusive.
        AND a.type IN ('liability') AND a.subtype IN ('long_term_liability','notes_payable','loan')
    `).get(companyId, startDate, endDate) as any;

    // Financing: owner contributions (credits to equity = cash in)
    const equityContributions = dbInstance.prepare(`
      SELECT COALESCE(SUM(jel.credit), 0) as total
      FROM journal_entry_lines jel
      JOIN journal_entries je ON jel.journal_entry_id = je.id
      JOIN accounts a ON jel.account_id = a.id
      WHERE je.company_id = ? AND date(je.date) >= date(?) AND date(je.date) <= date(?) -- DATE: Item #7 — date() wrap so timestamp values match and end-day is inclusive.
        AND a.type = 'equity' AND a.subtype NOT IN ('retained_earnings','net_income')
    `).get(companyId, startDate, endDate) as any;

    // Financing: owner distributions (debits to equity = cash out)
    const equityDistributions = dbInstance.prepare(`
      SELECT COALESCE(SUM(jel.debit), 0) as total
      FROM journal_entry_lines jel
      JOIN journal_entries je ON jel.journal_entry_id = je.id
      JOIN accounts a ON jel.account_id = a.id
      WHERE je.company_id = ? AND date(je.date) >= date(?) AND date(je.date) <= date(?) -- DATE: Item #7 — date() wrap so timestamp values match and end-day is inclusive.
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

      // INTEGRITY: roundCents prevents float drift across multiple partial pays.
      const newAmountPaid = db.roundCents((bill.amount_paid || 0) + Number(amount));
      let newStatus = bill.status;
      if (newAmountPaid >= db.roundCents(bill.total)) {
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

    const result = payTx();
    // (bill_payment ↔ bill) bidirectional with payment metadata for the timeline.
    try {
      recordRelationBidirectional(
        companyId, 'bill_payment', result.paymentId, 'bill', billId, 'paid',
        { amount, date, payment_method: paymentMethod || 'check', reference: reference || '' },
      );
    } catch (err) {
      console.warn('bills:pay recordRelation failed:', (err as Error)?.message);
    }
    scheduleAutoBackup();
    // Reactive engine: emit bill.paid for workflows.
    try {
      if (companyId && billId) {
        eventBus.emit({
          type: result.newStatus === 'paid' ? 'bill.paid' : 'bill.updated',
          companyId,
          entityType: 'bill',
          entityId: billId,
          data: {
            payment_id: result.paymentId,
            amount,
            date,
            payment_method: paymentMethod || 'check',
            new_status: result.newStatus,
            amount_paid: result.newAmountPaid,
          },
        }).catch(() => {});
      }
    } catch { /* fire-and-forget */ }
    return result;
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
    if (result.changes > 0) scheduleAutoBackup();
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
    scheduleAutoBackup();
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

    const result = convertTx();
    // (bill ↔ purchase_order) bidirectional, relation: 'fulfills'
    try {
      recordRelationBidirectional(
        companyId, 'bill', result.billId, 'purchase_order', poId, 'fulfills',
        { converted_at: new Date().toISOString(), bill_number: result.billNumber },
      );
    } catch (err) {
      console.warn('po:convert-bill recordRelation failed:', (err as Error)?.message);
    }
    scheduleAutoBackup();
    return result;
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

    const cents = (n: number) => Math.round(n * 100) / 100;

    const schedule: any[] = [];
    const cost = asset.purchase_price || 0;
    const salvage = asset.salvage_value || 0;
    const life = asset.useful_life_years || 5;
    const startDate = new Date(asset.purchase_date);
    let bookValue = cost;
    const depreciable = Math.max(0, cost - salvage);
    const method = asset.depreciation_method;

    // CALC: Mid-year purchase / actual-month convention (GAAP). An asset
    // placed in service mid-year takes only a partial year of depreciation
    // in year 1 (months remaining ÷ 12). The unused fraction rolls into
    // year (life+1). E.g. July 1 purchase: year1 = 6/12, year (life+1) = 6/12.
    // This matches the month-by-month accrual in `assets:run-depreciation`.
    const purchaseMonth = isNaN(startDate.getTime()) ? 1 : (startDate.getMonth() + 1);
    const year1Fraction = (13 - purchaseMonth) / 12; // Jan=12/12 (1.0), Dec=1/12
    const totalYears = year1Fraction < 1 ? life + 1 : life;

    for (let year = 1; year <= totalYears; year++) {
      let annualDep = 0;
      const fraction = year === 1
        ? year1Fraction
        : (year === totalYears && totalYears > life ? (1 - year1Fraction) : 1);
      if (method === 'straight_line') {
        annualDep = (depreciable / life) * fraction;
      } else if (method === 'double_declining') {
        // Iterate on declining book value. Switch to straight-line over the
        // remaining life when SL would yield a larger deduction (standard
        // DDB-with-crossover convention used by IRS Pub 946 examples).
        const rate = 2 / life;
        const ddbDep = (bookValue - salvage) * rate;
        const remainingYears = Math.max(1, life - Math.min(year, life) + 1);
        const slDep = (bookValue - salvage) / remainingYears;
        annualDep = Math.max(ddbDep, slDep) * fraction;
      } else if (method === 'sum_of_years_digits') {
        const idx = Math.min(year, life);
        const remaining = life - idx + 1;
        const sumYears = (life * (life + 1)) / 2;
        annualDep = (remaining / sumYears) * depreciable * fraction;
      }

      // Salvage floor — never deduct more than the gap to salvage.
      annualDep = Math.max(0, Math.min(annualDep, bookValue - salvage));
      annualDep = cents(annualDep);

      // Last period absorbs rounding drift so the schedule closes exactly
      // on (cost - salvage). Without this 0.01-cent crumbs accumulate and
      // the final book value drifts off salvage by a few cents.
      if (year === totalYears) {
        const accumSoFar = schedule.reduce((s, e) => s + e.depreciation_amount, 0);
        annualDep = cents(depreciable - accumSoFar);
        if (annualDep < 0) annualDep = 0;
      }

      bookValue = cents(bookValue - annualDep);
      if (bookValue < salvage) bookValue = salvage;

      const d = new Date(startDate);
      d.setFullYear(d.getFullYear() + year);
      schedule.push({
        year,
        period: d.toISOString().slice(0, 10),
        period_label: `Year ${year}`,
        depreciation_amount: annualDep,
        accumulated: cents(cost - bookValue),
        accumulated_depreciation: cents(cost - bookValue),
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
    if (processed > 0) scheduleAutoBackup();
    // Reactive engine: emit asset.depreciated when at least one asset was depreciated.
    try {
      if (companyId && processed > 0) {
        eventBus.emit({
          type: 'asset.depreciated',
          companyId,
          entityType: 'fixed_assets',
          entityId: '',
          data: { processed, period_date: periodDate },
        }).catch(() => {});
      }
    } catch { /* fire-and-forget */ }
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
    if (applied > 0) scheduleAutoBackup();
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
    const result = applyTx();
    scheduleAutoBackup();
    return result;
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

  // ─── Tax System: IPC Handlers ──────────────────────────────

  ipcMain.handle('tax:get-utah-config', (_event, { year }: { year: number }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    const dbInstance = db.getDb();
    return dbInstance.prepare(
      'SELECT * FROM utah_withholding_config WHERE company_id = ? AND tax_year = ?'
    ).get(companyId, year) ?? null;
  });

  ipcMain.handle('tax:save-utah-config', (_event, { year, config }: { year: number; config: Record<string, any> }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { error: 'No active company' };
    const dbInstance = db.getDb();
    const existing = dbInstance.prepare(
      'SELECT id FROM utah_withholding_config WHERE company_id = ? AND tax_year = ?'
    ).get(companyId, year) as any;

    const flat_rate = config.flat_rate ?? 0.0455;
    const personal_exemption_credit = config.personal_exemption_credit ?? 393;
    const sui_rate = config.sui_rate ?? 0.012;
    const sui_wage_base = config.sui_wage_base ?? 44800;
    const wc_rate = config.wc_rate ?? 0.008;
    const wc_class_code = config.wc_class_code ?? '8810';
    const wc_carrier = config.wc_carrier ?? '';

    let id: string;
    if (existing) {
      id = existing.id;
      dbInstance.prepare(`
        UPDATE utah_withholding_config
        SET flat_rate = ?, personal_exemption_credit = ?, sui_rate = ?, sui_wage_base = ?,
            wc_rate = ?, wc_class_code = ?, wc_carrier = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(flat_rate, personal_exemption_credit, sui_rate, sui_wage_base, wc_rate, wc_class_code, wc_carrier, id);
    } else {
      id = uuid();
      dbInstance.prepare(`
        INSERT INTO utah_withholding_config (id, company_id, tax_year, flat_rate, personal_exemption_credit, sui_rate, sui_wage_base, wc_rate, wc_class_code, wc_carrier)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, companyId, year, flat_rate, personal_exemption_credit, sui_rate, sui_wage_base, wc_rate, wc_class_code, wc_carrier);
    }
    scheduleAutoBackup();
    return { success: true, id };
  });

  ipcMain.handle('tax:get-filing-summary', (_event, { year, quarter }: { year: number; quarter?: number }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return [];
    const dbInstance = db.getDb();

    const quarters = quarter ? [quarter] : [1, 2, 3, 4];
    const results: any[] = [];

    for (const q of quarters) {
      const startMonth = (q - 1) * 3 + 1;
      const endMonth = q * 3;
      const startDate = `${year}-${String(startMonth).padStart(2, '0')}-01`;
      const endDay = new Date(year, endMonth, 0).getDate();
      const endDate = `${year}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;

      const agg = dbInstance.prepare(`
        SELECT
          COUNT(DISTINCT ps.employee_id) as employee_count,
          COALESCE(SUM(ps.gross_pay), 0) as total_gross,
          COALESCE(SUM(ps.federal_tax), 0) as total_federal,
          COALESCE(SUM(ps.state_tax), 0) as total_state,
          COALESCE(SUM(ps.social_security), 0) as total_ss,
          COALESCE(SUM(ps.medicare), 0) as total_medicare
        FROM pay_stubs ps
        JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
        WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?
      `).get(companyId, startDate, endDate) as any;

      const filing941 = dbInstance.prepare(
        "SELECT * FROM tax_filing_periods WHERE company_id = ? AND tax_year = ? AND quarter = ? AND form_type = '941'"
      ).get(companyId, year, q) as any;

      const filingTC941 = dbInstance.prepare(
        "SELECT * FROM tax_filing_periods WHERE company_id = ? AND tax_year = ? AND quarter = ? AND form_type IN ('tc-941', 'TC-941')"
      ).get(companyId, year, q) as any;

      const ss_ee = db.roundCents(agg.total_ss);
      const ss_er = db.roundCents(agg.total_ss);
      const med_ee = db.roundCents(agg.total_medicare);
      const med_er = db.roundCents(agg.total_medicare);
      const fed_wh = db.roundCents(agg.total_federal);
      const liability_941 = db.roundCents(fed_wh + ss_ee + ss_er + med_ee + med_er);

      // Compute due dates
      const dueDates: Record<number, string> = {
        1: `${year}-04-30`, 2: `${year}-07-31`, 3: `${year}-10-31`, 4: `${year + 1}-01-31`,
      };

      // Deposits from filing records
      const deposits941 = filing941?.amount_paid ?? 0;
      const depositsTC941 = filingTC941?.amount_paid ?? 0;

      results.push({
        quarter: q,
        period_start: startDate,
        period_end: endDate,
        due_date: dueDates[q] || '',
        wages: db.roundCents(agg.total_gross),
        federal_wh: fed_wh,
        ss_ee,
        ss_er,
        medicare_ee: med_ee,
        medicare_er: med_er,
        total_liability: liability_941,
        deposits_made: db.roundCents(deposits941),
        balance_due: db.roundCents(liability_941 - deposits941),
        status_941: filing941?.status ?? 'not_filed',
        status_tc941: filingTC941?.status ?? 'not_filed',
        state_wages: db.roundCents(agg.total_gross),
        state_wh: db.roundCents(agg.total_state),
        state_deposits: db.roundCents(depositsTC941),
        state_balance_due: db.roundCents(agg.total_state - depositsTC941),
        employee_count: agg.employee_count,
      });
    }
    return results;
  });

  ipcMain.handle('tax:record-filing', (_event, { form_type, year, quarter, filed_date, confirmation_number, amount_paid, payment_date, notes }: {
    form_type: string; year: number; quarter: number; filed_date?: string; confirmation_number?: string; amount_paid?: number; payment_date?: string; notes?: string;
  }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { error: 'No active company' };
    const dbInstance = db.getDb();

    const existing = dbInstance.prepare(
      'SELECT id, amount_paid FROM tax_filing_periods WHERE company_id = ? AND tax_year = ? AND quarter = ? AND form_type = ?'
    ).get(companyId, year, quarter, form_type) as any;

    let id: string;
    if (existing) {
      id = existing.id;
      const newAmountPaid = db.roundCents((existing.amount_paid || 0) + (amount_paid || 0));
      dbInstance.prepare(`
        UPDATE tax_filing_periods
        SET status = 'filed', filed_date = COALESCE(?, filed_date), confirmation_number = COALESCE(?, confirmation_number),
            amount_paid = ?, payment_date = COALESCE(?, payment_date), notes = COALESCE(?, notes), updated_at = datetime('now')
        WHERE id = ?
      `).run(filed_date || null, confirmation_number || null, newAmountPaid, payment_date || null, notes || null, id);
    } else {
      id = uuid();
      dbInstance.prepare(`
        INSERT INTO tax_filing_periods (id, company_id, tax_year, quarter, form_type, status, filed_date, confirmation_number, amount_paid, payment_date, notes)
        VALUES (?, ?, ?, ?, ?, 'filed', ?, ?, ?, ?, ?)
      `).run(id, companyId, year, quarter, form_type, filed_date || '', confirmation_number || '', db.roundCents(amount_paid || 0), payment_date || '', notes || '');
    }
    scheduleAutoBackup();
    return { success: true, id };
  });

  ipcMain.handle('tax:get-w2-data', (_event, { year, employee_id }: { year: number; employee_id?: string }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return [];
    const dbInstance = db.getDb();

    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    let sql = `
      SELECT
        e.id as employee_id,
        e.name,
        e.ssn,
        e.ssn_last4,
        e.address_line1,
        e.address_line2,
        e.city,
        e.state,
        e.zip,
        COALESCE(SUM(ps.gross_pay), 0) as box1,
        COALESCE(SUM(ps.federal_tax), 0) as box2,
        COALESCE(SUM(ps.gross_pay), 0) as box3,
        COALESCE(SUM(ps.social_security), 0) as box4,
        COALESCE(SUM(ps.gross_pay), 0) as box5,
        COALESCE(SUM(ps.medicare), 0) as box6,
        COALESCE(SUM(ps.gross_pay), 0) as box16,
        COALESCE(SUM(ps.state_tax), 0) as box17
      FROM pay_stubs ps
      JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
      JOIN employees e ON ps.employee_id = e.id
      WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?
    `;
    const params: any[] = [companyId, startDate, endDate];

    if (employee_id) {
      sql += ' AND ps.employee_id = ?';
      params.push(employee_id);
    }

    sql += ' GROUP BY ps.employee_id ORDER BY e.name';

    const rows = dbInstance.prepare(sql).all(...params) as any[];
    return rows.map((r: any) => ({
      employee_id: r.employee_id,
      employee_name: r.name || 'Unknown',
      ssn: r.ssn || '',
      ssn_last4: r.ssn_last4 || '',
      address_line1: r.address_line1 || '',
      address_line2: r.address_line2 || '',
      city: r.city || '',
      state: r.state || '',
      zip: r.zip || '',
      gross_wages: db.roundCents(r.box1),
      federal_wh: db.roundCents(r.box2),
      ss_wages: db.roundCents(r.box3),
      ss_tax: db.roundCents(r.box4),
      medicare_wages: db.roundCents(r.box5),
      medicare_tax: db.roundCents(r.box6),
      state_wages: db.roundCents(r.box16),
      state_wh: db.roundCents(r.box17),
    }));
  });

  ipcMain.handle('tax:get-w3-data', (_event, { year }: { year: number }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    const dbInstance = db.getDb();

    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    const row = dbInstance.prepare(`
      SELECT
        COUNT(DISTINCT ps.employee_id) as employee_count,
        COALESCE(SUM(ps.gross_pay), 0) as box1,
        COALESCE(SUM(ps.federal_tax), 0) as box2,
        COALESCE(SUM(ps.gross_pay), 0) as box3,
        COALESCE(SUM(ps.social_security), 0) as box4,
        COALESCE(SUM(ps.gross_pay), 0) as box5,
        COALESCE(SUM(ps.medicare), 0) as box6,
        COALESCE(SUM(ps.gross_pay), 0) as box16,
        COALESCE(SUM(ps.state_tax), 0) as box17
      FROM pay_stubs ps
      JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
      WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?
    `).get(companyId, startDate, endDate) as any;

    if (!row) return null;
    return {
      total_employees: row.employee_count,
      total_wages: db.roundCents(row.box1),
      total_federal_wh: db.roundCents(row.box2),
      total_ss_wages: db.roundCents(row.box3),
      total_ss_tax: db.roundCents(row.box4),
      total_medicare_wages: db.roundCents(row.box5),
      total_medicare_tax: db.roundCents(row.box6),
      total_state_wages: db.roundCents(row.box16),
      total_state_wh: db.roundCents(row.box17),
    };
  });

  ipcMain.handle('tax:dashboard-summary', (_event, { year }: { year: number }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    const dbInstance = db.getDb();

    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;
    const pyStart = `${year - 1}-01-01`;
    const pyEnd = `${year - 1}-12-31`;

    // YTD totals
    const ytd = dbInstance.prepare(`
      SELECT
        COALESCE(SUM(ps.gross_pay), 0) as total_gross,
        COALESCE(SUM(ps.federal_tax), 0) as total_federal,
        COALESCE(SUM(ps.state_tax), 0) as total_state,
        COALESCE(SUM(ps.social_security), 0) as total_ss,
        COALESCE(SUM(ps.medicare), 0) as total_medicare
      FROM pay_stubs ps
      JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
      WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?
    `).get(companyId, startDate, endDate) as any;

    // Prior year payroll total
    const py = dbInstance.prepare(`
      SELECT COALESCE(SUM(ps.gross_pay), 0) as total_gross
      FROM pay_stubs ps
      JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
      WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?
    `).get(companyId, pyStart, pyEnd) as any;

    // Filing periods for this year
    const filings = dbInstance.prepare(
      'SELECT * FROM tax_filing_periods WHERE company_id = ? AND tax_year = ? ORDER BY quarter, form_type'
    ).all(companyId, year) as any[];

    // Per-quarter breakdown
    const quarters: any[] = [];
    for (let q = 1; q <= 4; q++) {
      const sm = (q - 1) * 3 + 1;
      const em = q * 3;
      const qs = `${year}-${String(sm).padStart(2, '0')}-01`;
      const ed = new Date(year, em, 0).getDate();
      const qe = `${year}-${String(em).padStart(2, '0')}-${String(ed).padStart(2, '0')}`;

      const qa = dbInstance.prepare(`
        SELECT
          COALESCE(SUM(ps.federal_tax), 0) as federal,
          COALESCE(SUM(ps.state_tax), 0) as state,
          COALESCE(SUM(ps.social_security), 0) as ss,
          COALESCE(SUM(ps.medicare), 0) as medicare
        FROM pay_stubs ps
        JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
        WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?
      `).get(companyId, qs, qe) as any;

      quarters.push({
        quarter: q,
        federal: db.roundCents(qa.federal),
        state: db.roundCents(qa.state),
        fica: db.roundCents(qa.ss * 2 + qa.medicare * 2),
      });
    }

    return {
      ytd_payroll: db.roundCents(ytd.total_gross),
      ytd_federal: db.roundCents(ytd.total_federal),
      ytd_state: db.roundCents(ytd.total_state),
      ytd_fica: db.roundCents(ytd.total_ss * 2 + ytd.total_medicare * 2),
      py_payroll: db.roundCents(py.total_gross),
      filings,
      quarters,
    };
  });

  ipcMain.handle('tax:liability-report', (_event, { year, quarter_start, quarter_end }: { year: number; quarter_start: number; quarter_end: number }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    const dbInstance = db.getDb();

    const startMonth = (quarter_start - 1) * 3 + 1;
    const endMonth = quarter_end * 3;
    const periodStart = `${year}-${String(startMonth).padStart(2, '0')}-01`;
    const endDay = new Date(year, endMonth, 0).getDate();
    const periodEnd = `${year}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
    const ytdStart = `${year}-01-01`;

    const aggregateSql = `
      SELECT
        COALESCE(SUM(ps.gross_pay), 0) as wages,
        COALESCE(SUM(ps.federal_tax), 0) as federal_wh,
        COALESCE(SUM(ps.social_security), 0) as ss_ee,
        COALESCE(SUM(ps.medicare), 0) as med_ee,
        COALESCE(SUM(ps.state_tax), 0) as state_wh
      FROM pay_stubs ps
      JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
      WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?
    `;

    const period = dbInstance.prepare(aggregateSql).get(companyId, periodStart, periodEnd) as any;
    const ytdRow = dbInstance.prepare(aggregateSql).get(companyId, ytdStart, periodEnd) as any;

    return {
      period: {
        wages: db.roundCents(period.wages),
        federal_wh: db.roundCents(period.federal_wh),
        ss_ee: db.roundCents(period.ss_ee),
        med_ee: db.roundCents(period.med_ee),
        state_wh: db.roundCents(period.state_wh),
      },
      ytd: {
        wages: db.roundCents(ytdRow.wages),
        federal_wh: db.roundCents(ytdRow.federal_wh),
        ss_ee: db.roundCents(ytdRow.ss_ee),
        med_ee: db.roundCents(ytdRow.med_ee),
        state_wh: db.roundCents(ytdRow.state_wh),
      },
      periodStart,
      periodEnd,
    };
  });

  ipcMain.handle('tax:employee-tax-summary', (_event, { year, employee_id }: { year: number; employee_id?: string }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return [];
    const dbInstance = db.getDb();

    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    let sql = `
      SELECT
        e.id as employee_id,
        e.name,
        e.w4_filing_status,
        e.w4_step2_checkbox,
        e.w4_step3_dependent_credit,
        COALESCE(SUM(ps.gross_pay), 0) as gross,
        COALESCE(SUM(ps.federal_tax), 0) as federal,
        COALESCE(SUM(ps.social_security), 0) as ss,
        COALESCE(SUM(ps.medicare), 0) as medicare,
        COALESCE(SUM(ps.state_tax), 0) as state,
        COALESCE(SUM(ps.net_pay), 0) as net
      FROM pay_stubs ps
      JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
      JOIN employees e ON ps.employee_id = e.id
      WHERE pr.company_id = ? AND pr.pay_date >= ? AND pr.pay_date <= ?
    `;
    const params: any[] = [companyId, startDate, endDate];

    if (employee_id) {
      sql += ' AND ps.employee_id = ?';
      params.push(employee_id);
    }

    sql += ' GROUP BY ps.employee_id ORDER BY e.name';

    const rows = dbInstance.prepare(sql).all(...params) as any[];
    return rows.map((r: any) => ({
      employee_id: r.employee_id,
      employee_name: r.name || 'Unknown',
      gross_wages: db.roundCents(r.gross),
      federal_wh: db.roundCents(r.federal),
      ss_tax: db.roundCents(r.ss),
      medicare_tax: db.roundCents(r.medicare),
      state_wh: db.roundCents(r.state),
      total_tax: db.roundCents((r.federal ?? 0) + (r.ss ?? 0) + (r.medicare ?? 0) + (r.state ?? 0)),
      w4_filing_status: r.w4_filing_status || null,
      w4_step2_checkbox: r.w4_step2_checkbox || 0,
      w4_step3_dependent_credit: r.w4_step3_dependent_credit || 0,
    }));
  });

  ipcMain.handle('tax:calc-payroll', (_event, { grossPay, payFrequency, w4, utah, ytdGross }: any) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    return calculateFullPayroll(grossPay, payFrequency, w4, utah, ytdGross, companyId, 2026);
  });

  // ─── Categories: Seed Defaults ───────────────────────────
  ipcMain.handle('categories:seed-defaults', (_event, { company_id }: { company_id: string }) => {
    return seedDefaultCategories(company_id);
  });

  // ─── Industry Presets: Apply ─────────────────────────────
  // Applies a full industry preset to a company in a single transaction.
  // Idempotent — re-applying never duplicates existing rows (matches by name/key).
  // The preset payload itself comes from the renderer (so we don't have to bundle
  // duplicate data in main); accountSeeds is the COA template's accounts list.
  ipcMain.handle('industry:apply-preset', (_event, payload: {
    companyId: string;
    presetKey: string;
    preset: any;
    accountSeeds?: Array<{ code: string; name: string; type: string; subtype?: string }>;
  }) => {
    const { companyId, presetKey, preset, accountSeeds = [] } = payload || {} as any;
    if (!companyId || !preset) return { error: 'companyId and preset are required' };

    const dbInstance = db.getDb();
    const summary = {
      categoriesAdded: 0, categoriesSkipped: 0,
      vendorsAdded: 0, vendorsSkipped: 0,
      fieldsAdded: 0, fieldsSkipped: 0,
      accountsAdded: 0, accountsSkipped: 0,
      hintsAdded: 0,
    };

    try {
      const apply = dbInstance.transaction(() => {
        // 1) Accounts (from CoA template)
        const acctExisting = dbInstance.prepare('SELECT code FROM accounts WHERE company_id = ?').all(companyId) as Array<{ code: string }>;
        const acctSet = new Set(acctExisting.map((a) => a.code));
        const insertAcct = dbInstance.prepare(
          `INSERT OR IGNORE INTO accounts (id, company_id, code, name, type, subtype, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)`
        );
        for (const a of accountSeeds) {
          if (acctSet.has(a.code)) { summary.accountsSkipped++; continue; }
          insertAcct.run(uuid(), companyId, a.code, a.name, a.type, a.subtype || '');
          summary.accountsAdded++;
        }

        // 2) Categories — schema CHECK only allows income/expense, so 'cogs' maps to expense
        const catExisting = dbInstance.prepare('SELECT name FROM categories WHERE company_id = ?').all(companyId) as Array<{ name: string }>;
        const catSet = new Set(catExisting.map((c) => c.name.toLowerCase()));
        const insertCat = dbInstance.prepare(
          `INSERT OR IGNORE INTO categories (id, company_id, name, type, color, description, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)`
        );
        for (const c of (preset.defaultCategories || [])) {
          if (catSet.has(String(c.name).toLowerCase())) { summary.categoriesSkipped++; continue; }
          const dbType = c.type === 'income' ? 'income' : 'expense';
          insertCat.run(uuid(), companyId, c.name, dbType, c.color || '#6b7280', c.description || '');
          summary.categoriesAdded++;
        }

        // 3) Vendors
        const venExisting = dbInstance.prepare('SELECT name FROM vendors WHERE company_id = ?').all(companyId) as Array<{ name: string }>;
        const venSet = new Set(venExisting.map((v) => v.name.toLowerCase()));
        const insertVen = dbInstance.prepare(
          `INSERT OR IGNORE INTO vendors (id, company_id, name, notes, status) VALUES (?, ?, ?, ?, 'active')`
        );
        for (const v of (preset.defaultVendors || [])) {
          if (venSet.has(String(v.name).toLowerCase())) { summary.vendorsSkipped++; continue; }
          insertVen.run(uuid(), companyId, v.name, v.notes || `Type: ${v.type || 'general'}`);
          summary.vendorsAdded++;
        }

        // 4) Custom field defs (idempotent via UNIQUE(company_id, entity_type, field_name))
        const insertField = dbInstance.prepare(
          `INSERT OR IGNORE INTO custom_field_defs (id, company_id, entity_type, field_name, field_label, field_type, options, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        );
        let fieldOrder = 0;
        for (const f of (preset.industrySpecificFields || [])) {
          const before = (dbInstance.prepare('SELECT COUNT(*) as cnt FROM custom_field_defs WHERE company_id = ? AND entity_type = ? AND field_name = ?').get(companyId, f.entity_type, f.key) as any).cnt;
          if (before > 0) { summary.fieldsSkipped++; continue; }
          insertField.run(uuid(), companyId, f.entity_type, f.key, f.label, f.field_type, JSON.stringify(f.options || []), fieldOrder++);
          summary.fieldsAdded++;
        }

        // 5) Persist the active preset key + invoice settings + setup hints (as settings rows)
        const upsertSetting = dbInstance.prepare(
          `INSERT INTO settings (id, company_id, key, value, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
           ON CONFLICT(company_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
        );
        upsertSetting.run(uuid(), companyId, 'industry_preset_key', presetKey);
        upsertSetting.run(uuid(), companyId, 'industry_preset_applied_at', new Date().toISOString());

        if (preset.setupHints && Array.isArray(preset.setupHints)) {
          upsertSetting.run(uuid(), companyId, 'industry_setup_hints', JSON.stringify(preset.setupHints));
          summary.hintsAdded = preset.setupHints.length;
        }
        if (preset.dashboardWidgets && Array.isArray(preset.dashboardWidgets)) {
          upsertSetting.run(uuid(), companyId, 'industry_dashboard_widgets', JSON.stringify(preset.dashboardWidgets));
        }

        // 6) Invoice settings (merge into existing row or create one)
        const inv = preset.invoiceSettings || {};
        const invKeys = Object.keys(inv).filter((k) => inv[k] !== undefined && inv[k] !== null && inv[k] !== '');
        if (invKeys.length > 0) {
          const existing = dbInstance.prepare('SELECT id FROM invoice_settings WHERE company_id = ?').get(companyId) as any;
          if (existing) {
            const sets = invKeys.map((k) => `${k} = ?`).join(', ');
            dbInstance.prepare(`UPDATE invoice_settings SET ${sets}, updated_at = datetime('now') WHERE id = ?`)
              .run(...invKeys.map((k) => inv[k]), existing.id);
          } else {
            const cols = ['id', 'company_id', ...invKeys];
            const vals = [uuid(), companyId, ...invKeys.map((k) => inv[k])];
            dbInstance.prepare(`INSERT INTO invoice_settings (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...vals);
          }
        }

        // 7) Stamp company.industry
        dbInstance.prepare(`UPDATE companies SET industry = ?, updated_at = datetime('now') WHERE id = ?`).run(presetKey, companyId);
      });
      apply();

      try { db.logAudit(companyId, 'companies', companyId, 'industry-preset-applied'); } catch { /* audit best-effort */ }
      return { success: true, summary };
    } catch (err) {
      console.error('industry:apply-preset failed:', err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Returns a snapshot of existing rows so the renderer can compute a diff
  // before applying a preset (additive, never destructive).
  ipcMain.handle('industry:get-existing', (_event, { companyId }: { companyId: string }) => {
    if (!companyId) return null;
    const dbInstance = db.getDb();
    const categoryNames = (dbInstance.prepare('SELECT name FROM categories WHERE company_id = ?').all(companyId) as Array<{ name: string }>).map((r) => r.name);
    const vendorNames = (dbInstance.prepare('SELECT name FROM vendors WHERE company_id = ?').all(companyId) as Array<{ name: string }>).map((r) => r.name);
    const fields = (dbInstance.prepare('SELECT entity_type, field_name FROM custom_field_defs WHERE company_id = ?').all(companyId) as Array<{ entity_type: string; field_name: string }>).map((r) => `${r.entity_type}:${r.field_name}`);
    const accountCodes = (dbInstance.prepare('SELECT code FROM accounts WHERE company_id = ?').all(companyId) as Array<{ code: string }>).map((r) => r.code);
    return { categoryNames, vendorNames, fields, accountCodes };
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

        const item = rawDb.prepare(`SELECT quantity, reorder_point FROM inventory_items WHERE id = ?`).get(itemId) as any;
        return { ok: true, newQuantity: item?.quantity ?? 0, reorderPoint: item?.reorder_point ?? 0 };
      });
      const r = adjust();
      // Reactive engine: emit inventory.received / low_stock / out_of_stock.
      try {
        if (companyId && itemId) {
          if (type !== 'out') {
            eventBus.emit({
              type: 'inventory.received',
              companyId,
              entityType: 'inventory_item',
              entityId: itemId,
              data: { quantity, unit_cost: unitCost || 0, reference: reference || '', new_quantity: r.newQuantity },
            }).catch(() => {});
          }
          if (r.newQuantity <= 0) {
            eventBus.emit({
              type: 'inventory.out_of_stock',
              companyId,
              entityType: 'inventory_item',
              entityId: itemId,
              data: { new_quantity: r.newQuantity },
            }).catch(() => {});
          } else if ((r as any).reorderPoint > 0 && r.newQuantity <= (r as any).reorderPoint) {
            eventBus.emit({
              type: 'inventory.low_stock',
              companyId,
              entityType: 'inventory_item',
              entityId: itemId,
              data: { new_quantity: r.newQuantity, reorder_point: (r as any).reorderPoint },
            }).catch(() => {});
          }
        }
      } catch { /* fire-and-forget */ }
      return r;
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
            // CALC: A = P*(1 + r/n)^(n*t). compound_frequency = n
            // (1=annual, 4=quarterly, 12=monthly, 365=daily). Daily compound
            // = (1 + r/365)^(365*t), which is the exact form (not e^rt).
            const nRaw = Number(d.compound_frequency);
            const n = Number.isFinite(nRaw) && nRaw > 0 ? nRaw : 12;
            interest = d.original_amount * Math.pow(1 + d.interest_rate / n, n * years) - d.original_amount;
          } else {
            // CALC: simple interest I = P*r*t.
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
      const today = localToday();
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
    // TZ-safe daysOverdue: anchor YYYY-MM-DD at noon local time so UTC parsing
    // can't shift the calendar day on negative-offset machines.
    const dlqRaw = debt.delinquent_date ? String(debt.delinquent_date) : '';
    const dlqStr = /^\d{4}-\d{2}-\d{2}$/.test(dlqRaw) ? dlqRaw + 'T12:00:00' : dlqRaw;
    const daysOverdue = dlqStr ? Math.max(0, Math.floor((Date.now() - new Date(dlqStr).getTime()) / 86400000)) : 0;
    const demandDeadlineDate = new Date(Date.now() + 10 * 86400000);

    const cityStateZip = [company?.city, company?.state].filter(Boolean).join(', ') + (company?.zip ? ' ' + company.zip : '');
    const companyAddr = [company?.address_line1, company?.address_line2, cityStateZip.trim()]
      .filter((s: any) => s && String(s).trim())
      .join(', ');

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
      // Spec-required jurisdiction tokens (resolved from debt then company; falls back to "________________"
      // so authors using the token in a custom template never see a literal "{{state}}" leak through).
      '{{state}}': escVal(debt.jurisdiction || company?.state || '________________'),
      '{{jurisdiction}}': escVal(debt.jurisdiction || company?.state || '________________'),
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
      .empty { color: #64748b; font-style: italic; padding: 8px 0; }
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
    const dbInstance = db.getDb();
    const rules = dbInstance.prepare('SELECT * FROM debt_automation_rules WHERE company_id = ? AND enabled = 1 AND debt_id IS NULL').all(companyId) as any[];
    let advanced = 0, flagged = 0;
    // Wrap the whole escalation pass in one transaction so a partial failure
    // can't leave a debt with `current_stage` advanced but no matching pipeline-
    // stage row (or vice versa).
    const escalateTx = dbInstance.transaction(() => {
      for (const rule of rules) {
        const debts = dbInstance.prepare(`
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
            const currentDebt = dbInstance.prepare('SELECT current_stage FROM debts WHERE id = ?').get(debt.id) as any;
            const currentIdx = DEBT_STAGE_ORDER.indexOf(currentDebt.current_stage);
            if (currentIdx >= 0 && currentIdx < DEBT_STAGE_ORDER.length - 1) {
              const nextStage = DEBT_STAGE_ORDER[currentIdx + 1];
              dbInstance.prepare('UPDATE debt_pipeline_stages SET exited_at = datetime(\'now\') WHERE debt_id = ? AND stage = ? AND exited_at IS NULL').run(debt.id, currentDebt.current_stage);
              dbInstance.prepare('INSERT INTO debt_pipeline_stages (id, debt_id, stage, auto_advanced) VALUES (?, ?, ?, 1)').run(uuid(), debt.id, nextStage);
              const newStatus = ['legal_action','judgment','garnishment'].includes(nextStage) ? 'legal' : 'in_collection';
              dbInstance.prepare('UPDATE debts SET current_stage = ?, status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(nextStage, newStatus, debt.id);
              advanced++;
            }
          }
        }
      }
    });
    escalateTx();
    return { advanced, flagged };
  });

  ipcMain.handle('debt:analytics', (_event, { companyId, startDate, endDate }: { companyId: string; startDate: string; endDate: string }) => {
    // Collection rate by month
    const collectionByMonth = db.getDb().prepare(`
      SELECT strftime('%Y-%m', dp.received_date) as month, SUM(dp.amount) as total
      FROM debt_payments dp JOIN debts d ON dp.debt_id = d.id
      -- DATE: Item #6 — date() wrap so timestamp values match date-only bounds.
      WHERE d.company_id = ? AND date(dp.received_date) BETWEEN date(?) AND date(?)
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
      const dbInstance = db.getDb();
      // Run the delete+create+installment-inserts in a single transaction so
      // a mid-loop failure can't leave the debt with an old plan deleted but
      // no replacement, or a new plan with only some installments inserted.
      let planId = '';
      const planTx = dbInstance.transaction(() => {
        const existing = db.queryAll('debt_payment_plans', { debt_id })[0];
        if (existing) {
          dbInstance.prepare('DELETE FROM debt_plan_installments WHERE plan_id = ?').run(existing.id);
          db.remove('debt_payment_plans', existing.id);
        }
        const plan = db.create('debt_payment_plans', {
          debt_id, installment_amount, frequency,
          start_date, total_installments: total_installments || 1,
          notes: notes || '', status: 'active'
        });
        planId = plan.id;
        const freqDays: Record<string, number> = { weekly: 7, biweekly: 14, monthly: 30 };
        const days = freqDays[frequency] || 30;
        let d = new Date(start_date + 'T12:00:00');
        // CALC: Standard amortization. Each installment payment is constant
        // (= installment_amount). Per-installment interest = balance * rate
        // per period; principal = payment - interest; new balance = balance
        // - principal. Source: standard mortgage/loan amortization formula
        //   PMT = P * r * (1+r)^n / ((1+r)^n - 1).
        // Without dedicated principal/interest columns we cannot persist the
        // split here, but we DO validate that the chosen installment_amount
        // is at least sufficient to cover first-period interest — otherwise
        // the loan never amortizes. The notes column receives a warning.
        const debtRow = dbInstance.prepare(
          'SELECT balance_due, interest_rate, interest_type FROM debts WHERE id = ?'
        ).get(debt_id) as any;
        const periodsPerYear = frequency === 'weekly' ? 52
          : frequency === 'biweekly' ? 26 : 12;
        const principal = Number(debtRow?.balance_due) || 0;
        const annualRate = Number(debtRow?.interest_rate) || 0;
        const periodRate = annualRate / periodsPerYear;
        const firstInterest = principal * periodRate;
        if (Number(installment_amount) > 0
            && firstInterest > 0
            && Number(installment_amount) < firstInterest) {
          // Negative-amortization warning — installment doesn't even cover
          // interest, balance grows.
          // Stored as part of the plan's notes field for visibility.
          const warn = ` [warning: installment $${Number(installment_amount).toFixed(2)} < first-period interest $${firstInterest.toFixed(2)} — negative amortization]`;
          dbInstance.prepare('UPDATE debt_payment_plans SET notes = COALESCE(notes,\'\') || ? WHERE id = ?')
            .run(warn, plan.id);
        }
        for (let i = 0; i < (total_installments || 1); i++) {
          db.create('debt_plan_installments', {
            plan_id: plan.id,
            due_date: d.toISOString().slice(0, 10),
            amount: installment_amount,
            paid: 0,
          });
          d.setDate(d.getDate() + days);
        }
      });
      planTx();
      logDebtAudit(debt_id, 'plan_created', 'payment_plan', '', installment_amount ? '$' + installment_amount + ' plan' : 'Plan saved');
      scheduleAutoBackup();
      return db.queryAll('debt_plan_installments', { plan_id: planId }, { field: 'due_date', dir: 'asc' });
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('debt:plan-installment-toggle', (_event, { installmentId, paid }) => {
    try {
      db.update('debt_plan_installments', installmentId, {
        paid: paid ? 1 : 0,
        paid_date: paid ? localToday() : '',
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
      if (response === 'accepted') data.accepted_date = localToday();
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
      // CALC: Settlement-accept write-off JE (GAAP — direct write-off method).
      // When a creditor accepts < balance_due, the difference (forgiven
      // portion) is a bad-debt expense. JE: Dr Bad Debt Expense / Cr A/R
      // (or whatever the receivable account is). The collected portion is
      // recognized via the normal payment flow; here we only book the
      // shortfall write-off so the balance closes to zero.
      const dbi = db.getDb();
      const debt = dbi.prepare('SELECT * FROM debts WHERE id = ?').get(debtId) as any;
      const companyId = debt?.company_id || db.getCurrentCompanyId();
      const priorBalance = Number(debt?.balance_due) || 0;
      const writeOff = Math.max(0, Math.round((priorBalance - Number(offer_amount || 0)) * 100) / 100);

      db.update('debt_settlements', settlementId, {
        response: 'accepted',
        accepted_date: localToday(),
      });
      db.update('debts', debtId, { status: 'settled', balance_due: offer_amount });

      if (companyId && writeOff > 0) {
        try {
          postJournalEntry(
            dbi,
            companyId,
            localToday(),
            `Settlement write-off — debt ${debt?.debtor_name || debtId.slice(0, 8)}`,
            [
              { nameHint: 'Bad Debt', debit: writeOff, credit: 0, note: 'Forgiven portion of settled debt' },
              { nameHint: 'Receivable', debit: 0, credit: writeOff, note: `A/R write-off for debt ${debtId.slice(0, 8)}` },
            ]
          );
        } catch (err) {
          console.warn('settlement-accept: write-off JE failed:', (err as Error)?.message);
        }
      }

      logDebtAudit(debtId, 'settlement_accepted', 'status', 'in_collection', 'settled');
      scheduleAutoBackup();
      return { ok: true, write_off_amount: writeOff };
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
        const status = p.kept ? 'Kept' : (p.promised_date < localToday() ? 'Broken' : 'Pending');
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
      const today = localToday();
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
        -- DATE: Item #6 — date() wrap.
        WHERE d.company_id = ? AND date(dla.hearing_date) BETWEEN date(?) AND date(?)
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
                received_date: txn.date || localToday(),
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
                received_date: txn.date || localToday(),
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
        received_date: txn.date || localToday(),
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

  // ─── Advanced Debt Collection Handlers ──────────────────────

  // Feature 4: Schedule Communication
  ipcMain.handle('debt:schedule-communication', (_event, { debtId, type, scheduledDate, subject, body }: { debtId: string; type: string; scheduledDate: string; subject: string; body: string }) => {
    try {
      const record = db.create('debt_communications', {
        debt_id: debtId,
        type,
        direction: 'outbound',
        subject,
        body,
        next_action: 'send',
        next_action_date: scheduledDate,
        logged_at: new Date().toISOString(),
        outcome: 'scheduled',
      });
      logDebtAudit(debtId, 'communication_logged', 'scheduled', '', scheduledDate);
      scheduleAutoBackup();
      return record;
    } catch (err: any) {
      return { error: err.message };
    }
  });

  // Feature 12: Auto-Assign Debts to Collectors
  ipcMain.handle('debt:auto-assign', (_event, { companyId }: { companyId: string }) => {
    try {
      const dbInstance = db.getDb();
      const unassigned = dbInstance.prepare(
        `SELECT id FROM debts WHERE company_id = ? AND (assigned_collector_id IS NULL OR assigned_collector_id = '') AND status NOT IN ('settled','written_off') ORDER BY balance_due DESC`
      ).all(companyId) as any[];
      const collectors = dbInstance.prepare('SELECT id FROM users').all() as any[];
      if (collectors.length === 0 || unassigned.length === 0) return { assigned: 0 };
      let idx = 0;
      const tx = dbInstance.transaction(() => {
        for (const debt of unassigned) {
          const collectorId = collectors[idx % collectors.length].id;
          dbInstance.prepare('UPDATE debts SET assigned_collector_id = ?, updated_at = datetime(\'now\') WHERE id = ?').run(collectorId, debt.id);
          logDebtAudit(debt.id, 'assignment_change', 'assigned_collector_id', '', collectorId);
          idx++;
        }
      });
      tx();
      scheduleAutoBackup();
      return { assigned: unassigned.length };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  // Feature 20: Consolidate Debts
  ipcMain.handle('debt:consolidate', (_event, { debtIds, companyId }: { debtIds: string[]; companyId: string }) => {
    try {
      if (debtIds.length < 2) return { error: 'Need at least 2 debts to consolidate' };
      const dbInstance = db.getDb();
      const debts = debtIds.map(id => dbInstance.prepare('SELECT * FROM debts WHERE id = ?').get(id) as any).filter(Boolean);
      if (debts.length < 2) return { error: 'Could not find all selected debts' };
      // Check same debtor
      const debtorName = debts[0].debtor_name;
      if (!debts.every(d => d.debtor_name === debtorName)) return { error: 'All debts must be from the same debtor' };
      const totalBalance = debts.reduce((s: number, d: any) => s + (d.balance_due || 0), 0);
      const totalOriginal = debts.reduce((s: number, d: any) => s + (d.original_amount || 0), 0);
      const totalInterest = debts.reduce((s: number, d: any) => s + (d.interest_accrued || 0), 0);
      const totalFees = debts.reduce((s: number, d: any) => s + (d.fees_accrued || 0), 0);
      const totalPayments = debts.reduce((s: number, d: any) => s + (d.payments_made || 0), 0);
      const newDebt = db.create('debts', {
        company_id: companyId,
        type: debts[0].type,
        debtor_type: debts[0].debtor_type,
        debtor_name: debtorName,
        debtor_email: debts[0].debtor_email || '',
        debtor_phone: debts[0].debtor_phone || '',
        debtor_address: debts[0].debtor_address || '',
        original_amount: totalOriginal,
        interest_accrued: totalInterest,
        fees_accrued: totalFees,
        payments_made: totalPayments,
        balance_due: totalBalance,
        due_date: debts.reduce((earliest: string, d: any) => (!earliest || d.due_date < earliest) ? d.due_date : earliest, ''),
        delinquent_date: debts.reduce((earliest: string, d: any) => (!earliest || d.delinquent_date < earliest) ? d.delinquent_date : earliest, ''),
        status: 'active',
        current_stage: 'reminder',
        priority: debts.some((d: any) => d.priority === 'critical') ? 'critical' : debts.some((d: any) => d.priority === 'high') ? 'high' : 'medium',
        notes: `Consolidated from ${debts.length} debts: ${debtIds.map(id => id.slice(0, 8)).join(', ')}`,
        source_type: 'manual',
      });
      // Mark originals as settled
      for (const d of debts) {
        dbInstance.prepare('UPDATE debts SET status = ?, notes = ?, updated_at = datetime(\'now\') WHERE id = ?')
          .run('settled', `Consolidated into ${newDebt.id.slice(0, 8)}`, d.id);
      }
      db.create('debt_pipeline_stages', { debt_id: newDebt.id, stage: 'reminder' });
      scheduleAutoBackup();
      return { newDebtId: newDebt.id, consolidated: debts.length };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  // Feature 23: Transfer Debt Between Companies
  ipcMain.handle('debt:transfer', (_event, { debtId, targetCompanyId }: { debtId: string; targetCompanyId: string }) => {
    try {
      const dbInstance = db.getDb();
      const debt = dbInstance.prepare('SELECT * FROM debts WHERE id = ?').get(debtId) as any;
      if (!debt) return { error: 'Debt not found' };
      // Create copy in target company
      const cols = Object.keys(debt).filter(k => k !== 'id' && k !== 'company_id' && k !== 'created_at' && k !== 'updated_at');
      const newDebtData: Record<string, any> = { company_id: targetCompanyId };
      for (const col of cols) newDebtData[col] = debt[col];
      newDebtData.notes = (newDebtData.notes || '') + `\nTransferred from company ${debt.company_id.slice(0, 8)}`;
      const newDebt = db.create('debts', newDebtData);
      // Mark original as transferred
      dbInstance.prepare('UPDATE debts SET status = ?, notes = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run('settled', `Transferred to company ${targetCompanyId.slice(0, 8)}`, debtId);
      logDebtAudit(debtId, 'field_edit', 'status', debt.status, 'transferred');
      scheduleAutoBackup();
      return { newDebtId: newDebt.id };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  // Feature 16: Freeze/Resume Interest
  ipcMain.handle('debt:freeze-interest', (_event, { debtId, freeze, reason }: { debtId: string; freeze: boolean; reason?: string }) => {
    try {
      const today = localToday();
      db.getDb().prepare(`UPDATE debts SET interest_frozen = ?, interest_frozen_date = ?, interest_frozen_reason = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(freeze ? 1 : 0, freeze ? today : '', reason || '', debtId);
      logDebtAudit(debtId, 'field_edit', 'interest_frozen', freeze ? '0' : '1', freeze ? '1' : '0');
      scheduleAutoBackup();
      return { success: true };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  // Feature 13: Auto Priority Scoring
  ipcMain.handle('debt:auto-priority', (_event, { companyId }: { companyId: string }) => {
    try {
      const dbInstance = db.getDb();
      const debts = dbInstance.prepare(
        `SELECT id, balance_due, statute_of_limitations_date FROM debts WHERE company_id = ? AND status NOT IN ('settled','written_off')`
      ).all(companyId) as any[];
      const today = localToday();
      let updated = 0;
      const tx = dbInstance.transaction(() => {
        for (const d of debts) {
          let priority = 'low';
          if (d.balance_due >= 10000) priority = 'critical';
          else if (d.balance_due >= 5000) priority = 'high';
          else if (d.balance_due >= 1000) priority = 'medium';
          // Override: statute expiring within 90 days
          if (d.statute_of_limitations_date) {
            const daysLeft = Math.floor((new Date(d.statute_of_limitations_date).getTime() - Date.now()) / 86400000);
            if (daysLeft >= 0 && daysLeft <= 90) priority = 'critical';
          }
          dbInstance.prepare('UPDATE debts SET priority = ?, updated_at = datetime(\'now\') WHERE id = ?').run(priority, d.id);
          updated++;
        }
      });
      tx();
      if (updated > 0) scheduleAutoBackup();
      return { updated };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  // Feature 24: Campaign Manager CRUD
  ipcMain.handle('debt:campaign-list', (_event, { companyId }: { companyId: string }) => {
    try {
      return db.queryAll('debt_campaigns', { company_id: companyId }, { field: 'created_at', dir: 'desc' });
    } catch (err: any) {
      return [];
    }
  });

  ipcMain.handle('debt:campaign-save', (_event, data: Record<string, any>) => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (data.id) {
        return db.update('debt_campaigns', data.id, data);
      } else {
        return db.create('debt_campaigns', { ...data, company_id: companyId });
      }
    } catch (err: any) {
      return { error: err.message };
    }
  });

  // Feature 9: Generate Payment Portal Link
  // PORTAL: idempotent — returns the existing live token if one is set.
  // Persists portal_token / portal_token_expires_at on the debts row so the
  // VPS replica can validate the link via the standard sync path. Falls back
  // to ephemeral (in-memory only) on legacy DBs missing those columns.
  ipcMain.handle('debt:generate-portal-token', (_event, { debtId }: { debtId: string }) => {
    try {
      const dbInstance = db.getDb();
      const debt = dbInstance.prepare(`SELECT * FROM debts WHERE id = ?`).get(debtId) as any;
      if (!debt) return { error: 'Debt not found' };

      const existingToken: string | null = debt.portal_token ?? null;
      const existingExpiry: number = debt.portal_token_expires_at ?? 0;
      if (existingToken && existingExpiry > 0) {
        return { token: existingToken, portalUrl: `${SYNC_SERVER}/portal/debt/${existingToken}` };
      }

      const token = crypto.randomBytes(32).toString('hex');
      const companyId = db.getCurrentCompanyId() ?? '';
      const expiryDays = getPortalExpiryDays(companyId);
      const expiresAt = Math.floor(Date.now() / 1000) + expiryDays * 86400;
      try {
        dbInstance.prepare(
          `UPDATE debts SET portal_token = ?, portal_token_expires_at = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(token, expiresAt, debtId);
        syncPush({
          table_name: 'debts',
          operation: 'update',
          record_id: debtId,
          company_id: companyId,
          payload: { id: debtId, portal_token: token, portal_token_expires_at: expiresAt },
        } as any).catch(() => {});
      } catch { /* legacy DB without portal_token columns */ }
      const portalUrl = `${SYNC_SERVER}/portal/debt/${token}`;
      return { token, portalUrl, expiresAt };
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
      const today = localToday();
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
        -- DATE: Item #6/#18 — date() wrap; pay_date stored as date-only string,
        -- but be defensive in case future code ever stores a timestamp here.
        WHERE ps.employee_id = ? AND date(pr.pay_date) BETWEEN date(?) AND date(?)
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
        -- DATE: Item #6 — date() wrap so end-of-period bounds are inclusive.
        WHERE e.company_id = ? AND date(e.date) BETWEEN date(?) AND date(?)
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

    const convertResult = convertTx();
    // Reactive engine: emit quote.converted for workflows.
    try {
      if (companyId && quoteId && convertResult?.invoice_id) {
        eventBus.emit({
          type: 'quote.converted',
          companyId,
          entityType: 'quote',
          entityId: quoteId,
          data: { invoice_id: convertResult.invoice_id },
        }).catch(() => {});
      }
    } catch { /* fire-and-forget */ }
    return convertResult;
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

  // ─── Expense Approval & Reimbursement Workflow ────────────────────
  // Helper: get current setting
  const getCompanySetting = (companyId: string, key: string): string | null => {
    try {
      const row = db.getDb().prepare('SELECT value FROM settings WHERE company_id=? AND key=?').get(companyId, key) as any;
      return row?.value ?? null;
    } catch { return null; }
  };

  // Feature 9: Policy violation check
  ipcMain.handle('expense:check-policy', (_event, { expense, lineItems }: { expense: any; lineItems?: any[] }) => {
    const violations: Array<{ code: string; message: string; severity: 'error' | 'warning' }> = [];
    const amount = Number(expense.amount || 0);
    if (amount > 500 && !expense.receipt_path) {
      violations.push({ code: 'receipt_required', message: 'Expenses over $500 must have a receipt attached.', severity: 'error' });
    }
    if (amount > 1000 && !(expense.description || '').trim()) {
      violations.push({ code: 'manager_comment_required', message: 'Expenses over $1,000 require a manager comment / detailed description.', severity: 'error' });
    }
    // Meal cap
    try {
      const cat = expense.category_id ? db.getDb().prepare('SELECT name FROM categories WHERE id=?').get(expense.category_id) as any : null;
      const name = (cat?.name || '').toLowerCase();
      if (name.includes('meal') || name.includes('lunch') || name.includes('entertainment')) {
        const attendees = Number(expense.attendees || expense.custom_fields?.attendees || 1) || 1;
        const perPerson = amount / attendees;
        if (perPerson > 50) {
          violations.push({ code: 'meal_cap', message: `Meal cap exceeded: $${perPerson.toFixed(2)}/person (limit $50). Provide override comment.`, severity: 'warning' });
        }
      }
    } catch (_) {}
    return { violations };
  });

  // Feature 23: Duplicate detection
  ipcMain.handle('expense:check-duplicate', (_event, { companyId, vendorId, amount, date, excludeId }: { companyId: string; vendorId?: string; amount: number; date: string; excludeId?: string }) => {
    try {
      const rows = db.getDb().prepare(
        `SELECT id, date, amount, description FROM expenses
         WHERE company_id=? AND amount=? AND date BETWEEN date(?, '-1 day') AND date(?, '+1 day')
         ${vendorId ? 'AND vendor_id=?' : ''}
         ${excludeId ? 'AND id!=?' : ''}
         LIMIT 5`
      ).all(...[companyId, amount, date, date, ...(vendorId ? [vendorId] : []), ...(excludeId ? [excludeId] : [])]);
      return { duplicates: rows };
    } catch (err: any) {
      return { duplicates: [], error: err?.message };
    }
  });

  // Feature 22: period lock check
  ipcMain.handle('expense:check-period-lock', (_event, { companyId, date }: { companyId: string; date: string }) => {
    try {
      const lock = db.getDb().prepare(
        `SELECT locked_through_date FROM period_locks WHERE company_id=? ORDER BY locked_through_date DESC LIMIT 1`
      ).get(companyId) as any;
      const lockDate = lock?.locked_through_date || getCompanySetting(companyId, 'period_lock_date');
      if (lockDate && date <= lockDate) {
        return { locked: true, lockedThrough: lockDate };
      }
      return { locked: false };
    } catch { return { locked: false }; }
  });

  // Feature 11: list reimbursable expenses for an employee
  ipcMain.handle('expense:reimbursable-for-employee', (_event, { companyId, employeeId, periodStart, periodEnd }: { companyId: string; employeeId: string; periodStart?: string; periodEnd?: string }) => {
    try {
      const params: any[] = [companyId, employeeId];
      let where = `e.company_id=? AND e.employee_id=? AND e.is_reimbursable=1 AND e.reimbursed=0
                   AND (e.approval_status='approved' OR e.status='approved')`;
      if (periodStart) { where += ` AND e.date >= ?`; params.push(periodStart); }
      if (periodEnd) { where += ` AND e.date <= ?`; params.push(periodEnd); }
      const rows = db.getDb().prepare(
        `SELECT e.*, v.name AS vendor_name, c.name AS category_name
         FROM expenses e LEFT JOIN vendors v ON v.id=e.vendor_id
         LEFT JOIN categories c ON c.id=e.category_id
         WHERE ${where} ORDER BY e.date DESC`
      ).all(...params);
      return { expenses: rows };
    } catch (err: any) { return { expenses: [], error: err?.message }; }
  });

  // Feature 13: per-employee reimbursement balance
  ipcMain.handle('expense:reimbursement-balances', (_event, { companyId }: { companyId: string }) => {
    try {
      const rows = db.getDb().prepare(
        `SELECT e.employee_id, COALESCE(emp.name,'(unassigned)') AS employee_name,
                COUNT(*) AS expense_count, SUM(e.amount) AS balance
         FROM expenses e
         LEFT JOIN employees emp ON emp.id=e.employee_id
         WHERE e.company_id=? AND e.is_reimbursable=1 AND e.reimbursed=0
           AND (e.approval_status='approved' OR e.status='approved')
         GROUP BY e.employee_id ORDER BY balance DESC`
      ).all(companyId);
      return { balances: rows };
    } catch (err: any) { return { balances: [], error: err?.message }; }
  });

  // Feature 12: create reimbursement batch + mark expenses reimbursed
  ipcMain.handle('reimbursement:create-batch', (_event, { companyId, employeeId, expenseIds, periodStart, periodEnd, notes }: { companyId: string; employeeId: string; expenseIds: string[]; periodStart?: string; periodEnd?: string; notes?: string }) => {
    try {
      const id = uuid();
      const dbi = db.getDb();
      const now = new Date().toISOString();
      const placeholders = expenseIds.map(() => '?').join(',');
      const totalRow = dbi.prepare(`SELECT COALESCE(SUM(amount),0) AS t FROM expenses WHERE id IN (${placeholders})`).get(...expenseIds) as any;
      const total = Number(totalRow?.t || 0);
      // INTEGRITY: insert batch row + update each expense in one transaction.
      // Otherwise a UPDATE failure leaves an empty batch with no expenses tied
      // to it, or partial expenses pointing to a batch whose status is wrong.
      const upd = dbi.prepare(`UPDATE expenses SET reimbursement_batch_id=?, reimbursed=1, reimbursed_date=?, status='paid' WHERE id=?`);
      const tx = dbi.transaction((ids: string[]) => {
        dbi.prepare(`INSERT INTO reimbursement_batches (id, company_id, employee_id, period_start, period_end, total_amount, expense_count, status, notes) VALUES (?,?,?,?,?,?,?,?,?)`)
          .run(id, companyId, employeeId, periodStart || '', periodEnd || '', total, ids.length, 'open', notes || '');
        for (const xid of ids) upd.run(id, now.slice(0, 10), xid);
      });
      tx(expenseIds);
      db.logAudit(companyId, 'reimbursement_batch', id, 'create', { employee_id: employeeId, total, count: expenseIds.length });
      return { id, total, count: expenseIds.length };
    } catch (err: any) { return { error: err?.message }; }
  });

  // Feature 18: mark batch paid via payroll
  ipcMain.handle('reimbursement:mark-paid-payroll', (_event, { batchId, payrollRunId }: { batchId: string; payrollRunId: string }) => {
    try {
      const dbi = db.getDb();
      dbi.prepare(`UPDATE reimbursement_batches SET status='paid', paid_date=date('now'), payroll_run_id=? WHERE id=?`).run(payrollRunId, batchId);
      dbi.prepare(`UPDATE expenses SET payroll_run_id=? WHERE reimbursement_batch_id=?`).run(payrollRunId, batchId);
      return { success: true };
    } catch (err: any) { return { error: err?.message }; }
  });

  // Feature 16: aging — approved+unpaid older than N days
  ipcMain.handle('reimbursement:aging', (_event, { companyId, days = 14 }: { companyId: string; days?: number }) => {
    try {
      const rows = db.getDb().prepare(
        `SELECT e.*, emp.name AS employee_name,
                CAST(julianday('now') - julianday(COALESCE(NULLIF(e.submitted_at,''), e.date)) AS INTEGER) AS days_waiting
         FROM expenses e LEFT JOIN employees emp ON emp.id=e.employee_id
         WHERE e.company_id=? AND e.is_reimbursable=1 AND e.reimbursed=0
           AND (e.approval_status='approved' OR e.status='approved')
           AND julianday('now') - julianday(COALESCE(NULLIF(e.submitted_at,''), e.date)) >= ?
         ORDER BY days_waiting DESC`
      ).all(companyId, days);
      return { rows };
    } catch (err: any) { return { rows: [], error: err?.message }; }
  });

  // Feature 4: approval queue for a user (current step assigned to them)
  ipcMain.handle('expense:approval-queue', (_event, { companyId, userId }: { companyId: string; userId: string }) => {
    try {
      const dbi = db.getDb();
      // Gather expenses where they're the direct approver_id OR where there's a pending step assigned to them in sequence
      const directRows = dbi.prepare(
        `SELECT e.*, v.name AS vendor_name, emp.name AS employee_name
         FROM expenses e LEFT JOIN vendors v ON v.id=e.vendor_id LEFT JOIN employees emp ON emp.id=e.employee_id
         WHERE e.company_id=? AND e.approver_id=? AND e.approval_status IN ('submitted','in_review','needs_info')
         ORDER BY e.submitted_at DESC`
      ).all(companyId, userId);
      const stepRows = dbi.prepare(
        `SELECT e.*, v.name AS vendor_name, emp.name AS employee_name, s.id AS step_id, s.step_order, s.created_at AS step_created
         FROM expense_approval_steps s
         JOIN expenses e ON e.id=s.expense_id
         LEFT JOIN vendors v ON v.id=e.vendor_id LEFT JOIN employees emp ON emp.id=e.employee_id
         WHERE s.approver_id=? AND s.status='pending' AND e.company_id=?
         AND s.step_order = (
           SELECT MIN(s2.step_order) FROM expense_approval_steps s2
           WHERE s2.expense_id=e.id AND s2.status='pending'
         )
         ORDER BY s.created_at ASC`
      ).all(userId, companyId);
      return { direct: directRows, steps: stepRows };
    } catch (err: any) { return { direct: [], steps: [], error: err?.message }; }
  });

  // Feature 5/10: decide on a step (approve/reject) with audit trail
  ipcMain.handle('expense:decide', (_event, { expenseId, userId, decision, comment, stepId }: { expenseId: string; userId: string; decision: 'approve' | 'reject' | 'needs_info'; comment?: string; stepId?: string }) => {
    try {
      const dbi = db.getDb();
      const exp = dbi.prepare('SELECT * FROM expenses WHERE id=?').get(expenseId) as any;
      if (!exp) return { error: 'Expense not found' };
      const previousStatus = exp.approval_status || 'submitted';

      // Multi-step path
      if (stepId) {
        dbi.prepare(`UPDATE expense_approval_steps SET status=?, comment=?, decided_at=datetime('now') WHERE id=?`)
          .run(decision === 'approve' ? 'approved' : (decision === 'reject' ? 'rejected' : 'needs_info'), comment || '', stepId);
        if (decision === 'reject') {
          dbi.prepare(`UPDATE expenses SET approval_status='rejected', rejection_reason=? WHERE id=?`).run(comment || '', expenseId);
        } else if (decision === 'needs_info') {
          dbi.prepare(`UPDATE expenses SET approval_status='needs_info' WHERE id=?`).run(expenseId);
        } else {
          // any pending steps left?
          const left = dbi.prepare(`SELECT COUNT(*) AS c FROM expense_approval_steps WHERE expense_id=? AND status='pending'`).get(expenseId) as any;
          if (!left || left.c === 0) {
            dbi.prepare(`UPDATE expenses SET approval_status='approved', status='approved', approved_by=?, approved_date=date('now') WHERE id=?`).run(userId, expenseId);
          } else {
            dbi.prepare(`UPDATE expenses SET approval_status='in_review' WHERE id=?`).run(expenseId);
          }
        }
      } else {
        // Single approver
        const newStatus = decision === 'approve' ? 'approved' : (decision === 'reject' ? 'rejected' : 'needs_info');
        if (decision === 'approve') {
          dbi.prepare(`UPDATE expenses SET approval_status='approved', status='approved', approved_by=?, approved_date=date('now') WHERE id=?`).run(userId, expenseId);
        } else if (decision === 'reject') {
          dbi.prepare(`UPDATE expenses SET approval_status='rejected', rejection_reason=? WHERE id=?`).run(comment || '', expenseId);
        } else {
          dbi.prepare(`UPDATE expenses SET approval_status='needs_info' WHERE id=?`).run(expenseId);
        }
        db.logAudit(exp.company_id, 'expense', expenseId, 'update', { previous_status: previousStatus, new_status: newStatus, comment, decided_by: userId });
      }

      // Always log a decision audit entry
      db.logAudit(exp.company_id, 'expense', expenseId, 'update', { decision, previous_status: previousStatus, comment, decided_by: userId });

      // Comment record
      if (comment) {
        db.create('expense_comments', { expense_id: expenseId, user_id: userId, body: `[${decision}] ${comment}` });
      }
      return { success: true };
    } catch (err: any) { return { error: err?.message }; }
  });

  // Feature 3: set up approval chain
  ipcMain.handle('expense:set-approval-chain', (_event, { expenseId, approverIds }: { expenseId: string; approverIds: string[] }) => {
    try {
      const dbi = db.getDb();
      dbi.prepare('DELETE FROM expense_approval_steps WHERE expense_id=?').run(expenseId);
      const ins = dbi.prepare(`INSERT INTO expense_approval_steps (id, expense_id, step_order, approver_id, status) VALUES (?,?,?,?, 'pending')`);
      approverIds.forEach((aid, idx) => ins.run(uuid(), expenseId, idx, aid));
      return { success: true, count: approverIds.length };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('expense:list-approval-steps', (_event, { expenseId }: { expenseId: string }) => {
    try {
      const rows = db.getDb().prepare(
        `SELECT s.*, u.display_name AS approver_name FROM expense_approval_steps s
         LEFT JOIN users u ON u.id=s.approver_id WHERE s.expense_id=? ORDER BY s.step_order ASC`
      ).all(expenseId);
      return { steps: rows };
    } catch (err: any) { return { steps: [], error: err?.message }; }
  });

  // Feature 6: comments
  ipcMain.handle('expense:list-comments', (_event, { expenseId }: { expenseId: string }) => {
    try {
      const rows = db.getDb().prepare(
        `SELECT c.*, u.display_name AS user_name FROM expense_comments c
         LEFT JOIN users u ON u.id=c.user_id WHERE c.expense_id=? ORDER BY c.created_at ASC`
      ).all(expenseId);
      return { comments: rows };
    } catch (err: any) { return { comments: [], error: err?.message }; }
  });
  ipcMain.handle('expense:add-comment', (_event, { expenseId, userId, body }: { expenseId: string; userId: string; body: string }) => {
    try {
      const row = db.create('expense_comments', { expense_id: expenseId, user_id: userId, body });
      const exp = db.getDb().prepare('SELECT company_id FROM expenses WHERE id=?').get(expenseId) as any;
      if (exp) db.logAudit(exp.company_id, 'expense', expenseId, 'update', { _action: 'comment', body });
      return { comment: row };
    } catch (err: any) { return { error: err?.message }; }
  });

  // Feature 7: token + deep link
  ipcMain.handle('expense:generate-token', (_event, { expenseId }: { expenseId: string }) => {
    try {
      const token = crypto.randomBytes(24).toString('hex');
      db.getDb().prepare('UPDATE expenses SET approval_token=? WHERE id=?').run(token, expenseId);
      return { token, link: `bap://approve-expense?id=${expenseId}&token=${token}` };
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('expense:validate-token', (_event, { expenseId, token }: { expenseId: string; token: string }) => {
    try {
      const row = db.getDb().prepare('SELECT approval_token FROM expenses WHERE id=?').get(expenseId) as any;
      return { valid: !!row && row.approval_token && row.approval_token === token };
    } catch (err: any) { return { valid: false, error: err?.message }; }
  });

  // Feature 1/8: submit expense (handles auto-approve threshold + delegation)
  ipcMain.handle('expense:submit', (_event, { expenseId, submittedBy, approverId }: { expenseId: string; submittedBy: string; approverId?: string }) => {
    try {
      const dbi = db.getDb();
      const exp = dbi.prepare('SELECT * FROM expenses WHERE id=?').get(expenseId) as any;
      if (!exp) return { error: 'Expense not found' };
      const threshRaw = getCompanySetting(exp.company_id, 'auto_approve_under');
      const threshold = threshRaw ? Number(threshRaw) : 0;
      const previousStatus = exp.approval_status || 'draft';

      // delegation: if assigned approver has delegate_to and is currently delegating
      let finalApprover = approverId || exp.approver_id || '';
      if (finalApprover) {
        const delegate = getCompanySetting(exp.company_id, `delegate_to:${finalApprover}`);
        if (delegate) finalApprover = delegate;
      }

      if (threshold > 0 && Number(exp.amount) < threshold) {
        dbi.prepare(`UPDATE expenses SET approval_status='approved', status='approved', submitted_at=datetime('now'), approved_by='auto', approved_date=date('now') WHERE id=?`).run(expenseId);
        db.logAudit(exp.company_id, 'expense', expenseId, 'update', { _action: 'auto_approve', previous_status: previousStatus, new_status: 'approved', submitted_by: submittedBy });
        return { success: true, autoApproved: true };
      } else {
        dbi.prepare(`UPDATE expenses SET approval_status='submitted', submitted_at=datetime('now'), approver_id=? WHERE id=?`).run(finalApprover, expenseId);
        db.logAudit(exp.company_id, 'expense', expenseId, 'update', { _action: 'submit', previous_status: previousStatus, new_status: 'submitted', approver_id: finalApprover });
        return { success: true, approverId: finalApprover };
      }
    } catch (err: any) { return { error: err?.message }; }
  });

  // Feature 17: notify admin if balance > threshold
  ipcMain.handle('reimbursement:check-threshold', (_event, { companyId, employeeId }: { companyId: string; employeeId: string }) => {
    try {
      const t = Number(getCompanySetting(companyId, 'reimbursement_notify_threshold') || 0);
      if (t <= 0) return { triggered: false };
      const row = db.getDb().prepare(
        `SELECT COALESCE(SUM(amount),0) AS bal FROM expenses
         WHERE company_id=? AND employee_id=? AND is_reimbursable=1 AND reimbursed=0
           AND (approval_status='approved' OR status='approved')`
      ).get(companyId, employeeId) as any;
      const bal = Number(row?.bal || 0);
      if (bal >= t) {
        try {
          db.create('notifications', {
            company_id: companyId,
            type: 'reimbursement_threshold',
            title: 'Reimbursement balance over threshold',
            message: `Employee has $${bal.toFixed(2)} in pending reimbursements (threshold $${t.toFixed(2)})`,
            severity: 'warning',
            entity_type: 'employee',
            entity_id: employeeId,
            is_read: 0,
          });
        } catch (_) {}
        return { triggered: true, balance: bal, threshold: t };
      }
      return { triggered: false, balance: bal, threshold: t };
    } catch (err: any) { return { triggered: false, error: err?.message }; }
  });

  // Feature 21: lock expense once paid
  ipcMain.handle('expense:lock', (_event, { expenseId, locked }: { expenseId: string; locked: boolean }) => {
    try {
      db.getDb().prepare('UPDATE expenses SET is_locked=? WHERE id=?').run(locked ? 1 : 0, expenseId);
      return { success: true };
    } catch (err: any) { return { error: err?.message }; }
  });

  // Feature 24: SLA — list pending steps with days waiting
  ipcMain.handle('expense:approval-sla', (_event, { companyId }: { companyId: string }) => {
    try {
      const rows = db.getDb().prepare(
        `SELECT s.id AS step_id, s.expense_id, s.approver_id, u.display_name AS approver_name,
                e.amount, e.description, e.submitted_at,
                CAST(julianday('now') - julianday(s.created_at) AS INTEGER) AS days_waiting
         FROM expense_approval_steps s
         JOIN expenses e ON e.id=s.expense_id
         LEFT JOIN users u ON u.id=s.approver_id
         WHERE e.company_id=? AND s.status='pending'
         ORDER BY days_waiting DESC`
      ).all(companyId);
      return { rows };
    } catch (err: any) { return { rows: [], error: err?.message }; }
  });

  // Reimbursement batch listing & detail
  ipcMain.handle('reimbursement:list-batches', (_event, { companyId }: { companyId: string }) => {
    try {
      const rows = db.getDb().prepare(
        `SELECT b.*, emp.name AS employee_name FROM reimbursement_batches b
         LEFT JOIN employees emp ON emp.id=b.employee_id WHERE b.company_id=? ORDER BY b.created_at DESC`
      ).all(companyId);
      return { batches: rows };
    } catch (err: any) { return { batches: [], error: err?.message }; }
  });
  ipcMain.handle('reimbursement:batch-detail', (_event, { batchId }: { batchId: string }) => {
    try {
      const dbi = db.getDb();
      const batch = dbi.prepare(`SELECT b.*, emp.name AS employee_name, emp.email AS employee_email,
        emp.routing_number, emp.account_number, emp.account_type FROM reimbursement_batches b
        LEFT JOIN employees emp ON emp.id=b.employee_id WHERE b.id=?`).get(batchId);
      const expenses = dbi.prepare(`SELECT e.*, v.name AS vendor_name, c.name AS category_name FROM expenses e
        LEFT JOIN vendors v ON v.id=e.vendor_id LEFT JOIN categories c ON c.id=e.category_id
        WHERE e.reimbursement_batch_id=? ORDER BY e.date ASC`).all(batchId);
      return { batch, expenses };
    } catch (err: any) { return { error: err?.message }; }
  });

  // Feature 15: ACH-ready CSV (NACHA format too verbose — using simplified CSV stub)
  ipcMain.handle('reimbursement:ach-export', async (_event, { batchId }: { batchId: string }) => {
    try {
      const dbi = db.getDb();
      const batch = dbi.prepare(`SELECT b.*, emp.name AS employee_name, emp.routing_number, emp.account_number, emp.account_type, c.name AS company_name
        FROM reimbursement_batches b
        LEFT JOIN employees emp ON emp.id=b.employee_id
        LEFT JOIN companies c ON c.id=b.company_id WHERE b.id=?`).get(batchId) as any;
      if (!batch) return { error: 'Batch not found' };
      const lines: string[] = [];
      lines.push('record_type,company,employee,routing,account,account_type,amount,effective_date,batch_id');
      lines.push(`HEADER,"${batch.company_name || ''}","${batch.employee_name || ''}","${batch.routing_number || ''}","${batch.account_number || ''}","${batch.account_type || ''}",${Number(batch.total_amount).toFixed(2)},${(batch.paid_date || localToday())},${batch.id}`);
      lines.push(`ENTRY,,"${batch.employee_name || ''}","${batch.routing_number || ''}","${batch.account_number || ''}","${batch.account_type || ''}",${Number(batch.total_amount).toFixed(2)},,${batch.id}`);
      const result = await dialog.showSaveDialog({
        title: 'Export ACH-ready CSV',
        defaultPath: `reimbursement-${batch.id}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });
      if (result.canceled || !result.filePath) return { cancelled: true };
      fs.writeFileSync(result.filePath, lines.join('\n'), 'utf-8');
      return { path: result.filePath };
    } catch (err: any) { return { error: err?.message }; }
  });

  // ─── Chart of Accounts (CoA) Enhancements ──────────────────────
  ipcMain.handle('accounts:suggest-code', (_event, { companyId, type }: { companyId: string; type: string }) => {
    try {
      const ranges: Record<string, [number, number]> = {
        asset: [1000, 1999], liability: [2000, 2999], equity: [3000, 3999],
        revenue: [4000, 4999], expense: [5000, 9999],
      };
      const range = ranges[type] || [1000, 9999];
      const rows = db.runQuery(
        `SELECT code FROM accounts WHERE company_id = ? AND CAST(code AS INTEGER) BETWEEN ? AND ? ORDER BY CAST(code AS INTEGER)`,
        [companyId, range[0], range[1]]
      );
      const used = new Set<number>(rows.map((r: any) => parseInt(r.code, 10)).filter((n: number) => !isNaN(n)));
      let candidate = range[0];
      if (used.size > 0) {
        const max = Math.max(...Array.from(used));
        candidate = Math.floor(max / 10) * 10 + 10;
      }
      while (used.has(candidate) && candidate <= range[1]) candidate += 10;
      return { code: String(candidate), range };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('accounts:merge', (_event, { sourceId, targetId }: { sourceId: string; targetId: string }) => {
    try {
      const dbi = db.getDb();
      const tx = dbi.transaction(() => {
        dbi.prepare('UPDATE journal_entry_lines SET account_id = ? WHERE account_id = ?').run(targetId, sourceId);
        try { dbi.prepare('UPDATE invoice_line_items SET account_id = ? WHERE account_id = ?').run(targetId, sourceId); } catch {}
        try { dbi.prepare('UPDATE expenses SET account_id = ? WHERE account_id = ?').run(targetId, sourceId); } catch {}
        try { dbi.prepare('UPDATE bills SET account_id = ? WHERE account_id = ?').run(targetId, sourceId); } catch {}
        try { dbi.prepare('UPDATE bill_line_items SET account_id = ? WHERE account_id = ?').run(targetId, sourceId); } catch {}
        try { dbi.prepare('UPDATE bill_payments SET account_id = ? WHERE account_id = ?').run(targetId, sourceId); } catch {}
        try { dbi.prepare('UPDATE expense_line_items SET account_id = ? WHERE account_id = ?').run(targetId, sourceId); } catch {}
        try { dbi.prepare('UPDATE bank_accounts SET account_id = ? WHERE account_id = ?').run(targetId, sourceId); } catch {}
        try { dbi.prepare('UPDATE budget_lines SET account_id = ? WHERE account_id = ?').run(targetId, sourceId); } catch {}
        try { dbi.prepare('UPDATE po_line_items SET account_id = ? WHERE account_id = ?').run(targetId, sourceId); } catch {}
        try { dbi.prepare('UPDATE credit_note_items SET account_id = ? WHERE account_id = ?').run(targetId, sourceId); } catch {}
        try { dbi.prepare('UPDATE accounts SET parent_id = ? WHERE parent_id = ?').run(targetId, sourceId); } catch {}
        dbi.prepare('DELETE FROM accounts WHERE id = ?').run(sourceId);
      });
      tx();
      return { success: true };
    } catch (err: any) { return { error: err?.message || String(err) }; }
  });

  ipcMain.handle('accounts:bulk-toggle-active', (_event, { ids, isActive }: { ids: string[]; isActive: boolean }) => {
    try {
      const dbi = db.getDb();
      const stmt = dbi.prepare("UPDATE accounts SET is_active = ?, updated_at = datetime('now') WHERE id = ?");
      const tx = dbi.transaction((rows: string[]) => { for (const id of rows) stmt.run(isActive ? 1 : 0, id); });
      tx(ids);
      return { success: true, count: ids.length };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('accounts:set-opening-balance', (_event, { companyId, accountId, amount, date }: { companyId: string; accountId: string; amount: number; date: string }) => {
    try {
      const dbi = db.getDb();
      const acct = dbi.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as any;
      if (!acct) return { error: 'Account not found' };
      let obe = dbi.prepare("SELECT * FROM accounts WHERE company_id = ? AND name = 'Opening Balance Equity' LIMIT 1").get(companyId) as any;
      if (!obe) {
        obe = db.create('accounts', {
          company_id: companyId, code: '3900', name: 'Opening Balance Equity',
          type: 'equity', subtype: "Owner's Equity",
        });
      }
      const isDebitNormal = ['asset', 'expense'].includes(acct.type);
      const acctDebit = isDebitNormal ? amount : 0;
      const acctCredit = isDebitNormal ? 0 : amount;
      const obeDebit = isDebitNormal ? 0 : amount;
      const obeCredit = isDebitNormal ? amount : 0;
      const entryNumber = `OB-${Date.now()}`;
      const je = db.create('journal_entries', {
        company_id: companyId, entry_number: entryNumber, date,
        description: `Opening balance: ${acct.name}`, is_posted: 1, is_adjusting: 1,
      });
      db.create('journal_entry_lines', { journal_entry_id: je.id, account_id: accountId, debit: acctDebit, credit: acctCredit, description: 'Opening balance' });
      db.create('journal_entry_lines', { journal_entry_id: je.id, account_id: obe.id, debit: obeDebit, credit: obeCredit, description: 'Opening balance offset' });
      return { success: true, entry_id: je.id };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('accounts:close-to-retained-earnings', (_event, { companyId, periodEndDate }: { companyId: string; periodEndDate: string }) => {
    try {
      const dbi = db.getDb();
      let re = dbi.prepare("SELECT * FROM accounts WHERE company_id = ? AND name = 'Retained Earnings' LIMIT 1").get(companyId) as any;
      if (!re) {
        re = db.create('accounts', { company_id: companyId, code: '3200', name: 'Retained Earnings', type: 'equity', subtype: 'Retained Earnings' });
      }
      const accts = dbi.prepare(
        `SELECT a.id, a.type, a.name, COALESCE((SELECT SUM(jel.debit - jel.credit) FROM journal_entry_lines jel
            JOIN journal_entries je ON jel.journal_entry_id = je.id
            WHERE jel.account_id = a.id AND je.company_id = ? AND date(je.date) <= date(?) /* DATE: Item #7 — wrap for inclusive end-of-day */), 0) as net_dr
          FROM accounts a WHERE a.company_id = ? AND a.type IN ('revenue','expense')`
      ).all(companyId, periodEndDate, companyId) as any[];
      const entryNumber = `CLOSE-${periodEndDate}`;
      const je = db.create('journal_entries', {
        company_id: companyId, entry_number: entryNumber, date: periodEndDate,
        description: `Year-end closing entries — ${periodEndDate}`, is_posted: 1, is_adjusting: 1,
      });
      let reDr = 0, reCr = 0;
      for (const a of accts) {
        const net = Number(a.net_dr) || 0;
        if (Math.abs(net) < 0.005) continue;
        if (net > 0) {
          db.create('journal_entry_lines', { journal_entry_id: je.id, account_id: a.id, debit: 0, credit: net, description: `Close ${a.name}` });
          reDr += net;
        } else {
          db.create('journal_entry_lines', { journal_entry_id: je.id, account_id: a.id, debit: -net, credit: 0, description: `Close ${a.name}` });
          reCr += -net;
        }
      }
      const reNet = reCr - reDr;
      if (reNet > 0) db.create('journal_entry_lines', { journal_entry_id: je.id, account_id: re.id, debit: 0, credit: reNet, description: 'Net income to RE' });
      else if (reNet < 0) db.create('journal_entry_lines', { journal_entry_id: je.id, account_id: re.id, debit: -reNet, credit: 0, description: 'Net loss to RE' });
      return { success: true, entry_id: je.id, accounts_closed: accts.length };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('accounts:stats', (_event, { companyId }: { companyId: string }) => {
    try {
      return db.runQuery(
        `SELECT a.id, a.type,
          COALESCE((SELECT SUM(jel.debit - jel.credit) FROM journal_entry_lines jel
            JOIN journal_entries je ON jel.journal_entry_id = je.id
            WHERE jel.account_id = a.id AND je.company_id = ?), 0) as net_dr,
          (SELECT MAX(je.date) FROM journal_entry_lines jel
            JOIN journal_entries je ON jel.journal_entry_id = je.id
            WHERE jel.account_id = a.id AND je.company_id = ?) as last_txn_date,
          (SELECT COUNT(*) FROM journal_entry_lines jel
            JOIN journal_entries je ON jel.journal_entry_id = je.id
            WHERE jel.account_id = a.id AND je.company_id = ? AND je.date >= date('now','-90 days')) as activity_90d
        FROM accounts a WHERE a.company_id = ?`,
        [companyId, companyId, companyId, companyId]
      );
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('accounts:history-pdf', async (_event, { accountId, companyId }: { accountId: string; companyId: string }) => {
    try {
      const acct = db.getById('accounts', accountId);
      if (!acct) return { error: 'Account not found' };
      const lines = db.runQuery(
        `SELECT je.date, je.entry_number, je.description as je_desc, jel.debit, jel.credit, jel.description as line_desc
         FROM journal_entry_lines jel JOIN journal_entries je ON jel.journal_entry_id = je.id
         WHERE jel.account_id = ? AND je.company_id = ? ORDER BY je.date, je.entry_number`,
        [accountId, companyId]
      );
      const company = db.getById('companies', companyId) || {};
      let runningBal = 0;
      const rowHtml = lines.map((l: any) => {
        runningBal += (Number(l.debit) || 0) - (Number(l.credit) || 0);
        return `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${l.date}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee">${l.entry_number || ''}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee">${String(l.line_desc || l.je_desc || '').replace(/</g, '&lt;')}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${Number(l.debit || 0).toFixed(2)}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${Number(l.credit || 0).toFixed(2)}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${runningBal.toFixed(2)}</td></tr>`;
      }).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Account History — ${acct.code}</title>
        <style>body{font-family:system-ui,sans-serif;padding:24px;color:#111}h1{font-size:18px;margin:0 0 4px}h2{font-size:13px;color:#666;font-weight:normal;margin:0 0 16px}table{width:100%;border-collapse:collapse;font-size:11px}th{background:#f5f5f5;text-align:left;padding:6px 8px;border-bottom:2px solid #333}</style></head>
        <body><h1>${(company as any).name || ''}</h1><h2>Account History — ${acct.code} ${acct.name}</h2>
        <p style="font-size:11px;color:#555">Type: ${acct.type} • Subtype: ${acct.subtype || '—'} • Generated: ${localToday()}</p>
        <table><thead><tr><th>Date</th><th>Entry #</th><th>Description</th><th style="text-align:right">Debit</th><th style="text-align:right">Credit</th><th style="text-align:right">Balance</th></tr></thead>
        <tbody>${rowHtml || '<tr><td colspan="6" style="padding:16px;text-align:center;color:#888">No transactions</td></tr>'}</tbody></table>
        </body></html>`;
      return await openPrintPreview(html, `Account ${acct.code} History`);
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('accounts:apply-template', (_event, { companyId, accounts }: { companyId: string; accounts: Array<{ code: string; name: string; type: string; subtype?: string }> }) => {
    try {
      const dbi = db.getDb();
      const existing = new Set<string>(
        (dbi.prepare('SELECT code FROM accounts WHERE company_id = ?').all(companyId) as any[]).map(r => r.code)
      );
      let created = 0;
      const tx = dbi.transaction(() => {
        for (const a of accounts) {
          if (existing.has(a.code)) continue;
          db.create('accounts', { company_id: companyId, ...a });
          created++;
        }
      });
      tx();
      return { success: true, created };
    } catch (err: any) { return { error: err?.message }; }
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

  // ═══ Period close + Reconciliation + Compliance (2026-04-23) ═══

  ipcMain.handle('close:check-date-lock', (_e, { companyId, date }: { companyId: string; date: string }) => {
    try {
      const row = db.getDb().prepare(
        `SELECT id, period_start, period_end, reason, locked_through_date
         FROM period_locks
         WHERE company_id = ? AND (unlocked_at IS NULL OR unlocked_at = '')
           AND (
             (period_start != '' AND period_end != '' AND ? >= period_start AND ? <= period_end)
             OR (locked_through_date != '' AND ? <= locked_through_date)
           )
         ORDER BY created_at DESC LIMIT 1`
      ).get(companyId, date, date, date) as any;
      return { locked: !!row, lock: row || null };
    } catch (err: any) { return { locked: false, error: err?.message }; }
  });

  ipcMain.handle('close:list-locks', (_e, { companyId }: { companyId: string }) => {
    try {
      return db.getDb().prepare(
        `SELECT * FROM period_locks WHERE company_id = ? ORDER BY created_at DESC`
      ).all(companyId);
    } catch { return []; }
  });

  ipcMain.handle('close:lock-period', (_e, { companyId, periodStart, periodEnd, lockedBy, reason }: any) => {
    try {
      const id = uuid();
      db.getDb().prepare(
        `INSERT INTO period_locks (id, company_id, period_start, period_end, locked_through_date, locked_by, reason, note)
         VALUES (?,?,?,?,?,?,?,?)`
      ).run(id, companyId, periodStart || '', periodEnd || '', periodEnd || '', lockedBy || '', reason || '', reason || '');
      db.logAudit(companyId, 'period_lock', id, 'create', { periodStart, periodEnd, reason });
      return { id };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('close:unlock-period', (_e, { lockId, unlockedBy, reason, override }: any) => {
    try {
      const lock = db.getDb().prepare(`SELECT * FROM period_locks WHERE id = ?`).get(lockId) as any;
      if (!lock) return { error: 'Lock not found' };
      db.getDb().prepare(
        `UPDATE period_locks SET unlocked_at = datetime('now'), unlocked_by = ?, unlock_reason = ? WHERE id = ?`
      ).run(unlockedBy || '', reason || '', lockId);
      db.logAudit(lock.company_id, 'period_lock', lockId, override ? 'override' : 'unlock', { reason, by: unlockedBy });
      return { ok: true };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('close:checklist-list', (_e, { companyId, periodLabel }: { companyId: string; periodLabel: string }) => {
    try {
      return db.getDb().prepare(
        `SELECT * FROM period_close_checklist WHERE company_id = ? AND period_label = ? ORDER BY created_at`
      ).all(companyId, periodLabel);
    } catch { return []; }
  });

  ipcMain.handle('close:checklist-toggle', (_e, { companyId, periodLabel, itemKey, itemLabel, completed, skipped, by, note }: any) => {
    try {
      const existing = db.getDb().prepare(
        `SELECT id FROM period_close_checklist WHERE company_id = ? AND period_label = ? AND item_key = ?`
      ).get(companyId, periodLabel, itemKey) as any;
      const now = new Date().toISOString();
      if (existing) {
        db.getDb().prepare(
          `UPDATE period_close_checklist SET completed_at = ?, completed_by = ?, skipped = ?, note = ? WHERE id = ?`
        ).run(completed ? now : '', by || '', skipped ? 1 : 0, note || '', existing.id);
        return { id: existing.id };
      }
      const id = uuid();
      db.getDb().prepare(
        `INSERT INTO period_close_checklist (id, company_id, period_label, item_key, item_label, completed_at, completed_by, skipped, note)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(id, companyId, periodLabel, itemKey, itemLabel, completed ? now : '', by || '', skipped ? 1 : 0, note || '');
      return { id };
    } catch (err: any) { return { error: err?.message }; }
  });

  function buildClosingPreview(companyId: string, periodStart: string, periodEnd: string) {
    const lines = db.getDb().prepare(
      `SELECT a.id AS account_id, a.code, a.name, a.type,
              SUM(COALESCE(jel.debit,0)) AS debit_sum,
              SUM(COALESCE(jel.credit,0)) AS credit_sum
       FROM accounts a
       LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
       LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
         AND je.company_id = ? AND je.is_posted = 1
         AND date(je.date) >= date(?) AND date(je.date) <= date(?) -- DATE: Item #7 — date() wrap so timestamp values match and end-day is inclusive.
       WHERE a.company_id = ? AND a.type IN ('revenue','expense')
       GROUP BY a.id`
    ).all(companyId, periodStart, periodEnd, companyId) as any[];

    const closing: Array<{ account_id: string; code: string; name: string; type: string; debit: number; credit: number }> = [];
    let netIncome = 0;
    for (const r of lines) {
      const revBal = (r.credit_sum || 0) - (r.debit_sum || 0);
      const expBal = (r.debit_sum || 0) - (r.credit_sum || 0);
      if (r.type === 'revenue') {
        if (Math.abs(revBal) < 0.005) continue;
        closing.push({ account_id: r.account_id, code: r.code, name: r.name, type: r.type, debit: revBal, credit: 0 });
        netIncome += revBal;
      } else {
        if (Math.abs(expBal) < 0.005) continue;
        closing.push({ account_id: r.account_id, code: r.code, name: r.name, type: r.type, debit: 0, credit: expBal });
        netIncome -= expBal;
      }
    }
    const re = db.getDb().prepare(
      `SELECT id, code, name FROM accounts WHERE company_id = ? AND subtype='retained' LIMIT 1`
    ).get(companyId) as any;
    return { lines: closing, netIncome, retainedEarnings: re || null };
  }

  ipcMain.handle('close:closing-preview', (_e, { companyId, periodStart, periodEnd }: any) => {
    try { return buildClosingPreview(companyId, periodStart, periodEnd); }
    catch (err: any) { return { error: err?.message, lines: [], netIncome: 0, retainedEarnings: null }; }
  });

  ipcMain.handle('close:closing-commit', (_e, { companyId, periodStart, periodEnd, closedBy }: any) => {
    try {
      const preview = buildClosingPreview(companyId, periodStart, periodEnd);
      if (!preview.retainedEarnings) return { error: 'No Retained Earnings account found.' };
      if (!preview.lines.length) return { error: 'No revenue/expense balances to close.' };

      const dbInstance = db.getDb();
      const jeId = uuid();
      const logId = uuid();
      const lockId = uuid();
      const entryNumber = `CLOSE-${periodEnd}`;

      // INTEGRITY: period close writes JE header + JE lines + close_log + period_lock.
      // If any one fails the period would otherwise be left half-closed (orphan
      // JE, missing lock, etc.). Wrap the whole sequence atomically.
      const closeTx = dbInstance.transaction(() => {
        dbInstance.prepare(
          `INSERT INTO journal_entries (id, company_id, entry_number, date, description, is_posted, is_closing, posted_by)
           VALUES (?,?,?,?,?,1,1,?)`
        ).run(jeId, companyId, entryNumber, periodEnd, `Year-end closing entries (${periodStart} to ${periodEnd})`, closedBy || '');

        let lineNo = 0;
        for (const l of preview.lines) {
          dbInstance.prepare(
            `INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit, credit, description, sort_order)
             VALUES (?,?,?,?,?,?,?)`
          ).run(uuid(), jeId, l.account_id, l.debit, l.credit, `Close ${l.code} ${l.name}`, lineNo++);
        }
        const reDebit = preview.netIncome < 0 ? Math.abs(preview.netIncome) : 0;
        const reCredit = preview.netIncome > 0 ? preview.netIncome : 0;
        dbInstance.prepare(
          `INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit, credit, description, sort_order)
           VALUES (?,?,?,?,?,?,?)`
        ).run(uuid(), jeId, preview.retainedEarnings.id, reDebit, reCredit, 'To Retained Earnings', lineNo++);

        dbInstance.prepare(
          `INSERT INTO period_close_log (id, company_id, period_start, period_end, closed_at, closed_by, closing_je_id, net_income)
           VALUES (?,?,?,?,datetime('now'),?,?,?)`
        ).run(logId, companyId, periodStart, periodEnd, closedBy || '', jeId, preview.netIncome);

        dbInstance.prepare(
          `INSERT INTO period_locks (id, company_id, period_start, period_end, locked_through_date, locked_by, reason)
           VALUES (?,?,?,?,?,?,?)`
        ).run(lockId, companyId, periodStart, periodEnd, periodEnd, closedBy || '', 'Year-end close');
      });
      closeTx();

      db.logAudit(companyId, 'period_close', logId, 'create', { periodStart, periodEnd, netIncome: preview.netIncome, jeId });
      return { ok: true, journalEntryId: jeId, netIncome: preview.netIncome, logId };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('close:log-list', (_e, { companyId }: { companyId: string }) => {
    try {
      return db.getDb().prepare(
        `SELECT pcl.*, je.entry_number AS je_number
         FROM period_close_log pcl
         LEFT JOIN journal_entries je ON je.id = pcl.closing_je_id
         WHERE pcl.company_id = ? ORDER BY pcl.closed_at DESC`
      ).all(companyId);
    } catch { return []; }
  });

  function _glBalanceFor(companyId: string, accountId: string, asOfDate: string): number {
    const r = db.getDb().prepare(
      `SELECT SUM(COALESCE(jel.debit,0) - COALESCE(jel.credit,0)) AS bal
       FROM journal_entry_lines jel
       JOIN journal_entries je ON je.id = jel.journal_entry_id
       WHERE jel.account_id = ? AND je.company_id = ? AND je.is_posted = 1 AND date(je.date) <= date(?) /* DATE: Item #7 — wrap for inclusive end-of-day */`
    ).get(accountId, companyId, asOfDate) as any;
    return r?.bal || 0;
  }

  function _subLedgerForAccount(companyId: string, account: any, asOfDate: string): { total: number; items: any[] } {
    const sub = (account.subtype || '').toLowerCase();
    const name = (account.name || '').toLowerCase();
    if (name.includes('receivable') || sub === 'ar') {
      const items = db.getDb().prepare(
        `SELECT id, invoice_number AS reference, date, total - COALESCE(amount_paid,0) AS amount, client_id, status
         FROM invoices WHERE company_id = ? AND date <= ? AND COALESCE(amount_paid,0) < total`
      ).all(companyId, asOfDate) as any[];
      return { total: items.reduce((s, i) => s + (i.amount || 0), 0), items };
    }
    if (name.includes('payable') && !name.includes('payroll') && !name.includes('tax')) {
      try {
        const items = db.getDb().prepare(
          `SELECT id, bill_number AS reference, date, total - COALESCE(amount_paid,0) AS amount, vendor_id, status
           FROM bills WHERE company_id = ? AND date <= ? AND COALESCE(amount_paid,0) < total`
        ).all(companyId, asOfDate) as any[];
        return { total: items.reduce((s, i) => s + (i.amount || 0), 0), items };
      } catch { return { total: 0, items: [] }; }
    }
    if (name.includes('inventory') || sub === 'inventory') {
      try {
        const items = db.getDb().prepare(
          `SELECT id, sku AS reference, name, quantity_on_hand AS qty, unit_cost,
                  quantity_on_hand * unit_cost AS amount FROM inventory_items WHERE company_id = ?`
        ).all(companyId) as any[];
        return { total: items.reduce((s, i) => s + (i.amount || 0), 0), items };
      } catch { return { total: 0, items: [] }; }
    }
    return { total: 0, items: [] };
  }

  ipcMain.handle('recon:compute', (_e, { companyId, accountId, asOfDate }: any) => {
    try {
      const account = db.getById('accounts', accountId);
      if (!account) return { error: 'Account not found' };
      const sub = _subLedgerForAccount(companyId, account, asOfDate);
      const gl = _glBalanceFor(companyId, accountId, asOfDate);
      const glDisplay = account.type === 'liability' ? -gl : gl;
      return {
        account, asOfDate,
        sub_ledger_total: sub.total, gl_total: glDisplay,
        variance: sub.total - glDisplay,
        sub_ledger_items: sub.items,
      };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('recon:auto-match', (_e, { companyId, accountId, asOfDate }: any) => {
    try {
      const account = db.getById('accounts', accountId);
      if (!account) return { matches: [], suggestions: [] };
      const sub = _subLedgerForAccount(companyId, account, asOfDate);
      const glLines = db.getDb().prepare(
        `SELECT jel.id, jel.debit, jel.credit, jel.description, je.entry_number, je.date
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         WHERE jel.account_id = ? AND je.company_id = ? AND je.is_posted = 1 AND date(je.date) <= date(?) /* DATE: Item #7 — wrap for inclusive end-of-day */`
      ).all(accountId, companyId, asOfDate) as any[];

      const matches: any[] = [];
      const suggestions: any[] = [];
      for (const subItem of sub.items) {
        const refMatch = glLines.find(g => subItem.reference && (g.entry_number === subItem.reference || (g.description || '').includes(subItem.reference)));
        if (refMatch) { matches.push({ sub: subItem, gl: refMatch, reason: 'reference' }); continue; }
        const subAmt = Math.abs(subItem.amount || 0);
        const subDate = new Date(subItem.date).getTime();
        const candidate = glLines.find(g => {
          const glAmt = Math.abs((g.debit || 0) - (g.credit || 0));
          const dayDiff = Math.abs((new Date(g.date).getTime() - subDate) / 86400000);
          return Math.abs(glAmt - subAmt) <= 1 && dayDiff <= 3;
        });
        if (candidate) suggestions.push({ sub: subItem, gl: candidate, reason: 'amount+date' });
      }
      return { matches, suggestions };
    } catch (err: any) { return { error: err?.message, matches: [], suggestions: [] }; }
  });

  ipcMain.handle('recon:save', (_e, data: any) => {
    try {
      const id = uuid();
      db.getDb().prepare(
        `INSERT INTO account_reconciliations
         (id, company_id, account_id, as_of_date, sub_ledger_total, gl_total, variance, reconciled_at, reconciled_by, notes, matches)
         VALUES (?,?,?,?,?,?,?,datetime('now'),?,?,?)`
      ).run(
        id, data.companyId, data.accountId, data.asOfDate,
        data.subLedgerTotal || 0, data.glTotal || 0, data.variance || 0,
        data.reconciledBy || '', data.notes || '', JSON.stringify(data.matches || [])
      );
      db.logAudit(data.companyId, 'account_reconciliation', id, 'create', { accountId: data.accountId, asOfDate: data.asOfDate });
      return { id };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('recon:history', (_e, { companyId, accountId }: any) => {
    try {
      if (accountId) {
        return db.getDb().prepare(
          `SELECT r.*, a.code, a.name FROM account_reconciliations r LEFT JOIN accounts a ON a.id = r.account_id
           WHERE r.company_id = ? AND r.account_id = ? ORDER BY r.as_of_date DESC`
        ).all(companyId, accountId);
      }
      return db.getDb().prepare(
        `SELECT r.*, a.code, a.name FROM account_reconciliations r LEFT JOIN accounts a ON a.id = r.account_id
         WHERE r.company_id = ? ORDER BY r.as_of_date DESC`
      ).all(companyId);
    } catch { return []; }
  });

  ipcMain.handle('recon:intercompany', () => {
    try {
      return db.getDb().prepare(
        `SELECT a.company_id, c.name AS company_name, a.id AS account_id, a.code, a.name,
                SUM(COALESCE(jel.debit,0) - COALESCE(jel.credit,0)) AS balance
         FROM accounts a
         LEFT JOIN companies c ON c.id = a.company_id
         LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
         LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.is_posted = 1
         WHERE LOWER(a.name) LIKE '%due to%' OR LOWER(a.name) LIKE '%due from%' OR LOWER(a.name) LIKE '%intercompany%'
         GROUP BY a.id ORDER BY c.name, a.code`
      ).all();
    } catch { return []; }
  });

  ipcMain.handle('compliance:account-audit', (_e, { companyId, accountId, limit = 200 }: any) => {
    try {
      const acctChanges = db.getDb().prepare(
        `SELECT * FROM audit_log WHERE company_id = ? AND entity_type = 'accounts' AND entity_id = ? ORDER BY timestamp DESC LIMIT ?`
      ).all(companyId, accountId, limit);
      const jeTouches = db.getDb().prepare(
        `SELECT DISTINCT je.id, je.entry_number, je.date, je.description, je.is_posted, je.posted_by, je.approved_by, je.created_at
         FROM journal_entries je
         JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
         WHERE je.company_id = ? AND jel.account_id = ?
         ORDER BY je.created_at DESC LIMIT ?`
      ).all(companyId, accountId, limit);
      return { account_changes: acctChanges, journal_touches: jeTouches };
    } catch (err: any) { return { error: err?.message, account_changes: [], journal_touches: [] }; }
  });

  ipcMain.handle('compliance:validate-je', (_e, { companyId, journalEntryId, date }: any) => {
    try {
      const errors: string[] = [];
      const warnings: string[] = [];
      const locked = db.getDb().prepare(
        `SELECT * FROM period_locks WHERE company_id = ? AND (unlocked_at IS NULL OR unlocked_at = '')
           AND ((period_start != '' AND period_end != '' AND ? >= period_start AND ? <= period_end)
                OR (locked_through_date != '' AND ? <= locked_through_date))
         LIMIT 1`
      ).get(companyId, date, date, date);
      if (locked) errors.push(`Period is locked through ${(locked as any).period_end || (locked as any).locked_through_date}.`);

      const lines = db.getDb().prepare(
        `SELECT jel.*, a.name AS account_name, a.code, a.allow_direct_posting, a.attachment_required, a.attachment_threshold
         FROM journal_entry_lines jel
         JOIN accounts a ON a.id = jel.account_id
         WHERE jel.journal_entry_id = ?`
      ).all(journalEntryId) as any[];

      for (const l of lines) {
        if (l.allow_direct_posting === 0) {
          errors.push(`Account ${l.code} ${l.account_name} does not allow direct posting (control account).`);
        }
        const amt = Math.abs((l.debit || 0) - (l.credit || 0));
        if (l.attachment_required && amt >= (l.attachment_threshold || 0)) {
          let hasDoc = false;
          try {
            const doc = db.getDb().prepare(
              `SELECT id FROM documents WHERE entity_type = 'journal_entry' AND entity_id = ? LIMIT 1`
            ).get(journalEntryId);
            hasDoc = !!doc;
          } catch { /* documents table may not exist */ }
          if (!hasDoc) errors.push(`Account ${l.code} ${l.account_name} requires an attachment for amounts ≥ $${l.attachment_threshold}.`);
        }
      }
      return { ok: errors.length === 0, errors, warnings };
    } catch (err: any) { return { ok: true, errors: [], warnings: [err?.message] }; }
  });

  ipcMain.handle('compliance:1099-report', (_e, { companyId, year }: any) => {
    try {
      const start = `${year}-01-01`;
      const end = `${year}-12-31`;
      return db.getDb().prepare(
        `SELECT v.id AS vendor_id, v.name AS vendor_name, v.tax_id,
                a.id AS account_id, a.code, a.name AS account_name,
                SUM(COALESCE(jel.debit,0) - COALESCE(jel.credit,0)) AS amount
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         JOIN accounts a ON a.id = jel.account_id
         LEFT JOIN bills b ON b.id = je.source_id AND je.source_type = 'bill'
         LEFT JOIN vendors v ON v.id = b.vendor_id
         WHERE je.company_id = ? AND je.is_posted = 1
           AND date(je.date) >= date(?) AND date(je.date) <= date(?) -- DATE: Item #7 — date() wrap so timestamp values match and end-day is inclusive.
           AND a.is_1099_eligible = 1 AND v.id IS NOT NULL
         GROUP BY v.id, a.id
         HAVING amount >= 600
         ORDER BY v.name, a.code`
      ).all(companyId, start, end);
    } catch { return []; }
  });

  ipcMain.handle('compliance:tax-line-export', (_e, { companyId, periodStart, periodEnd }: any) => {
    try {
      return db.getDb().prepare(
        `SELECT a.tax_line, a.code, a.name, a.type,
                SUM(COALESCE(jel.debit,0)) AS total_debit,
                SUM(COALESCE(jel.credit,0)) AS total_credit,
                SUM(COALESCE(jel.debit,0) - COALESCE(jel.credit,0)) AS net
         FROM accounts a
         LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
         LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
           AND je.company_id = ? AND je.is_posted = 1 AND date(je.date) >= date(?) AND date(je.date) <= date(?) -- DATE: Item #7 — date() wrap so timestamp values match and end-day is inclusive.
         WHERE a.company_id = ? AND a.tax_line != ''
         GROUP BY a.id ORDER BY a.tax_line, a.code`
      ).all(companyId, periodStart, periodEnd, companyId);
    } catch { return []; }
  });

  // ═══ Chart of Accounts — Round 2 (2026-04-23) ═══
  // F2: Permission check (callable from JE handler)
  ipcMain.handle('compliance:check-account-perm', (_e, { companyId, accountId, role, action }: { companyId: string; accountId: string; role: string; action: 'post' | 'view' }) => {
    try {
      const row = db.getDb().prepare(
        `SELECT can_post, can_view FROM account_permissions WHERE company_id = ? AND account_id = ? AND role = ?`
      ).get(companyId, accountId, role || '') as any;
      // No row = unrestricted (default allow)
      if (!row) return { allowed: true };
      const allowed = action === 'post' ? !!row.can_post : !!row.can_view;
      return { allowed, reason: allowed ? '' : `Role "${role}" lacks ${action} permission for this account` };
    } catch (err: any) { return { allowed: true, error: err?.message }; }
  });

  // F6: FX revaluation
  ipcMain.handle('fx:revalue', (_e, { companyId, date, rates }: { companyId: string; date: string; rates: Record<string, number> }) => {
    try {
      const dbi = db.getDb();
      const fxAccts = dbi.prepare(
        `SELECT id, code, name, type, currency FROM accounts WHERE company_id = ? AND COALESCE(currency,'USD') != 'USD' AND COALESCE(deleted_at,'') = ''`
      ).all(companyId) as any[];
      // Find / create FX gain & loss
      const findOrCreate = (name: string, code: string): string => {
        const ex = dbi.prepare("SELECT id FROM accounts WHERE company_id = ? AND name = ? LIMIT 1").get(companyId, name) as any;
        if (ex?.id) return ex.id;
        const c = db.create('accounts', { company_id: companyId, code, name, type: name.includes('Loss') ? 'expense' : 'revenue', subtype: 'Other Income' });
        return c.id;
      };
      const gainId = findOrCreate('Unrealized FX Gain', '4910');
      const lossId = findOrCreate('Unrealized FX Loss', '7910');
      const je = db.create('journal_entries', {
        company_id: companyId, entry_number: `FX-${date}`, date,
        description: `FX revaluation as of ${date}`, is_posted: 1, is_adjusting: 1,
      });
      let lines = 0;
      for (const a of fxAccts) {
        const rate = rates[a.currency] || 1;
        const balRow = dbi.prepare(
          `SELECT COALESCE(SUM(jel.debit - jel.credit),0) as bal FROM journal_entry_lines jel
           JOIN journal_entries je ON jel.journal_entry_id = je.id
           WHERE jel.account_id = ? AND je.company_id = ? AND date(je.date) <= date(?) /* DATE: Item #7 — wrap for inclusive end-of-day */`
        ).get(a.id, companyId, date) as any;
        const currentBal = Number(balRow?.bal) || 0;
        const target = currentBal * rate;
        const diff = target - currentBal;
        if (Math.abs(diff) < 0.005) continue;
        const isDebitNormal = ['asset', 'expense'].includes(a.type);
        if (diff > 0) {
          db.create('journal_entry_lines', { journal_entry_id: je.id, account_id: a.id, debit: isDebitNormal ? diff : 0, credit: isDebitNormal ? 0 : diff, description: `FX adj ${a.code}` });
          db.create('journal_entry_lines', { journal_entry_id: je.id, account_id: gainId, debit: 0, credit: diff, description: `FX gain ${a.code}` });
        } else {
          const d = -diff;
          db.create('journal_entry_lines', { journal_entry_id: je.id, account_id: a.id, debit: isDebitNormal ? 0 : d, credit: isDebitNormal ? d : 0, description: `FX adj ${a.code}` });
          db.create('journal_entry_lines', { journal_entry_id: je.id, account_id: lossId, debit: d, credit: 0, description: `FX loss ${a.code}` });
        }
        lines++;
      }
      return { success: true, entry_id: je.id, accounts_revalued: lines };
    } catch (err: any) { return { error: err?.message }; }
  });

  // F8: Detect dormant accounts
  ipcMain.handle('accounts:detect-dormant', (_e, { companyId, months }: { companyId: string; months?: number }) => {
    try {
      const m = months || 12;
      const rows = db.getDb().prepare(
        `SELECT a.id, a.code, a.name,
          (SELECT MAX(je.date) FROM journal_entry_lines jel
           JOIN journal_entries je ON jel.journal_entry_id = je.id
           WHERE jel.account_id = a.id AND je.company_id = ?) as last_date
         FROM accounts a WHERE a.company_id = ? AND COALESCE(a.deleted_at,'') = '' AND a.is_active = 1`
      ).all(companyId, companyId) as any[];
      const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - m);
      const cutoffStr = cutoff.toISOString().slice(0, 10);
      const dormant = rows.filter(r => !r.last_date || r.last_date < cutoffStr);
      return { dormant: dormant.map(r => r.id), details: dormant };
    } catch (err: any) { return { error: err?.message, dormant: [] }; }
  });

  // F11: QuickBooks IIF import (parse !ACCNT lines)
  ipcMain.handle('accounts:parse-iif', (_e, { text }: { text: string }) => {
    try {
      const lines = text.split(/\r?\n/);
      let header: string[] = [];
      const out: Array<{ name: string; type: string; description?: string }> = [];
      const typeMap: Record<string, string> = {
        BANK: 'asset', AR: 'asset', AP: 'liability', OCASSET: 'asset', FIXASSET: 'asset',
        OASSET: 'asset', CCARD: 'liability', OCLIAB: 'liability', LTLIAB: 'liability',
        EQUITY: 'equity', INC: 'revenue', INCOME: 'revenue', OINC: 'revenue',
        EXP: 'expense', EXPENSE: 'expense', OEXP: 'expense', COGS: 'expense',
      };
      for (const ln of lines) {
        if (ln.startsWith('!ACCNT')) header = ln.split('\t');
        else if (ln.startsWith('ACCNT') && header.length) {
          const cells = ln.split('\t');
          const get = (k: string) => cells[header.indexOf(k)] || '';
          const name = get('NAME').trim();
          const accntType = get('ACCNTTYPE').trim().toUpperCase();
          if (!name) continue;
          out.push({ name, type: typeMap[accntType] || 'asset', description: get('DESC') });
        }
      }
      return { accounts: out };
    } catch (err: any) { return { error: err?.message, accounts: [] }; }
  });

  // F11/F12: Bulk-create accounts from imported list
  ipcMain.handle('accounts:bulk-create', (_e, { companyId, accounts }: { companyId: string; accounts: Array<any> }) => {
    try {
      const dbi = db.getDb();
      const existing = new Set<string>(
        (dbi.prepare('SELECT code FROM accounts WHERE company_id = ?').all(companyId) as any[]).map(r => r.code)
      );
      let created = 0; let skipped = 0;
      const tx = dbi.transaction(() => {
        for (const a of accounts) {
          if (!a.code || !a.name) { skipped++; continue; }
          if (existing.has(a.code)) { skipped++; continue; }
          db.create('accounts', {
            company_id: companyId, code: a.code, name: a.name,
            type: a.type || 'asset', subtype: a.subtype || '',
            description: a.description || '',
          });
          existing.add(a.code); created++;
        }
      });
      tx();
      return { success: true, created, skipped };
    } catch (err: any) { return { error: err?.message }; }
  });

  // F13: TurboTax TXF export
  ipcMain.handle('accounts:export-txf', (_e, { companyId, year }: { companyId: string; year: number }) => {
    try {
      const dbi = db.getDb();
      const accts = dbi.prepare(
        `SELECT a.id, a.code, a.name, a.type, a.tax_line FROM accounts a
         WHERE a.company_id = ? AND a.type IN ('revenue','expense') AND COALESCE(a.tax_line,'') != ''`
      ).all(companyId) as any[];
      const start = `${year}-01-01`, end = `${year}-12-31`;
      const lines: string[] = [];
      lines.push(`V042`); lines.push(`ABusiness Accounting Pro`);
      lines.push(`D ${localToday().replace(/-/g, '/')}`);
      lines.push(`^`);
      for (const a of accts) {
        const balRow = dbi.prepare(
          `SELECT COALESCE(SUM(jel.debit - jel.credit),0) as bal FROM journal_entry_lines jel
           JOIN journal_entries je ON jel.journal_entry_id = je.id
           WHERE jel.account_id = ? AND je.company_id = ? AND date(je.date) >= date(?) AND date(je.date) <= date(?) -- DATE: Item #7 — date() wrap so timestamp values match and end-day is inclusive.`
        ).get(a.id, companyId, start, end) as any;
        const sign = a.type === 'revenue' ? -1 : 1;
        const amt = sign * (Number(balRow?.bal) || 0);
        if (Math.abs(amt) < 0.005) continue;
        lines.push(`TS`);
        lines.push(`N${a.tax_line}`);
        lines.push(`C1`);
        lines.push(`L1`);
        lines.push(`$${amt.toFixed(2)}`);
        lines.push(`X${a.code} ${a.name}`);
        lines.push(`^`);
      }
      return { txf: lines.join('\n'), count: accts.length };
    } catch (err: any) { return { error: err?.message }; }
  });

  // F15: Merge preview
  ipcMain.handle('accounts:merge-preview', (_e, { sourceId }: { sourceId: string }) => {
    try {
      const dbi = db.getDb();
      const count = (sql: string) => {
        try { const r = dbi.prepare(sql).get(sourceId) as any; return Number(r?.c) || 0; } catch { return 0; }
      };
      return {
        journal_lines: count('SELECT COUNT(*) as c FROM journal_entry_lines WHERE account_id = ?'),
        invoice_lines: count('SELECT COUNT(*) as c FROM invoice_line_items WHERE account_id = ?'),
        bills: count('SELECT COUNT(*) as c FROM bills WHERE account_id = ?'),
        expenses: count('SELECT COUNT(*) as c FROM expenses WHERE account_id = ?'),
        children: count('SELECT COUNT(*) as c FROM accounts WHERE parent_id = ?'),
      };
    } catch (err: any) { return { error: err?.message }; }
  });

  // F16: Account split
  ipcMain.handle('accounts:split', (_e, { companyId, sourceAccountId, targetAccountId, dateFrom, dateTo, descriptionPattern }: { companyId: string; sourceAccountId: string; targetAccountId: string; dateFrom: string; dateTo: string; descriptionPattern: string }) => {
    try {
      const dbi = db.getDb();
      const re = new RegExp(descriptionPattern || '.*', 'i');
      const lines = dbi.prepare(
        `SELECT jel.id, jel.description as ldesc, je.description as jdesc
         FROM journal_entry_lines jel JOIN journal_entries je ON jel.journal_entry_id = je.id
         WHERE jel.account_id = ? AND je.company_id = ? AND date(je.date) >= date(?) AND date(je.date) <= date(?) -- DATE: Item #7 — date() wrap so timestamp values match and end-day is inclusive.`
      ).all(sourceAccountId, companyId, dateFrom, dateTo) as any[];
      const matchIds = lines.filter(l => re.test(String(l.ldesc || '')) || re.test(String(l.jdesc || ''))).map(l => l.id);
      const stmt = dbi.prepare('UPDATE journal_entry_lines SET account_id = ? WHERE id = ?');
      const tx = dbi.transaction((ids: string[]) => { for (const id of ids) stmt.run(targetAccountId, id); });
      tx(matchIds);
      db.logAudit(companyId, 'account', sourceAccountId, 'update', { _action: 'split', moved: matchIds.length, to: targetAccountId });
      return { success: true, moved: matchIds.length };
    } catch (err: any) { return { error: err?.message }; }
  });

  // F17: Renumber with audit
  ipcMain.handle('accounts:renumber', (_e, { companyId, accountId, newCode }: { companyId: string; accountId: string; newCode: string }) => {
    try {
      const dbi = db.getDb();
      const acct = dbi.prepare('SELECT code FROM accounts WHERE id = ?').get(accountId) as any;
      if (!acct) return { error: 'Account not found' };
      dbi.prepare("UPDATE accounts SET code = ?, updated_at = datetime('now') WHERE id = ?").run(newCode, accountId);
      db.logAudit(companyId, 'account', accountId, 'update', { _action: 'renumber', old_code: acct.code, new_code: newCode });
      return { success: true };
    } catch (err: any) { return { error: err?.message }; }
  });

  // F18: Soft delete / restore
  ipcMain.handle('accounts:soft-delete', (_e, { accountId }: { accountId: string }) => {
    try {
      db.getDb().prepare("UPDATE accounts SET deleted_at = datetime('now'), is_active = 0 WHERE id = ?").run(accountId);
      return { success: true };
    } catch (err: any) { return { error: err?.message }; }
  });
  ipcMain.handle('accounts:restore', (_e, { accountId }: { accountId: string }) => {
    try {
      db.getDb().prepare("UPDATE accounts SET deleted_at = '', is_active = 1 WHERE id = ?").run(accountId);
      return { success: true };
    } catch (err: any) { return { error: err?.message }; }
  });

  // F19: Opening balance from prior TB import
  ipcMain.handle('accounts:import-opening-tb', (_e, { companyId, date, rows }: { companyId: string; date: string; rows: Array<{ code: string; balance: number }> }) => {
    try {
      const dbi = db.getDb();
      let obe = dbi.prepare("SELECT * FROM accounts WHERE company_id = ? AND name = 'Opening Balance Equity' LIMIT 1").get(companyId) as any;
      if (!obe) {
        obe = db.create('accounts', { company_id: companyId, code: '3900', name: 'Opening Balance Equity', type: 'equity', subtype: "Owner's Equity" });
      }
      const je = db.create('journal_entries', {
        company_id: companyId, entry_number: `OB-TB-${date}`, date,
        description: `Opening trial balance import`, is_posted: 1, is_adjusting: 1,
      });
      let totalDr = 0, totalCr = 0, applied = 0, skipped = 0;
      for (const r of rows) {
        const a = dbi.prepare('SELECT * FROM accounts WHERE company_id = ? AND code = ?').get(companyId, r.code) as any;
        if (!a) { skipped++; continue; }
        const amt = Number(r.balance) || 0;
        if (Math.abs(amt) < 0.005) continue;
        const isDebitNormal = ['asset', 'expense'].includes(a.type);
        const dr = (isDebitNormal && amt > 0) || (!isDebitNormal && amt < 0) ? Math.abs(amt) : 0;
        const cr = dr > 0 ? 0 : Math.abs(amt);
        db.create('journal_entry_lines', { journal_entry_id: je.id, account_id: a.id, debit: dr, credit: cr, description: 'Opening TB' });
        totalDr += dr; totalCr += cr; applied++;
      }
      const offset = totalDr - totalCr;
      if (Math.abs(offset) > 0.005) {
        db.create('journal_entry_lines', { journal_entry_id: je.id, account_id: obe.id, debit: offset < 0 ? -offset : 0, credit: offset > 0 ? offset : 0, description: 'OBE offset' });
      }
      return { success: true, entry_id: je.id, applied, skipped };
    } catch (err: any) { return { error: err?.message }; }
  });

  // F25: Snapshot daily balances
  ipcMain.handle('accounts:snapshot-balances', (_e, { companyId, date }: { companyId: string; date?: string }) => {
    try {
      const dbi = db.getDb();
      const d = date || localToday();
      const accts = dbi.prepare(
        `SELECT a.id,
          COALESCE((SELECT SUM(jel.debit - jel.credit) FROM journal_entry_lines jel
            JOIN journal_entries je ON jel.journal_entry_id = je.id
            WHERE jel.account_id = a.id AND je.company_id = ? AND date(je.date) <= date(?) /* DATE: Item #7 — wrap for inclusive end-of-day */),0) as bal
         FROM accounts a WHERE a.company_id = ? AND COALESCE(a.deleted_at,'') = ''`
      ).all(companyId, d, companyId) as any[];
      const upsert = dbi.prepare(
        `INSERT INTO account_balance_history (id, date, account_id, balance) VALUES (?, ?, ?, ?)
         ON CONFLICT(date, account_id) DO UPDATE SET balance = excluded.balance`
      );
      const tx = dbi.transaction(() => {
        for (const a of accts) upsert.run(uuid(), d, a.id, Number(a.bal) || 0);
      });
      tx();
      return { success: true, count: accts.length, date: d };
    } catch (err: any) { return { error: err?.message }; }
  });

  // F23: Natural-side check (warn helper)
  ipcMain.handle('accounts:natural-side-check', (_e, { accountId, debit, credit }: { accountId: string; debit: number; credit: number }) => {
    try {
      const a = db.getDb().prepare('SELECT type FROM accounts WHERE id = ?').get(accountId) as any;
      if (!a) return { warn: false };
      const isDebitNormal = ['asset', 'expense'].includes(a.type);
      const unusual = (isDebitNormal && credit > 0 && debit === 0) || (!isDebitNormal && debit > 0 && credit === 0);
      return { warn: unusual, message: unusual ? `Unusual side for ${a.type} account` : '' };
    } catch (err: any) { return { warn: false, error: err?.message }; }
  });

  // F24: Suggest account from description
  ipcMain.handle('accounts:classify', (_e, { companyId, description }: { companyId: string; description: string }) => {
    try {
      const rules = db.getDb().prepare(
        `SELECT pattern, account_id FROM account_classify_rules WHERE company_id = ?`
      ).all(companyId) as any[];
      for (const r of rules) {
        try {
          const re = new RegExp(r.pattern, 'i');
          if (re.test(description || '')) return { account_id: r.account_id, matched: r.pattern };
        } catch { /* invalid regex */ }
      }
      return { account_id: null };
    } catch (err: any) { return { error: err?.message, account_id: null }; }
  });

  // F3: Watchlist threshold check (writes notification rows)
  ipcMain.handle('accounts:watchlist-check', (_e, { companyId }: { companyId: string }) => {
    try {
      const dbi = db.getDb();
      const watches = dbi.prepare('SELECT * FROM account_watches').all() as any[];
      let triggered = 0;
      for (const w of watches) {
        const sumRow = dbi.prepare(
          `SELECT COALESCE(SUM(ABS(jel.debit) + ABS(jel.credit)),0) as activity
           FROM journal_entry_lines jel JOIN journal_entries je ON jel.journal_entry_id = je.id
           WHERE jel.account_id = ? AND je.company_id = ? AND je.date >= date('now','-30 days')`
        ).get(w.account_id, companyId) as any;
        const activity = Number(sumRow?.activity) || 0;
        if (w.threshold_amount > 0 && activity > w.threshold_amount) {
          try {
            db.create('notifications', {
              company_id: companyId, user_id: w.user_id || '',
              type: 'account_watch', message: `Account watch: 30-day activity ${activity.toFixed(2)} exceeds threshold ${Number(w.threshold_amount).toFixed(2)}`,
              entity_type: 'account', entity_id: w.account_id, is_read: 0,
            });
          } catch { /* notifications schema may differ */ }
          triggered++;
        }
      }
      return { success: true, triggered };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('compliance:sod-report', (_e, { companyId, periodStart, periodEnd }: any) => {
    try {
      return db.getDb().prepare(
        `SELECT id, entry_number, date, description, approved_by, posted_by
         FROM journal_entries
         WHERE company_id = ? AND date >= ? AND date <= ? AND is_posted = 1
           AND approved_by != '' AND posted_by != '' AND approved_by = posted_by
         ORDER BY date DESC`
      ).all(companyId, periodStart, periodEnd);
    } catch { return []; }
  });

  // ─── JE round 2: undo recent N posted entries (creates reversing JEs) ──
  ipcMain.handle('je:undo-recent', (_e, { companyId, n, userId }: { companyId: string; n: number; userId: string }) => {
    try {
      const dbInstance = db.getDb();
      const rows = dbInstance.prepare(
        `SELECT * FROM journal_entries
         WHERE company_id = ? AND is_posted = 1
           AND (posted_by = ? OR created_by = ?)
         ORDER BY datetime(updated_at) DESC, datetime(created_at) DESC
         LIMIT ?`
      ).all(companyId, userId, userId, Math.max(1, Math.min(n || 1, 50))) as any[];
      let count = 0;
      for (const je of rows) {
        const lines = dbInstance.prepare(
          `SELECT * FROM journal_entry_lines WHERE journal_entry_id = ?`
        ).all(je.id) as any[];
        const newId = uuid();
        const today = localToday();
        const numRow = dbInstance.prepare(
          "SELECT entry_number FROM journal_entries WHERE company_id = ? ORDER BY CAST(SUBSTR(entry_number, INSTR(entry_number, '-') + 1) AS INTEGER) DESC LIMIT 1"
        ).get(companyId) as any;
        let nextNum = 'JE-1001';
        if (numRow?.entry_number) {
          const m = numRow.entry_number.match(/(\d+)$/);
          if (m) nextNum = numRow.entry_number.slice(0, -m[1].length) + String(parseInt(m[1], 10) + 1).padStart(m[1].length, '0');
        }
        dbInstance.prepare(
          `INSERT INTO journal_entries (id, company_id, entry_number, date, description, reference, is_posted, reversed_from_id)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
        ).run(newId, companyId, nextNum, today, `Undo of ${je.entry_number}: ${(je.description || '').slice(0, 200)}`, je.reference || '', je.id);
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          dbInstance.prepare(
            `INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit, credit, description, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).run(uuid(), newId, l.account_id, l.credit || 0, l.debit || 0, l.description || '', i);
        }
        count++;
      }
      return { count };
    } catch (err: any) { return { error: err?.message || 'undo failed' }; }
  });

  // ─── JE round 2: detect gaps in entry_number sequence ──
  ipcMain.handle('je:gap-detect', (_e, { companyId }: { companyId: string }) => {
    try {
      const rows = db.getDb().prepare(
        `SELECT entry_number FROM journal_entries WHERE company_id = ? ORDER BY entry_number ASC`
      ).all(companyId) as any[];
      const byPrefix: Record<string, Array<{ n: number; padLen: number }>> = {};
      for (const r of rows) {
        const m = (r.entry_number || '').match(/^(.*?)(\d+)$/);
        if (m) (byPrefix[m[1]] ||= []).push({ n: parseInt(m[2], 10), padLen: m[2].length });
      }
      const gaps: string[] = [];
      for (const [prefix, arr] of Object.entries(byPrefix)) {
        arr.sort((a, b) => a.n - b.n);
        for (let i = 1; i < arr.length; i++) {
          for (let g = arr[i - 1].n + 1; g < arr[i].n; g++) {
            gaps.push(`${prefix}${String(g).padStart(arr[i].padLen, '0')}`);
            if (gaps.length >= 25) return { gaps };
          }
        }
      }
      return { gaps };
    } catch (err: any) { return { gaps: [], error: err?.message }; }
  });

  // ─── JE round 2: snapshot a JE into je_history before edits ──
  ipcMain.handle('je:snapshot', (_e, { jeId, userId }: { jeId: string; userId: string }) => {
    try {
      const dbi = db.getDb();
      const je = dbi.prepare(`SELECT * FROM journal_entries WHERE id = ?`).get(jeId) as any;
      if (!je) return { error: 'not found' };
      const lines = dbi.prepare(`SELECT * FROM journal_entry_lines WHERE journal_entry_id = ? ORDER BY sort_order`).all(jeId) as any[];
      const version = (je.version ?? 1) as number;
      dbi.prepare(
        `INSERT INTO je_history (id, je_id, version, snapshot_json, changed_by) VALUES (?, ?, ?, ?, ?)`
      ).run(uuid(), jeId, version, JSON.stringify({ entry: je, lines }), userId || '');
      dbi.prepare(`UPDATE journal_entries SET version = ? WHERE id = ?`).run(version + 1, jeId);
      return { ok: true, version };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('je:history-list', (_e, { jeId }: { jeId: string }) => {
    try {
      return db.getDb().prepare(
        `SELECT id, version, changed_at, changed_by FROM je_history WHERE je_id = ? ORDER BY version DESC`
      ).all(jeId);
    } catch { return []; }
  });

  ipcMain.handle('je:history-rollback', (_e, { historyId, userId }: { historyId: string; userId: string }) => {
    try {
      const dbi = db.getDb();
      const h = dbi.prepare(`SELECT * FROM je_history WHERE id = ?`).get(historyId) as any;
      if (!h) return { error: 'not found' };
      const snap = JSON.parse(h.snapshot_json || '{}');
      if (!snap?.entry) return { error: 'bad snapshot' };
      const e = snap.entry;
      const cur = dbi.prepare(`SELECT * FROM journal_entries WHERE id = ?`).get(h.je_id) as any;
      if (cur) {
        const curLines = dbi.prepare(`SELECT * FROM journal_entry_lines WHERE journal_entry_id = ? ORDER BY sort_order`).all(h.je_id) as any[];
        dbi.prepare(`INSERT INTO je_history (id, je_id, version, snapshot_json, changed_by) VALUES (?, ?, ?, ?, ?)`)
          .run(uuid(), h.je_id, cur.version ?? 1, JSON.stringify({ entry: cur, lines: curLines }), userId || '');
      }
      dbi.prepare(
        `UPDATE journal_entries SET date=?, description=?, reference=?, class=?, version = COALESCE(version,1)+1 WHERE id=?`
      ).run(e.date, e.description || '', e.reference || '', e.class || '', h.je_id);
      dbi.prepare(`DELETE FROM journal_entry_lines WHERE journal_entry_id = ?`).run(h.je_id);
      const lines = Array.isArray(snap.lines) ? snap.lines : [];
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        dbi.prepare(
          `INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit, credit, description, sort_order, line_memo)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(uuid(), h.je_id, l.account_id, l.debit || 0, l.credit || 0, l.description || '', i, l.line_memo || '');
      }
      return { ok: true };
    } catch (err: any) { return { error: err?.message }; }
  });

  // ═══ Round 2: Period Close + Reconciliation + Compliance (2026-04-23) ═══

  // 1. Soft vs hard lock — supersede check-date-lock
  ipcMain.handle('close:check-date-lock-v2', (_e, { companyId, date }: { companyId: string; date: string }) => {
    try {
      const row = db.getDb().prepare(
        `SELECT id, period_start, period_end, reason, locked_through_date, COALESCE(lock_level, 'hard') AS lock_level
         FROM period_locks
         WHERE company_id = ? AND (unlocked_at IS NULL OR unlocked_at = '')
           AND ((period_start != '' AND period_end != '' AND ? >= period_start AND ? <= period_end)
                OR (locked_through_date != '' AND ? <= locked_through_date))
         ORDER BY created_at DESC LIMIT 1`
      ).get(companyId, date, date, date) as any;
      if (!row) return { locked: false, level: 'none', lock: null };
      return { locked: row.lock_level === 'hard', warn: row.lock_level === 'soft', level: row.lock_level, lock: row };
    } catch (err: any) { return { locked: false, error: err?.message }; }
  });

  ipcMain.handle('close:lock-period-v2', (_e, { companyId, periodStart, periodEnd, lockedBy, reason, lockLevel }: any) => {
    try {
      const id = uuid();
      db.getDb().prepare(
        `INSERT INTO period_locks (id, company_id, period_start, period_end, locked_through_date, locked_by, reason, note, lock_level)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(id, companyId, periodStart || '', periodEnd || '', periodEnd || '', lockedBy || '', reason || '', reason || '',
            lockLevel === 'soft' ? 'soft' : 'hard');
      db.logAudit(companyId, 'period_lock', id, 'create', { periodStart, periodEnd, reason, lockLevel });
      return { id };
    } catch (err: any) { return { error: err?.message }; }
  });

  // 2. Pre-close report bundle
  ipcMain.handle('close:pre-close-bundle', (_e, { companyId, periodStart, periodEnd }: any) => {
    try {
      const tb = db.getDb().prepare(
        `SELECT a.code, a.name, a.type,
                SUM(COALESCE(jel.debit,0)) AS debit_sum,
                SUM(COALESCE(jel.credit,0)) AS credit_sum
         FROM accounts a
         LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
         LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
           AND je.company_id = ? AND je.is_posted = 1 AND date(je.date) >= date(?) AND date(je.date) <= date(?) -- DATE: Item #7 — date() wrap so timestamp values match and end-day is inclusive.
         WHERE a.company_id = ?
         GROUP BY a.id ORDER BY a.code`
      ).all(companyId, periodStart, periodEnd, companyId);
      const recons = db.getDb().prepare(
        `SELECT r.*, a.code, a.name FROM account_reconciliations r
         LEFT JOIN accounts a ON a.id = r.account_id
         WHERE r.company_id = ? AND r.as_of_date <= ? ORDER BY r.as_of_date DESC LIMIT 50`
      ).all(companyId, periodEnd);
      let openBills: any[] = [];
      try {
        openBills = db.getDb().prepare(
          `SELECT bill_number, date, total - COALESCE(amount_paid,0) AS open_amount, status
           FROM bills WHERE company_id = ? AND COALESCE(amount_paid,0) < total AND date <= ?`
        ).all(companyId, periodEnd) as any[];
      } catch { /* table may not exist */ }
      const openInvoices = db.getDb().prepare(
        `SELECT invoice_number, date, total - COALESCE(amount_paid,0) AS open_amount, status
         FROM invoices WHERE company_id = ? AND COALESCE(amount_paid,0) < total AND date <= ?`
      ).all(companyId, periodEnd);
      return { tb, recons, openBills, openInvoices };
    } catch (err: any) { return { error: err?.message }; }
  });

  // 3. Adjustment categorization breakdown
  ipcMain.handle('close:adjustment-breakdown', (_e, { companyId, periodStart, periodEnd }: any) => {
    try {
      return db.getDb().prepare(
        `SELECT COALESCE(NULLIF(adjustment_category,''),'uncategorized') AS category,
                COUNT(*) AS count,
                SUM((SELECT SUM(COALESCE(debit,0)) FROM journal_entry_lines WHERE journal_entry_id = je.id)) AS total_debit
         FROM journal_entries je
         WHERE company_id = ? AND is_posted = 1 AND date >= ? AND date <= ?
         GROUP BY category ORDER BY total_debit DESC`
      ).all(companyId, periodStart, periodEnd);
    } catch { return []; }
  });

  // 4. Email digest
  ipcMain.handle('close:email-digest', (_e, { companyId, logId }: any) => {
    try {
      const log = db.getDb().prepare(`SELECT * FROM period_close_log WHERE id = ?`).get(logId) as any;
      if (!log) return { error: 'close log not found' };
      const ps = log.period_start; const pe = log.period_end;
      const totals = db.getDb().prepare(
        `SELECT a.type, SUM(COALESCE(jel.credit,0) - COALESCE(jel.debit,0)) AS net
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         JOIN accounts a ON a.id = jel.account_id
         WHERE je.company_id = ? AND je.is_posted = 1 AND date(je.date) >= date(?) AND date(je.date) <= date(?) -- DATE: Item #7 — date() wrap so timestamp values match and end-day is inclusive.
           AND a.type IN ('revenue','expense')
         GROUP BY a.type`
      ).all(companyId, ps, pe) as any[];
      const rev = totals.find(t => t.type === 'revenue')?.net || 0;
      const exp = -(totals.find(t => t.type === 'expense')?.net || 0);
      const jeCount = (db.getDb().prepare(
        `SELECT COUNT(*) AS c FROM journal_entries WHERE company_id = ? AND is_posted = 1 AND date >= ? AND date <= ?`
      ).get(companyId, ps, pe) as any)?.c || 0;
      const recipients = (db.getDb().prepare(
        `SELECT value FROM settings WHERE key = 'period_close_notify_emails'`
      ).get() as any)?.value || '';
      const html = `<h1>Period Close Digest: ${ps} → ${pe}</h1>
        <ul>
          <li>Revenue: ${rev.toFixed(2)}</li>
          <li>Expense: ${exp.toFixed(2)}</li>
          <li>Net income: ${(rev - exp).toFixed(2)}</li>
          <li>Posted JEs: ${jeCount}</li>
          <li>Closed by: ${log.closed_by}</li>
        </ul>
        <p>Recipients: ${recipients}</p>`;
      db.getDb().prepare(`UPDATE period_close_log SET digest_html = ? WHERE id = ?`).run(html, logId);
      return { html, recipients, totals: { revenue: rev, expense: exp, netIncome: rev - exp, jeCount } };
    } catch (err: any) { return { error: err?.message }; }
  });

  // 5. Period roll-forward (idempotent)
  ipcMain.handle('close:roll-forward', (_e, { companyId, logId }: any) => {
    try {
      const log = db.getDb().prepare(`SELECT * FROM period_close_log WHERE id = ?`).get(logId) as any;
      if (!log) return { error: 'log not found' };
      if (log.roll_forward_done) return { ok: true, alreadyDone: true };
      const balances = db.getDb().prepare(
        `SELECT a.id AS account_id,
                SUM(COALESCE(jel.debit,0) - COALESCE(jel.credit,0)) AS balance
         FROM accounts a
         LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
         LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
           AND je.company_id = ? AND je.is_posted = 1 AND date(je.date) <= date(?) /* DATE: Item #7 — wrap for inclusive end-of-day */
         WHERE a.company_id = ? GROUP BY a.id`
      ).all(companyId, log.period_end, companyId) as any[];
      let count = 0;
      for (const b of balances) {
        if (Math.abs(b.balance || 0) < 0.005) continue;
        try {
          db.getDb().prepare(
            `INSERT INTO account_balance_history (id, company_id, account_id, as_of_date, balance, source)
             VALUES (?,?,?,?,?,?)`
          ).run(uuid(), companyId, b.account_id, log.period_end, b.balance, 'period_roll_forward');
          count++;
        } catch { /* table may not exist */ }
      }
      db.getDb().prepare(`UPDATE period_close_log SET roll_forward_done = 1 WHERE id = ?`).run(logId);
      return { ok: true, snapshotCount: count };
    } catch (err: any) { return { error: err?.message }; }
  });

  // 6. Reopen preview / commit
  ipcMain.handle('close:reopen-preview', (_e, { logId }: any) => {
    try {
      const log = db.getDb().prepare(`SELECT * FROM period_close_log WHERE id = ?`).get(logId) as any;
      if (!log) return { error: 'log not found' };
      const closingJe = log.closing_je_id ? db.getDb().prepare(
        `SELECT je.id, je.entry_number, je.date,
                (SELECT SUM(COALESCE(debit,0)) FROM journal_entry_lines WHERE journal_entry_id = je.id) AS total
         FROM journal_entries je WHERE je.id = ?`
      ).get(log.closing_je_id) : null;
      return { log, closingJe };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('close:reopen-commit', (_e, { logId, reopenedBy, reason }: any) => {
    try {
      const log = db.getDb().prepare(`SELECT * FROM period_close_log WHERE id = ?`).get(logId) as any;
      if (!log) return { error: 'log not found' };
      if (log.closing_je_id) {
        const lines = db.getDb().prepare(`SELECT * FROM journal_entry_lines WHERE journal_entry_id = ?`).all(log.closing_je_id) as any[];
        if (lines.length) {
          const newId = uuid();
          db.getDb().prepare(
            `INSERT INTO journal_entries (id, company_id, entry_number, date, description, is_posted, is_closing, posted_by, reversed_from_id)
             VALUES (?,?,?,?,?,1,1,?,?)`
          ).run(newId, log.company_id, `REOPEN-${log.period_end}`, log.period_end,
                `Reverse closing entry (period reopen: ${reason || ''})`, reopenedBy || '', log.closing_je_id);
          let lineNo = 0;
          for (const l of lines) {
            db.getDb().prepare(
              `INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit, credit, description, sort_order)
               VALUES (?,?,?,?,?,?,?)`
            ).run(uuid(), newId, l.account_id, l.credit || 0, l.debit || 0, `Reverse: ${l.description || ''}`, lineNo++);
          }
        }
      }
      db.getDb().prepare(
        `UPDATE period_locks SET unlocked_at = datetime('now'), unlocked_by = ?, unlock_reason = ?
         WHERE company_id = ? AND period_start = ? AND period_end = ? AND (unlocked_at IS NULL OR unlocked_at = '')`
      ).run(reopenedBy || '', reason || 'period reopen', log.company_id, log.period_start, log.period_end);
      db.getDb().prepare(
        `UPDATE period_close_log SET reopened_at = datetime('now'), reopened_by = ? WHERE id = ?`
      ).run(reopenedBy || '', logId);
      db.logAudit(log.company_id, 'period_close', logId, 'reopen', { reason, reopenedBy });
      return { ok: true };
    } catch (err: any) { return { error: err?.message }; }
  });

  // 8. Short-period close
  ipcMain.handle('close:short-period-commit', (_e, { companyId, periodStart, periodEnd, closedBy, reason }: any) => {
    try {
      const lockId = uuid();
      db.getDb().prepare(
        `INSERT INTO period_locks (id, company_id, period_start, period_end, locked_through_date, locked_by, reason, lock_level)
         VALUES (?,?,?,?,?,?,?,?)`
      ).run(lockId, companyId, periodStart, periodEnd, periodEnd, closedBy || '',
            reason || `Short-period close ${periodStart} → ${periodEnd}`, 'hard');
      const logId = uuid();
      db.getDb().prepare(
        `INSERT INTO period_close_log (id, company_id, period_start, period_end, closed_at, closed_by, net_income, is_short_period)
         VALUES (?,?,?,?,datetime('now'),?,0,1)`
      ).run(logId, companyId, periodStart, periodEnd, closedBy || '');
      db.logAudit(companyId, 'period_close', logId, 'short_period_close', { periodStart, periodEnd, reason });
      return { ok: true, logId };
    } catch (err: any) { return { error: err?.message }; }
  });

  // 9 & 10. Cycle dashboard / heat map
  ipcMain.handle('close:cycle-dashboard', (_e, { companyId }: any) => {
    try {
      const closes = db.getDb().prepare(
        `SELECT period_start, period_end, closed_at, closed_by, net_income, is_short_period, reopened_at
         FROM period_close_log WHERE company_id = ? ORDER BY period_end DESC LIMIT 36`
      ).all(companyId) as any[];
      const locks = db.getDb().prepare(
        `SELECT period_start, period_end, locked_through_date, COALESCE(lock_level,'hard') AS lock_level, unlocked_at
         FROM period_locks WHERE company_id = ? ORDER BY created_at DESC LIMIT 60`
      ).all(companyId) as any[];
      const checklists = db.getDb().prepare(
        `SELECT period_label, COUNT(*) AS total, SUM(CASE WHEN completed_at != '' THEN 1 ELSE 0 END) AS done
         FROM period_close_checklist WHERE company_id = ? GROUP BY period_label`
      ).all(companyId) as any[];
      return { closes, locks, checklists };
    } catch (err: any) { return { error: err?.message, closes: [], locks: [], checklists: [] }; }
  });

  // 11. Recon items
  ipcMain.handle('recon:items-list', (_e, { companyId, accountId, asOfDate }: any) => {
    try {
      return db.getDb().prepare(
        `SELECT * FROM account_reconciliation_items
         WHERE company_id = ? AND account_id = ? AND as_of_date = ? ORDER BY created_at`
      ).all(companyId, accountId, asOfDate);
    } catch { return []; }
  });

  ipcMain.handle('recon:item-save', (_e, payload: any) => {
    try {
      const id = payload.id || uuid();
      const existing = payload.id ? db.getDb().prepare(`SELECT id FROM account_reconciliation_items WHERE id = ?`).get(id) : null;
      if (existing) {
        db.getDb().prepare(
          `UPDATE account_reconciliation_items SET note = ?, status = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(payload.note || '', payload.status || 'open', id);
      } else {
        db.getDb().prepare(
          `INSERT INTO account_reconciliation_items
           (id, company_id, account_id, as_of_date, transaction_id, transaction_kind, reference, amount, note, status, confidence, delta, rolled_from_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).run(id, payload.companyId, payload.accountId, payload.asOfDate || '',
              payload.transactionId || '', payload.transactionKind || '', payload.reference || '',
              payload.amount || 0, payload.note || '', payload.status || 'open',
              payload.confidence || 0, payload.delta || 0, payload.rolledFromId || '');
      }
      return { id };
    } catch (err: any) { return { error: err?.message }; }
  });

  // 12 & 20. Auto-match v2 with confidence stars + delta
  ipcMain.handle('recon:auto-match-v2', (_e, { companyId, accountId, asOfDate }: any) => {
    try {
      const account = db.getById('accounts', accountId);
      if (!account) return { matches: [], suggestions: [] };
      const subRes = db.getDb().prepare(
        `SELECT id, invoice_number AS reference, date, total - COALESCE(amount_paid,0) AS amount
         FROM invoices WHERE company_id = ? AND date <= ? AND COALESCE(amount_paid,0) < total`
      ).all(companyId, asOfDate) as any[];
      const glLines = db.getDb().prepare(
        `SELECT jel.id, jel.debit, jel.credit, jel.description, je.entry_number, je.date
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         WHERE jel.account_id = ? AND je.company_id = ? AND je.is_posted = 1 AND date(je.date) <= date(?) /* DATE: Item #7 — wrap for inclusive end-of-day */`
      ).all(accountId, companyId, asOfDate) as any[];

      const matches: any[] = [];
      const suggestions: any[] = [];
      for (const subItem of subRes) {
        const subAmt = Math.abs(subItem.amount || 0);
        const subDate = new Date(subItem.date).getTime();
        let bestG: any = null; let bestStars = 0; let bestReason = '';
        for (const g of glLines) {
          const glAmt = Math.abs((g.debit || 0) - (g.credit || 0));
          const exact = Math.abs(glAmt - subAmt) < 0.01;
          const close = Math.abs(glAmt - subAmt) <= 1;
          const dayDiff = Math.abs((new Date(g.date).getTime() - subDate) / 86400000);
          const refMatch = subItem.reference && (g.entry_number === subItem.reference || (g.description || '').includes(subItem.reference));
          let stars = 0; const reasons: string[] = [];
          if (exact) { stars += 2; reasons.push('amount-exact'); }
          else if (close) { stars += 1; reasons.push('amount-close'); }
          if (dayDiff <= 1) { stars += 2; reasons.push('date-1d'); }
          else if (dayDiff <= 7) { stars += 1; reasons.push('date-7d'); }
          if (refMatch) { stars += 1; reasons.push('reference'); }
          if (stars > bestStars) { bestStars = stars; bestG = g; bestReason = reasons.join('+'); }
        }
        if (bestG && bestStars >= 4) {
          const glAmt = Math.abs((bestG.debit || 0) - (bestG.credit || 0));
          matches.push({ sub: subItem, gl: bestG, reason: bestReason, confidence: Math.min(5, bestStars), delta: glAmt - subAmt });
        } else if (bestG && bestStars >= 2) {
          const glAmt = Math.abs((bestG.debit || 0) - (bestG.credit || 0));
          suggestions.push({ sub: subItem, gl: bestG, reason: bestReason, confidence: Math.min(5, bestStars), delta: glAmt - subAmt });
        }
      }
      return { matches, suggestions };
    } catch (err: any) { return { error: err?.message, matches: [], suggestions: [] }; }
  });

  // 13. Import statement
  ipcMain.handle('recon:import-statement', (_e, { companyId, accountId, asOfDate, statementBalance, rows, importedBy }: any) => {
    try {
      const id = uuid();
      db.getDb().prepare(
        `INSERT INTO recon_imports (id, company_id, account_id, as_of_date, statement_balance, rows_json, imported_by)
         VALUES (?,?,?,?,?,?,?)`
      ).run(id, companyId, accountId, asOfDate || '', statementBalance || 0, JSON.stringify(rows || []), importedBy || '');
      return { id };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('recon:imports-list', (_e, { companyId, accountId }: any) => {
    try {
      return db.getDb().prepare(
        `SELECT * FROM recon_imports WHERE company_id = ? AND account_id = ? ORDER BY imported_at DESC`
      ).all(companyId, accountId);
    } catch { return []; }
  });

  // 15. Multi-account recon
  ipcMain.handle('recon:multi-compute', (_e, { companyId, asOfDate }: any) => {
    try {
      const accounts = db.getDb().prepare(
        `SELECT id, code, name, type, subtype FROM accounts WHERE company_id = ?
         AND (LOWER(name) LIKE '%receivable%' OR LOWER(name) LIKE '%payable%' OR LOWER(name) LIKE '%inventory%')
         ORDER BY code`
      ).all(companyId) as any[];
      return accounts.map((a) => {
        const gl = db.getDb().prepare(
          `SELECT SUM(COALESCE(jel.debit,0) - COALESCE(jel.credit,0)) AS bal
           FROM journal_entry_lines jel
           JOIN journal_entries je ON je.id = jel.journal_entry_id
           WHERE jel.account_id = ? AND je.company_id = ? AND je.is_posted = 1 AND date(je.date) <= date(?) /* DATE: Item #7 — wrap for inclusive end-of-day */`
        ).get(a.id, companyId, asOfDate) as any;
        const glBal = a.type === 'liability' ? -(gl?.bal || 0) : (gl?.bal || 0);
        let subTotal = 0;
        const n = (a.name || '').toLowerCase();
        if (n.includes('receivable')) {
          const r = db.getDb().prepare(
            `SELECT SUM(total - COALESCE(amount_paid,0)) AS s FROM invoices WHERE company_id = ? AND date <= ? AND COALESCE(amount_paid,0) < total`
          ).get(companyId, asOfDate) as any;
          subTotal = r?.s || 0;
        } else if (n.includes('payable')) {
          try {
            const r = db.getDb().prepare(
              `SELECT SUM(total - COALESCE(amount_paid,0)) AS s FROM bills WHERE company_id = ? AND date <= ? AND COALESCE(amount_paid,0) < total`
            ).get(companyId, asOfDate) as any;
            subTotal = r?.s || 0;
          } catch { /* */ }
        }
        return { account_id: a.id, code: a.code, name: a.name, gl: glBal, sub: subTotal, variance: subTotal - glBal };
      });
    } catch (err: any) { return { error: err?.message }; }
  });

  // 16. Recon schedule
  ipcMain.handle('recon:schedule-list', (_e, { companyId }: any) => {
    try {
      return db.getDb().prepare(
        `SELECT s.*, a.code, a.name FROM recon_schedule s
         LEFT JOIN accounts a ON a.id = s.account_id
         WHERE s.company_id = ? ORDER BY s.next_due`
      ).all(companyId);
    } catch { return []; }
  });

  ipcMain.handle('recon:schedule-save', (_e, data: any) => {
    try {
      const id = data.id || uuid();
      const existing = data.id ? db.getDb().prepare(`SELECT id FROM recon_schedule WHERE id = ?`).get(id) : null;
      const today = new Date();
      const next = new Date(today);
      const f = data.frequency || 'monthly';
      if (f === 'weekly') next.setDate(next.getDate() + 7);
      else if (f === 'quarterly') next.setMonth(next.getMonth() + 3);
      else next.setMonth(next.getMonth() + 1);
      const nextStr = next.toISOString().slice(0, 10);
      if (existing) {
        db.getDb().prepare(
          `UPDATE recon_schedule SET frequency = ?, threshold = ?, next_due = ? WHERE id = ?`
        ).run(f, data.threshold || 0, data.nextDue || nextStr, id);
      } else {
        db.getDb().prepare(
          `INSERT INTO recon_schedule (id, company_id, account_id, frequency, threshold, next_due)
           VALUES (?,?,?,?,?,?)`
        ).run(id, data.companyId, data.accountId, f, data.threshold || 0, data.nextDue || nextStr);
      }
      return { id };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('recon:schedule-delete', (_e, { id }: any) => {
    try { db.getDb().prepare(`DELETE FROM recon_schedule WHERE id = ?`).run(id); return { ok: true }; }
    catch (err: any) { return { error: err?.message }; }
  });

  // 17. Variance threshold check
  ipcMain.handle('recon:auto-approve-check', (_e, { companyId, accountId, variance }: any) => {
    try {
      const sched = db.getDb().prepare(
        `SELECT threshold FROM recon_schedule WHERE company_id = ? AND account_id = ? LIMIT 1`
      ).get(companyId, accountId) as any;
      const threshold = sched?.threshold || 0;
      return { autoApprove: threshold > 0 && Math.abs(variance) <= threshold, threshold };
    } catch { return { autoApprove: false, threshold: 0 }; }
  });

  // 18 & 19. Prior-period link + rollover
  ipcMain.handle('recon:prior-period', (_e, { companyId, accountId, asOfDate }: any) => {
    try {
      const prior = db.getDb().prepare(
        `SELECT * FROM account_reconciliations WHERE company_id = ? AND account_id = ? AND as_of_date < ?
         ORDER BY as_of_date DESC LIMIT 1`
      ).get(companyId, accountId, asOfDate) as any;
      if (!prior) return { prior: null, uncleared: [] };
      const uncleared = db.getDb().prepare(
        `SELECT * FROM account_reconciliation_items WHERE recon_id = ? AND status = 'open'`
      ).all(prior.id);
      return { prior, uncleared };
    } catch (err: any) { return { error: err?.message, prior: null, uncleared: [] }; }
  });

  // 21 & 22. SOX controls + tests
  ipcMain.handle('sox:controls-list', (_e, { companyId }: any) => {
    try {
      return db.getDb().prepare(
        `SELECT c.*,
         (SELECT result FROM sox_control_tests WHERE control_id = c.id ORDER BY tested_at DESC LIMIT 1) AS last_result,
         (SELECT tested_at FROM sox_control_tests WHERE control_id = c.id ORDER BY tested_at DESC LIMIT 1) AS last_tested_at,
         (SELECT COUNT(*) FROM sox_control_tests WHERE control_id = c.id) AS test_count
         FROM sox_controls c WHERE c.company_id = ? ORDER BY c.code`
      ).all(companyId);
    } catch { return []; }
  });

  ipcMain.handle('sox:control-save', (_e, data: any) => {
    try {
      const id = data.id || uuid();
      const existing = data.id ? db.getDb().prepare(`SELECT id FROM sox_controls WHERE id = ?`).get(id) : null;
      if (existing) {
        db.getDb().prepare(
          `UPDATE sox_controls SET code=?, description=?, owner=?, frequency=?, risk=? WHERE id = ?`
        ).run(data.code || '', data.description || '', data.owner || '', data.frequency || '', data.risk || '', id);
      } else {
        db.getDb().prepare(
          `INSERT INTO sox_controls (id, company_id, code, description, owner, frequency, risk)
           VALUES (?,?,?,?,?,?,?)`
        ).run(id, data.companyId, data.code || '', data.description || '', data.owner || '', data.frequency || '', data.risk || '');
      }
      return { id };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('sox:control-delete', (_e, { id }: any) => {
    try { db.getDb().prepare(`DELETE FROM sox_controls WHERE id = ?`).run(id); return { ok: true }; }
    catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('sox:tests-list', (_e, { controlId }: any) => {
    try {
      return db.getDb().prepare(
        `SELECT * FROM sox_control_tests WHERE control_id = ? ORDER BY tested_at DESC`
      ).all(controlId);
    } catch { return []; }
  });

  ipcMain.handle('sox:test-save', (_e, data: any) => {
    try {
      const id = uuid();
      db.getDb().prepare(
        `INSERT INTO sox_control_tests (id, control_id, company_id, tested_by, tested_at, result, evidence, notes)
         VALUES (?,?,?,?,?,?,?,?)`
      ).run(id, data.controlId, data.companyId, data.testedBy || '',
            data.testedAt || localToday(),
            data.result || 'pass', data.evidence || '', data.notes || '');
      db.getDb().prepare(`UPDATE sox_controls SET last_reviewed_at = datetime('now') WHERE id = ?`).run(data.controlId);
      return { id };
    } catch (err: any) { return { error: err?.message }; }
  });

  // 24. Audit-letter data
  ipcMain.handle('compliance:audit-letter-data', (_e, { companyId, asOfDate }: any) => {
    try {
      const company = db.getById('companies', companyId);
      const balances = db.getDb().prepare(
        `SELECT a.code, a.name, a.type,
                SUM(COALESCE(jel.debit,0) - COALESCE(jel.credit,0)) AS balance
         FROM accounts a
         LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
         LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
           AND je.company_id = ? AND je.is_posted = 1 AND date(je.date) <= date(?) /* DATE: Item #7 — wrap for inclusive end-of-day */
         WHERE a.company_id = ? GROUP BY a.id ORDER BY a.code`
      ).all(companyId, asOfDate, companyId);
      return { company, asOfDate, balances };
    } catch (err: any) { return { error: err?.message }; }
  });

  // 26. Hash chain verify (heals missing hashes; flags tampering)
  ipcMain.handle('compliance:hash-chain-verify', (_e, { companyId, limit = 1000 }: any) => {
    try {
      const rows = db.getDb().prepare(
        `SELECT id, entity_type, entity_id, action, changes, performed_by, timestamp,
                COALESCE(prev_hash,'') AS prev_hash, COALESCE(row_hash,'') AS row_hash
         FROM audit_log WHERE company_id = ? ORDER BY timestamp ASC, id ASC LIMIT ?`
      ).all(companyId, limit) as any[];
      let prev = '';
      const issues: any[] = [];
      let healed = 0;
      for (const r of rows) {
        const payload = JSON.stringify({
          id: r.id, entity_type: r.entity_type, entity_id: r.entity_id,
          action: r.action, changes: r.changes, performed_by: r.performed_by, timestamp: r.timestamp,
        });
        const expected = crypto.createHash('sha256').update(prev + payload).digest('hex');
        if (!r.row_hash || !r.prev_hash) {
          db.getDb().prepare(`UPDATE audit_log SET prev_hash = ?, row_hash = ? WHERE id = ?`).run(prev, expected, r.id);
          healed++;
        } else if (r.row_hash !== expected || r.prev_hash !== prev) {
          issues.push({ id: r.id, expected, actual: r.row_hash });
        }
        prev = expected;
      }
      return { ok: issues.length === 0, total: rows.length, issues, healed };
    } catch (err: any) { return { error: err?.message }; }
  });

  // 27/28/29. Approval rules + approval recording
  ipcMain.handle('compliance:approval-rules-get', () => {
    try {
      const get = (k: string) => (db.getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(k) as any)?.value;
      return {
        twoFactorThreshold: Number(get('je_two_factor_threshold') || 0),
        commentThreshold: Number(get('je_comment_threshold') || 0),
        blockSelfApproval: get('je_block_self_approval') !== '0',
      };
    } catch { return { twoFactorThreshold: 0, commentThreshold: 0, blockSelfApproval: true }; }
  });

  ipcMain.handle('compliance:approval-rules-save', (_e, data: any) => {
    try {
      const set = (k: string, v: string) => {
        const existing = db.getDb().prepare(`SELECT key FROM settings WHERE key = ?`).get(k);
        if (existing) db.getDb().prepare(`UPDATE settings SET value = ? WHERE key = ?`).run(v, k);
        else db.getDb().prepare(`INSERT INTO settings (key, value) VALUES (?,?)`).run(k, v);
      };
      set('je_two_factor_threshold', String(data.twoFactorThreshold || 0));
      set('je_comment_threshold', String(data.commentThreshold || 0));
      set('je_block_self_approval', data.blockSelfApproval ? '1' : '0');
      return { ok: true };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('compliance:approve-je', (_e, { journalEntryId, approver, comment }: any) => {
    try {
      const je = db.getById('journal_entries', journalEntryId) as any;
      if (!je) return { error: 'JE not found' };
      const lines = db.getDb().prepare(
        `SELECT SUM(COALESCE(debit,0)) AS total FROM journal_entry_lines WHERE journal_entry_id = ?`
      ).get(journalEntryId) as any;
      const total = lines?.total || 0;
      const get = (k: string) => (db.getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(k) as any)?.value;
      const twoFactor = Number(get('je_two_factor_threshold') || 0);
      const commentTh = Number(get('je_comment_threshold') || 0);
      const blockSelf = get('je_block_self_approval') !== '0';

      if (blockSelf && (je.created_by === approver || je.posted_by === approver)) {
        return { error: 'Self-approval blocked: creator/poster cannot approve.' };
      }
      if (commentTh > 0 && total >= commentTh && !(comment || '').trim()) {
        return { error: `Comment required for JEs ≥ $${commentTh}.` };
      }

      const existingApprovals = db.getDb().prepare(
        `SELECT DISTINCT approver FROM je_approvals WHERE journal_entry_id = ?`
      ).all(journalEntryId) as any[];
      if (existingApprovals.some((a: any) => a.approver === approver)) {
        return { error: 'You have already approved this entry.' };
      }
      db.getDb().prepare(
        `INSERT INTO je_approvals (id, journal_entry_id, approver, comment) VALUES (?,?,?,?)`
      ).run(uuid(), journalEntryId, approver || '', comment || '');

      const approvers = new Set(existingApprovals.map((a: any) => a.approver).concat([approver]));
      const needTwo = twoFactor > 0 && total >= twoFactor;
      const fullyApproved = !needTwo || approvers.size >= 2;

      if (fullyApproved) {
        db.getDb().prepare(`UPDATE journal_entries SET approval_status = 'approved', approved_by = ? WHERE id = ?`)
          .run(Array.from(approvers).join(','), journalEntryId);
      } else {
        db.getDb().prepare(`UPDATE journal_entries SET approval_status = 'partially_approved' WHERE id = ?`).run(journalEntryId);
      }
      db.logAudit(je.company_id, 'journal_entry', journalEntryId, 'approve',
        { approver, comment, total, fullyApproved, approverCount: approvers.size });
      return { ok: true, fullyApproved, approverCount: approvers.size };
    } catch (err: any) { return { error: err?.message }; }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Workflow + Numbering + Email Templates (2026-04-23)
  // Features 1–30 — see CLAUDE.md domain spec
  // ═══════════════════════════════════════════════════════════════════════

  const ENTITY_TYPES = ['invoice','quote','expense','bill','debt','project','purchase_order','journal_entry'];

  const DEFAULT_STATUSES: Record<string, Array<{ key: string; label: string; color: string; icon: string; sort_order: number; is_terminal?: number }>> = {
    invoice: [
      { key: 'draft', label: 'Draft', color: '#9ca3af', icon: 'FileEdit', sort_order: 0 },
      { key: 'sent', label: 'Sent', color: '#3b82f6', icon: 'Send', sort_order: 1 },
      { key: 'partial', label: 'Partial', color: '#f59e0b', icon: 'PieChart', sort_order: 2 },
      { key: 'paid', label: 'Paid', color: '#10b981', icon: 'CheckCircle2', sort_order: 3, is_terminal: 1 },
      { key: 'overdue', label: 'Overdue', color: '#ef4444', icon: 'AlertCircle', sort_order: 4 },
      { key: 'void', label: 'Void', color: '#6b7280', icon: 'Ban', sort_order: 5, is_terminal: 1 },
    ],
    quote: [
      { key: 'draft', label: 'Draft', color: '#9ca3af', icon: 'FileEdit', sort_order: 0 },
      { key: 'sent', label: 'Sent', color: '#3b82f6', icon: 'Send', sort_order: 1 },
      { key: 'accepted', label: 'Accepted', color: '#10b981', icon: 'CheckCircle2', sort_order: 2, is_terminal: 1 },
      { key: 'declined', label: 'Declined', color: '#ef4444', icon: 'XCircle', sort_order: 3, is_terminal: 1 },
      { key: 'expired', label: 'Expired', color: '#6b7280', icon: 'Clock', sort_order: 4, is_terminal: 1 },
    ],
    expense: [
      { key: 'draft', label: 'Draft', color: '#9ca3af', icon: 'FileEdit', sort_order: 0 },
      { key: 'submitted', label: 'Submitted', color: '#3b82f6', icon: 'Send', sort_order: 1 },
      { key: 'approved', label: 'Approved', color: '#10b981', icon: 'CheckCircle2', sort_order: 2 },
      { key: 'reimbursed', label: 'Reimbursed', color: '#8b5cf6', icon: 'DollarSign', sort_order: 3, is_terminal: 1 },
      { key: 'rejected', label: 'Rejected', color: '#ef4444', icon: 'XCircle', sort_order: 4, is_terminal: 1 },
    ],
    bill: [
      { key: 'draft', label: 'Draft', color: '#9ca3af', icon: 'FileEdit', sort_order: 0 },
      { key: 'received', label: 'Received', color: '#3b82f6', icon: 'Inbox', sort_order: 1 },
      { key: 'approved', label: 'Approved', color: '#06b6d4', icon: 'CheckCircle2', sort_order: 2 },
      { key: 'paid', label: 'Paid', color: '#10b981', icon: 'DollarSign', sort_order: 3, is_terminal: 1 },
      { key: 'void', label: 'Void', color: '#6b7280', icon: 'Ban', sort_order: 4, is_terminal: 1 },
    ],
    debt: [
      { key: 'new', label: 'New', color: '#9ca3af', icon: 'AlertCircle', sort_order: 0 },
      { key: 'in_collection', label: 'In Collection', color: '#f59e0b', icon: 'Phone', sort_order: 1 },
      { key: 'promise', label: 'Promise', color: '#3b82f6', icon: 'HandCoins', sort_order: 2 },
      { key: 'paid', label: 'Paid', color: '#10b981', icon: 'CheckCircle2', sort_order: 3, is_terminal: 1 },
      { key: 'written_off', label: 'Written Off', color: '#6b7280', icon: 'Ban', sort_order: 4, is_terminal: 1 },
    ],
    project: [
      { key: 'planning', label: 'Planning', color: '#9ca3af', icon: 'ClipboardList', sort_order: 0 },
      { key: 'active', label: 'Active', color: '#3b82f6', icon: 'Activity', sort_order: 1 },
      { key: 'on_hold', label: 'On Hold', color: '#f59e0b', icon: 'Pause', sort_order: 2 },
      { key: 'completed', label: 'Completed', color: '#10b981', icon: 'CheckCircle2', sort_order: 3, is_terminal: 1 },
      { key: 'cancelled', label: 'Cancelled', color: '#6b7280', icon: 'Ban', sort_order: 4, is_terminal: 1 },
    ],
    purchase_order: [
      { key: 'draft', label: 'Draft', color: '#9ca3af', icon: 'FileEdit', sort_order: 0 },
      { key: 'sent', label: 'Sent', color: '#3b82f6', icon: 'Send', sort_order: 1 },
      { key: 'received', label: 'Received', color: '#10b981', icon: 'Package', sort_order: 2, is_terminal: 1 },
      { key: 'cancelled', label: 'Cancelled', color: '#6b7280', icon: 'Ban', sort_order: 3, is_terminal: 1 },
    ],
    journal_entry: [
      { key: 'draft', label: 'Draft', color: '#9ca3af', icon: 'FileEdit', sort_order: 0 },
      { key: 'posted', label: 'Posted', color: '#10b981', icon: 'CheckCircle2', sort_order: 1, is_terminal: 1 },
      { key: 'reversed', label: 'Reversed', color: '#ef4444', icon: 'Undo2', sort_order: 2, is_terminal: 1 },
    ],
  };

  const DEFAULT_EMAIL_TEMPLATES: Record<string, { label: string; subject: string; body: string; tokens: string[] }> = {
    invoice_send: {
      label: 'Invoice — Send',
      subject: 'Invoice {{invoice_number}} from {{company_name}}',
      body: 'Hi {{client_name}},\n\nPlease find attached invoice **{{invoice_number}}** for **{{total_due}}** due on **{{due_date}}**.\n\nPay online: {{payment_link}}\n\nThanks,\n{{company_name}}',
      tokens: ['client_name','invoice_number','total_due','due_date','company_name','payment_link'],
    },
    payment_reminder_1: {
      label: 'Payment Reminder — First',
      subject: 'Friendly reminder: Invoice {{invoice_number}}',
      body: 'Hi {{client_name}},\n\nThis is a friendly reminder that invoice **{{invoice_number}}** for **{{total_due}}** was due on **{{due_date}}**.\n\nPay online: {{payment_link}}\n\nThanks,\n{{company_name}}',
      tokens: ['client_name','invoice_number','total_due','due_date','company_name','payment_link'],
    },
    payment_reminder_2: {
      label: 'Payment Reminder — Second',
      subject: 'Past due: Invoice {{invoice_number}} — {{days_overdue}} days',
      body: 'Hi {{client_name}},\n\nInvoice **{{invoice_number}}** for **{{total_due}}** is now **{{days_overdue}} days** past due.\n\nPlease remit payment as soon as possible: {{payment_link}}\n\nThanks,\n{{company_name}}',
      tokens: ['client_name','invoice_number','total_due','due_date','days_overdue','company_name','payment_link'],
    },
    overdue_notice: {
      label: 'Overdue Notice',
      subject: 'OVERDUE: Invoice {{invoice_number}} — {{days_overdue}} days past due',
      body: 'Dear {{client_name}},\n\nDespite previous reminders, invoice **{{invoice_number}}** for **{{total_due}}** remains unpaid and is now **{{days_overdue}} days** overdue.\n\nThis matter requires your immediate attention.\n\n{{company_name}}',
      tokens: ['client_name','invoice_number','total_due','days_overdue','company_name'],
    },
    quote_send: {
      label: 'Quote — Send',
      subject: 'Quote {{invoice_number}} from {{company_name}}',
      body: 'Hi {{client_name}},\n\nPlease find attached quote **{{invoice_number}}** for **{{total_due}}**.\n\nThis quote is valid until **{{due_date}}**.\n\nThanks,\n{{company_name}}',
      tokens: ['client_name','invoice_number','total_due','due_date','company_name'],
    },
    statement: {
      label: 'Account Statement',
      subject: 'Statement of Account — {{client_name}}',
      body: 'Hi {{client_name}},\n\nPlease find attached your statement showing a balance of **{{total_due}}**.\n\nThanks,\n{{company_name}}',
      tokens: ['client_name','total_due','company_name'],
    },
    welcome: {
      label: 'Welcome',
      subject: 'Welcome to {{company_name}}',
      body: 'Hi {{client_name}},\n\nThanks for choosing **{{company_name}}**. We look forward to working with you.\n\nBest,\n{{company_name}}',
      tokens: ['client_name','company_name'],
    },
    demand_letter: {
      label: 'Demand Letter',
      subject: 'Final Demand — Invoice {{invoice_number}}',
      body: 'Dear {{client_name}},\n\nThis is a **final demand** for payment of invoice **{{invoice_number}}** in the amount of **{{total_due}}**, currently **{{days_overdue}} days** overdue.\n\nFailure to pay within 10 days may result in legal action.\n\n{{company_name}}',
      tokens: ['client_name','invoice_number','total_due','days_overdue','company_name'],
    },
  };

  function ensureDefaultStatuses(companyId: string) {
    for (const entityType of ENTITY_TYPES) {
      const existing = db.getDb().prepare(
        `SELECT COUNT(*) AS c FROM custom_statuses WHERE company_id = ? AND entity_type = ?`
      ).get(companyId, entityType) as any;
      if (existing?.c) continue;
      for (const s of DEFAULT_STATUSES[entityType] || []) {
        db.getDb().prepare(
          `INSERT INTO custom_statuses (id, company_id, entity_type, key, label, color, icon, sort_order, is_terminal)
           VALUES (?,?,?,?,?,?,?,?,?)`
        ).run(uuid(), companyId, entityType, s.key, s.label, s.color, s.icon, s.sort_order, s.is_terminal || 0);
      }
    }
  }

  function ensureDefaultEmailTemplates(companyId: string) {
    for (const [key, t] of Object.entries(DEFAULT_EMAIL_TEMPLATES)) {
      const existing = db.getDb().prepare(
        `SELECT id FROM email_templates WHERE company_id = ? AND key = ?`
      ).get(companyId, key) as any;
      if (existing) continue;
      const defaultTo = 'client.email';
      db.getDb().prepare(
        `INSERT INTO email_templates (id, company_id, key, label, subject, body, body_format, available_tokens_json, default_to)
         VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(uuid(), companyId, key, t.label, t.subject, t.body, 'markdown', JSON.stringify(t.tokens), defaultTo);
    }
  }

  function ensureDefaultNumberSequences(companyId: string) {
    const defaults: Record<string, { prefix: string; padding: number }> = {
      invoice: { prefix: 'INV-{YYYY}-', padding: 5 },
      bill: { prefix: 'BILL-{YYYY}-', padding: 5 },
      journal_entry: { prefix: 'JE-{YYYY}-{MM}-', padding: 5 },
      debt: { prefix: 'DEBT-', padding: 5 },
      purchase_order: { prefix: 'PO-{YYYY}-', padding: 5 },
      quote: { prefix: 'QT-{YYYY}-', padding: 5 },
      expense: { prefix: 'EXP-', padding: 5 },
      project: { prefix: 'PRJ-{YYYY}-', padding: 4 },
    };
    for (const [entityType, cfg] of Object.entries(defaults)) {
      const existing = db.getDb().prepare(
        `SELECT id FROM number_sequences WHERE company_id = ? AND entity_type = ?`
      ).get(companyId, entityType) as any;
      if (existing) continue;
      db.getDb().prepare(
        `INSERT INTO number_sequences (id, company_id, entity_type, prefix, suffix, padding, current_value, reset_frequency)
         VALUES (?,?,?,?,?,?,?,?)`
      ).run(uuid(), companyId, entityType, cfg.prefix, '', cfg.padding, 0, 'never');
    }
  }

  ipcMain.handle('workflow:statuses-list', (_e, { companyId, entityType }: any) => {
    try {
      ensureDefaultStatuses(companyId);
      const rows = db.getDb().prepare(
        `SELECT * FROM custom_statuses WHERE company_id = ? ${entityType ? 'AND entity_type = ?' : ''} ORDER BY entity_type, sort_order`
      ).all(...(entityType ? [companyId, entityType] : [companyId]));
      return rows;
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('workflow:transitions-list', (_e, { companyId, entityType }: any) => {
    try {
      const rows = db.getDb().prepare(
        `SELECT * FROM status_transitions WHERE company_id = ? ${entityType ? 'AND entity_type = ?' : ''}`
      ).all(...(entityType ? [companyId, entityType] : [companyId]));
      return rows;
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('workflow:transition-validate', (_e, { companyId, entityType, fromStatus, toStatus }: any) => {
    try {
      const transitions = db.getDb().prepare(
        `SELECT * FROM status_transitions WHERE company_id = ? AND entity_type = ?`
      ).all(companyId, entityType) as any[];
      if (transitions.length === 0) return { allowed: true };
      const match = transitions.find((t: any) => t.from_status === fromStatus && t.to_status === toStatus);
      if (!match) return { allowed: false, reason: `Transition ${fromStatus} → ${toStatus} not allowed` };
      return { allowed: true, requiresComment: !!match.requires_comment, requiresApproval: !!match.requires_approval, requiresRole: match.requires_role || '' };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('workflow:status-history', (_e, { companyId, entityType, entityId }: any) => {
    try {
      return db.getDb().prepare(
        `SELECT * FROM entity_status_history WHERE company_id = ? AND entity_type = ? AND entity_id = ? ORDER BY changed_at DESC`
      ).all(companyId, entityType, entityId);
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('workflow:status-change', (_e, { companyId, entityType, entityId, fromStatus, toStatus, comment, changedBy }: any) => {
    try {
      const trans = db.getDb().prepare(
        `SELECT * FROM status_transitions WHERE company_id = ? AND entity_type = ?`
      ).all(companyId, entityType) as any[];
      if (trans.length > 0) {
        const match = trans.find((t: any) => t.from_status === fromStatus && t.to_status === toStatus);
        if (!match) return { error: `Transition ${fromStatus} → ${toStatus} not allowed` };
        if (match.requires_comment && !(comment || '').trim()) return { error: 'Comment required for this transition' };
      }
      db.getDb().prepare(
        `INSERT INTO entity_status_history (id, company_id, entity_type, entity_id, from_status, to_status, changed_by, comment)
         VALUES (?,?,?,?,?,?,?,?)`
      ).run(uuid(), companyId, entityType, entityId, fromStatus || '', toStatus, changedBy || '', comment || '');
      const status = db.getDb().prepare(
        `SELECT notify_users FROM custom_statuses WHERE company_id = ? AND entity_type = ? AND key = ?`
      ).get(companyId, entityType, toStatus) as any;
      if (status?.notify_users) {
        const users = String(status.notify_users).split(',').map((s: string) => s.trim()).filter(Boolean);
        for (const u of users) {
          try {
            db.create('notifications', {
              company_id: companyId,
              user_id: u,
              type: 'status_change',
              title: `${entityType} status → ${toStatus}`,
              message: `${entityType} ${entityId} moved to ${toStatus}${comment ? ': ' + comment : ''}`,
              link: `/${entityType}s/${entityId}`,
            });
          } catch {}
        }
      }
      return { ok: true };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('workflow:bulk-status-change', (_e, { companyId, entityType, entityIds, toStatus, comment, changedBy }: any) => {
    try {
      let success = 0; const errors: any[] = [];
      for (const id of entityIds) {
        try {
          let from = '';
          try {
            const tableName = entityType === 'journal_entry' ? 'journal_entries' : entityType + 's';
            const row = db.getDb().prepare(`SELECT status FROM ${tableName} WHERE id = ?`).get(id) as any;
            from = row?.status || '';
          } catch {}
          db.getDb().prepare(
            `INSERT INTO entity_status_history (id, company_id, entity_type, entity_id, from_status, to_status, changed_by, comment)
             VALUES (?,?,?,?,?,?,?,?)`
          ).run(uuid(), companyId, entityType, id, from, toStatus, changedBy || '', comment || '');
          success++;
        } catch (e: any) { errors.push({ id, error: e?.message }); }
      }
      return { ok: true, success, errors };
    } catch (err: any) { return { error: err?.message }; }
  });

  function resolveTokens(prefix: string, companyId: string): string {
    const now = new Date();
    const yyyy = String(now.getFullYear());
    const yy = yyyy.slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const q = String(Math.floor(now.getMonth() / 3) + 1);
    let companyAbbr = '';
    try {
      const c = db.getById('companies', companyId) as any;
      companyAbbr = (c?.name || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase();
    } catch {}
    return prefix
      .replace(/\{YYYY\}/g, yyyy)
      .replace(/\{YY\}/g, yy)
      .replace(/\{MM\}/g, mm)
      .replace(/\{Q\}/g, q)
      .replace(/\{COMPANY\}/g, companyAbbr);
  }

  function shouldReset(seq: any): boolean {
    if (!seq.last_reset_at || seq.reset_frequency === 'never') return false;
    const last = new Date(seq.last_reset_at);
    const now = new Date();
    if (seq.reset_frequency === 'yearly') return last.getFullYear() !== now.getFullYear();
    if (seq.reset_frequency === 'monthly') return last.getFullYear() !== now.getFullYear() || last.getMonth() !== now.getMonth();
    if (seq.reset_frequency === 'quarterly') {
      const lq = Math.floor(last.getMonth() / 3);
      const nq = Math.floor(now.getMonth() / 3);
      return last.getFullYear() !== now.getFullYear() || lq !== nq;
    }
    return false;
  }

  ipcMain.handle('numbering:list', (_e, { companyId }: any) => {
    try {
      ensureDefaultNumberSequences(companyId);
      return db.getDb().prepare(
        `SELECT * FROM number_sequences WHERE company_id = ? ORDER BY entity_type`
      ).all(companyId);
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('numbering:save', (_e, { id, data }: any) => {
    try {
      if (id) db.update('number_sequences', id, data);
      else db.create('number_sequences', data);
      return { ok: true };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('numbering:preview', (_e, { companyId, entityType }: any) => {
    try {
      ensureDefaultNumberSequences(companyId);
      const seq = db.getDb().prepare(
        `SELECT * FROM number_sequences WHERE company_id = ? AND entity_type = ?`
      ).get(companyId, entityType) as any;
      if (!seq) return { number: '' };
      let next = (seq.current_value || 0) + 1;
      if (shouldReset(seq)) next = 1;
      const padded = String(next).padStart(seq.padding || 5, '0');
      return { number: `${resolveTokens(seq.prefix || '', companyId)}${padded}${seq.suffix || ''}` };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('numbering:generate', (_e, { companyId, entityType, reserve }: any) => {
    try {
      ensureDefaultNumberSequences(companyId);
      const seq = db.getDb().prepare(
        `SELECT * FROM number_sequences WHERE company_id = ? AND entity_type = ?`
      ).get(companyId, entityType) as any;
      if (!seq) return { error: 'sequence not found' };
      let current = seq.current_value || 0;
      if (shouldReset(seq)) {
        current = 0;
        db.getDb().prepare(`UPDATE number_sequences SET last_reset_at = datetime('now') WHERE id = ?`).run(seq.id);
      }
      const next = current + 1;
      db.getDb().prepare(`UPDATE number_sequences SET current_value = ?, updated_at = datetime('now') WHERE id = ?`).run(next, seq.id);
      const padded = String(next).padStart(seq.padding || 5, '0');
      const number = `${resolveTokens(seq.prefix || '', companyId)}${padded}${seq.suffix || ''}`;
      if (reserve) {
        const reserved = JSON.parse(seq.reserved_json || '[]');
        reserved.push({ value: next, number, reserved_at: new Date().toISOString() });
        db.getDb().prepare(`UPDATE number_sequences SET reserved_json = ? WHERE id = ?`).run(JSON.stringify(reserved), seq.id);
      }
      return { number, value: next };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('numbering:release', (_e, { companyId, entityType, value }: any) => {
    try {
      const seq = db.getDb().prepare(
        `SELECT * FROM number_sequences WHERE company_id = ? AND entity_type = ?`
      ).get(companyId, entityType) as any;
      if (!seq) return { error: 'sequence not found' };
      const reserved = JSON.parse(seq.reserved_json || '[]').filter((r: any) => r.value !== value);
      let cv = seq.current_value || 0;
      if (cv === value) cv -= 1;
      db.getDb().prepare(`UPDATE number_sequences SET reserved_json = ?, current_value = ? WHERE id = ?`).run(JSON.stringify(reserved), cv, seq.id);
      return { ok: true };
    } catch (err: any) { return { error: err?.message }; }
  });

  const NUMBER_TABLE_MAP: Record<string, { table: string; col: string }> = {
    invoice: { table: 'invoices', col: 'invoice_number' },
    bill: { table: 'bills', col: 'bill_number' },
    quote: { table: 'quotes', col: 'quote_number' },
    purchase_order: { table: 'purchase_orders', col: 'po_number' },
    expense: { table: 'expenses', col: 'expense_number' },
    debt: { table: 'debts', col: 'debt_number' },
    journal_entry: { table: 'journal_entries', col: 'entry_number' },
  };

  ipcMain.handle('numbering:gaps', (_e, { companyId, entityType }: any) => {
    try {
      const t = NUMBER_TABLE_MAP[entityType];
      if (!t) return { gaps: [], note: 'No table mapping' };
      let rows: any[] = [];
      try {
        rows = db.getDb().prepare(
          `SELECT ${t.col} AS num FROM ${t.table} WHERE company_id = ? AND ${t.col} IS NOT NULL AND ${t.col} != '' ORDER BY ${t.col}`
        ).all(companyId);
      } catch { return { gaps: [], note: 'Number column not present' }; }
      const nums = rows.map((r: any) => {
        const m = String(r.num).match(/(\d+)(?!.*\d)/);
        return m ? parseInt(m[1], 10) : null;
      }).filter((n): n is number => n !== null).sort((a, b) => a - b);
      const gaps: number[] = [];
      for (let i = 1; i < nums.length; i++) {
        for (let g = nums[i - 1] + 1; g < nums[i]; g++) gaps.push(g);
      }
      return { gaps, total: nums.length, min: nums[0] || 0, max: nums[nums.length - 1] || 0 };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('numbering:renumber', (_e, { companyId, entityType, dryRun }: any) => {
    try {
      const t = NUMBER_TABLE_MAP[entityType];
      if (!t) return { error: 'No table mapping' };
      const seq = db.getDb().prepare(
        `SELECT * FROM number_sequences WHERE company_id = ? AND entity_type = ?`
      ).get(companyId, entityType) as any;
      if (!seq) return { error: 'sequence not found' };
      let rows: any[] = [];
      try {
        rows = db.getDb().prepare(
          `SELECT id, ${t.col} AS num FROM ${t.table} WHERE company_id = ? ORDER BY created_at`
        ).all(companyId);
      } catch { return { error: 'Renumber not supported for this entity' }; }
      const changes: Array<{ id: string; from: string; to: string }> = [];
      let n = 1;
      for (const r of rows) {
        const padded = String(n).padStart(seq.padding || 5, '0');
        const newNum = `${resolveTokens(seq.prefix || '', companyId)}${padded}${seq.suffix || ''}`;
        if (r.num !== newNum) changes.push({ id: r.id, from: r.num || '', to: newNum });
        n++;
      }
      if (!dryRun) {
        for (const c of changes) {
          try {
            db.getDb().prepare(`UPDATE ${t.table} SET ${t.col} = ? WHERE id = ?`).run(c.to, c.id);
            db.logAudit(companyId, entityType, c.id, 'renumber', { from: c.from, to: c.to });
          } catch {}
        }
        db.getDb().prepare(`UPDATE number_sequences SET current_value = ?, updated_at = datetime('now') WHERE id = ?`).run(n - 1, seq.id);
      }
      return { ok: true, changes, count: changes.length };
    } catch (err: any) { return { error: err?.message }; }
  });

  function resolveTemplateTokens(body: string, ctx: Record<string, any>): string {
    return body.replace(/\{\{\s*([\w_]+)\s*\}\}/g, (_m, key) => {
      const v = ctx[key];
      if (v === undefined || v === null) return `{{${key}}}`;
      return String(v);
    });
  }

  // Format an amount in a specific ISO 4217 currency (mirrors renderer's
  // formatCurrency) so {{total_due}} reflects the document's currency
  // rather than always defaulting to USD.
  function fmtMoney(amount: number, currency?: string | null): string {
    const code = (currency || 'USD').toString().trim().toUpperCase();
    const n = Number.isFinite(amount) ? amount : 0;
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(n);
    } catch {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
    }
  }

  // Resolve the portal deep-link for an invoice — looks up the token in
  // invoice_tokens (creating one would require side effects, so we just
  // look it up). Returns empty string if no token exists yet.
  //
  // The base URL supports three formats so admins can swap portal
  // endpoints without recompiling:
  //   1. {token} placeholder substitution
  //   2. /login → appends ?invoice=<token> query param
  //   3. anything else → appends /<token> path segment
  // Default points at https://rmpgutahps.us/client/login (RMPG Pro
  // Services portal). Override per-tenant via the portal_base_url
  // setting (settings table, key='portal_base_url').
  function buildPortalUrl(base: string, token: string): string {
    const url = (base || '').trim();
    if (!url) return '';
    if (url.includes('{token}')) return url.replace(/\{token\}/g, token);
    const noTrail = url.replace(/\/$/, '');
    if (/\/login$/i.test(noTrail)) return `${noTrail}?invoice=${encodeURIComponent(token)}`;
    return `${noTrail}/${token}`;
  }
  function resolvePortalLink(invoiceId: string, fallbackBase: string = 'https://rmpgutahps.us/client/login'): string {
    try {
      // Allow per-company override via settings table
      const companyId = db.getCurrentCompanyId();
      let base = fallbackBase;
      if (companyId) {
        const setting = db.getDb().prepare(
          "SELECT value FROM settings WHERE company_id = ? AND key = 'portal_base_url'"
        ).get(companyId) as any;
        if (setting?.value) base = setting.value;
      }
      const row = db.getDb().prepare(
        `SELECT token FROM invoice_tokens WHERE invoice_id = ? AND expires_at > 0 ORDER BY expires_at DESC LIMIT 1`
      ).get(invoiceId) as any;
      if (row?.token) return buildPortalUrl(base, row.token);
    } catch { /* ignore */ }
    return '';
  }

  function buildTemplateContext(companyId: string, entityType: string, entityId: string): Record<string, any> {
    const ctx: Record<string, any> = {};
    try {
      const co = db.getById('companies', companyId) as any;
      ctx.company_name = co?.name || '';
      ctx.company_email = co?.email || '';
      ctx.company_phone = co?.phone || '';
    } catch {}
    try {
      if (entityType === 'invoice') {
        const inv = db.getById('invoices', entityId) as any;
        if (inv) {
          ctx.invoice_number = inv.invoice_number || '';
          // Use real `total` field (schema correction) and honor currency
          const totalNum = Number(inv.total ?? inv.total_amount ?? 0);
          const paid = Number(inv.amount_paid ?? 0);
          ctx.total_due = fmtMoney(totalNum, inv.currency);
          ctx.balance_due = fmtMoney(Math.max(0, totalNum - paid), inv.currency);
          ctx.amount_paid = fmtMoney(paid, inv.currency);
          ctx.due_date = inv.due_date || '';
          ctx.issue_date = inv.issue_date || '';
          if (inv.due_date) {
            const days = Math.floor((Date.now() - new Date(inv.due_date).getTime()) / 86400000);
            ctx.days_overdue = String(Math.max(0, days));
          }
          if (inv.client_id) {
            const client = db.getById('clients', inv.client_id) as any;
            ctx.client_name = client?.name || '';
            ctx.client_email = client?.email || '';
            ctx.client_phone = client?.phone || '';
          }
          // Deep-link to the per-invoice portal page (capability URL)
          ctx.payment_link = resolvePortalLink(inv.id);
          ctx.portal_link = ctx.payment_link;
        }
      } else if (entityType === 'quote') {
        const q = db.getById('quotes', entityId) as any;
        if (q) {
          ctx.invoice_number = q.quote_number || '';
          const totalNum = Number(q.total ?? q.total_amount ?? 0);
          ctx.total_due = fmtMoney(totalNum, q.currency);
          ctx.due_date = q.valid_until || q.expires_at || '';
          ctx.issue_date = q.issue_date || '';
          if (q.client_id) {
            const client = db.getById('clients', q.client_id) as any;
            ctx.client_name = client?.name || '';
            ctx.client_email = client?.email || '';
          }
        }
      } else if (entityType === 'debt') {
        const d = db.getById('debts', entityId) as any;
        if (d) {
          ctx.invoice_number = d.debt_number || d.invoice_number || '';
          ctx.total_due = `$${Number(d.balance || d.original_amount || 0).toFixed(2)}`;
          ctx.due_date = d.original_due_date || '';
          if (d.original_due_date) {
            const days = Math.floor((Date.now() - new Date(d.original_due_date).getTime()) / 86400000);
            ctx.days_overdue = String(Math.max(0, days));
          }
          if (d.client_id) {
            const client = db.getById('clients', d.client_id) as any;
            ctx.client_name = client?.name || '';
            ctx.client_email = client?.email || '';
          }
        }
      }
    } catch {}
    return ctx;
  }

  ipcMain.handle('email-tmpl:list', (_e, { companyId }: any) => {
    try {
      ensureDefaultEmailTemplates(companyId);
      return db.getDb().prepare(
        `SELECT * FROM email_templates WHERE company_id = ? ORDER BY label`
      ).all(companyId);
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('email-tmpl:save', (_e, { id, data, changedBy }: any) => {
    try {
      if (id) {
        const prev = db.getById('email_templates', id) as any;
        if (prev) {
          const lastVer = db.getDb().prepare(
            `SELECT MAX(version) AS v FROM email_template_history WHERE template_id = ?`
          ).get(id) as any;
          const nextVersion = (lastVer?.v || 0) + 1;
          db.getDb().prepare(
            `INSERT INTO email_template_history (id, template_id, version, snapshot_json, changed_by) VALUES (?,?,?,?,?)`
          ).run(uuid(), id, nextVersion, JSON.stringify(prev), changedBy || '');
        }
        db.update('email_templates', id, data);
      } else {
        db.create('email_templates', data);
      }
      return { ok: true };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('email-tmpl:history', (_e, { templateId }: any) => {
    try {
      return db.getDb().prepare(
        `SELECT * FROM email_template_history WHERE template_id = ? ORDER BY version DESC`
      ).all(templateId);
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('email-tmpl:rollback', (_e, { templateId, version, changedBy }: any) => {
    try {
      const snap = db.getDb().prepare(
        `SELECT * FROM email_template_history WHERE template_id = ? AND version = ?`
      ).get(templateId, version) as any;
      if (!snap) return { error: 'Version not found' };
      const data = JSON.parse(snap.snapshot_json);
      const current = db.getById('email_templates', templateId) as any;
      const lastVer = db.getDb().prepare(
        `SELECT MAX(version) AS v FROM email_template_history WHERE template_id = ?`
      ).get(templateId) as any;
      db.getDb().prepare(
        `INSERT INTO email_template_history (id, template_id, version, snapshot_json, changed_by) VALUES (?,?,?,?,?)`
      ).run(uuid(), templateId, (lastVer?.v || 0) + 1, JSON.stringify(current), changedBy || 'rollback');
      db.update('email_templates', templateId, {
        subject: data.subject, body: data.body, body_format: data.body_format,
        available_tokens_json: data.available_tokens_json, default_to: data.default_to,
        default_cc: data.default_cc, default_bcc: data.default_bcc, label: data.label,
      });
      return { ok: true };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('email-tmpl:resolve', (_e, { companyId, templateKey, entityType, entityId, sampleCtx }: any) => {
    try {
      ensureDefaultEmailTemplates(companyId);
      const tmpl = db.getDb().prepare(
        `SELECT * FROM email_templates WHERE company_id = ? AND key = ?`
      ).get(companyId, templateKey) as any;
      if (!tmpl) return { error: 'Template not found' };
      const ctx = sampleCtx || buildTemplateContext(companyId, entityType, entityId);
      return {
        subject: resolveTemplateTokens(tmpl.subject || '', ctx),
        body: resolveTemplateTokens(tmpl.body || '', ctx),
        bodyFormat: tmpl.body_format,
        defaultTo: tmpl.default_to,
        defaultCc: tmpl.default_cc,
        defaultBcc: tmpl.default_bcc,
        ctx,
      };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('email-tmpl:validate', (_e, { body, subject, availableTokens }: any) => {
    try {
      const allTokens: string[] = JSON.parse(availableTokens || '[]');
      const re = /\{\{\s*([\w_]+)\s*\}\}/g;
      const used = new Set<string>();
      const text = `${subject || ''}\n${body || ''}`;
      let m;
      while ((m = re.exec(text)) !== null) used.add(m[1]);
      const unknown = Array.from(used).filter(t => !allTokens.includes(t));
      return { ok: unknown.length === 0, unknown, used: Array.from(used) };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('email:send-templated', async (_e, { companyId, templateKey, entityType, entityId, overrideTo }: any) => {
    try {
      ensureDefaultEmailTemplates(companyId);
      const tmpl = db.getDb().prepare(
        `SELECT * FROM email_templates WHERE company_id = ? AND key = ?`
      ).get(companyId, templateKey) as any;
      if (!tmpl) return { error: 'Template not found' };
      const ctx = buildTemplateContext(companyId, entityType, entityId);
      const subject = resolveTemplateTokens(tmpl.subject || '', ctx);
      const body = resolveTemplateTokens(tmpl.body || '', ctx);
      let to = overrideTo;
      if (!to) {
        if ((tmpl.default_to || '').includes('client.email')) to = ctx.client_email || '';
        else to = tmpl.default_to || '';
      }
      const mailto = `mailto:${encodeURIComponent(to || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      try { shell.openExternal(mailto); } catch {}
      try {
        db.create('email_log', {
          company_id: companyId,
          entity_type: entityType,
          entity_id: entityId,
          recipient: to || '',
          subject,
          status: 'opened_in_client',
          template_key: templateKey,
        });
      } catch {}
      return { ok: true, to, subject, body };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('email:bulk-send-templated', async (_e, { companyId, templateKey, items }: any) => {
    try {
      const results: any[] = [];
      const tmpl = db.getDb().prepare(
        `SELECT * FROM email_templates WHERE company_id = ? AND key = ?`
      ).get(companyId, templateKey) as any;
      for (const it of items) {
        if (!tmpl) { results.push({ ...it, error: 'no template' }); continue; }
        const ctx = buildTemplateContext(companyId, it.entityType, it.entityId);
        const subject = resolveTemplateTokens(tmpl.subject || '', ctx);
        const body = resolveTemplateTokens(tmpl.body || '', ctx);
        const to = it.overrideTo || ((tmpl.default_to || '').includes('client.email') ? ctx.client_email : tmpl.default_to);
        results.push({ ...it, to, subject, body });
      }
      return { ok: true, results };
    } catch (err: any) { return { error: err?.message }; }
  });

  // 30. Compliance dashboard
  ipcMain.handle('compliance:dashboard', (_e, { companyId }: any) => {
    try {
      const openControls = (db.getDb().prepare(
        `SELECT COUNT(*) AS c FROM sox_controls WHERE company_id = ?
           AND id NOT IN (SELECT control_id FROM sox_control_tests WHERE company_id = ? AND result = 'pass')`
      ).get(companyId, companyId) as any)?.c || 0;
      const lastClose = db.getDb().prepare(
        `SELECT period_end, closed_at FROM period_close_log WHERE company_id = ? ORDER BY closed_at DESC LIMIT 1`
      ).get(companyId) as any;
      const lastRecon = db.getDb().prepare(
        `SELECT as_of_date FROM account_reconciliations WHERE company_id = ? ORDER BY as_of_date DESC LIMIT 1`
      ).get(companyId) as any;
      const dueRecons = db.getDb().prepare(
        `SELECT COUNT(*) AS c FROM recon_schedule WHERE company_id = ? AND next_due <= date('now')`
      ).get(companyId) as any;
      const auditCount = (db.getDb().prepare(
        `SELECT COUNT(*) AS c FROM audit_log WHERE company_id = ?`
      ).get(companyId) as any)?.c || 0;
      const today = new Date();
      const nextEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      const daysUntilNextClose = Math.max(0, Math.ceil((nextEnd.getTime() - today.getTime()) / 86400000));
      return {
        openControls,
        lastCloseDate: lastClose?.period_end || null,
        lastReconDate: lastRecon?.as_of_date || null,
        dueRecons: dueRecons?.c || 0,
        auditEntries: auditCount,
        daysUntilNextClose,
      };
    } catch (err: any) { return { error: err?.message }; }
  });

  // ───────────────────────────────────────────────────────
  // Universal Tags + Custom Fields (2026-04-23)
  // ───────────────────────────────────────────────────────

  // Tags CRUD
  ipcMain.handle('tags:list', (_e, { companyId, includeDeleted }: { companyId: string; includeDeleted?: boolean }) => {
    try {
      const sql = includeDeleted
        ? `SELECT * FROM tags WHERE company_id = ? ORDER BY sort_order, name`
        : `SELECT * FROM tags WHERE company_id = ? AND deleted_at IS NULL ORDER BY sort_order, name`;
      return db.getDb().prepare(sql).all(companyId);
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('tags:groups-list', (_e, { companyId }: { companyId: string }) => {
    try {
      return db.getDb().prepare(`SELECT * FROM tag_groups WHERE company_id = ? ORDER BY sort_order, name`).all(companyId);
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('tags:group-create', (_e, data: any) => {
    try { return db.create('tag_groups', data); } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('tags:group-update', (_e, { id, data }: any) => {
    try { return db.update('tag_groups', id, data); } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('tags:group-delete', (_e, { id }: { id: string }) => {
    try {
      db.getDb().prepare(`UPDATE tags SET group_id = NULL WHERE group_id = ?`).run(id);
      db.remove('tag_groups', id);
      return { ok: true };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('tags:create', (_e, data: any) => {
    try { return db.create('tags', data); } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('tags:update', (_e, { id, data }: { id: string; data: any }) => {
    try { return db.update('tags', id, data); } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('tags:rename', (_e, { id, name }: { id: string; name: string }) => {
    try {
      db.getDb().prepare(`UPDATE tags SET name = ? WHERE id = ?`).run(name, id);
      return { ok: true };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('tags:soft-delete', (_e, { id }: { id: string }) => {
    try {
      db.getDb().prepare(`UPDATE tags SET deleted_at = datetime('now') WHERE id = ?`).run(id);
      return { ok: true };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('tags:restore', (_e, { id }: { id: string }) => {
    try {
      db.getDb().prepare(`UPDATE tags SET deleted_at = NULL WHERE id = ?`).run(id);
      return { ok: true };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('tags:merge', (_e, { sourceId, targetId }: { sourceId: string; targetId: string }) => {
    try {
      const d = db.getDb();
      const tx = d.transaction(() => {
        const rows = d.prepare(`SELECT * FROM entity_tags WHERE tag_id = ?`).all(sourceId) as any[];
        const upsert = d.prepare(
          `INSERT OR IGNORE INTO entity_tags (id, company_id, entity_type, entity_id, tag_id, created_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))`
        );
        for (const r of rows) {
          upsert.run(uuid(), r.company_id, r.entity_type, r.entity_id, targetId);
        }
        d.prepare(`DELETE FROM entity_tags WHERE tag_id = ?`).run(sourceId);
        d.prepare(`DELETE FROM tags WHERE id = ?`).run(sourceId);
      });
      tx();
      return { ok: true };
    } catch (err: any) { return { error: err?.message }; }
  });

  // Entity tag assignments
  ipcMain.handle('tags:get-for-entity', (_e, { companyId, entityType, entityId }: { companyId: string; entityType: string; entityId: string }) => {
    try {
      return db.getDb().prepare(
        `SELECT t.* FROM tags t JOIN entity_tags et ON et.tag_id = t.id
         WHERE et.company_id = ? AND et.entity_type = ? AND et.entity_id = ? AND t.deleted_at IS NULL
         ORDER BY t.sort_order, t.name`
      ).all(companyId, entityType, entityId);
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('tags:set-for-entity', (_e, { companyId, entityType, entityId, tagIds }: { companyId: string; entityType: string; entityId: string; tagIds: string[] }) => {
    try {
      const d = db.getDb();
      const tx = d.transaction(() => {
        d.prepare(`DELETE FROM entity_tags WHERE company_id = ? AND entity_type = ? AND entity_id = ?`)
          .run(companyId, entityType, entityId);
        const ins = d.prepare(
          `INSERT OR IGNORE INTO entity_tags (id, company_id, entity_type, entity_id, tag_id, created_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))`
        );
        for (const tagId of tagIds || []) {
          ins.run(uuid(), companyId, entityType, entityId, tagId);
        }
      });
      tx();
      return { ok: true };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('tags:bulk-apply', (_e, { companyId, entityType, entityIds, tagIds }: any) => {
    try {
      const d = db.getDb();
      const ins = d.prepare(
        `INSERT OR IGNORE INTO entity_tags (id, company_id, entity_type, entity_id, tag_id, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`
      );
      const tx = d.transaction(() => {
        for (const eid of entityIds || []) for (const tid of tagIds || []) {
          ins.run(uuid(), companyId, entityType, eid, tid);
        }
      });
      tx();
      return { ok: true, count: (entityIds?.length || 0) * (tagIds?.length || 0) };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('tags:bulk-remove', (_e, { companyId, entityType, entityIds, tagIds }: any) => {
    try {
      const d = db.getDb();
      const del = d.prepare(`DELETE FROM entity_tags WHERE company_id = ? AND entity_type = ? AND entity_id = ? AND tag_id = ?`);
      const tx = d.transaction(() => {
        for (const eid of entityIds || []) for (const tid of tagIds || []) {
          del.run(companyId, entityType, eid, tid);
        }
      });
      tx();
      return { ok: true };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('tags:search-entities', (_e, { companyId, entityType, tagIds, mode = 'all' }: { companyId: string; entityType: string; tagIds: string[]; mode?: 'all' | 'any' }) => {
    try {
      if (!tagIds?.length) return [];
      const d = db.getDb();
      const placeholders = tagIds.map(() => '?').join(',');
      if (mode === 'any') {
        return d.prepare(
          `SELECT DISTINCT entity_id FROM entity_tags
           WHERE company_id = ? AND entity_type = ? AND tag_id IN (${placeholders})`
        ).all(companyId, entityType, ...tagIds).map((r: any) => r.entity_id);
      }
      return d.prepare(
        `SELECT entity_id FROM entity_tags
         WHERE company_id = ? AND entity_type = ? AND tag_id IN (${placeholders})
         GROUP BY entity_id HAVING COUNT(DISTINCT tag_id) = ?`
      ).all(companyId, entityType, ...tagIds, tagIds.length).map((r: any) => r.entity_id);
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('tags:usage-stats', (_e, { companyId }: { companyId: string }) => {
    try {
      return db.getDb().prepare(
        `SELECT t.id, t.name, t.color, t.group_id,
                COUNT(et.id) AS usage_count,
                COUNT(DISTINCT et.entity_type) AS entity_type_count
         FROM tags t
         LEFT JOIN entity_tags et ON et.tag_id = t.id
         WHERE t.company_id = ? AND t.deleted_at IS NULL
         GROUP BY t.id ORDER BY usage_count DESC, t.name`
      ).all(companyId);
    } catch (err: any) { return { error: err?.message }; }
  });

  // Tag rules engine
  ipcMain.handle('tags:rules-list', (_e, { companyId }: { companyId: string }) => {
    try {
      return db.getDb().prepare(`SELECT * FROM tag_rules WHERE company_id = ? ORDER BY created_at DESC`).all(companyId);
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('tags:rule-create', (_e, data: any) => {
    try { return db.create('tag_rules', data); } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('tags:rule-update', (_e, { id, data }: any) => {
    try { return db.update('tag_rules', id, data); } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('tags:rule-delete', (_e, { id }: any) => {
    try { db.remove('tag_rules', id); return { ok: true }; } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('tags:run-rules', (_e, { companyId, entityType, entity }: { companyId: string; entityType: string; entity: any }) => {
    try {
      const rules = db.getDb().prepare(
        `SELECT * FROM tag_rules WHERE company_id = ? AND entity_type = ? AND is_active = 1`
      ).all(companyId, entityType) as any[];
      const applied: string[] = [];
      const ins = db.getDb().prepare(
        `INSERT OR IGNORE INTO entity_tags (id, company_id, entity_type, entity_id, tag_id, created_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`
      );
      for (const r of rules) {
        let cond: any = {};
        try { cond = JSON.parse(r.when_condition_json || '{}'); } catch { /* skip */ }
        if (matchTagCondition(entity, cond)) {
          ins.run(uuid(), companyId, entityType, entity.id, r.then_apply_tag_id);
          applied.push(r.then_apply_tag_id);
        }
      }
      return { applied };
    } catch (err: any) { return { error: err?.message }; }
  });

  // CSV export/import for tags
  ipcMain.handle('tags:export-csv', (_e, { companyId }: { companyId: string }) => {
    try {
      const tags = db.getDb().prepare(
        `SELECT t.name, t.color, COALESCE(g.name, '') AS group_name, t.sort_order
         FROM tags t LEFT JOIN tag_groups g ON g.id = t.group_id
         WHERE t.company_id = ? AND t.deleted_at IS NULL ORDER BY g.name, t.sort_order, t.name`
      ).all(companyId) as any[];
      const header = 'name,color,group,sort_order\n';
      const body = tags.map(t =>
        [t.name, t.color, t.group_name, t.sort_order].map(v => {
          const s = String(v ?? '');
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        }).join(',')
      ).join('\n');
      return { csv: header + body };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('tags:import-csv', (_e, { companyId, csv }: { companyId: string; csv: string }) => {
    try {
      const lines = csv.split(/\r?\n/).filter(Boolean);
      if (!lines.length) return { imported: 0 };
      const header = lines[0].split(',').map(s => s.trim().toLowerCase());
      const idx = (k: string) => header.indexOf(k);
      const d = db.getDb();
      const groupCache = new Map<string, string>();
      const findGroup = (name: string) => {
        if (!name) return null;
        if (groupCache.has(name)) return groupCache.get(name)!;
        const existing = d.prepare(`SELECT id FROM tag_groups WHERE company_id = ? AND name = ?`).get(companyId, name) as any;
        if (existing) { groupCache.set(name, existing.id); return existing.id; }
        const id = uuid();
        d.prepare(`INSERT INTO tag_groups (id, company_id, name, color, allow_multiple) VALUES (?, ?, ?, '#6b7280', 1)`).run(id, companyId, name);
        groupCache.set(name, id);
        return id;
      };
      let imported = 0;
      for (let i = 1; i < lines.length; i++) {
        const cells = parseCsvLine(lines[i]);
        const name = cells[idx('name')] || '';
        if (!name) continue;
        const color = cells[idx('color')] || '#6b7280';
        const groupName = idx('group') >= 0 ? cells[idx('group')] : '';
        const sortOrder = idx('sort_order') >= 0 ? Number(cells[idx('sort_order')]) || 0 : 0;
        const existing = d.prepare(`SELECT id FROM tags WHERE company_id = ? AND name = ?`).get(companyId, name) as any;
        if (existing) continue;
        d.prepare(`INSERT INTO tags (id, company_id, name, color, group_id, sort_order) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(uuid(), companyId, name, color, findGroup(groupName), sortOrder);
        imported++;
      }
      return { imported };
    } catch (err: any) { return { error: err?.message }; }
  });

  // ── Custom Fields ──
  ipcMain.handle('customFields:list', (_e, { companyId, entityType }: { companyId: string; entityType?: string }) => {
    try {
      const sql = entityType
        ? `SELECT * FROM custom_field_definitions WHERE company_id = ? AND entity_type = ? AND deleted_at IS NULL ORDER BY sort_order, label`
        : `SELECT * FROM custom_field_definitions WHERE company_id = ? AND deleted_at IS NULL ORDER BY entity_type, sort_order, label`;
      return entityType
        ? db.getDb().prepare(sql).all(companyId, entityType)
        : db.getDb().prepare(sql).all(companyId);
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('customFields:create', (_e, data: any) => {
    try { return db.create('custom_field_definitions', data); } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('customFields:update', (_e, { id, data }: any) => {
    try { return db.update('custom_field_definitions', id, data); } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('customFields:delete', (_e, { id }: any) => {
    try {
      db.getDb().prepare(`UPDATE custom_field_definitions SET deleted_at = datetime('now') WHERE id = ?`).run(id);
      return { ok: true };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('customFields:get-values', (_e, { companyId, entityType, entityId }: { companyId: string; entityType: string; entityId: string }) => {
    try {
      return db.getDb().prepare(
        `SELECT * FROM custom_field_values WHERE company_id = ? AND entity_type = ? AND entity_id = ?`
      ).all(companyId, entityType, entityId);
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('customFields:set-values', (_e, { companyId, entityType, entityId, values }: { companyId: string; entityType: string; entityId: string; values: Record<string, any> }) => {
    try {
      const d = db.getDb();
      const defs = d.prepare(
        `SELECT * FROM custom_field_definitions WHERE company_id = ? AND entity_type = ? AND deleted_at IS NULL`
      ).all(companyId, entityType) as any[];
      const errors: string[] = [];
      for (const def of defs) {
        if (def.required) {
          const v = values?.[def.key];
          if (v === undefined || v === null || v === '') errors.push(`${def.label} is required`);
        }
        let validation: any = {};
        try { validation = JSON.parse(def.validation_json || '{}'); } catch { /* */ }
        const v = values?.[def.key];
        if (v !== undefined && v !== null && v !== '') {
          if (validation.regex) {
            try { if (!new RegExp(validation.regex).test(String(v))) errors.push(`${def.label} format invalid`); } catch { /* */ }
          }
          if (typeof validation.min === 'number' && Number(v) < validation.min) errors.push(`${def.label} below min ${validation.min}`);
          if (typeof validation.max === 'number' && Number(v) > validation.max) errors.push(`${def.label} above max ${validation.max}`);
        }
      }
      if (errors.length) return { error: errors.join('; ') };

      const tx = d.transaction(() => {
        for (const def of defs) {
          if (!(def.key in (values || {}))) continue;
          const v = values[def.key];
          const existing = d.prepare(
            `SELECT id FROM custom_field_values WHERE company_id = ? AND entity_type = ? AND entity_id = ? AND field_key = ?`
          ).get(companyId, entityType, entityId, def.key) as any;
          const cols = bucketCustomFieldValue(def.field_type, v);
          if (existing) {
            d.prepare(
              `UPDATE custom_field_values SET value_text = ?, value_number = ?, value_date = ?, value_json = ?, updated_at = datetime('now') WHERE id = ?`
            ).run(cols.value_text, cols.value_number, cols.value_date, cols.value_json, existing.id);
          } else {
            d.prepare(
              `INSERT INTO custom_field_values (id, company_id, entity_type, entity_id, field_key, value_text, value_number, value_date, value_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(uuid(), companyId, entityType, entityId, def.key, cols.value_text, cols.value_number, cols.value_date, cols.value_json);
          }
        }
      });
      tx();
      return { ok: true };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('customFields:usage-stats', (_e, { companyId, entityType }: { companyId: string; entityType: string }) => {
    try {
      const d = db.getDb();
      const defs = d.prepare(
        `SELECT * FROM custom_field_definitions WHERE company_id = ? AND entity_type = ? AND deleted_at IS NULL`
      ).all(companyId, entityType) as any[];
      const tableMap: Record<string, string> = {
        invoice: 'invoices', expense: 'expenses', client: 'clients', vendor: 'vendors',
        project: 'projects', debt: 'debts', bill: 'bills', purchase_order: 'purchase_orders',
        employee: 'employees', account: 'accounts', journal_entry: 'journal_entries',
        asset: 'fixed_assets', inventory_item: 'inventory_items',
      };
      const table = tableMap[entityType];
      let total = 0;
      try {
        if (table) {
          total = (d.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE company_id = ?`).get(companyId) as any)?.c || 0;
        }
      } catch { /* table may not exist */ }
      return defs.map((def: any) => {
        const filled = (d.prepare(
          `SELECT COUNT(DISTINCT entity_id) AS c FROM custom_field_values WHERE company_id = ? AND entity_type = ? AND field_key = ?
           AND (value_text IS NOT NULL OR value_number IS NOT NULL OR value_date IS NOT NULL OR value_json IS NOT NULL)`
        ).get(companyId, entityType, def.key) as any)?.c || 0;
        return {
          field_key: def.key,
          label: def.label,
          field_type: def.field_type,
          filled,
          total,
          fill_rate: total > 0 ? filled / total : 0,
        };
      });
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('customFields:bulk-fill', (_e, { companyId, entityType, fieldKey, value }: { companyId: string; entityType: string; fieldKey: string; value: any }) => {
    try {
      const d = db.getDb();
      const def = d.prepare(
        `SELECT * FROM custom_field_definitions WHERE company_id = ? AND entity_type = ? AND key = ?`
      ).get(companyId, entityType, fieldKey) as any;
      if (!def) return { error: 'field not found' };
      const tableMap: Record<string, string> = {
        invoice: 'invoices', expense: 'expenses', client: 'clients', vendor: 'vendors',
        project: 'projects', debt: 'debts', bill: 'bills', purchase_order: 'purchase_orders',
        employee: 'employees', account: 'accounts', journal_entry: 'journal_entries',
        asset: 'fixed_assets', inventory_item: 'inventory_items',
      };
      const table = tableMap[entityType];
      if (!table) return { error: 'unsupported entity type' };
      const ids: any[] = d.prepare(
        `SELECT id FROM ${table} WHERE company_id = ? AND id NOT IN
         (SELECT entity_id FROM custom_field_values WHERE company_id = ? AND entity_type = ? AND field_key = ?
          AND (value_text IS NOT NULL OR value_number IS NOT NULL OR value_date IS NOT NULL OR value_json IS NOT NULL))`
      ).all(companyId, companyId, entityType, fieldKey);
      const cols = bucketCustomFieldValue(def.field_type, value);
      const tx = d.transaction(() => {
        for (const row of ids) {
          d.prepare(
            `INSERT INTO custom_field_values (id, company_id, entity_type, entity_id, field_key, value_text, value_number, value_date, value_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(uuid(), companyId, entityType, row.id, fieldKey, cols.value_text, cols.value_number, cols.value_date, cols.value_json);
        }
      });
      tx();
      return { ok: true, updated: ids.length };
    } catch (err: any) { return { error: err?.message }; }
  });

  ipcMain.handle('customFields:search', (_e, { companyId, entityType, fieldKey, op, value }: { companyId: string; entityType: string; fieldKey: string; op: string; value: any }) => {
    try {
      const d = db.getDb();
      const def = d.prepare(`SELECT * FROM custom_field_definitions WHERE company_id = ? AND entity_type = ? AND key = ?`)
        .get(companyId, entityType, fieldKey) as any;
      if (!def) return [];
      const col = ['number', 'currency'].includes(def.field_type) ? 'value_number'
        : ['date', 'datetime'].includes(def.field_type) ? 'value_date'
        : ['multi-select'].includes(def.field_type) ? 'value_json'
        : 'value_text';
      const operator = op === 'contains' ? 'LIKE' : op || '=';
      const param = op === 'contains' ? `%${value}%` : value;
      const rows = d.prepare(
        `SELECT entity_id FROM custom_field_values
         WHERE company_id = ? AND entity_type = ? AND field_key = ? AND ${col} ${operator} ?`
      ).all(companyId, entityType, fieldKey, param) as any[];
      return rows.map(r => r.entity_id);
    } catch (err: any) { return { error: err?.message }; }
  });

  // ─── Advanced System (2026-04-28) — Cognitive Command Layer IPC ────────
  ipcMain.handle('command:list', () => {
    const { commandRegistry } = require('../services/CommandRegistry');
    return commandRegistry.all().map((c: any) => ({
      id: c.id, module: c.module, label: c.label,
      description: c.description, keywords: c.keywords,
      params: c.params, scope: c.scope,
    }));
  });

  ipcMain.handle('command:search', (_event, { query }: { query: string }) => {
    const { commandRegistry } = require('../services/CommandRegistry');
    return commandRegistry.search(query).map((c: any) => ({
      id: c.id, module: c.module, label: c.label,
      description: c.description, keywords: c.keywords,
    }));
  });

  ipcMain.handle('command:log-execution', (_event, { user_id, command_id, params, result, duration_ms }: any) => {
    const dbI = db.getDb();
    dbI.prepare(
      `INSERT INTO command_history (id, user_id, command_id, params_json, result, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(uuid(), user_id || 'anon', command_id, JSON.stringify(params || {}), result || 'success', duration_ms || 0);
    return { success: true };
  });

  ipcMain.handle('command:history', (_event, { user_id, limit }: { user_id?: string; limit?: number }) => {
    const dbI = db.getDb();
    return dbI.prepare(
      `SELECT * FROM command_history WHERE user_id = ? ORDER BY executed_at DESC LIMIT ?`
    ).all(user_id || 'anon', limit || 50);
  });

  ipcMain.handle('command:frequent', (_event, { user_id, limit }: { user_id?: string; limit?: number }) => {
    const dbI = db.getDb();
    return dbI.prepare(
      `SELECT command_id, COUNT(*) as count FROM command_history
       WHERE user_id = ? AND executed_at >= date('now', '-30 days')
       GROUP BY command_id ORDER BY count DESC LIMIT ?`
    ).all(user_id || 'anon', limit || 10);
  });

  ipcMain.handle('shortcut:list', (_event, { user_id }: { user_id?: string }) => {
    const dbI = db.getDb();
    return dbI.prepare(`SELECT * FROM custom_shortcuts WHERE user_id = ?`).all(user_id || 'anon');
  });

  ipcMain.handle('shortcut:save', (_event, { user_id, key_combo, command_id, params }: any) => {
    const dbI = db.getDb();
    const existing = dbI.prepare(
      `SELECT id FROM custom_shortcuts WHERE user_id = ? AND key_combo = ?`
    ).get(user_id || 'anon', key_combo) as any;
    if (existing) {
      dbI.prepare(
        `UPDATE custom_shortcuts SET command_id = ?, params_json = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(command_id, JSON.stringify(params || {}), existing.id);
      return { success: true, id: existing.id };
    }
    const id = uuid();
    dbI.prepare(
      `INSERT INTO custom_shortcuts (id, user_id, key_combo, command_id, params_json) VALUES (?, ?, ?, ?, ?)`
    ).run(id, user_id || 'anon', key_combo, command_id, JSON.stringify(params || {}));
    return { success: true, id };
  });

  ipcMain.handle('shortcut:delete', (_event, { id }: { id: string }) => {
    db.getDb().prepare(`DELETE FROM custom_shortcuts WHERE id = ?`).run(id);
    return { success: true };
  });

  ipcMain.handle('macro:list', (_event, { user_id }: { user_id?: string }) => {
    const companyId = db.getCurrentCompanyId();
    return db.getDb().prepare(
      `SELECT * FROM macros WHERE (user_id = ? OR is_shared = 1) AND company_id = ? ORDER BY name`
    ).all(user_id || 'anon', companyId);
  });

  ipcMain.handle('macro:save', (_event, { id, user_id, name, description, action_sequence, is_shared }: any) => {
    const companyId = db.getCurrentCompanyId();
    const dbI = db.getDb();
    const seqJson = JSON.stringify(action_sequence || []);
    if (id) {
      dbI.prepare(
        `UPDATE macros SET name = ?, description = ?, action_sequence_json = ?, is_shared = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(name || '', description || '', seqJson, is_shared ? 1 : 0, id);
      return { success: true, id };
    }
    const newId = uuid();
    dbI.prepare(
      `INSERT INTO macros (id, user_id, company_id, name, description, action_sequence_json, is_shared) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(newId, user_id || 'anon', companyId, name || '', description || '', seqJson, is_shared ? 1 : 0);
    scheduleAutoBackup();
    return { success: true, id: newId };
  });

  ipcMain.handle('macro:delete', (_event, { id }: { id: string }) => {
    db.getDb().prepare(`DELETE FROM macros WHERE id = ?`).run(id);
    scheduleAutoBackup();
    return { success: true };
  });

  // ─── Reactive Engine — Workflow Definitions, Executions, Events ────────
  ipcMain.handle('workflow:list', () => {
    const companyId = db.getCurrentCompanyId();
    return db.getDb().prepare(
      `SELECT * FROM workflow_definitions WHERE company_id = ? ORDER BY name`
    ).all(companyId);
  });

  ipcMain.handle('workflow:save', (_event, { id, name, description, trigger_type, trigger_config, conditions, actions, is_active, rate_limit_per_hour, requires_approval }: any) => {
    const companyId = db.getCurrentCompanyId();
    const dbI = db.getDb();
    if (id) {
      dbI.prepare(
        `UPDATE workflow_definitions SET name = ?, description = ?, trigger_type = ?, trigger_config_json = ?, conditions_json = ?, actions_json = ?, is_active = ?, rate_limit_per_hour = ?, requires_approval = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(
        name || '', description || '', trigger_type || 'event',
        JSON.stringify(trigger_config || {}),
        JSON.stringify(conditions || []),
        JSON.stringify(actions || []),
        is_active ? 1 : 0,
        rate_limit_per_hour || 0,
        requires_approval ? 1 : 0,
        id
      );
      scheduleAutoBackup();
      return { success: true, id };
    }
    const newId = uuid();
    dbI.prepare(
      `INSERT INTO workflow_definitions (id, company_id, name, description, trigger_type, trigger_config_json, conditions_json, actions_json, is_active, rate_limit_per_hour, requires_approval) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      newId, companyId, name || '', description || '', trigger_type || 'event',
      JSON.stringify(trigger_config || {}),
      JSON.stringify(conditions || []),
      JSON.stringify(actions || []),
      is_active ? 1 : 0,
      rate_limit_per_hour || 0,
      requires_approval ? 1 : 0
    );
    scheduleAutoBackup();
    return { success: true, id: newId };
  });

  ipcMain.handle('workflow:delete', (_event, { id }: { id: string }) => {
    db.getDb().prepare(`DELETE FROM workflow_definitions WHERE id = ?`).run(id);
    scheduleAutoBackup();
    return { success: true };
  });

  ipcMain.handle('workflow:executions', (_event, { workflowId, limit }: { workflowId?: string; limit?: number }) => {
    const dbI = db.getDb();
    if (workflowId) {
      return dbI.prepare(
        `SELECT * FROM workflow_executions WHERE workflow_id = ? ORDER BY triggered_at DESC LIMIT ?`
      ).all(workflowId, limit || 50);
    }
    const companyId = db.getCurrentCompanyId();
    return dbI.prepare(
      `SELECT we.* FROM workflow_executions we
       JOIN workflow_definitions wd ON wd.id = we.workflow_id
       WHERE wd.company_id = ? ORDER BY we.triggered_at DESC LIMIT ?`
    ).all(companyId, limit || 50);
  });

  ipcMain.handle('workflow:event-log', (_event, { limit }: { limit?: number }) => {
    const companyId = db.getCurrentCompanyId();
    return db.getDb().prepare(
      `SELECT * FROM workflow_event_log WHERE company_id = ? ORDER BY occurred_at DESC LIMIT ?`
    ).all(companyId, limit || 100);
  });

  ipcMain.handle('workflow:emit-event', async (_event, { type, entityType, entityId, data }: any) => {
    const companyId = db.getCurrentCompanyId();
    await eventBus.emit({ type, companyId: companyId || '', entityType, entityId, data });
    return { success: true };
  });

  // ─── Predictive Intelligence Layer ──────────────────────
  ipcMain.handle('intel:suggest-category', (_event, { vendor_id }: { vendor_id: string }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId || !vendor_id) return null;
    const { intelligenceService } = require('../services/IntelligenceService');
    return intelligenceService.suggestCategory(companyId, vendor_id);
  });

  ipcMain.handle('intel:duplicate-invoices', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return [];
    const { intelligenceService } = require('../services/IntelligenceService');
    return intelligenceService.detectDuplicateInvoices(companyId);
  });

  ipcMain.handle('intel:payroll-anomaly', (_event, { employee_id, gross }: any) => {
    const { intelligenceService } = require('../services/IntelligenceService');
    return intelligenceService.detectPayrollAnomaly(employee_id, gross);
  });

  ipcMain.handle('intel:cash-forecast', (_event, { days_ahead }: { days_ahead: number }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    const { intelligenceService } = require('../services/IntelligenceService');
    return intelligenceService.forecastCashFlow(companyId, days_ahead || 30);
  });

  ipcMain.handle('intel:predict-payment', (_event, { invoice_id }: { invoice_id: string }) => {
    const { intelligenceService } = require('../services/IntelligenceService');
    return intelligenceService.predictPaymentDate(invoice_id);
  });

  ipcMain.handle('intel:refresh-patterns', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { success: false };
    const { intelligenceService } = require('../services/IntelligenceService');
    intelligenceService.refreshPatterns(companyId);
    return { success: true };
  });

  ipcMain.handle('intel:list-anomalies', () => {
    const companyId = db.getCurrentCompanyId();
    return db.getDb().prepare(
      `SELECT * FROM anomaly_log WHERE company_id = ? AND resolved = 0 ORDER BY detected_at DESC LIMIT 100`
    ).all(companyId);
  });
}

// ── Helpers for tag rules + custom fields ──

function matchTagCondition(entity: any, cond: any): boolean {
  if (!cond || typeof cond !== 'object') return false;
  const evalOne = (c: any) => {
    const v = entity?.[c.field];
    switch (c.op) {
      case '=': case 'eq': return v == c.value;
      case '!=': case 'ne': return v != c.value;
      case '>': return Number(v) > Number(c.value);
      case '<': return Number(v) < Number(c.value);
      case '>=': return Number(v) >= Number(c.value);
      case '<=': return Number(v) <= Number(c.value);
      case 'contains': return String(v ?? '').toLowerCase().includes(String(c.value ?? '').toLowerCase());
      case 'in': return Array.isArray(c.value) && c.value.includes(v);
      case 'empty': return v === null || v === undefined || v === '';
      case 'not_empty': return !(v === null || v === undefined || v === '');
      default: return false;
    }
  };
  if (Array.isArray(cond.all)) return cond.all.every(evalOne);
  if (Array.isArray(cond.any)) return cond.any.some(evalOne);
  if (cond.field) return evalOne(cond);
  return false;
}

function bucketCustomFieldValue(fieldType: string, value: any): { value_text: string | null; value_number: number | null; value_date: string | null; value_json: string | null } {
  const out = { value_text: null as string | null, value_number: null as number | null, value_date: null as string | null, value_json: null as string | null };
  if (value === undefined || value === null || value === '') return out;
  switch (fieldType) {
    case 'number':
    case 'currency':
      out.value_number = Number(value);
      break;
    case 'date':
    case 'datetime':
      out.value_date = String(value);
      break;
    case 'boolean':
      out.value_number = value ? 1 : 0;
      break;
    case 'multi-select':
    case 'lookup':
      out.value_json = typeof value === 'string' ? value : JSON.stringify(value);
      break;
    default:
      out.value_text = String(value);
  }
  return out;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { cells.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}
