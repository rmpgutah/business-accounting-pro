import React, { useEffect, useState } from 'react';
import {
  DollarSign,
  Clock,
  TrendingUp,
  Users,
  BarChart3,
  Percent,
} from 'lucide-react';
import api from '../../lib/api';

// ─── Currency Formatter ─────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// ─── Types ──────────────────────────────────────────────
interface ClientRevenue {
  client_name: string;
  total_revenue: number;
}

interface MonthlyRevenue {
  month: string;
  total_revenue: number;
}

// ─── KPI Dashboard Component ────────────────────────────
const KPIDashboard: React.FC = () => {
  const [revenuePerHour, setRevenuePerHour] = useState(0);
  const [utilizationRate, setUtilizationRate] = useState(0);
  const [profitMargin, setProfitMargin] = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalExpenses, setTotalExpenses] = useState(0);
  const [topClients, setTopClients] = useState<ClientRevenue[]>([]);
  const [monthlyRevenue, setMonthlyRevenue] = useState<MonthlyRevenue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        // Revenue per billable hour
        const [revenueResult] = await api.rawQuery(
          `SELECT COALESCE(SUM(total), 0) as total_revenue FROM invoices WHERE status IN ('paid', 'sent')`
        );
        const [hoursResult] = await api.rawQuery(
          `SELECT COALESCE(SUM(duration_minutes), 0) as total_billable_minutes FROM time_entries WHERE is_billable = 1`
        );
        const [totalHoursResult] = await api.rawQuery(
          `SELECT COALESCE(SUM(duration_minutes), 0) as total_minutes FROM time_entries`
        );
        const [expenseResult] = await api.rawQuery(
          `SELECT COALESCE(SUM(amount), 0) as total_expenses FROM expenses`
        );

        // Top 5 clients by revenue
        const clientResults = await api.rawQuery(
          `SELECT c.name as client_name, COALESCE(SUM(i.total), 0) as total_revenue
           FROM invoices i
           JOIN clients c ON i.client_id = c.id
           WHERE i.status IN ('paid', 'sent')
           GROUP BY c.id, c.name
           ORDER BY total_revenue DESC
           LIMIT 5`
        );

        // Monthly revenue trend (last 6 months)
        const monthlyResults = await api.rawQuery(
          `SELECT strftime('%Y-%m', issue_date) as month,
                  COALESCE(SUM(total), 0) as total_revenue
           FROM invoices
           WHERE status IN ('paid', 'sent')
             AND issue_date >= date('now', '-6 months')
           GROUP BY month
           ORDER BY month ASC`
        );

        if (cancelled) return;

        const revenue = revenueResult?.total_revenue ?? 0;
        const billableMinutes = hoursResult?.total_billable_minutes ?? 0;
        const totalMinutes = totalHoursResult?.total_minutes ?? 0;
        const expenses = expenseResult?.total_expenses ?? 0;

        const billableHours = billableMinutes / 60;
        const totalHours = totalMinutes / 60;

        setTotalRevenue(revenue);
        setTotalExpenses(expenses);
        setRevenuePerHour(billableHours > 0 ? revenue / billableHours : 0);
        setUtilizationRate(totalHours > 0 ? (billableMinutes / totalMinutes) * 100 : 0);
        setProfitMargin(revenue > 0 ? ((revenue - expenses) / revenue) * 100 : 0);
        setTopClients(clientResults ?? []);
        setMonthlyRevenue(monthlyResults ?? []);
      } catch (err) {
        console.error('KPI data load failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, []);

  const utilizationColor =
    utilizationRate >= 75
      ? 'var(--color-accent-income)'
      : utilizationRate >= 50
        ? 'var(--color-accent-warning)'
        : 'var(--color-accent-expense)';

  const maxClientRevenue = topClients.length > 0
    ? Math.max(...topClients.map((c) => c.total_revenue))
    : 1;

  const maxMonthlyRevenue = monthlyRevenue.length > 0
    ? Math.max(...monthlyRevenue.map((m) => m.total_revenue))
    : 1;

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

      {/* Stat Cards — 3-column grid */}
      <div className="grid grid-cols-3 gap-4">
        {/* Revenue per Billable Hour */}
        <div className="stat-card border-l-2 border-l-accent-income">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign size={14} className="text-accent-income" />
            <span className="stat-label">Revenue per Billable Hour</span>
          </div>
          <p className="stat-value text-accent-income">{fmt.format(revenuePerHour)}</p>
          <span className="text-xs text-text-muted">
            {fmt.format(totalRevenue)} total revenue
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
          {/* Progress bar */}
          <div
            style={{
              width: '100%',
              height: '6px',
              backgroundColor: 'var(--color-bg-tertiary)',
              borderRadius: '2px',
              marginTop: '0.5rem',
            }}
          >
            <div
              style={{
                width: `${Math.min(utilizationRate, 100)}%`,
                height: '100%',
                backgroundColor: utilizationColor,
                borderRadius: '2px',
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
            borderLeftColor: profitMargin >= 0
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
              color: profitMargin >= 0
                ? 'var(--color-accent-blue)'
                : 'var(--color-accent-expense)',
            }}
          >
            {profitMargin.toFixed(1)}%
          </p>
          <span className="text-xs text-text-muted">
            {fmt.format(totalRevenue - totalExpenses)} net profit
          </span>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-2 gap-4">
        {/* Top 5 Clients by Revenue */}
        <div className="block-card p-5">
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
                    <span className="text-sm text-text-primary truncate" style={{ maxWidth: '60%' }}>
                      {client.client_name}
                    </span>
                    <span className="text-sm font-mono text-text-secondary">
                      {fmt.format(client.total_revenue)}
                    </span>
                  </div>
                  <div
                    style={{
                      width: '100%',
                      height: '8px',
                      backgroundColor: 'var(--color-bg-tertiary)',
                      borderRadius: '2px',
                    }}
                  >
                    <div
                      style={{
                        width: `${(client.total_revenue / maxClientRevenue) * 100}%`,
                        height: '100%',
                        backgroundColor: 'var(--color-accent-purple)',
                        borderRadius: '2px',
                        transition: 'width 0.4s ease',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Monthly Revenue Trend */}
        <div className="block-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={14} className="text-accent-income" />
            <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              Monthly Revenue Trend (Last 6 Months)
            </h2>
          </div>
          {monthlyRevenue.length === 0 ? (
            <div className="empty-state py-8">
              <span className="text-text-muted text-sm">No monthly revenue data yet</span>
            </div>
          ) : (
            <div className="flex items-end gap-2" style={{ height: '180px' }}>
              {monthlyRevenue.map((month, i) => {
                const barHeight = maxMonthlyRevenue > 0
                  ? (month.total_revenue / maxMonthlyRevenue) * 160
                  : 0;
                return (
                  <div
                    key={i}
                    className="flex flex-col items-center flex-1"
                    style={{ height: '100%', justifyContent: 'flex-end' }}
                  >
                    <span className="text-xs font-mono text-text-secondary mb-1">
                      {fmt.format(month.total_revenue)}
                    </span>
                    <div
                      style={{
                        width: '100%',
                        height: `${Math.max(barHeight, 4)}px`,
                        backgroundColor: 'var(--color-accent-income)',
                        borderRadius: '2px',
                        transition: 'height 0.4s ease',
                      }}
                    />
                    <span className="text-[10px] text-text-muted mt-1">
                      {month.month}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default KPIDashboard;
