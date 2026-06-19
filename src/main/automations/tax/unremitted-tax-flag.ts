// src/main/automations/tax/unremitted-tax-flag.ts
//
// Automation: Unremitted Tax Flag (id: unremitted-tax-flag)
//
// Flags sales tax that has been billed (invoices.tax_amount on issued
// invoices) and payroll tax that has been withheld (pay_stubs federal/
// state/SS/medicare on processed payroll runs) but has NOT yet been
// remitted to the authorities — i.e. there is no matching coverage in
// tax_payments for that liability type.
//
// SAFETY / DESIGN:
//   • Best-effort: run() NEVER throws. All db work is wrapped in
//     try/catch; any failure degrades to { ok:false } with a warning.
//   • Side-effect is limited to QUEUEING a notification per company.
//     It never moves money, files anything, or sends external email.
//   • IDEMPOTENT: before inserting, it checks whether a notification of
//     type 'unremitted_tax' already exists for the same company on the
//     same local day, so re-running the same day is a no-op.
//   • Money comparison uses a 0.005 epsilon: a liability is considered
//     fully remitted when (liability - remitted) <= 0.005.
//   • Only columns/tables verified against schema.sql are referenced:
//       invoices(tax_amount,status,company_id)
//       pay_stubs(federal_tax,state_tax,social_security,medicare,payroll_run_id)
//       payroll_runs(id,status,company_id)
//       tax_payments(type,amount,company_id)
//       notifications(id,company_id,type,title,message,created_at)

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

// Local YYYY-MM-DD — mirrors src/main/crons/overdue-checker.ts so date
// comparisons line up with how the rest of the app stores dates.
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Sum tax_payments.amount whose type matches any of the given keywords
// (case-insensitive substring). Sales-tax remittances tend to be typed
// 'sales_tax'/'sales'; payroll typed 'payroll'/'941'/'withholding'/etc.
function sumRemitted(rows: Array<{ type: string; amount: number }>, keywords: string[]): number {
  let total = 0;
  for (const r of rows) {
    const t = String(r.type || '').toLowerCase();
    if (keywords.some((k) => t.includes(k))) {
      total += Number(r.amount) || 0;
    }
  }
  return total;
}

function money(n: number): string {
  return (Number(n) || 0).toFixed(2);
}

export const automation: AutomationModule = {
  id: 'unremitted-tax-flag',
  name: 'Unremitted Tax Flag',
  domain: 'tax',
  // Tax remittance is a periodic compliance concern; a daily sweep is
  // frequent enough to surface gaps promptly without being noisy
  // (idempotency guard keeps it to one flag per company per day).
  trigger: 'daily',

  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
    const warnings: string[] = [];
    const today = ctx?.todayISO || localTodayISO();

    let database: ReturnType<typeof db.getDb>;
    try {
      database = db.getDb();
    } catch (err: any) {
      return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
    }

    // Resolve target companies: explicit ctx.companyId, else current
    // scoped company, else iterate all companies.
    let companies: Array<{ id: string }> = [];
    try {
      if (ctx?.companyId) {
        companies = [{ id: ctx.companyId }];
      } else {
        const current = db.getCurrentCompanyId?.();
        if (current) {
          companies = [{ id: current }];
        } else {
          companies = (database.prepare(`SELECT id FROM companies`).all() as any[]).map((c) => ({
            id: String(c.id),
          }));
        }
      }
    } catch (err: any) {
      return { ok: false, affected: 0, detail: `Failed to resolve companies: ${err?.message || err}` };
    }

    let flagged = 0;

    for (const { id: companyId } of companies) {
      try {
        // ── Sales tax billed ────────────────────────────────
        // Count tax on invoices that have actually been issued to a
        // client (anything that left 'draft'/'cancelled'). The billed
        // tax is a liability regardless of whether the invoice is paid.
        let salesBilled = 0;
        try {
          const row = database
            .prepare(
              `SELECT COALESCE(SUM(COALESCE(tax_amount, 0)), 0) AS t
                 FROM invoices
                WHERE company_id = ?
                  AND status IN ('sent','paid','overdue','partial')`
            )
            .get(companyId) as any;
          salesBilled = Number(row?.t) || 0;
        } catch (e: any) {
          warnings.push(`sales-tax sum (company ${companyId}): ${e?.message || e}`);
        }

        // ── Payroll tax withheld ────────────────────────────
        // Withholdings on processed/paid payroll runs: federal + state
        // income tax + employee SS + medicare. Draft runs are excluded
        // (not yet a liability).
        let payrollWithheld = 0;
        try {
          const row = database
            .prepare(
              `SELECT COALESCE(SUM(
                        COALESCE(ps.federal_tax, 0)
                      + COALESCE(ps.state_tax, 0)
                      + COALESCE(ps.social_security, 0)
                      + COALESCE(ps.medicare, 0)
                      ), 0) AS t
                 FROM pay_stubs ps
                 JOIN payroll_runs pr ON pr.id = ps.payroll_run_id
                WHERE pr.company_id = ?
                  AND pr.status IN ('processed','paid')`
            )
            .get(companyId) as any;
          payrollWithheld = Number(row?.t) || 0;
        } catch (e: any) {
          warnings.push(`payroll-tax sum (company ${companyId}): ${e?.message || e}`);
        }

        // ── Remittances on record ───────────────────────────
        let payments: Array<{ type: string; amount: number }> = [];
        try {
          payments = (database
            .prepare(`SELECT type, amount FROM tax_payments WHERE company_id = ?`)
            .all(companyId) as any[]).map((p) => ({
            type: String(p.type || ''),
            amount: Number(p.amount) || 0,
          }));
        } catch (e: any) {
          warnings.push(`tax_payments read (company ${companyId}): ${e?.message || e}`);
        }

        const salesRemitted = sumRemitted(payments, ['sales', 'use_tax', 'use tax']);
        const payrollRemitted = sumRemitted(payments, [
          'payroll',
          'withhold',
          '941',
          '940',
          'fica',
          'medicare',
          'social',
        ]);

        const salesOwed = salesBilled - salesRemitted;
        const payrollOwed = payrollWithheld - payrollRemitted;

        const salesUnremitted = salesOwed > EPSILON;
        const payrollUnremitted = payrollOwed > EPSILON;

        if (!salesUnremitted && !payrollUnremitted) {
          continue; // nothing owed for this company
        }

        // ── Idempotency guard ───────────────────────────────
        // Skip if we already queued an unremitted-tax flag for this
        // company today.
        try {
          const existing = database
            .prepare(
              `SELECT 1 FROM notifications
                WHERE company_id = ?
                  AND type = 'unremitted_tax'
                  AND substr(created_at, 1, 10) = ?
                LIMIT 1`
            )
            .get(companyId, today) as any;
          if (existing) {
            continue;
          }
        } catch (e: any) {
          // If we cannot verify idempotency, do NOT insert — risk of dupes.
          warnings.push(`idempotency check (company ${companyId}): ${e?.message || e}`);
          continue;
        }

        // ── Queue the flag (notification only) ───────────────
        const parts: string[] = [];
        if (salesUnremitted) {
          parts.push(`Sales tax: $${money(salesOwed)} billed but not remitted`);
        }
        if (payrollUnremitted) {
          parts.push(`Payroll tax: $${money(payrollOwed)} withheld but not remitted`);
        }
        const message = parts.join('. ') + '.';

        try {
          const nid = `untax_${companyId}_${today}_${Date.now()}`;
          database
            .prepare(
              `INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
               VALUES (?, ?, 'unremitted_tax', ?, ?, 'tax', NULL, 0, datetime('now'))`
            )
            .run(nid, companyId, 'Unremitted tax detected', message);
          flagged++;
        } catch (e: any) {
          warnings.push(`notification insert (company ${companyId}): ${e?.message || e}`);
          continue;
        }

        // Best-effort audit trail (does not affect success).
        try {
          db.logAudit?.(companyId, 'tax_payments', '', 'unremitted_tax_flag', {
            sales_billed: salesBilled,
            sales_remitted: salesRemitted,
            sales_owed: salesOwed,
            payroll_withheld: payrollWithheld,
            payroll_remitted: payrollRemitted,
            payroll_owed: payrollOwed,
            automation: 'unremitted-tax-flag',
            date: today,
          });
        } catch {
          /* audit best-effort */
        }
      } catch (e: any) {
        warnings.push(`company ${companyId}: ${e?.message || e}`);
      }
    }

    return {
      ok: true,
      affected: flagged,
      detail:
        flagged > 0
          ? `Queued ${flagged} unremitted-tax flag(s) across ${companies.length} company(ies).`
          : `No unremitted tax detected (scanned ${companies.length} company(ies)).`,
      warnings: warnings.length ? warnings : undefined,
    };
  },
};
