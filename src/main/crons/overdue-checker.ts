// src/main/crons/overdue-checker.ts
//
// P1.7 — Auto-OVERDUE Stamp Scheduler
//
// Scans all sent invoices and bills, flips ones that have crossed
// their due date (with optional grace period) into the 'overdue'
// status. Without this cron, invoices only become OVERDUE when
// manually status-changed — most users never bother, so the
// OVERDUE stamp on PDFs never appears even on a 90-day-old invoice.
//
// Design choices:
//
//  • Idempotent — re-running the same day produces zero side effects
//    (the WHERE clause already excludes already-overdue rows).
//
//  • Per-company grace period via settings table key
//    'auto_overdue_grace_days' (clamped to [0, 90]). 0 = flip on the
//    day the due date passes; >0 = wait N additional days. Defaults
//    to 0 since most accounting software flips immediately.
//
//  • Each flip emits invoice.overdue / bill.overdue on the EventBus
//    so workflows (auto-email reminders, slack notifications) can
//    subscribe. Also writes an audit_log entry for compliance trail.
//
//  • Returns counts so the caller can surface a notification to the
//    user ("3 invoices became overdue today").
//
//  • SAFETY: only flips status='sent' (not draft, not paid, not
//    voided, not partial). Partial-paid invoices stay 'partial' to
//    preserve existing payment context; the user can manually escalate
//    those if they want OVERDUE messaging on top of the partial state.

import type { Database } from 'better-sqlite3';
import * as db from '../database';
import { eventBus } from '../services/EventBus';

export interface OverdueCheckResult {
  invoicesFlipped: number;
  billsFlipped: number;
  companiesScanned: number;
  errors: string[];
}

function getGraceDays(database: Database, companyId: string): number {
  try {
    const row = database.prepare(
      "SELECT value FROM settings WHERE company_id = ? AND key = 'auto_overdue_grace_days'"
    ).get(companyId) as { value?: string } | undefined;
    const v = parseInt(row?.value ?? '', 10);
    if (Number.isFinite(v) && v >= 0) return Math.min(v, 90);
  } catch { /* fall through */ }
  return 0;
}

// Today as YYYY-MM-DD in LOCAL timezone — matches how due_date is
// stored (TEXT YYYY-MM-DD). UTC comparison would shift dates by
// ±1 day for users in non-UTC zones near midnight.
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function dateMinusDays(isoDate: string, days: number): string {
  if (days <= 0) return isoDate;
  // Anchor at noon LOCAL to avoid DST edge cases.
  const dt = new Date(`${isoDate}T12:00:00`);
  dt.setDate(dt.getDate() - days);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function runOverdueCheck(): OverdueCheckResult {
  const result: OverdueCheckResult = {
    invoicesFlipped: 0,
    billsFlipped: 0,
    companiesScanned: 0,
    errors: [],
  };

  let database: Database;
  try {
    database = db.getDb();
  } catch (err: any) {
    result.errors.push(`Database not ready: ${err?.message || err}`);
    return result;
  }

  let companies: { id: string }[] = [];
  try {
    companies = database.prepare(`SELECT id FROM companies`).all() as { id: string }[];
  } catch (err: any) {
    result.errors.push(`Failed to list companies: ${err?.message || err}`);
    return result;
  }

  const today = localTodayISO();

  for (const { id: companyId } of companies) {
    result.companiesScanned++;
    const graceDays = getGraceDays(database, companyId);
    // Effective cutoff: an invoice is overdue when due_date <= cutoff.
    // With grace=5, an invoice due 2026-05-01 only flips on 2026-05-06.
    const cutoff = dateMinusDays(today, graceDays);

    // ── Invoices ──────────────────────────────────────────
    try {
      const candidates = database.prepare(`
        SELECT id, invoice_number, total, amount_paid, due_date, client_id
        FROM invoices
        WHERE company_id = ?
          AND status = 'sent'
          AND due_date IS NOT NULL
          AND due_date != ''
          AND due_date <= ?
          AND COALESCE(amount_paid, 0) < COALESCE(total, 0)
      `).all(companyId, cutoff) as Array<{
        id: string; invoice_number: string;
        total: number; amount_paid: number;
        due_date: string; client_id: string;
      }>;

      if (candidates.length > 0) {
        const update = database.prepare(
          `UPDATE invoices SET status = 'overdue', updated_at = datetime('now') WHERE id = ?`
        );
        const tx = database.transaction((rows: typeof candidates) => {
          for (const inv of rows) update.run(inv.id);
        });
        tx(candidates);

        for (const inv of candidates) {
          result.invoicesFlipped++;
          // Audit trail — surfaces in the per-invoice activity feed.
          try {
            db.logAudit(companyId, 'invoices', inv.id, 'auto_overdue', {
              previous_status: 'sent',
              new_status: 'overdue',
              due_date: inv.due_date,
              days_overdue: Math.max(0, Math.floor(
                (new Date(`${today}T12:00:00`).getTime() - new Date(`${inv.due_date}T12:00:00`).getTime()) / 86_400_000
              )),
              grace_days: graceDays,
              cron: 'overdue-checker',
            });
          } catch { /* audit best-effort */ }

          // Emit semantic event — workflows can subscribe to fire
          // payment-reminder emails, slack messages, etc.
          try {
            eventBus.emit({
              type: 'invoice.overdue',
              entityType: 'invoice',
              entityId: inv.id,
              companyId,
              data: {
                invoice_number: inv.invoice_number,
                total: inv.total,
                amount_paid: inv.amount_paid,
                balance_due: Number(inv.total || 0) - Number(inv.amount_paid || 0),
                due_date: inv.due_date,
                client_id: inv.client_id,
                grace_days: graceDays,
                source: 'auto_overdue_cron',
              },
            });
          } catch { /* event-bus best-effort */ }
        }
      }
    } catch (err: any) {
      result.errors.push(`Invoice scan (company ${companyId}): ${err?.message || err}`);
    }

    // ── Bills ─────────────────────────────────────────────
    // Symmetric flow for accounts-payable. Bill schema uses
    // 'pending' as the pre-payment state (vs invoices' 'sent') and
    // ALSO supports 'sent' for sent-to-vendor in some flows.
    try {
      const candidates = database.prepare(`
        SELECT id, bill_number, total, amount_paid, due_date, vendor_id
        FROM bills
        WHERE company_id = ?
          AND status IN ('sent', 'pending', 'approved')
          AND due_date IS NOT NULL
          AND due_date != ''
          AND due_date <= ?
          AND COALESCE(amount_paid, 0) < COALESCE(total, 0)
      `).all(companyId, cutoff) as Array<{
        id: string; bill_number: string;
        total: number; amount_paid: number;
        due_date: string; vendor_id: string;
      }>;

      if (candidates.length > 0) {
        const update = database.prepare(
          `UPDATE bills SET status = 'overdue', updated_at = datetime('now') WHERE id = ?`
        );
        const tx = database.transaction((rows: typeof candidates) => {
          for (const b of rows) update.run(b.id);
        });
        tx(candidates);

        for (const b of candidates) {
          result.billsFlipped++;
          try {
            db.logAudit(companyId, 'bills', b.id, 'auto_overdue', {
              new_status: 'overdue',
              due_date: b.due_date,
              grace_days: graceDays,
              cron: 'overdue-checker',
            });
          } catch { /* audit best-effort */ }
          try {
            eventBus.emit({
              type: 'bill.overdue',
              entityType: 'bill',
              entityId: b.id,
              companyId,
              data: {
                bill_number: b.bill_number,
                total: b.total,
                amount_paid: b.amount_paid,
                balance_due: Number(b.total || 0) - Number(b.amount_paid || 0),
                due_date: b.due_date,
                vendor_id: b.vendor_id,
                grace_days: graceDays,
                source: 'auto_overdue_cron',
              },
            });
          } catch { /* event-bus best-effort */ }
        }
      }
    } catch (err: any) {
      result.errors.push(`Bill scan (company ${companyId}): ${err?.message || err}`);
    }
  }

  return result;
}
