import React, { useEffect, lazy, Suspense } from 'react';
import { useAppStore } from './stores/appStore';
import { useCompanyStore } from './stores/companyStore';
import { useAuthStore } from './stores/authStore';
import api from './lib/api';
import AppShell from './components/layout/AppShell';
import CompanySetup from './components/onboarding/CompanySetup';
import AuthScreen from './components/auth/AuthScreen';
import ErrorBoundary from './components/ErrorBoundary';
import { registerKeyboardShortcuts, MODULE_ORDER } from './lib/keyboard-shortcuts';

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

// ─── Module Name Map ────────────────────────────────────
const MODULE_NAMES: Record<string, string> = {
  dashboard: 'Dashboard',
  accounts: 'Accounts & General Ledger',
  invoicing: 'Invoicing',
  expenses: 'Expenses',
  clients: 'Clients',
  payroll: 'Payroll',
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
      default:
        return (
          <div className="flex items-center justify-center h-full p-6">
            <div className="block-card p-8 text-center" style={{ borderRadius: '2px' }}>
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

  useEffect(() => {
    const init = async () => {
      try {
        // If user just logged in, companies are already set by AuthScreen
        if (companies.length === 0) {
          const list = await api.listCompanies();
          setCompanies(list ?? []);
          if (list && list.length > 0) {
            setActiveCompany(list[0]);
          }
        }
      } catch (err) {
        console.error('Failed to load companies:', err);
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
    </AppShell>
  );
};

export default App;
