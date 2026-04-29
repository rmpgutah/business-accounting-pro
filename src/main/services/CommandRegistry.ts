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
}
