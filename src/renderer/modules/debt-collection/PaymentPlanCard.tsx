import React, { useEffect, useState } from 'react';
import { CalendarDays, Plus, Check } from 'lucide-react';
import api from '../../lib/api';

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

interface Props {
  debtId: string;
  balanceDue: number;
}

const PaymentPlanCard: React.FC<Props> = ({ debtId, balanceDue }) => {
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
    } catch (err) {
      console.error('Failed to save payment plan:', err);
    } finally {
      setSaving(false);
    }
  };

  const togglePaid = async (inst: any) => {
    try {
      await api.togglePlanInstallment(inst.id, !inst.paid);
      await load();
    } catch (err) {
      console.error('Failed to toggle installment:', err);
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
        <button
          className="block-btn flex items-center gap-1.5 text-xs py-1 px-3"
          onClick={() => setShowForm(s => !s)}
        >
          <Plus size={12} />
          {plan ? 'Edit Plan' : 'Set Up Plan'}
        </button>
      </div>

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
                          borderRadius: 4,
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
