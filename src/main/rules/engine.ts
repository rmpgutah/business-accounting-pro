// src/main/rules/engine.ts
import type { Database } from 'better-sqlite3';
import { evaluateConditions, type Condition } from './conditions';
import { executeAction, type Action, type ActionResult } from './actions';

const FIRST_MATCH_CATEGORIES = new Set(['pricing', 'tax', 'bank']);

export interface RuleContext {
  category: 'pricing' | 'tax' | 'approval' | 'alert' | 'bank' | 'automation';
  record: Record<string, unknown>;
  company_id: string;
  db: Database;
}

export interface RuleResult {
  ruleId: string;
  ruleName: string;
  matched: boolean;
  actions: ActionResult[];
}

export function evaluateRules(ctx: RuleContext): RuleResult[] {
  const { category, record, company_id, db } = ctx;
  const rows = db.prepare(`
    SELECT id, name, conditions, actions
    FROM rules
    WHERE company_id = ? AND category = ? AND is_active = 1
    ORDER BY priority ASC
  `).all(company_id, category) as Array<{ id: string; name: string; conditions: string; actions: string }>;

  const results: RuleResult[] = [];
  const firstMatch = FIRST_MATCH_CATEGORIES.has(category);

  for (const row of rows) {
    let conditions: Condition[] = [];
    let actions: Action[] = [];
    try {
      conditions = JSON.parse(row.conditions ?? '[]');
      actions = JSON.parse(row.actions ?? '[]');
    } catch { continue; }

    const matched = evaluateConditions(conditions, record);
    if (!matched) {
      results.push({ ruleId: row.id, ruleName: row.name, matched: false, actions: [] });
      continue;
    }

    const actionResults = actions.map(a =>
      executeAction(a, record, { db, company_id, rule_id: row.id, rule_name: row.name })
    );

    db.prepare(`UPDATE rules SET applied_count = applied_count + 1, last_run_at = datetime('now') WHERE id = ?`).run(row.id);
    results.push({ ruleId: row.id, ruleName: row.name, matched: true, actions: actionResults });
    if (firstMatch) break;
  }

  return results;
}

export function mergePatches(results: RuleResult[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const result of results) {
    if (!result.matched) continue;
    for (const action of result.actions) {
      if (action.patch) Object.assign(patch, action.patch);
    }
  }
  return patch;
}

export function rulesAppliedSummary(results: RuleResult[]): string {
  return JSON.stringify(
    results.filter(r => r.matched).map(r => ({ id: r.ruleId, name: r.ruleName }))
  );
}
