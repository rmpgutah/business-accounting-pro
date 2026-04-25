// AccountPicker.tsx
// Reusable type-ahead account picker. Types code or name, shows top matches
// with type/balance. Self-contained popover; no portal.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency } from '../../lib/format';

interface Account {
  id: string; code: string; name: string; type: string;
  is_active: number; balance: number;
}

interface Props {
  value: string | null;
  onChange: (id: string | null, account: Account | null) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

const AccountPicker: React.FC<Props> = ({ value, onChange, placeholder = 'Type code or name...', className, autoFocus }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeCompany) return;
    api.rawQuery(
      `SELECT id, code, name, type, is_active, COALESCE(balance,0) as balance
       FROM accounts WHERE company_id = ? AND is_active = 1 ORDER BY code`,
      [activeCompany.id]
    ).then((rows: any) => setAccounts(Array.isArray(rows) ? rows : [])).catch(() => {});
  }, [activeCompany]);

  // Sync display when controlled value changes
  useEffect(() => {
    if (!value) { setQuery(''); return; }
    const a = accounts.find((x) => x.id === value);
    if (a) setQuery(`${a.code} — ${a.name}`);
  }, [value, accounts]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts.slice(0, 10);
    return accounts
      .filter((a) => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q))
      .slice(0, 12);
  }, [query, accounts]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const select = (a: Account) => {
    onChange(a.id, a);
    setQuery(`${a.code} — ${a.name}`);
    setOpen(false);
  };

  return (
    <div className={`relative ${className ?? ''}`} ref={wrapRef}>
      <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
      <input
        autoFocus={autoFocus}
        className="block-input pl-7 w-full"
        value={query}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActiveIdx(0); if (!e.target.value) onChange(null, null); }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(matches.length - 1, i + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(0, i - 1)); }
          else if (e.key === 'Enter' && matches[activeIdx]) { e.preventDefault(); select(matches[activeIdx]); }
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && matches.length > 0 && (
        <div className="absolute z-30 mt-1 w-full max-h-72 overflow-auto block-card" style={{ padding: 0 }}>
          {matches.map((a, i) => (
            <button
              key={a.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); select(a); }}
              onMouseEnter={() => setActiveIdx(i)}
              className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 ${i === activeIdx ? 'bg-bg-tertiary' : ''}`}
            >
              <div className="flex flex-col">
                <span className="font-mono">{a.code} <span className="text-text-secondary">{a.name}</span></span>
                <span className="text-text-muted uppercase text-[10px]">{a.type}</span>
              </div>
              <span className="font-mono text-text-muted">{formatCurrency(a.balance)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default AccountPicker;
