// src/main/services/tax-forms/form-w3.ts
//
// IRS Form W-3 — Transmittal of Wage and Tax Statements.
//
// W-3 is the cover sheet that consolidates all W-2s an employer
// issues for a calendar year. The SSA reads W-3 totals to
// reconcile against the sum of the attached W-2s — the totals
// must agree to the penny.
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-form-w-3
//   • SSA EFW2 specification (electronic filing format)
//
// What this DOES:
//   • Re-runs computeW2sForYear() and sums box1-box19 across all
//     forms, returning a single transmittal record
//   • Computes the "Kind of Payer" / "Kind of Employer" flags
//     from company config (default: 941, regular employer)
//   • Returns the W-2 list alongside so the UI can show "totals
//     reconcile to N attached W-2s"
//
// W-3 totals MUST equal the W-2 totals — if a user manually
// edits a W-2 box in the future, this recomputation pulls the
// updated value automatically.

import * as db from '../../database';
import { computeW2sForYear, FormW2Data } from './form-w2';

export interface FormW3Data {
  // Filing identity
  control_number: string;            // Box a
  kind_of_payer: '941' | '943' | '944' | 'CT-1' | 'Hshld' | 'Medicare';  // Box b
  kind_of_employer: 'None' | '501c' | 'State/local non-501c' | 'State/local 501c' | 'Federal govt';
  third_party_sick_pay: boolean;     // Box b checkbox
  number_of_w2s: number;             // Box c
  establishment_number: string;       // Box d
  employer_ein: string;              // Box e
  employer_name: string;             // Box f / g
  employer_address: string;
  employer_city: string;
  employer_state: string;
  employer_zip: string;
  other_ein: string;                 // Box h — prior EIN if changed mid-year

  tax_year: number;

  // Box totals (sum of all attached W-2s)
  box1_total_wages_tips: number;
  box2_total_fed_income_tax: number;
  box3_total_ss_wages: number;
  box4_total_ss_tax: number;
  box5_total_medicare_wages: number;
  box6_total_medicare_tax: number;
  box7_total_ss_tips: number;
  box8_total_allocated_tips: number;
  box10_total_dependent_care: number;
  box11_total_nonqualified: number;
  box12a_total: number;              // Code D + E + F + G + H + S + Y + AA + BB + EE
  box14_total_other: number;
  box15_state: string;
  box16_total_state_wages: number;
  box17_total_state_income_tax: number;
  box18_total_local_wages: number;
  box19_total_local_income_tax: number;

  // Reconciliation aids
  box12_breakdown: Array<{ code: string; total: number; label: string }>;

  // Contact
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  contact_fax: string;

  // Computation metadata
  forms_attached: number;
  warnings: string[];

  // The W-2 list — UI shows "X forms reconciled" + drilldown
  w2_forms: FormW2Data[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeW3(companyId: string, year: number): FormW3Data {
  const dbi = db.getDb();
  const company = db.getById('companies', companyId) as any || {};

  const w2s = computeW2sForYear(companyId, year);

  // Sum every numeric box across all W-2s
  const sums = w2s.reduce((acc, w) => {
    acc.box1 += w.box1_wages_tips;
    acc.box2 += w.box2_fed_income_tax;
    acc.box3 += w.box3_ss_wages;
    acc.box4 += w.box4_ss_tax;
    acc.box5 += w.box5_medicare_wages;
    acc.box6 += w.box6_medicare_tax;
    acc.box7 += w.box7_ss_tips;
    acc.box8 += w.box8_allocated_tips;
    acc.box10 += w.box10_dependent_care;
    acc.box11 += w.box11_nonqualified_plans;
    acc.box16 += w.box16_state_wages;
    acc.box17 += w.box17_state_income_tax;
    acc.box18 += w.box18_local_wages;
    acc.box19 += w.box19_local_income_tax;
    return acc;
  }, {
    box1: 0, box2: 0, box3: 0, box4: 0, box5: 0, box6: 0,
    box7: 0, box8: 0, box10: 0, box11: 0,
    box16: 0, box17: 0, box18: 0, box19: 0,
  });

  // Box 12 breakdown — sum across all W-2s grouped by code
  const code12: Map<string, { total: number; label: string }> = new Map();
  for (const w of w2s) {
    for (const c of w.box12_codes) {
      const cur = code12.get(c.code);
      if (cur) cur.total += c.amount;
      else code12.set(c.code, { total: c.amount, label: c.label });
    }
  }
  const box12_breakdown = Array.from(code12.entries())
    .map(([code, v]) => ({ code, total: round2(v.total), label: v.label }))
    .sort((a, b) => b.total - a.total);
  const box12a_total = round2(box12_breakdown.reduce((s, b) => s + b.total, 0));

  // Detect majority state — W-3 reports a single Box 15 state
  const stateCounts = new Map<string, number>();
  for (const w of w2s) {
    const s = w.box15_state || '';
    if (!s) continue;
    stateCounts.set(s, (stateCounts.get(s) || 0) + 1);
  }
  let majorityState = '';
  let maxCount = 0;
  for (const [s, c] of stateCounts) {
    if (c > maxCount) { maxCount = c; majorityState = s; }
  }

  const warnings: string[] = [];
  if (w2s.length === 0) warnings.push('No W-2s for ' + year + ' — nothing to transmit.');
  if (w2s.some((w) => w.warnings.length > 0)) {
    const blockers = w2s.filter((w) => w.warnings.some((x) => x.toLowerCase().includes('ssn missing')));
    if (blockers.length > 0) {
      warnings.push(blockers.length + ' employee(s) missing SSN — these W-2s cannot be filed.');
    }
  }
  if (!company.ein && !company.tax_id) {
    warnings.push('Employer EIN missing — required on W-3.');
  }
  if (stateCounts.size > 1) {
    warnings.push('Multi-state employees detected (' + stateCounts.size + ' states) — file separate state W-3 equivalents per state DOR.');
  }

  // Sanity: reconcile sums to FICA rates
  const expectedSSTax = round2(sums.box3 * 0.062);
  if (Math.abs(sums.box4 - expectedSSTax) > 1) {
    warnings.push('Total SS tax ($' + round2(sums.box4) + ') does not match 6.2% × total SS wages ($' + expectedSSTax + ').');
  }
  const expectedMedTax = round2(sums.box5 * 0.0145);
  if (Math.abs(sums.box6 - expectedMedTax) > 5) {
    // Looser bound — addtl Medicare 0.9% may be in here for high earners
    warnings.push('Total Medicare tax variance > $5 from expected (1.45% + addtl 0.9% over $200k).');
  }

  // Default kind_of_payer: 941 (most quarterly filers).
  // 944 if company config flag set; 943 if agricultural; etc.
  let kind_of_payer: FormW3Data['kind_of_payer'] = '941';
  if (company.tax_filer_type === '944') kind_of_payer = '944';
  else if (company.tax_filer_type === '943') kind_of_payer = '943';

  // Pull contact info
  const contactName = company.tax_contact_name || company.contact_name || '';
  const contactPhone = company.phone || '';
  const contactEmail = company.email || '';

  return {
    control_number: '',
    kind_of_payer,
    kind_of_employer: 'None',
    third_party_sick_pay: false,
    number_of_w2s: w2s.length,
    establishment_number: '',
    employer_ein: company.ein || company.tax_id || '',
    employer_name: company.legal_name || company.name || '',
    employer_address: [company.address_line1, company.address_line2].filter(Boolean).join(', '),
    employer_city: company.city || '',
    employer_state: company.state || '',
    employer_zip: company.zip || '',
    other_ein: '',

    tax_year: year,

    box1_total_wages_tips: round2(sums.box1),
    box2_total_fed_income_tax: round2(sums.box2),
    box3_total_ss_wages: round2(sums.box3),
    box4_total_ss_tax: round2(sums.box4),
    box5_total_medicare_wages: round2(sums.box5),
    box6_total_medicare_tax: round2(sums.box6),
    box7_total_ss_tips: round2(sums.box7),
    box8_total_allocated_tips: round2(sums.box8),
    box10_total_dependent_care: round2(sums.box10),
    box11_total_nonqualified: round2(sums.box11),
    box12a_total,
    box14_total_other: 0,
    box15_state: majorityState,
    box16_total_state_wages: round2(sums.box16),
    box17_total_state_income_tax: round2(sums.box17),
    box18_total_local_wages: round2(sums.box18),
    box19_total_local_income_tax: round2(sums.box19),

    box12_breakdown,

    contact_name: contactName,
    contact_phone: contactPhone,
    contact_email: contactEmail,
    contact_fax: company.fax || '',

    forms_attached: w2s.length,
    warnings,
    w2_forms: w2s,
  };
}
