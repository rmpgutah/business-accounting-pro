// src/main/services/tax-forms/schedule-d.ts
//
// IRS 1040 Schedule D — Capital Gains and Losses.
//
// Reports capital gains/losses from sales of investments, real
// estate, business property. Part I = short-term (held ≤ 1 year),
// Part II = long-term (held > 1 year). Detail lines (per
// transaction) are on Form 8949; Schedule D summarizes the totals.
//
// For accounting users:
//   • Most capital gains are personal (stocks, mutual funds) —
//     received via 1099-B from brokers
//   • Sale of business property goes on Form 4797, then flows here
//   • We don't track investment portfolios in the accounting app;
//     manual entry expected
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-schedule-d-form-1040

import * as db from '../../database';

export interface ScheduleDLine {
  description: string;
  date_acquired: string;
  date_sold: string;
  proceeds: number;
  cost_basis: number;
  adjustments: number;
  gain_loss: number;
}

export interface ScheduleDData {
  taxpayer_name: string;
  ssn: string;
  year: number;

  // Part I — Short-Term (held ≤ 1 year)
  line1a_basis_reported_short: ScheduleDLine[];   // Box A on Form 8949
  line1b_basis_not_reported_short: ScheduleDLine[]; // Box B
  line2_basis_unknown_short: ScheduleDLine[];      // Box C
  line3_capital_gain_dist: number;
  line4_short_term_gain_4684_2439_etc: number;
  line5_short_term_loss_partnerships_etc: number;
  line6_short_term_carryover: number;             // Negative
  line7_total_short_term_gain_loss: number;

  // Part II — Long-Term (held > 1 year)
  line8a_basis_reported_long: ScheduleDLine[];     // Box D
  line8b_basis_not_reported_long: ScheduleDLine[]; // Box E
  line9_basis_unknown_long: ScheduleDLine[];        // Box F
  line10_capital_gain_dist_long: number;
  line11_gain_4797_other: number;
  line12_long_term_gain_partnerships_etc: number;
  line13_capital_gain_distributions: number;
  line14_long_term_carryover: number;             // Negative
  line15_total_long_term_gain_loss: number;

  // Part III — Summary
  line16_combined_total: number;                   // 7 + 15
  line17_qualified_dividends_question: string;
  line18_28pct_gain_worksheet_amount: number;
  line19_unrecaptured_1250_gain: number;
  line20_use_qualified_dividends_worksheet: boolean;
  line21_capital_loss_limit: number;              // Max ($3,000) carryover
  line22_qualifying_form_1040_line: boolean;

  warnings: string[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function aggregateLines(lines: ScheduleDLine[]): { proceeds: number; basis: number; adjustments: number; gain: number } {
  return lines.reduce((acc, l) => ({
    proceeds: acc.proceeds + (Number(l.proceeds) || 0),
    basis: acc.basis + (Number(l.cost_basis) || 0),
    adjustments: acc.adjustments + (Number(l.adjustments) || 0),
    gain: acc.gain + (Number(l.gain_loss) || 0),
  }), { proceeds: 0, basis: 0, adjustments: 0, gain: 0 });
}

export function computeScheduleD(
  companyId: string,
  year: number,
  opts?: {
    short_term_lines?: ScheduleDLine[];
    long_term_lines?: ScheduleDLine[];
    short_term_carryover?: number;
    long_term_carryover?: number;
  },
): ScheduleDData {
  const company = db.getById('companies', companyId) as any || {};

  const shortLines = opts?.short_term_lines || [];
  const longLines = opts?.long_term_lines || [];

  const shortAgg = aggregateLines(shortLines);
  const longAgg = aggregateLines(longLines);

  const stCarryover = round2(opts?.short_term_carryover || 0);
  const ltCarryover = round2(opts?.long_term_carryover || 0);

  const line7 = round2(shortAgg.gain - stCarryover);
  const line15 = round2(longAgg.gain - ltCarryover);
  const line16 = round2(line7 + line15);

  const warnings: string[] = [];
  if (shortLines.length === 0 && longLines.length === 0) {
    warnings.push('No transactions entered. Pass via opts.short_term_lines and opts.long_term_lines (each {description, dates, proceeds, cost_basis, gain_loss}).');
  }
  if (line16 < 0 && Math.abs(line16) > 3000) {
    warnings.push('Net capital loss > $3,000 — capped at $3,000 deduction this year, balance carries forward to next year.');
  }

  return {
    taxpayer_name: company.legal_name || company.name || '',
    ssn: '',
    year,
    line1a_basis_reported_short: shortLines,
    line1b_basis_not_reported_short: [],
    line2_basis_unknown_short: [],
    line3_capital_gain_dist: 0,
    line4_short_term_gain_4684_2439_etc: 0,
    line5_short_term_loss_partnerships_etc: 0,
    line6_short_term_carryover: -stCarryover,
    line7_total_short_term_gain_loss: line7,
    line8a_basis_reported_long: longLines,
    line8b_basis_not_reported_long: [],
    line9_basis_unknown_long: [],
    line10_capital_gain_dist_long: 0,
    line11_gain_4797_other: 0,
    line12_long_term_gain_partnerships_etc: 0,
    line13_capital_gain_distributions: 0,
    line14_long_term_carryover: -ltCarryover,
    line15_total_long_term_gain_loss: line15,
    line16_combined_total: line16,
    line17_qualified_dividends_question: '',
    line18_28pct_gain_worksheet_amount: 0,
    line19_unrecaptured_1250_gain: 0,
    line20_use_qualified_dividends_worksheet: false,
    line21_capital_loss_limit: line16 < 0 ? Math.max(line16, -3000) : 0,
    line22_qualifying_form_1040_line: false,
    warnings,
  };
}
