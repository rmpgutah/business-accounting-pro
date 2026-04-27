import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { ArrowLeft, Plus, Search, Trash2, Package, CheckCircle } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency } from '../../lib/format';
import ErrorBanner from '../../components/ErrorBanner';

// ─── Types ──────────────────────────────────────────────
//
// IMPORTANT: form-state property names must match the actual SQLite columns
// on `invoice_catalog_items`. The generic `db.create`/`db.update` IPC builds
// the SQL by spreading whatever keys are in the payload, so a key with no
// matching column raises `SqliteError: no such column ...` and the row never
// persists. Use the schema names directly:
//   item_code   (not "sku")
//   unit_price  (not "default_price")
//   unit_label  (not "default_unit")
//   tax_rate    (not "default_tax_rate")
//   default_quantity (added via migration so we can default fill on invoices)
//
// User-facing labels remain friendly ("Default Price", etc.) — only the
// state property names are aligned with the DB.
interface CatalogItem {
  id: string;
  company_id: string;
  name: string;
  description: string;
  unit_price: number;
  default_quantity: number;
  unit_label: string;
  tax_rate: number;
  account_id: string;
  item_code: string;
  created_at: string;
}

interface Account {
  id: string;
  name: string;
  code: string;
}

interface FormState {
  name: string;
  description: string;
  item_code: string;
  unit_price: number;
  default_quantity: number;
  unit_label: string;
  tax_rate: number;
  account_id: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  item_code: '',
  unit_price: 0,
  default_quantity: 1,
  unit_label: '',
  tax_rate: 0,
  account_id: '',
};

interface CatalogManagerProps {
  onBack: () => void;
}

const CatalogManager: React.FC<CatalogManagerProps> = ({ onBack }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Surface save failures so future schema drift can't hide silently.
  const [saveError, setSaveError] = useState('');

  const reload = useCallback(async () => {
    if (!activeCompany) return;
    try {
      const [itemRows, accountRows] = await Promise.all([
        api.query('invoice_catalog_items', { company_id: activeCompany.id }),
        api.query('accounts', { company_id: activeCompany.id, type: 'revenue' }),
      ]);
      setItems(Array.isArray(itemRows) ? (itemRows as CatalogItem[]) : []);
      setAccounts(Array.isArray(accountRows) ? (accountRows as Account[]) : []);
    } catch (err) {
      console.error('Failed to load catalog:', err);
    } finally {
      setLoading(false);
    }
  }, [activeCompany]);

  useEffect(() => {
    reload();
  }, [reload]);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q) ||
        (i.item_code || '').toLowerCase().includes(q)
    );
  }, [items, search]);

  const handleNew = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSaveError('');
  };

  const handleEdit = (item: CatalogItem) => {
    setEditingId(item.id);
    setSaveError('');
    setForm({
      name: item.name,
      description: item.description || '',
      // Read schema column names so prior values round-trip on edit.
      item_code: item.item_code || '',
      unit_price: Number(item.unit_price) || 0,
      default_quantity: Number(item.default_quantity) || 1,
      unit_label: item.unit_label || '',
      tax_rate: Number(item.tax_rate) || 0,
      account_id: item.account_id || '',
    });
  };

  const handleSave = async () => {
    if (saving) return;
    if (!form.name.trim()) return;
    setSaving(true);
    setSaveError('');
    try {
      if (editingId) {
        const res: any = await api.update('invoice_catalog_items', editingId, form);
        // db.update returns the row OR { error } on IPC failure paths
        if (res && typeof res === 'object' && 'error' in res) throw new Error(String(res.error));
      } else {
        const result: any = await api.create('invoice_catalog_items', {
          ...form,
          company_id: activeCompany?.id,
        });
        if (result && typeof result === 'object' && 'error' in result) throw new Error(String(result.error));
        if (result?.id) setEditingId(result.id);
      }
      await reload();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      console.error('Failed to save catalog item:', err);
      setSaveError(err?.message || 'Save failed. Open DevTools console for details.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete catalog item "${name}"? This cannot be undone.`)) return;
    try {
      await api.remove('invoice_catalog_items', id);
      if (editingId === id) {
        setEditingId(null);
        setForm(EMPTY_FORM);
      }
      await reload();
    } catch (err) {
      console.error('Failed to delete catalog item:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading catalog...
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 h-full overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <button className="block-btn flex items-center gap-2 px-3 py-2" onClick={onBack}>
            <ArrowLeft size={14} /> Back
          </button>
          <div>
            <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
              <Package size={18} /> Catalog Items
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              Save frequently-used invoice line items for one-click reuse.
            </p>
          </div>
        </div>
        <button className="block-btn-primary flex items-center gap-2" onClick={handleNew}>
          <Plus size={14} /> New Item
        </button>
      </div>

      {/* Split view */}
      <div className="flex-1 grid grid-cols-5 gap-4 overflow-hidden">
        {/* Left: list */}
        <div className="col-span-2 flex flex-col overflow-hidden">
          <div className="relative mb-2 flex-shrink-0">
            <Search size={14} className="absolute left-2 top-2.5 text-text-muted" />
            <input
              className="block-input pl-8"
              placeholder="Search by name, SKU, description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex-1 overflow-y-auto space-y-1.5">
            {filtered.length === 0 ? (
              <div className="text-center py-8 text-text-muted text-xs">
                {items.length === 0 ? 'No catalog items yet. Click "New Item" to add one.' : 'No matches for search.'}
              </div>
            ) : (
              filtered.map((item) => (
                <div
                  key={item.id}
                  className={`p-2.5 border cursor-pointer transition-colors ${
                    editingId === item.id
                      ? 'border-accent-blue bg-accent-blue/5'
                      : 'border-border-primary hover:bg-bg-hover transition-colors'
                  }`}
                  style={{ borderRadius: '6px' }}
                  onClick={() => handleEdit(item)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-text-primary truncate">{item.name}</p>
                      {item.description && (
                        <p className="text-xs text-text-muted truncate">{item.description}</p>
                      )}
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs font-mono text-accent-income">
                          {formatCurrency(item.unit_price)}
                        </span>
                        {item.unit_label && (
                          <span className="text-[10px] text-text-muted">/ {item.unit_label}</span>
                        )}
                        {item.item_code && (
                          <span className="text-[10px] font-mono text-text-muted">SKU: {item.item_code}</span>
                        )}
                      </div>
                    </div>
                    <button
                      className="text-text-muted hover:text-accent-expense transition-colors p-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(item.id, item.name);
                      }}
                      title="Delete"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: form */}
        <div className="col-span-3 flex flex-col overflow-y-auto">
          <div className="block-card p-5 space-y-4" style={{ borderRadius: '6px' }}>
            {/* Save errors surface here — replaces the silent console.error
                that hid the schema/form mismatch for so long. */}
            {saveError && (
              <ErrorBanner
                title="Failed to save catalog item"
                message={saveError}
                onDismiss={() => setSaveError('')}
              />
            )}
            <div className="flex items-center justify-between pb-2 border-b border-border-primary">
              <h3 className="text-sm font-bold text-text-primary">
                {editingId ? 'Edit Item' : 'New Item'}
              </h3>
              {saved && (
                <span className="text-xs text-accent-income flex items-center gap-1">
                  <CheckCircle size={12} /> Saved
                </span>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Name <span className="text-accent-expense">*</span>
              </label>
              <input
                className="block-input"
                placeholder="e.g. Web Design — Hourly"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Description
              </label>
              <textarea
                className="block-input"
                rows={3}
                placeholder="Detailed description that auto-fills on invoices..."
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                style={{ resize: 'vertical' }}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  SKU / Item Code
                </label>
                <input
                  className="block-input"
                  placeholder="e.g. WEB-DESIGN-001"
                  value={form.item_code}
                  onChange={(e) => setForm((f) => ({ ...f, item_code: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Default Unit
                </label>
                <input
                  className="block-input"
                  placeholder="hrs, ea, kg, etc."
                  value={form.unit_label}
                  onChange={(e) => setForm((f) => ({ ...f, unit_label: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Default Price
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="block-input font-mono"
                  value={form.unit_price}
                  onChange={(e) => setForm((f) => ({ ...f, unit_price: parseFloat(e.target.value) || 0 }))}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Default Qty
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="block-input font-mono"
                  value={form.default_quantity}
                  onChange={(e) => setForm((f) => ({ ...f, default_quantity: parseFloat(e.target.value) || 0 }))}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Tax Rate %
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="block-input font-mono"
                  value={form.tax_rate}
                  onChange={(e) => setForm((f) => ({ ...f, tax_rate: parseFloat(e.target.value) || 0 }))}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Revenue Account
              </label>
              <select
                className="block-select w-full"
                value={form.account_id}
                onChange={(e) => setForm((f) => ({ ...f, account_id: e.target.value }))}
              >
                <option value="">— None —</option>
                {[...accounts]
                  .sort((a, b) => `${a.code} — ${a.name}`.localeCompare(`${b.code} — ${b.name}`, undefined, { sensitivity: 'base' }))
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.name}
                    </option>
                  ))}
              </select>
            </div>

            <div className="flex items-center gap-3 pt-2 border-t border-border-primary">
              <button
                className="block-btn-primary flex items-center gap-2"
                onClick={handleSave}
                disabled={saving || !form.name.trim()}
              >
                {saving ? 'Saving...' : editingId ? 'Update Item' : 'Save Item'}
              </button>
              {editingId && (
                <button className="block-btn" onClick={handleNew}>
                  Clear / New
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CatalogManager;
