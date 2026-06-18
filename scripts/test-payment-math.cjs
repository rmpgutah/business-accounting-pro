// Regression tests for the shared payment-recompute math.
//
// The repo has no test runner, so this is a dependency-free assertion script.
// Run with:  npm run test:payment
// (which builds the main process first, then executes this against the
// compiled CommonJS output in dist/).
//
// Covers the three payment bugs fixed together:
//   - invoice amount_paid/status recompute after edit/delete (was stale)
//   - debt balance_due/payments_made delta after edit/delete (was untouched)

const assert = require('node:assert');
const path = require('node:path');

const mathPath = path.join(__dirname, '..', 'dist', 'main', 'shared', 'payment-math.js');
let pm;
try {
  pm = require(mathPath);
} catch (e) {
  console.error(`\nCould not load compiled payment-math at ${mathPath}.`);
  console.error('Run `npm run build:main` first (or use `npm run test:payment`).\n');
  throw e;
}

const { roundCents, computeInvoicePaidStatus, applyDebtPaymentDelta } = pm;

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}
const approx = (a, b, eps = 0.001) => Math.abs(a - b) <= eps;

console.log('payment-math regression tests\n');

// ── roundCents kills float drift ──
test('roundCents removes binary-float residue', () => {
  assert.strictEqual(roundCents(100 + 0.1 + 0.2), 100.3);
  assert.strictEqual(roundCents(0.1 + 0.2), 0.3);
});

// ── Invoice: editing a payment down recomputes paid + status ──
test('invoice edit $500→$300 leaves partial with correct amount_paid', () => {
  // Invoice total 1000, previously had one $500 payment (status partial).
  // User edits it to $300 → remaining payments are [300].
  const r = computeInvoicePaidStatus(1000, [300], '2025-01-01', new Date('2025-06-01'));
  assert.ok(approx(r.amountPaid, 300), `expected 300, got ${r.amountPaid}`);
  assert.strictEqual(r.status, 'partial');
});

test('invoice fully covered by payments → paid', () => {
  const r = computeInvoicePaidStatus(1000, [600, 400]);
  assert.ok(approx(r.amountPaid, 1000));
  assert.strictEqual(r.status, 'paid');
});

test('invoice deleting the only payment → overdue when past due', () => {
  const r = computeInvoicePaidStatus(1000, [], '2025-01-01', new Date('2025-06-01'));
  assert.ok(approx(r.amountPaid, 0));
  assert.strictEqual(r.status, 'overdue');
});

test('invoice deleting the only payment → sent when not yet due', () => {
  const r = computeInvoicePaidStatus(1000, [], '2099-01-01', new Date('2025-06-01'));
  assert.strictEqual(r.status, 'sent');
});

test('invoice partial-payment float drift stays exact', () => {
  const r = computeInvoicePaidStatus(100.3, [100, 0.1, 0.2]);
  assert.ok(approx(r.amountPaid, 100.3), `expected 100.30, got ${r.amountPaid}`);
  assert.strictEqual(r.status, 'paid');
});

// ── Debt: delta application preserves accrued interest/fees ──
test('debt new payment decrements balance, increments payments_made', () => {
  // original 1000 + interest 50 already folded into balance_due 1050, no payments yet.
  const r = applyDebtPaymentDelta({ balance_due: 1050, payments_made: 0, status: 'active' }, +200);
  assert.ok(approx(r.balance_due, 850), `expected 850, got ${r.balance_due}`);
  assert.ok(approx(r.payments_made, 200));
  assert.strictEqual(r.status, 'active');
});

test('debt deleting a payment restores balance and un-settles', () => {
  // Was settled by a final $850 payment; deleting it (delta -850) must reopen.
  const r = applyDebtPaymentDelta({ balance_due: 0, payments_made: 1050, status: 'settled' }, -850);
  assert.ok(approx(r.balance_due, 850), `expected 850, got ${r.balance_due}`);
  assert.ok(approx(r.payments_made, 200));
  assert.strictEqual(r.status, 'active');
});

test('debt editing a payment up to clear the balance auto-settles', () => {
  // balance 850, payments 200; edit that $200 up to $1050 → delta +850 clears it.
  const r = applyDebtPaymentDelta({ balance_due: 850, payments_made: 200, status: 'active' }, +850);
  assert.ok(approx(r.balance_due, 0), `expected 0, got ${r.balance_due}`);
  assert.ok(approx(r.payments_made, 1050));
  assert.strictEqual(r.status, 'settled');
});

test('debt delta never disturbs a written_off / bankruptcy debt status', () => {
  const w = applyDebtPaymentDelta({ balance_due: 0, payments_made: 500, status: 'written_off' }, -500);
  assert.strictEqual(w.status, 'written_off');
  const b = applyDebtPaymentDelta({ balance_due: 0, payments_made: 500, status: 'bankruptcy' }, -500);
  assert.strictEqual(b.status, 'bankruptcy');
});

test('debt interest stays preserved across a payment delete', () => {
  // balance 1050 reflects 1000 principal + 50 interest, with a 200 payment made (balance 850).
  // Deleting that 200 payment must return balance to 1050 (interest intact), not 1000.
  const r = applyDebtPaymentDelta({ balance_due: 850, payments_made: 200, status: 'active' }, -200);
  assert.ok(approx(r.balance_due, 1050), `interest lost: expected 1050, got ${r.balance_due}`);
  assert.ok(approx(r.payments_made, 0));
});

console.log(`\n${passed} passed\n`);
