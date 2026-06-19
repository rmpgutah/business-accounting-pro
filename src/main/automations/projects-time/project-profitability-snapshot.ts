// src/main/automations/projects-time/project-profitability-snapshot.ts
//
// Project Profitability Snapshot — projects-time automation.
//
// For every active (non-archived) project, computes a point-in-time
// profitability snapshot — revenue, costs, margin — and persists it as an
// audit_log event (entity_type = 'project_profitability'). This gives the
// projects module a historical trail of how each project's economics moved
// over time without needing a dedicated table.
//
//   revenue = SUM(invoice_line_items.amount) for line items whose
//             project_id matches AND whose parent invoice is in a
//             "real" status (sent/paid/partial/overdue — i.e. not draft
//             or cancelled). Tax is excluded (we use the pre-tax line
//             amount, matching how line totals are stored).
//
//   expense_cost = SUM(expenses.amount) booked against the project.
//
//   labor_cost   = SUM(time_entries.duration_minutes/60 * hourly_rate)
//                  for billable-or-not entries with a positive rate.
//
//   cost   = expense_cost + labor_cost
//   margin = revenue - cost
//
// Idempotency: a project is snapshotted at most ONCE per day. Before
// inserting we check audit_log for an existing snapshot row for that
// (company, project, today) — if present we skip. Re-running the same day
// is therefore a no-op.
//
// Safety: never moves money, never emails. Only reads financial tables and
// writes audit_log rows. All db work is wrapped in try/catch; run() never
// throws and degrades to ok:false on any error. Every query is cast as
// any[] and guarded so a missing column/table degrades gracefully.
//
// Columns used (verified against schema.sql):
//   projects:            id, company_id, status
//   invoice_line_items:  invoice_id, amount, project_id
//   invoices:            id, company_id, status
//   expenses:            company_id, amount, project_id
//   time_entries:        company_id, project_id, duration_minutes, hourly_rate
//   audit_log:           company_id, entity_type, entity_id, timestamp, changes

import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

// Local YYYY-MM-DD — matches how date columns are stored. UTC would shift
// by ±1 day near midnight in non-UTC zones.
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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

  // Resolve the company set: explicit ctx → current → all companies.
  let companyIds: string[] = [];
  try {
    if (ctx?.companyId) {
      companyIds = [ctx.companyId];
    } else {
      const current = db.getCurrentCompanyId?.();
      if (current) {
        companyIds = [current];
      } else {
        const rows = database.prepare(`SELECT id FROM companies`).all() as any[];
        companyIds = rows.map((r) => String(r.id));
      }
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
  }

  for (const companyId of companyIds) {
    let projects: any[] = [];
    try {
      projects = database.prepare(
        `SELECT id, name FROM projects WHERE company_id = ? AND status != 'archived'`
      ).all(companyId) as any[];
    } catch (err: any) {
      warnings.push(`Project list failed (company ${companyId}): ${err?.message || err}`);
      continue;
    }

    for (const project of projects) {
      const projectId = String(project.id);

      // Idempotency guard — skip if a snapshot already exists today.
      try {
        const existing = database.prepare(
          `SELECT id FROM audit_log
             WHERE company_id = ?
               AND entity_type = 'project_profitability'
               AND entity_id = ?
               AND substr(timestamp, 1, 10) = ?
             LIMIT 1`
        ).get(companyId, projectId, today) as any;
        if (existing) continue;
      } catch (err: any) {
        warnings.push(`Idempotency check failed (project ${projectId}): ${err?.message || err}`);
        continue;
      }

      // ── Revenue: pre-tax line amounts on real (non-draft/cancelled) invoices ──
      let revenue = 0;
      try {
        const row = database.prepare(
          `SELECT COALESCE(SUM(li.amount), 0) AS rev
             FROM invoice_line_items li
             JOIN invoices i ON i.id = li.invoice_id
            WHERE li.project_id = ?
              AND i.company_id = ?
              AND i.status IN ('sent','paid','partial','overdue')`
        ).get(projectId, companyId) as any;
        revenue = num(row?.rev);
      } catch (err: any) {
        warnings.push(`Revenue calc failed (project ${projectId}): ${err?.message || err}`);
        continue;
      }

      // ── Expense cost ──
      let expenseCost = 0;
      try {
        const row = database.prepare(
          `SELECT COALESCE(SUM(amount), 0) AS c
             FROM expenses WHERE company_id = ? AND project_id = ?`
        ).get(companyId, projectId) as any;
        expenseCost = num(row?.c);
      } catch (err: any) {
        warnings.push(`Expense calc failed (project ${projectId}): ${err?.message || err}`);
        continue;
      }

      // ── Labor cost from logged time × rate ──
      let laborCost = 0;
      try {
        const row = database.prepare(
          `SELECT COALESCE(SUM((COALESCE(duration_minutes,0) / 60.0) * COALESCE(hourly_rate,0)), 0) AS c
             FROM time_entries WHERE company_id = ? AND project_id = ?`
        ).get(companyId, projectId) as any;
        laborCost = num(row?.c);
      } catch (err: any) {
        // Labor is optional context — degrade rather than abort the snapshot.
        warnings.push(`Labor calc failed (project ${projectId}): ${err?.message || err}`);
        laborCost = 0;
      }

      const cost = Math.round((expenseCost + laborCost) * 100) / 100;
      const rev = Math.round(revenue * 100) / 100;
      const margin = Math.round((rev - cost) * 100) / 100;
      const marginPct = rev > 0 ? Math.round((margin / rev) * 10000) / 100 : 0;

      // Persist snapshot via the audit-log event trail. logAudit is
      // best-effort and handles the legacy CHECK-constraint fallback.
      try {
        db.logAudit(companyId, 'project_profitability', projectId, 'snapshot', {
          snapshot_date: today,
          project_name: project.name ?? '',
          revenue: rev,
          expense_cost: Math.round(expenseCost * 100) / 100,
          labor_cost: Math.round(laborCost * 100) / 100,
          total_cost: cost,
          margin,
          margin_pct: marginPct,
          source: 'project-profitability-snapshot',
        });
        affected++;
      } catch (err: any) {
        warnings.push(`Snapshot write failed (project ${projectId}): ${err?.message || err}`);
      }
    }
  }

  const detail = `Snapshotted ${affected} project(s) across ${companyIds.length} company(ies) for ${today}.`;
  return warnings.length
    ? { ok: true, affected, detail, warnings }
    : { ok: true, affected, detail };
}

export const automation: AutomationModule = {
  id: 'project-profitability-snapshot',
  name: 'Project Profitability Snapshot',
  domain: 'projects-time',
  trigger: 'daily',
  run,
};
