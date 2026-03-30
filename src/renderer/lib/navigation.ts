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
};

// Navigate to a module with optional context
export function useNavigation() {
  const setModule = useAppStore((s) => s.setModule);

  return {
    goTo: (module: string) => setModule(module),
    goToClient: (clientId: string) => {
      sessionStorage.setItem('nav:clientId', clientId);
      setModule('clients');
    },
    goToInvoice: (invoiceId: string) => {
      sessionStorage.setItem('nav:invoiceId', invoiceId);
      setModule('invoicing');
    },
    goToProject: (projectId: string) => {
      sessionStorage.setItem('nav:projectId', projectId);
      setModule('projects');
    },
    goToExpense: (expenseId: string) => {
      sessionStorage.setItem('nav:expenseId', expenseId);
      setModule('expenses');
    },
    goToBudget: (budgetId: string) => {
      sessionStorage.setItem('nav:budgetId', budgetId);
      setModule('budgets');
    },
    goToBankAccount: (bankAccountId: string) => {
      sessionStorage.setItem('nav:bankAccountId', bankAccountId);
      setModule('banking');
    },
    // Navigate to an entity by type and id (used by notifications)
    goToEntity: (entityType: string, entityId: string) => {
      const module = entityModuleMap[entityType];
      if (!module) {
        setModule('dashboard');
        return;
      }
      // Store the entity ID for the target module to pick up
      const paramKey = entityType.replace(/s$/, '') + 'Id';
      sessionStorage.setItem(`nav:${paramKey}`, entityId);
      setModule(module);
    },
    getNavParam: (key: string): string | null => {
      const val = sessionStorage.getItem(`nav:${key}`);
      if (val) sessionStorage.removeItem(`nav:${key}`);
      return val;
    },
  };
}
