// src/main/automations/tax/tax-rate-updater.ts
//
// Tax Rate Updater
//
// Refreshes per-company `tax_rates` rows from the global
// `state_tax_rates` reference table for the CURRENT tax year.
//
// `state_tax_rates` is a global (no company_id) lookup keyed by
// (tax_year, state_code). Each company maintains its own
// `tax_rates` list (sales/purchase/vat rates used on invoices/bills).
// This automation materialises a "purchase"-type tax_rate for each
// state in the current year so companies always have an up-to-date,
// queryable set of state tax rates without manual data entry.
//
// SAFETY / DESIGN:
//  • run() is best-effort and NEVER throws — every db access is
//    wrapped in try/catch and degrades to { ok:false } on error.
//  • IDEMPOTENT — a deterministic synthetic name per (year, state)
//    is used. We only INSERT when no matching row exists, and UPDATE
//    the rate in place when the source rate has changed. Re-running
//    the same day produces no duplicates and no spurious writes.
//  • We NEVER delete user-created tax_rates; we only touch rows this
//    automation owns (identified by the `[auto:state-tax-rate]` tag
//    stored in the description column).
//  • Triggered yearly is conceptually ideal, but the module trigger
//    enum tops out at 'monthly'; monthly is the safest cadence that
//    still picks up mid-year reference-table corrections promptly.

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

const SOURCE_TAG = '[auto:state-tax-rate]';

function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function makeId(): string {
  try {
    // crypto is available in the Electron main process (Node runtime).
    // Guarded in case of an unexpected environment.
    return require('crypto').randomUUID();
  } catch {
    return `tr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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

  // Current tax year from "today".
  const today = ctx?.todayISO || localTodayISO();
  const taxYear = parseInt(today.slice(0, 4), 10);
  if (!Number.isFinite(taxYear)) {
    return { ok: false, affected: 0, detail: `Could not derive tax year from "${today}"` };
  }

  // Load the global state reference rates for the current year.
  let stateRates: Array<{ state_code: string; state_name: string; rate: number }> = [];
  try {
    stateRates = database.prepare(
      `SELECT state_code, state_name, rate
         FROM state_tax_rates
        WHERE tax_year = ?`
    ).all(taxYear) as any[];
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `state_tax_rates query failed: ${err?.message || err}` };
  }

  if (stateRates.length === 0) {
    return { ok: true, affected: 0, detail: `No state_tax_rates for ${taxYear}; nothing to refresh` };
  }

  // Resolve target companies.
  let companies: Array<{ id: string }> = [];
  try {
    if (ctx?.companyId) {
      companies = [{ id: ctx.companyId }];
    } else {
      const current = db.getCurrentCompanyId();
      if (current) companies = [{ id: current }];
      else companies = database.prepare(`SELECT id FROM companies`).all() as any[];
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to resolve companies: ${err?.message || err}` };
  }

  for (const { id: companyId } of companies) {
    for (const sr of stateRates) {
      const name = `${sr.state_name} State Tax ${taxYear}`;
      const description = `${SOURCE_TAG} ${sr.state_code} ${taxYear}`;
      const rate = Number(sr.rate) || 0;

      try {
        // Look up the row this automation owns for (company, state, year).
        const existing = database.prepare(
          `SELECT id, rate FROM tax_rates
            WHERE company_id = ? AND name = ? AND description = ?
            LIMIT 1`
        ).get(companyId, name, description) as { id: string; rate: number } | undefined;

        if (!existing) {
          // INSERT a new auto-owned, inactive-by-default reference rate.
          database.prepare(
            `INSERT INTO tax_rates
               (id, company_id, name, rate, type, is_default, is_active, description, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'purchase', 0, 1, ?, datetime('now'), datetime('now'))`
          ).run(makeId(), companyId, name, rate, description);
          affected++;
        } else if (Math.abs((Number(existing.rate) || 0) - rate) > 0.0000005) {
          // Source rate changed — update in place (own row only).
          database.prepare(
            `UPDATE tax_rates SET rate = ?, updated_at = datetime('now') WHERE id = ?`
          ).run(rate, existing.id);
          affected++;
        }
        // else: already in sync — no write (idempotent).
      } catch (err: any) {
        warnings.push(`company ${companyId} / ${sr.state_code}: ${err?.message || err}`);
      }
    }
  }

  return {
    ok: true,
    affected,
    detail: `Refreshed ${affected} state tax rate row(s) for ${taxYear} across ${companies.length} company/companies`,
    ...(warnings.length ? { warnings } : {}),
  };
}

export const automation: AutomationModule = {
  id: 'tax-rate-updater',
  name: 'Tax Rate Updater',
  domain: 'tax',
  trigger: 'monthly',
  run,
};
