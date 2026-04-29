import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Boxes, Plus, ChevronLeft, BarChart2, List, Calendar,
  AlertCircle, RefreshCw, Edit2, Trash2, Eye, TrendingDown,
  Hash, MapPin, Tag, DollarSign, Clock, CheckCircle, XCircle,
  LayoutDashboard, FileText, Image, Shield, Printer, AlertTriangle, Layers,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import api from '../../lib/api';
import { formatCurrency, roundCents } from '../../lib/format';
import { useCompanyStore } from '../../stores/companyStore';
import { useAppStore } from '../../stores/appStore';
import ErrorBanner from '../../components/ErrorBanner';
import RelatedPanel from '../../components/RelatedPanel';
import EntityTimeline from '../../components/EntityTimeline';
import {
  ASSET_CATEGORY, ASSET_CONDITION,
  ClassificationBadge, ClassificationSelect,
} from '../../lib/classifications';

// ─── Types ───────────────────────────────────────────────
interface FixedAsset {
  id: string;
  company_id: string;
  name: string;
  asset_code: string;
  category: 'equipment' | 'vehicle' | 'building' | 'furniture' | 'software' | 'other';
  description: string;
  purchase_date: string;
  purchase_price: number;
  salvage_value: number;
  useful_life_years: number;
  depreciation_method: 'straight_line' | 'double_declining' | 'sum_of_years_digits';
  current_book_value: number;
  accumulated_depreciation: number;
  status: 'active' | 'disposed' | 'fully_depreciated';
  serial_number: string;
  location: string;
  notes: string;
  asset_account_id: string;
  depreciation_account_id: string;
  accumulated_depreciation_account_id: string;
  created_at: string;
}

interface DepreciationEntry {
  id: string;
  asset_id: string;
  period_date: string;
  period_label: string;
  depreciation_amount: number;
  accumulated_depreciation: number;
  book_value: number;
}

interface ScheduleEntry {
  period: number;
  period_label: string;
  period_date: string;
  depreciation_amount: number;
  accumulated_depreciation: number;
  book_value: number;
}

interface Account {
  id: string;
  name: string;
  code: string;
  type: string;
}

// ─── Helpers ─────────────────────────────────────────────
// Route every dollar render through the shared formatter (handles NaN/Infinity).
const fmt = { format: (v: number | string | null | undefined) => formatCurrency(v) };

// Alphabetical A→Z by display label (Building, Equipment, Furniture, Other, Software, Vehicle)
const CATEGORIES = ['building', 'equipment', 'furniture', 'other', 'software', 'vehicle'] as const;
// Alphabetical A→Z by display label
const METHODS = [
  { value: 'double_declining', label: 'Double Declining Balance' },
  { value: 'straight_line', label: 'Straight Line' },
  { value: 'sum_of_years_digits', label: 'Sum of Years Digits' },
] as const;

const STATUS_COLORS: Record<string, string> = {
  active: 'block-badge-income',
  disposed: 'block-badge-expense',
  fully_depreciated: 'block-badge-blue',
};

const CATEGORY_LABELS: Record<string, string> = {
  equipment: 'Equipment',
  vehicle: 'Vehicle',
  building: 'Building',
  furniture: 'Furniture',
  software: 'Software',
  other: 'Other',
};

function calcAnnualDepreciation(
  purchasePrice: number,
  salvageValue: number,
  usefulLifeYears: number,
  method: string
): number {
  if (!purchasePrice || !usefulLifeYears || usefulLifeYears <= 0) return 0;
  const depreciable = Math.max(0, purchasePrice - salvageValue);
  if (method === 'straight_line') return roundCents(depreciable / usefulLifeYears);
  if (method === 'double_declining') {
    // Year 1 only — full schedule (with SL crossover and salvage floor) lives
    // in the main-process `assets:schedule` handler. Cap at depreciable so we
    // never preview a year-1 figure that breaches salvage value.
    const rate = 2 / usefulLifeYears;
    return roundCents(Math.min(purchasePrice * rate, depreciable));
  }
  if (method === 'sum_of_years_digits') {
    const syd = (usefulLifeYears * (usefulLifeYears + 1)) / 2;
    return roundCents((depreciable * usefulLifeYears) / syd);
  }
  return roundCents(depreciable / usefulLifeYears);
}

// ─── View type ───────────────────────────────────────────
type View =
  | { type: 'list' }
  | { type: 'new' }
  | { type: 'edit'; assetId: string }
  | { type: 'detail'; assetId: string };

// ─── Toast ───────────────────────────────────────────────
interface Toast { id: number; msg: string; ok: boolean }
let toastId = 0;

// ═══════════════════════════════════════════════════════════
// ASSET LIST
// ═══════════════════════════════════════════════════════════
interface AssetListProps {
  onNew: () => void;
  onView: (id: string) => void;
  onEdit: (id: string) => void;
}

const AssetList: React.FC<AssetListProps> = ({ onNew, onView, onEdit }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [assets, setAssets] = useState<FixedAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningDep, setRunningDep] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [toast, setToast] = useState<Toast | null>(null);
  const [loadError, setLoadError] = useState('');
  const [activeTab, setActiveTab] = useState<'dashboard' | 'list'>('dashboard');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [upcomingDep, setUpcomingDep] = useState<{ month: string; total: number }[]>([]);
  const [section179Total, setSection179Total] = useState<number>(0);
  const [bonusTotal, setBonusTotal] = useState<number>(0);
  const [warrantyAlerts, setWarrantyAlerts] = useState<any[]>([]);
  // 2026 limits
  const SECTION_179_CAP_2026 = 1_160_000;
  const BONUS_DEPRECIATION_RATE_2026 = 0.4;

  const showToast = (msg: string, ok = true) => {
    const t = { id: ++toastId, msg, ok };
    setToast(t);
    setTimeout(() => setToast((c) => (c?.id === t.id ? null : c)), 4000);
  };

  const load = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    setLoadError('');
    try {
      const rows = await api.query('fixed_assets', { company_id: activeCompany.id });
      setAssets(rows ?? []);
    } catch (err: any) {
      console.error('Failed to load fixed assets:', err);
      setLoadError(err?.message || 'Failed to load fixed assets');
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }, [activeCompany]);

  useEffect(() => { load(); }, [load]);

  // Load dashboard-specific data
  useEffect(() => {
    if (!activeCompany) return;
    let cancelled = false;
    const loadDash = async () => {
      // Upcoming depreciation (next 12 months)
      try {
        const rows = await api.rawQuery(
          `SELECT strftime('%Y-%m', period_date) AS month, COALESCE(SUM(depreciation_amount), 0) AS total
             FROM asset_depreciation_entries e
             JOIN fixed_assets a ON e.asset_id = a.id
            WHERE a.company_id = ?
              AND date(period_date) >= date('now')
              AND date(period_date) <= date('now', '+12 months')
            GROUP BY month
            ORDER BY month`,
          [activeCompany.id]
        ).catch(() => []);
        if (!cancelled) {
          setUpcomingDep(Array.isArray(rows) ? rows.map((r: any) => ({ month: r.month, total: Number(r.total) || 0 })) : []);
        }
      } catch {}

      // Section 179 sum (try column - gracefully fallback)
      try {
        const yearStart = `${new Date().getFullYear()}-01-01`;
        const rows = await api.rawQuery(
          `SELECT COALESCE(SUM(section_179_amount), 0) AS total
             FROM fixed_assets WHERE company_id = ? AND date(purchase_date) >= ?`,
          [activeCompany.id, yearStart]
        ).catch(() => null);
        if (!cancelled && Array.isArray(rows) && rows[0]) setSection179Total(Number(rows[0].total) || 0);
      } catch { /* column may not exist */ }

      // Bonus depreciation eligibility sum (try column)
      try {
        const yearStart = `${new Date().getFullYear()}-01-01`;
        const rows = await api.rawQuery(
          `SELECT COALESCE(SUM(bonus_depreciation_amount), 0) AS total
             FROM fixed_assets WHERE company_id = ? AND date(purchase_date) >= ?`,
          [activeCompany.id, yearStart]
        ).catch(() => null);
        if (!cancelled && Array.isArray(rows) && rows[0]) setBonusTotal(Number(rows[0].total) || 0);
      } catch { /* column may not exist */ }

      // Warranty expiration (try column - gracefully fallback)
      try {
        const rows = await api.rawQuery(
          `SELECT id, name, asset_code, warranty_expiration
             FROM fixed_assets
            WHERE company_id = ?
              AND warranty_expiration IS NOT NULL
              AND date(warranty_expiration) <= date('now', '+90 days')
              AND date(warranty_expiration) >= date('now')
            ORDER BY warranty_expiration ASC
            LIMIT 10`,
          [activeCompany.id]
        ).catch(() => []);
        if (!cancelled) setWarrantyAlerts(Array.isArray(rows) ? rows : []);
      } catch { /* column may not exist */ }
    };
    loadDash();
    return () => { cancelled = true; };
  }, [activeCompany, assets.length]);

  const filtered = useMemo(() => {
    return assets.filter((a) => {
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      if (categoryFilter !== 'all' && a.category !== categoryFilter) return false;
      return true;
    });
  }, [assets, statusFilter, categoryFilter]);

  const stats = useMemo(() => {
    const year = new Date().getFullYear();
    return {
      count: assets.length,
      totalCost: assets.reduce((s, a) => s + (a.purchase_price || 0), 0),
      // Inner expression already covers the nullish case via (price - accum)
      // → outer ?? was unreachable. One nullish-fallback chain is enough.
      totalBook: assets.reduce((s, a) => s + (a.current_book_value ?? ((a.purchase_price || 0) - (a.accumulated_depreciation || 0))), 0),
      totalAccDep: assets.reduce((s, a) => s + (a.accumulated_depreciation || 0), 0),
      acquiredYear: assets.filter((a) => a.purchase_date && new Date(a.purchase_date).getFullYear() === year).length,
      disposedYear: assets.filter((a) => a.status === 'disposed' && (a as any).disposal_date && new Date((a as any).disposal_date).getFullYear() === year).length,
    };
  }, [assets]);

  // Category breakdown
  const categoryStats = useMemo(() => {
    const map: Record<string, { count: number; book: number }> = {};
    for (const a of assets) {
      const k = a.category || 'other';
      if (!map[k]) map[k] = { count: 0, book: 0 };
      map[k].count += 1;
      map[k].book += a.current_book_value ?? ((a.purchase_price || 0) - (a.accumulated_depreciation || 0));
    }
    return Object.entries(map).map(([k, v]) => ({ category: k, ...v }))
      .sort((a, b) => b.book - a.book);
  }, [assets]);

  // Disposed assets with gain/loss
  const disposedAssets = useMemo(() => {
    return assets.filter((a) => a.status === 'disposed').map((a) => {
      const proceeds = Number((a as any).disposal_amount) || 0;
      const book = a.current_book_value ?? ((a.purchase_price || 0) - (a.accumulated_depreciation || 0));
      const gainLoss = proceeds - book;
      return { ...a, proceeds, book, gainLoss };
    });
  }, [assets]);

  // Aging assets (5+ years)
  const agingAssets = useMemo(() => {
    const fiveYearsAgo = Date.now() - 5 * 365 * 24 * 60 * 60 * 1000;
    return assets.filter((a) => a.purchase_date && new Date(a.purchase_date).getTime() < fiveYearsAgo);
  }, [assets]);

  // Selection helpers
  const toggleAssetSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleAllAssets = () => {
    if (selectedIds.size === filtered.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((a) => a.id)));
  };

  const handleBulkRunDep = async () => {
    if (selectedIds.size === 0) return;
    try {
      const periodDate = format(new Date(), 'yyyy-MM-01');
      let processed = 0;
      for (const id of selectedIds) {
        try {
          await window.electronAPI.invoke('assets:run-depreciation', { periodDate, assetId: id });
          processed += 1;
        } catch { /* ignore individual failure */ }
      }
      showToast(`Depreciation run for ${processed} of ${selectedIds.size} asset(s).`, processed > 0);
      setSelectedIds(new Set());
      load();
    } catch {
      showToast('Bulk depreciation failed.', false);
    }
  };

  const handlePrintRegister = async () => {
    const html = `
      <html><head><title>Fixed Asset Register</title>
      <style>
        body { font-family: -apple-system, system-ui, sans-serif; padding: 20px; color: #111; }
        h1 { font-size: 20px; margin-bottom: 4px; }
        .sub { color: #666; font-size: 12px; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th, td { padding: 6px 8px; border-bottom: 1px solid #ddd; text-align: left; }
        th { background: #f5f5f5; font-weight: 700; text-transform: uppercase; font-size: 10px; }
        td.num, th.num { text-align: right; font-family: ui-monospace, Menlo, monospace; }
        tfoot td { font-weight: 700; border-top: 2px solid #333; }
      </style></head><body>
      <h1>Fixed Asset Register</h1>
      <div class="sub">${activeCompany?.name || ''} · Generated ${new Date().toLocaleDateString()}</div>
      <table>
        <thead><tr>
          <th>Code</th><th>Name</th><th>Category</th><th>Purchase Date</th>
          <th class="num">Cost</th><th class="num">Acc. Dep.</th><th class="num">Book Value</th>
          <th>Status</th>
        </tr></thead>
        <tbody>
          ${assets.map((a) => `<tr>
            <td>${a.asset_code || ''}</td>
            <td>${a.name}</td>
            <td>${CATEGORY_LABELS[a.category] || a.category}</td>
            <td>${a.purchase_date || ''}</td>
            <td class="num">${formatCurrency(a.purchase_price)}</td>
            <td class="num">${formatCurrency(a.accumulated_depreciation || 0)}</td>
            <td class="num">${formatCurrency(a.current_book_value ?? ((a.purchase_price || 0) - (a.accumulated_depreciation || 0)))}</td>
            <td>${a.status}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot><tr>
          <td colspan="4">Totals</td>
          <td class="num">${formatCurrency(stats.totalCost)}</td>
          <td class="num">${formatCurrency(stats.totalAccDep)}</td>
          <td class="num">${formatCurrency(stats.totalBook)}</td>
          <td></td>
        </tr></tfoot>
      </table>
      </body></html>
    `;
    try { await api.printPreview(html, 'Fixed Asset Register'); } catch (err) { console.error(err); }
  };

  const handlePrintTags = async () => {
    const targets = selectedIds.size > 0 ? assets.filter((a) => selectedIds.has(a.id)) : assets;
    const html = `
      <html><head><title>Asset Tags</title>
      <style>
        body { font-family: -apple-system, system-ui, sans-serif; padding: 12px; color: #111; }
        .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
        .tag { border: 2px solid #333; padding: 12px; text-align: center; page-break-inside: avoid; }
        .code { font-family: ui-monospace, Menlo, monospace; font-size: 14px; font-weight: 700; margin-bottom: 4px; }
        .name { font-size: 11px; margin-bottom: 6px; }
        .barcode { height: 36px; background: repeating-linear-gradient(90deg, #000 0 2px, #fff 2px 4px, #000 4px 5px, #fff 5px 8px); margin-bottom: 4px; }
        .meta { font-size: 9px; color: #666; }
      </style></head><body>
      <div class="grid">
        ${targets.map((a) => `<div class="tag">
          <div class="code">${a.asset_code || a.id.slice(0, 8)}</div>
          <div class="barcode"></div>
          <div class="name">${a.name}</div>
          <div class="meta">${CATEGORY_LABELS[a.category] || a.category}${a.location ? ' · ' + a.location : ''}</div>
        </div>`).join('')}
      </div>
      </body></html>
    `;
    try { await api.printPreview(html, 'Asset Tags'); } catch (err) { console.error(err); }
  };

  const handleRunDep = async () => {
    if (!activeCompany) return;
    setRunningDep(true);
    try {
      const periodDate = format(new Date(), 'yyyy-MM-01');
      const result = await window.electronAPI.invoke('assets:run-depreciation', { periodDate });
      showToast(`Depreciation processed for ${result?.processed ?? 0} asset(s).`, true);
      load();
    } catch {
      showToast('Failed to run depreciation.', false);
    } finally {
      setRunningDep(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this asset? This cannot be undone.')) return;
    try {
      await api.remove('fixed_assets', id);
      showToast('Asset deleted.', true);
      load();
    } catch {
      showToast('Delete failed.', false);
    }
  };

  const STATUS_TABS = ['all', 'active', 'fully_depreciated', 'disposed'];

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      {loadError && <ErrorBanner message={loadError} title="Failed to load fixed assets" onDismiss={() => setLoadError('')} />}
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 text-sm font-semibold border ${
            toast.ok ? 'bg-bg-elevated border-accent-income text-accent-income' : 'bg-bg-elevated border-accent-expense text-accent-expense'
          }`}
          style={{ borderRadius: '6px' }}
        >
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 flex items-center justify-center bg-bg-tertiary border border-border-primary" style={{ borderRadius: '6px' }}>
            <Boxes size={18} className="text-accent-blue" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-text-primary">Fixed Assets</h1>
            <p className="text-xs text-text-muted mt-0.5">Track, depreciate, and manage business assets.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handlePrintRegister}
            className="block-btn flex items-center gap-2 px-3 py-1.5 text-xs"
          >
            <FileText size={13} /> Print Register
          </button>
          <button
            onClick={handlePrintTags}
            className="block-btn flex items-center gap-2 px-3 py-1.5 text-xs"
          >
            <Printer size={13} /> Asset Tags
          </button>
          <button
            onClick={handleRunDep}
            disabled={runningDep}
            className="block-btn flex items-center gap-2 px-3 py-1.5 text-xs"
          >
            <RefreshCw size={13} className={runningDep ? 'animate-spin' : ''} />
            {runningDep ? 'Running...' : 'Run Monthly Depreciation'}
          </button>
          <button
            onClick={onNew}
            className="block-btn-primary flex items-center gap-2 px-3 py-1.5 text-xs"
          >
            <Plus size={13} />
            New Asset
          </button>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex border-b border-border-primary">
        {([
          ['dashboard', 'Dashboard', <LayoutDashboard size={13} key="d" />],
          ['list', 'Asset List', <List size={13} key="l" />],
        ] as const).map(([key, label, icon]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key as any)}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold transition-colors border-b-2 -mb-px ${
              activeTab === key
                ? 'border-accent-blue text-accent-blue'
                : 'border-transparent text-text-muted hover:text-text-primary'
            }`}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {/* Dashboard Tab */}
      {activeTab === 'dashboard' && (
        <div className="space-y-5">
          {/* 6 KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'Total Assets', value: String(stats.count), icon: <Boxes size={14} />, color: 'text-accent-blue' },
              { label: 'Cost Basis', value: fmt.format(stats.totalCost), icon: <DollarSign size={14} />, color: 'text-text-primary' },
              { label: 'Acc. Dep.', value: fmt.format(stats.totalAccDep), icon: <TrendingDown size={14} />, color: 'text-accent-expense' },
              { label: 'Net Book Value', value: fmt.format(stats.totalBook), icon: <BarChart2 size={14} />, color: 'text-accent-income' },
              { label: 'Acquired YTD', value: String(stats.acquiredYear), icon: <Plus size={14} />, color: 'text-accent-blue' },
              { label: 'Disposed YTD', value: String(stats.disposedYear), icon: <XCircle size={14} />, color: stats.disposedYear > 0 ? 'text-accent-expense' : 'text-text-muted' },
            ].map((k) => (
              <div key={k.label} className="block-card p-3" style={{ borderRadius: '6px' }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={k.color}>{k.icon}</span>
                  <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">{k.label}</span>
                </div>
                <div className="text-base font-bold text-text-primary font-mono">{k.value}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Upcoming Depreciation */}
            <div className="block-card p-4" style={{ borderRadius: '6px' }}>
              <h3 className="text-sm font-bold text-text-primary mb-3 flex items-center gap-2">
                <Calendar size={14} className="text-accent-blue" /> Depreciation Schedule (Next 12 Months)
              </h3>
              {upcomingDep.length === 0 ? (
                <p className="text-xs text-text-muted">No depreciation scheduled.</p>
              ) : (() => {
                const max = Math.max(...upcomingDep.map((u) => u.total), 1);
                return (
                  <div className="space-y-2">
                    {upcomingDep.map((u) => (
                      <div key={u.month}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="text-text-secondary font-mono">{u.month}</span>
                          <span className="font-mono text-text-muted">{fmt.format(u.total)}</span>
                        </div>
                        <div className="w-full h-2 bg-bg-tertiary overflow-hidden" style={{ borderRadius: '6px' }}>
                          <div className="h-full bg-accent-expense transition-all" style={{ width: `${(u.total / max) * 100}%`, borderRadius: '6px' }} />
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            {/* Assets by Category */}
            <div className="block-card p-4" style={{ borderRadius: '6px' }}>
              <h3 className="text-sm font-bold text-text-primary mb-3 flex items-center gap-2">
                <Layers size={14} className="text-accent-blue" /> Assets by Category
              </h3>
              {categoryStats.length === 0 ? (
                <p className="text-xs text-text-muted">No assets.</p>
              ) : (
                <table className="block-table w-full text-xs">
                  <thead><tr><th>Category</th><th className="text-right">Count</th><th className="text-right">Book Value</th></tr></thead>
                  <tbody>
                    {categoryStats.map((c) => (
                      <tr key={c.category}>
                        <td className="text-text-primary">{CATEGORY_LABELS[c.category] || c.category}</td>
                        <td className="text-right font-mono">{c.count}</td>
                        <td className="text-right font-mono text-text-secondary">{fmt.format(c.book)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Disposal Tracker */}
            <div className="block-card p-4" style={{ borderRadius: '6px' }}>
              <h3 className="text-sm font-bold text-text-primary mb-3 flex items-center gap-2">
                <XCircle size={14} className="text-accent-expense" /> Disposal Tracker
              </h3>
              {disposedAssets.length === 0 ? (
                <p className="text-xs text-text-muted">No disposed assets.</p>
              ) : (
                <table className="block-table w-full text-xs">
                  <thead><tr><th>Asset</th><th className="text-right">Proceeds</th><th className="text-right">Book</th><th className="text-right">Gain/Loss</th></tr></thead>
                  <tbody>
                    {disposedAssets.map((a) => (
                      <tr key={a.id}>
                        <td className="text-text-primary truncate max-w-[160px]">{a.name}</td>
                        <td className="text-right font-mono text-text-secondary">{fmt.format(a.proceeds)}</td>
                        <td className="text-right font-mono text-text-secondary">{fmt.format(a.book)}</td>
                        <td className={`text-right font-mono font-bold ${a.gainLoss >= 0 ? 'text-accent-income' : 'text-accent-expense'}`}>
                          {fmt.format(a.gainLoss)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Aging Assets */}
            <div className="block-card p-4" style={{ borderRadius: '6px' }}>
              <h3 className="text-sm font-bold text-text-primary mb-3 flex items-center gap-2">
                <Clock size={14} className="text-accent-warning" /> Aging Assets (5+ Years)
              </h3>
              {agingAssets.length === 0 ? (
                <p className="text-xs text-text-muted">No aging assets.</p>
              ) : (
                <table className="block-table w-full text-xs">
                  <thead><tr><th>Asset</th><th>Purchased</th><th className="text-right">Book Value</th><th>Status</th></tr></thead>
                  <tbody>
                    {agingAssets.slice(0, 10).map((a) => {
                      const book = a.current_book_value ?? ((a.purchase_price || 0) - (a.accumulated_depreciation || 0));
                      const fullyDep = book <= (a.salvage_value || 0);
                      return (
                        <tr key={a.id}>
                          <td className="text-text-primary truncate max-w-[160px]">{a.name}</td>
                          <td className="text-text-muted font-mono text-[10px]">{a.purchase_date?.slice(0, 10) || '—'}</td>
                          <td className="text-right font-mono text-text-secondary">{fmt.format(book)}</td>
                          <td>
                            <span className={`block-badge ${fullyDep ? 'block-badge-blue' : 'block-badge-warning'} text-[10px]`}>
                              {fullyDep ? 'Fully Dep.' : 'Active'}
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

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Section 179 Tracker */}
            <div className="block-card p-4" style={{ borderRadius: '6px' }}>
              <h3 className="text-sm font-bold text-text-primary mb-2 flex items-center gap-2">
                <Shield size={14} className="text-accent-blue" /> Section 179 (2026)
              </h3>
              <div className="text-2xl font-bold text-text-primary font-mono">{fmt.format(section179Total)}</div>
              <div className="text-xs text-text-muted mb-2">of {fmt.format(SECTION_179_CAP_2026)} cap</div>
              <div className="w-full h-2 bg-bg-tertiary overflow-hidden" style={{ borderRadius: '6px' }}>
                <div
                  className="h-full bg-accent-income transition-all"
                  style={{ width: `${Math.min((section179Total / SECTION_179_CAP_2026) * 100, 100)}%`, borderRadius: '6px' }}
                />
              </div>
              <p className="text-[10px] text-text-muted mt-2">
                {((section179Total / SECTION_179_CAP_2026) * 100).toFixed(1)}% used
              </p>
            </div>

            {/* Bonus Depreciation */}
            <div className="block-card p-4" style={{ borderRadius: '6px' }}>
              <h3 className="text-sm font-bold text-text-primary mb-2 flex items-center gap-2">
                <TrendingDown size={14} className="text-accent-expense" /> Bonus Depreciation (40%)
              </h3>
              <div className="text-2xl font-bold text-text-primary font-mono">{fmt.format(bonusTotal)}</div>
              <div className="text-xs text-text-muted">claimed in 2026</div>
              <p className="text-[10px] text-text-muted mt-2">
                2026 bonus rate: {(BONUS_DEPRECIATION_RATE_2026 * 100).toFixed(0)}% (phasing down).
              </p>
            </div>

            {/* Warranty Alerts */}
            <div className="block-card p-4" style={{ borderRadius: '6px' }}>
              <h3 className="text-sm font-bold text-text-primary mb-2 flex items-center gap-2">
                <AlertTriangle size={14} className="text-accent-warning" /> Warranty Expiring (90d)
              </h3>
              {warrantyAlerts.length === 0 ? (
                <p className="text-xs text-text-muted">No warranties expiring soon.</p>
              ) : (
                <div className="space-y-1">
                  {warrantyAlerts.map((w: any) => (
                    <div key={w.id} className="flex items-center justify-between text-xs py-1 border-b border-border-primary/40 last:border-b-0">
                      <span className="text-text-primary truncate max-w-[140px]">{w.name}</span>
                      <span className="text-accent-warning font-mono text-[10px]">{w.warranty_expiration?.slice(0, 10)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* List Tab Stats */}
      {activeTab === 'list' && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Total Assets', value: String(stats.count), icon: <Boxes size={16} /> },
            { label: 'Original Cost', value: fmt.format(stats.totalCost), icon: <DollarSign size={16} /> },
            { label: 'Book Value', value: fmt.format(stats.totalBook), icon: <TrendingDown size={16} /> },
            { label: 'Accumulated Dep.', value: fmt.format(stats.totalAccDep), icon: <BarChart2 size={16} /> },
          ].map((s) => (
            <div key={s.label} className="stat-card">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-text-muted">{s.icon}</span>
                <span className="stat-label">{s.label}</span>
              </div>
              <div className="stat-value">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* List Tab Content */}
      {activeTab === 'list' && (
      <>
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Status tabs */}
        <div className="flex border border-border-primary" style={{ borderRadius: '6px' }}>
          {STATUS_TABS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                statusFilter === s
                  ? 'bg-accent-blue text-white'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors'
              }`}
              style={{ borderRadius: '0px' }}
            >
              {s === 'all' ? 'All' : s === 'fully_depreciated' ? 'Fully Depreciated' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {/* Category dropdown */}
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="block-select text-xs px-2 py-1.5"
        >
          <option value="all">All Categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>
      </div>

      {/* Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="block-card p-3 flex items-center justify-between" style={{ borderRadius: '6px', borderColor: 'rgba(59,130,246,0.3)' }}>
          <span className="text-xs font-semibold text-text-primary">
            {selectedIds.size} asset{selectedIds.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-2">
            <button className="block-btn text-xs" onClick={toggleAllAssets}>
              {selectedIds.size === filtered.length ? 'Deselect All' : 'Select All'}
            </button>
            <button className="block-btn text-xs" onClick={handleBulkRunDep}>
              <RefreshCw size={11} className="inline mr-1" /> Bulk Run Depreciation
            </button>
            <button className="block-btn text-xs" onClick={handlePrintTags}>
              <Printer size={11} className="inline mr-1" /> Print Tags
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="block-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-text-muted text-sm">Loading assets...</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state py-16">
            <div className="empty-state-icon"><Boxes size={32} /></div>
            <p className="text-text-muted text-sm mt-2">
              {assets.length === 0 ? 'No assets yet.' : 'No assets match your filter.'}
            </p>
            {assets.length === 0 && (
              <button onClick={onNew} className="block-btn-primary mt-4 px-4 py-2 text-xs flex items-center gap-2 mx-auto">
                <Plus size={13} /> Add First Asset
              </button>
            )}
          </div>
        ) : (
          <table className="block-table w-full">
            <thead>
              <tr>
                <th className="w-8 text-center">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && selectedIds.size === filtered.length}
                    onChange={toggleAllAssets}
                    style={{ accentColor: '#3b82f6' }}
                  />
                </th>
                <th>Asset Code</th>
                <th>Name</th>
                <th>Category</th>
                <th>Condition</th>
                <th>Purchase Date</th>
                <th className="text-right">Original Cost</th>
                <th className="text-right">Acc. Dep.</th>
                <th className="text-right">Book Value</th>
                <th>Status</th>
                <th className="text-center">Photo</th>
                <th className="text-center">Insured</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => {
                const photoPath = (a as any).photo_path;
                const insurance = (a as any).insurance_policy || (a as any).insurance_coverage;
                return (
                <tr key={a.id} className="hover:bg-bg-hover cursor-pointer transition-colors" onClick={() => onView(a.id)}>
                  <td className="text-center" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(a.id)}
                      onChange={() => toggleAssetSelect(a.id)}
                      style={{ accentColor: '#3b82f6' }}
                    />
                  </td>
                  <td className="font-mono text-xs text-accent-blue">{a.asset_code}</td>
                  <td className="font-semibold text-text-primary truncate max-w-[200px]">{a.name}</td>
                  <td><ClassificationBadge def={ASSET_CATEGORY} value={a.category} /></td>
                  <td><ClassificationBadge def={ASSET_CONDITION} value={(a as any).condition} /></td>
                  <td className="text-text-secondary text-xs">
                    {a.purchase_date ? format(parseISO(a.purchase_date), 'MMM d, yyyy') : '—'}
                  </td>
                  <td className="text-right text-text-primary">{fmt.format(a.purchase_price)}</td>
                  <td className="text-right text-accent-expense">{fmt.format(a.accumulated_depreciation || 0)}</td>
                  <td className="text-right text-accent-income font-semibold">{fmt.format((a.current_book_value ?? ((a.purchase_price || 0) - (a.accumulated_depreciation || 0))))}</td>
                  <td>
                    <span className={`block-badge ${STATUS_COLORS[a.status] || 'block-badge'}`}>
                      {a.status === 'fully_depreciated' ? 'Fully Dep.' : a.status.charAt(0).toUpperCase() + a.status.slice(1)}
                    </span>
                  </td>
                  <td className="text-center">
                    {photoPath ? <Image size={13} className="text-accent-income inline" /> : <span className="text-text-muted">—</span>}
                  </td>
                  <td className="text-center">
                    {insurance ? <Shield size={13} className="text-accent-blue inline" /> : <span className="text-text-muted">—</span>}
                  </td>
                  <td className="cursor-pointer" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <button onClick={() => onView(a.id)} className="block-btn p-1.5" title="View">
                        <Eye size={13} />
                      </button>
                      <button onClick={() => onEdit(a.id)} className="block-btn p-1.5" title="Edit">
                        <Edit2 size={13} />
                      </button>
                      <button onClick={() => handleDelete(a.id)} className="block-btn p-1.5 text-accent-expense hover:text-accent-expense transition-colors" title="Delete">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      </>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
// ASSET FORM
// ═══════════════════════════════════════════════════════════
interface AssetFormProps {
  assetId?: string;
  onBack: () => void;
  onSaved: (id: string) => void;
}

const emptyForm = {
  name: '',
  asset_code: '',
  category: 'equipment' as FixedAsset['category'],
  description: '',
  purchase_date: format(new Date(), 'yyyy-MM-dd'),
  purchase_price: '',
  salvage_value: '',
  useful_life_years: '',
  depreciation_method: 'straight_line' as FixedAsset['depreciation_method'],
  serial_number: '',
  location: '',
  notes: '',
  asset_account_id: '',
  depreciation_account_id: '',
  accumulated_depreciation_account_id: '',
  condition: '',
};

const AssetForm: React.FC<AssetFormProps> = ({ assetId, onBack, onSaved }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [form, setForm] = useState(emptyForm);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!!assetId);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const init = async () => {
      if (!activeCompany) return;
      // Critical: asset data; accounts are optional (for dropdowns)
      const asset = assetId ? await api.get('fixed_assets', assetId) : null;

      // Non-critical — failures don't hide primary content
      api.query('accounts', { company_id: activeCompany.id })
        .then(r => setAccounts(Array.isArray(r) ? r : []))
        .catch(() => {});
      if (asset) {
        setForm({
          name: asset.name ?? '',
          asset_code: asset.asset_code ?? '',
          category: asset.category ?? 'equipment',
          description: asset.description ?? '',
          purchase_date: asset.purchase_date ?? format(new Date(), 'yyyy-MM-dd'),
          purchase_price: asset.purchase_price != null ? String(asset.purchase_price) : '',
          salvage_value: asset.salvage_value != null ? String(asset.salvage_value) : '',
          useful_life_years: asset.useful_life_years != null ? String(asset.useful_life_years) : '',
          depreciation_method: asset.depreciation_method ?? 'straight_line',
          serial_number: asset.serial_number ?? '',
          location: asset.location ?? '',
          notes: asset.notes ?? '',
          asset_account_id: asset.asset_account_id ?? '',
          depreciation_account_id: asset.depreciation_account_id ?? '',
          accumulated_depreciation_account_id: asset.accumulated_depreciation_account_id ?? '',
          condition: asset.condition ?? '',
        });
      } else {
        // Auto-generate asset code
        const code = await window.electronAPI.invoke('assets:next-code');
        setForm((f) => ({ ...f, asset_code: code ?? '' }));
      }
      setLoading(false);
    };
    init();
  }, [assetId, activeCompany]);

  const set = (k: string, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => { const n = { ...e }; delete n[k]; return n; });
  };

  const annualDep = useMemo(() => {
    const pp = parseFloat(form.purchase_price) || 0;
    const sv = parseFloat(form.salvage_value) || 0;
    const ul = parseFloat(form.useful_life_years) || 0;
    return calcAnnualDepreciation(pp, sv, ul, form.depreciation_method);
  }, [form.purchase_price, form.salvage_value, form.useful_life_years, form.depreciation_method]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Name is required.';
    if (!form.purchase_date) e.purchase_date = 'Purchase date is required.';
    if (!form.purchase_price || isNaN(parseFloat(form.purchase_price))) e.purchase_price = 'Valid price required.';
    if (!form.useful_life_years || isNaN(parseFloat(form.useful_life_years))) e.useful_life_years = 'Valid life required.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (saving) return;
    if (!validate() || !activeCompany) return;
    setSaving(true);
    try {
      const pp = parseFloat(form.purchase_price) || 0;
      const sv = parseFloat(form.salvage_value) || 0;
      const ul = parseFloat(form.useful_life_years) || 0;
      const data = {
        ...form,
        company_id: activeCompany.id,
        purchase_price: pp,
        salvage_value: sv,
        useful_life_years: ul,
        current_book_value: assetId ? undefined : pp,
        accumulated_depreciation: assetId ? undefined : 0,
        status: assetId ? undefined : 'active',
      };
      if (assetId) {
        delete data.current_book_value;
        delete data.accumulated_depreciation;
        delete data.status;
        await api.update('fixed_assets', assetId, data);
        onSaved(assetId);
      } else {
        const created = await api.create('fixed_assets', data);
        onSaved(created.id ?? assetId ?? '');
      }
    } catch (err: any) {
      // VISIBILITY: surface save-asset errors instead of swallowing
      console.error('Failed to save asset:', err);
      setErrors((prev) => ({ ...prev, _form: err?.message ?? String(err) }));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-text-muted text-sm">Loading...</div>;
  }

  const F = ({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) => (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">{label}</label>
      {children}
      {error && <p className="text-xs text-accent-expense">{error}</p>}
    </div>
  );

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="block-btn p-1.5">
          <ChevronLeft size={16} />
        </button>
        <div>
          <h1 className="text-lg font-bold text-text-primary">{assetId ? 'Edit Asset' : 'New Fixed Asset'}</h1>
          <p className="text-xs text-text-muted mt-0.5">Fill in asset details and depreciation settings.</p>
        </div>
      </div>

      {errors._form && (
        <ErrorBanner
          message={errors._form}
          title="Failed to save asset"
          onDismiss={() => setErrors((prev) => { const n = { ...prev }; delete n._form; return n; })}
        />
      )}

      <div className="grid grid-cols-2 gap-6">
        {/* Left column */}
        <div className="space-y-4">
          <div className="block-card p-4 space-y-4">
            <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider border-b border-border-primary pb-2">Asset Information</h3>
            <F label="Asset Code">
              <input
                className="block-input w-full font-mono text-xs"
                value={form.asset_code}
                onChange={(e) => set('asset_code', e.target.value)}
                placeholder="Auto-generated"
              />
            </F>
            <F label="Asset Name" error={errors.name}>
              <input
                className="block-input w-full"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="e.g. MacBook Pro 16-inch"
              />
            </F>
            <F label="Category">
              <select
                className="block-select w-full"
                value={form.category}
                onChange={(e) => set('category', e.target.value)}
              >
                {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </select>
            </F>
            <F label="Condition">
              <ClassificationSelect def={ASSET_CONDITION} value={form.condition} onChange={(v) => set('condition', v)} />
            </F>
            <F label="Description">
              <textarea
                className="block-input w-full resize-none"
                rows={2}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="Optional description..."
              />
            </F>
            <div className="grid grid-cols-2 gap-3">
              <F label="Serial Number">
                <input
                  className="block-input w-full"
                  value={form.serial_number}
                  onChange={(e) => set('serial_number', e.target.value)}
                />
              </F>
              <F label="Location">
                <input
                  className="block-input w-full"
                  value={form.location}
                  onChange={(e) => set('location', e.target.value)}
                />
              </F>
            </div>
            <F label="Notes">
              <textarea
                className="block-input w-full resize-none"
                rows={2}
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
            </F>
          </div>

          {/* GL Accounts */}
          <div className="block-card p-4 space-y-4">
            <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider border-b border-border-primary pb-2">GL Accounts</h3>
            {[
              { key: 'asset_account_id', label: 'Asset Account' },
              { key: 'depreciation_account_id', label: 'Depreciation Expense Account' },
              { key: 'accumulated_depreciation_account_id', label: 'Accumulated Depreciation Account' },
            ].map(({ key, label }) => (
              <F key={key} label={label}>
                <select
                  className="block-select w-full"
                  value={(form as any)[key]}
                  onChange={(e) => set(key, e.target.value)}
                >
                  <option value="">-- Select Account --</option>
                  {/* Group by account type — alphabetical headers, alphabetical accounts within */}
                  {(() => {
                    const TYPE_LABELS: Record<string, string> = {
                      asset: 'Assets', equity: 'Equity', expense: 'Expenses',
                      liability: 'Liabilities', revenue: 'Revenue',
                    };
                    const groups: Record<string, Account[]> = {};
                    const sorted = [...accounts].sort((a, b) =>
                      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
                    );
                    for (const a of sorted) {
                      const k = TYPE_LABELS[a.type] ?? 'Other';
                      (groups[k] ||= []).push(a);
                    }
                    return Object.keys(groups)
                      .sort((x, y) => x.localeCompare(y))
                      .map((label) => (
                        <optgroup key={label} label={label}>
                          {groups[label].map((a) => (
                            <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                          ))}
                        </optgroup>
                      ));
                  })()}
                </select>
              </F>
            ))}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          <div className="block-card p-4 space-y-4">
            <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider border-b border-border-primary pb-2">Acquisition & Valuation</h3>
            <F label="Purchase Date" error={errors.purchase_date}>
              <input
                type="date"
                className="block-input w-full"
                value={form.purchase_date}
                onChange={(e) => set('purchase_date', e.target.value)}
              />
            </F>
            <F label="Purchase Price ($)" error={errors.purchase_price}>
              <input
                type="number"
                className="block-input w-full"
                value={form.purchase_price}
                onChange={(e) => set('purchase_price', e.target.value)}
                min="0"
                step="0.01"
                placeholder="0.00"
              />
            </F>
            <F label="Salvage Value ($)">
              <input
                type="number"
                className="block-input w-full"
                value={form.salvage_value}
                onChange={(e) => set('salvage_value', e.target.value)}
                min="0"
                step="0.01"
                placeholder="0.00"
              />
            </F>
          </div>

          <div className="block-card p-4 space-y-4">
            <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider border-b border-border-primary pb-2">Depreciation Settings</h3>
            <F label="Useful Life (Years)" error={errors.useful_life_years}>
              <input
                type="number"
                className="block-input w-full"
                value={form.useful_life_years}
                onChange={(e) => set('useful_life_years', e.target.value)}
                min="1"
                step="1"
                placeholder="5"
              />
            </F>
            <F label="Depreciation Method">
              <select
                className="block-select w-full"
                value={form.depreciation_method}
                onChange={(e) => set('depreciation_method', e.target.value)}
              >
                {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </F>

            {/* Preview */}
            {annualDep > 0 && (
              <div className="bg-bg-tertiary border border-border-primary p-3 space-y-2" style={{ borderRadius: '6px' }}>
                <p className="text-xs font-bold text-text-muted uppercase tracking-wider">Depreciation Preview</p>
                <div className="flex justify-between">
                  <span className="text-xs text-text-secondary">Annual:</span>
                  <span className="text-xs font-semibold text-text-primary">{fmt.format(annualDep)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-text-secondary">Monthly:</span>
                  <span className="text-xs font-semibold text-text-primary">{fmt.format(annualDep / 12)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-text-secondary">Method:</span>
                  <span className="text-xs text-accent-blue">{METHODS.find((m) => m.value === form.depreciation_method)?.label}</span>
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2 justify-end">
            <button onClick={onBack} className="block-btn px-4 py-2 text-xs">Cancel</button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="block-btn-primary px-4 py-2 text-xs"
            >
              {saving ? 'Saving...' : assetId ? 'Save Changes' : 'Create Asset'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
// ASSET DETAIL
// ═══════════════════════════════════════════════════════════
interface AssetDetailProps {
  assetId: string;
  onBack: () => void;
  onEdit: (id: string) => void;
}

type DetailTab = 'schedule' | 'history' | 'chart';

const AssetDetail: React.FC<AssetDetailProps> = ({ assetId, onBack, onEdit }) => {
  const [asset, setAsset] = useState<FixedAsset | null>(null);
  const [schedule, setSchedule] = useState<ScheduleEntry[]>([]);
  const [history, setHistory] = useState<DepreciationEntry[]>([]);
  const [tab, setTab] = useState<DetailTab>('schedule');
  const [loading, setLoading] = useState(true);
  const [disposing, setDisposing] = useState(false);
  const [showDisposeForm, setShowDisposeForm] = useState(false);
  const [disposeAmount, setDisposeAmount] = useState('');
  const [disposeDate, setDisposeDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [toast, setToast] = useState<Toast | null>(null);

  const showToast = (msg: string, ok = true) => {
    const t = { id: ++toastId, msg, ok };
    setToast(t);
    setTimeout(() => setToast((c) => (c?.id === t.id ? null : c)), 4000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Critical: asset data
      const a = await api.get('fixed_assets', assetId);
      setAsset(a);

      // Non-critical secondary data — failures don't hide primary content
      window.electronAPI.invoke('assets:schedule', { assetId })
        .then((r: any) => setSchedule(Array.isArray(r) ? r : []))
        .catch(() => {});
      api.query('asset_depreciation_entries', { asset_id: assetId })
        .then(r => setHistory(Array.isArray(r) ? r : []))
        .catch(() => {});
    } finally {
      setLoading(false);
    }
  }, [assetId]);

  useEffect(() => { load(); }, [load]);

  const handleDispose = async () => {
    if (!asset) return;
    setDisposing(true);
    try {
      // CALC: Disposal mid-life — compute book value at disposal date.
      // book_value = purchase_price - accumulated_depreciation (through
      // disposal). We use the latest schedule-row whose period falls on or
      // before the disposal date; otherwise fall back to current_book_value.
      // Source: GAAP — gain/loss on disposal = proceeds - book value.
      let bookAtDisposal = asset.current_book_value
        ?? ((asset.purchase_price || 0) - (asset.accumulated_depreciation || 0));
      let accumAtDisposal = asset.accumulated_depreciation || 0;
      if (Array.isArray(schedule) && schedule.length > 0 && disposeDate) {
        // Walk schedule rows whose `period` (year-end) <= disposeDate; use
        // the latest such row's book_value/accumulated. If disposal precedes
        // year 1's period date, use prior history (or original cost).
        const eligible = schedule.filter((s: any) => s.period && s.period <= disposeDate);
        if (eligible.length > 0) {
          const last = eligible[eligible.length - 1];
          bookAtDisposal = last.book_value;
          // CALC: defensively read both field names — IPC currently returns
          // `accumulated_depreciation`; older versions used `accumulated`.
          accumAtDisposal = last.accumulated_depreciation ?? (last as any).accumulated ?? accumAtDisposal;
        }
      }
      await api.update('fixed_assets', assetId, {
        status: 'disposed',
        disposal_date: disposeDate,
        disposal_amount: parseFloat(disposeAmount || '0') || 0,
        current_book_value: bookAtDisposal,
        accumulated_depreciation: accumAtDisposal,
        notes: `Disposed on ${disposeDate}. Proceeds: ${disposeAmount || '0'}. Book value at disposal: ${bookAtDisposal}. ${asset.notes ?? ''}`.trim(),
      });
      showToast('Asset marked as disposed.', true);
      setShowDisposeForm(false);
      load();
    } catch {
      showToast('Disposal failed.', false);
    } finally {
      setDisposing(false);
    }
  };

  const chartData = useMemo(() => {
    if (history.length > 0) {
      return history.map((h) => ({
        label: h.period_label,
        bookValue: h.book_value,
        depreciation: h.depreciation_amount,
      }));
    }
    return schedule.slice(0, 20).map((s) => ({
      label: s.period_label,
      bookValue: s.book_value,
      depreciation: s.depreciation_amount,
    }));
  }, [history, schedule]);

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-text-muted text-sm">Loading asset...</div>;
  }

  if (!asset) {
    return <div className="flex items-center justify-center h-64 text-text-muted text-sm">Asset not found.</div>;
  }

  const DETAIL_TABS: { key: DetailTab; label: string; icon: React.ReactNode }[] = [
    { key: 'schedule', label: 'Depreciation Schedule', icon: <Calendar size={14} /> },
    { key: 'history', label: 'Actual History', icon: <List size={14} /> },
    { key: 'chart', label: 'Book Value Chart', icon: <BarChart2 size={14} /> },
  ];

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 text-sm font-semibold border ${
            toast.ok ? 'bg-bg-elevated border-accent-income text-accent-income' : 'bg-bg-elevated border-accent-expense text-accent-expense'
          }`}
          style={{ borderRadius: '6px' }}
        >
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="block-btn p-1.5">
            <ChevronLeft size={16} />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-text-primary">{asset.name}</h1>
              <span className={`block-badge ${STATUS_COLORS[asset.status]}`}>
                {asset.status === 'fully_depreciated' ? 'Fully Dep.' : asset.status.charAt(0).toUpperCase() + asset.status.slice(1)}
              </span>
            </div>
            <p className="text-xs text-text-muted mt-0.5 font-mono">{asset.asset_code} · {CATEGORY_LABELS[asset.category]}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {asset.status === 'active' && (
            <button
              onClick={() => setShowDisposeForm(true)}
              className="block-btn flex items-center gap-1.5 px-3 py-1.5 text-xs text-accent-expense"
            >
              <XCircle size={13} />
              Dispose Asset
            </button>
          )}
          <button
            onClick={() => onEdit(assetId)}
            className="block-btn flex items-center gap-1.5 px-3 py-1.5 text-xs"
          >
            <Edit2 size={13} />
            Edit
          </button>
        </div>
      </div>

      {/* Dispose Form */}
      {showDisposeForm && (
        <div className="block-card p-4 border-accent-expense" style={{ borderColor: 'var(--color-accent-expense)' }}>
          <h3 className="text-sm font-bold text-accent-expense mb-3">Dispose Asset</h3>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-text-muted block mb-1">Disposal Date</label>
              <input
                type="date"
                className="block-input w-full"
                value={disposeDate}
                onChange={(e) => setDisposeDate(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-text-muted block mb-1">Disposal Amount ($)</label>
              <input
                type="number"
                className="block-input w-full"
                value={disposeAmount}
                onChange={(e) => setDisposeAmount(e.target.value)}
                placeholder="0.00"
                min="0"
                step="0.01"
              />
            </div>
            <div className="flex items-end gap-2">
              <button
                onClick={handleDispose}
                disabled={disposing}
                className="block-btn-primary px-4 py-2 text-xs bg-accent-expense border-accent-expense"
              >
                {disposing ? 'Processing...' : 'Confirm Disposal'}
              </button>
              <button onClick={() => setShowDisposeForm(false)} className="block-btn px-3 py-2 text-xs">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Asset Info Cards */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Purchase Price', value: fmt.format(asset.purchase_price) },
          { label: 'Salvage Value', value: fmt.format(asset.salvage_value) },
          { label: 'Book Value', value: fmt.format(asset.current_book_value ?? ((asset.purchase_price || 0) - (asset.accumulated_depreciation || 0))) },
          { label: 'Accumulated Dep.', value: fmt.format(asset.accumulated_depreciation || 0) },
        ].map((s) => (
          <div key={s.label} className="stat-card">
            <div className="stat-label">{s.label}</div>
            <div className="stat-value">{s.value}</div>
          </div>
        ))}
      </div>

      {/* Details Grid */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: <Calendar size={13} />, label: 'Purchase Date', value: asset.purchase_date ? format(parseISO(asset.purchase_date), 'MMM d, yyyy') : '—' },
          { icon: <Clock size={13} />, label: 'Useful Life', value: `${asset.useful_life_years} years` },
          { icon: <Tag size={13} />, label: 'Method', value: METHODS.find((m) => m.value === asset.depreciation_method)?.label ?? asset.depreciation_method },
          { icon: <Hash size={13} />, label: 'Serial Number', value: asset.serial_number || '—' },
          { icon: <MapPin size={13} />, label: 'Location', value: asset.location || '—' },
          { icon: <CheckCircle size={13} />, label: 'Status', value: asset.status.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()) },
        ].map((d) => (
          <div key={d.label} className="block-card p-3 flex items-start gap-2">
            <span className="text-text-muted mt-0.5">{d.icon}</span>
            <div>
              <p className="text-xs text-text-muted">{d.label}</p>
              <p className="text-sm font-semibold text-text-primary mt-0.5">{d.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border-primary">
        {DETAIL_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold transition-colors border-b-2 -mb-px ${
              tab === t.key ? 'border-accent-blue text-accent-blue' : 'border-transparent text-text-muted hover:text-text-primary transition-colors'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* Schedule Tab */}
      {tab === 'schedule' && (
        <div className="block-card overflow-hidden">
          {schedule.length === 0 ? (
            <div className="empty-state py-10">
              <p className="text-text-muted text-sm">No depreciation schedule available.</p>
            </div>
          ) : (
            <table className="block-table w-full">
              <thead>
                <tr>
                  <th>Period</th>
                  <th>Period Label</th>
                  <th className="text-right">Depreciation</th>
                  <th className="text-right">Accumulated</th>
                  <th className="text-right">Book Value</th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((s, i) => (
                  <tr key={i}>
                    <td className="text-text-muted text-xs">{s.period}</td>
                    <td>{s.period_label}</td>
                    <td className="text-right text-accent-expense">{fmt.format(s.depreciation_amount)}</td>
                    <td className="text-right text-text-secondary">{fmt.format(s.accumulated_depreciation)}</td>
                    <td className="text-right text-accent-income font-semibold">{fmt.format(s.book_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* History Tab */}
      {tab === 'history' && (
        <div className="block-card overflow-hidden">
          {history.length === 0 ? (
            <div className="empty-state py-10">
              <div className="empty-state-icon"><TrendingDown size={28} /></div>
              <p className="text-text-muted text-sm mt-2">No depreciation entries posted yet.</p>
              <p className="text-text-muted text-xs mt-1">Run Monthly Depreciation from the asset list to post entries.</p>
            </div>
          ) : (
            <table className="block-table w-full">
              <thead>
                <tr>
                  <th>Period Date</th>
                  <th>Period Label</th>
                  <th className="text-right">Depreciation</th>
                  <th className="text-right">Accumulated</th>
                  <th className="text-right">Book Value</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="text-text-muted text-xs font-mono">{h.period_date}</td>
                    <td>{h.period_label}</td>
                    <td className="text-right text-accent-expense">{fmt.format(h.depreciation_amount)}</td>
                    <td className="text-right text-text-secondary">{fmt.format(h.accumulated_depreciation)}</td>
                    <td className="text-right text-accent-income font-semibold">{fmt.format(h.book_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Cross-integration panels */}
      <div className="grid grid-cols-2 gap-4 mt-2">
        <RelatedPanel entityType="fixed_asset" entityId={assetId} />
        <EntityTimeline entityType="fixed_assets" entityId={assetId} />
      </div>

      {/* Chart Tab */}
      {tab === 'chart' && (
        <div className="block-card p-4">
          <h3 className="text-sm font-bold text-text-primary mb-4">Book Value Over Time</h3>
          {chartData.length === 0 ? (
            <div className="empty-state py-10">
              <p className="text-text-muted text-sm">No data to chart.</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-primary)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
                  angle={-45}
                  textAnchor="end"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'var(--color-text-muted)' }}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--color-bg-elevated)',
                    border: '1px solid var(--color-border-primary)',
                    borderRadius: '6px',
                    fontSize: '12px',
                  }}
                  formatter={(v) => fmt.format(Number(v))}
                />
                <Bar dataKey="bookValue" name="Book Value" fill="var(--color-accent-blue)" radius={0} />
                <Bar dataKey="depreciation" name="Depreciation" fill="var(--color-accent-expense)" radius={0} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
// MODULE ROUTER
// ═══════════════════════════════════════════════════════════
const FixedAssetsModule: React.FC = () => {
  const [view, setView] = useState<View>({ type: 'list' });

  const consumeFocusEntity = useAppStore((s) => s.consumeFocusEntity);
  useEffect(() => {
    const focus = consumeFocusEntity('fixed_asset');
    if (focus) setView({ type: 'detail', assetId: focus.id });
  }, [consumeFocusEntity]);

  const goList = useCallback(() => setView({ type: 'list' }), []);
  const goNew = useCallback(() => setView({ type: 'new' }), []);
  const goEdit = useCallback((id: string) => setView({ type: 'edit', assetId: id }), []);
  const goDetail = useCallback((id: string) => setView({ type: 'detail', assetId: id }), []);

  switch (view.type) {
    case 'new':
      return <AssetForm onBack={goList} onSaved={goDetail} />;
    case 'edit':
      return <AssetForm assetId={view.assetId} onBack={() => goDetail(view.assetId)} onSaved={goDetail} />;
    case 'detail':
      return <AssetDetail assetId={view.assetId} onBack={goList} onEdit={goEdit} />;
    case 'list':
    default:
      return <AssetList onNew={goNew} onView={goDetail} onEdit={goEdit} />;
  }
};

export default FixedAssetsModule;
