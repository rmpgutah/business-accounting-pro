// src/main/services/tax-forms/form-1094c.ts
//
// IRS Form 1094-C — Transmittal of Employer-Provided Health Insurance
// Offer and Coverage Information Returns. The cover sheet that
// accompanies all 1095-C forms an Applicable Large Employer files.
//
// Reports per-month FT-employee counts, total-employee counts, and
// the §4980H Section A vs B safe harbor election.
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-form-1094-c

import * as db from '../../database';

export interface Form1094CData {
  // Part I — Employer
  employer_name: string;
  employer_ein: string;
  employer_address: string;

  // Designated Government Entity (rare)
  has_designated_governmental_entity: boolean;
  dge_name: string;
  dge_ein: string;

  // Number of forms transmitted (Part I line 18)
  total_1095c_count: number;

  // Part II — ALE Member Information
  is_authoritative_transmittal: boolean;     // Box 19
  total_count_1094c_filed_by_ale: number;     // Box 20
  is_aggregated_ale_group_member: boolean;     // Box 21
  qualifying_offer_method: boolean;             // 22A — 1A code applies all year
  reserved_box_22b: boolean;
  section_4980h_transition_relief: boolean;
  is_98_pct_offer_method: boolean;              // 22D — 98%+ offered MEC

  // Part III — ALE Member Information by Month (line 23)
  per_month: {
    all_12: { mec_offer_indicator: boolean; ft_employee_count: number; total_employee_count: number; aggregated_group: boolean; section_4980h_transition: string };
    jan: { mec_offer_indicator: boolean; ft_employee_count: number; total_employee_count: number; aggregated_group: boolean; section_4980h_transition: string };
    feb: { mec_offer_indicator: boolean; ft_employee_count: number; total_employee_count: number; aggregated_group: boolean; section_4980h_transition: string };
    mar: { mec_offer_indicator: boolean; ft_employee_count: number; total_employee_count: number; aggregated_group: boolean; section_4980h_transition: string };
    apr: { mec_offer_indicator: boolean; ft_employee_count: number; total_employee_count: number; aggregated_group: boolean; section_4980h_transition: string };
    may: { mec_offer_indicator: boolean; ft_employee_count: number; total_employee_count: number; aggregated_group: boolean; section_4980h_transition: string };
    jun: { mec_offer_indicator: boolean; ft_employee_count: number; total_employee_count: number; aggregated_group: boolean; section_4980h_transition: string };
    jul: { mec_offer_indicator: boolean; ft_employee_count: number; total_employee_count: number; aggregated_group: boolean; section_4980h_transition: string };
    aug: { mec_offer_indicator: boolean; ft_employee_count: number; total_employee_count: number; aggregated_group: boolean; section_4980h_transition: string };
    sep: { mec_offer_indicator: boolean; ft_employee_count: number; total_employee_count: number; aggregated_group: boolean; section_4980h_transition: string };
    oct: { mec_offer_indicator: boolean; ft_employee_count: number; total_employee_count: number; aggregated_group: boolean; section_4980h_transition: string };
    nov: { mec_offer_indicator: boolean; ft_employee_count: number; total_employee_count: number; aggregated_group: boolean; section_4980h_transition: string };
    dec: { mec_offer_indicator: boolean; ft_employee_count: number; total_employee_count: number; aggregated_group: boolean; section_4980h_transition: string };
  };

  year: number;
  warnings: string[];
}

export interface Form1094COpts {
  is_authoritative?: boolean;
  qualifying_offer_method?: boolean;
  is_98_pct_offer_method?: boolean;
  // Per-month FTE counts (if not provided, autocomputed from active employees)
  ft_count_overrides?: Partial<Record<'jan' | 'feb' | 'mar' | 'apr' | 'may' | 'jun' | 'jul' | 'aug' | 'sep' | 'oct' | 'nov' | 'dec', number>>;
  total_count_overrides?: Partial<Record<'jan' | 'feb' | 'mar' | 'apr' | 'may' | 'jun' | 'jul' | 'aug' | 'sep' | 'oct' | 'nov' | 'dec', number>>;
  // 1095-C count if known (otherwise autocomputed)
  total_1095c_count?: number;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;

export function computeForm1094C(
  companyId: string,
  year: number,
  opts: Form1094COpts = {},
): Form1094CData {
  const dbi = db.getDb();
  const company = db.getById('companies', companyId) as any || {};

  // Count active employees per month (simplified — counts anyone employed on the
  // 1st of the month). FTE math for §4980H is more complex (avg hours over a
  // measurement period); user can override for accurate ALE-status calc.
  const monthlyFT: Record<string, number> = {};
  const monthlyTotal: Record<string, number> = {};

  const pad = (n: number) => n < 10 ? '0' + n : String(n);
  for (let m = 1; m <= 12; m++) {
    const monthStart = `${year}-${pad(m)}-01`;
    try {
      const r = dbi.prepare(`
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN COALESCE(is_full_time, type = 'employee') THEN 1 ELSE 0 END) AS ft
        FROM employees
        WHERE company_id = ?
          AND COALESCE(deleted_at, '') = ''
          AND (hire_date IS NULL OR hire_date <= ?)
          AND (terminated_date IS NULL OR terminated_date = '' OR terminated_date >= ?)
      `).get(companyId, monthStart, monthStart) as any;
      const monthKey = MONTHS[m - 1];
      monthlyFT[monthKey] = Number(r?.ft) || 0;
      monthlyTotal[monthKey] = Number(r?.total) || 0;
    } catch {
      const monthKey = MONTHS[m - 1];
      monthlyFT[monthKey] = 0;
      monthlyTotal[monthKey] = 0;
    }
  }

  type MonthKey = 'jan' | 'feb' | 'mar' | 'apr' | 'may' | 'jun' | 'jul' | 'aug' | 'sep' | 'oct' | 'nov' | 'dec';
  const buildPerMonth = (m: string) => ({
    mec_offer_indicator: false,
    ft_employee_count: (opts.ft_count_overrides?.[m as MonthKey]) ?? monthlyFT[m] ?? 0,
    total_employee_count: (opts.total_count_overrides?.[m as MonthKey]) ?? monthlyTotal[m] ?? 0,
    aggregated_group: false,
    section_4980h_transition: '',
  });

  const totalFT = Object.values(monthlyFT).reduce((s, v) => s + v, 0);
  const avgFT = Math.round(totalFT / 12);
  const isALE = avgFT >= 50;

  const totalAll12: any = {
    mec_offer_indicator: false,
    ft_employee_count: avgFT,
    total_employee_count: Math.round(Object.values(monthlyTotal).reduce((s, v) => s + v, 0) / 12),
    aggregated_group: false,
    section_4980h_transition: '',
  };

  const warnings: string[] = [];
  if (!isALE) {
    warnings.push('Average FT employee count (' + avgFT + ') is below 50 — your business may NOT be an Applicable Large Employer (ALE) and may not need to file 1094-C / 1095-C. Use 1094-B / 1095-B for self-insured non-ALE coverage.');
  }
  if (avgFT >= 50 && avgFT < 100) {
    warnings.push('Mid-size ALE (50-99 FT employees) — verify §4980H transition relief eligibility (line 22C).');
  }
  if (!company.ein && !company.tax_id) {
    warnings.push('Employer EIN missing — required on Form 1094-C.');
  }

  return {
    employer_name: company.legal_name || company.name || '',
    employer_ein: company.ein || company.tax_id || '',
    employer_address: [company.address_line1, company.city, company.state, company.zip].filter(Boolean).join(', '),

    has_designated_governmental_entity: false,
    dge_name: '',
    dge_ein: '',

    total_1095c_count: opts.total_1095c_count ?? avgFT,

    is_authoritative_transmittal: opts.is_authoritative ?? true,
    total_count_1094c_filed_by_ale: 1,
    is_aggregated_ale_group_member: false,
    qualifying_offer_method: !!opts.qualifying_offer_method,
    reserved_box_22b: false,
    section_4980h_transition_relief: false,
    is_98_pct_offer_method: !!opts.is_98_pct_offer_method,

    per_month: {
      all_12: totalAll12,
      jan: buildPerMonth('jan') as any,
      feb: buildPerMonth('feb') as any,
      mar: buildPerMonth('mar') as any,
      apr: buildPerMonth('apr') as any,
      may: buildPerMonth('may') as any,
      jun: buildPerMonth('jun') as any,
      jul: buildPerMonth('jul') as any,
      aug: buildPerMonth('aug') as any,
      sep: buildPerMonth('sep') as any,
      oct: buildPerMonth('oct') as any,
      nov: buildPerMonth('nov') as any,
      dec: buildPerMonth('dec') as any,
    },

    year,
    warnings,
  };
}
