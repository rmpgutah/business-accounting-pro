import type { IpcMain } from 'electron';
import * as db from '../../database';
import { TABLES_WITHOUT_COMPANY_ID } from '../../database/tableConfig';
import { syncPush } from '../../sync';
import { evaluateRules, mergePatches, rulesAppliedSummary } from '../../rules';
import { eventBus } from '../../services/EventBus';
import type { IpcDeps } from '../core/types';
import { dialog, app } from 'electron';
import { v4 as uuid } from 'uuid';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { copyIntoDocumentsStore } from '../../services/document-storage';
import { openPathInOS } from '../../services/print-preview';

// ─── CSV Helpers (shared by import/export handlers) ──────
function escapeCSVField(val: any): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  return str.includes(',') || str.includes('"') || str.includes('\n')
    ? `"${str.replace(/"/g, '""')}"`
    : str;
}

function rowsToCSV(rows: any[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((h) => escapeCSVField(row[h])).join(',')),
  ].join('\n');
}

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === '\n' && !inQuotes) {
      lines.push(current);
      current = '';
    } else if (ch === '\r' && !inQuotes) {
      // skip carriage returns
    } else {
      current += ch;
    }
  }
  if (current) lines.push(current);

  const splitLine = (line: string): string[] => {
    const fields: string[] = [];
    let field = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (q && line[i + 1] === '"') {
          field += '"';
          i++;
        } else q = !q;
      } else if (c === ',' && !q) {
        fields.push(field);
        field = '';
      } else {
        field += c;
      }
    }
    fields.push(field);
    return fields;
  };

  const headers = lines.length > 0 ? splitLine(lines[0]) : [];
  const rows = lines
    .slice(1)
    .filter((l) => l.trim())
    .map(splitLine);
  return { headers, rows };
}

export function registerDbCrudIpc(ipcMain: IpcMain, deps: IpcDeps): void {
  const {
    scheduleAutoBackup,
    scheduleReindex,
    logDebtAudit,
    validateTable,
    cleanupReferencesBeforeDelete,
    isRawQueryAllowed,
    PROTECTED_TABLES,
    localToday,
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
  // ─── Document Upload (copies file into app-managed storage) ──
  ipcMain.handle(
    'documents:upload',
    async (
      _event,
      args: {
        companyId: string;
        entityType: string;
        entityId: string;
        filters?: Array<{ name: string; extensions: string[] }>;
      },
    ) => {
      const { companyId, entityType, entityId, filters } = args;
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: filters || [{ name: 'All Files', extensions: ['*'] }],
      });
      if (result.canceled || !result.filePaths.length) return null;

      const sourcePath = result.filePaths[0];
      const filename = path.basename(sourcePath);
      const stored = copyIntoDocumentsStore(app.getPath('userData'), companyId, sourcePath);

      const doc = db.create('documents', {
        company_id: companyId,
        filename,
        file_path: stored.path,
        file_size: stored.size,
        mime_type: stored.mimeType,
        entity_type: entityType,
        entity_id: entityId,
        tags: '',
        uploaded_at: new Date().toISOString(),
      });
      scheduleAutoBackup();
      return doc;
    },
  );
  // ─── Open a stored document in the OS default app ────────────
  ipcMain.handle('documents:open-path', async (_event, filePath: string) => {
    return openPathInOS(filePath);
  });
  // ─── CSV Export ────────────────────────────────────────
  // ─── Auth ──────────────────────────────────────────────

  ipcMain.handle(
    'export:csv',
    async (_event, { table, filters }: { table: string; filters?: Record<string, any> }) => {
      if (!validateTable(table)) return { error: 'Invalid table' };
      const rows = db.queryAll(table, filters || {});
      if (rows.length === 0) return { error: 'No data to export' };

      const csv = rowsToCSV(rows);

      const { filePath } = await dialog.showSaveDialog({
        defaultPath: `${table}-export.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });

      if (!filePath) return { cancelled: true };
      fs.writeFileSync(filePath, csv, 'utf-8');
      return { path: filePath };
    },
  );
  // ─── Batch Update ──────────────────────────────────────
  ipcMain.handle(
    'batch:update',
    (_event, { table, ids, data }: { table: string; ids: string[]; data: Record<string, any> }) => {
      const companyId = db.getCurrentCompanyId();
      const results: any[] = [];
      for (const id of ids) {
        const old = db.getById(table, id);
        const record = db.update(table, id, data);
        if (companyId && old) {
          const changes: Record<string, any> = {};
          for (const key of Object.keys(data)) {
            if (old[key] !== record[key]) {
              changes[key] = { old: old[key], new: record[key] };
            }
          }
          db.logAudit(companyId, table, id, 'update', changes);
        }
        results.push(record);
      }
      if (results.length) scheduleAutoBackup();
      return results;
    },
  );
  // ─── Batch Delete ──────────────────────────────────────
  ipcMain.handle('batch:delete', (_event, { table, ids }: { table: string; ids: string[] }) => {
    const companyId = db.getCurrentCompanyId();
    const errors: Array<{ id: string; error: string }> = [];
    let deleted = 0;
    for (const id of ids) {
      try {
        if (companyId) db.logAudit(companyId, table, id, 'delete');
        // Clean up FK references in related tables BEFORE the parent delete.
        cleanupReferencesBeforeDelete(table, id);
        db.remove(table, id);
        deleted++;
      } catch (err: any) {
        errors.push({ id, error: err?.message || 'unknown error' });
      }
    }
    if (deleted) scheduleAutoBackup();
    if (errors.length) {
      return {
        deleted,
        errors,
        error: `Deleted ${deleted} of ${ids.length}. ${errors.length} failed: ${errors
          .map((e) => e.error)
          .slice(0, 3)
          .join('; ')}`,
      };
    }
    return { deleted };
  });
  // ─── CSV Import: Preview ──────────────────────────────
  ipcMain.handle('import:preview-csv', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePaths.length) return null;

    const importPath = result.filePaths[0];
    const content = fs.readFileSync(importPath, 'utf-8');
    const { headers, rows } = parseCSV(content);

    return {
      filePath: importPath,
      fileName: path.basename(importPath),
      headers,
      previewRows: rows.slice(0, 5),
      totalRows: rows.length,
    };
  });
  // ─── CSV Import: Execute ──────────────────────────────
  ipcMain.handle(
    'import:execute',
    (
      _event,
      {
        filePath: importFilePath,
        columnMapping,
        targetTable,
      }: {
        filePath: string;
        columnMapping: Record<string, string>;
        targetTable: string;
      },
    ) => {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return { error: 'No company selected' };

      const content = fs.readFileSync(importFilePath, 'utf-8');
      const { headers, rows } = parseCSV(content);

      let imported = 0;
      let skipped = 0;
      const importErrors: string[] = [];

      for (let i = 0; i < rows.length; i++) {
        try {
          const row = rows[i];
          const record: Record<string, any> = { company_id: companyId };

          for (const [csvCol, dbCol] of Object.entries(columnMapping)) {
            if (!dbCol || dbCol === '(skip)') continue;
            const idx = headers.indexOf(csvCol);
            if (idx === -1) continue;
            record[dbCol] = row[idx] ?? '';
          }

          const hasData = Object.values(record).some((v) => v !== '' && v !== companyId);
          if (!hasData) {
            skipped++;
            continue;
          }

          db.create(targetTable, record);
          imported++;
        } catch (err: any) {
          skipped++;
          importErrors.push(`Row ${i + 2}: ${err.message || 'Unknown error'}`);
        }
      }

      if (imported > 0) scheduleAutoBackup();
      return { imported, skipped, errors: importErrors.slice(0, 20), total: rows.length };
    },
  );
  // ─── Full Backup: Export all tables as ZIP ─────────────
  ipcMain.handle('export:full-backup', async () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { error: 'No company selected' };

    const { filePath: zipPath } = await dialog.showSaveDialog({
      defaultPath: `backup-${localToday()}.zip`,
      filters: [{ name: 'ZIP Archive', extensions: ['zip'] }],
    });

    if (!zipPath) return { cancelled: true };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bap-backup-'));

    // Tables with direct company_id column
    const directTables = [
      'clients',
      'invoices',
      'expenses',
      'vendors',
      'accounts',
      'journal_entries',
      'projects',
      'employees',
      'time_entries',
      'categories',
      'payments',
      'budgets',
      'bank_accounts',
      'documents',
      'recurring_templates',
      'tax_categories',
      'tax_payments',
      'inventory_items',
    ];

    // Child tables without company_id — filter through parent FK
    const childTableQueries: Record<string, string> = {
      invoice_line_items: `SELECT li.* FROM invoice_line_items li
        JOIN invoices i ON li.invoice_id = i.id WHERE i.company_id = ?`,
      journal_entry_lines: `SELECT jl.* FROM journal_entry_lines jl
        JOIN journal_entries je ON jl.journal_entry_id = je.id WHERE je.company_id = ?`,
      pay_stubs: `SELECT ps.* FROM pay_stubs ps
        JOIN payroll_runs pr ON ps.payroll_run_id = pr.id WHERE pr.company_id = ?`,
      budget_lines: `SELECT bl.* FROM budget_lines bl
        JOIN budgets b ON bl.budget_id = b.id WHERE b.company_id = ?`,
      bank_transactions: `SELECT bt.* FROM bank_transactions bt
        JOIN bank_accounts ba ON bt.bank_account_id = ba.id WHERE ba.company_id = ?`,
    };

    const exportedFiles: string[] = [];
    const dbInstance = db.getDb();

    // Export direct-company tables
    for (const tbl of directTables) {
      try {
        const tblRows = db.queryAll(tbl, { company_id: companyId });
        if (tblRows.length === 0) continue;
        const csvContent = rowsToCSV(tblRows);
        const csvFilePath = path.join(tmpDir, `${tbl}.csv`);
        fs.writeFileSync(csvFilePath, csvContent, 'utf-8');
        exportedFiles.push(csvFilePath);
      } catch {
        // Skip tables that error (schema mismatch, etc.)
      }
    }

    // Export child tables filtered via parent join
    for (const [tbl, sql] of Object.entries(childTableQueries)) {
      try {
        const tblRows = dbInstance.prepare(sql).all(companyId) as any[];
        if (tblRows.length === 0) continue;
        const csvContent = rowsToCSV(tblRows);
        const csvFilePath = path.join(tmpDir, `${tbl}.csv`);
        fs.writeFileSync(csvFilePath, csvContent, 'utf-8');
        exportedFiles.push(csvFilePath);
      } catch {
        // Skip on error
      }
    }

    if (exportedFiles.length === 0) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return { error: 'No data to export' };
    }

    try {
      const { execFileSync } = require('child_process');
      const fileNames = exportedFiles.map((f) => path.basename(f));
      execFileSync('zip', ['-j', zipPath, ...fileNames], { cwd: tmpDir });
    } catch {
      const fallbackDir = zipPath.replace('.zip', '-csvs');
      if (!fs.existsSync(fallbackDir)) fs.mkdirSync(fallbackDir, { recursive: true });
      for (const f of exportedFiles) {
        fs.copyFileSync(f, path.join(fallbackDir, path.basename(f)));
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return { path: fallbackDir, format: 'folder' };
    }

    fs.rmSync(tmpDir, { recursive: true, force: true });
    return { path: zipPath, format: 'zip', tableCount: exportedFiles.length };
  });
  ipcMain.handle('record:clone', (_event, { table, id }: { table: string; id: string }) => {
    const CLONEABLE_TABLES = ['invoices', 'expenses', 'bills'];
    if (!CLONEABLE_TABLES.includes(table)) return { error: 'Invalid table' };
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { error: 'No active company' };
    const dbInstance = db.getDb();
    const original = dbInstance.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as
      Record<string, unknown> | undefined;
    if (!original) return { error: 'Not found' };
    const newId = uuid();
    const today = new Date().toISOString().split('T')[0];
    const clone: Record<string, unknown> = {
      ...original,
      id: newId,
      created_at: new Date().toISOString(),
      status: 'draft',
      rules_applied: '[]',
    };

    if (table === 'invoices') {
      // Generate next invoice number to satisfy NOT NULL + UNIQUE constraint
      const lastInv = dbInstance
        .prepare(
          `SELECT invoice_number FROM invoices WHERE company_id = ? ORDER BY created_at DESC LIMIT 1`,
        )
        .get(companyId) as any;
      let nextInvNumber = 'INV-1001';
      if (lastInv?.invoice_number) {
        const m = lastInv.invoice_number.match(/(\d+)$/);
        if (m) {
          const prefix = lastInv.invoice_number.slice(
            0,
            lastInv.invoice_number.length - m[1].length,
          );
          nextInvNumber = `${prefix}${String(parseInt(m[1], 10) + 1).padStart(m[1].length, '0')}`;
        }
      }
      clone.invoice_number = nextInvNumber;
      clone.issue_date = today;
      delete clone.paid_date;
      clone.amount_paid = 0;
    }

    if (table === 'bills') {
      // Generate next bill number
      const lastBill = dbInstance
        .prepare(
          `SELECT bill_number FROM bills WHERE company_id = ? ORDER BY created_at DESC LIMIT 1`,
        )
        .get(companyId) as any;
      let nextBillNumber = 'BILL-1001';
      if (lastBill?.bill_number) {
        const m = lastBill.bill_number.match(/(\d+)$/);
        if (m) {
          const prefix = lastBill.bill_number.slice(0, lastBill.bill_number.length - m[1].length);
          nextBillNumber = `${prefix}${String(parseInt(m[1], 10) + 1).padStart(m[1].length, '0')}`;
        }
      }
      clone.bill_number = nextBillNumber;
      clone.issue_date = today;
      clone.amount_paid = 0;
    }

    if (table === 'expenses') {
      clone.date = today;
    }

    const cloneTx = dbInstance.transaction(() => {
      const cols = Object.keys(clone);
      dbInstance
        .prepare(
          `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`,
        )
        .run(clone);

      // Clone child line items
      const LINE_ITEM_TABLES: Record<string, string> = {
        invoices: 'invoice_line_items',
        bills: 'bill_line_items',
        expenses: 'expense_line_items',
      };
      const lineTable = LINE_ITEM_TABLES[table];
      const parentCol =
        table === 'invoices' ? 'invoice_id' : table === 'bills' ? 'bill_id' : 'expense_id';
      if (lineTable) {
        const lines = dbInstance
          .prepare(`SELECT * FROM ${lineTable} WHERE ${parentCol} = ?`)
          .all(id) as any[];
        for (const line of lines) {
          const newLine = { ...line, id: uuid(), [parentCol]: newId };
          const lineCols = Object.keys(newLine);
          dbInstance
            .prepare(
              `INSERT INTO ${lineTable} (${lineCols.join(',')}) VALUES (${lineCols.map((c) => '@' + c).join(',')})`,
            )
            .run(newLine);
        }
      }
    });
    cloneTx();
    scheduleAutoBackup();
    return { id: newId };
  });
}
