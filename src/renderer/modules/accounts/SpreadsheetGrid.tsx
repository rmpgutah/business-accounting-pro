// SpreadsheetGrid.tsx
// Reusable spreadsheet-style grid with:
//   17: Arrow/Tab/Enter cell navigation
//   18: Excel-style cell formulas (=A1+B1, +-*/, references)
//   19: Frozen first column / header row (sticky)
//   20: Resizable columns (persisted to localStorage)
//   21: Drag-reorder columns (persisted)
//   22: Fill handle — drag bottom-right corner to copy cell down/right
//   23: Smart tooltips for truncated cells (title attr)
//   25: Right-click column header context menu (Hide, Sort Asc/Desc, Pin)
//
// Pure React, no new deps.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface GridColumn {
  key: string;
  label: string;
  width?: number;
  editable?: boolean;
  align?: 'left' | 'right' | 'center';
}

export type GridRow = Record<string, string | number>;

interface Props {
  storageKey?: string;
  columns: GridColumn[];
  rows: GridRow[];
  onCellChange?: (rowIdx: number, colKey: string, value: string) => void;
  freezeFirstColumn?: boolean;
  className?: string;
  height?: number;
}

// Safe arithmetic evaluator — shunting yard, only +-*/(), no code execution.
const safeEvalArith = (expr: string): number | string => {
  const tokens: (string | number)[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === ' ') { i++; continue; }
    if ('+-*/()'.includes(ch)) { tokens.push(ch); i++; continue; }
    if (/\d|\./.test(ch)) {
      let j = i;
      while (j < expr.length && /[\d.]/.test(expr[j])) j++;
      const n = Number(expr.slice(i, j));
      if (!Number.isFinite(n)) return '#ERR';
      tokens.push(n);
      i = j;
      continue;
    }
    return '#ERR';
  }
  // Handle unary minus by inserting 0 before '-' at start or after operators/'('
  const fixed: (string | number)[] = [];
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    const prev = fixed[fixed.length - 1];
    if (t === '-' && (fixed.length === 0 || (typeof prev === 'string' && '+-*/('.includes(prev)))) {
      fixed.push(0);
    }
    fixed.push(t);
  }
  // Shunting yard → RPN
  const out: (string | number)[] = [];
  const ops: string[] = [];
  const prec: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };
  for (const t of fixed) {
    if (typeof t === 'number') out.push(t);
    else if (t === '(') ops.push(t);
    else if (t === ')') {
      while (ops.length && ops[ops.length - 1] !== '(') out.push(ops.pop()!);
      if (ops.pop() !== '(') return '#ERR';
    } else {
      while (ops.length && ops[ops.length - 1] !== '(' && prec[ops[ops.length - 1]] >= prec[t as string]) {
        out.push(ops.pop()!);
      }
      ops.push(t as string);
    }
  }
  while (ops.length) { const op = ops.pop()!; if (op === '(') return '#ERR'; out.push(op); }
  // Evaluate RPN
  const stack: number[] = [];
  for (const t of out) {
    if (typeof t === 'number') stack.push(t);
    else {
      const b = stack.pop(); const a = stack.pop();
      if (a === undefined || b === undefined) return '#ERR';
      let r = 0;
      if (t === '+') r = a + b;
      else if (t === '-') r = a - b;
      else if (t === '*') r = a * b;
      else if (t === '/') r = b === 0 ? NaN : a / b;
      if (!Number.isFinite(r)) return '#ERR';
      stack.push(r);
    }
  }
  return stack.length === 1 ? stack[0] : '#ERR';
};

const evalFormula = (expr: string, getCell: (col: string, row: number) => number): number | string => {
  const replaced = expr.replace(/([A-Z]+)(\d+)/g, (_m, col, row) => {
    const v = getCell(col, parseInt(row, 10));
    return Number.isFinite(v) ? String(v) : '0';
  });
  return safeEvalArith(replaced);
};

const colKeyToLetter = (i: number): string => {
  let s = '';
  i = i + 1;
  while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); }
  return s;
};

const SpreadsheetGrid: React.FC<Props> = ({
  storageKey,
  columns: inputCols,
  rows,
  onCellChange,
  freezeFirstColumn = true,
  className,
  height = 420,
}) => {
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    if (!storageKey) return {};
    try { return JSON.parse(localStorage.getItem(storageKey + ':widths') || '{}'); } catch { return {}; }
  });
  const [order, setOrder] = useState<string[]>(() => {
    if (!storageKey) return inputCols.map((c) => c.key);
    try { const v = JSON.parse(localStorage.getItem(storageKey + ':order') || 'null'); return Array.isArray(v) && v.length ? v : inputCols.map((c) => c.key); } catch { return inputCols.map((c) => c.key); }
  });
  const [hidden, setHidden] = useState<Record<string, boolean>>(() => {
    if (!storageKey) return {};
    try { return JSON.parse(localStorage.getItem(storageKey + ':hidden') || '{}'); } catch { return {}; }
  });
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

  useEffect(() => {
    const known = new Set(order);
    const merged = [...order.filter((k) => inputCols.some((c) => c.key === k)), ...inputCols.filter((c) => !known.has(c.key)).map((c) => c.key)];
    if (merged.length !== order.length) setOrder(merged);
  }, [inputCols]); // eslint-disable-line

  const persist = (suffix: string, val: any) => {
    if (storageKey) try { localStorage.setItem(storageKey + ':' + suffix, JSON.stringify(val)); } catch {}
  };

  const visibleCols = useMemo(() => {
    const map = new Map(inputCols.map((c) => [c.key, c]));
    return order.map((k) => map.get(k)).filter((c): c is GridColumn => !!c && !hidden[c.key]);
  }, [inputCols, order, hidden]);

  const [localRows, setLocalRows] = useState<GridRow[]>(rows);
  useEffect(() => { setLocalRows(rows); }, [rows]);

  const sortedRows = useMemo(() => {
    if (!sort) return localRows;
    const out = [...localRows];
    out.sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key];
      const an = Number(av), bn = Number(bv);
      const cmp = (!isNaN(an) && !isNaN(bn))
        ? an - bn
        : String(av ?? '').localeCompare(String(bv ?? ''));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return out;
  }, [localRows, sort]);

  const [active, setActive] = useState<{ r: number; c: number } | null>(null);
  const [editValue, setEditValue] = useState<string | null>(null);

  const moveActive = (dr: number, dc: number) => {
    if (!active) return;
    const r = Math.max(0, Math.min(sortedRows.length - 1, active.r + dr));
    const c = Math.max(0, Math.min(visibleCols.length - 1, active.c + dc));
    setActive({ r, c });
    setEditValue(null);
  };

  const getCellValue = useCallback((colLetter: string, rowNum: number): number => {
    let idx = 0;
    for (let i = 0; i < colLetter.length; i++) idx = idx * 26 + (colLetter.charCodeAt(i) - 64);
    idx -= 1;
    const col = visibleCols[idx]; if (!col) return 0;
    const row = sortedRows[rowNum - 1]; if (!row) return 0;
    const v = row[col.key];
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.startsWith('=')) {
      const r = evalFormula(v.slice(1), getCellValue);
      return typeof r === 'number' ? r : 0;
    }
    return Number(v) || 0;
  }, [visibleCols, sortedRows]);

  const renderCellValue = (raw: any): { display: string; isNum: boolean } => {
    if (typeof raw === 'string' && raw.startsWith('=')) {
      const v = evalFormula(raw.slice(1), getCellValue);
      return { display: String(v), isNum: typeof v === 'number' };
    }
    if (typeof raw === 'number') return { display: String(raw), isNum: true };
    return { display: raw == null ? '' : String(raw), isNum: false };
  };

  const commitEdit = (r: number, c: number, value: string) => {
    const col = visibleCols[c]; if (!col) return;
    const row = sortedRows[r]; if (!row) return;
    const idx = localRows.indexOf(row);
    if (idx >= 0) {
      const next = [...localRows];
      next[idx] = { ...row, [col.key]: value };
      setLocalRows(next);
      onCellChange?.(idx, col.key, value);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!active) return;
      const t = e.target as HTMLElement;
      const inForm = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
      if (inForm && editValue !== null) {
        if (e.key === 'Enter') { commitEdit(active.r, active.c, editValue); setEditValue(null); moveActive(1, 0); e.preventDefault(); }
        else if (e.key === 'Tab') { commitEdit(active.r, active.c, editValue); setEditValue(null); moveActive(0, e.shiftKey ? -1 : 1); e.preventDefault(); }
        else if (e.key === 'Escape') { setEditValue(null); }
        return;
      }
      if (inForm) return;
      if (e.key === 'ArrowUp') { moveActive(-1, 0); e.preventDefault(); }
      else if (e.key === 'ArrowDown' || e.key === 'Enter') { moveActive(1, 0); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { moveActive(0, -1); e.preventDefault(); }
      else if (e.key === 'ArrowRight' || e.key === 'Tab') { moveActive(0, e.shiftKey ? -1 : 1); e.preventDefault(); }
      else if (e.key === 'F2' || e.key === '=') {
        const col = visibleCols[active.c]; const row = sortedRows[active.r];
        if (col?.editable) setEditValue(e.key === '=' ? '=' : String(row?.[col.key] ?? ''));
      } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
        const col = visibleCols[active.c];
        if (col?.editable) setEditValue(e.key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, editValue, visibleCols, sortedRows]); // eslint-disable-line

  const resizing = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const onResizeMouseDown = (e: React.MouseEvent, key: string, w: number) => {
    resizing.current = { key, startX: e.clientX, startWidth: w };
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const dw = ev.clientX - resizing.current.startX;
      const next = Math.max(40, resizing.current.startWidth + dw);
      setWidths((prev) => { const n = { ...prev, [resizing.current!.key]: next }; persist('widths', n); return n; });
    };
    const onUp = () => { resizing.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const dragColRef = useRef<string | null>(null);
  const onColDragStart = (key: string) => { dragColRef.current = key; };
  const onColDrop = (targetKey: string) => {
    const src = dragColRef.current; if (!src || src === targetKey) return;
    setOrder((prev) => {
      const next = prev.filter((k) => k !== src);
      const idx = next.indexOf(targetKey);
      next.splice(idx, 0, src);
      persist('order', next);
      return next;
    });
    dragColRef.current = null;
  };

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; col: string } | null>(null);
  const onColContext = (e: React.MouseEvent, key: string) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, col: key });
  };
  const closeCtx = () => setCtxMenu(null);
  useEffect(() => {
    const h = () => closeCtx();
    window.addEventListener('click', h);
    return () => window.removeEventListener('click', h);
  }, []);

  const [fillFrom, setFillFrom] = useState<{ r: number; c: number } | null>(null);
  const [fillTo, setFillTo] = useState<{ r: number; c: number } | null>(null);
  const onFillMouseDown = (e: React.MouseEvent, r: number, c: number) => {
    e.preventDefault(); e.stopPropagation();
    const start = { r, c };
    setFillFrom(start);
    setFillTo(start);
    let lastTo = start;
    const onMove = (ev: MouseEvent) => {
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      if (!el) return;
      const td = el.closest('td[data-cell]') as HTMLElement | null;
      if (!td) return;
      const r2 = parseInt(td.dataset.row || '-1', 10);
      const c2 = parseInt(td.dataset.col || '-1', 10);
      if (r2 >= 0 && c2 >= 0) { lastTo = { r: r2, c: c2 }; setFillTo(lastTo); }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const col = visibleCols[start.c];
      const srcRow = sortedRows[start.r];
      if (col && srcRow) {
        const val = srcRow[col.key];
        const r0 = Math.min(start.r, lastTo.r), r1 = Math.max(start.r, lastTo.r);
        const next = [...localRows];
        for (let rr = r0; rr <= r1; rr++) {
          if (rr === start.r) continue;
          const targetRow = sortedRows[rr];
          if (targetRow) {
            const idx = next.indexOf(targetRow);
            if (idx >= 0) {
              next[idx] = { ...targetRow, [col.key]: val };
              onCellChange?.(idx, col.key, String(val));
            }
          }
        }
        setLocalRows(next);
      }
      setFillFrom(null);
      setFillTo(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const colWidth = (c: GridColumn) => widths[c.key] ?? c.width ?? 120;

  return (
    <div className={className} style={{ position: 'relative', maxHeight: height, overflow: 'auto', border: '1px solid var(--color-border-primary, #374151)' }}>
      <table className="block-table text-xs" style={{ borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed' }}>
        <thead>
          <tr>
            {visibleCols.map((c, ci) => {
              const sticky = freezeFirstColumn && ci === 0;
              return (
                <th
                  key={c.key}
                  draggable
                  onDragStart={() => onColDragStart(c.key)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onColDrop(c.key)}
                  onContextMenu={(e) => onColContext(e, c.key)}
                  onClick={() => setSort((s) => s && s.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'asc' })}
                  style={{
                    position: 'sticky', top: 0,
                    left: sticky ? 0 : undefined,
                    zIndex: sticky ? 3 : 2,
                    background: '#1f2937',
                    width: colWidth(c),
                    minWidth: colWidth(c),
                    maxWidth: colWidth(c),
                    textAlign: c.align || 'left',
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  <span className="font-bold uppercase">{c.label}</span>
                  <span className="text-text-muted text-[9px] ml-1">({colKeyToLetter(ci)})</span>
                  {sort?.key === c.key && <span className="ml-1">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
                  <span
                    onMouseDown={(e) => { e.stopPropagation(); onResizeMouseDown(e, c.key, colWidth(c)); }}
                    onClick={(e) => e.stopPropagation()}
                    style={{ position: 'absolute', right: 0, top: 0, height: '100%', width: 4, cursor: 'col-resize' }}
                  />
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, r) => (
            <tr key={r}>
              {visibleCols.map((c, ci) => {
                const sticky = freezeFirstColumn && ci === 0;
                const raw = row[c.key];
                const { display, isNum } = renderCellValue(raw);
                const isActive = active?.r === r && active?.c === ci;
                const isEditing = isActive && editValue !== null;
                const inFill = !!(fillFrom && fillTo && r >= Math.min(fillFrom.r, fillTo.r) && r <= Math.max(fillFrom.r, fillTo.r) && ci === fillFrom.c);
                return (
                  <td
                    key={c.key}
                    data-cell="1"
                    data-row={r}
                    data-col={ci}
                    onClick={() => { setActive({ r, c: ci }); setEditValue(null); }}
                    onDoubleClick={() => {
                      if (c.editable) { setEditValue(typeof raw === 'string' ? raw : String(raw ?? '')); }
                    }}
                    title={display.length > 20 ? display : undefined}
                    style={{
                      position: sticky ? 'sticky' : 'relative',
                      left: sticky ? 0 : undefined,
                      background: isActive ? '#1e3a5f' : inFill ? '#1e293b' : (sticky ? '#111827' : undefined),
                      width: colWidth(c),
                      minWidth: colWidth(c),
                      maxWidth: colWidth(c),
                      textAlign: c.align || (isNum ? 'right' : 'left'),
                      fontFamily: isNum ? 'ui-monospace, monospace' : undefined,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      outline: isActive ? '2px solid #3b82f6' : undefined,
                      cursor: c.editable ? 'cell' : 'default',
                    }}
                  >
                    {isEditing ? (
                      <input
                        autoFocus
                        className="block-input"
                        style={{ width: '100%', padding: 0, font: 'inherit' }}
                        value={editValue ?? ''}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => { if (editValue !== null) { commitEdit(r, ci, editValue); setEditValue(null); } }}
                      />
                    ) : display}
                    {isActive && c.editable && (
                      <span
                        onMouseDown={(e) => onFillMouseDown(e, r, ci)}
                        title="Drag to fill"
                        style={{
                          position: 'absolute', right: -2, bottom: -2,
                          width: 8, height: 8, background: '#3b82f6',
                          cursor: 'crosshair', border: '1px solid white',
                        }}
                      />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          {sortedRows.length === 0 && (
            <tr><td colSpan={visibleCols.length} style={{ padding: 12, textAlign: 'center', color: '#9ca3af' }}>No rows.</td></tr>
          )}
        </tbody>
      </table>

      {ctxMenu && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="block-card"
          style={{ position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 50, padding: 4, fontSize: 11, minWidth: 140 }}
        >
          {[
            { label: 'Hide column', onClick: () => { setHidden((h) => { const n = { ...h, [ctxMenu.col]: true }; persist('hidden', n); return n; }); closeCtx(); } },
            { label: 'Sort Ascending', onClick: () => { setSort({ key: ctxMenu.col, dir: 'asc' }); closeCtx(); } },
            { label: 'Sort Descending', onClick: () => { setSort({ key: ctxMenu.col, dir: 'desc' }); closeCtx(); } },
            { label: 'Pin to Left', onClick: () => { setOrder((prev) => { const n = [ctxMenu.col, ...prev.filter((k) => k !== ctxMenu.col)]; persist('order', n); return n; }); closeCtx(); } },
            { label: 'Reset View', onClick: () => { setHidden({}); setSort(null); setWidths({}); setOrder(inputCols.map((c) => c.key)); if (storageKey) { localStorage.removeItem(storageKey + ':widths'); localStorage.removeItem(storageKey + ':order'); localStorage.removeItem(storageKey + ':hidden'); } closeCtx(); } },
          ].map((it) => (
            <button key={it.label} onClick={it.onClick} className="block w-full text-left px-2 py-1 hover:bg-bg-secondary">{it.label}</button>
          ))}
        </div>
      )}
    </div>
  );
};

export default SpreadsheetGrid;
