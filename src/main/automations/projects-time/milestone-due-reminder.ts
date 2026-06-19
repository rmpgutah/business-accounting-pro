// src/main/automations/projects-time/milestone-due-reminder.ts
//
// Milestone Due Reminder — queues an in-app reminder notification for every
// open project milestone whose due date falls within the next N days
// (default 7). Gives the user a heads-up to finish/deliver a milestone
// BEFORE it slips, mirroring the bill-due-reminder pattern.
//
// Design:
//  • Trigger: 'daily' — due-soon windows shift each calendar day.
//  • Best-effort: run() NEVER throws. Any failure degrades to ok:false.
//  • Queues a row into `notifications` (does NOT email or move money).
//  • Idempotent: one reminder per milestone per due_date — re-running the
//    same day (or any later day within the window before the milestone is
//    completed) will not insert a duplicate, because we key the dedupe on
//    entity_id + type + the due_date embedded in the message.
//  • DEFENSIVE: the `project_milestones` table is NOT guaranteed to exist
//    in schema.sql. We detect the table and its columns at runtime via
//    sqlite_master/PRAGMA and degrade to ok:false with a warning when
//    absent, rather than crashing.

import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

const WINDOW_DAYS = 7;
const NOTIFICATION_TYPE = 'milestone_due_reminder';

// Today as YYYY-MM-DD in LOCAL timezone — matches how date columns are
// stored (TEXT YYYY-MM-DD), mirroring overdue-checker.ts.
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function datePlusDays(isoDate: string, days: number): string {
  // Anchor at noon LOCAL to avoid DST edge cases.
  const dt = new Date(`${isoDate}T12:00:00`);
  dt.setDate(dt.getDate() + days);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function genId(): string {
  return `mdr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  let affected = 0;

  let database: import('better-sqlite3').Database;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  // ── Verify the project_milestones table exists. It is NOT in schema.sql,
  //    so absence is the expected case in many installs. ────────────────
  let cols: Set<string>;
  try {
    const tbl = database.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_milestones'`
    ).get() as { name?: string } | undefined;
    if (!tbl) {
      return {
        ok: false,
        affected: 0,
        detail: 'project_milestones table does not exist; skipping milestone due reminders.',
        warnings: ['project_milestones table not found in database'],
      };
    }
    const colRows = database.prepare(`PRAGMA table_info(project_milestones)`).all() as any[];
    cols = new Set(colRows.map((c) => String(c.name)));
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to introspect project_milestones: ${err?.message || err}` };
  }

  // Resolve the due-date column name (be flexible across schema variants).
  const dueCol =
    ['due_date', 'due_on', 'target_date', 'deadline'].find((c) => cols.has(c)) || null;
  if (!dueCol) {
    return {
      ok: false,
      affected: 0,
      detail: 'project_milestones has no recognizable due-date column; skipping.',
      warnings: ['no due_date/due_on/target_date/deadline column on project_milestones'],
    };
  }
  if (!cols.has('id') || !cols.has('company_id')) {
    return {
      ok: false,
      affected: 0,
      detail: 'project_milestones missing id/company_id columns; skipping.',
      warnings: ['project_milestones missing required id or company_id column'],
    };
  }

  const hasName = cols.has('name') || cols.has('title');
  const nameCol = cols.has('name') ? 'name' : cols.has('title') ? 'title' : null;
  const hasStatus = cols.has('status');
  const hasCompleted = cols.has('completed') || cols.has('is_completed');
  const completedCol = cols.has('completed') ? 'completed' : cols.has('is_completed') ? 'is_completed' : null;
  const hasProjectId = cols.has('project_id');

  const today = ctx?.todayISO || localTodayISO();
  const windowEnd = datePlusDays(today, WINDOW_DAYS);

  // Determine target companies.
  let companies: { id: string }[] = [];
  try {
    if (ctx?.companyId) {
      companies = [{ id: ctx.companyId }];
    } else {
      let current: string | null | undefined;
      try { current = db.getCurrentCompanyId?.(); } catch { /* optional */ }
      if (current) {
        companies = [{ id: current }];
      } else {
        companies = (database.prepare(`SELECT id FROM companies`).all() as any[]) as { id: string }[];
      }
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
  }

  let insertStmt: import('better-sqlite3').Statement;
  let dupStmt: import('better-sqlite3').Statement;
  try {
    insertStmt = database.prepare(`
      INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, 'project_milestone', ?, 0, datetime('now'))
    `);
    // Dedupe: same milestone + same reminder type + same due_date tag queued.
    dupStmt = database.prepare(`
      SELECT 1 FROM notifications
      WHERE company_id = ? AND type = ? AND entity_id = ? AND message LIKE ?
      LIMIT 1
    `);
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `notifications table unavailable: ${err?.message || err}` };
  }

  // Build the open-milestone filter from whatever status signal exists.
  // Treat status 'completed'/'done'/'cancelled' or completed=1 as closed.
  const selectName = nameCol ? `${nameCol} AS ms_name` : `'' AS ms_name`;
  const selectProject = hasProjectId ? `project_id` : `'' AS project_id`;
  const sql =
    `SELECT id, company_id, ${dueCol} AS due_date, ${selectName}, ${selectProject}` +
    (hasStatus ? `, status` : `, '' AS status`) +
    (completedCol ? `, ${completedCol} AS completed_flag` : `, 0 AS completed_flag`) +
    ` FROM project_milestones
       WHERE company_id = ?
         AND ${dueCol} IS NOT NULL
         AND ${dueCol} != ''
         AND ${dueCol} >= ?
         AND ${dueCol} <= ?`;

  let scanStmt: import('better-sqlite3').Statement;
  try {
    scanStmt = database.prepare(sql);
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to prepare milestone scan: ${err?.message || err}` };
  }

  for (const { id: companyId } of companies) {
    let rows: Array<{
      id: string; due_date: string; ms_name: string; project_id: string;
      status: string; completed_flag: number;
    }> = [];
    try {
      rows = (scanStmt.all(companyId, today, windowEnd) as any[]) as typeof rows;
    } catch (err: any) {
      warnings.push(`Milestone scan failed (company ${companyId}): ${err?.message || err}`);
      continue;
    }

    for (const m of rows) {
      // Skip closed milestones (defensively, across status/completed signals).
      if (hasCompleted && Number(m.completed_flag) === 1) continue;
      if (hasStatus) {
        const s = String(m.status || '').toLowerCase();
        if (s === 'completed' || s === 'complete' || s === 'done' || s === 'cancelled' || s === 'canceled') continue;
      }

      // Idempotency: tag the message with the due_date so a re-run (or a
      // later day within the window) does not double-queue for the same
      // milestone/due-date.
      const dueTag = `[due:${m.due_date}]`;
      try {
        const exists = dupStmt.get(companyId, NOTIFICATION_TYPE, m.id, `%${dueTag}%`);
        if (exists) continue;
      } catch (err: any) {
        warnings.push(`Dedupe check failed (milestone ${m.id}): ${err?.message || err}`);
        continue;
      }

      const daysUntil = Math.max(0, Math.floor(
        (new Date(`${m.due_date}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86_400_000
      ));
      const whenText = daysUntil === 0 ? 'today' : daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`;
      const label = (hasName && m.ms_name) ? `Milestone "${m.ms_name}"` : 'A project milestone';
      const title = `${label} due ${whenText}`;
      const message = `${label} is due on ${m.due_date} (${whenText}). ${dueTag}`;

      try {
        insertStmt.run(genId(), companyId, NOTIFICATION_TYPE, title, message, m.id);
        affected++;
      } catch (err: any) {
        warnings.push(`Insert failed (milestone ${m.id}): ${err?.message || err}`);
      }
    }
  }

  return {
    ok: true,
    affected,
    detail: affected === 0
      ? `No new due-soon milestone reminders within ${WINDOW_DAYS} days.`
      : `Queued ${affected} milestone-due reminder${affected === 1 ? '' : 's'} (next ${WINDOW_DAYS} days).`,
    ...(warnings.length ? { warnings } : {}),
  };
}

export const automation: AutomationModule = {
  id: 'milestone-due-reminder',
  name: 'Milestone Due Reminder',
  domain: 'projects-time',
  trigger: 'daily',
  run,
};
