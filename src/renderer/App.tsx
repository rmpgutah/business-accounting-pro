import React, { useEffect } from 'react';
import { useAppStore } from './stores/appStore';
import { useCompanyStore } from './stores/companyStore';
import api from './lib/api';
import AppShell from './components/layout/AppShell';
import CompanySetup from './components/onboarding/CompanySetup';
import Dashboard from './modules/dashboard/Dashboard';

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
};

// ─── Module Placeholder ─────────────────────────────────
const ModulePlaceholder: React.FC<{ moduleId: string }> = ({ moduleId }) => {
  const name = MODULE_NAMES[moduleId] ?? moduleId;
  return (
    <div className="flex items-center justify-center h-full p-6">
      <div
        className="block-card p-8 text-center"
        style={{ borderRadius: '2px' }}
      >
        <h2 className="text-lg font-bold text-text-primary mb-1">{name}</h2>
        <p className="text-sm text-text-muted">This module is coming soon.</p>
      </div>
    </div>
  );
};

// ─── Module Router ──────────────────────────────────────
const ModuleView: React.FC = () => {
  const { currentModule } = useAppStore();

  switch (currentModule) {
    case 'dashboard':
      return <Dashboard />;
    default:
      return <ModulePlaceholder moduleId={currentModule} />;
  }
};

// ─── App ────────────────────────────────────────────────
const App: React.FC = () => {
  const { loading, setLoading } = useAppStore();
  const { companies, setCompanies, setActiveCompany } = useCompanyStore();

  useEffect(() => {
    const init = async () => {
      try {
        const list = await api.listCompanies();
        setCompanies(list ?? []);

        if (list && list.length > 0) {
          setActiveCompany(list[0]);
        }
      } catch (err) {
        console.error('Failed to load companies:', err);
        setCompanies([]);
      } finally {
        setLoading(false);
      }
    };

    init();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-bg-primary">
        <div className="text-text-muted text-sm font-mono">Loading...</div>
      </div>
    );
  }

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
