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
      case 'balloon': {
        // Balloon: the final (nth) payment pays off the entire remaining
        // balance, which must equal the stated balloon_amount. So the
        // (n-1) regular payments must amortize the principal down to the
        // balloon. That means amortizing the principal MINUS the balloon's
        // present value (discounted back over the n-1 regular periods) —
        // NOT principal − balloon undiscounted, which leaves far more than
        // the balloon owing at the end (e.g. $28k instead of $20k).
        const balloon = input.balloon_amount || 0;
        const regularN = n - 1; // nth payment is the balloon itself
        if (regularN <= 0) return 0;
        const factor = r === 0 ? 1 : Math.pow(1 + r, regularN);
        return periodicPayment(input.principal - balloon / factor, r, regularN);
      }
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
 * KEY FIX (partial payments): interest portion is CAPPED at the
 * payment amount. If accrued interest is $198 but the customer paid
 * $31, the recorded interest is $31, not $198 — and the unpaid
 * $167 becomes deferred interest carried forward. Before this fix,
 * the recorded interest_amount was always full periodic interest,
 * which inflated `total_interest_paid` by 6×+ for partial payments
 * and made the books lie.
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
): {
  principal: number;
  interest: number;
  escrow: number;
  new_balance: number;
  deferred_interest: number;
  accrued_interest: number;
} {
  const r = periodicRate(annual_rate, payment_frequency);
  const accruedInterest = round2(current_balance * r);
  // Pay interest FIRST, but cap at payment_amount (partial-payment fix).
  const interestPortion = round2(Math.min(payment_amount, accruedInterest));
  const afterInterest = Math.max(0, payment_amount - interestPortion);
  const escrowPortion = round2(Math.min(escrow_amount, afterInterest));
  let principalPortion = afterInterest - escrowPortion;
  // Cap principal at remaining balance.
  if (principalPortion > current_balance) principalPortion = current_balance;
  const newBalance = Math.max(0, current_balance - principalPortion);
  const deferredInterest = round2(Math.max(0, accruedInterest - interestPortion));

  return {
    principal: round2(principalPortion),
    interest: interestPortion,
    escrow: escrowPortion,
    new_balance: round2(newBalance),
    deferred_interest: deferredInterest,
    accrued_interest: accruedInterest,
  };
}

/**
 * Daily-accrual variant — more accurate for auto loans, mortgages,
 * and any loan where the customer pays early/late. Uses simple
 * interest accrued over `days_since_last_payment` days at the
 * loan's daily rate (annual_rate / 365). Honors deferred interest
 * from prior partials.
 *
 * Why this matters for your loan: the bank computes interest daily.
 * Paying on day 15 vs day 30 of the cycle yields different interest
 * portions. The fixed monthly-periodic split is an approximation;
 * this is the real-world split.
 */
export function splitPaymentDaily(
  current_balance: number,
  payment_amount: number,
  annual_rate: number,
  days_since_last: number,
  prior_deferred_interest: number = 0,
  escrow_amount: number = 0,
): {
  principal: number;
  interest: number;
  escrow: number;
  new_balance: number;
  deferred_interest: number;
  accrued_interest: number;
} {
  const dailyRate = annual_rate / 365;
  const periodInterest = current_balance * dailyRate * Math.max(0, days_since_last);
  const accruedInterest = round2(periodInterest + prior_deferred_interest);
  const interestPortion = round2(Math.min(payment_amount, accruedInterest));
  const afterInterest = Math.max(0, payment_amount - interestPortion);
  const escrowPortion = round2(Math.min(escrow_amount, afterInterest));
  let principalPortion = afterInterest - escrowPortion;
  if (principalPortion > current_balance) principalPortion = current_balance;
  const newBalance = Math.max(0, current_balance - principalPortion);
  const deferredInterest = round2(Math.max(0, accruedInterest - interestPortion));

  return {
    principal: round2(principalPortion),
    interest: interestPortion,
    escrow: escrowPortion,
    new_balance: round2(newBalance),
    deferred_interest: deferredInterest,
    accrued_interest: accruedInterest,
  };
}

/**
 * Replay every recorded payment for a loan, computing the correct
 * principal/interest split for each one in chronological order
 * using daily accrual. Returns updated totals + a per-payment
 * corrected ledger. Caller persists the corrections.
 *
 * Use this to FIX historical data after the partial-payment bug
 * inflated interest totals. Idempotent — running it twice produces
 * the same result.
 */
export function replayPayments(opts: {
  origination_date: string;
  origination_principal: number;
  annual_rate: number;
  payments: Array<{
    id: string;
    payment_date: string;
    amount: number;
    is_extra_principal?: number | boolean;
    escrow_amount?: number;
  }>;
}): {
  corrected: Array<{
    id: string;
    payment_date: string;
    amount: number;
    principal: number;
    interest: number;
    escrow: number;
    deferred_interest: number;
    balance_after: number;
  }>;
  totals: {
    total_paid_to_date: number;
    total_principal_paid: number;
    total_interest_paid: number;
    current_balance: number;
    deferred_interest_balance: number;
  };
} {
  // Sort by date (payments table may not preserve order).
  const sorted = [...opts.payments].sort((a, b) =>
    a.payment_date.localeCompare(b.payment_date)
  );
  let balance = opts.origination_principal;
  let deferred = 0;
  let lastDate = opts.origination_date;
  let totalPaid = 0, totalPrincipal = 0, totalInterest = 0;
  const corrected: any[] = [];

  for (const p of sorted) {
    const days = daysBetween(lastDate, p.payment_date);
    if (p.is_extra_principal) {
      // Extra principal: bypasses interest accrual, reduces balance directly.
      // But still accrue interest for the period and defer it.
      const periodInterest = balance * (opts.annual_rate / 365) * Math.max(0, days);
      deferred = round2(deferred + periodInterest);
      const principalApplied = Math.min(balance, p.amount);
      balance = Math.max(0, balance - principalApplied);
      corrected.push({
        id: p.id,
        payment_date: p.payment_date,
        amount: p.amount,
        principal: round2(principalApplied),
        interest: 0,
        escrow: 0,
        deferred_interest: deferred,
        balance_after: round2(balance),
      });
      totalPaid += p.amount;
      totalPrincipal += principalApplied;
    } else {
      const split = splitPaymentDaily(
        balance,
        p.amount,
        opts.annual_rate,
        days,
        deferred,
        p.escrow_amount || 0,
      );
      balance = split.new_balance;
      deferred = split.deferred_interest;
      corrected.push({
        id: p.id,
        payment_date: p.payment_date,
        amount: p.amount,
        principal: split.principal,
        interest: split.interest,
        escrow: split.escrow,
        deferred_interest: deferred,
        balance_after: balance,
      });
      totalPaid += p.amount;
      totalPrincipal += split.principal;
      totalInterest += split.interest;
    }
    lastDate = p.payment_date;
  }

  return {
    corrected,
    totals: {
      total_paid_to_date: round2(totalPaid),
      total_principal_paid: round2(totalPrincipal),
      total_interest_paid: round2(totalInterest),
      current_balance: round2(balance),
      deferred_interest_balance: round2(deferred),
    },
  };
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a + 'T12:00:00').getTime();
  const db = new Date(b + 'T12:00:00').getTime();
  return Math.max(0, Math.round((db - da) / 86400000));
}

/**
 * Newton-Raphson solver: given principal, term, and observed monthly
 * payment, back-solve the effective APR. Useful when the bank's
 * actual payment differs from naive amortization (typically because
 * fees were rolled into financing — the "amount financed" exceeds
 * the loan principal the borrower entered).
 *
 * Converges in 4-7 iterations for typical loans.
 */
export function solveRateFromPayment(
  principal: number,
  payment: number,
  n: number,
  guess: number = 0.06,
): number {
  if (principal <= 0 || n <= 0 || payment <= 0) return 0;
  // If payment * n barely exceeds principal, rate is ~0.
  if (payment * n <= principal * 1.0001) return 0;
  let r = guess / 12;  // monthly
  for (let i = 0; i < 50; i++) {
    const f = Math.pow(1 + r, n);
    // f(r) = P · r·f / (f-1) - payment = 0
    const fr = (principal * r * f) / (f - 1) - payment;
    // f'(r) via numerical derivative (cheap & robust vs symbolic)
    const dr = r * 1e-5 || 1e-7;
    const f2 = Math.pow(1 + (r + dr), n);
    const frPlus = (principal * (r + dr) * f2) / (f2 - 1) - payment;
    const slope = (frPlus - fr) / dr;
    if (!isFinite(slope) || Math.abs(slope) < 1e-12) break;
    const next = r - fr / slope;
    if (next <= 0) { r = r / 2; continue; }    // bounce back into positive
    if (Math.abs(next - r) < 1e-10) { r = next; break; }
    r = next;
  }
  return r * 12;  // return annual rate
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
