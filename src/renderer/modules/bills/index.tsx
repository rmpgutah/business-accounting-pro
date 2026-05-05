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
  LayoutDashboard,
  List,
  TrendingUp,
  Users,
  Activity,
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
  is_1099_eligible?: number;
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
  // ── Invoice-parity fields (2026-04-29) ──
  row_type: 'item' | 'section' | 'note' | 'subtotal';
  unit_label: string;
  item_code: string;
  line_discount: number;
  line_discount_type: 'percent' | 'flat';
  discount_pct: number;
  tax_rate: number;
  tax_rate_override: number; // -1 = use bill default
  bold: number;
  italic: number;
  highlight_color: string;
  project_id: string;
}

export type BillType = 'standard' | 'service' | 'product' | 'recurring' | 'credit_memo';

const BILL_TYPE_CONFIG: Record<BillType, { label: string; description: string; numberPrefix: string }> = {
  standard:    { label: 'Standard',    description: 'General purpose bill',                  numberPrefix: 'BILL' },
  service:     { label: 'Service',     description: 'Labor, consulting, or hourly services', numberPrefix: 'SVC'  },
  product:     { label: 'Product',     description: 'Physical goods purchase',               numberPrefix: 'PRD'  },
  recurring:   { label: 'Recurring',   description: 'Subscription or repeating bill',        numberPrefix: 'REC'  },
  credit_memo: { label: 'Credit Memo', description: 'Credit / refund from vendor',           numberPrefix: 'CR'   },
};

const BILL_CURRENCIES = ['AUD', 'CAD', 'CHF', 'CNY', 'EUR', 'GBP', 'INR', 'JPY', 'MXN', 'USD'];

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

const newLineDraft = (rowType: 'item' | 'section' | 'note' | 'subtotal' = 'item'): LineItemDraft => ({
  _key: newLineKey(),
  description: '',
  quantity: 1,
  unit_price: 0,
  account_id: '',
  row_type: rowType,
  unit_label: '',
  item_code: '',
  line_discount: 0,
  line_discount_type: 'percent',
  discount_pct: 0,
  tax_rate: 0,
  tax_rate_override: -1,
  bold: 0,
  italic: 0,
  highlight_color: '',
  project_id: '',
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

  // Smart filters
  const [showFilters, setShowFilters] = useState(false);
  const [minAmount, setMinAmount] = useState<string>('');
  const [maxAmount, setMaxAmount] = useState<string>('');
  const [ageFilter, setAgeFilter] = useState<'all' | '0-30' | '31-60' | '61-90' | '90+'>('all');
  const [dueSoon, setDueSoon] = useState(false);
  const [recurringOnly, setRecurringOnly] = useState(false);

  // Bulk action selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [opMessage, setOpMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

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

  const vendor1099Map = useMemo(() => {
    const m = new Map<string, boolean>();
    vendors.forEach((v) => m.set(v.id, !!v.is_1099_eligible));
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

    // Smart filters
    const min = parseFloat(minAmount);
    const max = parseFloat(maxAmount);
    if (!isNaN(min)) list = list.filter((b) => b.total >= min);
    if (!isNaN(max)) list = list.filter((b) => b.total <= max);

    if (ageFilter !== 'all') {
      const today = new Date();
      list = list.filter((b) => {
        if (!b.due_date) return false;
        const due = new Date(b.due_date);
        const daysOverdue = Math.floor(
          (today.getTime() - due.getTime()) / 86400000
        );
        if (daysOverdue < 0) return false; // not yet due
        if (ageFilter === '0-30') return daysOverdue <= 30;
        if (ageFilter === '31-60') return daysOverdue > 30 && daysOverdue <= 60;
        if (ageFilter === '61-90') return daysOverdue > 60 && daysOverdue <= 90;
        if (ageFilter === '90+') return daysOverdue > 90;
        return true;
      });
    }

    if (dueSoon) {
      const today = new Date();
      const sevenDays = new Date();
      sevenDays.setDate(sevenDays.getDate() + 7);
      list = list.filter((b) => {
        if (!b.due_date) return false;
        const due = new Date(b.due_date);
        return (
          due >= today &&
          due <= sevenDays &&
          b.amount_paid < b.total - 0.001
        );
      });
    }

    if (recurringOnly) {
      list = list.filter((b) =>
        (b.notes ?? '').toLowerCase().includes('recurring')
      );
    }

    return list;
  }, [
    bills,
    activeTab,
    search,
    vendorMap,
    minAmount,
    maxAmount,
    ageFilter,
    dueSoon,
    recurringOnly,
  ]);

  // Late-fee detection: any unpaid bill > 30 days past due
  const lateFeeCount = useMemo(() => {
    const today = new Date();
    return bills.filter((b) => {
      if (b.amount_paid >= b.total - 0.001) return false;
      if (!b.due_date) return false;
      const due = new Date(b.due_date);
      return (today.getTime() - due.getTime()) / 86400000 > 30;
    }).length;
  }, [bills]);

  // ─── Bulk action handlers ───────────────────────────────
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((b) => b.id)));
  };

  const flashMessage = (kind: 'success' | 'error', text: string) => {
    setOpMessage({ kind, text });
    setTimeout(() => setOpMessage(null), 4000);
  };

  const handleBulkApprove = async () => {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      let count = 0;
      for (const id of selectedIds) {
        const b = bills.find((x) => x.id === id);
        if (b && (b.status === 'draft' || b.status === 'pending')) {
          await api.update('bills', id, { status: 'approved' });
          count += 1;
        }
      }
      setSelectedIds(new Set());
      flashMessage('success', `Approved ${count} bill${count !== 1 ? 's' : ''}`);
      // refresh list
      const billData = await api.query(
        'bills',
        { company_id: activeCompany!.id },
        { field: 'bill_date', dir: 'desc' },
        2000
      );
      setBills(Array.isArray(billData) ? billData : []);
    } catch (err: any) {
      flashMessage('error', 'Failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkPay = async () => {
    if (selectedIds.size === 0) return;
    if (
      !window.confirm(
        `Mark ${selectedIds.size} bill${selectedIds.size !== 1 ? 's' : ''} as fully paid? This sets amount_paid to total and status to paid.`
      )
    )
      return;
    setBulkBusy(true);
    try {
      let count = 0;
      for (const id of selectedIds) {
        const b = bills.find((x) => x.id === id);
        if (!b) continue;
        await api.update('bills', id, {
          amount_paid: b.total,
          status: 'paid',
        });
        count += 1;
      }
      setSelectedIds(new Set());
      flashMessage('success', `Marked ${count} bill${count !== 1 ? 's' : ''} as paid`);
      const billData = await api.query(
        'bills',
        { company_id: activeCompany!.id },
        { field: 'bill_date', dir: 'desc' },
        2000
      );
      setBills(Array.isArray(billData) ? billData : []);
    } catch (err: any) {
      flashMessage('error', 'Failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkSchedule = async () => {
    if (selectedIds.size === 0) return;
    const dateStr = window.prompt(
      'Enter scheduled payment date (YYYY-MM-DD):',
      new Date().toISOString().slice(0, 10)
    );
    if (!dateStr) return;
    setBulkBusy(true);
    try {
      let count = 0;
      for (const id of selectedIds) {
        const b = bills.find((x) => x.id === id);
        if (!b) continue;
        const newNotes = `${(b.notes ?? '').trim()} [Scheduled: ${dateStr}]`.trim();
        await api.update('bills', id, { notes: newNotes });
        count += 1;
      }
      setSelectedIds(new Set());
      flashMessage('success', `Scheduled ${count} bill${count !== 1 ? 's' : ''} for ${dateStr}`);
    } catch (err: any) {
      flashMessage('error', 'Failed: ' + (err?.message || 'Unknown error'));
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkExport = () => {
    if (selectedIds.size === 0) return;
    const rows = ['Bill Number,Vendor,Issue Date,Due Date,Total,Amount Paid,Balance,Status'];
    for (const id of selectedIds) {
      const b = bills.find((x) => x.id === id);
      if (!b) continue;
      const balance = b.total - b.amount_paid;
      rows.push(
        [
          JSON.stringify(b.bill_number),
          JSON.stringify(vendorMap.get(b.vendor_id) ?? ''),
          b.issue_date,
          b.due_date,
          b.total,
          b.amount_paid,
          balance,
          b.status,
        ].join(',')
      );
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bills-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    flashMessage('success', `Exported ${selectedIds.size} bill${selectedIds.size !== 1 ? 's' : ''}`);
  };

  const handlePrintAPAging = async () => {
    const today = new Date();
    const buckets = {
      current: [] as Bill[],
      d30: [] as Bill[],
      d60: [] as Bill[],
      d90: [] as Bill[],
      d90plus: [] as Bill[],
    };
    for (const b of bills) {
      if (b.amount_paid >= b.total - 0.001) continue;
      if (!b.due_date) {
        buckets.current.push(b);
        continue;
      }
      const days = Math.floor(
        (today.getTime() - new Date(b.due_date).getTime()) / 86400000
      );
      if (days < 0) buckets.current.push(b);
      else if (days <= 30) buckets.d30.push(b);
      else if (days <= 60) buckets.d60.push(b);
      else if (days <= 90) buckets.d90.push(b);
      else buckets.d90plus.push(b);
    }
    const renderRows = (list: Bill[]) =>
      list
        .map((b) => {
          const balance = b.total - b.amount_paid;
          return `<tr>
            <td>${b.bill_number}</td>
            <td>${vendorMap.get(b.vendor_id) ?? ''}</td>
            <td>${b.issue_date}</td>
            <td>${b.due_date ?? ''}</td>
            <td style="text-align:right">${formatCurrency(b.total)}</td>
            <td style="text-align:right">${formatCurrency(balance)}</td>
          </tr>`;
        })
        .join('');
    const sumBalance = (list: Bill[]) =>
      list.reduce((s, b) => s + (b.total - b.amount_paid), 0);
    const html = `
      <html><head><title>AP Aging Report</title>
      <style>
        body{font-family:Arial,sans-serif;padding:24px;color:#222}
        h1{font-size:18px;margin:0 0 4px 0}
        h2{font-size:13px;margin:18px 0 6px 0;border-bottom:1px solid #ddd;padding-bottom:3px}
        .sub{font-size:11px;color:#666;margin-bottom:14px}
        table{border-collapse:collapse;width:100%;font-size:11px;margin-bottom:10px}
        th,td{border:1px solid #ddd;padding:5px 6px;text-align:left}
        th{background:#f3f4f6;text-transform:uppercase;font-size:10px}
        .summary{margin-top:18px;font-size:12px}
        .summary div{margin-bottom:4px}
      </style></head><body>
        <h1>Accounts Payable Aging Report</h1>
        <div class="sub">${activeCompany?.name ?? ''} — ${new Date().toLocaleString()}</div>
        <div class="summary">
          <div><strong>Current (not yet due):</strong> ${buckets.current.length} bills, ${formatCurrency(sumBalance(buckets.current))}</div>
          <div><strong>0-30 days:</strong> ${buckets.d30.length} bills, ${formatCurrency(sumBalance(buckets.d30))}</div>
          <div><strong>31-60 days:</strong> ${buckets.d60.length} bills, ${formatCurrency(sumBalance(buckets.d60))}</div>
          <div><strong>61-90 days:</strong> ${buckets.d90.length} bills, ${formatCurrency(sumBalance(buckets.d90))}</div>
          <div><strong>90+ days:</strong> ${buckets.d90plus.length} bills, ${formatCurrency(sumBalance(buckets.d90plus))}</div>
        </div>
        ${[
          ['Current (not yet due)', buckets.current],
          ['0-30 days', buckets.d30],
          ['31-60 days', buckets.d60],
          ['61-90 days', buckets.d90],
          ['90+ days', buckets.d90plus],
        ]
          .map(([title, list]) => {
            const rows = renderRows(list as Bill[]);
            if (!rows) return `<h2>${title}</h2><div style="font-size:11px;color:#999">None</div>`;
            return `<h2>${title}</h2>
              <table><thead><tr>
                <th>Bill #</th><th>Vendor</th><th>Issue</th><th>Due</th>
                <th style="text-align:right">Total</th><th style="text-align:right">Balance</th>
              </tr></thead><tbody>${rows}</tbody></table>`;
          })
          .join('')}
      </body></html>`;
    try {
      await api.printPreview(html, 'AP Aging Report');
    } catch {
      /* ignore */
    }
  };

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
          <button
            className="block-btn flex items-center gap-1.5 text-xs"
            onClick={handlePrintAPAging}
            disabled={bills.length === 0}
            title="Print AP aging report"
          >
            <Printer size={14} /> AP Aging
          </button>
          <button className="block-btn-primary flex items-center gap-2" onClick={onNew}>
            <Plus size={16} />
            New Bill
          </button>
        </div>
      </div>

      {/* Op message */}
      {opMessage && (
        <div
          className={`text-xs px-3 py-2 border ${
            opMessage.kind === 'success'
              ? 'text-accent-income bg-accent-income/10 border-accent-income/20'
              : 'text-accent-expense bg-accent-expense/10 border-accent-expense/20'
          }`}
          style={{ borderRadius: '6px' }}
        >
          {opMessage.text}
        </div>
      )}

      {/* Late-fee alert banner */}
      {lateFeeCount > 0 && (
        <div
          className="block-card p-3 flex items-start gap-3"
          style={{
            borderRadius: '6px',
            borderColor: 'rgba(239,68,68,0.4)',
            background: 'rgba(239,68,68,0.08)',
          }}
        >
          <AlertTriangle
            size={18}
            className="text-accent-expense flex-shrink-0 mt-0.5"
          />
          <div className="flex-1">
            <div className="text-sm font-semibold text-text-primary">
              {lateFeeCount} bill{lateFeeCount !== 1 ? 's' : ''} over 30 days
              past due — late fees may apply
            </div>
            <div className="text-xs text-text-muted mt-1">
              Review the AP aging report to see the affected vendors and
              outstanding balances.
            </div>
          </div>
        </div>
      )}

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

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            className={`block-btn text-xs ${showFilters ? 'border-accent-blue text-accent-blue' : ''}`}
            onClick={() => setShowFilters((v) => !v)}
            title="Toggle smart filters"
          >
            Smart Filters
          </button>
          {/* Search */}
          <div className="relative">
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
      </div>

      {/* Smart filters panel */}
      {showFilters && (
        <div className="block-card p-3 grid grid-cols-5 gap-3" style={{ borderRadius: '6px' }}>
          <div>
            <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">
              Min Amount
            </label>
            <input
              type="number"
              className="block-input text-xs"
              placeholder="0"
              value={minAmount}
              onChange={(e) => setMinAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">
              Max Amount
            </label>
            <input
              type="number"
              className="block-input text-xs"
              placeholder="No limit"
              value={maxAmount}
              onChange={(e) => setMaxAmount(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-text-muted uppercase tracking-wider block mb-1">
              Age Bucket
            </label>
            <select
              className="block-select text-xs"
              value={ageFilter}
              onChange={(e) => setAgeFilter(e.target.value as typeof ageFilter)}
            >
              <option value="all">All</option>
              <option value="0-30">0-30 days</option>
              <option value="31-60">31-60 days</option>
              <option value="61-90">61-90 days</option>
              <option value="90+">90+ days</option>
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={dueSoon}
                onChange={(e) => setDueSoon(e.target.checked)}
                style={{ accentColor: '#3b82f6' }}
              />
              Due in 7 days
            </label>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={recurringOnly}
                onChange={(e) => setRecurringOnly(e.target.checked)}
                style={{ accentColor: '#3b82f6' }}
              />
              Recurring only
            </label>
          </div>
        </div>
      )}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div
          className="block-card p-3 flex items-center justify-between"
          style={{
            borderRadius: '6px',
            borderColor: 'rgba(59,130,246,0.3)',
          }}
        >
          <span className="text-xs font-semibold text-text-primary">
            {selectedIds.size} bill{selectedIds.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              className="block-btn flex items-center gap-1.5 text-xs"
              onClick={handleBulkApprove}
              disabled={bulkBusy}
            >
              <CheckCircle size={12} /> Approve
            </button>
            <button
              className="block-btn flex items-center gap-1.5 text-xs"
              onClick={handleBulkSchedule}
              disabled={bulkBusy}
            >
              <Clock size={12} /> Schedule
            </button>
            <button
              className="block-btn flex items-center gap-1.5 text-xs"
              onClick={handleBulkPay}
              disabled={bulkBusy}
            >
              <DollarSign size={12} /> Mark Paid
            </button>
            <button
              className="block-btn flex items-center gap-1.5 text-xs"
              onClick={handleBulkExport}
              disabled={bulkBusy}
            >
              <Download size={12} /> Export CSV
            </button>
          </div>
        </div>
      )}

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
                <th style={{ width: '32px' }} onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={
                      filtered.length > 0 && selectedIds.size === filtered.length
                    }
                    onChange={toggleSelectAll}
                    className="cursor-pointer"
                    style={{ accentColor: '#3b82f6' }}
                  />
                </th>
                <th>Bill #</th>
                <th>Vendor</th>
                <th style={{ width: '50px' }} title="1099 eligible">1099</th>
                <th>Issue Date</th>
                <th>Due Date</th>
                <th className="text-right">Total</th>
                <th className="text-right">Amount Paid</th>
                <th className="text-right">Balance</th>
                <th>Status</th>
                <th style={{ width: '120px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((bill) => {
                const balance = bill.total - bill.amount_paid;
                const badge = formatStatus(bill.status);
                const vendorName = vendorMap.get(bill.vendor_id) ?? '—';
                const is1099 = vendor1099Map.get(bill.vendor_id) ?? false;
                const canPay = balance > 0.001;
                return (
                  <tr
                    key={bill.id}
                    className="cursor-pointer"
                    onClick={() => onView(bill.id)}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(bill.id)}
                        onChange={() => toggleSelect(bill.id)}
                        className="cursor-pointer"
                        style={{ accentColor: '#3b82f6' }}
                      />
                    </td>
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
                    <td className="text-center">
                      {is1099 ? (
                        <span
                          className="text-[9px] font-semibold px-1.5 py-0.5"
                          style={{
                            borderRadius: '4px',
                            background: 'rgba(59,130,246,0.12)',
                            color: 'var(--color-accent-blue)',
                            border: '1px solid rgba(59,130,246,0.3)',
                          }}
                          title="Vendor is 1099 eligible"
                        >
                          1099
                        </span>
                      ) : (
                        <span className="text-[10px] text-text-muted">—</span>
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
                      <div className="flex items-center gap-1">
                        <button
                          className="block-btn text-xs py-1 px-2"
                          style={{ borderRadius: '6px' }}
                          onClick={() => onView(bill.id)}
                        >
                          View
                        </button>
                        {canPay && (
                          <button
                            className="block-btn-primary text-xs py-1 px-2 inline-flex items-center gap-1"
                            style={{ borderRadius: '6px' }}
                            onClick={() => onView(bill.id)}
                            title="Open bill to record payment"
                          >
                            <DollarSign size={11} /> Pay
                          </button>
                        )}
                      </div>
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
  // ── Invoice-parity fields (2026-04-29) ──
  bill_type: BillType;
  po_number: string;
  job_reference: string;
  internal_notes: string;
  late_fee_pct: number;
  late_fee_grace_days: number;
  discount_pct: number;
  discount: number;        // flat discount amount
  shipping_amount: number;
  currency: string;
  exchange_rate: number;
  terms: string;
  terms_text: string;
  custom_field_1: string;
  custom_field_2: string;
  custom_field_3: string;
  custom_field_4: string;
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
    // Invoice-parity defaults
    bill_type: 'standard',
    po_number: '',
    job_reference: '',
    internal_notes: '',
    late_fee_pct: 0,
    late_fee_grace_days: 0,
    discount_pct: 0,
    discount: 0,
    shipping_amount: 0,
    currency: 'USD',
    exchange_rate: 1.0,
    terms: 'Net 30',
    terms_text: '',
    custom_field_1: '',
    custom_field_2: '',
    custom_field_3: '',
    custom_field_4: '',
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
            // Hydrate invoice-parity fields with safe fallbacks for legacy rows
            bill_type: (bill.bill_type as BillType) || 'standard',
            po_number: bill.po_number ?? '',
            job_reference: bill.job_reference ?? '',
            internal_notes: bill.internal_notes ?? '',
            late_fee_pct: Number(bill.late_fee_pct ?? 0),
            late_fee_grace_days: Number(bill.late_fee_grace_days ?? 0),
            discount_pct: Number(bill.discount_pct ?? 0),
            discount: Number(bill.discount_amount ?? 0),
            shipping_amount: Number(bill.shipping_amount ?? 0),
            currency: bill.currency || 'USD',
            exchange_rate: Number(bill.exchange_rate ?? 1.0),
            terms: bill.terms || 'Net 30',
            terms_text: bill.terms_text ?? '',
            custom_field_1: bill.custom_field_1 ?? '',
            custom_field_2: bill.custom_field_2 ?? '',
            custom_field_3: bill.custom_field_3 ?? '',
            custom_field_4: bill.custom_field_4 ?? '',
          });

          const lineData = await api.query('bill_line_items', { bill_id: billId });
          if (cancelled) return;
          if (lineData && lineData.length > 0) {
            setLines(
              lineData.map((l: any) => ({
                _key: newLineKey(),
                description: l.description ?? '',
                quantity: Number(l.quantity ?? 1),
                unit_price: Number(l.unit_price ?? 0),
                account_id: l.account_id ?? '',
                row_type: (l.row_type as LineItemDraft['row_type']) || 'item',
                unit_label: l.unit_label ?? '',
                item_code: l.item_code ?? '',
                line_discount: Number(l.line_discount ?? 0),
                line_discount_type: (l.line_discount_type as 'percent' | 'flat') || 'percent',
                discount_pct: Number(l.discount_pct ?? 0),
                tax_rate: Number(l.tax_rate ?? 0),
                tax_rate_override: Number(l.tax_rate_override ?? -1),
                bold: Number(l.bold ?? 0),
                italic: Number(l.italic ?? 0),
                highlight_color: l.highlight_color ?? '',
                project_id: l.project_id ?? '',
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
  // Per-line discount + tax applied (mirrors invoice math).
  // line.row_type === 'item' contributes to subtotal/tax. Other row types
  // (section, note, subtotal) are visual-only and ignored in totals.
  const lineDiscountedBase = (l: LineItemDraft): number => {
    const base = (l.quantity || 0) * (l.unit_price || 0);
    if (l.discount_pct > 0) return base * (1 - l.discount_pct / 100);
    if (l.line_discount > 0) {
      return l.line_discount_type === 'flat'
        ? base - l.line_discount
        : base * (1 - l.line_discount / 100);
    }
    return base;
  };
  const lineEffectiveRate = (l: LineItemDraft): number => {
    // BUG FIX: ?? -1 instead of >= 0 — null coerces to 0 in JavaScript,
    // which would silently apply 0% tax to lines whose override is null.
    const ovr = Number((l as any).tax_rate_override ?? -1);
    if (ovr >= 0) return ovr;
    if (l.tax_rate > 0) return l.tax_rate;
    return form.tax_pct;  // bill default
  };

  // Round each line to cents BEFORE summing — prevents float drift on
  // multi-rate bills where per-line columns must reconcile with totals box.
  const subtotal = useMemo(
    () => lines
      .filter(l => l.row_type === 'item')
      .reduce((s, l) => s + roundCents(lineDiscountedBase(l)), 0),
    [lines]
  );
  const taxAmount = useMemo(
    () => lines
      .filter(l => l.row_type === 'item')
      .reduce((s, l) => {
        const base = roundCents(lineDiscountedBase(l));
        const rate = lineEffectiveRate(l);
        return s + roundCents(base * (rate / 100));
      }, 0),
    [lines, form.tax_pct]
  );
  const total = useMemo(
    () => roundCents(subtotal - (form.discount || 0) + taxAmount + (form.shipping_amount || 0)),
    [subtotal, taxAmount, form.discount, form.shipping_amount]
  );

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
    const validLines = lines.filter((l) => l.description.trim() || Math.abs(l.unit_price) > 0);
    if (validLines.length === 0) errs.push('At least one line item is required.');
    // CREDIT MEMO support: bill_type=credit_memo allows negative totals/qty/price.
    // Standard bills still require positive totals to prevent accidental refunds.
    const allowNegatives = form.bill_type === 'credit_memo';
    validLines.forEach((l, i) => {
      if (l.row_type === 'item' && l.quantity === 0) {
        errs.push(`Line item ${i + 1}: quantity cannot be zero.`);
      }
    });
    if (!allowNegatives && total <= 0) {
      errs.push('Bill total must be greater than zero. (For refunds/credits, set Bill Type = Credit Memo.)');
    }
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
        discount_amount: form.discount || 0,
        total,
        notes: form.notes,
        // ── Invoice-parity persistence ──
        bill_type: form.bill_type,
        po_number: form.po_number.trim(),
        job_reference: form.job_reference.trim(),
        internal_notes: form.internal_notes,
        late_fee_pct: form.late_fee_pct,
        late_fee_grace_days: form.late_fee_grace_days,
        discount_pct: form.discount_pct,
        currency: form.currency,
        exchange_rate: form.exchange_rate,
        terms: form.terms,
        terms_text: form.terms_text,
        shipping_amount: form.shipping_amount || 0,
        custom_field_1: form.custom_field_1,
        custom_field_2: form.custom_field_2,
        custom_field_3: form.custom_field_3,
        custom_field_4: form.custom_field_4,
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

      // Create new line items with all invoice-parity fields.
      // Sort order preserved from the form's array index so reload matches save.
      for (let i = 0; i < validLines.length; i++) {
        const line = validLines[i];
        const base = roundCents(lineDiscountedBase(line));
        const rate = lineEffectiveRate(line);
        const lineTax = roundCents(base * (rate / 100));
        await api.create('bill_line_items', {
          bill_id: savedId,
          description: line.description,
          quantity: line.quantity,
          unit_price: line.unit_price,
          amount: base,
          account_id: line.account_id || null,
          row_type: line.row_type,
          unit_label: line.unit_label,
          item_code: line.item_code,
          line_discount: line.line_discount,
          line_discount_type: line.line_discount_type,
          discount_pct: line.discount_pct,
          tax_rate: line.tax_rate,
          tax_rate_override: line.tax_rate_override,
          tax_amount: lineTax,
          bold: line.bold,
          italic: line.italic,
          highlight_color: line.highlight_color,
          sort_order: i,
          project_id: line.project_id || null,
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

      {/* ── Bill Type Selector (mirrors invoice_type) ────────── */}
      <div className="block-card">
        <FieldLabel>Bill Type</FieldLabel>
        <div className="grid grid-cols-5 gap-2 mt-2">
          {(Object.keys(BILL_TYPE_CONFIG) as BillType[]).map((bt) => {
            const cfg = BILL_TYPE_CONFIG[bt];
            const active = form.bill_type === bt;
            return (
              <button
                key={bt}
                onClick={() => updateField('bill_type', bt)}
                className="text-left p-2 transition-colors"
                style={{
                  borderRadius: '6px',
                  border: '1px solid var(--color-border-primary)',
                  background: active ? 'var(--color-accent-blue)' : 'var(--color-bg-tertiary)',
                  color: active ? '#fff' : 'var(--color-text-primary)',
                }}
                title={cfg.description}
              >
                <div className="text-xs font-semibold">{cfg.label}</div>
                <div className="text-[10px] mt-0.5" style={{ opacity: 0.8 }}>{cfg.description}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Bill Details (PO #, Job Ref, Currency, Internal Notes) ─ */}
      <div className="block-card">
        <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Bill Details</div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <FieldLabel>PO Number</FieldLabel>
            <input
              type="text"
              className="block-input"
              placeholder="Optional vendor PO reference"
              value={form.po_number}
              onChange={(e) => updateField('po_number', e.target.value)}
            />
          </div>
          <div>
            <FieldLabel>Job Reference</FieldLabel>
            <input
              type="text"
              className="block-input"
              placeholder="Project / job tracking code"
              value={form.job_reference}
              onChange={(e) => updateField('job_reference', e.target.value)}
            />
          </div>
          <div>
            <FieldLabel>Currency</FieldLabel>
            <select
              className="block-select"
              value={form.currency}
              onChange={(e) => updateField('currency', e.target.value)}
            >
              {BILL_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <FieldLabel>Exchange Rate</FieldLabel>
            <input
              type="number"
              step="0.0001"
              className="block-input font-mono"
              value={form.exchange_rate}
              onChange={(e) => updateField('exchange_rate', parseFloat(e.target.value) || 1)}
              disabled={form.currency === 'USD'}
              title={form.currency === 'USD' ? 'Only used for non-USD bills' : ''}
            />
          </div>
          <div>
            <FieldLabel>Payment Terms</FieldLabel>
            <input
              type="text"
              className="block-input"
              placeholder="Net 30, Due on Receipt, etc."
              value={form.terms}
              onChange={(e) => updateField('terms', e.target.value)}
            />
          </div>
          <div>
            <FieldLabel>Internal Notes (staff only)</FieldLabel>
            <textarea
              className="block-input"
              rows={2}
              placeholder="Not visible on printed bill..."
              value={form.internal_notes}
              onChange={(e) => updateField('internal_notes', e.target.value)}
              style={{ resize: 'vertical' }}
            />
          </div>
        </div>
      </div>

      {/* ── Late Fees ──────────────────────────────────────── */}
      <div className="block-card">
        <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Late Fees</div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <FieldLabel>Late Fee % per month</FieldLabel>
            <input
              type="number"
              step="0.01"
              className="block-input font-mono"
              value={form.late_fee_pct}
              onChange={(e) => updateField('late_fee_pct', parseFloat(e.target.value) || 0)}
            />
          </div>
          <div>
            <FieldLabel>Grace Days</FieldLabel>
            <input
              type="number"
              step="1"
              className="block-input font-mono"
              value={form.late_fee_grace_days}
              onChange={(e) => updateField('late_fee_grace_days', parseInt(e.target.value) || 0)}
            />
          </div>
        </div>
        {(form.late_fee_pct > 0) && (
          <div className="text-[10px] text-text-muted mt-2">
            Bills not paid within {form.late_fee_grace_days} days past due will accrue {form.late_fee_pct}%/month late fees.
          </div>
        )}
      </div>

      {/* ── Custom Fields ──────────────────────────────────── */}
      <div className="block-card">
        <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">Custom Fields</div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          {[1, 2, 3, 4].map((n) => {
            const key = `custom_field_${n}` as 'custom_field_1' | 'custom_field_2' | 'custom_field_3' | 'custom_field_4';
            return (
              <div key={n}>
                <FieldLabel>Custom Field {n}</FieldLabel>
                <input
                  type="text"
                  className="block-input"
                  placeholder={`Optional metadata #${n}`}
                  value={form[key]}
                  onChange={(e) => updateField(key, e.target.value)}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* Line items — invoice-parity: row types, item code, unit label,
           per-line tax + discount, bold/italic, highlight color */}
      <div className="block-card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            Line Items
          </span>
          <div className="flex gap-2">
            <button
              className="block-btn flex items-center gap-1.5 text-xs py-1 px-2"
              style={{ borderRadius: '6px' }}
              onClick={addLine}
              title="Add line item"
            >
              <Plus size={14} />
              Item
            </button>
            <button
              className="block-btn flex items-center gap-1.5 text-xs py-1 px-2"
              style={{ borderRadius: '6px' }}
              onClick={() => setLines((prev) => [...prev, newLineDraft('section')])}
              title="Add section header"
            >
              <Plus size={14} />
              Section
            </button>
            <button
              className="block-btn flex items-center gap-1.5 text-xs py-1 px-2"
              style={{ borderRadius: '6px' }}
              onClick={() => setLines((prev) => [...prev, newLineDraft('note')])}
              title="Add note"
            >
              <Plus size={14} />
              Note
            </button>
            <button
              className="block-btn flex items-center gap-1.5 text-xs py-1 px-2"
              style={{ borderRadius: '6px' }}
              onClick={() => setLines((prev) => [...prev, newLineDraft('subtotal')])}
              title="Add subtotal row"
            >
              <Plus size={14} />
              Subtotal
            </button>
          </div>
        </div>

        <table className="block-table" style={{ tableLayout: 'fixed' }}>
          <thead>
            <tr>
              <th style={{ width: '8%' }}>Code</th>
              <th style={{ width: '24%' }}>Description</th>
              <th style={{ width: '14%' }}>Account</th>
              <th style={{ width: '6%' }}>Qty</th>
              <th style={{ width: '6%' }}>Unit</th>
              <th style={{ width: '9%' }}>Unit Price</th>
              <th style={{ width: '7%' }}>Disc %</th>
              <th style={{ width: '6%' }}>Tax %</th>
              <th style={{ width: '8%' }} className="text-right">Tax Amount</th>
              <th style={{ width: '8%' }} className="text-right">Amount</th>
              <th style={{ width: '4%' }}></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              // Section/note/subtotal rows render differently — no qty/price.
              if (line.row_type === 'section') {
                return (
                  <tr key={line._key} style={{ background: 'var(--color-bg-tertiary)' }}>
                    <td colSpan={10} className="p-2">
                      <input
                        className="block-input text-xs font-bold"
                        placeholder="Section heading (e.g. Phase 1: Discovery)"
                        value={line.description}
                        onChange={(e) => updateLine(line._key, 'description', e.target.value)}
                      />
                    </td>
                    <td className="p-1 text-center">
                      <button className="text-text-muted hover:text-accent-expense p-1" onClick={() => removeLine(line._key)} title="Remove">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              }
              if (line.row_type === 'note') {
                return (
                  <tr key={line._key}>
                    <td colSpan={10} className="p-2">
                      <input
                        className="block-input text-xs italic text-text-muted"
                        placeholder="Note text (won't be totaled)"
                        value={line.description}
                        onChange={(e) => updateLine(line._key, 'description', e.target.value)}
                      />
                    </td>
                    <td className="p-1 text-center">
                      <button className="text-text-muted hover:text-accent-expense p-1" onClick={() => removeLine(line._key)} title="Remove">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              }
              if (line.row_type === 'subtotal') {
                // Compute running subtotal of items above this row
                const idx = lines.findIndex(l => l._key === line._key);
                const itemsAbove = lines.slice(0, idx).filter(l => l.row_type === 'item');
                const subtotalAbove = itemsAbove.reduce((s, l) => s + roundCents(lineDiscountedBase(l)), 0);
                return (
                  <tr key={line._key} style={{ background: 'var(--color-bg-secondary)' }}>
                    <td colSpan={9} className="p-2 text-right text-xs font-semibold">
                      <input
                        className="block-input text-xs text-right font-semibold"
                        placeholder="Subtotal label"
                        value={line.description}
                        onChange={(e) => updateLine(line._key, 'description', e.target.value)}
                      />
                    </td>
                    <td className="p-2 text-right font-mono text-xs font-bold">
                      {formatCurrency(subtotalAbove)}
                    </td>
                    <td className="p-1 text-center">
                      <button className="text-text-muted hover:text-accent-expense p-1" onClick={() => removeLine(line._key)} title="Remove">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              }
              // Standard item row
              const base = roundCents(lineDiscountedBase(line));
              const rate = lineEffectiveRate(line);
              const lineTax = roundCents(base * (rate / 100));
              const total = roundCents(base + lineTax);
              const styleAttrs: React.CSSProperties = {
                background: line.highlight_color || undefined,
              };
              return (
                <tr key={line._key} style={styleAttrs}>
                  <td className="p-1">
                    <input
                      className="block-input text-xs font-mono"
                      placeholder="SKU"
                      value={line.item_code}
                      onChange={(e) => updateLine(line._key, 'item_code', e.target.value)}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      className="block-input text-xs"
                      placeholder="Item description"
                      value={line.description}
                      onChange={(e) => updateLine(line._key, 'description', e.target.value)}
                      style={{
                        fontWeight: line.bold ? 700 : undefined,
                        fontStyle: line.italic ? 'italic' : undefined,
                      }}
                    />
                  </td>
                  <td className="p-1">
                    <select
                      className="block-select text-xs"
                      value={line.account_id}
                      onChange={(e) => updateLine(line._key, 'account_id', e.target.value)}
                    >
                      <option value="">Account</option>
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
                      step="0.01"
                      className="block-input text-right font-mono text-xs"
                      value={line.quantity}
                      onChange={(e) => updateLine(line._key, 'quantity', parseFloat(e.target.value) || 0)}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      className="block-input text-xs"
                      placeholder="hrs / ea"
                      value={line.unit_label}
                      onChange={(e) => updateLine(line._key, 'unit_label', e.target.value)}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      type="number"
                      step="0.01"
                      className="block-input text-right font-mono text-xs"
                      value={line.unit_price}
                      onChange={(e) => updateLine(line._key, 'unit_price', parseFloat(e.target.value) || 0)}
                    />
                  </td>
                  <td className="p-1">
                    <input
                      type="number"
                      step="0.1"
                      className="block-input text-right font-mono text-xs"
                      value={line.discount_pct}
                      onChange={(e) => updateLine(line._key, 'discount_pct', parseFloat(e.target.value) || 0)}
                      title="Per-line discount %"
                    />
                  </td>
                  <td className="p-1">
                    <input
                      type="number"
                      step="0.01"
                      className="block-input text-right font-mono text-xs"
                      value={(() => { const _o = Number((line as any).tax_rate_override ?? -1); return _o >= 0 ? _o : ''; })()}
                      placeholder={String(form.tax_pct || 0)}
                      onChange={(e) => {
                        const v = e.target.value === '' ? -1 : (parseFloat(e.target.value) || 0);
                        updateLine(line._key, 'tax_rate_override', v);
                      }}
                      title="Override bill default tax rate (blank = use default)"
                    />
                  </td>
                  <td className="p-1 text-right font-mono text-text-muted text-xs">
                    {formatCurrency(lineTax)}
                  </td>
                  <td className="p-1 text-right font-mono text-text-primary text-xs font-semibold">
                    {formatCurrency(total)}
                  </td>
                  <td className="p-1 text-center">
                    <div className="flex items-center justify-center gap-0.5">
                      <button
                        className={`p-0.5 ${line.bold ? 'text-accent-blue' : 'text-text-muted'} hover:text-text-primary`}
                        onClick={() => updateLine(line._key, 'bold', line.bold ? 0 : 1)}
                        title="Bold"
                        style={{ fontSize: '10px', fontWeight: 700 }}
                      >
                        B
                      </button>
                      <button
                        className={`p-0.5 ${line.italic ? 'text-accent-blue' : 'text-text-muted'} hover:text-text-primary`}
                        onClick={() => updateLine(line._key, 'italic', line.italic ? 0 : 1)}
                        title="Italic"
                        style={{ fontSize: '10px', fontStyle: 'italic' }}
                      >
                        I
                      </button>
                      <button
                        className="text-text-muted hover:text-accent-expense p-1"
                        onClick={() => removeLine(line._key)}
                        title="Remove line"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Terms & Conditions ──────────────────────── */}
      <div className="block-card">
        <FieldLabel>Terms &amp; Conditions (printed on bill)</FieldLabel>
        <textarea
          className="block-input"
          rows={3}
          placeholder="Optional terms shown on the printed bill PDF..."
          value={form.terms_text}
          onChange={(e) => updateField('terms_text', e.target.value)}
          style={{ resize: 'vertical' }}
        />
      </div>

      {/* Totals */}
      <div className="flex justify-end">
        <div className="block-card w-96 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Subtotal</span>
            <span className="font-mono text-text-primary">{formatCurrency(subtotal)}</span>
          </div>

          {form.discount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">Pre-Tax Amount</span>
              <span className="font-mono text-text-primary">{formatCurrency(subtotal - form.discount)}</span>
            </div>
          )}

          <div className="flex justify-between text-sm items-center gap-4">
            <span className="text-text-secondary flex-shrink-0">Default Tax %</span>
            <input
              type="number"
              step="0.01"
              className="block-input text-right font-mono w-24"
              style={{ borderRadius: '6px' }}
              value={form.tax_pct}
              onChange={(e) => updateField('tax_pct', parseFloat(e.target.value) || 0)}
              title="Applied to lines that don't have an override"
            />
          </div>

          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Tax Amount (computed)</span>
            <span className="font-mono text-text-primary">{formatCurrency(taxAmount)}</span>
          </div>

          <div className="flex justify-between text-sm items-center gap-4">
            <span className="text-text-secondary flex-shrink-0">Discount (flat $)</span>
            <input
              type="number"
              step="0.01"
              className="block-input text-right font-mono w-24"
              style={{ borderRadius: '6px' }}
              value={form.discount}
              onChange={(e) => updateField('discount', parseFloat(e.target.value) || 0)}
            />
          </div>

          <div className="flex justify-between text-sm items-center gap-4">
            <span className="text-text-secondary flex-shrink-0">Shipping</span>
            <input
              type="number"
              step="0.01"
              className="block-input text-right font-mono w-24"
              style={{ borderRadius: '6px' }}
              value={form.shipping_amount}
              onChange={(e) => updateField('shipping_amount', parseFloat(e.target.value) || 0)}
            />
          </div>

          <div
            className="flex justify-between text-sm font-bold pt-3"
            style={{ borderTop: '1px solid var(--color-border-primary)' }}
          >
            <span className="text-text-primary">
              {form.bill_type === 'credit_memo' ? 'Credit Amount' : 'Total'}
              {form.currency !== 'USD' && (
                <span className="ml-2 text-[10px] font-normal text-text-muted">{form.currency}</span>
              )}
            </span>
            <span
              className="font-mono text-lg"
              style={{ color: form.bill_type === 'credit_memo' && total > 0 ? '#22c55e' : 'var(--color-text-primary)' }}
            >
              {form.bill_type === 'credit_memo' && total > 0
                ? `(${formatCurrency(Math.abs(total))}) CR`
                : formatCurrency(total)}
            </span>
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
// BillsDashboard — Tabbed Dashboard view
// ═══════════════════════════════════════════════════════════
const BillsDashboard: React.FC<{ onView: (id: string) => void }> = ({
  onView,
}) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [bills, setBills] = useState<Bill[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [payments, setPayments] = useState<BillPayment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeCompany) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [billData, vendorData] = await Promise.all([
          api.query(
            'bills',
            { company_id: activeCompany.id },
            { field: 'bill_date', dir: 'desc' },
            5000
          ),
          api.query('vendors', { company_id: activeCompany.id }),
        ]);
        if (cancelled) return;
        const billList = Array.isArray(billData) ? billData : [];
        setBills(billList);
        setVendors(Array.isArray(vendorData) ? vendorData : []);

        // Load all payments via rawQuery
        try {
          const pays: any[] = await api.rawQuery(
            `SELECT bp.* FROM bill_payments bp
             JOIN bills b ON b.id = bp.bill_id
             WHERE b.company_id = ?
             ORDER BY bp.payment_date DESC LIMIT 5000`,
            [activeCompany.id]
          );
          if (!cancelled) setPayments(Array.isArray(pays) ? pays : []);
        } catch {
          /* ignore */
        }
      } catch (err) {
        console.error('Bills dashboard load failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [activeCompany]);

  const vendorMap = useMemo(() => {
    const m = new Map<string, string>();
    vendors.forEach((v) => m.set(v.id, v.name));
    return m;
  }, [vendors]);

  const stats = useMemo(() => {
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const sevenDays = new Date();
    sevenDays.setDate(sevenDays.getDate() + 7);

    let totalOutstanding = 0;
    let overdueAmount = 0;
    let thisMonthCount = 0;
    let comingDue = 0;

    for (const b of bills) {
      const balance = b.total - b.amount_paid;
      if (balance > 0.001) {
        totalOutstanding += balance;
        if (b.due_date && new Date(b.due_date) < today) {
          overdueAmount += balance;
        }
        if (b.due_date) {
          const due = new Date(b.due_date);
          if (due >= today && due <= sevenDays) {
            comingDue += 1;
          }
        }
      }
      if (b.issue_date && new Date(b.issue_date) >= monthStart) {
        thisMonthCount += 1;
      }
    }

    // Average days to pay: for paid bills with payments, avg(payment_date - issue_date)
    let dtpSum = 0;
    let dtpCount = 0;
    for (const p of payments) {
      const bill = bills.find((b) => b.id === p.bill_id);
      if (!bill) continue;
      const issue = new Date(bill.issue_date);
      const pay = new Date(p.payment_date);
      const days = Math.floor((pay.getTime() - issue.getTime()) / 86400000);
      if (days >= 0 && days < 365) {
        dtpSum += days;
        dtpCount += 1;
      }
    }
    const avgDaysToPay = dtpCount > 0 ? Math.round(dtpSum / dtpCount) : 0;

    // Top 5 vendors by spend
    const vendorSpend = new Map<string, number>();
    for (const b of bills) {
      const cur = vendorSpend.get(b.vendor_id) ?? 0;
      vendorSpend.set(b.vendor_id, cur + (b.total || 0));
    }
    const topVendors = [...vendorSpend.entries()]
      .map(([id, total]) => ({ id, total, name: vendorMap.get(id) ?? '—' }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    return {
      totalOutstanding,
      overdueAmount,
      thisMonthCount,
      comingDue,
      avgDaysToPay,
      topVendors,
    };
  }, [bills, payments, vendorMap]);

  // Aging buckets
  const aging = useMemo(() => {
    const today = new Date();
    const buckets = {
      d30: { count: 0, amount: 0 },
      d60: { count: 0, amount: 0 },
      d90: { count: 0, amount: 0 },
      d90plus: { count: 0, amount: 0 },
    };
    for (const b of bills) {
      const balance = b.total - b.amount_paid;
      if (balance <= 0.001 || !b.due_date) continue;
      const days = Math.floor(
        (today.getTime() - new Date(b.due_date).getTime()) / 86400000
      );
      if (days < 0) continue;
      if (days <= 30) {
        buckets.d30.count += 1;
        buckets.d30.amount += balance;
      } else if (days <= 60) {
        buckets.d60.count += 1;
        buckets.d60.amount += balance;
      } else if (days <= 90) {
        buckets.d90.count += 1;
        buckets.d90.amount += balance;
      } else {
        buckets.d90plus.count += 1;
        buckets.d90plus.amount += balance;
      }
    }
    return buckets;
  }, [bills]);

  // Cash flow impact: due in 30/60/90 days
  const cashFlow = useMemo(() => {
    const today = new Date();
    const inDays = (n: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() + n);
      return d;
    };
    const next30 = inDays(30);
    const next60 = inDays(60);
    const next90 = inDays(90);
    let s30 = 0;
    let s60 = 0;
    let s90 = 0;
    for (const b of bills) {
      const balance = b.total - b.amount_paid;
      if (balance <= 0.001 || !b.due_date) continue;
      const due = new Date(b.due_date);
      if (due > today && due <= next30) s30 += balance;
      if (due > today && due <= next60) s60 += balance;
      if (due > today && due <= next90) s90 += balance;
    }
    return { s30, s60, s90 };
  }, [bills]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm font-mono">
        Loading dashboard...
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      {/* 6 KPI cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="stat-card" style={{ borderRadius: '6px' }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="stat-label text-text-muted">Total Outstanding</div>
              <div className="stat-value font-mono text-accent-expense">
                {formatCurrency(stats.totalOutstanding)}
              </div>
            </div>
            <DollarSign
              size={20}
              className="text-accent-expense opacity-60 mt-1"
            />
          </div>
        </div>
        <div className="stat-card" style={{ borderRadius: '6px' }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="stat-label text-text-muted">Overdue Amount</div>
              <div className="stat-value font-mono text-accent-expense">
                {formatCurrency(stats.overdueAmount)}
              </div>
            </div>
            <AlertTriangle
              size={20}
              className="text-accent-expense opacity-60 mt-1"
            />
          </div>
        </div>
        <div className="stat-card" style={{ borderRadius: '6px' }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="stat-label text-text-muted">This Month Bills</div>
              <div className="stat-value font-mono text-accent-blue">
                {stats.thisMonthCount}
              </div>
            </div>
            <FileText
              size={20}
              className="text-accent-blue opacity-60 mt-1"
            />
          </div>
        </div>
        <div className="stat-card" style={{ borderRadius: '6px' }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="stat-label text-text-muted">Avg Days to Pay</div>
              <div className="stat-value font-mono text-text-primary">
                {stats.avgDaysToPay}
              </div>
            </div>
            <Activity
              size={20}
              className="text-accent-blue opacity-60 mt-1"
            />
          </div>
        </div>
        <div className="stat-card" style={{ borderRadius: '6px' }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="stat-label text-text-muted">Due in 7 Days</div>
              <div className="stat-value font-mono text-accent-blue">
                {stats.comingDue}
              </div>
            </div>
            <Clock size={20} className="text-accent-blue opacity-60 mt-1" />
          </div>
        </div>
        <div className="stat-card" style={{ borderRadius: '6px' }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="stat-label text-text-muted">Top Vendors</div>
              <div className="stat-value font-mono text-text-primary text-base">
                {stats.topVendors.length}
              </div>
            </div>
            <Users size={20} className="text-accent-blue opacity-60 mt-1" />
          </div>
        </div>
      </div>

      {/* Two-column: aging + cash flow */}
      <div className="grid grid-cols-2 gap-4">
        {/* AP Aging Snapshot */}
        <div className="block-card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-border-primary">
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
              AP Aging Snapshot
            </span>
          </div>
          <table className="block-table">
            <thead>
              <tr>
                <th>Bucket</th>
                <th className="text-right">Count</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="text-sm text-text-primary">0-30 days</td>
                <td className="text-right font-mono text-xs">
                  {aging.d30.count}
                </td>
                <td className="text-right font-mono text-xs text-accent-expense">
                  {formatCurrency(aging.d30.amount)}
                </td>
              </tr>
              <tr>
                <td className="text-sm text-text-primary">31-60 days</td>
                <td className="text-right font-mono text-xs">
                  {aging.d60.count}
                </td>
                <td className="text-right font-mono text-xs text-accent-expense">
                  {formatCurrency(aging.d60.amount)}
                </td>
              </tr>
              <tr>
                <td className="text-sm text-text-primary">61-90 days</td>
                <td className="text-right font-mono text-xs">
                  {aging.d90.count}
                </td>
                <td className="text-right font-mono text-xs text-accent-expense">
                  {formatCurrency(aging.d90.amount)}
                </td>
              </tr>
              <tr>
                <td className="text-sm text-text-primary font-semibold">
                  90+ days
                </td>
                <td className="text-right font-mono text-xs">
                  {aging.d90plus.count}
                </td>
                <td className="text-right font-mono text-xs text-accent-expense font-semibold">
                  {formatCurrency(aging.d90plus.amount)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Cash flow impact */}
        <div className="block-card p-4 space-y-3" style={{ borderRadius: '6px' }}>
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-2">
            Cash Flow Impact (Upcoming Bills)
          </div>
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-text-secondary">Next 30 days</span>
              <span className="font-mono text-accent-expense">
                {formatCurrency(cashFlow.s30)}
              </span>
            </div>
            <div
              style={{
                height: 8,
                background: 'var(--color-bg-tertiary)',
                borderRadius: '6px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${
                    cashFlow.s90 > 0
                      ? (cashFlow.s30 / cashFlow.s90) * 100
                      : 0
                  }%`,
                  height: '100%',
                  background: '#ef4444',
                }}
              />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-text-secondary">Next 60 days</span>
              <span className="font-mono text-accent-expense">
                {formatCurrency(cashFlow.s60)}
              </span>
            </div>
            <div
              style={{
                height: 8,
                background: 'var(--color-bg-tertiary)',
                borderRadius: '6px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${
                    cashFlow.s90 > 0
                      ? (cashFlow.s60 / cashFlow.s90) * 100
                      : 0
                  }%`,
                  height: '100%',
                  background: '#f97316',
                }}
              />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-text-secondary">Next 90 days</span>
              <span className="font-mono text-accent-expense">
                {formatCurrency(cashFlow.s90)}
              </span>
            </div>
            <div
              style={{
                height: 8,
                background: 'var(--color-bg-tertiary)',
                borderRadius: '6px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `100%`,
                  height: '100%',
                  background: '#eab308',
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Top 5 vendors by spend */}
      <div className="block-card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-border-primary">
          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
            Top 5 Vendors by Spend
          </span>
        </div>
        {stats.topVendors.length === 0 ? (
          <div className="p-4 text-center text-xs text-text-muted">
            No vendor spend data yet.
          </div>
        ) : (
          <table className="block-table">
            <thead>
              <tr>
                <th>Vendor</th>
                <th className="text-right">Total Billed</th>
                <th className="text-right">Share</th>
              </tr>
            </thead>
            <tbody>
              {stats.topVendors.map((v) => {
                const totalAll = stats.topVendors.reduce(
                  (s, x) => s + x.total,
                  0
                );
                const share = totalAll > 0 ? (v.total / totalAll) * 100 : 0;
                return (
                  <tr key={v.id}>
                    <td className="text-sm text-text-primary">{v.name}</td>
                    <td className="text-right font-mono text-text-secondary text-xs">
                      {formatCurrency(v.total)}
                    </td>
                    <td className="text-right">
                      <div
                        className="inline-block"
                        style={{
                          width: 100,
                          height: 8,
                          background: 'var(--color-bg-tertiary)',
                          borderRadius: '6px',
                          overflow: 'hidden',
                          verticalAlign: 'middle',
                          marginRight: 6,
                        }}
                      >
                        <div
                          style={{
                            width: `${share}%`,
                            height: '100%',
                            background: 'var(--color-accent-blue)',
                          }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-text-muted">
                        {share.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
// BillsModule — Router
// ═══════════════════════════════════════════════════════════
type BillsTabId = 'dashboard' | 'list';

const BillsModule: React.FC = () => {
  const [view, setView] = useState<View>('list');
  const [activeBillTab, setActiveBillTab] = useState<BillsTabId>('dashboard');
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

  // Tabbed list view
  return (
    <div className="overflow-y-auto h-full">
      {/* Tab bar */}
      <div className="px-6 pt-4">
        <div className="flex border-b border-border-primary">
          <button
            onClick={() => setActiveBillTab('dashboard')}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold transition-colors border-b-2 -mb-[1px] ${
              activeBillTab === 'dashboard'
                ? 'text-accent-blue border-accent-blue'
                : 'text-text-muted hover:text-text-primary border-transparent'
            }`}
          >
            <LayoutDashboard size={14} />
            Dashboard
          </button>
          <button
            onClick={() => setActiveBillTab('list')}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold transition-colors border-b-2 -mb-[1px] ${
              activeBillTab === 'list'
                ? 'text-accent-blue border-accent-blue'
                : 'text-text-muted hover:text-text-primary border-transparent'
            }`}
          >
            <List size={14} />
            All Bills
          </button>
        </div>
      </div>
      {activeBillTab === 'dashboard' && <BillsDashboard onView={goToDetail} />}
      {activeBillTab === 'list' && (
        <BillsList key={listKey} onNew={goToNew} onView={goToDetail} />
      )}
    </div>
  );
};

export default BillsModule;
