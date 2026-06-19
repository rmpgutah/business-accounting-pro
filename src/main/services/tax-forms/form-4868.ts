// src/main/services/tax-forms/form-4868 .ts
//
// IRS Form 4868 — Application for Automatic Extension of Time
// To File U.S. Individual Income Tax Return.
//
// Pushes the Form 1040 deadline from April 15 → October 15 (6 months
// automatic, no reason required). Same caveat as 7004: an extension
// to FILE is not an extension to PAY. You must estimate and pay any
// balance due with this form to avoid failure-to-pay penalties.
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-form-4868

import { computeScheduleC } from './schedule-c';
import { computeScheduleSE } from './schedule-se';
import * as db from '../../database';

export interface Form4868Data {
  // Identification
  taxpayer_name: string;
  taxpayer_ssn: string;
  spouse_name: string;
  spouse_ssn: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  year: number;

  // Lines 4-7
  line4_estimated_total_tax: number;
  line5_total_payments_2024: number;            // Withholding + estimated payments
  line6_balance_due: number;                    // line 4 − line 5
  line7_amount_paying_with_extension: number;   // Often = line 6 to avoid penalty

  // Filing flags
  is_out_of_country: boolean;                    // 2-month auto extension
  is_form_1040_nr_filer: boolean;                 // No wages = different rules

  // Calendar reference
  original_due_date: string;
  extended_due_date: string;

  warnings: string[];
}

export interface Form4868Opts {
  estimated_total_tax?: number;
  total_payments?: number;
  amount_paying?: number;
  spouse_name?: string;
  spouse_ssn?: string;
  is_out_of_country?: boolean;
  is_form_1040_nr_filer?: boolean;
  // Auto-estimate: pull from books if estimated_total_tax not provided
  auto_estimate?: boolean;
  filing_status?: 'single' | 'mfj' | 'hoh';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Same brackets used elsewhere — for parity
const BRACKETS_2025_SINGLE = [
  { min: 0, max: 11925, rate: 0.10 },
  { min: 11925, max: 48475, rate: 0.12 },
  { min: 48475, max: 103350, rate: 0.22 },
  { min: 103350, max: 197300, rate: 0.24 },
  { min: 197300, max: 250525, rate: 0.32 },
  { min: 250525, max: 626350, rate: 0.35 },
  { min: 626350, max: Infinity, rate: 0.37 },
];

function bracketTax(taxableIncome: number): number {
  let tax = 0;
  for (const b of BRACKETS_2025_SINGLE) {
    if (taxableIncome <= b.min) break;
    const taxable = Math.min(taxableIncome, b.max) - b.min;
    tax += taxable * b.rate;
  }
  return tax;
}

export function computeForm4868(
  companyId: string,
  year: number,
  opts: Form4868Opts = {},
): Form4868Data {
  const company = db.getById('companies', companyId) as any || {};

  let estimatedTax = round2(opts.estimated_total_tax || 0);

  // Auto-estimate from Schedule C / SE if not provided
  if (estimatedTax === 0 && opts.auto_estimate !== false) {
    const sc = computeScheduleC(companyId, year);
    const se = computeScheduleSE(companyId, year);
    const netProfit = (sc as any).line31_net_profit_loss || (sc as any).net_profit || 0;
    const seTax = (se as any).line12_total_se_tax || 0;
    const seDeduction = (se as any).line13_deductible_half || 0;
    const stdDed = opts.filing_status === 'mfj' ? 30000 : opts.filing_status === 'hoh' ? 22500 : 15000;
    const qbiDed = Math.max(0, netProfit) * 0.20;
    const taxableIncome = Math.max(0, round2(netProfit - seDeduction - stdDed - qbiDed));
    const incomeTax = round2(bracketTax(taxableIncome));
    estimatedTax = round2(incomeTax + seTax);
  }

  const totalPayments = round2(opts.total_payments || 0);
  const balanceDue = Math.max(0, round2(estimatedTax - totalPayments));
  const amountPaying = opts.amount_paying !== undefined
    ? round2(opts.amount_paying)
    : balanceDue;     // Default: pay the full balance due

  // Calendar dates
  const originalDueDate = (year + 1) + '-04-15';
  const extendedDueDate = opts.is_out_of_country ? (year + 1) + '-06-15' : (year + 1) + '-10-15';

  const warnings: string[] = [];
  if (estimatedTax === 0) {
    warnings.push('Estimated total tax (line 4) is $0. If this is accurate (no income or full withholding), the extension is fine. Otherwise, provide opts.estimated_total_tax or set opts.auto_estimate = true to estimate from Schedule C/SE.');
  }
  if (balanceDue > 0 && amountPaying < balanceDue) {
    warnings.push('Balance due ($' + balanceDue.toFixed(2) + ') exceeds amount being paid ($' + amountPaying.toFixed(2) + '). Failure-to-pay penalty (0.5% per month) and interest accrue from April 15 on the unpaid portion.');
  }
  if (opts.is_out_of_country) {
    warnings.push('Out-of-country filer: automatic 2-month extension granted (June 15) without filing Form 4868. Filing 4868 extends to December 15 instead of October 15.');
  }
  const today = new Date().toISOString().slice(0, 10);
  if (today > originalDueDate) {
    warnings.push('Today (' + today + ') is past the April 15 deadline. Extension must be filed BY April 15 to be valid.');
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
    year,

    line4_estimated_total_tax: estimatedTax,
    line5_total_payments_2024: totalPayments,
    line6_balance_due: balanceDue,
    line7_amount_paying_with_extension: amountPaying,

    is_out_of_country: !!opts.is_out_of_country,
    is_form_1040_nr_filer: !!opts.is_form_1040_nr_filer,

    original_due_date: originalDueDate,
    extended_due_date: extendedDueDate,

    warnings,
  };
}
