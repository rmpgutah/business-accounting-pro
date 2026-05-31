// src/main/automations/invoicing/invoice-overdue-escalator.ts
//
// Invoice Overdue Escalator
//
// Advances invoices.dunning_stage (0..4) on still-owed, past-due
// invoices according to how many days they are overdue:
//
//   tier 1 ->  7 days past due
//   tier 2 -> 30 days past due
//   tier 3 -> 60 days past due
//   tier 4 -> 90 days past due
//
// The stage only ever moves FORWARD (monotonically increasing) so a
// re-run never regresses an invoice and never double-counts: a row is
// skipped when its current dunning_stage already matches/exceeds the
// target tier. We additionally write one dunning_events row per advance
// as an audit/idempotency trail (queued event, NOT an outbound email).
//
// SAFETY: this automation never sends email, never moves money. It only
// bumps an integer column and queues an in-app dunning event. run() is
// best-effort and MUST NEVER throw.
//
// Follows the db + date patterns in src/main/crons/overdue-checker.ts.

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

// Local YYYY-MM-DD (matches how due_date is stored). UTC would shift
// dates by +/-1 day near midnight in non-UTC zones.
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function daysBetween(fromISO: string, toISO: string): number {
  // Anchor at noon LOCAL to avoid DST edge cases.
  const a = new Date(`${fromISO}T12:00:00`).getTime();
  const b = new Date(`${toISO}T12:00:00`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.floor((b - a) / 86_400_000);
}

// Map days-overdue to the highest tier reached.
function targetStage(daysOverdue: number): number {
  if (daysOverdue >= 90) return 4;
  if (daysOverdue >= 60) return 3;
  if (daysOverdue >= 30) return 2;
  if (daysOverdue >= 7) return 1;
  return 0;
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

  // Resolve the company scope: explicit ctx, then current company, else all.
  let companyIds: string[] = [];
  try {
    if (ctx?.companyId) {
      companyIds = [ctx.companyId];
    } else {
      const current = db.getCurrentCompanyId();
      if (current) {
        companyIds = [current];
      } else {
        const rows = database.prepare(`SELECT id FROM companies`).all() as any[];
        companyIds = rows.map((r) => String(r.id));
      }
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to resolve companies: ${err?.message || err}` };
  }

  // Verify the dunning_stage column / dunning_events table exist; degrade
  // gracefully if a stale DB lacks the migration.
  let hasEventsTable = true;
  try {
    database.prepare(`SELECT dunning_stage FROM invoices LIMIT 1`).get();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `invoices.dunning_stage missing: ${err?.message || err}` };
  }
  try {
    database.prepare(`SELECT id FROM dunning_events LIMIT 1`).get();
  } catch {
    hasEventsTable = false;
    warnings.push('dunning_events table missing; advancing stage without event trail');
  }

  const selectStmt = database.prepare(`
    SELECT id, invoice_number, total, amount_paid, due_date,
           COALESCE(dunning_stage, 0) AS dunning_stage
    FROM invoices
    WHERE company_id = ?
      AND status IN ('sent', 'overdue', 'partial')
      AND due_date IS NOT NULL
      AND due_date != ''
      AND due_date < ?
  `);

  const updateStmt = database.prepare(
    `UPDATE invoices SET dunning_stage = ?, updated_at = datetime('now') WHERE id = ?`
  );

  for (const companyId of companyIds) {
    let rows: any[];
    try {
      rows = selectStmt.all(companyId, today) as any[];
    } catch (err: any) {
      warnings.push(`Scan failed (company ${companyId}): ${err?.message || err}`);
      continue;
    }

    for (const inv of rows) {
      try {
        // Owed by BALANCE, never by status string. epsilon 0.005.
        const balance = Number(inv.total || 0) - Number(inv.amount_paid || 0);
        if (balance <= 0.005) continue;

        const daysOverdue = daysBetween(String(inv.due_date), today);
        const target = targetStage(daysOverdue);
        const current = Number(inv.dunning_stage) || 0;

        // Monotonic: only advance forward. Skip if already at/above target.
        if (target <= current) continue;

        updateStmt.run(target, inv.id);
        affected++;

        // Idempotency / audit trail: queue an in-app dunning event for
        // each new tier reached (NOT an outbound email). Guard against a
        // duplicate event for the same invoice+step on re-runs.
        if (hasEventsTable) {
          for (let step = current + 1; step <= target; step++) {
            try {
              const exists = database.prepare(
                `SELECT 1 FROM dunning_events WHERE company_id = ? AND invoice_id = ? AND step_number = ? LIMIT 1`
              ).get(companyId, inv.id, step) as any;
              if (exists) continue;
              database.prepare(
                `INSERT INTO dunning_events (id, company_id, invoice_id, step_number, sent_at, method, template_used)
                 VALUES (?, ?, ?, ?, datetime('now'), 'queued', 'overdue_escalator')`
              ).run(
                `dunn_${inv.id}_${step}`,
                companyId,
                inv.id,
                step
              );
            } catch { /* event-trail best-effort */ }
          }
        }

        try {
          db.logAudit(companyId, 'invoices', String(inv.id), 'dunning_escalated', {
            invoice_number: inv.invoice_number,
            previous_stage: current,
            new_stage: target,
            days_overdue: daysOverdue,
            balance_due: balance,
            automation: 'invoice-overdue-escalator',
          });
        } catch { /* audit best-effort */ }
      } catch (err: any) {
        warnings.push(`Invoice ${inv?.id} (company ${companyId}): ${err?.message || err}`);
      }
    }
  }

  const detail = `Escalated dunning_stage on ${affected} overdue invoice(s) across ${companyIds.length} company(ies)`;
  return warnings.length
    ? { ok: true, affected, detail, warnings }
    : { ok: true, affected, detail };
}

export const automation: AutomationModule = {
  id: 'invoice-overdue-escalator',
  name: 'Invoice Overdue Escalator',
  domain: 'invoicing',
  trigger: 'daily',
  run,
};
