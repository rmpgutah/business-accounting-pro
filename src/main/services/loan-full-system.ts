// ─── Loan Full-System Wave: F993-F1052 (60 features) ───
//
// Batch LG: Type-specific calculations  (F993-F1002)
// Batch LH: Advanced financial math      (F1003-F1012)
// Batch LI: Applications & origination   (F1013-F1022)
// Batch LJ: Risk & compliance            (F1023-F1032)
// Batch LK: Specialized loan products    (F1033-F1042)
// Batch LL: Portfolio analytics          (F1043-F1052)
//
// Design notes:
// 1. Math functions (NPV, IRR, APR, CECL) are PURE — no DB reads. Lets
//    them be unit-tested with literal inputs and re-used from any module.
// 2. Specialized products (HELOC, construction, lease) extend the
//    existing `loans` table via per-type sidecar tables. The loan's
//    `loan_type` column is the discriminator; a HELOC has rows in both
//    `loans` AND `loan_heloc_draws`.
// 3. IDR / PSLF for student loans tracks the *counter* separately from
//    the payment stream — some payments qualify and some don't.

import { randomUUID as uuid } from 'crypto';
import * as db from '../database';

const now = (): string => new Date().toISOString();
const today = (): string => now().slice(0, 10);
const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ════════════════════════════════════════════════════════════════════
// Batch LG: Type-specific calculations (F993-F1002)
// ════════════════════════════════════════════════════════════════════

// F993: Income-Driven Repayment (IDR) calculator for student loans
// Plans differ in % of discretionary income and poverty multiplier:
//   PAYE:    10% of (AGI - 150% of poverty line), 20-year forgiveness
//   REPAYE:  10% of discretionary, 20yr undergrad / 25yr grad
//   IBR:     10% (new) or 15% (old) of disc., 20/25yr forgiveness
//   ICR:     20% of discretionary OR 12-yr fixed (whichever lower)
export function calculateIdrPayment(opts: {
  plan: 'PAYE' | 'REPAYE' | 'IBR_new' | 'IBR_old' | 'ICR';
  agi: number;
  family_size: number;
  state?: string;  // Alaska & Hawaii have higher poverty lines
}) {
  try {
    // 2024 federal poverty guidelines (48 contiguous states)
    const POVERTY_BASE = 15060;       // 1-person household
    const POVERTY_INCREMENT = 5380;   // per additional person
    const ALASKA_BASE = 18810;
    const ALASKA_INCR = 6730;
    const HAWAII_BASE = 17310;
    const HAWAII_INCR = 6190;
    const state = (opts.state || '').toUpperCase();
    let povertyLine: number;
    if (state === 'AK') povertyLine = ALASKA_BASE + ALASKA_INCR * Math.max(0, opts.family_size - 1);
    else if (state === 'HI') povertyLine = HAWAII_BASE + HAWAII_INCR * Math.max(0, opts.family_size - 1);
    else povertyLine = POVERTY_BASE + POVERTY_INCREMENT * Math.max(0, opts.family_size - 1);
    const povertyMultiplier = 1.5;  // most plans use 150% of poverty
    const protectedIncome = povertyLine * povertyMultiplier;
    const discretionary = Math.max(0, opts.agi - protectedIncome);
    let paymentPct: number;
    let forgivenessYears: number;
    switch (opts.plan) {
      case 'PAYE':    paymentPct = 0.10; forgivenessYears = 20; break;
      case 'REPAYE':  paymentPct = 0.10; forgivenessYears = 20; break;
      case 'IBR_new': paymentPct = 0.10; forgivenessYears = 20; break;
      case 'IBR_old': paymentPct = 0.15; forgivenessYears = 25; break;
      case 'ICR':     paymentPct = 0.20; forgivenessYears = 25; break;
    }
    const annualPayment = round2(discretionary * paymentPct);
    const monthlyPayment = round2(annualPayment / 12);
    return {
      plan: opts.plan,
      poverty_line: round2(povertyLine),
      protected_income: round2(protectedIncome),
      discretionary_income: round2(discretionary),
      payment_pct: paymentPct,
      annual_payment: annualPayment,
      monthly_payment: monthlyPayment,
      forgiveness_years: forgivenessYears,
      forgiveness_months: forgivenessYears * 12,
    };
  } catch (e: any) { return { error: e.message }; }
}

// F994: PSLF qualifying payment tracker (120 payments required)
export function trackPslfPayment(opts: { loan_id: string; payment_date: string; qualifies: boolean; reason?: string }) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const progress = dbi.prepare('SELECT * FROM loan_pslf_progress WHERE loan_id = ? AND company_id = ?').get(opts.loan_id, cid) as any;
    const currentCount = progress?.qualifying_payments_count || 0;
    const newCount = opts.qualifies ? currentCount + 1 : currentCount;
    const remaining = Math.max(0, 120 - newCount);
    if (progress) {
      dbi.prepare(`UPDATE loan_pslf_progress SET qualifying_payments_count = ?, payments_remaining = ?, updated_at = ? WHERE id = ?`)
        .run(newCount, remaining, now(), progress.id);
    } else {
      dbi.prepare(`INSERT INTO loan_pslf_progress (id, company_id, loan_id, qualifying_payments_count, payments_remaining) VALUES (?, ?, ?, ?, ?)`)
        .run(uuid(), cid, opts.loan_id, newCount, remaining);
    }
    return { qualifying_count: newCount, remaining, percent_complete: round2((newCount / 120) * 100), forgiveness_eligible: newCount >= 120, last_payment_qualified: opts.qualifies };
  } catch (e: any) { return { error: e.message }; }
}

// F995: HELOC draw/repayment phase calculator
// HELOCs have two phases: DRAW (interest-only, can borrow up to limit)
// and REPAYMENT (no more draws, amortize remaining balance over N years).
export function helocPhaseCalculator(opts: {
  credit_limit: number;
  current_balance: number;
  rate_pct: number;
  draw_period_remaining_months: number;
  repayment_period_months: number;  // typically 10-20 years
}) {
  try {
    const monthlyRate = (opts.rate_pct / 100) / 12;
    // Draw phase: interest-only payment
    const drawPhasePayment = round2(opts.current_balance * monthlyRate);
    const drawPhaseTotalInterest = round2(drawPhasePayment * opts.draw_period_remaining_months);
    // Repayment phase: amortize current balance + any future draws over repayment_period
    // For projection, assume max balance (credit_limit) at end of draw phase
    const projectedBalanceAtRepayment = opts.credit_limit;
    const repayPmt = monthlyRate === 0
      ? round2(projectedBalanceAtRepayment / opts.repayment_period_months)
      : round2(projectedBalanceAtRepayment * monthlyRate * Math.pow(1 + monthlyRate, opts.repayment_period_months) / (Math.pow(1 + monthlyRate, opts.repayment_period_months) - 1));
    const paymentShock = round2(repayPmt - drawPhasePayment);
    return {
      draw_phase: {
        current_monthly: drawPhasePayment,
        total_interest_remaining: drawPhaseTotalInterest,
        months_remaining: opts.draw_period_remaining_months,
        available_credit: round2(opts.credit_limit - opts.current_balance),
      },
      repayment_phase: {
        projected_balance: round2(projectedBalanceAtRepayment),
        monthly_payment: repayPmt,
        term_months: opts.repayment_period_months,
        total_interest: round2(repayPmt * opts.repayment_period_months - projectedBalanceAtRepayment),
      },
      payment_shock_warning: paymentShock,
      shock_multiplier: drawPhasePayment > 0 ? round2(repayPmt / drawPhasePayment) : null,
    };
  } catch (e: any) { return { error: e.message }; }
}

// F996: Construction loan draw schedule with interest reserve
// Interest accrues on drawn-down portion only; reserve covers it during build.
export function constructionLoanProjection(opts: {
  total_loan_amount: number;
  rate_pct: number;
  construction_months: number;
  draw_schedule: Array<{ month: number; amount: number; description?: string }>;
  interest_reserve_pct?: number;  // % of loan budgeted for interest during build
}) {
  try {
    const monthlyRate = (opts.rate_pct / 100) / 12;
    let outstandingBalance = 0;
    const projection: any[] = [];
    let totalInterestAccrued = 0;
    for (let m = 1; m <= opts.construction_months; m++) {
      const monthDraws = opts.draw_schedule.filter(d => d.month === m).reduce((s, d) => s + d.amount, 0);
      outstandingBalance += monthDraws;
      const interestThisMonth = round2(outstandingBalance * monthlyRate);
      totalInterestAccrued += interestThisMonth;
      projection.push({
        month: m,
        drawn_this_month: round2(monthDraws),
        cumulative_drawn: round2(outstandingBalance),
        interest_accrued: interestThisMonth,
        cumulative_interest: round2(totalInterestAccrued),
      });
    }
    const totalDrawn = round2(opts.draw_schedule.reduce((s, d) => s + d.amount, 0));
    const undrawn = round2(opts.total_loan_amount - totalDrawn);
    const requiredReserve = round2(totalInterestAccrued);
    const reserveProvided = round2(opts.total_loan_amount * ((opts.interest_reserve_pct || 5) / 100));
    return {
      projection,
      total_drawn: totalDrawn,
      undrawn_capacity: undrawn,
      total_interest_during_build: round2(totalInterestAccrued),
      required_interest_reserve: requiredReserve,
      reserve_provided: reserveProvided,
      reserve_shortfall: Math.max(0, requiredReserve - reserveProvided),
    };
  } catch (e: any) { return { error: e.message }; }
}

// F997: Reverse mortgage (HECM) payment options calculator
// Borrower receives money from the lender (the reverse). Options:
//   tenure:    fixed monthly while you live in the home
//   term:      fixed monthly for N years
//   loc:       line of credit you draw from
//   modified:  hybrid
export function reverseMortgageOptions(opts: {
  home_value: number;
  borrower_age: number;
  expected_rate_pct: number;
  payout_option: 'tenure' | 'term' | 'loc' | 'modified';
  term_months?: number;
  upfront_mip_pct?: number;
  ongoing_mip_pct?: number;
}) {
  try {
    // Principal Limit Factor (PLF) — rough approximation, real HUD tables
    // are age + rate based. PLF roughly = 0.50 at age 62, 0.60 at age 75,
    // 0.70 at age 85+. Adjusted for expected rate (higher rate = lower PLF).
    const ageFactor = Math.min(0.75, 0.50 + (Math.max(62, opts.borrower_age) - 62) * 0.008);
    const rateAdjust = Math.max(0, 1 - (opts.expected_rate_pct - 4) * 0.025);
    const plf = round2(ageFactor * rateAdjust);
    const principalLimit = round2(opts.home_value * plf);
    // Fees / MIP
    const upfrontMip = round2(opts.home_value * ((opts.upfront_mip_pct || 2) / 100));
    const netPrincipal = round2(principalLimit - upfrontMip);
    let monthlyPayout = 0;
    let lumpSum = 0;
    let locAvailable = 0;
    const monthlyRate = (opts.expected_rate_pct / 100) / 12;
    if (opts.payout_option === 'tenure') {
      // Tenure assumes life expectancy ~100. Annuitize netPrincipal over (100 - age) * 12 months
      const months = Math.max(60, (100 - opts.borrower_age) * 12);
      monthlyPayout = monthlyRate === 0 ? round2(netPrincipal / months) : round2(netPrincipal * monthlyRate / (1 - Math.pow(1 + monthlyRate, -months)));
    } else if (opts.payout_option === 'term' && opts.term_months) {
      monthlyPayout = monthlyRate === 0 ? round2(netPrincipal / opts.term_months) : round2(netPrincipal * monthlyRate / (1 - Math.pow(1 + monthlyRate, -opts.term_months)));
    } else if (opts.payout_option === 'loc') {
      locAvailable = netPrincipal;
    }
    return {
      principal_limit: principalLimit,
      principal_limit_factor: plf,
      upfront_mip: upfrontMip,
      net_available: netPrincipal,
      monthly_payout: round2(monthlyPayout),
      lump_sum: lumpSum,
      line_of_credit_available: round2(locAvailable),
      payout_option: opts.payout_option,
    };
  } catch (e: any) { return { error: e.message }; }
}

// F998: Credit card minimum payment + payoff time
export function creditCardPayoff(opts: { balance: number; apr_pct: number; min_pct: number; min_floor?: number; extra_payment?: number }) {
  try {
    const monthlyRate = (opts.apr_pct / 100) / 12;
    const minFloor = opts.min_floor || 25;
    const extra = opts.extra_payment || 0;
    let balance = opts.balance;
    let months = 0;
    let totalInterest = 0;
    while (balance > 0.01 && months < 600) {
      const interest = balance * monthlyRate;
      const minPmt = Math.max(minFloor, balance * (opts.min_pct / 100));
      const pmt = Math.min(balance + interest, minPmt + extra);
      const principal = pmt - interest;
      if (principal <= 0) return { error: 'Min payment doesn\'t cover interest — balance grows forever' };
      balance -= principal;
      totalInterest += interest;
      months++;
    }
    return {
      payoff_months: months,
      payoff_years: round2(months / 12),
      total_interest_paid: round2(totalInterest),
      total_paid: round2(opts.balance + totalInterest),
      first_payment: round2(Math.max(minFloor, opts.balance * (opts.min_pct / 100)) + extra),
    };
  } catch (e: any) { return { error: e.message }; }
}

// F999: Lease vs Buy comparison (NPV-based)
export function leaseVsBuyComparison(opts: {
  asset_price: number;
  lease_monthly: number;
  lease_term_months: number;
  buy_down_payment: number;
  buy_loan_amount: number;
  buy_rate_pct: number;
  buy_term_months: number;
  residual_value: number;
  discount_rate_pct?: number;
}) {
  try {
    const discRate = (opts.discount_rate_pct || 5) / 100 / 12;
    // Lease PV
    let leasePV = 0;
    for (let m = 1; m <= opts.lease_term_months; m++) {
      leasePV += opts.lease_monthly / Math.pow(1 + discRate, m);
    }
    // Buy: down payment + financed payments - residual value at end
    const buyMonthlyRate = (opts.buy_rate_pct / 100) / 12;
    const buyMonthly = buyMonthlyRate === 0
      ? opts.buy_loan_amount / opts.buy_term_months
      : opts.buy_loan_amount * buyMonthlyRate * Math.pow(1 + buyMonthlyRate, opts.buy_term_months) / (Math.pow(1 + buyMonthlyRate, opts.buy_term_months) - 1);
    let buyPV = opts.buy_down_payment;
    for (let m = 1; m <= opts.buy_term_months; m++) {
      buyPV += buyMonthly / Math.pow(1 + discRate, m);
    }
    // Subtract residual value (PV)
    buyPV -= opts.residual_value / Math.pow(1 + discRate, opts.buy_term_months);
    return {
      lease_pv: round2(leasePV),
      lease_monthly: opts.lease_monthly,
      buy_pv: round2(buyPV),
      buy_monthly: round2(buyMonthly),
      buy_down_payment: opts.buy_down_payment,
      recommendation: buyPV < leasePV ? 'buy' : 'lease',
      savings_by_recommendation: round2(Math.abs(buyPV - leasePV)),
    };
  } catch (e: any) { return { error: e.message }; }
}

// F1000: Auto loan affordability calculator
export function autoLoanAffordability(opts: { gross_monthly_income: number; existing_monthly_debt: number; max_dti_pct?: number; rate_pct: number; term_months: number; down_payment: number }) {
  try {
    const maxDti = opts.max_dti_pct || 36;
    const maxTotalDebtPayment = round2(opts.gross_monthly_income * (maxDti / 100));
    const availableForAuto = round2(Math.max(0, maxTotalDebtPayment - opts.existing_monthly_debt));
    const monthlyRate = (opts.rate_pct / 100) / 12;
    const affordableLoan = monthlyRate === 0
      ? round2(availableForAuto * opts.term_months)
      : round2(availableForAuto * (Math.pow(1 + monthlyRate, opts.term_months) - 1) / (monthlyRate * Math.pow(1 + monthlyRate, opts.term_months)));
    const maxVehiclePrice = round2(affordableLoan + opts.down_payment);
    return {
      max_monthly_payment: availableForAuto,
      max_loan_amount: affordableLoan,
      max_vehicle_price: maxVehiclePrice,
      down_payment_pct: round2((opts.down_payment / maxVehiclePrice) * 100),
      dti_with_max_loan: round2(((opts.existing_monthly_debt + availableForAuto) / opts.gross_monthly_income) * 100),
    };
  } catch (e: any) { return { error: e.message }; }
}

// F1001: SBA loan eligibility check (size standards by NAICS)
export function sbaEligibilityCheck(opts: { naics_code?: string; employee_count?: number; annual_revenue?: number; loan_program?: '7a' | '504' | 'microloan' }) {
  try {
    // SBA size standards (simplified) — most service businesses: $8M-$45M
    // revenue or 100-1500 employees; varies by NAICS.
    const program = opts.loan_program || '7a';
    let revLimit = 41500000;  // most service businesses
    let empLimit = 1500;
    let maxLoan = 5000000;  // 7(a) standard
    if (program === '504') {
      maxLoan = 5500000;
      revLimit = 15000000;  // tangible net worth ≤ $15M
    } else if (program === 'microloan') {
      maxLoan = 50000;
      revLimit = 5000000;
    }
    const revOk = !opts.annual_revenue || opts.annual_revenue <= revLimit;
    const empOk = !opts.employee_count || opts.employee_count <= empLimit;
    const eligible = revOk && empOk;
    return {
      program,
      max_loan_amount: maxLoan,
      revenue_limit: revLimit,
      employee_limit: empLimit,
      revenue_check: revOk ? 'pass' : 'fail',
      employee_check: empOk ? 'pass' : 'fail',
      eligible,
      notes: 'Simplified check — actual SBA size standards vary by NAICS code. See sba.gov for precise limits.',
    };
  } catch (e: any) { return { error: e.message }; }
}

// F1002: Margin call calculator for securities-backed lending
export function marginCallCalculator(opts: { portfolio_value: number; loan_balance: number; maintenance_pct?: number }) {
  try {
    const maintenance = (opts.maintenance_pct || 30) / 100;  // typical Reg T = 25%, broker = 30-35%
    const equity = opts.portfolio_value - opts.loan_balance;
    const currentMarginPct = round2((equity / opts.portfolio_value) * 100);
    const marginCall = currentMarginPct < (maintenance * 100);
    // Price at which margin call triggers
    // equity / portfolio_value = maintenance
    // (portfolio - loan) / portfolio = maintenance
    // portfolio = loan / (1 - maintenance)
    const callTriggerValue = round2(opts.loan_balance / (1 - maintenance));
    const cushion = round2(opts.portfolio_value - callTriggerValue);
    const dropToTrigger = round2(((opts.portfolio_value - callTriggerValue) / opts.portfolio_value) * 100);
    // Cash needed to cure: enough to restore maintenance margin
    // new_loan = (portfolio - cash) - need = maintenance × portfolio
    // cash_required = portfolio_value × (1 - maintenance) - loan_balance × 0  ... simpler:
    const cashToCure = round2(Math.max(0, (opts.loan_balance + maintenance * opts.portfolio_value) - opts.portfolio_value) / (1 - maintenance));
    return {
      portfolio_value: round2(opts.portfolio_value),
      loan_balance: round2(opts.loan_balance),
      equity: round2(equity),
      current_margin_pct: currentMarginPct,
      maintenance_pct: maintenance * 100,
      margin_call_triggered: marginCall,
      call_trigger_portfolio_value: callTriggerValue,
      cushion_amount: cushion,
      cushion_pct: dropToTrigger,
      cash_to_cure: marginCall ? cashToCure : 0,
    };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch LH: Advanced financial math (F1003-F1012)
// ════════════════════════════════════════════════════════════════════

// F1003: Present Value / Future Value calculator
export function presentValue(opts: { future_value: number; rate_pct: number; periods: number }) {
  const r = opts.rate_pct / 100;
  return { present_value: round2(opts.future_value / Math.pow(1 + r, opts.periods)) };
}
export function futureValue(opts: { present_value: number; rate_pct: number; periods: number }) {
  const r = opts.rate_pct / 100;
  return { future_value: round2(opts.present_value * Math.pow(1 + r, opts.periods)) };
}

// F1004: NPV (Net Present Value) of a cash flow stream
export function calculateNpv(cashFlows: number[], discountRatePct: number) {
  try {
    const r = discountRatePct / 100;
    let npv = 0;
    for (let t = 0; t < cashFlows.length; t++) {
      npv += cashFlows[t] / Math.pow(1 + r, t);
    }
    return { npv: round2(npv), discount_rate_pct: discountRatePct, period_count: cashFlows.length };
  } catch (e: any) { return { error: e.message }; }
}

// F1005: IRR (Internal Rate of Return) — Newton-Raphson root-finding on NPV
export function calculateIrr(cashFlows: number[], maxIter = 100, tolerance = 1e-7) {
  try {
    if (cashFlows.length < 2) return { error: 'Need ≥2 periods' };
    let rate = 0.10;  // initial guess
    for (let iter = 0; iter < maxIter; iter++) {
      let npv = 0;
      let derivative = 0;
      for (let t = 0; t < cashFlows.length; t++) {
        const denom = Math.pow(1 + rate, t);
        npv += cashFlows[t] / denom;
        if (t > 0) derivative -= (t * cashFlows[t]) / (Math.pow(1 + rate, t + 1));
      }
      if (Math.abs(npv) < tolerance) {
        return { irr_pct: round2(rate * 100), iterations: iter, converged: true };
      }
      if (derivative === 0) return { error: 'Derivative zero — cannot converge' };
      rate = rate - npv / derivative;
      if (!isFinite(rate)) return { error: 'Diverged' };
    }
    return { irr_pct: round2(rate * 100), iterations: maxIter, converged: false };
  } catch (e: any) { return { error: e.message }; }
}

// F1006: Effective Annual Rate (APR ↔ APY conversion)
export function aprToApy(aprPct: number, compoundsPerYear: number) {
  const apr = aprPct / 100;
  const apy = Math.pow(1 + apr / compoundsPerYear, compoundsPerYear) - 1;
  return { apr_pct: round2(aprPct), apy_pct: round2(apy * 100), compounds_per_year: compoundsPerYear };
}
export function apyToApr(apyPct: number, compoundsPerYear: number) {
  const apy = apyPct / 100;
  const apr = compoundsPerYear * (Math.pow(1 + apy, 1 / compoundsPerYear) - 1);
  return { apr_pct: round2(apr * 100), apy_pct: round2(apyPct), compounds_per_year: compoundsPerYear };
}

// F1007: APR with fees (TILA-compliant — the "true cost" rate)
// Includes origination fees, points, etc. — net loan amount is reduced.
export function calculateAprWithFees(opts: { principal: number; nominal_rate_pct: number; term_months: number; fees: number }) {
  try {
    const monthlyRate = (opts.nominal_rate_pct / 100) / 12;
    const monthlyPmt = monthlyRate === 0
      ? opts.principal / opts.term_months
      : opts.principal * monthlyRate * Math.pow(1 + monthlyRate, opts.term_months) / (Math.pow(1 + monthlyRate, opts.term_months) - 1);
    // Net amount borrower receives
    const netAmount = opts.principal - opts.fees;
    // Solve for APR such that PV of monthly payments at APR/12 = netAmount
    // This is essentially IRR of cash flows [netAmount, -pmt, -pmt, ...]
    const cashFlows = [netAmount];
    for (let i = 0; i < opts.term_months; i++) cashFlows.push(-monthlyPmt);
    const irrMonthly = calculateIrr(cashFlows) as any;
    if (irrMonthly?.error) return { error: irrMonthly.error };
    const aprAnnualPct = round2(irrMonthly.irr_pct * 12);  // monthly IRR × 12
    return {
      nominal_rate_pct: round2(opts.nominal_rate_pct),
      apr_with_fees_pct: aprAnnualPct,
      fees: round2(opts.fees),
      monthly_payment: round2(monthlyPmt),
      net_amount_received: round2(netAmount),
    };
  } catch (e: any) { return { error: e.message }; }
}

// F1008: Yield maintenance prepayment penalty (commercial real estate)
// Lender's "make-whole" — penalty equals PV of lost interest at current Treasury rate.
export function yieldMaintenancePenalty(opts: { loan_balance: number; loan_rate_pct: number; remaining_months: number; treasury_rate_pct: number }) {
  try {
    const rateDiff = (opts.loan_rate_pct - opts.treasury_rate_pct) / 100;
    if (rateDiff <= 0) return { penalty: 0, reason: 'Treasury rate ≥ loan rate — no penalty' };
    const monthlyTreasuryRate = (opts.treasury_rate_pct / 100) / 12;
    const monthlyLostInterest = opts.loan_balance * (rateDiff / 12);
    // PV of monthly lost interest stream at Treasury rate
    let pv = 0;
    for (let m = 1; m <= opts.remaining_months; m++) {
      pv += monthlyLostInterest / Math.pow(1 + monthlyTreasuryRate, m);
    }
    return { penalty: round2(pv), rate_differential_pct: round2(rateDiff * 100), remaining_months: opts.remaining_months };
  } catch (e: any) { return { error: e.message }; }
}

// F1009: Defeasance cost calculator (CMBS loans — replace collateral with US Treasuries)
export function defeasanceCost(opts: { loan_balance: number; remaining_payments: number; monthly_payment: number; treasury_yield_pct: number; transaction_fee?: number }) {
  try {
    const monthlyTreasury = (opts.treasury_yield_pct / 100) / 12;
    // Cost = PV of remaining payments at current Treasury yield + fees
    let pvOfPayments = 0;
    for (let m = 1; m <= opts.remaining_payments; m++) {
      pvOfPayments += opts.monthly_payment / Math.pow(1 + monthlyTreasury, m);
    }
    const totalCost = round2(pvOfPayments + (opts.transaction_fee || 0));
    return {
      defeasance_pv: round2(pvOfPayments),
      transaction_fee: opts.transaction_fee || 0,
      total_cost: totalCost,
      premium_over_balance: round2(totalCost - opts.loan_balance),
    };
  } catch (e: any) { return { error: e.message }; }
}

// F1010: Modified Duration for a fixed-rate loan
// Sensitivity to interest rate changes: dP/P ≈ -Duration × dR
export function modifiedDuration(opts: { rate_pct: number; periods: number; coupon_per_period?: number }) {
  try {
    const r = opts.rate_pct / 100;
    // Simplified: for a level-coupon stream, Macaulay duration = Σ(t × CFt × (1+r)^-t) / PV
    // Modified = Macaulay / (1+r)
    let weightedPV = 0;
    let totalPV = 0;
    const cf = opts.coupon_per_period || 1;
    for (let t = 1; t <= opts.periods; t++) {
      const pv = cf / Math.pow(1 + r, t);
      weightedPV += t * pv;
      totalPV += pv;
    }
    const macaulay = totalPV > 0 ? weightedPV / totalPV : 0;
    const modified = macaulay / (1 + r);
    return { macaulay_duration: round2(macaulay), modified_duration: round2(modified) };
  } catch (e: any) { return { error: e.message }; }
}

// F1011: Allowance for Loan Losses — simplified CECL model
// CECL = Probability of Default × Loss Given Default × Exposure at Default
export function cecLossReserve(opts: { exposure: number; pd_pct: number; lgd_pct: number }) {
  try {
    const expectedLoss = round2(opts.exposure * (opts.pd_pct / 100) * (opts.lgd_pct / 100));
    return {
      exposure: round2(opts.exposure),
      probability_of_default_pct: opts.pd_pct,
      loss_given_default_pct: opts.lgd_pct,
      expected_credit_loss: expectedLoss,
      reserve_pct_of_exposure: round2((expectedLoss / opts.exposure) * 100),
    };
  } catch (e: any) { return { error: e.message }; }
}

// F1012: Tax-equivalent yield (for comparing taxable vs muni bond loans)
export function taxEquivalentYield(opts: { muni_yield_pct: number; marginal_tax_rate_pct: number }) {
  const tey = opts.muni_yield_pct / (1 - opts.marginal_tax_rate_pct / 100);
  return { tax_equivalent_yield_pct: round2(tey), muni_yield_pct: opts.muni_yield_pct, marginal_tax_pct: opts.marginal_tax_rate_pct };
}

// ════════════════════════════════════════════════════════════════════
// Batch LI: Applications & origination (F1013-F1022)
// ════════════════════════════════════════════════════════════════════

// F1013: Create a loan application
export function createLoanApplication(opts: any) {
  try {
    const id = uuid();
    const appNumber = `APP-${Date.now()}`;
    db.getDb().prepare(`INSERT INTO loan_applications (id, company_id, borrower_id, application_number, loan_type, requested_amount, requested_term_months, purpose, collateral_description, estimated_collateral_value, estimated_rate, status, application_data_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.borrower_id || null, opts.application_number || appNumber, opts.loan_type, opts.requested_amount, opts.requested_term_months || null, opts.purpose || null, opts.collateral_description || null, opts.estimated_collateral_value || null, opts.estimated_rate || null, opts.status || 'draft', JSON.stringify(opts.application_data || {}));
    return { id, application_number: opts.application_number || appNumber };
  } catch (e: any) { return { error: e.message }; }
}

// F1014: Pre-qualification — check borrower meets basic DTI/credit requirements
export function preQualify(opts: { borrower_id?: string; loan_type: string; requested_amount: number; estimated_rate_pct: number; term_months: number; gross_monthly_income?: number; existing_monthly_debt?: number; credit_score?: number }) {
  try {
    let income = opts.gross_monthly_income || 0;
    let debt = opts.existing_monthly_debt || 0;
    let creditScore = opts.credit_score || 0;
    if (opts.borrower_id) {
      const b = db.getDb().prepare('SELECT * FROM borrower_profiles WHERE id = ? AND company_id = ?').get(opts.borrower_id, db.getCurrentCompanyId()) as any;
      if (b) {
        income = income || (b.annual_income || 0) / 12;
        debt = debt || (b.monthly_debt || 0);
        creditScore = creditScore || (b.credit_score || 0);
      }
    }
    // Compute proposed payment
    const monthlyRate = (opts.estimated_rate_pct / 100) / 12;
    const proposedPmt = monthlyRate === 0
      ? opts.requested_amount / opts.term_months
      : opts.requested_amount * monthlyRate * Math.pow(1 + monthlyRate, opts.term_months) / (Math.pow(1 + monthlyRate, opts.term_months) - 1);
    const dtiWithLoan = income > 0 ? ((debt + proposedPmt) / income) * 100 : null;
    // Standards by loan type
    let maxDti = 43;
    let minCreditScore = 620;
    if (opts.loan_type === 'mortgage') { maxDti = 43; minCreditScore = 620; }
    else if (opts.loan_type === 'auto') { maxDti = 45; minCreditScore = 580; }
    else if (opts.loan_type === 'personal') { maxDti = 40; minCreditScore = 660; }
    else if (opts.loan_type === 'business' || opts.loan_type === 'sba') { maxDti = 50; minCreditScore = 680; }
    const dtiOk = dtiWithLoan != null && dtiWithLoan <= maxDti;
    const creditOk = creditScore >= minCreditScore;
    const verdict = dtiOk && creditOk ? 'pre_qualified' : (dtiOk || creditOk ? 'conditional' : 'not_qualified');
    return {
      proposed_monthly_payment: round2(proposedPmt),
      dti_with_loan_pct: dtiWithLoan != null ? round2(dtiWithLoan) : null,
      max_dti_pct: maxDti,
      dti_check: dtiOk ? 'pass' : 'fail',
      credit_score: creditScore,
      min_credit_score: minCreditScore,
      credit_check: creditOk ? 'pass' : 'fail',
      verdict,
    };
  } catch (e: any) { return { error: e.message }; }
}

// F1015: Generate a 1003 mortgage application data shape
export function generate1003Form(borrowerId: string, applicationId: string) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const borrower = dbi.prepare('SELECT * FROM borrower_profiles WHERE id = ? AND company_id = ?').get(borrowerId, cid) as any;
    const app = dbi.prepare('SELECT * FROM loan_applications WHERE id = ? AND company_id = ?').get(applicationId, cid) as any;
    if (!borrower || !app) return { error: 'Borrower or application not found' };
    return {
      section_i_borrower: { full_name: borrower.name, ssn_last4: borrower.ssn_ein_last4, dob: borrower.date_of_birth_or_founded, email: borrower.email, phone: borrower.phone, address: borrower.address, citizenship: borrower.citizenship_status },
      section_ii_employment: { status: borrower.employment_status, years_at_employer: borrower.years_at_employer, annual_income: borrower.annual_income },
      section_iii_income_assets: { annual_income: borrower.annual_income, monthly_income: round2((borrower.annual_income || 0) / 12), monthly_debt_obligations: borrower.monthly_debt },
      section_iv_loan_property: { loan_type: app.loan_type, requested_amount: app.requested_amount, purpose: app.purpose, collateral_description: app.collateral_description, estimated_value: app.estimated_collateral_value },
      section_v_declarations: { citizenship_status: borrower.citizenship_status, bankruptcy_in_past_7_years: null, judgments: null, lawsuits: null },
      form_version: '1003 (2020 redesign)',
      generated_at: now(),
    };
  } catch (e: any) { return { error: e.message }; }
}

// F1016: Underwriting checklist for a loan application
export function underwritingChecklist(applicationId: string) {
  try {
    const app = db.getDb().prepare('SELECT * FROM loan_applications WHERE id = ? AND company_id = ?').get(applicationId, db.getCurrentCompanyId()) as any;
    if (!app) return { error: 'Application not found' };
    const baseItems = [
      { item: 'Borrower KYC verified', required: true },
      { item: 'Credit report pulled (within 90 days)', required: true },
      { item: 'Income verification (paystubs / W-2s / tax returns)', required: true },
      { item: 'Bank statement review (2-3 months)', required: true },
      { item: 'Debt-to-income computed', required: true },
      { item: 'Loan-to-value confirmed', required: app.loan_type === 'mortgage' || app.loan_type === 'auto' || app.loan_type === 'equipment' },
      { item: 'Property appraisal', required: app.loan_type === 'mortgage' || app.loan_type === 'construction' },
      { item: 'Title search', required: app.loan_type === 'mortgage' },
      { item: 'Hazard insurance proof', required: app.loan_type === 'mortgage' || app.loan_type === 'auto' || app.loan_type === 'equipment' },
      { item: 'UCC search (existing liens)', required: app.loan_type === 'business' || app.loan_type === 'sba' || app.loan_type === 'equipment' },
      { item: 'Business financial statements (3 yrs)', required: app.loan_type === 'business' || app.loan_type === 'sba' },
      { item: 'Business tax returns (3 yrs)', required: app.loan_type === 'business' || app.loan_type === 'sba' },
      { item: 'Construction plans + cost breakdown', required: app.loan_type === 'construction' },
      { item: 'Builder credentials', required: app.loan_type === 'construction' },
      { item: 'Compliance: HMDA fields completed', required: app.loan_type === 'mortgage' },
      { item: 'Compliance: AML / OFAC screened', required: true },
    ].filter(i => i.required);
    return { application_id: applicationId, loan_type: app.loan_type, checklist: baseItems, count: baseItems.length };
  } catch (e: any) { return { error: e.message }; }
}

// F1017: GFE / Loan Estimate generator (3 pages required by RESPA/TRID)
export function generateLoanEstimate(applicationId: string) {
  try {
    const cid = db.getCurrentCompanyId();
    const app = db.getDb().prepare('SELECT * FROM loan_applications WHERE id = ? AND company_id = ?').get(applicationId, cid) as any;
    if (!app) return { error: 'Application not found' };
    const rate = (app.estimated_rate || 0.06);  // as decimal
    const term = app.requested_term_months || 360;
    const monthlyRate = rate / 12;
    const monthlyPmt = monthlyRate === 0
      ? app.requested_amount / term
      : app.requested_amount * monthlyRate * Math.pow(1 + monthlyRate, term) / (Math.pow(1 + monthlyRate, term) - 1);
    const totalInterest = round2(monthlyPmt * term - app.requested_amount);
    return {
      page1_loan_terms: {
        loan_amount: app.requested_amount,
        interest_rate_pct: round2(rate * 100),
        monthly_principal_interest: round2(monthlyPmt),
        prepayment_penalty: false,
        balloon_payment: false,
      },
      page2_costs: {
        loan_costs_estimate: round2(app.requested_amount * 0.015),  // ~1.5% origination
        services_borrower_did_not_shop_for: 800,
        services_borrower_can_shop_for: 1500,
        taxes_and_government_fees: 1200,
        prepaids: 2400,
        initial_escrow: round2(app.requested_amount * 0.003),
        other: 500,
      },
      page3_comparisons: {
        in_5_years_total: round2(monthlyPmt * 60),
        in_5_years_principal: round2((app.requested_amount * 0.10)),  // approx
        annual_percentage_rate_pct: round2(rate * 100),
        total_interest_pct_of_loan: round2((totalInterest / app.requested_amount) * 100),
      },
      generated_at: now(),
      version: 'TRID 2015',
    };
  } catch (e: any) { return { error: e.message }; }
}

// F1018: Closing Disclosure (CD) — 5-page document required 3 days before closing
export function generateClosingDisclosure(loanId: string) {
  try {
    const loan = db.getDb().prepare('SELECT * FROM loans WHERE id = ? AND company_id = ?').get(loanId, db.getCurrentCompanyId()) as any;
    if (!loan) return { error: 'Loan not found' };
    return {
      page1_loan_terms: {
        loan_amount: loan.principal,
        interest_rate_pct: round2((loan.interest_rate || 0) * 100),
        monthly_principal_interest: round2(loan.payment_amount || 0),
        prepayment_penalty: false,
        balloon_payment: loan.amortization_type === 'balloon',
      },
      page2_closing_cost_details: { /* would itemize from settlements */ },
      page3_calculating_cash_to_close: { /* down payment + closing costs - credits */ },
      page4_loan_disclosures: { assumption: 'not allowed', demand_feature: 'no', late_payment_after_days: 15, late_fee_pct_of_payment: 5 },
      page5_contact_information: { lender: loan.lender_name, settlement_agent: '' },
      generated_at: now(),
      version: 'TRID 2015',
    };
  } catch (e: any) { return { error: e.message }; }
}

// F1019: TIL (Truth in Lending) disclosure
export function generateTilDisclosure(loanId: string) {
  try {
    const loan = db.getDb().prepare('SELECT * FROM loans WHERE id = ? AND company_id = ?').get(loanId, db.getCurrentCompanyId()) as any;
    if (!loan) return { error: 'Loan not found' };
    const totalOfPayments = round2((loan.payment_amount || 0) * (loan.term_months || 360));
    const financeCharge = round2(totalOfPayments - loan.principal);
    return {
      annual_percentage_rate_pct: round2((loan.interest_rate || 0) * 100),
      finance_charge: financeCharge,
      amount_financed: round2(loan.principal),
      total_of_payments: totalOfPayments,
      generated_at: now(),
    };
  } catch (e: any) { return { error: e.message }; }
}

// F1020: Generate a promissory note record (for family/business notes)
export function createPromissoryNote(opts: { borrower_name: string; lender_name: string; principal_amount: number; interest_rate_pct?: number; afr_rate_pct?: number; use_afr?: boolean; payment_terms?: string; maturity_date?: string; governing_state?: string; loan_id?: string }) {
  try {
    const id = uuid();
    const noteNumber = `PN-${Date.now()}`;
    db.getDb().prepare(`INSERT INTO loan_promissory_notes (id, company_id, loan_id, note_number, borrower_name, lender_name, principal_amount, interest_rate, afr_rate, use_afr, payment_terms, maturity_date, signed_date, governing_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.loan_id || null, noteNumber, opts.borrower_name, opts.lender_name, opts.principal_amount, opts.interest_rate_pct || 0, opts.afr_rate_pct || 0, opts.use_afr ? 1 : 0, opts.payment_terms || null, opts.maturity_date || null, today(), opts.governing_state || null);
    return { id, note_number: noteNumber };
  } catch (e: any) { return { error: e.message }; }
}

// F1021: Loan committee package (for review meetings)
export function loanCommitteePackage(applicationId: string) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const app = dbi.prepare('SELECT * FROM loan_applications WHERE id = ? AND company_id = ?').get(applicationId, cid) as any;
    if (!app) return { error: 'Application not found' };
    const borrower = app.borrower_id ? dbi.prepare('SELECT * FROM borrower_profiles WHERE id = ?').get(app.borrower_id) as any : null;
    const checklist = underwritingChecklist(applicationId);
    const prequal = preQualify({
      loan_type: app.loan_type,
      requested_amount: app.requested_amount,
      estimated_rate_pct: (app.estimated_rate || 0.06) * 100,
      term_months: app.requested_term_months || 360,
      borrower_id: app.borrower_id,
    });
    return {
      application: app,
      borrower,
      pre_qualification: prequal,
      checklist,
      package_assembled_at: now(),
    };
  } catch (e: any) { return { error: e.message }; }
}

// F1022: Create / update borrower profile (KYC record)
export function upsertBorrowerProfile(opts: any) {
  try {
    const cid = db.getCurrentCompanyId();
    const id = opts.id || uuid();
    if (opts.id) {
      db.getDb().prepare(`UPDATE borrower_profiles SET name = ?, borrower_type = ?, ssn_ein_last4 = ?, date_of_birth_or_founded = ?, email = ?, phone = ?, address = ?, credit_score = ?, annual_income = ?, monthly_debt = ?, employment_status = ?, years_at_employer = ?, citizenship_status = ?, kyc_status = ?, updated_at = ? WHERE id = ?`)
        .run(opts.name, opts.borrower_type || 'individual', opts.ssn_ein_last4 || null, opts.date_of_birth_or_founded || null, opts.email || null, opts.phone || null, opts.address || null, opts.credit_score || null, opts.annual_income || 0, opts.monthly_debt || 0, opts.employment_status || null, opts.years_at_employer || null, opts.citizenship_status || null, opts.kyc_status || 'pending', now(), opts.id);
    } else {
      db.getDb().prepare(`INSERT INTO borrower_profiles (id, company_id, name, borrower_type, ssn_ein_last4, date_of_birth_or_founded, email, phone, address, credit_score, credit_score_updated_at, annual_income, monthly_debt, employment_status, years_at_employer, citizenship_status, kyc_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, cid, opts.name, opts.borrower_type || 'individual', opts.ssn_ein_last4 || null, opts.date_of_birth_or_founded || null, opts.email || null, opts.phone || null, opts.address || null, opts.credit_score || null, opts.credit_score ? today() : null, opts.annual_income || 0, opts.monthly_debt || 0, opts.employment_status || null, opts.years_at_employer || null, opts.citizenship_status || null, opts.kyc_status || 'pending');
    }
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch LJ: Risk & compliance (F1023-F1032)
// ════════════════════════════════════════════════════════════════════

// F1023: Track credit score history for a borrower
export function updateCreditScore(borrowerId: string, score: number, source?: string) {
  try {
    db.getDb().prepare(`UPDATE borrower_profiles SET credit_score = ?, credit_score_updated_at = ?, updated_at = ? WHERE id = ? AND company_id = ?`)
      .run(score, now(), now(), borrowerId, db.getCurrentCompanyId());
    return { updated: true, new_score: score, source: source || 'manual', updated_at: now() };
  } catch (e: any) { return { error: e.message }; }
}

// F1024: Calculate DTI for a borrower (with optional new loan)
export function calculateBorrowerDti(borrowerId: string, additionalMonthlyPayment = 0) {
  try {
    const b = db.getDb().prepare('SELECT * FROM borrower_profiles WHERE id = ? AND company_id = ?').get(borrowerId, db.getCurrentCompanyId()) as any;
    if (!b) return { error: 'Borrower not found' };
    const monthlyIncome = (b.annual_income || 0) / 12;
    const totalDebt = (b.monthly_debt || 0) + additionalMonthlyPayment;
    const dti = monthlyIncome > 0 ? (totalDebt / monthlyIncome) * 100 : null;
    return {
      borrower_id: borrowerId,
      monthly_income: round2(monthlyIncome),
      total_monthly_debt: round2(totalDebt),
      dti_pct: dti != null ? round2(dti) : null,
      dti_band: dti == null ? 'unknown' : dti < 36 ? 'healthy' : dti < 43 ? 'acceptable' : 'high_risk',
    };
  } catch (e: any) { return { error: e.message }; }
}

// F1025: Loan loss reserve calculation per risk bucket (simplified portfolio CECL)
export function portfolioLossReserve(opts?: { default_pd_pct?: { excellent?: number; good?: number; fair?: number; poor?: number }; lgd_pct?: number }) {
  try {
    const cid = db.getCurrentCompanyId();
    const loans = db.getDb().prepare(`SELECT l.*, rg.grade FROM loans l LEFT JOIN loan_risk_grades rg ON rg.loan_id = l.id WHERE l.company_id = ? AND l.deleted_at IS NULL AND l.status = 'active'`).all(cid) as any[];
    const pd = opts?.default_pd_pct || { excellent: 0.5, good: 2, fair: 8, poor: 20 };
    const lgd = opts?.lgd_pct || 40;
    let totalExposure = 0;
    let totalReserve = 0;
    const byBucket: any[] = [];
    const buckets: Record<string, number> = {};
    for (const l of loans) {
      const bal = l.current_balance || 0;
      const bucket = (l.grade || 0) <= 2 ? 'excellent' : (l.grade || 0) <= 4 ? 'good' : (l.grade || 0) <= 6 ? 'fair' : 'poor';
      const pdPct = (pd as any)[bucket] || 5;
      const reserve = bal * (pdPct / 100) * (lgd / 100);
      totalExposure += bal;
      totalReserve += reserve;
      buckets[bucket] = (buckets[bucket] || 0) + bal;
    }
    for (const [bucket, exp] of Object.entries(buckets)) {
      const pdPct = (pd as any)[bucket] || 5;
      byBucket.push({ bucket, exposure: round2(exp), pd_pct: pdPct, lgd_pct: lgd, reserve: round2(exp * (pdPct / 100) * (lgd / 100)) });
    }
    return { total_exposure: round2(totalExposure), total_reserve_required: round2(totalReserve), reserve_pct: totalExposure > 0 ? round2((totalReserve / totalExposure) * 100) : 0, by_bucket: byBucket };
  } catch (e: any) { return { error: e.message }; }
}

// F1026: Risk-weighted DSCR (gives extra weight to high-risk loans)
export function riskWeightedDscr() {
  try {
    const cid = db.getCurrentCompanyId();
    const loans = db.getDb().prepare(`SELECT l.payment_amount, rg.grade FROM loans l LEFT JOIN loan_risk_grades rg ON rg.loan_id = l.id WHERE l.company_id = ? AND l.deleted_at IS NULL AND l.status = 'active'`).all(cid) as any[];
    const weightFor = (grade: number) => grade <= 2 ? 1.0 : grade <= 4 ? 1.25 : grade <= 6 ? 1.5 : 2.0;
    let weightedDebtService = 0;
    for (const l of loans) {
      weightedDebtService += (l.payment_amount || 0) * 12 * weightFor(l.grade || 5);
    }
    // Use revenue as proxy for cash flow
    const noi = (db.getDb().prepare(`SELECT COALESCE(SUM(CASE WHEN type='revenue' THEN balance ELSE 0 END), 0) n FROM accounts WHERE company_id = ?`).get(cid) as any).n || 0;
    const dscr = weightedDebtService > 0 ? Math.abs(noi) / weightedDebtService : null;
    return { risk_weighted_dscr: dscr != null ? round2(dscr) : null, weighted_debt_service: round2(weightedDebtService), noi_proxy: round2(noi) };
  } catch (e: any) { return { error: e.message }; }
}

// F1027: HMDA reporting fields (for mortgage applications)
export function hmdaReportingFields(applicationId: string) {
  try {
    const app = db.getDb().prepare('SELECT * FROM loan_applications WHERE id = ? AND company_id = ?').get(applicationId, db.getCurrentCompanyId()) as any;
    if (!app) return { error: 'Application not found' };
    return {
      universal_loan_identifier: app.application_number,
      loan_type: app.loan_type === 'mortgage' ? 'Conventional' : app.loan_type,
      loan_purpose: app.purpose,
      loan_amount: app.requested_amount,
      action_taken: app.decision || 'Application withdrawn',
      action_date: app.decided_at,
      hoepa_status: app.estimated_rate > 0.08 ? 'High-cost mortgage' : 'Not high-cost',
      compliance_note: 'Race/ethnicity/sex/income/property characteristics required for HMDA reporting — complete via separate borrower data collection',
    };
  } catch (e: any) { return { error: e.message }; }
}

// F1028: Fair lending — disparate impact check (simplified)
export function fairLendingCheck() {
  try {
    const cid = db.getCurrentCompanyId();
    const approvals = db.getDb().prepare(`SELECT decision, COUNT(*) c FROM loan_applications WHERE company_id = ? AND decided_at >= date('now', '-365 days') GROUP BY decision`).all(cid) as any[];
    const totals: Record<string, number> = {};
    for (const r of approvals) totals[r.decision || 'no_decision'] = r.c;
    const approved = totals['approved'] || 0;
    const total = Object.values(totals).reduce((s, n) => s + n, 0);
    const approvalRate = total > 0 ? round2((approved / total) * 100) : null;
    return {
      total_applications_12mo: total,
      approval_counts: totals,
      overall_approval_rate_pct: approvalRate,
      note: 'Full fair lending analysis requires demographic data segmented by protected class — engage compliance counsel for HMDA + ECOA review',
    };
  } catch (e: any) { return { error: e.message }; }
}

// F1029: Assign or update a risk grade for a loan
export function assignRiskGrade(opts: { loan_id: string; grade: number; grade_label?: string; factors?: string[]; assigned_by?: string; notes?: string }) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO loan_risk_grades (id, company_id, loan_id, grade, grade_label, factors_json, assigned_by, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.loan_id, opts.grade, opts.grade_label || gradeToLabel(opts.grade), JSON.stringify(opts.factors || []), opts.assigned_by || null, opts.notes || null);
    return { id, grade: opts.grade, label: opts.grade_label || gradeToLabel(opts.grade) };
  } catch (e: any) { return { error: e.message }; }
}
function gradeToLabel(grade: number): string {
  if (grade <= 1) return 'Pass';
  if (grade <= 2) return 'Watch';
  if (grade <= 3) return 'Special Mention';
  if (grade <= 4) return 'Substandard';
  if (grade <= 5) return 'Doubtful';
  return 'Loss';
}

// F1030: Watchlist — loans graded ≥4 (substandard or worse)
export function loanWatchlist() {
  try {
    return db.getDb().prepare(`SELECT l.id, l.name, l.current_balance, l.status, rg.grade, rg.grade_label, rg.assigned_at FROM loans l INNER JOIN loan_risk_grades rg ON rg.loan_id = l.id WHERE l.company_id = ? AND rg.grade >= 4 AND l.deleted_at IS NULL ORDER BY rg.grade DESC, rg.assigned_at DESC`)
      .all(db.getCurrentCompanyId());
  } catch (e: any) { return []; }
}

// F1031: Charge off a loan (or partial)
export function chargeOffLoan(opts: { loan_id: string; principal: number; interest?: number; fees?: number; reason: string; approved_by?: string }) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const total = (opts.principal || 0) + (opts.interest || 0) + (opts.fees || 0);
    const id = uuid();
    const txn = dbi.transaction(() => {
      dbi.prepare(`INSERT INTO loan_charge_offs (id, company_id, loan_id, charge_off_date, principal_charged_off, interest_charged_off, fees_charged_off, total_charged_off, reason, approved_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, cid, opts.loan_id, today(), opts.principal, opts.interest || 0, opts.fees || 0, total, opts.reason, opts.approved_by || null);
      dbi.prepare(`UPDATE loans SET status = 'defaulted', updated_at = ? WHERE id = ?`).run(now(), opts.loan_id);
      dbi.prepare(`INSERT INTO loan_events (id, loan_id, event_type, event_date, description, metadata_json) VALUES (?, ?, 'charge_off', ?, ?, ?)`)
        .run(uuid(), opts.loan_id, today(), opts.reason, JSON.stringify({ amount: total, principal: opts.principal, interest: opts.interest, fees: opts.fees }));
    });
    txn();
    return { charge_off_id: id, total_charged_off: round2(total) };
  } catch (e: any) { return { error: e.message }; }
}

// F1032: Record a recovery on a charged-off loan
export function recordRecovery(opts: { loan_id: string; charge_off_id?: string; recovery_amount: number; recovery_date?: string; recovery_method?: string; notes?: string }) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO loan_recoveries (id, company_id, loan_id, charge_off_id, recovery_date, recovery_amount, recovery_method, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.loan_id, opts.charge_off_id || null, opts.recovery_date || today(), opts.recovery_amount, opts.recovery_method || null, opts.notes || null);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch LK: Specialized loan products (F1033-F1042)
// ════════════════════════════════════════════════════════════════════

// F1033: Create a HELOC (sets credit_limit semantics) + record a draw
export function helocRecordDraw(opts: { loan_id: string; draw_amount: number; purpose?: string; notes?: string }) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const loan = dbi.prepare('SELECT * FROM loans WHERE id = ? AND company_id = ?').get(opts.loan_id, cid) as any;
    if (!loan) return { error: 'Loan not found' };
    const before = (loan.principal || 0) - (loan.current_balance || 0);  // credit_limit - drawn
    const after = before - opts.draw_amount;
    if (after < 0) return { error: 'Draw exceeds available credit' };
    const id = uuid();
    const txn = dbi.transaction(() => {
      dbi.prepare(`INSERT INTO loan_heloc_draws (id, company_id, loan_id, draw_date, draw_amount, available_credit_before, available_credit_after, purpose, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, cid, opts.loan_id, today(), opts.draw_amount, before, after, opts.purpose || null, opts.notes || null);
      dbi.prepare(`UPDATE loans SET current_balance = current_balance + ?, updated_at = ? WHERE id = ?`).run(opts.draw_amount, now(), opts.loan_id);
    });
    txn();
    return { draw_id: id, available_before: round2(before), available_after: round2(after) };
  } catch (e: any) { return { error: e.message }; }
}

// F1034: Transition HELOC from draw to repayment phase
export function helocTransitionToRepayment(opts: { loan_id: string; repayment_term_months: number; effective_date?: string }) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const loan = dbi.prepare('SELECT * FROM loans WHERE id = ? AND company_id = ?').get(opts.loan_id, cid) as any;
    if (!loan) return { error: 'Loan not found' };
    const balance = loan.current_balance || 0;
    const monthlyRate = (loan.interest_rate || 0) / 12;
    const newPmt = monthlyRate === 0
      ? round2(balance / opts.repayment_term_months)
      : round2(balance * monthlyRate * Math.pow(1 + monthlyRate, opts.repayment_term_months) / (Math.pow(1 + monthlyRate, opts.repayment_term_months) - 1));
    const txn = dbi.transaction(() => {
      dbi.prepare(`UPDATE loans SET payment_amount = ?, term_months = ?, amortization_type = 'standard', updated_at = ? WHERE id = ?`)
        .run(newPmt, opts.repayment_term_months, now(), opts.loan_id);
      dbi.prepare(`INSERT INTO loan_events (id, loan_id, event_type, event_date, description, metadata_json) VALUES (?, ?, 'phase_transition', ?, ?, ?)`)
        .run(uuid(), opts.loan_id, opts.effective_date || today(), 'HELOC: draw phase → repayment phase', JSON.stringify({ new_payment: newPmt, repayment_months: opts.repayment_term_months }));
    });
    txn();
    return { transitioned: true, new_monthly_payment: newPmt };
  } catch (e: any) { return { error: e.message }; }
}

// F1035: Create a construction loan draw request
export function createConstructionDraw(opts: { loan_id: string; requested_amount: number; pct_complete?: number; inspector_name?: string; notes?: string }) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const drawCount = (dbi.prepare(`SELECT COUNT(*) c FROM loan_construction_draws WHERE loan_id = ?`).get(opts.loan_id) as any).c || 0;
    const id = uuid();
    dbi.prepare(`INSERT INTO loan_construction_draws (id, company_id, loan_id, draw_number, request_date, requested_amount, pct_complete, inspector_name, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`)
      .run(id, cid, opts.loan_id, drawCount + 1, today(), opts.requested_amount, opts.pct_complete || null, opts.inspector_name || null, opts.notes || null);
    return { id, draw_number: drawCount + 1 };
  } catch (e: any) { return { error: e.message }; }
}

// F1036: Bridge loan calculator (short-term, high-rate, balloon payoff)
export function bridgeLoanCalculator(opts: { loan_amount: number; rate_pct: number; term_months: number; origination_fee_pct?: number; exit_fee_pct?: number }) {
  try {
    const monthlyInterest = opts.loan_amount * (opts.rate_pct / 100) / 12;
    const totalInterest = monthlyInterest * opts.term_months;
    const origFee = opts.loan_amount * ((opts.origination_fee_pct || 1) / 100);
    const exitFee = opts.loan_amount * ((opts.exit_fee_pct || 1) / 100);
    const netProceeds = opts.loan_amount - origFee;
    const totalCost = totalInterest + origFee + exitFee;
    const effectiveAprPct = round2((totalCost / netProceeds) / (opts.term_months / 12) * 100);
    return {
      loan_amount: round2(opts.loan_amount),
      monthly_interest_only_payment: round2(monthlyInterest),
      balloon_payoff_at_end: round2(opts.loan_amount + exitFee),
      total_interest: round2(totalInterest),
      origination_fee: round2(origFee),
      exit_fee: round2(exitFee),
      total_cost: round2(totalCost),
      net_proceeds: round2(netProceeds),
      effective_apr_pct: effectiveAprPct,
    };
  } catch (e: any) { return { error: e.message }; }
}

// F1037: Equipment lease classification (operating vs capital per ASC 842)
export function classifyLease(opts: { lease_term_months: number; economic_life_months: number; pv_lease_payments: number; asset_fmv: number; bargain_purchase_option: boolean; transfers_title: boolean; specialized_asset?: boolean }) {
  try {
    // Five tests under ASC 842 — ANY one = finance lease
    const test1_title = opts.transfers_title;
    const test2_bpo = opts.bargain_purchase_option;
    const test3_term = opts.lease_term_months >= (opts.economic_life_months * 0.75);  // ≥75% of life
    const test4_pv = opts.pv_lease_payments >= (opts.asset_fmv * 0.90);                // ≥90% of FMV
    const test5_specialized = opts.specialized_asset === true;
    const failsAny = test1_title || test2_bpo || test3_term || test4_pv || test5_specialized;
    return {
      classification: failsAny ? 'finance_lease' : 'operating_lease',
      test_results: {
        title_transfer: test1_title,
        bargain_purchase_option: test2_bpo,
        term_75pct_of_life: test3_term,
        pv_90pct_of_fmv: test4_pv,
        specialized_asset: test5_specialized,
      },
      rou_asset_value: round2(opts.pv_lease_payments),
      lease_liability: round2(opts.pv_lease_payments),
      note: failsAny ? 'Finance lease: capitalize ROU asset + liability, depreciate' : 'Operating lease: capitalize ROU asset + liability, expense rent on straight-line basis',
    };
  } catch (e: any) { return { error: e.message }; }
}

// F1038: Sale-leaseback structure analysis
export function saleLeasebackAnalysis(opts: { asset_book_value: number; sale_price: number; new_lease_payment_monthly: number; lease_term_months: number; tax_rate_pct?: number }) {
  try {
    const gain = opts.sale_price - opts.asset_book_value;
    const taxOnGain = Math.max(0, gain) * ((opts.tax_rate_pct || 21) / 100);
    const netCashFromSale = opts.sale_price - taxOnGain;
    const totalLeasePayments = opts.new_lease_payment_monthly * opts.lease_term_months;
    return {
      sale_price: round2(opts.sale_price),
      gain_on_sale: round2(gain),
      tax_on_gain: round2(taxOnGain),
      net_cash_from_sale: round2(netCashFromSale),
      total_lease_payments: round2(totalLeasePayments),
      net_economic_impact: round2(netCashFromSale - totalLeasePayments),
    };
  } catch (e: any) { return { error: e.message }; }
}

// F1039: Factoring analysis (sell receivables for cash today)
export function factoringAnalysis(opts: { invoice_amount: number; advance_rate_pct?: number; factor_fee_pct?: number; days_outstanding: number }) {
  try {
    const advanceRate = (opts.advance_rate_pct || 80) / 100;
    const factorFee = (opts.factor_fee_pct || 3) / 100;
    const advance = opts.invoice_amount * advanceRate;
    const fee = opts.invoice_amount * factorFee;
    const reserveHeld = opts.invoice_amount - advance;
    const netToFactor = reserveHeld - fee;
    const annualizedCost = (factorFee / (opts.days_outstanding / 365)) * 100;
    return {
      invoice_amount: round2(opts.invoice_amount),
      advance_today: round2(advance),
      factor_fee: round2(fee),
      reserve_held: round2(reserveHeld),
      net_after_collection: round2(netToFactor),
      annualized_cost_pct: round2(annualizedCost),
    };
  } catch (e: any) { return { error: e.message }; }
}

// F1040: Merchant Cash Advance (MCA) — factor rate, not interest rate
export function mcaAnalysis(opts: { advance_amount: number; factor_rate: number; holdback_pct: number; estimated_daily_revenue: number }) {
  try {
    const totalPayback = opts.advance_amount * opts.factor_rate;
    const dailyPayment = opts.estimated_daily_revenue * (opts.holdback_pct / 100);
    const daysToRepay = totalPayback / dailyPayment;
    const monthsToRepay = round2(daysToRepay / 30);
    const annualizedApr = round2(((opts.factor_rate - 1) / (daysToRepay / 365)) * 100);
    return {
      advance_amount: round2(opts.advance_amount),
      factor_rate: opts.factor_rate,
      total_payback: round2(totalPayback),
      daily_payment: round2(dailyPayment),
      months_to_repay: monthsToRepay,
      annualized_apr_pct: annualizedApr,
      warning: annualizedApr > 50 ? 'High effective APR — consider alternatives' : null,
    };
  } catch (e: any) { return { error: e.message }; }
}

// F1041: IRS AFR (Applicable Federal Rate) lookup — minimum rate for family loans
export function getCurrentAfr(termCategory: 'short' | 'mid' | 'long') {
  // 2024 AFR rates (approximate, illustrative — should be updated monthly from IRS Rev. Rul.)
  const rates = { short: 4.50, mid: 4.25, long: 4.50 };
  return {
    term_category: termCategory,
    afr_pct: rates[termCategory],
    short_term_definition: 'up to 3 years',
    mid_term_definition: '3-9 years',
    long_term_definition: 'over 9 years',
    note: 'Use the applicable AFR as the minimum interest rate to avoid imputed interest income recognition. Updated monthly by the IRS — verify with current Rev. Rul.',
  };
}

// F1042: Letter of credit tracking
export function trackLetterOfCredit(opts: { issuer_bank: string; beneficiary: string; face_amount: number; expiry_date: string; fee_pct?: number; purpose?: string }) {
  // Simplified — would store in a dedicated table if extended
  return {
    issuer_bank: opts.issuer_bank,
    beneficiary: opts.beneficiary,
    face_amount: round2(opts.face_amount),
    expiry_date: opts.expiry_date,
    annual_fee: round2(opts.face_amount * ((opts.fee_pct || 1) / 100)),
    contingent_liability: round2(opts.face_amount),
    note: 'Letter of credit is an off-balance-sheet contingent liability until drawn',
  };
}

// ════════════════════════════════════════════════════════════════════
// Batch LL: Portfolio analytics (F1043-F1052)
// ════════════════════════════════════════════════════════════════════

// F1043: Loan portfolio aging — buckets by days past due
export function portfolioAging() {
  try {
    const todayD = new Date(today() + 'T00:00:00Z').getTime();
    const loans = db.getDb().prepare(`SELECT id, name, current_balance, next_payment_due, status FROM loans WHERE company_id = ? AND status = 'active' AND deleted_at IS NULL`).all(db.getCurrentCompanyId()) as any[];
    const buckets = { current: 0, b30: 0, b60: 0, b90: 0, b90plus: 0 };
    for (const l of loans) {
      const balance = l.current_balance || 0;
      if (!l.next_payment_due) { buckets.current += balance; continue; }
      const daysOver = Math.floor((todayD - new Date(l.next_payment_due + 'T00:00:00Z').getTime()) / 86400000);
      if (daysOver <= 0) buckets.current += balance;
      else if (daysOver <= 30) buckets.b30 += balance;
      else if (daysOver <= 60) buckets.b60 += balance;
      else if (daysOver <= 90) buckets.b90 += balance;
      else buckets.b90plus += balance;
    }
    return Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, round2(v as number)]));
  } catch (e: any) { return { error: e.message }; }
}

// F1044: Vintage analysis — loans grouped by origination year
export function vintageAnalysis() {
  try {
    return db.getDb().prepare(`SELECT substr(origination_date, 1, 4) vintage_year, COUNT(*) loan_count, SUM(principal) total_originated, SUM(current_balance) total_outstanding, SUM(total_principal_paid) total_repaid, AVG(interest_rate) * 100 avg_rate_pct FROM loans WHERE company_id = ? AND deleted_at IS NULL GROUP BY vintage_year ORDER BY vintage_year DESC`)
      .all(db.getCurrentCompanyId());
  } catch (e: any) { return []; }
}

// F1045: Concentration risk — exposure by borrower / type
export function concentrationRisk() {
  try {
    const cid = db.getCurrentCompanyId();
    const byType = db.getDb().prepare(`SELECT loan_type, COUNT(*) c, SUM(current_balance) exposure FROM loans WHERE company_id = ? AND deleted_at IS NULL AND status = 'active' GROUP BY loan_type ORDER BY exposure DESC`).all(cid);
    const totalExposure = (byType as any[]).reduce((s, r: any) => s + (r.exposure || 0), 0);
    const withPct = (byType as any[]).map((r: any) => ({ ...r, exposure: round2(r.exposure || 0), pct_of_portfolio: round2(((r.exposure || 0) / totalExposure) * 100) }));
    return { total_exposure: round2(totalExposure), by_type: withPct };
  } catch (e: any) { return { error: e.message }; }
}

// F1046: Net Interest Margin (NIM) — interest income vs interest expense
export function netInterestMargin(months = 12) {
  try {
    const cid = db.getCurrentCompanyId();
    // For a lender perspective: NIM = (interest earned - interest paid) / avg earning assets
    // For simplicity, use loan_payments interest as "earned" (if company holds loans as assets)
    // and bank interest expense as "paid"
    const earned = (db.getDb().prepare(`SELECT COALESCE(SUM(interest_amount), 0) e FROM loan_payments WHERE payment_date >= date('now', ?)`).get(`-${months} months`) as any).e || 0;
    const avgEarningAssets = (db.getDb().prepare(`SELECT COALESCE(AVG(current_balance), 0) a FROM loans WHERE company_id = ? AND deleted_at IS NULL`).get(cid) as any).a || 0;
    const annualizedRate = months > 0 ? (earned / months) * 12 : 0;
    const nim = avgEarningAssets > 0 ? (annualizedRate / avgEarningAssets) * 100 : null;
    return { interest_earned_period: round2(earned), avg_earning_assets: round2(avgEarningAssets), nim_pct: nim != null ? round2(nim) : null, period_months: months };
  } catch (e: any) { return { error: e.message }; }
}

// F1047: Loan yield — effective return per loan
export function loanYield(loanId: string) {
  try {
    const cid = db.getCurrentCompanyId();
    const loan = db.getDb().prepare('SELECT * FROM loans WHERE id = ? AND company_id = ?').get(loanId, cid) as any;
    if (!loan) return { error: 'Loan not found' };
    const totalInterestPaid = (db.getDb().prepare(`SELECT COALESCE(SUM(interest_amount), 0) i FROM loan_payments WHERE loan_id = ?`).get(loanId) as any).i || 0;
    const monthsActive = Math.max(1, Math.floor((Date.now() - new Date(loan.origination_date).getTime()) / (30 * 86400000)));
    const annualizedYield = (totalInterestPaid / monthsActive) * 12;
    const yieldPct = loan.principal > 0 ? (annualizedYield / loan.principal) * 100 : null;
    return { total_interest_paid: round2(totalInterestPaid), months_active: monthsActive, annualized_yield: round2(annualizedYield), yield_pct: yieldPct != null ? round2(yieldPct) : null };
  } catch (e: any) { return { error: e.message }; }
}

// F1048: Charge-off rate (% of portfolio charged off in last 12 months)
export function chargeOffRate() {
  try {
    const cid = db.getCurrentCompanyId();
    const charged = (db.getDb().prepare(`SELECT COALESCE(SUM(total_charged_off), 0) c FROM loan_charge_offs WHERE company_id = ? AND charge_off_date >= date('now', '-365 days')`).get(cid) as any).c || 0;
    const avgPortfolio = (db.getDb().prepare(`SELECT COALESCE(AVG(current_balance), 0) a FROM loans WHERE company_id = ? AND deleted_at IS NULL`).get(cid) as any).a || 0;
    const rate = avgPortfolio > 0 ? (charged / avgPortfolio) * 100 : null;
    return { charged_off_12mo: round2(charged), avg_portfolio: round2(avgPortfolio), charge_off_rate_pct: rate != null ? round2(rate) : null };
  } catch (e: any) { return { error: e.message }; }
}

// F1049: Recovery rate (% of charged-off amount recovered)
export function recoveryRate() {
  try {
    const cid = db.getCurrentCompanyId();
    const charged = (db.getDb().prepare(`SELECT COALESCE(SUM(total_charged_off), 0) c FROM loan_charge_offs WHERE company_id = ?`).get(cid) as any).c || 0;
    const recovered = (db.getDb().prepare(`SELECT COALESCE(SUM(recovery_amount), 0) r FROM loan_recoveries WHERE company_id = ?`).get(cid) as any).r || 0;
    const rate = charged > 0 ? (recovered / charged) * 100 : null;
    return { total_charged_off: round2(charged), total_recovered: round2(recovered), recovery_rate_pct: rate != null ? round2(rate) : null };
  } catch (e: any) { return { error: e.message }; }
}

// F1050: Delinquency rate by bucket
export function delinquencyRate() {
  try {
    const aging = portfolioAging() as any;
    if (aging.error) return aging;
    const total = (aging.current || 0) + (aging.b30 || 0) + (aging.b60 || 0) + (aging.b90 || 0) + (aging.b90plus || 0);
    const delinquent = total - (aging.current || 0);
    return {
      total_portfolio: round2(total),
      delinquent_balance: round2(delinquent),
      delinquency_rate_pct: total > 0 ? round2((delinquent / total) * 100) : 0,
      by_bucket_pct: total > 0 ? {
        current: round2(((aging.current || 0) / total) * 100),
        '30d': round2(((aging.b30 || 0) / total) * 100),
        '60d': round2(((aging.b60 || 0) / total) * 100),
        '90d': round2(((aging.b90 || 0) / total) * 100),
        '90d+': round2(((aging.b90plus || 0) / total) * 100),
      } : null,
    };
  } catch (e: any) { return { error: e.message }; }
}

// F1051: Stress test entire portfolio (rate shock + default scenario)
export function portfolioStressTest(opts: { rate_shock_pct: number; default_rate_increase_pct: number }) {
  try {
    const cid = db.getCurrentCompanyId();
    const loans = db.getDb().prepare(`SELECT id, name, principal, current_balance, interest_rate, payment_amount, term_months FROM loans WHERE company_id = ? AND status = 'active' AND deleted_at IS NULL`).all(cid) as any[];
    let totalPmtIncrease = 0;
    let expectedAdditionalLosses = 0;
    const stressed: any[] = [];
    for (const l of loans) {
      const shockedRate = ((l.interest_rate || 0) * 100 + opts.rate_shock_pct) / 100;
      const monthlyShockRate = shockedRate / 12;
      const remainingMonths = Math.max(1, (l.term_months || 360));
      const shockedPmt = monthlyShockRate === 0
        ? l.current_balance / remainingMonths
        : l.current_balance * monthlyShockRate * Math.pow(1 + monthlyShockRate, remainingMonths) / (Math.pow(1 + monthlyShockRate, remainingMonths) - 1);
      const pmtDelta = shockedPmt - (l.payment_amount || 0);
      totalPmtIncrease += pmtDelta;
      // Increased default probability → expected additional losses
      const additionalLossPct = opts.default_rate_increase_pct / 100;
      expectedAdditionalLosses += (l.current_balance || 0) * additionalLossPct * 0.40;  // 40% LGD assumed
      stressed.push({ loan_id: l.id, name: l.name, current_pmt: round2(l.payment_amount), shocked_pmt: round2(shockedPmt), delta: round2(pmtDelta) });
    }
    return {
      rate_shock_pct: opts.rate_shock_pct,
      default_rate_increase_pct: opts.default_rate_increase_pct,
      total_monthly_payment_increase: round2(totalPmtIncrease),
      annualized_payment_increase: round2(totalPmtIncrease * 12),
      expected_additional_losses: round2(expectedAdditionalLosses),
      stressed_loans: stressed,
    };
  } catch (e: any) { return { error: e.message }; }
}

// F1052: Required regulatory reserves (simplified)
export function requiredReserves() {
  try {
    const cecl = portfolioLossReserve() as any;
    if (cecl.error) return cecl;
    // Add stress reserve (typically 10% of CECL)
    const stressReserve = round2(cecl.total_reserve_required * 0.10);
    // Add unallocated reserve (general buffer)
    const unallocated = round2(cecl.total_exposure * 0.0025);  // 25bp of portfolio
    const total = round2(cecl.total_reserve_required + stressReserve + unallocated);
    return {
      cecl_required: cecl.total_reserve_required,
      stress_buffer: stressReserve,
      unallocated_buffer: unallocated,
      total_reserves_required: total,
      total_exposure: cecl.total_exposure,
      reserve_pct_of_portfolio: cecl.total_exposure > 0 ? round2((total / cecl.total_exposure) * 100) : 0,
    };
  } catch (e: any) { return { error: e.message }; }
}
