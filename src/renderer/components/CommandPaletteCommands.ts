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
