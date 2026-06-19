// src/main/services/tax-forms/schedule-a.ts
//
// IRS 1040 Schedule A — Itemized Deductions.
//
// Filed by individuals who itemize instead of taking the standard
// deduction. Most categories are personal (medical, charity,
// mortgage interest on the personal home). One business-relevant
// item: state and local taxes (SALT), capped at $10,000.
//
// For accounting users:
//   • Most lines are personal — manual entry
//   • The "tax-deduction-finder" service (B13) already scans
//     business expenses for categories that might also belong on
//     Schedule A — refer the user there for hints.
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-schedule-a-form-1040

import * as db from '../../database';

export interface ScheduleAData {
  taxpayer_name: string;
  ssn: string;
  year: number;

  // Medical and Dental Expenses (lines 1-4)
  line1_medical_dental: number;
  line2_agi: number;
  line3_agi_floor: number;          // 7.5% × AGI
  line4_medical_deduction: number;  // line1 - line3 (≥ 0)

  // Taxes You Paid (lines 5-7)
  line5a_state_local_income_or_sales: number;
  line5a_check_sales_tax: boolean;
  line5b_state_local_real_estate: number;
  line5c_state_local_personal_property: number;
  line5d_total_5a_5b_5c: number;
  line5e_smaller_of_5d_or_10000: number;   // SALT cap
  line6_other_taxes: number;
  line7_total_taxes: number;        // 5e + 6

  // Interest You Paid (lines 8-10)
  line8a_home_mortgage_interest_reported_1098: number;
  line8b_home_mortgage_interest_not_reported: number;
  line8c_points_not_reported_1098: number;
  line8d_reserved: number;
  line8e_total_8a_8b_8c: number;
  line9_investment_interest: number;
  line10_total_interest: number;

  // Gifts to Charity (lines 11-14)
  line11_cash_check: number;
  line12_other_than_cash: number;
  line13_carryover_prior_year: number;
  line14_total_charity: number;

  // Casualty and Theft Losses (line 15)
  line15_casualty_theft: number;     // Form 4684

  // Other Itemized Deductions (line 16)
  line16_other: Array<{ label: string; amount: number }>;
  line16_total_other: number;

  // Total (line 17)
  line17_total_itemized: number;     // Sum of categories

  warnings: string[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeScheduleA(
  companyId: string,
  year: number,
  opts?: { agi?: number },
): ScheduleAData {
  const company = db.getById('companies', companyId) as any || {};
  void year;

  const agi = round2(opts?.agi || 0);
  const medicalFloor = round2(agi * 0.075);

  const warnings: string[] = [
    'Schedule A is for personal itemized deductions. Compare your total against the standard deduction for your filing status before filing — only itemize if your total exceeds the standard.',
    'SALT is capped at $10,000 — if state income + real estate + personal property taxes exceed this, line 5e clamps to 10000.',
    'Use the Tax Deduction Finder (Reports → Tax Deduction Scan) to surface business expenses that may also belong on Schedule A.',
  ];

  return {
    taxpayer_name: company.legal_name || company.name || '',
    ssn: '',
    year,
    line1_medical_dental: 0,
    line2_agi: agi,
    line3_agi_floor: medicalFloor,
    line4_medical_deduction: 0,
    line5a_state_local_income_or_sales: 0,
    line5a_check_sales_tax: false,
    line5b_state_local_real_estate: 0,
    line5c_state_local_personal_property: 0,
    line5d_total_5a_5b_5c: 0,
    line5e_smaller_of_5d_or_10000: 0,
    line6_other_taxes: 0,
    line7_total_taxes: 0,
    line8a_home_mortgage_interest_reported_1098: 0,
    line8b_home_mortgage_interest_not_reported: 0,
    line8c_points_not_reported_1098: 0,
    line8d_reserved: 0,
    line8e_total_8a_8b_8c: 0,
    line9_investment_interest: 0,
    line10_total_interest: 0,
    line11_cash_check: 0,
    line12_other_than_cash: 0,
    line13_carryover_prior_year: 0,
    line14_total_charity: 0,
    line15_casualty_theft: 0,
    line16_other: [],
    line16_total_other: 0,
    line17_total_itemized: 0,
    warnings,
  };
}
