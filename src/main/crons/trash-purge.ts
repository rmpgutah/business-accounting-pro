// src/main/crons/trash-purge.ts
//
// P1.13 — Auto-Purge Soft-Deleted Records
//
// Physically removes records that have sat in trash longer than the
// retention window (default 30 days). Runs once at app startup +
// once daily thereafter.
//
// Why a separate cron rather than inline in db.remove():
//   • Single chokepoint for retention policy — easy to tune via a
//     setting later without touching delete call sites
//   • Doesn't slow down user-facing delete operations
//   • Catches records that were soft-deleted and never explicitly
//     emptied, even if the user never opens the Trash UI
//
// Per-company retention: each company can override via the
// 'trash_retention_days' setting (clamped 1-365). Defaults to 30 if
// unset. Setting per-company supports tenants with different
// compliance regimes (e.g. SOX requires longer retention).

import * as db from '../database';

export interface PurgeResult {
  totalPurged: number;
  byTable: Record<string, number>;
  companiesScanned: number;
  errors: string[];
}

function getRetentionDays(companyId: string): number {
  try {
    const row = db.getDb().prepare(
      "SELECT value FROM settings WHERE company_id = ? AND key = 'trash_retention_days'"
    ).get(companyId) as { value?: string } | undefined;
    const v = parseInt(row?.value ?? '', 10);
    if (Number.isFinite(v) && v >= 1) return Math.min(v, 365);
  } catch { /* fall through */ }
  return 30;
}

export function runTrashPurge(): PurgeResult {
  const result: PurgeResult = {
    totalPurged: 0,
    byTable: {},
    companiesScanned: 0,
    errors: [],
  };

  let companies: Array<{ id: string }>;
  try {
    companies = db.getDb().prepare(`SELECT id FROM companies`).all() as any;
  } catch (err: any) {
    result.errors.push(`Failed to list companies: ${err?.message || err}`);
    return result;
  }

  for (const { id: companyId } of companies) {
    result.companiesScanned++;
    const retentionDays = getRetentionDays(companyId);

    // For each soft-deletable table, physically delete records whose
    // deleted_at is older than the retention cutoff. Per-company
    // scoping is implicit in the WHERE clause.
    for (const table of db.SOFT_DELETE_TABLES) {
      try {
        const cutoff = `datetime('now', '-${retentionDays} days')`;
        const found = db.getDb().prepare(
          `SELECT id FROM ${table} WHERE company_id = ? AND deleted_at IS NOT NULL AND deleted_at < ${cutoff}`
        ).all(companyId) as Array<{ id: string }>;
        for (const r of found) {
          // FK cleanup now that the row is leaving for good. Best
          // effort — if it fails the DELETE may throw, which we
          // catch below (the row stays in trash, retried tomorrow).
          try {
            const { cleanupReferencesBeforeDelete } = require('../ipc');
            if (typeof cleanupReferencesBeforeDelete === 'function') {
              cleanupReferencesBeforeDelete(table, r.id);
            }
          } catch { /* cleanup helper not exported — skip */ }
          db.removeHard(table, r.id);
          result.byTable[table] = (result.byTable[table] || 0) + 1;
          result.totalPurged++;
        }
      } catch (err: any) {
        result.errors.push(`${table} (company ${companyId}): ${err?.message || err}`);
      }
    }
  }

  return result;
}
