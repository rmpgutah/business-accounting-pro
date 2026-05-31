// src/main/automations/ap-bills/recurring-bill-generator.ts
//
// Recurring Bill Generator (domain: ap-bills)
//
// Generates accounts-payable bills from active recurring templates that
// are due today, guarded against duplicates so re-running the same day
// (or on a partially-completed prior run) never double-creates a bill.
//
// Schema reality (verified against src/main/database/schema.sql):
//   • recurring_templates.type CHECK only allows 'invoice' | 'expense' —
//     there is NO dedicated 'bill' type and the `bills` table has NO
//     recurring_template_id column. AP recurring entries are therefore
//     modeled as expense-type templates whose template_data JSON carries
//     a vendor_id (i.e. a vendor bill). We only act on expense templates
//     that look like a vendor bill (template_data.kind === 'bill' OR a
//     vendor_id is present) so we never clobber pure-cash expenses.
//   • Generated bills are linked back to their template via a
//     deterministic `reference` string ("recurring:<templateId>:<date>")
//     — that is our idempotency key since bills lack a template FK.
//
// Safety / design:
//   • run() is best-effort and NEVER throws — every db touch is wrapped.
//   • IDEMPOTENT: before inserting we check for an existing bill with the
//     same deterministic reference; if present we skip (and still advance
//     the template clock if it has fallen behind).
//   • We do NOT move money, send email, or pay anything — we only insert
//     a 'pending' bill draft for the user to review/approve.
//   • Money fields are copied verbatim from template_data; we never infer.
//   • Templates with an end_date in the past are skipped (expired).
//   • Mirrors the date + db patterns in src/main/crons/overdue-checker.ts.

import { randomUUID } from 'crypto';
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

const SLUG = 'recurring-bill-generator';

// Today as YYYY-MM-DD in LOCAL timezone (matches how dates are stored).
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Advance a YYYY-MM-DD date by one period of the given frequency.
function advanceDate(isoDate: string, frequency: string): string {
  const dt = new Date(`${isoDate}T12:00:00`); // noon-anchor avoids DST edges
  switch (frequency) {
    case 'weekly':
      dt.setDate(dt.getDate() + 7);
      break;
    case 'biweekly':
      dt.setDate(dt.getDate() + 14);
      break;
    case 'monthly':
      dt.setMonth(dt.getMonth() + 1);
      break;
    case 'quarterly':
      dt.setMonth(dt.getMonth() + 3);
      break;
    case 'annually':
      dt.setFullYear(dt.getFullYear() + 1);
      break;
    default:
      dt.setMonth(dt.getMonth() + 1);
      break;
  }
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function toNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export const automation: AutomationModule = {
  id: SLUG,
  name: 'Recurring Bill Generator',
  domain: 'ap-bills',
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

    // Resolve the set of companies to process.
    let companyIds: string[] = [];
    try {
      if (ctx?.companyId) {
        companyIds = [ctx.companyId];
      } else {
        const fallback = db.getCurrentCompanyId();
        const rows = database.prepare(`SELECT id FROM companies`).all() as any[];
        companyIds = rows.map((r) => r.id);
        if (companyIds.length === 0 && fallback) companyIds = [fallback];
      }
    } catch (err: any) {
      return { ok: false, affected: 0, detail: `Failed to list companies: ${err?.message || err}` };
    }

    for (const companyId of companyIds) {
      let templates: any[] = [];
      try {
        templates = database.prepare(`
          SELECT id, company_id, type, name, frequency, next_date, end_date,
                 is_active, template_data, last_generated
          FROM recurring_templates
          WHERE company_id = ?
            AND type = 'expense'
            AND COALESCE(is_active, 1) = 1
            AND next_date IS NOT NULL
            AND next_date != ''
            AND next_date <= ?
        `).all(companyId, today) as any[];
      } catch (err: any) {
        warnings.push(`Template scan failed (company ${companyId}): ${err?.message || err}`);
        continue;
      }

      for (const tpl of templates) {
        try {
          // Skip expired templates.
          if (tpl.end_date && String(tpl.end_date).trim() !== '' && String(tpl.end_date) < today) {
            continue;
          }

          // Parse template_data defensively.
          let data: any = {};
          try {
            data = tpl.template_data ? JSON.parse(tpl.template_data) : {};
          } catch {
            data = {};
          }

          // Only treat as a bill when it clearly is one (vendor bill).
          const vendorId = data.vendor_id ?? data.vendorId ?? null;
          const isBill = data.kind === 'bill' || data.type === 'bill' || vendorId != null;
          if (!isBill) {
            continue; // pure-cash expense template — not our concern
          }

          const dueDate = tpl.next_date;
          // Deterministic idempotency key stored in bills.reference.
          const reference = `recurring:${tpl.id}:${dueDate}`;

          // Has a bill for this template+date already been generated?
          const existing = database.prepare(
            `SELECT id FROM bills WHERE company_id = ? AND reference = ? LIMIT 1`
          ).get(companyId, reference) as any;

          if (!existing) {
            const subtotal = toNum(data.subtotal ?? data.amount ?? data.total);
            const taxAmount = toNum(data.tax_amount);
            const discount = toNum(data.discount_amount);
            let total = toNum(data.total);
            if (total === 0) total = subtotal + taxAmount - discount;

            const billId = randomUUID();
            const billNumber =
              (typeof data.bill_number === 'string' && data.bill_number.trim() !== '')
                ? `${data.bill_number}-${dueDate}`
                : `REC-${dueDate}-${tpl.id.slice(0, 8)}`;

            const insertBill = database.prepare(`
              INSERT INTO bills
                (id, company_id, vendor_id, bill_number, status, issue_date, due_date,
                 subtotal, tax_amount, discount_amount, total, amount_paid,
                 notes, reference, account_id)
              VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
            `);

            const notes =
              (typeof data.notes === 'string' ? data.notes : '') ||
              `Auto-generated from recurring template "${tpl.name}"`;

            const accountId =
              (typeof data.account_id === 'string' && data.account_id.trim() !== '')
                ? data.account_id
                : null;

            // Line items (optional). Wrapped so a bad item never aborts the bill.
            const lineItems: any[] = Array.isArray(data.line_items)
              ? data.line_items
              : (Array.isArray(data.lineItems) ? data.lineItems : []);

            const tx = database.transaction(() => {
              insertBill.run(
                billId, companyId, vendorId, billNumber,
                dueDate, dueDate,
                subtotal, taxAmount, discount, total,
                notes, reference, accountId
              );

              if (lineItems.length > 0) {
                const insertLine = database.prepare(`
                  INSERT INTO bill_line_items
                    (id, bill_id, description, quantity, unit_price, amount, tax_rate, account_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `);
                for (const li of lineItems) {
                  const qty = toNum(li.quantity ?? 1) || 1;
                  const unit = toNum(li.unit_price ?? li.unitPrice);
                  const amt = li.amount != null ? toNum(li.amount) : qty * unit;
                  insertLine.run(
                    randomUUID(),
                    billId,
                    typeof li.description === 'string' ? li.description : '',
                    qty,
                    unit,
                    amt,
                    toNum(li.tax_rate ?? li.taxRate),
                    (typeof li.account_id === 'string' && li.account_id.trim() !== '') ? li.account_id : null
                  );
                }
              }
            });
            tx();

            affected++;

            try {
              db.logAudit(companyId, 'bills', billId, 'auto_recurring_bill', {
                template_id: tpl.id,
                template_name: tpl.name,
                reference,
                due_date: dueDate,
                total,
                automation: SLUG,
              });
            } catch { /* audit best-effort */ }
          }

          // Advance the template clock past today so we don't re-fire.
          // Loop in case the template fell several periods behind.
          try {
            let nextDate = advanceDate(dueDate, tpl.frequency);
            let guard = 0;
            while (nextDate <= today && guard < 600) {
              nextDate = advanceDate(nextDate, tpl.frequency);
              guard++;
            }
            database.prepare(`
              UPDATE recurring_templates
              SET next_date = ?, last_generated = ?, updated_at = datetime('now')
              WHERE id = ? AND company_id = ?
            `).run(nextDate, today, tpl.id, companyId);
          } catch (err: any) {
            warnings.push(`Failed to advance template ${tpl.id}: ${err?.message || err}`);
          }
        } catch (err: any) {
          warnings.push(`Template ${tpl?.id} (company ${companyId}): ${err?.message || err}`);
        }
      }
    }

    const detail = `Generated ${affected} recurring bill(s) across ${companyIds.length} company(ies) for ${today}.`;
    return warnings.length > 0
      ? { ok: true, affected, detail, warnings }
      : { ok: true, affected, detail };
  },
};
