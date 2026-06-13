// Column + grouping definitions for the Expense list.
// Moved verbatim out of ExpenseList.tsx (move-only refactor, 2026-06-11).
import { expenseGrandTotal } from '../expense-helpers';

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

// FINAL-PRICE rule v4: amount + tax + shipping + shipping_tax − header_discount.
// Delegates to the shared expenseGrandTotal helper so the list, detail header,
// and print/voucher templates all reconcile to the same number.
export const expenseDisplayTotal = expenseGrandTotal;
