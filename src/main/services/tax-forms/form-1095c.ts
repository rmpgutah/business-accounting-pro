// src/main/services/tax-forms/form-1095c.ts
//
// IRS Form 1095-C — Employer-Provided Health Insurance Offer and
// Coverage. Filed by Applicable Large Employers (ALEs — 50+ FTE
// employees) for each full-time employee. Reports whether minimum
// essential coverage (MEC) was offered and the employee share of
// the lowest-cost premium.
//
// Pairs with Form 1094-C (transmittal).
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-form-1095-c

import * as db from '../../database';

export interface Form1095CData {
  // Part I — Employee
  employee_id: string;
  employee_name: string;
  employee_ssn: string;
  employee_address: string;

  // Part I — Employer
  employer_name: string;
  employer_ein: string;
  employer_address: string;

  // Part I — Plan year info
  plan_start_month: string;             // "01"-"12" or "00" (no plan)

  // Part II — Employee Offer of Coverage (per-month, line 14)
  // Codes are 1A-1U, e.g.:
  //   1A = Qualifying offer (MV at affordable cost)
  //   1B = MEC offered, MV
  //   1H = No offer of coverage
  // We default to 1H (no offer) and let the user override.
  line14_codes: {
    all_12_months: string;              // If same for all months
    jan: string; feb: string; mar: string; apr: string; may: string; jun: string;
    jul: string; aug: string; sep: string; oct: string; nov: string; dec: string;
  };

  // Part II — Employee Share of Premium (per-month, line 15)
  // Only required if line 14 is 1B/1C/1D/1E/1J/1K
  line15_amounts: {
    all_12_months: number;
    jan: number; feb: number; mar: number; apr: number; may: number; jun: number;
    jul: number; aug: number; sep: number; oct: number; nov: number; dec: number;
  };

  // Part II — Section 4980H Safe Harbor (per-month, line 16)
  // Codes 2A-2I, e.g.:
  //   2A = Not employed
  //   2C = Employee enrolled in coverage offered
  //   2H = Section 4980H affordability rate of pay safe harbor
  line16_codes: {
    all_12_months: string;
    jan: string; feb: string; mar: string; apr: string; may: string; jun: string;
    jul: string; aug: string; sep: string; oct: string; nov: string; dec: string;
  };

  // Part III — Covered Individuals (only if employer is self-insured)
  is_self_insured: boolean;
  covered_individuals: Array<{
    name: string;
    ssn_or_dob: string;
    months_covered: { all: boolean; jan: boolean; feb: boolean; mar: boolean; apr: boolean; may: boolean; jun: boolean; jul: boolean; aug: boolean; sep: boolean; oct: boolean; nov: boolean; dec: boolean };
  }>;

  warnings: string[];
}

export interface Form1095COpts {
  employee_id: string;
  is_self_insured?: boolean;
  plan_start_month?: string;
  // Default coverage codes (if not specified per-month)
  default_line14_code?: string;
  default_line15_amount?: number;
  default_line16_code?: string;
  // Per-month overrides (when employee was hired/terminated mid-year)
  line14_overrides?: Partial<Record<'jan' | 'feb' | 'mar' | 'apr' | 'may' | 'jun' | 'jul' | 'aug' | 'sep' | 'oct' | 'nov' | 'dec', string>>;
  line15_overrides?: Partial<Record<'jan' | 'feb' | 'mar' | 'apr' | 'may' | 'jun' | 'jul' | 'aug' | 'sep' | 'oct' | 'nov' | 'dec', number>>;
  line16_overrides?: Partial<Record<'jan' | 'feb' | 'mar' | 'apr' | 'may' | 'jun' | 'jul' | 'aug' | 'sep' | 'oct' | 'nov' | 'dec', string>>;
  covered_individuals?: Form1095CData['covered_individuals'];
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;

export function computeForm1095C(
  companyId: string,
  opts: Form1095COpts,
): Form1095CData {
  const dbi = db.getDb();
  const company = db.getById('companies', companyId) as any || {};
  const employee = (db.getById('employees', opts.employee_id) as any) || {};

  // Default codes for the year
  const defaultLine14 = opts.default_line14_code || '1H';   // No offer
  const defaultLine15 = opts.default_line15_amount || 0;
  const defaultLine16 = opts.default_line16_code || '';

  // Build per-month codes (string) or amounts (number) with overrides
  const buildMonthMap = <T,>(defaultVal: T, overrides: any = {}): any => ({
    all_12_months: Object.keys(overrides).length === 0 ? defaultVal : (typeof defaultVal === 'number' ? 0 : ''),
    ...Object.fromEntries(MONTHS.map((m) => [m, overrides[m] ?? defaultVal])),
  });

  const line14 = buildMonthMap<string>(defaultLine14, opts.line14_overrides || {});
  const line15 = buildMonthMap<number>(defaultLine15, opts.line15_overrides || {});
  const line16 = buildMonthMap<string>(defaultLine16, opts.line16_overrides || {});

  // If employee terminated mid-year, override remaining months to 2A (not employed)
  if (employee.terminated_date || employee.termination_date) {
    const termDate = employee.terminated_date || employee.termination_date;
    const termMonth = parseInt(termDate.slice(5, 7));
    for (let i = termMonth; i < 12; i++) {
      const m = MONTHS[i];
      if (!opts.line14_overrides?.[m]) line14[m] = '1H';
      if (!opts.line16_overrides?.[m]) line16[m] = '2A';
    }
  }

  const warnings: string[] = [];
  if (!employee.ssn && !employee.tin) {
    warnings.push('Employee SSN missing — required on 1095-C.');
  }
  if (defaultLine14 === '1H' && defaultLine16 === '') {
    warnings.push('Default codes are 1H (no offer) and blank line 16 — verify employee was actually offered no coverage. ALEs must offer MEC to ≥ 95% of FT employees to avoid §4980H(a) penalty.');
  }
  if (opts.is_self_insured && (!opts.covered_individuals || opts.covered_individuals.length === 0)) {
    warnings.push('Self-insured ALE — Part III (covered individuals) is required but no individuals specified. Pass via opts.covered_individuals.');
  }

  return {
    employee_id: opts.employee_id,
    employee_name: employee.name || '',
    employee_ssn: employee.ssn || '',
    employee_address: [employee.address_line1, employee.city, employee.state, employee.zip].filter(Boolean).join(', '),

    employer_name: company.legal_name || company.name || '',
    employer_ein: company.ein || company.tax_id || '',
    employer_address: [company.address_line1, company.city, company.state, company.zip].filter(Boolean).join(', '),

    plan_start_month: opts.plan_start_month || '01',

    line14_codes: line14,
    line15_amounts: line15,
    line16_codes: line16,

    is_self_insured: !!opts.is_self_insured,
    covered_individuals: opts.covered_individuals || [],

    warnings,
  };
}
