// src/renderer/modules/expenses/AllocationEditor.tsx
//
// Split an expense across multiple targets (clients / projects / debts /
// departments / custom buckets) by percent or fixed amount. Controlled
// component — the parent (ExpenseForm) owns the rows and persists them via
// api.expenseAllocationsSave() after the expense itself saves.
//
// Templates: common splits can be saved by name and re-applied with one
// click (persisted per-company via expense-alloc-templates IPC).

import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, PieChart, Save, ChevronDown } from 'lucide-react';
import api from '../../lib/api';

export interface AllocationRow {
  target_type: 'client' | 'project' | 'debt' | 'department' | 'category' | 'custom';
  target_id: string;
  target_name: string;
  percent: number;   // 0 when amount-mode
  amount: number;    // 0 when percent-mode
  is_billable: boolean;
  note: string;
}

export const emptyAllocation = (): AllocationRow => ({
  target_type: 'client', target_id: '', target_name: '',
  percent: 0, amount: 0, is_billable: false, note: '',
});

interface Option { id: string; name: string }

interface Props {
  expenseTotal: number;
  rows: AllocationRow[];
  onChange: (rows: AllocationRow[]) => void;
  clients: Option[];
  projects: Option[];
  debts: Option[];
}

const TARGET_LABELS: Record<AllocationRow['target_type'], string> = {
  client: 'Client', project: 'Project', debt: 'Debt Case',
  department: 'Department', category: 'Category', custom: 'Custom',
};

const AllocationEditor: React.FC<Props> = ({ expenseTotal, rows, onChange, clients, projects, debts }) => {
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; splits: string }>>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);

  useEffect(() => {
    api.expenseAllocTemplatesList()
      .then((r) => { if (Array.isArray(r)) setTemplates(r as any); })
      .catch(() => {});
  }, []);

  const optionsFor = (t: AllocationRow['target_type']): Option[] | null => {
    if (t === 'client') return clients;
    if (t === 'project') return projects;
    if (t === 'debt') return debts;
    return null; // department/category/custom are free-text
  };

  const update = (idx: number, patch: Partial<AllocationRow>) => {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  // Resolved dollar value of each row (percent rows resolve against total).
  const resolved = useMemo(() => rows.map((r) =>
    r.amount > 0 ? r.amount : Math.round(((r.percent / 100) * expenseTotal) * 100) / 100
  ), [rows, expenseTotal]);

  const allocatedTotal = Math.round(resolved.reduce((s, v) => s + v, 0) * 100) / 100;
  const remainder = Math.round((expenseTotal - allocatedTotal) * 100) / 100;
  const overAllocated = expenseTotal > 0 && allocatedTotal > expenseTotal + 0.01;

  const applyTemplate = (tpl: { splits: string }) => {
    try {
      const splits = JSON.parse(tpl.splits || '[]');
      if (Array.isArray(splits) && splits.length) {
        onChange(splits.map((s: any) => ({
          ...emptyAllocation(),
          target_type: s.target_type || 'custom',
          target_id: s.target_id || '',
          target_name: s.target_name || '',
          percent: Number(s.percent) || 0,
        })));
      }
    } catch { /* malformed template — ignore */ }
    setShowTemplates(false);
  };

  const saveAsTemplate = async () => {
    const name = prompt('Template name (e.g. "60/40 Office Split"):');
    if (!name?.trim()) return;
    setSavingTemplate(true);
    try {
      const r = await api.expenseAllocTemplateSave({
        name: name.trim(),
        splits: rows.map((x) => ({
          target_type: x.target_type, target_id: x.target_id,
          target_name: x.target_name, percent: x.percent,
        })),
      });
      if (r?.ok) {
        const list = await api.expenseAllocTemplatesList();
        if (Array.isArray(list)) setTemplates(list as any);
      }
    } finally {
      setSavingTemplate(false);
    }
  };

  return (
    <div className="space-y-2">
      {rows.map((r, idx) => {
        const opts = optionsFor(r.target_type);
        return (
          <div key={idx} className="grid items-center gap-2" style={{ gridTemplateColumns: '110px 1fr 70px 80px 60px 28px' }}>
            <select
              className="block-input text-xs"
              value={r.target_type}
              onChange={(e) => update(idx, { target_type: e.target.value as AllocationRow['target_type'], target_id: '', target_name: '' })}
            >
              {(Object.keys(TARGET_LABELS) as Array<AllocationRow['target_type']>).map((t) => (
                <option key={t} value={t}>{TARGET_LABELS[t]}</option>
              ))}
            </select>
            {opts ? (
              <select
                className="block-input text-xs"
                value={r.target_id}
                onChange={(e) => {
                  const o = opts.find((x) => x.id === e.target.value);
                  update(idx, { target_id: e.target.value, target_name: o?.name || '' });
                }}
              >
                <option value="">— Select {TARGET_LABELS[r.target_type]} —</option>
                {opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            ) : (
              <input
                className="block-input text-xs"
                placeholder={`${TARGET_LABELS[r.target_type]} name`}
                value={r.target_name}
                onChange={(e) => update(idx, { target_name: e.target.value })}
              />
            )}
            <input
              type="number" min={0} max={100} step={0.5}
              className="block-input text-xs text-right"
              placeholder="%"
              title="Percent of the expense total (leave 0 when using a fixed amount)"
              value={r.percent || ''}
              onChange={(e) => update(idx, { percent: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)), amount: 0 })}
            />
            <input
              type="number" min={0} step={0.01}
              className="block-input text-xs text-right font-mono"
              placeholder="$ amt"
              title="Fixed dollar amount (overrides percent)"
              value={r.amount || ''}
              onChange={(e) => update(idx, { amount: Math.max(0, parseFloat(e.target.value) || 0), percent: 0 })}
            />
            <label className="flex items-center gap-1 text-[10px] text-text-muted cursor-pointer" title="Mark this share as billable to the target">
              <input type="checkbox" checked={r.is_billable} onChange={(e) => update(idx, { is_billable: e.target.checked })} className="accent-accent-blue" />
              Bill
            </label>
            <button type="button" className="text-text-muted hover:text-accent-expense p-1" onClick={() => onChange(rows.filter((_, i) => i !== idx))} title="Remove split">
              <Trash2 size={12} />
            </button>
          </div>
        );
      })}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button type="button" className="block-btn text-xs flex items-center gap-1" onClick={() => onChange([...rows, emptyAllocation()])}>
            <Plus size={11} /> Add Split
          </button>
          {templates.length > 0 && (
            <div className="relative">
              <button type="button" className="block-btn text-xs flex items-center gap-1" onClick={() => setShowTemplates((v) => !v)}>
                Templates <ChevronDown size={11} />
              </button>
              {showTemplates && (
                <div className="absolute z-50 mt-1 block-card p-1" style={{ minWidth: 180, borderRadius: 6 }}>
                  {templates.map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-1 px-2 py-1 hover:bg-bg-tertiary" style={{ borderRadius: 4 }}>
                      <button type="button" className="text-xs text-text-primary text-left flex-1" onClick={() => applyTemplate(t)}>
                        {t.name}
                      </button>
                      <button
                        type="button"
                        className="text-text-muted hover:text-accent-expense"
                        title="Delete template"
                        onClick={async () => {
                          await api.expenseAllocTemplateDelete(t.id);
                          setTemplates((prev) => prev.filter((x) => x.id !== t.id));
                        }}
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {rows.length > 0 && (
            <button type="button" className="block-btn text-xs flex items-center gap-1" disabled={savingTemplate} onClick={saveAsTemplate} title="Save this split as a reusable template">
              <Save size={11} /> {savingTemplate ? 'Saving…' : 'Save as Template'}
            </button>
          )}
        </div>

        {rows.length > 0 && (
          <div className="flex items-center gap-2 text-[11px]" style={{ fontFamily: 'SF Mono, Menlo, monospace' }}>
            <PieChart size={12} className={overAllocated ? 'text-accent-expense' : 'text-accent-blue'} />
            <span className={overAllocated ? 'text-accent-expense font-bold' : 'text-text-secondary'}>
              Allocated {allocatedTotal.toFixed(2)} of {expenseTotal.toFixed(2)}
            </span>
            {!overAllocated && remainder > 0.009 && (
              <span className="text-text-muted">· {remainder.toFixed(2)} unallocated</span>
            )}
            {overAllocated && <span className="font-bold">OVER-ALLOCATED</span>}
          </div>
        )}
      </div>
    </div>
  );
};

export default AllocationEditor;
