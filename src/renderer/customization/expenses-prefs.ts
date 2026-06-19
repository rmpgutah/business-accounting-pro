// src/renderer/customization/expenses-prefs.ts
//
// Mirrors invoicing-prefs.ts but reads from the `expenses` section. Note
// the slight quirk: the Expenses customization section was authored with
// every id prefixed `expenses-`, so the store key is e.g.
// `expenses.expenses-col-date`. Callers stay unaware — this helper hides
// the doubled prefix behind the readable field names.

import { useCustomizationStore } from '../stores/customizationStore';
import { optionKey } from './registry';

type Value = boolean | string | number;

function val(id: string): Value | undefined {
  return useCustomizationStore.getState().get(optionKey('expenses', id));
}
function bool(id: string, fallback = false): boolean {
  const v = val(id);
  return v == null ? fallback : Boolean(v);
}
function num(id: string, fallback: number): number {
  const v = Number(val(id));
  return Number.isFinite(v) ? v : fallback;
}
function str(id: string, fallback: string): string {
  const v = val(id);
  return v == null ? fallback : String(v);
}

const CURRENCY_SYMBOL: Record<string, string> = {
  usd: '$', eur: '€', gbp: '£', cad: '$', aud: '$', jpy: '¥',
};

/** Currency symbol resolved from the user's `expenses-currency-symbol` choice. */
export function expensesCurrencySymbol(): string {
  return CURRENCY_SYMBOL[str('expenses-currency-symbol', 'usd')] ?? '$';
}

/**
 * Format an expense amount using the persisted formatting preferences.
 * Honors symbol + position, decimals, thousands separator, negative
 * style, show-cents, round-display.
 */
export function formatExpenseAmount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) n = 0;
  let v = Number(n);

  if (bool('expenses-round-display', false)) v = Math.round(v);

  let decimals = Math.max(0, Math.min(4, num('expenses-decimal-places', 2)));
  if (!bool('expenses-show-cents', true)) decimals = 0;

  const negStyle = str('expenses-negative-style', 'minus'); // minus | parens | red
  const isNegative = v < 0;
  v = Math.abs(v);
  const fixed = v.toFixed(decimals);
  const [intPart, decPart] = fixed.split('.');

  const thouMap: Record<string, string> = { comma: ',', period: '.', space: ' ', none: '' };
  const thouSep = thouMap[str('expenses-thousands-separator', 'comma')] ?? ',';

  let grouped = '';
  for (let i = 0; i < intPart.length; i++) {
    if (i > 0 && (intPart.length - i) % 3 === 0) grouped += thouSep;
    grouped += intPart[i];
  }
  // Expenses keeps a fixed decimal separator (period) — there's no option
  // for it in the descriptor list, unlike Invoicing.
  const number = decPart ? `${grouped}.${decPart}` : grouped;

  const symbol = expensesCurrencySymbol();
  const before = str('expenses-symbol-position', 'before') === 'before';
  let body = before ? `${symbol}${number}` : `${number}${symbol}`;
  if (isNegative) body = negStyle === 'parens' ? `(${body})` : `-${body}`;
  return body;
}

export function isExpenseAmountNegativeRed(n: number | null | undefined): boolean {
  return Number(n) < 0 && str('expenses-negative-style', 'minus') === 'red';
}

/**
 * Format an ISO date per the expenses preference, with optional relative
 * shorthand ("Today", "Yesterday", "3 days ago") for recent dates.
 */
export function formatExpenseDate(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  if (!Number.isFinite(d.getTime())) return String(iso);

  if (bool('expenses-relative-dates', false)) {
    const startOfDay = (dt: Date) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
    const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days > 1 && days <= 14) return `${days} days ago`;
    if (days === -1) return 'Tomorrow';
    if (days < -1 && days >= -14) return `In ${-days} days`;
    // Fall through to formatted for dates outside ±14 days.
  }

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const monShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  switch (str('expenses-date-format', 'mdy')) {
    case 'dmy':  return `${dd}/${mm}/${yyyy}`;
    case 'iso':  return `${yyyy}-${mm}-${dd}`;
    case 'long': return `${monShort} ${d.getDate()}, ${yyyy}`;
    case 'mdy':
    default:     return `${mm}/${dd}/${yyyy}`;
  }
}

export interface ExpensesPrefs {
  rowsPerPage: number;
  density: 'compact' | 'comfortable' | 'spacious';
  showRunningTotal: boolean;
  stickyHeader: boolean;
  zebra: boolean;
  showThumbnails: boolean;
  highlightOverbudget: boolean;
  highlightUnreconciled: boolean;
  showSummaryCards: boolean;
  showQuickAddBar: boolean;
  uppercaseVendor: boolean;
  truncateMemo: number;
}

function readPrefs(): ExpensesPrefs {
  return {
    rowsPerPage: num('expenses-rows-per-page', 50),
    density: str('expenses-density', 'comfortable') as ExpensesPrefs['density'],
    showRunningTotal: bool('expenses-show-running-total', true),
    stickyHeader: bool('expenses-sticky-header', true),
    zebra: bool('expenses-zebra-striping', true),
    showThumbnails: bool('expenses-show-thumbnails', false),
    highlightOverbudget: bool('expenses-highlight-overbudget', true),
    highlightUnreconciled: bool('expenses-highlight-unreconciled', true),
    showSummaryCards: bool('expenses-show-summary-cards', true),
    showQuickAddBar: bool('expenses-show-quick-add-bar', true),
    uppercaseVendor: bool('expenses-uppercase-vendor', false),
    truncateMemo: num('expenses-truncate-memo', 40),
  };
}

export function useExpensesPrefs(): ExpensesPrefs {
  useCustomizationStore((s) => s.values);
  return readPrefs();
}

export function getExpensesPrefs(): ExpensesPrefs {
  return readPrefs();
}
