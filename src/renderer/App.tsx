import React, { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import { useAppStore } from './stores/appStore';
import { useCompanyStore } from './stores/companyStore';
import { useAuthStore } from './stores/authStore';
import api from './lib/api';
import AppShell from './components/layout/AppShell';
import CompanySetup from './components/onboarding/CompanySetup';
import AuthScreen from './components/auth/AuthScreen';
import ErrorBoundary from './components/ErrorBoundary';
import { registerKeyboardShortcuts, MODULE_ORDER } from './lib/keyboard-shortcuts';
import { QuickCreate } from './components/QuickCreate';

// ─── Lazy-loaded Modules ─────────────────────────────────
const Dashboard = lazy(() => import('./modules/dashboard/Dashboard'));
const AccountsModule = lazy(() => import('./modules/accounts'));
const InvoicingModule = lazy(() => import('./modules/invoices'));
const ExpensesModule = lazy(() => import('./modules/expenses'));
const ClientsModule = lazy(() => import('./modules/clients'));
const PayrollModule = lazy(() => import('./modules/payroll'));
const TimeTracking = lazy(() => import('./modules/time'));
const ProjectsModule = lazy(() => import('./modules/projects'));
const InventoryModule = lazy(() => import('./modules/inventory'));
const TaxesModule = lazy(() => import('./modules/taxes'));
const BudgetsModule = lazy(() => import('./modules/budgets'));
const BankReconModule = lazy(() => import('./modules/bank-recon'));
const StripeModule = lazy(() => import('./modules/stripe'));
const ReportsModule = lazy(() => import('./modules/reports'));
const KpiModule = lazy(() => import('./modules/kpi'));
const ForecastingModule = lazy(() => import('./modules/forecasting'));
const CustomReportsModule = lazy(() => import('./modules/custom-reports'));
const DocumentsModule = lazy(() => import('./modules/documents'));
const RecurringModule = lazy(() => import('./modules/recurring'));
const EmailModule = lazy(() => import('./modules/email'));
const NotificationsModule = lazy(() => import('./modules/notifications'));
const AuditModule = lazy(() => import('./modules/audit'));
const MultiCompanyModule = lazy(() => import('./modules/multi-company'));
const ApiModule = lazy(() => import('./modules/api'));
const PortalModule = lazy(() => import('./modules/portal'));
const MobileModule = lazy(() => import('./modules/mobile'));
const SettingsModule = lazy(() => import('./modules/settings'));
const BillsModule = lazy(() => import('./modules/bills'));
const PurchaseOrdersModule = lazy(() => import('./modules/purchase-orders'));
const FixedAssetsModule = lazy(() => import('./modules/fixed-assets'));
const AutomationsModule = lazy(() => import('./modules/automations'));
const RulesModule = lazy(() => import('./modules/rules'));
const DebtCollectionModule = lazy(() => import('./modules/debt-collection'));
const QuotesModule = lazy(() => import('./modules/quotes'));

// ─── Module Name Map ────────────────────────────────────
const MODULE_NAMES: Record<string, string> = {
  dashboard: 'Dashboard',
  accounts: 'Accounts & General Ledger',
  invoicing: 'Invoicing',
  expenses: 'Expenses',
  clients: 'Clients',
  payroll: 'Employee',
  'time-tracking': 'Time Tracking',
  projects: 'Projects',
  inventory: 'Inventory',
  taxes: 'Taxes',
  budgets: 'Budgets',
  'bank-recon': 'Bank Reconciliation',
  'stripe-sync': 'Stripe Sync',
  reports: 'Reports',
  'kpi-dashboard': 'KPI Dashboard',
  forecasting: 'Forecasting',
  'report-builder': 'Custom Report Builder',
  documents: 'Documents',
  recurring: 'Recurring Transactions',
  email: 'Email',
  notifications: 'Notifications',
  'audit-trail': 'Audit Trail',
  companies: 'Multi-Company',
  'api-integrations': 'API & Integrations',
  'client-portal': 'Client Portal',
  mobile: 'Mobile',
  settings: 'Settings',
  bills: 'Bills & Accounts Payable',
  'purchase-orders': 'Purchase Orders',
  'fixed-assets': 'Fixed Assets',
  'debt-collection': 'Debt Collection',
  quotes: 'Quotes & Estimates',
  automations: 'Automations',
  rules: 'Approval Rules',
};

// ─── Loading Fallback ────────────────────────────────────
const ModuleLoading = () => (
  <div className="flex items-center justify-center h-64">
    <div className="text-text-muted text-sm font-mono">Loading module...</div>
  </div>
);

// ─── Module Router ──────────────────────────────────────
const ModuleView: React.FC = () => {
  const currentModule = useAppStore((s) => s.currentModule);

  const renderModule = () => {
    switch (currentModule) {
      case 'dashboard': return <Dashboard />;
      case 'accounts': return <AccountsModule />;
      case 'invoicing': return <InvoicingModule />;
      case 'expenses': return <ExpensesModule />;
      case 'clients': return <ClientsModule />;
      case 'payroll': return <PayrollModule />;
      case 'time-tracking': return <TimeTracking />;
      case 'projects': return <ProjectsModule />;
      case 'inventory': return <InventoryModule />;
      case 'taxes': return <TaxesModule />;
      case 'budgets': return <BudgetsModule />;
      case 'bank-recon': return <BankReconModule />;
      case 'stripe-sync': return <StripeModule />;
      case 'reports': return <ReportsModule />;
      case 'kpi-dashboard': return <KpiModule />;
      case 'forecasting': return <ForecastingModule />;
      case 'report-builder': return <CustomReportsModule />;
      case 'documents': return <DocumentsModule />;
      case 'recurring': return <RecurringModule />;
      case 'email': return <EmailModule />;
      case 'notifications': return <NotificationsModule />;
      case 'audit-trail': return <AuditModule />;
      case 'companies': return <MultiCompanyModule />;
      case 'api-integrations': return <ApiModule />;
      case 'client-portal': return <PortalModule />;
      case 'mobile': return <MobileModule />;
      case 'settings': return <SettingsModule />;
      case 'bills': return <BillsModule />;
      case 'purchase-orders': return <PurchaseOrdersModule />;
      case 'fixed-assets': return <FixedAssetsModule />;
      case 'automations': return <AutomationsModule />;
      case 'rules': return <RulesModule />;
      case 'debt-collection': return <DebtCollectionModule />;
      case 'quotes': return <QuotesModule />;
      default:
        return (
          <div className="flex items-center justify-center h-full p-6">
            <div className="block-card p-8 text-center" style={{ borderRadius: '6px' }}>
              <h2 className="text-lg font-bold text-text-primary mb-1">
                {MODULE_NAMES[currentModule] ?? currentModule}
              </h2>
              <p className="text-sm text-text-muted">Module loading...</p>
            </div>
          </div>
        );
    }
  };

  return (
    <ErrorBoundary key={currentModule}>
      <Suspense fallback={<ModuleLoading />}>
        {renderModule()}
      </Suspense>
    </ErrorBoundary>
  );
};

// ─── App ────────────────────────────────────────────────
const App: React.FC = () => {
  const loading = useAppStore((s) => s.loading);
  const setLoading = useAppStore((s) => s.setLoading);
  const setModule = useAppStore((s) => s.setModule);
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const currentModule = useAppStore((s) => s.currentModule);
  const companies = useCompanyStore((s) => s.companies);
  const setCompanies = useCompanyStore((s) => s.setCompanies);
  const setActiveCompany = useCompanyStore((s) => s.setActiveCompany);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const authUser = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const [quickCreateOpen, setQuickCreateOpen] = useState(false);

  // Stable handlers so QuickCreate doesn't re-render on every parent render.
  const handleQuickCreateNavigate = useCallback(
    (view: string) => setModule(view as any),
    [setModule]
  );
  const handleQuickCreateClose = useCallback(() => setQuickCreateOpen(false), []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setQuickCreateOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        // If not authenticated, just finish loading — AuthScreen will show
        if (!isAuthenticated) {
          setLoading(false);
          return;
        }

        // Load companies from DB (never trust persisted store)
        const list = await api.listCompanies();
        const validList = Array.isArray(list) ? list : [];
        setCompanies(validList);
        if (validList.length > 0) {
          setActiveCompany(validList[0]);
          api.switchCompany(validList[0].id).catch(() => {});
          // Seed defaults only for active company on boot. Other companies
          // get seeded lazily when they become active. This avoids an N-call
          // burst on launch for users with many companies.
          api.categoriesSeedDefaults(validList[0].id).catch(() => {});
        }
      } catch (err) {
        console.error('Failed to initialize:', err);
        setCompanies([]);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [isAuthenticated]);

  // ─── Global Keyboard Shortcuts ──────────────────────────
  useEffect(() => {
    const cleanup = registerKeyboardShortcuts({
      newItem: () => {
        // Dispatch a custom event that modules can listen for
        window.dispatchEvent(new CustomEvent('app:new-item', { detail: { module: currentModule } }));
      },
      exportView: () => {
        // Export current module's data
        const tableMap: Record<string, string> = {
          invoicing: 'invoices',
          expenses: 'expenses',
          clients: 'clients',
          accounts: 'accounts',
          projects: 'projects',
          payroll: 'employees',
          'debt-collection': 'debts',
        };
        const table = tableMap[currentModule];
        if (table) api.exportCsv(table);
      },
      focusSearch: () => {
        setSearchOpen(true);
      },
      switchModule: (index: number) => {
        if (index < MODULE_ORDER.length) {
          setModule(MODULE_ORDER[index]);
        }
      },
      openSettings: () => {
        setModule('settings');
      },
    });

    return cleanup;
  }, [currentModule, setModule, setSearchOpen]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-bg-primary">
        <div className="text-text-muted text-sm font-mono">Loading...</div>
      </div>
    );
  }

  // Auth gate — show login/register if not authenticated
  if (!isAuthenticated) {
    return <AuthScreen />;
  }

  // Company setup — show if user has no companies yet
  if (companies.length === 0) {
    return <CompanySetup />;
  }

  return (
    <AppShell>
      <ModuleView />
      {quickCreateOpen && (
        <QuickCreate
          onNavigate={handleQuickCreateNavigate}
          onClose={handleQuickCreateClose}
        />
      )}
    </AppShell>
  );
};

export default App;
