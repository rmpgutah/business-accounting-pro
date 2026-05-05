// src/renderer/hooks/useSavedQueries.ts
//
// A2 + P3.31 — Saved query / filter presets per module.
//
// Persists named filter combinations in localStorage so users can
// flip between "Overdue 60+", "Acme this quarter", "Unpaid > $1K"
// without redoing the filter dance every time.
//
// Multi-tenant scoped: localStorage key is `bap.savedQueries.<companyId>.<module>`.

import { useEffect, useState, useCallback } from 'react';

export interface SavedQuery<TFilter = any> {
  id: string;
  name: string;
  filter: TFilter;       // module-specific filter shape
  createdAt: number;
  lastUsed?: number;
  pinned?: boolean;
}

const KEY_PREFIX = 'bap.savedQueries.';

function storageKey(companyId: string, module: string): string {
  return KEY_PREFIX + (companyId || 'default') + '.' + module;
}

function readQueries<F>(companyId: string, module: string): SavedQuery<F>[] {
  try {
    const raw = localStorage.getItem(storageKey(companyId, module));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueries<F>(companyId: string, module: string, list: SavedQuery<F>[]): void {
  try {
    localStorage.setItem(storageKey(companyId, module), JSON.stringify(list));
  } catch { /* quota — best-effort */ }
}

function genId(): string {
  return 'sq-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

export function useSavedQueries<F>(companyId: string, module: string) {
  const [queries, setQueries] = useState<SavedQuery<F>[]>(() => readQueries<F>(companyId, module));

  useEffect(() => {
    setQueries(readQueries<F>(companyId, module));
  }, [companyId, module]);

  const save = useCallback((name: string, filter: F): SavedQuery<F> => {
    const newQuery: SavedQuery<F> = {
      id: genId(),
      name: name.trim() || 'Untitled query',
      filter,
      createdAt: Date.now(),
    };
    setQueries((prev) => {
      // If a query with the same name exists, overwrite.
      const filtered = prev.filter((q) => q.name !== newQuery.name);
      const next = [...filtered, newQuery];
      writeQueries(companyId, module, next);
      return next;
    });
    return newQuery;
  }, [companyId, module]);

  const remove = useCallback((id: string) => {
    setQueries((prev) => {
      const next = prev.filter((q) => q.id !== id);
      writeQueries(companyId, module, next);
      return next;
    });
  }, [companyId, module]);

  const togglePin = useCallback((id: string) => {
    setQueries((prev) => {
      const next = prev.map((q) => q.id === id ? { ...q, pinned: !q.pinned } : q);
      writeQueries(companyId, module, next);
      return next;
    });
  }, [companyId, module]);

  const markUsed = useCallback((id: string) => {
    setQueries((prev) => {
      const next = prev.map((q) => q.id === id ? { ...q, lastUsed: Date.now() } : q);
      writeQueries(companyId, module, next);
      return next;
    });
  }, [companyId, module]);

  // Sort: pinned first, then most-recently-used, then alphabetical.
  const sorted = [...queries].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    if ((a.lastUsed || 0) !== (b.lastUsed || 0)) return (b.lastUsed || 0) - (a.lastUsed || 0);
    return a.name.localeCompare(b.name);
  });

  return { queries: sorted, save, remove, togglePin, markUsed };
}
