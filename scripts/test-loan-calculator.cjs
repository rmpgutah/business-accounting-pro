// Regression tests for the loan amortization math.
//
// The repo has no test runner, so this is a dependency-free assertion
// script. Run with:  npm run test:loan
// (which builds the main process first, then executes this against the
// compiled CommonJS output in dist/).
//
// Covers the balloon-amortization fix: the final payment must equal the
// stated balloon_amount, not whatever residue the old undiscounted
// formula left behind.

const assert = require('node:assert');
const path = require('node:path');

const calcPath = path.join(__dirname, '..', 'dist', 'main', 'main', 'services', 'loan-calculator.js');
let calc;
try {
  calc = require(calcPath);
} catch (e) {
  console.error(`\nCould not load compiled calculator at ${calcPath}.`);
  console.error('Run `npm run build:main` first (or use `npm run test:loan`).\n');
  throw e;
}

const { generateSchedule, splitPayment, periodicPayment, periodicRate, paymentsForTerm } = calc;

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const approx = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;

console.log('loan-calculator regression tests\n');

// ── Balloon: regular payments amortize down to exactly the balloon ──
test('balloon loan leaves exactly the stated balloon before the final payment', () => {
  const rows = generateSchedule({
    principal: 100000,
    annual_rate: 0.06,
    term_months: 60,
    first_payment_date: '2025-01-01',
    payment_frequency: 'monthly',
    amortization_type: 'balloon',
    balloon_amount: 20000,
  });
  assert.strictEqual(rows.length, 60);
  // Balance after the 59th (last regular) payment must equal the balloon.
  assert.ok(approx(rows[58].remaining_balance, 20000),
    `expected ~20000 before balloon, got ${rows[58].remaining_balance}`);
  // The final payment clears the balloon; balance ends at 0.
  assert.ok(approx(rows[59].remaining_balance, 0),
    `expected final balance 0, got ${rows[59].remaining_balance}`);
  // The final payment principal IS the balloon.
  assert.ok(approx(rows[59].principal_amount, 20000),
    `expected final principal 20000, got ${rows[59].principal_amount}`);
});

test('zero-rate balloon loan also preserves the balloon', () => {
  const rows = generateSchedule({
    principal: 120000,
    annual_rate: 0,
    term_months: 60,
    first_payment_date: '2025-01-01',
    payment_frequency: 'monthly',
    amortization_type: 'balloon',
    balloon_amount: 30000,
  });
  assert.ok(approx(rows[58].remaining_balance, 30000),
    `expected ~30000 before balloon, got ${rows[58].remaining_balance}`);
  assert.ok(approx(rows[59].remaining_balance, 0));
});

// ── Standard amortization fully pays off ──
test('standard loan amortizes to zero', () => {
  const rows = generateSchedule({
    principal: 50000,
    annual_rate: 0.05,
    term_months: 36,
    first_payment_date: '2025-01-01',
    payment_frequency: 'monthly',
    amortization_type: 'standard',
  });
  assert.strictEqual(rows.length, 36);
  assert.ok(approx(rows[35].remaining_balance, 0),
    `expected final balance 0, got ${rows[35].remaining_balance}`);
});

// ── Interest-only: principal untouched until the final payment ──
test('interest-only loan defers all principal to the final payment', () => {
  const rows = generateSchedule({
    principal: 80000,
    annual_rate: 0.06,
    term_months: 24,
    first_payment_date: '2025-01-01',
    payment_frequency: 'monthly',
    amortization_type: 'interest_only',
  });
  assert.ok(approx(rows[0].principal_amount, 0), 'first payment should be interest-only');
  assert.ok(approx(rows[22].remaining_balance, 80000), 'balance unchanged until final');
  assert.ok(approx(rows[23].remaining_balance, 0), 'final payment clears principal');
});

// ── Partial-payment split caps interest at the amount paid ──
test('splitPayment caps interest at the payment amount on a partial payment', () => {
  // Accrued interest on 100000 at 6%/12 = $500; pay only $31.
  const s = splitPayment(100000, 31, 0.06, 'monthly', 0);
  assert.ok(approx(s.interest, 31), `interest should be capped at 31, got ${s.interest}`);
  assert.ok(approx(s.principal, 0), `no principal on a sub-interest payment, got ${s.principal}`);
  assert.ok(approx(s.deferred_interest, 469), `expected 469 deferred, got ${s.deferred_interest}`);
});

// ── Stored payment_amount honors the loan's payment frequency ──
test('biweekly stored payment matches the schedule, not a monthly figure', () => {
  const principal = 26000, annual = 0.065, term = 60, freq = 'biweekly';
  // What loans:save now stores (frequency-aware):
  const stored = periodicPayment(principal, periodicRate(annual, freq), paymentsForTerm(term, freq));
  // What the amortization schedule actually bills each biweekly period:
  const rows = generateSchedule({
    principal, annual_rate: annual, term_months: term,
    first_payment_date: '2025-01-01', payment_frequency: freq,
    amortization_type: 'standard',
  });
  assert.ok(approx(stored, rows[0].scheduled_payment),
    `stored ${stored} should match biweekly schedule payment ${rows[0].scheduled_payment}`);
  // …and must NOT be the (wrong) monthly figure the old code stored.
  const monthlyFigure = periodicPayment(principal, annual / 12, term);
  assert.ok(Math.abs(stored - monthlyFigure) > 1,
    `biweekly payment ${stored} should differ from monthly ${monthlyFigure}`);
});

console.log(`\n${passed} passed\n`);
