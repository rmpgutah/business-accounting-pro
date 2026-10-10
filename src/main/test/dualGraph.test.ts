import { describe, it, expect } from 'vitest';
import { createTestDb } from './createTestDb';

describe('database module state across Vite and native-require graphs', () => {
  it('native require() sees the DB initialised through Vite', () => {
    const t = createTestDb();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dbViaRequire = require('../database');
    expect(dbViaRequire.getCurrentCompanyId()).toBe(t.companyId);
    const row = dbViaRequire
      .getDb()
      .prepare('SELECT id FROM companies WHERE id = ?')
      .get(t.companyId);
    expect(row).toBeTruthy();
  });

  it('lazily required services load', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    expect(() => require('../services/loan-calculator')).not.toThrow();
  });
});
