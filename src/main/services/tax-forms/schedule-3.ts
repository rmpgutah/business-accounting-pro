// src/main/services/tax-forms/schedule-3.ts
//
// IRS 1040 Schedule 3 — Additional Credits and Payments.
//
// Part I (lines 1-8): Nonrefundable credits.
// Part II (lines 9-15): Refundable credits and other payments.
//
// Most credits are personal (children, dependent care, etc.).
// Business owners filing pass-throughs can claim the QBI deduction
// (Form 8995) which IS book-derived, but QBI is on the main 1040
// (line 13), not Schedule 3.
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-schedule-3-form-1040

import * as db from '../../database';

export interface Schedule3Data {
  taxpayer_name: string;
  ssn: string;
  year: number;

  // Part I — Nonrefundable Credits
  line1_foreign_tax_credit: number;
  line2_dependent_care_credit: number;
  line3_education_credit: number;
  line4_retirement_savings_credit: number;
  line5a_residential_clean_energy: number;
  line5b_energy_efficient_home: number;
  line6_other_nonrefundable_credits: Array<{ label: string; amount: number }>;
  line7_total_other_credits: number;
  line8_total_part1: number;             // Sum 1-7

  // Part II — Refundable Credits / Other Payments
  line9_net_premium_tax_credit: number;          // Form 8962
  line10_amount_paid_with_extension: number;     // Form 4868 deposit
  line11_excess_ss_tier1_rrta_tax: number;
  line12_credit_fed_tax_on_fuels: number;        // Form 4136
  line13_other_payments: Array<{ label: string; amount: number }>;
  line14_total_other_payments: number;
  line15_total_part2: number;             // Sum 9-14

  warnings: string[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeSchedule3(companyId: string, year: number): Schedule3Data {
  const company = db.getById('companies', companyId) as any || {};

  // Most credits are personal — autofill nothing, return all-zeros stub.
  void year;
  const warnings: string[] = [
    'Schedule 3 credits are mostly personal (dependents, education, energy). Fill in applicable credits manually before filing.',
  ];

  return {
    taxpayer_name: company.legal_name || company.name || '',
    ssn: '',
    year,
    line1_foreign_tax_credit: 0,
    line2_dependent_care_credit: 0,
    line3_education_credit: 0,
    line4_retirement_savings_credit: 0,
    line5a_residential_clean_energy: 0,
    line5b_energy_efficient_home: 0,
    line6_other_nonrefundable_credits: [],
    line7_total_other_credits: 0,
    line8_total_part1: 0,
    line9_net_premium_tax_credit: 0,
    line10_amount_paid_with_extension: 0,
    line11_excess_ss_tier1_rrta_tax: 0,
    line12_credit_fed_tax_on_fuels: 0,
    line13_other_payments: [],
    line14_total_other_payments: 0,
    line15_total_part2: 0,
    warnings,
  };
  void round2;
}
