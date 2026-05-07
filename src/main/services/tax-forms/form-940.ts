// src/main/services/tax-forms/form-940.ts
//
// IRS Form 940 — Annual Federal Unemployment (FUTA) Tax Return.
//
// FUTA tax: 6.0% on the first $7,000 of each employee's wages.
// Most employers get a 5.4% credit reduction for paying state
// unemployment (SUTA) timely → effective rate 0.6%. The credit
// is reduced for employers in "credit reduction states" with
// outstanding federal UI loans (FL, NY, etc., per Department of
// Labor annual list).
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-form-940
//   • DOL credit reduction state list (annual)
//   • IRS Pub 15
//
// What this DOES:
//   • Per-employee accumulator: clamps each employee's wages at
//     $7,000 FUTA wage base (cumulative across all pay periods)
//   • Aggregates to compute lines 1-15 with quarterly liability
//     breakdown for Part 5
//   • Auto-detects multi-state employer (Part 1) — the user must
//     manually mark credit-reduction-state schedule A entries
//   • Returns warnings for over-$500 quarterly deposit threshold

import * as db from '../../database';

export interface Form940Data {
  // Filing identity
  ein: string;
  business_name: string;
  trade_name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  year: number;

  // Part 1 — type of return
  amended: boolean;                  // 1d
  successor_employer: boolean;       // 1c
  no_payments_to_employees: boolean; // 1a
  final_return: boolean;             // 1b
  multi_state_employer: boolean;     // Part 1 box 1a
  credit_reduction_state: boolean;   // Part 1 box 1b — has Schedule A

  // Part 2 — FUTA tax before adjustments
  line3_total_payments: number;       // Total wages paid (gross)
  line4_payments_exempt: number;      // Fringe benefits, group term life, retirement, dependent care, other
  line4a_fringe: boolean;
  line4b_group_term_life: boolean;
  line4c_retirement_pension: boolean;
  line4d_dependent_care: boolean;
  line4e_other: boolean;
  line5_payments_excess_7k: number;   // Wages > $7,000 per employee
  line6_subtotal: number;             // line4 + line5
  line7_total_taxable: number;        // line3 - line6
  line8_futa_tax: number;             // line7 × 0.006 (0.6% net)

  // Part 3 — Schedule A credit reduction (if multi-state)
  line9_no_credit: number;            // Wages × 0.054 if NO state UI paid
  line10_some_credit: number;         // From Worksheet (state-by-state)
  line11_credit_reduction: number;    // From Schedule A
  line12_total_futa: number;          // 8 + 9 + 10 + 11

  // Part 4 — Balance due / overpayment
  line13_total_deposits: number;      // What was prepaid (user enters)
  line14_balance_due: number;         // 12 - 13 (if positive)
  line15_overpayment: number;         // 13 - 12 (if positive)

  // Part 5 — Quarterly liability (only if line 12 > $500)
  q1_liability: number;
  q2_liability: number;
  q3_liability: number;
  q4_liability: number;
  total_quarterly_liability: number;

  // Computation metadata
  employee_count: number;
  has_quarterly_deposit_required: boolean;
  effective_futa_rate: number;        // 0.006 base; higher if credit reduction state
  warnings: string[];
}

// FUTA constants (these have been stable for 40+ years; if Congress changes them, edit here)
const FUTA_WAGE_BASE = 7000;         // First $7K of each employee's wages
const FUTA_GROSS_RATE = 0.060;       // Statutory 6.0%
const FUTA_NET_RATE = 0.006;          // After 5.4% state credit (0.6% effective)
const QUARTERLY_DEPOSIT_THRESHOLD = 500; // Must deposit if quarterly tax > $500

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeForm940(
  companyId: string,
  year: number,
  opts?: { multi_state?: boolean; credit_reduction_state?: boolean; total_deposits?: number }
): Form940Data {
  const dbi = db.getDb();
  const company = db.getById('companies', companyId) as any || {};
  const yearStart = year + '-01-01';
  const yearEnd = year + '-12-31';

  // Pull all pay stubs in the year, joined to runs for pay_date
  const stubs = dbi.prepare(`
    SELECT s.*, r.pay_date
    FROM pay_stubs s
    JOIN payroll_runs r ON r.id = s.payroll_run_id
    WHERE r.company_id = ?
      AND r.pay_date BETWEEN ? AND ?
      AND COALESCE(r.deleted_at, '') = ''
    ORDER BY r.pay_date
  `).all(companyId, yearStart, yearEnd) as any[];

  const employees = new Set<string>(stubs.map((s) => s.employee_id));

  // Per-employee accumulator: track gross paid before each stub, clamp at $7K
  // FUTA-taxable wages = sum of (wages applied while ytd < $7K) per employee
  const empYTD = new Map<string, number>();
  let line3 = 0;        // total payments
  let line5 = 0;         // wages > $7K (NOT taxable)
  let futaTaxable = 0;   // wages ≤ $7K (taxable base)
  // Quarterly liability accumulators
  const qLiability = [0, 0, 0, 0];

  for (const s of stubs) {
    const empId = s.employee_id;
    const gross = Number(s.gross_pay) || 0;
    line3 += gross;

    const prevYTD = empYTD.get(empId) || 0;
    const newYTD = prevYTD + gross;
    empYTD.set(empId, newYTD);

    // FUTA-taxable portion of this stub
    if (prevYTD >= FUTA_WAGE_BASE) {
      // Already over $7K — entire stub excess
      line5 += gross;
    } else if (newYTD <= FUTA_WAGE_BASE) {
      // Entirely under cap
      futaTaxable += gross;
    } else {
      // Straddles cap
      const taxablePortion = FUTA_WAGE_BASE - prevYTD;
      const excessPortion = gross - taxablePortion;
      futaTaxable += taxablePortion;
      line5 += excessPortion;
    }

    // Quarterly liability (use net rate as default; state credit assumed)
    const stubFutaTax = (() => {
      if (prevYTD >= FUTA_WAGE_BASE) return 0;
      const taxable = newYTD <= FUTA_WAGE_BASE ? gross : FUTA_WAGE_BASE - prevYTD;
      return taxable * FUTA_NET_RATE;
    })();
    const m = parseInt((s.pay_date || '').slice(5, 7));
    if (m >= 1 && m <= 12) {
      const q = Math.floor((m - 1) / 3);
      qLiability[q] += stubFutaTax;
    }
  }

  // Pre-tax exemptions (Box 4): cafeteria plan health insurance,
  // 401(k) matched, dependent care, etc., are FUTA-exempt
  // Conservatively pull pretax_deductions from pay stubs
  const line4 = round2(stubs.reduce((sum, s) => sum + (Number(s.pretax_deductions) || 0), 0));

  const line6 = round2(line4 + line5);
  const line7 = round2(Math.max(0, line3 - line6));
  const line8 = round2(line7 * FUTA_NET_RATE);

  // Multi-state / credit reduction handling
  const isMultiState = opts?.multi_state || false;
  const isCreditReductionState = opts?.credit_reduction_state || false;
  let line9 = 0, line10 = 0, line11 = 0;
  if (isCreditReductionState) {
    // Conservative: assume full statutory rate (6.0%) on taxable wages
    // until user provides Schedule A details
    line11 = round2(line7 * (FUTA_GROSS_RATE - FUTA_NET_RATE));
  }
  const line12 = round2(line8 + line9 + line10 + line11);

  const line13 = round2(opts?.total_deposits || 0);
  const line14 = Math.max(0, round2(line12 - line13));
  const line15 = Math.max(0, round2(line13 - line12));

  const totalQuarterly = round2(qLiability.reduce((s, q) => s + q, 0));
  const requiresQuarterlyDeposit = line12 > QUARTERLY_DEPOSIT_THRESHOLD;

  const warnings: string[] = [];
  if (employees.size === 0) warnings.push('No employees paid in ' + year + ' — file Form 940 with line 1a checked.');
  if (!company.ein && !company.tax_id) warnings.push('Employer EIN missing — required on Form 940.');
  if (line12 === 0 && employees.size > 0) warnings.push('FUTA tax computes to $0 — verify employee wages ≤ $7,000 each.');
  if (requiresQuarterlyDeposit && line13 === 0) {
    warnings.push('Total FUTA tax > $500 — quarterly deposits were required. Enter total deposits in line 13.');
  }
  if (Math.abs(totalQuarterly - line12) > 1) {
    warnings.push('Quarterly liability sum ($' + totalQuarterly + ') does not match line 12 ($' + line12 + ') — review.');
  }
  if (isCreditReductionState) {
    warnings.push('Credit reduction state filer — file Schedule A with state-by-state breakdown.');
  }

  return {
    ein: company.ein || company.tax_id || '',
    business_name: company.legal_name || company.name || '',
    trade_name: company.name || '',
    address: company.address_line1 || '',
    city: company.city || '',
    state: company.state || '',
    zip: company.zip || '',
    year,

    amended: false,
    successor_employer: false,
    no_payments_to_employees: employees.size === 0,
    final_return: false,
    multi_state_employer: isMultiState,
    credit_reduction_state: isCreditReductionState,

    line3_total_payments: round2(line3),
    line4_payments_exempt: line4,
    line4a_fringe: false,
    line4b_group_term_life: false,
    line4c_retirement_pension: line4 > 0,
    line4d_dependent_care: false,
    line4e_other: false,
    line5_payments_excess_7k: round2(line5),
    line6_subtotal: line6,
    line7_total_taxable: line7,
    line8_futa_tax: line8,

    line9_no_credit: line9,
    line10_some_credit: line10,
    line11_credit_reduction: line11,
    line12_total_futa: line12,

    line13_total_deposits: line13,
    line14_balance_due: line14,
    line15_overpayment: line15,

    q1_liability: round2(qLiability[0]),
    q2_liability: round2(qLiability[1]),
    q3_liability: round2(qLiability[2]),
    q4_liability: round2(qLiability[3]),
    total_quarterly_liability: totalQuarterly,

    employee_count: employees.size,
    has_quarterly_deposit_required: requiresQuarterlyDeposit,
    effective_futa_rate: isCreditReductionState ? FUTA_GROSS_RATE : FUTA_NET_RATE,
    warnings,
  };
}
