import React, { useEffect, useState, useMemo } from 'react';
import {
  Package, Plus, Search, Filter, AlertTriangle, X, ChevronDown,
} from 'lucide-react';
import { format } from 'date-fns';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

// ─── Types ──────────────────────────────────────────────
interface InventoryItem {
  id: string;
  name: string;
  sku: string;
  description: string;
  category: string;
  quantity: number;
  unit_cost: number;
  reorder_point: number;
  is_asset: boolean;
  purchase_date: string;
  created_at: string;
}

// ─── Currency Formatter ─────────────────────────────────
const fmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// ─── Empty Form ─────────────────────────────────────────
const emptyForm = {
  name: '',
  sku: '',
  description: '',
  category: '',
  quantity: 0,
  unit_cost: 0,
  reorder_point: 0,
  is_asset: false,
  purchase_date: '',
};

// ─── Component ──────────────────────────────────────────
const Inventory: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  // ─── Load ─────────────────────────────────────────────
  const loadItems = async () => {
    if (!activeCompany) return;
    try {
      // Bug fix #13: was fetching all companies' inventory — scoped to active company.
      const rows = await api.query('inventory_items', { company_id: activeCompany.id });
      setItems(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.error('Failed to load inventory:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
  }, [activeCompany]);

  // ─── Categories ───────────────────────────────────────
  const categories = useMemo(() => {
    const cats = new Set<string>();
    items.forEach((i) => { if (i.category) cats.add(i.category); });
    return Array.from(cats).sort();
  }, [items]);

  // ─── Filtered ─────────────────────────────────────────
  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (search) {
        const q = search.toLowerCase();
        const match =
          item.name?.toLowerCase().includes(q) ||
          item.sku?.toLowerCase().includes(q) ||
          item.description?.toLowerCase().includes(q) ||
          item.category?.toLowerCase().includes(q);
        if (!match) return false;
      }
      if (categoryFilter && item.category !== categoryFilter) return false;
      return true;
    });
  }, [items, search, categoryFilter]);

  // ─── Stats ────────────────────────────────────────────
  const totalValue = useMemo(
    () => filtered.reduce((sum, i) => sum + (i.quantity || 0) * (i.unit_cost || 0), 0),
    [filtered],
  );
  const lowStockCount = useMemo(
    () => items.filter((i) => i.quantity <= i.reorder_point).length,
    [items],
  );

  // ─── Submit Form ──────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;
    setSaving(true);
    try {
      await api.create('inventory_items', {
        ...formData,
        quantity: Number(formData.quantity),
        unit_cost: Number(formData.unit_cost),
        reorder_point: Number(formData.reorder_point),
        is_asset: formData.is_asset ? 1 : 0,
      });
      setFormData(emptyForm);
      setShowForm(false);
      setLoading(true);
      await loadItems();
    } catch (err) {
      console.error('Failed to create inventory item:', err);
    } finally {
      setSaving(false);
    }
  };

  // ─── Loading ──────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">
        Loading inventory...
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      {/* Header */}
      <div className="module-header">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary"
            style={{ borderRadius: '2px' }}
          >
            <Package size={18} className="text-accent-blue" />
          </div>
          <div>
            <h2 className="module-title text-text-primary">Inventory</h2>
            <p className="text-xs text-text-muted mt-0.5">
              {filtered.length} item{filtered.length !== 1 ? 's' : ''} &middot;{' '}
              {fmt.format(totalValue)} total value
              {lowStockCount > 0 && (
                <span className="text-accent-expense ml-2">
                  &middot; {lowStockCount} low stock
                </span>
              )}
            </p>
          </div>
        </div>
        <button
          className="block-btn-primary flex items-center gap-2"
          onClick={() => setShowForm(true)}
        >
          <Plus size={16} />
          Add Item
        </button>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="block-card-elevated space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-primary">New Inventory Item</h3>
            <button
              className="text-text-muted hover:text-text-primary"
              onClick={() => { setShowForm(false); setFormData(emptyForm); }}
            >
              <X size={16} />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">Name *</label>
                <input
                  className="block-input"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Item name"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">SKU</label>
                <input
                  className="block-input"
                  value={formData.sku}
                  onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                  placeholder="SKU-001"
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Category</label>
                <input
                  className="block-input"
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  placeholder="e.g. Office Supplies"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Description</label>
              <input
                className="block-input"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Item description"
              />
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">Quantity</label>
                <input
                  type="number"
                  className="block-input"
                  value={formData.quantity}
                  onChange={(e) => setFormData({ ...formData, quantity: Number(e.target.value) })}
                  min={0}
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Unit Cost</label>
                <input
                  type="number"
                  step="0.01"
                  className="block-input"
                  value={formData.unit_cost}
                  onChange={(e) => setFormData({ ...formData, unit_cost: Number(e.target.value) })}
                  min={0}
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Reorder Point</label>
                <input
                  type="number"
                  className="block-input"
                  value={formData.reorder_point}
                  onChange={(e) => setFormData({ ...formData, reorder_point: Number(e.target.value) })}
                  min={0}
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Purchase Date</label>
                <input
                  type="date"
                  className="block-input"
                  value={formData.purchase_date}
                  onChange={(e) => setFormData({ ...formData, purchase_date: e.target.value })}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_asset"
                checked={formData.is_asset}
                onChange={(e) => setFormData({ ...formData, is_asset: e.target.checked })}
                className="accent-accent-blue"
              />
              <label htmlFor="is_asset" className="text-sm text-text-secondary">
                Track as fixed asset
              </label>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                className="block-btn"
                onClick={() => { setShowForm(false); setFormData(emptyForm); }}
              >
                Cancel
              </button>
              <button type="submit" className="block-btn-primary" disabled={saving}>
                {saving ? 'Saving...' : 'Create Item'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="block-card p-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              placeholder="Search inventory..."
              className="block-input pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-text-muted" />
            <select
              className="block-select"
              style={{ width: 'auto', minWidth: '150px' }}
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Package size={24} className="text-text-muted" />
          </div>
          <p className="text-sm text-text-secondary font-medium">No inventory items found</p>
          <p className="text-xs text-text-muted mt-1">
            Add your first item or adjust the filters above.
          </p>
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden">
          <table className="block-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>SKU</th>
                <th>Category</th>
                <th className="text-right">Quantity</th>
                <th className="text-right">Unit Cost</th>
                <th className="text-right">Total Value</th>
                <th className="text-right">Reorder Point</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const isLowStock = item.quantity <= item.reorder_point;
                return (
                  <tr key={item.id}>
                    <td className="text-text-primary font-medium">
                      <div className="flex items-center gap-2">
                        {isLowStock && (
                          <AlertTriangle size={14} className="text-accent-expense shrink-0" />
                        )}
                        {item.name}
                        {item.is_asset && (
                          <span className="block-badge block-badge-purple text-[10px]">Asset</span>
                        )}
                      </div>
                    </td>
                    <td className="font-mono text-text-secondary text-xs">{item.sku || '-'}</td>
                    <td className="text-text-secondary">{item.category || '-'}</td>
                    <td
                      className={`text-right font-mono ${
                        isLowStock
                          ? 'text-accent-expense font-bold'
                          : 'text-text-primary'
                      }`}
                    >
                      {item.quantity}
                    </td>
                    <td className="text-right font-mono text-text-secondary">
                      {fmt.format(item.unit_cost)}
                    </td>
                    <td className="text-right font-mono text-text-primary font-medium">
                      {fmt.format(item.quantity * item.unit_cost)}
                    </td>
                    <td className="text-right font-mono text-text-muted">{item.reorder_point}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td
                  colSpan={5}
                  className="text-right text-xs font-semibold text-text-muted uppercase tracking-wider"
                >
                  Total Value
                </td>
                <td className="text-right font-mono font-bold text-text-primary">
                  {fmt.format(totalValue)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Footer */}
      {filtered.length > 0 && (
        <div className="text-xs text-text-muted">
          Showing {filtered.length} of {items.length} item{items.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
};

export default Inventory;
