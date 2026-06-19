// ─── Invoice Wave II: F923-F962 (40 features) ───
//
// Batch IG: Recurring & Subscriptions     (F923-F927)
// Batch IH: PDF & Brand Customization     (F928-F932)
// Batch II: Quote-to-Invoice Conversion   (F933-F937)
// Batch IJ: Discounts & Promotions        (F938-F942)
// Batch IK: Payment Processing Integration(F943-F947)
// Batch IL: International                 (F948-F952)
// Batch IM: Workflow Automation           (F953-F957)
// Batch IN: Client Portal & Reporting     (F958-F962)
//
// Design notes:
// 1. MRR/ARR computed from subscriptions (if present) + recurring invoices
//    monthlyized — both schemas exist already, we glue them.
// 2. Brand profiles are NOT PDF generators — they're config rows. Actual
//    PDF rendering happens in pdf-generator.ts; this just exposes profile
//    data + watermark hooks.
// 3. Coupons use a code lookup with strict validation (uppercase trim,
//    UNIQUE per company). Single redemption per invoice enforced.
// 4. Workflow rules are evaluated at trigger event points elsewhere in
//    the codebase; this service stores + matches them.

import { randomUUID as uuid, randomBytes } from 'crypto';
import * as db from '../database';

const now = (): string => new Date().toISOString();
const today = (): string => now().slice(0, 10);
const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;

// ════════════════════════════════════════════════════════════════════
// Batch IG: Recurring & Subscriptions (F923-F927)
// ════════════════════════════════════════════════════════════════════

// F923: Generate next-due recurring invoices — scheduled-job entry point.
// Looks at recurring_invoice_templates with next_run_at <= today, materializes
// invoices, advances next_run_at by the template's frequency.
export function runRecurringInvoicesDue() {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    let templates: any[] = [];
    try {
      templates = dbi.prepare(`SELECT * FROM recurring_invoice_templates WHERE company_id = ? AND active = 1 AND (next_run_at IS NULL OR next_run_at <= ?)`).all(cid, today()) as any[];
    } catch (_) { return { error: 'recurring_invoice_templates not available', generated: 0 }; }
    const generated: any[] = [];
    for (const tpl of templates) {
      const invId = uuid();
      try {
        // Create the invoice shell — production code should also clone line items
        dbi.prepare(`INSERT INTO invoices (id, company_id, client_id, invoice_number, date, due_date, total, amount_paid, status, created_at, updated_at, terms_text)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'draft', ?, ?, ?)`)
          .run(invId, cid, tpl.client_id, `INV-${Date.now()}-${invId.slice(0, 6)}`, today(), advanceDays(today(), tpl.due_in_days || 30), tpl.total || 0, now(), now(), tpl.terms_text || '');
        generated.push({ template_id: tpl.id, invoice_id: invId });
        // Advance the schedule
        const next = advanceByFrequency(tpl.next_run_at || today(), tpl.frequency || 'monthly');
        dbi.prepare(`UPDATE recurring_invoice_templates SET next_run_at = ?, last_run_at = ?, generated_count = COALESCE(generated_count, 0) + 1 WHERE id = ?`).run(next, today(), tpl.id);
      } catch (e: any) { /* skip failures, continue */ }
    }
    return { generated: generated.length, results: generated };
  } catch (e: any) { return { error: e.message }; }
}

function advanceDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function advanceByFrequency(dateStr: string, freq: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  if (freq === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
  else if (freq === 'biweekly') d.setUTCDate(d.getUTCDate() + 14);
  else if (freq === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1);
  else if (freq === 'quarterly') d.setUTCMonth(d.getUTCMonth() + 3);
  else if (freq === 'annual' || freq === 'yearly') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1); // default monthly
  return d.toISOString().slice(0, 10);
}

// F924: Compute MRR / ARR / churn metrics from subscription + recurring data
export function computeSubscriptionMetrics() {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    let mrr = 0, arr = 0, activeSubs = 0, churnedSubs = 0;
    try {
      const subs = dbi.prepare(`SELECT * FROM subscriptions WHERE company_id = ? AND status = 'active'`).all(cid) as any[];
      activeSubs = subs.length;
      for (const s of subs) {
        const monthly = monthlyizeAmount(s.amount || 0, s.billing_cycle || 'monthly');
        mrr += monthly;
        arr += monthly * 12;
      }
      churnedSubs = (dbi.prepare(`SELECT COUNT(*) c FROM subscriptions WHERE company_id = ? AND status = 'cancelled' AND cancelled_at >= date('now', '-30 days')`).get(cid) as any)?.c || 0;
    } catch (_) {/* subs table may not exist */}
    // Add MRR from recurring_invoice_templates
    try {
      const recurring = dbi.prepare(`SELECT amount, frequency FROM recurring_invoice_templates WHERE company_id = ? AND active = 1`).all(cid) as any[];
      for (const r of recurring) {
        const monthly = monthlyizeAmount(r.amount || 0, r.frequency || 'monthly');
        mrr += monthly;
        arr += monthly * 12;
      }
    } catch (_) {/* */}
    const churnRate = activeSubs + churnedSubs === 0 ? 0 : round2((churnedSubs / (activeSubs + churnedSubs)) * 100);
    return { mrr: round2(mrr), arr: round2(arr), active_subscriptions: activeSubs, churned_30d: churnedSubs, churn_rate_pct: churnRate };
  } catch (e: any) { return { error: e.message }; }
}

function monthlyizeAmount(amount: number, cycle: string): number {
  if (cycle === 'monthly') return amount;
  if (cycle === 'annual' || cycle === 'yearly') return amount / 12;
  if (cycle === 'quarterly') return amount / 3;
  if (cycle === 'weekly') return amount * 52 / 12;
  return amount; // default monthly
}

// F925: Proration calculator — when a subscription changes mid-cycle, how much
// to credit/charge based on the unused portion.
export function calculateProration(opts: { current_amount: number; new_amount: number; cycle_days_remaining: number; total_cycle_days: number }) {
  try {
    const fractionRemaining = opts.total_cycle_days > 0 ? opts.cycle_days_remaining / opts.total_cycle_days : 0;
    const currentRefund = round2(opts.current_amount * fractionRemaining);
    const newCharge = round2(opts.new_amount * fractionRemaining);
    const netProration = round2(newCharge - currentRefund);
    return { refund_for_unused: currentRefund, charge_for_new: newCharge, net_proration: netProration, fraction_remaining: round2(fractionRemaining) };
  } catch (e: any) { return { error: e.message }; }
}

// F926: Trial-period management — list trials about to expire (for auto-conversion)
export function trialsAboutToExpire(daysAhead = 3) {
  try {
    const cid = db.getCurrentCompanyId();
    const cutoff = advanceDays(today(), daysAhead);
    try {
      return db.getDb().prepare(`SELECT s.*, c.name client_name FROM subscriptions s
        LEFT JOIN clients c ON s.client_id = c.id
        WHERE s.company_id = ? AND s.status = 'trialing' AND s.trial_end <= ? AND s.trial_end >= ?
        ORDER BY s.trial_end ASC`).all(cid, cutoff, today());
    } catch (_) { return []; }
  } catch (e: any) { return { error: e.message }; }
}

// F927: Auto-renewal opt-out tracking — track which clients have opted out
export function setSubscriptionAutoRenewal(subscriptionId: string, autoRenew: boolean) {
  try {
    try {
      db.getDb().prepare(`UPDATE subscriptions SET auto_renew = ?, updated_at = ? WHERE id = ? AND company_id = ?`)
        .run(autoRenew ? 1 : 0, now(), subscriptionId, db.getCurrentCompanyId());
      return { updated: true, auto_renew: autoRenew };
    } catch (_) { return { error: 'subscriptions table not available' }; }
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch IH: PDF & Brand Customization (F928-F932)
// ════════════════════════════════════════════════════════════════════

// F928: Create / update a PDF brand profile
export function upsertBrandProfile(opts: any) {
  try {
    const id = opts.id || uuid();
    const cid = db.getCurrentCompanyId();
    if (opts.is_default) {
      db.getDb().prepare(`UPDATE pdf_brand_profiles SET is_default = 0 WHERE company_id = ?`).run(cid);
    }
    if (opts.id) {
      db.getDb().prepare(`UPDATE pdf_brand_profiles SET name = ?, template_variant = ?, logo_path = ?, primary_color = ?, secondary_color = ?, accent_color = ?, font_family = ?, footer_text = ?, letterhead_html = ?, is_default = ?, updated_at = ? WHERE id = ?`)
        .run(opts.name, opts.template_variant || 'modern', opts.logo_path || null, opts.primary_color || '#3b82f6', opts.secondary_color || '#94a3b8', opts.accent_color || '#22c55e', opts.font_family || 'system', opts.footer_text || null, opts.letterhead_html || null, opts.is_default ? 1 : 0, now(), opts.id);
    } else {
      db.getDb().prepare(`INSERT INTO pdf_brand_profiles (id, company_id, name, template_variant, logo_path, primary_color, secondary_color, accent_color, font_family, footer_text, letterhead_html, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, cid, opts.name, opts.template_variant || 'modern', opts.logo_path || null, opts.primary_color || '#3b82f6', opts.secondary_color || '#94a3b8', opts.accent_color || '#22c55e', opts.font_family || 'system', opts.footer_text || null, opts.letterhead_html || null, opts.is_default ? 1 : 0);
    }
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F929: List brand profiles
export function listBrandProfiles() {
  try {
    return db.getDb().prepare(`SELECT * FROM pdf_brand_profiles WHERE company_id = ? ORDER BY is_default DESC, name`).all(db.getCurrentCompanyId());
  } catch (e: any) { return []; }
}

// F930: Get the default brand profile (used by the PDF generator)
export function getDefaultBrandProfile() {
  try {
    const cid = db.getCurrentCompanyId();
    const def = db.getDb().prepare(`SELECT * FROM pdf_brand_profiles WHERE company_id = ? AND is_default = 1 LIMIT 1`).get(cid) as any;
    if (def) return def;
    return db.getDb().prepare(`SELECT * FROM pdf_brand_profiles WHERE company_id = ? LIMIT 1`).get(cid) || null;
  } catch (e: any) { return null; }
}

// F931: Compute the watermark for an invoice (DRAFT/PAID/OVERDUE/VOID)
export function watermarkForInvoice(invoiceId: string): { watermark: string | null; color: string; opacity: number } {
  try {
    const inv = db.getDb().prepare(`SELECT status, due_date, amount_paid, total FROM invoices WHERE id = ? AND company_id = ?`).get(invoiceId, db.getCurrentCompanyId()) as any;
    if (!inv) return { watermark: null, color: '#000', opacity: 0 };
    if (inv.status === 'draft') return { watermark: 'DRAFT', color: '#94a3b8', opacity: 0.15 };
    if (inv.status === 'paid' || (inv.amount_paid || 0) >= (inv.total || 0) - 0.005) return { watermark: 'PAID', color: '#22c55e', opacity: 0.15 };
    if (inv.status === 'void' || inv.status === 'cancelled') return { watermark: 'VOID', color: '#ef4444', opacity: 0.20 };
    if (inv.status === 'written_off') return { watermark: 'WRITTEN OFF', color: '#ef4444', opacity: 0.20 };
    if (inv.due_date && new Date(inv.due_date + 'T00:00:00Z').getTime() < Date.now()) return { watermark: 'OVERDUE', color: '#ef4444', opacity: 0.15 };
    return { watermark: null, color: '#000', opacity: 0 };
  } catch (e: any) { return { watermark: null, color: '#000', opacity: 0 }; }
}

// F932: PDF preview as HTML — returns a styled HTML string (renderer can iframe it)
export function previewInvoiceHtml(invoiceId: string, brandProfileId?: string) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const inv = dbi.prepare(`SELECT i.*, c.name client_name, c.email client_email FROM invoices i LEFT JOIN clients c ON i.client_id = c.id WHERE i.id = ? AND i.company_id = ?`).get(invoiceId, cid) as any;
    if (!inv) return { error: 'Invoice not found' };
    const brand = brandProfileId
      ? dbi.prepare(`SELECT * FROM pdf_brand_profiles WHERE id = ? AND company_id = ?`).get(brandProfileId, cid) as any
      : getDefaultBrandProfile();
    const lines = dbi.prepare(`SELECT * FROM invoice_line_items WHERE invoice_id = ? ORDER BY sort_order`).all(invoiceId) as any[];
    const wm = watermarkForInvoice(invoiceId);
    const escape = (s: any) => s == null ? '' : String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string));
    const primary = brand?.primary_color || '#3b82f6';
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escape(inv.invoice_number)}</title>
      <style>
        body{font-family:${brand?.font_family || 'system-ui,-apple-system,sans-serif'};padding:40px;color:#1e293b;position:relative;max-width:800px;margin:0 auto}
        .wm{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:120px;font-weight:900;color:${wm.color};opacity:${wm.opacity};pointer-events:none;letter-spacing:8px}
        h1{color:${primary};border-bottom:3px solid ${primary};padding-bottom:8px}
        table{width:100%;border-collapse:collapse;margin:20px 0}
        th{background:${primary};color:white;padding:10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.05em}
        td{padding:10px;border-bottom:1px solid #e2e8f0;font-size:13px}
        tfoot td{font-weight:700;border-top:2px solid #1e293b}
        .meta{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:20px 0;font-size:13px}
        .meta strong{display:block;font-size:10px;text-transform:uppercase;color:#64748b;margin-bottom:4px}
      </style></head><body>
      ${wm.watermark ? `<div class="wm">${wm.watermark}</div>` : ''}
      <h1>${escape(inv.invoice_number || 'Invoice')}</h1>
      <div class="meta">
        <div><strong>To</strong>${escape(inv.client_name)}<br>${escape(inv.client_email)}</div>
        <div><strong>Date</strong>${escape(inv.date)}<br><strong style="margin-top:8px">Due Date</strong>${escape(inv.due_date)}</div>
      </div>
      <table>
        <thead><tr><th>Description</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>${lines.map(l => `<tr><td>${escape(l.description)}</td><td style="text-align:right">${l.quantity}</td><td style="text-align:right">$${(l.unit_price || 0).toFixed(2)}</td><td style="text-align:right">$${(l.amount || 0).toFixed(2)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="3" style="text-align:right">Total</td><td style="text-align:right">$${(inv.total || 0).toFixed(2)}</td></tr></tfoot>
      </table>
      ${brand?.footer_text ? `<div style="margin-top:40px;padding-top:20px;border-top:1px solid #e2e8f0;color:#64748b;font-size:11px;text-align:center">${escape(brand.footer_text)}</div>` : ''}
      </body></html>`;
    return { html };
  } catch (e: any) { return { error: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch II: Quote-to-Invoice Conversion (F933-F937)
// ════════════════════════════════════════════════════════════════════

// F933: Convert a quote → invoice (full or partial line selection)
export function convertQuoteToInvoice(opts: { quote_id: string; line_ids?: string[]; due_in_days?: number }) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const quote = dbi.prepare(`SELECT * FROM quotes WHERE id = ? AND company_id = ?`).get(opts.quote_id, cid) as any;
    if (!quote) return { error: 'Quote not found' };
    const lines = dbi.prepare(`SELECT * FROM quote_line_items WHERE quote_id = ? ORDER BY sort_order`).all(opts.quote_id) as any[];
    const selectedLines = opts.line_ids?.length ? lines.filter((l: any) => opts.line_ids!.includes(l.id)) : lines;
    if (selectedLines.length === 0) return { error: 'No lines to convert' };
    const subtotal = selectedLines.reduce((s, l) => s + (l.amount || (l.quantity || 1) * (l.unit_price || 0)), 0);
    const invId = uuid();
    const txn = dbi.transaction(() => {
      dbi.prepare(`INSERT INTO invoices (id, company_id, client_id, invoice_number, date, due_date, total, amount_paid, status, terms_text, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'draft', ?, ?, ?)`)
        .run(invId, cid, quote.client_id, `INV-${Date.now()}-${invId.slice(0, 6)}`, today(), advanceDays(today(), opts.due_in_days || 30), round2(subtotal), quote.terms_text || '', now(), now());
      let sortOrder = 0;
      for (const l of selectedLines) {
        dbi.prepare(`INSERT INTO invoice_line_items (id, invoice_id, description, quantity, unit_price, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(uuid(), invId, l.description, l.quantity || 1, l.unit_price || 0, l.amount || (l.quantity || 1) * (l.unit_price || 0), sortOrder++);
      }
      // Mark quote as converted
      dbi.prepare(`UPDATE quotes SET status = 'converted', converted_invoice_id = ?, converted_at = ?, updated_at = ? WHERE id = ?`)
        .run(invId, now(), now(), opts.quote_id);
    });
    txn();
    return { invoice_id: invId, line_count: selectedLines.length, total: round2(subtotal) };
  } catch (e: any) { return { error: e.message }; }
}

// F934: Quote → invoice funnel (conversion rate, avg cycle time)
export function quoteFunnelMetrics(opts?: { since?: string; until?: string }) {
  try {
    const since = opts?.since || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const until = opts?.until || today();
    const cid = db.getCurrentCompanyId();
    let rows: any[] = [];
    try {
      rows = db.getDb().prepare(`SELECT status, COUNT(*) c, AVG(CASE WHEN converted_at IS NOT NULL THEN julianday(converted_at) - julianday(date) END) avg_cycle_days
        FROM quotes WHERE company_id = ? AND date BETWEEN ? AND ?
        GROUP BY status`).all(cid, since, until) as any[];
    } catch (_) { return { error: 'quotes table not available' }; }
    const total = rows.reduce((s, r) => s + r.c, 0);
    const converted = rows.find(r => r.status === 'converted')?.c || 0;
    return { total_quotes: total, converted, conversion_rate_pct: total > 0 ? round2((converted / total) * 100) : 0, by_status: rows };
  } catch (e: any) { return { error: e.message }; }
}

// F935: Auto-convert accepted quotes — used by scheduled job
export function autoConvertAcceptedQuotes() {
  try {
    const cid = db.getCurrentCompanyId();
    let accepted: any[] = [];
    try {
      accepted = db.getDb().prepare(`SELECT id FROM quotes WHERE company_id = ? AND status = 'accepted' AND converted_invoice_id IS NULL`).all(cid) as any[];
    } catch (_) { return { converted: 0 }; }
    const results: any[] = [];
    for (const q of accepted) {
      const r = convertQuoteToInvoice({ quote_id: q.id });
      results.push({ quote_id: q.id, ...r });
    }
    return { converted: results.length, results };
  } catch (e: any) { return { error: e.message }; }
}

// F936: Get the revision history of a quote (if revisions tracked)
export function quoteRevisionHistory(quoteId: string) {
  try {
    try {
      return db.getDb().prepare(`SELECT * FROM quote_revisions WHERE quote_id = ? AND company_id = ? ORDER BY created_at ASC`).all(quoteId, db.getCurrentCompanyId());
    } catch (_) { return []; }
  } catch (e: any) { return []; }
}

// F937: List expired quotes that need follow-up
export function expiredQuotesNeedingFollowup() {
  try {
    return db.getDb().prepare(`SELECT q.*, c.name client_name FROM quotes q
      LEFT JOIN clients c ON q.client_id = c.id
      WHERE q.company_id = ? AND q.status IN ('sent', 'viewed')
      AND q.expiry_date IS NOT NULL AND q.expiry_date < date('now')
      ORDER BY q.expiry_date ASC LIMIT 50`).all(db.getCurrentCompanyId());
  } catch (e: any) { return []; }
}

// ════════════════════════════════════════════════════════════════════
// Batch IJ: Discounts & Promotions (F938-F942)
// ════════════════════════════════════════════════════════════════════

// F938: Create / update a coupon
export function upsertCoupon(opts: any) {
  try {
    const id = opts.id || uuid();
    const cid = db.getCurrentCompanyId();
    const code = String(opts.code || '').toUpperCase().trim();
    if (!code) return { error: 'Coupon code required' };
    if (opts.id) {
      db.getDb().prepare(`UPDATE invoice_coupons SET code = ?, description = ?, discount_type = ?, discount_value = ?, min_amount = ?, max_uses = ?, valid_from = ?, valid_until = ?, client_id = ?, active = ?, updated_at = ? WHERE id = ?`)
        .run(code, opts.description || null, opts.discount_type || 'percent', opts.discount_value || 0, opts.min_amount || null, opts.max_uses || null, opts.valid_from || null, opts.valid_until || null, opts.client_id || null, opts.active === false ? 0 : 1, now(), opts.id);
    } else {
      db.getDb().prepare(`INSERT INTO invoice_coupons (id, company_id, code, description, discount_type, discount_value, min_amount, max_uses, valid_from, valid_until, client_id, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
        .run(id, cid, code, opts.description || null, opts.discount_type || 'percent', opts.discount_value || 0, opts.min_amount || null, opts.max_uses || null, opts.valid_from || null, opts.valid_until || null, opts.client_id || null);
    }
    return { id, code };
  } catch (e: any) { return { error: e.message }; }
}

// F939: Validate a coupon code (returns the discount it would apply)
export function validateCoupon(code: string, opts?: { invoice_id?: string; amount?: number; client_id?: string }) {
  try {
    const c = db.getDb().prepare(`SELECT * FROM invoice_coupons WHERE company_id = ? AND code = ? AND active = 1`).get(db.getCurrentCompanyId(), String(code || '').toUpperCase().trim()) as any;
    if (!c) return { valid: false, reason: 'Code not found' };
    const todayStr = today();
    if (c.valid_from && todayStr < c.valid_from) return { valid: false, reason: `Not valid until ${c.valid_from}` };
    if (c.valid_until && todayStr > c.valid_until) return { valid: false, reason: `Expired on ${c.valid_until}` };
    if (c.max_uses && (c.times_used || 0) >= c.max_uses) return { valid: false, reason: 'Maximum uses reached' };
    if (c.client_id && opts?.client_id && c.client_id !== opts.client_id) return { valid: false, reason: 'Not valid for this client' };
    if (c.min_amount && opts?.amount && opts.amount < c.min_amount) return { valid: false, reason: `Requires min amount $${c.min_amount}` };
    const amount = opts?.amount || 0;
    const discount = c.discount_type === 'percent'
      ? round2(amount * (c.discount_value / 100))
      : Math.min(c.discount_value, amount);
    return { valid: true, coupon_id: c.id, discount: round2(discount), discount_type: c.discount_type, discount_value: c.discount_value };
  } catch (e: any) { return { valid: false, reason: e.message }; }
}

// F940: Redeem a coupon against an invoice (one-shot — increments use count)
export function redeemCoupon(opts: { coupon_id: string; invoice_id: string; discount_applied: number }) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    // Prevent double-redeem
    const existing = dbi.prepare(`SELECT id FROM invoice_coupon_redemptions WHERE company_id = ? AND coupon_id = ? AND invoice_id = ?`).get(cid, opts.coupon_id, opts.invoice_id) as any;
    if (existing) return { error: 'Coupon already redeemed for this invoice' };
    const id = uuid();
    const txn = dbi.transaction(() => {
      dbi.prepare(`INSERT INTO invoice_coupon_redemptions (id, company_id, coupon_id, invoice_id, discount_applied) VALUES (?, ?, ?, ?, ?)`)
        .run(id, cid, opts.coupon_id, opts.invoice_id, opts.discount_applied);
      dbi.prepare(`UPDATE invoice_coupons SET times_used = COALESCE(times_used, 0) + 1, updated_at = ? WHERE id = ?`).run(now(), opts.coupon_id);
    });
    txn();
    return { id, redeemed: true };
  } catch (e: any) { return { error: e.message }; }
}

// F941: Coupon performance report — revenue impact per coupon
export function couponPerformanceReport() {
  try {
    return db.getDb().prepare(`SELECT c.id, c.code, c.description, c.times_used, c.discount_type, c.discount_value,
      COALESCE(SUM(r.discount_applied), 0) total_discount_given,
      COUNT(r.id) redemption_count
      FROM invoice_coupons c
      LEFT JOIN invoice_coupon_redemptions r ON r.coupon_id = c.id
      WHERE c.company_id = ?
      GROUP BY c.id ORDER BY total_discount_given DESC`)
      .all(db.getCurrentCompanyId());
  } catch (e: any) { return []; }
}

// F942: Compute volume discount tier given a quantity
export function calculateVolumeDiscount(quantity: number, tiers: Array<{ min_qty: number; discount_pct: number }>) {
  try {
    const sorted = [...tiers].sort((a, b) => b.min_qty - a.min_qty);
    for (const t of sorted) {
      if (quantity >= t.min_qty) return { tier_min_qty: t.min_qty, discount_pct: t.discount_pct };
    }
    return { tier_min_qty: 0, discount_pct: 0 };
  } catch (e: any) { return { discount_pct: 0 }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch IK: Payment Processing Integration (F943-F947)
// ════════════════════════════════════════════════════════════════════

// F943: Create a payment intent record (mirrors what a Stripe webhook would store)
export function createPaymentIntent(opts: { invoice_id: string; provider: string; amount: number; currency?: string; payment_method_type?: string; external_intent_id?: string }) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO payment_intents (id, company_id, invoice_id, provider, external_intent_id, amount, currency, payment_method_type, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`)
      .run(id, db.getCurrentCompanyId(), opts.invoice_id, opts.provider, opts.external_intent_id || null, opts.amount, opts.currency || 'USD', opts.payment_method_type || null);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F944: Generate a QR code payload (data URL) for an invoice payment URL
// We return the payload string — the renderer turns it into a QR image via a JS lib.
export function generatePaymentQrPayload(invoiceId: string, baseUrl?: string) {
  try {
    const inv = db.getDb().prepare(`SELECT id, invoice_number, total, amount_paid, currency FROM invoices WHERE id = ? AND company_id = ?`).get(invoiceId, db.getCurrentCompanyId()) as any;
    if (!inv) return { error: 'Invoice not found' };
    const open = round2((inv.total || 0) - (inv.amount_paid || 0));
    const base = baseUrl || 'https://accounting.rmpgutah.us';
    const url = `${base}/pay/${invoiceId}?amount=${open}&currency=${inv.currency || 'USD'}`;
    // EMV-style structured payload (compatible with simple QR scanners showing "Pay $X to Y")
    return { qr_text: url, structured: { invoice: inv.invoice_number, amount: open, currency: inv.currency || 'USD' } };
  } catch (e: any) { return { error: e.message }; }
}

// F945: Render bank transfer instructions for an invoice (returns formatted HTML/text)
export function bankTransferInstructions(invoiceId: string) {
  try {
    const inv = db.getDb().prepare(`SELECT * FROM invoices WHERE id = ? AND company_id = ?`).get(invoiceId, db.getCurrentCompanyId()) as any;
    if (!inv) return { error: 'Invoice not found' };
    let bankInfo: any = {};
    try {
      // Look up company bank info from settings
      const setting = db.getDb().prepare(`SELECT value FROM settings WHERE company_id = ? AND key = 'bank_transfer_info' LIMIT 1`).get(db.getCurrentCompanyId()) as any;
      if (setting?.value) bankInfo = JSON.parse(setting.value);
    } catch (_) {/* no settings */}
    const open = round2((inv.total || 0) - (inv.amount_paid || 0));
    return {
      reference: inv.invoice_number,
      amount_due: open,
      currency: inv.currency || 'USD',
      bank_name: bankInfo.bank_name || '[Bank name not configured]',
      account_name: bankInfo.account_name || '[Account name not configured]',
      account_number_last4: bankInfo.account_last4 ? `••••${bankInfo.account_last4}` : '••••',
      routing_number_last4: bankInfo.routing_last4 ? `••••${bankInfo.routing_last4}` : '••••',
      swift: bankInfo.swift || null,
      iban: bankInfo.iban || null,
      memo: `Please include invoice # ${inv.invoice_number} as the payment memo.`,
    };
  } catch (e: any) { return { error: e.message }; }
}

// F946: Rank payment methods by success rate
export function paymentMethodSuccessRanking() {
  try {
    return db.getDb().prepare(`SELECT payment_method_type method,
      COUNT(*) attempts,
      COUNT(CASE WHEN status = 'succeeded' THEN 1 END) successes,
      ROUND(100.0 * COUNT(CASE WHEN status = 'succeeded' THEN 1 END) / COUNT(*), 1) success_rate
      FROM payment_intents WHERE company_id = ?
      AND created_at >= date('now', '-90 days')
      GROUP BY payment_method_type
      ORDER BY success_rate DESC`).all(db.getCurrentCompanyId());
  } catch (e: any) { return []; }
}

// F947: List failed payments queued for retry (provider returned a recoverable error)
export function failedPaymentRetryQueue() {
  try {
    return db.getDb().prepare(`SELECT pi.*, i.invoice_number, c.name client_name FROM payment_intents pi
      INNER JOIN invoices i ON pi.invoice_id = i.id
      LEFT JOIN clients c ON i.client_id = c.id
      WHERE pi.company_id = ? AND pi.status = 'failed'
      AND pi.created_at >= date('now', '-7 days')
      ORDER BY pi.created_at DESC`).all(db.getCurrentCompanyId());
  } catch (e: any) { return []; }
}

// ════════════════════════════════════════════════════════════════════
// Batch IL: International (F948-F952)
// ════════════════════════════════════════════════════════════════════

// F948: Get an invoice rendered in a target language (translation lookup)
const I18N_LABELS: Record<string, Record<string, string>> = {
  en: { invoice: 'Invoice', total: 'Total', tax: 'Tax', subtotal: 'Subtotal', due: 'Due', bill_to: 'Bill To' },
  es: { invoice: 'Factura', total: 'Total', tax: 'Impuesto', subtotal: 'Subtotal', due: 'Vence', bill_to: 'Facturar a' },
  fr: { invoice: 'Facture', total: 'Total', tax: 'TVA', subtotal: 'Sous-total', due: 'Échéance', bill_to: 'Facturer à' },
  de: { invoice: 'Rechnung', total: 'Gesamt', tax: 'MwSt.', subtotal: 'Zwischensumme', due: 'Fällig', bill_to: 'Rechnung an' },
  ja: { invoice: '請求書', total: '合計', tax: '税金', subtotal: '小計', due: '期日', bill_to: '請求先' },
  zh: { invoice: '发票', total: '总计', tax: '税', subtotal: '小计', due: '到期', bill_to: '收款方' },
};
export function getInvoiceI18nLabels(lang: string): Record<string, string> {
  return I18N_LABELS[lang.toLowerCase()] || I18N_LABELS.en;
}

// F949: Validate a VAT number format by country (basic — no online lookup)
export function validateVatNumber(country: string, vatNumber: string): { valid: boolean; reason?: string } {
  const v = String(vatNumber || '').replace(/\s+/g, '').toUpperCase();
  if (!v) return { valid: false, reason: 'VAT number empty' };
  // Basic per-country regexes — full VIES validation requires API call
  const patterns: Record<string, RegExp> = {
    DE: /^DE\d{9}$/,
    FR: /^FR[A-Z0-9]{2}\d{9}$/,
    GB: /^GB(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/,
    ES: /^ES[A-Z0-9]\d{7}[A-Z0-9]$/,
    IT: /^IT\d{11}$/,
    NL: /^NL\d{9}B\d{2}$/,
    SE: /^SE\d{12}$/,
    DK: /^DK\d{8}$/,
    AT: /^ATU\d{8}$/,
    BE: /^BE0\d{9}$/,
  };
  const country2 = country.toUpperCase().slice(0, 2);
  const re = patterns[country2];
  if (!re) return { valid: true, reason: 'No pattern available — accepted as-is' };
  if (!re.test(v)) return { valid: false, reason: `Doesn't match ${country2} VAT pattern` };
  return { valid: true };
}

// F950: Flag whether reverse-charge VAT applies (EU B2B cross-border)
export function shouldApplyReverseCharge(opts: { supplier_country: string; customer_country: string; customer_vat?: string; b2b: boolean }) {
  const supplier = (opts.supplier_country || '').toUpperCase().slice(0, 2);
  const customer = (opts.customer_country || '').toUpperCase().slice(0, 2);
  const EU = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'];
  const supplierIsEu = EU.includes(supplier);
  const customerIsEu = EU.includes(customer);
  const crossBorder = supplier !== customer;
  if (!supplierIsEu || !customerIsEu) return { apply: false, reason: 'Not an EU intra-community transaction' };
  if (!crossBorder) return { apply: false, reason: 'Domestic transaction — standard VAT applies' };
  if (!opts.b2b) return { apply: false, reason: 'B2C — origin-country VAT applies' };
  if (!opts.customer_vat) return { apply: false, reason: 'Customer VAT number required for reverse charge' };
  return { apply: true, note: 'VAT to be reverse-charged by customer per EU Article 196' };
}

// F951: Look up country-specific tax compliance rules (simplified)
const COUNTRY_TAX_RULES: Record<string, any> = {
  US: { sales_tax: true, vat: false, gst: false, withholding: false, invoice_lang: 'en' },
  GB: { sales_tax: false, vat: true, gst: false, vat_default_rate: 20, invoice_lang: 'en' },
  DE: { sales_tax: false, vat: true, gst: false, vat_default_rate: 19, invoice_lang: 'de' },
  FR: { sales_tax: false, vat: true, gst: false, vat_default_rate: 20, invoice_lang: 'fr' },
  CA: { sales_tax: false, vat: false, gst: true, gst_default_rate: 5, invoice_lang: 'en' },
  AU: { sales_tax: false, vat: false, gst: true, gst_default_rate: 10, invoice_lang: 'en' },
  JP: { sales_tax: false, vat: false, gst: true, consumption_tax: 10, invoice_lang: 'ja' },
  IN: { sales_tax: false, vat: false, gst: true, gst_default_rate: 18, invoice_lang: 'en' },
};
export function countryTaxRules(country: string) {
  const c = country.toUpperCase().slice(0, 2);
  return COUNTRY_TAX_RULES[c] || { sales_tax: false, vat: false, gst: false, invoice_lang: 'en', note: 'No specific rules — defaults apply' };
}

// F952: Currency exposure report — open invoices grouped by currency
export function currencyExposureReport() {
  try {
    return db.getDb().prepare(`SELECT COALESCE(currency, 'USD') currency,
      COUNT(*) open_count,
      SUM(total - COALESCE(amount_paid, 0)) open_total
      FROM invoices
      WHERE company_id = ? AND status NOT IN ('paid', 'cancelled', 'void', 'written_off', 'draft')
      GROUP BY COALESCE(currency, 'USD')
      ORDER BY open_total DESC`).all(db.getCurrentCompanyId());
  } catch (e: any) { return []; }
}

// ════════════════════════════════════════════════════════════════════
// Batch IM: Workflow Automation (F953-F957)
// ════════════════════════════════════════════════════════════════════

// F953: Create an invoice workflow rule (trigger + condition + action)
export function createWorkflowRule(opts: any) {
  try {
    const id = uuid();
    db.getDb().prepare(`INSERT INTO invoice_workflow_rules (id, company_id, name, trigger_event, condition_json, action_type, action_params_json, priority, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`)
      .run(id, db.getCurrentCompanyId(), opts.name, opts.trigger_event, JSON.stringify(opts.condition || {}), opts.action_type, JSON.stringify(opts.action_params || {}), opts.priority || 100);
    return { id };
  } catch (e: any) { return { error: e.message }; }
}

// F954: Evaluate workflow rules for a given trigger event + invoice
export function evaluateWorkflowRules(opts: { trigger_event: string; invoice_id: string }) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const inv = dbi.prepare(`SELECT * FROM invoices WHERE id = ? AND company_id = ?`).get(opts.invoice_id, cid) as any;
    if (!inv) return { fired: [] };
    const rules = dbi.prepare(`SELECT * FROM invoice_workflow_rules WHERE company_id = ? AND trigger_event = ? AND active = 1 ORDER BY priority ASC`).all(cid, opts.trigger_event) as any[];
    const fired: any[] = [];
    for (const r of rules) {
      const cond = JSON.parse(r.condition_json || '{}');
      // Simple condition matching: { min_amount, max_amount, client_id, status }
      if (cond.min_amount != null && inv.total < cond.min_amount) continue;
      if (cond.max_amount != null && inv.total > cond.max_amount) continue;
      if (cond.client_id && inv.client_id !== cond.client_id) continue;
      if (cond.status && inv.status !== cond.status) continue;
      dbi.prepare(`UPDATE invoice_workflow_rules SET last_fired_at = ?, fire_count = COALESCE(fire_count, 0) + 1 WHERE id = ?`).run(now(), r.id);
      fired.push({ rule_id: r.id, rule_name: r.name, action_type: r.action_type, action_params: JSON.parse(r.action_params_json || '{}') });
    }
    return { fired };
  } catch (e: any) { return { error: e.message }; }
}

// F955: Predict the actual payment date for an open invoice based on client history
export function predictPaymentDate(invoiceId: string) {
  try {
    const inv = db.getDb().prepare(`SELECT i.*, c.name client_name FROM invoices i LEFT JOIN clients c ON i.client_id = c.id WHERE i.id = ? AND i.company_id = ?`).get(invoiceId, db.getCurrentCompanyId()) as any;
    if (!inv) return { error: 'Invoice not found' };
    // Get client's avg days-to-pay
    const history = db.getDb().prepare(`SELECT AVG(julianday(updated_at) - julianday(date)) avg_days, COUNT(*) sample FROM invoices WHERE company_id = ? AND client_id = ? AND status = 'paid' AND date >= date('now', '-365 days')`).get(db.getCurrentCompanyId(), inv.client_id) as any;
    const avgDays = history?.avg_days || 30;
    const sample = history?.sample || 0;
    const issueDate = new Date(inv.date + 'T00:00:00Z');
    const predicted = new Date(issueDate.getTime() + avgDays * 86400000);
    return { predicted_date: predicted.toISOString().slice(0, 10), based_on_avg_days: Math.round(avgDays), sample_size: sample, confidence: sample >= 5 ? (sample >= 10 ? 'high' : 'medium') : 'low' };
  } catch (e: any) { return { error: e.message }; }
}

// F956: Suggest a category/account for a new invoice (most-common per client)
export function suggestInvoiceClassification(clientId: string) {
  try {
    const cid = db.getCurrentCompanyId();
    // Look at the most-recent paid invoices for this client and find common line accounts
    const lines = db.getDb().prepare(`SELECT eli.account_id, COUNT(*) freq FROM invoice_line_items eli
      INNER JOIN invoices i ON eli.invoice_id = i.id
      WHERE i.company_id = ? AND i.client_id = ? AND eli.account_id IS NOT NULL
      GROUP BY eli.account_id ORDER BY freq DESC LIMIT 5`).all(cid, clientId) as any[];
    return { suggested_accounts: lines };
  } catch (e: any) { return { suggested_accounts: [] }; }
}

// F957: Should an invoice require approval before sending? (uses approval rules + conditional)
export function shouldRequireApproval(invoiceId: string): { required: boolean; reason?: string; approver_user_id?: string | null } {
  try {
    const dbi = db.getDb();
    const inv = dbi.prepare(`SELECT * FROM invoices WHERE id = ? AND company_id = ?`).get(invoiceId, db.getCurrentCompanyId()) as any;
    if (!inv) return { required: false, reason: 'Invoice not found' };
    const rules = dbi.prepare(`SELECT * FROM invoice_approval_rules WHERE company_id = ? AND active = 1 ORDER BY priority ASC`).all(db.getCurrentCompanyId()) as any[];
    for (const r of rules) {
      if (r.min_amount != null && inv.total < r.min_amount) continue;
      if (r.max_amount != null && inv.total > r.max_amount) continue;
      if (r.client_id && inv.client_id !== r.client_id) continue;
      return { required: true, reason: `Rule matched: ${r.name}`, approver_user_id: r.approver_user_id };
    }
    return { required: false, reason: 'No matching approval rule' };
  } catch (e: any) { return { required: false, reason: e.message }; }
}

// ════════════════════════════════════════════════════════════════════
// Batch IN: Client Portal & Reporting (F958-F962)
// ════════════════════════════════════════════════════════════════════

// F958: Issue a secure client portal token (returns a URL the client can use)
export function issueClientPortalToken(opts: { client_id: string; invoice_id?: string; scope?: string; valid_days?: number }) {
  try {
    const id = uuid();
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + (opts.valid_days || 30) * 86400000).toISOString();
    db.getDb().prepare(`INSERT INTO client_portal_tokens (id, company_id, client_id, token, scope, invoice_id, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, db.getCurrentCompanyId(), opts.client_id, token, opts.scope || 'invoices', opts.invoice_id || null, expiresAt);
    return { id, token, expires_at: expiresAt };
  } catch (e: any) { return { error: e.message }; }
}

// F959: Generate a rolling-balance statement for a client over a date range
export function clientStatement(opts: { client_id: string; since: string; until?: string }) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const until = opts.until || today();
    const openingBalance = (dbi.prepare(`SELECT COALESCE(SUM(total - COALESCE(amount_paid, 0)), 0) ob FROM invoices WHERE company_id = ? AND client_id = ? AND date < ?`).get(cid, opts.client_id, opts.since) as any)?.ob || 0;
    const invoices = dbi.prepare(`SELECT date, invoice_number, total, amount_paid, status FROM invoices WHERE company_id = ? AND client_id = ? AND date BETWEEN ? AND ? ORDER BY date ASC`).all(cid, opts.client_id, opts.since, until) as any[];
    let running = openingBalance;
    const lines = invoices.map((inv: any) => {
      running = round2(running + (inv.total || 0) - (inv.amount_paid || 0));
      return { date: inv.date, invoice_number: inv.invoice_number, charge: inv.total, payment: inv.amount_paid, balance: running };
    });
    return { opening_balance: round2(openingBalance), closing_balance: round2(running), lines };
  } catch (e: any) { return { error: e.message }; }
}

// F960: Revenue forecast — projection of expected cash inflow for next N weeks
export function revenueForecast(weeksAhead = 12) {
  try {
    const cid = db.getCurrentCompanyId();
    const cutoff = new Date(Date.now() + weeksAhead * 7 * 86400000).toISOString().slice(0, 10);
    const open = db.getDb().prepare(`SELECT due_date, SUM(total - COALESCE(amount_paid, 0)) expected
      FROM invoices WHERE company_id = ? AND status NOT IN ('paid', 'cancelled', 'void', 'draft', 'written_off')
      AND due_date <= ? GROUP BY due_date ORDER BY due_date ASC`).all(cid, cutoff) as any[];
    // Bucket into weekly tranches
    const buckets: Record<string, number> = {};
    const todayD = new Date(today() + 'T00:00:00Z').getTime();
    for (const r of open) {
      const dueT = new Date(r.due_date + 'T00:00:00Z').getTime();
      const week = Math.max(0, Math.floor((dueT - todayD) / (7 * 86400000)));
      buckets[`week_${week}`] = round2((buckets[`week_${week}`] || 0) + (r.expected || 0));
    }
    return { weeks_ahead: weeksAhead, total_expected: round2(open.reduce((s, r) => s + (r.expected || 0), 0)), by_week: buckets };
  } catch (e: any) { return { error: e.message }; }
}

// F961: Compute client lifetime value (LTV) snapshot
export function computeClientLtv(clientId: string) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const stats = dbi.prepare(`SELECT
      COALESCE(SUM(amount_paid), 0) total_revenue,
      COUNT(CASE WHEN status = 'paid' THEN 1 END) paid_count,
      AVG(amount_paid) avg_invoice_value,
      MIN(date) first_date,
      MAX(date) last_date
      FROM invoices WHERE company_id = ? AND client_id = ? AND status NOT IN ('cancelled', 'void')`).get(cid, clientId) as any;
    if (!stats || stats.paid_count === 0) return { client_id: clientId, total_revenue: 0, projected_ltv: 0 };
    const firstDate = stats.first_date ? new Date(stats.first_date + 'T00:00:00Z').getTime() : Date.now();
    const lastDate = stats.last_date ? new Date(stats.last_date + 'T00:00:00Z').getTime() : Date.now();
    const monthsActive = Math.max(1, Math.round((lastDate - firstDate) / (30 * 86400000)));
    const monthlyRevenue = (stats.total_revenue || 0) / monthsActive;
    // Simple LTV projection: monthly revenue × 24 months (industry-typical horizon)
    const projectedLtv = round2(monthlyRevenue * 24);
    // Cache snapshot
    const id = uuid();
    db.getDb().prepare(`INSERT INTO client_ltv_snapshots (id, company_id, client_id, total_revenue, paid_invoice_count, avg_invoice_value, first_invoice_date, last_invoice_date, months_active, projected_ltv) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, cid, clientId, round2(stats.total_revenue), stats.paid_count, round2(stats.avg_invoice_value || 0), stats.first_date, stats.last_date, monthsActive, projectedLtv);
    return { client_id: clientId, total_revenue: round2(stats.total_revenue), paid_invoice_count: stats.paid_count, avg_invoice_value: round2(stats.avg_invoice_value || 0), months_active: monthsActive, projected_ltv: projectedLtv };
  } catch (e: any) { return { error: e.message }; }
}

// F962: Predict churn risk for a client (factors: invoice gap, payment lag trend, dispute count)
export function predictClientChurn(clientId: string) {
  try {
    const cid = db.getCurrentCompanyId();
    const dbi = db.getDb();
    const stats = dbi.prepare(`SELECT
      MAX(date) last_invoice_date,
      COUNT(*) total_invoices,
      AVG(julianday(updated_at) - julianday(date)) avg_payment_lag
      FROM invoices WHERE company_id = ? AND client_id = ? AND status = 'paid' AND date >= date('now', '-365 days')`).get(cid, clientId) as any;
    if (!stats || !stats.last_invoice_date) return { client_id: clientId, risk_score: 50, risk_level: 'unknown', factors: ['No recent paid invoices'] };
    let score = 100;
    const factors: string[] = [];
    const daysSince = Math.floor((Date.now() - new Date(stats.last_invoice_date + 'T00:00:00Z').getTime()) / 86400000);
    if (daysSince > 180) { score -= 40; factors.push(`No invoice for ${daysSince}d (−40)`); }
    else if (daysSince > 90) { score -= 25; factors.push(`Last invoice ${daysSince}d ago (−25)`); }
    else if (daysSince > 60) { score -= 10; factors.push(`Last invoice ${daysSince}d ago (−10)`); }
    if ((stats.avg_payment_lag || 0) > 60) { score -= 15; factors.push(`Avg payment lag ${Math.round(stats.avg_payment_lag)}d (−15)`); }
    if ((stats.total_invoices || 0) < 3) { score -= 15; factors.push('Few historical invoices (−15)'); }
    // Check for recent disputes/chargebacks
    try {
      const disputes = (dbi.prepare(`SELECT COUNT(*) c FROM chargebacks WHERE company_id = ? AND client_id = ?`).get(cid, clientId) as any)?.c || 0;
      if (disputes > 0) { score -= 20; factors.push(`${disputes} chargeback(s) (−20)`); }
    } catch (_) {}
    score = Math.max(0, Math.min(100, score));
    // RISK SCORE INVERSE: 100 = healthy, 0 = critical
    const risk = score >= 75 ? 'low' : score >= 50 ? 'medium' : score >= 25 ? 'high' : 'critical';
    try {
      db.getDb().prepare(`INSERT INTO client_churn_predictions (id, company_id, client_id, risk_score, factors_json, risk_level, days_since_last_invoice, avg_payment_lag) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(client_id) DO UPDATE SET risk_score = excluded.risk_score, factors_json = excluded.factors_json, risk_level = excluded.risk_level, days_since_last_invoice = excluded.days_since_last_invoice, avg_payment_lag = excluded.avg_payment_lag, computed_at = datetime('now')`)
        .run(uuid(), cid, clientId, score, JSON.stringify(factors), risk, daysSince, stats.avg_payment_lag || 0);
    } catch (_) {}
    return { client_id: clientId, risk_score: score, risk_level: risk, factors, days_since_last_invoice: daysSince };
  } catch (e: any) { return { error: e.message }; }
}
