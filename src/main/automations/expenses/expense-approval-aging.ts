// src/main/automations/expenses/expense-approval-aging.ts
//
// Expense Approval Aging
//
// Escalates expenses that have been sitting in the 'pending' approval
// state beyond an aging threshold (default 7 days, per-company override
// via settings key 'expense_approval_aging_days', clamped to [1,365]).
//
// Behavior is BEST-EFFORT and NON-DESTRUCTIVE:
//   • It does NOT approve/reject/pay anything and never moves money.
//   • For each aged pending expense it QUEUES a single notification
//     (type 'expense_approval_overdue') so the UI / a downstream
//     workflow can surface the escalation.
//   • IDEMPOTENT: before inserting it checks that no unread escalation
//     notification already exists for that expense, so re-running the
//     same day (or any day while still pending) never double-queues.
//
// All DB work is wrapped in try/catch; run() never throws.

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

// Local YYYY-MM-DD (matches overdue-checker.ts; avoids UTC ±1 day drift).
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Cutoff = today minus N days, anchored at noon local to dodge DST edges.
function dateMinusDays(isoDate: string, days: number): string {
  const dt = new Date(`${isoDate}T12:00:00`);
  dt.setDate(dt.getDate() - Math.max(0, days));
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getAgingDays(database: ReturnType<typeof db.getDb>, companyId: string): number {
  try {
    const row = database
      .prepare(
        "SELECT value FROM settings WHERE company_id = ? AND key = 'expense_approval_aging_days'"
      )
      .get(companyId) as { value?: string } | undefined;
    const v = parseInt(row?.value ?? '', 10);
    if (Number.isFinite(v) && v >= 1) return Math.min(v, 365);
  } catch {
    /* fall through to default */
  }
  return 7;
}

function makeId(): string {
  return `exp_aging_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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

  // Resolve scope: explicit ctx.companyId, else current company, else all.
  let companyIds: string[] = [];
  try {
    if (ctx?.companyId) {
      companyIds = [ctx.companyId];
    } else {
      const current = (() => {
        try {
          return db.getCurrentCompanyId();
        } catch {
          return null;
        }
      })();
      if (current) {
        companyIds = [current];
      } else {
        const rows = database.prepare('SELECT id FROM companies').all() as any[];
        companyIds = rows.map((r) => r.id);
      }
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to resolve companies: ${err?.message || err}` };
  }

  const insertNotification = (() => {
    try {
      return database.prepare(`
        INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
        VALUES (?, ?, 'expense_approval_overdue', ?, ?, 'expense', ?, 0, datetime('now'))
      `);
    } catch {
      return null;
    }
  })();

  if (!insertNotification) {
    return { ok: false, affected: 0, detail: 'notifications table unavailable' };
  }

  for (const companyId of companyIds) {
    let agedExpenses: any[] = [];
    const agingDays = getAgingDays(database, companyId);
    const cutoff = dateMinusDays(today, agingDays);

    // Pending expenses created on/before the cutoff date. created_at is a
    // datetime string; comparing date(created_at) <= cutoff isolates the day.
    try {
      agedExpenses = database
        .prepare(`
          SELECT id, amount, description, reference, created_at
          FROM expenses
          WHERE company_id = ?
            AND status = 'pending'
            AND created_at IS NOT NULL
            AND created_at != ''
            AND date(created_at) <= ?
        `)
        .all(companyId, cutoff) as any[];
    } catch (err: any) {
      warnings.push(`Expense scan (company ${companyId}): ${err?.message || err}`);
      continue;
    }

    for (const exp of agedExpenses) {
      try {
        // Idempotency: skip if an unread escalation already queued.
        const existing = database
          .prepare(`
            SELECT 1 FROM notifications
            WHERE company_id = ?
              AND type = 'expense_approval_overdue'
              AND entity_type = 'expense'
              AND entity_id = ?
              AND is_read = 0
            LIMIT 1
          `)
          .get(companyId, exp.id) as any;
        if (existing) continue;

        const amount = Number(exp.amount || 0);
        const label = (exp.description || exp.reference || exp.id) as string;
        let daysPending = agingDays;
        try {
          const created = String(exp.created_at).slice(0, 10);
          daysPending = Math.max(
            0,
            Math.floor(
              (new Date(`${today}T12:00:00`).getTime() -
                new Date(`${created}T12:00:00`).getTime()) /
                86_400_000
            )
          );
        } catch {
          /* keep fallback */
        }

        insertNotification.run(
          makeId(),
          companyId,
          `Expense awaiting approval for ${daysPending} days`,
          `Expense "${label}" (${amount.toFixed(2)}) has been pending approval for ${daysPending} days (threshold ${agingDays}).`,
          exp.id
        );
        affected++;

        try {
          db.logAudit(companyId, 'expenses', exp.id, 'update', {
            automation: 'expense-approval-aging',
            action: 'escalation_queued',
            days_pending: daysPending,
            threshold_days: agingDays,
          });
        } catch {
          /* audit best-effort */
        }
      } catch (err: any) {
        warnings.push(`Escalation (expense ${exp?.id}): ${err?.message || err}`);
      }
    }
  }

  return {
    ok: true,
    affected,
    detail:
      affected > 0
        ? `Queued ${affected} expense approval-aging escalation(s) across ${companyIds.length} company(ies).`
        : `No aged pending expenses to escalate across ${companyIds.length} company(ies).`,
    ...(warnings.length ? { warnings } : {}),
  };
}

export const automation: AutomationModule = {
  id: 'expense-approval-aging',
  name: 'Expense Approval Aging',
  domain: 'expenses',
  trigger: 'daily',
  run,
};
