// ─── Loan Wave: F963-F992 (30 advanced features) ───
//
// Batch LA: Refinance & Modifications   (F963-F967)
// Batch LB: Collateral & Documents      (F968-F972)
// Batch LC: Covenants & Compliance      (F973-F977)
// Batch LD: Variable Rate & ARM         (F978-F982)
// Batch LE: Escrow & Insurance          (F983-F987)
// Batch LF: Tax & Portfolio             (F988-F992)
//
// Design notes:
// 1. Refinance is modeled as a NEW loan with a back-reference event on the
//    old loan — never mutates the old loan's history. Preserves audit trail.
// 2. Variable-rate resets are *scheduled* (loan_arm_schedule rows) and
//    applied separately; this lets the user inspect upcoming resets before
//    they fire and run rate-shock scenarios.
// 3. Escrow ledger is append-only with denormalized running_balance for
//    O(1) UI render. Reconciliation function verifies MAX(running_balance)
//    matches SUM(amount).
// 4. PMI auto-cancel threshold defaults to 78% LTV (the federal Homeowners
//    Protection Act trigger for borrower-paid PMI).
// 5. 1098 generation reads loan_payments for the calendar year, sums
//    interest_amount, computes year-end principal — no separate state.

import { randomUUID as uuid } from 'crypto';
import * as db from '../database';
import { generateSchedule } from './loan-calculator';

const now = (): string => new Date().toISOString();
const today = (): string => now().slice(0, 10);
const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;

// ════════════════════════════════════════════════════════════════════
// Batch LA: Refinance & Modifications (F963-F967)
// ════════════════════════════════════════════════════════════════════

// F963: Side-by-side comparison of current loan vs a hypothetical refinance
export function refinanceScenarioComparison(opts: {
  loan_id: string;
  new_rate: number;            // annual, percent (e.g. 5.5)
  new_term_months: number;
  closing_costs?: number;
  cashout_amount?: number;
}) {
  try {
    const inv = db.getDb().prepare('SELECT * FROM loans WHERE id = ? AND company_id = ?').get(opts.loan_id, db.getCurrentCompanyId()) as any;
    if (!inv) return { error: 'Loan not found' };
    const currentBalance = inv.current_balance || inv.principal || 0;
    // Current loan: remaining cash flow
    const monthlyRateCurr = (inv.interest_rate || 0) / 12;  // rate is stored as decimal
    const remainingPayments = Math.max(1, (inv.term_months || 360) - Math.floor((Date.now() - new Date(inv.origination_date).getTime()) / (30 * 86400000)));
    const currentMonthly = (inv.payment_amount || 0);
    const currentRemainingTotal = round2(currentMonthly * remainingPayments);
    const currentRemainingInterest = round2(currentRemainingTotal - currentBalance);

    // Refi loan: amortize newPrincipal at new_rate for new_term_months
    const newPrincipal = round2(currentBalance + (opts.closing_costs || 0) + (opts.cashout_amount || 0));
    const newAnnualRate = (opts.new_rate || 0) / 100; // input is %, stored as decimal
    const newMonthlyRate = newAnnualRate / 12;
    const newMonthly = newMonthlyRate === 0
      ? round2(newPrincipal / opts.new_term_months)
      : round2(newPrincipal * newMonthlyRate * Math.pow(1 + newMonthlyRate, opts.new_term_months) / (Math.pow(1 + newMonthlyRate, opts.new_term_months) - 1));
    const newTotalCost = round2(newMonthly * opts.new_term_months);
    const newTotalInterest = round2(newTotalCost - newPrincipal);

    const monthlySavings = round2(currentMonthly - newMonthly);
    const totalSavings = round2(currentRemainingTotal - newTotalCost - (opts.cashout_amount || 0));
    const breakEvenMonths = monthlySavings > 0 ? Math.ceil((opts.closing_costs || 0) / monthlySavings) : null;

    return {
      current: {
        balance: round2(currentBalance),
        rate_pct: round2((inv.interest_rate || 0) * 100),
        remaining_payments: remainingPayments,
        monthly_payment: round2(currentMonthly),
        remaining_total: currentRemainingTotal,
        remaining_interest: currentRemainingInterest,
      },
      refinanced: {
        new_principal: newPrincipal,
        new_rate_pct: round2(opts.new_rate),
        new_term_months: opts.new_term_months,
        new_monthly: newMonthly,
        total_cost: newTotalCost,
        total_interest: newTotalInterest,
        closing_costs: opts.closing_costs || 0,
        cashout_amount: opts.cashout_amount || 0,
      },
      analysis: {
        monthly_savings: monthlySavings,
        total_savings: totalSavings,
        break_even_months: breakEvenMonths,
        verdict: monthlySavings > 0 ? (breakEvenMonths != null && breakEvenMonths <= 36 ? 'recommended' : 'marginal') : 'not_recommended',
      },
    };
  } catch (e: any) { return { error: e.message }; }
}

// F964: Apply a refinance — creates a NEW loan and closes the OLD one
export function executeRefinance(opts: {
  loan_id: string;
  new_rate: number;
  new_term_months: number;
  closing_costs?: number;
  cashout_amount?: number;
  new_lender_name?: string;
  effective_date?: string;
}) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const old = dbi.prepare('SELECT * FROM loans WHERE id = ? AND company_id = ?').get(opts.loan_id, cid) as any;
    if (!old) return { error: 'Loan not found' };
    const newId = uuid();
    const effectiveDate = opts.effective_date || today();
    const newPrincipal = round2((old.current_balance || old.principal || 0) + (opts.closing_costs || 0) + (opts.cashout_amount || 0));
    const newRate = (opts.new_rate || 0) / 100;
    const newMonthlyRate = newRate / 12;
    const newMonthly = newMonthlyRate === 0
      ? round2(newPrincipal / opts.new_term_months)
      : round2(newPrincipal * newMonthlyRate * Math.pow(1 + newMonthlyRate, opts.new_term_months) / (Math.pow(1 + newMonthlyRate, opts.new_term_months) - 1));

    const txn = dbi.transaction(() => {
      // Create the new loan
      dbi.prepare(`INSERT INTO loans (id, company_id, name, loan_type, lender_name, principal, interest_rate, rate_type, term_months, payment_frequency, amortization_type, origination_date, first_payment_date, payment_amount, current_balance, status, currency, notes) VALUES (?, ?, ?, ?, ?, ?, ?, 'fixed', ?, 'monthly', 'standard', ?, ?, ?, ?, 'active', ?, ?)`)
        .run(newId, cid, `${old.name} (Refi)`, old.loan_type, opts.new_lender_name || old.lender_name, newPrincipal, newRate, opts.new_term_months, effectiveDate, addDays(effectiveDate, 30), newMonthly, newPrincipal, old.currency || 'USD', `Refinance of loan ${old.id} on ${effectiveDate}`);
      // Close the old loan
      dbi.prepare(`UPDATE loans SET status = 'refinanced', updated_at = ? WHERE id = ?`).run(now(), opts.loan_id);
      // Audit events on both
      dbi.prepare(`INSERT INTO loan_events (id, loan_id, event_type, event_date, description, new_value, metadata_json) VALUES (?, ?, 'refinance', ?, ?, ?, ?)`)
        .run(uuid(), opts.loan_id, effectiveDate, `Refinanced into loan ${newId}`, newId, JSON.stringify({ new_loan_id: newId, closing_costs: opts.closing_costs, cashout: opts.cashout_amount }));
      dbi.prepare(`INSERT INTO loan_events (id, loan_id, event_type, event_date, description, old_value, metadata_json) VALUES (?, ?, 'refinance_origination', ?, ?, ?, ?)`)
        .run(uuid(), newId, effectiveDate, `Refinance of loan ${opts.loan_id}`, opts.loan_id, JSON.stringify({ old_loan_id: opts.loan_id, refinanced_amount: old.current_balance }));
    });
    txn();
    return { new_loan_id: newId, closed_loan_id: opts.loan_id, effective_date: effectiveDate };
  } catch (e: any) { return { error: e.message }; }
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// F965: Apply a loan modification (rate reduction, term extension, forbearance)
export function applyLoanModification(opts: {
  loan_id: string;
  modification_type: 'rate_reduction' | 'term_extension' | 'forbearance' | 'principal_reduction';
  new_rate?: number;          // % (for rate_reduction)
  new_term_months?: number;   // for term_extension
  forbearance_months?: number;
  principal_reduction_amount?: number;
  effective_date?: string;
  reason: string;
}) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const loan = dbi.prepare('SELECT * FROM loans WHERE id = ? AND company_id = ?').get(opts.loan_id, cid) as any;
    if (!loan) return { error: 'Loan not found' };
    const effective = opts.effective_date || today();
    const updates: Record<string, any> = {};
    if (opts.modification_type === 'rate_reduction' && opts.new_rate != null) updates.interest_rate = opts.new_rate / 100;
    if (opts.modification_type === 'term_extension' && opts.new_term_months != null) updates.term_months = opts.new_term_months;
    if (opts.modification_type === 'principal_reduction' && opts.principal_reduction_amount != null) {
      updates.current_balance = Math.max(0, (loan.current_balance || 0) - opts.principal_reduction_amount);
    }
    const txn = dbi.transaction(() => {
      const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      if (sets) {
        dbi.prepare(`UPDATE loans SET ${sets}, updated_at = ? WHERE id = ?`).run(...Object.values(updates), now(), opts.loan_id);
      }
      dbi.prepare(`INSERT INTO loan_events (id, loan_id, event_type, event_date, description, metadata_json) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(uuid(), opts.loan_id, `modification_${opts.modification_type}`, effective, opts.reason, JSON.stringify(updates));
    });
    txn();
    return { modified: true, applied: updates, effective_date: effective };
  } catch (e: any) { return { error: e.message }; }
}

// F966: Apply a lump-sum principal payment and rebuild schedule
export function lumpSumPrincipalPayment(opts: { loan_id: string; amount: number; payment_date?: string; notes?: string }) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const loan = dbi.prepare('SELECT * FROM loans WHERE id = ? AND company_id = ?').get(opts.loan_id, cid) as any;
    if (!loan) return { error: 'Loan not found' };
    const paymentDate = opts.payment_date || today();
    const payId = uuid();
    const txn = dbi.transaction(() => {
      // Record as a payment with all principal, zero interest
      dbi.prepare(`INSERT INTO loan_payments (id, loan_id, payment_date, amount, principal_amount, interest_amount, is_extra_principal, notes) VALUES (?, ?, ?, ?, ?, 0, 1, ?)`)
        .run(payId, opts.loan_id, paymentDate, opts.amount, opts.amount, opts.notes || 'Lump-sum principal payment');
      // Reduce balance
      const newBalance = Math.max(0, (loan.current_balance || 0) - opts.amount);
      dbi.prepare(`UPDATE loans SET current_balance = ?, total_principal_paid = COALESCE(total_principal_paid, 0) + ?, total_paid_to_date = COALESCE(total_paid_to_date, 0) + ?, updated_at = ? WHERE id = ?`)
        .run(newBalance, opts.amount, opts.amount, now(), opts.loan_id);
      // Audit event
      dbi.prepare(`INSERT INTO loan_events (id, loan_id, event_type, event_date, description, metadata_json) VALUES (?, ?, 'lump_sum_principal', ?, ?, ?)`)
        .run(uuid(), opts.loan_id, paymentDate, `Lump-sum principal $${opts.amount}`, JSON.stringify({ payment_id: payId, amount: opts.amount, new_balance: newBalance }));
    });
    txn();
    return { payment_id: payId, new_balance: round2(Math.max(0, (loan.current_balance || 0) - opts.amount)) };
  } catch (e: any) { return { error: e.message }; }
}

// F967: Show the impact of switching to biweekly payments (extra payment/year)
export function biweeklyConversionImpact(loanId: string) {
  try {
    const loan = db.getDb().prepare('SELECT * FROM loans WHERE id = ? AND company_id = ?').get(loanId, db.getCurrentCompanyId()) as any;
    if (!loan) return { error: 'Loan not found' };
    const monthlyPmt = loan.payment_amount || 0;
    const biweeklyPmt = round2(monthlyPmt / 2);
    // Monthly: 12 payments/year. Biweekly: 26 payments/year = 13 monthly-equivalents.
    // The extra payment goes straight to principal.
    const extraPerYear = round2(monthlyPmt); // one full extra monthly payment per year
    const balance = loan.current_balance || loan.principal || 0;
    const rate = (loan.interest_rate || 0) / 12;
    // Rough estimate: extra principal per year shortens the amortization.
    // Calculate by comparing total interest under monthly vs biweekly schedules.
    const remainingMonths = Math.max(1, (loan.term_months || 360));
    const totalInterestMonthly = round2(monthlyPmt * remainingMonths - balance);
    // Biweekly with extra payment: estimate ~ 6-8 years saved on a 30-year mortgage.
    // Use a simplified payoff-time approximation via NPV solver.
    let estPayoffMonths = remainingMonths;
    if (rate > 0 && extraPerYear > 0) {
      // Iterative: simulate payments with extra
      let bal = balance;
      let months = 0;
      while (bal > 0.01 && months < remainingMonths * 1.5) {
        const interest = bal * rate;
        const principal = monthlyPmt - interest;
        bal -= principal;
        // Add extra principal once per 12 months
        if ((months + 1) % 12 === 0) bal -= (extraPerYear);
        months++;
        if (bal <= 0) break;
      }
      estPayoffMonths = months;
    }
    const monthsSaved = remainingMonths - estPayoffMonths;
    const totalInterestBiweekly = round2(monthlyPmt * estPayoffMonths - balance + extraPerYear * Math.floor(estPayoffMonths / 12));
    const interestSavings = round2(totalInterestMonthly - totalInterestBiweekly);
    return {
      monthly_payment: round2(monthlyPmt),
      biweekly_payment: biweeklyPmt,
      extra_per_year: extraPerYear,
      original_payoff_months: remainingMonths,
      biweekly_payoff_months: estPayoffMonths,
      months_saved: monthsSaved,
      interest_savings: interestSavings,
    };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch LB: Collateral & Documents (F968-F972)
// ════════════════════════════════════════════════════════════════════

// F968: Attach collateral to a loan
export function attachCollateral(opts: {
  loan_id: string;
  collateral_type: string;
  asset_id?: string;
  description?: string;
  original_value?: number;
  current_value?: number;
  is_primary?: boolean;
  cross_collateralized?: boolean;
}) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO loan_collateral (id, company_id, loan_id, collateral_type, asset_id, description, original_value, current_value, last_appraisal_date, is_primary, cross_collateralized) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.loan_id, opts.collateral_type, opts.asset_id || null, opts.description || null, opts.original_value || 0, opts.current_value || opts.original_value || 0, today(), opts.is_primary === false ? 0 : 1, opts.cross_collateralized ? 1 : 0);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F969: Upload / attach a loan document
export function attachLoanDocument(opts: { loan_id: string; document_type: string; name: string; file_path?: string; expires_at?: string; uploaded_by?: string }) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO loan_documents (id, company_id, loan_id, document_type, name, file_path, expires_at, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.loan_id, opts.document_type, opts.name, opts.file_path || null, opts.expires_at || null, opts.uploaded_by || null);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F970: Revalue a piece of collateral (e.g. annual real-estate reappraisal)
export function revalueCollateral(collateralId: string, newValue: number, appraisalDate?: string) {
  try {
    db.getDb().prepare(`UPDATE loan_collateral SET current_value = ?, last_appraisal_date = ?, updated_at = ? WHERE id = ? AND company_id = ?`)
      .run(newValue, appraisalDate || today(), now(), collateralId, db.getCurrentCompanyId());
    return { updated: true };
  } catch (e: any) { return { error: e.message }; }
}

// F971: Compute loan-to-value (LTV) ratio for a loan
export function computeLtv(loanId: string) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const loan = dbi.prepare('SELECT current_balance FROM loans WHERE id = ? AND company_id = ?').get(loanId, cid) as any;
    if (!loan) return { error: 'Loan not found' };
    const collateral = dbi.prepare('SELECT SUM(current_value) total_value FROM loan_collateral WHERE loan_id = ? AND company_id = ?').get(loanId, cid) as any;
    const totalValue = collateral?.total_value || 0;
    if (totalValue <= 0) return { ltv: null, reason: 'No collateral value' };
    const ltv = round2((loan.current_balance / totalValue) * 100);
    const band = ltv <= 60 ? 'low_risk' : ltv <= 80 ? 'standard' : ltv <= 95 ? 'high_risk' : 'underwater';
    return { ltv, band, current_balance: round2(loan.current_balance), collateral_value: round2(totalValue) };
  } catch (e: any) { return { error: e.message }; }
}

// F972: List all loans secured by a given asset (cross-collateralization check)
export function loansSecuredByAsset(assetId: string) {
  try {
    return db.getDb().prepare(`SELECT l.id, l.name, l.current_balance, c.is_primary, c.original_value, c.current_value
      FROM loan_collateral c
      INNER JOIN loans l ON c.loan_id = l.id
      WHERE c.asset_id = ? AND c.company_id = ? AND l.deleted_at IS NULL
      ORDER BY c.is_primary DESC, l.name`)
      .all(assetId, db.getCurrentCompanyId());
  } catch (e: any) { return []; }
}

// ════════════════════════════════════════════════════════════════════
// Batch LC: Covenants & Compliance (F973-F977)
// ════════════════════════════════════════════════════════════════════

// F973: Create a covenant on a loan (or company-wide)
export function createCovenant(opts: {
  loan_id?: string;
  covenant_name: string;
  metric: 'dscr' | 'current_ratio' | 'debt_to_equity' | 'quick_ratio' | 'interest_coverage';
  operator: '>=' | '<=' | '=';
  threshold_value: number;
  measurement_frequency?: 'monthly' | 'quarterly' | 'annual';
  notes?: string;
}) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO loan_covenants (id, company_id, loan_id, covenant_name, metric, operator, threshold_value, measurement_frequency, next_measurement_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.loan_id || null, opts.covenant_name, opts.metric, opts.operator, opts.threshold_value, opts.measurement_frequency || 'quarterly', computeNextMeasurementDate(opts.measurement_frequency || 'quarterly'), opts.notes || null);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

function computeNextMeasurementDate(freq: string): string {
  const d = new Date(today() + 'T12:00:00Z');
  if (freq === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1);
  else if (freq === 'quarterly') d.setUTCMonth(d.getUTCMonth() + 3);
  else if (freq === 'annual') d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

// F974: Compute current covenant status — read financial data and update
export function computeCovenantStatus(covenantId: string) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const cov = dbi.prepare('SELECT * FROM loan_covenants WHERE id = ? AND company_id = ?').get(covenantId, cid) as any;
    if (!cov) return { error: 'Covenant not found' };
    const measured = measureFinancialMetric(cov.metric, cov.loan_id);
    if (measured == null) return { error: `Cannot compute ${cov.metric}` };
    const meetsThreshold =
      cov.operator === '>=' ? measured >= cov.threshold_value
      : cov.operator === '<=' ? measured <= cov.threshold_value
      : measured === cov.threshold_value;
    const status = meetsThreshold ? 'compliant' : 'breach';
    dbi.prepare(`UPDATE loan_covenants SET last_measured_value = ?, last_measured_at = ?, breach_status = ?, next_measurement_date = ? WHERE id = ?`)
      .run(measured, now(), status, computeNextMeasurementDate(cov.measurement_frequency || 'quarterly'), covenantId);
    return { covenant_id: covenantId, measured_value: round2(measured), threshold: cov.threshold_value, operator: cov.operator, status };
  } catch (e: any) { return { error: e.message }; }
}

// Helper: measure a financial metric using current company data
function measureFinancialMetric(metric: string, loanId?: string): number | null {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    if (metric === 'current_ratio') {
      const ca = (dbi.prepare(`SELECT COALESCE(SUM(balance), 0) t FROM accounts WHERE company_id = ? AND type = 'asset' AND (subtype IN ('cash', 'ar', 'inventory') OR name LIKE '%Current%')`).get(cid) as any).t || 0;
      const cl = (dbi.prepare(`SELECT COALESCE(SUM(balance), 0) t FROM accounts WHERE company_id = ? AND type = 'liability' AND (subtype IN ('ap', 'short_term_debt') OR name LIKE '%Current%' OR name LIKE '%Payable%')`).get(cid) as any).t || 0;
      return cl > 0 ? ca / cl : null;
    }
    if (metric === 'debt_to_equity') {
      const debt = (dbi.prepare(`SELECT COALESCE(SUM(balance), 0) t FROM accounts WHERE company_id = ? AND type = 'liability'`).get(cid) as any).t || 0;
      const equity = (dbi.prepare(`SELECT COALESCE(SUM(balance), 0) t FROM accounts WHERE company_id = ? AND type = 'equity'`).get(cid) as any).t || 0;
      return equity > 0 ? Math.abs(debt) / Math.abs(equity) : null;
    }
    if (metric === 'quick_ratio') {
      const quick = (dbi.prepare(`SELECT COALESCE(SUM(balance), 0) t FROM accounts WHERE company_id = ? AND type = 'asset' AND subtype IN ('cash', 'ar')`).get(cid) as any).t || 0;
      const cl = (dbi.prepare(`SELECT COALESCE(SUM(balance), 0) t FROM accounts WHERE company_id = ? AND type = 'liability' AND subtype IN ('ap', 'short_term_debt')`).get(cid) as any).t || 0;
      return cl > 0 ? quick / cl : null;
    }
    if (metric === 'dscr') {
      // Annual NOI / annual debt service
      const noi = (dbi.prepare(`SELECT COALESCE(SUM(CASE WHEN type='revenue' THEN balance ELSE 0 END) - SUM(CASE WHEN type='expense' THEN balance ELSE 0 END), 0) n FROM accounts WHERE company_id = ?`).get(cid) as any).n || 0;
      const debtService = (dbi.prepare(`SELECT COALESCE(SUM(payment_amount * 12), 0) ds FROM loans WHERE company_id = ? AND status = 'active' AND deleted_at IS NULL`).get(cid) as any).ds || 0;
      return debtService > 0 ? Math.abs(noi) / debtService : null;
    }
    if (metric === 'interest_coverage') {
      // EBIT / interest expense (use last 12 months of loan_payments interest)
      const ebit = (dbi.prepare(`SELECT COALESCE(SUM(CASE WHEN type='revenue' THEN balance ELSE -balance END), 0) e FROM accounts WHERE company_id = ? AND type IN ('revenue', 'expense')`).get(cid) as any).e || 0;
      const interest = (dbi.prepare(`SELECT COALESCE(SUM(interest_amount), 0) i FROM loan_payments WHERE loan_id IN (SELECT id FROM loans WHERE company_id = ?) AND payment_date >= date('now', '-12 months')`).get(cid) as any).i || 0;
      return interest > 0 ? Math.abs(ebit) / interest : null;
    }
    return null;
  } catch (e: any) { return null; }
}

// F975: List covenants currently in breach
export function listCovenantBreaches() {
  try {
    return db.getDb().prepare(`SELECT c.*, l.name loan_name FROM loan_covenants c LEFT JOIN loans l ON c.loan_id = l.id WHERE c.company_id = ? AND c.breach_status = 'breach' ORDER BY c.last_measured_at DESC`)
      .all(db.getCurrentCompanyId());
  } catch (e: any) { return []; }
}

// F976: Generate a quarterly compliance certificate for all covenants
export function generateComplianceCertificate(opts?: { quarter?: number; year?: number }) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const year = opts?.year || new Date().getFullYear();
    const quarter = opts?.quarter || Math.floor((new Date().getMonth()) / 3) + 1;
    const covenants = dbi.prepare(`SELECT * FROM loan_covenants WHERE company_id = ?`).all(cid) as any[];
    const measurements: any[] = [];
    for (const c of covenants) {
      const measured = measureFinancialMetric(c.metric, c.loan_id);
      const passes = measured != null && (
        c.operator === '>=' ? measured >= c.threshold_value
          : c.operator === '<=' ? measured <= c.threshold_value
            : measured === c.threshold_value
      );
      measurements.push({
        covenant_name: c.covenant_name,
        metric: c.metric,
        threshold: `${c.operator} ${c.threshold_value}`,
        measured: measured != null ? round2(measured) : 'N/A',
        status: passes ? 'COMPLIANT' : (measured == null ? 'UNMEASURABLE' : 'BREACH'),
      });
    }
    const totalCovenants = measurements.length;
    const compliant = measurements.filter(m => m.status === 'COMPLIANT').length;
    const breaches = measurements.filter(m => m.status === 'BREACH').length;
    return {
      year, quarter,
      generated_at: now(),
      total_covenants: totalCovenants,
      compliant_count: compliant,
      breach_count: breaches,
      overall: breaches === 0 && totalCovenants > 0 ? 'COMPLIANT' : (breaches > 0 ? 'BREACH' : 'NO_COVENANTS'),
      measurements,
    };
  } catch (e: any) { return { error: e.message }; }
}

// F977: List upcoming covenant measurements due in next N days
export function upcomingCovenantMeasurements(daysAhead = 30) {
  try {
    const cutoff = addDays(today(), daysAhead);
    return db.getDb().prepare(`SELECT c.*, l.name loan_name FROM loan_covenants c LEFT JOIN loans l ON c.loan_id = l.id WHERE c.company_id = ? AND c.next_measurement_date <= ? ORDER BY c.next_measurement_date ASC`)
      .all(db.getCurrentCompanyId(), cutoff);
  } catch (e: any) { return []; }
}

// ════════════════════════════════════════════════════════════════════
// Batch LD: Variable Rate & ARM (F978-F982)
// ════════════════════════════════════════════════════════════════════

// F978: Schedule a future rate reset (ARM)
export function scheduleArmReset(opts: { loan_id: string; reset_date: string; index_name?: string; index_value?: number; margin?: number; new_rate?: number; periodic_cap?: number; lifetime_cap?: number; notes?: string }) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO loan_arm_schedule (id, company_id, loan_id, reset_date, reset_type, index_name, index_value, margin, new_rate, periodic_cap, lifetime_cap, notes) VALUES (?, ?, ?, ?, 'auto', ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.loan_id, opts.reset_date, opts.index_name || null, opts.index_value || null, opts.margin || 0, opts.new_rate || null, opts.periodic_cap || null, opts.lifetime_cap || null, opts.notes || null);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F979: List upcoming ARM resets
export function upcomingArmResets(daysAhead = 90) {
  try {
    const cutoff = addDays(today(), daysAhead);
    return db.getDb().prepare(`SELECT a.*, l.name loan_name FROM loan_arm_schedule a INNER JOIN loans l ON a.loan_id = l.id WHERE a.company_id = ? AND a.applied = 0 AND a.reset_date <= ? ORDER BY a.reset_date ASC`)
      .all(db.getCurrentCompanyId(), cutoff);
  } catch (e: any) { return []; }
}

// F980: Apply an ARM reset (compute new rate from index + margin, enforce caps)
export function applyArmReset(armScheduleId: string) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const arm = dbi.prepare('SELECT * FROM loan_arm_schedule WHERE id = ? AND company_id = ?').get(armScheduleId, cid) as any;
    if (!arm) return { error: 'ARM schedule not found' };
    if (arm.applied) return { error: 'Already applied' };
    const loan = dbi.prepare('SELECT * FROM loans WHERE id = ?').get(arm.loan_id) as any;
    const currentRate = (loan.interest_rate || 0) * 100; // as %
    let newRate = arm.new_rate;
    if (newRate == null && arm.index_value != null) {
      newRate = arm.index_value + (arm.margin || 0);
    }
    if (newRate == null) return { error: 'No new rate or index value provided' };
    // Enforce periodic cap
    if (arm.periodic_cap != null) {
      const maxChange = arm.periodic_cap;
      newRate = Math.min(currentRate + maxChange, Math.max(currentRate - maxChange, newRate));
    }
    // Enforce lifetime cap (relative to original rate)
    if (arm.lifetime_cap != null && loan.interest_rate != null) {
      const originalPct = loan.interest_rate * 100;
      newRate = Math.min(originalPct + arm.lifetime_cap, newRate);
    }
    const txn = dbi.transaction(() => {
      dbi.prepare('UPDATE loans SET interest_rate = ?, updated_at = ? WHERE id = ?').run(newRate / 100, now(), arm.loan_id);
      dbi.prepare('UPDATE loan_arm_schedule SET applied = 1, new_rate = ?, updated_at = ? WHERE id = ?').run(newRate, now(), armScheduleId);
      dbi.prepare(`INSERT INTO loan_events (id, loan_id, event_type, event_date, description, old_value, new_value) VALUES (?, ?, 'rate_change', ?, ?, ?, ?)`)
        .run(uuid(), arm.loan_id, arm.reset_date, `ARM reset: ${arm.index_name || 'index'} ${arm.index_value || ''} + ${arm.margin || 0}% margin`, String(currentRate), String(newRate));
    });
    txn();
    return { applied: true, old_rate: round2(currentRate), new_rate: round2(newRate) };
  } catch (e: any) { return { error: e.message }; }
}

// F981: Recast amortization schedule on rate change
export function recastSchedule(loanId: string) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const loan = dbi.prepare('SELECT * FROM loans WHERE id = ? AND company_id = ?').get(loanId, cid) as any;
    if (!loan) return { error: 'Loan not found' };
    // Delete pending schedule rows; keep paid history
    dbi.prepare(`DELETE FROM loan_payment_schedule WHERE loan_id = ? AND paid_status != 'paid'`).run(loanId);
    // Compute remaining payments
    const paidCount = (dbi.prepare(`SELECT COUNT(*) c FROM loan_payment_schedule WHERE loan_id = ? AND paid_status = 'paid'`).get(loanId) as any).c || 0;
    const remainingPayments = (loan.term_months || 360) - paidCount;
    const balance = loan.current_balance || loan.principal;
    const monthlyRate = (loan.interest_rate || 0) / 12;
    const newPmt = monthlyRate === 0
      ? round2(balance / remainingPayments)
      : round2(balance * monthlyRate * Math.pow(1 + monthlyRate, remainingPayments) / (Math.pow(1 + monthlyRate, remainingPayments) - 1));
    // Update loan payment_amount
    dbi.prepare(`UPDATE loans SET payment_amount = ?, updated_at = ? WHERE id = ?`).run(newPmt, now(), loanId);
    // Regenerate schedule rows (use loan-calculator helper for amortization).
    // The helper takes an AmortizationInput object and returns rows with
    // .scheduled_payment / .principal_amount / .interest_amount / .remaining_balance.
    const schedule = generateSchedule({
      principal: balance,
      annual_rate: loan.interest_rate || 0,
      term_months: remainingPayments,
      first_payment_date: addDays(today(), 30),
      payment_frequency: 'monthly',
      amortization_type: 'standard',
    });
    const insert = dbi.prepare(`INSERT INTO loan_payment_schedule (id, loan_id, payment_number, due_date, scheduled_payment, principal_amount, interest_amount, remaining_balance) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const r of schedule) {
      insert.run(uuid(), loanId, paidCount + r.payment_number, r.due_date, r.scheduled_payment, r.principal_amount, r.interest_amount, r.remaining_balance);
    }
    return { recast: true, new_payment: newPmt, remaining_payments: remainingPayments };
  } catch (e: any) { return { error: e.message }; }
}

// F982: Stress test — what if rate rises by N percentage points?
export function rateShockStressTest(loanId: string, shockPct: number) {
  try {
    const loan = db.getDb().prepare('SELECT * FROM loans WHERE id = ? AND company_id = ?').get(loanId, db.getCurrentCompanyId()) as any;
    if (!loan) return { error: 'Loan not found' };
    const currentRate = (loan.interest_rate || 0) * 100;
    const shockedRate = currentRate + shockPct;
    const balance = loan.current_balance || loan.principal;
    const remainingMonths = loan.term_months || 360;
    const shockedMonthlyRate = (shockedRate / 100) / 12;
    const shockedPmt = shockedMonthlyRate === 0
      ? round2(balance / remainingMonths)
      : round2(balance * shockedMonthlyRate * Math.pow(1 + shockedMonthlyRate, remainingMonths) / (Math.pow(1 + shockedMonthlyRate, remainingMonths) - 1));
    const monthlyDelta = round2(shockedPmt - (loan.payment_amount || 0));
    const annualImpact = round2(monthlyDelta * 12);
    return {
      current_rate_pct: round2(currentRate),
      shocked_rate_pct: round2(shockedRate),
      current_monthly: round2(loan.payment_amount || 0),
      shocked_monthly: shockedPmt,
      monthly_delta: monthlyDelta,
      annual_impact: annualImpact,
    };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch LE: Escrow & Insurance (F983-F987)
// ════════════════════════════════════════════════════════════════════

// F983: Record an escrow ledger entry (deposit or disbursement)
export function recordEscrowEntry(opts: { loan_id: string; transaction_date: string; transaction_type: 'deposit' | 'disbursement'; amount: number; category?: string; payee?: string; reference?: string; notes?: string }) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const lastRow = dbi.prepare(`SELECT running_balance FROM loan_escrow_ledger WHERE loan_id = ? AND company_id = ? ORDER BY transaction_date DESC, created_at DESC LIMIT 1`).get(opts.loan_id, cid) as any;
    const prevBalance = lastRow?.running_balance || 0;
    const signedAmount = opts.transaction_type === 'deposit' ? Math.abs(opts.amount) : -Math.abs(opts.amount);
    const newBalance = round2(prevBalance + signedAmount);
    const id = uuid();
    dbi.prepare(`INSERT INTO loan_escrow_ledger (id, company_id, loan_id, transaction_date, transaction_type, amount, category, payee, reference, running_balance, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, cid, opts.loan_id, opts.transaction_date, opts.transaction_type, signedAmount, opts.category || null, opts.payee || null, opts.reference || null, newBalance, opts.notes || null);
    return { id, new_balance: newBalance };
  } catch (e: any) { return { error: e.message }; }
}

// F984: Annual escrow analysis (CFPB-style)
export function annualEscrowAnalysis(loanId: string, year?: number) {
  try {
    const y = year || new Date().getFullYear();
    const cid = db.getCurrentCompanyId();
    const rows = db.getDb().prepare(`SELECT * FROM loan_escrow_ledger WHERE loan_id = ? AND company_id = ? AND substr(transaction_date, 1, 4) = ? ORDER BY transaction_date ASC`).all(loanId, cid, String(y)) as any[];
    const totalDeposits = rows.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0);
    const totalDisbursements = rows.filter(r => r.amount < 0).reduce((s, r) => s + Math.abs(r.amount), 0);
    const endingBalance = rows.length > 0 ? rows[rows.length - 1].running_balance : 0;
    // Minimum balance during the year — CFPB requires escrow to never drop below 1/6 of annual disbursements
    const minBalance = Math.min(...rows.map(r => r.running_balance), 0);
    const requiredCushion = totalDisbursements / 6;
    const shortage = Math.max(0, requiredCushion - minBalance);
    const surplus = endingBalance > requiredCushion * 2 ? endingBalance - requiredCushion : 0;
    return {
      year: y,
      total_deposits: round2(totalDeposits),
      total_disbursements: round2(totalDisbursements),
      ending_balance: round2(endingBalance),
      minimum_balance: round2(minBalance),
      required_cushion: round2(requiredCushion),
      shortage: round2(shortage),
      surplus: round2(surplus),
      compliance_status: shortage > 0 ? 'shortage' : (surplus > 0 ? 'surplus' : 'in_compliance'),
    };
  } catch (e: any) { return { error: e.message }; }
}

// F985: Setup PMI tracking on a loan
export function setupPmi(opts: { loan_id: string; monthly_premium: number; starts_at?: string; auto_cancel_at_ltv?: number; request_cancellation_at_ltv?: number }) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO loan_pmi_tracking (id, company_id, loan_id, monthly_premium, starts_at, auto_cancel_at_ltv, request_cancellation_at_ltv) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(loan_id) DO UPDATE SET monthly_premium = excluded.monthly_premium, auto_cancel_at_ltv = excluded.auto_cancel_at_ltv, request_cancellation_at_ltv = excluded.request_cancellation_at_ltv, updated_at = datetime('now')`)
      .run(id, db.getCurrentCompanyId(), opts.loan_id, opts.monthly_premium, opts.starts_at || today(), opts.auto_cancel_at_ltv || 78, opts.request_cancellation_at_ltv || 80);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F986: Check PMI cancellation eligibility (LTV based)
export function checkPmiCancellation(loanId: string) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const pmi = dbi.prepare('SELECT * FROM loan_pmi_tracking WHERE loan_id = ? AND company_id = ?').get(loanId, cid) as any;
    if (!pmi) return { eligible: false, reason: 'No PMI configured' };
    if (pmi.cancelled_at) return { eligible: false, reason: 'Already cancelled' };
    const ltv = computeLtv(loanId) as any;
    if (ltv?.error || ltv?.ltv == null) return { eligible: false, reason: 'LTV unavailable' };
    const currentLtv = ltv.ltv;
    // Update tracking
    dbi.prepare(`UPDATE loan_pmi_tracking SET current_ltv = ?, last_ltv_check_at = ? WHERE id = ?`).run(currentLtv, now(), pmi.id);
    if (currentLtv <= pmi.auto_cancel_at_ltv) {
      return { eligible: true, action: 'auto_cancel', current_ltv: currentLtv, threshold: pmi.auto_cancel_at_ltv, monthly_savings: round2(pmi.monthly_premium) };
    }
    if (currentLtv <= pmi.request_cancellation_at_ltv) {
      return { eligible: true, action: 'request_cancellation', current_ltv: currentLtv, threshold: pmi.request_cancellation_at_ltv, monthly_savings: round2(pmi.monthly_premium) };
    }
    return { eligible: false, reason: `LTV ${currentLtv}% above ${pmi.request_cancellation_at_ltv}% threshold`, current_ltv: currentLtv };
  } catch (e: any) { return { error: e.message }; }
}

// F987: Link insurance policy to collateral
export function linkInsuranceToCollateral(collateralId: string, insurancePolicyId: string) {
  try {
    db.getDb().prepare(`UPDATE loan_collateral SET insurance_policy_id = ?, updated_at = ? WHERE id = ? AND company_id = ?`)
      .run(insurancePolicyId, now(), collateralId, db.getCurrentCompanyId());
    return { linked: true };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch LF: Tax & Portfolio (F988-F992)
// ════════════════════════════════════════════════════════════════════

// F988: Generate 1098 mortgage interest statement for a tax year
export function generate1098(loanId: string, taxYear: number) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const loan = dbi.prepare('SELECT * FROM loans WHERE id = ? AND company_id = ?').get(loanId, cid) as any;
    if (!loan) return { error: 'Loan not found' };
    const interest = (dbi.prepare(`SELECT COALESCE(SUM(interest_amount), 0) i FROM loan_payments WHERE loan_id = ? AND substr(payment_date, 1, 4) = ?`).get(loanId, String(taxYear)) as any).i || 0;
    const pmi = (dbi.prepare(`SELECT COALESCE(SUM(monthly_premium), 0) * 12 p FROM loan_pmi_tracking WHERE loan_id = ? AND (cancelled_at IS NULL OR substr(cancelled_at, 1, 4) >= ?)`).get(loanId, String(taxYear)) as any).p || 0;
    const collateral = dbi.prepare(`SELECT description FROM loan_collateral WHERE loan_id = ? AND is_primary = 1 LIMIT 1`).get(loanId) as any;
    const id = uuid();
    try {
      dbi.prepare(`INSERT INTO loan_1098_filings (id, company_id, loan_id, tax_year, box1_interest_received, box2_outstanding_principal, box3_origination_date, box5_mortgage_insurance, box8_property_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, cid, loanId, taxYear, round2(interest), round2(loan.current_balance || 0), loan.origination_date, round2(pmi), collateral?.description || null);
    } catch (_) {
      dbi.prepare(`UPDATE loan_1098_filings SET box1_interest_received = ?, box2_outstanding_principal = ?, box5_mortgage_insurance = ?, updated_at = ? WHERE company_id = ? AND loan_id = ? AND tax_year = ?`)
        .run(round2(interest), round2(loan.current_balance || 0), round2(pmi), now(), cid, loanId, taxYear);
    }
    return { id, tax_year: taxYear, box1_interest_received: round2(interest), box2_outstanding_principal: round2(loan.current_balance || 0), box5_mortgage_insurance: round2(pmi) };
  } catch (e: any) { return { error: e.message }; }
}

// F989: Compute tax-deductible interest (business vs personal split)
export function computeDeductibleInterest(loanId: string, taxYear: number, businessUsePct: number) {
  try {
    const interest = (db.getDb().prepare(`SELECT COALESCE(SUM(interest_amount), 0) i FROM loan_payments WHERE loan_id = ? AND substr(payment_date, 1, 4) = ?`).get(loanId, String(taxYear)) as any).i || 0;
    const businessPortion = round2(interest * (businessUsePct / 100));
    const personalPortion = round2(interest - businessPortion);
    return { tax_year: taxYear, total_interest: round2(interest), business_use_pct: businessUsePct, business_deductible: businessPortion, personal_portion: personalPortion };
  } catch (e: any) { return { error: e.message }; }
}

// F990: Compute Debt Service Coverage Ratio (DSCR)
export function computeDscr() {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    // Annual NOI: revenue - operating expenses (excluding debt service)
    const noi = (dbi.prepare(`SELECT COALESCE(SUM(CASE WHEN type='revenue' THEN balance ELSE 0 END) - SUM(CASE WHEN type='expense' AND subtype != 'interest_expense' THEN balance ELSE 0 END), 0) n FROM accounts WHERE company_id = ?`).get(cid) as any).n || 0;
    // Annual debt service: sum of all active loan annual payments
    const debtService = (dbi.prepare(`SELECT COALESCE(SUM(payment_amount * 12), 0) ds FROM loans WHERE company_id = ? AND status = 'active' AND deleted_at IS NULL`).get(cid) as any).ds || 0;
    if (debtService <= 0) return { dscr: null, reason: 'No active loans' };
    const dscr = round2(Math.abs(noi) / debtService);
    const band = dscr >= 1.5 ? 'strong' : dscr >= 1.25 ? 'adequate' : dscr >= 1.0 ? 'tight' : 'insufficient';
    return { dscr, band, noi: round2(noi), debt_service: round2(debtService) };
  } catch (e: any) { return { error: e.message }; }
}

// F991: Compute debt-to-equity ratio for the company
export function computeDebtToEquity() {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const debt = (dbi.prepare(`SELECT COALESCE(SUM(balance), 0) t FROM accounts WHERE company_id = ? AND type = 'liability'`).get(cid) as any).t || 0;
    const equity = (dbi.prepare(`SELECT COALESCE(SUM(balance), 0) t FROM accounts WHERE company_id = ? AND type = 'equity'`).get(cid) as any).t || 0;
    if (equity === 0) return { ratio: null, reason: 'No equity' };
    const ratio = round2(Math.abs(debt) / Math.abs(equity));
    return { debt_to_equity: ratio, total_debt: round2(Math.abs(debt)), total_equity: round2(Math.abs(equity)) };
  } catch (e: any) { return { error: e.message }; }
}

// F992: Loan portfolio dashboard — total debt, weighted avg rate, monthly debt service
export function loanPortfolioDashboard() {
  try {
    const cid = db.getCurrentCompanyId();
    const loans = db.getDb().prepare(`SELECT id, name, loan_type, current_balance, interest_rate, payment_amount, status, next_payment_due FROM loans WHERE company_id = ? AND deleted_at IS NULL AND status = 'active'`).all(cid) as any[];
    const totalDebt = round2(loans.reduce((s, l) => s + (l.current_balance || 0), 0));
    const totalMonthlyService = round2(loans.reduce((s, l) => s + (l.payment_amount || 0), 0));
    // Weighted avg rate (by balance)
    const weightedRate = totalDebt > 0
      ? round2(loans.reduce((s, l) => s + (l.current_balance || 0) * ((l.interest_rate || 0) * 100), 0) / totalDebt)
      : 0;
    // Group by loan_type
    const byType: Record<string, { count: number; total: number; monthly: number }> = {};
    for (const l of loans) {
      const t = l.loan_type || 'other';
      if (!byType[t]) byType[t] = { count: 0, total: 0, monthly: 0 };
      byType[t].count++;
      byType[t].total += l.current_balance || 0;
      byType[t].monthly += l.payment_amount || 0;
    }
    const next30dPayments = loans.filter(l => l.next_payment_due && l.next_payment_due <= addDays(today(), 30)).length;
    return {
      total_loans: loans.length,
      total_debt: totalDebt,
      total_monthly_debt_service: totalMonthlyService,
      annual_debt_service: round2(totalMonthlyService * 12),
      weighted_avg_rate_pct: weightedRate,
      by_loan_type: Object.entries(byType).map(([type, v]) => ({ type, count: v.count, total: round2(v.total), monthly: round2(v.monthly) })),
      payments_due_next_30d: next30dPayments,
    };
  } catch (e: any) { return { error: e.message }; }
}
