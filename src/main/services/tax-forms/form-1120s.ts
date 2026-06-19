// src/main/services/tax-forms/form-1120s.ts
//
// IRS Form 1120-S — U.S. Income Tax Return for an S Corporation.
//
// Filed by S-corporations. Like partnerships, S-corps are pass-through
// entities — the entity does not pay federal income tax (with rare
// exceptions for built-in gains and excess passive income). Income/
// losses pass through to shareholders via Schedule K-1 (1120-S).
//
// Form structure mirrors 1065 but with S-corp-specific rules:
//   • All shareholders must be US individuals (or qualifying trusts)
//   • One class of stock only
//   • Reasonable compensation for owner-employees (FICA tax)
//   • No "guaranteed payments" — owners take W-2 salary + K-1 income
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-form-1120-s

import { buildTrialBalanceMap, round2, PartnerOrShareholder } from './entity-return-shared';
import * as db from '../../database';

export interface Form1120SData {
  entity_name: string;
  trade_name: string;
  ein: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  date_incorporated: string;
  date_s_election: string;             // When entity elected S-corp via Form 2553
  business_activity: string;
  product_or_service: string;
  total_assets: number;
  year: number;

  is_initial_return: boolean;
  is_final_return: boolean;
  is_amended_return: boolean;
  number_of_shareholders: number;

  // Part 1 — Income
  line1a_gross_receipts: number;
  line1b_returns_allowances: number;
  line1c_balance: number;
  line2_cost_of_goods_sold: number;
  line3_gross_profit: number;
  line4_net_gain_form_4797: number;
  line5_other_income: number;
  line6_total_income: number;

  // Part 2 — Deductions
  line7_compensation_officers: number;       // Owner-employee W-2 wages
  line8_salaries_wages: number;
  line9_repairs_maintenance: number;
  line10_bad_debts: number;
  line11_rents: number;
  line12_taxes_licenses: number;
  line13_interest: number;
  line14_depreciation: number;
  line15_depletion: number;
  line16_advertising: number;
  line17_pension_profit_sharing: number;
  line18_employee_benefit_programs: number;
  line19_other_deductions: number;
  line20_total_deductions: number;

  line21_ordinary_business_income_loss: number;     // line 6 - line 20

  // Part 3 — Tax (S-corps almost always have $0 entity-level tax)
  line22a_excess_net_passive_income_tax: number;
  line22b_built_in_gains_tax: number;
  line22c_total_tax: number;

  // Schedule K — Total shareholders' shares
  schK_ordinary_business_income: number;
  schK_net_rental_real_estate: number;
  schK_other_net_rental: number;
  schK_interest_income: number;
  schK_dividend_income: number;
  schK_royalties: number;
  schK_net_short_term_cap_gain: number;
  schK_net_long_term_cap_gain: number;
  schK_section_1231_gain: number;
  schK_charitable_contributions: number;
  schK_section_179_deduction: number;
  schK_distributions: number;                // Cash/property distributions to shareholders

  // Shareholders list
  shareholders: PartnerOrShareholder[];

  warnings: string[];
}

export interface Form1120SOpts {
  date_incorporated?: string;
  date_s_election?: string;
  business_activity?: string;
  product_or_service?: string;
  total_assets?: number;
  is_initial_return?: boolean;
  is_final_return?: boolean;
  is_amended_return?: boolean;
  shareholders?: PartnerOrShareholder[];
  // Manual line overrides
  line4_net_gain_form_4797?: number;
  line5_other_income?: number;
  schK_distributions?: number;
  schK_section_1231_gain?: number;
}

export function computeForm1120S(
  companyId: string,
  year: number,
  opts: Form1120SOpts = {},
): Form1120SData {
  const company = db.getById('companies', companyId) as any || {};
  const tb = buildTrialBalanceMap(companyId, year);

  const line1a = tb.gross_receipts;
  const line1b = tb.returns_allowances;
  const line1c = round2(line1a - line1b);
  const line2 = tb.cogs;
  const line3 = round2(line1c - line2);
  const line4 = round2(opts.line4_net_gain_form_4797 || 0);
  const line5 = round2(opts.line5_other_income || 0);
  const line6 = round2(line3 + line4 + line5);

  const line7 = tb.officer_compensation;
  const line8 = tb.salaries_wages;
  const line9 = tb.repairs_maintenance;
  const line10 = tb.bad_debts;
  const line11 = tb.rent;
  const line12 = tb.taxes_licenses;
  const line13 = tb.interest_expense;
  const line14 = tb.depreciation;
  const line15 = tb.depletion;
  const line16 = tb.advertising;
  const line17 = tb.pension_profit_sharing;
  const line18 = tb.employee_benefits;
  const line19 = tb.other_deductions;
  const line20 = round2(line7 + line8 + line9 + line10 + line11 + line12 + line13 + line14 +
    line15 + line16 + line17 + line18 + line19);
  const line21 = round2(line6 - line20);

  // Tax: most S-corps have $0
  const line22a = 0;
  const line22b = 0;
  const line22c = round2(line22a + line22b);

  const shareholders = opts.shareholders || [];
  const ownershipTotal = shareholders.reduce((s, p) => s + (p.ownership_pct || 0), 0);

  const warnings: string[] = [];
  if (shareholders.length === 0) {
    warnings.push('No shareholders on file. Pass shareholders array via opts.shareholders — required for K-1 generation.');
  }
  if (shareholders.length > 100) {
    warnings.push('S-corps are limited to 100 shareholders. ' + shareholders.length + ' provided — entity may have lost S-corp status.');
  }
  if (shareholders.length > 0 && Math.abs(ownershipTotal - 100) > 0.5) {
    warnings.push('Shareholder ownership totals ' + ownershipTotal.toFixed(2) + '% (should sum to 100%).');
  }
  if (line7 === 0 && line21 > 50000) {
    warnings.push('Officer compensation (line 7) is $0 but ordinary income exceeds $50K. S-corp owner-employees must take "reasonable compensation" — IRS audit risk if owners take only K-1 distributions to avoid SE tax.');
  }
  if (line21 < 0) {
    warnings.push('Ordinary business loss of $' + Math.abs(line21).toFixed(2) + ' — passes through to shareholders subject to basis, at-risk, and passive-activity limits.');
  }
  if (!company.ein && !company.tax_id) {
    warnings.push('S-corporation EIN missing — required on Form 1120-S.');
  }

  return {
    entity_name: company.legal_name || company.name || '',
    trade_name: company.name || '',
    ein: company.ein || company.tax_id || '',
    address: company.address_line1 || '',
    city: company.city || '',
    state: company.state || '',
    zip: company.zip || '',
    date_incorporated: opts.date_incorporated || company.formation_date || '',
    date_s_election: opts.date_s_election || '',
    business_activity: opts.business_activity || company.industry || '',
    product_or_service: opts.product_or_service || '',
    total_assets: round2(opts.total_assets || 0),
    year,

    is_initial_return: !!opts.is_initial_return,
    is_final_return: !!opts.is_final_return,
    is_amended_return: !!opts.is_amended_return,
    number_of_shareholders: shareholders.length,

    line1a_gross_receipts: line1a,
    line1b_returns_allowances: line1b,
    line1c_balance: line1c,
    line2_cost_of_goods_sold: line2,
    line3_gross_profit: line3,
    line4_net_gain_form_4797: line4,
    line5_other_income: line5,
    line6_total_income: line6,

    line7_compensation_officers: line7,
    line8_salaries_wages: line8,
    line9_repairs_maintenance: line9,
    line10_bad_debts: line10,
    line11_rents: line11,
    line12_taxes_licenses: line12,
    line13_interest: line13,
    line14_depreciation: line14,
    line15_depletion: line15,
    line16_advertising: line16,
    line17_pension_profit_sharing: line17,
    line18_employee_benefit_programs: line18,
    line19_other_deductions: line19,
    line20_total_deductions: line20,

    line21_ordinary_business_income_loss: line21,

    line22a_excess_net_passive_income_tax: line22a,
    line22b_built_in_gains_tax: line22b,
    line22c_total_tax: line22c,

    schK_ordinary_business_income: line21,
    schK_net_rental_real_estate: 0,
    schK_other_net_rental: 0,
    schK_interest_income: tb.interest_income,
    schK_dividend_income: tb.dividend_income,
    schK_royalties: tb.royalty_income,
    schK_net_short_term_cap_gain: 0,
    schK_net_long_term_cap_gain: tb.capital_gains,
    schK_section_1231_gain: round2(opts.schK_section_1231_gain || 0),
    schK_charitable_contributions: tb.charitable_contributions,
    schK_section_179_deduction: 0,
    schK_distributions: round2(opts.schK_distributions || 0),

    shareholders,
    warnings,
  };
}
