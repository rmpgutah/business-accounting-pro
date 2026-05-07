// src/main/services/tax-forms/form-1099-r.ts
//
// IRS Form 1099-R — Distributions From Pensions, Annuities, Retirement
// or Profit-Sharing Plans, IRAs, Insurance Contracts, etc.
//
// Filed by retirement plan administrators. Most accounting users are
// not plan administrators — but if you operate a Solo 401(k) and take
// a distribution, you (technically the plan custodian) issue 1099-R
// to yourself. We provide manual-entry stubs for that case.
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-form-1099-r

import {
  PayerIdentity, RecipientIdentity, FilingFlags,
  buildPayerIdentity, buildRecipientIdentity,
  sortReadyFirst, buildIdentityWarnings, loadEligibleClients,
} from './form-1099-shared';
import * as db from '../../database';

export interface Form1099RData extends PayerIdentity, RecipientIdentity, FilingFlags {
  year: number;
  box1_gross_distribution: number;
  box2a_taxable_amount: number;
  box2b_taxable_amount_not_determined: boolean;
  box2b_total_distribution: boolean;
  box3_capital_gain: number;
  box4_fed_tax_withheld: number;
  box5_employee_contributions: number;     // After-tax basis
  box6_net_unrealized_appreciation: number;
  box7_distribution_code: string;            // 1=early, 2=early w/ exception, 7=normal, etc.
  box7_ira_sep_simple: boolean;
  box8_other: number;
  box8_other_pct: number;
  box9a_total_pct: number;
  box9b_total_employee_contributions: number;
  box10_amount_allocable_to_irr: number;
  box11_first_year_designated_roth: number;
  box12_fatca_filing: boolean;
  box13_date_payment: string;
  box14_state_tax_withheld: number;
  box15_state: string;
  box16_state_distribution: number;
  box17_local_tax_withheld: number;
  box18_name_locality: string;
  box19_local_distribution: number;
  total_paid: number;
}

export function compute1099Rs(companyId: string, year: number): Form1099RData[] {
  const company = db.getById('companies', companyId) as any || {};
  const recipients = loadEligibleClients(companyId);
  const forms: Form1099RData[] = [];

  for (const r of recipients) {
    const payer = buildPayerIdentity(company);
    const recipient = buildRecipientIdentity(r);
    const warnings = buildIdentityWarnings(recipient, '1099-R');
    warnings.push('No retirement-distribution data found — enter Box 1 (gross), Box 2a (taxable), Box 7 (distribution code) manually before printing.');

    forms.push({
      ...payer, ...recipient, year,
      box1_gross_distribution: 0,
      box2a_taxable_amount: 0,
      box2b_taxable_amount_not_determined: false,
      box2b_total_distribution: false,
      box3_capital_gain: 0,
      box4_fed_tax_withheld: 0,
      box5_employee_contributions: 0,
      box6_net_unrealized_appreciation: 0,
      box7_distribution_code: '7',  // 7 = Normal distribution (default)
      box7_ira_sep_simple: false,
      box8_other: 0,
      box8_other_pct: 0,
      box9a_total_pct: 100,
      box9b_total_employee_contributions: 0,
      box10_amount_allocable_to_irr: 0,
      box11_first_year_designated_roth: 0,
      box12_fatca_filing: false,
      box13_date_payment: '',
      box14_state_tax_withheld: 0,
      box15_state: company.state || '',
      box16_state_distribution: 0,
      box17_local_tax_withheld: 0,
      box18_name_locality: '',
      box19_local_distribution: 0,
      total_paid: 0,
      meets_filing_threshold: false,
      has_tin: !!recipient.recipient_tin,
      warnings,
    });
  }

  return sortReadyFirst(forms, 'total_paid');
}
