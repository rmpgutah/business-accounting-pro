// src/main/automations/invoicing/scheduled-invoice-sender.ts
//
// Scheduled Invoice Sender (automation module)
//
// Finds invoices whose scheduled send time has arrived (scheduled_send_at <= now)
// and that are still in a pre-send state ('draft' / 'scheduled'), and FLAGS them
// as queued-to-send. This module NEVER actually emails the invoice and NEVER
// moves money — it only queues/flags so a downstream sender (workflow, manual
// review, IPC handler) can pick the work up.
//
// Defensive design:
//  • The base `invoices` schema does NOT guarantee a `scheduled_send_at`,
//    `times_sent`, or `status='scheduled'` column/value. We therefore probe
//    PRAGMA table_info at runtime and degrade gracefully:
//      - read the scheduled timestamp from a real `scheduled_send_at` column if
//        present, otherwise from the `custom_fields` JSON blob
//        (custom_fields.scheduled_send_at).
//      - record the queued flag in `custom_fields` JSON (always present) and, if
//        a real `times_sent` column exists, bump it too.
//      - we do NOT write status='scheduled'/'queued' because the CHECK
//        constraint forbids it; status is left untouched.
//  • IDEMPOTENT: a row already carrying custom_fields.send_queued === true is
//    skipped, so re-running the same day never double-queues.
//  • run() is best-effort and MUST NEVER THROW; every db touch is wrapped.

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

// Parse an arbitrary scheduled-time string (ISO date or datetime) to epoch ms.
// Returns null on anything unparseable.
function parseWhen(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  // Bare YYYY-MM-DD -> anchor at local noon (matches overdue-checker style).
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00` : s;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

function safeParseJSON(v: unknown): Record<string, any> {
  if (typeof v !== 'string' || !v.trim()) return {};
  try {
    const o = JSON.parse(v);
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

function run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
  const warnings: string[] = [];
  let affected = 0;

  let database: import('better-sqlite3').Database;
  try {
    database = db.getDb();
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
  }

  // Probe invoices columns once so we only reference real columns.
  let cols: Set<string>;
  try {
    const info = database.prepare(`PRAGMA table_info(invoices)`).all() as any[];
    cols = new Set(info.map((c) => String(c.name)));
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Cannot read invoices schema: ${err?.message || err}` };
  }
  if (!cols.has('id') || !cols.has('status') || !cols.has('custom_fields')) {
    return { ok: false, affected: 0, detail: 'invoices table missing required columns (id/status/custom_fields)' };
  }

  const hasSchedCol = cols.has('scheduled_send_at');
  const hasTimesSent = cols.has('times_sent');

  // "Now" cutoff. todayISO (date only) anchored at end-of-day local so a
  // same-day scheduled send is considered due. If no ctx, use real wall clock.
  const nowMs = ctx?.todayISO
    ? (parseWhen(`${ctx.todayISO}T23:59:59`) ?? Date.now())
    : Date.now();

  // Which statuses count as "still pending send". 'scheduled' may not be a
  // legal value, but filtering by it in SQL is harmless if absent.
  const pendingStatuses = `('draft','scheduled')`;

  let companies: { id: string }[] = [];
  try {
    if (ctx?.companyId) {
      companies = [{ id: ctx.companyId }];
    } else {
      let cid: string | null = null;
      try {
        cid = db.getCurrentCompanyId?.() ?? null;
      } catch {
        cid = null;
      }
      companies = cid
        ? [{ id: cid }]
        : (database.prepare(`SELECT id FROM companies`).all() as { id: string }[]);
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
  }

  // Build the candidate query. Pull the scheduled column only if it exists.
  const selectCols = ['id', 'invoice_number', 'status', 'custom_fields']
    .concat(hasSchedCol ? ['scheduled_send_at'] : [])
    .join(', ');

  const updateStmt = database.prepare(
    hasTimesSent
      ? `UPDATE invoices SET custom_fields = ?, times_sent = COALESCE(times_sent, 0) + 1, updated_at = datetime('now') WHERE id = ?`
      : `UPDATE invoices SET custom_fields = ?, updated_at = datetime('now') WHERE id = ?`,
  );

  for (const { id: companyId } of companies) {
    let rows: any[] = [];
    try {
      rows = database
        .prepare(
          `SELECT ${selectCols} FROM invoices
           WHERE company_id = ? AND status IN ${pendingStatuses}`,
        )
        .all(companyId) as any[];
    } catch (err: any) {
      warnings.push(`Scan failed (company ${companyId}): ${err?.message || err}`);
      continue;
    }

    for (const r of rows) {
      try {
        const cf = safeParseJSON(r.custom_fields);

        // Idempotency: already queued -> skip.
        if (cf.send_queued === true) continue;

        // Resolve the scheduled timestamp: real column first, then JSON.
        const whenRaw = hasSchedCol ? r.scheduled_send_at : cf.scheduled_send_at;
        const whenMs = parseWhen(whenRaw);
        if (whenMs === null) continue; // not actually scheduled
        if (whenMs > nowMs) continue; // not due yet

        cf.send_queued = true;
        cf.send_queued_at = new Date().toISOString();
        cf.send_queued_by = 'scheduled-invoice-sender';

        updateStmt.run(JSON.stringify(cf), r.id);
        affected++;

        try {
          db.logAudit(companyId, 'invoices', String(r.id), 'queue_scheduled_send', {
            invoice_number: r.invoice_number,
            scheduled_send_at: String(whenRaw),
            previous_status: r.status,
            automation: 'scheduled-invoice-sender',
            note: 'flagged queued-to-send; no email actually sent',
          });
        } catch {
          /* audit best-effort */
        }
      } catch (err: any) {
        warnings.push(`Queue failed (invoice ${r?.id}): ${err?.message || err}`);
      }
    }
  }

  const detail =
    `Queued ${affected} invoice(s) for sending` +
    (hasSchedCol ? '' : ' (scheduled_send_at column absent; used custom_fields)') +
    ` as of ${ctx?.todayISO ?? localTodayISO()}.`;

  return { ok: true, affected, detail, ...(warnings.length ? { warnings } : {}) };
}

export const automation: AutomationModule = {
  id: 'scheduled-invoice-sender',
  name: 'Scheduled Invoice Sender',
  domain: 'invoicing',
  trigger: 'hourly',
  run,
};
