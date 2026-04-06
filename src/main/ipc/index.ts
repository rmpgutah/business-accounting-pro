import { ipcMain, BrowserWindow, dialog, shell } from 'electron';
import { v4 as uuid } from 'uuid';
import * as db from '../database';
import crypto from 'crypto';
import { syncPush } from '../sync';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { generateInvoicePDF, generateInvoiceHTML } from '../services/pdf-generator';
import { sendInvoiceEmail } from '../services/email-sender';
import { processRecurringTemplates, getLastProcessedAt, getRecurringHistory } from '../services/recurring-processor';
import { runNotificationChecks, getNotificationPreferences, updateNotificationPreferences } from '../services/notification-engine';
import { openPrintPreview, saveHTMLAsPDF, printHTML } from '../services/print-preview';
import { evaluateRules, mergePatches, rulesAppliedSummary } from '../rules';

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
  // ─── Generic CRUD ────────────────────────────────────
  ipcMain.handle('db:query', (_event, { table, filters, sort, limit, offset }) => {
    return db.queryAll(table, filters, sort, limit, offset);
  });

  ipcMain.handle('db:get', (_event, { table, id }) => {
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
    'debt_pipeline_stages', 'debt_evidence', 'debt_legal_actions',
    'quote_line_items',
    // Invoice reminders — company_id lives on parent `invoices` table
    'invoice_reminders',
  ]);

  ipcMain.handle('db:create', (_event, { table, data }) => {
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
      syncPush({ table, operation: 'create', id: record.id as string, data: payload as Record<string, unknown>, companyId: companyId ?? '', timestamp: Date.now() }).catch(() => {});
      return record;
    } catch (err) {
      console.error(`db:create [${table}] failed:`, err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('db:update', (_event, { table, id, data }) => {
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
      syncPush({ table, operation: 'update', id, data: { id, ...data } as Record<string, unknown>, companyId: companyId ?? '', timestamp: Date.now() }).catch(() => {});
      return record;
    } catch (err) {
      console.error(`db:update [${table}:${id}] failed:`, err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('db:delete', (_event, { table, id }) => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (companyId) db.logAudit(companyId, table, id, 'delete');
      db.remove(table, id);
      syncPush({ table, operation: 'delete', id, data: { id }, companyId: companyId ?? '', timestamp: Date.now() }).catch(() => {});
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

        for (const line of lineItems) {
          db.create('invoice_line_items', { ...line, invoice_id: savedId });
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
  ipcMain.handle('invoice:generate-pdf', async (_event, invoiceId: string) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { error: 'No company selected' };

    const dbInstance = db.getDb();
    const invoice = db.getById('invoices', invoiceId);
    if (!invoice) return { error: 'Invoice not found' };

    const client = db.getById('clients', invoice.client_id);
    const company = db.getById('companies', companyId);
    const lineItems = dbInstance.prepare(
      'SELECT * FROM invoice_line_items WHERE invoice_id = ?'
    ).all(invoiceId) as any[];

    const { filePath } = await dialog.showSaveDialog({
      defaultPath: `Invoice-${invoice.invoice_number}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });

    if (!filePath) return { cancelled: true };

    try {
      const pdfBuffer = await generateInvoicePDF(invoice, company, client, lineItems);
      fs.writeFileSync(filePath, pdfBuffer);
      return { path: filePath };
    } catch (err: any) {
      return { error: err?.message || 'PDF generation failed' };
    }
  });

  // ─── PDF Preview (Invoice) — Opens in new window ───────
  ipcMain.handle('invoice:preview-pdf', async (_event, invoiceId: string) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { error: 'No company selected' };

    const dbInstance = db.getDb();
    const invoice = db.getById('invoices', invoiceId);
    if (!invoice) return { error: 'Invoice not found' };

    const client = db.getById('clients', invoice.client_id);
    const company = db.getById('companies', companyId);
    const lineItems = dbInstance.prepare(
      'SELECT * FROM invoice_line_items WHERE invoice_id = ?'
    ).all(invoiceId) as any[];

    const html = generateInvoiceHTML(invoice, company, client, lineItems);

    const previewWin = new BrowserWindow({
      width: 820,
      height: 1060,
      title: `Invoice ${invoice.invoice_number} — Preview`,
      autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    await previewWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return { success: true };
  });

  // ─── Email Invoice ─────────────────────────────────────
  ipcMain.handle('invoice:send-email', async (_event, invoiceId: string) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { error: 'No company selected' };

    const dbInstance = db.getDb();
    const invoice = db.getById('invoices', invoiceId);
    if (!invoice) return { error: 'Invoice not found' };

    const client = db.getById('clients', invoice.client_id);
    const company = db.getById('companies', companyId);
    const lineItems = dbInstance.prepare(
      'SELECT * FROM invoice_line_items WHERE invoice_id = ?'
    ).all(invoiceId) as any[];

    try {
      // Generate PDF to temp location
      const pdfBuffer = await generateInvoicePDF(invoice, company, client, lineItems);
      const tmpDir = os.tmpdir();
      const pdfPath = path.join(tmpDir, `Invoice-${invoice.invoice_number}.pdf`);
      fs.writeFileSync(pdfPath, pdfBuffer);

      // Open email client with pre-filled content
      const emailResult = await sendInvoiceEmail(invoice, company, client);

      if (emailResult.success) {
        // Update invoice status to sent if still draft
        if (invoice.status === 'draft') {
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
          'Invoice email opened in mail client',
          'invoice',
          invoiceId,
          'sent',
          now
        );

        // Reveal the PDF in filesystem so user can attach it
        shell.showItemInFolder(pdfPath);
      }

      return { ...emailResult, pdfPath, newStatus: invoice.status === 'draft' ? 'sent' : invoice.status };
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

  // ─── CSV Export ────────────────────────────────────────
  // ─── Auth ──────────────────────────────────────────────

  ipcMain.handle('auth:register', (_event, { email, password, displayName }: { email: string; password: string; displayName: string }) => {
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

    return { id, email, display_name: displayName, role: isFirst ? 'owner' : 'accountant', avatar_color: '#3b82f6' };
  });

  ipcMain.handle('auth:login', (_event, { email, password }: { email: string; password: string }) => {
    const rows = db.runQuery('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0) throw new Error('Invalid email or password');

    const user = rows[0];
    if (!verifyPassword(password, user.password_hash)) throw new Error('Invalid email or password');

    // Update last_login
    db.execQuery('UPDATE users SET last_login = ? WHERE id = ?', [new Date().toISOString(), user.id]);

    // Get user's companies
    const companies = db.runQuery(
      'SELECT c.*, uc.role as user_role FROM companies c JOIN user_companies uc ON c.id = uc.company_id WHERE uc.user_id = ?',
      [user.id]
    );

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
    const companyId = db.getCurrentCompanyId();
    if (!companyId) throw new Error('No active company');
    const dbInstance = db.getDb();

    const tx = (dbInstance as any).transaction(() => {
      const paymentId = uuid();
      (dbInstance as any).prepare(`
        INSERT INTO payments (id, invoice_id, amount, date, payment_method, reference)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(paymentId, invoiceId, amount, date, method || 'transfer', reference || '');

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
    stubs, // Array<{ employeeId, hours, grossPay, federalTax, stateTax, ss, medicare, netPay, ytdGross, ytdTaxes, ytdNet }>
  }: any) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) throw new Error('No active company');
    const dbInstance = db.getDb();

    const tx = (dbInstance as any).transaction(() => {
      const runId = uuid();
      (dbInstance as any).prepare(`
        INSERT INTO payroll_runs (id, company_id, pay_period_start, pay_period_end, pay_date, status, total_gross, total_taxes, total_deductions, total_net)
        VALUES (?, ?, ?, ?, ?, 'processed', ?, ?, 0, ?)
      `).run(runId, companyId, periodStart, periodEnd, payDate, totalGross, totalTaxes, totalNet);

      for (const s of stubs) {
        (dbInstance as any).prepare(`
          INSERT INTO pay_stubs (id, payroll_run_id, employee_id, hours_regular, hours_overtime, gross_pay, federal_tax, state_tax, social_security, medicare, other_deductions, net_pay, ytd_gross, ytd_taxes, ytd_net)
          VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
        `).run(uuid(), runId, s.employeeId, s.hours, s.grossPay, s.federalTax, s.stateTax, s.ss, s.medicare, s.netPay, s.ytdGross, s.ytdTaxes, s.ytdNet);
      }

      postJournalEntry(dbInstance, companyId, payDate, `Payroll ${periodStart} to ${periodEnd}`, [
        { nameHint: 'Wages', debit: totalGross, credit: 0, note: 'Gross wages expense' },
        { nameHint: 'Wages Payable', debit: 0, credit: totalNet, note: 'Net wages payable to employees' },
        { nameHint: 'Tax', debit: 0, credit: totalTaxes, note: 'Payroll taxes withheld' },
      ]);

      return { runId };
    });

    return tx();
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

  ipcMain.handle('print:save-pdf', async (_event, { html, title }: { html: string; title: string }) => {
    try {
      const savedPath = await saveHTMLAsPDF(html, title);
      if (!savedPath) return { cancelled: true };
      return { path: savedPath };
    } catch (err: any) {
      return { error: err?.message || 'PDF save failed' };
    }
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

    // TODO: financing activities from loan/equity accounts
    const netFinancing = 0;

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
        inflows: [],
        outflows: [],
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
          single: [[0, 11600, 0.10], [11600, 47150, 0.12], [47150, 100525, 0.22], [100525, 191950, 0.24], [191950, 243725, 0.32], [243725, 609350, 0.35], [609350, null, 0.37]],
          married_jointly: [[0, 23200, 0.10], [23200, 94300, 0.12], [94300, 201050, 0.22], [201050, 383900, 0.24], [383900, 487450, 0.32], [487450, 731200, 0.35], [731200, null, 0.37]],
          head_of_household: [[0, 16550, 0.10], [16550, 63100, 0.12], [63100, 100500, 0.22], [100500, 191950, 0.24], [191950, 243700, 0.32], [243700, 609350, 0.35], [609350, null, 0.37]],
        },
      },
      2025: {
        constants: { ss_wage_base: 176100, standard_deduction_single: 15000, standard_deduction_married: 30000, standard_deduction_hoh: 22500 },
        brackets: {
          single: [[0, 11925, 0.10], [11925, 48475, 0.12], [48475, 103350, 0.22], [103350, 197300, 0.24], [197300, 250525, 0.32], [250525, 626350, 0.35], [626350, null, 0.37]],
          married_jointly: [[0, 23850, 0.10], [23850, 96950, 0.12], [96950, 206700, 0.22], [206700, 394600, 0.24], [394600, 501050, 0.32], [501050, 751600, 0.35], [751600, null, 0.37]],
          head_of_household: [[0, 17000, 0.10], [17000, 64850, 0.12], [64850, 103350, 0.22], [103350, 197300, 0.24], [197300, 250500, 0.32], [250500, 626350, 0.35], [626350, null, 0.37]],
        },
      },
      2026: {
        constants: { ss_wage_base: 182000, standard_deduction_single: 15700, standard_deduction_married: 31400, standard_deduction_hoh: 23600 },
        brackets: {
          single: [[0, 12300, 0.10], [12300, 49850, 0.12], [49850, 106300, 0.22], [106300, 203050, 0.24], [203050, 257750, 0.32], [257750, 644300, 0.35], [644300, null, 0.37]],
          married_jointly: [[0, 24600, 0.10], [24600, 99700, 0.12], [99700, 212550, 0.22], [212550, 406100, 0.24], [406100, 515500, 0.32], [515500, 773200, 0.35], [773200, null, 0.37]],
          head_of_household: [[0, 17500, 0.10], [17500, 66700, 0.12], [66700, 106300, 0.22], [106300, 203050, 0.24], [203050, 257725, 0.32], [257725, 644300, 0.35], [644300, null, 0.37]],
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
      const statusMap: Record<string, string> = { single: 'single', married_jointly: 'married_jointly', head_of_household: 'head_of_household' };
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
    const brackets = dbInstance.prepare('SELECT * FROM federal_tax_brackets WHERE tax_year = ? ORDER BY filing_status, bracket_min').all(year);
    const constants = dbInstance.prepare('SELECT * FROM federal_payroll_constants WHERE tax_year = ?').get(year);
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
    const cols = Object.keys(clone);
    dbInstance.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(c => '@' + c).join(',')})`).run(clone);
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
  });

  ipcMain.handle('debt:hold-toggle', (_event, { debtId, hold, reason }: { debtId: string; hold: boolean; reason?: string }) => {
    db.getDb().prepare('UPDATE debts SET hold = ?, hold_reason = ?, updated_at = datetime(\'now\') WHERE id = ?').run(hold ? 1 : 0, reason || '', debtId);
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
    const total = debt.original_amount + debt.interest_accrued + debt.fees_accrued - debt.payments_made;
    const daysOverdue = debt.delinquent_date ? Math.floor((Date.now() - new Date(debt.delinquent_date).getTime()) / 86400000) : 0;
    const demandDeadline = new Date(Date.now() + 10 * 86400000).toISOString().split('T')[0];
    const fields: Record<string, string> = {
      '{{debtor_name}}': debt.debtor_name || '',
      '{{debtor_address}}': debt.debtor_address || '',
      '{{original_amount}}': `$${(debt.original_amount || 0).toFixed(2)}`,
      '{{interest_accrued}}': `$${(debt.interest_accrued || 0).toFixed(2)}`,
      '{{fees_accrued}}': `$${(debt.fees_accrued || 0).toFixed(2)}`,
      '{{total_due}}': `$${total.toFixed(2)}`,
      '{{due_date}}': debt.due_date || '',
      '{{demand_deadline}}': demandDeadline,
      '{{days_overdue}}': String(daysOverdue),
      '{{company_name}}': company?.name || '',
      '{{company_address}}': [company?.address_line1, company?.city, company?.state, company?.zip].filter(Boolean).join(', '),
      '{{company_phone}}': company?.phone || '',
      '{{company_email}}': company?.email || '',
    };
    let body = template.body || '';
    let subject = template.subject || '';
    for (const [key, val] of Object.entries(fields)) {
      body = body.split(key).join(val);
      subject = subject.split(key).join(val);
    }
    return { html: `<h2>${subject}</h2>${body.replace(/\n/g, '<br>')}` };
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

    const total = debt.original_amount + debt.interest_accrued + debt.fees_accrued - debt.payments_made;

    let html = `<html><head><style>
      body { font-family: Arial, sans-serif; color: #111; padding: 40px; }
      h1 { font-size: 22px; border-bottom: 2px solid #111; padding-bottom: 8px; }
      h2 { font-size: 16px; margin-top: 32px; border-bottom: 1px solid #999; padding-bottom: 4px; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
      th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
      th { background: #f5f5f5; font-weight: bold; }
      .label { font-weight: bold; width: 180px; }
      .meta { color: #666; font-size: 12px; }
    </style></head><body>`;

    // Cover
    html += `<h1>Debt Collection Case File</h1>`;
    html += `<p><strong>Debtor:</strong> ${debt.debtor_name}</p>`;
    html += `<p><strong>Company:</strong> ${company?.name || ''}</p>`;
    html += `<p><strong>Generated:</strong> ${new Date().toLocaleDateString()}</p>`;
    html += `<p><strong>Total Due:</strong> $${total.toFixed(2)}</p>`;

    // Debt Summary
    html += `<h2>1. Debt Summary</h2><table>`;
    const summaryRows: [string, any][] = [
      ['Type', debt.type], ['Status', debt.status], ['Original Amount', `$${(debt.original_amount||0).toFixed(2)}`],
      ['Interest Accrued', `$${(debt.interest_accrued||0).toFixed(2)}`], ['Fees', `$${(debt.fees_accrued||0).toFixed(2)}`],
      ['Payments Made', `$${(debt.payments_made||0).toFixed(2)}`], ['Balance Due', `$${total.toFixed(2)}`],
      ['Due Date', debt.due_date || '\u2014'], ['Delinquent Date', debt.delinquent_date || '\u2014'],
      ['Interest Rate', `${((debt.interest_rate||0)*100).toFixed(2)}% (${debt.interest_type})`],
      ['Jurisdiction', debt.jurisdiction || '\u2014'], ['Current Stage', debt.current_stage],
    ];
    for (const [label, value] of summaryRows) html += `<tr><td class="label">${label}</td><td>${value}</td></tr>`;
    html += `</table>`;

    // Payment History
    html += `<h2>2. Payment History</h2>`;
    if (payments.length === 0) { html += `<p>No payments recorded.</p>`; }
    else {
      html += `<table><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th><th>Notes</th></tr>`;
      for (const p of payments) html += `<tr><td>${p.received_date}</td><td>$${(p.amount||0).toFixed(2)}</td><td>${p.method}</td><td>${p.reference_number||''}</td><td>${p.notes||''}</td></tr>`;
      html += `</table>`;
    }

    // Communication Log
    html += `<h2>3. Communication Log</h2>`;
    if (comms.length === 0) { html += `<p>No communications recorded.</p>`; }
    else {
      for (const c of comms) {
        html += `<div style="margin-bottom:16px;border-bottom:1px solid #eee;padding-bottom:8px;">`;
        html += `<p class="meta">${c.logged_at} | ${c.type} | ${c.direction}</p>`;
        html += `<p><strong>${c.subject || '(No subject)'}</strong></p>`;
        html += `<p>${(c.body || '').replace(/\n/g, '<br>')}</p>`;
        if (c.outcome) html += `<p><em>Outcome: ${c.outcome}</em></p>`;
        html += `</div>`;
      }
    }

    // Evidence Timeline
    html += `<h2>4. Evidence Timeline</h2>`;
    if (evidence.length === 0) { html += `<p>No evidence items.</p>`; }
    else {
      html += `<table><tr><th>Date</th><th>Type</th><th>Title</th><th>Description</th><th>Relevance</th></tr>`;
      for (const e of evidence) html += `<tr><td>${e.date_of_evidence||'\u2014'}</td><td>${e.type}</td><td>${e.title}</td><td>${e.description||''}</td><td>${e.court_relevance}</td></tr>`;
      html += `</table>`;
    }

    // Interest Breakdown
    html += `<h2>5. Interest Calculation</h2>`;
    html += `<p>Type: ${debt.interest_type} | Rate: ${((debt.interest_rate||0)*100).toFixed(2)}% | Start: ${debt.interest_start_date||'\u2014'}</p>`;
    html += `<p>Accrued: $${(debt.interest_accrued||0).toFixed(2)}</p>`;

    // Legal Actions
    html += `<h2>6. Legal Actions</h2>`;
    if (legalActions.length === 0) { html += `<p>No legal actions.</p>`; }
    else {
      for (const la of legalActions) {
        html += `<div style="margin-bottom:12px;">`;
        html += `<p><strong>${la.action_type}</strong> \u2014 Status: ${la.status} | Case: ${la.case_number||'\u2014'}</p>`;
        if (la.hearing_date) html += `<p>Hearing: ${la.hearing_date} ${la.hearing_time||''}</p>`;
        if (la.judgment_amount) html += `<p>Judgment: $${la.judgment_amount.toFixed(2)}</p>`;
        html += `</div>`;
      }
    }

    // Pipeline History
    html += `<h2>7. Pipeline History</h2>`;
    html += `<table><tr><th>Stage</th><th>Entered</th><th>Exited</th><th>Auto</th><th>Notes</th></tr>`;
    for (const s of stages) html += `<tr><td>${s.stage}</td><td>${s.entered_at}</td><td>${s.exited_at||'\u2014'}</td><td>${s.auto_advanced?'Yes':'No'}</td><td>${s.notes||''}</td></tr>`;
    html += `</table>`;

    html += `</body></html>`;

    return saveHTMLAsPDF(html, `Debt Case File \u2014 ${debt.debtor_name}`);
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
}

