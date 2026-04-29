// src/renderer/lib/commandParser.ts
// Parse natural-language strings into structured command intents.
// Examples:
//   "$45 lunch with john abc" → { type: 'expense.create', amount: 45, description: 'lunch with john', clientHint: 'abc' }
//   "inv 1024" → { type: 'navigate', module: 'invoices', identifier: '1024' }
//   "pay 100 invoice 1024" → { type: 'invoice.record-payment', invoiceId: '1024', amount: 100 }

export interface ParsedIntent {
  type: 'expense.create' | 'invoice.create' | 'invoice.record-payment' | 'navigate' | 'unknown';
  amount?: number;
  description?: string;
  clientHint?: string;
  vendorHint?: string;
  module?: string;
  identifier?: string;
  invoiceId?: string;
  raw: string;
}

const NAVIGATE_PATTERNS: Array<{ re: RegExp; module: string }> = [
  { re: /^inv(?:oice)?\s+(\S+)/i, module: 'invoices' },
  { re: /^exp(?:ense)?\s+(\S+)/i, module: 'expenses' },
  { re: /^client\s+(\S+)/i, module: 'clients' },
  { re: /^vendor\s+(\S+)/i, module: 'vendors' },
  { re: /^quote\s+(\S+)/i, module: 'quotes' },
  { re: /^debt\s+(\S+)/i, module: 'debt-collection' },
  { re: /^emp(?:loyee)?\s+(\S+)/i, module: 'payroll' },
];

export function parseCommand(input: string): ParsedIntent {
  const trimmed = input.trim();
  if (!trimmed) return { type: 'unknown', raw: trimmed };

  // Navigate patterns
  for (const { re, module } of NAVIGATE_PATTERNS) {
    const m = trimmed.match(re);
    if (m) return { type: 'navigate', module, identifier: m[1], raw: trimmed };
  }

  // "pay X invoice N"
  const payMatch = trimmed.match(/^pay\s+\$?(\d+(?:\.\d{1,2})?)\s+invoice\s+(\S+)/i);
  if (payMatch) {
    return {
      type: 'invoice.record-payment',
      amount: parseFloat(payMatch[1]),
      invoiceId: payMatch[2],
      raw: trimmed,
    };
  }

  // Expense quick-create: starts with $ amount
  const dollarMatch = trimmed.match(/^\$?(\d+(?:\.\d{1,2})?)\s+(.+)/);
  if (dollarMatch && !trimmed.toLowerCase().startsWith('inv')) {
    const amount = parseFloat(dollarMatch[1]);
    const rest = dollarMatch[2].trim();
    const forMatch = rest.match(/^(.*)\s+for\s+(\S+)$/i);
    if (forMatch) {
      return {
        type: 'expense.create',
        amount,
        description: forMatch[1].trim(),
        clientHint: forMatch[2].trim(),
        raw: trimmed,
      };
    }
    return { type: 'expense.create', amount, description: rest, raw: trimmed };
  }

  return { type: 'unknown', raw: trimmed };
}
