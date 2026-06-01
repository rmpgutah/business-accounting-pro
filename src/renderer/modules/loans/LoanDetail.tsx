// src/renderer/modules/loans/LoanDetail.tsx
//
// Per-loan dashboard. Sections:
//   • Stats overview (4-up: balance, total paid, % paid down, next due)
//   • Amortization chart (SVG, principal/interest/balance overlay)
//   • Payoff scenario calculator (live recompute on slider)
//   • Schedule table (paginated; shows next 12 unpaid + last 6 paid)
//   • Payment history list

import React, { useEffect, useState, useCallback } from 'react';
import { ChevronLeft, Edit, DollarSign, TrendingDown, Trash2, Plus, Download, RefreshCw, Pencil, X, Save, SkipForward } from 'lucide-react';
import api from '../../lib/api';
import { useToast } from '../../components/ToastProvider';
import AmortizationChart from './AmortizationChart';
import RelatedPanel from '../../components/RelatedPanel';
import EntityTimeline from '../../components/EntityTimeline';

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
  // Inline payment editing — null when nothing is being edited, else the
  // working copy of the row's fields. Save commits via loans:update-payment
  // and re-aggregates loan totals. Delete pops a confirm then loans:delete-payment.
  const [editPayment, setEditPayment] = useState<any | null>(null);
  const [showSkipModal, setShowSkipModal] = useState(false);

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
    if (r?.error) { toast.error('Payoff scenario failed: ' + r.error); setScenario(null); return; }
    setScenario(r);
  }, [data, extraPerPayment, loanId, toast]);

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;
  if (!data) return <div style={{ padding: 24, color: 'var(--color-text-muted)' }}>Loan not found</div>;

  const { loan, schedule, payments } = data;
  const cur = loan.currency || 'USD';
  const pctPaid = loan.principal > 0 ? ((loan.principal - loan.current_balance) / loan.principal) * 100 : 0;
  const totalScheduledInterest = schedule.reduce((s: number, r: any) => s + (Number(r.interest_amount) || 0), 0);
  const remainingPayments = schedule.filter((r: any) => r.paid_status !== 'paid' && r.paid_status !== 'skipped').length;

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
        <button onClick={() => setShowSkipModal(true)} className="block-btn flex items-center gap-1.5 text-xs"
          title="Skip the next scheduled payment — interest still accrues"
          style={{ borderColor: 'var(--color-accent-warning)', color: 'var(--color-accent-warning)' }}>
          <SkipForward size={12} /> Skip Payment
        </button>
        <button
          onClick={async () => {
            const r = await api.loanExportPDF(loanId);
            if (r?.error) toast.error('PDF export failed: ' + r.error);
            else if (r?.path) toast.success('PDF saved to ' + r.path);
          }}
          className="block-btn flex items-center gap-1.5 text-xs"
          title="Export full amortization schedule as PDF"
        >
          <Download size={12} /> Export PDF
        </button>
        <button
          onClick={async () => {
            const r = await api.loanRecompute(loanId);
            if (r?.error) { toast.error('Repair failed: ' + r.error); return; }
            const parts = [
              `balance $${(r.totals?.current_balance || 0).toFixed(2)}`,
              `interest $${(r.totals?.total_interest_paid || 0).toFixed(2)}`,
              `principal $${(r.totals?.total_principal_paid || 0).toFixed(2)}`,
            ];
            if (r.schedule_payments) parts.push(`${r.schedule_payments} payments left`);
            if (r.expenses_backfilled) parts.push(`${r.expenses_backfilled} expense rows backfilled`);
            toast.success('Loan repaired · ' + parts.join(' · '));
            // Reload loan + payments + schedule to reflect the repair
            const fresh = await api.loanGet(loanId);
            if (!fresh.error) setData(fresh);
          }}
          className="block-btn flex items-center gap-1.5 text-xs"
          title="Repair this loan: re-split payments, fix interest/principal totals, regenerate the schedule from the current balance, and backfill linked expense rows"
        >
          <RefreshCw size={12} /> Repair
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
          <Stat label="Current Balance" value={fmt$(loan.current_balance, cur)} highlight color="var(--color-accent-expense)" />
          <Stat label="Total Paid" value={fmt$(loan.total_paid_to_date, cur)} color="var(--color-accent-income)" />
          <Stat label="Interest Paid" value={fmt$(loan.total_interest_paid, cur)} color="var(--color-accent-warning)" />
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
              background: 'linear-gradient(90deg, var(--color-accent-income), var(--color-accent-income))',
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
            <Stat label="Interest Saved" value={fmt$(scenario.interest_saved, cur)} color="var(--color-accent-income)" highlight />
            <Stat label="Months Saved" value={String(scenario.months_saved)} color="var(--color-accent-income)" highlight />
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
                {schedule.filter((r: any) => r.paid_status !== 'paid').slice(0, 12).map((r: any) => {
                  const isSkipped = r.paid_status === 'skipped';
                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border-primary)', opacity: isSkipped ? 0.5 : 1, textDecoration: isSkipped ? 'line-through' : 'none' }}>
                      <td style={{ padding: '5px 8px', fontSize: 10, color: 'var(--color-text-muted)' }}>{r.payment_number}{isSkipped ? ' ⏭' : ''}</td>
                      <td style={{ padding: '5px 8px', fontSize: 10, fontFamily: 'SF Mono, Menlo, monospace' }}>{r.due_date}</td>
                      <td style={{ padding: '5px 8px', fontSize: 10, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: 600 }}>{isSkipped ? <span style={{ color: 'var(--color-accent-warning)', textDecoration: 'none', display: 'inline-block', fontSize: 9, fontWeight: 700 }}>SKIPPED</span> : fmt$(r.scheduled_payment, cur)}</td>
                      <td style={{ padding: '5px 8px', fontSize: 10, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-accent-income)' }}>{isSkipped ? '—' : fmt$(r.principal_amount, cur)}</td>
                      <td style={{ padding: '5px 8px', fontSize: 10, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-accent-expense)' }}>{isSkipped ? '—' : fmt$(r.interest_amount, cur)}</td>
                      <td style={{ padding: '5px 8px', fontSize: 10, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-text-muted)' }}>{fmt$(r.remaining_balance, cur)}</td>
                    </tr>
                  );
                })}
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
                    {['Date', 'Amount', 'Principal', 'Interest', 'Method', ''].map((h, i) => (
                      <th key={i} style={{ padding: '6px 8px', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--color-text-muted)', textAlign: h === 'Date' || h === 'Method' ? 'left' : (h === '' ? 'center' : 'right'), width: h === '' ? 70 : undefined }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p: any) => (
                    <tr key={p.id} style={{ borderBottom: '1px solid var(--color-border-primary)' }}
                        onDoubleClick={() => setEditPayment({ ...p })}
                        title="Double-click row to edit">
                      <td style={{ padding: '5px 8px', fontSize: 10, fontFamily: 'SF Mono, Menlo, monospace' }}>{p.payment_date}</td>
                      <td style={{ padding: '5px 8px', fontSize: 10, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: 700 }}>
                        {fmt$(p.amount, cur)}
                        {p.is_extra_principal ? <span style={{ fontSize: 9, color: 'var(--color-accent-income)', marginLeft: 4 }}>(extra)</span> : null}
                      </td>
                      <td style={{ padding: '5px 8px', fontSize: 10, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-accent-income)' }}>{fmt$(p.principal_amount, cur)}</td>
                      <td style={{ padding: '5px 8px', fontSize: 10, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-accent-expense)' }}>{fmt$(p.interest_amount, cur)}</td>
                      <td style={{ padding: '5px 8px', fontSize: 10, color: 'var(--color-text-muted)' }}>{p.payment_method}</td>
                      <td style={{ padding: '3px 6px', fontSize: 10, textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <button
                          onClick={() => setEditPayment({ ...p })}
                          className="block-btn"
                          style={{ padding: '2px 6px', fontSize: 10, marginRight: 4 }}
                          title="Edit this payment's date, amount, or principal/interest split"
                        >
                          <Pencil size={10} />
                        </button>
                        <button
                          onClick={async () => {
                            if (!confirm(`Delete the ${fmt$(p.amount, cur)} payment on ${p.payment_date}? Loan totals will re-aggregate from remaining payments.`)) return;
                            const r = await api.loanDeletePayment(p.id);
                            if (r?.error) { toast.error('Delete failed: ' + r.error); return; }
                            toast.success(`Payment deleted · balance now ${fmt$(r.totals?.current_balance || 0, cur)}`);
                            const fresh = await api.loanGet(loanId);
                            if (!fresh.error) setData(fresh);
                          }}
                          className="block-btn"
                          style={{ padding: '2px 6px', fontSize: 10, color: 'var(--color-accent-expense)', borderColor: 'var(--color-accent-expense)' }}
                          title="Delete this payment"
                        >
                          <Trash2 size={10} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Loan Linkage Wave (F1053-F1062) — "Linked Expenses" section.
          Loads expenses with related_loan_id = this loan. Shows up below
          payment history so users see both the loan-side ledger AND the
          expense-side ledger for the same money in one place. */}
      <LinkedExpensesPanel loanId={loanId} currency={cur} refreshKey={data?.payments?.length || 0} />

      {/* Cross-entity relations & activity timeline — surfaces JE postings,
          linked payments, and any other modules that recordRelation()'d to
          this loan (e.g. bank-recon, expenses tagged with the loan). */}
      <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        <RelatedPanel entityType="loan" entityId={loanId} />
        <EntityTimeline entityType="loan" entityId={loanId} />
      </div>

      {/* Record payment modal */}
      {showPayment && <PaymentModal loanId={loanId} loan={loan} onClose={() => setShowPayment(false)} onSaved={() => { setShowPayment(false); load(); }} />}
      {showSkipModal && <SkipPaymentModal loanId={loanId} loan={loan} onClose={() => setShowSkipModal(false)} onSkipped={() => { setShowSkipModal(false); load(); }} />}
      {editPayment && (
        <PaymentEditModal
          payment={editPayment}
          currency={cur}
          onClose={() => setEditPayment(null)}
          onSaved={async () => {
            setEditPayment(null);
            const fresh = await api.loanGet(loanId);
            if (!fresh.error) setData(fresh);
          }}
          onError={(msg) => toast.error(msg)}
          onSuccess={(msg) => toast.success(msg)}
        />
      )}
    </div>
  );
};

// Record a new loan payment. By default the system auto-computes the
// principal/interest/escrow split using daily accrual against the
// current balance. Toggle "Override split manually" to type your own
// values from a bank statement — those go straight to the DB and the
// loan's running totals.
const PaymentModal: React.FC<{ loanId: string; loan: any; onClose: () => void; onSaved: () => void }> = ({ loanId, loan, onClose, onSaved }) => {
  const toast = useToast();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState(loan.payment_amount + (loan.escrow_per_payment || 0));
  const [method, setMethod] = useState('ach');
  const [reference, setReference] = useState('');
  const [extra, setExtra] = useState(false);
  const [busy, setBusy] = useState(false);
  // Manual split override — when ON, the user-typed principal/interest/
  // escrow values are sent verbatim. When OFF, the IPC handler
  // auto-derives them via daily-accrual splitPaymentDaily.
  const [manualSplit, setManualSplit] = useState(false);
  // Auto-creates an Interest Expense entry linked to this loan payment.
  // Default ON because interest IS a deductible business expense and
  // every accounting workflow expects to see it in the expense ledger.
  // Turn OFF if you'll record the expense separately or this loan is
  // personal (interest isn't deductible).
  const [createInterestExpense, setCreateInterestExpense] = useState(true);
  const [principal, setPrincipal] = useState(0);
  const [interest, setInterest] = useState(0);
  const [escrow, setEscrow] = useState(0);

  // Live auto-split preview — shows what the system WOULD compute,
  // so the user can see it before deciding to override. Uses periodic
  // (monthly) rate as a quick approximation; actual save uses daily
  // accrual based on days since last payment.
  const monthlyRate = (loan.interest_rate || 0) / 12;
  const accruedInterest = (loan.current_balance || loan.principal) * monthlyRate;
  const previewInterest = extra ? 0 : Math.min(amount, accruedInterest);
  const previewEscrow = extra ? 0 : Math.min(loan.escrow_per_payment || 0, Math.max(0, amount - previewInterest));
  const previewPrincipal = extra ? amount : Math.max(0, amount - previewInterest - previewEscrow);

  // When user toggles manual ON, seed inputs with the preview values
  // so they have a starting point to tweak.
  useEffect(() => {
    if (manualSplit) {
      setPrincipal(round2(previewPrincipal));
      setInterest(round2(previewInterest));
      setEscrow(round2(previewEscrow));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualSplit]);

  function round2(n: number) { return Math.round(n * 100) / 100; }

  const componentsSum = principal + interest + escrow;
  const splitDiff = amount - componentsSum;
  const splitBalanced = Math.abs(splitDiff) < 0.01;

  const handleSave = async () => {
    if (!amount || amount <= 0) { toast.error('Amount must be > 0'); return; }
    if (manualSplit && !splitBalanced) {
      if (!confirm(`Components sum to $${componentsSum.toFixed(2)} but Amount is $${amount.toFixed(2)} (diff $${Math.abs(splitDiff).toFixed(2)}). Save anyway?`)) return;
    }
    setBusy(true);
    try {
      const r = await api.loanRecordPayment({
        loan_id: loanId,
        payment_date: date,
        amount,
        is_extra_principal: extra,
        payment_method: method,
        reference,
        ...(manualSplit ? {
          principal_amount: principal,
          interest_amount: interest,
          escrow_amount: escrow,
        } : {}),
        ...(createInterestExpense ? {} : { skip_expense_creation: true } as any),
      });
      if (r?.error) { toast.error('Failed: ' + r.error); return; }
      toast.success('Payment recorded · principal ' + (r.split?.principal?.toFixed(2) || '0') + ' · interest ' + (r.split?.interest?.toFixed(2) || '0'));
      onSaved();
    } finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-primary)', borderRadius: 8, maxWidth: 520, width: '100%', padding: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Record Loan Payment</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Payment Date">
            <input type="date" className="block-input" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Total Amount">
            <input type="number" step="0.01" className="block-input" value={amount || ''} onChange={(e) => setAmount(parseFloat(e.target.value) || 0)} />
          </Field>
          <Field label="Method">
            <select className="block-select" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="ach">ACH / Auto-debit</option>
              <option value="check">Check</option>
              <option value="wire">Wire</option>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="transfer">Bank Transfer</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Reference">
            <input className="block-input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Check # / confirmation" />
          </Field>
        </div>

        {/* Live auto-split preview — visible always so user sees what
            the system would compute. Becomes "starting point" if they
            toggle the manual override on. */}
        <div style={{
          marginTop: 10, padding: '8px 10px',
          background: 'rgba(96,165,250,0.06)',
          border: '1px solid rgba(96,165,250,0.2)',
          borderRadius: 6, fontSize: 11,
        }}>
          <div style={{ color: 'var(--color-text-muted)', fontSize: 9, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4 }}>
            Auto-split preview (daily accrual on save · monthly proxy shown here)
          </div>
          <div style={{ display: 'flex', gap: 16, fontFamily: 'SF Mono, Menlo, monospace' }}>
            <span><span style={{ color: 'var(--color-text-muted)' }}>Principal: </span><span style={{ color: 'var(--color-accent-income)', fontWeight: 700 }}>${previewPrincipal.toFixed(2)}</span></span>
            <span><span style={{ color: 'var(--color-text-muted)' }}>Interest: </span><span style={{ color: 'var(--color-accent-expense)', fontWeight: 700 }}>${previewInterest.toFixed(2)}</span></span>
            {(loan.escrow_per_payment || 0) > 0 && (
              <span><span style={{ color: 'var(--color-text-muted)' }}>Escrow: </span><span style={{ fontWeight: 700 }}>${previewEscrow.toFixed(2)}</span></span>
            )}
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginTop: 10 }}>
          <input type="checkbox" checked={manualSplit} onChange={(e) => setManualSplit(e.target.checked)} />
          <span style={{ fontWeight: 600 }}>Override split manually</span>
          <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>
            — type values from your bank statement instead of auto-calc
          </span>
        </label>

        {manualSplit && (
          <div style={{ marginTop: 8, padding: 10, background: 'var(--color-bg-secondary)', borderRadius: 6, border: '1px solid var(--color-border-primary)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <Field label="Principal Portion">
                <input type="number" step="0.01" className="block-input"
                  value={principal || ''}
                  onChange={(e) => setPrincipal(parseFloat(e.target.value) || 0)}
                  style={{ color: 'var(--color-accent-income)' }} />
              </Field>
              <Field label="Interest Portion">
                <input type="number" step="0.01" className="block-input"
                  value={interest || ''}
                  onChange={(e) => setInterest(parseFloat(e.target.value) || 0)}
                  style={{ color: 'var(--color-accent-expense)' }} />
              </Field>
              <Field label="Escrow Portion">
                <input type="number" step="0.01" className="block-input"
                  value={escrow || ''}
                  onChange={(e) => setEscrow(parseFloat(e.target.value) || 0)} />
              </Field>
            </div>
            {/* Live balance check */}
            <div style={{
              marginTop: 8, padding: '6px 8px',
              background: splitBalanced ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.08)',
              border: '1px solid ' + (splitBalanced ? 'rgba(22,163,74,0.3)' : 'rgba(220,38,38,0.3)'),
              borderRadius: 4, fontSize: 10,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontFamily: 'SF Mono, Menlo, monospace' }}>
                P+I+E = ${componentsSum.toFixed(2)} · Amount = ${amount.toFixed(2)}
                {!splitBalanced && <span style={{ color: 'var(--color-accent-expense)', marginLeft: 6 }}>diff ${Math.abs(splitDiff).toFixed(2)}</span>}
              </span>
              {!splitBalanced && (
                <button
                  onClick={() => setPrincipal(round2(principal + splitDiff))}
                  className="block-btn"
                  style={{ padding: '1px 6px', fontSize: 9 }}
                  title="Adjust principal so components sum to amount"
                >
                  Balance → Principal
                </button>
              )}
            </div>
          </div>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginTop: 10 }}>
          <input type="checkbox" checked={extra} onChange={(e) => setExtra(e.target.checked)} />
          Extra principal-only payment (skips schedule, applies 100% to principal)
        </label>

        {/* Cross-integration with expense ledger — auto-creates an
            Interest Expense entry for the interest portion. Bidirectional
            link: the expense knows its loan_payment_id and vice versa.
            Edit/delete one side, the other follows. */}
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, marginTop: 10 }}>
          <input type="checkbox" checked={createInterestExpense}
            onChange={(e) => setCreateInterestExpense(e.target.checked)}
            style={{ marginTop: 3 }} />
          <span>
            <span style={{ fontWeight: 600 }}>Cross-post to Expenses ledger</span>
            <span style={{ color: 'var(--color-text-muted)', display: 'block', fontSize: 10, marginTop: 2 }}>
              Creates one "Loan Payment" expense for the full amount, split into <b style={{ color: 'var(--color-accent-warning)' }}>Interest</b> (deductible) + <b style={{ color: 'var(--color-accent-purple)' }}>Principal</b> line items. Edit/delete the payment — the expense follows.
            </span>
          </span>
        </label>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 16 }}>
          <button onClick={onClose} className="block-btn">Cancel</button>
          <button onClick={handleSave} disabled={busy} className="block-btn-primary">{busy ? 'Saving…' : 'Record'}</button>
        </div>
      </div>
    </div>
  );
};

// Edit any field of a recorded payment. After save, the IPC handler
// re-aggregates loan totals from the SUM of all payment rows — so
// manual overrides to principal/interest splits are preserved (no
// silent re-allocation behind the user's back).
//
// Built-in math helper: when user changes Amount, we don't auto-touch
// principal/interest. They have to set those explicitly. There's a
// "Split = Amount − Interest" hint button that fills principal from
// the gap so they don't have to do arithmetic in their head.
const PaymentEditModal: React.FC<{
  payment: any;
  currency: string;
  onClose: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}> = ({ payment, currency, onClose, onSaved, onError, onSuccess }) => {
  const [form, setForm] = useState({
    payment_date: payment.payment_date,
    amount: Number(payment.amount) || 0,
    principal_amount: Number(payment.principal_amount) || 0,
    interest_amount: Number(payment.interest_amount) || 0,
    escrow_amount: Number(payment.escrow_amount) || 0,
    payment_method: payment.payment_method || 'ach',
    reference: payment.reference || '',
    notes: payment.notes || '',
    is_extra_principal: !!payment.is_extra_principal,
  });
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const componentsSum = form.principal_amount + form.interest_amount + form.escrow_amount;
  const diff = form.amount - componentsSum;
  const balanced = Math.abs(diff) < 0.01;

  const handleSave = async () => {
    if (!form.payment_date) { onError('Date required'); return; }
    if (form.amount <= 0) { onError('Amount must be > 0'); return; }
    setBusy(true);
    try {
      const r = await api.loanUpdatePayment({
        payment_id: payment.id,
        payment_date: form.payment_date,
        amount: form.amount,
        principal_amount: form.principal_amount,
        interest_amount: form.interest_amount,
        escrow_amount: form.escrow_amount,
        payment_method: form.payment_method,
        reference: form.reference,
        notes: form.notes,
        is_extra_principal: form.is_extra_principal,
      });
      if (r?.error) { onError(r.error); return; }
      onSuccess(
        `Payment updated · balance: $${(r.totals?.current_balance || 0).toFixed(2)}` +
        ` · interest paid: $${(r.totals?.interest || 0).toFixed(2)}`
      );
      onSaved();
    } finally { setBusy(false); }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete this ${currency} ${form.amount.toFixed(2)} payment on ${form.payment_date}?`)) return;
    setDeleting(true);
    try {
      const r = await api.loanDeletePayment(payment.id);
      if (r?.error) { onError(r.error); return; }
      onSuccess(`Payment deleted · balance: $${(r.totals?.current_balance || 0).toFixed(2)}`);
      onSaved();
    } finally { setDeleting(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-primary)', borderRadius: 8, maxWidth: 560, width: '100%', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Edit Payment</div>
          <button onClick={onClose} className="block-btn" style={{ padding: '4px 8px' }}><X size={14} /></button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Date">
            <input type="date" className="block-input" value={form.payment_date}
              onChange={(e) => setForm({ ...form, payment_date: e.target.value })} />
          </Field>
          <Field label="Amount Paid">
            <input type="number" step="0.01" className="block-input" value={form.amount || ''}
              onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })} />
          </Field>
          <Field label="Principal Portion">
            <input type="number" step="0.01" className="block-input"
              value={form.principal_amount || ''}
              onChange={(e) => setForm({ ...form, principal_amount: parseFloat(e.target.value) || 0 })}
              style={{ color: 'var(--color-accent-income)' }} />
          </Field>
          <Field label="Interest Portion">
            <input type="number" step="0.01" className="block-input"
              value={form.interest_amount || ''}
              onChange={(e) => setForm({ ...form, interest_amount: parseFloat(e.target.value) || 0 })}
              style={{ color: 'var(--color-accent-expense)' }} />
          </Field>
          <Field label="Escrow Portion">
            <input type="number" step="0.01" className="block-input"
              value={form.escrow_amount || ''}
              onChange={(e) => setForm({ ...form, escrow_amount: parseFloat(e.target.value) || 0 })} />
          </Field>
          <Field label="Method">
            <select className="block-select" value={form.payment_method}
              onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
              <option value="ach">ACH / Auto-debit</option>
              <option value="check">Check</option>
              <option value="wire">Wire</option>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="transfer">Bank Transfer</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Reference">
            <input className="block-input" value={form.reference}
              onChange={(e) => setForm({ ...form, reference: e.target.value })}
              placeholder="Check # / confirmation" />
          </Field>
          <Field label="Type">
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '8px 10px' }}>
              <input type="checkbox" checked={form.is_extra_principal}
                onChange={(e) => setForm({ ...form, is_extra_principal: e.target.checked })} />
              Extra-principal payment
            </label>
          </Field>
        </div>
        <div style={{ marginTop: 10 }}>
          <Field label="Notes">
            <textarea className="block-input" rows={2} value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>

        {/* Balance hint — green when components sum to amount, red when off */}
        <div style={{
          marginTop: 12, padding: '8px 10px',
          background: balanced ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.08)',
          border: '1px solid ' + (balanced ? 'rgba(22,163,74,0.3)' : 'rgba(220,38,38,0.3)'),
          borderRadius: 6, fontSize: 11,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div>
            <span style={{ color: 'var(--color-text-muted)' }}>Principal + Interest + Escrow = </span>
            <span style={{ fontFamily: 'SF Mono, Menlo, monospace', fontWeight: 700 }}>${componentsSum.toFixed(2)}</span>
            <span style={{ color: 'var(--color-text-muted)' }}> · Amount = </span>
            <span style={{ fontFamily: 'SF Mono, Menlo, monospace', fontWeight: 700 }}>${form.amount.toFixed(2)}</span>
            {!balanced && (
              <span style={{ color: 'var(--color-accent-expense)', marginLeft: 8 }}>· diff ${Math.abs(diff).toFixed(2)}</span>
            )}
          </div>
          {!balanced && (
            <button
              onClick={() => {
                // Auto-balance: add the diff to principal (most common case)
                setForm({ ...form, principal_amount: form.principal_amount + diff });
              }}
              className="block-btn"
              style={{ padding: '2px 8px', fontSize: 10 }}
              title="Adjust principal by the diff so components sum to amount"
            >
              Auto-balance to Principal
            </button>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginTop: 16 }}>
          <button onClick={handleDelete} disabled={deleting || busy} className="block-btn"
            style={{ color: 'var(--color-accent-expense)', borderColor: 'var(--color-accent-expense)' }}>
            <Trash2 size={12} style={{ marginRight: 4, display: 'inline' }} />
            {deleting ? 'Deleting…' : 'Delete Payment'}
          </button>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={onClose} className="block-btn">Cancel</button>
            <button onClick={handleSave} disabled={busy || deleting} className="block-btn-primary">
              <Save size={12} style={{ marginRight: 4, display: 'inline' }} />
              {busy ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Skip Payment Modal — lets the user skip the next scheduled payment
// with a reason and an option to capitalize accrued interest into the
// balance. The schedule row is marked 'skipped', next_payment_due
// advances, and a notification + loan event are created.
const SkipPaymentModal: React.FC<{
  loanId: string; loan: any; onClose: () => void; onSkipped: () => void;
}> = ({ loanId, loan, onClose, onSkipped }) => {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [capitalize, setCapitalize] = useState(true);
  const [busy, setBusy] = useState(false);

  const nextDue = loan.next_payment_due;
  const payment = loan.payment_amount || 0;

  // When "Other" is picked, the real reason comes from the free-text field.
  const effectiveReason = reason === 'Other' ? customReason.trim() : reason.trim();

  const handleSkip = async () => {
    if (!effectiveReason) { toast.error('Please enter a reason for skipping.'); return; }
    setBusy(true);
    try {
      const r = await api.loanSkipPayment(loanId, effectiveReason, capitalize);
      if (r?.error) { toast.error('Skip failed: ' + r.error); return; }
      toast.success(
        `Payment #${r.skipped_payment_number} ($${(r.skipped_amount || 0).toFixed(2)}) on ${r.skipped_due_date} skipped. ` +
        `Next due: ${r.new_next_due || 'N/A'}.` +
        (r.interest_capitalized ? ` $${r.interest_capitalized.toFixed(2)} interest added to balance.` : '')
      );
      onSkipped();
    } finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-primary)', borderRadius: 8, maxWidth: 480, width: '100%', padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SkipForward size={16} style={{ color: 'var(--color-accent-warning)' }} />
            <span style={{ fontSize: 16, fontWeight: 700 }}>Skip a Payment</span>
          </div>
          <button onClick={onClose} className="block-btn" style={{ padding: '4px 8px' }}><X size={14} /></button>
        </div>

        {/* What will be skipped */}
        <div style={{
          padding: '10px 14px', marginBottom: 12, borderRadius: 6,
          background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.25)',
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--color-text-muted)', marginBottom: 4 }}>
            Next Scheduled Payment
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'SF Mono, Menlo, monospace' }}>
              {nextDue ? new Date(nextDue + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A'}
            </span>
            <span style={{ fontSize: 18, fontWeight: 800, fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-accent-warning)' }}>
              ${payment.toFixed(2)}
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <label style={{ display: 'block', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--color-text-muted)', marginBottom: 4 }}>
              Reason for Skipping *
            </label>
            <select className="block-select" value={reason} onChange={(e) => setReason(e.target.value)} style={{ marginBottom: 4 }}>
              <option value="">Select a reason...</option>
              <option value="Financial hardship">Financial hardship</option>
              <option value="Lender-approved deferment">Lender-approved deferment</option>
              <option value="Natural disaster / emergency">Natural disaster / emergency</option>
              <option value="Payment holiday (promotional)">Payment holiday (promotional)</option>
              <option value="Seasonal business adjustment">Seasonal business adjustment</option>
              <option value="Other">Other</option>
            </select>
            {reason === 'Other' && (
              <input className="block-input" placeholder="Describe the reason..." value={customReason} onChange={(e) => setCustomReason(e.target.value)} />
            )}
          </div>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: 'var(--color-text-secondary)' }}>
            <input type="checkbox" checked={capitalize} onChange={(e) => setCapitalize(e.target.checked)}
              style={{ marginTop: 3, accentColor: 'var(--color-accent-warning)' }} />
            <span>
              <strong>Capitalize accrued interest</strong>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
                Add this month's interest to the loan balance. This is how most skip-a-payment programs work — the interest doesn't disappear, it gets added to what you owe. If unchecked, the interest is deferred (owed later but not added to the principal balance).
              </span>
            </span>
          </label>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 16 }}>
          <button onClick={onClose} className="block-btn">Cancel</button>
          <button onClick={handleSkip} disabled={busy || !effectiveReason} className="block-btn-primary"
            style={{ background: 'var(--color-accent-warning)', borderColor: 'var(--color-accent-warning)' }}>
            <SkipForward size={12} style={{ marginRight: 4, display: 'inline' }} />
            {busy ? 'Skipping...' : 'Skip This Payment'}
          </button>
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

/**
 * LinkedExpensesPanel — Loan Linkage Wave (F1055).
 * Lists expense rows where related_loan_id === loanId. Shows the
 * total interest expensed against this loan, useful for tax-deductibility
 * computations and quick reconciliation between loan_payments and the
 * expense ledger.
 */
const LinkedExpensesPanel: React.FC<{ loanId: string; currency: string; refreshKey?: number }> = ({ loanId, currency, refreshKey }) => {
  const [expenses, setExpenses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const result = await api.lkExpensesForLoan(loanId, { limit: 50 });
        if (!cancelled && Array.isArray(result)) setExpenses(result);
        else if (!cancelled) setExpenses([]);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [loanId, refreshKey]);

  const total = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const interestTotal = expenses.reduce((s, e) => s + (Number(e.interest_portion) || 0), 0);
  const principalTotal = expenses.reduce((s, e) => s + (Number(e.principal_portion) || 0), 0);

  if (loading) return null;

  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n || 0);

  return (
    <div className="block-card" style={{ padding: 0, overflow: 'hidden', marginTop: 16 }}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--color-border-primary)', background: 'var(--color-bg-secondary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: 'var(--color-text-muted)' }}>
          Linked Expenses · one row per payment, split inside
        </span>
        <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
          {expenses.length} payment{expenses.length === 1 ? '' : 's'} · Total {fmt(total)}
          {(interestTotal > 0 || principalTotal > 0) && (
            <span> · <span style={{ color: 'var(--color-accent-warning)' }}>Int {fmt(interestTotal)}</span> · <span style={{ color: 'var(--color-accent-purple)' }}>Prin {fmt(principalTotal)}</span></span>
          )}
        </span>
      </div>
      {expenses.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 11 }}>
          No linked expenses yet. Record a payment with "Cross-post to Expenses ledger" enabled,
          or use the "Sync to Expenses" button on the Loans list.
        </div>
      ) : (
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border-primary)', background: 'var(--color-bg-secondary)' }}>
                {['Date', 'Description', 'Interest', 'Principal', 'Payment', 'Status'].map(h => (
                  <th key={h} style={{ padding: '6px 8px', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--color-text-muted)', textAlign: (h === 'Date' || h === 'Description' || h === 'Status') ? 'left' : 'right' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {expenses.map((e: any) => {
                const interest = Number(e.interest_portion) || 0;
                const principal = Number(e.principal_portion) || 0;
                return (
                  <tr key={e.id} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                    <td style={{ padding: '5px 8px', fontSize: 10, fontFamily: 'SF Mono, Menlo, monospace' }}>{e.date}</td>
                    <td style={{ padding: '5px 8px', fontSize: 10 }}>{e.description || '—'}</td>
                    <td style={{ padding: '5px 8px', fontSize: 10, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-accent-warning)' }}>{interest > 0 ? fmt(interest) : '—'}</td>
                    <td style={{ padding: '5px 8px', fontSize: 10, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-accent-purple)' }}>{principal > 0 ? fmt(principal) : '—'}</td>
                    <td style={{ padding: '5px 8px', fontSize: 10, textAlign: 'right', fontFamily: 'SF Mono, Menlo, monospace', fontWeight: 700 }}>{fmt(e.amount || 0)}</td>
                    <td style={{ padding: '5px 8px', fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'capitalize' }}>{e.status}</td>
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
