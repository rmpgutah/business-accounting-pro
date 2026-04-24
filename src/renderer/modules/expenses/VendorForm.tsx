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
  w9_status: 'not_collected' | 'collected' | 'on_file';
  is_1099_eligible: boolean;
  ach_routing: string;
  ach_account: string;
  ach_account_type: 'checking' | 'savings';
  contract_start: string;
  contract_end: string;
  contract_notes: string;
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
  w9_status: 'not_collected',
  is_1099_eligible: false,
  ach_routing: '',
  ach_account: '',
  ach_account_type: 'checking',
  contract_start: '',
  contract_end: '',
  contract_notes: '',
};

// ─── Component ──────────────────────────────────────────
const VendorForm: React.FC<VendorFormProps> = ({ vendorId, onClose, onSaved }) => {
  const [form, setForm] = useState<VendorFormData>({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!!vendorId);
  const [nameError, setNameError] = useState('');

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
            payment_terms: data.payment_terms != null ? String(data.payment_terms) : '',
            notes: data.notes || '',
            status: data.status || 'active',
            w9_status: data.w9_status ?? 'not_collected',
            is_1099_eligible: Boolean(data.is_1099_eligible),
            ach_routing: data.ach_routing ?? '',
            ach_account: data.ach_account ?? '',
            ach_account_type: data.ach_account_type ?? 'checking',
            contract_start: data.contract_start ?? '',
            contract_end: data.contract_end ?? '',
            contract_notes: data.contract_notes ?? '',
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

    if (!form.name.trim()) {
      setNameError('Vendor name is required.');
      return;
    }
    setNameError('');
    setSaving(true);

    try {
      const payload: Record<string, any> = {
        name: form.name.trim(),
        email: form.email || null,
        phone: form.phone || null,
        address: form.address || null,
        tax_id: form.tax_id || null,
        payment_terms: form.payment_terms ? (parseInt(form.payment_terms, 10) || 0) : 0,
        notes: form.notes || null,
        status: form.status,
        w9_status: form.w9_status,
        is_1099_eligible: form.is_1099_eligible ? 1 : 0,
        ach_routing: form.ach_routing || null,
        ach_account: form.ach_account || null,
        ach_account_type: form.ach_account_type,
        contract_start: form.contract_start || null,
        contract_end: form.contract_end || null,
        contract_notes: form.contract_notes || null,
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
              style={{ borderRadius: '6px' }}
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
                  autoComplete="organization"
                  className="block-input"
                  placeholder="Vendor name"
                  value={form.name}
                  onChange={(e) => {
                    handleChange(e);
                    if (nameError) setNameError('');
                  }}
                  autoFocus
                />
                {nameError && (
                  <p className="mt-1 text-xs text-accent-expense">{nameError}</p>
                )}
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
                    autoComplete="email"
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
                    autoComplete="tel"
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
                    autoComplete="off"
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
                    placeholder="e.g. 30"
                    type="number"
                    min={0}
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
                </select>
              </div>

              {/* Compliance */}
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 mt-4">
                  <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Compliance</div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">W-9 Status</label>
                  <select className="block-select w-full" value={form.w9_status} onChange={(e) => setForm(p => ({ ...p, w9_status: e.target.value as any }))}>
                    <option value="not_collected">Not Collected</option>
                    <option value="collected">Collected</option>
                    <option value="on_file">On File</option>
                  </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 24 }}>
                  <input
                    type="checkbox"
                    id="is_1099_eligible"
                    checked={form.is_1099_eligible}
                    onChange={(e) => setForm(p => ({ ...p, is_1099_eligible: e.target.checked }))}
                    style={{ width: 16, height: 16 }}
                  />
                  <label htmlFor="is_1099_eligible" className="text-sm" style={{ color: 'var(--color-text-primary)', cursor: 'pointer' }}>
                    1099 Eligible
                  </label>
                </div>
              </div>

              {/* ACH Banking */}
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 mt-4">
                  <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">ACH / Banking</div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Routing Number</label>
                  <input className="block-input font-mono" name="ach_routing" autoComplete="off" value={form.ach_routing} onChange={(e) => setForm(p => ({ ...p, ach_routing: e.target.value }))} placeholder="9 digits" maxLength={9} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Account Number</label>
                  <input className="block-input font-mono" name="ach_account" autoComplete="off" value={form.ach_account} onChange={(e) => setForm(p => ({ ...p, ach_account: e.target.value }))} placeholder="Account number" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Account Type</label>
                  <select className="block-select w-full" value={form.ach_account_type} onChange={(e) => setForm(p => ({ ...p, ach_account_type: e.target.value as any }))}>
                    <option value="checking">Checking</option>
                    <option value="savings">Savings</option>
                  </select>
                </div>
              </div>

              {/* Contract */}
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 mt-4">
                  <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Contract</div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Contract Start</label>
                  <input type="date" className="block-input" value={form.contract_start} onChange={(e) => setForm(p => ({ ...p, contract_start: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Contract End</label>
                  <input type="date" className="block-input" value={form.contract_end} onChange={(e) => setForm(p => ({ ...p, contract_end: e.target.value }))} />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Contract Notes</label>
                  <textarea className="block-input" rows={3} value={form.contract_notes} onChange={(e) => setForm(p => ({ ...p, contract_notes: e.target.value }))} placeholder="Contract terms, renewal dates, etc." style={{ resize: 'vertical' }} />
                </div>
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
