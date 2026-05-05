// src/renderer/modules/reports/CashFlowForecast.tsx
//
// P4.35 — Forward-looking cash flow forecast.
//
// Renders the api.reportCashFlowForecast() output as a daily
// projection table with running balance + a "danger day" callout.
// No chart library — sparse-bar inline visualization keeps the
// bundle small.

import React, { useEffect, useState, useCallback } from 'react';
import { TrendingUp, AlertTriangle, ChevronLeft } from 'lucide-react';
import api from '../../lib/api';

interface DayProjection {
  date: string;
  inflow: number;
  outflow: number;
  net: number;
  balance: number;
  entries: Array<{ date: string; amount: number; reference: string; source: string; type: 'inflow' | 'outflow' }>;
}

interface ForecastResult {
  horizon: number;
  startDate: string;
  endDate: string;
  projection: DayProjection[];
  totals: { inflow: number; outflow: number; net: number; startingBalance: number; endingBalance: number };
  lowestBalance: { date: string; balance: number };
}

interface Props { onBack?: () => void }

const fmt$ = (n: number): string => {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return sign + '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const CashFlowForecast: React.FC<Props> = ({ onBack }) => {
  const [horizon, setHorizon] = useState(90);
  const [data, setData] = useState<ForecastResult | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.reportCashFlowForecast(horizon);
      setData(r);
    } finally { setLoading(false); }
  }, [horizon]);

  useEffect(() => { load(); }, [load]);

  // Compute max abs(net) for the inline bar visualization scale.
  const maxNet = data ? Math.max(...data.projection.map((p) => Math.abs(p.net)), 1) : 1;
  const dangerCrossed = data && data.lowestBalance.balance < 0;

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        {onBack && (
          <button onClick={onBack} className="block-btn flex items-center gap-1.5 text-xs">
            <ChevronLeft size={12} /> Back
          </button>
        )}
        <h2 style={{ fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
          <TrendingUp size={22} /> Cash Flow Forecast
        </h2>
        <select
          className="block-input"
          value={horizon}
          onChange={(e) => setHorizon(parseInt(e.target.value))}
          style={{ width: 130, marginLeft: 'auto' }}
        >
          <option value={30}>Next 30 days</option>
          <option value={60}>Next 60 days</option>
          <option value={90}>Next 90 days</option>
          <option value={180}>Next 6 months</option>
        </select>
      </div>

      {loading && <div style={{ padding: 24, color: 'var(--color-text-muted)' }}>Computing forecast…</div>}

      {data && !loading && (
        <>
          {/* Top stats */}
          <div className="block-card" style={{ padding: 16, marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
              <Stat label="Starting" value={fmt$(data.totals.startingBalance)} />
              <Stat label="Inflows" value={fmt$(data.totals.inflow)} color="#16a34a" />
              <Stat label="Outflows" value={fmt$(data.totals.outflow)} color="#dc2626" />
              <Stat label="Net" value={fmt$(data.totals.net)} color={data.totals.net >= 0 ? '#16a34a' : '#dc2626'} />
              <Stat label="Ending" value={fmt$(data.totals.endingBalance)} highlight />
            </div>
          </div>

          {/* Danger callout */}
          {dangerCrossed && (
            <div style={{
              padding: 12,
              border: '1px solid var(--color-warning, #d97706)',
              borderLeft: '3px solid var(--color-warning, #d97706)',
              background: 'rgba(217, 119, 6, 0.08)',
              borderRadius: 6,
              marginBottom: 12,
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
            }}>
              <AlertTriangle size={16} style={{ color: 'var(--color-warning, #d97706)', flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                  Projected cash shortfall on {data.lowestBalance.date}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  Lowest balance reaches {fmt$(data.lowestBalance.balance)} — review upcoming bills or accelerate AR collection.
                </div>
              </div>
            </div>
          )}

          {/* Projection table */}
          <div className="block-card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border-primary)' }}>
                  {['Date', 'Inflow', 'Outflow', 'Net', 'Balance', 'Activity'].map((h, i) => (
                    <th key={h} style={{ padding: '8px 10px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800, color: 'var(--color-text-muted)', textAlign: i >= 1 && i <= 4 ? 'right' : 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.projection.filter((p) => p.inflow > 0 || p.outflow > 0).map((p) => (
                  <tr key={p.date} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                    <td style={{ padding: '6px 10px', fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace' }}>{p.date}</td>
                    <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', color: p.inflow > 0 ? '#16a34a' : 'var(--color-text-muted)' }}>{p.inflow > 0 ? fmt$(p.inflow) : '—'}</td>
                    <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', color: p.outflow > 0 ? '#dc2626' : 'var(--color-text-muted)' }}>{p.outflow > 0 ? fmt$(p.outflow) : '—'}</td>
                    <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: 600, color: p.net >= 0 ? '#16a34a' : '#dc2626' }}>{fmt$(p.net)}</td>
                    <td style={{ padding: '6px 10px', fontSize: 12, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: 700, color: p.balance < 0 ? '#dc2626' : 'var(--color-text-primary)' }}>{fmt$(p.balance)}</td>
                    <td style={{ padding: '6px 10px', fontSize: 11, color: 'var(--color-text-muted)' }}>
                      <span title={p.entries.map((e) => e.reference + ' ' + (e.type === 'inflow' ? '+' : '-') + fmt$(e.amount)).join(' · ')}>
                        {p.entries.length} {p.entries.length === 1 ? 'item' : 'items'}
                      </span>
                    </td>
                  </tr>
                ))}
                {data.projection.filter((p) => p.inflow > 0 || p.outflow > 0).length === 0 && (
                  <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>
                    No inflows or outflows projected in the next {horizon} days.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 8, fontSize: 10, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
            Forecast is based on open invoices' due dates (inflows) and open bills' due dates (outflows). Recurring templates and scheduled payroll runs are not yet included.
          </div>
        </>
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; color?: string; highlight?: boolean }> = ({ label, value, color, highlight }) => (
  <div>
    <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', marginBottom: 4 }}>{label}</div>
    <div style={{
      fontSize: highlight ? 22 : 18,
      fontWeight: 800,
      fontFamily: 'SF Mono, Menlo, monospace',
      color: color || (highlight ? 'var(--color-positive)' : 'var(--color-text-primary)'),
    }}>{value}</div>
  </div>
);

export default CashFlowForecast;
