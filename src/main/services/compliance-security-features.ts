// ─── Batch 10: Compliance, Security, API (F151-F170) ───
//
// Data retention policies, GDPR data subject requests, anonymization log,
// per-entity audit history, user session log, IP whitelist, 2FA setup,
// API tokens with hashed storage, API rate limits + request log, webhook
// secret rotation, PCI/SOC2 control registers, data masking rules,
// right-to-be-forgotten requests, consent records, sub-processor register,
// data classification, encryption + backup verification logs, vuln tracking.

import { randomUUID as uuid, createHash, randomBytes } from 'crypto';
import * as db from '../database';

const now = (): string => new Date().toISOString();
const today = (): string => now().slice(0, 10);

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

// ════════════════════════════════════════════════════════════════
// F151. Data retention policies
// ════════════════════════════════════════════════════════════════
export function upsertRetentionPolicy(p: any): any {
  const dbi = db.getDb();
  const id = p.id || uuid();
  if (p.id) {
    dbi.prepare(`UPDATE data_retention_policies SET policy_name = ?, entity_type = ?, retention_days = ?, action_after_retention = ?, legal_basis = ?, is_active = ?, updated_at = ? WHERE id = ?`)
      .run(p.policy_name, p.entity_type, p.retention_days || 2555, p.action_after_retention || 'archive', p.legal_basis || null, p.is_active === false ? 0 : 1, now(), p.id);
  } else {
    dbi.prepare(`INSERT INTO data_retention_policies (id, company_id, policy_name, entity_type, retention_days, action_after_retention, legal_basis, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, p.company_id, p.policy_name, p.entity_type, p.retention_days || 2555, p.action_after_retention || 'archive', p.legal_basis || null, p.is_active === false ? 0 : 1, now(), now());
  }
  return { id, ...p };
}

export function listRetentionPolicies(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM data_retention_policies WHERE company_id = ? ORDER BY entity_type`).all(companyId) as any[];
}

export function applyRetentionPolicy(policyId: string): { records_affected: number } {
  const dbi = db.getDb();
  const p = dbi.prepare(`SELECT * FROM data_retention_policies WHERE id = ?`).get(policyId) as any;
  if (!p || !p.is_active) return { records_affected: 0 };
  // Soft-delete or archive based on action_after_retention
  // Only act on whitelisted tables for safety
  const safeTables = new Set(['email_log', 'notifications', 'audit_log', 'bank_match_attempts', 'workflow_runs', 'webhook_deliveries', 'api_request_log']);
  if (!safeTables.has(p.entity_type)) return { records_affected: 0 };
  let affected = 0;
  try {
    if (p.action_after_retention === 'delete') {
      // hard delete
      const r = dbi.prepare(`DELETE FROM ${p.entity_type} WHERE company_id = ? AND date(created_at) < date('now', '-' || ? || ' days')`).run(p.company_id, p.retention_days);
      affected = r.changes;
    } else {
      // mark as archived by setting deleted_at column where present
      try {
        const r = dbi.prepare(`UPDATE ${p.entity_type} SET deleted_at = ? WHERE company_id = ? AND date(created_at) < date('now', '-' || ? || ' days')`).run(now(), p.company_id, p.retention_days);
        affected = r.changes;
      } catch {
        affected = 0;
      }
    }
  } catch (e) {
    affected = 0;
  }
  dbi.prepare(`UPDATE data_retention_policies SET last_applied_at = ?, records_affected_last_run = ?, updated_at = ? WHERE id = ?`)
    .run(now(), affected, now(), policyId);
  return { records_affected: affected };
}

// ════════════════════════════════════════════════════════════════
// F152. Data subject requests (DSR)
// ════════════════════════════════════════════════════════════════
export function createDataSubjectRequest(r: any): any {
  const dbi = db.getDb();
  const id = uuid();
  const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  dbi.prepare(`INSERT INTO data_subject_requests (id, company_id, request_type, subject_type, subject_id, subject_email, requested_at, requested_by, status, response_due_date, notes, verification_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?, ?)`)
    .run(id, r.company_id, r.request_type, r.subject_type || null, r.subject_id || null, r.subject_email || null, now(), r.requested_by || null, dueDate, r.notes || null, r.verification_method || null);
  return { id, response_due_date: dueDate };
}

export function exportSubjectData(companyId: string, subjectEmail: string): { customer_data: any[]; invoices: any[]; communications: any[]; activities: any[] } {
  const dbi = db.getDb();
  const customerData = dbi.prepare(`SELECT * FROM clients WHERE company_id = ? AND email = ?`).all(companyId, subjectEmail) as any[];
  const ids = customerData.map((c: any) => c.id);
  const placeholders = ids.length > 0 ? ids.map(() => '?').join(',') : "''";
  const invoices = ids.length > 0 ? dbi.prepare(`SELECT * FROM invoices WHERE company_id = ? AND client_id IN (${placeholders})`).all(companyId, ...ids) as any[] : [];
  const communications = ids.length > 0 ? dbi.prepare(`SELECT * FROM client_communications WHERE client_id IN (${placeholders})`).all(...ids) as any[] : [];
  const activities = dbi.prepare(`SELECT * FROM entity_audit_history WHERE company_id = ? AND user_email = ?`).all(companyId, subjectEmail) as any[];
  return { customer_data: customerData, invoices, communications, activities };
}

export function completeDsr(id: string, fulfilledBy: string, exportPath?: string): boolean {
  const r = db.getDb().prepare(`UPDATE data_subject_requests SET status = 'completed', completed_at = ?, fulfilled_by = ?, export_path = ? WHERE id = ?`).run(now(), fulfilledBy, exportPath || null, id);
  return r.changes > 0;
}

export function listDsrs(companyId: string, opts?: { status?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  return dbi.prepare(`SELECT * FROM data_subject_requests WHERE ${where} ORDER BY requested_at DESC`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// F153. Anonymization
// ════════════════════════════════════════════════════════════════
export function anonymizeSubject(companyId: string, opts: { subject_type: string; subject_id: string; fields: string[]; performed_by: string; reason?: string; dsr_id?: string }): { fields_anonymized: number } {
  const dbi = db.getDb();
  // Whitelist for safety
  const safeTables = new Set(['clients', 'vendors', 'employees']);
  if (!safeTables.has(opts.subject_type)) throw new Error('Unsupported subject type for anonymization');
  const setClauses = opts.fields.map(f => `${f} = ?`).join(', ');
  const values = opts.fields.map(f => `[REDACTED-${Date.now()}]`);
  values.push(opts.subject_id);
  try {
    dbi.prepare(`UPDATE ${opts.subject_type} SET ${setClauses} WHERE id = ?`).run(...values);
  } catch (e: any) {
    throw new Error(`Anonymization failed: ${e?.message}`);
  }
  dbi.prepare(`INSERT INTO anonymization_log (id, company_id, subject_type, subject_id, fields_anonymized, performed_by, performed_at, reason, dsr_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(uuid(), companyId, opts.subject_type, opts.subject_id, opts.fields.join(','), opts.performed_by, now(), opts.reason || null, opts.dsr_id || null);
  return { fields_anonymized: opts.fields.length };
}

export function listAnonymizations(companyId: string, limit: number = 100): any[] {
  return db.getDb().prepare(`SELECT * FROM anonymization_log WHERE company_id = ? ORDER BY performed_at DESC LIMIT ?`).all(companyId, Math.min(limit, 1000)) as any[];
}

// ════════════════════════════════════════════════════════════════
// F154. Entity audit history
// ════════════════════════════════════════════════════════════════
export function recordAuditEvent(e: { company_id: string; entity_type: string; entity_id: string; action: string; user_id?: string; user_email?: string; changes?: any; ip_address?: string; user_agent?: string }): void {
  db.getDb().prepare(`INSERT INTO entity_audit_history (id, company_id, entity_type, entity_id, action, user_id, user_email, changes_json, ip_address, user_agent, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(uuid(), e.company_id, e.entity_type, e.entity_id, e.action, e.user_id || null, e.user_email || null, JSON.stringify(e.changes || {}), e.ip_address || null, e.user_agent || null, now());
}

export function getEntityAuditHistory(companyId: string, entityType: string, entityId: string, limit: number = 100): any[] {
  return db.getDb().prepare(`SELECT * FROM entity_audit_history WHERE company_id = ? AND entity_type = ? AND entity_id = ? ORDER BY occurred_at DESC LIMIT ?`).all(companyId, entityType, entityId, Math.min(limit, 1000)) as any[];
}

// ════════════════════════════════════════════════════════════════
// F155. User sessions
// ════════════════════════════════════════════════════════════════
export function logSession(s: { user_id: string; user_email?: string; session_token?: string; ip_address?: string; user_agent?: string; login_method?: string; company_id?: string; location_country?: string; location_region?: string }): any {
  const dbi = db.getDb();
  // Simple heuristic: if user has prior login from different country in last 7 days, mark suspicious
  let suspicious = 0;
  let suspiciousReason: string | null = null;
  if (s.location_country) {
    const recent = dbi.prepare(`SELECT location_country FROM user_session_log WHERE user_id = ? AND location_country IS NOT NULL AND location_country != ? AND login_at >= datetime('now', '-7 days') LIMIT 1`).get(s.user_id, s.location_country) as any;
    if (recent) { suspicious = 1; suspiciousReason = `Recent login from different country: ${recent.location_country}`; }
  }
  const id = uuid();
  dbi.prepare(`INSERT INTO user_session_log (id, user_id, user_email, session_token, login_at, ip_address, user_agent, location_country, location_region, login_method, suspicious, suspicious_reason, company_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, s.user_id, s.user_email || null, s.session_token || null, now(), s.ip_address || null, s.user_agent || null, s.location_country || null, s.location_region || null, s.login_method || 'password', suspicious, suspiciousReason, s.company_id || null);
  return { id, suspicious };
}

export function logLogout(sessionId: string): boolean {
  const r = db.getDb().prepare(`UPDATE user_session_log SET logout_at = ? WHERE id = ?`).run(now(), sessionId);
  return r.changes > 0;
}

export function listSessions(userId: string, limit: number = 50): any[] {
  return db.getDb().prepare(`SELECT * FROM user_session_log WHERE user_id = ? ORDER BY login_at DESC LIMIT ?`).all(userId, Math.min(limit, 500)) as any[];
}

// ════════════════════════════════════════════════════════════════
// F156. IP access whitelist
// ════════════════════════════════════════════════════════════════
export function addToWhitelist(w: any): any {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO ip_access_whitelist (id, company_id, cidr_or_ip, label, added_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, w.company_id, w.cidr_or_ip, w.label || null, w.added_by || null, w.expires_at || null, now());
  return { id, ...w };
}

export function removeFromWhitelist(id: string): boolean {
  const r = db.getDb().prepare(`UPDATE ip_access_whitelist SET is_active = 0 WHERE id = ?`).run(id);
  return r.changes > 0;
}

export function listWhitelist(companyId: string, activeOnly: boolean = true): any[] {
  const dbi = db.getDb();
  let where = 'company_id = ?';
  if (activeOnly) where += ' AND is_active = 1';
  return dbi.prepare(`SELECT * FROM ip_access_whitelist WHERE ${where} ORDER BY created_at DESC`).all(companyId) as any[];
}

export function isIpAllowed(companyId: string, ip: string): boolean {
  const dbi = db.getDb();
  const list = dbi.prepare(`SELECT cidr_or_ip FROM ip_access_whitelist WHERE company_id = ? AND is_active = 1 AND (expires_at IS NULL OR expires_at > datetime('now'))`).all(companyId) as any[];
  if (list.length === 0) return true; // No whitelist configured = allow all
  for (const entry of list) {
    if (matchesCidr(ip, entry.cidr_or_ip)) return true;
  }
  return false;
}

function matchesCidr(ip: string, cidrOrIp: string): boolean {
  if (cidrOrIp === ip) return true;
  // simple prefix match for IPv4 CIDR
  if (cidrOrIp.includes('/')) {
    const [prefix, bitsStr] = cidrOrIp.split('/');
    const bits = parseInt(bitsStr, 10);
    if (isNaN(bits)) return false;
    const ipNum = ipv4ToInt(ip);
    const prefixNum = ipv4ToInt(prefix);
    if (ipNum === null || prefixNum === null) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipNum & mask) === (prefixNum & mask);
  }
  return false;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.').map(p => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

// ════════════════════════════════════════════════════════════════
// F157. 2FA
// ════════════════════════════════════════════════════════════════
export function setup2FA(userId: string, method: 'totp' | 'sms' | 'email' = 'totp'): { secret: string; backup_codes: string[] } {
  const secret = randomBytes(20).toString('base64').replace(/[^A-Z2-7]/gi, '').slice(0, 32);
  const backupCodes = Array.from({ length: 10 }, () => randomBytes(4).toString('hex').toUpperCase());
  const dbi = db.getDb();
  const existing = dbi.prepare(`SELECT id FROM user_2fa WHERE user_id = ?`).get(userId);
  if (existing) {
    dbi.prepare(`UPDATE user_2fa SET method = ?, secret = ?, backup_codes = ?, is_enabled = 0 WHERE user_id = ?`).run(method, secret, JSON.stringify(backupCodes), userId);
  } else {
    dbi.prepare(`INSERT INTO user_2fa (id, user_id, method, secret, backup_codes, is_enabled, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)`).run(uuid(), userId, method, secret, JSON.stringify(backupCodes), now());
  }
  return { secret, backup_codes: backupCodes };
}

export function enable2FA(userId: string): boolean {
  const r = db.getDb().prepare(`UPDATE user_2fa SET is_enabled = 1, enabled_at = ? WHERE user_id = ?`).run(now(), userId);
  return r.changes > 0;
}

export function disable2FA(userId: string): boolean {
  const r = db.getDb().prepare(`UPDATE user_2fa SET is_enabled = 0 WHERE user_id = ?`).run(userId);
  return r.changes > 0;
}

export function get2FAStatus(userId: string): { is_enabled: boolean; method?: string; enabled_at?: string } | null {
  const r = db.getDb().prepare(`SELECT method, is_enabled, enabled_at FROM user_2fa WHERE user_id = ?`).get(userId) as any;
  if (!r) return null;
  return { is_enabled: !!r.is_enabled, method: r.method, enabled_at: r.enabled_at };
}

// ════════════════════════════════════════════════════════════════
// F158. API tokens
// ════════════════════════════════════════════════════════════════
export function createApiToken(companyId: string, opts: { name: string; scopes?: string[]; expires_at?: string; issued_by?: string }): { id: string; plaintext: string; prefix: string } {
  const plaintext = `bap_${randomBytes(28).toString('hex')}`;
  const prefix = plaintext.slice(0, 12);
  const hash = sha256(plaintext);
  const id = uuid();
  db.getDb().prepare(`INSERT INTO api_tokens (id, company_id, name, token_hash, token_prefix, scopes, issued_by, issued_at, expires_at, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
    .run(id, companyId, opts.name, hash, prefix, JSON.stringify(opts.scopes || ['read']), opts.issued_by || null, now(), opts.expires_at || null);
  return { id, plaintext, prefix };
}

export function verifyApiToken(plaintext: string): { token_id: string; company_id: string; scopes: string[] } | null {
  const dbi = db.getDb();
  const hash = sha256(plaintext);
  const r = dbi.prepare(`SELECT id, company_id, scopes, expires_at FROM api_tokens WHERE token_hash = ? AND is_active = 1`).get(hash) as any;
  if (!r) return null;
  if (r.expires_at && r.expires_at < now()) return null;
  dbi.prepare(`UPDATE api_tokens SET last_used_at = ?, usage_count = usage_count + 1 WHERE id = ?`).run(now(), r.id);
  let scopes: string[] = [];
  try { scopes = JSON.parse(r.scopes || '[]'); } catch {}
  return { token_id: r.id, company_id: r.company_id, scopes };
}

export function revokeApiToken(id: string): boolean {
  const r = db.getDb().prepare(`UPDATE api_tokens SET is_active = 0, revoked_at = ? WHERE id = ?`).run(now(), id);
  return r.changes > 0;
}

export function listApiTokens(companyId: string, includeRevoked: boolean = false): any[] {
  const dbi = db.getDb();
  let where = 'company_id = ?';
  if (!includeRevoked) where += ' AND is_active = 1';
  return dbi.prepare(`SELECT id, company_id, name, token_prefix, scopes, issued_by, issued_at, expires_at, last_used_at, usage_count, is_active, revoked_at FROM api_tokens WHERE ${where} ORDER BY issued_at DESC`).all(companyId) as any[];
}

// ════════════════════════════════════════════════════════════════
// F159. API rate limits + request log
// ════════════════════════════════════════════════════════════════
export function upsertRateLimit(r: any): any {
  const dbi = db.getDb();
  const id = r.id || uuid();
  if (r.id) {
    dbi.prepare(`UPDATE api_rate_limits SET token_id = ?, endpoint_pattern = ?, requests_per_minute = ?, requests_per_day = ?, burst_size = ?, notes = ?, updated_at = ? WHERE id = ?`)
      .run(r.token_id || null, r.endpoint_pattern || null, r.requests_per_minute || 60, r.requests_per_day || 10000, r.burst_size || 10, r.notes || null, now(), r.id);
  } else {
    dbi.prepare(`INSERT INTO api_rate_limits (id, company_id, token_id, endpoint_pattern, requests_per_minute, requests_per_day, burst_size, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, r.company_id, r.token_id || null, r.endpoint_pattern || null, r.requests_per_minute || 60, r.requests_per_day || 10000, r.burst_size || 10, r.notes || null, now(), now());
  }
  return { id, ...r };
}

export function logApiRequest(r: { company_id?: string; token_id?: string; endpoint: string; method: string; status_code: number; duration_ms?: number; ip_address?: string }): void {
  db.getDb().prepare(`INSERT INTO api_request_log (id, company_id, token_id, endpoint, method, status_code, duration_ms, ip_address, requested_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(uuid(), r.company_id || null, r.token_id || null, r.endpoint, r.method, r.status_code, r.duration_ms || 0, r.ip_address || null, now());
}

export function getRequestCount(tokenId: string, windowSeconds: number): number {
  const r = db.getDb().prepare(`SELECT COUNT(*) AS c FROM api_request_log WHERE token_id = ? AND requested_at >= datetime('now', '-' || ? || ' seconds')`).get(tokenId, windowSeconds) as any;
  return r.c || 0;
}

export function checkRateLimit(tokenId: string): { allowed: boolean; limit_per_minute: number; current_minute_count: number; limit_per_day: number; current_day_count: number } {
  const dbi = db.getDb();
  const limits = dbi.prepare(`SELECT * FROM api_rate_limits WHERE token_id = ? LIMIT 1`).get(tokenId) as any;
  const perMinute = limits?.requests_per_minute || 60;
  const perDay = limits?.requests_per_day || 10000;
  const minuteCount = getRequestCount(tokenId, 60);
  const dayCount = getRequestCount(tokenId, 86400);
  const allowed = minuteCount < perMinute && dayCount < perDay;
  return { allowed, limit_per_minute: perMinute, current_minute_count: minuteCount, limit_per_day: perDay, current_day_count: dayCount };
}

// ════════════════════════════════════════════════════════════════
// F160. Webhook secret rotation
// ════════════════════════════════════════════════════════════════
export function rotateWebhookSecret(subscriptionId: string, rotatedBy: string, reason?: string): { new_secret: string } {
  const dbi = db.getDb();
  const sub = dbi.prepare(`SELECT secret_key FROM webhook_subscriptions WHERE id = ?`).get(subscriptionId) as any;
  if (!sub) throw new Error('Subscription not found');
  const oldHash = sub.secret_key ? sha256(sub.secret_key) : null;
  const newSecret = `whsec_${randomBytes(32).toString('hex')}`;
  dbi.prepare(`UPDATE webhook_subscriptions SET secret_key = ? WHERE id = ?`).run(newSecret, subscriptionId);
  dbi.prepare(`INSERT INTO webhook_secret_rotations (id, subscription_id, rotated_at, rotated_by, old_secret_hash, new_secret_hash, reason) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(uuid(), subscriptionId, now(), rotatedBy, oldHash, sha256(newSecret), reason || null);
  return { new_secret: newSecret };
}

export function listSecretRotations(subscriptionId: string): any[] {
  return db.getDb().prepare(`SELECT id, subscription_id, rotated_at, rotated_by, reason FROM webhook_secret_rotations WHERE subscription_id = ? ORDER BY rotated_at DESC`).all(subscriptionId) as any[];
}

// ════════════════════════════════════════════════════════════════
// F161. PCI checklist
// ════════════════════════════════════════════════════════════════
export function upsertPciItem(i: any): any {
  const dbi = db.getDb();
  const id = i.id || uuid();
  if (i.id) {
    dbi.prepare(`UPDATE pci_checklist_items SET requirement_number = ?, requirement_text = ?, sub_requirement = ?, status = ?, evidence_path = ?, last_assessed_at = ?, next_assessment_due = ?, assessor = ?, notes = ?, updated_at = ? WHERE id = ?`)
      .run(i.requirement_number || null, i.requirement_text, i.sub_requirement || null, i.status || 'not_applicable', i.evidence_path || null, i.last_assessed_at || null, i.next_assessment_due || null, i.assessor || null, i.notes || null, now(), i.id);
  } else {
    dbi.prepare(`INSERT INTO pci_checklist_items (id, company_id, requirement_number, requirement_text, sub_requirement, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, i.company_id, i.requirement_number || null, i.requirement_text, i.sub_requirement || null, i.status || 'not_applicable', i.notes || null, now(), now());
  }
  return { id, ...i };
}

export function listPciItems(companyId: string, opts?: { status?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  return dbi.prepare(`SELECT * FROM pci_checklist_items WHERE ${where} ORDER BY requirement_number`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// F162. SOC 2 controls
// ════════════════════════════════════════════════════════════════
export function upsertSoc2Control(c: any): any {
  const dbi = db.getDb();
  const id = c.id || uuid();
  if (c.id) {
    dbi.prepare(`UPDATE soc2_controls SET trust_principle = ?, control_id = ?, control_description = ?, implementation_status = ?, owner = ?, test_frequency = ?, last_test_date = ?, last_test_result = ?, next_test_due = ?, evidence_path = ?, notes = ?, updated_at = ? WHERE id = ?`)
      .run(c.trust_principle || null, c.control_id || null, c.control_description, c.implementation_status || 'planned', c.owner || null, c.test_frequency || 'annual', c.last_test_date || null, c.last_test_result || null, c.next_test_due || null, c.evidence_path || null, c.notes || null, now(), c.id);
  } else {
    dbi.prepare(`INSERT INTO soc2_controls (id, company_id, trust_principle, control_id, control_description, implementation_status, owner, test_frequency, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, c.company_id, c.trust_principle || null, c.control_id || null, c.control_description, c.implementation_status || 'planned', c.owner || null, c.test_frequency || 'annual', c.notes || null, now(), now());
  }
  return { id, ...c };
}

export function listSoc2Controls(companyId: string, opts?: { trust_principle?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.trust_principle) { where += ' AND trust_principle = ?'; params.push(opts.trust_principle); }
  return dbi.prepare(`SELECT * FROM soc2_controls WHERE ${where} ORDER BY trust_principle, control_id`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// F163. Data masking
// ════════════════════════════════════════════════════════════════
export function upsertMaskingRule(r: any): any {
  const dbi = db.getDb();
  const id = r.id || uuid();
  if (r.id) {
    dbi.prepare(`UPDATE data_masking_rules SET field_path = ?, mask_type = ?, visible_chars = ?, replacement_char = ?, applies_to_roles = ?, is_active = ?, notes = ? WHERE id = ?`)
      .run(r.field_path, r.mask_type || 'full', r.visible_chars || 4, r.replacement_char || '*', r.applies_to_roles || null, r.is_active === false ? 0 : 1, r.notes || null, r.id);
  } else {
    dbi.prepare(`INSERT INTO data_masking_rules (id, company_id, field_path, mask_type, visible_chars, replacement_char, applies_to_roles, is_active, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, r.company_id, r.field_path, r.mask_type || 'full', r.visible_chars || 4, r.replacement_char || '*', r.applies_to_roles || null, r.is_active === false ? 0 : 1, r.notes || null, now());
  }
  return { id, ...r };
}

export function applyMask(value: string, maskType: 'full' | 'partial' | 'email' | 'ssn' | 'last4' = 'full', visibleChars: number = 4, replacementChar: string = '*'): string {
  if (!value) return value;
  switch (maskType) {
    case 'last4':
      return value.length <= visibleChars ? value : replacementChar.repeat(value.length - visibleChars) + value.slice(-visibleChars);
    case 'email': {
      const at = value.indexOf('@');
      if (at <= 0) return value;
      const local = value.slice(0, at);
      const visible = local.slice(0, Math.min(2, local.length));
      return visible + replacementChar.repeat(Math.max(local.length - 2, 1)) + value.slice(at);
    }
    case 'ssn':
      return value.length === 9 ? replacementChar.repeat(5) + value.slice(-4) : value;
    case 'partial':
      return value.length <= visibleChars * 2 ? value : value.slice(0, visibleChars) + replacementChar.repeat(value.length - visibleChars * 2) + value.slice(-visibleChars);
    case 'full':
    default:
      return replacementChar.repeat(value.length);
  }
}

export function listMaskingRules(companyId: string): any[] {
  return db.getDb().prepare(`SELECT * FROM data_masking_rules WHERE company_id = ? ORDER BY field_path`).all(companyId) as any[];
}

// ════════════════════════════════════════════════════════════════
// F164. Right-to-be-forgotten
// ════════════════════════════════════════════════════════════════
export function createRtbfRequest(r: any): any {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO rtbf_requests (id, company_id, subject_email, subject_id, requested_at, verification_method, status, notes) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`)
    .run(id, r.company_id, r.subject_email, r.subject_id || null, now(), r.verification_method || null, r.notes || null);
  return { id, status: 'pending' };
}

export function verifyRtbfRequest(id: string): boolean {
  const r = db.getDb().prepare(`UPDATE rtbf_requests SET verified_at = ?, status = 'verified' WHERE id = ? AND status = 'pending'`).run(now(), id);
  return r.changes > 0;
}

export function fulfillRtbfRequest(id: string, opts: { records_deleted: number; records_anonymized: number; records_retained: number; retention_reason?: string; fulfilled_by: string }): boolean {
  const r = db.getDb().prepare(`UPDATE rtbf_requests SET status = 'completed', records_deleted_count = ?, records_anonymized_count = ?, records_retained_count = ?, retention_reason = ?, completed_at = ?, fulfilled_by = ? WHERE id = ? AND status IN ('verified','pending')`)
    .run(opts.records_deleted, opts.records_anonymized, opts.records_retained, opts.retention_reason || null, now(), opts.fulfilled_by, id);
  return r.changes > 0;
}

export function listRtbfRequests(companyId: string, opts?: { status?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  return dbi.prepare(`SELECT * FROM rtbf_requests WHERE ${where} ORDER BY requested_at DESC`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// F165. Consent records
// ════════════════════════════════════════════════════════════════
export function recordConsent(c: any): any {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO consent_records (id, company_id, subject_type, subject_id, subject_email, consent_type, consent_version, granted, granted_at, ip_address, user_agent, proof_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, c.company_id, c.subject_type || null, c.subject_id || null, c.subject_email || null, c.consent_type, c.consent_version || null, c.granted === false ? 0 : 1, now(), c.ip_address || null, c.user_agent || null, c.proof_text || null);
  return { id };
}

export function withdrawConsent(id: string): boolean {
  const r = db.getDb().prepare(`UPDATE consent_records SET granted = 0, withdrawn_at = ? WHERE id = ?`).run(now(), id);
  return r.changes > 0;
}

export function getConsents(companyId: string, opts?: { subject_id?: string; subject_email?: string; consent_type?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.subject_id) { where += ' AND subject_id = ?'; params.push(opts.subject_id); }
  if (opts?.subject_email) { where += ' AND subject_email = ?'; params.push(opts.subject_email); }
  if (opts?.consent_type) { where += ' AND consent_type = ?'; params.push(opts.consent_type); }
  return dbi.prepare(`SELECT * FROM consent_records WHERE ${where} ORDER BY granted_at DESC`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// F166. Sub-processors
// ════════════════════════════════════════════════════════════════
export function upsertSubProcessor(s: any): any {
  const dbi = db.getDb();
  const id = s.id || uuid();
  if (s.id) {
    dbi.prepare(`UPDATE sub_processors SET processor_name = ?, processor_role = ?, data_categories = ?, location = ?, transfer_mechanism = ?, contract_url = ?, dpa_signed_date = ?, risk_rating = ?, review_frequency = ?, last_review_date = ?, next_review_due = ?, is_active = ?, notes = ?, updated_at = ? WHERE id = ?`)
      .run(s.processor_name, s.processor_role || null, s.data_categories || null, s.location || null, s.transfer_mechanism || null, s.contract_url || null, s.dpa_signed_date || null, s.risk_rating || 'low', s.review_frequency || 'annual', s.last_review_date || null, s.next_review_due || null, s.is_active === false ? 0 : 1, s.notes || null, now(), s.id);
  } else {
    dbi.prepare(`INSERT INTO sub_processors (id, company_id, processor_name, processor_role, data_categories, location, transfer_mechanism, contract_url, dpa_signed_date, risk_rating, review_frequency, is_active, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, s.company_id, s.processor_name, s.processor_role || null, s.data_categories || null, s.location || null, s.transfer_mechanism || null, s.contract_url || null, s.dpa_signed_date || null, s.risk_rating || 'low', s.review_frequency || 'annual', s.is_active === false ? 0 : 1, s.notes || null, now(), now());
  }
  return { id, ...s };
}

export function listSubProcessors(companyId: string, activeOnly: boolean = true): any[] {
  const dbi = db.getDb();
  let where = 'company_id = ?';
  if (activeOnly) where += ' AND is_active = 1';
  return dbi.prepare(`SELECT * FROM sub_processors WHERE ${where} ORDER BY processor_name`).all(companyId) as any[];
}

// ════════════════════════════════════════════════════════════════
// F167. Data classifications
// ════════════════════════════════════════════════════════════════
export function classifyData(c: any): any {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO data_classifications (id, company_id, table_name, column_name, sensitivity_level, is_pii, is_phi, is_pci, encryption_required, access_restrictions, retention_class, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, c.company_id, c.table_name, c.column_name || null, c.sensitivity_level || 'internal', c.is_pii ? 1 : 0, c.is_phi ? 1 : 0, c.is_pci ? 1 : 0, c.encryption_required ? 1 : 0, c.access_restrictions || null, c.retention_class || null, c.notes || null, now());
  return { id, ...c };
}

export function listClassifications(companyId: string, opts?: { table_name?: string; sensitivity_level?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.table_name) { where += ' AND table_name = ?'; params.push(opts.table_name); }
  if (opts?.sensitivity_level) { where += ' AND sensitivity_level = ?'; params.push(opts.sensitivity_level); }
  return dbi.prepare(`SELECT * FROM data_classifications WHERE ${where} ORDER BY table_name, column_name`).all(...params) as any[];
}

// ════════════════════════════════════════════════════════════════
// F168. Encryption verification
// ════════════════════════════════════════════════════════════════
export function recordEncryptionVerification(v: any): any {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO encryption_verification_log (id, company_id, scope, verified_at, verified_by, algorithm, key_id, is_compliant, issues, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, v.company_id, v.scope, now(), v.verified_by || null, v.algorithm || 'AES-256', v.key_id || null, v.is_compliant === false ? 0 : 1, v.issues || null, v.notes || null);
  return { id };
}

export function listEncryptionVerifications(companyId: string, limit: number = 100): any[] {
  return db.getDb().prepare(`SELECT * FROM encryption_verification_log WHERE company_id = ? ORDER BY verified_at DESC LIMIT ?`).all(companyId, Math.min(limit, 1000)) as any[];
}

// ════════════════════════════════════════════════════════════════
// F169. Backup verification
// ════════════════════════════════════════════════════════════════
export function recordBackupVerification(v: any): any {
  const id = uuid();
  db.getDb().prepare(`INSERT INTO backup_verification_log (id, company_id, backup_type, backup_path, backup_size_bytes, backup_date, verified_at, verification_method, is_valid, can_restore, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, v.company_id || null, v.backup_type || 'full', v.backup_path || null, v.backup_size_bytes || 0, v.backup_date || null, now(), v.verification_method || 'checksum', v.is_valid === false ? 0 : 1, v.can_restore === false ? 0 : 1, v.notes || null);
  return { id };
}

export function listBackupVerifications(companyId?: string, limit: number = 100): any[] {
  const dbi = db.getDb();
  if (companyId) return dbi.prepare(`SELECT * FROM backup_verification_log WHERE company_id = ? ORDER BY verified_at DESC LIMIT ?`).all(companyId, Math.min(limit, 1000)) as any[];
  return dbi.prepare(`SELECT * FROM backup_verification_log ORDER BY verified_at DESC LIMIT ?`).all(Math.min(limit, 1000)) as any[];
}

// ════════════════════════════════════════════════════════════════
// F170. Vulnerabilities
// ════════════════════════════════════════════════════════════════
export function upsertVulnerability(v: any): any {
  const dbi = db.getDb();
  const id = v.id || uuid();
  if (v.id) {
    dbi.prepare(`UPDATE vulnerabilities SET cve_id = ?, title = ?, severity = ?, cvss_score = ?, affected_component = ?, discovered_date = ?, discovered_by = ?, status = ?, remediation_plan = ?, assigned_to = ?, target_remediation_date = ?, actual_remediation_date = ?, notes = ?, updated_at = ? WHERE id = ?`)
      .run(v.cve_id || null, v.title, v.severity || 'medium', v.cvss_score || null, v.affected_component || null, v.discovered_date || null, v.discovered_by || null, v.status || 'open', v.remediation_plan || null, v.assigned_to || null, v.target_remediation_date || null, v.actual_remediation_date || null, v.notes || null, now(), v.id);
  } else {
    dbi.prepare(`INSERT INTO vulnerabilities (id, company_id, cve_id, title, severity, cvss_score, affected_component, discovered_date, discovered_by, status, remediation_plan, assigned_to, target_remediation_date, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, v.company_id, v.cve_id || null, v.title, v.severity || 'medium', v.cvss_score || null, v.affected_component || null, v.discovered_date || today(), v.discovered_by || null, v.status || 'open', v.remediation_plan || null, v.assigned_to || null, v.target_remediation_date || null, v.notes || null, now(), now());
  }
  return { id, ...v };
}

export function listVulnerabilities(companyId: string, opts?: { status?: string; severity?: string }): any[] {
  const dbi = db.getDb();
  const params: any[] = [companyId];
  let where = 'company_id = ?';
  if (opts?.status) { where += ' AND status = ?'; params.push(opts.status); }
  if (opts?.severity) { where += ' AND severity = ?'; params.push(opts.severity); }
  return dbi.prepare(`SELECT * FROM vulnerabilities WHERE ${where} ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END, target_remediation_date ASC NULLS LAST`).all(...params) as any[];
}

export function markVulnerabilityRemediated(id: string): boolean {
  const r = db.getDb().prepare(`UPDATE vulnerabilities SET status = 'remediated', actual_remediation_date = ?, updated_at = ? WHERE id = ?`).run(today(), now(), id);
  return r.changes > 0;
}
