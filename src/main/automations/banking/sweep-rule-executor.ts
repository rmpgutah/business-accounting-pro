// src/main/automations/banking/sweep-rule-executor.ts
//
// Sweep Rule Executor — banking automation.
//
// Evaluates per-company "sweep rules" (idle-cash sweep / minimum-balance
// top-up policies) against current bank account balances and SUGGESTS a
// transfer by queueing a notification row. It NEVER moves money, never
// posts a journal entry, and never sends email — it only writes an
// in-app suggestion that a human can act on.
//
// Where do sweep rules live? There is no dedicated `sweep_rules` table in
// schema.sql, so this module reads rule config defensively from the
// `settings` table under key `sweep_rules` (JSON array). If the key is
// absent or malformed, the company is simply skipped — no error. Each
// rule shape (all fields optional except source/threshold):
//   {
//     "source_account_id": "<bank_accounts.id>",   // account to sweep FROM
//     "target_account_id": "<bank_accounts.id>",    // account to sweep TO (optional, informational)
//     "min_balance": 5000,        // keep at least this in the source
//     "threshold": 10000          // only suggest when balance exceeds this
//   }
//
// Suggestion = the excess above min_balance, only when balance > threshold.
//
// Idempotency: suggestions are written into `notifications` with a
// deterministic type/entity and de-duplicated on (company_id, entity_id,
// todayISO) so re-running the same day inserts nothing new.

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

function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

interface SweepRule {
  source_account_id?: string;
  target_account_id?: string;
  min_balance?: number;
  threshold?: number;
}

function parseRules(raw: any): SweepRule[] {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) return parsed as SweepRule[];
    if (parsed && Array.isArray(parsed.rules)) return parsed.rules as SweepRule[];
  } catch { /* malformed — ignore */ }
  return [];
}

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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

  // Resolve company scope: explicit ctx, else current, else all companies.
  let companyIds: string[] = [];
  try {
    if (ctx?.companyId) {
      companyIds = [ctx.companyId];
    } else {
      const current = db.getCurrentCompanyId();
      if (current) {
        companyIds = [current];
      } else {
        const rows = database.prepare(`SELECT id FROM companies`).all() as any[];
        companyIds = rows.map(r => String(r.id));
      }
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to resolve companies: ${err?.message || err}` };
  }

  for (const companyId of companyIds) {
    // Load sweep rule config (best-effort).
    let rules: SweepRule[] = [];
    try {
      const row = database.prepare(
        `SELECT value FROM settings WHERE company_id = ? AND key = 'sweep_rules'`
      ).get(companyId) as { value?: string } | undefined;
      if (row?.value) rules = parseRules(row.value);
    } catch (err: any) {
      warnings.push(`Company ${companyId}: could not read sweep_rules setting (${err?.message || err})`);
      continue;
    }

    if (rules.length === 0) continue;

    for (const rule of rules) {
      const sourceId = rule?.source_account_id;
      if (!sourceId) continue;

      // Fetch current balance for the source account (company-scoped).
      let acct: { id: string; name: string; current_balance: number } | undefined;
      try {
        acct = database.prepare(
          `SELECT id, name, current_balance FROM bank_accounts WHERE id = ? AND company_id = ?`
        ).get(sourceId, companyId) as any;
      } catch (err: any) {
        warnings.push(`Company ${companyId}: bank_accounts lookup failed (${err?.message || err})`);
        continue;
      }
      if (!acct) continue;

      const balance = num(acct.current_balance);
      const minBalance = num(rule.min_balance);
      // threshold defaults to min_balance when not set.
      const threshold = rule.threshold != null ? num(rule.threshold) : minBalance;

      // Only suggest when balance exceeds the trigger threshold AND there is
      // a positive excess above the floor. 0.005 epsilon avoids float noise.
      const excess = balance - minBalance;
      if (balance <= threshold + 0.005) continue;
      if (excess <= 0.005) continue;

      const suggestedAmount = Math.round(excess * 100) / 100;

      // Deterministic entity id → idempotent per source account per day.
      const entityId = `sweep:${sourceId}:${today}`;

      try {
        const existing = database.prepare(
          `SELECT id FROM notifications WHERE company_id = ? AND type = 'sweep_suggestion' AND entity_id = ?`
        ).get(companyId, entityId) as { id: string } | undefined;
        if (existing) continue; // already suggested today

        const targetNote = rule.target_account_id
          ? ` to account ${rule.target_account_id}`
          : '';
        database.prepare(
          `INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
           VALUES (?, ?, 'sweep_suggestion', ?, ?, 'bank_account', ?, 0, datetime('now'))`
        ).run(
          randomUUID(),
          companyId,
          'Cash sweep suggestion',
          `${acct.name || 'Account'} holds ${balance.toFixed(2)} (floor ${minBalance.toFixed(2)}). ` +
            `Consider sweeping ${suggestedAmount.toFixed(2)}${targetNote}. Review before transferring — no money has moved.`,
          entityId,
        );
        affected++;

        // Audit trail (best-effort).
        try {
          db.logAudit(companyId, 'bank_accounts', sourceId, 'create', {
            automation: 'sweep-rule-executor',
            suggested_amount: suggestedAmount,
            current_balance: balance,
            min_balance: minBalance,
            threshold,
            target_account_id: rule.target_account_id || null,
            note: 'suggestion only — money not moved',
          } as any);
        } catch { /* audit best-effort */ }
      } catch (err: any) {
        warnings.push(`Company ${companyId}: failed to write suggestion (${err?.message || err})`);
      }
    }
  }

  return {
    ok: true,
    affected,
    detail: affected > 0
      ? `Queued ${affected} sweep suggestion(s).`
      : 'No sweep suggestions warranted.',
    ...(warnings.length ? { warnings } : {}),
  };
}

export const automation: AutomationModule = {
  id: 'sweep-rule-executor',
  name: 'Sweep Rule Executor',
  domain: 'banking',
  trigger: 'daily',
  run,
};
