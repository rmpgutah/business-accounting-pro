// src/main/services/client-vendor-doc-features.ts
//
// Batch 5 — Clients, Vendors, Documents, Compliance features (F61-F70).

import * as db from '../database';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';

const round2 = (n: number): number => Math.round(n * 100) / 100;

// ── F61: Client merge ─────────────────────────────────────────

export function mergeClients(primaryClientId: string, duplicateClientIds: string[]): { merged: number; affected_invoices: number; affected_quotes: number; affected_communications: number } {
  const dbi = db.getDb();
  const transaction = dbi.transaction(() => {
    let affectedInvoices = 0, affectedQuotes = 0, affectedComms = 0;
    for (const dupId of duplicateClientIds) {
      if (dupId === primaryClientId) continue;
      // Reassign invoices
      try { affectedInvoices += dbi.prepare(`UPDATE invoices SET client_id = ? WHERE client_id = ?`).run(primaryClientId, dupId).changes; } catch { /* */ }
      // Reassign quotes
      try { affectedQuotes += dbi.prepare(`UPDATE quotes SET client_id = ? WHERE client_id = ?`).run(primaryClientId, dupId).changes; } catch { /* */ }
      // Reassign communications
      try { affectedComms += dbi.prepare(`UPDATE client_communications SET client_id = ? WHERE client_id = ?`).run(primaryClientId, dupId).changes; } catch { /* */ }
      // Soft-delete the duplicate
      try { dbi.prepare(`UPDATE clients SET deleted_at = datetime('now'), notes = COALESCE(notes, '') || '\n[merged into ' || ? || ' on ' || datetime('now') || ']' WHERE id = ?`).run(primaryClientId, dupId); } catch { /* */ }
    }
    return { merged: duplicateClientIds.length, affected_invoices: affectedInvoices, affected_quotes: affectedQuotes, affected_communications: affectedComms };
  });
  return transaction();
}

export function findClientDuplicates(companyId: string, opts?: { name_threshold?: number }): any[] {
  const dbi = db.getDb();
  // Group clients with same email or very similar name
  const rows = dbi.prepare(`SELECT id, name, email, phone FROM clients WHERE company_id = ? AND COALESCE(deleted_at, '') = ''`).all(companyId) as any[];
  const dupes: Array<{ group: any[]; reason: string }> = [];
  const seen = new Set<string>();
  // By email
  const byEmail: Record<string, any[]> = {};
  for (const c of rows) {
    if (!c.email) continue;
    const k = c.email.toLowerCase().trim();
    if (!byEmail[k]) byEmail[k] = [];
    byEmail[k].push(c);
  }
  for (const [_, group] of Object.entries(byEmail)) {
    if (group.length > 1) {
      dupes.push({ group, reason: 'same email' });
      group.forEach((c) => seen.add(c.id));
    }
  }
  // By similar name (Jaro-Winkler simplified: exact lowercase match)
  const byName: Record<string, any[]> = {};
  for (const c of rows) {
    if (seen.has(c.id) || !c.name) continue;
    const k = c.name.toLowerCase().replace(/\s+/g, ' ').replace(/[.,]/g, '').trim();
    if (!byName[k]) byName[k] = [];
    byName[k].push(c);
  }
  for (const [_, group] of Object.entries(byName)) {
    if (group.length > 1) dupes.push({ group, reason: 'identical name (normalized)' });
  }
  return dupes;
}

// ── F62: Tag / Label System ───────────────────────────────────

export function addTag(record: { company_id: string; entity_type: string; entity_id: string; tag: string; color?: string }): any {
  const dbi = db.getDb();
  const id = uuid();
  try {
    dbi.prepare(`INSERT INTO entity_tags (id, company_id, entity_type, entity_id, tag, color) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, record.company_id, record.entity_type, record.entity_id, record.tag.toLowerCase().trim(), record.color || '#6b7280');
  } catch (e: any) {
    // Likely UNIQUE conflict — tag already exists
    if (!/UNIQUE/i.test(e?.message || '')) throw e;
  }
  return dbi.prepare('SELECT * FROM entity_tags WHERE company_id = ? AND entity_type = ? AND entity_id = ? AND tag = ?').get(record.company_id, record.entity_type, record.entity_id, record.tag.toLowerCase().trim());
}

export function removeTag(id: string): boolean {
  return db.getDb().prepare('DELETE FROM entity_tags WHERE id = ?').run(id).changes > 0;
}

export function listEntityTags(companyId: string, entityType: string, entityId: string): any[] {
  return db.getDb().prepare('SELECT * FROM entity_tags WHERE company_id = ? AND entity_type = ? AND entity_id = ? ORDER BY tag').all(companyId, entityType, entityId) as any[];
}

export function listAllTags(companyId: string, entityType?: string): any[] {
  const dbi = db.getDb();
  const sql = entityType
    ? `SELECT tag, COUNT(*) AS usage_count, MAX(color) AS color FROM entity_tags WHERE company_id = ? AND entity_type = ? GROUP BY tag ORDER BY usage_count DESC`
    : `SELECT tag, COUNT(*) AS usage_count, MAX(color) AS color FROM entity_tags WHERE company_id = ? GROUP BY tag ORDER BY usage_count DESC`;
  const params = entityType ? [companyId, entityType] : [companyId];
  return dbi.prepare(sql).all(...params) as any[];
}

export function searchByTag(companyId: string, entityType: string, tag: string): any[] {
  const dbi = db.getDb();
  const tagLower = tag.toLowerCase().trim();
  try {
    // Note: dynamic table name from entityType (safe — only used here in controlled values)
    if (!['clients', 'vendors', 'invoices', 'expenses', 'employees', 'projects'].includes(entityType)) return [];
    return dbi.prepare(`
      SELECT e.* FROM ${entityType} e
      JOIN entity_tags t ON t.entity_id = e.id
      WHERE t.company_id = ? AND t.entity_type = ? AND t.tag = ?
        AND COALESCE(e.deleted_at, '') = ''
    `).all(companyId, entityType.replace(/s$/, ''), tagLower) as any[];
  } catch { return []; }
}

// ── F63: Client communication log ─────────────────────────────

export function logCommunication(record: { id?: string; company_id: string; client_id: string; communication_type: string; direction?: string; subject?: string; body?: string; contact_name?: string; occurred_at?: string; recorded_by?: string; related_invoice_id?: string; related_quote_id?: string; follow_up_date?: string }): any {
  const dbi = db.getDb();
  const id = record.id || uuid();
  dbi.prepare(`INSERT INTO client_communications (id, company_id, client_id, communication_type, direction, subject, body, contact_name, occurred_at, recorded_by, related_invoice_id, related_quote_id, follow_up_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, record.company_id, record.client_id, record.communication_type, record.direction || 'outbound', record.subject || '', record.body || '', record.contact_name || '', record.occurred_at || new Date().toISOString(), record.recorded_by || '', record.related_invoice_id || null, record.related_quote_id || null, record.follow_up_date || null);
  return dbi.prepare('SELECT * FROM client_communications WHERE id = ?').get(id);
}

export function listCommunications(clientId: string, opts?: { limit?: number; type?: string }): any[] {
  const dbi = db.getDb();
  let sql = 'SELECT * FROM client_communications WHERE client_id = ?';
  const params: any[] = [clientId];
  if (opts?.type) { sql += ' AND communication_type = ?'; params.push(opts.type); }
  sql += ' ORDER BY occurred_at DESC LIMIT ?';
  params.push(Math.min(500, opts?.limit || 100));
  return dbi.prepare(sql).all(...params) as any[];
}

export function pendingFollowUps(companyId: string): any[] {
  const dbi = db.getDb();
  return dbi.prepare(`
    SELECT c.*, cl.name AS client_name
    FROM client_communications c
    JOIN clients cl ON cl.id = c.client_id
    WHERE c.company_id = ? AND c.follow_up_date IS NOT NULL AND c.follow_up_completed = 0
    ORDER BY c.follow_up_date ASC
  `).all(companyId) as any[];
}

// ── F64: Vendor 1099 status auto-check ────────────────────────

export function checkVendor1099Status(companyId: string, year: number): Array<{ vendor_id: string; vendor_name: string; total_paid: number; threshold_met: boolean; has_tin: boolean; eligibility_flagged: boolean; action_needed: string }> {
  const dbi = db.getDb();
  const start = `${year}-01-01`, end = `${year}-12-31`;
  let rows: any[] = [];
  try {
    rows = dbi.prepare(`
      SELECT v.id AS vendor_id, v.name AS vendor_name, v.tin, v.tax_id,
        COALESCE(v.is_1099_eligible, 0) AS eligibility_flagged,
        COALESCE(SUM(e.amount), 0) AS total_paid
      FROM vendors v
      LEFT JOIN expenses e ON e.vendor_id = v.id AND e.date BETWEEN ? AND ? AND COALESCE(e.deleted_at, '') = ''
      WHERE v.company_id = ? AND COALESCE(v.deleted_at, '') = ''
      GROUP BY v.id, v.name, v.tin, v.tax_id, v.is_1099_eligible
    `).all(start, end, companyId) as any[];
  } catch { /* schema variant */ }
  return rows.map((r) => {
    const tin = r.tin || r.tax_id;
    const thresholdMet = r.total_paid >= 600;
    const hasTin = !!tin;
    let action = '';
    if (thresholdMet && !r.eligibility_flagged) action = 'Mark vendor as 1099-eligible — they were paid $' + r.total_paid.toFixed(2);
    else if (thresholdMet && !hasTin) action = 'Request W-9 from vendor — needed for 1099 issuance';
    else if (thresholdMet && hasTin && r.eligibility_flagged) action = 'Ready to issue 1099';
    return { vendor_id: r.vendor_id, vendor_name: r.vendor_name, total_paid: round2(r.total_paid), threshold_met: thresholdMet, has_tin: hasTin, eligibility_flagged: !!r.eligibility_flagged, action_needed: action };
  });
}

// ── F65: Vendor performance scorecard ─────────────────────────

export function computeVendorScorecard(companyId: string, vendorId: string, lookbackDays: number = 365): any {
  const dbi = db.getDb();
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - lookbackDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  let payments: any[] = [];
  try {
    payments = dbi.prepare(`
      SELECT b.id, b.due_date, b.amount, bp.date AS paid_date
      FROM bills b
      LEFT JOIN bill_payments bp ON bp.bill_id = b.id
      WHERE b.vendor_id = ? AND b.created_at >= ?
    `).all(vendorId, cutoffStr) as any[];
  } catch { /* */ }
  const paidBills = payments.filter((p) => p.paid_date);
  const onTime = paidBills.filter((p) => p.due_date && p.paid_date <= p.due_date);
  const late = paidBills.filter((p) => p.due_date && p.paid_date > p.due_date);
  const totalSpend = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const avgDaysToPay = paidBills.length > 0
    ? round2(paidBills.reduce((s, p) => {
      const d1 = new Date(p.due_date + 'T00:00:00').getTime();
      const d2 = new Date(p.paid_date + 'T00:00:00').getTime();
      return s + (d2 - d1) / 86400000;
    }, 0) / paidBills.length)
    : 0;

  // Update vendor record
  try {
    dbi.prepare(`UPDATE vendors SET on_time_payment_count = ?, late_payment_count = ?, avg_days_to_pay = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(onTime.length, late.length, avgDaysToPay, vendorId);
  } catch { /* */ }

  const onTimePct = paidBills.length > 0 ? round2((onTime.length / paidBills.length) * 100) : 0;
  let grade = 'A';
  if (onTimePct < 60) grade = 'D';
  else if (onTimePct < 75) grade = 'C';
  else if (onTimePct < 90) grade = 'B';
  return { vendor_id: vendorId, total_bills: payments.length, paid_bills: paidBills.length, on_time_count: onTime.length, late_count: late.length, on_time_pct: onTimePct, avg_days_to_pay: avgDaysToPay, total_spend: round2(totalSpend), grade, lookback_days: lookbackDays };
}

// ── F66: Vendor contract storage ──────────────────────────────

export function setVendorContract(vendorId: string, contract: { start_date?: string; end_date?: string; auto_renew?: boolean; renewal_notice_days?: number }): boolean {
  return db.getDb().prepare(`UPDATE vendors SET contract_start_date = ?, contract_end_date = ?, contract_auto_renew = ?, contract_renewal_notice_days = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(contract.start_date || null, contract.end_date || null, contract.auto_renew ? 1 : 0, contract.renewal_notice_days ?? 30, vendorId).changes > 0;
}

export function getExpiringContracts(companyId: string, daysAhead: number = 60): any[] {
  const dbi = db.getDb();
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() + daysAhead);
  return dbi.prepare(`
    SELECT id, name, contract_start_date, contract_end_date, contract_auto_renew, contract_renewal_notice_days
    FROM vendors
    WHERE company_id = ?
      AND contract_end_date IS NOT NULL
      AND contract_end_date <= ?
      AND COALESCE(deleted_at, '') = ''
    ORDER BY contract_end_date
  `).all(companyId, cutoff.toISOString().slice(0, 10)) as any[];
}

// ── F67: Document expiration reminders ────────────────────────

export function setDocumentExpiration(documentId: string, expiresAt: string | null, reminderDaysBefore?: number): boolean {
  return db.getDb().prepare(`UPDATE documents SET expires_at = ?, reminder_days_before = ? WHERE id = ?`)
    .run(expiresAt, reminderDaysBefore ?? 30, documentId).changes > 0;
}

export function expiringDocuments(companyId: string, daysAhead: number = 60): any[] {
  const dbi = db.getDb();
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() + daysAhead);
  return dbi.prepare(`SELECT * FROM documents WHERE company_id = ? AND expires_at IS NOT NULL AND expires_at <= ? ORDER BY expires_at`)
    .all(companyId, cutoff.toISOString().slice(0, 10)) as any[];
}

// ── F68: Document version history ─────────────────────────────

export function addDocumentVersion(record: { document_id: string; file_path: string; file_size?: number; uploaded_by?: string; comment?: string }): any {
  const dbi = db.getDb();
  // Get current version number
  const current = dbi.prepare('SELECT COALESCE(MAX(version_number), 0) AS max_v FROM document_versions WHERE document_id = ?').get(record.document_id) as any;
  const nextVersion = (current?.max_v || 0) + 1;
  const fileHash = '';      // Would normally compute SHA-256 of file content
  const id = uuid();
  dbi.prepare(`INSERT INTO document_versions (id, document_id, version_number, file_path, file_size, file_hash, uploaded_by, comment) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, record.document_id, nextVersion, record.file_path, record.file_size || 0, fileHash, record.uploaded_by || '', record.comment || '');
  // Update parent's current_version
  dbi.prepare(`UPDATE documents SET current_version = ?, file_path = ? WHERE id = ?`).run(nextVersion, record.file_path, record.document_id);
  return dbi.prepare('SELECT * FROM document_versions WHERE id = ?').get(id);
}

export function listDocumentVersions(documentId: string): any[] {
  return db.getDb().prepare('SELECT * FROM document_versions WHERE document_id = ? ORDER BY version_number DESC').all(documentId) as any[];
}

// ── F70: Document encryption flag ─────────────────────────────

export function setDocumentEncrypted(documentId: string, isEncrypted: boolean): { ok: boolean; key_id?: string } {
  const dbi = db.getDb();
  if (isEncrypted) {
    // In a real implementation, we'd encrypt the file with a per-doc key derived from a master KMS key.
    // For the schema flag, we generate a key ID reference and trust the caller to handle actual encryption.
    const keyId = crypto.randomBytes(16).toString('hex');
    dbi.prepare(`UPDATE documents SET is_encrypted = 1, encryption_key_id = ? WHERE id = ?`).run(keyId, documentId);
    return { ok: true, key_id: keyId };
  }
  dbi.prepare(`UPDATE documents SET is_encrypted = 0, encryption_key_id = NULL WHERE id = ?`).run(documentId);
  return { ok: true };
}
