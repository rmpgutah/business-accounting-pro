import { ipcMain, BrowserWindow, dialog, shell } from 'electron';
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
}

