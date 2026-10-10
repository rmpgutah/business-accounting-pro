import { describe, it, expect } from 'vitest';
import { roundCents, computeInvoicePaidStatus, applyDebtPaymentDelta } from './payment-math';

const approx = (a: number, b: number, eps = 0.001) => Math.abs(a - b) <= eps;

describe('payment-math', () => {
  // ── roundCents kills float drift ──
  it('roundCents removes binary-float residue', () => {
    expect(roundCents(100 + 0.1 + 0.2)).toBe(100.3);
    expect(roundCents(0.1 + 0.2)).toBe(0.3);
  });

  // ── Invoice: editing a payment down recomputes paid + status ──
  it('invoice edit $500→$300 leaves partial with correct amount_paid', () => {
    // Invoice total 1000, previously had one $500 payment (status partial).
    // User edits it to $300 → remaining payments are [300].
    const r = computeInvoicePaidStatus(1000, [300], '2025-01-01', new Date('2025-06-01'));
    expect(approx(r.amountPaid, 300), `expected 300, got ${r.amountPaid}`).toBeTruthy();
    expect(r.status).toBe('partial');
  });

  it('invoice fully covered by payments → paid', () => {
    const r = computeInvoicePaidStatus(1000, [600, 400]);
    expect(approx(r.amountPaid, 1000)).toBeTruthy();
    expect(r.status).toBe('paid');
  });

  it('invoice deleting the only payment → overdue when past due', () => {
    const r = computeInvoicePaidStatus(1000, [], '2025-01-01', new Date('2025-06-01'));
    expect(approx(r.amountPaid, 0)).toBeTruthy();
    expect(r.status).toBe('overdue');
  });

  it('invoice deleting the only payment → sent when not yet due', () => {
    const r = computeInvoicePaidStatus(1000, [], '2099-01-01', new Date('2025-06-01'));
    expect(r.status).toBe('sent');
  });

  it('invoice partial-payment float drift stays exact', () => {
    const r = computeInvoicePaidStatus(100.3, [100, 0.1, 0.2]);
    expect(approx(r.amountPaid, 100.3), `expected 100.30, got ${r.amountPaid}`).toBeTruthy();
    expect(r.status).toBe('paid');
  });

  // ── Debt: delta application preserves accrued interest/fees ──
  it('debt new payment decrements balance, increments payments_made', () => {
    // original 1000 + interest 50 already folded into balance_due 1050, no payments yet.
    const r = applyDebtPaymentDelta({ balance_due: 1050, payments_made: 0, status: 'active' }, +200);
    expect(approx(r.balance_due, 850), `expected 850, got ${r.balance_due}`).toBeTruthy();
    expect(approx(r.payments_made, 200)).toBeTruthy();
    expect(r.status).toBe('active');
  });

  it('debt deleting a payment restores balance and un-settles', () => {
    // Was settled by a final $850 payment; deleting it (delta -850) must reopen.
    const r = applyDebtPaymentDelta({ balance_due: 0, payments_made: 1050, status: 'settled' }, -850);
    expect(approx(r.balance_due, 850), `expected 850, got ${r.balance_due}`).toBeTruthy();
    expect(approx(r.payments_made, 200)).toBeTruthy();
    expect(r.status).toBe('active');
  });

  it('debt editing a payment up to clear the balance auto-settles', () => {
    // balance 850, payments 200; edit that $200 up to $1050 → delta +850 clears it.
    const r = applyDebtPaymentDelta({ balance_due: 850, payments_made: 200, status: 'active' }, +850);
    expect(approx(r.balance_due, 0), `expected 0, got ${r.balance_due}`).toBeTruthy();
    expect(approx(r.payments_made, 1050)).toBeTruthy();
    expect(r.status).toBe('settled');
  });

  it('debt delta never disturbs a written_off / bankruptcy debt status', () => {
    const w = applyDebtPaymentDelta({ balance_due: 0, payments_made: 500, status: 'written_off' }, -500);
    expect(w.status).toBe('written_off');
    const b = applyDebtPaymentDelta({ balance_due: 0, payments_made: 500, status: 'bankruptcy' }, -500);
    expect(b.status).toBe('bankruptcy');
  });

  it('debt interest stays preserved across a payment delete', () => {
    // balance 1050 reflects 1000 principal + 50 interest, with a 200 payment made (balance 850).
    // Deleting that 200 payment must return balance to 1050 (interest intact), not 1000.
    const r = applyDebtPaymentDelta({ balance_due: 850, payments_made: 200, status: 'active' }, -200);
    expect(approx(r.balance_due, 1050), `interest lost: expected 1050, got ${r.balance_due}`).toBeTruthy();
    expect(approx(r.payments_made, 0)).toBeTruthy();
  });
});
