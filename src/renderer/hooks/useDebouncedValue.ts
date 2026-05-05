// src/renderer/hooks/useDebouncedValue.ts
//
// P2.24 — Debounced search inputs
//
// Returns a value that lags behind its source by `delayMs`. Use this
// to throttle expensive work (filtering long lists, fetching from
// IPC) that doesn't need to fire on every keystroke.
//
// Pattern:
//
//   const [query, setQuery] = useState('');
//   const debouncedQuery = useDebouncedValue(query, 200);
//   useEffect(() => {
//     fetchResults(debouncedQuery);
//   }, [debouncedQuery]);
//
// Why useDebouncedValue and not useTransition:
//   • useTransition prioritizes visual updates but still runs the
//     effect on every keystroke. We want to skip the work entirely.
//   • This hook caches the SAME value if it didn't change for delayMs,
//     making downstream useMemo / useEffect comparisons cheap.
//
// Why 200ms default: typing speed is ~5 chars/sec. 200ms means
// pauses between words trigger updates, but mid-word typing
// doesn't. Tune higher (500ms) for IPC-heavy operations, lower
// (100ms) for client-side filters.

import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delayMs: number = 200): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), Math.max(0, delayMs));
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}

// Companion hook: returns BOTH the immediate value and the debounced
// one, so the input field stays responsive while downstream effects
// fire only after the user pauses. Most callers want this shape.
export function useDebouncedSearch(initial: string = '', delayMs: number = 200) {
  const [value, setValue] = useState(initial);
  const debounced = useDebouncedValue(value, delayMs);
  return { value, setValue, debounced };
}
