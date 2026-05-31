// src/main/crons/status-reconcile.ts
//
// AREA 1 — Invoice / Bill Status Auto-Reconcile (highest priority)
//
// Fixes a known bug class where the denormalized `status` column
// drifts from the real balance:
//
//   • a fully-paid invoice still showing 'overdue' (the overdue cron
//     stamped it; nothing ever cleared it when the last payment hit),
//   • an 'overdue' invoice that received a partial payment but never
//     got downgraded to 'partial',
//   • an invoice past its due date still reading 'sent' (e.g. because
//     the overdue cron skipped it under an edge case).
//
// This cron is the BALANCE-AWARE successor to overdue-checker.ts.
// Whereas overdue-checker only flips 'sent' -> 'overdue' (one-way,
// balance-blind for the downgrade direction), this scan computes the
// canonical status via the shared `deriveStatus` helper and corrects
// rows in BOTH directions (settled->paid, owed+pastdue->overdue,
// partial<->overdue, etc.).
//
// Design choices (mirrors overdue-checker.ts):
//
//  • Idempotent — re-running produces zero writes once converged
//    (we only UPDATE rows whose stored status differs from derived).
//
//  • Best-effort — never throws. Per-company / per-table failures are
//    captured in `errors[]` and the scan continues.
//
//  • Pure logic lives in src/shared/invoice-status.ts so the renderer
//    can show the same derived status without a round-trip.
//
//  • SAFETY: `deriveStatus` never changes 'draft'/'void'/'cancelled'
//    (human-intent states). Additionally, because the two tables have
//    DIFFERENT CHECK constraints, we only write a derived status that
//    is in the target table's allowed set — a derived 'sent' for a
//    bill (bills' CHECK has no 'sent') is mapped to 'pending', and we
//    never write a status the column would reject.
//
//  • Emits an EventBus event per fix when the transition matches an
//    existing semantic event ('invoice.paid'/'bill.paid' on settle,
//    'invoice.overdue'/'bill.overdue' on past-due) so downstream
//    workflows still react. (No new 'invoice.status_reconciled' event
//    type is emitted to avoid widening the EventType union / editing
//    EventBus.ts.) Every fix also writes an audit_log entry.

import type { Database } from 'better-sqlite3';
import * as db from '../database';
import { eventBus } from '../services/EventBus';
import { deriveStatus, balanceDue } from '../../shared/invoice-status';

export interface StatusReconcileResult {
  invoicesFixed: number;
  billsFixed: number;
  companiesScanned: number;
  errors: string[];
}

// Allowed status values per the schema CHECK constraints. We never
// write a status outside these sets (would throw a constraint error).
const INVOICE_STATUSES = new Set(['draft', 'sent', 'paid', 'overdue', 'cancelled', 'partial']);
const BILL_STATUSES = new Set(['draft', 'pending', 'received', 'approved', 'partial', 'paid', 'overdue', 'void']);

// Today as YYYY-MM-DD in LOCAL timezone — matches how due_date is
// stored (TEXT YYYY-MM-DD) and how overdue-checker.ts computes it.
// UTC would shift dates by ±1 day near midnight in non-UTC zones.
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

interface Row {
  id: string;
  number: string;
  total: number;
  amount_paid: number;
  due_date: string | null;
  status: string;
}

// Map a derived status onto a value valid for the target table.
// `deriveStatus` only ever returns paid/partial/overdue/sent (plus the
// frozen draft/void/cancelled which we never reach here). For bills,
// 'sent' has no slot in the CHECK constraint → 'pending'.
function normalizeForBill(derived: string): string {
  if (derived === 'sent') return 'pending';
  return derived;
}

export function runStatusReconcile(): StatusReconcileResult {
  const result: StatusReconcileResult = {
    invoicesFixed: 0,
    billsFixed: 0,
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

    // ── Invoices ──────────────────────────────────────────
    try {
      const rows = database.prepare(`
        SELECT id,
               invoice_number AS number,
               COALESCE(total, 0)       AS total,
               COALESCE(amount_paid, 0) AS amount_paid,
               due_date,
               status
        FROM invoices
        WHERE company_id = ?
      `).all(companyId) as Row[];

      const update = database.prepare(
        `UPDATE invoices SET status = ?, updated_at = datetime('now') WHERE id = ?`
      );

      for (const row of rows) {
        const derived = deriveStatus(
          { total: row.total, amount_paid: row.amount_paid, due_date: row.due_date ?? '', status: row.status },
          today
        );
        // Only real corrections, and only to a status the column allows.
        if (derived === row.status || !INVOICE_STATUSES.has(derived)) continue;

        try {
          update.run(derived, row.id);
        } catch (err: any) {
          result.errors.push(`Invoice update ${row.id}: ${err?.message || err}`);
          continue;
        }
        result.invoicesFixed++;
        emitFix('invoice', companyId, row, derived);
      }
    } catch (err: any) {
      result.errors.push(`Invoice scan (company ${companyId}): ${err?.message || err}`);
    }

    // ── Bills ─────────────────────────────────────────────
    try {
      const rows = database.prepare(`
        SELECT id,
               bill_number AS number,
               COALESCE(total, 0)       AS total,
               COALESCE(amount_paid, 0) AS amount_paid,
               due_date,
               status
        FROM bills
        WHERE company_id = ?
      `).all(companyId) as Row[];

      const update = database.prepare(
        `UPDATE bills SET status = ?, updated_at = datetime('now') WHERE id = ?`
      );

      for (const row of rows) {
        const rawDerived = deriveStatus(
          { total: row.total, amount_paid: row.amount_paid, due_date: row.due_date ?? '', status: row.status },
          today
        );
        const derived = normalizeForBill(rawDerived);
        if (derived === row.status || !BILL_STATUSES.has(derived)) continue;

        try {
          update.run(derived, row.id);
        } catch (err: any) {
          result.errors.push(`Bill update ${row.id}: ${err?.message || err}`);
          continue;
        }
        result.billsFixed++;
        emitFix('bill', companyId, row, derived);
      }
    } catch (err: any) {
      result.errors.push(`Bill scan (company ${companyId}): ${err?.message || err}`);
    }
  }

  return result;
}

// Audit + EventBus side effects for a single corrected row.
// Best-effort: every step is independently try/caught.
function emitFix(
  entity: 'invoice' | 'bill',
  companyId: string,
  row: Row,
  derived: string
): void {
  const table = entity === 'invoice' ? 'invoices' : 'bills';

  try {
    db.logAudit(companyId, table, row.id, 'status_reconcile', {
      previous_status: row.status,
      new_status: derived,
      total: row.total,
      amount_paid: row.amount_paid,
      balance_due: balanceDue({ total: row.total, amount_paid: row.amount_paid }),
      due_date: row.due_date,
      cron: 'status-reconcile',
    });
  } catch { /* audit best-effort */ }

  // Re-use existing semantic events so downstream workflows fire.
  let eventType: 'invoice.paid' | 'invoice.overdue' | 'bill.paid' | 'bill.overdue' | null = null;
  if (entity === 'invoice') {
    if (derived === 'paid') eventType = 'invoice.paid';
    else if (derived === 'overdue') eventType = 'invoice.overdue';
  } else {
    if (derived === 'paid') eventType = 'bill.paid';
    else if (derived === 'overdue') eventType = 'bill.overdue';
  }
  if (!eventType) return;

  try {
    eventBus.emit({
      type: eventType,
      entityType: entity,
      entityId: row.id,
      companyId,
      data: {
        number: row.number,
        total: row.total,
        amount_paid: row.amount_paid,
        balance_due: balanceDue({ total: row.total, amount_paid: row.amount_paid }),
        due_date: row.due_date,
        previous_status: row.status,
        new_status: derived,
        source: 'status_reconcile_cron',
      },
    });
  } catch { /* event-bus best-effort */ }
}
