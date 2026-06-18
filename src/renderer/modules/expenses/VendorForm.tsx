/**
 * VendorForm (Advanced Tabbed) — rewritten as a 6-tab modal that exposes
 * the rich vendor schema (40+ columns across w9, 1099, ACH, diversity,
 * approval, performance counters, plus new columns: multi-contact JSON,
 * multi-address JSON, COI tracking, default GL accounts, credit limit,
 * currency, website, business reg #, onboarding status, preferred method).
 *
 * Tabs:
 *   1. Identity      — name, type, status, website, registration, primary contact/address
 *   2. Contacts      — multi-contact list (CRUD + primary flag)
 *   3. Addresses     — additional addresses (billing/shipping/remit-to)
 *   4. Compliance    — W-9, 1099 box, tax ID, diversity, COI, approval status
 *   5. Banking       — ACH, preferred payment method, currency, credit limit, payment terms
 *   6. Posting       — default GL accounts (expense + AP) + performance metrics (read-only)
 *
 * Same API surface as the old form (vendorId, onClose, onSaved) so existing
 * callers don't need to change.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Building2, X, Plus, Trash2, User, MapPin, Shield, CreditCard, FileText, Activity } from 'lucide-react';
import api from '../../lib/api';
import ErrorBanner from '../../components/ErrorBanner';
import {
  VENDOR_TYPE, VENDOR_APPROVAL, VENDOR_1099_BOX, VENDOR_DIVERSITY, VENDOR_LOCATION,
  ClassificationSelect, ClassificationMultiSelect,
} from '../../lib/classifications';

// ─── Types ──────────────────────────────────────────────
interface VendorContact {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  is_primary: boolean;
}
interface VendorAddress {
  id: string;
  name: string;
  type: 'billing' | 'shipping' | 'remit' | 'physical';
  phone: string;
  email: string;
  is_primary: boolean;
  line1: string;
  line2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}
interface VendorFormData {
  // Identity
  name: string;
  vendor_type: string;
  status: string;
  website: string;
  business_registration_no: string;
  logo_data: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  // Contacts / addresses
  contacts: VendorContact[];
  additional_addresses: VendorAddress[];
  // Compliance
  tax_id: string;
  w9_status: 'not_collected' | 'collected' | 'on_file';
  is_1099_eligible: boolean;
  form_1099_box: string;
  diversity: string[];
  location_type: string;
  approval_status: string;
  onboarding_status: string;
  coi_expiry: string;
  coi_amount: string;
  // Banking
  ach_routing: string;
  ach_account: string;
  ach_account_type: 'checking' | 'savings';
  preferred_payment_method: string;
  currency: string;
  payment_terms: string;
  credit_limit: string;
  // Contract
  contract_start: string;
  contract_end: string;
  contract_notes: string;
  // Default posting
  default_expense_account_id: string;
  default_ap_account_id: string;
}

interface VendorFormProps {
  vendorId?: string | null;
  onClose: () => void;
  onSaved: () => void;
}

const newContact = (primary = false): VendorContact => ({ id: crypto.randomUUID(), name: '', role: '', email: '', phone: '', is_primary: primary });
const newAddress = (type: VendorAddress['type'] = 'billing'): VendorAddress => ({ id: crypto.randomUUID(), name: '', type, phone: '', email: '', is_primary: false, line1: '', line2: '', city: '', state: '', zip: '', country: 'US' });

const emptyForm: VendorFormData = {
  name: '', vendor_type: '', status: 'active', website: '', business_registration_no: '', logo_data: '',
  email: '', phone: '', address: '', notes: '',
  contacts: [], additional_addresses: [],
  tax_id: '', w9_status: 'not_collected', is_1099_eligible: false, form_1099_box: '',
  diversity: [], location_type: '', approval_status: 'approved', onboarding_status: 'in_progress',
  coi_expiry: '', coi_amount: '',
  ach_routing: '', ach_account: '', ach_account_type: 'checking',
  preferred_payment_method: '', currency: 'USD', payment_terms: '', credit_limit: '',
  contract_start: '', contract_end: '', contract_notes: '',
  default_expense_account_id: '', default_ap_account_id: '',
};

type TabKey = 'identity' | 'contacts' | 'addresses' | 'compliance' | 'banking' | 'posting';
const TABS: Array<{ key: TabKey; label: string; icon: any }> = [
  { key: 'identity', label: 'Identity', icon: Building2 },
  { key: 'contacts', label: 'Contacts', icon: User },
  { key: 'addresses', label: 'Addresses', icon: MapPin },
  { key: 'compliance', label: 'Compliance', icon: Shield },
  { key: 'banking', label: 'Banking', icon: CreditCard },
  { key: 'posting', label: 'Posting & Performance', icon: Activity },
];

// ─── Background removal ──────────────────────────────────
// Flood-fills from all 4 corners so only the *connected* background region is
// erased — interior white spaces (inside letters, white design elements) are
// left intact. Pixels near the tolerance boundary get a graduated alpha so
// edges don't look jagged. Always outputs PNG (JPEG has no alpha channel).
async function removeBackground(dataUrl: string): Promise<string> {
  if (dataUrl.startsWith('data:image/svg+xml')) return dataUrl; // SVGs are already transparent vectors

  return new Promise<string>((resolve) => {
    const img = new Image();
    img.onerror = () => resolve(dataUrl); // fallback: return original unchanged
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);

      const w = img.width, h = img.height;
      const imageData = ctx.getImageData(0, 0, w, h);
      const data = imageData.data;

      const px = (x: number, y: number) => (y * w + x) * 4;

      // Sample opaque corners to estimate the background color
      const cornerIdxs = [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)];
      const opaque = cornerIdxs.filter(i => data[i + 3] > 200);
      if (opaque.length === 0) { resolve(canvas.toDataURL('image/png')); return; }

      const bg = {
        r: Math.round(opaque.reduce((s, i) => s + data[i],     0) / opaque.length),
        g: Math.round(opaque.reduce((s, i) => s + data[i + 1], 0) / opaque.length),
        b: Math.round(opaque.reduce((s, i) => s + data[i + 2], 0) / opaque.length),
      };

      // Bail if corners are inconsistent (already transparent / complex bg)
      const variance = opaque.reduce((s, i) =>
        s + Math.abs(data[i] - bg.r) + Math.abs(data[i + 1] - bg.g) + Math.abs(data[i + 2] - bg.b), 0
      ) / opaque.length;
      if (variance > 30) { resolve(canvas.toDataURL('image/png')); return; }

      const TOLERANCE = 38;
      const colorDist = (i: number) => {
        const dr = data[i] - bg.r, dg = data[i + 1] - bg.g, db = data[i + 2] - bg.b;
        return Math.sqrt(dr * dr + dg * dg + db * db);
      };

      // BFS flood-fill from all 4 corners
      const visited = new Uint8Array(w * h);
      const queue: number[] = [];
      for (const ci of cornerIdxs) {
        const pixIdx = ci / 4;
        if (!visited[pixIdx] && data[ci + 3] > 200 && colorDist(ci) < TOLERANCE) {
          visited[pixIdx] = 1;
          queue.push(pixIdx);
        }
      }

      while (queue.length > 0) {
        const p = queue.pop()!;
        const i = p * 4;
        const dist = colorDist(i);
        // Soft fade near the tolerance boundary to avoid hard fringing
        data[i + 3] = dist < TOLERANCE * 0.55
          ? 0
          : Math.round(255 * ((dist - TOLERANCE * 0.55) / (TOLERANCE * 0.45)));

        const x = p % w, y = Math.floor(p / w);
        for (const n of [
          y > 0     ? p - w : -1,
          y < h - 1 ? p + w : -1,
          x > 0     ? p - 1 : -1,
          x < w - 1 ? p + 1 : -1,
        ]) {
          if (n < 0 || visited[n]) continue;
          const ni = n * 4;
          if (data[ni + 3] > 200 && colorDist(ni) < TOLERANCE) {
            visited[n] = 1;
            queue.push(n);
          }
        }
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.src = dataUrl;
  });
}

// ─── Component ──────────────────────────────────────────
const VendorForm: React.FC<VendorFormProps> = ({ vendorId, onClose, onSaved }) => {
  const [form, setForm] = useState<VendorFormData>({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!!vendorId);
  const [nameError, setNameError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [tab, setTab] = useState<TabKey>('identity');
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string; type: string }>>([]);
  const [perfData, setPerfData] = useState<any>(null);

  const isEditing = !!vendorId;

  // Load chart of accounts for the Posting tab pickers
  useEffect(() => {
    api.rawQuery(`SELECT id, name, type FROM accounts WHERE deleted_at IS NULL ORDER BY type, name`, [])
      .then((r: any) => { if (Array.isArray(r)) setAccounts(r); })
      .catch(() => {});
  }, []);

  // Load existing vendor
  useEffect(() => {
    if (!vendorId) return;
    let cancelled = false;
    (async () => {
      try {
        const [data, locRows]: [any, any[]] = await Promise.all([
          api.get('vendors', vendorId),
          api.vendorLocationsList(vendorId).catch(() => []),
        ]);
        if (data && !cancelled) {
          // Prefer relational vendor_locations table; fall back to JSON blob for old records.
          const addressesFromTable: VendorAddress[] = Array.isArray(locRows) && locRows.length > 0
            ? locRows.map((l: any) => ({
                id: l.id,
                name: l.name || '',
                type: (l.location_type || 'physical') as VendorAddress['type'],
                phone: l.phone || '',
                email: l.email || '',
                is_primary: !!l.is_primary,
                line1: l.address_line1 || '',
                line2: l.address_line2 || '',
                city: l.city || '',
                state: l.state || '',
                zip: l.zip || '',
                country: l.country || '',
              }))
            : parseJson(data.additional_addresses_json, []);
          setForm({
            name: data.name || '',
            vendor_type: data.vendor_type || '',
            status: data.status || 'active',
            website: data.website || '',
            business_registration_no: data.business_registration_no || '',
            logo_data: data.logo_data || '',
            email: data.email || '',
            phone: data.phone || '',
            address: data.address || '',
            notes: data.notes || '',
            contacts: parseJson(data.contacts_json, []),
            additional_addresses: addressesFromTable,
            tax_id: data.tax_id || '',
            w9_status: data.w9_status ?? 'not_collected',
            is_1099_eligible: Boolean(data.is_1099_eligible),
            form_1099_box: data.form_1099_box || '',
            diversity: parseJson(data.diversity, []),
            location_type: data.location_type || '',
            approval_status: data.approval_status || 'approved',
            onboarding_status: data.onboarding_status || 'in_progress',
            coi_expiry: data.coi_expiry || '',
            coi_amount: data.coi_amount ? String(data.coi_amount) : '',
            ach_routing: data.ach_routing || '',
            ach_account: data.ach_account || '',
            ach_account_type: data.ach_account_type || 'checking',
            preferred_payment_method: data.preferred_payment_method || '',
            currency: data.currency || 'USD',
            payment_terms: data.payment_terms != null ? String(data.payment_terms) : '',
            credit_limit: data.credit_limit ? String(data.credit_limit) : '',
            contract_start: data.contract_start || '',
            contract_end: data.contract_end || '',
            contract_notes: data.contract_notes || '',
            default_expense_account_id: data.default_expense_account_id || '',
            default_ap_account_id: data.default_ap_account_id || '',
          });
          // Pull performance metrics for read-only display
          setPerfData({
            on_time_payment_count: data.on_time_payment_count || 0,
            late_payment_count: data.late_payment_count || 0,
            avg_days_to_pay: data.avg_days_to_pay || 0,
            quality_rating: data.quality_rating || 0,
            dispute_count: data.dispute_count || 0,
          });
        }
      } catch (err) { console.error('Failed to load vendor:', err); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [vendorId]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    const val = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value;
    setForm(prev => ({ ...prev, [name]: val }));
  };

  // Contact CRUD
  const addContact = () => setForm(p => ({ ...p, contacts: [...p.contacts, newContact(p.contacts.length === 0)] }));
  const updateContact = (id: string, patch: Partial<VendorContact>) => setForm(p => ({
    ...p,
    contacts: p.contacts.map(c => c.id === id
      ? { ...c, ...patch, is_primary: patch.is_primary ? true : (patch.is_primary === false ? false : c.is_primary) }
      : (patch.is_primary === true ? { ...c, is_primary: false } : c)),
  }));
  const removeContact = (id: string) => setForm(p => ({ ...p, contacts: p.contacts.filter(c => c.id !== id) }));

  // Address CRUD
  const addAddress = (type: VendorAddress['type'] = 'billing') => setForm(p => ({ ...p, additional_addresses: [...p.additional_addresses, newAddress(type)] }));
  const updateAddress = (id: string, patch: Partial<VendorAddress>) => setForm(p => ({ ...p, additional_addresses: p.additional_addresses.map(a => a.id === id ? { ...a, ...patch } : a) }));
  const removeAddress = (id: string) => setForm(p => ({ ...p, additional_addresses: p.additional_addresses.filter(a => a.id !== id) }));

  const handleLogoUpload = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { alert('Logo must be smaller than 5 MB'); return; }
      const reader = new FileReader();
      reader.onload = async (e) => {
        const raw = e.target?.result as string;
        const processed = await removeBackground(raw);
        setForm(p => ({ ...p, logo_data: processed }));
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }, []);

  const handleSubmit = async () => {
    if (saving) return;
    // Validation
    if (!form.name.trim()) { setNameError('Vendor name is required.'); setTab('identity'); return; }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) { setNameError('Email format is invalid.'); setTab('identity'); return; }
    if (form.ach_routing && !/^\d{9}$/.test(form.ach_routing)) { setNameError('Routing number must be exactly 9 digits.'); setTab('banking'); return; }
    if (form.is_1099_eligible && !form.form_1099_box) { setNameError('1099 box is required when vendor is 1099-eligible.'); setTab('compliance'); return; }
    if (form.contract_start && form.contract_end && form.contract_end < form.contract_start) { setNameError('Contract end must be on/after start.'); setTab('banking'); return; }
    setNameError(''); setSaveError(''); setSaving(true);
    try {
      const payload: Record<string, any> = {
        name: form.name.trim(),
        vendor_type: form.vendor_type || '',
        status: form.status,
        website: form.website || null,
        business_registration_no: form.business_registration_no || null,
        logo_data: form.logo_data || null,
        email: form.email || null,
        phone: form.phone || null,
        address: form.address || null,
        notes: form.notes || null,
        contacts_json: JSON.stringify(form.contacts || []),
        additional_addresses_json: JSON.stringify(form.additional_addresses || []),
        tax_id: form.tax_id || null,
        w9_status: form.w9_status,
        is_1099_eligible: form.is_1099_eligible ? 1 : 0,
        form_1099_box: form.is_1099_eligible ? form.form_1099_box : '',
        diversity: JSON.stringify(form.diversity || []),
        location_type: form.location_type || '',
        approval_status: form.approval_status || 'approved',
        onboarding_status: form.onboarding_status || 'in_progress',
        coi_expiry: form.coi_expiry || null,
        coi_amount: form.coi_amount ? parseFloat(form.coi_amount) : null,
        ach_routing: form.ach_routing || null,
        ach_account: form.ach_account || null,
        ach_account_type: form.ach_account_type,
        preferred_payment_method: form.preferred_payment_method || null,
        currency: form.currency || 'USD',
        payment_terms: form.payment_terms ? (parseInt(form.payment_terms, 10) || 0) : 0,
        credit_limit: form.credit_limit ? parseFloat(form.credit_limit) : 0,
        contract_start: form.contract_start || null,
        contract_end: form.contract_end || null,
        contract_notes: form.contract_notes || null,
        default_expense_account_id: form.default_expense_account_id || null,
        default_ap_account_id: form.default_ap_account_id || null,
      };
      let savedId = vendorId || '';
      if (isEditing && vendorId) {
        await api.update('vendors', vendorId, payload);
      } else {
        const created: any = await api.create('vendors', payload);
        savedId = created?.id || '';
      }
      // Sync vendor_locations table (replaces the JSON blob for structured storage).
      if (savedId) {
        await api.vendorLocationsSync(savedId, form.additional_addresses.map(a => ({
          id: a.id,
          name: a.name || '',
          location_type: a.type || 'physical',
          address_line1: a.line1 || '',
          address_line2: a.line2 || '',
          city: a.city || '',
          state: a.state || '',
          zip: a.zip || '',
          country: a.country || '',
          phone: a.phone || '',
          email: a.email || '',
          is_primary: a.is_primary ? 1 : 0,
          notes: '',
        })));
      }
      onSaved();
    } catch (err: any) {
      console.error('Failed to save vendor:', err);
      setSaveError(err?.message ?? String(err));
    } finally { setSaving(false); }
  };

  // Compliance status helpers
  const w9Status = form.w9_status === 'on_file' ? 'complete' : form.w9_status === 'collected' ? 'pending' : 'pending';
  const coiStatus = (() => {
    if (!form.coi_expiry) return 'pending';
    const exp = new Date(form.coi_expiry + 'T00:00:00Z').getTime();
    const now = Date.now();
    if (exp < now) return 'expired';
    if (exp < now + 30 * 86400000) return 'expiring-soon';
    return 'complete';
  })();

  const expenseAccounts = accounts.filter(a => a.type === 'expense');
  const apAccounts = accounts.filter(a => a.type === 'liability');

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40 cursor-pointer" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="tform-modal w-full max-w-3xl cursor-default" onClick={(e) => e.stopPropagation()}>
          {/* Modal header */}
          <div className="tform-modal-header">
            <div className="tform-modal-title">
              <div style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg-tertiary)', borderRadius: 6, border: '1px solid var(--color-border-primary)' }}>
                <Building2 size={16} style={{ color: 'var(--color-accent-blue)' }} />
              </div>
              <span>{isEditing ? 'Edit Vendor' : 'New Vendor'}</span>
              {form.name && isEditing && (
                <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--color-text-muted)' }}>· {form.name}</span>
              )}
            </div>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 4 }}>
              <X size={18} />
            </button>
          </div>

          {/* Tab bar */}
          <div className="tform-tabs">
            {TABS.map(t => {
              const Icon = t.icon;
              const badge = t.key === 'contacts' && form.contacts.length > 0 ? form.contacts.length
                : t.key === 'addresses' && form.additional_addresses.length > 0 ? form.additional_addresses.length
                : null;
              return (
                <button key={t.key} className={`tform-tab ${tab === t.key ? 'is-active' : ''}`} onClick={() => setTab(t.key)}>
                  <Icon size={11} style={{ display: 'inline', marginRight: 4 }} />
                  {t.label}
                  {badge != null && <span className="tform-tab-badge">{badge}</span>}
                </button>
              );
            })}
          </div>

          {/* Error banner */}
          {(nameError || saveError) && (
            <div style={{ padding: '12px 18px 0' }}>
              <ErrorBanner message={nameError || saveError} onDismiss={() => { setNameError(''); setSaveError(''); }} />
            </div>
          )}

          {/* Tab content */}
          <div className="tform-panel">
            {loading && <div style={{ textAlign: 'center', padding: 32, color: 'var(--color-text-muted)' }}>Loading…</div>}

            {!loading && tab === 'identity' && (
              <div>
                {/* Vendor Logo */}
                <div className="tform-section">Vendor Logo</div>
                <div className="flex items-start gap-4 mb-4">
                  {form.logo_data ? (
                    <div className="flex flex-col items-start gap-2">
                      {/* Checkerboard behind preview so transparency is visible */}
                      <div style={{
                        backgroundImage: 'linear-gradient(45deg,#ccc 25%,transparent 25%),linear-gradient(-45deg,#ccc 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ccc 75%),linear-gradient(-45deg,transparent 75%,#ccc 75%)',
                        backgroundSize: '12px 12px', backgroundPosition: '0 0,0 6px,6px -6px,-6px 0',
                        border: '1px solid var(--color-border-primary)', borderRadius: 'var(--app-radius)', padding: 6,
                      }}>
                        <img
                          src={form.logo_data}
                          alt="Vendor logo"
                          style={{ maxWidth: 160, maxHeight: 80, objectFit: 'contain', display: 'block' }}
                        />
                      </div>
                      <div className="flex gap-2">
                        <button type="button" className="block-btn text-xs" onClick={handleLogoUpload}>Replace</button>
                        <button
                          type="button"
                          className="block-btn text-xs"
                          style={{ color: 'var(--color-accent-expense)' }}
                          onClick={() => setForm(p => ({ ...p, logo_data: '' }))}
                        >Remove</button>
                      </div>
                    </div>
                  ) : (
                    <div
                      style={{ width: 160, height: 80, border: '2px dashed var(--color-border-primary)', borderRadius: 'var(--app-radius)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', background: 'var(--color-bg-secondary)' }}
                      onClick={handleLogoUpload}
                    >
                      <span className="text-xs text-text-muted">Click to upload logo</span>
                    </div>
                  )}
                  <p className="text-xs text-text-muted self-center" style={{ maxWidth: 220 }}>
                    Shown on expense prints. Background is auto-removed to make the logo transparent.
                    PNG, JPG, GIF, WebP or SVG — max 5 MB.
                  </p>
                </div>

                <div className="tform-section">Basic Identity</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-semibold text-text-muted uppercase mb-1">Name *</label>
                    <input name="name" className="block-input" value={form.name} onChange={handleChange} placeholder="Vendor name" required />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-text-muted uppercase mb-1">Vendor Type</label>
                    <ClassificationSelect value={form.vendor_type} onChange={(v: string) => setForm(p => ({ ...p, vendor_type: v }))} def={VENDOR_TYPE} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-text-muted uppercase mb-1">Status</label>
                    <select name="status" className="block-select" value={form.status} onChange={handleChange}>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                      <option value="blocked">Blocked</option>
                      <option value="prospect">Prospect</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-text-muted uppercase mb-1">Onboarding</label>
                    <select name="onboarding_status" className="block-select" value={form.onboarding_status} onChange={handleChange}>
                      <option value="in_progress">In Progress</option>
                      <option value="awaiting_docs">Awaiting Documents</option>
                      <option value="under_review">Under Review</option>
                      <option value="complete">Complete</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-text-muted uppercase mb-1">Website</label>
                    <input name="website" className="block-input" value={form.website} onChange={handleChange} placeholder="https://" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-text-muted uppercase mb-1">Business Reg #</label>
                    <input name="business_registration_no" className="block-input" value={form.business_registration_no} onChange={handleChange} placeholder="State / DUNS / etc." />
                  </div>
                </div>

                <div className="tform-section">Primary Contact</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-semibold text-text-muted uppercase mb-1">Primary Email</label>
                    <input name="email" type="email" className="block-input" value={form.email} onChange={handleChange} placeholder="vendor@email.com" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-text-muted uppercase mb-1">Primary Phone</label>
                    <input name="phone" className="block-input" value={form.phone} onChange={handleChange} placeholder="(555) 000-0000" />
                  </div>
                </div>

                <div className="tform-section">Primary Address</div>
                <textarea name="address" className="block-input" rows={3} value={form.address} onChange={handleChange} placeholder="Street, City, State, ZIP" />

                <div className="tform-section">Notes</div>
                <textarea name="notes" className="block-input" rows={3} value={form.notes} onChange={handleChange} placeholder="Additional notes…" />
              </div>
            )}

            {!loading && tab === 'contacts' && (
              <div>
                <div className="tform-section">Additional Contacts</div>
                {form.contacts.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--color-text-muted)', fontSize: 11 }}>
                    No additional contacts. Add one for accounting, technical, sales, etc.
                  </div>
                )}
                {form.contacts.map(c => (
                  <div key={c.id} className="tform-contact-card">
                    <div>
                      <input className="block-input text-xs" placeholder="Full name" value={c.name} onChange={(e) => updateContact(c.id, { name: e.target.value })} />
                      <input className="block-input text-xs mt-1" placeholder="Role (e.g. AP Manager)" value={c.role} onChange={(e) => updateContact(c.id, { role: e.target.value })} />
                    </div>
                    <div>
                      <input className="block-input text-xs" placeholder="email@example.com" value={c.email} onChange={(e) => updateContact(c.id, { email: e.target.value })} />
                      <input className="block-input text-xs mt-1" placeholder="(555) 000-0000" value={c.phone} onChange={(e) => updateContact(c.id, { phone: e.target.value })} />
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--color-text-secondary)' }}>
                      <input type="checkbox" checked={c.is_primary} onChange={(e) => updateContact(c.id, { is_primary: e.target.checked })} />
                      Primary
                    </label>
                    <button type="button" onClick={() => removeContact(c.id)} style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer' }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button type="button" className="tform-add-btn mt-2" onClick={addContact}>
                  <Plus size={11} /> Add Contact
                </button>
              </div>
            )}

            {!loading && tab === 'addresses' && (
              <div>
                <div className="tform-section">Additional Addresses</div>
                {form.additional_addresses.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--color-text-muted)', fontSize: 11 }}>
                    No additional addresses. The Primary Address (Identity tab) covers the default.
                    Add separate billing / shipping / remit-to addresses here when they differ.
                  </div>
                )}
                {form.additional_addresses.map(a => (
                  <div key={a.id} className="tform-address-card">
                    <div className="flex items-center gap-2 mb-1">
                      <select className={`tform-address-type ${a.type}`} value={a.type} onChange={(e) => updateAddress(a.id, { type: e.target.value as VendorAddress['type'] })} style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-primary)', borderRadius: 4, color: 'inherit', fontSize: 9, padding: '2px 6px' }}>
                        <option value="billing">Billing</option>
                        <option value="shipping">Shipping</option>
                        <option value="remit">Remit-to</option>
                        <option value="physical">Physical</option>
                      </select>
                      <input className="block-input text-xs flex-1" placeholder="Location name (e.g. Main Warehouse, Downtown Branch)" value={a.name} onChange={(e) => updateAddress(a.id, { name: e.target.value })} />
                      <label style={{ fontSize: 10, display: 'flex', gap: 4, alignItems: 'center', whiteSpace: 'nowrap' }}>
                        <input type="checkbox" checked={!!a.is_primary} onChange={(e) => {
                          const checked = e.target.checked;
                          setForm(p => ({ ...p, additional_addresses: p.additional_addresses.map(x =>
                            x.id === a.id ? { ...x, is_primary: checked } : (checked ? { ...x, is_primary: false } : x)
                          )}));
                        }} />
                        Primary
                      </label>
                      <button type="button" onClick={() => removeAddress(a.id)} style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', flexShrink: 0 }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div>
                      <input className="block-input text-xs" placeholder="Street line 1" value={a.line1} onChange={(e) => updateAddress(a.id, { line1: e.target.value })} />
                      <input className="block-input text-xs mt-1" placeholder="Street line 2 (apt, suite, etc.)" value={a.line2} onChange={(e) => updateAddress(a.id, { line2: e.target.value })} />
                      <div className="grid gap-1 mt-1" style={{ gridTemplateColumns: '2fr 80px 110px 80px' }}>
                        <input className="block-input text-xs" placeholder="City" value={a.city} onChange={(e) => updateAddress(a.id, { city: e.target.value })} />
                        <input className="block-input text-xs" placeholder="State" value={a.state} onChange={(e) => updateAddress(a.id, { state: e.target.value })} />
                        <input className="block-input text-xs" placeholder="ZIP / Postal" value={a.zip} onChange={(e) => updateAddress(a.id, { zip: e.target.value })} />
                        <input className="block-input text-xs" placeholder="Country" value={a.country} onChange={(e) => updateAddress(a.id, { country: e.target.value })} />
                      </div>
                      <div className="grid gap-1 mt-1" style={{ gridTemplateColumns: '1fr 1fr' }}>
                        <input className="block-input text-xs" placeholder="Phone (optional)" value={a.phone} onChange={(e) => updateAddress(a.id, { phone: e.target.value })} />
                        <input className="block-input text-xs" placeholder="Email (optional)" value={a.email} onChange={(e) => updateAddress(a.id, { email: e.target.value })} />
                      </div>
                    </div>
                  </div>
                ))}
                <div className="flex gap-2 mt-2">
                  <button type="button" className="tform-add-btn" onClick={() => addAddress('billing')}><Plus size={11} /> Billing</button>
                  <button type="button" className="tform-add-btn" onClick={() => addAddress('shipping')}><Plus size={11} /> Shipping</button>
                  <button type="button" className="tform-add-btn" onClick={() => addAddress('remit')}><Plus size={11} /> Remit-to</button>
                  <button type="button" className="tform-add-btn" onClick={() => addAddress('physical')}><Plus size={11} /> Physical</button>
                </div>
              </div>
            )}

            {!loading && tab === 'compliance' && (
              <div>
                <div className="tform-section">Tax & Reporting</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-semibold text-text-muted uppercase mb-1">Tax ID / EIN</label>
                    <input name="tax_id" className="block-input" value={form.tax_id} onChange={handleChange} placeholder="XX-XXXXXXX" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-text-muted uppercase mb-1">Approval Status</label>
                    <ClassificationSelect value={form.approval_status} onChange={(v: string) => setForm(p => ({ ...p, approval_status: v }))} def={VENDOR_APPROVAL} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-text-muted uppercase mb-1">Location Type</label>
                    <ClassificationSelect value={form.location_type} onChange={(v: string) => setForm(p => ({ ...p, location_type: v }))} def={VENDOR_LOCATION} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-text-muted uppercase mb-1">Diversity Classifications</label>
                    <ClassificationMultiSelect values={form.diversity} onChange={(v: string[]) => setForm(p => ({ ...p, diversity: v }))} def={VENDOR_DIVERSITY} />
                  </div>
                </div>

                <div className="tform-section">Compliance Documents</div>
                <div className="tform-compliance-row">
                  <div>
                    <div className="tform-compliance-name">W-9 Form</div>
                    <div className="tform-compliance-meta">Required for any 1099-eligible vendor</div>
                  </div>
                  <select name="w9_status" className="block-select" value={form.w9_status} onChange={handleChange} style={{ width: 160 }}>
                    <option value="not_collected">Not Collected</option>
                    <option value="collected">Requested</option>
                    <option value="on_file">On File</option>
                  </select>
                </div>
                <div className="tform-compliance-row">
                  <div>
                    <div className="tform-compliance-name">1099-NEC Eligibility</div>
                    <div className="tform-compliance-meta">Required for contractors paid $600+/year (non-corporate)</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <label style={{ fontSize: 10, display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input type="checkbox" name="is_1099_eligible" checked={form.is_1099_eligible} onChange={handleChange} />
                      Eligible
                    </label>
                    {form.is_1099_eligible && (
                      <ClassificationSelect value={form.form_1099_box} onChange={(v: string) => setForm(p => ({ ...p, form_1099_box: v }))} def={VENDOR_1099_BOX} />
                    )}
                  </div>
                </div>
                <div className="tform-compliance-row">
                  <div>
                    <div className="tform-compliance-name">Certificate of Insurance (COI)</div>
                    <div className="tform-compliance-meta">{form.coi_expiry ? `Expires ${form.coi_expiry}` : 'No expiry on file'}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="date" name="coi_expiry" className="block-input text-xs" value={form.coi_expiry} onChange={handleChange} style={{ width: 130 }} />
                    <input type="number" step="1000" name="coi_amount" placeholder="Coverage $" className="block-input text-xs" value={form.coi_amount} onChange={handleChange} style={{ width: 120 }} />
                    <span className={`tform-compliance-status ${coiStatus}`}>{coiStatus.replace('-', ' ')}</span>
                  </div>
                </div>
              </div>
            )}

            {!loading && tab === 'banking' && (
              <div>
                <div className="tform-section">Payment Method</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-semibold text-text-muted uppercase mb-1">Preferred Method</label>
                    <select name="preferred_payment_method" className="block-select" value={form.preferred_payment_method} onChange={handleChange}>
                      <option value="">— Select —</option>
                      <option value="ach">ACH</option>
                      <option value="check">Check</option>
                      <option value="wire">Wire</option>
                      <option value="card">Credit Card</option>
                      <option value="cash">Cash</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-text-muted uppercase mb-1">Currency</label>
                    <select name="currency" className="block-select" value={form.currency} onChange={handleChange}>
                      <option value="USD">USD</option>
                      <option value="CAD">CAD</option>
                      <option value="EUR">EUR</option>
                      <option value="GBP">GBP</option>
                      <option value="JPY">JPY</option>
                      <option value="MXN">MXN</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-text-muted uppercase mb-1">Payment Terms (days)</label>
                    <input type="number" name="payment_terms" className="block-input" value={form.payment_terms} onChange={handleChange} placeholder="e.g. 30" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-text-muted uppercase mb-1">Credit Limit ($)</label>
                    <input type="number" step="0.01" name="credit_limit" className="block-input" value={form.credit_limit} onChange={handleChange} placeholder="0.00" />
                  </div>
                </div>

                <div className="tform-section">ACH / Bank Account</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-semibold text-text-muted uppercase mb-1">Routing # (9 digits)</label>
                    <input name="ach_routing" className="block-input font-mono" value={form.ach_routing} onChange={handleChange} placeholder="123456789" maxLength={9} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-text-muted uppercase mb-1">Account #</label>
                    <input name="ach_account" className="block-input font-mono" value={form.ach_account} onChange={handleChange} placeholder="Account number" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-text-muted uppercase mb-1">Account Type</label>
                    <select name="ach_account_type" className="block-select" value={form.ach_account_type} onChange={handleChange}>
                      <option value="checking">Checking</option>
                      <option value="savings">Savings</option>
                    </select>
                  </div>
                </div>

                <div className="tform-section">Contract</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-semibold text-text-muted uppercase mb-1">Start Date</label>
                    <input type="date" name="contract_start" className="block-input" value={form.contract_start} onChange={handleChange} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-text-muted uppercase mb-1">End Date</label>
                    <input type="date" name="contract_end" className="block-input" value={form.contract_end} onChange={handleChange} />
                  </div>
                </div>
                <div className="mt-2">
                  <label className="block text-[10px] font-semibold text-text-muted uppercase mb-1">Contract Notes</label>
                  <textarea name="contract_notes" className="block-input" rows={2} value={form.contract_notes} onChange={handleChange} placeholder="Special terms, auto-renew clause, etc." />
                </div>
              </div>
            )}

            {!loading && tab === 'posting' && (
              <div>
                <div className="tform-section">Default GL Accounts</div>
                <p className="text-[10px] text-text-muted mb-2">When you create an expense for this vendor, these accounts will be pre-selected.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-semibold text-text-muted uppercase mb-1">Default Expense Account</label>
                    <select name="default_expense_account_id" className="block-select" value={form.default_expense_account_id} onChange={handleChange}>
                      <option value="">— None —</option>
                      {expenseAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-text-muted uppercase mb-1">Default AP Account</label>
                    <select name="default_ap_account_id" className="block-select" value={form.default_ap_account_id} onChange={handleChange}>
                      <option value="">— None —</option>
                      {apAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </div>
                </div>

                {isEditing && perfData && (
                  <>
                    <div className="tform-section">Performance Metrics (read-only)</div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="tform-metric">
                        <div className="tform-metric-label">On-Time Payments</div>
                        <div className="tform-metric-value">{perfData.on_time_payment_count}</div>
                      </div>
                      <div className="tform-metric">
                        <div className="tform-metric-label">Late Payments</div>
                        <div className="tform-metric-value">{perfData.late_payment_count}</div>
                      </div>
                      <div className="tform-metric">
                        <div className="tform-metric-label">Avg Days to Pay</div>
                        <div className="tform-metric-value">{Math.round(perfData.avg_days_to_pay || 0)}</div>
                        <div className="tform-metric-sub">days</div>
                      </div>
                      <div className="tform-metric">
                        <div className="tform-metric-label">Quality Rating</div>
                        <div className="tform-metric-value">{(perfData.quality_rating || 0).toFixed(1)}</div>
                        <div className="tform-metric-sub">of 5.0</div>
                      </div>
                      <div className="tform-metric">
                        <div className="tform-metric-label">Disputes</div>
                        <div className="tform-metric-value" style={{ color: perfData.dispute_count > 0 ? '#ef4444' : undefined }}>{perfData.dispute_count}</div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="tform-footer">
            <div className="tform-footer-status">
              {saving ? 'Saving…' : isEditing ? `Editing ${form.name}` : 'New vendor'}
            </div>
            <div className="tform-footer-actions">
              <button type="button" className="block-btn" onClick={onClose} disabled={saving}>Cancel</button>
              <button type="button" className="block-btn-primary" onClick={handleSubmit} disabled={saving}>
                {saving ? 'Saving…' : (isEditing ? 'Save Changes' : 'Create Vendor')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

function parseJson<T>(s: any, fallback: T): T {
  if (!s) return fallback;
  if (Array.isArray(s) || typeof s === 'object') return s as T;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

export default VendorForm;
