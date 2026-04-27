// src/renderer/components/QuickCreate.tsx
import React, { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';

const COMMANDS = [
  { label: 'New Invoice',       view: 'invoicing',     hint: 'inv' },
  { label: 'New Expense',       view: 'expenses',      hint: 'exp' },
  { label: 'New Client',        view: 'clients',       hint: 'cli' },
  { label: 'New Vendor',        view: 'expenses',      hint: 'ven' },
  { label: 'New Employee',      view: 'payroll',       hint: 'emp' },
  { label: 'New Journal Entry', view: 'accounts',      hint: 'jou' },
  { label: 'New Bill',          view: 'bills',         hint: 'bil' },
  { label: 'New Project',       view: 'projects',      hint: 'pro' },
  { label: 'New Time Entry',    view: 'time-tracking', hint: 'tim' },
  { label: 'New Debt',          view: 'debt-collection', hint: 'dbt' },
];

interface Props { onNavigate: (view: string) => void; onClose: () => void; }

export const QuickCreate: React.FC<Props> = ({ onNavigate, onClose }) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered = COMMANDS.filter(c =>
    c.label.toLowerCase().includes(query.toLowerCase()) || c.hint.includes(query.toLowerCase())
  );

  const select = (view: string) => { onNavigate(view); onClose(); };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start justify-center pt-32 z-50" onClick={onClose} role="presentation">
      {/* A11Y: dialog role + aria-modal so screen readers announce the popover */}
      <div role="dialog" aria-modal="true" aria-label="Quick create" className="bg-bg-secondary w-full max-w-md border border-border-primary shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-primary">
          <Search size={16} className="text-text-muted flex-shrink-0" />
          <input ref={inputRef} className="flex-1 outline-none text-sm bg-transparent"
            placeholder="Create something… (inv, exp, cli…)"
            value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'Enter' && filtered.length > 0) select(filtered[0].view);
            }} />
          <button onClick={onClose} aria-label="Close quick create"><X size={16} className="text-text-muted" /></button>
        </div>
        {filtered.map((c, i) => (
          <button key={i} onClick={() => select(c.view)}
            className="w-full text-left px-4 py-3 text-sm font-medium hover:bg-accent-blue-bg border-b border-border-primary last:border-0 flex items-center justify-between">
            {c.label}
            <span className="text-xs text-text-muted font-mono">{c.hint}</span>
          </button>
        ))}
        {filtered.length === 0 && <div className="px-4 py-3 text-sm text-text-muted">No matches</div>}
      </div>
    </div>
  );
};
