// src/main/automations/banking/bank-rule-categorizer.ts
//
// Bank Rule Categorizer
// ---------------------
// Applies active `bank_rules` to uncategorized `bank_transactions` and
// QUEUES a categorization suggestion (notifications row) for each match.
//
// Design notes:
//  • bank_transactions has NO category_id / vendor_id / account_id column
//    (verified against schema.sql), so this automation does NOT mutate the
//    transaction or move money. It only emits a non-destructive suggestion
//    into the `notifications` table for the user to confirm in the UI.
//  • bank_transactions also has NO company_id; it scopes via
//    bank_account_id -> bank_accounts.company_id.
//  • "Uncategorized" = is_matched = 0 AND status = 'pending'.
//  • IDEMPOTENT: before queueing, we check a notification of the same type
//    for the same transaction does not already exist, and we never queue
//    twice for the same (rule, transaction) pair in one run.
//  • run() is BEST-EFFORT and never throws.
//
// Trigger: 'hourly' — bank imports trickle in throughout the day, so a
// frequent low-cost scan keeps suggestions fresh without manual action.

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

const NOTIFICATION_TYPE = 'bank_rule_suggestion';

interface BankRuleRow {
  id: string;
  name: string;
  match_type: string;
  match_field: string;
  match_value: string;
  amount_min: number | null;
  amount_max: number | null;
  transaction_type: string;
  action_account_id: string | null;
  action_category_id: string | null;
  action_vendor_id: string | null;
  action_description: string;
}

interface TxnRow {
  id: string;
  description: string;
  amount: number;
  type: string | null;
  reference: string;
}

function fieldValue(rule: BankRuleRow, txn: TxnRow): string {
  switch (rule.match_field) {
    case 'reference':
      return String(txn.reference ?? '');
    case 'amount':
      return String(txn.amount ?? '');
    case 'description':
    default:
      return String(txn.description ?? '');
  }
}

function textMatches(matchType: string, haystackRaw: string, needleRaw: string): boolean {
  const haystack = haystackRaw.toLowerCase();
  const needle = String(needleRaw ?? '').toLowerCase();
  if (needle === '') return false;
  switch (matchType) {
    case 'exact':
      return haystack === needle;
    case 'starts_with':
      return haystack.startsWith(needle);
    case 'ends_with':
      return haystack.endsWith(needle);
    case 'regex':
      try {
        return new RegExp(needleRaw, 'i').test(haystackRaw);
      } catch {
        return false; // invalid regex => no match, never throw
      }
    case 'contains':
    default:
      return haystack.includes(needle);
  }
}

function ruleMatches(rule: BankRuleRow, txn: TxnRow): boolean {
  // transaction_type gate ('any' / '' = no constraint)
  const tt = rule.transaction_type;
  if (tt === 'debit' || tt === 'credit') {
    if ((txn.type ?? '') !== tt) return false;
  }

  // amount bounds (use absolute amount; debits may be stored negative)
  const absAmt = Math.abs(Number(txn.amount ?? 0));
  if (rule.amount_min != null && absAmt < Number(rule.amount_min)) return false;
  if (rule.amount_max != null && absAmt > Number(rule.amount_max)) return false;

  return textMatches(rule.match_type, fieldValue(rule, txn), rule.match_value);
}

export const automation: AutomationModule = {
  id: 'bank-rule-categorizer',
  name: 'Bank Rule Categorizer',
  domain: 'banking',
  trigger: 'hourly',
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
    const warnings: string[] = [];
    let affected = 0;

    let database: ReturnType<typeof db.getDb>;
    try {
      database = db.getDb();
    } catch (err: any) {
      return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
    }

    // Resolve target companies.
    let companies: { id: string }[] = [];
    try {
      if (ctx?.companyId) {
        companies = [{ id: ctx.companyId }];
      } else {
        let current: string | null = null;
        try {
          current = db.getCurrentCompanyId();
        } catch {
          current = null;
        }
        if (current) {
          companies = [{ id: current }];
        } else {
          companies = (database.prepare(`SELECT id FROM companies`).all() as any[]).map(
            (r) => ({ id: String(r.id) })
          );
        }
      }
    } catch (err: any) {
      return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
    }

    try {
      const selectRules = database.prepare(`
        SELECT id, name, match_type, match_field, match_value,
               amount_min, amount_max, transaction_type,
               action_account_id, action_category_id, action_vendor_id, action_description
        FROM bank_rules
        WHERE company_id = ? AND is_active = 1
        ORDER BY priority DESC, created_at ASC
      `);

      const selectTxns = database.prepare(`
        SELECT t.id, t.description, t.amount, t.type, t.reference
        FROM bank_transactions t
        JOIN bank_accounts a ON a.id = t.bank_account_id
        WHERE a.company_id = ?
          AND COALESCE(t.is_matched, 0) = 0
          AND COALESCE(t.status, 'pending') = 'pending'
      `);

      const existsNotif = database.prepare(`
        SELECT 1 FROM notifications
        WHERE company_id = ? AND type = ? AND entity_type = 'bank_transaction' AND entity_id = ?
        LIMIT 1
      `);

      const bumpRule = database.prepare(`
        UPDATE bank_rules
        SET times_applied = COALESCE(times_applied, 0) + 1,
            updated_at = datetime('now')
        WHERE id = ?
      `);

      for (const { id: companyId } of companies) {
        let rules: BankRuleRow[] = [];
        try {
          rules = selectRules.all(companyId) as any[] as BankRuleRow[];
        } catch (err: any) {
          warnings.push(`Rule load failed (company ${companyId}): ${err?.message || err}`);
          continue;
        }
        if (rules.length === 0) continue;

        let txns: TxnRow[] = [];
        try {
          txns = selectTxns.all(companyId) as any[] as TxnRow[];
        } catch (err: any) {
          warnings.push(`Txn load failed (company ${companyId}): ${err?.message || err}`);
          continue;
        }
        if (txns.length === 0) continue;

        for (const txn of txns) {
          // First matching rule (already priority-ordered) wins.
          let matched: BankRuleRow | null = null;
          for (const rule of rules) {
            try {
              if (ruleMatches(rule, txn)) {
                matched = rule;
                break;
              }
            } catch {
              // defensive: a single bad rule must not abort the scan
            }
          }
          if (!matched) continue;

          // Idempotency: skip if a suggestion already exists for this txn.
          try {
            const already = existsNotif.get(companyId, NOTIFICATION_TYPE, txn.id);
            if (already) continue;
          } catch {
            // if the check fails, skip to avoid duplicate queueing
            continue;
          }

          const parts: string[] = [];
          if (matched.action_category_id) parts.push('category');
          if (matched.action_account_id) parts.push('account');
          if (matched.action_vendor_id) parts.push('vendor');
          const desc = matched.action_description
            ? matched.action_description
            : `Rule "${matched.name}" matches "${String(txn.description ?? '').slice(0, 80)}"`;

          const payload = {
            rule_id: matched.id,
            rule_name: matched.name,
            transaction_id: txn.id,
            suggested_account_id: matched.action_account_id || null,
            suggested_category_id: matched.action_category_id || null,
            suggested_vendor_id: matched.action_vendor_id || null,
            suggested_fields: parts,
            source: 'bank-rule-categorizer',
          };

          try {
            db.create('notifications', {
              company_id: companyId,
              type: NOTIFICATION_TYPE,
              title: `Suggested categorization: ${matched.name}`,
              message: `${desc} — ${JSON.stringify(payload)}`,
              entity_type: 'bank_transaction',
              entity_id: txn.id,
              is_read: 0,
            });
            affected++;
            try {
              bumpRule.run(matched.id);
            } catch {
              /* counter is best-effort */
            }
          } catch (err: any) {
            warnings.push(`Queue failed (txn ${txn.id}): ${err?.message || err}`);
          }
        }
      }
    } catch (err: any) {
      return {
        ok: false,
        affected,
        detail: `Categorizer error: ${err?.message || err}`,
        warnings: warnings.length ? warnings : undefined,
      };
    }

    return {
      ok: true,
      affected,
      detail:
        affected === 0
          ? 'No new bank-rule matches to suggest.'
          : `Queued ${affected} bank-rule categorization suggestion(s).`,
      warnings: warnings.length ? warnings : undefined,
    };
  },
};
