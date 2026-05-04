/**
 * Capture & data-entry features for expenses (drag-drop receipts, mileage,
 * per-diem, multi-receipt, smart vendor, markdown notes, etc.).
 *
 * Designed to drop into ExpenseForm.tsx without conflicting with the
 * categorization/tax agent's parallel work — narrow controlled props.
 */
import React, { useEffect, useState } from 'react';
import { Plus, X, Eye, EyeOff, FileText, Paperclip } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, roundCents } from '../../lib/format';
import { todayLocal } from '../../lib/date-helpers';
import { FieldLabel } from '../../components/FieldLabel';

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'CNY', 'MXN', 'INR'];
export const IRS_MILEAGE_RATE_2026 = 0.67;
export const PER_DIEM_RATES: Record<string, number> = {
  'Default (CONUS)': 178,
  'New York, NY': 379,
  'San Francisco, CA': 387,
  'Los Angeles, CA': 264,
  'Chicago, IL': 281,
  'Boston, MA': 358,
  'Washington, DC': 327,
  'Seattle, WA': 290,
  'Miami, FL': 245,
  'Denver, CO': 244,
  'Honolulu, HI': 423,
  'Foreign / OCONUS': 250,
};

export const ReceiptThumb: React.FC<{ path: string; onClick?: () => void; sizePx?: number }> = ({ path, onClick, sizePx = 64 }) => {
  const isImage = /\.(jpe?g|png|gif|webp)$/i.test(path);
  const isPdf = /\.pdf$/i.test(path);
  return (
    <div onClick={onClick}
      className="border border-border-primary flex items-center justify-center bg-bg-tertiary cursor-pointer hover:border-accent-blue overflow-hidden"
      style={{ width: sizePx, height: sizePx, borderRadius: 6 }}
      title={path.split(/[/\\]/).pop()}>
      {isImage ? (
        <img src={`file://${path}`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'cover' }} alt="receipt"
          loading="lazy" decoding="async"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      ) : isPdf ? <FileText size={sizePx * 0.45} className="text-accent-blue" /> : <Paperclip size={sizePx * 0.4} className="text-text-muted" />}
    </div>
  );
};

export interface ReceiptZoneProps {
  primaryPath: string;
  onSetPrimary: (p: string) => void;
  extras: string[];
  onSetExtras: (paths: string[]) => void;
}
export const ReceiptZone: React.FC<ReceiptZoneProps> = ({ primaryPath, onSetPrimary, extras, onSetExtras }) => {
  const [dragOver, setDragOver] = useState(false);
  const [pdfPageCounts, setPdfPageCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    const all = [primaryPath, ...extras].filter(p => p && /\.pdf$/i.test(p));
    for (const p of all) {
      if (pdfPageCounts[p] != null) continue;
      fetch(`file://${p}`).then(r => r.arrayBuffer()).then(buf => {
        try {
          const text = new TextDecoder('latin1').decode(buf);
          const matches = text.match(/\/Type\s*\/Page[^s]/g);
          setPdfPageCounts(prev => ({ ...prev, [p]: matches ? matches.length : 1 }));
        } catch { setPdfPageCounts(prev => ({ ...prev, [p]: 0 })); }
      }).catch(() => setPdfPageCounts(prev => ({ ...prev, [p]: 0 })));
    }
  }, [primaryPath, extras, pdfPageCounts]);

  const onDrop = (ev: React.DragEvent) => {
    ev.preventDefault();
    setDragOver(false);
    const files = Array.from(ev.dataTransfer.files);
    const paths = files.map(f => (f as any).path).filter(Boolean) as string[];
    if (paths.length === 0) return;
    if (!primaryPath) {
      onSetPrimary(paths[0]);
      if (paths.length > 1) onSetExtras([...extras, ...paths.slice(1)]);
    } else {
      onSetExtras([...extras, ...paths]);
    }
  };

  const pickReceipt = async (replace = false) => {
    try {
      const result = await api.openFileDialog({ filters: [{ name: 'Receipts', extensions: ['jpg', 'jpeg', 'png', 'pdf', 'gif', 'webp'] }] });
      if (result && result.path) {
        if (replace || !primaryPath) onSetPrimary(result.path);
        else onSetExtras([...extras, result.path]);
      }
    } catch (e) { console.error(e); }
  };

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={`border ${dragOver ? 'border-accent-blue bg-accent-blue/5' : 'border-dashed border-border-secondary'} p-3`}
      style={{ borderRadius: 6 }}>
      <div className="flex flex-wrap items-center gap-3">
        {primaryPath && (
          <div className="relative">
            <ReceiptThumb path={primaryPath} onClick={() => pickReceipt(true)} />
            {pdfPageCounts[primaryPath] > 0 && (
              <span className="absolute -top-1 -right-1 bg-accent-blue text-white text-[9px] px-1 rounded">[{pdfPageCounts[primaryPath]} pages]</span>
            )}
            <button type="button" className="absolute -top-2 -left-2 text-text-muted hover:text-accent-expense bg-bg-secondary rounded-full p-0.5"
              onClick={() => onSetPrimary('')}><X size={10} /></button>
          </div>
        )}
        {extras.map((p, i) => (
          <div key={p + i} className="relative">
            <ReceiptThumb path={p} />
            {pdfPageCounts[p] > 0 && (
              <span className="absolute -top-1 -right-1 bg-accent-blue text-white text-[9px] px-1 rounded">[{pdfPageCounts[p]} pages]</span>
            )}
            <button type="button" className="absolute -top-2 -left-2 text-text-muted hover:text-accent-expense bg-bg-secondary rounded-full p-0.5"
              onClick={() => onSetExtras(extras.filter((_, idx) => idx !== i))}><X size={10} /></button>
          </div>
        ))}
        <button type="button" onClick={() => pickReceipt(false)}
          className="border border-border-secondary flex items-center justify-center text-text-muted text-xs cursor-pointer hover:border-accent-blue px-3"
          style={{ width: 64, height: 64, borderRadius: 6 }}><Plus size={20} /></button>
        <span className="text-xs text-text-muted">Drag &amp; drop receipts here, or click + to browse. Click a thumbnail to replace.</span>
      </div>
    </div>
  );
};

export interface MileageState { odometer_start: number; odometer_end: number; miles: number; mileage_rate: number; }
export const MileagePanel: React.FC<{ value: MileageState; onChange: (v: MileageState) => void }> = ({ value, onChange }) => {
  const computedMiles = value.odometer_end > value.odometer_start ? value.odometer_end - value.odometer_start : value.miles;
  const computedAmount = roundCents(computedMiles * value.mileage_rate);
  return (
    <div className="border border-border-primary p-4 mb-4" style={{ borderRadius: 6, background: 'var(--color-bg-tertiary)' }}>
      <div className="grid grid-cols-4 gap-3">
        <div><FieldLabel label="Odometer Start" /><input type="number" className="block-input" value={value.odometer_start || ''}
          onChange={e => onChange({ ...value, odometer_start: parseFloat(e.target.value) || 0 })} /></div>
        <div><FieldLabel label="Odometer End" /><input type="number" className="block-input" value={value.odometer_end || ''}
          onChange={e => onChange({ ...value, odometer_end: parseFloat(e.target.value) || 0 })} /></div>
        <div><FieldLabel label="Miles" /><input type="number" className="block-input" value={value.miles || ''}
          onChange={e => onChange({ ...value, miles: parseFloat(e.target.value) || 0 })} /></div>
        <div><FieldLabel label="IRS Rate ($/mi)" /><input type="number" step="0.001" className="block-input" value={value.mileage_rate || ''}
          onChange={e => onChange({ ...value, mileage_rate: parseFloat(e.target.value) || 0 })} /></div>
      </div>
      <div className="text-xs text-text-muted mt-2">Computed: {computedMiles} mi &times; ${value.mileage_rate}/mi = <span className="text-text-primary font-bold">{formatCurrency(computedAmount)}</span></div>
    </div>
  );
};

export interface PerDiemState { per_diem_location: string; per_diem_days: number; per_diem_rate: number; }
export const PerDiemPanel: React.FC<{ value: PerDiemState; onChange: (v: PerDiemState) => void }> = ({ value, onChange }) => {
  const computedAmount = roundCents(value.per_diem_days * value.per_diem_rate);
  return (
    <div className="border border-border-primary p-4 mb-4" style={{ borderRadius: 6, background: 'var(--color-bg-tertiary)' }}>
      <div className="grid grid-cols-3 gap-3">
        <div><FieldLabel label="Location" />
          <select className="block-select" value={value.per_diem_location} onChange={e => {
            const loc = e.target.value;
            onChange({ ...value, per_diem_location: loc, per_diem_rate: PER_DIEM_RATES[loc] ?? value.per_diem_rate });
          }}>{Object.keys(PER_DIEM_RATES).map(loc => <option key={loc} value={loc}>{loc}</option>)}</select>
        </div>
        <div><FieldLabel label="Days" /><input type="number" className="block-input" value={value.per_diem_days || ''}
          onChange={e => onChange({ ...value, per_diem_days: parseFloat(e.target.value) || 0 })} /></div>
        <div><FieldLabel label="Rate ($/day)" /><input type="number" step="0.01" className="block-input" value={value.per_diem_rate || ''}
          onChange={e => onChange({ ...value, per_diem_rate: parseFloat(e.target.value) || 0 })} /></div>
      </div>
      <div className="text-xs text-text-muted mt-2">Computed: {value.per_diem_days} days &times; ${value.per_diem_rate}/day = <span className="text-text-primary font-bold">{formatCurrency(computedAmount)}</span></div>
    </div>
  );
};

// ─── Fuel entry mode ─────────────────────────────────────
// Fuel pricing is conventionally posted to 3 decimal places ($3.459/gal),
// and pumps measure dispensed volume to 0.001 gal. Both gallons and price
// inputs use step="0.001" so the user can capture the receipt exactly.
// `amount` is computed as gallons × price, rounded to cents at the end.
//
// Fuel grade choices are alphabetized (per app-wide A→Z dropdown rule).
const FUEL_GRADES = [
  { value: 'diesel', label: 'Diesel' },
  { value: 'e85', label: 'E85 (Flex Fuel)' },
  { value: 'electric', label: 'Electric (kWh)' },
  { value: 'midgrade', label: 'Midgrade (89)' },
  { value: 'premium', label: 'Premium (91/93)' },
  { value: 'regular', label: 'Regular (87)' },
] as const;

export interface FuelState {
  fuel_gallons: number;
  fuel_price_per_gallon: number;
  fuel_grade: string;
  fuel_vehicle: string;     // free-text for now: vehicle plate, employee number, etc.
  fuel_odometer: number;    // current odometer (informational, not used in calc)
  fuel_station: string;     // gas-station name for receipt cross-reference
}

export const FuelPanel: React.FC<{ value: FuelState; onChange: (v: FuelState) => void }> = ({ value, onChange }) => {
  // Use raw multiplication then roundCents only at boundary — preserves
  // the 3rd-decimal pricing precision through the computation.
  const computedAmount = roundCents((value.fuel_gallons || 0) * (value.fuel_price_per_gallon || 0));
  const isElectric = value.fuel_grade === 'electric';
  return (
    <div className="border border-border-primary p-4 mb-4" style={{ borderRadius: 6, background: 'var(--color-bg-tertiary)' }}>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <FieldLabel label="Fuel Grade" />
          <select className="block-select" value={value.fuel_grade || 'regular'}
            onChange={e => onChange({ ...value, fuel_grade: e.target.value })}>
            {FUEL_GRADES.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
        </div>
        <div>
          {/* Step 0.001 lets the pump's exact reading enter as-is (e.g. 12.347 gal). */}
          <FieldLabel label={isElectric ? 'kWh' : 'Gallons'} />
          <input
            type="number"
            inputMode="decimal"
            step="0.001"
            min="0"
            className="block-input font-mono"
            value={value.fuel_gallons || ''}
            placeholder="0.000"
            onChange={e => onChange({ ...value, fuel_gallons: parseFloat(e.target.value) || 0 })}
          />
        </div>
        <div>
          {/* Posted fuel prices use 3 decimals — accept #.### exactly. */}
          <FieldLabel label={isElectric ? 'Price ($/kWh)' : 'Price ($/gal)'} />
          <input
            type="number"
            inputMode="decimal"
            step="0.001"
            className="block-input font-mono"
            value={value.fuel_price_per_gallon || ''}
            placeholder="0.000"
            onChange={e => onChange({ ...value, fuel_price_per_gallon: parseFloat(e.target.value) || 0 })}
          />
        </div>
        <div>
          <FieldLabel label="Vehicle / Asset" />
          <input
            className="block-input"
            value={value.fuel_vehicle || ''}
            placeholder="Plate, asset tag, or driver"
            onChange={e => onChange({ ...value, fuel_vehicle: e.target.value })}
          />
        </div>
        <div>
          <FieldLabel label="Odometer (miles)" />
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            className="block-input font-mono"
            value={value.fuel_odometer || ''}
            placeholder="0"
            onChange={e => onChange({ ...value, fuel_odometer: parseFloat(e.target.value) || 0 })}
          />
        </div>
        <div>
          <FieldLabel label="Station" />
          <input
            className="block-input"
            value={value.fuel_station || ''}
            placeholder="Shell, Chevron, …"
            onChange={e => onChange({ ...value, fuel_station: e.target.value })}
          />
        </div>
      </div>
      <div className="text-xs text-text-muted mt-2 font-mono">
        {(value.fuel_gallons || 0).toFixed(3)} {isElectric ? 'kWh' : 'gal'}
        &nbsp;×&nbsp;
        ${(value.fuel_price_per_gallon || 0).toFixed(3)}{isElectric ? '/kWh' : '/gal'}
        &nbsp;=&nbsp;
        <span className="text-text-primary font-bold">{formatCurrency(computedAmount)}</span>
      </div>
    </div>
  );
};

export type EntryMode = 'standard' | 'mileage' | 'per_diem' | 'fuel';
export const EntryModeBar: React.FC<{ value: EntryMode; onChange: (m: EntryMode) => void }> = ({ value, onChange }) => (
  <div className="flex items-center gap-2">
    <span className="text-xs font-semibold uppercase text-text-muted">Mode:</span>
    {(['standard', 'mileage', 'per_diem', 'fuel'] as const).map(m => (
      <button key={m} type="button" onClick={() => onChange(m)}
        className={`px-3 py-1 border text-xs font-bold uppercase ${value === m ? 'border-accent-blue text-accent-blue bg-accent-blue/10' : 'border-border-primary text-text-secondary'}`}>
        {m === 'per_diem' ? 'Per-Diem' : m.charAt(0).toUpperCase() + m.slice(1)}
      </button>
    ))}
  </div>
);

export const TaxBasisBar: React.FC<{
  taxInclusive: boolean; taxRate: number; amount: number;
  onChange: (patch: { tax_inclusive?: boolean; tax_rate?: number }) => void;
}> = ({ taxInclusive, taxRate, amount, onChange }) => {
  const preTax = taxInclusive && taxRate > 0 ? roundCents(amount / (1 + taxRate / 100)) : null;
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-semibold uppercase text-text-muted">Tax:</span>
      <label className="flex items-center gap-1 text-xs"><input type="radio" checked={!taxInclusive} onChange={() => onChange({ tax_inclusive: false })} /> Exclusive</label>
      <label className="flex items-center gap-1 text-xs"><input type="radio" checked={taxInclusive} onChange={() => onChange({ tax_inclusive: true })} /> Inclusive</label>
      <input type="number" step="0.01" placeholder="rate %" className="block-input" style={{ width: 90 }}
        value={taxRate || ''} onChange={e => onChange({ tax_rate: parseFloat(e.target.value) || 0 })} />
      {preTax != null && <span className="text-[11px] text-text-muted">Pre-tax: {formatCurrency(preTax)}</span>}
    </div>
  );
};

export const CurrencySelector: React.FC<{
  currency: string; exchangeRate: string; amount: number;
  onChange: (patch: { currency?: string; exchange_rate?: string }) => void;
}> = ({ currency, exchangeRate, amount, onChange }) => (
  <div className="flex items-center gap-2 mt-1 flex-wrap">
    <span className="text-[10px] text-text-muted">Currency:</span>
    <select className="block-select" style={{ width: 80 }} value={currency} onChange={e => onChange({ currency: e.target.value })}>
      {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
    </select>
    {currency !== 'USD' && (
      <>
        <span className="text-[10px] text-text-muted">FX rate to USD:</span>
        <input type="number" step="0.0001" className="block-input" style={{ width: 100 }}
          value={exchangeRate} onChange={e => onChange({ exchange_rate: e.target.value })} />
        <span className="text-[10px] text-text-muted">&asymp; {formatCurrency(amount * (parseFloat(exchangeRate) || 1))} USD</span>
      </>
    )}
  </div>
);

// ─── Markdown notes (#21) ──────────────────────────────
function renderInline(s: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const matches = Array.from(s.matchAll(/(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`)/g));
  let last = 0; let i = 0;
  for (const m of matches) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push(s.slice(last, idx));
    if (m[2]) parts.push(<strong key={i++}>{m[2]}</strong>);
    else if (m[3]) parts.push(<em key={i++}>{m[3]}</em>);
    else if (m[4]) parts.push(<code key={i++} className="px-1 bg-bg-tertiary">{m[4]}</code>);
    last = idx + m[0].length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts;
}
function MarkdownPreview({ src }: { src: string }) {
  const lines = src.split('\n');
  const out: React.ReactNode[] = [];
  let listBuf: string[] = [];
  const flushList = () => {
    if (!listBuf.length) return;
    out.push(<ul key={`ul-${out.length}`} className="list-disc ml-5">{listBuf.map((l, i) => <li key={i}>{renderInline(l)}</li>)}</ul>);
    listBuf = [];
  };
  for (const line of lines) {
    if (/^### /.test(line)) { flushList(); out.push(<h3 key={out.length} className="font-bold text-sm mt-2">{renderInline(line.slice(4))}</h3>); }
    else if (/^## /.test(line)) { flushList(); out.push(<h2 key={out.length} className="font-bold text-base mt-2">{renderInline(line.slice(3))}</h2>); }
    else if (/^# /.test(line)) { flushList(); out.push(<h1 key={out.length} className="font-bold text-lg mt-2">{renderInline(line.slice(2))}</h1>); }
    else if (/^[-*] /.test(line)) listBuf.push(line.slice(2));
    else if (line.trim() === '') { flushList(); out.push(<div key={out.length} style={{ height: 6 }} />); }
    else { flushList(); out.push(<p key={out.length} className="text-sm">{renderInline(line)}</p>); }
  }
  flushList();
  return <>{out}</>;
}
export const NotesMemoField: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => {
  const [preview, setPreview] = useState(false);
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">Notes / Memo</label>
        <button type="button" className="text-xs text-text-muted hover:text-accent-blue flex items-center gap-1"
          onClick={() => setPreview(p => !p)}>
          {preview ? <><EyeOff size={12} /> Edit</> : <><Eye size={12} /> Preview</>}
        </button>
      </div>
      {preview ? (
        <div className="block-input" style={{ minHeight: 80, padding: 12 }}>
          <MarkdownPreview src={value || '_(empty)_'} />
        </div>
      ) : (
        <textarea className="block-input" rows={4} placeholder="Markdown supported: **bold**, *italic*, `code`, # heading, - list"
          value={value} onChange={e => onChange(e.target.value)} />
      )}
    </div>
  );
};

// ─── Tag input with autocomplete (#22) ─────────────────
export const TagsAutocomplete: React.FC<{
  value: string; onChange: (v: string) => void; allTags: string[];
}> = ({ value, onChange, allTags }) => {
  const [suggest, setSuggest] = useState<string[]>([]);
  const onTextChange = (v: string) => {
    onChange(v);
    const parts = v.split(',');
    const cur = (parts[parts.length - 1] || '').trim().toLowerCase();
    if (!cur) { setSuggest([]); return; }
    setSuggest(allTags.filter(t => t.toLowerCase().startsWith(cur) && !parts.slice(0, -1).map(s => s.trim()).includes(t)).slice(0, 6));
  };
  const accept = (t: string) => {
    const parts = value.split(',');
    parts[parts.length - 1] = ` ${t}`;
    onChange(parts.join(',').replace(/^\s+/, '') + ', ');
    setSuggest([]);
  };
  return (
    <div className="relative">
      <input type="text" className="block-input" placeholder="e.g. office, supplies"
        value={value} onChange={e => onTextChange(e.target.value)} />
      {suggest.length > 0 && (
        <div className="absolute z-10 mt-1 border border-border-primary bg-bg-secondary" style={{ borderRadius: 6 }}>
          {suggest.map(t => (
            <div key={t} className="px-3 py-1 text-xs cursor-pointer hover:bg-bg-tertiary" onClick={() => accept(t)}>{t}</div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Fuzzy vendor matcher (#11, #18, #19, #20) ─────────
function levenshtein(a: string, b: string): number {
  if (!a.length) return b.length; if (!b.length) return a.length;
  const m: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      m[i][j] = a[i - 1] === b[j - 1] ? m[i - 1][j - 1] : 1 + Math.min(m[i - 1][j], m[i][j - 1], m[i - 1][j - 1]);
  return m[a.length][b.length];
}
export function fuzzyVendorMatches(query: string, vendors: { id: string; name: string }[]): { id: string; name: string }[] {
  if (!query || query.length < 2) return [];
  const q = query.toLowerCase();
  return vendors
    .map(v => ({ v, score: v.name.toLowerCase().includes(q) ? 0 : levenshtein(v.name.toLowerCase(), q) }))
    .filter(x => x.score <= 3 && x.v.name.toLowerCase() !== q)
    .sort((a, b) => a.score - b.score)
    .slice(0, 5)
    .map(x => x.v);
}

// ─── Quick-create vendor modal (#20) ───────────────────
export const QuickVendorModal: React.FC<{
  initialName: string; companyId: string; onClose: () => void; onCreated: (v: { id: string; name: string }) => void;
}> = ({ initialName, companyId, onClose, onCreated }) => {
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    if (!name.trim()) { setErr('Name is required'); return; }
    setSaving(true);
    try {
      const v = await api.create('vendors', { company_id: companyId, name: name.trim(), email, phone });
      onCreated({ id: v.id, name: v.name });
    } catch (e: any) { setErr(e?.message || 'Failed to create vendor'); }
    finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div className="block-card p-6 w-[420px]" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold uppercase tracking-wider mb-3">Quick Add Vendor</h3>
        {err && <div className="text-xs text-accent-expense mb-2">{err}</div>}
        <div className="space-y-3">
          <div><FieldLabel label="Name" required /><input className="block-input" value={name} onChange={e => setName(e.target.value)} autoFocus /></div>
          <div><FieldLabel label="Email" /><input className="block-input" value={email} onChange={e => setEmail(e.target.value)} /></div>
          <div><FieldLabel label="Phone" /><input className="block-input" value={phone} onChange={e => setPhone(e.target.value)} /></div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button className="block-btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="block-btn-primary" onClick={submit} disabled={saving}>{saving ? 'Saving...' : 'Create'}</button>
        </div>
      </div>
    </div>
  );
};

// ─── Bulk paste (CSV/TSV) modal (#12) ─────────────────
export const BulkPasteModal: React.FC<{ companyId: string; onClose: () => void; onImported: () => void }> = ({ companyId, onClose, onImported }) => {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const importNow = async () => {
    setBusy(true); setErr('');
    try {
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) { setErr('Paste at least one row'); setBusy(false); return; }
      const delim = lines[0].includes('\t') ? '\t' : ',';
      const firstCols = lines[0].split(delim);
      const hasHeader = firstCols.some(c => /^(date|vendor|amount|description)$/i.test(c.trim()));
      const dataLines = hasHeader ? lines.slice(1) : lines;
      let inserted = 0;
      for (const line of dataLines) {
        const cols = line.split(delim).map(c => c.trim().replace(/^"|"$/g, ''));
        const [date, vendor, amount, ...rest] = cols;
        const description = rest.join(' ').trim();
        if (!date || !amount) continue;
        const amt = parseFloat(amount.replace(/[$,]/g, '')) || 0;
        if (amt <= 0) continue;
        await api.create('expenses', {
          company_id: companyId, date, amount: amt,
          description: description || vendor || '', status: 'draft',
          tags: JSON.stringify([]),
          custom_fields: JSON.stringify({ bulk_paste_vendor: vendor || '' }),
        });
        inserted++;
      }
      setCount(inserted);
      onImported();
    } catch (e: any) { setErr(e?.message || 'Import failed'); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose}>
      <div className="block-card p-6 w-[640px]" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold uppercase tracking-wider mb-3">Bulk Paste Expenses</h3>
        <p className="text-xs text-text-muted mb-2">Paste CSV or TSV rows. Columns: date, vendor, amount, description.</p>
        {err && <div className="text-xs text-accent-expense mb-2">{err}</div>}
        {count != null && <div className="text-xs text-accent-income mb-2">Inserted {count} draft expenses.</div>}
        <textarea className="block-input font-mono text-xs" rows={10}
          placeholder={'2026-04-23,Acme Corp,42.50,Coffee\n2026-04-24,Staples,18.99,Pens'}
          value={text} onChange={e => setText(e.target.value)} />
        <div className="flex justify-end gap-2 mt-4">
          <button className="block-btn" onClick={onClose} disabled={busy}>Close</button>
          <button className="block-btn-primary" onClick={importNow} disabled={busy || !text.trim()}>{busy ? 'Importing...' : 'Import as Drafts'}</button>
        </div>
      </div>
    </div>
  );
};

// ─── Quick add bar (#9) ────────────────────────────────
export const QuickAddBar: React.FC<{ companyId: string; onCreated: (id: string) => void }> = ({ companyId, onCreated }) => {
  const [vendor, setVendor] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayLocal());
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!amount) return;
    setBusy(true);
    try {
      const r = await api.create('expenses', {
        company_id: companyId, date,
        amount: parseFloat(amount) || 0,
        description: vendor, status: 'draft',
        tags: JSON.stringify([]),
      });
      setVendor(''); setAmount('');
      if (r?.id) onCreated(r.id);
    } finally { setBusy(false); }
  };
  return (
    <div className="block-card p-2 flex items-center gap-2">
      <span className="text-xs font-semibold text-text-muted uppercase tracking-wider px-2">Quick Add:</span>
      <input type="text" placeholder="Vendor / description" className="block-input" style={{ flex: 1 }}
        value={vendor} onChange={e => setVendor(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
      <input type="number" step="0.01" placeholder="Amount" className="block-input" style={{ width: 120 }}
        value={amount} onChange={e => setAmount(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
      <input type="date" className="block-input" style={{ width: 150 }}
        value={date} onChange={e => setDate(e.target.value)} />
      <button className="block-btn-primary text-xs" onClick={submit} disabled={busy || !amount}>
        {busy ? 'Saving...' : '+ Draft'}
      </button>
    </div>
  );
};
