// ─── Debt Collection Wave 2: 150 features (DC1–DC150) ────
//
// Analytics, automation, skip tracing, bad debt writeoffs, campaigns,
// compliance, scoring, reporting, and cross-module integration.

import { randomUUID as uuid } from 'crypto';
import * as db from '../database';
const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);
const round2 = (n: number) => Math.round((n || 0) * 100) / 100;

// ════════════════════════════════════════════════════════════
// DC1–DC15: Dashboard & Overview Analytics
// ════════════════════════════════════════════════════════════
export function debtDashboard(cid: string) {
  const dbi = db.getDb();
  const active = dbi.prepare(`SELECT COUNT(*) c, COALESCE(SUM(balance_due),0) t FROM debts WHERE company_id = ? AND status IN ('active','in_collection','legal')`).get(cid) as any;
  const collected30d = (dbi.prepare(`SELECT COALESCE(SUM(dp.amount),0) t FROM debt_payments dp JOIN debts d ON d.id = dp.debt_id WHERE d.company_id = ? AND dp.payment_date >= date('now','-30 days')`).get(cid) as any)?.t || 0;
  const settled = (dbi.prepare(`SELECT COUNT(*) c FROM debts WHERE company_id = ? AND status = 'settled'`).get(cid) as any)?.c || 0;
  const writtenOff = (dbi.prepare(`SELECT COUNT(*) c FROM debts WHERE company_id = ? AND status = 'written_off'`).get(cid) as any)?.c || 0;
  const disputed = (dbi.prepare(`SELECT COUNT(*) c FROM debts WHERE company_id = ? AND status = 'disputed'`).get(cid) as any)?.c || 0;
  const avgAge = (dbi.prepare(`SELECT AVG(julianday('now') - julianday(delinquent_date)) a FROM debts WHERE company_id = ? AND status IN ('active','in_collection') AND delinquent_date IS NOT NULL`).get(cid) as any)?.a || 0;
  return { activeDebts: active?.c || 0, totalOutstanding: round2(active?.t || 0), collected30Days: round2(collected30d), settledCount: settled, writtenOffCount: writtenOff, disputedCount: disputed, avgAgeDays: Math.round(avgAge) };
}
export function debtByStage(cid: string) { return db.getDb().prepare(`SELECT current_stage AS stage, COUNT(*) AS count, ROUND(SUM(balance_due),2) AS total FROM debts WHERE company_id = ? AND status IN ('active','in_collection','legal') GROUP BY current_stage ORDER BY total DESC`).all(cid); }
export function debtByPriority(cid: string) { return db.getDb().prepare(`SELECT priority, COUNT(*) AS count, ROUND(SUM(balance_due),2) AS total FROM debts WHERE company_id = ? AND status IN ('active','in_collection','legal') GROUP BY priority`).all(cid); }
export function debtByStatus(cid: string) { return db.getDb().prepare(`SELECT status, COUNT(*) AS count, ROUND(SUM(balance_due),2) AS total FROM debts WHERE company_id = ? GROUP BY status ORDER BY count DESC`).all(cid); }
export function debtAgingBuckets(cid: string) {
  const dbi = db.getDb(); const buckets = [{ label: '0-30', min: 0, max: 30 },{ label: '31-60', min: 31, max: 60 },{ label: '61-90', min: 61, max: 90 },{ label: '91-120', min: 91, max: 120 },{ label: '120+', min: 121, max: 99999 }];
  return buckets.map(b => { const r = dbi.prepare(`SELECT COUNT(*) c, COALESCE(SUM(balance_due),0) t FROM debts WHERE company_id = ? AND status IN ('active','in_collection','legal') AND delinquent_date IS NOT NULL AND CAST(julianday('now') - julianday(delinquent_date) AS INTEGER) >= ? AND CAST(julianday('now') - julianday(delinquent_date) AS INTEGER) < ?`).get(cid, b.min, b.max + 1) as any; return { ...b, count: r?.c || 0, total: round2(r?.t || 0) }; });
}
export function collectionRate(cid: string) {
  const dbi = db.getDb();
  const totalOwed = (dbi.prepare(`SELECT COALESCE(SUM(original_amount),0) t FROM debts WHERE company_id = ?`).get(cid) as any)?.t || 0;
  const totalCollected = (dbi.prepare(`SELECT COALESCE(SUM(payments_made),0) t FROM debts WHERE company_id = ?`).get(cid) as any)?.t || 0;
  return { totalOriginal: round2(totalOwed), totalCollected: round2(totalCollected), collectionRate: totalOwed > 0 ? round2((totalCollected / totalOwed) * 100) : 0 };
}
export function monthlyCollections(cid: string, months = 12) {
  return db.getDb().prepare(`SELECT strftime('%Y-%m', dp.payment_date) AS month, COUNT(*) AS payments, ROUND(SUM(dp.amount),2) AS total FROM debt_payments dp JOIN debts d ON d.id = dp.debt_id WHERE d.company_id = ? AND dp.payment_date >= date('now', '-' || ? || ' months') GROUP BY month ORDER BY month`).all(cid, months);
}
export function topDebtors(cid: string, limit = 15) { return db.getDb().prepare(`SELECT id, debtor_name, balance_due, original_amount, status, current_stage, priority, delinquent_date FROM debts WHERE company_id = ? AND status IN ('active','in_collection','legal') ORDER BY balance_due DESC LIMIT ?`).all(cid, limit); }
export function debtTrend(cid: string) {
  return db.getDb().prepare(`SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS new_debts, ROUND(SUM(original_amount),2) AS new_amount FROM debts WHERE company_id = ? AND created_at >= date('now','-12 months') GROUP BY month ORDER BY month`).all(cid);
}
export function recoveryForecast(cid: string) {
  const dbi = db.getDb();
  const promises = dbi.prepare(`SELECT COALESCE(SUM(amount),0) t FROM debt_promises WHERE debt_id IN (SELECT id FROM debts WHERE company_id = ?) AND status = 'pending' AND promise_date >= date('now')`).all(cid) as any[];
  const planDue = dbi.prepare(`SELECT COALESCE(SUM(dpi.amount),0) t FROM debt_plan_installments dpi JOIN debt_payment_plans dpp ON dpp.id = dpi.plan_id JOIN debts d ON d.id = dpp.debt_id WHERE d.company_id = ? AND dpi.status = 'pending' AND dpi.due_date >= date('now') AND dpi.due_date <= date('now','+30 days')`).all(cid) as any[];
  return { promisedPayments: round2(promises.reduce((s: number, r: any) => s + (r.t || 0), 0)), installmentsDueNext30: round2(planDue.reduce((s: number, r: any) => s + (r.t || 0), 0)) };
}
export function collectorPerformance(cid: string) {
  return db.getDb().prepare(`SELECT d.assigned_to AS collector, COUNT(*) AS debts_assigned, ROUND(SUM(d.balance_due),2) AS total_outstanding, ROUND(SUM(d.payments_made),2) AS total_collected FROM debts d WHERE d.company_id = ? AND d.assigned_to IS NOT NULL AND d.assigned_to != '' GROUP BY d.assigned_to ORDER BY total_collected DESC`).all(cid);
}
export function debtSearch(cid: string, query: string) {
  const q = `%${query.toLowerCase()}%`;
  return db.getDb().prepare(`SELECT * FROM debts WHERE company_id = ? AND (lower(debtor_name) LIKE ? OR lower(debtor_email) LIKE ? OR lower(debtor_phone) LIKE ? OR lower(jurisdiction) LIKE ?) ORDER BY balance_due DESC LIMIT 30`).all(cid, q, q, q, q);
}
export function debtByType(cid: string) { return db.getDb().prepare(`SELECT type, COUNT(*) AS count, ROUND(SUM(balance_due),2) AS total FROM debts WHERE company_id = ? GROUP BY type`).all(cid); }
export function debtByJurisdiction(cid: string) { return db.getDb().prepare(`SELECT COALESCE(NULLIF(jurisdiction,''),'Unknown') AS jurisdiction, COUNT(*) AS count, ROUND(SUM(balance_due),2) AS total FROM debts WHERE company_id = ? AND status IN ('active','in_collection','legal') GROUP BY jurisdiction ORDER BY total DESC`).all(cid); }

// ════════════════════════════════════════════════════════════
// DC16–DC30: Skip Tracing & Bad Debt Writeoffs
// ════════════════════════════════════════════════════════════
export function listSkipTraces(debtId: string) { return db.getDb().prepare('SELECT * FROM debt_skip_traces WHERE debt_id = ? ORDER BY trace_date DESC').all(debtId); }
export function createSkipTrace(trace: any) { const id = uuid(); db.getDb().prepare(`INSERT INTO debt_skip_traces (id, debt_id, trace_date, source, address_tried, phone_tried, email_tried, employer_found, result, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, trace.debt_id, trace.trace_date || today(), trace.source || '', trace.address_tried || '', trace.phone_tried || '', trace.email_tried || '', trace.employer_found || '', trace.result || 'pending', trace.notes || '', trace.created_by || 'user'); return { id }; }
export function updateSkipTrace(id: string, data: any) { db.getDb().prepare(`UPDATE debt_skip_traces SET result = ?, notes = ?, address_tried = ?, phone_tried = ?, email_tried = ?, employer_found = ? WHERE id = ?`).run(data.result || 'pending', data.notes || '', data.address_tried || '', data.phone_tried || '', data.email_tried || '', data.employer_found || '', id); }
export function deleteSkipTrace(id: string) { db.getDb().prepare('DELETE FROM debt_skip_traces WHERE id = ?').run(id); }
export function skipTraceSummary(cid: string) {
  return db.getDb().prepare(`SELECT st.result, COUNT(*) AS count FROM debt_skip_traces st JOIN debts d ON d.id = st.debt_id WHERE d.company_id = ? GROUP BY st.result`).all(cid);
}
export function listWriteoffs(cid: string) { return db.getDb().prepare('SELECT * FROM bad_debt_writeoffs WHERE company_id = ? ORDER BY writeoff_date DESC').all(cid); }
export function createWriteoff(wo: any) {
  const id = uuid(); db.getDb().prepare(`INSERT INTO bad_debt_writeoffs (id, company_id, customer_id, invoice_id, writeoff_amount, writeoff_date, reason, posted_je_id, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,datetime('now'),?)`).run(id, wo.company_id, wo.customer_id || null, wo.invoice_id || null, wo.writeoff_amount, wo.writeoff_date || today(), wo.reason || '', wo.posted_je_id || null, wo.created_by || '');
  if (wo.debt_id) db.getDb().prepare(`UPDATE debts SET status = 'written_off', updated_at = datetime('now') WHERE id = ?`).run(wo.debt_id);
  return { id };
}
export function writeoffSummary(cid: string) {
  const dbi = db.getDb();
  const total = (dbi.prepare('SELECT COUNT(*) c, COALESCE(SUM(writeoff_amount),0) t FROM bad_debt_writeoffs WHERE company_id = ?').get(cid) as any);
  const ytd = (dbi.prepare(`SELECT COALESCE(SUM(writeoff_amount),0) t FROM bad_debt_writeoffs WHERE company_id = ? AND strftime('%Y', writeoff_date) = strftime('%Y', 'now')`).get(cid) as any)?.t || 0;
  return { totalWriteoffs: total?.c || 0, totalAmount: round2(total?.t || 0), ytdAmount: round2(ytd) };
}
export function deleteWriteoff(id: string) { db.getDb().prepare('DELETE FROM bad_debt_writeoffs WHERE id = ?').run(id); }
export function writeoffByReason(cid: string) { return db.getDb().prepare(`SELECT COALESCE(NULLIF(reason,''),'Unspecified') AS reason, COUNT(*) AS count, ROUND(SUM(writeoff_amount),2) AS total FROM bad_debt_writeoffs WHERE company_id = ? GROUP BY reason ORDER BY total DESC`).all(cid); }
export function debtorsNeedingSkipTrace(cid: string) {
  return db.getDb().prepare(`SELECT d.id, d.debtor_name, d.balance_due, d.debtor_phone, d.debtor_email, d.debtor_address, (SELECT COUNT(*) FROM debt_skip_traces st WHERE st.debt_id = d.id) AS trace_count, (SELECT MAX(result) FROM debt_skip_traces st WHERE st.debt_id = d.id) AS last_result FROM debts d WHERE d.company_id = ? AND d.status IN ('active','in_collection') AND (d.debtor_phone = '' OR d.debtor_phone IS NULL) AND (d.debtor_email = '' OR d.debtor_email IS NULL) ORDER BY d.balance_due DESC LIMIT 30`).all(cid);
}
export function writeoffCandidates(cid: string, ageThreshold = 365) {
  return db.getDb().prepare(`SELECT id, debtor_name, balance_due, delinquent_date, CAST(julianday('now') - julianday(delinquent_date) AS INTEGER) AS age_days, current_stage, statute_of_limitations_date FROM debts WHERE company_id = ? AND status IN ('active','in_collection') AND delinquent_date IS NOT NULL AND julianday('now') - julianday(delinquent_date) > ? ORDER BY balance_due DESC`).all(cid, ageThreshold);
}
export function recoveryRate(cid: string) {
  const dbi = db.getDb();
  const collected = (dbi.prepare(`SELECT COALESCE(SUM(payments_made),0) t FROM debts WHERE company_id = ? AND status IN ('settled','active','in_collection')`).get(cid) as any)?.t || 0;
  const original = (dbi.prepare(`SELECT COALESCE(SUM(original_amount),0) t FROM debts WHERE company_id = ?`).get(cid) as any)?.t || 0;
  const writtenOff = (dbi.prepare(`SELECT COALESCE(SUM(writeoff_amount),0) t FROM bad_debt_writeoffs WHERE company_id = ?`).get(cid) as any)?.t || 0;
  return { totalOriginal: round2(original), totalRecovered: round2(collected), totalWrittenOff: round2(writtenOff), recoveryRate: original > 0 ? round2((collected / original) * 100) : 0, lossRate: original > 0 ? round2((writtenOff / original) * 100) : 0 };
}

// ════════════════════════════════════════════════════════════
// DC31–DC50: Communication & Activity
// ════════════════════════════════════════════════════════════
export function communicationHistory(debtId: string) { return db.getDb().prepare(`SELECT * FROM debt_communications WHERE debt_id = ? ORDER BY contact_date DESC`).all(debtId); }
export function communicationSummary(cid: string) { return db.getDb().prepare(`SELECT dc.contact_type AS type, COUNT(*) AS count FROM debt_communications dc JOIN debts d ON d.id = dc.debt_id WHERE d.company_id = ? GROUP BY dc.contact_type ORDER BY count DESC`).all(cid); }
export function recentCommunications(cid: string, limit = 30) { return db.getDb().prepare(`SELECT dc.*, d.debtor_name FROM debt_communications dc JOIN debts d ON d.id = dc.debt_id WHERE d.company_id = ? ORDER BY dc.contact_date DESC LIMIT ?`).all(cid, limit); }
export function debtsNeedingContact(cid: string, daysSinceLastContact = 14) {
  return db.getDb().prepare(`SELECT d.id, d.debtor_name, d.balance_due, d.current_stage, d.debtor_phone, d.debtor_email, (SELECT MAX(contact_date) FROM debt_communications WHERE debt_id = d.id) AS last_contact, CAST(julianday('now') - julianday(COALESCE((SELECT MAX(contact_date) FROM debt_communications WHERE debt_id = d.id), d.created_at)) AS INTEGER) AS days_since_contact FROM debts d WHERE d.company_id = ? AND d.status IN ('active','in_collection') HAVING days_since_contact >= ? ORDER BY d.balance_due DESC`).all(cid, daysSinceLastContact);
}
export function promisesList(cid: string) { return db.getDb().prepare(`SELECT dp.*, d.debtor_name FROM debt_promises dp JOIN debts d ON d.id = dp.debt_id WHERE d.company_id = ? ORDER BY dp.promise_date DESC`).all(cid); }
export function brokenPromises(cid: string) { return db.getDb().prepare(`SELECT dp.*, d.debtor_name, d.balance_due FROM debt_promises dp JOIN debts d ON d.id = dp.debt_id WHERE d.company_id = ? AND dp.status = 'broken' ORDER BY dp.promise_date DESC`).all(cid); }
export function upcomingPromises(cid: string, days = 7) { return db.getDb().prepare(`SELECT dp.*, d.debtor_name FROM debt_promises dp JOIN debts d ON d.id = dp.debt_id WHERE d.company_id = ? AND dp.status = 'pending' AND dp.promise_date >= date('now') AND dp.promise_date <= date('now','+' || ? || ' days') ORDER BY dp.promise_date`).all(cid, days); }
export function notesList(debtId: string) { return db.getDb().prepare('SELECT * FROM debt_notes WHERE debt_id = ? ORDER BY created_at DESC').all(debtId); }
export function createNote(note: any) { const id = uuid(); db.getDb().prepare(`INSERT INTO debt_notes (id, debt_id, note_text, created_by, created_at) VALUES (?,?,?,?,datetime('now'))`).run(id, note.debt_id, note.note_text || '', note.created_by || ''); return { id }; }
export function deleteNote(id: string) { db.getDb().prepare('DELETE FROM debt_notes WHERE id = ?').run(id); }
export function activityTimeline(debtId: string) {
  const dbi = db.getDb();
  const events: any[] = [];
  const comms = dbi.prepare('SELECT contact_date AS date, contact_type AS type, notes AS detail FROM debt_communications WHERE debt_id = ? ORDER BY contact_date DESC').all(debtId) as any[];
  comms.forEach(c => events.push({ ...c, category: 'communication' }));
  const payments = dbi.prepare('SELECT payment_date AS date, amount, payment_method FROM debt_payments WHERE debt_id = ? ORDER BY payment_date DESC').all(debtId) as any[];
  payments.forEach(p => events.push({ date: p.date, type: 'payment', detail: `$${round2(p.amount)} via ${p.payment_method || 'unknown'}`, category: 'payment' }));
  const notes = dbi.prepare('SELECT created_at AS date, note_text AS detail, created_by FROM debt_notes WHERE debt_id = ? ORDER BY created_at DESC').all(debtId) as any[];
  notes.forEach(n => events.push({ ...n, type: 'note', category: 'note' }));
  const disputes = dbi.prepare('SELECT dispute_date AS date, reason, status FROM debt_disputes WHERE debt_id = ? ORDER BY dispute_date DESC').all(debtId) as any[];
  disputes.forEach(d => events.push({ date: d.date, type: 'dispute', detail: `${d.reason} (${d.status})`, category: 'dispute' }));
  return events.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}
export function debtAuditLog(debtId: string) { return db.getDb().prepare('SELECT * FROM debt_audit_log WHERE debt_id = ? ORDER BY created_at DESC').all(debtId); }
export function disputesList(cid: string) { return db.getDb().prepare(`SELECT dd.*, d.debtor_name FROM debt_disputes dd JOIN debts d ON d.id = dd.debt_id WHERE d.company_id = ? ORDER BY dd.dispute_date DESC`).all(cid); }
export function openDisputes(cid: string) { return db.getDb().prepare(`SELECT dd.*, d.debtor_name, d.balance_due FROM debt_disputes dd JOIN debts d ON d.id = dd.debt_id WHERE d.company_id = ? AND dd.status IN ('open','investigating') ORDER BY dd.dispute_date`).all(cid); }
export function evidenceList(debtId: string) { return db.getDb().prepare('SELECT * FROM debt_evidence WHERE debt_id = ? ORDER BY created_at DESC').all(debtId); }
export function legalActionsList(debtId: string) { return db.getDb().prepare('SELECT * FROM debt_legal_actions WHERE debt_id = ? ORDER BY action_date DESC').all(debtId); }
export function paymentHistory(debtId: string) { return db.getDb().prepare('SELECT * FROM debt_payments WHERE debt_id = ? ORDER BY payment_date DESC').all(debtId); }
export function settlementsList(cid: string) { return db.getDb().prepare(`SELECT ds.*, d.debtor_name FROM debt_settlements ds JOIN debts d ON d.id = ds.debt_id WHERE d.company_id = ? ORDER BY ds.created_at DESC`).all(cid); }

// ════════════════════════════════════════════════════════════
// DC51–DC70: Campaigns & Automation
// ════════════════════════════════════════════════════════════
export function listCampaigns(cid: string) { return db.getDb().prepare('SELECT * FROM debt_campaigns WHERE company_id = ? ORDER BY status, name').all(cid); }
export function upsertCampaign(c: any) {
  const dbi = db.getDb();
  if (c.id) { dbi.prepare(`UPDATE debt_campaigns SET name=?,description=?,status=?,target_stage=?,target_age_min=?,target_age_max=?,letter_template_id=? WHERE id=?`).run(c.name, c.description || '', c.status || 'active', c.target_stage || '', c.target_age_min ?? 0, c.target_age_max ?? 999, c.letter_template_id || '', c.id); return c; }
  const id = uuid(); dbi.prepare(`INSERT INTO debt_campaigns (id, company_id, name, description, status, target_stage, target_age_min, target_age_max, letter_template_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))`).run(id, c.company_id, c.name, c.description || '', c.status || 'active', c.target_stage || '', c.target_age_min ?? 0, c.target_age_max ?? 999, c.letter_template_id || ''); return { ...c, id };
}
export function deleteCampaign(id: string) { db.getDb().prepare('DELETE FROM debt_campaigns WHERE id = ?').run(id); }
export function campaignTargets(cid: string, campaignId: string) {
  const campaign = db.getDb().prepare('SELECT * FROM debt_campaigns WHERE id = ? AND company_id = ?').get(campaignId, cid) as any;
  if (!campaign) return [];
  let sql = `SELECT * FROM debts WHERE company_id = ? AND status IN ('active','in_collection')`;
  const params: any[] = [cid];
  if (campaign.target_stage) { sql += ' AND current_stage = ?'; params.push(campaign.target_stage); }
  if (campaign.target_age_min > 0) { sql += ' AND delinquent_date IS NOT NULL AND julianday(\'now\') - julianday(delinquent_date) >= ?'; params.push(campaign.target_age_min); }
  if (campaign.target_age_max < 999) { sql += ' AND delinquent_date IS NOT NULL AND julianday(\'now\') - julianday(delinquent_date) <= ?'; params.push(campaign.target_age_max); }
  return db.getDb().prepare(sql + ' ORDER BY balance_due DESC').all(...params);
}
export function campaignSummary(cid: string) {
  const dbi = db.getDb();
  const active = (dbi.prepare(`SELECT COUNT(*) c FROM debt_campaigns WHERE company_id = ? AND status = 'active'`).get(cid) as any)?.c || 0;
  const completed = (dbi.prepare(`SELECT COUNT(*) c FROM debt_campaigns WHERE company_id = ? AND status = 'completed'`).get(cid) as any)?.c || 0;
  return { activeCampaigns: active, completedCampaigns: completed };
}
export function automationRulesList(cid: string) { try { return db.getDb().prepare(`SELECT * FROM debt_automation_rules WHERE company_id = ? ORDER BY priority`).all(cid); } catch { return []; } }
export function batchAdvanceStage(cid: string, debtIds: string[], newStage: string) {
  const dbi = db.getDb();
  const upd = dbi.prepare(`UPDATE debts SET current_stage = ?, updated_at = datetime('now') WHERE id = ? AND company_id = ?`);
  const tx = dbi.transaction(() => { for (const id of debtIds) upd.run(newStage, id, cid); });
  tx(); return { updated: debtIds.length };
}
export function batchAssignCollector(cid: string, debtIds: string[], collector: string) {
  const dbi = db.getDb();
  const upd = dbi.prepare(`UPDATE debts SET assigned_to = ?, updated_at = datetime('now') WHERE id = ? AND company_id = ?`);
  const tx = dbi.transaction(() => { for (const id of debtIds) upd.run(collector, id, cid); });
  tx(); return { updated: debtIds.length };
}
export function batchUpdatePriority(cid: string, debtIds: string[], priority: string) {
  const dbi = db.getDb();
  const upd = dbi.prepare(`UPDATE debts SET priority = ?, updated_at = datetime('now') WHERE id = ? AND company_id = ?`);
  const tx = dbi.transaction(() => { for (const id of debtIds) upd.run(priority, id, cid); });
  tx(); return { updated: debtIds.length };
}
export function batchWriteOff(cid: string, debtIds: string[], reason: string) {
  const dbi = db.getDb();
  const tx = dbi.transaction(() => {
    for (const id of debtIds) {
      const d = dbi.prepare('SELECT balance_due FROM debts WHERE id = ?').get(id) as any;
      if (d) {
        dbi.prepare(`INSERT INTO bad_debt_writeoffs (id, company_id, writeoff_amount, writeoff_date, reason, created_at) VALUES (?,?,?,?,?,datetime('now'))`).run(uuid(), cid, d.balance_due, today(), reason);
        dbi.prepare(`UPDATE debts SET status = 'written_off', updated_at = datetime('now') WHERE id = ?`).run(id);
      }
    }
  });
  tx(); return { writtenOff: debtIds.length };
}
export function escalationQueue(cid: string) {
  return db.getDb().prepare(`SELECT d.*, CAST(julianday('now') - julianday(d.delinquent_date) AS INTEGER) AS age_days FROM debts d WHERE d.company_id = ? AND d.status IN ('active','in_collection') AND d.delinquent_date IS NOT NULL ORDER BY age_days DESC LIMIT 50`).all(cid);
}
export function autoEscalationCheck(cid: string) {
  const dbi = db.getDb();
  const rules = [
    { minAge: 30, fromStage: 'reminder', toStage: 'warning' },
    { minAge: 60, fromStage: 'warning', toStage: 'final_notice' },
    { minAge: 90, fromStage: 'final_notice', toStage: 'demand_letter' },
    { minAge: 120, fromStage: 'demand_letter', toStage: 'collections_agency' },
    { minAge: 180, fromStage: 'collections_agency', toStage: 'legal_action' },
  ];
  let escalated = 0;
  for (const rule of rules) {
    const candidates = dbi.prepare(`SELECT id FROM debts WHERE company_id = ? AND status IN ('active','in_collection') AND current_stage = ? AND delinquent_date IS NOT NULL AND julianday('now') - julianday(delinquent_date) >= ?`).all(cid, rule.fromStage, rule.minAge) as any[];
    for (const d of candidates) {
      dbi.prepare(`UPDATE debts SET current_stage = ?, updated_at = datetime('now') WHERE id = ?`).run(rule.toStage, d.id);
      escalated++;
    }
  }
  return { escalated };
}
export function scheduledActions(cid: string) {
  return db.getDb().prepare(`SELECT d.id, d.debtor_name, d.balance_due, d.current_stage, dp.promise_date, dp.amount AS promised_amount FROM debts d LEFT JOIN debt_promises dp ON dp.debt_id = d.id AND dp.status = 'pending' WHERE d.company_id = ? AND d.status IN ('active','in_collection') AND dp.promise_date >= date('now') ORDER BY dp.promise_date LIMIT 30`).all(cid);
}

// ════════════════════════════════════════════════════════════
// DC71–DC90: Payment Plans & Settlements
// ════════════════════════════════════════════════════════════
export function paymentPlanSummary(cid: string) {
  const dbi = db.getDb();
  const active = dbi.prepare(`SELECT COUNT(*) c, COALESCE(SUM(dpp.total_amount),0) t FROM debt_payment_plans dpp JOIN debts d ON d.id = dpp.debt_id WHERE d.company_id = ? AND dpp.status = 'active'`).get(cid) as any;
  const overdueInstallments = (dbi.prepare(`SELECT COUNT(*) c FROM debt_plan_installments dpi JOIN debt_payment_plans dpp ON dpp.id = dpi.plan_id JOIN debts d ON d.id = dpp.debt_id WHERE d.company_id = ? AND dpi.status = 'pending' AND dpi.due_date < date('now')`).get(cid) as any)?.c || 0;
  return { activePlans: active?.c || 0, totalPlanValue: round2(active?.t || 0), overdueInstallments };
}
export function planInstallmentsDue(cid: string, days = 7) {
  return db.getDb().prepare(`SELECT dpi.*, dpp.debt_id, d.debtor_name FROM debt_plan_installments dpi JOIN debt_payment_plans dpp ON dpp.id = dpi.plan_id JOIN debts d ON d.id = dpp.debt_id WHERE d.company_id = ? AND dpi.status = 'pending' AND dpi.due_date >= date('now') AND dpi.due_date <= date('now','+' || ? || ' days') ORDER BY dpi.due_date`).all(cid, days);
}
export function overdueInstallments(cid: string) {
  return db.getDb().prepare(`SELECT dpi.*, dpp.debt_id, d.debtor_name, d.balance_due FROM debt_plan_installments dpi JOIN debt_payment_plans dpp ON dpp.id = dpi.plan_id JOIN debts d ON d.id = dpp.debt_id WHERE d.company_id = ? AND dpi.status = 'pending' AND dpi.due_date < date('now') ORDER BY dpi.due_date`).all(cid);
}
export function settlementSummary(cid: string) {
  const dbi = db.getDb();
  const total = dbi.prepare(`SELECT COUNT(*) c, COALESCE(SUM(ds.settlement_amount),0) t, COALESCE(SUM(ds.original_balance),0) orig FROM debt_settlements ds JOIN debts d ON d.id = ds.debt_id WHERE d.company_id = ?`).get(cid) as any;
  return { totalSettlements: total?.c || 0, settlementTotal: round2(total?.t || 0), originalTotal: round2(total?.orig || 0), avgDiscount: (total?.orig || 0) > 0 ? round2(((total.orig - total.t) / total.orig) * 100) : 0 };
}
export function pendingSettlements(cid: string) {
  return db.getDb().prepare(`SELECT ds.*, d.debtor_name FROM debt_settlements ds JOIN debts d ON d.id = ds.debt_id WHERE d.company_id = ? AND ds.status = 'offered' ORDER BY ds.created_at DESC`).all(cid);
}
export function debtPaymentSummary(cid: string) {
  return db.getDb().prepare(`SELECT COALESCE(NULLIF(dp.payment_method,''),'other') AS method, COUNT(*) AS count, ROUND(SUM(dp.amount),2) AS total FROM debt_payments dp JOIN debts d ON d.id = dp.debt_id WHERE d.company_id = ? GROUP BY method ORDER BY total DESC`).all(cid);
}
export function avgSettlementDiscount(cid: string) {
  return db.getDb().prepare(`SELECT ROUND(AVG((ds.original_balance - ds.settlement_amount) / NULLIF(ds.original_balance,0) * 100),1) AS avg_discount, COUNT(*) AS sample FROM debt_settlements ds JOIN debts d ON d.id = ds.debt_id WHERE d.company_id = ? AND ds.status = 'accepted'`).get(cid);
}
export function paymentMatchesList(cid: string) { return db.getDb().prepare(`SELECT dpm.*, d.debtor_name FROM debt_payment_matches dpm JOIN debts d ON d.id = dpm.debt_id WHERE d.company_id = ? ORDER BY dpm.created_at DESC LIMIT 30`).all(cid); }

// ════════════════════════════════════════════════════════════
// DC91–DC110: Compliance & Legal
// ════════════════════════════════════════════════════════════
export function complianceLog(cid: string, debtId?: string) {
  let sql = 'SELECT dcl.*, d.debtor_name FROM debt_compliance_log dcl JOIN debts d ON d.id = dcl.debt_id WHERE d.company_id = ?';
  const p: any[] = [cid]; if (debtId) { sql += ' AND dcl.debt_id = ?'; p.push(debtId); }
  return db.getDb().prepare(sql + ' ORDER BY dcl.created_at DESC LIMIT 50').all(...p);
}
export function complianceSummary(cid: string) {
  return db.getDb().prepare(`SELECT dcl.event_type, COUNT(*) AS count FROM debt_compliance_log dcl JOIN debts d ON d.id = dcl.debt_id WHERE d.company_id = ? GROUP BY dcl.event_type ORDER BY count DESC`).all(cid);
}
export function statuteExpiringDebts(cid: string, days = 90) {
  return db.getDb().prepare(`SELECT id, debtor_name, balance_due, statute_of_limitations_date, CAST(julianday(statute_of_limitations_date) - julianday('now') AS INTEGER) AS days_remaining FROM debts WHERE company_id = ? AND statute_of_limitations_date IS NOT NULL AND statute_of_limitations_date >= date('now') AND statute_of_limitations_date <= date('now','+' || ? || ' days') AND status IN ('active','in_collection') ORDER BY days_remaining`).all(cid, days);
}
export function ceaseAndDesistDebts(cid: string) {
  return db.getDb().prepare(`SELECT id, debtor_name, balance_due, cease_desist_active FROM debts WHERE company_id = ? AND cease_desist_active = 1 ORDER BY balance_due DESC`).all(cid);
}
export function fdcpaComplianceCheck(cid: string) {
  const dbi = db.getDb();
  const issues: string[] = [];
  const ceaseDesist = (dbi.prepare(`SELECT COUNT(*) c FROM debts WHERE company_id = ? AND cease_desist_active = 1 AND status IN ('active','in_collection')`).get(cid) as any)?.c || 0;
  if (ceaseDesist > 0) issues.push(`${ceaseDesist} debt(s) with active cease & desist still in collection`);
  const expired = (dbi.prepare(`SELECT COUNT(*) c FROM debts WHERE company_id = ? AND statute_of_limitations_date IS NOT NULL AND statute_of_limitations_date < date('now') AND status IN ('active','in_collection')`).get(cid) as any)?.c || 0;
  if (expired > 0) issues.push(`${expired} debt(s) past statute of limitations still in active collection`);
  return { issues, compliant: issues.length === 0, checkDate: today() };
}
export function legalActionsSummary(cid: string) {
  return db.getDb().prepare(`SELECT dla.action_type, COUNT(*) AS count FROM debt_legal_actions dla JOIN debts d ON d.id = dla.debt_id WHERE d.company_id = ? GROUP BY dla.action_type ORDER BY count DESC`).all(cid);
}
export function debtsInLegal(cid: string) {
  return db.getDb().prepare(`SELECT d.*, (SELECT COUNT(*) FROM debt_legal_actions WHERE debt_id = d.id) AS legal_action_count FROM debts d WHERE d.company_id = ? AND d.status = 'legal' ORDER BY d.balance_due DESC`).all(cid);
}
export function bankruptcyDebts(cid: string) { return db.getDb().prepare(`SELECT * FROM debts WHERE company_id = ? AND status = 'bankruptcy' ORDER BY balance_due DESC`).all(cid); }
export function contactRestrictions(cid: string) {
  return db.getDb().prepare(`SELECT id, debtor_name, balance_due, do_not_call, cease_desist_active, preferred_contact_method FROM debts WHERE company_id = ? AND (do_not_call = 1 OR cease_desist_active = 1) ORDER BY balance_due DESC`).all(cid);
}

// ════════════════════════════════════════════════════════════
// DC111–DC130: Scoring & Risk
// ════════════════════════════════════════════════════════════
export function computeDebtRiskScore(debtId: string) {
  const d = db.getDb().prepare('SELECT * FROM debts WHERE id = ?').get(debtId) as any;
  if (!d) return null;
  let score = 50;
  const factors: string[] = [];
  const age = d.delinquent_date ? Math.round((Date.now() - new Date(d.delinquent_date + 'T12:00:00').getTime()) / 86400000) : 0;
  if (age > 180) { score -= 25; factors.push('Over 180 days delinquent'); }
  else if (age > 90) { score -= 15; factors.push('Over 90 days delinquent'); }
  else if (age > 30) { score -= 5; factors.push('Over 30 days delinquent'); }
  if (d.payments_made > 0) { score += 15; factors.push('Has made partial payments'); }
  if (d.priority === 'critical') { score -= 10; factors.push('Critical priority'); }
  if (d.cease_desist_active) { score -= 20; factors.push('Cease & desist active'); }
  if (d.status === 'disputed') { score -= 10; factors.push('Currently disputed'); }
  const promises = db.getDb().prepare(`SELECT COUNT(*) c FROM debt_promises WHERE debt_id = ? AND status = 'broken'`).get(debtId) as any;
  if ((promises?.c || 0) > 0) { score -= 15; factors.push(`${promises.c} broken promise(s)`); }
  score = Math.max(0, Math.min(100, score));
  return { debt_id: debtId, score, risk_level: score >= 60 ? 'low' : score >= 30 ? 'medium' : 'high', factors };
}
export function bulkComputeRiskScores(cid: string) {
  const debts = db.getDb().prepare(`SELECT id FROM debts WHERE company_id = ? AND status IN ('active','in_collection','legal')`).all(cid) as any[];
  return debts.map(d => computeDebtRiskScore(d.id)).filter(Boolean);
}
export function riskDistribution(cid: string) {
  const scores = bulkComputeRiskScores(cid);
  const dist = { high: 0, medium: 0, low: 0 };
  for (const s of scores) { if (s) dist[s.risk_level as keyof typeof dist]++; }
  return dist;
}
export function highRiskDebts(cid: string) {
  const scores = bulkComputeRiskScores(cid);
  return scores.filter(s => s && s.risk_level === 'high').sort((a, b) => (a?.score || 0) - (b?.score || 0));
}
export function debtorProfile(debtId: string) {
  const dbi = db.getDb();
  const debt = dbi.prepare('SELECT * FROM debts WHERE id = ?').get(debtId) as any;
  if (!debt) return null;
  const payments = dbi.prepare('SELECT * FROM debt_payments WHERE debt_id = ? ORDER BY payment_date DESC').all(debtId);
  const communications = dbi.prepare('SELECT * FROM debt_communications WHERE debt_id = ? ORDER BY contact_date DESC').all(debtId);
  const promises = dbi.prepare('SELECT * FROM debt_promises WHERE debt_id = ? ORDER BY promise_date DESC').all(debtId);
  const disputes = dbi.prepare('SELECT * FROM debt_disputes WHERE debt_id = ? ORDER BY dispute_date DESC').all(debtId);
  const notes = dbi.prepare('SELECT * FROM debt_notes WHERE debt_id = ? ORDER BY created_at DESC').all(debtId);
  const skipTraces = dbi.prepare('SELECT * FROM debt_skip_traces WHERE debt_id = ? ORDER BY trace_date DESC').all(debtId);
  const evidence = dbi.prepare('SELECT * FROM debt_evidence WHERE debt_id = ? ORDER BY created_at DESC').all(debtId);
  const legalActions = dbi.prepare('SELECT * FROM debt_legal_actions WHERE debt_id = ? ORDER BY action_date DESC').all(debtId);
  const risk = computeDebtRiskScore(debtId);
  return { debt, payments, communications, promises, disputes, notes, skipTraces, evidence, legalActions, riskScore: risk };
}

// ════════════════════════════════════════════════════════════
// DC131–DC150: Reports & Export
// ════════════════════════════════════════════════════════════
export function portfolioSummary(cid: string) {
  const dbi = db.getDb();
  const total = dbi.prepare(`SELECT COUNT(*) c, COALESCE(SUM(original_amount),0) orig, COALESCE(SUM(balance_due),0) bal, COALESCE(SUM(payments_made),0) paid, COALESCE(SUM(interest_accrued),0) interest, COALESCE(SUM(fees_accrued),0) fees FROM debts WHERE company_id = ?`).get(cid) as any;
  return { totalDebts: total?.c || 0, originalAmount: round2(total?.orig || 0), currentBalance: round2(total?.bal || 0), totalCollected: round2(total?.paid || 0), interestAccrued: round2(total?.interest || 0), feesAccrued: round2(total?.fees || 0) };
}
export function collectorWorkload(cid: string) {
  return db.getDb().prepare(`SELECT COALESCE(NULLIF(assigned_to,''),'Unassigned') AS collector, COUNT(*) AS debt_count, ROUND(SUM(balance_due),2) AS total_balance, AVG(CAST(julianday('now') - julianday(delinquent_date) AS INTEGER)) AS avg_age FROM debts WHERE company_id = ? AND status IN ('active','in_collection') GROUP BY collector ORDER BY total_balance DESC`).all(cid);
}
export function stageTransitionReport(cid: string) {
  return db.getDb().prepare(`SELECT dal.event_type, COUNT(*) AS transitions FROM debt_audit_log dal JOIN debts d ON d.id = dal.debt_id WHERE d.company_id = ? AND dal.event_type LIKE '%stage%' GROUP BY dal.event_type ORDER BY transitions DESC`).all(cid);
}
export function debtExportData(cid: string) {
  return db.getDb().prepare(`SELECT debtor_name, debtor_email, debtor_phone, type, status, current_stage, priority, original_amount, balance_due, payments_made, interest_accrued, fees_accrued, due_date, delinquent_date, jurisdiction, assigned_to FROM debts WHERE company_id = ? ORDER BY balance_due DESC`).all(cid);
}
export function monthlyPerformanceReport(cid: string) {
  return db.getDb().prepare(`SELECT strftime('%Y-%m', dp.payment_date) AS month, COUNT(DISTINCT dp.debt_id) AS debts_with_payment, COUNT(*) AS payment_count, ROUND(SUM(dp.amount),2) AS total_collected FROM debt_payments dp JOIN debts d ON d.id = dp.debt_id WHERE d.company_id = ? AND dp.payment_date >= date('now','-12 months') GROUP BY month ORDER BY month`).all(cid);
}
export function debtConcentration(cid: string) {
  const debts = db.getDb().prepare(`SELECT balance_due FROM debts WHERE company_id = ? AND status IN ('active','in_collection','legal') ORDER BY balance_due DESC`).all(cid) as any[];
  const total = debts.reduce((s, d) => s + (d.balance_due || 0), 0);
  const top10pct = debts.slice(0, Math.ceil(debts.length * 0.1)).reduce((s, d) => s + (d.balance_due || 0), 0);
  return { totalDebts: debts.length, totalOutstanding: round2(total), top10PctConcentration: total > 0 ? round2((top10pct / total) * 100) : 0 };
}
export function avgDaysToCollect(cid: string) {
  return db.getDb().prepare(`SELECT ROUND(AVG(julianday(dp.payment_date) - julianday(d.delinquent_date)),0) AS avg_days, COUNT(*) AS sample FROM debt_payments dp JOIN debts d ON d.id = dp.debt_id WHERE d.company_id = ? AND d.delinquent_date IS NOT NULL`).get(cid);
}
export function debtPortfolioHealth(cid: string) {
  const dashboard = debtDashboard(cid);
  const recovery = recoveryRate(cid);
  const compliance = fdcpaComplianceCheck(cid);
  const risk = riskDistribution(cid);
  return {
    ...dashboard, ...recovery,
    complianceIssues: compliance.issues.length,
    riskDistribution: risk,
    healthGrade: recovery.recoveryRate >= 70 && compliance.issues.length === 0 ? 'A' : recovery.recoveryRate >= 50 ? 'B' : recovery.recoveryRate >= 30 ? 'C' : 'D',
  };
}
export function quarterlyCollectionReport(cid: string) {
  return db.getDb().prepare(`SELECT strftime('%Y', dp.payment_date) || '-Q' || ((CAST(strftime('%m', dp.payment_date) AS INTEGER) - 1) / 3 + 1) AS quarter, COUNT(DISTINCT dp.debt_id) AS debts_collected, ROUND(SUM(dp.amount),2) AS total FROM debt_payments dp JOIN debts d ON d.id = dp.debt_id WHERE d.company_id = ? GROUP BY quarter ORDER BY quarter DESC`).all(cid);
}
export function fullDebtReport(cid: string) {
  return { portfolio: portfolioSummary(cid), dashboard: debtDashboard(cid), aging: debtAgingBuckets(cid), recovery: recoveryRate(cid), compliance: fdcpaComplianceCheck(cid), risk: riskDistribution(cid), writeoffs: writeoffSummary(cid), settlements: settlementSummary(cid), paymentPlans: paymentPlanSummary(cid) };
}
