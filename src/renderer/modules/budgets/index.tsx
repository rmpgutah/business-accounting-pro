import React, { useState, useEffect, useMemo } from 'react';
import {
  Wallet,
  LayoutDashboard,
  List,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Target,
  Activity,
  CheckCircle,
  XCircle,
  DollarSign,
} from 'lucide-react';
import BudgetList from './BudgetList';
import BudgetForm from './BudgetForm';
import BudgetDetail from './BudgetDetail';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate } from '../../lib/format';

type View = 'list' | 'new' | 'edit' | 'detail';
type TabId = 'dashboard' | 'list';

interface Budget {
  id: string;
  name: string;
  period: 'monthly' | 'quarterly' | 'annual';
  start_date: string;
  end_date: string;
  status: 'active' | 'closed';
}

interface BudgetLine {
  id: string;
  budget_id: string;
  account_id: string | null;
  category: string;
  amount: number;
}

interface BudgetActuals {
  budget: Budget;
  lines: BudgetLine[];
  budgeted: number;
  actual: number;
  variance: number;
  variancePct: number;
  utilizationPct: number;
  daysTotal: number;
  daysElapsed: number;
  daysRemaining: number;
  projectedEnd: number;
  status: 'on_track' | 'warning' | 'critical' | 'over';
}

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={14} /> },
  { id: 'list', label: 'All Budgets', icon: <List size={14} /> },
];

const HEALTH_COLORS = {
  on_track: '#22c55e',
  warning: '#eab308',
  critical: '#f97316',
  over: '#ef4444',
};

const computeBudgetHealth = (
  utilizationPct: number
): BudgetActuals['status'] => {
  if (utilizationPct > 100) return 'over';
  if (utilizationPct >= 90) return 'critical';
  if (utilizationPct >= 70) return 'warning';
  return 'on_track';
};

const StatusDot: React.FC<{ status: BudgetActuals['status'] }> = ({ status }) => (
  <span
    style={{
      display: 'inline-block',
      width: 8,
      height: 8,
      borderRadius: '50%',
      backgroundColor: HEALTH_COLORS[status],
    }}
  />
);

const BudgetModule: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [view, setView] = useState<View>('list');
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [selectedBudgetId, setSelectedBudgetId] = useState<string | null>(null);
  const [budgetActuals, setBudgetActuals] = useState<BudgetActuals[]>([]);
  const [loading, setLoading] = useState(true);

  const handleSelect = (id: string) => {
    setSelectedBudgetId(id);
    setView('detail');
  };

  const handleCreated = (id: string) => {
    setSelectedBudgetId(id);
    setView('detail');
  };

  // Load budgets + compute actuals from journal entries
  useEffect(() => {
    if (!activeCompany || view !== 'list') return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const budgets: Budget[] = await api.query(
          'budgets',
          { company_id: activeCompany.id },
          { field: 'start_date', dir: 'desc' }
        );
        if (cancelled) return;
        if (!budgets || budgets.length === 0) {
          setBudgetActuals([]);
          setLoading(false);
          return;
        }

        const today = new Date();
        const results: BudgetActuals[] = [];
        for (const budget of budgets) {
          const lines: BudgetLine[] = await api.query('budget_lines', {
            budget_id: budget.id,
          });
          if (cancelled) return;
          const budgeted = (lines || []).reduce(
            (s, l) => s + (Number(l.amount) || 0),
            0
          );

          // Compute actual from journal entries (debits to budget account_ids in period)
          const accountIds = (lines || [])
            .map((l) => l.account_id)
            .filter((x): x is string => !!x);

          let actual = 0;
          if (accountIds.length > 0) {
            try {
              const placeholders = accountIds.map(() => '?').join(',');
              const rows: any[] = await api.rawQuery(
                `SELECT SUM(jel.debit - jel.credit) AS spend
                 FROM journal_entry_lines jel
                 JOIN journal_entries je ON je.id = jel.journal_entry_id
                 WHERE je.company_id = ?
                   AND jel.account_id IN (${placeholders})
                   AND je.date >= ? AND je.date <= ?`,
                [
                  activeCompany.id,
                  ...accountIds,
                  budget.start_date,
                  budget.end_date,
                ]
              );
              actual = Number(rows?.[0]?.spend) || 0;
            } catch {
              actual = 0;
            }
          }

          const variance = budgeted - actual;
          const variancePct = budgeted > 0 ? (variance / budgeted) * 100 : 0;
          const utilizationPct =
            budgeted > 0 ? (actual / budgeted) * 100 : 0;

          const start = new Date(budget.start_date);
          const end = new Date(budget.end_date);
          const daysTotal = Math.max(
            1,
            Math.ceil((end.getTime() - start.getTime()) / 86400000)
          );
          const daysElapsed = Math.max(
            0,
            Math.min(
              daysTotal,
              Math.ceil((today.getTime() - start.getTime()) / 86400000)
            )
          );
          const daysRemaining = Math.max(0, daysTotal - daysElapsed);
          const projectedEnd =
            daysElapsed > 0 ? (actual / daysElapsed) * daysTotal : actual;

          results.push({
            budget,
            lines: lines || [],
            budgeted,
            actual,
            variance,
            variancePct,
            utilizationPct,
            daysTotal,
            daysElapsed,
            daysRemaining,
            projectedEnd,
            status: computeBudgetHealth(utilizationPct),
          });
        }
        if (!cancelled) setBudgetActuals(results);
      } catch (err) {
        console.error('Failed to load budget dashboard:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [activeCompany, view]);

  const stats = useMemo(() => {
    const total = budgetActuals.length;
    const active = budgetActuals.filter(
      (b) => b.budget.status === 'active'
    ).length;
    const totalBudgeted = budgetActuals.reduce((s, b) => s + b.budgeted, 0);
    const totalActual = budgetActuals.reduce((s, b) => s + b.actual, 0);
    const totalVariance = totalBudgeted - totalActual;
    const overBudget = budgetActuals.filter(
      (b) => b.utilizationPct > 100
    ).length;
    return { total, active, totalBudgeted, totalActual, totalVariance, overBudget };
  }, [budgetActuals]);

  const alertBudgets = useMemo(
    () =>
      budgetActuals.filter(
        (b) =>
          b.budget.status === 'active' &&
          b.utilizationPct > 90 &&
          b.daysRemaining > 0 &&
          b.daysRemaining / b.daysTotal < 0.25
      ),
    [budgetActuals]
  );

  const topVariance = useMemo(() => {
    return [...budgetActuals]
      .sort((a, b) => Math.abs(b.variancePct) - Math.abs(a.variancePct))
      .slice(0, 5);
  }, [budgetActuals]);

  const renderDashboard = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">
          Loading dashboard...
        </div>
      );
    }
    if (budgetActuals.length === 0) {
      return (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Wallet size={24} className="text-text-muted" />
          </div>
          <p className="text-sm text-text-secondary font-medium">
            No budgets yet
          </p>
          <p className="text-xs text-text-muted mt-1">
            Create a budget to start tracking spending against plan.
          </p>
          <button
            className="block-btn-primary mt-3"
            onClick={() => setView('new')}
          >
            Create Budget
          </button>
        </div>
      );
    }

    const maxBar = Math.max(
      ...budgetActuals.map((b) => Math.max(b.budgeted, b.actual)),
      1
    );

    return (
      <div className="space-y-5">
        {/* Variance alert banner */}
        {alertBudgets.length > 0 && (
          <div
            className="block-card p-3 flex items-start gap-3"
            style={{
              borderRadius: '6px',
              borderColor: 'rgba(239,68,68,0.4)',
              background: 'rgba(239,68,68,0.08)',
            }}
          >
            <AlertTriangle
              size={18}
              className="text-accent-expense flex-shrink-0 mt-0.5"
            />
            <div className="flex-1">
              <div className="text-sm font-semibold text-text-primary">
                {alertBudgets.length} budget
                {alertBudgets.length !== 1 ? 's' : ''} at risk of overrun
              </div>
              <div className="text-xs text-text-muted mt-1">
                Over 90% utilized with less than 25% of period remaining:{' '}
                {alertBudgets.map((b) => b.budget.name).join(', ')}
              </div>
            </div>
          </div>
        )}

        {/* 6 KPI cards */}
        <div className="grid grid-cols-3 gap-4 report-summary-tiles">
          <div className="stat-card" style={{ borderRadius: '6px' }}>
            <div className="flex items-start justify-between">
              <div>
                <div className="stat-label text-text-muted">Total Budgets</div>
                <div className="stat-value font-mono text-text-primary">
                  {stats.total}
                </div>
              </div>
              <Target size={20} className="text-accent-blue opacity-60 mt-1" />
            </div>
          </div>
          <div className="stat-card" style={{ borderRadius: '6px' }}>
            <div className="flex items-start justify-between">
              <div>
                <div className="stat-label text-text-muted">Active</div>
                <div className="stat-value font-mono text-accent-blue">
                  {stats.active}
                </div>
              </div>
              <Activity size={20} className="text-accent-blue opacity-60 mt-1" />
            </div>
          </div>
          <div className="stat-card" style={{ borderRadius: '6px' }}>
            <div className="flex items-start justify-between">
              <div>
                <div className="stat-label text-text-muted">Total Budgeted</div>
                <div className="stat-value font-mono text-text-primary">
                  {formatCurrency(stats.totalBudgeted)}
                </div>
              </div>
              <DollarSign
                size={20}
                className="text-accent-blue opacity-60 mt-1"
              />
            </div>
          </div>
          <div className="stat-card" style={{ borderRadius: '6px' }}>
            <div className="flex items-start justify-between">
              <div>
                <div className="stat-label text-text-muted">Total Actual</div>
                <div className="stat-value font-mono text-accent-expense">
                  {formatCurrency(stats.totalActual)}
                </div>
              </div>
              <TrendingDown
                size={20}
                className="text-accent-expense opacity-60 mt-1"
              />
            </div>
          </div>
          <div className="stat-card" style={{ borderRadius: '6px' }}>
            <div className="flex items-start justify-between">
              <div>
                <div className="stat-label text-text-muted">Total Variance</div>
                <div
                  className={`stat-value font-mono ${
                    stats.totalVariance >= 0
                      ? 'text-accent-income'
                      : 'text-accent-expense'
                  }`}
                >
                  {formatCurrency(stats.totalVariance)}
                </div>
              </div>
              <TrendingUp
                size={20}
                className={`${
                  stats.totalVariance >= 0
                    ? 'text-accent-income'
                    : 'text-accent-expense'
                } opacity-60 mt-1`}
              />
            </div>
          </div>
          <div className="stat-card" style={{ borderRadius: '6px' }}>
            <div className="flex items-start justify-between">
              <div>
                <div className="stat-label text-text-muted">Over Budget</div>
                <div className="stat-value font-mono text-accent-expense">
                  {stats.overBudget}
                </div>
              </div>
              <XCircle
                size={20}
                className="text-accent-expense opacity-60 mt-1"
              />
            </div>
          </div>
        </div>

        {/* Two-column: Health + Top variance */}
        <div className="grid grid-cols-2 gap-4">
          {/* Budget Health Indicators */}
          <div className="block-card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between">
              <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                Budget Health
              </span>
              <span className="text-[10px] text-text-muted">
                {budgetActuals.filter((b) => b.budget.status === 'active').length}{' '}
                active
              </span>
            </div>
            <div className="p-4 space-y-4 max-h-[400px] overflow-y-auto">
              {budgetActuals
                .filter((b) => b.budget.status === 'active')
                .slice(0, 8)
                .map((b) => (
                  <div
                    key={b.budget.id}
                    className="space-y-1.5 cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => handleSelect(b.budget.id)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-text-primary flex items-center gap-2">
                        <StatusDot status={b.status} />
                        {b.budget.name}
                      </span>
                      <span className="text-xs font-mono text-text-secondary">
                        {b.utilizationPct.toFixed(0)}%
                      </span>
                    </div>
                    <div
                      style={{
                        height: 8,
                        background: 'var(--color-bg-tertiary)',
                        borderRadius: '6px',
                        overflow: 'hidden',
                        position: 'relative',
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.min(100, b.utilizationPct)}%`,
                          height: '100%',
                          background: HEALTH_COLORS[b.status],
                          transition: 'width 0.3s',
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-text-muted font-mono">
                      <span>
                        {formatCurrency(b.actual)} /{' '}
                        {formatCurrency(b.budgeted)}
                      </span>
                      <span>
                        {b.daysRemaining}d left | proj{' '}
                        {formatCurrency(b.projectedEnd)}
                      </span>
                    </div>
                  </div>
                ))}
              {budgetActuals.filter((b) => b.budget.status === 'active')
                .length === 0 && (
                <div className="text-xs text-text-muted text-center py-6">
                  No active budgets.
                </div>
              )}
            </div>
          </div>

          {/* Top variance */}
          <div className="block-card p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-border-primary">
              <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                Top Variance
              </span>
            </div>
            <table className="block-table">
              <thead>
                <tr>
                  <th>Budget</th>
                  <th className="text-right">Budgeted</th>
                  <th className="text-right">Actual</th>
                  <th className="text-right">Var %</th>
                </tr>
              </thead>
              <tbody>
                {topVariance.map((b) => (
                  <tr
                    key={b.budget.id}
                    className="cursor-pointer"
                    onClick={() => handleSelect(b.budget.id)}
                  >
                    <td className="text-text-primary text-sm font-medium truncate max-w-[180px]">
                      <span className="inline-flex items-center gap-2">
                        <StatusDot status={b.status} />
                        {b.budget.name}
                      </span>
                    </td>
                    <td className="text-right font-mono text-xs text-text-secondary">
                      {formatCurrency(b.budgeted)}
                    </td>
                    <td className="text-right font-mono text-xs text-text-secondary">
                      {formatCurrency(b.actual)}
                    </td>
                    <td
                      className={`text-right font-mono text-xs ${
                        b.variance >= 0
                          ? 'text-accent-income'
                          : 'text-accent-expense'
                      }`}
                    >
                      {b.variancePct >= 0 ? '+' : ''}
                      {b.variancePct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
                {topVariance.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="text-xs text-text-muted text-center py-6"
                    >
                      No data yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Bar chart: Budget vs Actual */}
        <div className="block-card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-border-primary">
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
              Budget vs Actual
            </span>
          </div>
          <div className="p-4 space-y-3 max-h-[360px] overflow-y-auto">
            {budgetActuals.slice(0, 12).map((b) => {
              const budgetW = (b.budgeted / maxBar) * 100;
              const actualW = (b.actual / maxBar) * 100;
              return (
                <div
                  key={b.budget.id}
                  className="space-y-1 cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => handleSelect(b.budget.id)}
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-text-primary font-medium truncate max-w-[60%]">
                      {b.budget.name}
                    </span>
                    <span className="text-text-muted font-mono">
                      {formatDate(b.budget.start_date)} →{' '}
                      {formatDate(b.budget.end_date)}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div
                      className="flex items-center gap-2"
                      title={`Budgeted: ${formatCurrency(b.budgeted)}`}
                    >
                      <span className="text-[10px] text-text-muted w-14">
                        Budget
                      </span>
                      <div
                        style={{
                          flex: 1,
                          height: 10,
                          background: 'var(--color-bg-tertiary)',
                          borderRadius: '6px',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${budgetW}%`,
                            height: '100%',
                            background: 'var(--color-accent-blue)',
                          }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-text-secondary w-20 text-right">
                        {formatCurrency(b.budgeted)}
                      </span>
                    </div>
                    <div
                      className="flex items-center gap-2"
                      title={`Actual: ${formatCurrency(b.actual)}`}
                    >
                      <span className="text-[10px] text-text-muted w-14">
                        Actual
                      </span>
                      <div
                        style={{
                          flex: 1,
                          height: 10,
                          background: 'var(--color-bg-tertiary)',
                          borderRadius: '6px',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${actualW}%`,
                            height: '100%',
                            background: HEALTH_COLORS[b.status],
                          }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-text-secondary w-20 text-right">
                        {formatCurrency(b.actual)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-[10px] text-text-muted">
          <span className="inline-flex items-center gap-1.5">
            <StatusDot status="on_track" /> On track (&lt;70%)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <StatusDot status="warning" /> Warning (70-90%)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <StatusDot status="critical" /> Critical (90-100%)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <StatusDot status="over" /> Over (&gt;100%)
          </span>
          <span className="inline-flex items-center gap-1.5 ml-auto">
            <CheckCircle size={11} className="text-accent-income" /> Click any
            budget to view details
          </span>
        </div>
      </div>
    );
  };

  // Form / detail short-circuit views
  if (view === 'new') {
    return (
      <div className="p-6 space-y-5 overflow-y-auto h-full">
        <BudgetForm
          onBack={() => setView('list')}
          onCreated={handleCreated}
        />
      </div>
    );
  }
  if (view === 'edit' && selectedBudgetId) {
    return (
      <div className="p-6 space-y-5 overflow-y-auto h-full">
        <BudgetForm
          editBudgetId={selectedBudgetId}
          onBack={() => setView('detail')}
          onCreated={handleCreated}
        />
      </div>
    );
  }
  if (view === 'detail' && selectedBudgetId) {
    return (
      <div className="p-6 space-y-5 overflow-y-auto h-full">
        <BudgetDetail
          budgetId={selectedBudgetId}
          onBack={() => setView('list')}
          onEdit={(id) => {
            setSelectedBudgetId(id);
            setView('edit');
          }}
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary"
          style={{ borderRadius: '6px' }}
        >
          <Wallet size={18} className="text-accent-blue" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-text-primary">
            Budget Management
          </h1>
          <p className="text-xs text-text-muted mt-0.5">
            Track plan vs actual spending across categories and periods.
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border-primary">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold transition-colors border-b-2 -mb-[1px] ${
              activeTab === tab.id
                ? 'text-accent-blue border-accent-blue'
                : 'text-text-muted hover:text-text-primary border-transparent'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'dashboard' && renderDashboard()}
      {activeTab === 'list' && (
        <BudgetList onNew={() => setView('new')} onSelect={handleSelect} />
      )}
    </div>
  );
};

export default BudgetModule;
