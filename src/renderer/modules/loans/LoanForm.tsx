// src/renderer/modules/loans/LoanForm.tsx
//
// Loan create/edit form. On save, the backend regenerates the
// full amortization schedule from the term + rate + dates.
// Live-preview the computed monthly payment as the user types.

import React, { useState, useEffect } from 'react';
import { Save, X, ChevronLeft } from 'lucide-react';
import api from '../../lib/api';
import { useToast } from '../../components/ToastProvider';

interface Props {
  loanId?: string | null;
  onSaved: (id: string) => void;
  onCancel: () => void;
}

const EMPTY: any = {
  name: '',
  loan_type: 'term_loan',
  lender_name: '',
  account_number: '',
  principal: 0,
  interest_rate: 0.05,
  rate_type: 'fixed',
  term_months: 360,
  payment_frequency: 'monthly',
  amortization_type: 'standard',
  origination_date: new Date().toISOString().slice(0, 10),
  first_payment_date: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
  escrow_per_payment: 0,
  balloon_amount: 0,
  currency: 'USD',
  notes: '',
};

// Periodic payment frequency → payments per year / display label.
// Mirrors loan-calculator.ts (main process); duplicated here because the
// renderer can't import across the Electron process boundary.
const PAYMENTS_PER_YEAR: Record<string, number> = {
  monthly: 12, biweekly: 26, weekly: 52, quarterly: 4, annual: 1,
};
const FREQ_LABELS: Record<string, string> = {
  monthly: 'Monthly', biweekly: 'Bi-weekly', weekly: 'Weekly', quarterly: 'Quarterly', annual: 'Annual',
};

const LoanForm: React.FC<Props> = ({ loanId, onSaved, onCancel }) => {
  const toast = useToast();
  const [form, setForm] = useState<any>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!!loanId);

  useEffect(() => {
    if (!loanId) return;
    setLoading(true);
    api.loanGet(loanId).then((res) => {
      if (res.error) {
        toast.error('Load failed: ' + res.error);
        return;
      }
      setForm({
        ...EMPTY,
        ...res.loan,
        // interest_rate stored as decimal (0.065); display as percent (6.5)
        _rate_display: ((res.loan.interest_rate || 0) * 100).toFixed(3),
      });
    }).finally(() => setLoading(false));
  }, [loanId, toast]);

  // Compute live per-payment preview from form values.
  // Must honor payment_frequency or non-monthly loans show a wrong figure
  // (matches the backend amortization in loan-calculator.ts).
  const freq = form.payment_frequency || 'monthly';
  const periodsPerYear = PAYMENTS_PER_YEAR[freq] || 12;
  const freqLabel = FREQ_LABELS[freq] || 'Payment';
  const numPayments = Math.max(1, Math.round((Number(form.term_months) || 0) * (periodsPerYear / 12)));
  const livePayment = (() => {
    const P = Number(form.principal) || 0;
    const annualR = Number(form.interest_rate) || 0;
    const r = annualR / periodsPerYear;
    if (P === 0 || numPayments === 0) return 0;
    if (r === 0) return P / numPayments;
    const f = Math.pow(1 + r, numPayments);
    return P * (r * f) / (f - 1);
  })();

  const handleSave = async () => {
    if (!form.name?.trim()) { toast.error('Loan name required'); return; }
    if (!form.principal || form.principal <= 0) { toast.error('Principal must be > 0'); return; }
    if (!form.term_months || form.term_months <= 0) { toast.error('Term must be > 0 months'); return; }
    if (!form.first_payment_date) { toast.error('First payment date required'); return; }
    setSaving(true);
    try {
      const payload = { ...form };
      if (loanId) payload.id = loanId;
      const result = await api.loanSave(payload);
      if (result?.error) { toast.error('Save failed: ' + result.error); return; }
      toast.success('Loan saved · schedule generated');
      onSaved(result.id);
    } finally { setSaving(false); }
  };

  if (loading) return <div style={{ padding: 24 }}>Loading…</div>;

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button onClick={onCancel} className="block-btn flex items-center gap-1.5 text-xs">
          <ChevronLeft size={12} /> Back
        </button>
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>{loanId ? 'Edit Loan' : 'New Loan'}</h2>
      </div>

      <div className="block-card" style={{ padding: 16, marginBottom: 12 }}>
        <SectionLabel>Identity</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
          <Field label="Loan Name *">
            <input className="block-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="BMO Mortgage 2024 · SBA Equipment Loan" />
          </Field>
          <Field label="Loan Type">
            <select className="block-input" value={form.loan_type} onChange={(e) => setForm({ ...form, loan_type: e.target.value })}>
              <option value="term_loan">Term Loan</option>
              <option value="mortgage">Mortgage</option>
              <option value="auto">Auto</option>
              <option value="business">Business</option>
              <option value="personal">Personal</option>
              <option value="line_of_credit">Line of Credit</option>
              <option value="equipment">Equipment Financing</option>
              <option value="sba">SBA Loan</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Currency">
            <select className="block-input" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              {['USD', 'EUR', 'GBP', 'CAD', 'AUD'].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginTop: 12 }}>
          <Field label="Lender Name">
            <input className="block-input" value={form.lender_name} onChange={(e) => setForm({ ...form, lender_name: e.target.value })} />
          </Field>
          <Field label="Account Number (last 4)">
            <input className="block-input" value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })} placeholder="••••1234" />
          </Field>
        </div>
      </div>

      <div className="block-card" style={{ padding: 16, marginBottom: 12 }}>
        <SectionLabel>Terms & Math</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
          <Field label="Principal *">
            <input type="number" step="0.01" className="block-input"
              value={form.principal || ''} onChange={(e) => setForm({ ...form, principal: parseFloat(e.target.value) || 0 })} />
          </Field>
          <Field label="Interest Rate (annual)">
            <div style={{ position: 'relative' }}>
              <input type="number" step="0.001" className="block-input"
                value={form._rate_display ?? (form.interest_rate * 100).toFixed(3)}
                onChange={(e) => {
                  const pct = parseFloat(e.target.value) || 0;
                  setForm({ ...form, _rate_display: e.target.value, interest_rate: pct / 100 });
                }}
                style={{ paddingRight: 24 }}
              />
              <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', fontSize: 11 }}>%</span>
            </div>
          </Field>
          <Field label="Rate Type">
            <select className="block-input" value={form.rate_type} onChange={(e) => setForm({ ...form, rate_type: e.target.value })}>
              <option value="fixed">Fixed</option>
              <option value="variable">Variable</option>
              <option value="arm">ARM</option>
            </select>
          </Field>
          <Field label="Term (months)">
            <input type="number" className="block-input" value={form.term_months || ''}
              onChange={(e) => setForm({ ...form, term_months: parseInt(e.target.value) || 0 })} />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginTop: 12 }}>
          <Field label="Payment Frequency">
            <select className="block-input" value={form.payment_frequency} onChange={(e) => setForm({ ...form, payment_frequency: e.target.value })}>
              <option value="monthly">Monthly</option>
              <option value="biweekly">Bi-weekly</option>
              <option value="weekly">Weekly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annual">Annual</option>
            </select>
          </Field>
          <Field label="Amortization Type">
            <select className="block-input" value={form.amortization_type} onChange={(e) => setForm({ ...form, amortization_type: e.target.value })}>
              <option value="standard">Standard</option>
              <option value="interest_only">Interest Only</option>
              <option value="balloon">Balloon</option>
              <option value="custom">Custom</option>
            </select>
          </Field>
          <Field label="Balloon Amount">
            <input type="number" step="0.01" className="block-input"
              value={form.balloon_amount || ''} onChange={(e) => setForm({ ...form, balloon_amount: parseFloat(e.target.value) || 0 })}
              disabled={form.amortization_type !== 'balloon'} />
          </Field>
          <Field label="Escrow / Period">
            <input type="number" step="0.01" className="block-input"
              value={form.escrow_per_payment || ''} onChange={(e) => setForm({ ...form, escrow_per_payment: parseFloat(e.target.value) || 0 })} />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          <Field label="Origination Date">
            <input type="date" className="block-input" value={form.origination_date} onChange={(e) => setForm({ ...form, origination_date: e.target.value })} />
          </Field>
          <Field label="First Payment Date *">
            <input type="date" className="block-input" value={form.first_payment_date} onChange={(e) => setForm({ ...form, first_payment_date: e.target.value })} />
          </Field>
        </div>

        {/* Live preview */}
        <div style={{
          marginTop: 16, padding: '12px 14px',
          background: 'rgba(37, 99, 235, 0.06)',
          border: '1px solid rgba(37, 99, 235, 0.2)',
          borderRadius: 6,
        }}>
          <div style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)' }}>
            Live Preview · {freqLabel} Payment (excludes escrow)
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'SF Mono, Menlo, monospace', color: 'var(--color-text-primary)', marginTop: 4 }}>
            ${livePayment.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4 }}>
            {numPayments} payments × ${livePayment.toLocaleString('en-US', { maximumFractionDigits: 0 })} = ${(livePayment * numPayments).toLocaleString('en-US', { maximumFractionDigits: 0 })} total · ${((livePayment * numPayments) - (form.principal || 0)).toLocaleString('en-US', { maximumFractionDigits: 0 })} interest over life
          </div>
        </div>
      </div>

      <div className="block-card" style={{ padding: 16, marginBottom: 12 }}>
        <SectionLabel>Notes</SectionLabel>
        <textarea className="block-input" rows={3} value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          placeholder="Loan officer · contract refs · special terms" />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onCancel} className="block-btn">Cancel</button>
        <button onClick={handleSave} disabled={saving} className="block-btn-primary flex items-center gap-2">
          <Save size={14} /> {saving ? 'Saving…' : (loanId ? 'Save Changes' : 'Create Loan')}
        </button>
      </div>
    </div>
  );
};

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-muted)', marginBottom: 12 }}>{children}</div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.8, color: 'var(--color-text-muted)' }}>{label}</span>
    {children}
  </div>
);

export default LoanForm;
