// src/main/automations/projects-time/project-budget-overrun-flag.ts
//
// Project Budget Overrun Flag
//
// Scans active projects that carry a positive budget and raises an
// idempotent notification when accumulated COSTS exceed the project
// budget. Costs are computed from:
//
//   • expenses.project_id            — sum(amount)
//   • time_entries.project_id        — sum(duration_minutes/60 * hourly_rate)
//
// There is NO project_budgets table in this schema — the budget lives
// on projects.budget (with budget_type fixed/hourly/none). We treat any
// project with budget > 0 as having a meaningful cap regardless of
// budget_type, since "none" defaults budget to 0 and is skipped.
//
// SAFETY / DESIGN:
//  • Best-effort: run() NEVER throws. All db work is wrapped in
//    try/catch and degrades to ok:false on error.
//  • Idempotent: a notification of type 'project_budget_overrun' for a
//    given project is written at most once. Re-running the same day (or
//    any later day) does not duplicate it. We do NOT move money or send
//    external email — we only QUEUE an in-app notification + audit row.
//  • Money epsilon 0.005: only flag when cost - budget > 0.005.
//  • Per-company scoped; iterates all companies (or ctx.companyId).

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

function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  const today = ctx?.todayISO || localTodayISO();
  let affected = 0;

  let database: ReturnType<typeof db.getDb>;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  // Resolve target companies.
  let companies: { id: string }[] = [];
  try {
    if (ctx?.companyId) {
      companies = [{ id: ctx.companyId }];
    } else {
      const current = db.getCurrentCompanyId();
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

  for (const { id: companyId } of companies) {
    let projects: any[] = [];
    try {
      projects = database.prepare(`
        SELECT id, name, budget
        FROM projects
        WHERE company_id = ?
          AND status = 'active'
          AND COALESCE(budget, 0) > 0
      `).all(companyId) as any[];
    } catch (err: any) {
      warnings.push(`Project scan (company ${companyId}): ${err?.message || err}`);
      continue;
    }

    for (const p of projects) {
      try {
        const budget = Number(p.budget || 0);
        if (!(budget > 0)) continue;

        // Expense costs for this project.
        let expenseCost = 0;
        try {
          const row = database.prepare(`
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM expenses
            WHERE company_id = ? AND project_id = ?
          `).get(companyId, p.id) as any;
          expenseCost = Number(row?.total || 0);
        } catch (err: any) {
          warnings.push(`Expense cost (project ${p.id}): ${err?.message || err}`);
        }

        // Labor costs from time entries (duration in minutes * hourly_rate).
        let laborCost = 0;
        try {
          const row = database.prepare(`
            SELECT COALESCE(SUM((COALESCE(duration_minutes, 0) / 60.0) * COALESCE(hourly_rate, 0)), 0) AS total
            FROM time_entries
            WHERE company_id = ? AND project_id = ?
          `).get(companyId, p.id) as any;
          laborCost = Number(row?.total || 0);
        } catch (err: any) {
          warnings.push(`Labor cost (project ${p.id}): ${err?.message || err}`);
        }

        const totalCost = expenseCost + laborCost;

        // Decide overrun by balance with epsilon — never by status string.
        if (totalCost - budget <= EPSILON) continue;

        // Idempotency: skip if a flag for this project already exists.
        let already = 0;
        try {
          const ex = database.prepare(`
            SELECT COUNT(*) AS c
            FROM notifications
            WHERE company_id = ?
              AND type = 'project_budget_overrun'
              AND entity_type = 'project'
              AND entity_id = ?
          `).get(companyId, p.id) as any;
          already = Number(ex?.c || 0);
        } catch (err: any) {
          // If we cannot verify idempotency, do NOT risk a duplicate insert.
          warnings.push(`Idempotency check (project ${p.id}): ${err?.message || err}`);
          continue;
        }
        if (already > 0) continue;

        const overrun = totalCost - budget;
        const title = `Budget overrun: ${p.name || 'Project'}`;
        const message =
          `Project costs ${totalCost.toFixed(2)} exceed budget ${budget.toFixed(2)} ` +
          `by ${overrun.toFixed(2)} (expenses ${expenseCost.toFixed(2)} + labor ${laborCost.toFixed(2)}).`;

        try {
          database.prepare(`
            INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
            VALUES (?, ?, 'project_budget_overrun', ?, ?, 'project', ?, 0, datetime('now'))
          `).run(
            `pbo_${p.id}_${today}`,
            companyId,
            title,
            message,
            p.id
          );
          affected++;
        } catch (err: any) {
          warnings.push(`Notification insert (project ${p.id}): ${err?.message || err}`);
          continue;
        }

        // Audit trail — best-effort.
        try {
          db.logAudit(companyId, 'projects', p.id, 'budget_overrun_flagged', {
            budget,
            expense_cost: expenseCost,
            labor_cost: laborCost,
            total_cost: totalCost,
            overrun,
            automation: 'project-budget-overrun-flag',
          });
        } catch { /* audit best-effort */ }
      } catch (err: any) {
        warnings.push(`Project ${p?.id} eval: ${err?.message || err}`);
      }
    }
  }

  return {
    ok: true,
    affected,
    detail: affected > 0
      ? `Flagged ${affected} project(s) over budget.`
      : 'No project budget overruns to flag.',
    warnings: warnings.length ? warnings : undefined,
  };
}

export const automation: AutomationModule = {
  id: 'project-budget-overrun-flag',
  name: 'Project Budget Overrun Flag',
  domain: 'projects-time',
  trigger: 'daily',
  run,
};
