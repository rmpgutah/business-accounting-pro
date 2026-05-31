// src/main/automations/crm-sales/deal-followup-reminder.ts
//
// Deal Follow-Up Reminder
//
// Scans CRM deal activities for "next step" follow-up dates that have
// arrived (next_step_date <= today) and QUEUES a reminder into the
// notifications table so the user sees it in-app. It NEVER sends email,
// moves money, or mutates the deal — it only writes a notification row.
//
// Design:
//  • Best-effort + never throws: every db touch is wrapped in try/catch
//    and we degrade to { ok:false } on any failure.
//  • Defensive schema discovery: the `deal_activities` table may not
//    exist in this build (no CRM tables ship in the base schema). We
//    probe sqlite_master + PRAGMA table_info and only proceed if the
//    required columns are present; otherwise we return a clear warning.
//  • Idempotent: before inserting a reminder we check the notifications
//    table for an existing row keyed by (entity_type='deal_activity',
//    entity_id=<activity id>) so re-running the same day (or after the
//    follow-up date passes) cannot create duplicates.
//  • "today" uses ctx.todayISO when provided, else local YYYY-MM-DD
//    matching src/main/crons/overdue-checker.ts.

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

// Local YYYY-MM-DD (matches how date columns are stored as TEXT).
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function genId(): string {
  return `dfr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  let database: any;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  // ── Verify deal_activities exists and discover its columns ──────────
  let cols: Set<string>;
  try {
    const tbl = (database.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='deal_activities'`
    ).get() as any) || null;
    if (!tbl) {
      return {
        ok: false,
        affected: 0,
        detail: 'deal_activities table not present in this build — nothing to do.',
        warnings: ['CRM deal_activities table does not exist; automation is a no-op until CRM schema ships.'],
      };
    }
    const info = (database.prepare(`PRAGMA table_info(deal_activities)`).all() as any[]) || [];
    cols = new Set(info.map((c) => String(c.name)));
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Schema probe failed: ${err?.message || err}` };
  }

  // The next-step follow-up date column. Accept a few likely names so we
  // bind to whatever the CRM schema actually used.
  const dateCol = ['next_step_date', 'next_step_at', 'follow_up_date', 'due_date'].find((c) => cols.has(c));
  if (!dateCol) {
    return {
      ok: false,
      affected: 0,
      detail: 'deal_activities has no recognizable next-step date column.',
      warnings: ['Expected one of: next_step_date, next_step_at, follow_up_date, due_date.'],
    };
  }
  if (!cols.has('id') || !cols.has('company_id')) {
    return {
      ok: false,
      affected: 0,
      detail: 'deal_activities missing required id/company_id columns.',
    };
  }

  const today = ctx?.todayISO || localTodayISO();
  const hasDealId = cols.has('deal_id');
  const noteCol = ['next_step', 'next_step_note', 'description', 'notes', 'subject'].find((c) => cols.has(c));

  // Scope: explicit ctx/current company if available, else all companies.
  let companyIds: string[] = [];
  try {
    const scoped = ctx?.companyId || db.getCurrentCompanyId();
    if (scoped) {
      companyIds = [scoped];
    } else {
      companyIds = (database.prepare(`SELECT id FROM companies`).all() as any[]).map((r) => String(r.id));
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to resolve companies: ${err?.message || err}` };
  }

  let affected = 0;

  for (const companyId of companyIds) {
    try {
      const selectCols = ['id', dateCol, hasDealId ? 'deal_id' : null, noteCol]
        .filter((c): c is string => !!c)
        .filter((c, i, a) => a.indexOf(c) === i)
        .join(', ');

      const candidates = (database.prepare(`
        SELECT ${selectCols}
        FROM deal_activities
        WHERE company_id = ?
          AND ${dateCol} IS NOT NULL
          AND ${dateCol} != ''
          AND substr(${dateCol}, 1, 10) <= ?
      `).all(companyId, today) as any[]) || [];

      if (candidates.length === 0) continue;

      // Idempotency probe + insert prepared once per company.
      const existsStmt = database.prepare(`
        SELECT 1 FROM notifications
        WHERE company_id = ? AND entity_type = 'deal_activity' AND entity_id = ?
        LIMIT 1
      `);
      const insertStmt = database.prepare(`
        INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
        VALUES (?, ?, 'deal_followup', ?, ?, 'deal_activity', ?, 0, datetime('now'))
      `);

      const tx = database.transaction((rows: any[]) => {
        let n = 0;
        for (const r of rows) {
          const actId = String(r.id);
          const already = existsStmt.get(companyId, actId);
          if (already) continue;
          const stepDate = String(r[dateCol] || '').slice(0, 10);
          const note = noteCol ? String(r[noteCol] ?? '').trim() : '';
          const title = 'Deal follow-up due';
          const message =
            (note ? `${note}` : 'Next step is due') +
            (stepDate ? ` (due ${stepDate})` : '') +
            (hasDealId && r.deal_id ? ` [deal ${String(r.deal_id)}]` : '');
          insertStmt.run(genId(), companyId, title, message, actId);
          n++;
        }
        return n;
      });

      affected += tx(candidates) as number;
    } catch (err: any) {
      warnings.push(`Company ${companyId}: ${err?.message || err}`);
    }
  }

  return {
    ok: warnings.length === 0,
    affected,
    detail: `Queued ${affected} deal follow-up reminder(s) for ${companyIds.length} company(ies).`,
    warnings: warnings.length ? warnings : undefined,
  };
}

export const automation: AutomationModule = {
  id: 'deal-followup-reminder',
  name: 'Deal Follow-Up Reminder',
  domain: 'crm-sales',
  trigger: 'daily',
  run,
};
