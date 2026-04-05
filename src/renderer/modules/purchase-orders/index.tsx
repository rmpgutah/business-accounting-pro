import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { ShoppingCart, Plus, ArrowLeft, Trash2, CheckCircle, FileText, Package } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate, formatStatus } from '../../lib/format';

// ─── Types ───────────────────────────────────────────────

type View = 'list' | 'form' | 'detail';

type POStatus =
  | 'draft'
  | 'sent'
  | 'approved'
  | 'partially_received'
  | 'received'
  | 'cancelled';

interface PurchaseOrder {
  id: string;
  company_id: string;
  po_number: string;
  vendor_id: string;
  issue_date: string;
  expected_date: string;
  status: POStatus;
  subtotal: number;
  tax_amount: number;
  total: number;
  notes: string;
  created_at: string;
}

interface POLineItem {
  id: string;
  po_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  account_id: string;
  quantity_received: number;
}

interface Vendor {
  id: string;
  name: string;
  email: string;
  phone: string;
}

interface Account {
  id: string;
  name: string;
  code: string;
  type: string;
}

interface POStats {
  total_open: number;
  open_value: number;
  awaiting_approval: number;
  received_this_month: number;
}

interface DraftLineItem {
  tempId: string;
  description: string;
  account_id: string;
  quantity: string;
  unit_price: string;
  amount: number;
}

// ─── Helpers ─────────────────────────────────────────────

const today = () => new Date().toISOString().slice(0, 10);

let _tempId = 0;
const newTempId = () => `tmp-${++_tempId}`;

// ─── POList ──────────────────────────────────────────────

interface POListProps {
  onNew: () => void;
  onView: (id: string) => void;
}

const POList: React.FC<POListProps> = ({ onNew, onView }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Record<string, Vendor>>({});
  const [stats, setStats] = useState<POStats>({
    total_open: 0,
    open_value: 0,
    awaiting_approval: 0,
    received_this_month: 0,
  });
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | POStatus>('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    try {
      const [pos, vens] = await Promise.all([
        api.query('purchase_orders', { company_id: activeCompany.id }),
        api.query('vendors', { company_id: activeCompany.id }),
      ]);

      const vendorMap: Record<string, Vendor> = {};
      (vens || []).forEach((v: Vendor) => { vendorMap[v.id] = v; });
      setVendors(vendorMap);

      const allPos: PurchaseOrder[] = pos || [];
      setOrders(allPos);

      // Stats
      const openStatuses: POStatus[] = ['draft', 'sent', 'approved', 'partially_received'];
      const openPos = allPos.filter((p) => openStatuses.includes(p.status));
      const awaitingPos = allPos.filter((p) => p.status === 'draft' || p.status === 'sent');

      const nowMs = Date.now();
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      const receivedThisMonth = allPos.filter((p) => {
        if (p.status !== 'received') return false;
        const d = new Date(p.created_at);
        return d >= monthStart && d.getTime() <= nowMs;
      });

      setStats({
        total_open: openPos.length,
        open_value: openPos.reduce((s, p) => s + (p.total ?? 0), 0),
        awaiting_approval: awaitingPos.length,
        received_this_month: receivedThisMonth.length,
      });
    } finally {
      setLoading(false);
    }
  }, [activeCompany]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let list = orders;
    if (statusFilter !== 'all') {
      list = list.filter((p) => p.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) => {
        const vendor = vendors[p.vendor_id];
        return (
          p.po_number?.toLowerCase().includes(q) ||
          vendor?.name?.toLowerCase().includes(q) ||
          p.notes?.toLowerCase().includes(q)
        );
      });
    }
    return list.sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
  }, [orders, statusFilter, search, vendors]);

  const STATUS_TABS: Array<'all' | POStatus> = [
    'all', 'draft', 'sent', 'approved', 'partially_received', 'received', 'cancelled',
  ];
  const TAB_LABELS: Record<string, string> = {
    all: 'All',
    draft: 'Draft',
    sent: 'Sent',
    approved: 'Approved',
    partially_received: 'Partially Received',
    received: 'Received',
    cancelled: 'Cancelled',
  };

  return (
    <div>
      {/* Header */}
      <div className="module-header">
        <div>
          <h1 className="module-title flex items-center gap-2">
            <ShoppingCart size={20} className="text-accent-blue" />
            Purchase Orders
          </h1>
          <p className="text-text-muted text-xs mt-0.5">Manage vendor purchase orders</p>
        </div>
        <div className="module-actions">
          <button className="block-btn block-btn-primary flex items-center gap-1.5" onClick={onNew}>
            <Plus size={14} />
            New Purchase Order
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <div className="stat-card block-card">
          <div className="stat-value font-mono text-accent-blue">{stats.total_open}</div>
          <div className="stat-label">Open POs</div>
        </div>
        <div className="stat-card block-card">
          <div className="stat-value font-mono text-accent-income">{formatCurrency(stats.open_value)}</div>
          <div className="stat-label">Open PO Value</div>
        </div>
        <div className="stat-card block-card">
          <div className="stat-value font-mono text-accent-expense">{stats.awaiting_approval}</div>
          <div className="stat-label">Awaiting Approval</div>
        </div>
        <div className="stat-card block-card">
          <div className="stat-value font-mono text-text-primary">{stats.received_this_month}</div>
          <div className="stat-label">Received This Month</div>
        </div>
      </div>

      {/* Filters */}
      <div className="block-card mb-4 p-3">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Search */}
          <input
            className="block-input text-xs font-mono"
            style={{ width: 260 }}
            placeholder="Search PO #, vendor, notes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {/* Status tabs */}
          <div className="flex items-center gap-1 flex-wrap">
            {STATUS_TABS.map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1 text-[10px] font-semibold tracking-wide transition-colors ${
                  statusFilter === s
                    ? 'bg-accent-blue text-white'
                    : 'bg-bg-tertiary text-text-secondary hover:text-text-primary border border-border-primary'
                }`}
                style={{ borderRadius: '2px' }}
              >
                {TAB_LABELS[s]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="block-card">
        {loading ? (
          <div className="text-text-muted text-xs font-mono p-6 text-center">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <ShoppingCart size={32} />
            </div>
            <div className="text-text-secondary text-sm">No purchase orders found</div>
            <div className="text-text-muted text-xs mt-1">Create your first PO to get started</div>
          </div>
        ) : (
          <table className="block-table w-full">
            <thead>
              <tr>
                <th className="text-[10px]">PO #</th>
                <th className="text-[10px]">Vendor</th>
                <th className="text-[10px]">Order Date</th>
                <th className="text-[10px]">Expected Date</th>
                <th className="text-[10px] text-right">Total</th>
                <th className="text-[10px]">Status</th>
                <th className="text-[10px]"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((po) => (
                <tr key={po.id} className="hover:bg-bg-secondary transition-colors cursor-pointer" onClick={() => onView(po.id)}>
                  <td className="font-mono text-xs text-accent-blue">{po.po_number}</td>
                  <td className="text-xs text-text-primary">{vendors[po.vendor_id]?.name ?? '—'}</td>
                  <td className="font-mono text-xs text-text-secondary">{formatDate(po.issue_date)}</td>
                  <td className="font-mono text-xs text-text-secondary">{formatDate(po.expected_date)}</td>
                  <td className="font-mono text-xs text-right text-text-primary">{formatCurrency(po.total)}</td>
                  <td>
                    <span className={formatStatus(po.status).className}>
                      {formatStatus(po.status).label}
                    </span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button
                      className="block-btn text-[10px] px-2 py-1"
                      onClick={() => onView(po.id)}
                    >
                      View
                    </button>
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

// ─── POForm ──────────────────────────────────────────────

interface POFormProps {
  editId?: string | null;
  onBack: () => void;
  onSaved: (id: string) => void;
}

const POForm: React.FC<POFormProps> = ({ editId, onBack, onSaved }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Header fields
  const [poNumber, setPoNumber] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [orderDate, setOrderDate] = useState(today());
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');

  // Tax
  const [taxPct, setTaxPct] = useState('0');

  // Line items
  const [lines, setLines] = useState<DraftLineItem[]>([]);

  const isEdit = !!editId;

  const load = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    try {
      const [vens, accs, nextNum] = await Promise.all([
        api.query('vendors', { company_id: activeCompany.id }),
        api.query('accounts', { company_id: activeCompany.id }),
        isEdit ? Promise.resolve(null) : api.poNextNumber(),
      ]);
      setVendors(vens || []);
      setAccounts(accs || []);

      if (!isEdit && nextNum) {
        setPoNumber(nextNum);
      }

      if (isEdit && editId) {
        const [po, items] = await Promise.all([
          api.get('purchase_orders', editId),
          api.query('po_line_items', { po_id: editId }),
        ]);
        if (po) {
          setPoNumber(po.po_number || '');
          setVendorId(po.vendor_id || '');
          setOrderDate(po.issue_date || today());
          setExpectedDate(po.expected_date || '');
          setNotes(po.notes || '');
          // Derive tax pct from subtotal/tax_amount if possible
          if (po.subtotal && po.tax_amount) {
            const pct = (po.tax_amount / po.subtotal) * 100;
            setTaxPct(pct.toFixed(2));
          }
        }
        setLines(
          (items || []).map((item: POLineItem) => ({
            tempId: newTempId(),
            description: item.description || '',
            account_id: item.account_id || '',
            quantity: String(item.quantity ?? 1),
            unit_price: String(item.unit_price ?? 0),
            amount: item.amount ?? 0,
          }))
        );
      } else if (!isEdit) {
        // Start with one blank line
        setLines([{ tempId: newTempId(), description: '', account_id: '', quantity: '1', unit_price: '0', amount: 0 }]);
      }
    } finally {
      setLoading(false);
    }
  }, [activeCompany, editId, isEdit]);

  useEffect(() => { load(); }, [load]);

  // Recalculate line amount whenever qty or unit_price changes
  const updateLine = (tempId: string, field: keyof DraftLineItem, value: string) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.tempId !== tempId) return l;
        const updated = { ...l, [field]: value };
        const qty = parseFloat(updated.quantity) || 0;
        const price = parseFloat(updated.unit_price) || 0;
        updated.amount = parseFloat((qty * price).toFixed(2));
        return updated;
      })
    );
  };

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      { tempId: newTempId(), description: '', account_id: '', quantity: '1', unit_price: '0', amount: 0 },
    ]);
  };

  const removeLine = (tempId: string) => {
    setLines((prev) => prev.filter((l) => l.tempId !== tempId));
  };

  const subtotal = useMemo(() => lines.reduce((s, l) => s + l.amount, 0), [lines]);
  const taxAmount = useMemo(() => parseFloat(((subtotal * parseFloat(taxPct || '0')) / 100).toFixed(2)), [subtotal, taxPct]);
  const total = useMemo(() => parseFloat((subtotal + taxAmount).toFixed(2)), [subtotal, taxAmount]);

  const handleSave = async () => {
    setError('');
    if (!vendorId) { setError('Please select a vendor.'); return; }
    if (!poNumber.trim()) { setError('PO number is required.'); return; }
    if (lines.length === 0) { setError('Add at least one line item.'); return; }
    if (lines.some((l) => !l.description.trim())) { setError('All line items must have a description.'); return; }

    setSaving(true);
    try {
      const poData = {
        company_id: activeCompany!.id,
        po_number: poNumber.trim(),
        vendor_id: vendorId,
        issue_date: orderDate,
        expected_date: expectedDate || null,
        status: 'draft' as POStatus,
        subtotal,
        tax_amount: taxAmount,
        total,
        notes: notes.trim() || null,
      };

      let poId: string;

      if (isEdit && editId) {
        await api.update('purchase_orders', editId, poData);
        poId = editId;
        // Remove old line items and re-create
        const existing = await api.query('po_line_items', { po_id: editId });
        await Promise.all((existing || []).map((item: POLineItem) => api.remove('po_line_items', item.id)));
      } else {
        const created = await api.create('purchase_orders', poData);
        poId = created.id;
      }

      // Create line items
      await Promise.all(
        lines.map((l) =>
          api.create('po_line_items', {
            po_id: poId,
            description: l.description,
            quantity: parseFloat(l.quantity) || 0,
            unit_price: parseFloat(l.unit_price) || 0,
            amount: l.amount,
            account_id: l.account_id || null,
            quantity_received: 0,
          })
        )
      );

      onSaved(poId);
    } catch (e: any) {
      setError(e?.message || 'Failed to save purchase order.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="text-text-muted text-xs font-mono p-8 text-center">Loading...</div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="module-header">
        <div className="flex items-center gap-3">
          <button className="block-btn flex items-center gap-1.5 text-xs" onClick={onBack}>
            <ArrowLeft size={14} />
            Back
          </button>
          <div>
            <h1 className="module-title">
              {isEdit ? 'Edit Purchase Order' : 'New Purchase Order'}
            </h1>
            <p className="text-text-muted text-xs mt-0.5">
              {isEdit ? 'Update PO details and line items' : 'Create a new purchase order'}
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div
          className="mb-4 p-3 bg-bg-tertiary border border-accent-expense text-accent-expense text-xs font-mono"
          style={{ borderRadius: '2px' }}
        >
          {error}
        </div>
      )}

      {/* PO Header Fields */}
      <div className="block-card mb-4">
        <div className="text-[10px] font-semibold text-text-muted tracking-widest uppercase mb-3 pb-2 border-b border-border-primary">
          Order Details
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-[10px] text-text-muted font-semibold uppercase tracking-wide mb-1">
              PO Number
            </label>
            <input
              className="block-input font-mono text-xs w-full"
              value={poNumber}
              onChange={(e) => setPoNumber(e.target.value)}
              placeholder="PO-0001"
            />
          </div>
          <div>
            <label className="block text-[10px] text-text-muted font-semibold uppercase tracking-wide mb-1">
              Vendor <span className="text-accent-expense">*</span>
            </label>
            <select
              className="block-select text-xs w-full"
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
            >
              <option value="">Select vendor...</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-text-muted font-semibold uppercase tracking-wide mb-1">
              Order Date
            </label>
            <input
              type="date"
              className="block-input font-mono text-xs w-full"
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[10px] text-text-muted font-semibold uppercase tracking-wide mb-1">
              Expected Delivery Date
            </label>
            <input
              type="date"
              className="block-input font-mono text-xs w-full"
              value={expectedDate}
              onChange={(e) => setExpectedDate(e.target.value)}
            />
          </div>
          <div className="col-span-2">
            <label className="block text-[10px] text-text-muted font-semibold uppercase tracking-wide mb-1">
              Notes
            </label>
            <textarea
              className="block-input text-xs w-full"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes or delivery instructions..."
              style={{ resize: 'vertical' }}
            />
          </div>
        </div>
      </div>

      {/* Line Items */}
      <div className="block-card mb-4">
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-border-primary">
          <div className="text-[10px] font-semibold text-text-muted tracking-widest uppercase">
            Line Items
          </div>
          <button
            className="block-btn block-btn-primary flex items-center gap-1 text-[10px] px-2 py-1"
            onClick={addLine}
          >
            <Plus size={11} />
            Add Line
          </button>
        </div>

        {lines.length === 0 ? (
          <div className="text-text-muted text-xs py-4 text-center">
            No line items yet. Click "Add Line" to begin.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="block-table w-full mb-3">
              <thead>
                <tr>
                  <th className="text-[10px]" style={{ width: '35%' }}>Description</th>
                  <th className="text-[10px]" style={{ width: '22%' }}>Account</th>
                  <th className="text-[10px] text-right" style={{ width: '10%' }}>Qty</th>
                  <th className="text-[10px] text-right" style={{ width: '14%' }}>Unit Price</th>
                  <th className="text-[10px] text-right" style={{ width: '14%' }}>Amount</th>
                  <th style={{ width: '5%' }}></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.tempId}>
                    <td>
                      <input
                        className="block-input text-xs w-full"
                        value={line.description}
                        onChange={(e) => updateLine(line.tempId, 'description', e.target.value)}
                        placeholder="Item description..."
                      />
                    </td>
                    <td>
                      <select
                        className="block-select text-xs w-full"
                        value={line.account_id}
                        onChange={(e) => updateLine(line.tempId, 'account_id', e.target.value)}
                      >
                        <option value="">— Account —</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code ? `${a.code} · ` : ''}{a.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="block-input font-mono text-xs text-right w-full"
                        value={line.quantity}
                        onChange={(e) => updateLine(line.tempId, 'quantity', e.target.value)}
                        placeholder="1"
                        type="number"
                        min="0"
                        step="any"
                      />
                    </td>
                    <td>
                      <input
                        className="block-input font-mono text-xs text-right w-full"
                        value={line.unit_price}
                        onChange={(e) => updateLine(line.tempId, 'unit_price', e.target.value)}
                        placeholder="0.00"
                        type="number"
                        min="0"
                        step="any"
                      />
                    </td>
                    <td className="text-right font-mono text-xs text-text-primary px-2">
                      {formatCurrency(line.amount)}
                    </td>
                    <td className="text-center">
                      <button
                        className="text-text-muted hover:text-accent-expense transition-colors"
                        onClick={() => removeLine(line.tempId)}
                        title="Remove line"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Totals */}
        <div className="flex justify-end">
          <div className="w-64">
            <div className="flex justify-between text-xs py-1 border-b border-border-primary">
              <span className="text-text-muted">Subtotal</span>
              <span className="font-mono text-text-primary">{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between text-xs py-1 border-b border-border-primary gap-2">
              <span className="text-text-muted whitespace-nowrap">Tax %</span>
              <div className="flex items-center gap-1">
                <input
                  className="block-input font-mono text-xs text-right"
                  style={{ width: 64 }}
                  value={taxPct}
                  onChange={(e) => setTaxPct(e.target.value)}
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                />
              </div>
              <span className="font-mono text-text-primary">{formatCurrency(taxAmount)}</span>
            </div>
            <div className="flex justify-between text-xs py-1.5">
              <span className="font-semibold text-text-primary">Total</span>
              <span className="font-mono font-semibold text-accent-income text-sm">{formatCurrency(total)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          className="block-btn block-btn-primary flex items-center gap-1.5"
          onClick={handleSave}
          disabled={saving}
        >
          <FileText size={14} />
          {saving ? 'Saving...' : isEdit ? 'Update Purchase Order' : 'Save Purchase Order'}
        </button>
        <button className="block-btn" onClick={onBack} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  );
};

// ─── PODetail ────────────────────────────────────────────

interface PODetailProps {
  poId: string;
  onBack: () => void;
  onEdit: (id: string) => void;
}

const PODetail: React.FC<PODetailProps> = ({ poId, onBack, onEdit }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [lines, setLines] = useState<POLineItem[]>([]);
  const [vendors, setVendors] = useState<Record<string, Vendor>>({});
  const [accounts, setAccounts] = useState<Record<string, Account>>({});
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const load = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    try {
      const [poData, items, vens, accs] = await Promise.all([
        api.get('purchase_orders', poId),
        api.query('po_line_items', { po_id: poId }),
        api.query('vendors', { company_id: activeCompany.id }),
        api.query('accounts', { company_id: activeCompany.id }),
      ]);
      setPo(poData);
      setLines(items || []);
      const vm: Record<string, Vendor> = {};
      (vens || []).forEach((v: Vendor) => { vm[v.id] = v; });
      setVendors(vm);
      const am: Record<string, Account> = {};
      (accs || []).forEach((a: Account) => { am[a.id] = a; });
      setAccounts(am);
    } finally {
      setLoading(false);
    }
  }, [activeCompany, poId]);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async () => {
    if (!po) return;
    setActionLoading(true);
    setSuccessMsg('');
    setErrorMsg('');
    try {
      await api.poApprove(po.id);
      setSuccessMsg('Purchase order approved successfully.');
      await load();
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to approve purchase order.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleConvertBill = async () => {
    if (!po) return;
    setActionLoading(true);
    setSuccessMsg('');
    setErrorMsg('');
    try {
      const result = await api.poConvertBill(po.id);
      const billNum = result?.bill_number || result?.billNumber || '';
      setSuccessMsg(
        `Bill created successfully${billNum ? ` (${billNum})` : ''}. Navigate to Bills & AP to record payment.`
      );
      await load();
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to convert to bill.');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return <div className="text-text-muted text-xs font-mono p-8 text-center">Loading...</div>;
  }

  if (!po) {
    return (
      <div className="text-accent-expense text-xs font-mono p-8 text-center">
        Purchase order not found.
      </div>
    );
  }

  const vendor = vendors[po.vendor_id];
  const canApprove = po.status === 'draft' || po.status === 'sent';
  const canConvert = po.status === 'approved';
  const isFinal = po.status === 'received' || po.status === 'cancelled';

  return (
    <div>
      {/* Header */}
      <div className="module-header">
        <div className="flex items-center gap-3">
          <button className="block-btn flex items-center gap-1.5 text-xs" onClick={onBack}>
            <ArrowLeft size={14} />
            Back
          </button>
          <div>
            <h1 className="module-title flex items-center gap-2">
              <span className="font-mono">{po.po_number}</span>
              <span className={formatStatus(po.status).className}>
                {formatStatus(po.status).label}
              </span>
            </h1>
            <p className="text-text-muted text-xs mt-0.5">Purchase Order Detail</p>
          </div>
        </div>
        <div className="module-actions">
          {!isFinal && (
            <button
              className="block-btn flex items-center gap-1.5 text-xs"
              onClick={() => onEdit(po.id)}
            >
              <FileText size={13} />
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Success / Error banners */}
      {successMsg && (
        <div
          className="mb-4 p-3 bg-bg-tertiary border border-accent-income text-accent-income text-xs font-mono flex items-start gap-2"
          style={{ borderRadius: '2px' }}
        >
          <CheckCircle size={14} className="mt-0.5 flex-shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div
          className="mb-4 p-3 bg-bg-tertiary border border-accent-expense text-accent-expense text-xs font-mono"
          style={{ borderRadius: '2px' }}
        >
          {errorMsg}
        </div>
      )}

      {/* Info Grid */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* Left: Vendor & Dates */}
        <div className="block-card">
          <div className="text-[10px] font-semibold text-text-muted tracking-widest uppercase mb-3 pb-2 border-b border-border-primary">
            Order Info
          </div>
          <div className="space-y-2.5">
            <div className="flex justify-between">
              <span className="text-[10px] text-text-muted uppercase tracking-wide">Vendor</span>
              <span className="text-xs text-text-primary font-semibold">{vendor?.name ?? '—'}</span>
            </div>
            {vendor?.email && (
              <div className="flex justify-between">
                <span className="text-[10px] text-text-muted uppercase tracking-wide">Email</span>
                <span className="text-xs text-text-secondary font-mono">{vendor.email}</span>
              </div>
            )}
            {vendor?.phone && (
              <div className="flex justify-between">
                <span className="text-[10px] text-text-muted uppercase tracking-wide">Phone</span>
                <span className="text-xs text-text-secondary font-mono">{vendor.phone}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-[10px] text-text-muted uppercase tracking-wide">Order Date</span>
              <span className="text-xs font-mono text-text-secondary">{formatDate(po.issue_date)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[10px] text-text-muted uppercase tracking-wide">Expected Date</span>
              <span className="text-xs font-mono text-text-secondary">{formatDate(po.expected_date)}</span>
            </div>
          </div>
        </div>

        {/* Right: Totals & Notes */}
        <div className="block-card">
          <div className="text-[10px] font-semibold text-text-muted tracking-widest uppercase mb-3 pb-2 border-b border-border-primary">
            Financials
          </div>
          <div className="space-y-2.5">
            <div className="flex justify-between">
              <span className="text-[10px] text-text-muted uppercase tracking-wide">Subtotal</span>
              <span className="text-xs font-mono text-text-primary">{formatCurrency(po.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[10px] text-text-muted uppercase tracking-wide">Tax</span>
              <span className="text-xs font-mono text-text-primary">{formatCurrency(po.tax_amount)}</span>
            </div>
            <div className="flex justify-between border-t border-border-primary pt-2 mt-1">
              <span className="text-[10px] font-semibold text-text-primary uppercase tracking-wide">Total</span>
              <span className="text-sm font-mono font-semibold text-accent-income">{formatCurrency(po.total)}</span>
            </div>
          </div>
          {po.notes && (
            <div className="mt-3 pt-2 border-t border-border-primary">
              <div className="text-[10px] text-text-muted uppercase tracking-wide mb-1">Notes</div>
              <p className="text-xs text-text-secondary leading-relaxed">{po.notes}</p>
            </div>
          )}
        </div>
      </div>

      {/* Line Items Table */}
      <div className="block-card mb-4">
        <div className="text-[10px] font-semibold text-text-muted tracking-widest uppercase mb-3 pb-2 border-b border-border-primary flex items-center gap-2">
          <Package size={12} />
          Line Items
        </div>
        {lines.length === 0 ? (
          <div className="text-text-muted text-xs text-center py-4">No line items on this PO.</div>
        ) : (
          <table className="block-table w-full">
            <thead>
              <tr>
                <th className="text-[10px]">Description</th>
                <th className="text-[10px]">Account</th>
                <th className="text-[10px] text-right">Qty</th>
                <th className="text-[10px] text-right">Unit Price</th>
                <th className="text-[10px] text-right">Amount</th>
                <th className="text-[10px] text-right">Received Qty</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const acct = accounts[line.account_id];
                return (
                  <tr key={line.id}>
                    <td className="text-xs text-text-primary">{line.description || '—'}</td>
                    <td className="text-xs text-text-secondary">
                      {acct ? (acct.code ? `${acct.code} · ${acct.name}` : acct.name) : '—'}
                    </td>
                    <td className="text-xs font-mono text-right text-text-secondary">{line.quantity}</td>
                    <td className="text-xs font-mono text-right text-text-secondary">{formatCurrency(line.unit_price)}</td>
                    <td className="text-xs font-mono text-right text-text-primary">{formatCurrency(line.amount)}</td>
                    <td className="text-xs font-mono text-right">
                      <span
                        className={
                          (line.quantity_received ?? 0) >= line.quantity
                            ? 'text-accent-income'
                            : (line.quantity_received ?? 0) > 0
                            ? 'text-accent-warning'
                            : 'text-text-muted'
                        }
                      >
                        {line.quantity_received ?? 0} / {line.quantity}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Action Buttons */}
      {(canApprove || canConvert) && (
        <div className="block-card">
          <div className="text-[10px] font-semibold text-text-muted tracking-widest uppercase mb-3 pb-2 border-b border-border-primary">
            Actions
          </div>
          <div className="flex items-center gap-3">
            {canApprove && (
              <button
                className="block-btn block-btn-primary flex items-center gap-1.5"
                onClick={handleApprove}
                disabled={actionLoading}
              >
                <CheckCircle size={14} />
                {actionLoading ? 'Approving...' : 'Approve PO'}
              </button>
            )}
            {canConvert && (
              <button
                className="block-btn block-btn-primary flex items-center gap-1.5"
                onClick={handleConvertBill}
                disabled={actionLoading}
                style={{ background: 'var(--color-accent-income, #22c55e)', color: '#fff' }}
              >
                <FileText size={14} />
                {actionLoading ? 'Converting...' : 'Convert to Bill'}
              </button>
            )}
            <p className="text-[10px] text-text-muted">
              {canApprove && 'Approve this PO to authorize the purchase.'}
              {canConvert && 'Converting will create a bill in Accounts Payable.'}
            </p>
          </div>
        </div>
      )}

      {isFinal && (
        <div className="block-card">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Package size={14} />
            This purchase order is{' '}
            <span className={formatStatus(po.status).className}>
              {formatStatus(po.status).label}
            </span>{' '}
            and no further actions are available.
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Module Root ─────────────────────────────────────────

const PurchaseOrdersModule: React.FC = () => {
  const [view, setView] = useState<View>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);

  const goList = useCallback(() => {
    setView('list');
    setSelectedId(null);
    setEditId(null);
  }, []);

  const goNew = useCallback(() => {
    setEditId(null);
    setView('form');
  }, []);

  const goEdit = useCallback((id: string) => {
    setEditId(id);
    setView('form');
  }, []);

  const goDetail = useCallback((id: string) => {
    setSelectedId(id);
    setView('detail');
  }, []);

  const handleSaved = useCallback((id: string) => {
    setSelectedId(id);
    setEditId(null);
    setView('detail');
  }, []);

  if (view === 'form') {
    return (
      <POForm
        editId={editId}
        onBack={editId ? () => goDetail(editId) : goList}
        onSaved={handleSaved}
      />
    );
  }

  if (view === 'detail' && selectedId) {
    return (
      <PODetail
        poId={selectedId}
        onBack={goList}
        onEdit={goEdit}
      />
    );
  }

  return (
    <POList
      onNew={goNew}
      onView={goDetail}
    />
  );
};

export default PurchaseOrdersModule;
