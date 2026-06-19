// src/main/automations/collections/settlement-offer-expiry.ts
//
// Settlement Offer Expiry
//
// Expires debt_settlements rows whose offer has passed its expiry date.
// A settlement offer extended to a debtor is only valid until a deadline;
// once that deadline lapses, the offer should no longer read as "open" or
// "pending" — otherwise stale offers linger and a debtor could claim a
// long-dead discount.
//
// SAFETY / DESIGN:
//  • run() is best-effort and NEVER throws — every db touch is wrapped in
//    try/catch and degrades to { ok:false, affected:0 }.
//  • The debt_settlements table is NOT guaranteed to exist in every schema
//    version, so we probe sqlite_master first and degrade with a warning
//    instead of crashing if it's absent.
//  • We discover the real column names via PRAGMA table_info and only
//    reference columns that actually exist (status / expiry-date / company).
//  • IDEMPOTENT: we only touch rows whose status is still an "open" state
//    AND whose expiry date has passed, flipping them to 'expired'. Re-running
//    the same day flips zero additional rows (the WHERE already excludes
//    already-expired rows).
//  • Money-neutral: this only changes a status string. It never moves money,
//    records a payment, or sends email.
//  • "today" uses ctx.todayISO when provided, else local YYYY-MM-DD (matching
//    src/main/crons/overdue-checker.ts).

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

function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  let database: import('better-sqlite3').Database;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  // ── Confirm the table exists ────────────────────────────────────
  try {
    const exists = database
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='debt_settlements'`)
      .get() as { name?: string } | undefined;
    if (!exists?.name) {
      return {
        ok: false,
        affected: 0,
        detail: 'debt_settlements table not present in this schema; nothing to expire.',
        warnings: ['debt_settlements table missing — automation is a no-op until the table exists.'],
      };
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Schema probe failed: ${err?.message || err}` };
  }

  // ── Discover real column names defensively ──────────────────────
  let cols: Set<string>;
  try {
    const info = database.prepare(`PRAGMA table_info(debt_settlements)`).all() as Array<{ name: string }>;
    cols = new Set(info.map((c) => c.name));
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Column probe failed: ${err?.message || err}` };
  }
  if (cols.size === 0) {
    return { ok: false, affected: 0, detail: 'debt_settlements has no columns; aborting.' };
  }

  const pick = (cands: string[]): string | undefined => cands.find((c) => cols.has(c));

  const idCol = pick(['id']);
  const statusCol = pick(['status', 'state', 'offer_status']);
  const expiryCol = pick([
    'expiry_date',
    'offer_expiry_date',
    'expires_at',
    'expiration_date',
    'expire_date',
    'valid_until',
    'offer_expires_at',
  ]);

  if (!idCol) {
    return { ok: false, affected: 0, detail: 'debt_settlements lacks an id column; aborting.' };
  }
  if (!statusCol) {
    return {
      ok: false,
      affected: 0,
      detail: 'debt_settlements lacks a status column; cannot mark offers expired.',
      warnings: ['No status/state column found on debt_settlements.'],
    };
  }
  if (!expiryCol) {
    return {
      ok: false,
      affected: 0,
      detail: 'debt_settlements lacks a recognizable expiry-date column; cannot determine lapse.',
      warnings: ['No expiry-date column found on debt_settlements (looked for expiry_date, expires_at, valid_until, ...).'],
    };
  }

  const hasCompany = cols.has('company_id');
  const hasUpdatedAt = cols.has('updated_at');

  const today = (ctx?.todayISO && /^\d{4}-\d{2}-\d{2}$/.test(ctx.todayISO)) ? ctx.todayISO : localTodayISO();

  // Determine which companies to scan.
  let companyIds: (string | null)[] = [];
  try {
    if (ctx?.companyId) {
      companyIds = [ctx.companyId];
    } else if (hasCompany) {
      const cur = db.getCurrentCompanyId();
      if (cur) {
        companyIds = [cur];
      } else {
        const rows = database.prepare(`SELECT id FROM companies`).all() as Array<{ id: string }>;
        companyIds = rows.map((r) => r.id);
      }
    } else {
      // No company scoping available — single global pass.
      companyIds = [null];
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to resolve companies: ${err?.message || err}` };
  }

  // "Open" offer states still worth expiring. We compare lowercased so we
  // catch differing casing across schema versions.
  const OPEN_STATES = new Set(['pending', 'offered', 'open', 'active', 'sent', 'proposed', 'awaiting', 'draft']);

  let affected = 0;

  for (const companyId of companyIds) {
    try {
      // Pull candidates whose expiry strictly precedes today and that are
      // not already in a terminal state.
      const where: string[] = [];
      const params: any[] = [];
      if (hasCompany && companyId) {
        where.push(`company_id = ?`);
        params.push(companyId);
      }
      where.push(`${expiryCol} IS NOT NULL`);
      where.push(`${expiryCol} != ''`);
      // Compare on the date prefix so 'YYYY-MM-DD' and 'YYYY-MM-DD HH:MM:SS' both work.
      where.push(`substr(${expiryCol}, 1, 10) < ?`);
      params.push(today);

      const sql =
        `SELECT ${idCol} AS id, ${statusCol} AS status, ${expiryCol} AS expiry` +
        (hasCompany ? `, company_id AS company_id` : ``) +
        ` FROM debt_settlements WHERE ` + where.join(' AND ');

      const candidates = database.prepare(sql).all(...params) as Array<{
        id: string;
        status: any;
        expiry: any;
        company_id?: string;
      }>;

      const toExpire = candidates.filter((r) => {
        const s = String(r.status ?? '').trim().toLowerCase();
        return OPEN_STATES.has(s);
      });

      if (toExpire.length === 0) continue;

      const setClause = hasUpdatedAt
        ? `SET ${statusCol} = 'expired', updated_at = datetime('now')`
        : `SET ${statusCol} = 'expired'`;
      const update = database.prepare(`UPDATE debt_settlements ${setClause} WHERE ${idCol} = ?`);

      const tx = database.transaction((rows: typeof toExpire) => {
        for (const r of rows) update.run(r.id);
      });
      tx(toExpire);

      affected += toExpire.length;

      // Audit trail (best-effort). Scope audit by the row's company if known,
      // else the loop's companyId, else 'unknown'.
      for (const r of toExpire) {
        const auditCompany = (r.company_id ?? companyId ?? 'unknown') as string;
        try {
          db.logAudit(auditCompany, 'debt_settlements', r.id, 'settlement_offer_expired', {
            previous_status: r.status,
            new_status: 'expired',
            expiry_date: r.expiry,
            today,
            automation: 'settlement-offer-expiry',
          });
        } catch {
          /* audit best-effort */
        }
      }
    } catch (err: any) {
      warnings.push(`Scan failed for company ${companyId ?? 'global'}: ${err?.message || err}`);
    }
  }

  return {
    ok: warnings.length === 0,
    affected,
    detail: `Expired ${affected} settlement offer(s) past their expiry date as of ${today}.`,
    ...(warnings.length ? { warnings } : {}),
  };
}

export const automation: AutomationModule = {
  id: 'settlement-offer-expiry',
  name: 'Settlement Offer Expiry',
  domain: 'collections',
  trigger: 'daily',
  run,
};
