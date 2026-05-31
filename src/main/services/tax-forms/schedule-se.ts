// src/main/services/tax-forms/schedule-se.ts
//
// IRS Form 1040 Schedule SE — Self-Employment Tax.
//
// Pulls net profit from Schedule C and runs it through the
// 15.3% SE tax with the 92.35% adjustment + Social Security
// wage base cap.
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-schedule-se-form-1040
//
// Important caveats documented in the UI:
//   • If the taxpayer ALSO has W-2 wages from an employer, those
//     count toward the SS wage base — Schedule SE has lines 8a-d
//     for that. Most sole-prop users don't have a W-2 job; we
//     assume box 8 = 0 unless the user manually edits.
//   • The deductible 1/2 SE tax (line 13) is an above-the-line
//     deduction on Form 1040 Schedule 1 line 15 (NOT Schedule C).
//     This is one of the most-missed deductions in DIY filing.

import { computeScheduleC, type ScheduleCData } from './schedule-c';

export interface ScheduleSEData {
  taxpayer_name: string;
  taxpayer_ssn: string;
  year: number;

  // Part I
  line1a_farm_se_income: number;          // 0 unless farm business
  line1b_social_security_retirement: number; // 0
  line2_other_se_income: number;           // From Schedule C line 31
  line3_total: number;                      // 1a + 1b + 2
  line4a_se_income_x_92pct: number;         // line 3 × 0.9235
  line4b_optional_method: number;            // 0 (rare)
  line4c_total: number;                      // 4a + 4b
  line5a_church_employee_income: number;    // 0 unless church
  line5b_church_x_92pct: number;
  line6_total_se_income: number;             // 4c + 5b

  // Part II — SS portion (capped)
  line7_max_ss_earnings: number;             // 2026 SS wage base
  line8a_ss_wages_w2: number;                // From W-2 jobs (user-entered)
  line8b_unreported_tips: number;
  line8c_wages_subject_to_self_employment: number;
  line8d_total_ss_already_subject: number;
  line9_remaining_ss_cap: number;            // line 7 − 8d (≥ 0)
  line10_ss_tax: number;                     // min(line 6, line 9) × 0.124

  // Medicare portion (no cap)
  line11_medicare_tax: number;                // line 6 × 0.029

  // Total + deduction
  line12_total_se_tax: number;                // 10 + 11 (carries to 1040 Schedule 2)
  line13_deductible_half: number;             // line 12 × 0.5 (above-the-line on 1040 Sch 1)

  // Computation metadata
  schedule_c_net_profit: number;
  is_negative_profit: boolean;                // SE tax is 0 if profit < $400
}

import { SS_WAGE_BASE_2026 } from '../../lib/tax-constants';
// SE rates are the COMBINED self-employment rates (both halves), distinct from
// the per-side payroll rates in tax-constants — keep them local.
const SS_RATE = 0.124;        // 12.4% combined (employee 6.2% + employer 6.2%)
const MEDICARE_RATE = 0.029;  // 2.9% combined
const SE_ADJUSTMENT = 0.9235; // 92.35% — the "deductible employer half"
const MIN_SE_INCOME = 400;    // Below this, no SE tax owed

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeScheduleSE(
  companyId: string,
  year: number,
  opts?: { w2_ss_wages?: number; taxpayer_name?: string; taxpayer_ssn?: string }
): ScheduleSEData {
  // Pull net profit from Schedule C
  const sched_c = computeScheduleC(companyId, year);
  const netProfit = sched_c.line31_net_profit;
  const w2Wages = opts?.w2_ss_wages || 0;

  // Line 2: net profit from Schedule C (line 31)
  const line2 = round2(netProfit);
  const line3 = round2(line2);

  // If net profit is < $400, no SE tax owed
  if (line3 < MIN_SE_INCOME) {
    return {
      taxpayer_name: opts?.taxpayer_name || sched_c.taxpayer_name || '',
      taxpayer_ssn: opts?.taxpayer_ssn || sched_c.taxpayer_ssn || '',
      year,
      line1a_farm_se_income: 0,
      line1b_social_security_retirement: 0,
      line2_other_se_income: line2,
      line3_total: line3,
      line4a_se_income_x_92pct: 0,
      line4b_optional_method: 0,
      line4c_total: 0,
      line5a_church_employee_income: 0,
      line5b_church_x_92pct: 0,
      line6_total_se_income: 0,
      line7_max_ss_earnings: SS_WAGE_BASE_2026,
      line8a_ss_wages_w2: w2Wages,
      line8b_unreported_tips: 0,
      line8c_wages_subject_to_self_employment: 0,
      line8d_total_ss_already_subject: w2Wages,
      line9_remaining_ss_cap: round2(Math.max(0, SS_WAGE_BASE_2026 - w2Wages)),
      line10_ss_tax: 0,
      line11_medicare_tax: 0,
      line12_total_se_tax: 0,
      line13_deductible_half: 0,
      schedule_c_net_profit: line2,
      is_negative_profit: line2 < 0,
    };
  }

  // Line 4a: × 92.35% (the SE adjustment)
  const line4a = round2(line3 * SE_ADJUSTMENT);
  const line4c = line4a;
  const line6 = line4c; // No church employee income

  // Line 9: Remaining SS wage base after W-2 wages
  const line8d = round2(w2Wages);
  const line9 = round2(Math.max(0, SS_WAGE_BASE_2026 - line8d));

  // Line 10: SS tax = min(line 6, line 9) × 12.4%
  const ssTaxableBase = Math.min(line6, line9);
  const line10 = round2(ssTaxableBase * SS_RATE);

  // Line 11: Medicare = line 6 × 2.9%
  const line11 = round2(line6 * MEDICARE_RATE);

  // Line 12: Total SE tax
  const line12 = round2(line10 + line11);

  // Line 13: Deductible half (above-the-line deduction)
  const line13 = round2(line12 * 0.5);

  return {
    taxpayer_name: opts?.taxpayer_name || sched_c.taxpayer_name || '',
    taxpayer_ssn: opts?.taxpayer_ssn || sched_c.taxpayer_ssn || '',
    year,
    line1a_farm_se_income: 0,
    line1b_social_security_retirement: 0,
    line2_other_se_income: line2,
    line3_total: line3,
    line4a_se_income_x_92pct: line4a,
    line4b_optional_method: 0,
    line4c_total: line4c,
    line5a_church_employee_income: 0,
    line5b_church_x_92pct: 0,
    line6_total_se_income: line6,
    line7_max_ss_earnings: SS_WAGE_BASE_2026,
    line8a_ss_wages_w2: w2Wages,
    line8b_unreported_tips: 0,
    line8c_wages_subject_to_self_employment: 0,
    line8d_total_ss_already_subject: line8d,
    line9_remaining_ss_cap: line9,
    line10_ss_tax: line10,
    line11_medicare_tax: line11,
    line12_total_se_tax: line12,
    line13_deductible_half: line13,
    schedule_c_net_profit: line2,
    is_negative_profit: line2 < 0,
  };
}
