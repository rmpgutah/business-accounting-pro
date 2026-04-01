// src/renderer/modules/rules/RuleForm.tsx
import React, { useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';

const CONDITION_FIELDS: Record<string, string[]> = {
  pricing:    ['client_id','invoice_total','quantity','line_item_category'],
  tax:        ['client_state','client_country','line_item_description','expense_category','account_code'],
  approval:   ['amount_gt','vendor_id','expense_category','invoice_total','client_id'],
  alert:      ['cash_balance','invoice_overdue_count','receivables_total','account_balance'],
  bank:       ['description','reference','amount'],
  automation: ['invoice_overdue_days','bill_due_days'],
};

const ACTION_TYPES: Record<string, string[]> = {
  pricing:    ['discount','markup','set_unit_price'],
  tax:        ['set_tax_rate'],
  approval:   ['flag_approval'],
  alert:      ['notify','send_email'],
  bank:       ['set_account','set_description'],
  automation: ['set_description','notify'],
};

const OPS = ['eq','neq','lt','lte','gt','gte','contains','starts_with','ends_with','in','regex','between'];

const TRIGGER_FOR: Record<string, string> = {
  pricing: 'on_save', tax: 'on_save', bank: 'manual',
  approval: 'on_save', alert: 'scheduled', automation: 'scheduled',
};

interface Props { category: string; rule?: any; onSave: () => void; onCancel: () => void; }

export const RuleForm: React.FC<Props> = ({ category, rule, onSave, onCancel }) => {
  const { activeCompany } = useCompanyStore();
  const [name, setName] = useState(rule?.name ?? '');
  const [priority, setPriority] = useState(String(rule?.priority ?? '0'));
  const [conditions, setConditions] = useState<any[]>(rule ? JSON.parse(rule.conditions ?? '[]') : []);
  const [actions, setActions] = useState<any[]>(rule ? JSON.parse(rule.actions ?? '[]') : []);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const addCondition = () => setConditions(prev => [...prev, { field: CONDITION_FIELDS[category]?.[0] ?? '', op: 'eq', value: '' }]);
  const addAction = () => setActions(prev => [...prev, { type: ACTION_TYPES[category]?.[0] ?? 'notify', value: '', method: 'percent', message: '' }]);

  const handleSave = async () => {
    if (!name.trim()) { setError('Rule name is required.'); return; }
    const parsedPriority = parseInt(priority, 10);
    if (isNaN(parsedPriority)) { setError('Priority must be a number.'); return; }
    setSaving(true);
    const data = {
      company_id: activeCompany!.id, category, name: name.trim(),
      priority: parsedPriority, is_active: 1,
      trigger: TRIGGER_FOR[category] ?? 'manual',
      conditions: JSON.stringify(conditions),
      actions: JSON.stringify(actions),
    };
    if (rule?.id) { await api.updateRule(rule.id, data); }
    else { await api.createRule(data); }
    onSave();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-gray-200">
        <div className="flex justify-between items-center p-4 border-b border-gray-200">
          <h2 className="font-black uppercase tracking-wider text-sm">{rule ? 'Edit' : 'New'} {category} Rule</h2>
          <button onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="p-4 space-y-4">
          {error && <div className="bg-red-50 border border-red-300 text-red-700 text-xs p-2">{error}</div>}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1">Rule Name</label>
            <input
              className="block-input"
              value={name}
              onChange={e => { setName(e.target.value); setError(''); }}
              placeholder="e.g. Gold client 15% discount"
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1">Priority (lower = evaluated first)</label>
            <input
              className="block-input w-32"
              value={priority}
              onChange={e => setPriority(e.target.value)}
              placeholder="0"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-bold uppercase tracking-wider">Conditions (ALL must match)</label>
              <button onClick={addCondition} className="flex items-center gap-1 text-xs text-indigo-600 font-bold hover:underline"><Plus size={12} /> Add Condition</button>
            </div>
            {conditions.map((c, i) => (
              <div key={i} className="flex gap-2 mb-2 items-center">
                <select
                  className="block-select flex-1"
                  value={c.field}
                  onChange={e => setConditions(prev => prev.map((x, j) => j === i ? { ...x, field: e.target.value } : x))}
                >
                  {(CONDITION_FIELDS[category] ?? []).map(f => <option key={f}>{f}</option>)}
                </select>
                <select
                  className="block-select w-32"
                  value={c.op}
                  onChange={e => setConditions(prev => prev.map((x, j) => j === i ? { ...x, op: e.target.value } : x))}
                >
                  {OPS.map(op => <option key={op}>{op}</option>)}
                </select>
                <input
                  className="block-input flex-1"
                  value={String(c.value ?? '')}
                  placeholder="value"
                  onChange={e => setConditions(prev => prev.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                />
                <button onClick={() => setConditions(prev => prev.filter((_, j) => j !== i))}><Trash2 size={14} className="text-red-400" /></button>
              </div>
            ))}
            {conditions.length === 0 && <p className="text-xs text-gray-400 italic">No conditions — rule will match all records</p>}
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-bold uppercase tracking-wider">Actions</label>
              <button onClick={addAction} className="flex items-center gap-1 text-xs text-indigo-600 font-bold hover:underline"><Plus size={12} /> Add Action</button>
            </div>
            {actions.map((a, i) => (
              <div key={i} className="flex gap-2 mb-2 items-center">
                <select
                  className="block-select flex-1"
                  value={a.type}
                  onChange={e => setActions(prev => prev.map((x, j) => j === i ? { ...x, type: e.target.value } : x))}
                >
                  {(ACTION_TYPES[category] ?? []).map(t => <option key={t}>{t}</option>)}
                </select>
                {(a.type === 'discount' || a.type === 'markup') && (
                  <select
                    className="block-select w-20"
                    value={a.method ?? 'percent'}
                    onChange={e => setActions(prev => prev.map((x, j) => j === i ? { ...x, method: e.target.value } : x))}
                  >
                    <option value="percent">%</option>
                    <option value="fixed">$</option>
                  </select>
                )}
                {a.type !== 'flag_approval' && (
                  <input
                    className="block-input flex-1"
                    value={String(a.type === 'notify' || a.type === 'send_email' ? (a.message ?? '') : (a.value ?? ''))}
                    placeholder={a.type === 'notify' || a.type === 'send_email' ? 'Alert message' : 'value'}
                    onChange={e => setActions(prev => prev.map((x, j) => j === i
                      ? (a.type === 'notify' || a.type === 'send_email' ? { ...x, message: e.target.value } : { ...x, value: e.target.value })
                      : x))}
                  />
                )}
                <button onClick={() => setActions(prev => prev.filter((_, j) => j !== i))}><Trash2 size={14} className="text-red-400" /></button>
              </div>
            ))}
            {actions.length === 0 && <p className="text-xs text-gray-400 italic">No actions added yet</p>}
          </div>
        </div>
        <div className="flex justify-end gap-3 p-4 border-t border-gray-200">
          <button onClick={onCancel} className="px-4 py-2 text-xs font-bold uppercase border border-gray-300 hover:border-gray-500">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-xs font-bold uppercase bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Rule'}
          </button>
        </div>
      </div>
    </div>
  );
};
