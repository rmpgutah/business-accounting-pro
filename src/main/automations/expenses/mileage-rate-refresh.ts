// src/main/automations/expenses/mileage-rate-refresh.ts
//
// Mileage Rate Refresh
//
// Keeps the legacy `mileage_rates` table (keyed by `year`, consumed by
// expense mileage auto-fill in ipc/index.ts) in sync with the richer
// `mileage_irs_rates` table (keyed by `tax_year`) for the CURRENT tax year.
//
// Both tables are GLOBAL (no company_id) — IRS standard mileage rates are
// federal, not per-company — so this runs once, not per-company.
//
// Behavior: read the IRS rate row for the current tax year from
// mileage_irs_rates; upsert it into mileage_rates so downstream mileage
// calculations use the up-to-date business/medical/charitable rates.
//
// Idempotent: if mileage_rates already holds the exact same values for the
// year, it writes nothing and reports affected:0. Re-running the same day
// (or any day) never double-acts. Never moves money or sends email.
//
// Best-effort: all db work is wrapped in try/catch; any failure returns
// { ok:false, affected:0, ... } rather than throwing.

import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

// Today as YYYY-MM-DD in LOCAL timezone — matches overdue-checker.ts.
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  try {
    const today = ctx?.todayISO || localTodayISO();
    const year = parseInt(today.slice(0, 4), 10);
    if (!Number.isFinite(year)) {
      return { ok: false, affected: 0, detail: `Could not derive tax year from "${today}"` };
    }

    let database: any;
    try {
      database = db.getDb();
    } catch (err: any) {
      return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
    }

    // Source: IRS rates table for the current tax year.
    let src: any;
    try {
      src = (database.prepare(
        `SELECT tax_year, business_rate, medical_rate, charitable_rate
         FROM mileage_irs_rates WHERE tax_year = ?`
      ).get(year)) as any;
    } catch (err: any) {
      return { ok: false, affected: 0, detail: `Failed to read mileage_irs_rates: ${err?.message || err}` };
    }

    if (!src) {
      return {
        ok: true,
        affected: 0,
        detail: `No IRS mileage rate on file for ${year}; nothing to refresh.`,
        warnings: [`mileage_irs_rates has no row for tax_year=${year}`],
      };
    }

    const business = Number(src.business_rate) || 0;
    const medical = Number(src.medical_rate) || 0;
    const charitable = Number(src.charitable_rate) || 0;

    if (business <= 0) {
      warnings.push(`IRS business_rate for ${year} is ${business} (<= 0); skipping refresh to avoid wiping a valid rate.`);
      return { ok: true, affected: 0, detail: `IRS business rate for ${year} not usable; left mileage_rates untouched.`, warnings };
    }

    // Target: legacy mileage_rates row for this year.
    let existing: any;
    try {
      existing = (database.prepare(
        `SELECT year, business_rate, medical_rate, charitable_rate FROM mileage_rates WHERE year = ?`
      ).get(year)) as any;
    } catch (err: any) {
      return { ok: false, affected: 0, detail: `Failed to read mileage_rates: ${err?.message || err}` };
    }

    // Idempotency: if values already match (within epsilon), do nothing.
    const eps = 0.0001;
    if (existing
      && Math.abs((Number(existing.business_rate) || 0) - business) <= eps
      && Math.abs((Number(existing.medical_rate) || 0) - medical) <= eps
      && Math.abs((Number(existing.charitable_rate) || 0) - charitable) <= eps) {
      return { ok: true, affected: 0, detail: `mileage_rates already current for ${year} (business=${business}).` };
    }

    try {
      database.prepare(
        `INSERT INTO mileage_rates (year, business_rate, medical_rate, charitable_rate)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(year) DO UPDATE SET
           business_rate = excluded.business_rate,
           medical_rate = excluded.medical_rate,
           charitable_rate = excluded.charitable_rate`
      ).run(year, business, medical, charitable);
    } catch (err: any) {
      return { ok: false, affected: 0, detail: `Failed to upsert mileage_rates: ${err?.message || err}` };
    }

    const action = existing ? 'Updated' : 'Inserted';
    return {
      ok: true,
      affected: 1,
      detail: `${action} mileage_rates for ${year} from IRS rates (business=${business}, medical=${medical}, charitable=${charitable}).`,
      warnings: warnings.length ? warnings : undefined,
    };
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Unexpected error: ${err?.message || err}` };
  }
}

export const automation: AutomationModule = {
  id: 'mileage-rate-refresh',
  name: 'Mileage Rate Refresh',
  domain: 'expenses',
  trigger: 'monthly',
  run,
};
