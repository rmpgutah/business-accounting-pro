import type { Database } from 'better-sqlite3';
import { INDEX_ENTRIES, entryFor, type IndexEntry } from './indexConfig';

export interface SearchHit {
  entity_type: string;
  entity_id: string;
  title: string;
  subtitle: string;
  score: number;
}

/** Create the FTS5 table if missing (used by tests; prod uses the migration). */
export function ensureSearchIndex(d: Database): void {
  d.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
    entity_type UNINDEXED, entity_id UNINDEXED, company_id UNINDEXED,
    title, subtitle, body, tokenize = 'porter unicode61')`);
}

function removeRow(d: Database, table: string, id: string): void {
  const e = entryFor(table);
  if (!e) return;
  d.prepare(`DELETE FROM search_index WHERE entity_type = ? AND entity_id = ?`).run(e.entityType, id);
}

/** Re-index a single row by reading it back from its source table. */
export function reindexEntity(d: Database, table: string, id: string): void {
  const e = entryFor(table);
  if (!e) return;
  removeRow(d, table, id);
  const row: any = d.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) return; // deleted or missing → stays removed
  // Skip soft-deleted rows so they leave search.
  if (row.deleted_at != null && row.deleted_at !== '') return;
  const doc = e.toDoc(row);
  d.prepare(`INSERT INTO search_index(entity_type, entity_id, company_id, title, subtitle, body)
             VALUES(?,?,?,?,?,?)`)
    .run(e.entityType, id, String(row.company_id ?? ''), doc.title, doc.subtitle, doc.body);
}

export function removeFromIndex(d: Database, table: string, id: string): void {
  removeRow(d, table, id);
}

/** Full (re)build for one company across all indexed tables. Idempotent. */
export function backfillCompany(d: Database, companyId: string): number {
  let n = 0;
  for (const e of INDEX_ENTRIES) {
    let rows: any[] = [];
    try { rows = d.prepare(`SELECT id FROM ${e.table} WHERE company_id = ?`).all(companyId) as any[]; }
    catch { continue; } // table may not exist in a given build — skip
    for (const r of rows) { reindexEntity(d, e.table, r.id); n++; }
  }
  return n;
}

/** Escape an FTS5 query: wrap each term as a prefix match, drop FTS operators. */
function toMatch(query: string): string {
  const terms = query.toLowerCase().replace(/["*()]/g, ' ').split(/\s+/).filter(Boolean);
  if (!terms.length) return '';
  return terms.map(t => `"${t}"*`).join(' ');
}

export function search(d: Database, companyId: string, query: string, limit = 20): SearchHit[] {
  const match = toMatch(query);
  if (!match) return [];
  const rows = d.prepare(
    `SELECT entity_type, entity_id, title, subtitle, bm25(search_index) AS rank
     FROM search_index
     WHERE company_id = ? AND search_index MATCH ?
     ORDER BY rank LIMIT ?`
  ).all(companyId, match, limit) as any[];
  return rows.map(r => ({
    entity_type: r.entity_type, entity_id: r.entity_id,
    title: r.title, subtitle: r.subtitle, score: -r.rank, // bm25 lower=better → negate
  }));
}
