// src/main/automations/ap-bills/bill-overdue-stamp.ts
//
// Bill Overdue Stamp
//
// Flips unpaid, past-due accounts-payable bills into the 'overdue'
// status. A bill is considered overdue when its due_date has passed
// (relative to ctx.todayISO / local today) AND it still has an
// outstanding balance (total - amount_paid > epsilon).
//
// Design:
//  - Idempotent: rows already 'overdue', 'paid', 'void', or 'draft'
//    are excluded, so re-running the same day is a no-op.
//  - Balance-aware: settlement is decided by BALANCE with a 0.005
//    epsilon, never by the status string alone.
//  - Best-effort: run() NEVER throws; any failure degrades to
//    { ok:false } with a warning.
//  - The bills schema CHECK constraint allows pre-payment statuses
//    'pending','received','approved' (and 'partial'); there is no
//    'sent' status for bills, but it is included in the candidate
//    filter for forward-compatibility (it simply never matches today).

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

// Local YYYY-MM-DD, matching how due_date is stored and how
// crons/overdue-checker.ts computes "today".
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

  let database: ReturnType<typeof db.getDb>;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  const today = (ctx?.todayISO && /^\d{4}-\d{2}-\d{2}$/.test(ctx.todayISO))
    ? ctx.todayISO
    : localTodayISO();

  // Determine the set of companies to scan.
  let companyIds: string[] = [];
  try {
    if (ctx?.companyId) {
      companyIds = [ctx.companyId];
    } else {
      const current = db.getCurrentCompanyId?.();
      if (current) {
        companyIds = [current];
      } else {
        const rows = (database.prepare(`SELECT id FROM companies`).all() as any[]) || [];
        companyIds = rows.map((r) => r.id).filter((x): x is string => typeof x === 'string');
      }
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to resolve companies: ${err?.message || err}` };
  }

  for (const companyId of companyIds) {
    try {
      const candidates = (database.prepare(`
        SELECT id, COALESCE(total, 0) AS total, COALESCE(amount_paid, 0) AS amount_paid
        FROM bills
        WHERE company_id = ?
          AND status IN ('sent', 'pending', 'received', 'approved')
          AND due_date IS NOT NULL
          AND due_date != ''
          AND due_date < ?
      `).all(companyId, today) as any[]) || [];

      // Balance-aware filter: only flip rows with a real outstanding balance.
      const toFlip = candidates.filter(
        (b) => (Number(b.total) - Number(b.amount_paid)) > EPSILON
      );

      if (toFlip.length === 0) continue;

      const update = database.prepare(
        `UPDATE bills SET status = 'overdue', updated_at = datetime('now') WHERE id = ?`
      );
      const tx = database.transaction((rows: any[]) => {
        for (const b of rows) update.run(b.id);
      });
      tx(toFlip);
      affected += toFlip.length;

      // Best-effort audit trail per flipped bill.
      for (const b of toFlip) {
        try {
          db.logAudit?.(companyId, 'bills', b.id, 'auto_overdue', {
            previous_status: 'unpaid',
            new_status: 'overdue',
            balance_due: Number(b.total) - Number(b.amount_paid),
            today,
            source: 'bill-overdue-stamp',
          });
        } catch { /* audit best-effort */ }
      }
    } catch (err: any) {
      warnings.push(`Company ${companyId}: ${err?.message || err}`);
    }
  }

  return {
    ok: warnings.length === 0,
    affected,
    detail: `Flipped ${affected} past-due unpaid bill(s) to 'overdue' across ${companyIds.length} company(ies).`,
    ...(warnings.length ? { warnings } : {}),
  };
}

export const automation: AutomationModule = {
  id: 'bill-overdue-stamp',
  name: 'Bill Overdue Stamp',
  domain: 'ap-bills',
  trigger: 'daily',
  run,
};
