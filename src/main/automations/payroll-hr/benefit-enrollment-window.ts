// src/main/automations/payroll-hr/benefit-enrollment-window.ts
//
// Benefit Enrollment Window
//
// Flags active employees who fall inside an OPEN benefit_plans
// enrollment window so HR can nudge them to enroll before the window
// closes. The automation is BEST-EFFORT and NEVER throws.
//
// Design choices:
//
//  • DEFENSIVE: `benefit_plans` is an optional/future table — it is NOT
//    in schema.sql at time of writing. We probe its existence and its
//    columns via PRAGMA table_info before touching it; if absent we
//    degrade to ok:false with a warning instead of crashing.
//
//  • Queues a `notifications` row per employee (entity_type='employee')
//    — we NEVER send email or move money. HR sees the flag in-app.
//
//  • IDEMPOTENT: before inserting we check that no unread notification
//    of the same type already exists for that employee+plan today, so
//    re-running the same day produces zero duplicate flags.
//
//  • Scoped per company; iterates all companies (or ctx.companyId).
//
//  • "Open window" = today within [enrollment_start, enrollment_end]
//    inclusive, using whichever date columns the table actually exposes.

import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

// Today as YYYY-MM-DD in LOCAL timezone (matches how date columns are
// stored as TEXT). Mirrors src/main/crons/overdue-checker.ts.
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function genId(): string {
  return `ben_enr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
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

  // ── Verify benefit_plans table + columns exist ──────────────
  let cols: Set<string>;
  try {
    const info = database.prepare(`PRAGMA table_info(benefit_plans)`).all() as any[];
    if (!info || info.length === 0) {
      return {
        ok: false,
        affected: 0,
        detail: 'benefit_plans table not found — nothing to scan',
        warnings: ['benefit_plans table does not exist in this database'],
      };
    }
    cols = new Set(info.map((c: any) => String(c.name)));
  } catch (err: any) {
    return {
      ok: false,
      affected: 0,
      detail: `Could not inspect benefit_plans: ${err?.message || err}`,
      warnings: ['benefit_plans table likely absent'],
    };
  }

  // Resolve the enrollment-window date columns defensively — the table
  // may name them differently across versions.
  const startCol =
    ['enrollment_start', 'open_enrollment_start', 'window_start', 'start_date'].find(c => cols.has(c));
  const endCol =
    ['enrollment_end', 'open_enrollment_end', 'window_end', 'end_date'].find(c => cols.has(c));
  if (!startCol || !endCol) {
    return {
      ok: false,
      affected: 0,
      detail: 'benefit_plans lacks recognizable enrollment window columns',
      warnings: [`columns present: ${Array.from(cols).join(', ')}`],
    };
  }
  const hasCompany = cols.has('company_id');
  const nameCol = ['name', 'plan_name', 'title'].find(c => cols.has(c));

  const today = ctx?.todayISO || localTodayISO();

  // Companies to scan.
  let companyIds: string[] = [];
  try {
    if (ctx?.companyId) {
      companyIds = [ctx.companyId];
    } else {
      const cur = db.getCurrentCompanyId();
      if (cur) companyIds = [cur];
      else {
        companyIds = (database.prepare(`SELECT id FROM companies`).all() as any[]).map(r => String(r.id));
      }
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
  }

  const insertNote = database.prepare(`
    INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
    VALUES (?, ?, 'benefit_enrollment_window', ?, ?, 'employee', ?, 0, datetime('now'))
  `);
  const existsNote = database.prepare(`
    SELECT 1 FROM notifications
    WHERE company_id = ? AND type = 'benefit_enrollment_window'
      AND entity_type = 'employee' AND entity_id = ?
      AND date(created_at) = ?
    LIMIT 1
  `);

  try {
    for (const companyId of companyIds) {
      // Find open plans for this company.
      let plans: any[] = [];
      try {
        const planSql = `
          SELECT id${nameCol ? `, ${nameCol} AS plan_name` : ''}
          FROM benefit_plans
          WHERE ${hasCompany ? 'company_id = ? AND ' : ''}
                ${startCol} IS NOT NULL AND ${startCol} != ''
            AND ${endCol} IS NOT NULL AND ${endCol} != ''
            AND ${startCol} <= ? AND ${endCol} >= ?
        `;
        plans = hasCompany
          ? (database.prepare(planSql).all(companyId, today, today) as any[])
          : (database.prepare(planSql).all(today, today) as any[]);
      } catch (err: any) {
        warnings.push(`Plan scan (company ${companyId}): ${err?.message || err}`);
        continue;
      }

      if (plans.length === 0) continue;

      // Active employees for this company.
      let employees: any[] = [];
      try {
        employees = database.prepare(
          `SELECT id, name FROM employees WHERE company_id = ? AND status = 'active'`
        ).all(companyId) as any[];
      } catch (err: any) {
        warnings.push(`Employee scan (company ${companyId}): ${err?.message || err}`);
        continue;
      }
      if (employees.length === 0) continue;

      const planLabel = plans.length === 1
        ? (plans[0].plan_name || 'a benefit plan')
        : `${plans.length} benefit plans`;

      for (const emp of employees) {
        try {
          const already = existsNote.get(companyId, String(emp.id), today);
          if (already) continue;
          insertNote.run(
            genId(),
            companyId,
            'Benefit enrollment open',
            `${emp.name || 'Employee'} is inside the open enrollment window for ${planLabel}.`,
            String(emp.id)
          );
          affected++;
        } catch (err: any) {
          warnings.push(`Flag emp ${emp.id}: ${err?.message || err}`);
        }
      }
    }
  } catch (err: any) {
    return {
      ok: false,
      affected,
      detail: `Unexpected failure: ${err?.message || err}`,
      warnings: warnings.length ? warnings : undefined,
    };
  }

  return {
    ok: true,
    affected,
    detail: affected > 0
      ? `Flagged ${affected} employee(s) inside an open benefit enrollment window`
      : 'No employees inside an open enrollment window today',
    warnings: warnings.length ? warnings : undefined,
  };
}

export const automation: AutomationModule = {
  id: 'benefit-enrollment-window',
  name: 'Benefit Enrollment Window',
  domain: 'payroll-hr',
  trigger: 'daily',
  run,
};
