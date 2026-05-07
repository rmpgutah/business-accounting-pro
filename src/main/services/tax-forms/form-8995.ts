// src/main/services/tax-forms/form-8995.ts
//
// IRS Form 8995 — Qualified Business Income Deduction (Simplified
// Computation). The "simple" QBI form for taxpayers under the income
// thresholds (2025: $197,300 single / $394,600 MFJ). Above those
// thresholds you use Form 8995-A which has W-2 wage / UBIA limits
// and SSTB phase-outs.
//
// QBI deduction = min(20% of QBI, 20% × (taxable income − net capital
// gain)). It's the single biggest deduction most pass-through entity
// owners miss because it doesn't appear on Schedule C — it's computed
// at the personal-return level after AGI.
//
// Line numbers verified from official 2025 PDF (Cat. No. 37806C).
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-form-8995

import { computeScheduleC } from './schedule-c';
import * as db from '../../database';

export interface QBITradeBusinessLine {
  // Line 1 sub-line (i, ii, iii, iv, v)
  name: string;
  tin: string;
  qbi: number;                    // Qualified business income or loss
}

export interface Form8995Data {
  taxpayer_name: string;
  ssn: string;
  year: number;

  line1_trades_businesses: QBITradeBusinessLine[];   // Up to 5 per form
  line2_total_qbi: number;                             // Sum of column (c)
  line3_qbi_loss_carryforward: number;                 // Negative
  line4_total_qbi_after_carryforward: number;          // 2 + 3, ≥ 0
  line5_qbi_component: number;                          // 4 × 20%

  line6_reit_ptp_income: number;                        // REIT divs + PTP income
  line7_reit_ptp_loss_carryforward: number;             // Negative
  line8_total_reit_ptp: number;                         // 6 + 7, ≥ 0
  line9_reit_ptp_component: number;                     // 8 × 20%

  line10_qbi_before_income_limit: number;               // 5 + 9
  line11_taxable_income_before_qbi: number;             // From 1040 line 15 + 1040 line 13 (since QBI hasn't been deducted yet)
  line12_net_capital_gain: number;                      // Long-term CG + qualified dividends
  line13_taxable_income_minus_cg: number;               // 11 - 12, ≥ 0
  line14_income_limitation: number;                      // 13 × 20%

  line15_qbi_deduction: number;                          // min(line 10, line 14) — carries to 1040 line 13

  line16_qbi_loss_carryforward_to_next_year: number;    // If line 4 was 0
  line17_reit_ptp_loss_carryforward_to_next_year: number; // If line 8 was 0

  // Eligibility / threshold flags
  is_simplified_eligible: boolean;                      // True if income ≤ threshold
  threshold_single: number;
  threshold_mfj: number;

  warnings: string[];
}

export interface Form8995Opts {
  taxable_income_before_qbi?: number;       // 1040 line 11 + line 13 (you provide)
  net_capital_gain?: number;                  // From Schedule D + qualified div
  filing_status?: 'single' | 'mfj' | 'hoh';
  qbi_loss_carryforward?: number;             // From last year's Form 8995 line 16
  reit_ptp_loss_carryforward?: number;        // From last year's line 17
  reit_ptp_income?: number;                    // 1099-DIV box 5 etc.
  additional_trades_businesses?: QBITradeBusinessLine[]; // For users with multiple
}

const THRESHOLD_SINGLE_2025 = 197300;
const THRESHOLD_MFJ_2025 = 394600;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeForm8995(
  companyId: string,
  year: number,
  opts: Form8995Opts = {},
): Form8995Data {
  const company = db.getById('companies', companyId) as any || {};

  // Pull Schedule C net profit as the primary QBI source (most common case for our users)
  const scheduleC = computeScheduleC(companyId, year);
  const scheduleCNetProfit = round2((scheduleC as any).line31_net_profit_loss || (scheduleC as any).net_profit || 0);

  // Build line 1 — start with Schedule C (autofill), append any user-provided extras
  const line1: QBITradeBusinessLine[] = [];
  if (Math.abs(scheduleCNetProfit) > 0.005) {
    line1.push({
      name: company.name || 'Schedule C Business',
      tin: company.ein || company.tax_id || '',
      qbi: scheduleCNetProfit,
    });
  }
  if (opts.additional_trades_businesses) {
    for (const t of opts.additional_trades_businesses) {
      line1.push({ name: t.name, tin: t.tin, qbi: round2(t.qbi) });
    }
  }
  // Pad to 5 entries (per the form)
  while (line1.length < 5) line1.push({ name: '', tin: '', qbi: 0 });

  // Line 2: Total QBI
  const line2 = round2(line1.reduce((s, l) => s + l.qbi, 0));
  // Line 3: Carryforward (negative)
  const line3 = -Math.abs(round2(opts.qbi_loss_carryforward || 0));
  // Line 4: Total after carryforward (zero or less = 0)
  const line4 = Math.max(0, round2(line2 + line3));
  // Line 5: QBI component = line 4 × 20%
  const line5 = round2(line4 * 0.20);

  // Line 6-9: REIT/PTP component
  const line6 = round2(opts.reit_ptp_income || 0);
  const line7 = -Math.abs(round2(opts.reit_ptp_loss_carryforward || 0));
  const line8 = Math.max(0, round2(line6 + line7));
  const line9 = round2(line8 * 0.20);

  // Line 10: QBI deduction before income limit
  const line10 = round2(line5 + line9);

  // Lines 11-14: Income limitation
  const line11 = round2(opts.taxable_income_before_qbi || 0);
  const line12 = round2(opts.net_capital_gain || 0);
  const line13 = Math.max(0, round2(line11 - line12));
  const line14 = round2(line13 * 0.20);

  // Line 15: Smaller of 10 or 14 — this is the deduction
  const line15 = round2(Math.min(line10, line14));

  // Line 16/17: Loss carryforwards to next year
  const line16 = line2 + line3 < 0 ? Math.abs(round2(line2 + line3)) : 0;
  const line17 = line6 + line7 < 0 ? Math.abs(round2(line6 + line7)) : 0;

  // Eligibility check
  const filingStatus = opts.filing_status || 'single';
  const threshold = filingStatus === 'mfj' ? THRESHOLD_MFJ_2025 : THRESHOLD_SINGLE_2025;
  const isEligible = line11 <= threshold;

  const warnings: string[] = [];
  if (!isEligible) {
    warnings.push(
      'Taxable income ($' + line11.toLocaleString() + ') exceeds the simplified-method threshold ($' +
      threshold.toLocaleString() + '). You must use Form 8995-A instead, which has W-2 wage limits, ' +
      'UBIA limits, and SSTB phase-outs. Form 8995 results may be incorrect for your situation.',
    );
  }
  if (line11 === 0) {
    warnings.push('Taxable income (line 11) was not provided — pass via opts.taxable_income_before_qbi from 1040 line 15 (before the QBI deduction on line 13).');
  }
  if (line15 > 0 && line15 < line10) {
    warnings.push(
      'QBI deduction is limited by income (line 14 = ' + line14.toFixed(2) + ' < line 10 = ' +
      line10.toFixed(2) + '). The income limit reduced the deduction by ' + (line10 - line15).toFixed(2) + '.',
    );
  }
  if (scheduleCNetProfit < 0) {
    warnings.push('Schedule C reports a loss of $' + Math.abs(scheduleCNetProfit) + ' — QBI flows as a negative and creates a loss carryforward (line 16) for next year.');
  }
  if (line15 === 0 && line11 > 0) {
    warnings.push('QBI deduction computed to $0 — typically because taxable income (line 13 after capital gain subtraction) is zero or you have no qualified business income.');
  }

  return {
    taxpayer_name: company.legal_name || company.name || '',
    ssn: '',
    year,
    line1_trades_businesses: line1,
    line2_total_qbi: line2,
    line3_qbi_loss_carryforward: line3,
    line4_total_qbi_after_carryforward: line4,
    line5_qbi_component: line5,
    line6_reit_ptp_income: line6,
    line7_reit_ptp_loss_carryforward: line7,
    line8_total_reit_ptp: line8,
    line9_reit_ptp_component: line9,
    line10_qbi_before_income_limit: line10,
    line11_taxable_income_before_qbi: line11,
    line12_net_capital_gain: line12,
    line13_taxable_income_minus_cg: line13,
    line14_income_limitation: line14,
    line15_qbi_deduction: line15,
    line16_qbi_loss_carryforward_to_next_year: line16,
    line17_reit_ptp_loss_carryforward_to_next_year: line17,
    is_simplified_eligible: isEligible,
    threshold_single: THRESHOLD_SINGLE_2025,
    threshold_mfj: THRESHOLD_MFJ_2025,
    warnings,
  };
}
