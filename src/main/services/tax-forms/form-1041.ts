// src/main/services/tax-forms/form-1041.ts
//
// IRS Form 1041 — U.S. Income Tax Return for Estates and Trusts.
//
// Filed by fiduciaries managing estates (after death) or trusts.
// Estates / trusts are pass-through-ish: simple trusts pass everything
// to beneficiaries, complex trusts can accumulate. Tax rates are
// compressed (37% bracket starts at ~$15K of taxable income vs $626K
// for individuals) — strong incentive to distribute.
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-form-1041

import { buildTrialBalanceMap, round2 } from './entity-return-shared';
import * as db from '../../database';

export type Form1041EntityType = 'estate' | 'simple-trust' | 'complex-trust' | 'qualified-disability-trust' | 'esbt' | 'grantor-trust' | 'bankruptcy-estate-ch7' | 'bankruptcy-estate-ch11' | 'pooled-income-fund';

export interface Form1041Data {
  entity_type: Form1041EntityType;
  entity_name: string;
  ein: string;
  fiduciary_name: string;
  fiduciary_address: string;
  date_entity_created: string;
  year: number;

  // Part 1 — Income
  line1_interest_income: number;
  line2a_ordinary_dividends: number;
  line2b_qualified_dividends: number;
  line3_business_income: number;          // Schedule C activities owned by the estate/trust
  line4_capital_gains: number;             // Schedule D
  line5_rents_royalties_partnerships: number;  // Schedule E
  line6_farm_income: number;
  line7_ordinary_gain_loss: number;        // Form 4797
  line8_other_income: number;
  line9_total_income: number;

  // Part 2 — Deductions
  line10_interest: number;
  line11_taxes: number;
  line12_fiduciary_fees: number;
  line13_charitable_contributions: number;
  line14_attorney_accountant_fees: number;
  line15a_other_deductions: number;
  line15b_net_operating_loss: number;
  line16_total_deductions: number;
  line17_adjusted_total_income: number;     // line 9 - line 16
  line18_income_distribution_deduction: number;  // To beneficiaries
  line19_estate_tax_deduction: number;
  line20_qualified_business_income_deduction: number;
  line21_exemption: number;                  // $100 for complex trust, $300 for simple trust, $600 for estate
  line22_taxable_income: number;             // line 17 - 18 - 19 - 20 - 21

  line23_total_tax: number;
  line24_total_payments: number;
  line25_balance_due: number;
  line26_overpayment: number;

  warnings: string[];
}

export interface Form1041Opts {
  entity_type?: Form1041EntityType;
  fiduciary_name?: string;
  fiduciary_address?: string;
  date_entity_created?: string;
  // Manual line overrides
  line1_interest_income?: number;
  line2a_ordinary_dividends?: number;
  line2b_qualified_dividends?: number;
  line4_capital_gains?: number;
  line5_rents_royalties_partnerships?: number;
  line8_other_income?: number;
  line11_taxes?: number;
  line12_fiduciary_fees?: number;
  line13_charitable_contributions?: number;
  line14_attorney_accountant_fees?: number;
  line15a_other_deductions?: number;
  line18_income_distribution_deduction?: number;
  line19_estate_tax_deduction?: number;
  line20_qbi_deduction?: number;
  line24_total_payments?: number;
}

const EXEMPTION_BY_TYPE: Record<Form1041EntityType, number> = {
  'estate': 600,
  'simple-trust': 300,
  'complex-trust': 100,
  'qualified-disability-trust': 5050,    // 2025 — same as personal exemption pre-TCJA, indexed
  'esbt': 0,
  'grantor-trust': 0,
  'bankruptcy-estate-ch7': 14600,
  'bankruptcy-estate-ch11': 14600,
  'pooled-income-fund': 0,
};

// Compressed trust/estate brackets for 2025
const TRUST_BRACKETS_2025 = [
  { min: 0, max: 3150, rate: 0.10 },
  { min: 3150, max: 11450, rate: 0.24 },
  { min: 11450, max: 15650, rate: 0.35 },
  { min: 15650, max: Infinity, rate: 0.37 },
];

function trustTax(taxableIncome: number): number {
  let tax = 0;
  for (const b of TRUST_BRACKETS_2025) {
    if (taxableIncome <= b.min) break;
    const taxable = Math.min(taxableIncome, b.max) - b.min;
    tax += taxable * b.rate;
  }
  return tax;
}

export function computeForm1041(
  companyId: string,
  year: number,
  opts: Form1041Opts = {},
): Form1041Data {
  const company = db.getById('companies', companyId) as any || {};
  const tb = buildTrialBalanceMap(companyId, year);
  const entityType = opts.entity_type || 'complex-trust';

  // If the estate/trust runs a Schedule C-style business through this company,
  // pull its net income; otherwise the trust's "business income" is $0.
  const line3 = round2(tb.net_income);

  const line1 = round2(opts.line1_interest_income || tb.interest_income);
  const line2a = round2(opts.line2a_ordinary_dividends || tb.dividend_income);
  const line2b = round2(opts.line2b_qualified_dividends || 0);
  const line4 = round2(opts.line4_capital_gains || tb.capital_gains);
  const line5 = round2(opts.line5_rents_royalties_partnerships || tb.rental_income + tb.royalty_income);
  const line8 = round2(opts.line8_other_income || 0);
  const line9 = round2(line1 + line2a + line3 + line4 + line5 + line8);

  const line10 = tb.interest_expense;
  const line11 = round2(opts.line11_taxes || tb.taxes_licenses);
  const line12 = round2(opts.line12_fiduciary_fees || 0);
  const line13 = round2(opts.line13_charitable_contributions || tb.charitable_contributions);
  const line14 = round2(opts.line14_attorney_accountant_fees || 0);
  const line15a = round2(opts.line15a_other_deductions || tb.other_deductions);
  const line16 = round2(line10 + line11 + line12 + line13 + line14 + line15a);
  const line17 = round2(line9 - line16);
  const line18 = round2(opts.line18_income_distribution_deduction || 0);
  const line19 = round2(opts.line19_estate_tax_deduction || 0);
  const line20 = round2(opts.line20_qbi_deduction || 0);
  const line21 = EXEMPTION_BY_TYPE[entityType] || 0;
  const line22 = Math.max(0, round2(line17 - line18 - line19 - line20 - line21));
  const line23 = round2(trustTax(line22));
  const line24 = round2(opts.line24_total_payments || 0);
  const line25 = Math.max(0, round2(line23 - line24));
  const line26 = Math.max(0, round2(line24 - line23));

  const warnings: string[] = [];
  if (line22 > 15650) {
    warnings.push('Taxable income above $15,650 hits the 37% trust bracket — consider distributing more to beneficiaries who likely have lower personal rates.');
  }
  if (entityType === 'simple-trust' && line22 > 0) {
    warnings.push('Simple trust must distribute all income — line 18 (income distribution deduction) should typically equal line 17. Trusts retaining income should reclassify as complex.');
  }
  if (!company.ein && !company.tax_id) {
    warnings.push('Estate/trust EIN missing — required on Form 1041.');
  }

  return {
    entity_type: entityType,
    entity_name: company.legal_name || company.name || '',
    ein: company.ein || company.tax_id || '',
    fiduciary_name: opts.fiduciary_name || '',
    fiduciary_address: opts.fiduciary_address || '',
    date_entity_created: opts.date_entity_created || '',
    year,

    line1_interest_income: line1,
    line2a_ordinary_dividends: line2a,
    line2b_qualified_dividends: line2b,
    line3_business_income: line3,
    line4_capital_gains: line4,
    line5_rents_royalties_partnerships: line5,
    line6_farm_income: 0,
    line7_ordinary_gain_loss: 0,
    line8_other_income: line8,
    line9_total_income: line9,

    line10_interest: line10,
    line11_taxes: line11,
    line12_fiduciary_fees: line12,
    line13_charitable_contributions: line13,
    line14_attorney_accountant_fees: line14,
    line15a_other_deductions: line15a,
    line15b_net_operating_loss: 0,
    line16_total_deductions: line16,
    line17_adjusted_total_income: line17,
    line18_income_distribution_deduction: line18,
    line19_estate_tax_deduction: line19,
    line20_qualified_business_income_deduction: line20,
    line21_exemption: line21,
    line22_taxable_income: line22,

    line23_total_tax: line23,
    line24_total_payments: line24,
    line25_balance_due: line25,
    line26_overpayment: line26,

    warnings,
  };
}
