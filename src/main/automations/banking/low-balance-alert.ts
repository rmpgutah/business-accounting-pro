// src/main/automations/banking/low-balance-alert.ts
//
// Low Balance Alert automation.
//
// Scans bank_accounts.current_balance for every company and QUEUES a
// notification (type='low_balance') when an account's balance falls below
// a configurable threshold. It never moves money or sends external email —
// it only writes an in-app notification row that the UI surfaces.
//
// Threshold resolution (per company, via settings table):
//   • key 'low_balance_threshold'  → numeric dollar cutoff (default 100)
//   An account is "low" when current_balance < threshold.
//
// Idempotency:
//   • At most one unread low_balance notification per bank account is kept
//     open at a time. Before inserting, we check for an existing UNREAD
//     notification with the same entity_id. Re-running the same day (or
//     hourly) will NOT create duplicates while the prior alert is unread.
//
// Best-effort: run() never throws. All DB work is wrapped in try/catch and
// degrades to { ok:false } with a warning on any error.

import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

const DEFAULT_THRESHOLD = 100;

// Today as YYYY-MM-DD in LOCAL timezone (matches overdue-checker style).
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function newId(): string {
  return `lba_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function resolveThreshold(database: any, companyId: string): number {
  try {
    const row = database.prepare(
      "SELECT value FROM settings WHERE company_id = ? AND key = 'low_balance_threshold'"
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

  // Determine target companies.
  let companies: { id: string }[] = [];
  try {
    const scoped = ctx?.companyId || db.getCurrentCompanyId();
    if (scoped) {
      companies = [{ id: scoped }];
    } else {
      companies = (database.prepare(`SELECT id FROM companies`).all() as any[]) as { id: string }[];
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
  }

  const today = ctx?.todayISO || localTodayISO();

  let insertStmt: any;
  let existsStmt: any;
  try {
    existsStmt = database.prepare(
      `SELECT id FROM notifications
       WHERE company_id = ? AND type = 'low_balance'
         AND entity_type = 'bank_account' AND entity_id = ?
         AND is_read = 0
       LIMIT 1`
    );
    insertStmt = database.prepare(
      `INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read)
       VALUES (?, ?, 'low_balance', ?, ?, 'bank_account', ?, 0)`
    );
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `notifications table unavailable: ${err?.message || err}` };
  }

  for (const { id: companyId } of companies) {
    const threshold = resolveThreshold(database, companyId);

    let accounts: Array<{ id: string; name: string; current_balance: number }> = [];
    try {
      accounts = (database.prepare(
        `SELECT id, name, COALESCE(current_balance, 0) AS current_balance
         FROM bank_accounts
         WHERE company_id = ? AND COALESCE(current_balance, 0) < ?`
      ).all(companyId, threshold) as any[]) as typeof accounts;
    } catch (err: any) {
      warnings.push(`Scan failed (company ${companyId}): ${err?.message || err}`);
      continue;
    }

    for (const acct of accounts) {
      try {
        const existing = existsStmt.get(companyId, acct.id);
        if (existing) continue; // idempotent: open alert already queued

        const bal = Number(acct.current_balance || 0);
        const title = `Low balance: ${acct.name}`;
        const message =
          `Account "${acct.name}" balance is $${bal.toFixed(2)}, ` +
          `below the $${threshold.toFixed(2)} threshold (as of ${today}).`;
        insertStmt.run(newId(), companyId, title, message, acct.id);
        affected++;
      } catch (err: any) {
        warnings.push(`Alert insert failed (account ${acct.id}): ${err?.message || err}`);
      }
    }
  }

  const detail = affected > 0
    ? `Queued ${affected} low-balance alert(s) across ${companies.length} company(ies).`
    : `No accounts below threshold across ${companies.length} company(ies).`;

  return { ok: true, affected, detail, warnings: warnings.length ? warnings : undefined };
}

export const automation: AutomationModule = {
  id: 'low-balance-alert',
  name: 'Low Balance Alert',
  domain: 'banking',
  trigger: 'daily',
  run,
};
