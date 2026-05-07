// src/main/services/tax-forms/form-w2c.ts
//
// IRS Form W-2c — Corrected Wage and Tax Statement.
//
// Filed when an already-issued W-2 needs correction (wrong SSN,
// wrong wages, etc.). The form shows BOTH the originally-reported
// amount and the corrected amount side-by-side, so the SSA can
// reconcile. A W-3c transmittal accompanies it.
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-form-w-2c
//
// What this DOES:
//   • Pulls the existing W-2 data via computeW2sForYear() to populate
//     the "previously reported" column
//   • Accepts a `corrections` map of fields to override → produces
//     the "corrected" column
//   • Returns one W-2c per affected employee

import { computeW2sForYear, FormW2Data } from './form-w2';

export interface W2CCorrections {
  employee_id: string;
  // Any of these fields overrides the original W-2 value
  box1_wages_tips?: number;
  box2_fed_income_tax?: number;
  box3_ss_wages?: number;
  box4_ss_tax?: number;
  box5_medicare_wages?: number;
  box6_medicare_tax?: number;
  box15_state?: string;
  box16_state_wages?: number;
  box17_state_income_tax?: number;
  employee_ssn?: string;
  employee_first_name?: string;
  employee_last_name?: string;
  employee_address?: string;
  reason?: string;                // For audit log
}

export interface FormW2CData {
  // Identity (employer + employee — same as W-2)
  employer_ein: string;
  employer_name: string;
  employer_address: string;
  employer_city: string;
  employer_state: string;
  employer_zip: string;
  employee_id: string;
  tax_year: number;

  // Each box has prev/corrected pair
  prev: FormW2Data;
  corrected: FormW2Data;

  // Flags
  changed_fields: string[];       // List of field names that differ
  reason: string;                 // User-supplied reason for correction

  warnings: string[];
}

function pickChanged(prev: FormW2Data, corrected: FormW2Data): string[] {
  const fields = [
    'employee_ssn', 'employee_first_name', 'employee_last_name', 'employee_address',
    'box1_wages_tips', 'box2_fed_income_tax',
    'box3_ss_wages', 'box4_ss_tax',
    'box5_medicare_wages', 'box6_medicare_tax',
    'box15_state', 'box16_state_wages', 'box17_state_income_tax',
  ];
  return fields.filter((f) => {
    const a = (prev as any)[f];
    const b = (corrected as any)[f];
    return typeof a === 'number' ? Math.abs(a - b) > 0.005 : a !== b;
  });
}

export function computeW2Cs(
  companyId: string,
  year: number,
  corrections: W2CCorrections[],
): FormW2CData[] {
  const originalForms = computeW2sForYear(companyId, year);
  const results: FormW2CData[] = [];

  for (const correction of corrections) {
    const prev = originalForms.find((w) => w.employee_id === correction.employee_id);
    if (!prev) continue;

    // Build corrected version by applying overrides to a clone
    const corrected: FormW2Data = { ...prev };
    if (correction.box1_wages_tips !== undefined) corrected.box1_wages_tips = correction.box1_wages_tips;
    if (correction.box2_fed_income_tax !== undefined) corrected.box2_fed_income_tax = correction.box2_fed_income_tax;
    if (correction.box3_ss_wages !== undefined) corrected.box3_ss_wages = correction.box3_ss_wages;
    if (correction.box4_ss_tax !== undefined) corrected.box4_ss_tax = correction.box4_ss_tax;
    if (correction.box5_medicare_wages !== undefined) corrected.box5_medicare_wages = correction.box5_medicare_wages;
    if (correction.box6_medicare_tax !== undefined) corrected.box6_medicare_tax = correction.box6_medicare_tax;
    if (correction.box15_state !== undefined) corrected.box15_state = correction.box15_state;
    if (correction.box16_state_wages !== undefined) corrected.box16_state_wages = correction.box16_state_wages;
    if (correction.box17_state_income_tax !== undefined) corrected.box17_state_income_tax = correction.box17_state_income_tax;
    if (correction.employee_ssn !== undefined) corrected.employee_ssn = correction.employee_ssn;
    if (correction.employee_first_name !== undefined) corrected.employee_first_name = correction.employee_first_name;
    if (correction.employee_last_name !== undefined) corrected.employee_last_name = correction.employee_last_name;
    if (correction.employee_address !== undefined) corrected.employee_address = correction.employee_address;

    const changedFields = pickChanged(prev, corrected);
    const warnings: string[] = [];
    if (changedFields.length === 0) {
      warnings.push('No fields differ from the originally reported W-2 — W-2c not required.');
    }
    if (changedFields.includes('employee_ssn')) {
      warnings.push('SSN correction triggers special handling — SSA will need both old and new SSN clearly listed in box i (originally reported) and box d (corrected).');
    }

    results.push({
      employer_ein: prev.employer_ein,
      employer_name: prev.employer_name,
      employer_address: prev.employer_address,
      employer_city: prev.employer_city,
      employer_state: prev.employer_state,
      employer_zip: prev.employer_zip,
      employee_id: correction.employee_id,
      tax_year: year,
      prev,
      corrected,
      changed_fields: changedFields,
      reason: correction.reason || '',
      warnings,
    });
  }

  return results;
}
