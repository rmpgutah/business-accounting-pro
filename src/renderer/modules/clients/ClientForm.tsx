import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import api from '../../lib/api';
import ClientContacts, { ClientContact } from './ClientContacts';

// ─── Types ──────────────────────────────────────────────
interface ClientData {
  id?: string;
  name: string;
  type: 'individual' | 'company';
  email: string;
  phone: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  payment_terms: number;
  tax_id: string;
  status: 'active' | 'inactive' | 'prospect';
  notes: string;
  // Extended profile
  industry: string;
  website: string;
  company_size: string;
  credit_limit: number;
  preferred_payment_method: string;
  assigned_rep_id: string;
  internal_notes: string;
  tags: string;
  tags_input: string;
}

const EMPTY_CLIENT: ClientData = {
  name: '',
  type: 'individual',
  email: '',
  phone: '',
  address_line1: '',
  address_line2: '',
  city: '',
  state: '',
  zip: '',
  country: 'US',
  payment_terms: 30,
  tax_id: '',
  status: 'active',
  notes: '',
  // Extended profile
  industry: '',
  website: '',
  company_size: '',
  credit_limit: 0,
  preferred_payment_method: '',
  assigned_rep_id: '',
  internal_notes: '',
  tags: '',
  tags_input: '',
};

interface ClientFormProps {
  clientId?: string | null;
  onClose: () => void;
  onSaved: () => void;
}

// ─── Field Helper (must be outside component to avoid remount) ──
const Field: React.FC<{
  label: string;
  children: React.ReactNode;
  span?: 1 | 2;
}> = ({ label, children, span = 1 }) => (
  <div className={span === 2 ? 'col-span-2' : ''}>
    <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
      {label}
    </label>
    {children}
  </div>
);

// ─── Component ──────────────────────────────────────────
const ClientForm: React.FC<ClientFormProps> = ({ clientId, onClose, onSaved }) => {
  const [data, setData] = useState<ClientData>({ ...EMPTY_CLIENT });
  const [paymentTermsRaw, setPaymentTermsRaw] = useState<string>(String(EMPTY_CLIENT.payment_terms));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contacts, setContacts] = useState<ClientContact[]>([]);

  const isEditing = Boolean(clientId);

  // ─── Load Existing Client ───────────────────────────
  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const [client, contactData] = await Promise.all([
          api.get('clients', clientId),
          api.listClientContacts(clientId),
        ]);
        if (!cancelled && client) {
          const pt = client.payment_terms ?? 30;
          // Parse tags JSON array → comma-separated string
          let tagsInput = '';
          if (client.tags) {
            try {
              const parsed = JSON.parse(client.tags);
              tagsInput = Array.isArray(parsed) ? parsed.join(', ') : '';
            } catch {
              tagsInput = '';
            }
          }
          setData({
            id: client.id,
            name: client.name ?? '',
            type: client.type ?? 'individual',
            email: client.email ?? '',
            phone: client.phone ?? '',
            address_line1: client.address_line1 ?? '',
            address_line2: client.address_line2 ?? '',
            city: client.city ?? '',
            state: client.state ?? '',
            zip: client.zip ?? '',
            country: client.country ?? 'US',
            payment_terms: pt,
            tax_id: client.tax_id ?? '',
            status: client.status ?? 'active',
            notes: client.notes ?? '',
            // Extended profile
            industry: client.industry ?? '',
            website: client.website ?? '',
            company_size: client.company_size ?? '',
            credit_limit: client.credit_limit ?? 0,
            preferred_payment_method: client.preferred_payment_method ?? '',
            assigned_rep_id: client.assigned_rep_id ?? '',
            internal_notes: client.internal_notes ?? '',
            tags: client.tags ?? '',
            tags_input: tagsInput,
          });
          setPaymentTermsRaw(String(pt));
          setContacts((contactData ?? []).map((c: any) => ({ ...c, is_primary: Boolean(c.is_primary) })));
        }
      } catch (err) {
        console.error('Failed to load client:', err);
        if (!cancelled) setError('Failed to load client data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [clientId]);

  // ─── Field Updater ─────────────────────────────────
  const set = <K extends keyof ClientData>(field: K, value: ClientData[K]) => {
    setData((prev) => ({ ...prev, [field]: value }));
  };

  // ─── Save ──────────────────────────────────────────
  const handleSave = async () => {
    if (!data.name.trim()) {
      setError('Client name is required.');
      return;
    }

    const parsedTerms = parseInt(paymentTermsRaw, 10);
    if (isNaN(parsedTerms) || parsedTerms < 0) {
      setError('Payment terms must be a non-negative whole number.');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      // Convert tags_input (comma-separated) → JSON array string
      const tagsJson = JSON.stringify(
        data.tags_input.split(',').map(t => t.trim()).filter(Boolean)
      );

      const payload: Record<string, any> = {
        ...data,
        payment_terms: parsedTerms,
        tags: tagsJson,
      };
      delete payload.id;
      delete payload.tags_input;

      let savedId: string;
      if (isEditing && clientId) {
        await api.update('clients', clientId, payload);
        savedId = clientId;
      } else {
        const created = await api.create('clients', payload);
        savedId = created.id;
      }

      await api.saveClientContacts(savedId, contacts.map(c => ({ ...c, client_id: savedId })));

      onSaved();
    } catch (err) {
      console.error('Failed to save client:', err);
      setError('Failed to save client. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // ─── Render ─────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="block-card-elevated w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        style={{ borderRadius: '6px' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-text-primary">
            {isEditing ? 'Edit Client' : 'New Client'}
          </h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors p-1"
          >
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-text-muted font-mono">Loading...</div>
        ) : (
          <>
            {/* Error Banner */}
            {error && (
              <div
                className="mb-4 p-3 text-sm text-accent-expense bg-accent-expense-bg border border-accent-expense/20"
                style={{ borderRadius: '6px' }}
              >
                {error}
              </div>
            )}

            {/* Form Grid */}
            <div className="grid grid-cols-2 gap-4">
              <Field label="Client Name" span={2}>
                <input
                  className="block-input"
                  placeholder="Enter client name"
                  value={data.name}
                  onChange={(e) => set('name', e.target.value)}
                />
              </Field>

              <Field label="Type">
                <select
                  className="block-select"
                  value={data.type}
                  onChange={(e) => set('type', e.target.value as ClientData['type'])}
                >
                  <option value="individual">Individual</option>
                  <option value="company">Company</option>
                </select>
              </Field>

              <Field label="Status">
                <select
                  className="block-select"
                  value={data.status}
                  onChange={(e) => set('status', e.target.value as ClientData['status'])}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="prospect">Prospect</option>
                </select>
              </Field>

              <Field label="Email">
                <input
                  className="block-input"
                  type="email"
                  placeholder="email@example.com"
                  value={data.email}
                  onChange={(e) => set('email', e.target.value)}
                />
              </Field>

              <Field label="Phone">
                <input
                  className="block-input"
                  type="tel"
                  placeholder="(555) 000-0000"
                  value={data.phone}
                  onChange={(e) => set('phone', e.target.value)}
                />
              </Field>

              <Field label="Address Line 1" span={2}>
                <input
                  className="block-input"
                  placeholder="Street address"
                  value={data.address_line1}
                  onChange={(e) => set('address_line1', e.target.value)}
                />
              </Field>

              <Field label="Address Line 2" span={2}>
                <input
                  className="block-input"
                  placeholder="Apt, suite, unit, etc."
                  value={data.address_line2}
                  onChange={(e) => set('address_line2', e.target.value)}
                />
              </Field>

              <Field label="City">
                <input
                  className="block-input"
                  placeholder="City"
                  value={data.city}
                  onChange={(e) => set('city', e.target.value)}
                />
              </Field>

              <Field label="State">
                <input
                  className="block-input"
                  placeholder="State"
                  value={data.state}
                  onChange={(e) => set('state', e.target.value)}
                />
              </Field>

              <Field label="ZIP Code">
                <input
                  className="block-input"
                  placeholder="00000"
                  value={data.zip}
                  onChange={(e) => set('zip', e.target.value)}
                />
              </Field>

              <Field label="Country">
                <input
                  className="block-input"
                  placeholder="US"
                  value={data.country}
                  onChange={(e) => set('country', e.target.value)}
                />
              </Field>

              <Field label="Payment Terms (days)">
                <input
                  className="block-input"
                  type="number"
                  min={0}
                  value={paymentTermsRaw}
                  onChange={(e) => setPaymentTermsRaw(e.target.value)}
                />
              </Field>

              <Field label="Tax ID">
                <input
                  className="block-input"
                  placeholder="Tax identification number"
                  value={data.tax_id}
                  onChange={(e) => set('tax_id', e.target.value)}
                />
              </Field>

              <Field label="Notes" span={2}>
                <textarea
                  className="block-input"
                  rows={3}
                  placeholder="Additional notes..."
                  value={data.notes}
                  onChange={(e) => set('notes', e.target.value)}
                  style={{ resize: 'vertical' }}
                />
              </Field>

              {/* Extended Profile */}
              <div className="col-span-2 mt-4">
                <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Extended Profile</div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Industry</label>
                <input className="block-input" value={data.industry} onChange={(e) => setData(p => ({ ...p, industry: e.target.value }))} placeholder="e.g. Technology" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Website</label>
                <input className="block-input" type="url" value={data.website} onChange={(e) => setData(p => ({ ...p, website: e.target.value }))} placeholder="https://" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Company Size</label>
                <select className="block-select w-full" value={data.company_size} onChange={(e) => setData(p => ({ ...p, company_size: e.target.value }))}>
                  <option value="">— Select —</option>
                  <option value="1-10">1–10 employees</option>
                  <option value="11-50">11–50 employees</option>
                  <option value="51-200">51–200 employees</option>
                  <option value="201-1000">201–1,000 employees</option>
                  <option value="1000+">1,000+ employees</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Credit Limit</label>
                <input className="block-input" type="number" min={0} step="100" value={data.credit_limit} onChange={(e) => setData(p => ({ ...p, credit_limit: parseFloat(e.target.value) || 0 }))} placeholder="0.00" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Preferred Payment</label>
                <select className="block-select w-full" value={data.preferred_payment_method} onChange={(e) => setData(p => ({ ...p, preferred_payment_method: e.target.value }))}>
                  <option value="">— Select —</option>
                  <option value="check">Check</option>
                  <option value="ach">ACH / Bank Transfer</option>
                  <option value="credit_card">Credit Card</option>
                  <option value="wire">Wire Transfer</option>
                  <option value="cash">Cash</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Tags (comma-separated)</label>
                <input className="block-input" value={data.tags_input || ''} onChange={(e) => setData(p => ({ ...p, tags_input: e.target.value }))} placeholder="vip, partner, net-30" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">Internal Notes</label>
                <textarea className="block-input" rows={3} value={data.internal_notes} onChange={(e) => setData(p => ({ ...p, internal_notes: e.target.value }))} placeholder="Internal notes (not visible to client)..." style={{ resize: 'vertical' }} />
              </div>

              {/* Contacts */}
              <div className="col-span-2 mt-4">
                <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Contacts</div>
                <ClientContacts contacts={contacts} onChange={setContacts} />
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-border-primary">
              <button className="block-btn" onClick={onClose}>
                Cancel
              </button>
              <button
                className="block-btn-primary inline-flex items-center gap-1.5"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? 'Saving...' : isEditing ? 'Update Client' : 'Create Client'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ClientForm;
