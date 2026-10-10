import { v4 as uuid } from 'uuid';
import * as db from '../database';

export interface TestDb {
  db: ReturnType<typeof db.getDb>;
  companyId: string;
  userId: string;
  close(): void;
}

export function createTestDb(): TestDb {
  const d = db.initDatabaseAt(':memory:');
  const companyId = uuid();
  const userId = uuid();
  d.prepare(
    `INSERT INTO companies (id, name, legal_name, created_at, updated_at)
     VALUES (?, 'Test Co', 'Test Co LLC', datetime('now'), datetime('now'))`,
  ).run(companyId);
  d.prepare(
    `INSERT INTO users (id, email, display_name, password_hash, created_at, updated_at)
     VALUES (?, 'test@example.com', 'Test User', 'x', datetime('now'), datetime('now'))`,
  ).run(userId);
  db.switchCompany(companyId);
  db.setCurrentUser(userId, 'test@example.com');
  return { db: d, companyId, userId, close: () => d.close() };
}
