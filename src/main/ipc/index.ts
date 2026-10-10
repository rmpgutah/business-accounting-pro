import { ipcMain } from 'electron';
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
import { registerPortalTimeDocFeaturesFeat } from './feat/portal-time-doc-features';
import { registerCollabIntegrationFeaturesFeat } from './feat/collab-integration-features';
import { registerInvoicePaymentFeaturesFeat } from './feat/invoice-payment-features';
import { registerExpenseFinanceFeaturesFeat } from './feat/expense-finance-features';
import { registerExpensePolicyCardFeaturesFeat } from './feat/expense-policy-card-features';
import { registerExpenseCustomMobileFeaturesFeat } from './feat/expense-custom-mobile-features';
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
  registerPortalTimeDocFeaturesFeat(ipcMain, deps);
  registerCollabIntegrationFeaturesFeat(ipcMain, deps);

  // Batch S — Payroll deep-dive

  // Batch T — Sales Tax Engine

  // Batch U — Consolidation

  // Batch V — Customer Portal

  // Batch W — Vendor Portal

  // Batch X — Time Tracking

  // Batch Y — Document Intelligence

  // Batch Z — Collaboration

  // Batch AA — Integration Sync

  // ═══════════════════════════════════════════════════════════════
  // FINANCE WAVE: 100 features (F441-F540) — IPC handlers
  // ═══════════════════════════════════════════════════════════════
  registerInvoicePaymentFeaturesFeat(ipcMain, deps);
  registerExpenseFinanceFeaturesFeat(ipcMain, deps);

  // Batch AB — Invoice Advanced

  // Batch AC — Payment Processing

  // Batch AE — Subscriptions

  // Batch AF — Credit & Collections

  // Batch AD — Expense Advanced

  // Batch AG — Financial Analytics

  // Batch AH — Tax & Compliance

  // Batch AI — Vendor Management

  // ═══════════════════════════════════════════════════════════════
  // EXPENSE ADVANCED WAVE: 100 features (F541-F640) — IPC handlers
  // ═══════════════════════════════════════════════════════════════
  registerExpensePolicyCardFeaturesFeat(ipcMain, deps);
  registerExpenseCustomMobileFeaturesFeat(ipcMain, deps);

  // Batch AJ — Policy Engine

  // Batch AK — Templates & Auto-Fill

  // Batch AL — Corporate Card Management

  // Batch AM — Travel

  // Batch AN — Mileage Advanced

  // Batch AO — Custom Fields & Tagging

  // Batch AP — Spend Analytics Advanced

  // Batch AQ — Workflow Customization

  // Batch AR — Mobile & Capture

  // Batch AS — Reports & Year-End

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

