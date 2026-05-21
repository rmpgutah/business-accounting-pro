// src/shared/utils.ts
// Shared pure-function utilities used by both main and renderer processes.
// Keep this file free of Electron/Node dependencies so it can be imported
// from anywhere.

/**
 * Banker's rounding (round half to even) for currency values.
 * Standard `Math.round` rounds 0.5 up (away from zero), which introduces
 * a systematic upward bias over many transactions. Banker's rounding rounds
 * to the nearest even number when the value is exactly at the midpoint,
 * which is unbiased over a large population.
 *
 * Also guards against NaN and Infinity (returns 0).
 *
 * Examples:
 *   roundCurrency(10.005)  → 10.00  (half rounds to even: 0 is even)
 *   roundCurrency(10.015)  → 10.02  (half rounds to even: 2 is even)
 *   roundCurrency(10.014)  → 10.01  (normal rounding)
 *   roundCurrency(10.016)  → 10.02  (normal rounding)
 *   roundCurrency(Infinity) → 0     (guard)
 */
export function roundCurrency(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  const scale = 100;
  // Banker's rounding: shift to cents, apply round-half-to-even, shift back.
  const scaled = n * scale;
  const absolute = Math.abs(scaled);
  const integer = Math.floor(absolute);
  const fraction = absolute - integer;
  let rounded = integer;
  if (fraction > 0.5) {
    rounded = integer + 1;
  } else if (fraction === 0.5) {
    // Round to nearest even integer.
    rounded = integer % 2 === 0 ? integer : integer + 1;
  }
  return (scaled < 0 ? -rounded : rounded) / scale;
}

/**
 * Standard rounding to 2 decimal places (not banker's).
 * Use this for display/comparison, NOT for financial calculations where
 * audit compliance matters. For those, use `roundCurrency`.
 */
export function roundCents(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Sum an array of numbers safely (ignores non-finite entries).
 */
export function sumFinite(values: (number | null | undefined)[]): number {
  let total = 0;
  for (const v of values) {
    if (v != null && Number.isFinite(v)) total += v;
  }
  return roundCurrency(total);
}

/**
 * Clamp a number between min and max inclusive.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
