// src/main/services/tax-forms/schedule-2.ts
//
// IRS 1040 Schedule 2 — Additional Taxes.
//
// Part I (lines 1-3): AMT and advance premium tax credit excess.
// Part II (lines 4-21): SE tax, addtl Medicare, NIIT, household
// employment, retirement excess contributions, etc.
//
// For accounting users:
//   • Line 4 = SE tax (autofilled from Schedule SE)
//   • Most other lines are personal — manual entry
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-schedule-2-form-1040

import { computeScheduleSE } from './schedule-se';
import * as db from '../../database';

export interface Schedule2Data {
  taxpayer_name: string;
  ssn: string;
  year: number;

  // Part I — Tax
  line1_amt: number;                          // Form 6251
  line2_excess_advance_premium_credit: number; // Form 8962
  line3_total_part1: number;                   // 1 + 2

  // Part II — Other Taxes
  line4_se_tax: number;                        // From Schedule SE line 12
  line5_unreported_ss_medicare_tip: number;    // Form 4137
  line6_uncollected_ss_medicare: number;       // Form 8919
  line7_total_addtl_ss_medicare: number;       // 5 + 6
  line8_addtl_tax_iras: number;                // Form 5329
  line9_household_employment_taxes: number;     // Schedule H
  line10_first_time_homebuyer_credit_repay: number; // Form 5405
  line11_addtl_medicare_tax: number;            // Form 8959
  line12_net_investment_income_tax: number;     // Form 8960 (NIIT)
  line13_section_965_deferred: number;
  line14_interest_owed_section_453a: number;
  line15_interest_on_tax_due_installment: number;
  line16_recapture_low_income_housing: number;
  line17_other_addtl_taxes: Array<{ label: string; amount: number }>;
  line18_total_addtl_other: number;             // Sum of 17 items
  line19_reserved: number;
  line20_section_965_net_tax_liability: number;
  line21_total_other_taxes: number;             // Lines 4-20

  warnings: string[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeSchedule2(companyId: string, year: number, opts?: { w2_other_wages?: number }): Schedule2Data {
  const company = db.getById('companies', companyId) as any || {};
  const scheduleSE = computeScheduleSE(companyId, year, { w2_ss_wages: opts?.w2_other_wages });

  const line4 = round2((scheduleSE as any).line12_total_se_tax || 0);
  const line21 = round2(line4); // Most other lines are personal

  const warnings: string[] = [];
  if (line4 > 0) warnings.push('SE tax of $' + line4.toFixed(2) + ' flows from Schedule SE. Half of this is deductible on Schedule 1 line 15.');
  if (line21 === line4) warnings.push('Lines 5-20 default to $0 — fill any applicable additional taxes before filing.');

  return {
    taxpayer_name: company.legal_name || company.name || '',
    ssn: '',
    year,
    line1_amt: 0,
    line2_excess_advance_premium_credit: 0,
    line3_total_part1: 0,
    line4_se_tax: line4,
    line5_unreported_ss_medicare_tip: 0,
    line6_uncollected_ss_medicare: 0,
    line7_total_addtl_ss_medicare: 0,
    line8_addtl_tax_iras: 0,
    line9_household_employment_taxes: 0,
    line10_first_time_homebuyer_credit_repay: 0,
    line11_addtl_medicare_tax: 0,
    line12_net_investment_income_tax: 0,
    line13_section_965_deferred: 0,
    line14_interest_owed_section_453a: 0,
    line15_interest_on_tax_due_installment: 0,
    line16_recapture_low_income_housing: 0,
    line17_other_addtl_taxes: [],
    line18_total_addtl_other: 0,
    line19_reserved: 0,
    line20_section_965_net_tax_liability: 0,
    line21_total_other_taxes: line21,
    warnings,
  };
}
