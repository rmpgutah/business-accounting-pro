// src/main/services/tax-forms/form-945.ts
//
// IRS Form 945 — Annual Return of Withheld Federal Income Tax.
//
// Filed for federal income tax withheld from NON-payroll sources:
//   • Pensions, annuities, IRA distributions
//   • Gambling winnings (W-2G)
//   • Backup withholding (24% on payments to vendors without TIN)
//
// This is the form 1099 issuers use to remit federal taxes they
// withheld from contractor payments when the contractor failed to
// provide a valid W-9. (Same backup-withholding number that ends
// up in Box 4 of 1099-NEC / 1099-MISC.)
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-form-945
//   • Form 945 (2025) — line numbers verified from official PDF
//
// What this DOES:
//   • Aggregates Box 4 (backup withholding) from all 1099 forms
//     for the year to produce line 2
//   • Provides a stub for line 1 (pensions/IRAs/gambling) — most
//     small-business filers don't have these; the user can override
//     via opts.line1_override
//   • Computes monthly liability schedule (line 7a-7l) from the
//     dates of bill_payments / expenses where backup withholding
//     was applied

import * as db from '../../database';

export interface Form945Data {
  // Filing identity
  ein: string;
  business_name: string;
  trade_name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  year: number;

  // Line A — final return flag
  is_final_return: boolean;
  final_payment_date: string;            // YYYY-MM-DD if final

  // Lines 1-3
  line1_fed_withheld: number;            // Pensions / annuities / IRAs / gambling
  line2_backup_withholding: number;      // 24% on no-TIN vendor payments
  line3_total_taxes: number;             // 1 + 2

  line4_total_deposits: number;          // What was deposited
  line5_balance_due: number;             // 3 - 4 if positive
  line6a_overpayment: number;            // 4 - 3 if positive

  // Part 2 / Line 7 — monthly schedule (only if line 3 ≥ $2,500)
  line7_monthly_required: boolean;
  line7a_jan: number;
  line7b_feb: number;
  line7c_mar: number;
  line7d_apr: number;
  line7e_may: number;
  line7f_jun: number;
  line7g_jul: number;
  line7h_aug: number;
  line7i_sep: number;
  line7j_oct: number;
  line7k_nov: number;
  line7l_dec: number;
  line7m_total: number;                  // Must equal line 3

  // Filing-method flag
  is_semiweekly_depositor: boolean;      // If true, file Form 945-A instead of line 7

  // Computation metadata
  source_count: number;                  // # of 1099-with-backup-withholding rows considered
  warnings: string[];
}

export interface Form945Opts {
  line1_override?: number;               // Manual entry for non-1099 withholding
  line4_override?: number;               // Manual deposits total
  is_final_return?: boolean;
  final_payment_date?: string;
  is_semiweekly_depositor?: boolean;
}

const SCHEDULE_THRESHOLD = 2500;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeForm945(
  companyId: string,
  year: number,
  opts: Form945Opts = {},
): Form945Data {
  const dbi = db.getDb();
  const company = db.getById('companies', companyId) as any || {};
  const yearStart = year + '-01-01';
  const yearEnd = year + '-12-31';

  // Pull bill_payments + expenses where federal_withholding > 0 (backup w/h)
  // We use the same source as 1099-NEC/1099-MISC Box 4 derivation.
  // Schema: many tenants don't have a backup_withholding column yet; we fall
  // back to zero and rely on user override.
  let backupRows: Array<{ date: string; amount: number }> = [];
  try {
    backupRows = dbi.prepare(`
      SELECT bp.date AS date, COALESCE(bp.backup_withholding, 0) AS amount
      FROM bill_payments bp
      JOIN bills b ON b.id = bp.bill_id
      WHERE b.company_id = ?
        AND bp.date BETWEEN ? AND ?
        AND COALESCE(bp.backup_withholding, 0) > 0
    `).all(companyId, yearStart, yearEnd) as Array<{ date: string; amount: number }>;
  } catch {
    // backup_withholding column not present — schema migration deferred
  }
  let expenseBackup: Array<{ date: string; amount: number }> = [];
  try {
    expenseBackup = dbi.prepare(`
      SELECT date, COALESCE(backup_withholding, 0) AS amount
      FROM expenses
      WHERE company_id = ?
        AND date BETWEEN ? AND ?
        AND COALESCE(deleted_at, '') = ''
        AND COALESCE(backup_withholding, 0) > 0
    `).all(companyId, yearStart, yearEnd) as Array<{ date: string; amount: number }>;
  } catch {
    // backup_withholding column not present
  }

  const allRows = [...backupRows, ...expenseBackup];
  const line2 = round2(allRows.reduce((s, r) => s + (Number(r.amount) || 0), 0));

  const line1 = round2(opts.line1_override || 0);
  const line3 = round2(line1 + line2);
  const line4 = round2(opts.line4_override || 0);
  const line5 = Math.max(0, round2(line3 - line4));
  const line6a = Math.max(0, round2(line4 - line3));

  // Monthly schedule from row dates
  const monthly = Array.from({ length: 12 }, () => 0);
  for (const r of allRows) {
    const m = parseInt((r.date || '').slice(5, 7));
    if (m >= 1 && m <= 12) monthly[m - 1] += Number(r.amount) || 0;
  }
  const monthlyRounded = monthly.map(round2);
  // If line1 has a value, distribute evenly across months as a starting point
  // (user can edit per month before filing)
  if (line1 > 0) {
    const perMonth = round2(line1 / 12);
    for (let i = 0; i < 12; i++) monthlyRounded[i] = round2(monthlyRounded[i] + perMonth);
  }
  const line7m = round2(monthlyRounded.reduce((s, v) => s + v, 0));

  const warnings: string[] = [];
  if (line3 === 0) {
    warnings.push('No backup withholding found and no override entered. File Form 945 only if you withheld tax from non-payroll payments. If none, you do not need to file.');
  }
  if (line3 >= SCHEDULE_THRESHOLD && Math.abs(line7m - line3) > 1) {
    warnings.push('Monthly schedule total ($' + line7m.toFixed(2) + ') does not match line 3 ($' + line3.toFixed(2) + '). The IRS rejects 945s where these disagree.');
  }
  if (opts.is_semiweekly_depositor && line3 >= SCHEDULE_THRESHOLD) {
    warnings.push('Semiweekly depositors must attach Form 945-A (per-day liability) instead of line 7 monthly schedule.');
  }
  if (!company.ein && !company.tax_id) {
    warnings.push('Employer EIN missing — required on Form 945.');
  }

  return {
    ein: company.ein || company.tax_id || '',
    business_name: company.legal_name || company.name || '',
    trade_name: company.name || '',
    address: company.address_line1 || '',
    city: company.city || '',
    state: company.state || '',
    zip: company.zip || '',
    year,

    is_final_return: !!opts.is_final_return,
    final_payment_date: opts.final_payment_date || '',

    line1_fed_withheld: line1,
    line2_backup_withholding: line2,
    line3_total_taxes: line3,

    line4_total_deposits: line4,
    line5_balance_due: line5,
    line6a_overpayment: line6a,

    line7_monthly_required: line3 >= SCHEDULE_THRESHOLD && !opts.is_semiweekly_depositor,
    line7a_jan: monthlyRounded[0],
    line7b_feb: monthlyRounded[1],
    line7c_mar: monthlyRounded[2],
    line7d_apr: monthlyRounded[3],
    line7e_may: monthlyRounded[4],
    line7f_jun: monthlyRounded[5],
    line7g_jul: monthlyRounded[6],
    line7h_aug: monthlyRounded[7],
    line7i_sep: monthlyRounded[8],
    line7j_oct: monthlyRounded[9],
    line7k_nov: monthlyRounded[10],
    line7l_dec: monthlyRounded[11],
    line7m_total: line7m,

    is_semiweekly_depositor: !!opts.is_semiweekly_depositor,

    source_count: allRows.length,
    warnings,
  };
}
