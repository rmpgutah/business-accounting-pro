import { ipcMain, dialog, shell, app } from 'electron';
import { v4 as uuid } from 'uuid';
import * as db from '../database';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { copyIntoDocumentsStore } from '../services/document-storage';
import { registerStripeIpc } from '../integrations/stripe';
import { registerEntityGraphIpc, recordRelationBidirectional } from '../integrations/entity-graph';
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
import { processRecurringTemplates, getLastProcessedAt, getRecurringHistory } from '../services/recurring-processor';
import { openPathInOS } from '../services/print-preview';
import { calculateFullPayroll } from '../services/TaxCalculationEngine';
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
    scheduleAutoBackup, findClosedPeriod, postJournalEntry, validateTable, cleanupReferencesBeforeDelete, scheduleReindex,
    localToday, ensureDefaultEmailTemplates, resolveTemplateTokens, buildTemplateContext, eu,
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

  // ─── Vendor delete (dedicated, reference-safe) ───────────────
  // The generic db:delete soft-deletes vendors but SKIPS reference
  // cleanup for soft-delete tables — so expenses/bills/POs keep
  // pointing at a now-hidden vendor, and bank_rules.action_vendor_id
  // (an enforced FK) blocks a hard delete entirely. This handler:
  //   1. Counts what references the vendor (so the UI can warn).
  //   2. Nulls EVERY reference (expenses, bills, purchase_orders,
  //      bank_rules.action_vendor_id) regardless of soft/hard.
  //   3. Soft-deletes (default → recoverable in Trash) or hard-deletes
  //      when {hard:true}.
  // Returns a clear { ok, unlinked } so the renderer can report it and
  // never masks a failure.
  ipcMain.handle('vendors:delete', (_event, { id, hard }: { id: string; hard?: boolean }) => {
    try {
      if (!id) return { error: 'No vendor id' };
      const dbi = db.getDb();
      const companyId = db.getCurrentCompanyId();
      const vendor = db.getById('vendors', id);
      if (!vendor) return { error: 'Vendor not found' };

      // Count references for the response (best-effort per table).
      const count = (sql: string): number => {
        try { return (dbi.prepare(sql).get(id) as any)?.c || 0; } catch { return 0; }
      };
      const unlinked = {
        expenses: count("SELECT COUNT(*) c FROM expenses WHERE vendor_id = ?"),
        bills: count("SELECT COUNT(*) c FROM bills WHERE vendor_id = ?"),
        purchase_orders: count("SELECT COUNT(*) c FROM purchase_orders WHERE vendor_id = ?"),
        bank_rules: count("SELECT COUNT(*) c FROM bank_rules WHERE action_vendor_id = ?"),
      };

      const tx = dbi.transaction(() => {
        const run = (sql: string) => { try { dbi.prepare(sql).run(id); } catch { /* table may not exist */ } };
        // Null all enforced + soft FK references so nothing dangles.
        run("DELETE FROM vendor_locations WHERE vendor_id = ?");
        run("UPDATE expenses SET vendor_id = NULL, vendor_location_id = NULL WHERE vendor_id = ?");
        run("UPDATE bills SET vendor_id = NULL WHERE vendor_id = ?");
        run("UPDATE purchase_orders SET vendor_id = NULL WHERE vendor_id = ?");
        run("UPDATE bank_rules SET action_vendor_id = NULL WHERE action_vendor_id = ?");

        if (hard) {
          dbi.prepare("DELETE FROM vendors WHERE id = ?").run(id);
        } else {
          // Soft delete → recoverable from Trash for 30 days.
          dbi.prepare("UPDATE vendors SET deleted_at = datetime('now') WHERE id = ?").run(id);
        }
      });
      tx();

      if (companyId) { try { db.logAudit(companyId, 'vendors', id, 'delete'); } catch { /* non-fatal */ } }
      try { scheduleAutoBackup(); } catch { /* non-fatal */ }

      return { ok: true, hard: !!hard, unlinked, vendor_name: vendor.name };
    } catch (err: any) {
      return { error: err?.message || 'Delete failed' };
    }
  });

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
  // Auto-dunning: run now / preview what would be actioned.
  ipcMain.handle('dunning:run', () => {
    try {
      const { runAutoDunning } = require('../services/auto-dunning');
      const r = runAutoDunning();
      scheduleAutoBackup();
      return r;
    } catch (err: any) {
      return { invoicesProcessed: 0, remindersQueued: 0, collectionsSuggested: 0, errors: [err?.message] };
    }
  });
  ipcMain.handle('dunning:preview', () => {
    try {
      const { getDunningPreview } = require('../services/auto-dunning');
      return getDunningPreview(db.getCurrentCompanyId());
    } catch (err: any) {
      return { error: err?.message };
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

  // ─── B7: Client risk scoring ─────────────────────────
  ipcMain.handle('clients:risk-score', (_event, opts?: { client_id?: string }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return [];
      const { scoreOneClient, scoreAllClients } = require('../services/client-risk-scorer');
      if (opts?.client_id) {
        const r = scoreOneClient(cid, opts.client_id);
        return r ? [r] : [];
      }
      return scoreAllClients(cid);
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  // ─── B13: Tax deduction finder ─────────────────────────
  ipcMain.handle('tax:deduction-scan', (_event, opts?: { year?: number }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return null;
      const { scanDeductions } = require('../services/tax-deduction-finder');
      return scanDeductions(cid, opts?.year);
    } catch (err: any) {
      return { error: err?.message };
    }
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
          { name: 'Receipts', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff'] },
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

    // D3: refuse to record a payment whose date falls in a closed period
    {
      const period = findClosedPeriod(companyId, date);
      if (period) {
        return { error: 'Cannot record payment: ' + date + ' falls in a closed accounting period (' +
          period.period_start + ' to ' + period.period_end + '). Reopen the period in Settings.' };
      }
    }

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
      // Carry the PO's tax_amount onto the bill — omitting it left the bill's
      // subtotal+tax out of sync with its (tax-inclusive) total and undercounted
      // any tax reporting that reads bills.tax_amount.
      dbInstance.prepare(`
        INSERT INTO bills (id, company_id, vendor_id, bill_number, status, issue_date, due_date, subtotal, tax_amount, total, notes, reference)
        VALUES (?, ?, ?, ?, 'received', date('now'), date('now', '+30 days'), ?, ?, ?, ?, ?)
      `).run(billId, companyId, po.vendor_id, billNumber, po.subtotal || 0, po.tax_amount || 0, po.total || 0, po.notes || '', `PO: ${po.po_number}`);

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
    scheduleAutoBackup();
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

    // The UI sends `married_filing_jointly`/`married_filing_separately`, but
    // federal_tax_brackets is keyed by the DB spelling (`married_jointly`/
    // `married_separately`). Without this translation the bracket query below
    // matched 0 rows for married filers → federal withholding silently 0.
    const dbFilingStatus = ({
      married_filing_jointly: 'married_jointly',
      married_filing_separately: 'married_separately',
    } as Record<string, string>)[filingStatus] ?? filingStatus;

    const brackets = dbInstance.prepare('SELECT * FROM federal_tax_brackets WHERE tax_year = ? AND filing_status = ? ORDER BY bracket_min').all(year, dbFilingStatus) as any[];

    // Annualize
    const annualized = grossPay * 26; // biweekly assumption
    const stdDed = dbFilingStatus === 'married_jointly' ? constants.standard_deduction_married : dbFilingStatus === 'head_of_household' ? constants.standard_deduction_hoh : constants.standard_deduction_single;
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

  // FIX #10/#11: Single source of truth for federal payroll constants.
  // Returns SS wage base, FICA rates, FUTA rate/wage base, and standard
  // deductions for a given tax year. Both frontend (PayrollRunner) and
  // backend (TaxCalculationEngine) call this instead of using hardcoded
  // values that drift between files and across years.
  ipcMain.handle('tax:get-payroll-constants', (_event, { year }: { year: number }) => {
    try {
      const dbInstance = db.getDb();
      const constants = dbInstance.prepare('SELECT * FROM federal_payroll_constants WHERE tax_year = ?').get(year) as any;
      if (!constants) {
        // Attempt to auto-seed if missing
        const { seedTaxYear } = require('../services/tax-forms/seed-tax-year');
        try { seedTaxYear(year); } catch { /* ignore */ }
        const retry = dbInstance.prepare('SELECT * FROM federal_payroll_constants WHERE tax_year = ?').get(year) as any;
        if (!retry) return { error: `No constants available for tax year ${year}` };
        return retry;
      }
      return constants;
    } catch (err: any) {
      return { error: err?.message || 'Failed to fetch payroll constants' };
    }
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





  ipcMain.handle('approval:list', (_event, { company_id, status }: { company_id: string; status?: string }) => {
    let sql = `SELECT aq.*, r.category FROM approval_queue aq LEFT JOIN rules r ON aq.rule_id = r.id WHERE aq.company_id = ?`;
    const params: unknown[] = [company_id];
    if (status) { sql += ` AND aq.status = ?`; params.push(status); }
    sql += ` ORDER BY aq.created_at DESC`;
    return db.getDb().prepare(sql).all(...params);
  });

  ipcMain.handle('approval:resolve', (_event, { id, status, notes }: { id: string; status: 'approved' | 'rejected'; notes?: string }) => {
    try {
      db.getDb().prepare(`UPDATE approval_queue SET status = ?, notes = ?, resolved_at = datetime('now') WHERE id = ?`).run(status, notes ?? null, id);
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message || 'Failed to resolve approval' };
    }
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

  registerSyncBackupIpc(ipcMain, deps);

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
    scheduleAutoBackup();
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
    const cid = db.getCurrentCompanyId();
    if (!cid) return { total_invoiced: 0, total_paid: 0, outstanding: 0, avg_payment_days: 0, status_breakdown: [], payment_history: [], active_projects: 0, lifetime_value: 0 };

    const invoiced = dbI.prepare('SELECT COALESCE(SUM(total), 0) as total FROM invoices WHERE client_id = ? AND company_id = ?').get(clientId, cid) as any;
    const paid = dbI.prepare('SELECT COALESCE(SUM(amount_paid), 0) as total FROM invoices WHERE client_id = ? AND company_id = ?').get(clientId, cid) as any;
    const outstanding = dbI.prepare("SELECT COALESCE(SUM(total - amount_paid), 0) as total FROM invoices WHERE client_id = ? AND company_id = ? AND status NOT IN ('paid','void','cancelled')").get(clientId, cid) as any;
    const avgDays = dbI.prepare("SELECT AVG(julianday(updated_at) - julianday(issue_date)) as avg_days FROM invoices WHERE client_id = ? AND company_id = ? AND status = 'paid'").get(clientId, cid) as any;
    const statusBreakdown = dbI.prepare('SELECT status, COUNT(*) as count FROM invoices WHERE client_id = ? AND company_id = ? GROUP BY status').all(clientId, cid);
    const paymentHistory = dbI.prepare(`
      SELECT strftime('%Y-%m', updated_at) as month, SUM(amount_paid) as total
      FROM invoices WHERE client_id = ? AND company_id = ? AND status = 'paid'
      GROUP BY month ORDER BY month DESC LIMIT 12
    `).all(clientId, cid);
    const projects = dbI.prepare("SELECT COUNT(*) as count FROM projects WHERE client_id = ? AND company_id = ? AND status != 'completed'").get(clientId, cid) as any;
    const lifetime = dbI.prepare('SELECT COALESCE(SUM(amount_paid), 0) as total FROM invoices WHERE client_id = ? AND company_id = ?').get(clientId, cid) as any;

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














  // ─── Employee Document Generation ─────────────────────────
  // Shared, formal signature block for both agreements. Renders an
  // in-place cursive signature + date for each party that has signed
  // (employee and/or employer), or a blank ruled line for wet-ink
  // signing when unsigned. Replaces the old approach of dangling an
  // "ELECTRONIC SIGNATURE" block at the very bottom of the document.
  type SigData = { employee?: { name: string; date: string }; employer?: { name: string; date: string }; employerTitle?: string };
  function agreementSignatureBlock(empName: string, companyName: string, signatures?: SigData): string {
    const esc = (s: any) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    const fmt = (d: any) => d ? new Date(String(d).length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
    // The employer signer's role/title — defaults to "HR Manager" (the
    // person who signs employment & equipment agreements on the company's
    // behalf). Overridable via signatures.employerTitle.
    const employerTitle = (signatures as any)?.employerTitle || 'HR Manager';
    const field = (label: 'Employee' | 'Employer', party: string, sig?: { name: string; date: string }) => {
      const signed = !!(sig && sig.name);
      const roleLine = label === 'Employer'
        ? `<p style="font-size:9pt;color:#374151;font-weight:600;margin-top:1px;">${esc(employerTitle)}</p>`
        : '';
      return `<div class="signature-field"${label === 'Employer' ? ' style="margin-left:40px;"' : ''}>
        ${signed
          ? `<div style="font-family:'Snell Roundhand','Apple Chancery','Brush Script MT',cursive;font-size:26px;color:#111;border-bottom:1px solid #374151;padding-bottom:6px;min-height:38px;line-height:1.1;">${esc(sig.name)}</div>`
          : `<div class="signature-line">${label} Signature</div>`}
        <p style="margin-top:6px;font-size:10pt;color:#374151;font-weight:700;">${esc(party)}</p>
        ${roleLine}
        <p style="font-size:9pt;color:#6b7280;">${label} Signature</p>
        <p style="font-size:10pt;color:#374151;margin-top:2px;">Date: ${signed ? `<strong>${fmt(sig.date)}</strong>` : '_______________'}</p>
        ${signed ? `<p style="font-size:8pt;color:#9ca3af;margin-top:3px;">Electronically signed &amp; recorded &middot; cryptographically bound (SHA-256)</p>` : ''}
      </div>`;
    };
    return `<div class="signature-section">
    <h2>Signatures</h2>
    <p>By signing below, the parties acknowledge and agree to the terms of this Agreement.</p>
    <div class="signature-row">
      ${field('Employee', empName, signatures?.employee)}
      ${field('Employer', companyName, signatures?.employer)}
    </div>
  </div>`;
  }


  // ─── Onboarding / Offboarding Checklist ─────────────────
  // Returns a hybrid checklist: auto-detected steps (computed from real
  // data — equipment, agreements, banking, credentials) + manual
  // check-offs (stored in employee_checklist_items). Auto steps are
  // read-only and always reflect current system state.
  ipcMain.handle('employee:checklist', (_event, { employeeId, phase }: { employeeId: string; phase: 'onboarding' | 'offboarding' }) => {
    try {
      const dbi = db.getDb();
      const companyId = db.getCurrentCompanyId();
      if (!companyId || !employeeId) return { steps: [] };
      const emp = dbi.prepare('SELECT * FROM employees WHERE id = ? AND company_id = ?').get(employeeId, companyId) as any;
      if (!emp) return { steps: [] };

      // Manual check-offs for this employee + phase.
      const manualRows = dbi.prepare(
        'SELECT step_key, is_complete, completed_at FROM employee_checklist_items WHERE employee_id = ? AND phase = ?'
      ).all(employeeId, phase) as any[];
      const manualMap = new Map(manualRows.map(r => [r.step_key, r]));
      const isManualDone = (key: string) => !!(manualMap.get(key)?.is_complete);

      // Auto-detected data counts.
      const equipCount = (dbi.prepare('SELECT COUNT(*) c FROM employee_equipment WHERE employee_id = ?').get(employeeId) as any)?.c || 0;
      const credCount = (dbi.prepare('SELECT COUNT(*) c FROM employee_credentials WHERE employee_id = ?').get(employeeId) as any)?.c || 0;
      const hasBanking = !!(emp.bank_name || emp.bank_routing || emp.bank_account);
      const hasW4 = !!(emp.w4_filing_status);
      const hasEmergency = !!(emp.emergency_contact_name);

      // E-sign status for both agreement types.
      let empAgreementSigned = false, equipAgreementSigned = false;
      try {
        const docs = dbi.prepare("SELECT description, status FROM esign_documents WHERE company_id = ? AND status = 'signed'").all(companyId) as any[];
        empAgreementSigned = docs.some((d: any) => d.description === `emp:${employeeId}:employee`);
        equipAgreementSigned = docs.some((d: any) => d.description === `emp:${employeeId}:equipment`);
      } catch { /* esign tables may not exist */ }

      // Equipment return status for offboarding.
      let allReturned = true;
      if (phase === 'offboarding' && equipCount > 0) {
        const inUse = (dbi.prepare("SELECT COUNT(*) c FROM employee_equipment WHERE employee_id = ? AND (disposition IS NULL OR disposition = 'in_use')").get(employeeId) as any)?.c || 0;
        allReturned = inUse === 0;
      }

      type Step = { key: string; label: string; description: string; auto: boolean; done: boolean; category: string };
      const steps: Step[] = [];

      if (phase === 'onboarding') {
        steps.push(
          { key: 'profile', label: 'Employee Profile', description: 'Name, contact info, address, job title', auto: true, done: !!(emp.name && emp.email), category: 'Setup' },
          { key: 'banking', label: 'Direct Deposit / Banking', description: 'Bank routing + account for payroll', auto: true, done: hasBanking, category: 'Setup' },
          { key: 'w4', label: 'W-4 Tax Withholding', description: 'Federal W-4 filing status and allowances', auto: true, done: hasW4, category: 'Setup' },
          { key: 'emergency', label: 'Emergency Contact', description: 'Emergency contact name and phone', auto: true, done: hasEmergency, category: 'Setup' },
          { key: 'equipment', label: 'Issue Equipment', description: 'Laptops, phones, keys, badges', auto: true, done: equipCount > 0, category: 'Provisioning' },
          { key: 'credentials', label: 'Credentials & Licenses', description: 'Record any required licenses or certifications', auto: true, done: credCount > 0, category: 'Provisioning' },
          { key: 'emp_agreement', label: 'Employee Agreement (E-Sign)', description: 'Employment contract with terms and compensation', auto: true, done: empAgreementSigned, category: 'Agreements' },
          { key: 'equip_agreement', label: 'Equipment Agreement (E-Sign)', description: 'Equipment responsibility and penalty terms', auto: true, done: equipAgreementSigned, category: 'Agreements' },
          // Manual steps — no data home, admin checks off when done.
          { key: 'orientation', label: 'Orientation / Training', description: 'Company orientation session completed', auto: false, done: isManualDone('orientation'), category: 'Training' },
          { key: 'building_access', label: 'Building / Facility Access', description: 'Keys, badge, alarm codes issued', auto: false, done: isManualDone('building_access'), category: 'Provisioning' },
          { key: 'it_accounts', label: 'IT Accounts Setup', description: 'Email, Slack, software logins provisioned', auto: false, done: isManualDone('it_accounts'), category: 'Provisioning' },
          { key: 'handbook_ack', label: 'Employee Handbook Acknowledgment', description: 'Employee confirmed receipt of handbook', auto: false, done: isManualDone('handbook_ack'), category: 'Agreements' },
          { key: 'intro_team', label: 'Team Introduction', description: 'Introduced to team and supervisor', auto: false, done: isManualDone('intro_team'), category: 'Training' },
        );
      } else {
        // Offboarding
        steps.push(
          { key: 'equipment_return', label: 'All Equipment Returned', description: 'Laptops, phones, keys, badges returned or accounted for', auto: true, done: allReturned, category: 'Return' },
          { key: 'penalties_settled', label: 'Equipment Penalties Settled', description: 'Outstanding penalties paid or waived', auto: true, done: (() => { try { return (dbi.prepare("SELECT COUNT(*) c FROM employee_equipment WHERE employee_id = ? AND penalty_assessed > 0.005 AND COALESCE(penalty_waived,0) = 0").get(employeeId) as any)?.c === 0; } catch { return true; } })(), category: 'Return' },
          { key: 'final_paycheck', label: 'Final Paycheck Processed', description: 'Last payroll run including accrued PTO', auto: false, done: isManualDone('final_paycheck'), category: 'Payroll' },
          { key: 'benefits_termed', label: 'Benefits Terminated', description: 'Health, dental, vision, 401k terminated or COBRA offered', auto: false, done: isManualDone('benefits_termed'), category: 'Payroll' },
          { key: 'it_deprovisioned', label: 'IT Accounts Deprovisioned', description: 'Email, Slack, software access revoked', auto: false, done: isManualDone('it_deprovisioned'), category: 'Access' },
          { key: 'building_revoked', label: 'Building Access Revoked', description: 'Keys, badge, alarm codes collected / deactivated', auto: false, done: isManualDone('building_revoked'), category: 'Access' },
          { key: 'exit_interview', label: 'Exit Interview', description: 'Conducted and documented', auto: false, done: isManualDone('exit_interview'), category: 'Admin' },
          { key: 'cobra_notice', label: 'COBRA Notice Sent', description: 'COBRA continuation notice mailed within 14 days', auto: false, done: isManualDone('cobra_notice'), category: 'Admin' },
        );
      }

      const done = steps.filter(s => s.done).length;
      return { steps, done, total: steps.length, phase, employee_name: emp.name };
    } catch (err: any) {
      return { error: err?.message || 'Checklist failed' };
    }
  });

  // Toggle a manual checklist step.
  ipcMain.handle('employee:checklist-toggle', (_event, { employeeId, phase, stepKey, done }: { employeeId: string; phase: string; stepKey: string; done: boolean }) => {
    try {
      const dbi = db.getDb();
      const existing = dbi.prepare(
        'SELECT id FROM employee_checklist_items WHERE employee_id = ? AND phase = ? AND step_key = ?'
      ).get(employeeId, phase, stepKey) as any;
      if (existing) {
        dbi.prepare('UPDATE employee_checklist_items SET is_complete = ?, completed_at = ? WHERE id = ?')
          .run(done ? 1 : 0, done ? new Date().toISOString() : null, existing.id);
      } else {
        db.create('employee_checklist_items', {
          employee_id: employeeId, phase, step_key: stepKey,
          is_complete: done ? 1 : 0, completed_at: done ? new Date().toISOString() : null,
        });
      }
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });

  ipcMain.handle('employee:generate-equipment-agreement', (_event, { employeeId, signatures }: { employeeId: string; signatures?: SigData }) => {
    try {
      const dbInstance = db.getDb();
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return { html: '' };

      const employee = dbInstance.prepare('SELECT * FROM employees WHERE id = ? AND company_id = ?').get(employeeId, companyId) as any;
      if (!employee) return { html: '' };

      const company = dbInstance.prepare('SELECT * FROM companies WHERE id = ?').get(companyId) as any;
      // ALL equipment ever issued to this employee — current, returned,
      // lost, etc. (the prior `return_date IS NULL` filter hid returned
      // items from the agreement). Future items are included automatically
      // since there's no limit. A Status column distinguishes them.
      const equipment = dbInstance.prepare('SELECT * FROM employee_equipment WHERE employee_id = ? ORDER BY assigned_date, item_name').all(employeeId) as any[];

      const esc = (s: any) => {
        if (s == null) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
      };
      const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
      const fmtCurrency = (n: any) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0);

      const companyName = esc(company?.name || '');
      const companyAddr = company ? [company.address_line1, company.address_line2, `${company.city || ''} ${company.state || ''} ${company.zip || ''}`].filter(Boolean).join(', ') : '';

      const empName = esc(employee.name || '');
      const empTitle = esc(employee.job_title || '');
      const empAddr = [employee.address_line1, employee.address_line2, `${employee.city || ''} ${employee.state || ''} ${employee.zip || ''}`].filter(Boolean).join(', ');
      const empStart = fmtDate(employee.start_date);
      const today = fmtDate(new Date().toISOString());

      // Equipment table rows + per-item penalty terms.
      let equipmentRows = '';
      let penaltySection = '';
      let totalValue = 0;
      const statusMap: Record<string, string> = {
        in_use: 'In Use', returned_good: 'Returned', returned_damaged: 'Returned (Damaged)',
        lost: 'Lost', stolen: 'Stolen', not_returned: 'Not Returned', retired: 'Retired',
      };
      const statusSeverity: Record<string, 'high' | 'medium' | 'none'> = {
        in_use: 'none', returned_good: 'none', retired: 'none',
        returned_damaged: 'medium', lost: 'medium',
        stolen: 'high', not_returned: 'high',
      };
      const dispositionInfo = (item: any): { label: string; date: string; severity: 'high' | 'medium' | 'none' } => {
        const d = item.disposition || (item.return_date ? 'returned_good' : 'in_use');
        const label = statusMap[d] || 'In Use';
        const severity = statusSeverity[d] || 'none';
        const dateVal = item.return_date || item.disposition_date;
        const date = (dateVal && d !== 'in_use') ? fmtDate(dateVal) : '—';
        return { label, date, severity };
      };
      if (equipment.length === 0) {
        equipmentRows = '<tr><td colspan="9" style="text-align:center;padding:16px;color:#6b7280;">No equipment assigned.</td></tr>';
      } else {
        const penaltyTypeLabel = (t: string, amt: number) => {
          const a = Number(amt) || 0;
          if (t === 'per_day') return `${fmtCurrency(a)} per day`;
          if (t === 'percent_of_value') return `${a}% of item value`;
          return fmtCurrency(a);
        };
        const penaltyBlocks: string[] = [];
        equipment.forEach((item: any, i: number) => {
          const val = Number(item.value) || 0;
          totalValue += val;
          const disp = dispositionInfo(item);
          const statusBg = disp.severity === 'high' ? '#fef2f2' : disp.severity === 'medium' ? '#fffbeb' : 'transparent';
          const statusColor = disp.severity === 'high' ? '#dc2626' : disp.severity === 'medium' ? '#d97706' : '#374151';
          equipmentRows += `<tr>
            <td style="padding:8px;border:1px solid #d1d5db;">${i + 1}</td>
            <td style="padding:8px;border:1px solid #d1d5db;">${esc(item.item_name)}</td>
            <td style="padding:8px;border:1px solid #d1d5db;word-break:break-all;">${esc(item.serial_number || '—')}</td>
            <td style="padding:8px;border:1px solid #d1d5db;">${esc(item.model || '—')}</td>
            <td style="padding:8px;border:1px solid #d1d5db;text-transform:capitalize;">${esc(item.condition || 'good')}</td>
            <td style="padding:8px;border:1px solid #d1d5db;text-align:right;">${val > 0 ? fmtCurrency(val) : '—'}</td>
            <td style="padding:8px;border:1px solid #d1d5db;">${fmtDate(item.assigned_date)}</td>
            <td style="padding:8px;border:1px solid #d1d5db;background:${statusBg};color:${statusColor};font-weight:${disp.severity === 'none' ? '400' : '700'};">${esc(disp.label)}</td>
            <td style="padding:8px;border:1px solid #d1d5db;">${disp.date}</td>
          </tr>`;

          // Penalties defined for this item.
          const pens = dbInstance.prepare(
            'SELECT label, penalty_type, amount, notes FROM equipment_penalties WHERE equipment_id = ? ORDER BY sort_order'
          ).all(item.id) as any[];
          if (pens.length > 0) {
            const rows = pens.map((p: any) =>
              `<tr><td style="padding:5px 8px;border:1px solid #d1d5db;">${esc(p.label)}</td>
                   <td style="padding:5px 8px;border:1px solid #d1d5db;text-align:right;font-weight:600;">${penaltyTypeLabel(p.penalty_type, p.amount)}</td>
                   <td style="padding:5px 8px;border:1px solid #d1d5db;color:#6b7280;">${esc(p.notes || '')}</td></tr>`
            ).join('');
            penaltyBlocks.push(
              `<p style="margin-top:14px;font-weight:700;font-size:11pt;">${esc(item.item_name)}${item.serial_number ? ` (SN: ${esc(item.serial_number)})` : ''}</p>
               <table style="width:100%;border-collapse:collapse;margin-top:4px;font-size:10pt;">
                 <thead><tr style="background:#f3f4f6;">
                   <th style="padding:5px 8px;border:1px solid #d1d5db;text-align:left;">Penalty</th>
                   <th style="padding:5px 8px;border:1px solid #d1d5db;text-align:right;">Amount</th>
                   <th style="padding:5px 8px;border:1px solid #d1d5db;text-align:left;">Notes</th>
                 </tr></thead><tbody>${rows}</tbody>
               </table>`
            );
          }
        });
        if (penaltyBlocks.length > 0) {
          penaltySection = `
            <h2 style="font-size:13pt;margin-top:24px;margin-bottom:6px;color:#374151;border-bottom:1px solid #e5e7eb;padding-bottom:4px;">Penalty &amp; Liability Terms</h2>
            <p style="font-size:10pt;color:#374151;margin-bottom:6px;">The Employee acknowledges responsibility for the following penalties in the event of loss, damage, late return, or non-return of the equipment listed above. Percent-of-value penalties are computed against each item's stated replacement value.</p>
            ${penaltyBlocks.join('')}`;
        }
      }

      const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Employer Provided Equipment Agreement - ${empName}</title>
<style>
  @page { margin: 0.85in 0.9in; size: Letter; }
  body { font-family: 'Times New Roman', Times, serif; font-size: 11pt; line-height: 1.6; color: #1a1a1a; margin: 0; padding: 0; }
  /* Fills whatever printable width Chromium actually lays out (set via the
     printToPDF margins in EmployeeForm.tsx, since @page is cosmetic-only
     here) — a fixed px max-width previously left the table pressed against
     the right edge on Letter paper instead of centered with even margins. */
  .container { width: 100%; margin: 0 auto; }
  /* ── Formal letterhead ── */
  .letterhead { text-align: center; padding-bottom: 14px; margin-bottom: 20px; border-bottom: 0.5px solid #ccc; }
  .letterhead .co-name { font-size: 18pt; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #111; margin: 0; padding-bottom: 6px; border-bottom: 1.5px solid #111; display: inline-block; }
  .letterhead .co-addr { font-size: 9pt; color: #555; margin-top: 6px; letter-spacing: 0.3px; }
  /* ── Caption block ── */
  .caption-block { margin-top: 24px; padding: 12px 0; text-align: center; border-top: 1px solid #1a1a1a; border-bottom: 1px solid #1a1a1a; }
  .caption-title { font-size: 12pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin: 0; }
  .caption-parties { font-size: 10pt; color: #444; margin-top: 4px; }
  .caption-date { font-size: 9.5pt; color: #666; margin-top: 2px; }
  /* ── Section headings ── */
  h2 { font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; font-size: 12pt; margin-top: 18px; margin-bottom: 8px; color: #222; border-bottom: 1px solid #ccc; padding-bottom: 4px; text-transform: uppercase; letter-spacing: 0.8px; }
  /* ── Body + terms ── */
  .letter-body { margin-top: 12px; font-size: 10.5pt; }
  .letter-body p { margin: 8px 0; text-align: justify; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 10pt; font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; }
  .equip-table { table-layout: fixed; }
  .equip-table col.c-num { width: 4%; }
  .equip-table col.c-item { width: 16%; }
  .equip-table col.c-serial { width: 13%; }
  .equip-table col.c-model { width: 10%; }
  .equip-table col.c-cond { width: 10%; }
  .equip-table col.c-value { width: 10%; }
  .equip-table col.c-date { width: 12%; }
  .equip-table col.c-status { width: 15%; }
  .equip-table col.c-statusdate { width: 10%; }
  th { background: #f3f4f6; padding: 8px; border: 1px solid #d1d5db; text-align: left; font-weight: 600; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.5px; }
  td { padding: 8px; border: 1px solid #d1d5db; }
  .terms { margin: 16px 0; }
  .terms p { margin: 8px 0; text-align: justify; font-size: 10.5pt; padding-left: 28px; text-indent: -28px; }
  /* ── Signatures ── */
  .signature-section { margin-top: 36px; page-break-inside: avoid; }
  .signature-row { display: flex; justify-content: space-between; margin-top: 24px; }
  .signature-field { flex: 1; }
  .signature-line { border-top: 1px solid #374151; margin-top: 36px; padding-top: 4px; font-size: 10pt; }
  /* ── Footer ── */
  .footer { margin-top: 36px; text-align: center; font-size: 8.5pt; color: #999; font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; border-top: 0.5px solid #ccc; padding-top: 8px; }
  /* ── Penalty table ── */
  .penalty-table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 9.5pt; table-layout: fixed; font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; }
  .penalty-table th { background: #1f2937; color: #fff; padding: 7px 8px; border: 1px solid #374151; text-align: left; font-weight: 600; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.5px; }
  .penalty-table td { padding: 7px 8px; border: 1px solid #d1d5db; vertical-align: top; font-size: 8.5pt; line-height: 1.35; word-wrap: break-word; overflow-wrap: anywhere; }
  .penalty-table tr { page-break-inside: avoid; }
  .penalty-high { background: #fef2f2; }
  .penalty-medium { background: #fffbeb; }
  @media print { body { padding: 0; } }
</style></head>
<body>
<div class="container">
  <!-- Formal letterhead -->
  <div class="letterhead">
    <p class="co-name">${companyName}</p>
    ${companyAddr ? `<p class="co-addr">${esc(companyAddr)}</p>` : ''}
  </div>

  <!-- Caption block -->
  <div class="caption-block">
    <p class="caption-title">Employer Provided Equipment Agreement</p>
    <p class="caption-parties">Between ${companyName} and ${empName}</p>
    <p class="caption-date">Effective ${signatures?.employee?.date
      ? fmtDate(String(signatures.employee.date).length === 10 ? signatures.employee.date + 'T12:00:00' : signatures.employee.date)
      : (empStart || today)}</p>
  </div>

  <!-- Body opening: contract recital -->
  <div class="letter-body">
    <p>This Agreement is made and entered into as of ${empStart || today}, by and between ${companyName} ("Employer") and ${empName}${empTitle ? `, ${empTitle}` : ''}${empAddr ? `, of ${esc(empAddr)}` : ''} ("Employee"), regarding the issuance, use, care, and return of company-owned equipment (this "Agreement"). The parties agree as follows:</p>
  </div>

  <h2>Equipment Issued</h2>
  <p>The Employer has issued the following equipment to the Employee for business use. The Employee acknowledges receipt of the items listed below and agrees to the terms set forth in this Agreement.</p>
  <table class="equip-table">
    <colgroup>
      <col class="c-num" /><col class="c-item" /><col class="c-serial" /><col class="c-model" />
      <col class="c-cond" /><col class="c-value" /><col class="c-date" /><col class="c-status" /><col class="c-statusdate" />
    </colgroup>
    <thead>
      <tr>
        <th>#</th>
        <th>Item</th>
        <th>Serial #</th>
        <th>Model</th>
        <th>Condition</th>
        <th style="text-align:right;">Value</th>
        <th>Date Issued</th>
        <th>Status</th>
        <th>Status Date</th>
      </tr>
    </thead>
    <tbody>
      ${equipmentRows}
      ${totalValue > 0 ? `<tr><td colspan="5" style="padding:8px;border:1px solid #d1d5db;text-align:right;font-weight:700;">Total Equipment Value</td><td style="padding:8px;border:1px solid #d1d5db;text-align:right;font-weight:700;">${fmtCurrency(totalValue)}</td><td colspan="3" style="border:1px solid #d1d5db;"></td></tr>` : ''}
    </tbody>
  </table>

  ${penaltySection}

  <h2>Terms &amp; Conditions</h2>
  <p style="font-size:10pt;color:#6b7280;margin-bottom:12px;">The Employee acknowledges and expressly agrees to the following terms and conditions governing the use of Employer-issued equipment. Any violation of these terms may result in disciplinary action, up to and including termination of employment and legal action.</p>
  <div class="terms">
    <p><strong>1. Ownership &amp; Property Rights.</strong> All equipment provided under this Agreement, including but not limited to computers, monitors, peripherals, telephones, mobile devices, software licenses, and accessories (collectively, "Equipment"), remains the sole and exclusive property of the Employer. The Employee acquires no ownership interest, equitable title, or leasehold rights in any Equipment. The Employee shall not sell, transfer, pledge, encumber, dispose of, or otherwise grant any interest in the Equipment to any third party. The Employee shall not remove or deface any identification labels, asset tags, or property markings affixed to any Equipment.</p>

    <p><strong>2. Care, Maintenance &amp; Prohibited Modifications.</strong> The Employee shall exercise the highest degree of care in the handling, operation, and storage of all Equipment. The Employee shall (a) maintain the Equipment in good working order and promptly report any malfunction, defect, or degradation in performance; (b) keep the Equipment in a clean, safe, and secure environment when not in use; (c) protect the Equipment from extreme temperatures, moisture, dust, physical shock, and electrical surges; (d) use only manufacturer-approved chargers, cables, and accessories. The Employee is strictly prohibited from: (i) repairing, disassembling, modifying, or attempting to service any Equipment; (ii) installing, removing, or replacing any hardware components, including memory, storage drives, batteries, or network cards; (iii) altering the operating system, firmware, BIOS/UEFI settings, or security configurations; (iv) jailbreaking, rooting, or otherwise circumventing built-in security protections; (v) relabeling or cosmetically altering the Equipment in any manner. All repairs and maintenance must be performed exclusively by the Employer's authorized IT personnel or designated service providers.</p>

    <p><strong>3. Authorized Use &amp; Restrictions.</strong> Equipment shall be used exclusively for legitimate business purposes on behalf of the Employer. Limited personal use is permitted only if it (a) does not interfere with the Employee's job duties or productivity; (b) does not violate any applicable law, regulation, or Employer policy; (c) does not involve the storage, transmission, or access of illegal, obscene, harassing, discriminatory, or otherwise inappropriate material; (d) does not result in additional costs to the Employer, including but not limited to data overage charges, licensing fees, or repair expenses; (e) does not compromise the security, integrity, or confidentiality of Employer data or systems; and (f) does not diminish the useful life or residual value of the Equipment. The Employee shall not use the Equipment for any competitive activity, side business, freelance work, or any purpose that conflicts with the Employer's interests. Software installation is strictly prohibited without prior written authorization from the Employer's IT department. The Employee shall not access, download, or stream content that consumes excessive bandwidth or violates copyright laws.</p>

    <p><strong>4. Return Obligations &amp; Timeline.</strong> Upon termination of employment for any reason, whether voluntary or involuntary, with or without cause, or immediately upon demand by the Employer, the Employee shall return ALL Equipment within twenty-four (24) hours. The return shall include: (a) the Equipment itself and all component parts; (b) all power adapters, cables, docking stations, cases, and peripherals originally issued; (c) all software license keys, installation media, and documentation; (d) any Employer data, files, or records stored on the Equipment, which must first be transferred to the Employer as directed. The Equipment must be returned in person to the Employer's designated representative during regular business hours. The Employee shall receive a written receipt acknowledging the return. If the Employee fails to return Equipment within the required timeframe, the Employer reserves the right to: (i) assess a Non-Return Penalty as specified in the Monetary Penalty Schedule below; (ii) deduct the full replacement value of unreturned Equipment from the Employee's final paycheck to the fullest extent permitted by applicable law; (iii) report the Equipment as stolen property to law enforcement authorities; and (iv) pursue all available civil and criminal remedies.</p>

    <p><strong>5. Monetary Penalty Schedule.</strong> The Employee acknowledges and expressly agrees to the following specific monetary penalties for violations of this Agreement. These penalties are in addition to, and not in lieu of, the Employee's obligation to pay the full replacement cost of Equipment under Section 6 below. Each penalty amount is assessed per item of Equipment involved and per occurrence. All penalties shall be deducted directly from the Employee's wages, salary, commissions, bonuses, or any other compensation payable to the Employee, without further notice or consent, to the fullest extent permitted by applicable law.</p>
    <table class="penalty-table">
      <colgroup>
        <col style="width:7%;" />
        <col style="width:19%;" />
        <col style="width:46%;" />
        <col style="width:28%;" />
      </colgroup>
      <thead>
        <tr>
          <th>Tier</th>
          <th>Violation / Occurrence</th>
          <th>Definition</th>
          <th>Penalty Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr class="penalty-high">
          <td style="text-align:center;font-weight:700;color:#dc2626;">H</td>
          <td><strong>Theft or Conversion</strong></td>
          <td>Knowingly taking, selling, pawning, or permanently depriving the Employer of Equipment with intent to deprive; fraudulent misrepresentation of loss; destruction of Equipment to conceal prior violation</td>
          <td style="font-weight:700;color:#dc2626;"><strong>$500.00 per item + full replacement cost + referral for criminal prosecution</strong></td>
        </tr>
        <tr class="penalty-high">
          <td style="text-align:center;font-weight:700;color:#dc2626;">H</td>
          <td><strong>Non-Return of Equipment</strong></td>
          <td>Failure to return all Equipment within the 24-hour return period under Section 4, or returning Equipment in a deliberately damaged or inoperable state</td>
          <td style="font-weight:700;color:#dc2626;"><strong>$250.00 per item + $50.00 per additional day beyond the return deadline + full replacement cost for any item not returned</strong></td>
        </tr>
        <tr class="penalty-medium">
          <td style="text-align:center;font-weight:700;color:#d97706;">M</td>
          <td><strong>Loss of Equipment</strong></td>
          <td>Equipment lost due to negligence, including but not limited to leaving Equipment unattended in public places, in unlocked vehicles, or in locations accessible to unauthorized persons; loss while traveling without appropriate security measures</td>
          <td style="font-weight:700;color:#d97706;"><strong>Replacement cost × 1.5 (150% of replacement value) or $250.00 minimum, whichever is greater</strong></td>
        </tr>
        <tr class="penalty-medium">
          <td style="text-align:center;font-weight:700;color:#d97706;">M</td>
          <td><strong>Willful or Negligent Damage</strong></td>
          <td>Damage caused by gross negligence, reckless behavior, unauthorized modifications, failure to exercise required degree of care, or intentional destruction. Includes liquid damage, crushing, dropping from height, and electrical damage from unauthorized chargers</td>
          <td style="font-weight:700;color:#d97706;"><strong>$150.00 + full cost of repair; or $250.00 + full replacement cost if damaged beyond economical repair</strong></td>
        </tr>
        <tr class="penalty-medium">
          <td style="text-align:center;font-weight:700;color:#d97706;">M</td>
          <td><strong>Repair Fee</strong></td>
          <td>Any repair, service, or restoration performed on Equipment necessitated by the Employee's use, whether due to wear beyond normal expectations, accidental damage not covered above, software or firmware restoration, screen or battery replacement, port repair, or any other servicing required to return the Equipment to good working order</td>
          <td style="font-weight:700;color:#d97706;"><strong>Full cost of all parts, labor, and shipping for each repair event + $50.00 administrative processing fee per repair</strong></td>
        </tr>
        <tr class="penalty-medium">
          <td style="text-align:center;font-weight:700;color:#d97706;">M</td>
          <td><strong>Loss of Use Fee</strong></td>
          <td>Period during which Equipment is unavailable, inoperable, or out of service due to loss, theft, damage, repair, unauthorized modification, or any other occurrence attributable to the Employee's acts or omissions. Assessed from the date of the incident until the date the Equipment is returned, replaced, or restored to full working order. This fee compensates the Employer for lost productivity, temporary replacement costs, and administrative overhead</td>
          <td style="font-weight:700;color:#d97706;"><strong>$25.00 per calendar day per item of Equipment, beginning on the date of the incident and continuing until the item is returned, replaced, or fully repaired. No maximum cap. Assessed concurrently with all other applicable penalties and replacement costs. This fee is in addition to, and not in lieu of, any Repair Fee, replacement cost, or other penalty</strong></td>
        </tr>
        <tr class="penalty-medium">
          <td style="text-align:center;font-weight:700;color:#d97706;">M</td>
          <td><strong>Misuse of Equipment</strong></td>
          <td>Use of Equipment for unauthorized purposes including but not limited to: illegal activities, side business operations, cryptocurrency mining, unauthorized commercial use, operation of servers or network services, excessive bandwidth consumption, or use that violates any Employer policy</td>
          <td style="font-weight:700;color:#d97706;"><strong>$100.00 per occurrence + cost of any resulting data recovery, forensic examination, or remediation</strong></td>
        </tr>
        <tr class="penalty-high">
          <td style="text-align:center;font-weight:700;color:#dc2626;">H</td>
          <td><strong>Data Breach or Security Incident</strong></td>
          <td>Loss, exposure, or compromise of Employer confidential data due to the Employee's failure to maintain security measures, including but not limited to: failure to encrypt, sharing of passwords, installation of unauthorized software, disabling of security features, or failure to report a known security vulnerability</td>
          <td style="font-weight:700;color:#dc2626;"><strong>$1,000.00 + all costs associated with breach notification, forensic investigation, credit monitoring, legal fees, regulatory fines, and any third-party claims</strong></td>
        </tr>
        <tr class="penalty-medium">
          <td style="text-align:center;font-weight:700;color:#d97706;">M</td>
          <td><strong>Unauthorized Modifications</strong></td>
          <td>Repairing, disassembling, modifying, jailbreaking, rooting, or attempting to service Equipment; altering operating system, firmware, or security configurations; installing unauthorized hardware or software; removing or defacing asset tags</td>
          <td style="font-weight:700;color:#d97706;"><strong>$100.00 + full cost to restore Equipment to factory authorized configuration + cost of any replacement components needed</strong></td>
        </tr>
        <tr class="penalty-medium">
          <td style="text-align:center;font-weight:700;color:#d97706;">M</td>
          <td><strong>Late or Non-Reporting of Incident</strong></td>
          <td>Failure to report loss, theft, damage, or security incident within the timeframes specified in this Agreement (2 hours for loss/theft, 1 hour for damage or security incidents)</td>
          <td style="font-weight:700;color:#d97706;"><strong>$75.00 per day, per unreported incident, not to exceed $500.00 per incident</strong></td>
        </tr>
        <tr style="background:#fafaf9;">
          <td style="text-align:center;font-weight:700;color:#6b7280;">L</td>
          <td><strong>Administrative Processing Fee</strong></td>
          <td>Cost of processing, inspecting, testing, documenting, and administering the return, replacement, or repair of any Equipment item, assessed on each occurrence</td>
          <td style="font-weight:700;color:#6b7280;"><strong>$25.00 per item per occurrence</strong></td>
        </tr>
        <tr style="background:#fafaf9;">
          <td style="text-align:center;font-weight:700;color:#6b7280;">L</td>
          <td><strong>Data Recovery Fee</strong></td>
          <td>If Equipment is returned, damaged, or inoperable and contains Employer data that must be recovered, transferred, or forensically imaged</td>
          <td style="font-weight:700;color:#6b7280;"><strong>$150.00 flat fee + $75.00 per hour of IT labor for data recovery efforts</strong></td>
        </tr>
        <tr class="penalty-high">
          <td style="text-align:center;font-weight:700;color:#dc2626;">H</td>
          <td><strong>Software Misconduct &amp; License Violation</strong></td>
          <td>Installing pirated, cracked, unlicensed, or unauthorized software; copying or distributing Employer-licensed software in violation of its license; circumventing software activation or digital-rights management; introducing malware, ransomware, keyloggers, or unauthorized remote-access tools; disabling, uninstalling, or tampering with antivirus, encryption, monitoring, or endpoint-protection software; or using the Equipment to pirate, torrent, or unlawfully distribute copyrighted material</td>
          <td style="font-weight:700;color:#dc2626;"><strong>$250.00 per occurrence + full cost of re-licensing, remediation, malware removal, and re-imaging + any third-party license-infringement claims, statutory damages, or regulatory fines assessed against the Employer</strong></td>
        </tr>
        <tr class="penalty-high">
          <td style="text-align:center;font-weight:700;color:#dc2626;">H</td>
          <td><strong>Tampering with Security, Monitoring, or Asset Controls</strong></td>
          <td>Disabling, removing, obstructing, or defeating any GPS, telematics, mobile-device-management (MDM), remote-wipe, location, camera, or monitoring capability; removing, altering, or defacing asset tags, serial numbers, or ownership markings; spoofing device identity; or otherwise interfering with the Employer's ability to locate, monitor, secure, or recover the Equipment</td>
          <td style="font-weight:700;color:#dc2626;"><strong>$300.00 per occurrence + full cost to restore controls + immediate forfeiture of any prorated separation-chargeback reduction (full replacement cost becomes due)</strong></td>
        </tr>
        <tr class="penalty-medium">
          <td style="text-align:center;font-weight:700;color:#d97706;">M</td>
          <td><strong>Early-Separation Equipment Chargeback</strong></td>
          <td>Applied when employment ends (by resignation, termination, or otherwise) and Equipment is not returned in good working condition, OR when the Employer elects to charge for the depreciated value of Equipment retained, lost, or damaged at separation. The chargeback is a percentage of each item's replacement value, graduated by the time elapsed since the item was issued to the Employee</td>
          <td style="font-weight:700;color:#d97706;"><strong>100% of replacement value if separation occurs within 90 days of issuance; 75% within 91&ndash;180 days; 50% within 181&ndash;365 days; 25% within 366&ndash;730 days; 0% after 730 days &mdash; PROVIDED the item is returned undamaged. Damaged, lost, stolen, or unreturned items are charged at 100% of replacement value regardless of tenure, plus all other applicable penalties</strong></td>
        </tr>
      </tbody>
    </table>
    <p style="font-size:10pt;color:#6b7280;"><strong>Penalty Tiers:</strong> H = High Severity &mdash; may also result in immediate termination, civil litigation, and/or criminal referral. M = Medium Severity &mdash; subject to escalating disciplinary action. L = Low Severity &mdash; administrative fees applied automatically. The Employer reserves the right to assess penalties at its sole discretion based on the circumstances of each violation. All penalties are cumulative and may be applied concurrently for multiple violations. The Employer may waive or reduce any penalty in writing at its sole discretion, but no such waiver shall create a precedent or obligation to waive future penalties.</p>

    <p><strong>6. Full Replacement Cost Liability &amp; Payroll Deduction Authorization.</strong> In addition to any penalties assessed under the Monetary Penalty Schedule above, the Employee acknowledges and expressly agrees that they shall be held financially responsible for the full replacement cost of any Equipment that is lost, stolen, damaged beyond reasonable repair, destroyed, or not returned as required. "Full replacement cost" means the actual retail cost to purchase an equivalent new item of Equipment at the time of replacement, including all applicable taxes, shipping, and setup costs. The Employee authorizes the Employer to deduct the full replacement cost, together with any applicable penalties, directly from the Employee's wages, salary, commissions, bonuses, or any other compensation payable to the Employee, without further notice or consent, to the fullest extent permitted by applicable law. Additionally, the Employee understands and agrees that the Employer may require full or partial payment up front before the Employee is issued replacement or upgraded Equipment. This deduction authorization is separate and independent from any other claims or remedies the Employer may have.</p>

    <p><strong>7. Data Security, Confidentiality &amp; Privacy.</strong> The Employee acknowledges that all data, information, communications, and materials stored on, transmitted through, or accessed via the Equipment are the sole property of the Employer and may contain confidential, proprietary, and trade secret information. The Employee shall: (a) maintain the confidentiality of all Employer data in accordance with the Employer's data security and confidentiality policies; (b) use only Employer-approved encryption, VPN, and remote access solutions when accessing Employer systems or data; (c) enable and maintain all security features on the Equipment, including full-disk encryption, screen locks, antivirus software, and automatic security updates as directed by the Employer; (d) report any suspected security breach, unauthorized access, malware infection, or data loss within one (1) hour of discovery; (e) not store Employer data on any personal devices, cloud services, or unapproved storage media; (f) not share passwords, authentication tokens, or access credentials with any person for any reason; (g) allow the Employer to remotely wipe, lock, or disable the Equipment in the event of loss, theft, or termination of employment. The Employee has no expectation of privacy regarding any data stored on or transmitted through the Equipment. The Employer reserves the right to monitor, access, inspect, copy, delete, or preserve any data on the Equipment at any time, with or without notice, for any lawful purpose. Any violation of this Section 7 shall subject the Employee to the Data Breach penalties set forth in the Monetary Penalty Schedule (Section 5).</p>

    <p><strong>8. Inspection, Monitoring &amp; Auditing.</strong> The Employer, through its authorized representatives, retains the unrestricted right to inspect, audit, and monitor the Equipment and its contents at any time, with or without prior notice, and with or without the Employee's presence or consent. Inspections may include, but are not limited to: (a) physical examination of the Equipment for damage, unauthorized modifications, or wear; (b) review of installed software, applications, and configurations; (c) forensic analysis of data, files, browsing history, communications, and system logs; (d) remote access and diagnostic scanning; and (e) inventory verification against asset records. The Employee shall cooperate fully with any inspection or audit, including providing passwords and access credentials upon request (which may be changed immediately following the inspection). Refusal to cooperate with an inspection or audit constitutes a material breach of this Agreement and grounds for immediate disciplinary action, including termination, and shall subject the Employee to a penalty of $100.00 per instance under the Monetary Penalty Schedule.</p>

    <p><strong>9. Loss, Theft &amp; Damage Reporting.</strong> The Employee shall immediately report any loss, theft, damage, or suspected compromise of Equipment. Reporting requirements are as follows: (a) in the event of loss or theft, the Employee must notify both the Employer and local law enforcement within two (2) hours of discovery, and provide the Employer with the police report case number and investigating officer's contact information within 24 hours; (b) in the event of accidental damage, spill, or drop, the Employee must report the incident within one (1) hour, regardless of whether the Equipment appears functional; (c) in the event of suspected malware, virus, or unauthorized access, the Employee must immediately disconnect the Equipment from all networks and report the incident within one (1) hour. Failure to timely report any such incident shall subject the Employee to the Late or Non-Reporting penalties set forth in the Monetary Penalty Schedule (Section 5), in addition to any penalties for the underlying loss, theft, damage, or security incident.</p>

    <p><strong>10. Compliance with Policies &amp; Acceptable Use.</strong> The Employee shall at all times comply with all Employer policies, procedures, handbooks, codes of conduct, and directives, as they may be amended from time to time in the Employer's sole discretion, including without limitation: (a) the Employer's Information Technology Acceptable Use Policy; (b) the Employer's Data Security and Privacy Policy; (c) the Employer's Code of Business Conduct and Ethics; (d) the Employer's Records Retention and Disposal Policy; (e) all applicable industry regulations and legal requirements. The Employee acknowledges that they have received, read, and understand all applicable policies, or have been given the opportunity to request copies. The Employee shall not use the Equipment to violate any federal, state, or local law, regulation, or ordinance. Any violation of this Section 10 shall subject the Employee to the Misuse penalties set forth in the Monetary Penalty Schedule (Section 5).</p>

    <p><strong>11. Insurance &amp; Indemnification.</strong> The Employee acknowledges that the Equipment is not insured under any personal insurance policy held by the Employee for loss, theft, or damage. The Employee shall maintain, at their own expense, appropriate renters or homeowners insurance that covers the full replacement value of the Equipment, or shall waive any claim against their personal insurance if not so maintained. To the fullest extent permitted by law, the Employee agrees to indemnify, defend, and hold harmless the Employer, its officers, directors, employees, and agents from and against any and all claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys' fees) arising out of or related to: (a) the Employee's use, misuse, or unauthorized use of the Equipment; (b) the Employee's breach of any term of this Agreement; (c) any loss, theft, or damage to the Equipment caused by the Employee's negligence, willful misconduct, or violation of law; (d) any data breach, data loss, or security incident caused or contributed to by the Employee's acts or omissions. The Employee's indemnification obligations are cumulative and in addition to any penalties assessed under the Monetary Penalty Schedule (Section 5).</p>

    <p><strong>12. Termination &amp; Survival.</strong> This Agreement shall commence on the date first set forth above and shall continue until terminated by either party. This Agreement shall automatically terminate upon the termination of the Employee's employment for any reason. Obligations under Sections 4 (Return of Equipment), 5 (Monetary Penalty Schedule), 6 (Full Replacement Cost Liability), 7 (Data Security), 9 (Loss Reporting), and 11 (Indemnification) shall survive the termination of this Agreement and the termination of employment. The Employee's obligations under this Agreement are in addition to, and not in lieu of, any obligations set forth in any separate employment agreement, confidentiality agreement, invention assignment agreement, or restrictive covenant agreement between the Employee and the Employer.</p>

    <p><strong>13. Separation Chargeback Upon Resignation or Termination.</strong> The Employee acknowledges and expressly agrees that, upon the termination of their employment for any reason &mdash; whether by voluntary resignation, involuntary termination with or without cause, layoff, abandonment, retirement, or death &mdash; any Employer Equipment in the Employee's possession, custody, or control must be returned in good working condition in accordance with Section 4. To the extent any item of Equipment is not so returned, or is returned lost, stolen, damaged, defaced, or in a non-functional or materially diminished condition, the Employer is hereby authorized to assess an <em>Early-Separation Equipment Chargeback</em> against the Employee, calculated as a percentage of each affected item's full replacement value according to the following graduated schedule, measured from the date the item was issued to the Employee to the Employee's last day of employment: <strong>(a)</strong> one hundred percent (100%) of replacement value if separation occurs within ninety (90) days of issuance; <strong>(b)</strong> seventy-five percent (75%) if within ninety-one (91) to one hundred eighty (180) days; <strong>(c)</strong> fifty percent (50%) if within one hundred eighty-one (181) to three hundred sixty-five (365) days; <strong>(d)</strong> twenty-five percent (25%) if within three hundred sixty-six (366) to seven hundred thirty (730) days; and <strong>(e)</strong> zero percent (0%) thereafter &mdash; <em>provided in each case that the item is returned undamaged and fully functional.</em> Any item that is lost, stolen, willfully or negligently damaged, tampered with, or not returned shall be charged at one hundred percent (100%) of its replacement value regardless of tenure, in addition to all other applicable penalties under the Monetary Penalty Schedule (Section 5). The graduated reduction reflects the depreciation of Equipment over its useful service life and is intended as a reasonable, agreed pre-estimate of the Employer's loss, not a penalty. The Employee authorizes the Employer to deduct the full amount of any Separation Chargeback, together with any other penalties and replacement costs owed, from the Employee's final wages, salary, commissions, accrued but unused leave (where permitted), bonuses, or any other compensation payable upon separation, to the fullest extent permitted by applicable law; any balance not so recovered shall be due and payable as a debt within thirty (30) days of demand and may be referred to collections or reported as set forth in this Agreement.</p>

    <p><strong>14. Software Misconduct, Tampering &amp; License Compliance.</strong> The Employee shall use only software that is properly licensed to the Employer and installed or authorized by the Employer's IT department. The Employee is strictly prohibited from, and shall be liable for, any of the following: <strong>(a)</strong> installing pirated, cracked, counterfeit, "abandonware," or otherwise unlicensed software, or copying, redistributing, or exceeding the seat or device limits of any Employer-licensed software; <strong>(b)</strong> downloading, torrenting, streaming, or distributing copyrighted music, film, software, or other material in violation of law or license; <strong>(c)</strong> introducing, whether intentionally or through negligence, any virus, malware, ransomware, spyware, keylogger, cryptominer, or unauthorized remote-access or backdoor tool; <strong>(d)</strong> disabling, uninstalling, bypassing, or tampering with any antivirus, endpoint-protection, encryption, firewall, content-filtering, logging, mobile-device-management (MDM), GPS, telematics, remote-wipe, or other security or monitoring software or hardware installed or required by the Employer; <strong>(e)</strong> altering, spoofing, or obscuring the Equipment's identity, serial number, MAC address, or asset tag; or <strong>(f)</strong> circumventing software activation, license servers, or digital-rights-management controls. The Employee acknowledges that such conduct exposes the Employer to security breaches, license-infringement claims, statutory copyright damages, regulatory penalties, and reputational harm. Any violation of this Section shall subject the Employee to the Software Misconduct &amp; License Violation and Tampering penalties set forth in the Monetary Penalty Schedule (Section 5), shall make the Employee liable for all resulting re-licensing, remediation, forensic, and legal costs and any third-party claims, and may constitute grounds for immediate termination and referral to law enforcement. Tampering with the Employer's security or monitoring controls additionally forfeits any prorated reduction under the Separation Chargeback (Section 13), causing the full replacement value to become immediately due.</p>

    <p><strong>15. Wage-Law Compliance, Severability &amp; Governing Law.</strong> All payroll deductions, penalties, chargebacks, and recoveries authorized under this Agreement (including Sections 5, 6, and 13) shall be administered in compliance with the federal Fair Labor Standards Act and the Utah Payment of Wages Act, Utah Code Ann. &sect;&sect; 34-28-1 et seq.: <strong>(a)</strong> no deduction shall reduce the Employee's pay below the applicable federal or Utah minimum wage for any workweek or be taken from overtime pay in violation of law; <strong>(b)</strong> deductions other than those permitted by law are made pursuant to the Employee's written authorization in this Agreement, as required by Utah Code Ann. &sect; 34-28-3; and <strong>(c)</strong> any amount that cannot lawfully be deducted shall instead be recoverable as a civil debt, with the Employer entitled to its costs of collection and reasonable attorneys' fees and interest at the maximum lawful rate. Nothing in this Agreement waives any right the Employee cannot lawfully waive, including the right to report violations to or cooperate with any government agency and the immunity under the Defend Trade Secrets Act, 18 U.S.C. &sect; 1833(b). This Agreement is governed by the laws of the State of Utah and applicable federal law; the parties consent to exclusive venue in the courts of the county of the Employer's principal place of business in Utah and, to the fullest extent permitted by law, waive trial by jury. The penalty and chargeback amounts herein are agreed reasonable pre-estimates of the Employer's loss (liquidated damages), not punitive penalties. If any provision is held invalid or unenforceable, it shall be reformed to the maximum extent lawful or severed, and the remainder shall continue in full force and effect.</p>

    <p><strong>16. Acknowledgment of Receipt &amp; Condition.</strong> BY SIGNING BELOW, THE EMPLOYEE ACKNOWLEDGES THAT THEY HAVE RECEIVED THE EQUIPMENT LISTED IN THE SCHEDULE ABOVE AND CONFIRMS THAT SUCH EQUIPMENT IS IN THE CONDITION INDICATED. THE EMPLOYEE FURTHER ACKNOWLEDGES THAT THEY HAVE PERSONALLY INSPECTED EACH ITEM AND VERIFIED ITS FUNCTIONALITY, INCLUDING BUT NOT LIMITED TO: POWER-ON OPERATION, SCREEN INTEGRITY, KEYBOARD/INPUT FUNCTIONALITY, PORT FUNCTIONALITY, AND BATTERY CONDITION. ANY DISCREPANCIES OR DEFECTS MUST BE REPORTED IN WRITING WITHIN THREE (3) BUSINESS DAYS OF RECEIPT; FAILURE TO DO SO CONSTITUTES THE EMPLOYEE'S UNQUALIFIED ACCEPTANCE OF THE EQUIPMENT IN THE CONDITION DESCRIBED. THE EMPLOYEE FURTHER ACKNOWLEDGES HAVING READ AND UNDERSTOOD THE MONETARY PENALTY SCHEDULE IN SECTION 5, THE SEPARATION CHARGEBACK IN SECTION 13, THE SOFTWARE MISCONDUCT TERMS IN SECTION 14, AND THE WAGE-LAW AND GOVERNING-LAW TERMS IN SECTION 15, AND AGREES TO ALL PENALTIES AND CHARGEBACKS DESCRIBED THEREIN.</p>

    <p><strong>17. Governing Law &amp; Jurisdiction.</strong> This Agreement shall be governed by and construed in accordance with the laws of ${esc(employee.state || 'the state in which the Employer\'s principal place of business is located')}, without regard to its conflict of laws principles. The parties hereby submit to the exclusive personal jurisdiction and venue of the state and federal courts located in that state for any dispute arising out of or relating to this Agreement, and the Employee waives any objection to such jurisdiction or venue based on forum non conveniens or lack of personal jurisdiction. The Employee specifically consents to the jurisdiction of small claims court for recovery of any unpaid penalties or replacement costs not to exceed that court's jurisdictional limit.</p>

    <p><strong>18. Entire Agreement &amp; Amendments.</strong> This Agreement, together with the Equipment Schedule above and any referenced Employer policies, constitutes the entire agreement between the parties with respect to the subject matter hereof and supersedes all prior or contemporaneous understandings, agreements, representations, and communications, whether written or oral. This Agreement may not be amended, modified, or supplemented except by a written instrument signed by both parties. The Employee acknowledges that no representation or promise not expressly set forth in this Agreement has been made by the Employer.</p>

    <p><strong>19. Severability &amp; Waiver.</strong> If any provision of this Agreement is held to be invalid, illegal, or unenforceable by a court of competent jurisdiction, such provision shall be enforced to the maximum extent permitted by law, and the remaining provisions shall continue in full force and effect. The failure of either party to enforce any provision of this Agreement shall not be construed as a waiver of such provision or the right to enforce it in the future. No waiver shall be effective unless made in writing and signed by the party against whom enforcement is sought. Any waiver of a penalty under Section 5 shall not constitute a waiver of any future penalty or of the Employer's right to enforce the penalty schedule.</p>

    <p><strong>20. Acknowledgment of Penalties.</strong> THE EMPLOYEE ACKNOWLEDGES THAT THEY HAVE READ THE MONETARY PENALTY SCHEDULE IN SECTION 5 OF THIS AGREEMENT AND UNDERSTAND THE SPECIFIC PENALTY AMOUNTS THAT MAY BE ASSESSED FOR VIOLATIONS. THE EMPLOYEE AGREES THAT THE PENALTIES SET FORTH THEREIN ARE REASONABLE AND PROPORTIONATE TO THE POTENTIAL HARM CAUSED BY EACH TYPE OF VIOLATION. THE EMPLOYEE FURTHER AGREES THAT THE EMPLOYER MAY DEDUCT ANY UNPAID PENALTIES AND REPLACEMENT COSTS FROM THE EMPLOYEE'S FINAL COMPENSATION AND MAY REPORT ANY UNPAID OBLIGATIONS TO CREDIT BUREAUS OR COLLECTION AGENCIES.</p>
  </div>

  <h2>Equipment Schedule &mdash; Detailed Itemization</h2>
  <p>The following equipment has been issued to the Employee. The Employee acknowledges receipt and confirms the condition of each item as indicated at the time of issuance.</p>
  <table class="equip-table">
    <colgroup>
      <col class="c-num" /><col class="c-item" /><col class="c-serial" /><col class="c-model" />
      <col class="c-cond" /><col class="c-value" /><col class="c-date" /><col class="c-status" /><col class="c-statusdate" />
    </colgroup>
    <thead>
      <tr>
        <th>#</th>
        <th>Item Description</th>
        <th>Serial Number</th>
        <th>Model / SKU</th>
        <th>Condition at Issuance</th>
        <th style="text-align:right;">Value</th>
        <th>Date Issued</th>
        <th>Status</th>
        <th>Status Date</th>
      </tr>
    </thead>
    <tbody>
      ${equipmentRows}
    </tbody>
  </table>

  <p style="font-size:10pt;color:#6b7280;margin-top:8px;"><em>Note: Any items not listed above that were previously issued must be disclosed to the Employer immediately. Failure to disclose previously issued equipment may result in additional liability.</em></p>

  ${agreementSignatureBlock(empName, companyName, signatures)}

  <div class="footer">
    <p>${companyName} &mdash; Employer Provided Equipment Agreement</p>
    <p>${signatures?.employee?.date
      ? `Signed by ${empName} on ${fmtDate(String(signatures.employee.date).length === 10 ? signatures.employee.date + 'T12:00:00' : signatures.employee.date)}`
      : `Generated on ${today}`}</p>
  </div>
</div>
</body>
</html>`;

      return { html };
    } catch (err: any) {
      console.error('Failed to generate equipment agreement:', err);
      return { html: '' };
    }
  });

  ipcMain.handle('employee:generate-employee-agreement', (_event, { employeeId, signatures }: { employeeId: string; signatures?: SigData }) => {
    try {
      const dbInstance = db.getDb();
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return { html: '' };

      const employee = dbInstance.prepare('SELECT * FROM employees WHERE id = ? AND company_id = ?').get(employeeId, companyId) as any;
      if (!employee) return { html: '' };

      const company = dbInstance.prepare('SELECT * FROM companies WHERE id = ?').get(companyId) as any;

      const esc = (s: any) => {
        if (s == null) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
      };
      const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
      const fmtCurrency = (n: any) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(n) || 0);
      // Humanize a stored enum/slug value for display: turn snake_case /
      // kebab-case tokens into Title Case ("on_site" → "On Site",
      // "operations" → "Operations"). Preserves intentional user casing —
      // a word that ISN'T all-lowercase (e.g. "iPhone", "PTO", "McAfee")
      // is left untouched, so we never clobber how the user actually typed
      // it. Only all-lowercase tokens get their first letter capitalized.
      const humanize = (s: any): string => String(s ?? '')
        .replace(/[_-]+/g, ' ')
        .split(' ')
        .map((w) => (w && w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w))
        .join(' ')
        .trim();

      const companyName = esc(company?.name || '');
      const companyAddr = company ? [company.address_line1, company.address_line2, `${company.city || ''} ${company.state || ''} ${company.zip || ''}`].filter(Boolean).join(', ') : '';

      const empName = esc(employee.name || '');
      const empTitle = esc(humanize(employee.job_title || ''));
      const empAddr = [employee.address_line1, employee.address_line2, `${employee.city || ''} ${employee.state || ''} ${employee.zip || ''}`].filter(Boolean).join(', ');
      const empStart = fmtDate(employee.start_date);
      const empEmail = esc(employee.email || '');
      const empPhone = esc(employee.phone || '');
      const empType = employee.type === 'employee' ? 'Employee' : 'Contractor';
      const payType = employee.pay_type === 'salary' ? 'Salary' : 'Hourly';
      const payLabel = employee.pay_type === 'salary' ? 'Annual Salary' : 'Hourly Rate';
      const empPay = fmtCurrency(employee.pay_rate);
      const empSchedule = humanize(employee.pay_schedule || '');
      const empDept = esc(humanize(employee.department || ''));
      const empLoc = esc(humanize(employee.work_location || ''));
      const today = fmtDate(new Date().toISOString());

      const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Employee Agreement - ${empName}</title>
<style>
  @page { margin: 0.85in 0.9in; size: Letter; }
  body { font-family: 'Times New Roman', Times, serif; font-size: 11pt; line-height: 1.6; color: #1a1a1a; margin: 0; padding: 0; }
  /* Fills whatever printable width Chromium actually lays out (set via the
     printToPDF margins in EmployeeForm.tsx, since @page is cosmetic-only
     here) — a fixed px max-width previously left the table pressed against
     the right edge on Letter paper instead of centered with even margins. */
  .container { width: 100%; margin: 0 auto; }
  .letterhead { text-align: center; padding-bottom: 14px; margin-bottom: 20px; border-bottom: 0.5px solid #ccc; }
  .letterhead .co-name { font-size: 18pt; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #111; margin: 0; padding-bottom: 6px; border-bottom: 1.5px solid #111; display: inline-block; }
  .letterhead .co-addr { font-size: 9pt; color: #555; margin-top: 6px; letter-spacing: 0.3px; }
  .caption-block { margin-top: 24px; padding: 12px 0; text-align: center; border-top: 1px solid #1a1a1a; border-bottom: 1px solid #1a1a1a; }
  .caption-title { font-size: 12pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin: 0; }
  .caption-parties { font-size: 10pt; color: #444; margin-top: 4px; }
  .caption-date { font-size: 9.5pt; color: #666; margin-top: 2px; }
  h2 { font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; font-size: 12pt; margin-top: 18px; margin-bottom: 8px; color: #222; border-bottom: 1px solid #ccc; padding-bottom: 4px; text-transform: uppercase; letter-spacing: 0.8px; }
  .letter-body { margin-top: 12px; font-size: 10.5pt; }
  .letter-body p { margin: 8px 0; text-align: justify; }
  .info-table { width: 100%; border-collapse: collapse; margin: 12px 0; font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; }
  .info-table td { padding: 5px 10px; font-size: 10pt; border-bottom: 1px solid #eee; }
  .info-table td:first-child { font-weight: 600; width: 170px; color: #555; }
  .section { margin: 16px 0; }
  .section p { margin: 8px 0; text-align: justify; font-size: 10.5pt; padding-left: 28px; text-indent: -28px; }
  .signature-section { margin-top: 36px; page-break-inside: avoid; }
  .signature-row { display: flex; justify-content: space-between; margin-top: 24px; }
  .signature-field { flex: 1; }
  .signature-line { border-top: 1px solid #374151; margin-top: 36px; padding-top: 4px; font-size: 10pt; }
  .footer { margin-top: 36px; text-align: center; font-size: 8.5pt; color: #999; font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; border-top: 0.5px solid #ccc; padding-top: 8px; }
  @media print { body { padding: 0; } }
</style></head>
<body>
<div class="container">
  <!-- Formal letterhead -->
  <div class="letterhead">
    <p class="co-name">${companyName}</p>
    ${companyAddr ? `<p class="co-addr">${esc(companyAddr)}</p>` : ''}
  </div>

  <!-- Caption block -->
  <div class="caption-block">
    <p class="caption-title">Employment Agreement</p>
    <p class="caption-parties">Between ${companyName} and ${empName}</p>
    <p class="caption-date">Effective ${signatures?.employee?.date
      ? fmtDate(String(signatures.employee.date).length === 10 ? signatures.employee.date + 'T12:00:00' : signatures.employee.date)
      : (empStart || today)}</p>
  </div>

  <!-- Body opening: contract recital -->
  <div class="letter-body">
    <p>This Agreement is made and entered into as of ${empStart || today}, by and between ${companyName} ("Employer") and ${empName}${empTitle ? `, ${empTitle}` : ''}${empAddr ? `, of ${esc(empAddr)}` : ''} ("Employee")${empEmail || empPhone ? ` (contactable at${empEmail ? ` ${empEmail}` : ''}${empEmail && empPhone ? ',' : ''}${empPhone ? ` ${empPhone}` : ''})` : ''} (collectively, the "Parties"). This Agreement sets forth the terms and conditions of the Employee's employment. The Parties agree as follows:</p>
  </div>

  <h2>Terms of Employment</h2>
  <table class="info-table">
    <tr><td>Position:</td><td>${empTitle || '—'}</td></tr>
    ${empDept ? `<tr><td>Department:</td><td>${empDept}</td></tr>` : ''}
    ${empLoc ? `<tr><td>Work Location:</td><td>${empLoc}</td></tr>` : ''}
    <tr><td>Employment Type:</td><td>${esc(empType)}</td></tr>
    <tr><td>Start Date:</td><td>${empStart}</td></tr>
    <tr><td>Compensation:</td><td>${payLabel}: ${empPay} (${esc(payType)})</td></tr>
    <tr><td>Pay Schedule:</td><td>${esc(empSchedule)}</td></tr>
  </table>

  <h2>Agreement Terms</h2>
  <div class="section">
    <p><strong>1. Position and Duties.</strong> The Employee accepts employment with the Employer in the position, department, and work location set forth above and agrees to faithfully, competently, and diligently perform all duties, responsibilities, tasks, and functions reasonably associated with that position, together with any other lawful duties that the Employer may assign from time to time, whether or not such duties are expressly described in any job description, consistent with the Employee's role, qualifications, or the legitimate business needs of the Employer. The Employee shall devote their full business time, attention, energy, judgment, knowledge, skill, and best efforts to the faithful performance of their duties during all scheduled working hours; shall at all times act honestly, ethically, loyally, and in the Employer's best interests; and shall perform all work in a competent, careful, professional, and workmanlike manner consistent with the standards, quality expectations, productivity requirements, and timelines established by the Employer. The Employee further agrees to: (a) report to, communicate openly with, and follow the lawful and reasonable instructions and directions of their assigned supervisor, manager, or any other person the Employer may designate; (b) accurately and truthfully record and report their time, work activities, expenses, and results, and promptly disclose to the Employer any error, loss, damage, theft, safety hazard, suspected fraud, or violation of law or policy of which the Employee becomes aware; (c) maintain in good standing any license, certification, registration, clearance, or qualification required for the position, and immediately notify the Employer of any change, lapse, suspension, or revocation thereof; and (d) treat coworkers, clients, customers, and members of the public with courtesy, respect, and professionalism at all times. The Employee acknowledges and agrees that the Employer retains sole and continuing discretion to assign, reassign, expand, reduce, or otherwise modify the Employee's title, duties, responsibilities, reporting relationships, department, supervisor, work location, shift, and schedule as the Employer's business needs require, and that no such change shall constitute a breach of this Agreement, entitle the Employee to any additional compensation unless separately agreed in writing, or alter the at-will nature of the employment relationship described in Section 3. During the term of employment, the Employee shall not, directly or indirectly, engage in or be employed by any other business, occupation, venture, or activity that competes with the Employer, that interferes with or impairs the full and faithful performance of the Employee's duties, that makes use of the Employer's time, equipment, or Confidential Information, or that creates an actual, potential, or apparent conflict of interest, without first obtaining the Employer's prior written consent, which the Employer may grant, condition, or withhold in its sole discretion.</p>
    <p><strong>2. Compensation.</strong> In full consideration for all services to be rendered by the Employee, the Employer shall pay the Employee at the rate, in the amount, and on the pay schedule specified in the Terms of Employment set forth above, less all withholdings, taxes, garnishments, deductions, and contributions required or permitted by applicable federal, state, and local law or authorized by the Employee. The Employee acknowledges and agrees that: (a) the compensation stated above constitutes the Employee's entire and complete cash compensation for all services rendered, and no bonus, commission, incentive, raise, equity, premium, stipend, severance, or other payment of any kind is earned, promised, or owed unless and until it is separately set forth in a written agreement signed by an authorized officer or representative of the Employer; (b) for non-exempt employees, the rate stated above is the Employee's regular rate of pay, and all hours actually worked, including any authorized overtime, shall be recorded and compensated strictly in accordance with Section 10 and all applicable federal and Utah wage-and-hour laws; (c) the Employee is responsible for accurately recording all time worked and for promptly reporting any payroll error, underpayment, or overpayment, and authorizes the Employer to correct any payroll error and to recover any wage overpayment, advance, or unearned draw to the fullest extent permitted by applicable law; and (d) wages will be paid by the method and on the regular paydays established by the Employer in compliance with the Utah Payment of Wages Act. The Employer reserves the right, in its sole discretion and to the extent permitted by applicable law, to review, establish, modify, increase, or decrease the Employee's compensation, pay rate, pay method, pay frequency, commission or bonus structure, and related pay practices on a prospective basis, with such advance notice as may be required by applicable law; no such review or adjustment shall be deemed a promise of continued employment, shall create any vested right to any particular level of compensation, or shall alter the at-will nature of the employment relationship. The Employee acknowledges that they have received, read, and reviewed the compensation terms set forth above, that those terms accurately and completely reflect the agreed rate of pay and pay frequency, and that the Employee is not relying on any oral or written representation regarding compensation that is not expressly contained in this Agreement.</p>
    <p><strong>3. At-Will Employment.</strong> The Employee's employment with the Employer is and shall at all times remain strictly "at-will." This means that either the Employee or the Employer may terminate, and the Employer may modify the terms and conditions of, the employment relationship at any time, for any reason or for no reason, with or without cause, and with or without advance notice, subject only to applicable law. The Employee specifically acknowledges and agrees that: (a) nothing contained in this Agreement, in any employee handbook, policy, manual, memorandum, offer letter, application, performance review, compensation plan, training material, verbal or written statement, or course of conduct, and nothing arising from the Employee's length of service, performance, promotions, raises, or commendations, shall be construed or relied upon to create a contract of employment for any fixed, definite, or implied term, to guarantee continued or permanent employment, to require "just cause," "good cause," warnings, or progressive discipline prior to termination, or to limit in any way the Employer's right to terminate at-will; (b) any descriptions of disciplinary or termination procedures are provided as guidelines only, are not contractually binding, and may be followed, modified, bypassed, or disregarded by the Employer in its sole discretion as it deems appropriate to the circumstances; and (c) no manager, supervisor, recruiter, officer, agent, or other representative of the Employer has the authority to enter into any agreement, or to make any promise, representation, or commitment, that alters the at-will nature of the employment relationship or that is contrary to the terms of this Section, and the Employee shall not rely on any such statement. The at-will employment relationship may be modified only by an express written agreement that specifically references and supersedes this Section and that is signed by both the Employee and a duly authorized officer of the Employer. The Employee further acknowledges that the at-will relationship survives and continues notwithstanding any change in the Employee's position, title, duties, compensation, benefits, work location, or length of service, and that this Section shall control over any contrary provision, understanding, or practice. This Section is reaffirmed and supplemented by, and shall be read together with, the reservation-of-rights provisions set forth elsewhere in this Agreement.</p>
    <p><strong>4. Benefits.</strong> The Employee may, subject to eligibility, be entitled to participate in such employee benefit plans, programs, insurance arrangements, and policies as the Employer may, in its sole and exclusive discretion, choose to establish, sponsor, maintain, amend, reduce, or terminate from time to time, which may include without limitation health, dental, vision, life, disability, retirement or 401(k), paid-time-off, holiday, sick-leave, and other benefit programs. The Employee acknowledges and agrees that: (a) each such benefit is governed exclusively by the terms, conditions, eligibility requirements, waiting periods, enrollment windows, vesting schedules, contribution and cost-sharing provisions, and limitations set forth in the controlling plan documents, summary plan descriptions, and insurance contracts then in effect, which documents and contracts shall govern and control in the event of any conflict or inconsistency with this Agreement, any benefits summary, any handbook, or any oral or written representation; (b) the Employer expressly reserves the right, at any time and for any reason, to adopt, add, change, amend, reduce, suspend, replace, or discontinue any benefit, plan, program, insurer, carrier, contribution level, or eligibility rule, in whole or in part, prospectively or as otherwise permitted, to the fullest extent allowed by applicable law and the applicable plan terms, and to require employee contributions toward the cost of any benefit; (c) nothing in this Section or in any benefit plan guarantees the availability, continuation, or any particular level of any benefit, creates any vested or contractual right to any benefit except as expressly provided by the governing plan documents, or constitutes a promise of continued employment; and (d) the offering, modification, or discontinuation of any benefit does not in any way alter, limit, or affect the at-will nature of the employment relationship described in Section 3. Questions regarding eligibility, coverage, claims, or the terms of any benefit shall be governed by, and directed in accordance with, the applicable plan documents and the plan administrator's determinations.</p>
    <p><strong>5. Confidentiality.</strong> The Employee acknowledges and agrees that, in the course and scope of employment, the Employee will be given access to, will be entrusted with, and will become acquainted with confidential, proprietary, sensitive, and trade-secret information belonging to the Employer and to its clients, customers, vendors, partners, and affiliates, the unauthorized use or disclosure of which would cause substantial and irreparable harm to the Employer. Such information includes, without limitation: client, customer, and prospect lists, files, contact information, account histories, and relationship details; pricing, cost, margin, billing, and financial data; business, marketing, sales, and strategic plans; methods, systems, procedures, processes, formulas, techniques, and know-how; software, source code, databases, login credentials, and technical documentation; vendor and supplier terms; personnel, payroll, and benefits records; and any other non-public information that is disclosed to, accessed by, observed by, or developed by the Employee, whether or not marked or designated as "confidential" (collectively, "Confidential Information"). The Employee agrees, both during employment and at all times after the employment relationship ends, for so long as the information remains confidential or constitutes a trade secret: (a) to hold all Confidential Information in the strictest confidence and to take all reasonable precautions to protect and safeguard it against unauthorized access, use, or disclosure; (b) to access and use Confidential Information solely for the legitimate benefit of the Employer and only to the extent necessary to perform the Employee's authorized duties; (c) not to directly or indirectly disclose, publish, communicate, transmit, copy, reproduce, remove, transfer, or otherwise make available any Confidential Information to any person or entity inside or outside the Employer who is not authorized to receive it, and not to use any Confidential Information for the benefit of the Employee or any third party or to the detriment of the Employer; and (d) not to comingle Confidential Information with the Employee's personal records, store it on unauthorized personal devices or accounts, or retain any copy after employment ends. Upon termination of employment for any reason, or at any earlier time upon the Employer's request, the Employee shall immediately cease all use of and return or, at the Employer's direction, permanently destroy all Confidential Information and all copies, notes, summaries, and derivatives thereof in any form or medium. The Employee's obligations under this Section are in addition to, cumulative with, and shall be read together with the Employee's obligations under Section 11 (Confidential Information &amp; Non-Disclosure), Section 12 (Data Security), and all applicable federal and Utah trade-secret and unfair-competition laws, and are subject to the protected-rights and statutory carve-outs set forth elsewhere in this Agreement, including the federal Defend Trade Secrets Act immunity notice, which permits limited disclosure of a trade secret made in confidence to a government official or attorney solely for the purpose of reporting or investigating a suspected violation of law, or in a sealed court filing.</p>
    <p><strong>6. Company Property.</strong> All equipment, devices, computers, hardware, peripherals, software, licenses, tools, instruments, supplies, materials, inventory, uniforms, vehicles, fuel and credit cards, keys, badges, access cards and codes, mobile and electronic devices, telephones, documents, files, manuals, records, correspondence, data, databases, drawings, designs, and work product, and all other property, tangible or intangible, that is furnished, issued, advanced, or made available to the Employee by the Employer, or that is acquired, created, generated, or received by the Employee in connection with or as a result of employment, shall be and remain at all times the sole and exclusive property of the Employer (collectively, "Company Property"). The Employee agrees that: (a) the Employee shall use all Company Property only for legitimate, authorized business purposes and in accordance with the Employer's policies, and shall exercise reasonable and prudent care to maintain, protect, and safeguard Company Property against loss, theft, damage, misuse, tampering, and unauthorized access or disclosure; (b) the Employee shall not remove Company Property from the Employer's premises except as expressly authorized, shall not lend, sell, pledge, alter, or allow any unauthorized person to use Company Property, and shall not install unauthorized software or use Company Property for any unlawful, personal, or competing purpose; and (c) the Employee has no expectation of privacy in any Company Property or in any communication, file, or data created, stored, sent, or received using Company Property or the Employer's systems, all of which the Employer may access, monitor, review, and disclose at any time to the extent permitted by law. Upon termination of employment for any reason, or at any earlier time upon the Employer's request, the Employee shall immediately surrender and return to the Employer all Company Property in good operating condition, reasonable wear and tear excepted, together with all originals and copies of any Confidential Information in any form or medium, and shall not retain, copy, withhold, encrypt, delete, wipe, alter, damage, or destroy any Company Property, data, or account credentials without the Employer's express prior written authorization. To the fullest extent permitted by applicable law, and subject to a separate written wage-deduction authorization where required, the Employer may withhold from the Employee's wages or final pay, set off against amounts owed to the Employee, and/or pursue reimbursement or recovery for, the documented replacement or repair value of any Company Property that the Employee fails to return, or that is returned lost, damaged, destroyed, or stolen as a result of the Employee's negligence, misuse, or misconduct; provided, however, that no such deduction shall reduce the Employee's wages below the applicable federal or Utah minimum wage for any workweek or unlawfully reduce any overtime compensation due, and all such deductions shall comply with the Utah Payment of Wages Act and the Fair Labor Standards Act.</p>
    <p><strong>7. Compliance with Policies.</strong> The Employee agrees to read, understand, and comply at all times, both in letter and in spirit, with all of the Employer's policies, procedures, rules, handbooks, manuals, codes of conduct, safety rules, and other written or verbal directives, as the same may be adopted, interpreted, applied, modified, supplemented, suspended, or rescinded by the Employer in its sole discretion from time to time and without prior notice, including without limitation policies and rules governing: attendance, punctuality, and timekeeping; workplace conduct, professionalism, and dress; anti-harassment, anti-discrimination, anti-retaliation, and equal employment opportunity; information technology, electronic communications, internet, and acceptable use; data security, privacy, and confidentiality; expense, purchasing, and company-credit-card use; conflicts of interest and outside employment; drug-, alcohol-, and substance-free workplace; health, safety, and the operation of equipment and vehicles; and the protection of the Employer's property and Confidential Information. The Employee acknowledges and agrees that: (a) the Employer's policies, handbooks, and procedures are guidelines maintained for the orderly operation of the business and the convenience of the Employer, are not intended to and do not create a contract of employment, a promise of continued employment, or any contractual right, may be applied and enforced at the Employer's discretion as the circumstances warrant, and do not alter the at-will relationship described in Section 3; (b) the Employee has received, or has been afforded a full and fair opportunity to request, review, and ask questions about, all applicable policies, and is responsible for remaining current with policies as they are updated; and (c) any violation of, or failure to comply with, any policy, procedure, rule, or directive, or any act of dishonesty, insubordination, or misconduct, may result in corrective or disciplinary action, up to and including immediate termination of employment, in addition to any other remedy, recovery, or relief available to the Employer under this Agreement, the Employer's policies, or applicable law. The Employee further agrees to cooperate fully and truthfully in any internal investigation, audit, or inquiry conducted by or on behalf of the Employer. In the event of any conflict or inconsistency between a policy and this Agreement, this Agreement shall control unless the policy expressly states otherwise or applicable law requires otherwise.</p>
    <p><strong>8. Company Credit Card &amp; Purchasing Authorization.</strong> The Employer may, at its sole discretion, authorize the Employee to make purchases on a company-issued credit card, procurement card, or approved vendor account for legitimate, work-related expenses. Such authority is conditioned on the following: (a) <em>Prior approval</em> — all purchases exceeding limits set by the Employer must receive prior written or electronic approval from the Employee's supervisor or an authorized approver before the transaction is made; (b) <em>Business purpose only</em> — the card and any company funds shall be used exclusively for bona fide business purposes and never for personal, family, or household expenses; (c) <em>Receipts &amp; documentation</em> — the Employee shall retain and submit an itemized receipt and a business-purpose justification for every transaction within five (5) business days, through the Employer's expense management system; (d) <em>Spending limits</em> — the Employee shall not exceed any per-transaction, daily, or monthly limit assigned to them, nor circumvent limits by splitting transactions; (e) <em>Prohibited uses</em> — cash advances, gift cards, alcohol (unless pre-approved for a qualifying event), and any purchase prohibited by Employer policy are not permitted. The Employee acknowledges that unauthorized, undocumented, or personal charges may be deducted from wages to the fullest extent permitted by applicable law, and may result in revocation of purchasing privileges and disciplinary action up to and including termination. The card remains the property of the Employer and must be surrendered immediately upon request or termination.</p>
    <p><strong>9. Expense Reimbursement.</strong> The Employer will reimburse the Employee for reasonable, necessary, and pre-approved out-of-pocket business expenses incurred in the performance of their duties, provided the Employee submits a complete expense report with original itemized receipts within thirty (30) days of incurring the expense. Reimbursement is subject to the Employer's then-current expense and travel policies. The Employer reserves the right to deny reimbursement for expenses that are undocumented, lack a clear business purpose, exceed policy limits, or were not properly pre-approved where pre-approval is required.</p>
    <p><strong>10. Work Schedule &amp; Overtime.</strong> The Employee's regular work schedule shall be as assigned by the Employer and may be modified to meet business needs. Non-exempt employees shall be paid overtime in accordance with applicable federal and state wage-and-hour law for hours worked beyond the applicable threshold. The Employee shall accurately record all time worked and shall not perform off-the-clock work. Overtime must be authorized in advance by the Employee's supervisor.</p>
    <p><strong>11. Confidential Information &amp; Non-Disclosure.</strong> In addition to Section 5, the Employee agrees that all client lists, case files, financial records, business methods, pricing, and other proprietary information constitute trade secrets of the Employer. The Employee shall not disclose, copy, or use such information except as required to perform their duties, and these obligations survive termination of employment indefinitely.</p>
    <p><strong>12. Data Security &amp; Acceptable Use.</strong> The Employee shall protect all Employer and client data, use only Employer-approved systems and devices for work, maintain strong credentials, report any suspected security incident immediately, and comply with the Employer's Information Technology Acceptable Use Policy. The Employee shall not store Employer or client data on personal devices or unauthorized cloud services.</p>

    <p><strong>13. Background Investigation &amp; Continued Eligibility.</strong> The Employee acknowledges that, given the sensitive and security-related nature of the Employer's business, their employment is contingent upon the successful completion of, and continued satisfactory results from, a comprehensive background investigation. Such investigation may include, to the fullest extent permitted by applicable law: (a) a criminal history check at the county, state, and federal levels; (b) verification of prior employment, education, and professional references; (c) a credit history review where job-related and legally permissible; (d) verification of identity and authorization to work in the United States (Form I-9 and E-Verify); and (e) periodic re-investigation at intervals determined by the Employer or as required by any client contract, statute, or regulatory authority. The Employee agrees to promptly disclose, in writing, any arrest, charge, citation, conviction, restraining order, license suspension, or other event that could reasonably affect their eligibility to perform their duties or the Employer's standing with its clients, regulators, or insurers, within seventy-two (72) hours of such event. Failure to disclose, or the discovery of disqualifying information, may result in immediate suspension or termination of employment. The Employee authorizes the Employer and its designated agents to obtain and rely upon such information and releases the Employer from any liability arising from a good-faith investigation conducted in accordance with the Fair Credit Reporting Act and applicable state law.</p>

    <p><strong>14. Professional Licensing, Certifications &amp; Training.</strong> The Employee shall obtain and maintain, at all times during their employment and at their own expense unless the Employer agrees otherwise in writing, all licenses, registrations, permits, certifications, and continuing-education requirements necessary to lawfully perform their assigned duties, including without limitation any private investigator, security officer, process server, armed/unarmed guard, or notary credentials required by the jurisdiction(s) in which they operate. The Employee shall provide the Employer with current copies of all such credentials and shall notify the Employer immediately upon any lapse, suspension, revocation, denial, or disciplinary action affecting any credential. The Employee shall not perform any function requiring a credential they do not currently and validly hold. The Employer may, in its discretion, advance or reimburse the cost of required licensing and training; in such event, the Employee agrees that if they voluntarily resign or are terminated for cause within twelve (12) months after the Employer pays for a license, certification, or training program, the prorated cost thereof may be deducted from the Employee's final compensation to the fullest extent permitted by applicable law. Time spent obtaining or renewing credentials outside of compensable working hours is not compensable unless required by law.</p>

    <p><strong>15. Drug-Free &amp; Alcohol-Free Workplace.</strong> The Employer maintains a drug- and alcohol-free workplace. The Employee shall not manufacture, distribute, dispense, possess, use, or be under the influence of any illegal drug, controlled substance (except a lawfully prescribed medication used as directed that does not impair the Employee's ability to safely perform their duties), or alcohol while on Employer or client premises, while operating any Employer vehicle or equipment, or while otherwise performing services for the Employer. The Employee consents to drug and alcohol testing — including pre-employment, reasonable-suspicion, post-incident, random, and return-to-duty testing — administered in accordance with the Employer's policy and applicable law. A confirmed positive test, refusal to test, tampering with a sample, or violation of this Section constitutes grounds for immediate termination. The Employee shall notify their supervisor before performing safety-sensitive duties if they are taking any medication that carries a warning regarding the operation of machinery or vehicles or that may impair judgment, coordination, or alertness.</p>

    <p><strong>16. Conflicts of Interest &amp; Outside Activities.</strong> During employment, the Employee shall devote their professional loyalty to the Employer and shall avoid any activity, investment, interest, or association that conflicts or appears to conflict with the Employer's interests or the Employee's duties. The Employee shall not, without the Employer's prior written consent: (a) engage in any outside business, employment, or consulting that competes with the Employer, interferes with the Employee's duties, or uses the Employer's confidential information, equipment, or relationships; (b) accept any fee, gift, kickback, commission, or other thing of value from any client, vendor, adverse party, or other person in connection with the Employee's duties, beyond nominal courtesies of customary business value; (c) have a financial or familial interest in any vendor, client, or competitor that the Employee can influence on the Employer's behalf; or (d) use the Employer's name, logo, or credentials for any purpose not authorized by the Employer. The Employee shall promptly disclose in writing any actual, potential, or apparent conflict of interest. The Employer may require the Employee to divest, recuse, or cease any conflicting activity.</p>

    <p><strong>17. Non-Solicitation &amp; Restrictive Covenants.</strong> The Employee acknowledges that, in the course of employment, they will acquire confidential information and develop relationships with the Employer's clients, prospects, employees, and contractors that are valuable assets of the Employer. Accordingly, during employment and for a period of twelve (12) months following the termination of employment for any reason, the Employee shall not, directly or indirectly, on their own behalf or on behalf of any other person or entity: (a) solicit, divert, or attempt to solicit or divert any client or prospective client of the Employer with whom the Employee had material contact or about whom the Employee obtained confidential information during the last twenty-four (24) months of employment; (b) solicit, recruit, hire, or attempt to induce any employee, contractor, or agent of the Employer to terminate their relationship with the Employer; or (c) disparage the Employer, its officers, or its services. Each restriction is intended to be reasonable in scope, geography, and duration; if any court finds any restriction overbroad or unenforceable, the parties intend that the restriction be modified (blue-penciled) to the maximum extent enforceable rather than voided. These covenants are in addition to, and do not limit, the confidentiality obligations in Sections 5 and 11. To the extent any restriction in this Section is prohibited or unenforceable for the Employee under applicable state law, that restriction shall not apply.</p>

    <p><strong>18. Intellectual Property &amp; Work-Product Assignment.</strong> The Employee agrees that all reports, investigations, work product, inventions, discoveries, improvements, software, written materials, photographs, recordings, case files, databases, processes, and other materials conceived, developed, created, or reduced to practice by the Employee, alone or with others, within the scope of employment or using the Employer's time, equipment, information, or resources (collectively, "Work Product") are "works made for hire" and the sole and exclusive property of the Employer. To the extent any Work Product does not qualify as a work made for hire, the Employee hereby irrevocably assigns to the Employer all right, title, and interest therein, including all patent, copyright, trademark, trade-secret, and other intellectual-property rights, and waives any moral rights. The Employee shall promptly disclose all Work Product to the Employer and shall, at the Employer's expense, execute any documents and take any actions reasonably necessary to perfect, register, or enforce the Employer's rights, both during and after employment. The Employee shall not incorporate any third-party or pre-existing intellectual property into any Work Product without the Employer's prior written consent and a valid license.</p>

    <p><strong>19. Company Vehicles &amp; Driving.</strong> If the Employee is authorized to operate an Employer-owned, leased, or rented vehicle, or to drive their personal vehicle for Employer business, the Employee shall: (a) maintain a valid driver's license appropriate to the vehicle class and promptly report any suspension, revocation, or restriction; (b) comply with all traffic laws and the Employer's vehicle and safety policies; (c) never operate a vehicle while impaired, fatigued, distracted, or while using a handheld device in violation of law; (d) report any accident, citation, mechanical problem, or damage immediately; and (e) consent to the Employer obtaining and periodically reviewing the Employee's motor-vehicle record. The Employee is responsible for any fines, tolls, citations, or damage resulting from their negligent, reckless, unauthorized, or personal use of a vehicle, which may be deducted from compensation to the extent permitted by law. The Employer's vehicles and any installed telematics, GPS, or dash-camera systems may be monitored; the Employee consents to such monitoring. Personal use of Employer vehicles is prohibited unless expressly authorized in writing.</p>

    <p><strong>20. Workplace Safety &amp; Injury Reporting.</strong> The Employee shall perform all duties in a safe manner, follow all safety rules, use all required personal protective equipment, and immediately report to their supervisor any workplace injury, illness, accident, near-miss, hazard, threat, or unsafe condition, regardless of severity, no later than the end of the shift in which it occurs or is discovered. The Employee shall cooperate fully with any investigation and, where required by the Employer's workers' compensation carrier or applicable law, submit to a post-incident medical examination or drug/alcohol test. The Employee shall not operate any equipment or perform any duty for which they have not been trained and authorized. Failure to timely report a work-related injury may affect the availability of benefits and may constitute grounds for discipline. Nothing in this Section discourages or penalizes the good-faith reporting of injuries, hazards, or safety concerns, and the Employer prohibits retaliation against any Employee for such reporting.</p>

    <p><strong>21. Equal Opportunity, Anti-Harassment &amp; Anti-Retaliation.</strong> The Employer is an equal-opportunity employer and is committed to a workplace free of unlawful discrimination, harassment, and retaliation. The Employer prohibits discrimination or harassment based on race, color, religion, sex, sexual orientation, gender identity, national origin, age, disability, genetic information, veteran status, or any other characteristic protected by federal, state, or local law. The Employee shall treat all coworkers, clients, vendors, and members of the public with respect and professionalism and shall not engage in any conduct that creates an intimidating, hostile, or offensive work environment. The Employee shall promptly report any conduct they believe violates this policy to their supervisor, the HR Manager, or any member of management, and the Employer shall investigate all complaints promptly, impartially, and as confidentially as practicable. The Employer strictly prohibits retaliation against any person who, in good faith, reports a concern, files a complaint, or participates in an investigation. Violation of this Section may result in discipline up to and including termination.</p>

    <p><strong>22. Dispute Resolution.</strong> The parties shall first attempt to resolve any dispute arising out of or relating to this Agreement or the Employee's employment through good-faith informal discussion and, if unresolved, through the Employer's internal grievance process. Any dispute not so resolved shall, to the fullest extent permitted by applicable law, be submitted to final and binding arbitration administered by a neutral arbitrator under the rules of a recognized arbitration body, with each party bearing its own attorneys' fees except as a statute or the arbitrator may otherwise provide, and with the arbitration seated in the county of the Employer's principal place of business. This Section does not waive any non-waivable statutory right, does not preclude either party from seeking provisional injunctive relief in court to protect confidential information or enforce the restrictive covenants in Sections 11 and 17, and does not bar the filing of an administrative charge with any government agency. To the extent class, collective, or representative claims are not lawfully waivable, this Section applies only to the maximum extent permitted by applicable law.</p>

    <p><strong>23. Company Credit Card — Early-Separation Chargeback.</strong> The Employee expressly acknowledges and agrees that, in further consideration of the privilege of using an Employer-issued credit card, procurement card, or approved vendor account (Section 8), the following condition applies if the Employee separates from the Employer — whether by voluntary resignation, involuntary termination with or without cause, abandonment, or otherwise — <strong>within three (3) months of the Employee's start date</strong>: <strong>any and all expenses, charges, fees, interest, and amounts incurred by the Employee on or through any Employer card or account, whether or not such charges were pre-approved, authorized, documented, or for a legitimate business purpose, shall become the personal debt and obligation of the Employee and shall be charged back to the Employee in full.</strong> The Employee agrees that this chargeback applies to the entire amount charged during the Employee's tenure, including charges the Employer would otherwise have absorbed as ordinary business expenses, and that it is a negotiated condition of extending card privileges to a newly hired employee whose long-term commitment to the Employer is unproven. The Employee authorizes the Employer to recover such amounts by deducting them from the Employee's final wages, salary, commissions, accrued and payable leave (where permitted by law), bonuses, expense reimbursements, or any other compensation payable upon separation, to the fullest extent permitted by applicable law. Any balance not recovered through deduction shall be immediately due and payable as a liquidated debt within thirty (30) days of the Employer's written demand, and shall thereafter be subject to the Collections provisions of Section 24. This Section does not limit the Employer's right to recover unauthorized, personal, undocumented, or fraudulent charges at any time regardless of the Employee's length of service.</p>

    <p><strong>24. Collections, Costs of Recovery &amp; Credit Reporting.</strong> The Employee acknowledges that any amount the Employee owes to the Employer — including but not limited to unauthorized or personal credit-card charges, the Section 23 early-separation chargeback, equipment replacement costs and penalties, training or licensing repayment obligations, overpaid wages or advances, and any other debt arising under this Agreement — constitutes a valid, liquidated debt owed to the Employer. If such amount is not paid in full when due, the Employer may, to the fullest extent permitted by applicable law: <strong>(a)</strong> refer the debt to a third-party collection agency or attorney for collection; <strong>(b)</strong> report the delinquent debt to one or more consumer or commercial credit-reporting agencies; <strong>(c)</strong> pursue any civil remedy available, including suit for the principal balance, pre- and post-judgment interest at the maximum lawful rate, and recovery of all costs of collection; and <strong>(d)</strong> set off the debt against any amount the Employer may owe the Employee. <strong>The Employee agrees to pay all reasonable costs of collection incurred by the Employer, including collection-agency fees, court costs, and reasonable attorneys' fees, whether or not suit is filed.</strong> Interest shall accrue on any unpaid balance from the due date at the lesser of one and one-half percent (1.5%) per month or the maximum rate permitted by law. The Employee's obligation to repay any such debt, and the Employer's right to pursue collection, shall survive the termination of employment and this Agreement. Partial payments may be applied first to costs and interest, then to principal, at the Employer's discretion. Nothing in this Section requires the Employer to pursue collection, and the Employer's forbearance on any occasion shall not waive its right to collect on any other occasion.</p>

    <p><strong>25. Wage-Deduction Authorization &amp; Acknowledgment.</strong> The Employee voluntarily and knowingly authorizes the Employer to deduct from the Employee's wages, salary, commissions, bonuses, reimbursements, accrued and payable leave (where permitted), and any final paycheck, the full amount of any debt or obligation owed by the Employee under this Agreement, including the amounts described in Sections 8, 23, and 24, to the fullest extent permitted by applicable federal and state wage-and-hour law. The Employee understands that this authorization is given as a condition of, and in consideration for, employment and the extension of card and purchasing privileges. Where applicable law requires that a deduction not reduce the Employee's pay below the minimum wage or limits the amount that may be withheld from a single paycheck, the Employer will comply with such limits and may recover the remaining balance through subsequent deductions or as a debt under Section 24. The Employee acknowledges receiving a copy of this authorization and that it may be revoked only in writing as to <em>future</em> deductions and does not affect the Employer's right to recover amounts already incurred. This authorization shall remain in effect throughout employment and survive separation as to any amounts then owed.</p>

    <p><strong>26. Federal &amp; Utah Wage-and-Hour Compliance.</strong> All wage payments, deductions, chargebacks, and recoveries under this Agreement shall be administered in compliance with the federal Fair Labor Standards Act ("FLSA") and the Utah Payment of Wages Act, Utah Code Ann. &sect;&sect; 34-28-1 et seq. Specifically: <strong>(a)</strong> no deduction authorized under Sections 8, 23, 24, or 25 shall reduce the Employee's pay below the applicable federal or Utah minimum wage for any workweek, nor shall any deduction be taken from overtime compensation in violation of the FLSA; <strong>(b)</strong> deductions other than those required or specifically permitted by law shall be made only pursuant to the Employee's written authorization in this Agreement, as required by Utah Code Ann. &sect; 34-28-3; <strong>(c)</strong> upon involuntary separation the Employer shall pay all wages then due within twenty-four (24) hours as required by Utah Code Ann. &sect; 34-28-5, and upon voluntary separation by the next regular payday, with any disputed chargeback or debt pursued separately as a civil debt under Section 24 rather than withheld in violation of law; and <strong>(d)</strong> where any provision of this Agreement would, as applied, require a deduction or withholding prohibited by the FLSA or Utah law, that provision shall be deemed automatically modified to the maximum extent lawful, and any shortfall shall be recoverable solely as a debt under Section 24.</p>

    <p><strong>27. Protected Rights; Lawful-Activity Carve-Out.</strong> Nothing in this Agreement — including the confidentiality (Sections 5, 11), non-disparagement (Section 17), data-security (Section 12), arbitration (Section 22), or any other provision — shall be construed to waive, limit, or interfere with any right the Employee has under law that cannot lawfully be waived, including without limitation: <strong>(a)</strong> the right under Section 7 of the National Labor Relations Act to engage in protected concerted activity, including discussing wages, hours, and terms and conditions of employment; <strong>(b)</strong> the right to file a charge or complaint with, provide information to, or participate in an investigation by the Equal Employment Opportunity Commission, the National Labor Relations Board, the Occupational Safety and Health Administration, the U.S. Department of Labor, the Securities and Exchange Commission, the Utah Antidiscrimination and Labor Division, or any other federal, state, or local government agency; <strong>(c)</strong> the right to report possible violations of law, to make disclosures protected under any whistleblower statute, and to receive any whistleblower award; and <strong>(d)</strong> the immunity provided under the federal Defend Trade Secrets Act, 18 U.S.C. &sect; 1833(b), for the confidential disclosure of a trade secret to a government official or attorney solely for the purpose of reporting or investigating a suspected violation of law, or in a sealed court filing. The Employee does not need the Employer's prior authorization to engage in such protected conduct and need not notify the Employer that they have done so. This Section controls over any conflicting provision of this Agreement.</p>

    <p><strong>28. Utah Post-Employment Restrictions Act Compliance.</strong> The restrictive covenants in Section 17 are intended to comply with the Utah Post-Employment Restrictions Act, Utah Code Ann. &sect;&sect; 34-51-101 et seq. To the extent any provision of Section 17 constitutes a "post-employment restrictive covenant" or "covenant not to compete" within the meaning of that Act, its duration shall not exceed one (1) year from the date the Employee is no longer employed by the Employer, consistent with Utah Code Ann. &sect; 34-51-201, and any provision purporting to extend beyond that period shall be automatically reduced to one (1) year. Nothing in Section 17 restricts the Employee's ability to be employed by or compete with the Employer except to the limited extent expressly permitted by Utah law; the client- and employee-non-solicitation and confidentiality obligations are independent protections of the Employer's trade secrets and goodwill and are not intended as a general covenant not to compete. If a court determines that any covenant is unenforceable under the Act, the parties intend that it be reformed to the maximum enforceable extent rather than voided in its entirety.</p>

    <p><strong>29. Electronic Signatures, Counterparts &amp; Records.</strong> The parties agree that this Agreement and any related document may be executed and delivered by electronic signature, and that such electronic signatures are legally valid, binding, and enforceable to the same extent as a handwritten signature under the federal Electronic Signatures in Global and National Commerce Act ("ESIGN"), 15 U.S.C. &sect;&sect; 7001 et seq., and the Utah Uniform Electronic Transactions Act, Utah Code Ann. &sect;&sect; 46-4-101 et seq. The Employee consents to conduct this transaction by electronic means, agrees that an electronic record of this Agreement (including the cryptographic hash and audit log generated by the Employer's system) satisfies any requirement that the Agreement be in writing and signed, and agrees that such electronic record shall be admissible as an original. This Agreement may be executed in counterparts, each of which is deemed an original and all of which together constitute one instrument.</p>

    <p><strong>30. Reservation of Rights, Limitation of Liability &amp; No Waiver.</strong> <strong>(a) At-Will Reaffirmation.</strong> Notwithstanding any other provision, the Employee's employment remains at-will as set forth in Section 3; nothing in this Agreement creates a contract of employment for any definite term, a guarantee of continued employment, or any implied covenant limiting the Employer's right to terminate the employment relationship at any time, with or without cause or notice. <strong>(b) Limitation of Liability.</strong> To the fullest extent permitted by law, the Employer's aggregate liability to the Employee arising out of or relating to this Agreement, other than for amounts of earned but unpaid wages or any liability that may not lawfully be limited, shall not exceed the total compensation paid to the Employee during the three (3) months preceding the event giving rise to the claim, and the Employer shall not be liable for any consequential, incidental, punitive, or exemplary damages. <strong>(c) No Waiver; Cumulative Remedies.</strong> The Employer's failure or delay in enforcing any provision of this Agreement shall not constitute a waiver of that or any other provision or of the Employer's right to enforce it later. All of the Employer's rights and remedies under this Agreement are cumulative and in addition to, not in lieu of, any rights or remedies available at law or in equity. <strong>(d) Successors &amp; Assigns.</strong> This Agreement binds and benefits the Employer's successors and assigns; the Employer may assign this Agreement without the Employee's consent, while the Employee may not assign any obligation hereunder.</p>

    <p><strong>31. Governing Law, Venue &amp; Severability.</strong> This Agreement shall be governed by and construed in accordance with the laws of the State of Utah${esc(employee.state && employee.state.toUpperCase() !== 'UT' ? ' (or the State of ' + employee.state + ' where its law mandatorily applies to the Employee\'s worksite)' : '')}, without regard to its conflict-of-laws principles, and, where applicable, by federal law. Subject to the arbitration provision in Section 22, the parties consent to the exclusive jurisdiction and venue of the state and federal courts located in the county of the Employer's principal place of business in Utah for any action permitted to be brought in court, and waive any objection to such venue. <strong>To the fullest extent permitted by law, each party knowingly and voluntarily waives any right to a trial by jury</strong> in any such action. If any provision of this Agreement is held invalid, unenforceable, or contrary to the FLSA, the Utah Payment of Wages Act, the Utah Post-Employment Restrictions Act, or any other applicable law, that provision shall be reformed and enforced to the maximum extent permitted, or if it cannot be so reformed, severed, and the remaining provisions shall continue in full force and effect. This Agreement, together with the Employer's policies and any other documents referenced herein, constitutes the entire agreement between the parties regarding its subject matter and supersedes all prior oral or written understandings; it may be amended only in a writing signed by the Employer. The Employee acknowledges that they have had the opportunity to review this Agreement, to ask questions, and to seek independent legal counsel before signing.</p>
  </div>

  ${agreementSignatureBlock(empName, companyName, signatures)}

  <div class="footer">
    <p>${companyName} &mdash; Employee Agreement</p>
    <p>${signatures?.employee?.date
      ? `Signed by ${empName} on ${fmtDate(String(signatures.employee.date).length === 10 ? signatures.employee.date + 'T12:00:00' : signatures.employee.date)}`
      : `Generated on ${today}`}</p>
  </div>
</div>
</body>
</html>`;

      return { html };
    } catch (err: any) {
      console.error('Failed to generate employee agreement:', err);
      return { html: '' };
    }
  });


















}

