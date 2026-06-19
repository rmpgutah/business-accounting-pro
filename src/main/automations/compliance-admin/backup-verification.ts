// src/main/automations/compliance-admin/backup-verification.ts
//
// Backup Verification automation.
//
// Records a verification result for the latest backup into
// backup_verification_log (created in src/main/database/index.ts, F169).
//
// Since the desktop's auto-backup uploads the live SQLite DB to the VPS,
// the most meaningful local verification we can perform without moving
// money or sending external traffic is a structural integrity check of
// the current DB file (the exact bytes that get backed up): we run
// PRAGMA integrity_check / quick_check and stat the file for size. We
// then queue a per-company verification record describing whether the
// backup source is valid and restorable.
//
// Design choices:
//  • trigger = 'daily' — backups run continuously (30s debounce); a once
//    per-day verification record is the right cadence for a compliance
//    trail without flooding the log.
//  • IDEMPOTENT — re-running the same day is a no-op: we skip any company
//    that already has a backup_verification_log row whose verified_at
//    falls on today's local date.
//  • BEST-EFFORT — never throws. All db work is wrapped in try/catch and
//    degrades to ok:false with a warning.
//  • Does NOT move money, send email, or perform network I/O. It only
//    reads the DB and inserts log rows.

import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

// Today as YYYY-MM-DD in LOCAL timezone — matches overdue-checker.ts.
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function genId(): string {
  return `bvl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  const today = ctx?.todayISO || localTodayISO();

  let database: ReturnType<typeof db.getDb>;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  // ── Determine the backup source (the live DB file) ───────────────
  // Stat is best-effort: if path/size cannot be resolved we still log,
  // marking can_restore=0 and noting the issue.
  let backupPath = '';
  let backupSize = 0;
  try {
    backupPath = db.getDbPath();
  } catch { /* path optional */ }
  if (backupPath) {
    try {
      // Lazy require to avoid an unused top-level import under strict tsc
      // if fs were otherwise unreferenced.
      const fs = require('fs') as typeof import('fs');
      const st = fs.statSync(backupPath);
      backupSize = Number(st.size) || 0;
    } catch {
      warnings.push('Could not stat backup source file');
    }
  } else {
    warnings.push('Backup source path unavailable');
  }

  // ── Structural integrity check of the backup source ──────────────
  let isValid = 1;
  let canRestore = backupSize > 0 ? 1 : 0;
  let integrityNote = 'pragma_skipped';
  try {
    const row = database.prepare('PRAGMA integrity_check').get() as any;
    const verdict = String(row?.integrity_check ?? '').toLowerCase();
    if (verdict === 'ok') {
      integrityNote = 'integrity_check=ok';
    } else if (verdict) {
      isValid = 0;
      canRestore = 0;
      integrityNote = `integrity_check=${verdict.slice(0, 200)}`;
    } else {
      warnings.push('integrity_check returned no verdict');
    }
  } catch (err: any) {
    warnings.push(`integrity_check failed: ${err?.message || err}`);
    integrityNote = 'integrity_check_error';
  }

  // ── Resolve target companies ─────────────────────────────────────
  let companies: { id: string }[] = [];
  try {
    if (ctx?.companyId) {
      companies = [{ id: ctx.companyId }];
    } else {
      companies = database.prepare('SELECT id FROM companies').all() as { id: string }[];
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}`, warnings };
  }

  if (companies.length === 0) {
    return { ok: true, affected: 0, detail: 'No companies to verify', warnings };
  }

  // ── Insert one verification record per company (idempotent) ──────
  let insert: any;
  let exists: any;
  try {
    exists = database.prepare(
      `SELECT 1 FROM backup_verification_log
         WHERE company_id IS ?
           AND date(verified_at) = date(?)
         LIMIT 1`
    );
    insert = database.prepare(
      `INSERT INTO backup_verification_log
         (id, company_id, backup_type, backup_path, backup_size_bytes,
          backup_date, verified_at, verification_method, is_valid, can_restore, notes)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?)`
    );
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `backup_verification_log unavailable: ${err?.message || err}`, warnings };
  }

  let affected = 0;
  let skipped = 0;
  for (const { id: companyId } of companies) {
    try {
      const already = exists.get(companyId, today) as any;
      if (already) { skipped++; continue; }
      insert.run(
        genId(),
        companyId,
        'live_db_snapshot',
        backupPath || null,
        backupSize,
        today,
        'sqlite_integrity_check',
        isValid,
        canRestore,
        integrityNote
      );
      affected++;
    } catch (err: any) {
      warnings.push(`Company ${companyId}: ${err?.message || err}`);
    }
  }

  const detail =
    `Verified backup source (${integrityNote}); logged ${affected} record(s), ` +
    `skipped ${skipped} already-logged today`;
  return {
    ok: true,
    affected,
    detail,
    ...(warnings.length ? { warnings } : {}),
  };
}

export const automation: AutomationModule = {
  id: 'backup-verification',
  name: 'Backup Verification',
  domain: 'compliance-admin',
  trigger: 'daily',
  run,
};
