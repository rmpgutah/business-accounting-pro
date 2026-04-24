import React, { useState, Suspense } from 'react';
import { ArrowLeft, BarChart3 } from 'lucide-react';
import ReportSelector, { type ReportType } from './ReportSelector';
import ProfitAndLoss from './ProfitAndLoss';
import BalanceSheet from './BalanceSheet';
import ExpenseByCategory from './ExpenseByCategory';

const CashFlowStatement = React.lazy(() => import('./CashFlowStatement'));
const ARAgingReport = React.lazy(() => import('./ARAgingReport'));
const TaxSummary = React.lazy(() => import('./TaxSummary'));
const TrialBalance = React.lazy(() => import('./TrialBalance'));
const APAgingReport = React.lazy(() => import('./APAgingReport'));
const GeneralLedger = React.lazy(() => import('./GeneralLedger'));
const FinancialStatements = React.lazy(() => import('./FinancialStatements'));
const ExpenseDetailReport = React.lazy(() => import('./ExpenseDetailReport'));
const BudgetVsActualReport = React.lazy(() => import('./BudgetVsActualReport'));
const PayrollRegister = React.lazy(() => import('./PayrollRegister'));

// ─── Report title map ───────────────────────────────────
const REPORT_TITLES: Record<ReportType, string> = {
  'profit-and-loss': 'Profit & Loss',
  'balance-sheet': 'Balance Sheet',
  'cash-flow': 'Cash Flow Statement',
  'ar-aging': 'Accounts Receivable Aging',
  'ap-aging': 'Accounts Payable Aging',
  'trial-balance': 'Trial Balance',
  'general-ledger': 'General Ledger',
  'expense-by-category': 'Expense by Category',
  'expense-detail': 'Expense Detail Report',
  'tax-summary': 'Tax Summary',
  'financial-statements': 'Financial Statements',
  'budget-vs-actual': 'Budget vs Actual',
  'payroll-register': 'Payroll Register',
};

// ─── Lazy loading fallback ───────────────────────────────
const LazyFallback: React.FC = () => (
  <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">
    Loading report...
  </div>
);

// ─── Component ──────────────────────────────────────────
const ReportsModule: React.FC = () => {
  const [activeReport, setActiveReport] = useState<ReportType | null>(null);

  const renderReport = () => {
    switch (activeReport) {
      case 'profit-and-loss':
        return <ProfitAndLoss />;
      case 'balance-sheet':
        return <BalanceSheet />;
      case 'expense-by-category':
        return <ExpenseByCategory />;
      case 'cash-flow':
        return <Suspense fallback={<LazyFallback />}><CashFlowStatement /></Suspense>;
      case 'ar-aging':
        return <Suspense fallback={<LazyFallback />}><ARAgingReport /></Suspense>;
      case 'ap-aging':
        return <Suspense fallback={<LazyFallback />}><APAgingReport /></Suspense>;
      case 'trial-balance':
        return <Suspense fallback={<LazyFallback />}><TrialBalance /></Suspense>;
      case 'general-ledger':
        return <Suspense fallback={<LazyFallback />}><GeneralLedger /></Suspense>;
      case 'expense-detail':
        return <Suspense fallback={<LazyFallback />}><ExpenseDetailReport /></Suspense>;
      case 'tax-summary':
        return <Suspense fallback={<LazyFallback />}><TaxSummary /></Suspense>;
      case 'financial-statements':
        return <Suspense fallback={<LazyFallback />}><FinancialStatements /></Suspense>;
      case 'budget-vs-actual':
        return <Suspense fallback={<LazyFallback />}><BudgetVsActualReport /></Suspense>;
      case 'payroll-register':
        return <Suspense fallback={<LazyFallback />}><PayrollRegister /></Suspense>;
      default:
        return null;
    }
  };

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      {/* Module header */}
      <div className="flex items-center gap-3">
        {activeReport ? (
          <button
            onClick={() => setActiveReport(null)}
            className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary hover:bg-bg-hover transition-colors"
            style={{ borderRadius: '6px' }}
            title="Back to reports"
          >
            <ArrowLeft size={16} className="text-text-secondary" />
          </button>
        ) : (
          <div
            className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary"
            style={{ borderRadius: '6px' }}
          >
            <BarChart3 size={18} className="text-accent-blue" />
          </div>
        )}
        <div>
          <h1 className="text-lg font-bold text-text-primary">
            {activeReport ? REPORT_TITLES[activeReport] : 'Reports'}
          </h1>
          {!activeReport && (
            <p className="text-xs text-text-muted mt-0.5">
              Financial reports and analytics
            </p>
          )}
        </div>
      </div>

      {/* Content */}
      {activeReport ? renderReport() : (
        <ReportSelector onSelect={setActiveReport} />
      )}
    </div>
  );
};

export default ReportsModule;
