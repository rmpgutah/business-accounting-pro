// Boots a fresh in-memory database through the real migration path and asserts
// that no "[migrations] non-idempotent error" warnings fire, then smoke-tests
// the admin-features custom-field service against the real schema.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as dbMod from '../database';
import * as svc from '../services/admin-features';

describe('migrations on a fresh DB', () => {
  let dbi: ReturnType<typeof dbMod.initDatabaseAt>;
  let warnings: string[] = [];
  const cid = 'co-test';

  beforeAll(() => {
    const spy = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
      warnings.push(a.map(String).join(' '));
    });
    try {
      dbi = dbMod.initDatabaseAt(':memory:');
    } finally {
      spy.mockRestore();
    }
    dbi.prepare('INSERT INTO companies (id, name) VALUES (?, ?)').run(cid, 'Test Co');
  });

  afterAll(() => {
    dbi?.close();
  });

  it('emits zero non-idempotent migration warnings', () => {
    expect(warnings.filter((w) => w.includes('[migrations] non-idempotent error'))).toEqual([]);
  });

  it('loan_payments has the related expense linkage columns', () => {
    const cols = (dbi.prepare('PRAGMA table_info(loan_payments)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('related_expense_id');
    expect(cols).toContain('related_principal_expense_id');
  });

  it('custom_field_definitions has the key/label/sort_order/deleted_at shape', () => {
    const cols = (dbi.prepare('PRAGMA table_info(custom_field_definitions)').all() as { name: string }[]).map((c) => c.name);
    for (const c of ['key', 'label', 'sort_order', 'deleted_at']) expect(cols).toContain(c);
    for (const c of ['field_key', 'field_label', 'display_order']) expect(cols).not.toContain(c);
  });

  it('idx_custom_fields_company_entity exists', () => {
    const idx = (dbi.prepare('PRAGMA index_info(idx_custom_fields_company_entity)').all() as { name: string }[]).map((c) => c.name);
    expect(idx.length).toBeGreaterThan(0);
  });

  it('upsert/list/delete custom fields against the real schema', () => {
    const a = svc.upsertCustomField({ company_id: cid, entity_type: 'client', key: 'po_number', label: 'PO Number', field_type: 'text', sort_order: 2 } as never);
    expect(a.key).toBe('po_number');
    svc.upsertCustomField({ company_id: cid, entity_type: 'client', key: 'tier', label: 'Tier', field_type: 'select', options_json: '["a","b"]', sort_order: 1 } as never);
    const list = svc.listCustomFields(cid, 'client');
    expect(list.map((f) => f.key)).toEqual(['tier', 'po_number']);
    expect(svc.deleteCustomField(list[0].id)).toBe(true);
    expect(svc.deleteCustomField(list[0].id)).toBe(false);
    expect(svc.listCustomFields(cid, 'client').some((f) => f.id === list[0].id)).toBe(false);
  });
});
