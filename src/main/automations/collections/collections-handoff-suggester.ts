// src/main/automations/collections/collections-handoff-suggester.ts
//
// Collections Handoff Suggester
//
// Scans receivable `debts` that are 90+ days past their delinquent/due
// date and STILL OWED (balance_due > epsilon), and that have NOT already
// been escalated to a collections agency. For each, it QUEUES a
// `notifications` row of type 'collections_handoff_suggestion' so a human
// can review and approve handing the debt to an agency.
//
// SAFETY / DESIGN:
//  • Best-effort: run() NEVER throws — all DB work is wrapped in try/catch
//    and degrades to ok:false with a warning on any error.
//  • Suggests only — never moves a debt to 'in_collection', never writes
//    agency fields, never sends email. The actual handoff stays a manual
//    human action.
//  • Idempotent: before inserting, we check no un-read suggestion already
//    exists for that debt (entity_id) so re-running the same day (or any
//    day until the user acts) never double-queues.
//  • "Owed" is decided by BALANCE (balance_due > 0.005), not the status
//    string. Epsilon = 0.005 inlined (no shared helper imported).
//  • Excludes debts already at/past collections (status in_collection,
//    legal, settled, written_off, bankruptcy; or current_stage already
//    collections_agency / legal_action / judgment / garnishment), and
//    debts on hold.

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

const EPSILON = 0.005;
const OVERDUE_DAYS = 90;

// Today as YYYY-MM-DD in LOCAL timezone — matches how dates are stored
// (TEXT YYYY-MM-DD), per src/main/crons/overdue-checker.ts.
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function dateMinusDays(isoDate: string, days: number): string {
  // Anchor at noon LOCAL to avoid DST edge cases.
  const dt = new Date(`${isoDate}T12:00:00`);
  dt.setDate(dt.getDate() - days);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(`${fromISO}T12:00:00`).getTime();
  const b = new Date(`${toISO}T12:00:00`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.floor((b - a) / 86_400_000));
}

function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  let affected = 0;

  let database: ReturnType<typeof db.getDb>;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  const today = ctx?.todayISO || localTodayISO();
  const cutoff = dateMinusDays(today, OVERDUE_DAYS); // delinquent/due on or before this = 90+ days

  // Resolve which companies to scan.
  let companies: { id: string }[] = [];
  try {
    if (ctx?.companyId) {
      companies = [{ id: ctx.companyId }];
    } else {
      const current = (() => {
        try { return db.getCurrentCompanyId(); } catch { return null; }
      })();
      if (current) {
        companies = [{ id: current }];
      } else {
        companies = (database.prepare(`SELECT id FROM companies`).all() as any[]).map(
          (r) => ({ id: String(r.id) })
        );
      }
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
  }

  let scannedAny = false;

  for (const { id: companyId } of companies) {
    // Candidate debts: receivable, still owed by balance, 90+ days
    // delinquent (fall back to due_date when delinquent_date is empty),
    // not already escalated to/past an agency, not on hold.
    let candidates: any[] = [];
    try {
      candidates = database.prepare(`
        SELECT id, debtor_name, balance_due, delinquent_date, due_date, current_stage, status
        FROM debts
        WHERE company_id = ?
          AND type = 'receivable'
          AND COALESCE(hold, 0) = 0
          AND status NOT IN ('in_collection','legal','settled','written_off','bankruptcy')
          AND current_stage NOT IN ('collections_agency','legal_action','judgment','garnishment')
          AND COALESCE(balance_due, 0) > ?
          AND COALESCE(NULLIF(delinquent_date, ''), NULLIF(due_date, '')) IS NOT NULL
          AND COALESCE(NULLIF(delinquent_date, ''), NULLIF(due_date, '')) <= ?
      `).all(companyId, EPSILON, cutoff) as any[];
      scannedAny = true;
    } catch (err: any) {
      warnings.push(`Debt scan (company ${companyId}): ${err?.message || err}`);
      continue;
    }

    if (candidates.length === 0) continue;

    // Prepared statements for the idempotency check + insert.
    let existsStmt: any;
    let insertStmt: any;
    try {
      existsStmt = database.prepare(`
        SELECT 1 FROM notifications
        WHERE company_id = ?
          AND type = 'collections_handoff_suggestion'
          AND entity_type = 'debt'
          AND entity_id = ?
          AND COALESCE(is_read, 0) = 0
        LIMIT 1
      `);
      insertStmt = database.prepare(`
        INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
        VALUES (?, ?, 'collections_handoff_suggestion', ?, ?, 'debt', ?, 0, datetime('now'))
      `);
    } catch (err: any) {
      warnings.push(`Notifications table unavailable (company ${companyId}): ${err?.message || err}`);
      continue;
    }

    for (const d of candidates) {
      try {
        const debtId = String(d.id);
        const balance = Number(d.balance_due || 0);
        if (!(balance > EPSILON)) continue; // defensive re-check

        const already = existsStmt.get(companyId, debtId);
        if (already) continue; // idempotent: suggestion already queued

        const anchor = (d.delinquent_date && String(d.delinquent_date)) ||
                       (d.due_date && String(d.due_date)) || '';
        const daysOverdue = anchor ? daysBetween(anchor, today) : OVERDUE_DAYS;
        const debtor = (d.debtor_name && String(d.debtor_name).trim()) || 'Unknown debtor';

        const id = `chs_${debtId}_${today}`;
        const title = `Consider collections agency handoff: ${debtor}`;
        const message =
          `Debt for ${debtor} is ${daysOverdue} days overdue with $${balance.toFixed(2)} ` +
          `still owed. Review whether to hand this off to a collections agency.`;

        insertStmt.run(id, companyId, title, message, debtId);
        affected++;

        // Audit trail — best-effort.
        try {
          db.logAudit(companyId, 'debts', debtId, 'collections_handoff_suggested', {
            balance_due: balance,
            days_overdue: daysOverdue,
            anchor_date: anchor,
            automation: 'collections-handoff-suggester',
          });
        } catch { /* audit best-effort */ }
      } catch (err: any) {
        warnings.push(`Suggest failed for debt ${d?.id}: ${err?.message || err}`);
      }
    }
  }

  if (!scannedAny && warnings.length > 0) {
    return {
      ok: false,
      affected,
      detail: 'Could not scan any company for handoff suggestions.',
      warnings,
    };
  }

  return {
    ok: true,
    affected,
    detail: affected === 0
      ? 'No new collections handoff suggestions needed.'
      : `Queued ${affected} collections handoff suggestion(s).`,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

export const automation: AutomationModule = {
  id: 'collections-handoff-suggester',
  name: 'Collections Handoff Suggester',
  domain: 'collections',
  trigger: 'daily',
  run,
};
