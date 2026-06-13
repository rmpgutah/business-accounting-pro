import React from 'react';
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { CHART_INCOME, CHART_NEUTRAL } from '../../../lib/chart-palette';
import { formatCurrency } from '../../../lib/format';

const Empty = () => <div className="h-full flex items-center justify-center text-xs text-text-muted">No data</div>;

const WidgetBody: React.FC<{ type: string; data: any; loading: boolean }> = ({ type, data, loading }) => {
  if (loading) return <div className="h-full flex items-center justify-center text-xs text-text-muted">Loading…</div>;

  if (type === 'kpis') {
    const s = data || {};
    const tiles = [
      { label: 'Revenue', value: s.revenue, cls: 'text-accent-income' },
      { label: 'Expenses', value: s.expenses, cls: 'text-accent-expense' },
      { label: 'Net', value: (s.revenue || 0) - (s.expenses || 0), cls: 'text-text-primary' },
      { label: 'Outstanding', value: s.outstanding ?? s.outstandingInvoices, cls: 'text-accent-warning' },
    ];
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 h-full">
        {tiles.map(t => (
          <div key={t.label} className="flex flex-col justify-center">
            <div className="text-[10px] text-text-muted uppercase tracking-wider">{t.label}</div>
            <div className={`text-lg font-mono font-bold ${t.cls}`}>{formatCurrency(t.value || 0)}</div>
          </div>
        ))}
      </div>
    );
  }

  if (type === 'cash-forecast') {
    const rows = Array.isArray(data) ? data : (data?.points || data?.series || []);
    if (!rows.length) return <Empty />;
    const chartData = rows.map((r: any) => ({ label: r.date || r.label || '', value: r.predicted ?? r.value ?? r.amount ?? 0 }));
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData}>
          <defs><linearGradient id="cf" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={CHART_INCOME} stopOpacity={0.7} /><stop offset="95%" stopColor={CHART_INCOME} stopOpacity={0} /></linearGradient></defs>
          <XAxis dataKey="label" stroke={CHART_NEUTRAL} tick={{ fontSize: 9 }} hide />
          <YAxis stroke={CHART_NEUTRAL} tick={{ fontSize: 9 }} width={36} />
          <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
          <Area type="monotone" dataKey="value" stroke={CHART_INCOME} fill="url(#cf)" />
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  if (type === 'anomalies') {
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) return <div className="h-full flex items-center justify-center text-xs text-accent-income">No anomalies</div>;
    return (
      <ul className="space-y-1.5">
        {rows.slice(0, 6).map((a: any, i: number) => (
          <li key={i} className="text-xs text-text-secondary flex items-start gap-1.5">
            <span className="text-accent-warning mt-0.5">•</span>
            <span className="truncate">{a.description || a.message || a.title || 'Anomaly'}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (type === 'ar-aging' || type === 'ap-aging') {
    const buckets = data?.buckets || data?.rows || (Array.isArray(data) ? data : []);
    if (!buckets.length) return <Empty />;
    const max = Math.max(...buckets.map((b: any) => Math.abs(b.amount ?? b.total ?? 0)), 1);
    return (
      <div className="space-y-2">
        {buckets.map((b: any, i: number) => {
          const amt = b.amount ?? b.total ?? 0;
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[10px] text-text-muted w-16 truncate">{b.label || b.bucket || b.range}</span>
              <div className="flex-1 h-3" style={{ background: 'var(--color-bg-tertiary)', borderRadius: 'var(--app-radius)' }}>
                <div style={{ width: `${Math.max((Math.abs(amt) / max) * 100, 2)}%`, height: '100%', background: type === 'ar-aging' ? CHART_INCOME : 'var(--color-accent-expense)', borderRadius: 'var(--app-radius)' }} />
              </div>
              <span className="text-[10px] font-mono text-text-secondary w-20 text-right">{formatCurrency(amt)}</span>
            </div>
          );
        })}
      </div>
    );
  }

  if (type === 'top-clients') {
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) return <Empty />;
    const max = Math.max(...rows.map((r: any) => r.total || 0), 1);
    return (
      <div className="space-y-2">
        {rows.map((r: any, i: number) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-text-secondary w-24 truncate">{r.name || '—'}</span>
            <div className="flex-1 h-3" style={{ background: 'var(--color-bg-tertiary)', borderRadius: 'var(--app-radius)' }}>
              <div style={{ width: `${Math.max(((r.total || 0) / max) * 100, 2)}%`, height: '100%', background: CHART_INCOME, borderRadius: 'var(--app-radius)' }} />
            </div>
            <span className="text-[10px] font-mono text-text-secondary w-20 text-right">{formatCurrency(r.total || 0)}</span>
          </div>
        ))}
      </div>
    );
  }

  return <Empty />;
};

export default WidgetBody;
