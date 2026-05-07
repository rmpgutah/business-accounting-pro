// src/main/services/tax-forms/form-1099-div.ts
//
// IRS Form 1099-DIV — Dividends and Distributions.
//
// Filed by C-corps that paid $10+ of dividends to shareholders.
// Most small accounting users are pass-through entities (S-corps,
// partnerships, sole props) and never issue 1099-DIVs. C-corps
// that paid dividends do — typically via the equity ledger.
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-form-1099-div

import {
  PayerIdentity, RecipientIdentity, FilingFlags,
  round2, buildPayerIdentity, buildRecipientIdentity,
  sortReadyFirst, buildIdentityWarnings, loadEligibleClients,
} from './form-1099-shared';
import * as db from '../../database';

export interface Form1099DIVData extends PayerIdentity, RecipientIdentity, FilingFlags {
  year: number;
  box1a_total_ordinary_dividends: number;
  box1b_qualified_dividends: number;
  box2a_total_capital_gain_distr: number;
  box2b_unrecaptured_section_1250: number;
  box2c_section_1202_gain: number;
  box2d_collectibles_28pct_gain: number;
  box2e_section_897_ordinary: number;
  box2f_section_897_capital: number;
  box3_nondividend_distributions: number;
  box4_fed_tax_withheld: number;
  box5_section_199a_dividends: number;
  box6_investment_expenses: number;
  box7_foreign_tax_paid: number;
  box8_foreign_country: string;
  box9_cash_liquidation_distr: number;
  box10_noncash_liquidation_distr: number;
  box11_fatca_filing: boolean;
  box12_exempt_interest_dividends: number;
  box13_specified_pab_dividends: number;
  box14_state: string;
  box15_state_id: string;
  box16_state_tax_withheld: number;
  total_paid: number;
}

const FILING_THRESHOLD = 10;

export function compute1099DIVs(companyId: string, year: number): Form1099DIVData[] {
  const company = db.getById('companies', companyId) as any || {};
  // Most users won't have data here — return shells for any flagged
  // shareholders/clients with manual-entry zeros so the user can fill
  // and export.
  const recipients = loadEligibleClients(companyId);
  const forms: Form1099DIVData[] = [];

  for (const r of recipients) {
    const payer = buildPayerIdentity(company);
    const recipient = buildRecipientIdentity(r);
    const warnings = buildIdentityWarnings(recipient, '1099-DIV');
    warnings.push('No dividend payment data found — enter Box 1a and other applicable boxes manually before printing.');

    forms.push({
      ...payer, ...recipient, year,
      box1a_total_ordinary_dividends: 0,
      box1b_qualified_dividends: 0,
      box2a_total_capital_gain_distr: 0,
      box2b_unrecaptured_section_1250: 0,
      box2c_section_1202_gain: 0,
      box2d_collectibles_28pct_gain: 0,
      box2e_section_897_ordinary: 0,
      box2f_section_897_capital: 0,
      box3_nondividend_distributions: 0,
      box4_fed_tax_withheld: 0,
      box5_section_199a_dividends: 0,
      box6_investment_expenses: 0,
      box7_foreign_tax_paid: 0,
      box8_foreign_country: '',
      box9_cash_liquidation_distr: 0,
      box10_noncash_liquidation_distr: 0,
      box11_fatca_filing: false,
      box12_exempt_interest_dividends: 0,
      box13_specified_pab_dividends: 0,
      box14_state: company.state || '',
      box15_state_id: company.state_id || '',
      box16_state_tax_withheld: 0,
      total_paid: 0,
      meets_filing_threshold: false,
      has_tin: !!recipient.recipient_tin,
      warnings,
    });
  }

  return sortReadyFirst(forms, 'total_paid');
}
