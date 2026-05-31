// src/main/automations/collections/promise-to-pay-followup.ts
//
// Promise-To-Pay Follow-Up
//
// When a debtor promises to pay by a certain date (a "promise to pay" /
// PTP recorded in debt_promises), this automation scans for promises
// whose promised_date has passed without a matching payment having been
// received, and QUEUES a follow-up notification so a collector can chase.
//
// Design:
//  • Best-effort & defensive — NEVER throws. The debt_promises table may
//    not exist yet in every deployment, so we introspect sqlite_master /
//    pragma_table_info first and degrade to ok:false with a warning if
//    the table or the columns we need are missing. We never reference an
//    unverified column.
//  • Idempotent — we write a notifications row per broken promise and
//    guard with an existence check (same entity_id + type) so re-running
//    the same day does not duplicate. We also set a flag column on the
//    promise (broken_flagged / status) only if such a column exists.
//  • Settled-by-BALANCE — a promise is "kept" if a debt_payment of at
//    least the promised amount was received on/after the promise was made
//    and on/before today (0.005 epsilon). We decide by amounts, not by
//    any status string.
//  • Queues reminders only — never sends email or moves money.
//
// Trigger: daily — promises come due on calendar dates; one pass per day
// is the right cadence.

import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

const SETTLED_EPSILON = 0.005;

function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function tableExists(database: any, name: string): boolean {
  try {
    const row = database
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`)
      .get(name) as { name?: string } | undefined;
    return !!row?.name;
  } catch {
    return false;
  }
}

function columnSet(database: any, table: string): Set<string> {
  const cols = new Set<string>();
  try {
    const rows = database.prepare(`PRAGMA table_info(${table})`).all() as any[];
    for (const r of rows) if (r && typeof r.name === 'string') cols.add(r.name);
  } catch { /* ignore */ }
  return cols;
}

// Pick the first candidate column that actually exists on the table.
function pick(cols: Set<string>, candidates: string[]): string | null {
  for (const c of candidates) if (cols.has(c)) return c;
  return null;
}

export function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  let database: any;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  // Hard guard: the table this automation operates on may not exist.
  if (!tableExists(database, 'debt_promises')) {
    return {
      ok: false,
      affected: 0,
      detail: 'debt_promises table not present in this schema; nothing to scan',
      warnings: ['debt_promises table missing — automation is a no-op until it is created'],
    };
  }
  if (!tableExists(database, 'notifications')) {
    return {
      ok: false,
      affected: 0,
      detail: 'notifications table missing; cannot queue follow-ups',
      warnings: ['notifications table missing'],
    };
  }

  const pCols = columnSet(database, 'debt_promises');
  const idCol = pick(pCols, ['id']);
  const promisedDateCol = pick(pCols, ['promised_date', 'promise_date', 'due_date', 'expected_date']);
  if (!idCol || !promisedDateCol) {
    return {
      ok: false,
      affected: 0,
      detail: 'debt_promises lacks an id/promised_date column; cannot scan',
      warnings: ['Expected columns id + promised_date not found on debt_promises'],
    };
  }
  const companyCol = pick(pCols, ['company_id']);
  const debtCol = pick(pCols, ['debt_id']);
  const amountCol = pick(pCols, ['promised_amount', 'amount', 'expected_amount']);
  const createdCol = pick(pCols, ['created_at', 'promised_at', 'made_at']);
  // Optional flag column we can stamp so the UI/automation can mark broken.
  const statusCol = pick(pCols, ['status', 'state']);
  const brokenFlagCol = pick(pCols, ['broken_flagged', 'is_broken', 'broken']);

  const today = ctx?.todayISO || localTodayISO();

  // Determine company scope.
  let companies: { id: string }[] = [];
  try {
    if (ctx?.companyId) {
      companies = [{ id: ctx.companyId }];
    } else {
      companies = database.prepare(`SELECT id FROM companies`).all() as { id: string }[];
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
  }

  const havePayments = tableExists(database, 'debt_payments');
  let payAmountCol: string | null = null;
  let payDateCol: string | null = null;
  let payDebtCol: string | null = null;
  if (havePayments) {
    const payCols = columnSet(database, 'debt_payments');
    payAmountCol = pick(payCols, ['amount']);
    payDateCol = pick(payCols, ['received_date', 'payment_date', 'date']);
    payDebtCol = pick(payCols, ['debt_id']);
  }
  if (!havePayments || !payAmountCol || !payDateCol || !payDebtCol) {
    warnings.push('debt_payments unavailable or missing columns — cannot verify payment; flagging by date only');
  }

  let affected = 0;

  for (const { id: companyId } of companies) {
    let promises: any[] = [];
    try {
      // Build a defensive SELECT using only verified column names.
      const selectCols = [
        `${idCol} AS id`,
        `${promisedDateCol} AS promised_date`,
        debtCol ? `${debtCol} AS debt_id` : `NULL AS debt_id`,
        amountCol ? `${amountCol} AS promised_amount` : `NULL AS promised_amount`,
        createdCol ? `${createdCol} AS created_at` : `NULL AS created_at`,
        statusCol ? `${statusCol} AS status` : `NULL AS status`,
        brokenFlagCol ? `${brokenFlagCol} AS broken_flagged` : `NULL AS broken_flagged`,
      ].join(', ');

      const where: string[] = [
        `${promisedDateCol} IS NOT NULL`,
        `${promisedDateCol} != ''`,
        `${promisedDateCol} < ?`,
      ];
      const params: any[] = [today];
      if (companyCol) {
        where.unshift(`${companyCol} = ?`);
        params.unshift(companyId);
      }
      // Skip already-broken/flagged rows where the schema lets us.
      if (brokenFlagCol) where.push(`COALESCE(${brokenFlagCol}, 0) = 0`);
      if (statusCol) where.push(`COALESCE(${statusCol}, '') NOT IN ('broken','kept','cancelled','fulfilled')`);

      const sql = `SELECT ${selectCols} FROM debt_promises WHERE ${where.join(' AND ')}`;
      promises = database.prepare(sql).all(...params) as any[];
    } catch (err: any) {
      warnings.push(`Promise scan (company ${companyId}): ${err?.message || err}`);
      continue;
    }

    for (const p of promises) {
      try {
        // Determine if a qualifying payment kept the promise.
        let kept = false;
        if (payAmountCol && payDateCol && payDebtCol && p.debt_id) {
          const sinceDate: string = (p.created_at && String(p.created_at).slice(0, 10)) || '0000-01-01';
          const promised = Number(p.promised_amount);
          const row = database
            .prepare(
              `SELECT COALESCE(SUM(${payAmountCol}), 0) AS paid
               FROM debt_payments
               WHERE ${payDebtCol} = ?
                 AND ${payDateCol} IS NOT NULL
                 AND ${payDateCol} >= ?
                 AND substr(${payDateCol}, 1, 10) <= ?`
            )
            .get(p.debt_id, sinceDate, today) as { paid?: number } | undefined;
          const paid = Number(row?.paid || 0);
          if (Number.isFinite(promised) && promised > 0) {
            // Kept when the paid amount covers the promised amount (epsilon).
            kept = promised - paid <= SETTLED_EPSILON;
          } else {
            // No promised amount recorded — any payment in window keeps it.
            kept = paid > SETTLED_EPSILON;
          }
        }
        if (kept) continue;

        // Idempotency: do not queue twice for the same promise.
        const exists = database
          .prepare(
            `SELECT 1 FROM notifications
             WHERE company_id = ? AND type = 'debt_promise_broken'
               AND entity_type = 'debt_promise' AND entity_id = ?
             LIMIT 1`
          )
          .get(companyId, String(p.id));
        if (exists) continue;

        const ins = database.prepare(
          `INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
           VALUES (?, ?, 'debt_promise_broken', ?, ?, 'debt_promise', ?, 0, datetime('now'))`
        );
        const amtStr =
          p.promised_amount != null && Number.isFinite(Number(p.promised_amount))
            ? ` of ${Number(p.promised_amount).toFixed(2)}`
            : '';
        ins.run(
          `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
          companyId,
          'Promise to pay not honored',
          `A promise to pay${amtStr} was due ${String(p.promised_date).slice(0, 10)} but no matching payment was found. Follow up with the debtor.`,
          String(p.id)
        );

        // Best-effort stamp on the promise so the UI reflects the broken state.
        try {
          if (brokenFlagCol) {
            database.prepare(`UPDATE debt_promises SET ${brokenFlagCol} = 1 WHERE ${idCol} = ?`).run(p.id);
          } else if (statusCol) {
            database.prepare(`UPDATE debt_promises SET ${statusCol} = 'broken' WHERE ${idCol} = ?`).run(p.id);
          }
        } catch { /* stamp is best-effort */ }

        affected++;
      } catch (err: any) {
        warnings.push(`Promise ${p?.id} (company ${companyId}): ${err?.message || err}`);
      }
    }
  }

  return {
    ok: true,
    affected,
    detail: affected > 0
      ? `Flagged ${affected} broken promise(s) and queued follow-up notifications`
      : 'No broken promises to flag',
    warnings: warnings.length ? warnings : undefined,
  };
}

export const automation: AutomationModule = {
  id: 'promise-to-pay-followup',
  name: 'Promise-To-Pay Follow-Up',
  domain: 'collections',
  trigger: 'daily',
  run,
};
