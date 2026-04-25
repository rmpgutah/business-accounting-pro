import React, { useEffect, useState } from 'react';
import { ShieldCheck, Plus, AlertTriangle, Pencil, Trash2 } from 'lucide-react';
import api from '../../lib/api';

const EVENT_LABELS: Record<string, string> = {
  validation_notice_sent: 'Validation Notice Sent',
  dispute_received: 'Dispute Received',
  cease_desist_received: 'Cease & Desist Received',
  mini_miranda_delivered: 'Mini-Miranda Delivered',
  right_to_cure_sent: 'Right to Cure Sent',
  payment_plan_agreed: 'Payment Plan Agreed',
  other: 'Other',
};

interface Props {
  debtId: string;
  onRefresh?: () => void;
}

const ComplianceLog: React.FC<Props> = ({ debtId, onRefresh }) => {
  const [events, setEvents] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const defaultForm = { event_type: 'validation_notice_sent', event_date: '', notes: '' };
  const [form, setForm] = useState(defaultForm);
  const [saving, setSaving] = useState(false);
  const [opSuccess, setOpSuccess] = useState('');
  const [opError, setOpError] = useState('');

  const load = async () => {
    try {
      const data = await api.listComplianceLog(debtId);
      setEvents(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
  };

  useEffect(() => { load(); }, [debtId]);

  const handleSave = async () => {
    if (!form.event_date) return;
    setSaving(true);
    try {
      if (editingId) {
        await api.update('debt_compliance_log', editingId, form);
      } else {
        await api.saveComplianceEvent({ debt_id: debtId, ...form });
      }
      setShowForm(false);
      setEditingId(null);
      setForm(defaultForm);
      await load();
      onRefresh?.();
      setOpSuccess(editingId ? 'Event updated' : 'Event logged'); setTimeout(() => setOpSuccess(''), 3000);
    } catch (err: any) {
      console.error('Failed to save compliance event:', err);
      setOpError('Failed to save: ' + (err?.message || 'Unknown error')); setTimeout(() => setOpError(''), 5000);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (ev: any) => {
    setEditingId(ev.id);
    setForm({
      event_type: ev.event_type,
      event_date: ev.event_date || '',
      notes: ev.notes || '',
    });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this compliance event?')) return;
    try {
      await api.remove('debt_compliance_log', id);
      await load();
      onRefresh?.();
      setOpSuccess('Event deleted'); setTimeout(() => setOpSuccess(''), 3000);
    } catch (err: any) {
      console.error('Failed to delete compliance event:', err);
      setOpError('Failed to delete: ' + (err?.message || 'Unknown error')); setTimeout(() => setOpError(''), 5000);
    }
  };

  const hasCeaseDesist = events.some(e => e.event_type === 'cease_desist_received');

  return (
    <div className="block-card p-5 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck size={15} className="text-accent-blue" />
          <h4 className="text-sm font-semibold text-text-primary">FDCPA Compliance Log</h4>
        </div>
        <button
          className="block-btn flex items-center gap-1.5 text-xs py-1 px-3"
          onClick={() => setShowForm(s => !s)}
        >
          <Plus size={12} />
          Log Event
        </button>
      </div>

      {opSuccess && <div className="text-xs text-accent-income bg-accent-income/10 px-3 py-2 border border-accent-income/20 mb-3" style={{ borderRadius: '6px' }}>{opSuccess}</div>}
      {opError && <div className="text-xs text-accent-expense bg-accent-expense/10 px-3 py-2 border border-accent-expense/20 mb-3" style={{ borderRadius: '6px' }}>{opError}</div>}

      {hasCeaseDesist && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid #ef4444',
            borderRadius: 6,
            marginBottom: 12,
          }}
        >
          <AlertTriangle size={14} color="#ef4444" />
          <span style={{ fontSize: 12, color: '#ef4444', fontWeight: 600 }}>
            Cease &amp; Desist received — communications restricted
          </span>
        </div>
      )}

      {showForm && (
        <div className="grid grid-cols-2 gap-3 mb-4 p-4 bg-bg-tertiary" style={{ borderRadius: 6 }}>
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
              Event Type
            </label>
            <select
              className="block-select"
              value={form.event_type}
              onChange={e => setForm(p => ({ ...p, event_type: e.target.value }))}
            >
              {Object.entries(EVENT_LABELS)
                .sort(([, a], [, b]) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base' }))
                .map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
              Event Date
            </label>
            <input
              type="date"
              className="block-input"
              value={form.event_date}
              onChange={e => setForm(p => ({ ...p, event_date: e.target.value }))}
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
              Notes
            </label>
            <input
              className="block-input"
              placeholder="Additional details..."
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
              {saving ? 'Saving...' : 'Log Event'}
            </button>
          </div>
        </div>
      )}

      {events.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
          No compliance events logged.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {events.map(ev => (
            <div
              key={ev.id}
              style={{
                display: 'flex',
                gap: 10,
                padding: '8px 10px',
                background: 'var(--color-bg-tertiary)',
                borderRadius: 6,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--color-text-muted)',
                  whiteSpace: 'nowrap',
                  minWidth: 80,
                }}
              >
                {ev.event_date}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                  {EVENT_LABELS[ev.event_type] || ev.event_type}
                </div>
                {ev.notes && (
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                    {ev.notes}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
                <button
                  className="block-btn text-xs px-1.5 py-0.5"
                  onClick={() => handleEdit(ev)}
                  title="Edit event"
                >
                  <Pencil size={10} />
                </button>
                <button
                  className="block-btn text-xs px-1.5 py-0.5 text-accent-expense hover:bg-accent-expense/10 transition-colors"
                  onClick={() => handleDelete(ev.id)}
                  title="Delete event"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ComplianceLog;
