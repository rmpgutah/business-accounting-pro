// src/main/services/auto-dunning.ts
//
// P2 — Auto-Dunning / Collections Escalation
//
// Scans overdue, still-owed invoices per company and QUEUES dunning
// reminders at fixed days-past-due stages (7 / 30 / 60 days). At 90+
// days past due it surfaces a COLLECTIONS SUGGESTION (event + audit +
// a tagged custom reminder row) but never auto-creates a `debts` row —
// escalating to collections is a deliberate human decision.
//
// Design choices (mirrors the cron conventions in crons/*.ts):
//
//  • Best-effort + idempotent. Re-running the same day queues nothing
//    new: each stage maps to a distinct invoice_reminders.reminder_type
//    ('overdue_7','overdue_30','overdue_60') or, for the 90+ collections
//    suggestion, a 'custom' row carrying a recognizable message tag.
//    Before queuing a stage we check no row of that kind already exists
//    for the invoice.
//
//  • OWED-NESS is decided by BALANCE, never status alone:
//    balance = total - amount_paid, owed when balance > EPSILON (0.005).
//    We still require status='overdue' (set by the overdue-checker cron)
//    as the entry gate, but a paid-in-full invoice that is still
//    mislabeled 'overdue' is skipped because its balance is settled.
//
//  • "In collections" invoices are skipped: if a `debts` row already
//    links to this invoice (source_type='invoice') in a non-terminal
//    collection state, we do not keep dunning it.
//
//  • invoice_reminders has NO company_id column (it is scoped through
//    invoice_id — and is listed in tablesWithoutCompanyId). We insert
//    directly with an explicit id; status defaults to 'pending' so the
//    existing reminder-sender picks it up. We do NOT send email here.
//
//  • Pure helpers take an ISO `today` (YYYY-MM-DD) parameter; the
//    entrypoint computes local-today the same way overdue-checker does.
//
//  • Never throws. Returns a typed result so the cron + a UI button can
//    render a summary.

import type { Database } from 'better-sqlite3';
import { randomUUID } from 'crypto';
import * as db from '../database';
import { eventBus } from '../services/EventBus';

const EPSILON = 0.005;

// Days-past-due -> invoice_reminders.reminder_type stage key.
// Ordered ascending; we queue the HIGHEST stage the invoice has
// crossed that has not already been queued (so a freshly-discovered
// 65-day-old invoice gets its overdue_60 reminder, not three rows).
const REMINDER_STAGES: Array<{ minDays: number; type: 'overdue_7' | 'overdue_30' | 'overdue_60' }> = [
  { minDays: 7, type: 'overdue_7' },
  { minDays: 30, type: 'overdue_30' },
  { minDays: 60, type: 'overdue_60' },
];

const COLLECTIONS_DAYS = 90;
// Tag embedded in the 'custom' reminder message so the 90+ suggestion
// is idempotent (we LIKE-match it before inserting another).
const COLLECTIONS_TAG = '[auto-dunning:collections-suggestion]';

export interface DunningRunResult {
  invoicesProcessed: number;
  remindersQueued: number;
  collectionsSuggested: number;
  errors: string[];
}

export interface DunningPreviewItem {
  invoiceId: string;
  invoiceNumber: string;
  clientId: string;
  dueDate: string;
  daysPastDue: number;
  balanceDue: number;
  action: 'queue_reminder' | 'suggest_collections';
  stage: 'overdue_7' | 'overdue_30' | 'overdue_60' | 'collections';
}

export interface DunningPreview {
  companyId: string;
  generatedAt: string;
  items: DunningPreviewItem[];
  totalRemindersToQueue: number;
  totalCollectionsToSuggest: number;
}

// Today as YYYY-MM-DD in LOCAL timezone (matches due_date storage).
function localTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Whole days between dueDate and today (>= 0). Anchored at noon local
// to avoid DST edge cases — identical approach to overdue-checker.
function daysPastDue(dueDate: string, today: string): number {
  const due = new Date(`${dueDate}T12:00:00`).getTime();
  const now = new Date(`${today}T12:00:00`).getTime();
  if (!Number.isFinite(due) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.floor((now - due) / 86_400_000));
}

// Decide which single stage (if any) an invoice qualifies for, given
// days-past-due and which stages already exist for it. Returns null
// when nothing new to do.
function nextStageFor(
  dpd: number,
  existingTypes: Set<string>,
  hasCollectionsSuggestion: boolean
): { kind: 'reminder'; type: 'overdue_7' | 'overdue_30' | 'overdue_60' } | { kind: 'collections' } | null {
  if (dpd >= COLLECTIONS_DAYS) {
    return hasCollectionsSuggestion ? null : { kind: 'collections' };
  }
  // Highest reminder stage crossed that hasn't been queued yet.
  let pick: { kind: 'reminder'; type: 'overdue_7' | 'overdue_30' | 'overdue_60' } | null = null;
  for (const s of REMINDER_STAGES) {
    if (dpd >= s.minDays && !existingTypes.has(s.type)) {
      pick = { kind: 'reminder', type: s.type };
    }
  }
  return pick;
}

interface OverdueInvoiceRow {
  id: string;
  invoice_number: string;
  client_id: string;
  due_date: string;
  total: number;
  amount_paid: number;
}

// Overdue, still-owed invoices for a company that are NOT already in an
// active collections debt. Balance (not status) decides owed-ness.
function loadOwedOverdueInvoices(database: Database, companyId: string): OverdueInvoiceRow[] {
  return database.prepare(`
    SELECT i.id, i.invoice_number, i.client_id, i.due_date, i.total, i.amount_paid
    FROM invoices i
    WHERE i.company_id = ?
      AND i.status = 'overdue'
      AND i.due_date IS NOT NULL
      AND i.due_date != ''
      AND (COALESCE(i.total, 0) - COALESCE(i.amount_paid, 0)) > ?
      AND NOT EXISTS (
        SELECT 1 FROM debts d
        WHERE d.company_id = i.company_id
          AND d.source_type = 'invoice'
          AND d.source_id = i.id
          AND d.status IN ('active','in_collection','legal','disputed','bankruptcy')
      )
  `).all(companyId, EPSILON) as OverdueInvoiceRow[];
}

// Existing reminder stage types already queued/sent for an invoice.
function loadExistingReminderTypes(database: Database, invoiceId: string): Set<string> {
  const rows = database.prepare(
    `SELECT DISTINCT reminder_type FROM invoice_reminders WHERE invoice_id = ?`
  ).all(invoiceId) as Array<{ reminder_type: string }>;
  return new Set(rows.map(r => r.reminder_type));
}

// Whether a collections-suggestion custom reminder already exists.
function hasCollectionsSuggestion(database: Database, invoiceId: string): boolean {
  const row = database.prepare(
    `SELECT 1 FROM invoice_reminders
     WHERE invoice_id = ? AND reminder_type = 'custom' AND message LIKE ?
     LIMIT 1`
  ).get(invoiceId, `%${COLLECTIONS_TAG}%`) as unknown;
  return !!row;
}

function insertReminder(
  database: Database,
  invoiceId: string,
  reminderType: string,
  scheduledDate: string,
  message: string
): void {
  database.prepare(`
    INSERT INTO invoice_reminders (id, invoice_id, reminder_type, scheduled_date, status, message)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).run(randomUUID(), invoiceId, reminderType, scheduledDate, message);
}

export function runAutoDunning(): DunningRunResult {
  const result: DunningRunResult = {
    invoicesProcessed: 0,
    remindersQueued: 0,
    collectionsSuggested: 0,
    errors: [],
  };

  let database: Database;
  try {
    database = db.getDb();
  } catch (err: any) {
    result.errors.push(`Database not ready: ${err?.message || err}`);
    return result;
  }

  let companies: { id: string }[] = [];
  try {
    companies = database.prepare(`SELECT id FROM companies`).all() as { id: string }[];
  } catch (err: any) {
    result.errors.push(`Failed to list companies: ${err?.message || err}`);
    return result;
  }

  const today = localTodayISO();

  for (const { id: companyId } of companies) {
    let invoices: OverdueInvoiceRow[] = [];
    try {
      invoices = loadOwedOverdueInvoices(database, companyId);
    } catch (err: any) {
      result.errors.push(`Invoice scan (company ${companyId}): ${err?.message || err}`);
      continue;
    }

    for (const inv of invoices) {
      result.invoicesProcessed++;
      try {
        const dpd = daysPastDue(inv.due_date, today);
        const balanceDue = Number(inv.total || 0) - Number(inv.amount_paid || 0);

        const existingTypes = loadExistingReminderTypes(database, inv.id);
        const hasCollections = hasCollectionsSuggestion(database, inv.id);
        const stage = nextStageFor(dpd, existingTypes, hasCollections);
        if (!stage) continue;

        if (stage.kind === 'reminder') {
          insertReminder(
            database,
            inv.id,
            stage.type,
            today,
            `Auto-dunning reminder (${dpd} days past due) for invoice ${inv.invoice_number}. Balance due ${balanceDue.toFixed(2)}.`
          );
          result.remindersQueued++;

          try {
            db.logAudit(companyId, 'invoices', inv.id, 'dunning_reminder_queued', {
              stage: stage.type,
              days_past_due: dpd,
              balance_due: balanceDue,
              cron: 'auto-dunning',
            });
          } catch { /* audit best-effort */ }
          // No EventBus emit for plain reminders: EventType has no
          // dunning-reminder member, and the queued invoice_reminders
          // row + audit entry are the durable record the UI reads.
        } else {
          // 90+ days: surface a collections SUGGESTION only.
          insertReminder(
            database,
            inv.id,
            'custom',
            today,
            `${COLLECTIONS_TAG} Invoice ${inv.invoice_number} is ${dpd} days past due with ${balanceDue.toFixed(2)} owed. Consider escalating to collections.`
          );
          result.collectionsSuggested++;

          try {
            db.logAudit(companyId, 'invoices', inv.id, 'dunning_collections_suggested', {
              days_past_due: dpd,
              balance_due: balanceDue,
              cron: 'auto-dunning',
            });
          } catch { /* audit best-effort */ }

          try {
            // Reuse the existing 'debt.escalated' EventType — this is a
            // collections-escalation signal. We pass the INVOICE as the
            // entity (no debt row is created) plus a suggestion flag so
            // subscribers can distinguish a true debt escalation from a
            // mere suggestion.
            eventBus.emit({
              type: 'debt.escalated',
              entityType: 'invoice',
              entityId: inv.id,
              companyId,
              data: {
                suggestion_only: true,
                invoice_number: inv.invoice_number,
                client_id: inv.client_id,
                days_past_due: dpd,
                balance_due: balanceDue,
                due_date: inv.due_date,
                source: 'auto_dunning_cron',
              },
            });
          } catch { /* event-bus best-effort */ }
        }
      } catch (err: any) {
        result.errors.push(`Invoice ${inv.id} (company ${companyId}): ${err?.message || err}`);
      }
    }
  }

  return result;
}

// Read-only: what WOULD be actioned for a company right now. Mutates
// nothing — safe for a UI "preview" button.
export function getDunningPreview(companyId: string): DunningPreview {
  const preview: DunningPreview = {
    companyId,
    generatedAt: new Date().toISOString(),
    items: [],
    totalRemindersToQueue: 0,
    totalCollectionsToSuggest: 0,
  };

  let database: Database;
  try {
    database = db.getDb();
  } catch {
    return preview;
  }

  const today = localTodayISO();

  let invoices: OverdueInvoiceRow[] = [];
  try {
    invoices = loadOwedOverdueInvoices(database, companyId);
  } catch {
    return preview;
  }

  for (const inv of invoices) {
    try {
      const dpd = daysPastDue(inv.due_date, today);
      const balanceDue = Number(inv.total || 0) - Number(inv.amount_paid || 0);
      const existingTypes = loadExistingReminderTypes(database, inv.id);
      const hasCollections = hasCollectionsSuggestion(database, inv.id);
      const stage = nextStageFor(dpd, existingTypes, hasCollections);
      if (!stage) continue;

      if (stage.kind === 'reminder') {
        preview.totalRemindersToQueue++;
        preview.items.push({
          invoiceId: inv.id,
          invoiceNumber: inv.invoice_number,
          clientId: inv.client_id,
          dueDate: inv.due_date,
          daysPastDue: dpd,
          balanceDue,
          action: 'queue_reminder',
          stage: stage.type,
        });
      } else {
        preview.totalCollectionsToSuggest++;
        preview.items.push({
          invoiceId: inv.id,
          invoiceNumber: inv.invoice_number,
          clientId: inv.client_id,
          dueDate: inv.due_date,
          daysPastDue: dpd,
          balanceDue,
          action: 'suggest_collections',
          stage: 'collections',
        });
      }
    } catch {
      /* skip this invoice in preview */
    }
  }

  return preview;
}
