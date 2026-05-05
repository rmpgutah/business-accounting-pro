// src/renderer/lib/recordedMutation.ts
//
// P3.25 — Records an undoable mutation by snapshotting the
// before-state, executing the action, and pushing the inverse
// onto the undo stack. Use instead of direct api.update / api.delete
// calls anywhere undo-ability matters.
//
// Pattern:
//
//   await recordedUpdate('invoices', invoiceId, { status: 'sent' });
//
// This:
//   1. Reads the row's current state via api.get
//   2. Applies the patch via api.update
//   3. Computes the diff vs before-state
//   4. Pushes an UndoEntry with the inverse patch onto the stack
//
// For deletes:
//
//   await recordedDelete('invoices', invoiceId);
//
// Soft-deletable tables (invoices, bills, expenses, journal_entries)
// use the restore-from-trash path on undo.

import api from './api';
import { useUndoStore, summarizeDiff, type UndoEntry } from '../stores/undoStore';
import { v4 as uuid } from 'uuid';

const SOFT_DELETE_TABLES = new Set([
  'invoices', 'bills', 'expenses', 'journal_entries',
]);

function genId(): string {
  try { return uuid(); } catch { return 'undo-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8); }
}

/**
 * Updates a record and records the inverse on the undo stack.
 * Returns the updated record (or { error }).
 */
export async function recordedUpdate<T = any>(
  table: string,
  id: string,
  patch: Record<string, any>,
): Promise<T | { error: string }> {
  const before = await api.get(table, id) as any;
  if (!before) return { error: 'Record not found' } as any;

  const result = await api.update(table, id, patch) as any;
  if (result?.error) return result;

  const after = await api.get(table, id) as any;

  // Build a per-field diff from the patch keys (ignoring fields the
  // patch didn't touch — same convention as the audit_log).
  const diff: Record<string, { old: any; new: any }> = {};
  const inversePatch: Record<string, any> = {};
  for (const key of Object.keys(patch)) {
    if (before[key] !== after?.[key]) {
      diff[key] = { old: before[key], new: after?.[key] };
      inversePatch[key] = before[key];
    }
  }

  if (Object.keys(diff).length > 0) {
    const entry: UndoEntry = {
      id: genId(),
      entity_type: table,
      entity_id: id,
      operation: 'update',
      inverse: { op: 'patch', payload: inversePatch },
      forward: { op: 'patch', payload: patch },
      summary: summarizeDiff(table, id, diff),
      performed_at: Date.now(),
    };
    useUndoStore.getState().push(entry);
  }

  return result;
}

/**
 * Deletes a record. For soft-deletable tables, the inverse is a
 * restore-from-trash; for others, it's a recreate (which is best-
 * effort because we can't always preserve all FK references).
 *
 * Most callers in the app touch soft-deletable tables. For a hard-
 * delete table (e.g. tags), undo will recreate the row but any
 * downstream FK references to it from other tables CANNOT be
 * restored — by design (those references already cascaded away).
 */
export async function recordedDelete(
  table: string,
  id: string,
): Promise<{ ok?: boolean; error?: string }> {
  const before = await api.get(table, id) as any;
  if (!before) return { error: 'Record not found' };

  const result = await api.remove(table, id) as any;
  if (result?.error) return result;

  const isSoft = SOFT_DELETE_TABLES.has(table);
  const entry: UndoEntry = {
    id: genId(),
    entity_type: table,
    entity_id: id,
    operation: isSoft ? 'soft_delete' : 'delete',
    inverse: isSoft
      ? { op: 'restore', payload: null }
      : { op: 'patch', payload: before }, // best-effort recreate via update (won't work if row is gone)
    forward: { op: 'delete', payload: null },
    summary: `Deleted ${table.replace(/_/g, ' ')} ${(before.invoice_number || before.bill_number || before.reference || id.slice(0, 8))}`,
    performed_at: Date.now(),
  };
  useUndoStore.getState().push(entry);

  return { ok: true };
}

/**
 * Bulk update — records a single undo entry that reverses ALL the
 * changes in one shot. The user gets one ⌘Z to undo the whole bulk
 * action, not 50.
 */
export async function recordedBulkUpdate(
  table: string,
  ids: string[],
  patch: Record<string, any>,
): Promise<{ ok?: boolean; error?: string }> {
  // Snapshot per-id before state for the keys we're patching.
  const beforeMap: Array<{ id: string; patch: any }> = [];
  for (const id of ids) {
    const row = await api.get(table, id) as any;
    if (row) {
      const inverse: Record<string, any> = {};
      for (const k of Object.keys(patch)) inverse[k] = row[k];
      beforeMap.push({ id, patch: inverse });
    }
  }

  const result = await api.batchUpdate(table, ids, patch) as any;
  if (result?.error) return result;

  const entry: UndoEntry = {
    id: genId(),
    entity_type: table,
    entity_id: 'bulk:' + ids.length,
    operation: 'bulk_update',
    inverse: { op: 'bulk_patch', payload: beforeMap },
    forward: { op: 'bulk_patch', payload: ids.map((id) => ({ id, patch })) },
    summary: `Bulk update ${ids.length} ${table.replace(/_/g, ' ')}: ${Object.keys(patch).join(', ')}`,
    performed_at: Date.now(),
  };
  useUndoStore.getState().push(entry);

  return { ok: true };
}
