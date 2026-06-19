// ─── Debt Collection DB Helpers ─────────────────────────
// The generic db:create IPC handler auto-injects `company_id` for every table
// not listed in its exclusion set in src/main/ipc/index.ts. The debt_* child
// tables (debt_contacts, debt_communications, debt_payments, debt_evidence,
// debt_legal_actions, debt_pipeline_stages) do NOT have a company_id column
// per schema.sql, so using api.create() against them crashes with
// "table ... has no column named company_id". Until the main-process exclusion
// list is updated, these helpers perform explicit rawQuery INSERT/UPDATE calls
// that only include real schema columns.

import api from '../../lib/api';

function uuid(): string {
  // Simple UUID v4 (sufficient for local SQLite PKs).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function rawInsert(table: string, data: Record<string, any>): Promise<{ id: string }> {
  const id = data.id || uuid();
  const payload = { ...data, id };
  const keys = Object.keys(payload);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  await api.rawQuery(sql, keys.map((k) => (payload as Record<string, any>)[k]));
  return { id };
}

async function rawUpdate(table: string, id: string, data: Record<string, any>): Promise<void> {
  const keys = Object.keys(data);
  if (keys.length === 0) return;
  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  const sql = `UPDATE ${table} SET ${setClause} WHERE id = ?`;
  await api.rawQuery(sql, [...keys.map((k) => data[k]), id]);
}

async function rawDelete(table: string, id: string): Promise<void> {
  await api.rawQuery(`DELETE FROM ${table} WHERE id = ?`, [id]);
}

export const debtDb = {
  createContact:       (data: Record<string, any>) => rawInsert('debt_contacts', data),
  updateContact:       (id: string, data: Record<string, any>) => rawUpdate('debt_contacts', id, data),
  deleteContact:       (id: string) => rawDelete('debt_contacts', id),

  createCommunication: (data: Record<string, any>) => rawInsert('debt_communications', data),

  createPayment:       (data: Record<string, any>) => rawInsert('debt_payments', data),

  createEvidence:      (data: Record<string, any>) => rawInsert('debt_evidence', data),
  updateEvidence:      (id: string, data: Record<string, any>) => rawUpdate('debt_evidence', id, data),

  createLegalAction:   (data: Record<string, any>) => rawInsert('debt_legal_actions', data),
  updateLegalAction:   (id: string, data: Record<string, any>) => rawUpdate('debt_legal_actions', id, data),

  createPipelineStage: (data: Record<string, any>) => rawInsert('debt_pipeline_stages', data),
};
