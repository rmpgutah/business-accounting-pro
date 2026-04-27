import React, { useEffect, useState, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
} from 'recharts';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import { useCompanyStore } from '../../stores/companyStore';

// Perf: module-scoped formatters keep stable identity across renders so recharts
// doesn't invalidate axis layout each time the parent re-renders.
const fmtThousands = (v: number) => `$${(v / 1000).toFixed(0)}k`;

// ─── Types ──────────────────────────────────────────────
interface AnalyticsViewProps {
  companyId: string;
}

interface AnalyticsData {
  collectionByMonth: Array<{ month: string; total: number }>;
  aging: Array<{ bucket: string; count: number; total: number }>;
  recoveryByStage: Array<{ stage: string; count: number }>;
  topDebtors: Array<{ debtor_name: string; total: number }>;
  velocity: Array<{ stage: string; avg_days: number }>;
}

interface DebtStats {
  total_outstanding: number;
  in_collection: number;
  legal_active: number;
  collected_this_month: number;
  writeoffs_ytd: number;
}

// ─── Constants ──────────────────────────────────────────
const AGING_BUCKET_ORDER = ['0-30', '31-60', '61-90', '91-120', '121-180', '180+'];

const AGING_COLORS: Record<string, string> = {
  '0-30': '#22c55e',
  '31-60': '#eab308',
  '61-90': '#f97316',
  '91-120': '#ef4444',
  '121-180': '#dc2626',
  '180+': '#991b1b',
};

const CHART_GRID_STROKE = '#2e2e2e';
const CHART_TICK_FILL = '#8a8a8a';
const TOOLTIP_STYLE = {
  backgroundColor: '#1a1a1a',
  border: '1px solid #2e2e2e',
  borderRadius: '6px',
};

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function velocityColor(days: number): string {
  if (days < 7) return 'text-accent-income';
  if (days < 14) return 'text-yellow-500';
  if (days < 30) return 'text-orange-500';
  return 'text-accent-expense';
}

// ─── Tooltip Formatters ─────────────────────────────────
const CurrencyTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={TOOLTIP_STYLE} className="px-3 py-2 text-xs">
      <p className="text-text-secondary mb-1">{label}</p>
      <p className="text-text-primary font-mono">
        {formatCurrency(payload[0].value)}
      </p>
    </div>
  );
};

const CountTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={TOOLTIP_STYLE} className="px-3 py-2 text-xs">
      <p className="text-text-secondary mb-1">{label}</p>
      <p className="text-text-primary font-mono">{payload[0].value}</p>
    </div>
  );
};

// ─── Component ──────────────────────────────────────────
const AnalyticsView: React.FC<AnalyticsViewProps> = ({ companyId }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const resolvedId = companyId || activeCompany?.id || '';

  const now = new Date();
  const [startDate, setStartDate] = useState(() =>
    toISODate(new Date(now.getFullYear(), 0, 1))
  );
  const [endDate, setEndDate] = useState(() => toISODate(now));

  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [stats, setStats] = useState<DebtStats | null>(null);
  const [collectorPerf, setCollectorPerf] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Feature 8: CEI
  const [cei, setCei] = useState<number | null>(null);
  // Feature 15: Segmentation
  const [segmentation, setSegmentation] = useState<{ byStage: any[]; byBalance: any[]; byCollector: any[] }>({ byStage: [], byBalance: [], byCollector: [] });
  // Feature 25: Recovery Forecast
  const [forecast, setForecast] = useState<any[]>([]);

  // ── Data loader ──
  const loadData = useCallback(async () => {
    if (!resolvedId) return;
    setLoading(true);
    try {
      const [analyticsRes, statsRes, perfRes] = await Promise.all([
        api.debtAnalytics(resolvedId, startDate, endDate),
        api.debtStats(resolvedId),
        api.collectorPerformance(startDate, endDate).catch(() => []),
      ]);
      setAnalytics(analyticsRes);
      setStats(statsRes);
      setCollectorPerf(Array.isArray(perfRes) ? perfRes : []);

      // Feature 8: CEI = (Total Collected / Total Placed) x 100
      if (statsRes) {
        const totalPlaced = (statsRes.total_outstanding || 0) + (statsRes.collected_this_month || 0);
        const ceiVal = totalPlaced > 0 ? Math.round(((statsRes.collected_this_month || 0) / totalPlaced) * 10000) / 100 : 0;
        setCei(ceiVal);
      }

      // Feature 15: Segmentation (computed from raw queries)
      try {
        const [stageRes, balanceRes, collectorRes] = await Promise.all([
          api.rawQuery(`SELECT current_stage as segment, COUNT(*) as count, COALESCE(SUM(balance_due),0) as total, COALESCE(AVG(balance_due),0) as avg_balance FROM debts WHERE company_id = ? AND status NOT IN ('settled','written_off') GROUP BY current_stage`, [resolvedId]),
          api.rawQuery(`SELECT CASE WHEN balance_due < 1000 THEN '$0-1K' WHEN balance_due < 5000 THEN '$1K-5K' WHEN balance_due < 10000 THEN '$5K-10K' ELSE '$10K+' END as segment, COUNT(*) as count, COALESCE(SUM(balance_due),0) as total, COALESCE(AVG(balance_due),0) as avg_balance FROM debts WHERE company_id = ? AND status NOT IN ('settled','written_off') GROUP BY segment`, [resolvedId]),
          api.rawQuery(`SELECT COALESCE(u.display_name, u.email, 'Unassigned') as segment, COUNT(*) as count, COALESCE(SUM(d.balance_due),0) as total, COALESCE(AVG(d.balance_due),0) as avg_balance FROM debts d LEFT JOIN users u ON d.assigned_collector_id = u.id WHERE d.company_id = ? AND d.status NOT IN ('settled','written_off') GROUP BY segment`, [resolvedId]),
        ]);
        setSegmentation({
          byStage: Array.isArray(stageRes) ? stageRes : [],
          byBalance: Array.isArray(balanceRes) ? balanceRes : [],
          byCollector: Array.isArray(collectorRes) ? collectorRes : [],
        });
      } catch (_) {}

      // Feature 25: Recovery Forecast (simplified projection from collection rates)
      try {
        const monthlyHistory = analyticsRes?.collectionByMonth || [];
        if (monthlyHistory.length >= 2) {
          const recentMonths = monthlyHistory.slice(-3);
          const avgMonthly = recentMonths.reduce((s: number, m: any) => s + (m.total || 0), 0) / recentMonths.length;
          const forecastData = [
            { period: '30 days', projected: Math.round(avgMonthly) },
            { period: '60 days', projected: Math.round(avgMonthly * 2) },
            { period: '90 days', projected: Math.round(avgMonthly * 3) },
          ];
          setForecast(forecastData);
        }
      } catch (_) {}
    } catch (err) {
      console.error('Failed to load debt analytics', err);
    } finally {
      setLoading(false);
    }
  }, [resolvedId, startDate, endDate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Normalize aging buckets so all appear in order ──
  const agingData = AGING_BUCKET_ORDER.map((bucket) => {
    const found = analytics?.aging?.find((a) => a.bucket === bucket);
    return { bucket, count: found?.count ?? 0, total: found?.total ?? 0 };
  });

  // ── Empty state ──
  if (!loading && !analytics) {
    return (
      <div className="text-text-muted text-sm p-8 text-center">
        No debt data available for the selected period.
      </div>
    );
  }

  const hasData =
    analytics &&
    (analytics.collectionByMonth.length > 0 ||
      analytics.aging.length > 0 ||
      analytics.recoveryByStage.length > 0 ||
      analytics.topDebtors.length > 0);

  return (
    <div className="space-y-4">
      {/* ── Date Range Selector ── */}
      <div
        className="block-card p-4 flex items-center gap-4 flex-wrap"
        style={{ borderRadius: '6px' }}
      >
        <label className="text-text-secondary text-sm flex items-center gap-2">
          From
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="block-input px-2 py-1 text-sm"
            style={{ borderRadius: '6px' }}
          />
        </label>
        <label className="text-text-secondary text-sm flex items-center gap-2">
          To
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="block-input px-2 py-1 text-sm"
            style={{ borderRadius: '6px' }}
          />
        </label>
        <button
          onClick={loadData}
          disabled={loading}
          className="block-btn block-btn-primary px-3 py-1 text-sm flex items-center gap-1"
          style={{ borderRadius: '6px' }}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {loading && (
        <div className="text-text-muted text-sm text-center py-8">
          Loading analytics...
        </div>
      )}

      {!loading && !hasData && (
        <div className="text-text-muted text-sm p-8 text-center">
          No debt data available for the selected period.
        </div>
      )}

      {!loading && hasData && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ── 1. Collection Rate Over Time (AreaChart) ── */}
          <div className="block-card p-4" style={{ borderRadius: '6px' }}>
            <h3 className="text-text-primary text-sm font-semibold mb-3">
              Collection Rate Over Time
            </h3>
            <div style={{ height: 250 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={analytics!.collectionByMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                  <XAxis
                    dataKey="month"
                    tick={{ fill: CHART_TICK_FILL, fontSize: 11 }}
                    axisLine={{ stroke: CHART_GRID_STROKE }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: CHART_TICK_FILL, fontSize: 11 }}
                    axisLine={{ stroke: CHART_GRID_STROKE }}
                    tickLine={false}
                    tickFormatter={fmtThousands}
                  />
                  <Tooltip content={<CurrencyTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="total"
                    stroke="#22c55e"
                    fill="#22c55e"
                    fillOpacity={0.15}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── 2. Aging Breakdown (BarChart) ── */}
          <div className="block-card p-4" style={{ borderRadius: '6px' }}>
            <h3 className="text-text-primary text-sm font-semibold mb-3">
              Aging Breakdown
            </h3>
            <div style={{ height: 250 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={agingData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                  <XAxis
                    dataKey="bucket"
                    tick={{ fill: CHART_TICK_FILL, fontSize: 11 }}
                    axisLine={{ stroke: CHART_GRID_STROKE }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: CHART_TICK_FILL, fontSize: 11 }}
                    axisLine={{ stroke: CHART_GRID_STROKE }}
                    tickLine={false}
                    tickFormatter={fmtThousands}
                  />
                  <Tooltip content={<CurrencyTooltip />} />
                  <Bar dataKey="total" maxBarSize={40}>
                    {agingData.map((entry) => (
                      <Cell
                        key={entry.bucket}
                        fill={AGING_COLORS[entry.bucket] ?? '#6b7280'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── 3. Recovery by Stage (Horizontal BarChart) ── */}
          <div className="block-card p-4" style={{ borderRadius: '6px' }}>
            <h3 className="text-text-primary text-sm font-semibold mb-3">
              Recovery by Stage
            </h3>
            <div style={{ height: 250 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={analytics!.recoveryByStage}
                  layout="vertical"
                  margin={{ left: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                  <XAxis
                    type="number"
                    tick={{ fill: CHART_TICK_FILL, fontSize: 11 }}
                    axisLine={{ stroke: CHART_GRID_STROKE }}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="stage"
                    tick={{ fill: CHART_TICK_FILL, fontSize: 11 }}
                    axisLine={{ stroke: CHART_GRID_STROKE }}
                    tickLine={false}
                    width={100}
                  />
                  <Tooltip content={<CountTooltip />} />
                  <Bar dataKey="count" fill="#3b82f6" maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── 4. Top Debtors (Horizontal BarChart) ── */}
          <div className="block-card p-4" style={{ borderRadius: '6px' }}>
            <h3 className="text-text-primary text-sm font-semibold mb-3">
              Top Debtors
            </h3>
            <div style={{ height: 250 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={analytics!.topDebtors}
                  layout="vertical"
                  margin={{ left: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                  <XAxis
                    type="number"
                    tick={{ fill: CHART_TICK_FILL, fontSize: 11 }}
                    axisLine={{ stroke: CHART_GRID_STROKE }}
                    tickLine={false}
                    tickFormatter={fmtThousands}
                  />
                  <YAxis
                    type="category"
                    dataKey="debtor_name"
                    tick={{ fill: CHART_TICK_FILL, fontSize: 11 }}
                    axisLine={{ stroke: CHART_GRID_STROKE }}
                    tickLine={false}
                    width={120}
                    tickFormatter={(v: string) =>
                      v.length > 16 ? v.slice(0, 14) + '...' : v
                    }
                  />
                  <Tooltip content={<CurrencyTooltip />} />
                  <Bar dataKey="total" fill="#ef4444" maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── 5. Summary Stats ── */}
          <div className="block-card p-4" style={{ borderRadius: '6px' }}>
            <h3 className="text-text-primary text-sm font-semibold mb-3">
              Summary
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="stat-card block-card" style={{ borderRadius: '6px' }}>
                <div className="stat-value font-mono text-accent-expense">
                  {formatCurrency(stats?.total_outstanding ?? 0)}
                </div>
                <div className="stat-label">Total Outstanding</div>
              </div>
              <div className="stat-card block-card" style={{ borderRadius: '6px' }}>
                <div className="stat-value font-mono text-accent-income">
                  {formatCurrency(stats?.collected_this_month ?? 0)}
                </div>
                <div className="stat-label">Collected This Month</div>
              </div>
              <div className="stat-card block-card" style={{ borderRadius: '6px' }}>
                <div className="stat-value font-mono text-text-muted">
                  {formatCurrency(stats?.writeoffs_ytd ?? 0)}
                </div>
                <div className="stat-label">Write-offs YTD</div>
              </div>
              <div className="stat-card block-card" style={{ borderRadius: '6px' }}>
                <div className="stat-value font-mono text-accent-blue">
                  {stats?.in_collection ?? 0}
                </div>
                <div className="stat-label">Active Debts</div>
              </div>
            </div>
          </div>

          {/* ── 6. Collector Performance ── */}
          {collectorPerf.length > 0 && (
            <div className="block-card p-4 col-span-2" style={{ borderRadius: '6px' }}>
              <h3 className="text-text-primary text-sm font-semibold mb-3">
                Collector Performance
              </h3>
              <table className="block-table">
                <thead>
                  <tr>
                    <th>Collector</th>
                    <th className="text-right">Active Cases</th>
                    <th className="text-right">Total Owed</th>
                    <th className="text-right">Collected</th>
                    <th className="text-right">Recovery Rate</th>
                    <th className="text-right">Avg Days to 1st Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {collectorPerf.map((c: any) => (
                    <tr key={c.collector_id}>
                      <td className="text-text-primary font-medium">{c.collector_name}</td>
                      <td className="text-right font-mono">{c.active_cases}</td>
                      <td className="text-right font-mono text-text-secondary">{formatCurrency(c.total_owed)}</td>
                      <td className="text-right font-mono text-accent-income">{formatCurrency(c.total_collected)}</td>
                      <td className="text-right">
                        <span className={`font-mono font-bold ${c.recovery_rate >= 50 ? 'text-accent-income' : c.recovery_rate >= 25 ? 'text-yellow-500' : 'text-accent-expense'}`}>
                          {c.recovery_rate}%
                        </span>
                      </td>
                      <td className="text-right font-mono text-text-secondary">{Math.round(c.avg_days_to_first_payment)}d</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── 7. Pipeline Velocity ── */}
          <div className="block-card p-4" style={{ borderRadius: '6px' }}>
            <h3 className="text-text-primary text-sm font-semibold mb-3">
              Pipeline Velocity
            </h3>
            {analytics!.velocity.length === 0 ? (
              <div className="text-text-muted text-xs text-center py-4">
                No velocity data available.
              </div>
            ) : (
              <div className="space-y-1">
                <div className="grid grid-cols-2 gap-2 text-xs text-text-muted font-semibold uppercase tracking-wider px-2 py-1 border-b border-border-primary">
                  <span>Stage</span>
                  <span className="text-right">Avg Days</span>
                </div>
                {analytics!.velocity.map((v) => (
                  <div
                    key={v.stage}
                    className="grid grid-cols-2 gap-2 text-sm px-2 py-2 hover:bg-bg-hover transition-colors"
                    style={{ borderRadius: '6px' }}
                  >
                    <span className="text-text-secondary capitalize">
                      {v.stage.replace(/_/g, ' ')}
                    </span>
                    <span
                      className={`text-right font-mono font-semibold ${velocityColor(v.avg_days)}`}
                    >
                      {v.avg_days.toFixed(1)}d
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── 8. Collection Effectiveness Index (CEI) ── */}
          {cei !== null && (
            <div className="block-card p-4" style={{ borderRadius: '6px' }}>
              <h3 className="text-text-primary text-sm font-semibold mb-3">
                Collection Effectiveness Index (CEI)
              </h3>
              <div className="flex items-center justify-center py-4">
                <div className="text-center">
                  <div className={`text-4xl font-mono font-bold ${cei >= 50 ? 'text-accent-income' : cei >= 25 ? 'text-yellow-500' : 'text-accent-expense'}`}>
                    {cei.toFixed(1)}%
                  </div>
                  <div className="text-xs text-text-muted mt-2">Total Collected / Total Placed for Collection</div>
                  <div className="w-full h-2 bg-bg-tertiary mt-3" style={{ borderRadius: 6, width: 200 }}>
                    <div className={`h-full ${cei >= 50 ? 'bg-accent-income' : cei >= 25 ? 'bg-yellow-500' : 'bg-accent-expense'}`} style={{ width: `${Math.min(cei, 100)}%`, borderRadius: 6, transition: 'width 0.5s ease' }} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── 11. Debt Aging Waterfall ── */}
          <div className="block-card p-4 col-span-2" style={{ borderRadius: '6px' }}>
            <h3 className="text-text-primary text-sm font-semibold mb-3">
              Aging Waterfall
            </h3>
            <div className="flex items-end gap-1 justify-center" style={{ height: 120 }}>
              {agingData.map((a, i) => {
                const maxTotal = Math.max(...agingData.map(x => x.total), 1);
                const height = Math.max((a.total / maxTotal) * 100, 4);
                const prevTotal = i > 0 ? agingData[i - 1].total : 0;
                const flow = Math.min(prevTotal, a.total);
                return (
                  <div key={a.bucket} className="flex flex-col items-center" style={{ width: `${100 / agingData.length}%`, maxWidth: 120 }}>
                    <div className="text-[10px] font-mono text-text-muted mb-1">{formatCurrency(a.total)}</div>
                    <div style={{ height: `${height}px`, width: '60%', background: AGING_COLORS[a.bucket] || '#6b7280', borderRadius: '4px 4px 0 0', transition: 'height 0.3s ease' }} />
                    <div className="text-[10px] text-text-muted mt-1 text-center">{a.bucket}</div>
                    <div className="text-[10px] text-text-secondary">{a.count} debts</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── 15. Portfolio Segmentation ── */}
          {(segmentation.byStage.length > 0 || segmentation.byBalance.length > 0) && (
            <div className="block-card p-4 col-span-2" style={{ borderRadius: '6px' }}>
              <h3 className="text-text-primary text-sm font-semibold mb-3">
                Portfolio Segmentation
              </h3>
              <div className="grid grid-cols-3 gap-4">
                {/* By Stage */}
                <div>
                  <h4 className="text-xs text-text-muted font-semibold uppercase mb-2">By Stage</h4>
                  <div className="space-y-1">
                    {segmentation.byStage.map((s: any) => (
                      <div key={s.segment} className="flex justify-between text-xs px-2 py-1 border border-border-primary" style={{ borderRadius: 6 }}>
                        <span className="text-text-secondary capitalize">{(s.segment || '').replace(/_/g, ' ')}</span>
                        <span className="font-mono text-text-primary">{s.count} / {formatCurrency(s.total)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {/* By Balance Range */}
                <div>
                  <h4 className="text-xs text-text-muted font-semibold uppercase mb-2">By Balance</h4>
                  <div className="space-y-1">
                    {segmentation.byBalance.map((s: any) => (
                      <div key={s.segment} className="flex justify-between text-xs px-2 py-1 border border-border-primary" style={{ borderRadius: 6 }}>
                        <span className="text-text-secondary">{s.segment}</span>
                        <span className="font-mono text-text-primary">{s.count} / {formatCurrency(s.total)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {/* By Collector */}
                <div>
                  <h4 className="text-xs text-text-muted font-semibold uppercase mb-2">By Collector</h4>
                  <div className="space-y-1">
                    {segmentation.byCollector.map((s: any) => (
                      <div key={s.segment} className="flex justify-between text-xs px-2 py-1 border border-border-primary" style={{ borderRadius: 6 }}>
                        <span className="text-text-secondary truncate" style={{ maxWidth: 100 }}>{s.segment}</span>
                        <span className="font-mono text-text-primary">{s.count} / {formatCurrency(s.total)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── 25. Recovery Forecast ── */}
          {forecast.length > 0 && (
            <div className="block-card p-4" style={{ borderRadius: '6px' }}>
              <h3 className="text-text-primary text-sm font-semibold mb-3">
                Recovery Forecast
              </h3>
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={forecast}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                    <XAxis dataKey="period" tick={{ fill: CHART_TICK_FILL, fontSize: 11 }} axisLine={{ stroke: CHART_GRID_STROKE }} tickLine={false} />
                    <YAxis tick={{ fill: CHART_TICK_FILL, fontSize: 11 }} axisLine={{ stroke: CHART_GRID_STROKE }} tickLine={false} tickFormatter={fmtThousands} />
                    <Tooltip content={<CurrencyTooltip />} />
                    <Bar dataKey="projected" fill="#22c55e" maxBarSize={50} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex justify-between text-xs text-text-muted mt-2 px-2">
                {forecast.map(f => (
                  <span key={f.period}>{f.period}: <strong className="text-accent-income">{formatCurrency(f.projected)}</strong></span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AnalyticsView;
