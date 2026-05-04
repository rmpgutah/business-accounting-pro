import React, { useEffect, useState } from 'react';
import { ArrowLeft, Settings, Plus, Trash2, Save } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { CategoryRow, CustomFieldDef, parseJSON } from './expense-helpers';

interface Props {
  onBack: () => void;
}

const FIELD_TYPES = ['text', 'number', 'date', 'select', 'boolean'] as const;

/**
 * Feature 7 — Custom field schema editor (entity_type='expense').
 * Feature 24 — Per-category required-field policy editor.
 * Feature 3, 5 — Per-category monthly cap and default account editor.
 */
const ExpenseCategorySettings: React.FC<Props> = ({ onBack }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);

  // Custom field definitions for expenses
  const [defs, setDefs] = useState<CustomFieldDef[]>([]);
  const [newDef, setNewDef] = useState<CustomFieldDef>({
    field_name: '', field_label: '', field_type: 'text', options: [], is_required: 0,
  });
  const [savingDef, setSavingDef] = useState(false);

  // Categories with cap / default account / required fields
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([]);
  const [savingCat, setSavingCat] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCompany) return;
      const cid = activeCompany.id;
      const [d, c, a] = await Promise.all([
        api.query('custom_field_defs', { company_id: cid, entity_type: 'expense' }, { field: 'sort_order', dir: 'asc' }),
        api.query('categories', { company_id: cid, type: 'expense' }),
        api.query('accounts', { company_id: cid, type: 'expense' }),
      ]);
      if (cancelled) return;
      setDefs(Array.isArray(d) ? d.map((x: any) => ({
        ...x,
        options: parseJSON<string[]>(x.options, []),
        is_required: x.is_required ? 1 : 0,
      })) : []);
      setCategories(Array.isArray(c) ? c : []);
      setAccounts(Array.isArray(a) ? a : []);
    };
    load();
    return () => { cancelled = true; };
  }, [activeCompany]);

  const handleAddDef = async () => {
    if (!activeCompany) return;
    if (!newDef.field_name.trim() || !newDef.field_label.trim()) {
      alert('Field name and label are required.');
      return;
    }
    setSavingDef(true);
    try {
      const created = await api.create('custom_field_defs', {
        company_id: activeCompany.id,
        entity_type: 'expense',
        field_name: newDef.field_name.trim().replace(/\s+/g, '_').toLowerCase(),
        field_label: newDef.field_label.trim(),
        field_type: newDef.field_type,
        options: newDef.options || [],
        is_required: newDef.is_required ? 1 : 0,
        sort_order: defs.length,
      });
      setDefs(prev => [...prev, { ...created, options: parseJSON<string[]>(created.options, []) }]);
      setNewDef({ field_name: '', field_label: '', field_type: 'text', options: [], is_required: 0 });
    } catch (err: any) {
      alert('Failed to add field: ' + (err?.message || 'unknown'));
    } finally {
      setSavingDef(false);
    }
  };

  const handleRemoveDef = async (id: string) => {
    if (!confirm('Remove this custom field? Existing data is preserved on expenses.')) return;
    await api.remove('custom_field_defs', id);
    setDefs(prev => prev.filter(d => d.id !== id));
  };

  const handleSaveCategory = async (cat: CategoryRow) => {
    setSavingCat(cat.id);
    try {
      await api.update('categories', cat.id, {
        monthly_cap: cat.monthly_cap || 0,
        default_account_id: cat.default_account_id || '',
        required_fields: typeof cat.required_fields === 'string' ? cat.required_fields : JSON.stringify(cat.required_fields || []),
      });
    } finally {
      setSavingCat('');
    }
  };

  const updateCat = (id: string, patch: Partial<CategoryRow>) => {
    setCategories(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
  };

  return (
    <div className="space-y-6">
      <div className="module-header">
        <div className="flex items-center gap-3">
          <button className="block-btn flex items-center gap-2 px-3 py-2" onClick={onBack}>
            <ArrowLeft size={16} /> Back
          </button>
          <div className="flex items-center gap-2">
            <Settings size={18} className="text-accent-blue" />
            <h2 className="module-title text-text-primary">Expense Settings</h2>
          </div>
        </div>
      </div>

      {/* Custom Fields */}
      <div className="block-card p-5">
        <h3 className="text-sm font-bold uppercase tracking-wider text-text-primary mb-3">Custom Fields</h3>
        <p className="text-xs text-text-muted mb-4">
          Define additional fields rendered on every expense form (stored in <code>expenses.custom_fields</code>).
        </p>
        {defs.length > 0 && (
          <table className="block-table mb-4">
            <thead>
              <tr>
                <th>Key</th><th>Label</th><th>Type</th><th>Options</th><th>Required</th><th></th>
              </tr>
            </thead>
            <tbody>
              {defs.map(d => (
                <tr key={d.id}>
                  <td className="font-mono text-xs">{d.field_name}</td>
                  <td>{d.field_label}</td>
                  <td className="text-xs">{d.field_type}</td>
                  <td className="text-xs text-text-muted">{(d.options || []).join(', ') || '—'}</td>
                  <td>{d.is_required ? 'Yes' : 'No'}</td>
                  <td>
                    <button onClick={() => handleRemoveDef(d.id!)} className="text-accent-expense p-1" title="Remove">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-2">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">Key</label>
            <input className="block-input text-sm" placeholder="po_number"
              value={newDef.field_name}
              onChange={(e) => setNewDef(p => ({ ...p, field_name: e.target.value }))} />
          </div>
          <div className="col-span-3">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">Label</label>
            <input className="block-input text-sm" placeholder="PO Number"
              value={newDef.field_label}
              onChange={(e) => setNewDef(p => ({ ...p, field_label: e.target.value }))} />
          </div>
          <div className="col-span-2">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">Type</label>
            <select className="block-select text-sm" value={newDef.field_type}
              onChange={(e) => setNewDef(p => ({ ...p, field_type: e.target.value as any }))}>
              {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="col-span-3">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">Options (select only, comma-separated)</label>
            <input className="block-input text-sm" placeholder="option1, option2"
              value={(newDef.options || []).join(', ')}
              disabled={newDef.field_type !== 'select'}
              onChange={(e) => setNewDef(p => ({ ...p, options: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))} />
          </div>
          <div className="col-span-1 flex items-center justify-center pb-2">
            <label className="flex items-center gap-1 text-xs">
              <input type="checkbox" checked={!!newDef.is_required}
                onChange={(e) => setNewDef(p => ({ ...p, is_required: e.target.checked ? 1 : 0 }))} />
              Req
            </label>
          </div>
          <div className="col-span-1">
            <button className="block-btn-primary flex items-center gap-1 text-xs px-3 py-2"
              onClick={handleAddDef} disabled={savingDef}>
              <Plus size={12} /> Add
            </button>
          </div>
        </div>
      </div>

      {/* Per-category policies */}
      <div className="block-card p-5">
        <h3 className="text-sm font-bold uppercase tracking-wider text-text-primary mb-3">Category Policies</h3>
        <p className="text-xs text-text-muted mb-4">
          Per-category monthly budget cap, default GL account, and required-field policy.
        </p>
        <table className="block-table">
          <thead>
            <tr>
              <th>Category</th>
              <th style={{ width: 140 }}>Monthly Cap</th>
              <th style={{ width: 200 }}>Default Account</th>
              <th>Required Fields (comma-separated keys)</th>
              <th style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {categories.map(c => {
              const required: string[] = parseJSON<string[]>(c.required_fields, []);
              return (
                <tr key={c.id}>
                  <td className="font-medium text-text-primary">
                    <span className="inline-block w-2 h-2 mr-2" style={{ background: c.color || '#6b7280', borderRadius: '50%' }} />
                    {c.name}
                  </td>
                  <td>
                    <input
                      type="number"
                      step="1"
                      className="block-input text-sm font-mono text-right"
                      value={c.monthly_cap || 0}
                      onChange={(e) => updateCat(c.id, { monthly_cap: parseFloat(e.target.value) || 0 })}
                    />
                  </td>
                  <td>
                    <select className="block-select text-sm"
                      value={c.default_account_id || ''}
                      onChange={(e) => updateCat(c.id, { default_account_id: e.target.value })}>
                      <option value="">— none —</option>
                      {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <input
                      className="block-input text-sm"
                      placeholder="e.g. attendees, business_purpose"
                      value={required.join(', ')}
                      onChange={(e) => updateCat(c.id, {
                        required_fields: JSON.stringify(e.target.value.split(',').map(s => s.trim()).filter(Boolean)),
                      })}
                    />
                  </td>
                  <td>
                    <button className="block-btn flex items-center gap-1 text-xs px-2 py-1"
                      onClick={() => handleSaveCategory(c)}
                      disabled={savingCat === c.id}>
                      <Save size={12} /> {savingCat === c.id ? '…' : 'Save'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ExpenseCategorySettings;
