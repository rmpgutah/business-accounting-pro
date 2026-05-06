// src/renderer/components/SnippetPicker.tsx
//
// A7 — Reusable line-item snippet picker.
//
// Drop-down button labelled "+ From Snippet" that opens a popover
// listing the user's saved snippets sorted by use_count DESC.
// Clicking a snippet calls onPick(snippet) which the parent uses
// to push a new line item with the snippet's values.
//
// Used by InvoiceForm/BillForm/QuoteForm. Each form passes a
// callback that knows how to adapt the snippet to its line shape.
//
// Includes inline "Save current line as snippet" affordance —
// users can build the library naturally as they work.

import React, { useEffect, useState, useRef } from 'react';
import { Bookmark, Plus, X } from 'lucide-react';
import api from '../lib/api';
import { useToast } from './ToastProvider';

interface Snippet {
  id: string;
  name: string;
  category?: string;
  description: string;
  quantity: number;
  unit_label: string;
  unit_price: number;
  tax_rate: number;
  item_code?: string;
  use_count: number;
}

interface Props {
  /** Called with the picked snippet — parent maps it to its line shape */
  onPick: (snippet: Snippet) => void;
  /** Optional category filter (e.g. only show 'service' snippets) */
  category?: string;
  /** Optional inline "Save as snippet" — passes current line state to capture */
  onSaveAsSnippet?: () => Partial<Snippet> | null;
}

export const SnippetPicker: React.FC<Props> = ({ onPick, category, onSaveAsSnippet }) => {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [newName, setNewName] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const list = await api.snippetsList(category ? { category } : undefined);
      if (Array.isArray(list)) setSnippets(list as Snippet[]);
    } finally { setLoading(false); }
  };

  useEffect(() => {
    if (open) load();
  }, [open, category]);

  // Close popover on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [open]);

  const handlePick = async (s: Snippet) => {
    onPick(s);
    setOpen(false);
    // Async fire-and-forget use tracking — improves the next sort order
    api.snippetTrackUse(s.id).catch(() => { /* ignore */ });
  };

  const handleSaveAsSnippet = async () => {
    if (!onSaveAsSnippet) return;
    const captured = onSaveAsSnippet();
    if (!captured) {
      toast.error('No line to save — fill in description + price first');
      return;
    }
    if (!newName.trim()) {
      toast.error('Name required');
      return;
    }
    const payload = { ...captured, name: newName.trim() };
    const r = await api.snippetSave(payload);
    if (r?.error) toast.error('Save failed: ' + r.error);
    else {
      toast.success('Snippet saved · "' + newName.trim() + '"');
      setShowSaveModal(false);
      setNewName('');
      await load();
    }
  };

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="block-btn flex items-center gap-1.5 text-xs"
        title="Insert from saved snippet"
      >
        <Bookmark size={11} />
        From Snippet
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            minWidth: 320,
            maxWidth: 420,
            maxHeight: 400,
            overflowY: 'auto',
            background: 'var(--color-bg-primary)',
            border: '1px solid var(--color-border-primary)',
            borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
            zIndex: 100,
            padding: 4,
          }}
        >
          <div style={{ padding: '6px 10px', fontSize: 9, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Snippet Library {snippets.length > 0 ? '(' + snippets.length + ')' : ''}</span>
            {onSaveAsSnippet && (
              <button onClick={(e) => { e.stopPropagation(); setShowSaveModal(true); }}
                style={{ background: 'transparent', border: 'none', color: 'var(--color-accent-blue)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 700 }}
              >
                <Plus size={10} /> Save Current
              </button>
            )}
          </div>

          {loading && <div style={{ padding: 14, color: 'var(--color-text-muted)', fontSize: 11 }}>Loading…</div>}

          {!loading && snippets.length === 0 && (
            <div style={{ padding: 14, color: 'var(--color-text-muted)', fontSize: 11, fontStyle: 'italic' }}>
              No snippets yet. {onSaveAsSnippet && 'Click "Save Current" to capture a line as a reusable snippet.'}
            </div>
          )}

          {snippets.map((s) => (
            <button
              key={s.id}
              onClick={(e) => { e.stopPropagation(); handlePick(s); }}
              style={{
                width: '100%',
                textAlign: 'left',
                background: 'transparent',
                border: 'none',
                padding: '8px 10px',
                borderRadius: 4,
                cursor: 'pointer',
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg-secondary)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-primary)' }}>
                  {s.name}
                </div>
                <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {s.description || '(no description)'}
                </div>
                <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2, fontFamily: 'SF Mono, Menlo, monospace' }}>
                  {s.quantity || 1} {s.unit_label || 'ea'} × ${(s.unit_price || 0).toFixed(2)}
                  {s.tax_rate > 0 ? ' + ' + s.tax_rate + '% tax' : ''}
                  {s.use_count > 0 ? ' · used ' + s.use_count + 'x' : ''}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Save-as-snippet modal */}
      {showSaveModal && (
        <div onClick={() => setShowSaveModal(false)} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-primary)', borderRadius: 8, maxWidth: 400, width: '100%', padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700 }}>Save Line as Snippet</h3>
              <button onClick={() => setShowSaveModal(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                <X size={14} />
              </button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 10 }}>
              Captures the current line's description, quantity, unit, price, and tax rate. Reusable on any future invoice/bill/quote.
            </p>
            <input
              autoFocus
              className="block-input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Snippet name (e.g. 'Standard hourly consulting')"
              onKeyDown={(e) => e.key === 'Enter' && handleSaveAsSnippet()}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 12 }}>
              <button onClick={() => setShowSaveModal(false)} className="block-btn">Cancel</button>
              <button onClick={handleSaveAsSnippet} className="block-btn-primary">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SnippetPicker;
