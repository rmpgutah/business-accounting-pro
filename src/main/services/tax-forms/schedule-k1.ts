// src/main/services/tax-forms/schedule-k1.ts
//
// Schedule K-1 — Partner's / Shareholder's Share of Income, Deductions,
// Credits, etc.
//
// Two variants:
//   • K-1 (Form 1065)   — partnerships
//   • K-1 (Form 1120-S) — S-corporations
//
// Both have nearly identical box numbers — only difference is the
// "guaranteed payments" box on 1065 (S-corps don't have those; owner-
// employees take W-2 wages instead).
//
// Each entity files ONE 1065 / 1120-S, then issues ONE K-1 PER
// partner/shareholder showing their proportional share. The IRS gets
// a copy of every K-1; recipients use them on their personal returns.
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-schedule-k-1-form-1065
//   • https://www.irs.gov/forms-pubs/about-schedule-k-1-form-1120-s

import { round2, PartnerOrShareholder } from './entity-return-shared';
import * as db from '../../database';

export type K1Variant = '1065' | '1120-S';

export interface K1Data {
  variant: K1Variant;

  // Part I — Entity (the partnership / S-corp)
  entity_ein: string;
  entity_name: string;
  entity_address: string;
  entity_irs_center: string;             // Where the 1065/1120-S is filed
  is_publicly_traded: boolean;            // 1065 only

  // Part II — Recipient (partner / shareholder)
  recipient_id: string;
  recipient_tin: string;                  // SSN or EIN
  recipient_name: string;
  recipient_address: string;
  is_general_partner: boolean;             // 1065 only
  is_limited_partner: boolean;             // 1065 only
  is_domestic_partner: boolean;
  is_disregarded_entity: boolean;
  partner_type: string;                    // "Individual", "S-corp", "Partnership", etc.

  // Profit / loss / capital share
  share_profit_pct_begin: number;
  share_profit_pct_end: number;
  share_loss_pct_begin: number;
  share_loss_pct_end: number;
  share_capital_pct_begin: number;
  share_capital_pct_end: number;

  // Capital account analysis (1065 Part II Item L)
  capital_beginning: number;
  capital_contributed: number;
  capital_current_year_increase: number;
  capital_withdrawals_distributions: number;
  capital_ending: number;

  // Part III — Distributive share items
  box1_ordinary_business_income: number;
  box2_net_rental_real_estate: number;
  box3_other_net_rental: number;
  box4a_guaranteed_payments_services: number;     // 1065 only
  box4b_guaranteed_payments_capital: number;       // 1065 only
  box5_interest_income: number;
  box6a_ordinary_dividends: number;
  box6b_qualified_dividends: number;
  box7_royalties: number;
  box8_net_short_term_capital_gain: number;
  box9a_net_long_term_capital_gain: number;
  box9b_collectibles_28pct_gain: number;
  box10_net_section_1231_gain: number;
  box11_other_income: number;
  box12_section_179_deduction: number;
  box13_other_deductions: number;
  box14_self_employment_earnings: number;          // 1065 only — fed into Schedule SE
  box16_distributions: number;                      // 1120-S only
  box17_other_information: number;
  box19_distributions_money: number;                // 1065 only

  warnings: string[];
}

export interface K1Opts {
  variant: K1Variant;
  recipient: PartnerOrShareholder;
  // Total entity-level distributive shares (from Form 1065 Schedule K
  // or Form 1120-S Schedule K)
  schK_totals: {
    ordinary_business_income: number;
    net_rental_real_estate?: number;
    other_net_rental?: number;
    guaranteed_payments?: number;       // 1065 only
    interest_income: number;
    dividend_income: number;
    royalties: number;
    net_short_term_cap_gain?: number;
    net_long_term_cap_gain: number;
    section_1231_gain?: number;
    charitable_contributions?: number;
    section_179_deduction?: number;
    self_employment_earnings?: number;   // 1065 only
    distributions?: number;               // 1120-S only
  };
  // Entity identity (from Form 1065 / 1120-S)
  entity: {
    ein: string;
    name: string;
    address: string;
    irs_center?: string;
  };
  // Capital account (1065 only)
  capital_beginning?: number;
  capital_contributed?: number;
  capital_withdrawals?: number;
}

export function computeScheduleK1(
  opts: K1Opts,
): K1Data {
  const r = opts.recipient;
  const ownership = (r.ownership_pct || 0) / 100;
  const schK = opts.schK_totals;

  // Pro-rate each Schedule K total by the recipient's ownership %
  const box1 = round2((schK.ordinary_business_income || 0) * ownership);
  const box2 = round2((schK.net_rental_real_estate || 0) * ownership);
  const box3 = round2((schK.other_net_rental || 0) * ownership);
  const box4a = opts.variant === '1065' ? round2((schK.guaranteed_payments || 0) * ownership) : 0;
  const box5 = round2((schK.interest_income || 0) * ownership);
  const box6a = round2((schK.dividend_income || 0) * ownership);
  const box7 = round2((schK.royalties || 0) * ownership);
  const box8 = round2((schK.net_short_term_cap_gain || 0) * ownership);
  const box9a = round2((schK.net_long_term_cap_gain || 0) * ownership);
  const box10 = round2((schK.section_1231_gain || 0) * ownership);
  const box12 = round2((schK.section_179_deduction || 0) * ownership);
  const box13 = round2((schK.charitable_contributions || 0) * ownership);
  const box14 = opts.variant === '1065' ? round2((schK.self_employment_earnings || box1) * ownership) : 0;
  const box16 = opts.variant === '1120-S' ? round2((schK.distributions || 0) * ownership) : 0;
  const box19 = opts.variant === '1065' ? round2((schK.distributions || 0) * ownership) : 0;

  // Capital account (1065 only) — simplified
  const capBegin = round2(opts.capital_beginning || 0);
  const capContrib = round2(opts.capital_contributed || 0);
  const capIncrease = round2(box1 + box2 + box3 + box4a + box5 + box6a + box7 + box8 + box9a + box10);
  const capWithdrawals = round2(opts.capital_withdrawals || box19);
  const capEnd = round2(capBegin + capContrib + capIncrease - capWithdrawals);

  const warnings: string[] = [];
  if (ownership === 0) warnings.push('Recipient ownership % is 0 — all boxes will be $0. Verify ownership_pct on the recipient.');
  if (opts.variant === '1120-S' && r.is_general_partner) warnings.push('S-corp shareholders are not classified as general/limited partners — that is partnership terminology.');
  if (box1 < 0) warnings.push('Box 1 ordinary loss of $' + Math.abs(box1).toFixed(2) + ' — recipient must check basis, at-risk, and passive-activity limits before claiming.');
  if (!r.ssn_or_ein) warnings.push('Recipient TIN missing — required on K-1 to match IRS records.');

  // Try to find the recipient's address from the database
  const dbi = db.getDb();
  let recipientAddress = '';
  try {
    const employee = dbi.prepare('SELECT * FROM employees WHERE id = ?').get(r.id) as any;
    if (employee) {
      recipientAddress = [employee.address_line1, employee.city, employee.state, employee.zip].filter(Boolean).join(', ');
    } else {
      const client = dbi.prepare('SELECT * FROM clients WHERE id = ?').get(r.id) as any;
      if (client) {
        recipientAddress = [client.address, client.city, client.state, client.zip].filter(Boolean).join(', ');
      }
    }
  } catch { /* not found */ }

  return {
    variant: opts.variant,
    entity_ein: opts.entity.ein,
    entity_name: opts.entity.name,
    entity_address: opts.entity.address,
    entity_irs_center: opts.entity.irs_center || '',
    is_publicly_traded: false,

    recipient_id: r.id,
    recipient_tin: r.ssn_or_ein,
    recipient_name: r.name,
    recipient_address: recipientAddress,
    is_general_partner: !!r.is_general_partner,
    is_limited_partner: opts.variant === '1065' && r.is_general_partner === false,
    is_domestic_partner: true,
    is_disregarded_entity: false,
    partner_type: 'Individual',

    share_profit_pct_begin: r.ownership_pct || 0,
    share_profit_pct_end: r.ownership_pct || 0,
    share_loss_pct_begin: r.ownership_pct || 0,
    share_loss_pct_end: r.ownership_pct || 0,
    share_capital_pct_begin: r.ownership_pct || 0,
    share_capital_pct_end: r.ownership_pct || 0,

    capital_beginning: capBegin,
    capital_contributed: capContrib,
    capital_current_year_increase: capIncrease,
    capital_withdrawals_distributions: capWithdrawals,
    capital_ending: capEnd,

    box1_ordinary_business_income: box1,
    box2_net_rental_real_estate: box2,
    box3_other_net_rental: box3,
    box4a_guaranteed_payments_services: box4a,
    box4b_guaranteed_payments_capital: 0,
    box5_interest_income: box5,
    box6a_ordinary_dividends: box6a,
    box6b_qualified_dividends: 0,
    box7_royalties: box7,
    box8_net_short_term_capital_gain: box8,
    box9a_net_long_term_capital_gain: box9a,
    box9b_collectibles_28pct_gain: 0,
    box10_net_section_1231_gain: box10,
    box11_other_income: 0,
    box12_section_179_deduction: box12,
    box13_other_deductions: box13,
    box14_self_employment_earnings: box14,
    box16_distributions: box16,
    box17_other_information: 0,
    box19_distributions_money: box19,

    warnings,
  };
}
