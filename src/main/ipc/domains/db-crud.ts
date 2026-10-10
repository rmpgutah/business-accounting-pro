import type { IpcMain } from 'electron';
import * as db from '../../database';
import { TABLES_WITHOUT_COMPANY_ID } from '../../database/tableConfig';
import { syncPush } from '../../sync';
import { evaluateRules, mergePatches, rulesAppliedSummary } from '../../rules';
import { eventBus } from '../../services/EventBus';
import type { IpcDeps } from '../core/types';

export function registerDbCrudIpc(ipcMain: IpcMain, deps: IpcDeps): void {
  const {
    scheduleAutoBackup,
    scheduleReindex,
    logDebtAudit,
    validateTable,
    cleanupReferencesBeforeDelete,
    isRawQueryAllowed,
    PROTECTED_TABLES,
  } = deps;

  // Tables that do NOT have a company_id column (child/junction tables)
  // WARNING: only list tables whose schema truly has no company_id column.
  // payments and categories both have company_id NOT NULL — never put them here.
  // SCHEMA: imported from tableConfig.ts for single source of truth.
  const tablesWithoutCompanyId = TABLES_WITHOUT_COMPANY_ID;

  // ─── Generic CRUD ────────────────────────────────────
  ipcMain.handle('db:query', (_event, { table, filters, sort, limit, offset }) => {
    if (!validateTable(table)) return [];
    return db.queryAll(table, filters, sort, limit, offset);
  });

  ipcMain.handle('db:get', (_event, { table, id }) => {
    if (!validateTable(table)) return null;
    return db.getById(table, id);
  });

  ipcMain.handle('db:create', (_event, { table, data }) => {
    if (!validateTable(table)) return { error: 'Invalid table' };
    if (PROTECTED_TABLES.has(table))
      return { error: `Direct writes to ${table} are not allowed — use dedicated handler` };
    try {
      const companyId = db.getCurrentCompanyId();
      // INTEGRITY: ignore any caller-supplied `id`. The renderer should never
      // pick primary keys — at best it hands us a stale uuid, at worst a
      // collision with an existing row. db.create() generates a uuid when id
      // is absent.
      if (data && typeof data === 'object' && 'id' in data) {
        delete data.id;
      }
      const payload = tablesWithoutCompanyId.has(table)
        ? { ...data }
        : { ...data, company_id: companyId };
      // Apply rules for invoices
      if (table === 'invoices' && payload.company_id) {
        const pricingResults = evaluateRules({
          category: 'pricing',
          record: payload,
          company_id: String(payload.company_id),
          db: db.getDb(),
        });
        const taxResults = evaluateRules({
          category: 'tax',
          record: payload,
          company_id: String(payload.company_id),
          db: db.getDb(),
        });
        Object.assign(payload, mergePatches([...pricingResults, ...taxResults]));
        payload.rules_applied = rulesAppliedSummary([...pricingResults, ...taxResults]);
      }
      // Apply tax rules for expenses
      if (table === 'expenses' && payload.company_id) {
        const taxResults = evaluateRules({
          category: 'tax',
          record: payload,
          company_id: String(payload.company_id),
          db: db.getDb(),
        });
        Object.assign(payload, mergePatches(taxResults));
        payload.rules_applied = rulesAppliedSummary(taxResults);
      }
      // Apply approval rules for invoices, expenses, bills
      if (
        (table === 'invoices' || table === 'expenses' || table === 'bills') &&
        payload.company_id
      ) {
        const approvalResults = evaluateRules({
          category: 'approval',
          record: { ...payload, _type: table },
          company_id: String(payload.company_id),
          db: db.getDb(),
        });
        if (approvalResults.some((r) => r.matched)) payload.status = 'pending_approval';
      }
      const record = db.create(table, payload);
      if (companyId) db.logAudit(companyId, table, record.id, 'create');
      scheduleReindex(table, record.id as string, 'upsert');
      // Debt child table audit
      const DEBT_CHILD_AUDIT: Record<string, string> = {
        debt_payments: 'payment_recorded',
        debt_communications: 'communication_logged',
        debt_disputes: 'dispute_filed',
      };
      if (DEBT_CHILD_AUDIT[table] && (data.debt_id || payload.debt_id)) {
        logDebtAudit(
          data.debt_id || payload.debt_id,
          DEBT_CHILD_AUDIT[table],
          table,
          '',
          record?.id || '',
        );
      }
      syncPush({
        table,
        operation: 'create',
        id: record.id as string,
        data: payload as Record<string, unknown>,
        companyId: companyId ?? '',
        timestamp: Date.now(),
      }).catch(() => {});
      scheduleAutoBackup();
      // Reactive engine: emit semantic events for known table types so workflows can react.
      try {
        if (companyId && record?.id) {
          const eventTypeMap: Record<string, string> = {
            clients: 'client.created',
            vendors: 'vendor.created',
            time_entries: 'time.entry_created',
            quotes: 'quote.created',
            debts: 'debt.created',
            projects: 'project.created',
            budgets: 'budget.created',
            bills: 'bill.created',
            fixed_assets: 'asset.acquired',
          };
          const evtType = eventTypeMap[table];
          if (evtType) {
            eventBus
              .emit({
                type: evtType as any,
                companyId,
                entityType: table,
                entityId: record.id as string,
                data: payload as Record<string, any>,
              })
              .catch(() => {});
          }
        }
      } catch {
        /* fire-and-forget */
      }
      return record;
    } catch (err) {
      console.error(`db:create [${table}] failed:`, err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('db:update', (_event, { table, id, data }) => {
    if (!validateTable(table)) return { error: 'Invalid table' };
    if (PROTECTED_TABLES.has(table))
      return { error: `Direct writes to ${table} are not allowed — use dedicated handler` };
    // INTEGRITY: audit_log / debt_audit_log / debt_compliance_log are append-only.
    // Mutating audit rows defeats the purpose of having an audit trail.
    if (table === 'audit_log' || table === 'debt_audit_log' || table === 'debt_compliance_log') {
      return { error: `${table} is append-only` };
    }
    try {
      // INTEGRITY: never let the renderer rewrite `id` or `created_at` on update.
      // Both are sometimes hydrated into form state and would silently mutate
      // primary keys / row provenance if echoed back through the patch payload.
      if (data && typeof data === 'object') {
        delete data.id;
        delete data.created_at;
      }
      const old = db.getById(table, id);
      const record = db.update(table, id, data);
      const companyId = db.getCurrentCompanyId();
      if (companyId && old) {
        const changes: Record<string, any> = {};
        for (const key of Object.keys(data)) {
          if (old[key] !== record[key]) {
            changes[key] = { old: old[key], new: record[key] };
          }
        }
        db.logAudit(companyId, table, id, 'update', changes);
      }
      scheduleReindex(table, id, 'upsert');
      // Debt audit: log each changed field
      if (table === 'debts' && id && old) {
        try {
          const newRow = db.getById('debts', id);
          if (newRow) {
            for (const key of Object.keys(data)) {
              const oldVal = String(old[key] ?? '');
              const newVal = String(newRow[key] ?? '');
              if (oldVal !== newVal) {
                logDebtAudit(id, 'field_edit', key, oldVal, newVal);
              }
            }
          }
        } catch (_) {}
      }
      syncPush({
        table,
        operation: 'update',
        id,
        data: { id, ...data } as Record<string, unknown>,
        companyId: companyId ?? '',
        timestamp: Date.now(),
      }).catch(() => {});
      scheduleAutoBackup();
      return record;
    } catch (err) {
      console.error(`db:update [${table}:${id}] failed:`, err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('db:delete', (_event, { table, id }) => {
    if (!validateTable(table)) return { error: 'Invalid table' };
    if (PROTECTED_TABLES.has(table))
      return { error: `Direct deletes from ${table} are not allowed — use dedicated handler` };
    // SECURITY: audit_log must be append-only. Without this guard the renderer
    // can wipe its own breadcrumb trail (delete-me-then-delete-evidence).
    if (table === 'audit_log' || table === 'debt_audit_log' || table === 'debt_compliance_log') {
      return { error: `${table} is append-only` };
    }
    try {
      // Debt child table audit — read debt_id before deletion
      const DEBT_AUDIT_TABLES = [
        'debt_payments',
        'debt_communications',
        'debt_evidence',
        'debt_legal_actions',
        'debt_settlements',
        'debt_disputes',
        'debt_contacts',
        'debt_promises',
        'debt_notes',
      ];
      if (DEBT_AUDIT_TABLES.includes(table)) {
        try {
          const row = db.getById(table, id);
          if (row?.debt_id) logDebtAudit(row.debt_id, 'record_deleted', table, id, '');
        } catch (_) {}
      }
      const companyId = db.getCurrentCompanyId();
      if (companyId) db.logAudit(companyId, table, id, 'delete');
      // P1.13: skip FK cleanup for soft-deletable tables — the row
      // stays physically present so FK references remain valid.
      // Cleanup only happens when the auto-purge cron physically
      // removes the row 30 days later (via removeHard), at which
      // point the same logic runs.
      if (!db.SOFT_DELETE_TABLES.has(table)) {
        cleanupReferencesBeforeDelete(table, id);
      }
      db.remove(table, id);
      scheduleReindex(table, id, 'delete');
      syncPush({
        table,
        operation: 'delete',
        id,
        data: { id },
        companyId: companyId ?? '',
        timestamp: Date.now(),
      }).catch(() => {});
      scheduleAutoBackup();
    } catch (err) {
      console.error(`db:delete [${table}:${id}] failed:`, err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('trash:list', () => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return { items: {} };
      const items = db.listTrash(companyId, 100);
      return { items };
    } catch (err: any) {
      return { error: err?.message || 'Failed to list trash' };
    }
  });

  ipcMain.handle('trash:restore', (_event, { table, id }: { table: string; id: string }) => {
    try {
      if (!db.SOFT_DELETE_TABLES.has(table))
        return { error: `Table ${table} does not support restore` };
      const ok = db.restoreFromTrash(table, id);
      if (!ok) return { error: 'Record not in trash or already restored' };
      const companyId = db.getCurrentCompanyId();
      if (companyId) db.logAudit(companyId, table, id, 'trash_restore');
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message || 'Restore failed' };
    }
  });

  ipcMain.handle('trash:purge', (_event, { table, id }: { table: string; id: string }) => {
    try {
      if (!db.SOFT_DELETE_TABLES.has(table))
        return { error: `Table ${table} does not support purge` };
      // Run FK cleanup now since this is a true physical delete.
      try {
        cleanupReferencesBeforeDelete(table, id);
      } catch (_) {
        /* best-effort */
      }
      db.removeHard(table, id);
      const companyId = db.getCurrentCompanyId();
      if (companyId) db.logAudit(companyId, table, id, 'trash_purge');
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message || 'Purge failed' };
    }
  });

  ipcMain.handle('trash:empty', () => {
    try {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return { ok: false, error: 'No active company' };
      // Empty Trash purges ALL soft-deleted records for the company,
      // regardless of age. (Auto-purge cron handles age-based culling.)
      let purged = 0;
      for (const table of db.SOFT_DELETE_TABLES) {
        const rows = db
          .getDb()
          .prepare(`SELECT id FROM ${table} WHERE company_id = ? AND deleted_at IS NOT NULL`)
          .all(companyId) as Array<{ id: string }>;
        for (const r of rows) {
          try {
            cleanupReferencesBeforeDelete(table, r.id);
          } catch (_) {}
          db.removeHard(table, r.id);
          purged++;
        }
      }
      if (companyId) db.logAudit(companyId, 'trash', 'empty', 'trash_empty', { purged });
      scheduleAutoBackup();
      return { ok: true, purged };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Empty trash failed' };
    }
  });

  // ─── Raw Query (for reports/aggregations) ────────────
  // SECURITY: The renderer can supply arbitrary SQL via this handler — historically a
  // privilege-escalation vector (renderer could DROP TABLE, ATTACH another DB, exfiltrate
  // password_hash via SELECT *, etc.). We don't have a small enough set of named queries to
  // switch to a strict allowlist without rewriting most reports/dashboards, so we apply a
  // SQL-shape filter:
  //   • Reject multi-statement SQL (any `;` outside string literals) — blocks stacked queries.
  //   • Reject DDL & sensitive verbs (DROP, ALTER, CREATE, ATTACH, DETACH, PRAGMA, VACUUM, REINDEX).
  //   • Allow only SELECT/WITH/INSERT/UPDATE/DELETE/REPLACE as the leading verb.
  // Any further tightening (e.g. table allowlist for writes) lives in the per-table CRUD handlers.
  ipcMain.handle('db:raw-query', (_event, { sql, params }) => {
    const check = isRawQueryAllowed(sql);
    if (!check.ok) {
      console.warn('db:raw-query rejected:', check.reason, sql?.slice(0, 200));
      return { error: `SQL rejected: ${check.reason}` };
    }
    return db.runQuery(sql, params);
  });
}
