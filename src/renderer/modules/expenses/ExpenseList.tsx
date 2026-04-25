import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Receipt, Plus, Search, Filter, DollarSign, CheckCircle, Trash2, Download, Copy, FileText, Settings, Star, ChevronDown, ChevronRight, Edit, Banknote, CreditCard, Save } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';
import ErrorBanner from '../../components/ErrorBanner';
import api from '../../lib/api';
import { downloadCSVBlob } from '../../lib/csv-export';
import { useCompanyStore } from '../../stores/companyStore';
import { useAuthStore } from '../../stores/authStore';
import { SummaryBar } from '../../components/SummaryBar';
import { formatCurrency, formatDate, formatStatus } from '../../lib/format';
import { ImportWizard } from '../../components/ImportWizard';
import { useNavigation } from '../../lib/navigation';
import EntityChip from '../../components/EntityChip';
import BulkEditModal from './BulkEditModal';
import CreditCardImportModal from './CreditCardImportModal';
import { BulkPasteModal, QuickAddBar, ReceiptThumb } from './CaptureFeatures';

// ─── Types ──────────────────────────────────────────────
interface Expense {
  id: string;
  date: string;
  description: string;
  category_name?: string;
  category_id?: string;
  category_color?: string;
  vendor_name?: string;
  vendor_id?: string;
  vendor_is_1099?: number;
  vendor_w9_status?: string;
  amount: number;
  tax_amount?: number;
  status: 'pending' | 'approved' | 'paid' | 'rejected';
  is_billable: boolean;
  is_reimbursable?: number;
  reimbursed?: number;
  is_recurring?: number;
  payment_method?: string;
  reference?: string;
  custom_fields?: string;
  is_tax_deductible?: number;
  project_id?: string;
  project_name?: string;
  receipt_path?: string | null;
  receipts_json?: string | null;
}

interface Category {
  id: string;
  name: string;
  color?: string;
  is_active?: number;
}

interface Vendor { id: string; name: string; }
interface Project { id: string; name: string; budget?: number; }

interface SavedView {
  name: string;
  search: string;
  categoryFilter: string;
  dateFrom: string;
  dateTo: string;
  groupBy: GroupKey;
  visibleCols: ColKey[];
}

type GroupKey = 'none' | 'vendor' | 'category' | 'project' | 'month';
type ColKey = 'date' | 'description' | 'category' | 'vendor' | 'project' | 'amount' | 'status' | 'billable' | 'actions';
const ALL_COLS: { key: ColKey; label: string }[] = [
  { key: 'date', label: 'Date' },
  { key: 'description', label: 'Description' },
  { key: 'category', label: 'Category' },
  { key: 'vendor', label: 'Vendor' },
  { key: 'project', label: 'Project' },
  { key: 'amount', label: 'Amount' },
  { key: 'status', label: 'Status' },
  { key: 'billable', label: 'Billable' },
  { key: 'actions', label: 'Actions' },
];

const PINNED_VENDORS_KEY = (uid: string, cid: string) => `expense_pinned_vendors_${uid}_${cid}`;
const VIEWS_KEY = (uid: string) => `expense_views_${uid}`;
const COLS_KEY = (uid: string) => `expense_cols_${uid}`;

interface ExpenseListProps {
  onNew: () => void;
  onEdit: (id: string) => void;
  onView?: (id: string) => void;
}

// ─── Component ──────────────────────────────────────────
const ExpenseList: React.FC<ExpenseListProps> = ({ onNew, onEdit, onView }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const authUser = useAuthStore((s) => s.user);
  const userId = authUser?.id || 'anon';
  const nav = useNavigation();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [bankTxns, setBankTxns] = useState<Array<{ id: string; date: string; amount: number }>>([]);
  const [stripeRefunds, setStripeRefunds] = useState<Array<{ id: string; stripe_id: string; data: any }>>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [reimbursableOnly, setReimbursableOnly] = useState(false);
  // Capture features (#16, #12)
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [showBulkPaste, setShowBulkPaste] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [expenseSummary, setExpenseSummary] = useState<any>(null);
  const [showImport, setShowImport] = useState(false);
  const [showCcImport, setShowCcImport] = useState(false);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [bulkStatusConfirm, setBulkStatusConfirm] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [groupBy, setGroupBy] = useState<GroupKey>('none');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [showColMenu, setShowColMenu] = useState(false);
  const [visibleCols, setVisibleCols] = useState<ColKey[]>(() => {
    try {
      const raw = localStorage.getItem(COLS_KEY('anon'));
      if (raw) return JSON.parse(raw);
    } catch {}
    return ALL_COLS.map((c) => c.key);
  });
  const [pinnedVendors, setPinnedVendors] = useState<Set<string>>(new Set());
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [showViewsMenu, setShowViewsMenu] = useState(false);
  const [editCell, setEditCell] = useState<{ id: string; field: 'amount' | 'description' } | null>(null);
  const [editValue, setEditValue] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try { localStorage.setItem(COLS_KEY(userId), JSON.stringify(visibleCols)); } catch {}
  }, [visibleCols, userId]);

  useEffect(() => {
    if (!activeCompany) return;
    (async () => {
      try {
        const raw = await api.getSetting(VIEWS_KEY(userId));
        if (raw) { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) setSavedViews(parsed); }
      } catch {}
      try {
        const pinRaw = await api.getSetting(PINNED_VENDORS_KEY(userId, activeCompany.id));
        if (pinRaw) { const arr = JSON.parse(pinRaw); if (Array.isArray(arr)) setPinnedVendors(new Set(arr)); }
      } catch {}
      try {
        const cid = activeCompany.id;
        const [v, p, b, sr] = await Promise.all([
          api.query('vendors', { company_id: cid }),
          api.rawQuery(`SELECT id, name, COALESCE(budget,0) as budget FROM projects WHERE company_id = ?`, [cid]),
          api.rawQuery(
            `SELECT bt.id, bt.date, bt.amount FROM bank_transactions bt
             JOIN bank_accounts ba ON ba.id = bt.bank_account_id
             WHERE ba.company_id = ? AND bt.is_matched = 0 AND bt.type = 'debit'`,
            [cid]
          ).catch(() => []),
          api.rawQuery(`SELECT id, stripe_id, data FROM stripe_cache WHERE company_id = ? AND resource = 'refunds'`, [cid]).catch(() => []),
        ]);
        setVendors(Array.isArray(v) ? v : []);
        setProjects(Array.isArray(p) ? p : []);
        setBankTxns(Array.isArray(b) ? b : []);
        const refunds = (Array.isArray(sr) ? sr : [])
          .map((r: any) => { try { return { ...r, data: JSON.parse(r.data) }; } catch { return null; } })
          .filter(Boolean) as any[];
        setStripeRefunds(refunds);
      } catch {}
    })();
  }, [activeCompany, userId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      try {
        setLoadError('');
        const [expData, catData, expSummaryResult] = await Promise.all([
          api.rawQuery(
            `SELECT e.*, c.name as category_name, c.color as category_color,
                    v.name as vendor_name, v.is_1099_eligible as vendor_is_1099, v.w9_status as vendor_w9_status,
                    p.name as project_name
             FROM expenses e
             LEFT JOIN categories c ON e.category_id = c.id
             LEFT JOIN vendors v ON e.vendor_id = v.id
             LEFT JOIN projects p ON e.project_id = p.id
             WHERE e.company_id = ?
             ORDER BY e.date DESC`,
            [activeCompany.id]
          ),
          api.query('categories', { company_id: activeCompany.id }),
          api.rawQuery(
            `SELECT
              COALESCE(SUM(CASE WHEN strftime('%Y-%m', date) = strftime('%Y-%m', 'now') THEN amount ELSE 0 END), 0) as month_total,
              (SELECT c.name FROM categories c JOIN expenses e2 ON e2.category_id = c.id WHERE e2.company_id = ? GROUP BY e2.category_id ORDER BY SUM(e2.amount) DESC LIMIT 1) as top_category,
              (SELECT COUNT(*) FROM (SELECT e2.category_id FROM expenses e2 JOIN budget_lines bl ON bl.category = (SELECT c2.name FROM categories c2 WHERE c2.id = e2.category_id) WHERE e2.company_id = ? AND strftime('%Y-%m', e2.date) = strftime('%Y-%m', 'now') GROUP BY e2.category_id HAVING SUM(e2.amount) > bl.amount)) as over_budget_count
            FROM expenses WHERE company_id = ?`,
            [activeCompany.id, activeCompany.id, activeCompany.id]
          ),
        ]);
        if (cancelled) return;
        setExpenses(Array.isArray(expData) ? expData : []);
        setCategories(Array.isArray(catData) ? catData : []);
        const expRow = Array.isArray(expSummaryResult) ? expSummaryResult[0] : expSummaryResult;
        setExpenseSummary(expRow ?? null);
      } catch (err: any) {
        console.error('Failed to load expenses:', err);
        if (!cancelled) setLoadError(err?.message || 'Failed to load expenses');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeCompany]);

  const filtered = useMemo(() => {
    return expenses.filter((e) => {
      if (search) {
        const q = search.toLowerCase();
        const match =
          e.description?.toLowerCase().includes(q) ||
          e.vendor_name?.toLowerCase().includes(q) ||
          e.reference?.toLowerCase().includes(q);
        if (!match) return false;
      }
      if (categoryFilter && e.category_id !== categoryFilter) return false;
      if (dateFrom && e.date < dateFrom) return false;
      if (dateTo && e.date > dateTo) return false;
      if (reimbursableOnly && !e.is_reimbursable) return false;
      // Capture #16: amount range
      const minN = parseFloat(amountMin);
      const maxN = parseFloat(amountMax);
      if (!isNaN(minN) && (e.amount ?? 0) < minN) return false;
      if (!isNaN(maxN) && (e.amount ?? 0) > maxN) return false;
      return true;
    });
  }, [expenses, search, categoryFilter, dateFrom, dateTo, reimbursableOnly, amountMin, amountMax]);

  const total = useMemo(
    () => filtered.reduce((sum, e) => sum + (e.amount || 0), 0),
    [filtered]
  );

  // ─── Selection Helpers ──────────────────────────────────
  const allSelected = filtered.length > 0 && filtered.every(e => selectedIds.has(e.id));
  const someSelected = selectedIds.size > 0;

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(e => e.id)));
    }
  }, [allSelected, filtered]);

  // Clear selection when filters change
  useEffect(() => { setSelectedIds(new Set()); }, [search, categoryFilter, dateFrom, dateTo]);

  // ─── Batch Actions ──────────────────────────────────────
  const reload = useCallback(async () => {
    if (!activeCompany) return;
    const expData = await api.query('expenses', { company_id: activeCompany.id });
    setExpenses(Array.isArray(expData) ? expData : []);
    setSelectedIds(new Set());
  }, [activeCompany]);

  const handleBatchApprove = useCallback(async () => {
    setBatchLoading(true);
    try {
      await api.batchUpdate('expenses', Array.from(selectedIds), { status: 'approved' });
      await reload();
    } catch (err: any) { console.error('Batch approve failed:', err); alert('Failed to approve expenses: ' + (err?.message || 'Unknown error')); }
    finally { setBatchLoading(false); }
  }, [selectedIds, reload]);

  const handleBatchRecategorize = useCallback(async (newCategoryId: string) => {
    if (!newCategoryId) return;
    setBatchLoading(true);
    try {
      await api.batchUpdate('expenses', Array.from(selectedIds), { category_id: newCategoryId });
      await reload();
    } catch (err: any) {
      console.error('Batch recategorize failed:', err);
      alert('Failed to recategorize: ' + (err?.message || 'Unknown error'));
    } finally { setBatchLoading(false); }
  }, [selectedIds, reload]);

  const handleBatchDelete = useCallback(async () => {
    setBatchLoading(true);
    try {
      await api.batchDelete('expenses', Array.from(selectedIds));
      await reload();
    } catch (err: any) { console.error('Batch delete failed:', err); alert('Failed to delete expenses: ' + (err?.message || 'Unknown error')); }
    finally { setBatchLoading(false); setShowDeleteConfirm(false); }
  }, [selectedIds, reload]);

  const handleDuplicate = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const result = await api.cloneRecord('expenses', id);
    if (result?.error) {
      console.error('Duplicate expense failed:', result.error);
      return;
    }
    await reload();
  }, [reload]);

  const handleExportSelected = useCallback(() => {
    const selected = filtered.filter(e => selectedIds.has(e.id));
    const exportData = selected.map(e => ({
      date: e.date,
      description: e.description,
      category: e.category_name || '',
      vendor: e.vendor_name || '',
      amount: e.amount,
      tax_amount: e.tax_amount || 0,
      status: e.status,
      billable: e.is_billable ? 'Yes' : 'No',
      payment_method: e.payment_method || '',
      reference: e.reference || '',
    }));
    downloadCSVBlob(exportData, 'expenses-export.csv');
  }, [filtered, selectedIds]);

  // ── Quick stats strip (feature 18) ──
  const quickStats = useMemo(() => {
    const now = new Date();
    const thisYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const lastDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastYm = `${lastDate.getFullYear()}-${String(lastDate.getMonth() + 1).padStart(2, '0')}`;
    let thisMonth = 0, lastMonth = 0, pending = 0, reimbursable = 0;
    expenses.forEach((e) => {
      const ym = (e.date || '').slice(0, 7);
      if (ym === thisYm) thisMonth += e.amount || 0;
      if (ym === lastYm) lastMonth += e.amount || 0;
      if (e.status === 'pending') pending++;
      if (e.is_reimbursable && !e.reimbursed) reimbursable += e.amount || 0;
    });
    return { thisMonth, lastMonth, pending, reimbursable };
  }, [expenses]);

  // ── Bank-recon match (feature 21) ──
  const matchedExpenseIds = useMemo(() => {
    const set = new Set<string>();
    filtered.forEach((e) => {
      const eDate = new Date(e.date + 'T00:00:00').getTime();
      for (const t of bankTxns) {
        if (Math.abs((t.amount ?? 0) - (e.amount ?? 0)) <= 1) {
          const tDate = new Date(t.date + 'T00:00:00').getTime();
          if (Math.abs(tDate - eDate) <= 3 * 86400000) { set.add(e.id); break; }
        }
      }
    });
    return set;
  }, [filtered, bankTxns]);

  // ── Keyboard shortcuts (feature 16) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
      if (e.key === '/' && !inField) { e.preventDefault(); searchRef.current?.focus(); return; }
      if (e.key === 'Escape') {
        if (editCell) { setEditCell(null); return; }
        if (selectedIds.size > 0) { setSelectedIds(new Set()); return; }
      }
      if (inField) return;
      if (e.key === 'n') { e.preventDefault(); onNew(); }
      else if (e.key === 'e' && selectedIds.size === 1) { e.preventDefault(); onEdit(Array.from(selectedIds)[0]); }
      else if (e.key === 'd' && selectedIds.size > 0) { e.preventDefault(); setShowDeleteConfirm(true); }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'a') { e.preventDefault(); toggleSelectAll(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedIds, onNew, onEdit, toggleSelectAll, editCell]);

  // ── Bulk status (feature 25) ──
  const handleBulkStatus = useCallback(async (status: string) => {
    setBatchLoading(true);
    try {
      await api.batchUpdate('expenses', Array.from(selectedIds), { status });
      await reload();
    } catch (err: any) { alert('Failed: ' + (err?.message || '')); }
    finally { setBatchLoading(false); setBulkStatusConfirm(null); }
  }, [selectedIds, reload]);

  // ── Inline edit (feature 12) ──
  const startEdit = (id: string, field: 'amount' | 'description', value: any) => {
    setEditCell({ id, field });
    setEditValue(String(value ?? ''));
  };
  const commitEdit = async () => {
    if (!editCell) return;
    try {
      const val: any = editCell.field === 'amount' ? Number(editValue) : editValue;
      await api.update('expenses', editCell.id, { [editCell.field]: val });
      await reload();
    } catch (err: any) { alert('Save failed: ' + (err?.message || '')); }
    finally { setEditCell(null); }
  };

  // ── Saved views (feature 13) ──
  const persistViews = async (views: SavedView[]) => {
    setSavedViews(views);
    try { await api.setSetting(VIEWS_KEY(userId), JSON.stringify(views)); } catch {}
  };
  const saveCurrentView = async () => {
    const name = window.prompt('Name this view:');
    if (!name) return;
    const view: SavedView = { name, search, categoryFilter, dateFrom, dateTo, groupBy, visibleCols };
    await persistViews([...savedViews.filter((v) => v.name !== name), view]);
    setShowViewsMenu(false);
  };
  const loadView = (v: SavedView) => {
    setSearch(v.search || '');
    setCategoryFilter(v.categoryFilter || '');
    setDateFrom(v.dateFrom || '');
    setDateTo(v.dateTo || '');
    setGroupBy(v.groupBy || 'none');
    if (Array.isArray(v.visibleCols)) setVisibleCols(v.visibleCols);
    setShowViewsMenu(false);
  };
  const deleteView = async (name: string) => { await persistViews(savedViews.filter((v) => v.name !== name)); };

  // ── Pinned vendors (feature 17) ──
  const togglePin = async (vendorId: string) => {
    if (!activeCompany) return;
    const next = new Set(pinnedVendors);
    if (next.has(vendorId)) next.delete(vendorId); else next.add(vendorId);
    setPinnedVendors(next);
    try { await api.setSetting(PINNED_VENDORS_KEY(userId, activeCompany.id), JSON.stringify(Array.from(next))); } catch {}
  };

  // ── Grouping (feature 19) ──
  const groups = useMemo(() => {
    if (groupBy === 'none') return null;
    const map = new Map<string, Expense[]>();
    filtered.forEach((e) => {
      let key: string;
      switch (groupBy) {
        case 'vendor': key = e.vendor_name || '(no vendor)'; break;
        case 'category': key = e.category_name || '(uncategorized)'; break;
        case 'project': key = e.project_name || '(no project)'; break;
        case 'month': key = (e.date || '').slice(0, 7) || '(no date)'; break;
        default: key = '';
      }
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    });
    return Array.from(map.entries()).sort((a, b) => a[0] < b[0] ? 1 : -1);
  }, [filtered, groupBy]);

  // ── Stripe refund capture (feature 23) ──
  const captureRefund = async (refund: any) => {
    if (!activeCompany) return;
    const amount = (refund.data?.amount || 0) / 100;
    const desc = `Stripe refund ${refund.stripe_id}`;
    const date = refund.data?.created
      ? new Date(refund.data.created * 1000).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    try {
      await api.create('expenses', {
        company_id: activeCompany.id, date, amount, description: desc,
        reference: refund.stripe_id, status: 'approved', payment_method: 'stripe',
      });
      await reload();
    } catch (e: any) { alert('Failed: ' + (e?.message || '')); }
  };
  const unmatchedRefunds = useMemo(() =>
    stripeRefunds.filter((r: any) => !expenses.some((e) => e.reference === r.stripe_id)),
    [stripeRefunds, expenses]);

  // ── Project balance map (feature 24) ──
  const projectBalance = useMemo(() => {
    const map = new Map<string, number>();
    expenses.forEach((e) => {
      if (!e.project_id) return;
      map.set(e.project_id, (map.get(e.project_id) || 0) + (Number(e.amount) || 0));
    });
    return map;
  }, [expenses]);

  const colVisible = (k: ColKey) => visibleCols.includes(k);

  const renderExpenseRow = (exp: Expense) => {
    const isSelected = selectedIds.has(exp.id);
    const matchHint = matchedExpenseIds.has(exp.id);
    const isEditingAmount = editCell?.id === exp.id && editCell.field === 'amount';
    const isEditingDesc = editCell?.id === exp.id && editCell.field === 'description';
    const projBal = exp.project_id ? projectBalance.get(exp.project_id) || 0 : 0;
    const proj = exp.project_id ? projects.find((p) => p.id === exp.project_id) : null;
    const projOver = !!(proj && (proj.budget || 0) > 0 && projBal > (proj.budget || 0));

    return (
      <tr key={exp.id} className={`cursor-pointer ${isSelected ? 'bg-accent-blue/5' : ''}`} onClick={() => (onView ? onView(exp.id) : onEdit(exp.id))}>
        <td onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(exp.id)} style={{ accentColor: '#3b82f6' }} />
        </td>
        {colVisible('date') && <td className="font-mono text-text-secondary text-xs">{formatDate(exp.date)}</td>}
        {colVisible('description') && (
          <td className="text-text-primary font-medium">
            {isEditingDesc ? (
              <input
                autoFocus value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditCell(null); }}
                onBlur={commitEdit}
                className="block-input"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <div className="flex items-center gap-1.5" onDoubleClick={(e) => { e.stopPropagation(); startEdit(exp.id, 'description', exp.description); }}>
                <span className="block truncate max-w-[200px]">{exp.description || '(no description)'}</span>
                {exp.is_recurring ? <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: '#2563eb22', color: '#60a5fa' }}>RECURRING</span> : null}
                {exp.is_reimbursable && !exp.reimbursed && <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: '#d9770622', color: '#f59e0b' }}>REIMBURSE</span>}
                {exp.reimbursed ? <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: '#16a34a22', color: '#16a34a' }}>REIMBURSED</span> : null}
                {matchHint && <span title="A bank transaction matches this expense" style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 6, background: '#06b6d422', color: '#06b6d4' }}><Banknote size={10} style={{ display: 'inline', marginRight: 2 }} />MATCH?</span>}
                {exp.custom_fields && exp.custom_fields !== '{}' && <span title="Has detailed info"><FileText size={12} className="text-accent-blue shrink-0" /></span>}
                {/* Capture #2: receipt thumbnail with hover preview */}
                {exp.receipt_path ? (
                  <span className="relative group inline-flex" title={exp.receipt_path.split(/[/\\]/).pop()}>
                    <span className="inline-flex"><ReceiptThumb path={exp.receipt_path} sizePx={20} /></span>
                    <span className="hidden group-hover:block absolute z-50 left-6 top-0 border border-border-primary bg-bg-secondary p-1" style={{ borderRadius: 6 }}>
                      <ReceiptThumb path={exp.receipt_path} sizePx={180} />
                    </span>
                  </span>
                ) : null}
              </div>
            )}
          </td>
        )}
        {colVisible('category') && (
          <td className="text-text-secondary truncate max-w-[160px]">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 shrink-0" style={{ background: exp.category_color || '#6b7280', borderRadius: '50%' }} />
              <span className="truncate">{exp.category_name || '-'}</span>
              {exp.vendor_is_1099 ? <span title="1099-relevant" style={{ fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 4, background: '#2563eb22', color: '#60a5fa' }}>1099</span> : null}
              {exp.is_tax_deductible === 0 ? <span title="Non-deductible" style={{ fontSize: 9, fontWeight: 700, padding: '1px 4px', borderRadius: 4, background: '#6b728022', color: '#94a3b8' }}>NON-DED</span> : null}
            </span>
          </td>
        )}
        {colVisible('vendor') && (
          <td className="text-text-secondary" onClick={(e) => e.stopPropagation()}>
            {exp.vendor_id ? <EntityChip type="vendor" id={exp.vendor_id} label={exp.vendor_name || ''} variant="inline" /> : <span className="block truncate max-w-[150px]">{exp.vendor_name || '-'}</span>}
          </td>
        )}
        {colVisible('project') && (
          <td className="text-text-secondary" onClick={(e) => e.stopPropagation()}>
            {exp.project_id ? (
              <div className="flex items-center gap-1">
                <EntityChip type="project" id={exp.project_id} label={exp.project_name || ''} variant="inline" />
                {proj && (proj.budget || 0) > 0 && (
                  <span title={`${formatCurrency(projBal)} of ${formatCurrency(proj.budget || 0)} budget`} style={{ fontSize: 9, padding: '1px 4px', borderRadius: 4, background: projOver ? '#ef444422' : '#22c55e22', color: projOver ? '#ef4444' : '#22c55e' }}>
                    {projOver ? 'OVER' : `${Math.round((projBal / (proj.budget || 1)) * 100)}%`}
                  </span>
                )}
              </div>
            ) : '-'}
          </td>
        )}
        {colVisible('amount') && (
          <td className="text-right font-mono text-accent-expense">
            {isEditingAmount ? (
              <input
                autoFocus type="number" step="0.01" value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditCell(null); }}
                onBlur={commitEdit}
                className="block-input text-right"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span onDoubleClick={(e) => { e.stopPropagation(); startEdit(exp.id, 'amount', exp.amount); }}>{formatCurrency(exp.amount)}</span>
            )}
          </td>
        )}
        {colVisible('status') && <td><span className={formatStatus(exp.status).className}>{formatStatus(exp.status).label}</span></td>}
        {colVisible('billable') && <td className="text-center">{exp.is_billable ? <span className="text-accent-income">&#10003;</span> : <span className="text-text-muted">-</span>}</td>}
        {colVisible('actions') && (
          <td onClick={(e) => e.stopPropagation()}>
            <button onClick={(e) => handleDuplicate(exp.id, e)} className="flex items-center gap-1 px-2 py-1 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue hover:text-accent-blue transition-colors" title="Duplicate">
              <Copy size={12} /> Dup
            </button>
          </td>
        )}
      </tr>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading expenses...
      </div>
    );
  }

  return (
    <div className="space-y-4" style={{ paddingBottom: someSelected ? '80px' : undefined }}>
      {loadError && <ErrorBanner message={loadError} title="Failed to load expenses" onDismiss={() => setLoadError('')} />}
      {/* Header */}
      <div className="module-header">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary"
            style={{ borderRadius: '6px' }}
          >
            <Receipt size={18} className="text-accent-blue" />
          </div>
          <div>
            <h2 className="module-title text-text-primary">Expenses</h2>
            <p className="text-xs text-text-muted mt-0.5">
              {filtered.length} expense{filtered.length !== 1 ? 's' : ''} &middot; {formatCurrency(total)} total
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowCcImport(true)} className="flex items-center gap-2 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue">
            <CreditCard size={13} /> CC Import
          </button>
          <button onClick={() => setShowImport(true)} className="flex items-center gap-2 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue">
            Import CSV
          </button>
          <button onClick={() => setShowBulkPaste(true)} className="flex items-center gap-2 px-3 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue">
            Bulk Paste
          </button>
          <button className="block-btn-primary flex items-center gap-2" onClick={onNew}>
            <Plus size={16} />
            New Expense
          </button>
        </div>
      </div>

      {/* Summary Bar */}
      {expenseSummary && (
        <SummaryBar items={[
          { label: 'This Month', value: formatCurrency(expenseSummary.month_total), tooltip: 'Total expenses recorded in the current calendar month' },
          { label: 'Top Category', value: expenseSummary.top_category ?? '—' },
          ...(Number(expenseSummary.over_budget_count) > 0
            ? [{ label: 'Over Budget', value: `${expenseSummary.over_budget_count} categories`, accent: 'red' as const, tooltip: 'Categories where spending this month exceeds the budget line' }]
            : []),
        ]} />
      )}

      {/* Quick stats strip (feature 18) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="block-card p-2.5"><div className="text-xs uppercase font-bold text-text-muted">This Month</div><div className="text-lg font-mono font-bold text-text-primary mt-0.5">{formatCurrency(quickStats.thisMonth)}</div></div>
        <div className="block-card p-2.5"><div className="text-xs uppercase font-bold text-text-muted">Last Month</div><div className="text-lg font-mono font-bold text-text-primary mt-0.5">{formatCurrency(quickStats.lastMonth)}</div></div>
        <div className="block-card p-2.5"><div className="text-xs uppercase font-bold text-text-muted">Pending</div><div className="text-lg font-mono font-bold text-text-primary mt-0.5">{quickStats.pending}</div></div>
        <div className="block-card p-2.5"><div className="text-xs uppercase font-bold text-text-muted">Reimbursable</div><div className="text-lg font-mono font-bold text-text-primary mt-0.5">{formatCurrency(quickStats.reimbursable)}</div></div>
      </div>

      {/* Stripe refund capture banner (feature 23) */}
      {unmatchedRefunds.length > 0 && (
        <div className="block-card p-3 flex items-center gap-3" style={{ borderLeft: '3px solid #635bff' }}>
          <Banknote size={16} className="text-accent-blue" />
          <div className="text-xs flex-1">
            <strong>{unmatchedRefunds.length}</strong> Stripe refund{unmatchedRefunds.length === 1 ? '' : 's'} not yet captured as expenses.
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {unmatchedRefunds.slice(0, 3).map((r: any) => (
              <button key={r.id} onClick={() => captureRefund(r)} className="text-xs font-bold uppercase px-2 py-1 border border-border-primary hover:border-accent-blue">
                Capture {formatCurrency((r.data?.amount || 0) / 100)}
              </button>
            ))}
            {unmatchedRefunds.length > 3 && <span className="text-xs text-text-muted">+{unmatchedRefunds.length - 3} more</span>}
          </div>
        </div>
      )}

      {/* Pinned vendors quick-pick (feature 17) */}
      {vendors.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-text-muted uppercase font-bold">Vendors:</span>
          {[...vendors]
            .sort((a, b) => {
              const ap = pinnedVendors.has(a.id) ? 0 : 1;
              const bp = pinnedVendors.has(b.id) ? 0 : 1;
              if (ap !== bp) return ap - bp;
              return a.name.localeCompare(b.name);
            })
            .slice(0, 8)
            .map((v) => (
              <span key={v.id} className="flex items-center gap-1 px-2 py-1 border border-border-primary" style={{ borderRadius: 4 }}>
                <button onClick={() => togglePin(v.id)} title={pinnedVendors.has(v.id) ? 'Unpin' : 'Pin'}>
                  <Star size={11} className={pinnedVendors.has(v.id) ? 'text-accent-blue' : 'text-text-muted'} fill={pinnedVendors.has(v.id) ? 'currentColor' : 'none'} />
                </button>
                <button onClick={() => setSearch(v.name)} className="text-text-secondary hover:text-text-primary">{v.name}</button>
              </span>
            ))}
        </div>
      )}

      {/* Capture #9: Quick Add bar */}
      {activeCompany && (
        <QuickAddBar companyId={activeCompany.id} onCreated={(id) => { reload(); onEdit(id); }} />
      )}

      {/* Filters (sticky, feature 15) */}
      <div className="block-card p-3" style={{ position: 'sticky', top: 0, zIndex: 10 }}>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search expenses... (press / to focus)"
              className="block-input pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter size={14} className="text-text-muted" />
            <select
              className="block-select"
              style={{ width: 'auto', minWidth: '140px' }}
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">All Categories</option>
              {[...categories]
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
                .map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
            </select>
          </div>
          <input
            type="date"
            className="block-input"
            style={{ width: 'auto' }}
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            placeholder="From"
          />
          <input
            type="date"
            className="block-input"
            style={{ width: 'auto' }}
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            placeholder="To"
          />
          {/* Capture #16: amount range */}
          <input type="number" step="0.01" placeholder="Min $" className="block-input" style={{ width: 100 }}
            value={amountMin} onChange={e => setAmountMin(e.target.value)} />
          <input type="number" step="0.01" placeholder="Max $" className="block-input" style={{ width: 100 }}
            value={amountMax} onChange={e => setAmountMax(e.target.value)} />
          <button
            type="button"
            onClick={() => setReimbursableOnly((v) => !v)}
            className="px-3 py-2 text-xs font-bold uppercase border"
            style={{
              borderColor: reimbursableOnly ? 'var(--color-accent-blue)' : 'var(--color-border-primary)',
              color: reimbursableOnly ? 'var(--color-accent-blue)' : 'var(--color-text-muted)',
              borderRadius: 4,
            }}
            title="Show only reimbursable expenses"
          >
            Reimbursable
          </button>

          {/* Group by (feature 19) */}
          <select className="block-select" style={{ width: 'auto' }} value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupKey)}>
            <option value="none">No grouping</option>
            <option value="vendor">Group by Vendor</option>
            <option value="category">Group by Category</option>
            <option value="project">Group by Project</option>
            <option value="month">Group by Month</option>
          </select>

          {/* Saved views menu (feature 13) */}
          <div className="relative">
            <button onClick={() => setShowViewsMenu((v) => !v)} className="flex items-center gap-1 px-2 py-2 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue">
              <Save size={12} /> Views <ChevronDown size={12} />
            </button>
            {showViewsMenu && (
              <div className="absolute right-0 top-full mt-1 z-50 block-card" style={{ minWidth: 200, padding: 6 }}>
                <button onClick={saveCurrentView} className="w-full text-left text-xs px-2 py-1.5 hover:bg-bg-tertiary rounded">Save current view…</button>
                {savedViews.length > 0 && <div style={{ height: 1, background: 'var(--color-border-primary)', margin: '4px 0' }} />}
                {savedViews.map((v) => (
                  <div key={v.name} className="flex items-center gap-1">
                    <button onClick={() => loadView(v)} className="flex-1 text-left text-xs px-2 py-1.5 hover:bg-bg-tertiary rounded">{v.name}</button>
                    <button onClick={() => deleteView(v.name)} className="text-xs text-text-muted hover:text-accent-expense px-1" title="Delete view">×</button>
                  </div>
                ))}
                {savedViews.length === 0 && <div className="text-xs text-text-muted px-2 py-1">No saved views yet.</div>}
              </div>
            )}
          </div>

          {/* Column show/hide (feature 14) */}
          <div className="relative">
            <button onClick={() => setShowColMenu((v) => !v)} className="px-2 py-2 border border-border-primary text-xs hover:border-accent-blue" title="Columns">
              <Settings size={12} />
            </button>
            {showColMenu && (
              <div className="absolute right-0 top-full mt-1 z-50 block-card" style={{ minWidth: 180, padding: 8 }}>
                <div className="text-xs uppercase font-bold text-text-muted mb-2">Columns</div>
                {ALL_COLS.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 text-xs py-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={visibleCols.includes(c.key)}
                      onChange={() => setVisibleCols((cur) => cur.includes(c.key) ? cur.filter((k) => k !== c.key) : [...cur, c.key])}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Receipt}
          message={
            expenses.length === 0
              ? 'No expenses yet'
              : 'No expenses match your search or filter'
          }
        />
      ) : (
        <div className="block-card p-0 overflow-hidden">
          <div className="overflow-x-auto">
          <table className="block-table">
            <thead>
              <tr>
                <th style={{ width: '40px' }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="cursor-pointer"
                    style={{ accentColor: '#3b82f6' }}
                  />
                </th>
                {colVisible('date') && <th>Date</th>}
                {colVisible('description') && <th>Description</th>}
                {colVisible('category') && <th>Category</th>}
                {colVisible('vendor') && <th>Vendor</th>}
                {colVisible('project') && <th>Project</th>}
                {colVisible('amount') && <th className="text-right">Amount</th>}
                {colVisible('status') && <th>Status</th>}
                {colVisible('billable') && <th className="text-center">Billable</th>}
                {colVisible('actions') && <th style={{ width: '90px' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {(groupBy === 'none' ? filtered : []).map((exp) => renderExpenseRow(exp))}
              {groups && groups.flatMap(([key, rows]) => {
                const collapsed = collapsedGroups.has(key);
                const subtotal = rows.reduce((s, r) => s + (r.amount || 0), 0);
                const out: React.ReactNode[] = [];
                const colCount = ALL_COLS.filter((c) => visibleCols.includes(c.key)).length + 1;
                out.push(
                  <tr key={`grp-${key}`} className="bg-bg-tertiary cursor-pointer" onClick={() => {
                    const next = new Set(collapsedGroups);
                    if (next.has(key)) next.delete(key); else next.add(key);
                    setCollapsedGroups(next);
                  }}>
                    <td colSpan={colCount}>
                      <div className="flex items-center gap-2 text-xs font-bold text-text-primary">
                        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                        <span className="uppercase">{groupBy}: {key}</span>
                        <span className="text-text-muted ml-2">({rows.length})</span>
                        <span className="ml-auto font-mono text-accent-expense">{formatCurrency(subtotal)}</span>
                      </div>
                    </td>
                  </tr>
                );
                if (!collapsed) rows.forEach((r) => out.push(renderExpenseRow(r)));
                return out;
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={ALL_COLS.filter((c) => visibleCols.includes(c.key)).length + 1} className="text-right text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Filtered Total: <span className="font-mono font-bold text-text-primary ml-2">{formatCurrency(total)}</span>
                </td>
              </tr>
            </tfoot>
          </table>
          </div>
        </div>
      )}

      {showImport && (
        <ImportWizard
          table="expenses"
          requiredFields={['date', 'amount', 'description']}
          extraData={{ company_id: activeCompany?.id }}
          onDone={() => { setShowImport(false); reload(); }}
          onCancel={() => setShowImport(false)}
        />
      )}
      {showBulkPaste && activeCompany && (
        <BulkPasteModal
          companyId={activeCompany.id}
          onClose={() => setShowBulkPaste(false)}
          onImported={() => { setShowBulkPaste(false); reload(); }}
        />
      )}

      {showCcImport && (
        <CreditCardImportModal onClose={() => setShowCcImport(false)} onDone={() => { setShowCcImport(false); reload(); }} />
      )}

      {showBulkEdit && (
        <BulkEditModal
          ids={Array.from(selectedIds)}
          onClose={() => setShowBulkEdit(false)}
          onSaved={() => { setShowBulkEdit(false); reload(); }}
        />
      )}

      {bulkStatusConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="block-card p-4" style={{ width: 360 }}>
            <div className="text-sm font-bold text-text-primary mb-2">Mark {selectedIds.size} expenses as paid?</div>
            <div className="text-xs text-text-muted mb-4">Paid expenses are typically locked from edits. This cannot be undone in bulk.</div>
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setBulkStatusConfirm(null)} className="text-xs font-bold uppercase px-3 py-2 border border-border-primary">Cancel</button>
              <button onClick={() => handleBulkStatus(bulkStatusConfirm)} className="block-btn-primary text-xs">Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Floating Batch Action Bar ─────────────────────── */}
      {someSelected && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 border border-border-primary shadow-lg"
          style={{
            background: 'rgba(18,20,28,0.80)',
            borderRadius: '6px',
            minWidth: '420px',
          }}
        >
          <span className="text-xs font-semibold text-text-muted mr-2">
            {selectedIds.size} of {filtered.length} selected
          </span>

          <button
            className="block-btn-primary flex items-center gap-1.5 text-xs"
            onClick={handleBatchApprove}
            disabled={batchLoading}
          >
            <CheckCircle size={13} />
            Approve Selected
          </button>

          {/* Bulk Edit (feature 11) */}
          <button
            className="flex items-center gap-1.5 text-xs font-semibold text-text-primary"
            onClick={() => setShowBulkEdit(true)}
            style={{ background: 'rgba(28,30,38,0.65)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: '6px', padding: '6px 12px' }}
          >
            <Edit size={13} /> Bulk Edit
          </button>

          {/* Mass status change (feature 25) */}
          <select
            className="text-xs font-semibold"
            disabled={batchLoading}
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              if (v === 'paid') setBulkStatusConfirm('paid');
              else handleBulkStatus(v);
            }}
            style={{ background: 'rgba(28,30,38,0.65)', color: 'var(--color-text-primary)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: '6px', padding: '6px 10px' }}
          >
            <option value="">Change status…</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="paid">Paid (locks)</option>
          </select>

          {/* Feature 10 — Bulk re-categorize */}
          <select
            className="text-xs font-semibold"
            disabled={batchLoading}
            defaultValue=""
            onChange={(e) => {
              const id = e.target.value;
              e.target.value = '';
              if (id) handleBatchRecategorize(id);
            }}
            style={{ background: 'rgba(28,30,38,0.65)', color: 'var(--color-text-primary)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: '6px', padding: '6px 10px' }}
            title="Re-categorize selected"
          >
            <option value="">Re-categorize...</option>
            {[...categories]
              .filter(c => c.is_active === undefined || !!c.is_active)
              .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
              .map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          <button
            className="flex items-center gap-1.5 text-xs font-semibold text-text-primary"
            onClick={handleExportSelected}
            style={{ background: 'rgba(28,30,38,0.65)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer' }}
          >
            <Download size={13} />
            Export CSV
          </button>

          {!showDeleteConfirm ? (
            <button
              className="flex items-center gap-1.5 text-xs font-semibold"
              onClick={() => setShowDeleteConfirm(true)}
              style={{ background: 'transparent', border: '1px solid var(--color-accent-expense)', color: 'var(--color-accent-expense)', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer' }}
            >
              <Trash2 size={13} />
              Delete
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-accent-expense font-semibold">Confirm?</span>
              <button
                className="text-xs font-semibold"
                onClick={handleBatchDelete}
                disabled={batchLoading}
                style={{ background: 'var(--color-accent-expense)', color: '#fff', border: 'none', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer' }}
              >
                Yes, Delete
              </button>
              <button
                className="text-xs font-semibold text-text-muted"
                onClick={() => setShowDeleteConfirm(false)}
                style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.10)', borderRadius: '6px', padding: '5px 10px', cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ExpenseList;
