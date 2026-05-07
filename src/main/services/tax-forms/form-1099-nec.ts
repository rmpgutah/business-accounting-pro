// src/main/services/tax-forms/form-1099-nec.ts
//
// IRS Form 1099-NEC — Nonemployee Compensation.
//
// Filed for any independent contractor (vendor flagged is_1099_eligible)
// paid >= $600 in the calendar year. Returns one form per recipient.
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-form-1099-nec

import * as db from '../../database';

export interface Form1099NECData {
  // Payer (filing entity)
  payer_name: string;
  payer_address: string;
  payer_city: string;
  payer_state: string;
  payer_zip: string;
  payer_tin: string;            // EIN of the company
  payer_phone: string;

  // Recipient (the contractor)
  recipient_name: string;
  recipient_address: string;
  recipient_city: string;
  recipient_state: string;
  recipient_zip: string;
  recipient_tin: string;        // SSN or EIN — sensitive!
  recipient_id: string;         // vendor row id (for navigation)
  account_number: string;       // optional payer account number

  // Box values
  box1_nonemployee_comp: number;        // Total paid
  box2_direct_sales: boolean;           // $5K+ of consumer products for resale
  box4_fed_income_tax_withheld: number; // Backup withholding (rare)
  box5_state_tax_withheld: number;      // State w/h (rare for 1099)
  box6_state_payer_no: string;
  box7_state_income: number;            // State-reported amount

  // Computation
  payment_count: number;
  year: number;

  // Status flags
  meets_filing_threshold: boolean;       // ≥ $600
  has_tin: boolean;                      // recipient has EIN/SSN on file
  warnings: string[];
}

const FILING_THRESHOLD = 600;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function compute1099NECs(companyId: string, year: number): Form1099NECData[] {
  const dbi = db.getDb();
  const company = db.getById('companies', companyId) as any || {};
  const yearStart = year + '-01-01';
  const yearEnd = year + '-12-31';

  // Pull all 1099-eligible vendors with their YTD payment totals.
  // bill_payments is the source of truth (paid bills = vendor compensation).
  // Some tenants pay vendors via expenses with a vendor_id; include those too.
  const vendors = dbi.prepare(`
    SELECT v.*
    FROM vendors v
    WHERE v.company_id = ?
      AND COALESCE(v.deleted_at, '') = ''
      AND (v.is_1099_eligible = 1 OR v.vendor_1099 = 1 OR v.requires_1099 = 1)
  `).all(companyId) as any[];

  const forms: Form1099NECData[] = [];

  for (const v of vendors) {
    // Sum bill payments to this vendor in the year
    const billPayments = (dbi.prepare(`
      SELECT COALESCE(SUM(bp.amount), 0) AS total, COUNT(*) AS cnt
      FROM bill_payments bp
      JOIN bills b ON b.id = bp.bill_id
      WHERE b.vendor_id = ?
        AND bp.date BETWEEN ? AND ?
    `).get(v.id, yearStart, yearEnd) as any) || { total: 0, cnt: 0 };

    // Sum expenses paid to this vendor (cash outlays not tracked as bills)
    const expensePayments = (dbi.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
      FROM expenses
      WHERE vendor_id = ?
        AND date BETWEEN ? AND ?
        AND COALESCE(deleted_at, '') = ''
    `).get(v.id, yearStart, yearEnd) as any) || { total: 0, cnt: 0 };

    const totalPaid = round2(Number(billPayments.total) + Number(expensePayments.total));
    const paymentCount = Number(billPayments.cnt) + Number(expensePayments.cnt);

    if (totalPaid <= 0) continue;

    const warnings: string[] = [];
    const tin = v.tin || v.tax_id || v.ein || v.ssn || '';
    if (!tin) warnings.push('Recipient has no TIN on file — required for 1099 filing. Request a W-9.');
    if (totalPaid < FILING_THRESHOLD) warnings.push('Below $600 threshold — 1099-NEC not required for this vendor.');
    if (!v.address_line1) warnings.push('Recipient address missing.');

    forms.push({
      payer_name: company.legal_name || company.name || '',
      payer_address: [company.address_line1, company.address_line2].filter(Boolean).join(', '),
      payer_city: company.city || '',
      payer_state: company.state || '',
      payer_zip: company.zip || '',
      payer_tin: company.ein || company.tax_id || '',
      payer_phone: company.phone || '',

      recipient_name: v.name || '',
      recipient_address: [v.address_line1, v.address_line2].filter(Boolean).join(', '),
      recipient_city: v.city || '',
      recipient_state: v.state || '',
      recipient_zip: v.zip || '',
      recipient_tin: tin,
      recipient_id: v.id,
      account_number: v.account_number || '',

      box1_nonemployee_comp: totalPaid,
      box2_direct_sales: false,
      box4_fed_income_tax_withheld: 0,
      box5_state_tax_withheld: 0,
      box6_state_payer_no: '',
      box7_state_income: 0,

      payment_count: paymentCount,
      year,

      meets_filing_threshold: totalPaid >= FILING_THRESHOLD,
      has_tin: !!tin,
      warnings,
    });
  }

  // Sort: must-file first (above threshold + has TIN), then below-threshold,
  // then missing-TIN warnings — exposes filing-blocking issues at the top.
  forms.sort((a, b) => {
    const aReady = a.meets_filing_threshold && a.has_tin ? 1 : 0;
    const bReady = b.meets_filing_threshold && b.has_tin ? 1 : 0;
    if (aReady !== bReady) return bReady - aReady;
    return b.box1_nonemployee_comp - a.box1_nonemployee_comp;
  });

  return forms;
}
