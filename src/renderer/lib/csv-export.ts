// ─── CSV Export Utility ─────────────────────────────────
// Generates CSV from data arrays and triggers download or
// delegates to main process for save-dialog export.
//
// RFC 4180 compliant: CRLF line endings, quoted fields
// containing commas/quotes/newlines, internal quotes doubled.
// Prepends UTF-8 BOM so Excel auto-detects encoding.

export interface CSVColumn {
  /** Object key used to read the cell value. */
  key: string;
  /** Human-readable header shown in the CSV (e.g. "Invoice Number"). */
  label?: string;
  /** Optional per-cell formatter. */
  format?: (value: any, row: Record<string, any>) => string | number | null | undefined;
}

export type ColumnSpec = string | CSVColumn;

const SNAKE_LABELS: Record<string, string> = {
  invoice_number: 'Invoice Number',
  client_id: 'Client',
  client_name: 'Client Name',
  issue_date: 'Issue Date',
  due_date: 'Due Date',
  subtotal: 'Subtotal',
  tax_amount: 'Tax',
  discount_amount: 'Discount',
  amount_paid: 'Amount Paid',
  payment_method: 'Payment Method',
  payment_terms: 'Payment Terms',
  hourly_rate: 'Hourly Rate',
  pay_rate: 'Pay Rate',
  pay_type: 'Pay Type',
  pay_schedule: 'Pay Schedule',
  duration_minutes: 'Duration (min)',
  is_billable: 'Billable',
  is_active: 'Active',
  start_date: 'Start Date',
  end_date: 'End Date',
  budget_type: 'Budget Type',
  project_id: 'Project',
  vendor_id: 'Vendor',
  category_id: 'Category',
  address_line1: 'Address',
  created_at: 'Created',
  updated_at: 'Updated',
  tax_id: 'Tax ID',
};

/** Title-case a snake_case identifier as a reasonable fallback header. */
export function humanizeHeader(key: string): string {
  if (SNAKE_LABELS[key]) return SNAKE_LABELS[key];
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Escape a CSV cell value — wraps in quotes if it contains
 * commas, double-quotes, carriage returns, or newlines.
 * Leading `=`, `+`, `-`, `@` are prefixed with an apostrophe
 * to prevent Excel CSV injection / formula execution.
 */
function escapeCSV(value: any): string {
  if (value === null || value === undefined) return '';
  let str: string;
  if (value instanceof Date) {
    str = isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  } else if (typeof value === 'boolean') {
    str = value ? 'Yes' : 'No';
  } else {
    str = String(value);
  }

  // CSV injection guard — block formulas in spreadsheet apps.
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  if (
    str.includes(',') ||
    str.includes('"') ||
    str.includes('\n') ||
    str.includes('\r')
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function normalizeColumns(data: Record<string, any>[], columns?: ColumnSpec[]): CSVColumn[] {
  const raw = columns && columns.length > 0 ? columns : Object.keys(data[0] ?? {});
  return raw.map((c) =>
    typeof c === 'string' ? { key: c, label: humanizeHeader(c) } : { label: humanizeHeader(c.key), ...c }
  );
}

/**
 * Convert an array of objects to a CSV string (RFC 4180, CRLF line endings).
 * Headers are human-readable by default — pass `CSVColumn[]` to customize.
 */
export function toCSVString(data: Record<string, any>[], columns?: ColumnSpec[]): string {
  if (!data || data.length === 0) return '';
  const cols = normalizeColumns(data, columns);
  const lines: string[] = [];
  lines.push(cols.map((c) => escapeCSV(c.label ?? c.key)).join(','));
  for (const row of data) {
    lines.push(
      cols
        .map((c) => {
          const raw = row[c.key];
          const v = c.format ? c.format(raw, row) : raw;
          return escapeCSV(v);
        })
        .join(',')
    );
  }
  return lines.join('\r\n');
}

/** Build a dated filename: `{slug}-{yyyy-MM-dd}.csv`. */
export function dateStampedFilename(slug: string, ext = 'csv'): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const safe = slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'export';
  return `${safe}-${y}-${m}-${day}.${ext}`;
}

/**
 * Trigger a browser-side CSV download via Blob URL.
 * Prepends UTF-8 BOM so Excel opens non-ASCII characters correctly.
 */
export function downloadCSVBlob(
  data: Record<string, any>[],
  filename: string,
  columns?: ColumnSpec[]
): void {
  const csv = toCSVString(data, columns);
  if (!csv) {
    // eslint-disable-next-line no-alert
    try { alert('Nothing to export — the report is empty.'); } catch { /* noop in tests */ }
    return;
  }
  // UTF-8 BOM so Excel recognizes the encoding.
  const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on next tick so the download starts reliably in all browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Export via main process (shows native save dialog).
 */
export async function exportViaDialog(
  table: string,
  filters?: Record<string, any>
): Promise<{ path?: string; error?: string; cancelled?: boolean }> {
  return window.electronAPI.invoke('export:csv', { table, filters });
}

/**
 * Safely fire print after ensuring the DOM has flushed and any
 * open modals have a chance to close. Guards against firing print
 * before data has loaded.
 */
export function printWhenReady(opts?: { isReady?: () => boolean; closeModals?: () => void }): void {
  if (opts?.closeModals) {
    try { opts.closeModals(); } catch { /* ignore */ }
  }
  const go = () => {
    if (opts?.isReady && !opts.isReady()) {
      // Retry briefly if data isn't ready yet.
      setTimeout(go, 100);
      return;
    }
    window.print();
  };
  // Double-rAF to ensure React has flushed and modal close animations have started.
  requestAnimationFrame(() => requestAnimationFrame(go));
}
