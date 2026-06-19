// Pure payment-recompute math, shared by the main and renderer processes.
//
// WHY THIS EXISTS: the "how much has been paid + what status is it" invariant
// for invoices and debts was being recomputed independently in every mutation
// path (create / edit / delete), and the paths drifted — edits skipped the
// recompute entirely, deletes recomputed client-side, creates recomputed
// server-side. Centralising the invariant in one pure, unit-tested place
// (scripts/test-payment-math.cjs) keeps every path in agreement.
//
// Keep this file dependency-free (no electron, no DB, no node APIs) so it can
// be imported from the renderer (Vite) and the main process (tsc) alike, and
// exercised by the plain-node regression script.

/** Round to whole cents, killing binary-float drift (100 + 0.1 + 0.2 → 100.3). */
export function roundCents(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export type InvoicePaidStatus = 'paid' | 'partial' | 'overdue' | 'sent';

/**
 * Recompute an invoice's amount_paid + status from the FULL set of its payment
 * amounts. Use after any payment is created, edited, or deleted so the invoice
 * header never disagrees with its payment rows.
 *
 * Status precedence matches the long-standing delete path in InvoiceDetail:
 *   fully paid → 'paid'; some paid → 'partial'; nothing paid & past due →
 *   'overdue'; otherwise 'sent'.
 */
export function computeInvoicePaidStatus(
  total: number,
  paymentAmounts: number[],
  dueDate?: string | null,
  asOf: Date = new Date(),
): { amountPaid: number; status: InvoicePaidStatus } {
  const amountPaid = roundCents(
    (paymentAmounts || []).reduce((s, a) => s + (Number(a) || 0), 0),
  );
  const t = roundCents(total);
  let status: InvoicePaidStatus;
  if (amountPaid >= t) status = 'paid';
  else if (amountPaid > 0) status = 'partial';
  else if (dueDate && asOf > new Date(dueDate)) status = 'overdue';
  else status = 'sent';
  return { amountPaid, status };
}

// Debt statuses that must NOT be auto-flipped by a payment change.
const DEBT_TERMINAL_STATUSES = ['written_off', 'bankruptcy'];

/**
 * Apply a payment-amount DELTA to a debt's running totals.
 *
 * Delta convention: delta = (new amount − old amount).
 *   - new payment      → delta = +amount
 *   - delete a payment → delta = −amount
 *   - edit O→N         → delta = N − O
 *
 * We adjust by the delta rather than recomputing from original_amount so that
 * accrued interest/fees already folded into balance_due are preserved (the
 * debt's balance_due is original + interest_accrued + fees_accrued − payments,
 * and interest accrues over time independently of payments). Auto-settles when
 * the balance reaches zero and un-settles if a reduction reopens a balance —
 * but never disturbs terminal states (written_off / bankruptcy).
 */
export function applyDebtPaymentDelta(
  debt: { balance_due: number; payments_made: number; status: string },
  delta: number,
): { balance_due: number; payments_made: number; status: string } {
  const payments_made = roundCents((Number(debt.payments_made) || 0) + delta);
  const balance_due = roundCents((Number(debt.balance_due) || 0) - delta);
  let status = debt.status;
  if (!DEBT_TERMINAL_STATUSES.includes(status)) {
    if (balance_due <= 0) status = 'settled';
    else if (status === 'settled') status = 'active';
  }
  return { balance_due, payments_made, status };
}
