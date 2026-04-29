import React, { useEffect, useMemo, useState } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { TrendingUp, Target, DollarSign, Clock, Users, BarChart3 } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency } from '../../lib/format';

const COLORS = [
  '#3b82f6',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
  '#f97316',
  '#14b8a6',
];

interface QuoteRow {
  id: string;
  quote_number: string;
  status: string;
  issue_date: string;
  sent_date: string | null;
  won_date: string | null;
  total: number;
  probability: number | null;
  sales_rep_id: string | null;
  sales_rep_name?: string;
  lost_reason: string | null;
  deal_size_category: string | null;
  client_id: string | null;
  client_name?: string;
}

interface InvoiceLink {
  id: string;
  invoice_number: string;
  source_quote_id: string;
  created_at: string;
  total: number;
}

const ymKey = (d: string | null | undefined) => (d || '').slice(0, 7);
const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-');
  if (!y || !m) return ym;
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, {
    month: 'short',
    year: '2-digit',
  });
};

const daysBetween = (a: string | null | undefined, b: string | null | undefined) => {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return ms < 0 ? 0 : Math.round(ms / 86400000);
};

// ─── KPI Card ──────────────────────────────────────────
const KpiCard: React.FC<{
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
  accent?: string;
}> = ({ label, value, hint, icon, accent = '#3b82f6' }) => (
  <div className="block-card p-4" style={{ borderRadius: '6px' }}>
    <div className="flex items-start justify-between mb-2">
      <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
        {label}
      </span>
      {icon && <span style={{ color: accent }}>{icon}</span>}
    </div>
    <div className="text-xl font-bold text-text-primary font-mono">{value}</div>
    {hint && <div className="text-[11px] text-text-muted mt-1">{hint}</div>}
  </div>
);

// ─── Main Component ────────────────────────────────────
const QuoteAnalytics: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [quotes, setQuotes] = useState<QuoteRow[]>([]);
  const [convertedInvoices, setConvertedInvoices] = useState<InvoiceLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!activeCompany) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const [qRows, invRows] = await Promise.all([
          api.rawQuery(
            `SELECT q.id, q.quote_number, q.status, q.issue_date, q.sent_date, q.won_date,
                    q.total, q.probability, q.sales_rep_id,
                    q.lost_reason, q.deal_size_category, q.client_id,
                    u.name as sales_rep_name,
                    c.name as client_name
             FROM quotes q
             LEFT JOIN users u ON u.id = q.sales_rep_id
             LEFT JOIN clients c ON c.id = q.client_id
             WHERE q.company_id = ?`,
            [activeCompany.id]
          ),
          api.rawQuery(
            `SELECT i.id, i.invoice_number, i.source_quote_id, i.created_at, i.total
             FROM invoices i
             WHERE i.company_id = ? AND i.source_quote_id IS NOT NULL`,
            [activeCompany.id]
          ),
        ]);
        if (cancelled) return;
        setQuotes(Array.isArray(qRows) ? (qRows as QuoteRow[]) : []);
        setConvertedInvoices(Array.isArray(invRows) ? (invRows as InvoiceLink[]) : []);
      } catch (err: any) {
        if (!cancelled) {
          // Some installs may not have source_quote_id column — try fallback
          try {
            const qRows = await api.rawQuery(
              `SELECT q.id, q.quote_number, q.status, q.issue_date, q.sent_date, q.won_date,
                      q.total, q.probability, q.sales_rep_id,
                      q.lost_reason, q.deal_size_category, q.client_id,
                      u.name as sales_rep_name,
                      c.name as client_name
               FROM quotes q
               LEFT JOIN users u ON u.id = q.sales_rep_id
               LEFT JOIN clients c ON c.id = q.client_id
               WHERE q.company_id = ?`,
              [activeCompany.id]
            );
            if (!cancelled) {
              setQuotes(Array.isArray(qRows) ? (qRows as QuoteRow[]) : []);
              setConvertedInvoices([]);
            }
          } catch (err2: any) {
            if (!cancelled) setError(err2?.message || String(err2));
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCompany]);

  // ─── Win Rate Trend (last 12 months) ─────────────────
  const winRateTrend = useMemo(() => {
    const now = new Date();
    const months: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(d.toISOString().slice(0, 7));
    }
    const winsByMonth: Record<string, number> = {};
    const lossByMonth: Record<string, number> = {};
    months.forEach((m) => {
      winsByMonth[m] = 0;
      lossByMonth[m] = 0;
    });
    quotes.forEach((q) => {
      const ym = ymKey(q.won_date || q.issue_date);
      if (!(ym in winsByMonth)) return;
      if (q.status === 'converted' || q.status === 'accepted') winsByMonth[ym]++;
      else if (q.status === 'rejected') lossByMonth[ym]++;
    });
    return months.map((m) => {
      const wins = winsByMonth[m];
      const losses = lossByMonth[m];
      const closed = wins + losses;
      return {
        month: monthLabel(m),
        winRate: closed === 0 ? 0 : Math.round((wins / closed) * 100),
        wins,
        losses,
      };
    });
  }, [quotes]);

  // ─── Avg Sales Cycle (sent → converted) ──────────────
  const avgSalesCycle = useMemo(() => {
    const cycles = quotes
      .filter((q) => q.status === 'converted' && q.sent_date && q.won_date)
      .map((q) => daysBetween(q.sent_date, q.won_date))
      .filter((d): d is number => d !== null);
    if (cycles.length === 0) return { days: 0, count: 0 };
    const avg = cycles.reduce((s, d) => s + d, 0) / cycles.length;
    return { days: Math.round(avg), count: cycles.length };
  }, [quotes]);

  // ─── Quote → Invoice conversion histogram ────────────
  const conversionHistogram = useMemo(() => {
    const buckets = [
      { label: '0-3d', min: 0, max: 3, count: 0 },
      { label: '4-7d', min: 4, max: 7, count: 0 },
      { label: '8-14d', min: 8, max: 14, count: 0 },
      { label: '15-30d', min: 15, max: 30, count: 0 },
      { label: '31-60d', min: 31, max: 60, count: 0 },
      { label: '60+d', min: 61, max: Infinity, count: 0 },
    ];
    convertedInvoices.forEach((inv) => {
      const q = quotes.find((qq) => qq.id === inv.source_quote_id);
      if (!q || !q.sent_date || !inv.created_at) return;
      const days = daysBetween(q.sent_date, inv.created_at);
      if (days === null) return;
      for (const b of buckets) {
        if (days >= b.min && days <= b.max) {
          b.count++;
          break;
        }
      }
    });
    return buckets;
  }, [quotes, convertedInvoices]);

  // ─── Top Sales Reps Leaderboard ──────────────────────
  const repLeaderboard = useMemo(() => {
    const map: Record<
      string,
      {
        rep: string;
        won: number;
        lost: number;
        value: number;
        deals: number;
      }
    > = {};
    quotes.forEach((q) => {
      const rep = q.sales_rep_name || 'Unassigned';
      if (!map[rep]) map[rep] = { rep, won: 0, lost: 0, value: 0, deals: 0 };
      if (q.status === 'converted' || q.status === 'accepted') {
        map[rep].won++;
        map[rep].value += q.total || 0;
        map[rep].deals++;
      } else if (q.status === 'rejected') {
        map[rep].lost++;
      }
    });
    return Object.values(map)
      .map((r) => {
        const closed = r.won + r.lost;
        return {
          ...r,
          avgDeal: r.deals ? r.value / r.deals : 0,
          winRate: closed ? Math.round((r.won / closed) * 100) : 0,
        };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [quotes]);

  // ─── Lost Reason Pie ─────────────────────────────────
  const lostReasonData = useMemo(() => {
    const counts: Record<string, number> = {};
    quotes
      .filter((q) => q.status === 'rejected')
      .forEach((q) => {
        const r = (q.lost_reason || 'Unspecified').trim() || 'Unspecified';
        counts[r] = (counts[r] || 0) + 1;
      });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [quotes]);

  // ─── Pipeline Velocity (avg $ moving per stage per month) ──
  const pipelineVelocity = useMemo(() => {
    const stages = ['draft', 'sent', 'accepted', 'converted'];
    const totals: Record<string, { count: number; value: number }> = {};
    stages.forEach((s) => (totals[s] = { count: 0, value: 0 }));
    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth() - 5, 1)
      .toISOString()
      .slice(0, 10);
    quotes
      .filter((q) => (q.issue_date || '') >= cutoff)
      .forEach((q) => {
        if (totals[q.status]) {
          totals[q.status].count++;
          totals[q.status].value += q.total || 0;
        }
      });
    return stages.map((s) => ({
      stage: s.charAt(0).toUpperCase() + s.slice(1),
      avgValue: totals[s].count ? totals[s].value / totals[s].count : 0,
      count: totals[s].count,
      totalValue: totals[s].value,
    }));
  }, [quotes]);

  // ─── Forecast (weighted pipeline) ────────────────────
  const forecast = useMemo(() => {
    const open = quotes.filter((q) => q.status === 'draft' || q.status === 'sent');
    const weighted = open.reduce(
      (s, q) => s + ((q.total || 0) * (q.probability ?? 0)) / 100,
      0
    );
    const raw = open.reduce((s, q) => s + (q.total || 0), 0);
    return { weighted, raw, count: open.length };
  }, [quotes]);

  // ─── Status Distribution ─────────────────────────────
  const statusData = useMemo(() => {
    const counts: Record<string, number> = {};
    quotes.forEach((q) => {
      counts[q.status] = (counts[q.status] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [quotes]);

  // ─── Avg days to close by deal size ──────────────────
  const closeBySize = useMemo(() => {
    const sizes = ['small', 'medium', 'large', 'enterprise'];
    const buckets: Record<string, number[]> = {};
    sizes.forEach((s) => (buckets[s] = []));
    quotes
      .filter((q) => q.status === 'converted' && q.sent_date && q.won_date)
      .forEach((q) => {
        const size = (q.deal_size_category || 'medium').toLowerCase();
        const d = daysBetween(q.sent_date, q.won_date);
        if (d === null) return;
        if (!buckets[size]) buckets[size] = [];
        buckets[size].push(d);
      });
    return Object.entries(buckets)
      .filter(([, arr]) => arr.length > 0)
      .map(([size, arr]) => ({
        size: size.charAt(0).toUpperCase() + size.slice(1),
        avgDays: Math.round(arr.reduce((s, d) => s + d, 0) / arr.length),
        deals: arr.length,
      }));
  }, [quotes]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading analytics...
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          background: 'rgba(248,113,113,0.08)',
          border: '1px solid #ef4444',
          borderRadius: '6px',
          padding: '12px 16px',
          color: '#ef4444',
          fontSize: '13px',
        }}
      >
        {error}
      </div>
    );
  }

  if (quotes.length === 0) {
    return (
      <div className="block-card p-8 text-center text-text-muted">
        <BarChart3 size={32} className="mx-auto mb-3 opacity-50" />
        <p className="text-sm">No quote data yet to analyze.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top KPIs */}
      <div className="grid grid-cols-4 gap-3">
        <KpiCard
          label="Avg Sales Cycle"
          value={avgSalesCycle.days ? `${avgSalesCycle.days}d` : '—'}
          hint={`${avgSalesCycle.count} closed deal${avgSalesCycle.count === 1 ? '' : 's'}`}
          icon={<Clock size={14} />}
          accent="#3b82f6"
        />
        <KpiCard
          label="Forecast (Weighted)"
          value={formatCurrency(forecast.weighted)}
          hint={`Raw pipeline ${formatCurrency(forecast.raw)}`}
          icon={<Target size={14} />}
          accent="#22c55e"
        />
        <KpiCard
          label="Open Quotes"
          value={String(forecast.count)}
          hint="Draft + Sent"
          icon={<DollarSign size={14} />}
          accent="#f59e0b"
        />
        <KpiCard
          label="Lost Deals"
          value={String(quotes.filter((q) => q.status === 'rejected').length)}
          hint={`${lostReasonData.length} unique reason${lostReasonData.length === 1 ? '' : 's'}`}
          icon={<TrendingUp size={14} />}
          accent="#ef4444"
        />
      </div>

      {/* Win Rate Trend */}
      <div className="block-card p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-accent-blue uppercase tracking-wider">
            Win Rate Trend (Last 12 Months)
          </span>
        </div>
        <div style={{ width: '100%', height: 240 }}>
          <ResponsiveContainer>
            <LineChart data={winRateTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="month" stroke="#6b7280" fontSize={11} />
              <YAxis stroke="#6b7280" fontSize={11} domain={[0, 100]} />
              <Tooltip
                contentStyle={{
                  background: '#1a1b22',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '6px',
                  fontSize: '12px',
                }}
                formatter={(v: any, key: any) =>
                  key === 'winRate' ? `${v}%` : v
                }
              />
              <Legend wrapperStyle={{ fontSize: '11px' }} />
              <Line
                type="monotone"
                dataKey="winRate"
                name="Win %"
                stroke="#22c55e"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="wins"
                name="Wins"
                stroke="#3b82f6"
                strokeWidth={1}
                dot={{ r: 2 }}
              />
              <Line
                type="monotone"
                dataKey="losses"
                name="Losses"
                stroke="#ef4444"
                strokeWidth={1}
                dot={{ r: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Quote → Invoice Histogram */}
        <div className="block-card p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-accent-blue uppercase tracking-wider">
              Quote → Invoice Conversion Time
            </span>
          </div>
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={conversionHistogram}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="label" stroke="#6b7280" fontSize={11} />
                <YAxis stroke="#6b7280" fontSize={11} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: '#1a1b22',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '6px',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Lost Reason Pie */}
        <div className="block-card p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-accent-blue uppercase tracking-wider">
              Lost Deal Reasons
            </span>
          </div>
          {lostReasonData.length === 0 ? (
            <div className="text-xs text-text-muted py-12 text-center">
              No lost deals yet
            </div>
          ) : (
            <div style={{ width: '100%', height: 220 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={lostReasonData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={70}
                    label={(entry) => `${entry.name}: ${entry.value}`}
                    labelLine={false}
                  >
                    {lostReasonData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: '#1a1b22',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '6px',
                      fontSize: '12px',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Sales Rep Leaderboard */}
      <div className="block-card p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-accent-blue uppercase tracking-wider">
            Top Sales Reps
          </span>
          <Users size={14} className="text-text-muted" />
        </div>
        {repLeaderboard.length === 0 ? (
          <div className="text-xs text-text-muted py-4 text-center">No rep data</div>
        ) : (
          <table className="block-table">
            <thead>
              <tr>
                <th>Rep</th>
                <th className="text-right">Won</th>
                <th className="text-right">Lost</th>
                <th className="text-right">Win Rate</th>
                <th className="text-right">Avg Deal</th>
                <th className="text-right">Total Value</th>
              </tr>
            </thead>
            <tbody>
              {repLeaderboard.map((r) => (
                <tr key={r.rep}>
                  <td className="text-text-primary">{r.rep}</td>
                  <td className="text-right font-mono text-accent-income">{r.won}</td>
                  <td className="text-right font-mono text-accent-expense">{r.lost}</td>
                  <td className="text-right font-mono text-text-secondary">{r.winRate}%</td>
                  <td className="text-right font-mono text-text-secondary">
                    {formatCurrency(r.avgDeal)}
                  </td>
                  <td className="text-right font-mono text-text-primary font-semibold">
                    {formatCurrency(r.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Pipeline Velocity */}
        <div className="block-card p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-accent-blue uppercase tracking-wider">
              Pipeline Velocity (Avg $ per stage)
            </span>
          </div>
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={pipelineVelocity}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="stage" stroke="#6b7280" fontSize={11} />
                <YAxis
                  stroke="#6b7280"
                  fontSize={11}
                  tickFormatter={(v) => formatCurrency(v)}
                />
                <Tooltip
                  contentStyle={{
                    background: '#1a1b22',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '6px',
                    fontSize: '12px',
                  }}
                  formatter={(v: any) => formatCurrency(Number(v))}
                />
                <Bar dataKey="avgValue" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Status Distribution Pie */}
        <div className="block-card p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-accent-blue uppercase tracking-wider">
              Status Distribution
            </span>
          </div>
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={statusData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={70}
                  label={(e) => `${e.name}: ${e.value}`}
                  labelLine={false}
                >
                  {statusData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: '#1a1b22',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '6px',
                    fontSize: '12px',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Avg days to close by deal size */}
      <div className="block-card p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-accent-blue uppercase tracking-wider">
            Average Days to Close by Deal Size
          </span>
        </div>
        {closeBySize.length === 0 ? (
          <div className="text-xs text-text-muted py-4 text-center">
            Not enough closed deal data
          </div>
        ) : (
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={closeBySize}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="size" stroke="#6b7280" fontSize={11} />
                <YAxis stroke="#6b7280" fontSize={11} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: '#1a1b22',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: '6px',
                    fontSize: '12px',
                  }}
                  formatter={(v: any, key: any) =>
                    key === 'avgDays' ? `${v} days` : v
                  }
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Bar dataKey="avgDays" name="Avg days" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                <Bar dataKey="deals" name="Deals" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
};

export default QuoteAnalytics;
