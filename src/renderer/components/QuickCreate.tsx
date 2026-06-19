// src/renderer/components/QuickCreate.tsx
import React, { useState, useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';

const COMMANDS = [
  { label: 'New Invoice',       view: 'invoicing',       hint: 'inv' },
  { label: 'New Expense',       view: 'expenses',        hint: 'exp' },
  { label: 'New Client',        view: 'clients',         hint: 'cli' },
  { label: 'New Vendor',        view: 'expenses',        hint: 'ven' },
  { label: 'New Employee',      view: 'payroll',         hint: 'emp' },
  { label: 'New Journal Entry', view: 'accounts',        hint: 'jou' },
  { label: 'New Bill',          view: 'bills',           hint: 'bil' },
  { label: 'New Project',       view: 'projects',        hint: 'pro' },
  { label: 'New Time Entry',    view: 'time-tracking',   hint: 'tim' },
  { label: 'New Debt',          view: 'debt-collection', hint: 'dbt' },
];

interface Props { onNavigate: (view: string) => void; onClose: () => void; }

export const QuickCreate: React.FC<Props> = ({ onNavigate, onClose }) => {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const q = query.toLowerCase();
  const filtered = COMMANDS.filter(c =>
    c.label.toLowerCase().includes(q) || c.hint.includes(q)
  );

  // Keep active within bounds when the filtered list changes
  useEffect(() => {
    if (active >= filtered.length) setActive(0);
  }, [filtered.length, active]);

  const select = (view: string) => { onNavigate(view); onClose(); };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-start justify-center pt-32 z-50"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md bg-bg-elevated border border-border-primary shadow-2xl"
        style={{ borderRadius: '2px' }}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Quick create"
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-primary">
          <Search size={16} className="text-text-muted flex-shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            className="flex-1 outline-none text-sm bg-transparent text-text-primary placeholder:text-text-muted"
            placeholder="Create something… (inv, exp, cli…)"
            value={query}
            onChange={e => { setQuery(e.target.value); setActive(0); }}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Quick create search"
            onKeyDown={e => {
              if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive(i => Math.min(filtered.length - 1, i + 1));
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive(i => Math.max(0, i - 1));
                return;
              }
              if (e.key === 'Enter' && filtered.length > 0) {
                e.preventDefault();
                const item = filtered[active] ?? filtered[0];
                select(item.view);
              }
            }}
          />
          <button type="button" onClick={onClose} aria-label="Close quick create" style={{ borderRadius: '2px' }}>
            <X size={16} className="text-text-muted hover:text-text-primary" />
          </button>
        </div>
        <ul role="listbox" aria-label="Quick create options" className="max-h-80 overflow-y-auto">
          {filtered.map((c, i) => {
            const isActive = i === active;
            return (
              <li key={`${c.view}-${c.hint}`} role="option" aria-selected={isActive}>
                <button
                  type="button"
                  onClick={() => select(c.view)}
                  onMouseEnter={() => setActive(i)}
                  className={`w-full text-left px-4 py-3 text-sm font-medium border-b border-border-primary last:border-0 flex items-center justify-between ${
                    isActive ? 'bg-bg-hover text-text-primary' : 'text-text-secondary hover:bg-bg-hover'
                  }`}
                >
                  {c.label}
                  <span className="text-xs text-text-muted font-mono">{c.hint}</span>
                </button>
              </li>
            );
          })}
          {filtered.length === 0 && <li className="px-4 py-3 text-sm text-text-muted">No matches</li>}
        </ul>
      </div>
    </div>
  );
};

export default QuickCreate;
