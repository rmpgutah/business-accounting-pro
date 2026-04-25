// Standard journal entry templates.
// Each line uses an account "hint" — a regex matched against the account
// code or name in the active chart so the picker can pre-fill an account_id.
// All amounts are 0 — the user fills them in.

export interface JeTemplateLine {
  hint: string; // regex (case-insensitive) to find a matching account
  description: string;
  side: 'debit' | 'credit';
}

export interface JeTemplate {
  id: string;
  name: string;
  description: string;
  defaultMemo: string;
  lines: JeTemplateLine[];
}

export const JE_TEMPLATES: JeTemplate[] = [
  {
    id: 'depreciation',
    name: 'Depreciation',
    description: 'Monthly depreciation expense for fixed assets',
    defaultMemo: 'Monthly depreciation',
    lines: [
      { hint: 'depreciation expense', description: 'Depreciation expense', side: 'debit' },
      { hint: 'accumulated depreciation', description: 'Accumulated depreciation', side: 'credit' },
    ],
  },
  {
    id: 'payroll-accrual',
    name: 'Payroll Accrual',
    description: 'Accrue unpaid wages at period end',
    defaultMemo: 'Accrued payroll',
    lines: [
      { hint: 'salary|wage|payroll expense', description: 'Wages expense', side: 'debit' },
      { hint: 'payroll tax expense|payroll tax', description: 'Payroll tax expense', side: 'debit' },
      { hint: 'accrued payroll|wages payable', description: 'Accrued wages', side: 'credit' },
      { hint: 'payroll tax(es)? payable', description: 'Payroll tax payable', side: 'credit' },
    ],
  },
  {
    id: 'bad-debt',
    name: 'Bad Debt',
    description: 'Write off uncollectible AR',
    defaultMemo: 'Bad debt write-off',
    lines: [
      { hint: 'bad debt expense', description: 'Bad debt expense', side: 'debit' },
      { hint: 'allowance for doubtful|accounts receivable', description: 'AR / allowance', side: 'credit' },
    ],
  },
  {
    id: 'prepaid-adjustment',
    name: 'Prepaid Expense Adjustment',
    description: 'Recognize portion of prepaid expense as period expense',
    defaultMemo: 'Prepaid expense recognition',
    lines: [
      { hint: 'insurance expense|rent expense|expense', description: 'Expense recognized', side: 'debit' },
      { hint: 'prepaid', description: 'Prepaid asset', side: 'credit' },
    ],
  },
  {
    id: 'inventory-adjustment',
    name: 'Inventory Adjustment',
    description: 'Adjust inventory to physical count',
    defaultMemo: 'Inventory count adjustment',
    lines: [
      { hint: 'cost of goods sold|cogs|inventory shrinkage', description: 'COGS / shrinkage', side: 'debit' },
      { hint: 'inventory', description: 'Inventory asset', side: 'credit' },
    ],
  },
];

export function findAccountByHint(
  hint: string,
  accounts: Array<{ id: string; code: string; name: string }>
): string {
  let re: RegExp;
  try { re = new RegExp(hint, 'i'); } catch { return ''; }
  const hit = accounts.find((a) => re.test(a.name) || re.test(a.code));
  return hit?.id ?? '';
}
