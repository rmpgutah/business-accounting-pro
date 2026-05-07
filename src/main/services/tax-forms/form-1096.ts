// src/main/services/tax-forms/form-1096.ts
//
// IRS Form 1096 — Annual Summary and Transmittal of U.S. Information
// Returns. The cover sheet that accompanies paper-filed 1099 forms
// (NEC, MISC, INT, DIV, R, K, B, G, C, SA, etc.). Lists how many of
// each form type are being transmitted and the total dollar amount.
//
// Note: 1096 is NOT used for e-filing — it's only for paper. If
// you e-file via FIRE / IRIS, no 1096 is needed.
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-form-1096

import * as db from '../../database';
import { compute1099NECs } from './form-1099-nec';
import { compute1099MISCs } from './form-1099-misc';
import { compute1099INTs } from './form-1099-int';
import { compute1099DIVs } from './form-1099-div';
import { compute1099Rs } from './form-1099-r';
import { compute1099Ks } from './form-1099-k';
import { compute1099Bs, compute1099Gs, compute1099Cs, compute1099SAs } from './form-1099-other';

export type Form1099Variant = '1099-NEC' | '1099-MISC' | '1099-INT' | '1099-DIV' | '1099-R' | '1099-K' | '1099-B' | '1099-G' | '1099-C' | '1099-SA';

export interface Form1099SummaryRow {
  variant: Form1099Variant;
  irs_box: string;                      // The box on Form 1096 to check (e.g., "71" for 1099-NEC)
  forms_count: number;                  // Number of forms transmitted (1096 box 3)
  total_amount: number;                 // Total federal income tax withheld + amounts (1096 box 5)
  ready_to_file_count: number;          // Forms with TIN AND threshold met
}

export interface Form1096Data {
  // Filer identity
  filer_name: string;
  filer_address: string;
  filer_city: string;
  filer_state: string;
  filer_zip: string;
  filer_ein: string;
  filer_phone: string;
  filer_email: string;
  contact_name: string;

  year: number;

  // Box 3 — total number of forms (across all variants)
  total_forms: number;
  // Box 4 — federal income tax withheld (sum across all forms)
  total_fed_withheld: number;
  // Box 5 — total amount reported (sum across all forms)
  total_reported: number;

  // Per-variant breakdown — one row per 1099 type with non-zero forms
  rows: Form1099SummaryRow[];

  warnings: string[];
}

// IRS Form 1096 (2025): each 1099 variant maps to a specific box number
// in the lower half of the form. The user checks ONE box per 1096
// transmittal — meaning a separate 1096 is filed for each 1099 type.
const VARIANT_BOX_MAP: Record<Form1099Variant, string> = {
  '1099-NEC':  '71',
  '1099-MISC': '95',
  '1099-INT':  '92',
  '1099-DIV':  '91',
  '1099-R':    '98',
  '1099-K':    '10',
  '1099-B':    '79',
  '1099-G':    '86',
  '1099-C':    '85',
  '1099-SA':   '94',
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeForm1096(companyId: string, year: number): Form1096Data {
  const company = db.getById('companies', companyId) as any || {};

  // Pull each variant's forms for the year, only counting those that
  // would actually be filed (threshold met + has TIN).
  const variants: Array<{ name: Form1099Variant; forms: any[]; amountKey: string; withheldKey: string }> = [
    { name: '1099-NEC',  forms: compute1099NECs(companyId, year), amountKey: 'box1_nonemployee_comp', withheldKey: 'box4_fed_income_tax_withheld' },
    { name: '1099-MISC', forms: compute1099MISCs(companyId, year), amountKey: 'total_paid', withheldKey: 'box4_fed_tax_withheld' },
    { name: '1099-INT',  forms: compute1099INTs(companyId, year), amountKey: 'box1_interest_income', withheldKey: 'box4_fed_tax_withheld' },
    { name: '1099-DIV',  forms: compute1099DIVs(companyId, year), amountKey: 'box1a_total_ordinary_dividends', withheldKey: 'box4_fed_tax_withheld' },
    { name: '1099-R',    forms: compute1099Rs(companyId, year), amountKey: 'box1_gross_distribution', withheldKey: 'box4_fed_tax_withheld' },
    { name: '1099-K',    forms: compute1099Ks(companyId, year), amountKey: 'box1a_gross_amount', withheldKey: 'box4_fed_tax_withheld' },
    { name: '1099-B',    forms: compute1099Bs(companyId, year), amountKey: 'box1d_proceeds', withheldKey: 'box4_fed_tax_withheld' },
    { name: '1099-G',    forms: compute1099Gs(companyId, year), amountKey: 'box1_unemployment_comp', withheldKey: 'box4_fed_tax_withheld' },
    { name: '1099-C',    forms: compute1099Cs(companyId, year), amountKey: 'box2_amount_debt_canceled', withheldKey: '' },
    { name: '1099-SA',   forms: compute1099SAs(companyId, year), amountKey: 'box1_gross_distribution', withheldKey: '' },
  ];

  const rows: Form1099SummaryRow[] = [];
  let totalForms = 0;
  let totalFedWithheld = 0;
  let totalReported = 0;

  for (const v of variants) {
    if (v.forms.length === 0) continue;
    const ready = v.forms.filter((f: any) => f.meets_filing_threshold && f.has_tin);
    const total = v.forms.reduce((s: number, f: any) => s + (Number(f[v.amountKey]) || 0), 0);
    const withheld = v.withheldKey
      ? v.forms.reduce((s: number, f: any) => s + (Number(f[v.withheldKey]) || 0), 0)
      : 0;
    rows.push({
      variant: v.name,
      irs_box: VARIANT_BOX_MAP[v.name],
      forms_count: v.forms.length,
      ready_to_file_count: ready.length,
      total_amount: round2(total),
    });
    totalForms += v.forms.length;
    totalFedWithheld += withheld;
    totalReported += total;
  }

  const warnings: string[] = [];
  if (totalForms === 0) {
    warnings.push('No 1099s found for ' + year + ' — Form 1096 not required.');
  }
  if (rows.length > 1) {
    warnings.push('Multiple 1099 types detected — file a SEPARATE Form 1096 for each type. Check only ONE box per 1096.');
  }
  const blocked = rows.filter((r) => r.forms_count > r.ready_to_file_count);
  if (blocked.length > 0) {
    warnings.push(blocked.length + ' variant(s) have forms below the filing threshold or missing TINs. Resolve before paper filing.');
  }
  if (!company.ein && !company.tax_id) {
    warnings.push('Filer EIN missing — required on Form 1096.');
  }

  return {
    filer_name: company.legal_name || company.name || '',
    filer_address: [company.address_line1, company.address_line2].filter(Boolean).join(', '),
    filer_city: company.city || '',
    filer_state: company.state || '',
    filer_zip: company.zip || '',
    filer_ein: company.ein || company.tax_id || '',
    filer_phone: company.phone || '',
    filer_email: company.email || '',
    contact_name: company.tax_contact_name || '',
    year,
    total_forms: totalForms,
    total_fed_withheld: round2(totalFedWithheld),
    total_reported: round2(totalReported),
    rows,
    warnings,
  };
}
