// src/shared/invoice-status.ts
//
// AREA 1 — Invoice / Bill status derivation (shared, pure helpers)
//
// The denormalized `status` column on invoices and bills routinely
// drifts from the real balance: a fully-paid invoice can still read
// 'overdue' (stamped by the overdue cron, never cleared when the
// final payment landed), or an 'overdue' invoice that received a
// partial payment may never get downgraded to 'partial'. This module
// is the SINGLE SOURCE OF TRUTH for "what status SHOULD this row be,
// given its numbers and due date".
//
// Design constraints:
//
//  • PURE + DETERMINISTIC — no `db` import, no Node deps, no clock
//    reads. Safe to import from BOTH the renderer and the main
//    process. The caller supplies `todayISO` (YYYY-MM-DD) so the
//    result is fully reproducible and testable.
//
//  • Money comparisons use a 0.005 epsilon (matches the rest of the
//    codebase: a balance is settled when (total - amount_paid) <=
//    0.005, i.e. within half a cent).
//
//  • NEVER auto-changes 'draft' / 'void' / 'cancelled'. Those are
//    human-intent states with no balance semantics; the reconcile
//    cron must leave them untouched.

const MONEY_EPSILON = 0.005;

// Status strings that represent explicit human intent and must never
// be auto-derived/auto-changed regardless of the numbers.
// (invoices use 'cancelled'; bills use 'void' — both are honored here.)
const FROZEN_STATUSES = new Set(['draft', 'void', 'cancelled']);

export interface InvoiceLike {
  total?: number;
  amount_paid?: number;
  due_date?: string;
  status?: string;
}

/**
 * Outstanding balance = total - amount_paid, clamped to a number.
 * May be negative if overpaid; callers that only care about "owed"
 * should use `isSettled`.
 */
export function balanceDue(inv: { total?: number; amount_paid?: number }): number {
  const total = Number(inv.total ?? 0) || 0;
  const paid = Number(inv.amount_paid ?? 0) || 0;
  return total - paid;
}

/**
 * True when the balance is paid off within half a cent (epsilon).
 * Also true for overpaid rows (negative balance).
 */
export function isSettled(inv: { total?: number; amount_paid?: number }): boolean {
  return balanceDue(inv) <= MONEY_EPSILON;
}

/**
 * The CORRECT status for a row given its numbers + due date.
 *
 *   - 'draft' / 'void' / 'cancelled' are returned unchanged (frozen).
 *   - 'paid'    when settled (balance <= epsilon).
 *   - 'partial' when 0 < amount_paid < total (some money in, owed).
 *   - 'overdue' when owed AND due_date is set and strictly before today.
 *   - 'sent'    otherwise (owed, not yet past due).
 *
 * @param todayISO local "today" as YYYY-MM-DD, supplied by the caller.
 */
export function deriveStatus(inv: InvoiceLike, todayISO: string): string {
  // Honor frozen human-intent states first.
  if (inv.status && FROZEN_STATUSES.has(inv.status)) {
    return inv.status;
  }

  // Settled wins over everything else (clears a stale 'overdue').
  if (isSettled(inv)) {
    return 'paid';
  }

  const total = Number(inv.total ?? 0) || 0;
  const paid = Number(inv.amount_paid ?? 0) || 0;

  // Past-due check: only when a due_date exists and is strictly
  // earlier than today. String comparison is valid for the fixed
  // YYYY-MM-DD format both columns use.
  const dueDate = (inv.due_date ?? '').trim();
  const isPastDue = dueDate !== '' && dueDate < todayISO;

  if (isPastDue) {
    return 'overdue';
  }

  // Owed, not past due: distinguish partial from freshly-sent.
  if (paid > MONEY_EPSILON && paid < total - MONEY_EPSILON) {
    return 'partial';
  }

  return 'sent';
}
