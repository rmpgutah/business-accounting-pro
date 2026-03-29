import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, DollarSign, Calculator } from 'lucide-react';
import api from '../../lib/api';

// ─── Currency Formatter ─────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// ─── Types ──────────────────────────────────────────────
interface MonthlyData {
  month: string;
  total: number;
}

interface Projection {
  month: string;
  revenue: number;
  expenses: number;
  net: number;
}

// ─── Linear Regression ──────────────────────────────────
function linearRegression(data: number[]): { slope: number; intercept: number } {
  const n = data.length;
  if (n === 0) return { slope: 0, intercept: 0 };

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (let i = 0; i < n; i++) {
    const x = i + 1;
    const y = data[i];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return { slope: 0, intercept: sumY / n };

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  return { slope, intercept };
}

function projectNext(data: number[], months: number): number[] {
  const { slope, intercept } = linearRegression(data);
  const n = data.length;
  const projections: number[] = [];

  for (let i = 1; i <= months; i++) {
    const projected = slope * (n + i) + intercept;
    projections.push(Math.max(projected, 0)); // no negative projections
  }

  return projections;
}

// ─── Month Name Helper ──────────────────────────────────
function futureMonthLabel(offsetFromNow: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + offsetFromNow);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
}

// ─── Forecasting Component ──────────────────────────────
const Forecasting: React.FC = () => {
  const [projections, setProjections] = useState<Projection[]>([]);
  const [totalProjectedRevenue, setTotalProjectedRevenue] = useState(0);
  const [totalProjectedExpenses, setTotalProjectedExpenses] = useState(0);
  const [totalProjectedCashflow, setTotalProjectedCashflow] = useState(0);
  const [historicalRevenue, setHistoricalRevenue] = useState<MonthlyData[]>([]);
  const [historicalExpenses, setHistoricalExpenses] = useState<MonthlyData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        // Get last 6 months of invoice revenue by month
        const revenueRows: MonthlyData[] = await api.rawQuery(
          `SELECT strftime('%Y-%m', invoice_date) as month,
                  COALESCE(SUM(total), 0) as total
           FROM invoices
           WHERE status IN ('paid', 'sent')
             AND invoice_date >= date('now', '-6 months')
           GROUP BY month
           ORDER BY month ASC`
        );

        // Get last 6 months of expenses by month
        const expenseRows: MonthlyData[] = await api.rawQuery(
          `SELECT strftime('%Y-%m', date) as month,
                  COALESCE(SUM(amount), 0) as total
           FROM expenses
           WHERE date >= date('now', '-6 months')
           GROUP BY month
           ORDER BY month ASC`
        );

        if (cancelled) return;

        setHistoricalRevenue(revenueRows ?? []);
        setHistoricalExpenses(expenseRows ?? []);

        const revValues = (revenueRows ?? []).map((r) => r.total);
        const expValues = (expenseRows ?? []).map((r) => r.total);

        // Project next 3 months
        const projectedRev = projectNext(revValues, 3);
        const projectedExp = projectNext(expValues, 3);

        const projectionRows: Projection[] = [];
        for (let i = 0; i < 3; i++) {
          projectionRows.push({
            month: futureMonthLabel(i + 1),
            revenue: projectedRev[i],
            expenses: projectedExp[i],
            net: projectedRev[i] - projectedExp[i],
          });
        }

        setProjections(projectionRows);

        const totRev = projectedRev.reduce((a, b) => a + b, 0);
        const totExp = projectedExp.reduce((a, b) => a + b, 0);
        setTotalProjectedRevenue(totRev);
        setTotalProjectedExpenses(totExp);
        setTotalProjectedCashflow(totRev - totExp);
      } catch (err) {
        console.error('Forecasting data load failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <span className="text-text-muted text-sm">Calculating forecasts...</span>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      {/* Header */}
      <div className="module-header">
        <div className="flex items-center gap-2">
          <Calculator size={20} className="text-accent-purple" />
          <h1 className="module-title">Financial Forecasting</h1>
        </div>
        <span className="text-xs text-text-muted">
          Based on {historicalRevenue.length} months of historical data
        </span>
      </div>

      {/* Summary Stat Cards — 3-column */}
      <div className="grid grid-cols-3 gap-4">
        {/* Projected Revenue */}
        <div className="stat-card border-l-2 border-l-accent-income">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={14} className="text-accent-income" />
            <span className="stat-label">Projected Revenue (Next Quarter)</span>
          </div>
          <p className="stat-value text-accent-income">{fmt.format(totalProjectedRevenue)}</p>
          <span className="text-xs text-text-muted">
            ~{fmt.format(totalProjectedRevenue / 3)} / month avg
          </span>
        </div>

        {/* Projected Expenses */}
        <div className="stat-card border-l-2 border-l-accent-expense">
          <div className="flex items-center gap-2 mb-1">
            <TrendingDown size={14} className="text-accent-expense" />
            <span className="stat-label">Projected Expenses (Next Quarter)</span>
          </div>
          <p className="stat-value text-accent-expense">{fmt.format(totalProjectedExpenses)}</p>
          <span className="text-xs text-text-muted">
            ~{fmt.format(totalProjectedExpenses / 3)} / month avg
          </span>
        </div>

        {/* Projected Cash Flow */}
        <div
          className="stat-card border-l-2"
          style={{
            borderLeftColor: totalProjectedCashflow >= 0
              ? 'var(--color-accent-blue)'
              : 'var(--color-accent-expense)',
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            <DollarSign size={14} className="text-accent-blue" />
            <span className="stat-label">Projected Cash Flow (Next Quarter)</span>
          </div>
          <p
            className="stat-value"
            style={{
              color: totalProjectedCashflow >= 0
                ? 'var(--color-accent-blue)'
                : 'var(--color-accent-expense)',
            }}
          >
            {fmt.format(totalProjectedCashflow)}
          </p>
          <span className="text-xs text-text-muted">Revenue minus expenses</span>
        </div>
      </div>

      {/* Month-by-Month Projection Table */}
      <div className="block-card p-5">
        <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">
          Month-by-Month Projections
        </h2>
        <table className="block-table">
          <thead>
            <tr>
              <th>Month</th>
              <th style={{ textAlign: 'right' }}>Projected Revenue</th>
              <th style={{ textAlign: 'right' }}>Projected Expenses</th>
              <th style={{ textAlign: 'right' }}>Net</th>
            </tr>
          </thead>
          <tbody>
            {projections.map((row, i) => (
              <tr key={i}>
                <td className="font-medium">{row.month}</td>
                <td className="font-mono text-right text-accent-income">
                  {fmt.format(row.revenue)}
                </td>
                <td className="font-mono text-right text-accent-expense">
                  {fmt.format(row.expenses)}
                </td>
                <td
                  className="font-mono text-right font-semibold"
                  style={{
                    color: row.net >= 0
                      ? 'var(--color-accent-income)'
                      : 'var(--color-accent-expense)',
                  }}
                >
                  {fmt.format(row.net)}
                </td>
              </tr>
            ))}
            {/* Total Row */}
            <tr style={{ borderTop: '2px solid var(--color-border-secondary)' }}>
              <td className="font-bold">Quarter Total</td>
              <td className="font-mono text-right font-bold text-accent-income">
                {fmt.format(totalProjectedRevenue)}
              </td>
              <td className="font-mono text-right font-bold text-accent-expense">
                {fmt.format(totalProjectedExpenses)}
              </td>
              <td
                className="font-mono text-right font-bold"
                style={{
                  color: totalProjectedCashflow >= 0
                    ? 'var(--color-accent-income)'
                    : 'var(--color-accent-expense)',
                }}
              >
                {fmt.format(totalProjectedCashflow)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Historical Data Summary */}
      <div className="grid grid-cols-2 gap-4">
        {/* Historical Revenue */}
        <div className="block-card p-5">
          <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">
            Historical Revenue (Last 6 Months)
          </h2>
          {historicalRevenue.length === 0 ? (
            <div className="empty-state py-6">
              <span className="text-text-muted text-sm">No historical revenue data</span>
            </div>
          ) : (
            <table className="block-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th style={{ textAlign: 'right' }}>Revenue</th>
                </tr>
              </thead>
              <tbody>
                {historicalRevenue.map((row, i) => (
                  <tr key={i}>
                    <td>{row.month}</td>
                    <td className="font-mono text-right text-accent-income">
                      {fmt.format(row.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Historical Expenses */}
        <div className="block-card p-5">
          <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">
            Historical Expenses (Last 6 Months)
          </h2>
          {historicalExpenses.length === 0 ? (
            <div className="empty-state py-6">
              <span className="text-text-muted text-sm">No historical expense data</span>
            </div>
          ) : (
            <table className="block-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th style={{ textAlign: 'right' }}>Expenses</th>
                </tr>
              </thead>
              <tbody>
                {historicalExpenses.map((row, i) => (
                  <tr key={i}>
                    <td>{row.month}</td>
                    <td className="font-mono text-right text-accent-expense">
                      {fmt.format(row.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default Forecasting;
