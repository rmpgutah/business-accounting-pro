// src/main/services/tax-forms/form-1040-es.ts
//
// IRS Form 1040-ES — Estimated Tax for Individuals.
//
// Four quarterly vouchers (Apr 15, Jun 15, Sep 15, Jan 15 of next
// year) for taxpayers who don't have enough withholding to cover
// their tax liability. Sole props, S-corp shareholders, and 1099
// recipients all owe quarterly estimates because their income
// has no W-2 withholding behind it.
//
// Safe-harbor rules — paying any ONE of these avoids the
// underpayment penalty:
//   • 100% of PRIOR year's total tax (110% if AGI > $150K)
//   • 90% of CURRENT year's projected tax
//
// We compute both and recommend the LOWER one. That's the
// minimum the user can pay without penalty.
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-form-1040-es

import { computeScheduleC } from './schedule-c';
import { computeScheduleSE } from './schedule-se';
import * as db from '../../database';

export interface Form1040ESVoucher {
  voucher_number: 1 | 2 | 3 | 4;
  due_date: string;                    // YYYY-MM-DD
  due_date_label: string;              // "April 15, 2026"
  amount: number;                      // Quarterly payment
}

export interface Form1040ESData {
  taxpayer_name: string;
  taxpayer_ssn: string;
  spouse_name: string;
  spouse_ssn: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  year: number;                        // Tax year these vouchers apply to

  // Projected current-year income
  projected_business_income: number;    // From Schedule C YTD (annualized)
  projected_other_income: number;       // User-entered
  projected_adjustments: number;         // Above-the-line (½ SE tax, etc.)
  projected_agi: number;                 // Income - adjustments

  projected_standard_deduction: number;
  projected_qbi_deduction: number;       // Section 199A
  projected_taxable_income: number;       // AGI - standard - QBI

  // Tax liability
  projected_income_tax: number;           // Brackets × taxable income
  projected_se_tax: number;               // From Schedule SE
  projected_total_tax: number;            // Income tax + SE tax

  // Withholding offsets
  withholding_credits: number;            // W-2 + 1099 withholding (user enters)
  net_estimated_tax: number;              // Total tax - withholding

  // Safe harbor calc
  prior_year_total_tax: number;           // User enters from last year's return
  safe_harbor_prior_year: number;         // 100% or 110% × prior year
  safe_harbor_current_year: number;       // 90% × projected
  recommended_total: number;              // min of prior_year and current_year safe harbor
  recommended_quarterly: number;          // recommended_total / 4

  // Quarterly vouchers
  vouchers: Form1040ESVoucher[];

  warnings: string[];
}

const HIGH_INCOME_THRESHOLD = 150000;   // AGI > this → 110% prior-year safe harbor

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function quarterlyDueDates(year: number): { date: string; label: string }[] {
  // Standard IRS due dates. Each quarter pays for income in the quarter
  // ending the prior month (Q1 = Jan-Mar income, due Apr 15).
  // Note: real IRS uses uneven quarters (3/2/3/4 months) intentionally —
  // these dates can shift to next business day if they fall on weekends/
  // holidays, but the static dates are what 1040-ES uses.
  return [
    { date: year + '-04-15', label: 'April 15, ' + year },
    { date: year + '-06-15', label: 'June 15, ' + year },
    { date: year + '-09-15', label: 'September 15, ' + year },
    { date: (year + 1) + '-01-15', label: 'January 15, ' + (year + 1) },
  ];
}

// Same brackets used in withholding — for parity with payroll calc
const BRACKETS_2025_SINGLE = [
  { min: 0, max: 11925, rate: 0.10 },
  { min: 11925, max: 48475, rate: 0.12 },
  { min: 48475, max: 103350, rate: 0.22 },
  { min: 103350, max: 197300, rate: 0.24 },
  { min: 197300, max: 250525, rate: 0.32 },
  { min: 250525, max: 626350, rate: 0.35 },
  { min: 626350, max: Infinity, rate: 0.37 },
];

function bracketTax(taxableIncome: number, brackets = BRACKETS_2025_SINGLE): number {
  let tax = 0;
  for (const b of brackets) {
    if (taxableIncome <= b.min) break;
    const taxable = Math.min(taxableIncome, b.max) - b.min;
    tax += taxable * b.rate;
  }
  return tax;
}

export interface Form1040ESOpts {
  prior_year_total_tax?: number;       // From last year's 1040 line 24
  withholding_credits?: number;
  projected_other_income?: number;     // Investment income, etc.
  filing_status?: 'single' | 'mfj' | 'hoh';
  spouse_name?: string;
  spouse_ssn?: string;
  ytd_months?: number;                 // How many months of YTD data to annualize from (default 12)
}

export function computeForm1040ES(
  companyId: string,
  taxYear: number,
  opts: Form1040ESOpts = {},
): Form1040ESData {
  const company = db.getById('companies', companyId) as any || {};

  // Pull YTD Schedule C and Schedule SE from CURRENT year (the one
  // the vouchers apply to). If we're 6 months into the year, annualize.
  const scheduleC = computeScheduleC(companyId, taxYear);
  const ytdMonths = Math.max(1, Math.min(12, opts.ytd_months || 12));
  const annualizationFactor = 12 / ytdMonths;

  const ytdNetProfit = (scheduleC as any).line31_net_profit_loss || (scheduleC as any).net_profit || 0;
  const projectedBusinessIncome = round2(ytdNetProfit * annualizationFactor);

  const projectedSE = computeScheduleSE(companyId, taxYear);
  const projectedSETax = round2(((projectedSE as any).line12_total_se_tax || 0) * annualizationFactor);
  const projectedSETaxDeduction = round2(projectedSETax * 0.5); // half is above-the-line

  // Projected AGI = business income + other income - adjustments
  const projectedOtherIncome = round2(opts.projected_other_income || 0);
  const projectedTotalIncome = round2(projectedBusinessIncome + projectedOtherIncome);
  const projectedAdjustments = projectedSETaxDeduction;
  const projectedAGI = round2(Math.max(0, projectedTotalIncome - projectedAdjustments));

  // Standard deduction (2025 figures; 2026 in tax-brackets.ts)
  const filingStatus = opts.filing_status || 'single';
  const stdDed = filingStatus === 'mfj' ? 30000 : filingStatus === 'hoh' ? 22500 : 15000;

  // QBI deduction (Section 199A) — 20% of qualified business income, simplified.
  // Real Form 8995 has phase-outs for high earners and SSTBs; ours is the simple case.
  const projectedQBI = round2(projectedBusinessIncome * 0.20);

  const projectedTaxableIncome = round2(Math.max(0, projectedAGI - stdDed - projectedQBI));
  const projectedIncomeTax = round2(bracketTax(projectedTaxableIncome));
  const projectedTotalTax = round2(projectedIncomeTax + projectedSETax);

  const withholding = round2(opts.withholding_credits || 0);
  const netEstimatedTax = round2(Math.max(0, projectedTotalTax - withholding));

  // Safe harbor calculations
  const priorYearTotalTax = round2(opts.prior_year_total_tax || 0);
  const highIncomeMultiplier = projectedAGI > HIGH_INCOME_THRESHOLD ? 1.10 : 1.00;
  const safeHarborPriorYear = round2(priorYearTotalTax * highIncomeMultiplier);
  const safeHarborCurrentYear = round2(netEstimatedTax * 0.90);

  // Recommend the LOWER of the two (minimum to avoid penalty)
  // — but only if both are non-zero
  const recommendedTotal = priorYearTotalTax > 0
    ? Math.min(safeHarborPriorYear, safeHarborCurrentYear)
    : safeHarborCurrentYear;
  const recommendedQuarterly = round2(recommendedTotal / 4);

  // Build 4 vouchers, each with the recommended quarterly amount
  const dueDates = quarterlyDueDates(taxYear);
  const vouchers: Form1040ESVoucher[] = dueDates.map((d, i) => ({
    voucher_number: (i + 1) as 1 | 2 | 3 | 4,
    due_date: d.date,
    due_date_label: d.label,
    amount: recommendedQuarterly,
  }));

  const warnings: string[] = [];
  if (priorYearTotalTax === 0) {
    warnings.push('Prior-year total tax not provided — only current-year safe harbor (90%) was computed. Provide opts.prior_year_total_tax (1040 line 24) for the most-favorable comparison.');
  }
  if (recommendedTotal === 0 && projectedTotalTax > 0) {
    warnings.push('Estimated tax computes to $0 because withholding fully covers the projected liability. No vouchers needed — but track YTD income to confirm.');
  }
  if (projectedAGI > HIGH_INCOME_THRESHOLD) {
    warnings.push('AGI projected above $150,000 — prior-year safe harbor requires 110% (used here), not 100%.');
  }
  if (ytdMonths < 12) {
    warnings.push('Annualized from ' + ytdMonths + ' months of YTD data (factor ×' + annualizationFactor.toFixed(2) + '). For a more accurate estimate, recompute later in the year.');
  }
  if (recommendedQuarterly < 0.01 && projectedTotalTax > 0) {
    warnings.push('Quarterly amount rounds to zero — likely no estimated tax required this year.');
  }

  return {
    taxpayer_name: company.legal_name || company.name || '',
    taxpayer_ssn: '',
    spouse_name: opts.spouse_name || '',
    spouse_ssn: opts.spouse_ssn || '',
    address: company.address_line1 || '',
    city: company.city || '',
    state: company.state || '',
    zip: company.zip || '',
    year: taxYear,
    projected_business_income: projectedBusinessIncome,
    projected_other_income: projectedOtherIncome,
    projected_adjustments: projectedAdjustments,
    projected_agi: projectedAGI,
    projected_standard_deduction: stdDed,
    projected_qbi_deduction: projectedQBI,
    projected_taxable_income: projectedTaxableIncome,
    projected_income_tax: projectedIncomeTax,
    projected_se_tax: projectedSETax,
    projected_total_tax: projectedTotalTax,
    withholding_credits: withholding,
    net_estimated_tax: netEstimatedTax,
    prior_year_total_tax: priorYearTotalTax,
    safe_harbor_prior_year: safeHarborPriorYear,
    safe_harbor_current_year: safeHarborCurrentYear,
    recommended_total: recommendedTotal,
    recommended_quarterly: recommendedQuarterly,
    vouchers,
    warnings,
  };
}
