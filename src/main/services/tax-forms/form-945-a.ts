// src/main/services/tax-forms/form-945-a.ts
//
// IRS Form 945-A — Annual Record of Federal Tax Liability.
//
// The semiweekly-depositor companion to Form 945 (and also used by
// 944 and 941 filers who become semiweekly mid-year by accumulating
// $100,000+ on any single day).
//
// Like 941 Schedule B but covers the FULL YEAR instead of one quarter:
// 12 months × ~31 days = ~365 daily liability cells.
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-form-945-a
//   • IRS Pub 15

import * as db from '../../database';

export interface DailyLiability {
  day: number;        // 1-31
  amount: number;
}

export interface Form945AData {
  ein: string;
  business_name: string;
  year: number;

  // Source: 'form-944' | 'form-945' | 'form-941' (which form 945-A is attached to)
  parent_form: 'form-944' | 'form-945' | 'form-941';

  months: Array<{
    month_number: number;        // 1-12
    month_name: string;
    daily: DailyLiability[];     // Days with > $0 liability
    month_total: number;
  }>;

  total_year_liability: number;  // Must equal parent form's total

  // Computation metadata
  liability_dates_count: number;
  warnings: string[];
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface PayStubRow {
  pay_date: string;
  federal_tax: number;
  social_security: number;
  medicare: number;
}

export function computeForm945A(
  companyId: string,
  year: number,
  parentForm: 'form-944' | 'form-945' | 'form-941' = 'form-945',
): Form945AData {
  const dbi = db.getDb();
  const company = db.getById('companies', companyId) as any || {};
  const yearStart = year + '-01-01';
  const yearEnd = year + '-12-31';

  // Aggregate by date — sources differ by parent form:
  //   • 944 / 941: payroll federal+SS+Medicare per pay_date
  //   • 945: backup withholding per payment date
  const byDate = new Map<string, number>();

  if (parentForm === 'form-944' || parentForm === 'form-941') {
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
    `).all(companyId, yearStart, yearEnd) as PayStubRow[];

    for (const s of stubs) {
      const fed = Number(s.federal_tax) || 0;
      const ss = (Number(s.social_security) || 0) * 2;   // ER+EE
      const med = (Number(s.medicare) || 0) * 2;
      byDate.set(s.pay_date, (byDate.get(s.pay_date) || 0) + fed + ss + med);
    }
  } else if (parentForm === 'form-945') {
    // Backup withholding — same source as form-945 line 2
    try {
      const billPays = dbi.prepare(`
        SELECT bp.date AS date, COALESCE(bp.backup_withholding, 0) AS amount
        FROM bill_payments bp
        JOIN bills b ON b.id = bp.bill_id
        WHERE b.company_id = ?
          AND bp.date BETWEEN ? AND ?
          AND COALESCE(bp.backup_withholding, 0) > 0
      `).all(companyId, yearStart, yearEnd) as Array<{ date: string; amount: number }>;
      for (const r of billPays) {
        byDate.set(r.date, (byDate.get(r.date) || 0) + (Number(r.amount) || 0));
      }
    } catch { /* schema migration deferred */ }
    try {
      const expensePays = dbi.prepare(`
        SELECT date, COALESCE(backup_withholding, 0) AS amount
        FROM expenses
        WHERE company_id = ?
          AND date BETWEEN ? AND ?
          AND COALESCE(deleted_at, '') = ''
          AND COALESCE(backup_withholding, 0) > 0
      `).all(companyId, yearStart, yearEnd) as Array<{ date: string; amount: number }>;
      for (const r of expensePays) {
        byDate.set(r.date, (byDate.get(r.date) || 0) + (Number(r.amount) || 0));
      }
    } catch { /* schema migration deferred */ }
  }

  // Bucket by month
  const monthBuckets: Array<DailyLiability[]> = Array.from({ length: 12 }, () => []);
  for (const [date, amount] of byDate) {
    const m = parseInt(date.slice(5, 7));
    const d = parseInt(date.slice(8, 10));
    if (m >= 1 && m <= 12) {
      monthBuckets[m - 1].push({ day: d, amount: round2(amount) });
    }
  }
  for (const bucket of monthBuckets) {
    bucket.sort((a, b) => a.day - b.day);
  }

  const months = monthBuckets.map((daily, i) => ({
    month_number: i + 1,
    month_name: MONTH_NAMES[i],
    daily,
    month_total: round2(daily.reduce((s, x) => s + x.amount, 0)),
  }));

  const total = round2(months.reduce((s, m) => s + m.month_total, 0));

  const warnings: string[] = [];
  if (byDate.size === 0) {
    warnings.push('No tax liability dates found in ' + year + '. Verify the parent form (' + parentForm.toUpperCase() + ') has a non-zero balance, or skip Form 945-A.');
  }
  if (!company.ein && !company.tax_id) {
    warnings.push('Employer EIN missing — required on Form 945-A.');
  }

  return {
    ein: company.ein || company.tax_id || '',
    business_name: company.legal_name || company.name || '',
    year,
    parent_form: parentForm,
    months,
    total_year_liability: total,
    liability_dates_count: byDate.size,
    warnings,
  };
}
