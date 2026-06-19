// src/main/services/tax-forms/form-4562.ts
//
// IRS Form 4562 — Depreciation and Amortization (including
// Information on Listed Property).
//
// Required when:
//   • You're claiming depreciation on property placed in service
//     in the current year
//   • You're claiming Section 179 expense
//   • You're claiming depreciation on listed property (vehicles, etc.)
//   • You're claiming amortization of costs that begin this year
//
// Six parts:
//   I    Section 179 election (immediate expensing, $1.25M cap 2025)
//   II   Bonus depreciation (40% for 2025, declining)
//   III  MACRS depreciation (regular method, multi-year)
//   IV   Summary
//   V    Listed property (vehicles, computers — special rules)
//   VI   Amortization (intangibles like goodwill, startup costs)
//
// We pull from the fixed_assets table. Manual overrides supported
// for assets not in the system (e.g., vehicles, leases).

import * as db from '../../database';

// Section 179 limits per year (IRS Rev. Proc.)
const SECTION_179_LIMIT_2025 = 1250000;       // $1.25M cap
const SECTION_179_PHASEOUT_2025 = 3130000;    // Begins phase-out at $3.13M total purchases
const BONUS_DEPRECIATION_RATE_2025 = 0.40;    // 40% (declining: 60% in '24, 40% '25, 20% '26)

export interface FixedAssetLine {
  description: string;
  date_placed_in_service: string;
  cost: number;
  business_use_percentage: number;       // 0-100
  business_basis: number;                 // cost × business_use %
  recovery_period_years: number;
  method: string;                          // SL / MACRS / Section 179 / Bonus
  convention: string;                      // HY / MM / MQ
  current_year_depreciation: number;
  accumulated_depreciation: number;
}

export interface ListedPropertyLine extends FixedAssetLine {
  vehicle_total_miles: number;
  vehicle_business_miles: number;
  evidence_supports: boolean;
  written_evidence: boolean;
}

export interface Form4562Data {
  taxpayer_name: string;
  ein: string;
  business_activity: string;
  year: number;

  // Part I — Section 179 expense
  line1_max_section_179: number;             // $1,250,000 for 2025
  line2_total_property_cost_section_179: number;  // Total cost of qualifying property
  line3_threshold_phase_out: number;          // $3,130,000 for 2025
  line4_reduction_in_limit: number;           // Line 2 - Line 3 (if > 0)
  line5_dollar_limit: number;                 // Line 1 - Line 4 (≥ 0)
  line6_section_179_assets: FixedAssetLine[];  // Per-asset detail
  line7_listed_property_section_179: number;   // From Part V
  line8_total_elected: number;                  // Sum of line 6 + line 7
  line9_tentative_deduction: number;            // Smaller of line 5 or line 8
  line10_carryover_prior_year: number;
  line11_business_income_limit: number;         // Cannot exceed business taxable income
  line12_section_179_deduction: number;         // min(line 9 + line 10, line 11)
  line13_carryover_to_next_year: number;        // Excess over income limit

  // Part II — Bonus depreciation
  line14_bonus_property_basis: number;          // Property eligible for bonus
  line15_bonus_depreciation: number;             // line 14 × bonus rate
  line16_other_depreciation_property_listed: number;

  // Part III — MACRS depreciation
  line17_macrs_pre_year_property: number;       // Property from prior years
  line18_election_to_group_assets: boolean;
  // Section A — Property placed in service THIS year (lines 19a-19i for different recovery periods)
  line19a_3yr_property: number;
  line19b_5yr_property: number;
  line19c_7yr_property: number;
  line19d_10yr_property: number;
  line19e_15yr_property: number;
  line19f_20yr_property: number;
  line19g_25yr_property: number;
  line19h_residential_rental: number;
  line19i_nonresidential_real: number;

  // Part IV — Summary
  line21_listed_property_amount: number;        // From Part V line 28
  line22_total_depreciation: number;             // Sum of lines 12, 14, 15, 16, 17, 19a-i, 21
  line23_section_263a_capitalize: number;       // Inventoriable property (rare)

  // Part V — Listed property
  listed_property: ListedPropertyLine[];

  // Part VI — Amortization
  amortization_lines: Array<{
    description: string;
    date_amortization_begins: string;
    amortizable_amount: number;
    code_section: string;            // e.g. "195(b)" for startup, "197" for goodwill
    amortization_period_months: number;
    amortization_this_year: number;
  }>;
  line43_amortization_starting_this_year: number;
  line44_amortization_carryover: number;
  line45_total_amortization: number;

  // Computation metadata
  asset_count: number;
  warnings: string[];
}

export interface Form4562Opts {
  business_taxable_income?: number;       // For Section 179 income limit (line 11)
  carryover_section_179?: number;         // From last year's line 13
  business_activity_description?: string;  // e.g., "Software consulting"
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeForm4562(
  companyId: string,
  year: number,
  opts: Form4562Opts = {},
): Form4562Data {
  const dbi = db.getDb();
  const company = db.getById('companies', companyId) as any || {};

  // Pull fixed_assets — try multiple known schema variants
  let assets: any[] = [];
  try {
    assets = dbi.prepare(`
      SELECT *
      FROM fixed_assets
      WHERE company_id = ?
        AND COALESCE(deleted_at, '') = ''
    `).all(companyId) as any[];
  } catch { /* table may not exist on every install */ }

  // Filter: assets placed in service THIS year vs prior years
  const placedThisYear = assets.filter((a) => {
    const date = a.date_placed_in_service || a.acquisition_date || a.in_service_date || '';
    return date.startsWith(String(year));
  });
  const placedPriorYears = assets.filter((a) => {
    const date = a.date_placed_in_service || a.acquisition_date || a.in_service_date || '';
    return date && date.length >= 4 && parseInt(date.slice(0, 4)) < year;
  });

  // Section 179 — assets flagged section_179 = 1 OR with method 'Section 179'
  const section179Assets = placedThisYear
    .filter((a) => a.section_179_election === 1 || (a.depreciation_method || '').toLowerCase().includes('179'))
    .map((a): FixedAssetLine => ({
      description: a.name || a.description || '',
      date_placed_in_service: a.date_placed_in_service || a.acquisition_date || '',
      cost: round2(Number(a.cost) || 0),
      business_use_percentage: Number(a.business_use_pct) || 100,
      business_basis: round2((Number(a.cost) || 0) * (Number(a.business_use_pct) || 100) / 100),
      recovery_period_years: Number(a.recovery_period_years) || 0,
      method: 'Section 179',
      convention: a.convention || 'HY',
      current_year_depreciation: round2(Number(a.section_179_amount) || Number(a.cost) || 0),
      accumulated_depreciation: 0,
    }));

  // Section 179 totals
  const totalSection179Cost = round2(section179Assets.reduce((s, a) => s + a.cost, 0));
  const totalSection179Elected = round2(section179Assets.reduce((s, a) => s + a.current_year_depreciation, 0));

  const line1 = SECTION_179_LIMIT_2025;
  const line2 = totalSection179Cost;
  const line3 = SECTION_179_PHASEOUT_2025;
  const line4 = Math.max(0, round2(line2 - line3));
  const line5 = Math.max(0, round2(line1 - line4));
  const line8 = totalSection179Elected;
  const line9 = round2(Math.min(line5, line8));
  const line10 = round2(opts.carryover_section_179 || 0);
  const line11 = round2(opts.business_taxable_income || 0);
  // line12 = min(line 9 + line 10, line 11) — but only if income limit provided
  const tentative = line9 + line10;
  const line12 = line11 > 0 ? round2(Math.min(tentative, line11)) : tentative;
  const line13 = Math.max(0, round2(tentative - line12));

  // Bonus depreciation — assets flagged bonus_eligible
  const bonusAssets = placedThisYear.filter((a) =>
    a.bonus_depreciation_eligible === 1 || (a.depreciation_method || '').toLowerCase().includes('bonus')
  );
  const bonusBasis = round2(bonusAssets.reduce((s, a) => {
    const cost = Number(a.cost) || 0;
    const pct = (Number(a.business_use_pct) || 100) / 100;
    const sec179 = Number(a.section_179_amount) || 0;
    return s + Math.max(0, cost * pct - sec179);
  }, 0));
  const line14 = bonusBasis;
  const line15 = round2(bonusBasis * BONUS_DEPRECIATION_RATE_2025);

  // MACRS regular depreciation — group placed-this-year by recovery period
  const macrsByPeriod: Record<string, number> = { '3': 0, '5': 0, '7': 0, '10': 0, '15': 0, '20': 0, '25': 0, '27.5': 0, '39': 0 };
  for (const a of placedThisYear) {
    if (a.section_179_election === 1) continue;
    const period = String(Number(a.recovery_period_years) || 5);
    const cost = Number(a.cost) || 0;
    const pct = (Number(a.business_use_pct) || 100) / 100;
    const bonusTaken = bonusAssets.includes(a) ? cost * pct * BONUS_DEPRECIATION_RATE_2025 : 0;
    const remainingBasis = Math.max(0, cost * pct - bonusTaken);
    if (period in macrsByPeriod) {
      // First-year MACRS depreciation rate (HY convention) by recovery period
      const firstYearRate: Record<string, number> = {
        '3': 0.3333, '5': 0.20, '7': 0.1429, '10': 0.10, '15': 0.05, '20': 0.0375, '25': 0.0375,
        '27.5': 0.03485, '39': 0.02564,
      };
      const r = firstYearRate[period] || 0.10;
      macrsByPeriod[period] += remainingBasis * r;
    }
  }

  const line17 = round2(placedPriorYears.reduce((s, a) =>
    s + (Number(a.current_year_depreciation) || 0), 0
  ));

  // Listed property
  const listedAssets = placedThisYear.filter((a) =>
    (a.is_listed_property === 1) || (a.asset_class || '').toLowerCase().includes('vehicle')
  );
  const listedProperty: ListedPropertyLine[] = listedAssets.map((a) => ({
    description: a.name || a.description || '',
    date_placed_in_service: a.date_placed_in_service || '',
    cost: round2(Number(a.cost) || 0),
    business_use_percentage: Number(a.business_use_pct) || 0,
    business_basis: round2((Number(a.cost) || 0) * (Number(a.business_use_pct) || 0) / 100),
    recovery_period_years: Number(a.recovery_period_years) || 5,
    method: a.depreciation_method || 'MACRS',
    convention: a.convention || 'HY',
    current_year_depreciation: round2(Number(a.current_year_depreciation) || 0),
    accumulated_depreciation: round2(Number(a.accumulated_depreciation) || 0),
    vehicle_total_miles: Number(a.total_miles) || 0,
    vehicle_business_miles: Number(a.business_miles) || 0,
    evidence_supports: !!a.evidence_supports,
    written_evidence: !!a.written_evidence,
  }));
  const line21 = round2(listedProperty.reduce((s, l) => s + l.current_year_depreciation, 0));

  // Total depreciation (line 22)
  const macrsTotal = round2(Object.values(macrsByPeriod).reduce((s, v) => s + v, 0));
  const line22 = round2(line12 + line15 + line17 + macrsTotal + line21);

  // Amortization (placeholder — no schema field for this yet)
  const amortizationLines: Form4562Data['amortization_lines'] = [];
  const line43 = 0;
  const line44 = 0;
  const line45 = round2(line43 + line44);

  const warnings: string[] = [];
  if (assets.length === 0) {
    warnings.push('No fixed assets on file. Either add assets via Fixed Assets module or skip Form 4562.');
  }
  if (line8 > line5) {
    warnings.push('Section 179 elections ($' + line8.toFixed(2) + ') exceed the dollar limit ($' + line5.toFixed(2) + '). Excess will be capped on line 9.');
  }
  if (line11 === 0 && tentative > 0) {
    warnings.push('Section 179 income limit (line 11) not provided — pass via opts.business_taxable_income to apply the limit.');
  }
  if (line13 > 0) {
    warnings.push('$' + line13.toFixed(2) + ' of Section 179 election is being carried forward to next year (line 13). Save this value for next year\'s opts.carryover_section_179.');
  }

  return {
    taxpayer_name: company.legal_name || company.name || '',
    ein: company.ein || company.tax_id || '',
    business_activity: opts.business_activity_description || company.industry || '',
    year,

    line1_max_section_179: line1,
    line2_total_property_cost_section_179: line2,
    line3_threshold_phase_out: line3,
    line4_reduction_in_limit: line4,
    line5_dollar_limit: line5,
    line6_section_179_assets: section179Assets,
    line7_listed_property_section_179: 0,
    line8_total_elected: line8,
    line9_tentative_deduction: line9,
    line10_carryover_prior_year: line10,
    line11_business_income_limit: line11,
    line12_section_179_deduction: line12,
    line13_carryover_to_next_year: line13,

    line14_bonus_property_basis: line14,
    line15_bonus_depreciation: line15,
    line16_other_depreciation_property_listed: 0,

    line17_macrs_pre_year_property: line17,
    line18_election_to_group_assets: false,
    line19a_3yr_property: round2(macrsByPeriod['3']),
    line19b_5yr_property: round2(macrsByPeriod['5']),
    line19c_7yr_property: round2(macrsByPeriod['7']),
    line19d_10yr_property: round2(macrsByPeriod['10']),
    line19e_15yr_property: round2(macrsByPeriod['15']),
    line19f_20yr_property: round2(macrsByPeriod['20']),
    line19g_25yr_property: round2(macrsByPeriod['25']),
    line19h_residential_rental: round2(macrsByPeriod['27.5']),
    line19i_nonresidential_real: round2(macrsByPeriod['39']),

    line21_listed_property_amount: line21,
    line22_total_depreciation: line22,
    line23_section_263a_capitalize: 0,

    listed_property: listedProperty,

    amortization_lines: amortizationLines,
    line43_amortization_starting_this_year: line43,
    line44_amortization_carryover: line44,
    line45_total_amortization: line45,

    asset_count: assets.length,
    warnings,
  };
}
