// src/main/automations/invoicing/auto-late-fee.ts
//
// Auto Late Fee — invoicing automation.
//
// Applies each invoice's configured late-fee percentage to invoices that
// are overdue (past due_date + grace days) and still owe a balance, then
// stamps `late_fee_applied` with the dollar amount applied so a re-run the
// same cycle does NOT double-charge.
//
// Idempotency: an invoice is only touched when late_fee_applied is 0/NULL.
// Once a fee is applied, late_fee_applied holds the fee amount (> 0) and
// the invoice is skipped on every subsequent run.
//
// Safety: this never moves money or sends email. It only adjusts the
// invoice's outstanding `total` (a bookkeeping balance change) and records
// an audit-log entry. All db work is wrapped in try/catch; run() never
// throws and degrades to ok:false on any error.
//
// Columns used (verified in schema.sql + database/index.ts migrations):
//   invoices: id, company_id, status, due_date, total, amount_paid,
//             late_fee_pct, late_fee_rate_pct, late_fee_grace_days,
//             late_fee_applied (REAL), updated_at

import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

const EPS = 0.005;

function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Subtract N days from a YYYY-MM-DD date, anchored at local noon to dodge
// DST edge cases. Returns YYYY-MM-DD.
function dateMinusDays(isoDate: string, days: number): string {
  if (!days || days <= 0) return isoDate;
  const dt = new Date(`${isoDate}T12:00:00`);
  dt.setDate(dt.getDate() - days);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
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

  // Resolve company scope: explicit ctx.companyId, else current company,
  // else iterate all companies.
  let companyIds: string[] = [];
  try {
    if (ctx?.companyId) {
      companyIds = [ctx.companyId];
    } else {
      const current = db.getCurrentCompanyId();
      if (current) {
        companyIds = [current];
      } else {
        companyIds = (database.prepare(`SELECT id FROM companies`).all() as any[])
          .map((r) => String(r.id));
      }
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to resolve companies: ${err?.message || err}` };
  }

  if (companyIds.length === 0) {
    return { ok: true, affected: 0, detail: 'No companies to process.' };
  }

  let select: any;
  let update: any;
  try {
    // Candidates: overdue (due_date passed grace), still owed by balance,
    // and not yet charged a late fee this cycle.
    select = database.prepare(`
      SELECT id,
             COALESCE(total, 0)            AS total,
             COALESCE(amount_paid, 0)      AS amount_paid,
             COALESCE(late_fee_pct, 0)        AS late_fee_pct,
             COALESCE(late_fee_rate_pct, 0)   AS late_fee_rate_pct,
             COALESCE(late_fee_grace_days, 0) AS grace_days,
             due_date
      FROM invoices
      WHERE company_id = ?
        AND status IN ('sent', 'overdue', 'partial')
        AND due_date IS NOT NULL
        AND due_date != ''
        AND COALESCE(late_fee_applied, 0) <= 0
        AND (COALESCE(total, 0) - COALESCE(amount_paid, 0)) > ?
    `);
    update = database.prepare(`
      UPDATE invoices
      SET total = ?, late_fee_applied = ?, updated_at = datetime('now')
      WHERE id = ? AND COALESCE(late_fee_applied, 0) <= 0
    `);
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Late-fee column(s) unavailable: ${err?.message || err}` };
  }

  for (const companyId of companyIds) {
    let rows: any[];
    try {
      rows = select.all(companyId, EPS) as any[];
    } catch (err: any) {
      warnings.push(`Scan failed for company ${companyId}: ${err?.message || err}`);
      continue;
    }

    for (const inv of rows) {
      try {
        // Effective fee rate: prefer the explicit per-invoice late_fee_pct,
        // fall back to late_fee_rate_pct. Treat as a percentage of balance.
        const pct = Number(inv.late_fee_pct) > 0
          ? Number(inv.late_fee_pct)
          : Number(inv.late_fee_rate_pct);
        if (!(pct > 0)) continue; // no configured fee -> nothing to apply

        const graceDays = Math.max(0, Math.floor(Number(inv.grace_days) || 0));
        const cutoff = dateMinusDays(today, graceDays);
        // Overdue only if due_date is on/before the grace-adjusted cutoff.
        if (!(String(inv.due_date) <= cutoff)) continue;

        const balance = Number(inv.total) - Number(inv.amount_paid);
        if (!(balance > EPS)) continue; // settled -> skip (balance, not status)

        const fee = Math.round(balance * (pct / 100) * 100) / 100;
        if (!(fee > 0)) continue;

        const newTotal = Math.round((Number(inv.total) + fee) * 100) / 100;

        const res = update.run(newTotal, fee, inv.id);
        if (res.changes > 0) {
          affected++;
          try {
            db.logAudit(companyId, 'invoices', String(inv.id), 'auto_late_fee', {
              previous_total: Number(inv.total),
              new_total: newTotal,
              late_fee: fee,
              late_fee_pct: pct,
              grace_days: graceDays,
              due_date: inv.due_date,
              automation: 'auto-late-fee',
            });
          } catch { /* audit best-effort */ }
        }
      } catch (err: any) {
        warnings.push(`Invoice ${inv?.id} (company ${companyId}): ${err?.message || err}`);
      }
    }
  }

  return {
    ok: true,
    affected,
    detail: affected > 0
      ? `Applied late fees to ${affected} overdue invoice(s).`
      : 'No overdue invoices required a late fee.',
    ...(warnings.length ? { warnings } : {}),
  };
}

export const automation: AutomationModule = {
  id: 'auto-late-fee',
  name: 'Auto Late Fee',
  domain: 'invoicing',
  trigger: 'daily',
  run,
};
