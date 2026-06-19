// src/main/automations/collections/broken-promise-flag.ts
//
// Broken Promise Flag (collections)
// ----------------------------------
// A debtor who logs a "promise to pay" (a debt_communications row whose
// `outcome` mentions a promise and carries a promised date) but then lets
// that date pass WITHOUT a covering payment has BROKEN the promise.
//
// This automation scans open receivable debts, detects broken promises,
// and — best effort, idempotent, money/email-safe — advances the debt
// pipeline one stage and queues an in-app notification so a human can
// follow up. It NEVER sends email, moves money, or escalates twice.
//
// Promise detection (defensive, schema has no structured promise column):
//   - promise = latest debt_communications row for the debt whose
//               `outcome` contains "promise" (case-insensitive) AND that
//               carries a YYYY-MM-DD token in outcome/subject/body.
//   - broken  = promised date < today
//               AND balance still owed (balance_due > 0.005 epsilon)
//               AND no debt_payments row received on/after the promised
//               date (a covering payment would mean the promise was kept).
//
// Idempotency: before acting we check that no notification of type
// 'debt.broken_promise' already exists for this debt referencing the same
// promised date (encoded in entity_id as "<debtId>:<promiseDate>"). Re-running
// the same day -- or any later day -- produces no duplicate side effects.
//
// All DB work is wrapped in try/catch; run() never throws.

import { randomUUID as uuid } from 'crypto';
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

// Ordered collection pipeline (mirrors debts.current_stage CHECK constraint).
const STAGE_ORDER = [
  'reminder',
  'warning',
  'final_notice',
  'demand_letter',
  'collections_agency',
  'legal_action',
  'judgment',
  'garnishment',
] as const;

const EPSILON = 0.005;

// Today as YYYY-MM-DD in LOCAL time (matches overdue-checker.ts).
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Extract the first YYYY-MM-DD token from an arbitrary text blob.
function extractISODate(...parts: Array<string | null | undefined>): string | null {
  for (const p of parts) {
    if (!p) continue;
    const m = /(\d{4}-\d{2}-\d{2})/.exec(p);
    if (m) return m[1];
  }
  return null;
}

function nextStage(current: string): string | null {
  const idx = STAGE_ORDER.indexOf(current as (typeof STAGE_ORDER)[number]);
  if (idx < 0) return null; // unknown stage -- don't guess
  if (idx >= STAGE_ORDER.length - 1) return null; // already at final stage
  return STAGE_ORDER[idx + 1];
}

function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  let affected = 0;

  let database: ReturnType<typeof db.getDb>;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `DB not ready: ${err?.message || err}` };
  }

  const today = ctx?.todayISO || localTodayISO();

  // Resolve company scope.
  let companyIds: string[] = [];
  try {
    if (ctx?.companyId) {
      companyIds = [ctx.companyId];
    } else {
      const cur = db.getCurrentCompanyId();
      if (cur) {
        companyIds = [cur];
      } else {
        const rows = database.prepare(`SELECT id FROM companies`).all() as any[];
        companyIds = rows.map((r) => String(r.id));
      }
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to resolve companies: ${err?.message || err}` };
  }

  for (const companyId of companyIds) {
    // Pull open receivable debts that still owe money and aren't on hold or
    // already at a terminal status.
    let debts: any[] = [];
    try {
      debts = database
        .prepare(
          `SELECT id, current_stage, balance_due, debtor_name
             FROM debts
            WHERE company_id = ?
              AND type = 'receivable'
              AND COALESCE(hold, 0) = 0
              AND status NOT IN ('settled','written_off','bankruptcy')
              AND COALESCE(balance_due, 0) > ?`
        )
        .all(companyId, EPSILON) as any[];
    } catch (err: any) {
      warnings.push(`debts scan failed (company ${companyId}): ${err?.message || err}`);
      continue;
    }

    for (const debt of debts) {
      try {
        const balance = Number(debt.balance_due || 0);
        if (balance <= EPSILON) continue; // owed decided by BALANCE, not status

        // Find the most recent promise-to-pay communication carrying a date.
        let comms: any[] = [];
        try {
          comms = database
            .prepare(
              `SELECT outcome, subject, body, logged_at
                 FROM debt_communications
                WHERE debt_id = ?
                  AND LOWER(COALESCE(outcome,'')) LIKE '%promise%'
                ORDER BY logged_at DESC`
            )
            .all(debt.id) as any[];
        } catch {
          continue; // table/columns unexpectedly missing -- skip this debt
        }

        let promiseDate: string | null = null;
        for (const c of comms) {
          const d = extractISODate(c.outcome, c.subject, c.body);
          if (d) {
            promiseDate = d;
            break;
          }
        }
        if (!promiseDate) continue; // no datable promise on record

        // Not yet broken -- promised date is today or future.
        if (promiseDate >= today) continue;

        // Kept promise? Any payment received on/after the promised date.
        let covered = false;
        try {
          const pay = database
            .prepare(
              `SELECT COUNT(*) AS n
                 FROM debt_payments
                WHERE debt_id = ?
                  AND received_date IS NOT NULL
                  AND received_date >= ?`
            )
            .get(debt.id, promiseDate) as any;
          covered = Number(pay?.n || 0) > 0;
        } catch {
          // If we cannot verify payments, fail safe: assume kept (do nothing).
          covered = true;
        }
        if (covered) continue;

        // -- Broken promise confirmed --------------------------------
        // Idempotency key: one flag per (debt, promiseDate).
        const flagEntityId = `${debt.id}:${promiseDate}`;
        let already = false;
        try {
          const dup = database
            .prepare(
              `SELECT COUNT(*) AS n
                 FROM notifications
                WHERE company_id = ?
                  AND type = 'debt.broken_promise'
                  AND entity_type = 'debt'
                  AND entity_id = ?`
            )
            .get(companyId, flagEntityId) as any;
          already = Number(dup?.n || 0) > 0;
        } catch {
          // notifications table issue -- degrade: don't risk duplicate work.
          already = true;
        }
        if (already) continue;

        const target = nextStage(String(debt.current_stage || ''));

        const tx = database.transaction(() => {
          // Queue the human-facing flag (no email sent).
          database
            .prepare(
              `INSERT INTO notifications
                 (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
               VALUES (?, ?, 'debt.broken_promise', ?, ?, 'debt', ?, 0, datetime('now'))`
            )
            .run(
              uuid(),
              companyId,
              'Broken promise to pay',
              `${debt.debtor_name || 'Debtor'} did not pay by their promised date ${promiseDate}. Balance still owed.`,
              flagEntityId
            );

          // Advance the pipeline one stage (if a next stage exists).
          if (target) {
            // Close out the current open stage row, if any.
            try {
              database
                .prepare(
                  `UPDATE debt_pipeline_stages
                      SET exited_at = datetime('now')
                    WHERE debt_id = ? AND exited_at IS NULL`
                )
                .run(debt.id);
            } catch {
              /* stage history best-effort */
            }

            database
              .prepare(
                `INSERT INTO debt_pipeline_stages
                   (id, debt_id, stage, entered_at, auto_advanced, advanced_by, notes)
                 VALUES (?, ?, ?, datetime('now'), 1, 'broken-promise-flag', ?)`
              )
              .run(
                uuid(),
                debt.id,
                target,
                `Auto-advanced after broken promise to pay (promised ${promiseDate}).`
              );

            database
              .prepare(
                `UPDATE debts
                    SET current_stage = ?, updated_at = datetime('now')
                  WHERE id = ?`
              )
              .run(target, debt.id);
          }
        });
        tx();

        affected++;

        // Audit trail (best-effort).
        try {
          db.logAudit(companyId, 'debts', debt.id, 'broken_promise_flag', {
            _action: 'broken_promise_flag',
            promised_date: promiseDate,
            balance_due: balance,
            stage_from: debt.current_stage,
            stage_to: target || debt.current_stage,
            automation: 'broken-promise-flag',
          });
        } catch {
          /* audit best-effort */
        }
      } catch (err: any) {
        warnings.push(`debt ${debt?.id} (company ${companyId}): ${err?.message || err}`);
      }
    }
  }

  return {
    ok: true,
    affected,
    detail:
      affected > 0
        ? `Flagged ${affected} broken promise${affected === 1 ? '' : 's'} and advanced the pipeline.`
        : 'No broken promises found.',
    warnings: warnings.length ? warnings : undefined,
  };
}

export const automation: AutomationModule = {
  id: 'broken-promise-flag',
  name: 'Broken Promise Flag',
  domain: 'collections',
  trigger: 'daily',
  run,
};
