// src/main/services/tax-forms/form-7004.ts
//
// IRS Form 7004 — Application for Automatic Extension of Time
// To File Certain Business Income Tax, Information, and Other
// Returns.
//
// Filed BEFORE the original due date to get an automatic 6-month
// extension on:
//   • Form 1065 (partnership) — orig due Mar 15, ext to Sep 15
//   • Form 1120 (C-corp) — orig due Apr 15, ext to Oct 15
//   • Form 1120-S (S-corp) — orig due Mar 15, ext to Sep 15
//   • Form 1041 (estates/trusts), 990, 8804, etc. (full list ~30 codes)
//
// IMPORTANT: An extension to FILE is NOT an extension to PAY.
// You must estimate and pay any tax due with this form.
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-form-7004

import * as db from '../../database';

// Form codes per IRS Form 7004 Part I (most common ones)
export type Form7004Code =
  | '01' | '02' | '03' | '04' | '05' | '06' | '07' | '08' | '09'
  | '10' | '11' | '12' | '13' | '14' | '15' | '16' | '17' | '18' | '19'
  | '20' | '21' | '22' | '23' | '24' | '25' | '26' | '27' | '28' | '29'
  | '30' | '31' | '32' | '33' | '34' | '35' | '36';

export const FORM_7004_CODES: Record<Form7004Code, string> = {
  '01': 'Form 706-GS(D)',
  '02': 'Form 706-GS(T)',
  '03': 'Form 1041 (bankruptcy estate only)',
  '04': 'Form 1041 (estate other than a bankruptcy estate)',
  '05': 'Form 1041 (trust)',
  '06': 'Form 1041-N',
  '07': 'Form 1041-QFT',
  '08': 'Form 1042',
  '09': 'Form 1065',                                     // Partnership
  '10': 'Form 1066',
  '11': 'Form 1120',                                     // C-corp
  '12': 'Form 1120-C',
  '13': 'Form 1120-F',
  '14': 'Form 1120-FSC',
  '15': 'Form 1120-H',
  '16': 'Form 1120-L',
  '17': 'Form 1120-ND',
  '18': 'Form 1120-ND (section 4951 taxes)',
  '19': 'Form 1120-PC',
  '20': 'Form 1120-POL',
  '21': 'Form 1120-REIT',
  '22': 'Form 1120-RIC',
  '23': 'Form 1120-S',                                   // S-corp
  '24': 'Form 1120-SF',
  '25': 'Form 3520-A',
  '26': 'Form 8612',
  '27': 'Form 8613',
  '28': 'Form 8725',
  '29': 'Form 8804',
  '30': 'Form 8831',
  '31': 'Form 8876',
  '32': 'Form 8924',
  '33': 'Form 8928',
  '34': 'Form 1120-IC-DISC',
  '35': 'Form 8612 (regulated investment company)',
  '36': 'Form 706-GS(T) revised',
};

export interface Form7004Data {
  taxpayer_name: string;
  trade_name: string;
  ein: string;
  address: string;
  city: string;
  state: string;
  zip: string;

  // Part I — Form code (which return is being extended)
  form_code: Form7004Code;
  form_code_description: string;

  // Tax year info
  tax_year_start: string;            // YYYY-MM-DD (for fiscal-year filers)
  tax_year_end: string;
  is_short_tax_year: boolean;
  short_year_reason: string;

  // Part II — Tax computation
  line6_tentative_total_tax: number;          // Estimated total tax for the year
  line7_total_payments_credits: number;       // Estimated payments + withholding
  line8_balance_due: number;                  // line 6 − line 7

  // Filing flags
  is_foreign_corp: boolean;            // Foreign corp without US office
  is_consolidated_return: boolean;
  member_of_consolidated_group: boolean;

  // Calendar reference
  original_due_date: string;            // What we're extending FROM
  extended_due_date: string;             // What we're extending TO
  extension_months: number;              // Usually 6

  warnings: string[];
}

export interface Form7004Opts {
  form_code: Form7004Code;
  tax_year_start?: string;
  tax_year_end?: string;
  estimated_total_tax?: number;
  estimated_payments?: number;
  is_foreign_corp?: boolean;
  is_consolidated?: boolean;
  short_year_reason?: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function getOriginalDueDate(formCode: Form7004Code, taxYearEnd: string): string {
  const [yyyy, mm] = taxYearEnd.split('-');
  const fiscalYearEnd = parseInt(mm);
  // Calendar-year filers (year ends Dec 31):
  //   1065, 1120-S → 15th day of 3rd month after year-end (Mar 15)
  //   1120 → 15th day of 4th month (Apr 15)
  //   1041 → 15th day of 4th month (Apr 15)
  //   990 series → 15th day of 5th month (May 15)
  // Fiscal-year filers shift accordingly.
  const yearAfter = parseInt(yyyy);
  const monthAfter = fiscalYearEnd + (formCode === '11' || formCode === '04' ? 4 : 3);
  const dueMonth = ((monthAfter - 1) % 12) + 1;
  const dueYear = yearAfter + Math.floor((monthAfter - 1) / 12);
  return `${dueYear}-${String(dueMonth).padStart(2, '0')}-15`;
}

function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const newMonth = m + months;
  const newYear = y + Math.floor((newMonth - 1) / 12);
  const adjustedMonth = ((newMonth - 1) % 12) + 1;
  return `${newYear}-${String(adjustedMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function computeForm7004(
  companyId: string,
  opts: Form7004Opts,
): Form7004Data {
  const company = db.getById('companies', companyId) as any || {};

  const taxYearEnd = opts.tax_year_end || (new Date().getFullYear() + '-12-31');
  const taxYearStart = opts.tax_year_start || (parseInt(taxYearEnd.slice(0, 4)) + '-01-01');

  const totalTax = round2(opts.estimated_total_tax || 0);
  const totalPayments = round2(opts.estimated_payments || 0);
  const balanceDue = Math.max(0, round2(totalTax - totalPayments));

  const originalDueDate = getOriginalDueDate(opts.form_code, taxYearEnd);
  const extensionMonths = opts.is_foreign_corp ? 6 : 6;   // All extensions are 6 months
  const extendedDueDate = addMonths(originalDueDate, extensionMonths);

  const warnings: string[] = [];
  if (totalTax === 0) {
    warnings.push('Estimated total tax (line 6) was not provided. Pass via opts.estimated_total_tax. The IRS rejects extensions filed with a $0 estimate when the actual tax liability is non-zero.');
  }
  if (balanceDue > 0) {
    warnings.push('Balance due of $' + balanceDue.toFixed(2) + ' must be PAID with this form (or via EFTPS/Direct Pay) — an extension to file is NOT an extension to pay. Failure-to-pay penalty applies if unpaid.');
  }
  if (!company.ein && !company.tax_id) {
    warnings.push('EIN missing on company record — required on Form 7004.');
  }
  const today = new Date().toISOString().slice(0, 10);
  if (today > originalDueDate) {
    warnings.push('Today (' + today + ') is past the original due date (' + originalDueDate + '). Extension must be filed BY the original due date — it will not be granted retroactively.');
  }
  if (taxYearStart.slice(5, 10) !== '01-01' || taxYearEnd.slice(5, 10) !== '12-31') {
    warnings.push('Fiscal-year filing detected. Verify the original due date — it shifts based on fiscal year end.');
  }

  return {
    taxpayer_name: company.legal_name || company.name || '',
    trade_name: company.name || '',
    ein: company.ein || company.tax_id || '',
    address: company.address_line1 || '',
    city: company.city || '',
    state: company.state || '',
    zip: company.zip || '',

    form_code: opts.form_code,
    form_code_description: FORM_7004_CODES[opts.form_code] || 'Unknown form code',

    tax_year_start: taxYearStart,
    tax_year_end: taxYearEnd,
    is_short_tax_year: !!opts.short_year_reason,
    short_year_reason: opts.short_year_reason || '',

    line6_tentative_total_tax: totalTax,
    line7_total_payments_credits: totalPayments,
    line8_balance_due: balanceDue,

    is_foreign_corp: !!opts.is_foreign_corp,
    is_consolidated_return: false,
    member_of_consolidated_group: !!opts.is_consolidated,

    original_due_date: originalDueDate,
    extended_due_date: extendedDueDate,
    extension_months: extensionMonths,

    warnings,
  };
}
