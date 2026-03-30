import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Calculator,
  SlidersHorizontal,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import api from '../../lib/api';

// ─── Currency Formatter ─────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const fmtCompact = (value: number) => {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return fmt.format(value);
};

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

interface ScenarioChartPoint {
  month: string;
  actual?: number;
  conservative?: number;
  moderate?: number;
  aggressive?: number;
}

type Scenario = 'conservative' | 'moderate' | 'aggressive';

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

function projectNext(
  data: number[],
  months: number,
  multiplier: number = 1.0
): number[] {
  const { slope, intercept } = linearRegression(data);
  const n = data.length;
  const projections: number[] = [];

  for (let i = 1; i <= months; i++) {
    const projected = (slope * (n + i) + intercept) * multiplier;
    projections.push(Math.max(projected, 0));
  }

  return projections;
}

// ─── Month Name Helper ──────────────────────────────────
function futureMonthLabel(offsetFromNow: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + offsetFromNow);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
}

// ─── Scenario Config ────────────────────────────────────
const SCENARIO_CONFIG: Record<
  Scenario,
  { label: string; multiplier: number; color: string; description: string }
> = {
  conservative: {
    label: 'Conservative',
    multiplier: 0.9,
    color: '#f59e0b',
    description: '90% of linear regression projection',
  },
  moderate: {
    label: 'Moderate',
    multiplier: 1.0,
    color: '#3b82f6',
    description: 'Linear regression as-is',
  },
  aggressive: {
    label: 'Aggressive',
    multiplier: 1.1,
    color: '#22c55e',
    description: '110% of linear regression projection',
  },
};

// ─── Custom Tooltip ─────────────────────────────────────
const ScenarioTooltip: React.FC<any> = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="text-xs px-3 py-2"
      style={{
        backgroundColor: '#1a1a1a',
        border: '1px solid #2e2e2e',
        borderRadius: '2px',
      }}
    >
      <p className="text-text-muted mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }} className="font-mono">
          {p.dataKey === 'actual'
            ? 'Actual'
            : p.dataKey.charAt(0).toUpperCase() + p.dataKey.slice(1)}
          : {fmt.format(p.value)}
        </p>
      ))}
    </div>
  );
};

// ─── Forecasting Component ──────────────────────────────
const Forecasting: React.FC = () => {
  const [projections, setProjections] = useState<Record<Scenario, Projection[]>>({
    conservative: [],
    moderate: [],
    aggressive: [],
  });
  const [activeScenario, setActiveScenario] = useState<Scenario>('moderate');
  const [historicalRevenue, setHistoricalRevenue] = useState<MonthlyData[]>([]);
  const [historicalExpenses, setHistoricalExpenses] = useState<MonthlyData[]>([]);
  const [chartData, setChartData] = useState<ScenarioChartPoint[]>([]);
  const [loading, setLoading] = useState(true);

  // What-If sliders
  const [newClientsPerMonth, setNewClientsPerMonth] = useState(0);
  const [avgInvoiceValue, setAvgInvoiceValue] = useState(0);
  const [baseAvgInvoice, setBaseAvgInvoice] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [revenueRows, expenseRows, avgInvoiceData] = await Promise.all([
          api.rawQuery(
            `SELECT strftime('%Y-%m', issue_date) as month,
                    COALESCE(SUM(total), 0) as total
             FROM invoices
             WHERE status IN ('paid', 'sent')
               AND issue_date >= date('now', '-6 months')
             GROUP BY month
             ORDER BY month ASC`
          ),
          api.rawQuery(
            `SELECT strftime('%Y-%m', date) as month,
                    COALESCE(SUM(amount), 0) as total
             FROM expenses
             WHERE date >= date('now', '-6 months')
             GROUP BY month
             ORDER BY month ASC`
          ),
          api.rawQuery(
            `SELECT COALESCE(AVG(total), 0) as avg_invoice
             FROM invoices
             WHERE status IN ('paid','sent')
               AND issue_date >= date('now', '-6 months')`
          ),
        ]);

        if (cancelled) return;

        setHistoricalRevenue(revenueRows ?? []);
        setHistoricalExpenses(expenseRows ?? []);

        const avgInv = Array.isArray(avgInvoiceData)
          ? avgInvoiceData[0]?.avg_invoice
          : avgInvoiceData?.avg_invoice;
        setBaseAvgInvoice(avgInv || 0);
        setAvgInvoiceValue(Math.round(avgInv || 0));

        const revValues = (revenueRows ?? []).map((r: any) => r.total);
        const expValues = (expenseRows ?? []).map((r: any) => r.total);

        // Build projections for all scenarios
        const scenarios: Scenario[] = ['conservative', 'moderate', 'aggressive'];
        const allProjections: Record<Scenario, Projection[]> = {
          conservative: [],
          moderate: [],
          aggressive: [],
        };

        for (const scenario of scenarios) {
          const { multiplier } = SCENARIO_CONFIG[scenario];
          const projectedRev = projectNext(revValues, 3, multiplier);
          const projectedExp = projectNext(expValues, 3, 1.0); // expenses same across scenarios

          const rows: Projection[] = [];
          for (let i = 0; i < 3; i++) {
            rows.push({
              month: futureMonthLabel(i + 1),
              revenue: projectedRev[i],
              expenses: projectedExp[i],
              net: projectedRev[i] - projectedExp[i],
            });
          }
          allProjections[scenario] = rows;
        }

        setProjections(allProjections);

        // Build chart data: historical + all 3 scenarios
        const chartPoints: ScenarioChartPoint[] = [];

        // Historical points
        (revenueRows ?? []).forEach((r: any) => {
          chartPoints.push({
            month: r.month,
            actual: r.total,
          });
        });

        // Projected points — bridge from last actual
        for (let i = 0; i < 3; i++) {
          const point: ScenarioChartPoint = {
            month: futureMonthLabel(i + 1),
            conservative: allProjections.conservative[i].revenue,
            moderate: allProjections.moderate[i].revenue,
            aggressive: allProjections.aggressive[i].revenue,
          };
          chartPoints.push(point);
        }

        setChartData(chartPoints);
      } catch (err) {
        console.error('Forecasting data load failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── What-If Calculation ────────────────────────────────
  const whatIfRevenue = useMemo(() => {
    const additionalMonthlyRevenue = newClientsPerMonth * avgInvoiceValue;
    return additionalMonthlyRevenue;
  }, [newClientsPerMonth, avgInvoiceValue]);

  const whatIfChartData = useMemo(() => {
    if (whatIfRevenue <= 0) return chartData;

    return chartData.map((point) => {
      if (point.actual !== undefined) return point;
      return {
        ...point,
        conservative: (point.conservative || 0) + whatIfRevenue * SCENARIO_CONFIG.conservative.multiplier,
        moderate: (point.moderate || 0) + whatIfRevenue * SCENARIO_CONFIG.moderate.multiplier,
        aggressive: (point.aggressive || 0) + whatIfRevenue * SCENARIO_CONFIG.aggressive.multiplier,
      };
    });
  }, [chartData, whatIfRevenue]);

  const whatIfProjections = useMemo(() => {
    if (whatIfRevenue <= 0) return projections;

    const adjusted: Record<Scenario, Projection[]> = {
      conservative: [],
      moderate: [],
      aggressive: [],
    };

    for (const scenario of ['conservative', 'moderate', 'aggressive'] as Scenario[]) {
      adjusted[scenario] = projections[scenario].map((p) => {
        const boost = whatIfRevenue * SCENARIO_CONFIG[scenario].multiplier;
        return {
          ...p,
          revenue: p.revenue + boost,
          net: p.revenue + boost - p.expenses,
        };
      });
    }

    return adjusted;
  }, [projections, whatIfRevenue]);

  const activeProjections = whatIfProjections[activeScenario];
  const totalProjectedRevenue = activeProjections.reduce((s, p) => s + p.revenue, 0);
  const totalProjectedExpenses = activeProjections.reduce((s, p) => s + p.expenses, 0);
  const totalProjectedCashflow = totalProjectedRevenue - totalProjectedExpenses;

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

      {/* ─── Scenario Selector ─── */}
      <div className="block-card p-4" style={{ borderRadius: '2px' }}>
        <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
          Scenario
        </h2>
        <div className="flex gap-2">
          {(['conservative', 'moderate', 'aggressive'] as Scenario[]).map((scenario) => {
            const config = SCENARIO_CONFIG[scenario];
            const isActive = activeScenario === scenario;
            return (
              <button
                key={scenario}
                onClick={() => setActiveScenario(scenario)}
                className="flex-1 p-3 text-left transition-colors"
                style={{
                  backgroundColor: isActive ? `${config.color}15` : '#141414',
                  border: `1px solid ${isActive ? config.color : '#2e2e2e'}`,
                  borderRadius: '2px',
                  cursor: 'pointer',
                }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      backgroundColor: config.color,
                      borderRadius: '1px',
                      display: 'inline-block',
                    }}
                  />
                  <span
                    className="text-xs font-semibold"
                    style={{ color: isActive ? config.color : '#9a9a9a' }}
                  >
                    {config.label}
                  </span>
                </div>
                <span className="text-[10px] text-text-muted">{config.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="stat-card border-l-2 border-l-accent-income">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={14} className="text-accent-income" />
            <span className="stat-label">Projected Revenue (Next Quarter)</span>
          </div>
          <p className="stat-value text-accent-income">
            {fmt.format(totalProjectedRevenue)}
          </p>
          <span className="text-xs text-text-muted">
            ~{fmt.format(totalProjectedRevenue / 3)} / month avg
            {whatIfRevenue > 0 && (
              <span className="text-accent-purple ml-1">
                (includes +{fmt.format(whatIfRevenue)}/mo what-if)
              </span>
            )}
          </span>
        </div>

        <div className="stat-card border-l-2 border-l-accent-expense">
          <div className="flex items-center gap-2 mb-1">
            <TrendingDown size={14} className="text-accent-expense" />
            <span className="stat-label">Projected Expenses (Next Quarter)</span>
          </div>
          <p className="stat-value text-accent-expense">
            {fmt.format(totalProjectedExpenses)}
          </p>
          <span className="text-xs text-text-muted">
            ~{fmt.format(totalProjectedExpenses / 3)} / month avg
          </span>
        </div>

        <div
          className="stat-card border-l-2"
          style={{
            borderLeftColor:
              totalProjectedCashflow >= 0
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
              color:
                totalProjectedCashflow >= 0
                  ? 'var(--color-accent-blue)'
                  : 'var(--color-accent-expense)',
            }}
          >
            {fmt.format(totalProjectedCashflow)}
          </p>
          <span className="text-xs text-text-muted">Revenue minus expenses</span>
        </div>
      </div>

      {/* ─── Scenario Comparison Chart ─── */}
      <div className="block-card p-5" style={{ borderRadius: '2px' }}>
        <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">
          Revenue Projection — All Scenarios
        </h2>
        <div style={{ width: '100%', minHeight: 340 }}>
          <ResponsiveContainer width="100%" height={340}>
            <LineChart data={whatIfChartData}>
              <XAxis
                dataKey="month"
                tick={{ fill: '#6b6b6b', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: '#6b6b6b', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => fmtCompact(v)}
              />
              <Tooltip content={<ScenarioTooltip />} />
              <Legend
                iconType="square"
                iconSize={10}
                formatter={(value: string) => (
                  <span className="text-xs text-text-secondary">
                    {value === 'actual'
                      ? 'Actual'
                      : value.charAt(0).toUpperCase() + value.slice(1)}
                  </span>
                )}
              />
              {/* Actual historical line */}
              <Line
                type="monotone"
                dataKey="actual"
                stroke="#ffffff"
                strokeWidth={2}
                dot={{ r: 3, fill: '#ffffff', stroke: '#0a0a0a', strokeWidth: 2 }}
                connectNulls={false}
              />
              {/* Conservative */}
              <Line
                type="monotone"
                dataKey="conservative"
                stroke={SCENARIO_CONFIG.conservative.color}
                strokeWidth={2}
                strokeDasharray={activeScenario === 'conservative' ? '0' : '6 3'}
                dot={{
                  r: activeScenario === 'conservative' ? 4 : 2,
                  fill: SCENARIO_CONFIG.conservative.color,
                  stroke: '#0a0a0a',
                  strokeWidth: 2,
                }}
                connectNulls={false}
                opacity={activeScenario === 'conservative' ? 1 : 0.4}
              />
              {/* Moderate */}
              <Line
                type="monotone"
                dataKey="moderate"
                stroke={SCENARIO_CONFIG.moderate.color}
                strokeWidth={2}
                strokeDasharray={activeScenario === 'moderate' ? '0' : '6 3'}
                dot={{
                  r: activeScenario === 'moderate' ? 4 : 2,
                  fill: SCENARIO_CONFIG.moderate.color,
                  stroke: '#0a0a0a',
                  strokeWidth: 2,
                }}
                connectNulls={false}
                opacity={activeScenario === 'moderate' ? 1 : 0.4}
              />
              {/* Aggressive */}
              <Line
                type="monotone"
                dataKey="aggressive"
                stroke={SCENARIO_CONFIG.aggressive.color}
                strokeWidth={2}
                strokeDasharray={activeScenario === 'aggressive' ? '0' : '6 3'}
                dot={{
                  r: activeScenario === 'aggressive' ? 4 : 2,
                  fill: SCENARIO_CONFIG.aggressive.color,
                  stroke: '#0a0a0a',
                  strokeWidth: 2,
                }}
                connectNulls={false}
                opacity={activeScenario === 'aggressive' ? 1 : 0.4}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ─── What-If Section ─── */}
      <div className="block-card p-5" style={{ borderRadius: '2px' }}>
        <div className="flex items-center gap-2 mb-4">
          <SlidersHorizontal size={14} className="text-accent-purple" />
          <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            What-If Analysis
          </h2>
        </div>
        <div className="grid grid-cols-2 gap-6">
          {/* New Clients per Month slider */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-text-secondary">New Clients per Month</span>
              <span className="text-sm font-mono text-accent-purple font-semibold">
                {newClientsPerMonth}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={20}
              step={1}
              value={newClientsPerMonth}
              onChange={(e) => setNewClientsPerMonth(Number(e.target.value))}
              className="w-full"
              style={{
                accentColor: 'var(--color-accent-purple)',
                height: '4px',
              }}
            />
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-text-muted">0</span>
              <span className="text-[10px] text-text-muted">20</span>
            </div>
          </div>

          {/* Avg Invoice Value slider */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-text-secondary">Avg Invoice Value</span>
              <span className="text-sm font-mono text-accent-purple font-semibold">
                {fmt.format(avgInvoiceValue)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(baseAvgInvoice * 3, 10000)}
              step={100}
              value={avgInvoiceValue}
              onChange={(e) => setAvgInvoiceValue(Number(e.target.value))}
              className="w-full"
              style={{
                accentColor: 'var(--color-accent-purple)',
                height: '4px',
              }}
            />
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-text-muted">$0</span>
              <span className="text-[10px] text-text-muted">
                {fmtCompact(Math.max(baseAvgInvoice * 3, 10000))}
              </span>
            </div>
          </div>
        </div>

        {whatIfRevenue > 0 && (
          <div
            className="mt-4 p-3"
            style={{
              backgroundColor: '#a855f710',
              border: '1px solid #a855f730',
              borderRadius: '2px',
            }}
          >
            <p className="text-xs text-text-secondary">
              Adding{' '}
              <span className="text-accent-purple font-semibold">
                {newClientsPerMonth} new client{newClientsPerMonth !== 1 ? 's' : ''}
              </span>{' '}
              at{' '}
              <span className="text-accent-purple font-semibold">
                {fmt.format(avgInvoiceValue)}
              </span>{' '}
              avg invoice would generate an additional{' '}
              <span className="text-accent-purple font-semibold font-mono">
                {fmt.format(whatIfRevenue)}
              </span>{' '}
              per month ({fmt.format(whatIfRevenue * 3)} per quarter).
            </p>
          </div>
        )}
      </div>

      {/* Month-by-Month Projection Table */}
      <div className="block-card p-5" style={{ borderRadius: '2px' }}>
        <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">
          Month-by-Month Projections ({SCENARIO_CONFIG[activeScenario].label})
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
            {activeProjections.map((row, i) => (
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
                    color:
                      row.net >= 0
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
                  color:
                    totalProjectedCashflow >= 0
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
        <div className="block-card p-5" style={{ borderRadius: '2px' }}>
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
        <div className="block-card p-5" style={{ borderRadius: '2px' }}>
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
