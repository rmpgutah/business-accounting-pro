import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { ensureSearchIndex, reindexEntity, removeFromIndex, backfillCompany, search } from './searchIndex';

function freshDb() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY, company_id TEXT, name TEXT, email TEXT, phone TEXT, notes TEXT, deleted_at TEXT)`);
  d.exec(`CREATE TABLE invoices (id TEXT PRIMARY KEY, company_id TEXT, invoice_number TEXT, status TEXT, notes TEXT, deleted_at TEXT)`);
  ensureSearchIndex(d);
  return d;
}

describe('search-index', () => {
  it('indexes a client and finds it by name prefix', () => {
    const d = freshDb();
    d.prepare(`INSERT INTO clients(id,company_id,name,email) VALUES(?,?,?,?)`).run('c1', 'co1', 'Acme Corp', 'a@acme.com');
    reindexEntity(d, 'clients', 'c1');
    const hits = search(d, 'co1', 'acm', 10);
    expect(hits.length).toBe(1);
    expect(hits[0].entity_type).toBe('client');
    expect(hits[0].entity_id).toBe('c1');
  });

  it('scopes results by company', () => {
    const d = freshDb();
    d.prepare(`INSERT INTO clients(id,company_id,name) VALUES(?,?,?)`).run('c1', 'co1', 'Acme');
    d.prepare(`INSERT INTO clients(id,company_id,name) VALUES(?,?,?)`).run('c2', 'co2', 'Acme');
    reindexEntity(d, 'clients', 'c1');
    reindexEntity(d, 'clients', 'c2');
    expect(search(d, 'co1', 'acme', 10).length).toBe(1);
  });

  it('reindex reflects updates and removes stale text', () => {
    const d = freshDb();
    d.prepare(`INSERT INTO clients(id,company_id,name) VALUES(?,?,?)`).run('c1', 'co1', 'Globex');
    reindexEntity(d, 'clients', 'c1');
    d.prepare(`UPDATE clients SET name=? WHERE id=?`).run('Initech', 'c1');
    reindexEntity(d, 'clients', 'c1');
    expect(search(d, 'co1', 'globex', 10).length).toBe(0);
    expect(search(d, 'co1', 'initech', 10).length).toBe(1);
  });

  it('soft-deleted rows leave the index', () => {
    const d = freshDb();
    d.prepare(`INSERT INTO clients(id,company_id,name,deleted_at) VALUES(?,?,?,?)`).run('c1', 'co1', 'Acme', null);
    reindexEntity(d, 'clients', 'c1');
    d.prepare(`UPDATE clients SET deleted_at=datetime('now') WHERE id=?`).run('c1');
    reindexEntity(d, 'clients', 'c1');
    expect(search(d, 'co1', 'acme', 10).length).toBe(0);
  });

  it('removeFromIndex deletes the row', () => {
    const d = freshDb();
    d.prepare(`INSERT INTO clients(id,company_id,name) VALUES(?,?,?)`).run('c1', 'co1', 'Acme');
    reindexEntity(d, 'clients', 'c1');
    removeFromIndex(d, 'clients', 'c1');
    expect(search(d, 'co1', 'acme', 10).length).toBe(0);
  });

  it('backfillCompany indexes all existing rows', () => {
    const d = freshDb();
    d.prepare(`INSERT INTO clients(id,company_id,name) VALUES(?,?,?)`).run('c1', 'co1', 'Acme');
    d.prepare(`INSERT INTO invoices(id,company_id,invoice_number,status) VALUES(?,?,?,?)`).run('i1', 'co1', '1024', 'open');
    const n = backfillCompany(d, 'co1');
    expect(n >= 2).toBeTruthy();
    expect(search(d, 'co1', '1024', 10).length).toBe(1);
  });

  it('FTS operator injection is neutralized (still matches)', () => {
    const d = freshDb();
    d.prepare(`INSERT INTO clients(id,company_id,name) VALUES(?,?,?)`).run('c1', 'co1', 'Acme');
    reindexEntity(d, 'clients', 'c1');
    // The query 'acme*"(' contains FTS operators that must be escaped/stripped
    // so the search does not throw and still returns the 'Acme' hit.
    let hits: any;
    expect(() => { hits = search(d, 'co1', 'acme*"(', 10); }).not.toThrow();
    expect(hits.length).toBe(1);
    expect(hits[0].entity_id).toBe('c1');
  });

  it('non-allowlisted table is a silent no-op', () => {
    const d = freshDb();
    expect(() => { reindexEntity(d, 'users', 'x'); }).not.toThrow();
    const hits = search(d, 'co1', 'x', 10);
    expect(hits.length).toBe(0);
  });
});
