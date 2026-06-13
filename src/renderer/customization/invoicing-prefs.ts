// src/renderer/customization/invoicing-prefs.ts
//
// Typed read-side for the Invoicing customization section. Exposes:
//   • `useInvoicingPrefs()` — reactive hook for components that need to
//     re-render when a preference changes (e.g. column toggles).
//   • Pure helpers `formatInvoiceAmount` / `formatInvoiceDate` /
//     `buildInvoiceNumber` for use inside render paths or initializers.
//
// All reads fall back to the descriptor default via the customization
// store's `get()` selector, so a fresh-install user sees the standard
// formatting until they change something.

import { useCustomizationStore } from '../stores/customizationStore';
import { optionKey } from './registry';

type Value = boolean | string | number;

function val(id: string): Value | undefined {
  return useCustomizationStore.getState().get(optionKey('invoicing', id));
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

// ─── Formatting helpers ───────────────────────────────────────────────

/**
 * Format a numeric amount using the invoicing customization preferences:
 * currency symbol + position, decimal places, thousands separator, decimal
 * separator, negative style, zero-as-dash. Mirrors how Intl.NumberFormat
 * works but driven entirely by the persisted prefs so users get a single
 * source of truth.
 */
export function formatInvoiceAmount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) n = 0;
  let v = Number(n);

  const decimals = Math.max(0, Math.min(4, num('formatting-decimal-places', 2)));
  const showZeroAsDash = bool('formatting-zero-as-dash', false);
  if (showZeroAsDash && Math.abs(v) < Math.pow(10, -decimals)) return '—';

  const negStyle = str('formatting-negative-style', 'minus'); // minus | parens | red
  const isNegative = v < 0;
  v = Math.abs(v);

  // Round before splitting so trailing 9.995 → 10.00 not "9.99 + .005".
  const fixed = v.toFixed(decimals);
  const [intPart, decPart] = fixed.split('.');

  const thouMap: Record<string, string> = { comma: ',', period: '.', space: ' ', none: '' };
  const decMap: Record<string, string> = { period: '.', comma: ',' };
  const thouSep = thouMap[str('formatting-thousands-separator', 'comma')] ?? ',';
  const decSep = decMap[str('formatting-decimal-separator', 'period')] ?? '.';

  // Group thousands without regex catastrophic-backtrack risk on huge values.
  let grouped = '';
  for (let i = 0; i < intPart.length; i++) {
    if (i > 0 && (intPart.length - i) % 3 === 0) grouped += thouSep;
    grouped += intPart[i];
  }
  const number = decPart ? `${grouped}${decSep}${decPart}` : grouped;

  const symbol = str('formatting-currency-symbol', '$');
  const before = str('formatting-currency-position', 'before') === 'before';
  let body = before ? `${symbol}${number}` : `${number}${symbol}`;

  if (isNegative) {
    if (negStyle === 'parens') body = `(${body})`;
    else body = `-${body}`; // 'red' is rendered upstream by CSS; sign still shown
  }
  return body;
}

/** Returns true when the negative-style is "red" — caller adds a CSS color. */
export function isInvoiceAmountNegativeRed(n: number | null | undefined): boolean {
  return Number(n) < 0 && str('formatting-negative-style', 'minus') === 'red';
}

/**
 * Format an ISO date (YYYY-MM-DD) per the invoicing date-format preference.
 * Non-parseable input returns an empty string.
 */
export function formatInvoiceDate(iso: string | null | undefined): string {
  if (!iso) return '';
  // Anchor at noon so DST/TZ boundaries don't shift the day.
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  if (!Number.isFinite(d.getTime())) return String(iso);

  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const monShort = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];

  switch (str('formatting-date-format', 'MM/DD/YYYY')) {
    case 'DD/MM/YYYY': return `${dd}/${mm}/${yyyy}`;
    case 'YYYY-MM-DD': return `${yyyy}-${mm}-${dd}`;
    case 'MMM D, YYYY': return `${monShort} ${d.getDate()}, ${yyyy}`;
    case 'MM/DD/YYYY':
    default:           return `${mm}/${dd}/${yyyy}`;
  }
}

// ─── Numbering ────────────────────────────────────────────────────────

/**
 * Build the next invoice number given a raw sequence integer.
 * Honors prefix, suffix, pad-length, include-year, include-month.
 *
 * Example: prefix="INV-", pad=4, include-year=true, seq=42, year=2026
 *   → "INV-2026-0042"
 */
export function buildInvoiceNumber(seq: number, now: Date = new Date()): string {
  const prefix = str('numbering-prefix', 'INV-');
  const suffix = str('numbering-suffix', '');
  const pad = Math.max(1, num('numbering-pad-length', 4));
  const includeYear = bool('numbering-include-year', false);
  const includeMonth = bool('numbering-include-month', false);

  const padded = String(Math.max(0, Math.floor(seq))).padStart(pad, '0');
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');

  const middle = [
    includeYear ? String(year) : '',
    includeMonth ? month : '',
    padded,
  ].filter(Boolean).join('-');

  return `${prefix}${middle}${suffix}`;
}

// ─── Reactive hook for components ─────────────────────────────────────

export interface InvoicingPrefs {
  // Display
  defaultView: string;
  rowsPerPage: number;
  compactRows: boolean;
  zebra: boolean;
  showTotalsBar: boolean;
  showAvatars: boolean;
  statusAsPills: boolean;
  density: 'compact' | 'comfortable' | 'spacious';
  showAgingBuckets: boolean;
  stickyHeader: boolean;
  overdueHighlight: boolean;
  showQuickFilters: boolean;
  // Columns
  cols: {
    invoiceNumber: boolean;
    client: boolean;
    issueDate: boolean;
    dueDate: boolean;
    amount: boolean;
    balanceDue: boolean;
    status: boolean;
    poNumber: boolean;
    tax: boolean;
    currency: boolean;
    daysOverdue: boolean;
    paymentMethod: boolean;
    project: boolean;
    tags: boolean;
    attachments: boolean;
  };
  amountAlign: 'left' | 'center' | 'right';
  // Defaults (form)
  paymentTerms: string;
  defaultTaxRate: number;
  defaultDiscountRate: number;
  defaultNotes: string;
  defaultFooterText: string;
  defaultTerms: string;
  defaultDueDays: number;
  defaultQuantity: number;
  includeShipping: boolean;
  perLineTax: boolean;
  defaultDiscountType: 'percent' | 'fixed';
  // Sorting & filtering (list)
  sortField: string;
  sortDir: 'asc' | 'desc';
  defaultStatusFilter: string;
  overdueGraceDays: number;
  // Behavior (form)
  allowManualNumberOverride: boolean;
  tabAddsLine: boolean;
  warnUnsaved: boolean;
  confirmBeforeDelete: boolean;
  actionOnSave: 'stay' | 'list' | 'new' | 'send';
}

function readPrefs(): InvoicingPrefs {
  return {
    defaultView: str('display-default-view', 'list'),
    rowsPerPage: num('display-rows-per-page', 25),
    compactRows: bool('display-compact-rows', false),
    zebra: bool('display-zebra-striping', true),
    showTotalsBar: bool('display-show-totals-bar', true),
    showAvatars: bool('display-show-avatars', true),
    statusAsPills: bool('display-status-as-pills', true),
    density: str('display-density', 'comfortable') as InvoicingPrefs['density'],
    showAgingBuckets: bool('display-show-aging-buckets', true),
    stickyHeader: bool('display-sticky-header', true),
    overdueHighlight: bool('display-overdue-highlight', true),
    showQuickFilters: bool('display-show-quick-filters', true),
    cols: {
      invoiceNumber: bool('columns-show-invoice-number', true),
      client: bool('columns-show-client', true),
      issueDate: bool('columns-show-issue-date', true),
      dueDate: bool('columns-show-due-date', true),
      amount: bool('columns-show-amount', true),
      balanceDue: bool('columns-show-balance-due', true),
      status: bool('columns-show-status', true),
      poNumber: bool('columns-show-po-number', false),
      tax: bool('columns-show-tax', false),
      currency: bool('columns-show-currency', false),
      daysOverdue: bool('columns-show-days-overdue', true),
      paymentMethod: bool('columns-show-payment-method', false),
      project: bool('columns-show-project', false),
      tags: bool('columns-show-tags', false),
      attachments: bool('columns-show-attachments', false),
    },
    amountAlign: str('columns-amount-alignment', 'right') as InvoicingPrefs['amountAlign'],
    paymentTerms: str('defaults-payment-terms', 'net30'),
    defaultTaxRate: num('defaults-tax-rate', 0),
    defaultDiscountRate: num('defaults-discount-rate', 0),
    defaultNotes: str('defaults-notes', 'Thank you for your business!'),
    defaultFooterText: str('defaults-footer-text', 'Payment is due within the stated terms.'),
    defaultTerms: str('defaults-terms-conditions', 'Late payments are subject to a service charge.'),
    defaultDueDays: num('defaults-due-days', 30),
    defaultQuantity: num('defaults-default-quantity', 1),
    includeShipping: bool('defaults-include-shipping', false),
    perLineTax: bool('defaults-line-item-tax', false),
    defaultDiscountType: str('defaults-discount-type', 'percent') as InvoicingPrefs['defaultDiscountType'],
    sortField: str('sort-default-field', 'issue_date'),
    sortDir: str('sort-default-direction', 'desc') as InvoicingPrefs['sortDir'],
    defaultStatusFilter: str('filter-default-status', 'all'),
    overdueGraceDays: num('filter-overdue-grace-days', 0),
    allowManualNumberOverride: bool('numbering-allow-manual-override', true),
    tabAddsLine: bool('behavior-tab-adds-line', true),
    warnUnsaved: bool('behavior-warn-unsaved', true),
    confirmBeforeDelete: bool('behavior-confirm-before-delete', true),
    actionOnSave: str('behavior-default-action-on-save', 'stay') as InvoicingPrefs['actionOnSave'],
  };
}

/**
 * Reactive hook — components re-render whenever any invoicing preference
 * changes. Subscribes to the whole `values` map (cheap; it's a small object
 * keyed only by overridden options) and re-derives the typed view.
 */
export function useInvoicingPrefs(): InvoicingPrefs {
  // We subscribe to `values` so the hook re-runs on any change; the actual
  // read goes through `get()` which falls back to descriptor defaults.
  useCustomizationStore((s) => s.values);
  return readPrefs();
}

/** Non-reactive read for use inside one-shot initializers (e.g. form init). */
export function getInvoicingPrefs(): InvoicingPrefs {
  return readPrefs();
}

/**
 * Translate a `defaults-payment-terms` enum value into a (displayLabel, days)
 * tuple. The form uses display labels in its `terms` field for backwards
 * compatibility with existing invoices.
 */
export function termsValueToLabel(v: string): { label: string; days: number } {
  switch (v) {
    case 'due_on_receipt': return { label: 'Due on receipt', days: 0 };
    case 'net7':           return { label: 'Net 7',          days: 7 };
    case 'net15':          return { label: 'Net 15',         days: 15 };
    case 'net30':          return { label: 'Net 30',         days: 30 };
    case 'net60':          return { label: 'Net 60',         days: 60 };
    case 'net90':          return { label: 'Net 90',         days: 90 };
    default:               return { label: 'Net 30',         days: 30 };
  }
}
