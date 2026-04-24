import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Boxes, Plus, ChevronLeft, BarChart2, List, Calendar,
  AlertCircle, RefreshCw, Edit2, Trash2, Eye, TrendingDown,
  Hash, MapPin, Tag, DollarSign, Clock, CheckCircle, XCircle,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

// ─── Types ───────────────────────────────────────────────
interface FixedAsset {
  id: string;
  company_id: string;
  name: string;
  asset_code: string;
  category: 'equipment' | 'vehicle' | 'building' | 'furniture' | 'software' | 'other';
  description: string;
  purchase_date: string;
  purchase_price: number;
  salvage_value: number;
  useful_life_years: number;
  depreciation_method: 'straight_line' | 'double_declining' | 'sum_of_years_digits';
  current_book_value: number;
  accumulated_depreciation: number;
  status: 'active' | 'disposed' | 'fully_depreciated';
  serial_number: string;
  location: string;
  notes: string;
  asset_account_id: string;
  depreciation_account_id: string;
  accumulated_depreciation_account_id: string;
  created_at: string;
}

interface DepreciationEntry {
  id: string;
  asset_id: string;
  period_date: string;
  period_label: string;
  depreciation_amount: number;
  accumulated_depreciation: number;
  book_value: number;
}

interface ScheduleEntry {
  period: number;
  period_label: string;
  period_date: string;
  depreciation_amount: number;
  accumulated_depreciation: number;
  book_value: number;
}

interface Account {
  id: string;
  name: string;
  code: string;
  type: string;
}

// ─── Helpers ─────────────────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

const CATEGORIES = ['equipment', 'vehicle', 'building', 'furniture', 'software', 'other'] as const;
const METHODS = [
  { value: 'straight_line', label: 'Straight Line' },
  { value: 'double_declining', label: 'Double Declining Balance' },
  { value: 'sum_of_years_digits', label: 'Sum of Years Digits' },
] as const;

const STATUS_COLORS: Record<string, string> = {
  active: 'block-badge-income',
  disposed: 'block-badge-expense',
  fully_depreciated: 'block-badge-blue',
};

const CATEGORY_LABELS: Record<string, string> = {
  equipment: 'Equipment',
  vehicle: 'Vehicle',
  building: 'Building',
  furniture: 'Furniture',
  software: 'Software',
  other: 'Other',
};

function calcAnnualDepreciation(
  purchasePrice: number,
  salvageValue: number,
  usefulLifeYears: number,
  method: string
): number {
  if (!purchasePrice || !usefulLifeYears || usefulLifeYears <= 0) return 0;
  const depreciable = purchasePrice - salvageValue;
  if (method === 'straight_line') return depreciable / usefulLifeYears;
  if (method === 'double_declining') {
    // Year 1 depreciation (subsequent years apply rate to declining book value)
    const rate = 2 / usefulLifeYears;
    return Math.min(purchasePrice * rate, purchasePrice - salvageValue);
  }
  if (method === 'sum_of_years_digits') {
    const syd = (usefulLifeYears * (usefulLifeYears + 1)) / 2;
    return (depreciable * usefulLifeYears) / syd;
  }
  return depreciable / usefulLifeYears;
}

// ─── View type ───────────────────────────────────────────
type View =
  | { type: 'list' }
  | { type: 'new' }
  | { type: 'edit'; assetId: string }
  | { type: 'detail'; assetId: string };

// ─── Toast ───────────────────────────────────────────────
interface Toast { id: number; msg: string; ok: boolean }
let toastId = 0;

// ═══════════════════════════════════════════════════════════
// ASSET LIST
// ═══════════════════════════════════════════════════════════
interface AssetListProps {
  onNew: () => void;
  onView: (id: string) => void;
  onEdit: (id: string) => void;
}

const AssetList: React.FC<AssetListProps> = ({ onNew, onView, onEdit }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningDep, setRunningDep] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [toast, setToast] = useState<Toast | null>(null);

  const showToast = (msg: string, ok = true) => {
    const t = { id: ++toastId, msg, ok };
    setToast(t);
    setTimeout(() => setToast((c) => (c?.id === t.id ? null : c)), 4000);
  };

  const load = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    try {
      const rows = await api.query('fixed_assets', { company_id: activeCompany.id });
      setAssets(rows ?? []);
    } finally {
      setLoading(false);
    }
  }, [activeCompany]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    return assets.filter((a) => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && a.category !== categoryFilter) return false;
      return true;
    });
  }, [assets, statusFilter, categoryFilter]);

  const stats = useMemo(() => ({
    count: assets.length,
    totalCost: assets.reduce((s, a) => s + (a.purchase_price || 0), 0),
    totalBook: assets.reduce((s, a) => s + (a.current_book_value ?? a.purchase_price ?? 0), 0),
    totalAccDep: assets.reduce((s, a) => s + (a.accumulated_depreciation || 0), 0),
  }), [assets]);

  const handleRunDep = async () => {
    if (!activeCompany) return;
    setRunningDep(true);
    try {
      const periodDate = format(new Date(), 'yyyy-MM-01');
      const result = await window.electronAPI.invoke('assets:run-depreciation', { periodDate });
      showToast(`Depreciation processed for ${result?.processed ?? 0} asset(s).`, true);
      load();
    } catch {
      showToast('Failed to run depreciation.', false);
    } finally {
      setRunningDep(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this asset? This cannot be undone.')) return;
    try {
      await api.remove('fixed_assets', id);
      showToast('Asset deleted.', true);
      load();
    } catch {
      showToast('Delete failed.', false);
    }
  };

  const STATUS_TABS = ['all', 'active', 'fully_depreciated', 'disposed'];

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 text-sm font-semibold border ${
            toast.ok ? 'bg-bg-elevated border-accent-income text-accent-income' : 'bg-bg-elevated border-accent-expense text-accent-expense'
          }`}
          style={{ borderRadius: '6px' }}
        >
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary" style={{ borderRadius: '6px' }}>
            <Boxes size={18} className="text-accent-blue" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-text-primary">Fixed Assets</h1>
            <p className="text-xs text-text-muted mt-0.5">Track, depreciate, and manage business assets.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleRunDep}
            disabled={runningDep}
            className="block-btn flex items-center gap-2 px-3 py-1.5 text-xs"
          >
            <RefreshCw size={13} className={runningDep ? 'animate-spin' : ''} />
            {runningDep ? 'Running...' : 'Run Monthly Depreciation'}
          </button>
          <button
            onClick={onNew}
            className="block-btn-primary flex items-center gap-2 px-3 py-1.5 text-xs"
          >
            <Plus size={13} />
            New Asset
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total Assets', value: String(stats.count), icon: <Boxes size={16} /> },
          { label: 'Original Cost', value: fmt.format(stats.totalCost), icon: <DollarSign size={16} /> },
          { label: 'Book Value', value: fmt.format(stats.totalBook), icon: <TrendingDown size={16} /> },
          { label: 'Accumulated Dep.', value: fmt.format(stats.totalAccDep), icon: <BarChart2 size={16} /> },
        ].map((s) => (
          <div key={s.label} className="stat-card">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-text-muted">{s.icon}</span>
              <span className="stat-label">{s.label}</span>
            </div>
            <div className="stat-value">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Status tabs */}
        <div className="flex border border-border-primary" style={{ borderRadius: '6px' }}>
          {STATUS_TABS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                statusFilter === s
                  ? 'bg-accent-blue text-white'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors'
              }`}
              style={{ borderRadius: '0px' }}
            >
              {s === 'all' ? 'All' : s === 'fully_depreciated' ? 'Fully Depreciated' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {/* Category dropdown */}
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="block-select text-xs px-2 py-1.5"
        >
          <option value="all">All Categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="block-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-text-muted text-sm">Loading assets...</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state py-16">
            <div className="empty-state-icon"><Boxes size={32} /></div>
            <p className="text-text-muted text-sm mt-2">No assets found.</p>
            <button onClick={onNew} className="block-btn-primary mt-4 px-4 py-2 text-xs flex items-center gap-2 mx-auto">
              <Plus size={13} /> Add First Asset
            </button>
          </div>
        ) : (
          <table className="block-table w-full">
            <thead>
              <tr>
                <th>Asset Code</th>
                <th>Name</th>
                <th>Category</th>
                <th>Purchase Date</th>
                <th className="text-right">Original Cost</th>
                <th className="text-right">Acc. Dep.</th>
                <th className="text-right">Book Value</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id} className="hover:bg-bg-hover cursor-pointer transition-colors" onClick={() => onView(a.id)}>
                  <td className="font-mono text-xs text-accent-blue">{a.asset_code}</td>
                  <td className="font-semibold text-text-primary truncate max-w-[200px]">{a.name}</td>
                  <td><span className="block-badge block-badge-blue">{CATEGORY_LABELS[a.category]}</span></td>
                  <td className="text-text-secondary text-xs">
                    {a.purchase_date ? format(parseISO(a.purchase_date), 'MMM d, yyyy') : '—'}
                  </td>
                  <td className="text-right text-text-primary">{fmt.format(a.purchase_price)}</td>
                  <td className="text-right text-accent-expense">{fmt.format(a.accumulated_depreciation || 0)}</td>
                  <td className="text-right text-accent-income font-semibold">{fmt.format(a.current_book_value ?? a.purchase_price)}</td>
                  <td>
                    <span className={`block-badge ${STATUS_COLORS[a.status] || 'block-badge'}`}>
                      {a.status === 'fully_depreciated' ? 'Fully Dep.' : a.status.charAt(0).toUpperCase() + a.status.slice(1)}
                    </span>
                  </td>
                  <td className="cursor-pointer" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <button onClick={() => onView(a.id)} className="block-btn p-1.5" title="View">
                        <Eye size={13} />
                      </button>
                      <button onClick={() => onEdit(a.id)} className="block-btn p-1.5" title="Edit">
                        <Edit2 size={13} />
                      </button>
                      <button onClick={() => handleDelete(a.id)} className="block-btn p-1.5 text-accent-expense hover:text-accent-expense transition-colors" title="Delete">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
// ASSET FORM
// ═══════════════════════════════════════════════════════════
interface AssetFormProps {
  assetId?: string;
  onBack: () => void;
  onSaved: (id: string) => void;
}

const emptyForm = {
  name: '',
  asset_code: '',
  category: 'equipment' as FixedAsset['category'],
  description: '',
  purchase_date: format(new Date(), 'yyyy-MM-dd'),
  purchase_price: '',
  salvage_value: '',
  useful_life_years: '',
  depreciation_method: 'straight_line' as FixedAsset['depreciation_method'],
  serial_number: '',
  location: '',
  notes: '',
  asset_account_id: '',
  depreciation_account_id: '',
  accumulated_depreciation_account_id: '',
};

const AssetForm: React.FC<AssetFormProps> = ({ assetId, onBack, onSaved }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [form, setForm] = useState(emptyForm);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!!assetId);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const init = async () => {
      if (!activeCompany) return;
      // Critical: asset data; accounts are optional (for dropdowns)
      const asset = assetId ? await api.get('fixed_assets', assetId) : null;

      // Non-critical — failures don't hide primary content
      api.query('accounts', { company_id: activeCompany.id })
        .then(r => setAccounts(Array.isArray(r) ? r : []))
        .catch(() => {});
      if (asset) {
        setForm({
          name: asset.name ?? '',
          asset_code: asset.asset_code ?? '',
          category: asset.category ?? 'equipment',
          description: asset.description ?? '',
          purchase_date: asset.purchase_date ?? format(new Date(), 'yyyy-MM-dd'),
          purchase_price: asset.purchase_price != null ? String(asset.purchase_price) : '',
          salvage_value: asset.salvage_value != null ? String(asset.salvage_value) : '',
          useful_life_years: asset.useful_life_years != null ? String(asset.useful_life_years) : '',
          depreciation_method: asset.depreciation_method ?? 'straight_line',
          serial_number: asset.serial_number ?? '',
          location: asset.location ?? '',
          notes: asset.notes ?? '',
          asset_account_id: asset.asset_account_id ?? '',
          depreciation_account_id: asset.depreciation_account_id ?? '',
          accumulated_depreciation_account_id: asset.accumulated_depreciation_account_id ?? '',
        });
      } else {
        // Auto-generate asset code
        const code = await window.electronAPI.invoke('assets:next-code');
        setForm((f) => ({ ...f, asset_code: code ?? '' }));
      }
      setLoading(false);
    };
    init();
  }, [assetId, activeCompany]);

  const set = (k: string, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => { const n = { ...e }; delete n[k]; return n; });
  };

  const annualDep = useMemo(() => {
    const pp = parseFloat(form.purchase_price) || 0;
    const sv = parseFloat(form.salvage_value) || 0;
    const ul = parseFloat(form.useful_life_years) || 0;
    return calcAnnualDepreciation(pp, sv, ul, form.depreciation_method);
  }, [form.purchase_price, form.salvage_value, form.useful_life_years, form.depreciation_method]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Name is required.';
    if (!form.purchase_date) e.purchase_date = 'Purchase date is required.';
    if (!form.purchase_price || isNaN(parseFloat(form.purchase_price))) e.purchase_price = 'Valid price required.';
    if (!form.useful_life_years || isNaN(parseFloat(form.useful_life_years))) e.useful_life_years = 'Valid life required.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate() || !activeCompany) return;
    setSaving(true);
    try {
      const pp = parseFloat(form.purchase_price) || 0;
      const sv = parseFloat(form.salvage_value) || 0;
      const ul = parseFloat(form.useful_life_years) || 0;
      const data = {
        ...form,
        company_id: activeCompany.id,
        purchase_price: pp,
        salvage_value: sv,
        useful_life_years: ul,
        current_book_value: assetId ? undefined : pp,
        accumulated_depreciation: assetId ? undefined : 0,
        status: assetId ? undefined : 'active',
      };
      if (assetId) {
        delete data.current_book_value;
        delete data.accumulated_depreciation;
        delete data.status;
        await api.update('fixed_assets', assetId, data);
        onSaved(assetId);
      } else {
        const created = await api.create('fixed_assets', data);
        onSaved(created.id ?? assetId ?? '');
      }
    } catch (err: any) {
      console.error('Failed to save asset:', err);
      alert('Operation failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-text-muted text-sm">Loading...</div>;
  }

  const F = ({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) => (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">{label}</label>
      {children}
      {error && <p className="text-xs text-accent-expense">{error}</p>}
    </div>
  );

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="block-btn p-1.5">
          <ChevronLeft size={16} />
        </button>
        <div>
          <h1 className="text-lg font-bold text-text-primary">{assetId ? 'Edit Asset' : 'New Fixed Asset'}</h1>
          <p className="text-xs text-text-muted mt-0.5">Fill in asset details and depreciation settings.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Left column */}
        <div className="space-y-4">
          <div className="block-card p-4 space-y-4">
            <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider border-b border-border-primary pb-2">Asset Information</h3>
            <F label="Asset Code">
              <input
                className="block-input w-full font-mono text-xs"
                value={form.asset_code}
                onChange={(e) => set('asset_code', e.target.value)}
                placeholder="Auto-generated"
              />
            </F>
            <F label="Asset Name" error={errors.name}>
              <input
                className="block-input w-full"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="e.g. MacBook Pro 16-inch"
              />
            </F>
            <F label="Category">
              <select
                className="block-select w-full"
                value={form.category}
                onChange={(e) => set('category', e.target.value)}
              >
                {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </select>
            </F>
            <F label="Description">
              <textarea
                className="block-input w-full resize-none"
                rows={2}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="Optional description..."
              />
            </F>
            <div className="grid grid-cols-2 gap-3">
              <F label="Serial Number">
                <input
                  className="block-input w-full"
                  value={form.serial_number}
                  onChange={(e) => set('serial_number', e.target.value)}
                />
              </F>
              <F label="Location">
                <input
                  className="block-input w-full"
                  value={form.location}
                  onChange={(e) => set('location', e.target.value)}
                />
              </F>
            </div>
            <F label="Notes">
              <textarea
                className="block-input w-full resize-none"
                rows={2}
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
            </F>
          </div>

          {/* GL Accounts */}
          <div className="block-card p-4 space-y-4">
            <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider border-b border-border-primary pb-2">GL Accounts</h3>
            {[
              { key: 'asset_account_id', label: 'Asset Account' },
              { key: 'depreciation_account_id', label: 'Depreciation Expense Account' },
              { key: 'accumulated_depreciation_account_id', label: 'Accumulated Depreciation Account' },
            ].map(({ key, label }) => (
              <F key={key} label={label}>
                <select
                  className="block-select w-full"
                  value={(form as any)[key]}
                  onChange={(e) => set(key, e.target.value)}
                >
                  <option value="">-- Select Account --</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                  ))}
                </select>
              </F>
            ))}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <div className="block-card p-4 space-y-4">
            <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider border-b border-border-primary pb-2">Acquisition & Valuation</h3>
            <F label="Purchase Date" error={errors.purchase_date}>
              <input
                type="date"
                className="block-input w-full"
                value={form.purchase_date}
                onChange={(e) => set('purchase_date', e.target.value)}
              />
            </F>
            <F label="Purchase Price ($)" error={errors.purchase_price}>
              <input
                type="number"
                className="block-input w-full"
                value={form.purchase_price}
                onChange={(e) => set('purchase_price', e.target.value)}
                min="0"
                step="0.01"
                placeholder="0.00"
              />
            </F>
            <F label="Salvage Value ($)">
              <input
                type="number"
                className="block-input w-full"
                value={form.salvage_value}
                onChange={(e) => set('salvage_value', e.target.value)}
                min="0"
                step="0.01"
                placeholder="0.00"
              />
            </F>
          </div>

          <div className="block-card p-4 space-y-4">
            <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider border-b border-border-primary pb-2">Depreciation Settings</h3>
            <F label="Useful Life (Years)" error={errors.useful_life_years}>
              <input
                type="number"
                className="block-input w-full"
                value={form.useful_life_years}
                onChange={(e) => set('useful_life_years', e.target.value)}
                min="1"
                step="1"
                placeholder="5"
              />
            </F>
            <F label="Depreciation Method">
              <select
                className="block-select w-full"
                value={form.depreciation_method}
                onChange={(e) => set('depreciation_method', e.target.value)}
              >
                {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </F>

            {/* Preview */}
            {annualDep > 0 && (
              <div className="bg-bg-tertiary border border-border-primary p-3 space-y-2" style={{ borderRadius: '6px' }}>
                <p className="text-xs font-bold text-text-muted uppercase tracking-wider">Depreciation Preview</p>
                <div className="flex justify-between">
                  <span className="text-xs text-text-secondary">Annual:</span>
                  <span className="text-xs font-semibold text-text-primary">{fmt.format(annualDep)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-text-secondary">Monthly:</span>
                  <span className="text-xs font-semibold text-text-primary">{fmt.format(annualDep / 12)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-text-secondary">Method:</span>
                  <span className="text-xs text-accent-blue">{METHODS.find((m) => m.value === form.depreciation_method)?.label}</span>
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2 justify-end">
            <button onClick={onBack} className="block-btn px-4 py-2 text-xs">Cancel</button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="block-btn-primary px-4 py-2 text-xs"
            >
              {saving ? 'Saving...' : assetId ? 'Save Changes' : 'Create Asset'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
// ASSET DETAIL
// ═══════════════════════════════════════════════════════════
interface AssetDetailProps {
  assetId: string;
  onBack: () => void;
  onEdit: (id: string) => void;
}

type DetailTab = 'schedule' | 'history' | 'chart';

const AssetDetail: React.FC<AssetDetailProps> = ({ assetId, onBack, onEdit }) => {
  const [asset, setAsset] = useState<FixedAsset | null>(null);
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [history, setHistory] = useState<DepreciationEntry[]>([]);
  const [tab, setTab] = useState<DetailTab>('schedule');
  const [loading, setLoading] = useState(true);
  const [disposing, setDisposing] = useState(false);
  const [showDisposeForm, setShowDisposeForm] = useState(false);
  const [disposeAmount, setDisposeAmount] = useState('');
  const [disposeDate, setDisposeDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [toast, setToast] = useState<Toast | null>(null);

  const showToast = (msg: string, ok = true) => {
    const t = { id: ++toastId, msg, ok };
    setToast(t);
    setTimeout(() => setToast((c) => (c?.id === t.id ? null : c)), 4000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Critical: asset data
      const a = await api.get('fixed_assets', assetId);
      setAsset(a);

      // Non-critical secondary data — failures don't hide primary content
      window.electronAPI.invoke('assets:schedule', { assetId })
        .then((r: any) => setSchedule(Array.isArray(r) ? r : []))
        .catch(() => {});
      api.query('asset_depreciation_entries', { asset_id: assetId })
        .then(r => setHistory(Array.isArray(r) ? r : []))
        .catch(() => {});
    } finally {
      setLoading(false);
    }
  }, [assetId]);

  useEffect(() => { load(); }, [load]);

  const handleDispose = async () => {
    if (!asset) return;
    setDisposing(true);
    try {
      await api.update('fixed_assets', assetId, {
        status: 'disposed',
        notes: `Disposed on ${disposeDate}. Disposal amount: ${disposeAmount || '0'}. ${asset.notes ?? ''}`.trim(),
      });
      showToast('Asset marked as disposed.', true);
      setShowDisposeForm(false);
      load();
    } catch {
      showToast('Disposal failed.', false);
    } finally {
      setDisposing(false);
    }
  };

  const chartData = useMemo(() => {
    if (history.length > 0) {
      return history.map((h) => ({
        label: h.period_label,
        bookValue: h.book_value,
        depreciation: h.depreciation_amount,
      }));
    }
    return schedule.slice(0, 20).map((s) => ({
      label: s.period_label,
      bookValue: s.book_value,
      depreciation: s.depreciation_amount,
    }));
  }, [history, schedule]);

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-text-muted text-sm">Loading asset...</div>;
  }

  if (!asset) {
    return <div className="flex items-center justify-center h-64 text-text-muted text-sm">Asset not found.</div>;
  }

  const DETAIL_TABS: { key: DetailTab; label: string; icon: React.ReactNode }[] = [
    { key: 'schedule', label: 'Depreciation Schedule', icon: <Calendar size={14} /> },
    { key: 'history', label: 'Actual History', icon: <List size={14} /> },
    { key: 'chart', label: 'Book Value Chart', icon: <BarChart2 size={14} /> },
  ];

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 text-sm font-semibold border ${
            toast.ok ? 'bg-bg-elevated border-accent-income text-accent-income' : 'bg-bg-elevated border-accent-expense text-accent-expense'
          }`}
          style={{ borderRadius: '6px' }}
        >
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="block-btn p-1.5">
            <ChevronLeft size={16} />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-text-primary">{asset.name}</h1>
              <span className={`block-badge ${STATUS_COLORS[asset.status]}`}>
                {asset.status === 'fully_depreciated' ? 'Fully Dep.' : asset.status.charAt(0).toUpperCase() + asset.status.slice(1)}
              </span>
            </div>
            <p className="text-xs text-text-muted mt-0.5 font-mono">{asset.asset_code} · {CATEGORY_LABELS[asset.category]}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {asset.status === 'active' && (
            <button
              onClick={() => setShowDisposeForm(true)}
              className="block-btn flex items-center gap-1.5 px-3 py-1.5 text-xs text-accent-expense"
            >
              <XCircle size={13} />
              Dispose Asset
            </button>
          )}
          <button
            onClick={() => onEdit(assetId)}
            className="block-btn flex items-center gap-1.5 px-3 py-1.5 text-xs"
          >
            <Edit2 size={13} />
            Edit
          </button>
        </div>
      </div>

      {/* Dispose Form */}
      {showDisposeForm && (
        <div className="block-card p-4 border-accent-expense" style={{ borderColor: 'var(--color-accent-expense)' }}>
          <h3 className="text-sm font-bold text-accent-expense mb-3">Dispose Asset</h3>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-text-muted block mb-1">Disposal Date</label>
              <input
                type="date"
                className="block-input w-full"
                value={disposeDate}
                onChange={(e) => setDisposeDate(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-text-muted block mb-1">Disposal Amount ($)</label>
              <input
                type="number"
                className="block-input w-full"
                value={disposeAmount}
                onChange={(e) => setDisposeAmount(e.target.value)}
                placeholder="0.00"
                min="0"
                step="0.01"
              />
            </div>
            <div className="flex items-end gap-2">
              <button
                onClick={handleDispose}
                disabled={disposing}
                className="block-btn-primary px-4 py-2 text-xs bg-accent-expense border-accent-expense"
              >
                {disposing ? 'Processing...' : 'Confirm Disposal'}
              </button>
              <button onClick={() => setShowDisposeForm(false)} className="block-btn px-3 py-2 text-xs">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Asset Info Cards */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Purchase Price', value: fmt.format(asset.purchase_price) },
          { label: 'Salvage Value', value: fmt.format(asset.salvage_value) },
          { label: 'Book Value', value: fmt.format(asset.current_book_value ?? asset.purchase_price) },
          { label: 'Accumulated Dep.', value: fmt.format(asset.accumulated_depreciation || 0) },
        ].map((s) => (
          <div key={s.label} className="stat-card">
            <div className="stat-label">{s.label}</div>
            <div className="stat-value">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Details Grid */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: <Calendar size={13} />, label: 'Purchase Date', value: asset.purchase_date ? format(parseISO(asset.purchase_date), 'MMM d, yyyy') : '—' },
          { icon: <Clock size={13} />, label: 'Useful Life', value: `${asset.useful_life_years} years` },
          { icon: <Tag size={13} />, label: 'Method', value: METHODS.find((m) => m.value === asset.depreciation_method)?.label ?? asset.depreciation_method },
          { icon: <Hash size={13} />, label: 'Serial Number', value: asset.serial_number || '—' },
          { icon: <MapPin size={13} />, label: 'Location', value: asset.location || '—' },
          { icon: <CheckCircle size={13} />, label: 'Status', value: asset.status.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()) },
        ].map((d) => (
          <div key={d.label} className="block-card p-3 flex items-start gap-2">
            <span className="text-text-muted mt-0.5">{d.icon}</span>
            <div>
              <p className="text-xs text-text-muted">{d.label}</p>
              <p className="text-sm font-semibold text-text-primary mt-0.5">{d.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border-primary">
        {DETAIL_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold transition-colors border-b-2 -mb-px ${
              tab === t.key ? 'border-accent-blue text-accent-blue' : 'border-transparent text-text-muted hover:text-text-primary transition-colors'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Schedule Tab */}
      {tab === 'schedule' && (
        <div className="block-card overflow-hidden">
          {schedule.length === 0 ? (
            <div className="empty-state py-10">
              <p className="text-text-muted text-sm">No depreciation schedule available.</p>
            </div>
          ) : (
            <table className="block-table w-full">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Period Label</th>
                  <th className="text-right">Depreciation</th>
                  <th className="text-right">Accumulated</th>
                  <th className="text-right">Book Value</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((s, i) => (
                  <tr key={i}>
                    <td className="text-text-muted text-xs">{s.period}</td>
                    <td>{s.period_label}</td>
                    <td className="text-right text-accent-expense">{fmt.format(s.depreciation_amount)}</td>
                    <td className="text-right text-text-secondary">{fmt.format(s.accumulated_depreciation)}</td>
                    <td className="text-right text-accent-income font-semibold">{fmt.format(s.book_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* History Tab */}
      {tab === 'history' && (
        <div className="block-card overflow-hidden">
          {history.length === 0 ? (
            <div className="empty-state py-10">
              <div className="empty-state-icon"><TrendingDown size={28} /></div>
              <p className="text-text-muted text-sm mt-2">No depreciation entries posted yet.</p>
              <p className="text-text-muted text-xs mt-1">Run Monthly Depreciation from the asset list to post entries.</p>
            </div>
          ) : (
            <table className="block-table w-full">
              <thead>
                <tr>
                  <th>Period Date</th>
                  <th>Period Label</th>
                  <th className="text-right">Depreciation</th>
                  <th className="text-right">Accumulated</th>
                  <th className="text-right">Book Value</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="text-text-muted text-xs font-mono">{h.period_date}</td>
                    <td>{h.period_label}</td>
                    <td className="text-right text-accent-expense">{fmt.format(h.depreciation_amount)}</td>
                    <td className="text-right text-text-secondary">{fmt.format(h.accumulated_depreciation)}</td>
                    <td className="text-right text-accent-income font-semibold">{fmt.format(h.book_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Chart Tab */}
      {tab === 'chart' && (
        <div className="block-card p-4">
          <h3 className="text-sm font-bold text-text-primary mb-4">Book Value Over Time</h3>
          {chartData.length === 0 ? (
            <div className="empty-state py-10">
              <p className="text-text-muted text-sm">No data to chart.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
                  angle={-45}
                  textAnchor="end"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--color-bg-elevated)',
                    border: '1px solid var(--color-border-primary)',
                    borderRadius: '6px',
                    fontSize: '12px',
                  }}
                  formatter={(v) => fmt.format(Number(v))}
                />
                <Bar dataKey="bookValue" name="Book Value" fill="var(--color-accent-blue)" radius={0} />
                <Bar dataKey="depreciation" name="Depreciation" fill="var(--color-accent-expense)" radius={0} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
// MODULE ROUTER
// ═══════════════════════════════════════════════════════════
const FixedAssetsModule: React.FC = () => {
  const [view, setView] = useState<View>({ type: 'list' });

  const goList = useCallback(() => setView({ type: 'list' }), []);
  const goNew = useCallback(() => setView({ type: 'new' }), []);
  const goEdit = useCallback((id: string) => setView({ type: 'edit', assetId: id }), []);
  const goDetail = useCallback((id: string) => setView({ type: 'detail', assetId: id }), []);

  switch (view.type) {
    case 'new':
      return <AssetForm onBack={goList} onSaved={goDetail} />;
    case 'edit':
      return <AssetForm assetId={view.assetId} onBack={() => goDetail(view.assetId)} onSaved={goDetail} />;
    case 'detail':
      return <AssetDetail assetId={view.assetId} onBack={goList} onEdit={goEdit} />;
    case 'list':
    default:
      return <AssetList onNew={goNew} onView={goDetail} onEdit={goEdit} />;
  }
};

export default FixedAssetsModule;
