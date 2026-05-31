// src/main/automations/invoicing/recurring-invoice-generator.ts
//
// Recurring Invoice Generator
//
// Scans recurring_templates (type='invoice', is_active=1) whose next_date
// has arrived (next_date <= today) and materializes a real invoice from the
// template_data JSON, then advances the template's next_date by its frequency
// and stamps last_generated.
//
// Design notes:
//  • Schema reality: the assigned spec referenced
//    "recurring_invoice_templates.next_run_date", but the actual schema
//    (src/main/database/schema.sql) uses `recurring_templates` with columns
//    `type`, `frequency`, `next_date`, `last_generated`, `template_data`.
//    We bind to the real table/columns and guard everything defensively.
//  • Idempotent: a template is skipped if last_generated == today, so a
//    same-day re-run never double-generates. We also re-read next_date inside
//    the per-template transaction.
//  • Best-effort: run() NEVER throws. Any failure degrades to ok:false with a
//    detail/warning, and a single template's failure does not abort the rest.
//  • Money is never moved and no email is sent: we only create a draft invoice
//    (status='draft') plus its line items, mirroring how a user would.

import * as db from '../../database';
import { randomUUID } from 'crypto';

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

// Advance an ISO date (YYYY-MM-DD) by one frequency step. Anchored at noon
// local to dodge DST edges. Falls back to monthly on unknown frequency.
function advanceByFrequency(isoDate: string, frequency: string): string {
  const dt = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(dt.getTime())) return isoDate;
  switch (frequency) {
    case 'weekly': dt.setDate(dt.getDate() + 7); break;
    case 'biweekly': dt.setDate(dt.getDate() + 14); break;
    case 'quarterly': dt.setMonth(dt.getMonth() + 3); break;
    case 'annually': dt.setFullYear(dt.getFullYear() + 1); break;
    case 'monthly':
    default: dt.setMonth(dt.getMonth() + 1); break;
  }
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysISO(isoDate: string, days: number): string {
  const dt = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(dt.getTime())) return isoDate;
  dt.setDate(dt.getDate() + days);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function safeParse(json: any): any {
  if (!json || typeof json !== 'string') return {};
  try { const v = JSON.parse(json); return (v && typeof v === 'object') ? v : {}; }
  catch { return {}; }
}

function n(v: any): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
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

  // Resolve target companies.
  let companies: { id: string }[] = [];
  try {
    if (ctx?.companyId) {
      companies = [{ id: ctx.companyId }];
    } else {
      companies = (database.prepare(`SELECT id FROM companies`).all() as any[]) as { id: string }[];
    }
  } catch (err: any) {
    return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
  }

  for (const { id: companyId } of companies) {
    let templates: any[] = [];
    try {
      templates = database.prepare(`
        SELECT id, name, frequency, next_date, end_date, template_data, last_generated
        FROM recurring_templates
        WHERE company_id = ?
          AND type = 'invoice'
          AND COALESCE(is_active, 1) = 1
          AND next_date IS NOT NULL
          AND next_date != ''
          AND next_date <= ?
      `).all(companyId, today) as any[];
    } catch (err: any) {
      warnings.push(`Template scan (company ${companyId}): ${err?.message || err}`);
      continue;
    }

    for (const tpl of templates) {
      try {
        // Idempotency guard: already generated today.
        if (tpl.last_generated && String(tpl.last_generated).slice(0, 10) === today) {
          continue;
        }
        // Respect end_date (inclusive). If the template has expired, advance
        // nothing and deactivate so it stops appearing.
        if (tpl.end_date && String(tpl.end_date) !== '' && today > String(tpl.end_date)) {
          try {
            database.prepare(
              `UPDATE recurring_templates SET is_active = 0, updated_at = datetime('now') WHERE id = ?`
            ).run(tpl.id);
          } catch { /* best-effort */ }
          continue;
        }

        const data = safeParse(tpl.template_data);
        const clientId = data.client_id || data.clientId;
        if (!clientId) {
          warnings.push(`Template ${tpl.id} skipped: no client_id in template_data`);
          continue;
        }

        // Build line items from template (defensive about shape).
        const rawLines: any[] = Array.isArray(data.line_items)
          ? data.line_items
          : Array.isArray(data.lineItems) ? data.lineItems : [];

        let subtotal = 0;
        let taxAmount = 0;
        const lines = rawLines.map((li) => {
          const qty = li.quantity != null ? n(li.quantity) : 1;
          const unit = n(li.unit_price ?? li.unitPrice);
          const amount = li.amount != null ? n(li.amount) : qty * unit;
          const taxRate = n(li.tax_rate ?? li.taxRate);
          subtotal += amount;
          taxAmount += amount * (taxRate / 100);
          return {
            description: String(li.description ?? ''),
            quantity: qty,
            unit_price: unit,
            amount,
            tax_rate: taxRate,
            account_id: li.account_id ?? li.accountId ?? null,
          };
        });

        // Allow explicit overrides from template_data; otherwise derive.
        const discountAmount = n(data.discount_amount ?? data.discountAmount);
        if (data.subtotal != null) subtotal = n(data.subtotal);
        if (data.tax_amount != null) taxAmount = n(data.tax_amount);
        const total = subtotal + taxAmount - discountAmount;

        const issueDate = today;
        const dueDays = data.due_days != null ? n(data.due_days) : 30;
        const dueDate = data.due_date ? String(data.due_date) : addDaysISO(issueDate, dueDays);

        const invoiceId = randomUUID();
        // Invoice number: prefer template prefix + timestamp-ish suffix; the
        // UNIQUE(company_id, invoice_number) constraint protects against dupes.
        const prefix = String(data.invoice_prefix ?? data.invoicePrefix ?? 'REC');
        const invoiceNumber = `${prefix}-${today.replace(/-/g, '')}-${invoiceId.slice(0, 6)}`;

        const tx = database.transaction(() => {
          // Re-read inside tx to confirm this template still due & not already
          // generated today (defends against concurrent runs).
          const fresh = database.prepare(
            `SELECT next_date, last_generated FROM recurring_templates WHERE id = ?`
          ).get(tpl.id) as any;
          if (!fresh) return false;
          if (fresh.last_generated && String(fresh.last_generated).slice(0, 10) === today) return false;
          if (!fresh.next_date || String(fresh.next_date) > today) return false;

          database.prepare(`
            INSERT INTO invoices (
              id, company_id, client_id, invoice_number, status,
              issue_date, due_date, subtotal, tax_amount, discount_amount,
              total, amount_paid, notes, terms, is_recurring, recurring_template_id
            ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, 0, ?, ?, 1, ?)
          `).run(
            invoiceId, companyId, clientId, invoiceNumber,
            issueDate, dueDate, db.roundCents(subtotal), db.roundCents(taxAmount),
            db.roundCents(discountAmount), db.roundCents(total),
            String(data.notes ?? ''), String(data.terms ?? ''), tpl.id
          );

          const insLine = database.prepare(`
            INSERT INTO invoice_line_items (
              id, invoice_id, description, quantity, unit_price, amount, tax_rate, account_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const li of lines) {
            insLine.run(
              randomUUID(), invoiceId, li.description, li.quantity,
              li.unit_price, db.roundCents(li.amount), li.tax_rate, li.account_id
            );
          }

          const nextDate = advanceByFrequency(String(fresh.next_date), String(tpl.frequency || 'monthly'));
          database.prepare(`
            UPDATE recurring_templates
            SET next_date = ?, last_generated = ?, updated_at = datetime('now')
            WHERE id = ?
          `).run(nextDate, today, tpl.id);

          return true;
        });

        const did = tx();
        if (did) {
          affected++;
          try {
            db.logAudit(companyId, 'invoices', invoiceId, 'auto_generated', {
              source: 'recurring-invoice-generator',
              template_id: tpl.id,
              invoice_number: invoiceNumber,
              total: db.roundCents(total),
            });
          } catch { /* audit best-effort */ }
        }
      } catch (err: any) {
        warnings.push(`Template ${tpl?.id} (company ${companyId}): ${err?.message || err}`);
      }
    }
  }

  return {
    ok: warnings.length === 0,
    affected,
    detail: `Generated ${affected} invoice(s) from recurring templates due on or before ${today}.`,
    ...(warnings.length ? { warnings } : {}),
  };
}

export const automation: AutomationModule = {
  id: 'recurring-invoice-generator',
  name: 'Recurring Invoice Generator',
  domain: 'invoicing',
  trigger: 'daily',
  run,
};
