// src/renderer/components/CustomFieldEditor.tsx
//
// Admin UI: per entity_type, define custom fields. Lets admins set
// label, key, type, options (choices/lookup target/formula expression),
// validation (min/max/regex), required flag, group label, sort order,
// and show_on_print toggle for invoice/quote/credit-note PDFs.
// Also surfaces fill-rate analytics + bulk-fill action.

import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Edit2, Save, X, BarChart2, Wand2 } from 'lucide-react';
import api from '../lib/api';
import { useCompanyStore } from '../stores/companyStore';
import type { FieldDefinition, FieldType } from './CustomFieldRenderer';
import { CustomFieldRenderer } from './CustomFieldRenderer';

const ENTITY_TYPES = [
  'invoice', 'expense', 'client', 'vendor', 'project', 'debt', 'bill',
  'purchase_order', 'employee', 'account', 'journal_entry', 'asset', 'inventory_item',
];

const FIELD_TYPES: FieldType[] = [
  'text', 'textarea', 'number', 'currency', 'date', 'datetime',
  'select', 'multi-select', 'boolean', 'email', 'url', 'phone',
  'formula', 'lookup', 'file',
];

const inputCls = 'w-full bg-bg-tertiary border border-border-primary text-xs px-2 py-1 text-text-primary outline-none focus:border-accent-blue';

interface DraftField {
  id?: string;
  entity_type: string;
  key: string;
  label: string;
  field_type: FieldType;
  options_json: string;
  required: number;
  sort_order: number;
  group_label: string;
  validation_json: string;
  show_on_print: number;
}

const blankDraft = (entity_type: string): DraftField => ({
  entity_type,
  key: '',
  label: '',
  field_type: 'text',
  options_json: '{}',
  required: 0,
  sort_order: 0,
  group_label: 'Custom',
  validation_json: '{}',
  show_on_print: 0,
});

const CustomFieldEditor: React.FC = () => {
  const company = useCompanyStore(s => s.activeCompany);
  const [entityType, setEntityType] = useState<string>('invoice');
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [stats, setStats] = useState<any[]>([]);
  const [draft, setDraft] = useState<DraftField | null>(null);
  const [showStats, setShowStats] = useState(false);

  const refresh = async () => {
    if (!company?.id) return;
    const [f, s] = await Promise.all([
      api.customFieldsList(company.id, entityType),
      api.customFieldsUsageStats(company.id, entityType),
    ]);
    if (Array.isArray(f)) setFields(f);
    if (Array.isArray(s)) setStats(s);
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [company?.id, entityType]);

  const statByKey = useMemo(() => new Map((stats || []).map((s: any) => [s.field_key, s])), [stats]);

  const startNew = () => setDraft(blankDraft(entityType));
  const startEdit = (f: FieldDefinition) => setDraft({
    id: f.id,
    entity_type: f.entity_type,
    key: f.key,
    label: f.label,
    field_type: f.field_type,
    options_json: f.options_json || '{}',
    required: f.required,
    sort_order: f.sort_order,
    group_label: f.group_label,
    validation_json: f.validation_json || '{}',
    show_on_print: f.show_on_print || 0,
  });

  const handleSave = async () => {
    if (!draft || !company?.id) return;
    if (!draft.key || !/^[a-z0-9_]+$/.test(draft.key)) { window.alert('Key must be lowercase alphanumeric/underscore'); return; }
    if (!draft.label.trim()) { window.alert('Label required'); return; }
    try { JSON.parse(draft.options_json); } catch { window.alert('Options must be valid JSON'); return; }
    try { JSON.parse(draft.validation_json); } catch { window.alert('Validation must be valid JSON'); return; }
    if (draft.id) {
      await api.customFieldsUpdate(draft.id, { ...draft });
    } else {
      await api.customFieldsCreate({ company_id: company.id, ...draft });
    }
    setDraft(null);
    refresh();
  };

  const handleDelete = async (f: FieldDefinition) => {
    if (!window.confirm(`Delete field "${f.label}"? Existing values are preserved.`)) return;
    await api.customFieldsDelete(f.id);
    refresh();
  };

  const handleBulkFill = async (f: FieldDefinition) => {
    const value = window.prompt(`Bulk-fill "${f.label}" for all ${entityType} records that don't have it yet. Value:`);
    if (value === null) return;
    if (!company?.id) return;
    const res = await api.customFieldsBulkFill(company.id, entityType, f.key, value);
    window.alert(res?.error ? `Error: ${res.error}` : `Updated ${res?.updated ?? 0} records`);
    refresh();
  };

  return (
    <div className="space-y-3">
      {/* Entity type picker */}
      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-xs text-text-muted">Entity:</label>
        <select className={`${inputCls} w-auto`} value={entityType} onChange={e => setEntityType(e.target.value)}>
          {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <button type="button" onClick={startNew} className="px-2 py-1 bg-accent-blue text-white text-xs flex items-center gap-1" style={{ borderRadius: '3px' }}>
          <Plus size={12} /> New Field
        </button>
        <button
          type="button"
          onClick={() => setShowStats(!showStats)}
          className="px-2 py-1 bg-bg-tertiary border border-border-primary text-xs flex items-center gap-1 ml-auto"
          style={{ borderRadius: '3px' }}
        >
          <BarChart2 size={12} /> {showStats ? 'Hide' : 'Show'} fill-rate
        </button>
      </div>

      {/* Drafts editor */}
      {draft && (
        <div className="block-card space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-text-primary">{draft.id ? 'Edit field' : 'New field'}</div>
            <div className="flex gap-1">
              <button type="button" onClick={handleSave} className="px-2 py-1 bg-accent-green text-white text-xs flex items-center gap-1" style={{ borderRadius: '3px' }}>
                <Save size={12} /> Save
              </button>
              <button type="button" onClick={() => setDraft(null)} className="px-2 py-1 bg-bg-tertiary border border-border-primary text-xs flex items-center gap-1" style={{ borderRadius: '3px' }}>
                <X size={12} /> Cancel
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div>
              <label className="block text-[11px] text-text-muted mb-0.5">Label</label>
              <input className={inputCls} value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} />
            </div>
            <div>
              <label className="block text-[11px] text-text-muted mb-0.5">Key (lowercase, snake_case)</label>
              <input className={inputCls} value={draft.key} onChange={e => setDraft({ ...draft, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} disabled={!!draft.id} />
            </div>
            <div>
              <label className="block text-[11px] text-text-muted mb-0.5">Type</label>
              <select className={inputCls} value={draft.field_type} onChange={e => setDraft({ ...draft, field_type: e.target.value as FieldType })}>
                {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-text-muted mb-0.5">Group label</label>
              <input className={inputCls} value={draft.group_label} onChange={e => setDraft({ ...draft, group_label: e.target.value })} />
            </div>
            <div>
              <label className="block text-[11px] text-text-muted mb-0.5">Sort order</label>
              <input type="number" className={inputCls} value={draft.sort_order} onChange={e => setDraft({ ...draft, sort_order: Number(e.target.value) || 0 })} />
            </div>
            <div className="flex items-end gap-3">
              <label className="text-[11px] text-text-muted flex items-center gap-1">
                <input type="checkbox" checked={!!draft.required} onChange={e => setDraft({ ...draft, required: e.target.checked ? 1 : 0 })} /> Required
              </label>
              <label className="text-[11px] text-text-muted flex items-center gap-1">
                <input type="checkbox" checked={!!draft.show_on_print} onChange={e => setDraft({ ...draft, show_on_print: e.target.checked ? 1 : 0 })} /> Show on print
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-text-muted mb-0.5">
                Options JSON
                <span className="ml-1">
                  {draft.field_type === 'select' || draft.field_type === 'multi-select' ? '({"choices":["a","b"]})' :
                   draft.field_type === 'lookup' ? '({"target_entity":"client"})' :
                   draft.field_type === 'formula' ? '({"expression":"{{quantity}} * {{unit_price}}"})' : '({})'}
                </span>
              </label>
              <textarea className={inputCls} rows={3} value={draft.options_json} onChange={e => setDraft({ ...draft, options_json: e.target.value })} />
            </div>
            <div>
              <label className="block text-[11px] text-text-muted mb-0.5">Validation JSON ({`{"min":0,"max":100,"regex":"^[A-Z]+$"}`})</label>
              <textarea className={inputCls} rows={3} value={draft.validation_json} onChange={e => setDraft({ ...draft, validation_json: e.target.value })} />
            </div>
          </div>

          {/* Live preview */}
          <div className="border-t border-border-primary pt-2">
            <div className="text-[11px] text-text-muted mb-1">Preview</div>
            <CustomFieldRenderer
              def={{
                id: 'preview',
                company_id: company?.id || '',
                entity_type: draft.entity_type,
                key: draft.key || 'preview',
                label: draft.label,
                field_type: draft.field_type,
                options_json: draft.options_json,
                required: draft.required,
                sort_order: 0,
                group_label: draft.group_label,
                validation_json: draft.validation_json,
              }}
              value={undefined}
              onChange={() => {}}
              context={{}}
            />
          </div>
        </div>
      )}

      {/* List */}
      <div className="block-card">
        <table className="w-full text-xs">
          <thead className="text-text-muted">
            <tr className="border-b border-border-primary">
              <th className="text-left py-1.5 px-2">Label</th>
              <th className="text-left py-1.5 px-2">Key</th>
              <th className="text-left py-1.5 px-2">Type</th>
              <th className="text-left py-1.5 px-2">Group</th>
              <th className="text-left py-1.5 px-2">Req</th>
              <th className="text-left py-1.5 px-2">Print</th>
              {showStats && <th className="text-right py-1.5 px-2">Fill rate</th>}
              <th className="text-right py-1.5 px-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {fields.map(f => {
              const stat = statByKey.get(f.key) as any;
              return (
                <tr key={f.id} className="border-b border-border-primary/50">
                  <td className="py-1 px-2 text-text-primary">{f.label}</td>
                  <td className="py-1 px-2 text-text-muted font-mono">{f.key}</td>
                  <td className="py-1 px-2 text-text-muted">{f.field_type}</td>
                  <td className="py-1 px-2 text-text-muted">{f.group_label}</td>
                  <td className="py-1 px-2 text-text-muted">{f.required ? '✓' : ''}</td>
                  <td className="py-1 px-2 text-text-muted">{f.show_on_print ? '✓' : ''}</td>
                  {showStats && (
                    <td className="py-1 px-2 text-right text-text-muted font-mono">
                      {stat ? `${stat.filled}/${stat.total} (${Math.round((stat.fill_rate || 0) * 100)}%)` : '—'}
                    </td>
                  )}
                  <td className="py-1 px-2 text-right">
                    <div className="inline-flex gap-1">
                      <button type="button" onClick={() => handleBulkFill(f)} className="text-text-muted hover:text-text-primary" title="Bulk-fill"><Wand2 size={12} /></button>
                      <button type="button" onClick={() => startEdit(f)} className="text-text-muted hover:text-text-primary" title="Edit"><Edit2 size={12} /></button>
                      <button type="button" onClick={() => handleDelete(f)} className="text-text-muted hover:text-accent-red" title="Delete"><Trash2 size={12} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!fields.length && <tr><td colSpan={showStats ? 8 : 7} className="py-4 px-2 text-center text-text-muted">No custom fields for {entityType}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default CustomFieldEditor;
