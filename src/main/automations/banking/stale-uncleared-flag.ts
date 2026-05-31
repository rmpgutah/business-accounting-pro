// src/main/automations/banking/stale-uncleared-flag.ts
//
// Automation: Stale Uncleared Flag (banking)
//
// Flags imported bank_transactions that are still uncleared (status
// 'pending' AND is_matched = 0) after N days. Uncleared imported
// transactions are a reconciliation hazard — they sit unmatched to any
// journal entry and silently distort the cash position until someone
// notices. This sweeps for them and QUEUES one summary notification per
// bank account per day so the user can act, without ever moving money,
// mutating the transaction, or sending external email.
//
// Design notes:
//  • bank_transactions has NO company_id column — it scopes via
//    bank_account_id -> bank_accounts.company_id. We join through that.
//  • "uncleared" = status='pending' AND is_matched=0 (defensive: both).
//  • "stale" = date <= today - N days (date stored as TEXT YYYY-MM-DD).
//  • N is per-company via settings key 'stale_uncleared_days', clamped
//    to [1, 365], default 14.
//  • IDEMPOTENT: a notification of type 'stale_uncleared_flag' tied to
//    the bank account is written at most once per local day. Re-running
//    the same day inserts nothing.
//  • run() is best-effort and NEVER throws.

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

// Local YYYY-MM-DD (matches how bank_transactions.date is stored).
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function dateMinusDays(isoDate: string, days: number): string {
  if (days <= 0) return isoDate;
  const dt = new Date(`${isoDate}T12:00:00`); // noon local avoids DST edges
  dt.setDate(dt.getDate() - days);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function genId(): string {
  return 'sucf_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

function getStaleDays(database: any, companyId: string): number {
  try {
    const row = database
      .prepare("SELECT value FROM settings WHERE company_id = ? AND key = 'stale_uncleared_days'")
      .get(companyId) as { value?: string } | undefined;
    const v = parseInt(row?.value ?? '', 10);
    if (Number.isFinite(v) && v >= 1) return Math.min(v, 365);
  } catch {
    /* fall through to default */
  }
  return 14;
}

export const automation: AutomationModule = {
  id: 'stale-uncleared-flag',
  name: 'Stale Uncleared Flag',
  domain: 'banking',
  trigger: 'daily',
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
    const warnings: string[] = [];
    let affected = 0;

    let database: any;
    try {
      database = db.getDb();
    } catch (err: any) {
      return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
    }

    const today = ctx?.todayISO || localTodayISO();

    // Scope to one company if provided, else all companies.
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

    for (const { id: companyId } of companies) {
      const staleDays = getStaleDays(database, companyId);
      const cutoff = dateMinusDays(today, staleDays);

      // Bank accounts for this company.
      let accounts: { id: string; name: string }[] = [];
      try {
        accounts = database
          .prepare(`SELECT id, name FROM bank_accounts WHERE company_id = ?`)
          .all(companyId) as { id: string; name: string }[];
      } catch (err: any) {
        warnings.push(`List bank accounts (company ${companyId}): ${err?.message || err}`);
        continue;
      }

      for (const acct of accounts) {
        try {
          // Count stale uncleared transactions for this account.
          const agg = database
            .prepare(
              `SELECT COUNT(*) AS cnt, COALESCE(SUM(ABS(amount)), 0) AS total
                 FROM bank_transactions
                WHERE bank_account_id = ?
                  AND COALESCE(status, 'pending') = 'pending'
                  AND COALESCE(is_matched, 0) = 0
                  AND date IS NOT NULL
                  AND date != ''
                  AND date <= ?`
            )
            .get(acct.id, cutoff) as { cnt?: number; total?: number } | undefined;

          const cnt = Number(agg?.cnt || 0);
          if (cnt <= 0) continue;

          // Idempotency: only one flag per account per local day.
          // We match on entity_id + type + the date prefix of created_at.
          const existing = database
            .prepare(
              `SELECT id FROM notifications
                WHERE company_id = ?
                  AND type = 'stale_uncleared_flag'
                  AND entity_type = 'bank_account'
                  AND entity_id = ?
                  AND substr(created_at, 1, 10) = ?
                LIMIT 1`
            )
            .get(companyId, acct.id, today) as { id: string } | undefined;

          if (existing) continue;

          const total = Number(agg?.total || 0);
          const title = `${cnt} uncleared bank transaction${cnt === 1 ? '' : 's'}`;
          const message =
            `${acct.name || 'A bank account'} has ${cnt} transaction${cnt === 1 ? '' : 's'} ` +
            `(${total.toFixed(2)} total) still uncleared after ${staleDays} day${staleDays === 1 ? '' : 's'}. ` +
            `Review and match or exclude them to keep reconciliation accurate.`;

          database
            .prepare(
              `INSERT INTO notifications
                 (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
               VALUES (?, ?, 'stale_uncleared_flag', ?, ?, 'bank_account', ?, 0, datetime('now'))`
            )
            .run(genId(), companyId, title, message, acct.id);

          affected++;
        } catch (err: any) {
          warnings.push(`Scan account ${acct.id} (company ${companyId}): ${err?.message || err}`);
        }
      }
    }

    return {
      ok: true,
      affected,
      detail:
        affected > 0
          ? `Queued ${affected} stale-uncleared flag notification(s).`
          : 'No stale uncleared bank transactions found.',
      ...(warnings.length ? { warnings } : {}),
    };
  },
};
