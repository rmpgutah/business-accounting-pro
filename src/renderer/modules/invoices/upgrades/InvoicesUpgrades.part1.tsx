// src/renderer/modules/invoices/upgrades/InvoicesUpgrades.part1.tsx
//
// InvoicesUpgradesPart1 — "Filters, Search & Saved Views"
//
// A self-contained vertical stack of titled `block-card` panels, each a small
// working feature for the Invoices module. Every card reads REAL invoice data
// through the `api` wrapper (scoped to the active company), computes live
// results, and either filters/derives stats in memory, exports CSV, copies to
// clipboard, or persists settings to localStorage. No backend handlers added.
//
// All features operate on a single in-memory `invoices` array loaded once on
// mount; filter cards are composed into a shared filter pipeline so the final
// "Matching invoices" preview reflects every active control at once.

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import api from '../../../lib/api';
import { useCompanyStore } from '../../../stores/companyStore';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import EntityChip from '../../../components/EntityChip';
import { formatCurrency, formatDate, humanizeLabel } from '../../../lib/format';

// ─── Types ───────────────────────────────────────────────
interface InvoiceRow {
  id: string;
  company_id: string;
  client_id: string;
  invoice_number: string;
  status: string;
  issue_date: string;
  due_date: string;
  total: number;
  amount_paid: number;
  notes: string;
  is_recurring: number;
  invoice_type: string;
  currency: string;
  priority: string;
  tags: string;
  sales_rep_id: string;
  po_number: string;
  job_reference: string;
  created_at: string;
}

interface LineItemRow {
  invoice_id: string;
  project_id: string | null;
}

type AgingBucket = 'current' | 'b1_30' | 'b31_60' | 'b61_90' | 'b90plus';
type DateField = 'issue_date' | 'due_date';
type SortKey = 'issue_date' | 'due_date' | 'total' | 'days_outstanding' | 'balance';
type SortDir = 'asc' | 'desc';
type GroupBy = 'none' | 'client' | 'status' | 'month';
type SearchScope = 'all' | 'number' | 'client' | 'po';

interface ColumnVisibility {
  po: boolean;
  currency: boolean;
  tags: boolean;
  rep: boolean;
  balance: boolean;
}

interface SavedView {
  name: string;
  statuses: string[];
  clientId: string;
  dateFrom: string;
  dateTo: string;
  dateField: DateField;
  amountMin: string;
  amountMax: string;
  overdueOnly: boolean;
  aging: AgingBucket | '';
  invoiceType: string;
  currency: string;
  priorities: string[];
  tags: string[];
  repId: string;
  projectId: string;
  hasBalance: boolean;
  recurringOnly: boolean;
  staleDraftDays: number;
  search: string;
  searchScope: SearchScope;
  sortKey: SortKey;
  sortDir: SortDir;
  groupBy: GroupBy;
}

// ─── localStorage keys ───────────────────────────────────
const LS_VIEWS = 'bap-invoice-views';
const LS_DEFAULT_VIEW = 'bap-invoice-default-view';
const LS_RECENT = 'bap-invoice-recent';
const LS_COLUMNS = 'bap-invoice-columns';
const LS_SORT = 'bap-invoice-sort';

const ALL_STATUSES = ['draft', 'sent', 'paid', 'overdue', 'partial', 'cancelled'];

// ─── Helpers ─────────────────────────────────────────────
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function dayDiff(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + 'T00:00:00').getTime();
  const b = new Date(toISO + 'T00:00:00').getTime();
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.floor((b - a) / 86400000);
}

function daysOverdue(due: string): number {
  return dayDiff(due, todayISO());
}

function balanceOf(inv: InvoiceRow): number {
  return Math.round(((inv.total || 0) - (inv.amount_paid || 0)) * 100) / 100;
}

function parseTags(raw: string): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map((t) => String(t)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function bucketFor(inv: InvoiceRow): AgingBucket {
  const d = daysOverdue(inv.due_date);
  if (d <= 0) return 'current';
  if (d <= 30) return 'b1_30';
  if (d <= 60) return 'b31_60';
  if (d <= 90) return 'b61_90';
  return 'b90plus';
}

function readLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeLS(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / disabled — non-fatal */
  }
}

const DEFAULT_COLUMNS: ColumnVisibility = { po: false, currency: false, tags: false, rep: false, balance: true };

// ─── Component ───────────────────────────────────────────
const InvoicesUpgradesPart1: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const companyId = activeCompany?.id;

  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [users, setUsers] = useState<Array<{ id: string; display_name: string }>>([]);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [lineItems, setLineItems] = useState<LineItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Filter state (composed pipeline) ──
  const [statuses, setStatuses] = useState<string[]>([]);
  const [clientId, setClientId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [dateField, setDateField] = useState<DateField>('issue_date');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [aging, setAging] = useState<AgingBucket | ''>('');
  const [invoiceType, setInvoiceType] = useState('');
  const [currency, setCurrency] = useState('');
  const [priorities, setPriorities] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [repId, setRepId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [hasBalance, setHasBalance] = useState(false);
  const [recurringOnly, setRecurringOnly] = useState(false);
  const [staleDraftDays, setStaleDraftDays] = useState(14);
  const [staleDraftOn, setStaleDraftOn] = useState(false);

  // ── Search ──
  const [search, setSearch] = useState('');
  const [searchScope, setSearchScope] = useState<SearchScope>('all');
  const debouncedSearch = useDebouncedValue(search, 200);

  // ── Sort / group / columns ──
  const [sortKey, setSortKey] = useState<SortKey>(() => readLS(LS_SORT, { key: 'issue_date', dir: 'desc' } as { key: SortKey; dir: SortDir }).key);
  const [sortDir, setSortDir] = useState<SortDir>(() => readLS(LS_SORT, { key: 'issue_date', dir: 'desc' } as { key: SortKey; dir: SortDir }).dir);
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [columns, setColumns] = useState<ColumnVisibility>(() => ({ ...DEFAULT_COLUMNS, ...readLS<Partial<ColumnVisibility>>(LS_COLUMNS, {}) }));
  const [columnsOpen, setColumnsOpen] = useState(false);

  // ── Saved views ──
  const [savedViews, setSavedViews] = useState<SavedView[]>(() => readLS<SavedView[]>(LS_VIEWS, []));
  const [defaultViewName, setDefaultViewName] = useState<string>(() => readLS<string>(LS_DEFAULT_VIEW, ''));
  const [recentIds, setRecentIds] = useState<string[]>(() => readLS<string[]>(LS_RECENT, []));

  // ─── Load data ───
  useEffect(() => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [inv, cli, usr, proj, items] = await Promise.all([
          api.query('invoices', { company_id: companyId }, { field: 'issue_date', dir: 'desc' }, 3000),
          api.query('clients', { company_id: companyId, status: 'active' }),
          api.query('users'),
          api.query('projects', { company_id: companyId }),
          api.rawQuery(
            `SELECT li.invoice_id AS invoice_id, li.project_id AS project_id
             FROM invoice_line_items li
             JOIN invoices i ON i.id = li.invoice_id
             WHERE i.company_id = ? AND li.project_id IS NOT NULL AND li.project_id != ''`,
            [companyId]
          ),
        ]);
        if (cancelled) return;
        setInvoices(Array.isArray(inv) ? (inv as InvoiceRow[]) : []);
        setClients(Array.isArray(cli) ? (cli as Array<{ id: string; name: string }>) : []);
        setUsers(Array.isArray(usr) ? (usr as Array<{ id: string; display_name: string }>) : []);
        setProjects(Array.isArray(proj) ? (proj as Array<{ id: string; name: string }>) : []);
        setLineItems(Array.isArray(items) ? (items as LineItemRow[]) : []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load invoice data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  // ─── Derived lookup maps ───
  const clientMap = useMemo(() => {
    const m = new Map<string, string>();
    clients.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [clients]);

  const userMap = useMemo(() => {
    const m = new Map<string, string>();
    users.forEach((u) => m.set(u.id, u.display_name));
    return m;
  }, [users]);

  const invMap = useMemo(() => {
    const m = new Map<string, InvoiceRow>();
    invoices.forEach((i) => m.set(i.id, i));
    return m;
  }, [invoices]);

  // invoice_ids that touch the chosen project (feature 12)
  const projectInvoiceIds = useMemo(() => {
    if (!projectId) return null;
    const s = new Set<string>();
    lineItems.forEach((li) => {
      if (li.project_id === projectId) s.add(li.invoice_id);
    });
    return s;
  }, [lineItems, projectId]);

  // distinct value collections
  const distinctTypes = useMemo(() => {
    const s = new Set<string>();
    invoices.forEach((i) => i.invoice_type && s.add(i.invoice_type));
    return Array.from(s).sort();
  }, [invoices]);

  const distinctCurrencies = useMemo(() => {
    const s = new Set<string>();
    invoices.forEach((i) => i.currency && s.add(i.currency));
    return Array.from(s).sort();
  }, [invoices]);

  const distinctPriorities = useMemo(() => {
    const s = new Set<string>();
    invoices.forEach((i) => i.priority && s.add(i.priority));
    return Array.from(s).sort();
  }, [invoices]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    invoices.forEach((i) => parseTags(i.tags).forEach((t) => s.add(t)));
    return Array.from(s).sort();
  }, [invoices]);

  // ─── The filter pipeline ───
  const filtered = useMemo(() => {
    const today = todayISO();
    const min = amountMin === '' ? null : Number(amountMin);
    const max = amountMax === '' ? null : Number(amountMax);
    const q = debouncedSearch.trim().toLowerCase();

    return invoices.filter((inv) => {
      // 1. status multi-select
      if (statuses.length > 0 && !statuses.includes(inv.status)) return false;
      // 2. client
      if (clientId && inv.client_id !== clientId) return false;
      // 3. date range (issue or due)
      const dval = inv[dateField];
      if (dateFrom && (!dval || dval < dateFrom)) return false;
      if (dateTo && (!dval || dval > dateTo)) return false;
      // 4. amount range
      if (min != null && Number.isFinite(min) && (inv.total || 0) < min) return false;
      if (max != null && Number.isFinite(max) && (inv.total || 0) > max) return false;
      // 5. overdue-only
      if (overdueOnly && !(inv.status !== 'paid' && inv.due_date < today)) return false;
      // 6. aging bucket
      if (aging && bucketFor(inv) !== aging) return false;
      // 7. invoice type
      if (invoiceType && inv.invoice_type !== invoiceType) return false;
      // 8. currency
      if (currency && inv.currency !== currency) return false;
      // 9. priority
      if (priorities.length > 0 && !priorities.includes(inv.priority)) return false;
      // 10. tags (must contain EVERY selected tag)
      if (tagFilter.length > 0) {
        const t = parseTags(inv.tags);
        if (!tagFilter.every((sel) => t.includes(sel))) return false;
      }
      // 11. sales rep
      if (repId && inv.sales_rep_id !== repId) return false;
      // 12. project (via line items)
      if (projectInvoiceIds && !projectInvoiceIds.has(inv.id)) return false;
      // 13. has balance due
      if (hasBalance && balanceOf(inv) <= 0.005) return false;
      // 14. recurring only
      if (recurringOnly && inv.is_recurring !== 1) return false;
      // 23. stale draft
      if (staleDraftOn) {
        if (inv.status !== 'draft') return false;
        const created = (inv.created_at || '').slice(0, 10);
        if (!created || dayDiff(created, today) < staleDraftDays) return false;
      }
      // 15/16. search
      if (q) {
        const cname = (clientMap.get(inv.client_id) || '').toLowerCase();
        let hay = '';
        if (searchScope === 'number') hay = (inv.invoice_number || '').toLowerCase();
        else if (searchScope === 'client') hay = cname;
        else if (searchScope === 'po') hay = `${inv.po_number || ''} ${inv.job_reference || ''}`.toLowerCase();
        else
          hay = [
            inv.invoice_number,
            cname,
            inv.notes,
            inv.po_number,
            inv.job_reference,
            parseTags(inv.tags).join(' '),
            String(inv.total ?? ''),
          ]
            .join(' ')
            .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    invoices, statuses, clientId, dateFrom, dateTo, dateField, amountMin, amountMax,
    overdueOnly, aging, invoiceType, currency, priorities, tagFilter, repId,
    projectInvoiceIds, hasBalance, recurringOnly, staleDraftOn, staleDraftDays,
    debouncedSearch, searchScope, clientMap,
  ]);

  // ─── Sort ───
  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let av: number | string = 0;
      let bv: number | string = 0;
      switch (sortKey) {
        case 'total':
          av = a.total || 0; bv = b.total || 0; break;
        case 'balance':
          av = balanceOf(a); bv = balanceOf(b); break;
        case 'days_outstanding':
          av = daysOverdue(a.due_date); bv = daysOverdue(b.due_date); break;
        case 'due_date':
          av = a.due_date || ''; bv = b.due_date || ''; break;
        case 'issue_date':
        default:
          av = a.issue_date || ''; bv = b.issue_date || ''; break;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  // ─── Group ───
  const groups = useMemo(() => {
    if (groupBy === 'none') return [{ key: '', label: '', rows: sorted }];
    const map = new Map<string, InvoiceRow[]>();
    sorted.forEach((inv) => {
      let key: string;
      if (groupBy === 'client') key = clientMap.get(inv.client_id) || '(no client)';
      else if (groupBy === 'status') key = inv.status || '(none)';
      else key = (inv.issue_date || '').slice(0, 7) || '(no date)';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(inv);
    });
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([key, rows]) => ({ key, label: key, rows }));
  }, [sorted, groupBy, clientMap]);

  // ─── Active-filter count (feature 25) ───
  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (statuses.length) n++;
    if (clientId) n++;
    if (dateFrom || dateTo) n++;
    if (amountMin || amountMax) n++;
    if (overdueOnly) n++;
    if (aging) n++;
    if (invoiceType) n++;
    if (currency) n++;
    if (priorities.length) n++;
    if (tagFilter.length) n++;
    if (repId) n++;
    if (projectId) n++;
    if (hasBalance) n++;
    if (recurringOnly) n++;
    if (staleDraftOn) n++;
    if (search.trim()) n++;
    return n;
  }, [statuses, clientId, dateFrom, dateTo, amountMin, amountMax, overdueOnly, aging, invoiceType, currency, priorities, tagFilter, repId, projectId, hasBalance, recurringOnly, staleDraftOn, search]);

  // ─── Toggle helpers ───
  const toggleIn = (arr: string[], val: string, set: (v: string[]) => void) => {
    set(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val]);
  };

  // ─── Persist sort choice ───
  useEffect(() => {
    writeLS(LS_SORT, { key: sortKey, dir: sortDir });
  }, [sortKey, sortDir]);

  // ─── Build a snapshot of the current filter combo ───
  const snapshot = useCallback(
    (name: string): SavedView => ({
      name,
      statuses, clientId, dateFrom, dateTo, dateField, amountMin, amountMax,
      overdueOnly, aging, invoiceType, currency, priorities, tags: tagFilter,
      repId, projectId, hasBalance, recurringOnly, staleDraftDays,
      search, searchScope, sortKey, sortDir, groupBy,
    }),
    [statuses, clientId, dateFrom, dateTo, dateField, amountMin, amountMax, overdueOnly, aging, invoiceType, currency, priorities, tagFilter, repId, projectId, hasBalance, recurringOnly, staleDraftDays, search, searchScope, sortKey, sortDir, groupBy]
  );

  const applyView = useCallback((v: SavedView) => {
    setStatuses(v.statuses || []);
    setClientId(v.clientId || '');
    setDateFrom(v.dateFrom || '');
    setDateTo(v.dateTo || '');
    setDateField(v.dateField || 'issue_date');
    setAmountMin(v.amountMin || '');
    setAmountMax(v.amountMax || '');
    setOverdueOnly(!!v.overdueOnly);
    setAging(v.aging || '');
    setInvoiceType(v.invoiceType || '');
    setCurrency(v.currency || '');
    setPriorities(v.priorities || []);
    setTagFilter(v.tags || []);
    setRepId(v.repId || '');
    setProjectId(v.projectId || '');
    setHasBalance(!!v.hasBalance);
    setRecurringOnly(!!v.recurringOnly);
    setStaleDraftDays(typeof v.staleDraftDays === 'number' ? v.staleDraftDays : 14);
    setSearch(v.search || '');
    setSearchScope(v.searchScope || 'all');
    setSortKey(v.sortKey || 'issue_date');
    setSortDir(v.sortDir || 'desc');
    setGroupBy(v.groupBy || 'none');
  }, []);

  // Apply default view once after first data load (feature 18)
  const [appliedDefault, setAppliedDefault] = useState(false);
  useEffect(() => {
    if (appliedDefault || loading || !defaultViewName) return;
    const v = savedViews.find((x) => x.name === defaultViewName);
    if (v) applyView(v);
    setAppliedDefault(true);
  }, [appliedDefault, loading, defaultViewName, savedViews, applyView]);

  const saveCurrentView = () => {
    const name = window.prompt('Name this view:');
    if (!name || !name.trim()) return;
    const trimmed = name.trim();
    const next = [...savedViews.filter((v) => v.name !== trimmed), snapshot(trimmed)];
    setSavedViews(next);
    writeLS(LS_VIEWS, next);
  };

  const deleteView = (name: string) => {
    if (!window.confirm(`Delete saved view "${name}"?`)) return;
    const next = savedViews.filter((v) => v.name !== name);
    setSavedViews(next);
    writeLS(LS_VIEWS, next);
    if (defaultViewName === name) {
      setDefaultViewName('');
      writeLS(LS_DEFAULT_VIEW, '');
    }
  };

  const setAsDefault = (name: string) => {
    const next = defaultViewName === name ? '' : name;
    setDefaultViewName(next);
    writeLS(LS_DEFAULT_VIEW, next);
  };

  // Track a recently-viewed invoice (feature 19)
  const pushRecent = (id: string) => {
    const next = [id, ...recentIds.filter((x) => x !== id)].slice(0, 8);
    setRecentIds(next);
    writeLS(LS_RECENT, next);
  };

  // ─── Clear all (feature 25) ───
  const clearAll = () => {
    setStatuses([]);
    setClientId('');
    setDateFrom('');
    setDateTo('');
    setDateField('issue_date');
    setAmountMin('');
    setAmountMax('');
    setOverdueOnly(false);
    setAging('');
    setInvoiceType('');
    setCurrency('');
    setPriorities([]);
    setTagFilter([]);
    setRepId('');
    setProjectId('');
    setHasBalance(false);
    setRecurringOnly(false);
    setStaleDraftOn(false);
    setSearch('');
    setSearchScope('all');
    setSortKey('issue_date');
    setSortDir('desc');
    setGroupBy('none');
  };

  // ─── Quick date ranges (feature 24) ───
  const applyQuickRange = (which: 'this_month' | 'last_month' | 'this_quarter' | 'ytd') => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    let from: Date;
    let to: Date;
    if (which === 'this_month') {
      from = new Date(y, m, 1);
      to = new Date(y, m + 1, 0);
    } else if (which === 'last_month') {
      from = new Date(y, m - 1, 1);
      to = new Date(y, m, 0);
    } else if (which === 'this_quarter') {
      const q = Math.floor(m / 3);
      from = new Date(y, q * 3, 1);
      to = new Date(y, q * 3 + 3, 0);
    } else {
      from = new Date(y, 0, 1);
      to = now;
    }
    setDateFrom(fmt(from));
    setDateTo(fmt(to));
  };

  // ─── CSV export of the current filtered result ───
  const exportFilteredCSV = () => {
    const header = ['Invoice #', 'Client', 'Status', 'Issue Date', 'Due Date', 'Total', 'Paid', 'Balance', 'Currency', 'PO', 'Rep'];
    const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [header.map(esc).join(',')];
    sorted.forEach((inv) => {
      lines.push(
        [
          inv.invoice_number,
          clientMap.get(inv.client_id) || '',
          inv.status,
          inv.issue_date,
          inv.due_date,
          String(inv.total ?? 0),
          String(inv.amount_paid ?? 0),
          String(balanceOf(inv)),
          inv.currency,
          inv.po_number,
          userMap.get(inv.sales_rep_id) || '',
        ]
          .map(esc)
          .join(',')
      );
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `invoices-filtered-${todayISO()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyMatchingNumbers = async () => {
    const text = sorted.map((i) => i.invoice_number).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      window.alert(`Copied ${sorted.length} invoice number(s) to clipboard.`);
    } catch {
      window.alert('Clipboard unavailable in this environment.');
    }
  };

  // ─── Render guards ───
  if (!companyId) {
    return (
      <div className="block-card">
        <p className="text-text-muted text-sm">Select a company to use invoice filters.</p>
      </div>
    );
  }

  // ─── Reusable UI bits ───
  const chip = (label: string, active: boolean, onClick: () => void, key?: string) => (
    <button
      key={key ?? label}
      type="button"
      onClick={onClick}
      className="block-btn"
      style={{
        fontSize: 12,
        padding: '4px 10px',
        borderColor: active ? 'var(--color-accent-blue)' : undefined,
        color: active ? 'var(--color-accent-blue)' : undefined,
        opacity: active ? 1 : 0.75,
      }}
    >
      {label}
    </button>
  );

  const sectionStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 16 };
  const rowStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' };
  const titleStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--color-text-primary)' };
  const hintStyle: React.CSSProperties = { fontSize: 11, color: 'var(--color-text-muted)' };

  const matchedTotal = sorted.reduce((s, i) => s + (i.total || 0), 0);
  const matchedBalance = sorted.reduce((s, i) => s + balanceOf(i), 0);

  return (
    <div style={sectionStyle}>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)' }}>
        Filters, Search &amp; Saved Views
      </h2>

      {error && (
        <div className="block-card" style={{ borderColor: 'var(--color-accent-expense)' }}>
          <span style={{ color: 'var(--color-accent-expense)', fontSize: 13 }}>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="block-card">
          <p className="text-text-muted text-sm">Loading invoices…</p>
        </div>
      ) : (
        <>
          {/* Summary / live result preview */}
          <div className="block-card">
            <div style={titleStyle}>Matching invoices</div>
            <div style={{ ...rowStyle, gap: 24 }}>
              <div>
                <div style={hintStyle}>Count</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                  {sorted.length}
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)', marginLeft: 6 }}>
                    / {invoices.length}
                  </span>
                </div>
              </div>
              <div>
                <div style={hintStyle}>Total value</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-text-primary)' }}>{formatCurrency(matchedTotal)}</div>
              </div>
              <div>
                <div style={hintStyle}>Open balance</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-accent-warning)' }}>{formatCurrency(matchedBalance)}</div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <button type="button" className="block-btn" onClick={exportFilteredCSV} disabled={sorted.length === 0}>
                  Export CSV
                </button>
                <button type="button" className="block-btn" onClick={copyMatchingNumbers} disabled={sorted.length === 0}>
                  Copy #s
                </button>
              </div>
            </div>
          </div>

          {/* Feature 25: Clear all + active count */}
          <div className="block-card">
            <div style={rowStyle}>
              <button type="button" className="block-btn-primary" onClick={clearAll}>
                Clear all filters
              </button>
              <span className="block-badge" style={{ marginLeft: 4 }}>
                {activeFilterCount} active
              </span>
              <span style={{ ...hintStyle, marginLeft: 'auto' }}>Resets every filter, search &amp; sort to defaults.</span>
            </div>
          </div>

          {/* Feature 1: Status chips */}
          <div className="block-card">
            <div style={titleStyle}>Status</div>
            <div style={rowStyle}>
              {ALL_STATUSES.map((s) =>
                chip(humanizeLabel(s), statuses.includes(s), () => toggleIn(statuses, s, setStatuses), s)
              )}
            </div>
          </div>

          {/* Feature 2: Client dropdown */}
          <div className="block-card">
            <div style={titleStyle}>Client</div>
            <select className="block-select" value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ minWidth: 240 }}>
              <option value="">All clients</option>
              {clients
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>

          {/* Feature 3 + 24: Date range + quick ranges */}
          <div className="block-card">
            <div style={titleStyle}>Date range</div>
            <div style={rowStyle}>
              <select className="block-select" value={dateField} onChange={(e) => setDateField(e.target.value as DateField)}>
                <option value="issue_date">Issue date</option>
                <option value="due_date">Due date</option>
              </select>
              <input type="date" className="block-input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              <span style={hintStyle}>to</span>
              <input type="date" className="block-input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div style={{ ...rowStyle, marginTop: 8 }}>
              {chip('This month', false, () => applyQuickRange('this_month'), 'qr-tm')}
              {chip('Last month', false, () => applyQuickRange('last_month'), 'qr-lm')}
              {chip('This quarter', false, () => applyQuickRange('this_quarter'), 'qr-tq')}
              {chip('YTD', false, () => applyQuickRange('ytd'), 'qr-ytd')}
              {chip('Clear dates', false, () => { setDateFrom(''); setDateTo(''); }, 'qr-clr')}
            </div>
          </div>

          {/* Feature 4: Amount range */}
          <div className="block-card">
            <div style={titleStyle}>Amount range (total)</div>
            <div style={rowStyle}>
              <input
                type="number"
                className="block-input"
                placeholder="Min"
                value={amountMin}
                onChange={(e) => setAmountMin(e.target.value)}
                style={{ width: 120 }}
              />
              <span style={hintStyle}>–</span>
              <input
                type="number"
                className="block-input"
                placeholder="Max"
                value={amountMax}
                onChange={(e) => setAmountMax(e.target.value)}
                style={{ width: 120 }}
              />
            </div>
          </div>

          {/* Feature 5 + 13 + 14: Quick toggles */}
          <div className="block-card">
            <div style={titleStyle}>Quick toggles</div>
            <div style={rowStyle}>
              {chip('Overdue only', overdueOnly, () => setOverdueOnly((v) => !v), 't-overdue')}
              {chip('Has balance due', hasBalance, () => setHasBalance((v) => !v), 't-balance')}
              {chip('Recurring only', recurringOnly, () => setRecurringOnly((v) => !v), 't-recurring')}
            </div>
          </div>

          {/* Feature 6: Aging buckets */}
          <div className="block-card">
            <div style={titleStyle}>Aging bucket</div>
            <div style={rowStyle}>
              {([
                ['', 'Any'],
                ['current', 'Current'],
                ['b1_30', '1–30'],
                ['b31_60', '31–60'],
                ['b61_90', '61–90'],
                ['b90plus', '90+'],
              ] as Array<[AgingBucket | '', string]>).map(([val, label]) =>
                chip(label, aging === val, () => setAging(val), `ag-${val || 'any'}`)
              )}
            </div>
          </div>

          {/* Feature 7 + 8: Type + currency */}
          <div className="block-card">
            <div style={titleStyle}>Type &amp; currency</div>
            <div style={rowStyle}>
              <select className="block-select" value={invoiceType} onChange={(e) => setInvoiceType(e.target.value)}>
                <option value="">All types</option>
                {distinctTypes.map((t) => (
                  <option key={t} value={t}>
                    {humanizeLabel(t)}
                  </option>
                ))}
              </select>
              <select className="block-select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <option value="">All currencies</option>
                {distinctCurrencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Feature 9: Priority chips */}
          <div className="block-card">
            <div style={titleStyle}>Priority</div>
            {distinctPriorities.length === 0 ? (
              <span style={hintStyle}>No priority values on loaded invoices.</span>
            ) : (
              <div style={rowStyle}>
                {distinctPriorities.map((p) =>
                  chip(humanizeLabel(p), priorities.includes(p), () => toggleIn(priorities, p, setPriorities), `pr-${p}`)
                )}
              </div>
            )}
          </div>

          {/* Feature 10: Tags */}
          <div className="block-card">
            <div style={titleStyle}>Tags (match all selected)</div>
            {allTags.length === 0 ? (
              <span style={hintStyle}>No tags found on loaded invoices.</span>
            ) : (
              <div style={rowStyle}>
                {allTags.map((t) => chip(t, tagFilter.includes(t), () => toggleIn(tagFilter, t, setTagFilter), `tg-${t}`))}
              </div>
            )}
          </div>

          {/* Feature 11: Sales rep */}
          <div className="block-card">
            <div style={titleStyle}>Sales rep</div>
            <select className="block-select" value={repId} onChange={(e) => setRepId(e.target.value)} style={{ minWidth: 220 }}>
              <option value="">All reps</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name}
                </option>
              ))}
            </select>
          </div>

          {/* Feature 12: Project (via line items) */}
          <div className="block-card">
            <div style={titleStyle}>Project</div>
            <select className="block-select" value={projectId} onChange={(e) => setProjectId(e.target.value)} style={{ minWidth: 240 }}>
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <span style={{ ...hintStyle, marginLeft: 10 }}>
              {projectId ? `${projectInvoiceIds?.size ?? 0} invoice(s) reference this project` : 'Filters by line-item project links'}
            </span>
          </div>

          {/* Feature 23: Stale-draft filter */}
          <div className="block-card">
            <div style={titleStyle}>Stale drafts</div>
            <div style={rowStyle}>
              {chip(staleDraftOn ? 'On' : 'Off', staleDraftOn, () => setStaleDraftOn((v) => !v), 'sd-toggle')}
              <span style={hintStyle}>older than</span>
              <input
                type="range"
                min={1}
                max={90}
                value={staleDraftDays}
                onChange={(e) => setStaleDraftDays(Number(e.target.value))}
                style={{ width: 160 }}
              />
              <span style={{ ...hintStyle, minWidth: 56 }}>{staleDraftDays} days</span>
            </div>
          </div>

          {/* Feature 15 + 16: Search with scope */}
          <div className="block-card">
            <div style={titleStyle}>Search</div>
            <div style={rowStyle}>
              <select className="block-select" value={searchScope} onChange={(e) => setSearchScope(e.target.value as SearchScope)}>
                <option value="all">All fields</option>
                <option value="number">Invoice #</option>
                <option value="client">Client</option>
                <option value="po">PO / Job ref</option>
              </select>
              <input
                className="block-input"
                placeholder="Search number, client, notes, PO, tags, amount…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ flex: 1, minWidth: 220 }}
              />
            </div>
          </div>

          {/* Feature 21 + 22: Sort + group */}
          <div className="block-card">
            <div style={titleStyle}>Sort &amp; group</div>
            <div style={rowStyle}>
              <select className="block-select" value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}>
                <option value="issue_date">Issue date</option>
                <option value="due_date">Due date</option>
                <option value="total">Total</option>
                <option value="days_outstanding">Days outstanding</option>
                <option value="balance">Balance</option>
              </select>
              <select className="block-select" value={sortDir} onChange={(e) => setSortDir(e.target.value as SortDir)}>
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </select>
              <span style={{ ...hintStyle, marginLeft: 8 }}>Group:</span>
              <select className="block-select" value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)}>
                <option value="none">None</option>
                <option value="client">Client</option>
                <option value="status">Status</option>
                <option value="month">Issue month</option>
              </select>
            </div>
          </div>

          {/* Feature 20: Column show/hide */}
          <div className="block-card">
            <div style={{ ...rowStyle, justifyContent: 'space-between' }}>
              <div style={{ ...titleStyle, marginBottom: 0 }}>Columns</div>
              <button type="button" className="block-btn" onClick={() => setColumnsOpen((v) => !v)}>
                {columnsOpen ? 'Close' : 'Configure'}
              </button>
            </div>
            {columnsOpen && (
              <div style={{ ...rowStyle, marginTop: 8 }}>
                {(Object.keys(DEFAULT_COLUMNS) as Array<keyof ColumnVisibility>).map((col) => (
                  <label key={col} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={columns[col]}
                      onChange={(e) => {
                        const next = { ...columns, [col]: e.target.checked };
                        setColumns(next);
                        writeLS(LS_COLUMNS, next);
                      }}
                    />
                    {humanizeLabel(col)}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Feature 17 + 18: Saved views + default */}
          <div className="block-card">
            <div style={titleStyle}>Saved views</div>
            <div style={rowStyle}>
              <button type="button" className="block-btn-primary" onClick={saveCurrentView}>
                Save current view
              </button>
              <span style={hintStyle}>{savedViews.length} saved</span>
            </div>
            {savedViews.length > 0 && (
              <div style={{ ...sectionStyle, gap: 6, marginTop: 10 }}>
                {savedViews.map((v) => (
                  <div key={v.name} style={{ ...rowStyle, justifyContent: 'space-between' }}>
                    <button type="button" className="block-btn" onClick={() => applyView(v)} style={{ flex: 1, justifyContent: 'flex-start' }}>
                      {v.name}
                      {defaultViewName === v.name && (
                        <span className="block-badge" style={{ marginLeft: 8 }}>
                          default
                        </span>
                      )}
                    </button>
                    <button type="button" className="block-btn" onClick={() => setAsDefault(v.name)} title="Load this view by default on open">
                      {defaultViewName === v.name ? 'Unset default' : 'Set default'}
                    </button>
                    <button type="button" className="block-btn" onClick={() => deleteView(v.name)} style={{ color: 'var(--color-accent-expense)' }}>
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Feature 19: Recently-viewed rail */}
          <div className="block-card">
            <div style={titleStyle}>Recently viewed</div>
            {recentIds.length === 0 ? (
              <span style={hintStyle}>Click an invoice below to start tracking recent views.</span>
            ) : (
              <div style={{ ...rowStyle, gap: 6 }}>
                {recentIds.map((id) => {
                  const inv = invMap.get(id);
                  if (!inv) return null;
                  return <EntityChip key={id} type="invoice" id={id} label={inv.invoice_number} variant="badge" />;
                })}
                <button
                  type="button"
                  className="block-btn"
                  onClick={() => {
                    setRecentIds([]);
                    writeLS(LS_RECENT, []);
                  }}
                  style={{ fontSize: 11 }}
                >
                  Clear
                </button>
              </div>
            )}
          </div>

          {/* Result table (respects columns + groups) */}
          <div className="block-card">
            <div style={{ ...rowStyle, justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ ...titleStyle, marginBottom: 0 }}>Results</div>
              <span style={hintStyle}>{sorted.length} row(s)</span>
            </div>
            {sorted.length === 0 ? (
              <p className="text-text-muted text-sm">No invoices match the current filters.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="block-table">
                  <thead>
                    <tr>
                      <th>Invoice #</th>
                      <th>Client</th>
                      <th>Status</th>
                      <th>Issue</th>
                      <th>Due</th>
                      <th style={{ textAlign: 'right' }}>Total</th>
                      {columns.balance && <th style={{ textAlign: 'right' }}>Balance</th>}
                      {columns.currency && <th>Cur</th>}
                      {columns.po && <th>PO</th>}
                      {columns.rep && <th>Rep</th>}
                      {columns.tags && <th>Tags</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => (
                      <React.Fragment key={g.key || 'all'}>
                        {groupBy !== 'none' && (
                          <tr>
                            <td colSpan={11} style={{ fontWeight: 700, background: 'var(--color-bg-tertiary)' }}>
                              {groupBy === 'status' ? humanizeLabel(g.label) : g.label}
                              <span style={{ ...hintStyle, marginLeft: 10 }}>
                                {g.rows.length} • {formatCurrency(g.rows.reduce((s, i) => s + (i.total || 0), 0))}
                              </span>
                            </td>
                          </tr>
                        )}
                        {g.rows.map((inv) => (
                          <tr key={inv.id} onClick={() => pushRecent(inv.id)} style={{ cursor: 'pointer' }}>
                            <td className="font-mono">
                              <EntityChip type="invoice" id={inv.id} label={inv.invoice_number} variant="inline" />
                            </td>
                            <td>{clientMap.get(inv.client_id) || '—'}</td>
                            <td>{humanizeLabel(inv.status)}</td>
                            <td>{formatDate(inv.issue_date)}</td>
                            <td>{formatDate(inv.due_date)}</td>
                            <td style={{ textAlign: 'right' }}>{formatCurrency(inv.total)}</td>
                            {columns.balance && <td style={{ textAlign: 'right' }}>{formatCurrency(balanceOf(inv))}</td>}
                            {columns.currency && <td>{inv.currency}</td>}
                            {columns.po && <td>{inv.po_number || '—'}</td>}
                            {columns.rep && <td>{userMap.get(inv.sales_rep_id) || '—'}</td>}
                            {columns.tags && <td>{parseTags(inv.tags).join(', ') || '—'}</td>}
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default InvoicesUpgradesPart1;
