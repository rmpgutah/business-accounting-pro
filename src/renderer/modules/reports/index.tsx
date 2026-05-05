import React, { useState, useEffect, useMemo, Suspense, useCallback } from 'react';
import { ArrowLeft, BarChart3, Star, Clock, DollarSign, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import ReportSelector, { type ReportType } from './ReportSelector';
import ProfitAndLoss from './ProfitAndLoss';
import BalanceSheet from './BalanceSheet';
import ExpenseByCategory from './ExpenseByCategory';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency } from '../../lib/format';

const CashFlowStatement = React.lazy(() => import('./CashFlowStatement'));
const CashFlowForecast = React.lazy(() => import('./CashFlowForecast'));
const CustomerProfitability = React.lazy(() => import('./CustomerProfitability'));
const ARAgingReport = React.lazy(() => import('./ARAgingReport'));
const TaxSummary = React.lazy(() => import('./TaxSummary'));
const TrialBalance = React.lazy(() => import('./TrialBalance'));
const APAgingReport = React.lazy(() => import('./APAgingReport'));
const GeneralLedger = React.lazy(() => import('./GeneralLedger'));
const FinancialStatements = React.lazy(() => import('./FinancialStatements'));
const ExpenseDetailReport = React.lazy(() => import('./ExpenseDetailReport'));
const BudgetVsActualReport = React.lazy(() => import('./BudgetVsActualReport'));
const PayrollRegister = React.lazy(() => import('./PayrollRegister'));
const RevenueByClient = React.lazy(() => import('./RevenueByClient'));
const VendorSpendReport = React.lazy(() => import('./VendorSpendReport'));
const ProjectProfitability = React.lazy(() => import('./ProjectProfitability'));
const IncomeByMonth = React.lazy(() => import('./IncomeByMonth'));
const DebtCollectionReport = React.lazy(() => import('./DebtCollectionReport'));
const InventoryValuation = React.lazy(() => import('./InventoryValuation'));
const SalesTaxReport = React.lazy(() => import('./SalesTaxReport'));

// ─── Report title map ───────────────────────────────────
const REPORT_TITLES: Record<ReportType, string> = {
  'profit-and-loss': 'Profit & Loss',
  'balance-sheet': 'Balance Sheet',
  'cash-flow': 'Cash Flow Statement',
  'cash-flow-forecast': 'Cash Flow Forecast',
  'customer-profitability': 'Customer Profitability',
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
  'revenue-by-client': 'Revenue by Client',
  'vendor-spend': 'Vendor Spend Analysis',
  'project-profitability': 'Project Profitability',
  'income-by-month': 'Income by Month',
  'debt-collection': 'Debt Collection Report',
  'inventory-valuation': 'Inventory Valuation',
  'sales-tax': 'Sales Tax Report',
};

// ─── LocalStorage keys ──────────────────────────────────
const LS_RECENT = 'bap-reports-recent';
const LS_FAVORITES = 'bap-reports-favorites';

function getRecentReports(): ReportType[] {
  try {
    const raw = localStorage.getItem(LS_RECENT);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function addRecentReport(id: ReportType) {
  const recent = getRecentReports().filter((r) => r !== id);
  recent.unshift(id);
  localStorage.setItem(LS_RECENT, JSON.stringify(recent.slice(0, 5)));
}

function getFavoriteReports(): ReportType[] {
  try {
    const raw = localStorage.getItem(LS_FAVORITES);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function toggleFavoriteReport(id: ReportType): ReportType[] {
  const favs = getFavoriteReports();
  const idx = favs.indexOf(id);
  if (idx >= 0) favs.splice(idx, 1);
  else favs.push(id);
  localStorage.setItem(LS_FAVORITES, JSON.stringify(favs));
  return favs;
}

// ─── Quick Stats Component ──────────────────────────────
const QuickStats: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [stats, setStats] = useState<{ revenue: number; expenses: number; netIncome: number; cashBalance: number } | null>(null);

  useEffect(() => {
    if (!activeCompany) return;
    const year = new Date().getFullYear();
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    const load = async () => {
      try {
        const [revRows, expRows, cashRows] = await Promise.all([
          api.rawQuery(
            `SELECT COALESCE(SUM(total), 0) as total FROM invoices WHERE company_id = ? AND status IN ('paid','partial') AND issue_date >= ? AND issue_date <= ?`,
            [activeCompany.id, startDate, endDate]
          ),
          api.rawQuery(
            `SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE company_id = ? AND date >= ? AND date <= ?`,
            [activeCompany.id, startDate, endDate]
          ),
          api.rawQuery(
            `SELECT COALESCE(SUM(CASE WHEN a.subtype IN ('cash','checking','savings') THEN jel.debit - jel.credit ELSE 0 END), 0) as balance FROM journal_entry_lines jel JOIN accounts a ON a.id = jel.account_id JOIN journal_entries je ON je.id = jel.journal_entry_id WHERE je.company_id = ?`,
            [activeCompany.id]
          ),
        ]);
        const revenue = Number(revRows?.[0]?.total) || 0;
        const expenses = Number(expRows?.[0]?.total) || 0;
        setStats({
          revenue,
          expenses,
          netIncome: revenue - expenses,
          cashBalance: Number(cashRows?.[0]?.balance) || 0,
        });
      } catch {
        // Silently fail — stats are supplementary
      }
    };
    load();
  }, [activeCompany]);

  if (!stats) return null;

  const cards = [
    { label: 'YTD Revenue', value: formatCurrency(stats.revenue), icon: TrendingUp, accent: 'text-accent-income' },
    { label: 'YTD Expenses', value: formatCurrency(stats.expenses), icon: TrendingDown, accent: 'text-accent-expense' },
    { label: 'Net Income', value: formatCurrency(stats.netIncome), icon: DollarSign, accent: stats.netIncome >= 0 ? 'text-accent-income' : 'text-accent-expense' },
    { label: 'Cash Balance', value: formatCurrency(stats.cashBalance), icon: Wallet, accent: 'text-accent-blue' },
  ];

  return (
    <div className="grid grid-cols-4 gap-4">
      {cards.map((c) => {
        const Icon = c.icon;
        return (
          <div
            key={c.label}
            className="block-card p-4 flex items-center gap-3"
            style={{ borderRadius: '6px' }}
          >
            <div
              className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary shrink-0"
              style={{ borderRadius: '6px' }}
            >
              <Icon size={16} className={c.accent} />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">{c.label}</div>
              <div className={`text-sm font-bold ${c.accent} font-mono`}>{c.value}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
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
  const [favorites, setFavorites] = useState<ReportType[]>(getFavoriteReports);
  const [recentReports, setRecentReports] = useState<ReportType[]>(getRecentReports);

  const handleSelect = useCallback((report: ReportType) => {
    addRecentReport(report);
    setRecentReports(getRecentReports());
    setActiveReport(report);
  }, []);

  const handleToggleFavorite = useCallback((report: ReportType) => {
    const updated = toggleFavoriteReport(report);
    setFavorites([...updated]);
  }, []);

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
      case 'cash-flow-forecast':
        return <Suspense fallback={<LazyFallback />}><CashFlowForecast /></Suspense>;
      case 'customer-profitability':
        return <Suspense fallback={<LazyFallback />}><CustomerProfitability /></Suspense>;
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
      case 'revenue-by-client':
        return <Suspense fallback={<LazyFallback />}><RevenueByClient /></Suspense>;
      case 'vendor-spend':
        return <Suspense fallback={<LazyFallback />}><VendorSpendReport /></Suspense>;
      case 'project-profitability':
        return <Suspense fallback={<LazyFallback />}><ProjectProfitability /></Suspense>;
      case 'income-by-month':
        return <Suspense fallback={<LazyFallback />}><IncomeByMonth /></Suspense>;
      case 'debt-collection':
        return <Suspense fallback={<LazyFallback />}><DebtCollectionReport /></Suspense>;
      case 'inventory-valuation':
        return <Suspense fallback={<LazyFallback />}><InventoryValuation /></Suspense>;
      case 'sales-tax':
        return <Suspense fallback={<LazyFallback />}><SalesTaxReport /></Suspense>;
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
        <div className="space-y-6">
          {/* Quick Financial Stats */}
          <QuickStats />

          {/* Favorites */}
          {favorites.length > 0 && (
            <div>
              <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Star size={12} className="text-accent-warning" />
                Favorite Reports
              </h3>
              <div className="flex flex-wrap gap-2">
                {favorites.map((id) => (
                  <button
                    key={id}
                    onClick={() => handleSelect(id)}
                    className="block-card px-4 py-2 text-xs font-semibold text-text-primary hover:bg-bg-hover transition-colors cursor-pointer flex items-center gap-2"
                    style={{ borderRadius: '6px' }}
                  >
                    <Star size={12} className="text-accent-warning fill-accent-warning" />
                    {REPORT_TITLES[id]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Recently Viewed */}
          {recentReports.length > 0 && (
            <div>
              <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Clock size={12} />
                Recently Viewed
              </h3>
              <div className="flex flex-wrap gap-2">
                {recentReports.map((id) => (
                  <button
                    key={id}
                    onClick={() => handleSelect(id)}
                    className="block-card px-4 py-2 text-xs font-medium text-text-secondary hover:bg-bg-hover transition-colors cursor-pointer flex items-center gap-2"
                    style={{ borderRadius: '6px' }}
                  >
                    <Clock size={12} className="text-text-muted" />
                    {REPORT_TITLES[id]}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleToggleFavorite(id); }}
                      className="ml-1 hover:text-accent-warning transition-colors"
                      title={favorites.includes(id) ? 'Unfavorite' : 'Add to favorites'}
                    >
                      <Star
                        size={11}
                        className={favorites.includes(id) ? 'text-accent-warning fill-accent-warning' : 'text-text-muted'}
                      />
                    </button>
                  </button>
                ))}
              </div>
            </div>
          )}

          <ReportSelector onSelect={handleSelect} />
        </div>
      )}
    </div>
  );
};

export default ReportsModule;
