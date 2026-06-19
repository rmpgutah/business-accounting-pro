// src/main/services/TaxCalculationEngine.ts
// Core tax calculation engine for payroll — federal withholding, Utah withholding,
// FICA (SS + Medicare), FUTA, and SUI. All money outputs use db.roundCents().
// Every DB read is wrapped in try/catch with hardcoded fallbacks so payroll never crashes.

import * as db from '../database';

// ─── Exported Types ────────────────────────────────────────────────────────────

export interface W4Fields {
  w4_filing_status: 'single' | 'married' | 'head_of_household';
  w4_step2_checkbox: boolean;
  w4_step3_dependent_credit: number;
  w4_step4a_other_income: number;
  w4_step4b_deductions: number;
  w4_step4c_extra_withholding: number;
}

export interface UtahFields {
  ut_exemptions: number;
  ut_additional_withholding: number;
}

export interface FICAResult {
  ss_employee: number;
  ss_employer: number;
  medicare_employee: number;
  medicare_employer: number;
  additional_medicare: number;
  futa: number;
}

export interface FullTaxResult {
  federal_withholding: number;
  utah_withholding: number;
  ss_employee: number;
  ss_employer: number;
  medicare_employee: number;
  medicare_employer: number;
  additional_medicare: number;
  futa: number;
  sui: number;
  total_employee_tax: number;
  total_employer_tax: number;
}

// ─── Internal Types ────────────────────────────────────────────────────────────

interface FederalConstants {
  ss_wage_base: number;
  ss_rate: number;
  medicare_rate: number;
  medicare_additional_rate: number;
  medicare_additional_threshold_single: number;
  medicare_additional_threshold_married: number;
  futa_rate: number;
  futa_wage_base: number;
  standard_deduction_single: number;
  standard_deduction_married: number;
  standard_deduction_hoh: number;
}

interface TaxBracket {
  bracket_min: number;
  bracket_max: number | null;
  rate: number;
}

interface UtahConfig {
  flat_rate: number;
  personal_exemption_credit: number;
  sui_rate: number;
  sui_wage_base: number;
}

type PayFrequency = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';

// ─── Constants ─────────────────────────────────────────────────────────────────

const PAY_PERIODS_MAP: Record<PayFrequency, number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
};

const DEFAULT_YEAR = 2026;

// Hardcoded 2026 projected federal constants (fallback when DB is empty)
const FALLBACK_CONSTANTS: FederalConstants = {
  ss_wage_base: 182100,
  ss_rate: 0.062,
  medicare_rate: 0.0145,
  medicare_additional_rate: 0.009,
  medicare_additional_threshold_single: 200000,
  medicare_additional_threshold_married: 250000,
  futa_rate: 0.006,
  futa_wage_base: 7000,
  standard_deduction_single: 15700,
  standard_deduction_married: 31400,
  standard_deduction_hoh: 23500,
};

// Hardcoded 2026 projected federal brackets (fallback when DB is empty)
const FALLBACK_BRACKETS_SINGLE: TaxBracket[] = [
  { bracket_min: 0,      bracket_max: 11925,   rate: 0.10 },
  { bracket_min: 11925,  bracket_max: 48475,   rate: 0.12 },
  { bracket_min: 48475,  bracket_max: 103350,  rate: 0.22 },
  { bracket_min: 103350, bracket_max: 197300,  rate: 0.24 },
  { bracket_min: 197300, bracket_max: 250525,  rate: 0.32 },
  { bracket_min: 250525, bracket_max: 626350,  rate: 0.35 },
  { bracket_min: 626350, bracket_max: null,     rate: 0.37 },
];

const FALLBACK_BRACKETS_MARRIED: TaxBracket[] = [
  { bracket_min: 0,       bracket_max: 23850,   rate: 0.10 },
  { bracket_min: 23850,   bracket_max: 96950,   rate: 0.12 },
  { bracket_min: 96950,   bracket_max: 206700,  rate: 0.22 },
  { bracket_min: 206700,  bracket_max: 394600,  rate: 0.24 },
  { bracket_min: 394600,  bracket_max: 501050,  rate: 0.32 },
  { bracket_min: 501050,  bracket_max: 751600,  rate: 0.35 },
  { bracket_min: 751600,  bracket_max: null,     rate: 0.37 },
];

const FALLBACK_BRACKETS_HOH: TaxBracket[] = [
  { bracket_min: 0,       bracket_max: 17000,   rate: 0.10 },
  { bracket_min: 17000,   bracket_max: 64850,   rate: 0.12 },
  { bracket_min: 64850,   bracket_max: 103350,  rate: 0.22 },
  { bracket_min: 103350,  bracket_max: 197300,  rate: 0.24 },
  { bracket_min: 197300,  bracket_max: 250500,  rate: 0.32 },
  { bracket_min: 250500,  bracket_max: 626350,  rate: 0.35 },
  { bracket_min: 626350,  bracket_max: null,     rate: 0.37 },
];

// Fallback Utah withholding config
const FALLBACK_UTAH_CONFIG: UtahConfig = {
  flat_rate: 0.0455,
  personal_exemption_credit: 393,
  sui_rate: 0.012,
  sui_wage_base: 44800,
};

// ─── Internal Helpers ──────────────────────────────────────────────────────────

function getConstants(year: number): FederalConstants {
  try {
    const row = db.getDb().prepare(
      `SELECT ss_wage_base, ss_rate, medicare_rate, medicare_additional_rate,
              medicare_additional_threshold_single, medicare_additional_threshold_married,
              futa_rate, futa_wage_base, standard_deduction_single,
              standard_deduction_married, standard_deduction_hoh
       FROM federal_payroll_constants WHERE tax_year = ?`
    ).get(year) as FederalConstants | undefined;
    if (row) return row;
  } catch (e) {
    console.warn('[TaxCalculationEngine] Failed to read federal_payroll_constants, using fallback:', e);
  }
  return FALLBACK_CONSTANTS;
}

function getBrackets(year: number, filingStatus: W4Fields['w4_filing_status']): TaxBracket[] {
  // Map W-4 filing status to DB filing_status values
  const dbStatus = filingStatus === 'married' ? 'married_jointly' : filingStatus;

  try {
    const rows = db.getDb().prepare(
      `SELECT bracket_min, bracket_max, rate
       FROM federal_tax_brackets
       WHERE tax_year = ? AND filing_status = ?
       ORDER BY bracket_min ASC`
    ).all(year, dbStatus) as TaxBracket[];
    if (rows && rows.length > 0) return rows;
  } catch (e) {
    console.warn('[TaxCalculationEngine] Failed to read federal_tax_brackets, using fallback:', e);
  }

  // Return hardcoded fallback brackets based on filing status
  if (filingStatus === 'married') return FALLBACK_BRACKETS_MARRIED;
  if (filingStatus === 'head_of_household') return FALLBACK_BRACKETS_HOH;
  return FALLBACK_BRACKETS_SINGLE;
}

function getUtahConfig(companyId: string, year: number): UtahConfig {
  try {
    const row = db.getDb().prepare(
      `SELECT flat_rate, personal_exemption_credit, sui_rate, sui_wage_base
       FROM utah_withholding_config
       WHERE company_id = ? AND tax_year = ?`
    ).get(companyId, year) as UtahConfig | undefined;
    if (row) return row;
  } catch (e) {
    console.warn('[TaxCalculationEngine] Failed to read utah_withholding_config, using fallback:', e);
  }
  return FALLBACK_UTAH_CONFIG;
}

/**
 * Apply progressive bracket calculation to taxable income.
 * Brackets must be sorted by bracket_min ascending.
 */
function applyBrackets(taxableIncome: number, brackets: TaxBracket[], step2Halve: boolean): number {
  let tax = 0;
  for (const b of brackets) {
    const min = step2Halve ? b.bracket_min / 2 : b.bracket_min;
    const max = b.bracket_max !== null ? (step2Halve ? b.bracket_max / 2 : b.bracket_max) : null;

    if (taxableIncome <= min) break;

    const taxableInBracket = max !== null
      ? Math.min(taxableIncome, max) - min
      : taxableIncome - min;

    tax += taxableInBracket * b.rate;
  }
  return tax;
}

// ─── Exported Functions ────────────────────────────────────────────────────────

/**
 * Calculate federal income tax withholding per pay period.
 * IRS Publication 15-T, 2020+ W-4 Percentage Method.
 *
 * Steps:
 * 1. Annualize gross pay
 * 2. Subtract standard deduction (adjusted by Step 4b deductions)
 * 3. Add Step 4a other income
 * 4. Apply bracket table (halve thresholds if Step 2 checkbox)
 * 5. Subtract Step 3 dependent credit
 * 6. Add Step 4c extra withholding
 * 7. De-annualize
 */
export function calculateFederalWithholding(
  grossPerPeriod: number,
  payFrequency: PayFrequency,
  w4: W4Fields,
  year: number = DEFAULT_YEAR
): number {
  const periods = PAY_PERIODS_MAP[payFrequency] || 26;
  const constants = getConstants(year);
  const brackets = getBrackets(year, w4.w4_filing_status);

  // Step 1: Annualize
  const annualGross = grossPerPeriod * periods;

  // Step 2: Standard deduction (adjusted by Step 4b)
  let standardDeduction: number;
  if (w4.w4_filing_status === 'married') {
    standardDeduction = constants.standard_deduction_married;
  } else if (w4.w4_filing_status === 'head_of_household') {
    standardDeduction = constants.standard_deduction_hoh;
  } else {
    standardDeduction = constants.standard_deduction_single;
  }
  const adjustedDeduction = standardDeduction + (w4.w4_step4b_deductions || 0);

  // Step 3: Adjusted annual wage = annualized gross - deductions + Step 4a
  const adjustedAnnualWage = annualGross - adjustedDeduction + (w4.w4_step4a_other_income || 0);
  const taxableIncome = Math.max(0, adjustedAnnualWage);

  // Step 4: Apply tax brackets (Step 2 checkbox halves thresholds)
  const annualTax = applyBrackets(taxableIncome, brackets, w4.w4_step2_checkbox);

  // Step 5: Subtract Step 3 dependent credit
  const afterCredits = Math.max(0, annualTax - (w4.w4_step3_dependent_credit || 0));

  // Step 6: De-annualize + add Step 4c extra withholding
  const perPeriodTax = afterCredits / periods + (w4.w4_step4c_extra_withholding || 0);

  return db.roundCents(Math.max(0, perPeriodTax));
}

/**
 * Calculate Utah state income tax withholding per pay period.
 * TC-40W method: (annualized_gross × flat_rate) − (exemptions × credit) → de-annualize
 * Plus any additional withholding from the employee's TC-40W.
 */
export function calculateUtahWithholding(
  grossPerPeriod: number,
  payFrequency: PayFrequency,
  utahFields: UtahFields,
  companyId: string,
  year: number = DEFAULT_YEAR
): number {
  const periods = PAY_PERIODS_MAP[payFrequency] || 26;
  const config = getUtahConfig(companyId, year);

  // Annualize
  const annualGross = grossPerPeriod * periods;

  // Calculate annual tax: gross × flat rate − (exemptions × credit)
  const annualTax = annualGross * config.flat_rate;
  const totalCredit = (utahFields.ut_exemptions || 0) * config.personal_exemption_credit;
  const netAnnualTax = Math.max(0, annualTax - totalCredit);

  // De-annualize + additional withholding
  const perPeriodTax = netAnnualTax / periods + (utahFields.ut_additional_withholding || 0);

  return db.roundCents(Math.max(0, perPeriodTax));
}

/**
 * Calculate FICA taxes (Social Security, Medicare, Additional Medicare, FUTA) for a pay period.
 * Handles mid-year wage base cap crossing for SS and FUTA.
 *
 * - SS: 6.2% employee + 6.2% employer up to wage base ($182,100 for 2026)
 * - Medicare: 1.45% employee + 1.45% employer on all wages
 * - Additional Medicare: 0.9% on wages above $200k YTD (employee only, employer does NOT match)
 * - FUTA: 0.6% employer-only on first $7,000 per employee per year
 */
export function calculateFICA(
  grossPerPeriod: number,
  ytdGross: number,
  year: number = DEFAULT_YEAR
): FICAResult {
  const constants = getConstants(year);

  // ── Social Security ──────────────────────────────────────
  // Only wages up to the SS wage base are subject to SS tax.
  // If employee already earned past the base, no SS on this period.
  const ssWagesThisPeriod = Math.max(0,
    Math.min(grossPerPeriod, constants.ss_wage_base - ytdGross)
  );
  const ss_employee = db.roundCents(ssWagesThisPeriod * constants.ss_rate);
  const ss_employer = db.roundCents(ssWagesThisPeriod * constants.ss_rate);

  // ── Medicare ─────────────────────────────────────────────
  const medicare_employee = db.roundCents(grossPerPeriod * constants.medicare_rate);
  const medicare_employer = db.roundCents(grossPerPeriod * constants.medicare_rate);

  // ── Additional Medicare (employee only) ──────────────────
  // 0.9% on wages above $200k YTD (using single threshold; married threshold
  // is used on the annual return, not payroll withholding per IRS rules)
  const threshold = constants.medicare_additional_threshold_single;
  let additionalMedicareWages = 0;
  if (ytdGross + grossPerPeriod > threshold) {
    // Wages in this period that exceed the threshold
    additionalMedicareWages = Math.max(0,
      Math.min(grossPerPeriod, ytdGross + grossPerPeriod - threshold)
    );
    // If YTD was already past threshold, all of this period's wages are subject
    if (ytdGross >= threshold) {
      additionalMedicareWages = grossPerPeriod;
    }
  }
  const additional_medicare = db.roundCents(additionalMedicareWages * constants.medicare_additional_rate);

  // ── FUTA (employer only) ─────────────────────────────────
  const futaWagesThisPeriod = Math.max(0,
    Math.min(grossPerPeriod, constants.futa_wage_base - ytdGross)
  );
  const futa = db.roundCents(futaWagesThisPeriod * constants.futa_rate);

  return {
    ss_employee,
    ss_employer,
    medicare_employee,
    medicare_employer,
    additional_medicare,
    futa,
  };
}

/**
 * Calculate Utah State Unemployment Insurance (SUI) for a pay period.
 * Employer-only tax: company's SUI rate × wages up to the SUI wage base.
 */
export function calculateSUI(
  grossPerPeriod: number,
  ytdGross: number,
  companyId: string,
  year: number = DEFAULT_YEAR
): number {
  const config = getUtahConfig(companyId, year);

  // Only wages up to the SUI wage base are subject
  const suiWagesThisPeriod = Math.max(0,
    Math.min(grossPerPeriod, config.sui_wage_base - ytdGross)
  );

  return db.roundCents(Math.max(0, suiWagesThisPeriod * config.sui_rate));
}

/**
 * Calculate complete payroll tax breakdown for a single pay period.
 * Orchestrates all tax calculations and returns full employee + employer breakdown.
 */
export function calculateFullPayroll(
  grossPerPeriod: number,
  payFrequency: PayFrequency,
  w4: W4Fields,
  utahFields: UtahFields,
  ytdGross: number,
  companyId: string,
  year: number = DEFAULT_YEAR
): FullTaxResult {
  const federal_withholding = calculateFederalWithholding(grossPerPeriod, payFrequency, w4, year);
  const utah_withholding = calculateUtahWithholding(grossPerPeriod, payFrequency, utahFields, companyId, year);
  const fica = calculateFICA(grossPerPeriod, ytdGross, year);
  const sui = calculateSUI(grossPerPeriod, ytdGross, companyId, year);

  const total_employee_tax = db.roundCents(
    federal_withholding +
    utah_withholding +
    fica.ss_employee +
    fica.medicare_employee +
    fica.additional_medicare
  );

  const total_employer_tax = db.roundCents(
    fica.ss_employer +
    fica.medicare_employer +
    fica.futa +
    sui
  );

  return {
    federal_withholding,
    utah_withholding,
    ss_employee: fica.ss_employee,
    ss_employer: fica.ss_employer,
    medicare_employee: fica.medicare_employee,
    medicare_employer: fica.medicare_employer,
    additional_medicare: fica.additional_medicare,
    futa: fica.futa,
    sui,
    total_employee_tax,
    total_employer_tax,
  };
}
