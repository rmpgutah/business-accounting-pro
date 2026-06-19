// src/main/services/tax-forms/utah-forms.ts
//
// Utah State Tax Commission forms. Combined into one file because
// they share the same data sources (federal returns + Utah-specific
// adjustments).
//
//   • TC-40    — Utah Individual Income Tax Return
//   • TC-20    — Utah Corporation Franchise and Income Tax Return
//   • TC-20S   — Utah S-Corporation Tax Return
//   • TC-65    — Utah Partnership / Limited Liability Partnership Return
//   • TC-62M   — Utah Multi-County Sales and Use Tax Return
//   • TC-941   — Utah Withholding Return (employer payroll)
//
// Sources:
//   • https://tax.utah.gov/forms

import { computeScheduleC } from './schedule-c';
import { computeForm1120 } from './form-1120';
import { computeForm1120S } from './form-1120s';
import { computeForm1065 } from './form-1065';
import { computeSalesTax } from './sales-tax';
import * as db from '../../database';

// Utah constants (2025-2026)
const UTAH_FLAT_RATE = 0.0455;             // Utah uses flat 4.55% income tax
const UTAH_PERSONAL_EXEMPTION_2025 = 1941;  // 75% of federal exemption (TCJA = 0)
const UTAH_TAX_CREDIT_PCT = 6.0;            // Taxpayer tax credit phase-out

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── TC-40 (Utah Individual Income Tax) ────────────────────────

export interface TC40Data {
  taxpayer_name: string;
  ssn: string;
  spouse_name: string;
  spouse_ssn: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  filing_status: 'single' | 'mfj' | 'mfs' | 'hoh' | 'qw';
  year: number;

  // Lines 1-32 (simplified to most-used)
  line1_filing_status: number;
  line2_dependents: number;
  line4_federal_agi: number;                  // From 1040 line 11
  line5_additions_to_income: number;
  line6_total_income: number;                  // line 4 + line 5
  line7_subtractions: number;
  line8_state_taxable_income: number;          // line 6 - line 7
  line10_tax: number;                           // line 8 × 4.55%
  line17_taxpayer_tax_credit: number;            // Phase-out from $14,879 single / $29,758 MFJ
  line18_tax_after_credit: number;
  line22_utah_credits: number;                   // Other credits (renewable, etc.)
  line25_total_tax: number;
  line26_use_tax: number;                         // Out-of-state purchases
  line29_utah_withholding: number;
  line30_estimated_payments: number;
  line32_amount_owed_or_refund: number;
  warnings: string[];
}

export interface TC40Opts {
  filing_status?: 'single' | 'mfj' | 'mfs' | 'hoh' | 'qw';
  dependents?: number;
  federal_agi?: number;
  utah_withholding?: number;
  estimated_payments?: number;
  use_tax_purchases?: number;                  // Out-of-state purchases for use-tax calc
  spouse_name?: string;
  spouse_ssn?: string;
}

export function computeTC40(companyId: string, year: number, opts: TC40Opts = {}): TC40Data {
  const company = db.getById('companies', companyId) as any || {};
  const fagi = round2(opts.federal_agi || 0);

  const filingStatus = opts.filing_status || 'single';
  const filingCode = { single: 1, mfj: 2, mfs: 3, hoh: 4, qw: 5 }[filingStatus] || 1;
  const line2 = round2(opts.dependents || 0);
  const line5 = 0;                                 // Federal additions (rare)
  const line6 = round2(fagi + line5);
  const line7 = 0;                                 // Federal subtractions (interest on US obligations, etc.)
  const line8 = Math.max(0, round2(line6 - line7));
  const line10 = round2(line8 * UTAH_FLAT_RATE);

  // Taxpayer tax credit phase-out: max $1,941 (single) / $3,882 (MFJ),
  // phases out at 1.3% per $1 above $14,879 (single) / $29,758 (MFJ)
  const baseCredit = filingStatus === 'mfj' ? 3882 : 1941;
  const phaseStart = filingStatus === 'mfj' ? 29758 : 14879;
  const phaseRate = 0.013;
  const phaseOut = Math.max(0, line8 - phaseStart) * phaseRate;
  const line17 = Math.max(0, round2(baseCredit - phaseOut));
  const line18 = Math.max(0, round2(line10 - line17));

  const line22 = 0;                                // Other credits (manual)
  const line25 = Math.max(0, round2(line18 - line22));
  const line26 = round2((opts.use_tax_purchases || 0) * UTAH_FLAT_RATE);

  const line29 = round2(opts.utah_withholding || 0);
  const line30 = round2(opts.estimated_payments || 0);
  const totalPayments = line29 + line30;
  const line32 = round2(line25 + line26 - totalPayments);   // Positive = owed, negative = refund

  const warnings: string[] = [];
  if (fagi === 0) warnings.push('Federal AGI not provided. Pass via opts.federal_agi from 1040 line 11.');
  if (filingStatus === 'mfj' && !opts.spouse_name) warnings.push('Filing status is MFJ but spouse name not provided.');

  return {
    taxpayer_name: company.legal_name || company.name || '',
    ssn: '',
    spouse_name: opts.spouse_name || '',
    spouse_ssn: opts.spouse_ssn || '',
    address: company.address_line1 || '',
    city: company.city || '',
    state: company.state || 'UT',
    zip: company.zip || '',
    filing_status: filingStatus,
    year,
    line1_filing_status: filingCode,
    line2_dependents: line2,
    line4_federal_agi: fagi,
    line5_additions_to_income: line5,
    line6_total_income: line6,
    line7_subtractions: line7,
    line8_state_taxable_income: line8,
    line10_tax: line10,
    line17_taxpayer_tax_credit: line17,
    line18_tax_after_credit: line18,
    line22_utah_credits: line22,
    line25_total_tax: line25,
    line26_use_tax: line26,
    line29_utah_withholding: line29,
    line30_estimated_payments: line30,
    line32_amount_owed_or_refund: line32,
    warnings,
  };
}

// ── TC-20 (Utah C-Corp) ───────────────────────────────────────

export interface TC20Data {
  entity_name: string;
  ein: string;
  utah_account_number: string;
  address: string;
  year: number;
  line1_federal_taxable_income: number;
  line2_utah_additions: number;
  line5_utah_subtractions: number;
  line6_apportionable_income: number;
  line7_utah_apportionment_factor: number;       // 0-1
  line8_utah_taxable_income: number;
  line11_tax: number;                              // 4.55% × line 8 (or $100 minimum)
  line24_total_tax_payments: number;
  line25_balance_due_or_refund: number;
  warnings: string[];
}

export interface TC20Opts {
  utah_account_number?: string;
  utah_apportionment_factor?: number;
  utah_additions?: number;
  utah_subtractions?: number;
  utah_withholding?: number;
}

export function computeTC20(companyId: string, year: number, opts: TC20Opts = {}): TC20Data {
  const f1120 = computeForm1120(companyId, year);
  const company = db.getById('companies', companyId) as any || {};
  const line1 = (f1120 as any).line30_taxable_income || 0;
  const line2 = round2(opts.utah_additions || 0);
  const line5 = round2(opts.utah_subtractions || 0);
  const line6 = round2(line1 + line2 - line5);
  const apportionment = opts.utah_apportionment_factor !== undefined ? opts.utah_apportionment_factor : 1.0;
  const line7 = Math.max(0, Math.min(1, apportionment));
  const line8 = round2(line6 * line7);
  const line11 = Math.max(100, round2(line8 * UTAH_FLAT_RATE));   // $100 minimum tax
  const line24 = round2(opts.utah_withholding || 0);
  const line25 = round2(line11 - line24);

  const warnings: string[] = [];
  if (line8 <= 0 && line11 === 100) warnings.push('Utah imposes a $100 minimum tax on C-corps even with no Utah-source income.');
  if (apportionment < 1.0 && apportionment > 0) warnings.push('Apportionment factor of ' + (apportionment * 100).toFixed(2) + '% applied — verify Schedule J calculation. Utah uses single-sales-factor apportionment for most filers.');

  return {
    entity_name: company.legal_name || company.name || '',
    ein: company.ein || company.tax_id || '',
    utah_account_number: opts.utah_account_number || '',
    address: [company.address_line1, company.city, company.state, company.zip].filter(Boolean).join(', '),
    year,
    line1_federal_taxable_income: line1,
    line2_utah_additions: line2,
    line5_utah_subtractions: line5,
    line6_apportionable_income: line6,
    line7_utah_apportionment_factor: line7,
    line8_utah_taxable_income: line8,
    line11_tax: line11,
    line24_total_tax_payments: line24,
    line25_balance_due_or_refund: line25,
    warnings,
  };
}

// ── TC-20S (Utah S-Corp) ──────────────────────────────────────

export interface TC20SData {
  entity_name: string;
  ein: string;
  utah_account_number: string;
  year: number;
  line1_federal_ordinary_income: number;       // From 1120-S line 21
  line2_utah_additions: number;
  line5_utah_subtractions: number;
  line6_pass_through_income: number;
  number_of_shareholders: number;
  warnings: string[];
}

export interface TC20SOpts {
  utah_account_number?: string;
  utah_additions?: number;
  utah_subtractions?: number;
}

export function computeTC20S(companyId: string, year: number, opts: TC20SOpts = {}): TC20SData {
  const f1120s = computeForm1120S(companyId, year);
  const company = db.getById('companies', companyId) as any || {};
  const line1 = (f1120s as any).line21_ordinary_business_income_loss || 0;
  const line2 = round2(opts.utah_additions || 0);
  const line5 = round2(opts.utah_subtractions || 0);
  const line6 = round2(line1 + line2 - line5);
  const warnings: string[] = ['S-corp pass-through income flows to shareholders\' personal TC-40 returns. The S-corp itself owes no Utah income tax (other than minimum if applicable).'];
  return {
    entity_name: company.legal_name || company.name || '',
    ein: company.ein || company.tax_id || '',
    utah_account_number: opts.utah_account_number || '',
    year,
    line1_federal_ordinary_income: line1,
    line2_utah_additions: line2,
    line5_utah_subtractions: line5,
    line6_pass_through_income: line6,
    number_of_shareholders: (f1120s as any).number_of_shareholders || 0,
    warnings,
  };
}

// ── TC-65 (Utah Partnership) ──────────────────────────────────

export interface TC65Data {
  entity_name: string;
  ein: string;
  utah_account_number: string;
  year: number;
  line1_federal_ordinary_income: number;       // From 1065 line 22
  line2_utah_additions: number;
  line5_utah_subtractions: number;
  line6_pass_through_income: number;
  number_of_partners: number;
  warnings: string[];
}

export interface TC65Opts {
  utah_account_number?: string;
  utah_additions?: number;
  utah_subtractions?: number;
}

export function computeTC65(companyId: string, year: number, opts: TC65Opts = {}): TC65Data {
  const f1065 = computeForm1065(companyId, year);
  const company = db.getById('companies', companyId) as any || {};
  const line1 = (f1065 as any).line23_ordinary_business_income || 0;
  const line2 = round2(opts.utah_additions || 0);
  const line5 = round2(opts.utah_subtractions || 0);
  const line6 = round2(line1 + line2 - line5);
  return {
    entity_name: company.legal_name || company.name || '',
    ein: company.ein || company.tax_id || '',
    utah_account_number: opts.utah_account_number || '',
    year,
    line1_federal_ordinary_income: line1,
    line2_utah_additions: line2,
    line5_utah_subtractions: line5,
    line6_pass_through_income: line6,
    number_of_partners: (f1065 as any).number_of_partners || 0,
    warnings: ['Partnership pass-through income flows to partners\' personal TC-40 returns. The partnership itself owes no Utah income tax (other than withholding on non-resident partners).'],
  };
}

// ── TC-62M (Utah Sales Tax) ───────────────────────────────────

export interface TC62MData {
  business_name: string;
  utah_sales_tax_id: string;
  period_start: string;
  period_end: string;
  line1_total_sales: number;
  line2_exempt_sales: number;
  line3_taxable_sales: number;
  line4_tax_due: number;                          // Per-locality breakdown via underlying sales-tax svc
  line5_seller_discount: number;                   // 1.31% credit for prompt filing
  line6_use_tax: number;
  line7_total_tax_due: number;
  warnings: string[];
}

export interface TC62MOpts {
  utah_sales_tax_id?: string;
  use_tax_purchases?: number;
  apply_seller_discount?: boolean;
}

const UTAH_SELLER_DISCOUNT = 0.0131;

export function computeTC62M(companyId: string, year: number, periodStart: string, periodEnd: string, opts: TC62MOpts = {}): TC62MData {
  const salesTax = computeSalesTax(companyId, periodStart, periodEnd, { state: 'UT' });
  const company = db.getById('companies', companyId) as any || {};
  const line1 = (salesTax as any).total_gross_sales || 0;
  const line2 = (salesTax as any).total_nontaxable_sales || 0;
  const line3 = (salesTax as any).total_taxable_sales || 0;
  const line4 = (salesTax as any).total_tax_due || 0;
  const line5 = opts.apply_seller_discount ? round2(line4 * UTAH_SELLER_DISCOUNT) : 0;
  const line6 = round2((opts.use_tax_purchases || 0) * UTAH_FLAT_RATE);
  const line7 = round2(line4 - line5 + line6);
  void year;
  return {
    business_name: company.legal_name || company.name || '',
    utah_sales_tax_id: opts.utah_sales_tax_id || (company.sales_tax_id || ''),
    period_start: periodStart,
    period_end: periodEnd,
    line1_total_sales: line1,
    line2_exempt_sales: line2,
    line3_taxable_sales: line3,
    line4_tax_due: line4,
    line5_seller_discount: line5,
    line6_use_tax: line6,
    line7_total_tax_due: line7,
    warnings: [
      'TC-62M requires per-locality breakdown by city/county. Utah sales tax rates vary by location — the per-rate table from our sales-tax worksheet should map to specific Utah localities for accurate filing.',
      opts.apply_seller_discount ? 'Seller discount of 1.31% applied (line 5) — only available for filers paying timely.' : 'Filing on time? Apply 1.31% seller discount via opts.apply_seller_discount = true.',
    ],
  };
}

// ── TC-941 (Utah Withholding) ─────────────────────────────────

export interface TC941Data {
  employer_name: string;
  utah_withholding_id: string;
  ein: string;
  period_quarter: 1 | 2 | 3 | 4 | 'annual';
  year: number;
  line1_total_utah_wages: number;
  line2_utah_tax_withheld: number;
  line3_total_due: number;
  line4_total_paid: number;
  line5_balance_due_or_refund: number;
  warnings: string[];
}

export interface TC941Opts {
  utah_withholding_id?: string;
  period_quarter?: 1 | 2 | 3 | 4 | 'annual';
  total_paid?: number;
}

export function computeTC941(companyId: string, year: number, opts: TC941Opts = {}): TC941Data {
  const dbi = db.getDb();
  const company = db.getById('companies', companyId) as any || {};

  // Determine date range
  let qStart = '', qEnd = '';
  if (opts.period_quarter && opts.period_quarter !== 'annual') {
    const q = opts.period_quarter;
    const sm = (q - 1) * 3 + 1;
    const em = q * 3;
    qStart = `${year}-${String(sm).padStart(2, '0')}-01`;
    qEnd = `${year}-${String(em).padStart(2, '0')}-${new Date(year, em, 0).getDate()}`;
  } else {
    qStart = year + '-01-01';
    qEnd = year + '-12-31';
  }

  let totals = { gross: 0, state_tax: 0 };
  try {
    const r = dbi.prepare(`
      SELECT COALESCE(SUM(s.gross_pay), 0) AS gross,
             COALESCE(SUM(s.state_tax), 0) AS state_tax
      FROM pay_stubs s
      JOIN payroll_runs r ON r.id = s.payroll_run_id
      WHERE r.company_id = ?
        AND r.pay_date BETWEEN ? AND ?
        AND COALESCE(r.deleted_at, '') = ''
    `).get(companyId, qStart, qEnd) as any;
    totals.gross = Number(r?.gross) || 0;
    totals.state_tax = Number(r?.state_tax) || 0;
  } catch { /* no payroll yet */ }

  const line1 = round2(totals.gross);
  const line2 = round2(totals.state_tax);
  const line3 = line2;
  const line4 = round2(opts.total_paid || 0);
  const line5 = round2(line3 - line4);

  return {
    employer_name: company.legal_name || company.name || '',
    utah_withholding_id: opts.utah_withholding_id || (company.state_id || ''),
    ein: company.ein || company.tax_id || '',
    period_quarter: opts.period_quarter || 'annual',
    year,
    line1_total_utah_wages: line1,
    line2_utah_tax_withheld: line2,
    line3_total_due: line3,
    line4_total_paid: line4,
    line5_balance_due_or_refund: line5,
    warnings: [
      'Utah withholding flat rate 4.55% (2025-2026). Most employers file quarterly via TC-941 (or annually if liability is small).',
    ],
  };
}
