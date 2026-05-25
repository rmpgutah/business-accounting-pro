// ─── Finance Wave Part 1: F441-F505 (50 features) ───
//
// Batch AB: Invoice Advanced (F441-F455)
// Batch AC: Payment Processing (F456-F470)
// Batch AE: Billing & Subscriptions (F486-F495)
// Batch AF: Credit & Collections (F496-F505)

import { randomUUID as uuid, randomBytes } from 'crypto';
import * as db from '../database';

const now = (): string => new Date().toISOString();
const today = (): string => now().slice(0, 10);
const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}

// ════════════════════════════════════════════════════════════════
// Batch AB: Invoice Advanced (F441-F455)
// ════════════════════════════════════════════════════════════════

// F443 — recurring invoice templates
export function upsertRecurringInvoice(t: any): { id: string } {
  const dbi = db.getDb();
  const id = t.id || uuid();
  if (t.id) {
    dbi.prepare(`UPDATE recurring_invoice_templates SET template_name = ?, client_id = ?, frequency = ?, end_date = ?, next_run_date = ?, line_items_json = ?, notes = ?, payment_terms = ?, auto_send = ?, is_active = ?, updated_at = ? WHERE id = ?`)
      .run(t.template_name, t.client_id, t.frequency, t.end_date, t.next_run_date, JSON.stringify(t.line_items || []), t.notes, t.payment_terms, t.auto_send ? 1 : 0, t.is_active === false ? 0 : 1, now(), t.id);
  } else {
    dbi.prepare(`INSERT INTO recurring_invoice_templates (id, company_id, template_name, client_id, frequency, start_date, end_date, next_run_date, line_items_json, notes, payment_terms, is_active, auto_send, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`)
      .run(id, t.company_id, t.template_name, t.client_id, t.frequency || 'monthly', t.start_date, t.end_date, t.next_run_date || t.start_date, JSON.stringify(t.line_items || []), t.notes, t.payment_terms, t.auto_send ? 1 : 0, now(), now());
  }
  return { id };
}

export function listRecurringInvoices(companyId: string, activeOnly: boolean = false): any[] {
  const dbi = db.getDb();
  let where = 'company_id = ?';
  if (activeOnly) where += ' AND is_active = 1';
  return dbi.prepare(`SELECT * FROM recurring_invoice_templates WHERE ${where} ORDER BY next_run_date`).all(companyId) as any[];
}

export function dueRecurringInvoices(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM recurring_invoice_templates WHERE company_id = ? AND is_active = 1 AND next_run_date <= date('now') AND (end_date IS NULL OR end_date >= date('now'))`).all(companyId) as any[];
}

export function advanceRecurringInvoice(id: string, generatedInvoiceId?: string): { next_run_date: string } {
  const dbi = db.getDb();
  const r = dbi.prepare(`SELECT * FROM recurring_invoice_templates WHERE id = ?`).get(id) as any;
  if (!r) throw new Error('Template not found');
  let next = r.next_run_date;
  if (r.frequency === 'weekly') next = addDays(next, 7);
  else if (r.frequency === 'biweekly') next = addDays(next, 14);
  else if (r.frequency === 'monthly') next = addMonths(next, 1);
  else if (r.frequency === 'quarterly') next = addMonths(next, 3);
  else if (r.frequency === 'annual') next = addMonths(next, 12);
  dbi.prepare(`UPDATE recurring_invoice_templates SET last_run_date = ?, next_run_date = ?, run_count = run_count + 1, last_invoice_id = ?, updated_at = ? WHERE id = ?`)
    .run(today(), next, generatedInvoiceId, now(), id);
  return { next_run_date: next };
}

// F444 — invoice approval workflow
export function logInvoiceApproval(opts: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO invoice_approval_steps (id, invoice_id, step_number, approver_user_id, action, acted_at, comment, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, opts.invoice_id, opts.step_number || 1, opts.approver_user_id, opts.action, opts.action ? now() : null, opts.comment, now());
  return { id };
}

export function listInvoiceApprovals(invoiceId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM invoice_approval_steps WHERE invoice_id = ? ORDER BY step_number, acted_at`).all(invoiceId) as any[];
}

// F445-F446 — invoice email + tracking
export function logInvoiceEmail(e: any): { id: string; tracking_pixel_id: string } {
  const id = uuid();
  const pixelId = randomBytes(8).toString('hex');
  db.getDb().prepare(`INSERT INTO invoice_email_log (id, invoice_id, recipient_email, subject, sent_at, sent_by, tracking_pixel_id, delivery_status) VALUES (?, ?, ?, ?, ?, ?, ?, 'sent')`)
    .run(id, e.invoice_id, e.recipient_email, e.subject, now(), e.sent_by, pixelId);
  return { id, tracking_pixel_id: pixelId };
}

export function recordEmailOpen(trackingPixelId: string): boolean {
  const r = db.getDb().prepare(`UPDATE invoice_email_log SET opened_at = COALESCE(opened_at, ?), opened_count = opened_count + 1 WHERE tracking_pixel_id = ?`).run(now(), trackingPixelId);
  return r.changes > 0;
}

export function recordEmailClick(trackingPixelId: string): boolean {
  const r = db.getDb().prepare(`UPDATE invoice_email_log SET clicked_at = COALESCE(clicked_at, ?) WHERE tracking_pixel_id = ?`).run(now(), trackingPixelId);
  return r.changes > 0;
}

// F447 — late fee policies + auto-add
export function upsertLateFeePolicy(p: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO late_fee_policies (id, company_id, policy_name, fee_type, percent_rate, flat_amount, grace_period_days, compound, apply_frequency, max_fees_count, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
    .run(id, p.company_id, p.policy_name, p.fee_type || 'percent', p.percent_rate || 0, p.flat_amount || 0, p.grace_period_days || 0, p.compound ? 1 : 0, p.apply_frequency || 'monthly', p.max_fees_count || 12, now());
  return { id };
}

export function calcLateFee(opts: { invoice_balance: number; days_overdue: number; policy_id: string }): number {
  const p = db.getDb().prepare(`SELECT * FROM late_fee_policies WHERE id = ? AND is_active = 1`).get(opts.policy_id) as any;
  if (!p || opts.days_overdue <= (p.grace_period_days || 0)) return 0;
  const periodsLate = p.apply_frequency === 'monthly' ? Math.floor((opts.days_overdue - p.grace_period_days) / 30) + 1 : 1;
  const cappedPeriods = Math.min(periodsLate, p.max_fees_count || 12);
  if (p.fee_type === 'flat') return round2(p.flat_amount * cappedPeriods);
  // Percent
  let total = 0;
  let balance = opts.invoice_balance;
  for (let i = 0; i < cappedPeriods; i++) {
    const fee = balance * (p.percent_rate || 0) / 100;
    total += fee;
    if (p.compound) balance += fee;
  }
  return round2(total);
}

// F448 — payment terms
export function upsertPaymentTerms(t: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO payment_terms (id, company_id, terms_name, net_days, discount_percent, discount_days, description, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, t.company_id, t.terms_name, t.net_days || 30, t.discount_percent || 0, t.discount_days || 0, t.description, t.is_default ? 1 : 0, now());
  return { id };
}

export function listPaymentTerms(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM payment_terms WHERE company_id = ? ORDER BY is_default DESC, net_days`).all(companyId) as any[];
}

export function calcEarlyPaymentDiscount(invoiceId: string, paymentDate: string): { eligible: boolean; discount_amount: number; reason?: string } {
  const dbi = db.getDb();
  const inv = dbi.prepare(`SELECT i.*, pt.discount_percent, pt.discount_days FROM invoices i LEFT JOIN payment_terms pt ON pt.id = i.payment_terms_id WHERE i.id = ?`).get(invoiceId) as any;
  if (!inv || !inv.discount_percent || !inv.discount_days) return { eligible: false, discount_amount: 0, reason: 'No early payment discount on this invoice' };
  const issueDate = inv.issue_date;
  const cutoff = addDays(issueDate, inv.discount_days);
  if (paymentDate > cutoff) return { eligible: false, discount_amount: 0, reason: `Discount window expired on ${cutoff}` };
  return { eligible: true, discount_amount: round2((inv.balance || inv.total || 0) * inv.discount_percent / 100) };
}

// F450 — progress billing
export function createProgressBilling(p: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO progress_billing_schedules (id, company_id, project_id, contract_total, billed_to_date, remaining_to_bill, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, 'active', ?, ?, ?)`)
    .run(id, p.company_id, p.project_id, p.contract_total || 0, p.contract_total || 0, p.notes, now(), now());
  return { id };
}

export function releaseProgressBilling(scheduleId: string, opts: { percent_complete: number; invoice_id?: string; notes?: string }): { id: string; amount_to_bill: number } {
  const dbi = db.getDb();
  const s = dbi.prepare(`SELECT * FROM progress_billing_schedules WHERE id = ?`).get(scheduleId) as any;
  if (!s) throw new Error('Schedule not found');
  const totalSoFar = round2(s.contract_total * opts.percent_complete / 100);
  const amount = round2(totalSoFar - (s.billed_to_date || 0));
  if (amount <= 0) throw new Error(`Already billed to ${(s.billed_to_date / s.contract_total * 100).toFixed(1)}% — cannot bill backwards`);
  const id = uuid();
  dbi.prepare(`INSERT INTO progress_billing_releases (id, schedule_id, release_date, percent_complete, amount_to_bill, invoice_id, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, scheduleId, today(), opts.percent_complete, amount, opts.invoice_id, opts.notes, now());
  dbi.prepare(`UPDATE progress_billing_schedules SET billed_to_date = billed_to_date + ?, remaining_to_bill = remaining_to_bill - ?, updated_at = ? WHERE id = ?`).run(amount, amount, now(), scheduleId);
  return { id, amount_to_bill: amount };
}

export function listProgressBilling(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM progress_billing_schedules WHERE company_id = ? ORDER BY created_at DESC`).all(companyId) as any[];
}

// F451 — retainers
export function createRetainer(r: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO retainers (id, company_id, client_id, retainer_name, initial_amount, current_balance, minimum_balance, auto_refill, refill_amount, start_date, end_date, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`)
    .run(id, r.company_id, r.client_id, r.retainer_name, r.initial_amount || 0, r.initial_amount || 0, r.minimum_balance || 0, r.auto_refill ? 1 : 0, r.refill_amount || 0, r.start_date, r.end_date, r.notes, now(), now());
  return { id };
}

export function drawdownRetainer(retainerId: string, amount: number, reason?: string, invoiceId?: string): { balance: number; needs_refill: boolean } {
  const dbi = db.getDb();
  const r = dbi.prepare(`SELECT * FROM retainers WHERE id = ?`).get(retainerId) as any;
  if (!r) throw new Error('Retainer not found');
  if (r.current_balance < amount) throw new Error(`Insufficient balance: ${r.current_balance} < ${amount}`);
  dbi.prepare(`INSERT INTO retainer_drawdowns (id, retainer_id, drawdown_date, amount, reason, invoice_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(uuid(), retainerId, today(), amount, reason, invoiceId, now());
  const newBalance = round2(r.current_balance - amount);
  dbi.prepare(`UPDATE retainers SET current_balance = ?, updated_at = ? WHERE id = ?`).run(newBalance, now(), retainerId);
  return { balance: newBalance, needs_refill: !!(r.auto_refill && newBalance < r.minimum_balance) };
}

export function listRetainers(companyId: string, opts?: { client_id?: string; status?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.client_id) { where += ' AND client_id = ?'; params.push(opts.client_id); }
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  return dbi.prepare(`SELECT * FROM retainers WHERE ${where}`).all(...params) as any[];
}

// F454 — invoice payment plans
export function createPaymentPlan(p: any): { id: string; installments: any[] } {
  const dbi = db.getDb();
  const id = uuid();
  const installmentAmount = round2(p.total_amount / p.installment_count);
  dbi.prepare(`INSERT INTO invoice_payment_plans (id, invoice_id, company_id, plan_name, total_amount, installment_count, installment_amount, frequency, start_date, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
    .run(id, p.invoice_id, p.company_id, p.plan_name, p.total_amount, p.installment_count, installmentAmount, p.frequency || 'monthly', p.start_date, now(), now());
  // Generate installment rows
  const installments: any[] = [];
  let dueDate = p.start_date;
  for (let i = 1; i <= p.installment_count; i++) {
    const instId = uuid();
    // Last installment picks up rounding remainder
    const amt = i === p.installment_count ? round2(p.total_amount - installmentAmount * (p.installment_count - 1)) : installmentAmount;
    dbi.prepare(`INSERT INTO invoice_payment_plan_installments (id, plan_id, installment_number, due_date, amount, status) VALUES (?, ?, ?, ?, ?, 'pending')`).run(instId, id, i, dueDate, amt);
    installments.push({ id: instId, installment_number: i, due_date: dueDate, amount: amt });
    if (p.frequency === 'weekly') dueDate = addDays(dueDate, 7);
    else if (p.frequency === 'biweekly') dueDate = addDays(dueDate, 14);
    else dueDate = addMonths(dueDate, 1);
  }
  return { id, installments };
}

export function payInstallment(installmentId: string, amount: number): boolean {
  const r = db.getDb().prepare(`UPDATE invoice_payment_plan_installments SET paid_amount = paid_amount + ?, paid_at = COALESCE(paid_at, ?), status = CASE WHEN paid_amount + ? >= amount THEN 'paid' ELSE 'partial' END WHERE id = ?`).run(amount, now(), amount, installmentId);
  return r.changes > 0;
}

export function listPaymentPlans(companyId: string, opts?: { invoice_id?: string; status?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.invoice_id) { where += ' AND invoice_id = ?'; params.push(opts.invoice_id); }
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  return dbi.prepare(`SELECT * FROM invoice_payment_plans WHERE ${where}`).all(...params) as any[];
}

// F455 — invoice attachments
export function addInvoiceAttachment(a: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO invoice_attachments (id, invoice_id, file_name, file_path, file_size, mime_type, uploaded_at, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, a.invoice_id, a.file_name, a.file_path, a.file_size || 0, a.mime_type, now(), a.uploaded_by);
  return { id };
}

export function listInvoiceAttachments(invoiceId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM invoice_attachments WHERE invoice_id = ? ORDER BY uploaded_at DESC`).all(invoiceId) as any[];
}

// ════════════════════════════════════════════════════════════════
// Batch AC: Payment Processing (F456-F470)
// ════════════════════════════════════════════════════════════════

// F458 — payment links
export function createPaymentLink(opts: any): { id: string; link_url: string; short_code: string } {
  const id = uuid();
  const shortCode = randomBytes(6).toString('base64url');
  const url = `${opts.base_url || 'https://pay.bap.local'}/${shortCode}`;
  db.getDb().prepare(`INSERT INTO payment_links (id, company_id, invoice_id, link_url, short_code, amount, expires_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`)
    .run(id, opts.company_id, opts.invoice_id, url, shortCode, opts.amount || 0, opts.expires_at, now());
  return { id, link_url: url, short_code: shortCode };
}

export function consumePaymentLink(shortCode: string, amount?: number): { ok: boolean; invoice_id?: string; reason?: string } {
  const dbi = db.getDb();
  const link = dbi.prepare(`SELECT * FROM payment_links WHERE short_code = ?`).get(shortCode) as any;
  if (!link) return { ok: false, reason: 'Link not found' };
  if (link.status !== 'active') return { ok: false, reason: 'Link already used or revoked' };
  if (link.expires_at && link.expires_at < now()) return { ok: false, reason: 'Link expired' };
  dbi.prepare(`UPDATE payment_links SET used_at = ?, used_amount = ?, status = 'used', click_count = click_count + 1 WHERE id = ?`).run(now(), amount || link.amount, link.id);
  return { ok: true, invoice_id: link.invoice_id };
}

// F459 — reminder cadences
export function upsertReminderCadence(c: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO reminder_cadences (id, company_id, cadence_name, days_offsets, template_id, is_default, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)`)
    .run(id, c.company_id, c.cadence_name, (c.days_offsets || []).join(','), c.template_id, c.is_default ? 1 : 0, now());
  return { id };
}

export function listReminderCadences(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM reminder_cadences WHERE company_id = ? AND is_active = 1`).all(companyId) as any[];
}

// F461 — payment retry with exponential backoff
export function recordPaymentRetry(opts: any): { id: string; next_attempt_at: string; final: boolean } {
  const dbi = db.getDb();
  const existing = dbi.prepare(`SELECT MAX(attempt_number) AS n FROM payment_retry_attempts WHERE invoice_id = ?`).get(opts.invoice_id) as any;
  const attempt = (existing?.n || 0) + 1;
  // Schedule: day 1, 3, 7, 14, then give up
  const schedule = [1, 3, 7, 14];
  const final = attempt > schedule.length;
  const nextAttempt = final ? '' : addDays(today(), schedule[attempt - 1] || 14);
  const id = uuid();
  dbi.prepare(`INSERT INTO payment_retry_attempts (id, company_id, invoice_id, payment_method_id, attempt_number, attempted_at, next_attempt_at, failure_code, failure_message, final_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, opts.company_id, opts.invoice_id, opts.payment_method_id, attempt, now(), final ? null : nextAttempt, opts.failure_code, opts.failure_message, final ? 'gave_up' : 'pending');
  return { id, next_attempt_at: nextAttempt, final };
}

// F462 — partial payment application
export function applyPartialPayment(invoiceId: string, amount: number): { remaining_balance: number; status: string } {
  const dbi = db.getDb();
  const inv = dbi.prepare(`SELECT total, balance FROM invoices WHERE id = ?`).get(invoiceId) as any;
  if (!inv) throw new Error('Invoice not found');
  const newBalance = round2((inv.balance || inv.total) - amount);
  const newStatus = newBalance <= 0 ? 'paid' : 'partial';
  dbi.prepare(`UPDATE invoices SET balance = ?, status = ?, updated_at = ? WHERE id = ?`).run(Math.max(0, newBalance), newStatus, now(), invoiceId);
  return { remaining_balance: Math.max(0, newBalance), status: newStatus };
}

// F463 — customer credit balance
export function addCustomerCredit(opts: { company_id: string; customer_id: string; amount: number; source_invoice_id?: string; notes?: string }): { id: string; new_balance: number } {
  const dbi = db.getDb();
  // Insert transaction
  dbi.prepare(`INSERT INTO customer_credit_transactions (id, company_id, customer_id, transaction_type, amount, source_invoice_id, notes, transaction_at) VALUES (?, ?, ?, 'credit', ?, ?, ?, ?)`)
    .run(uuid(), opts.company_id, opts.customer_id, opts.amount, opts.source_invoice_id, opts.notes, now());
  // Upsert balance
  const id = uuid();
  dbi.prepare(`INSERT INTO customer_credit_balances (id, company_id, customer_id, balance, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(customer_id) DO UPDATE SET balance = balance + excluded.balance, updated_at = excluded.updated_at`)
    .run(id, opts.company_id, opts.customer_id, opts.amount, now());
  const r = dbi.prepare(`SELECT balance FROM customer_credit_balances WHERE customer_id = ?`).get(opts.customer_id) as any;
  return { id, new_balance: r?.balance || 0 };
}

export function applyCustomerCredit(opts: { company_id: string; customer_id: string; invoice_id: string; amount: number }): { applied_amount: number; remaining_credit: number; remaining_invoice_balance: number } {
  const dbi = db.getDb();
  const bal = dbi.prepare(`SELECT balance FROM customer_credit_balances WHERE customer_id = ?`).get(opts.customer_id) as any;
  if (!bal || bal.balance <= 0) return { applied_amount: 0, remaining_credit: 0, remaining_invoice_balance: 0 };
  const applied = Math.min(opts.amount, bal.balance);
  dbi.prepare(`INSERT INTO customer_credit_transactions (id, company_id, customer_id, transaction_type, amount, applied_to_invoice_id, transaction_at) VALUES (?, ?, ?, 'apply', ?, ?, ?)`)
    .run(uuid(), opts.company_id, opts.customer_id, -applied, opts.invoice_id, now());
  dbi.prepare(`UPDATE customer_credit_balances SET balance = balance - ?, last_applied_at = ?, updated_at = ? WHERE customer_id = ?`).run(applied, now(), now(), opts.customer_id);
  const result = applyPartialPayment(opts.invoice_id, applied);
  return { applied_amount: applied, remaining_credit: round2(bal.balance - applied), remaining_invoice_balance: result.remaining_balance };
}

export function getCustomerCredit(customerId: string): number {
  const r = db.getDb().prepare(`SELECT balance FROM customer_credit_balances WHERE customer_id = ?`).get(customerId) as any;
  return r?.balance || 0;
}

// F464 — refunds
export function recordRefund(r: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO refunds (id, company_id, invoice_id, payment_id, refund_amount, refund_method, reason, refunded_at, refunded_by, external_refund_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')`)
    .run(id, r.company_id, r.invoice_id, r.payment_id, r.refund_amount || 0, r.refund_method, r.reason, now(), r.refunded_by, r.external_refund_id);
  return { id };
}

export function listRefunds(companyId: string, opts?: { invoice_id?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.invoice_id) { where += ' AND invoice_id = ?'; params.push(opts.invoice_id); }
  return dbi.prepare(`SELECT * FROM refunds WHERE ${where} ORDER BY refunded_at DESC`).all(...params) as any[];
}

// F465 — chargebacks
export function recordChargeback(c: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO chargebacks (id, company_id, invoice_id, payment_id, amount, chargeback_date, reason_code, status, fee, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'disputed', ?, ?, ?)`)
    .run(id, c.company_id, c.invoice_id, c.payment_id, c.amount || 0, c.chargeback_date || today(), c.reason_code, c.fee || 0, c.notes, now());
  return { id };
}

export function resolveChargeback(id: string, resolution: 'won' | 'lost', resolvedAt?: string): boolean {
  const r = db.getDb().prepare(`UPDATE chargebacks SET status = ?, resolution = ?, resolved_at = ? WHERE id = ?`).run(resolution, resolution, resolvedAt || now(), id);
  return r.changes > 0;
}

// F466 — customer payment methods
export function addCustomerPaymentMethod(m: any): { id: string } {
  const dbi = db.getDb();
  const id = uuid();
  if (m.is_default) dbi.prepare(`UPDATE customer_payment_methods SET is_default = 0 WHERE customer_id = ?`).run(m.customer_id);
  dbi.prepare(`INSERT INTO customer_payment_methods (id, company_id, customer_id, method_type, nickname, last4, brand, is_default, expires_month, expires_year, external_token, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
    .run(id, m.company_id, m.customer_id, m.method_type, m.nickname, m.last4, m.brand, m.is_default ? 1 : 0, m.expires_month, m.expires_year, m.external_token, now());
  return { id };
}

export function listCustomerPaymentMethods(customerId: string): any[] {
  return db.getDb().prepare(`SELECT id, company_id, customer_id, method_type, nickname, last4, brand, is_default, expires_month, expires_year, is_active, created_at FROM customer_payment_methods WHERE customer_id = ? AND is_active = 1 ORDER BY is_default DESC`).all(customerId) as any[];
}

// F468 — check printing
export function recordCheckPrintJob(j: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO check_print_jobs (id, company_id, bank_account_id, check_number_start, check_number_end, check_count, total_amount, pdf_path, printed_at, printed_by, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'printed')`)
    .run(id, j.company_id, j.bank_account_id, j.check_number_start, j.check_number_end, j.check_count || 0, j.total_amount || 0, j.pdf_path, now(), j.printed_by);
  return { id };
}

export function listCheckPrintJobs(companyId: string, limit: number = 50): any[] {
  return db.getDb().prepare(`SELECT * FROM check_print_jobs WHERE company_id = ? ORDER BY printed_at DESC LIMIT ?`).all(companyId, limit) as any[];
}

// F470 — crypto payments
export function recordCryptoPayment(p: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO crypto_payments (id, company_id, invoice_id, currency, amount_crypto, amount_usd_at_time, wallet_address, tx_hash, confirmations, status, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, p.company_id, p.invoice_id, p.currency, p.amount_crypto || 0, p.amount_usd_at_time || 0, p.wallet_address, p.tx_hash, p.confirmations || 0, p.status || 'pending', now());
  return { id };
}

// ════════════════════════════════════════════════════════════════
// Batch AE: Billing & Subscriptions (F486-F495)
// ════════════════════════════════════════════════════════════════

// F486 — subscription plans
export function upsertSubscriptionPlan(p: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO subscription_plans (id, company_id, plan_name, description, base_price, billing_frequency, trial_days, is_active, features_json, tier, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`)
    .run(id, p.company_id, p.plan_name, p.description, p.base_price || 0, p.billing_frequency || 'monthly', p.trial_days || 0, JSON.stringify(p.features || []), p.tier || 1, now());
  return { id };
}

export function listSubscriptionPlans(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM subscription_plans WHERE company_id = ? AND is_active = 1 ORDER BY tier`).all(companyId) as any[];
}

// F487 — auto-renewal management
export function createSubscription(s: any): { id: string; trial_end_date: string | null } {
  const dbi = db.getDb();
  const id = uuid();
  const plan = dbi.prepare(`SELECT * FROM subscription_plans WHERE id = ?`).get(s.plan_id) as any;
  if (!plan) throw new Error('Plan not found');
  const startDate = s.start_date || today();
  const trialEnd = (plan.trial_days || 0) > 0 ? addDays(startDate, plan.trial_days) : null;
  const periodStart = trialEnd || startDate;
  const periodEnd = plan.billing_frequency === 'monthly' ? addMonths(periodStart, 1) : addMonths(periodStart, 12);
  dbi.prepare(`INSERT INTO subscriptions (id, company_id, customer_id, plan_id, status, start_date, trial_end_date, current_period_start, current_period_end, next_renewal_date, quantity, custom_price, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, s.company_id, s.customer_id, s.plan_id, trialEnd ? 'trial' : 'active', startDate, trialEnd, periodStart, periodEnd, periodEnd, s.quantity || 1, s.custom_price, s.notes, now(), now());
  return { id, trial_end_date: trialEnd };
}

// F488 — proration on plan change
export function changePlanWithProration(subscriptionId: string, newPlanId: string): { proration_amount: number; new_period_end: string } {
  const dbi = db.getDb();
  const sub = dbi.prepare(`SELECT s.*, p.base_price AS old_price, p.billing_frequency FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id WHERE s.id = ?`).get(subscriptionId) as any;
  const newPlan = dbi.prepare(`SELECT * FROM subscription_plans WHERE id = ?`).get(newPlanId) as any;
  if (!sub || !newPlan) throw new Error('Subscription or plan not found');
  const totalDays = sub.billing_frequency === 'monthly' ? 30 : 365;
  const today_ts = Date.now();
  const periodEnd_ts = new Date(sub.current_period_end + 'T12:00:00').getTime();
  const daysRemaining = Math.max(0, Math.round((periodEnd_ts - today_ts) / 86400000));
  const oldDailyRate = sub.old_price / totalDays;
  const newDailyRate = newPlan.base_price / totalDays;
  const proration = round2((newDailyRate - oldDailyRate) * daysRemaining);
  const eventId = uuid();
  dbi.prepare(`INSERT INTO subscription_proration_events (id, subscription_id, event_type, old_plan_id, new_plan_id, proration_amount, days_remaining, event_date) VALUES (?, ?, 'plan_change', ?, ?, ?, ?, ?)`)
    .run(eventId, subscriptionId, sub.plan_id, newPlanId, proration, daysRemaining, now());
  dbi.prepare(`UPDATE subscriptions SET plan_id = ?, updated_at = ? WHERE id = ?`).run(newPlanId, now(), subscriptionId);
  return { proration_amount: proration, new_period_end: sub.current_period_end };
}

// F491 — pause/resume
export function pauseSubscription(id: string, resumeDate?: string): boolean {
  const r = db.getDb().prepare(`UPDATE subscriptions SET status = 'paused', paused_at = ?, resume_at = ?, updated_at = ? WHERE id = ?`).run(now(), resumeDate, now(), id);
  return r.changes > 0;
}

export function resumeSubscription(id: string): boolean {
  const r = db.getDb().prepare(`UPDATE subscriptions SET status = 'active', paused_at = NULL, resume_at = NULL, updated_at = ? WHERE id = ?`).run(now(), id);
  return r.changes > 0;
}

export function cancelSubscription(id: string, atPeriodEnd: boolean = false): boolean {
  const r = db.getDb().prepare(`UPDATE subscriptions SET status = ?, canceled_at = ?, cancel_at_period_end = ?, updated_at = ? WHERE id = ?`).run(atPeriodEnd ? 'active' : 'canceled', now(), atPeriodEnd ? 1 : 0, now(), id);
  return r.changes > 0;
}

// F492 — usage-based billing
export function recordUsage(u: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO usage_records (id, company_id, subscription_id, customer_id, metric_name, quantity, recorded_at, billed) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`)
    .run(id, u.company_id, u.subscription_id, u.customer_id, u.metric_name, u.quantity || 0, now());
  return { id };
}

export function listUsage(companyId: string, opts?: { subscription_id?: string; billed_only?: boolean; from?: string; to?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.subscription_id) { where += ' AND subscription_id = ?'; params.push(opts.subscription_id); }
  if (opts?.billed_only !== undefined) { where += ' AND billed = ?'; params.push(opts.billed_only ? 1 : 0); }
  if (opts?.from) { where += ' AND recorded_at >= ?'; params.push(opts.from); }
  if (opts?.to) { where += ' AND recorded_at <= ?'; params.push(opts.to); }
  return dbi.prepare(`SELECT * FROM usage_records WHERE ${where} ORDER BY recorded_at DESC`).all(...params) as any[];
}

// F493 — tiered pricing
export function upsertPricingTier(t: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO pricing_tiers (id, company_id, plan_id, tier_min, tier_max, unit_price, flat_fee, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, t.company_id, t.plan_id, t.tier_min || 0, t.tier_max, t.unit_price || 0, t.flat_fee || 0, t.sort_order || 0);
  return { id };
}

export function calcTieredCharge(planId: string, quantity: number): { total: number; tier_breakdown: any[] } {
  const tiers = db.getDb().prepare(`SELECT * FROM pricing_tiers WHERE plan_id = ? ORDER BY sort_order, tier_min`).all(planId) as any[];
  let total = 0;
  let remaining = quantity;
  const breakdown: any[] = [];
  for (const t of tiers) {
    if (remaining <= 0) break;
    const tierSize = t.tier_max ? (t.tier_max - t.tier_min) : remaining;
    const qtyInTier = Math.min(remaining, tierSize);
    const charge = round2(qtyInTier * t.unit_price + (t.flat_fee || 0));
    breakdown.push({ tier_min: t.tier_min, tier_max: t.tier_max, qty: qtyInTier, charge });
    total += charge;
    remaining -= qtyInTier;
  }
  return { total: round2(total), tier_breakdown: breakdown };
}

// F494 — MRR/ARR
export function calculateMRR(companyId: string, snapshotDate?: string): { id: string; mrr: number; arr: number; customer_count: number } {
  const dbi = db.getDb();
  const date = snapshotDate || today();
  const subs = dbi.prepare(`SELECT s.*, p.base_price, p.billing_frequency FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id WHERE s.company_id = ? AND s.status IN ('active','trial')`).all(companyId) as any[];
  let mrr = 0;
  const customers = new Set<string>();
  for (const s of subs) {
    const price = s.custom_price ?? s.base_price ?? 0;
    const monthly = s.billing_frequency === 'monthly' ? price : price / 12;
    mrr += monthly * (s.quantity || 1) * (1 - (s.discount_percent || 0) / 100);
    customers.add(s.customer_id);
  }
  const arr = mrr * 12;
  const id = uuid();
  dbi.prepare(`INSERT INTO mrr_arr_snapshots (id, company_id, snapshot_date, mrr, arr, customer_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(company_id, snapshot_date) DO UPDATE SET mrr = excluded.mrr, arr = excluded.arr, customer_count = excluded.customer_count`)
    .run(id, companyId, date, round2(mrr), round2(arr), customers.size, now());
  return { id, mrr: round2(mrr), arr: round2(arr), customer_count: customers.size };
}

// F495 — churn
export function calculateChurn(companyId: string, periodStart: string, periodEnd: string): { customers_lost: number; mrr_lost: number; churn_rate: number } {
  const dbi = db.getDb();
  const startSubs = dbi.prepare(`SELECT COUNT(DISTINCT customer_id) AS n FROM subscriptions WHERE company_id = ? AND start_date <= ? AND (canceled_at IS NULL OR canceled_at >= ?)`).get(companyId, periodStart, periodStart) as any;
  const lost = dbi.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(custom_price), 0) AS mrr FROM subscriptions s WHERE s.company_id = ? AND s.canceled_at BETWEEN ? AND ?`).get(companyId, periodStart, periodEnd) as any;
  const churnRate = startSubs.n > 0 ? (lost.n / startSubs.n) * 100 : 0;
  return { customers_lost: lost.n || 0, mrr_lost: round2(lost.mrr || 0), churn_rate: round2(churnRate) };
}

// ════════════════════════════════════════════════════════════════
// Batch AF: Credit & Collections (F496-F505)
// ════════════════════════════════════════════════════════════════

// F496 — credit limit
export function setCreditLimit(customerId: string, limit: number): boolean {
  const r = db.getDb().prepare(`UPDATE clients SET credit_limit = ?, updated_at = ? WHERE id = ?`).run(limit, now(), customerId);
  return r.changes > 0;
}

export function checkCreditLimit(customerId: string, additionalCharge: number = 0): { within_limit: boolean; current_balance: number; credit_limit: number; available: number } {
  const dbi = db.getDb();
  const c = dbi.prepare(`SELECT credit_limit, credit_hold FROM clients WHERE id = ?`).get(customerId) as any;
  if (!c) throw new Error('Customer not found');
  const open = dbi.prepare(`SELECT COALESCE(SUM(balance), 0) AS t FROM invoices WHERE client_id = ? AND status NOT IN ('paid','void','cancelled') AND (deleted_at IS NULL OR deleted_at = '')`).get(customerId) as any;
  const currentBalance = open.t || 0;
  const totalAfter = currentBalance + additionalCharge;
  const limit = c.credit_limit || Infinity;
  return { within_limit: !c.credit_hold && totalAfter <= limit, current_balance: round2(currentBalance), credit_limit: limit, available: round2(limit - currentBalance) };
}

// F497 — credit hold
export function setCreditHold(customerId: string, hold: boolean, reason?: string): boolean {
  const r = db.getDb().prepare(`UPDATE clients SET credit_hold = ?, credit_hold_reason = ?, updated_at = ? WHERE id = ?`).run(hold ? 1 : 0, reason, now(), customerId);
  return r.changes > 0;
}

// F498 — aging buckets
export function calcAgingBuckets(companyId: string, asOfDate?: string): { bucket_0_30: number; bucket_31_60: number; bucket_61_90: number; bucket_90_plus: number; total: number; by_customer: any[] } {
  const dbi = db.getDb();
  const date = asOfDate || today();
  const rows = dbi.prepare(`
    SELECT i.client_id, c.name AS client_name, i.id AS invoice_id, i.invoice_number, i.balance, i.due_date,
      CAST(julianday(?) - julianday(i.due_date) AS INTEGER) AS days_overdue
    FROM invoices i LEFT JOIN clients c ON c.id = i.client_id
    WHERE i.company_id = ? AND i.status NOT IN ('paid','void','cancelled')
      AND (i.deleted_at IS NULL OR i.deleted_at = '') AND i.balance > 0
  `).all(date, companyId) as any[];

  const buckets = { '0_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0 };
  const byCustomer = new Map<string, any>();
  for (const r of rows) {
    const days = r.days_overdue || 0;
    let bucket: keyof typeof buckets;
    if (days < 31) bucket = '0_30';
    else if (days < 61) bucket = '31_60';
    else if (days < 91) bucket = '61_90';
    else bucket = '90_plus';
    buckets[bucket] += r.balance || 0;
    if (!byCustomer.has(r.client_id)) byCustomer.set(r.client_id, { client_id: r.client_id, client_name: r.client_name, '0_30': 0, '31_60': 0, '61_90': 0, '90_plus': 0, total: 0 });
    const c = byCustomer.get(r.client_id)!;
    c[bucket] += r.balance || 0;
    c.total += r.balance || 0;
  }
  const total = buckets['0_30'] + buckets['31_60'] + buckets['61_90'] + buckets['90_plus'];
  return {
    bucket_0_30: round2(buckets['0_30']),
    bucket_31_60: round2(buckets['31_60']),
    bucket_61_90: round2(buckets['61_90']),
    bucket_90_plus: round2(buckets['90_plus']),
    total: round2(total),
    by_customer: Array.from(byCustomer.values()).sort((a, b) => b.total - a.total),
  };
}

// F499 — customer statements
export function generateStatement(opts: { company_id: string; customer_id: string; period_start: string; period_end: string }): { id: string; closing_balance: number } {
  const dbi = db.getDb();
  const opening = dbi.prepare(`SELECT COALESCE(SUM(balance), 0) AS b FROM invoices WHERE client_id = ? AND issue_date < ? AND status NOT IN ('void','cancelled') AND (deleted_at IS NULL OR deleted_at = '')`).get(opts.customer_id, opts.period_start) as any;
  const invsT = dbi.prepare(`SELECT COALESCE(SUM(total), 0) AS t FROM invoices WHERE client_id = ? AND issue_date BETWEEN ? AND ? AND status NOT IN ('void','cancelled') AND (deleted_at IS NULL OR deleted_at = '')`).get(opts.customer_id, opts.period_start, opts.period_end) as any;
  const paysT = dbi.prepare(`SELECT COALESCE(SUM(p.amount), 0) AS t FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.client_id = ? AND p.payment_date BETWEEN ? AND ?`).get(opts.customer_id, opts.period_start, opts.period_end) as any;
  const closing = round2((opening.b || 0) + (invsT.t || 0) - (paysT.t || 0));
  const id = uuid();
  dbi.prepare(`INSERT INTO customer_statements (id, company_id, customer_id, statement_date, period_start, period_end, opening_balance, invoices_total, payments_total, closing_balance, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, opts.company_id, opts.customer_id, today(), opts.period_start, opts.period_end, opening.b, invsT.t, paysT.t, closing, now());
  return { id, closing_balance: closing };
}

// F501 — dunning sequences
export function createDunningSequence(s: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO dunning_sequences (id, company_id, sequence_name, steps_json, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)`)
    .run(id, s.company_id, s.sequence_name, JSON.stringify(s.steps || []), now());
  return { id };
}

export function logDunningEvent(opts: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO dunning_events (id, company_id, invoice_id, sequence_id, step_number, sent_at, method, template_used) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, opts.company_id, opts.invoice_id, opts.sequence_id, opts.step_number || 1, now(), opts.method || 'email', opts.template_used);
  return { id };
}

// F502 — bad debt writeoff
export function writeOffBadDebt(opts: any): { id: string } {
  const id = uuid();
  const dbi = db.getDb();
  dbi.prepare(`INSERT INTO bad_debt_writeoffs (id, company_id, customer_id, invoice_id, writeoff_amount, writeoff_date, reason, posted_je_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, opts.company_id, opts.customer_id, opts.invoice_id, opts.writeoff_amount || 0, opts.writeoff_date || today(), opts.reason, opts.posted_je_id, now(), opts.created_by);
  // Mark invoice as written off
  if (opts.invoice_id) dbi.prepare(`UPDATE invoices SET status = 'written_off', balance = 0, updated_at = ? WHERE id = ?`).run(now(), opts.invoice_id);
  return { id };
}

// F503 — allowance for doubtful accounts (% of sales method)
export function calcAllowanceForDoubtful(opts: { company_id: string; period_end: string; method?: 'percent_of_sales' | 'aging'; estimate_percent?: number }): { id: string; allowance_amount: number } {
  const dbi = db.getDb();
  const id = uuid();
  let base = 0;
  if (opts.method === 'aging') {
    const aging = calcAgingBuckets(opts.company_id, opts.period_end);
    // Weight: 1% of 0-30, 5% of 31-60, 15% of 61-90, 50% of 90+
    base = aging.bucket_0_30 * 0.01 + aging.bucket_31_60 * 0.05 + aging.bucket_61_90 * 0.15 + aging.bucket_90_plus * 0.50;
    base = round2(base);
  } else {
    const sales = dbi.prepare(`SELECT COALESCE(SUM(total), 0) AS s FROM invoices WHERE company_id = ? AND issue_date <= ? AND status NOT IN ('void','cancelled') AND (deleted_at IS NULL OR deleted_at = '')`).get(opts.company_id, opts.period_end) as any;
    base = sales.s || 0;
  }
  const pct = opts.estimate_percent ?? (opts.method === 'aging' ? 100 : 2);
  const amount = round2(base * pct / 100);
  dbi.prepare(`INSERT INTO allowance_for_doubtful_accounts (id, company_id, period_end, method, base_amount, estimate_percent, allowance_amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, opts.company_id, opts.period_end, opts.method || 'percent_of_sales', base, pct, amount, now());
  return { id, allowance_amount: amount };
}

// F505 — collection agency handoff
export function handOffToCollectionAgency(opts: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO collection_agency_handoffs (id, company_id, invoice_id, customer_id, agency_name, handed_off_date, amount_assigned, commission_rate, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
    .run(id, opts.company_id, opts.invoice_id, opts.customer_id, opts.agency_name, opts.handed_off_date || today(), opts.amount_assigned || 0, opts.commission_rate || 0, opts.notes, now());
  return { id };
}

export function recordAgencyRecovery(handoffId: string, recoveredAmount: number): boolean {
  const r = db.getDb().prepare(`UPDATE collection_agency_handoffs SET recovered_amount = recovered_amount + ?, updated_at = ? WHERE id = ?`).run(recoveredAmount, now(), handoffId);
  return r.changes > 0;
}

export function listCollectionHandoffs(companyId: string, opts?: { status?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  return dbi.prepare(`SELECT * FROM collection_agency_handoffs WHERE ${where} ORDER BY handed_off_date DESC`).all(...params) as any[];
}
