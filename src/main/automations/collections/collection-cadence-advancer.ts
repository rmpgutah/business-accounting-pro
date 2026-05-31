// src/main/automations/collections/collection-cadence-advancer.ts
//
// Collection Cadence Advancer
// ---------------------------
// "debt_campaigns" in this codebase are modeled as collection cadence
// rules in `debt_automation_rules` (from_stage -> to_stage after
// `days_after_entry` days in the current stage). This automation finds
// active debts whose current pipeline stage has aged past its rule's
// cadence window and QUEUES a review notification so an operator can
// advance the stage / send the dunning template.
//
// SAFETY / DESIGN:
//   • Best-effort: run() never throws. All db work is wrapped in
//     try/catch and degrades to ok:false on failure.
//   • Never moves money, never changes the debt stage directly, never
//     sends external email. It only QUEUES a `notifications` row so a
//     human (or a downstream gated workflow) acts on it.
//   • Idempotent: before queueing, it checks an identical notification
//     (same entity_id + this automation's type marker referencing the
//     rule) does not already exist, so re-running the same day is a
//     no-op. The marker is embedded in the notification message.
//   • Settled debts are skipped by BALANCE (balance_due <= epsilon),
//     never by status string alone.
//   • Scoped per company via SELECT id FROM companies (or ctx.companyId).

import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

const EPSILON = 0.005;

function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Whole days between two YYYY-MM-DD(' 'HH:MM:SS) timestamps. Anchors at
// noon local to dodge DST edges. Returns a non-negative integer or 0.
function daysBetween(fromISO: string, toISO: string): number {
  try {
    const from = new Date(`${String(fromISO).slice(0, 10)}T12:00:00`);
    const to = new Date(`${String(toISO).slice(0, 10)}T12:00:00`);
    const ms = to.getTime() - from.getTime();
    if (!Number.isFinite(ms)) return 0;
    return Math.max(0, Math.floor(ms / 86_400_000));
  } catch {
    return 0;
  }
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
      companies = (database.prepare(`SELECT id FROM companies`).all() as any[]).map(
        (r) => ({ id: String(r.id) })
      );
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
  }

  for (const { id: companyId } of companies) {
    // Pull enabled cadence rules for this company. Guard the whole
    // block: if the table/columns are absent we degrade gracefully.
    let rules: Array<{
      id: string;
      debt_id: string | null;
      from_stage: string;
      to_stage: string;
      days_after_entry: number;
      action: string;
      template_name: string;
    }> = [];
    try {
      rules = (database.prepare(`
        SELECT id, debt_id, from_stage, to_stage,
               COALESCE(days_after_entry, 14) AS days_after_entry,
               COALESCE(action, 'advance_stage') AS action,
               COALESCE(template_name, '') AS template_name
        FROM debt_automation_rules
        WHERE company_id = ?
          AND COALESCE(enabled, 1) = 1
      `).all(companyId) as any[]).map((r) => ({
        id: String(r.id),
        debt_id: r.debt_id != null ? String(r.debt_id) : null,
        from_stage: String(r.from_stage || ''),
        to_stage: String(r.to_stage || ''),
        days_after_entry: Number(r.days_after_entry) || 0,
        action: String(r.action || 'advance_stage'),
        template_name: String(r.template_name || ''),
      }));
    } catch (err: any) {
      warnings.push(`Rule scan failed (company ${companyId}): ${err?.message || err}`);
      continue;
    }

    if (rules.length === 0) continue;

    for (const rule of rules) {
      if (!rule.from_stage) continue;

      // Candidate debts: active receivables sitting in from_stage with a
      // real outstanding balance. A rule may target one debt (debt_id)
      // or all debts in the from_stage (debt_id NULL).
      let debts: Array<{ id: string; current_stage: string; balance_due: number; debtor_name: string }> = [];
      try {
        const params: any[] = [companyId, rule.from_stage];
        let sql = `
          SELECT id, current_stage,
                 COALESCE(balance_due, 0) AS balance_due,
                 COALESCE(debtor_name, '') AS debtor_name
          FROM debts
          WHERE company_id = ?
            AND current_stage = ?
            AND status NOT IN ('settled','written_off')
            AND COALESCE(hold, 0) = 0
            AND COALESCE(balance_due, 0) > ?
        `;
        params.push(EPSILON);
        if (rule.debt_id) {
          sql += ` AND id = ?`;
          params.push(rule.debt_id);
        }
        debts = (database.prepare(sql).all(...params) as any[]).map((r) => ({
          id: String(r.id),
          current_stage: String(r.current_stage || ''),
          balance_due: Number(r.balance_due) || 0,
          debtor_name: String(r.debtor_name || ''),
        }));
      } catch (err: any) {
        warnings.push(`Debt scan failed (rule ${rule.id}): ${err?.message || err}`);
        continue;
      }

      for (const debt of debts) {
        // Determine when this debt ENTERED its current stage. Prefer the
        // open pipeline-stage row (exited_at NULL). Fall back to skipping
        // if we can't establish entry time (don't act on unknown age).
        let enteredAt: string | null = null;
        try {
          const row = database.prepare(`
            SELECT entered_at
            FROM debt_pipeline_stages
            WHERE debt_id = ?
              AND stage = ?
              AND (exited_at IS NULL OR exited_at = '')
            ORDER BY entered_at DESC
            LIMIT 1
          `).get(debt.id, debt.current_stage) as any;
          if (row && row.entered_at) enteredAt = String(row.entered_at);
        } catch (err: any) {
          warnings.push(`Stage lookup failed (debt ${debt.id}): ${err?.message || err}`);
          continue;
        }
        if (!enteredAt) continue;

        const ageDays = daysBetween(enteredAt, today);
        if (ageDays < rule.days_after_entry) continue; // cadence not yet due

        // Stable idempotency marker embedded in the notification message.
        const marker = `[cadence:${rule.id}:${debt.current_stage}->${rule.to_stage}]`;

        // Skip if we already queued this exact cadence step for this debt
        // (any prior run). This makes daily re-runs a no-op.
        try {
          const existing = database.prepare(`
            SELECT id FROM notifications
            WHERE company_id = ?
              AND entity_type = 'debt'
              AND entity_id = ?
              AND type = 'collection_cadence_due'
              AND message LIKE ?
            LIMIT 1
          `).get(companyId, debt.id, `%${marker}%`) as any;
          if (existing) continue;
        } catch (err: any) {
          warnings.push(`Dedup check failed (debt ${debt.id}): ${err?.message || err}`);
          continue;
        }

        // Queue the review notification (no money moved, no stage change).
        try {
          const notifId = `ccad_${rule.id}_${debt.id}_${debt.current_stage}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 120);
          const who = debt.debtor_name || 'debtor';
          const title = `Collection cadence due: ${who}`;
          const tmpl = rule.template_name ? ` (template: ${rule.template_name})` : '';
          const message =
            `${who} has been in stage "${debt.current_stage}" for ${ageDays} day(s) ` +
            `(>= ${rule.days_after_entry}). Cadence suggests advancing to "${rule.to_stage}"` +
            `${tmpl}. Balance due ${debt.balance_due.toFixed(2)}. Review and advance. ${marker}`;

          database.prepare(`
            INSERT OR IGNORE INTO notifications
              (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
            VALUES (?, ?, 'collection_cadence_due', ?, ?, 'debt', ?, 0, datetime('now'))
          `).run(notifId, companyId, title, message, debt.id);
          affected++;
        } catch (err: any) {
          warnings.push(`Queue failed (debt ${debt.id}): ${err?.message || err}`);
        }
      }
    }
  }

  return {
    ok: true,
    affected,
    detail: `Queued ${affected} collection cadence review(s) across ${companies.length} company(ies).`,
    ...(warnings.length ? { warnings } : {}),
  };
}

export const automation: AutomationModule = {
  id: 'collection-cadence-advancer',
  name: 'Collection Cadence Advancer',
  domain: 'collections',
  trigger: 'daily',
  run,
};
