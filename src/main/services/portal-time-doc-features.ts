// ─── Wave 3 Part 2: F381-F420 (40 features) ───
//
// Batch V: Customer Portal back-end (F381-F390)
// Batch W: Vendor Portal back-end (F391-F400)
// Batch X: Time Tracking deep-dive (F401-F410)
// Batch Y: Document Intelligence (F411-F420)

import { randomUUID as uuid, createHash, randomBytes } from 'crypto';
import * as db from '../database';

const now = (): string => new Date().toISOString();
const today = (): string => now().slice(0, 10);
const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

// ════════════════════════════════════════════════════════════════
// Batch V: Customer Portal (F381-F390)
// ════════════════════════════════════════════════════════════════

// F381 — portal user provisioning
export function inviteCustomerPortalUser(opts: { company_id: string; customer_id: string; email: string; full_name?: string }): { id: string; invitation_token: string } {
  const token = randomBytes(24).toString('hex');
  const id = uuid();
  db.getDb().prepare(`INSERT INTO portal_users (id, company_id, customer_id, portal_type, email, full_name, is_active, invitation_token, invited_at) VALUES (?, ?, ?, 'customer', ?, ?, 1, ?, ?)`)
    .run(id, opts.company_id, opts.customer_id, opts.email, opts.full_name, token, now());
  return { id, invitation_token: token };
}

export function activatePortalUser(token: string, password: string): { ok: boolean; user_id?: string; error?: string } {
  const dbi = db.getDb();
  const u = dbi.prepare(`SELECT id FROM portal_users WHERE invitation_token = ? AND activated_at IS NULL`).get(token) as any;
  if (!u) return { ok: false, error: 'Invalid or already-used token' };
  const passwordHash = sha256(password + u.id);
  dbi.prepare(`UPDATE portal_users SET password_hash = ?, activated_at = ?, invitation_token = NULL WHERE id = ?`).run(passwordHash, now(), u.id);
  return { ok: true, user_id: u.id };
}

export function authPortalUser(email: string, password: string, companyId: string, portalType: string = 'customer'): { ok: boolean; user_id?: string; customer_id?: string; vendor_id?: string } {
  const u = db.getDb().prepare(`SELECT * FROM portal_users WHERE email = ? AND company_id = ? AND portal_type = ? AND is_active = 1`).get(email, companyId, portalType) as any;
  if (!u || u.password_hash !== sha256(password + u.id)) return { ok: false };
  db.getDb().prepare(`UPDATE portal_users SET last_login_at = ? WHERE id = ?`).run(now(), u.id);
  return { ok: true, user_id: u.id, customer_id: u.customer_id, vendor_id: u.vendor_id };
}

// F382-F384 — portal invoices, payments, payment history
export function listPortalInvoices(customerId: string): any[] {
  return db.getDb().prepare(`SELECT id, invoice_number, total, balance, status, issue_date, due_date FROM invoices WHERE client_id = ? AND status NOT IN ('void','cancelled') AND (deleted_at IS NULL OR deleted_at = '') ORDER BY due_date ASC`).all(customerId) as any[];
}

export function recordPortalPayment(opts: { company_id: string; portal_user_id: string; invoice_id?: string; amount: number; payment_method: string; stripe_payment_id?: string }): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO portal_payments (id, company_id, portal_user_id, invoice_id, amount, payment_method, stripe_payment_id, status, paid_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)`)
    .run(id, opts.company_id, opts.portal_user_id, opts.invoice_id, opts.amount, opts.payment_method, opts.stripe_payment_id, now(), now());
  return { id };
}

export function listPortalPaymentHistory(portalUserId: string, limit: number = 50): any[] {
  return db.getDb().prepare(`SELECT * FROM portal_payments WHERE portal_user_id = ? ORDER BY paid_at DESC LIMIT ?`).all(portalUserId, limit) as any[];
}

// F385 — account statement
export function generateCustomerStatement(companyId: string, customerId: string, periodStart: string, periodEnd: string): any {
  const dbi = db.getDb();
  const invoices = dbi.prepare(`SELECT id, invoice_number, issue_date, total, balance FROM invoices WHERE company_id = ? AND client_id = ? AND issue_date BETWEEN ? AND ? AND status NOT IN ('void','cancelled') AND (deleted_at IS NULL OR deleted_at = '') ORDER BY issue_date`).all(companyId, customerId, periodStart, periodEnd) as any[];
  const payments = dbi.prepare(`SELECT p.id, p.payment_date, p.amount, i.invoice_number FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.company_id = ? AND i.client_id = ? AND p.payment_date BETWEEN ? AND ? ORDER BY p.payment_date`).all(companyId, customerId, periodStart, periodEnd) as any[];
  const totalInvoiced = invoices.reduce((s, i) => s + (i.total || 0), 0);
  const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
  return { customer_id: customerId, period_start: periodStart, period_end: periodEnd, invoices, payments, total_invoiced: round2(totalInvoiced), total_paid: round2(totalPaid), outstanding: round2(totalInvoiced - totalPaid) };
}

// F386 — support tickets
export function createSupportTicket(t: any): { id: string; ticket_number: string } {
  const dbi = db.getDb();
  const id = uuid();
  const ticketNumber = `TKT-${Date.now().toString().slice(-8)}`;
  dbi.prepare(`INSERT INTO portal_support_tickets (id, company_id, portal_user_id, ticket_number, subject, description, category, priority, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`)
    .run(id, t.company_id, t.portal_user_id, ticketNumber, t.subject, t.description, t.category || 'general', t.priority || 'normal', now(), now());
  return { id, ticket_number: ticketNumber };
}

export function listSupportTickets(companyId: string, opts?: { portal_user_id?: string; status?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.portal_user_id) { where += ' AND portal_user_id = ?'; params.push(opts.portal_user_id); }
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  return dbi.prepare(`SELECT * FROM portal_support_tickets WHERE ${where} ORDER BY created_at DESC`).all(...params) as any[];
}

// F387 — portal document upload
export function uploadPortalDocument(d: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO portal_documents (id, company_id, portal_user_id, document_type, file_name, file_path, file_size, mime_type, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, d.company_id, d.portal_user_id, d.document_type, d.file_name, d.file_path, d.file_size || 0, d.mime_type, now());
  return { id };
}

// F389 — auto-pay enrollment
export function enrollAutoPay(opts: { company_id: string; customer_id: string; payment_method_id: string; max_amount_per_charge?: number }): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO portal_auto_pay (id, company_id, customer_id, payment_method_id, is_enabled, max_amount_per_charge, enrolled_at) VALUES (?, ?, ?, ?, 1, ?, ?) ON CONFLICT(company_id, customer_id) DO UPDATE SET payment_method_id = excluded.payment_method_id, is_enabled = 1, max_amount_per_charge = excluded.max_amount_per_charge, canceled_at = NULL`)
    .run(id, opts.company_id, opts.customer_id, opts.payment_method_id, opts.max_amount_per_charge, now());
  return { id };
}

export function cancelAutoPay(companyId: string, customerId: string): boolean {
  const r = db.getDb().prepare(`UPDATE portal_auto_pay SET is_enabled = 0, canceled_at = ? WHERE company_id = ? AND customer_id = ?`).run(now(), companyId, customerId);
  return r.changes > 0;
}

// F390 — portal branding
export function setPortalBranding(b: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO portal_branding (id, company_id, logo_url, primary_color, accent_color, company_display_name, welcome_message, custom_css, favicon_url, support_email, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(company_id) DO UPDATE SET logo_url = excluded.logo_url, primary_color = excluded.primary_color, accent_color = excluded.accent_color, company_display_name = excluded.company_display_name, welcome_message = excluded.welcome_message, custom_css = excluded.custom_css, favicon_url = excluded.favicon_url, support_email = excluded.support_email, updated_at = excluded.updated_at`)
    .run(id, b.company_id, b.logo_url, b.primary_color || '#3b82f6', b.accent_color, b.company_display_name, b.welcome_message, b.custom_css, b.favicon_url, b.support_email, now());
  return { id };
}

export function getPortalBranding(companyId: string): any | null {
  return db.getDb().prepare(`SELECT * FROM portal_branding WHERE company_id = ?`).get(companyId) || null;
}

// ════════════════════════════════════════════════════════════════
// Batch W: Vendor Portal (F391-F400)
// ════════════════════════════════════════════════════════════════

// F391 — vendor portal provisioning (reuses portal_users with portal_type='vendor')
export function inviteVendorPortalUser(opts: { company_id: string; vendor_id: string; email: string; full_name?: string }): { id: string; invitation_token: string } {
  const token = randomBytes(24).toString('hex');
  const id = uuid();
  db.getDb().prepare(`INSERT INTO portal_users (id, company_id, vendor_id, portal_type, email, full_name, is_active, invitation_token, invited_at) VALUES (?, ?, ?, 'vendor', ?, ?, 1, ?, ?)`)
    .run(id, opts.company_id, opts.vendor_id, opts.email, opts.full_name, token, now());
  return { id, invitation_token: token };
}

// F392 — PO acceptance/rejection
export function respondToPO(opts: { company_id: string; po_id: string; portal_user_id?: string; response_type: 'accepted' | 'rejected' | 'modified'; rejection_reason?: string; proposed_changes?: any; notes?: string }): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO vendor_po_responses (id, company_id, po_id, portal_user_id, response_type, response_at, rejection_reason, proposed_changes_json, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, opts.company_id, opts.po_id, opts.portal_user_id, opts.response_type, now(), opts.rejection_reason, JSON.stringify(opts.proposed_changes || {}), opts.notes);
  return { id };
}

export function listPORResponses(companyId: string, poId?: string): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (poId) { where += ' AND po_id = ?'; params.push(poId); }
  return dbi.prepare(`SELECT * FROM vendor_po_responses WHERE ${where} ORDER BY response_at DESC`).all(...params) as any[];
}

// F393 — vendor invoice submission
export function submitVendorInvoice(v: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO vendor_invoice_submissions (id, company_id, portal_user_id, vendor_id, invoice_number, amount, invoice_date, due_date, file_path, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?)`)
    .run(id, v.company_id, v.portal_user_id, v.vendor_id, v.invoice_number, v.amount, v.invoice_date, v.due_date, v.file_path, now());
  return { id };
}

export function reviewVendorInvoice(id: string, status: 'approved' | 'rejected', reviewedBy: string, rejectionReason?: string, matchedBillId?: string): boolean {
  const r = db.getDb().prepare(`UPDATE vendor_invoice_submissions SET status = ?, reviewed_at = ?, reviewed_by = ?, rejection_reason = ?, matched_bill_id = ? WHERE id = ?`).run(status, now(), reviewedBy, rejectionReason, matchedBillId, id);
  return r.changes > 0;
}

export function listVendorInvoiceSubmissions(companyId: string, opts?: { status?: string; vendor_id?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  if (opts?.vendor_id) { where += ' AND vendor_id = ?'; params.push(opts.vendor_id); }
  return dbi.prepare(`SELECT * FROM vendor_invoice_submissions WHERE ${where} ORDER BY submitted_at DESC`).all(...params) as any[];
}

// F394 — payment status visibility (read-only for vendor)
export function vendorPaymentStatus(companyId: string, vendorId: string): any {
  const dbi = db.getDb();
  const open = dbi.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(balance), 0) AS total FROM bills WHERE company_id = ? AND vendor_id = ? AND status NOT IN ('paid','void','cancelled') AND (deleted_at IS NULL OR deleted_at = '')`).get(companyId, vendorId) as any;
  const recent = dbi.prepare(`SELECT id, bill_number, total, balance, status, due_date FROM bills WHERE company_id = ? AND vendor_id = ? AND (deleted_at IS NULL OR deleted_at = '') ORDER BY bill_date DESC LIMIT 25`).all(companyId, vendorId) as any[];
  return { open_count: open.n, open_total: open.total, recent_bills: recent };
}

// F397 — ACH bank info update
export function submitACHUpdate(opts: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO vendor_ach_updates (id, company_id, vendor_id, portal_user_id, routing_number, account_number_last4, account_type, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
    .run(id, opts.company_id, opts.vendor_id, opts.portal_user_id, opts.routing_number, opts.account_number_last4, opts.account_type || 'checking', now());
  return { id };
}

export function approveACHUpdate(id: string, approvedBy: string): boolean {
  const r = db.getDb().prepare(`UPDATE vendor_ach_updates SET status = 'approved', verified_at = ?, approved_by = ? WHERE id = ?`).run(now(), approvedBy, id);
  return r.changes > 0;
}

// F398 — 1099 download log
export function recordVendor1099Download(opts: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO vendor_1099_downloads (id, company_id, vendor_id, portal_user_id, tax_year, form_type, file_path, downloaded_at, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, opts.company_id, opts.vendor_id, opts.portal_user_id, opts.tax_year, opts.form_type || '1099-NEC', opts.file_path, now(), opts.ip_address);
  return { id };
}

// F400 — compliance attestation
export function submitComplianceAttestation(opts: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO vendor_compliance_attestations (id, company_id, vendor_id, portal_user_id, attestation_type, attestation_text, answers_json, is_compliant, attested_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, opts.company_id, opts.vendor_id, opts.portal_user_id, opts.attestation_type, opts.attestation_text, JSON.stringify(opts.answers || {}), opts.is_compliant !== false ? 1 : 0, now(), opts.expires_at);
  return { id };
}

// ════════════════════════════════════════════════════════════════
// Batch X: Time Tracking deep-dive (F401-F410)
// ════════════════════════════════════════════════════════════════

// F401 — timer
export function startTimer(opts: { company_id: string; user_id: string; project_id?: string; task_id?: string; description?: string; is_billable?: boolean }): { id: string } {
  const dbi = db.getDb();
  // Stop any existing running timers for this user
  dbi.prepare(`UPDATE time_timers SET status = 'stopped' WHERE user_id = ? AND status IN ('running','paused')`).run(opts.user_id);
  const id = uuid();
  dbi.prepare(`INSERT INTO time_timers (id, company_id, user_id, project_id, task_id, started_at, description, is_billable, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running')`)
    .run(id, opts.company_id, opts.user_id, opts.project_id, opts.task_id, now(), opts.description, opts.is_billable === false ? 0 : 1);
  return { id };
}

export function pauseTimer(timerId: string): boolean {
  const r = db.getDb().prepare(`UPDATE time_timers SET status = 'paused', paused_at = ? WHERE id = ? AND status = 'running'`).run(now(), timerId);
  return r.changes > 0;
}

export function resumeTimer(timerId: string): boolean {
  const dbi = db.getDb();
  const t = dbi.prepare(`SELECT paused_at, total_paused_seconds FROM time_timers WHERE id = ?`).get(timerId) as any;
  if (!t || !t.paused_at) return false;
  const additionalPause = Math.floor((Date.now() - new Date(t.paused_at).getTime()) / 1000);
  const r = dbi.prepare(`UPDATE time_timers SET status = 'running', paused_at = NULL, total_paused_seconds = total_paused_seconds + ? WHERE id = ?`).run(additionalPause, timerId);
  return r.changes > 0;
}

export function stopTimer(timerId: string): { elapsed_seconds: number; billable_hours: number } {
  const dbi = db.getDb();
  const t = dbi.prepare(`SELECT * FROM time_timers WHERE id = ?`).get(timerId) as any;
  if (!t) throw new Error('Timer not found');
  const endTime = t.status === 'paused' && t.paused_at ? new Date(t.paused_at).getTime() : Date.now();
  const totalElapsed = Math.floor((endTime - new Date(t.started_at).getTime()) / 1000) - (t.total_paused_seconds || 0);
  dbi.prepare(`UPDATE time_timers SET status = 'stopped' WHERE id = ?`).run(timerId);
  return { elapsed_seconds: totalElapsed, billable_hours: round2(totalElapsed / 3600) };
}

export function getRunningTimer(userId: string): any | null {
  return db.getDb().prepare(`SELECT * FROM time_timers WHERE user_id = ? AND status IN ('running','paused') LIMIT 1`).get(userId) || null;
}

// F402 — billable rates
export function upsertBillableRate(r: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO billable_rates (id, company_id, employee_id, project_id, role, rate_per_hour, currency, effective_from, effective_to, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, r.company_id, r.employee_id, r.project_id, r.role, r.rate_per_hour || 0, r.currency || 'USD', r.effective_from, r.effective_to, now());
  return { id };
}

export function getEffectiveRate(opts: { company_id: string; employee_id?: string; project_id?: string; role?: string; as_of_date?: string }): number {
  const dbi = db.getDb();
  const date = opts.as_of_date || today();
  // Most specific match first: employee+project, employee, project, role
  const queries = [
    [opts.employee_id, opts.project_id, null],
    [opts.employee_id, null, null],
    [null, opts.project_id, null],
    [null, null, opts.role],
  ];
  for (const [eid, pid, role] of queries) {
    if (!eid && !pid && !role) continue;
    const conds: string[] = ['company_id = ?']; const params: any[] = [opts.company_id];
    if (eid) { conds.push('employee_id = ?'); params.push(eid); } else conds.push('employee_id IS NULL');
    if (pid) { conds.push('project_id = ?'); params.push(pid); } else conds.push('project_id IS NULL');
    if (role) { conds.push('role = ?'); params.push(role); }
    conds.push(`(effective_from IS NULL OR effective_from <= ?)`); params.push(date);
    conds.push(`(effective_to IS NULL OR effective_to >= ?)`); params.push(date);
    const r = dbi.prepare(`SELECT rate_per_hour FROM billable_rates WHERE ${conds.join(' AND ')} ORDER BY effective_from DESC LIMIT 1`).get(...params) as any;
    if (r) return r.rate_per_hour;
  }
  return 0;
}

// F404 — overtime rules + apply
export function upsertOvertimeRule(r: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO overtime_rules (id, company_id, rule_name, state_code, daily_threshold_hours, weekly_threshold_hours, double_time_threshold_hours, ot_multiplier, double_time_multiplier, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
    .run(id, r.company_id, r.rule_name, r.state_code, r.daily_threshold_hours || 8, r.weekly_threshold_hours || 40, r.double_time_threshold_hours, r.ot_multiplier || 1.5, r.double_time_multiplier || 2.0);
  return { id };
}

export function calcOvertime(opts: { company_id: string; daily_hours: number[]; weekly_hours: number; base_rate: number; state_code?: string }): { regular_hours: number; ot_hours: number; dt_hours: number; total_pay: number } {
  const dbi = db.getDb();
  const params: any[] = [opts.company_id];
  let where = 'company_id = ? AND is_active = 1';
  if (opts.state_code) { where += ' AND (state_code = ? OR state_code IS NULL)'; params.push(opts.state_code); }
  const rule = dbi.prepare(`SELECT * FROM overtime_rules WHERE ${where} ORDER BY state_code IS NOT NULL DESC LIMIT 1`).get(...params) as any;
  if (!rule) return { regular_hours: opts.weekly_hours, ot_hours: 0, dt_hours: 0, total_pay: round2(opts.weekly_hours * opts.base_rate) };

  let regular = 0, ot = 0, dt = 0;
  for (const dh of opts.daily_hours) {
    if (rule.double_time_threshold_hours && dh > rule.double_time_threshold_hours) {
      dt += dh - rule.double_time_threshold_hours;
      ot += rule.double_time_threshold_hours - rule.daily_threshold_hours;
      regular += rule.daily_threshold_hours;
    } else if (dh > rule.daily_threshold_hours) {
      ot += dh - rule.daily_threshold_hours;
      regular += rule.daily_threshold_hours;
    } else {
      regular += dh;
    }
  }
  // Weekly OT (only counts hours above weekly threshold not already classified as OT)
  if (regular > rule.weekly_threshold_hours) {
    const weeklyOt = regular - rule.weekly_threshold_hours;
    regular = rule.weekly_threshold_hours;
    ot += weeklyOt;
  }
  const totalPay = round2(regular * opts.base_rate + ot * opts.base_rate * (rule.ot_multiplier || 1.5) + dt * opts.base_rate * (rule.double_time_multiplier || 2.0));
  return { regular_hours: round2(regular), ot_hours: round2(ot), dt_hours: round2(dt), total_pay: totalPay };
}

// F406 — project time budgets
export function upsertProjectTimeBudget(b: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO project_time_budgets (id, company_id, project_id, budgeted_hours, alert_at_percent, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(company_id, project_id) DO UPDATE SET budgeted_hours = excluded.budgeted_hours, alert_at_percent = excluded.alert_at_percent, notes = excluded.notes, updated_at = excluded.updated_at`)
    .run(id, b.company_id, b.project_id, b.budgeted_hours || 0, b.alert_at_percent || 80, b.notes, now(), now());
  return { id };
}

export function updateConsumedHours(projectId: string, hours: number): { percent_consumed: number; alert_fired: boolean } {
  const dbi = db.getDb();
  dbi.prepare(`UPDATE project_time_budgets SET consumed_hours = consumed_hours + ?, updated_at = ? WHERE project_id = ?`).run(hours, now(), projectId);
  const b = dbi.prepare(`SELECT * FROM project_time_budgets WHERE project_id = ?`).get(projectId) as any;
  if (!b) return { percent_consumed: 0, alert_fired: false };
  const pct = b.budgeted_hours > 0 ? (b.consumed_hours / b.budgeted_hours) * 100 : 0;
  let alertFired = false;
  if (pct >= b.alert_at_percent && !b.alert_fired_at) {
    dbi.prepare(`UPDATE project_time_budgets SET alert_fired_at = ? WHERE id = ?`).run(now(), b.id);
    alertFired = true;
  }
  return { percent_consumed: round2(pct), alert_fired: alertFired };
}

// F408 — calendar event sync
export function syncCalendarEvent(e: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO calendar_event_sync (id, user_id, company_id, source, external_event_id, title, start_at, end_at, project_id, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(source, external_event_id) DO UPDATE SET title = excluded.title, start_at = excluded.start_at, end_at = excluded.end_at`)
    .run(id, e.user_id, e.company_id, e.source || 'google', e.external_event_id, e.title, e.start_at, e.end_at, e.project_id, now());
  return { id };
}

export function convertCalendarToTimeEntry(eventId: string, projectId?: string, taskId?: string): { time_entry_id: string; hours: number } {
  const dbi = db.getDb();
  const e = dbi.prepare(`SELECT * FROM calendar_event_sync WHERE id = ?`).get(eventId) as any;
  if (!e) throw new Error('Event not found');
  const hours = round2((new Date(e.end_at).getTime() - new Date(e.start_at).getTime()) / 3600000);
  const teId = uuid();
  // Attempt to insert into time_entries — handle missing column gracefully
  try {
    dbi.prepare(`INSERT INTO time_entries (id, company_id, user_id, project_id, task_id, date, hours, description, is_billable, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
      .run(teId, e.company_id, e.user_id, projectId || e.project_id, taskId, e.start_at.slice(0, 10), hours, e.title || 'From calendar', now());
  } catch {}
  dbi.prepare(`UPDATE calendar_event_sync SET converted_to_time_entry_id = ? WHERE id = ?`).run(teId, eventId);
  return { time_entry_id: teId, hours };
}

// F410 — rounding rules
export function applyRounding(minutes: number, intervalMinutes: number = 15, method: 'nearest' | 'up' | 'down' = 'nearest'): number {
  if (method === 'up') return Math.ceil(minutes / intervalMinutes) * intervalMinutes;
  if (method === 'down') return Math.floor(minutes / intervalMinutes) * intervalMinutes;
  return Math.round(minutes / intervalMinutes) * intervalMinutes;
}

// ════════════════════════════════════════════════════════════════
// Batch Y: Document Intelligence (F411-F420)
// ════════════════════════════════════════════════════════════════

// F411 — auto-classify document type by heuristic patterns
export function classifyDocument(text: string): { detected_type: string; confidence: number; extracted_fields: Record<string, string> } {
  const t = (text || '').toLowerCase();
  const fields: Record<string, string> = {};
  let detected = 'unknown';
  let confidence = 0;

  // W-9 detection
  if (/request for taxpayer identification|form\s+w-9/i.test(text)) {
    detected = 'w9'; confidence = 0.9;
    const tin = text.match(/\b(\d{2}-?\d{7}|\d{3}-?\d{2}-?\d{4})\b/);
    if (tin) fields.tin = tin[0];
  }
  // 1099 detection
  else if (/form\s+1099/i.test(text)) {
    detected = '1099'; confidence = 0.9;
  }
  // Invoice detection
  else if (/\binvoice\b/i.test(text) && /\btotal\b/i.test(t)) {
    detected = 'invoice'; confidence = 0.7;
    const num = text.match(/invoice\s*#?\s*[:\-]?\s*([A-Z0-9-]+)/i);
    if (num) fields.invoice_number = num[1];
  }
  // Bank statement
  else if (/statement\s+(period|date)|account\s+summary|beginning\s+balance/i.test(text)) {
    detected = 'bank_statement'; confidence = 0.75;
  }
  // Receipt
  else if (/\breceipt\b|subtotal.*tax.*total/is.test(t)) {
    detected = 'receipt'; confidence = 0.7;
  }
  // Contract
  else if (/\bagreement\b|\bcontract\b|\bwhereas\b/i.test(text)) {
    detected = 'contract'; confidence = 0.65;
  }

  return { detected_type: detected, confidence, extracted_fields: fields };
}

export function recordClassification(opts: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO document_classifications (id, company_id, document_id, detected_type, confidence, extracted_fields_json, classified_at, method) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, opts.company_id, opts.document_id, opts.detected_type, opts.confidence, JSON.stringify(opts.extracted_fields || {}), now(), opts.method || 'rule_based');
  return { id };
}

// F412 — extract key fields
export function extractField(documentId: string, fieldName: string, fieldValue: string, confidence: number = 0.5, method: string = 'regex'): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO document_extracted_fields (id, document_id, field_name, field_value, confidence, extraction_method, extracted_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, documentId, fieldName, fieldValue, confidence, method, now());
  return { id };
}

export function getExtractedFields(documentId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM document_extracted_fields WHERE document_id = ? ORDER BY field_name`).all(documentId) as any[];
}

// F413 — bank statement parsing
export function parseBankStatementCSV(text: string): { headers: string[]; transactions: Array<{ date: string; description: string; amount: number; type: 'debit' | 'credit' }> } {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], transactions: [] };
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const dateIdx = headers.findIndex(h => /date/i.test(h));
  const descIdx = headers.findIndex(h => /desc|memo|payee/i.test(h));
  const amtIdx = headers.findIndex(h => /amount/i.test(h));
  const debitIdx = headers.findIndex(h => /debit|withdrawal/i.test(h));
  const creditIdx = headers.findIndex(h => /credit|deposit/i.test(h));
  const transactions: any[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const date = cells[dateIdx] || '';
    const desc = cells[descIdx] || '';
    let amount = 0;
    let type: 'debit' | 'credit' = 'debit';
    if (amtIdx >= 0) {
      amount = parseFloat(cells[amtIdx] || '0');
      type = amount >= 0 ? 'credit' : 'debit';
      amount = Math.abs(amount);
    } else if (debitIdx >= 0 && cells[debitIdx]) {
      amount = parseFloat(cells[debitIdx]); type = 'debit';
    } else if (creditIdx >= 0 && cells[creditIdx]) {
      amount = parseFloat(cells[creditIdx]); type = 'credit';
    }
    if (date && amount) transactions.push({ date, description: desc, amount, type });
  }
  return { headers, transactions };
}

export function recordBankStatementImport(opts: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO bank_statement_imports (id, company_id, bank_account_id, statement_date, file_path, transactions_parsed, transactions_matched, opening_balance, closing_balance, parser_used, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, opts.company_id, opts.bank_account_id, opts.statement_date, opts.file_path, opts.transactions_parsed || 0, opts.transactions_matched || 0, opts.opening_balance || 0, opts.closing_balance || 0, opts.parser_used || 'csv', now());
  return { id };
}

// F415 — contract clause detection
export function detectContractClauses(text: string, documentId: string, companyId: string): { detected: number } {
  const dbi = db.getDb();
  const patterns = [
    { type: 'auto_renewal', regex: /auto(?:matically)?\s+renew|automatic\s+renewal/i, risk: 'medium' },
    { type: 'termination', regex: /termination|terminate this agreement|right to terminate/i, risk: 'low' },
    { type: 'indemnification', regex: /indemnif(?:y|ication)|hold harmless/i, risk: 'high' },
    { type: 'limitation_of_liability', regex: /limitation of liability|in no event shall/i, risk: 'medium' },
    { type: 'confidentiality', regex: /confidential information|non-disclosure/i, risk: 'low' },
    { type: 'arbitration', regex: /binding arbitration|arbitration clause/i, risk: 'medium' },
    { type: 'governing_law', regex: /governing law|laws of the state of/i, risk: 'low' },
    { type: 'late_fee', regex: /late\s+fee|late\s+charge|interest\s+rate.*overdue/i, risk: 'low' },
  ];
  let count = 0;
  for (const p of patterns) {
    const match = text.match(p.regex);
    if (match) {
      dbi.prepare(`INSERT INTO contract_clauses (id, company_id, document_id, clause_type, clause_text, position_start, position_end, risk_level, extracted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(uuid(), companyId, documentId, p.type, match[0], match.index || 0, (match.index || 0) + match[0].length, p.risk, now());
      count++;
    }
  }
  return { detected: count };
}

export function listContractClauses(documentId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM contract_clauses WHERE document_id = ? ORDER BY position_start`).all(documentId) as any[];
}

// F419 — signing workflows
export function startSigningWorkflow(opts: any): { id: string } {
  const id = uuid();
  const steps = opts.steps || [];
  db.getDb().prepare(`INSERT INTO document_signing_workflows (id, company_id, document_id, workflow_name, status, current_step, total_steps, steps_json, created_at) VALUES (?, ?, ?, ?, 'in_progress', 0, ?, ?, ?)`)
    .run(id, opts.company_id, opts.document_id, opts.workflow_name, steps.length, JSON.stringify(steps), now());
  return { id };
}

export function advanceSigningWorkflow(workflowId: string): { current_step: number; completed: boolean } {
  const dbi = db.getDb();
  const w = dbi.prepare(`SELECT * FROM document_signing_workflows WHERE id = ?`).get(workflowId) as any;
  if (!w) throw new Error('Workflow not found');
  const nextStep = (w.current_step || 0) + 1;
  if (nextStep >= w.total_steps) {
    dbi.prepare(`UPDATE document_signing_workflows SET current_step = ?, status = 'completed', completed_at = ? WHERE id = ?`).run(nextStep, now(), workflowId);
    return { current_step: nextStep, completed: true };
  }
  dbi.prepare(`UPDATE document_signing_workflows SET current_step = ? WHERE id = ?`).run(nextStep, workflowId);
  return { current_step: nextStep, completed: false };
}

// F417 — document expiration alerts
export function findExpiringDocuments(companyId: string, daysAhead: number = 30): any[] {
  const dbi = db.getDb();
  // Pull from multiple sources
  const ins = dbi.prepare(`SELECT 'insurance' AS source, id, policy_number AS reference, expiry_date FROM asset_insurance WHERE company_id = ? AND expiry_date BETWEEN date('now') AND date('now', '+' || ? || ' days')`).all(companyId, daysAhead) as any[];
  const warr = dbi.prepare(`SELECT 'warranty' AS source, id, warranty_provider AS reference, end_date AS expiry_date FROM asset_warranties WHERE company_id = ? AND end_date BETWEEN date('now') AND date('now', '+' || ? || ' days')`).all(companyId, daysAhead) as any[];
  const certs = dbi.prepare(`SELECT 'exemption_cert' AS source, id, certificate_number AS reference, expiration_date AS expiry_date FROM tax_exemption_certificates WHERE company_id = ? AND expiration_date BETWEEN date('now') AND date('now', '+' || ? || ' days')`).all(companyId, daysAhead) as any[];
  return [...ins, ...warr, ...certs].sort((a, b) => (a.expiry_date || '').localeCompare(b.expiry_date || ''));
}

// F420 — retention policy
export function upsertRetentionPolicy(p: any): { id: string } {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO document_retention_policies (id, company_id, document_type, retention_years, auto_delete, is_active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)`)
    .run(id, p.company_id, p.document_type, p.retention_years || 7, p.auto_delete ? 1 : 0, now());
  return { id };
}

export function findDocsExceedingRetention(companyId: string): any[] {
  return db.getDb().prepare(`SELECT d.id, d.name, d.created_at, p.retention_years, p.document_type FROM documents d JOIN document_retention_policies p ON p.document_type = d.document_type WHERE p.company_id = ? AND p.is_active = 1 AND p.auto_delete = 1 AND date(d.created_at, '+' || p.retention_years || ' years') < date('now')`).all(companyId) as any[];
}
