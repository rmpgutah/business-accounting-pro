// src/main/automations/banking/auto-bank-match.ts
//
// Auto Bank Match — suggests reconciliation matches between unmatched
// bank_transactions and open (still-owed) invoices/bills by EXACT amount
// and NEAR date (±7 days), then QUEUES each suggestion as a notification.
//
// Safety / design notes:
//  • READ-MOSTLY: never moves money, never flips is_matched/status on a
//    bank transaction, never records a payment. It only QUEUES a
//    human-reviewable suggestion (a notification row). A person confirms
//    the actual reconciliation elsewhere.
//  • The bank_reconciliation_matches table only links to journal entries
//    (no invoice/bill columns, no amount/notes), so it cannot structurally
//    hold an invoice→transaction suggestion. We therefore surface
//    suggestions via the notifications queue instead of forcing bad data
//    into that table.
//  • Direction: credit (money in) → open INVOICES (A/R);
//    debit (money out) → open BILLS (A/P).
//  • "Owed" is decided by BALANCE (total - amount_paid > 0.005 epsilon),
//    never by the status string alone.
//  • IDEMPOTENT: before queueing, we check no notification of the same
//    type already exists for that bank transaction (entity_id), so
//    re-running the same day does not duplicate suggestions.
//  • best-effort: run() never throws; all db work is wrapped in try/catch.

import { randomUUID } from 'crypto';
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
const DATE_WINDOW_DAYS = 7;
const NOTIF_TYPE = 'bank_match_suggestion';

// Today as YYYY-MM-DD in LOCAL timezone (matches how dates are stored).
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function shiftDays(isoDate: string, days: number): string {
  // Anchor at noon LOCAL to avoid DST edge cases.
  const dt = new Date(`${isoDate}T12:00:00`);
  dt.setDate(dt.getDate() + days);
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

  // Resolve company scope.
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
    return { ok: true, affected: 0, detail: 'No companies to scan.' };
  }

  const today = ctx?.todayISO || localTodayISO();

  let insertNotif: any;
  try {
    insertNotif = database.prepare(`
      INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
      VALUES (?, ?, ?, ?, ?, 'bank_transaction', ?, 0, datetime('now'))
    `);
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `notifications table unavailable: ${err?.message || err}` };
  }

  // Pre-built statements (guarded — degrade gracefully if a table is missing).
  let unmatchedStmt: any;
  let openInvoicesStmt: any;
  let openBillsStmt: any;
  let dupStmt: any;
  try {
    // Unmatched bank transactions for a company, scoped via bank_accounts.
    unmatchedStmt = database.prepare(`
      SELECT bt.id AS id, bt.date AS date, bt.amount AS amount, bt.type AS type,
             bt.description AS description
      FROM bank_transactions bt
      JOIN bank_accounts ba ON ba.id = bt.bank_account_id
      WHERE ba.company_id = ?
        AND COALESCE(bt.is_matched, 0) = 0
        AND COALESCE(bt.status, 'pending') = 'pending'
    `);
    // Open invoices: still owed by balance, with an issue/due date near the txn.
    openInvoicesStmt = database.prepare(`
      SELECT id, invoice_number, total, amount_paid, issue_date, due_date
      FROM invoices
      WHERE company_id = ?
        AND status != 'cancelled'
        AND ABS(COALESCE(total, 0) - ?) <= ?
        AND (COALESCE(total, 0) - COALESCE(amount_paid, 0)) > ?
        AND (
          (issue_date IS NOT NULL AND issue_date BETWEEN ? AND ?)
          OR (due_date IS NOT NULL AND due_date BETWEEN ? AND ?)
        )
    `);
    // Open bills: still owed by balance, near the txn date.
    openBillsStmt = database.prepare(`
      SELECT id, bill_number, total, amount_paid, issue_date, due_date
      FROM bills
      WHERE company_id = ?
        AND status != 'void'
        AND ABS(COALESCE(total, 0) - ?) <= ?
        AND (COALESCE(total, 0) - COALESCE(amount_paid, 0)) > ?
        AND (
          (issue_date IS NOT NULL AND issue_date BETWEEN ? AND ?)
          OR (due_date IS NOT NULL AND due_date BETWEEN ? AND ?)
        )
    `);
    // Idempotency: already-queued suggestion for this bank transaction?
    dupStmt = database.prepare(`
      SELECT 1 FROM notifications
      WHERE company_id = ? AND type = ? AND entity_id = ?
      LIMIT 1
    `);
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Required tables missing: ${err?.message || err}` };
  }

  for (const companyId of companyIds) {
    let txns: any[] = [];
    try {
      txns = unmatchedStmt.all(companyId) as any[];
    } catch (err: any) {
      warnings.push(`company ${companyId}: failed to read bank_transactions: ${err?.message || err}`);
      continue;
    }

    for (const txn of txns) {
      try {
        const amount = Math.abs(Number(txn.amount) || 0);
        if (amount <= EPSILON) continue;
        const date = String(txn.date || today);
        const lo = shiftDays(date, -DATE_WINDOW_DAYS);
        const hi = shiftDays(date, DATE_WINDOW_DAYS);
        const isCredit = String(txn.type || '') === 'credit';

        // Skip if a suggestion already exists (idempotent).
        const dup = dupStmt.get(companyId, NOTIF_TYPE, String(txn.id)) as any;
        if (dup) continue;

        let candidate: any = null;
        let kind = '';
        let docLabel = '';
        if (isCredit) {
          const rows = openInvoicesStmt.all(
            companyId, amount, EPSILON, EPSILON, lo, hi, lo, hi,
          ) as any[];
          if (rows.length > 0) {
            candidate = rows[0];
            kind = 'invoice';
            docLabel = `invoice ${candidate.invoice_number}`;
          }
          if (rows.length > 1) {
            warnings.push(`txn ${txn.id}: ${rows.length} invoices match amount ${amount}; suggested first.`);
          }
        } else {
          const rows = openBillsStmt.all(
            companyId, amount, EPSILON, EPSILON, lo, hi, lo, hi,
          ) as any[];
          if (rows.length > 0) {
            candidate = rows[0];
            kind = 'bill';
            docLabel = `bill ${candidate.bill_number}`;
          }
          if (rows.length > 1) {
            warnings.push(`txn ${txn.id}: ${rows.length} bills match amount ${amount}; suggested first.`);
          }
        }

        if (!candidate) continue;

        const title = `Possible match: ${docLabel}`;
        const message = JSON.stringify({
          bank_transaction_id: String(txn.id),
          bank_transaction_date: date,
          bank_transaction_amount: Number(txn.amount) || 0,
          bank_transaction_description: String(txn.description || ''),
          match_kind: kind,
          match_id: String(candidate.id),
          match_total: Number(candidate.total) || 0,
          match_balance: (Number(candidate.total) || 0) - (Number(candidate.amount_paid) || 0),
          source: 'auto-bank-match',
        });

        insertNotif.run(randomUUID(), companyId, NOTIF_TYPE, title, message, String(txn.id));
        affected++;
      } catch (err: any) {
        warnings.push(`txn ${txn?.id}: ${err?.message || err}`);
      }
    }
  }

  return {
    ok: true,
    affected,
    detail: `Queued ${affected} bank-match suggestion(s) across ${companyIds.length} company(ies).`,
    warnings: warnings.length ? warnings : undefined,
  };
}

export const automation: AutomationModule = {
  id: 'auto-bank-match',
  name: 'Auto Bank Match',
  domain: 'banking',
  trigger: 'daily',
  run,
};
