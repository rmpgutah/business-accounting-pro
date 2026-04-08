import React from 'react';
import {
  TrendingUp,
  Scale,
  Banknote,
  Clock,
  PieChart,
  Calculator,
  BookOpen,
  CreditCard,
  List,
  FileSpreadsheet,
  Receipt,
  type LucideIcon,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────
export type ReportType =
  | 'profit-and-loss'
  | 'balance-sheet'
  | 'cash-flow'
  | 'ar-aging'
  | 'ap-aging'
  | 'trial-balance'
  | 'general-ledger'
  | 'expense-by-category'
  | 'expense-detail'
  | 'tax-summary'
  | 'financial-statements';

interface ReportCard {
  id: ReportType;
  title: string;
  description: string;
  icon: LucideIcon;
  accentClass: string;
}

interface ReportSelectorProps {
  onSelect: (report: ReportType) => void;
}

// ─── Report Definitions ─────────────────────────────────
const REPORTS: ReportCard[] = [
  {
    id: 'profit-and-loss',
    title: 'Profit & Loss',
    description:
      'Revenue, expenses, and net income for a selected period. The classic income statement.',
    icon: TrendingUp,
    accentClass: 'border-l-accent-income',
  },
  {
    id: 'balance-sheet',
    title: 'Balance Sheet',
    description:
      'Assets, liabilities, and equity as of a specific date. A snapshot of financial position.',
    icon: Scale,
    accentClass: 'border-l-accent-blue',
  },
  {
    id: 'cash-flow',
    title: 'Cash Flow Statement',
    description:
      'Cash inflows and outflows from operating, investing, and financing activities.',
    icon: Banknote,
    accentClass: 'border-l-accent-warning',
  },
  {
    id: 'ar-aging',
    title: 'Accounts Receivable Aging',
    description:
      'Outstanding invoices grouped by age: Current, 1-30, 31-60, 61-90, and 90+ days.',
    icon: Clock,
    accentClass: 'border-l-accent-expense',
  },
  {
    id: 'trial-balance',
    title: 'Trial Balance',
    description:
      'All account balances with total debits and credits. Confirms the books are in balance.',
    icon: List,
    accentClass: 'border-l-[#06b6d4]',
  },
  {
    id: 'ap-aging',
    title: 'Accounts Payable Aging',
    description:
      'Outstanding bills grouped by age: Current, 1-30, 31-60, 61-90, and 90+ days.',
    icon: CreditCard,
    accentClass: 'border-l-[#f97316]',
  },
  {
    id: 'general-ledger',
    title: 'General Ledger',
    description:
      'Complete transaction history for every account with running balances.',
    icon: BookOpen,
    accentClass: 'border-l-[#8b5cf6]',
  },
  {
    id: 'expense-by-category',
    title: 'Expense by Category',
    description:
      'Visual breakdown of expenses by category with bar chart and percentage of total.',
    icon: PieChart,
    accentClass: 'border-l-[#a855f7]',
  },
  {
    id: 'expense-detail',
    title: 'Expense Detail Report',
    description: 'Itemized expense report with line items, grouped by category, vendor, or project.',
    icon: Receipt,
    accentClass: 'border-l-[#ec4899]',
  },
  {
    id: 'tax-summary',
    title: 'Tax Summary',
    description:
      'Tax collected, tax paid, and net tax liability for the selected period.',
    icon: Calculator,
    accentClass: 'border-l-[#f59e0b]',
  },
  {
    id: 'financial-statements',
    title: 'Financial Statements',
    description:
      'Formatted, print-ready Profit & Loss, Balance Sheet, and Cash Flow statements.',
    icon: FileSpreadsheet,
    accentClass: 'border-l-accent-income',
  },
];

// ─── Component ──────────────────────────────────────────
const ReportSelector: React.FC<ReportSelectorProps> = ({ onSelect }) => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
          Choose a Report
        </h2>
        <p className="text-sm text-text-secondary">
          Select a financial report to generate.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {REPORTS.map((report) => {
          const Icon = report.icon;
          return (
            <button
              key={report.id}
              onClick={() => onSelect(report.id)}
              className={`block-card p-5 border-l-2 ${report.accentClass} text-left hover:bg-bg-hover transition-colors cursor-pointer group`}
              style={{ borderRadius: '6px' }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary shrink-0"
                  style={{ borderRadius: '6px' }}
                >
                  <Icon
                    size={18}
                    className="text-text-secondary group-hover:text-accent-blue transition-colors"
                  />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-text-primary group-hover:text-accent-blue transition-colors">
                    {report.title}
                  </h3>
                  <p className="text-xs text-text-muted mt-1 leading-relaxed">
                    {report.description}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ReportSelector;
