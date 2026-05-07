// src/main/services/tax-forms/form-1099-k.ts
//
// IRS Form 1099-K — Payment Card and Third Party Network Transactions.
//
// Filed by payment-card processors and third-party-network platforms
// (Stripe, Square, PayPal, Venmo for business). Threshold for 2025-26
// is $5,000 (was $20K + 200 tx pre-2024, $600 for one year that was
// reverted). Most small accounting users RECEIVE 1099-Ks from their
// processor — they don't ISSUE them.
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-form-1099-k

import {
  PayerIdentity, RecipientIdentity, FilingFlags,
  buildPayerIdentity, buildRecipientIdentity,
  sortReadyFirst, buildIdentityWarnings, loadEligibleClients,
} from './form-1099-shared';
import * as db from '../../database';

export interface Form1099KData extends PayerIdentity, RecipientIdentity, FilingFlags {
  year: number;
  box1a_gross_amount: number;            // Total payment-card / TPN transactions
  box1b_card_not_present: number;        // Subset of 1a — online/phone/keyed
  box2_merchant_category_code: string;
  box3_number_of_transactions: number;
  box4_fed_tax_withheld: number;         // Backup withholding
  box5a_jan: number;
  box5b_feb: number;
  box5c_mar: number;
  box5d_apr: number;
  box5e_may: number;
  box5f_jun: number;
  box5g_jul: number;
  box5h_aug: number;
  box5i_sep: number;
  box5j_oct: number;
  box5k_nov: number;
  box5l_dec: number;
  box6_state: string;
  box7_state_id: string;
  box8_state_tax_withheld: number;
  total_paid: number;
}

const FILING_THRESHOLD_2025 = 5000;

export function compute1099Ks(companyId: string, year: number): Form1099KData[] {
  const company = db.getById('companies', companyId) as any || {};
  const recipients = loadEligibleClients(companyId);
  const forms: Form1099KData[] = [];

  for (const r of recipients) {
    const payer = buildPayerIdentity(company);
    const recipient = buildRecipientIdentity(r);
    const warnings = buildIdentityWarnings(recipient, '1099-K');
    warnings.push('No card / third-party-network payment data found. ' +
      'If you operate as a TPSO/processor, enter Box 1a + monthly breakdown manually.');

    forms.push({
      ...payer, ...recipient, year,
      box1a_gross_amount: 0,
      box1b_card_not_present: 0,
      box2_merchant_category_code: '',
      box3_number_of_transactions: 0,
      box4_fed_tax_withheld: 0,
      box5a_jan: 0, box5b_feb: 0, box5c_mar: 0, box5d_apr: 0,
      box5e_may: 0, box5f_jun: 0, box5g_jul: 0, box5h_aug: 0,
      box5i_sep: 0, box5j_oct: 0, box5k_nov: 0, box5l_dec: 0,
      box6_state: company.state || '',
      box7_state_id: company.state_id || '',
      box8_state_tax_withheld: 0,
      total_paid: 0,
      meets_filing_threshold: false,
      has_tin: !!recipient.recipient_tin,
      warnings,
    });
  }

  // Threshold reference for the UI
  void FILING_THRESHOLD_2025;
  return sortReadyFirst(forms, 'total_paid');
}
