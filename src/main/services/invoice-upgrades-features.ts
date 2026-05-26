// ─── Invoice Upgrades Wave: F893-F922 (30 features) ───
//
// Batch IA: Invoice Builder UX           (F893-F897)
// Batch IB: Smart Inference              (F898-F902)
// Batch IC: Client Engagement            (F903-F907)
// Batch ID: Workflow & Automation        (F908-F912)
// Batch IE: Analytics & Insights         (F913-F917)
// Batch IF: Bulk Operations              (F918-F922)
//
// Design notes:
// 1. DSO uses the rolling-window approach: aggregate paid invoices in
//    the last N days, compute days-from-issue-to-payment per invoice,
//    average them. Cached per (client_id, period_days).
// 2. Auto-match payment uses deterministic scoring (amount match,
//    memo/reference contains invoice #, client-of-record proximity,
//    date proximity). No ML — explainable.
// 3. Collection probability is a 0-100 score from inputs: client DSO,
//    days overdue, invoice age, prior write-off history. Stored cached.
// 4. Bulk operations wrap in single transactions for atomicity.

import { randomUUID as uuid } from 'crypto';
import * as db from '../database';

const now = (): string => new Date().toISOString();
const today = (): string => now().slice(0, 10);
const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;

function inClause(ids: string[]): { sql: string; params: string[] } {
  const placeholders = ids.map(() => '?').join(',');
  return { sql: placeholders, params: ids };
}

// ════════════════════════════════════════════════════════════════════
// Batch IA: Invoice Builder UX (F893-F897)
// ════════════════════════════════════════════════════════════════════

// F893: Save a set of line items as a reusable template
export function saveInvoiceLineTemplate(opts: { name: string; description?: string; lines: any[]; owner_user_id?: string; visibility?: 'private' | 'team' | 'company' }) {
  try {
    const id = uuid();
    // Strip per-instance ids and computed amounts — recompute on use
    const cleanedLines = (opts.lines || []).map((l: any) => ({
      description: l.description,
      quantity: l.quantity,
      unit_price: l.unit_price,
      tax_rate: l.tax_rate || 0,
      discount_amount: l.discount_amount || 0,
      discount_percent: l.discount_percent || 0,
      item_id: l.item_id || null,
      account_id: l.account_id || null,
      project_id: l.project_id || null,
      notes: l.notes || '',
    }));
    db.getDb().prepare(`INSERT INTO invoice_line_templates (id, company_id, name, description, lines_json, owner_user_id, visibility) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.name, opts.description || null, JSON.stringify(cleanedLines), opts.owner_user_id || null, opts.visibility || 'private');
    return { id, line_count: cleanedLines.length };
  } catch (e: any) { return { error: e.message }; }
}

// F894: List invoice line templates
export function listInvoiceLineTemplates(userId?: string) {
  try {
    return db.getDb().prepare(`SELECT id, name, description, times_used, last_used_at, visibility, created_at,
      (SELECT json_array_length(lines_json) FROM invoice_line_templates WHERE id = t.id) line_count
      FROM invoice_line_templates t
      WHERE company_id = ? AND (visibility IN ('company', 'team') OR owner_user_id = ?)
      ORDER BY times_used DESC, last_used_at DESC NULLS LAST, name`)
      .all(db.getCurrentCompanyId(), userId || '');
  } catch (e: any) { return { error: e.message }; }
}

// F895: Load a template, returns the line array and bumps usage
export function loadInvoiceLineTemplate(id: string) {
  try {
    const t = db.getDb().prepare(`SELECT * FROM invoice_line_templates WHERE id = ? AND company_id = ?`).get(id, db.getCurrentCompanyId()) as any;
    if (!t) return { error: 'Template not found' };
    db.getDb().prepare(`UPDATE invoice_line_templates SET times_used = COALESCE(times_used, 0) + 1, last_used_at = ?, updated_at = ? WHERE id = ?`)
      .run(now(), now(), id);
    return { id: t.id, name: t.name, lines: JSON.parse(t.lines_json || '[]') };
  } catch (e: any) { return { error: e.message }; }
}

// F896: Pull line items from unbilled time entries on a project
export function pullTimeEntriesAsLines(projectId: string, opts?: { rate?: number; merge_by?: 'employee' | 'task' | 'date' | 'none' }) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    let rows: any[] = [];
    try {
      rows = dbi.prepare(`SELECT te.*, e.name employee_name FROM time_entries te
        LEFT JOIN employees e ON te.employee_id = e.id
        WHERE te.company_id = ? AND te.project_id = ? AND (te.billed = 0 OR te.billed IS NULL)`)
        .all(cid, projectId) as any[];
    } catch (_) { return { error: 'time_entries table not available' }; }
    if (rows.length === 0) return { lines: [], message: 'No unbilled time entries' };
    const lines: any[] = [];
    const merge = opts?.merge_by || 'employee';
    const defaultRate = opts?.rate || 0;
    if (merge === 'none') {
      for (const r of rows) {
        const hours = Number(r.hours) || 0;
        const rate = Number(r.billable_rate || defaultRate) || 0;
        lines.push({ description: `${r.employee_name || 'Time'} — ${r.description || r.task || ''} (${r.date})`, quantity: hours, unit_price: rate, project_id: projectId, _time_entry_ids: [r.id] });
      }
    } else {
      const buckets: Record<string, any> = {};
      for (const r of rows) {
        const key = merge === 'employee' ? (r.employee_id || 'unassigned')
          : merge === 'task' ? (r.task || r.description || 'work')
            : (r.date || 'unknown');
        if (!buckets[key]) buckets[key] = { description: '', quantity: 0, unit_price: 0, _time_entry_ids: [] as string[] };
        buckets[key].quantity += Number(r.hours) || 0;
        buckets[key].unit_price = Number(r.billable_rate || defaultRate) || buckets[key].unit_price;
        buckets[key]._time_entry_ids.push(r.id);
        buckets[key].description = merge === 'employee' ? `${r.employee_name || 'Time'} — billable hours`
          : merge === 'task' ? `${r.task || r.description || 'Work'}`
            : `Time on ${r.date}`;
      }
      for (const v of Object.values(buckets)) lines.push({ ...v as any, project_id: projectId });
    }
    return { lines, time_entry_count: rows.length };
  } catch (e: any) { return { error: e.message }; }
}

// F897: Bulk-parse line items pasted from CSV/TSV
export function parseInvoiceBulkLines(rawText: string): { lines: any[]; warnings: string[] } {
  const lines: any[] = [];
  const warnings: string[] = [];
  const rows = (rawText || '').split(/\r?\n/).filter(r => r.trim());
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].includes('\t') ? rows[i].split('\t') : rows[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    if (cells.length < 2) { warnings.push(`Row ${i + 1} skipped (need ≥2 columns)`); continue; }
    const description = cells[0];
    let quantity = 1, unit_price = 0, tax_rate = 0;
    if (cells.length === 2) unit_price = parseFloat(cells[1]) || 0;
    else if (cells.length === 3) { quantity = parseFloat(cells[1]) || 1; unit_price = parseFloat(cells[2]) || 0; }
    else { quantity = parseFloat(cells[1]) || 1; unit_price = parseFloat(cells[2]) || 0; tax_rate = parseFloat(cells[3]) || 0; }
    lines.push({ description, quantity, unit_price, tax_rate, amount: round2(quantity * unit_price) });
  }
  return { lines, warnings };
}

// ════════════════════════════════════════════════════════════════════
// Batch IB: Smart Inference (F898-F902)
// ════════════════════════════════════════════════════════════════════

// F898: Predict a smart due date for a new invoice based on client history
//       Uses client's average days-to-pay, padded by the org's default terms.
export function predictSmartDueDate(clientId: string, opts?: { fallback_days?: number; issue_date?: string }) {
  try {
    const cid = db.getCurrentCompanyId();
    const fallback = opts?.fallback_days || 30;
    const issueDate = opts?.issue_date || today();
    const row = db.getDb().prepare(`SELECT AVG(julianday(updated_at) - julianday(date)) avg_days, COUNT(*) sample_size
      FROM invoices WHERE company_id = ? AND client_id = ? AND status = 'paid' AND date >= date('now', '-365 days')`)
      .get(cid, clientId) as any;
    const sampleSize = row?.sample_size || 0;
    let recommendedDays: number;
    let confidence: 'low' | 'medium' | 'high';
    let basis: string;
    if (sampleSize >= 5) {
      // Round to nearest 5 (so we suggest "30" not "27" — easier to communicate)
      recommendedDays = Math.max(7, Math.round((row.avg_days || fallback) / 5) * 5);
      confidence = sampleSize >= 10 ? 'high' : 'medium';
      basis = `Avg ${Math.round(row.avg_days)} days across ${sampleSize} paid invoices`;
    } else {
      recommendedDays = fallback;
      confidence = 'low';
      basis = `Default terms (only ${sampleSize} paid history)`;
    }
    const due = new Date(issueDate + 'T12:00:00Z');
    due.setUTCDate(due.getUTCDate() + recommendedDays);
    return { recommended_due_date: due.toISOString().slice(0, 10), recommended_days: recommendedDays, confidence, basis, sample_size: sampleSize };
  } catch (e: any) { return { error: e.message }; }
}

// F899: Preview FX conversion (for multi-currency clients)
export function previewCurrencyConversion(amount: number, fromCurrency: string, toCurrency: string) {
  try {
    if (fromCurrency === toCurrency) return { converted: amount, rate: 1, source: 'identity' };
    const dbi = db.getDb();
    let rate = 0; let source = 'none';
    try {
      const row = dbi.prepare(`SELECT rate FROM exchange_rates WHERE from_currency = ? AND to_currency = ? ORDER BY effective_date DESC LIMIT 1`).get(fromCurrency, toCurrency) as any;
      if (row?.rate) { rate = row.rate; source = 'exchange_rates'; }
    } catch (_) {}
    if (rate === 0) return { error: 'No exchange rate found' };
    return { from: fromCurrency, to: toCurrency, amount, converted: round2(amount * rate), rate, source };
  } catch (e: any) { return { error: e.message }; }
}

// F900: Apply a customer credit balance (retainer/refund) to an invoice
export function applyCreditToInvoice(opts: { invoice_id: string; credit_amount: number; credit_source?: string }) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const inv = dbi.prepare(`SELECT * FROM invoices WHERE id = ? AND company_id = ?`).get(opts.invoice_id, cid) as any;
    if (!inv) return { error: 'Invoice not found' };
    const open = round2((inv.total || 0) - (inv.amount_paid || 0));
    const apply = round2(Math.min(opts.credit_amount, open));
    if (apply <= 0) return { applied: 0, message: 'No open balance to apply against' };
    const newPaid = round2((inv.amount_paid || 0) + apply);
    const status = newPaid >= (inv.total || 0) - 0.005 ? 'paid' : 'partial';
    const txn = dbi.transaction(() => {
      dbi.prepare(`UPDATE invoices SET amount_paid = ?, status = ?, updated_at = ? WHERE id = ?`).run(newPaid, status, now(), opts.invoice_id);
      try {
        dbi.prepare(`INSERT INTO customer_credit_transactions (id, company_id, client_id, transaction_type, amount, related_invoice_id, notes) VALUES (?, ?, ?, 'applied', ?, ?, ?)`)
          .run(uuid(), cid, inv.client_id, apply, opts.invoice_id, opts.credit_source || 'manual application');
      } catch (_) {/* table may not exist */}
    });
    txn();
    return { applied: apply, new_amount_paid: newPaid, new_status: status };
  } catch (e: any) { return { error: e.message }; }
}

// F901: Calculate % complete for progress billing (sum of progress_billing_schedules milestones)
export function progressBillingPercentage(invoiceId: string) {
  try {
    const cid = db.getCurrentCompanyId();
    try {
      const row = db.getDb().prepare(`SELECT
        COALESCE(SUM(CASE WHEN status = 'billed' THEN milestone_amount ELSE 0 END), 0) billed,
        COALESCE(SUM(milestone_amount), 0) total,
        COUNT(*) milestone_count,
        COUNT(CASE WHEN status = 'billed' THEN 1 END) billed_count
        FROM progress_billing_schedules WHERE company_id = ? AND invoice_id = ?`).get(cid, invoiceId) as any;
      const pct = (row?.total || 0) === 0 ? 0 : round2((row.billed / row.total) * 100);
      return { milestones: row.milestone_count, billed: row.billed_count, billed_amount: round2(row.billed), total: round2(row.total), pct_complete: pct };
    } catch (_) {
      return { milestones: 0, billed: 0, pct_complete: 0, message: 'No progress billing schedule' };
    }
  } catch (e: any) { return { error: e.message }; }
}

// F902: Compute a late-fee preview for an overdue invoice
export function previewLateFee(invoiceId: string) {
  try {
    const inv = db.getDb().prepare(`SELECT * FROM invoices WHERE id = ? AND company_id = ?`).get(invoiceId, db.getCurrentCompanyId()) as any;
    if (!inv) return { error: 'Invoice not found' };
    if (!inv.due_date) return { fee: 0, message: 'No due date set' };
    const dueTime = new Date(inv.due_date + 'T00:00:00Z').getTime();
    const daysOverdue = Math.floor((Date.now() - dueTime) / 86400000);
    if (daysOverdue <= 0) return { fee: 0, message: 'Not overdue' };
    let policy: any = null;
    try {
      policy = db.getDb().prepare(`SELECT * FROM late_fee_policies WHERE company_id = ? AND (client_id = ? OR client_id IS NULL) ORDER BY client_id DESC NULLS LAST LIMIT 1`).get(db.getCurrentCompanyId(), inv.client_id);
    } catch (_) {}
    if (!policy) {
      // Sensible default: 1.5% / month
      const monthsOverdue = daysOverdue / 30;
      const fee = round2((inv.total || 0) * 0.015 * monthsOverdue);
      return { fee, days_overdue: daysOverdue, policy: 'default 1.5%/month', calc: `${inv.total} × 0.015 × ${round2(monthsOverdue)} months` };
    }
    const fee = round2((inv.total || 0) * (policy.rate_percent || 0) / 100 * (daysOverdue / (policy.period_days || 30)));
    return { fee, days_overdue: daysOverdue, policy: policy.name || 'configured', rate_percent: policy.rate_percent, period_days: policy.period_days };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch IC: Client Engagement (F903-F907)
// ════════════════════════════════════════════════════════════════════

// F903: Log an invoice view/click event (called from the public invoice page)
export function logInvoiceView(opts: { invoice_id: string; event_type: 'viewed' | 'downloaded' | 'paid_link_clicked'; metadata?: any }) {
  try {
    const id = uuid();
    const inv = db.getDb().prepare(`SELECT client_id FROM invoices WHERE id = ? AND company_id = ?`).get(opts.invoice_id, db.getCurrentCompanyId()) as any;
    db.getDb().prepare(`INSERT INTO invoice_view_logs (id, company_id, invoice_id, client_id, event_type, metadata_json) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.invoice_id, inv?.client_id || null, opts.event_type, JSON.stringify(opts.metadata || {}));
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F904: Get the view history for an invoice
export function getInvoiceViewHistory(invoiceId: string) {
  try {
    return db.getDb().prepare(`SELECT event_type, logged_at, metadata_json FROM invoice_view_logs
      WHERE invoice_id = ? AND company_id = ? ORDER BY logged_at DESC LIMIT 50`)
      .all(invoiceId, db.getCurrentCompanyId());
  } catch (e: any) { return []; }
}

// F905: Save an email template (per-state or per-client)
export function saveInvoiceEmailTemplate(opts: { name: string; state?: string; client_id?: string; subject_template: string; body_template: string; is_default?: boolean }) {
  try {
    const id = uuid();
    if (opts.is_default) {
      // Clear other defaults at this scope
      db.getDb().prepare(`UPDATE invoice_email_templates_v2 SET is_default = 0 WHERE company_id = ? AND (state = ? OR ? IS NULL) AND (client_id = ? OR ? IS NULL)`)
        .run(db.getCurrentCompanyId(), opts.state || null, opts.state || null, opts.client_id || null, opts.client_id || null);
    }
    db.getDb().prepare(`INSERT INTO invoice_email_templates_v2 (id, company_id, name, state, client_id, subject_template, body_template, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.name, opts.state || null, opts.client_id || null, opts.subject_template, opts.body_template, opts.is_default ? 1 : 0);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F906: Resolve which email template to use for a given invoice + state
export function resolveEmailTemplate(opts: { invoice_id: string; state?: string }) {
  try {
    const inv = db.getDb().prepare(`SELECT client_id FROM invoices WHERE id = ? AND company_id = ?`).get(opts.invoice_id, db.getCurrentCompanyId()) as any;
    if (!inv) return { error: 'Invoice not found' };
    // Resolve precedence: client+state, client, state, default
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const tries = [
      { client_id: inv.client_id, state: opts.state },
      { client_id: inv.client_id, state: null },
      { client_id: null, state: opts.state },
      { client_id: null, state: null },
    ];
    for (const t of tries) {
      const row = dbi.prepare(`SELECT * FROM invoice_email_templates_v2 WHERE company_id = ?
        AND (client_id = ? OR (? IS NULL AND client_id IS NULL))
        AND (state = ? OR (? IS NULL AND state IS NULL))
        ORDER BY is_default DESC LIMIT 1`)
        .get(cid, t.client_id || null, t.client_id || null, t.state || null, t.state || null) as any;
      if (row) return { ...row };
    }
    return { error: 'No template found at any precedence level' };
  } catch (e: any) { return { error: e.message }; }
}

// F907: Generate a thank-you email body for a paid invoice
export function generateThankYouNote(invoiceId: string) {
  try {
    const inv = db.getDb().prepare(`SELECT i.*, c.name client_name FROM invoices i LEFT JOIN clients c ON i.client_id = c.id WHERE i.id = ? AND i.company_id = ?`)
      .get(invoiceId, db.getCurrentCompanyId()) as any;
    if (!inv) return { error: 'Invoice not found' };
    const subject = `Payment received — Thank you, ${inv.client_name || 'valued customer'}`;
    const body = `Hi ${inv.client_name || 'there'},\n\nThis is to confirm that we've received your payment of $${(inv.amount_paid || 0).toLocaleString()} for invoice ${inv.invoice_number || inv.id}.\n\nThank you for your business — it's a pleasure working with you.\n\nBest regards`;
    return { subject, body };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch ID: Workflow & Automation (F908-F912)
// ════════════════════════════════════════════════════════════════════

// F908: Create an invoice approval rule
export function createInvoiceApprovalRule(opts: any) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO invoice_approval_rules (id, company_id, name, priority, min_amount, max_amount, client_id, approver_user_id, require_n_approvers, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
      .run(id, db.getCurrentCompanyId(), opts.name, opts.priority || 100, opts.min_amount || null, opts.max_amount || null, opts.client_id || null, opts.approver_user_id || null, opts.require_n_approvers || 1);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F909: Determine the approval rule that applies to a given invoice
export function routeInvoiceApproval(invoiceId: string) {
  try {
    const inv = db.getDb().prepare(`SELECT * FROM invoices WHERE id = ? AND company_id = ?`).get(invoiceId, db.getCurrentCompanyId()) as any;
    if (!inv) return { matched: false };
    const rules = db.getDb().prepare(`SELECT * FROM invoice_approval_rules WHERE company_id = ? AND active = 1 ORDER BY priority ASC`).all(db.getCurrentCompanyId()) as any[];
    for (const r of rules) {
      if (r.min_amount != null && inv.total < r.min_amount) continue;
      if (r.max_amount != null && inv.total > r.max_amount) continue;
      if (r.client_id && r.client_id !== inv.client_id) continue;
      return { matched: true, rule_id: r.id, rule_name: r.name, approver_user_id: r.approver_user_id, require_n_approvers: r.require_n_approvers || 1 };
    }
    return { matched: false };
  } catch (e: any) { return { error: e.message }; }
}

// F910: Suggest invoice matches for a bank transaction (amount + memo proximity)
export function suggestPaymentMatches(opts: { bank_transaction_id?: string; amount: number; memo?: string; date?: string; client_id?: string }) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    // Pull open invoices (not paid) with amount within $5 of the bank amount
    const tol = 5;
    const minAmt = opts.amount - tol;
    const maxAmt = opts.amount + tol;
    let where = `company_id = ? AND status NOT IN ('paid', 'cancelled', 'void') AND (total - COALESCE(amount_paid, 0)) BETWEEN ? AND ?`;
    const params: any[] = [cid, minAmt, maxAmt];
    if (opts.client_id) { where += ` AND client_id = ?`; params.push(opts.client_id); }
    const candidates = dbi.prepare(`SELECT i.*, c.name client_name FROM invoices i LEFT JOIN clients c ON i.client_id = c.id WHERE ${where} ORDER BY date DESC LIMIT 50`)
      .all(...params) as any[];
    const matches = candidates.map((inv: any) => {
      const open = (inv.total || 0) - (inv.amount_paid || 0);
      let confidence = 0;
      const reasons: string[] = [];
      // Exact amount match: 0.6
      const amountDelta = Math.abs(open - opts.amount);
      if (amountDelta < 0.01) { confidence += 0.6; reasons.push('exact amount match'); }
      else if (amountDelta < 1) { confidence += 0.4; reasons.push('amount match (±$1)'); }
      else { confidence += 0.2; reasons.push(`amount within $${tol}`); }
      // Memo contains invoice number: 0.3
      if (opts.memo && inv.invoice_number && opts.memo.toLowerCase().includes(String(inv.invoice_number).toLowerCase())) {
        confidence += 0.3; reasons.push(`memo contains invoice #${inv.invoice_number}`);
      }
      // Client name match: 0.1
      if (opts.memo && inv.client_name && opts.memo.toLowerCase().includes(inv.client_name.toLowerCase())) {
        confidence += 0.1; reasons.push('memo contains client name');
      }
      // Date proximity penalty (>30 days): -0.1
      if (opts.date && inv.date) {
        const days = Math.abs((new Date(opts.date).getTime() - new Date(inv.date).getTime()) / 86400000);
        if (days <= 30) { confidence += 0.05; reasons.push(`within ${Math.round(days)} days`); }
        else if (days <= 90) { /* neutral */ } else { confidence -= 0.1; reasons.push(`${Math.round(days)} days apart`); }
      }
      confidence = Math.max(0, Math.min(1, confidence));
      return { invoice_id: inv.id, invoice_number: inv.invoice_number, client_name: inv.client_name, open_amount: round2(open), confidence: round2(confidence), reasons };
    }).filter(m => m.confidence >= 0.3).sort((a, b) => b.confidence - a.confidence);
    return { suggestions: matches.slice(0, 10) };
  } catch (e: any) { return { error: e.message }; }
}

// F911: Issue a credit memo against an invoice
export function issueCreditMemo(opts: { invoice_id: string; amount: number; reason?: string; apply_to_invoice_id?: string }) {
  try {
    const cid = db.getCurrentCompanyId();
    const id = uuid();
    const inv = db.getDb().prepare(`SELECT client_id FROM invoices WHERE id = ? AND company_id = ?`).get(opts.invoice_id, cid) as any;
    const memoNumber = `CM-${Date.now()}`;
    db.getDb().prepare(`INSERT INTO invoice_credit_memos (id, company_id, invoice_id, client_id, memo_number, amount, reason, issued_date, applied_to_invoice_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, cid, opts.invoice_id, inv?.client_id || null, memoNumber, opts.amount, opts.reason || null, today(), opts.apply_to_invoice_id || null);
    // If applied to another invoice, reduce that invoice's open balance
    if (opts.apply_to_invoice_id) {
      applyCreditToInvoice({ invoice_id: opts.apply_to_invoice_id, credit_amount: opts.amount, credit_source: `credit memo ${memoNumber}` });
    }
    return { id, memo_number: memoNumber };
  } catch (e: any) { return { error: e.message }; }
}

// F912: Write off an invoice (after N days, with reason)
export function writeOffInvoice(invoiceId: string, reason: string, actorUserId?: string) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const inv = dbi.prepare(`SELECT * FROM invoices WHERE id = ? AND company_id = ?`).get(invoiceId, cid) as any;
    if (!inv) return { error: 'Invoice not found' };
    const open = round2((inv.total || 0) - (inv.amount_paid || 0));
    if (open <= 0) return { skipped: true, reason: 'No open balance' };
    const txn = dbi.transaction(() => {
      dbi.prepare(`UPDATE invoices SET status = 'written_off', amount_paid = total, write_off_amount = ?, write_off_reason = ?, write_off_date = ?, updated_at = ? WHERE id = ?`)
        .run(open, reason, today(), now(), invoiceId);
      try {
        dbi.prepare(`INSERT INTO bad_debt_writeoffs (id, company_id, invoice_id, client_id, amount, reason, written_off_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(uuid(), cid, invoiceId, inv.client_id, open, reason, now());
      } catch (_) {/* table may not exist */}
    });
    txn();
    return { written_off: open, invoice_id: invoiceId };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch IE: Analytics & Insights (F913-F917)
// ════════════════════════════════════════════════════════════════════

// F913: Compute Days Sales Outstanding (DSO) per client or company-wide
export function computeDsoForClient(opts: { client_id?: string; period_days?: number; cache?: boolean }) {
  try {
    const cid = db.getCurrentCompanyId();
    const period = opts.period_days || 90;
    // Check cache first
    if (opts.cache !== false) {
      try {
        const cached = db.getDb().prepare(`SELECT * FROM invoice_dso_cache WHERE company_id = ? AND (client_id = ? OR (? IS NULL AND client_id IS NULL)) AND period_days = ? AND computed_at >= datetime('now', '-1 day')`)
          .get(cid, opts.client_id || null, opts.client_id || null, period) as any;
        if (cached) return { dso_days: cached.dso_days, sample_invoices: cached.sample_invoices, source: 'cache' };
      } catch (_) {}
    }
    const where = opts.client_id ? 'AND client_id = ?' : '';
    const params: any[] = [cid, period];
    if (opts.client_id) params.push(opts.client_id);
    const row = db.getDb().prepare(`SELECT AVG(julianday(updated_at) - julianday(date)) avg_days, COUNT(*) sample
      FROM invoices WHERE company_id = ? AND status = 'paid' AND date >= date('now', '-' || ? || ' days') ${where}`)
      .get(...params) as any;
    const dso = round2(row?.avg_days || 0);
    const sample = row?.sample || 0;
    // Cache it
    try {
      db.getDb().prepare(`INSERT INTO invoice_dso_cache (id, company_id, client_id, period_days, dso_days, sample_invoices) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(company_id, client_id, period_days) DO UPDATE SET dso_days = excluded.dso_days, sample_invoices = excluded.sample_invoices, computed_at = datetime('now')`)
        .run(uuid(), cid, opts.client_id || null, period, dso, sample);
    } catch (_) {}
    return { dso_days: dso, sample_invoices: sample, period_days: period, source: 'computed' };
  } catch (e: any) { return { error: e.message }; }
}

// F914: Top revenue clients widget data
export function topRevenueClients(opts?: { since?: string; until?: string; limit?: number }) {
  try {
    const since = opts?.since || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const until = opts?.until || today();
    return db.getDb().prepare(`SELECT c.id, c.name,
      COUNT(i.id) invoice_count,
      SUM(i.total) total_revenue,
      SUM(i.amount_paid) collected,
      SUM(i.total - i.amount_paid) outstanding,
      MAX(i.date) last_invoice_date
      FROM invoices i
      LEFT JOIN clients c ON i.client_id = c.id
      WHERE i.company_id = ? AND i.date BETWEEN ? AND ? AND i.status NOT IN ('cancelled', 'void')
      GROUP BY c.id, c.name
      ORDER BY total_revenue DESC
      LIMIT ?`).all(db.getCurrentCompanyId(), since, until, opts?.limit || 10);
  } catch (e: any) { return []; }
}

// F915: AR aging breakdown by bucket (per client, or company-wide)
export function arAgingByBucket(clientId?: string) {
  try {
    const cid = db.getCurrentCompanyId();
    const todayD = new Date(today() + 'T00:00:00Z').getTime();
    const where = clientId ? 'AND client_id = ?' : '';
    const params: any[] = [cid];
    if (clientId) params.push(clientId);
    const rows = db.getDb().prepare(`SELECT id, total, amount_paid, due_date, date FROM invoices
      WHERE company_id = ? AND status NOT IN ('paid', 'cancelled', 'void', 'draft') ${where}`)
      .all(...params) as any[];
    const buckets = { current: 0, b1_30: 0, b31_60: 0, b61_90: 0, b90plus: 0 };
    for (const inv of rows) {
      const open = (inv.total || 0) - (inv.amount_paid || 0);
      const due = inv.due_date ? new Date(inv.due_date + 'T00:00:00Z').getTime() : todayD;
      const daysOver = Math.floor((todayD - due) / 86400000);
      if (daysOver <= 0) buckets.current += open;
      else if (daysOver <= 30) buckets.b1_30 += open;
      else if (daysOver <= 60) buckets.b31_60 += open;
      else if (daysOver <= 90) buckets.b61_90 += open;
      else buckets.b90plus += open;
    }
    return Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, round2(v as number)]));
  } catch (e: any) { return { error: e.message }; }
}

// F916: Cash flow projection from open invoices (next 90 days)
export function cashFlowProjection(daysAhead = 90) {
  try {
    const cid = db.getCurrentCompanyId();
    const cutoff = new Date(Date.now() + daysAhead * 86400000).toISOString().slice(0, 10);
    const rows = db.getDb().prepare(`SELECT due_date, SUM(total - COALESCE(amount_paid, 0)) expected
      FROM invoices WHERE company_id = ? AND status NOT IN ('paid', 'cancelled', 'void', 'draft', 'written_off')
      AND due_date <= ?
      GROUP BY due_date ORDER BY due_date ASC`).all(cid, cutoff) as any[];
    return rows.map(r => ({ ...r, expected: round2(r.expected) }));
  } catch (e: any) { return []; }
}

// F917: Compute collection probability score (0-100) for an invoice
export function computeCollectionScore(invoiceId: string) {
  try {
    const cid = db.getCurrentCompanyId();
    const inv = db.getDb().prepare(`SELECT i.*, c.name client_name FROM invoices i LEFT JOIN clients c ON i.client_id = c.id WHERE i.id = ? AND i.company_id = ?`)
      .get(invoiceId, cid) as any;
    if (!inv) return { score: 0, factors: ['invoice not found'] };
    let score = 100;
    const factors: string[] = [];
    // Days overdue penalty
    if (inv.due_date) {
      const daysOver = Math.floor((Date.now() - new Date(inv.due_date + 'T00:00:00Z').getTime()) / 86400000);
      if (daysOver > 90) { score -= 35; factors.push(`90+ days overdue (−35)`); }
      else if (daysOver > 60) { score -= 25; factors.push(`60-90 days overdue (−25)`); }
      else if (daysOver > 30) { score -= 15; factors.push(`30-60 days overdue (−15)`); }
      else if (daysOver > 0) { score -= 5; factors.push(`1-30 days overdue (−5)`); }
    }
    // Client DSO factor
    if (inv.client_id) {
      const dso = computeDsoForClient({ client_id: inv.client_id, period_days: 365 }) as any;
      if (dso?.dso_days > 60) { score -= 15; factors.push(`Client DSO ${dso.dso_days}d (−15)`); }
      else if (dso?.dso_days > 30) { score -= 5; factors.push(`Client DSO ${dso.dso_days}d (−5)`); }
      else if (dso?.dso_days > 0 && dso?.dso_days <= 15) { score += 10; factors.push(`Client DSO ${dso.dso_days}d (+10 — fast payer)`); }
    }
    // Prior write-off history
    try {
      const writeoffs = (db.getDb().prepare(`SELECT COUNT(*) c FROM bad_debt_writeoffs WHERE company_id = ? AND client_id = ?`).get(cid, inv.client_id) as any)?.c || 0;
      if (writeoffs > 0) { score -= 20; factors.push(`${writeoffs} prior write-offs (−20)`); }
    } catch (_) {}
    // Partial payments are a positive sign
    if ((inv.amount_paid || 0) > 0 && (inv.amount_paid || 0) < (inv.total || 0)) {
      score += 5; factors.push('Partial payment received (+5)');
    }
    score = Math.max(0, Math.min(100, score));
    const risk = score >= 75 ? 'low' : score >= 50 ? 'medium' : score >= 25 ? 'high' : 'critical';
    // Cache it
    try {
      db.getDb().prepare(`INSERT INTO invoice_collection_scores (id, company_id, invoice_id, score, factors_json, risk_level) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(invoice_id) DO UPDATE SET score = excluded.score, factors_json = excluded.factors_json, risk_level = excluded.risk_level, computed_at = datetime('now')`)
        .run(uuid(), cid, invoiceId, score, JSON.stringify(factors), risk);
    } catch (_) {}
    return { score, risk_level: risk, factors };
  } catch (e: any) { return { score: 0, factors: [e.message] }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch IF: Bulk Operations (F918-F922)
// ════════════════════════════════════════════════════════════════════

// F918: Bulk send payment reminders for a list of invoices
export function bulkSendReminders(invoiceIds: string[], opts?: { cadence?: string; actor_user_id?: string }) {
  try {
    if (!invoiceIds?.length) return { sent: 0 };
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    let sent = 0;
    const txn = dbi.transaction(() => {
      for (const id of invoiceIds) {
        try {
          dbi.prepare(`INSERT INTO invoice_email_log (id, company_id, invoice_id, email_type, sent_at, sent_by) VALUES (?, ?, ?, 'reminder', ?, ?)`)
            .run(uuid(), cid, id, now(), opts?.actor_user_id || null);
          dbi.prepare(`UPDATE invoices SET last_reminder_sent_at = ?, reminder_count = COALESCE(reminder_count, 0) + 1, updated_at = ? WHERE id = ?`)
            .run(now(), now(), id);
          sent++;
        } catch (_) {/* skip failures */}
      }
    });
    txn();
    return { sent };
  } catch (e: any) { return { error: e.message }; }
}

// F919: Bulk apply a single payment across N invoices (FIFO oldest-first)
// Returns the allocation breakdown so the user sees how it landed.
export function bulkApplyPayment(opts: { client_id: string; payment_amount: number; payment_date?: string; payment_method?: string }) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const opens = dbi.prepare(`SELECT id, invoice_number, total, amount_paid, due_date FROM invoices
      WHERE company_id = ? AND client_id = ? AND status NOT IN ('paid', 'cancelled', 'void', 'written_off')
      AND (total - COALESCE(amount_paid, 0)) > 0
      ORDER BY due_date ASC NULLS LAST, date ASC`).all(cid, opts.client_id) as any[];
    if (opens.length === 0) return { applied: 0, message: 'No open invoices for client' };
    let remaining = round2(opts.payment_amount);
    const allocations: any[] = [];
    const txn = dbi.transaction(() => {
      for (const inv of opens) {
        if (remaining <= 0.005) break;
        const openAmt = round2((inv.total || 0) - (inv.amount_paid || 0));
        const apply = round2(Math.min(remaining, openAmt));
        const newPaid = round2((inv.amount_paid || 0) + apply);
        const status = newPaid >= (inv.total || 0) - 0.005 ? 'paid' : 'partial';
        dbi.prepare(`UPDATE invoices SET amount_paid = ?, status = ?, updated_at = ? WHERE id = ?`).run(newPaid, status, now(), inv.id);
        try {
          dbi.prepare(`INSERT INTO invoice_payments (id, company_id, invoice_id, amount, payment_date, payment_method) VALUES (?, ?, ?, ?, ?, ?)`)
            .run(uuid(), cid, inv.id, apply, opts.payment_date || today(), opts.payment_method || 'manual');
        } catch (_) {/* table may not exist */}
        allocations.push({ invoice_id: inv.id, invoice_number: inv.invoice_number, applied: apply, new_status: status });
        remaining = round2(remaining - apply);
      }
    });
    txn();
    return { applied: round2(opts.payment_amount - remaining), remaining_credit: remaining, allocations };
  } catch (e: any) { return { error: e.message }; }
}

// F920: Bulk void invoices with reason
export function bulkVoidInvoices(invoiceIds: string[], reason: string, actorUserId?: string) {
  try {
    if (!invoiceIds?.length) return { voided: 0 };
    const { sql, params } = inClause(invoiceIds);
    const r = db.getDb().prepare(`UPDATE invoices SET status = 'void', void_reason = ?, voided_at = ?, voided_by = ?, updated_at = ? WHERE company_id = ? AND id IN (${sql}) AND status != 'paid'`)
      .run(reason, now(), actorUserId || null, now(), db.getCurrentCompanyId(), ...params);
    return { voided: r.changes };
  } catch (e: any) { return { error: e.message }; }
}

// F921: Bulk mark invoices as sent (used after a batch print/mail-out)
export function bulkMarkSent(invoiceIds: string[], sentBy?: string) {
  try {
    if (!invoiceIds?.length) return { marked: 0 };
    const { sql, params } = inClause(invoiceIds);
    const r = db.getDb().prepare(`UPDATE invoices SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END, sent_at = COALESCE(sent_at, ?), sent_by = COALESCE(sent_by, ?), updated_at = ? WHERE company_id = ? AND id IN (${sql})`)
      .run(now(), sentBy || null, now(), db.getCurrentCompanyId(), ...params);
    return { marked: r.changes };
  } catch (e: any) { return { error: e.message }; }
}

// F922: Generate a bulk-export manifest (paths to PDFs to ZIP up)
// Renderer takes these IDs, generates PDFs in parallel, zips, downloads.
export function bulkExportManifest(invoiceIds: string[]) {
  try {
    if (!invoiceIds?.length) return { invoices: [] };
    const { sql, params } = inClause(invoiceIds);
    const rows = db.getDb().prepare(`SELECT i.id, i.invoice_number, i.date, i.total, c.name client_name
      FROM invoices i LEFT JOIN clients c ON i.client_id = c.id
      WHERE i.company_id = ? AND i.id IN (${sql})
      ORDER BY i.date DESC`).all(db.getCurrentCompanyId(), ...params);
    const totalAmount = (rows as any[]).reduce((s, r: any) => s + (r.total || 0), 0);
    return { invoices: rows, count: (rows as any[]).length, total_amount: round2(totalAmount), generated_at: now() };
  } catch (e: any) { return { error: e.message }; }
}
