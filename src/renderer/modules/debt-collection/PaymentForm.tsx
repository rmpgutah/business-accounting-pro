import React, { useEffect, useState, useMemo } from 'react';
import { DollarSign, X } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, roundCents } from '../../lib/format';
import ErrorBanner from '../../components/ErrorBanner';
import { useModalBehavior, trapFocusOnKeyDown } from '../../lib/use-modal-behavior';

// ─── Types ──────────────────────────────────────────────
interface DebtData {
  balance_due: number;
  interest_accrued: number;
  fees_accrued: number;
}

interface PaymentFormProps {
  debtId: string;
  editId?: string;
  onClose: () => void;
  onSaved: () => void;
}

function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ─── Component ──────────────────────────────────────────
const PaymentForm: React.FC<PaymentFormProps> = ({ debtId, editId, onClose, onSaved }) => {
  // Debt data loaded on mount
  const [debt, setDebt] = useState<DebtData | null>(null);
  const [loading, setLoading] = useState(true);

  // Form fields
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('check');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [receivedDate, setReceivedDate] = useState(todayISO());
  const [notes, setNotes] = useState('');

  const [saving, setSaving] = useState(false);
  const [amountError, setAmountError] = useState('');
  const [amountWarning, setAmountWarning] = useState('');
  const [saveError, setSaveError] = useState('');

  // ── Load debt data ──
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await api.get('debts', debtId);
        if (data && !cancelled) {
          setDebt({
            balance_due: Number(data.balance_due) || 0,
            interest_accrued: Number(data.interest_accrued) || 0,
            fees_accrued: Number(data.fees_accrued) || 0,
          });
        }
      } catch (err) {
        console.error('Failed to load debt:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [debtId]);

  // ── Load existing payment for edit ──
  useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const row = await api.get('debt_payments', editId);
        if (row && !cancelled) {
          setAmount(String(row.amount || ''));
          setMethod(row.method || 'check');
          setReferenceNumber(row.reference_number || '');
          setReceivedDate(row.received_date ? row.received_date.slice(0, 10) : todayISO());
          setNotes(row.notes || '');
        }
      } catch (err) {
        console.error('Failed to load payment:', err);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [editId]);

  // ── Parsed amount ──
  const parsedAmount = useMemo(() => {
    const n = parseFloat(amount);
    return isNaN(n) ? 0 : n;
  }, [amount]);

  // ── Auto-allocation: fees -> interest -> principal ──
  const allocation = useMemo(() => {
    if (!debt) return { fees: 0, interest: 0, principal: 0 };
    // Round each step so the three buckets sum exactly to the entered amount.
    // Floor each accrued column at 0 — a negative fees/interest column would
    // otherwise feed a NEGATIVE allocation amount into the DB.
    const fees = roundCents(Math.min(parsedAmount, Math.max(0, debt.fees_accrued)));
    const interest = roundCents(Math.min(parsedAmount - fees, Math.max(0, debt.interest_accrued)));
    const principal = roundCents(Math.max(parsedAmount - fees - interest, 0));
    return { fees, interest, principal };
  }, [parsedAmount, debt]);

  // ── Validation on amount change ──
  useEffect(() => {
    if (!debt) return;
    if (parsedAmount <= 0 && amount !== '') {
      setAmountError('Amount must be greater than zero.');
      setAmountWarning('');
    } else if (parsedAmount > debt.balance_due && debt.balance_due > 0) {
      setAmountError('');
      setAmountWarning('Amount exceeds balance due.');
    } else {
      setAmountError('');
      setAmountWarning('');
    }
  }, [parsedAmount, amount, debt]);

  // ── Pay Full Balance ──
  const handlePayFull = () => {
    if (!debt) return;
    // Floor at 0 so an over-paid debt (negative balance_due) doesn't
    // pre-fill the amount field with a negative number.
    setAmount(Math.max(0, roundCents(debt.balance_due)).toFixed(2));
  };

  // ── Submit ──
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !debt) return;

    if (parsedAmount <= 0) {
      setAmountError('Amount must be greater than zero.');
      return;
    }
    if (!receivedDate) {
      return;
    }

    setSaving(true);
    setSaveError('');
    const roundedAmount = roundCents(parsedAmount);
    const paymentPayload = {
      debt_id: debtId,
      amount: roundedAmount,
      method,
      reference_number: referenceNumber || null,
      received_date: receivedDate,
      applied_to_principal: allocation.principal,
      applied_to_interest: allocation.interest,
      applied_to_fees: allocation.fees,
      notes: notes || null,
    };

    try {
      if (editId) {
        // Update existing payment record
        await api.update('debt_payments', editId, paymentPayload);
      } else {
        // 1. Create payment record
        await api.create('debt_payments', paymentPayload);

        // 2. Update debt running totals & auto-settle if fully paid.
        // Compute new balance in JS to remove the dependency on column-update
        // ordering inside the same UPDATE statement (the previous form mixed
        // `payments_made = payments_made + ?` with another expression that also
        // referenced `payments_made` — order-of-eval was implementation-defined).
        const newBalanceDue = roundCents((debt?.balance_due ?? 0) - roundedAmount);
        const newStatus = newBalanceDue <= 0 ? 'settled' : null;
        await api.rawQuery(
          `UPDATE debts SET
            payments_made = payments_made + ?,
            balance_due = ?,
            status = CASE WHEN ? IS NOT NULL THEN ? ELSE status END,
            updated_at = datetime('now')
          WHERE id = ?`,
          [roundedAmount, newBalanceDue, newStatus, newStatus, debtId]
        );
      }

      onSaved();
    } catch (err: any) {
      // VISIBILITY: surface record-payment errors instead of swallowing
      console.error('Failed to record payment:', err);
      setSaveError(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  };

  // A11Y: ESC close, body scroll lock, focus trap, role=dialog
  const { containerRef } = useModalBehavior({ onClose });
  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/60 z-40"
        onClick={onClose}
        role="presentation"
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          ref={containerRef}
          role="dialog"
          aria-modal="true"
          aria-label={editId ? 'Edit payment' : 'Record payment'}
          tabIndex={-1}
          onKeyDown={trapFocusOnKeyDown(containerRef)}
          className="block-card-elevated w-full max-w-[500px] max-h-[90vh] overflow-y-auto cursor-pointer"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-5 pb-4 border-b border-border-primary">
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 flex items-center justify-center bg-bg-tertiary border border-border-primary"
                style={{ borderRadius: '6px' }}
              >
                <DollarSign size={16} className="text-accent-income" />
              </div>
              <div>
                <h3 className="text-base font-bold text-text-primary">{editId ? 'Edit Payment' : 'Record Payment'}</h3>
                {debt && (
                  <p className="text-xs text-text-muted mt-0.5">
                    Balance Due: <span className="text-text-primary font-semibold">{formatCurrency(debt.balance_due)}</span>
                  </p>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-text-muted hover:text-text-primary transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-text-muted text-sm">
              Loading...
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {saveError && (
                <ErrorBanner
                  message={saveError}
                  title="Failed to record payment"
                  onDismiss={() => setSaveError('')}
                />
              )}
              {/* Amount + Pay Full */}
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Amount <span className="text-accent-expense">*</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="0.01"
                    className="block-input flex-1"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="block-btn text-xs whitespace-nowrap"
                    onClick={handlePayFull}
                  >
                    Pay Full Balance
                  </button>
                </div>
                {amountError && (
                  <p className="mt-1 text-xs text-accent-expense">{amountError}</p>
                )}
                {amountWarning && (
                  <p className="mt-1 text-xs text-accent-warning">{amountWarning}</p>
                )}
              </div>

              {/* Method */}
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Payment Method
                </label>
                <select
                  className="block-select"
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                >
                  <option value="ach">ACH</option>
                  <option value="card">Card</option>
                  <option value="cash">Cash</option>
                  <option value="check">Check</option>
                  <option value="garnishment">Garnishment</option>
                  <option value="other">Other</option>
                  <option value="settlement">Settlement</option>
                  <option value="wire">Wire</option>
                </select>
              </div>

              {/* Reference Number */}
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Reference Number
                </label>
                <input
                  type="text"
                  className="block-input"
                  placeholder="Check #, confirmation code, etc."
                  value={referenceNumber}
                  onChange={(e) => setReferenceNumber(e.target.value)}
                />
              </div>

              {/* Received Date */}
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Received Date <span className="text-accent-expense">*</span>
                </label>
                <input
                  type="date"
                  className="block-input"
                  value={receivedDate}
                  onChange={(e) => setReceivedDate(e.target.value)}
                />
              </div>

              {/* Auto-Allocation Display */}
              {parsedAmount > 0 && debt && (
                <div
                  className="bg-bg-tertiary border border-border-primary p-4 space-y-2"
                  style={{ borderRadius: '6px' }}
                >
                  <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                    Payment Allocation
                  </p>
                  <div className="flex justify-between text-sm">
                    <span className="text-text-muted">Applied to Fees</span>
                    <span className="text-text-primary font-mono">{formatCurrency(allocation.fees)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-text-muted">Applied to Interest</span>
                    <span className="text-text-primary font-mono">{formatCurrency(allocation.interest)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-text-muted">Applied to Principal</span>
                    <span className="text-text-primary font-mono">{formatCurrency(allocation.principal)}</span>
                  </div>
                  <div className="border-t border-border-primary pt-2 mt-2 flex justify-between text-sm font-semibold">
                    <span className="text-text-secondary">Total</span>
                    <span className="text-accent-income font-mono">{formatCurrency(parsedAmount)}</span>
                  </div>
                </div>
              )}

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Notes
                </label>
                <textarea
                  className="block-input"
                  rows={3}
                  placeholder="Payment notes..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  style={{ resize: 'vertical' }}
                />
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t border-border-primary">
                <button type="button" className="block-btn" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="block-btn-primary flex items-center gap-2"
                  disabled={saving || parsedAmount <= 0}
                >
                  <DollarSign size={14} />
                  {saving ? 'Saving...' : editId ? 'Update Payment' : 'Record Payment'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
};

export default PaymentForm;
