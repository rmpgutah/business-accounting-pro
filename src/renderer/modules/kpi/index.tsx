import React, { useEffect, useState } from 'react';
import {
  DollarSign,
  Clock,
  TrendingUp,
  Users,
  BarChart3,
  Percent,
  Flame,
  Shield,
  RefreshCw,
  Scale,
} from 'lucide-react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency } from '../../lib/format';

const fmtCompact = (value: number) => {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}k`;
  return formatCurrency(value);
};

// ─── Types ──────────────────────────────────────────────
interface ClientRevenue {
  client_name: string;
  total_revenue: number;
}

interface GrossMarginPoint {
  month: string;
  margin: number;
  revenue: number;
  cogs: number;
}

// ─── Custom Tooltip ─────────────────────────────────────
const MarginTooltip: React.FC<any> = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="text-xs px-3 py-2"
      style={{
        backgroundColor: '#1a1a1a',
        border: '1px solid #2e2e2e',
        borderRadius: '6px',
      }}
    >
      <p className="text-text-muted mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }} className="font-mono">
          {p.dataKey === 'margin' ? 'Gross Margin' : p.dataKey}:{' '}
          {p.dataKey === 'margin' ? `${p.value.toFixed(1)}%` : formatCurrency(p.value)}
        </p>
      ))}
    </div>
  );
};

// ─── KPI Dashboard Component ────────────────────────────
const KPIDashboard: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [revenuePerHour, setRevenuePerHour] = useState(0);
  const [utilizationRate, setUtilizationRate] = useState(0);
  const [profitMargin, setProfitMargin] = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalExpenses, setTotalExpenses] = useState(0);
  const [topClients, setTopClients] = useState<ClientRevenue[]>([]);
  const [grossMarginTrend, setGrossMarginTrend] = useState<GrossMarginPoint[]>([]);
  const [revenuePerEmployee, setRevenuePerEmployee] = useState(0);
  const [employeeCount, setEmployeeCount] = useState(0);
  const [arTurnover, setArTurnover] = useState(0);
  const [currentRatio, setCurrentRatio] = useState(0);
  const [currentAssets, setCurrentAssets] = useState(0);
  const [currentLiabilities, setCurrentLiabilities] = useState(0);
  const [monthlyBurnRate, setMonthlyBurnRate] = useState(0);
  const [runway, setRunway] = useState(0);
  const [cashOnHand, setCashOnHand] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dashData, setDashData] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!activeCompany) return;
      const cid = activeCompany.id;
      try {
        const [
          revenueResult,
          hoursResult,
          totalHoursResult,
          expenseResult,
          clientResults,
          grossMarginData,
          employeeCountData,
          arData,
          avgReceivablesData,
          assetData,
          liabilityData,
          cashData,
          last6MonthExpenses,
        ] = await Promise.all([
          // Revenue per billable hour
          api.rawQuery(
            `SELECT COALESCE(SUM(total), 0) as total_revenue FROM invoices WHERE company_id = ? AND status IN ('paid', 'sent')`,
            [cid]
          ),
          api.rawQuery(
            `SELECT COALESCE(SUM(duration_minutes), 0) as total_billable_minutes FROM time_entries WHERE company_id = ? AND is_billable = 1`,
            [cid]
          ),
          api.rawQuery(
            `SELECT COALESCE(SUM(duration_minutes), 0) as total_minutes FROM time_entries WHERE company_id = ?`,
            [cid]
          ),
          api.rawQuery(
            `SELECT COALESCE(SUM(amount), 0) as total_expenses FROM expenses WHERE company_id = ?`,
            [cid]
          ),
          // Top 5 clients by revenue
          api.rawQuery(
            `SELECT c.name as client_name, COALESCE(SUM(i.total), 0) as total_revenue
             FROM invoices i
             JOIN clients c ON i.client_id = c.id
             WHERE i.company_id = ? AND i.status IN ('paid', 'sent')
             GROUP BY c.id, c.name
             ORDER BY total_revenue DESC
             LIMIT 5`,
            [cid]
          ),
          // Gross margin by month (last 6 months) — revenue vs expenses as proxy for COGS
          api.rawQuery(
            `SELECT
               r.month,
               COALESCE(r.rev, 0) as revenue,
               COALESCE(e.exp, 0) as cogs
             FROM (
               SELECT strftime('%Y-%m', issue_date) as month, SUM(total) as rev
               FROM invoices WHERE company_id = ? AND status IN ('paid','sent') AND issue_date >= date('now', '-6 months')
               GROUP BY month
             ) r
             LEFT JOIN (
               SELECT strftime('%Y-%m', date) as month, SUM(amount) as exp
               FROM expenses WHERE company_id = ? AND date >= date('now', '-6 months')
               GROUP BY month
             ) e ON r.month = e.month
             ORDER BY r.month ASC`,
            [cid, cid]
          ),
          // Employee count
          api.rawQuery(
            `SELECT COUNT(*) as cnt FROM employees WHERE company_id = ? AND status = 'active'`,
            [cid]
          ),
          // Net credit sales (last 12 months) for AR turnover
          api.rawQuery(
            `SELECT COALESCE(SUM(total), 0) as net_credit_sales
             FROM invoices
             WHERE company_id = ? AND status IN ('paid','sent','partial','overdue')
               AND issue_date >= date('now', '-12 months')`,
            [cid]
          ),
          // Average accounts receivable
          api.rawQuery(
            `SELECT COALESCE(SUM(total - amount_paid), 0) as avg_receivables
             FROM invoices
             WHERE company_id = ? AND status IN ('sent','partial','overdue')`,
            [cid]
          ),
          // Current assets (from accounts table)
          api.rawQuery(
            `SELECT COALESCE(SUM(balance), 0) as total
             FROM accounts WHERE company_id = ? AND type = 'asset' AND is_active = 1`,
            [cid]
          ),
          // Current liabilities
          api.rawQuery(
            `SELECT COALESCE(SUM(balance), 0) as total
             FROM accounts WHERE company_id = ? AND type = 'liability' AND is_active = 1`,
            [cid]
          ),
          // Cash on hand (bank accounts)
          api.rawQuery(
            `SELECT COALESCE(SUM(current_balance), 0) as cash FROM bank_accounts WHERE company_id = ?`,
            [cid]
          ),
          // Last 6 months total expenses for burn rate
          api.rawQuery(
            `SELECT COALESCE(SUM(amount), 0) as total, COUNT(DISTINCT strftime('%Y-%m', date)) as months
             FROM expenses WHERE company_id = ? AND date >= date('now', '-6 months')`,
            [cid]
          ),
        ]);

        if (cancelled) return;

        // Dashboard summary data
        try {
          const dd = await api.getDashboardData(cid);
          if (!cancelled) setDashData(dd);
        } catch (_) {
          // non-fatal
        }

        // Basic KPIs
        const rev1 = Array.isArray(revenueResult) ? revenueResult[0] : revenueResult;
        const hrs1 = Array.isArray(hoursResult) ? hoursResult[0] : hoursResult;
        const thrs = Array.isArray(totalHoursResult) ? totalHoursResult[0] : totalHoursResult;
        const exp1 = Array.isArray(expenseResult) ? expenseResult[0] : expenseResult;

        const revenue = rev1?.total_revenue ?? 0;
        const billableMinutes = hrs1?.total_billable_minutes ?? 0;
        const totalMinutes = thrs?.total_minutes ?? 0;
        const expenses = exp1?.total_expenses ?? 0;

        const billableHours = billableMinutes / 60;
        const totalHours = totalMinutes / 60;

        setTotalRevenue(revenue);
        setTotalExpenses(expenses);
        setRevenuePerHour(billableHours > 0 ? revenue / billableHours : 0);
        setUtilizationRate(totalHours > 0 ? (billableMinutes / totalMinutes) * 100 : 0);
        setProfitMargin(revenue > 0 ? ((revenue - expenses) / revenue) * 100 : 0);
        setTopClients(clientResults ?? []);

        // Gross Margin Trend
        if (grossMarginData && Array.isArray(grossMarginData)) {
          const trend: GrossMarginPoint[] = grossMarginData.map((r: any) => ({
            month: r.month,
            revenue: r.revenue || 0,
            cogs: r.cogs || 0,
            margin: r.revenue > 0 ? ((r.revenue - r.cogs) / r.revenue) * 100 : 0,
          }));
          setGrossMarginTrend(trend);
        }

        // Revenue per Employee
        const empCount = Array.isArray(employeeCountData) ? employeeCountData[0]?.cnt : employeeCountData?.cnt;
        const ec = empCount || 0;
        setEmployeeCount(ec);
        setRevenuePerEmployee(ec > 0 ? revenue / ec : 0);

        // AR Turnover
        const arSales = Array.isArray(arData) ? arData[0] : arData;
        const arAvg = Array.isArray(avgReceivablesData) ? avgReceivablesData[0] : avgReceivablesData;
        const netCreditSales = arSales?.net_credit_sales ?? 0;
        const avgAR = arAvg?.avg_receivables ?? 0;
        setArTurnover(avgAR > 0 ? netCreditSales / avgAR : 0);

        // Current Ratio
        const assets = Array.isArray(assetData) ? assetData[0] : assetData;
        const liabilities = Array.isArray(liabilityData) ? liabilityData[0] : liabilityData;
        const ca = Math.abs(assets?.total ?? 0);
        const cl = Math.abs(liabilities?.total ?? 0);
        setCurrentAssets(ca);
        setCurrentLiabilities(cl);
        setCurrentRatio(cl > 0 ? ca / cl : ca > 0 ? Infinity : 0);

        // Monthly Burn Rate & Runway
        const cashRow = Array.isArray(cashData) ? cashData[0] : cashData;
        const cash = cashRow?.cash ?? 0;
        setCashOnHand(cash);

        const burnRow = Array.isArray(last6MonthExpenses) ? last6MonthExpenses[0] : last6MonthExpenses;
        const totalExp6m = burnRow?.total ?? 0;
        const monthCount = burnRow?.months ?? 1;
        const burn = monthCount > 0 ? totalExp6m / monthCount : 0;
        setMonthlyBurnRate(burn);
        setRunway(burn > 0 ? cash / burn : 0);
      } catch (err) {
        console.error('KPI data load failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [activeCompany]);

  const utilizationColor =
    utilizationRate >= 75
      ? 'var(--color-accent-income)'
      : utilizationRate >= 50
        ? 'var(--color-accent-warning)'
        : 'var(--color-accent-expense)';

  const maxClientRevenue =
    topClients.length > 0
      ? Math.max(...topClients.map((c) => c.total_revenue))
      : 1;

  const burnRateColor =
    monthlyBurnRate <= 0
      ? 'var(--color-accent-income)'
      : 'var(--color-accent-expense)';

  const runwayColor =
    runway >= 12
      ? 'var(--color-accent-income)'
      : runway >= 6
        ? 'var(--color-accent-warning)'
        : 'var(--color-accent-expense)';

  const currentRatioColor =
    currentRatio >= 2
      ? 'var(--color-accent-income)'
      : currentRatio >= 1
        ? 'var(--color-accent-warning)'
        : 'var(--color-accent-expense)';

  const monthlyChartData = dashData?.months?.map((m: string) => {
    const rev = dashData.revenueByMonth?.find((r: any) => r.month === m);
    const exp = dashData.expenseByMonth?.find((e: any) => e.month === m);
    return { month: m.slice(5), revenue: Number(rev?.total || 0), expenses: Number(exp?.total || 0) };
  }) || [];

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <span className="text-text-muted text-sm">Loading KPI data...</span>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      {/* Header */}
      <div className="module-header">
        <div className="flex items-center gap-2">
          <BarChart3 size={20} className="text-accent-blue" />
          <h1 className="module-title">KPI Dashboard</h1>
        </div>
      </div>

      {/* ─── Row 1: Core Financial KPIs (3 cols) ─── */}
      <div className="grid grid-cols-3 gap-4">
        {/* Revenue per Billable Hour */}
        <div className="stat-card border-l-2 border-l-accent-income">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign size={14} className="text-accent-income" />
            <span className="stat-label">Revenue per Billable Hour</span>
          </div>
          <p className="stat-value text-accent-income">{formatCurrency(revenuePerHour)}</p>
          <span className="text-xs text-text-muted">
            {formatCurrency(totalRevenue)} total revenue
          </span>
        </div>

        {/* Utilization Rate */}
        <div className="stat-card border-l-2" style={{ borderLeftColor: utilizationColor }}>
          <div className="flex items-center gap-2 mb-1">
            <Clock size={14} style={{ color: utilizationColor }} />
            <span className="stat-label">Utilization Rate</span>
          </div>
          <p className="stat-value" style={{ color: utilizationColor }}>
            {utilizationRate.toFixed(1)}%
          </p>
          <div
            style={{
              width: '100%',
              height: '6px',
              backgroundColor: 'var(--color-bg-tertiary)',
              borderRadius: '6px',
              marginTop: '0.5rem',
            }}
          >
            <div
              style={{
                width: `${Math.min(utilizationRate, 100)}%`,
                height: '100%',
                backgroundColor: utilizationColor,
                borderRadius: '6px',
                transition: 'width 0.4s ease',
              }}
            />
          </div>
          <span className="text-xs text-text-muted mt-1">Billable / Total hours</span>
        </div>

        {/* Profit Margin */}
        <div
          className="stat-card border-l-2"
          style={{
            borderLeftColor:
              profitMargin >= 0
                ? 'var(--color-accent-blue)'
                : 'var(--color-accent-expense)',
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            <Percent size={14} className="text-accent-blue" />
            <span className="stat-label">Profit Margin</span>
          </div>
          <p
            className="stat-value"
            style={{
              color:
                profitMargin >= 0
                  ? 'var(--color-accent-blue)'
                  : 'var(--color-accent-expense)',
            }}
          >
            {profitMargin.toFixed(1)}%
          </p>
          <span className="text-xs text-text-muted">
            {formatCurrency(totalRevenue - totalExpenses)} net profit
          </span>
        </div>
      </div>

      {/* ─── Gross Margin Trend Chart ─── */}
      <div className="block-card p-5" style={{ borderRadius: '6px' }}>
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={14} className="text-accent-income" />
          <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            Gross Margin Trend (Last 6 Months)
          </h2>
        </div>
        {grossMarginTrend.length === 0 ? (
          <div className="flex items-center justify-center" style={{ minHeight: 260 }}>
            <span className="text-xs text-text-muted">No historical data available</span>
          </div>
        ) : (
          <div style={{ width: '100%', minHeight: 260 }}>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={grossMarginTrend}>
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
                  domain={[0, 100]}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip content={<MarginTooltip />} />
                <Line
                  type="monotone"
                  dataKey="margin"
                  stroke="#22c55e"
                  strokeWidth={2}
                  dot={{ r: 4, fill: '#22c55e', stroke: '#0a0a0a', strokeWidth: 2 }}
                  activeDot={{ r: 6, fill: '#22c55e' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* ─── Revenue vs Expenses BarChart + AR Aging + Health Score + Top Clients ─── */}
      <div className="grid grid-cols-2 gap-4">
        {/* Revenue vs Expenses — 12 Month */}
        {dashData && (
          <div className="block-card" style={{ gridColumn: 'span 2' }}>
            <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">Revenue vs Expenses (12 Months)</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthlyChartData} barGap={4}>
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(v: number) => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                <Bar dataKey="revenue" fill="#2563eb" radius={[2,2,0,0]} name="Revenue" />
                <Bar dataKey="expenses" fill="#ef4444" radius={[2,2,0,0]} name="Expenses" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* AR Aging */}
        {dashData?.arAging && (
          <div className="block-card">
            <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">AR Aging</div>
            {(() => {
              const a = dashData.arAging;
              const segments = [
                { label: 'Current',  value: Number(a.current_amt || 0),   color: '#16a34a' },
                { label: '1–30d',    value: Number(a.days_1_30 || 0),     color: '#d97706' },
                { label: '31–60d',   value: Number(a.days_31_60 || 0),    color: '#ea580c' },
                { label: '60d+',     value: Number(a.days_60_plus || 0),  color: '#dc2626' },
              ];
              const total = segments.reduce((s, x) => s + x.value, 0);
              if (total === 0) return (
                <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', textAlign: 'center', padding: 20 }}>No outstanding AR</div>
              );
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {segments.filter(s => s.value > 0).map(s => (
                    <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '6px', background: s.color, flexShrink: 0 }} />
                      <div style={{ flex: 1, fontSize: '12px', color: 'var(--color-text-secondary)' }}>{s.label}</div>
                      <div style={{ fontSize: '12px', fontVariantNumeric: 'tabular-nums', color: s.color, fontWeight: 600 }}>{formatCurrency(s.value)}</div>
                      <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', width: 36, textAlign: 'right' }}>{((s.value/total)*100).toFixed(0)}%</div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {/* Financial Health Score */}
        {dashData && (
          <div className="block-card" style={{ textAlign: 'center' }}>
            <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">Financial Health Score</div>
            {(() => {
              const score = Number(dashData.healthScore ?? 0);
              const color = score >= 80 ? '#16a34a' : score >= 60 ? '#d97706' : '#dc2626';
              const label = score >= 80 ? 'Healthy' : score >= 60 ? 'Watch' : 'At Risk';
              return (
                <div>
                  <div style={{ fontSize: 56, fontWeight: 900, color, lineHeight: 1 }}>{score}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color, marginTop: 4, textTransform: 'uppercase', letterSpacing: '1px' }}>{label}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8 }}>DSO: {Math.round(Number(dashData.dso || 0))} days</div>
                </div>
              );
            })()}
          </div>
        )}

        {/* Top Clients by Revenue */}
        {dashData?.topClients?.length > 0 && (
          <div className="block-card">
            <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">Top Clients by Revenue</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {dashData.topClients.slice(0, 6).map((c: any, i: number) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', alignItems: 'center' }}>
                  <span style={{ color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, marginRight: 8 }}>{c.client_name}</span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: 'var(--color-text-primary)', flexShrink: 0 }}>{formatCurrency(Number(c.total_revenue || 0))}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ─── Row 2: Advanced KPIs (3 cols) ─── */}
      <div className="grid grid-cols-3 gap-4">
        {/* Revenue per Employee */}
        <div className="stat-card border-l-2 border-l-accent-purple">
          <div className="flex items-center gap-2 mb-1">
            <Users size={14} className="text-accent-purple" />
            <span className="stat-label">Revenue per Employee</span>
          </div>
          <p className="stat-value text-accent-purple">
            {formatCurrency(revenuePerEmployee)}
          </p>
          <span className="text-xs text-text-muted">
            {employeeCount} active employee{employeeCount !== 1 ? 's' : ''}
          </span>
        </div>

        {/* AR Turnover */}
        <div className="stat-card border-l-2 border-l-accent-blue">
          <div className="flex items-center gap-2 mb-1">
            <RefreshCw size={14} className="text-accent-blue" />
            <span className="stat-label">AR Turnover Ratio</span>
          </div>
          <p className="stat-value text-accent-blue">
            {arTurnover.toFixed(1)}x
          </p>
          <span className="text-xs text-text-muted">
            {arTurnover > 0
              ? `~${Math.round(365 / arTurnover)} days to collect`
              : 'No receivables data'}
          </span>
        </div>

        {/* Current Ratio */}
        <div className="stat-card border-l-2" style={{ borderLeftColor: currentRatioColor }}>
          <div className="flex items-center gap-2 mb-1">
            <Scale size={14} style={{ color: currentRatioColor }} />
            <span className="stat-label">Current Ratio</span>
          </div>
          <p className="stat-value" style={{ color: currentRatioColor }}>
            {currentRatio === Infinity ? 'N/A' : currentRatio.toFixed(2)}
          </p>
          <span className="text-xs text-text-muted">
            {fmtCompact(currentAssets)} assets / {fmtCompact(currentLiabilities)} liabilities
          </span>
          {currentRatio !== Infinity && currentRatio > 0 && (
            <div
              style={{
                width: '100%',
                height: '6px',
                backgroundColor: 'var(--color-bg-tertiary)',
                borderRadius: '6px',
                marginTop: '0.5rem',
              }}
            >
              <div
                style={{
                  width: `${Math.min(currentRatio / 3, 1) * 100}%`,
                  height: '100%',
                  backgroundColor: currentRatioColor,
                  borderRadius: '6px',
                  transition: 'width 0.4s ease',
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* ─── Row 3: Burn Rate & Runway (2 cols) ─── */}
      <div className="grid grid-cols-2 gap-4">
        {/* Monthly Burn Rate */}
        <div className="stat-card border-l-2" style={{ borderLeftColor: burnRateColor }}>
          <div className="flex items-center gap-2 mb-1">
            <Flame size={14} style={{ color: burnRateColor }} />
            <span className="stat-label">Monthly Burn Rate</span>
          </div>
          <p className="stat-value" style={{ color: burnRateColor }}>
            {formatCurrency(monthlyBurnRate)}
          </p>
          <span className="text-xs text-text-muted">
            Average of last 6 months expenses
          </span>
        </div>

        {/* Runway */}
        <div className="stat-card border-l-2" style={{ borderLeftColor: runwayColor }}>
          <div className="flex items-center gap-2 mb-1">
            <Shield size={14} style={{ color: runwayColor }} />
            <span className="stat-label">Runway</span>
          </div>
          <p className="stat-value" style={{ color: runwayColor }}>
            {runway === Infinity || monthlyBurnRate <= 0
              ? 'Infinite'
              : `${runway.toFixed(1)} months`}
          </p>
          <span className="text-xs text-text-muted">
            {fmtCompact(cashOnHand)} cash / {fmtCompact(monthlyBurnRate)} monthly burn
          </span>
          {runway > 0 && runway !== Infinity && monthlyBurnRate > 0 && (
            <div
              style={{
                width: '100%',
                height: '6px',
                backgroundColor: 'var(--color-bg-tertiary)',
                borderRadius: '6px',
                marginTop: '0.5rem',
              }}
            >
              <div
                style={{
                  width: `${Math.min(runway / 24, 1) * 100}%`,
                  height: '100%',
                  backgroundColor: runwayColor,
                  borderRadius: '6px',
                  transition: 'width 0.4s ease',
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* ─── Bottom Row: Top Clients ─── */}
      <div className="block-card p-5" style={{ borderRadius: '6px' }}>
        <div className="flex items-center gap-2 mb-4">
          <Users size={14} className="text-accent-purple" />
          <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            Top 5 Clients by Revenue
          </h2>
        </div>
        {topClients.length === 0 ? (
          <div className="empty-state py-8">
            <span className="text-text-muted text-sm">No client revenue data yet</span>
          </div>
        ) : (
          <div className="space-y-3">
            {topClients.map((client, i) => (
              <div key={i}>
                <div className="flex justify-between items-center mb-1">
                  <span
                    className="text-sm text-text-primary truncate"
                    style={{ maxWidth: '60%' }}
                  >
                    {client.client_name}
                  </span>
                  <span className="text-sm font-mono text-text-secondary">
                    {formatCurrency(client.total_revenue)}
                  </span>
                </div>
                <div
                  style={{
                    width: '100%',
                    height: '8px',
                    backgroundColor: 'var(--color-bg-tertiary)',
                    borderRadius: '6px',
                  }}
                >
                  <div
                    style={{
                      width: `${(client.total_revenue / maxClientRevenue) * 100}%`,
                      height: '100%',
                      backgroundColor: 'var(--color-accent-purple)',
                      borderRadius: '6px',
                      transition: 'width 0.4s ease',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default KPIDashboard;
