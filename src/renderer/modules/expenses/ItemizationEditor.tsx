/**
 * ItemizationEditor — Itemization Wave (F841-F862).
 *
 * Replaces the inline itemization box that was in ExpenseForm. Adds:
 *   - drag-to-reorder rows
 *   - per-line category / project / client / discount / tax-exempt / notes
 *   - line numbering
 *   - sticky totals with tax-breakdown-by-jurisdiction
 *   - templates: save current lines as a template, load templates
 *   - power tools: split-evenly, bulk-paste from clipboard CSV
 *   - description autocomplete from recent line history
 *   - compact / expanded view toggle
 *
 * State is OWNED BY THE PARENT (ExpenseForm) — this component only
 * receives lineItems + handlers and renders the UI. That keeps the save
 * path simple (parent already knows how to persist) and allows the
 * parent to drive lineItems from useEffect when load happens.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Copy, GripVertical, Plus, Save, SplitSquareHorizontal, Trash2, X } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/format';

// Inline jurisdiction picker. Replaces the prior prompt()-based add flow with
// a real dropdown of US state presets, a custom-entry escape hatch, and a
// pinned recent-jurisdictions list (per session) for fast repeat entry.
const JURISDICTION_RECENT_KEY = 'iz_recent_jurisdictions';
function loadRecentJurisdictions(): Array<{ jurisdiction: string; rate: number }> {
  try {
    const raw = sessionStorage.getItem(JURISDICTION_RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 6) : [];
  } catch { return []; }
}
function pushRecentJurisdiction(j: { jurisdiction: string; rate: number }) {
  try {
    const list = loadRecentJurisdictions().filter(x => x.jurisdiction !== j.jurisdiction);
    list.unshift(j);
    sessionStorage.setItem(JURISDICTION_RECENT_KEY, JSON.stringify(list.slice(0, 6)));
  } catch { /* ignore quota */ }
}

const JurisdictionPicker: React.FC<{
  onPick: (j: { jurisdiction: string; rate: number; amount: number }) => void;
  onClose: () => void;
}> = ({ onPick, onClose }) => {
  const [mode, setMode] = useState<'preset' | 'custom'>('preset');
  const [stateCode, setStateCode] = useState('');
  const [customName, setCustomName] = useState('');
  const [customRate, setCustomRate] = useState('');
  const recent = loadRecentJurisdictions();

  const submit = (jurisdiction: string, rate: number) => {
    if (!jurisdiction.trim() || !Number.isFinite(rate)) return;
    const j = { jurisdiction: jurisdiction.trim(), rate, amount: 0 };
    pushRecentJurisdiction({ jurisdiction: j.jurisdiction, rate });
    onPick(j);
    onClose();
  };

  return (
    <div className="block-card p-3" style={{ position: 'absolute', zIndex: 30, minWidth: 320, marginTop: 4 }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex gap-1">
          <button type="button" className={`text-[10px] px-2 py-1 uppercase font-bold ${mode === 'preset' ? 'bg-accent-blue text-white' : 'text-text-secondary'}`}
            style={{ borderRadius: 4 }}
            onClick={() => setMode('preset')}>US State</button>
          <button type="button" className={`text-[10px] px-2 py-1 uppercase font-bold ${mode === 'custom' ? 'bg-accent-blue text-white' : 'text-text-secondary'}`}
            style={{ borderRadius: 4 }}
            onClick={() => setMode('custom')}>Custom</button>
        </div>
        <button type="button" className="text-text-muted hover:text-text-primary" onClick={onClose} title="Close">
          <X size={12} />
        </button>
      </div>

      {mode === 'preset' && (
        <div className="space-y-2">
          <select className="block-select text-xs w-full" value={stateCode}
            onChange={e => setStateCode(e.target.value)}>
            <option value="">— Choose a state —</option>
            {US_STATE_TAX_PRESETS.map(s => (
              <option key={s.code} value={s.code}>
                {s.name} ({s.rate.toFixed(2)}%)
              </option>
            ))}
          </select>
          <button type="button" className="block-btn text-xs w-full"
            disabled={!stateCode}
            onClick={() => {
              const p = US_STATE_TAX_PRESETS.find(s => s.code === stateCode);
              if (p) submit(`${p.code} State`, p.rate);
            }}>
            Add {stateCode || 'State'} Tax
          </button>
        </div>
      )}

      {mode === 'custom' && (
        <div className="space-y-2">
          <input type="text" className="block-input text-xs w-full"
            placeholder="Jurisdiction (e.g. Los Angeles County)"
            value={customName} onChange={e => setCustomName(e.target.value)} />
          <input type="number" step="0.001" min="0" className="block-input text-xs w-full"
            placeholder="Rate % (e.g. 2.25)"
            value={customRate} onChange={e => setCustomRate(e.target.value)} />
          <button type="button" className="block-btn text-xs w-full"
            disabled={!customName.trim() || !customRate}
            onClick={() => submit(customName, parseFloat(customRate) || 0)}>
            Add Jurisdiction
          </button>
        </div>
      )}

      {recent.length > 0 && (
        <div className="mt-3 pt-2 border-t border-border-primary">
          <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted mb-1">Recent</div>
          <div className="flex flex-wrap gap-1">
            {recent.map((r, i) => (
              <button key={i} type="button"
                className="text-[10px] px-2 py-0.5 bg-bg-tertiary border border-border-primary hover:border-accent-blue"
                style={{ borderRadius: 3 }}
                onClick={() => submit(r.jurisdiction, r.rate)}>
                {r.jurisdiction} <span className="text-text-muted">{r.rate.toFixed(2)}%</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export interface IzLine {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  account_id: string;
  tax_rate: number;
  tax_amount: number;
  tax_jurisdictions: Array<{ jurisdiction: string; rate: number; amount: number }>;
  category_id?: string;
  project_id?: string;
  client_id?: string;
  discount_amount?: number;
  discount_percent?: number;
  is_tax_deductible?: boolean;
  is_tax_exempt?: boolean;
  notes?: string;
  item_type?: 'item' | 'service' | 'reimbursement';
  tags?: string[];
  // Bill this line to its client_id. Independent of the header is_billable
  // flag so a single expense can mix billable + non-billable items.
  is_billable?: boolean;
  // Stamped when this line is added to an invoice. Suppresses re-billing.
  billed_invoice_id?: string | null;
}

interface Option { id: string; name: string; }

interface Props {
  lineItems: IzLine[];
  setLineItems: (next: IzLine[] | ((prev: IzLine[]) => IzLine[])) => void;
  // Lookup data for the per-line selectors. Pass [] to hide the selector.
  categories?: Option[];
  projects?: Option[];
  clients?: Option[];
  accounts?: Option[];
  // For template visibility filtering / ownership
  userId?: string;
}

// US state sales-tax presets for the per-line Jurisdiction picker. Rates are
// the BASE state rates only — counties/cities stack on top via additional
// entries the user can add manually. Source: state revenue departments,
// effective 2026. Update as rates change. Includes DC; territories omitted.
const US_STATE_TAX_PRESETS: Array<{ code: string; name: string; rate: number }> = [
  { code: 'AL', name: 'Alabama', rate: 4.00 },
  { code: 'AK', name: 'Alaska', rate: 0.00 },
  { code: 'AZ', name: 'Arizona', rate: 5.60 },
  { code: 'AR', name: 'Arkansas', rate: 6.50 },
  { code: 'CA', name: 'California', rate: 7.25 },
  { code: 'CO', name: 'Colorado', rate: 2.90 },
  { code: 'CT', name: 'Connecticut', rate: 6.35 },
  { code: 'DE', name: 'Delaware', rate: 0.00 },
  { code: 'DC', name: 'District of Columbia', rate: 6.00 },
  { code: 'FL', name: 'Florida', rate: 6.00 },
  { code: 'GA', name: 'Georgia', rate: 4.00 },
  { code: 'HI', name: 'Hawaii', rate: 4.00 },
  { code: 'ID', name: 'Idaho', rate: 6.00 },
  { code: 'IL', name: 'Illinois', rate: 6.25 },
  { code: 'IN', name: 'Indiana', rate: 7.00 },
  { code: 'IA', name: 'Iowa', rate: 6.00 },
  { code: 'KS', name: 'Kansas', rate: 6.50 },
  { code: 'KY', name: 'Kentucky', rate: 6.00 },
  { code: 'LA', name: 'Louisiana', rate: 4.45 },
  { code: 'ME', name: 'Maine', rate: 5.50 },
  { code: 'MD', name: 'Maryland', rate: 6.00 },
  { code: 'MA', name: 'Massachusetts', rate: 6.25 },
  { code: 'MI', name: 'Michigan', rate: 6.00 },
  { code: 'MN', name: 'Minnesota', rate: 6.875 },
  { code: 'MS', name: 'Mississippi', rate: 7.00 },
  { code: 'MO', name: 'Missouri', rate: 4.225 },
  { code: 'MT', name: 'Montana', rate: 0.00 },
  { code: 'NE', name: 'Nebraska', rate: 5.50 },
  { code: 'NV', name: 'Nevada', rate: 6.85 },
  { code: 'NH', name: 'New Hampshire', rate: 0.00 },
  { code: 'NJ', name: 'New Jersey', rate: 6.625 },
  { code: 'NM', name: 'New Mexico', rate: 4.875 },
  { code: 'NY', name: 'New York', rate: 4.00 },
  { code: 'NC', name: 'North Carolina', rate: 4.75 },
  { code: 'ND', name: 'North Dakota', rate: 5.00 },
  { code: 'OH', name: 'Ohio', rate: 5.75 },
  { code: 'OK', name: 'Oklahoma', rate: 4.50 },
  { code: 'OR', name: 'Oregon', rate: 0.00 },
  { code: 'PA', name: 'Pennsylvania', rate: 6.00 },
  { code: 'RI', name: 'Rhode Island', rate: 7.00 },
  { code: 'SC', name: 'South Carolina', rate: 6.00 },
  { code: 'SD', name: 'South Dakota', rate: 4.20 },
  { code: 'TN', name: 'Tennessee', rate: 7.00 },
  { code: 'TX', name: 'Texas', rate: 6.25 },
  { code: 'UT', name: 'Utah', rate: 4.85 },
  { code: 'VT', name: 'Vermont', rate: 6.00 },
  { code: 'VA', name: 'Virginia', rate: 5.30 },
  { code: 'WA', name: 'Washington', rate: 6.50 },
  { code: 'WV', name: 'West Virginia', rate: 6.00 },
  { code: 'WI', name: 'Wisconsin', rate: 5.00 },
  { code: 'WY', name: 'Wyoming', rate: 4.00 },
];

const round2 = (n: number) => Math.round((n || 0) * 100) / 100;
const makeId = () => crypto.randomUUID();
const emptyLine = (): IzLine => ({
  id: makeId(), description: '', quantity: 1, unit_price: 0, amount: 0, account_id: '',
  tax_rate: 0, tax_amount: 0, tax_jurisdictions: [],
  category_id: '', project_id: '', client_id: '',
  discount_amount: 0, discount_percent: 0,
  is_tax_deductible: true, is_tax_exempt: false,
  notes: '', item_type: 'item', tags: [],
  is_billable: false, billed_invoice_id: null,
});

export default function ItemizationEditor({
  lineItems, setLineItems, categories = [], projects = [], clients = [], accounts = [], userId,
}: Props) {
  // ── Local UI state (not persisted) ──────────────────────────────
  const [compact, setCompact] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [tplMenuOpen, setTplMenuOpen] = useState(false);
  // Which line's jurisdiction picker is open. Stores the line id so the picker
  // floats next to the right row even when reordered.
  const [jurisdictionPickerFor, setJurisdictionPickerFor] = useState<string | null>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [showBulkPaste, setShowBulkPaste] = useState(false);
  const [bulkPasteText, setBulkPasteText] = useState('');
  const [showSplitTool, setShowSplitTool] = useState(false);
  const [splitTotal, setSplitTotal] = useState('');
  const [splitCount, setSplitCount] = useState('2');
  const [splitDesc, setSplitDesc] = useState('');
  const [activeSuggestRow, setActiveSuggestRow] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Array<{ description: string; freq: number }>>([]);

  const tplMenuRef = useRef<HTMLDivElement | null>(null);

  // Load templates lazily, only when the user opens the menu
  useEffect(() => {
    if (!tplMenuOpen) return;
    (async () => {
      const result = await (api as any).izTplList?.(userId);
      if (Array.isArray(result)) setTemplates(result);
    })();
  }, [tplMenuOpen, userId]);

  // Close template menu on outside click
  useEffect(() => {
    if (!tplMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (tplMenuRef.current && !tplMenuRef.current.contains(e.target as Node)) setTplMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [tplMenuOpen]);

  // Build lookup maps so we can show names in tooltips
  const categoryNames = useMemo(() => Object.fromEntries(categories.map(c => [c.id, c.name])), [categories]);
  const projectNames = useMemo(() => Object.fromEntries(projects.map(p => [p.id, p.name])), [projects]);

  // ── Derived totals ─────────────────────────────────────────────
  const lineEffective = useMemo(() => lineItems.map(li => {
    const subtotal = round2((li.quantity || 0) * (li.unit_price || 0));
    const discount = li.discount_amount
      ? round2(li.discount_amount)
      : li.discount_percent
        ? round2(subtotal * (li.discount_percent / 100))
        : 0;
    const pre_tax = round2(Math.max(0, subtotal - discount));
    const tax = li.is_tax_exempt ? 0 : round2(pre_tax * ((li.tax_rate || 0) / 100));
    return { subtotal, discount, pre_tax, tax, total: round2(pre_tax + tax) };
  }), [lineItems]);
  const subtotal = useMemo(() => round2(lineEffective.reduce((s, e) => s + e.subtotal, 0)), [lineEffective]);
  const totalDiscount = useMemo(() => round2(lineEffective.reduce((s, e) => s + e.discount, 0)), [lineEffective]);
  const totalTax = useMemo(() => round2(lineEffective.reduce((s, e) => s + e.tax, 0)), [lineEffective]);
  const grandTotal = useMemo(() => round2(lineEffective.reduce((s, e) => s + e.total, 0)), [lineEffective]);

  // Tax breakdown by jurisdiction (across all lines)
  const taxBreakdown = useMemo(() => {
    const buckets: Record<string, number> = {};
    for (let i = 0; i < lineItems.length; i++) {
      const li = lineItems[i];
      if (li.is_tax_exempt) continue;
      const eff = lineEffective[i];
      const jurisdictions = li.tax_jurisdictions || [];
      if (jurisdictions.length === 0) {
        if (eff.tax > 0) buckets['Tax'] = round2((buckets['Tax'] || 0) + eff.tax);
      } else {
        for (const j of jurisdictions) {
          const t = round2(eff.pre_tax * ((j.rate || 0) / 100));
          if (t > 0) buckets[j.jurisdiction || 'Tax'] = round2((buckets[j.jurisdiction || 'Tax'] || 0) + t);
        }
      }
    }
    return Object.entries(buckets).sort((a, b) => b[1] - a[1]);
  }, [lineItems, lineEffective]);

  // ── Per-line helpers ───────────────────────────────────────────
  const updateLine = (idx: number, patch: Partial<IzLine>) => {
    setLineItems(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      // Recompute derived line.amount + line.tax_amount
      const li = next[idx];
      const sub = round2((li.quantity || 0) * (li.unit_price || 0));
      const disc = li.discount_amount ? li.discount_amount : (li.discount_percent ? round2(sub * (li.discount_percent / 100)) : 0);
      const preTax = Math.max(0, sub - disc);
      li.amount = sub;
      const jurisdictions = li.tax_jurisdictions || [];
      if (li.is_tax_exempt) {
        li.tax_amount = 0;
      } else if (jurisdictions.length > 0) {
        li.tax_amount = round2(jurisdictions.reduce((s, j) => s + preTax * ((j.rate || 0) / 100), 0));
      } else {
        li.tax_amount = round2(preTax * ((li.tax_rate || 0) / 100));
      }
      return next;
    });
  };

  const addLine = () => setLineItems(prev => [...prev, emptyLine()]);
  const removeLine = (idx: number) => setLineItems(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx));
  const duplicateLine = (idx: number) => {
    setLineItems(prev => {
      const src = prev[idx];
      const dup: IzLine = { ...src, id: makeId(), description: `${src.description || ''} (copy)`.trim() };
      return [...prev.slice(0, idx + 1), dup, ...prev.slice(idx + 1)];
    });
  };
  const toggleExpand = (id: string) => setExpandedRows(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  // ── Drag-to-reorder (HTML5 native, no library) ─────────────────
  const handleDragStart = (idx: number, e: React.DragEvent) => {
    setDragIndex(idx);
    e.dataTransfer.effectAllowed = 'move';
    // Required in some browsers for drag to fire
    try { e.dataTransfer.setData('text/plain', String(idx)); } catch (_) {}
  };
  const handleDragOver = (idx: number, e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropIndex !== idx) setDropIndex(idx);
  };
  const handleDrop = (idx: number, e: React.DragEvent) => {
    e.preventDefault();
    if (dragIndex == null || dragIndex === idx) { setDragIndex(null); setDropIndex(null); return; }
    setLineItems(prev => {
      const arr = [...prev];
      const [moved] = arr.splice(dragIndex, 1);
      arr.splice(idx, 0, moved);
      return arr;
    });
    setDragIndex(null); setDropIndex(null);
  };
  const handleDragEnd = () => { setDragIndex(null); setDropIndex(null); };

  // ── Tax-rate bulk-apply ────────────────────────────────────────
  const applyTaxRateAll = () => {
    const v = prompt('Apply this tax rate (%) to ALL lines:');
    const rate = parseFloat(v || '');
    if (!isFinite(rate) || rate < 0) return;
    setLineItems(prev => prev.map(li => ({ ...li, tax_rate: rate })));
  };

  // ── Templates: save / load / delete ────────────────────────────
  const saveAsTemplate = async () => {
    const name = prompt('Template name:');
    if (!name) return;
    const description = prompt('Template description (optional):') || '';
    const res = await (api as any).izTplSave?.({ name, description, lines: lineItems, owner_user_id: userId, visibility: 'private' });
    if (res?.id) alert(`Template "${name}" saved (${res.line_count} lines).`);
    else if (res?.error) alert(`Save failed: ${res.error}`);
  };
  const loadTemplate = async (tplId: string) => {
    const res = await (api as any).izTplLoad?.(tplId);
    if (res?.error) { alert(`Load failed: ${res.error}`); return; }
    if (!res?.lines) return;
    const fresh: IzLine[] = res.lines.map((l: any) => ({
      ...emptyLine(),
      ...l,
      id: makeId(),
      amount: round2((l.quantity || 1) * (l.unit_price || 0)),
      is_tax_deductible: l.is_tax_deductible == null ? true : !!l.is_tax_deductible,
      is_tax_exempt: !!l.is_tax_exempt,
    }));
    setLineItems(fresh);
    setTplMenuOpen(false);
  };
  const deleteTemplate = async (tplId: string, name: string) => {
    if (!confirm(`Delete template "${name}"?`)) return;
    await (api as any).izTplDelete?.(tplId);
    setTemplates(prev => prev.filter(t => t.id !== tplId));
  };

  // ── Bulk paste ─────────────────────────────────────────────────
  const handleBulkPaste = async () => {
    const res = await (api as any).izBulkParse?.(bulkPasteText || '');
    if (!res?.lines) { alert('Parse failed'); return; }
    const parsed: IzLine[] = res.lines.map((l: any) => ({ ...emptyLine(), ...l, id: makeId(), amount: round2((l.quantity || 1) * (l.unit_price || 0)) }));
    setLineItems(prev => {
      // If the only line is the empty default, replace it; otherwise append
      const hasContent = prev.some(p => p.description || p.unit_price);
      return hasContent ? [...prev, ...parsed] : parsed;
    });
    if (res.warnings?.length) alert(`Imported ${parsed.length} lines.\n${res.warnings.join('\n')}`);
    setShowBulkPaste(false);
    setBulkPasteText('');
  };

  // ── Split evenly ───────────────────────────────────────────────
  const handleSplitEvenly = async () => {
    const total = parseFloat(splitTotal);
    const count = parseInt(splitCount, 10);
    if (!isFinite(total) || total <= 0 || !count || count < 1) { alert('Enter a positive total and count.'); return; }
    const res = await (api as any).izSplitEvenly?.(total, count, splitDesc);
    if (!Array.isArray(res)) { alert('Split failed'); return; }
    const splits: IzLine[] = res.map((l: any) => ({ ...emptyLine(), ...l, id: makeId() }));
    setLineItems(splits);
    setShowSplitTool(false);
    setSplitTotal(''); setSplitCount('2'); setSplitDesc('');
  };

  // ── Description autocomplete ───────────────────────────────────
  const openSuggestions = async (lineId: string) => {
    const res = await (api as any).izAutocompleteDescriptions?.({ limit: 8 });
    if (Array.isArray(res)) setSuggestions(res);
    setActiveSuggestRow(lineId);
  };
  const closeSuggestions = () => { setActiveSuggestRow(null); setSuggestions([]); };
  const applySuggestion = (idx: number, description: string) => {
    updateLine(idx, { description });
    closeSuggestions();
  };

  // ── Render helpers ─────────────────────────────────────────────
  const optSelect = (value: string, options: Option[], onChange: (v: string) => void, placeholder: string) => (
    <select className="block-select text-xs"
      value={value}
      onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );

  return (
    <div className="iz-container mb-2">
      {/* ── Toolbar ───────────────────────────────── */}
      <div className="iz-toolbar">
        <button type="button" className="iz-tpl-btn" onClick={() => setTplMenuOpen(o => !o)}>
          <Save size={11} /> Templates
        </button>
        {tplMenuOpen && (
          <div ref={tplMenuRef} className="iz-tpl-menu" style={{ position: 'absolute', top: 'auto', left: 'auto' }}>
            <button type="button" className="iz-tpl-item" style={{ width: '100%', textAlign: 'left', borderBottom: '1px solid var(--color-border-primary)' }}
              onClick={saveAsTemplate}>
              <Save size={11} /> Save current as template
            </button>
            {templates.length === 0 ? (
              <div className="iz-tpl-item" style={{ color: 'var(--color-text-muted)' }}>No saved templates yet</div>
            ) : (
              templates.map(t => (
                <div key={t.id} className="iz-tpl-item" onClick={() => loadTemplate(t.id)}>
                  <span>{t.name}</span>
                  <span className="iz-tpl-item-meta">{t.line_count ?? '?'} lines · {t.times_used ?? 0}×</span>
                  <button type="button" className="iz-act danger" title="Delete template"
                    onClick={(e) => { e.stopPropagation(); deleteTemplate(t.id, t.name); }}>
                    <X size={11} />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
        <button type="button" className="iz-tpl-btn" onClick={() => setShowBulkPaste(true)}>
          <Plus size={11} /> Bulk paste
        </button>
        <button type="button" className="iz-tpl-btn" onClick={() => setShowSplitTool(true)}>
          <SplitSquareHorizontal size={11} /> Split evenly
        </button>
        <button type="button" className="iz-tpl-btn" onClick={applyTaxRateAll}>
          Apply tax to all
        </button>
        <div className="iz-toolbar-spacer" />
        <button type="button" className={`iz-tpl-btn ${compact ? 'is-active' : ''}`} onClick={() => setCompact(c => !c)}>
          {compact ? 'Compact view' : 'Expanded view'}
        </button>
      </div>

      {/* ── Bulk paste textarea (inline modal) ───── */}
      {showBulkPaste && (
        <div className="iz-attr-row" style={{ display: 'block', padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
            Paste rows below. Format: <code>Description, Qty, UnitPrice, TaxRate%</code> (tabs or commas).
            <br />Example: <code>Office chair	1	150.00	7.65</code>
          </div>
          <textarea className="iz-paste-area" value={bulkPasteText} onChange={(e) => setBulkPasteText(e.target.value)}
            placeholder={"Item A, 1, 100\nItem B, 2, 25.50\nItem C, 1, 49.99, 7.65"} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" className="block-btn" onClick={handleBulkPaste}>Import</button>
            <button type="button" className="iz-tpl-btn" onClick={() => setShowBulkPaste(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Split-evenly tool ────────────────────── */}
      {showSplitTool && (
        <div className="iz-attr-row" style={{ display: 'block', padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
            Split a total across equal line items. Last line absorbs any rounding cent.
          </div>
          <div className="iz-split-row">
            <label style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
              Total $
              <input type="number" step="0.01" className="block-input text-xs" value={splitTotal}
                onChange={(e) => setSplitTotal(e.target.value)} placeholder="e.g. 300" />
            </label>
            <label style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
              # of lines
              <input type="number" step="1" min="1" className="block-input text-xs" value={splitCount}
                onChange={(e) => setSplitCount(e.target.value)} />
            </label>
            <label style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
              Base description (optional)
              <input type="text" className="block-input text-xs" value={splitDesc}
                onChange={(e) => setSplitDesc(e.target.value)} placeholder="e.g. Marketing campaign" />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" className="block-btn" onClick={handleSplitEvenly}>Create split</button>
            <button type="button" className="iz-tpl-btn" onClick={() => setShowSplitTool(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Header row ───────────────────────────── */}
      <div className={`iz-header-row ${compact ? 'iz-compact' : ''}`}>
        <div></div>
        <div>#</div>
        <div>Description</div>
        <div style={{ textAlign: 'right' }}>Qty</div>
        <div style={{ textAlign: 'right' }}>Unit Price</div>
        <div style={{ textAlign: 'right' }}>Tax %</div>
        <div style={{ textAlign: 'right' }}>Total</div>
        <div></div>
      </div>

      {/* ── Line rows ────────────────────────────── */}
      {lineItems.length === 0 ? (
        <div className="iz-empty">
          <span className="iz-empty-icon">📋</span>
          No line items yet. Click <strong>Add Item</strong> below, or paste rows in bulk.
        </div>
      ) : lineItems.map((li, idx) => {
        const eff = lineEffective[idx];
        const isExpanded = expandedRows.has(li.id);
        const contribution = grandTotal > 0 ? round2((eff.total / grandTotal) * 100) : 0;
        const isDragging = dragIndex === idx;
        const isDropTarget = dropIndex === idx && dragIndex != null && dragIndex !== idx;
        return (
          <React.Fragment key={li.id}>
            <div
              className={`iz-line ${compact ? 'iz-compact' : ''} ${isDragging ? 'iz-dragging' : ''} ${isDropTarget ? 'iz-drop-target' : ''}`}
              draggable
              onDragStart={(e) => handleDragStart(idx, e)}
              onDragOver={(e) => handleDragOver(idx, e)}
              onDrop={(e) => handleDrop(idx, e)}
              onDragEnd={handleDragEnd}
            >
              {/* Drag handle */}
              <div className="iz-handle" title="Drag to reorder">
                <GripVertical size={14} />
              </div>
              {/* Line number */}
              <div className="iz-num">{idx + 1}</div>
              {/* Description (with autocomplete) */}
              <div style={{ position: 'relative' }}>
                <input type="text" className="block-input text-sm"
                  placeholder="Item description"
                  value={li.description}
                  onFocus={() => openSuggestions(li.id)}
                  onBlur={() => setTimeout(closeSuggestions, 150)}
                  onChange={(e) => updateLine(idx, { description: e.target.value })} />
                {activeSuggestRow === li.id && suggestions.length > 0 && (
                  <div className="iz-suggest">
                    {suggestions.map((s, si) => (
                      <div key={si} className="iz-suggest-item"
                        onMouseDown={(e) => { e.preventDefault(); applySuggestion(idx, s.description); }}>
                        <span>{s.description}</span>
                        <span className="iz-suggest-item-meta">{s.freq}×</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {/* Qty — step="any" so decimals like 20.255 gallons are accepted */}
              <input type="number" className="block-input text-sm iz-num-cell" step="any" min="0"
                value={li.quantity}
                onChange={(e) => updateLine(idx, { quantity: parseFloat(e.target.value) || 0 })} />
              {/* Unit price — step="any" so 3+ decimal prices like $4.937/gal are accepted */}
              <input type="number" className="block-input text-sm iz-num-cell" step="any" min="0"
                placeholder="0.00"
                value={li.unit_price || ''}
                onChange={(e) => updateLine(idx, { unit_price: parseFloat(e.target.value) || 0 })} />
              {/* Tax rate (% or exempt) */}
              {li.is_tax_exempt ? (
                <div className="iz-num-cell">
                  <span className="iz-tax-flag exempt">EXEMPT</span>
                </div>
              ) : (
                <input type="number" className="block-input text-sm iz-num-cell" step="any" min="0" max="100"
                  value={li.tax_rate || 0}
                  onChange={(e) => updateLine(idx, { tax_rate: parseFloat(e.target.value) || 0 })} />
              )}
              {/* Line total */}
              <div className="iz-num-cell iz-total">
                {formatCurrency(eff.total)}
                {!compact && grandTotal > 0 && (
                  <div className="iz-contrib-track" style={{ marginTop: 3 }} title={`${contribution}% of total`}>
                    <div className="iz-contrib-fill" style={{ width: `${contribution}%` }} />
                  </div>
                )}
              </div>
              {/* Actions */}
              <div className="iz-actions">
                <button type="button" className={`iz-act ${isExpanded ? '' : ''}`} title="More options"
                  onClick={() => toggleExpand(li.id)}>
                  {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
                <button type="button" className="iz-act" title="Duplicate line"
                  onClick={() => duplicateLine(idx)}>
                  <Copy size={12} />
                </button>
                {lineItems.length > 1 && (
                  <button type="button" className="iz-act danger" title="Remove line"
                    onClick={() => removeLine(idx)}>
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            </div>

            {/* Discount / flags / metadata badges (always visible when applicable) */}
            {(eff.discount > 0 || li.tags?.length || li.item_type === 'service' || li.item_type === 'reimbursement' || li.is_tax_exempt || li.is_tax_deductible === false) && (
              <div className="iz-sub-row">
                {eff.discount > 0 && (
                  <span className="iz-discount-badge">
                    −{formatCurrency(eff.discount)}{li.discount_percent ? ` (${li.discount_percent}%)` : ''}
                  </span>
                )}
                {li.item_type === 'service' && <span className="iz-type-pill svc">SERVICE</span>}
                {li.item_type === 'reimbursement' && <span className="iz-type-pill rmb">REIMBURSEMENT</span>}
                {li.is_tax_exempt && <span className="iz-tax-flag exempt">TAX-EXEMPT</span>}
                {li.is_tax_deductible === false && <span className="iz-tax-flag nondeductible">NON-DEDUCTIBLE</span>}
                {(li.tags || []).map(t => (
                  <span key={t} className="iz-type-pill">{t}</span>
                ))}
                {li.notes && <span style={{ fontStyle: 'italic' }}>"{li.notes}"</span>}
              </div>
            )}

            {/* Expanded row — per-line accounting + flags */}
            {isExpanded && (
              <div className="iz-attr-row">
                <div></div><div></div>
                <div className="iz-attr-content">
                  {categories.length > 0 && optSelect(li.category_id || '', categories, v => updateLine(idx, { category_id: v }), '— Category —')}
                  {projects.length > 0 && optSelect(li.project_id || '', projects, v => updateLine(idx, { project_id: v }), '— Project —')}
                  {clients.length > 0 && optSelect(li.client_id || '', clients, v => updateLine(idx, { client_id: v }), '— Client —')}
                  {accounts.length > 0 && optSelect(li.account_id || '', accounts, v => updateLine(idx, { account_id: v }), '— Account —')}
                  <select className="block-select text-xs" value={li.item_type || 'item'}
                    onChange={(e) => updateLine(idx, { item_type: e.target.value as any })}>
                    <option value="item">Item</option>
                    <option value="service">Service</option>
                    <option value="reimbursement">Reimbursement</option>
                  </select>
                  <input type="number" className="block-input text-xs" step="0.01" min="0"
                    placeholder="Discount $"
                    value={li.discount_amount || ''}
                    onChange={(e) => updateLine(idx, { discount_amount: parseFloat(e.target.value) || 0 })} />
                  <input type="number" className="block-input text-xs" step="0.01" min="0" max="100"
                    placeholder="Discount %"
                    value={li.discount_percent || ''}
                    onChange={(e) => updateLine(idx, { discount_percent: parseFloat(e.target.value) || 0 })} />
                  <label className="text-[10px] flex items-center gap-1 text-text-secondary">
                    <input type="checkbox" checked={!!li.is_tax_exempt}
                      onChange={(e) => updateLine(idx, { is_tax_exempt: e.target.checked })} />
                    Tax-exempt
                  </label>
                  <label className="text-[10px] flex items-center gap-1 text-text-secondary">
                    <input type="checkbox" checked={li.is_tax_deductible !== false}
                      onChange={(e) => updateLine(idx, { is_tax_deductible: e.target.checked })} />
                    Tax-deductible
                  </label>
                  {/* Per-line billable-to-client. When checked + client_id set,
                      this line gets pulled into that client's next invoice via
                      the 'Create Invoice from Expenses' flow. Disabled with a
                      hint once billed_invoice_id is stamped (already invoiced). */}
                  <label className="text-[10px] flex items-center gap-1 text-text-secondary"
                    title={li.billed_invoice_id
                      ? 'Already invoiced — uncheck not available'
                      : !li.client_id
                        ? 'Pick a Client first to bill this line'
                        : 'Bill this line to the selected client'}>
                    <input type="checkbox"
                      checked={!!li.is_billable}
                      disabled={!!li.billed_invoice_id || !li.client_id}
                      onChange={(e) => updateLine(idx, { is_billable: e.target.checked })} />
                    Bill to client
                    {li.billed_invoice_id && <span className="text-accent-income"> · invoiced</span>}
                  </label>
                  <input type="text" className="block-input text-xs" placeholder="Notes / memo"
                    value={li.notes || ''}
                    onChange={(e) => updateLine(idx, { notes: e.target.value })} />
                </div>
              </div>
            )}

            {/* Per-line tax jurisdictions (visible when expanded OR has jurisdictions configured) */}
            {(isExpanded || (li.tax_jurisdictions || []).length > 0) && (
              <div className="iz-sub-row">
                <span style={{ fontWeight: 700, color: 'var(--color-text-secondary)' }}>Jurisdictions:</span>
                {(li.tax_jurisdictions || []).map((j, ji) => (
                  <span key={ji} className="iz-tax-chip">
                    <span className="label">{j.jurisdiction}</span>
                    {(j.rate || 0).toFixed(2)}%
                    <button type="button" className="iz-act danger" title="Remove jurisdiction"
                      onClick={() => updateLine(idx, { tax_jurisdictions: (li.tax_jurisdictions || []).filter((_, k) => k !== ji) })}>
                      <X size={10} />
                    </button>
                  </span>
                ))}
                <div style={{ position: 'relative', display: 'inline-block' }}>
                  <button type="button" className="iz-more-toggle"
                    onClick={() => setJurisdictionPickerFor(jurisdictionPickerFor === li.id ? null : li.id)}>
                    <Plus size={10} /> Jurisdiction
                  </button>
                  {jurisdictionPickerFor === li.id && (
                    <JurisdictionPicker
                      onPick={(j) => updateLine(idx, {
                        tax_jurisdictions: [...(li.tax_jurisdictions || []), j],
                      })}
                      onClose={() => setJurisdictionPickerFor(null)}
                    />
                  )}
                </div>
              </div>
            )}
          </React.Fragment>
        );
      })}

      {/* ── Add line button ──────────────────────── */}
      <div style={{ padding: 10, borderBottom: '1px solid var(--color-border-primary)', background: 'var(--color-bg-tertiary)' }}>
        <button type="button" className="block-btn flex items-center gap-1.5 text-xs px-3 py-1.5" onClick={addLine}>
          <Plus size={12} /> Add Item
        </button>
      </div>

      {/* ── Sticky totals ────────────────────────── */}
      <div className="iz-totals">
        <div className="iz-totals-left">
          {taxBreakdown.map(([j, amt]) => (
            <span key={j} className="iz-tax-chip">
              <span className="label">{j}:</span> {formatCurrency(amt)}
            </span>
          ))}
        </div>
        <div className="iz-totals-right">
          <div className="iz-totals-row">
            <span>Subtotal</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>
          {totalDiscount > 0 && (
            <div className="iz-totals-row" style={{ color: '#a855f7' }}>
              <span>Discount</span>
              <span>−{formatCurrency(totalDiscount)}</span>
            </div>
          )}
          {totalTax > 0 && (
            <div className="iz-totals-row">
              <span>Tax</span>
              <span>{formatCurrency(totalTax)}</span>
            </div>
          )}
          <div className="iz-totals-row iz-totals-grand">
            <span>Total</span>
            <span>{formatCurrency(grandTotal)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
