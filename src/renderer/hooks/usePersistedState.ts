// src/renderer/hooks/usePersistedState.ts
//
// P3.33 — Persisted sort/filter state across navigations
//
// Drop-in useState replacement that keeps its value in localStorage
// under a stable key. Use this for filter/sort/view-mode state that
// the user expects to find unchanged when they leave and come back.
//
// Pattern:
//
//   const [sortKey, setSortKey] = usePersistedState(
//     'invoices.sort', 'date'
//   );
//
// Multi-tenant: pass `companyId` in the key to scope per-company.
//
// Hydration race: the initial state callback reads localStorage
// SYNCHRONOUSLY so React's first render uses the persisted value —
// no flicker between default and stored.

import { useState, useEffect } from 'react';

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function usePersistedState<T>(
  key: string,
  initial: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => readStored<T>(key, initial));

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch { /* quota — best-effort */ }
  }, [key, value]);

  return [value, setValue];
}
