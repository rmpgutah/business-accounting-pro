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
import { registerExpenseUpgradesFeaturesFeat } from './feat/expense-upgrades-features';
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
  const { findClosedPeriod } = deps;

  bootstrapBuiltinCommands();
  void eventBus;
  workflowEngine.start();

  registerStripeIpc(ipcMain);

  registerEntityGraphIpc(ipcMain);

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

  // Test hook: throws if `date` falls in a closed accounting period.
  (registerIpcHandlers as any).__assertNotInClosedPeriod = (companyId: string, date: string) => {
    const period = findClosedPeriod(companyId, date);
    if (period) {
      throw new Error(
        'This action is blocked: ' +
          date +
          ' falls in a closed accounting period (' +
          period.period_start +
          ' to ' +
          period.period_end +
          (period.close_reason ? ' · ' + period.close_reason : '') +
          '). Reopen the period in Settings to make changes.',
      );
    }
  };

  registerTaxIpc(ipcMain);

  registerComplianceIpc(ipcMain);

  registerAuthCompanyIpc(ipcMain, deps);

  registerInvoiceExpenseFeaturesFeat(ipcMain, deps);
  registerExpenseUpgradesFeaturesFeat(ipcMain, deps);

  registerBankingPayrollFeaturesFeat(ipcMain, deps);

  registerReportsAnalyticsFeaturesFeat(ipcMain, deps);

  registerClientVendorDocFeaturesFeat(ipcMain, deps);

  registerAutomationFeaturesFeat(ipcMain, deps);

  registerTreasuryFeaturesFeat(ipcMain, deps);

  registerInventoryProjectsFeaturesFeat(ipcMain, deps);

  registerCrmSalesFeaturesFeat(ipcMain, deps);

  registerComplianceSecurityFeaturesFeat(ipcMain, deps);

  registerAccountingGlFeaturesFeat(ipcMain, deps);
  registerAccountingAnalyticsFeaturesFeat(ipcMain, deps);

  registerDynamicSearchBulkFeaturesFeat(ipcMain, deps);
  registerDynamicPowerFeaturesFeat(ipcMain, deps);

  registerPayrollTaxConsolidationFeaturesFeat(ipcMain, deps);
  registerPortalTimeDocFeaturesFeat(ipcMain, deps);
  registerCollabIntegrationFeaturesFeat(ipcMain, deps);

  registerInvoicePaymentFeaturesFeat(ipcMain, deps);
  registerExpenseFinanceFeaturesFeat(ipcMain, deps);

  registerExpensePolicyCardFeaturesFeat(ipcMain, deps);
  registerExpenseCustomMobileFeaturesFeat(ipcMain, deps);

  registerPayrollWaveIpc(ipcMain);

  registerReportsIpc(ipcMain, deps);

  registerInvoicesIpc(ipcMain, deps);

  registerExpensesIpc(ipcMain, deps);

  registerLoansAdvancedIpc(ipcMain, deps);

  registerPrintPdfIpc(ipcMain, deps);

  registerMiscIpc(ipcMain, deps);

  registerDebtCollectionIpc(ipcMain, deps);

  registerSyncBackupIpc(ipcMain, deps);
}
