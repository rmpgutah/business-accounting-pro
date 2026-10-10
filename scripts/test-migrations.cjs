// Boots a fresh database through the real initDatabase() migration path and
// asserts that no "[migrations] non-idempotent error" warnings fire. Also
// smoke-tests the admin-features custom-field service against the real
// custom_field_definitions schema (key/label/sort_order/deleted_at).
// Run with: npm run test:migrations  (builds main first, then executes against dist/).
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const Module = require('node:module');

// ── Stub electron so database/index.ts can load outside the Electron runtime ──
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bap-migrations-'));
const electronStub = { app: { getPath: () => tmpDir, isPackaged: false, getVersion: () => '0.0.0-test', getName: () => 'test' } };
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return electronStub;
  return origLoad.call(this, request, ...rest);
};

// ── Capture migration warnings ──
const warnings = [];
const origWarn = console.warn;
console.warn = (...args) => { warnings.push(args.map(String).join(' ')); };

const dist = path.join(__dirname, '..', 'dist', 'main', 'main');
const dbMod = require(path.join(dist, 'database', 'index.js'));

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`  ✓ ${name}`); };

console.log('migrations tests\n');
let dbi;
try {
  dbi = dbMod.initDatabase();
  console.warn = origWarn;

  const nonIdempotent = warnings.filter((w) => w.includes('[migrations] non-idempotent error'));
  test('zero non-idempotent migration warnings on a fresh DB', () => {
    if (nonIdempotent.length) console.log(nonIdempotent.map((w) => '    ' + w).join('\n'));
    assert.strictEqual(nonIdempotent.length, 0);
  });

  test('custom_field_definitions has the key/label/sort_order/deleted_at shape', () => {
    const cols = dbi.prepare(`PRAGMA table_info(custom_field_definitions)`).all().map((c) => c.name);
    for (const c of ['key', 'label', 'sort_order', 'deleted_at']) assert.ok(cols.includes(c), `missing column ${c}`);
    for (const c of ['field_key', 'field_label', 'display_order', 'is_active']) assert.ok(!cols.includes(c), `unexpected column ${c}`);
  });

  test('idx_custom_fields_company_entity exists and targets deleted_at', () => {
    const idx = dbi.prepare(`PRAGMA index_info(idx_custom_fields_company_entity)`).all().map((c) => c.name);
    assert.deepStrictEqual(idx, ['company_id', 'entity_type', 'deleted_at']);
  });

  test('second boot on the same DB is idempotent', () => {
    dbi.close();
    const w2 = [];
    console.warn = (...a) => { w2.push(a.map(String).join(' ')); };
    dbi = dbMod.initDatabase();
    console.warn = origWarn;
    assert.strictEqual(w2.filter((w) => w.includes('[migrations] non-idempotent error')).length, 0);
  });

  // ── admin-features custom-field service against the real schema ──
  const svc = require(path.join(dist, 'services', 'admin-features.js'));
  const cid = 'co-test';
  dbi.prepare(`INSERT INTO companies (id, name) VALUES (?, ?)`).run(cid, 'Test Co');

  test('upsertCustomField inserts using real columns', () => {
    const rec = svc.upsertCustomField({ company_id: cid, entity_type: 'client', key: 'po_number', label: 'PO Number', field_type: 'text', sort_order: 2 });
    assert.strictEqual(rec.key, 'po_number');
    assert.strictEqual(rec.label, 'PO Number');
    assert.strictEqual(rec.sort_order, 2);
    assert.strictEqual(rec.deleted_at, null);
  });

  test('listCustomFields returns live fields ordered by sort_order', () => {
    svc.upsertCustomField({ company_id: cid, entity_type: 'client', key: 'tier', label: 'Tier', field_type: 'select', options_json: '["a","b"]', sort_order: 1 });
    const list = svc.listCustomFields(cid, 'client');
    assert.deepStrictEqual(list.map((f) => f.key), ['tier', 'po_number']);
    assert.strictEqual(svc.listCustomFields(cid).length, 2);
  });

  test('upsertCustomField with id updates in place', () => {
    const [tier] = svc.listCustomFields(cid, 'client');
    const upd = svc.upsertCustomField({ id: tier.id, company_id: cid, entity_type: 'client', key: 'tier', label: 'Client Tier', field_type: 'select', sort_order: 5 });
    assert.strictEqual(upd.id, tier.id);
    assert.strictEqual(upd.label, 'Client Tier');
    assert.strictEqual(upd.sort_order, 5);
  });

  test('deleteCustomField soft-deletes via deleted_at and hides from list', () => {
    const [first] = svc.listCustomFields(cid, 'client');
    assert.strictEqual(svc.deleteCustomField(first.id), true);
    assert.strictEqual(svc.deleteCustomField(first.id), false, 'second delete is a no-op');
    assert.ok(!svc.listCustomFields(cid, 'client').some((f) => f.id === first.id));
    const row = dbi.prepare(`SELECT deleted_at FROM custom_field_definitions WHERE id = ?`).get(first.id);
    assert.ok(row.deleted_at);
  });

  test('upsertCustomField rejects invalid entity_type / field_type', () => {
    assert.throws(() => svc.upsertCustomField({ company_id: cid, entity_type: 'nope', key: 'x', label: 'X', field_type: 'text' }), /entity_type/);
    assert.throws(() => svc.upsertCustomField({ company_id: cid, entity_type: 'client', key: 'x', label: 'X', field_type: 'nope' }), /field_type/);
  });

  console.log(`\n${passed} passed`);
} finally {
  console.warn = origWarn;
  try { dbi && dbi.close(); } catch {}
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
