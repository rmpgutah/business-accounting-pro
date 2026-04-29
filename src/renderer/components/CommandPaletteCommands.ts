// src/renderer/components/CommandPaletteCommands.ts
// Renderer-side command registry for the Cmd+K command palette.

export interface CommandContext {
  setModule: (m: string) => void;
  setFocusEntity?: (entity: { type: string; id: string } | null) => void;
  showToast?: (msg: string) => void;
}

export interface RendererCommand {
  id: string;
  label: string;
  module: string;
  keywords?: string[];
  execute: (ctx: CommandContext) => Promise<void> | void;
}

export const RENDERER_COMMANDS: RendererCommand[] = [
  { id: 'invoice.create', label: 'Create New Invoice', module: 'invoicing', keywords: ['new', 'invoice'],
    execute: (ctx) => { ctx.setModule('invoicing'); }},
  { id: 'expense.create', label: 'Create New Expense', module: 'expenses', keywords: ['new', 'expense'],
    execute: (ctx) => { ctx.setModule('expenses'); }},
  { id: 'quote.create', label: 'Create New Quote', module: 'quotes', keywords: ['new', 'quote'],
    execute: (ctx) => { ctx.setModule('quotes'); }},
  { id: 'client.create', label: 'Add Client', module: 'clients', keywords: ['new', 'client'],
    execute: (ctx) => { ctx.setModule('clients'); }},
  { id: 'payroll.run', label: 'Run Payroll', module: 'payroll', keywords: ['payroll'],
    execute: (ctx) => { ctx.setModule('payroll'); }},
  { id: 'reports.profit-loss', label: 'Open Profit & Loss', module: 'reports', keywords: ['p&l', 'pl', 'income'],
    execute: (ctx) => { ctx.setModule('reports'); }},
  { id: 'reports.balance-sheet', label: 'Open Balance Sheet', module: 'reports', keywords: ['balance'],
    execute: (ctx) => { ctx.setModule('reports'); }},
  { id: 'reports.cash-flow', label: 'Open Cash Flow', module: 'reports', keywords: ['cash', 'flow'],
    execute: (ctx) => { ctx.setModule('reports'); }},
  { id: 'tax.dashboard', label: 'Open Tax Dashboard', module: 'taxes', keywords: ['tax'],
    execute: (ctx) => { ctx.setModule('taxes'); }},
  { id: 'debt.dashboard', label: 'Open Collections', module: 'debt-collection', keywords: ['debt', 'collect'],
    execute: (ctx) => { ctx.setModule('debt-collection'); }},
  { id: 'goto.dashboard', label: 'Go to Dashboard', module: 'dashboard', keywords: ['home', 'dashboard'],
    execute: (ctx) => { ctx.setModule('dashboard'); }},
  { id: 'goto.accounts', label: 'Go to Accounts & GL', module: 'accounts', keywords: ['accounts', 'gl', 'ledger'],
    execute: (ctx) => { ctx.setModule('accounts'); }},
  { id: 'goto.bills', label: 'Go to Bills (AP)', module: 'bills', keywords: ['bills', 'ap'],
    execute: (ctx) => { ctx.setModule('bills'); }},
  { id: 'goto.budgets', label: 'Go to Budgets', module: 'budgets', keywords: ['budgets'],
    execute: (ctx) => { ctx.setModule('budgets'); }},
  { id: 'goto.settings', label: 'Open Settings', module: 'settings', keywords: ['settings', 'preferences'],
    execute: (ctx) => { ctx.setModule('settings'); }},
  // Module navigation (additional)
  { id: 'goto.recurring', label: 'Go to Recurring Transactions', module: 'recurring', keywords: ['recurring', 'subscription'],
    execute: (ctx) => { ctx.setModule('recurring'); }},
  { id: 'goto.projects', label: 'Go to Projects', module: 'projects', keywords: ['projects', 'job'],
    execute: (ctx) => { ctx.setModule('projects'); }},
  { id: 'goto.time', label: 'Go to Time Tracking', module: 'time-tracking', keywords: ['time', 'timer', 'log hours'],
    execute: (ctx) => { ctx.setModule('time-tracking'); }},
  { id: 'goto.inventory', label: 'Go to Inventory', module: 'inventory', keywords: ['inventory', 'stock'],
    execute: (ctx) => { ctx.setModule('inventory'); }},
  { id: 'goto.fixed-assets', label: 'Go to Fixed Assets', module: 'fixed-assets', keywords: ['fixed', 'assets', 'depreciation'],
    execute: (ctx) => { ctx.setModule('fixed-assets'); }},
  { id: 'goto.bank-recon', label: 'Go to Bank Reconciliation', module: 'bank-recon', keywords: ['bank', 'reconcile', 'recon'],
    execute: (ctx) => { ctx.setModule('bank-recon'); }},
  { id: 'goto.purchase-orders', label: 'Go to Purchase Orders', module: 'purchase-orders', keywords: ['po', 'purchase', 'order'],
    execute: (ctx) => { ctx.setModule('purchase-orders'); }},
  { id: 'goto.documents', label: 'Go to Documents', module: 'documents', keywords: ['documents', 'files'],
    execute: (ctx) => { ctx.setModule('documents'); }},
  { id: 'goto.notifications', label: 'Go to Notifications', module: 'notifications', keywords: ['notifications', 'alerts'],
    execute: (ctx) => { ctx.setModule('notifications'); }},
  { id: 'goto.audit-trail', label: 'Open Audit Trail', module: 'audit-trail', keywords: ['audit', 'log', 'history'],
    execute: (ctx) => { ctx.setModule('audit-trail'); }},
  { id: 'goto.forecasting', label: 'Open Forecasting', module: 'forecasting', keywords: ['forecast', 'predict'],
    execute: (ctx) => { ctx.setModule('forecasting'); }},
  { id: 'goto.kpi', label: 'Open KPI Dashboard', module: 'kpi-dashboard', keywords: ['kpi', 'metrics'],
    execute: (ctx) => { ctx.setModule('kpi-dashboard'); }},
  { id: 'goto.automations', label: 'Open Automations', module: 'automations', keywords: ['automations', 'workflows'],
    execute: (ctx) => { ctx.setModule('automations'); }},
  { id: 'goto.rules', label: 'Open Approval Rules', module: 'rules', keywords: ['rules', 'approvals'],
    execute: (ctx) => { ctx.setModule('rules'); }},
  { id: 'goto.companies', label: 'Switch Company', module: 'companies', keywords: ['companies', 'switch'],
    execute: (ctx) => { ctx.setModule('companies'); }},
  // Reports navigation (jumps to specific reports)
  { id: 'reports.ar-aging', label: 'Open AR Aging Report', module: 'reports', keywords: ['ar', 'receivable', 'aging'],
    execute: (ctx) => { ctx.setModule('reports'); }},
  { id: 'reports.ap-aging', label: 'Open AP Aging Report', module: 'reports', keywords: ['ap', 'payable', 'aging'],
    execute: (ctx) => { ctx.setModule('reports'); }},
  { id: 'reports.trial-balance', label: 'Open Trial Balance', module: 'reports', keywords: ['trial', 'balance'],
    execute: (ctx) => { ctx.setModule('reports'); }},
  { id: 'reports.general-ledger', label: 'Open General Ledger', module: 'reports', keywords: ['gl', 'general', 'ledger'],
    execute: (ctx) => { ctx.setModule('reports'); }},
  { id: 'reports.payroll-register', label: 'Open Payroll Register', module: 'reports', keywords: ['payroll', 'register'],
    execute: (ctx) => { ctx.setModule('reports'); }},
  { id: 'reports.budget-vs-actual', label: 'Open Budget vs Actual', module: 'reports', keywords: ['budget', 'actual', 'variance'],
    execute: (ctx) => { ctx.setModule('reports'); }},
  // Quick creators
  { id: 'bill.create', label: 'Create New Bill', module: 'bills', keywords: ['new', 'bill', 'pay'],
    execute: (ctx) => { ctx.setModule('bills'); }},
  { id: 'vendor.create', label: 'Add Vendor', module: 'expenses', keywords: ['new', 'vendor'],
    execute: (ctx) => { ctx.setModule('expenses'); }},
  { id: 'project.create', label: 'Create Project', module: 'projects', keywords: ['new', 'project', 'job'],
    execute: (ctx) => { ctx.setModule('projects'); }},
  { id: 'time.start', label: 'Start Time Tracker', module: 'time-tracking', keywords: ['start', 'timer', 'time'],
    execute: (ctx) => { ctx.setModule('time-tracking'); }},
  { id: 'employee.create', label: 'Add Employee', module: 'payroll', keywords: ['new', 'employee', 'hire'],
    execute: (ctx) => { ctx.setModule('payroll'); }},
  { id: 'budget.create', label: 'Create Budget', module: 'budgets', keywords: ['new', 'budget'],
    execute: (ctx) => { ctx.setModule('budgets'); }},
  { id: 'workflow.create', label: 'Create Workflow', module: 'automations', keywords: ['new', 'workflow', 'automation'],
    execute: (ctx) => { ctx.setModule('automations'); }},
];

export function findCommands(query: string): RendererCommand[] {
  if (!query.trim()) return RENDERER_COMMANDS.slice(0, 10);
  const q = query.toLowerCase();
  return RENDERER_COMMANDS
    .map(c => {
      const labelMatch = c.label.toLowerCase().indexOf(q);
      const keywordMatch = (c.keywords || []).some(k => k.toLowerCase().includes(q));
      const score = labelMatch >= 0 ? 100 - labelMatch : keywordMatch ? 30 : -1;
      return { c, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(x => x.c)
    .slice(0, 20);
}
