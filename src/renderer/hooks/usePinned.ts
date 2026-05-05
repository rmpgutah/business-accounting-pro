// src/renderer/hooks/usePinned.ts
//
// A11 — Pinned / favorite records.
//
// Lightweight equivalent of "starred items" — clients/vendors/projects
// the user touches daily get a sidebar shortcut. Per-company,
// per-entity-type, persisted in localStorage.
//
// Pattern:
//
//   const { pinned, isPinned, togglePin } = usePinned(companyId, 'clients');
//   <button onClick={() => togglePin(client.id)}>
//     {isPinned(client.id) ? '★' : '☆'}
//   </button>
//
// The renderer can also render a "Pinned" section in the sidebar
// or topbar by reading `pinned` directly.

import { useEffect, useState, useCallback } from 'react';

const KEY_PREFIX = 'bap.pinned.';
const MAX_PINS = 30; // per entity type

function storageKey(companyId: string, entityType: string): string {
  return KEY_PREFIX + (companyId || 'default') + '.' + entityType;
}

function read(companyId: string, entityType: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey(companyId, entityType));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(companyId: string, entityType: string, ids: string[]): void {
  try {
    localStorage.setItem(storageKey(companyId, entityType), JSON.stringify(ids.slice(0, MAX_PINS)));
  } catch { /* quota — best-effort */ }
}

export function usePinned(companyId: string, entityType: string) {
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => read(companyId, entityType));

  useEffect(() => {
    setPinnedIds(read(companyId, entityType));
  }, [companyId, entityType]);

  const isPinned = useCallback((id: string) => pinnedIds.includes(id), [pinnedIds]);

  const togglePin = useCallback((id: string) => {
    setPinnedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [id, ...prev];
      write(companyId, entityType, next);
      return next;
    });
  }, [companyId, entityType]);

  const clear = useCallback(() => {
    write(companyId, entityType, []);
    setPinnedIds([]);
  }, [companyId, entityType]);

  return { pinnedIds, isPinned, togglePin, clear };
}
