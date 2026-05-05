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
  Target,
  Users,
  UserCircle,
  Building2,
  FolderKanban,
  CalendarDays,
  Package,
  type LucideIcon,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────
export type ReportType =
  | 'profit-and-loss'
  | 'balance-sheet'
  | 'cash-flow'
  | 'cash-flow-forecast'    // P4.35
  | 'ar-aging'
  | 'ap-aging'
  | 'trial-balance'
  | 'general-ledger'
  | 'expense-by-category'
  | 'expense-detail'
  | 'tax-summary'
  | 'financial-statements'
  | 'budget-vs-actual'
  | 'payroll-register'
  | 'revenue-by-client'
  | 'vendor-spend'
  | 'project-profitability'
  | 'customer-profitability' // P4.37
  | 'income-by-month'
  | 'debt-collection'
  | 'inventory-valuation'
  | 'sales-tax';

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
    id: 'cash-flow-forecast',
    title: 'Cash Flow Forecast',
    description:
      'Forward-looking 30/60/90/180-day projection from open invoices and bills. Highlights cash-shortfall risk dates.',
    icon: TrendingUp,
    accentClass: 'border-l-accent-blue',
  },
  {
    id: 'customer-profitability',
    title: 'Customer Profitability',
    description:
      'Per-client revenue, direct expenses, profit, and margin %. Identifies which clients actually drive profit.',
    icon: Users,
    accentClass: 'border-l-accent-blue',
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
  {
    id: 'budget-vs-actual',
    title: 'Budget vs Actual',
    description:
      'Compare budgeted amounts to actual spending by category with variance analysis.',
    icon: Target,
    accentClass: 'border-l-purple-500',
  },
  {
    id: 'payroll-register',
    title: 'Payroll Register',
    description:
      'Per-run breakdown of employee pay, taxes, and deductions.',
    icon: Users,
    accentClass: 'border-l-purple-500',
  },
  {
    id: 'revenue-by-client',
    title: 'Revenue by Client',
    description: 'Revenue breakdown by client with ranking, percentage of total, and trend indicators.',
    icon: UserCircle,
    accentClass: 'border-l-accent-blue',
  },
  {
    id: 'vendor-spend',
    title: 'Vendor Spend Analysis',
    description: 'Spending by vendor with YoY comparison, top vendors, and payment terms compliance.',
    icon: Building2,
    accentClass: 'border-l-[#f97316]',
  },
  {
    id: 'project-profitability',
    title: 'Project Profitability',
    description: 'Revenue, costs, and margin per project with budget vs actual comparison.',
    icon: FolderKanban,
    accentClass: 'border-l-accent-income',
  },
  {
    id: 'income-by-month',
    title: 'Income by Month',
    description: 'Monthly income trend with year-over-year comparison and seasonal patterns.',
    icon: CalendarDays,
    accentClass: 'border-l-accent-blue',
  },
  {
    id: 'debt-collection',
    title: 'Debt Collection Report',
    description: 'Portfolio performance, recovery rates, aging analysis, and collector effectiveness.',
    icon: Scale,
    accentClass: 'border-l-accent-expense',
  },
  {
    id: 'inventory-valuation',
    title: 'Inventory Valuation',
    description: 'Current inventory value, turnover rate, and cost analysis by item and category.',
    icon: Package,
    accentClass: 'border-l-[#8b5cf6]',
  },
  {
    id: 'sales-tax',
    title: 'Sales Tax Report',
    description: 'Sales tax collected, by jurisdiction, with filing period summaries.',
    icon: Receipt,
    accentClass: 'border-l-[#f59e0b]',
  },
];

// ─── Category Groups ────────────────────────────────────
const CATEGORIES = [
  { title: 'Financial Statements', reports: ['profit-and-loss', 'balance-sheet', 'cash-flow', 'financial-statements'] },
  { title: 'Ledger & Accounts', reports: ['trial-balance', 'general-ledger'] },
  { title: 'Receivables & Revenue', reports: ['ar-aging', 'revenue-by-client', 'income-by-month', 'sales-tax'] },
  { title: 'Payables & Expenses', reports: ['ap-aging', 'expense-by-category', 'expense-detail', 'vendor-spend'] },
  { title: 'Operations', reports: ['budget-vs-actual', 'payroll-register', 'project-profitability', 'inventory-valuation'] },
  { title: 'Collections', reports: ['debt-collection'] },
];

// ─── Component ──────────────────────────────────────────
const ReportSelector: React.FC<ReportSelectorProps> = ({ onSelect }) => {
  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
          Choose a Report
        </h2>
        <p className="text-sm text-text-secondary">
          Select a financial report to generate.
        </p>
      </div>

      {CATEGORIES.map((cat) => (
        <div key={cat.title}>
          <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3 mt-6">
            {cat.title}
          </h3>
          <div className="grid grid-cols-3 gap-4">
            {cat.reports.map((reportId) => {
              const report = REPORTS.find((r) => r.id === reportId);
              if (!report) return null;
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
      ))}
    </div>
  );
};

export default ReportSelector;
