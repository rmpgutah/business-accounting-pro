// Single source of truth for federal payroll tax constants.
//
// These were previously re-declared in every tax-form file (form-941,
// form-944, form-w2, form-940, schedule-se, ...) plus the payroll engines,
// and had already drifted in one place (a 2024 SS wage base of 168600 vs the
// 2026 value of 182100). Import from here so a new tax year is a one-line edit
// and the figures can never diverge across forms again.
//
// NOTE: values reflect 2026. When IRS figures are published, update here.

export const SS_WAGE_BASE_2026 = 182100;   // 2026 Social Security wage base
export const SS_RATE = 0.062;              // 6.2% employee / 6.2% employer
export const MEDICARE_RATE = 0.0145;       // 1.45% each side
export const ADDTL_MEDICARE_RATE = 0.009;  // 0.9% on employee wages over threshold
export const ADDTL_MEDICARE_THRESHOLD = 200000;

export const FUTA_WAGE_BASE = 7000;        // first $7k of each employee's wages
export const FUTA_GROSS_RATE = 0.060;      // statutory 6.0%
export const FUTA_NET_RATE = 0.006;        // 0.6% effective after 5.4% state credit
