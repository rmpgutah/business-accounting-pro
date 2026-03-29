import { useAppStore } from '../stores/appStore';

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
    getNavParam: (key: string): string | null => {
      const val = sessionStorage.getItem(`nav:${key}`);
      if (val) sessionStorage.removeItem(`nav:${key}`);
      return val;
    },
  };
}
