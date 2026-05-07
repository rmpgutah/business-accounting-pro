// src/main/services/tax-forms/form-1099-other.ts
//
// Less-common 1099 variants combined into one file:
//   • 1099-B  — Proceeds from broker / barter exchange transactions
//   • 1099-G  — Certain Government Payments (refunds, unemployment)
//   • 1099-C  — Cancellation of Debt
//   • 1099-SA — Distributions From an HSA / Archer MSA / MA MSA
//
// These are filed by specialized issuers (brokers, government
// agencies, lenders, HSA trustees). Most accounting users never
// issue any of these. We provide manual-entry shells so users
// in the rare-issuer category can prepare and print them.
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-form-1099-b
//   • https://www.irs.gov/forms-pubs/about-form-1099-g
//   • https://www.irs.gov/forms-pubs/about-form-1099-c
//   • https://www.irs.gov/forms-pubs/about-form-1099-sa

import {
  PayerIdentity, RecipientIdentity, FilingFlags,
  buildPayerIdentity, buildRecipientIdentity,
  sortReadyFirst, buildIdentityWarnings, loadEligibleClients,
} from './form-1099-shared';
import * as db from '../../database';

// ── 1099-B (broker proceeds) ────────────────────────────────

export interface Form1099BData extends PayerIdentity, RecipientIdentity, FilingFlags {
  year: number;
  box1a_description: string;             // e.g., "100 sh AAPL"
  box1b_date_acquired: string;
  box1c_date_sold: string;
  box1d_proceeds: number;
  box1e_cost_basis: number;
  box1f_accrued_market_discount: number;
  box1g_wash_sale_loss: number;
  box2_short_long_term: 'short' | 'long' | '';
  box3_proceeds_collectibles: boolean;
  box3_proceeds_qof: boolean;
  box4_fed_tax_withheld: number;
  box5_noncovered_security: boolean;
  box6_gross_or_net: 'gross' | 'net' | '';
  box7_loss_not_allowed: boolean;
  box8_profit_or_loss_realized: number;
  box9_unrealized_profit_loss_open: number;
  box10_unrealized_profit_loss_close: number;
  box11_aggregate_profit_loss: number;
  box12_basis_reported_to_irs: boolean;
  box13_bartering: number;
  box14_state: string;
  box15_state_id: string;
  box16_state_tax_withheld: number;
  total_paid: number;
}

export function compute1099Bs(companyId: string, year: number): Form1099BData[] {
  const company = db.getById('companies', companyId) as any || {};
  const recipients = loadEligibleClients(companyId);
  const forms: Form1099BData[] = [];
  for (const r of recipients) {
    const payer = buildPayerIdentity(company);
    const recipient = buildRecipientIdentity(r);
    const warnings = buildIdentityWarnings(recipient, '1099-B');
    warnings.push('1099-B is filed by brokers/barter exchanges. Enter security description, dates, proceeds, basis manually.');
    forms.push({
      ...payer, ...recipient, year,
      box1a_description: '', box1b_date_acquired: '', box1c_date_sold: '',
      box1d_proceeds: 0, box1e_cost_basis: 0, box1f_accrued_market_discount: 0,
      box1g_wash_sale_loss: 0, box2_short_long_term: '',
      box3_proceeds_collectibles: false, box3_proceeds_qof: false,
      box4_fed_tax_withheld: 0, box5_noncovered_security: false,
      box6_gross_or_net: '', box7_loss_not_allowed: false,
      box8_profit_or_loss_realized: 0, box9_unrealized_profit_loss_open: 0,
      box10_unrealized_profit_loss_close: 0, box11_aggregate_profit_loss: 0,
      box12_basis_reported_to_irs: false, box13_bartering: 0,
      box14_state: company.state || '', box15_state_id: company.state_id || '',
      box16_state_tax_withheld: 0, total_paid: 0,
      meets_filing_threshold: false, has_tin: !!recipient.recipient_tin, warnings,
    });
  }
  return sortReadyFirst(forms, 'total_paid');
}

// ── 1099-G (government payments) ────────────────────────────

export interface Form1099GData extends PayerIdentity, RecipientIdentity, FilingFlags {
  year: number;
  box1_unemployment_comp: number;
  box2_state_local_refund: number;        // Most common box for accounting users
  box2_year_for_refund: number;
  box3_box_2_amount_for_year: boolean;
  box4_fed_tax_withheld: number;
  box5_atomic_energy_payment: number;
  box6_taxable_grants: number;
  box7_agriculture_payments: number;
  box8_box_2_trade_or_business: boolean;
  box9_market_gain: number;
  box10a_state: string;
  box10b_state_id: string;
  box11_state_tax_withheld: number;
  total_paid: number;
}

export function compute1099Gs(companyId: string, year: number): Form1099GData[] {
  const company = db.getById('companies', companyId) as any || {};
  const recipients = loadEligibleClients(companyId);
  const forms: Form1099GData[] = [];
  for (const r of recipients) {
    const payer = buildPayerIdentity(company);
    const recipient = buildRecipientIdentity(r);
    const warnings = buildIdentityWarnings(recipient, '1099-G');
    warnings.push('1099-G is issued by government agencies. Enter Box 1 (unemployment), Box 2 (refunds), or Box 6 (taxable grants) manually.');
    forms.push({
      ...payer, ...recipient, year,
      box1_unemployment_comp: 0, box2_state_local_refund: 0,
      box2_year_for_refund: year - 1, box3_box_2_amount_for_year: true,
      box4_fed_tax_withheld: 0, box5_atomic_energy_payment: 0,
      box6_taxable_grants: 0, box7_agriculture_payments: 0,
      box8_box_2_trade_or_business: false, box9_market_gain: 0,
      box10a_state: company.state || '', box10b_state_id: company.state_id || '',
      box11_state_tax_withheld: 0, total_paid: 0,
      meets_filing_threshold: false, has_tin: !!recipient.recipient_tin, warnings,
    });
  }
  return sortReadyFirst(forms, 'total_paid');
}

// ── 1099-C (cancellation of debt) ───────────────────────────

export interface Form1099CData extends PayerIdentity, RecipientIdentity, FilingFlags {
  year: number;
  box1_date_canceled: string;
  box2_amount_debt_canceled: number;        // ≥ $600 threshold
  box3_interest_in_box_2: number;
  box4_debt_description: string;
  box5_check_personally_liable: boolean;
  box6_identifiable_event_code: string;     // A, B, C, D, E, F, G, H
  box7_fair_market_value_property: number;
  total_paid: number;
}

const C_FILING_THRESHOLD = 600;

export function compute1099Cs(companyId: string, year: number): Form1099CData[] {
  const company = db.getById('companies', companyId) as any || {};
  const recipients = loadEligibleClients(companyId);
  const forms: Form1099CData[] = [];
  for (const r of recipients) {
    const payer = buildPayerIdentity(company);
    const recipient = buildRecipientIdentity(r);
    const warnings = buildIdentityWarnings(recipient, '1099-C');
    warnings.push('1099-C is filed by lenders that canceled $' + C_FILING_THRESHOLD + '+ of debt. Enter Box 1 (date), Box 2 (amount), Box 6 (event code A-H).');
    forms.push({
      ...payer, ...recipient, year,
      box1_date_canceled: '', box2_amount_debt_canceled: 0,
      box3_interest_in_box_2: 0, box4_debt_description: '',
      box5_check_personally_liable: true, box6_identifiable_event_code: 'A',
      box7_fair_market_value_property: 0, total_paid: 0,
      meets_filing_threshold: false, has_tin: !!recipient.recipient_tin, warnings,
    });
  }
  return sortReadyFirst(forms, 'total_paid');
}

// ── 1099-SA (HSA / MSA distributions) ───────────────────────

export interface Form1099SAData extends PayerIdentity, RecipientIdentity, FilingFlags {
  year: number;
  box1_gross_distribution: number;
  box2_earnings_on_excess: number;
  box3_distribution_code: string;            // 1=normal, 2=excess, 3=disability, 4=death, 5=prohibited, 6=death after RBD
  box4_fmv_on_date_of_death: number;
  box5_hsa_archer_msa_ma_msa: 'HSA' | 'Archer MSA' | 'MA MSA';
  total_paid: number;
}

export function compute1099SAs(companyId: string, year: number): Form1099SAData[] {
  const company = db.getById('companies', companyId) as any || {};
  const recipients = loadEligibleClients(companyId);
  const forms: Form1099SAData[] = [];
  for (const r of recipients) {
    const payer = buildPayerIdentity(company);
    const recipient = buildRecipientIdentity(r);
    const warnings = buildIdentityWarnings(recipient, '1099-SA');
    warnings.push('1099-SA is filed by HSA/MSA trustees (banks, brokerages). Enter Box 1 (gross distribution), Box 3 (code 1-6), Box 5 (account type) manually.');
    forms.push({
      ...payer, ...recipient, year,
      box1_gross_distribution: 0, box2_earnings_on_excess: 0,
      box3_distribution_code: '1', box4_fmv_on_date_of_death: 0,
      box5_hsa_archer_msa_ma_msa: 'HSA', total_paid: 0,
      meets_filing_threshold: false, has_tin: !!recipient.recipient_tin, warnings,
    });
  }
  return sortReadyFirst(forms, 'total_paid');
}
