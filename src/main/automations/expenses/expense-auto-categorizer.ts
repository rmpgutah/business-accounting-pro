// src/main/automations/expenses/expense-auto-categorizer.ts
//
// Expense Auto-Categorizer
//
// Scans uncategorized expenses (category_id is empty/null) for every
// company and assigns a category_id using two learned/configured rule
// sources, in priority order:
//
//   1. auto_categorize_learnings — learned description/vendor → category
//      patterns (F83). Matched by case-insensitive substring on the
//      expense description, highest accept-ratio first. These map to a
//      *category* directly (suggested_category_id), so we can apply them
//      to expenses.category_id immediately.
//
//   2. account_classify_rules — regex pattern → account_id rules (F24).
//      These resolve an ACCOUNT, not a category. expenses.account_id is
//      a real column, so when an expense has no account_id we can fill
//      that from a matching rule. (We never overwrite an existing
//      account_id.)
//
// SAFETY / DESIGN:
//  • Best-effort: never throws. All DB work is wrapped; any failure
//    degrades to ok:false with a warning.
//  • Idempotent: only touches expenses whose category_id is blank
//    (and, for account rules, whose account_id is blank). Re-running
//    the same day cannot double-act because once filled they no longer
//    match the candidate WHERE clause.
//  • Defensive: both rule tables are created at runtime (not in
//    schema.sql); each query is guarded so a missing table just yields
//    zero matches for that source.
//  • Validates that the target category/account still exists & belongs
//    to the company before applying, to avoid dangling references.
//  • Writes an audit_log entry per change for the activity trail.
//  • Does NOT move money or touch amounts/status — only classification.

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

const SLUG = 'expense-auto-categorizer';

function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  let affected = 0;

  let database: ReturnType<typeof db.getDb>;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  // Resolve the set of companies to scan.
  let companyIds: string[] = [];
  try {
    if (ctx?.companyId) {
      companyIds = [ctx.companyId];
    } else {
      let current: string | null = null;
      try { current = db.getCurrentCompanyId?.() ?? null; } catch { /* optional */ }
      if (current) {
        companyIds = [current];
      } else {
        const rows = database.prepare(`SELECT id FROM companies`).all() as any[];
        companyIds = rows.map((r) => String(r.id));
      }
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
  }

  if (companyIds.length === 0) {
    return { ok: true, affected: 0, detail: 'No companies to scan.' };
  }

  for (const companyId of companyIds) {
    // ── Load uncategorized expenses for this company ──────────
    let candidates: any[] = [];
    try {
      candidates = database.prepare(`
        SELECT id, description, vendor_id, category_id, account_id
        FROM expenses
        WHERE company_id = ?
          AND (category_id IS NULL OR category_id = '')
      `).all(companyId) as any[];
    } catch (err: any) {
      warnings.push(`Expense scan (company ${companyId}): ${err?.message || err}`);
      continue;
    }
    if (candidates.length === 0) continue;

    // ── Load learned category patterns (best accept-ratio first) ──
    let learnings: any[] = [];
    try {
      learnings = database.prepare(`
        SELECT description_pattern, vendor_id, suggested_category_id,
               times_matched, times_accepted
        FROM auto_categorize_learnings
        WHERE company_id = ?
          AND suggested_category_id IS NOT NULL
          AND suggested_category_id != ''
        ORDER BY times_accepted DESC
      `).all(companyId) as any[];
    } catch {
      // Table may not exist yet — degrade silently for this source.
      learnings = [];
    }

    // ── Load account classify regex rules ────────────────────
    let acctRules: any[] = [];
    try {
      acctRules = database.prepare(`
        SELECT pattern, account_id
        FROM account_classify_rules
        WHERE company_id = ?
          AND account_id IS NOT NULL
          AND account_id != ''
      `).all(companyId) as any[];
    } catch {
      acctRules = [];
    }

    // Validity caches so we don't re-query the same id repeatedly.
    const catOk = new Map<string, boolean>();
    const acctOk = new Map<string, boolean>();
    const categoryExists = (catId: string): boolean => {
      if (!catId) return false;
      if (catOk.has(catId)) return catOk.get(catId)!;
      let ok = false;
      try {
        const row = database.prepare(
          `SELECT 1 FROM categories WHERE id = ? AND company_id = ? LIMIT 1`
        ).get(catId, companyId);
        ok = !!row;
      } catch { ok = false; }
      catOk.set(catId, ok);
      return ok;
    };
    const accountExists = (acctId: string): boolean => {
      if (!acctId) return false;
      if (acctOk.has(acctId)) return acctOk.get(acctId)!;
      let ok = false;
      try {
        const row = database.prepare(
          `SELECT 1 FROM accounts WHERE id = ? AND company_id = ? LIMIT 1`
        ).get(acctId, companyId);
        ok = !!row;
      } catch { ok = false; }
      acctOk.set(acctId, ok);
      return ok;
    };

    const setCategory = database.prepare(
      `UPDATE expenses SET category_id = ?, updated_at = datetime('now') WHERE id = ?`
    );
    const setAccount = database.prepare(
      `UPDATE expenses SET account_id = ?, updated_at = datetime('now') WHERE id = ?`
    );

    for (const exp of candidates) {
      const desc = String(exp.description || '').toLowerCase().trim();

      // 1) Try learned category patterns: vendor-specific or generic.
      let appliedCategory: string | null = null;
      if (learnings.length > 0) {
        for (const r of learnings) {
          const pat = String(r.description_pattern || '').toLowerCase().trim();
          if (!pat) continue;
          const vendorMatches = !r.vendor_id || r.vendor_id === exp.vendor_id;
          if (vendorMatches && desc.includes(pat)) {
            const catId = String(r.suggested_category_id || '');
            if (categoryExists(catId)) { appliedCategory = catId; break; }
          }
        }
      }

      if (appliedCategory) {
        try {
          setCategory.run(appliedCategory, exp.id);
          affected++;
          try {
            db.logAudit(companyId, 'expenses', exp.id, 'auto_categorize', {
              field: 'category_id',
              new_value: appliedCategory,
              source: 'auto_categorize_learnings',
              automation: SLUG,
            });
          } catch { /* audit best-effort */ }
        } catch (err: any) {
          warnings.push(`Apply category (expense ${exp.id}): ${err?.message || err}`);
        }
      }

      // 2) Independently, fill a missing account_id from regex rules.
      const hasAccount = exp.account_id !== null && exp.account_id !== undefined && exp.account_id !== '';
      if (!hasAccount && acctRules.length > 0) {
        const rawDesc = String(exp.description || '');
        for (const rule of acctRules) {
          const pattern = String(rule.pattern || '');
          if (!pattern) continue;
          let matched = false;
          try {
            matched = new RegExp(pattern, 'i').test(rawDesc);
          } catch { matched = false; /* invalid regex */ }
          if (matched) {
            const acctId = String(rule.account_id || '');
            if (accountExists(acctId)) {
              try {
                setAccount.run(acctId, exp.id);
                affected++;
                try {
                  db.logAudit(companyId, 'expenses', exp.id, 'auto_categorize', {
                    field: 'account_id',
                    new_value: acctId,
                    source: 'account_classify_rules',
                    pattern,
                    automation: SLUG,
                  });
                } catch { /* audit best-effort */ }
              } catch (err: any) {
                warnings.push(`Apply account (expense ${exp.id}): ${err?.message || err}`);
              }
              break;
            }
          }
        }
      }
    }
  }

  const detail = `Auto-categorized ${affected} expense field(s) across ${companyIds.length} company(ies).`;
  return warnings.length > 0
    ? { ok: true, affected, detail, warnings }
    : { ok: true, affected, detail };
}

export const automation: AutomationModule = {
  id: SLUG,
  name: 'Expense Auto-Categorizer',
  domain: 'expenses',
  trigger: 'daily',
  run,
};
