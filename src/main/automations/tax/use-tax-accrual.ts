// src/main/automations/tax/use-tax-accrual.ts
//
// Use Tax Accrual automation (id: use-tax-accrual)
//
// When a business buys taxable goods/services from an out-of-state (or
// otherwise untaxed) vendor, the seller often does NOT collect sales
// tax. The buyer is then liable for the equivalent "use tax" and must
// self-assess and remit it. This automation scans expenses that have
// been FLAGGED for use tax but on which no sales tax was charged
// (tax_amount ~= 0), computes the use-tax owed at the company's default
// purchase tax rate, and accrues it into the use_tax_accruals table.
//
// Design / safety:
//  • BEST-EFFORT: run() never throws — every db touch is wrapped in
//    try/catch and degrades to ok:false with a warning.
//  • IDEMPOTENT: one accrual row per source expense (UNIQUE on
//    company_id+expense_id). Re-running the same day inserts nothing
//    new (INSERT OR IGNORE + pre-check).
//  • NEVER moves money or files anything — it only writes accrual rows
//    that an accountant later reviews/remits.
//  • The use_tax_accruals table is created defensively (CREATE TABLE IF
//    NOT EXISTS) since it is not part of the base schema.
//
// A "flagged" expense is detected from either:
//   - tags JSON array containing "use_tax" / "use-tax", OR
//   - custom_fields JSON object with truthy use_tax / use_tax_owed.
// Only expenses with effectively-zero tax_amount (<= 0.005) are
// accrued — if sales tax was already charged, no use tax is owed.

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

function isFlagged(tagsRaw: unknown, customRaw: unknown): boolean {
  try {
    if (typeof tagsRaw === 'string' && tagsRaw.trim() !== '') {
      const arr = JSON.parse(tagsRaw);
      if (Array.isArray(arr)) {
        for (const t of arr) {
          const s = String(t).toLowerCase().replace(/[\s-]/g, '_');
          if (s === 'use_tax' || s === 'usetax') return true;
        }
      }
    }
  } catch { /* ignore malformed tags */ }
  try {
    if (typeof customRaw === 'string' && customRaw.trim() !== '') {
      const obj = JSON.parse(customRaw);
      if (obj && typeof obj === 'object') {
        const v = (obj as any).use_tax ?? (obj as any).use_tax_owed ?? (obj as any).useTax;
        if (v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true' || String(v).toLowerCase() === 'yes') {
          return true;
        }
      }
    }
  } catch { /* ignore malformed custom_fields */ }
  return false;
}

function getPurchaseRate(database: any, companyId: string): number {
  // Prefer an active default 'purchase' rate; fall back to any active
  // default rate. Returns a percentage value (e.g. 7.25). 0 if none.
  try {
    const row = database.prepare(`
      SELECT rate FROM tax_rates
      WHERE company_id = ? AND is_active = 1 AND type = 'purchase'
      ORDER BY is_default DESC, updated_at DESC LIMIT 1
    `).get(companyId) as any;
    if (row && Number.isFinite(Number(row.rate))) return Number(row.rate);
  } catch { /* table/column may not exist */ }
  try {
    const row = database.prepare(`
      SELECT rate FROM tax_rates
      WHERE company_id = ? AND is_active = 1
      ORDER BY is_default DESC, updated_at DESC LIMIT 1
    `).get(companyId) as any;
    if (row && Number.isFinite(Number(row.rate))) return Number(row.rate);
  } catch { /* ignore */ }
  return 0;
}

function ensureTable(database: any): boolean {
  try {
    database.prepare(`
      CREATE TABLE IF NOT EXISTS use_tax_accruals (
        id TEXT PRIMARY KEY,
        company_id TEXT NOT NULL,
        expense_id TEXT NOT NULL,
        accrual_date TEXT NOT NULL,
        taxable_amount REAL DEFAULT 0,
        tax_rate REAL DEFAULT 0,
        use_tax_amount REAL DEFAULT 0,
        status TEXT DEFAULT 'accrued',
        notes TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(company_id, expense_id)
      )
    `).run();
    return true;
  } catch {
    return false;
  }
}

export function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  let affected = 0;

  let database: any;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  if (!ensureTable(database)) {
    return { ok: false, affected: 0, detail: 'Could not ensure use_tax_accruals table exists' };
  }

  const today = ctx?.todayISO || localTodayISO();

  // Scope to one company if provided, else iterate all.
  let companyIds: string[] = [];
  try {
    if (ctx?.companyId) {
      companyIds = [ctx.companyId];
    } else {
      const rows = database.prepare(`SELECT id FROM companies`).all() as any[];
      companyIds = rows.map((r) => String(r.id));
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
  }

  let insertStmt: any;
  let existsStmt: any;
  try {
    insertStmt = database.prepare(`
      INSERT OR IGNORE INTO use_tax_accruals
        (id, company_id, expense_id, accrual_date, taxable_amount, tax_rate, use_tax_amount, status, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'accrued', ?, datetime('now'), datetime('now'))
    `);
    existsStmt = database.prepare(
      `SELECT 1 FROM use_tax_accruals WHERE company_id = ? AND expense_id = ? LIMIT 1`
    );
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to prepare accrual statements: ${err?.message || err}` };
  }

  for (const companyId of companyIds) {
    const rate = getPurchaseRate(database, companyId);
    if (rate <= 0) {
      warnings.push(`Company ${companyId}: no active purchase tax rate; skipped`);
      continue;
    }

    let expenses: any[] = [];
    try {
      expenses = database.prepare(`
        SELECT id, amount, tax_amount, tags, custom_fields, date
        FROM expenses
        WHERE company_id = ?
      `).all(companyId) as any[];
    } catch (err: any) {
      warnings.push(`Company ${companyId}: expense scan failed: ${err?.message || err}`);
      continue;
    }

    for (const exp of expenses) {
      try {
        const taxCharged = Number(exp.tax_amount || 0);
        // If sales tax was already charged, no use tax is owed.
        if (taxCharged > EPSILON) continue;
        if (!isFlagged(exp.tags, exp.custom_fields)) continue;

        // Idempotency guard (also enforced by UNIQUE constraint).
        const already = existsStmt.get(companyId, String(exp.id));
        if (already) continue;

        const taxable = Number(exp.amount || 0);
        if (!(taxable > EPSILON)) continue;

        const useTax = Math.round((taxable * (rate / 100)) * 100) / 100;
        if (!(useTax > EPSILON)) continue;

        const id = `utax_${companyId}_${exp.id}`.slice(0, 120);
        const info = insertStmt.run(
          id,
          companyId,
          String(exp.id),
          today,
          taxable,
          rate,
          useTax,
          `Auto-accrued use tax on flagged expense ${exp.id} (rate ${rate}%)`
        );
        if (info && info.changes > 0) {
          affected++;
          try {
            db.logAudit(companyId, 'use_tax_accruals', id, 'auto_accrue', {
              expense_id: exp.id,
              taxable_amount: taxable,
              tax_rate: rate,
              use_tax_amount: useTax,
              automation: 'use-tax-accrual',
            });
          } catch { /* audit best-effort */ }
        }
      } catch (err: any) {
        warnings.push(`Company ${companyId} expense ${exp?.id}: ${err?.message || err}`);
      }
    }
  }

  const detail = `Accrued use tax on ${affected} flagged expense(s) across ${companyIds.length} company(ies)`;
  return warnings.length
    ? { ok: true, affected, detail, warnings }
    : { ok: true, affected, detail };
}

export const automation: AutomationModule = {
  id: 'use-tax-accrual',
  name: 'Use Tax Accrual',
  domain: 'tax',
  trigger: 'daily',
  run,
};
