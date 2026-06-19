// src/main/automations/banking/reconciliation-reminder.ts
//
// Reconciliation Reminder
//
// Scans every company's bank_accounts and QUEUES an in-app notification
// when an account has not been reconciled in N days (default 30), based
// on bank_accounts.last_reconciled_date. Accounts that have NEVER been
// reconciled (NULL/'' last_reconciled_date) also qualify once they are
// at least N days old (using created_at as the anchor).
//
// Design choices:
//  • Best-effort: run() NEVER throws. Any failure degrades to ok:false.
//  • Idempotent: at most one reminder per account per calendar day. We
//    check the notifications table for an existing same-day row keyed by
//    (entity_type='bank_account', entity_id, type) before inserting.
//  • Never sends email / moves money — only writes a notification row.
//  • Per-company threshold via settings key 'reconciliation_reminder_days'
//    (clamped to [1, 365]); defaults to 30.
//  • Money/owed epsilon (0.005) is not relevant here, but date math is
//    done in LOCAL time to match how dates are stored (TEXT YYYY-MM-DD),
//    mirroring src/main/crons/overdue-checker.ts.

import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Whole days between two YYYY-MM-DD dates (anchored at noon LOCAL to
// dodge DST edges). Returns NaN if either side is unparseable.
function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(`${fromISO}T12:00:00`).getTime();
  const b = new Date(`${toISO}T12:00:00`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return Math.floor((b - a) / 86_400_000);
}

function getThresholdDays(companyId: string): number {
  try {
    const row = db.getDb().prepare(
      "SELECT value FROM settings WHERE company_id = ? AND key = 'reconciliation_reminder_days'"
    ).get(companyId) as { value?: string } | undefined;
    const v = parseInt(row?.value ?? '', 10);
    if (Number.isFinite(v) && v >= 1) return Math.min(v, 365);
  } catch { /* fall through to default */ }
  return 30;
}

function genId(): string {
  return `recon_rem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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

  const today = ctx?.todayISO || localTodayISO();

  // Resolve company scope.
  let companies: { id: string }[] = [];
  try {
    if (ctx?.companyId) {
      companies = [{ id: ctx.companyId }];
    } else {
      let current: string | null = null;
      try { current = db.getCurrentCompanyId(); } catch { current = null; }
      if (current) {
        companies = [{ id: current }];
      } else {
        companies = (database.prepare(`SELECT id FROM companies`).all() as any[]) as { id: string }[];
      }
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to resolve companies: ${err?.message || err}` };
  }

  let scanned = 0;

  try {
    const selAccounts = database.prepare(`
      SELECT id, name, last_reconciled_date, created_at
      FROM bank_accounts
      WHERE company_id = ?
    `);
    const selExisting = database.prepare(`
      SELECT id FROM notifications
      WHERE company_id = ?
        AND entity_type = 'bank_account'
        AND entity_id = ?
        AND type = 'reconciliation_reminder'
        AND substr(created_at, 1, 10) = ?
      LIMIT 1
    `);
    const insNotification = database.prepare(`
      INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
      VALUES (?, ?, 'reconciliation_reminder', ?, ?, 'bank_account', ?, 0, datetime('now'))
    `);

    for (const { id: companyId } of companies) {
      const thresholdDays = getThresholdDays(companyId);

      let accounts: Array<{ id: string; name: string; last_reconciled_date: string | null; created_at: string | null }> = [];
      try {
        accounts = selAccounts.all(companyId) as any[];
      } catch (err: any) {
        warnings.push(`Account scan failed (company ${companyId}): ${err?.message || err}`);
        continue;
      }

      for (const acct of accounts) {
        scanned++;

        const anchorRaw = acct.last_reconciled_date && acct.last_reconciled_date.trim() !== ''
          ? acct.last_reconciled_date
          : (acct.created_at && acct.created_at.trim() !== '' ? acct.created_at : null);
        if (!anchorRaw) continue; // no usable date to measure against

        // created_at is a datetime; reduce to its date part for day math.
        const anchorISO = anchorRaw.slice(0, 10);
        const elapsed = daysBetween(anchorISO, today);
        if (!Number.isFinite(elapsed)) continue;
        if (elapsed < thresholdDays) continue;

        // Idempotency: skip if a reminder for this account already exists today.
        try {
          const existing = selExisting.get(companyId, acct.id, today) as { id?: string } | undefined;
          if (existing && existing.id) continue;
        } catch (err: any) {
          warnings.push(`Idempotency check failed (account ${acct.id}): ${err?.message || err}`);
          continue;
        }

        const neverReconciled = !(acct.last_reconciled_date && acct.last_reconciled_date.trim() !== '');
        const title = neverReconciled
          ? `Bank account never reconciled: ${acct.name || acct.id}`
          : `Bank reconciliation overdue: ${acct.name || acct.id}`;
        const message = neverReconciled
          ? `"${acct.name || acct.id}" has never been reconciled and has been open for ${elapsed} day(s). Reconcile it to keep your books accurate.`
          : `"${acct.name || acct.id}" has not been reconciled in ${elapsed} day(s) (threshold ${thresholdDays}). Last reconciled ${anchorISO}.`;

        try {
          insNotification.run(genId(), companyId, title, message, acct.id);
          affected++;
        } catch (err: any) {
          warnings.push(`Failed to queue reminder (account ${acct.id}): ${err?.message || err}`);
        }
      }
    }
  } catch (err: any) {
    return { ok: false, affected, detail: `Unexpected failure: ${err?.message || err}`, warnings: warnings.length ? warnings : undefined };
  }

  return {
    ok: true,
    affected,
    detail: `Scanned ${scanned} bank account(s); queued ${affected} reconciliation reminder(s).`,
    warnings: warnings.length ? warnings : undefined,
  };
}

export const automation: AutomationModule = {
  id: 'reconciliation-reminder',
  name: 'Reconciliation Reminder',
  domain: 'banking',
  trigger: 'daily',
  run,
};
