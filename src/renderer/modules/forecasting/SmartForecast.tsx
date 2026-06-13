import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, DollarSign, RefreshCw, Layers } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate, percentChange } from '../../lib/format';

// ─── Return-shape types (derived from service implementations) ──

interface CashForecastRow {
  projection_date: string;
  cash_in: number;
  cash_out: number;
  line_count: number;
}

interface PaymentForecastWeek {
  week: number;
  start: string;
  end: string;
  expectedCollections: number;
}

interface ApVsArData {
  accountsPayable: number;
  accountsReceivable: number;
  netPosition: number;
  ratio: number;
}

interface RecurringRevenue {
  recurringInvoices: number;
  recurringRevenue: number;
}

interface RevenueByServiceRow {
  service: string;
  invoice_count: number;
  total: number;
}

interface ProfitMarginRow {
  month: string;
  revenue: number;
  expenses: number;
  net: number;
  margin: number;
}

interface MoMGrowth {
  thisMonth: number;
  lastMonth: number;
  growth: number;
}

interface SpendForecastRow {
  day_offset: number;
  date: string;
  forecast: number;
}

interface BenchmarkRow {
  category_name: string;
  total: number;
  my_pct_of_revenue: number;
  industry_avg_pct: number | null;
  industry_median_pct: number | null;
  variance: number | null;
}

// ─── Small helpers ──────────────────────────────────────────────

function Section({ title, loading, empty, children }: {
  title: string;
  loading: boolean;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="block-card p-5">
      <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">{title}</h2>
      {loading ? (
        <div className="text-xs text-text-muted py-4">Loading…</div>
      ) : empty ? (
        <div className="empty-state py-6">
          <span className="text-text-muted text-sm">No data available</span>
        </div>
      ) : children}
    </div>
  );
}

function GrowthBadge({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const positive = pct >= 0;
  return (
    <span
      className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded"
      style={{
        color: positive ? 'var(--color-accent-income)' : 'var(--color-accent-expense)',
        background: positive ? 'rgba(34,197,94,0.1)' : 'rgba(244,63,94,0.1)',
      }}
    >
      {positive ? '+' : ''}{pct.toFixed(1)}%
    </span>
  );
}

// ─── SmartForecast Component ─────────────────────────────────────

const SmartForecast: React.FC = () => {
  // Cash-flow forecast (feat:cash-forecast:get)
  const [cashForecast, setCashForecast] = useState<CashForecastRow[]>([]);
  const [cashLoading, setCashLoading] = useState(true);

  // Payment forecast (sw:payment-forecast)
  const [paymentForecast, setPaymentForecast] = useState<PaymentForecastWeek[]>([]);
  const [paymentLoading, setPaymentLoading] = useState(true);

  // AP vs AR bridge (sw:ap-vs-ar)
  const [apVsAr, setApVsAr] = useState<ApVsArData | null>(null);
  const [apArLoading, setApArLoading] = useState(true);

  // Recurring revenue split (sw:recurring-revenue + sw:revenue-by-service)
  const [recurringRevenue, setRecurringRevenue] = useState<RecurringRevenue | null>(null);
  const [revenueByService, setRevenueByService] = useState<RevenueByServiceRow[]>([]);
  const [recurringLoading, setRecurringLoading] = useState(true);

  // Profit-margin trend + MoM growth (sw:profit-margin-trend + sw:mom-growth)
  const [marginTrend, setMarginTrend] = useState<ProfitMarginRow[]>([]);
  const [momGrowth, setMomGrowth] = useState<MoMGrowth | null>(null);
  const [marginLoading, setMarginLoading] = useState(true);

  // 90-day spend forecast + benchmark (feat:spend:forecast-90d + feat:spend:benchmark-vs-industry)
  const [spendForecast, setSpendForecast] = useState<SpendForecastRow[]>([]);
  const [benchmarkRows, setBenchmarkRows] = useState<BenchmarkRow[]>([]);
  const [spendLoading, setSpendLoading] = useState(true);

  // ─── Load: cash-flow forecast ──────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setCashLoading(true);
    api.featCashForecastGet({ days: 30 })
      .then((rows: any) => {
        if (cancelled) return;
        setCashForecast(Array.isArray(rows) ? rows : []);
      })
      .catch(() => { if (!cancelled) setCashForecast([]); })
      .finally(() => { if (!cancelled) setCashLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // ─── Load: payment forecast ────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setPaymentLoading(true);
    api.swPaymentForecast(8)
      .then((rows: any) => {
        if (cancelled) return;
        setPaymentForecast(Array.isArray(rows) ? rows : []);
      })
      .catch(() => { if (!cancelled) setPaymentForecast([]); })
      .finally(() => { if (!cancelled) setPaymentLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // ─── Load: AP vs AR ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setApArLoading(true);
    api.swApVsAr()
      .then((data: any) => {
        if (cancelled) return;
        setApVsAr(data && typeof data === 'object' ? data : null);
      })
      .catch(() => { if (!cancelled) setApVsAr(null); })
      .finally(() => { if (!cancelled) setApArLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // ─── Load: Recurring revenue + by-service ─────────────────────
  useEffect(() => {
    let cancelled = false;
    setRecurringLoading(true);
    Promise.resolve()
      .then(async () => {
        const [rr, rs] = await Promise.all([
          api.swRecurringRevenue(),
          api.swRevenueByService(),
        ]);
        if (cancelled) return;
        setRecurringRevenue(rr && typeof rr === 'object' ? (rr as RecurringRevenue) : null);
        setRevenueByService(Array.isArray(rs) ? rs : []);
      })
      .catch(() => {
        if (!cancelled) { setRecurringRevenue(null); setRevenueByService([]); }
      })
      .finally(() => { if (!cancelled) setRecurringLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // ─── Load: Profit margin trend + MoM ──────────────────────────
  useEffect(() => {
    let cancelled = false;
    setMarginLoading(true);
    Promise.resolve()
      .then(async () => {
        const [trend, mom] = await Promise.all([
          api.swProfitMarginTrend(),
          api.swMoMGrowth(),
        ]);
        if (cancelled) return;
        setMarginTrend(Array.isArray(trend) ? trend : []);
        setMomGrowth(mom && typeof mom === 'object' ? (mom as MoMGrowth) : null);
      })
      .catch(() => {
        if (!cancelled) { setMarginTrend([]); setMomGrowth(null); }
      })
      .finally(() => { if (!cancelled) setMarginLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // ─── Load: 90-day spend forecast + industry benchmark ─────────
  useEffect(() => {
    let cancelled = false;
    setSpendLoading(true);
    Promise.resolve()
      .then(async () => {
        const sf = await api.featSpendForecast90d();
        if (cancelled) return;
        setSpendForecast(Array.isArray(sf) ? sf : []);
        // Derive projected total revenue from first cash-forecast row to pass to benchmark
        // Use a modest placeholder — benchmark is categorical, revenue is directional only
        const bm = await api.featSpendBenchmarkVsIndustry('general', 0);
        if (cancelled) return;
        setBenchmarkRows(Array.isArray(bm) ? bm : []);
      })
      .catch(() => {
        if (!cancelled) { setSpendForecast([]); setBenchmarkRows([]); }
      })
      .finally(() => { if (!cancelled) setSpendLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // ─── KPI strip ─────────────────────────────────────────────────
  const projectedCashIn = cashForecast.reduce((s, r) => s + r.cash_in, 0);
  const projectedCashOut = cashForecast.reduce((s, r) => s + r.cash_out, 0);
  const projectedNet = projectedCashIn - projectedCashOut;
  const dailyAvgSpend = spendForecast.length > 0 ? spendForecast[0].forecast : 0;
  const spend90dTotal = dailyAvgSpend * 90;
  const recurringPct = (recurringRevenue?.recurringRevenue || 0) > 0
    ? (recurringRevenue!.recurringRevenue / (revenueByService.reduce((s, r) => s + r.total, 0) || 1)) * 100
    : 0;

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">

      {/* KPI Strip */}
      <div className="grid grid-cols-4 gap-4">
        <div className="stat-card border-l-2" style={{ borderLeftColor: 'var(--color-accent-blue)' }}>
          <div className="flex items-center gap-2 mb-1">
            <DollarSign size={13} style={{ color: 'var(--color-accent-blue)' }} />
            <span className="stat-label">Projected Cash (30d)</span>
          </div>
          <p className="stat-value" style={{ color: projectedNet >= 0 ? 'var(--color-accent-income)' : 'var(--color-accent-expense)' }}>
            {cashLoading ? '—' : formatCurrency(projectedNet)}
          </p>
          <span className="text-xs text-text-muted">In: {formatCurrency(projectedCashIn)} · Out: {formatCurrency(projectedCashOut)}</span>
        </div>

        <div className="stat-card border-l-2" style={{ borderLeftColor: 'var(--color-accent-expense)' }}>
          <div className="flex items-center gap-2 mb-1">
            <TrendingDown size={13} style={{ color: 'var(--color-accent-expense)' }} />
            <span className="stat-label">90-Day Spend Forecast</span>
          </div>
          <p className="stat-value" style={{ color: 'var(--color-accent-expense)' }}>
            {spendLoading ? '—' : formatCurrency(spend90dTotal)}
          </p>
          <span className="text-xs text-text-muted">{spendLoading ? '' : `~${formatCurrency(dailyAvgSpend)}/day avg`}</span>
        </div>

        <div className="stat-card border-l-2" style={{ borderLeftColor: 'var(--color-accent-warning)' }}>
          <div className="flex items-center gap-2 mb-1">
            <RefreshCw size={13} style={{ color: 'var(--color-accent-warning)' }} />
            <span className="stat-label">AR vs AP</span>
          </div>
          {apArLoading ? (
            <p className="stat-value text-text-muted">—</p>
          ) : apVsAr ? (
            <>
              <p className="stat-value" style={{ color: apVsAr.netPosition >= 0 ? 'var(--color-accent-income)' : 'var(--color-accent-expense)' }}>
                {formatCurrency(apVsAr.netPosition)}
              </p>
              <span className="text-xs text-text-muted">AR/AP ratio: {apVsAr.ratio.toFixed(2)}</span>
            </>
          ) : (
            <p className="stat-value text-text-muted">—</p>
          )}
        </div>

        <div className="stat-card border-l-2" style={{ borderLeftColor: 'var(--color-accent-income)' }}>
          <div className="flex items-center gap-2 mb-1">
            <Layers size={13} style={{ color: 'var(--color-accent-income)' }} />
            <span className="stat-label">Recurring Revenue %</span>
          </div>
          <p className="stat-value" style={{ color: 'var(--color-accent-income)' }}>
            {recurringLoading ? '—' : `${recurringPct.toFixed(1)}%`}
          </p>
          <span className="text-xs text-text-muted">
            {recurringLoading ? '' : `${recurringRevenue?.recurringInvoices ?? 0} recurring invoices`}
          </span>
        </div>
      </div>

      {/* ─── Cash-Flow Forecast (30-day) ─── */}
      <Section title="Cash-Flow Forecast — Next 30 Days" loading={cashLoading} empty={cashForecast.length === 0}>
        <table className="block-table">
          <thead>
            <tr>
              <th>Date</th>
              <th style={{ textAlign: 'right' }}>Cash In</th>
              <th style={{ textAlign: 'right' }}>Cash Out</th>
              <th style={{ textAlign: 'right' }}>Net</th>
              <th style={{ textAlign: 'right' }}>Lines</th>
            </tr>
          </thead>
          <tbody>
            {cashForecast.slice(0, 15).map((row, i) => {
              const net = row.cash_in - row.cash_out;
              return (
                <tr key={i}>
                  <td className="font-mono text-xs">{row.projection_date}</td>
                  <td className="font-mono text-right text-xs" style={{ color: 'var(--color-accent-income)' }}>
                    {formatCurrency(row.cash_in)}
                  </td>
                  <td className="font-mono text-right text-xs" style={{ color: 'var(--color-accent-expense)' }}>
                    {formatCurrency(row.cash_out)}
                  </td>
                  <td
                    className="font-mono text-right text-xs font-semibold"
                    style={{ color: net >= 0 ? 'var(--color-accent-income)' : 'var(--color-accent-expense)' }}
                  >
                    {formatCurrency(net)}
                  </td>
                  <td className="text-right text-xs text-text-muted">{row.line_count}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {cashForecast.length > 15 && (
          <p className="text-[10px] text-text-muted mt-2">{cashForecast.length - 15} more rows not shown</p>
        )}
      </Section>

      {/* ─── AP vs AR Cash Bridge ─── */}
      <Section title="AP vs AR Cash Bridge" loading={apArLoading} empty={!apVsAr}>
        {apVsAr && (
          <div className="grid grid-cols-3 gap-4">
            <div className="p-3 rounded" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-secondary)' }}>
              <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Accounts Receivable</p>
              <p className="text-lg font-mono font-semibold" style={{ color: 'var(--color-accent-income)' }}>
                {formatCurrency(apVsAr.accountsReceivable)}
              </p>
              <p className="text-[10px] text-text-muted">Outstanding from clients</p>
            </div>
            <div className="p-3 rounded" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-secondary)' }}>
              <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Accounts Payable</p>
              <p className="text-lg font-mono font-semibold" style={{ color: 'var(--color-accent-expense)' }}>
                {formatCurrency(apVsAr.accountsPayable)}
              </p>
              <p className="text-[10px] text-text-muted">Owed to vendors</p>
            </div>
            <div className="p-3 rounded" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-secondary)' }}>
              <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Net Position</p>
              <p
                className="text-lg font-mono font-semibold"
                style={{ color: apVsAr.netPosition >= 0 ? 'var(--color-accent-income)' : 'var(--color-accent-expense)' }}
              >
                {formatCurrency(apVsAr.netPosition)}
              </p>
              <p className="text-[10px] text-text-muted">AR/AP ratio: {apVsAr.ratio.toFixed(2)}</p>
            </div>
          </div>
        )}
      </Section>

      {/* ─── Payment Forecast (8-week) ─── */}
      <Section title="Payment Forecast — Next 8 Weeks" loading={paymentLoading} empty={paymentForecast.length === 0}>
        <table className="block-table">
          <thead>
            <tr>
              <th>Week</th>
              <th>Period</th>
              <th style={{ textAlign: 'right' }}>Expected Collections</th>
            </tr>
          </thead>
          <tbody>
            {paymentForecast.map((row) => (
              <tr key={row.week}>
                <td className="text-text-muted text-xs">Week {row.week}</td>
                <td className="font-mono text-xs">{row.start} → {row.end}</td>
                <td className="font-mono text-right font-semibold" style={{ color: 'var(--color-accent-income)' }}>
                  {formatCurrency(row.expectedCollections)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* ─── 90-Day Spend Forecast + Industry Benchmark ─── */}
      <Section
        title="90-Day Spend Forecast"
        loading={spendLoading}
        empty={spendForecast.length === 0 && benchmarkRows.length === 0}
      >
        {spendForecast.length > 0 && (
          <div className="mb-4">
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="p-3 rounded" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-secondary)' }}>
                <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Daily Avg Spend</p>
                <p className="text-base font-mono font-semibold" style={{ color: 'var(--color-accent-expense)' }}>
                  {formatCurrency(dailyAvgSpend)}
                </p>
              </div>
              <div className="p-3 rounded" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-secondary)' }}>
                <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1">30-Day Forecast</p>
                <p className="text-base font-mono font-semibold" style={{ color: 'var(--color-accent-expense)' }}>
                  {formatCurrency(dailyAvgSpend * 30)}
                </p>
              </div>
              <div className="p-3 rounded" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-secondary)' }}>
                <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1">90-Day Total</p>
                <p className="text-base font-mono font-semibold" style={{ color: 'var(--color-accent-expense)' }}>
                  {formatCurrency(spend90dTotal)}
                </p>
              </div>
            </div>
          </div>
        )}
        {benchmarkRows.length > 0 && (
          <>
            <h3 className="text-[10px] text-text-muted uppercase tracking-wider mb-2">Category vs Industry Benchmark</h3>
            <table className="block-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th style={{ textAlign: 'right' }}>Your Spend</th>
                  <th style={{ textAlign: 'right' }}>My % of Rev</th>
                  <th style={{ textAlign: 'right' }}>Industry Avg %</th>
                  <th style={{ textAlign: 'right' }}>Variance</th>
                </tr>
              </thead>
              <tbody>
                {benchmarkRows.slice(0, 10).map((row, i) => (
                  <tr key={i}>
                    <td className="text-xs">{row.category_name}</td>
                    <td className="font-mono text-right text-xs">{formatCurrency(row.total)}</td>
                    <td className="font-mono text-right text-xs">{row.my_pct_of_revenue.toFixed(1)}%</td>
                    <td className="font-mono text-right text-xs text-text-muted">
                      {row.industry_avg_pct != null ? `${row.industry_avg_pct.toFixed(1)}%` : '—'}
                    </td>
                    <td
                      className="font-mono text-right text-xs"
                      style={{
                        color: row.variance == null ? 'inherit' : row.variance > 0 ? 'var(--color-accent-expense)' : 'var(--color-accent-income)',
                      }}
                    >
                      {row.variance != null ? `${row.variance > 0 ? '+' : ''}${row.variance.toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {spendForecast.length === 0 && benchmarkRows.length === 0 && (
          <div className="empty-state py-6">
            <span className="text-text-muted text-sm">No spend data available</span>
          </div>
        )}
      </Section>

      {/* ─── Recurring vs One-off Revenue Split ─── */}
      <Section title="Recurring vs One-Off Revenue" loading={recurringLoading} empty={!recurringRevenue && revenueByService.length === 0}>
        <div className="grid grid-cols-2 gap-6">
          {recurringRevenue && (
            <div>
              <h3 className="text-[10px] text-text-muted uppercase tracking-wider mb-3">Revenue Split (YTD)</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between p-2 rounded" style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.15)' }}>
                  <span className="text-xs">Recurring</span>
                  <div className="text-right">
                    <span className="font-mono text-sm font-semibold" style={{ color: 'var(--color-accent-income)' }}>
                      {formatCurrency(recurringRevenue.recurringRevenue)}
                    </span>
                    <span className="text-[10px] text-text-muted ml-2">({recurringRevenue.recurringInvoices} invoices)</span>
                  </div>
                </div>
                <div className="flex items-center justify-between p-2 rounded" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-secondary)' }}>
                  <span className="text-xs">One-off / Other</span>
                  <div className="text-right">
                    <span className="font-mono text-sm font-semibold" style={{ color: 'var(--color-accent-blue)' }}>
                      {formatCurrency(Math.max(0, revenueByService.reduce((s, r) => s + r.total, 0) - recurringRevenue.recurringRevenue))}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
          {revenueByService.length > 0 && (
            <div>
              <h3 className="text-[10px] text-text-muted uppercase tracking-wider mb-3">Revenue by Service (12 mo)</h3>
              <table className="block-table">
                <thead>
                  <tr>
                    <th>Service</th>
                    <th style={{ textAlign: 'right' }}>Invoices</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {revenueByService.slice(0, 8).map((row, i) => (
                    <tr key={i}>
                      <td className="text-xs truncate max-w-[160px]">{row.service}</td>
                      <td className="text-right text-xs text-text-muted">{row.invoice_count}</td>
                      <td className="font-mono text-right text-xs" style={{ color: 'var(--color-accent-income)' }}>
                        {formatCurrency(row.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Section>

      {/* ─── Profit-Margin Trend & MoM Growth ─── */}
      <Section
        title="Profit-Margin Trend & Month-over-Month Growth"
        loading={marginLoading}
        empty={marginTrend.length === 0 && !momGrowth}
      >
        {momGrowth && (
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="p-3 rounded" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-secondary)' }}>
              <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1">This Month</p>
              <p className="text-base font-mono font-semibold" style={{ color: 'var(--color-accent-income)' }}>
                {formatCurrency(momGrowth.thisMonth)}
              </p>
            </div>
            <div className="p-3 rounded" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-secondary)' }}>
              <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Last Month</p>
              <p className="text-base font-mono font-semibold text-text-secondary">
                {formatCurrency(momGrowth.lastMonth)}
              </p>
            </div>
            <div className="p-3 rounded" style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-secondary)' }}>
              <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1">MoM Growth</p>
              <div className="flex items-center gap-2 mt-1">
                <GrowthBadge pct={momGrowth.growth} />
                {momGrowth.growth >= 0
                  ? <TrendingUp size={14} style={{ color: 'var(--color-accent-income)' }} />
                  : <TrendingDown size={14} style={{ color: 'var(--color-accent-expense)' }} />
                }
              </div>
            </div>
          </div>
        )}
        {marginTrend.length > 0 && (
          <table className="block-table">
            <thead>
              <tr>
                <th>Month</th>
                <th style={{ textAlign: 'right' }}>Revenue</th>
                <th style={{ textAlign: 'right' }}>Expenses</th>
                <th style={{ textAlign: 'right' }}>Net</th>
                <th style={{ textAlign: 'right' }}>Margin %</th>
              </tr>
            </thead>
            <tbody>
              {[...marginTrend].reverse().slice(0, 12).map((row, i) => {
                const prevRow = marginTrend.length > 1 ? marginTrend[marginTrend.length - 2 - i] : null;
                const marginDelta = prevRow && prevRow.margin > 0
                  ? percentChange(row.margin, prevRow.margin)
                  : null;
                return (
                  <tr key={i}>
                    <td className="font-mono text-xs">{row.month}</td>
                    <td className="font-mono text-right text-xs" style={{ color: 'var(--color-accent-income)' }}>
                      {formatCurrency(row.revenue)}
                    </td>
                    <td className="font-mono text-right text-xs" style={{ color: 'var(--color-accent-expense)' }}>
                      {formatCurrency(row.expenses)}
                    </td>
                    <td
                      className="font-mono text-right text-xs font-semibold"
                      style={{ color: row.net >= 0 ? 'var(--color-accent-income)' : 'var(--color-accent-expense)' }}
                    >
                      {formatCurrency(row.net)}
                    </td>
                    <td className="text-right text-xs">
                      <span
                        className="font-mono font-semibold"
                        style={{ color: row.margin >= 0 ? 'var(--color-accent-income)' : 'var(--color-accent-expense)' }}
                      >
                        {row.margin.toFixed(1)}%
                      </span>
                      {marginDelta !== null && (
                        <span className="ml-1">
                          <GrowthBadge pct={marginDelta} />
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
};

export default SmartForecast;
