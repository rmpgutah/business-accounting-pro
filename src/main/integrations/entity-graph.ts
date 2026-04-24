// src/main/integrations/entity-graph.ts
//
// Cross-entity integration service. Answers two questions for any (type, id):
//
//   1. "What other records in the system touch this one?"   → graph(type, id)
//   2. "What has happened to this record over time?"         → timeline(type, id)
//
// The graph is computed at request-time from the FK columns already present
// in the schema, plus anything explicitly recorded in the `entity_relations`
// table. No single giant JOIN — we emit small, separate queries per relation
// so the browser can render groups independently.
//
// Every query is scoped by company_id. The caller provides it — we never
// trust client-supplied IDs to reach across companies.

import type { IpcMain } from 'electron';
import { getDb } from '../database';

export type EntityType =
  | 'invoice' | 'client' | 'project' | 'expense' | 'bill' | 'vendor'
  | 'debt' | 'quote' | 'purchase_order' | 'payment' | 'bill_payment'
  | 'employee' | 'pay_stub' | 'payroll_run' | 'time_entry' | 'budget'
  | 'account' | 'journal_entry' | 'tax_payment' | 'fixed_asset'
  | 'bank_account' | 'bank_transaction' | 'recurring_template'
  | 'stripe_object';

export interface RelatedGroup {
  key: string;                 // stable id for React keys / group header
  label: string;               // e.g. "Invoices (3)"
  entityType: EntityType;      // what type these records are — lets UI make them clickable
  rows: Array<Record<string, unknown>>;
  total?: number;              // optional aggregate like sum of amounts
  currency?: string;
}

export interface TimelineEvent {
  id: string;
  at: string;                  // ISO timestamp
  kind: 'audit' | 'email' | 'notification' | 'document' | 'stripe';
  action: string;              // create/update/export_pdf/email_pdf/...
  title: string;
  detail?: string;
  source?: string;             // performed_by / recipient / etc
  metadata?: Record<string, unknown>;
}

// ─── Graph builders per entity type ─────────────────────────────────────
// Each builder returns an array of RelatedGroup. Empty groups are filtered
// out before returning to keep the UI tidy.

function safeAll<T = any>(sql: string, params: any[]): T[] {
  try { return getDb().prepare(sql).all(...params) as T[]; } catch { return []; }
}
function safeOne<T = any>(sql: string, params: any[]): T | null {
  try { return (getDb().prepare(sql).get(...params) ?? null) as T | null; } catch { return null; }
}
function sumField(rows: Array<Record<string, unknown>>, field: string): number {
  let s = 0;
  for (const r of rows) { const v = Number(r[field]); if (!Number.isNaN(v)) s += v; }
  return s;
}

function clientGraph(companyId: string, clientId: string): RelatedGroup[] {
  const groups: RelatedGroup[] = [];

  const invoices = safeAll(
    `SELECT id, invoice_number, issue_date, due_date, total, amount_paid, status
       FROM invoices WHERE company_id = ? AND client_id = ?
       ORDER BY issue_date DESC LIMIT 100`, [companyId, clientId]);
  if (invoices.length) groups.push({
    key: 'invoices', label: `Invoices (${invoices.length})`, entityType: 'invoice',
    rows: invoices, total: sumField(invoices, 'total'),
  });

  const quotes = safeAll(
    `SELECT id, quote_number, issue_date, total, status
       FROM quotes WHERE company_id = ? AND client_id = ?
       ORDER BY issue_date DESC LIMIT 50`, [companyId, clientId]);
  if (quotes.length) groups.push({ key: 'quotes', label: `Quotes (${quotes.length})`, entityType: 'quote', rows: quotes });

  const projects = safeAll(
    `SELECT id, name, status, start_date, end_date, budget
       FROM projects WHERE company_id = ? AND client_id = ?
       ORDER BY start_date DESC NULLS LAST LIMIT 50`, [companyId, clientId]);
  if (projects.length) groups.push({ key: 'projects', label: `Projects (${projects.length})`, entityType: 'project', rows: projects });

  const debts = safeAll(
    `SELECT id, debt_number, balance_due, status, delinquent_date
       FROM debts WHERE company_id = ? AND debtor_id = ?
       ORDER BY delinquent_date DESC NULLS LAST LIMIT 50`, [companyId, clientId]);
  if (debts.length) groups.push({
    key: 'debts', label: `Debts (${debts.length})`, entityType: 'debt',
    rows: debts, total: sumField(debts, 'balance_due'),
  });

  const expenses = safeAll(
    `SELECT id, date, amount, description, status
       FROM expenses WHERE company_id = ? AND client_id = ?
       ORDER BY date DESC LIMIT 50`, [companyId, clientId]);
  if (expenses.length) groups.push({
    key: 'expenses', label: `Billable Expenses (${expenses.length})`, entityType: 'expense',
    rows: expenses, total: sumField(expenses, 'amount'),
  });

  const stripe = safeAll(
    `SELECT stripe_id, resource, stripe_created, data
       FROM stripe_cache WHERE company_id = ? AND local_entity_type = 'client' AND local_entity_id = ?
       ORDER BY stripe_created DESC LIMIT 20`, [companyId, clientId]);
  if (stripe.length) groups.push({ key: 'stripe', label: `Stripe objects (${stripe.length})`, entityType: 'stripe_object', rows: stripe });

  return groups;
}

function invoiceGraph(companyId: string, invoiceId: string): RelatedGroup[] {
  const groups: RelatedGroup[] = [];
  const inv = safeOne<{ client_id: string }>(
    `SELECT client_id FROM invoices WHERE id = ? AND company_id = ?`, [invoiceId, companyId]);
  if (!inv) return groups;

  const lines = safeAll(
    `SELECT id, description, quantity, unit_price, amount
       FROM invoice_line_items WHERE invoice_id = ?`, [invoiceId]);
  if (lines.length) groups.push({ key: 'lines', label: `Line Items (${lines.length})`, entityType: 'invoice', rows: lines, total: sumField(lines, 'amount') });

  const payments = safeAll(
    `SELECT id, date, amount, payment_method, reference
       FROM payments WHERE company_id = ? AND invoice_id = ?
       ORDER BY date DESC`, [companyId, invoiceId]);
  if (payments.length) groups.push({
    key: 'payments', label: `Payments (${payments.length})`, entityType: 'payment',
    rows: payments, total: sumField(payments, 'amount'),
  });

  const reminders = safeAll(
    `SELECT id, scheduled_for, sent_at, status, template_id
       FROM invoice_reminders WHERE invoice_id = ?
       ORDER BY scheduled_for ASC`, [invoiceId]);
  if (reminders.length) groups.push({ key: 'reminders', label: `Reminders (${reminders.length})`, entityType: 'invoice', rows: reminders });

  const timeEntries = safeAll(
    `SELECT te.id, te.date, te.duration_minutes, te.description, te.is_invoiced
       FROM time_entries te
       JOIN invoice_line_items ili ON ',' || COALESCE(ili.time_entry_ids,'') || ',' LIKE '%,' || te.id || ',%'
       WHERE ili.invoice_id = ?`, [invoiceId]);
  if (timeEntries.length) groups.push({ key: 'time', label: `Time Entries (${timeEntries.length})`, entityType: 'time_entry', rows: timeEntries });

  const debts = safeAll(
    `SELECT d.id, d.debt_number, d.balance_due, d.status
       FROM debts d
       JOIN invoice_debt_links l ON l.debt_id = d.id
       WHERE d.company_id = ? AND l.invoice_id = ?`, [companyId, invoiceId]);
  if (debts.length) groups.push({ key: 'debts', label: `Collection Cases (${debts.length})`, entityType: 'debt', rows: debts });

  const stripe = safeAll(
    `SELECT stripe_id, resource, stripe_created
       FROM stripe_cache WHERE company_id = ? AND local_entity_type = 'invoice' AND local_entity_id = ?
       ORDER BY stripe_created DESC`, [companyId, invoiceId]);
  if (stripe.length) groups.push({ key: 'stripe', label: `Stripe objects (${stripe.length})`, entityType: 'stripe_object', rows: stripe });

  return groups;
}

function billGraph(companyId: string, billId: string): RelatedGroup[] {
  const groups: RelatedGroup[] = [];
  const lines = safeAll(
    `SELECT id, description, quantity, unit_price, amount FROM bill_line_items WHERE bill_id = ?`, [billId]);
  if (lines.length) groups.push({ key: 'lines', label: `Line Items (${lines.length})`, entityType: 'bill', rows: lines, total: sumField(lines, 'amount') });

  const payments = safeAll(
    `SELECT id, date, amount, reference FROM bill_payments
       WHERE company_id = ? AND bill_id = ? ORDER BY date DESC`, [companyId, billId]);
  if (payments.length) groups.push({
    key: 'payments', label: `Payments (${payments.length})`, entityType: 'bill_payment',
    rows: payments, total: sumField(payments, 'amount'),
  });

  const po = safeOne<{ id: string }>(
    `SELECT po.id FROM purchase_orders po
       WHERE po.company_id = ? AND po.id IN (
         SELECT purchase_order_id FROM bills WHERE id = ?
       )`, [companyId, billId]);
  if (po) groups.push({ key: 'po', label: `Purchase Order`, entityType: 'purchase_order', rows: [po] });

  return groups;
}

function projectGraph(companyId: string, projectId: string): RelatedGroup[] {
  const groups: RelatedGroup[] = [];

  const time = safeAll(
    `SELECT id, date, duration_minutes, description, is_billable, is_invoiced
       FROM time_entries WHERE company_id = ? AND project_id = ?
       ORDER BY date DESC LIMIT 200`, [companyId, projectId]);
  if (time.length) groups.push({ key: 'time', label: `Time Entries (${time.length})`, entityType: 'time_entry', rows: time });

  const expenses = safeAll(
    `SELECT id, date, amount, description, status FROM expenses
       WHERE company_id = ? AND project_id = ? ORDER BY date DESC`, [companyId, projectId]);
  if (expenses.length) groups.push({
    key: 'expenses', label: `Expenses (${expenses.length})`, entityType: 'expense',
    rows: expenses, total: sumField(expenses, 'amount'),
  });

  const invoices = safeAll(
    `SELECT DISTINCT i.id, i.invoice_number, i.issue_date, i.total, i.status
       FROM invoices i
       JOIN invoice_line_items l ON l.invoice_id = i.id
       WHERE i.company_id = ? AND l.project_id = ?
       ORDER BY i.issue_date DESC`, [companyId, projectId]);
  if (invoices.length) groups.push({
    key: 'invoices', label: `Invoices (${invoices.length})`, entityType: 'invoice',
    rows: invoices, total: sumField(invoices, 'total'),
  });

  return groups;
}

function debtGraph(companyId: string, debtId: string): RelatedGroup[] {
  const groups: RelatedGroup[] = [];

  const payments = safeAll(
    `SELECT id, payment_date, amount, payment_method, reference
       FROM debt_payments WHERE debt_id = ? ORDER BY payment_date DESC`, [debtId]);
  if (payments.length) groups.push({
    key: 'payments', label: `Payments (${payments.length})`, entityType: 'payment',
    rows: payments, total: sumField(payments, 'amount'),
  });

  const comms = safeAll(
    `SELECT id, occurred_at, type, direction, subject, outcome
       FROM debt_communications WHERE debt_id = ? ORDER BY occurred_at DESC LIMIT 100`, [debtId]);
  if (comms.length) groups.push({ key: 'comms', label: `Communications (${comms.length})`, entityType: 'debt', rows: comms });

  const evidence = safeAll(
    `SELECT id, type, label, uploaded_at FROM debt_evidence WHERE debt_id = ? ORDER BY uploaded_at DESC`, [debtId]);
  if (evidence.length) groups.push({ key: 'evidence', label: `Evidence (${evidence.length})`, entityType: 'debt', rows: evidence });

  const contacts = safeAll(
    `SELECT id, name, email, phone, role FROM debt_contacts WHERE debt_id = ?`, [debtId]);
  if (contacts.length) groups.push({ key: 'contacts', label: `Contacts (${contacts.length})`, entityType: 'debt', rows: contacts });

  const invoices = safeAll(
    `SELECT i.id, i.invoice_number, i.total, i.issue_date
       FROM invoices i
       JOIN invoice_debt_links l ON l.invoice_id = i.id
       WHERE l.debt_id = ? AND i.company_id = ?`, [debtId, companyId]);
  if (invoices.length) groups.push({
    key: 'invoices', label: `Linked Invoices (${invoices.length})`, entityType: 'invoice',
    rows: invoices, total: sumField(invoices, 'total'),
  });

  return groups;
}

function vendorGraph(companyId: string, vendorId: string): RelatedGroup[] {
  const groups: RelatedGroup[] = [];
  const bills = safeAll(
    `SELECT id, bill_number, bill_date, due_date, total, status FROM bills
       WHERE company_id = ? AND vendor_id = ? ORDER BY bill_date DESC`, [companyId, vendorId]);
  if (bills.length) groups.push({
    key: 'bills', label: `Bills (${bills.length})`, entityType: 'bill',
    rows: bills, total: sumField(bills, 'total'),
  });

  const pos = safeAll(
    `SELECT id, po_number, order_date, total, status FROM purchase_orders
       WHERE company_id = ? AND vendor_id = ? ORDER BY order_date DESC`, [companyId, vendorId]);
  if (pos.length) groups.push({
    key: 'pos', label: `Purchase Orders (${pos.length})`, entityType: 'purchase_order',
    rows: pos, total: sumField(pos, 'total'),
  });

  const expenses = safeAll(
    `SELECT id, date, amount, description, status FROM expenses
       WHERE company_id = ? AND vendor_id = ? ORDER BY date DESC`, [companyId, vendorId]);
  if (expenses.length) groups.push({
    key: 'expenses', label: `Expenses (${expenses.length})`, entityType: 'expense',
    rows: expenses, total: sumField(expenses, 'amount'),
  });

  return groups;
}

function employeeGraph(companyId: string, employeeId: string): RelatedGroup[] {
  const groups: RelatedGroup[] = [];
  const stubs = safeAll(
    `SELECT ps.id, ps.gross_pay, ps.net_pay, pr.pay_date
       FROM pay_stubs ps JOIN payroll_runs pr ON pr.id = ps.payroll_run_id
       WHERE pr.company_id = ? AND ps.employee_id = ?
       ORDER BY pr.pay_date DESC LIMIT 50`, [companyId, employeeId]);
  if (stubs.length) groups.push({
    key: 'stubs', label: `Pay Stubs (${stubs.length})`, entityType: 'pay_stub',
    rows: stubs, total: sumField(stubs, 'net_pay'),
  });

  const time = safeAll(
    `SELECT id, date, duration_minutes, project_id, description FROM time_entries
       WHERE company_id = ? AND employee_id = ? ORDER BY date DESC LIMIT 100`, [companyId, employeeId]);
  if (time.length) groups.push({ key: 'time', label: `Time Entries (${time.length})`, entityType: 'time_entry', rows: time });

  const exp = safeAll(
    `SELECT id, date, amount, description, reimbursed FROM expenses
       WHERE company_id = ? AND is_reimbursable = 1 AND custom_fields LIKE '%' || ? || '%'
       ORDER BY date DESC LIMIT 100`, [companyId, employeeId]);
  if (exp.length) groups.push({ key: 'exp', label: `Reimbursable Expenses (${exp.length})`, entityType: 'expense', rows: exp });

  return groups;
}

function stripeGraph(companyId: string, objectId: string): RelatedGroup[] {
  const groups: RelatedGroup[] = [];
  const obj = safeOne<{ resource: string; data: string; local_entity_type: string; local_entity_id: string }>(
    `SELECT resource, data, local_entity_type, local_entity_id FROM stripe_cache
       WHERE company_id = ? AND stripe_id = ?`, [companyId, objectId]);
  if (!obj) return groups;

  if (obj.local_entity_type && obj.local_entity_id) {
    // Recurse into the linked local entity so the graph from a Stripe object
    // still shows "the invoice this charge paid, the client it belongs to, etc."
    const local = graph(companyId, obj.local_entity_type as EntityType, obj.local_entity_id);
    groups.push(...local);
  }

  // Same-resource siblings from the same customer (if any)
  try {
    const d = JSON.parse(obj.data);
    if (d?.customer) {
      const siblings = safeAll(
        `SELECT stripe_id, resource, stripe_created FROM stripe_cache
           WHERE company_id = ? AND resource = ? AND json_extract(data,'$.customer') = ?
           ORDER BY stripe_created DESC LIMIT 20`, [companyId, obj.resource, d.customer]);
      if (siblings.length > 1) {
        groups.push({ key: 'siblings', label: `Same customer (${siblings.length - 1})`, entityType: 'stripe_object',
          rows: siblings.filter((s: any) => s.stripe_id !== objectId) });
      }
    }
  } catch {/* ignore */}

  return groups;
}

/**
 * Explicit relation lookup — honors whatever was recorded in entity_relations
 * regardless of schema. Lets callers manually pin arbitrary connections.
 */
function explicitGraph(companyId: string, type: EntityType, id: string): RelatedGroup[] {
  const rel = safeAll<{ to_type: string; to_id: string; relation: string }>(
    `SELECT to_type, to_id, relation FROM entity_relations
       WHERE company_id = ? AND from_type = ? AND from_id = ?`, [companyId, type, id]);
  if (!rel.length) return [];
  // Group by relation name.
  const byRelation = new Map<string, typeof rel>();
  for (const r of rel) {
    if (!byRelation.has(r.relation)) byRelation.set(r.relation, []);
    byRelation.get(r.relation)!.push(r);
  }
  return Array.from(byRelation.entries()).map(([relation, rows]) => ({
    key: `rel:${relation}`, label: `${relation} (${rows.length})`, entityType: rows[0].to_type as EntityType,
    rows,
  }));
}

/** Dispatcher — pick the right graph builder for the entity type. */
export function graph(companyId: string, type: EntityType, id: string): RelatedGroup[] {
  let groups: RelatedGroup[] = [];
  switch (type) {
    case 'client':          groups = clientGraph(companyId, id); break;
    case 'invoice':         groups = invoiceGraph(companyId, id); break;
    case 'bill':            groups = billGraph(companyId, id); break;
    case 'project':         groups = projectGraph(companyId, id); break;
    case 'debt':            groups = debtGraph(companyId, id); break;
    case 'vendor':          groups = vendorGraph(companyId, id); break;
    case 'employee':        groups = employeeGraph(companyId, id); break;
    case 'stripe_object':   groups = stripeGraph(companyId, id); break;
    default:                groups = [];
  }
  return [...groups, ...explicitGraph(companyId, type, id)];
}

// ─── Timeline builder ───────────────────────────────────────────────────

export function timeline(companyId: string, type: string, id: string, limit = 100): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  const audit = safeAll<{ id: string; action: string; changes: string; performed_by: string; timestamp: string }>(
    `SELECT id, action, changes, performed_by, timestamp FROM audit_log
       WHERE company_id = ? AND entity_type = ? AND entity_id = ?
       ORDER BY timestamp DESC LIMIT ?`, [companyId, type, id, limit]);
  for (const a of audit) {
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(a.changes || '{}'); } catch {}
    const real = (parsed._action as string | undefined) ?? a.action;
    events.push({
      id: `audit:${a.id}`, at: a.timestamp, kind: 'audit', action: real,
      title: real.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
      source: a.performed_by, metadata: parsed,
    });
  }

  const emails = safeAll<{ id: string; recipient: string; subject: string; status: string; sent_at: string; error: string }>(
    `SELECT id, recipient, subject, status, sent_at, error FROM email_log
       WHERE company_id = ? AND entity_type = ? AND entity_id = ?
       ORDER BY sent_at DESC LIMIT ?`, [companyId, type, id, limit]);
  for (const e of emails) {
    events.push({
      id: `email:${e.id}`, at: e.sent_at, kind: 'email', action: e.status,
      title: `Email ${e.status}: ${e.subject || '(no subject)'}`,
      detail: e.error || undefined,
      source: e.recipient,
    });
  }

  const notifs = safeAll<{ id: string; title: string; message: string; type: string; created_at: string }>(
    `SELECT id, title, message, type, created_at FROM notifications
       WHERE company_id = ? AND entity_type = ? AND entity_id = ?
       ORDER BY created_at DESC LIMIT ?`, [companyId, type, id, limit]);
  for (const n of notifs) {
    events.push({
      id: `notif:${n.id}`, at: n.created_at, kind: 'notification', action: n.type,
      title: n.title, detail: n.message,
    });
  }

  const docs = safeAll<{ id: string; filename: string; uploaded_at: string; description: string }>(
    `SELECT id, filename, uploaded_at, description FROM documents
       WHERE company_id = ? AND entity_type = ? AND entity_id = ?
       ORDER BY uploaded_at DESC LIMIT ?`, [companyId, type, id, limit]);
  for (const d of docs) {
    events.push({
      id: `doc:${d.id}`, at: d.uploaded_at, kind: 'document', action: 'uploaded',
      title: `Document uploaded: ${d.filename}`,
      detail: d.description || undefined,
    });
  }

  // Sort descending by timestamp.
  events.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  return events.slice(0, limit);
}

// ─── IPC ────────────────────────────────────────────────────────────────

export function registerEntityGraphIpc(ipcMain: IpcMain): void {
  ipcMain.handle('entity:graph', async (_e, args: { companyId: string; type: EntityType; id: string }) => {
    if (!args?.companyId || !args?.type || !args?.id) return [];
    return graph(args.companyId, args.type, args.id);
  });

  ipcMain.handle('entity:timeline', async (_e, args: { companyId: string; type: string; id: string; limit?: number }) => {
    if (!args?.companyId || !args?.type || !args?.id) return [];
    return timeline(args.companyId, args.type, args.id, args.limit ?? 100);
  });

  ipcMain.handle('entity:link', async (_e, args: {
    companyId: string; fromType: string; fromId: string; toType: string; toId: string; relation: string; metadata?: Record<string, unknown>;
  }) => {
    const db = getDb();
    const { randomUUID } = await import('node:crypto');
    try {
      db.prepare(`
        INSERT INTO entity_relations (id, company_id, from_type, from_id, to_type, to_id, relation, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(company_id, from_type, from_id, to_type, to_id, relation) DO UPDATE SET
          metadata = excluded.metadata
      `).run(
        randomUUID(), args.companyId, args.fromType, args.fromId, args.toType, args.toId,
        args.relation, JSON.stringify(args.metadata ?? {}),
      );
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });

  ipcMain.handle('entity:unlink', async (_e, args: {
    companyId: string; fromType: string; fromId: string; toType: string; toId: string; relation: string;
  }) => {
    getDb().prepare(`
      DELETE FROM entity_relations
      WHERE company_id = ? AND from_type = ? AND from_id = ? AND to_type = ? AND to_id = ? AND relation = ?
    `).run(args.companyId, args.fromType, args.fromId, args.toType, args.toId, args.relation);
    return { ok: true };
  });
}
