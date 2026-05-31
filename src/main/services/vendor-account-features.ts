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
