// src/main/services/tax-forms/form-4797.ts
//
// IRS Form 4797 — Sales of Business Property.
//
// Reports gains/losses from sales of business assets (equipment,
// real estate used in the business, livestock, etc.). The form has
// three parts that handle different tax treatment:
//
//   I    Section 1231 gains/losses (held > 1 year, used in trade/
//        business). Net gain → long-term capital gain rates.
//        Net loss → ordinary deduction.
//   II   Ordinary gains/losses (held ≤ 1 year, OR any property not
//        held in trade/business)
//   III  Section 1245 / 1250 / 1252 / 1254 / 1255 recapture
//        (depreciation recapture — when you sell a depreciated asset
//        for more than its adjusted basis, the depreciation portion
//        comes back as ordinary income)
//   IV   Recapture under sections 179 and 280F(b)(2) (if business
//        use of an asset previously expensed drops below 50%)
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-form-4797

import * as db from '../../database';

export interface SalesTransaction {
  description: string;
  date_acquired: string;
  date_sold: string;
  gross_sales_price: number;
  depreciation_allowed: number;          // Accumulated depreciation through sale
  cost_or_basis: number;                  // Original cost
  expense_of_sale: number;                 // Commissions, closing costs
  gain_loss: number;                       // Computed: sales price - basis - expenses
  is_section_1245: boolean;                 // True for tangible personal property (equipment)
  is_section_1250: boolean;                 // True for real property (buildings)
  recapture_amount: number;                  // For Part III
}

export interface Form4797Data {
  taxpayer_name: string;
  ein: string;
  year: number;

  // Part I — Section 1231 (held > 1 year)
  line2_section_1231_transactions: SalesTransaction[];
  line3_gain_4684_section_1231: number;       // Casualty gain
  line4_gain_partnership_distributions: number;
  line5_other_gains_or_losses: number;
  line6_combine_lines_2_5: number;
  line7_combine_lines_6: number;                // Net Section 1231 gain or loss
  line8_nonrecaptured_section_1231_losses: number;  // From prior 5 yrs
  line9_subtract_line_8: number;                  // If gain, treated as long-term capital gain

  // Part II — Ordinary gains/losses
  line10_ordinary_transactions: SalesTransaction[];
  line11_loss_carryover_section_1231: number;
  line12_gain_ordinary: number;
  line13_gain_ordinary_2: number;
  line14_other: number;
  line15_recapture_section_179_280f: number;
  line16_ordinary_transactions_total: number;
  line17_combine_lines_10_16: number;
  line18a_gain_from_4797_part_iii: number;
  line18b_redetermine_passive_loss: number;

  // Part III — Recapture
  line19_section_1245_property: SalesTransaction[];
  line20_total_gain_section_1245: number;
  line21_lesser_of_recapture: number;
  line22_total_section_1245_recapture: number;
  line25_section_1250_property: SalesTransaction[];
  line26_total_gain_section_1250: number;

  // Part IV — Recapture under sections 179 and 280F(b)(2)
  line33_section_179_recapture: number;
  line34_section_280f_recapture: number;
  line35_total_recapture: number;

  warnings: string[];
}

export interface Form4797Opts {
  section_1231_transactions?: SalesTransaction[];
  ordinary_transactions?: SalesTransaction[];
  nonrecaptured_section_1231_losses_5yr?: number;
  section_1231_loss_carryover?: number;
  section_179_recapture?: number;
  section_280f_recapture?: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function classifyTxn(txn: SalesTransaction): SalesTransaction {
  const sale = Number(txn.gross_sales_price) || 0;
  const expense = Number(txn.expense_of_sale) || 0;
  const basis = Number(txn.cost_or_basis) || 0;
  const dep = Number(txn.depreciation_allowed) || 0;
  const adjustedBasis = Math.max(0, basis - dep);
  const gainLoss = round2(sale - expense - adjustedBasis);
  // Recapture = lesser of depreciation taken or gain (Sec 1245)
  const recaptureAmount = txn.is_section_1245 ? Math.min(dep, Math.max(0, gainLoss)) : 0;
  return {
    ...txn,
    gain_loss: gainLoss,
    recapture_amount: round2(recaptureAmount),
  };
}

export function computeForm4797(
  companyId: string,
  year: number,
  opts: Form4797Opts = {},
): Form4797Data {
  const dbi = db.getDb();
  const company = db.getById('companies', companyId) as any || {};

  // Try to pull disposed fixed assets from this year as a starting point
  let dbAssetSales: SalesTransaction[] = [];
  try {
    const rows = dbi.prepare(`
      SELECT name AS description, acquisition_date AS date_acquired,
             disposal_date AS date_sold,
             COALESCE(disposal_proceeds, 0) AS gross_sales_price,
             COALESCE(accumulated_depreciation, 0) AS depreciation_allowed,
             COALESCE(cost, 0) AS cost_or_basis,
             COALESCE(disposal_expenses, 0) AS expense_of_sale,
             asset_class
      FROM fixed_assets
      WHERE company_id = ?
        AND disposal_date BETWEEN ? AND ?
        AND COALESCE(deleted_at, '') = ''
    `).all(companyId, year + '-01-01', year + '-12-31') as any[];
    dbAssetSales = rows.map((r): SalesTransaction => classifyTxn({
      description: r.description || '',
      date_acquired: r.date_acquired || '',
      date_sold: r.date_sold || '',
      gross_sales_price: Number(r.gross_sales_price) || 0,
      depreciation_allowed: Number(r.depreciation_allowed) || 0,
      cost_or_basis: Number(r.cost_or_basis) || 0,
      expense_of_sale: Number(r.expense_of_sale) || 0,
      gain_loss: 0,
      is_section_1245: !(r.asset_class || '').toLowerCase().includes('real'),
      is_section_1250: (r.asset_class || '').toLowerCase().includes('real'),
      recapture_amount: 0,
    }));
  } catch { /* table may not exist */ }

  // Split: held > 1 year = Section 1231 (Part I), ≤ 1 year = ordinary (Part II)
  const provided1231 = (opts.section_1231_transactions || []).map(classifyTxn);
  const providedOrdinary = (opts.ordinary_transactions || []).map(classifyTxn);

  const autoSplit = dbAssetSales.map((t) => {
    const acq = new Date(t.date_acquired + 'T00:00:00').getTime();
    const sold = new Date(t.date_sold + 'T00:00:00').getTime();
    const holdYears = (sold - acq) / (365.25 * 86400000);
    return { ...t, _holdYears: holdYears };
  });
  const auto1231 = autoSplit.filter((t) => t._holdYears > 1).map(({ _holdYears, ...rest }) => rest);
  const autoOrdinary = autoSplit.filter((t) => t._holdYears <= 1).map(({ _holdYears, ...rest }) => rest);

  const line2 = [...auto1231, ...provided1231];
  const line10 = [...autoOrdinary, ...providedOrdinary];

  const line2Sum = round2(line2.reduce((s, t) => s + t.gain_loss, 0));
  const line6 = line2Sum;
  const line7 = line6;     // Simplified: ignore lines 3-5 unless user provides
  const line8 = round2(opts.nonrecaptured_section_1231_losses_5yr || 0);
  const line9 = round2(line7 - line8);

  // Part II ordinary
  const line10Sum = round2(line10.reduce((s, t) => s + t.gain_loss, 0));
  const line11 = round2(opts.section_1231_loss_carryover || 0);
  const line17 = round2(line10Sum + line11);

  // Part III recapture (Section 1245)
  const line19 = line2.filter((t) => t.is_section_1245);
  const line20 = round2(line19.reduce((s, t) => s + Math.max(0, t.gain_loss), 0));
  const line22 = round2(line19.reduce((s, t) => s + t.recapture_amount, 0));

  const line25 = line2.filter((t) => t.is_section_1250);
  const line26 = round2(line25.reduce((s, t) => s + Math.max(0, t.gain_loss), 0));

  // Part IV
  const line33 = round2(opts.section_179_recapture || 0);
  const line34 = round2(opts.section_280f_recapture || 0);
  const line35 = round2(line33 + line34);

  const warnings: string[] = [];
  if (line2.length === 0 && line10.length === 0) {
    warnings.push('No business property sales found. Pass transactions via opts.section_1231_transactions / opts.ordinary_transactions.');
  }
  if (line9 > 0) {
    warnings.push('Net Section 1231 GAIN of $' + line9.toFixed(2) + ' — treated as long-term capital gain (favorable rates). Reported on Schedule D.');
  }
  if (line9 < 0) {
    warnings.push('Net Section 1231 LOSS of $' + Math.abs(line9).toFixed(2) + ' — treated as ordinary deduction (better than capital loss). Reported as Other income on Schedule C / 1040 Schedule 1.');
  }
  if (line22 > 0) {
    warnings.push('Section 1245 recapture of $' + line22.toFixed(2) + ' — depreciation taken in prior years comes back as ORDINARY income (no preferential rates). Carries to line 13 of Part II.');
  }
  if (line35 > 0) {
    warnings.push('Section 179 / 280F recapture of $' + line35.toFixed(2) + ' triggered — business use dropped below 50% on a previously-expensed asset. Carries to line 15 of Part II.');
  }

  return {
    taxpayer_name: company.legal_name || company.name || '',
    ein: company.ein || company.tax_id || '',
    year,

    line2_section_1231_transactions: line2,
    line3_gain_4684_section_1231: 0,
    line4_gain_partnership_distributions: 0,
    line5_other_gains_or_losses: 0,
    line6_combine_lines_2_5: line6,
    line7_combine_lines_6: line7,
    line8_nonrecaptured_section_1231_losses: line8,
    line9_subtract_line_8: line9,

    line10_ordinary_transactions: line10,
    line11_loss_carryover_section_1231: line11,
    line12_gain_ordinary: 0,
    line13_gain_ordinary_2: line22,    // Section 1245 recapture flows here
    line14_other: 0,
    line15_recapture_section_179_280f: line35,
    line16_ordinary_transactions_total: 0,
    line17_combine_lines_10_16: line17,
    line18a_gain_from_4797_part_iii: line22,
    line18b_redetermine_passive_loss: 0,

    line19_section_1245_property: line19,
    line20_total_gain_section_1245: line20,
    line21_lesser_of_recapture: line22,
    line22_total_section_1245_recapture: line22,
    line25_section_1250_property: line25,
    line26_total_gain_section_1250: line26,

    line33_section_179_recapture: line33,
    line34_section_280f_recapture: line34,
    line35_total_recapture: line35,

    warnings,
  };
}
