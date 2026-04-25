import React, { useEffect, useState, useMemo } from 'react';
import { ArrowLeft, BarChart3, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import { addMonths, format, parseISO } from 'date-fns';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate } from '../../lib/format';

// ─── Types ──────────────────────────────────────────────
interface Budget {
  id: string;
  name: string;
  period: string;
  start_date: string;
  end_date: string;
  status: string;
}

interface BudgetLine {
  id: string;
  budget_id: string;
  category: string;
  amount: number;
}

interface LineWithActual extends BudgetLine {
  actual: number;
  remaining: number;
  percentUsed: number;
  variance: number;
  overBudget: boolean;
}

interface MonthBucket {
  month: string;       // e.g. "2025-01"
  label: string;       // e.g. "Jan 2025"
  budgeted: number;
  actual: number;
  variance: number;
}

interface BudgetDetailProps {
  budgetId: string;
  onBack: () => void;
  onEdit?: (id: string) => void;
}

// ─── Progress Bar Color ─────────────────────────────────
function progressColor(pct: number): string {
  if (pct > 100) return 'var(--color-accent-expense)';
  if (pct > 85)  return 'var(--color-accent-warning)';
  return 'var(--color-accent-income)';
}

// ─── Months Between Two Dates ────────────────────────────
// `start`/`end` are 'YYYY-MM' strings. parseISO + addMonths keeps the
// arithmetic in local time (avoiding the UTC midnight drift of `new Date(s)`)
// and toISOString().slice(0,7) was returning the UTC month, so a date in
// the last hours of a month would jump to the next month for users west
// of UTC. Use format() in local time instead.
function monthsBetween(start: string, end: string): { month: string; label: string }[] {
  const result: { month: string; label: string }[] = [];
  const s = parseISO(start + '-01');
  const e = parseISO(end + '-01');
  let cur = s;
  // Guard against runaway loops if end < start.
  let safety = 600;
  while (cur <= e && safety-- > 0) {
    const month = format(cur, 'yyyy-MM');
    const label = format(cur, 'MMM yyyy');
    result.push({ month, label });
    cur = addMonths(cur, 1);
  }
  return result;
}

// ─── Mini Bar Chart ─────────────────────────────────────
function MiniBarChart({ months }: { months: MonthBucket[] }) {
  const maxVal = Math.max(...months.flatMap(m => [m.budgeted, m.actual]), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80, padding: '0 4px' }}>
      {months.map((m) => {
        const bH = (m.budgeted / maxVal) * 72;
        const aH = (m.actual / maxVal) * 72;
        const over = m.actual > m.budgeted;
        return (
          <div key={m.month} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 72 }}>
              <div
                title={`Budgeted: ${formatCurrency(m.budgeted)}`}
                style={{ width: 8, height: bH, background: 'var(--color-accent-blue)', borderRadius: '2px 2px 0 0', opacity: 0.5 }}
              />
              <div
                title={`Actual: ${formatCurrency(m.actual)}`}
                style={{ width: 8, height: aH, background: over ? 'var(--color-accent-expense)' : 'var(--color-accent-income)', borderRadius: '2px 2px 0 0' }}
              />
            </div>
            <span style={{ fontSize: 9, color: 'var(--color-text-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 32 }}>
              {m.label.split(' ')[0]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Component ──────────────────────────────────────────
const BudgetDetail: React.FC<BudgetDetailProps> = ({ budgetId, onBack, onEdit }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [lines, setLines] = useState<BudgetLine[]>([]);
  const [actuals, setActuals] = useState<Record<string, number>>({});
  const [monthlyActuals, setMonthlyActuals] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'monthly' | 'alerts'>('overview');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [budgetData, linesData] = await Promise.all([
          api.get('budgets', budgetId),
          api.query('budget_lines', { budget_id: budgetId }),
        ]);
        if (cancelled) return;

        const b = budgetData as Budget;
        setBudget(b);
        const linesList = Array.isArray(linesData) ? linesData : [];
        setLines(linesList);

        if (b && linesList.length > 0 && activeCompany) {
          // Per-category actuals
          const expenseData = await api.rawQuery(
            `SELECT c.name as category, COALESCE(SUM(e.amount), 0) as total
             FROM expenses e
             LEFT JOIN categories c ON e.category_id = c.id
             WHERE e.company_id = ? AND date(e.date) BETWEEN date(?) AND date(?)
             GROUP BY c.name`,
            [activeCompany.id, b.start_date, b.end_date]
          );
          if (!cancelled && Array.isArray(expenseData)) {
            const map: Record<string, number> = {};
            for (const row of expenseData) {
              if (row.category) map[String(row.category).toLowerCase()] = Number(row.total) || 0;
            }
            setActuals(map);
          }

          // Monthly actuals (for the chart)
          const monthlyData = await api.rawQuery(
            `SELECT strftime('%Y-%m', e.date) as month, COALESCE(SUM(e.amount), 0) as total
             FROM expenses e
             WHERE e.company_id = ? AND date(e.date) BETWEEN date(?) AND date(?)
             GROUP BY month ORDER BY month`,
            [activeCompany.id, b.start_date, b.end_date]
          );
          if (!cancelled && Array.isArray(monthlyData)) {
            const map: Record<string, number> = {};
            for (const row of monthlyData) {
              if (row.month) map[row.month] = row.total || 0;
            }
            setMonthlyActuals(map);
          }
        }
      } catch (err) {
        console.error('Failed to load budget detail:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [budgetId, activeCompany]);

  const linesWithActual: LineWithActual[] = useMemo(() => {
    return lines.map((line) => {
      const actual = actuals[(line.category || '').toLowerCase()] || 0;
      const remaining = line.amount - actual;
      const percentUsed = line.amount > 0 ? (actual / line.amount) * 100 : 0;
      const variance = line.amount - actual;
      return { ...line, actual, remaining, percentUsed, variance, overBudget: actual > line.amount };
    });
  }, [lines, actuals]);

  const totals = useMemo(() => {
    return linesWithActual.reduce(
      (acc, l) => ({
        budgeted: acc.budgeted + l.amount,
        actual: acc.actual + l.actual,
        remaining: acc.remaining + l.remaining,
      }),
      { budgeted: 0, actual: 0, remaining: 0 }
    );
  }, [linesWithActual]);

  const totalPct = totals.budgeted > 0 ? (totals.actual / totals.budgeted) * 100 : 0;

  // Monthly breakdown
  const monthBuckets: MonthBucket[] = useMemo(() => {
    if (!budget) return [];
    const startM = budget.start_date.slice(0, 7);
    const endM = budget.end_date.slice(0, 7);
    const months = monthsBetween(startM, endM);
    const totalBudgeted = totals.budgeted;
    const monthCount = months.length || 1;
    const monthlyBudget = totalBudgeted / monthCount;
    return months.map(({ month, label }) => {
      const actual = monthlyActuals[month] || 0;
      return { month, label, budgeted: monthlyBudget, actual, variance: monthlyBudget - actual };
    });
  }, [budget, monthlyActuals, totals.budgeted]);

  const overBudgetLines = linesWithActual.filter(l => l.overBudget);
  const nearLimitLines = linesWithActual.filter(l => !l.overBudget && l.percentUsed >= 80);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading budget...
      </div>
    );
  }

  if (!budget) {
    return (
      <div className="space-y-4">
        <button className="block-btn flex items-center gap-2 text-xs" onClick={onBack}>
          <ArrowLeft size={14} /> Back
        </button>
        <div className="empty-state">
          <p className="text-sm text-text-secondary">Budget not found.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button className="block-btn flex items-center gap-2 text-xs" onClick={onBack}>
          <ArrowLeft size={14} /> Back
        </button>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-text-primary">{budget.name}</h2>
          <p className="text-xs text-text-muted mt-0.5">
            {budget.period} · {formatDate(budget.start_date)} to {formatDate(budget.end_date)}
          </p>
        </div>
        {(overBudgetLines.length > 0) && (
          <span className="flex items-center gap-1 text-xs text-accent-expense font-semibold">
            <AlertTriangle size={13} /> {overBudgetLines.length} over budget
          </span>
        )}
        <span className={`block-badge ${budget.status === 'active' ? 'block-badge-income' : 'block-badge-warning'} capitalize`}>
          {budget.status}
        </span>
        {onEdit && (
          <button className="block-btn flex items-center gap-2 text-xs" onClick={() => onEdit(budgetId)}>
            <TrendingUp size={14} /> Edit
          </button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="block-card p-4 border-l-2 border-l-accent-blue" style={{ borderRadius: '6px' }}>
          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Total Budgeted</span>
          <p className="text-2xl font-mono text-text-primary mt-1">{formatCurrency(totals.budgeted)}</p>
        </div>
        <div className="block-card p-4 border-l-2 border-l-accent-expense" style={{ borderRadius: '6px' }}>
          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Actual Spent</span>
          <p className="text-2xl font-mono text-text-primary mt-1">{formatCurrency(totals.actual)}</p>
        </div>
        <div className="block-card p-4 border-l-2 border-l-accent-income" style={{ borderRadius: '6px' }}>
          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Remaining</span>
          <p className={`text-2xl font-mono mt-1 ${totals.remaining >= 0 ? 'text-accent-income' : 'text-accent-expense'}`}>
            {formatCurrency(Math.abs(totals.remaining))}
            {totals.remaining < 0 && <span className="text-xs ml-1">over</span>}
          </p>
        </div>
        <div className="block-card p-4 border-l-2 border-l-accent-warning" style={{ borderRadius: '6px' }}>
          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">% Used</span>
          <p className="text-2xl font-mono text-text-primary mt-1">{totalPct.toFixed(1)}%</p>
          <div className="w-full h-2 mt-2 bg-bg-tertiary overflow-hidden" style={{ borderRadius: '6px' }}>
            <div style={{
              width: `${Math.min(100, totalPct)}%`,
              backgroundColor: progressColor(totalPct),
              height: '100%', borderRadius: '6px', transition: 'width 0.3s ease',
            }} />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-border-primary">
        {(['overview', 'monthly', 'alerts'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors capitalize ${
              activeTab === tab
                ? 'border-accent-blue text-accent-blue'
                : 'border-transparent text-text-muted hover:text-text-secondary transition-colors'
            }`}
          >
            {tab === 'alerts' ? `Alerts (${overBudgetLines.length + nearLimitLines.length})` : tab === 'monthly' ? 'Monthly Trend' : 'Category Breakdown'}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        linesWithActual.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><BarChart3 size={24} className="text-text-muted" /></div>
            <p className="text-sm text-text-secondary font-medium">No budget line items</p>
          </div>
        ) : (
          <div className="block-card p-0 overflow-hidden">
            <table className="block-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="text-right">Budgeted</th>
                  <th className="text-right">Actual</th>
                  <th className="text-right">Variance</th>
                  <th className="text-right">% Used</th>
                  <th style={{ width: '160px' }}>Progress</th>
                </tr>
              </thead>
              <tbody>
                {linesWithActual.map((line) => (
                  <tr key={line.id} style={line.overBudget ? { background: 'rgba(239,68,68,0.05)' } : {}}>
                    <td className="text-text-primary font-medium text-sm flex items-center gap-1.5">
                      {line.overBudget && <AlertTriangle size={11} className="text-accent-expense flex-shrink-0" />}
                      {line.category}
                    </td>
                    <td className="text-right font-mono text-text-secondary text-sm">{formatCurrency(line.amount)}</td>
                    <td className={`text-right font-mono text-sm ${line.overBudget ? 'text-accent-expense font-semibold' : 'text-text-secondary'}`}>
                      {formatCurrency(line.actual)}
                    </td>
                    <td className={`text-right font-mono text-sm ${line.variance >= 0 ? 'text-accent-income' : 'text-accent-expense'}`}>
                      {line.variance >= 0 ? '+' : ''}{formatCurrency(line.variance)}
                    </td>
                    <td className="text-right font-mono text-text-secondary text-sm">{line.percentUsed.toFixed(1)}%</td>
                    <td>
                      <div className="w-full h-3 bg-bg-tertiary overflow-hidden" style={{ borderRadius: '6px' }}>
                        <div style={{
                          width: `${Math.min(100, line.percentUsed)}%`,
                          backgroundColor: progressColor(line.percentUsed),
                          height: '100%', borderRadius: '6px', transition: 'width 0.3s ease',
                        }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="text-xs font-semibold text-text-muted uppercase tracking-wider">Totals</td>
                  <td className="text-right font-mono font-bold text-text-primary">{formatCurrency(totals.budgeted)}</td>
                  <td className={`text-right font-mono font-bold ${totals.actual > totals.budgeted ? 'text-accent-expense' : 'text-text-primary'}`}>
                    {formatCurrency(totals.actual)}
                  </td>
                  <td className={`text-right font-mono font-bold ${totals.remaining >= 0 ? 'text-accent-income' : 'text-accent-expense'}`}>
                    {totals.remaining >= 0 ? '+' : ''}{formatCurrency(totals.remaining)}
                  </td>
                  <td className="text-right font-mono font-bold text-text-primary">{totalPct.toFixed(1)}%</td>
                  <td>
                    <div className="w-full h-3 bg-bg-tertiary overflow-hidden" style={{ borderRadius: '6px' }}>
                      <div style={{
                        width: `${Math.min(100, totalPct)}%`,
                        backgroundColor: progressColor(totalPct),
                        height: '100%', borderRadius: '6px',
                      }} />
                    </div>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )
      )}

      {/* Monthly Trend Tab */}
      {activeTab === 'monthly' && (
        <div className="space-y-4">
          <div className="block-card p-4" style={{ borderRadius: '6px' }}>
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp size={14} className="text-text-muted" />
              <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Monthly Spend vs Budget</span>
              <span className="ml-auto flex items-center gap-3 text-xs text-text-muted">
                <span className="flex items-center gap-1">
                  <span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--color-accent-blue)', opacity: 0.5, borderRadius: 1 }} /> Budget
                </span>
                <span className="flex items-center gap-1">
                  <span style={{ display: 'inline-block', width: 8, height: 8, background: 'var(--color-accent-income)', borderRadius: 1 }} /> Actual
                </span>
              </span>
            </div>
            {monthBuckets.length > 0 ? (
              <MiniBarChart months={monthBuckets} />
            ) : (
              <p className="text-xs text-text-muted italic">No monthly data available.</p>
            )}
          </div>

          <div className="block-card p-0 overflow-hidden">
            <table className="block-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="text-right">Budgeted</th>
                  <th className="text-right">Actual</th>
                  <th className="text-right">Variance</th>
                  <th className="text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {monthBuckets.map(m => (
                  <tr key={m.month}>
                    <td className="font-medium text-text-primary text-sm">{m.label}</td>
                    <td className="text-right font-mono text-text-secondary text-sm">{formatCurrency(m.budgeted)}</td>
                    <td className={`text-right font-mono text-sm ${m.actual > m.budgeted ? 'text-accent-expense' : 'text-text-secondary'}`}>
                      {formatCurrency(m.actual)}
                    </td>
                    <td className={`text-right font-mono text-sm ${m.variance >= 0 ? 'text-accent-income' : 'text-accent-expense'}`}>
                      {m.variance >= 0 ? '+' : ''}{formatCurrency(m.variance)}
                    </td>
                    <td className="text-right">
                      {m.actual === 0
                        ? <span className="text-xs text-text-muted">No data</span>
                        : m.actual > m.budgeted
                          ? <span className="block-badge block-badge-expense text-[10px]">Over</span>
                          : m.actual / m.budgeted > 0.85
                            ? <span className="block-badge block-badge-warning text-[10px]">Near</span>
                            : <span className="block-badge block-badge-income text-[10px]">On Track</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Alerts Tab */}
      {activeTab === 'alerts' && (
        <div className="space-y-3">
          {overBudgetLines.length === 0 && nearLimitLines.length === 0 ? (
            <div className="block-card p-8 text-center">
              <TrendingDown size={28} className="text-accent-income mx-auto mb-2" />
              <p className="text-sm font-semibold text-text-primary">All categories within budget</p>
              <p className="text-xs text-text-muted mt-1">No alerts to display.</p>
            </div>
          ) : (
            <>
              {overBudgetLines.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-accent-expense uppercase tracking-wider mb-2">Over Budget</p>
                  {overBudgetLines.map(l => (
                    <div key={l.id} className="block-card p-4 mb-2 border-l-2 border-l-accent-expense flex items-center justify-between" style={{ borderRadius: '6px' }}>
                      <div>
                        <p className="text-sm font-semibold text-text-primary">{l.category}</p>
                        <p className="text-xs text-text-muted mt-0.5">
                          Spent {formatCurrency(l.actual)} of {formatCurrency(l.amount)} budgeted
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-mono font-bold text-accent-expense">{formatCurrency(Math.abs(l.variance))} over</p>
                        <p className="text-xs text-text-muted">{l.percentUsed.toFixed(0)}% used</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {nearLimitLines.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-accent-warning uppercase tracking-wider mb-2">Approaching Limit (≥80%)</p>
                  {nearLimitLines.map(l => (
                    <div key={l.id} className="block-card p-4 mb-2 border-l-2 border-l-accent-warning flex items-center justify-between" style={{ borderRadius: '6px' }}>
                      <div>
                        <p className="text-sm font-semibold text-text-primary">{l.category}</p>
                        <p className="text-xs text-text-muted mt-0.5">
                          Spent {formatCurrency(l.actual)} of {formatCurrency(l.amount)} budgeted
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-mono font-bold text-accent-warning">{formatCurrency(l.remaining)} left</p>
                        <p className="text-xs text-text-muted">{l.percentUsed.toFixed(0)}% used</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default BudgetDetail;
