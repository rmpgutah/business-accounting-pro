import React, { useState, Suspense } from 'react';
import { ArrowLeft, BarChart3 } from 'lucide-react';
import ReportSelector, { type ReportType } from './ReportSelector';
import ProfitAndLoss from './ProfitAndLoss';
import BalanceSheet from './BalanceSheet';
import ExpenseByCategory from './ExpenseByCategory';

const CashFlowStatement = React.lazy(() => import('./CashFlowStatement'));
const ARAgingReport = React.lazy(() => import('./ARAgingReport'));
const TaxSummary = React.lazy(() => import('./TaxSummary'));

// ─── Report title map ───────────────────────────────────
const REPORT_TITLES: Record<ReportType, string> = {
  'profit-and-loss': 'Profit & Loss',
  'balance-sheet': 'Balance Sheet',
  'cash-flow': 'Cash Flow Statement',
  'ar-aging': 'Accounts Receivable Aging',
  'expense-by-category': 'Expense by Category',
  'tax-summary': 'Tax Summary',
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
      case 'tax-summary':
        return <Suspense fallback={<LazyFallback />}><TaxSummary /></Suspense>;
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
            style={{ borderRadius: '2px' }}
            title="Back to reports"
          >
            <ArrowLeft size={16} className="text-text-secondary" />
          </button>
        ) : (
          <div
            className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary"
            style={{ borderRadius: '2px' }}
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
