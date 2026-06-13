// Dependency-free assertion tests for the FTS5 search index service.
// Run with: npm run test:search  (builds main first, then executes against dist/).
const assert = require('node:assert');
const path = require('node:path');
const Database = require('better-sqlite3');

const svc = require(path.join(__dirname, '..', 'dist', 'main', 'main', 'services', 'intelligence', 'searchIndex.js'));
const { ensureSearchIndex, reindexEntity, removeFromIndex, backfillCompany, search } = svc;

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`  ✓ ${name}`); };

function freshDb() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY, company_id TEXT, name TEXT, email TEXT, phone TEXT, notes TEXT, deleted_at TEXT)`);
  d.exec(`CREATE TABLE invoices (id TEXT PRIMARY KEY, company_id TEXT, invoice_number TEXT, status TEXT, notes TEXT, deleted_at TEXT)`);
  ensureSearchIndex(d);
  return d;
}

console.log('search-index tests\n');

test('indexes a client and finds it by name prefix', () => {
  const d = freshDb();
  d.prepare(`INSERT INTO clients(id,company_id,name,email) VALUES(?,?,?,?)`).run('c1', 'co1', 'Acme Corp', 'a@acme.com');
  reindexEntity(d, 'clients', 'c1');
  const hits = search(d, 'co1', 'acm', 10);
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].entity_type, 'client');
  assert.strictEqual(hits[0].entity_id, 'c1');
});

test('scopes results by company', () => {
  const d = freshDb();
  d.prepare(`INSERT INTO clients(id,company_id,name) VALUES(?,?,?)`).run('c1', 'co1', 'Acme');
  d.prepare(`INSERT INTO clients(id,company_id,name) VALUES(?,?,?)`).run('c2', 'co2', 'Acme');
  reindexEntity(d, 'clients', 'c1');
  reindexEntity(d, 'clients', 'c2');
  assert.strictEqual(search(d, 'co1', 'acme', 10).length, 1);
});

test('reindex reflects updates and removes stale text', () => {
  const d = freshDb();
  d.prepare(`INSERT INTO clients(id,company_id,name) VALUES(?,?,?)`).run('c1', 'co1', 'Globex');
  reindexEntity(d, 'clients', 'c1');
  d.prepare(`UPDATE clients SET name=? WHERE id=?`).run('Initech', 'c1');
  reindexEntity(d, 'clients', 'c1');
  assert.strictEqual(search(d, 'co1', 'globex', 10).length, 0);
  assert.strictEqual(search(d, 'co1', 'initech', 10).length, 1);
});

test('soft-deleted rows leave the index', () => {
  const d = freshDb();
  d.prepare(`INSERT INTO clients(id,company_id,name,deleted_at) VALUES(?,?,?,?)`).run('c1', 'co1', 'Acme', null);
  reindexEntity(d, 'clients', 'c1');
  d.prepare(`UPDATE clients SET deleted_at=datetime('now') WHERE id=?`).run('c1');
  reindexEntity(d, 'clients', 'c1');
  assert.strictEqual(search(d, 'co1', 'acme', 10).length, 0);
});

test('removeFromIndex deletes the row', () => {
  const d = freshDb();
  d.prepare(`INSERT INTO clients(id,company_id,name) VALUES(?,?,?)`).run('c1', 'co1', 'Acme');
  reindexEntity(d, 'clients', 'c1');
  removeFromIndex(d, 'clients', 'c1');
  assert.strictEqual(search(d, 'co1', 'acme', 10).length, 0);
});

test('backfillCompany indexes all existing rows', () => {
  const d = freshDb();
  d.prepare(`INSERT INTO clients(id,company_id,name) VALUES(?,?,?)`).run('c1', 'co1', 'Acme');
  d.prepare(`INSERT INTO invoices(id,company_id,invoice_number,status) VALUES(?,?,?,?)`).run('i1', 'co1', '1024', 'open');
  const n = backfillCompany(d, 'co1');
  assert.ok(n >= 2);
  assert.strictEqual(search(d, 'co1', '1024', 10).length, 1);
});

test('FTS operator injection is neutralized (still matches)', () => {
  const d = freshDb();
  d.prepare(`INSERT INTO clients(id,company_id,name) VALUES(?,?,?)`).run('c1', 'co1', 'Acme');
  reindexEntity(d, 'clients', 'c1');
  // The query 'acme*"(' contains FTS operators that must be escaped/stripped
  // so the search does not throw and still returns the 'Acme' hit.
  let hits;
  assert.doesNotThrow(() => { hits = search(d, 'co1', 'acme*"(', 10); });
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].entity_id, 'c1');
});

test('non-allowlisted table is a silent no-op', () => {
  const d = freshDb();
  assert.doesNotThrow(() => { reindexEntity(d, 'users', 'x'); });
  const hits = search(d, 'co1', 'x', 10);
  assert.strictEqual(hits.length, 0);
});

console.log(`\n${passed} passed`);
