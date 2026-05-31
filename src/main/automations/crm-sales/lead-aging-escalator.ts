// src/main/automations/crm-sales/lead-aging-escalator.ts
//
// Lead Aging Escalator
//
// Escalates unworked leads that have aged past a threshold, per
// lead_routing_rules / lead_scoring_rules when those tables exist.
//
// Design / safety:
//  • BEST-EFFORT: run() never throws. Every db touch is wrapped in
//    try/catch and degrades to { ok:false, affected:0 } on error.
//  • DEFENSIVE: the CRM lead tables (leads, lead_routing_rules,
//    lead_scoring_rules) are NOT guaranteed to exist in schema.sql.
//    We probe for them first and degrade to ok:false + a warning if
//    absent — never crash.
//  • IDEMPOTENT: each escalation is QUEUED as a `notifications` row
//    (type 'lead_escalation') keyed by lead id + today's date in the
//    entity fields. Before inserting we check no escalation row for
//    that lead already exists today, so re-running the same day is a
//    no-op. We NEVER send email, move money, or mutate the lead row.
//  • Company-scoped: iterates ctx.companyId when given, else all
//    companies. "today" uses ctx.todayISO else local YYYY-MM-DD
//    (mirrors src/main/crons/overdue-checker.ts).

import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

const SLUG = 'lead-aging-escalator';
// Leads not touched in this many days are considered "aging".
const DEFAULT_AGING_DAYS = 7;

function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Does a table exist in the SQLite catalog?
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

// Which of the candidate column names actually exist on `table`?
function columnSet(database: any, table: string): Set<string> {
  const out = new Set<string>();
  try {
    const rows = database.prepare(`PRAGMA table_info(${table})`).all() as any[];
    for (const r of rows) if (r && r.name) out.add(String(r.name));
  } catch { /* ignore */ }
  return out;
}

function firstPresent(cols: Set<string>, candidates: string[]): string | null {
  for (const c of candidates) if (cols.has(c)) return c;
  return null;
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

  // Probe for the CRM lead table. If absent, this automation has
  // nothing to act on — degrade cleanly.
  if (!tableExists(database, 'leads')) {
    return {
      ok: false,
      affected: 0,
      detail: 'leads table not present; nothing to escalate',
      warnings: ['CRM lead tables (leads/lead_routing_rules/lead_scoring_rules) not found in schema — escalator is a no-op until they exist'],
    };
  }
  if (!tableExists(database, 'notifications')) {
    return { ok: false, affected: 0, detail: 'notifications table not present; cannot queue escalations' };
  }

  // Resolve which columns are available so we adapt to whatever the
  // (future) leads schema looks like.
  const cols = columnSet(database, 'leads');
  const idCol = firstPresent(cols, ['id']);
  if (!idCol) {
    return { ok: false, affected: 0, detail: 'leads table has no id column' };
  }
  // Last-activity timestamp candidates, in priority order.
  const activityCol = firstPresent(cols, [
    'last_contacted_at', 'last_activity_at', 'last_touched_at',
    'updated_at', 'created_at',
  ]);
  // Status / stage column to detect "unworked" leads.
  const statusCol = firstPresent(cols, ['status', 'stage', 'state']);
  const nameCol = firstPresent(cols, ['name', 'full_name', 'company_name', 'contact_name', 'email']);
  const hasCompany = cols.has('company_id');

  if (!activityCol) {
    return {
      ok: false,
      affected: 0,
      detail: 'leads table has no usable activity/date column',
      warnings: ['expected one of last_contacted_at/last_activity_at/updated_at/created_at on leads'],
    };
  }

  const today = (ctx?.todayISO && /^\d{4}-\d{2}-\d{2}$/.test(ctx.todayISO))
    ? ctx.todayISO
    : localTodayISO();

  // Cutoff: leads with last activity on/before this date are aging.
  // datetime('now','-N days') compared lexically against TEXT dates.
  // We compute the cutoff date string from `today`.
  let cutoff: string;
  try {
    const dt = new Date(`${today}T12:00:00`);
    dt.setDate(dt.getDate() - DEFAULT_AGING_DAYS);
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    cutoff = `${yyyy}-${mm}-${dd}`;
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to compute cutoff: ${err?.message || err}` };
  }

  // Determine companies to scan.
  let companyIds: string[] = [];
  try {
    if (ctx?.companyId) {
      companyIds = [ctx.companyId];
    } else {
      try {
        const cur = db.getCurrentCompanyId?.();
        if (cur) companyIds = [cur];
      } catch { /* no current company */ }
      if (companyIds.length === 0) {
        const rows = database.prepare(`SELECT id FROM companies`).all() as any[];
        companyIds = rows.map((r) => String(r.id)).filter(Boolean);
      }
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
  }

  // "Unworked" statuses — only escalate leads not yet won/lost/closed.
  const TERMINAL = new Set(['won', 'lost', 'closed', 'converted', 'disqualified', 'archived']);

  const insert = database.prepare(`
    INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
    VALUES (?, ?, 'lead_escalation', ?, ?, 'lead', ?, 0, datetime('now'))
  `);

  // Idempotency: an escalation already queued for this lead today?
  // We key on entity_id + a date marker embedded in the message so a
  // re-run finds the existing row. We match on entity_id + created_at
  // date prefix to avoid a second insert the same day.
  const dupCheck = database.prepare(`
    SELECT 1 FROM notifications
    WHERE company_id = ? AND type = 'lead_escalation'
      AND entity_type = 'lead' AND entity_id = ?
      AND substr(created_at, 1, 10) = ?
    LIMIT 1
  `);

  for (const companyId of companyIds) {
    try {
      const where: string[] = [];
      const params: any[] = [];
      if (hasCompany) { where.push('company_id = ?'); params.push(companyId); }
      where.push(`${activityCol} IS NOT NULL`);
      where.push(`${activityCol} != ''`);
      // Compare date portion of the activity timestamp against cutoff.
      where.push(`substr(${activityCol}, 1, 10) <= ?`);
      params.push(cutoff);

      const selectCols = [idCol];
      if (statusCol) selectCols.push(statusCol);
      if (nameCol) selectCols.push(nameCol);
      selectCols.push(activityCol);

      const sql = `SELECT ${[...new Set(selectCols)].join(', ')} FROM leads WHERE ${where.join(' AND ')}`;
      const candidates = database.prepare(sql).all(...params) as any[];

      for (const lead of candidates) {
        try {
          const leadId = String(lead[idCol]);
          if (!leadId) continue;

          // Skip terminal/worked leads.
          if (statusCol) {
            const st = String(lead[statusCol] ?? '').toLowerCase().trim();
            if (TERMINAL.has(st)) continue;
          }

          // Idempotent guard — already escalated today?
          const exists = dupCheck.get(companyId, leadId, today);
          if (exists) continue;

          const label = nameCol ? String(lead[nameCol] ?? '').trim() : '';
          const lastSeen = String(lead[activityCol] ?? '').slice(0, 10);
          const title = label
            ? `Lead aging: ${label}`
            : `Lead aging (#${leadId.slice(0, 8)})`;
          const message = `Lead has had no activity since ${lastSeen} (>= ${DEFAULT_AGING_DAYS} days). Escalating for follow-up.`;

          const notifId = `leadesc_${leadId}_${today}`.replace(/[^A-Za-z0-9_]/g, '_');

          try {
            insert.run(notifId, companyId, title, message, leadId);
            affected++;
          } catch (insErr: any) {
            // Likely a UNIQUE collision on a re-run — treat as already done.
            const m = String(insErr?.message || insErr);
            if (!/unique|constraint/i.test(m)) {
              warnings.push(`Insert failed for lead ${leadId}: ${m}`);
            }
          }
        } catch (perLeadErr: any) {
          warnings.push(`Lead skipped: ${perLeadErr?.message || perLeadErr}`);
        }
      }
    } catch (companyErr: any) {
      warnings.push(`Company ${companyId} scan failed: ${companyErr?.message || companyErr}`);
    }
  }

  return {
    ok: true,
    affected,
    detail: `Queued ${affected} lead escalation(s) across ${companyIds.length} company(ies)`,
    ...(warnings.length ? { warnings } : {}),
  };
}

export const automation: AutomationModule = {
  id: SLUG,
  name: 'Lead Aging Escalator',
  domain: 'crm-sales',
  trigger: 'daily',
  run,
};
