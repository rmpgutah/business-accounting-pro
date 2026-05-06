// src/main/services/loan-calculator.ts
//
// Loan amortization mathematics + payoff scenarios.
//
// Standard amortization formula:
//   M = P · r(1+r)^n / ((1+r)^n − 1)
//
// where:
//   M = monthly payment
//   P = principal
//   r = periodic interest rate (annual / payments_per_year)
//   n = total number of payments
//
// Each payment splits into interest (= remaining_balance · r) and
// principal (= M − interest), then balance reduces by the principal
// portion. As the balance falls, interest portion shrinks and
// principal portion grows — the famous "front-loaded interest" curve.
//
// Special cases:
//   • interest_only: every payment is just (balance · r); balloon
//     at end pays off principal
//   • balloon: amortize over a longer notional term but require a
//     final lump sum on actual term end
//   • zero rate: M = P / n (no interest split, all principal)

export type PaymentFrequency = 'monthly' | 'biweekly' | 'weekly' | 'quarterly' | 'annual';
export type AmortizationType = 'standard' | 'interest_only' | 'balloon' | 'custom';

export interface AmortizationRow {
  payment_number: number;
  due_date: string;       // YYYY-MM-DD
  scheduled_payment: number;
  principal_amount: number;
  interest_amount: number;
  escrow_amount: number;
  remaining_balance: number;
}

export interface AmortizationInput {
  principal: number;
  annual_rate: number;          // 0.065 for 6.5%
  term_months: number;
  first_payment_date: string;   // YYYY-MM-DD
  payment_frequency: PaymentFrequency;
  amortization_type: AmortizationType;
  balloon_amount?: number;      // for balloon loans
  escrow_per_payment?: number;  // added to each scheduled_payment
}

// ── Frequency helpers ────────────────────────────────────────

const PAYMENTS_PER_YEAR: Record<PaymentFrequency, number> = {
  monthly: 12,
  biweekly: 26,
  weekly: 52,
  quarterly: 4,
  annual: 1,
};

function paymentsForTerm(termMonths: number, freq: PaymentFrequency): number {
  // For non-monthly frequencies, scale appropriately. A 360-month
  // (30-yr) loan paid biweekly = 360 * 26/12 = 780 payments.
  return Math.round(termMonths * (PAYMENTS_PER_YEAR[freq] / 12));
}

function periodicRate(annualRate: number, freq: PaymentFrequency): number {
  return annualRate / PAYMENTS_PER_YEAR[freq];
}

// Date helpers — anchor at noon LOCAL to dodge DST/timezone shifts.
function pad(n: number): string { return n < 10 ? '0' + n : String(n); }
function toISO(d: Date): string {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function parseISO(s: string): Date {
  return new Date(s + 'T12:00:00');
}
function addPeriod(d: Date, freq: PaymentFrequency, n: number = 1): Date {
  const next = new Date(d);
  switch (freq) {
    case 'monthly':   next.setMonth(next.getMonth() + n); break;
    case 'biweekly':  next.setDate(next.getDate() + 14 * n); break;
    case 'weekly':    next.setDate(next.getDate() + 7 * n); break;
    case 'quarterly': next.setMonth(next.getMonth() + 3 * n); break;
    case 'annual':    next.setFullYear(next.getFullYear() + n); break;
  }
  return next;
}

// ── Core math ────────────────────────────────────────────────

/**
 * Compute the level periodic payment for a standard amortization.
 * Returns the payment that fully amortizes principal over n payments
 * at periodic rate r.
 */
export function periodicPayment(principal: number, periodic_r: number, n: number): number {
  if (n <= 0) return 0;
  if (periodic_r === 0) return principal / n;        // zero-rate special case
  const factor = Math.pow(1 + periodic_r, n);
  return principal * (periodic_r * factor) / (factor - 1);
}

/**
 * Generate the full amortization schedule. Returns one row per
 * scheduled payment.
 */
export function generateSchedule(input: AmortizationInput): AmortizationRow[] {
  const r = periodicRate(input.annual_rate, input.payment_frequency);
  const n = paymentsForTerm(input.term_months, input.payment_frequency);
  const escrow = input.escrow_per_payment || 0;
  const rows: AmortizationRow[] = [];

  let balance = input.principal;
  let dueDate = parseISO(input.first_payment_date);

  // Compute level payment based on amortization type.
  const fullPayment = (() => {
    switch (input.amortization_type) {
      case 'interest_only':
        return input.principal * r;        // every payment is just interest
      case 'balloon':
        // Balloon: amortize as if standard but for `term_months`,
        // then a balloon principal payment at the end.
        return periodicPayment(input.principal - (input.balloon_amount || 0), r, n);
      case 'custom':
      case 'standard':
      default:
        return periodicPayment(input.principal, r, n);
    }
  })();

  for (let i = 1; i <= n; i++) {
    let interestAmt: number;
    let principalAmt: number;
    let scheduled: number;

    if (input.amortization_type === 'interest_only' && i < n) {
      interestAmt = balance * r;
      principalAmt = 0;
      scheduled = interestAmt;
    } else if (input.amortization_type === 'interest_only' && i === n) {
      // Last payment of interest-only: pay full balance + last interest
      interestAmt = balance * r;
      principalAmt = balance;
      scheduled = interestAmt + principalAmt;
    } else if (input.amortization_type === 'balloon' && i === n) {
      // Last payment includes the balloon
      interestAmt = balance * r;
      principalAmt = balance;            // all remaining balance
      scheduled = interestAmt + principalAmt;
    } else {
      interestAmt = balance * r;
      principalAmt = fullPayment - interestAmt;
      // Last payment cleanup — fix tiny floating-point residual so
      // remaining balance is exactly $0.00.
      if (i === n) {
        principalAmt = balance;
        scheduled = interestAmt + principalAmt;
      } else {
        scheduled = fullPayment;
      }
    }

    balance = Math.max(0, balance - principalAmt);

    rows.push({
      payment_number: i,
      due_date: toISO(dueDate),
      scheduled_payment: round2(scheduled),
      principal_amount: round2(principalAmt),
      interest_amount: round2(interestAmt),
      escrow_amount: round2(escrow),
      remaining_balance: round2(balance),
    });

    dueDate = addPeriod(dueDate, input.payment_frequency);
  }

  return rows;
}

// ── Payoff scenarios ─────────────────────────────────────────

export interface PayoffScenarioResult {
  // What happens with the existing schedule
  baseline_total_interest: number;
  baseline_payoff_date: string;
  // What happens with the extra payment applied
  scenario_total_interest: number;
  scenario_payoff_date: string;
  // Savings
  interest_saved: number;
  months_saved: number;
}

/**
 * Compute the impact of applying an extra payment per period to
 * principal — the classic "what if I pay an extra $200/month" calc.
 *
 * Recomputes a hypothetical schedule with `extra_per_payment` added
 * to principal each period, then compares total interest vs baseline.
 */
export function payoffScenario(
  input: AmortizationInput,
  extra_per_payment: number,
): PayoffScenarioResult {
  const baseline = generateSchedule(input);
  const baselineTotal = baseline.reduce((s, r) => s + r.interest_amount, 0);

  // Walk a hypothetical schedule with extra principal each period.
  const r = periodicRate(input.annual_rate, input.payment_frequency);
  const fullPayment = periodicPayment(input.principal, r, paymentsForTerm(input.term_months, input.payment_frequency));
  let balance = input.principal;
  let dueDate = parseISO(input.first_payment_date);
  let totalInterest = 0;
  let count = 0;

  while (balance > 0.005 && count < 5000) {
    const interest = balance * r;
    let principal = fullPayment - interest + extra_per_payment;
    if (principal > balance) principal = balance;
    balance -= principal;
    totalInterest += interest;
    count++;
    if (count > 1) dueDate = addPeriod(dueDate, input.payment_frequency);
  }

  const baselinePayoff = baseline[baseline.length - 1]?.due_date || '';
  const scenarioPayoff = toISO(dueDate);

  // months_saved: difference between baseline and scenario count
  const monthsSaved = paymentsForTerm(input.term_months, input.payment_frequency) - count;

  return {
    baseline_total_interest: round2(baselineTotal),
    baseline_payoff_date: baselinePayoff,
    scenario_total_interest: round2(totalInterest),
    scenario_payoff_date: scenarioPayoff,
    interest_saved: round2(baselineTotal - totalInterest),
    months_saved: monthsSaved,
  };
}

/**
 * Apply an actual payment to the loan balance — splits the payment
 * into principal + interest based on the current balance and
 * scheduled rate. Used when recording free-form payments.
 *
 * Returns the split — caller stores both the payment and updates
 * the loan's running totals.
 */
export function splitPayment(
  current_balance: number,
  payment_amount: number,
  annual_rate: number,
  payment_frequency: PaymentFrequency,
  escrow_amount: number = 0,
): { principal: number; interest: number; escrow: number; new_balance: number } {
  const r = periodicRate(annual_rate, payment_frequency);
  const interestPortion = round2(current_balance * r);
  // Pay interest first, then escrow, then principal absorbs the rest.
  const afterInterest = Math.max(0, payment_amount - interestPortion);
  const escrowPortion = Math.min(escrow_amount, afterInterest);
  let principalPortion = afterInterest - escrowPortion;
  // Cap principal at remaining balance.
  if (principalPortion > current_balance) principalPortion = current_balance;
  const newBalance = Math.max(0, current_balance - principalPortion);

  return {
    principal: round2(principalPortion),
    interest: interestPortion,
    escrow: round2(escrowPortion),
    new_balance: round2(newBalance),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
