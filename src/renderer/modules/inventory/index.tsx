import React, { useEffect, useState, useMemo } from 'react';
import {
  Package, Plus, Search, Filter, AlertTriangle, X, ArrowDown, ArrowUp, RefreshCw, History, Pencil, Trash2, ArrowUpDown,
} from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import { useCompanyStore } from '../../stores/companyStore';
import ErrorBanner from '../../components/ErrorBanner';
import {
  INVENTORY_CATEGORY,
  ClassificationBadge, ClassificationSelect,
} from '../../lib/classifications';

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
  reorder_qty: number;
  is_asset: boolean;
  purchase_date: string;
  created_at: string;
}

interface Movement {
  id: string;
  item_id: string;
  type: string;
  quantity: number;
  unit_cost: number;
  reference: string;
  notes: string;
  created_at: string;
}

// ─── Currency Formatter ─────────────────────────────────
// Route through the shared helper so NaN/Infinity render as $0.00 rather
// than $NaN (e.g. when a unit_cost is null and qty * cost = NaN).
const fmt = { format: (v: number | string | null | undefined) => formatCurrency(v) };

// ─── Empty Form ─────────────────────────────────────────
const emptyForm = {
  name: '',
  sku: '',
  description: '',
  category: '',
  quantity: 0,
  unit_cost: 0,
  reorder_point: 0,
  reorder_qty: 0,
  is_asset: false,
  purchase_date: '',
};

const emptyAdjust = {
  type: 'in' as 'in' | 'out' | 'adjustment',
  quantity: '',
  unit_cost: '',
  reference: '',
  notes: '',
};

// ─── Movement type badge ──────────────────────────────────
function MovBadge({ type }: { type: string }) {
  const map: Record<string, { icon: React.ReactNode; cls: string; label: string }> = {
    in:          { icon: <ArrowDown size={10} />, cls: 'text-accent-income border-accent-income', label: 'IN' },
    out:         { icon: <ArrowUp size={10} />,   cls: 'text-accent-expense border-accent-expense', label: 'OUT' },
    adjustment:  { icon: <RefreshCw size={10} />, cls: 'text-accent-blue border-accent-blue',   label: 'ADJ' },
    initial:     { icon: <Package size={10} />,   cls: 'text-text-muted border-border-secondary', label: 'INIT' },
  };
  const m = map[type] ?? map.adjustment;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold border px-1.5 py-0.5 ${m.cls}`}>
      {m.icon} {m.label}
    </span>
  );
}

// ─── Component ──────────────────────────────────────────
const Inventory: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'low-stock'>('all');

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  type InvSortField = 'name' | 'sku' | 'category' | 'quantity' | 'unit_cost';
  type InvSortDir = 'asc' | 'desc';
  const [sortField, setSortField] = useState<InvSortField>('name');
  const [sortDir, setSortDir] = useState<InvSortDir>('asc');
  const [opSuccess, setOpSuccess] = useState('');
  const [opError, setOpError] = useState('');
  const [error, setError] = useState('');

  // Adjust modal
  const [adjustItem, setAdjustItem] = useState<InventoryItem | null>(null);
  const [adjustForm, setAdjustForm] = useState(emptyAdjust);
  const [adjusting, setAdjusting] = useState(false);

  // History drawer
  const [historyItem, setHistoryItem] = useState<InventoryItem | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const handleInvSort = (f: InvSortField) => { if (sortField === f) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortField(f); setSortDir('asc'); } };

  // ─── Load ─────────────────────────────────────────────
  const loadItems = async () => {
    if (!activeCompany) return;
    setError('');
    try {
      const rows = await api.query('inventory_items', { company_id: activeCompany.id });
      setItems(Array.isArray(rows) ? rows : []);
    } catch (err: any) {
      console.error('Failed to load inventory:', err);
      setError(err?.message || 'Failed to load inventory');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadItems(); }, [activeCompany]);

  // ─── Categories ───────────────────────────────────────
  const categories = useMemo(() => {
    const cats = new Set<string>();
    items.forEach(i => { if (i.category) cats.add(i.category); });
    return Array.from(cats).sort();
  }, [items]);

  // ─── Filtered ─────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = items;
    if (activeTab === 'low-stock') list = list.filter(i => i.reorder_point > 0 && i.quantity <= i.reorder_point);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(i =>
        i.name?.toLowerCase().includes(q) || i.sku?.toLowerCase().includes(q) ||
        i.description?.toLowerCase().includes(q) || i.category?.toLowerCase().includes(q)
      );
    }
    if (categoryFilter) list = list.filter(i => i.category === categoryFilter);
    list.sort((a, b) => {
      const aVal = (a as any)[sortField] ?? '';
      const bVal = (b as any)[sortField] ?? '';
      if (typeof aVal === 'number' && typeof bVal === 'number') return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return list;
  }, [items, search, categoryFilter, activeTab, sortField, sortDir]);

  // ─── Stats ────────────────────────────────────────────
  const totalValue = useMemo(() =>
    items.reduce((sum, i) => sum + (i.quantity || 0) * (i.unit_cost || 0), 0), [items]);
  const lowStockCount = useMemo(() =>
    items.filter(i => i.reorder_point > 0 && i.quantity <= i.reorder_point).length, [items]);

  // ─── Create Item ──────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        ...formData,
        quantity: Number(formData.quantity),
        unit_cost: Number(formData.unit_cost),
        reorder_point: Number(formData.reorder_point),
        reorder_qty: Number(formData.reorder_qty),
        is_asset: formData.is_asset ? 1 : 0,
      };
      if (editingId) {
        await api.update('inventory_items', editingId, payload);
      } else {
        await api.create('inventory_items', payload);
      }
      setOpSuccess(editingId ? 'Item updated' : 'Item created'); setTimeout(() => setOpSuccess(''), 3000);
      setFormData(emptyForm);
      setEditingId(null);
      setShowForm(false);
      setLoading(true);
      await loadItems();
    } catch (err: any) {
      console.error('Failed to create inventory item:', err);
      setOpError('Failed to save: ' + (err?.message || 'Unknown error')); setTimeout(() => setOpError(''), 5000);
      alert('Failed to save: ' + (err?.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  // ─── Stock Adjustment ─────────────────────────────────
  const handleAdjust = async () => {
    if (!adjustItem || !adjustForm.quantity) return;
    setAdjusting(true);
    try {
      const result = await api.inventoryAdjust({
        itemId: adjustItem.id,
        type: adjustForm.type,
        quantity: Math.abs(parseFloat(adjustForm.quantity) || 0),
        unitCost: parseFloat(adjustForm.unit_cost) || adjustItem.unit_cost,
        reference: adjustForm.reference,
        notes: adjustForm.notes,
      });
      if (result?.error) throw new Error(result.error);
      setAdjustItem(null);
      setAdjustForm(emptyAdjust);
      setOpSuccess('Stock adjusted'); setTimeout(() => setOpSuccess(''), 3000);
      await loadItems();
    } catch (err: any) {
      console.error('Adjustment failed:', err);
      setOpError('Failed to adjust stock: ' + (err?.message || 'Unknown error')); setTimeout(() => setOpError(''), 5000);
    } finally {
      setAdjusting(false);
    }
  };

  // ─── View History ─────────────────────────────────────
  const handleHistory = async (item: InventoryItem) => {
    setHistoryItem(item);
    setLoadingHistory(true);
    try {
      const data = await api.inventoryMovements(item.id);
      setMovements(Array.isArray(data) ? data : []);
    } catch { setMovements([]); } finally { setLoadingHistory(false); }
  };

  // ─── Edit / Delete ───────────────────────────────────
  const handleEdit = (item: InventoryItem) => {
    setEditingId(item.id);
    setFormData({
      name: item.name,
      sku: item.sku || '',
      description: item.description || '',
      category: item.category || '',
      quantity: item.quantity,
      unit_cost: item.unit_cost,
      reorder_point: item.reorder_point,
      reorder_qty: item.reorder_qty,
      is_asset: !!item.is_asset,
      purchase_date: item.purchase_date || '',
    });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this inventory item? This will also remove its movement history.')) return;
    try {
      await api.remove('inventory_items', id);
      await loadItems();
    } catch (err: any) {
      console.error('Failed to delete inventory item:', err);
      alert('Failed to delete: ' + (err?.message || 'Unknown error'));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">
        Loading inventory...
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      {error && <ErrorBanner message={error} title="Failed to load inventory" onDismiss={() => setError('')} />}
      {/* Header */}
      <div className="module-header">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary" style={{ borderRadius: '6px' }}>
            <Package size={18} className="text-accent-blue" />
          </div>
          <div>
            <h2 className="module-title text-text-primary">Inventory</h2>
            <p className="text-xs text-text-muted mt-0.5">
              {items.length} items · {fmt.format(totalValue)} total value
              {lowStockCount > 0 && (
                <span className="text-accent-expense ml-2 font-semibold">· {lowStockCount} low stock</span>
              )}
            </p>
          </div>
        </div>
        <button className="block-btn-primary flex items-center gap-2" onClick={() => setShowForm(true)}>
          <Plus size={16} /> Add Item
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-border-primary">
        {([['all', 'All Items'], ['low-stock', `Low Stock${lowStockCount > 0 ? ` (${lowStockCount})` : ''}`]] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key as any)}
            className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === key
                ? key === 'low-stock' ? 'border-accent-expense text-accent-expense' : 'border-accent-blue text-accent-blue'
                : 'border-transparent text-text-muted hover:text-text-secondary transition-colors'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* New Item Form */}
      {showForm && (
        <div className="block-card p-5 space-y-4" style={{ borderRadius: '6px' }}>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text-primary">{editingId ? 'Edit Inventory Item' : 'New Inventory Item'}</h3>
            <button className="text-text-muted hover:text-text-primary transition-colors" onClick={() => { setShowForm(false); setEditingId(null); setFormData(emptyForm); }}>
              <X size={16} />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">Name *</label>
                <input className="block-input w-full" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="Item name" required />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">SKU</label>
                <input className="block-input w-full" value={formData.sku} onChange={e => setFormData({ ...formData, sku: e.target.value })} placeholder="SKU-001" />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Category</label>
                <ClassificationSelect def={INVENTORY_CATEGORY} value={formData.category} onChange={(v) => setFormData({ ...formData, category: v })} />
              </div>
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">Description</label>
              <input className="block-input w-full" value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} placeholder="Item description" />
            </div>
            <div className="grid grid-cols-5 gap-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">Qty</label>
                <input type="number" className="block-input w-full" value={formData.quantity} onChange={e => setFormData({ ...formData, quantity: Number(e.target.value) })} min={0} />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Unit Cost</label>
                <input type="number" step="0.01" className="block-input w-full" value={formData.unit_cost} onChange={e => setFormData({ ...formData, unit_cost: Number(e.target.value) })} min={0} />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Reorder Point</label>
                <input type="number" className="block-input w-full" value={formData.reorder_point} onChange={e => setFormData({ ...formData, reorder_point: Number(e.target.value) })} min={0} />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Reorder Qty</label>
                <input type="number" className="block-input w-full" value={formData.reorder_qty} onChange={e => setFormData({ ...formData, reorder_qty: Number(e.target.value) })} min={0} />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Purchase Date</label>
                <input type="date" className="block-input w-full" value={formData.purchase_date} onChange={e => setFormData({ ...formData, purchase_date: e.target.value })} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="is_asset" checked={formData.is_asset} onChange={e => setFormData({ ...formData, is_asset: e.target.checked })} className="accent-accent-blue" />
              <label htmlFor="is_asset" className="text-sm text-text-secondary">Track as fixed asset</label>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button type="button" className="block-btn" onClick={() => { setShowForm(false); setEditingId(null); setFormData(emptyForm); }}>Cancel</button>
              <button type="submit" className="block-btn-primary" disabled={saving}>{saving ? 'Saving...' : editingId ? 'Update Item' : 'Create Item'}</button>
            </div>
          </form>
        </div>
      )}

      {/* Stock Adjustment Modal */}
      {adjustItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="block-card p-5 w-96 space-y-4" style={{ borderRadius: '6px' }}>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-text-primary">Adjust Stock — {adjustItem.name}</h3>
              <button onClick={() => setAdjustItem(null)}><X size={16} className="text-text-muted" /></button>
            </div>
            <p className="text-xs text-text-muted">Current qty: <span className="font-mono font-bold text-text-primary">{adjustItem.quantity}</span></p>
            <div className="grid grid-cols-3 gap-2">
              {(['in', 'out', 'adjustment'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setAdjustForm(p => ({ ...p, type: t }))}
                  className={`py-2 text-xs font-bold uppercase border-2 transition-colors ${
                    adjustForm.type === t
                      ? t === 'in' ? 'border-accent-income text-accent-income bg-accent-income/10'
                        : t === 'out' ? 'border-accent-expense text-accent-expense bg-accent-expense/10'
                        : 'border-accent-blue text-accent-blue bg-accent-blue/10'
                      : 'border-border-primary text-text-muted'
                  }`}
                  style={{ borderRadius: '6px' }}
                >
                  {t === 'in' ? '▼ Receive' : t === 'out' ? '▲ Ship' : '↺ Adjust'}
                </button>
              ))}
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">Quantity *</label>
                <input
                  type="number" min="0" step="0.01" className="block-input w-full font-mono"
                  value={adjustForm.quantity} placeholder="0"
                  onChange={e => setAdjustForm(p => ({ ...p, quantity: e.target.value }))}
                />
              </div>
              {adjustForm.type === 'in' && (
                <div>
                  <label className="block text-xs text-text-muted mb-1">Unit Cost (optional)</label>
                  <input
                    type="number" min="0" step="0.01" className="block-input w-full font-mono"
                    value={adjustForm.unit_cost} placeholder={String(adjustItem.unit_cost)}
                    onChange={e => setAdjustForm(p => ({ ...p, unit_cost: e.target.value }))}
                  />
                </div>
              )}
              <div>
                <label className="block text-xs text-text-muted mb-1">Reference / PO #</label>
                <input className="block-input w-full" value={adjustForm.reference} onChange={e => setAdjustForm(p => ({ ...p, reference: e.target.value }))} placeholder="PO-1234" />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Notes</label>
                <input className="block-input w-full" value={adjustForm.notes} onChange={e => setAdjustForm(p => ({ ...p, notes: e.target.value }))} placeholder="Reason for adjustment..." />
              </div>
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button className="block-btn text-xs px-3 py-2" onClick={() => { setAdjustItem(null); setAdjustForm(emptyAdjust); }}>Cancel</button>
              <button
                className="block-btn-primary text-xs px-4 py-2 font-semibold"
                onClick={handleAdjust}
                disabled={adjusting || !adjustForm.quantity}
              >
                {adjusting ? 'Saving...' : 'Save Adjustment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History Drawer */}
      {historyItem && (
        <div className="fixed inset-0 z-50 flex items-end justify-end">
          <div className="absolute inset-0 bg-black/30 cursor-pointer" onClick={() => setHistoryItem(null)} />
          <div className="relative bg-bg-secondary border-l-2 border-border-primary h-full w-96 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-border-primary flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-text-primary">Movement History</h3>
                <p className="text-xs text-text-muted">{historyItem.name}</p>
              </div>
              <button onClick={() => setHistoryItem(null)}><X size={16} className="text-text-muted" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {loadingHistory ? (
                <p className="text-xs text-text-muted italic">Loading...</p>
              ) : movements.length === 0 ? (
                <div className="text-center pt-8">
                  <History size={24} className="text-text-muted mx-auto mb-2" />
                  <p className="text-xs text-text-muted">No movements recorded yet.</p>
                </div>
              ) : (
                movements.map(m => (
                  <div key={m.id} className="block-card p-3 flex items-start justify-between gap-2" style={{ borderRadius: '6px' }}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <MovBadge type={m.type} />
                        <span className="text-xs font-mono font-bold text-text-primary">
                          {m.type === 'out' ? '-' : '+'}{m.quantity}
                        </span>
                        {m.unit_cost > 0 && (
                          <span className="text-xs text-text-muted">@ {fmt.format(m.unit_cost)}</span>
                        )}
                      </div>
                      {m.reference && <p className="text-[10px] text-text-muted">Ref: {m.reference}</p>}
                      {m.notes && <p className="text-[10px] text-text-secondary truncate">{m.notes}</p>}
                    </div>
                    <span className="text-[10px] text-text-muted whitespace-nowrap shrink-0">
                      {m.created_at?.slice(0, 10)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input type="text" placeholder="Search inventory..." className="block-input pl-9 w-full" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-text-muted" />
          <select className="block-select" style={{ width: 'auto', minWidth: '150px' }} value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
            <option value="">All Categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* Low Stock Alert Banner */}
      {activeTab === 'all' && lowStockCount > 0 && (
        <div
          className="flex items-center gap-2 px-4 py-2 border text-xs"
          style={{ borderColor: 'var(--color-accent-expense)', background: 'rgba(239,68,68,0.08)', borderRadius: '6px', color: 'var(--color-accent-expense)' }}
        >
          <AlertTriangle size={13} />
          <strong>{lowStockCount} item{lowStockCount !== 1 ? 's' : ''} at or below reorder point.</strong>
          <button className="ml-2 underline" onClick={() => setActiveTab('low-stock')}>View Low Stock</button>
        </div>
      )}

      {opSuccess && <div className="text-xs text-accent-income bg-accent-income/10 px-3 py-2 border border-accent-income/20" style={{ borderRadius: '6px' }}>{opSuccess}</div>}
      {opError && <div className="text-xs text-accent-expense bg-accent-expense/10 px-3 py-2 border border-accent-expense/20" style={{ borderRadius: '6px' }}>{opError}</div>}

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><Package size={24} className="text-text-muted" /></div>
          <p className="text-sm text-text-secondary font-medium">
            {activeTab === 'low-stock' ? 'No low stock items' : 'No inventory items found'}
          </p>
          <p className="text-xs text-text-muted mt-1">
            {activeTab === 'low-stock' ? 'All items are stocked above their reorder points.' : 'Add your first item using the button above.'}
          </p>
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden">
          <table className="block-table">
            <thead>
              <tr>
                <th className="cursor-pointer select-none" onClick={() => handleInvSort('name')} role="button" tabIndex={0}><span className="inline-flex items-center gap-1">Name {sortField === 'name' && (sortDir === 'asc' ? '↑' : '↓')}</span></th>
                <th className="cursor-pointer select-none" onClick={() => handleInvSort('sku')} role="button" tabIndex={0}><span className="inline-flex items-center gap-1">SKU {sortField === 'sku' && (sortDir === 'asc' ? '↑' : '↓')}</span></th>
                <th className="cursor-pointer select-none" onClick={() => handleInvSort('category')} role="button" tabIndex={0}><span className="inline-flex items-center gap-1">Category {sortField === 'category' && (sortDir === 'asc' ? '↑' : '↓')}</span></th>
                <th className="text-right cursor-pointer select-none" onClick={() => handleInvSort('quantity')} role="button" tabIndex={0}><span className="inline-flex items-center gap-1">Qty {sortField === 'quantity' && (sortDir === 'asc' ? '↑' : '↓')}</span></th>
                <th className="text-right cursor-pointer select-none" onClick={() => handleInvSort('unit_cost')} role="button" tabIndex={0}><span className="inline-flex items-center gap-1">Unit Cost {sortField === 'unit_cost' && (sortDir === 'asc' ? '↑' : '↓')}</span></th>
                <th className="text-right">Total Value</th>
                <th className="text-right">Reorder At</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => {
                const isLow = item.reorder_point > 0 && item.quantity <= item.reorder_point;
                return (
                  <tr key={item.id} style={isLow ? { background: 'rgba(239,68,68,0.04)' } : {}}>
                    <td className="text-text-primary font-medium">
                      <div className="flex items-center gap-2">
                        {isLow && <AlertTriangle size={12} className="text-accent-expense shrink-0" />}
                        <span className="block truncate max-w-[180px]">{item.name}</span>
                        {item.is_asset && <span className="block-badge text-[10px]">Asset</span>}
                      </div>
                    </td>
                    <td className="font-mono text-text-secondary text-xs">{item.sku || '—'}</td>
                    <td className="text-text-secondary text-sm truncate max-w-[140px]"><ClassificationBadge def={INVENTORY_CATEGORY} value={item.category} /></td>
                    <td className={`text-right font-mono font-semibold ${isLow ? 'text-accent-expense' : 'text-text-primary'}`}>
                      {item.quantity}
                      {isLow && item.reorder_qty > 0 && (
                        <span className="block text-[10px] text-text-muted font-normal">order {item.reorder_qty}</span>
                      )}
                    </td>
                    <td className="text-right font-mono text-text-secondary text-sm">{fmt.format(item.unit_cost)}</td>
                    <td className="text-right font-mono text-text-primary font-medium text-sm">{fmt.format(item.quantity * item.unit_cost)}</td>
                    <td className="text-right font-mono text-text-muted text-sm">{item.reorder_point || '—'}</td>
                    <td className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          className="block-btn text-xs px-2 py-1 inline-flex items-center gap-1"
                          onClick={() => { setAdjustItem(item); setAdjustForm(emptyAdjust); }}
                          title="Adjust stock"
                        >
                          <RefreshCw size={10} /> Adjust
                        </button>
                        <button
                          className="block-btn text-xs px-2 py-1 inline-flex items-center gap-1"
                          onClick={() => handleHistory(item)}
                          title="View movement history"
                        >
                          <History size={10} /> History
                        </button>
                        <button
                          className="block-btn text-xs px-2 py-1 inline-flex items-center gap-1"
                          onClick={() => handleEdit(item)}
                          title="Edit item"
                        >
                          <Pencil size={10} /> Edit
                        </button>
                        <button
                          className="block-btn text-xs px-2 py-1 inline-flex items-center gap-1 text-accent-expense hover:bg-accent-expense/10 transition-colors"
                          onClick={() => handleDelete(item.id)}
                          title="Delete item"
                        >
                          <Trash2 size={10} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} className="text-right text-xs font-semibold text-text-muted uppercase tracking-wider">Total Value</td>
                <td className="text-right font-mono font-bold text-text-primary">{fmt.format(filtered.reduce((s, i) => s + i.quantity * i.unit_cost, 0))}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="text-xs text-text-muted">
          Showing {filtered.length} of {items.length} item{items.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
};

export default Inventory;
