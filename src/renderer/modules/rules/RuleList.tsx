// src/renderer/modules/rules/RuleList.tsx
import React from 'react';
import { Edit2, Trash2, ToggleLeft, ToggleRight, Plus } from 'lucide-react';
import { formatDate } from '../../lib/format';

interface Rule {
  id: string; name: string; category: string; trigger: string;
  is_active: number; applied_count: number; last_run_at: string | null; priority: number;
}
interface Props {
  rules: Rule[];
  onEdit: (rule: Rule) => void;
  onDelete: (id: string) => void;
  onToggle: (id: string, is_active: boolean) => void;
  onNew: () => void;
}

export const RuleList: React.FC<Props> = ({ rules, onEdit, onDelete, onToggle, onNew }) => (
  <div>
    <div className="flex justify-between items-center mb-4">
      <span className="text-xs text-text-muted uppercase tracking-widest font-bold">{rules.length} rule{rules.length !== 1 ? 's' : ''}</span>
      <button onClick={onNew} className="flex items-center gap-2 bg-accent-blue text-white px-3 py-2 text-xs font-bold uppercase tracking-wider hover:opacity-90">
        <Plus size={14} /> New Rule
      </button>
    </div>
    {rules.length === 0 && (
      <div className="border border-dashed border-border-secondary p-8 text-center text-sm text-text-muted">No rules yet — click New Rule to create one</div>
    )}
    {rules.map(rule => (
      <div key={rule.id} className="border border-border-primary bg-bg-secondary mb-2 flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => onToggle(rule.id, !rule.is_active)}>
            {rule.is_active
              ? <ToggleRight size={20} className="text-accent-blue" />
              : <ToggleLeft size={20} className="text-text-muted" />}
          </button>
          <div>
            <div className="font-bold text-sm">{rule.name}</div>
            <div className="text-xs text-text-muted">
              Priority <span className="capitalize">{rule.priority}</span> · Applied {rule.applied_count}&times;
              {rule.last_run_at ? ` · Last: ${formatDate(rule.last_run_at)}` : ''}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => onEdit(rule)} className="p-1.5 border border-border-primary hover:border-accent-blue"><Edit2 size={14} /></button>
          <button onClick={() => onDelete(rule.id)} className="p-1.5 border border-border-primary hover:border-red-400 text-accent-expense"><Trash2 size={14} /></button>
        </div>
      </div>
    ))}
  </div>
);
