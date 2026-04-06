import React, { useEffect, useState, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import { useCompanyStore } from '../../stores/companyStore';

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
  if (days < 7) return 'text-green-500';
  if (days < 14) return 'text-yellow-500';
  if (days < 30) return 'text-orange-500';
  return 'text-red-500';
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
  const [loading, setLoading] = useState(true);

  // ── Data loader ──
  const loadData = useCallback(async () => {
    if (!resolvedId) return;
    setLoading(true);
    try {
      const [analyticsRes, statsRes] = await Promise.all([
        api.debtAnalytics(resolvedId, startDate, endDate),
        api.debtStats(resolvedId),
      ]);
      setAnalytics(analyticsRes);
      setStats(statsRes);
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
                    tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
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
                    tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
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
                    tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
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

          {/* ── 6. Pipeline Velocity ── */}
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
                    className="grid grid-cols-2 gap-2 text-sm px-2 py-2 hover:bg-bg-hover"
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
        </div>
      )}
    </div>
  );
};

export default AnalyticsView;
