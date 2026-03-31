import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

let db: Database.Database;

export function initQueue(database: Database.Database) {
  db = database;
}

export interface QueueItem {
  table: string;
  operation: 'create' | 'update' | 'delete';
  id: string;
  data: Record<string, unknown>;
  companyId: string;
  timestamp: number;
}

export function enqueue(item: QueueItem) {
  db.prepare(`
    INSERT INTO sync_queue (id, table_name, operation, record_id, company_id, payload)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), item.table, item.operation, item.id, item.companyId, JSON.stringify(item));
}

export function dequeueAll(): Array<QueueItem & { rowId: number }> {
  return db.prepare(
    `SELECT rowid as rowId, * FROM sync_queue ORDER BY queued_at ASC LIMIT 100`
  ).all() as any[];
}

export function removeFromQueue(rowIds: number[]) {
  if (rowIds.length === 0) return;
  const placeholders = rowIds.map(() => '?').join(',');
  db.prepare(`DELETE FROM sync_queue WHERE rowid IN (${placeholders})`).run(...rowIds);
}

export function incrementAttempts(rowIds: number[]) {
  if (rowIds.length === 0) return;
  const placeholders = rowIds.map(() => '?').join(',');
  db.prepare(`UPDATE sync_queue SET attempts = attempts + 1 WHERE rowid IN (${placeholders})`).run(...rowIds);
}
