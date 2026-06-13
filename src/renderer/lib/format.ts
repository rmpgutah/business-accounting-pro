// src/renderer/lib/format.ts

// ─── Labels ──────────────────────────────────────────────
// Acronyms / special-cased terms with a canonical formal spelling. Matched
// case-insensitively, per whole-word, so "ein" → "EIN" and "user_id" → "User ID".
const LABEL_OVERRIDES: Record<string, string> = {
  ach: 'ACH', ein: 'EIN', ssn: 'SSN', fica: 'FICA', futa: 'FUTA', suta: 'SUTA',
  ytd: 'YTD', mtd: 'MTD', qtd: 'QTD', pto: 'PTO', hsa: 'HSA', fsa: 'FSA',
  '401k': '401(k)', w2: 'W-2', w4: 'W-4', w9: 'W-9', '1099': '1099',
  llc: 'LLC', usd: 'USD', vat: 'VAT', po: 'PO', id: 'ID', api: 'API',
  csv: 'CSV', pdf: 'PDF', url: 'URL', sku: 'SKU', kpi: 'KPI', cogs: 'COGS',
  ar: 'AR', ap: 'AP', gl: 'GL', je: 'JE', mfj: 'MFJ', hoh: 'HOH',
  // Compound terms that read better hyphenated.
  biweekly: 'Bi-Weekly', semimonthly: 'Semi-Monthly', semiweekly: 'Semi-Weekly',
};
// Minor words kept lowercase inside a title — never when they are the first word.
const MINOR_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs', 'with']);

// Turn raw enum/status/identifier values into formal, readable Title Case
// English. Replaces "_"/"-" spacers with spaces, applies acronym/special-term
// overrides, and Title-Cases the rest (minor words lowercased mid-phrase), so
// stored values like "in_collection", "married_filing_jointly" or "biweekly"
// never leak to the UI as snake_case or lower case. For badges that should
// SHOUT, wrap the output in CSS text-transform: uppercase.
export function humanizeLabel(value: string | null | undefined): string {
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  const whole = raw.toLowerCase();
  if (LABEL_OVERRIDES[whole]) return LABEL_OVERRIDES[whole];
  const words = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ');
  return words
    .map((w, i) => {
      const lw = w.toLowerCase();
      if (LABEL_OVERRIDES[lw]) return LABEL_OVERRIDES[lw];
      if (i > 0 && MINOR_WORDS.has(lw)) return lw;
      return lw.charAt(0).toUpperCase() + lw.slice(1);
    })
    .join(' ');
}

// Friendly payment-method labels. The DB stores snake_case enum values
// (debit_card, credit_card, bank_transfer, ach, …); this map turns them into
// proper-English for every UI surface and printed document. Unknown values
// fall back to humanizeLabel so newly-added methods aren't shown raw.
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  check: 'Check',
  credit_card: 'Credit Card',
  debit_card: 'Debit Card',
  bank_transfer: 'Bank Transfer',
  ach: 'ACH',
  wire: 'Wire Transfer',
  wire_transfer: 'Wire Transfer',
  paypal: 'PayPal',
  venmo: 'Venmo',
  zelle: 'Zelle',
  apple_pay: 'Apple Pay',
  google_pay: 'Google Pay',
  stripe: 'Stripe',
  square: 'Square',
  cashapp: 'Cash App',
  money_order: 'Money Order',
  cashiers_check: "Cashier's Check",
  gift_card: 'Gift Card',
  store_credit: 'Store Credit',
  other: 'Other',
};

/**
 * Format a payment-method enum value for display. Empty/null returns '—'.
 * Unknown values pass through humanizeLabel rather than rendering raw
 * snake_case (e.g. an unmapped "money_order_express" still becomes
 * "Money order express" instead of leaking the underscore).
 */
export function formatPaymentMethod(value: string | null | undefined): string {
  if (!value) return '—';
  const key = String(value).toLowerCase().trim();
  return PAYMENT_METHOD_LABELS[key] || humanizeLabel(value);
}

// ─── Currency ────────────────────────────────────────────
const _currencyFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  // Guard NaN AND Infinity — division-by-zero in callers (e.g. percent-of-balance,
  // forecasting denominators) would otherwise render "$∞" or "$NaN".
  if (!Number.isFinite(n)) return '$0.00';
  return _currencyFmt.format(n);
}

/**
 * Round a money amount to whole cents. Use at every persistence/display
 * boundary so 0.1 + 0.2 doesn't end up stored as 0.30000000000000004.
 * Pure function — does not affect Intl formatting; that already uses 2 dp.
 */
export function roundCents(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Percent change with safe handling of a zero prior period: returns `null`
 * (so the UI can render "—") instead of NaN/Infinity. Caller can decide
 * whether to display 0%, "n/a", or "new".
 */
export function percentChange(current: number, prior: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(prior)) return null;
  if (prior === 0) return null;
  return ((current - prior) / prior) * 100;
}

// ─── Date ────────────────────────────────────────────────
// Timezone used for date formatting. Default Mountain Time (America/Denver).
// Override by importing and calling setTz() or by setting
// localStorage 'bap-timezone'. Per-company override possible via
// personalizationStore.cloudLoad().
let _tz = (typeof localStorage !== 'undefined' && localStorage.getItem('bap-timezone'))
  || 'America/Denver';
export function setTz(tz: string) {
  _tz = tz;
  if (typeof localStorage !== 'undefined') localStorage.setItem('bap-timezone', tz);
}
export function getTz(): string { return _tz; }
function _fmt(style: 'short' | 'medium') {
  return new Intl.DateTimeFormat('en-US', {
    month: style === 'medium' ? 'short' : '2-digit',
    day: 'numeric',
    year: style === 'medium' ? 'numeric' : '2-digit',
    timeZone: _tz,
  });
}
let _cachedMedium = _fmt('medium');
let _cachedShort = _fmt('short');
function _resetCache() { _cachedMedium = _fmt('medium'); _cachedShort = _fmt('short'); }
const _relFmt = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });

export function formatDate(
  isoString: string | null | undefined,
  opts?: { style?: 'short' | 'medium' | 'relative' }
): string {
  if (!isoString) return '—';
  // A bare 'YYYY-MM-DD' is parsed as UTC midnight by `new Date(...)`, which
  // formats as the previous day in America/Denver (UTC-0600/0700). For
  // date-only inputs anchor at local noon so the calendar date round-trips.
  const isDateOnly =
    typeof isoString === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(isoString);
  const d = isDateOnly
    ? new Date(`${isoString}T12:00:00`)
    : new Date(isoString);
  if (isNaN(d.getTime())) return '—';
  const style = opts?.style ?? 'medium';
  if (style === 'short')  return _cachedShort.format(d);
  if (style === 'medium') return _cachedMedium.format(d);
  // relative
  const diffMs  = d.getTime() - Date.now();
  const diffDays = Math.round(diffMs / 86_400_000);
  if (Math.abs(diffDays) < 1)   return 'today';
  if (Math.abs(diffDays) < 30)  return _relFmt.format(diffDays, 'day');
  if (Math.abs(diffDays) < 365) return _relFmt.format(Math.round(diffDays / 30), 'month');
  return _relFmt.format(Math.round(diffDays / 365), 'year');
}

export function formatDateTime(isoString: string | null | undefined): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '—';
  return _cachedMedium.format(d) + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

export function resetDateCache() { _resetCache(); }

// ─── Status ──────────────────────────────────────────────
const STATUS_MAP: Record<string, { label: string; className: string }> = {
  // Invoices / Bills
  draft:            { label: 'Draft',            className: 'block-badge block-badge-blue' },
  sent:             { label: 'Sent',             className: 'block-badge block-badge-warning' },
  paid:             { label: 'Paid',             className: 'block-badge block-badge-income' },
  overdue:          { label: 'Overdue',          className: 'block-badge block-badge-expense' },
  partial:          { label: 'Partial',          className: 'block-badge block-badge-purple' },
  void:             { label: 'Void',             className: 'block-badge' },
  cancelled:        { label: 'Cancelled',        className: 'block-badge' },
  // Approvals / Rules
  pending:          { label: 'Pending',          className: 'block-badge block-badge-warning' },
  pending_approval: { label: 'Pending Approval', className: 'block-badge block-badge-warning' },
  approved:         { label: 'Approved',         className: 'block-badge block-badge-income' },
  rejected:         { label: 'Rejected',         className: 'block-badge block-badge-expense' },
  // Clients / Vendors
  active:           { label: 'Active',           className: 'block-badge block-badge-income' },
  inactive:         { label: 'Inactive',         className: 'block-badge block-badge-expense' },
  prospect:         { label: 'Prospect',         className: 'block-badge block-badge-blue' },
  // Projects / Budgets
  open:             { label: 'Open',             className: 'block-badge block-badge-blue' },
  closed:           { label: 'Closed',           className: 'block-badge' },
  in_progress:      { label: 'In Progress',      className: 'block-badge block-badge-warning' },
  completed:        { label: 'Completed',        className: 'block-badge block-badge-income' },
  // Debt Collection
  in_collection:    { label: 'In Collection',    className: 'block-badge block-badge-warning' },
  legal:            { label: 'Legal',            className: 'block-badge block-badge-expense' },
  settled:          { label: 'Settled',          className: 'block-badge block-badge-income' },
  written_off:      { label: 'Written Off',      className: 'block-badge' },
  disputed:         { label: 'Disputed',         className: 'block-badge block-badge-purple' },
  investigating:    { label: 'Investigating',    className: 'block-badge block-badge-blue' },
  on_hold:          { label: 'On Hold',          className: 'block-badge block-badge-warning' },
  bankruptcy:       { label: 'Bankruptcy',       className: 'block-badge block-badge-expense' },
  // Quotes
  accepted:         { label: 'Accepted',         className: 'block-badge block-badge-income' },
  expired:          { label: 'Expired',          className: 'block-badge' },
  converted:        { label: 'Converted',        className: 'block-badge block-badge-purple' },
  // Debt Pipeline Stages
  reminder:         { label: 'Reminder',         className: 'block-badge block-badge-blue' },
  warning:          { label: 'Warning',          className: 'block-badge block-badge-warning' },
  final_notice:     { label: 'Final Notice',     className: 'block-badge block-badge-expense' },
  demand_letter:    { label: 'Demand Letter',    className: 'block-badge block-badge-expense' },
  collections_agency: { label: 'Collections',    className: 'block-badge block-badge-purple' },
  legal_action:     { label: 'Legal Action',     className: 'block-badge block-badge-expense' },
  judgment:         { label: 'Judgment',         className: 'block-badge block-badge-income' },
  garnishment:      { label: 'Garnishment',      className: 'block-badge block-badge-warning' },
  // Legal Action Status
  preparing:        { label: 'Preparing',        className: 'block-badge block-badge-blue' },
  filed:            { label: 'Filed',            className: 'block-badge block-badge-warning' },
  served:           { label: 'Served',           className: 'block-badge block-badge-warning' },
  hearing_scheduled:{ label: 'Hearing Set',      className: 'block-badge block-badge-purple' },
  appeal:           { label: 'Appeal',           className: 'block-badge block-badge-expense' },
};

export function formatStatus(status: string | null | undefined): { label: string; className: string } {
  // Fall back to a humanized label (never raw snake_case) for unmapped statuses.
  return STATUS_MAP[status ?? ''] ?? { label: status ? humanizeLabel(status) : '—', className: 'block-badge' };
}
