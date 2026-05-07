// src/main/services/tax-forms/entity-return-shared.ts
//
// Shared helpers for entity income tax returns (Form 1065 / 1120 /
// 1120-S / 1041). All four pull from the same chart-of-accounts trial
// balance with category mappings to the standard line items.
//
// The big idea: each return has an "income" half and a "deduction"
// half, plus optional Schedule L (balance sheet) and Schedule M-1
// (book vs tax reconciliation). The income/deduction mapping shape
// is identical across the four — what varies is the line numbering
// and which extra items appear (e.g., 1120 has Schedule J for tax
// computation, 1065 has Schedule K for partner allocations).

import * as db from '../../database';

export interface TrialBalanceMap {
  // Revenue
  gross_receipts: number;
  returns_allowances: number;
  cogs: number;
  // Other income
  interest_income: number;
  dividend_income: number;
  rental_income: number;
  royalty_income: number;
  capital_gains: number;
  other_income: number;
  // Deductions
  officer_compensation: number;          // 1120 only
  salaries_wages: number;
  guaranteed_payments_partners: number;   // 1065 only
  repairs_maintenance: number;
  bad_debts: number;
  rent: number;
  taxes_licenses: number;
  interest_expense: number;
  charitable_contributions: number;
  depreciation: number;
  depletion: number;
  advertising: number;
  pension_profit_sharing: number;
  employee_benefits: number;
  other_deductions: number;
  // Aggregates
  total_income: number;
  total_deductions: number;
  net_income: number;                      // total_income - total_deductions
}

export function buildTrialBalanceMap(companyId: string, year: number): TrialBalanceMap {
  const dbi = db.getDb();
  const yearStart = year + '-01-01';
  const yearEnd = year + '-12-31';

  // Helper: sum amounts by category keyword. We try to match category
  // name patterns commonly used in our chart of accounts.
  const sumByKeyword = (table: 'invoices' | 'expenses', column: string, keywords: string[]): number => {
    try {
      const placeholders = keywords.map(() => 'LOWER(COALESCE(c.name, e.category, "")) LIKE ?').join(' OR ');
      const params = keywords.map((k) => '%' + k + '%');
      if (table === 'invoices') {
        const r = dbi.prepare(`
          SELECT COALESCE(SUM(${column}), 0) AS total
          FROM invoices i
          WHERE i.company_id = ?
            AND i.issue_date BETWEEN ? AND ?
            AND COALESCE(i.deleted_at, '') = ''
        `).get(companyId, yearStart, yearEnd) as any;
        return Number(r?.total) || 0;
      }
      const r = dbi.prepare(`
        SELECT COALESCE(SUM(e.amount), 0) AS total
        FROM expenses e
        LEFT JOIN categories c ON c.id = e.category_id
        WHERE e.company_id = ?
          AND e.date BETWEEN ? AND ?
          AND COALESCE(e.deleted_at, '') = ''
          AND (${placeholders})
      `).get(companyId, yearStart, yearEnd, ...params) as any;
      return Number(r?.total) || 0;
    } catch { return 0; }
  };

  // Gross receipts: sum of all paid + sent invoices
  let grossReceipts = 0;
  try {
    const r = dbi.prepare(`
      SELECT COALESCE(SUM(i.subtotal), 0) AS total
      FROM invoices i
      WHERE i.company_id = ?
        AND i.issue_date BETWEEN ? AND ?
        AND i.status NOT IN ('voided', 'cancelled', 'draft')
        AND COALESCE(i.deleted_at, '') = ''
    `).get(companyId, yearStart, yearEnd) as any;
    grossReceipts = Number(r?.total) || 0;
  } catch { /* legacy schema */ }

  // Total expenses (uncategorized fallback)
  let totalExpenses = 0;
  try {
    const r = dbi.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM expenses
      WHERE company_id = ?
        AND date BETWEEN ? AND ?
        AND COALESCE(deleted_at, '') = ''
    `).get(companyId, yearStart, yearEnd) as any;
    totalExpenses = Number(r?.total) || 0;
  } catch { /* schema variant */ }

  // Map categories → return lines (using keyword matches)
  const cogs = sumByKeyword('expenses', 'amount', ['cogs', 'cost of goods', 'cost of sales', 'inventory']);
  const interestIncome = sumByKeyword('expenses', 'amount', ['interest income']);  // rare in expenses table
  const dividendIncome = sumByKeyword('expenses', 'amount', ['dividend']);
  const rentalIncome = sumByKeyword('expenses', 'amount', ['rental income']);
  const royaltyIncome = sumByKeyword('expenses', 'amount', ['royalty income']);
  const capitalGains = 0;   // From Schedule D — manual

  const officerComp = sumByKeyword('expenses', 'amount', ['officer compensation', 'officer salary']);
  const salariesWages = sumByKeyword('expenses', 'amount', ['salaries', 'wages', 'payroll']);
  const guaranteedPayments = sumByKeyword('expenses', 'amount', ['guaranteed payment']);
  const repairs = sumByKeyword('expenses', 'amount', ['repair', 'maintenance']);
  const badDebts = sumByKeyword('expenses', 'amount', ['bad debt']);
  const rent = sumByKeyword('expenses', 'amount', ['rent', 'lease']);
  const taxes = sumByKeyword('expenses', 'amount', ['tax', 'license', 'permit']);
  const interestExpense = sumByKeyword('expenses', 'amount', ['interest expense']);
  const charitable = sumByKeyword('expenses', 'amount', ['charity', 'charitable', 'donation']);
  const depreciation = sumByKeyword('expenses', 'amount', ['depreciation']);
  const depletion = sumByKeyword('expenses', 'amount', ['depletion']);
  const advertising = sumByKeyword('expenses', 'amount', ['advertising', 'marketing']);
  const pension = sumByKeyword('expenses', 'amount', ['pension', '401k', 'retirement plan']);
  const empBenefits = sumByKeyword('expenses', 'amount', ['employee benefit', 'health insurance']);

  // "Other deductions" = total expenses minus everything else
  const categorized = cogs + officerComp + salariesWages + guaranteedPayments + repairs + badDebts +
    rent + taxes + interestExpense + charitable + depreciation + depletion + advertising +
    pension + empBenefits;
  const otherDeductions = Math.max(0, totalExpenses - categorized);

  const totalIncome = grossReceipts + interestIncome + dividendIncome + rentalIncome +
    royaltyIncome + capitalGains - cogs;
  const totalDeductions = officerComp + salariesWages + guaranteedPayments + repairs + badDebts +
    rent + taxes + interestExpense + charitable + depreciation + depletion + advertising +
    pension + empBenefits + otherDeductions;
  const netIncome = totalIncome - totalDeductions;

  return {
    gross_receipts: round2(grossReceipts),
    returns_allowances: 0,
    cogs: round2(cogs),
    interest_income: round2(interestIncome),
    dividend_income: round2(dividendIncome),
    rental_income: round2(rentalIncome),
    royalty_income: round2(royaltyIncome),
    capital_gains: round2(capitalGains),
    other_income: 0,
    officer_compensation: round2(officerComp),
    salaries_wages: round2(salariesWages),
    guaranteed_payments_partners: round2(guaranteedPayments),
    repairs_maintenance: round2(repairs),
    bad_debts: round2(badDebts),
    rent: round2(rent),
    taxes_licenses: round2(taxes),
    interest_expense: round2(interestExpense),
    charitable_contributions: round2(charitable),
    depreciation: round2(depreciation),
    depletion: round2(depletion),
    advertising: round2(advertising),
    pension_profit_sharing: round2(pension),
    employee_benefits: round2(empBenefits),
    other_deductions: round2(otherDeductions),
    total_income: round2(totalIncome),
    total_deductions: round2(totalDeductions),
    net_income: round2(netIncome),
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface PartnerOrShareholder {
  id: string;
  name: string;
  ssn_or_ein: string;
  ownership_pct: number;     // 0-100
  // For 1065 partnerships, also general vs limited partner
  is_general_partner?: boolean;
  // For 1120-S, classification doesn't apply (all are equal-class shareholders)
}
