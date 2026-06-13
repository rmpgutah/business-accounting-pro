import React, { useState, useEffect, useCallback } from 'react';
import { CalendarDays, Plus, RefreshCw, AlertTriangle, ChevronDown, ChevronRight, DollarSign, XCircle } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';

// ─── Types ───────────────────────────────────────────────────
interface PaymentPlan {
  id: string;
  invoice_id: string;
  plan_name: string;
  total_amount: number;
  installment_count: number;
  installment_amount: number;
  frequency: string;
  start_date: string;
  status: string;
  created_at: string;
}

interface Installment {
  id: string;
  plan_id: string;
  installment_number: number;
  due_date: string;
  amount: number;
  paid_amount: number;
  status: string;
  paid_at: string | null;
}

interface OverdueInstallment {
  id: string;
  plan_id: string;
  installment_number: number;
  due_date: string;
  amount: number;
  paid_amount: number;
  status: string;
  plan_name: string;
  invoice_id: string;
  invoice_number: string;
}

const EMPTY_FORM = {
  invoice_id: '',
  plan_name: '',
  total_amount: '',
  installment_count: '3',
  frequency: 'monthly',
  start_date: '',
};

const FREQ_LABELS: Record<string, string> = {
  weekly: 'Weekly',
  biweekly: 'Bi-weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
};

// ─── Component ───────────────────────────────────────────────
const PaymentPlansPanel: React.FC = () => {
  const [plans, setPlans] = useState<PaymentPlan[]>([]);
  const [overdue, setOverdue] = useState<OverdueInstallment[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Expanded plan state: planId → installment list
  const [expanded, setExpanded] = useState<Record<string, Installment[] | 'loading'>>({});

  // Pay dialog
  const [payDialog, setPayDialog] = useState<{ installment: Installment; planId: string } | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    let cancelled = false;
    setLoading(true);
    try {
      const listResult = await (api as any).ivPaymentPlans();
      if (cancelled) return;
      setPlans(Array.isArray(listResult) ? listResult : []);
    } catch (err) {
      console.error('PaymentPlansPanel load plans:', err);
    }
    try {
      const overdueResult = await (api as any).ivOverdueInstallments();
      if (cancelled) return;
      setOverdue(Array.isArray(overdueResult) ? overdueResult : []);
    } catch (err) {
      console.error('PaymentPlansPanel load overdue:', err);
    }
    if (!cancelled) setLoading(false);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleExpand = async (planId: string) => {
    if (planId in expanded) {
      setExpanded((prev) => { const next = { ...prev }; delete next[planId]; return next; });
      return;
    }
    setExpanded((prev) => ({ ...prev, [planId]: 'loading' }));
    try {
      const list = await (api as any).ivPaymentPlanInstallments(planId);
      setExpanded((prev) => ({ ...prev, [planId]: Array.isArray(list) ? list : [] }));
    } catch (err) {
      console.error('Load installments:', err);
      setExpanded((prev) => ({ ...prev, [planId]: [] }));
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!form.invoice_id.trim()) { setFormError('Invoice ID is required.'); return; }
    const total = parseFloat(form.total_amount);
    const count = parseInt(form.installment_count);
    if (isNaN(total) || total <= 0) { setFormError('Total amount must be positive.'); return; }
    if (isNaN(count) || count < 1) { setFormError('At least 1 installment required.'); return; }
    setSaving(true);
    try {
      await (api as any).ivPaymentPlanCreate({
        invoice_id: form.invoice_id.trim(),
        plan_name: form.plan_name.trim() || 'Payment Plan',
        total_amount: total,
        installment_count: count,
        frequency: form.frequency,
        start_date: form.start_date || new Date().toISOString().slice(0, 10),
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch (err: any) {
      setFormError(err?.message || 'Failed to create payment plan.');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (planId: string, planName: string) => {
    if (!window.confirm(`Cancel payment plan "${planName}"?`)) return;
    try {
      await (api as any).ivPaymentPlanCancel(planId);
      await load();
      setExpanded((prev) => { const next = { ...prev }; delete next[planId]; return next; });
    } catch (err) {
      console.error('Cancel plan:', err);
    }
  };

  const openPayDialog = (installment: Installment, planId: string) => {
    setPayDialog({ installment, planId });
    setPayAmount(String(Math.max(0, installment.amount - (installment.paid_amount || 0))));
  };

  const handlePay = async () => {
    if (!payDialog) return;
    const amount = parseFloat(payAmount);
    if (isNaN(amount) || amount <= 0) return;
    setPaying(true);
    try {
      await (api as any).ivInstallmentPay(payDialog.installment.id, amount);
      // Refresh installments for this plan
      const list = await (api as any).ivPaymentPlanInstallments(payDialog.planId);
      setExpanded((prev) => ({ ...prev, [payDialog.planId]: Array.isArray(list) ? list : [] }));
      setPayDialog(null);
      setPayAmount('');
    } catch (err) {
      console.error('Pay installment:', err);
    } finally {
      setPaying(false);
    }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; color: string }> = {
      active: { label: 'Active', color: 'text-accent-income' },
      completed: { label: 'Completed', color: 'text-text-muted' },
      cancelled: { label: 'Cancelled', color: 'text-accent-expense' },
      pending: { label: 'Pending', color: 'text-accent-warning' },
      partial: { label: 'Partial', color: 'text-accent-warning' },
      paid: { label: 'Paid', color: 'text-accent-income' },
    };
    const s = map[status] || { label: status, color: 'text-text-muted' };
    return <span className={`text-[11px] font-semibold ${s.color}`}>{s.label}</span>;
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays size={18} className="text-accent-primary" />
          <h3 className="text-base font-bold text-text-primary">Installment Payment Plans</h3>
        </div>
        <div className="flex items-center gap-2">
          <button className="block-btn flex items-center gap-1" onClick={load} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            className="block-btn-primary flex items-center gap-1"
            onClick={() => { setShowForm((v) => !v); setFormError(''); setForm(EMPTY_FORM); }}
          >
            <Plus size={14} />
            New Plan
          </button>
        </div>
      </div>

      {/* Overdue alert */}
      {overdue.length > 0 && (
        <div
          className="flex items-start gap-3 px-4 py-3"
          style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid var(--color-accent-expense)', borderRadius: 'var(--app-radius)' }}
        >
          <AlertTriangle size={15} className="text-accent-expense mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-semibold text-accent-expense">
              {overdue.length} overdue installment{overdue.length === 1 ? '' : 's'}
            </span>
            <ul className="mt-1 space-y-0.5">
              {overdue.map((o) => (
                <li key={o.id} className="text-xs text-text-secondary">
                  {o.invoice_number} · {o.plan_name} · #{o.installment_number} · due {formatDate(o.due_date)} · {formatCurrency(o.amount - (o.paid_amount || 0))} remaining
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="block-card p-5">
          <h4 className="text-sm font-semibold text-text-primary mb-4">New Payment Plan</h4>
          <form onSubmit={handleSave} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-text-muted mb-1 font-semibold uppercase">Invoice ID *</label>
                <input
                  className="block-input w-full font-mono"
                  value={form.invoice_id}
                  onChange={(e) => setForm((f) => ({ ...f, invoice_id: e.target.value }))}
                  placeholder="Paste invoice UUID"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1 font-semibold uppercase">Plan Name</label>
                <input
                  className="block-input w-full"
                  value={form.plan_name}
                  onChange={(e) => setForm((f) => ({ ...f, plan_name: e.target.value }))}
                  placeholder="Payment Plan"
                />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] text-text-muted mb-1 font-semibold uppercase">Total Amount *</label>
                <input
                  className="block-input w-full"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.total_amount}
                  onChange={(e) => setForm((f) => ({ ...f, total_amount: e.target.value }))}
                  placeholder="1000.00"
                />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1 font-semibold uppercase"># Installments *</label>
                <input
                  className="block-input w-full"
                  type="number"
                  min="1"
                  step="1"
                  value={form.installment_count}
                  onChange={(e) => setForm((f) => ({ ...f, installment_count: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1 font-semibold uppercase">Cadence</label>
                <select
                  className="block-input w-full"
                  value={form.frequency}
                  onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))}
                >
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Bi-weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1 font-semibold uppercase">Start Date</label>
                <input
                  className="block-input w-full"
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                />
              </div>
            </div>
            {form.total_amount && form.installment_count && !isNaN(parseFloat(form.total_amount)) && parseInt(form.installment_count) >= 1 && (
              <div className="text-xs text-text-muted">
                Each installment: <span className="font-mono text-text-primary">
                  {formatCurrency(parseFloat(form.total_amount) / parseInt(form.installment_count))}
                </span>
              </div>
            )}
            {formError && <div className="text-xs text-accent-expense">{formError}</div>}
            <div className="flex items-center gap-2 pt-1">
              <button type="submit" className="block-btn-primary" disabled={saving}>
                {saving ? 'Creating…' : 'Create Plan'}
              </button>
              <button type="button" className="block-btn" onClick={() => { setShowForm(false); setFormError(''); }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Plans list */}
      <div className="block-card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between">
          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Payment Plans</span>
          <span className="text-[11px] text-text-muted">{plans.length} total</span>
        </div>
        {loading ? (
          <div className="p-6 text-center text-sm text-text-muted">Loading…</div>
        ) : plans.length === 0 ? (
          <div className="p-8 text-center text-sm text-text-muted">
            No payment plans yet. Create one to split an invoice into installments.
          </div>
        ) : (
          <div>
            {plans.map((plan) => {
              const isExpanded = plan.id in expanded;
              const installments = expanded[plan.id];
              return (
                <div key={plan.id} style={{ borderBottom: '1px solid var(--color-border-primary)' }}>
                  {/* Plan row */}
                  <div
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-bg-secondary transition-colors"
                    onClick={() => toggleExpand(plan.id)}
                  >
                    <span className="text-text-muted">
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-text-primary">{plan.plan_name}</div>
                      <div className="text-[11px] text-text-muted font-mono">{plan.invoice_id}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-mono text-text-primary">{formatCurrency(plan.total_amount)}</div>
                      <div className="text-[11px] text-text-muted">
                        {plan.installment_count} × {FREQ_LABELS[plan.frequency] || plan.frequency}
                      </div>
                    </div>
                    <div className="w-20 text-right">
                      {statusBadge(plan.status)}
                    </div>
                    <div className="text-[11px] text-text-muted w-24 text-right">{formatDate(plan.start_date)}</div>
                    {plan.status === 'active' && (
                      <button
                        className="block-btn text-xs text-accent-expense flex items-center gap-1"
                        style={{ borderColor: 'transparent' }}
                        onClick={(e) => { e.stopPropagation(); handleCancel(plan.id, plan.plan_name); }}
                        title="Cancel plan"
                      >
                        <XCircle size={13} />
                      </button>
                    )}
                  </div>

                  {/* Installments sub-table */}
                  {isExpanded && (
                    <div style={{ background: 'var(--color-bg-secondary)', borderTop: '1px solid var(--color-border-primary)' }}>
                      {installments === 'loading' ? (
                        <div className="px-8 py-3 text-sm text-text-muted">Loading installments…</div>
                      ) : !Array.isArray(installments) || installments.length === 0 ? (
                        <div className="px-8 py-3 text-sm text-text-muted">No installments found.</div>
                      ) : (
                        <table className="block-table" style={{ marginLeft: 32 }}>
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Due Date</th>
                              <th className="text-right">Amount</th>
                              <th className="text-right">Paid</th>
                              <th className="text-right">Remaining</th>
                              <th>Status</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {installments.map((inst) => {
                              const remaining = Math.max(0, inst.amount - (inst.paid_amount || 0));
                              return (
                                <tr key={inst.id}>
                                  <td className="font-mono text-text-muted">#{inst.installment_number}</td>
                                  <td className="text-text-secondary">{formatDate(inst.due_date)}</td>
                                  <td className="text-right font-mono text-text-primary">{formatCurrency(inst.amount)}</td>
                                  <td className="text-right font-mono text-accent-income">{formatCurrency(inst.paid_amount || 0)}</td>
                                  <td className="text-right font-mono text-accent-expense">{formatCurrency(remaining)}</td>
                                  <td>{statusBadge(inst.status)}</td>
                                  <td>
                                    {inst.status !== 'paid' && plan.status === 'active' && (
                                      <button
                                        className="block-btn text-xs flex items-center gap-1"
                                        onClick={() => openPayDialog(inst, plan.id)}
                                      >
                                        <DollarSign size={12} />
                                        Pay
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pay dialog */}
      {payDialog && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setPayDialog(null)}
        >
          <div
            className="block-card p-5 w-80"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="text-sm font-semibold text-text-primary mb-3">
              Record Payment — Installment #{payDialog.installment.installment_number}
            </h4>
            <div className="text-xs text-text-muted mb-3">
              Due {formatDate(payDialog.installment.due_date)} · Remaining{' '}
              <span className="font-mono text-text-primary">
                {formatCurrency(Math.max(0, payDialog.installment.amount - (payDialog.installment.paid_amount || 0)))}
              </span>
            </div>
            <div className="mb-4">
              <label className="block text-[11px] text-text-muted mb-1 font-semibold uppercase">Amount ($)</label>
              <input
                className="block-input w-full"
                type="number"
                min="0"
                step="0.01"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex items-center gap-2">
              <button className="block-btn-primary" onClick={handlePay} disabled={paying || !payAmount}>
                {paying ? 'Recording…' : 'Record Payment'}
              </button>
              <button className="block-btn" onClick={() => setPayDialog(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PaymentPlansPanel;
