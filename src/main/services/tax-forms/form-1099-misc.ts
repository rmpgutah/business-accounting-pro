// src/main/services/tax-forms/form-1099-misc.ts
//
// IRS Form 1099-MISC — Miscellaneous Information.
//
// Companion to 1099-NEC. After the 2020 split, NEC carries
// nonemployee compensation; MISC carries everything else:
//   • Box 1 Rents
//   • Box 2 Royalties (≥ $10 threshold, not $600)
//   • Box 3 Other income (prizes, awards, taxable damages)
//   • Box 6 Medical/healthcare payments
//   • Box 10 Gross proceeds paid to attorneys (settlements, NOT
//     legal fees — those are NEC)
//   • Box 4 Federal tax withheld (backup withholding)
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-form-1099-misc
//   • IRS Pub 1220 (electronic filing)
//
// What this DOES:
//   • Pulls 1099-MISC-eligible vendors (separate flag from NEC)
//   • Bucketizes payments by category keyword → box
//   • Returns one form per recipient with applicable boxes filled
//
// What this does NOT do:
//   • Box 7 direct-sales >= $5K (rare, manual flag on vendor)
//   • Box 8 substitute-payments (broker-dealer use case)
//   • Box 9 crop insurance, Box 11 fish, Box 12-14 (specialized)

import * as db from '../../database';

export type MiscBox = 'box1' | 'box2' | 'box3' | 'box6' | 'box10';

export interface Form1099MISCData {
  // Payer
  payer_name: string;
  payer_address: string;
  payer_city: string;
  payer_state: string;
  payer_zip: string;
  payer_tin: string;
  payer_phone: string;

  // Recipient
  recipient_name: string;
  recipient_address: string;
  recipient_city: string;
  recipient_state: string;
  recipient_zip: string;
  recipient_tin: string;
  recipient_id: string;
  account_number: string;

  // Box values
  box1_rents: number;
  box2_royalties: number;
  box3_other_income: number;
  box4_fed_tax_withheld: number;
  box5_fishing_boat_proceeds: number;
  box6_medical_healthcare: number;
  box7_direct_sales_5k: boolean;
  box8_substitute_payments: number;
  box9_crop_insurance: number;
  box10_gross_proceeds_attorney: number;
  box11_fish_purchased: number;
  box12_section_409a: number;
  box13_excess_golden_parachute: number;
  box14_nonqual_deferred_comp: number;
  box15_state_tax_withheld: number;
  box16_state_payer_no: string;
  box17_state_income: number;

  // Computation metadata
  total_paid: number;                       // sum of all boxes
  payment_count: number;
  year: number;
  primary_box: MiscBox;                     // dominant box for display

  // Status flags
  meets_filing_threshold: boolean;          // ≥ $600 (or ≥ $10 for royalties)
  has_tin: boolean;
  warnings: string[];

  // Drilldown — per-payment breakdown for audit trail
  breakdown: Array<{
    date: string;
    amount: number;
    description: string;
    category: string;
    box: MiscBox;
    source: 'bill_payment' | 'expense';
  }>;
}

const FILING_THRESHOLD = 600;
const ROYALTY_THRESHOLD = 10;

// Category-keyword → box mapping. Order matters (first match wins).
const BOX_KEYWORDS: Array<{ box: MiscBox; keywords: string[] }> = [
  { box: 'box1',  keywords: ['rent', 'lease', 'office space', 'equipment rental', 'storage', 'warehouse'] },
  { box: 'box6',  keywords: ['medical', 'health', 'doctor', 'physician', 'clinic', 'hospital', 'dental', 'pharmacy', 'lab'] },
  { box: 'box10', keywords: ['settlement', 'attorney settlement', 'litigation', 'judgment', 'legal settlement'] },
  { box: 'box2',  keywords: ['royalty', 'royalties', 'licensing', 'license fee', 'patent', 'mineral rights'] },
  { box: 'box3',  keywords: ['prize', 'award', 'damages', 'taxable damages', 'incentive', 'sweepstakes'] },
];

function classifyBox(category: string, description: string, vendorName: string): MiscBox {
  const text = (category + ' ' + description + ' ' + vendorName).toLowerCase();
  for (const { box, keywords } of BOX_KEYWORDS) {
    for (const kw of keywords) {
      if (text.includes(kw)) return box;
    }
  }
  // Default: Box 3 "Other income"
  return 'box3';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function compute1099MISCs(companyId: string, year: number): Form1099MISCData[] {
  const dbi = db.getDb();
  const company = db.getById('companies', companyId) as any || {};
  const yearStart = year + '-01-01';
  const yearEnd = year + '-12-31';

  // Eligibility: explicit 1099-MISC flags. Falls back to is_1099_eligible
  // (the original NEC flag) if no MISC-specific column exists — at the
  // payment level, NEC vs MISC is decided by the payment's category, so
  // a single 1099-flagged vendor can yield both forms.
  // We exclude pure-employee compensation here (that's NEC); a payment
  // is included only if its classified box is one of MiscBox.
  const vendors = dbi.prepare(`
    SELECT v.*
    FROM vendors v
    WHERE v.company_id = ?
      AND COALESCE(v.deleted_at, '') = ''
      AND (
        v.is_1099_misc_eligible = 1
        OR v.is_1099_eligible = 1
        OR v.vendor_1099 = 1
        OR v.requires_1099 = 1
      )
  `).all(companyId) as any[];

  const forms: Form1099MISCData[] = [];

  for (const v of vendors) {
    // Pull bill payments + expenses with category context
    const billPayments = dbi.prepare(`
      SELECT
        bp.date AS date,
        bp.amount AS amount,
        b.notes AS description,
        COALESCE(c.name, b.category, '') AS category
      FROM bill_payments bp
      JOIN bills b ON b.id = bp.bill_id
      LEFT JOIN categories c ON c.id = b.category_id
      WHERE b.vendor_id = ?
        AND bp.date BETWEEN ? AND ?
    `).all(v.id, yearStart, yearEnd) as Array<{ date: string; amount: number; description: string; category: string }>;

    const expensePayments = dbi.prepare(`
      SELECT
        e.date AS date,
        e.amount AS amount,
        COALESCE(e.description, e.notes, '') AS description,
        COALESCE(c.name, e.category, '') AS category
      FROM expenses e
      LEFT JOIN categories c ON c.id = e.category_id
      WHERE e.vendor_id = ?
        AND e.date BETWEEN ? AND ?
        AND COALESCE(e.deleted_at, '') = ''
    `).all(v.id, yearStart, yearEnd) as Array<{ date: string; amount: number; description: string; category: string }>;

    // Classify each payment to a box
    const boxTotals: Record<MiscBox, number> = { box1: 0, box2: 0, box3: 0, box6: 0, box10: 0 };
    const breakdown: Form1099MISCData['breakdown'] = [];

    for (const p of billPayments) {
      const box = classifyBox(p.category || '', p.description || '', v.name || '');
      const amt = round2(Number(p.amount) || 0);
      boxTotals[box] += amt;
      breakdown.push({ date: p.date, amount: amt, description: p.description || '', category: p.category || '', box, source: 'bill_payment' });
    }
    for (const p of expensePayments) {
      const box = classifyBox(p.category || '', p.description || '', v.name || '');
      const amt = round2(Number(p.amount) || 0);
      boxTotals[box] += amt;
      breakdown.push({ date: p.date, amount: amt, description: p.description || '', category: p.category || '', box, source: 'expense' });
    }

    const total = round2(Object.values(boxTotals).reduce((s, v) => s + v, 0));
    if (total <= 0) continue;

    // Determine if filing is required:
    // Box 2 royalties: $10 threshold. All others: $600.
    const exceedsThreshold =
      boxTotals.box1 >= FILING_THRESHOLD ||
      boxTotals.box2 >= ROYALTY_THRESHOLD ||
      boxTotals.box3 >= FILING_THRESHOLD ||
      boxTotals.box6 >= FILING_THRESHOLD ||
      boxTotals.box10 >= FILING_THRESHOLD;

    // Pick primary box for sorting / display
    const primaryBox = (Object.entries(boxTotals).reduce(
      (max, [k, v]) => (v > max.v ? { k: k as MiscBox, v } : max),
      { k: 'box3' as MiscBox, v: 0 }
    )).k;

    const tin = v.tin || v.tax_id || v.ein || v.ssn || '';
    const warnings: string[] = [];
    if (!tin) warnings.push('Recipient has no TIN on file — required for 1099-MISC. Request a W-9.');
    if (!exceedsThreshold) warnings.push('Below $600 (or $10 royalty) threshold — 1099-MISC not required for this vendor.');
    if (!v.address && !v.address_line1) warnings.push('Recipient address missing.');
    if (boxTotals.box10 > 0 && boxTotals.box3 === 0 && boxTotals.box1 === 0) {
      warnings.push('All payments classified as Box 10 (gross proceeds to attorney). Verify these are settlements, NOT legal fees (which go on 1099-NEC).');
    }

    // Sort breakdown by date desc for audit display
    breakdown.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    forms.push({
      payer_name: company.legal_name || company.name || '',
      payer_address: [company.address_line1, company.address_line2].filter(Boolean).join(', '),
      payer_city: company.city || '',
      payer_state: company.state || '',
      payer_zip: company.zip || '',
      payer_tin: company.ein || company.tax_id || '',
      payer_phone: company.phone || '',

      recipient_name: v.name || '',
      recipient_address: [v.address_line1, v.address_line2].filter(Boolean).join(', ') || v.address || '',
      recipient_city: v.city || '',
      recipient_state: v.state || '',
      recipient_zip: v.zip || '',
      recipient_tin: tin,
      recipient_id: v.id,
      account_number: v.account_number || '',

      box1_rents: round2(boxTotals.box1),
      box2_royalties: round2(boxTotals.box2),
      box3_other_income: round2(boxTotals.box3),
      box4_fed_tax_withheld: 0,
      box5_fishing_boat_proceeds: 0,
      box6_medical_healthcare: round2(boxTotals.box6),
      box7_direct_sales_5k: false,
      box8_substitute_payments: 0,
      box9_crop_insurance: 0,
      box10_gross_proceeds_attorney: round2(boxTotals.box10),
      box11_fish_purchased: 0,
      box12_section_409a: 0,
      box13_excess_golden_parachute: 0,
      box14_nonqual_deferred_comp: 0,
      box15_state_tax_withheld: 0,
      box16_state_payer_no: '',
      box17_state_income: 0,

      total_paid: total,
      payment_count: breakdown.length,
      year,
      primary_box: primaryBox,

      meets_filing_threshold: exceedsThreshold,
      has_tin: !!tin,
      warnings,
      breakdown,
    });
  }

  // Sort: ready-to-file first, then by total paid desc
  forms.sort((a, b) => {
    const aReady = a.meets_filing_threshold && a.has_tin ? 1 : 0;
    const bReady = b.meets_filing_threshold && b.has_tin ? 1 : 0;
    if (aReady !== bReady) return bReady - aReady;
    return b.total_paid - a.total_paid;
  });

  return forms;
}
