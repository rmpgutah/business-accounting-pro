import React, { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Printer, TrendingUp } from 'lucide-react';
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
  Legend,
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

// DATE: Format as YYYY-MM-DD using local Y/M/D — toISOString() shifts the day
// for any timezone east or west of UTC depending on the local time of day.
function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

  // Feature 31: Recovery Rate Trend
  const [recoveryTrend, setRecoveryTrend] = useState<any[]>([]);
  // Feature 32: Settlement Success Rate
  const [settlementStats, setSettlementStats] = useState<{ total: number; accepted: number; rejected: number; avg_pct: number } | null>(null);
  // Feature 33: Communication Effectiveness
  const [commEffectiveness, setCommEffectiveness] = useState<any[]>([]);
  // Feature 34: Payment Plan Performance
  const [planPerf, setPlanPerf] = useState<{ total_plans: number; active: number; completed: number; defaulted: number } | null>(null);
  // Feature 35: Geographic Distribution
  const [geoData, setGeoData] = useState<any[]>([]);
  // Feature 36: Collector Comparison
  const [collectorComparison, setCollectorComparison] = useState<any[]>([]);
  // Feature 37: Collection Cost ROI
  const [costRoi, setCostRoi] = useState<{ total_collected: number; total_costs: number; roi: number } | null>(null);
  // Feature 40: Benchmark Indicators
  const benchmarks = { recoveryRate: 20, ceiTarget: 50, settlementRate: 40, avgSettlementPct: 55 };

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

      // Feature 31: Recovery Rate Trend (monthly recovery rate over 12 months)
      try {
        const collectedByMonth = await api.rawQuery(
          `SELECT strftime('%Y-%m', dp.created_at) as month, COALESCE(SUM(dp.amount), 0) as collected FROM debt_payments dp JOIN debts d ON dp.debt_id = d.id WHERE d.company_id = ? AND dp.created_at >= date('now', '-12 months') GROUP BY month ORDER BY month`,
          [resolvedId]
        );
        const totalPortfolio = statsRes?.total_outstanding || 1;
        const trendData = (Array.isArray(collectedByMonth) ? collectedByMonth : []).map((m: any) => ({
          month: m.month,
          collected: m.collected || 0,
          rate: Math.round(((m.collected || 0) / totalPortfolio) * 10000) / 100,
        }));
        setRecoveryTrend(trendData);
      } catch (_) { setRecoveryTrend([]); }

      // Feature 32: Settlement Success Rate
      try {
        const settRes = await api.rawQuery(
          `SELECT COUNT(*) as total, SUM(CASE WHEN response = 'accepted' THEN 1 ELSE 0 END) as accepted, SUM(CASE WHEN response = 'rejected' THEN 1 ELSE 0 END) as rejected, AVG(CASE WHEN response = 'accepted' THEN offer_pct ELSE NULL END) as avg_pct FROM debt_settlements ds JOIN debts d ON ds.debt_id = d.id WHERE d.company_id = ?`,
          [resolvedId]
        );
        if (Array.isArray(settRes) && settRes.length > 0) {
          setSettlementStats({
            total: settRes[0].total || 0,
            accepted: settRes[0].accepted || 0,
            rejected: settRes[0].rejected || 0,
            avg_pct: Math.round((settRes[0].avg_pct || 0) * 100) / 100,
          });
        }
      } catch (_) { setSettlementStats(null); }

      // Feature 33: Communication Effectiveness
      try {
        const commRes = await api.rawQuery(
          `SELECT type, COUNT(*) as total, SUM(CASE WHEN outcome IN ('promise_to_pay','payment_received','arrangement_made') THEN 1 ELSE 0 END) as positive FROM debt_communications dc JOIN debts d ON dc.debt_id = d.id WHERE d.company_id = ? GROUP BY type`,
          [resolvedId]
        );
        setCommEffectiveness(Array.isArray(commRes) ? commRes : []);
      } catch (_) { setCommEffectiveness([]); }

      // Feature 34: Payment Plan Performance
      try {
        const planRes = await api.rawQuery(
          `SELECT COUNT(*) as total_plans, SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed, SUM(CASE WHEN status = 'defaulted' THEN 1 ELSE 0 END) as defaulted FROM debt_payment_plans dpp JOIN debts d ON dpp.debt_id = d.id WHERE d.company_id = ?`,
          [resolvedId]
        );
        if (Array.isArray(planRes) && planRes.length > 0) {
          setPlanPerf({
            total_plans: planRes[0].total_plans || 0,
            active: planRes[0].active || 0,
            completed: planRes[0].completed || 0,
            defaulted: planRes[0].defaulted || 0,
          });
        }
      } catch (_) { setPlanPerf(null); }

      // Feature 35: Geographic Distribution
      // SCHEMA: debts has `debtor_address` (free-form) and `payments_made`
      // (not amount_paid). Use balance_due directly for outstanding.
      try {
        const geoRes = await api.rawQuery(
          `SELECT COALESCE(NULLIF(TRIM(SUBSTR(d.debtor_address, MAX(1, LENGTH(d.debtor_address) - 8))), ''), 'Unknown') as state,
                  COUNT(*) as count,
                  COALESCE(SUM(d.balance_due), 0) as balance
           FROM debts d
           WHERE d.company_id = ? AND d.status NOT IN ('settled','written_off')
           GROUP BY state ORDER BY balance DESC LIMIT 10`,
          [resolvedId]
        );
        setGeoData(Array.isArray(geoRes) ? geoRes : []);
      } catch (_) { setGeoData([]); }

      // Feature 36: Collector Comparison (more detailed than existing table)
      // SCHEMA: column is `payments_made` (not amount_paid).
      try {
        const collComp = await api.rawQuery(
          `SELECT COALESCE(u.display_name, u.email, 'Unassigned') as name,
                  COUNT(*) as accounts,
                  COALESCE(SUM(d.payments_made), 0) as collected,
                  COALESCE(SUM(d.balance_due), 0) as outstanding,
                  CASE WHEN SUM(d.original_amount) > 0
                       THEN ROUND(SUM(d.payments_made) * 100.0 / SUM(d.original_amount), 1)
                       ELSE 0 END as recovery_rate
           FROM debts d
           LEFT JOIN users u ON d.assigned_collector_id = u.id
           WHERE d.company_id = ? AND d.status NOT IN ('settled','written_off')
           GROUP BY name ORDER BY collected DESC`,
          [resolvedId]
        );
        setCollectorComparison(Array.isArray(collComp) ? collComp : []);
      } catch (_) { setCollectorComparison([]); }

      // Feature 37: Collection Cost ROI
      // SCHEMA: column is `payments_made` (not amount_paid).
      try {
        const roiRes = await api.rawQuery(
          `SELECT COALESCE(SUM(payments_made), 0) as total_collected, COALESCE(SUM(collection_costs), 0) as total_costs FROM debts WHERE company_id = ?`,
          [resolvedId]
        );
        if (Array.isArray(roiRes) && roiRes.length > 0) {
          const tc = roiRes[0].total_collected || 0;
          const tco = roiRes[0].total_costs || 0;
          setCostRoi({
            total_collected: tc,
            total_costs: tco,
            roi: tco > 0 ? Math.round(((tc - tco) / tco) * 10000) / 100 : 0,
          });
        }
      } catch (_) { setCostRoi(null); }
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
        {/* Feature 38: Print Analytics Report */}
        <button
          onClick={() => {
            const printRows = (rows: any[], cols: string[]) => {
              if (!rows.length) return '<p style="color:#888;font-size:12px;">No data</p>';
              return `<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:16px;"><thead><tr>${cols.map(c => `<th style="text-align:left;padding:4px 8px;border-bottom:2px solid #333;font-weight:600;">${c}</th>`).join('')}</tr></thead><tbody>${rows.map((r, i) => `<tr style="background:${i % 2 ? '#f9f9f9' : '#fff'}">${cols.map(c => `<td style="padding:4px 8px;border-bottom:1px solid #eee;">${r[c.toLowerCase().replace(/ /g, '_')] ?? r[Object.keys(r)[cols.indexOf(c)]] ?? '-'}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
            };
            const sections: string[] = [];
            sections.push('<h2>Debt Collection Analytics Report</h2>');
            sections.push(`<p style="color:#666;">Period: ${startDate} to ${endDate}</p>`);
            if (stats) {
              sections.push('<h3>Summary</h3>');
              sections.push(`<p>Total Outstanding: <strong>${formatCurrency(stats.total_outstanding)}</strong> | Collected This Month: <strong>${formatCurrency(stats.collected_this_month)}</strong> | Write-offs YTD: <strong>${formatCurrency(stats.writeoffs_ytd)}</strong> | Active Debts: <strong>${stats.in_collection}</strong></p>`);
            }
            if (cei !== null) sections.push(`<h3>Collection Effectiveness Index</h3><p style="font-size:20px;font-weight:bold;">${cei.toFixed(1)}%</p>`);
            if (analytics?.collectionByMonth.length) {
              sections.push('<h3>Collection by Month</h3>');
              sections.push(printRows(analytics.collectionByMonth.map((m: any) => ({ Month: m.month, Collected: formatCurrency(m.total) })), ['Month', 'Collected']));
            }
            if (analytics?.aging.length) {
              sections.push('<h3>Aging Breakdown</h3>');
              sections.push(printRows(agingData.map(a => ({ Bucket: a.bucket, Count: a.count, Total: formatCurrency(a.total) })), ['Bucket', 'Count', 'Total']));
            }
            if (recoveryTrend.length) {
              sections.push('<h3>Recovery Rate Trend (12 months)</h3>');
              sections.push(printRows(recoveryTrend.map((t: any) => ({ Month: t.month, Collected: formatCurrency(t.collected), Rate: `${t.rate}%` })), ['Month', 'Collected', 'Rate']));
            }
            if (settlementStats && settlementStats.total > 0) {
              sections.push('<h3>Settlement Success</h3>');
              sections.push(`<p>Total: ${settlementStats.total} | Accepted: ${settlementStats.accepted} | Rejected: ${settlementStats.rejected} | Avg Settlement: ${settlementStats.avg_pct}%</p>`);
            }
            if (commEffectiveness.length) {
              sections.push('<h3>Communication Effectiveness</h3>');
              sections.push(printRows(commEffectiveness.map((c: any) => ({ Type: c.type, Total: c.total, Positive: c.positive, Rate: c.total > 0 ? `${Math.round((c.positive / c.total) * 100)}%` : '0%' })), ['Type', 'Total', 'Positive', 'Rate']));
            }
            if (planPerf && planPerf.total_plans > 0) {
              sections.push('<h3>Payment Plan Performance</h3>');
              sections.push(`<p>Total Plans: ${planPerf.total_plans} | Active: ${planPerf.active} | Completed: ${planPerf.completed} | Defaulted: ${planPerf.defaulted}</p>`);
            }
            if (costRoi) {
              sections.push('<h3>Collection Cost ROI</h3>');
              sections.push(`<p>Collected: ${formatCurrency(costRoi.total_collected)} | Costs: ${formatCurrency(costRoi.total_costs)} | ROI: ${costRoi.roi}%</p>`);
            }
            if (collectorComparison.length) {
              sections.push('<h3>Collector Comparison</h3>');
              sections.push(printRows(collectorComparison.map((c: any) => ({ Name: c.name, Accounts: c.accounts, Collected: formatCurrency(c.collected), Outstanding: formatCurrency(c.outstanding), 'Recovery %': `${c.recovery_rate}%` })), ['Name', 'Accounts', 'Collected', 'Outstanding', 'Recovery %']));
            }
            const html = `<!DOCTYPE html><html><head><title>Debt Analytics Report</title><style>body{font-family:-apple-system,sans-serif;padding:32px;color:#111;}h2{margin-bottom:4px;}h3{margin-top:24px;margin-bottom:8px;border-bottom:1px solid #ddd;padding-bottom:4px;}p{margin:4px 0;}</style></head><body>${sections.join('\n')}<div style="margin-top:32px;font-size:10px;color:#999;border-top:1px solid #eee;padding-top:8px;">Generated ${new Date().toLocaleString()}</div></body></html>`;
            api.printPreview(html, 'Debt Analytics Report');
          }}
          className="block-btn px-3 py-1 text-sm flex items-center gap-1"
          style={{ borderRadius: '6px' }}
          disabled={loading || !hasData}
        >
          <Printer size={14} />
          Print Report
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

          {/* ── 31. Recovery Rate Trend ── */}
          {recoveryTrend.length > 0 && (
            <div className="block-card p-4 col-span-2" style={{ borderRadius: '6px' }}>
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp size={14} className="text-accent-blue" />
                <h3 className="text-text-primary text-sm font-semibold">
                  Recovery Rate Trend (12 Months)
                </h3>
                <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider ml-auto">
                  Industry Avg: {benchmarks.recoveryRate}%
                </span>
              </div>
              <div style={{ height: 250 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={recoveryTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                    <XAxis dataKey="month" tick={{ fill: CHART_TICK_FILL, fontSize: 11 }} axisLine={{ stroke: CHART_GRID_STROKE }} tickLine={false} />
                    <YAxis tick={{ fill: CHART_TICK_FILL, fontSize: 11 }} axisLine={{ stroke: CHART_GRID_STROKE }} tickLine={false} tickFormatter={(v: number) => `${v}%`} />
                    <Tooltip
                      content={({ active, payload, label }: any) => {
                        if (!active || !payload?.length) return null;
                        return (
                          <div style={TOOLTIP_STYLE} className="px-3 py-2 text-xs">
                            <p className="text-text-secondary mb-1">{label}</p>
                            <p className="text-text-primary font-mono">Rate: {payload[0].value}%</p>
                            {payload[1] && <p className="text-text-primary font-mono">Collected: {formatCurrency(payload[1].value)}</p>}
                          </div>
                        );
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="rate" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} name="Recovery Rate %" />
                    <Line type="monotone" dataKey="collected" stroke="#22c55e" strokeWidth={1} strokeDasharray="4 4" dot={false} name="Collected" yAxisId="right" hide />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── 32. Settlement Success Rate ── */}
          {settlementStats && settlementStats.total > 0 && (
            <div className="block-card p-4" style={{ borderRadius: '6px' }}>
              <h3 className="text-text-primary text-sm font-semibold mb-3">
                Settlement Success Rate
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center p-3 bg-bg-tertiary" style={{ borderRadius: 6 }}>
                  <div className="text-2xl font-mono font-bold text-text-primary">{settlementStats.total}</div>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Total Offered</div>
                </div>
                <div className="text-center p-3 bg-bg-tertiary" style={{ borderRadius: 6 }}>
                  <div className="text-2xl font-mono font-bold text-accent-income">{settlementStats.accepted}</div>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Accepted</div>
                </div>
                <div className="text-center p-3 bg-bg-tertiary" style={{ borderRadius: 6 }}>
                  <div className="text-2xl font-mono font-bold text-accent-expense">{settlementStats.rejected}</div>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Rejected</div>
                </div>
                <div className="text-center p-3 bg-bg-tertiary" style={{ borderRadius: 6 }}>
                  <div className="text-2xl font-mono font-bold text-accent-blue">{settlementStats.avg_pct}%</div>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Avg Settlement %</div>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-text-muted px-1">
                <span>
                  Success Rate: <strong className={settlementStats.total > 0 && (settlementStats.accepted / settlementStats.total) * 100 >= benchmarks.settlementRate ? 'text-accent-income' : 'text-accent-expense'}>
                    {settlementStats.total > 0 ? Math.round((settlementStats.accepted / settlementStats.total) * 100) : 0}%
                  </strong>
                </span>
                <span>Benchmark: {benchmarks.settlementRate}%</span>
              </div>
            </div>
          )}

          {/* ── 33. Communication Effectiveness ── */}
          {commEffectiveness.length > 0 && (
            <div className="block-card p-4" style={{ borderRadius: '6px' }}>
              <h3 className="text-text-primary text-sm font-semibold mb-3">
                Communication Effectiveness
              </h3>
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={commEffectiveness.map((c: any) => ({
                    type: (c.type || 'unknown').charAt(0).toUpperCase() + (c.type || 'unknown').slice(1),
                    total: c.total || 0,
                    positive: c.positive || 0,
                    rate: c.total > 0 ? Math.round((c.positive / c.total) * 100) : 0,
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                    <XAxis dataKey="type" tick={{ fill: CHART_TICK_FILL, fontSize: 11 }} axisLine={{ stroke: CHART_GRID_STROKE }} tickLine={false} />
                    <YAxis tick={{ fill: CHART_TICK_FILL, fontSize: 11 }} axisLine={{ stroke: CHART_GRID_STROKE }} tickLine={false} />
                    <Tooltip
                      content={({ active, payload, label }: any) => {
                        if (!active || !payload?.length) return null;
                        return (
                          <div style={TOOLTIP_STYLE} className="px-3 py-2 text-xs">
                            <p className="text-text-secondary mb-1">{label}</p>
                            <p className="text-text-primary font-mono">Total: {payload[0]?.value}</p>
                            <p className="text-accent-income font-mono">Positive: {payload[1]?.value}</p>
                          </div>
                        );
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="total" fill="#6b7280" maxBarSize={30} name="Total" />
                    <Bar dataKey="positive" fill="#22c55e" maxBarSize={30} name="Positive Outcome" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── 34. Payment Plan Performance ── */}
          {planPerf && planPerf.total_plans > 0 && (
            <div className="block-card p-4" style={{ borderRadius: '6px' }}>
              <h3 className="text-text-primary text-sm font-semibold mb-3">
                Payment Plan Performance
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center p-3 bg-bg-tertiary" style={{ borderRadius: 6 }}>
                  <div className="text-2xl font-mono font-bold text-text-primary">{planPerf.total_plans}</div>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Total Plans</div>
                </div>
                <div className="text-center p-3 bg-bg-tertiary" style={{ borderRadius: 6 }}>
                  <div className="text-2xl font-mono font-bold text-accent-blue">{planPerf.active}</div>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Active</div>
                </div>
                <div className="text-center p-3 bg-bg-tertiary" style={{ borderRadius: 6 }}>
                  <div className="text-2xl font-mono font-bold text-accent-income">{planPerf.completed}</div>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Completed</div>
                </div>
                <div className="text-center p-3 bg-bg-tertiary" style={{ borderRadius: 6 }}>
                  <div className="text-2xl font-mono font-bold text-accent-expense">{planPerf.defaulted}</div>
                  <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Defaulted</div>
                </div>
              </div>
              {planPerf.total_plans > 0 && (
                <div className="mt-3 w-full h-3 bg-bg-tertiary flex overflow-hidden" style={{ borderRadius: 6 }}>
                  <div className="bg-accent-income h-full" style={{ width: `${(planPerf.completed / planPerf.total_plans) * 100}%`, transition: 'width 0.5s ease' }} />
                  <div className="bg-accent-blue h-full" style={{ width: `${(planPerf.active / planPerf.total_plans) * 100}%`, transition: 'width 0.5s ease' }} />
                  <div className="bg-accent-expense h-full" style={{ width: `${(planPerf.defaulted / planPerf.total_plans) * 100}%`, transition: 'width 0.5s ease' }} />
                </div>
              )}
              <div className="flex justify-between text-[10px] text-text-muted mt-1 px-1">
                <span className="text-accent-income">Completed {planPerf.total_plans > 0 ? Math.round((planPerf.completed / planPerf.total_plans) * 100) : 0}%</span>
                <span className="text-accent-blue">Active {planPerf.total_plans > 0 ? Math.round((planPerf.active / planPerf.total_plans) * 100) : 0}%</span>
                <span className="text-accent-expense">Defaulted {planPerf.total_plans > 0 ? Math.round((planPerf.defaulted / planPerf.total_plans) * 100) : 0}%</span>
              </div>
            </div>
          )}

          {/* ── 35. Geographic Distribution ── */}
          {geoData.length > 0 && (
            <div className="block-card p-4" style={{ borderRadius: '6px' }}>
              <h3 className="text-text-primary text-sm font-semibold mb-3">
                Geographic Distribution
              </h3>
              <div className="space-y-1">
                <div className="grid grid-cols-3 gap-2 text-[10px] text-text-muted font-semibold uppercase tracking-wider px-2 py-1 border-b border-border-primary">
                  <span>State</span>
                  <span className="text-right">Debts</span>
                  <span className="text-right">Balance</span>
                </div>
                {geoData.map((g: any) => (
                  <div key={g.state} className="grid grid-cols-3 gap-2 text-sm px-2 py-1.5 hover:bg-bg-hover transition-colors" style={{ borderRadius: 6 }}>
                    <span className="text-text-secondary font-medium">{g.state}</span>
                    <span className="text-right font-mono text-text-primary">{g.count}</span>
                    <span className="text-right font-mono text-accent-expense">{formatCurrency(g.balance)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── 36. Collector Comparison Chart ── */}
          {collectorComparison.length > 0 && (
            <div className="block-card p-4 col-span-2" style={{ borderRadius: '6px' }}>
              <h3 className="text-text-primary text-sm font-semibold mb-3">
                Collector Comparison
              </h3>
              <div style={{ height: 250 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={collectorComparison} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} />
                    <XAxis type="number" tick={{ fill: CHART_TICK_FILL, fontSize: 11 }} axisLine={{ stroke: CHART_GRID_STROKE }} tickLine={false} tickFormatter={fmtThousands} />
                    <YAxis type="category" dataKey="name" tick={{ fill: CHART_TICK_FILL, fontSize: 11 }} axisLine={{ stroke: CHART_GRID_STROKE }} tickLine={false} width={100} tickFormatter={(v: string) => v.length > 14 ? v.slice(0, 12) + '...' : v} />
                    <Tooltip
                      content={({ active, payload, label }: any) => {
                        if (!active || !payload?.length) return null;
                        const d = payload[0]?.payload;
                        return (
                          <div style={TOOLTIP_STYLE} className="px-3 py-2 text-xs">
                            <p className="text-text-secondary font-semibold mb-1">{label}</p>
                            <p className="text-text-primary font-mono">Collected: {formatCurrency(d?.collected)}</p>
                            <p className="text-text-primary font-mono">Outstanding: {formatCurrency(d?.outstanding)}</p>
                            <p className="text-text-primary font-mono">Accounts: {d?.accounts}</p>
                            <p className="text-text-primary font-mono">Recovery: {d?.recovery_rate}%</p>
                          </div>
                        );
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="collected" fill="#22c55e" maxBarSize={20} name="Collected" />
                    <Bar dataKey="outstanding" fill="#ef4444" maxBarSize={20} name="Outstanding" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── 37. Collection Cost ROI ── */}
          {costRoi && (costRoi.total_collected > 0 || costRoi.total_costs > 0) && (
            <div className="block-card p-4" style={{ borderRadius: '6px' }}>
              <h3 className="text-text-primary text-sm font-semibold mb-3">
                Collection Cost ROI
              </h3>
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center p-3 bg-bg-tertiary" style={{ borderRadius: 6 }}>
                    <div className="text-lg font-mono font-bold text-accent-income">{formatCurrency(costRoi.total_collected)}</div>
                    <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Total Collected</div>
                  </div>
                  <div className="text-center p-3 bg-bg-tertiary" style={{ borderRadius: 6 }}>
                    <div className="text-lg font-mono font-bold text-accent-expense">{formatCurrency(costRoi.total_costs)}</div>
                    <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Total Costs</div>
                  </div>
                  <div className="text-center p-3 bg-bg-tertiary" style={{ borderRadius: 6 }}>
                    <div className={`text-lg font-mono font-bold ${costRoi.roi >= 100 ? 'text-accent-income' : costRoi.roi >= 0 ? 'text-yellow-500' : 'text-accent-expense'}`}>
                      {costRoi.roi}%
                    </div>
                    <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">ROI</div>
                  </div>
                </div>
                <div className="text-xs text-text-muted text-center">
                  Net Gain: <strong className={costRoi.total_collected - costRoi.total_costs >= 0 ? 'text-accent-income' : 'text-accent-expense'}>
                    {formatCurrency(costRoi.total_collected - costRoi.total_costs)}
                  </strong>
                </div>
              </div>
            </div>
          )}

          {/* ── 40. Benchmark Indicators Summary ── */}
          <div className="block-card p-4" style={{ borderRadius: '6px' }}>
            <h3 className="text-text-primary text-sm font-semibold mb-3">
              Industry Benchmark Comparison
            </h3>
            <div className="space-y-3">
              {[
                {
                  label: 'Collection Effectiveness (CEI)',
                  yours: cei ?? 0,
                  benchmark: benchmarks.ceiTarget,
                  suffix: '%',
                },
                {
                  label: 'Recovery Rate',
                  yours: recoveryTrend.length > 0 ? recoveryTrend[recoveryTrend.length - 1]?.rate ?? 0 : 0,
                  benchmark: benchmarks.recoveryRate,
                  suffix: '%',
                },
                {
                  label: 'Settlement Acceptance',
                  yours: settlementStats && settlementStats.total > 0 ? Math.round((settlementStats.accepted / settlementStats.total) * 100) : 0,
                  benchmark: benchmarks.settlementRate,
                  suffix: '%',
                },
                {
                  label: 'Avg Settlement %',
                  yours: settlementStats?.avg_pct ?? 0,
                  benchmark: benchmarks.avgSettlementPct,
                  suffix: '%',
                },
              ].map((item) => (
                <div key={item.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-text-secondary">{item.label}</span>
                    <span className="text-text-muted">
                      Yours: <strong className={item.yours >= item.benchmark ? 'text-accent-income' : 'text-accent-expense'}>{item.yours}{item.suffix}</strong>
                      {' / '}
                      Avg: {item.benchmark}{item.suffix}
                    </span>
                  </div>
                  <div className="relative w-full h-2 bg-bg-tertiary" style={{ borderRadius: 6 }}>
                    <div
                      className={item.yours >= item.benchmark ? 'bg-accent-income' : 'bg-accent-expense'}
                      style={{ width: `${Math.min((item.yours / Math.max(item.benchmark * 2, 1)) * 100, 100)}%`, height: '100%', borderRadius: 6, transition: 'width 0.5s ease' }}
                    />
                    <div
                      className="absolute top-0 h-full w-0.5 bg-text-muted"
                      style={{ left: `${Math.min((item.benchmark / Math.max(item.benchmark * 2, 1)) * 100, 100)}%` }}
                      title={`Benchmark: ${item.benchmark}${item.suffix}`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AnalyticsView;
