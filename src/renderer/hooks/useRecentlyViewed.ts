// src/renderer/hooks/useRecentlyViewed.ts
//
// P3.32 — Recently-viewed items dropdown
//
// Tracks the last N entities the user opened (any kind: invoice,
// client, expense, etc.) in localStorage. Surfaces in the topbar
// or Cmd+K palette so power users can jump back without searching.
//
// Storage shape: array sorted MRU first, capped at MAX_RECENT.
// Multi-tenant aware via per-company localStorage key.

import { useEffect, useState, useCallback } from 'react';

const MAX_RECENT = 20;
const KEY_PREFIX = 'bap.recent.';

export interface RecentItem {
  id: string;
  type: string;          // 'invoice' | 'client' | 'expense' | 'bill' | etc.
  label: string;         // e.g. "INV-2026-00042" or "Acme Corp"
  subtitle?: string;     // e.g. "$1,250.00 · sent" or "billing@acme.com"
  visitedAt: number;     // ms epoch
}

function storageKey(companyId: string): string {
  return KEY_PREFIX + (companyId || 'default');
}

function readList(companyId: string): RecentItem[] {
  try {
    const raw = localStorage.getItem(storageKey(companyId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeList(companyId: string, list: RecentItem[]): void {
  try {
    localStorage.setItem(storageKey(companyId), JSON.stringify(list.slice(0, MAX_RECENT)));
  } catch { /* quota or disabled — best-effort */ }
}

/**
 * Subscribe to the recently-viewed list and get a `track` function
 * to add new entries. Calling track() with the same id moves it
 * to the front (MRU).
 */
export function useRecentlyViewed(companyId: string) {
  const [items, setItems] = useState<RecentItem[]>(() => readList(companyId));

  // Re-read when company switches.
  useEffect(() => {
    setItems(readList(companyId));
  }, [companyId]);

  const track = useCallback((item: Omit<RecentItem, 'visitedAt'>) => {
    if (!item.id || !item.type) return;
    setItems((prev) => {
      const filtered = prev.filter((i) => !(i.id === item.id && i.type === item.type));
      const next: RecentItem[] = [{ ...item, visitedAt: Date.now() }, ...filtered].slice(0, MAX_RECENT);
      writeList(companyId, next);
      return next;
    });
  }, [companyId]);

  const clear = useCallback(() => {
    writeList(companyId, []);
    setItems([]);
  }, [companyId]);

  return { items, track, clear };
}
