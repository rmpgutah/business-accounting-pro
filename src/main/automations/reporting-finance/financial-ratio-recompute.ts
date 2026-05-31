// src/main/automations/reporting-finance/financial-ratio-recompute.ts
//
// Financial Ratio Recompute
//
// Recomputes the core liquidity/solvency ratios (current, quick, debt-to-equity,
// debt-to-assets) from posted journal-entry lines and upserts a single
// as-of-today snapshot row into financial_ratios per company.
//
// Design:
//  • BEST-EFFORT — run() never throws. All db work is wrapped in try/catch and
//    degrades to ok:false on any error.
//  • IDEMPOTENT — the financial_ratios table has UNIQUE(company_id, as_of_date)
//    so re-running the same day UPSERTs the same row instead of duplicating it.
//  • Account taxonomy mirrors accounting-analytics-features.calculateRatios:
//    accounts have type ∈ (asset,liability,equity,...) plus a free-text subtype
//    ('current','inventory',...). Balances are SUM(debit - credit) over posted
//    journal entries dated on/before today; abs() to get a positive magnitude.
//  • Quick ratio = (current assets - inventory) / current liabilities.
//  • Writes nothing else (no money movement, no email, no events).

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

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function uuid(): string {
  return 'fr-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
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

  const today = ctx?.todayISO || localTodayISO();

  // Resolve company scope: explicit ctx.companyId, else all companies.
  let companies: { id: string }[] = [];
  try {
    if (ctx?.companyId) {
      companies = [{ id: ctx.companyId }];
    } else {
      companies = (database.prepare(`SELECT id FROM companies`).all() as any[]).map((r) => ({ id: r.id }));
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
  }

  if (companies.length === 0) {
    return { ok: true, affected: 0, detail: 'No companies to process.' };
  }

  let balStmt: any;
  let balSubStmt: any;
  let upsertStmt: any;
  try {
    balStmt = database.prepare(`
      SELECT COALESCE(SUM(jel.debit - jel.credit), 0) AS bal
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.journal_entry_id
      JOIN accounts a ON a.id = jel.account_id
      WHERE je.company_id = ?
        AND je.is_posted = 1
        AND je.date <= ?
        AND a.type = ?
    `);
    balSubStmt = database.prepare(`
      SELECT COALESCE(SUM(jel.debit - jel.credit), 0) AS bal
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.journal_entry_id
      JOIN accounts a ON a.id = jel.account_id
      WHERE je.company_id = ?
        AND je.is_posted = 1
        AND je.date <= ?
        AND a.type = ?
        AND a.subtype = ?
    `);
    upsertStmt = database.prepare(`
      INSERT INTO financial_ratios
        (id, company_id, as_of_date, current_ratio, quick_ratio, debt_to_equity, debt_to_assets, working_capital, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(company_id, as_of_date) DO UPDATE SET
        current_ratio  = excluded.current_ratio,
        quick_ratio    = excluded.quick_ratio,
        debt_to_equity = excluded.debt_to_equity,
        debt_to_assets = excluded.debt_to_assets,
        working_capital = excluded.working_capital
    `);
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to prepare statements (schema mismatch?): ${err?.message || err}` };
  }

  const balOf = (companyId: string, type: string, subtype?: string): number => {
    try {
      const r = subtype
        ? (balSubStmt.get(companyId, today, type, subtype) as any)
        : (balStmt.get(companyId, today, type) as any);
      return Math.abs(Number(r?.bal) || 0);
    } catch {
      return 0;
    }
  };

  for (const { id: companyId } of companies) {
    try {
      const currentAssets = balOf(companyId, 'asset', 'current');
      const currentLiabilities = balOf(companyId, 'liability', 'current');
      const inventory = balOf(companyId, 'asset', 'inventory');
      const totalLiabilities = balOf(companyId, 'liability');
      const totalAssets = balOf(companyId, 'asset');
      const equity = balOf(companyId, 'equity');

      const currentRatio = currentLiabilities ? round2(currentAssets / currentLiabilities) : 0;
      const quickRatio = currentLiabilities ? round2((currentAssets - inventory) / currentLiabilities) : 0;
      const debtToEquity = equity ? round2(totalLiabilities / equity) : 0;
      const debtToAssets = totalAssets ? round2(totalLiabilities / totalAssets) : 0;
      const workingCapital = round2(currentAssets - currentLiabilities);

      upsertStmt.run(uuid(), companyId, today, currentRatio, quickRatio, debtToEquity, debtToAssets, workingCapital);
      affected++;
    } catch (err: any) {
      warnings.push(`Company ${companyId}: ${err?.message || err}`);
    }
  }

  const ok = affected > 0 || warnings.length === 0;
  return {
    ok,
    affected,
    detail: `Recomputed financial ratios for ${affected}/${companies.length} compan${companies.length === 1 ? 'y' : 'ies'} as of ${today}.`,
    ...(warnings.length ? { warnings } : {}),
  };
}

export const automation: AutomationModule = {
  id: 'financial-ratio-recompute',
  name: 'Financial Ratio Recompute',
  domain: 'reporting-finance',
  trigger: 'daily',
  run,
};
