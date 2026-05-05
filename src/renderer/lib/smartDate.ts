// src/renderer/lib/smartDate.ts
//
// P3.34 — Smart date input parser
//
// Accepts natural-language date shorthand and resolves to a YYYY-MM-DD
// ISO string. Falls back to native Date parsing when nothing matches.
//
// Supported tokens (case-insensitive):
//   today, tod         → today's date
//   yesterday, yest    → today − 1 day
//   tomorrow, tom      → today + 1 day
//   eom                → end-of-month (last day of current month)
//   eoy                → end-of-year (Dec 31 current year)
//   bom                → beginning-of-month (1st of current month)
//   boy                → beginning-of-year (Jan 1 current year)
//   +Nd / -Nd          → today ± N days        (e.g. "+3d", "-7d")
//   +Nw / -Nw          → today ± N weeks       (e.g. "+2w")
//   +Nm / -Nm          → today ± N months      (e.g. "+1m")
//   +Ny / -Ny          → today ± N years       (e.g. "+1y")
//   next mon|tue|wed|...  → next occurrence of that weekday
//   last mon|tue|wed|...  → previous occurrence of that weekday
//
// Anything else falls back to new Date(input). Returns null if the
// input is unparseable so the caller can show an error state.

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

function pad(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

function toISODate(d: Date): string {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function startOfDay(): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0); // anchor at noon to dodge DST edges
  return d;
}

export function parseSmartDate(input: string): string | null {
  if (!input) return null;
  const raw = input.trim().toLowerCase();
  if (!raw) return null;

  const today = startOfDay();

  // Pre-existing ISO date (YYYY-MM-DD) — pass through.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // Named anchors
  switch (raw) {
    case 'today':
    case 'tod':
      return toISODate(today);
    case 'yesterday':
    case 'yest':
      { const d = new Date(today); d.setDate(d.getDate() - 1); return toISODate(d); }
    case 'tomorrow':
    case 'tom':
      { const d = new Date(today); d.setDate(d.getDate() + 1); return toISODate(d); }
    case 'eom':
      { const d = new Date(today.getFullYear(), today.getMonth() + 1, 0, 12, 0, 0); return toISODate(d); }
    case 'eoy':
      { const d = new Date(today.getFullYear(), 11, 31, 12, 0, 0); return toISODate(d); }
    case 'bom':
      { const d = new Date(today.getFullYear(), today.getMonth(), 1, 12, 0, 0); return toISODate(d); }
    case 'boy':
      { const d = new Date(today.getFullYear(), 0, 1, 12, 0, 0); return toISODate(d); }
  }

  // Relative: +Nd / -Nw / +1m etc.
  const relMatch = raw.match(/^([+-])(\d+)\s*([dwmy])$/);
  if (relMatch) {
    const [, sign, nStr, unit] = relMatch;
    const n = parseInt(nStr, 10) * (sign === '-' ? -1 : 1);
    const d = new Date(today);
    if (unit === 'd') d.setDate(d.getDate() + n);
    else if (unit === 'w') d.setDate(d.getDate() + n * 7);
    else if (unit === 'm') d.setMonth(d.getMonth() + n);
    else if (unit === 'y') d.setFullYear(d.getFullYear() + n);
    return toISODate(d);
  }

  // next/last <weekday>
  const wdMatch = raw.match(/^(next|last)\s+(\w+)$/);
  if (wdMatch) {
    const [, direction, wdName] = wdMatch;
    const targetDow = WEEKDAYS[wdName];
    if (targetDow !== undefined) {
      const d = new Date(today);
      const currentDow = d.getDay();
      let diff = targetDow - currentDow;
      if (direction === 'next') {
        if (diff <= 0) diff += 7;
      } else {
        if (diff >= 0) diff -= 7;
      }
      d.setDate(d.getDate() + diff);
      return toISODate(d);
    }
  }

  // Native fallback (e.g. "May 23 2026", "5/23/26")
  try {
    const native = new Date(input);
    if (!isNaN(native.getTime())) return toISODate(native);
  } catch { /* fall through */ }

  return null;
}

// Self-test runner for quick validation in the dev console:
//   import { __smartDateSelfTest } from './smartDate';
//   __smartDateSelfTest();
export function __smartDateSelfTest(): void {
  const cases = ['today', 'yesterday', 'eom', 'eoy', '+3d', '-1w', '+2m', 'next fri', '2026-05-05'];
  for (const c of cases) {
    // eslint-disable-next-line no-console
    console.log(c, '→', parseSmartDate(c));
  }
}
