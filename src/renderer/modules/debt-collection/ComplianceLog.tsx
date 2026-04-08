import React, { useEffect, useState } from 'react';
import { ShieldCheck, Plus, AlertTriangle } from 'lucide-react';
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
}

const ComplianceLog: React.FC<Props> = ({ debtId }) => {
  const [events, setEvents] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    event_type: 'validation_notice_sent',
    event_date: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

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
      await api.saveComplianceEvent({ debt_id: debtId, ...form });
      setShowForm(false);
      setForm({ event_type: 'validation_notice_sent', event_date: '', notes: '' });
      await load();
    } catch (err) {
      console.error('Failed to save compliance event:', err);
    } finally {
      setSaving(false);
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
              {Object.entries(EVENT_LABELS).map(([k, v]) => (
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
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                  {EVENT_LABELS[ev.event_type] || ev.event_type}
                </div>
                {ev.notes && (
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                    {ev.notes}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ComplianceLog;
