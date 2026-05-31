// Canonical money rounding. Use this instead of re-declaring a local
// `round2` per file — several copies historically used a bare `n` and
// produced NaN on null/undefined, poisoning stored money values.
//
// roundCents is the preferred name (null-safe, finite-guarded); round2 is
// kept as an alias for the dozens of existing call sites.

export function roundCents(value: any): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

export const round2 = roundCents;
