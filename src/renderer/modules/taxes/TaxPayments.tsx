import React, { useEffect, useState, useMemo } from 'react';
import { CreditCard, Plus, X, Pencil, Trash2, Search } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatDate } from '../../lib/format';

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

// Alphabetical A→Z (note: contradicts fiscal-quarter ordering, but follows app-wide directive)
const PERIODS = ['Annual', 'Q1', 'Q2', 'Q3', 'Q4'];

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [search, setSearch] = useState('');
  type SortField = 'type' | 'amount' | 'date' | 'period' | 'year';
  type SortDir = 'asc' | 'desc';
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [opSuccess, setOpSuccess] = useState('');
  const [opError, setOpError] = useState('');

  const currentYear = new Date().getFullYear();

  const defaultForm = {
    type: 'federal_estimated' as PaymentType,
    amount: '',
    date: new Date().toISOString().slice(0, 10),
    period: 'Q1',
    year: currentYear,
    confirmation_number: '',
  };

  const [formData, setFormData] = useState(defaultForm);

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
  }, [activeCompany]);

  const handleSort = (f: SortField) => { if (sortField === f) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortField(f); setSortDir('asc'); } };

  const filtered = useMemo(() => {
    let list = [...payments];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        (PAYMENT_TYPES.find(t => t.value === p.type)?.label || p.type).toLowerCase().includes(q) ||
        p.confirmation_number?.toLowerCase().includes(q) ||
        p.period?.toLowerCase().includes(q) ||
        String(p.year).includes(q)
      );
    }
    list.sort((a, b) => {
      const aVal = a[sortField] ?? '';
      const bVal = b[sortField] ?? '';
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [payments, search, sortField, sortDir]);

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
      const payload = {
        company_id: activeCompany?.id,
        type: formData.type,
        amount,
        date: formData.date,
        period: formData.period,
        year: formData.year,
        confirmation_number: formData.confirmation_number,
      };
      if (editingId) {
        await api.update('tax_payments', editingId, payload);
      } else {
        await api.create('tax_payments', payload);
      }
      setFormData(defaultForm);
      setFormError('');
      setEditingId(null);
      setShowForm(false);
      await loadPayments();
      setOpSuccess(editingId ? 'Payment updated' : 'Payment recorded'); setTimeout(() => setOpSuccess(''), 3000);
    } catch (err: any) {
      console.error('Failed to record payment:', err);
      setOpError('Failed to save: ' + (err?.message || 'Unknown error')); setTimeout(() => setOpError(''), 5000);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (p: TaxPayment) => {
    setEditingId(p.id);
    setFormData({
      type: p.type as PaymentType,
      amount: String(p.amount),
      date: p.date,
      period: p.period,
      year: p.year,
      confirmation_number: p.confirmation_number || '',
    });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this tax payment?')) return;
    try {
      await api.remove('tax_payments', id);
      await loadPayments();
      setOpSuccess('Payment deleted'); setTimeout(() => setOpSuccess(''), 3000);
    } catch (err: any) {
      console.error('Failed to delete tax payment:', err);
      setOpError('Failed to delete: ' + (err?.message || 'Unknown error')); setTimeout(() => setOpError(''), 5000);
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
            style={{ borderRadius: '6px' }}
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

      {/* Feedback */}
      {opSuccess && <div className="text-xs text-accent-income bg-accent-income/10 px-3 py-2 border border-accent-income/20" style={{ borderRadius: '6px' }}>{opSuccess}</div>}
      {opError && <div className="text-xs text-accent-expense bg-accent-expense/10 px-3 py-2 border border-accent-expense/20" style={{ borderRadius: '6px' }}>{opError}</div>}

      {/* Search */}
      {!showForm && payments.length > 0 && (
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input className="block-input pl-8" placeholder="Search payments..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      )}

      {/* Record Payment Form */}
      {showForm && (
        <div className="block-card p-5" style={{ borderRadius: '6px' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-text-primary">{editingId ? 'Edit Tax Payment' : 'Record Tax Payment'}</h3>
            <button
              className="text-text-muted hover:text-text-primary transition-colors"
              onClick={() => { setShowForm(false); setEditingId(null); setFormData(defaultForm); }}
            >
              <X size={16} />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-3">
            {formError && (
              <div
                className="text-xs text-accent-expense bg-accent-expense/10 px-3 py-2 border border-accent-expense/20"
                style={{ borderRadius: '6px' }}
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
                  {/* Grouped by jurisdiction — Federal first then State (alphabetical headers); items alphabetical within */}
                  {(() => {
                    const groups: Record<string, typeof PAYMENT_TYPES> = { Federal: [], State: [] };
                    for (const t of PAYMENT_TYPES) {
                      const key = t.value.startsWith('federal') ? 'Federal' : 'State';
                      groups[key].push(t);
                    }
                    for (const k of Object.keys(groups)) {
                      groups[k].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
                    }
                    return Object.keys(groups).sort().map((label) => (
                      <optgroup key={label} label={label}>
                        {groups[label].map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </optgroup>
                    ));
                  })()}
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
                {saving ? 'Saving...' : editingId ? 'Update Payment' : 'Record Payment'}
              </button>
              <button type="button" className="block-btn" onClick={() => { setShowForm(false); setEditingId(null); setFormData(defaultForm); }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      {filtered.length === 0 ? (
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
                <th className="cursor-pointer select-none" onClick={() => handleSort('type')} role="button" tabIndex={0}><span className="inline-flex items-center gap-1">Type {sortField === 'type' && (sortDir === 'asc' ? '↑' : '↓')}</span></th>
                <th className="text-right cursor-pointer select-none" onClick={() => handleSort('amount')} role="button" tabIndex={0}><span className="inline-flex items-center gap-1">Amount {sortField === 'amount' && (sortDir === 'asc' ? '↑' : '↓')}</span></th>
                <th className="cursor-pointer select-none" onClick={() => handleSort('date')} role="button" tabIndex={0}><span className="inline-flex items-center gap-1">Date {sortField === 'date' && (sortDir === 'asc' ? '↑' : '↓')}</span></th>
                <th className="cursor-pointer select-none" onClick={() => handleSort('period')} role="button" tabIndex={0}><span className="inline-flex items-center gap-1">Period {sortField === 'period' && (sortDir === 'asc' ? '↑' : '↓')}</span></th>
                <th className="cursor-pointer select-none" onClick={() => handleSort('year')} role="button" tabIndex={0}><span className="inline-flex items-center gap-1">Year {sortField === 'year' && (sortDir === 'asc' ? '↑' : '↓')}</span></th>
                <th>Confirmation #</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className={typeBadge[p.type] || 'block-badge capitalize'}>
                      {PAYMENT_TYPES.find((t) => t.value === p.type)?.label || p.type}
                    </span>
                  </td>
                  <td className="text-right font-mono text-accent-expense text-sm">
                    {fmt.format(p.amount)}
                  </td>
                  <td className="font-mono text-text-secondary text-xs">{formatDate(p.date)}</td>
                  <td className="text-text-secondary text-sm">{p.period}</td>
                  <td className="font-mono text-text-secondary text-sm">{p.year}</td>
                  <td className="font-mono text-text-muted text-xs truncate max-w-[140px]">
                    {p.confirmation_number || '-'}
                  </td>
                  <td className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        className="block-btn text-xs px-2 py-1 inline-flex items-center gap-1"
                        onClick={() => handleEdit(p)}
                        title="Edit payment"
                      >
                        <Pencil size={10} /> Edit
                      </button>
                      <button
                        className="block-btn text-xs px-2 py-1 inline-flex items-center gap-1 text-accent-expense hover:bg-accent-expense/10 transition-colors"
                        onClick={() => handleDelete(p.id)}
                        title="Delete payment"
                      >
                        <Trash2 size={10} /> Delete
                      </button>
                    </div>
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
                <td colSpan={5} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {filtered.length > 0 && (
        <div className="text-xs text-text-muted">
          Showing {filtered.length} of {payments.length} payment{payments.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
};

export default TaxPayments;
