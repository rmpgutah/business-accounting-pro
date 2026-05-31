// src/main/automations/crm-sales/stale-deal-flag.ts
//
// Stale Deal Flag — CRM / Sales automation.
//
// Flags open deals that have had NO deal_activities logged in the last
// N days (default 14). "Flagging" here means QUEUEING a notification row
// per stale deal (never email, never mutating the deal/pipeline). The
// notification surfaces in the in-app feed so a rep can re-engage.
//
// Defensive design:
//  • The `deals` / `deal_activities` tables are NOT part of the core
//    schema.sql — they may be introduced by a runtime migration or a
//    future CRM module. We therefore probe sqlite_master first and
//    degrade to ok:false with a warning if they are absent, rather
//    than crashing.
//  • Column presence is also probed (PRAGMA table_info) so we only
//    reference columns that actually exist, and fall back gracefully.
//  • run() is BEST-EFFORT and NEVER THROWS — every db touch is wrapped.
//  • IDEMPOTENT — a deal is only flagged once per (deal, day): we check
//    for an existing notification of the same type/entity created today
//    before inserting, so re-running the same day is a no-op.
//
// Pattern + style mirror src/main/crons/overdue-checker.ts.

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

const SLUG = 'stale-deal-flag';
const STALE_DAYS = 14;
const NOTIFICATION_TYPE = 'crm.deal.stale';

// Today as YYYY-MM-DD in LOCAL timezone — matches overdue-checker.ts.
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function dateMinusDays(isoDate: string, days: number): string {
  if (days <= 0) return isoDate;
  // Anchor at noon LOCAL to dodge DST edge cases.
  const dt = new Date(`${isoDate}T12:00:00`);
  dt.setDate(dt.getDate() - days);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
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
    for (const r of rows) if (r && typeof r.name === 'string') cols.add(r.name);
  } catch {
    /* return whatever we have */
  }
  return cols;
}

function genId(): string {
  return 'ntf_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
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

  // Gate on table existence — these are non-core CRM tables.
  if (!tableExists(database, 'deals')) {
    return {
      ok: false,
      affected: 0,
      detail: 'deals table not present; CRM module not installed',
      warnings: ['Skipped: no deals table'],
    };
  }
  if (!tableExists(database, 'deal_activities')) {
    return {
      ok: false,
      affected: 0,
      detail: 'deal_activities table not present',
      warnings: ['Skipped: no deal_activities table'],
    };
  }
  if (!tableExists(database, 'notifications')) {
    return {
      ok: false,
      affected: 0,
      detail: 'notifications table not present; cannot queue flags',
    };
  }

  const dealCols = columnSet(database, 'deals');
  const actCols = columnSet(database, 'deal_activities');

  // Required relational columns. If any are missing we cannot reliably
  // correlate activities to deals — degrade rather than guess.
  if (!dealCols.has('id') || !dealCols.has('company_id')) {
    return { ok: false, affected: 0, detail: 'deals table missing id/company_id columns' };
  }
  if (!actCols.has('deal_id')) {
    return { ok: false, affected: 0, detail: 'deal_activities table missing deal_id column' };
  }

  // Pick the activity timestamp column that actually exists.
  const actDateCol = actCols.has('activity_date')
    ? 'activity_date'
    : actCols.has('created_at')
    ? 'created_at'
    : null;
  if (!actDateCol) {
    return {
      ok: false,
      affected: 0,
      detail: 'deal_activities has no activity_date/created_at column',
    };
  }

  // Optional columns used only for messaging / open-deal filtering.
  const dealNameCol = dealCols.has('name')
    ? 'name'
    : dealCols.has('title')
    ? 'title'
    : null;
  const dealStatusCol = dealCols.has('status')
    ? 'status'
    : dealCols.has('stage')
    ? 'stage'
    : null;

  const today = ctx?.todayISO || localTodayISO();
  const cutoff = dateMinusDays(today, STALE_DAYS);

  // Which companies to scan.
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

  // Closed/dead deal statuses we never flag (only applied if a status
  // column exists). Compared case-insensitively.
  const CLOSED = new Set(['won', 'lost', 'closed', 'closed_won', 'closed_lost', 'dead', 'archived']);

  let insertStmt: any;
  let existsStmt: any;
  try {
    insertStmt = database.prepare(`
      INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, 'deal', ?, 0, datetime('now'))
    `);
    existsStmt = database.prepare(`
      SELECT 1 FROM notifications
      WHERE company_id = ? AND type = ? AND entity_id = ?
        AND date(created_at) = ?
      LIMIT 1
    `);
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to prepare statements: ${err?.message || err}` };
  }

  for (const { id: companyId } of companies) {
    if (!companyId) continue;
    try {
      // Deals whose most-recent activity is older than the cutoff, OR
      // that have no activity at all. We compare on the DATE portion so
      // datetime-valued columns still align with YYYY-MM-DD cutoffs.
      const sql = `
        SELECT d.id AS id${dealNameCol ? `, d.${dealNameCol} AS deal_name` : ''}${dealStatusCol ? `, d.${dealStatusCol} AS deal_status` : ''},
               (SELECT MAX(date(a.${actDateCol})) FROM deal_activities a WHERE a.deal_id = d.id) AS last_activity
        FROM deals d
        WHERE d.company_id = ?
      `;
      const rows = database.prepare(sql).all(companyId) as any[];

      for (const row of rows) {
        if (!row || !row.id) continue;

        // Skip closed/dead deals when we know the status.
        if (dealStatusCol) {
          const s = String(row.deal_status ?? '').trim().toLowerCase();
          if (CLOSED.has(s)) continue;
        }

        const last = row.last_activity ? String(row.last_activity) : null;
        // Stale = no activity ever, OR last activity strictly before cutoff.
        const isStale = last === null || last < cutoff;
        if (!isStale) continue;

        // Idempotency — already flagged today?
        try {
          const already = existsStmt.get(companyId, NOTIFICATION_TYPE, row.id, today);
          if (already) continue;
        } catch {
          // If the existence probe fails, skip rather than risk a dup.
          continue;
        }

        const label = dealNameCol && row.deal_name ? String(row.deal_name) : `Deal ${row.id}`;
        const msg = last
          ? `No activity since ${last} (over ${STALE_DAYS} days). Consider following up.`
          : `No activity logged yet (over ${STALE_DAYS} days old). Consider following up.`;

        try {
          insertStmt.run(genId(), companyId, NOTIFICATION_TYPE, `Stale deal: ${label}`, msg, row.id);
          affected++;
        } catch (err: any) {
          warnings.push(`Insert failed for deal ${row.id}: ${err?.message || err}`);
        }
      }
    } catch (err: any) {
      warnings.push(`Scan failed for company ${companyId}: ${err?.message || err}`);
    }
  }

  return {
    ok: true,
    affected,
    detail: `Flagged ${affected} stale deal(s) (no activity in ${STALE_DAYS}+ days).`,
    warnings: warnings.length ? warnings : undefined,
  };
}

export const automation: AutomationModule = {
  id: SLUG,
  name: 'Stale Deal Flag',
  domain: 'crm-sales',
  trigger: 'daily',
  run,
};
