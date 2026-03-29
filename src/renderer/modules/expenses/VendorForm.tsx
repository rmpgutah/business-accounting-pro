import React, { useEffect, useState } from 'react';
import { Building2 } from 'lucide-react';
import api from '../../lib/api';

// ─── Types ──────────────────────────────────────────────
interface VendorFormData {
  name: string;
  email: string;
  phone: string;
  address: string;
  tax_id: string;
  payment_terms: string;
  notes: string;
  status: string;
}

interface VendorFormProps {
  vendorId?: string | null;
  onClose: () => void;
  onSaved: () => void;
}

const emptyForm: VendorFormData = {
  name: '',
  email: '',
  phone: '',
  address: '',
  tax_id: '',
  payment_terms: '',
  notes: '',
  status: 'active',
};

// ─── Component ──────────────────────────────────────────
const VendorForm: React.FC<VendorFormProps> = ({ vendorId, onClose, onSaved }) => {
  const [form, setForm] = useState<VendorFormData>({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!!vendorId);

  const isEditing = !!vendorId;

  useEffect(() => {
    if (!vendorId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const data = await api.get('vendors', vendorId);
        if (data && !cancelled) {
          setForm({
            name: data.name || '',
            email: data.email || '',
            phone: data.phone || '',
            address: data.address || '',
            tax_id: data.tax_id || '',
            payment_terms: data.payment_terms || '',
            notes: data.notes || '',
            status: data.status || 'active',
          });
        }
      } catch (err) {
        console.error('Failed to load vendor:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [vendorId]);

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

    try {
      const payload: Record<string, any> = {
        name: form.name,
        email: form.email || null,
        phone: form.phone || null,
        address: form.address || null,
        tax_id: form.tax_id || null,
        payment_terms: form.payment_terms || null,
        notes: form.notes || null,
        status: form.status,
      };

      if (isEditing && vendorId) {
        await api.update('vendors', vendorId, payload);
      } else {
        await api.create('vendors', payload);
      }
      onSaved();
    } catch (err) {
      console.error('Failed to save vendor:', err);
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
          className="block-card-elevated w-full max-w-lg max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal Header */}
          <div className="flex items-center gap-3 mb-5 pb-4 border-b border-border-primary">
            <div
              className="w-8 h-8 flex items-center justify-center bg-bg-tertiary border border-border-primary"
              style={{ borderRadius: '2px' }}
            >
              <Building2 size={16} className="text-accent-purple" />
            </div>
            <h3 className="text-base font-bold text-text-primary">
              {isEditing ? 'Edit Vendor' : 'New Vendor'}
            </h3>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-text-muted text-sm">
              Loading...
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Name <span className="text-accent-expense">*</span>
                </label>
                <input
                  type="text"
                  name="name"
                  className="block-input"
                  placeholder="Vendor name"
                  value={form.name}
                  onChange={handleChange}
                  required
                  autoFocus
                />
              </div>

              {/* Email & Phone */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                    Email
                  </label>
                  <input
                    type="email"
                    name="email"
                    className="block-input"
                    placeholder="vendor@email.com"
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
                    className="block-input"
                    placeholder="(555) 000-0000"
                    value={form.phone}
                    onChange={handleChange}
                  />
                </div>
              </div>

              {/* Address */}
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Address
                </label>
                <textarea
                  name="address"
                  className="block-input"
                  rows={3}
                  placeholder="Street, City, State, ZIP"
                  value={form.address}
                  onChange={handleChange}
                  style={{ resize: 'vertical' }}
                />
              </div>

              {/* Tax ID & Payment Terms */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                    Tax ID / EIN
                  </label>
                  <input
                    type="text"
                    name="tax_id"
                    className="block-input"
                    placeholder="XX-XXXXXXX"
                    value={form.tax_id}
                    onChange={handleChange}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                    Payment Terms
                  </label>
                  <input
                    type="text"
                    name="payment_terms"
                    className="block-input"
                    placeholder="e.g. Net 30"
                    value={form.payment_terms}
                    onChange={handleChange}
                  />
                </div>
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

              {/* Status */}
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Status
                </label>
                <select
                  name="status"
                  className="block-select"
                  value={form.status}
                  onChange={handleChange}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="blocked">Blocked</option>
                </select>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t border-border-primary">
                <button type="button" className="block-btn" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="block-btn-primary"
                  disabled={saving}
                >
                  {saving ? 'Saving...' : isEditing ? 'Update Vendor' : 'Create Vendor'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
};

export default VendorForm;
