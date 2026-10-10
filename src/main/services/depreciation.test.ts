import { describe, it, expect } from 'vitest';
import { monthlyDepreciation } from './depreciation';

const approx = (a: number, b: number, eps = 0.01) => Math.abs(a - b) <= eps;

describe('depreciation', () => {
  // cost 10000, salvage 1000, life 5 → depreciable 9000, sumYears = 15.
  const base = { cost: 10000, salvage: 1000, life: 5, accumulated: 0, purchaseDate: '2025-01-01' };

  it('straight_line monthly = depreciable / (life*12)', () => {
    const m = monthlyDepreciation('straight_line', { ...base, periodDate: '2025-03-01' });
    expect(approx(m, 150), `expected 150, got ${m}`).toBeTruthy(); // 9000 / 60
  });

  it('double_declining monthly = bookValue*(2/life)/12', () => {
    const m = monthlyDepreciation('double_declining', { ...base, periodDate: '2025-03-01' });
    expect(approx(m, 333.33), `expected ~333.33, got ${m}`).toBeTruthy(); // 10000*0.4/12
  });

  it('SYD year 1 monthly = (5/15)*9000/12 = 250 (was silently 0)', () => {
    const m = monthlyDepreciation('sum_of_years_digits', { ...base, periodDate: '2025-03-01' });
    expect(m > 0, 'SYD must not be skipped (regression: used to be 0)').toBeTruthy();
    expect(approx(m, 250), `expected 250, got ${m}`).toBeTruthy();
  });

  it('SYD steps down to year 2 (4/15)*9000/12 = 200 after 12 months', () => {
    const m = monthlyDepreciation('sum_of_years_digits', { ...base, periodDate: '2026-02-01' });
    expect(approx(m, 200), `expected 200, got ${m}`).toBeTruthy();
  });

  it('SYD final year (5) monthly = (1/15)*9000/12 = 50', () => {
    const m = monthlyDepreciation('sum_of_years_digits', { ...base, periodDate: '2029-06-01' });
    expect(approx(m, 50), `expected 50, got ${m}`).toBeTruthy();
  });

  it('salvage floor caps the last partial month', () => {
    // Only $100 of room left down to salvage; SL would want 150.
    const m = monthlyDepreciation('straight_line', { ...base, accumulated: 8900, periodDate: '2025-03-01' });
    expect(approx(m, 100), `expected 100 (floored), got ${m}`).toBeTruthy();
  });

  it('unknown method depreciates nothing', () => {
    const m = monthlyDepreciation('units_of_production', { ...base, periodDate: '2025-03-01' });
    expect(m).toBe(0);
  });
});
