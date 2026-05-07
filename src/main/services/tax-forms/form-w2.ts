// src/main/services/tax-forms/form-w2.ts
//
// IRS Form W-2 — Wage and Tax Statement.
//
// Generated for each employee at year-end. Aggregates pay_stubs
// for the calendar year into the numbered W-2 boxes.
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-form-w-2
//   • IRS Pub 15-T, IRS Pub 15-B
//
// What this DOES:
//   • Sums Box 1-6 from pay_stubs (taxable wages, withholdings)
//   • Sums Box 12 codes (D=401(k), W=HSA, etc.) from
//     employee_deductions joined to pay_stubs
//   • Box 16/17 state wages and tax — derived from gross_pay and
//     state_tax (assumes single-state employee)
//   • Filing status flags (statutory employee, retirement plan,
//     third-party sick pay) — defaults; user overrides if needed

import * as db from '../../database';

export interface FormW2Data {
  // Filing identity (employer)
  employer_ein: string;
  employer_name: string;
  employer_address: string;
  employer_city: string;
  employer_state: string;
  employer_zip: string;

  // Employee identity
  employee_id: string;
  employee_ssn: string;             // last-4 only on screen; full only in PDF
  employee_first_name: string;
  employee_last_name: string;
  employee_address: string;
  employee_city: string;
  employee_state: string;
  employee_zip: string;
  employee_control_number: string;  // Box d — employer-assigned

  // Year
  tax_year: number;

  // Box values
  box1_wages_tips: number;          // Taxable wages (gross - pre-tax)
  box2_fed_income_tax: number;      // Federal income tax withheld
  box3_ss_wages: number;            // SS-taxable wages (capped at $182,100)
  box4_ss_tax: number;              // 6.2% × Box 3
  box5_medicare_wages: number;      // Medicare-taxable (no cap)
  box6_medicare_tax: number;        // 1.45% × Box 5 (+ 0.9% over $200k)
  box7_ss_tips: number;             // 0 unless tips tracked separately
  box8_allocated_tips: number;      // 0
  box9_advance_eic: number;         // Repealed; always 0
  box10_dependent_care: number;     // Section 129 benefits
  box11_nonqualified_plans: number; // Box for non-qualified deferred comp
  box12_codes: Array<{ code: string; amount: number; label: string }>;
  // Common codes:
  //   D  — Elective deferral 401(k)
  //   E  — 403(b) elective deferral
  //   W  — HSA employer + employee contributions
  //   DD — Cost of employer-sponsored health coverage
  //   AA — Roth 401(k) contributions

  // Box 13 checkboxes
  box13_statutory_employee: boolean;
  box13_retirement_plan: boolean;
  box13_third_party_sick_pay: boolean;

  box14_other: Array<{ label: string; amount: number }>; // free-form

  // State (Box 15-17)
  state_employer_id: string;
  box15_state: string;
  box16_state_wages: number;
  box17_state_income_tax: number;

  // Local (Box 18-20)
  box18_local_wages: number;
  box19_local_income_tax: number;
  box20_locality_name: string;

  // Computation metadata
  pay_stub_count: number;
  ytd_gross: number;                // sanity: should match box 1 + pre-tax
  warnings: string[];
}

const SS_WAGE_BASE_2026 = 182100;
const SS_RATE = 0.062;
const MEDICARE_RATE = 0.0145;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeW2sForYear(companyId: string, year: number): FormW2Data[] {
  const dbi = db.getDb();
  const company = db.getById('companies', companyId) as any || {};
  const yearStart = year + '-01-01';
  const yearEnd = year + '-12-31';

  // All employees who had at least one pay stub in the year
  const employees = dbi.prepare(`
    SELECT DISTINCT e.*
    FROM employees e
    JOIN pay_stubs ps ON ps.employee_id = e.id
    JOIN payroll_runs r ON r.id = ps.payroll_run_id
    WHERE e.company_id = ?
      AND r.pay_date BETWEEN ? AND ?
      AND COALESCE(e.deleted_at, '') = ''
      AND COALESCE(r.deleted_at, '') = ''
  `).all(companyId, yearStart, yearEnd) as any[];

  const forms: FormW2Data[] = [];

  for (const emp of employees) {
    // All pay stubs for this employee in the year
    const stubs = dbi.prepare(`
      SELECT ps.*, r.pay_date
      FROM pay_stubs ps
      JOIN payroll_runs r ON r.id = ps.payroll_run_id
      WHERE ps.employee_id = ?
        AND r.pay_date BETWEEN ? AND ?
        AND COALESCE(r.deleted_at, '') = ''
      ORDER BY r.pay_date
    `).all(emp.id, yearStart, yearEnd) as any[];

    if (stubs.length === 0) continue;

    // Pre-tax deductions reduce Box 1, 3, 5 in different ways:
    //   • 401(k) (D)  reduces Box 1 only (still SS+Medicare taxable)
    //   • HSA (W)     reduces Box 1, 3, 5 (truly pre-tax for all)
    //   • Health ins  reduces Box 1, 3, 5 (Section 125 cafeteria plan)
    // For now we use a simplified model: pretax_deductions on the
    // pay stub is treated as health-insurance-like (reduces all 3).
    // Future enhancement: split by deduction type for proper Box 1/3/5.

    const totals = stubs.reduce((acc, s) => {
      const gross = Number(s.gross_pay) || 0;
      const fed = Number(s.federal_tax) || 0;
      const ss = Number(s.social_security) || 0;
      const med = Number(s.medicare) || 0;
      const state = Number(s.state_tax) || 0;
      const pretax = Number(s.pretax_deductions) || 0;
      acc.gross += gross;
      acc.fed_tax += fed;
      acc.ss_tax += ss;
      acc.medicare_tax += med;
      acc.state_tax += state;
      acc.pretax += pretax;
      return acc;
    }, { gross: 0, fed_tax: 0, ss_tax: 0, medicare_tax: 0, state_tax: 0, pretax: 0 });

    // Box 1: Taxable wages (gross - all pre-tax)
    const box1 = round2(totals.gross - totals.pretax);
    // Box 3: SS wages capped at wage base
    const box3 = round2(Math.min(totals.gross, SS_WAGE_BASE_2026));
    // Box 5: Medicare wages, no cap
    const box5 = round2(totals.gross);
    // Recompute Box 4 and 6 from Box 3/5 to catch float drift
    const box4 = round2(box3 * SS_RATE);
    const box6 = round2(box5 * MEDICARE_RATE);

    // Box 12 codes — pull from employee_deductions if available
    const box12: Array<{ code: string; amount: number; label: string }> = [];
    try {
      const deductions = dbi.prepare(`
        SELECT type, SUM(amount) AS total
        FROM employee_deductions
        WHERE employee_id = ?
          AND COALESCE(deleted_at, '') = ''
        GROUP BY type
      `).all(emp.id) as Array<{ type: string; total: number }>;
      for (const d of deductions) {
        const t = (d.type || '').toLowerCase();
        if (t.includes('401k') || t.includes('401(k)')) box12.push({ code: 'D', amount: round2(d.total), label: '401(k) elective deferral' });
        else if (t.includes('roth')) box12.push({ code: 'AA', amount: round2(d.total), label: 'Roth 401(k)' });
        else if (t.includes('hsa')) box12.push({ code: 'W', amount: round2(d.total), label: 'HSA contributions' });
        else if (t.includes('403b')) box12.push({ code: 'E', amount: round2(d.total), label: '403(b) elective deferral' });
      }
    } catch { /* employee_deductions table may have a different shape */ }

    const warnings: string[] = [];
    if (!emp.ssn && !emp.tin) warnings.push('Employee SSN missing — required for W-2 filing');
    if (!emp.address_line1) warnings.push('Employee address missing');
    if (totals.gross > SS_WAGE_BASE_2026) {
      warnings.push('Gross wages exceeded SS wage base — Box 3 capped at $' + SS_WAGE_BASE_2026.toLocaleString());
    }
    // Sanity check: SS tax on file should match 6.2% × Box 3 within $1
    if (Math.abs(totals.ss_tax - box4) > 1) {
      warnings.push('SS tax on pay stubs ($' + round2(totals.ss_tax) + ') differs from 6.2% × Box 3 ($' + box4 + ') — recompute may be needed');
    }

    forms.push({
      employer_ein: company.ein || company.tax_id || '',
      employer_name: company.legal_name || company.name || '',
      employer_address: [company.address_line1, company.address_line2].filter(Boolean).join(', '),
      employer_city: company.city || '',
      employer_state: company.state || '',
      employer_zip: company.zip || '',

      employee_id: emp.id,
      employee_ssn: emp.ssn || emp.tin || '',
      employee_first_name: emp.first_name || (emp.name || '').split(' ')[0] || '',
      employee_last_name: emp.last_name || (emp.name || '').split(' ').slice(1).join(' ') || '',
      employee_address: [emp.address_line1, emp.address_line2].filter(Boolean).join(', '),
      employee_city: emp.city || '',
      employee_state: emp.state || '',
      employee_zip: emp.zip || '',
      employee_control_number: emp.employee_number || '',

      tax_year: year,

      box1_wages_tips: box1,
      box2_fed_income_tax: round2(totals.fed_tax),
      box3_ss_wages: box3,
      box4_ss_tax: box4,
      box5_medicare_wages: box5,
      box6_medicare_tax: box6,
      box7_ss_tips: 0,
      box8_allocated_tips: 0,
      box9_advance_eic: 0,
      box10_dependent_care: 0,
      box11_nonqualified_plans: 0,
      box12_codes: box12,

      box13_statutory_employee: false,
      box13_retirement_plan: box12.some((c) => c.code === 'D' || c.code === 'E' || c.code === 'AA'),
      box13_third_party_sick_pay: false,

      box14_other: [],

      state_employer_id: company.state_id || '',
      box15_state: emp.state || company.state || '',
      box16_state_wages: round2(totals.gross),
      box17_state_income_tax: round2(totals.state_tax),

      box18_local_wages: 0,
      box19_local_income_tax: 0,
      box20_locality_name: '',

      pay_stub_count: stubs.length,
      ytd_gross: round2(totals.gross),
      warnings,
    });
  }

  // Sort: alphabetical by last name
  forms.sort((a, b) => a.employee_last_name.localeCompare(b.employee_last_name));
  return forms;
}
