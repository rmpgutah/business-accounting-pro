import React, { useEffect, useState } from 'react';
import { CreditCard, Plus, X } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

// ─── Types ──────────────────────────────────────────────
interface TaxPayment {
  id: string;
  type: string;
  amount: number;
  date: string;
  period: string;
  year: number;
  confirmation_number: string;
}

type PaymentType =
  | 'federal_estimated'
  | 'state_estimated'
  | 'federal_extension'
  | 'state_extension'
  | 'federal_balance_due'
  | 'state_balance_due';

const PAYMENT_TYPES: { value: PaymentType; label: string }[] = [
  { value: 'federal_estimated', label: 'Federal Estimated' },
  { value: 'state_estimated', label: 'State Estimated' },
  { value: 'federal_extension', label: 'Federal Extension' },
  { value: 'state_extension', label: 'State Extension' },
  { value: 'federal_balance_due', label: 'Federal Balance Due' },
  { value: 'state_balance_due', label: 'State Balance Due' },
];

const PERIODS = ['Q1', 'Q2', 'Q3', 'Q4', 'Annual'];

// ─── Currency Formatter ─────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const typeBadge: Record<string, string> = {
  federal_estimated: 'block-badge block-badge-blue',
  state_estimated: 'block-badge block-badge-income',
  federal_extension: 'block-badge block-badge-warning',
  state_extension: 'block-badge block-badge-warning',
  federal_balance_due: 'block-badge block-badge-expense',
  state_balance_due: 'block-badge block-badge-expense',
};

// ─── Component ──────────────────────────────────────────
const TaxPayments: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [payments, setPayments] = useState<TaxPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const currentYear = new Date().getFullYear();

  const [formData, setFormData] = useState({
    type: 'federal_estimated' as PaymentType,
    amount: '',
    date: new Date().toISOString().slice(0, 10),
    period: 'Q1',
    year: currentYear,
    confirmation_number: '',
  });

  const loadPayments = async () => {
    if (!activeCompany) return;
    try {
      // Bug fix #8: was fetching all companies' tax payments — scoped to active company.
      const data = await api.query('tax_payments', { company_id: activeCompany.id }, { field: 'date', dir: 'desc' });
      setPayments(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load tax payments:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPayments();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(formData.amount);
    if (isNaN(amount) || amount <= 0) {
      setFormError('Amount must be a valid number greater than 0.');
      return;
    }
    const yearStr = String(formData.year);
    if (!/^\d{4}$/.test(yearStr) || formData.year < 1900 || formData.year > 2100) {
      setFormError('Tax year must be a valid 4-digit year.');
      return;
    }
    setFormError('');
    setSaving(true);
    try {
      await api.create('tax_payments', {
        type: formData.type,
        amount,
        date: formData.date,
        period: formData.period,
        year: formData.year,
        confirmation_number: formData.confirmation_number,
      });
      setFormData({
        type: 'federal_estimated',
        amount: '',
        date: new Date().toISOString().slice(0, 10),
        period: 'Q1',
        year: currentYear,
        confirmation_number: '',
      });
      setFormError('');
      setShowForm(false);
      await loadPayments();
    } catch (err) {
      console.error('Failed to record payment:', err);
    } finally {
      setSaving(false);
    }
  };

  const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading tax payments...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="module-header">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary"
            style={{ borderRadius: '2px' }}
          >
            <CreditCard size={18} className="text-accent-blue" />
          </div>
          <div>
            <h2 className="module-title text-text-primary">Tax Payments</h2>
            <p className="text-xs text-text-muted mt-0.5">
              {payments.length} payment{payments.length !== 1 ? 's' : ''} &middot;{' '}
              {fmt.format(totalPaid)} total
            </p>
          </div>
        </div>
        <button
          className="block-btn-primary flex items-center gap-2"
          onClick={() => setShowForm(true)}
        >
          <Plus size={16} />
          Record Payment
        </button>
      </div>

      {/* Record Payment Form */}
      {showForm && (
        <div className="block-card p-5" style={{ borderRadius: '2px' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-text-primary">Record Tax Payment</h3>
            <button
              className="text-text-muted hover:text-text-primary"
              onClick={() => setShowForm(false)}
            >
              <X size={16} />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-3">
            {formError && (
              <div
                className="text-xs text-accent-expense bg-accent-expense/10 px-3 py-2 border border-accent-expense/20"
                style={{ borderRadius: '2px' }}
              >
                {formError}
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1">
                  Type *
                </label>
                <select
                  className="block-select"
                  value={formData.type}
                  onChange={(e) =>
                    setFormData({ ...formData, type: e.target.value as PaymentType })
                  }
                >
                  {PAYMENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1">
                  Amount *
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="block-input"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  placeholder="0.00"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1">
                  Date *
                </label>
                <input
                  type="date"
                  className="block-input"
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1">
                  Period
                </label>
                <select
                  className="block-select"
                  value={formData.period}
                  onChange={(e) => setFormData({ ...formData, period: e.target.value })}
                >
                  {PERIODS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1">
                  Tax Year
                </label>
                <input
                  type="number"
                  className="block-input"
                  value={formData.year}
                  onChange={(e) =>
                    setFormData({ ...formData, year: e.target.value === '' ? currentYear : (parseInt(e.target.value, 10) || currentYear) })
                  }
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1">
                  Confirmation #
                </label>
                <input
                  type="text"
                  className="block-input"
                  value={formData.confirmation_number}
                  onChange={(e) =>
                    setFormData({ ...formData, confirmation_number: e.target.value })
                  }
                  placeholder="Optional"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-2">
              <button type="submit" className="block-btn-primary" disabled={saving}>
                {saving ? 'Recording...' : 'Record Payment'}
              </button>
              <button type="button" className="block-btn" onClick={() => setShowForm(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      {payments.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <CreditCard size={24} className="text-text-muted" />
          </div>
          <p className="text-sm text-text-secondary font-medium">No tax payments recorded</p>
          <p className="text-xs text-text-muted mt-1">
            Record your estimated tax payments to track them here.
          </p>
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden">
          <table className="block-table">
            <thead>
              <tr>
                <th>Type</th>
                <th className="text-right">Amount</th>
                <th>Date</th>
                <th>Period</th>
                <th>Year</th>
                <th>Confirmation #</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className={typeBadge[p.type] || 'block-badge'}>
                      {PAYMENT_TYPES.find((t) => t.value === p.type)?.label || p.type}
                    </span>
                  </td>
                  <td className="text-right font-mono text-accent-expense text-sm">
                    {fmt.format(p.amount)}
                  </td>
                  <td className="font-mono text-text-secondary text-xs">{p.date}</td>
                  <td className="text-text-secondary text-sm">{p.period}</td>
                  <td className="font-mono text-text-secondary text-sm">{p.year}</td>
                  <td className="font-mono text-text-muted text-xs">
                    {p.confirmation_number || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="text-right text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Total
                </td>
                <td className="text-right font-mono font-bold text-text-primary">
                  {fmt.format(totalPaid)}
                </td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
};

export default TaxPayments;
