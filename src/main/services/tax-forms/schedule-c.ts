// src/main/services/tax-forms/schedule-c.ts
//
// IRS Form 1040 Schedule C — Profit or Loss from Business (Sole Proprietor).
//
// Maps the company's invoice income + expense categories to the
// numbered lines on Schedule C. Returns a structured object the
// PDF renderer can fill in.
//
// Sources:
//   • https://www.irs.gov/forms-pubs/about-schedule-c-form-1040
//
// Mapping strategy:
//   Category names are user-defined, so we use keyword pattern
//   matching to bucket each expense into a Schedule C line.
//   Users can override by editing categories[].schedule_c_line
//   in a future enhancement.

import * as db from '../../database';

export interface ScheduleCData {
  // Filing identity
  taxpayer_name: string;
  taxpayer_ssn: string;
  business_name: string;
  business_code: string;       // 6-digit NAICS-equivalent
  ein: string;                  // optional — sole props often have only SSN
  address: string;
  city: string;
  state: string;
  zip: string;
  accounting_method: 'cash' | 'accrual' | 'other';
  year: number;

  // Part I — Income
  line1_gross_receipts: number;
  line2_returns_allowances: number;
  line3_subtract: number;       // 1 - 2
  line4_cogs: number;
  line5_gross_profit: number;   // 3 - 4
  line6_other_income: number;   // bank interest, refunds, etc.
  line7_gross_income: number;   // 5 + 6

  // Part II — Expenses
  line8_advertising: number;
  line9_car_truck: number;       // mileage_log + vehicle expenses
  line10_commissions_fees: number;
  line11_contract_labor: number; // 1099 contractors
  line12_depletion: number;
  line13_depreciation: number;   // from fixed_assets module
  line14_employee_benefits: number;
  line15_insurance: number;
  line16a_mortgage_interest: number;
  line16b_other_interest: number; // loans
  line17_legal_professional: number;
  line18_office_expense: number;
  line19_pension_profit_sharing: number;
  line20a_rent_vehicles_machinery: number;
  line20b_rent_other: number;
  line21_repairs_maintenance: number;
  line22_supplies: number;
  line23_taxes_licenses: number;
  line24a_travel: number;
  line24b_meals: number;          // 50% deductible automatically applied
  line25_utilities: number;
  line26_wages: number;
  line27a_other_expenses: Array<{ description: string; amount: number }>;
  line27b_other_total: number;
  line28_total_expenses: number;
  line29_tentative_profit: number; // 7 - 28
  line30_home_office: number;
  line31_net_profit: number;     // 29 - 30

  // Part III — COGS detail (optional; only if line 4 > 0)
  line33_method: 'cost' | 'lcm' | 'other'; // valuation method
  line34_change_method: boolean;
  line35_inventory_start: number;
  line36_purchases: number;
  line37_cost_labor: number;
  line38_materials: number;
  line39_other_costs: number;
  line40_subtotal: number;
  line41_inventory_end: number;
  line42_cogs_total: number;     // copies to line 4

  // Computation metadata
  expense_count: number;
  invoice_count: number;
  uncategorized_total: number;   // expenses we couldn't bucket → flagged
}

// Keyword → Schedule C line mapping. Category name lowercased then
// matched against these keyword arrays. First match wins.
const SCHEDULE_C_KEYWORDS: Array<{ line: keyof ScheduleCData; keywords: string[] }> = [
  { line: 'line8_advertising', keywords: ['advertising', 'marketing', 'promotion', 'ads', 'social media'] },
  { line: 'line9_car_truck', keywords: ['vehicle', 'gas', 'fuel', 'auto', 'car', 'truck', 'mileage'] },
  { line: 'line10_commissions_fees', keywords: ['commission', 'referral fee', 'broker'] },
  { line: 'line11_contract_labor', keywords: ['contractor', 'subcontractor', '1099', 'freelance'] },
  { line: 'line13_depreciation', keywords: ['depreciation', 'amortization'] },
  { line: 'line14_employee_benefits', keywords: ['employee benefit', 'health insurance', '401k match', 'fringe benefit'] },
  { line: 'line15_insurance', keywords: ['insurance', 'liability', 'workers comp', 'errors omissions'] },
  { line: 'line16b_other_interest', keywords: ['interest expense', 'loan interest'] },
  { line: 'line17_legal_professional', keywords: ['legal', 'attorney', 'accountant', 'consulting', 'professional service', 'tax prep', 'cpa'] },
  { line: 'line18_office_expense', keywords: ['office expense', 'office supplies', 'stationery'] },
  { line: 'line20b_rent_other', keywords: ['rent', 'lease'] },
  { line: 'line21_repairs_maintenance', keywords: ['repair', 'maintenance'] },
  { line: 'line22_supplies', keywords: ['supplies', 'materials'] },
  { line: 'line23_taxes_licenses', keywords: ['tax', 'license', 'permit', 'registration'] },
  { line: 'line24a_travel', keywords: ['travel', 'hotel', 'flight', 'airline', 'lodging'] },
  { line: 'line24b_meals', keywords: ['meal', 'restaurant', 'lunch', 'dinner', 'food'] },
  { line: 'line25_utilities', keywords: ['utility', 'electric', 'phone', 'internet', 'water', 'gas bill'] },
  { line: 'line26_wages', keywords: ['wages', 'salary', 'payroll'] },
];

const ZERO_LINES: Partial<ScheduleCData> = {
  line8_advertising: 0, line9_car_truck: 0, line10_commissions_fees: 0,
  line11_contract_labor: 0, line12_depletion: 0, line13_depreciation: 0,
  line14_employee_benefits: 0, line15_insurance: 0, line16a_mortgage_interest: 0,
  line16b_other_interest: 0, line17_legal_professional: 0, line18_office_expense: 0,
  line19_pension_profit_sharing: 0, line20a_rent_vehicles_machinery: 0,
  line20b_rent_other: 0, line21_repairs_maintenance: 0, line22_supplies: 0,
  line23_taxes_licenses: 0, line24a_travel: 0, line24b_meals: 0,
  line25_utilities: 0, line26_wages: 0, line27b_other_total: 0,
};

function bucketCategory(categoryName: string): keyof ScheduleCData | null {
  const lc = (categoryName || '').toLowerCase();
  if (!lc) return null;
  for (const { line, keywords } of SCHEDULE_C_KEYWORDS) {
    if (keywords.some((kw) => lc.includes(kw))) return line;
  }
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeScheduleC(companyId: string, year: number): ScheduleCData {
  const dbi = db.getDb();
  const company = db.getById('companies', companyId) as any || {};
  const yearStart = year + '-01-01';
  const yearEnd = year + '-12-31';

  // ── Income: paid invoice amounts in the year ──
  const invoiceData = dbi.prepare(`
    SELECT COALESCE(SUM(amount_paid), 0) AS gross_receipts,
           COUNT(*) AS invoice_count
    FROM invoices
    WHERE company_id = ?
      AND issue_date BETWEEN ? AND ?
      AND COALESCE(deleted_at, '') = ''
  `).get(companyId, yearStart, yearEnd) as any;

  // Credit notes / refunds — invoice_type = 'credit_note' OR negative invoice totals
  const refunds = (dbi.prepare(`
    SELECT COALESCE(SUM(ABS(amount_paid)), 0) AS total
    FROM invoices
    WHERE company_id = ?
      AND issue_date BETWEEN ? AND ?
      AND invoice_type = 'credit_note'
      AND COALESCE(deleted_at, '') = ''
  `).get(companyId, yearStart, yearEnd) as any)?.total || 0;

  // ── Expenses by category ──
  const expenses = dbi.prepare(`
    SELECT e.amount, c.name AS category_name
    FROM expenses e
    LEFT JOIN categories c ON c.id = e.category_id
    WHERE e.company_id = ?
      AND e.date BETWEEN ? AND ?
      AND COALESCE(e.deleted_at, '') = ''
  `).all(companyId, yearStart, yearEnd) as Array<{ amount: number; category_name: string | null }>;

  const result: ScheduleCData = {
    taxpayer_name: company.owner_name || '',
    taxpayer_ssn: '', // never auto-filled — user must enter
    business_name: company.name || '',
    business_code: company.business_code || '',
    ein: company.ein || '',
    address: company.address_line1 || '',
    city: company.city || '',
    state: company.state || '',
    zip: company.zip || '',
    accounting_method: 'cash',
    year,

    line1_gross_receipts: round2(Number(invoiceData?.gross_receipts) || 0),
    line2_returns_allowances: round2(refunds),
    line3_subtract: 0,
    line4_cogs: 0,
    line5_gross_profit: 0,
    line6_other_income: 0,
    line7_gross_income: 0,

    ...ZERO_LINES as any,

    line27a_other_expenses: [],
    line28_total_expenses: 0,
    line29_tentative_profit: 0,
    line30_home_office: 0,
    line31_net_profit: 0,

    line33_method: 'cost',
    line34_change_method: false,
    line35_inventory_start: 0,
    line36_purchases: 0,
    line37_cost_labor: 0,
    line38_materials: 0,
    line39_other_costs: 0,
    line40_subtotal: 0,
    line41_inventory_end: 0,
    line42_cogs_total: 0,

    expense_count: expenses.length,
    invoice_count: Number(invoiceData?.invoice_count) || 0,
    uncategorized_total: 0,
  };

  // Bucket each expense
  const otherBucket: Record<string, number> = {};
  for (const e of expenses) {
    const amt = round2(Number(e.amount) || 0);
    if (!amt) continue;
    const line = bucketCategory(e.category_name || '');
    if (line) {
      // Special case: meals are 50% deductible
      if (line === 'line24b_meals') {
        (result as any)[line] = round2(((result as any)[line] as number) + amt * 0.5);
      } else {
        (result as any)[line] = round2(((result as any)[line] as number) + amt);
      }
    } else {
      // Group uncategorized into "other" bucket by category_name
      const key = e.category_name || '(Uncategorized)';
      otherBucket[key] = round2((otherBucket[key] || 0) + amt);
    }
  }

  // Promote "other" bucket to line 27a
  for (const [desc, amt] of Object.entries(otherBucket)) {
    result.line27a_other_expenses.push({ description: desc, amount: amt });
  }
  result.line27b_other_total = round2(
    result.line27a_other_expenses.reduce((s, x) => s + x.amount, 0)
  );
  result.uncategorized_total = result.line27b_other_total;

  // Compute totals
  result.line3_subtract = round2(result.line1_gross_receipts - result.line2_returns_allowances);
  result.line5_gross_profit = round2(result.line3_subtract - result.line4_cogs);
  result.line7_gross_income = round2(result.line5_gross_profit + result.line6_other_income);

  // Sum all expense lines
  const expenseLines: Array<keyof ScheduleCData> = [
    'line8_advertising', 'line9_car_truck', 'line10_commissions_fees',
    'line11_contract_labor', 'line12_depletion', 'line13_depreciation',
    'line14_employee_benefits', 'line15_insurance', 'line16a_mortgage_interest',
    'line16b_other_interest', 'line17_legal_professional', 'line18_office_expense',
    'line19_pension_profit_sharing', 'line20a_rent_vehicles_machinery',
    'line20b_rent_other', 'line21_repairs_maintenance', 'line22_supplies',
    'line23_taxes_licenses', 'line24a_travel', 'line24b_meals',
    'line25_utilities', 'line26_wages', 'line27b_other_total',
  ];
  result.line28_total_expenses = round2(
    expenseLines.reduce((s, k) => s + ((result as any)[k] as number || 0), 0)
  );
  result.line29_tentative_profit = round2(result.line7_gross_income - result.line28_total_expenses);
  result.line31_net_profit = round2(result.line29_tentative_profit - result.line30_home_office);

  return result;
}
