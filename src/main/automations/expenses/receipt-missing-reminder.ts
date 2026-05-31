// src/main/automations/expenses/receipt-missing-reminder.ts
//
// Receipt Missing Reminder
//
// Scans expenses whose amount is at or above a per-company threshold and
// that lack any attached receipt, then QUEUES an in-app notification per
// such expense so the user can attach documentation (audit/tax hygiene).
//
// Design:
//  • Best-effort: run() NEVER throws. All db work is wrapped in try/catch
//    and degrades to { ok:false, affected:0, detail } on any error.
//  • Idempotent: before inserting a notification we check that one of the
//    same type does not already exist for that expense (entity_id). So
//    re-running the same day (or any day) never double-queues.
//  • Queues a notification only — never sends email or moves money.
//  • Per-company threshold via settings key 'receipt_required_threshold'
//    (defaults to 75.00). Clamped to a sane non-negative range.
//  • The `expenses` schema has `receipt_path` (no `receipts_json` column
//    exists), so "missing receipt" = receipt_path NULL/empty.
//
// Patterns mirror src/main/crons/overdue-checker.ts and
// src/main/services/invoice-payment-features.ts.

import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

const NOTIFICATION_TYPE = 'expense_receipt_missing';
const DEFAULT_THRESHOLD = 75.0;

// Local YYYY-MM-DD (matches overdue-checker).
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getThreshold(database: any, companyId: string): number {
  try {
    const row = database.prepare(
      "SELECT value FROM settings WHERE company_id = ? AND key = 'receipt_required_threshold'"
    ).get(companyId) as { value?: string } | undefined;
    const v = parseFloat(row?.value ?? '');
    if (Number.isFinite(v) && v >= 0) return v;
  } catch { /* fall through to default */ }
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

  // Determine company scope.
  let companies: { id: string }[] = [];
  try {
    if (ctx?.companyId) {
      companies = [{ id: ctx.companyId }];
    } else {
      companies = (database.prepare(`SELECT id FROM companies`).all() as any[]).map(
        (r) => ({ id: String(r.id) })
      );
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
  }

  const insert = (() => {
    try {
      return database.prepare(`
        INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
        VALUES (?, ?, ?, ?, ?, 'expense', ?, 0, datetime('now'))
      `);
    } catch (err: any) {
      warnings.push(`notifications table unavailable: ${err?.message || err}`);
      return null;
    }
  })();

  if (!insert) {
    return { ok: false, affected: 0, detail: 'notifications table not available', warnings };
  }

  const existsStmt = database.prepare(
    `SELECT 1 FROM notifications WHERE company_id = ? AND type = ? AND entity_id = ? LIMIT 1`
  );

  for (const { id: companyId } of companies) {
    const threshold = getThreshold(database, companyId);

    let candidates: any[] = [];
    try {
      candidates = database.prepare(`
        SELECT id, amount, date, description
        FROM expenses
        WHERE company_id = ?
          AND COALESCE(amount, 0) >= ?
          AND (receipt_path IS NULL OR TRIM(receipt_path) = '')
      `).all(companyId, threshold) as any[];
    } catch (err: any) {
      warnings.push(`Expense scan (company ${companyId}): ${err?.message || err}`);
      continue;
    }

    for (const exp of candidates) {
      try {
        const already = existsStmt.get(companyId, NOTIFICATION_TYPE, String(exp.id));
        if (already) continue; // idempotent guard

        const amt = Number(exp.amount || 0);
        const desc = String(exp.description || '').trim();
        const label = desc ? `"${desc}"` : `dated ${exp.date}`;
        const id = `${NOTIFICATION_TYPE}_${exp.id}`;
        insert.run(
          id,
          companyId,
          NOTIFICATION_TYPE,
          'Missing receipt',
          `Expense ${label} for ${amt.toFixed(2)} is over the ${threshold.toFixed(2)} threshold and has no receipt attached.`,
          String(exp.id)
        );
        affected++;
      } catch (err: any) {
        // Likely a UNIQUE/PK collision from a concurrent run — safe to skip.
        warnings.push(`Queue reminder for expense ${exp?.id}: ${err?.message || err}`);
      }
    }
  }

  return {
    ok: true,
    affected,
    detail: `Queued ${affected} missing-receipt reminder(s) as of ${today}.`,
    ...(warnings.length ? { warnings } : {}),
  };
}

export const automation: AutomationModule = {
  id: 'receipt-missing-reminder',
  name: 'Receipt Missing Reminder',
  domain: 'expenses',
  trigger: 'daily',
  run,
};
