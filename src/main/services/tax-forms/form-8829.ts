// src/main/services/tax-forms/form-8829.ts
//
// IRS Form 8829 — Expenses for Business Use of Your Home.
//
// Filed by Schedule C filers claiming the home-office deduction
// under the actual-expense method. (Simplified method = $5/sq ft
// up to 300 sq ft, claimed directly on Schedule C line 30 without
// this form.)
//
// Form has 4 parts:
//   I    Part of your home used for business — square footage %
//   II   Indirect expenses × business-use % + direct expenses
//   III  Depreciation of home (39-year SL, nonresidential real)
//   IV   Carryover of unallowed expenses to next year
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-form-8829

import { computeScheduleC } from './schedule-c';
import * as db from '../../database';

export interface Form8829Data {
  taxpayer_name: string;
  ssn: string;
  year: number;

  // Part I — Part of your home used for business
  line1_business_sq_ft: number;
  line2_total_sq_ft: number;
  line3_business_pct: number;                 // line 1 / line 2 × 100
  line4_daycare_hours: number;                 // Daycare-specific; default 0
  line5_total_hours_available: number;          // 8,760 for full-year (24 × 365)
  line6_daycare_pct: number;                    // Daycare-specific
  line7_business_use_pct: number;                // line 3 (or line 6 if daycare)

  // Part II — Allowable deduction
  line8_gross_income_from_home_use: number;       // From Schedule C line 28 + line 6 (Schedule C)
  // Direct vs Indirect column
  line9_casualty_losses_indirect: number;
  line9_casualty_losses_direct: number;
  line10_deductible_mortgage_interest: number;
  line11_real_estate_taxes: number;
  line12_total_lines_9_10_11: number;
  line13_multiply_line_12_by_business_pct: number;
  line14_add_direct_lines: number;
  line15_subtract_line_14_from_line_8: number;     // Tentative income before other expenses

  line16_excess_mortgage_interest_indirect: number;
  line17_excess_real_estate_taxes_indirect: number;
  line18_insurance_indirect: number;
  line19_rent_indirect: number;
  line20_repairs_maintenance_indirect: number;
  line21_utilities_indirect: number;
  line22_other_expenses_indirect: number;

  line23_other_direct: number;
  line24_total_indirect_lines_16_22: number;
  line25_multiply_line_24_by_business_pct: number;
  line26_add_line_23: number;
  line27_carryover_prior_year: number;

  line28_allowable_operating_expenses: number;     // min(line 26 + 27, line 15)
  line29_remaining_income: number;                  // line 15 − line 28

  // Part III — Depreciation
  line30_excess_casualty_losses: number;
  line31_depreciation_of_home: number;
  line32_carryover_depreciation: number;
  line33_total_lines_30_31_32: number;
  line34_allowable_depreciation: number;            // min(line 33, line 29)
  line35_total_home_office_deduction: number;        // line 14 + line 28 + line 34

  // Part III — Depreciation worksheet
  line36_smaller_of_basis_or_fmv: number;
  line37_value_of_land: number;
  line38_basis_of_building: number;
  line39_business_basis_of_building: number;        // line 38 × line 7%
  line40_depreciation_pct: number;                   // 2.564% for 39-year nonresidential
  line41_depreciation_for_year: number;              // line 39 × line 40

  // Part IV — Carryover
  line42_operating_expenses_carryover: number;
  line43_excess_casualty_carryover: number;
  line44_depreciation_carryover: number;

  warnings: string[];
}

export interface Form8829Opts {
  business_sq_ft?: number;
  total_sq_ft?: number;
  // Whole-home expenses (we apply business-use % automatically)
  home_mortgage_interest?: number;            // total annual
  real_estate_taxes?: number;                  // total annual
  homeowners_insurance?: number;               // total annual
  rent?: number;                                // if renting
  utilities?: number;                           // electricity + gas + water
  repairs_maintenance?: number;                  // total
  other_indirect?: number;
  // Direct (100% business) expenses
  direct_repairs?: number;                       // e.g., painting just the office
  direct_utilities?: number;                     // a separate phone line for the office
  // Depreciation inputs (typically only homeowners depreciate; renters skip)
  cost_basis_of_home?: number;                    // Purchase price + improvements
  value_of_land?: number;                          // Land doesn't depreciate
  // Carryovers from prior year
  carryover_operating_expenses?: number;
  carryover_depreciation?: number;
}

const DEPRECIATION_PCT_NONRES_REAL = 0.02564;       // 39-year SL, MM convention
const HOURS_PER_YEAR = 8760;                          // 24 × 365

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeForm8829(
  companyId: string,
  year: number,
  opts: Form8829Opts = {},
): Form8829Data {
  const company = db.getById('companies', companyId) as any || {};

  // Pull Schedule C for line 8 (gross income before home-office deduction)
  const scheduleC = computeScheduleC(companyId, year);
  // Schedule C line 8 = gross income (line 7) − tentative profit excluding home (line 28+30)
  // We approximate: line 7 (gross income) minus line 28 (total non-home expenses)
  const grossIncome = round2((scheduleC as any).line7_gross_income || (scheduleC as any).gross_income || 0);
  const totalExpenses = round2((scheduleC as any).line28_total_expenses || (scheduleC as any).total_expenses || 0);
  const tentativeIncomeForHome = Math.max(0, round2(grossIncome - totalExpenses));

  // Part I — Square footage
  const businessSqFt = round2(opts.business_sq_ft || 0);
  const totalSqFt = round2(opts.total_sq_ft || 0);
  const businessPct = totalSqFt > 0 ? round2((businessSqFt / totalSqFt) * 100) : 0;
  const businessPctDecimal = businessPct / 100;

  // Part II — Indirect expenses (apply business-use %)
  const mortgageInterest = round2(opts.home_mortgage_interest || 0);
  const realEstateTaxes = round2(opts.real_estate_taxes || 0);
  const insurance = round2(opts.homeowners_insurance || 0);
  const rent = round2(opts.rent || 0);
  const utilities = round2(opts.utilities || 0);
  const repairs = round2(opts.repairs_maintenance || 0);
  const otherIndirect = round2(opts.other_indirect || 0);

  const directRepairs = round2(opts.direct_repairs || 0);
  const directUtilities = round2(opts.direct_utilities || 0);

  // Lines 10/11: deductible mortgage interest + real estate taxes (full amounts)
  const line10 = mortgageInterest;
  const line11 = realEstateTaxes;
  const line12 = round2(line10 + line11);                                  // Casualty + interest + taxes (we set casualty = 0)
  const line13 = round2(line12 * businessPctDecimal);
  const line14 = 0;                                                          // Direct casualty + interest + taxes (rare; default 0)
  const line15 = Math.max(0, round2(tentativeIncomeForHome - line14));      // Tentative income limit before other expenses

  // Lines 18-22: Indirect expenses (insurance, rent, utilities, repairs, etc.)
  const line18 = insurance;
  const line19 = rent;
  const line20 = repairs;
  const line21 = utilities;
  const line22 = otherIndirect;
  const line24 = round2(line18 + line19 + line20 + line21 + line22);
  const line25 = round2(line24 * businessPctDecimal);
  const line23 = round2(directRepairs + directUtilities);
  const line26 = round2(line25 + line23);

  const line27 = round2(opts.carryover_operating_expenses || 0);
  // Operating expense deduction is limited by remaining income after lines 9-14
  const line28 = round2(Math.min(line26 + line27, Math.max(0, line15)));
  const line29 = Math.max(0, round2(line15 - line28));

  // Part III — Depreciation
  const homeCostBasis = round2(opts.cost_basis_of_home || 0);
  const landValue = round2(opts.value_of_land || 0);
  const buildingBasis = Math.max(0, round2(homeCostBasis - landValue));
  const businessBasis = round2(buildingBasis * businessPctDecimal);
  const annualDepreciation = round2(businessBasis * DEPRECIATION_PCT_NONRES_REAL);

  const line31 = annualDepreciation;
  const line32 = round2(opts.carryover_depreciation || 0);
  const line33 = round2(line31 + line32);
  const line34 = round2(Math.min(line33, line29));
  const line35 = round2(line14 + line28 + line34);   // TOTAL home office deduction → Schedule C line 30

  // Part IV — Carryover
  const line42 = Math.max(0, round2(line26 + line27 - line28));
  const line44 = Math.max(0, round2(line33 - line34));

  const warnings: string[] = [];
  if (businessSqFt === 0 || totalSqFt === 0) {
    warnings.push('Square footage not provided. Pass via opts.business_sq_ft and opts.total_sq_ft. Without these, the deduction is $0.');
  }
  if (businessSqFt > totalSqFt && totalSqFt > 0) {
    warnings.push('Business sq ft (' + businessSqFt + ') exceeds total sq ft (' + totalSqFt + ') — check inputs.');
  }
  if (homeCostBasis === 0 && rent === 0) {
    warnings.push('No home cost basis or rent provided — depreciation (line 31) and rent (line 19) will be $0.');
  }
  if (homeCostBasis > 0 && landValue === 0) {
    warnings.push('Land value not provided — typically 20-25% of total cost. Pass via opts.value_of_land. Land does not depreciate.');
  }
  if (line26 + line27 > line15 && line15 > 0) {
    warnings.push('Operating expenses ($' + (line26 + line27).toFixed(2) + ') exceed the income limit ($' + line15.toFixed(2) + '). Excess of $' + line42.toFixed(2) + ' carries forward to next year.');
  }
  if (tentativeIncomeForHome === 0) {
    warnings.push('Schedule C tentative profit is $0 — home-office deduction can\'t exceed business income (it cannot create a loss).');
  }
  if (businessSqFt > 0 && businessSqFt <= 300) {
    warnings.push('Tip: If business sq ft ≤ 300, the simplified method ($5 × sq ft = $' + (businessSqFt * 5).toFixed(2) + ') may be easier. Compare against Form 8829 line 35.');
  }

  return {
    taxpayer_name: company.legal_name || company.name || '',
    ssn: '',
    year,

    line1_business_sq_ft: businessSqFt,
    line2_total_sq_ft: totalSqFt,
    line3_business_pct: businessPct,
    line4_daycare_hours: 0,
    line5_total_hours_available: HOURS_PER_YEAR,
    line6_daycare_pct: 0,
    line7_business_use_pct: businessPct,

    line8_gross_income_from_home_use: tentativeIncomeForHome,
    line9_casualty_losses_indirect: 0,
    line9_casualty_losses_direct: 0,
    line10_deductible_mortgage_interest: line10,
    line11_real_estate_taxes: line11,
    line12_total_lines_9_10_11: line12,
    line13_multiply_line_12_by_business_pct: line13,
    line14_add_direct_lines: line14,
    line15_subtract_line_14_from_line_8: line15,

    line16_excess_mortgage_interest_indirect: 0,
    line17_excess_real_estate_taxes_indirect: 0,
    line18_insurance_indirect: line18,
    line19_rent_indirect: line19,
    line20_repairs_maintenance_indirect: line20,
    line21_utilities_indirect: line21,
    line22_other_expenses_indirect: line22,

    line23_other_direct: line23,
    line24_total_indirect_lines_16_22: line24,
    line25_multiply_line_24_by_business_pct: line25,
    line26_add_line_23: line26,
    line27_carryover_prior_year: line27,

    line28_allowable_operating_expenses: line28,
    line29_remaining_income: line29,

    line30_excess_casualty_losses: 0,
    line31_depreciation_of_home: line31,
    line32_carryover_depreciation: line32,
    line33_total_lines_30_31_32: line33,
    line34_allowable_depreciation: line34,
    line35_total_home_office_deduction: line35,

    line36_smaller_of_basis_or_fmv: homeCostBasis,
    line37_value_of_land: landValue,
    line38_basis_of_building: buildingBasis,
    line39_business_basis_of_building: businessBasis,
    line40_depreciation_pct: DEPRECIATION_PCT_NONRES_REAL,
    line41_depreciation_for_year: annualDepreciation,

    line42_operating_expenses_carryover: line42,
    line43_excess_casualty_carryover: 0,
    line44_depreciation_carryover: line44,

    warnings,
  };
}
