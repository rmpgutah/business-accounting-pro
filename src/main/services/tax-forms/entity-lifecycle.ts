// src/main/services/tax-forms/entity-lifecycle.ts
//
// Entity-lifecycle forms — one-time filings that establish, modify,
// or update an entity's status with the IRS. All four pull from the
// company record + accept manual fields:
//
//   • SS-4    — Application for Employer Identification Number
//   • 2553    — Election by a Small Business Corporation (S-corp)
//   • 8832    — Entity Classification Election
//   • 8822-B  — Change of Address or Responsible Party — Business
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-form-ss-4
//   • https://www.irs.gov/forms-pubs/about-form-2553
//   • https://www.irs.gov/forms-pubs/about-form-8832
//   • https://www.irs.gov/forms-pubs/about-form-8822-b

import * as db from '../../database';

// ── Form SS-4 (EIN Application) ───────────────────────────────

export interface FormSS4Data {
  legal_name: string;
  trade_name: string;
  mailing_address: string;
  street_address: string;
  city: string;
  state: string;
  zip: string;
  county: string;

  responsible_party_name: string;
  responsible_party_ssn_or_itin: string;

  // Box 8a-9b
  applicant_type: 'sole-prop' | 'partnership' | 'corporation' | 'personal-service-corp' | 'church' | 'nonprofit' | 'estate' | 'trust' | 'national-guard' | 'farmers-coop' | 'remic' | 'indian-tribal-gov' | 'reverse';
  number_of_members_llc: number;            // Only if LLC
  is_llc: boolean;
  is_corporation_form_organized: string;     // Form number (1120, 1120-S, etc.)

  // Box 10 — Reason for applying
  reason_for_applying: 'started-new-business' | 'hired-employees' | 'banking-purpose' | 'changed-type-of-organization' | 'purchased-going-business' | 'created-trust' | 'created-pension-plan' | 'other';
  date_business_started: string;
  closing_month_accounting_year: string;    // "December" usually

  // Box 12-14 — Employees
  highest_employees_expected_first_12mo: number;
  first_date_wages_paid: string;
  principal_activity: string;                // e.g., "Construction"
  product_or_service: string;                 // e.g., "Custom millwork"

  // Box 15-16 — Prior EIN
  has_applied_before: boolean;
  prior_ein: string;
  prior_legal_name: string;
  prior_trade_name: string;

  warnings: string[];
}

export interface FormSS4Opts {
  applicant_type?: FormSS4Data['applicant_type'];
  is_llc?: boolean;
  number_of_members_llc?: number;
  reason_for_applying?: FormSS4Data['reason_for_applying'];
  date_business_started?: string;
  highest_employees_expected_first_12mo?: number;
  first_date_wages_paid?: string;
  principal_activity?: string;
  product_or_service?: string;
  responsible_party_name?: string;
  responsible_party_ssn_or_itin?: string;
}

export function computeFormSS4(companyId: string, opts: FormSS4Opts = {}): FormSS4Data {
  const company = db.getById('companies', companyId) as any || {};
  const warnings: string[] = [];
  if (!opts.responsible_party_name) warnings.push('Responsible party (line 7a) required — typically the principal officer / general partner / owner who controls the entity.');
  if (!opts.responsible_party_ssn_or_itin) warnings.push('Responsible party SSN or ITIN (line 7b) required.');
  if (!opts.principal_activity) warnings.push('Principal activity (line 13) required.');
  return {
    legal_name: company.legal_name || company.name || '',
    trade_name: company.name || '',
    mailing_address: [company.address_line1, company.city, company.state, company.zip].filter(Boolean).join(', '),
    street_address: company.address_line1 || '',
    city: company.city || '',
    state: company.state || '',
    zip: company.zip || '',
    county: company.county || '',
    responsible_party_name: opts.responsible_party_name || '',
    responsible_party_ssn_or_itin: opts.responsible_party_ssn_or_itin || '',
    applicant_type: opts.applicant_type || 'sole-prop',
    number_of_members_llc: opts.number_of_members_llc || 0,
    is_llc: !!opts.is_llc,
    is_corporation_form_organized: '',
    reason_for_applying: opts.reason_for_applying || 'started-new-business',
    date_business_started: opts.date_business_started || company.formation_date || '',
    closing_month_accounting_year: 'December',
    highest_employees_expected_first_12mo: opts.highest_employees_expected_first_12mo || 0,
    first_date_wages_paid: opts.first_date_wages_paid || '',
    principal_activity: opts.principal_activity || company.industry || '',
    product_or_service: opts.product_or_service || '',
    has_applied_before: false,
    prior_ein: '',
    prior_legal_name: '',
    prior_trade_name: '',
    warnings,
  };
}

// ── Form 2553 (S-Corp Election) ───────────────────────────────

export interface Form2553Data {
  entity_name: string;
  ein: string;
  address: string;
  state_of_incorporation: string;
  date_incorporated: string;
  effective_date: string;                     // When S election begins (typically Jan 1)
  fiscal_year_end: string;                    // "12/31" usually

  // Part I — Election Information
  shareholders: Array<{
    name: string;
    address: string;
    ssn: string;
    shares_owned: number;
    date_acquired: string;
    consent_signature_date: string;
  }>;

  // Part II — Selection of Fiscal Year (only if not calendar year)
  selected_fiscal_year: boolean;
  natural_business_year_test: boolean;
  ownership_tax_year_test: boolean;
  business_purpose_request: boolean;

  warnings: string[];
}

export interface Form2553Opts {
  effective_date?: string;
  state_of_incorporation?: string;
  date_incorporated?: string;
  fiscal_year_end?: string;
  shareholders?: Form2553Data['shareholders'];
}

export function computeForm2553(companyId: string, opts: Form2553Opts = {}): Form2553Data {
  const company = db.getById('companies', companyId) as any || {};
  const warnings: string[] = [];
  const shareholders = opts.shareholders || [];
  if (shareholders.length === 0) warnings.push('Shareholder list required — pass via opts.shareholders. Each must consent (signature) for the election to be valid.');
  if (shareholders.length > 100) warnings.push('S-corp election limited to 100 shareholders (' + shareholders.length + ' provided).');
  if (!opts.effective_date) warnings.push('Effective date required — typically the start of the tax year you want S-corp status to begin.');
  if (!company.ein && !company.tax_id) warnings.push('EIN required before filing Form 2553. File Form SS-4 first if you don\'t have one.');

  // Filing deadline check
  const today = new Date().toISOString().slice(0, 10);
  if (opts.effective_date) {
    const effDate = new Date(opts.effective_date + 'T00:00:00');
    const deadline = new Date(effDate);
    deadline.setMonth(deadline.getMonth() + 2);
    deadline.setDate(15);
    if (today > deadline.toISOString().slice(0, 10)) {
      warnings.push('Today (' + today + ') is past the deadline (' + deadline.toISOString().slice(0, 10) + ') — S election must be filed within 2 months and 15 days of the effective date. Late elections require Rev. Proc. 2013-30 relief.');
    }
  }

  return {
    entity_name: company.legal_name || company.name || '',
    ein: company.ein || company.tax_id || '',
    address: [company.address_line1, company.city, company.state, company.zip].filter(Boolean).join(', '),
    state_of_incorporation: opts.state_of_incorporation || company.state || '',
    date_incorporated: opts.date_incorporated || company.formation_date || '',
    effective_date: opts.effective_date || '',
    fiscal_year_end: opts.fiscal_year_end || '12/31',
    shareholders,
    selected_fiscal_year: false,
    natural_business_year_test: false,
    ownership_tax_year_test: false,
    business_purpose_request: false,
    warnings,
  };
}

// ── Form 8832 (Entity Classification Election) ────────────────

export interface Form8832Data {
  entity_name: string;
  ein: string;
  address: string;
  type_of_election: 'initial' | 'change';

  current_classification: 'sole-prop-or-disregarded' | 'partnership' | 'corporation';
  desired_classification: 'corporation' | 'partnership' | 'disregarded';
  effective_date: string;

  number_of_owners: number;
  is_owned_by_one_or_more_corps: boolean;

  warnings: string[];
}

export interface Form8832Opts {
  type_of_election?: 'initial' | 'change';
  current_classification?: Form8832Data['current_classification'];
  desired_classification?: Form8832Data['desired_classification'];
  effective_date?: string;
  number_of_owners?: number;
}

export function computeForm8832(companyId: string, opts: Form8832Opts = {}): Form8832Data {
  const company = db.getById('companies', companyId) as any || {};
  const warnings: string[] = [];
  if (!opts.desired_classification) warnings.push('Desired classification required (line 6) — most common: LLC electing C-corp or S-corp tax treatment.');
  if (!opts.effective_date) warnings.push('Effective date required (line 8) — election generally cannot be retroactive more than 75 days.');
  if (opts.desired_classification === 'corporation' && opts.current_classification !== 'sole-prop-or-disregarded') {
    warnings.push('Note: an LLC electing corporation status via 8832 still needs Form 2553 separately for S-corp. 8832 alone gives C-corp treatment.');
  }
  return {
    entity_name: company.legal_name || company.name || '',
    ein: company.ein || company.tax_id || '',
    address: [company.address_line1, company.city, company.state, company.zip].filter(Boolean).join(', '),
    type_of_election: opts.type_of_election || 'initial',
    current_classification: opts.current_classification || 'sole-prop-or-disregarded',
    desired_classification: opts.desired_classification || 'corporation',
    effective_date: opts.effective_date || '',
    number_of_owners: opts.number_of_owners || 1,
    is_owned_by_one_or_more_corps: false,
    warnings,
  };
}

// ── Form 8822-B (Address / Responsible Party Change) ─────────

export interface Form8822BData {
  entity_name: string;
  ein: string;
  current_business_address: string;
  new_business_address: string;
  current_responsible_party_name: string;
  current_responsible_party_ssn: string;
  new_responsible_party_name: string;
  new_responsible_party_ssn: string;

  is_address_change: boolean;
  is_responsible_party_change: boolean;
  effective_date: string;

  warnings: string[];
}

export interface Form8822BOpts {
  new_address?: string;
  new_responsible_party_name?: string;
  new_responsible_party_ssn?: string;
  current_responsible_party_name?: string;
  current_responsible_party_ssn?: string;
  effective_date?: string;
}

export function computeForm8822B(companyId: string, opts: Form8822BOpts = {}): Form8822BData {
  const company = db.getById('companies', companyId) as any || {};
  const warnings: string[] = [];
  const isAddrChange = !!opts.new_address;
  const isRpChange = !!opts.new_responsible_party_name;
  if (!isAddrChange && !isRpChange) warnings.push('Specify either opts.new_address (address change) OR opts.new_responsible_party_name (responsible party change). Form 8822-B requires at least one.');
  if (isRpChange && !opts.new_responsible_party_ssn) warnings.push('New responsible party SSN required.');
  return {
    entity_name: company.legal_name || company.name || '',
    ein: company.ein || company.tax_id || '',
    current_business_address: [company.address_line1, company.city, company.state, company.zip].filter(Boolean).join(', '),
    new_business_address: opts.new_address || '',
    current_responsible_party_name: opts.current_responsible_party_name || '',
    current_responsible_party_ssn: opts.current_responsible_party_ssn || '',
    new_responsible_party_name: opts.new_responsible_party_name || '',
    new_responsible_party_ssn: opts.new_responsible_party_ssn || '',
    is_address_change: isAddrChange,
    is_responsible_party_change: isRpChange,
    effective_date: opts.effective_date || '',
    warnings,
  };
}
