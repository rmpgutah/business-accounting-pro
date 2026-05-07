// src/main/services/tax-forms/schedule-b.ts
//
// IRS 1040 Schedule B — Interest and Ordinary Dividends.
//
// Filed when total interest > $1,500 OR total dividends > $1,500.
// Part I lists payers + amounts of interest received. Part II lists
// dividend payers + amounts. Part III asks about foreign accounts.
//
// For accounting users (sole props):
//   • Interest from business savings accounts isn't on Schedule B
//     (that's reported as Other income on Schedule C). Schedule B
//     covers personal investment interest.
//   • If user received a 1099-INT for the business, the business
//     reports the interest as Other income on Sch C, not Sch B.
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-schedule-b-form-1040

import * as db from '../../database';

export interface ScheduleBPayer {
  name: string;
  amount: number;
}

export interface ScheduleBData {
  taxpayer_name: string;
  ssn: string;
  year: number;

  // Part I — Interest
  line1_interest_payers: ScheduleBPayer[];
  line2_total_interest: number;            // Sum
  line3_excluded_interest: number;          // Series EE/I bonds
  line4_taxable_interest: number;            // Line 2 - Line 3

  // Part II — Ordinary Dividends
  line5_dividend_payers: ScheduleBPayer[];
  line6_total_dividends: number;             // Sum

  // Part III — Foreign Accounts and Trusts
  line7a_foreign_account_yes: boolean;       // Required if > $10K aggregate
  line7a_country: string;
  line7b_required_to_file_fbar: boolean;
  line8_foreign_trust: boolean;

  warnings: string[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const FILING_THRESHOLD = 1500;

export function computeScheduleB(
  companyId: string,
  year: number,
  opts?: {
    interest_payers?: ScheduleBPayer[];
    dividend_payers?: ScheduleBPayer[];
    foreign_account?: boolean;
    foreign_country?: string;
  },
): ScheduleBData {
  const company = db.getById('companies', companyId) as any || {};
  void year;

  const interestPayers = (opts?.interest_payers || []).map((p) => ({ name: p.name, amount: round2(p.amount) }));
  const dividendPayers = (opts?.dividend_payers || []).map((p) => ({ name: p.name, amount: round2(p.amount) }));
  const totalInterest = round2(interestPayers.reduce((s, p) => s + p.amount, 0));
  const totalDividends = round2(dividendPayers.reduce((s, p) => s + p.amount, 0));

  const warnings: string[] = [];
  if (totalInterest <= FILING_THRESHOLD && totalDividends <= FILING_THRESHOLD && !opts?.foreign_account) {
    warnings.push('Both interest (' + totalInterest + ') and dividends (' + totalDividends + ') are below $1,500 — Schedule B is OPTIONAL unless you have foreign accounts.');
  }
  if (interestPayers.length === 0 && dividendPayers.length === 0) {
    warnings.push('No interest or dividend payers entered. Pass via opts.interest_payers / opts.dividend_payers (each = {name, amount}).');
  }
  if (opts?.foreign_account) {
    warnings.push('Foreign account flagged — answer line 7a YES. If aggregate value at any point > $10K, also file FinCEN Form 114 (FBAR).');
  }

  return {
    taxpayer_name: company.legal_name || company.name || '',
    ssn: '',
    year,
    line1_interest_payers: interestPayers,
    line2_total_interest: totalInterest,
    line3_excluded_interest: 0,
    line4_taxable_interest: totalInterest,
    line5_dividend_payers: dividendPayers,
    line6_total_dividends: totalDividends,
    line7a_foreign_account_yes: !!opts?.foreign_account,
    line7a_country: opts?.foreign_country || '',
    line7b_required_to_file_fbar: false,
    line8_foreign_trust: false,
    warnings,
  };
}
