// PowerFeatures.tsx — power-user UI features for the accounts module:
//   16: Per-module theme override
//   24: Inline tag editor (chip add/remove)
//   26: Cell history popover (audit_log query)
//   27: Undo/redo stack (Cmd+Z / Cmd+Shift+Z)
//   28: Search-and-replace (Cmd+H)
//   29: Bulk find / select-all-matching (`/`)
//   30: Text-to-JE shortcut (Cmd+K) — fuzzy account match → preview → confirm
//
// This component is a host. It listens for global hotkeys, opens overlay
// panels, and exposes a small demo SpreadsheetGrid to showcase features
// 17-23 + 25 (cell navigation, formulas, fill handle, resize, drag-reorder,
// frozen header/col, smart tooltips, header context menu).

import React, { useEffect, useMemo, useState } from 'react';
import { Search, Replace, Command, History, X, Plus, Tag, Sun, Moon, Undo2, Redo2 } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import SpreadsheetGrid, { GridColumn, GridRow } from './SpreadsheetGrid';
import { formatCurrency } from '../../lib/format';
import { todayLocal } from '../../lib/date-helpers';

interface Account { id: string; code: string; name: string; type: string; subtype: string; balance: number; }

const THEME_KEY = 'bap-accounts-theme-override';

// ─── 16: Theme override ───────────────────────────────────
const useThemeOverride = () => {
  const [theme, setTheme] = useState<'inherit' | 'light' | 'dark'>(() => {
    try { return (localStorage.getItem(THEME_KEY) as any) || 'inherit'; } catch { return 'inherit'; }
  });
  useEffect(() => {
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
    // Apply override class on the accounts root only via a CSS variable scope.
    // Sibling owners control the global theme; we just toggle a marker class.
    const root = document.documentElement;
    root.classList.remove('accounts-force-light', 'accounts-force-dark');
    if (theme === 'light') root.classList.add('accounts-force-light');
    else if (theme === 'dark') root.classList.add('accounts-force-dark');
  }, [theme]);
  return [theme, setTheme] as const;
};

// ─── 24: Tag editor ───────────────────────────────────────
const TagEditor: React.FC<{ tags: string[]; onChange: (next: string[]) => void; placeholder?: string }> = ({ tags, onChange, placeholder = 'Add tag…' }) => {
  const [draft, setDraft] = useState('');
  const add = () => {
    const t = draft.trim(); if (!t) return;
    if (tags.includes(t)) { setDraft(''); return; }
    onChange([...tags, t]); setDraft('');
  };
  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((t) => (
        <span key={t} className="block-badge inline-flex items-center gap-1">
          <Tag size={10} />{t}
          <button onClick={() => onChange(tags.filter((x) => x !== t))} className="text-text-muted hover:text-accent-expense ml-1"><X size={10} /></button>
        </span>
      ))}
      <input
        className="block-input text-xs"
        style={{ width: 100 }}
        placeholder={placeholder}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
      />
      <button className="block-btn text-xs" onClick={add}><Plus size={10} /></button>
    </div>
  );
};

// ─── 26: Cell history popover ─────────────────────────────
const CellHistory: React.FC<{ entityType: string; entityId: string; field: string; onClose: () => void }> = ({ entityType, entityId, field, onClose }) => {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => {
    api.rawQuery(
      `SELECT id, action, changes, performed_by, timestamp FROM audit_log
       WHERE entity_type = ? AND entity_id = ? ORDER BY timestamp DESC LIMIT 50`,
      [entityType, entityId]
    ).then((r: any[]) => setRows(Array.isArray(r) ? r : [])).catch(() => setRows([]));
  }, [entityType, entityId]);
  return (
    <div className="block-card" style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 60, padding: 12, width: 380 }}>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs uppercase font-bold flex items-center gap-1"><History size={12} /> History — {field}</h4>
        <button onClick={onClose}><X size={14} /></button>
      </div>
      {rows == null ? <div className="text-xs text-text-muted">Loading…</div> : rows.length === 0 ? <div className="text-xs text-text-muted">No history.</div> : (
        <div className="overflow-auto max-h-72 text-[11px]">
          {rows.map((r) => {
            let parsed: any = {};
            try { parsed = JSON.parse(r.changes || '{}'); } catch {}
            const change = parsed[field];
            return (
              <div key={r.id} className="border-b border-border-primary py-1">
                <div className="flex justify-between text-text-muted">
                  <span>{r.timestamp}</span><span>{r.performed_by || '—'}</span>
                </div>
                {change !== undefined ? (
                  <div className="font-mono">
                    <span className="text-accent-expense">{String(change?.from ?? '')}</span>
                    <span className="text-text-muted"> → </span>
                    <span className="text-accent-income">{String(change?.to ?? '')}</span>
                  </div>
                ) : (
                  <div className="text-text-muted italic">{r.action}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ─── 30: Text-to-JE parser ────────────────────────────────
// "1000 cash to revenue" → debit cash 1000, credit revenue 1000
const parseTextToJE = (input: string, accounts: Account[]): { debit?: Account; credit?: Account; amount: number; raw: string } | null => {
  const m = input.trim().match(/^([\d,]+(?:\.\d+)?)\s+(.+?)\s+to\s+(.+)$/i);
  if (!m) return null;
  const amount = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const fuzzy = (q: string) => {
    const lq = q.toLowerCase();
    let best: Account | undefined; let bestScore = -1;
    for (const a of accounts) {
      const hay = (a.code + ' ' + a.name + ' ' + a.subtype).toLowerCase();
      let score = 0;
      if (hay.includes(lq)) score += 10;
      lq.split(/\s+/).forEach((tok) => { if (hay.includes(tok)) score += 1; });
      if (score > bestScore) { bestScore = score; best = a; }
    }
    return best;
  };
  return { debit: fuzzy(m[2]), credit: fuzzy(m[3]), amount, raw: input };
};

// ─── Main host ────────────────────────────────────────────
type UndoAction = { kind: 'cell-edit'; rowIdx: number; colKey: string; before: any; after: any };

const PowerFeatures: React.FC<{ accounts: Account[] }> = ({ accounts }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [theme, setTheme] = useThemeOverride();

  // Find / replace state
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceWith, setReplaceWith] = useState('');

  // Cmd+K text-to-JE
  const [cmdKOpen, setCmdKOpen] = useState(false);
  const [cmdKInput, setCmdKInput] = useState('');

  // Undo/redo
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);
  const [redoStack, setRedoStack] = useState<UndoAction[]>([]);

  // Tags demo
  const [tags, setTags] = useState<string[]>([]);

  // History popover demo
  const [historyTarget, setHistoryTarget] = useState<{ entityType: string; entityId: string; field: string } | null>(null);

  // Demo grid data — a small working trial-balance style spreadsheet
  const [gridRows, setGridRows] = useState<GridRow[]>(() =>
    accounts.slice(0, 20).map((a) => ({
      code: a.code, name: a.name, balance: a.balance || 0, note: '', formula: '',
    }))
  );
  useEffect(() => {
    setGridRows(accounts.slice(0, 20).map((a) => ({
      code: a.code, name: a.name, balance: a.balance || 0, note: '', formula: '',
    })));
  }, [accounts]);

  const cols: GridColumn[] = [
    { key: 'code', label: 'Code', width: 80 },
    { key: 'name', label: 'Account', width: 200 },
    { key: 'balance', label: 'Balance', width: 120, editable: true, align: 'right' },
    { key: 'note', label: 'Note', width: 160, editable: true },
    { key: 'formula', label: 'Formula (try =C1*0.1)', width: 160, editable: true },
  ];

  const handleCellChange = (rowIdx: number, colKey: string, value: string) => {
    const before = gridRows[rowIdx]?.[colKey];
    setUndoStack((s) => [...s.slice(-19), { kind: 'cell-edit', rowIdx, colKey, before, after: value }]);
    setRedoStack([]);
    setGridRows((rs) => {
      const next = [...rs];
      next[rowIdx] = { ...next[rowIdx], [colKey]: value };
      return next;
    });
  };

  // Hotkeys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const inForm = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      // Cmd+K
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault(); setCmdKOpen(true); return;
      }
      // Cmd+H
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'h') {
        e.preventDefault(); setReplaceOpen(true); setFindOpen(true); return;
      }
      // Cmd+Z / Cmd+Shift+Z
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (inForm) return;
        e.preventDefault();
        setUndoStack((s) => {
          if (!s.length) return s;
          const top = s[s.length - 1];
          setGridRows((rs) => { const n = [...rs]; n[top.rowIdx] = { ...n[top.rowIdx], [top.colKey]: top.before }; return n; });
          setRedoStack((r) => [...r, top]);
          return s.slice(0, -1);
        });
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && e.shiftKey) {
        if (inForm) return;
        e.preventDefault();
        setRedoStack((r) => {
          if (!r.length) return r;
          const top = r[r.length - 1];
          setGridRows((rs) => { const n = [...rs]; n[top.rowIdx] = { ...n[top.rowIdx], [top.colKey]: top.after }; return n; });
          setUndoStack((s) => [...s, top]);
          return r.slice(0, -1);
        });
        return;
      }
      if (inForm) return;
      // / opens find
      if (e.key === '/') { e.preventDefault(); setFindOpen(true); return; }
      if (e.key === 'Escape') { setFindOpen(false); setReplaceOpen(false); setCmdKOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Match count / select-all-matching for the current grid
  const matches = useMemo(() => {
    if (!findQuery) return [] as { row: number; col: string }[];
    const q = findQuery.toLowerCase();
    const out: { row: number; col: string }[] = [];
    gridRows.forEach((r, ri) => {
      Object.entries(r).forEach(([k, v]) => {
        if (String(v ?? '').toLowerCase().includes(q)) out.push({ row: ri, col: k });
      });
    });
    return out;
  }, [findQuery, gridRows]);

  const doReplaceAll = () => {
    if (!findQuery) return;
    const q = findQuery; const w = replaceWith;
    setGridRows((rs) => rs.map((r) => {
      const next = { ...r };
      Object.keys(next).forEach((k) => {
        const v = next[k];
        if (typeof v === 'string' && v.includes(q)) next[k] = v.split(q).join(w);
      });
      return next;
    }));
  };

  const cmdKPreview = parseTextToJE(cmdKInput, accounts);

  const submitCmdK = async () => {
    if (!cmdKPreview || !cmdKPreview.debit || !cmdKPreview.credit || !activeCompany) return;
    try {
      const today = todayLocal();
      const entryNumber = 'JE-' + Date.now().toString().slice(-8);
      const je = await api.create('journal_entries', {
        company_id: activeCompany.id,
        entry_number: entryNumber,
        date: today,
        description: cmdKPreview.raw,
        is_posted: 0,
        source_type: 'manual',
      });
      const jeId = je?.id || je?.lastInsertRowid || je;
      if (jeId && typeof jeId === 'string') {
        await api.create('journal_entry_lines', {
          journal_entry_id: jeId, account_id: cmdKPreview.debit.id,
          debit: cmdKPreview.amount, credit: 0, description: '',
        });
        await api.create('journal_entry_lines', {
          journal_entry_id: jeId, account_id: cmdKPreview.credit.id,
          debit: 0, credit: cmdKPreview.amount, description: '',
        });
      }
      setCmdKOpen(false); setCmdKInput('');
    } catch {
      // swallow — UI shows preview only
      setCmdKOpen(false); setCmdKInput('');
    }
  };

  return (
    <div className="space-y-4">
      {/* Theme + undo/redo bar */}
      <div className="block-card flex flex-wrap items-center gap-3" style={{ padding: 12 }}>
        <div className="flex items-center gap-2 text-xs">
          <span className="uppercase font-bold text-text-muted">Module Theme</span>
          {(['inherit', 'light', 'dark'] as const).map((t) => (
            <button key={t} onClick={() => setTheme(t)} className={`block-btn text-xs ${theme === t ? 'block-btn-primary' : ''}`}>
              {t === 'light' ? <Sun size={11} /> : t === 'dark' ? <Moon size={11} /> : null} {t}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs ml-auto">
          <button className="block-btn text-xs" disabled={!undoStack.length} title="Cmd+Z"><Undo2 size={12} /> Undo ({undoStack.length})</button>
          <button className="block-btn text-xs" disabled={!redoStack.length} title="Cmd+Shift+Z"><Redo2 size={12} /> Redo ({redoStack.length})</button>
        </div>
      </div>

      <div className="block-card" style={{ padding: 12 }}>
        <div className="text-xs text-text-muted mb-2">
          Press <kbd className="block-badge">Cmd+K</kbd> for text-to-JE,&nbsp;
          <kbd className="block-badge">Cmd+H</kbd> for find &amp; replace,&nbsp;
          <kbd className="block-badge">/</kbd> to find,&nbsp;
          <kbd className="block-badge">Cmd+Z</kbd> to undo. Right-click column headers for hide/sort/pin.
        </div>

        <SpreadsheetGrid
          storageKey="bap-accounts-power-grid"
          columns={cols}
          rows={gridRows}
          onCellChange={handleCellChange}
          height={360}
        />
      </div>

      {/* Tag editor demo */}
      <div className="block-card" style={{ padding: 12 }}>
        <h4 className="text-xs uppercase font-bold mb-2">Inline Tags (demo)</h4>
        <TagEditor tags={tags} onChange={setTags} />
        <button className="block-btn text-xs mt-2" onClick={() => setHistoryTarget({ entityType: 'account', entityId: accounts[0]?.id || '', field: 'name' })}>
          <History size={11} /> Show cell history (account.name)
        </button>
      </div>

      {/* Find / replace bar */}
      {findOpen && (
        <div className="block-card" style={{ position: 'fixed', top: 80, right: 16, zIndex: 50, padding: 12, minWidth: 320 }}>
          <div className="flex items-center gap-2 mb-2">
            <Search size={12} />
            <input className="block-input text-xs flex-1" placeholder="Find…" value={findQuery} onChange={(e) => setFindQuery(e.target.value)} autoFocus />
            <span className="text-xs text-text-muted">{matches.length}</span>
            <button onClick={() => setFindOpen(false)}><X size={12} /></button>
          </div>
          {replaceOpen && (
            <div className="flex items-center gap-2 mb-2">
              <Replace size={12} />
              <input className="block-input text-xs flex-1" placeholder="Replace with…" value={replaceWith} onChange={(e) => setReplaceWith(e.target.value)} />
              <button className="block-btn text-xs" onClick={doReplaceAll}>Replace All</button>
            </div>
          )}
          <div className="text-[11px] text-text-muted">
            {matches.length} match{matches.length === 1 ? '' : 'es'}.
            {!replaceOpen && <button className="block-btn text-xs ml-2" onClick={() => setReplaceOpen(true)}>Open replace</button>}
          </div>
        </div>
      )}

      {/* Cmd+K palette */}
      {cmdKOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-32 bg-black/50" onClick={() => setCmdKOpen(false)}>
          <div className="block-card" style={{ width: 540, padding: 16 }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              <Command size={14} />
              <input
                autoFocus
                className="block-input flex-1 text-sm"
                placeholder="e.g. 1000 cash to revenue"
                value={cmdKInput}
                onChange={(e) => setCmdKInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && cmdKPreview?.debit && cmdKPreview?.credit) submitCmdK(); }}
              />
            </div>
            {cmdKInput && cmdKPreview ? (
              <div className="text-xs space-y-1">
                <div className="font-bold uppercase text-text-muted">Preview</div>
                <table className="block-table w-full text-xs">
                  <thead><tr><th>Account</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
                  <tbody>
                    <tr><td>{cmdKPreview.debit ? `${cmdKPreview.debit.code} ${cmdKPreview.debit.name}` : <span className="text-accent-expense">no match</span>}</td><td className="text-right font-mono">{formatCurrency(cmdKPreview.amount)}</td><td></td></tr>
                    <tr><td>{cmdKPreview.credit ? `${cmdKPreview.credit.code} ${cmdKPreview.credit.name}` : <span className="text-accent-expense">no match</span>}</td><td></td><td className="text-right font-mono">{formatCurrency(cmdKPreview.amount)}</td></tr>
                  </tbody>
                </table>
                <div className="flex justify-end gap-2 mt-2">
                  <button className="block-btn text-xs" onClick={() => setCmdKOpen(false)}>Cancel</button>
                  <button className="block-btn block-btn-primary text-xs" disabled={!cmdKPreview.debit || !cmdKPreview.credit} onClick={submitCmdK}>Post Draft</button>
                </div>
              </div>
            ) : (
              <div className="text-xs text-text-muted">Format: <code>&lt;amount&gt; &lt;debit acct&gt; to &lt;credit acct&gt;</code></div>
            )}
          </div>
        </div>
      )}

      {historyTarget && (
        <CellHistory {...historyTarget} onClose={() => setHistoryTarget(null)} />
      )}
    </div>
  );
};

export default PowerFeatures;
