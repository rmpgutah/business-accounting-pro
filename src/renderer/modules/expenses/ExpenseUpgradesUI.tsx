/**
 * ExpenseUpgradesUI — visual surfaces for Expense Upgrades Wave (F863-F892).
 *
 * Four reusable widgets:
 *   • BulkActionBar — appears when rows are selected; offers approve, reject,
 *     re-categorize, tag, mark reimbursed, delete with single-API-call backing.
 *   • SmartFiltersDropdown — preset filters from getSystemFilterPresets() +
 *     user-saved smart filters. Clicking a preset applies its filter callback.
 *   • TopVendorsWidget — compact insights strip (last 90 days). Configurable
 *     range via props.
 *   • HygieneChip — small score badge for a single row.
 *
 * Kept presentational; data sources come in via props. The parent decides
 * which to render and how to wire the actions.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, CheckCircle, ChevronDown, Filter, Tag, Trash2, X } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/format';

// ─── HygieneChip ─────────────────────────────────────────
export function HygieneChip({ score }: { score: number | null | undefined }) {
  if (score == null) return null;
  const band = score >= 90 ? 'excellent' : score >= 70 ? 'good' : score >= 50 ? 'fair' : 'poor';
  const label = score >= 90 ? 'A+' : score >= 70 ? 'A' : score >= 50 ? 'B' : 'C';
  return (
    <span className={`eu-hyg ${band}`} title={`Hygiene score: ${score}/100`}>
      {label}·{score}
    </span>
  );
}

// ─── AnomalyBadge ────────────────────────────────────────
export function AnomalyBadge({ multiplier }: { multiplier?: number | null }) {
  if (!multiplier || multiplier < 2) return null;
  return (
    <span className="eu-anomaly" title={`${multiplier}× the category average`}>
      <AlertTriangle size={9} /> {multiplier.toFixed(1)}×
    </span>
  );
}

// ─── BulkActionBar ───────────────────────────────────────
interface BulkActionBarProps {
  selectedIds: string[];
  onCleared: () => void;
  /** Refresh callback fired after any bulk mutation */
  onRefresh: () => void;
  /** Available categories for the recategorize quick-action */
  categories?: Array<{ id: string; name: string }>;
}
export function BulkActionBar({ selectedIds, onCleared, onRefresh, categories = [] }: BulkActionBarProps) {
  if (selectedIds.length === 0) return null;

  const approve = async () => {
    const res = await (api as any).euBulkApproval?.({ expense_ids: selectedIds, status: 'approved' });
    if (res?.error) alert(`Approve failed: ${res.error}`);
    else onRefresh();
  };
  const reject = async () => {
    const reason = prompt(`Reject ${selectedIds.length} expense(s) — reason (optional):`);
    if (reason === null) return;
    const res = await (api as any).euBulkApproval?.({ expense_ids: selectedIds, status: 'rejected', comment: reason });
    if (res?.error) alert(`Reject failed: ${res.error}`);
    else onRefresh();
  };
  const reimburse = async () => {
    const res = await (api as any).euBulkReimbursed?.(selectedIds, true);
    if (res?.error) alert(`Mark reimbursed failed: ${res.error}`);
    else onRefresh();
  };
  const tag = async () => {
    const tagList = prompt(`Add tag(s) to ${selectedIds.length} expense(s) — comma-separated:`);
    if (!tagList) return;
    const tags = tagList.split(',').map(s => s.trim()).filter(Boolean);
    const res = await (api as any).euBulkTag?.(selectedIds, tags);
    if (res?.error) alert(`Tag failed: ${res.error}`);
    else onRefresh();
  };
  const recategorize = async (categoryId: string) => {
    if (!categoryId) return;
    const res = await (api as any).euBulkRecategorize?.(selectedIds, categoryId);
    if (res?.error) alert(`Recategorize failed: ${res.error}`);
    else onRefresh();
  };
  const bulkDelete = async () => {
    if (!confirm(`Delete ${selectedIds.length} expense(s)? This can be undone from the trash.`)) return;
    const res = await (api as any).euBulkDelete?.(selectedIds);
    if (res?.error) alert(`Delete failed: ${res.error}`);
    else onRefresh();
  };

  return (
    <div className="eu-bulk-bar">
      <span className="eu-count">{selectedIds.length}</span>
      <span>selected</span>
      <div className="eu-actions">
        <button type="button" className="eu-act-btn success" onClick={approve}>
          <CheckCircle size={11} /> Approve
        </button>
        <button type="button" className="eu-act-btn danger" onClick={reject}>
          <X size={11} /> Reject
        </button>
        <button type="button" className="eu-act-btn" onClick={reimburse}>
          <Check size={11} /> Mark reimbursed
        </button>
        <button type="button" className="eu-act-btn" onClick={tag}>
          <Tag size={11} /> Tag
        </button>
        {categories.length > 0 && (
          <select
            className="eu-act-btn"
            onChange={(e) => { recategorize(e.target.value); e.target.value = ''; }}
            defaultValue=""
            style={{ paddingRight: 4 }}
          >
            <option value="" disabled>Recategorize…</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <button type="button" className="eu-act-btn danger" onClick={bulkDelete}>
          <Trash2 size={11} /> Delete
        </button>
        <button type="button" className="eu-act-btn" onClick={onCleared}>
          <X size={11} /> Clear
        </button>
      </div>
    </div>
  );
}

// ─── SmartFiltersDropdown ────────────────────────────────
interface SmartFiltersDropdownProps {
  onApply: (preset: { name: string; description?: string; filter: any }) => void;
}
export function SmartFiltersDropdown({ onApply }: SmartFiltersDropdownProps) {
  const [open, setOpen] = useState(false);
  const [presets, setPresets] = useState<any[]>([]);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const sys = await (api as any).euFilterPresets?.();
      const saved = await (api as any).euFilterList?.();
      const merged = [
        ...(Array.isArray(sys) ? sys : []),
        ...(Array.isArray(saved) ? saved.map((s: any) => ({ name: s.name, description: '★ saved view', filter: JSON.parse(s.filter_json || '{}') })) : []),
      ];
      setPresets(merged);
    })();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={wrapRef} className="eu-filter-presets" style={{ display: 'inline-block' }}>
      <button type="button" className={`eu-filter-trigger ${open ? 'is-active' : ''}`} onClick={() => setOpen(o => !o)}>
        <Filter size={11} /> Smart filters <ChevronDown size={11} />
      </button>
      {open && (
        <div className="eu-filter-menu">
          {presets.length === 0 ? (
            <div className="eu-filter-item">Loading…</div>
          ) : presets.map((p, i) => (
            <div key={i} className="eu-filter-item" onClick={() => { onApply(p); setOpen(false); }}>
              <span className="eu-filter-item-name">{p.name}</span>
              {p.description && <span className="eu-filter-item-desc">{p.description}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── TopVendorsWidget ────────────────────────────────────
export function TopVendorsWidget({ since, until, limit = 5 }: { since?: string; until?: string; limit?: number }) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await (api as any).euInsightsTopVendors?.({ since, until, limit });
      setRows(Array.isArray(res) ? res : []);
      setLoading(false);
    })();
  }, [since, until, limit]);

  const maxAmount = useMemo(() => rows.reduce((m, r) => Math.max(m, r.total_spent || 0), 0), [rows]);

  if (loading) return null;
  if (rows.length === 0) return null;

  return (
    <div className="eu-tv-widget">
      <div className="eu-tv-header">
        <span>Top vendors (last 90 days)</span>
        <span>{rows.length}</span>
      </div>
      {rows.map((r, i) => {
        const pct = maxAmount > 0 ? Math.round((r.total_spent / maxAmount) * 100) : 0;
        return (
          <div key={r.id || i} className="eu-tv-row">
            <div>
              <div className="eu-tv-name">{r.name || '(no vendor)'}</div>
              <div className="iz-contrib-track" style={{ marginTop: 3 }}>
                <div className="iz-contrib-fill" style={{ width: `${pct}%` }} />
              </div>
            </div>
            <div className="eu-tv-amount">{formatCurrency(r.total_spent || 0)}</div>
            <div className="eu-tv-count">{r.expense_count || 0}×</div>
          </div>
        );
      })}
    </div>
  );
}

// ─── MissingReceiptsBanner ───────────────────────────────
export function MissingReceiptsBanner({ days = 7 }: { days?: number }) {
  const [missing, setMissing] = useState<any[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await (api as any).euReceiptsMissing?.(days);
      setMissing(Array.isArray(res) ? res : []);
    })();
  }, [days]);

  if (dismissed || missing.length === 0) return null;
  return (
    <div className="eu-banner-warn">
      <AlertTriangle size={14} style={{ color: 'var(--color-accent-warning)' }} />
      <span>
        <strong>{missing.length}</strong> expense{missing.length === 1 ? '' : 's'} {missing.length === 1 ? 'is' : 'are'} missing receipts (older than {days} days).
      </span>
      <span className="eu-banner-spacer" />
      <a onClick={() => setDismissed(true)}>Dismiss</a>
    </div>
  );
}
