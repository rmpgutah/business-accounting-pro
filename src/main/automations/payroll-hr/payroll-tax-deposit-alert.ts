// src/main/automations/payroll-hr/payroll-tax-deposit-alert.ts
//
// Payroll Tax Deposit Alert
// -------------------------
// Queues in-app reminders for UPCOMING federal/state payroll-tax deposit
// due dates derived from processed payroll runs. The IRS monthly-depositor
// rule places the deposit deadline for a payroll on the 15th of the month
// FOLLOWING the pay date (form 941 employment-tax withholding + FICA).
// We approximate that conservative deadline per pay period and warn the
// user a few days before it lands.
//
// Safety / design:
//  • BEST-EFFORT: run() never throws. Every db touch is wrapped in
//    try/catch and degrades to ok:false with a warning.
//  • NEVER moves money, files a form, or sends external email. It only
//    INSERTS a row into the `notifications` table (an in-app alert queue).
//  • IDEMPOTENT: before inserting, we check that no notification with the
//    same type + entity_id (= the payroll_run id) already exists, so
//    re-running the same day (or any later day) never double-alerts for
//    the same deposit deadline.
//  • Settled/owed logic is N/A here (no invoice/bill balances) — we key
//    off the deposit-due date window only.
//  • Scoped per company via SELECT id FROM companies, honoring
//    ctx.companyId when provided.

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

const SLUG = 'payroll-tax-deposit-alert';

// How many days BEFORE a deposit deadline we start nagging.
const LOOKAHEAD_DAYS = 10;

function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Monthly-depositor deposit deadline: 15th of the month AFTER pay_date.
// Conservative — semiweekly depositors are due earlier, so this never
// alerts too late for a monthly schedule and is an upper bound otherwise.
function depositDueDate(payDateISO: string): string | null {
  const dt = new Date(`${payDateISO}T12:00:00`);
  if (isNaN(dt.getTime())) return null;
  let year = dt.getFullYear();
  let month = dt.getMonth() + 1; // 0-based -> next month
  if (month > 11) {
    month = 0;
    year += 1;
  }
  const due = new Date(year, month, 15, 12, 0, 0);
  const yyyy = due.getFullYear();
  const mm = String(due.getMonth() + 1).padStart(2, '0');
  const dd = String(due.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(`${fromISO}T12:00:00`).getTime();
  const b = new Date(`${toISO}T12:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  let affected = 0;

  let database: ReturnType<typeof db.getDb>;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  const today = ctx?.todayISO || localTodayISO();

  // Resolve scope: explicit company, else current, else all.
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

  for (const companyId of companyIds) {
    let runs: any[] = [];
    try {
      // Only processed/paid runs create a real deposit liability.
      runs = database.prepare(`
        SELECT id, pay_date, total_taxes
        FROM payroll_runs
        WHERE company_id = ?
          AND status IN ('processed','paid')
          AND pay_date IS NOT NULL
          AND pay_date != ''
      `).all(companyId) as any[];
    } catch (err: any) {
      warnings.push(`payroll_runs scan failed (company ${companyId}): ${err?.message || err}`);
      continue;
    }

    for (const r of runs) {
      const due = depositDueDate(String(r.pay_date));
      if (!due) continue;

      // Window: alert only when the deadline is still in the future
      // (or today) and within LOOKAHEAD_DAYS.
      const daysToDue = daysBetween(today, due);
      if (daysToDue < 0 || daysToDue > LOOKAHEAD_DAYS) continue;

      const runId = String(r.id);

      // Idempotency: skip if we already queued an alert for this run.
      try {
        const existing = database.prepare(`
          SELECT 1 FROM notifications
          WHERE company_id = ?
            AND type = 'payroll_tax_deposit_due'
            AND entity_type = 'payroll_run'
            AND entity_id = ?
          LIMIT 1
        `).get(companyId, runId);
        if (existing) continue;
      } catch (err: any) {
        warnings.push(`idempotency check failed (run ${runId}): ${err?.message || err}`);
        continue;
      }

      const taxes = Number(r.total_taxes || 0);
      const title = 'Payroll tax deposit due soon';
      const message =
        `Federal/state payroll tax deposit (Form 941 withholding + FICA) for the ` +
        `${r.pay_date} payroll is due by ${due}` +
        (taxes > 0 ? ` (est. ${taxes.toFixed(2)} in taxes).` : '.') +
        ` Verify your deposit schedule (monthly vs. semiweekly) with the IRS.`;

      try {
        const id = `${SLUG}-${runId}`;
        database.prepare(`
          INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
          VALUES (?, ?, 'payroll_tax_deposit_due', ?, ?, 'payroll_run', ?, 0, datetime('now'))
        `).run(id, companyId, title, message, runId);
        affected++;
      } catch (err: any) {
        // Likely a UNIQUE/PK clash from a concurrent run — treat as already queued.
        warnings.push(`insert failed (run ${runId}): ${err?.message || err}`);
      }
    }
  }

  return {
    ok: true,
    affected,
    detail: `Queued ${affected} payroll-tax-deposit alert(s) across ${companyIds.length} company(ies).`,
    warnings: warnings.length ? warnings : undefined,
  };
}

export const automation: AutomationModule = {
  id: SLUG,
  name: 'Payroll Tax Deposit Alert',
  domain: 'payroll-hr',
  trigger: 'weekly',
  run,
};
