// src/main/services/tax-forms/form-1065.ts
//
// IRS Form 1065 — U.S. Return of Partnership Income.
//
// Filed by partnerships and multi-member LLCs taxed as partnerships.
// The partnership itself does NOT pay income tax — it passes income/
// losses through to partners via Schedule K-1 (1065). Each partner
// reports their share on their personal return.
//
// Form structure:
//   • Income (lines 1-8)
//   • Deductions (lines 9-21)
//   • Line 22 — Ordinary business income/loss (carries to Schedule K)
//   • Schedule B — Other Information
//   • Schedule K — Total partners' shares of all items (then split
//     proportionally onto each K-1)
//   • Schedule L — Balance Sheet
//   • Schedule M-1 — Reconciliation of Income (book to tax)
//   • Schedule M-2 — Analysis of Partners' Capital Accounts
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-form-1065

import { buildTrialBalanceMap, round2, PartnerOrShareholder } from './entity-return-shared';
import * as db from '../../database';

export interface Form1065Data {
  // Identity
  entity_name: string;
  trade_name: string;
  ein: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  date_business_started: string;
  business_activity: string;
  product_or_service: string;
  business_code: string;             // NAICS code
  total_assets: number;
  year: number;

  // Initial flags (Schedule B-related)
  is_initial_return: boolean;
  is_final_return: boolean;
  is_amended_return: boolean;
  number_of_partners: number;

  // Part 1 — Income
  line1a_gross_receipts: number;
  line1b_returns_allowances: number;
  line1c_balance: number;            // 1a - 1b
  line2_cost_of_goods_sold: number;   // From Form 1125-A
  line3_gross_profit: number;          // 1c - 2
  line4_ordinary_income_other_partnerships: number;
  line5_net_farm_profit: number;
  line6_net_gain_form_4797: number;
  line7_other_income: number;
  line8_total_income: number;          // Sum 3-7

  // Part 2 — Deductions
  line9_salaries_wages: number;       // Less employment credits
  line10_guaranteed_payments_partners: number;
  line11_repairs_maintenance: number;
  line12_bad_debts: number;
  line13_rent: number;
  line14_taxes_licenses: number;
  line15_interest_paid: number;
  line16a_depreciation: number;
  line16b_less_depreciation_on_form_1125a: number;
  line16c_balance_depreciation: number;
  line17_depletion: number;
  line18_retirement_plans: number;
  line19_employee_benefit_programs: number;
  line20_energy_efficient_commercial_buildings: number;
  line21_other_deductions: number;
  line22_total_deductions: number;     // Sum 9-21

  line23_ordinary_business_income: number;  // 8 − 22

  // Schedule K — Distributive shares (carries to all K-1s)
  schK_ordinary_business_income: number;
  schK_net_rental_real_estate: number;
  schK_other_net_rental: number;
  schK_guaranteed_payments: number;
  schK_interest_income: number;
  schK_dividend_income: number;
  schK_royalties: number;
  schK_net_short_term_cap_gain: number;
  schK_net_long_term_cap_gain: number;
  schK_section_1231_gain: number;
  schK_charitable_contributions: number;
  schK_section_179_deduction: number;
  schK_self_employment_earnings: number;

  // Schedule M-1 — Book/tax reconciliation (simplified)
  m1_net_income_per_books: number;
  m1_income_per_books_not_on_return: number;
  m1_expenses_per_books_not_deducted: number;
  m1_income_taxable_not_per_books: number;
  m1_deductions_per_return_not_per_books: number;
  m1_book_tax_difference: number;        // Should equal line 22 income/loss

  // Partners list (provided via opts)
  partners: PartnerOrShareholder[];

  warnings: string[];
}

export interface Form1065Opts {
  business_activity?: string;
  product_or_service?: string;
  business_code?: string;
  date_business_started?: string;
  total_assets?: number;
  is_initial_return?: boolean;
  is_final_return?: boolean;
  is_amended_return?: boolean;
  partners?: PartnerOrShareholder[];
  // Manual line overrides (for items we can't autofill)
  line4_ordinary_income_other_partnerships?: number;
  line5_net_farm_profit?: number;
  line6_net_gain_form_4797?: number;
  line7_other_income?: number;
  // Schedule K rental / capital gain breakouts
  schK_net_rental_real_estate?: number;
  schK_other_net_rental?: number;
  schK_section_1231_gain?: number;
  schK_self_employment_earnings?: number;
}

export function computeForm1065(
  companyId: string,
  year: number,
  opts: Form1065Opts = {},
): Form1065Data {
  const company = db.getById('companies', companyId) as any || {};
  const tb = buildTrialBalanceMap(companyId, year);

  // Income lines
  const line1a = tb.gross_receipts;
  const line1b = tb.returns_allowances;
  const line1c = round2(line1a - line1b);
  const line2 = tb.cogs;
  const line3 = round2(line1c - line2);
  const line4 = round2(opts.line4_ordinary_income_other_partnerships || 0);
  const line5 = round2(opts.line5_net_farm_profit || 0);
  const line6 = round2(opts.line6_net_gain_form_4797 || 0);
  const line7 = round2(opts.line7_other_income || 0);
  const line8 = round2(line3 + line4 + line5 + line6 + line7);

  // Deduction lines
  const line9 = tb.salaries_wages;
  const line10 = tb.guaranteed_payments_partners;
  const line11 = tb.repairs_maintenance;
  const line12 = tb.bad_debts;
  const line13 = tb.rent;
  const line14 = tb.taxes_licenses;
  const line15 = tb.interest_expense;
  const line16a = tb.depreciation;
  const line16b = 0;       // Depreciation already on Form 1125-A (rare)
  const line16c = round2(line16a - line16b);
  const line17 = tb.depletion;
  const line18 = tb.pension_profit_sharing;
  const line19 = tb.employee_benefits;
  const line20 = 0;
  const line21 = tb.other_deductions;
  const line22 = round2(line9 + line10 + line11 + line12 + line13 + line14 + line15 +
    line16c + line17 + line18 + line19 + line20 + line21);
  const line23 = round2(line8 - line22);

  // Partners
  const partners = opts.partners || [];
  const ownershipTotal = partners.reduce((s, p) => s + (p.ownership_pct || 0), 0);

  const warnings: string[] = [];
  if (partners.length === 0) {
    warnings.push('No partners on file. Pass partners array via opts.partners — required to generate per-partner K-1s.');
  }
  if (partners.length > 0 && Math.abs(ownershipTotal - 100) > 0.5) {
    warnings.push('Partner ownership totals ' + ownershipTotal.toFixed(2) + '% (should sum to 100%).');
  }
  if (partners.length === 1) {
    warnings.push('Only 1 partner provided — partnership returns require ≥ 2 partners. Single-member LLCs use Schedule C, not Form 1065.');
  }
  if (line23 < 0) {
    warnings.push('Ordinary business loss of $' + Math.abs(line23).toFixed(2) + ' — losses pass through to partners on K-1, subject to basis and at-risk limits at the partner level.');
  }
  if (!company.ein && !company.tax_id) {
    warnings.push('Partnership EIN missing — required on Form 1065.');
  }

  return {
    entity_name: company.legal_name || company.name || '',
    trade_name: company.name || '',
    ein: company.ein || company.tax_id || '',
    address: company.address_line1 || '',
    city: company.city || '',
    state: company.state || '',
    zip: company.zip || '',
    date_business_started: opts.date_business_started || (company.formation_date || ''),
    business_activity: opts.business_activity || company.industry || '',
    product_or_service: opts.product_or_service || '',
    business_code: opts.business_code || '',
    total_assets: round2(opts.total_assets || 0),
    year,

    is_initial_return: !!opts.is_initial_return,
    is_final_return: !!opts.is_final_return,
    is_amended_return: !!opts.is_amended_return,
    number_of_partners: partners.length,

    line1a_gross_receipts: line1a,
    line1b_returns_allowances: line1b,
    line1c_balance: line1c,
    line2_cost_of_goods_sold: line2,
    line3_gross_profit: line3,
    line4_ordinary_income_other_partnerships: line4,
    line5_net_farm_profit: line5,
    line6_net_gain_form_4797: line6,
    line7_other_income: line7,
    line8_total_income: line8,

    line9_salaries_wages: line9,
    line10_guaranteed_payments_partners: line10,
    line11_repairs_maintenance: line11,
    line12_bad_debts: line12,
    line13_rent: line13,
    line14_taxes_licenses: line14,
    line15_interest_paid: line15,
    line16a_depreciation: line16a,
    line16b_less_depreciation_on_form_1125a: line16b,
    line16c_balance_depreciation: line16c,
    line17_depletion: line17,
    line18_retirement_plans: line18,
    line19_employee_benefit_programs: line19,
    line20_energy_efficient_commercial_buildings: line20,
    line21_other_deductions: line21,
    line22_total_deductions: line22,
    line23_ordinary_business_income: line23,

    schK_ordinary_business_income: line23,
    schK_net_rental_real_estate: round2(opts.schK_net_rental_real_estate || 0),
    schK_other_net_rental: round2(opts.schK_other_net_rental || 0),
    schK_guaranteed_payments: line10,
    schK_interest_income: tb.interest_income,
    schK_dividend_income: tb.dividend_income,
    schK_royalties: tb.royalty_income,
    schK_net_short_term_cap_gain: 0,
    schK_net_long_term_cap_gain: tb.capital_gains,
    schK_section_1231_gain: round2(opts.schK_section_1231_gain || 0),
    schK_charitable_contributions: tb.charitable_contributions,
    schK_section_179_deduction: 0,    // From Form 4562
    schK_self_employment_earnings: round2(opts.schK_self_employment_earnings || line23),

    m1_net_income_per_books: line23,
    m1_income_per_books_not_on_return: 0,
    m1_expenses_per_books_not_deducted: 0,
    m1_income_taxable_not_per_books: 0,
    m1_deductions_per_return_not_per_books: 0,
    m1_book_tax_difference: 0,

    partners,
    warnings,
  };
}
