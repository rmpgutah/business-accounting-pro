// src/main/services/admin-features.ts
//
// Batch 1 admin/settings features. Combined into one file because
// they share the same schema migration block and most are small.
//
// Features:
//   1-3. Custom fields (clients/vendors/invoices/expenses/employees/projects)
//   4.   Role permissions matrix
//   5.   Two-factor auth (TOTP)
//   6.   Session timeout config
//   7.   Auto-backup schedule
//   8.   Theme customization
//   9.   Multi-fiscal-year support
//   10.  Activity feed (recent changes)
//   11.  Audit log viewer
//   12.  Notification preferences
//   13.  Currency settings
//   14.  Password complexity policy
//   15.  User invitation flow

import * as db from '../database';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';

// ── F1-F3: Custom Fields ──────────────────────────────────────

export type CustomFieldEntityType = 'client' | 'vendor' | 'invoice' | 'expense' | 'employee' | 'project';
export type CustomFieldType = 'text' | 'number' | 'date' | 'boolean' | 'select' | 'multiselect';

export interface CustomFieldDefinition {
  id: string;
  company_id: string;
  entity_type: CustomFieldEntityType;
  field_key: string;
  field_label: string;
  field_type: CustomFieldType;
  options_json: string;          // JSON array of strings for select/multiselect
  required: number;
  display_order: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export function listCustomFields(companyId: string, entityType?: CustomFieldEntityType): CustomFieldDefinition[] {
  const dbi = db.getDb();
  const sql = entityType
    ? `SELECT * FROM custom_field_definitions WHERE company_id = ? AND entity_type = ? AND is_active = 1 ORDER BY display_order, field_label`
    : `SELECT * FROM custom_field_definitions WHERE company_id = ? AND is_active = 1 ORDER BY entity_type, display_order`;
  const params = entityType ? [companyId, entityType] : [companyId];
  return dbi.prepare(sql).all(...params) as CustomFieldDefinition[];
}

export function upsertCustomField(record: Partial<CustomFieldDefinition> & { company_id: string; entity_type: CustomFieldEntityType; field_key: string; field_label: string; field_type: CustomFieldType }): CustomFieldDefinition {
  const dbi = db.getDb();
  const id = record.id || uuid();
  const optionsJson = record.options_json || '[]';
  if (record.id) {
    dbi.prepare(`
      UPDATE custom_field_definitions
      SET field_label = ?, field_type = ?, options_json = ?, required = ?, display_order = ?, is_active = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(record.field_label, record.field_type, optionsJson, record.required ?? 0, record.display_order ?? 0, record.is_active ?? 1, id);
  } else {
    dbi.prepare(`
      INSERT INTO custom_field_definitions (id, company_id, entity_type, field_key, field_label, field_type, options_json, required, display_order, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, record.company_id, record.entity_type, record.field_key, record.field_label, record.field_type, optionsJson, record.required ?? 0, record.display_order ?? 0, record.is_active ?? 1);
  }
  return dbi.prepare('SELECT * FROM custom_field_definitions WHERE id = ?').get(id) as CustomFieldDefinition;
}

export function deleteCustomField(id: string): boolean {
  const dbi = db.getDb();
  // Soft-delete by toggling is_active = 0 (preserves any custom_fields JSON in entity records)
  const r = dbi.prepare(`UPDATE custom_field_definitions SET is_active = 0, updated_at = datetime('now') WHERE id = ?`).run(id);
  return r.changes > 0;
}

// ── F4: Role permissions matrix ────────────────────────────────

export const DEFAULT_PERMISSIONS = {
  invoicing: { view: true, create: true, edit: true, delete: false, send: true },
  expenses: { view: true, create: true, edit: true, delete: false, approve: false },
  payroll: { view: false, create: false, edit: false, delete: false, run: false },
  banking: { view: true, create: true, edit: true, delete: false, reconcile: false },
  reports: { view: true, export: true, schedule: false },
  settings: { view: false, edit: false },
  admin: { manage_users: false, view_audit_log: false, manage_backups: false },
} as const;

export const ROLE_TEMPLATES = {
  admin: { /* all true */ },
  accountant: { invoicing: { view: true, create: true, edit: true, delete: false, send: true }, expenses: { view: true, create: true, edit: true, delete: false, approve: true }, payroll: { view: true, create: true, edit: true, delete: false, run: true }, banking: { view: true, create: true, edit: true, delete: false, reconcile: true }, reports: { view: true, export: true, schedule: true }, settings: { view: true, edit: false }, admin: { manage_users: false, view_audit_log: true, manage_backups: false } },
  staff: { invoicing: { view: true, create: true, edit: false, delete: false, send: false }, expenses: { view: true, create: true, edit: true, delete: false, approve: false }, payroll: { view: false, create: false, edit: false, delete: false, run: false }, banking: { view: false, create: false, edit: false, delete: false, reconcile: false }, reports: { view: true, export: false, schedule: false }, settings: { view: false, edit: false }, admin: { manage_users: false, view_audit_log: false, manage_backups: false } },
  read_only: { invoicing: { view: true, create: false, edit: false, delete: false, send: false }, expenses: { view: true, create: false, edit: false, delete: false, approve: false }, payroll: { view: false, create: false, edit: false, delete: false, run: false }, banking: { view: true, create: false, edit: false, delete: false, reconcile: false }, reports: { view: true, export: false, schedule: false }, settings: { view: false, edit: false }, admin: { manage_users: false, view_audit_log: false, manage_backups: false } },
};

export function getUserPermissions(userId: string): Record<string, any> {
  const dbi = db.getDb();
  const u = dbi.prepare('SELECT role, permissions_json FROM users WHERE id = ?').get(userId) as any;
  if (!u) return DEFAULT_PERMISSIONS;
  if (u.permissions_json && u.permissions_json !== '{}') {
    try { return JSON.parse(u.permissions_json); } catch { /* fallthrough */ }
  }
  return (ROLE_TEMPLATES as any)[u.role] || DEFAULT_PERMISSIONS;
}

export function setUserPermissions(userId: string, permissions: Record<string, any>): boolean {
  const dbi = db.getDb();
  const r = dbi.prepare('UPDATE users SET permissions_json = ? WHERE id = ?').run(JSON.stringify(permissions), userId);
  return r.changes > 0;
}

export function setUserRole(userId: string, role: keyof typeof ROLE_TEMPLATES): boolean {
  const dbi = db.getDb();
  const r = dbi.prepare('UPDATE users SET role = ?, permissions_json = ? WHERE id = ?').run(role, JSON.stringify(ROLE_TEMPLATES[role] || {}), userId);
  return r.changes > 0;
}

// ── F5: TOTP 2FA ───────────────────────────────────────────────

/**
 * Generate a TOTP secret (base32). Real implementation would use a
 * library like otplib; we generate a random secret and store it.
 * The frontend pairs it with a QR code (otpauth:// URL) for scanning.
 */
export function generateTotpSecret(userId: string, accountName: string, issuer: string = 'Business Accounting Pro'): { secret: string; otpauth_url: string; backup_codes: string[] } {
  const dbi = db.getDb();
  const secretBytes = crypto.randomBytes(20);
  const base32 = bytesToBase32(secretBytes);

  // Generate 8 backup codes (8 chars each, alphanumeric)
  const backupCodes = Array.from({ length: 8 }, () => {
    return crypto.randomBytes(5).toString('base64').replace(/[+/=]/g, '').slice(0, 8).toUpperCase();
  });

  const otpauthUrl = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}?secret=${base32}&issuer=${encodeURIComponent(issuer)}&period=30&digits=6&algorithm=SHA1`;

  // Store but don't enable until user confirms with a valid TOTP code
  dbi.prepare(`UPDATE users SET totp_secret = ?, totp_enabled = 0, totp_backup_codes = ? WHERE id = ?`).run(base32, JSON.stringify(backupCodes), userId);

  return { secret: base32, otpauth_url: otpauthUrl, backup_codes: backupCodes };
}

export function enableTotp(userId: string): boolean {
  const dbi = db.getDb();
  return dbi.prepare(`UPDATE users SET totp_enabled = 1 WHERE id = ? AND totp_secret IS NOT NULL`).run(userId).changes > 0;
}

export function disableTotp(userId: string): boolean {
  const dbi = db.getDb();
  return dbi.prepare(`UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_backup_codes = '[]' WHERE id = ?`).run(userId).changes > 0;
}

function bytesToBase32(bytes: Buffer): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0, output = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

// ── F10-F11: Activity Feed + Audit Log Viewer ─────────────────

export interface ActivityFeedEntry {
  id: string;
  company_id: string;
  entity_type: string;
  entity_id: string;
  action: 'create' | 'update' | 'delete';
  changes: string;
  performed_by: string;
  timestamp: string;
  // Hydrated fields for the feed view
  entity_label: string;       // e.g., "Invoice #INV-1234"
  actor_name: string;
}

export function getActivityFeed(companyId: string, opts?: { limit?: number; entity_type?: string; performed_by?: string; since?: string }): ActivityFeedEntry[] {
  const dbi = db.getDb();
  const limit = Math.min(500, opts?.limit || 100);
  const params: any[] = [companyId];
  let sql = `SELECT * FROM audit_log WHERE company_id = ?`;
  if (opts?.entity_type) { sql += ' AND entity_type = ?'; params.push(opts.entity_type); }
  if (opts?.performed_by) { sql += ' AND performed_by = ?'; params.push(opts.performed_by); }
  if (opts?.since) { sql += ' AND timestamp >= ?'; params.push(opts.since); }
  sql += ` ORDER BY timestamp DESC LIMIT ?`;
  params.push(limit);

  const rows = dbi.prepare(sql).all(...params) as any[];

  // Hydrate entity labels (best-effort)
  return rows.map((r): ActivityFeedEntry => {
    let label = `${r.entity_type} ${String(r.entity_id).slice(0, 8)}`;
    try {
      const entity = dbi.prepare(`SELECT * FROM ${r.entity_type} WHERE id = ?`).get(r.entity_id) as any;
      if (entity) {
        label = entity.name || entity.number || entity.invoice_number || entity.title || label;
      }
    } catch { /* unknown entity table */ }
    let actorName = r.performed_by;
    try {
      const user = dbi.prepare('SELECT name, email FROM users WHERE id = ?').get(r.performed_by) as any;
      if (user) actorName = user.name || user.email || r.performed_by;
    } catch { /* */ }
    return { ...r, entity_label: label, actor_name: actorName };
  });
}

// ── F12: Notification Preferences ──────────────────────────────

export const NOTIFICATION_TYPES = [
  'invoice.sent', 'invoice.paid', 'invoice.overdue',
  'expense.approved', 'expense.rejected', 'expense.over_budget',
  'payroll.run_completed', 'payroll.tax_due',
  'reconciliation.completed', 'reconciliation.discrepancy',
  'backup.failed', 'backup.completed',
  'compliance.form_expiring', 'compliance.form_missing',
  'user.invited', 'user.password_expiring',
] as const;

export type NotificationType = typeof NOTIFICATION_TYPES[number];

export interface NotificationPreference {
  notification_type: NotificationType;
  channel_email: boolean;
  channel_in_app: boolean;
  channel_desktop: boolean;
  quiet_hours_start?: string;
  quiet_hours_end?: string;
}

export function getNotificationPreferences(userId: string, companyId: string): Record<string, NotificationPreference> {
  const dbi = db.getDb();
  const rows = dbi.prepare(`SELECT * FROM notification_preferences WHERE user_id = ? AND company_id = ?`).all(userId, companyId) as any[];
  const map: Record<string, NotificationPreference> = {};
  for (const nt of NOTIFICATION_TYPES) {
    const existing = rows.find((r) => r.notification_type === nt);
    map[nt] = existing
      ? { notification_type: nt, channel_email: !!existing.channel_email, channel_in_app: !!existing.channel_in_app, channel_desktop: !!existing.channel_desktop, quiet_hours_start: existing.quiet_hours_start, quiet_hours_end: existing.quiet_hours_end }
      : { notification_type: nt, channel_email: true, channel_in_app: true, channel_desktop: false };
  }
  return map;
}

export function setNotificationPreference(userId: string, companyId: string, pref: NotificationPreference): boolean {
  const dbi = db.getDb();
  const id = uuid();
  dbi.prepare(`
    INSERT INTO notification_preferences (id, user_id, company_id, notification_type, channel_email, channel_in_app, channel_desktop, quiet_hours_start, quiet_hours_end)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, company_id, notification_type) DO UPDATE SET
      channel_email = excluded.channel_email,
      channel_in_app = excluded.channel_in_app,
      channel_desktop = excluded.channel_desktop,
      quiet_hours_start = excluded.quiet_hours_start,
      quiet_hours_end = excluded.quiet_hours_end,
      updated_at = datetime('now')
  `).run(id, userId, companyId, pref.notification_type, pref.channel_email ? 1 : 0, pref.channel_in_app ? 1 : 0, pref.channel_desktop ? 1 : 0, pref.quiet_hours_start || null, pref.quiet_hours_end || null);
  return true;
}

// ── F15: User Invitations ──────────────────────────────────────

export interface UserInvitation {
  id: string;
  company_id: string;
  email: string;
  role: string;
  invited_by: string;
  invitation_token: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by_user_id: string | null;
  revoked_at: string | null;
}

export function createInvitation(companyId: string, email: string, role: string, invitedBy: string, expiresInDays: number = 7): UserInvitation {
  const dbi = db.getDb();
  const id = uuid();
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date();
  expires.setDate(expires.getDate() + expiresInDays);
  const expiresAt = expires.toISOString();

  dbi.prepare(`
    INSERT INTO user_invitations (id, company_id, email, role, invited_by, invitation_token, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, companyId, email.toLowerCase(), role, invitedBy, token, expiresAt);

  return dbi.prepare('SELECT * FROM user_invitations WHERE id = ?').get(id) as UserInvitation;
}

export function listInvitations(companyId: string, includeExpiredRevoked: boolean = false): UserInvitation[] {
  const dbi = db.getDb();
  if (includeExpiredRevoked) {
    return dbi.prepare(`SELECT * FROM user_invitations WHERE company_id = ? ORDER BY created_at DESC`).all(companyId) as UserInvitation[];
  }
  return dbi.prepare(`
    SELECT * FROM user_invitations
    WHERE company_id = ?
      AND accepted_at IS NULL
      AND revoked_at IS NULL
      AND expires_at > datetime('now')
    ORDER BY created_at DESC
  `).all(companyId) as UserInvitation[];
}

export function revokeInvitation(id: string): boolean {
  const dbi = db.getDb();
  return dbi.prepare(`UPDATE user_invitations SET revoked_at = datetime('now') WHERE id = ?`).run(id).changes > 0;
}

export function acceptInvitation(token: string, userId: string): boolean {
  const dbi = db.getDb();
  return dbi.prepare(`
    UPDATE user_invitations
    SET accepted_at = datetime('now'), accepted_by_user_id = ?
    WHERE invitation_token = ?
      AND accepted_at IS NULL
      AND revoked_at IS NULL
      AND expires_at > datetime('now')
  `).run(userId, token).changes > 0;
}

// ── Password Complexity Validator (F14) ────────────────────────

export interface PasswordPolicy {
  min_length: number;
  require_special: boolean;
  require_number: boolean;
  require_mixed_case: boolean;
  rotation_days: number;
}

export function getPasswordPolicy(companyId: string): PasswordPolicy {
  const dbi = db.getDb();
  const c = dbi.prepare('SELECT password_min_length, password_require_special, password_require_number, password_require_mixed_case, password_rotation_days FROM companies WHERE id = ?').get(companyId) as any;
  return {
    min_length: c?.password_min_length ?? 12,
    require_special: !!c?.password_require_special,
    require_number: !!c?.password_require_number,
    require_mixed_case: !!c?.password_require_mixed_case,
    rotation_days: c?.password_rotation_days ?? 0,
  };
}

export function validatePassword(password: string, policy: PasswordPolicy): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (password.length < policy.min_length) errors.push(`Password must be at least ${policy.min_length} characters.`);
  if (policy.require_special && !/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) errors.push('Password must contain at least one special character.');
  if (policy.require_number && !/\d/.test(password)) errors.push('Password must contain at least one number.');
  if (policy.require_mixed_case && (!/[A-Z]/.test(password) || !/[a-z]/.test(password))) errors.push('Password must contain both uppercase and lowercase letters.');
  return { valid: errors.length === 0, errors };
}

// ── Fiscal Year Helpers (F9) ──────────────────────────────────

export function getFiscalYearRange(companyId: string, calendarYear: number): { start: string; end: string } {
  const dbi = db.getDb();
  const c = dbi.prepare('SELECT fiscal_year_start_month, fiscal_year_start_day FROM companies WHERE id = ?').get(companyId) as any;
  const month = c?.fiscal_year_start_month || 1;
  const day = c?.fiscal_year_start_day || 1;
  const pad = (n: number) => String(n).padStart(2, '0');
  // If fiscal year starts in Jan, calendar year = fiscal year.
  // Otherwise fiscal year N runs from Month/Day of (N-1) to Month/Day - 1 of N.
  if (month === 1 && day === 1) {
    return { start: `${calendarYear}-01-01`, end: `${calendarYear}-12-31` };
  }
  const start = `${calendarYear - 1}-${pad(month)}-${pad(day)}`;
  // End = one day before next year's start
  const endDate = new Date(`${calendarYear}-${pad(month)}-${pad(day)}T00:00:00`);
  endDate.setDate(endDate.getDate() - 1);
  return { start, end: endDate.toISOString().slice(0, 10) };
}
