// src/main/services/CommandRegistry.ts
// Registry of executable commands surfaced via Cmd+K palette.

export interface CommandParam {
  name: string;
  type: 'string' | 'number' | 'date' | 'entity';
  entityType?: string;
  required?: boolean;
}

export interface CommandDef {
  id: string;
  module: string;
  label: string;
  description?: string;
  keywords?: string[];
  params?: CommandParam[];
  scope?: 'global' | 'module' | 'view';
  executor?: (params: Record<string, any>) => Promise<{ navigate?: { module: string; entityId?: string }; result?: any; error?: string }>;
}

class CommandRegistry {
  private commands: Map<string, CommandDef> = new Map();

  register(cmd: CommandDef) {
    this.commands.set(cmd.id, cmd);
  }

  get(id: string): CommandDef | undefined {
    return this.commands.get(id);
  }

  search(query: string): CommandDef[] {
    if (!query.trim()) return Array.from(this.commands.values()).slice(0, 20);
    const q = query.toLowerCase();
    return Array.from(this.commands.values())
      .map(cmd => {
        const labelMatch = cmd.label.toLowerCase().indexOf(q);
        const idMatch = cmd.id.toLowerCase().indexOf(q);
        const kwMatch = (cmd.keywords || []).some(k => k.toLowerCase().includes(q));
        const score = labelMatch >= 0 ? 100 - labelMatch
                    : idMatch >= 0 ? 50 - idMatch
                    : kwMatch ? 30
                    : -1;
        return { cmd, score };
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(x => x.cmd)
      .slice(0, 30);
  }

  all(): CommandDef[] {
    return Array.from(this.commands.values());
  }
}

export const commandRegistry = new CommandRegistry();

export function bootstrapBuiltinCommands() {
  commandRegistry.register({ id: 'invoice.create', module: 'invoices', label: 'Create New Invoice', keywords: ['new', 'invoice', 'bill'], scope: 'global' });
  commandRegistry.register({ id: 'expense.create', module: 'expenses', label: 'Create New Expense', keywords: ['new', 'expense', 'cost'], scope: 'global' });
  commandRegistry.register({ id: 'quote.create', module: 'quotes', label: 'Create New Quote', keywords: ['new', 'quote', 'estimate'], scope: 'global' });
  commandRegistry.register({ id: 'client.create', module: 'clients', label: 'Add Client', keywords: ['new', 'client', 'customer'], scope: 'global' });
  commandRegistry.register({ id: 'payroll.run', module: 'payroll', label: 'Run Payroll', keywords: ['payroll', 'pay', 'process'], scope: 'global' });
  commandRegistry.register({ id: 'reports.profit-loss', module: 'reports', label: 'Open Profit & Loss', keywords: ['p&l', 'pl', 'income', 'profit'], scope: 'global' });
  commandRegistry.register({ id: 'reports.balance-sheet', module: 'reports', label: 'Open Balance Sheet', keywords: ['balance', 'bs', 'sheet'], scope: 'global' });
  commandRegistry.register({ id: 'reports.cash-flow', module: 'reports', label: 'Open Cash Flow Statement', keywords: ['cash', 'cf', 'flow'], scope: 'global' });
  commandRegistry.register({ id: 'tax.dashboard', module: 'taxes', label: 'Open Tax Dashboard', keywords: ['tax', 'taxes', 'irs'], scope: 'global' });
  commandRegistry.register({ id: 'debt.dashboard', module: 'debt-collection', label: 'Open Collections Dashboard', keywords: ['debt', 'collections', 'collect'], scope: 'global' });
  // Module navigation
  commandRegistry.register({ id: 'goto.dashboard', module: 'dashboard', label: 'Go to Dashboard', keywords: ['home', 'dashboard'], scope: 'global' });
  commandRegistry.register({ id: 'goto.accounts', module: 'accounts', label: 'Go to Accounts & GL', keywords: ['accounts', 'gl', 'ledger'], scope: 'global' });
  commandRegistry.register({ id: 'goto.bills', module: 'bills', label: 'Go to Bills (AP)', keywords: ['bills', 'ap'], scope: 'global' });
  commandRegistry.register({ id: 'goto.budgets', module: 'budgets', label: 'Go to Budgets', keywords: ['budgets'], scope: 'global' });
  commandRegistry.register({ id: 'goto.settings', module: 'settings', label: 'Open Settings', keywords: ['settings', 'preferences'], scope: 'global' });
  commandRegistry.register({ id: 'goto.recurring', module: 'recurring', label: 'Go to Recurring Transactions', keywords: ['recurring', 'subscription'], scope: 'global' });
  commandRegistry.register({ id: 'goto.projects', module: 'projects', label: 'Go to Projects', keywords: ['projects', 'job'], scope: 'global' });
  commandRegistry.register({ id: 'goto.time', module: 'time-tracking', label: 'Go to Time Tracking', keywords: ['time', 'timer', 'log hours'], scope: 'global' });
  commandRegistry.register({ id: 'goto.inventory', module: 'inventory', label: 'Go to Inventory', keywords: ['inventory', 'stock'], scope: 'global' });
  commandRegistry.register({ id: 'goto.fixed-assets', module: 'fixed-assets', label: 'Go to Fixed Assets', keywords: ['fixed', 'assets', 'depreciation'], scope: 'global' });
  commandRegistry.register({ id: 'goto.bank-recon', module: 'bank-recon', label: 'Go to Bank Reconciliation', keywords: ['bank', 'reconcile', 'recon'], scope: 'global' });
  commandRegistry.register({ id: 'goto.purchase-orders', module: 'purchase-orders', label: 'Go to Purchase Orders', keywords: ['po', 'purchase', 'order'], scope: 'global' });
  commandRegistry.register({ id: 'goto.documents', module: 'documents', label: 'Go to Documents', keywords: ['documents', 'files'], scope: 'global' });
  commandRegistry.register({ id: 'goto.notifications', module: 'notifications', label: 'Go to Notifications', keywords: ['notifications', 'alerts'], scope: 'global' });
  commandRegistry.register({ id: 'goto.audit-trail', module: 'audit-trail', label: 'Open Audit Trail', keywords: ['audit', 'log', 'history'], scope: 'global' });
  commandRegistry.register({ id: 'goto.forecasting', module: 'forecasting', label: 'Open Forecasting', keywords: ['forecast', 'predict'], scope: 'global' });
  commandRegistry.register({ id: 'goto.kpi', module: 'kpi-dashboard', label: 'Open KPI Dashboard', keywords: ['kpi', 'metrics'], scope: 'global' });
  commandRegistry.register({ id: 'goto.automations', module: 'automations', label: 'Open Automations', keywords: ['automations', 'workflows'], scope: 'global' });
  commandRegistry.register({ id: 'goto.rules', module: 'rules', label: 'Open Approval Rules', keywords: ['rules', 'approvals'], scope: 'global' });
  commandRegistry.register({ id: 'goto.companies', module: 'companies', label: 'Switch Company', keywords: ['companies', 'switch'], scope: 'global' });
  // Reports navigation (jumps to specific reports)
  commandRegistry.register({ id: 'reports.ar-aging', module: 'reports', label: 'Open AR Aging Report', keywords: ['ar', 'receivable', 'aging'], scope: 'global' });
  commandRegistry.register({ id: 'reports.ap-aging', module: 'reports', label: 'Open AP Aging Report', keywords: ['ap', 'payable', 'aging'], scope: 'global' });
  commandRegistry.register({ id: 'reports.trial-balance', module: 'reports', label: 'Open Trial Balance', keywords: ['trial', 'balance'], scope: 'global' });
  commandRegistry.register({ id: 'reports.general-ledger', module: 'reports', label: 'Open General Ledger', keywords: ['gl', 'general', 'ledger'], scope: 'global' });
  commandRegistry.register({ id: 'reports.payroll-register', module: 'reports', label: 'Open Payroll Register', keywords: ['payroll', 'register'], scope: 'global' });
  commandRegistry.register({ id: 'reports.budget-vs-actual', module: 'reports', label: 'Open Budget vs Actual', keywords: ['budget', 'actual', 'variance'], scope: 'global' });
  // Quick creators
  commandRegistry.register({ id: 'bill.create', module: 'bills', label: 'Create New Bill', keywords: ['new', 'bill', 'pay'], scope: 'global' });
  commandRegistry.register({ id: 'vendor.create', module: 'expenses', label: 'Add Vendor', keywords: ['new', 'vendor'], scope: 'global' });
  commandRegistry.register({ id: 'project.create', module: 'projects', label: 'Create Project', keywords: ['new', 'project', 'job'], scope: 'global' });
  commandRegistry.register({ id: 'time.start', module: 'time-tracking', label: 'Start Time Tracker', keywords: ['start', 'timer', 'time'], scope: 'global' });
  commandRegistry.register({ id: 'employee.create', module: 'payroll', label: 'Add Employee', keywords: ['new', 'employee', 'hire'], scope: 'global' });
  commandRegistry.register({ id: 'budget.create', module: 'budgets', label: 'Create Budget', keywords: ['new', 'budget'], scope: 'global' });
  commandRegistry.register({ id: 'workflow.create', module: 'automations', label: 'Create Workflow', keywords: ['new', 'workflow', 'automation'], scope: 'global' });
}
