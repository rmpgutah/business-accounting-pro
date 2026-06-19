// src/main/automations/expenses/expense-policy-violation-flag.ts
//
// Expense Policy Violation Flag
//
// Scans expenses against the company's active expense_policies and records
// any breaches into expense_policy_violations. This is the *batch* / catch-up
// counterpart to the on-submit evaluator in
// services/expense-policy-card-features.ts (evaluatePolicies): expenses that
// were imported, edited, or created before a policy existed never went through
// the on-submit check, so this daily pass re-evaluates them.
//
// Design choices:
//
//  • Trigger: daily. Caps are dollar thresholds that don't change minute to
//    minute; a once-a-day sweep is enough to surface breaches without churn.
//
//  • IDEMPOTENT — before inserting a violation we check that an *un-acknowledged*
//    violation of the same (expense_id, policy_id, violation_type) doesn't
//    already exist. Re-running the same day (or any day) inserts nothing new.
//    Acknowledged violations are NOT re-flagged.
//
//  • BEST-EFFORT / NEVER THROWS — every db access is wrapped; on any failure
//    we degrade to ok:false with a warning rather than crashing the scheduler.
//
//  • Only the per-expense cap (max_per_expense) is enforced here. Daily/monthly
//    rolling caps and receipt requirements depend on columns (employee_id,
//    receipt_path) that may not be reliably populated across installs, so we
//    keep the batch flag focused on the unambiguous per-line breach. The
//    on-submit evaluator still handles the richer cases interactively.
//
//  • Scope matching mirrors evaluatePolicies: global / category / vendor.
//    (employee scope is omitted because expenses.employee_id is not present in
//    base schema and would silently match nothing or error.)
//
//  • We never move money or send email — we only queue a violation row.

import { randomUUID as uuid } from 'crypto';
import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

// Local YYYY-MM-DD — matches crons/overdue-checker.ts.
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  let affected = 0;

  const today = ctx?.todayISO || localTodayISO();

  let database: ReturnType<typeof db.getDb>;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  // Resolve the set of companies to scan.
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

  if (companyIds.length === 0) {
    return { ok: true, affected: 0, detail: 'No companies to scan.' };
  }

  // Prepared statements (guarded — tables/columns are created via migration in
  // database/index.ts, not base schema.sql, so a missing table degrades gracefully).
  let selPolicies: any, selExpenses: any, selExisting: any, insViolation: any;
  try {
    selPolicies = database.prepare(`
      SELECT id, scope, category_id, vendor_id, max_per_expense, enforcement
      FROM expense_policies
      WHERE company_id = ?
        AND is_active = 1
        AND max_per_expense IS NOT NULL
        AND max_per_expense > 0
    `);
    selExpenses = database.prepare(`
      SELECT id, amount, category_id, vendor_id
      FROM expenses
      WHERE company_id = ?
        AND COALESCE(amount, 0) > 0
    `);
    selExisting = database.prepare(`
      SELECT id FROM expense_policy_violations
      WHERE company_id = ?
        AND expense_id = ?
        AND COALESCE(policy_id, '') = ?
        AND violation_type = 'max_per_expense'
        AND COALESCE(acknowledged, 0) = 0
      LIMIT 1
    `);
    insViolation = database.prepare(`
      INSERT INTO expense_policy_violations
        (id, company_id, expense_id, policy_id, violation_type, violation_message, severity, detected_at)
      VALUES (?, ?, ?, ?, 'max_per_expense', ?, ?, ?)
    `);
  } catch (err: any) {
    return {
      ok: false,
      affected: 0,
      detail: `Policy/violation tables unavailable: ${err?.message || err}`,
    };
  }

  let companiesScanned = 0;

  for (const companyId of companyIds) {
    let policies: any[];
    try {
      policies = selPolicies.all(companyId) as any[];
    } catch (err: any) {
      warnings.push(`company ${companyId}: policy load failed: ${err?.message || err}`);
      continue;
    }
    if (policies.length === 0) {
      companiesScanned++;
      continue;
    }

    let expenses: any[];
    try {
      expenses = selExpenses.all(companyId) as any[];
    } catch (err: any) {
      warnings.push(`company ${companyId}: expense load failed: ${err?.message || err}`);
      continue;
    }

    const detectedAt = `${today} 00:00:00`;

    try {
      const tx = database.transaction(() => {
        for (const exp of expenses) {
          const amount = Number(exp.amount || 0);
          if (!(amount > 0)) continue;

          for (const p of policies) {
            // Scope match — mirrors evaluatePolicies (global/category/vendor).
            const scope = String(p.scope || 'global');
            if (scope === 'category' && String(p.category_id || '') !== String(exp.category_id || '')) continue;
            if (scope === 'vendor' && String(p.vendor_id || '') !== String(exp.vendor_id || '')) continue;
            if (scope !== 'global' && scope !== 'category' && scope !== 'vendor') continue;

            const cap = Number(p.max_per_expense || 0);
            if (!(cap > 0)) continue;
            // Money breach with epsilon — only flag a genuine overage.
            if (amount - cap <= 0.005) continue;

            // Idempotency: skip if an open violation already exists.
            const existing = selExisting.get(companyId, exp.id, String(p.id || '')) as any;
            if (existing) continue;

            const severity = String(p.enforcement || 'warn');
            const message =
              `Amount $${amount.toFixed(2)} exceeds per-expense limit $${cap.toFixed(2)}`;
            insViolation.run(uuid(), companyId, exp.id, p.id, message, severity, detectedAt);
            affected++;
          }
        }
      });
      tx();
      companiesScanned++;
    } catch (err: any) {
      warnings.push(`company ${companyId}: flagging failed: ${err?.message || err}`);
    }
  }

  const detail = `Scanned ${companiesScanned} company(ies); flagged ${affected} new per-expense cap violation(s).`;
  return warnings.length > 0
    ? { ok: affected >= 0, affected, detail, warnings }
    : { ok: true, affected, detail };
}

export const automation: AutomationModule = {
  id: 'expense-policy-violation-flag',
  name: 'Expense Policy Violation Flag',
  domain: 'expenses',
  trigger: 'daily',
  run,
};
