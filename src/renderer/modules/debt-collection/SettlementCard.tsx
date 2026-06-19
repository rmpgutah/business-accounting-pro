import React, { useEffect, useState } from 'react';
import { Handshake, Plus, Pencil, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/format';

// Route through shared formatter — guards NaN/Infinity ($0.00 instead of $NaN).
const fmt = { format: (v: number | string | null | undefined) => formatCurrency(v) };

const RESPONSE_BADGE: Record<string, { label: string; color: string }> = {
  pending: { label: 'Pending', color: '#d97706' },
  accepted: { label: 'Accepted', color: '#22c55e' },
  rejected: { label: 'Rejected', color: '#ef4444' },
};

interface Props {
  debtId: string;
  balanceDue: number;
  onRefresh: () => void;
}

const SettlementCard: React.FC<Props> = ({ debtId, balanceDue, onRefresh }) => {
  const [settlements, setSettlements] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const defaultForm = { offer_amount: '', offered_date: '', notes: '' };
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [opSuccess, setOpSuccess] = useState('');
  const [opError, setOpError] = useState('');

  const load = async () => {
    try {
      const data = await api.listSettlements(debtId);
      setSettlements(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
  };

  useEffect(() => { load(); }, [debtId]);

  const handleSave = async () => {
    if (saving) return;
    if (!form.offer_amount || !form.offered_date) return;
    setSaving(true);
    try {
      if (editingId) {
        await api.update('debt_settlements', editingId, {
          offer_amount: parseFloat(form.offer_amount) || 0,
          offered_date: form.offered_date,
          notes: form.notes,
        });
      } else {
        await api.saveSettlement({
          debt_id: debtId,
          offer_amount: parseFloat(form.offer_amount) || 0,
          balance_due: balanceDue,
          offered_date: form.offered_date,
          notes: form.notes,
        });
      }
      setShowForm(false);
      setEditingId(null);
      setForm(defaultForm);
      await load();
      setOpSuccess(editingId ? 'Offer updated' : 'Offer logged'); setTimeout(() => setOpSuccess(''), 3000);
    } catch (err: any) {
      console.error('Failed to save settlement:', err);
      setOpError('Failed to save: ' + (err?.message || 'Unknown error')); setTimeout(() => setOpError(''), 5000);
    } finally {
      setSaving(false);
    }
  };

  const handleAccept = async (s: any) => {
    if (!window.confirm(`Accept settlement of ${fmt.format(s.offer_amount)} and close this debt?`)) return;
    try {
      await api.acceptSettlement(debtId, s.id, s.offer_amount);
      setOpSuccess('Settlement accepted'); setTimeout(() => setOpSuccess(''), 3000);
      onRefresh();
    } catch (err: any) {
      console.error('Failed to accept settlement:', err);
      setOpError('Failed to accept: ' + (err?.message || 'Unknown error')); setTimeout(() => setOpError(''), 5000);
    }
  };

  const handleReject = async (s: any) => {
    try {
      await api.respondSettlement(s.id, 'rejected');
      await load();
      setOpSuccess('Offer rejected'); setTimeout(() => setOpSuccess(''), 3000);
    } catch (err: any) {
      console.error('Failed to reject settlement:', err);
      setOpError('Failed to reject: ' + (err?.message || 'Unknown error')); setTimeout(() => setOpError(''), 5000);
    }
  };

  const handleEdit = (s: any) => {
    setEditingId(s.id);
    setForm({
      offer_amount: String(s.offer_amount),
      offered_date: s.offered_date || '',
      notes: s.notes || '',
    });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this settlement offer?')) return;
    try {
      await api.remove('debt_settlements', id);
      await load();
      setOpSuccess('Offer deleted'); setTimeout(() => setOpSuccess(''), 3000);
    } catch (err: any) {
      console.error('Failed to delete settlement:', err);
      setOpError('Failed to delete: ' + (err?.message || 'Unknown error')); setTimeout(() => setOpError(''), 5000);
    }
  };

  return (
    <div className="block-card p-5 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Handshake size={15} className="text-accent-blue" />
          <h4 className="text-sm font-semibold text-text-primary">Settlement Offers</h4>
        </div>
        <button
          className="block-btn flex items-center gap-1.5 text-xs py-1 px-3"
          onClick={() => setShowForm(s => !s)}
        >
          <Plus size={12} />
          New Offer
        </button>
      </div>

      {opSuccess && <div className="text-xs text-accent-income bg-accent-income/10 px-3 py-2 border border-accent-income/20 mb-3" style={{ borderRadius: '6px' }}>{opSuccess}</div>}
      {opError && <div className="text-xs text-accent-expense bg-accent-expense/10 px-3 py-2 border border-accent-expense/20 mb-3" style={{ borderRadius: '6px' }}>{opError}</div>}

      {showForm && (
        <div className="grid grid-cols-2 gap-3 mb-4 p-4 bg-bg-tertiary" style={{ borderRadius: 6 }}>
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
              Offer Amount
            </label>
            <input
              type="number"
              className="block-input"
              placeholder="0.00"
              value={form.offer_amount}
              onChange={e => setForm(p => ({ ...p, offer_amount: e.target.value }))}
            />
            {form.offer_amount && balanceDue > 0 ? (
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 3 }}>
                {((parseFloat(form.offer_amount) / balanceDue) * 100).toFixed(1)}% of balance
              </div>
            ) : form.offer_amount && balanceDue <= 0 ? (
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 3 }}>
                — (no balance to compare)
              </div>
            ) : null}
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
              Offer Date
            </label>
            <input
              type="date"
              className="block-input"
              value={form.offered_date}
              onChange={e => setForm(p => ({ ...p, offered_date: e.target.value }))}
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
              Notes
            </label>
            <input
              className="block-input"
              placeholder="Settlement notes..."
              value={form.notes}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
            />
          </div>
          <div className="col-span-2 flex justify-end gap-2">
            <button className="block-btn text-xs py-1 px-3" onClick={() => setShowForm(false)}>
              Cancel
            </button>
            <button
              className="block-btn-primary text-xs py-1 px-3"
              disabled={saving}
              onClick={handleSave}
            >
              {saving ? 'Saving...' : 'Log Offer'}
            </button>
          </div>
        </div>
      )}

      {settlements.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
          No settlement offers logged.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {settlements.map(s => {
            const badge = RESPONSE_BADGE[s.response] || RESPONSE_BADGE.pending;
            return (
              <div
                key={s.id}
                style={{
                  padding: '10px 12px',
                  background: 'var(--color-bg-tertiary)',
                  borderRadius: 6,
                  border: '1px solid var(--color-border-primary)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                      {fmt.format(s.offer_amount)}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 6 }}>
                      ({Number.isFinite(s.offer_pct) ? `${s.offer_pct.toFixed(1)}%` : '—'} of balance) · {s.offered_date}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: badge.color,
                      padding: '2px 8px',
                      borderRadius: 6,
                      background: badge.color + '20',
                    }}
                  >
                    {badge.label}
                  </span>
                </div>
                {s.notes && (
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
                    {s.notes}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  {s.response === 'pending' && (
                    <>
                      <button className="block-btn-primary text-xs py-1 px-3" onClick={() => handleAccept(s)}>
                        Accept &amp; Close
                      </button>
                      <button className="block-btn text-xs py-1 px-3" onClick={() => handleReject(s)}>
                        Reject
                      </button>
                    </>
                  )}
                  <button
                    className="block-btn text-xs py-1 px-2 inline-flex items-center gap-1"
                    onClick={() => handleEdit(s)}
                    title="Edit offer"
                  >
                    <Pencil size={10} />
                  </button>
                  <button
                    className="block-btn text-xs py-1 px-2 inline-flex items-center gap-1 text-accent-expense hover:bg-accent-expense/10 transition-colors"
                    onClick={() => handleDelete(s.id)}
                    title="Delete offer"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SettlementCard;
