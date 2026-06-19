// src/main/services/tax-forms/form-944.ts
//
// IRS Form 944 — Employer's ANNUAL Federal Tax Return.
//
// Form 944 is the annual variant of 941 for small employers whose
// total annual employment-tax liability is $1,000 or less. The IRS
// notifies eligible employers in writing that they must file 944
// instead of 941. You can't switch unilaterally — you have to be
// notified to switch in or out.
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-form-944
//   • Form 944 (2025) — line numbers verified from the official PDF
//   • IRS Pub 15 (Circular E)
//
// What this DOES:
//   • Aggregates pay_stubs across an entire calendar year
//   • Same SS/Medicare per-employee cap math as form-941
//   • Produces line 13a-13l monthly liability schedule
//
// What this does NOT do:
//   • Schedule B / 945-A semiweekly daily-liability schedule
//     (handled in form-941-schedule-b.ts and form-945-a.ts —
//     only required for semiweekly depositors or accumulated
//     liability $100K+ on any day)

import * as db from '../../database';

export interface Form944Data {
  // Filing identity (matches the entity block on page 1)
  ein: string;
  business_name: string;
  trade_name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  year: number;

  // Part 1 — annual figures
  line1_wages_tips: number;             // Wages, tips, other compensation
  line2_fed_income_tax: number;         // Federal income tax withheld
  line3_no_fica: boolean;               // Checkbox — no SS/Medicare wages

  // Line 4 columns 1 & 2
  line4a_taxable_ss_wages: number;      // Col 1
  line4a_ss_tax: number;                // Col 2 = Col 1 × 0.124
  line4b_taxable_ss_tips: number;
  line4b_ss_tax: number;
  line4c_taxable_medicare_wages: number;
  line4c_medicare_tax: number;          // × 0.029
  line4d_addtl_medicare_wages: number;  // > $200k YTD per employee
  line4d_addtl_medicare_tax: number;    // × 0.009

  line4e_total: number;                 // Sum of column 2 (4a + 4b + 4c + 4d)

  line5_total_before_adj: number;       // line 2 + line 4e
  line6_adjustments: number;            // Current year's adjustments (default 0)
  line7_total_after_adj: number;        // 5 + 6
  line8_qual_small_biz_credit: number;  // R&D credit via Form 8974 (default 0)
  line9_total_after_credits: number;    // 7 - 8

  line10_total_deposits: number;        // What was deposited during the year
  line11_balance_due: number;           // 9 - 10 if positive
  line12a_overpayment: number;          // 10 - 9 if positive

  // Part 2 — monthly liability (only if line 9 ≥ $2,500)
  line13_monthly_required: boolean;
  line13a_jan: number;
  line13b_feb: number;
  line13c_mar: number;
  line13d_apr: number;
  line13e_may: number;
  line13f_jun: number;
  line13g_jul: number;
  line13h_aug: number;
  line13i_sep: number;
  line13j_oct: number;
  line13k_nov: number;
  line13l_dec: number;
  line13m_total: number;                // Must equal line 9

  // Computation metadata
  payroll_run_count: number;
  pay_stub_count: number;
  employee_count: number;

  // Filing-status flags
  business_closed: boolean;
  business_closed_date: string;

  warnings: string[];
}

import { SS_RATE, MEDICARE_RATE, ADDTL_MEDICARE_RATE, SS_WAGE_BASE_2026, ADDTL_MEDICARE_THRESHOLD } from '../../lib/tax-constants';
const SCHEDULE_B_THRESHOLD = 2500;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeForm944(companyId: string, year: number): Form944Data {
  const dbi = db.getDb();
  const company = db.getById('companies', companyId) as any || {};
  const yearStart = year + '-01-01';
  const yearEnd = year + '-12-31';

  // Pull all pay stubs for the entire year
  const stubs = dbi.prepare(`
    SELECT s.*, r.pay_date, r.id AS run_id
    FROM pay_stubs s
    JOIN payroll_runs r ON r.id = s.payroll_run_id
    WHERE r.company_id = ?
      AND r.pay_date BETWEEN ? AND ?
      AND COALESCE(r.deleted_at, '') = ''
  `).all(companyId, yearStart, yearEnd) as any[];

  const employees = new Set<string>(stubs.map((s) => s.employee_id));

  // Aggregate annual totals
  const totals = stubs.reduce((acc, s) => {
    acc.gross += Number(s.gross_pay) || 0;
    acc.fed_tax += Number(s.federal_tax) || 0;
    acc.ss_employee += Number(s.social_security) || 0;
    acc.medicare_employee += Number(s.medicare) || 0;
    return acc;
  }, { gross: 0, fed_tax: 0, ss_employee: 0, medicare_employee: 0 });

  // Per-employee accumulator for SS cap and Addtl Medicare threshold
  const empTotals = new Map<string, { gross: number; max_ytd: number }>();
  for (const s of stubs) {
    const empId = s.employee_id;
    const stubGross = Number(s.gross_pay) || 0;
    const ytdAtEnd = Number(s.ytd_gross) || 0;
    const cur = empTotals.get(empId);
    if (cur) {
      cur.gross += stubGross;
      cur.max_ytd = Math.max(cur.max_ytd, ytdAtEnd);
    } else {
      empTotals.set(empId, { gross: stubGross, max_ytd: ytdAtEnd });
    }
  }

  // SS-taxable wages: capped at wage base per employee for the year
  let line4a_wages = 0;
  for (const [, v] of empTotals) {
    line4a_wages += Math.min(v.gross, SS_WAGE_BASE_2026);
  }
  // Addtl Medicare wages: per-employee portion above $200k
  let line4d_wages = 0;
  for (const [, v] of empTotals) {
    line4d_wages += Math.max(0, v.gross - ADDTL_MEDICARE_THRESHOLD);
  }
  // Medicare-taxable wages: no cap
  const line4c_wages = totals.gross;

  // Line 4 column 2 (combined ER+EE rates per the form)
  const line4a_tax = round2(line4a_wages * SS_RATE * 2);     // 12.4%
  const line4c_tax = round2(line4c_wages * MEDICARE_RATE * 2); // 2.9%
  const line4d_tax = round2(line4d_wages * ADDTL_MEDICARE_RATE); // 0.9%
  const line4e = round2(line4a_tax + line4c_tax + line4d_tax);

  const line5 = round2(totals.fed_tax + line4e);
  const line6 = 0; // adjustments — user can override
  const line7 = round2(line5 + line6);
  const line8 = 0; // R&D credit — user enters
  const line9 = round2(line7 - line8);

  const line10 = 0; // total deposits — user fills in (no internal deposit log yet)
  const line11 = Math.max(0, round2(line9 - line10));
  const line12a = Math.max(0, round2(line10 - line9));

  // Per-month liability (sum of fed + 2× SS + 2× Medicare from stubs in month)
  const monthLiability = (m: number): number => {
    const pad = (n: number) => n < 10 ? '0' + n : String(n);
    const monthStart = year + '-' + pad(m) + '-01';
    const monthEnd = year + '-' + pad(m) + '-' + new Date(year, m, 0).getDate();
    const monthStubs = stubs.filter((s) => s.pay_date >= monthStart && s.pay_date <= monthEnd);
    return round2(monthStubs.reduce((sum, s) => {
      const fed = Number(s.federal_tax) || 0;
      const ss = (Number(s.social_security) || 0) * 2;
      const med = (Number(s.medicare) || 0) * 2;
      return sum + fed + ss + med;
    }, 0));
  };

  const monthly: number[] = [];
  for (let m = 1; m <= 12; m++) monthly.push(monthLiability(m));
  const line13m = round2(monthly.reduce((s, v) => s + v, 0));

  const warnings: string[] = [];
  if (line9 > 1000 && employees.size > 0) {
    warnings.push('Annual liability ($' + line9.toFixed(2) + ') exceeds $1,000 — verify the IRS still has you on Form 944. Most employers above $1,000/year file quarterly Form 941 instead.');
  }
  if (line9 >= SCHEDULE_B_THRESHOLD && Math.abs(line13m - line9) > 1) {
    warnings.push('Monthly liability total ($' + line13m.toFixed(2) + ') does not match line 9 ($' + line9.toFixed(2) + '). The IRS rejects 944s where these disagree.');
  }
  if (employees.size === 0) {
    warnings.push('No employees paid in ' + year + ' — file Form 944 with all zeros and check Part 3 line 14 if business closed.');
  }
  if (!company.ein && !company.tax_id) {
    warnings.push('Employer EIN missing — required on Form 944.');
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

    line1_wages_tips: round2(totals.gross),
    line2_fed_income_tax: round2(totals.fed_tax),
    line3_no_fica: line4a_wages === 0 && line4c_wages === 0,

    line4a_taxable_ss_wages: round2(line4a_wages),
    line4a_ss_tax: line4a_tax,
    line4b_taxable_ss_tips: 0,
    line4b_ss_tax: 0,
    line4c_taxable_medicare_wages: round2(line4c_wages),
    line4c_medicare_tax: line4c_tax,
    line4d_addtl_medicare_wages: round2(line4d_wages),
    line4d_addtl_medicare_tax: line4d_tax,
    line4e_total: line4e,

    line5_total_before_adj: line5,
    line6_adjustments: line6,
    line7_total_after_adj: line7,
    line8_qual_small_biz_credit: line8,
    line9_total_after_credits: line9,

    line10_total_deposits: line10,
    line11_balance_due: line11,
    line12a_overpayment: line12a,

    line13_monthly_required: line9 >= SCHEDULE_B_THRESHOLD,
    line13a_jan: monthly[0],
    line13b_feb: monthly[1],
    line13c_mar: monthly[2],
    line13d_apr: monthly[3],
    line13e_may: monthly[4],
    line13f_jun: monthly[5],
    line13g_jul: monthly[6],
    line13h_aug: monthly[7],
    line13i_sep: monthly[8],
    line13j_oct: monthly[9],
    line13k_nov: monthly[10],
    line13l_dec: monthly[11],
    line13m_total: line13m,

    payroll_run_count: new Set(stubs.map((s) => s.run_id)).size,
    pay_stub_count: stubs.length,
    employee_count: employees.size,

    business_closed: false,
    business_closed_date: '',

    warnings,
  };
}
