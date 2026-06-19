// src/renderer/components/UndoRedoButtons.tsx
//
// P3.25 — Topbar Undo / Redo / History controls.
// Mounts in the app header. Uses the undoStore for state.
//
// Keyboard:
//   ⌘Z       — undo
//   ⌘⇧Z      — redo
//   ⌘⇧H      — toggle history panel
//
// Suppressed inside text inputs so ⌘Z still undoes typing.

import React, { useEffect, useState } from 'react';
import { Undo2, Redo2, Clock, X } from 'lucide-react';
import { useUndoStore } from '../stores/undoStore';
import { useToast } from './ToastProvider';

function isInEditable(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}

export const UndoRedoButtons: React.FC = () => {
  const past = useUndoStore((s) => s.past);
  const future = useUndoStore((s) => s.future);
  const busy = useUndoStore((s) => s.busy);
  const undo = useUndoStore((s) => s.undo);
  const redo = useUndoStore((s) => s.redo);
  const toast = useToast();
  const [historyOpen, setHistoryOpen] = useState(false);

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;
  const lastUndo = past[past.length - 1];
  const lastRedo = future[future.length - 1];

  const onUndo = async () => {
    const r = await undo();
    if (!r.ok && r.error) toast.error(r.error);
    else if (r.summary) toast.info('Undid: ' + r.summary, { duration: 3000 });
  };
  const onRedo = async () => {
    const r = await redo();
    if (!r.ok && r.error) toast.error(r.error);
    else if (r.summary) toast.info('Redid: ' + r.summary, { duration: 3000 });
  };

  // Keyboard bindings — global, with input-field suppression.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isInEditable()) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        onUndo();
      } else if (meta && e.key.toLowerCase() === 'z' && e.shiftKey) {
        e.preventDefault();
        onRedo();
      } else if (meta && e.shiftKey && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setHistoryOpen((v) => !v);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button
          onClick={onUndo}
          disabled={!canUndo || busy}
          title={canUndo
            ? 'Undo: ' + lastUndo.summary + ' (⌘Z)'
            : 'Nothing to undo'}
          style={btnStyle(!canUndo || busy)}
        >
          <Undo2 size={14} />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo || busy}
          title={canRedo
            ? 'Redo: ' + lastRedo.summary + ' (⌘⇧Z)'
            : 'Nothing to redo'}
          style={btnStyle(!canRedo || busy)}
        >
          <Redo2 size={14} />
        </button>
        <button
          onClick={() => setHistoryOpen((v) => !v)}
          title="History (⌘⇧H)"
          style={btnStyle(false)}
        >
          <Clock size={14} />
          {past.length > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, marginLeft: 3, color: 'var(--color-text-muted)' }}>
              {past.length}
            </span>
          )}
        </button>
      </div>
      {historyOpen && <HistoryPanel onClose={() => setHistoryOpen(false)} />}
    </>
  );
};

function btnStyle(disabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '6px 8px',
    background: 'transparent',
    border: '1px solid var(--color-border-primary)',
    borderRadius: 6,
    color: disabled ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
}

const HistoryPanel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const past = useUndoStore((s) => s.past);
  const future = useUndoStore((s) => s.future);
  const undo = useUndoStore((s) => s.undo);
  const redo = useUndoStore((s) => s.redo);
  const clear = useUndoStore((s) => s.clear);
  const toast = useToast();

  // Slide-in from the right.
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9998,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex', justifyContent: 'flex-end',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 380,
          maxWidth: '90vw',
          height: '100%',
          background: 'var(--color-bg-primary)',
          borderLeft: '1px solid var(--color-border-primary)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-4px 0 16px rgba(0,0,0,0.3)',
        }}
      >
        <div style={{
          padding: '12px 14px',
          borderBottom: '1px solid var(--color-border-primary)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>History</div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
              {past.length} undoable · {future.length} redoable
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 4 }}
          >
            <X size={14} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
          {[...past].reverse().map((entry, idx) => (
            <div
              key={entry.id}
              style={{
                padding: '8px 10px',
                borderRadius: 4,
                marginBottom: 4,
                background: idx === 0 ? 'rgba(37, 99, 235, 0.06)' : 'transparent',
                border: '1px solid ' + (idx === 0 ? 'var(--color-accent-blue)' : 'var(--color-border-primary)'),
              }}
            >
              <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                {entry.summary}
              </div>
              <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>
                {fmtAgo(entry.performed_at)} · {entry.operation}
              </div>
            </div>
          ))}
          {past.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>
              No undoable actions yet.
            </div>
          )}
        </div>

        <div style={{
          padding: 10,
          borderTop: '1px solid var(--color-border-primary)',
          display: 'flex',
          gap: 6,
        }}>
          <button
            onClick={async () => {
              const r = await undo();
              if (!r.ok && r.error) toast.error(r.error);
            }}
            disabled={past.length === 0}
            className="block-btn flex items-center gap-1.5 text-xs"
          >
            <Undo2 size={12} /> Undo
          </button>
          <button
            onClick={async () => {
              const r = await redo();
              if (!r.ok && r.error) toast.error(r.error);
            }}
            disabled={future.length === 0}
            className="block-btn flex items-center gap-1.5 text-xs"
          >
            <Redo2 size={12} /> Redo
          </button>
          <button
            onClick={() => {
              if (confirm('Clear undo history? This cannot be undone.')) {
                clear();
                toast.info('Undo history cleared');
              }
            }}
            disabled={past.length === 0 && future.length === 0}
            className="block-btn text-xs"
            style={{ marginLeft: 'auto' }}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
};

function fmtAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return sec + 's ago';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + 'm ago';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + 'h ago';
  return new Date(ts).toLocaleDateString();
}

export default UndoRedoButtons;
