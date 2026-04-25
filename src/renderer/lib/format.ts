// src/renderer/lib/format.ts

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
// All dates formatted in Mountain Time (America/Denver → MST/MDT, UTC-0600/0700)
const TZ = 'America/Denver';
const _mediumFmt  = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: TZ });
const _shortFmt   = new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: '2-digit', timeZone: TZ });
const _relFmt     = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });

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
  if (style === 'short')  return _shortFmt.format(d);
  if (style === 'medium') return _mediumFmt.format(d);
  // relative
  const diffMs  = d.getTime() - Date.now();
  const diffDays = Math.round(diffMs / 86_400_000);
  if (Math.abs(diffDays) < 1)   return 'today';
  if (Math.abs(diffDays) < 30)  return _relFmt.format(diffDays, 'day');
  if (Math.abs(diffDays) < 365) return _relFmt.format(Math.round(diffDays / 30), 'month');
  return _relFmt.format(Math.round(diffDays / 365), 'year');
}

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
  return STATUS_MAP[status ?? ''] ?? { label: status ?? '—', className: 'block-badge' };
}
