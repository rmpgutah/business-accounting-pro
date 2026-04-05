// ─── Global Keyboard Shortcuts ──────────────────────────
// Registers Cmd/Ctrl shortcuts for common app actions.

export interface ShortcutActions {
  newItem: () => void;
  exportView: () => void;
  focusSearch: () => void;
  switchModule: (index: number) => void;
  openSettings: () => void;
}

const MODULE_ORDER = [
  'dashboard',
  'invoicing',
  'expenses',
  'clients',
  'accounts',
  'payroll',
  'time-tracking',
  'projects',
  'reports',
  'debt-collection',
];

export function registerKeyboardShortcuts(actions: ShortcutActions): () => void {
  const handler = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;

    // Ignore when typing in inputs (unless it's a shortcut we specifically want)
    const target = e.target as HTMLElement;
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

    // Cmd/Ctrl + N — New item
    if (e.key === 'n' && !e.shiftKey) {
      e.preventDefault();
      actions.newItem();
      return;
    }

    // Cmd/Ctrl + E — Export current view
    if (e.key === 'e' && !e.shiftKey) {
      e.preventDefault();
      actions.exportView();
      return;
    }

    // Cmd/Ctrl + F — Focus search (only override if not already in an input)
    if (e.key === 'f' && !e.shiftKey) {
      e.preventDefault();
      actions.focusSearch();
      return;
    }

    // Cmd/Ctrl + , — Open settings
    if (e.key === ',') {
      e.preventDefault();
      actions.openSettings();
      return;
    }

    // Cmd/Ctrl + 1-9 — Switch module by position
    const num = parseInt(e.key, 10);
    if (num >= 1 && num <= 9) {
      e.preventDefault();
      actions.switchModule(num - 1);
      return;
    }
  };

  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}

export { MODULE_ORDER };
