// src/main/automations/compliance-admin/license-cert-expiry.ts
//
// License/Cert Expiry — compliance-admin automation
//
// Flags employee credentials and vendor certifications that are nearing
// expiry (or already expired) and QUEUES an in-app notification per item.
//
// Schema reality: this app has NO dedicated `employee_credentials` or
// vendor-certification table. Both `employees` and `vendors` carry a
// `custom_fields` JSON column (verified against database/schema.sql), which
// is where users record license/cert metadata. So we scan that JSON for any
// field whose key mentions license/cert/credential AND looks like an expiry
// date (or paired *_expiry / *_expires keys), then queue a reminder.
//
// Safety / design:
//  • run() is BEST-EFFORT and NEVER throws — every db touch is try/caught
//    and degrades to ok:false with a warning.
//  • We only QUEUE notifications (rows in `notifications`). We never send
//    email, move money, or mutate the source records.
//  • IDEMPOTENT: before inserting a notification we check that one with the
//    same (company_id, type, entity_type, entity_id, title) does not already
//    exist, so re-running the same day (or week) never double-queues.
//  • Money/owed epsilon is irrelevant here, but we keep the defensive,
//    column-guarded style of crons/overdue-checker.ts.
//
// Trigger: 'daily' — expiry windows shift day-by-day and users expect a
// fresh heads-up each morning; idempotency prevents duplicate noise.

import crypto from 'crypto';
import * as db from '../../database';

export interface AutomationResult { ok: boolean; affected: number; detail: string; warnings?: string[] }
export interface AutomationModule {
  id: string;
  name: string;
  domain: string;
  trigger: 'startup' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'manual';
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult;
}

const NOTIF_TYPE = 'license_cert_expiry';
// How many days out (inclusive) we start warning. Expired items always warn.
const WARN_WINDOW_DAYS = 30;

// Local YYYY-MM-DD — matches crons/overdue-checker.ts (avoids UTC ±1 drift).
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Whole-day difference (target - today). Negative => already expired.
function daysUntil(todayISO: string, targetISO: string): number | null {
  try {
    const a = new Date(`${todayISO}T12:00:00`).getTime();
    const b = new Date(`${targetISO}T12:00:00`).getTime();
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.round((b - a) / 86_400_000);
  } catch {
    return null;
  }
}

// Normalize a loosely-formatted date string to YYYY-MM-DD, or null.
function toISODate(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const s = String(raw).trim();
  if (!s) return null;
  // Already ISO-ish: take the leading date portion.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) return null;
  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  const dd = String(parsed.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const KEY_RX = /(licen[cs]e|certif|credential|cert\b|cpr|osha|registration|accred)/i;
const EXPIRY_KEY_RX = /(expir|expiry|exp_date|valid_until|renew|renewal|due)/i;

interface ExpiringItem {
  label: string;     // human label of the credential/cert
  expiryISO: string; // normalized expiry date
}

// Pull candidate (label, expiryISO) pairs from a custom_fields JSON blob.
// Handles two shapes:
//   1) Flat keys like { "license_expiry": "2026-07-01", "cpr_cert": "..." }
//   2) Arrays of objects like { "certifications": [{ name, expires }] }
function extractFromCustomFields(json: string | null | undefined): ExpiringItem[] {
  const out: ExpiringItem[] = [];
  if (!json) return out;
  let obj: any;
  try {
    obj = JSON.parse(json);
  } catch {
    return out;
  }
  if (!obj || typeof obj !== 'object') return out;

  const consider = (label: string, value: unknown) => {
    const iso = toISODate(value);
    if (iso) out.push({ label, expiryISO: iso });
  };

  // Shape 1: flat keys.
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' || typeof v === 'number') {
      // Either an explicitly-named license/cert key, or a license-ish key
      // that also reads as an expiry field.
      if (KEY_RX.test(k) && EXPIRY_KEY_RX.test(k)) {
        consider(k.replace(/_/g, ' '), v);
      } else if (KEY_RX.test(k) && toISODate(v)) {
        // A license/cert key whose value itself is a date.
        consider(k.replace(/_/g, ' '), v);
      }
    } else if (Array.isArray(v) && KEY_RX.test(k)) {
      // Shape 2: array of cert objects under a license/cert-named key.
      for (const item of v) {
        if (!item || typeof item !== 'object') continue;
        const nameRaw =
          (item as any).name ?? (item as any).title ?? (item as any).type ?? k;
        const dateRaw =
          (item as any).expires ??
          (item as any).expiry ??
          (item as any).expiration ??
          (item as any).expires_at ??
          (item as any).valid_until ??
          (item as any).renewal_date;
        consider(String(nameRaw).replace(/_/g, ' '), dateRaw);
      }
    }
  }
  return out;
}

export const automation: AutomationModule = {
  id: 'license-cert-expiry',
  name: 'License/Cert Expiry',
  domain: 'compliance-admin',
  trigger: 'daily',
  run(ctx?: { todayISO?: string; companyId?: string }): AutomationResult {
    const warnings: string[] = [];
    let affected = 0;

    let database: ReturnType<typeof db.getDb>;
    try {
      database = db.getDb();
    } catch (err: any) {
      return { ok: false, affected: 0, detail: `Database not ready: ${err?.message || err}` };
    }

    const today = ctx?.todayISO || localTodayISO();

    // Resolve company scope: explicit ctx → current company → all companies.
    let companyIds: string[] = [];
    try {
      if (ctx?.companyId) {
        companyIds = [ctx.companyId];
      } else {
        const current = db.getCurrentCompanyId();
        if (current) companyIds = [current];
        else {
          const rows = database.prepare(`SELECT id FROM companies`).all() as any[];
          companyIds = rows.map((r) => String(r.id));
        }
      }
    } catch (err: any) {
      return { ok: false, affected: 0, detail: `Failed to resolve companies: ${err?.message || err}` };
    }

    // Idempotency check: has this exact notification already been queued?
    let existsStmt: any = null;
    let insertStmt: any = null;
    try {
      existsStmt = database.prepare(
        `SELECT 1 FROM notifications
         WHERE company_id = ? AND type = ? AND entity_type = ? AND entity_id = ? AND title = ?
         LIMIT 1`
      );
      insertStmt = database.prepare(
        `INSERT INTO notifications (id, company_id, type, title, message, entity_type, entity_id, is_read, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))`
      );
    } catch (err: any) {
      return { ok: false, affected: 0, detail: `notifications table unavailable: ${err?.message || err}` };
    }

    const queueFor = (
      companyId: string,
      entityType: 'employee' | 'vendor',
      entityId: string,
      ownerName: string,
      items: ExpiringItem[]
    ) => {
      for (const it of items) {
        const d = daysUntil(today, it.expiryISO);
        if (d === null) continue;
        if (d > WARN_WINDOW_DAYS) continue; // not yet in the warning window
        const status = d < 0 ? 'EXPIRED' : `expires in ${d} day${d === 1 ? '' : 's'}`;
        // Title encodes entity + expiry date so distinct dates re-notify but
        // the same date/day does not double-queue.
        const title = `${ownerName}: ${it.label} ${status} (${it.expiryISO})`;
        const message =
          `${entityType === 'employee' ? 'Employee credential' : 'Vendor certification'} "${it.label}" ` +
          `for ${ownerName} ${d < 0 ? 'expired on' : 'expires on'} ${it.expiryISO}.`;
        try {
          const dup = existsStmt.get(companyId, NOTIF_TYPE, entityType, entityId, title);
          if (dup) continue;
          insertStmt.run(crypto.randomUUID(), companyId, NOTIF_TYPE, title, message, entityType, entityId);
          affected++;
          try {
            db.logAudit(companyId, 'notifications', entityId, 'license_cert_expiry_queued', {
              entity_type: entityType,
              credential: it.label,
              expiry_date: it.expiryISO,
              days_until: d,
              cron: 'license-cert-expiry',
            });
          } catch { /* audit best-effort */ }
        } catch (e: any) {
          warnings.push(`queue failed (${entityType} ${entityId}): ${e?.message || e}`);
        }
      }
    };

    for (const companyId of companyIds) {
      // ── Employees ────────────────────────────────────────
      try {
        const emps = database.prepare(
          `SELECT id, name, custom_fields FROM employees WHERE company_id = ?`
        ).all(companyId) as any[];
        for (const e of emps) {
          const items = extractFromCustomFields(e?.custom_fields);
          if (items.length) queueFor(companyId, 'employee', String(e.id), String(e.name || 'Employee'), items);
        }
      } catch (err: any) {
        warnings.push(`employee scan (company ${companyId}): ${err?.message || err}`);
      }

      // ── Vendors ──────────────────────────────────────────
      try {
        const vendors = database.prepare(
          `SELECT id, name, custom_fields FROM vendors WHERE company_id = ?`
        ).all(companyId) as any[];
        for (const v of vendors) {
          const items = extractFromCustomFields(v?.custom_fields);
          if (items.length) queueFor(companyId, 'vendor', String(v.id), String(v.name || 'Vendor'), items);
        }
      } catch (err: any) {
        warnings.push(`vendor scan (company ${companyId}): ${err?.message || err}`);
      }
    }

    const detail = `Queued ${affected} license/cert expiry reminder(s) across ${companyIds.length} company(ies).`;
    return warnings.length
      ? { ok: true, affected, detail, warnings }
      : { ok: true, affected, detail };
  },
};
