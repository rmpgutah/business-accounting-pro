import { ipcMain, BrowserWindow, dialog } from 'electron';
import * as db from '../database';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

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

  ipcMain.handle('db:create', (_event, { table, data }) => {
    const companyId = db.getCurrentCompanyId();
    const record = db.create(table, { ...data, company_id: companyId });
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

  // ─── PDF Export (Invoice) ──────────────────────────────
  ipcMain.handle('export:invoice-pdf', async (_event, invoiceId: string) => {
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

    // Build HTML for PDF
    const html = buildInvoiceHTML(company, client, invoice, lineItems);

    // Create hidden window for printing
    const win = new BrowserWindow({ show: false, width: 800, height: 1100 });
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    const { filePath } = await dialog.showSaveDialog({
      defaultPath: `Invoice-${invoice.invoice_number}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });

    if (!filePath) {
      win.close();
      return { cancelled: true };
    }

    const pdfData = await win.webContents.printToPDF({
      pageSize: 'Letter',
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
      printBackground: true,
    });

    fs.writeFileSync(filePath, pdfData);
    win.close();
    return { path: filePath };
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
    db.runQuery(
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
    db.runQuery('UPDATE users SET last_login = ? WHERE id = ?', [new Date().toISOString(), user.id]);

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
    db.runQuery(
      'INSERT OR IGNORE INTO user_companies (user_id, company_id, role) VALUES (?, ?, ?)',
      [userId, companyId, role || 'owner']
    );
    return true;
  });

  ipcMain.handle('export:csv', async (_event, { table, filters }: { table: string; filters?: Record<string, any> }) => {
    const rows = db.queryAll(table, filters || {});
    if (rows.length === 0) return { error: 'No data to export' };

    const headers = Object.keys(rows[0]);
    const csvLines = [
      headers.join(','),
      ...rows.map(row =>
        headers.map(h => {
          const val = row[h];
          if (val === null || val === undefined) return '';
          const str = String(val);
          return str.includes(',') || str.includes('"') || str.includes('\n')
            ? `"${str.replace(/"/g, '""')}"`
            : str;
        }).join(',')
      ),
    ];

    const { filePath } = await dialog.showSaveDialog({
      defaultPath: `${table}-export.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });

    if (!filePath) return { cancelled: true };
    fs.writeFileSync(filePath, csvLines.join('\n'), 'utf-8');
    return { path: filePath };
  });
}

// ─── Invoice HTML Template ──────────────────────────────
function buildInvoiceHTML(company: any, client: any, invoice: any, lines: any[]): string {
  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n || 0);
  const companyName = company?.name || 'Company';
  const clientName = client?.name || 'Client';
  const clientEmail = client?.email || '';
  const clientAddr = [client?.address_line1, client?.city, client?.state, client?.zip].filter(Boolean).join(', ');

  const lineRows = lines.map(l => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e5e5;">${l.description || ''}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e5e5;text-align:right;">${l.quantity || 1}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e5e5;text-align:right;">${fmt(l.unit_price)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e5e5;text-align:right;">${fmt(l.amount)}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, 'Helvetica Neue', sans-serif; color: #1a1a1a; margin: 0; padding: 40px; font-size: 13px; line-height: 1.5; }
  .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
  .company-name { font-size: 22px; font-weight: 700; color: #111; }
  .invoice-title { font-size: 28px; font-weight: 700; color: #3b82f6; text-align: right; }
  .invoice-number { font-size: 14px; color: #666; text-align: right; margin-top: 4px; }
  .addresses { display: flex; justify-content: space-between; margin-bottom: 30px; }
  .address-block h4 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; color: #999; letter-spacing: 0.5px; }
  .address-block p { margin: 2px 0; }
  .meta { display: flex; gap: 40px; margin-bottom: 30px; }
  .meta-item label { display: block; font-size: 11px; text-transform: uppercase; color: #999; letter-spacing: 0.5px; }
  .meta-item span { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  th { padding: 10px 12px; text-align: left; font-size: 11px; text-transform: uppercase; color: #666; border-bottom: 2px solid #111; letter-spacing: 0.5px; }
  th:nth-child(2), th:nth-child(3), th:nth-child(4) { text-align: right; }
  .totals { margin-left: auto; width: 260px; }
  .totals .row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; }
  .totals .total { border-top: 2px solid #111; font-weight: 700; font-size: 16px; padding-top: 10px; margin-top: 4px; }
  .status-badge { display: inline-block; padding: 4px 12px; font-size: 11px; font-weight: 600; text-transform: uppercase; border-radius: 2px; }
  .status-paid { background: #dcfce7; color: #166534; }
  .status-sent { background: #dbeafe; color: #1e40af; }
  .status-overdue { background: #fee2e2; color: #991b1b; }
  .status-draft { background: #f3f4f6; color: #4b5563; }
  .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e5e5; font-size: 12px; color: #999; }
</style></head>
<body>
  <div class="header">
    <div>
      <div class="company-name">${companyName}</div>
      <div style="color:#666;font-size:12px;margin-top:4px;">
        ${company?.email || ''}${company?.phone ? ' · ' + company.phone : ''}
      </div>
    </div>
    <div>
      <div class="invoice-title">INVOICE</div>
      <div class="invoice-number">#${invoice.invoice_number}</div>
    </div>
  </div>

  <div class="addresses">
    <div class="address-block">
      <h4>Bill To</h4>
      <p style="font-weight:600;">${clientName}</p>
      ${clientEmail ? `<p>${clientEmail}</p>` : ''}
      ${clientAddr ? `<p>${clientAddr}</p>` : ''}
    </div>
    <div class="address-block" style="text-align:right;">
      <h4>Status</h4>
      <span class="status-badge status-${invoice.status}">${invoice.status}</span>
    </div>
  </div>

  <div class="meta">
    <div class="meta-item"><label>Issue Date</label><span>${invoice.issue_date}</span></div>
    <div class="meta-item"><label>Due Date</label><span>${invoice.due_date}</span></div>
    <div class="meta-item"><label>Terms</label><span>${invoice.terms || 'Net 30'}</span></div>
  </div>

  <table>
    <thead>
      <tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>
    </thead>
    <tbody>${lineRows}</tbody>
  </table>

  <div class="totals">
    <div class="row"><span>Subtotal</span><span>${fmt(invoice.subtotal)}</span></div>
    ${invoice.tax_amount ? `<div class="row"><span>Tax</span><span>${fmt(invoice.tax_amount)}</span></div>` : ''}
    ${invoice.discount_amount ? `<div class="row"><span>Discount</span><span>-${fmt(invoice.discount_amount)}</span></div>` : ''}
    <div class="row total"><span>Total</span><span>${fmt(invoice.total)}</span></div>
    ${invoice.amount_paid > 0 ? `
      <div class="row" style="color:#999;"><span>Paid</span><span>${fmt(invoice.amount_paid)}</span></div>
      <div class="row" style="font-weight:600;"><span>Balance Due</span><span>${fmt(invoice.total - invoice.amount_paid)}</span></div>
    ` : ''}
  </div>

  ${invoice.notes ? `<div class="footer"><strong>Notes:</strong> ${invoice.notes}</div>` : ''}
</body>
</html>`;
}
