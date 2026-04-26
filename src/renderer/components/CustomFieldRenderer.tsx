// src/renderer/components/CustomFieldRenderer.tsx
//
// Renders a single custom-field input based on its type, plus a higher-level
// CustomFieldsSection component that loads all definitions for an entity_type
// and renders them grouped under their group_label. Reusable in any form.

import React, { useEffect, useMemo, useState } from 'react';
import api from '../lib/api';
import { useCompanyStore } from '../stores/companyStore';

export type FieldType =
  | 'text' | 'textarea' | 'number' | 'currency' | 'date' | 'datetime'
  | 'select' | 'multi-select' | 'boolean' | 'email' | 'url' | 'phone'
  | 'formula' | 'lookup' | 'file';

export interface FieldDefinition {
  id: string;
  company_id: string;
  entity_type: string;
  key: string;
  label: string;
  field_type: FieldType;
  options_json: string;
  required: number;
  sort_order: number;
  group_label: string;
  validation_json: string;
  show_on_print?: number;
}

const inputCls = 'w-full bg-bg-tertiary border border-border-primary text-xs px-2 py-1 text-text-primary outline-none focus:border-accent-blue';

// ── Safe arithmetic evaluator (shunting-yard, no eval/Function) ──
// Supports +, -, *, /, parentheses, unary minus/plus. {{var}} substitutions
// are looked up in `context` and inlined as numbers (NaN/missing → 0).
// Limitations: no functions, no boolean ops, no string ops. Returns '' on
// parse error or non-finite result.
export function evaluateFormula(expr: string, context: Record<string, any>): number | string {
  if (!expr) return '';
  const substituted = expr.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => {
    const n = Number(context?.[key]);
    return Number.isFinite(n) ? String(n) : '0';
  });
  try {
    const tokens = tokenize(substituted);
    const rpn = toRpn(tokens);
    const result = evalRpn(rpn);
    return Number.isFinite(result) ? Number(result.toFixed(6)) : '';
  } catch { return ''; }
}

type Tok = { type: 'num'; value: number } | { type: 'op'; value: string } | { type: 'paren'; value: '(' | ')' };

function tokenize(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let prev: Tok | null = null;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (c === '(' || c === ')') { const t: Tok = { type: 'paren', value: c }; out.push(t); prev = t; i++; continue; }
    if ('+-*/'.includes(c)) {
      // unary +/- when at start or after operator/paren-open
      const isUnary = (c === '+' || c === '-') && (!prev || prev.type === 'op' || (prev.type === 'paren' && prev.value === '('));
      if (isUnary) {
        // read number directly
        let j = i + 1; let dot = false;
        while (j < s.length && (/[0-9]/.test(s[j]) || (s[j] === '.' && !dot))) { if (s[j] === '.') dot = true; j++; }
        if (j === i + 1) throw new Error('parse');
        const n = Number(s.slice(i, j));
        if (!Number.isFinite(n)) throw new Error('parse');
        const t: Tok = { type: 'num', value: n }; out.push(t); prev = t; i = j; continue;
      }
      const t: Tok = { type: 'op', value: c }; out.push(t); prev = t; i++; continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i; let dot = false;
      while (j < s.length && (/[0-9]/.test(s[j]) || (s[j] === '.' && !dot))) { if (s[j] === '.') dot = true; j++; }
      const n = Number(s.slice(i, j));
      if (!Number.isFinite(n)) throw new Error('parse');
      const t: Tok = { type: 'num', value: n }; out.push(t); prev = t; i = j; continue;
    }
    throw new Error('parse');
  }
  return out;
}

function toRpn(tokens: Tok[]): Tok[] {
  const out: Tok[] = [];
  const stack: Tok[] = [];
  const prec: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };
  for (const t of tokens) {
    if (t.type === 'num') out.push(t);
    else if (t.type === 'op') {
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.type === 'op' && prec[top.value] >= prec[t.value]) out.push(stack.pop()!);
        else break;
      }
      stack.push(t);
    } else if (t.value === '(') stack.push(t);
    else { // ')'
      while (stack.length && !(stack[stack.length - 1].type === 'paren' && stack[stack.length - 1].value === '(')) out.push(stack.pop()!);
      if (!stack.length) throw new Error('parse');
      stack.pop();
    }
  }
  while (stack.length) {
    const top = stack.pop()!;
    if (top.type === 'paren') throw new Error('parse');
    out.push(top);
  }
  return out;
}

function evalRpn(rpn: Tok[]): number {
  const st: number[] = [];
  for (const t of rpn) {
    if (t.type === 'num') st.push(t.value);
    else if (t.type === 'op') {
      const b = st.pop(); const a = st.pop();
      if (a === undefined || b === undefined) throw new Error('eval');
      switch (t.value) {
        case '+': st.push(a + b); break;
        case '-': st.push(a - b); break;
        case '*': st.push(a * b); break;
        case '/': st.push(b === 0 ? NaN : a / b); break;
        default: throw new Error('eval');
      }
    }
  }
  if (st.length !== 1) throw new Error('eval');
  return st[0];
}

interface RendererProps {
  def: FieldDefinition;
  value: any;
  onChange: (v: any) => void;
  context?: Record<string, any>;
  disabled?: boolean;
}

const LOOKUP_TABLES: Record<string, { table: string; label: string }> = {
  client: { table: 'clients', label: 'name' },
  vendor: { table: 'vendors', label: 'name' },
  project: { table: 'projects', label: 'name' },
  invoice: { table: 'invoices', label: 'invoice_number' },
  employee: { table: 'employees', label: 'name' },
};

const LookupInput: React.FC<RendererProps> = ({ def, value, onChange, disabled }) => {
  let opts: any = {};
  try { opts = JSON.parse(def.options_json || '{}'); } catch { /* */ }
  const target: string = opts.target_entity || 'client';
  const meta = LOOKUP_TABLES[target] || LOOKUP_TABLES.client;
  const company = useCompanyStore(s => s.activeCompany);
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    if (!company?.id) return;
    api.query(meta.table, { company_id: company.id }).then((rows: any) => {
      if (Array.isArray(rows)) setItems(rows);
    });
  }, [company?.id, meta.table]);

  return (
    <select className={inputCls} value={value || ''} onChange={e => onChange(e.target.value)} disabled={disabled}>
      <option value="">— select —</option>
      {items.map(it => (
        <option key={it.id} value={it.id}>{it[meta.label] || it.id}</option>
      ))}
    </select>
  );
};

const FileInput: React.FC<RendererProps> = ({ value, onChange, disabled }) => {
  const handlePick = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => onChange({ filename: f.name, size: f.size, data_url: reader.result });
      reader.readAsDataURL(f);
    };
    input.click();
  };
  const meta: any = (typeof value === 'string' ? safeJson(value) : value) || {};
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={handlePick} disabled={disabled} className="px-2 py-1 bg-bg-tertiary border border-border-primary text-xs">
        {meta?.filename ? 'Replace' : 'Choose file'}
      </button>
      {meta?.filename && <span className="text-[11px] text-text-muted">{meta.filename} ({Math.round((meta.size || 0) / 1024)} KB)</span>}
      {meta?.filename && <button type="button" onClick={() => onChange(null)} className="text-[11px] text-accent-red">Remove</button>}
    </div>
  );
};

function safeJson(s: string): any { try { return JSON.parse(s); } catch { return null; } }

export const CustomFieldRenderer: React.FC<RendererProps> = ({ def, value, onChange, context, disabled }) => {
  const opts = useMemo(() => { try { return JSON.parse(def.options_json || '{}'); } catch { return {}; } }, [def.options_json]);

  switch (def.field_type) {
    case 'textarea':
      return <textarea className={inputCls} rows={3} value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled} />;
    case 'number':
      return <input type="number" className={inputCls} value={value ?? ''} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} disabled={disabled} />;
    case 'currency':
      return <input type="number" step="0.01" className={inputCls} value={value ?? ''} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} disabled={disabled} />;
    case 'date':
      return <input type="date" className={inputCls} value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled} />;
    case 'datetime':
      return <input type="datetime-local" className={inputCls} value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled} />;
    case 'select':
      return (
        <select className={inputCls} value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled}>
          <option value="">—</option>
          {(opts.choices || []).map((c: string) => <option key={c} value={c}>{c}</option>)}
        </select>
      );
    case 'multi-select': {
      const arr: string[] = Array.isArray(value) ? value : safeJson(value) || [];
      const toggle = (c: string) => {
        const next = arr.includes(c) ? arr.filter(x => x !== c) : [...arr, c];
        onChange(next);
      };
      return (
        <div className="flex flex-wrap gap-1">
          {(opts.choices || []).map((c: string) => (
            <button
              type="button" key={c} disabled={disabled} onClick={() => toggle(c)}
              className={`px-2 py-0.5 text-[11px] border ${arr.includes(c) ? 'bg-accent-blue text-white border-accent-blue' : 'bg-bg-tertiary border-border-primary text-text-muted'}`}
              style={{ borderRadius: '3px' }}
            >{c}</button>
          ))}
        </div>
      );
    }
    case 'boolean':
      return <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} disabled={disabled} />;
    case 'email':
      return <input type="email" className={inputCls} value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled} />;
    case 'url':
      return <input type="url" className={inputCls} value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled} />;
    case 'phone':
      return <input type="tel" className={inputCls} value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled} />;
    case 'formula': {
      const expr = opts.expression || '';
      const computed = evaluateFormula(expr, context || {});
      return (
        <div className="flex items-center gap-2">
          <input className={inputCls} value={String(computed)} readOnly disabled />
          <span className="text-[10px] text-text-muted font-mono" title={expr}>= {expr.length > 28 ? expr.slice(0, 28) + '…' : expr}</span>
        </div>
      );
    }
    case 'lookup':
      return <LookupInput def={def} value={value} onChange={onChange} disabled={disabled} />;
    case 'file':
      return <FileInput def={def} value={value} onChange={onChange} disabled={disabled} />;
    case 'text':
    default:
      return <input type="text" className={inputCls} value={value ?? ''} onChange={e => onChange(e.target.value)} disabled={disabled} />;
  }
};

interface CustomFieldsSectionProps {
  entityType: string;
  entityId?: string;
  values?: Record<string, any>;
  onChange?: (next: Record<string, any>) => void;
  context?: Record<string, any>;
  disabled?: boolean;
}

export const CustomFieldsSection: React.FC<CustomFieldsSectionProps> = ({
  entityType, entityId, values, onChange, context, disabled,
}) => {
  const company = useCompanyStore(s => s.activeCompany);
  const [defs, setDefs] = useState<FieldDefinition[]>([]);
  const [internal, setInternal] = useState<Record<string, any>>({});
  const controlled = values !== undefined && onChange !== undefined;
  const current = controlled ? values! : internal;

  useEffect(() => {
    if (!company?.id) return;
    api.customFieldsList(company.id, entityType).then((rows: any) => {
      if (Array.isArray(rows)) setDefs(rows);
    });
  }, [company?.id, entityType]);

  useEffect(() => {
    if (controlled || !company?.id || !entityId) return;
    api.customFieldsGetValues(company.id, entityType, entityId).then((rows: any) => {
      if (!Array.isArray(rows)) return;
      const map: Record<string, any> = {};
      for (const r of rows) {
        if (r.value_text !== null) map[r.field_key] = r.value_text;
        else if (r.value_number !== null) map[r.field_key] = r.value_number;
        else if (r.value_date !== null) map[r.field_key] = r.value_date;
        else if (r.value_json !== null) { try { map[r.field_key] = JSON.parse(r.value_json); } catch { map[r.field_key] = r.value_json; } }
      }
      setInternal(map);
    });
  }, [controlled, company?.id, entityType, entityId]);

  const updateField = (key: string, v: any) => {
    const next = { ...current, [key]: v };
    if (controlled) onChange!(next);
    else setInternal(next);
  };

  if (!defs.length) return null;

  const groups = new Map<string, FieldDefinition[]>();
  for (const d of defs) {
    const g = d.group_label || 'Custom';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(d);
  }

  return (
    <div className="space-y-3">
      {[...groups.entries()].map(([groupLabel, fields]) => (
        <div key={groupLabel} className="block-card space-y-2">
          <div className="text-xs font-semibold text-text-primary border-b border-border-primary pb-1">{groupLabel}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {fields.map(def => (
              <div key={def.id}>
                <label className="block text-[11px] text-text-muted mb-0.5">
                  {def.label}{def.required ? <span className="text-accent-red"> *</span> : null}
                </label>
                <CustomFieldRenderer
                  def={def}
                  value={current[def.key]}
                  onChange={(v) => updateField(def.key, v)}
                  context={{ ...(context || {}), ...current }}
                  disabled={disabled}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default CustomFieldRenderer;
