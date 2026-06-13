// src/renderer/modules/clients/upgrades/ClientsUpgrades.part1.tsx
//
// Clients module — "Filters, Search & Saved Views" upgrade panel.
// A self-contained vertical stack of small, working features. Every card
// loads REAL data through the api wrapper (clients + invoice aggregates),
// scopes by the active company, and either computes a live stat, filters the
// in-memory client set, runs a bulk action, exports CSV, copies to clipboard,
// or persists a setting to localStorage. Never throws on render.
//
// IMPORTANT: this file is the ONLY new file for this slice — it does not edit
// or depend on sibling upgrade files.

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Search, Filter, X, Download, Star, Save, Trash2, Copy, Check,
  AlertTriangle, MapPin, Tag as TagIcon, Clock, RefreshCw,
} from 'lucide-react';
import api from '../../../lib/api';
import { downloadCSVBlob } from '../../../lib/csv-export';
import { useCompanyStore } from '../../../stores/companyStore';
import { formatCurrency, formatDate, formatStatus, humanizeLabel } from '../../../lib/format';
import { CLIENT_RISK } from '../../../lib/classifications';

// ─── Types ──────────────────────────────────────────────
interface ClientRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  type: string;
  status: string;
  payment_terms: number;
  tax_id: string;
  city: string;
  state: string;
  country: string;
  tags: string;
  custom_fields: string;
  created_at: string | null;
}

interface InvoiceAgg {
  client_id: string;
  invoice_count: number;
  revenue: number;
  outstanding: number;
  overdue_count: number;
  last_invoice: string | null;
}

interface SavedView {
  id: string;
  name: string;
  filters: string;
  is_default: number;
}

// Combined filter state persisted into saved_views.filters
interface FilterState {
  search: string;
  status: string;          // 'all' | active | inactive | prospect
  type: string;            // 'all' | individual | company
  terms: string;           // 'all' | '0' | '15' | ...
  state: string;           // 'all' | <state>
  country: string;         // 'all' | <country>
  risk: string;            // 'all' | low | medium | high | critical
  minBalance: number;      // outstanding-balance threshold
  overdueOnly: boolean;
  neverBilledOnly: boolean;
  hideZeroBalance: boolean;
  inactiveDays: number;    // 0 = off; otherwise "no invoice in N days"
  missing: string[];       // subset of ['email','phone','tax_id']
  tags: string[];          // selected tag values
  tagMode: 'and' | 'or';
  createdFrom: string;     // ISO date or ''
  createdTo: string;       // ISO date or ''
  letter: string;          // '' or A-Z jump filter
}

const DEFAULT_FILTERS: FilterState = {
  search: '', status: 'all', type: 'all', terms: 'all', state: 'all',
  country: 'all', risk: 'all', minBalance: 0, overdueOnly: false,
  neverBilledOnly: false, hideZeroBalance: false, inactiveDays: 0,
  missing: [], tags: [], tagMode: 'or', createdFrom: '', createdTo: '',
  letter: '',
};

// ─── localStorage keys ──────────────────────────────────
const LS_SEARCH_HISTORY = 'bap.clients.searchHistory';
const LS_FAVORITES = 'bap.clients.favorites';
const LS_COLUMNS = 'bap.clients.visibleCols';

const ALL_COLUMNS = ['tier', 'industry', 'risk', 'terms', 'balance'] as const;
type ColKey = typeof ALL_COLUMNS[number];

// ─── localStorage helpers (never throw) ─────────────────
function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch { return fallback; }
}
function lsSet(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / private mode */ }
}

// Parse the JSON tags column → string[] (tolerates legacy comma strings).
function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((t) => String(t).trim()).filter(Boolean);
    return String(raw).split(',').map((t) => t.trim()).filter(Boolean);
  } catch {
    return String(raw).split(',').map((t) => t.trim()).filter(Boolean);
  }
}

// Read risk_rating out of the custom_fields JSON blob.
function parseRisk(raw: string | null | undefined): string {
  if (!raw) return '';
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? String(obj.risk_rating ?? '') : '';
  } catch { return ''; }
}

const PAYMENT_TERMS = [0, 15, 30, 45, 60, 90];

// ─── Component ──────────────────────────────────────────
const ClientsUpgradesPart1: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);

  const [clients, setClients] = useState<ClientRow[]>([]);
  const [aggMap, setAggMap] = useState<Map<string, InvoiceAgg>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const setF = useCallback(<K extends keyof FilterState>(key: K, val: FilterState[K]) => {
    setFilters((prev) => ({ ...prev, [key]: val }));
  }, []);

  // Saved views (DB) + per-user prefs (localStorage)
  const [views, setViews] = useState<SavedView[]>([]);
  const [viewName, setViewName] = useState('');
  const [favorites, setFavorites] = useState<string[]>(() => lsGet<string[]>(LS_FAVORITES, []));
  const [favoritesFirst, setFavoritesFirst] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>(() => lsGet<string[]>(LS_SEARCH_HISTORY, []));
  const [showHistory, setShowHistory] = useState(false);
  const [visibleCols, setVisibleCols] = useState<Record<ColKey, boolean>>(() =>
    lsGet<Record<ColKey, boolean>>(LS_COLUMNS, { tier: true, industry: true, risk: true, terms: true, balance: true }),
  );
  const [groupBy, setGroupBy] = useState<'none' | 'status' | 'state' | 'risk'>('none');
  const [copied, setCopied] = useState(false);
  const [defaultApplied, setDefaultApplied] = useState(false);

  // ─── Load real data ───────────────────────────────────
  const load = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    setError('');
    try {
      const [rows, aggRows, viewRows] = await Promise.all([
        api.query('clients', { company_id: activeCompany.id }, { field: 'name', dir: 'asc' }),
        api.rawQuery(
          `SELECT client_id,
            COUNT(*)                                     AS invoice_count,
            COALESCE(SUM(total), 0)                      AS revenue,
            COALESCE(SUM(total - amount_paid), 0)        AS outstanding,
            SUM(CASE WHEN status='overdue' THEN 1 ELSE 0 END) AS overdue_count,
            MAX(issue_date)                              AS last_invoice
          FROM invoices WHERE company_id = ?
          GROUP BY client_id`,
          [activeCompany.id],
        ),
        api.query('saved_views', { company_id: activeCompany.id, module: 'clients' }, { field: 'created_at', dir: 'desc' }),
      ]);

      setClients(Array.isArray(rows) ? (rows as ClientRow[]) : []);

      const m = new Map<string, InvoiceAgg>();
      (Array.isArray(aggRows) ? aggRows : []).forEach((r: any) => {
        m.set(String(r.client_id), {
          client_id: String(r.client_id),
          invoice_count: Number(r.invoice_count) || 0,
          revenue: Number(r.revenue) || 0,
          outstanding: Number(r.outstanding) || 0,
          overdue_count: Number(r.overdue_count) || 0,
          last_invoice: r.last_invoice ?? null,
        });
      });
      setAggMap(m);
      setViews(Array.isArray(viewRows) ? (viewRows as SavedView[]) : []);
    } catch (err: any) {
      console.error('ClientsUpgradesPart1 load failed:', err);
      setError(err?.message || 'Failed to load client data');
      setClients([]);
      setAggMap(new Map());
    } finally {
      setLoading(false);
    }
  }, [activeCompany]);

  useEffect(() => { load(); }, [load]);

  // ─── Default saved view auto-apply (feature 12) ───────
  useEffect(() => {
    if (defaultApplied || views.length === 0) return;
    const def = views.find((v) => Number(v.is_default) === 1);
    if (def) {
      try {
        const parsed = JSON.parse(def.filters || '{}');
        setFilters({ ...DEFAULT_FILTERS, ...parsed });
      } catch { /* ignore malformed */ }
    }
    setDefaultApplied(true);
  }, [views, defaultApplied]);

  // ─── Derived option lists ─────────────────────────────
  const states = useMemo(() => {
    const s = new Set<string>();
    clients.forEach((c) => { if (c.state) s.add(c.state); });
    return Array.from(s).sort();
  }, [clients]);

  const countries = useMemo(() => {
    const s = new Set<string>();
    clients.forEach((c) => { if (c.country) s.add(c.country); });
    return Array.from(s).sort();
  }, [clients]);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    clients.forEach((c) => parseTags(c.tags).forEach((t) => s.add(t)));
    return Array.from(s).sort();
  }, [clients]);

  // ─── The single combined filter pipeline ──────────────
  const filtered = useMemo(() => {
    const now = Date.now();
    let list = clients.slice();

    if (filters.status !== 'all') list = list.filter((c) => c.status === filters.status);
    if (filters.type !== 'all') list = list.filter((c) => (c.type || 'company') === filters.type);
    if (filters.terms !== 'all') list = list.filter((c) => String(c.payment_terms ?? 30) === filters.terms);
    if (filters.state !== 'all') list = list.filter((c) => (c.state || '') === filters.state);
    if (filters.country !== 'all') list = list.filter((c) => (c.country || '') === filters.country);
    if (filters.risk !== 'all') list = list.filter((c) => parseRisk(c.custom_fields) === filters.risk);

    if (filters.minBalance > 0) {
      list = list.filter((c) => (aggMap.get(c.id)?.outstanding ?? 0) >= filters.minBalance);
    }
    if (filters.hideZeroBalance) {
      list = list.filter((c) => (aggMap.get(c.id)?.outstanding ?? 0) > 0.005);
    }
    if (filters.overdueOnly) {
      list = list.filter((c) => (aggMap.get(c.id)?.overdue_count ?? 0) >= 1);
    }
    if (filters.neverBilledOnly) {
      list = list.filter((c) => (aggMap.get(c.id)?.invoice_count ?? 0) === 0);
    }
    if (filters.inactiveDays > 0) {
      list = list.filter((c) => {
        const last = aggMap.get(c.id)?.last_invoice;
        if (!last) return true; // never billed counts as dormant
        const days = (now - new Date(last).getTime()) / 86_400_000;
        return days >= filters.inactiveDays;
      });
    }
    if (filters.missing.length) {
      list = list.filter((c) =>
        filters.missing.every((field) => {
          if (field === 'email') return !(c.email && c.email.trim());
          if (field === 'phone') return !(c.phone && c.phone.trim());
          if (field === 'tax_id') return !(c.tax_id && c.tax_id.trim());
          return true;
        }),
      );
    }
    if (filters.tags.length) {
      list = list.filter((c) => {
        const ct = parseTags(c.tags);
        return filters.tagMode === 'and'
          ? filters.tags.every((t) => ct.includes(t))
          : filters.tags.some((t) => ct.includes(t));
      });
    }
    if (filters.createdFrom) list = list.filter((c) => (c.created_at || '') >= filters.createdFrom);
    if (filters.createdTo) list = list.filter((c) => (c.created_at || '') <= filters.createdTo + 'T23:59:59');
    if (filters.letter) {
      const L = filters.letter.toUpperCase();
      list = list.filter((c) => (c.name || '').trim().charAt(0).toUpperCase() === L);
    }

    // Fuzzy multi-field search (feature 15): name/email/phone/city/state/tax_id
    if (filters.search.trim()) {
      const q = filters.search.toLowerCase();
      list = list.filter((c) =>
        (c.name || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q) ||
        (c.city || '').toLowerCase().includes(q) ||
        (c.state || '').toLowerCase().includes(q) ||
        (c.tax_id || '').toLowerCase().includes(q),
      );
    }

    // Favorites-first sort (feature 17), otherwise alpha
    list.sort((a, b) => {
      if (favoritesFirst) {
        const fa = favorites.includes(a.id) ? 0 : 1;
        const fb = favorites.includes(b.id) ? 0 : 1;
        if (fa !== fb) return fa - fb;
      }
      return (a.name || '').localeCompare(b.name || '');
    });

    return list;
  }, [clients, aggMap, filters, favorites, favoritesFirst]);

  // ─── Active-filter chips model (feature 21) ──────────
  const activeChips = useMemo(() => {
    const chips: { key: string; label: string; clear: () => void }[] = [];
    if (filters.search.trim()) chips.push({ key: 'search', label: `Search: "${filters.search}"`, clear: () => setF('search', '') });
    if (filters.status !== 'all') chips.push({ key: 'status', label: `Status: ${filters.status}`, clear: () => setF('status', 'all') });
    if (filters.type !== 'all') chips.push({ key: 'type', label: `Type: ${filters.type}`, clear: () => setF('type', 'all') });
    if (filters.terms !== 'all') chips.push({ key: 'terms', label: `Net ${filters.terms}`, clear: () => setF('terms', 'all') });
    if (filters.state !== 'all') chips.push({ key: 'state', label: `State: ${filters.state}`, clear: () => setF('state', 'all') });
    if (filters.country !== 'all') chips.push({ key: 'country', label: `Country: ${filters.country}`, clear: () => setF('country', 'all') });
    if (filters.risk !== 'all') chips.push({ key: 'risk', label: `Risk: ${filters.risk}`, clear: () => setF('risk', 'all') });
    if (filters.minBalance > 0) chips.push({ key: 'bal', label: `Balance ≥ ${formatCurrency(filters.minBalance)}`, clear: () => setF('minBalance', 0) });
    if (filters.hideZeroBalance) chips.push({ key: 'nz', label: 'Owes money', clear: () => setF('hideZeroBalance', false) });
    if (filters.overdueOnly) chips.push({ key: 'ov', label: 'Has overdue', clear: () => setF('overdueOnly', false) });
    if (filters.neverBilledOnly) chips.push({ key: 'nb', label: 'Never billed', clear: () => setF('neverBilledOnly', false) });
    if (filters.inactiveDays > 0) chips.push({ key: 'inact', label: `Dormant ≥ ${filters.inactiveDays}d`, clear: () => setF('inactiveDays', 0) });
    filters.missing.forEach((mm) => chips.push({ key: 'miss-' + mm, label: `No ${mm}`, clear: () => setF('missing', filters.missing.filter((x) => x !== mm)) }));
    filters.tags.forEach((t) => chips.push({ key: 'tag-' + t, label: `#${t}`, clear: () => setF('tags', filters.tags.filter((x) => x !== t)) }));
    if (filters.createdFrom || filters.createdTo) chips.push({ key: 'created', label: `Created ${filters.createdFrom || '…'}→${filters.createdTo || '…'}`, clear: () => setFilters((p) => ({ ...p, createdFrom: '', createdTo: '' })) });
    if (filters.letter) chips.push({ key: 'letter', label: `A–Z: ${filters.letter}`, clear: () => setF('letter', '') });
    return chips;
  }, [filters, setF]);

  // ─── Aggregate insight for the result count card ─────
  const resultOutstanding = useMemo(
    () => filtered.reduce((sum, c) => sum + (aggMap.get(c.id)?.outstanding ?? 0), 0),
    [filtered, aggMap],
  );

  // ─── Counts for type segmented control ───────────────
  const typeCounts = useMemo(() => {
    let ind = 0, comp = 0;
    clients.forEach((c) => { if ((c.type || 'company') === 'individual') ind++; else comp++; });
    return { individual: ind, company: comp };
  }, [clients]);

  // ─── Actions ──────────────────────────────────────────
  const runSearch = useCallback((term: string) => {
    setF('search', term);
    const t = term.trim();
    if (!t) return;
    setSearchHistory((prev) => {
      const next = [t, ...prev.filter((x) => x !== t)].slice(0, 8);
      lsSet(LS_SEARCH_HISTORY, next);
      return next;
    });
  }, [setF]);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      lsSet(LS_FAVORITES, next);
      return next;
    });
  }, []);

  const toggleCol = useCallback((c: ColKey) => {
    setVisibleCols((prev) => {
      const next = { ...prev, [c]: !prev[c] };
      lsSet(LS_COLUMNS, next);
      return next;
    });
  }, []);

  const applyPreset = useCallback((preset: string) => {
    const base = { ...DEFAULT_FILTERS };
    if (preset === 'active') base.status = 'active';
    else if (preset === 'prospects') { base.status = 'prospect'; }
    else if (preset === 'overdue') base.overdueOnly = true;
    else if (preset === 'owes') base.hideZeroBalance = true;
    else if (preset === 'newMonth') {
      const d = new Date();
      base.createdFrom = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
    }
    setFilters(base);
  }, []);

  const saveView = useCallback(async () => {
    if (!activeCompany || !viewName.trim()) return;
    try {
      await api.create('saved_views', {
        company_id: activeCompany.id,
        module: 'clients',
        name: viewName.trim(),
        filters: JSON.stringify(filters),
        sort: JSON.stringify({ favoritesFirst }),
        columns: JSON.stringify(visibleCols),
        is_default: 0,
      });
      setViewName('');
      await load();
    } catch (err: any) {
      console.error('Save view failed:', err);
      alert('Failed to save view: ' + (err?.message || 'Unknown error'));
    }
  }, [activeCompany, viewName, filters, favoritesFirst, visibleCols, load]);

  const applyView = useCallback((v: SavedView) => {
    try {
      const parsed = JSON.parse(v.filters || '{}');
      setFilters({ ...DEFAULT_FILTERS, ...parsed });
    } catch { setFilters(DEFAULT_FILTERS); }
  }, []);

  const makeDefaultView = useCallback(async (v: SavedView) => {
    if (!activeCompany) return;
    try {
      // Clear existing defaults, then set this one.
      await Promise.all(
        views.filter((x) => Number(x.is_default) === 1 && x.id !== v.id)
          .map((x) => api.update('saved_views', x.id, { is_default: 0 })),
      );
      await api.update('saved_views', v.id, { is_default: 1 });
      await load();
    } catch (err: any) {
      console.error('Set default view failed:', err);
      alert('Failed to set default: ' + (err?.message || 'Unknown error'));
    }
  }, [activeCompany, views, load]);

  const deleteView = useCallback(async (v: SavedView) => {
    if (!confirm(`Delete saved view "${v.name}"?`)) return;
    try {
      await api.remove('saved_views', v.id);
      await load();
    } catch (err: any) {
      console.error('Delete view failed:', err);
      alert('Failed to delete view: ' + (err?.message || 'Unknown error'));
    }
  }, [load]);

  const exportCSV = useCallback(() => {
    const data = filtered.map((c) => {
      const agg = aggMap.get(c.id);
      return {
        name: c.name,
        type: c.type,
        status: c.status,
        email: c.email || '',
        phone: c.phone || '',
        city: c.city || '',
        state: c.state || '',
        country: c.country || '',
        payment_terms: c.payment_terms != null ? `Net ${c.payment_terms}` : '',
        risk_rating: parseRisk(c.custom_fields) || '',
        invoices: agg?.invoice_count ?? 0,
        revenue: agg?.revenue ?? 0,
        outstanding: agg?.outstanding ?? 0,
        tags: parseTags(c.tags).join('; '),
      };
    });
    downloadCSVBlob(data, 'clients-filtered.csv');
  }, [filtered, aggMap]);

  const copyEmails = useCallback(async () => {
    const emails = filtered.map((c) => c.email).filter((e) => e && e.trim()).join(', ');
    if (!emails) { alert('No email addresses in the current result set.'); return; }
    try {
      await navigator.clipboard.writeText(emails);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      alert('Clipboard unavailable in this environment.');
    }
  }, [filtered]);

  const bulkSetInactive = useCallback(async () => {
    if (filters.inactiveDays <= 0) return;
    const targets = filtered.filter((c) => c.status !== 'inactive');
    if (targets.length === 0) { alert('No active dormant clients to update.'); return; }
    if (!confirm(`Mark ${targets.length} dormant client(s) as inactive?`)) return;
    try {
      await api.batchUpdate('clients', targets.map((c) => c.id), { status: 'inactive' });
      await load();
    } catch (err: any) {
      console.error('Bulk inactivate failed:', err);
      alert('Bulk update failed: ' + (err?.message || 'Unknown error'));
    }
  }, [filters.inactiveDays, filtered, load]);

  // ─── Grouped rows for group-by mode (feature 18) ─────
  const grouped = useMemo(() => {
    if (groupBy === 'none') return null;
    const groups = new Map<string, ClientRow[]>();
    filtered.forEach((c) => {
      let key = 'Other';
      if (groupBy === 'status') key = c.status || 'unknown';
      else if (groupBy === 'state') key = c.state || '—';
      else if (groupBy === 'risk') key = parseRisk(c.custom_fields) || 'unrated';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(c);
    });
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [groupBy, filtered]);

  // ─── Render helpers ───────────────────────────────────
  const chip = (label: string, active: boolean, onClick: () => void, key?: string) => (
    <button
      key={key ?? label}
      onClick={onClick}
      className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors"
      style={{
        borderRadius: 'var(--app-radius)',
        border: '1px solid ' + (active ? 'var(--accent-primary)' : 'var(--structure)'),
        color: active ? 'var(--accent-primary)' : 'var(--color-text-secondary)',
        background: active ? 'rgba(255,255,255,0.04)' : 'transparent',
      }}
    >
      {label}
    </button>
  );

  const card = (title: string, subtitle: string, body: React.ReactNode) => (
    <div className="block-card p-4" style={{ borderRadius: 'var(--app-radius)' }}>
      <div className="mb-3">
        <h3 className="text-sm font-bold text-text-primary">{title}</h3>
        <p className="text-[11px] text-text-muted mt-0.5">{subtitle}</p>
      </div>
      {body}
    </div>
  );

  // ─── Loading / empty / error guards ──────────────────
  if (!activeCompany) {
    return <div className="text-sm text-text-muted p-4">Select a company to use the Clients filters.</div>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-text-primary">Filters, Search &amp; Saved Views</h2>
        <p className="text-[11px] text-text-muted mt-0.5">
          {loading ? 'Loading client data…' : `${clients.length} client${clients.length !== 1 ? 's' : ''} loaded`}
          {' · '}{aggMap.size} with invoices
        </p>
      </div>

      {error && (
        <div
          className="text-xs font-semibold p-3 flex items-center gap-2"
          style={{ borderRadius: 'var(--app-radius)', border: '1px solid var(--color-accent-expense)', color: 'var(--color-accent-expense)' }}
        >
          <AlertTriangle size={14} /> {error}
          <button onClick={load} className="ml-auto inline-flex items-center gap-1 text-text-secondary"><RefreshCw size={12} /> Retry</button>
        </div>
      )}

      {/* ─── Feature 21: result count + active filter chips ─── */}
      {card(
        'Result Summary & Active Filters',
        'Live count of matching clients with one-click removable filter chips.',
        <div>
          <div className="flex items-baseline gap-4 mb-2">
            <div>
              <span className="text-2xl font-mono font-bold text-text-primary">{filtered.length}</span>
              <span className="text-xs text-text-muted"> of {clients.length} clients</span>
            </div>
            <div className="text-xs text-text-muted">
              Outstanding in view: <span className="font-mono text-accent-expense">{formatCurrency(resultOutstanding)}</span>
            </div>
          </div>
          {activeChips.length === 0 ? (
            <p className="text-[11px] text-text-muted">No active filters.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5 items-center">
              {activeChips.map((c) => (
                <span
                  key={c.key}
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px]"
                  style={{ borderRadius: 'var(--app-radius)', border: '1px solid var(--structure)', color: 'var(--color-text-secondary)' }}
                >
                  {c.label}
                  <button onClick={c.clear} className="hover:text-accent-expense"><X size={11} /></button>
                </span>
              ))}
              <button onClick={() => setFilters(DEFAULT_FILTERS)} className="text-[10px] font-semibold text-accent-blue uppercase tracking-wider hover:underline ml-1">
                Clear all
              </button>
            </div>
          )}
        </div>,
      )}

      {/* ─── Features 13: Quick presets ─── */}
      {card(
        'Quick Filter Presets',
        'One-click chips that set the whole filter state for common workflows.',
        <div className="flex flex-wrap gap-1.5">
          {chip('Active', false, () => applyPreset('active'))}
          {chip('Prospects', false, () => applyPreset('prospects'))}
          {chip('Has Overdue', false, () => applyPreset('overdue'))}
          {chip('Owes Money', false, () => applyPreset('owes'))}
          {chip('New This Month', false, () => applyPreset('newMonth'))}
          {chip('Reset', false, () => setFilters(DEFAULT_FILTERS))}
        </div>,
      )}

      {/* ─── Features 14 & 15: search + history ─── */}
      {card(
        'Multi-Field Search',
        'Matches name, email, phone, city, state and tax ID. Last 8 searches saved locally.',
        <div className="relative">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              className="block-input pl-8"
              placeholder="Search clients across all fields…"
              value={filters.search}
              onChange={(e) => setF('search', e.target.value)}
              onFocus={() => setShowHistory(true)}
              onBlur={() => setTimeout(() => setShowHistory(false), 150)}
              onKeyDown={(e) => { if (e.key === 'Enter') runSearch(filters.search); }}
            />
          </div>
          {showHistory && searchHistory.length > 0 && (
            <div
              className="absolute z-20 mt-1 w-full p-1 shadow-lg"
              style={{ borderRadius: 'var(--app-radius)', border: '1px solid var(--structure)', background: 'var(--color-bg-secondary)' }}
            >
              <div className="text-[10px] uppercase tracking-wider text-text-muted px-2 py-1 flex items-center gap-1"><Clock size={11} /> Recent</div>
              {searchHistory.map((h) => (
                <button
                  key={h}
                  onMouseDown={() => runSearch(h)}
                  className="block w-full text-left px-2 py-1 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-tertiary"
                  style={{ borderRadius: 'var(--app-radius)' }}
                >
                  {h}
                </button>
              ))}
            </div>
          )}
        </div>,
      )}

      {/* ─── Feature 20: A–Z jump bar ─── */}
      {card(
        'A–Z Jump Bar',
        'Filter the list to clients whose name starts with a chosen letter.',
        <div className="flex flex-wrap gap-1">
          {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((L) => (
            <button
              key={L}
              onClick={() => setF('letter', filters.letter === L ? '' : L)}
              className="w-6 h-6 text-[11px] font-bold transition-colors"
              style={{
                borderRadius: 'var(--app-radius)',
                border: '1px solid ' + (filters.letter === L ? 'var(--accent-primary)' : 'var(--hairline)'),
                color: filters.letter === L ? 'var(--accent-primary)' : 'var(--color-text-muted)',
              }}
            >
              {L}
            </button>
          ))}
        </div>,
      )}

      {/* ─── Features 1, 24: balance threshold + hide zero ─── */}
      {card(
        'Outstanding Balance Filter',
        'Keep only clients whose unpaid invoice total clears a threshold; optionally hide zero-balance accounts.',
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <input
              type="range" min={0} max={50000} step={500}
              value={filters.minBalance}
              onChange={(e) => setF('minBalance', Number(e.target.value))}
              className="flex-1"
              style={{ accentColor: 'var(--accent-primary)' }}
            />
            <span className="font-mono text-sm text-text-primary w-28 text-right">≥ {formatCurrency(filters.minBalance)}</span>
          </div>
          <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
            <input type="checkbox" checked={filters.hideZeroBalance} onChange={(e) => setF('hideZeroBalance', e.target.checked)} style={{ accentColor: 'var(--accent-primary)' }} />
            Hide clients with zero outstanding balance (collections focus)
          </label>
        </div>,
      )}

      {/* ─── Features 2, 7: overdue + never-billed ─── */}
      {card(
        'Invoice Status Filters',
        'Surface clients with overdue invoices or never-billed accounts.',
        <div className="flex flex-wrap gap-1.5">
          {chip('Has Overdue Invoices', filters.overdueOnly, () => setF('overdueOnly', !filters.overdueOnly))}
          {chip('Never Billed', filters.neverBilledOnly, () => setF('neverBilledOnly', !filters.neverBilledOnly))}
        </div>,
      )}

      {/* ─── Feature 8: inactive-since-N-days + bulk action ─── */}
      {card(
        'Dormant Account Filter',
        'Clients with no invoice in N days (or never billed). Optionally bulk-mark them inactive.',
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <input
              type="range" min={0} max={365} step={15}
              value={filters.inactiveDays}
              onChange={(e) => setF('inactiveDays', Number(e.target.value))}
              className="flex-1"
              style={{ accentColor: 'var(--accent-primary)' }}
            />
            <span className="font-mono text-sm text-text-primary w-24 text-right">
              {filters.inactiveDays === 0 ? 'Off' : `≥ ${filters.inactiveDays}d`}
            </span>
          </div>
          {filters.inactiveDays > 0 && (
            <button onClick={bulkSetInactive} className="block-btn text-xs inline-flex items-center gap-1.5">
              <Trash2 size={12} /> Mark {filtered.filter((c) => c.status !== 'inactive').length} dormant as inactive
            </button>
          )}
        </div>,
      )}

      {/* ─── Feature 5: type segmented control ─── */}
      {card(
        'Client Type',
        'Filter individuals vs companies with live counts.',
        <div className="inline-flex gap-1">
          {chip(`All (${clients.length})`, filters.type === 'all', () => setF('type', 'all'))}
          {chip(`Individual (${typeCounts.individual})`, filters.type === 'individual', () => setF('type', 'individual'))}
          {chip(`Company (${typeCounts.company})`, filters.type === 'company', () => setF('type', 'company'))}
        </div>,
      )}

      {/* ─── Feature 3: payment terms ─── */}
      {card(
        'Payment Terms',
        'Isolate Net-X clients by their default payment_terms.',
        <select className="block-select" style={{ width: 'auto', minWidth: '160px' }} value={filters.terms} onChange={(e) => setF('terms', e.target.value)}>
          <option value="all">All Terms</option>
          {PAYMENT_TERMS.map((t) => <option key={t} value={String(t)}>{t === 0 ? 'Due on receipt (Net 0)' : `Net ${t}`}</option>)}
        </select>,
      )}

      {/* ─── Feature 4: geographic filters ─── */}
      {card(
        'Geographic Filters',
        'Dependent state / country selects built from your client records.',
        <div className="flex flex-wrap gap-2">
          <select className="block-select" style={{ width: 'auto', minWidth: '140px' }} value={filters.state} onChange={(e) => setF('state', e.target.value)}>
            <option value="all">All States</option>
            {states.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="block-select" style={{ width: 'auto', minWidth: '140px' }} value={filters.country} onChange={(e) => setF('country', e.target.value)}>
            <option value="all">All Countries</option>
            {countries.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {(filters.state !== 'all' || filters.country !== 'all') && (
            <span className="inline-flex items-center gap-1 text-[11px] text-text-muted"><MapPin size={12} /> {filtered.length} match</span>
          )}
        </div>,
      )}

      {/* ─── Feature 23: risk rating with legend ─── */}
      {card(
        'Risk Rating Filter',
        'Filter on the custom_fields risk_rating with a color legend.',
        <div className="space-y-2">
          <select className="block-select" style={{ width: 'auto', minWidth: '140px' }} value={filters.risk} onChange={(e) => setF('risk', e.target.value)}>
            <option value="all">All Risk Levels</option>
            {CLIENT_RISK.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <div className="flex flex-wrap gap-2">
            {CLIENT_RISK.options.map((o) => (
              <span key={o.value} className="inline-flex items-center gap-1 text-[11px]" style={{ color: o.color }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: o.color, display: 'inline-block' }} />
                {o.label}
              </span>
            ))}
          </div>
        </div>,
      )}

      {/* ─── Feature 6: data-quality chips ─── */}
      {card(
        'Data Quality (Missing Fields)',
        'Find incomplete records missing email, phone or tax ID.',
        <div className="flex flex-wrap gap-1.5">
          {(['email', 'phone', 'tax_id'] as const).map((field) =>
            chip(
              `No ${field === 'tax_id' ? 'Tax ID' : field}`,
              filters.missing.includes(field),
              () => setF('missing', filters.missing.includes(field) ? filters.missing.filter((x) => x !== field) : [...filters.missing, field]),
              field,
            ),
          )}
        </div>,
      )}

      {/* ─── Feature 9: tag multi-select ─── */}
      {card(
        'Tag Filter',
        'Multi-pick tags parsed from the clients.tags JSON array, with AND / OR mode.',
        allTags.length === 0 ? (
          <p className="text-[11px] text-text-muted">No tags found on any client.</p>
        ) : (
          <div className="space-y-2">
            <div className="inline-flex gap-1">
              {chip('Match Any (OR)', filters.tagMode === 'or', () => setF('tagMode', 'or'))}
              {chip('Match All (AND)', filters.tagMode === 'and', () => setF('tagMode', 'and'))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {allTags.map((t) =>
                chip(t, filters.tags.includes(t), () => setF('tags', filters.tags.includes(t) ? filters.tags.filter((x) => x !== t) : [...filters.tags, t]), 'tag-' + t),
              )}
            </div>
          </div>
        ),
      )}

      {/* ─── Feature 10: created-date range ─── */}
      {card(
        'Created Date Range',
        'Scope acquisitions to a window by clients.created_at.',
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" className="block-input" style={{ width: 'auto' }} value={filters.createdFrom} onChange={(e) => setF('createdFrom', e.target.value)} />
          <span className="text-text-muted text-xs">to</span>
          <input type="date" className="block-input" style={{ width: 'auto' }} value={filters.createdTo} onChange={(e) => setF('createdTo', e.target.value)} />
        </div>,
      )}

      {/* ─── Feature 22: prospect pipeline ─── */}
      {card(
        'Prospect Pipeline',
        'Show only prospects, newest leads first — for sales follow-up.',
        <div className="space-y-2">
          {chip('Prospects Only (newest first)', filters.status === 'prospect', () => {
            if (filters.status === 'prospect') { setF('status', 'all'); }
            else { setFilters((p) => ({ ...p, status: 'prospect' })); }
          })}
          {filters.status === 'prospect' && (
            <div className="text-xs text-text-muted">
              {[...filtered]
                .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
                .slice(0, 5)
                .map((c) => (
                  <div key={c.id} className="flex justify-between py-0.5">
                    <span className="text-text-secondary">{c.name}</span>
                    <span className="font-mono">{formatDate(c.created_at)}</span>
                  </div>
                ))}
            </div>
          )}
        </div>,
      )}

      {/* ─── Feature 18: group-by mode preview ─── */}
      {card(
        'Group-By Mode',
        'Group the filtered list under headers with per-group subtotals.',
        <div className="space-y-2">
          <div className="inline-flex gap-1 flex-wrap">
            {(['none', 'status', 'state', 'risk'] as const).map((g) =>
              chip(g === 'none' ? 'No Grouping' : g, groupBy === g, () => setGroupBy(g), g),
            )}
          </div>
          {grouped && (
            <div className="space-y-1">
              {grouped.map(([key, rows]) => {
                const sub = rows.reduce((s, c) => s + (aggMap.get(c.id)?.outstanding ?? 0), 0);
                return (
                  <div key={key} className="flex justify-between text-xs px-2 py-1" style={{ borderRadius: 'var(--app-radius)', background: 'var(--color-bg-tertiary)' }}>
                    <span className="text-text-secondary capitalize">{key} <span className="text-text-muted">({rows.length})</span></span>
                    <span className="font-mono text-accent-expense">{formatCurrency(sub)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>,
      )}

      {/* ─── Feature 16: column manager ─── */}
      {card(
        'Column Visibility',
        'Toggle list columns; preference persisted per user in localStorage.',
        <div className="flex flex-wrap gap-3">
          {ALL_COLUMNS.map((c) => (
            <label key={c} className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
              <input type="checkbox" checked={visibleCols[c]} onChange={() => toggleCol(c)} style={{ accentColor: 'var(--accent-primary)' }} />
              <span className="capitalize">{c}</span>
            </label>
          ))}
        </div>,
      )}

      {/* ─── Feature 17: favorites ─── */}
      {card(
        'Favorite Clients',
        'Star clients (saved locally) and pin them to the top of the list.',
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
            <input type="checkbox" checked={favoritesFirst} onChange={(e) => setFavoritesFirst(e.target.checked)} style={{ accentColor: 'var(--accent-primary)' }} />
            Favorites first ({favorites.length} starred)
          </label>
          <div className="max-h-32 overflow-y-auto space-y-0.5">
            {filtered.slice(0, 8).map((c) => (
              <div key={c.id} className="flex items-center gap-2 text-xs">
                <button onClick={() => toggleFavorite(c.id)} title="Toggle favorite">
                  <Star size={13} style={{ color: favorites.includes(c.id) ? 'var(--color-accent-warning)' : 'var(--color-text-muted)', fill: favorites.includes(c.id) ? 'var(--color-accent-warning)' : 'none' }} />
                </button>
                <span className="text-text-secondary truncate">{c.name}</span>
              </div>
            ))}
            {filtered.length === 0 && <p className="text-[11px] text-text-muted">No clients in current view.</p>}
          </div>
        </div>,
      )}

      {/* ─── Features 11 & 12: saved views ─── */}
      {card(
        'Saved Views',
        'Persist the current filter combo as a named view; mark one as default to auto-apply on load.',
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              className="block-input flex-1"
              placeholder="View name…"
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveView(); }}
            />
            <button onClick={saveView} disabled={!viewName.trim()} className="block-btn-primary text-xs inline-flex items-center gap-1.5">
              <Save size={12} /> Save
            </button>
          </div>
          {views.length === 0 ? (
            <p className="text-[11px] text-text-muted">No saved views yet.</p>
          ) : (
            <div className="space-y-1">
              {views.map((v) => (
                <div key={v.id} className="flex items-center gap-2 text-xs px-2 py-1" style={{ borderRadius: 'var(--app-radius)', border: '1px solid var(--hairline)' }}>
                  <button onClick={() => applyView(v)} className="flex-1 text-left text-text-secondary hover:text-text-primary truncate">{v.name}</button>
                  {Number(v.is_default) === 1 && <span className="block-badge block-badge-income text-[9px]">Default</span>}
                  <button onClick={() => makeDefaultView(v)} title="Set as default" className="text-text-muted hover:text-accent-warning">
                    <Star size={12} style={{ fill: Number(v.is_default) === 1 ? 'var(--color-accent-warning)' : 'none' }} />
                  </button>
                  <button onClick={() => deleteView(v)} title="Delete view" className="text-text-muted hover:text-accent-expense"><Trash2 size={12} /></button>
                </div>
              ))}
            </div>
          )}
        </div>,
      )}

      {/* ─── Export / copy actions over the filtered set ─── */}
      {card(
        'Export & Outreach',
        'Export the filtered clients to CSV or copy their emails to the clipboard.',
        <div className="flex flex-wrap gap-2">
          <button onClick={exportCSV} className="block-btn text-xs inline-flex items-center gap-1.5">
            <Download size={12} /> Export {filtered.length} to CSV
          </button>
          <button onClick={copyEmails} className="block-btn text-xs inline-flex items-center gap-1.5">
            {copied ? <Check size={12} className="text-accent-income" /> : <Copy size={12} />}
            {copied ? 'Copied!' : 'Copy Emails'}
          </button>
        </div>,
      )}

      {/* ─── Compact result preview (uses column-visibility + favorites + status badge) ─── */}
      {card(
        'Filtered Result Preview',
        'A live slice of the matching clients honoring your column and sort settings.',
        loading ? (
          <p className="text-[11px] text-text-muted">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-[11px] text-text-muted">No clients match the current filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="block-table">
              <thead>
                <tr>
                  <th style={{ width: 28 }}><Star size={11} /></th>
                  <th>Name</th>
                  <th>Status</th>
                  {visibleCols.terms && <th>Terms</th>}
                  {visibleCols.risk && <th>Risk</th>}
                  {visibleCols.balance && <th className="text-right">Outstanding</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 12).map((c) => {
                  const agg = aggMap.get(c.id);
                  const risk = parseRisk(c.custom_fields);
                  const st = formatStatus(c.status);
                  return (
                    <tr key={c.id}>
                      <td>
                        <button onClick={() => toggleFavorite(c.id)}>
                          <Star size={12} style={{ color: favorites.includes(c.id) ? 'var(--color-accent-warning)' : 'var(--color-text-muted)', fill: favorites.includes(c.id) ? 'var(--color-accent-warning)' : 'none' }} />
                        </button>
                      </td>
                      <td className="text-text-primary font-medium truncate max-w-[180px]">{c.name}</td>
                      <td><span className={st.className}>{st.label}</span></td>
                      {visibleCols.terms && <td className="font-mono text-xs text-text-secondary">{c.payment_terms != null ? `Net ${c.payment_terms}` : '—'}</td>}
                      {visibleCols.risk && <td className="text-xs capitalize text-text-secondary">{humanizeLabel(risk) || '—'}</td>}
                      {visibleCols.balance && <td className="text-right font-mono text-xs text-accent-expense">{formatCurrency(agg?.outstanding ?? 0)}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length > 12 && <p className="text-[10px] text-text-muted mt-1">…and {filtered.length - 12} more.</p>}
          </div>
        ),
      )}

      {/* Decorative inline icons referenced to keep imports live */}
      <div className="hidden"><Filter size={1} /><TagIcon size={1} /></div>
    </div>
  );
};

export default ClientsUpgradesPart1;
