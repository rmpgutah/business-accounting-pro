// src/renderer/components/ShortcutCheatsheet.tsx
//
// P3.26 — Press `?` (or Shift+/) to view all keyboard shortcuts.
//
// Modal lists app-wide shortcuts grouped by section. Suppresses if
// the user is typing in an input/textarea/contenteditable so the
// `?` character can be entered normally in form fields.

import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';

interface Shortcut {
  keys: string[];      // e.g. ['⌘', 'K'] — rendered as separate kbd elements
  description: string;
}

interface ShortcutGroup {
  title: string;
  items: Shortcut[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Navigation',
    items: [
      { keys: ['⌘', 'K'], description: 'Command palette / quick search' },
      { keys: ['?'], description: 'Show this shortcut cheatsheet' },
      { keys: ['Esc'], description: 'Close modal / cancel current action' },
    ],
  },
  {
    title: 'Lists',
    items: [
      { keys: ['↑', '↓'], description: 'Navigate rows' },
      { keys: ['Enter'], description: 'Open selected row' },
      { keys: ['Space'], description: 'Toggle selection' },
      { keys: ['⌘', 'A'], description: 'Select all' },
    ],
  },
  {
    title: 'Forms',
    items: [
      { keys: ['⌘', 'S'], description: 'Save' },
      { keys: ['⌘', 'Enter'], description: 'Save and close' },
      { keys: ['Esc'], description: 'Discard and close' },
    ],
  },
  {
    title: 'Smart date input',
    items: [
      { keys: ['today'], description: "Today's date" },
      { keys: ['+3w'], description: 'Today + 3 weeks (also d / m / y)' },
      { keys: ['eom'], description: 'End of current month' },
      { keys: ['next', 'fri'], description: 'Next Friday' },
    ],
  },
];

export const ShortcutCheatsheet: React.FC = () => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Suppress when typing in inputs / textareas / contenteditable.
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName?.toLowerCase();
      const inEditable = tag === 'input' || tag === 'textarea' || tag === 'select' || t?.isContentEditable;
      if (e.key === '?' && !inEditable) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-bg-primary)',
          border: '1px solid var(--color-border-primary)',
          borderRadius: 8,
          maxWidth: 560,
          width: '100%',
          maxHeight: '80vh',
          overflow: 'auto',
          padding: 24,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)' }}>
            Keyboard Shortcuts
          </h3>
          <button
            onClick={() => setOpen(false)}
            style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 4 }}
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
        {SHORTCUT_GROUPS.map((group) => (
          <div key={group.title} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 8 }}>
              {group.title}
            </div>
            {group.items.map((s, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px dashed var(--color-border-primary)' }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-primary)' }}>{s.description}</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {s.keys.map((k, j) => (
                    <kbd
                      key={j}
                      style={{
                        background: 'var(--color-bg-secondary)',
                        border: '1px solid var(--color-border-primary)',
                        borderRadius: 4,
                        padding: '2px 8px',
                        fontSize: 11,
                        fontFamily: 'SF Mono, Menlo, Consolas, monospace',
                        fontWeight: 600,
                        color: 'var(--color-text-primary)',
                        minWidth: 20,
                        textAlign: 'center',
                        boxShadow: '0 1px 0 var(--color-border-primary)',
                      }}
                    >
                      {k}
                    </kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
        <div style={{ marginTop: 12, fontSize: 11, color: 'var(--color-text-muted)', textAlign: 'center', fontStyle: 'italic' }}>
          Press <kbd style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-primary)', borderRadius: 3, padding: '0 6px', fontSize: 10 }}>?</kbd> any time to reopen this. Esc to close.
        </div>
      </div>
    </div>
  );
};

export default ShortcutCheatsheet;
