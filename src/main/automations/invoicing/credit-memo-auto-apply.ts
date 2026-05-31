// src/main/automations/invoicing/credit-memo-auto-apply.ts
//
// Credit Memo Auto-Apply
//
// Applies open credit notes (the app's "credit memo" entity, table
// `credit_notes`) to the OLDEST open invoice belonging to the same
// client, idempotently. A credit note has unapplied balance when
// (total - amount_applied) > epsilon; an invoice is open/owed when
// (total - amount_paid) > epsilon.
//
// SAFETY / DESIGN:
//  • Never sends email or moves real money. "Applying" a credit only
//    nets an internal A/R balance: it bumps invoice.amount_paid and
//    credit_note.amount_applied and records a `payments` row tagged
//    payment_method='credit_note' so the application is auditable AND
//    serves as the idempotency key.
//  • Idempotent: before applying, we check no payments row already
//    links this credit_note -> this invoice (reference column holds
//    the credit_note id). Re-running the same day is a no-op once a
//    credit is fully applied.
//  • Best-effort: run() NEVER throws. Any error degrades to
//    { ok:false, affected:0, ... } with a warning.
//  • Per-company scoping; iterates all companies, or ctx.companyId.
//
// There is intentionally NO `credit_memos` / `customer_credit_balances`
// table in the schema — `credit_notes` is the canonical store, so we
// guard table access defensively.

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

function genId(): string {
  // Avoid hard dependency on a specific uuid export; crypto is always present.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return (require('crypto') as typeof import('crypto')).randomUUID();
  } catch {
    return 'cmaa_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
}

function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  let affected = 0;

  try {
    const database = db.getDb();
    const today = ctx?.todayISO || localTodayISO();

    // Resolve target companies.
    let companyIds: string[] = [];
    try {
      if (ctx?.companyId) {
        companyIds = [ctx.companyId];
      } else {
        const cur = db.getCurrentCompanyId();
        if (cur) companyIds = [cur];
        else {
          companyIds = (database.prepare('SELECT id FROM companies').all() as any[])
            .map((r) => r.id)
            .filter((x): x is string => typeof x === 'string' && x.length > 0);
        }
      }
    } catch (e) {
      return { ok: false, affected: 0, detail: 'Failed to resolve companies: ' + String(e) };
    }

    if (companyIds.length === 0) {
      return { ok: true, affected: 0, detail: 'No companies to process.' };
    }

    const selectCredits = database.prepare(
      `SELECT id, client_id, total, amount_applied
         FROM credit_notes
        WHERE company_id = ?
          AND status IN ('open','applied')
          AND client_id IS NOT NULL
          AND (total - amount_applied) > ?
        ORDER BY issue_date ASC, created_at ASC`
    );

    const selectOpenInvoices = database.prepare(
      `SELECT id, total, amount_paid, status
         FROM invoices
        WHERE company_id = ?
          AND client_id = ?
          AND status NOT IN ('cancelled','draft')
          AND (total - amount_paid) > ?
        ORDER BY due_date ASC, issue_date ASC, created_at ASC`
    );

    const alreadyApplied = database.prepare(
      `SELECT 1 FROM payments WHERE invoice_id = ? AND payment_method = 'credit_note' AND reference = ? LIMIT 1`
    );

    const insertPayment = database.prepare(
      `INSERT INTO payments (id, company_id, invoice_id, amount, date, payment_method, reference, notes)
       VALUES (?, ?, ?, ?, ?, 'credit_note', ?, ?)`
    );
    const bumpInvoicePaid = database.prepare(
      `UPDATE invoices SET amount_paid = amount_paid + ?, updated_at = datetime('now') WHERE id = ?`
    );
    const setInvoiceStatus = database.prepare(
      `UPDATE invoices SET status = ?, updated_at = datetime('now') WHERE id = ?`
    );
    const bumpCreditApplied = database.prepare(
      `UPDATE credit_notes SET amount_applied = amount_applied + ?, updated_at = datetime('now') WHERE id = ?`
    );
    const setCreditStatus = database.prepare(
      `UPDATE credit_notes SET status = ?, updated_at = datetime('now') WHERE id = ?`
    );
    const insertAudit = database.prepare(
      `INSERT INTO audit_log (id, company_id, entity_type, entity_id, action, changes, performed_by)
       VALUES (?, ?, 'credit_note', ?, 'update', ?, 'automation:credit-memo-auto-apply')`
    );

    const applyAll = database.transaction((companyId: string): number => {
      let localAffected = 0;
      const credits = selectCredits.all(companyId, EPS) as any[];

      for (const credit of credits) {
        let remaining = Number(credit.total) - Number(credit.amount_applied);
        if (!Number.isFinite(remaining) || remaining <= EPS) continue;

        const invoices = selectOpenInvoices.all(companyId, credit.client_id, EPS) as any[];

        for (const inv of invoices) {
          if (remaining <= EPS) break;

          // Idempotency: skip if this credit already applied to this invoice.
          if (alreadyApplied.get(inv.id, credit.id)) continue;

          const owed = Number(inv.total) - Number(inv.amount_paid);
          if (!Number.isFinite(owed) || owed <= EPS) continue;

          const applyAmt = Math.round(Math.min(remaining, owed) * 100) / 100;
          if (applyAmt <= EPS) continue;

          insertPayment.run(
            genId(),
            companyId,
            inv.id,
            applyAmt,
            today,
            credit.id,
            `Auto-applied credit note ${credit.id}`
          );
          bumpInvoicePaid.run(applyAmt, inv.id);

          const newOwed = owed - applyAmt;
          if (newOwed <= EPS) {
            setInvoiceStatus.run('paid', inv.id);
          } else if (inv.status !== 'partial' && inv.status !== 'overdue') {
            setInvoiceStatus.run('partial', inv.id);
          }

          bumpCreditApplied.run(applyAmt, credit.id);
          remaining = Math.round((remaining - applyAmt) * 100) / 100;

          try {
            insertAudit.run(
              genId(),
              companyId,
              credit.id,
              JSON.stringify({ applied_to_invoice: inv.id, amount: applyAmt, date: today })
            );
          } catch { /* audit is non-critical */ }

          localAffected++;
        }

        // Flip credit status to 'applied' once fully consumed.
        if (remaining <= EPS) {
          try { setCreditStatus.run('applied', credit.id); } catch { /* non-critical */ }
        }
      }

      return localAffected;
    });

    for (const companyId of companyIds) {
      try {
        affected += applyAll(companyId);
      } catch (e) {
        warnings.push(`company ${companyId}: ${String(e)}`);
      }
    }

    const detail = affected > 0
      ? `Applied ${affected} credit-note allocation(s) across ${companyIds.length} company(ies).`
      : `No applicable open credit notes found across ${companyIds.length} company(ies).`;

    return { ok: true, affected, detail, ...(warnings.length ? { warnings } : {}) };
  } catch (e) {
    return { ok: false, affected: 0, detail: 'Unexpected error: ' + String(e) };
  }
}

export const automation: AutomationModule = {
  id: 'credit-memo-auto-apply',
  name: 'Credit Memo Auto-Apply',
  domain: 'invoicing',
  trigger: 'daily',
  run,
};
