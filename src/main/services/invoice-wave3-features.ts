// ─── Invoice System Wave 3: 80 features (IV1–IV80) ───────
//
// Wires 19 unwired invoice tables + adds analytics, workflow,
// and cross-module integration features.

import { randomUUID as uuid } from 'crypto';
import * as db from '../database';

const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);
const round2 = (n: number) => Math.round((n || 0) * 100) / 100;

// ════════════════════════════════════════════════════════════
// IV1–IV8: Coupons & Discounts
// ════════════════════════════════════════════════════════════
export function listCoupons(companyId: string, activeOnly = false) {
  return db.getDb().prepare(`SELECT * FROM invoice_coupons WHERE company_id = ?${activeOnly ? ' AND active = 1' : ''} ORDER BY code`).all(companyId);
}
export function upsertCoupon(c: any) {
  const dbi = db.getDb();
  if (c.id) { dbi.prepare(`UPDATE invoice_coupons SET code=?,description=?,discount_type=?,discount_value=?,min_amount=?,max_uses=?,valid_from=?,valid_until=?,client_id=?,active=?,updated_at=datetime('now') WHERE id=?`).run(c.code, c.description || '', c.discount_type, c.discount_value, c.min_amount ?? null, c.max_uses ?? null, c.valid_from || null, c.valid_until || null, c.client_id || null, c.active !== false ? 1 : 0, c.id); return c; }
  const id = uuid(); dbi.prepare(`INSERT INTO invoice_coupons (id, company_id, code, description, discount_type, discount_value, min_amount, max_uses, times_used, valid_from, valid_until, client_id, active, created_at) VALUES (?,?,?,?,?,?,?,?,0,?,?,?,1,datetime('now'))`).run(id, c.company_id, c.code, c.description || '', c.discount_type, c.discount_value, c.min_amount ?? null, c.max_uses ?? null, c.valid_from || null, c.valid_until || null, c.client_id || null); return { ...c, id };
}
export function deleteCoupon(id: string) { db.getDb().prepare('DELETE FROM invoice_coupons WHERE id = ?').run(id); }
export function redeemCoupon(companyId: string, couponCode: string, invoiceId: string, invoiceTotal: number) {
  const dbi = db.getDb();
  const coupon = dbi.prepare(`SELECT * FROM invoice_coupons WHERE company_id = ? AND code = ? AND active = 1`).get(companyId, couponCode) as any;
  if (!coupon) return { error: 'Invalid or inactive coupon code' };
  if (coupon.valid_until && coupon.valid_until < today()) return { error: 'Coupon expired' };
  if (coupon.max_uses && coupon.times_used >= coupon.max_uses) return { error: 'Coupon usage limit reached' };
  if (coupon.min_amount && invoiceTotal < coupon.min_amount) return { error: `Minimum invoice amount: $${coupon.min_amount}` };
  const discount = coupon.discount_type === 'percent' ? round2(invoiceTotal * (coupon.discount_value / 100)) : round2(Math.min(coupon.discount_value, invoiceTotal));
  dbi.prepare(`INSERT INTO invoice_coupon_redemptions (id, company_id, coupon_id, invoice_id, discount_applied, redeemed_at) VALUES (?,?,?,?,?,datetime('now'))`).run(uuid(), companyId, coupon.id, invoiceId, discount);
  dbi.prepare(`UPDATE invoice_coupons SET times_used = times_used + 1, updated_at = datetime('now') WHERE id = ?`).run(coupon.id);
  return { ok: true, discount, coupon_id: coupon.id };
}
export function couponRedemptionHistory(companyId: string) {
  return db.getDb().prepare(`SELECT cr.*, ic.code, ic.description FROM invoice_coupon_redemptions cr JOIN invoice_coupons ic ON ic.id = cr.coupon_id WHERE cr.company_id = ? ORDER BY cr.redeemed_at DESC LIMIT 50`).all(companyId);
}
export function couponSummary(companyId: string) {
  const dbi = db.getDb();
  const active = (dbi.prepare(`SELECT COUNT(*) c FROM invoice_coupons WHERE company_id = ? AND active = 1`).get(companyId) as any)?.c || 0;
  const totalRedeemed = (dbi.prepare(`SELECT COUNT(*) c FROM invoice_coupon_redemptions WHERE company_id = ?`).get(companyId) as any)?.c || 0;
  const totalDiscount = (dbi.prepare(`SELECT COALESCE(SUM(discount_applied),0) t FROM invoice_coupon_redemptions WHERE company_id = ?`).get(companyId) as any)?.t || 0;
  return { activeCoupons: active, totalRedemptions: totalRedeemed, totalDiscountGiven: round2(totalDiscount) };
}
export function validateCoupon(companyId: string, code: string) {
  const c = db.getDb().prepare(`SELECT * FROM invoice_coupons WHERE company_id = ? AND code = ? AND active = 1`).get(companyId, code) as any;
  if (!c) return { valid: false, reason: 'Not found' };
  if (c.valid_until && c.valid_until < today()) return { valid: false, reason: 'Expired' };
  if (c.max_uses && c.times_used >= c.max_uses) return { valid: false, reason: 'Usage limit reached' };
  return { valid: true, coupon: c };
}
export function expiredCoupons(companyId: string) {
  return db.getDb().prepare(`SELECT * FROM invoice_coupons WHERE company_id = ? AND valid_until IS NOT NULL AND valid_until < ? ORDER BY valid_until DESC`).all(companyId, today());
}

// ════════════════════════════════════════════════════════════
// IV9–IV14: Credit Memos
// ════════════════════════════════════════════════════════════
export function listCreditMemos(companyId: string, clientId?: string) {
  let sql = 'SELECT cm.*, i.invoice_number FROM invoice_credit_memos cm LEFT JOIN invoices i ON i.id = cm.invoice_id WHERE cm.company_id = ?';
  const p: any[] = [companyId]; if (clientId) { sql += ' AND cm.client_id = ?'; p.push(clientId); }
  return db.getDb().prepare(sql + ' ORDER BY cm.issued_date DESC').all(...p);
}
export function createCreditMemo(cm: any) {
  const id = uuid(); const num = 'CM-' + Date.now().toString(36).toUpperCase();
  db.getDb().prepare(`INSERT INTO invoice_credit_memos (id, company_id, invoice_id, client_id, memo_number, amount, reason, issued_date, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))`).run(id, cm.company_id, cm.invoice_id, cm.client_id || null, num, cm.amount, cm.reason || '', cm.issued_date || today(), 'issued');
  return { id, memo_number: num };
}
export function applyCreditMemo(memoId: string, toInvoiceId: string) {
  const dbi = db.getDb();
  const memo = dbi.prepare('SELECT * FROM invoice_credit_memos WHERE id = ?').get(memoId) as any;
  if (!memo || memo.status !== 'issued') return { error: 'Credit memo not available' };
  dbi.prepare(`UPDATE invoice_credit_memos SET applied_to_invoice_id = ?, status = 'applied', updated_at = datetime('now') WHERE id = ?`).run(toInvoiceId, memoId);
  dbi.prepare(`UPDATE invoices SET amount_paid = COALESCE(amount_paid,0) + ?, updated_at = datetime('now') WHERE id = ?`).run(memo.amount, toInvoiceId);
  return { ok: true, applied: memo.amount };
}
export function voidCreditMemo(id: string) { db.getDb().prepare(`UPDATE invoice_credit_memos SET status = 'voided', updated_at = datetime('now') WHERE id = ?`).run(id); }
export function creditMemoSummary(companyId: string) {
  const dbi = db.getDb();
  const issued = (dbi.prepare(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) t FROM invoice_credit_memos WHERE company_id = ? AND status = 'issued'`).get(companyId) as any);
  const applied = (dbi.prepare(`SELECT COUNT(*) c, COALESCE(SUM(amount),0) t FROM invoice_credit_memos WHERE company_id = ? AND status = 'applied'`).get(companyId) as any);
  return { issuedCount: issued?.c || 0, issuedTotal: round2(issued?.t || 0), appliedCount: applied?.c || 0, appliedTotal: round2(applied?.t || 0) };
}
export function clientCreditBalance(companyId: string, clientId: string) {
  const r = db.getDb().prepare(`SELECT COALESCE(SUM(amount),0) t FROM invoice_credit_memos WHERE company_id = ? AND client_id = ? AND status = 'issued'`).get(companyId, clientId) as any;
  return { clientId, availableCredit: round2(r?.t || 0) };
}

// ════════════════════════════════════════════════════════════
// IV15–IV20: Payment Plans
// ════════════════════════════════════════════════════════════
export function createPaymentPlan(plan: any) {
  const dbi = db.getDb();
  const id = uuid();
  const installmentAmt = round2((plan.total_amount || 0) / (plan.installment_count || 1));
  dbi.prepare(`INSERT INTO invoice_payment_plans (id, invoice_id, company_id, plan_name, total_amount, installment_count, installment_amount, frequency, start_date, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))`).run(id, plan.invoice_id, plan.company_id, plan.plan_name || 'Payment Plan', plan.total_amount, plan.installment_count || 1, installmentAmt, plan.frequency || 'monthly', plan.start_date || today(), 'active');
  // Generate installment rows
  const ins = dbi.prepare('INSERT INTO invoice_payment_plan_installments (id, plan_id, installment_number, due_date, amount, paid_amount, status) VALUES (?,?,?,?,?,0,?)');
  const freqDays: Record<string, number> = { weekly: 7, biweekly: 14, monthly: 30, quarterly: 91 };
  const step = freqDays[plan.frequency] || 30;
  let cursor = new Date((plan.start_date || today()) + 'T12:00:00');
  for (let i = 1; i <= (plan.installment_count || 1); i++) {
    const due = cursor.toISOString().slice(0, 10);
    ins.run(uuid(), id, i, due, installmentAmt, 'pending');
    cursor = new Date(cursor.getTime() + step * 86400000);
  }
  return { id, installments: plan.installment_count || 1 };
}
export function listPaymentPlans(companyId: string, invoiceId?: string) {
  let sql = 'SELECT * FROM invoice_payment_plans WHERE company_id = ?';
  const p: any[] = [companyId]; if (invoiceId) { sql += ' AND invoice_id = ?'; p.push(invoiceId); }
  return db.getDb().prepare(sql + ' ORDER BY created_at DESC').all(...p);
}
export function paymentPlanInstallments(planId: string) {
  return db.getDb().prepare('SELECT * FROM invoice_payment_plan_installments WHERE plan_id = ? ORDER BY installment_number').all(planId);
}
export function recordInstallmentPayment(installmentId: string, amount: number) {
  const dbi = db.getDb();
  dbi.prepare(`UPDATE invoice_payment_plan_installments SET paid_amount = COALESCE(paid_amount,0) + ?, paid_at = datetime('now'), status = CASE WHEN COALESCE(paid_amount,0) + ? >= amount THEN 'paid' ELSE 'partial' END WHERE id = ?`).run(amount, amount, installmentId);
  return { ok: true };
}
export function overdueInstallments(companyId: string) {
  return db.getDb().prepare(`SELECT ppi.*, pp.plan_name, pp.invoice_id, i.invoice_number FROM invoice_payment_plan_installments ppi JOIN invoice_payment_plans pp ON pp.id = ppi.plan_id JOIN invoices i ON i.id = pp.invoice_id WHERE pp.company_id = ? AND ppi.status IN ('pending','partial') AND ppi.due_date < date('now') ORDER BY ppi.due_date`).all(companyId);
}
export function cancelPaymentPlan(planId: string) { db.getDb().prepare(`UPDATE invoice_payment_plans SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`).run(planId); }

// ════════════════════════════════════════════════════════════
// IV21–IV26: Collection Scores & DSO
// ════════════════════════════════════════════════════════════
export function computeCollectionScore(invoiceId: string) {
  const dbi = db.getDb();
  const inv = dbi.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId) as any;
  if (!inv) return null;
  let score = 100;
  const factors: string[] = [];
  const daysOut = Math.max(0, Math.round((Date.now() - new Date(inv.due_date + 'T12:00:00').getTime()) / 86400000));
  if (daysOut > 0) { score -= Math.min(40, daysOut); factors.push(`${daysOut} days overdue (-${Math.min(40, daysOut)})`); }
  if ((inv.amount_paid || 0) > 0) { score += 10; factors.push('Partial payment received (+10)'); }
  if (inv.total > 5000) { score -= 10; factors.push('High value invoice (-10)'); }
  score = Math.max(0, Math.min(100, score));
  const risk = score >= 70 ? 'low' : score >= 40 ? 'medium' : 'high';
  const existing = dbi.prepare('SELECT id FROM invoice_collection_scores WHERE invoice_id = ?').get(invoiceId) as any;
  if (existing) dbi.prepare(`UPDATE invoice_collection_scores SET score=?, factors_json=?, risk_level=?, computed_at=datetime('now') WHERE id=?`).run(score, JSON.stringify(factors), risk, existing.id);
  else dbi.prepare(`INSERT INTO invoice_collection_scores (id, company_id, invoice_id, score, factors_json, risk_level) VALUES (?,?,?,?,?,?)`).run(uuid(), inv.company_id, invoiceId, score, JSON.stringify(factors), risk);
  return { invoice_id: invoiceId, score, risk_level: risk, factors };
}
export function bulkComputeCollectionScores(companyId: string) {
  const invoices = db.getDb().prepare(`SELECT id FROM invoices WHERE company_id = ? AND status IN ('sent','partial','overdue')`).all(companyId) as any[];
  let computed = 0;
  for (const inv of invoices) { computeCollectionScore(inv.id); computed++; }
  return { computed };
}
export function collectionScoreBoard(companyId: string) {
  return db.getDb().prepare(`SELECT cs.*, i.invoice_number, i.total, i.amount_paid, i.due_date, c.name AS client_name FROM invoice_collection_scores cs JOIN invoices i ON i.id = cs.invoice_id LEFT JOIN clients c ON c.id = i.client_id WHERE cs.company_id = ? ORDER BY cs.score LIMIT 30`).all(companyId);
}
export function computeDSO(companyId: string, days = 90) {
  const dbi = db.getDb();
  const revenue = (dbi.prepare(`SELECT COALESCE(SUM(total),0) t FROM invoices WHERE company_id = ? AND issue_date >= date('now', '-' || ? || ' days')`).get(companyId, days) as any)?.t || 0;
  const ar = (dbi.prepare(`SELECT COALESCE(SUM(total - COALESCE(amount_paid,0)),0) t FROM invoices WHERE company_id = ? AND status IN ('sent','partial','overdue')`).get(companyId) as any)?.t || 0;
  const dso = revenue > 0 ? round2((ar / revenue) * days) : 0;
  // Cache it
  const existing = dbi.prepare(`SELECT id FROM invoice_dso_cache WHERE company_id = ? AND client_id IS NULL AND period_days = ?`).get(companyId, days) as any;
  if (existing) dbi.prepare(`UPDATE invoice_dso_cache SET dso_days = ?, computed_at = datetime('now') WHERE id = ?`).run(dso, existing.id);
  else dbi.prepare(`INSERT INTO invoice_dso_cache (id, company_id, client_id, period_days, dso_days, sample_invoices) VALUES (?,?,NULL,?,?,?)`).run(uuid(), companyId, days, dso, 0);
  return { dso_days: dso, ar_balance: round2(ar), period_revenue: round2(revenue), period_days: days };
}
export function dsoByClient(companyId: string) {
  return db.getDb().prepare(`SELECT c.id, c.name, ROUND(SUM(i.total - COALESCE(i.amount_paid,0)),2) AS ar_balance, ROUND(AVG(julianday('now') - julianday(i.due_date)),0) AS avg_days_past_due, COUNT(*) AS open_invoices FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.company_id = ? AND i.status IN ('sent','partial','overdue') GROUP BY c.id ORDER BY ar_balance DESC`).all(companyId);
}
export function dsoTrend(companyId: string) {
  return db.getDb().prepare(`SELECT * FROM invoice_dso_cache WHERE company_id = ? AND client_id IS NULL ORDER BY computed_at DESC LIMIT 12`).all(companyId);
}

// ════════════════════════════════════════════════════════════
// IV27–IV32: Approval Workflow
// ════════════════════════════════════════════════════════════
export function listApprovalRules(companyId: string) { return db.getDb().prepare('SELECT * FROM invoice_approval_rules WHERE company_id = ? ORDER BY priority').all(companyId); }
export function upsertApprovalRule(rule: any) {
  const dbi = db.getDb();
  if (rule.id) { dbi.prepare(`UPDATE invoice_approval_rules SET name=?,priority=?,min_amount=?,max_amount=?,client_id=?,approver_user_id=?,require_n_approvers=?,active=?,updated_at=datetime('now') WHERE id=?`).run(rule.name, rule.priority ?? 100, rule.min_amount ?? null, rule.max_amount ?? null, rule.client_id || null, rule.approver_user_id || null, rule.require_n_approvers ?? 1, rule.active !== false ? 1 : 0, rule.id); return rule; }
  const id = uuid(); dbi.prepare(`INSERT INTO invoice_approval_rules (id, company_id, name, priority, min_amount, max_amount, client_id, approver_user_id, require_n_approvers, active, created_at) VALUES (?,?,?,?,?,?,?,?,?,1,datetime('now'))`).run(id, rule.company_id, rule.name, rule.priority ?? 100, rule.min_amount ?? null, rule.max_amount ?? null, rule.client_id || null, rule.approver_user_id || null, rule.require_n_approvers ?? 1); return { ...rule, id };
}
export function deleteApprovalRule(id: string) { db.getDb().prepare('DELETE FROM invoice_approval_rules WHERE id = ?').run(id); }
export function submitForApproval(invoiceId: string, submittedBy: string) {
  db.getDb().prepare(`INSERT INTO invoice_approval_steps (id, invoice_id, step_number, approver_user_id, action, comment, created_at) VALUES (?,?,1,?,'submitted',?,datetime('now'))`).run(uuid(), invoiceId, submittedBy, 'Submitted for approval');
  return { ok: true };
}
export function approveInvoice(invoiceId: string, approverUserId: string, comment?: string) {
  db.getDb().prepare(`INSERT INTO invoice_approval_steps (id, invoice_id, step_number, approver_user_id, action, acted_at, comment, created_at) VALUES (?,?,(SELECT COALESCE(MAX(step_number),0)+1 FROM invoice_approval_steps WHERE invoice_id = ?),?,'approved',datetime('now'),?,datetime('now'))`).run(uuid(), invoiceId, invoiceId, approverUserId, comment || '');
  return { ok: true };
}
export function approvalHistory(invoiceId: string) { return db.getDb().prepare('SELECT * FROM invoice_approval_steps WHERE invoice_id = ? ORDER BY step_number').all(invoiceId); }

// ════════════════════════════════════════════════════════════
// IV33–IV38: Templates & Line Templates
// ════════════════════════════════════════════════════════════
export function listInvoiceTemplates(companyId: string) { return db.getDb().prepare('SELECT * FROM invoice_templates WHERE company_id = ? ORDER BY is_default DESC, template_name').all(companyId); }
export function upsertInvoiceTemplate(tpl: any) {
  const dbi = db.getDb();
  if (tpl.id) { dbi.prepare(`UPDATE invoice_templates SET template_name=?,template_data=?,number_prefix=?,is_default=?,updated_at=datetime('now') WHERE id=?`).run(tpl.template_name, JSON.stringify(tpl.template_data || {}), tpl.number_prefix || '', tpl.is_default ? 1 : 0, tpl.id); return tpl; }
  const id = uuid(); dbi.prepare(`INSERT INTO invoice_templates (id, company_id, template_name, template_data, number_prefix, is_default, created_at, updated_at) VALUES (?,?,?,?,?,?,datetime('now'),datetime('now'))`).run(id, tpl.company_id, tpl.template_name, JSON.stringify(tpl.template_data || {}), tpl.number_prefix || '', tpl.is_default ? 1 : 0); return { ...tpl, id };
}
export function deleteInvoiceTemplate(id: string) { db.getDb().prepare('DELETE FROM invoice_templates WHERE id = ?').run(id); }
export function listLineTemplates(companyId: string) { return db.getDb().prepare('SELECT * FROM invoice_line_templates WHERE company_id = ? ORDER BY times_used DESC').all(companyId); }
export function upsertLineTemplate(lt: any) {
  const dbi = db.getDb();
  if (lt.id) { dbi.prepare(`UPDATE invoice_line_templates SET name=?,description=?,lines_json=?,visibility=?,updated_at=datetime('now') WHERE id=?`).run(lt.name, lt.description || '', JSON.stringify(lt.lines || []), lt.visibility || 'private', lt.id); return lt; }
  const id = uuid(); dbi.prepare(`INSERT INTO invoice_line_templates (id, company_id, name, description, lines_json, times_used, owner_user_id, visibility, created_at) VALUES (?,?,?,?,?,0,?,?,datetime('now'))`).run(id, lt.company_id, lt.name, lt.description || '', JSON.stringify(lt.lines || []), lt.owner_user_id || '', lt.visibility || 'private'); return { ...lt, id };
}
export function deleteLineTemplate(id: string) { db.getDb().prepare('DELETE FROM invoice_line_templates WHERE id = ?').run(id); }

// ════════════════════════════════════════════════════════════
// IV39–IV44: Email & View Tracking
// ════════════════════════════════════════════════════════════
export function logInvoiceEmail(entry: any) {
  const id = uuid(); db.getDb().prepare(`INSERT INTO invoice_email_log (id, invoice_id, recipient_email, subject, sent_at, status, opened_at) VALUES (?,?,?,?,datetime('now'),?,NULL)`).run(id, entry.invoice_id, entry.recipient_email, entry.subject || '', 'sent'); return { id };
}
export function invoiceEmailHistory(invoiceId: string) { return db.getDb().prepare('SELECT * FROM invoice_email_log WHERE invoice_id = ? ORDER BY sent_at DESC').all(invoiceId); }
export function logInvoiceView(entry: any) {
  const id = uuid(); db.getDb().prepare(`INSERT INTO invoice_view_logs (id, company_id, invoice_id, viewed_by, viewed_at, ip_address, user_agent) VALUES (?,?,?,?,datetime('now'),?,?)`).run(id, entry.company_id, entry.invoice_id, entry.viewed_by || '', entry.ip_address || '', entry.user_agent || ''); return { id };
}
export function invoiceViewHistory(invoiceId: string) { return db.getDb().prepare('SELECT * FROM invoice_view_logs WHERE invoice_id = ? ORDER BY viewed_at DESC').all(invoiceId); }
export function invoiceViewStats(companyId: string) {
  return db.getDb().prepare(`SELECT i.id, i.invoice_number, COUNT(vl.id) AS view_count, MAX(vl.viewed_at) AS last_viewed FROM invoices i LEFT JOIN invoice_view_logs vl ON vl.invoice_id = i.id WHERE i.company_id = ? AND i.status IN ('sent','partial','overdue') GROUP BY i.id ORDER BY view_count DESC LIMIT 30`).all(companyId);
}
export function unviewedInvoices(companyId: string) {
  return db.getDb().prepare(`SELECT i.id, i.invoice_number, i.total, i.due_date, c.name AS client_name FROM invoices i LEFT JOIN invoice_view_logs vl ON vl.invoice_id = i.id LEFT JOIN clients c ON c.id = i.client_id WHERE i.company_id = ? AND i.status = 'sent' AND vl.id IS NULL ORDER BY i.issue_date`).all(companyId);
}

// ════════════════════════════════════════════════════════════
// IV45–IV50: Attachments & Activity Log
// ════════════════════════════════════════════════════════════
export function listAttachments(invoiceId: string) { return db.getDb().prepare('SELECT * FROM invoice_attachments WHERE invoice_id = ? ORDER BY created_at').all(invoiceId); }
export function addAttachment(att: any) {
  const id = uuid(); db.getDb().prepare(`INSERT INTO invoice_attachments (id, invoice_id, file_name, file_path, file_size, mime_type, created_at) VALUES (?,?,?,?,?,?,datetime('now'))`).run(id, att.invoice_id, att.file_name, att.file_path || '', att.file_size ?? 0, att.mime_type || ''); return { id };
}
export function deleteAttachment(id: string) { db.getDb().prepare('DELETE FROM invoice_attachments WHERE id = ?').run(id); }
export function logActivity(entry: any) {
  const id = uuid(); db.getDb().prepare(`INSERT INTO invoice_activity_log (id, invoice_id, action, performed_by, details, created_at) VALUES (?,?,?,?,?,datetime('now'))`).run(id, entry.invoice_id, entry.action, entry.performed_by || '', entry.details || ''); return { id };
}
export function activityLog(invoiceId: string) { return db.getDb().prepare('SELECT * FROM invoice_activity_log WHERE invoice_id = ? ORDER BY created_at DESC').all(invoiceId); }
export function recentActivity(companyId: string, limit = 30) {
  return db.getDb().prepare(`SELECT al.*, i.invoice_number FROM invoice_activity_log al JOIN invoices i ON i.id = al.invoice_id WHERE i.company_id = ? ORDER BY al.created_at DESC LIMIT ?`).all(companyId, limit);
}

// ════════════════════════════════════════════════════════════
// IV51–IV60: Analytics & Insights
// ════════════════════════════════════════════════════════════
export function invoiceDashboard(companyId: string) {
  const dbi = db.getDb();
  const mtd = dbi.prepare(`SELECT COUNT(*) c, COALESCE(SUM(total),0) t FROM invoices WHERE company_id = ? AND substr(issue_date,1,7) = substr(date('now'),1,7)`).get(companyId) as any;
  const outstanding = dbi.prepare(`SELECT COUNT(*) c, COALESCE(SUM(total - COALESCE(amount_paid,0)),0) t FROM invoices WHERE company_id = ? AND status IN ('sent','partial','overdue')`).get(companyId) as any;
  const overdue = dbi.prepare(`SELECT COUNT(*) c, COALESCE(SUM(total - COALESCE(amount_paid,0)),0) t FROM invoices WHERE company_id = ? AND status = 'overdue'`).get(companyId) as any;
  const paid30 = dbi.prepare(`SELECT COUNT(*) c, COALESCE(SUM(amount_paid),0) t FROM invoices WHERE company_id = ? AND status = 'paid' AND paid_date >= date('now','-30 days')`).get(companyId) as any;
  return { mtdIssued: mtd?.c || 0, mtdTotal: round2(mtd?.t || 0), outstandingCount: outstanding?.c || 0, outstandingTotal: round2(outstanding?.t || 0), overdueCount: overdue?.c || 0, overdueTotal: round2(overdue?.t || 0), paidLast30: paid30?.c || 0, paidLast30Total: round2(paid30?.t || 0) };
}
export function revenueByMonth(companyId: string, months = 12) {
  return db.getDb().prepare(`SELECT substr(issue_date,1,7) AS month, COUNT(*) AS count, ROUND(SUM(total),2) AS invoiced, ROUND(SUM(amount_paid),2) AS collected FROM invoices WHERE company_id = ? AND issue_date >= date('now', '-' || ? || ' months') GROUP BY month ORDER BY month`).all(companyId, months);
}
export function collectionRate(companyId: string) {
  const r = db.getDb().prepare(`SELECT COALESCE(SUM(total),0) AS invoiced, COALESCE(SUM(amount_paid),0) AS collected FROM invoices WHERE company_id = ? AND issue_date >= date('now','-12 months')`).get(companyId) as any;
  return { invoiced: round2(r?.invoiced || 0), collected: round2(r?.collected || 0), rate: (r?.invoiced || 0) > 0 ? round2(((r?.collected || 0) / r.invoiced) * 100) : 0 };
}
export function avgPaymentDays(companyId: string) {
  return db.getDb().prepare(`SELECT ROUND(AVG(julianday(paid_date) - julianday(issue_date)),1) AS avg_days, COUNT(*) AS sample FROM invoices WHERE company_id = ? AND paid_date IS NOT NULL AND paid_date >= date('now','-12 months')`).get(companyId);
}
export function invoicesByStatus(companyId: string) {
  return db.getDb().prepare(`SELECT status, COUNT(*) AS count, ROUND(SUM(total),2) AS total FROM invoices WHERE company_id = ? GROUP BY status ORDER BY count DESC`).all(companyId);
}
export function topClientsRevenue(companyId: string, limit = 10) {
  return db.getDb().prepare(`SELECT c.id, c.name, COUNT(i.id) AS invoice_count, ROUND(SUM(i.total),2) AS total_invoiced, ROUND(SUM(i.amount_paid),2) AS total_paid FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.company_id = ? GROUP BY c.id ORDER BY total_invoiced DESC LIMIT ?`).all(companyId, limit);
}
export function invoiceAging(companyId: string) {
  const dbi = db.getDb();
  const buckets = [
    { label: 'Current', min: -9999, max: 0 },
    { label: '1-30 days', min: 1, max: 30 },
    { label: '31-60 days', min: 31, max: 60 },
    { label: '61-90 days', min: 61, max: 90 },
    { label: '90+ days', min: 91, max: 9999 },
  ];
  return buckets.map(b => {
    const r = dbi.prepare(`SELECT COUNT(*) c, COALESCE(SUM(total - COALESCE(amount_paid,0)),0) t FROM invoices WHERE company_id = ? AND status IN ('sent','partial','overdue') AND CAST(julianday('now') - julianday(due_date) AS INTEGER) >= ? AND CAST(julianday('now') - julianday(due_date) AS INTEGER) < ?`).get(companyId, b.min, b.max + 1) as any;
    return { ...b, count: r?.c || 0, total: round2(r?.t || 0) };
  });
}
export function invoiceGrowthRate(companyId: string) {
  return db.getDb().prepare(`SELECT substr(issue_date,1,7) AS month, ROUND(SUM(total),2) AS total FROM invoices WHERE company_id = ? AND issue_date >= date('now','-13 months') GROUP BY month ORDER BY month`).all(companyId);
}
export function avgInvoiceSize(companyId: string) {
  return db.getDb().prepare(`SELECT ROUND(AVG(total),2) AS avg_total, ROUND(MIN(total),2) AS min_total, ROUND(MAX(total),2) AS max_total, COUNT(*) AS sample FROM invoices WHERE company_id = ? AND issue_date >= date('now','-12 months')`).get(companyId);
}
export function invoicesByDayOfWeek(companyId: string) {
  return db.getDb().prepare(`SELECT CASE CAST(strftime('%w', issue_date) AS INTEGER) WHEN 0 THEN 'Sunday' WHEN 1 THEN 'Monday' WHEN 2 THEN 'Tuesday' WHEN 3 THEN 'Wednesday' WHEN 4 THEN 'Thursday' WHEN 5 THEN 'Friday' WHEN 6 THEN 'Saturday' END AS day_name, COUNT(*) AS count, ROUND(SUM(total),2) AS total FROM invoices WHERE company_id = ? GROUP BY day_name ORDER BY strftime('%w', issue_date)`).all(companyId);
}

// ════════════════════════════════════════════════════════════
// IV61–IV70: Workflow & Smart Filters
// ════════════════════════════════════════════════════════════
export function listSmartFilters(companyId: string, userId?: string) {
  let sql = 'SELECT * FROM invoice_smart_filters WHERE company_id = ? AND (is_system = 1';
  const p: any[] = [companyId];
  if (userId) { sql += ' OR user_id = ?'; p.push(userId); }
  sql += ') ORDER BY is_system DESC, name';
  return db.getDb().prepare(sql).all(...p);
}
export function upsertSmartFilter(f: any) {
  const dbi = db.getDb();
  if (f.id) { dbi.prepare(`UPDATE invoice_smart_filters SET name=?,filter_json=? WHERE id=?`).run(f.name, JSON.stringify(f.filter || {}), f.id); return f; }
  const id = uuid(); dbi.prepare(`INSERT INTO invoice_smart_filters (id, company_id, user_id, name, filter_json, is_system, created_at) VALUES (?,?,?,?,?,?,datetime('now'))`).run(id, f.company_id, f.user_id || '', f.name, JSON.stringify(f.filter || {}), f.is_system ? 1 : 0); return { ...f, id };
}
export function deleteSmartFilter(id: string) { db.getDb().prepare('DELETE FROM invoice_smart_filters WHERE id = ?').run(id); }
export function listWorkflowRules(companyId: string) { return db.getDb().prepare('SELECT * FROM invoice_workflow_rules WHERE company_id = ? ORDER BY priority').all(companyId); }
export function upsertWorkflowRule(r: any) {
  const dbi = db.getDb();
  if (r.id) { dbi.prepare(`UPDATE invoice_workflow_rules SET name=?,trigger_event=?,conditions_json=?,actions_json=?,priority=?,active=? WHERE id=?`).run(r.name, r.trigger_event, JSON.stringify(r.conditions || {}), JSON.stringify(r.actions || []), r.priority ?? 100, r.active !== false ? 1 : 0, r.id); return r; }
  const id = uuid(); dbi.prepare(`INSERT INTO invoice_workflow_rules (id, company_id, name, trigger_event, conditions_json, actions_json, priority, active, created_at) VALUES (?,?,?,?,?,?,?,1,datetime('now'))`).run(id, r.company_id, r.name, r.trigger_event || '', JSON.stringify(r.conditions || {}), JSON.stringify(r.actions || []), r.priority ?? 100); return { ...r, id };
}
export function deleteWorkflowRule(id: string) { db.getDb().prepare('DELETE FROM invoice_workflow_rules WHERE id = ?').run(id); }
export function batchSendInvoices(companyId: string, invoiceIds: string[]) {
  const dbi = db.getDb();
  const upd = dbi.prepare(`UPDATE invoices SET status = 'sent', updated_at = datetime('now') WHERE id = ? AND company_id = ? AND status = 'draft'`);
  const tx = dbi.transaction(() => { for (const id of invoiceIds) upd.run(id, companyId); });
  tx(); return { sent: invoiceIds.length };
}
export function batchVoidInvoices(companyId: string, invoiceIds: string[]) {
  const dbi = db.getDb();
  const upd = dbi.prepare(`UPDATE invoices SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND company_id = ?`);
  const tx = dbi.transaction(() => { for (const id of invoiceIds) upd.run(id, companyId); });
  tx(); return { voided: invoiceIds.length };
}
export function duplicateInvoice(invoiceId: string) {
  const dbi = db.getDb();
  const inv = dbi.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId) as any;
  if (!inv) return { error: 'Invoice not found' };
  const newId = uuid();
  const newNum = inv.invoice_number + '-COPY';
  dbi.prepare(`INSERT INTO invoices (id, company_id, client_id, invoice_number, status, issue_date, due_date, subtotal, tax_amount, discount_amount, total, amount_paid, notes, terms, custom_fields, created_at, updated_at) VALUES (?,?,?,?,'draft',?,?,?,?,?,?,0,?,?,?,datetime('now'),datetime('now'))`).run(newId, inv.company_id, inv.client_id, newNum, today(), today(), inv.subtotal, inv.tax_amount, inv.discount_amount, inv.total, inv.notes || '', inv.terms || '', inv.custom_fields || '{}');
  // Copy line items
  const lines = dbi.prepare('SELECT * FROM invoice_line_items WHERE invoice_id = ?').all(invoiceId) as any[];
  for (const li of lines) {
    dbi.prepare(`INSERT INTO invoice_line_items (id, invoice_id, description, quantity, unit_price, amount, tax_rate, discount, sort_order, created_at) VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))`).run(uuid(), newId, li.description, li.quantity, li.unit_price, li.amount, li.tax_rate || 0, li.discount || 0, li.sort_order || 0);
  }
  return { id: newId, invoice_number: newNum };
}

// ════════════════════════════════════════════════════════════
// IV71–IV80: Advanced Reports & Health
// ════════════════════════════════════════════════════════════
export function invoicesByClient(companyId: string) {
  return db.getDb().prepare(`SELECT c.id, c.name, COUNT(i.id) AS count, ROUND(SUM(i.total),2) AS total, SUM(CASE WHEN i.status = 'overdue' THEN 1 ELSE 0 END) AS overdue_count FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.company_id = ? GROUP BY c.id ORDER BY total DESC`).all(companyId);
}
export function unpaidInvoicesSummary(companyId: string) {
  return db.getDb().prepare(`SELECT i.id, i.invoice_number, i.total, i.amount_paid, ROUND(i.total - COALESCE(i.amount_paid,0),2) AS balance, i.due_date, i.status, c.name AS client_name, CAST(julianday('now') - julianday(i.due_date) AS INTEGER) AS days_past_due FROM invoices i LEFT JOIN clients c ON c.id = i.client_id WHERE i.company_id = ? AND i.status IN ('sent','partial','overdue') ORDER BY days_past_due DESC`).all(companyId);
}
export function paymentMethodBreakdown(companyId: string) {
  return db.getDb().prepare(`SELECT COALESCE(NULLIF(p.payment_method,''),'unspecified') AS method, COUNT(*) AS count, ROUND(SUM(p.amount),2) AS total FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.company_id = ? GROUP BY method ORDER BY total DESC`).all(companyId);
}
export function lateFeeReport(companyId: string) {
  return db.getDb().prepare(`SELECT id, invoice_number, total, late_fee_amount, late_fee_pct, due_date, status FROM invoices WHERE company_id = ? AND late_fee_applied = 1 ORDER BY late_fee_amount DESC`).all(companyId);
}
export function recurringInvoiceSummary(companyId: string) {
  return db.getDb().prepare(`SELECT COUNT(*) AS count, ROUND(SUM(total),2) AS total_value FROM invoices WHERE company_id = ? AND is_recurring = 1`).get(companyId);
}
export function invoiceExportData(companyId: string, startDate?: string, endDate?: string) {
  let sql = `SELECT i.invoice_number, c.name AS client_name, i.issue_date, i.due_date, i.subtotal, i.tax_amount, i.discount_amount, i.total, i.amount_paid, i.status FROM invoices i LEFT JOIN clients c ON c.id = i.client_id WHERE i.company_id = ?`;
  const p: any[] = [companyId];
  if (startDate) { sql += ' AND i.issue_date >= ?'; p.push(startDate); }
  if (endDate) { sql += ' AND i.issue_date <= ?'; p.push(endDate); }
  return db.getDb().prepare(sql + ' ORDER BY i.issue_date DESC').all(...p);
}
export function invoiceSearchFullText(companyId: string, query: string, limit = 30) {
  const q = `%${query.toLowerCase()}%`;
  return db.getDb().prepare(`SELECT i.*, c.name AS client_name FROM invoices i LEFT JOIN clients c ON c.id = i.client_id WHERE i.company_id = ? AND (lower(i.invoice_number) LIKE ? OR lower(i.notes) LIKE ? OR lower(c.name) LIKE ?) ORDER BY i.issue_date DESC LIMIT ?`).all(companyId, q, q, q, limit);
}
export function invoicePortalHealth(companyId: string) {
  const dbi = db.getDb();
  const total = (dbi.prepare('SELECT COUNT(*) c FROM invoices WHERE company_id = ?').get(companyId) as any)?.c || 0;
  const overdue = (dbi.prepare(`SELECT COUNT(*) c FROM invoices WHERE company_id = ? AND status = 'overdue'`).get(companyId) as any)?.c || 0;
  const draft = (dbi.prepare(`SELECT COUNT(*) c FROM invoices WHERE company_id = ? AND status = 'draft'`).get(companyId) as any)?.c || 0;
  const noClient = (dbi.prepare(`SELECT COUNT(*) c FROM invoices WHERE company_id = ? AND (client_id IS NULL OR client_id = '')`).get(companyId) as any)?.c || 0;
  const collection = collectionRate(companyId);
  return { totalInvoices: total, overdueCount: overdue, draftsCount: draft, missingClient: noClient, collectionRate: collection.rate, healthGrade: collection.rate >= 90 ? 'A' : collection.rate >= 75 ? 'B' : collection.rate >= 60 ? 'C' : 'D' };
}
export function invoiceQuarterlyComparison(companyId: string) {
  return db.getDb().prepare(`SELECT strftime('%Y', issue_date) || '-Q' || ((CAST(strftime('%m', issue_date) AS INTEGER) - 1) / 3 + 1) AS quarter, COUNT(*) AS count, ROUND(SUM(total),2) AS invoiced, ROUND(SUM(amount_paid),2) AS collected FROM invoices WHERE company_id = ? AND issue_date >= date('now','-24 months') GROUP BY quarter ORDER BY quarter`).all(companyId);
}
export function clientPaymentBehavior(companyId: string) {
  return db.getDb().prepare(`SELECT c.id, c.name, COUNT(i.id) AS total_invoices, SUM(CASE WHEN i.status = 'paid' THEN 1 ELSE 0 END) AS paid_count, ROUND(AVG(CASE WHEN i.paid_date IS NOT NULL THEN julianday(i.paid_date) - julianday(i.due_date) END),1) AS avg_days_from_due, SUM(CASE WHEN i.status = 'overdue' THEN 1 ELSE 0 END) AS overdue_count FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.company_id = ? GROUP BY c.id HAVING total_invoices >= 2 ORDER BY avg_days_from_due DESC`).all(companyId);
}
