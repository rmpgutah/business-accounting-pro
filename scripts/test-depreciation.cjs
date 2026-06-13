// Regression tests for fixed-asset monthly depreciation.
//
// Dependency-free assertion script. Run with:  npm run test:depreciation
// (builds the main process first, then runs against the compiled output).
//
// Covers the Sum-of-Years-Digits bug: SYD assets used to be silently skipped by
// assets:run-depreciation (monthlyDep stayed 0), so they never depreciated.

const assert = require('node:assert');
const path = require('node:path');

const modPath = path.join(__dirname, '..', 'dist', 'main', 'main', 'services', 'depreciation.js');
let dep;
try {
  dep = require(modPath);
} catch (e) {
  console.error(`\nCould not load compiled depreciation at ${modPath}.`);
  console.error('Run `npm run build:main` first (or use `npm run test:depreciation`).\n');
  throw e;
}

const { monthlyDepreciation } = dep;

let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`  ✓ ${name}`); }
const approx = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

console.log('depreciation regression tests\n');

// cost 10000, salvage 1000, life 5 → depreciable 9000, sumYears = 15.
const base = { cost: 10000, salvage: 1000, life: 5, accumulated: 0, purchaseDate: '2025-01-01' };

test('straight_line monthly = depreciable / (life*12)', () => {
  const m = monthlyDepreciation('straight_line', { ...base, periodDate: '2025-03-01' });
  assert.ok(approx(m, 150), `expected 150, got ${m}`); // 9000 / 60
});

test('double_declining monthly = bookValue*(2/life)/12', () => {
  const m = monthlyDepreciation('double_declining', { ...base, periodDate: '2025-03-01' });
  assert.ok(approx(m, 333.33), `expected ~333.33, got ${m}`); // 10000*0.4/12
});

test('SYD year 1 monthly = (5/15)*9000/12 = 250 (was silently 0)', () => {
  const m = monthlyDepreciation('sum_of_years_digits', { ...base, periodDate: '2025-03-01' });
  assert.ok(m > 0, 'SYD must not be skipped (regression: used to be 0)');
  assert.ok(approx(m, 250), `expected 250, got ${m}`);
});

test('SYD steps down to year 2 (4/15)*9000/12 = 200 after 12 months', () => {
  const m = monthlyDepreciation('sum_of_years_digits', { ...base, periodDate: '2026-02-01' });
  assert.ok(approx(m, 200), `expected 200, got ${m}`);
});

test('SYD final year (5) monthly = (1/15)*9000/12 = 50', () => {
  const m = monthlyDepreciation('sum_of_years_digits', { ...base, periodDate: '2029-06-01' });
  assert.ok(approx(m, 50), `expected 50, got ${m}`);
});

test('salvage floor caps the last partial month', () => {
  // Only $100 of room left down to salvage; SL would want 150.
  const m = monthlyDepreciation('straight_line', { ...base, accumulated: 8900, periodDate: '2025-03-01' });
  assert.ok(approx(m, 100), `expected 100 (floored), got ${m}`);
});

test('unknown method depreciates nothing', () => {
  const m = monthlyDepreciation('units_of_production', { ...base, periodDate: '2025-03-01' });
  assert.strictEqual(m, 0);
});

console.log(`\n${passed} passed\n`);
