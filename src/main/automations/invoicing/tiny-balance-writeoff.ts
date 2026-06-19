// src/main/automations/invoicing/tiny-balance-writeoff.ts
//
// Tiny Balance Write-Off
//
// Auto-marks invoices that carry a small positive remaining balance
// (below a per-company configurable threshold, default $1.00) as
// paid/written-off. These tiny residuals come from rounding, partial
// over/under-payments, or stray cents on otherwise-settled invoices;
// they pollute AR aging reports and trigger pointless reminder chases.
//
// Design choices, mirroring src/main/crons/overdue-checker.ts:
//
//  • BEST-EFFORT / NEVER THROWS — all db work in try/catch, returns
//    { ok:false, ... } on any error.
//
//  • Per-company threshold via settings key 'tiny_balance_writeoff_threshold'
//    (clamped to (0, 50]). Defaults to 1.00. A balance is written off only
//    when 0.005 < balance <= threshold (strictly positive, but tiny).
//
//  • IDEMPOTENT — before acting on an invoice we check audit_log for an
//    existing 'tiny_balance_writeoff' entry for that invoice. Re-running
//    the same day (or any day) never double-writes-off the same invoice.
//
//  • SETTLE-BY-BALANCE — we never trust the status string alone. We bump
//    amount_paid up to total (recording the written-off cents) and flip
//    status to 'paid'. We record the write-off detail in audit_log; we do
//    NOT move real money, issue refunds, or send any external email.
//
//  • Money epsilon 0.005 — an invoice is already settled when
//    (total - amount_paid) <= 0.005, so we skip those.

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
const DEFAULT_THRESHOLD = 1.0;
const MAX_THRESHOLD = 50.0;

// Today as YYYY-MM-DD in LOCAL timezone (matches overdue-checker).
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getThreshold(database: any, companyId: string): number {
  try {
    const row = database
      .prepare(
        "SELECT value FROM settings WHERE company_id = ? AND key = 'tiny_balance_writeoff_threshold'"
      )
      .get(companyId) as { value?: string } | undefined;
    const v = parseFloat(row?.value ?? '');
    if (Number.isFinite(v) && v > 0) return Math.min(v, MAX_THRESHOLD);
  } catch {
    /* fall through to default */
  }
  return DEFAULT_THRESHOLD;
}

function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  let affected = 0;

  let database: any;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  const today = ctx?.todayISO || localTodayISO();

  // Scope: explicit ctx.companyId, else current company, else all companies.
  let companyIds: string[] = [];
  try {
    if (ctx?.companyId) {
      companyIds = [ctx.companyId];
    } else {
      const current = db.getCurrentCompanyId();
      if (current) {
        companyIds = [current];
      } else {
        const rows = database.prepare('SELECT id FROM companies').all() as Array<{ id: string }>;
        companyIds = rows.map((r) => r.id);
      }
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to resolve companies: ${err?.message || err}` };
  }

  for (const companyId of companyIds) {
    let threshold = DEFAULT_THRESHOLD;
    try {
      threshold = getThreshold(database, companyId);
    } catch {
      warnings.push(`company ${companyId}: threshold lookup failed, using default`);
    }

    let candidates: Array<{
      id: string;
      invoice_number: string;
      total: number;
      amount_paid: number;
      status: string;
    }> = [];
    try {
      // Tiny positive balance: 0.005 < (total - amount_paid) <= threshold.
      // Exclude already-settled and cancelled invoices. We deliberately
      // include 'sent'/'overdue'/'partial' (and even 'paid' rows that
      // somehow retain a tiny residual) and decide by BALANCE.
      candidates = database
        .prepare(
          `SELECT id, invoice_number, total, amount_paid, status
           FROM invoices
           WHERE company_id = ?
             AND status != 'cancelled'
             AND (COALESCE(total, 0) - COALESCE(amount_paid, 0)) > ?
             AND (COALESCE(total, 0) - COALESCE(amount_paid, 0)) <= ?`
        )
        .all(companyId, EPSILON, threshold) as typeof candidates;
    } catch (err: any) {
      warnings.push(`company ${companyId}: invoice scan failed: ${err?.message || err}`);
      continue;
    }

    for (const inv of candidates) {
      const total = Number(inv.total || 0);
      const paid = Number(inv.amount_paid || 0);
      const balance = total - paid;
      if (!(balance > EPSILON && balance <= threshold)) continue;

      // Idempotency guard — skip if already written off.
      try {
        const prior = database
          .prepare(
            `SELECT id FROM audit_log
             WHERE company_id = ? AND entity_type = 'invoices' AND entity_id = ?
               AND (action = 'tiny_balance_writeoff'
                    OR changes LIKE '%tiny_balance_writeoff%')
             LIMIT 1`
          )
          .get(companyId, inv.id) as { id: string } | undefined;
        if (prior) continue;
      } catch (err: any) {
        // If we can't verify idempotency, do NOT act — safer to skip.
        warnings.push(`invoice ${inv.id}: idempotency check failed, skipped: ${err?.message || err}`);
        continue;
      }

      // Apply: settle the residual by bumping amount_paid to total and
      // flipping status to 'paid'. Single UPDATE, no money movement.
      try {
        database
          .prepare(
            `UPDATE invoices
             SET amount_paid = total, status = 'paid', updated_at = datetime('now')
             WHERE id = ? AND company_id = ?`
          )
          .run(inv.id, companyId);
        affected++;

        try {
          db.logAudit(companyId, 'invoices', inv.id, 'tiny_balance_writeoff', {
            invoice_number: inv.invoice_number,
            previous_status: inv.status,
            new_status: 'paid',
            total,
            previous_amount_paid: paid,
            written_off_amount: Math.round(balance * 100) / 100,
            threshold,
            date: today,
            automation: 'tiny-balance-writeoff',
          });
        } catch {
          /* audit best-effort */
        }
      } catch (err: any) {
        warnings.push(`invoice ${inv.id}: write-off update failed: ${err?.message || err}`);
      }
    }
  }

  const detail =
    affected === 0
      ? 'No invoices with a tiny positive balance to write off.'
      : `Wrote off tiny balances on ${affected} invoice(s).`;

  return warnings.length
    ? { ok: true, affected, detail, warnings }
    : { ok: true, affected, detail };
}

export const automation: AutomationModule = {
  id: 'tiny-balance-writeoff',
  name: 'Tiny Balance Write-Off',
  domain: 'invoicing',
  trigger: 'daily',
  run,
};
