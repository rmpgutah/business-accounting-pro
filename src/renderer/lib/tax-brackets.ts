// src/renderer/lib/tax-brackets.ts
//
// Centralized federal tax data — single source of truth for both
// the payroll runner (per-period withholding) and the tax dashboard
// (annual estimated liability).
//
// Sources:
//   • IRS Rev. Proc. 2024-40 (2025 inflation adjustments)
//   • IRS Rev. Proc. 2025-32 (2026 inflation adjustments — projected
//     where final guidance hasn't been published; values match the
//     backend FALLBACK_CONSTANTS in TaxCalculationEngine.ts)
//   • IRS Pub. 15-T (annual) for withholding methods
//
// IMPORTANT — Pub 15-T methodology:
//   We use the "subtract std deduction, apply 1040 brackets" form,
//   which is mathematically equivalent to Pub 15-T's "subtract Step 1g
//   amount, apply Pub 15-T 0%-zone brackets" form within ~$30/yr in
//   the lowest bracket. For two-earner households (W-4 Step 2 checked)
//   the brackets AND the deduction halve — call calcFederalTaxAnnual
//   with `step2Halve = true`.

export type FilingStatus = 'single' | 'mfj' | 'hoh';

export interface Bracket {
  /** Lower bound of bracket (inclusive). */
  min: number;
  /** Upper bound (exclusive). `Infinity` for the top bracket. */
  max: number;
  /** Marginal rate as a decimal (e.g. 0.22 = 22%). */
  rate: number;
}

// ─── 2025 Federal Income Tax Brackets (Rev. Proc. 2024-40) ──
const FEDERAL_BRACKETS_2025: Record<FilingStatus, Bracket[]> = {
  single: [
    { min: 0,       max: 11925,    rate: 0.10 },
    { min: 11925,   max: 48475,    rate: 0.12 },
    { min: 48475,   max: 103350,   rate: 0.22 },
    { min: 103350,  max: 197300,   rate: 0.24 },
    { min: 197300,  max: 250525,   rate: 0.32 },
    { min: 250525,  max: 626350,   rate: 0.35 },
    { min: 626350,  max: Infinity, rate: 0.37 },
  ],
  mfj: [
    { min: 0,       max: 23850,    rate: 0.10 },
    { min: 23850,   max: 96950,    rate: 0.12 },
    { min: 96950,   max: 206700,   rate: 0.22 },
    { min: 206700,  max: 394600,   rate: 0.24 },
    { min: 394600,  max: 501050,   rate: 0.32 },
    { min: 501050,  max: 751600,   rate: 0.35 },
    { min: 751600,  max: Infinity, rate: 0.37 },
  ],
  hoh: [
    { min: 0,       max: 17000,    rate: 0.10 },
    { min: 17000,   max: 64850,    rate: 0.12 },
    { min: 64850,   max: 103350,   rate: 0.22 },
    { min: 103350,  max: 197300,   rate: 0.24 },
    { min: 197300,  max: 250500,   rate: 0.32 },
    { min: 250500,  max: 626350,   rate: 0.35 },
    { min: 626350,  max: Infinity, rate: 0.37 },
  ],
};

// ─── 2026 Federal Income Tax Brackets (projected; ~2.6% inflation) ──
const FEDERAL_BRACKETS_2026: Record<FilingStatus, Bracket[]> = {
  single: [
    { min: 0,       max: 12235,    rate: 0.10 },
    { min: 12235,   max: 49735,    rate: 0.12 },
    { min: 49735,   max: 106040,   rate: 0.22 },
    { min: 106040,  max: 202430,   rate: 0.24 },
    { min: 202430,  max: 257040,   rate: 0.32 },
    { min: 257040,  max: 642635,   rate: 0.35 },
    { min: 642635,  max: Infinity, rate: 0.37 },
  ],
  mfj: [
    { min: 0,       max: 24470,    rate: 0.10 },
    { min: 24470,   max: 99470,    rate: 0.12 },
    { min: 99470,   max: 212075,   rate: 0.22 },
    { min: 212075,  max: 404860,   rate: 0.24 },
    { min: 404860,  max: 514075,   rate: 0.32 },
    { min: 514075,  max: 771265,   rate: 0.35 },
    { min: 771265,  max: Infinity, rate: 0.37 },
  ],
  hoh: [
    { min: 0,       max: 17440,    rate: 0.10 },
    { min: 17440,   max: 66535,    rate: 0.12 },
    { min: 66535,   max: 106040,   rate: 0.22 },
    { min: 106040,  max: 202430,   rate: 0.24 },
    { min: 202430,  max: 257015,   rate: 0.32 },
    { min: 257015,  max: 642635,   rate: 0.35 },
    { min: 642635,  max: Infinity, rate: 0.37 },
  ],
};

// ─── 2025 / 2026 Standard Deductions ────────────────────────
//   2025: Rev. Proc. 2024-40
//   2026: projected (matches backend TaxCalculationEngine FALLBACK_CONSTANTS)
const STANDARD_DEDUCTION_2025: Record<FilingStatus, number> = {
  single: 15000,
  mfj: 30000,
  hoh: 22500,
};

const STANDARD_DEDUCTION_2026: Record<FilingStatus, number> = {
  single: 15700,
  mfj: 31400,
  hoh: 23500,
};

// ─── Per-year lookup tables ────────────────────────────────
const BRACKETS_BY_YEAR: Record<number, Record<FilingStatus, Bracket[]>> = {
  2025: FEDERAL_BRACKETS_2025,
  2026: FEDERAL_BRACKETS_2026,
};

const STANDARD_DEDUCTION_BY_YEAR: Record<number, Record<FilingStatus, number>> = {
  2025: STANDARD_DEDUCTION_2025,
  2026: STANDARD_DEDUCTION_2026,
};

/** Returns the most-recent year we have brackets for that is ≤ the requested year. */
function pickYear(year: number): number {
  const years = Object.keys(BRACKETS_BY_YEAR).map(Number).sort((a, b) => a - b);
  let chosen = years[0];
  for (const y of years) {
    if (y <= year) chosen = y;
  }
  return chosen;
}

// ─── FICA / Medicare ────────────────────────────────────────
// SSA Fact Sheet + IRC §3101. SS wage base is the only piece that changes
// year over year; the rates haven't changed since 1990.
export const SS_RATE = 0.062;            // employee + employer each
export const SS_WAGE_BASE_2025 = 176100; // 2025 OASDI taxable max
export const SS_WAGE_BASE_2026 = 182100; // 2026 projected
export const MEDICARE_RATE = 0.0145;
export const ADDL_MEDICARE_RATE = 0.009;        // 0.9% additional Medicare
export const ADDL_MEDICARE_THRESHOLD = 200000;  // employer withholds at $200k regardless of filing status

// ─── Runtime-overridable cache for DB-backed constants ─────
// FIX #10/#11: When these are populated from the DB (via setDbConstants),
// the sync getter functions below prefer DB values over hardcoded.
// The PayrollRunner calls setDbConstants at init time.
let _dbConstants: {
  ss_wage_base: number;
  ss_rate: number;
  medicare_rate: number;
  futa_rate: number;
  futa_wage_base: number;
  standard_deduction_single: number;
  standard_deduction_married: number;
  standard_deduction_hoh: number;
} | null = null;

/**
 * Override the hardcoded constants with values from the federal_payroll_constants
 * DB table. Call this at PayrollRunner init time. Pass null to restore defaults.
 */
export function setDbConstants(consts: typeof _dbConstants): void {
  _dbConstants = consts;
}

export function getSSWageBase(year: number = new Date().getFullYear()): number {
  if (_dbConstants?.ss_wage_base) return _dbConstants.ss_wage_base;
  if (year >= 2026) return SS_WAGE_BASE_2026;
  return SS_WAGE_BASE_2025;
}

export function getFutaRate(): number {
  return _dbConstants?.futa_rate ?? FUTA_RATE;
}

export function getFutaWageBase(): number {
  return _dbConstants?.futa_wage_base ?? FUTA_WAGE_BASE;
}

/**
 * Fetch SS wage base and other federal payroll constants from the database
 * (single source of truth). Falls back to hardcoded constants if the DB
 * isn't available (e.g. app startup or offline).
 *
 * FIX #10/#11: Prefer DB-backed constants over hardcoded values.
 * The DB is seeded via tax:seed-year which pulls actual IRS data.
 */
export async function fetchPayrollConstantsFromDb(year: number): Promise<typeof _dbConstants> {
  try {
    const { default: api } = await import('./api');
    const result = await api.taxGetPayrollConstants(year);
    if (result && !('error' in result)) {
      const c = result as any;
      _dbConstants = {
        ss_wage_base: c.ss_wage_base,
        ss_rate: c.ss_rate,
        medicare_rate: c.medicare_rate,
        futa_rate: c.futa_rate,
        futa_wage_base: c.futa_wage_base,
        standard_deduction_single: c.standard_deduction_single,
        standard_deduction_married: c.standard_deduction_married,
        standard_deduction_hoh: c.standard_deduction_hoh,
      };
      return _dbConstants;
    }
  } catch { /* ignore — fall back to hardcoded */ }
  return null;
}

// ─── FUTA ───────────────────────────────────────────────────
// IRS Form 940 instructions. $7,000 wage base has been stable since 1983.
export const FUTA_RATE = 0.006;       // post-credit (0.6%)
export const FUTA_WAGE_BASE = 7000;   // first $7,000 per employee per year

// ─── Helpers ────────────────────────────────────────────────

/**
 * Bracket-tax of an annual taxable income for a given filing status.
 *
 * @param annualTaxableIncome  Annualized wages AFTER standard-deduction subtraction
 * @param filing               Filing status from W-4
 * @param year                 Tax year — defaults to current calendar year
 * @param step2Halve           True when W-4 Step 2 box is checked (two-earner
 *                             household). Halves the bracket boundaries to
 *                             over-withhold, per IRS Pub 15-T "Higher Withholding"
 *                             tables.
 */
export function calcFederalTaxAnnual(
  annualTaxableIncome: number,
  filing: FilingStatus = 'single',
  year: number = new Date().getFullYear(),
  step2Halve: boolean = false,
): number {
  const brackets = BRACKETS_BY_YEAR[pickYear(year)][filing];
  let tax = 0;
  for (const b of brackets) {
    const min = step2Halve ? b.min / 2 : b.min;
    const max = b.max === Infinity ? Infinity : (step2Halve ? b.max / 2 : b.max);
    if (annualTaxableIncome <= min) break;
    const taxableInBracket = Math.min(annualTaxableIncome, max) - min;
    tax += taxableInBracket * b.rate;
  }
  return Math.max(0, tax);
}

/**
 * Returns the standard deduction for a given filing status and year.
 * When W-4 Step 2 box is checked (two earners), the IRS halves the
 * effective deduction; pass `step2Halve = true` for that case.
 */
export function getStandardDeduction(
  filing: FilingStatus = 'single',
  year: number = new Date().getFullYear(),
  step2Halve: boolean = false,
): number {
  // Prefer the DB-configured standard deduction (set via setDbConstants),
  // mirroring getSSWageBase/getFutaRate — otherwise an admin's edit to the
  // standard deduction is silently ignored and withholding uses stale numbers.
  const dbBase = _dbConstants
    ? (filing === 'mfj' ? _dbConstants.standard_deduction_married
      : filing === 'hoh' ? _dbConstants.standard_deduction_hoh
      : _dbConstants.standard_deduction_single)
    : 0;
  const base = dbBase > 0 ? dbBase : STANDARD_DEDUCTION_BY_YEAR[pickYear(year)][filing];
  return step2Halve ? base / 2 : base;
}

// Backwards-compatible exports for code that still references the
// 2025-specific names. Prefer the year-aware helpers above.
export { FEDERAL_BRACKETS_2025, STANDARD_DEDUCTION_2025 };
