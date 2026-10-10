// Regression tests for the schema migration list in src/main/database/index.ts.
//
// The repo has no test runner, so this is a dependency-free assertion
// script. Run with:  npm run test:migrations
// (builds the main process first, then executes against dist/).
//
// Boots a fresh in-memory DB through initDatabaseAt(':memory:') and asserts:
//   1. no migration statement produced a "[migrations] non-idempotent error"
//      warning (i.e. nothing ran against an object that didn't exist yet);
//   2. columns that used to be added by ALTERs placed *before* their
//      CREATE TABLE now exist on a fresh install;
//   3. idx_custom_fields_company_entity exists (it needs
//      custom_field_definitions.is_active, which used to be missing);
//   4. running the migration list a second time on the same DB is a no-op.

const assert = require('node:assert');
const path = require('node:path');

const dbModPath = path.join(__dirname, '..', 'dist', 'main', 'main', 'database', 'index.js');
let dbMod;
try {
  dbMod = require(dbModPath);
} catch (e) {
  console.error(`\nCould not load compiled database module at ${dbModPath}.`);
  console.error('Run `npm run build:main` first (or use `npm run test:migrations`).\n');
  throw e;
}

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// Capture console.warn so we can assert on the migration runner's output.
function withCapturedWarnings(fn) {
  const warnings = [];
  const orig = console.warn;
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')); };
  try { fn(); } finally { console.warn = orig; }
  return warnings;
}

const columns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
const indexes = (db, table) => db.prepare(`PRAGMA index_list(${table})`).all().map(i => i.name);

console.log('schema migration tests\n');

let db;
const firstBootWarnings = withCapturedWarnings(() => { db = dbMod.initDatabaseAt(':memory:'); });

test('fresh in-memory DB boots with zero non-idempotent migration warnings', () => {
  const bad = firstBootWarnings.filter(w => w.includes('[migrations] non-idempotent error'));
  assert.deepStrictEqual(bad, [], `unexpected migration warnings:\n${bad.join('\n')}`);
});

test('loan_payments has related_expense_id and related_principal_expense_id on a fresh DB', () => {
  const cols = columns(db, 'loan_payments');
  assert.ok(cols.includes('related_expense_id'), `missing related_expense_id in ${cols}`);
  assert.ok(cols.includes('related_principal_expense_id'), `missing related_principal_expense_id in ${cols}`);
});

test('custom_field_definitions has is_active on a fresh DB', () => {
  const cols = columns(db, 'custom_field_definitions');
  assert.ok(cols.includes('is_active'), `missing is_active in ${cols}`);
  // The IPC handlers filter on deleted_at; make sure that shape survived too.
  assert.ok(cols.includes('deleted_at'), `missing deleted_at in ${cols}`);
});

test('idx_custom_fields_company_entity index exists on a fresh DB', () => {
  const idx = indexes(db, 'custom_field_definitions');
  assert.ok(idx.includes('idx_custom_fields_company_entity'), `index missing; have ${idx}`);
  const idxCols = db.prepare(`PRAGMA index_info(idx_custom_fields_company_entity)`).all().map(c => c.name);
  assert.deepStrictEqual(idxCols, ['company_id', 'entity_type', 'is_active']);
});

test('migration list stays idempotent when re-run on an existing install', () => {
  // Boot twice against the same on-disk file: the second boot sees every
  // table/column/index already present and must stay warning-free.
  const fs = require('node:fs');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bap-migrations-'));
  const file = path.join(dir, 'accounting.db');
  try {
    withCapturedWarnings(() => { dbMod.initDatabaseAt(file).close(); });
    const again = withCapturedWarnings(() => { dbMod.initDatabaseAt(file).close(); });
    const bad = again.filter(w => w.includes('[migrations] non-idempotent error'));
    assert.deepStrictEqual(bad, [], `unexpected warnings on re-boot:\n${bad.join('\n')}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n${passed} tests passed`);
