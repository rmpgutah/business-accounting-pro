// src/main/automations/banking/duplicate-transaction-detector.ts
//
// Duplicate Transaction Detector
//
// Flags likely-duplicate bank_transactions — rows sharing the same
// bank_account_id + amount + date + description. Bank imports (CSV/OFX
// re-imports, double-syncs) routinely create exact duplicates that
// inflate reconciliations. This automation finds clusters of identical
// transactions and QUEUES a notification for the user to review.
//
// SAFETY / DESIGN:
//  • Read-only over bank_transactions — it NEVER deletes, merges, or
//    edits a transaction. It only writes notification rows for review.
//  • Idempotent — a notification is keyed by a stable signature
//    (entity_id = the duplicate group's representative tx id). Re-runs
//    check for an existing unread notification of the same type/entity
//    before inserting, so the same day never double-notifies.
//  • bank_transactions has NO company_id (child of bank_accounts), so
//    we scope via bank_accounts.company_id and iterate all companies.
//  • run() is best-effort and MUST NEVER THROW.

import { randomUUID } from 'crypto';
import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

const NOTIF_TYPE = 'duplicate_bank_transaction';

function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  let affected = 0;

  let database;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  // Determine company scope.
  let companies: { id: string }[] = [];
  try {
    if (ctx?.companyId) {
      companies = [{ id: ctx.companyId }];
    } else {
      const current = db.getCurrentCompanyId?.();
      if (current) {
        companies = [{ id: current }];
      } else {
        companies = (database.prepare(`SELECT id FROM companies`).all() as any[]) as { id: string }[];
      }
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to resolve companies: ${err?.message || err}` };
  }

  for (const { id: companyId } of companies) {
    try {
      // Find duplicate groups: same account + date + amount + description
      // with more than one transaction. We keep the lexically-smallest id
      // as the group representative for a stable notification key.
      const groups = (database.prepare(`
        SELECT bt.bank_account_id AS bank_account_id,
               bt.date            AS date,
               bt.amount          AS amount,
               COALESCE(bt.description, '') AS description,
               COUNT(*)           AS cnt,
               MIN(bt.id)         AS rep_id
        FROM bank_transactions bt
        JOIN bank_accounts ba ON ba.id = bt.bank_account_id
        WHERE ba.company_id = ?
        GROUP BY bt.bank_account_id, bt.date, bt.amount, COALESCE(bt.description, '')
        HAVING COUNT(*) > 1
      `).all(companyId) as any[]) as Array<{
        bank_account_id: string;
        date: string;
        amount: number;
        description: string;
        cnt: number;
        rep_id: string;
      }>;

      for (const g of groups) {
        // Idempotency guard: skip if we already queued a notification
        // for this duplicate group (representative tx id).
        const existing = database.prepare(
          `SELECT id FROM notifications WHERE company_id = ? AND type = ? AND entity_type = ? AND entity_id = ? LIMIT 1`
        ).get(companyId, NOTIF_TYPE, 'bank_transaction', g.rep_id) as any;
        if (existing) continue;

        const desc = (g.description || '').trim() || '(no description)';
        const title = `${g.cnt} duplicate bank transactions detected`;
        const message =
          `${g.cnt} identical transactions of ${Number(g.amount).toFixed(2)} on ${g.date} ` +
          `("${desc}") in the same bank account. Review and remove duplicates if this was a re-import.`;

        try {
          database.prepare(`
            INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
          `).run(randomUUID(), companyId, NOTIF_TYPE, title, message, 'bank_transaction', g.rep_id);
          affected++;
        } catch (insErr: any) {
          warnings.push(`Insert failed (company ${companyId}, group ${g.rep_id}): ${insErr?.message || insErr}`);
        }
      }
    } catch (scanErr: any) {
      warnings.push(`Scan failed (company ${companyId}): ${scanErr?.message || scanErr}`);
    }
  }

  return {
    ok: true,
    affected,
    detail: affected > 0
      ? `Queued ${affected} duplicate-transaction notification(s) across ${companies.length} company(ies).`
      : `No new duplicate transactions found across ${companies.length} company(ies).`,
    ...(warnings.length ? { warnings } : {}),
  };
}

export const automation: AutomationModule = {
  id: 'duplicate-transaction-detector',
  name: 'Duplicate Transaction Detector',
  domain: 'banking',
  trigger: 'daily',
  run,
};
