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
  if (isNaN(n)) return '$0.00';
  return _currencyFmt.format(n);
}

// ─── Date ────────────────────────────────────────────────
const _mediumFmt  = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const _shortFmt   = new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' });
const _relFmt     = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });

export function formatDate(
  isoString: string | null | undefined,
  opts?: { style?: 'short' | 'medium' | 'relative' }
): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
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
};

export function formatStatus(status: string | null | undefined): { label: string; className: string } {
  return STATUS_MAP[status ?? ''] ?? { label: status ?? '—', className: 'block-badge' };
}
