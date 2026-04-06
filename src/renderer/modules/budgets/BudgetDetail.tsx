import React, { useEffect, useState, useMemo } from 'react';
import { ArrowLeft, BarChart3 } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

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
}

interface BudgetDetailProps {
  budgetId: string;
  onBack: () => void;
}

// ─── Currency Formatter ─────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// ─── Progress Bar Color ─────────────────────────────────
function progressColor(pct: number): string {
  if (pct > 90) return '#ef4444';   // red
  if (pct > 75) return '#eab308';   // yellow
  return '#22c55e';                  // green
}

// ─── Component ──────────────────────────────────────────
const BudgetDetail: React.FC<BudgetDetailProps> = ({ budgetId, onBack }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [lines, setLines] = useState<BudgetLine[]>([]);
  const [actuals, setActuals] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

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

        // Query actual expenses per category within budget date range
        if (b && linesList.length > 0 && activeCompany) {
          const expenseData = await api.rawQuery(
            `SELECT c.name as category, COALESCE(SUM(e.amount), 0) as total
             FROM expenses e
             LEFT JOIN categories c ON e.category_id = c.id
             WHERE e.company_id = ? AND e.date BETWEEN ? AND ?
             GROUP BY c.name`,
            [activeCompany.id, b.start_date, b.end_date]
          );
          if (cancelled) return;
          const map: Record<string, number> = {};
          if (Array.isArray(expenseData)) {
            for (const row of expenseData) {
              if (row.category) {
                map[row.category.toLowerCase()] = row.total || 0;
              }
            }
          }
          setActuals(map);
        }
      } catch (err) {
        console.error('Failed to load budget detail:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [budgetId]);

  const linesWithActual: LineWithActual[] = useMemo(() => {
    return lines.map((line) => {
      const actual = actuals[line.category.toLowerCase()] || 0;
      const remaining = line.amount - actual;
      const percentUsed = line.amount > 0 ? (actual / line.amount) * 100 : 0;
      return { ...line, actual, remaining, percentUsed };
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
            {budget.period} &middot; {budget.start_date} to {budget.end_date}
          </p>
        </div>
        <span
          className={`block-badge ${
            budget.status === 'active'
              ? 'block-badge-income'
              : budget.status === 'draft'
              ? 'block-badge-warning'
              : ''
          }`}
        >
          {budget.status}
        </span>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="block-card p-4 border-l-2 border-l-accent-blue" style={{ borderRadius: '6px' }}>
          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
            Total Budgeted
          </span>
          <p className="text-2xl font-mono text-text-primary mt-1">{fmt.format(totals.budgeted)}</p>
        </div>
        <div className="block-card p-4 border-l-2 border-l-accent-expense" style={{ borderRadius: '6px' }}>
          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
            Actual Spent
          </span>
          <p className="text-2xl font-mono text-text-primary mt-1">{fmt.format(totals.actual)}</p>
        </div>
        <div className="block-card p-4 border-l-2 border-l-accent-income" style={{ borderRadius: '6px' }}>
          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
            Remaining
          </span>
          <p className={`text-2xl font-mono mt-1 ${totals.remaining >= 0 ? 'text-accent-income' : 'text-accent-expense'}`}>
            {fmt.format(totals.remaining)}
          </p>
        </div>
        <div className="block-card p-4 border-l-2 border-l-accent-warning" style={{ borderRadius: '6px' }}>
          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
            % Used
          </span>
          <p className="text-2xl font-mono text-text-primary mt-1">{totalPct.toFixed(1)}%</p>
          {/* Overall progress bar */}
          <div
            className="w-full h-2 mt-2 bg-bg-tertiary overflow-hidden"
            style={{ borderRadius: '6px' }}
          >
            <div
              style={{
                width: `${Math.min(100, totalPct)}%`,
                backgroundColor: progressColor(totalPct),
                height: '100%',
                borderRadius: '6px',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
        </div>
      </div>

      {/* Line Items Table */}
      {linesWithActual.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <BarChart3 size={24} className="text-text-muted" />
          </div>
          <p className="text-sm text-text-secondary font-medium">No budget line items</p>
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden">
          <table className="block-table">
            <thead>
              <tr>
                <th>Category</th>
                <th className="text-right">Budgeted</th>
                <th className="text-right">Actual Spent</th>
                <th className="text-right">Remaining</th>
                <th className="text-right">% Used</th>
                <th style={{ width: '180px' }}>Progress</th>
              </tr>
            </thead>
            <tbody>
              {linesWithActual.map((line) => (
                <tr key={line.id}>
                  <td className="text-text-primary font-medium text-sm">{line.category}</td>
                  <td className="text-right font-mono text-text-secondary text-sm">
                    {fmt.format(line.amount)}
                  </td>
                  <td className="text-right font-mono text-accent-expense text-sm">
                    {fmt.format(line.actual)}
                  </td>
                  <td
                    className={`text-right font-mono text-sm ${
                      line.remaining >= 0 ? 'text-accent-income' : 'text-accent-expense'
                    }`}
                  >
                    {fmt.format(line.remaining)}
                  </td>
                  <td className="text-right font-mono text-text-secondary text-sm">
                    {line.percentUsed.toFixed(1)}%
                  </td>
                  <td>
                    <div
                      className="w-full h-3 bg-bg-tertiary overflow-hidden"
                      style={{ borderRadius: '6px' }}
                    >
                      <div
                        style={{
                          width: `${Math.min(100, line.percentUsed)}%`,
                          backgroundColor: progressColor(line.percentUsed),
                          height: '100%',
                          borderRadius: '6px',
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="text-right text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Totals
                </td>
                <td className="text-right font-mono font-bold text-text-primary">
                  {fmt.format(totals.budgeted)}
                </td>
                <td className="text-right font-mono font-bold text-accent-expense">
                  {fmt.format(totals.actual)}
                </td>
                <td
                  className={`text-right font-mono font-bold ${
                    totals.remaining >= 0 ? 'text-accent-income' : 'text-accent-expense'
                  }`}
                >
                  {fmt.format(totals.remaining)}
                </td>
                <td className="text-right font-mono font-bold text-text-primary">
                  {totalPct.toFixed(1)}%
                </td>
                <td>
                  <div
                    className="w-full h-3 bg-bg-tertiary overflow-hidden"
                    style={{ borderRadius: '6px' }}
                  >
                    <div
                      style={{
                        width: `${Math.min(100, totalPct)}%`,
                        backgroundColor: progressColor(totalPct),
                        height: '100%',
                        borderRadius: '6px',
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
};

export default BudgetDetail;
