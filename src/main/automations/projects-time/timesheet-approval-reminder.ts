// src/main/automations/projects-time/timesheet-approval-reminder.ts
//
// Timesheet Approval Reminder
// ---------------------------
// Reminds approvers of timesheet_approvals that are still pending. For each
// company, finds pending approval rows and QUEUES a notification per approver
// (we never send email or move money). Idempotent: a notification is only
// inserted once per (approver, day) by deduping on the notifications table's
// (entity_type, entity_id) + same-day created_at — re-running the same day is
// a no-op.
//
// DEFENSIVE NOTE: the `timesheet_approvals` table is not guaranteed to exist
// in this schema. Every db access is wrapped in try/catch; if the table or a
// required column is missing we degrade to { ok:false } with a warning rather
// than throwing. run() is best-effort and MUST NEVER throw.

import * as db from '../../database';

export interface AutomationResult {
  ok: boolean;
  affected: number;
  detail: string;
  warnings?: string[];
}

export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

// Local YYYY-MM-DD, matching src/main/crons/overdue-checker.ts.
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function tableExists(database: any, name: string): boolean {
  try {
    const row = database
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
      .get(name) as { name?: string } | undefined;
    return !!row?.name;
  } catch {
    return false;
  }
}

function columnSet(database: any, table: string): Set<string> {
  const cols = new Set<string>();
  try {
    const rows = database.prepare(`PRAGMA table_info(${table})`).all() as any[];
    for (const r of rows) if (r && r.name) cols.add(String(r.name));
  } catch {
    /* ignore */
  }
  return cols;
}

function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  let affected = 0;

  let database: any;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  // Required tables.
  if (!tableExists(database, 'timesheet_approvals')) {
    return {
      ok: false,
      affected: 0,
      detail: 'timesheet_approvals table does not exist; nothing to remind on.',
      warnings: ['Skipped: timesheet_approvals table not found in schema.'],
    };
  }
  if (!tableExists(database, 'notifications')) {
    return {
      ok: false,
      affected: 0,
      detail: 'notifications table does not exist; cannot queue reminders.',
      warnings: ['Skipped: notifications table not found in schema.'],
    };
  }

  const taCols = columnSet(database, 'timesheet_approvals');
  if (taCols.size === 0) {
    return { ok: false, affected: 0, detail: 'Could not read timesheet_approvals schema.' };
  }

  // Resolve usable column names defensively (schema variants).
  const idCol = taCols.has('id') ? 'id' : null;
  if (!idCol || !taCols.has('company_id')) {
    return {
      ok: false,
      affected: 0,
      detail: 'timesheet_approvals missing required id/company_id columns.',
      warnings: ['Skipped: unexpected timesheet_approvals shape.'],
    };
  }
  const statusCol = taCols.has('status') ? 'status' : null;
  const approverCol = taCols.has('approver_id')
    ? 'approver_id'
    : taCols.has('approver')
      ? 'approver'
      : null;

  const today = ctx?.todayISO || localTodayISO();

  // Companies to scan.
  let companies: { id: string }[] = [];
  try {
    if (ctx?.companyId) {
      companies = [{ id: ctx.companyId }];
    } else {
      companies = database.prepare(`SELECT id FROM companies`).all() as { id: string }[];
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
  }

  const pendingExpr = statusCol
    ? `AND COALESCE(${statusCol}, 'pending') = 'pending'`
    : '';

  let scanned = 0;
  for (const { id: companyId } of companies) {
    scanned++;
    try {
      // Group pending approvals by approver (or treat all as one bucket if no
      // approver column). Count drives the reminder message.
      const groupCol = approverCol || `'__all__'`;
      const rows = database
        .prepare(
          `SELECT ${groupCol} AS approver_key, COUNT(*) AS cnt
             FROM timesheet_approvals
            WHERE company_id = ? ${pendingExpr}
            GROUP BY ${groupCol}`
        )
        .all(companyId) as Array<{ approver_key: string | null; cnt: number }>;

      for (const r of rows) {
        const count = Number(r.cnt || 0);
        if (count <= 0) continue;
        const approverKey = r.approver_key == null ? '__all__' : String(r.approver_key);

        // Idempotency key — one reminder per approver per day per company.
        const entityType = 'timesheet_approval_reminder';
        const entityId = `${companyId}:${approverKey}:${today}`;

        // Skip if a reminder already queued today for this approver.
        const existing = database
          .prepare(
            `SELECT id FROM notifications
              WHERE company_id = ? AND entity_type = ? AND entity_id = ?
              LIMIT 1`
          )
          .get(companyId, entityType, entityId) as { id?: string } | undefined;
        if (existing?.id) continue;

        const title = 'Timesheet approvals pending';
        const message =
          count === 1
            ? 'You have 1 timesheet awaiting your approval.'
            : `You have ${count} timesheets awaiting your approval.`;

        const notifId = `tsar_${companyId}_${approverKey}_${today}_${Math.random()
          .toString(36)
          .slice(2, 8)}`;

        database
          .prepare(
            `INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
             VALUES (?, ?, 'approval', ?, ?, ?, ?, 0, datetime('now'))`
          )
          .run(notifId, companyId, title, message, entityType, entityId);
        affected++;
      }
    } catch (err: any) {
      warnings.push(`Company ${companyId}: ${err?.message || err}`);
    }
  }

  return {
    ok: true,
    affected,
    detail: `Scanned ${scanned} company(ies); queued ${affected} timesheet-approval reminder(s).`,
    warnings: warnings.length ? warnings : undefined,
  };
}

export const automation: AutomationModule = {
  id: 'timesheet-approval-reminder',
  name: 'Timesheet Approval Reminder',
  domain: 'projects-time',
  trigger: 'daily',
  run,
};
