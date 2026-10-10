import { ipcMain, dialog, shell, app } from 'electron';
import { v4 as uuid } from 'uuid';
import * as db from '../database';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { copyIntoDocumentsStore } from '../services/document-storage';
import { registerStripeIpc } from '../integrations/stripe';
import { registerEntityGraphIpc } from '../integrations/entity-graph';
import { createIpcDeps } from './core/deps';
import { registerDbCrudIpc } from './domains/db-crud';
import { registerAuthCompanyIpc } from './domains/auth-company';
import { registerAccountsGlIpc } from './domains/accounts-gl';
import { registerPrintPdfIpc } from './domains/print-pdf';
import { registerClientsVendorsIpc } from './domains/clients-vendors';
import { registerExpensesIpc } from './domains/expenses';
import { registerInvoicesIpc } from './domains/invoices';
import { registerLoansAdvancedIpc } from './domains/loans-advanced';
import { registerDebtCollectionIpc } from './domains/debt-collection';
import { registerReportsIpc } from './domains/reports';
import { registerHrPayrollIpc } from './domains/hr-payroll';
import { registerSyncBackupIpc } from './domains/sync-backup';
import { registerAdminSettingsIpc } from './domains/admin-settings';
import { registerWorkflowsAutomationIpc } from './domains/workflows-automation';
import { registerLoanIpc } from './loans';
import { registerExpenseDebtIpc } from './expense-debt';
import { registerHrPortalIpc } from './hr-portal';
import { registerEquipmentAssessmentIpc } from './equipment-assessment';
import { registerDebtWaveIpc } from './debt-wave';
import { registerTaxIpc } from './tax';
import { registerComplianceIpc } from './compliance';
import { registerPayrollWaveIpc } from './payroll-wave';
import { openPathInOS } from '../services/print-preview';
import { bootstrapBuiltinCommands } from '../services/CommandRegistry';
import { eventBus } from '../services/EventBus';
import { workflowEngine } from '../services/WorkflowEngine';




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



// CONCURRENCY: ipcMain.handle throws if the same channel is registered twice.
// Without this guard, calling registerIpcHandlers a second time (e.g. after a
// restore-from-backup reinit, or if main.ts startup runs twice) would crash
// the whole app the moment any handler-registration line runs. We register
// handlers exactly once for the lifetime of the main process.
let _ipcHandlersRegistered = false;

export function registerIpcHandlers(): void {
  if (_ipcHandlersRegistered) return;
  _ipcHandlersRegistered = true;

  const deps = createIpcDeps();
  const {
    scheduleAutoBackup, findClosedPeriod, validateTable, cleanupReferencesBeforeDelete, scheduleReindex, localToday,
    ensureDefaultEmailTemplates, resolveTemplateTokens, buildTemplateContext, eu,
  } = deps;

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

  registerDbCrudIpc(ipcMain, deps);


  registerClientsVendorsIpc(ipcMain, deps);



  // ─── P1.13: Trash (soft-delete recovery) ──────────────
  // Read-side counterpart to db.remove() now that supported tables
  // soft-delete. The Trash UI calls these to list / restore / purge
  // records the user has deleted within the 30-day retention window.

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
      scheduleAutoBackup();
      return r;
    } catch (err: any) {
      return { cleaned: 0, error: err?.message };
    }
  });

  // ── Automation manual-trigger handlers ──────────────────────
  // Balance-aware invoice/bill status reconcile (also runs on a 6h cron).
  ipcMain.handle('maintenance:reconcile-status', () => {
    try {
      const { runStatusReconcile } = require('../crons/status-reconcile');
      const r = runStatusReconcile();
      scheduleAutoBackup();
      return r;
    } catch (err: any) {
      return { invoicesFixed: 0, billsFixed: 0, companiesScanned: 0, errors: [err?.message] };
    }
  });
  registerAccountsGlIpc(ipcMain, deps);

  registerHrPayrollIpc(ipcMain, deps);
  registerWorkflowsAutomationIpc(ipcMain, deps);
  registerLoanIpc(ipcMain, deps);
  registerExpenseDebtIpc(ipcMain, deps);
  registerHrPortalIpc(ipcMain, deps);
  registerDebtWaveIpc(ipcMain, deps);
  registerEquipmentAssessmentIpc();

  registerAdminSettingsIpc(ipcMain, deps);

  // ─── D3: Period Close + Lockdown ─────────────────────
  //
  // Period close is enforced at the IPC layer rather than via SQLite
  // triggers — triggers can't easily route audit messages to the user
  // and the per-row date check is cheap. Pattern: any handler that
  // creates/updates/deletes a dated record (invoice, bill, expense,
  // journal_entry, payment) calls assertNotInClosedPeriod() with the
  // record's date. Throws an Error which the handler catches and
  // returns as { error: ... } — UI shows a clear "Period is closed"
  // message.
  //
  // The renderer can also pre-check via period:is-closed before
  // attempting the mutation, but the server-side gate is the source
  // of truth.


  // Internal helper exposed on the registry so other handlers can
  // route through it. Throws an Error if the date is in a closed
  // period — caller catches and returns as IPC error.
  (registerIpcHandlers as any).__assertNotInClosedPeriod = (companyId: string, date: string) => {
    const period = findClosedPeriod(companyId, date);
    if (period) {
      throw new Error(
        'This action is blocked: ' + date + ' falls in a closed accounting period (' +
        period.period_start + ' to ' + period.period_end + (period.close_reason ? ' · ' + period.close_reason : '') +
        '). Reopen the period in Settings to make changes.'
      );
    }
  };

  registerTaxIpc(ipcMain);

  registerComplianceIpc(ipcMain);

  registerAuthCompanyIpc(ipcMain, deps);


  // ─── Batch 2: Invoicing & Expense features (20) ────────────────
  const ie = () => require('../services/invoice-expense-features');
  ipcMain.handle('feat:invoice:late-fee:compute', (_e, { invoice_id }: any) => { try { return ie().computeLateFee(invoice_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:invoice:late-fee:apply', (_e, { invoice_id }: any) => { try { const r = ie().applyLateFee(invoice_id); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:invoice:reminders:schedule', (_e, { invoice_id, days }: any) => { try { const r = { scheduled: ie().scheduleInvoiceReminders(invoice_id, days || [7, 14, 30]) }; scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:invoice:reminders:pending', (_e, { as_of }: any = {}) => { try { return ie().pendingReminders(as_of); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:invoice:reminders:mark-sent', (_e, { id }: any) => { try { const r = { ok: ie().markReminderSent(id) }; scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:invoice:recalc-payment-state', (_e, { invoice_id }: any) => { try { const r = ie().recalcInvoicePaymentState(invoice_id); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:credit-memo:create', (_e, memo: any) => { try { const cid = db.getCurrentCompanyId(); const r = ie().createCreditMemo({ ...memo, company_id: cid }); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:credit-memo:apply', (_e, { memo_id, invoice_id, amount }: any) => { try { const r = ie().applyCreditMemo(memo_id, invoice_id, amount); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:credit-memo:list', (_e, { client_id }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ie().listCreditMemos(cid, client_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:invoice:batch-send:candidates', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ie().getBatchSendCandidates(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:invoice:templates:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ie().listInvoiceTemplates(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:invoice:templates:upsert', (_e, t: any) => { try { const cid = db.getCurrentCompanyId(); const r = ie().upsertInvoiceTemplate({ ...t, company_id: cid }); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:invoice:exchange-rate', (_e, { invoice_id, rate }: any) => { try { const r = { ok: ie().setInvoiceExchangeRate(invoice_id, rate) }; scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:invoice:deposit', (_e, { invoice_id, amount, due_date }: any) => { try { const r = { ok: ie().setInvoiceDeposit(invoice_id, amount, due_date) }; scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:budget-alert:upsert', (_e, record: any) => { try { const cid = db.getCurrentCompanyId(); const r = ie().upsertBudgetAlert({ ...record, company_id: cid }); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:budget-alert:check', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ie().checkBudgetAlerts(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vendor:suggest', (_e, { prefix, limit }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ie().suggestVendors(cid, prefix, limit); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:expense:split:create', (_e, { expense_id, splits }: any) => { try { const r = ie().createExpenseSplit(expense_id, splits); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:expense:split:get', (_e, { expense_id }: any) => { try { return ie().getExpenseSplits(expense_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:reimbursement:create', (_e, record: any) => { try { const cid = db.getCurrentCompanyId(); const r = ie().createReimbursement({ ...record, company_id: cid }); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:reimbursement:approve', (_e, { id, approved_by }: any) => { try { const r = { ok: ie().approveReimbursement(id, approved_by) }; scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:reimbursement:reject', (_e, { id, reason }: any) => { try { const r = { ok: ie().rejectReimbursement(id, reason) }; scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:reimbursement:pay', (_e, { id, method }: any) => { try { const r = { ok: ie().payReimbursement(id, method) }; scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:reimbursement:list', (_e, { status }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ie().listReimbursements(cid, status); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:per-diem:upsert', (_e, record: any) => { try { const cid = db.getCurrentCompanyId(); const r = ie().upsertPerDiemRate({ ...record, company_id: cid }); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:per-diem:lookup', (_e, { city, state, year }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return ie().lookupPerDiem(cid, city, state, year); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:expense:bulk-recategorize', (_e, { expense_ids, category_id }: any) => { const r = eu().bulkRecategorize(expense_ids || [], category_id); scheduleAutoBackup(); return r; });
  ipcMain.handle('feat:expense:report', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return ie().buildExpenseReport(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:expense:duplicates', (_e, { expense, days_window }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ie().findExpenseDuplicates(cid, expense, days_window); } catch (e: any) { return { error: e?.message }; } });

  // ─── Batch 3: Banking & Payroll features (15) ─────────────────
  const bp = () => require('../services/banking-payroll-features');
  ipcMain.handle('feat:bank-rule:upsert', (_e, rule: any) => { try { const cid = db.getCurrentCompanyId(); const r = bp().upsertBankRule({ ...rule, company_id: cid }); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:bank-rule:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return bp().listBankRules(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:bank-rule:apply', (_e, { txn_ids }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return { matched: 0, updated: 0 }; const r = bp().applyRulesToTransactions(cid, txn_ids); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:recon:auto-match', (_e, { account_id, date_window }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return { matches: 0, suggestions: [] }; return bp().autoMatchReconciliation(cid, account_id, date_window); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:bank-tx:duplicates', (_e, { days_window }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return bp().detectDuplicateTransactions(cid, days_window); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:bank-tx:flag-duplicate', (_e, { txn_id, duplicate_of, confidence }: any) => { try { const r = { ok: bp().flagDuplicateTransaction(txn_id, duplicate_of, confidence) }; scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:bank-tx:transfers', (_e, { date_window }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return bp().detectTransfers(cid, date_window); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:bank-tx:confirm-transfer', (_e, { outflow_id, inflow_id }: any) => { try { const r = { ok: bp().confirmTransfer(outflow_id, inflow_id) }; scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:bank:project-balance', (_e, { account_id, days_ahead }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return bp().projectBankBalance(cid, account_id, days_ahead); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:csv-mapping:upsert', (_e, record: any) => { try { const cid = db.getCurrentCompanyId(); const r = bp().upsertCsvMapping({ ...record, company_id: cid }); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:csv-mapping:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return bp().listCsvMappings(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:recon:history', (_e, { account_id, limit }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return bp().getReconciliationHistory(cid, account_id, limit); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:bank:outstanding-deposits', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return bp().getOutstandingDeposits(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:salary-review:record', (_e, record: any) => { try { const cid = db.getCurrentCompanyId(); const r = bp().recordSalaryReview({ ...record, company_id: cid }); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:salary-review:list', (_e, { employee_id }: any) => { try { return bp().getSalaryReviews(employee_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:pay-stubs:bulk', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; const _r = bp().getPayStubsForBulkDownload(cid, opts); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:time-off:set-balance', (_e, record: any) => { try { const cid = db.getCurrentCompanyId(); const r = bp().setTimeOffBalance({ ...record, company_id: cid }); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:time-off:request', (_e, record: any) => { try { const cid = db.getCurrentCompanyId(); const r = bp().requestTimeOff({ ...record, company_id: cid }); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:time-off:approve', (_e, { request_id, approved_by }: any) => { try { const r = { ok: bp().approveTimeOff(request_id, approved_by) }; scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:time-off:balances', (_e, { employee_id }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return bp().getTimeOffBalances(cid, employee_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:bonus:calculate', (_e, opts: any) => { try { return bp().calculateBonus(opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:state-tax:rates', (_e, { state }: any) => { try { return bp().getStateTaxRates(state); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:payroll:forecast', (_e, { months_ahead }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return bp().forecastPayrollCost(cid, months_ahead); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:onboarding:create', (_e, { employee_id, hire_date, template_id }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const r = bp().createOnboardingChecklist(cid, employee_id, hire_date, template_id); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:onboarding:complete', (_e, { id, completed_by, notes }: any) => { try { const r = { ok: bp().completeOnboardingItem(id, completed_by, notes) }; scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:onboarding:progress', (_e, { employee_id }: any) => { try { return bp().getOnboardingProgress(employee_id); } catch (e: any) { return { error: e?.message }; } });

  // ─── Batch 4: Reports & Analytics features (10) ───────────────
  const ra = () => require('../services/reports-analytics-features');
  ipcMain.handle('feat:report:period-over-period', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return ra().periodOverPeriod(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:report:top-customers', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ra().topCustomers(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:report:clv', (_e, { client_id }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return ra().customerLifetimeValue(cid, client_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:report:churn-predict', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ra().predictChurn(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:report:profit-by-service', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ra().profitMarginByService(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:report:dept-pnl', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ra().departmentPnL(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:report:vendor-yoy', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ra().vendorSpendingYoY(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:collection-template:upsert', (_e, t: any) => { try { const cid = db.getCurrentCompanyId(); const r = ra().upsertCollectionTemplate({ ...t, company_id: cid }); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:collection-template:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ra().listCollectionTemplates(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:collection-template:render', (_e, { template, invoice, client }: any) => { try { return ra().generateCollectionEmail(template, invoice, client); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:report:year-end-tax', (_e, { year }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return ra().yearEndTaxSummary(cid, year); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:widgets:list', (_e, { user_id }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ra().listDashboardWidgets(user_id, cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:widgets:upsert', (_e, w: any) => { try { const cid = db.getCurrentCompanyId(); const r = ra().upsertDashboardWidget({ ...w, company_id: cid }); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:widgets:remove', (_e, { id }: any) => { try { const r = { ok: ra().removeDashboardWidget(id) }; scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });

  // ─── Batch 5: Client/Vendor/Document features (10) ───────────
  const cvd = () => require('../services/client-vendor-doc-features');
  ipcMain.handle('feat:client:merge', (_e, { primary_id, duplicate_ids }: any) => { try { const r = cvd().mergeClients(primary_id, duplicate_ids); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:client:find-duplicates', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cvd().findClientDuplicates(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:tag:add', (_e, record: any) => { try { const cid = db.getCurrentCompanyId(); const r = cvd().addTag({ ...record, company_id: cid }); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:tag:remove', (_e, { id }: any) => { try { const r = { ok: cvd().removeTag(id) }; scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:tag:list-entity', (_e, { entity_type, entity_id }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cvd().listEntityTags(cid, entity_type, entity_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:tag:list-all', (_e, { entity_type }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cvd().listAllTags(cid, entity_type); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:tag:search', (_e, { entity_type, tag }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cvd().searchByTag(cid, entity_type, tag); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:communication:log', (_e, record: any) => { try { const cid = db.getCurrentCompanyId(); const r = cvd().logCommunication({ ...record, company_id: cid }); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:communication:list', (_e, { client_id, ...opts }: any) => { try { return cvd().listCommunications(client_id, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:communication:follow-ups', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cvd().pendingFollowUps(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vendor:1099-status', (_e, { year }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cvd().checkVendor1099Status(cid, year); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vendor:scorecard', (_e, { vendor_id, lookback_days }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return cvd().computeVendorScorecard(cid, vendor_id, lookback_days); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vendor:set-contract', (_e, { vendor_id, contract }: any) => { try { const r = { ok: cvd().setVendorContract(vendor_id, contract) }; scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vendor:expiring-contracts', (_e, { days_ahead }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cvd().getExpiringContracts(cid, days_ahead); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:document:set-expiration', (_e, { document_id, expires_at, reminder_days_before }: any) => { try { const r = { ok: cvd().setDocumentExpiration(document_id, expires_at, reminder_days_before) }; scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:document:expiring', (_e, { days_ahead }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cvd().expiringDocuments(cid, days_ahead); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:document:add-version', (_e, record: any) => { try { const r = cvd().addDocumentVersion(record); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:document:list-versions', (_e, { document_id }: any) => { try { return cvd().listDocumentVersions(document_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:document:set-encrypted', (_e, { document_id, is_encrypted }: any) => { try { const r = cvd().setDocumentEncrypted(document_id, is_encrypted); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });

  // ─── Batch 6: Automation & Workflow Engine (20) ───────────
  const am = () => require('../services/automation-features');
  // Workflows
  ipcMain.handle('feat:workflow:upsert', (_e, w: any) => { try { const cid = db.getCurrentCompanyId(); const r = am().upsertWorkflow({ ...w, company_id: cid }); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:workflow:list', (_e, { active_only }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return am().listWorkflows(cid, !!active_only); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:workflow:trigger', (_e, { trigger_type, payload }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; const r = am().triggerWorkflows(cid, trigger_type, payload || {}); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  // Scheduled tasks
  ipcMain.handle('feat:scheduled-task:upsert', (_e, t: any) => { try { const cid = db.getCurrentCompanyId(); const r = am().upsertScheduledTask({ ...t, company_id: cid }); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:scheduled-task:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return am().listScheduledTasks(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:scheduled-task:due', () => { try { return am().dueScheduledTasks(); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:scheduled-task:mark-run', (_e, { id, status, next_run_at }: any) => { try {  const _r = { ok: am().markScheduledTaskRun(id, status, next_run_at) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  // Approval chains
  ipcMain.handle('feat:approval-chain:upsert', (_e, c: any) => { try { const cid = db.getCurrentCompanyId(); const _r = am().upsertApprovalChain({ ...c, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:approval:start', (_e, { chain_id, entity_type, entity_id, submitted_by }: any) => { try {  const _r = am().startApprovalInstance(chain_id, entity_type, entity_id, submitted_by); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:approval:act', (_e, { instance_id, action, actor_id, comment }: any) => { try { return am().actOnApproval(instance_id, action, actor_id, comment); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:approval:pending', (_e, { approver_user_id }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return am().pendingApprovals(cid, approver_user_id); } catch (e: any) { return { error: e?.message }; } });
  // Email templates
  ipcMain.handle('feat:email-template:upsert', (_e, t: any) => { try { const cid = db.getCurrentCompanyId(); const _r = am().upsertEmailTemplate({ ...t, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:email-template:list', (_e, { category }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return am().listEmailTemplates(cid, category); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:email-template:render', (_e, { template_id, data }: any) => { try { return am().renderEmailTemplate(template_id, data || {}); } catch (e: any) { return { error: e?.message }; } });
  // Webhooks
  ipcMain.handle('feat:webhook:upsert', (_e, w: any) => { try { const cid = db.getCurrentCompanyId(); const _r = am().upsertWebhookSubscription({ ...w, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:webhook:record-delivery', (_e, { subscription_id, event_type, payload, response_status, response_body, duration_ms }: any) => { try { am().recordWebhookDelivery(subscription_id, event_type, payload, response_status, response_body, duration_ms); const _r = { ok: true }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  // Auto-categorize
  ipcMain.handle('feat:auto-categorize:learn', (_e, { description_pattern, vendor_id, category_id }: any) => { try { const cid = db.getCurrentCompanyId(); am().recordAutoCategorizeAccept(cid, description_pattern, vendor_id || null, category_id); return { ok: true }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:auto-categorize:suggest', (_e, { description, vendor_id }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return am().getAutoCategorizeSuggestion(cid, description, vendor_id); } catch (e: any) { return { error: e?.message }; } });
  // Auto-archive
  ipcMain.handle('feat:auto-archive:run', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return { invoices_archived: 0, bills_archived: 0 }; const _r = am().runAutoArchive(cid); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  // Triggered actions log
  ipcMain.handle('feat:triggered-action:log', (_e, { trigger_source, entity_type, entity_id, action_type, action_result }: any) => { try { const cid = db.getCurrentCompanyId(); am().logTriggeredAction(cid, trigger_source, entity_type, entity_id, action_type, action_result); const _r = { ok: true }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:triggered-action:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return am().listTriggeredActions(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  // SLAs
  ipcMain.handle('feat:sla:upsert', (_e, s: any) => { try { const cid = db.getCurrentCompanyId(); const _r = am().upsertSLA({ ...s, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:sla:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return am().listSLAs(cid); } catch (e: any) { return { error: e?.message }; } });
  // Saved searches
  ipcMain.handle('feat:saved-search:upsert', (_e, s: any) => { try { const cid = db.getCurrentCompanyId(); const _r = am().upsertSavedSearch({ ...s, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:saved-search:list', (_e, { user_id, module }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return am().listSavedSearches(user_id, cid, module); } catch (e: any) { return { error: e?.message }; } });
  // Bulk ops audit
  ipcMain.handle('feat:bulk-op:log', (_e, op: any) => { try { const cid = db.getCurrentCompanyId(); const _r = am().logBulkOperation(cid, op); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:bulk-op:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return am().listBulkOperations(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  // Quick actions (dashboard shortcuts)
  ipcMain.handle('feat:quick-action:upsert', (_e, a: any) => { try { const cid = db.getCurrentCompanyId(); const _r = am().upsertQuickAction({ ...a, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:quick-action:list', (_e, { user_id }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return am().listQuickActions(user_id, cid); } catch (e: any) { return { error: e?.message }; } });

  // ─── Batch 7: Banking, Treasury, Multi-Currency (20) ───────────
  const tr = () => require('../services/treasury-features');
  // F91 cash position
  ipcMain.handle('feat:cash-position:capture', (_e, { snapshot_date }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = tr().captureCashPosition(cid, snapshot_date); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:cash-position:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return tr().listCashPositionSnapshots(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  // F92 cash forecast
  ipcMain.handle('feat:cash-forecast:rebuild', (_e, { days_ahead }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = tr().rebuildCashForecast(cid, days_ahead || 90); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:cash-forecast:get', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return tr().getCashForecast(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  // F93 FX rates
  ipcMain.handle('feat:fx-rate:upsert', (_e, r: any) => { try {  const _r = tr().upsertFxRate(r); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:fx-rate:get', (_e, { from, to, as_of_date }: any) => { try { return tr().getFxRate(from, to, as_of_date); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:fx-rate:list', (_e, opts: any = {}) => { try { return tr().listFxRates(opts); } catch (e: any) { return { error: e?.message }; } });
  // F94 FX revaluation
  ipcMain.handle('feat:fx-revaluation:run', (_e, { as_of_date, created_by }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = tr().runFxRevaluation(cid, as_of_date, created_by); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:fx-revaluation:list', (_e, { limit }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return tr().listFxRevaluationRuns(cid, limit); } catch (e: any) { return { error: e?.message }; } });
  // F96 wire transfers
  ipcMain.handle('feat:wire-transfer:upsert', (_e, w: any) => { try { const cid = db.getCurrentCompanyId(); const _r = tr().upsertWireTransfer({ ...w, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:wire-transfer:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return tr().listWireTransfers(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  // F97 ACH batches
  ipcMain.handle('feat:ach-batch:create', (_e, b: any) => { try { const cid = db.getCurrentCompanyId(); const _r = tr().createAchBatch({ ...b, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:ach-batch:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return tr().listAchBatches(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:ach-batch:items', (_e, { batch_id }: any) => { try { return tr().getAchBatchItems(batch_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:ach-batch:mark-submitted', (_e, { batch_id, nacha_file_path }: any) => { try {  const _r = { ok: tr().markAchBatchSubmitted(batch_id, nacha_file_path) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  // F98 bank fee categorization
  ipcMain.handle('feat:bank-fee-cat:upsert', (_e, c: any) => { try { const cid = db.getCurrentCompanyId(); const _r = tr().upsertBankFeeCategory({ ...c, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:bank-fee-cat:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return tr().listBankFeeCategories(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:bank-fee-cat:suggest', (_e, { description }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return tr().suggestBankFeeCategory(cid, description); } catch (e: any) { return { error: e?.message }; } });
  // F99 bank match log
  ipcMain.handle('feat:bank-match:log', (_e, { transaction_id, candidate }: any) => { try { const cid = db.getCurrentCompanyId(); tr().logBankMatchAttempt(cid, transaction_id, candidate); const _r = { ok: true }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:bank-match:list', (_e, { transaction_id, limit }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return tr().listBankMatchAttempts(cid, transaction_id, limit); } catch (e: any) { return { error: e?.message }; } });
  // F100 stop payments
  ipcMain.handle('feat:stop-payment:upsert', (_e, s: any) => { try { const cid = db.getCurrentCompanyId(); const _r = tr().upsertStopPayment({ ...s, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:stop-payment:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return tr().listStopPayments(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  // F101 pending deposits
  ipcMain.handle('feat:pending-deposit:upsert', (_e, p: any) => { try { const cid = db.getCurrentCompanyId(); const _r = tr().upsertPendingDeposit({ ...p, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:pending-deposit:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return tr().listPendingDeposits(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:pending-deposit:float', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return { total_pending: 0, count: 0 }; return tr().totalPendingFloat(cid); } catch (e: any) { return { error: e?.message }; } });
  // F102 petty cash
  ipcMain.handle('feat:petty-cash:log', (_e, p: any) => { try { const cid = db.getCurrentCompanyId(); const _r = tr().logPettyCash({ ...p, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:petty-cash:list', (_e, { limit }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return tr().listPettyCash(cid, limit); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:petty-cash:balance', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return 0; return tr().pettyCashBalance(cid); } catch (e: any) { return { error: e?.message }; } });
  // F103 treasury investments
  ipcMain.handle('feat:treasury:upsert', (_e, t: any) => { try { const cid = db.getCurrentCompanyId(); const _r = tr().upsertTreasuryInvestment({ ...t, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:treasury:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return tr().listTreasuryInvestments(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  // F104 letters of credit
  ipcMain.handle('feat:loc:upsert', (_e, lc: any) => { try { const cid = db.getCurrentCompanyId(); const _r = tr().upsertLetterOfCredit({ ...lc, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:loc:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return tr().listLettersOfCredit(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  // F105 loan covenants
  ipcMain.handle('feat:covenant:upsert', (_e, c: any) => { try { const cid = db.getCurrentCompanyId(); const _r = tr().upsertLoanCovenant({ ...c, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:covenant:measure', (_e, { covenant_id, value }: any) => { try {  const _r = tr().recordCovenantMeasurement(covenant_id, value); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:covenant:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return tr().listLoanCovenants(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  // F106 sweep rules
  ipcMain.handle('feat:sweep:upsert', (_e, s: any) => { try { const cid = db.getCurrentCompanyId(); const _r = tr().upsertSweepRule({ ...s, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:sweep:list', (_e, { active_only }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return tr().listSweepRules(cid, !!active_only); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:sweep:evaluate', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return tr().evaluateSweepRules(cid); } catch (e: any) { return { error: e?.message }; } });
  // F107 inter-company transfers
  ipcMain.handle('feat:inter-co:record', (_e, t: any) => { try {  const _r = tr().recordInterCompanyTransfer(t); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:inter-co:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); return tr().listInterCompanyTransfers({ company_id: cid, ...opts }); } catch (e: any) { return { error: e?.message }; } });
  // F108 credit card statements
  ipcMain.handle('feat:cc-stmt:upsert', (_e, s: any) => { try { const cid = db.getCurrentCompanyId(); const _r = tr().upsertCreditCardStatement({ ...s, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:cc-stmt:add-lines', (_e, { statement_id, lines }: any) => { try {  const _r = tr().addStatementLines(statement_id, lines); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:cc-stmt:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return tr().listCreditCardStatements(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:cc-stmt:lines', (_e, { statement_id }: any) => { try { return tr().getStatementLines(statement_id); } catch (e: any) { return { error: e?.message }; } });
  // F109 lockbox imports
  ipcMain.handle('feat:lockbox:import', (_e, imp: any) => { try { const cid = db.getCurrentCompanyId(); const _r = tr().importLockbox({ ...imp, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:lockbox:list', (_e, { limit }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return tr().listLockboxImports(cid, limit); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:lockbox:items', (_e, { import_id }: any) => { try { return tr().getLockboxItems(import_id); } catch (e: any) { return { error: e?.message }; } });
  // F110 positive pay
  ipcMain.handle('feat:positive-pay:generate', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return tr().generatePositivePayFile(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:positive-pay:list', (_e, { limit }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return tr().listPositivePayFiles(cid, limit); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:positive-pay:mark-submitted', (_e, { id }: any) => { try {  const _r = { ok: tr().markPositivePayFileSubmitted(id) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });

  // ─── Batch 8: Inventory, Projects, Time (20) ───────────
  const ip = () => require('../services/inventory-projects-features');
  // F111 warehouses
  ipcMain.handle('feat:warehouse:upsert', (_e, w: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ip().upsertWarehouse({ ...w, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:warehouse:list', (_e, { active_only }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ip().listWarehouses(cid, !!active_only); } catch (e: any) { return { error: e?.message }; } });
  // F112 locations
  ipcMain.handle('feat:location:upsert', (_e, l: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ip().upsertLocation({ ...l, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:location:list', (_e, { warehouse_id }: any) => { try { return ip().listLocations(warehouse_id); } catch (e: any) { return { error: e?.message }; } });
  // F113 lots
  ipcMain.handle('feat:lot:upsert', (_e, l: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ip().upsertLot({ ...l, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:lot:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ip().listLots(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  // F114 serials
  ipcMain.handle('feat:serial:upsert', (_e, s: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ip().upsertSerial({ ...s, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:serial:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ip().listSerials(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  // F115 transfers
  ipcMain.handle('feat:transfer:create', (_e, t: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ip().createTransfer({ ...t, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:transfer:ship', (_e, { id }: any) => { try {  const _r = { ok: ip().markTransferShipped(id) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:transfer:receive', (_e, { id }: any) => { try {  const _r = { ok: ip().markTransferReceived(id) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:transfer:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ip().listTransfers(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:transfer:items', (_e, { transfer_id }: any) => { try { return ip().getTransferItems(transfer_id); } catch (e: any) { return { error: e?.message }; } });
  // F116 adjustments
  ipcMain.handle('feat:adjustment:create', (_e, a: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ip().createAdjustment({ ...a, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:adjustment:approve', (_e, { id, approved_by }: any) => { try {  const _r = { ok: ip().approveAdjustment(id, approved_by) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:adjustment:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ip().listAdjustments(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  // F117 stock takes
  ipcMain.handle('feat:stock-take:start', (_e, s: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ip().startStockTake({ ...s, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:stock-take:count', (_e, { session_id, ...count }: any) => { try { return ip().recordCount(session_id, count); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:stock-take:complete', (_e, { session_id }: any) => { try {  const _r = ip().completeStockTake(session_id); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:stock-take:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ip().listStockTakes(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:stock-take:counts', (_e, { session_id }: any) => { try { return ip().getStockTakeCounts(session_id); } catch (e: any) { return { error: e?.message }; } });
  // F118 low stock alerts
  ipcMain.handle('feat:low-stock:scan', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = ip().scanLowStock(cid); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:low-stock:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ip().listLowStockAlerts(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:low-stock:ack', (_e, { id, acknowledged_by }: any) => { try {  const _r = { ok: ip().acknowledgeAlert(id, acknowledged_by) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  // F119 valuation methods
  ipcMain.handle('feat:valuation:set-method', (_e, { method }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return false; const _r = { ok: ip().setValuationMethod(cid, method) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:valuation:get-method', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return 'average'; return ip().getValuationMethod(cid); } catch (e: any) { return { error: e?.message }; } });
  // F120 inventory value history
  ipcMain.handle('feat:inv-value:capture', (_e, { snapshot_date }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = ip().captureInventoryValueSnapshot(cid, snapshot_date); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:inv-value:list', (_e, { limit }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ip().listInventoryValueHistory(cid, limit); } catch (e: any) { return { error: e?.message }; } });
  // F121 project tasks
  ipcMain.handle('feat:task:upsert', (_e, t: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ip().upsertTask({ ...t, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:task:list', (_e, { project_id, ...opts }: any) => { try { return ip().listTasks(project_id, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:task:complete', (_e, { id }: any) => { try {  const _r = { ok: ip().completeTask(id) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  // F122 milestones
  ipcMain.handle('feat:milestone:upsert', (_e, m: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ip().upsertMilestone({ ...m, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:milestone:list', (_e, { project_id }: any) => { try { return ip().listMilestones(project_id); } catch (e: any) { return { error: e?.message }; } });
  // F123 resources
  ipcMain.handle('feat:resource:upsert', (_e, r: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ip().upsertResource({ ...r, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:resource:list', (_e, { project_id }: any) => { try { return ip().listResources(project_id); } catch (e: any) { return { error: e?.message }; } });
  // F124 project budgets
  ipcMain.handle('feat:proj-budget:upsert', (_e, b: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ip().upsertProjectBudget({ ...b, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:proj-budget:list', (_e, { project_id }: any) => { try { return ip().listProjectBudgets(project_id); } catch (e: any) { return { error: e?.message }; } });
  // F125 risks
  ipcMain.handle('feat:risk:upsert', (_e, r: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ip().upsertRisk({ ...r, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:risk:list', (_e, { project_id, open_only }: any) => { try { return ip().listRisks(project_id, !!open_only); } catch (e: any) { return { error: e?.message }; } });
  // F126 change orders
  ipcMain.handle('feat:co:upsert', (_e, co: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ip().upsertChangeOrder({ ...co, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:co:approve', (_e, { id, approved_by }: any) => { try {  const _r = { ok: ip().approveChangeOrder(id, approved_by) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:co:list', (_e, { project_id, ...opts }: any) => { try { return ip().listChangeOrders(project_id, opts); } catch (e: any) { return { error: e?.message }; } });
  // F127 timesheet periods
  ipcMain.handle('feat:timesheet:open', (_e, p: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ip().openTimesheetPeriod({ ...p, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:timesheet:submit', (_e, { period_id }: any) => { try {  const _r = ip().submitTimesheet(period_id); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:timesheet:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ip().listTimesheetPeriods(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  // F128 timesheet approvals
  ipcMain.handle('feat:timesheet:approve', (_e, { period_id, approver_id, action, comment }: any) => { try {  const _r = ip().approveTimesheet(period_id, approver_id, action, comment); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:timesheet:approvals', (_e, { period_id }: any) => { try { return ip().getTimesheetApprovals(period_id); } catch (e: any) { return { error: e?.message }; } });
  // F129 billable summary
  ipcMain.handle('feat:billable-summary:rebuild', (_e, { period_start, period_end }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; const _r = ip().rebuildBillableTimeSummary(cid, period_start, period_end); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:billable-summary:get', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ip().getBillableTimeSummary(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  // F130 profitability
  ipcMain.handle('feat:profitability:capture', (_e, { project_id, snapshot_date }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = ip().captureProjectProfitability(cid, project_id, snapshot_date); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:profitability:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ip().listProfitabilitySnapshots(cid, opts); } catch (e: any) { return { error: e?.message }; } });

  // ─── Batch 9: CRM, Sales, Quotes (20) ───────────
  const cs = () => require('../services/crm-sales-features');
  // F131 stages
  ipcMain.handle('feat:stage:upsert', (_e, s: any) => { try { const cid = db.getCurrentCompanyId(); const _r = cs().upsertStage({ ...s, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:stage:list', (_e, { active_only }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cs().listStages(cid, !!active_only); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:stage:seed-defaults', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return { seeded: 0 }; const _r = cs().seedDefaultStages(cid); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  // F132 deals
  ipcMain.handle('feat:deal:upsert', (_e, d: any) => { try { const cid = db.getCurrentCompanyId(); const _r = cs().upsertDeal({ ...d, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:deal:move-stage', (_e, { deal_id, stage_id }: any) => { try {  const _r = cs().moveDealStage(deal_id, stage_id); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:deal:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cs().listDeals(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:deal:pipeline-summary', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cs().pipelineSummary(cid); } catch (e: any) { return { error: e?.message }; } });
  // F133 activities
  ipcMain.handle('feat:activity:log', (_e, a: any) => { try { const cid = db.getCurrentCompanyId(); const _r = cs().logActivity({ ...a, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:activity:list', (_e, { deal_id, limit }: any) => { try { return cs().listActivities(deal_id, limit); } catch (e: any) { return { error: e?.message }; } });
  // F134 targets
  ipcMain.handle('feat:target:upsert', (_e, t: any) => { try { const cid = db.getCurrentCompanyId(); const _r = cs().upsertTarget({ ...t, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:target:refresh', (_e, { target_id }: any) => { try {  const _r = cs().refreshTargetActuals(target_id); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:target:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cs().listTargets(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  // F135 performance snapshots
  ipcMain.handle('feat:perf:capture', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = cs().captureSalesPerformance(cid, opts); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:perf:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cs().listPerformanceSnapshots(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  // F136 lead forms
  ipcMain.handle('feat:lead-form:upsert', (_e, f: any) => { try { const cid = db.getCurrentCompanyId(); const _r = cs().upsertLeadForm({ ...f, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:lead-form:submit', (_e, { form_id, data, ip_address }: any) => { try {  const _r = cs().recordLeadSubmission(form_id, data, ip_address); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:lead-form:list', (_e, { active_only }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cs().listLeadForms(cid, !!active_only); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:lead-form:submissions', (_e, { form_id, limit }: any) => { try { return cs().getLeadSubmissions(form_id, limit); } catch (e: any) { return { error: e?.message }; } });
  // F137 scoring rules
  ipcMain.handle('feat:scoring:upsert', (_e, r: any) => { try { const cid = db.getCurrentCompanyId(); const _r = cs().upsertScoringRule({ ...r, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:scoring:score', (_e, { data }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return 0; return cs().scoreLead(cid, data); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:scoring:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cs().listScoringRules(cid); } catch (e: any) { return { error: e?.message }; } });
  // F138 routing rules
  ipcMain.handle('feat:routing:upsert', (_e, r: any) => { try { const cid = db.getCurrentCompanyId(); const _r = cs().upsertRoutingRule({ ...r, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:routing:route', (_e, { data }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return cs().routeLead(cid, data); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:routing:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cs().listRoutingRules(cid); } catch (e: any) { return { error: e?.message }; } });
  // F139 territories
  ipcMain.handle('feat:territory:upsert', (_e, t: any) => { try { const cid = db.getCurrentCompanyId(); const _r = cs().upsertTerritory({ ...t, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:territory:list', (_e, { active_only }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cs().listTerritories(cid, !!active_only); } catch (e: any) { return { error: e?.message }; } });
  // F140 commission plans
  ipcMain.handle('feat:comm-plan:upsert', (_e, p: any) => { try { const cid = db.getCurrentCompanyId(); const _r = cs().upsertCommissionPlan({ ...p, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:comm-plan:list', (_e, { active_only }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cs().listCommissionPlans(cid, !!active_only); } catch (e: any) { return { error: e?.message }; } });
  // F141 commission calcs
  ipcMain.handle('feat:comm:calc', (_e, { rep_id, plan_id, period_start, period_end }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = cs().calculateCommission(cid, rep_id, plan_id, period_start, period_end); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:comm:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cs().listCommissionCalculations(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:comm:mark-paid', (_e, { id }: any) => { try {  const _r = { ok: cs().markCommissionPaid(id) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  // F142 discount rules
  ipcMain.handle('feat:discount:upsert', (_e, r: any) => { try { const cid = db.getCurrentCompanyId(); const _r = cs().upsertDiscountRule({ ...r, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:discount:evaluate', (_e, order: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return { discount_amount: 0, applied_rules: [] }; return cs().evaluateDiscountRules(cid, order); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:discount:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cs().listDiscountRules(cid); } catch (e: any) { return { error: e?.message }; } });
  // F143 promo codes
  ipcMain.handle('feat:promo:upsert', (_e, p: any) => { try { const cid = db.getCurrentCompanyId(); const _r = cs().upsertPromoCode({ ...p, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:promo:redeem', (_e, { code, customer_id, order_total, invoice_id }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return { success: false, reason: 'No company' }; const _r = cs().redeemPromoCode(cid, code, customer_id, order_total, invoice_id); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:promo:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cs().listPromoCodes(cid); } catch (e: any) { return { error: e?.message }; } });
  // F144 loyalty
  ipcMain.handle('feat:loyalty:tier-upsert', (_e, t: any) => { try { const cid = db.getCurrentCompanyId(); return cs().upsertLoyaltyTier({ ...t, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:loyalty:award', (_e, { customer_id, points, reason, invoice_id }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = cs().awardPoints(cid, customer_id, points, reason, invoice_id); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:loyalty:status', (_e, { customer_id }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return cs().getLoyaltyStatus(cid, customer_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:loyalty:tiers', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cs().listLoyaltyTiers(cid); } catch (e: any) { return { error: e?.message }; } });
  // F145 referrals
  ipcMain.handle('feat:referral:record', (_e, r: any) => { try { const cid = db.getCurrentCompanyId(); const _r = cs().recordReferral({ ...r, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:referral:convert', (_e, { id, referee_customer_id }: any) => { try {  const _r = { ok: cs().convertReferral(id, referee_customer_id) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:referral:pay-reward', (_e, { id }: any) => { try {  const _r = { ok: cs().payReferralReward(id) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:referral:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cs().listReferrals(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  // F146 quote templates
  ipcMain.handle('feat:quote-tpl:set-lines', (_e, { template_id, lines }: any) => { try {  const _r = cs().setQuoteTemplateLines(template_id, lines); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:quote-tpl:get-lines', (_e, { template_id }: any) => { try { return cs().getQuoteTemplateLines(template_id); } catch (e: any) { return { error: e?.message }; } });
  // F147 quote conversion
  ipcMain.handle('feat:quote:log-conversion', (_e, { quote_id, invoice_id, converted_by, notes }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = cs().logQuoteConversion(cid, quote_id, invoice_id, converted_by, notes); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:quote:conversion-list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cs().listQuoteConversions(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  // F148 quote signatures
  ipcMain.handle('feat:quote:sign', (_e, s: any) => { try {  const _r = cs().signQuote(s); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:quote:signatures', (_e, { quote_id }: any) => { try { return cs().getQuoteSignatures(quote_id); } catch (e: any) { return { error: e?.message }; } });
  // F149 RFP tracking
  ipcMain.handle('feat:rfp:upsert', (_e, r: any) => { try { const cid = db.getCurrentCompanyId(); const _r = cs().upsertRFP({ ...r, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:rfp:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cs().listRFPs(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  // F150 win/loss
  ipcMain.handle('feat:win-loss:record', (_e, w: any) => { try { const cid = db.getCurrentCompanyId(); const _r = cs().recordWinLoss({ ...w, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:win-loss:summary', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return cs().winLossSummary(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:win-loss:list', (_e, { limit }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cs().listWinLossEntries(cid, limit); } catch (e: any) { return { error: e?.message }; } });

  // ─── Batch 10: Compliance, Security, API (20) ───────────
  const cm = () => require('../services/compliance-security-features');
  // F151 retention
  ipcMain.handle('feat:retention:upsert', (_e, p: any) => { try { const cid = db.getCurrentCompanyId(); const _r = cm().upsertRetentionPolicy({ ...p, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:retention:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cm().listRetentionPolicies(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:retention:apply', (_e, { policy_id }: any) => { try {  const _r = cm().applyRetentionPolicy(policy_id); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  // F152 DSR
  ipcMain.handle('feat:dsr:create', (_e, r: any) => { try { const cid = db.getCurrentCompanyId(); const _r = cm().createDataSubjectRequest({ ...r, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:dsr:export', (_e, { subject_email }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = cm().exportSubjectData(cid, subject_email); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:dsr:complete', (_e, { id, fulfilled_by, export_path }: any) => { try {  const _r = { ok: cm().completeDsr(id, fulfilled_by, export_path) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:dsr:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cm().listDsrs(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  // F153 anonymize
  ipcMain.handle('feat:anonymize:subject', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = cm().anonymizeSubject(cid, opts); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:anonymize:list', (_e, { limit }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; const _r = cm().listAnonymizations(cid, limit); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  // F154 audit
  ipcMain.handle('feat:audit:record', (_e, e: any) => { try { const cid = db.getCurrentCompanyId(); cm().recordAuditEvent({ ...e, company_id: cid }); const _r = { ok: true }; scheduleAutoBackup(); return _r; } catch (er: any) { return { error: er?.message }; } });
  ipcMain.handle('feat:audit:history', (_e, { entity_type, entity_id, limit }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cm().getEntityAuditHistory(cid, entity_type, entity_id, limit); } catch (e: any) { return { error: e?.message }; } });
  // F155 sessions
  ipcMain.handle('feat:session:log', (_e, s: any) => { try { const cid = db.getCurrentCompanyId(); const _r = cm().logSession({ ...s, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:session:logout', (_e, { session_id }: any) => { try { return { ok: cm().logLogout(session_id) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:session:list', (_e, { user_id, limit }: any) => { try { return cm().listSessions(user_id, limit); } catch (e: any) { return { error: e?.message }; } });
  // F156 whitelist
  ipcMain.handle('feat:whitelist:add', (_e, w: any) => { try { const cid = db.getCurrentCompanyId(); const _r = cm().addToWhitelist({ ...w, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:whitelist:remove', (_e, { id }: any) => { try {  const _r = { ok: cm().removeFromWhitelist(id) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:whitelist:list', (_e, { active_only }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cm().listWhitelist(cid, active_only !== false); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:whitelist:check', (_e, { ip }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return true; return cm().isIpAllowed(cid, ip); } catch (e: any) { return { error: e?.message }; } });
  // F157 2FA
  ipcMain.handle('feat:2fa:setup', (_e, { user_id, method }: any) => { try {  const _r = cm().setup2FA(user_id, method); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:2fa:enable', (_e, { user_id }: any) => { try {  const _r = { ok: cm().enable2FA(user_id) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:2fa:disable', (_e, { user_id }: any) => { try {  const _r = { ok: cm().disable2FA(user_id) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:2fa:status', (_e, { user_id }: any) => { try { return cm().get2FAStatus(user_id); } catch (e: any) { return { error: e?.message }; } });
  // F158 API tokens
  ipcMain.handle('feat:api-token:create', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = cm().createApiToken(cid, opts); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:api-token:verify', (_e, { plaintext }: any) => { try { return cm().verifyApiToken(plaintext); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:api-token:revoke', (_e, { id }: any) => { try {  const _r = { ok: cm().revokeApiToken(id) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:api-token:list', (_e, { include_revoked }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cm().listApiTokens(cid, !!include_revoked); } catch (e: any) { return { error: e?.message }; } });
  // F159 rate limits + request log
  ipcMain.handle('feat:rate-limit:upsert', (_e, r: any) => { try { const cid = db.getCurrentCompanyId(); const _r = cm().upsertRateLimit({ ...r, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:api-request:log', (_e, r: any) => { try { const cid = db.getCurrentCompanyId(); cm().logApiRequest({ ...r, company_id: cid }); const _r = { ok: true }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:rate-limit:check', (_e, { token_id }: any) => { try { return cm().checkRateLimit(token_id); } catch (e: any) { return { error: e?.message }; } });
  // F160 webhook rotation
  ipcMain.handle('feat:webhook:rotate', (_e, { subscription_id, rotated_by, reason }: any) => { try {  const _r = cm().rotateWebhookSecret(subscription_id, rotated_by, reason); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:webhook:rotations', (_e, { subscription_id }: any) => { try { return cm().listSecretRotations(subscription_id); } catch (e: any) { return { error: e?.message }; } });
  // F161 PCI
  ipcMain.handle('feat:pci:upsert', (_e, i: any) => { try { const cid = db.getCurrentCompanyId(); const _r = cm().upsertPciItem({ ...i, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:pci:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cm().listPciItems(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  // F162 SOC 2
  ipcMain.handle('feat:soc2:upsert', (_e, c: any) => { try { const cid = db.getCurrentCompanyId(); const _r = cm().upsertSoc2Control({ ...c, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:soc2:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cm().listSoc2Controls(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  // F163 masking
  ipcMain.handle('feat:mask:upsert', (_e, r: any) => { try { const cid = db.getCurrentCompanyId(); const _r = cm().upsertMaskingRule({ ...r, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:mask:apply', (_e, { value, mask_type, visible_chars, replacement_char }: any) => { try {  const _r = cm().applyMask(value, mask_type, visible_chars, replacement_char); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:mask:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cm().listMaskingRules(cid); } catch (e: any) { return { error: e?.message }; } });
  // F164 RTBF
  ipcMain.handle('feat:rtbf:create', (_e, r: any) => { try { const cid = db.getCurrentCompanyId(); const _r = cm().createRtbfRequest({ ...r, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:rtbf:verify', (_e, { id }: any) => { try { return { ok: cm().verifyRtbfRequest(id) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:rtbf:fulfill', (_e, { id, ...opts }: any) => { try { return { ok: cm().fulfillRtbfRequest(id, opts) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:rtbf:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cm().listRtbfRequests(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  // F165 consent
  ipcMain.handle('feat:consent:record', (_e, c: any) => { try { const cid = db.getCurrentCompanyId(); const _r = cm().recordConsent({ ...c, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:consent:withdraw', (_e, { id }: any) => { try { return { ok: cm().withdrawConsent(id) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:consent:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cm().getConsents(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  // F166 sub-processors
  ipcMain.handle('feat:sub-processor:upsert', (_e, s: any) => { try { const cid = db.getCurrentCompanyId(); const _r = cm().upsertSubProcessor({ ...s, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:sub-processor:list', (_e, { active_only }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cm().listSubProcessors(cid, active_only !== false); } catch (e: any) { return { error: e?.message }; } });
  // F167 data classifications
  ipcMain.handle('feat:classify:upsert', (_e, c: any) => { try { const cid = db.getCurrentCompanyId(); const _r = cm().classifyData({ ...c, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:classify:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cm().listClassifications(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  // F168 encryption verification
  ipcMain.handle('feat:encryption:verify', (_e, v: any) => { try { const cid = db.getCurrentCompanyId(); return cm().recordEncryptionVerification({ ...v, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:encryption:list', (_e, { limit }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cm().listEncryptionVerifications(cid, limit); } catch (e: any) { return { error: e?.message }; } });
  // F169 backup verification
  ipcMain.handle('feat:backup-verify:record', (_e, v: any) => { try { const cid = db.getCurrentCompanyId(); const _r = cm().recordBackupVerification({ ...v, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:backup-verify:list', (_e, { limit }: any = {}) => { try { const cid = db.getCurrentCompanyId(); return cm().listBackupVerifications(cid, limit); } catch (e: any) { return { error: e?.message }; } });
  // F170 vulnerabilities
  ipcMain.handle('feat:vuln:upsert', (_e, v: any) => { try { const cid = db.getCurrentCompanyId(); const _r = cm().upsertVulnerability({ ...v, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vuln:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return cm().listVulnerabilities(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vuln:remediated', (_e, { id }: any) => { try { return { ok: cm().markVulnerabilityRemediated(id) }; } catch (e: any) { return { error: e?.message }; } });

  // ═══════════════════════════════════════════════════════════════
  // ACCOUNTING DEEP-DIVE: 90 features (F171-F260) — IPC handlers
  // ═══════════════════════════════════════════════════════════════
  const ag = () => require('../services/accounting-gl-features');
  const aa = () => require('../services/accounting-analytics-features');

  // ─── Batch A: GL & JE Operations ───
  ipcMain.handle('feat:recurring-je:upsert', (_e, r: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ag().upsertRecurringJE({ ...r, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:recurring-je:list', (_e, { active_only }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ag().listRecurringJEs(cid, { active_only }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:recurring-je:due', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ag().dueRecurringJEs(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:recurring-je:advance', (_e, { id }: any) => { try { return ag().advanceRecurringJE(id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:recurring-je:pause', (_e, { id, paused }: any) => { try { return { ok: ag().pauseRecurringJE(id, paused !== false) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:reversing-je:mark', (_e, { je_id, reverse_on_date }: any) => { try {  const _r = { ok: ag().markJEReversing(je_id, reverse_on_date) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:reversing-je:link', (_e, { original_je_id, reversing_je_id }: any) => { try { return { ok: ag().linkReversingJE(original_je_id, reversing_je_id) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:reversing-je:due', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ag().dueReversingEntries(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:je-template:upsert', (_e, t: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ag().upsertJETemplate({ ...t, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:je-template:list', (_e, { category }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ag().listJETemplates(cid, category); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:je-template:use', (_e, { id }: any) => { try { ag().incrementTemplateUse(id); return { ok: true }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:je-fx:calc', (_e, { amount, from_rate, to_rate }: any) => { try {  const _r = ag().calcFxAdjustment(amount, from_rate, to_rate); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:ic-je:pair', (_e, opts: any) => { try { return ag().pairInterCompanyJEs(opts.parent_je_id, opts.counterparty_je_id, opts.parent_company_id, opts.counterparty_company_id, opts.notes); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:ic-je:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ag().listInterCompanyPairs(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:je-import:start', (_e, { file_name, imported_by }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = ag().startJEImport(cid, file_name, imported_by); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:je-import:finish', (_e, { id, ...summary }: any) => { try { return { ok: ag().finishJEImport(id, summary) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:je-import:list', (_e, { limit }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ag().listJEImports(cid, limit); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:je:clone-lines', (_e, { source_je_id }: any) => { try { return ag().cloneJELines(source_je_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:je-attach:add', (_e, a: any) => { try {  const _r = ag().addJEAttachment(a); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:je-attach:list', (_e, { je_id }: any) => { try { return ag().listJEAttachments(je_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:alloc-rule:upsert', (_e, r: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ag().upsertAllocationRule({ ...r, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:alloc-rule:apply', (_e, { rule_id, amount }: any) => { try {  const _r = ag().applyAllocation(rule_id, amount); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:alloc-rule:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ag().listAllocationRules(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:narrative:upsert', (_e, n: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ag().upsertNarrative({ ...n, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:narrative:render', (_e, { slug, vars }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return ''; return ag().renderNarrative(cid, slug, vars || {}); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:narrative:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ag().listNarratives(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:je:proof', (_e, { lines }: any) => { try { return ag().proofJELines(lines || []); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:je:batch-post', (_e, { ids }: any) => { try { return ag().batchPostJEs(ids || []); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:je-comment:add', (_e, { je_id, user_id, user_email, comment }: any) => { try {  const _r = ag().addJEComment(je_id, user_id, user_email, comment); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:je-comment:list', (_e, { je_id }: any) => { try { return ag().listJEComments(je_id); } catch (e: any) { return { error: e?.message }; } });

  // ─── Batch B: Chart of Accounts ───
  ipcMain.handle('feat:account:set-parent', (_e, { account_id, parent_account_id }: any) => { try {  const _r = { ok: ag().setAccountParent(account_id, parent_account_id) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:account:tree', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ag().getAccountTree(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:account:merge', (_e, { primary_id, duplicate_ids }: any) => { try { return ag().mergeAccounts(primary_id, duplicate_ids || []); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:account:renumber', (_e, { account_id, new_code, renamed_by, notes }: any) => { try { return ag().renumberAccount(account_id, new_code, renamed_by, notes); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:account:roll-up', (_e, { as_of_date }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ag().rollUpAccountBalances(cid, as_of_date); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:account:set-suspense', (_e, { account_id, is_suspense }: any) => { try {  const _r = { ok: ag().setAsSuspense(account_id, is_suspense !== false) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:account:get-suspense', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return ag().getSuspenseAccount(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:account:close', (_e, { account_id, reason }: any) => { try { return { ok: ag().closeAccount(account_id, reason) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:account:reopen', (_e, { account_id }: any) => { try { return { ok: ag().reopenAccount(account_id) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:account:set-tax-mapping', (_e, { account_id, tax_line_code, tax_form }: any) => { try {  const _r = { ok: ag().setAccountTaxMapping(account_id, tax_line_code, tax_form) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:account:by-tax-line', (_e, { tax_line_code }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ag().getAccountsByTaxLine(cid, tax_line_code); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:account:set-cash-flow', (_e, { account_id, section, subsection }: any) => { try {  const _r = { ok: ag().setAccountCashFlowMapping(account_id, section, subsection) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:opening-balance:set', (_e, b: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ag().setOpeningBalance({ ...b, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:opening-balance:list', (_e, { as_of_date }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ag().listOpeningBalances(cid, as_of_date); } catch (e: any) { return { error: e?.message }; } });

  // ─── Batch C: Period Close + Adjustments ───
  ipcMain.handle('feat:close-tpl:upsert', (_e, t: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ag().upsertCloseTemplate({ ...t, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:close-tpl:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ag().listCloseTemplates(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:accrual:create', (_e, a: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ag().createAccrual({ ...a, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:accrual:post', (_e, { id, posted_je_id }: any) => { try {  const _r = { ok: ag().postAccrual(id, posted_je_id) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:accrual:due-reversals', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ag().dueAccrualReversals(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:accrual:mark-reversed', (_e, { id, reversal_je_id }: any) => { try {  const _r = { ok: ag().markAccrualReversed(id, reversal_je_id) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:accrual:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ag().listAccruals(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:prepaid:create', (_e, s: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ag().createPrepaidSchedule({ ...s, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:prepaid:recognize', (_e, { id, recognition_date, posted_je_id }: any) => { try { return ag().recognizePrepaid(id, recognition_date, posted_je_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:prepaid:due', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ag().duePrepaidRecognitions(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:prepaid:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ag().listPrepaidSchedules(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:deferred-rev:create', (_e, s: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ag().createDeferredRevenueSchedule({ ...s, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:deferred-rev:recognize', (_e, { id, recognition_date, posted_je_id }: any) => { try { return ag().recognizeDeferredRevenue(id, recognition_date, posted_je_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:deferred-rev:due', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ag().dueDeferredRevenue(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:deferred-rev:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ag().listDeferredRevenue(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:auto:bank-fee', (_e, { amount, account_id, description }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return ag().autoBookBankFee(cid, amount, account_id, description); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:auto:interest-accrual', (_e, { amount, account_id, description }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return ag().autoBookInterestAccrual(cid, amount, account_id, description); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:period:is-locked', (_e, { date }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return false; return ag().isPeriodLocked(cid, date); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:close:quarter-checklist', (_e, { quarter_end_date }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return ag().quarterEndChecklist(cid, quarter_end_date); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:close:year-end', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return ag().runYearEndClose({ ...opts, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:close:list-year-ends', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ag().listYearEndCloses(cid); } catch (e: any) { return { error: e?.message }; } });

  // ─── Batch D: Fixed Assets Advanced ───
  ipcMain.handle('feat:asset:dispose', (_e, d: any) => { try { const cid = db.getCurrentCompanyId(); return ag().disposeAsset({ ...d, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:asset:disposals', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ag().listAssetDisposals(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:asset:transfer', (_e, t: any) => { try { const cid = db.getCurrentCompanyId(); return ag().transferAsset({ ...t, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:asset:transfers', (_e, { asset_id }: any) => { try { return ag().listAssetTransfers(asset_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:asset:partial-dispose', (_e, d: any) => { try { const cid = db.getCurrentCompanyId(); return ag().partialDispose({ ...d, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:asset:impair', (_e, i: any) => { try { const cid = db.getCurrentCompanyId(); return ag().impairAsset({ ...i, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:asset:impairments', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ag().listImpairments(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:asset:revalue', (_e, r: any) => { try { const cid = db.getCurrentCompanyId(); return ag().revalueAsset({ ...r, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:asset:componentize', (_e, { parent_asset_id, components }: any) => { try { return ag().componentizeAsset(parent_asset_id, components || []); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:aro:create', (_e, a: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ag().createARO({ ...a, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:aro:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ag().listAROs(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:asset-ins:upsert', (_e, i: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ag().upsertAssetInsurance({ ...i, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:asset-ins:list', (_e, { asset_id }: any) => { try { return ag().listAssetInsurance(asset_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:asset-warranty:upsert', (_e, w: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ag().upsertAssetWarranty({ ...w, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:asset-warranty:list', (_e, { asset_id }: any) => { try { return ag().listAssetWarranties(asset_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:asset-warranty:expiring', (_e, { days_ahead }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ag().expiringWarranties(cid, days_ahead || 60); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:asset:set-convention', (_e, { asset_id, convention }: any) => { try {  const _r = { ok: ag().setDepreciationConvention(asset_id, convention) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });

  // ─── Batch E: Revenue Recognition ───
  ipcMain.handle('feat:contract:upsert', (_e, c: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ag().upsertContract({ ...c, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:contract:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ag().listContracts(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:obligation:upsert', (_e, o: any) => { try {  const _r = ag().upsertObligation(o); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:obligation:list', (_e, { contract_id }: any) => { try { return ag().listObligations(contract_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:contract-mod:log', (_e, m: any) => { try {  const _r = ag().logContractModification(m); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:contract-mod:list', (_e, { contract_id }: any) => { try { return ag().listContractModifications(contract_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:ssp:upsert', (_e, s: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ag().upsertSSP({ ...s, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:ssp:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ag().listSSPs(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:var-consid:record', (_e, v: any) => { try {  const _r = ag().recordVariableConsideration(v); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:rev-milestone:create', (_e, m: any) => { try {  const _r = ag().createRevenueMilestone(m); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:rev-milestone:complete', (_e, { milestone_id, completion_date, posted_je_id }: any) => { try {  const _r = ag().completeMilestone(milestone_id, completion_date, posted_je_id); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:rev-milestone:list', (_e, { obligation_id }: any) => { try { return ag().listMilestones(obligation_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:sub-waterfall', (_e, { months_ahead }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ag().subscriptionWaterfall(cid, months_ahead || 12); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:bundle:allocate', (_e, { items, transaction_price }: any) => { try { return ag().allocateBundleRevenue(items || [], transaction_price); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:returns-reserve:calc', (_e, { period_start, period_end, historical_rate }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = ag().calculateReturnsReserve(cid, period_start, period_end, historical_rate); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:returns-reserve:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ag().listReturnsReserves(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:rebate:upsert', (_e, r: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ag().upsertRebateAccrual({ ...r, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:rebate:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ag().listRebateAccruals(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:comm-defer:create', (_e, c: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ag().deferCommission({ ...c, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:comm-defer:amortize', (_e, { deferral_id, amount }: any) => { try { return ag().amortizeCommission(deferral_id, amount); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:comm-defer:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ag().listCommissionDeferrals(cid); } catch (e: any) { return { error: e?.message }; } });

  // ─── Batch F: Cost Accounting ───
  ipcMain.handle('feat:cost-center:upsert', (_e, c: any) => { try { const cid = db.getCurrentCompanyId(); const _r = aa().upsertCostCenter({ ...c, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:cost-center:list', (_e, { active_only }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().listCostCenters(cid, !!active_only); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:cost-alloc:upsert', (_e, r: any) => { try { const cid = db.getCurrentCompanyId(); const _r = aa().upsertCostAllocationRule({ ...r, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:cost-alloc:run', (_e, { rule_id, amount }: any) => { try {  const _r = aa().runCostAllocation(rule_id, amount); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:cost-alloc:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().listAllocationRulesF(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:dept:upsert', (_e, d: any) => { try { const cid = db.getCurrentCompanyId(); const _r = aa().upsertDepartment({ ...d, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:dept:list', (_e, { active_only }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().listDepartments(cid, !!active_only); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:dept:pl', (_e, { department_id, period_start, period_end }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return aa().departmentPL(cid, department_id, period_start, period_end); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:cost-pool:upsert', (_e, p: any) => { try { const cid = db.getCurrentCompanyId(); const _r = aa().upsertCostPool({ ...p, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:cost-pool:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().listCostPools(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:std-cost:upsert', (_e, s: any) => { try { const cid = db.getCurrentCompanyId(); const _r = aa().upsertStandardCost({ ...s, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:std-cost:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().listStandardCosts(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:variance:calc', (_e, v: any) => { try { const cid = db.getCurrentCompanyId(); const _r = aa().calculateVariance({ ...v, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:variance:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().listVarianceAnalyses(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:overhead:upsert', (_e, r: any) => { try { const cid = db.getCurrentCompanyId(); const _r = aa().upsertOverheadRate({ ...r, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:overhead:apply', (_e, { rate_id, units }: any) => { try {  const _r = aa().applyOverhead(rate_id, units); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:overhead:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().listOverheadRates(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:wip:upsert', (_e, w: any) => { try { const cid = db.getCurrentCompanyId(); const _r = aa().upsertWIP({ ...w, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:wip:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().listWIP(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:cogs:compute', (_e, { period_start, period_end }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return aa().computeCOGS(cid, period_start, period_end); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:burden:upsert', (_e, b: any) => { try { const cid = db.getCurrentCompanyId(); const _r = aa().upsertBurdenRate({ ...b, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:burden:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().listBurdenRates(cid); } catch (e: any) { return { error: e?.message }; } });

  // ─── Batch G: Audit & Controls ───
  ipcMain.handle('feat:tb-snap:capture', (_e, { period_end, fiscal_year }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = aa().captureTBSnapshot(cid, period_end, fiscal_year); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:tb-snap:compare', (_e, { period_end_1, period_end_2 }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().compareTBSnapshots(cid, period_end_1, period_end_2); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:tb-snap:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().listTBSnapshots(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:materiality:calc', (_e, m: any) => { try { const cid = db.getCurrentCompanyId(); const _r = aa().calculateMateriality({ ...m, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:materiality:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().listMaterialityCalcs(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:audit-sample:generate', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); return aa().generateAuditSample({ ...opts, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:audit-sample:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().listAuditSamples(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:audit-confirm:upsert', (_e, c: any) => { try { const cid = db.getCurrentCompanyId(); const _r = aa().upsertAuditConfirmation({ ...c, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:audit-confirm:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().listAuditConfirmations(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:walkthrough:record', (_e, w: any) => { try { const cid = db.getCurrentCompanyId(); const _r = aa().recordWalkthrough({ ...w, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:walkthrough:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().listWalkthroughs(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:sod:declare', (_e, c: any) => { try { const cid = db.getCurrentCompanyId(); return aa().declareSoDConflict({ ...c, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:sod:assign', (_e, a: any) => { try { const cid = db.getCurrentCompanyId(); return aa().assignUserFunction({ ...a, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:sod:check', (_e, { user_id }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return aa().checkSoDForUser(cid, user_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:sod:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().listSoDConflicts(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:rcsa:upsert', (_e, r: any) => { try { const cid = db.getCurrentCompanyId(); const _r = aa().upsertRCSA({ ...r, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:rcsa:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().listRCSAs(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:audit-issue:upsert', (_e, i: any) => { try { const cid = db.getCurrentCompanyId(); const _r = aa().upsertAuditIssue({ ...i, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:audit-issue:resolve', (_e, { id, resolution_notes }: any) => { try { return { ok: aa().resolveAuditIssue(id, resolution_notes) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:audit-issue:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().listAuditIssues(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:control-def:log', (_e, d: any) => { try { const cid = db.getCurrentCompanyId(); const _r = aa().logControlDeficiency({ ...d, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:control-def:remediate', (_e, { id }: any) => { try { return { ok: aa().remediateDeficiency(id) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:control-def:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().listControlDeficiencies(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:auditor-inq:log', (_e, i: any) => { try { const cid = db.getCurrentCompanyId(); const _r = aa().logAuditorInquiry({ ...i, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:auditor-inq:respond', (_e, { id, response_text, response_by, supporting_docs }: any) => { try { return { ok: aa().respondToInquiry(id, response_text, response_by, supporting_docs) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:auditor-inq:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().listAuditorInquiries(cid, opts); } catch (e: any) { return { error: e?.message }; } });

  // ─── Batch H: Budgeting & Forecasting Advanced ───
  ipcMain.handle('feat:roll-fcst:upsert', (_e, f: any) => { try { const cid = db.getCurrentCompanyId(); const _r = aa().upsertRollingForecast({ ...f, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:roll-fcst:set-lines', (_e, { forecast_id, lines }: any) => { try {  const _r = aa().setForecastLines(forecast_id, lines || []); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:roll-fcst:get-lines', (_e, { forecast_id }: any) => { try { return aa().getForecastLines(forecast_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:roll-fcst:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().listRollingForecasts(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:scenario:create', (_e, s: any) => { try { const cid = db.getCurrentCompanyId(); const _r = aa().createScenario({ ...s, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:scenario:apply', (_e, { base_lines, assumptions }: any) => { try {  const _r = aa().applyAssumptions(base_lines || [], assumptions || {}); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:scenario:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().listScenarios(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:variance-expl:record', (_e, v: any) => { try { const cid = db.getCurrentCompanyId(); const _r = aa().recordVarianceExplanation({ ...v, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:variance-expl:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().listVarianceExplanations(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:driver:upsert', (_e, d: any) => { try { const cid = db.getCurrentCompanyId(); const _r = aa().upsertBudgetDriver({ ...d, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:driver:project', (_e, { driver_id, periods }: any) => { try { return aa().projectFromDriver(driver_id, periods); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:driver:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().listBudgetDrivers(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:budget-cons:create', (_e, c: any) => { try { const cid = db.getCurrentCompanyId(); const _r = aa().createBudgetConsolidation({ ...c, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:budget-cons:approve', (_e, { id, approved_by }: any) => { try {  const _r = { ok: aa().approveBudgetConsolidation(id, approved_by) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:budget-cons:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().listBudgetConsolidations(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:budget-appr:log', (_e, a: any) => { try { const cid = db.getCurrentCompanyId(); const _r = aa().logBudgetApproval({ ...a, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:budget-appr:list', (_e, { budget_id }: any) => { try { return aa().listBudgetApprovals(budget_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:fcst-acc:record', (_e, a: any) => { try { const cid = db.getCurrentCompanyId(); const _r = aa().recordForecastAccuracy({ ...a, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:fcst-acc:summary', (_e, { forecast_id }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return aa().summarizeForecastAccuracy(cid, forecast_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:direct-cash:upsert', (_e, f: any) => { try { const cid = db.getCurrentCompanyId(); const _r = aa().upsertDirectCashForecast({ ...f, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:direct-cash:list', (_e, { limit }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().listDirectCashForecasts(cid, limit); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:headcount:upsert', (_e, h: any) => { try { const cid = db.getCurrentCompanyId(); const _r = aa().upsertHeadcountBudget({ ...h, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:headcount:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().listHeadcountBudgets(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:capex:upsert', (_e, c: any) => { try { const cid = db.getCurrentCompanyId(); const _r = aa().upsertCapEx({ ...c, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:capex:approve', (_e, { id, approved_cost, approved_by }: any) => { try {  const _r = { ok: aa().approveCapEx(id, approved_cost, approved_by) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:capex:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().listCapEx(cid, opts); } catch (e: any) { return { error: e?.message }; } });

  // ─── Batch I: Financial Statements + Analysis ───
  ipcMain.handle('feat:stmt-cfg:upsert', (_e, c: any) => { try { const cid = db.getCurrentCompanyId(); const _r = aa().upsertStatementConfig({ ...c, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:stmt-cfg:list', (_e, { statement_type }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().listStatementConfigs(cid, statement_type); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:common-size', (_e, { lines, base_amount }: any) => { try { return aa().commonSizeStatement(lines || [], base_amount); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:ratios:calc', (_e, { as_of_date }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = aa().calculateRatios(cid, as_of_date); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:ratios:list', (_e, { limit }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().listRatios(cid, limit); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:kpi:upsert', (_e, k: any) => { try { const cid = db.getCurrentCompanyId(); const _r = aa().upsertKPI({ ...k, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:kpi:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().listKPIs(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:footnote:upsert', (_e, f: any) => { try { const cid = db.getCurrentCompanyId(); const _r = aa().upsertFootnote({ ...f, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:footnote:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return aa().listFootnotes(cid, opts); } catch (e: any) { return { error: e?.message }; } });

  // ═══════════════════════════════════════════════════════════════
  // DYNAMIC WAVE: 90 runtime functions (F261-F350) — IPC handlers
  // ═══════════════════════════════════════════════════════════════
  const ds = () => require('../services/dynamic-search-bulk-features');
  const dp = () => require('../services/dynamic-power-features');

  // ─── Batch J: Global Search (F261-F270) ───
  ipcMain.handle('feat:search:global', (_e, { query, opts }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ds().globalSearch(cid, query, opts || {}); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:search:record-history', (_e, { user_id, query, result_count }: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ds().recordSearchHistory(user_id, cid, query, result_count); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:search:recent', (_e, { user_id, limit }: any) => { try { return ds().listRecentSearches(user_id, limit); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:recently-viewed:list', (_e, { user_id, ...opts }: any) => { try { return ds().listRecentlyViewed(user_id, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:recently-viewed:record', (_e, { user_id, entity_type, entity_id, entity_label }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return false; ds().recordEntityView(user_id, cid, entity_type, entity_id, entity_label); const _r = { ok: true }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:pin:add', (_e, { user_id, entity_type, entity_id, entity_label }: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ds().pinEntity(user_id, cid, entity_type, entity_id, entity_label); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:pin:remove', (_e, { user_id, entity_type, entity_id }: any) => { try {  const _r = { ok: ds().unpinEntity(user_id, entity_type, entity_id) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:pin:list', (_e, { user_id, entity_type }: any) => { try { return ds().listPinnedEntities(user_id, entity_type); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:search:pattern', (_e, { pattern, entity_type, opts }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ds().searchByPattern(cid, pattern, entity_type, opts || {}); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:fuzzy-match', (_e, { name, entity_type, threshold }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ds().fuzzyMatchEntity(cid, name, entity_type, threshold); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:cross-ref', (_e, { entity_type, entity_id }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return ds().crossReferenceEntity(cid, entity_type, entity_id); } catch (e: any) { return { error: e?.message }; } });

  // ─── Batch K: Notifications & Alerts (F271-F280) ───
  ipcMain.handle('feat:notif:create', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ds().createNotification({ company_id: cid, ...opts }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:notif:list', (_e, { user_id, ...opts }: any) => { try { return ds().listUserNotifications(user_id, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:notif:mark-read', (_e, { id }: any) => { try {  const _r = { ok: ds().markNotificationRead(id) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:notif:mark-all-read', (_e, { user_id }: any) => { try {  const _r = { marked: ds().markAllRead(user_id) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:notif:snooze', (_e, { id, until_date }: any) => { try { return { ok: ds().snoozeNotification(id, until_date) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:notif:set-pref', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ds().setNotificationPreference({ company_id: cid, ...opts }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:notif:get-prefs', (_e, { user_id }: any) => { try { return ds().getNotificationPrefs(user_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:alert-rule:create', (_e, rule: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ds().createAlertRule({ ...rule, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:alert-rule:evaluate', (_e, { entity_type, entity_data }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ds().evaluateAlertRules(cid, entity_type, entity_data); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:digest:build', (_e, { user_id, period }: any) => { try { return ds().buildDigestEmail(user_id, period || 'daily'); } catch (e: any) { return { error: e?.message }; } });

  // ─── Batch L: Import / Export (F281-F290) ───
  ipcMain.handle('feat:csv:parse', (_e, { text }: any) => { try { return ds().parseCSVForImport(text); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:csv:detect-mapping', (_e, { headers, entity_type }: any) => { try { return ds().detectColumnMapping(headers, entity_type); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:csv:validate', (_e, { rows, mapping, entity_type }: any) => { try { return ds().validateImportRows(rows, mapping, entity_type); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:import-tpl:save', (_e, tpl: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ds().saveImportTemplate({ ...tpl, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:import-tpl:list', (_e, { entity_type }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; const _r = ds().listImportTemplates(cid, entity_type); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:export:csv', (_e, { rows, columns }: any) => { try {  const _r = ds().exportToCSV(rows, columns); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:export:iif', (_e, { transactions }: any) => { try {  const _r = ds().exportToQuickBooksIIF(transactions); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:export-job:create', (_e, j: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ds().createExportJob({ ...j, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:export-job:list', (_e, { active_only }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; const _r = ds().listExportJobs(cid, active_only !== false); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:export-job:mark-run', (_e, { job_id, output_path }: any) => { try {  const _r = { ok: ds().markExportRun(job_id, output_path) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });

  // ─── Batch M: Bulk Actions (F291-F300) ───
  ipcMain.handle('feat:bulk:update', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ds().bulkUpdate({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:bulk:delete', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ds().bulkDelete({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:bulk:archive', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); return ds().bulkArchive({ ...opts, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:bulk:change-status', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); return ds().bulkChangeStatus({ ...opts, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:bulk:assign', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); return ds().bulkAssign({ ...opts, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:bulk:tag', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); return ds().bulkTag({ ...opts, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:bulk:untag', (_e, opts: any) => { try { return ds().bulkUntag(opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:undo:list', (_e, { user_id, limit }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ds().listUndoableOperations(cid, user_id, limit); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:undo:apply', (_e, { snapshot_id }: any) => { try {  const _r = ds().undoBulkOperation(snapshot_id); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:undo:create-snapshot', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ds().createUndoSnapshot({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });

  // ─── Batch N: Smart Helpers (F301-F310) ───
  ipcMain.handle('feat:smart:anomalies', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return dp().detectAnomalies(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:smart:suggest-category', (_e, { description, vendor_id }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return dp().suggestCategoryByDescription(cid, description, vendor_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:smart:predict-payment', (_e, { invoice_id }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return dp().predictPaymentDate(cid, invoice_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:smart:fill-from-previous', (_e, { entity_type, context }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return {}; return dp().smartFillFromPrevious(cid, entity_type, context || {}); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:smart:canonicalize-vendor', (_e, { input_name }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return dp().canonicalizeVendorName(cid, input_name); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:smart:match-transaction', (_e, { transaction_id, opts }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return { matches: [] }; return dp().matchTransactionToInvoice(cid, transaction_id, opts || {}); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:smart:late-risk', (_e, { customer_id }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return dp().calculateLatePaymentRisk(cid, customer_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:smart:forecast', (_e, { account_id, periods }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return dp().forecastNextPeriod(cid, account_id, periods || 3); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:smart:recommend', (_e, { user_id, limit }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return dp().recommendActions(cid, user_id, limit); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:smart:detect-dupes', (_e, { entity_type, lookback_days }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return dp().detectDuplicateEntries(cid, entity_type || 'expense', lookback_days || 30); } catch (e: any) { return { error: e?.message }; } });

  // ─── Batch O: Keyboard & Macros (F311-F320) ───
  ipcMain.handle('feat:cmd:register', (_e, c: any) => { try { return dp().registerCommand(c); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:cmd:list', (_e, opts: any = {}) => { try { return dp().listCommands(opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:cmd:search', (_e, { query, limit }: any) => { try { return dp().searchCommands(query, limit); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:macro:start', (_e, { user_id, name, scope }: any) => { try {  const _r = dp().recordMacroStart(user_id, name, scope); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:macro:save-steps', (_e, { macro_id, steps }: any) => { try {  const _r = { ok: dp().saveMacroSteps(macro_id, steps) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:macro:get-steps', (_e, { macro_id }: any) => { try { return dp().getMacroSteps(macro_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:macro:list', (_e, { user_id }: any) => { try { return dp().listMacros(user_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:layout:save', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = dp().saveWorkspaceLayout({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:layout:load', (_e, { user_id, name }: any) => { try { return dp().loadWorkspaceLayout(user_id, name); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:layout:list', (_e, { user_id }: any) => { try { return dp().listWorkspaceLayouts(user_id); } catch (e: any) { return { error: e?.message }; } });

  // ─── Batch P: Report Engine (F321-F330) ───
  ipcMain.handle('feat:custom-report:create', (_e, r: any) => { try { const cid = db.getCurrentCompanyId(); const _r = dp().createCustomReport({ ...r, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:custom-report:run', (_e, { report_id, params }: any) => { try {  const _r = dp().runCustomReport(report_id, params); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:pivot:build', (_e, { rows, opts }: any) => { try { return dp().buildPivotTable(rows, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:report-sched:save', (_e, s: any) => { try {  const _r = dp().saveReportSchedule(s); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:report-sched:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return dp().listScheduledReports(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:report-sched:due', () => { try { return dp().listDueReports(); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:report-sched:mark-run', (_e, { schedule_id, next_run_at }: any) => { try {  const _r = { ok: dp().markReportRun(schedule_id, next_run_at) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:custom-report:compare', (_e, { report_id, params_a, params_b }: any) => { try { return dp().comparePeriods(report_id, params_a, params_b); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:custom-report:executions', (_e, { report_id, limit }: any) => { try { return dp().listReportExecutions(report_id, limit); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:custom-report:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return dp().listCustomReports(cid, opts); } catch (e: any) { return { error: e?.message }; } });

  // ─── Batch Q: Webhook Delivery (F331-F340) ───
  ipcMain.handle('feat:webhook:register', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); return dp().registerWebhook({ ...opts, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:webhook:sign', (_e, { payload, secret }: any) => { try {  const _r = dp().signPayload(payload, secret); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:webhook:verify', (_e, { payload, signature, secret }: any) => { try { return dp().verifySignature(payload, signature, secret); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:webhook:queue', (_e, opts: any) => { try {  const _r = dp().queueWebhookDelivery(opts); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:webhook:due', (_e, { limit }: any = {}) => { try { return dp().listDueWebhookDeliveries(limit); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:webhook:record-attempt', (_e, { queue_id, success, error_message }: any) => { try {  const _r = dp().recordDeliveryAttempt(queue_id, success, error_message); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:webhook:deliveries', (_e, opts: any = {}) => { try { return dp().listWebhookDeliveries(opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:webhook:retry', (_e, { queue_id }: any) => { try { return { ok: dp().retryDeadLetter(queue_id) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:webhook:stats', (_e, { hours }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return dp().webhookStats(cid, hours); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:webhook:fire-event', (_e, { event_type, payload }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return { queued_count: 0 }; return dp().fireWebhookForEvent(cid, event_type, payload); } catch (e: any) { return { error: e?.message }; } });

  // ─── Batch R: Real-time + Activity (F341-F350) ───
  ipcMain.handle('feat:activity:record', (_e, a: any) => { try { const cid = db.getCurrentCompanyId(); const _r = dp().recordActivity({ ...a, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:activity:feed', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return dp().listActivityFeed(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:lock:acquire', (_e, opts: any) => { try { return dp().lockEntity(opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:lock:release', (_e, { entity_type, entity_id, user_id }: any) => { try { return { ok: dp().unlockEntity(entity_type, entity_id, user_id) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:lock:check', (_e, { entity_type, entity_id }: any) => { try { return dp().checkEntityLock(entity_type, entity_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:presence:heartbeat', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); return { ok: dp().heartbeatPresence({ ...opts, company_id: cid }) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:presence:active', (_e, { seconds_window }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return dp().listActivePresence(cid, seconds_window); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:presence:on-entity', (_e, { entity_type, entity_id, seconds_window }: any) => { try { return dp().listUsersOnEntity(entity_type, entity_id, seconds_window); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:activity:summary', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return dp().activitySummary(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:lock:cleanup', () => { try { return dp().cleanExpiredLocks(); } catch (e: any) { return { error: e?.message }; } });

  // ═══════════════════════════════════════════════════════════════
  // WAVE 3: 90 features (F351-F440) — IPC handlers
  // ═══════════════════════════════════════════════════════════════
  const ptc = () => require('../services/payroll-tax-consolidation-features');
  const ptd = () => require('../services/portal-time-doc-features');
  const ci = () => require('../services/collab-integration-features');

  // Batch S — Payroll deep-dive
  ipcMain.handle('feat:state-wh:upsert', (_e, t: any) => { try {  const _r = ptc().upsertStateWithholding(t); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:state-wh:calc', (_e, opts: any) => { try {  const _r = ptc().calcStateWithholding(opts); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:garn:upsert', (_e, g: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ptc().upsertGarnishment({ ...g, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:garn:calc', (_e, { employee_id, disposable_earnings }: any) => { try {  const _r = ptc().calcGarnishmentDeductions(employee_id, disposable_earnings); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:garn:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ptc().listGarnishments(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:retire:upsert', (_e, r: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ptc().upsertRetirement({ ...r, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:retire:calc', (_e, { employee_id, period_wages }: any) => { try {  const _r = ptc().calcRetirementContribution(employee_id, period_wages); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:s125:upsert', (_e, s: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ptc().upsertSection125({ ...s, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:s125:list', (_e, { employee_id }: any) => { try { return ptc().listSection125ForEmployee(employee_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:pto-rule:upsert', (_e, r: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ptc().upsertPTORule({ ...r, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:pto-rule:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ptc().listPTORules(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:emp-state:set', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ptc().setEmployeeStateAllocation({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:emp-state:get', (_e, { employee_id }: any) => { try { return ptc().getEmployeeStateAllocations(employee_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:wcomp:upsert', (_e, c: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ptc().upsertWorkersCompClass({ ...c, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:wcomp:calc', (_e, { state_code, class_code, payroll }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return 0; const _r = ptc().calcWorkersCompPremium(cid, state_code, class_code, payroll); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:recip:upsert', (_e, { work_state, resident_state, has_reciprocity, certificate_form }: any) => { try {  const _r = ptc().upsertReciprocity(work_state, resident_state, has_reciprocity, certificate_form); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:recip:check', (_e, { work_state, resident_state }: any) => { try { return ptc().hasReciprocity(work_state, resident_state); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:w2:run', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ptc().createW2Run({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:dd-batch:build', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); return ptc().buildNACHABatch({ ...opts, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:dd-batch:list', (_e, { limit }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ptc().listDirectDepositBatches(cid, limit); } catch (e: any) { return { error: e?.message }; } });

  // Batch T — Sales Tax Engine
  ipcMain.handle('feat:nexus:upsert', (_e, n: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ptc().upsertNexus({ ...n, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:nexus:evaluate', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ptc().evaluateNexus(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:tax-juris:upsert', (_e, j: any) => { try {  const _r = ptc().upsertJurisdiction(j); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:tax-juris:by-zip', (_e, { zip }: any) => { try { return ptc().lookupTaxRateByZip(zip); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:exempt-cert:upsert', (_e, c: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ptc().upsertExemptionCert({ ...c, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:exempt-cert:check', (_e, { customer_id, state_code }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return false; return ptc().isCustomerExempt(cid, customer_id, state_code); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:exempt-cert:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ptc().listExemptionCerts(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:use-tax:record', (_e, u: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ptc().recordUseTax({ ...u, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:tax-sched:upsert', (_e, s: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ptc().upsertFilingSchedule({ ...s, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:tax-sched:upcoming', (_e, { days_ahead }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ptc().listUpcomingFilings(cid, days_ahead || 30); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:tax-liab:record', (_e, l: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ptc().recordSalesTaxLiability({ ...l, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:tax-liab:mark-paid', (_e, { id, payment_je_id }: any) => { try {  const _r = { ok: ptc().markTaxPaid(id, payment_je_id) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:tax-liab:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ptc().listTaxLiability(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:tax-holiday:upsert', (_e, h: any) => { try {  const _r = ptc().upsertSalesTaxHoliday(h); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:tax-holiday:active', (_e, { state_code }: any = {}) => { try { return ptc().listActiveSalesTaxHolidays(state_code); } catch (e: any) { return { error: e?.message }; } });

  // Batch U — Consolidation
  ipcMain.handle('feat:entity:set-sub', (_e, { parent_id, child_id, ownership_pct, method, notes }: any) => { try {  const _r = ptc().setSubsidiary(parent_id, child_id, ownership_pct, method, notes); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:entity:hierarchy', (_e, { parent_id }: any) => { try { return ptc().getEntityHierarchy(parent_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:elim-rule:upsert', (_e, r: any) => { try {  const _r = ptc().upsertElimRule(r); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:elim-rule:list', (_e, { parent_id }: any) => { try { return ptc().listElimRules(parent_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:consol:generate', (_e, opts: any) => { try { return ptc().generateConsolidatedStatement(opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:fx-translation:record', (_e, t: any) => { try {  const _r = ptc().recordCurrencyTranslation(t); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:minority:calc', (_e, opts: any) => { try {  const _r = ptc().calcMinorityInterest(opts); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:goodwill:record', (_e, g: any) => { try {  const _r = ptc().recordGoodwill(g); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:goodwill:impair', (_e, { goodwill_id, impairment_amount }: any) => { try { return { ok: ptc().recordGoodwillImpairment(goodwill_id, impairment_amount) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:equity-inv:upsert', (_e, e: any) => { try {  const _r = ptc().upsertEquityInvestment(e); scheduleAutoBackup(); return _r; } catch (er: any) { return { error: er?.message }; } });
  ipcMain.handle('feat:equity-inv:record-income', (_e, { investment_id, investee_income }: any) => { try {  const _r = ptc().recordEquityShareIncome(investment_id, investee_income); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:equity-inv:list', (_e, { investor_company_id }: any) => { try { return ptc().listEquityInvestments(investor_company_id); } catch (e: any) { return { error: e?.message }; } });

  // Batch V — Customer Portal
  ipcMain.handle('feat:portal-cust:invite', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); return ptd().inviteCustomerPortalUser({ ...opts, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:portal:activate', (_e, { token, password }: any) => { try { return ptd().activatePortalUser(token, password); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:portal:auth', (_e, { email, password, company_id, portal_type }: any) => { try { return ptd().authPortalUser(email, password, company_id, portal_type); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:portal:invoices', (_e, { customer_id }: any) => { try { return ptd().listPortalInvoices(customer_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:portal-pay:record', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ptd().recordPortalPayment({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:portal-pay:history', (_e, { portal_user_id, limit }: any) => { try { return ptd().listPortalPaymentHistory(portal_user_id, limit); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:portal:statement', (_e, { customer_id, period_start, period_end }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return ptd().generateCustomerStatement(cid, customer_id, period_start, period_end); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:portal-ticket:create', (_e, t: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ptd().createSupportTicket({ ...t, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:portal-ticket:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ptd().listSupportTickets(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:portal-doc:upload', (_e, d: any) => { try { const cid = db.getCurrentCompanyId(); return ptd().uploadPortalDocument({ ...d, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:auto-pay:enroll', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); return ptd().enrollAutoPay({ ...opts, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:auto-pay:cancel', (_e, { customer_id }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return false; return { ok: ptd().cancelAutoPay(cid, customer_id) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:portal-brand:set', (_e, b: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ptd().setPortalBranding({ ...b, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:portal-brand:get', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return ptd().getPortalBranding(cid); } catch (e: any) { return { error: e?.message }; } });

  // Batch W — Vendor Portal
  ipcMain.handle('feat:portal-vend:invite', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); return ptd().inviteVendorPortalUser({ ...opts, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vendor-po:respond', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); return ptd().respondToPO({ ...opts, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vendor-po:list-responses', (_e, { po_id }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ptd().listPORResponses(cid, po_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vendor-inv:submit', (_e, v: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ptd().submitVendorInvoice({ ...v, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vendor-inv:review', (_e, { id, status, reviewed_by, rejection_reason, matched_bill_id }: any) => { try { return { ok: ptd().reviewVendorInvoice(id, status, reviewed_by, rejection_reason, matched_bill_id) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vendor-inv:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ptd().listVendorInvoiceSubmissions(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vendor-pay:status', (_e, { vendor_id }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return ptd().vendorPaymentStatus(cid, vendor_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vendor-ach:submit', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ptd().submitACHUpdate({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vendor-ach:approve', (_e, { id, approved_by }: any) => { try {  const _r = { ok: ptd().approveACHUpdate(id, approved_by) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vendor-ach:reject', (_e, { id, rejected_by }: any) => { try { return { ok: ptd().rejectACHUpdate(id, rejected_by) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vendor-ach:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ptd().listACHUpdates(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vendor-1099:download', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); return ptd().recordVendor1099Download({ ...opts, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vendor-attest:submit', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ptd().submitComplianceAttestation({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });

  // Batch X — Time Tracking
  ipcMain.handle('feat:timer:start', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ptd().startTimer({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:timer:pause', (_e, { id }: any) => { try { return { ok: ptd().pauseTimer(id) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:timer:resume', (_e, { id }: any) => { try { return { ok: ptd().resumeTimer(id) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:timer:stop', (_e, { id }: any) => { try { return ptd().stopTimer(id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:timer:running', (_e, { user_id }: any) => { try { return ptd().getRunningTimer(user_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:rate:upsert', (_e, r: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ptd().upsertBillableRate({ ...r, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:rate:effective', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); return ptd().getEffectiveRate({ ...opts, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:ot:upsert', (_e, r: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ptd().upsertOvertimeRule({ ...r, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:ot:calc', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ptd().calcOvertime({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:proj-time-budget:upsert', (_e, b: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ptd().upsertProjectTimeBudget({ ...b, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:proj-time-budget:add-hours', (_e, { project_id, hours }: any) => { try {  const _r = ptd().updateConsumedHours(project_id, hours); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:cal-event:sync', (_e, e: any) => { try { return ptd().syncCalendarEvent(e); } catch (er: any) { return { error: er?.message }; } });
  ipcMain.handle('feat:cal-event:to-time-entry', (_e, { event_id, project_id, task_id }: any) => { try { return ptd().convertCalendarToTimeEntry(event_id, project_id, task_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:time:round', (_e, { minutes, interval_minutes, method }: any) => { try { return ptd().applyRounding(minutes, interval_minutes, method); } catch (e: any) { return { error: e?.message }; } });

  // Batch Y — Document Intelligence
  ipcMain.handle('feat:doc:classify', (_e, { text }: any) => { try { return ptd().classifyDocument(text); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:doc:record-classify', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ptd().recordClassification({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:doc-field:extract', (_e, { document_id, field_name, field_value, confidence, method }: any) => { try { return ptd().extractField(document_id, field_name, field_value, confidence, method); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:doc-field:list', (_e, { document_id }: any) => { try { return ptd().getExtractedFields(document_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:bank-stmt:parse', (_e, { text }: any) => { try { return ptd().parseBankStatementCSV(text); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:bank-stmt:import', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ptd().recordBankStatementImport({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:clauses:detect', (_e, { text, document_id }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return { detected: 0 }; return ptd().detectContractClauses(text, document_id, cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:clauses:list', (_e, { document_id }: any) => { try { return ptd().listContractClauses(document_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:sign-flow:start', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ptd().startSigningWorkflow({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:sign-flow:advance', (_e, { workflow_id }: any) => { try {  const _r = ptd().advanceSigningWorkflow(workflow_id); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:doc-expire:list', (_e, { days_ahead }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ptd().findExpiringDocuments(cid, days_ahead || 30); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:retention:upsert-policy', (_e, p: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ptd().upsertRetentionPolicy({ ...p, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:retention:exceeding', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ptd().findDocsExceedingRetention(cid); } catch (e: any) { return { error: e?.message }; } });

  // Batch Z — Collaboration
  ipcMain.handle('feat:mentions:parse', (_e, { body }: any) => { try { return ci().parseMentions(body); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:mentions:list', (_e, { user_id, ...opts }: any) => { try { return ci().listMentions(user_id, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:mentions:mark-read', (_e, { id }: any) => { try {  const _r = { ok: ci().markMentionRead(id) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:comment:add', (_e, c: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ci().addComment({ ...c, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:comment:list', (_e, { entity_type, entity_id, ...opts }: any) => { try { return ci().listComments(entity_type, entity_id, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:comment:edit', (_e, { id, body }: any) => { try { return { ok: ci().editComment(id, body) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:comment:delete', (_e, { id }: any) => { try {  const _r = { ok: ci().deleteComment(id) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:reaction:add', (_e, { comment_id, user_id, emoji }: any) => { try {  const _r = ci().addReaction(comment_id, user_id, emoji); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:reaction:remove', (_e, { comment_id, user_id, emoji }: any) => { try {  const _r = { ok: ci().removeReaction(comment_id, user_id, emoji) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:reaction:list', (_e, { comment_id }: any) => { try { return ci().listReactions(comment_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:internal-note:add', (_e, n: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ci().addInternalNote({ ...n, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:internal-note:list', (_e, { entity_type, entity_id }: any) => { try { return ci().listInternalNotes(entity_type, entity_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:draft:create', (_e, d: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ci().createSharedDraft({ ...d, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:draft:mine', (_e, { user_id }: any) => { try { return ci().listMyDrafts(user_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:watch:add', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ci().watchEntity({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:watch:remove', (_e, { user_id, entity_type, entity_id }: any) => { try {  const _r = { ok: ci().unwatchEntity(user_id, entity_type, entity_id) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:watch:list-for-entity', (_e, { entity_type, entity_id }: any) => { try { return ci().listWatchersForEntity(entity_type, entity_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:inbox:provision', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ci().provisionInboxAddress({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:inbox:match', (_e, { inbox_address }: any) => { try { return ci().recordIncomingEmailMatch(inbox_address); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:chat:send', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); return ci().sendChatMessage({ ...opts, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:chat:list', (_e, opts: any) => { try { return ci().listChatMessages(opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:chat:mark-read', (_e, { id }: any) => { try {  const _r = { ok: ci().markChatRead(id) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });

  // Batch AA — Integration Sync
  ipcMain.handle('feat:stripe:record', (_e, opts: any) => { try {  const _r = ci().recordStripeEvent(opts); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:plaid-link:create', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ci().createPlaidLink({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:plaid-link:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ci().listPlaidLinks(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:plaid-tx:sync', (_e, t: any) => { try { const cid = db.getCurrentCompanyId(); return ci().syncPlaidTransaction({ ...t, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:plaid-tx:unmatched', (_e, { limit }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ci().listUnmatchedPlaidTransactions(cid, limit); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:plaid-tx:match', (_e, { id, entity_type, entity_id }: any) => { try { return { ok: ci().matchPlaidTransaction(id, entity_type, entity_id) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:qb-export:run', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ci().exportToQuickBooks({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:qb-export:list', (_e, { limit }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ci().listQuickBooksExports(cid, limit); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:gmail:sync', (_e, m: any) => { try { const cid = db.getCurrentCompanyId(); return ci().syncGmailMessage({ ...m, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:cloud-file:record', (_e, f: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ci().recordCloudFile({ ...f, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:cloud-file:list', (_e, { provider }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ci().listCloudFiles(cid, provider); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:calendar:link', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); return ci().linkCalendar({ ...opts, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:calendar:integrations', (_e, { user_id }: any) => { try { return ci().listCalendarIntegrations(user_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:webhook-recv:provision', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ci().provisionWebhookEndpoint({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:webhook-recv:received', (_e, { endpoint_path }: any) => { try { return { ok: ci().recordWebhookReceived(endpoint_path) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:webhook-recv:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ci().listWebhookReceiverEndpoints(cid); } catch (e: any) { return { error: e?.message }; } });

  // ═══════════════════════════════════════════════════════════════
  // FINANCE WAVE: 100 features (F441-F540) — IPC handlers
  // ═══════════════════════════════════════════════════════════════
  const inp = () => require('../services/invoice-payment-features');
  const ef = () => require('../services/expense-finance-features');

  // Batch AB — Invoice Advanced
  ipcMain.handle('feat:rec-inv:upsert', (_e, t: any) => { try { const cid = db.getCurrentCompanyId(); const _r = inp().upsertRecurringInvoice({ ...t, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:rec-inv:list', (_e, { active_only }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return inp().listRecurringInvoices(cid, !!active_only); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:rec-inv:due', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return inp().dueRecurringInvoices(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:rec-inv:advance', (_e, { id, generated_invoice_id }: any) => { try { return inp().advanceRecurringInvoice(id, generated_invoice_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:inv-approval:log', (_e, opts: any) => { try {  const _r = inp().logInvoiceApproval(opts); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:inv-approval:list', (_e, { invoice_id }: any) => { try { return inp().listInvoiceApprovals(invoice_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:inv-email:log', (_e, e: any) => { try {  const _r = inp().logInvoiceEmail(e); scheduleAutoBackup(); return _r; } catch (er: any) { return { error: er?.message }; } });
  ipcMain.handle('feat:inv-email:opened', (_e, { tracking_pixel_id }: any) => { try { return { ok: inp().recordEmailOpen(tracking_pixel_id) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:inv-email:clicked', (_e, { tracking_pixel_id }: any) => { try { return { ok: inp().recordEmailClick(tracking_pixel_id) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:latefee:upsert', (_e, p: any) => { try { const cid = db.getCurrentCompanyId(); const _r = inp().upsertLateFeePolicy({ ...p, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:latefee:calc', (_e, opts: any) => { try {  const _r = inp().calcLateFee(opts); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:pay-terms:upsert', (_e, t: any) => { try { const cid = db.getCurrentCompanyId(); const _r = inp().upsertPaymentTerms({ ...t, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:pay-terms:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; const _r = inp().listPaymentTerms(cid); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:early-disc:calc', (_e, { invoice_id, payment_date }: any) => { try {  const _r = inp().calcEarlyPaymentDiscount(invoice_id, payment_date); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:prog-bill:create', (_e, p: any) => { try { const cid = db.getCurrentCompanyId(); const _r = inp().createProgressBilling({ ...p, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:prog-bill:release', (_e, { schedule_id, ...opts }: any) => { try { return inp().releaseProgressBilling(schedule_id, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:prog-bill:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return inp().listProgressBilling(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:retainer:create', (_e, r: any) => { try { const cid = db.getCurrentCompanyId(); const _r = inp().createRetainer({ ...r, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:retainer:drawdown', (_e, { retainer_id, amount, reason, invoice_id }: any) => { try { return inp().drawdownRetainer(retainer_id, amount, reason, invoice_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:retainer:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return inp().listRetainers(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:pay-plan:create', (_e, p: any) => { try { const cid = db.getCurrentCompanyId(); const _r = inp().createPaymentPlan({ ...p, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:pay-plan:pay-installment', (_e, { installment_id, amount }: any) => { try {  const _r = { ok: inp().payInstallment(installment_id, amount) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:pay-plan:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; const _r = inp().listPaymentPlans(cid, opts); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:inv-attach:add', (_e, a: any) => { try {  const _r = inp().addInvoiceAttachment(a); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:inv-attach:list', (_e, { invoice_id }: any) => { try { return inp().listInvoiceAttachments(invoice_id); } catch (e: any) { return { error: e?.message }; } });

  // Batch AC — Payment Processing
  ipcMain.handle('feat:pay-link:create', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = inp().createPaymentLink({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:pay-link:consume', (_e, { short_code, amount }: any) => { try {  const _r = inp().consumePaymentLink(short_code, amount); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:reminder:upsert', (_e, c: any) => { try { const cid = db.getCurrentCompanyId(); const _r = inp().upsertReminderCadence({ ...c, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:reminder:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return inp().listReminderCadences(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:pay-retry:record', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = inp().recordPaymentRetry({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:pay:apply-partial', (_e, { invoice_id, amount }: any) => { try {  const _r = inp().applyPartialPayment(invoice_id, amount); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:cust-credit:add', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = inp().addCustomerCredit({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:cust-credit:apply', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = inp().applyCustomerCredit({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:cust-credit:get', (_e, { customer_id }: any) => { try { return inp().getCustomerCredit(customer_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:refund:record', (_e, r: any) => { try { const cid = db.getCurrentCompanyId(); const _r = inp().recordRefund({ ...r, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:refund:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return inp().listRefunds(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:chargeback:record', (_e, c: any) => { try { const cid = db.getCurrentCompanyId(); const _r = inp().recordChargeback({ ...c, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:chargeback:resolve', (_e, { id, resolution, resolved_at }: any) => { try { return { ok: inp().resolveChargeback(id, resolution, resolved_at) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:cust-pm:add', (_e, m: any) => { try { const cid = db.getCurrentCompanyId(); const _r = inp().addCustomerPaymentMethod({ ...m, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:cust-pm:list', (_e, { customer_id }: any) => { try { return inp().listCustomerPaymentMethods(customer_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:check-print:record', (_e, j: any) => { try { const cid = db.getCurrentCompanyId(); const _r = inp().recordCheckPrintJob({ ...j, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:check-print:list', (_e, { limit }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return inp().listCheckPrintJobs(cid, limit); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:crypto:record', (_e, p: any) => { try { const cid = db.getCurrentCompanyId(); const _r = inp().recordCryptoPayment({ ...p, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });

  // Batch AE — Subscriptions
  ipcMain.handle('feat:sub-plan:upsert', (_e, p: any) => { try { const cid = db.getCurrentCompanyId(); const _r = inp().upsertSubscriptionPlan({ ...p, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:sub-plan:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return inp().listSubscriptionPlans(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:sub:create', (_e, s: any) => { try { const cid = db.getCurrentCompanyId(); const _r = inp().createSubscription({ ...s, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:sub:change-plan', (_e, { subscription_id, new_plan_id }: any) => { try { return inp().changePlanWithProration(subscription_id, new_plan_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:sub:pause', (_e, { id, resume_date }: any) => { try { return { ok: inp().pauseSubscription(id, resume_date) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:sub:resume', (_e, { id }: any) => { try { return { ok: inp().resumeSubscription(id) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:sub:cancel', (_e, { id, at_period_end }: any) => { try { return { ok: inp().cancelSubscription(id, at_period_end) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:usage:record', (_e, u: any) => { try { const cid = db.getCurrentCompanyId(); const _r = inp().recordUsage({ ...u, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:usage:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return inp().listUsage(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:pricing-tier:upsert', (_e, t: any) => { try { const cid = db.getCurrentCompanyId(); const _r = inp().upsertPricingTier({ ...t, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:pricing-tier:calc', (_e, { plan_id, quantity }: any) => { try {  const _r = inp().calcTieredCharge(plan_id, quantity); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:mrr:calc', (_e, { snapshot_date }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = inp().calculateMRR(cid, snapshot_date); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:churn:calc', (_e, { period_start, period_end }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = inp().calculateChurn(cid, period_start, period_end); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });

  // Batch AF — Credit & Collections
  ipcMain.handle('feat:credit:set-limit', (_e, { customer_id, limit }: any) => { try {  const _r = { ok: inp().setCreditLimit(customer_id, limit) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:credit:check', (_e, { customer_id, additional_charge }: any) => { try { return inp().checkCreditLimit(customer_id, additional_charge); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:credit:set-hold', (_e, { customer_id, hold, reason }: any) => { try {  const _r = { ok: inp().setCreditHold(customer_id, hold, reason) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:aging:calc', (_e, { as_of_date }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = inp().calcAgingBuckets(cid, as_of_date); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:statement:generate', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); return inp().generateStatement({ ...opts, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:dunning-seq:create', (_e, s: any) => { try { const cid = db.getCurrentCompanyId(); const _r = inp().createDunningSequence({ ...s, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:dunning:log', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = inp().logDunningEvent({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:writeoff:bad-debt', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); return inp().writeOffBadDebt({ ...opts, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:doubtful:calc', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = inp().calcAllowanceForDoubtful({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:agency:handoff', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); return inp().handOffToCollectionAgency({ ...opts, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:agency:record-recovery', (_e, { handoff_id, recovered_amount }: any) => { try {  const _r = { ok: inp().recordAgencyRecovery(handoff_id, recovered_amount) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:agency:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return inp().listCollectionHandoffs(cid, opts); } catch (e: any) { return { error: e?.message }; } });

  // Batch AD — Expense Advanced
  ipcMain.handle('feat:exp-report:create', (_e, r: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ef().createExpenseReport({ ...r, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:exp-report:add-expenses', (_e, { report_id, expense_ids }: any) => { try {  const _r = ef().addExpensesToReport(report_id, expense_ids); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:exp-report:submit', (_e, { report_id }: any) => { try {  const _r = { ok: ef().submitExpenseReport(report_id) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:exp-report:approve', (_e, { report_id, approved_by }: any) => { try {  const _r = { ok: ef().approveExpenseReport(report_id, approved_by) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:exp-report:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ef().listExpenseReports(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:perdiem:upsert', (_e, p: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ef().upsertPerDiem({ ...p, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:perdiem:calc', (_e, { location, days, include_lodging }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = ef().calcPerDiem(cid, location, days, include_lodging); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vehicle:upsert', (_e, v: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ef().upsertVehicle({ ...v, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vehicle:list', (_e, { user_id }: any) => { try { return ef().listVehicles(user_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:exp:recurring', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ef().listRecurringExpenses(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:exp:forecast', (_e, { months_ahead }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ef().forecastExpenses(cid, months_ahead || 3); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vendor-1099:recalc', (_e, { tax_year, vendor_id }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return ef().recalcVendor1099(cid, tax_year, vendor_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vendor-1099:required', (_e, { tax_year }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ef().listVendors1099Required(cid, tax_year); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:cat-budget:upsert', (_e, b: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ef().upsertCategoryBudget({ ...b, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:cat-budget:refresh-actuals', (_e, { fiscal_year }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = ef().refreshCategoryActuals(cid, fiscal_year); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:reimb:create', (_e, r: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ef().createReimbursement({ ...r, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:reimb:paid', (_e, { id, je_id, payment_method }: any) => { try { return { ok: ef().markReimbursementPaid(id, je_id, payment_method) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:exp:rebillable', (_e, { expense_id, client_id, markup_pct }: any) => { try { return { ok: ef().markExpenseRebillable(expense_id, client_id, markup_pct) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:exp:rebillable-list', (_e, { client_id }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ef().listRebillableExpenses(cid, client_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:exp:rebilled', (_e, { expense_id, invoice_id }: any) => { try { return { ok: ef().markExpenseRebilled(expense_id, invoice_id) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:preapproval:request', (_e, p: any) => { try { const cid = db.getCurrentCompanyId(); return ef().requestPreApproval({ ...p, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:preapproval:approve', (_e, { id, approved_by }: any) => { try {  const _r = { ok: ef().approvePreApproval(id, approved_by) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:preapproval:reject', (_e, { id, reason }: any) => { try { return { ok: ef().rejectPreApproval(id, reason) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:preapproval:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ef().listPreApprovals(cid, opts); } catch (e: any) { return { error: e?.message }; } });

  // Batch AG — Financial Analytics
  ipcMain.handle('feat:ar-aging:chart', (_e, { as_of_date }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ef().arAgingChart(cid, as_of_date); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:ap-aging:chart', (_e, { as_of_date }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ef().apAgingChart(cid, as_of_date); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:dso:calc', (_e, { period_days }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = ef().calcDSO(cid, period_days || 365); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:dpo:calc', (_e, { period_days }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = ef().calcDPO(cid, period_days || 365); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:ccc:calc', (_e, { period_days }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = ef().calcCashConversionCycle(cid, period_days || 365); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:working-capital:calc', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = ef().calcWorkingCapital(cid); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:burn:calc', (_e, { months_history }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = ef().calcBurnRate(cid, months_history || 3); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:runway:calc', (_e, { months_history }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = ef().calcRunway(cid, months_history || 3); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:ltv:calc', (_e, { customer_id }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = ef().calcLTV(cid, customer_id); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:cac:calc', (_e, { period_days }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = ef().calcCAC(cid, period_days || 365); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:ltv-cac:ratio', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return ef().calcLTVCACRatio(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:retention:calc', (_e, { period_start, period_end }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = ef().calcRevenueRetention(cid, period_start, period_end); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:cohort:build', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ef().buildCohortAnalysis(cid); } catch (e: any) { return { error: e?.message }; } });

  // Batch AH — Tax & Compliance
  ipcMain.handle('feat:1099-run:create', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ef().createForm1099Run({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:1099-run:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ef().listForm1099Runs(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:withhold:record', (_e, w: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ef().recordWithholding({ ...w, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:qtax:record', (_e, q: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ef().recordQuarterlyEstimate({ ...q, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:qtax:list', (_e, { tax_year }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ef().listQuarterlyEstimates(cid, tax_year); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:tax-prov:calc', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ef().calcTaxProvision({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:rd-credit:calc', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ef().calcRDCredit({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:179:elect', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); return ef().elect179({ ...opts, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:179:list', (_e, { tax_year }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ef().list179Elections(cid, tax_year); } catch (e: any) { return { error: e?.message }; } });

  // Batch AI — Vendor Management
  ipcMain.handle('feat:vend-onboard:start', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ef().startVendorOnboarding({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vend-onboard:update', (_e, { id, items_completed }: any) => { try {  const _r = ef().updateOnboardingProgress(id, items_completed); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:w9:record', (_e, w: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ef().recordW9({ ...w, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:w9:missing', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ef().vendorsMissingW9(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vend-ins:record', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ef().recordVendorInsurance({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vend-ins:expiring', (_e, { days_ahead }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ef().expiringVendorInsurance(cid, days_ahead || 30); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vend:score', (_e, { vendor_id }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return ef().calcVendorScore(cid, vendor_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vend-disp:open', (_e, d: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ef().openVendorDispute({ ...d, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vend-disp:resolve', (_e, { id, resolution_amount, notes }: any) => { try { return { ok: ef().resolveVendorDispute(id, resolution_amount, notes) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vend-disp:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ef().listVendorDisputes(cid, opts); } catch (e: any) { return { error: e?.message }; } });

  // ═══════════════════════════════════════════════════════════════
  // EXPENSE ADVANCED WAVE: 100 features (F541-F640) — IPC handlers
  // ═══════════════════════════════════════════════════════════════
  const epc = () => require('../services/expense-policy-card-features');
  const ecm = () => require('../services/expense-custom-mobile-features');

  // Batch AJ — Policy Engine
  ipcMain.handle('feat:exp-policy:upsert', (_e, p: any) => { try { const cid = db.getCurrentCompanyId(); const _r = epc().upsertExpensePolicy({ ...p, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:exp-policy:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return epc().listExpensePolicies(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:exp-policy:evaluate', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); return epc().evaluatePolicies({ ...opts, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:exp-policy:ack-violation', (_e, { id, user_id }: any) => { try {  const _r = { ok: epc().acknowledgeViolation(id, user_id) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:exp-policy:violations', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return epc().listPolicyViolations(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:irs-rate:upsert', (_e, opts: any) => { try {  const _r = epc().upsertIRSRate(opts); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:irs-rate:current', (_e, { tax_year }: any = {}) => { try { return epc().getCurrentIRSRate(tax_year); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:travel-cap:upsert', (_e, c: any) => { try { const cid = db.getCurrentCompanyId(); const _r = epc().upsertTravelCap({ ...c, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:travel-cap:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return epc().listTravelCaps(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:exp-violations:by-employee', (_e, { employee_id, months_back }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return epc().violationsByEmployee(cid, employee_id, months_back); } catch (e: any) { return { error: e?.message }; } });

  // Batch AK — Templates & Auto-Fill
  ipcMain.handle('feat:exp-tpl:save', (_e, t: any) => { try { const cid = db.getCurrentCompanyId(); const _r = epc().saveExpenseTemplate({ ...t, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:exp-tpl:list', (_e, { user_id }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return epc().listExpenseTemplates(cid, user_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:exp-tpl:use', (_e, { id }: any) => { try { return epc().useTemplate(id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:exp-tpl:suggested', (_e, { user_id }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return epc().suggestedTemplates(cid, user_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:sub-detect:scan', (_e, { lookback_days }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = epc().detectSubscriptions(cid, lookback_days || 180); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:sub-detect:summary', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return epc().subscriptionAnnualSummary(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:sub-detect:confirm', (_e, { id, confirmed }: any) => { try { return { ok: epc().confirmSubscription(id, confirmed) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:sub-detect:cancel', (_e, { id }: any) => { try { return { ok: epc().cancelSubscription(id) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:auto-tag:upsert', (_e, r: any) => { try { const cid = db.getCurrentCompanyId(); const _r = epc().upsertAutoTagRule({ ...r, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:auto-tag:apply', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = epc().applyAutoTagRules({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:auto-tag:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return epc().listAutoTagRules(cid); } catch (e: any) { return { error: e?.message }; } });

  // Batch AL — Corporate Card Management
  ipcMain.handle('feat:corp-card:register', (_e, c: any) => { try { const cid = db.getCurrentCompanyId(); return epc().registerCorporateCard({ ...c, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:corp-card:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return epc().listCorporateCards(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:card-tx:match', (_e, { card_tx_id, expense_id }: any) => { try { return { ok: epc().matchCardTransaction(card_tx_id, expense_id) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:card-tx:import', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = epc().importCardTransactions({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:card-tx:spend-by-user', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return epc().cardSpendByUser(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:card-tx:unmatched', (_e, { limit }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return epc().unmatchedCardTransactions(cid, limit); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:card-tx:dispute', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); return epc().disputeCardTransaction({ ...opts, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:card-tx:spend-by-merchant', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return epc().cardSpendByMerchant(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:card-tx:reconcile', (_e, { card_id }: any) => { try { return epc().reconcileCard(card_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:card-rule:upsert', (_e, r: any) => { try { const cid = db.getCurrentCompanyId(); const _r = epc().upsertCardSpendRule({ ...r, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });

  // Batch AM — Travel
  ipcMain.handle('feat:trip:create', (_e, t: any) => { try { const cid = db.getCurrentCompanyId(); const _r = epc().createTrip({ ...t, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:trip:add-expense', (_e, { expense_id, trip_id }: any) => { try {  const _r = { ok: epc().addExpenseToTrip(expense_id, trip_id) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:trip:days', (_e, { trip_id }: any) => { try { return epc().tripDays(trip_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:trip:apply-perdiem', (_e, opts: any) => { try {  const _r = epc().applyTripPerDiem(opts); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:trip:add-itinerary', (_e, leg: any) => { try {  const _r = epc().addItineraryLeg(leg); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:trip:itinerary', (_e, { trip_id }: any) => { try { return epc().tripItinerary(trip_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:trip:preapprove', (_e, { trip_id, approved_by }: any) => { try { return { ok: epc().preApproveTrip(trip_id, approved_by) }; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:trip:cost-summary', (_e, { trip_id }: any) => { try { return epc().tripCostSummary(trip_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:trip:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return epc().listTrips(cid, opts); } catch (e: any) { return { error: e?.message }; } });

  // Batch AN — Mileage Advanced
  ipcMain.handle('feat:mileage-state:upsert', (_e, opts: any) => { try {  const _r = epc().upsertStateMileageRate(opts); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:mileage-route:create', (_e, r: any) => { try { const cid = db.getCurrentCompanyId(); const _r = epc().createMileageRoute({ ...r, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:mileage-route:add-stop', (_e, s: any) => { try {  const _r = epc().addRouteStop(s); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:mileage-route:stops', (_e, { route_id }: any) => { try { return epc().getRouteStops(route_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:mileage:split', (_e, opts: any) => { try { return epc().splitMileage(opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vehicle-dep:upsert', (_e, v: any) => { try { const cid = db.getCurrentCompanyId(); const _r = epc().upsertVehicleDepreciation({ ...v, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vehicle-maint:log', (_e, m: any) => { try { const cid = db.getCurrentCompanyId(); const _r = epc().logVehicleMaintenance({ ...m, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vehicle-maint:list', (_e, { vehicle_id }: any) => { try { return epc().listVehicleMaintenance(vehicle_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vehicle-maint:due', (_e, { days_ahead }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return epc().upcomingMaintenanceDue(cid, days_ahead || 60); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:vehicle:set-mileage-method', (_e, { vehicle_id, method }: any) => { try {  const _r = { ok: epc().setMileageMethod(vehicle_id, method) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });

  // Batch AO — Custom Fields & Tagging
  ipcMain.handle('feat:exp-cf:upsert', (_e, f: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ecm().upsertExpenseCustomField({ ...f, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:exp-cf:list', (_e, { category_id }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ecm().listExpenseCustomFields(cid, category_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:exp-cf:set-value', (_e, opts: any) => { try {  const _r = ecm().setExpenseCustomFieldValue(opts); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:exp-cf:get-values', (_e, { expense_id }: any) => { try { return ecm().getExpenseCustomFieldValues(expense_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:exp-formula:eval', (_e, { formula, vars }: any) => { try { return ecm().evaluateFormula(formula, vars || {}); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:tag-hier:upsert', (_e, t: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ecm().upsertTagHierarchy({ ...t, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:tag-hier:tree', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ecm().getTagTree(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:tags:suggest', (_e, { description }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ecm().suggestTagsForExpense(cid, description); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:exp:bulk-tag', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const r = ecm().bulkTagExpenses({ ...opts, company_id: cid }); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });

  // Batch AP — Spend Analytics Advanced
  ipcMain.handle('feat:spend:heatmap', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return ecm().spendHeatmap(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:spend:forecast-90d', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ecm().spendForecast90Days(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:spend:top-vendors', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ecm().topVendorsByPeriod(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:spend:top-categories', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ecm().topCategoriesByPeriod(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:spend:concentration', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return ecm().vendorConcentrationRisk(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:spend:employee-benchmarks', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return ecm().employeeSpendBenchmarks(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:spend:benchmark-vs-industry', (_e, { industry, total_revenue, ...opts }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ecm().benchmarkVsIndustry(cid, industry, total_revenue, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:cost-save:generate', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return ecm().generateCostSaveRecs(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:cost-save:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ecm().listCostSaveRecs(cid, opts); } catch (e: any) { return { error: e?.message }; } });

  // Batch AQ — Workflow Customization
  ipcMain.handle('feat:wf-def:upsert', (_e, w: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ecm().upsertApprovalWorkflow({ ...w, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:wf-def:match', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return ecm().matchWorkflowForExpense({ ...opts, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:wf-def:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ecm().listApprovalWorkflows(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:delegation:create', (_e, d: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ecm().createDelegation({ ...d, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:delegation:resolve', (_e, { user_id }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return ecm().resolveDelegate(cid, user_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:delegation:list', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ecm().listDelegations(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:wf:escalated', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ecm().findEscalatedWorkflows(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:wf:log', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ecm().logWorkflowEvent({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:wf:performance', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return ecm().workflowPerformance(cid, opts); } catch (e: any) { return { error: e?.message }; } });

  // Batch AR — Mobile & Capture
  ipcMain.handle('feat:exp-inbox:provision', (_e, { user_id }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = ecm().provisionExpenseInbox(cid, user_id); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:capture:queue', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ecm().queueReceiptCapture({ ...opts, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:capture:pending', (_e, { user_id }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; const _r = ecm().listPendingCaptures(cid, user_id); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:capture:process', (_e, { capture_id, created_expense_id }: any) => { try {  const _r = { ok: ecm().processCapture(capture_id, created_expense_id) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:voice-memo:attach', (_e, opts: any) => { try {  const _r = ecm().attachVoiceMemo(opts); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:voice-memo:list', (_e, { expense_id }: any) => { try { return ecm().listVoiceMemos(expense_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:exp:set-geo', (_e, { expense_id, lat, lng, location_name }: any) => { try {  const _r = { ok: ecm().setExpenseGeo(expense_id, lat, lng, location_name) }; scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:exp:by-location', (_e, opts: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ecm().expensesByLocation(cid, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:voice-entry:record', (_e, opts: any) => { try {  const _r = ecm().recordVoiceEntry(opts); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });

  // Batch AS — Reports & Year-End
  ipcMain.handle('feat:exp-rpt-tpl:save', (_e, t: any) => { try { const cid = db.getCurrentCompanyId(); const _r = ecm().saveReportTemplate({ ...t, company_id: cid }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:exp-rpt-tpl:list', () => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ecm().listReportTemplates(cid); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:year-end:rollup', (_e, { tax_year }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; const _r = ecm().generateYearEndRollup({ company_id: cid, tax_year }); scheduleAutoBackup(); return _r; } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:quarterly:report', (_e, { year, quarter }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return ecm().generateQuarterlyReport(cid, year, quarter); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:dept:report', (_e, { department_id, ...opts }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return ecm().departmentExpenseReport(cid, department_id, opts); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:proj-exp:report', (_e, { project_id }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return ecm().projectExpenseReport(cid, project_id); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:1099-prep:report', (_e, { tax_year }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ecm().vendor1099PrepReport(cid, tax_year); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:schedule-c:breakdown', (_e, { tax_year }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ecm().scheduleCBreakdown(cid, tax_year); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:mileage-log:summary', (_e, { tax_year }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return ecm().mileageLogSummary(cid, tax_year); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:perdiem:summary', (_e, { tax_year }: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return ecm().perDiemSummary(cid, tax_year); } catch (e: any) { return { error: e?.message }; } });
  ipcMain.handle('feat:custom-period:report', (_e, opts: any) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return null; return ecm().customPeriodReport({ ...opts, company_id: cid }); } catch (e: any) { return { error: e?.message }; } });

  registerPayrollWaveIpc(ipcMain);

  registerReportsIpc(ipcMain, deps);

  registerInvoicesIpc(ipcMain, deps);

  registerExpensesIpc(ipcMain, deps);

  registerLoansAdvancedIpc(ipcMain, deps);

  registerPrintPdfIpc(ipcMain, deps);









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
        scheduleAutoBackup();
        return { ok: true, id: payload.id };
      }
      const r = db.create('webhook_subscriptions', { ...payload, company_id: cid });
      scheduleAutoBackup();
      return { ok: true, id: r.id };
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  ipcMain.handle('webhooks:delete', (_event, { id }: { id: string }) => {
    try {
      db.removeHard('webhook_subscriptions', id);
      scheduleAutoBackup();
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


  // ─── Global Search ───────────────────────────────────
  ipcMain.handle('search:index', (_e, { query, limit }: { query: string; limit?: number }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId || !query) return [];
    try {
      const { search } = require('../services/intelligence/searchIndex');
      return search(db.getDb(), companyId, query, Math.min(limit || 20, 50));
    } catch (e) { console.warn('[search:index] failed', e); return []; }
  });

  ipcMain.handle('search:backfill', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { indexed: 0 };
    try {
      const { backfillCompany } = require('../services/intelligence/searchIndex');
      return { indexed: backfillCompany(db.getDb(), companyId) };
    } catch (e) { console.warn('[search:backfill] failed', e); return { indexed: 0, error: String(e) }; }
  });

  // Intelligence Core (B1) — role-checked mutation dispatch. Role enforced in main; never trust renderer.
  ipcMain.handle('action:invoke', (_e, { actionId, params }: { actionId: string; params?: any }) => {
    const companyId = db.getCurrentCompanyId();
    const userId = db.getCurrentUserId();
    if (!companyId || !userId) return { error: 'Not authenticated' };
    const { MUTATE_ACTIONS, ROLE_RANK } = require('../../shared/action-registry');
    const action = MUTATE_ACTIONS.find((a: any) => a.id === actionId);
    if (!action) return { error: 'Unknown or non-mutating action' };
    // Role check — never trust the renderer.
    const userRow: any = db.runQuery('SELECT role FROM users WHERE id = ?', [userId])[0];
    const role = (userRow?.role || 'viewer');
    if (action.requiredRole && (ROLE_RANK[role] ?? 0) < ROLE_RANK[action.requiredRole]) {
      return { error: `Requires ${action.requiredRole} role` };
    }
    try {
      let result: any;
      if (actionId === 'invoice.markPaid') {
        if (!params?.invoiceId) return { error: 'invoiceId required' };
        result = db.update('invoices', params.invoiceId, { status: 'paid' });
        db.logAudit(companyId, 'invoices', params.invoiceId, 'update', { status: { new: 'paid' } });
      } else if (actionId === 'client.createQuick') {
        if (!params?.name) return { error: 'name required' };
        result = db.create('clients', { company_id: companyId, name: params.name, email: params.email || '' });
        db.logAudit(companyId, 'clients', result.id, 'create');
      } else {
        return { error: 'No handler' };
      }
      scheduleReindex(actionId.startsWith('invoice') ? 'invoices' : 'clients',
        (params.invoiceId || result.id), 'upsert');
      scheduleAutoBackup();
      return { ok: true, result };
    } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  });

  ipcMain.handle('search:global', (_event, query) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId || !query || String(query).length > 200) return [];
    try {
      const { search } = require('../services/intelligence/searchIndex');
      return search(db.getDb(), companyId, String(query), 20).map((h: any) => ({
        type: h.entity_type, id: h.entity_id, title: h.title, subtitle: h.subtitle || '',
      }));
    } catch (e) { console.warn('[search:global] failed', e); return []; }
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

  // ─── Document Upload (copies file into app-managed storage) ──
  ipcMain.handle('documents:upload', async (_event, args: {
    companyId: string;
    entityType: string;
    entityId: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }) => {
    const { companyId, entityType, entityId, filters } = args;
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: filters || [{ name: 'All Files', extensions: ['*'] }],
    });
    if (result.canceled || !result.filePaths.length) return null;

    const sourcePath = result.filePaths[0];
    const filename = path.basename(sourcePath);
    const stored = copyIntoDocumentsStore(app.getPath('userData'), companyId, sourcePath);

    const doc = db.create('documents', {
      company_id: companyId,
      filename,
      file_path: stored.path,
      file_size: stored.size,
      mime_type: stored.mimeType,
      entity_type: entityType,
      entity_id: entityId,
      tags: '',
      uploaded_at: new Date().toISOString(),
    });
    scheduleAutoBackup();
    return doc;
  });

  // ─── Open a stored document in the OS default app ────────────
  ipcMain.handle('documents:open-path', async (_event, filePath: string) => {
    return openPathInOS(filePath);
  });


  function _buildExpenseMetadata(expense: any, company: any, vendor: any): import('../services/print-preview').PDFMetadata {
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

  // NOTE: invoice:preview-pdf removed — the renderer now uses print:preview
  // with client-generated HTML (see InvoiceDetail.handlePreview). That path
  // respects invoice_settings and payment_schedule; the old server template
  // did not.

  registerDebtCollectionIpc(ipcMain, deps);


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









  // ─── CSV Export ────────────────────────────────────────
  // ─── Auth ──────────────────────────────────────────────

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

    if (imported > 0) scheduleAutoBackup();
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
    // Back up on BOTH paths — the first save of any setting for a company hit
    // the INSERT branch, which previously skipped scheduleAutoBackup(), so a
    // brand-new API key / SMTP config could be lost on restore until the next
    // unrelated write happened to trigger a backup.
    scheduleAutoBackup();
  });

  // ─── Settings list (company-scoped) ──────────────────────
  // Bug fix: api.query('settings') returned all companies' settings.
  // This handler scopes to the current company.
  ipcMain.handle('settings:list', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return [];
    return db.queryAll('settings', { company_id: companyId });
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
    scheduleAutoBackup();
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
        AND due_date BETWEEN date('now') AND date('now', '+' || ? || ' days')
      GROUP BY due_date ORDER BY due_date
    `).all(companyId, d);
    const outflow = dbInstance.prepare(`
      SELECT SUM(total_amount) as amount, due_date
      FROM bills
      WHERE company_id = ? AND status NOT IN ('paid','void','draft')
        AND due_date BETWEEN date('now') AND date('now', '+' || ? || ' days')
      GROUP BY due_date ORDER BY due_date
    `).all(companyId, d);
    return { inflow, outflow };
  });

  ipcMain.handle('intelligence:entity-hint', (_e, { entityType, id }: { entityType: string; id: string }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId || !id) return '';
    try {
      if (entityType === 'client') {
        const row: any = db.runQuery(
          `SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS amt FROM invoices
           WHERE company_id = ? AND client_id = ? AND status NOT IN ('paid','cancelled','draft')
             AND COALESCE(due_date,'') <> '' AND date(due_date) < date('now')`,
          [companyId, id])[0];
        if (row?.n > 0) return `${row.n} overdue invoice${row.n > 1 ? 's' : ''} ($${Math.round(row.amt).toLocaleString()})`;
      } else if (entityType === 'vendor') {
        const row: any = db.runQuery(
          `SELECT COUNT(*) AS n FROM expenses WHERE company_id = ? AND vendor_id = ?
             AND instr(COALESCE(tags,''),'anomaly') > 0`,
          [companyId, id])[0];
        if (row?.n > 0) return `${row.n} flagged charge${row.n > 1 ? 's' : ''}`;
      }
      return '';
    } catch { return ''; }
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

  registerSyncBackupIpc(ipcMain, deps);









































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
      try { shell.openExternal(mailto).catch((err) => console.error('ipc/index:', err)); } catch {}
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
        scheduleAutoBackup();
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
      scheduleAutoBackup();
      return { success: true, id: existing.id };
    }
    const id = uuid();
    dbI.prepare(
      `INSERT INTO custom_shortcuts (id, user_id, key_combo, command_id, params_json) VALUES (?, ?, ?, ?, ?)`
    ).run(id, user_id || 'anon', key_combo, command_id, JSON.stringify(params || {}));
    scheduleAutoBackup();
    return { success: true, id };
  });

  ipcMain.handle('shortcut:delete', (_event, { id }: { id: string }) => {
    db.getDb().prepare(`DELETE FROM custom_shortcuts WHERE id = ?`).run(id);
    scheduleAutoBackup();
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





































}

