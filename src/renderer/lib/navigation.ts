import { useAppStore } from '../stores/appStore';

// ─── Entity Type to Module Mapping ──────────────────────
const entityModuleMap: Record<string, string> = {
  invoice: 'invoicing',
  invoices: 'invoicing',
  expense: 'expenses',
  expenses: 'expenses',
  client: 'clients',
  clients: 'clients',
  project: 'projects',
  projects: 'projects',
  budget: 'budgets',
  budgets: 'budgets',
  bank_account: 'banking',
  bank_accounts: 'banking',
  recurring_templates: 'recurring',
  payment: 'invoicing',
  payments: 'invoicing',
  vendor: 'vendors',
  vendors: 'vendors',
  employee: 'payroll',
  employees: 'payroll',
  debt: 'debt-collection',
  debts: 'debt-collection',
};

// In-memory navigation params (never persisted to storage)
const navParams = new Map<string, string>();

// Navigate to a module with optional context
export function useNavigation() {
  const setModule = useAppStore((s) => s.setModule);

  return {
    goTo: (module: string) => setModule(module),
    goToClient: (clientId: string) => {
      navParams.set('clientId', clientId);
      setModule('clients');
    },
    goToInvoice: (invoiceId: string) => {
      navParams.set('invoiceId', invoiceId);
      setModule('invoicing');
    },
    goToProject: (projectId: string) => {
      navParams.set('projectId', projectId);
      setModule('projects');
    },
    goToExpense: (expenseId: string) => {
      navParams.set('expenseId', expenseId);
      setModule('expenses');
    },
    goToBudget: (budgetId: string) => {
      navParams.set('budgetId', budgetId);
      setModule('budgets');
    },
    goToBankAccount: (id: string) => {
      navParams.set('bankId', id);
      setModule('banking');
    },
    goToVendor: (vendorId: string) => {
      navParams.set('vendorId', vendorId);
      setModule('vendors');
    },
    goToEmployee: (employeeId: string) => {
      navParams.set('employeeId', employeeId);
      setModule('payroll');
    },
    goToDebt: (debtId: string) => {
      navParams.set('debtId', debtId);
      setModule('debt-collection');
    },
    // Navigate to an entity by type and id (used by notifications)
    goToEntity: (entityType: string, entityId: string) => {
      const module = entityModuleMap[entityType];
      if (!module) {
        setModule('dashboard');
        return;
      }
      const paramKey = entityType.replace(/s$/, '') + 'Id';
      navParams.set(paramKey, entityId);
      setModule(module);
    },
    getNavParam: (key: string): string | null => {
      const val = navParams.get(key) ?? null;
      if (val) navParams.delete(key);
      return val;
    },
  };
}
