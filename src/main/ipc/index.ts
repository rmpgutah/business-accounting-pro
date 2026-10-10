import { ipcMain } from 'electron';
import * as db from '../database';
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
import { registerMiscIpc } from './domains/misc';
import { registerSyncBackupIpc } from './domains/sync-backup';
import { registerAdminSettingsIpc } from './domains/admin-settings';
import { registerWorkflowsAutomationIpc } from './domains/workflows-automation';
import { registerInvoiceExpenseFeaturesFeat } from './feat/invoice-expense-features';
import { registerBankingPayrollFeaturesFeat } from './feat/banking-payroll-features';
import { registerReportsAnalyticsFeaturesFeat } from './feat/reports-analytics-features';
import { registerClientVendorDocFeaturesFeat } from './feat/client-vendor-doc-features';
import { registerAutomationFeaturesFeat } from './feat/automation-features';
import { registerTreasuryFeaturesFeat } from './feat/treasury-features';
import { registerInventoryProjectsFeaturesFeat } from './feat/inventory-projects-features';
import { registerCrmSalesFeaturesFeat } from './feat/crm-sales-features';
import { registerComplianceSecurityFeaturesFeat } from './feat/compliance-security-features';
import { registerAccountingGlFeaturesFeat } from './feat/accounting-gl-features';
import { registerAccountingAnalyticsFeaturesFeat } from './feat/accounting-analytics-features';
import { registerDynamicSearchBulkFeaturesFeat } from './feat/dynamic-search-bulk-features';
import { registerDynamicPowerFeaturesFeat } from './feat/dynamic-power-features';
import { registerPayrollTaxConsolidationFeaturesFeat } from './feat/payroll-tax-consolidation-features';
import { registerLoanIpc } from './loans';
import { registerExpenseDebtIpc } from './expense-debt';
import { registerHrPortalIpc } from './hr-portal';
import { registerEquipmentAssessmentIpc } from './equipment-assessment';
import { registerDebtWaveIpc } from './debt-wave';
import { registerTaxIpc } from './tax';
import { registerComplianceIpc } from './compliance';
import { registerPayrollWaveIpc } from './payroll-wave';
import { bootstrapBuiltinCommands } from '../services/CommandRegistry';
import { eventBus } from '../services/EventBus';
import { workflowEngine } from '../services/WorkflowEngine';









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
    scheduleAutoBackup, findClosedPeriod, eu,
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
  registerInvoiceExpenseFeaturesFeat(ipcMain, deps);
  ipcMain.handle('feat:expense:bulk-recategorize', (_e, { expense_ids, category_id }: any) => { const r = eu().bulkRecategorize(expense_ids || [], category_id); scheduleAutoBackup(); return r; });

  // ─── Batch 3: Banking & Payroll features (15) ─────────────────
  registerBankingPayrollFeaturesFeat(ipcMain, deps);

  // ─── Batch 4: Reports & Analytics features (10) ───────────────
  registerReportsAnalyticsFeaturesFeat(ipcMain, deps);

  // ─── Batch 5: Client/Vendor/Document features (10) ───────────
  registerClientVendorDocFeaturesFeat(ipcMain, deps);

  // ─── Batch 6: Automation & Workflow Engine (20) ───────────
  registerAutomationFeaturesFeat(ipcMain, deps);
  // Workflows
  // Scheduled tasks
  // Approval chains
  // Email templates
  // Webhooks
  // Auto-categorize
  // Auto-archive
  // Triggered actions log
  // SLAs
  // Saved searches
  // Bulk ops audit
  // Quick actions (dashboard shortcuts)

  // ─── Batch 7: Banking, Treasury, Multi-Currency (20) ───────────
  registerTreasuryFeaturesFeat(ipcMain, deps);
  // F91 cash position
  // F92 cash forecast
  // F93 FX rates
  // F94 FX revaluation
  // F96 wire transfers
  // F97 ACH batches
  // F98 bank fee categorization
  // F99 bank match log
  // F100 stop payments
  // F101 pending deposits
  // F102 petty cash
  // F103 treasury investments
  // F104 letters of credit
  // F105 loan covenants
  // F106 sweep rules
  // F107 inter-company transfers
  // F108 credit card statements
  // F109 lockbox imports
  // F110 positive pay

  // ─── Batch 8: Inventory, Projects, Time (20) ───────────
  registerInventoryProjectsFeaturesFeat(ipcMain, deps);
  // F111 warehouses
  // F112 locations
  // F113 lots
  // F114 serials
  // F115 transfers
  // F116 adjustments
  // F117 stock takes
  // F118 low stock alerts
  // F119 valuation methods
  // F120 inventory value history
  // F121 project tasks
  // F122 milestones
  // F123 resources
  // F124 project budgets
  // F125 risks
  // F126 change orders
  // F127 timesheet periods
  // F128 timesheet approvals
  // F129 billable summary
  // F130 profitability

  // ─── Batch 9: CRM, Sales, Quotes (20) ───────────
  registerCrmSalesFeaturesFeat(ipcMain, deps);
  // F131 stages
  // F132 deals
  // F133 activities
  // F134 targets
  // F135 performance snapshots
  // F136 lead forms
  // F137 scoring rules
  // F138 routing rules
  // F139 territories
  // F140 commission plans
  // F141 commission calcs
  // F142 discount rules
  // F143 promo codes
  // F144 loyalty
  // F145 referrals
  // F146 quote templates
  // F147 quote conversion
  // F148 quote signatures
  // F149 RFP tracking
  // F150 win/loss

  // ─── Batch 10: Compliance, Security, API (20) ───────────
  registerComplianceSecurityFeaturesFeat(ipcMain, deps);
  // F151 retention
  // F152 DSR
  // F153 anonymize
  // F154 audit
  // F155 sessions
  // F156 whitelist
  // F157 2FA
  // F158 API tokens
  // F159 rate limits + request log
  // F160 webhook rotation
  // F161 PCI
  // F162 SOC 2
  // F163 masking
  // F164 RTBF
  // F165 consent
  // F166 sub-processors
  // F167 data classifications
  // F168 encryption verification
  // F169 backup verification
  // F170 vulnerabilities

  // ═══════════════════════════════════════════════════════════════
  // ACCOUNTING DEEP-DIVE: 90 features (F171-F260) — IPC handlers
  // ═══════════════════════════════════════════════════════════════
  registerAccountingGlFeaturesFeat(ipcMain, deps);
  registerAccountingAnalyticsFeaturesFeat(ipcMain, deps);

  // ─── Batch A: GL & JE Operations ───

  // ─── Batch B: Chart of Accounts ───

  // ─── Batch C: Period Close + Adjustments ───

  // ─── Batch D: Fixed Assets Advanced ───

  // ─── Batch E: Revenue Recognition ───

  // ─── Batch F: Cost Accounting ───

  // ─── Batch G: Audit & Controls ───

  // ─── Batch H: Budgeting & Forecasting Advanced ───

  // ─── Batch I: Financial Statements + Analysis ───

  // ═══════════════════════════════════════════════════════════════
  // DYNAMIC WAVE: 90 runtime functions (F261-F350) — IPC handlers
  // ═══════════════════════════════════════════════════════════════
  registerDynamicSearchBulkFeaturesFeat(ipcMain, deps);
  registerDynamicPowerFeaturesFeat(ipcMain, deps);

  // ─── Batch J: Global Search (F261-F270) ───

  // ─── Batch K: Notifications & Alerts (F271-F280) ───

  // ─── Batch L: Import / Export (F281-F290) ───

  // ─── Batch M: Bulk Actions (F291-F300) ───

  // ─── Batch N: Smart Helpers (F301-F310) ───

  // ─── Batch O: Keyboard & Macros (F311-F320) ───

  // ─── Batch P: Report Engine (F321-F330) ───

  // ─── Batch Q: Webhook Delivery (F331-F340) ───

  // ─── Batch R: Real-time + Activity (F341-F350) ───

  // ═══════════════════════════════════════════════════════════════
  // WAVE 3: 90 features (F351-F440) — IPC handlers
  // ═══════════════════════════════════════════════════════════════
  registerPayrollTaxConsolidationFeaturesFeat(ipcMain, deps);
  const ptd = () => require('../services/portal-time-doc-features');
  const ci = () => require('../services/collab-integration-features');

  // Batch S — Payroll deep-dive

  // Batch T — Sales Tax Engine

  // Batch U — Consolidation

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





















  registerMiscIpc(ipcMain, deps);




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




















































































  registerSyncBackupIpc(ipcMain, deps);




































































































}

