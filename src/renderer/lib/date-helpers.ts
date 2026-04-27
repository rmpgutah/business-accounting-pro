// src/renderer/lib/date-helpers.ts
// DATE: Centralized date helpers — local-time today string and fiscal year math.
// Avoids `new Date().toISOString().slice(0,10)` which is UTC and shifts the day
// for late-evening Mountain Time users (after ~17:00 MST → next UTC day).
import { format } from 'date-fns';

/**
 * DATE: Returns today's calendar date in the user's local timezone as a
 * `yyyy-MM-dd` string. Use this everywhere the UI defaults a date input or
 * binds a "today" value to a DB column. NEVER use
 * `new Date().toISOString().slice(0,10)` for date-only fields.
 */
export function todayLocal(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

/**
 * DATE: Format an arbitrary Date as a `yyyy-MM-dd` string in local time.
 * Useful when computing offsets like `new Date(Date.now() + 30*86400000)`.
 */
export function toLocalDateString(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

/**
 * DATE: Parse a date-only `yyyy-MM-dd` string anchored at local noon so
 * arithmetic and `Intl.DateTimeFormat` round-trip without UTC drift.
 * If the string already has a time component it is parsed as-is.
 */
export function parseDateOnly(s: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T12:00:00`);
  return new Date(s);
}

/**
 * DATE: Compute the fiscal-year start date as a `yyyy-MM-dd` string.
 * `fyStartMonth` is 1-12. If today is before the fiscal-year start in the
 * current calendar year, the start is the prior calendar year.
 *
 *   FY=Jan, today=2026-04-27 → 2026-01-01
 *   FY=Apr, today=2026-04-27 → 2026-04-01
 *   FY=Apr, today=2026-02-15 → 2025-04-01
 */
export function fiscalYearStart(now: Date, fyStartMonth: number): string {
  const m = Math.min(12, Math.max(1, fyStartMonth || 1));
  const y = now.getFullYear();
  const candidate = new Date(y, m - 1, 1);
  // If we haven't yet reached this year's FY start, FY began last calendar year.
  const start = now < candidate ? new Date(y - 1, m - 1, 1) : candidate;
  return format(start, 'yyyy-MM-dd');
}

/**
 * DATE: Fiscal-year end (inclusive) as `yyyy-MM-dd`. Last day of the month
 * before the next fiscal-year start. FY=Jan → Dec 31, FY=Apr → Mar 31.
 */
export function fiscalYearEnd(now: Date, fyStartMonth: number): string {
  const startStr = fiscalYearStart(now, fyStartMonth);
  const start = new Date(`${startStr}T12:00:00`);
  const end = new Date(start.getFullYear() + 1, start.getMonth(), 0); // day 0 = last day of prev month
  return format(end, 'yyyy-MM-dd');
}

/**
 * DATE: Fiscal quarter boundaries. `q` is 1-4. Q1 = first 3 months of fiscal
 * year. Returns inclusive [start, end] yyyy-MM-dd strings.
 */
export function fiscalQuarter(now: Date, fyStartMonth: number, q: number): { start: string; end: string } {
  const fyStart = new Date(`${fiscalYearStart(now, fyStartMonth)}T12:00:00`);
  const startMonth = fyStart.getMonth() + (q - 1) * 3;
  const start = new Date(fyStart.getFullYear(), startMonth, 1);
  const end = new Date(fyStart.getFullYear(), startMonth + 3, 0); // last day of quarter
  return { start: format(start, 'yyyy-MM-dd'), end: format(end, 'yyyy-MM-dd') };
}

/**
 * DATE: Returns the fiscal quarter (1-4) containing the given date.
 */
export function currentFiscalQuarter(now: Date, fyStartMonth: number): number {
  const fyStart = new Date(`${fiscalYearStart(now, fyStartMonth)}T12:00:00`);
  const monthsSinceStart =
    (now.getFullYear() - fyStart.getFullYear()) * 12 + (now.getMonth() - fyStart.getMonth());
  return Math.floor(monthsSinceStart / 3) + 1;
}
