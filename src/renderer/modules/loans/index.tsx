// src/renderer/modules/loans/index.tsx
//
// Loan tracking module — top-level router between list, form, detail.
// Aggregate stats banner shows total debt + monthly burn across all
// active loans on the list view.

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Landmark, TrendingDown, ChevronRight, Wallet } from 'lucide-react';
import api from '../../lib/api';
import { useToast } from '../../components/ToastProvider';
import LoanForm from './LoanForm';
import LoanDetail from './LoanDetail';

type View = 'list' | 'form' | 'detail';

const fmt$ = (n: number, currency: string = 'USD'): string => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0);
  } catch { return '$' + Math.round(n || 0).toLocaleString(); }
};

const LoansModule: React.FC = () => {
  const toast = useToast();
  const [view, setView] = useState<View>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loans, setLoans] = useState<any[]>([]);
  const [aggregate, setAggregate] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.loansList();
      if (Array.isArray(list)) setLoans(list);
      const agg = await api.loansAggregate();
      if (agg && !('error' in agg)) setAggregate(agg);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (view === 'list') load(); }, [view, load]);

  if (view === 'form') {
    return (
      <LoanForm
        loanId={selectedId}
        onSaved={(id) => { setSelectedId(id); setView('detail'); }}
        onCancel={() => setView('list')}
      />
    );
  }

  if (view === 'detail' && selectedId) {
    return (
      <LoanDetail
        loanId={selectedId}
        onBack={() => setView('list')}
        onEdit={() => setView('form')}
        onDeleted={() => { setView('list'); load(); }}
      />
    );
  }

  // List view
  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Landmark size={22} /> Loans & Debt
        </h2>
        <button
          className="block-btn-primary flex items-center gap-2"
          onClick={() => { setSelectedId(null); setView('form'); }}
        >
          <Plus size={14} /> New Loan
        </button>
      </div>

      {/* Aggregate stats */}
      {aggregate?.stats && (
        <div className="block-card" style={{ padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', marginBottom: 12 }}>
            Total Debt Position
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
            <Stat label="Active Loans" value={String(aggregate.stats.loan_count || 0)} />
            <Stat label="Total Outstanding" value={fmt$(aggregate.stats.total_outstanding || 0)} highlight color="#dc2626" />
            <Stat label="Total Paid" value={fmt$(aggregate.stats.total_paid || 0)} color="#16a34a" />
            <Stat label="Interest Paid" value={fmt$(aggregate.stats.total_interest_paid || 0)} color="#d97706" />
            <Stat label="Monthly Burn" value={fmt$(aggregate.stats.total_monthly_payment || 0)} />
          </div>
          {aggregate.upcoming?.length > 0 && (
            <div style={{ marginTop: 14, padding: 10, background: 'var(--color-bg-secondary)', borderRadius: 6, borderLeft: '3px solid var(--color-warning, #d97706)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Wallet size={12} /> Next 30 days · {aggregate.upcoming.length} payment{aggregate.upcoming.length === 1 ? '' : 's'} · total {fmt$(aggregate.upcoming.reduce((s: number, p: any) => s + Number(p.scheduled_payment), 0))}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {aggregate.upcoming.slice(0, 6).map((p: any, i: number) => (
                  <div key={i} style={{ fontSize: 10, padding: '3px 8px', background: 'var(--color-bg-primary)', borderRadius: 3, fontFamily: 'SF Mono, Menlo, monospace' }}>
                    {p.due_date} · {p.loan_name} · {fmt$(p.scheduled_payment)}
                  </div>
                ))}
                {aggregate.upcoming.length > 6 && (
                  <div style={{ fontSize: 10, color: 'var(--color-text-muted)', padding: '3px 8px' }}>
                    +{aggregate.upcoming.length - 6} more
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Loans list */}
      {loading && <div style={{ padding: 24, color: 'var(--color-text-muted)' }}>Loading…</div>}
      {!loading && loans.length === 0 && (
        <div className="block-card" style={{ padding: 32, textAlign: 'center' }}>
          <Landmark size={32} style={{ margin: '0 auto 8px', opacity: 0.5, color: 'var(--color-text-muted)' }} />
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>No loans yet</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 12 }}>
            Track mortgages, business loans, equipment financing, and lines of credit. Auto-generates amortization schedules and projects cash flow impact.
          </div>
          <button onClick={() => { setSelectedId(null); setView('form'); }} className="block-btn-primary">
            <Plus size={14} style={{ marginRight: 6 }} /> Add Your First Loan
          </button>
        </div>
      )}

      {!loading && loans.length > 0 && (
        <div className="block-card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border-primary)' }}>
                {['Name', 'Type', 'Principal', 'Balance', 'Rate', 'Payment', 'Next Due', 'Progress', ''].map((h, i) => (
                  <th key={h} style={{ padding: '10px 12px', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800, color: 'var(--color-text-muted)', textAlign: i >= 2 && i <= 5 ? 'right' : 'left' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loans.map((l: any) => {
                const pct = l.principal > 0 ? ((l.principal - l.current_balance) / l.principal) * 100 : 0;
                return (
                  <tr key={l.id} onClick={() => { setSelectedId(l.id); setView('detail'); }}
                    style={{ borderBottom: '1px solid var(--color-border-primary)', cursor: 'pointer' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg-secondary)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600 }}>
                      {l.name}
                      {l.lender_name && <div style={{ fontSize: 10, color: 'var(--color-text-muted)', fontWeight: 400 }}>{l.lender_name}</div>}
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 11, color: 'var(--color-text-muted)' }}>{l.loan_type.replace(/_/g, ' ')}</td>
                    <td style={{ padding: '8px 12px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace' }}>{fmt$(l.principal, l.currency)}</td>
                    <td style={{ padding: '8px 12px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: 700, color: '#dc2626' }}>{fmt$(l.current_balance, l.currency)}</td>
                    <td style={{ padding: '8px 12px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace' }}>{(l.interest_rate * 100).toFixed(3)}%</td>
                    <td style={{ padding: '8px 12px', fontSize: 11, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace' }}>{fmt$(l.payment_amount, l.currency)}</td>
                    <td style={{ padding: '8px 12px', fontSize: 11, fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-text-muted)' }}>{l.next_payment_due || '—'}</td>
                    <td style={{ padding: '8px 12px', minWidth: 100 }}>
                      <div style={{ height: 4, background: 'var(--color-bg-secondary)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: pct + '%', height: '100%', background: '#16a34a', transition: 'width 200ms' }} />
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--color-text-muted)', textAlign: 'right', marginTop: 2, fontFamily: 'SF Mono, Menlo, monospace' }}>{pct.toFixed(1)}%</div>
                    </td>
                    <td style={{ padding: '8px 12px', color: 'var(--color-text-muted)' }}><ChevronRight size={14} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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

export default LoansModule;
