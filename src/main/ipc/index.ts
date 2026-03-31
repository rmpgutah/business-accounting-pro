import { ipcMain, BrowserWindow, dialog, shell } from 'electron';
import { v4 as uuid } from 'uuid';
import * as db from '../database';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { generateInvoicePDF, generateInvoiceHTML } from '../services/pdf-generator';
import { sendInvoiceEmail } from '../services/email-sender';
import { processRecurringTemplates, getLastProcessedAt, getRecurringHistory } from '../services/recurring-processor';
import { runNotificationChecks, getNotificationPreferences, updateNotificationPreferences } from '../services/notification-engine';
import { openPrintPreview, saveHTMLAsPDF, printHTML } from '../services/print-preview';

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
  ]);

  ipcMain.handle('db:create', (_event, { table, data }) => {
    const companyId = db.getCurrentCompanyId();
    const payload = tablesWithoutCompanyId.has(table)
      ? { ...data }
      : { ...data, company_id: companyId };
    const record = db.create(table, payload);
    if (companyId) db.logAudit(companyId, table, record.id, 'create');
    return record;
  });

  ipcMain.handle('db:update', (_event, { table, id, data }) => {
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
    return record;
  });

  ipcMain.handle('db:delete', (_event, { table, id }) => {
    const companyId = db.getCurrentCompanyId();
    if (companyId) db.logAudit(companyId, table, id, 'delete');
    db.remove(table, id);
  });

  // ─── Raw Query (for reports/aggregations) ────────────
  ipcMain.handle('db:raw-query', (_event, { sql, params }) => {
    return db.runQuery(sql, params);
  });

  // ─── Company Management ──────────────────────────────
  ipcMain.handle('company:list', () => {
    return db.queryAll('companies');
  });

  ipcMain.handle('company:get', (_event, id) => {
    return db.getById('companies', id);
  });

  ipcMain.handle('company:create', (_event, data) => {
    const company = db.create('companies', data);
    db.seedDefaultAccounts(company.id);
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
    const rows = db.runQuery('SELECT COUNT(*) as count FROM users');
    return rows[0]?.count > 0;
  });

  ipcMain.handle('auth:list-users', () => {
    return db.runQuery('SELECT id, email, display_name, role, avatar_color, last_login FROM users ORDER BY created_at');
  });

  ipcMain.handle('auth:link-user-company', (_event, { userId, companyId, role }: { userId: string; companyId: string; role?: string }) => {
    db.execQuery(
      'INSERT OR IGNORE INTO user_companies (user_id, company_id, role) VALUES (?, ?, ?)',
      [userId, companyId, role || 'owner']
    );
    return true;
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

      return { paymentId, newStatus, newAmountPaid };
    });

    return payTx();
  });

  ipcMain.handle('bills:stats', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { total_outstanding: 0, total_overdue: 0, due_this_week: 0, bill_count: 0 };
    const dbInstance = db.getDb();

    return dbInstance.prepare(`
      SELECT
        COUNT(*) as bill_count,
        COALESCE(SUM(total - amount_paid), 0) as total_outstanding,
        COALESCE(SUM(CASE WHEN due_date < date('now') AND status NOT IN ('paid','void') THEN total - amount_paid ELSE 0 END), 0) as total_overdue,
        COALESCE(SUM(CASE WHEN due_date BETWEEN date('now') AND date('now', '+7 days') THEN total - amount_paid ELSE 0 END), 0) as due_this_week
      FROM bills WHERE company_id = ? AND status NOT IN ('paid','void','draft')
    `).get(companyId);
  });

  ipcMain.handle('bills:overdue-check', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return 0;
    const dbInstance = db.getDb();
    const result = dbInstance.prepare(`
      UPDATE bills SET status = 'overdue', updated_at = datetime('now')
      WHERE company_id = ? AND status IN ('received','approved','partial')
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

  ipcMain.handle('po:approve', (_event, { poId, approvedBy }: { poId: string; approvedBy: string }) => {
    const dbInstance = db.getDb();
    dbInstance.prepare(`UPDATE purchase_orders SET status = 'approved', approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
      .run(approvedBy, poId);
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
}

