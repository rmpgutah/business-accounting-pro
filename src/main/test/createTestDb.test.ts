import { describe, it, expect } from 'vitest';
import { createTestDb } from './createTestDb';
import * as db from '../database';

describe('createTestDb', () => {
  it('opens an in-memory DB with the schema applied and a company selected', () => {
    const t = createTestDb();
    try {
      const row = t.db.prepare('SELECT name FROM companies WHERE id = ?').get(t.companyId) as { name: string };
      expect(row.name).toBe('Test Co');
      expect(db.getCurrentCompanyId()).toBe(t.companyId);
      expect(t.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='invoices'").get()).toBeTruthy();
    } finally {
      t.close();
    }
  });
});
