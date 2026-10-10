import { describe, it, expect } from 'vitest';
import { generateSchedule, splitPayment, periodicPayment, periodicRate, paymentsForTerm } from './loan-calculator';

const approx = (a: number, b: number, eps = 0.02) => Math.abs(a - b) <= eps;

describe('loan-calculator', () => {
  // ── Balloon: regular payments amortize down to exactly the balloon ──
  it('balloon loan leaves exactly the stated balloon before the final payment', () => {
    const rows = generateSchedule({
      principal: 100000,
      annual_rate: 0.06,
      term_months: 60,
      first_payment_date: '2025-01-01',
      payment_frequency: 'monthly',
      amortization_type: 'balloon',
      balloon_amount: 20000,
    });
    expect(rows.length).toBe(60);
    // Balance after the 59th (last regular) payment must equal the balloon.
    expect(approx(rows[58].remaining_balance, 20000), `expected ~20000 before balloon, got ${rows[58].remaining_balance}`).toBeTruthy();
    // The final payment clears the balloon; balance ends at 0.
    expect(approx(rows[59].remaining_balance, 0), `expected final balance 0, got ${rows[59].remaining_balance}`).toBeTruthy();
    // The final payment principal IS the balloon.
    expect(approx(rows[59].principal_amount, 20000), `expected final principal 20000, got ${rows[59].principal_amount}`).toBeTruthy();
  });

  it('zero-rate balloon loan also preserves the balloon', () => {
    const rows = generateSchedule({
      principal: 120000,
      annual_rate: 0,
      term_months: 60,
      first_payment_date: '2025-01-01',
      payment_frequency: 'monthly',
      amortization_type: 'balloon',
      balloon_amount: 30000,
    });
    expect(approx(rows[58].remaining_balance, 30000), `expected ~30000 before balloon, got ${rows[58].remaining_balance}`).toBeTruthy();
    expect(approx(rows[59].remaining_balance, 0)).toBeTruthy();
  });

  // ── Standard amortization fully pays off ──
  it('standard loan amortizes to zero', () => {
    const rows = generateSchedule({
      principal: 50000,
      annual_rate: 0.05,
      term_months: 36,
      first_payment_date: '2025-01-01',
      payment_frequency: 'monthly',
      amortization_type: 'standard',
    });
    expect(rows.length).toBe(36);
    expect(approx(rows[35].remaining_balance, 0), `expected final balance 0, got ${rows[35].remaining_balance}`).toBeTruthy();
  });

  // ── Interest-only: principal untouched until the final payment ──
  it('interest-only loan defers all principal to the final payment', () => {
    const rows = generateSchedule({
      principal: 80000,
      annual_rate: 0.06,
      term_months: 24,
      first_payment_date: '2025-01-01',
      payment_frequency: 'monthly',
      amortization_type: 'interest_only',
    });
    expect(approx(rows[0].principal_amount, 0), 'first payment should be interest-only').toBeTruthy();
    expect(approx(rows[22].remaining_balance, 80000), 'balance unchanged until final').toBeTruthy();
    expect(approx(rows[23].remaining_balance, 0), 'final payment clears principal').toBeTruthy();
  });

  // ── Partial-payment split caps interest at the amount paid ──
  it('splitPayment caps interest at the payment amount on a partial payment', () => {
    // Accrued interest on 100000 at 6%/12 = $500; pay only $31.
    const s = splitPayment(100000, 31, 0.06, 'monthly', 0);
    expect(approx(s.interest, 31), `interest should be capped at 31, got ${s.interest}`).toBeTruthy();
    expect(approx(s.principal, 0), `no principal on a sub-interest payment, got ${s.principal}`).toBeTruthy();
    expect(approx(s.deferred_interest, 469), `expected 469 deferred, got ${s.deferred_interest}`).toBeTruthy();
  });

  // ── Stored payment_amount honors the loan's payment frequency ──
  it('biweekly stored payment matches the schedule, not a monthly figure', () => {
    const principal = 26000, annual = 0.065, term = 60, freq = 'biweekly';
    // What loans:save now stores (frequency-aware):
    const stored = periodicPayment(principal, periodicRate(annual, freq), paymentsForTerm(term, freq));
    // What the amortization schedule actually bills each biweekly period:
    const rows = generateSchedule({
      principal, annual_rate: annual, term_months: term,
      first_payment_date: '2025-01-01', payment_frequency: freq,
      amortization_type: 'standard',
    });
    expect(approx(stored, rows[0].scheduled_payment), `stored ${stored} should match biweekly schedule payment ${rows[0].scheduled_payment}`).toBeTruthy();
    // …and must NOT be the (wrong) monthly figure the old code stored.
    const monthlyFigure = periodicPayment(principal, annual / 12, term);
    expect(Math.abs(stored - monthlyFigure) > 1, `biweekly payment ${stored} should differ from monthly ${monthlyFigure}`).toBeTruthy();
  });
});
