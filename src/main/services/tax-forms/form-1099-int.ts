// src/main/services/tax-forms/form-1099-int.ts
//
// IRS Form 1099-INT — Interest Income.
//
// Filed when the business pays $10+ of interest to a recipient
// (e.g., a private lender, a deferred-compensation arrangement).
// Most accounting users issue this only if they paid interest on
// loans or deposits to non-bank counterparties.
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-form-1099-int

import * as db from '../../database';
import {
  PayerIdentity, RecipientIdentity, FilingFlags,
  round2, buildPayerIdentity, buildRecipientIdentity,
  sortReadyFirst, buildIdentityWarnings, loadEligibleVendors,
} from './form-1099-shared';

export interface Form1099INTData extends PayerIdentity, RecipientIdentity, FilingFlags {
  year: number;
  // Box values
  box1_interest_income: number;          // Taxable interest paid (≥ $10)
  box2_early_withdrawal_penalty: number; // Early-withdrawal penalty
  box3_us_savings_bond: number;          // Interest on US Treasury obligations
  box4_fed_tax_withheld: number;         // Backup withholding (24%)
  box5_investment_expenses: number;      // RICs only
  box6_foreign_tax_paid: number;
  box7_foreign_country: string;
  box8_tax_exempt_interest: number;      // Muni / private activity ≥ $10
  box9_specified_pab_interest: number;   // Subset of Box 8 — AMT preference
  box10_market_discount: number;
  box11_bond_premium: number;
  box12_bond_premium_treasury: number;
  box13_bond_premium_tax_exempt: number;
  box14_tax_exempt_cusip: string;
  box15_state: string;
  box16_state_id: string;
  box17_state_tax_withheld: number;
  total_paid: number;
  payment_count: number;
}

const FILING_THRESHOLD = 10;

export function compute1099INTs(companyId: string, year: number): Form1099INTData[] {
  const dbi = db.getDb();
  const company = db.getById('companies', companyId) as any || {};
  const yearStart = year + '-01-01';
  const yearEnd = year + '-12-31';

  // Pull bills/expenses categorized as "interest" paid to flagged vendors
  const vendors = loadEligibleVendors(companyId).filter((v) =>
    v.is_1099_int_eligible === 1 || v.is_1099_eligible === 1
  );

  const forms: Form1099INTData[] = [];

  for (const v of vendors) {
    let interestPayments: any[] = [];
    try {
      interestPayments = dbi.prepare(`
        SELECT bp.amount AS amount, bp.date AS date
        FROM bill_payments bp
        JOIN bills b ON b.id = bp.bill_id
        LEFT JOIN categories c ON c.id = b.category_id
        WHERE b.vendor_id = ?
          AND bp.date BETWEEN ? AND ?
          AND (LOWER(COALESCE(c.name, '')) LIKE '%interest%' OR LOWER(COALESCE(b.notes, '')) LIKE '%interest%')
      `).all(v.id, yearStart, yearEnd) as any[];
    } catch { /* schema variant */ }

    let expenseInterest: any[] = [];
    try {
      expenseInterest = dbi.prepare(`
        SELECT amount, date
        FROM expenses e
        LEFT JOIN categories c ON c.id = e.category_id
        WHERE e.vendor_id = ?
          AND e.date BETWEEN ? AND ?
          AND COALESCE(e.deleted_at, '') = ''
          AND (LOWER(COALESCE(c.name, '')) LIKE '%interest%' OR LOWER(COALESCE(e.description, '')) LIKE '%interest%')
      `).all(v.id, yearStart, yearEnd) as any[];
    } catch { /* schema variant */ }

    const total = round2([...interestPayments, ...expenseInterest].reduce((s, p) => s + (Number(p.amount) || 0), 0));
    if (total <= 0) continue;

    const payer = buildPayerIdentity(company);
    const recipient = buildRecipientIdentity(v);
    const warnings = buildIdentityWarnings(recipient, '1099-INT');
    if (total < FILING_THRESHOLD) warnings.push('Below $10 threshold — 1099-INT not required.');

    forms.push({
      ...payer, ...recipient, year,
      box1_interest_income: total,
      box2_early_withdrawal_penalty: 0,
      box3_us_savings_bond: 0,
      box4_fed_tax_withheld: 0,
      box5_investment_expenses: 0,
      box6_foreign_tax_paid: 0,
      box7_foreign_country: '',
      box8_tax_exempt_interest: 0,
      box9_specified_pab_interest: 0,
      box10_market_discount: 0,
      box11_bond_premium: 0,
      box12_bond_premium_treasury: 0,
      box13_bond_premium_tax_exempt: 0,
      box14_tax_exempt_cusip: '',
      box15_state: company.state || '',
      box16_state_id: company.state_id || '',
      box17_state_tax_withheld: 0,
      total_paid: total,
      payment_count: interestPayments.length + expenseInterest.length,
      meets_filing_threshold: total >= FILING_THRESHOLD,
      has_tin: !!recipient.recipient_tin,
      warnings,
    });
  }

  return sortReadyFirst(forms, 'total_paid');
}
