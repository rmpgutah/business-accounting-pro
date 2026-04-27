import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  FileText,
  Plus,
  ArrowLeft,
  Trash2,
  DollarSign,
  AlertTriangle,
  Clock,
  CheckCircle,
  Search,
  Edit,
  Copy,
  Eye,
  Printer,
  Download,
} from 'lucide-react';
import { generateBillHTML } from '../../lib/print-templates';
import { EmptyState } from '../../components/EmptyState';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { useAppStore } from '../../stores/appStore';
import { formatCurrency, formatDate, formatStatus, roundCents } from '../../lib/format';
import { todayLocal, toLocalDateString } from '../../lib/date-helpers';
import ErrorBanner from '../../components/ErrorBanner';
import EntityChip from '../../components/EntityChip';
import RelatedPanel from '../../components/RelatedPanel';
import EntityTimeline from '../../components/EntityTimeline';
import { useNavigation } from '../../lib/navigation';

// ─── Types ───────────────────────────────────────────────
type View = 'list' | 'form' | 'detail';

type BillStatus = 'draft' | 'pending' | 'approved' | 'partial' | 'paid' | 'overdue';
type StatusTab = 'all' | BillStatus;

interface Bill {
  id: string;
  company_id: string;
  bill_number: string;
  vendor_id: string;
  issue_date: string;
  due_date: string;
  status: BillStatus;
  subtotal: number;
  tax_amount: number;
  total: number;
  amount_paid: number;
  notes?: string;
  created_at: string;
}

interface BillLineItem {
  id: string;
  bill_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  account_id: string;
}

interface BillPayment {
  id: string;
  bill_id: string;
  amount: number;
  payment_date: string;
  payment_method: string;
  account_id: string;
  reference?: string;
  created_at: string;
}

interface Vendor {
  id: string;
  name: string;
}

interface Account {
  id: string;
  name: string;
  code?: string;
  type?: string;
}

// Group accounts by type for <optgroup> display
const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  asset: 'Assets',
  equity: 'Equity',
  expense: 'Expenses',
  liability: 'Liabilities',
  revenue: 'Revenue',
};
function groupAccountsByType(accounts: Account[]) {
  const groups = new Map<string, Account[]>();
  for (const a of accounts) {
    const key = a.type ? (ACCOUNT_TYPE_LABELS[a.type.toLowerCase()] ?? a.type) : 'Other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(a);
  }
  const sortedGroupKeys = [...groups.keys()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return sortedGroupKeys.map((label) => ({
    label,
    items: groups.get(label)!.slice().sort((a, b) => {
      const la = a.code ? `${a.code} - ${a.name}` : a.name;
      const lb = b.code ? `${b.code} - ${b.name}` : b.name;
      return la.localeCompare(lb, undefined, { sensitivity: 'base' });
    }),
  }));
}

interface BillStats {
  total_unpaid: number;
  overdue: number;
  due_soon: number;
  paid_this_month: number;
}

interface LineItemDraft {
  _key: string;
  description: string;
  quantity: number;
  unit_price: number;
  account_id: string;
}

// ─── Constants ───────────────────────────────────────────
// DATE: Item #2 — local-time, not UTC. Late-evening MT users would otherwise default to tomorrow.
const todayISO = (): string => todayLocal();

const thirtyDaysLater = (): string => {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return toLocalDateString(d);
};

let _lineKeyCounter = 0;
const newLineKey = () => `line-${++_lineKeyCounter}`;

const newLineDraft = (): LineItemDraft => ({
  _key: newLineKey(),
  description: '',
  quantity: 1,
  unit_price: 0,
  account_id: '',
});

const STATUS_TABS: { key: StatusTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'partial', label: 'Partial' },
  { key: 'paid', label: 'Paid' },
  { key: 'overdue', label: 'Overdue' },
];

const PAYMENT_METHODS = [
  { value: 'ach', label: 'ACH' },
  { value: 'cash', label: 'Cash' },
  { value: 'check', label: 'Check' },
  { value: 'credit_card', label: 'Credit Card' },
  { value: 'wire', label: 'Wire' },
];

// ─── Label helper ─────────────────────────────────────────
const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1.5">
    {children}
  </label>
);

// ═══════════════════════════════════════════════════════════
// BillsList
// ═══════════════════════════════════════════════════════════
interface BillsListProps {
  onNew: () => void;
  onView: (id: string) => void;
}

const BillsList: React.FC<BillsListProps> = ({ onNew, onView }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const nav = useNavigation();
  const [bills, setBills] = useState<Bill[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [stats, setStats] = useState<BillStats>({
    total_unpaid: 0,
    overdue: 0,
    due_soon: 0,
    paid_this_month: 0,
  });
  const [activeTab, setActiveTab] = useState<StatusTab>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      try {
        // Perf: cap bill list at 2000 most-recent; aggregate stats come from billsStats().
        const [billData, vendorData] = await Promise.all([
          api.query('bills', { company_id: activeCompany.id }, { field: 'bill_date', dir: 'desc' }, 2000),
          api.query('vendors', { company_id: activeCompany.id }),
        ]);
        if (cancelled) return;
        setBills(Array.isArray(billData) ? billData : []);
        setVendors(Array.isArray(vendorData) ? vendorData : []);

        // Non-critical — failures don't hide primary content
        api.billsStats()
          .then(r => { if (!cancelled && r) setStats(r); })
          .catch(() => {});
      } catch (err) {
        console.error('Failed to load bills:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeCompany]);

  const vendorMap = useMemo(() => {
    const m = new Map<string, string>();
    vendors.forEach((v) => m.set(v.id, v.name));
    return m;
  }, [vendors]);

  const filtered = useMemo(() => {
    let list = bills;
    if (activeTab !== 'all') {
      list = list.filter((b) => b.status === activeTab);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (b) =>
          b.bill_number.toLowerCase().includes(q) ||
          (vendorMap.get(b.vendor_id) ?? '').toLowerCase().includes(q) ||
          (b.notes ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [bills, activeTab, search, vendorMap]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-text-muted text-sm font-mono">Loading bills...</span>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      {/* Header */}
      <div className="module-header">
        <h1 className="module-title text-text-primary">Bills / Accounts Payable</h1>
        <div className="module-actions">
          <button className="block-btn-primary flex items-center gap-2" onClick={onNew}>
            <Plus size={16} />
            New Bill
          </button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-4 gap-4 report-summary-tiles">
        {/* Total Unpaid */}
        <div className="stat-card" style={{ borderRadius: '6px' }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="stat-label text-text-muted">Total Unpaid</div>
              <div className="stat-value font-mono text-accent-expense">
                {formatCurrency(stats.total_unpaid)}
              </div>
            </div>
            <DollarSign size={20} className="text-accent-expense opacity-60 mt-1" />
          </div>
        </div>

        {/* Overdue */}
        <div className="stat-card" style={{ borderRadius: '6px' }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="stat-label text-text-muted">Overdue</div>
              <div className="stat-value font-mono text-accent-expense">
                {stats.overdue}
              </div>
            </div>
            <AlertTriangle size={20} className="text-accent-expense opacity-60 mt-1" />
          </div>
        </div>

        {/* Due Soon */}
        <div className="stat-card" style={{ borderRadius: '6px' }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="stat-label text-text-muted">Due in 7 Days</div>
              <div className="stat-value font-mono text-accent-blue">
                {stats.due_soon}
              </div>
            </div>
            <Clock size={20} className="text-accent-blue opacity-60 mt-1" />
          </div>
        </div>

        {/* Paid This Month */}
        <div className="stat-card" style={{ borderRadius: '6px' }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="stat-label text-text-muted">Paid This Month</div>
              <div className="stat-value font-mono text-accent-income">
                {formatCurrency(stats.paid_this_month)}
              </div>
            </div>
            <CheckCircle size={20} className="text-accent-income opacity-60 mt-1" />
          </div>
        </div>
      </div>

      {/* Filters row */}
      <div className="flex items-center justify-between gap-4">
        {/* Status tabs */}
        <div className="flex gap-1 flex-wrap">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === tab.key
                  ? 'bg-accent-blue text-white'
                  : 'bg-bg-secondary text-text-muted hover:text-text-primary transition-colors'
              }`}
              style={{ borderRadius: '6px' }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-shrink-0">
          <Search
            size={14}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
          />
          <input
            type="text"
            placeholder="Search bills..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="block-input pl-8"
            style={{ width: '260px' }}
          />
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3">
          <EmptyState
            icon={FileText}
            message={
              bills.length === 0
                ? 'No bills yet'
                : 'No bills match your search or filter'
            }
          />
          {bills.length === 0 && (
            <button
              className="block-btn-primary mt-4 flex items-center gap-2"
              onClick={onNew}
            >
              <Plus size={16} />
              Create your first bill
            </button>
          )}
        </div>
      ) : (
        <div className="block-card p-0 overflow-hidden">
          <div className="overflow-x-auto">
          <table className="block-table">
            <thead>
              <tr>
                <th>Bill #</th>
                <th>Vendor</th>
                <th>Issue Date</th>
                <th>Due Date</th>
                <th className="text-right">Total</th>
                <th className="text-right">Amount Paid</th>
                <th className="text-right">Balance</th>
                <th>Status</th>
                <th style={{ width: '80px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((bill) => {
                const balance = bill.total - bill.amount_paid;
                const badge = formatStatus(bill.status);
                const vendorName = vendorMap.get(bill.vendor_id) ?? '—';
                return (
                  <tr
                    key={bill.id}
                    className="cursor-pointer"
                    onClick={() => onView(bill.id)}
                  >
                    <td className="font-mono text-accent-blue text-xs" onClick={(e) => e.stopPropagation()}>
                      <EntityChip type="bill" id={bill.id} label={bill.bill_number} variant="inline" />
                    </td>
                    <td className="text-text-primary cursor-pointer" onClick={(e) => e.stopPropagation()}>
                      {bill.vendor_id && vendorName !== '—' ? (
                        <EntityChip type="vendor" id={bill.vendor_id} label={vendorName} variant="inline" />
                      ) : (
                        <span className="block truncate max-w-[180px]">{vendorName}</span>
                      )}
                    </td>
                    <td className="font-mono text-text-secondary text-xs">{formatDate(bill.issue_date)}</td>
                    <td className="font-mono text-text-secondary text-xs">{formatDate(bill.due_date)}</td>
                    <td className="text-right font-mono text-text-primary">
                      {formatCurrency(bill.total)}
                    </td>
                    <td className="text-right font-mono text-accent-income">
                      {formatCurrency(bill.amount_paid)}
                    </td>
                    <td
                      className={`text-right font-mono ${
                        balance > 0 ? 'text-accent-expense' : 'text-text-muted'
                      }`}
                    >
                      {formatCurrency(balance)}
                    </td>
                    <td>
                      <span className={badge.className}>{badge.label}</span>
                    </td>
                    <td className="cursor-pointer" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="block-btn text-xs py-1 px-2"
                        style={{ borderRadius: '6px' }}
                        onClick={() => onView(bill.id)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
// BillForm
// ═══════════════════════════════════════════════════════════
interface BillFormProps {
  billId?: string | null;
  onBack: () => void;
  onSaved: (id: string) => void;
}

interface BillFormData {
  bill_number: string;
  vendor_id: string;
  issue_date: string;
  due_date: string;
  status: BillStatus;
  notes: string;
  tax_pct: number;
}

const BillForm: React.FC<BillFormProps> = ({ billId, onBack, onSaved }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const isEdit = !!billId;

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const [form, setForm] = useState<BillFormData>({
    bill_number: '',
    vendor_id: '',
    issue_date: todayISO(),
    due_date: thirtyDaysLater(),
    status: 'draft',
    notes: '',
    tax_pct: 0,
  });

  const [lines, setLines] = useState<LineItemDraft[]>([newLineDraft()]);

  // ─── Load Data ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      try {
        const cid = activeCompany.id;
        const [vendorData, accountData] = await Promise.all([
          api.query('vendors', { company_id: cid }),
          api.query('accounts', { company_id: cid }),
        ]);
        if (cancelled) return;
        setVendors(vendorData ?? []);
        setAccounts(accountData ?? []);

        if (!isEdit) {
          const nextNum = await api.billsNextNumber();
          if (!cancelled) {
            setForm((prev) => ({ ...prev, bill_number: nextNum ?? 'BILL-0001' }));
          }
        }

        if (isEdit && billId) {
          const bill = await api.get('bills', billId);
          if (cancelled || !bill) return;
          const taxPct =
            bill.subtotal > 0 ? (bill.tax_amount / bill.subtotal) * 100 : 0;
          setForm({
            bill_number: bill.bill_number ?? '',
            vendor_id: bill.vendor_id ?? '',
            issue_date: bill.issue_date ?? todayISO(),
            due_date: bill.due_date ?? thirtyDaysLater(),
            status: bill.status ?? 'draft',
            notes: bill.notes ?? '',
            tax_pct: parseFloat(taxPct.toFixed(4)),
          });

          const lineData = await api.query('bill_line_items', { bill_id: billId });
          if (cancelled) return;
          if (lineData && lineData.length > 0) {
            setLines(
              lineData.map((l: any) => ({
                _key: newLineKey(),
                description: l.description ?? '',
                quantity: l.quantity ?? 1,
                unit_price: l.unit_price ?? 0,
                account_id: l.account_id ?? '',
              }))
            );
          }
        }
      } catch (err) {
        console.error('Failed to load bill form data:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [billId, activeCompany]);

  // ─── Calculations ────────────────────────────────────────
  // Round each line to whole cents before summing — same convention as invoices.
  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + roundCents(l.quantity * l.unit_price), 0),
    [lines]
  );
  const taxAmount = useMemo(
    () => roundCents(subtotal * (form.tax_pct / 100)),
    [subtotal, form.tax_pct]
  );
  const total = useMemo(() => roundCents(subtotal + taxAmount), [subtotal, taxAmount]);

  // ─── Handlers ────────────────────────────────────────────
  const updateField = useCallback(
    <K extends keyof BillFormData>(field: K, value: BillFormData[K]) => {
      setForm((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  const updateLine = useCallback(
    (key: string, field: keyof Omit<LineItemDraft, '_key'>, value: string | number) => {
      setLines((prev) =>
        prev.map((l) => (l._key === key ? { ...l, [field]: value } : l))
      );
    },
    []
  );

  const addLine = useCallback(() => {
    setLines((prev) => [...prev, newLineDraft()]);
  }, []);

  const removeLine = useCallback((key: string) => {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l._key !== key)));
  }, []);

  // ─── Save ─────────────────────────────────────────────────
  const handleSave = async () => {
    const errs: string[] = [];
    if (!form.vendor_id) errs.push('Vendor is required.');
    if (!form.bill_number.trim()) errs.push('Bill number is required.');
    if (!form.issue_date) errs.push('Issue date is required.');
    if (!form.due_date) errs.push('Due date is required.');
    if (form.issue_date && form.due_date && form.due_date < form.issue_date) {
      errs.push('Due date must be on or after issue date.');
    }
    const validLines = lines.filter((l) => l.description.trim() || l.unit_price > 0);
    if (validLines.length === 0) errs.push('At least one line item is required.');
    validLines.forEach((l, i) => {
      if (l.quantity <= 0) errs.push(`Line item ${i + 1}: quantity must be greater than zero.`);
      if (l.unit_price < 0) errs.push(`Line item ${i + 1}: unit price cannot be negative.`);
    });
    if (total <= 0) errs.push('Bill total must be greater than zero.');
    if (form.tax_pct < 0) errs.push('Tax percentage cannot be negative.');
    if (form.tax_pct > 100) errs.push('Tax percentage cannot exceed 100%.');
    if (errs.length > 0) { setErrors(errs); return; }
    setErrors([]);

    setSaving(true);
    try {
      const billData: Record<string, any> = {
        company_id: activeCompany!.id,
        bill_number: form.bill_number.trim(),
        vendor_id: form.vendor_id,
        issue_date: form.issue_date,
        due_date: form.due_date,
        status: form.status,
        subtotal,
        tax_amount: taxAmount,
        total,
        notes: form.notes,
      };

      let savedId: string;

      if (isEdit && billId) {
        await api.update('bills', billId, billData);
        savedId = billId;
        // Remove old line items
        const oldLines = await api.query('bill_line_items', { bill_id: billId });
        if (oldLines) {
          for (const ol of oldLines) {
            await api.remove('bill_line_items', ol.id);
          }
        }
      } else {
        billData.amount_paid = 0;
        const result = await api.create('bills', billData);
        savedId = result?.id ?? result;
      }

      // Create new line items
      for (const line of validLines) {
        await api.create('bill_line_items', {
          bill_id: savedId,
          description: line.description,
          quantity: line.quantity,
          unit_price: line.unit_price,
          amount: roundCents(line.quantity * line.unit_price),
          account_id: line.account_id || null,
        });
      }

      onSaved(savedId);
    } catch (err: any) {
      // VISIBILITY: surface save-bill errors instead of swallowing
      console.error('Failed to save bill:', err);
      setErrors([err?.message ?? String(err)]);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-text-muted text-sm font-mono">Loading...</span>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      {/* Header */}
      <div className="module-header">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="block-btn p-2" title="Back" style={{ borderRadius: '6px' }}>
            <ArrowLeft size={16} />
          </button>
          <h1 className="module-title text-text-primary">
            {isEdit ? 'Edit Bill' : 'New Bill'}
          </h1>
        </div>
        <div className="module-actions">
          <button className="block-btn" onClick={onBack} disabled={saving}>
            Cancel
          </button>
          <button className="block-btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Bill'}
          </button>
        </div>
      </div>

      {/* Validation errors */}
      {errors.length > 0 && (
        <ErrorBanner
          message={errors.join(' \u2022 ')}
          title="Validation errors"
          onDismiss={() => setErrors([])}
        />
      )}

      {/* Bill header fields */}
      <div className="block-card">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          {/* Bill Number */}
          <div>
            <FieldLabel>Bill Number</FieldLabel>
            <input
              type="text"
              className="block-input font-mono"
              value={form.bill_number}
              onChange={(e) => updateField('bill_number', e.target.value)}
            />
          </div>

          {/* Vendor */}
          <div>
            <FieldLabel>Vendor</FieldLabel>
            <select
              className="block-select"
              value={form.vendor_id}
              onChange={(e) => updateField('vendor_id', e.target.value)}
            >
              <option value="">Select a vendor...</option>
              {[...vendors]
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
            </select>
          </div>

          {/* Issue Date */}
          <div>
            <FieldLabel>Issue Date</FieldLabel>
            <input
              type="date"
              className="block-input font-mono"
              value={form.issue_date}
              onChange={(e) => updateField('issue_date', e.target.value)}
            />
          </div>

          {/* Due Date */}
          <div>
            <FieldLabel>Due Date</FieldLabel>
            <input
              type="date"
              className="block-input font-mono"
              value={form.due_date}
              onChange={(e) => updateField('due_date', e.target.value)}
              // DATE: Item #3 — due date can't precede issue date.
              min={form.issue_date || undefined}
            />
          </div>

          {/* Status */}
          <div>
            <FieldLabel>Status</FieldLabel>
            <select
              className="block-select"
              value={form.status}
              onChange={(e) => updateField('status', e.target.value as BillStatus)}
            >
              {/* Sorted alphabetically per app-wide UX directive (originally workflow order: Draft → Pending → Approved) */}
              <option value="approved">Approved</option>
              <option value="draft">Draft</option>
              <option value="pending">Pending</option>
            </select>
          </div>

          {/* Notes */}
          <div>
            <FieldLabel>Notes</FieldLabel>
            <textarea
              className="block-input"
              rows={3}
              placeholder="Internal notes..."
              value={form.notes}
              onChange={(e) => updateField('notes', e.target.value)}
              style={{ resize: 'vertical' }}
            />
          </div>
        </div>
      </div>

      {/* Line items */}
      <div className="block-card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            Line Items
          </span>
          <button
            className="block-btn flex items-center gap-1.5 text-xs py-1 px-2"
            style={{ borderRadius: '6px' }}
            onClick={addLine}
          >
            <Plus size={14} />
            Add Line
          </button>
        </div>

        <table className="block-table">
          <thead>
            <tr>
              <th style={{ width: '32%' }}>Description</th>
              <th style={{ width: '20%' }}>Account</th>
              <th style={{ width: '10%' }}>Qty</th>
              <th style={{ width: '14%' }}>Unit Price</th>
              <th style={{ width: '14%' }} className="text-right">Amount</th>
              <th style={{ width: '10%' }}></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const amount = line.quantity * line.unit_price;
              return (
                <tr key={line._key}>
                  <td className="p-1">
                    <input
                      className="block-input text-xs"
                      placeholder="Item description"
                      value={line.description}
                      onChange={(e) => updateLine(line._key, 'description', e.target.value)}
                    />
                  </td>
                  <td className="p-1">
                    <select
                      className="block-select text-xs"
                      value={line.account_id}
                      onChange={(e) => updateLine(line._key, 'account_id', e.target.value)}
                    >
                      <option value="">Select account</option>
                      {groupAccountsByType(accounts).map((g) => (
                        <optgroup key={g.label} label={g.label}>
                          {g.items.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.code ? `${a.code} - ${a.name}` : a.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </td>
                  <td className="p-1">
                    <input
                      type="number"
                      min={1}
                      step="1"
                      className="block-input text-right font-mono text-xs"
                      value={line.quantity}
                      onChange={(e) =>
                        updateLine(
                          line._key,
                          'quantity',
                          Math.max(1, parseFloat(e.target.value) || 1)
                        )
                      }
                    />
                  </td>
                  <td className="p-1">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="block-input text-right font-mono text-xs"
                      value={line.unit_price}
                      onChange={(e) =>
                        updateLine(line._key, 'unit_price', parseFloat(e.target.value) || 0)
                      }
                    />
                  </td>
                  <td className="p-1 text-right font-mono text-text-secondary text-xs">
                    {formatCurrency(amount)}
                  </td>
                  <td className="p-1 text-center">
                    <button
                      className="text-text-muted hover:text-accent-expense transition-colors p-1"
                      onClick={() => removeLine(line._key)}
                      title="Remove line"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div className="flex justify-end">
        <div className="block-card w-80 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Subtotal</span>
            <span className="font-mono text-text-primary">{formatCurrency(subtotal)}</span>
          </div>

          <div className="flex justify-between text-sm items-center gap-4">
            <span className="text-text-secondary flex-shrink-0">Tax %</span>
            <input
              type="number"
              min={0}
              step="0.01"
              className="block-input text-right font-mono w-24"
              style={{ borderRadius: '6px' }}
              value={form.tax_pct}
              onChange={(e) => updateField('tax_pct', parseFloat(e.target.value) || 0)}
            />
          </div>

          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Tax Amount</span>
            <span className="font-mono text-text-primary">{formatCurrency(taxAmount)}</span>
          </div>

          <div
            className="flex justify-between text-sm font-bold pt-3"
            style={{ borderTop: '1px solid var(--color-border-primary)' }}
          >
            <span className="text-text-primary">Total</span>
            <span className="font-mono text-text-primary text-lg">{formatCurrency(total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
// BillDetail
// ═══════════════════════════════════════════════════════════
interface BillDetailProps {
  billId: string;
  onBack: () => void;
  onEdit: (id: string) => void;
}

const BillDetail: React.FC<BillDetailProps> = ({ billId, onBack, onEdit }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [bill, setBill] = useState<Bill | null>(null);
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [lines, setLines] = useState<BillLineItem[]>([]);
  const [payments, setPayments] = useState<BillPayment[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  // Payment form state
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(todayISO());
  const [payMethod, setPayMethod] = useState('check');
  const [payAccountId, setPayAccountId] = useState('');
  const [payReference, setPayReference] = useState('');
  const [payLoading, setPayLoading] = useState(false);
  const [payErrors, setPayErrors] = useState<string[]>([]);

  const loadData = useCallback(async () => {
    if (!activeCompany) return;
    try {
      const b = await api.get('bills', billId);
      if (!b) return;
      setBill(b);

      const [lineData, paymentData, accountData] = await Promise.all([
        api.query('bill_line_items', { bill_id: billId }),
        api.query('bill_payments', { bill_id: billId }),
        api.query('accounts', { company_id: activeCompany?.id }),
      ]);

      setLines(lineData ?? []);
      setPayments(paymentData ?? []);
      setAccounts(accountData ?? []);

      if (b.vendor_id) {
        try {
          const vendorData = await api.get('vendors', b.vendor_id);
          setVendor(vendorData ?? null);
        } catch {
          setVendor(null);
        }
      }

      // Pre-fill payment amount with balance
      const balance = b.total - b.amount_paid;
      setPayAmount(balance > 0 ? balance.toFixed(2) : '0.00');
    } catch (err) {
      console.error('Failed to load bill detail:', err);
    } finally {
      setLoading(false);
    }
  }, [billId, activeCompany]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const balance = useMemo(() => (bill ? bill.total - bill.amount_paid : 0), [bill]);

  const accountMap = useMemo(() => {
    const m = new Map<string, string>();
    accounts.forEach((a) => m.set(a.id, a.code ? `${a.code} - ${a.name}` : a.name));
    return m;
  }, [accounts]);

  const handleRecordPayment = async () => {
    const errs: string[] = [];
    const amt = parseFloat(payAmount);
    if (!payAmount || isNaN(amt) || amt <= 0) errs.push('Payment amount must be greater than zero.');
    if (amt > balance + 0.001) errs.push(`Payment amount cannot exceed balance of ${formatCurrency(balance)}.`);
    if (!payDate) errs.push('Payment date is required.');
    if (!payAccountId) errs.push('Account is required.');
    if (errs.length > 0) { setPayErrors(errs); return; }
    setPayErrors([]);

    setPayLoading(true);
    try {
      await api.billsPay(
        billId,
        amt,
        payDate,
        payMethod,
        payAccountId,
        payReference || undefined
      );
      // Reload data to reflect new payment
      setLoading(true);
      await loadData();
    } catch (err: any) {
      console.error('Failed to record payment:', err);
      const msg = err?.message || String(err) || 'Unknown error';
      setPayErrors([`Failed to record payment: ${msg}`]);
    } finally {
      setPayLoading(false);
    }
  };

  const buildPrintHTML = () => {
    if (!bill) return '';
    return generateBillHTML(bill, activeCompany, vendor, lines, undefined, accounts);
  };
  const handlePreview = async () => {
    const html = buildPrintHTML();
    if (!html) return;
    await api.printPreview(html, `Bill ${bill?.bill_number || ''}`);
  };
  const handlePrint = async () => {
    const html = buildPrintHTML();
    if (!html) return;
    await api.print(html);
  };
  const handleSavePDF = async () => {
    const html = buildPrintHTML();
    if (!html) return;
    await api.saveToPDF(html, `Bill-${bill?.bill_number || 'document'}`);
  };

  const handleDuplicate = async () => {
    if (!bill) return;
    const result = await api.cloneRecord('bills', bill.id);
    if (result?.error) {
      // VISIBILITY: surface duplicate-bill errors instead of swallowing
      console.error('Duplicate bill failed:', result.error);
      setPayErrors([`Failed to duplicate bill: ${result.error}`]);
      return;
    }
    onBack();
  };

  if (loading || !bill) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-text-muted text-sm font-mono">Loading bill...</span>
      </div>
    );
  }

  const badge = formatStatus(bill.status);

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      {/* Header */}
      <div className="module-header">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="block-btn p-2" title="Back" style={{ borderRadius: '6px' }}>
            <ArrowLeft size={16} />
          </button>
          <h1 className="module-title text-text-primary">{bill.bill_number}</h1>
          <span className={badge.className}>{badge.label}</span>
        </div>
        <div className="module-actions">
          <button
            className="block-btn flex items-center gap-2"
            style={{ borderRadius: '6px' }}
            onClick={handlePreview}
          >
            <Eye size={14} /> Preview
          </button>
          <button
            className="block-btn flex items-center gap-2"
            style={{ borderRadius: '6px' }}
            onClick={handlePrint}
          >
            <Printer size={14} /> Print
          </button>
          <button
            className="block-btn flex items-center gap-2"
            style={{ borderRadius: '6px' }}
            onClick={handleSavePDF}
          >
            <Download size={14} /> Save PDF
          </button>
          <button
            onClick={handleDuplicate}
            className="flex items-center gap-2 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue hover:text-accent-blue transition-colors"
          >
            <Copy size={14} /> Duplicate
          </button>
          <button
            className="block-btn flex items-center gap-2"
            style={{ borderRadius: '6px' }}
            onClick={() => onEdit(billId)}
          >
            <Edit size={14} />
            Edit
          </button>
        </div>
      </div>

      {/* Two-column info */}
      <div className="grid grid-cols-2 gap-6">
        {/* Left: bill info */}
        <div className="block-card space-y-4">
          <div className="text-xs font-semibold text-text-muted uppercase tracking-wider border-b border-border-primary pb-2">
            Bill Details
          </div>
          <div className="grid grid-cols-2 gap-y-3 text-sm">
            <span className="text-text-muted">Bill #</span>
            <span className="font-mono text-accent-blue">{bill.bill_number}</span>

            <span className="text-text-muted">Vendor</span>
            <span className="text-text-primary">{vendor?.name ?? '—'}</span>

            <span className="text-text-muted">Issue Date</span>
            <span className="font-mono text-text-secondary">{formatDate(bill.issue_date)}</span>

            <span className="text-text-muted">Due Date</span>
            <span className="font-mono text-text-secondary">{formatDate(bill.due_date)}</span>

            <span className="text-text-muted">Status</span>
            <span className={badge.className}>{badge.label}</span>

            {bill.notes && (
              <>
                <span className="text-text-muted">Notes</span>
                <span className="text-text-secondary">{bill.notes}</span>
              </>
            )}
          </div>
        </div>

        {/* Right: totals */}
        <div className="block-card space-y-3">
          <div className="text-xs font-semibold text-text-muted uppercase tracking-wider border-b border-border-primary pb-2">
            Totals
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-text-secondary">Subtotal</span>
              <span className="font-mono text-text-primary">{formatCurrency(bill.subtotal)}</span>
            </div>
            {bill.tax_amount > 0 && (
              <div className="flex justify-between">
                <span className="text-text-secondary">Tax</span>
                <span className="font-mono text-text-primary">{formatCurrency(bill.tax_amount)}</span>
              </div>
            )}
            <div
              className="flex justify-between font-bold pt-2"
              style={{ borderTop: '1px solid var(--color-border-primary)' }}
            >
              <span className="text-text-primary">Total</span>
              <span className="font-mono text-text-primary text-base">{formatCurrency(bill.total)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-secondary">Amount Paid</span>
              <span className="font-mono text-accent-income">{formatCurrency(bill.amount_paid)}</span>
            </div>
            <div
              className="flex justify-between font-bold pt-2"
              style={{ borderTop: '1px solid var(--color-border-primary)' }}
            >
              <span className="text-text-primary">Balance Due</span>
              <span
                className={`font-mono text-base ${
                  balance > 0 ? 'text-accent-expense' : 'text-accent-income'
                }`}
              >
                {formatCurrency(balance)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Line Items */}
      <div className="block-card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border-primary">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            Line Items
          </span>
        </div>
        {lines.length === 0 ? (
          <div className="p-4 text-center">
            <p className="text-sm text-text-muted">No line items recorded.</p>
          </div>
        ) : (
          <table className="block-table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Account</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Unit Price</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <td className="text-text-primary">{line.description}</td>
                  <td className="text-text-secondary text-xs">
                    {accountMap.get(line.account_id) ?? '—'}
                  </td>
                  <td className="text-right font-mono text-text-secondary">{line.quantity}</td>
                  <td className="text-right font-mono text-text-secondary">
                    {formatCurrency(line.unit_price)}
                  </td>
                  <td className="text-right font-mono text-text-primary">
                    {formatCurrency(line.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Payments */}
      <div className="block-card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border-primary">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            Payment History
          </span>
        </div>
        {payments.length === 0 ? (
          <div className="p-4 text-center">
            <p className="text-sm text-text-muted">No payments recorded yet.</p>
          </div>
        ) : (
          <table className="block-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Method</th>
                <th>Account</th>
                <th>Reference</th>
                <th className="text-right">Amount</th>
                <th style={{ width: '40px' }}></th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="font-mono text-text-secondary text-xs">{p.payment_date}</td>
                  <td className="text-text-secondary capitalize text-xs">
                    {PAYMENT_METHODS.find((m) => m.value === p.payment_method)?.label ??
                      p.payment_method}
                  </td>
                  <td className="text-text-muted text-xs">
                    {accountMap.get(p.account_id) ?? '—'}
                  </td>
                  <td className="font-mono text-text-muted text-xs">
                    {p.reference || '—'}
                  </td>
                  <td className="text-right font-mono text-accent-income">
                    {formatCurrency(p.amount)}
                  </td>
                  <td className="text-center">
                    <button
                      className="text-text-muted hover:text-accent-expense transition-colors p-0.5"
                      onClick={async () => {
                        if (!window.confirm('Delete this payment?')) return;
                        try {
                          await api.remove('bill_payments', p.id);
                          setLoading(true);
                          await loadData();
                        } catch (err: any) {
                          console.error('Failed to delete payment:', err);
                          alert('Operation failed: ' + (err?.message || 'Unknown error'));
                        }
                      }}
                      title="Delete payment"
                      aria-label="Delete payment"
                    >
                      <Trash2 size={11} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Record Payment — only shown if balance > 0 */}
      {/* Cross-integration panels */}
      <div className="grid grid-cols-2 gap-4 mt-6">
        <RelatedPanel entityType="bill" entityId={billId} hide={['lines', 'payments']} />
        <EntityTimeline entityType="bills" entityId={billId} />
      </div>

      {balance > 0.001 && (
        <div className="block-card">
          <div className="text-xs font-semibold text-text-muted uppercase tracking-wider border-b border-border-primary pb-3 mb-4 flex items-center gap-2">
            <DollarSign size={14} />
            Record Payment
          </div>

          {payErrors.length > 0 && (
            <div
              style={{
                background: 'rgba(248,113,113,0.08)',
                border: '1px solid #ef4444',
                borderRadius: '6px',
                padding: '10px 14px',
                marginBottom: '14px',
              }}
            >
              <ul style={{ margin: 0, padding: '0 0 0 14px', listStyle: 'disc' }}>
                {payErrors.map((e, i) => (
                  <li key={i} style={{ color: '#ef4444', fontSize: '12px', lineHeight: '1.6' }}>
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-3 gap-4 mb-4">
            {/* Amount */}
            <div>
              <FieldLabel>Amount</FieldLabel>
              <input
                type="number"
                min={0.01}
                step="0.01"
                className="block-input font-mono"
                style={{ borderRadius: '6px' }}
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
              />
            </div>

            {/* Payment Date */}
            <div>
              <FieldLabel>Payment Date</FieldLabel>
              <input
                type="date"
                className="block-input font-mono"
                style={{ borderRadius: '6px' }}
                value={payDate}
                onChange={(e) => setPayDate(e.target.value)}
              />
            </div>

            {/* Method */}
            <div>
              <FieldLabel>Payment Method</FieldLabel>
              <select
                className="block-select"
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value)}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Account */}
            <div>
              <FieldLabel>Account</FieldLabel>
              <select
                className="block-select"
                value={payAccountId}
                onChange={(e) => setPayAccountId(e.target.value)}
              >
                <option value="">Select account...</option>
                {groupAccountsByType(accounts).map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.items.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code ? `${a.code} - ${a.name}` : a.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* Reference */}
            <div>
              <FieldLabel>Reference (optional)</FieldLabel>
              <input
                type="text"
                className="block-input font-mono"
                style={{ borderRadius: '6px' }}
                placeholder="Check #, ACH ID..."
                value={payReference}
                onChange={(e) => setPayReference(e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              className="block-btn-primary flex items-center gap-2"
              style={{ borderRadius: '6px' }}
              disabled={payLoading}
              onClick={handleRecordPayment}
            >
              <DollarSign size={14} />
              {payLoading ? 'Recording...' : 'Record Payment'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
// BillsModule — Router
// ═══════════════════════════════════════════════════════════
const BillsModule: React.FC = () => {
  const [view, setView] = useState<View>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [listKey, setListKey] = useState(0);

  // Cross-module deep link
  const consumeFocusEntity = useAppStore((s) => s.consumeFocusEntity);
  useEffect(() => {
    const focus = consumeFocusEntity('bill');
    if (focus) {
      setSelectedId(focus.id);
      setView('detail');
    }
  }, [consumeFocusEntity]);

  const goToList = useCallback(() => {
    setView('list');
    setSelectedId(null);
    setEditId(null);
  }, []);

  const goToNew = useCallback(() => {
    setEditId(null);
    setView('form');
  }, []);

  const goToEdit = useCallback((id: string) => {
    setEditId(id);
    setView('form');
  }, []);

  const goToDetail = useCallback((id: string) => {
    setSelectedId(id);
    setView('detail');
  }, []);

  const handleSaved = useCallback((id: string) => {
    setSelectedId(id);
    setEditId(null);
    setListKey(k => k + 1);
    setView('detail');
  }, []);

  if (view === 'form') {
    return (
      <BillForm
        billId={editId}
        onBack={editId ? () => goToDetail(editId) : goToList}
        onSaved={handleSaved}
      />
    );
  }

  if (view === 'detail' && selectedId) {
    return (
      <BillDetail
        billId={selectedId}
        onBack={goToList}
        onEdit={goToEdit}
      />
    );
  }

  return (
    <BillsList
      key={listKey}
      onNew={goToNew}
      onView={goToDetail}
    />
  );
};

export default BillsModule;
