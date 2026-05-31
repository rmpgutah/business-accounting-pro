// src/main/services/tax-forms/form-941.ts
//
// IRS Form 941 — Employer's Quarterly Federal Tax Return.
//
// Computed from pay_stubs in the chosen quarter (joined to payroll_runs
// for the pay_date which determines quarter-eligibility) — line numbers
// match the official IRS form (revised March 2024).
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-form-941
//   • IRS Pub 15 (Circular E)
//
// What this DOES:
//   • Sums wages, federal income tax withheld, SS+Medicare from
//     all pay stubs whose pay_date falls in the quarter
//   • Computes per-line values matching Form 941 boxes
//   • Returns a structured object the PDF renderer can consume
//
// What this does NOT do (yet):
//   • Half-credit for Sick/Family/Tip wages (lines 5a-i, 5b-i)
//   • Schedule B (semi-weekly depositors) — the per-day deposit
//     schedule. Most small employers are monthly depositors and
//     don't need Schedule B.
//   • 941-X amendment forms.

import * as db from '../../database';

export interface Form941Data {
  // Filing identity
  ein: string;
  business_name: string;
  trade_name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  quarter: 1 | 2 | 3 | 4;
  year: number;

  // Part 1
  line1_employees: number;          // Number of employees who received wages this quarter
  line2_wages_tips: number;          // Total wages/tips/comp paid
  line3_fed_income_tax: number;      // Federal income tax withheld

  line4_no_fica: boolean;            // Wages NOT subject to SS/Medicare (rare; default false)

  line5a_taxable_ss_wages: number;   // SS-taxable wages (capped at SS wage base)
  line5a_ss_tax: number;             // 5a × 0.124
  line5b_taxable_ss_tips: number;    // We don't track tips separately; defaults 0
  line5b_ss_tax: number;
  line5c_taxable_medicare_wages: number; // Medicare-taxable (no cap)
  line5c_medicare_tax: number;       // 5c × 0.029
  line5d_addtl_medicare_wages: number;   // Wages > $200k subject to addtl 0.9%
  line5d_addtl_medicare_tax: number;     // 5d × 0.009
  line5e_total: number;              // 5a+5b+5c+5d tax

  line5f_ss_tips_unreported: number; // Section 3121(q); rare. Default 0.
  line6_total_taxes_before_adj: number; // 3 + 5e + 5f

  line7_fractions_adj: number;       // Rounding penny diff. Default 0.
  line8_sick_pay_adj: number;
  line9_tips_group_term: number;
  line10_total_taxes_after_adj: number; // 6 + 7 + 8 + 9

  line11a_qual_small_biz_credit: number; // R&D credit. Default 0.
  line11b_nonref_credit: number;
  line11c_nonref_total: number;
  line11d_ref_credit: number;
  line11e_ref_total: number;
  line12_total_taxes_after_credits: number; // 10 - 11c - 11e

  line13a_total_deposits: number;    // Total deposited this quarter (from history)
  line13b_def_taxes_paid: number;    // From COVID-era; default 0 in 2026
  line13c_diff_for_balance: number;
  line13d_total_deposits_with_credits: number;
  line13e_def_employer_taxes: number;
  line13f_def_employee_taxes: number;
  line13g_total: number;

  line14_balance_due: number;        // 12 - 13g (if positive)
  line15_overpayment: number;        // 13g - 12 (if positive)

  // Part 2 — Deposit schedule
  deposit_schedule: 'monthly' | 'semiweekly' | 'small_employer';
  month1_liability: number;
  month2_liability: number;
  month3_liability: number;
  total_quarter_liability: number;   // Should equal line 12

  // Calculation metadata
  payroll_run_count: number;
  pay_stub_count: number;
}

import { SS_RATE, MEDICARE_RATE, ADDTL_MEDICARE_RATE, SS_WAGE_BASE_2026, ADDTL_MEDICARE_THRESHOLD } from '../../lib/tax-constants';

function quarterDateRange(year: number, quarter: 1 | 2 | 3 | 4): { start: string; end: string } {
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = quarter * 3;
  const pad = (n: number) => n < 10 ? '0' + n : String(n);
  // Last day of end month — JS Date with day=0 of next month gives last day of current month
  const endDay = new Date(year, endMonth, 0).getDate();
  return {
    start: year + '-' + pad(startMonth) + '-01',
    end: year + '-' + pad(endMonth) + '-' + pad(endDay),
  };
}

export function computeForm941(companyId: string, year: number, quarter: 1 | 2 | 3 | 4): Form941Data {
  const dbi = db.getDb();
  const company = db.getById('companies', companyId) as any || {};
  const range = quarterDateRange(year, quarter);

  // Pull pay stubs whose pay_date is in this quarter.
  const stubs = dbi.prepare(`
    SELECT s.*, r.pay_date, r.id AS run_id
    FROM pay_stubs s
    JOIN payroll_runs r ON r.id = s.payroll_run_id
    WHERE r.company_id = ?
      AND r.pay_date BETWEEN ? AND ?
      AND COALESCE(r.deleted_at, '') = ''
    ORDER BY r.pay_date ASC, s.id ASC
  `).all(companyId, range.start, range.end) as any[];
  // NOTE: ORDER BY guarantees the per-employee ytdAtStart below is taken from
  // the EARLIEST stub in the quarter, so SS-cap and additional-Medicare
  // threshold crossings (lines 5a/5d) are computed off the correct baseline.

  // Distinct employees who received wages
  const employees = new Set<string>(stubs.map((s) => s.employee_id));

  // Aggregate amounts
  const totals = stubs.reduce((acc, s) => {
    acc.gross += Number(s.gross_pay) || 0;
    // Medicare-taxable wages = gross − pre-tax deductions (401k, §125, HSA).
    // Using raw gross for line 5c overstated Medicare wages/tax for anyone with
    // pre-tax deductions and broke reconciliation to W-2 Box 5.
    acc.medicare_wages += Math.max(0, (Number(s.gross_pay) || 0) - (Number(s.pretax_deductions) || 0));
    acc.fed_tax += Number(s.federal_tax) || 0;
    acc.ss_employee += Number(s.social_security) || 0;
    acc.medicare_employee += Number(s.medicare) || 0;
    return acc;
  }, { gross: 0, medicare_wages: 0, fed_tax: 0, ss_employee: 0, medicare_employee: 0 });

  // Compute additional Medicare — wages exceeding $200k YTD per employee
  // We use the pay-stub YTD field rather than recomputing. For form 941
  // we only count THIS QUARTER'S addtl-Medicare-eligible wages, which
  // requires per-employee accumulation.
  const empAccum = new Map<string, { ytdAtStart: number; thisQuarter: number }>();
  for (const s of stubs) {
    const ytdEnd = Number(s.ytd_gross) || 0;
    const thisStub = Number(s.gross_pay) || 0;
    const ytdStart = ytdEnd - thisStub;
    const cur = empAccum.get(s.employee_id);
    if (cur) {
      cur.thisQuarter += thisStub;
    } else {
      empAccum.set(s.employee_id, { ytdAtStart: ytdStart, thisQuarter: thisStub });
    }
  }
  let line5d_wages = 0;
  for (const [, v] of empAccum) {
    // Per-employee: portion above $200k cumulative
    const ytdEnd = v.ytdAtStart + v.thisQuarter;
    const overAtStart = Math.max(0, v.ytdAtStart - ADDTL_MEDICARE_THRESHOLD);
    const overAtEnd = Math.max(0, ytdEnd - ADDTL_MEDICARE_THRESHOLD);
    line5d_wages += Math.max(0, overAtEnd - overAtStart);
  }

  // SS-taxable wages: capped at $182,100 per employee per year
  let line5a_wages = 0;
  for (const [, v] of empAccum) {
    const ytdEnd = v.ytdAtStart + v.thisQuarter;
    const ssAtStart = Math.min(v.ytdAtStart, SS_WAGE_BASE_2026);
    const ssAtEnd = Math.min(ytdEnd, SS_WAGE_BASE_2026);
    line5a_wages += Math.max(0, ssAtEnd - ssAtStart);
  }

  // Medicare-taxable: no cap, but net of pre-tax deductions (not raw gross).
  const line5c_wages = totals.medicare_wages;

  // Compute combined (employee + employer) tax amounts for the form
  // (Form 941 reports COMBINED figures; we have employee figures from
  // pay stubs and double them for the SS+Medicare portion).
  const line5a_tax = round2(line5a_wages * SS_RATE * 2);     // 12.4%
  const line5c_tax = round2(line5c_wages * MEDICARE_RATE * 2); // 2.9%
  const line5d_tax = round2(line5d_wages * ADDTL_MEDICARE_RATE); // 0.9% (employee only)

  const line5e_total = round2(line5a_tax + line5c_tax + line5d_tax);
  const line6 = round2(totals.fed_tax + line5e_total);

  // Adjustments default 0 unless we add support later
  const line10 = line6;

  // Credits default 0 — only used by R&D-credit small-biz filers
  const line12 = line10;

  // Deposits — pull from a deposit_log table if it exists; for now
  // assume the user has been depositing as required and total = line 12
  // (matches a balanced filing). User edits in the UI before filing.
  const line13a = 0; // user fills in
  const line13g = line13a;

  const line14 = Math.max(0, round2(line12 - line13g));
  const line15 = Math.max(0, round2(line13g - line12));

  // Per-month liability: sum of taxes from pay stubs in each month
  const monthLiability = (m: number) => {
    const monthStart = year + '-' + (m < 10 ? '0' + m : m) + '-01';
    const monthEnd = year + '-' + (m < 10 ? '0' + m : m) + '-' + new Date(year, m, 0).getDate();
    const monthStubs = stubs.filter((s) => s.pay_date >= monthStart && s.pay_date <= monthEnd);
    return monthStubs.reduce((sum, s) => {
      const fed = Number(s.federal_tax) || 0;
      const ss = (Number(s.social_security) || 0) * 2; // employee + employer
      const med = (Number(s.medicare) || 0) * 2;
      return sum + fed + ss + med;
    }, 0);
  };
  const m1 = (quarter - 1) * 3 + 1;
  const month1 = round2(monthLiability(m1));
  const month2 = round2(monthLiability(m1 + 1));
  const month3 = round2(monthLiability(m1 + 2));

  return {
    ein: company.ein || company.tax_id || '',
    business_name: company.legal_name || company.name || '',
    trade_name: company.name || '',
    address: company.address_line1 || '',
    city: company.city || '',
    state: company.state || '',
    zip: company.zip || '',
    quarter,
    year,

    line1_employees: employees.size,
    line2_wages_tips: round2(totals.gross),
    line3_fed_income_tax: round2(totals.fed_tax),
    line4_no_fica: false,

    line5a_taxable_ss_wages: round2(line5a_wages),
    line5a_ss_tax: line5a_tax,
    line5b_taxable_ss_tips: 0,
    line5b_ss_tax: 0,
    line5c_taxable_medicare_wages: round2(line5c_wages),
    line5c_medicare_tax: line5c_tax,
    line5d_addtl_medicare_wages: round2(line5d_wages),
    line5d_addtl_medicare_tax: line5d_tax,
    line5e_total,

    line5f_ss_tips_unreported: 0,
    line6_total_taxes_before_adj: line6,

    line7_fractions_adj: 0,
    line8_sick_pay_adj: 0,
    line9_tips_group_term: 0,
    line10_total_taxes_after_adj: line10,

    line11a_qual_small_biz_credit: 0,
    line11b_nonref_credit: 0,
    line11c_nonref_total: 0,
    line11d_ref_credit: 0,
    line11e_ref_total: 0,
    line12_total_taxes_after_credits: line12,

    line13a_total_deposits: line13a,
    line13b_def_taxes_paid: 0,
    line13c_diff_for_balance: 0,
    line13d_total_deposits_with_credits: line13a,
    line13e_def_employer_taxes: 0,
    line13f_def_employee_taxes: 0,
    line13g_total: line13g,

    line14_balance_due: line14,
    line15_overpayment: line15,

    deposit_schedule: month1 + month2 + month3 < 50000 ? 'monthly' : 'semiweekly',
    month1_liability: month1,
    month2_liability: month2,
    month3_liability: month3,
    total_quarter_liability: round2(month1 + month2 + month3),

    payroll_run_count: new Set(stubs.map((s) => s.run_id)).size,
    pay_stub_count: stubs.length,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
