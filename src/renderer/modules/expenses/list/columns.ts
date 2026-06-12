// Column + grouping definitions for the Expense list.
// Moved verbatim out of ExpenseList.tsx (move-only refactor, 2026-06-11).

export type GroupKey = 'none' | 'vendor' | 'category' | 'project' | 'month' | 'quarter' | 'dayofweek' | 'taxded' | 'currency';
export type ColKey = 'date' | 'description' | 'category' | 'vendor' | 'project' | 'amount' | 'status' | 'approval' | 'receipt' | 'taxded' | 'mileage' | 'billable' | 'actions';
export const ALL_COLS: { key: ColKey; label: string }[] = [
  { key: 'date', label: 'Date' },
  { key: 'description', label: 'Description' },
  { key: 'category', label: 'Category' },
  { key: 'vendor', label: 'Vendor' },
  { key: 'project', label: 'Project' },
  { key: 'amount', label: 'Amount' },
  { key: 'status', label: 'Status' },
  { key: 'approval', label: 'Approval' },
  { key: 'receipt', label: 'Receipt' },
  { key: 'taxded', label: 'Tax Deductible' },
  { key: 'mileage', label: 'Mileage' },
  { key: 'billable', label: 'Billable' },
  { key: 'actions', label: 'Actions' },
];

// Default visible columns (mileage and approval hidden by default)
export const DEFAULT_VISIBLE_COLS: ColKey[] = ['date', 'description', 'category', 'vendor', 'project', 'amount', 'status', 'receipt', 'taxded', 'billable', 'actions'];

// FINAL-PRICE rule v3: amount + tax − header_discount = total, ALWAYS.
//
// Discount math: applied AFTER tax (does NOT reduce taxable base) for parity
// with the invoice form. Both $ flat AND % apply independently — if both are
// set, they both subtract. Negative totals are clamped to 0 (a discount can
// never make an expense's value negative; that would be a credit memo
// scenario which lives elsewhere).
export function expenseDisplayTotal(e: { amount?: number; tax_amount?: number; discount_amount?: number; discount_percent?: number }): number {
  const grossTotal = (e.amount || 0) + (e.tax_amount || 0);
  const flat = e.discount_amount || 0;
  const pct = e.discount_percent || 0;
  const pctOff = grossTotal * (pct / 100);
  return Math.max(0, grossTotal - flat - pctOff);
}
