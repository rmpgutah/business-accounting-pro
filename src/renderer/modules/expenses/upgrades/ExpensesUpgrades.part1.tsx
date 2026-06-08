/**
 * ExpensesUpgradesPart1 — "Filters, Search & Saved Views"
 *
 * A self-contained panel of ~25 small working features for the Expenses module.
 * All data is loaded through the frontend `api` wrapper (db:query / db:raw-query),
 * scoped to the active company. Every control filters/searches/exports REAL
 * expense rows held in memory — no fake numbers, no dead buttons.
 *
 * This file owns its own filter state and renders a live "results" preview so
 * each feature visibly does something. It does NOT mutate the global Expenses
 * list (it is a drop-in companion panel), but its bulk action, CSV export,
 * clipboard copy, saved views and persisted settings are fully functional.
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import api from '../../../lib/api';
import { formatCurrency, formatDate } from '../../../lib/format';
import { useCompanyStore } from '../../../stores/companyStore';

// ─── Row shape ───────────────────────────────────────────
interface ExpenseRow {
  id: string;
  company_id?: string;
  vendor_id?: string | null;
  category_id?: string | null;
  project_id?: string | null;
  client_id?: string | null;
  date?: string | null;
  amount?: number | null;
  description?: string | null;
  reference?: string | null;
  is_billable?: number | null;
  is_reimbursable?: number | null;
  reimbursed?: number | null;
  is_tax_deductible?: number | null;
  is_recurring?: number | null;
  recurring_template_id?: string | null;
  receipt_path?: string | null;
  status?: string | null;
  payment_method?: string | null;
  currency?: string | null;
  tags?: string | null;
  updated_at?: string | null;
}

interface NamedRow { id: string; name: string }
interface VendorRow extends NamedRow { payment_terms?: number | null }

interface SavedView {
  id: string;
  name: string;
  filters: FilterState;
}

type TriState = 'all' | 'yes' | 'no';
type BillableMode = 'all' | 'billable' | 'reimbursable' | 'reimbursed';

interface FilterState {
  search: string;
  minAmount: string;
  maxAmount: string;
  vendorIds: string[];
  paymentMethods: string[];
  taxDeductible: TriState;
  billable: BillableMode;
  dateFrom: string;
  dateTo: string;
  untaggedOnly: boolean;
  missingReceiptOnly: boolean;
  projectId: string;
  clientId: string;
  tag: string;
  status: string; // '' | pending | approved | paid
  recurringOnly: boolean;
  anomalyOnly: boolean;
  termsBucket: string; // '' | '0' | '15' | '30' | '60'
  currency: string;
  duplicatesOnly: boolean;
  lineItemsMode: 'all' | 'itemized' | 'single';
  recentDays: string; // '' or number-of-days
}

const EMPTY_FILTERS: FilterState = {
  search: '',
  minAmount: '',
  maxAmount: '',
  vendorIds: [],
  paymentMethods: [],
  taxDeductible: 'all',
  billable: 'all',
  dateFrom: '',
  dateTo: '',
  untaggedOnly: false,
  missingReceiptOnly: false,
  projectId: '',
  clientId: '',
  tag: '',
  status: '',
  recurringOnly: false,
  anomalyOnly: false,
  termsBucket: '',
  currency: '',
  duplicatesOnly: false,
  lineItemsMode: 'all',
  recentDays: '',
};

const SAVED_VIEWS_KEY = 'bap.expenses.upgrades.savedViews';
const DEFAULT_VIEW_KEY = 'bap.expenses.upgrades.defaultViewId';

// ─── Helpers ─────────────────────────────────────────────
function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map((t) => String(t)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function dateOnly(raw: string | null | undefined): string {
  if (!raw) return '';
  return String(raw).slice(0, 10);
}

// ─── Component ───────────────────────────────────────────
export default function ExpensesUpgradesPart1() {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const companyId = activeCompany?.id ?? '';

  const [rows, setRows] = useState<ExpenseRow[]>([]);
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [projects, setProjects] = useState<NamedRow[]>([]);
  const [clients, setClients] = useState<NamedRow[]>([]);
  const [lineItemCounts, setLineItemCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [searchInput, setSearchInput] = useState('');
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [defaultViewId, setDefaultViewId] = useState<string>('');
  const [shareCode, setShareCode] = useState('');
  const [copyMsg, setCopyMsg] = useState('');

  const patch = useCallback((p: Partial<FilterState>) => {
    setFilters((f) => ({ ...f, ...p }));
  }, []);

  // ── Load saved views + default from localStorage (runs once) ──
  useEffect(() => {
    try {
      const rawViews = localStorage.getItem(SAVED_VIEWS_KEY);
      const parsed: SavedView[] = rawViews ? JSON.parse(rawViews) : [];
      const list = Array.isArray(parsed) ? parsed : [];
      setSavedViews(list);
      const def = localStorage.getItem(DEFAULT_VIEW_KEY) ?? '';
      setDefaultViewId(def);
      // Feature 16 — auto-apply pinned default view on mount
      const found = list.find((v) => v.id === def);
      if (found) {
        setFilters({ ...EMPTY_FILTERS, ...found.filters });
        setSearchInput(found.filters.search ?? '');
      }
    } catch {
      /* corrupt storage — ignore, start clean */
    }
  }, []);

  // ── Debounced search (Feature 11) ──
  useEffect(() => {
    const t = setTimeout(() => patch({ search: searchInput }), 250);
    return () => clearTimeout(t);
  }, [searchInput, patch]);

  // ── Load real data ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [exp, ven, proj, cli] = await Promise.all([
          api.query('expenses', undefined, { field: 'date', dir: 'desc' }, 2000),
          api.query('vendors'),
          api.query('projects'),
          api.query('clients'),
        ]);
        if (cancelled) return;
        const expRows: ExpenseRow[] = Array.isArray(exp) ? exp : [];
        setRows(expRows);
        setVendors(Array.isArray(ven) ? ven : []);
        setProjects(Array.isArray(proj) ? proj : []);
        setClients(Array.isArray(cli) ? cli : []);

        // Feature 22 — line-item counts per expense via raw aggregate query
        try {
          const liRows = await api.rawQuery(
            'SELECT expense_id, COUNT(*) AS n FROM expense_line_items GROUP BY expense_id'
          );
          if (!cancelled && Array.isArray(liRows)) {
            const map: Record<string, number> = {};
            for (const r of liRows as Array<{ expense_id?: string; n?: number }>) {
              if (r.expense_id) map[r.expense_id] = Number(r.n) || 0;
            }
            setLineItemCounts(map);
          }
        } catch {
          /* line items table may be empty / absent — non-fatal */
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load expenses');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  // ── Lookups ──
  const vendorName = useCallback(
    (id: string | null | undefined) => vendors.find((v) => v.id === id)?.name ?? '',
    [vendors]
  );
  const vendorTerms = useCallback(
    (id: string | null | undefined) => {
      const t = vendors.find((v) => v.id === id)?.payment_terms;
      return t == null ? null : Number(t);
    },
    [vendors]
  );

  // ── Derived facet data ──
  const allPaymentMethods = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      if (r.payment_method) set.add(r.payment_method);
    });
    return Array.from(set).sort();
  }, [rows]);

  const allCurrencies = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => set.add(r.currency || 'USD'));
    return Array.from(set).sort();
  }, [rows]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => parseTags(r.tags).forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [rows]);

  const vendorCounts = useMemo(() => {
    const map: Record<string, number> = {};
    rows.forEach((r) => {
      if (r.vendor_id) map[r.vendor_id] = (map[r.vendor_id] || 0) + 1;
    });
    return map;
  }, [rows]);

  const medianAmount = useMemo(
    () => median(rows.map((r) => Number(r.amount) || 0).filter((n) => n > 0)),
    [rows]
  );

  // Duplicate-suspect key set (Feature 21): vendor_id|amount|date appearing >1×
  const duplicateKeys = useMemo(() => {
    const counts: Record<string, number> = {};
    rows.forEach((r) => {
      const key = `${r.vendor_id || ''}|${Number(r.amount) || 0}|${dateOnly(r.date)}`;
      counts[key] = (counts[key] || 0) + 1;
    });
    return new Set(Object.keys(counts).filter((k) => counts[k] > 1));
  }, [rows]);

  // ── Status counts (Feature 13) ──
  const statusCounts = useMemo(() => {
    const c: Record<string, number> = { pending: 0, approved: 0, paid: 0 };
    rows.forEach((r) => {
      const s = r.status || 'pending';
      if (c[s] != null) c[s] += 1;
    });
    return c;
  }, [rows]);

  // ── Core filter pipeline ──
  const filtered = useMemo(() => {
    const min = filters.minAmount.trim() === '' ? -Infinity : Number(filters.minAmount);
    const max = filters.maxAmount.trim() === '' ? Infinity : Number(filters.maxAmount);
    const search = filters.search.trim().toLowerCase();
    const recentCutoff =
      filters.recentDays.trim() === ''
        ? null
        : Date.now() - Number(filters.recentDays) * 86_400_000;

    return rows.filter((r) => {
      const amt = Number(r.amount) || 0;
      if (amt < min || amt > max) return false; // 1

      if (filters.vendorIds.length && !filters.vendorIds.includes(r.vendor_id || '')) return false; // 2

      if (filters.paymentMethods.length && !filters.paymentMethods.includes(r.payment_method || ''))
        return false; // 3

      if (filters.taxDeductible !== 'all') {
        const ded = Number(r.is_tax_deductible ?? 1) === 1;
        if (filters.taxDeductible === 'yes' && !ded) return false; // 4
        if (filters.taxDeductible === 'no' && ded) return false;
      }

      if (filters.billable !== 'all') {
        if (filters.billable === 'billable' && Number(r.is_billable) !== 1) return false; // 5
        if (filters.billable === 'reimbursable' && Number(r.is_reimbursable) !== 1) return false;
        if (filters.billable === 'reimbursed' && Number(r.reimbursed) !== 1) return false;
      }

      const d = dateOnly(r.date);
      if (filters.dateFrom && d && d < filters.dateFrom) return false; // 6 / 7
      if (filters.dateTo && d && d > filters.dateTo) return false;

      if (filters.untaggedOnly) {
        const noCat = !r.category_id;
        const noTags = parseTags(r.tags).length === 0;
        if (!(noCat || noTags)) return false; // 8
      }

      if (filters.missingReceiptOnly && r.receipt_path) return false; // 9

      if (filters.projectId && (r.project_id || '') !== filters.projectId) return false; // 10
      if (filters.clientId && (r.client_id || '') !== filters.clientId) return false;

      if (search) {
        const hay = `${r.description || ''} ${r.reference || ''}`.toLowerCase();
        if (!hay.includes(search)) return false; // 11
      }

      if (filters.tag && !parseTags(r.tags).includes(filters.tag)) return false; // 12

      if (filters.status && (r.status || 'pending') !== filters.status) return false; // 13

      if (filters.recurringOnly && !(Number(r.is_recurring) === 1 || r.recurring_template_id))
        return false; // 14

      if (filters.anomalyOnly && !(medianAmount > 0 && amt > 2 * medianAmount)) return false; // 18

      if (filters.termsBucket !== '') {
        const terms = vendorTerms(r.vendor_id);
        const bucket = Number(filters.termsBucket);
        if (terms == null) return false;
        if (bucket === 60) {
          if (terms < 60) return false; // 19 — net 60+
        } else if (terms !== bucket) {
          return false;
        }
      }

      if (filters.currency && (r.currency || 'USD') !== filters.currency) return false; // 20

      if (filters.duplicatesOnly) {
        const key = `${r.vendor_id || ''}|${amt}|${d}`;
        if (!duplicateKeys.has(key)) return false; // 21
      }

      if (filters.lineItemsMode !== 'all') {
        const n = lineItemCounts[r.id] || 0;
        if (filters.lineItemsMode === 'itemized' && n < 2) return false; // 22
        if (filters.lineItemsMode === 'single' && n >= 2) return false;
      }

      if (recentCutoff != null) {
        const ts = r.updated_at ? new Date(r.updated_at).getTime() : NaN;
        if (!Number.isFinite(ts) || ts < recentCutoff) return false; // 25
      }

      return true;
    });
  }, [rows, filters, medianAmount, vendorTerms, duplicateKeys, lineItemCounts]);

  const filteredTotal = useMemo(
    () => filtered.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [filtered]
  );

  // ── Date preset helpers (Feature 6) ──
  const applyPreset = useCallback(
    (preset: 'mtd' | 'qtd' | 'ytd' | 'last30' | 'last90') => {
      const now = new Date();
      let from: Date;
      const to = now;
      if (preset === 'mtd') from = new Date(now.getFullYear(), now.getMonth(), 1);
      else if (preset === 'qtd') {
        const q = Math.floor(now.getMonth() / 3);
        from = new Date(now.getFullYear(), q * 3, 1);
      } else if (preset === 'ytd') from = new Date(now.getFullYear(), 0, 1);
      else if (preset === 'last30') from = new Date(now.getTime() - 30 * 86_400_000);
      else from = new Date(now.getTime() - 90 * 86_400_000);
      patch({ dateFrom: toDateStr(from), dateTo: toDateStr(to) });
    },
    [patch]
  );

  // ── Fiscal quarter picker (Feature 7) ──
  const applyQuarter = useCallback(
    (value: string) => {
      if (!value) {
        patch({ dateFrom: '', dateTo: '' });
        return;
      }
      const [yStr, qStr] = value.split('-Q');
      const year = Number(yStr);
      const q = Number(qStr);
      const from = new Date(year, (q - 1) * 3, 1);
      const to = new Date(year, q * 3, 0);
      patch({ dateFrom: toDateStr(from), dateTo: toDateStr(to) });
    },
    [patch]
  );

  // ── Saved views (Features 15, 16) ──
  const persistViews = useCallback((list: SavedView[]) => {
    setSavedViews(list);
    try {
      localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(list));
    } catch {
      /* storage full — ignore */
    }
  }, []);

  const saveCurrentView = useCallback(() => {
    const name = window.prompt('Name this saved view:');
    if (!name) return;
    const view: SavedView = {
      id: `v_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim(),
      filters: { ...filters },
    };
    persistViews([...savedViews, view]);
  }, [filters, savedViews, persistViews]);

  const applyView = useCallback((v: SavedView) => {
    setFilters({ ...EMPTY_FILTERS, ...v.filters });
    setSearchInput(v.filters.search ?? '');
  }, []);

  const renameView = useCallback(
    (id: string) => {
      const current = savedViews.find((v) => v.id === id);
      const name = window.prompt('Rename view:', current?.name ?? '');
      if (!name) return;
      persistViews(savedViews.map((v) => (v.id === id ? { ...v, name: name.trim() } : v)));
    },
    [savedViews, persistViews]
  );

  const deleteView = useCallback(
    (id: string) => {
      if (!window.confirm('Delete this saved view?')) return;
      persistViews(savedViews.filter((v) => v.id !== id));
      if (defaultViewId === id) {
        setDefaultViewId('');
        try {
          localStorage.removeItem(DEFAULT_VIEW_KEY);
        } catch {
          /* ignore */
        }
      }
    },
    [savedViews, persistViews, defaultViewId]
  );

  const pinDefault = useCallback((id: string) => {
    setDefaultViewId((cur) => {
      const next = cur === id ? '' : id;
      try {
        if (next) localStorage.setItem(DEFAULT_VIEW_KEY, next);
        else localStorage.removeItem(DEFAULT_VIEW_KEY);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // ── Shareable filter-as-URL hash (Feature 17) ──
  const exportShareCode = useCallback(() => {
    try {
      const json = JSON.stringify(filters);
      const code = btoa(unescape(encodeURIComponent(json)));
      setShareCode(code);
      if (navigator.clipboard) {
        navigator.clipboard.writeText(code).then(
          () => {
            setCopyMsg('Copied filter code to clipboard');
            setTimeout(() => setCopyMsg(''), 2000);
          },
          () => undefined
        );
      }
    } catch {
      setShareCode('');
    }
  }, [filters]);

  const importShareCode = useCallback(() => {
    const code = window.prompt('Paste a filter code to restore:');
    if (!code) return;
    try {
      const json = decodeURIComponent(escape(atob(code.trim())));
      const parsed = JSON.parse(json) as Partial<FilterState>;
      setFilters({ ...EMPTY_FILTERS, ...parsed });
      setSearchInput(parsed.search ?? '');
    } catch {
      window.alert('Invalid filter code.');
    }
  }, []);

  // ── CSV export of the filtered result set (Feature: export) ──
  const exportCsv = useCallback(() => {
    const header = [
      'Date',
      'Vendor',
      'Description',
      'Reference',
      'Amount',
      'Currency',
      'Status',
      'Payment Method',
    ];
    const escapeCell = (v: unknown) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(',')];
    filtered.forEach((r) => {
      lines.push(
        [
          dateOnly(r.date),
          vendorName(r.vendor_id),
          r.description || '',
          r.reference || '',
          (Number(r.amount) || 0).toFixed(2),
          r.currency || 'USD',
          r.status || 'pending',
          r.payment_method || '',
        ]
          .map(escapeCell)
          .join(',')
      );
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `expenses-filtered-${toDateStr(new Date())}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [filtered, vendorName]);

  // ── Bulk action: mark filtered as reimbursed (with confirm) ──
  const bulkMarkReimbursed = useCallback(async () => {
    const targets = filtered.filter((r) => Number(r.reimbursed) !== 1);
    if (targets.length === 0) {
      window.alert('No un-reimbursed expenses in the current result set.');
      return;
    }
    if (!window.confirm(`Mark ${targets.length} filtered expense(s) as reimbursed?`)) return;
    const today = toDateStr(new Date());
    try {
      await Promise.all(
        targets.map((r) => api.update('expenses', r.id, { reimbursed: 1, reimbursed_date: today }))
      );
      setRows((prev) =>
        prev.map((r) =>
          targets.find((t) => t.id === r.id)
            ? { ...r, reimbursed: 1, reimbursed_date: today }
            : r
        )
      );
    } catch (e) {
      window.alert(`Bulk update failed: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  }, [filtered]);

  // ── Copy filtered IDs to clipboard ──
  const copyIds = useCallback(() => {
    const text = filtered.map((r) => r.id).join('\n');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(
        () => {
          setCopyMsg(`Copied ${filtered.length} expense ID(s)`);
          setTimeout(() => setCopyMsg(''), 2000);
        },
        () => undefined
      );
    }
  }, [filtered]);

  // ── Vendor multi-select toggle (Feature 2) ──
  const toggleVendor = (id: string) =>
    patch({
      vendorIds: filters.vendorIds.includes(id)
        ? filters.vendorIds.filter((v) => v !== id)
        : [...filters.vendorIds, id],
    });

  const togglePaymentMethod = (m: string) =>
    patch({
      paymentMethods: filters.paymentMethods.includes(m)
        ? filters.paymentMethods.filter((x) => x !== m)
        : [...filters.paymentMethods, m],
    });

  // ── Active-filter summary chips (Feature 24) ──
  const activeChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; clear: () => void }> = [];
    if (filters.search) chips.push({ key: 'search', label: `search: "${filters.search}"`, clear: () => { setSearchInput(''); patch({ search: '' }); } });
    if (filters.minAmount) chips.push({ key: 'min', label: `min ${filters.minAmount}`, clear: () => patch({ minAmount: '' }) });
    if (filters.maxAmount) chips.push({ key: 'max', label: `max ${filters.maxAmount}`, clear: () => patch({ maxAmount: '' }) });
    filters.vendorIds.forEach((id) => chips.push({ key: `ven-${id}`, label: `vendor: ${vendorName(id) || '—'}`, clear: () => toggleVendor(id) }));
    filters.paymentMethods.forEach((m) => chips.push({ key: `pm-${m}`, label: `pay: ${m}`, clear: () => togglePaymentMethod(m) }));
    if (filters.taxDeductible !== 'all') chips.push({ key: 'tax', label: filters.taxDeductible === 'yes' ? 'deductible' : 'non-deductible', clear: () => patch({ taxDeductible: 'all' }) });
    if (filters.billable !== 'all') chips.push({ key: 'bill', label: filters.billable, clear: () => patch({ billable: 'all' }) });
    if (filters.dateFrom || filters.dateTo) chips.push({ key: 'date', label: `${filters.dateFrom || '…'} → ${filters.dateTo || '…'}`, clear: () => patch({ dateFrom: '', dateTo: '' }) });
    if (filters.untaggedOnly) chips.push({ key: 'untag', label: 'untagged/uncategorized', clear: () => patch({ untaggedOnly: false }) });
    if (filters.missingReceiptOnly) chips.push({ key: 'rcpt', label: 'missing receipt', clear: () => patch({ missingReceiptOnly: false }) });
    if (filters.projectId) chips.push({ key: 'proj', label: `project: ${projects.find((p) => p.id === filters.projectId)?.name || '—'}`, clear: () => patch({ projectId: '' }) });
    if (filters.clientId) chips.push({ key: 'cli', label: `client: ${clients.find((c) => c.id === filters.clientId)?.name || '—'}`, clear: () => patch({ clientId: '' }) });
    if (filters.tag) chips.push({ key: 'tag', label: `tag: ${filters.tag}`, clear: () => patch({ tag: '' }) });
    if (filters.status) chips.push({ key: 'status', label: `status: ${filters.status}`, clear: () => patch({ status: '' }) });
    if (filters.recurringOnly) chips.push({ key: 'rec', label: 'recurring only', clear: () => patch({ recurringOnly: false }) });
    if (filters.anomalyOnly) chips.push({ key: 'anom', label: 'amount anomalies', clear: () => patch({ anomalyOnly: false }) });
    if (filters.termsBucket !== '') chips.push({ key: 'terms', label: `net ${filters.termsBucket}${filters.termsBucket === '60' ? '+' : ''}`, clear: () => patch({ termsBucket: '' }) });
    if (filters.currency) chips.push({ key: 'cur', label: filters.currency, clear: () => patch({ currency: '' }) });
    if (filters.duplicatesOnly) chips.push({ key: 'dup', label: 'duplicate suspects', clear: () => patch({ duplicatesOnly: false }) });
    if (filters.lineItemsMode !== 'all') chips.push({ key: 'li', label: filters.lineItemsMode, clear: () => patch({ lineItemsMode: 'all' }) });
    if (filters.recentDays) chips.push({ key: 'recent', label: `edited ≤ ${filters.recentDays}d`, clear: () => patch({ recentDays: '' }) });
    return chips;
  }, [filters, vendorName, projects, clients, patch]);

  // ── Clear all (Feature 23) ──
  const clearAll = useCallback(() => {
    setFilters(EMPTY_FILTERS);
    setSearchInput('');
    setShareCode('');
  }, []);

  // Build fiscal-quarter options for current + prior year
  const quarterOptions = useMemo(() => {
    const yr = new Date().getFullYear();
    const out: string[] = [];
    [yr, yr - 1].forEach((y) => [1, 2, 3, 4].forEach((q) => out.push(`${y}-Q${q}`)));
    return out;
  }, []);

  const currentQuarterValue = useMemo(() => {
    if (!filters.dateFrom) return '';
    const d = new Date(`${filters.dateFrom}T12:00:00`);
    if (isNaN(d.getTime())) return '';
    const q = Math.floor(d.getMonth() / 3) + 1;
    const candidate = `${d.getFullYear()}-Q${q}`;
    return quarterOptions.includes(candidate) ? candidate : '';
  }, [filters.dateFrom, quarterOptions]);

  // ── Render ──
  const sectionStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 16 };
  const cardTitle = (t: string, sub?: string) => (
    <div style={{ marginBottom: 10 }}>
      <div className="text-text-primary" style={{ fontWeight: 600, fontSize: 13 }}>{t}</div>
      {sub && <div className="text-text-muted" style={{ fontSize: 11, marginTop: 2 }}>{sub}</div>}
    </div>
  );

  if (loading) {
    return (
      <div style={sectionStyle}>
        <h2 className="text-text-primary" style={{ fontSize: 16, fontWeight: 700 }}>Filters, Search &amp; Saved Views</h2>
        <div className="block-card text-text-muted">Loading expenses…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={sectionStyle}>
        <h2 className="text-text-primary" style={{ fontSize: 16, fontWeight: 700 }}>Filters, Search &amp; Saved Views</h2>
        <div className="block-card" style={{ color: 'var(--color-accent-expense)' }}>Error: {error}</div>
      </div>
    );
  }

  return (
    <div style={sectionStyle}>
      <h2 className="text-text-primary" style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
        Filters, Search &amp; Saved Views
      </h2>
      <div className="text-text-muted" style={{ fontSize: 11, marginTop: -8 }}>
        {rows.length} expenses loaded · {filtered.length} match · {formatCurrency(filteredTotal)} total
        {copyMsg && <span style={{ color: 'var(--color-accent-income)', marginLeft: 8 }}>{copyMsg}</span>}
      </div>

      {/* Active-filter summary chips (24) + clear-all (23) */}
      <div className="block-card">
        {cardTitle('Active filters', 'Removable chips for every constraint; one-click reset.')}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {activeChips.length === 0 && <span className="text-text-muted" style={{ fontSize: 12 }}>No active filters</span>}
          {activeChips.map((c) => (
            <button
              key={c.key}
              type="button"
              className="block-badge"
              onClick={c.clear}
              title="Click to remove"
              style={{ cursor: 'pointer' }}
            >
              {c.label} ✕
            </button>
          ))}
          {activeChips.length > 0 && (
            <button type="button" className="block-btn" onClick={clearAll} style={{ marginLeft: 'auto' }}>
              Clear all filters
            </button>
          )}
        </div>
      </div>

      {/* Search (11) */}
      <div className="block-card">
        {cardTitle('Description & reference search', 'Debounced, case-insensitive match.')}
        <input
          className="block-input"
          placeholder="Search description or reference…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={{ width: '100%' }}
        />
      </div>

      {/* Amount range (1) + anomaly (18) */}
      <div className="block-card">
        {cardTitle('Amount range & anomalies', `Median amount: ${formatCurrency(medianAmount)} · anomaly = > 2× median.`)}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            className="block-input"
            type="number"
            placeholder="Min"
            value={filters.minAmount}
            onChange={(e) => patch({ minAmount: e.target.value })}
            style={{ width: 120 }}
          />
          <span className="text-text-muted">to</span>
          <input
            className="block-input"
            type="number"
            placeholder="Max"
            value={filters.maxAmount}
            onChange={(e) => patch({ maxAmount: e.target.value })}
            style={{ width: 120 }}
          />
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }} className="text-text-secondary">
            <input type="checkbox" checked={filters.anomalyOnly} onChange={(e) => patch({ anomalyOnly: e.target.checked })} />
            Anomalies only ({rows.filter((r) => medianAmount > 0 && (Number(r.amount) || 0) > 2 * medianAmount).length})
          </label>
        </div>
      </div>

      {/* Vendor multi-select (2) */}
      <div className="block-card">
        {cardTitle('Vendors', 'Multi-select with per-vendor expense counts.')}
        <div style={{ maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {vendors.length === 0 && <span className="text-text-muted" style={{ fontSize: 12 }}>No vendors</span>}
          {vendors.map((v) => (
            <label key={v.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }} className="text-text-secondary">
              <input type="checkbox" checked={filters.vendorIds.includes(v.id)} onChange={() => toggleVendor(v.id)} />
              <span style={{ flex: 1 }}>{v.name}</span>
              <span className="text-text-muted">{vendorCounts[v.id] || 0}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Payment-method chips (3) */}
      <div className="block-card">
        {cardTitle('Payment method', 'Toggle chips computed from loaded expenses.')}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {allPaymentMethods.length === 0 && <span className="text-text-muted" style={{ fontSize: 12 }}>No payment methods recorded</span>}
          {allPaymentMethods.map((m) => {
            const on = filters.paymentMethods.includes(m);
            return (
              <button
                key={m}
                type="button"
                className={on ? 'block-btn-primary' : 'block-btn'}
                onClick={() => togglePaymentMethod(m)}
              >
                {m} ({rows.filter((r) => (r.payment_method || '') === m).length})
              </button>
            );
          })}
        </div>
      </div>

      {/* Tax-deductible (4) + billable (5) */}
      <div className="block-card">
        {cardTitle('Tax-deductible & billable', 'Three-state deductible filter; billable/reimbursable segments.')}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div className="text-text-muted" style={{ fontSize: 11, marginBottom: 4 }}>Tax deductible</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['all', 'yes', 'no'] as TriState[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={filters.taxDeductible === v ? 'block-btn-primary' : 'block-btn'}
                  onClick={() => patch({ taxDeductible: v })}
                >
                  {v === 'all' ? 'All' : v === 'yes' ? 'Deductible' : 'Non-deductible'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-text-muted" style={{ fontSize: 11, marginBottom: 4 }}>Billable / reimbursable</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['all', 'billable', 'reimbursable', 'reimbursed'] as BillableMode[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={filters.billable === v ? 'block-btn-primary' : 'block-btn'}
                  onClick={() => patch({ billable: v })}
                >
                  {v === 'all' ? 'All' : v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Date presets (6) + fiscal quarter (7) */}
      <div className="block-card">
        {cardTitle('Date range', 'Quick presets, fiscal-quarter picker, or custom bounds.')}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          <button type="button" className="block-btn" onClick={() => applyPreset('mtd')}>MTD</button>
          <button type="button" className="block-btn" onClick={() => applyPreset('qtd')}>QTD</button>
          <button type="button" className="block-btn" onClick={() => applyPreset('ytd')}>YTD</button>
          <button type="button" className="block-btn" onClick={() => applyPreset('last30')}>Last 30</button>
          <button type="button" className="block-btn" onClick={() => applyPreset('last90')}>Last 90</button>
          <select className="block-select" value={currentQuarterValue} onChange={(e) => applyQuarter(e.target.value)}>
            <option value="">Fiscal quarter…</option>
            {quarterOptions.map((q) => (
              <option key={q} value={q}>{q}</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="block-input" type="date" value={filters.dateFrom} onChange={(e) => patch({ dateFrom: e.target.value })} />
          <span className="text-text-muted">to</span>
          <input className="block-input" type="date" value={filters.dateTo} onChange={(e) => patch({ dateTo: e.target.value })} />
        </div>
      </div>

      {/* Status tabs (13) + recurring (14) */}
      <div className="block-card">
        {cardTitle('Status & recurrence', 'Quick status tabs with live counts.')}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          <button type="button" className={filters.status === '' ? 'block-btn-primary' : 'block-btn'} onClick={() => patch({ status: '' })}>
            All ({rows.length})
          </button>
          {(['pending', 'approved', 'paid'] as const).map((s) => (
            <button key={s} type="button" className={filters.status === s ? 'block-btn-primary' : 'block-btn'} onClick={() => patch({ status: s })}>
              {s.charAt(0).toUpperCase() + s.slice(1)} ({statusCounts[s]})
            </button>
          ))}
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginLeft: 8 }} className="text-text-secondary">
            <input type="checkbox" checked={filters.recurringOnly} onChange={(e) => patch({ recurringOnly: e.target.checked })} />
            Recurring only
          </label>
        </div>
      </div>

      {/* Project / client scoping (10) */}
      <div className="block-card">
        {cardTitle('Project & client scoping', 'Linked dropdowns filter by project_id / client_id.')}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select className="block-select" value={filters.projectId} onChange={(e) => patch({ projectId: e.target.value })}>
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select className="block-select" value={filters.clientId} onChange={(e) => patch({ clientId: e.target.value })}>
            <option value="">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tag combobox (12) + currency (20) + vendor terms (19) */}
      <div className="block-card">
        {cardTitle('Tags, currency & vendor terms', 'Tag union, currency subset, vendor net-terms buckets.')}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select className="block-select" value={filters.tag} onChange={(e) => patch({ tag: e.target.value })}>
            <option value="">All tags ({allTags.length})</option>
            {allTags.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <select className="block-select" value={filters.currency} onChange={(e) => patch({ currency: e.target.value })}>
            <option value="">All currencies</option>
            {allCurrencies.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select className="block-select" value={filters.termsBucket} onChange={(e) => patch({ termsBucket: e.target.value })}>
            <option value="">Any vendor terms</option>
            <option value="0">Net 0 (due now)</option>
            <option value="15">Net 15</option>
            <option value="30">Net 30</option>
            <option value="60">Net 60+</option>
          </select>
        </div>
      </div>

      {/* Cleanup toggles (8, 9, 21, 22, 25) */}
      <div className="block-card">
        {cardTitle('Cleanup & data-quality filters', 'Surface untagged, missing-receipt, duplicate, itemized and recently-edited rows.')}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }} className="text-text-secondary">
            <input type="checkbox" checked={filters.untaggedOnly} onChange={(e) => patch({ untaggedOnly: e.target.checked })} />
            Untagged / uncategorized
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }} className="text-text-secondary">
            <input type="checkbox" checked={filters.missingReceiptOnly} onChange={(e) => patch({ missingReceiptOnly: e.target.checked })} />
            Missing receipt
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }} className="text-text-secondary">
            <input type="checkbox" checked={filters.duplicatesOnly} onChange={(e) => patch({ duplicatesOnly: e.target.checked })} />
            Duplicate suspects ({duplicateKeys.size})
          </label>
          <select className="block-select" value={filters.lineItemsMode} onChange={(e) => patch({ lineItemsMode: e.target.value as FilterState['lineItemsMode'] })}>
            <option value="all">Any line items</option>
            <option value="itemized">Itemized (2+ lines)</option>
            <option value="single">Single-line</option>
          </select>
          <select className="block-select" value={filters.recentDays} onChange={(e) => patch({ recentDays: e.target.value })}>
            <option value="">Any edit date</option>
            <option value="1">Edited ≤ 1 day</option>
            <option value="7">Edited ≤ 7 days</option>
            <option value="30">Edited ≤ 30 days</option>
          </select>
        </div>
      </div>

      {/* Saved views (15, 16) + share (17) */}
      <div className="block-card">
        {cardTitle('Saved views & sharing', 'Save, rename, delete, pin a default, or share filters as a code.')}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          <button type="button" className="block-btn-primary" onClick={saveCurrentView}>Save current view</button>
          <button type="button" className="block-btn" onClick={exportShareCode}>Copy filter code</button>
          <button type="button" className="block-btn" onClick={importShareCode}>Restore from code</button>
        </div>
        {shareCode && (
          <textarea
            className="block-input"
            readOnly
            value={shareCode}
            onFocus={(e) => e.currentTarget.select()}
            style={{ width: '100%', height: 50, fontFamily: 'monospace', fontSize: 10, marginBottom: 10 }}
          />
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {savedViews.length === 0 && <span className="text-text-muted" style={{ fontSize: 12 }}>No saved views yet</span>}
          {savedViews.map((v) => (
            <div key={v.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button type="button" className="block-btn" style={{ flex: 1, textAlign: 'left' }} onClick={() => applyView(v)}>
                {v.name}
              </button>
              <button
                type="button"
                className={defaultViewId === v.id ? 'block-btn-primary' : 'block-btn'}
                title="Pin as default (auto-applied on load)"
                onClick={() => pinDefault(v.id)}
              >
                {defaultViewId === v.id ? '★ default' : 'Pin'}
              </button>
              <button type="button" className="block-btn" onClick={() => renameView(v.id)}>Rename</button>
              <button type="button" className="block-btn" onClick={() => deleteView(v.id)} style={{ color: 'var(--color-accent-expense)' }}>Delete</button>
            </div>
          ))}
        </div>
      </div>

      {/* Actions on the filtered set: CSV export, copy IDs, bulk reimburse */}
      <div className="block-card">
        {cardTitle('Actions on filtered results', `${filtered.length} row(s) in scope.`)}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="block-btn" onClick={exportCsv} disabled={filtered.length === 0}>Export CSV</button>
          <button type="button" className="block-btn" onClick={copyIds} disabled={filtered.length === 0}>Copy IDs</button>
          <button type="button" className="block-btn" onClick={bulkMarkReimbursed} disabled={filtered.length === 0}>Mark filtered reimbursed</button>
        </div>
      </div>

      {/* Live results preview */}
      <div className="block-card">
        {cardTitle('Results preview', 'Live view of the first 25 matching expenses.')}
        {filtered.length === 0 ? (
          <div className="text-text-muted" style={{ fontSize: 12 }}>No expenses match the current filters.</div>
        ) : (
          <table className="block-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Vendor</th>
                <th>Description</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 25).map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.date, { style: 'short' })}</td>
                  <td>{vendorName(r.vendor_id) || '—'}</td>
                  <td>{r.description || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{formatCurrency(r.amount)}</td>
                  <td>{r.status || 'pending'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
