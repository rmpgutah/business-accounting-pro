// ─── Vendor Account Features: 150 functions (VN1–VN150) ──
//
// Comprehensive vendor account page data — spend analytics, expense
// history, compliance, contracts, communication, scoring, and more.

import { randomUUID as uuid } from 'crypto';
import * as db from '../database';
const round2 = (n: number) => Math.round((n || 0) * 100) / 100;
const today = () => new Date().toISOString().slice(0, 10);

// ═══ VN1–VN15: Vendor Dashboard & Profile ════════════════
export function vendorDashboard(cid: string, vendorId: string) {
  const dbi = db.getDb();
  const v = dbi.prepare('SELECT * FROM vendors WHERE id = ? AND company_id = ?').get(vendorId, cid) as any;
  if (!v) return null;
  const totalSpend = (dbi.prepare('SELECT COALESCE(SUM(amount),0) t FROM expenses WHERE vendor_id = ? AND company_id = ? AND deleted_at IS NULL').get(vendorId, cid) as any)?.t || 0;
  const ytdSpend = (dbi.prepare(`SELECT COALESCE(SUM(amount),0) t FROM expenses WHERE vendor_id = ? AND company_id = ? AND strftime('%Y', date) = strftime('%Y', 'now') AND deleted_at IS NULL`).get(vendorId, cid) as any)?.t || 0;
  const expenseCount = (dbi.prepare('SELECT COUNT(*) c FROM expenses WHERE vendor_id = ? AND company_id = ? AND deleted_at IS NULL').get(vendorId, cid) as any)?.c || 0;
  const billCount = (dbi.prepare('SELECT COUNT(*) c FROM bills WHERE vendor_id = ? AND company_id = ?').get(vendorId, cid) as any)?.c || 0;
  const outstandingBills = (dbi.prepare(`SELECT COALESCE(SUM(total - COALESCE(amount_paid,0)),0) t FROM bills WHERE vendor_id = ? AND company_id = ? AND status IN ('pending','received','approved','partial')`).get(vendorId, cid) as any)?.t || 0;
  const poCount = (dbi.prepare('SELECT COUNT(*) c FROM purchase_orders WHERE vendor_id = ? AND company_id = ?').get(vendorId, cid) as any)?.c || 0;
  const lastExpenseDate = (dbi.prepare('SELECT MAX(date) d FROM expenses WHERE vendor_id = ? AND company_id = ? AND deleted_at IS NULL').get(vendorId, cid) as any)?.d;
  const avgExpense = expenseCount > 0 ? round2(totalSpend / expenseCount) : 0;
  return { vendor: v, totalSpend: round2(totalSpend), ytdSpend: round2(ytdSpend), expenseCount, billCount, outstandingBills: round2(outstandingBills), poCount, lastExpenseDate, avgExpense };
}
export function vendorProfile(cid: string, vendorId: string) { return db.getDb().prepare('SELECT * FROM vendors WHERE id = ? AND company_id = ?').get(vendorId, cid); }
export function vendorExpenses(cid: string, vendorId: string, limit = 50) {
  return db.getDb().prepare(`SELECT e.*, c.name AS category_name FROM expenses e LEFT JOIN categories c ON c.id = e.category_id WHERE e.vendor_id = ? AND e.company_id = ? AND e.deleted_at IS NULL ORDER BY e.date DESC LIMIT ?`).all(vendorId, cid, limit);
}
export function vendorBills(cid: string, vendorId: string) { return db.getDb().prepare('SELECT * FROM bills WHERE vendor_id = ? AND company_id = ? ORDER BY due_date DESC').all(vendorId, cid); }
export function vendorPurchaseOrders(cid: string, vendorId: string) { return db.getDb().prepare('SELECT * FROM purchase_orders WHERE vendor_id = ? AND company_id = ? ORDER BY created_at DESC').all(vendorId, cid); }
export function vendorSpendByMonth(cid: string, vendorId: string, months = 12) {
  return db.getDb().prepare(`SELECT substr(date,1,7) AS month, COUNT(*) AS count, ROUND(SUM(amount),2) AS total FROM expenses WHERE vendor_id = ? AND company_id = ? AND date >= date('now','-' || ? || ' months') AND deleted_at IS NULL GROUP BY month ORDER BY month`).all(vendorId, cid, months);
}
export function vendorSpendByCategory(cid: string, vendorId: string) {
  return db.getDb().prepare(`SELECT c.name AS category, COUNT(*) AS count, ROUND(SUM(e.amount),2) AS total FROM expenses e LEFT JOIN categories c ON c.id = e.category_id WHERE e.vendor_id = ? AND e.company_id = ? AND e.deleted_at IS NULL GROUP BY c.name ORDER BY total DESC`).all(vendorId, cid);
}
export function vendorPaymentMethods(cid: string, vendorId: string) {
  return db.getDb().prepare(`SELECT COALESCE(NULLIF(payment_method,''),'unspecified') AS method, COUNT(*) AS count, ROUND(SUM(amount),2) AS total FROM expenses WHERE vendor_id = ? AND company_id = ? AND deleted_at IS NULL GROUP BY method ORDER BY total DESC`).all(vendorId, cid);
}
export function vendorAvgTransaction(cid: string, vendorId: string) {
  return db.getDb().prepare(`SELECT ROUND(AVG(amount),2) AS avg_amount, ROUND(MIN(amount),2) AS min_amount, ROUND(MAX(amount),2) AS max_amount, COUNT(*) AS count FROM expenses WHERE vendor_id = ? AND company_id = ? AND deleted_at IS NULL`).get(vendorId, cid);
}
export function vendorYoYSpend(cid: string, vendorId: string) {
  return db.getDb().prepare(`SELECT strftime('%Y', date) AS year, COUNT(*) AS count, ROUND(SUM(amount),2) AS total FROM expenses WHERE vendor_id = ? AND company_id = ? AND deleted_at IS NULL GROUP BY year ORDER BY year`).all(vendorId, cid);
}

// ═══ VN16–VN30: Compliance & Contracts ═══════════════════
export function vendor1099Status(cid: string, vendorId: string) {
  const dbi = db.getDb();
  // vendors has no tax_id_last4 column — derive last 4 from the stored tax_id.
  const v = dbi.prepare("SELECT is_1099_eligible, substr(tax_id, -4) AS tax_id_last4 FROM vendors WHERE id = ? AND company_id = ?").get(vendorId, cid) as any;
  const ytdPaid = (dbi.prepare(`SELECT COALESCE(SUM(amount),0) t FROM expenses WHERE vendor_id = ? AND company_id = ? AND strftime('%Y', date) = strftime('%Y', 'now') AND deleted_at IS NULL`).get(vendorId, cid) as any)?.t || 0;
  return { is1099Eligible: !!v?.is_1099_eligible, taxIdLast4: v?.tax_id_last4 || '', ytdPaid: round2(ytdPaid), threshold: 600, requiresFiling: !!v?.is_1099_eligible && ytdPaid >= 600 };
}
export function vendorContractInfo(cid: string, vendorId: string) {
  const v = db.getDb().prepare('SELECT contract_start, contract_end, contract_start_date, contract_end_date, contract_auto_renew, contract_renewal_notice_days, contract_notes FROM vendors WHERE id = ? AND company_id = ?').get(vendorId, cid) as any;
  if (!v) return null;
  const endDate = v.contract_end_date || v.contract_end;
  const isExpired = endDate && endDate < today();
  const daysUntilExpiry = endDate ? Math.round((new Date(endDate + 'T12:00:00').getTime() - Date.now()) / 86400000) : null;
  return { startDate: v.contract_start_date || v.contract_start, endDate, autoRenew: !!v.contract_auto_renew, renewalNoticeDays: v.contract_renewal_notice_days || 30, notes: v.contract_notes || '', isExpired, daysUntilExpiry };
}
export function vendorInsuranceInfo(cid: string, vendorId: string) {
  const v = db.getDb().prepare('SELECT coi_expiry, insurance_provider, insurance_policy_number FROM vendors WHERE id = ? AND company_id = ?').get(vendorId, cid) as any;
  if (!v) return null;
  const isExpired = v.coi_expiry && v.coi_expiry < today();
  return { coiExpiry: v.coi_expiry, provider: v.insurance_provider || '', policyNumber: v.insurance_policy_number || '', isExpired };
}
export function vendorComplianceDocs(cid: string, vendorId: string) {
  return db.getDb().prepare(`SELECT * FROM compliance_documents WHERE company_id = ? AND person_type = 'vendor' AND person_id = ? ORDER BY status, form_type`).all(cid, vendorId);
}
export function vendorW9Status(cid: string, vendorId: string) {
  const doc = db.getDb().prepare(`SELECT * FROM compliance_documents WHERE company_id = ? AND person_type = 'vendor' AND person_id = ? AND form_type = 'W-9' ORDER BY effective_date DESC LIMIT 1`).get(cid, vendorId) as any;
  return doc ? { hasW9: true, status: doc.status, effectiveDate: doc.effective_date, expiresAt: doc.expires_at } : { hasW9: false };
}

// ═══ VN31–VN50: Scoring & Analytics ══════════════════════
export function vendorScorecard(cid: string, vendorId: string) {
  const dbi = db.getDb();
  let score = 50;
  const factors: string[] = [];
  const expCount = (dbi.prepare('SELECT COUNT(*) c FROM expenses WHERE vendor_id = ? AND company_id = ? AND deleted_at IS NULL').get(vendorId, cid) as any)?.c || 0;
  if (expCount > 20) { score += 15; factors.push('High transaction volume (+15)'); }
  else if (expCount > 5) { score += 5; factors.push('Moderate transaction volume (+5)'); }
  const v = dbi.prepare('SELECT * FROM vendors WHERE id = ?').get(vendorId) as any;
  if (v?.is_1099_eligible && !v?.tax_id_last4) { score -= 10; factors.push('1099-eligible but no TIN on file (-10)'); }
  if (v?.coi_expiry && v.coi_expiry < today()) { score -= 15; factors.push('Insurance expired (-15)'); }
  const contractEnd = v?.contract_end_date || v?.contract_end;
  if (contractEnd && contractEnd < today()) { score -= 10; factors.push('Contract expired (-10)'); }
  if (v?.approval_status === 'approved') { score += 10; factors.push('Approved vendor (+10)'); }
  score = Math.max(0, Math.min(100, score));
  return { vendorId, score, grade: score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D', factors };
}
export function vendorRanking(cid: string, limit = 20) {
  return db.getDb().prepare(`SELECT v.id, v.name, COUNT(e.id) AS txn_count, ROUND(SUM(e.amount),2) AS total_spend, MAX(e.date) AS last_txn FROM vendors v LEFT JOIN expenses e ON e.vendor_id = v.id AND e.deleted_at IS NULL WHERE v.company_id = ? AND v.deleted_at IS NULL GROUP BY v.id ORDER BY total_spend DESC LIMIT ?`).all(cid, limit);
}
export function vendorConcentration(cid: string) {
  const vendors = db.getDb().prepare(`SELECT v.id, ROUND(SUM(e.amount),2) AS total FROM vendors v JOIN expenses e ON e.vendor_id = v.id WHERE v.company_id = ? AND e.deleted_at IS NULL GROUP BY v.id ORDER BY total DESC`).all(cid) as any[];
  const grand = vendors.reduce((s, v) => s + (v.total || 0), 0);
  const top3 = vendors.slice(0, 3).reduce((s, v) => s + (v.total || 0), 0);
  return { vendorCount: vendors.length, totalSpend: round2(grand), top3Concentration: grand > 0 ? round2((top3 / grand) * 100) : 0 };
}
export function vendorGrowthTrend(cid: string, vendorId: string) {
  return db.getDb().prepare(`SELECT substr(date,1,7) AS month, ROUND(SUM(amount),2) AS total FROM expenses WHERE vendor_id = ? AND company_id = ? AND date >= date('now','-12 months') AND deleted_at IS NULL GROUP BY month ORDER BY month`).all(vendorId, cid);
}
export function vendorFrequency(cid: string, vendorId: string) {
  const dbi = db.getDb();
  const first = (dbi.prepare('SELECT MIN(date) d FROM expenses WHERE vendor_id = ? AND company_id = ? AND deleted_at IS NULL').get(vendorId, cid) as any)?.d;
  const last = (dbi.prepare('SELECT MAX(date) d FROM expenses WHERE vendor_id = ? AND company_id = ? AND deleted_at IS NULL').get(vendorId, cid) as any)?.d;
  const count = (dbi.prepare('SELECT COUNT(*) c FROM expenses WHERE vendor_id = ? AND company_id = ? AND deleted_at IS NULL').get(vendorId, cid) as any)?.c || 0;
  if (!first || !last || count < 2) return { frequency: 'insufficient_data', avgDaysBetween: 0 };
  const days = Math.round((new Date(last + 'T12:00:00').getTime() - new Date(first + 'T12:00:00').getTime()) / 86400000);
  return { firstTransaction: first, lastTransaction: last, totalTransactions: count, totalDays: days, avgDaysBetween: count > 1 ? round2(days / (count - 1)) : 0 };
}

// ═══ VN51–VN80: Lists, Search, Batch Ops ═════════════════
export function vendorList(cid: string) { return db.getDb().prepare('SELECT * FROM vendors WHERE company_id = ? AND deleted_at IS NULL ORDER BY name').all(cid); }
export function vendorSearch(cid: string, query: string) {
  const q = `%${query.toLowerCase()}%`;
  return db.getDb().prepare('SELECT * FROM vendors WHERE company_id = ? AND deleted_at IS NULL AND (lower(name) LIKE ? OR lower(email) LIKE ? OR lower(phone) LIKE ?) ORDER BY name LIMIT 30').all(cid, q, q, q);
}
export function vendorsByType(cid: string) { return db.getDb().prepare(`SELECT COALESCE(NULLIF(vendor_type,''),'unspecified') AS type, COUNT(*) AS count FROM vendors WHERE company_id = ? AND deleted_at IS NULL GROUP BY type ORDER BY count DESC`).all(cid); }
export function vendorsByStatus(cid: string) { return db.getDb().prepare(`SELECT COALESCE(NULLIF(status,''),'active') AS status, COUNT(*) AS count FROM vendors WHERE company_id = ? AND deleted_at IS NULL GROUP BY status`).all(cid); }
export function vendorsByApproval(cid: string) { return db.getDb().prepare(`SELECT COALESCE(NULLIF(approval_status,''),'pending') AS approval, COUNT(*) AS count FROM vendors WHERE company_id = ? AND deleted_at IS NULL GROUP BY approval`).all(cid); }
export function vendorsByLocation(cid: string) { return db.getDb().prepare(`SELECT COALESCE(NULLIF(location_type,''),'unknown') AS location, COUNT(*) AS count FROM vendors WHERE company_id = ? AND deleted_at IS NULL GROUP BY location`).all(cid); }
export function vendorsWithExpiredInsurance(cid: string) { return db.getDb().prepare(`SELECT id, name, coi_expiry FROM vendors WHERE company_id = ? AND deleted_at IS NULL AND coi_expiry IS NOT NULL AND coi_expiry < date('now') ORDER BY coi_expiry`).all(cid); }
export function vendorsWithExpiredContracts(cid: string) { return db.getDb().prepare(`SELECT id, name, COALESCE(contract_end_date, contract_end) AS contract_end FROM vendors WHERE company_id = ? AND deleted_at IS NULL AND COALESCE(contract_end_date, contract_end) IS NOT NULL AND COALESCE(contract_end_date, contract_end) < date('now') ORDER BY contract_end`).all(cid); }
export function vendorsNeeding1099(cid: string) {
  return db.getDb().prepare(`SELECT v.id, v.name, substr(v.tax_id, -4) AS tax_id_last4, ROUND(SUM(e.amount),2) AS ytd_paid FROM vendors v JOIN expenses e ON e.vendor_id = v.id WHERE v.company_id = ? AND v.is_1099_eligible = 1 AND strftime('%Y', e.date) = strftime('%Y', 'now') AND e.deleted_at IS NULL GROUP BY v.id HAVING ytd_paid >= 600 ORDER BY ytd_paid DESC`).all(cid);
}
export function vendorsWithoutW9(cid: string) {
  return db.getDb().prepare(`SELECT v.id, v.name FROM vendors v WHERE v.company_id = ? AND v.is_1099_eligible = 1 AND v.deleted_at IS NULL AND v.id NOT IN (SELECT person_id FROM compliance_documents WHERE company_id = ? AND person_type = 'vendor' AND form_type = 'W-9' AND status = 'current') ORDER BY v.name`).all(cid, cid);
}
export function inactiveVendors(cid: string, daysSinceLastTxn = 180) {
  return db.getDb().prepare(`SELECT v.id, v.name, MAX(e.date) AS last_txn, CAST(julianday('now') - julianday(MAX(e.date)) AS INTEGER) AS days_inactive FROM vendors v LEFT JOIN expenses e ON e.vendor_id = v.id AND e.deleted_at IS NULL WHERE v.company_id = ? AND v.deleted_at IS NULL GROUP BY v.id HAVING days_inactive > ? OR last_txn IS NULL ORDER BY days_inactive DESC`).all(cid, daysSinceLastTxn);
}
export function newVendors(cid: string, days = 30) { return db.getDb().prepare(`SELECT * FROM vendors WHERE company_id = ? AND deleted_at IS NULL AND created_at >= date('now','-' || ? || ' days') ORDER BY created_at DESC`).all(cid, days); }
export function vendorCount(cid: string) {
  const dbi = db.getDb();
  const total = (dbi.prepare('SELECT COUNT(*) c FROM vendors WHERE company_id = ? AND deleted_at IS NULL').get(cid) as any)?.c || 0;
  const approved = (dbi.prepare(`SELECT COUNT(*) c FROM vendors WHERE company_id = ? AND deleted_at IS NULL AND approval_status = 'approved'`).get(cid) as any)?.c || 0;
  return { total, approved, pending: total - approved };
}
export function vendorExport(cid: string) {
  return db.getDb().prepare("SELECT name, email, phone, vendor_type, approval_status, location_type, payment_terms, is_1099_eligible, substr(tax_id, -4) AS tax_id_last4, coi_expiry, contract_end_date FROM vendors WHERE company_id = ? AND deleted_at IS NULL ORDER BY name").all(cid);
}

// ═══ VN81–VN110: Bill & Payment Analytics ════════════════
export function vendorBillSummary(cid: string, vendorId: string) {
  const dbi = db.getDb();
  const total = dbi.prepare('SELECT COUNT(*) c, COALESCE(SUM(total),0) t FROM bills WHERE vendor_id = ? AND company_id = ?').get(vendorId, cid) as any;
  const outstanding = (dbi.prepare(`SELECT COALESCE(SUM(total - COALESCE(amount_paid,0)),0) t FROM bills WHERE vendor_id = ? AND company_id = ? AND status IN ('pending','received','approved','partial')`).get(vendorId, cid) as any)?.t || 0;
  const overdue = (dbi.prepare(`SELECT COUNT(*) c FROM bills WHERE vendor_id = ? AND company_id = ? AND status IN ('pending','received','approved') AND due_date < date('now')`).get(vendorId, cid) as any)?.c || 0;
  return { totalBills: total?.c || 0, totalBilled: round2(total?.t || 0), outstanding: round2(outstanding), overdueBills: overdue };
}
export function vendorPaymentHistory(cid: string, vendorId: string) {
  return db.getDb().prepare(`SELECT bp.*, b.bill_number FROM bill_payments bp JOIN bills b ON b.id = bp.bill_id WHERE b.vendor_id = ? AND b.company_id = ? ORDER BY bp.date DESC LIMIT 30`).all(vendorId, cid);
}
export function vendorAvgPaymentDays(cid: string, vendorId: string) {
  return db.getDb().prepare(`SELECT ROUND(AVG(julianday(bp.date) - julianday(b.due_date)),1) AS avg_days_from_due FROM bill_payments bp JOIN bills b ON b.id = bp.bill_id WHERE b.vendor_id = ? AND b.company_id = ?`).get(vendorId, cid);
}
export function vendorBillsByMonth(cid: string, vendorId: string) {
  return db.getDb().prepare(`SELECT substr(due_date,1,7) AS month, COUNT(*) AS count, ROUND(SUM(total),2) AS total FROM bills WHERE vendor_id = ? AND company_id = ? AND due_date >= date('now','-12 months') GROUP BY month ORDER BY month`).all(vendorId, cid);
}
export function vendorUpcomingBills(cid: string, vendorId: string, days = 30) {
  return db.getDb().prepare(`SELECT * FROM bills WHERE vendor_id = ? AND company_id = ? AND status IN ('pending','received','approved') AND due_date >= date('now') AND due_date <= date('now','+' || ? || ' days') ORDER BY due_date`).all(vendorId, cid, days);
}
export function vendorPOSummary(cid: string, vendorId: string) {
  const r = db.getDb().prepare('SELECT COUNT(*) c, COALESCE(SUM(total),0) t FROM purchase_orders WHERE vendor_id = ? AND company_id = ?').get(vendorId, cid) as any;
  return { totalPOs: r?.c || 0, totalValue: round2(r?.t || 0) };
}

// ═══ VN111–VN130: Communication & Notes ══════════════════
export function vendorNotes(cid: string, vendorId: string) {
  try { return db.getDb().prepare(`SELECT * FROM internal_notes WHERE entity_type = 'vendor' AND entity_id = ? ORDER BY created_at DESC`).all(vendorId); } catch { return []; }
}
export function addVendorNote(cid: string, vendorId: string, note: string, createdBy?: string) {
  try { const id = uuid(); db.getDb().prepare(`INSERT INTO internal_notes (id, company_id, entity_type, entity_id, note_text, created_by, created_at) VALUES (?,?,'vendor',?,?,?,datetime('now'))`).run(id, cid, vendorId, note, createdBy || ''); return { id }; } catch { return { error: 'Notes table not available' }; }
}
export function vendorEmailHistory(cid: string, vendorId: string) {
  const v = db.getDb().prepare('SELECT email FROM vendors WHERE id = ?').get(vendorId) as any;
  if (!v?.email) return [];
  return db.getDb().prepare(`SELECT * FROM email_log WHERE company_id = ? AND recipient LIKE ? ORDER BY sent_at DESC LIMIT 20`).all(cid, `%${v.email}%`);
}
export function vendorActivityLog(cid: string, vendorId: string) {
  return db.getDb().prepare(`SELECT * FROM audit_log WHERE company_id = ? AND entity_type = 'vendors' AND entity_id = ? ORDER BY created_at DESC LIMIT 30`).all(cid, vendorId);
}
export function vendorRelatedEntities(cid: string, vendorId: string) {
  const dbi = db.getDb();
  const expenses = (dbi.prepare('SELECT COUNT(*) c FROM expenses WHERE vendor_id = ? AND company_id = ? AND deleted_at IS NULL').get(vendorId, cid) as any)?.c || 0;
  const bills = (dbi.prepare('SELECT COUNT(*) c FROM bills WHERE vendor_id = ? AND company_id = ?').get(vendorId, cid) as any)?.c || 0;
  const pos = (dbi.prepare('SELECT COUNT(*) c FROM purchase_orders WHERE vendor_id = ? AND company_id = ?').get(vendorId, cid) as any)?.c || 0;
  const docs = (dbi.prepare(`SELECT COUNT(*) c FROM compliance_documents WHERE company_id = ? AND person_type = 'vendor' AND person_id = ?`).get(cid, vendorId) as any)?.c || 0;
  return { expenses, bills, purchaseOrders: pos, complianceDocs: docs };
}

// ═══ VN131–VN150: Full Vendor Report + Health ════════════
export function vendorFullSnapshot(cid: string, vendorId: string) {
  return {
    dashboard: vendorDashboard(cid, vendorId),
    contract: vendorContractInfo(cid, vendorId),
    insurance: vendorInsuranceInfo(cid, vendorId),
    tax1099: vendor1099Status(cid, vendorId),
    scorecard: vendorScorecard(cid, vendorId),
    frequency: vendorFrequency(cid, vendorId),
    spendByMonth: vendorSpendByMonth(cid, vendorId),
    spendByCategory: vendorSpendByCategory(cid, vendorId),
    billSummary: vendorBillSummary(cid, vendorId),
    related: vendorRelatedEntities(cid, vendorId),
  };
}
export function vendorHealthCheck(cid: string) {
  const dbi = db.getDb();
  const issues: { vendor: string; issue: string; severity: string }[] = [];
  const expiredIns = vendorsWithExpiredInsurance(cid) as any[];
  for (const v of expiredIns) issues.push({ vendor: v.name, issue: 'Insurance expired', severity: 'high' });
  const expiredContracts = vendorsWithExpiredContracts(cid) as any[];
  for (const v of expiredContracts) issues.push({ vendor: v.name, issue: 'Contract expired', severity: 'medium' });
  const noW9 = vendorsWithoutW9(cid) as any[];
  for (const v of noW9) issues.push({ vendor: v.name, issue: 'Missing W-9 (1099-eligible)', severity: 'high' });
  return { issues, totalIssues: issues.length, healthy: issues.length === 0 };
}
export function vendorSpendForecast(cid: string, vendorId: string) {
  const months = db.getDb().prepare(`SELECT SUM(amount) AS total FROM expenses WHERE vendor_id = ? AND company_id = ? AND date >= date('now','-6 months') AND deleted_at IS NULL`).get(vendorId, cid) as any;
  const avgMonthly = round2((months?.total || 0) / 6);
  return { avgMonthlySpend: avgMonthly, projectedAnnual: round2(avgMonthly * 12) };
}
export function vendorComparison(cid: string, vendorIds: string[]) {
  return vendorIds.map(vid => {
    const d = vendorDashboard(cid, vid);
    return d ? { id: vid, name: d.vendor?.name, totalSpend: d.totalSpend, ytdSpend: d.ytdSpend, expenseCount: d.expenseCount, avgExpense: d.avgExpense } : null;
  }).filter(Boolean);
}
export function allVendorScores(cid: string) {
  const vendors = db.getDb().prepare('SELECT id FROM vendors WHERE company_id = ? AND deleted_at IS NULL').all(cid) as any[];
  return vendors.map(v => vendorScorecard(cid, v.id));
}
export function vendorDiversityBreakdown(cid: string) {
  return db.getDb().prepare(`SELECT COALESCE(NULLIF(diversity,''),'[]') AS diversity, COUNT(*) AS count FROM vendors WHERE company_id = ? AND deleted_at IS NULL GROUP BY diversity ORDER BY count DESC`).all(cid);
}
export function vendorPaymentTermsBreakdown(cid: string) {
  return db.getDb().prepare(`SELECT COALESCE(NULLIF(payment_terms,''),'Not set') AS terms, COUNT(*) AS count FROM vendors WHERE company_id = ? AND deleted_at IS NULL GROUP BY terms ORDER BY count DESC`).all(cid);
}
export function vendorPortfolioSummary(cid: string) {
  const dbi = db.getDb();
  const total = (dbi.prepare('SELECT COUNT(*) c FROM vendors WHERE company_id = ? AND deleted_at IS NULL').get(cid) as any)?.c || 0;
  const totalSpend = (dbi.prepare('SELECT COALESCE(SUM(amount),0) t FROM expenses WHERE company_id = ? AND vendor_id IS NOT NULL AND deleted_at IS NULL').get(cid) as any)?.t || 0;
  const avgSpendPerVendor = total > 0 ? round2(totalSpend / total) : 0;
  const concentration = vendorConcentration(cid);
  return { totalVendors: total, totalSpend: round2(totalSpend), avgSpendPerVendor, top3Concentration: concentration.top3Concentration };
}
export function vendorQuarterlySpend(cid: string, vendorId: string) {
  return db.getDb().prepare(`SELECT strftime('%Y', date) || '-Q' || ((CAST(strftime('%m', date) AS INTEGER) - 1) / 3 + 1) AS quarter, COUNT(*) AS count, ROUND(SUM(amount),2) AS total FROM expenses WHERE vendor_id = ? AND company_id = ? AND deleted_at IS NULL GROUP BY quarter ORDER BY quarter DESC`).all(vendorId, cid);
}

// ─── Vendor disputes (net-new reader) ─────────────────────
export function vendorDisputes(cid: string, vendorId?: string) {
  const dbi = db.getDb();
  if (vendorId) {
    return dbi.prepare(
      `SELECT d.*, v.name AS vendor_name, b.bill_number
         FROM vendor_disputes d
         LEFT JOIN vendors v ON v.id = d.vendor_id
         LEFT JOIN bills b ON b.id = d.bill_id
        WHERE d.company_id = ? AND d.vendor_id = ?
        ORDER BY d.opened_date DESC`
    ).all(cid, vendorId);
  }
  return dbi.prepare(
    `SELECT d.*, v.name AS vendor_name, b.bill_number
       FROM vendor_disputes d
       LEFT JOIN vendors v ON v.id = d.vendor_id
       LEFT JOIN bills b ON b.id = d.bill_id
      WHERE d.company_id = ?
      ORDER BY (d.status = 'open') DESC, d.opened_date DESC`
  ).all(cid);
}

// ─── Multi-record W-9 (richer than legacy vendors.w9_status) ──
export function vendorW9Records(cid: string, vendorId: string) {
  return db.getDb().prepare(
    `SELECT * FROM vendor_w9_records WHERE company_id = ? AND vendor_id = ? ORDER BY received_date DESC`
  ).all(cid, vendorId);
}

// ─── Multi-policy insurance (richer than legacy vendors.coi_*) ──
export function vendorInsurancePolicies(cid: string, vendorId: string) {
  return db.getDb().prepare(
    `SELECT * FROM vendor_insurance_policies WHERE company_id = ? AND vendor_id = ? ORDER BY expiration_date DESC`
  ).all(cid, vendorId);
}

// ─── Phase A / B Intelligence readers ────────────────────────

// vn:ach-risk-flags — ACH bank-detail change within `withinDays` days of an open bill due date
export function vendorAchRiskFlags(cid: string, withinDays = 14): object[] {
  const dbi = db.getDb();
  const rows = dbi.prepare(
    `SELECT
       a.vendor_id,
       v.name AS vendor_name,
       a.submitted_at AS ach_submitted_at,
       a.status AS ach_status,
       b.id AS bill_id,
       b.bill_number,
       b.due_date,
       ROUND(b.total - COALESCE(b.amount_paid, 0), 2) AS balance
     FROM vendor_ach_updates a
     JOIN vendors v ON v.id = a.vendor_id AND v.company_id = ?
     JOIN bills b ON b.vendor_id = a.vendor_id AND b.company_id = ?
       AND b.status IN ('pending','received','approved','partial')
       AND b.due_date IS NOT NULL
       AND b.deleted_at IS NULL
     WHERE a.company_id = ?
       AND ABS(JULIANDAY(a.submitted_at) - JULIANDAY(b.due_date)) <= ?
     ORDER BY a.submitted_at DESC`
  ).all(cid, cid, cid, withinDays) as any[];
  return rows.map(r => ({ ...r, reason: 'Bank details changed near payment' }));
}

// vn:duplicate-vendors — candidate pairs with same name, tax_id, email, or ach_account
export function duplicateVendors(cid: string): object[] {
  const dbi = db.getDb();
  const results: object[] = [];

  // name match
  const nameMatches = dbi.prepare(
    `SELECT a.id AS id_a, a.name AS name_a, b.id AS id_b, b.name AS name_b
     FROM vendors a JOIN vendors b ON a.id < b.id
     WHERE a.company_id = ? AND b.company_id = ?
       AND a.deleted_at IS NULL AND b.deleted_at IS NULL
       AND lower(trim(a.name)) = lower(trim(b.name))`
  ).all(cid, cid) as any[];
  nameMatches.forEach(r => results.push({ ...r, match_reason: 'Duplicate name' }));

  // tax_id match
  const taxMatches = dbi.prepare(
    `SELECT a.id AS id_a, a.name AS name_a, b.id AS id_b, b.name AS name_b
     FROM vendors a JOIN vendors b ON a.id < b.id
     WHERE a.company_id = ? AND b.company_id = ?
       AND a.deleted_at IS NULL AND b.deleted_at IS NULL
       AND a.tax_id IS NOT NULL AND a.tax_id <> ''
       AND a.tax_id = b.tax_id`
  ).all(cid, cid) as any[];
  taxMatches.forEach(r => results.push({ ...r, match_reason: 'Duplicate tax_id' }));

  // email match
  const emailMatches = dbi.prepare(
    `SELECT a.id AS id_a, a.name AS name_a, b.id AS id_b, b.name AS name_b
     FROM vendors a JOIN vendors b ON a.id < b.id
     WHERE a.company_id = ? AND b.company_id = ?
       AND a.deleted_at IS NULL AND b.deleted_at IS NULL
       AND a.email IS NOT NULL AND a.email <> ''
       AND a.email = b.email`
  ).all(cid, cid) as any[];
  emailMatches.forEach(r => results.push({ ...r, match_reason: 'Duplicate email' }));

  // ach_account match
  const achMatches = dbi.prepare(
    `SELECT a.id AS id_a, a.name AS name_a, b.id AS id_b, b.name AS name_b
     FROM vendors a JOIN vendors b ON a.id < b.id
     WHERE a.company_id = ? AND b.company_id = ?
       AND a.deleted_at IS NULL AND b.deleted_at IS NULL
       AND a.ach_account IS NOT NULL AND a.ach_account <> ''
       AND a.ach_account = b.ach_account`
  ).all(cid, cid) as any[];
  achMatches.forEach(r => results.push({ ...r, match_reason: 'Duplicate ACH account' }));

  return results;
}

// vn:risk-score — composite 0-100 score + A-F grade per vendor
export function vendorRiskScore(cid: string): object[] {
  const dbi = db.getDb();
  const vendors = dbi.prepare(
    `SELECT id, name, on_time_payment_count, late_payment_count, avg_days_to_pay,
            dispute_count, coi_expiry, contract_end_date, contract_end,
            is_1099_eligible, tax_id
     FROM vendors WHERE company_id = ? AND deleted_at IS NULL`
  ).all(cid) as any[];

  const t = today();
  return vendors
    .map(v => {
      let score = 100;
      const factors: string[] = [];
      const onTime = v.on_time_payment_count || 0;
      const late = v.late_payment_count || 0;
      const total = onTime + late;
      if (total > 0) {
        const lateRatio = late / total;
        if (lateRatio > 0.5) { score -= 25; factors.push('High late-payment rate (>50%)'); }
        else if (lateRatio > 0.25) { score -= 15; factors.push('Elevated late-payment rate (>25%)'); }
        else if (lateRatio > 0.1) { score -= 8; factors.push('Some late payments (>10%)'); }
      }
      const avgDays = v.avg_days_to_pay || 0;
      if (avgDays > 60) { score -= 15; factors.push('Avg days to pay > 60'); }
      else if (avgDays > 30) { score -= 8; factors.push('Avg days to pay > 30'); }
      const disputes = v.dispute_count || 0;
      if (disputes >= 3) { score -= 20; factors.push(`${disputes} disputes on record`); }
      else if (disputes >= 1) { score -= 10; factors.push(`${disputes} dispute(s) on record`); }
      const coiExpiry = v.coi_expiry;
      if (coiExpiry && coiExpiry < t) { score -= 15; factors.push('Insurance (COI) expired'); }
      const contractEnd = v.contract_end_date || v.contract_end;
      if (contractEnd && contractEnd < t) { score -= 10; factors.push('Contract expired'); }
      if (v.is_1099_eligible && (!v.tax_id || v.tax_id.trim() === '')) {
        score -= 10; factors.push('1099-eligible but no Tax ID on file');
      }
      score = Math.max(0, score);
      const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 45 ? 'D' : 'F';
      return { vendorId: v.id, name: v.name, score, grade, factors };
    })
    .sort((a, b) => (a as any).score - (b as any).score);
}

// vn:off-contract-spend — total spend for unapproved or contract-expired vendors
export function vendorOffContractSpend(cid: string): object[] {
  const dbi = db.getDb();
  const vendors = dbi.prepare(
    `SELECT id, name, approval_status,
            COALESCE(contract_end_date, contract_end) AS contract_end_col
     FROM vendors
     WHERE company_id = ? AND deleted_at IS NULL
       AND (
         approval_status IS NULL OR approval_status <> 'approved'
         OR (COALESCE(contract_end_date, contract_end) IS NOT NULL
             AND COALESCE(contract_end_date, contract_end) <> ''
             AND COALESCE(contract_end_date, contract_end) < date('now'))
       )`
  ).all(cid) as any[];

  return vendors
    .map(v => {
      const expSpend = (dbi.prepare(
        `SELECT COALESCE(SUM(amount),0) t FROM expenses WHERE vendor_id = ? AND company_id = ? AND deleted_at IS NULL`
      ).get(v.id, cid) as any)?.t || 0;
      const billSpend = (dbi.prepare(
        `SELECT COALESCE(SUM(total),0) t FROM bills WHERE vendor_id = ? AND company_id = ? AND deleted_at IS NULL`
      ).get(v.id, cid) as any)?.t || 0;
      const total_spend = round2(expSpend + billSpend);
      const contractExpired = v.contract_end_col && v.contract_end_col < today();
      const notApproved = !v.approval_status || v.approval_status !== 'approved';
      const reason = notApproved ? 'Not approved' : 'Contract expired';
      return { vendor_id: v.id, name: v.name, approval_status: v.approval_status || '', total_spend, reason };
    })
    .sort((a, b) => b.total_spend - a.total_spend);
}

// ─── Phase C: 3-way match engine ─────────────────────────────────────────────

// vn:pos-for-vendor — open/approved POs for a vendor (feeds the link picker)
export function posForVendor(cid: string, vendorId: string): object[] {
  return db.getDb().prepare(
    `SELECT id, po_number, total, status
     FROM purchase_orders
     WHERE company_id = ? AND vendor_id = ?
       AND status IN ('draft','sent','approved','partially_received','received')
     ORDER BY created_at DESC`
  ).all(cid, vendorId) as object[];
}

// vn:link-bill-po (WRITE) — link a bill to a PO; auto-map lines by description
export function linkBillToPo(cid: string, billId: string, poId: string): { ok: boolean; linkedLines: number } {
  const dbi = db.getDb();
  // Scope-check: bill must belong to this company
  const bill = dbi.prepare('SELECT id FROM bills WHERE id = ? AND company_id = ?').get(billId, cid) as any;
  if (!bill) return { ok: false, linkedLines: 0 };
  // Set bills.po_id
  dbi.prepare('UPDATE bills SET po_id = ? WHERE id = ? AND company_id = ?').run(poId, billId, cid);
  // Best-effort auto-map bill lines → PO lines by lower(trim(description))
  const billLines = dbi.prepare(
    'SELECT id, lower(trim(description)) AS desc_key FROM bill_line_items WHERE bill_id = ?'
  ).all(billId) as any[];
  const poLines = dbi.prepare(
    'SELECT id, lower(trim(description)) AS desc_key FROM po_line_items WHERE po_id = ?'
  ).all(poId) as any[];
  const poLineMap = new Map<string, string>();
  for (const pl of poLines) {
    if (pl.desc_key) poLineMap.set(pl.desc_key, pl.id);
  }
  let linkedLines = 0;
  const updateLine = dbi.prepare('UPDATE bill_line_items SET po_line_id = ? WHERE id = ?');
  for (const bl of billLines) {
    const matchedPoLineId = bl.desc_key ? poLineMap.get(bl.desc_key) : undefined;
    if (matchedPoLineId) {
      updateLine.run(matchedPoLineId, bl.id);
      linkedLines++;
    }
  }
  return { ok: true, linkedLines };
}

// vn:match-results — 3-way match engine (per bill, per line: qty + price variance)
export function threeWayMatch(cid: string, billId?: string): object[] {
  const dbi = db.getDb();
  const billWhere = billId
    ? 'AND b.id = ?'
    : '';
  const billArgs: any[] = billId ? [cid, billId] : [cid];

  const bills = dbi.prepare(
    `SELECT b.id AS bill_id, b.bill_number, b.total, b.status, b.po_id,
            v.name AS vendor_name,
            po.po_number
     FROM bills b
     LEFT JOIN vendors v ON v.id = b.vendor_id
     LEFT JOIN purchase_orders po ON po.id = b.po_id
     WHERE b.company_id = ? AND b.po_id IS NOT NULL ${billWhere}
     ORDER BY b.created_at DESC`
  ).all(...billArgs) as any[];

  const results: object[] = [];

  for (const bill of bills) {
    const billLines = dbi.prepare(
      `SELECT bl.id, bl.description,
              COALESCE(bl.quantity, 1) AS bill_qty,
              COALESCE(bl.unit_price, 0) AS bill_price,
              bl.po_line_id
       FROM bill_line_items bl
       WHERE bl.bill_id = ?`
    ).all(bill.bill_id) as any[];

    const lines: object[] = [];
    let totalVarianceAmount = 0;
    const lineStatuses: string[] = [];

    for (const bl of billLines) {
      if (!bl.po_line_id) {
        lines.push({
          description: bl.description,
          bill_qty: bl.bill_qty,
          po_received_qty: null,
          qty_variance: null,
          bill_price: bl.bill_price,
          po_price: null,
          price_variance: null,
          status: 'unlinked',
        });
        lineStatuses.push('unlinked');
        continue;
      }

      const pl = dbi.prepare(
        `SELECT COALESCE(quantity_received, 0) AS quantity_received,
                COALESCE(unit_price, 0) AS unit_price
         FROM po_line_items WHERE id = ?`
      ).get(bl.po_line_id) as any;

      if (!pl) {
        lines.push({
          description: bl.description,
          bill_qty: bl.bill_qty,
          po_received_qty: null,
          qty_variance: null,
          bill_price: bl.bill_price,
          po_price: null,
          price_variance: null,
          status: 'unlinked',
        });
        lineStatuses.push('unlinked');
        continue;
      }

      const qtyVariance = round2(bl.bill_qty - pl.quantity_received);
      const priceVariance = round2(bl.bill_price - pl.unit_price);
      const absQty = Math.abs(qtyVariance);
      const absPrice = Math.abs(priceVariance);

      let lineStatus: string;
      if (absQty <= 0 && absPrice <= 0.01) {
        lineStatus = 'matched';
      } else if (absQty > 0 && absPrice > 0.01) {
        // worst: report price_mismatch as the dominant signal
        lineStatus = 'price_mismatch';
      } else if (absQty > 0) {
        lineStatus = qtyVariance > 0 ? 'qty_over' : 'qty_under';
      } else {
        lineStatus = 'price_mismatch';
      }

      totalVarianceAmount += Math.abs(priceVariance * bl.bill_qty);
      lineStatuses.push(lineStatus);

      lines.push({
        description: bl.description,
        bill_qty: bl.bill_qty,
        po_received_qty: pl.quantity_received,
        qty_variance: qtyVariance,
        bill_price: bl.bill_price,
        po_price: pl.unit_price,
        price_variance: priceVariance,
        status: lineStatus,
      });
    }

    // Bill-level rollup: 'matched' only if all lines matched; otherwise worst issue
    const STATUS_RANK: Record<string, number> = {
      matched: 0,
      qty_over: 1,
      qty_under: 1,
      price_mismatch: 2,
      unlinked: 3,
    };
    let worstStatus = 'matched';
    for (const s of lineStatuses) {
      if ((STATUS_RANK[s] ?? 0) > (STATUS_RANK[worstStatus] ?? 0)) {
        worstStatus = s;
      }
    }
    if (lineStatuses.length === 0) worstStatus = 'unlinked';

    results.push({
      bill_id: bill.bill_id,
      bill_number: bill.bill_number,
      vendor_name: bill.vendor_name,
      po_number: bill.po_number,
      status: worstStatus,
      totalVarianceAmount: round2(totalVarianceAmount),
      lines,
    });
  }

  return results;
}

// vn:match-exceptions — bills whose rollup status != 'matched'
export function matchExceptions(cid: string): object[] {
  return (threeWayMatch(cid) as any[]).filter(r => r.status !== 'matched');
}

// vn:unmatched-bills — bills with po_id IS NULL whose vendor has ≥1 PO
export function unmatchedBills(cid: string): object[] {
  return db.getDb().prepare(
    `SELECT b.id AS bill_id, b.bill_number, b.vendor_id,
            v.name AS vendor_name,
            b.total, b.due_date
     FROM bills b
     JOIN vendors v ON v.id = b.vendor_id
     WHERE b.company_id = ?
       AND b.po_id IS NULL
       AND b.deleted_at IS NULL
       AND EXISTS (
         SELECT 1 FROM purchase_orders po
         WHERE po.vendor_id = b.vendor_id AND po.company_id = b.company_id
       )
     ORDER BY b.due_date ASC`
  ).all(cid) as object[];
}

// vn:auto-approve-matched (WRITE) — approve cleanly-matched bills under threshold
export function autoApproveMatched(cid: string, maxAmount: number): { approvedCount: number; billIds: string[] } {
  const matched = (threeWayMatch(cid) as any[]).filter(
    r => r.status === 'matched' && r.bill_id
  );
  const dbi = db.getDb();
  const billIds: string[] = [];
  const updateStmt = dbi.prepare(
    `UPDATE bills SET status = 'approved' WHERE id = ? AND company_id = ? AND status IN ('pending','received')`
  );
  for (const m of matched) {
    const bill = dbi.prepare('SELECT total, status FROM bills WHERE id = ? AND company_id = ?').get(m.bill_id, cid) as any;
    if (!bill) continue;
    if (bill.total > maxAmount) continue;
    if (!['pending', 'received'].includes(bill.status)) continue;
    const info = updateStmt.run(m.bill_id, cid);
    if (info.changes > 0) billIds.push(m.bill_id);
  }
  return { approvedCount: billIds.length, billIds };
}

// vn:price-variance — price drift per vendor+description across bill line items
export function vendorPriceVariance(cid: string, minOccurrences = 3): object[] {
  return db.getDb().prepare(
    `SELECT
       b.vendor_id,
       v.name AS vendor_name,
       lower(trim(li.description)) AS description,
       COUNT(*) AS occurrences,
       ROUND(MIN(li.unit_price), 4) AS min_price,
       ROUND(MAX(li.unit_price), 4) AS max_price,
       ROUND(AVG(li.unit_price), 4) AS avg_price,
       ROUND((MAX(li.unit_price) - MIN(li.unit_price)) / NULLIF(AVG(li.unit_price), 0) * 100, 2) AS variance_pct
     FROM bill_line_items li
     JOIN bills b ON b.id = li.bill_id AND b.company_id = ? AND b.deleted_at IS NULL
     JOIN vendors v ON v.id = b.vendor_id AND v.company_id = ?
     WHERE li.description IS NOT NULL AND li.description <> ''
       AND li.unit_price IS NOT NULL
     GROUP BY b.vendor_id, lower(trim(li.description))
     HAVING COUNT(*) >= ? AND MAX(li.unit_price) > MIN(li.unit_price)
     ORDER BY variance_pct DESC
     LIMIT 100`
  ).all(cid, cid, minOccurrences) as object[];
}
