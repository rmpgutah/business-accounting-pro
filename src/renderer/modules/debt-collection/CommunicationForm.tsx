import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import api from '../../lib/api';

// ─── Types ──────────────────────────────────────────────
interface CommunicationFormData {
  type: string;
  direction: string;
  subject: string;
  body: string;
  outcome: string;
  next_action: string;
  next_action_date: string;
  contact_id: string;
  logged_at: string;
}

interface Contact {
  id: string;
  name: string;
  role: string;
}

interface CommunicationFormProps {
  debtId: string;
  editId?: string;
  onClose: () => void;
  onSaved: () => void;
}

function currentDatetimeLocal(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

const emptyForm: CommunicationFormData = {
  type: 'phone',
  direction: 'outbound',
  subject: '',
  body: '',
  outcome: '',
  next_action: '',
  next_action_date: '',
  contact_id: '',
  logged_at: currentDatetimeLocal(),
};

// ─── Component ──────────────────────────────────────────
const CommunicationForm: React.FC<CommunicationFormProps> = ({ debtId, editId, onClose, onSaved }) => {
  const [form, setForm] = useState<CommunicationFormData>({ ...emptyForm });
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(!!editId);

  useEffect(() => {
    let cancelled = false;
    const loadContacts = async () => {
      try {
        const rows = await api.query('debt_contacts', { debt_id: debtId });
        if (!cancelled && Array.isArray(rows)) {
          setContacts(rows as Contact[]);
        }
      } catch (err) {
        console.error('Failed to load contacts:', err);
      }
    };
    loadContacts();
    return () => { cancelled = true; };
  }, [debtId]);

  // Load existing record for edit
  useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const row = await api.get('debt_communications', editId);
        if (row && !cancelled) {
          const loggedAt = row.logged_at
            ? row.logged_at.replace(' ', 'T').slice(0, 16)
            : currentDatetimeLocal();
          setForm({
            type: row.type || 'phone',
            direction: row.direction || 'outbound',
            subject: row.subject || '',
            body: row.body || '',
            outcome: row.outcome || '',
            next_action: row.next_action || '',
            next_action_date: row.next_action_date ? row.next_action_date.slice(0, 10) : '',
            contact_id: row.contact_id || '',
            logged_at: loggedAt,
          });
        }
      } catch (err) {
        console.error('Failed to load communication:', err);
      } finally {
        if (!cancelled) setLoadingEdit(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [editId]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);

    const payload = {
      debt_id: debtId,
      type: form.type,
      direction: form.direction,
      subject: form.subject || null,
      body: form.body || null,
      outcome: form.outcome || null,
      next_action: form.next_action || null,
      next_action_date: form.next_action_date || null,
      contact_id: form.contact_id || null,
      logged_at: form.logged_at
        ? new Date(form.logged_at).toISOString()
        : new Date().toISOString(),
      logged_by: '',
    };

    try {
      if (editId) {
        await api.update('debt_communications', editId, payload);
      } else {
        await api.create('debt_communications', payload);
      }
      onSaved();
    } catch (err: any) {
      console.error('Failed to save communication:', err);
      alert('Failed to save communication: ' + (err?.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/60 z-40"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="block-card-elevated w-full max-w-[600px] max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-5 pb-4 border-b border-border-primary">
            <h3 className="text-base font-bold text-text-primary">
              {editId ? 'Edit Communication' : 'Log Communication'}
            </h3>
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors"
              style={{ borderRadius: '6px' }}
            >
              <X size={16} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Type & Direction — 2-column */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Type
                </label>
                <select
                  name="type"
                  className="block-select"
                  value={form.type}
                  onChange={handleChange}
                >
                  <option value="email">Email</option>
                  <option value="phone">Phone</option>
                  <option value="letter">Letter</option>
                  <option value="in_person">In Person</option>
                  <option value="legal_filing">Legal Filing</option>
                  <option value="text">Text</option>
                  <option value="fax">Fax</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Direction
                </label>
                <select
                  name="direction"
                  className="block-select"
                  value={form.direction}
                  onChange={handleChange}
                >
                  <option value="inbound">Inbound</option>
                  <option value="outbound">Outbound</option>
                </select>
              </div>
            </div>

            {/* Subject — full-width */}
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Subject
              </label>
              <input
                type="text"
                name="subject"
                className="block-input"
                placeholder="Communication subject"
                value={form.subject}
                onChange={handleChange}
              />
            </div>

            {/* Body — full-width */}
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Body
              </label>
              <textarea
                name="body"
                className="block-input"
                rows={6}
                placeholder="Communication details..."
                value={form.body}
                onChange={handleChange}
                style={{ resize: 'vertical' }}
              />
            </div>

            {/* Outcome, Next Action, Next Action Date — 3 fields */}
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Outcome
              </label>
              <select
                name="outcome"
                className="block-select w-full"
                value={form.outcome}
                onChange={handleChange}
              >
                <option value="">— None —</option>
                <option value="answered">Answered</option>
                <option value="voicemail">Left Voicemail</option>
                <option value="no_answer">No Answer</option>
                <option value="disputed">Disputed</option>
                <option value="promise_to_pay">Promise to Pay</option>
                <option value="refused">Refused to Pay</option>
                <option value="payment_received">Payment Received</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Next Action
              </label>
              <input
                type="text"
                name="next_action"
                className="block-input"
                placeholder="e.g. Follow up call"
                value={form.next_action}
                onChange={handleChange}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Next Action Date
              </label>
              <input
                type="date"
                name="next_action_date"
                className="block-input"
                value={form.next_action_date}
                onChange={handleChange}
              />
            </div>

            {/* Contact & Logged At — 2-column */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Contact
                </label>
                <select
                  name="contact_id"
                  className="block-select"
                  value={form.contact_id}
                  onChange={handleChange}
                >
                  <option value="">-- Select Contact --</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.role ? ` (${c.role.charAt(0).toUpperCase() + c.role.slice(1)})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Logged At
                </label>
                <input
                  type="datetime-local"
                  name="logged_at"
                  className="block-input"
                  value={form.logged_at}
                  onChange={handleChange}
                />
              </div>
            </div>

            {/* Footer Actions */}
            <div className="flex justify-end gap-3 pt-4 border-t border-border-primary">
              <button type="button" className="block-btn" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className="block-btn-primary"
                disabled={saving}
              >
                {saving ? 'Saving...' : editId ? 'Update' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
};

export default CommunicationForm;
