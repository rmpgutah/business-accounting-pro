import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import api from '../../lib/api';

// ─── Types ──────────────────────────────────────────────
interface ContactFormData {
  role: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  company: string;
  bar_number: string;
  notes: string;
}

interface ContactFormProps {
  debtId: string;
  contactId?: string | null;
  onClose: () => void;
  onSaved: () => void;
}

const emptyForm: ContactFormData = {
  role: 'debtor',
  name: '',
  email: '',
  phone: '',
  address: '',
  company: '',
  bar_number: '',
  notes: '',
};

// ─── Component ──────────────────────────────────────────
const ContactForm: React.FC<ContactFormProps> = ({ debtId, contactId, onClose, onSaved }) => {
  const [form, setForm] = useState<ContactFormData>({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!!contactId);

  // ── Load existing record for edit ──
  useEffect(() => {
    if (!contactId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const row = await api.get('debt_contacts', contactId);
        if (row && !cancelled) {
          setForm({
            role: row.role || 'debtor',
            name: row.name || '',
            email: row.email || '',
            phone: row.phone || '',
            address: row.address || '',
            company: row.company || '',
            bar_number: row.bar_number || '',
            notes: row.notes || '',
          });
        }
      } catch (err) {
        console.error('Failed to load contact:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [contactId]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || !form.name.trim()) return;
    setSaving(true);

    const payload: Record<string, any> = {
      debt_id: debtId,
      role: form.role,
      name: form.name.trim(),
      email: form.email || null,
      phone: form.phone || null,
      address: form.address || null,
      company: form.company || null,
      notes: form.notes || null,
    };

    // Only include bar_number when role is attorney
    if (form.role === 'attorney') {
      payload.bar_number = form.bar_number || null;
    } else {
      payload.bar_number = null;
    }

    try {
      if (contactId) {
        await api.update('debt_contacts', contactId, payload);
      } else {
        await api.create('debt_contacts', payload);
      }
      onSaved();
    } catch (err) {
      console.error('Failed to save contact:', err);
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
        role="presentation"
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="block-card-elevated w-full max-w-[600px] max-h-[90vh] overflow-y-auto cursor-pointer"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-5 pb-4 border-b border-border-primary">
            <h3 className="text-base font-bold text-text-primary">
              {contactId ? 'Edit Contact' : 'Add Contact'}
            </h3>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center text-text-muted hover:text-text-primary transition-colors"
              style={{ borderRadius: '6px' }}
            >
              <X size={16} />
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-text-muted text-sm">
              Loading...
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Role & Company — 2-column */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                    Role
                  </label>
                  <select
                    name="role"
                    className="block-select"
                    value={form.role}
                    onChange={handleChange}
                  >
                    <option value="debtor">Debtor</option>
                    <option value="guarantor">Guarantor</option>
                    <option value="attorney">Attorney</option>
                    <option value="witness">Witness</option>
                    <option value="collections_agent">Collections Agent</option>
                    <option value="judge">Judge</option>
                    <option value="mediator">Mediator</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                    Company
                  </label>
                  <input
                    type="text"
                    name="company"
                    autoComplete="organization"
                    className="block-input"
                    placeholder="Company / Firm"
                    value={form.company}
                    onChange={handleChange}
                  />
                </div>
              </div>

              {/* Name — full-width */}
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Name <span className="text-accent-expense">*</span>
                </label>
                <input
                  type="text"
                  name="name"
                  autoComplete="name"
                  className="block-input"
                  placeholder="Full name"
                  value={form.name}
                  onChange={handleChange}
                  autoFocus
                />
              </div>

              {/* Email & Phone — 2-column */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                    Email
                  </label>
                  <input
                    type="email"
                    name="email"
                    autoComplete="email"
                    className="block-input"
                    placeholder="email@example.com"
                    value={form.email}
                    onChange={handleChange}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                    Phone
                  </label>
                  <input
                    type="tel"
                    name="phone"
                    autoComplete="tel"
                    className="block-input"
                    placeholder="(555) 555-5555"
                    value={form.phone}
                    onChange={handleChange}
                  />
                </div>
              </div>

              {/* Bar Number — only for attorneys */}
              {form.role === 'attorney' && (
                <div>
                  <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                    Bar Number
                  </label>
                  <input
                    type="text"
                    name="bar_number"
                    className="block-input"
                    placeholder="State bar number"
                    value={form.bar_number}
                    onChange={handleChange}
                  />
                </div>
              )}

              {/* Address */}
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Address
                </label>
                <textarea
                  name="address"
                  className="block-input"
                  rows={2}
                  placeholder="Street address, City, State ZIP"
                  value={form.address}
                  onChange={handleChange}
                  style={{ resize: 'vertical' }}
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Notes
                </label>
                <textarea
                  name="notes"
                  className="block-input"
                  rows={3}
                  placeholder="Additional notes..."
                  value={form.notes}
                  onChange={handleChange}
                  style={{ resize: 'vertical' }}
                />
              </div>

              {/* Footer Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t border-border-primary">
                <button type="button" className="block-btn" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="block-btn-primary"
                  disabled={saving || !form.name.trim()}
                >
                  {saving ? 'Saving...' : contactId ? 'Update' : 'Save'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
};

export default ContactForm;
