import React, { useState, useMemo } from 'react';
import { X, DollarSign } from 'lucide-react';
import api from '../../lib/api';

// ─── Currency Formatter ─────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// ─── Payment Methods ────────────────────────────────────
const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'check', label: 'Check' },
  { value: 'transfer', label: 'Bank Transfer' },
  { value: 'card', label: 'Credit / Debit Card' },
  { value: 'other', label: 'Other' },
];

// ─── Component ──────────────────────────────────────────
interface PaymentRecorderProps {
  invoiceId: string;
  invoiceTotal: number;
  amountPaid: number;
  onClose: () => void;
  onSaved: () => void;
}

const PaymentRecorder: React.FC<PaymentRecorderProps> = ({
  invoiceId,
  invoiceTotal,
  amountPaid,
  onClose,
  onSaved,
}) => {
  const balanceDue = useMemo(() => invoiceTotal - amountPaid, [invoiceTotal, amountPaid]);

  const [amount, setAmount] = useState<number>(balanceDue);
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<string>('transfer');
  const [reference, setReference] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>('');

  const handleSave = async () => {
    setError('');

    if (amount <= 0) {
      setError('Payment amount must be greater than zero.');
      return;
    }
    if (amount > balanceDue) {
      setError(`Payment cannot exceed the balance due of ${fmt.format(balanceDue)}.`);
      return;
    }
    if (!date) {
      setError('Please select a payment date.');
      return;
    }

    setSaving(true);
    try {
      // Record the payment
      await api.create('payments', {
        invoice_id: invoiceId,
        amount,
        date,
        payment_method: method,
        reference,
      });

      // Update the invoice
      const newAmountPaid = amountPaid + amount;
      const newStatus = newAmountPaid >= invoiceTotal ? 'paid' : 'partial';

      await api.update('invoices', invoiceId, {
        amount_paid: newAmountPaid,
        status: newStatus,
      });

      onSaved();
    } catch (err) {
      console.error('Failed to record payment:', err);
      setError('Failed to record payment. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="block-card-elevated w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <DollarSign size={18} className="text-accent-income" />
            <h2 className="text-base font-bold text-text-primary">Record Payment</h2>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors p-1"
          >
            <X size={18} />
          </button>
        </div>

        {/* Balance Due Info */}
        <div
          className="flex items-center justify-between p-3 mb-5"
          style={{
            backgroundColor: 'var(--color-bg-tertiary)',
            border: '1px solid var(--color-border-primary)',
            borderRadius: '2px',
          }}
        >
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            Balance Due
          </span>
          <span className="font-mono text-lg font-bold text-accent-warning">
            {fmt.format(balanceDue)}
          </span>
        </div>

        {/* Error */}
        {error && (
          <div
            className="p-3 mb-4 text-sm text-accent-expense"
            style={{
              backgroundColor: 'var(--color-accent-expense-bg)',
              border: '1px solid var(--color-accent-expense)',
              borderRadius: '2px',
            }}
          >
            {error}
          </div>
        )}

        {/* Form */}
        <div className="space-y-4">
          {/* Amount */}
          <div>
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1.5">
              Payment Amount
            </label>
            <input
              type="number"
              min={0}
              step="0.01"
              max={balanceDue}
              className="block-input font-mono"
              value={amount}
              onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
            />
          </div>

          {/* Date */}
          <div>
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1.5">
              Payment Date
            </label>
            <input
              type="date"
              className="block-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          {/* Method */}
          <div>
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1.5">
              Payment Method
            </label>
            <select
              className="block-select"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {/* Reference */}
          <div>
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1.5">
              Reference Number
            </label>
            <input
              type="text"
              className="block-input"
              placeholder="Check #, transaction ID, etc."
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 mt-6 pt-4" style={{ borderTop: '1px solid var(--color-border-primary)' }}>
          <button className="block-btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="block-btn-success" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Record Payment'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PaymentRecorder;
