// Pure monthly-depreciation math for fixed assets.
//
// Extracted from the assets:run-depreciation IPC handler so the per-method
// formulas (especially the previously-missing Sum-of-Years-Digits branch) can
// be unit-tested in isolation — see scripts/test-depreciation.cjs.
//
// Dependency-free (no electron/DB) so the plain-node regression script can load
// the compiled output directly.

export interface DepreciationInput {
  cost: number;            // purchase_price
  salvage: number;         // salvage_value
  life: number;            // useful_life_years
  accumulated: number;     // accumulated_depreciation to date
  purchaseDate: string;    // ISO date the asset was placed in service
  periodDate: string;      // ISO date of the period being depreciated
}

/**
 * One month's depreciation for the given method, floored so the asset never
 * depreciates past its salvage value. Returns 0 for unknown methods or when the
 * asset is already fully depreciated.
 *
 * - straight_line:     (cost − salvage) / (life × 12)
 * - double_declining:  book value × (2 / life) / 12
 * - sum_of_years_digits: the current life-year's annual SYD amount ÷ 12, where
 *   the year is derived from months elapsed since purchase (the SYD fraction
 *   steps down each year, so a flat monthly figure would be wrong).
 */
export function monthlyDepreciation(method: string, p: DepreciationInput): number {
  const life = p.life || 5;
  const depreciable = Math.max(0, p.cost - p.salvage);
  let dep = 0;

  if (method === 'straight_line') {
    dep = depreciable / (life * 12);
  } else if (method === 'double_declining') {
    const bookValue = p.cost - p.accumulated;
    dep = (bookValue * (2 / life)) / 12;
  } else if (method === 'sum_of_years_digits') {
    const sumYears = (life * (life + 1)) / 2;
    const start = new Date(p.purchaseDate);
    let yearIdx = 1;
    if (!isNaN(start.getTime())) {
      const period = new Date(p.periodDate);
      const monthsElapsed =
        (period.getFullYear() - start.getFullYear()) * 12 +
        (period.getMonth() - start.getMonth());
      yearIdx = Math.min(life, Math.max(1, Math.floor(monthsElapsed / 12) + 1));
    }
    const remaining = Math.max(1, life - yearIdx + 1);
    dep = ((remaining / sumYears) * depreciable) / 12;
  }

  // Never deduct more than the remaining gap down to salvage.
  return Math.min(dep, Math.max(0, p.cost - p.accumulated - p.salvage));
}
