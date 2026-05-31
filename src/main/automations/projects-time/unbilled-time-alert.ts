// src/main/automations/projects-time/unbilled-time-alert.ts
//
// Unbilled Time Alert
//
// Flags billable time_entries that have NOT yet been linked to an invoice
// and are older than a threshold (default 14 days). Stale unbilled time is
// pure leaked revenue — hours worked that never make it onto an invoice.
//
// Behavior:
//  • For each company, find billable (is_billable=1), uninvoiced
//    (is_invoiced=0 AND invoice_id IS NULL) time_entries whose `date`
//    is on/before today - N days.
//  • Queue ONE notification per company per day summarizing the count +
//    estimated dollar value. We never send email or move money — we only
//    write an in-app notification row that the UI surfaces.
//  • Idempotent: before inserting, we check no notification of this type
//    was already created today for the company.
//
// Best-effort: run() never throws. Any DB error degrades to ok:false.

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

const NOTIFICATION_TYPE = 'unbilled_time_alert';
const DEFAULT_THRESHOLD_DAYS = 14;

// Today as YYYY-MM-DD in LOCAL timezone — matches how `date` is stored.
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function dateMinusDays(isoDate: string, days: number): string {
  if (days <= 0) return isoDate;
  const dt = new Date(`${isoDate}T12:00:00`);
  dt.setDate(dt.getDate() - days);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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
  const cutoff = dateMinusDays(today, DEFAULT_THRESHOLD_DAYS);

  let companies: { id: string }[] = [];
  try {
    if (ctx?.companyId) {
      companies = [{ id: ctx.companyId }];
    } else {
      companies = (database.prepare(`SELECT id FROM companies`).all() as any[])
        .map((r) => ({ id: String(r.id) }));
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
  }

  for (const { id: companyId } of companies) {
    try {
      // Idempotency guard — already alerted this company today?
      const existing = database.prepare(
        `SELECT id FROM notifications
         WHERE company_id = ? AND type = ? AND substr(created_at, 1, 10) = ?
         LIMIT 1`
      ).get(companyId, NOTIFICATION_TYPE, today) as any;
      if (existing) continue;

      // Stale, billable, uninvoiced time entries.
      const rows = database.prepare(
        `SELECT id, duration_minutes, hourly_rate
         FROM time_entries
         WHERE company_id = ?
           AND COALESCE(is_billable, 0) = 1
           AND COALESCE(is_invoiced, 0) = 0
           AND invoice_id IS NULL
           AND date IS NOT NULL AND date != ''
           AND date <= ?`
      ).all(companyId, cutoff) as any[];

      if (!rows || rows.length === 0) continue;

      let estValue = 0;
      for (const r of rows) {
        const mins = Number(r.duration_minutes) || 0;
        const rate = Number(r.hourly_rate) || 0;
        estValue += (mins / 60) * rate;
      }
      estValue = Math.round(estValue * 100) / 100;

      const title = `${rows.length} unbilled time ${rows.length === 1 ? 'entry' : 'entries'} need invoicing`;
      const message =
        `${rows.length} billable time ${rows.length === 1 ? 'entry' : 'entries'} ` +
        `older than ${DEFAULT_THRESHOLD_DAYS} days ${rows.length === 1 ? 'is' : 'are'} not yet on an invoice` +
        (estValue > 0 ? ` (est. $${estValue.toFixed(2)}).` : '.');

      database.prepare(
        `INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
         VALUES (?, ?, ?, ?, ?, 'time_entries', NULL, 0, datetime('now'))`
      ).run(randomUUID(), companyId, NOTIFICATION_TYPE, title, message);

      affected++;

      try {
        db.logAudit(companyId, 'notifications', NOTIFICATION_TYPE, 'auto_unbilled_time_alert', {
          unbilled_count: rows.length,
          estimated_value: estValue,
          threshold_days: DEFAULT_THRESHOLD_DAYS,
          cutoff,
          automation: 'unbilled-time-alert',
        });
      } catch { /* audit best-effort */ }
    } catch (err: any) {
      warnings.push(`Company ${companyId}: ${err?.message || err}`);
    }
  }

  return {
    ok: true,
    affected,
    detail: affected > 0
      ? `Queued ${affected} unbilled-time alert(s).`
      : 'No new unbilled-time alerts needed.',
    ...(warnings.length ? { warnings } : {}),
  };
}

export const automation: AutomationModule = {
  id: 'unbilled-time-alert',
  name: 'Unbilled Time Alert',
  domain: 'projects-time',
  trigger: 'daily',
  run,
};
