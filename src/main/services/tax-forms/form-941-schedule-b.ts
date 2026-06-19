// src/main/services/tax-forms/form-941-schedule-b.ts
//
// IRS Form 941 Schedule B — Report of Tax Liability for Semiweekly
// Schedule Depositors.
//
// Required for employers who:
//   • Reported $50,000+ in payroll taxes during the lookback period, OR
//   • Accumulated $100,000+ in tax liability on any single day (which
//     forces semiweekly status mid-year)
//
// The form is a per-quarter grid of 3 months × ~31 days = ~93 cells,
// each holding the federal tax liability incurred on that day. Every
// pay date the employer's liability for that day is the federal income
// tax withheld + employer & employee SS + employer & employee Medicare
// from all checks issued that day.
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-schedule-b-form-941
//   • IRS Pub 15 (Circular E)

import * as db from '../../database';

export interface DailyLiability {
  day: number;                // 1-31
  amount: number;
}

export interface Schedule941BData {
  ein: string;
  business_name: string;
  year: number;
  quarter: 1 | 2 | 3 | 4;

  // Three months in the quarter, each as an array of {day, amount} for
  // days the employer had liability. Days with $0 liability are omitted
  // from the array but the month_total reflects the full picture.
  month1_name: string;        // e.g., "January"
  month1_liability: DailyLiability[];
  month1_total: number;

  month2_name: string;
  month2_liability: DailyLiability[];
  month2_total: number;

  month3_name: string;
  month3_liability: DailyLiability[];
  month3_total: number;

  total_quarter_liability: number; // Must equal Form 941 line 12

  // Computation metadata
  pay_dates_count: number;
  warnings: string[];
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function quarterMonths(q: 1 | 2 | 3 | 4): [number, number, number] {
  const start = (q - 1) * 3 + 1;
  return [start, start + 1, start + 2];
}

interface PayStubRow {
  pay_date: string;
  federal_tax: number;
  social_security: number;
  medicare: number;
}

export function computeSchedule941B(
  companyId: string,
  year: number,
  quarter: 1 | 2 | 3 | 4,
): Schedule941BData {
  const dbi = db.getDb();
  const company = db.getById('companies', companyId) as any || {};

  const months = quarterMonths(quarter);
  const pad = (n: number) => n < 10 ? '0' + n : String(n);
  const qStart = year + '-' + pad(months[0]) + '-01';
  const qEndDay = new Date(year, months[2], 0).getDate();
  const qEnd = year + '-' + pad(months[2]) + '-' + pad(qEndDay);

  // Pull pay stubs for the quarter; each pay_date contributes to the
  // daily liability on that exact date.
  const stubs = dbi.prepare(`
    SELECT r.pay_date AS pay_date,
           COALESCE(s.federal_tax, 0) AS federal_tax,
           COALESCE(s.social_security, 0) AS social_security,
           COALESCE(s.medicare, 0) AS medicare
    FROM pay_stubs s
    JOIN payroll_runs r ON r.id = s.payroll_run_id
    WHERE r.company_id = ?
      AND r.pay_date BETWEEN ? AND ?
      AND COALESCE(r.deleted_at, '') = ''
  `).all(companyId, qStart, qEnd) as PayStubRow[];

  // Aggregate liability per pay_date — per IRS, employer matches SS+Medicare,
  // so per-day liability = fed_tax + 2×SS + 2×Medicare.
  const byDate = new Map<string, number>();
  for (const s of stubs) {
    const fed = Number(s.federal_tax) || 0;
    const ss = (Number(s.social_security) || 0) * 2;
    const med = (Number(s.medicare) || 0) * 2;
    const liab = fed + ss + med;
    byDate.set(s.pay_date, (byDate.get(s.pay_date) || 0) + liab);
  }

  // Bucket by month within the quarter
  const buckets: { [m: number]: DailyLiability[] } = { [months[0]]: [], [months[1]]: [], [months[2]]: [] };
  for (const [date, amount] of byDate) {
    const m = parseInt(date.slice(5, 7));
    const d = parseInt(date.slice(8, 10));
    if (buckets[m]) {
      buckets[m].push({ day: d, amount: round2(amount) });
    }
  }
  // Sort each month's days
  for (const m of months) {
    buckets[m].sort((a, b) => a.day - b.day);
  }
  const monthTotal = (m: number) => round2(buckets[m].reduce((s, x) => s + x.amount, 0));

  const m1Total = monthTotal(months[0]);
  const m2Total = monthTotal(months[1]);
  const m3Total = monthTotal(months[2]);
  const total = round2(m1Total + m2Total + m3Total);

  const warnings: string[] = [];
  if (stubs.length === 0) {
    warnings.push('No pay dates found in Q' + quarter + ' ' + year + '. Schedule B is empty — verify Form 941 line 12 is $0.');
  }
  if (!company.ein && !company.tax_id) {
    warnings.push('Employer EIN missing — required on Schedule B.');
  }

  return {
    ein: company.ein || company.tax_id || '',
    business_name: company.legal_name || company.name || '',
    year,
    quarter,
    month1_name: MONTH_NAMES[months[0] - 1],
    month1_liability: buckets[months[0]],
    month1_total: m1Total,
    month2_name: MONTH_NAMES[months[1] - 1],
    month2_liability: buckets[months[1]],
    month2_total: m2Total,
    month3_name: MONTH_NAMES[months[2] - 1],
    month3_liability: buckets[months[2]],
    month3_total: m3Total,
    total_quarter_liability: total,
    pay_dates_count: byDate.size,
    warnings,
  };
}
