// src/renderer/lib/tax-brackets.ts
//
// Centralized 2025 federal tax data — single source of truth for both
// the payroll runner (per-period withholding) and the tax dashboard
// (annual estimated liability).
//
// Source: IRS Rev. Proc. 2024-40 (2025 inflation adjustments) and
// IRS Pub. 15-T (2025) for withholding methods.

export type FilingStatus = 'single' | 'mfj' | 'hoh';

export interface Bracket {
  /** Lower bound of bracket (inclusive). */
  min: number;
  /** Upper bound (exclusive). `Infinity` for the top bracket. */
  max: number;
  /** Marginal rate as a decimal (e.g. 0.22 = 22%). */
  rate: number;
}

// ─── 2025 Federal Income Tax Brackets ───────────────────
// Source: IRS Rev. Proc. 2024-40, Section 3.01 (2025 single brackets).
export const FEDERAL_BRACKETS_2025: Record<FilingStatus, Bracket[]> = {
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

// ─── 2025 Standard Deductions ───────────────────────────
// Source: IRS Rev. Proc. 2024-40, Section 3.16.
export const STANDARD_DEDUCTION_2025: Record<FilingStatus, number> = {
  single: 15000,
  mfj: 30000,
  hoh: 22500,
};

// ─── FICA / Medicare 2025 ───────────────────────────────
// Source: SSA Fact Sheet (2025) and IRC §3101.
export const SS_RATE = 0.062;            // employee + employer each
export const SS_WAGE_BASE_2025 = 176100; // 2025 OASDI taxable max
export const MEDICARE_RATE = 0.0145;
export const ADDL_MEDICARE_RATE = 0.009;        // 0.9% additional Medicare
export const ADDL_MEDICARE_THRESHOLD = 200000;  // employer withholds at $200k regardless of filing status

// ─── FUTA 2025 ──────────────────────────────────────────
// Source: IRS Form 940 instructions (2025).
export const FUTA_RATE = 0.006;       // post-credit (0.6%)
export const FUTA_WAGE_BASE = 7000;   // first $7,000 per employee per year

// ─── Helpers ────────────────────────────────────────────

/**
 * Bracket-tax of an annual taxable income for a given filing status,
 * using 2025 federal brackets.
 */
export function calcFederalTaxAnnual(
  annualTaxableIncome: number,
  filing: FilingStatus = 'single'
): number {
  const brackets = FEDERAL_BRACKETS_2025[filing];
  let tax = 0;
  for (const b of brackets) {
    if (annualTaxableIncome <= b.min) break;
    const taxableInBracket = Math.min(annualTaxableIncome, b.max) - b.min;
    tax += taxableInBracket * b.rate;
  }
  return Math.max(0, tax);
}

export function getStandardDeduction(filing: FilingStatus = 'single'): number {
  return STANDARD_DEDUCTION_2025[filing];
}
