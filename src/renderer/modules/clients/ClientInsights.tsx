import React, { useEffect, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { DollarSign, AlertTriangle, Clock, FolderKanban } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/format';

// ─── Types ──────────────────────────────────────────────
interface ClientInsightsProps {
  clientId: string;
}

interface InsightsData {
  total_invoiced: number;
  total_paid: number;
  outstanding: number;
  avg_payment_days: number;
  status_breakdown: Array<{ status: string; count: number }>;
  payment_history: Array<{ month: string; total: number }>;
  active_projects: number;
  lifetime_value: number;
}

// ─── Status Badge Colors ────────────────────────────────
const STATUS_BADGE: Record<string, string> = {
  paid: 'block-badge block-badge-income',
  sent: 'block-badge block-badge-warning',
  draft: 'block-badge block-badge-blue',
  overdue: 'block-badge block-badge-expense',
  partial: 'block-badge block-badge-purple',
  void: 'block-badge',
  cancelled: 'block-badge',
};

// ─── Custom Tooltip ─────────────────────────────────────
const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: 'rgba(15, 15, 20, 0.92)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '6px',
        padding: '8px 12px',
      }}
    >
      <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, margin: 0 }}>{label}</p>
      <p style={{ color: '#34d399', fontSize: 13, fontFamily: 'monospace', fontWeight: 700, margin: '2px 0 0' }}>
        {formatCurrency(payload[0].value)}
      </p>
    </div>
  );
};

// ─── Component ──────────────────────────────────────────
const ClientInsights: React.FC<ClientInsightsProps> = ({ clientId }) => {
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const result = await api.clientInsights(clientId);
        if (!cancelled) setData(result);
      } catch (err) {
        console.error('Failed to load client insights:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [clientId]);

  if (loading) {
    return (
      <div className="py-8 text-center text-sm text-text-muted font-mono">
        Loading insights...
      </div>
    );
  }

  if (!data) return null;

  // Reverse payment history for chronological chart order
  const chartData = [...(data.payment_history || [])].reverse().map((entry) => ({
    month: entry.month,
    total: entry.total,
  }));

  return (
    <div className="space-y-4">
      {/* Section Heading */}
      <h3
        className="text-xs font-bold text-text-muted uppercase tracking-wider"
        style={{ letterSpacing: '0.08em' }}
      >
        Client Insights
      </h3>

      {/* Stat Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="stat-card border-l-2 border-l-accent-income" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-1.5 mb-1">
            <DollarSign size={12} className="text-text-muted" />
            <span className="stat-label">Lifetime Value</span>
          </div>
          <span className="stat-value text-accent-income">{formatCurrency(data.lifetime_value)}</span>
        </div>

        <div className="stat-card border-l-2 border-l-accent-warning" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle size={12} className="text-text-muted" />
            <span className="stat-label">Outstanding</span>
          </div>
          <span className="stat-value text-accent-warning">{formatCurrency(data.outstanding)}</span>
        </div>

        <div className="stat-card border-l-2 border-l-accent-blue" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-1.5 mb-1">
            <Clock size={12} className="text-text-muted" />
            <span className="stat-label">Avg Payment Days</span>
          </div>
          <span className="stat-value text-text-primary">
            {data.avg_payment_days > 0 ? `${data.avg_payment_days}d` : '--'}
          </span>
        </div>

        <div className="stat-card border-l-2 border-l-accent-purple" style={{ borderRadius: '6px' }}>
          <div className="flex items-center gap-1.5 mb-1">
            <FolderKanban size={12} className="text-text-muted" />
            <span className="stat-label">Active Projects</span>
          </div>
          <span className="stat-value text-text-primary">{data.active_projects}</span>
        </div>
      </div>

      {/* Payment History Chart + Status Breakdown */}
      <div className="grid grid-cols-3 gap-4">
        {/* Chart */}
        <div
          className="col-span-2 block-card"
          style={{
            borderRadius: '6px',
            background: 'rgba(255,255,255,0.02)',
          }}
        >
          <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3">
            Payment History (Last 12 Months)
          </h4>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <XAxis
                  dataKey="month"
                  tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10, fontFamily: 'monospace' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                  width={48}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <Bar
                  dataKey="total"
                  fill="rgba(52, 211, 153, 0.7)"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={32}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[180px] text-xs text-text-muted font-mono">
              No payment data available
            </div>
          )}
        </div>

        {/* Status Breakdown */}
        <div
          className="block-card"
          style={{
            borderRadius: '6px',
            background: 'rgba(255,255,255,0.02)',
          }}
        >
          <h4 className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3">
            Invoice Status
          </h4>
          {data.status_breakdown && data.status_breakdown.length > 0 ? (
            <div className="space-y-2">
              {data.status_breakdown.map((entry) => (
                <div key={entry.status} className="flex items-center justify-between">
                  <span className={`${STATUS_BADGE[entry.status] ?? 'block-badge'} capitalize`}>
                    {entry.status}
                  </span>
                  <span className="text-xs font-mono text-text-secondary font-bold">
                    {entry.count}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-24 text-xs text-text-muted font-mono">
              No invoices yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClientInsights;
