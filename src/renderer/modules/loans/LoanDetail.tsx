// src/renderer/modules/loans/LoanDetail.tsx
//
// Per-loan dashboard. Sections:
//   • Stats overview (4-up: balance, total paid, % paid down, next due)
//   • Amortization chart (SVG, principal/interest/balance overlay)
//   • Payoff scenario calculator (live recompute on slider)
//   • Schedule table (paginated; shows next 12 unpaid + last 6 paid)
//   • Payment history list

import React, { useEffect, useState, useCallback } from 'react';
import { ChevronLeft, Edit, DollarSign, TrendingDown, Trash2, Plus } from 'lucide-react';
import api from '../../lib/api';
import { useToast } from '../../components/ToastProvider';
import AmortizationChart from './AmortizationChart';

interface Props {
  loanId: string;
  onBack: () => void;
  onEdit: () => void;
  onDeleted: () => void;
}

const fmt$ = (n: number, currency: string = 'USD'): string => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0);
  } catch {
    return '$' + (n || 0).toFixed(2);
  }
};

const LoanDetail: React.FC<Props> = ({ loanId, onBack, onEdit, onDeleted }) => {
  const toast = useToast();
  const [data, setData] = useState<{ loan: any; schedule: any[]; payments: any[]; events: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPayment, setShowPayment] = useState(false);
  const [extraPerPayment, setExtraPerPayment] = useState(0);
  const [scenario, setScenario] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.loanGet(loanId);
      if (r.error) { toast.error(r.error); return; }
      setData(r as any);
    } finally { setLoading(false); }
  }, [loanId, toast]);

  useEffect(() => { load(); }, [load]);

  // Recompute payoff scenario whenever extraPerPayment changes (debounced via blur)
  const computeScenario = useCallback(async () => {
    if (!data || extraPerPayment <= 0) { setScenario(null); return; }
    const r = await api.loanPayoffScenario(loanId, extraPerPayment);
    if (!r.error) setScenario(r);
  }, [data, extraPerPayment, loanId]);

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;
  if (!data) return <div style={{ padding: 24, color: 'var(--color-text-muted)' }}>Loan not found</div>;

  const { loan, schedule, payments } = data;
  const cur = loan.currency || 'USD';
  const pctPaid = loan.principal > 0 ? ((loan.principal - loan.current_balance) / loan.principal) * 100 : 0;
  const totalScheduledInterest = schedule.reduce((s: number, r: any) => s + (Number(r.interest_amount) || 0), 0);
  const remainingPayments = schedule.filter((r: any) => r.paid_status !== 'paid').length;

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <button onClick={onBack} className="block-btn flex items-center gap-1.5 text-xs">
          <ChevronLeft size={12} /> Back
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)' }}>{loan.name}</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
            {loan.loan_type.replace(/_/g, ' ')} · {loan.lender_name || 'Lender unknown'} · {(loan.interest_rate * 100).toFixed(3)}% {loan.rate_type}
            {loan.account_number ? ' · ••••' + loan.account_number.slice(-4) : ''}
          </div>
        </div>
        <button onClick={() => setShowPayment(true)} className="block-btn-primary flex items-center gap-2">
          <DollarSign size={14} /> Record Payment
        </button>
        <button onClick={onEdit} className="block-btn flex items-center gap-1.5 text-xs">
          <Edit size={12} /> Edit
        </button>
        <button
          onClick={async () => {
            if (!confirm('Delete this loan? Payment history will be retained for 30 days in Trash.')) return;
            const r = await api.loanDelete(loanId);
            if (r?.error) toast.error(r.error);
            else { toast.success('Loan deleted'); onDeleted(); }
          }}
          className="block-btn flex items-center gap-1.5 text-xs"
          style={{ color: 'var(--color-accent-expense)', borderColor: 'var(--color-accent-expense)' }}
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Stats overview */}
      <div className="block-card" style={{ padding: 16, marginBottom: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
          <Stat label="Original Principal" value={fmt$(loan.principal, cur)} />
          <Stat label="Current Balance" value={fmt$(loan.current_balance, cur)} highlight color="#dc2626" />
          <Stat label="Total Paid" value={fmt$(loan.total_paid_to_date, cur)} color="#16a34a" />
          <Stat label="Interest Paid" value={fmt$(loan.total_interest_paid, cur)} color="#d97706" />
          <Stat label={`Next Due${loan.next_payment_due ? ' · ' + loan.next_payment_due : ''}`}
            value={fmt$(loan.payment_amount, cur)} />
        </div>
        {/* Progress bar */}
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 4 }}>
            <span>{pctPaid.toFixed(1)}% paid down · {remainingPayments} payments remaining</span>
            <span>Total scheduled interest: {fmt$(totalScheduledInterest, cur)}</span>
          </div>
          <div style={{ height: 8, background: 'var(--color-bg-secondary)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              width: pctPaid + '%',
              height: '100%',
              background: 'linear-gradient(90deg, #16a34a, #22c55e)',
              transition: 'width 200ms ease',
            }} />
          </div>
        </div>
      </div>

      {/* Amortization chart */}
      <div className="block-card" style={{ padding: 16, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <SectionLabel>Amortization Curve</SectionLabel>
          <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
            Per-payment view · principal grows / interest shrinks
          </span>
        </div>
        <AmortizationChart schedule={schedule} height={240} />
      </div>

      {/* Payoff scenario calculator */}
      <div className="block-card" style={{ padding: 16, marginBottom: 12 }}>
        <SectionLabel>Payoff Calculator</SectionLabel>
        <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 12 }}>
          Add extra principal each payment — see how much interest you save and how much sooner you pay off.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', minWidth: 100 }}>Extra per payment:</span>
            <input
              type="number"
              step="50"
              min="0"
              className="block-input"
              value={extraPerPayment || ''}
              onChange={(e) => setExtraPerPayment(parseFloat(e.target.value) || 0)}
              onBlur={computeScenario}
              style={{ flex: 1 }}
              placeholder="0"
            />
          </label>
          <button onClick={computeScenario} className="block-btn-primary flex items-center gap-2 text-xs">
            <TrendingDown size={12} /> Compute
          </button>
        </div>
        {scenario && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 12,
            padding: 12,
            background: 'rgba(22, 163, 74, 0.06)',
            border: '1px solid rgba(22, 163, 74, 0.2)',
            borderRadius: 6,
          }}>
            <Stat label="Interest Saved" value={fmt$(scenario.interest_saved, cur)} color="#16a34a" highlight />
            <Stat label="Months Saved" value={String(scenario.months_saved)} color="#16a34a" highlight />
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
              Baseline payoff: <span style={{ fontFamily: 'SF Mono, Menlo, monospace' }}>{scenario.baseline_payoff_date}</span>
              <br />Total interest: <span style={{ fontFamily: 'SF Mono, Menlo, monospace' }}>{fmt$(scenario.baseline_total_interest, cur)}</span>
            </div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
              With extra payment: <span style={{ fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-positive)' }}>{scenario.scenario_payoff_date}</span>
              <br />Total interest: <span style={{ fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-positive)' }}>{fmt$(scenario.scenario_total_interest, cur)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Schedule + Payments side-by-side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="block-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border-primary)', background: 'var(--color-bg-secondary)' }}>
            <SectionLabel>Upcoming Schedule (next 12)</SectionLabel>
          </div>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--color-border-primary)', background: 'var(--color-bg-secondary)' }}>
                  {['#', 'Due', 'Payment', 'Principal', 'Interest', 'Balance'].map((h) => (
                    <th key={h} style={{ padding: '6px 8px', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--color-text-muted)', textAlign: h === '#' || h === 'Due' ? 'left' : 'right' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {schedule.filter((r: any) => r.paid_status !== 'paid').slice(0, 12).map((r: any) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                    <td style={{ padding: '5px 8px', fontSize: 10, color: 'var(--color-text-muted)' }}>{r.payment_number}</td>
                    <td style={{ padding: '5px 8px', fontSize: 10, fontFamily: 'SF Mono, Menlo, monospace' }}>{r.due_date}</td>
                    <td style={{ padding: '5px 8px', fontSize: 10, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: 600 }}>{fmt$(r.scheduled_payment, cur)}</td>
                    <td style={{ padding: '5px 8px', fontSize: 10, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', color: '#16a34a' }}>{fmt$(r.principal_amount, cur)}</td>
                    <td style={{ padding: '5px 8px', fontSize: 10, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', color: '#dc2626' }}>{fmt$(r.interest_amount, cur)}</td>
                    <td style={{ padding: '5px 8px', fontSize: 10, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-text-muted)' }}>{fmt$(r.remaining_balance, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="block-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border-primary)', background: 'var(--color-bg-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <SectionLabel>Payment History</SectionLabel>
            <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{payments.length} total</span>
          </div>
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {payments.length === 0 && (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 11 }}>
                No payments recorded yet.
              </div>
            )}
            {payments.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border-primary)', background: 'var(--color-bg-secondary)' }}>
                    {['Date', 'Amount', 'Principal', 'Interest', 'Method'].map((h) => (
                      <th key={h} style={{ padding: '6px 8px', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--color-text-muted)', textAlign: h === 'Date' || h === 'Method' ? 'left' : 'right' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p: any) => (
                    <tr key={p.id} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                      <td style={{ padding: '5px 8px', fontSize: 10, fontFamily: 'SF Mono, Menlo, monospace' }}>{p.payment_date}</td>
                      <td style={{ padding: '5px 8px', fontSize: 10, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: 700 }}>
                        {fmt$(p.amount, cur)}
                        {p.is_extra_principal ? <span style={{ fontSize: 9, color: '#16a34a', marginLeft: 4 }}>(extra)</span> : null}
                      </td>
                      <td style={{ padding: '5px 8px', fontSize: 10, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', color: '#16a34a' }}>{fmt$(p.principal_amount, cur)}</td>
                      <td style={{ padding: '5px 8px', fontSize: 10, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', color: '#dc2626' }}>{fmt$(p.interest_amount, cur)}</td>
                      <td style={{ padding: '5px 8px', fontSize: 10, color: 'var(--color-text-muted)' }}>{p.payment_method}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Record payment modal */}
      {showPayment && <PaymentModal loanId={loanId} loan={loan} onClose={() => setShowPayment(false)} onSaved={() => { setShowPayment(false); load(); }} />}
    </div>
  );
};

const PaymentModal: React.FC<{ loanId: string; loan: any; onClose: () => void; onSaved: () => void }> = ({ loanId, loan, onClose, onSaved }) => {
  const toast = useToast();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState(loan.payment_amount + (loan.escrow_per_payment || 0));
  const [method, setMethod] = useState('ach');
  const [reference, setReference] = useState('');
  const [extra, setExtra] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleSave = async () => {
    if (!amount || amount <= 0) { toast.error('Amount must be > 0'); return; }
    setBusy(true);
    try {
      const r = await api.loanRecordPayment({
        loan_id: loanId,
        payment_date: date,
        amount,
        is_extra_principal: extra,
        payment_method: method,
        reference,
      });
      if (r?.error) { toast.error('Failed: ' + r.error); return; }
      toast.success('Payment recorded · principal ' + (r.split?.principal?.toFixed(2) || '0') + ' · interest ' + (r.split?.interest?.toFixed(2) || '0'));
      onSaved();
    } finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-primary)', borderRadius: 8, maxWidth: 480, width: '100%', padding: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Record Loan Payment</div>
        <div style={{ display: 'grid', gap: 10 }}>
          <Field label="Payment Date">
            <input type="date" className="block-input" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Amount">
            <input type="number" step="0.01" className="block-input" value={amount || ''} onChange={(e) => setAmount(parseFloat(e.target.value) || 0)} />
          </Field>
          <Field label="Method">
            <select className="block-input" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="ach">ACH / Auto-debit</option>
              <option value="check">Check</option>
              <option value="wire">Wire</option>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
            </select>
          </Field>
          <Field label="Reference">
            <input className="block-input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Check # or confirmation" />
          </Field>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <input type="checkbox" checked={extra} onChange={(e) => setExtra(e.target.checked)} />
            Extra principal-only payment (skips schedule, applies 100% to principal)
          </label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 16 }}>
          <button onClick={onClose} className="block-btn">Cancel</button>
          <button onClick={handleSave} disabled={busy} className="block-btn-primary">{busy ? 'Saving…' : 'Record'}</button>
        </div>
      </div>
    </div>
  );
};

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)' }}>{children}</div>
);

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

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
    <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--color-text-muted)' }}>{label}</span>
    {children}
  </div>
);

export default LoanDetail;
