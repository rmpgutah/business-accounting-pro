import React, { useEffect, useState } from 'react';
import { CalendarDays, Plus, Check, Trash2 } from 'lucide-react';
import api from '../../lib/api';

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

interface Props {
  debtId: string;
  balanceDue: number;
  onRefresh?: () => void;
}

const PaymentPlanCard: React.FC<Props> = ({ debtId, balanceDue, onRefresh }) => {
  const [plan, setPlan] = useState<any>(null);
  const [installments, setInstallments] = useState<any[]>([]);
  const [form, setForm] = useState({
    installment_amount: '',
    frequency: 'monthly',
    start_date: '',
    total_installments: '12',
    notes: '',
  });
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [opSuccess, setOpSuccess] = useState('');
  const [opError, setOpError] = useState('');

  const load = async () => {
    try {
      const data = await api.getPaymentPlan(debtId);
      if (data) {
        setPlan(data);
        setInstallments(data.installments || []);
      } else {
        setPlan(null);
        setInstallments([]);
      }
    } catch { /* silent */ }
  };

  useEffect(() => { load(); }, [debtId]);

  const handleSave = async () => {
    if (!form.start_date || !form.installment_amount) return;
    setSaving(true);
    try {
      await api.savePaymentPlan({
        debt_id: debtId,
        installment_amount: parseFloat(form.installment_amount) || 0,
        frequency: form.frequency,
        start_date: form.start_date,
        total_installments: parseInt(form.total_installments) || 1,
        notes: form.notes,
      });
      setShowForm(false);
      await load();
      onRefresh?.();
      setOpSuccess('Payment plan generated'); setTimeout(() => setOpSuccess(''), 3000);
    } catch (err: any) {
      console.error('Failed to save payment plan:', err);
      setOpError('Failed to save plan: ' + (err?.message || 'Unknown error')); setTimeout(() => setOpError(''), 5000);
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePlan = async () => {
    if (!plan) return;
    if (!window.confirm('Delete this payment plan and all its installments?')) return;
    try {
      // Delete installments first
      for (const inst of installments) {
        await api.remove('debt_plan_installments', inst.id);
      }
      await api.remove('debt_payment_plans', plan.id);
      setPlan(null);
      setInstallments([]);
      onRefresh?.();
      setOpSuccess('Payment plan deleted'); setTimeout(() => setOpSuccess(''), 3000);
    } catch (err: any) {
      console.error('Failed to delete payment plan:', err);
      setOpError('Failed to delete plan: ' + (err?.message || 'Unknown error')); setTimeout(() => setOpError(''), 5000);
    }
  };

  const togglePaid = async (inst: any) => {
    try {
      await api.togglePlanInstallment(inst.id, !inst.paid);
      await load();
      onRefresh?.();
      setOpSuccess(inst.paid ? 'Installment unmarked' : 'Installment marked as paid'); setTimeout(() => setOpSuccess(''), 3000);
    } catch (err: any) {
      console.error('Failed to toggle installment:', err);
      setOpError('Failed to update installment: ' + (err?.message || 'Unknown error')); setTimeout(() => setOpError(''), 5000);
    }
  };

  const paidCount = installments.filter(i => i.paid).length;
  const totalCount = installments.length;
  const paidAmount = installments.filter(i => i.paid).reduce((s, i) => s + i.amount, 0);
  const totalAmount = installments.reduce((s, i) => s + i.amount, 0);

  return (
    <div className="block-card p-5 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CalendarDays size={15} className="text-accent-blue" />
          <h4 className="text-sm font-semibold text-text-primary">Payment Plan</h4>
        </div>
        <div className="flex items-center gap-2">
          {plan && (
            <button
              className="block-btn flex items-center gap-1.5 text-xs py-1 px-2 text-accent-expense hover:bg-accent-expense/10"
              onClick={handleDeletePlan}
              title="Delete plan"
            >
              <Trash2 size={12} />
            </button>
          )}
          <button
            className="block-btn flex items-center gap-1.5 text-xs py-1 px-3"
            onClick={() => setShowForm(s => !s)}
          >
            <Plus size={12} />
            {plan ? 'Edit Plan' : 'Set Up Plan'}
          </button>
        </div>
      </div>

      {opSuccess && <div className="text-xs text-accent-income bg-accent-income/10 px-3 py-2 border border-accent-income/20 mb-3" style={{ borderRadius: '6px' }}>{opSuccess}</div>}
      {opError && <div className="text-xs text-accent-expense bg-accent-expense/10 px-3 py-2 border border-accent-expense/20 mb-3" style={{ borderRadius: '6px' }}>{opError}</div>}

      {showForm && (
        <div className="grid grid-cols-2 gap-3 mb-4 p-4 bg-bg-tertiary" style={{ borderRadius: 6 }}>
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
              Installment Amount
            </label>
            <input
              type="number"
              className="block-input"
              placeholder="0.00"
              value={form.installment_amount}
              onChange={e => setForm(p => ({ ...p, installment_amount: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
              Frequency
            </label>
            <select
              className="block-select"
              value={form.frequency}
              onChange={e => setForm(p => ({ ...p, frequency: e.target.value }))}
            >
              <option value="weekly">Weekly</option>
              <option value="biweekly">Bi-Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
              Start Date
            </label>
            <input
              type="date"
              className="block-input"
              value={form.start_date}
              onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
              Total Installments
            </label>
            <input
              type="number"
              min={1}
              className="block-input"
              value={form.total_installments}
              onChange={e => setForm(p => ({ ...p, total_installments: e.target.value }))}
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
              Notes
            </label>
            <textarea
              className="block-input"
              rows={2}
              placeholder="Plan notes..."
              value={form.notes}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
            />
          </div>
          <div className="col-span-2 flex justify-end gap-2 mt-1">
            <button className="block-btn text-xs py-1 px-3" onClick={() => setShowForm(false)}>
              Cancel
            </button>
            <button
              className="block-btn-primary text-xs py-1 px-3"
              disabled={saving}
              onClick={handleSave}
            >
              {saving ? 'Saving...' : 'Generate Plan'}
            </button>
          </div>
        </div>
      )}

      {installments.length > 0 ? (
        <>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8 }}>
            {paidCount}/{totalCount} paid · {fmt.format(paidAmount)} of {fmt.format(totalAmount)}
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            <table className="block-table w-full text-xs">
              <thead>
                <tr>
                  <th className="text-left">Due Date</th>
                  <th className="text-right">Amount</th>
                  <th className="text-center">Paid</th>
                </tr>
              </thead>
              <tbody>
                {installments.map(inst => (
                  <tr key={inst.id} style={{ opacity: inst.paid ? 0.6 : 1 }}>
                    <td>{inst.due_date}</td>
                    <td className="text-right font-mono">{fmt.format(inst.amount)}</td>
                    <td className="text-center">
                      <button
                        onClick={() => togglePaid(inst)}
                        style={{
                          background: inst.paid ? '#22c55e' : 'var(--color-bg-tertiary)',
                          border: '1px solid var(--color-border-primary)',
                          borderRadius: 6,
                          width: 20,
                          height: 20,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                        }}
                      >
                        {inst.paid && <Check size={11} color="#fff" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
          No payment plan set up.
        </div>
      )}
    </div>
  );
};

export default PaymentPlanCard;
