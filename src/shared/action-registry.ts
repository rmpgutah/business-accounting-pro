// Shared typed action catalog for the Command Palette / Intelligence Core (B1).
// Navigation actions carry a `module` (resolved in the renderer via setModule);
// mutation actions carry a `mutate` id resolved + role-checked in the main process.

export type Role = 'owner' | 'admin' | 'accountant' | 'viewer';

export interface AppAction {
  id: string;
  label: string;
  keywords: string[];
  /** 'navigate' actions run in the renderer; 'mutate' actions run in main via action:invoke */
  kind: 'navigate' | 'mutate';
  module?: string;            // for navigate
  requiredRole?: Role;        // for mutate (default: any logged-in user)
}

// Role rank for permission checks (higher = more privileged).
export const ROLE_RANK: Record<Role, number> = { viewer: 0, accountant: 1, admin: 2, owner: 3 };

// Navigation actions migrated from CommandPaletteCommands.ts (same ids/modules).
export const NAV_ACTIONS: AppAction[] = [
  { id: 'invoice.create', label: 'Create New Invoice', keywords: ['new', 'invoice'], kind: 'navigate', module: 'invoicing' },
  { id: 'expense.create', label: 'Create New Expense', keywords: ['new', 'expense'], kind: 'navigate', module: 'expenses' },
  { id: 'quote.create', label: 'Create New Quote', keywords: ['new', 'quote'], kind: 'navigate', module: 'quotes' },
  { id: 'client.create', label: 'Add Client', keywords: ['new', 'client'], kind: 'navigate', module: 'clients' },
  { id: 'payroll.run', label: 'Run Payroll', keywords: ['payroll'], kind: 'navigate', module: 'payroll' },
  { id: 'reports.profit-loss', label: 'Open Profit & Loss', keywords: ['p&l', 'pl', 'income'], kind: 'navigate', module: 'reports' },
  { id: 'reports.balance-sheet', label: 'Open Balance Sheet', keywords: ['balance'], kind: 'navigate', module: 'reports' },
  { id: 'reports.cash-flow', label: 'Open Cash Flow', keywords: ['cash', 'flow'], kind: 'navigate', module: 'reports' },
  { id: 'tax.dashboard', label: 'Open Tax Dashboard', keywords: ['tax'], kind: 'navigate', module: 'taxes' },
  { id: 'debt.dashboard', label: 'Open Collections', keywords: ['debt', 'collect'], kind: 'navigate', module: 'debt-collection' },
  { id: 'goto.dashboard', label: 'Go to Dashboard', keywords: ['home', 'dashboard'], kind: 'navigate', module: 'dashboard' },
  { id: 'goto.accounts', label: 'Go to Accounts & GL', keywords: ['accounts', 'gl', 'ledger'], kind: 'navigate', module: 'accounts' },
  { id: 'goto.bills', label: 'Go to Bills (AP)', keywords: ['bills', 'ap'], kind: 'navigate', module: 'bills' },
  { id: 'goto.budgets', label: 'Go to Budgets', keywords: ['budgets'], kind: 'navigate', module: 'budgets' },
  { id: 'goto.settings', label: 'Open Settings', keywords: ['settings', 'preferences'], kind: 'navigate', module: 'settings' },
  { id: 'goto.recurring', label: 'Go to Recurring Transactions', keywords: ['recurring', 'subscription'], kind: 'navigate', module: 'recurring' },
  { id: 'goto.projects', label: 'Go to Projects', keywords: ['projects', 'job'], kind: 'navigate', module: 'projects' },
  { id: 'goto.time', label: 'Go to Time Tracking', keywords: ['time', 'timer', 'log hours'], kind: 'navigate', module: 'time-tracking' },
  { id: 'goto.inventory', label: 'Go to Inventory', keywords: ['inventory', 'stock'], kind: 'navigate', module: 'inventory' },
  { id: 'goto.fixed-assets', label: 'Go to Fixed Assets', keywords: ['fixed', 'assets', 'depreciation'], kind: 'navigate', module: 'fixed-assets' },
  { id: 'goto.bank-recon', label: 'Go to Bank Reconciliation', keywords: ['bank', 'reconcile', 'recon'], kind: 'navigate', module: 'bank-recon' },
  { id: 'goto.purchase-orders', label: 'Go to Purchase Orders', keywords: ['po', 'purchase', 'order'], kind: 'navigate', module: 'purchase-orders' },
  { id: 'goto.documents', label: 'Go to Documents', keywords: ['documents', 'files'], kind: 'navigate', module: 'documents' },
  { id: 'goto.notifications', label: 'Go to Notifications', keywords: ['notifications', 'alerts'], kind: 'navigate', module: 'notifications' },
  { id: 'goto.audit-trail', label: 'Open Audit Trail', keywords: ['audit', 'log', 'history'], kind: 'navigate', module: 'audit-trail' },
  { id: 'goto.forecasting', label: 'Open Forecasting', keywords: ['forecast', 'predict'], kind: 'navigate', module: 'forecasting' },
  { id: 'goto.kpi', label: 'Open KPI Dashboard', keywords: ['kpi', 'metrics'], kind: 'navigate', module: 'kpi-dashboard' },
  { id: 'goto.automations', label: 'Open Automations', keywords: ['automations', 'workflows'], kind: 'navigate', module: 'automations' },
  { id: 'goto.rules', label: 'Open Approval Rules', keywords: ['rules', 'approvals'], kind: 'navigate', module: 'rules' },
  { id: 'goto.companies', label: 'Switch Company', keywords: ['companies', 'switch'], kind: 'navigate', module: 'companies' },
  { id: 'reports.ar-aging', label: 'Open AR Aging Report', keywords: ['ar', 'receivable', 'aging'], kind: 'navigate', module: 'reports' },
  { id: 'reports.ap-aging', label: 'Open AP Aging Report', keywords: ['ap', 'payable', 'aging'], kind: 'navigate', module: 'reports' },
  { id: 'reports.trial-balance', label: 'Open Trial Balance', keywords: ['trial', 'balance'], kind: 'navigate', module: 'reports' },
  { id: 'reports.general-ledger', label: 'Open General Ledger', keywords: ['gl', 'general', 'ledger'], kind: 'navigate', module: 'reports' },
  { id: 'reports.payroll-register', label: 'Open Payroll Register', keywords: ['payroll', 'register'], kind: 'navigate', module: 'reports' },
  { id: 'reports.budget-vs-actual', label: 'Open Budget vs Actual', keywords: ['budget', 'actual', 'variance'], kind: 'navigate', module: 'reports' },
  { id: 'bill.create', label: 'Create New Bill', keywords: ['new', 'bill', 'pay'], kind: 'navigate', module: 'bills' },
  { id: 'vendor.create', label: 'Add Vendor', keywords: ['new', 'vendor'], kind: 'navigate', module: 'expenses' },
  { id: 'project.create', label: 'Create Project', keywords: ['new', 'project', 'job'], kind: 'navigate', module: 'projects' },
  { id: 'time.start', label: 'Start Time Tracker', keywords: ['start', 'timer', 'time'], kind: 'navigate', module: 'time-tracking' },
  { id: 'employee.create', label: 'Add Employee', keywords: ['new', 'employee', 'hire'], kind: 'navigate', module: 'payroll' },
  { id: 'budget.create', label: 'Create Budget', keywords: ['new', 'budget'], kind: 'navigate', module: 'budgets' },
  { id: 'workflow.create', label: 'Create Workflow', keywords: ['new', 'workflow', 'automation'], kind: 'navigate', module: 'automations' },
];

// First mutation actions — small, safe set. Money-moving stays proposal-only (navigate).
export const MUTATE_ACTIONS: AppAction[] = [
  { id: 'invoice.markPaid', label: 'Mark Invoice Paid…', keywords: ['mark', 'paid', 'invoice'], kind: 'mutate', requiredRole: 'accountant' },
  { id: 'client.createQuick', label: 'Create Client (quick)', keywords: ['quick', 'add', 'client'], kind: 'mutate', requiredRole: 'accountant' },
];

export const ALL_ACTIONS: AppAction[] = [...NAV_ACTIONS, ...MUTATE_ACTIONS];

/** Lightweight keyword/label fuzzy match for the palette. */
export function findActions(query: string): AppAction[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return ALL_ACTIONS.filter(a =>
    a.label.toLowerCase().includes(q) || a.keywords.some(k => k.includes(q)) || a.id.includes(q)
  ).slice(0, 8);
}
