// src/main/services/tax-forms/schedule-1.ts
//
// IRS 1040 Schedule 1 — Additional Income and Adjustments to Income.
//
// Part I (lines 1-10) reports income that doesn't fit on the main
// 1040 form (business income, rental, unemployment, etc.).
// Part II (lines 11-26) reports above-the-line adjustments (HSA,
// SE tax deduction, retirement contributions, student loan interest).
//
// For accounting users (sole props, SMLLCs):
//   • Line 3 = Schedule C net profit (autofilled)
//   • Line 15 = deductible half of SE tax (autofilled from Sch SE)
//   • Most other lines are personal — manual entry
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-schedule-1-form-1040

import { computeScheduleC } from './schedule-c';
import { computeScheduleSE } from './schedule-se';
import * as db from '../../database';

export interface Schedule1Data {
  taxpayer_name: string;
  ssn: string;
  year: number;

  // Part I — Additional Income
  line1_taxable_refunds: number;
  line2a_alimony_received: number;
  line3_business_income: number;        // From Schedule C
  line4_other_gains: number;             // From Form 4797
  line5_rental_real_estate: number;      // From Schedule E
  line6_farm_income: number;             // From Schedule F
  line7_unemployment_comp: number;       // From 1099-G Box 1
  line8_other_income: Array<{ label: string; amount: number }>;
  line9_total_other_income: number;       // Sum of line 8 items
  line10_total_additional_income: number; // 1 + 2a + 3 + 4 + 5 + 6 + 7 + 9

  // Part II — Adjustments to Income
  line11_educator_expenses: number;
  line12_business_expenses_reservist: number;
  line13_hsa_deduction: number;
  line14_moving_expenses_armed_forces: number;
  line15_se_tax_deduction: number;        // Half of SE tax
  line16_se_health_insurance: number;
  line17_se_retirement_contributions: number;
  line18_penalty_early_withdrawal: number;
  line19a_alimony_paid: number;
  line20_ira_deduction: number;
  line21_student_loan_interest: number;
  line22_reserved: number;
  line23_archer_msa_deduction: number;
  line24_other_adjustments: Array<{ label: string; amount: number }>;
  line25_total_other_adjustments: number;
  line26_total_adjustments: number;       // Sum of lines 11-25

  warnings: string[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeSchedule1(companyId: string, year: number, opts?: { w2_other_wages?: number }): Schedule1Data {
  const company = db.getById('companies', companyId) as any || {};

  // Pull Schedule C and Schedule SE for autofilled lines
  const scheduleC = computeScheduleC(companyId, year);
  const scheduleSE = computeScheduleSE(companyId, year, { w2_ss_wages: opts?.w2_other_wages });

  const line3 = round2((scheduleC as any).line31_net_profit_loss || (scheduleC as any).net_profit || 0);
  const line15 = round2((scheduleSE as any).line13_deductible_half || 0);

  // Most other lines come from personal records we don't track
  const line10 = round2(line3); // Only autofilled component
  const line26 = round2(line15);

  const warnings: string[] = [];
  if (line3 < 0) warnings.push('Schedule C reports a loss of ' + line3.toFixed(2) + ' — flows to Schedule 1 line 3 as a negative.');
  if (line26 === line15 && line15 > 0) warnings.push('Lines 11-14, 16-25 default to $0 — fill any applicable adjustments before filing.');

  return {
    taxpayer_name: company.legal_name || company.name || '',
    ssn: '',
    year,
    line1_taxable_refunds: 0,
    line2a_alimony_received: 0,
    line3_business_income: line3,
    line4_other_gains: 0,
    line5_rental_real_estate: 0,
    line6_farm_income: 0,
    line7_unemployment_comp: 0,
    line8_other_income: [],
    line9_total_other_income: 0,
    line10_total_additional_income: line10,
    line11_educator_expenses: 0,
    line12_business_expenses_reservist: 0,
    line13_hsa_deduction: 0,
    line14_moving_expenses_armed_forces: 0,
    line15_se_tax_deduction: line15,
    line16_se_health_insurance: 0,
    line17_se_retirement_contributions: 0,
    line18_penalty_early_withdrawal: 0,
    line19a_alimony_paid: 0,
    line20_ira_deduction: 0,
    line21_student_loan_interest: 0,
    line22_reserved: 0,
    line23_archer_msa_deduction: 0,
    line24_other_adjustments: [],
    line25_total_other_adjustments: 0,
    line26_total_adjustments: line26,
    warnings,
  };
}
