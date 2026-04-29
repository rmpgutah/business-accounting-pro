// src/renderer/components/CommandPalette.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, ArrowRight, Clock, Zap } from 'lucide-react';
import api from '../lib/api';
import { useAppStore } from '../stores/appStore';
import { useCompanyStore } from '../stores/companyStore';
import { parseCommand } from '../lib/commandParser';
import { RENDERER_COMMANDS, findCommands, type RendererCommand } from './CommandPaletteCommands';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

interface SearchResult {
  type: 'command' | 'entity' | 'parsed';
  command?: RendererCommand;
  entity?: { id: string; type: string; label: string; subtitle?: string };
  parsed?: { description: string; action: () => void };
}

const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [entities, setEntities] = useState<any[]>([]);
  const [recent, setRecent] = useState<RendererCommand[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const setModule = useAppStore((s) => s.setModule);
  const setFocusEntity = useAppStore((s) => s.setFocusEntity);
  const activeCompany = useCompanyStore((s) => s.activeCompany);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
      api.frequentCommands('anon', 5).then((rows: any[]) => {
        const ids = (rows || []).map((r: any) => r.command_id);
        setRecent(RENDERER_COMMANDS.filter(c => ids.includes(c.id)));
      }).catch(() => {});
    }
  }, [isOpen]);

  useEffect(() => {
    if (!query.trim() || !activeCompany) { setEntities([]); return; }
    const q = query.trim();
    if (q.length < 2) { setEntities([]); return; }
    const sql = `
      SELECT 'invoice' as type, id, invoice_number as label, total as subtitle
      FROM invoices WHERE company_id = ? AND (invoice_number LIKE ? OR notes LIKE ?) LIMIT 5
      UNION ALL
      SELECT 'client' as type, id, name as label, email as subtitle
      FROM clients WHERE company_id = ? AND (name LIKE ? OR email LIKE ?) LIMIT 5
      UNION ALL
      SELECT 'expense' as type, id, description as label, CAST(amount AS TEXT) as subtitle
      FROM expenses WHERE company_id = ? AND description LIKE ? LIMIT 5
    `;
    const like = `%${q}%`;
    api.rawQuery(sql, [activeCompany.id, like, like, activeCompany.id, like, like, activeCompany.id, like])
      .then((rows: any[]) => setEntities(Array.isArray(rows) ? rows : []))
      .catch(() => setEntities([]));
  }, [query, activeCompany]);

  const parsed = useMemo(() => parseCommand(query), [query]);

  const results = useMemo<SearchResult[]>(() => {
    const cmds: SearchResult[] = findCommands(query).map(c => ({ type: 'command' as const, command: c }));
    const ents: SearchResult[] = entities.map(e => ({
      type: 'entity' as const,
      entity: { id: e.id, type: e.type, label: e.label || '(unnamed)', subtitle: e.subtitle ? String(e.subtitle) : undefined },
    }));
    const intents: SearchResult[] = [];
    if (parsed.type === 'expense.create' && parsed.amount) {
      intents.push({
        type: 'parsed',
        parsed: {
          description: `Create expense: $${parsed.amount} for "${parsed.description || ''}"`,
          action: () => { setModule('expenses'); onClose(); },
        },
      });
    }
    if (parsed.type === 'navigate' && parsed.module) {
      intents.push({
        type: 'parsed',
        parsed: {
          description: `Navigate to ${parsed.module} ${parsed.identifier}`,
          action: () => { setModule(parsed.module!); onClose(); },
        },
      });
    }
    return [...intents, ...cmds, ...ents];
  }, [query, entities, parsed, setModule, onClose]);

  const executeResult = async (r: SearchResult) => {
    const t0 = performance.now();
    if (r.type === 'command' && r.command) {
      r.command.execute({ setModule, setFocusEntity });
      try {
        await api.logCommandExecution({
          command_id: r.command.id,
          params: {},
          result: 'success',
          duration_ms: performance.now() - t0,
        });
      } catch {}
    } else if (r.type === 'entity' && r.entity) {
      const moduleMap: Record<string, string> = {
        invoice: 'invoicing', expense: 'expenses', client: 'clients',
        vendor: 'vendors', quote: 'quotes', debt: 'debt-collection',
      };
      const mod = moduleMap[r.entity.type] || r.entity.type;
      setFocusEntity?.({ type: r.entity.type, id: r.entity.id });
      setModule(mod);
    } else if (r.type === 'parsed' && r.parsed) {
      r.parsed.action();
    }
    onClose();
  };

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx(i => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const r = results[selectedIdx];
        if (r) executeResult(r);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, results, selectedIdx, onClose]);

  if (!isOpen) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '12vh',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="block-card-elevated"
        style={{
          width: '600px', maxWidth: '90vw',
          maxHeight: '70vh', overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          borderRadius: '6px',
        }}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-primary">
          <Search size={16} className="text-text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIdx(0); }}
            placeholder="Type a command or search... (try: $45 lunch, inv 1024, pay 100 invoice X)"
            className="flex-1 bg-transparent border-none outline-none text-sm text-text-primary placeholder-text-muted"
          />
          <span
            className="text-[10px] text-text-muted font-mono px-2 py-1 border border-border-primary"
            style={{ borderRadius: '4px' }}
          >
            ESC
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {!query && recent.length > 0 && (
            <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-text-muted font-semibold flex items-center gap-1">
              <Clock size={10} /> Recent
            </div>
          )}
          {!query && recent.map((c, i) => (
            <ResultRow
              key={c.id}
              label={c.label}
              icon={<Clock size={14} className="text-text-muted" />}
              selected={selectedIdx === i}
              onClick={() => executeResult({ type: 'command', command: c })}
            />
          ))}

          {results.length > 0 && (
            <>
              {results.some(r => r.type === 'parsed') && (
                <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-text-muted font-semibold flex items-center gap-1">
                  <Zap size={10} /> Quick Actions
                </div>
              )}
              {results.map((r, i) => (
                <ResultRow
                  key={i}
                  label={
                    r.type === 'command' ? r.command!.label
                    : r.type === 'entity' ? `${r.entity!.type.toUpperCase()}: ${r.entity!.label}`
                    : r.parsed!.description
                  }
                  subtitle={r.type === 'entity' ? r.entity!.subtitle : undefined}
                  icon={
                    r.type === 'parsed' ? <Zap size={14} className="text-accent-blue" />
                    : <ArrowRight size={14} className="text-text-muted" />
                  }
                  selected={selectedIdx === i}
                  onClick={() => executeResult(r)}
                />
              ))}
            </>
          )}

          {query && results.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-text-muted">
              No commands or matches found.
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-border-primary flex items-center justify-between text-[10px] text-text-muted">
          <span>↑↓ Navigate · ↵ Execute · ESC Close</span>
          <span>{results.length} results</span>
        </div>
      </div>
    </div>
  );
};

const ResultRow: React.FC<{
  label: string; subtitle?: string; icon: React.ReactNode;
  selected: boolean; onClick: () => void;
}> = ({ label, subtitle, icon, selected, onClick }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
      selected ? 'bg-bg-tertiary text-text-primary' : 'hover:bg-bg-hover text-text-secondary'
    }`}
  >
    {icon}
    <div className="flex-1 min-w-0">
      <div className="text-sm font-medium truncate">{label}</div>
      {subtitle && <div className="text-xs text-text-muted truncate">{subtitle}</div>}
    </div>
  </button>
);

export default CommandPalette;
