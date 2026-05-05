// src/main/services/ical-export.ts
//
// P6.69 — iCal / Google Calendar export of invoice due dates +
//         payroll runs.
//
// Generates RFC 5545 iCalendar text that the user can:
//   • Import into Apple Calendar / Google Calendar / Outlook (one-time)
//   • Subscribe to as a webcal:// feed (live updates) — future enhancement
//
// Renderer calls cal:export-ics → returns the raw .ics string. The
// renderer drops it into a save-dialog or copies to clipboard.

import * as db from '../database';

interface CalendarEvent {
  uid: string;
  summary: string;
  description: string;
  start: string;     // YYYY-MM-DD
  end?: string;      // YYYY-MM-DD (defaults to start)
  url?: string;
  category?: string;
}

// ICS spec requires CRLF line endings + max 75 chars per line (folded).
// Most consumers tolerate longer, but Apple Calendar gets cranky.
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  for (let i = 0; i < line.length; i += 73) {
    chunks.push((i === 0 ? '' : ' ') + line.slice(i, i + 73));
  }
  return chunks.join('\r\n');
}

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function formatDate(d: string): string {
  // YYYY-MM-DD → YYYYMMDD (DATE value type per RFC 5545)
  return d.replace(/-/g, '');
}

function nowUTC(): string {
  const d = new Date();
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' +
         pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
}

export function buildICS(events: CalendarEvent[], calendarName: string = 'Business Accounting Pro'): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Business Accounting Pro//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    foldLine('X-WR-CALNAME:' + escapeText(calendarName)),
  ];
  const dtstamp = nowUTC();

  for (const ev of events) {
    lines.push('BEGIN:VEVENT');
    lines.push('UID:' + ev.uid + '@business-accounting-pro');
    lines.push('DTSTAMP:' + dtstamp);
    lines.push('DTSTART;VALUE=DATE:' + formatDate(ev.start));
    lines.push('DTEND;VALUE=DATE:' + formatDate(ev.end || ev.start));
    lines.push(foldLine('SUMMARY:' + escapeText(ev.summary)));
    if (ev.description) lines.push(foldLine('DESCRIPTION:' + escapeText(ev.description)));
    if (ev.url) lines.push('URL:' + ev.url);
    if (ev.category) lines.push('CATEGORIES:' + escapeText(ev.category));
    lines.push('TRANSP:TRANSPARENT'); // doesn't block calendar busy time
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function exportInvoiceDueDates(companyId: string): string {
  const dbi = db.getDb();
  const rows = dbi.prepare(
    "SELECT id, invoice_number, total, due_date, status, client_id " +
    "FROM invoices " +
    "WHERE company_id = ? AND deleted_at IS NULL AND due_date IS NOT NULL AND due_date != '' AND status NOT IN ('paid', 'voided', 'cancelled')"
  ).all(companyId) as Array<{
    id: string; invoice_number: string; total: number; due_date: string; status: string; client_id: string;
  }>;

  const events: CalendarEvent[] = rows.map((inv) => {
    const client = dbi.prepare("SELECT name FROM clients WHERE id = ?").get(inv.client_id) as { name?: string } | undefined;
    const totalFmt = '$' + (inv.total ?? 0).toFixed(2);
    return {
      uid: 'invoice-' + inv.id,
      summary: 'Invoice ' + inv.invoice_number + ' due — ' + (client?.name || 'Client') + ' (' + totalFmt + ')',
      description: 'Invoice ' + inv.invoice_number + '\\nClient: ' + (client?.name || '') + '\\nAmount: ' + totalFmt + '\\nStatus: ' + inv.status,
      start: inv.due_date,
      category: 'Invoice',
    };
  });

  return buildICS(events, 'BAP — Invoice Due Dates');
}

export function exportPayrollSchedule(companyId: string): string {
  const dbi = db.getDb();
  let rows: Array<{ id: string; pay_date: string; period_start: string; period_end: string; status: string }> = [];
  try {
    rows = dbi.prepare(
      "SELECT id, pay_date, period_start, period_end, status FROM payroll_runs WHERE company_id = ? AND pay_date IS NOT NULL AND pay_date != ''"
    ).all(companyId) as any;
  } catch {
    return buildICS([], 'BAP — Payroll Schedule (no runs)');
  }

  const events: CalendarEvent[] = rows.map((r) => ({
    uid: 'payroll-' + r.id,
    summary: 'Payroll: pay date ' + r.pay_date,
    description: 'Period: ' + r.period_start + ' → ' + r.period_end + '\\nStatus: ' + r.status,
    start: r.pay_date,
    category: 'Payroll',
  }));

  return buildICS(events, 'BAP — Payroll Schedule');
}
