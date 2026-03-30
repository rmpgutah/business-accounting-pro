// ─── CSV Export Utility ─────────────────────────────────
// Generates CSV from data arrays and triggers download or
// delegates to main process for save-dialog export.

/**
 * Escape a CSV cell value — wraps in quotes if it contains
 * commas, double-quotes, or newlines.
 */
function escapeCSV(value: any): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Convert an array of objects to a CSV string.
 * Headers are derived from the keys of the first object.
 */
export function toCSVString(data: Record<string, any>[], columns?: string[]): string {
  if (data.length === 0) return '';
  const headers = columns || Object.keys(data[0]);
  const lines = [
    headers.join(','),
    ...data.map(row =>
      headers.map(h => escapeCSV(row[h])).join(',')
    ),
  ];
  return lines.join('\n');
}

/**
 * Trigger a browser-side CSV download via Blob URL.
 * Used when exporting selected rows from the renderer.
 */
export function downloadCSVBlob(data: Record<string, any>[], filename: string, columns?: string[]): void {
  const csv = toCSVString(data, columns);
  if (!csv) return;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export via main process (shows native save dialog).
 */
export async function exportViaDialog(table: string, filters?: Record<string, any>): Promise<{ path?: string; error?: string; cancelled?: boolean }> {
  return window.electronAPI.invoke('export:csv', { table, filters });
}
