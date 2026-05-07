// src/main/services/tax-forms/form-1120.ts
//
// IRS Form 1120 — U.S. Corporation Income Tax Return.
//
// Filed by C-corporations. Unlike pass-through entities, C-corps pay
// income tax at the entity level (currently flat 21%). Distributions
// to shareholders as dividends are taxed AGAIN at the personal level
// — the famous "double taxation" of C-corps.
//
// Form structure:
//   • Income (lines 1-11)
//   • Deductions (lines 12-29)
//   • Taxable income (line 30) and tax (line 31)
//   • Schedule J — Tax Computation
//   • Schedule K — Other Information
//   • Schedule L — Balance Sheet
//   • Schedule M-1 — Reconciliation of Income/Loss per Books
//   • Schedule M-2 — Analysis of Unappropriated Retained Earnings
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-form-1120

import { buildTrialBalanceMap, round2 } from './entity-return-shared';
import * as db from '../../database';

const C_CORP_TAX_RATE = 0.21;       // Flat 21% under TCJA

export interface Form1120Data {
  entity_name: string;
  trade_name: string;
  ein: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  date_incorporated: string;
  total_assets: number;
  year: number;

  is_initial_return: boolean;
  is_final_return: boolean;
  is_amended_return: boolean;
  is_consolidated: boolean;

  // Part 1 — Income
  line1a_gross_receipts: number;
  line1b_returns_allowances: number;
  line1c_balance: number;
  line2_cost_of_goods_sold: number;
  line3_gross_profit: number;
  line4_dividends_special_deductions: number;
  line5_interest: number;
  line6_gross_rents: number;
  line7_gross_royalties: number;
  line8_capital_gain_net_income: number;
  line9_net_gain_form_4797: number;
  line10_other_income: number;
  line11_total_income: number;

  // Part 2 — Deductions
  line12_compensation_officers: number;
  line13_salaries_wages: number;
  line14_repairs_maintenance: number;
  line15_bad_debts: number;
  line16_rents: number;
  line17_taxes_licenses: number;
  line18_interest: number;
  line19_charitable_contributions: number;
  line20_depreciation: number;
  line21_depletion: number;
  line22_advertising: number;
  line23_pension_profit_sharing: number;
  line24_employee_benefit_programs: number;
  line25_reserved: number;
  line26_other_deductions: number;
  line27_total_deductions: number;

  line28_taxable_income_before_nol_dividends_received: number;
  line29a_net_operating_loss_deduction: number;
  line29b_special_deductions: number;
  line29c_total_29a_29b: number;
  line30_taxable_income: number;        // line 28 − 29c
  line31_total_tax: number;              // From Schedule J (21% × line 30 simplified)

  line32_estimated_tax_payments: number;
  line33_balance_due: number;            // line 31 − line 32 (if positive)
  line34_overpayment: number;            // line 32 − line 31 (if positive)

  // Schedule J simplification
  schJ_tax_rate: number;                  // 0.21
  schJ_tentative_tax: number;             // line 30 × 0.21

  // Schedule M-1
  m1_net_income_per_books: number;

  warnings: string[];
}

export interface Form1120Opts {
  date_incorporated?: string;
  total_assets?: number;
  is_initial_return?: boolean;
  is_final_return?: boolean;
  is_amended_return?: boolean;
  is_consolidated?: boolean;
  // Manual line overrides
  line4_dividends_special_deductions?: number;
  line8_capital_gain_net_income?: number;
  line9_net_gain_form_4797?: number;
  line10_other_income?: number;
  line29a_nol_deduction?: number;
  line29b_special_deductions?: number;
  line32_estimated_tax_payments?: number;
}

export function computeForm1120(
  companyId: string,
  year: number,
  opts: Form1120Opts = {},
): Form1120Data {
  const company = db.getById('companies', companyId) as any || {};
  const tb = buildTrialBalanceMap(companyId, year);

  const line1a = tb.gross_receipts;
  const line1b = tb.returns_allowances;
  const line1c = round2(line1a - line1b);
  const line2 = tb.cogs;
  const line3 = round2(line1c - line2);
  const line4 = round2(opts.line4_dividends_special_deductions || tb.dividend_income);
  const line5 = tb.interest_income;
  const line6 = tb.rental_income;
  const line7 = tb.royalty_income;
  const line8 = round2(opts.line8_capital_gain_net_income || tb.capital_gains);
  const line9 = round2(opts.line9_net_gain_form_4797 || 0);
  const line10 = round2(opts.line10_other_income || 0);
  const line11 = round2(line3 + line4 + line5 + line6 + line7 + line8 + line9 + line10);

  const line12 = tb.officer_compensation;
  const line13 = tb.salaries_wages;
  const line14 = tb.repairs_maintenance;
  const line15 = tb.bad_debts;
  const line16 = tb.rent;
  const line17 = tb.taxes_licenses;
  const line18 = tb.interest_expense;
  const line19 = tb.charitable_contributions;
  const line20 = tb.depreciation;
  const line21 = tb.depletion;
  const line22 = tb.advertising;
  const line23 = tb.pension_profit_sharing;
  const line24 = tb.employee_benefits;
  const line26 = tb.other_deductions;
  const line27 = round2(line12 + line13 + line14 + line15 + line16 + line17 + line18 + line19 +
    line20 + line21 + line22 + line23 + line24 + line26);

  const line28 = round2(line11 - line27);
  const line29a = round2(opts.line29a_nol_deduction || 0);
  const line29b = round2(opts.line29b_special_deductions || 0);
  const line29c = round2(line29a + line29b);
  const line30 = round2(line28 - line29c);

  // Schedule J — Tax computation. The actual form has many sub-lines
  // (foreign tax credit, AMT, etc.); the dominant case is flat 21%.
  const schJ_tentative = round2(Math.max(0, line30) * C_CORP_TAX_RATE);
  const line31 = schJ_tentative;
  const line32 = round2(opts.line32_estimated_tax_payments || 0);
  const line33 = Math.max(0, round2(line31 - line32));
  const line34 = Math.max(0, round2(line32 - line31));

  const warnings: string[] = [];
  if (line30 < 0) {
    warnings.push('Net operating loss of $' + Math.abs(line30).toFixed(2) + ' — can be carried forward indefinitely (TCJA rule). Save line 30 for next year\'s opts.line29a_nol_deduction.');
  }
  if (line19 > line28 * 0.10 && line28 > 0) {
    warnings.push('Charitable contributions ($' + line19.toFixed(2) + ') exceed 10% of taxable income ($' + (line28 * 0.10).toFixed(2) + '). Excess carries forward 5 years.');
  }
  if (line33 > 0 && line32 === 0) {
    warnings.push('No estimated tax payments tracked (line 32 = $0). C-corps must pay quarterly estimates if expected tax liability exceeds $500.');
  }
  if (line12 === 0 && line13 > 0) {
    warnings.push('Officer compensation (line 12) is $0 but other salaries are non-zero. C-corp owners working in the business must take "reasonable compensation" — flag for IRS audit risk.');
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
    total_assets: round2(opts.total_assets || 0),
    year,

    is_initial_return: !!opts.is_initial_return,
    is_final_return: !!opts.is_final_return,
    is_amended_return: !!opts.is_amended_return,
    is_consolidated: !!opts.is_consolidated,

    line1a_gross_receipts: line1a,
    line1b_returns_allowances: line1b,
    line1c_balance: line1c,
    line2_cost_of_goods_sold: line2,
    line3_gross_profit: line3,
    line4_dividends_special_deductions: line4,
    line5_interest: line5,
    line6_gross_rents: line6,
    line7_gross_royalties: line7,
    line8_capital_gain_net_income: line8,
    line9_net_gain_form_4797: line9,
    line10_other_income: line10,
    line11_total_income: line11,

    line12_compensation_officers: line12,
    line13_salaries_wages: line13,
    line14_repairs_maintenance: line14,
    line15_bad_debts: line15,
    line16_rents: line16,
    line17_taxes_licenses: line17,
    line18_interest: line18,
    line19_charitable_contributions: line19,
    line20_depreciation: line20,
    line21_depletion: line21,
    line22_advertising: line22,
    line23_pension_profit_sharing: line23,
    line24_employee_benefit_programs: line24,
    line25_reserved: 0,
    line26_other_deductions: line26,
    line27_total_deductions: line27,

    line28_taxable_income_before_nol_dividends_received: line28,
    line29a_net_operating_loss_deduction: line29a,
    line29b_special_deductions: line29b,
    line29c_total_29a_29b: line29c,
    line30_taxable_income: line30,
    line31_total_tax: line31,

    line32_estimated_tax_payments: line32,
    line33_balance_due: line33,
    line34_overpayment: line34,

    schJ_tax_rate: C_CORP_TAX_RATE,
    schJ_tentative_tax: schJ_tentative,

    m1_net_income_per_books: round2(line30 - line29c),

    warnings,
  };
}
