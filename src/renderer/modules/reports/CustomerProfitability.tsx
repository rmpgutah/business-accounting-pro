// src/renderer/modules/reports/CustomerProfitability.tsx
//
// P4.37 — Customer profitability ranking.
//
// Renders api.reportCustomerProfitability() output as a sortable
// table. Surfaces revenue / direct expenses / profit / margin% /
// open AR balance per client, ranked by profit. Foundation for
// "fire your worst client" decisions.

import React, { useEffect, useState, useCallback } from 'react';
import { Trophy, ChevronLeft } from 'lucide-react';
import api from '../../lib/api';

interface Row {
  client_id: string;
  client_name: string;
  client_email: string | null;
  invoice_count: number;
  revenue: number;
  expenses: number;
  profit: number;
  margin_pct: number;
  unpaid: number;
}

interface Result {
  startDate: string;
  endDate: string;
  ranked: Row[];
  totals: { revenue: number; expenses: number; profit: number; unpaid: number; client_count: number };
}

const fmt$ = (n: number): string => {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return sign + '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

interface Props { onBack?: () => void }

const CustomerProfitability: React.FC<Props> = ({ onBack }) => {
  const yearStart = new Date().getFullYear() + '-01-01';
  const today = new Date().toISOString().slice(0, 10);

  const [startDate, setStartDate] = useState(yearStart);
  const [endDate, setEndDate] = useState(today);
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState<keyof Row>('profit');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.reportCustomerProfitability(startDate, endDate, 100);
      setData(r);
    } finally { setLoading(false); }
  }, [startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const sorted = data ? [...data.ranked].sort((a, b) => {
    const av = a[sortKey] as any, bv = b[sortKey] as any;
    if (typeof av === 'number') return bv - av;
    return String(av).localeCompare(String(bv));
  }) : [];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        {onBack && (
          <button onClick={onBack} className="block-btn flex items-center gap-1.5 text-xs">
            <ChevronLeft size={12} /> Back
          </button>
        )}
        <h2 style={{ fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Trophy size={22} /> Customer Profitability
        </h2>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', alignItems: 'center' }}>
          <input type="date" className="block-input" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ width: 140 }} />
          <span style={{ color: 'var(--color-text-muted)' }}>→</span>
          <input type="date" className="block-input" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ width: 140 }} />
        </div>
      </div>

      {loading && <div style={{ padding: 24, color: 'var(--color-text-muted)' }}>Computing…</div>}

      {data && !loading && (
        <>
          {/* Totals */}
          <div className="block-card" style={{ padding: 16, marginBottom: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
              <Stat label="Clients" value={String(data.totals.client_count)} />
              <Stat label="Revenue" value={fmt$(data.totals.revenue)} color="#16a34a" />
              <Stat label="Direct Expenses" value={fmt$(data.totals.expenses)} color="#dc2626" />
              <Stat label="Profit" value={fmt$(data.totals.profit)} highlight color={data.totals.profit >= 0 ? '#16a34a' : '#dc2626'} />
              <Stat label="Unpaid AR" value={fmt$(data.totals.unpaid)} color="#d97706" />
            </div>
          </div>

          {/* Sort hint */}
          <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 6 }}>
            Sorted by {sortKey} desc · click a column to re-sort
          </div>

          {/* Ranked table */}
          <div className="block-card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border-primary)' }}>
                  {[
                    { k: 'client_name', label: '#', width: 30 },
                    { k: 'client_name', label: 'Client', align: 'left' },
                    { k: 'invoice_count', label: 'Invoices', align: 'right' },
                    { k: 'revenue', label: 'Revenue', align: 'right' },
                    { k: 'expenses', label: 'Expenses', align: 'right' },
                    { k: 'profit', label: 'Profit', align: 'right' },
                    { k: 'margin_pct', label: 'Margin %', align: 'right' },
                    { k: 'unpaid', label: 'Unpaid', align: 'right' },
                  ].map((col, i) => (
                    <th
                      key={col.label + i}
                      onClick={() => i > 0 && setSortKey(col.k as keyof Row)}
                      style={{
                        padding: '8px 10px',
                        fontSize: 10,
                        textTransform: 'uppercase',
                        letterSpacing: 1,
                        fontWeight: 800,
                        color: sortKey === col.k ? 'var(--color-accent-blue)' : 'var(--color-text-muted)',
                        textAlign: col.align as any || 'left',
                        cursor: i > 0 ? 'pointer' : 'default',
                        width: col.width,
                      }}
                    >{col.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, idx) => (
                  <tr key={r.client_id} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                    <td style={{ padding: '6px 10px', fontSize: 10, color: 'var(--color-text-muted)', textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace' }}>{idx + 1}</td>
                    <td style={{ padding: '6px 10px', fontSize: 12, fontWeight: 600 }}>
                      <div>{r.client_name}</div>
                      {r.client_email && <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{r.client_email}</div>}
                    </td>
                    <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace' }}>{r.invoice_count}</td>
                    <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', color: '#16a34a' }}>{fmt$(r.revenue)}</td>
                    <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', color: r.expenses > 0 ? '#dc2626' : 'var(--color-text-muted)' }}>{r.expenses > 0 ? fmt$(r.expenses) : '—'}</td>
                    <td style={{ padding: '6px 10px', fontSize: 12, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: 700, color: r.profit >= 0 ? '#16a34a' : '#dc2626' }}>{fmt$(r.profit)}</td>
                    <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', color: r.margin_pct >= 30 ? '#16a34a' : r.margin_pct < 0 ? '#dc2626' : 'var(--color-text-muted)' }}>{r.margin_pct.toFixed(1)}%</td>
                    <td style={{ padding: '6px 10px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', color: r.unpaid > 0 ? '#d97706' : 'var(--color-text-muted)' }}>{r.unpaid > 0 ? fmt$(r.unpaid) : '—'}</td>
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr><td colSpan={8} style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>
                    No client activity in this period.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 8, fontSize: 10, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
            Profit = revenue (paid invoice amounts) − expenses tagged to this client. Indirect costs (overhead, salaries) are not allocated.
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
      color: color || 'var(--color-text-primary)',
    }}>{value}</div>
  </div>
);

export default CustomerProfitability;
