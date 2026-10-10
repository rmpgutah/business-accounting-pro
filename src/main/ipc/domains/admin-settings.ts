import type { IpcMain } from 'electron';
import { v4 as uuid } from 'uuid';
import * as db from '../../database';
import crypto from 'crypto';
import {
  runNotificationChecks,
  getNotificationPreferences,
  updateNotificationPreferences,
} from '../../services/notification-engine';
import type { IpcDeps } from '../core/types';
import { shell } from 'electron';

// ── Helpers for tag rules + custom fields ──

function bucketCustomFieldValue(
  fieldType: string,
  value: any,
): {
  value_text: string | null;
  value_number: number | null;
  value_date: string | null;
  value_json: string | null;
} {
  const out = {
    value_text: null as string | null,
    value_number: null as number | null,
    value_date: null as string | null,
    value_json: null as string | null,
  };
  if (value === undefined || value === null || value === '') return out;
  switch (fieldType) {
    case 'number':
    case 'currency':
      out.value_number = Number(value);
      break;
    case 'date':
    case 'datetime':
      out.value_date = String(value);
      break;
    case 'boolean':
      out.value_number = value ? 1 : 0;
      break;
    case 'multi-select':
    case 'lookup':
      out.value_json = typeof value === 'string' ? value : JSON.stringify(value);
      break;
    default:
      out.value_text = String(value);
  }
  return out;
}

export function registerAdminSettingsIpc(ipcMain: IpcMain, deps: IpcDeps): void {
  const {
    scheduleAutoBackup,
    getLastLoginEmail,
    localToday,
    ensureDefaultEmailTemplates,
    resolveTemplateTokens,
    buildTemplateContext,
  } = deps;

  // ─── A7: Line-item snippets (reusable templates) ──────
  ipcMain.handle('snippets:list', (_event, opts?: { category?: string }) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return [];
      const sql =
        'SELECT * FROM line_item_snippets WHERE company_id = ? ' +
        (opts?.category ? 'AND category = ? ' : '') +
        'ORDER BY use_count DESC, name ASC LIMIT 200';
      const params: any[] = [cid];
      if (opts?.category) params.push(opts.category);
      return db
        .getDb()
        .prepare(sql)
        .all(...params);
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  ipcMain.handle('snippets:save', (_event, payload: any) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No active company' };
      if (!payload?.name?.trim()) return { error: 'Name required' };
      const data = { ...payload, company_id: cid };
      if (payload.id) {
        db.update('line_item_snippets', payload.id, data);
        scheduleAutoBackup();
        return db.getById('line_item_snippets', payload.id);
      }
      const created = db.create('line_item_snippets', data);
      scheduleAutoBackup();
      return created;
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  ipcMain.handle('snippets:delete', (_event, { id }: { id: string }) => {
    try {
      db.removeHard('line_item_snippets', id);
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  // Increments use_count + sets last_used_at when a snippet is
  // dropped onto a form. Called by the renderer's snippet picker.
  ipcMain.handle('snippets:track-use', (_event, { id }: { id: string }) => {
    try {
      db.getDb()
        .prepare(
          "UPDATE line_item_snippets SET use_count = use_count + 1, last_used_at = datetime('now') WHERE id = ?",
        )
        .run(id);
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  // ─── Batch 1: Admin features (15) ────────────────────────────
  // Custom fields
  ipcMain.handle('admin:custom-fields:list', (_event, { entity_type }: any) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return [];
      const { listCustomFields } = require('../../services/admin-features');
      return listCustomFields(cid, entity_type);
    } catch (e: any) {
      return { error: e?.message };
    }
  });
  ipcMain.handle('admin:custom-fields:upsert', (_event, record: any) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No active company' };
      const { upsertCustomField } = require('../../services/admin-features');
      const result = upsertCustomField({ ...record, company_id: cid });
      scheduleAutoBackup();
      return result;
    } catch (e: any) {
      return { error: e?.message };
    }
  });
  ipcMain.handle('admin:custom-fields:delete', (_event, { id }: any) => {
    try {
      const { deleteCustomField } = require('../../services/admin-features');
      const result = { ok: deleteCustomField(id) };
      scheduleAutoBackup();
      return result;
    } catch (e: any) {
      return { error: e?.message };
    }
  });
  // Role permissions
  ipcMain.handle('admin:user-permissions:get', (_event, { user_id }: any) => {
    try {
      const { getUserPermissions } = require('../../services/admin-features');
      return getUserPermissions(user_id);
    } catch (e: any) {
      return { error: e?.message };
    }
  });
  ipcMain.handle('admin:user-permissions:set', (_event, { user_id, permissions }: any) => {
    try {
      const { setUserPermissions } = require('../../services/admin-features');
      const r = { ok: setUserPermissions(user_id, permissions) };
      scheduleAutoBackup();
      return r;
    } catch (e: any) {
      return { error: e?.message };
    }
  });
  ipcMain.handle('admin:user-role:set', (_event, { user_id, role }: any) => {
    try {
      const { setUserRole } = require('../../services/admin-features');
      const r = { ok: setUserRole(user_id, role) };
      scheduleAutoBackup();
      return r;
    } catch (e: any) {
      return { error: e?.message };
    }
  });
  // TOTP 2FA
  ipcMain.handle('admin:totp:generate', (_event, { user_id, account_name }: any) => {
    try {
      const { generateTotpSecret } = require('../../services/admin-features');
      return generateTotpSecret(user_id, account_name);
    } catch (e: any) {
      return { error: e?.message };
    }
  });
  ipcMain.handle('admin:totp:enable', (_event, { user_id }: any) => {
    try {
      const { enableTotp } = require('../../services/admin-features');
      const r = { ok: enableTotp(user_id) };
      scheduleAutoBackup();
      return r;
    } catch (e: any) {
      return { error: e?.message };
    }
  });
  ipcMain.handle('admin:totp:disable', (_event, { user_id }: any) => {
    try {
      const { disableTotp } = require('../../services/admin-features');
      const r = { ok: disableTotp(user_id) };
      scheduleAutoBackup();
      return r;
    } catch (e: any) {
      return { error: e?.message };
    }
  });
  // Activity feed + audit
  ipcMain.handle('admin:activity-feed', (_event, opts: any) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return [];
      const { getActivityFeed } = require('../../services/admin-features');
      return getActivityFeed(cid, opts);
    } catch (e: any) {
      return { error: e?.message };
    }
  });
  // Notification preferences
  ipcMain.handle('admin:notifications:list', (_event, { user_id }: any) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return {};
      const { getNotificationPreferences } = require('../../services/admin-features');
      return getNotificationPreferences(user_id, cid);
    } catch (e: any) {
      return { error: e?.message };
    }
  });
  ipcMain.handle('admin:notifications:set', (_event, { user_id, preference }: any) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { error: 'No active company' };
      const { setNotificationPreference } = require('../../services/admin-features');
      const r = { ok: setNotificationPreference(user_id, cid, preference) };
      scheduleAutoBackup();
      return r;
    } catch (e: any) {
      return { error: e?.message };
    }
  });
  // Password policy
  ipcMain.handle('admin:password-policy:get', () => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return null;
      const { getPasswordPolicy } = require('../../services/admin-features');
      return getPasswordPolicy(cid);
    } catch (e: any) {
      return { error: e?.message };
    }
  });
  ipcMain.handle('admin:password:validate', (_event, { password }: any) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return { valid: false, errors: ['No active company'] };
      const { getPasswordPolicy, validatePassword } = require('../../services/admin-features');
      return validatePassword(password, getPasswordPolicy(cid));
    } catch (e: any) {
      return { error: e?.message };
    }
  });
  // Fiscal year helpers
  ipcMain.handle('admin:fiscal-year:range', (_event, { calendar_year }: any) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return null;
      const { getFiscalYearRange } = require('../../services/admin-features');
      return getFiscalYearRange(cid, calendar_year);
    } catch (e: any) {
      return { error: e?.message };
    }
  });
  // ─── Notifications ───────────────────────────────────
  ipcMain.handle('notification:list', (_event, opts = {}) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return [];
    const filters: Record<string, any> = { company_id: companyId };
    if (opts.unread_only) filters.is_read = 0;
    return db.queryAll('notifications', filters, { field: 'created_at', dir: 'desc' }, 50);
  });
  ipcMain.handle('notification:mark-read', (_event, id) => {
    db.update('notifications', id, { is_read: 1 });
  });
  // Perf: bulk mark-all-read replaces an N+1 loop in renderer (notifications/index.tsx)
  ipcMain.handle('notification:mark-all-read', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return 0;
    const dbInstance = db.getDb();
    const result = dbInstance
      .prepare('UPDATE notifications SET is_read = 1 WHERE company_id = ? AND is_read = 0')
      .run(companyId);
    return result.changes;
  });
  // ─── Notification Engine ─────────────────────────────
  ipcMain.handle('notification:run-checks', () => {
    const companyId = db.getCurrentCompanyId();
    return runNotificationChecks(companyId || undefined);
  });
  ipcMain.handle('notification:clear-all', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return;
    const dbInstance = db.getDb();
    dbInstance
      .prepare('DELETE FROM notifications WHERE company_id = ? AND is_read = 1')
      .run(companyId);
  });
  ipcMain.handle('notification:dismiss', (_event, id: string) => {
    db.remove('notifications', id);
  });
  ipcMain.handle('notification:preferences', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return {};
    return getNotificationPreferences(companyId);
  });
  ipcMain.handle('notification:update-preferences', (_event, prefs: Record<string, boolean>) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return;
    updateNotificationPreferences(companyId, prefs);
  });
  // ═══ Period close + Reconciliation + Compliance (2026-04-23) ═══

  ipcMain.handle('compliance:account-audit', (_e, { companyId, accountId, limit = 200 }: any) => {
    try {
      const acctChanges = db
        .getDb()
        .prepare(
          `SELECT * FROM audit_log WHERE company_id = ? AND entity_type = 'accounts' AND entity_id = ? ORDER BY timestamp DESC LIMIT ?`,
        )
        .all(companyId, accountId, limit);
      const jeTouches = db
        .getDb()
        .prepare(
          `SELECT DISTINCT je.id, je.entry_number, je.date, je.description, je.is_posted, je.posted_by, je.approved_by, je.created_at
         FROM journal_entries je
         JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
         WHERE je.company_id = ? AND jel.account_id = ?
         ORDER BY je.created_at DESC LIMIT ?`,
        )
        .all(companyId, accountId, limit);
      return { account_changes: acctChanges, journal_touches: jeTouches };
    } catch (err: any) {
      return { error: err?.message, account_changes: [], journal_touches: [] };
    }
  });
  ipcMain.handle('compliance:validate-je', (_e, { companyId, journalEntryId, date }: any) => {
    try {
      const errors: string[] = [];
      const warnings: string[] = [];
      const locked = db
        .getDb()
        .prepare(
          `SELECT * FROM period_locks WHERE company_id = ? AND (unlocked_at IS NULL OR unlocked_at = '')
           AND ((period_start != '' AND period_end != '' AND ? >= period_start AND ? <= period_end)
                OR (locked_through_date != '' AND ? <= locked_through_date))
         LIMIT 1`,
        )
        .get(companyId, date, date, date);
      if (locked)
        errors.push(
          `Period is locked through ${(locked as any).period_end || (locked as any).locked_through_date}.`,
        );

      const lines = db
        .getDb()
        .prepare(
          `SELECT jel.*, a.name AS account_name, a.code, a.allow_direct_posting, a.attachment_required, a.attachment_threshold
         FROM journal_entry_lines jel
         JOIN accounts a ON a.id = jel.account_id
         WHERE jel.journal_entry_id = ?`,
        )
        .all(journalEntryId) as any[];

      for (const l of lines) {
        if (l.allow_direct_posting === 0) {
          errors.push(
            `Account ${l.code} ${l.account_name} does not allow direct posting (control account).`,
          );
        }
        const amt = Math.abs((l.debit || 0) - (l.credit || 0));
        if (l.attachment_required && amt >= (l.attachment_threshold || 0)) {
          let hasDoc = false;
          try {
            const doc = db
              .getDb()
              .prepare(
                `SELECT id FROM documents WHERE entity_type = 'journal_entry' AND entity_id = ? LIMIT 1`,
              )
              .get(journalEntryId);
            hasDoc = !!doc;
          } catch {
            /* documents table may not exist */
          }
          if (!hasDoc)
            errors.push(
              `Account ${l.code} ${l.account_name} requires an attachment for amounts ≥ $${l.attachment_threshold}.`,
            );
        }
      }
      return { ok: errors.length === 0, errors, warnings };
    } catch (err: any) {
      return { ok: true, errors: [], warnings: [err?.message] };
    }
  });
  ipcMain.handle('compliance:1099-report', (_e, { companyId, year }: any) => {
    try {
      const start = `${year}-01-01`;
      const end = `${year}-12-31`;
      return db
        .getDb()
        .prepare(
          `SELECT v.id AS vendor_id, v.name AS vendor_name, v.tax_id,
                a.id AS account_id, a.code, a.name AS account_name,
                SUM(COALESCE(jel.debit,0) - COALESCE(jel.credit,0)) AS amount
         FROM journal_entry_lines jel
         JOIN journal_entries je ON je.id = jel.journal_entry_id
         JOIN accounts a ON a.id = jel.account_id
         LEFT JOIN bills b ON b.id = je.source_id AND je.source_type = 'bill'
         LEFT JOIN vendors v ON v.id = b.vendor_id
         WHERE je.company_id = ? AND je.is_posted = 1
           AND date(je.date) >= date(?) AND date(je.date) <= date(?) -- DATE: Item #7 — date() wrap so timestamp values match and end-day is inclusive.
           AND a.is_1099_eligible = 1 AND v.id IS NOT NULL
         GROUP BY v.id, a.id
         HAVING amount >= 600
         ORDER BY v.name, a.code`,
        )
        .all(companyId, start, end);
    } catch {
      return [];
    }
  });
  ipcMain.handle('compliance:tax-line-export', (_e, { companyId, periodStart, periodEnd }: any) => {
    try {
      return db
        .getDb()
        .prepare(
          `SELECT a.tax_line, a.code, a.name, a.type,
                SUM(COALESCE(jel.debit,0)) AS total_debit,
                SUM(COALESCE(jel.credit,0)) AS total_credit,
                SUM(COALESCE(jel.debit,0) - COALESCE(jel.credit,0)) AS net
         FROM accounts a
         LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
         LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
           AND je.company_id = ? AND je.is_posted = 1 AND date(je.date) >= date(?) AND date(je.date) <= date(?) -- DATE: Item #7 — date() wrap so timestamp values match and end-day is inclusive.
         WHERE a.company_id = ? AND a.tax_line != ''
         GROUP BY a.id ORDER BY a.tax_line, a.code`,
        )
        .all(companyId, periodStart, periodEnd, companyId);
    } catch {
      return [];
    }
  });
  // ═══ Chart of Accounts — Round 2 (2026-04-23) ═══
  // F2: Permission check (callable from JE handler)
  ipcMain.handle(
    'compliance:check-account-perm',
    (
      _e,
      {
        companyId,
        accountId,
        role,
        action,
      }: { companyId: string; accountId: string; role: string; action: 'post' | 'view' },
    ) => {
      try {
        const row = db
          .getDb()
          .prepare(
            `SELECT can_post, can_view FROM account_permissions WHERE company_id = ? AND account_id = ? AND role = ?`,
          )
          .get(companyId, accountId, role || '') as any;
        // No row = unrestricted (default allow)
        if (!row) return { allowed: true };
        const allowed = action === 'post' ? !!row.can_post : !!row.can_view;
        return {
          allowed,
          reason: allowed ? '' : `Role "${role}" lacks ${action} permission for this account`,
        };
      } catch (err: any) {
        return { allowed: true, error: err?.message };
      }
    },
  );
  ipcMain.handle('compliance:sod-report', (_e, { companyId, periodStart, periodEnd }: any) => {
    try {
      return db
        .getDb()
        .prepare(
          `SELECT id, entry_number, date, description, approved_by, posted_by
         FROM journal_entries
         WHERE company_id = ? AND date >= ? AND date <= ? AND is_posted = 1
           AND approved_by != '' AND posted_by != '' AND approved_by = posted_by
         ORDER BY date DESC`,
        )
        .all(companyId, periodStart, periodEnd);
    } catch {
      return [];
    }
  });
  // ═══ Round 2: Period Close + Reconciliation + Compliance (2026-04-23) ═══

  // 21 & 22. SOX controls + tests
  ipcMain.handle('sox:controls-list', (_e, { companyId }: any) => {
    try {
      return db
        .getDb()
        .prepare(
          `SELECT c.*,
         (SELECT result FROM sox_control_tests WHERE control_id = c.id ORDER BY tested_at DESC LIMIT 1) AS last_result,
         (SELECT tested_at FROM sox_control_tests WHERE control_id = c.id ORDER BY tested_at DESC LIMIT 1) AS last_tested_at,
         (SELECT COUNT(*) FROM sox_control_tests WHERE control_id = c.id) AS test_count
         FROM sox_controls c WHERE c.company_id = ? ORDER BY c.code`,
        )
        .all(companyId);
    } catch {
      return [];
    }
  });
  ipcMain.handle('sox:control-save', (_e, data: any) => {
    try {
      const id = data.id || uuid();
      const existing = data.id
        ? db.getDb().prepare(`SELECT id FROM sox_controls WHERE id = ?`).get(id)
        : null;
      if (existing) {
        db.getDb()
          .prepare(
            `UPDATE sox_controls SET code=?, description=?, owner=?, frequency=?, risk=? WHERE id = ?`,
          )
          .run(
            data.code || '',
            data.description || '',
            data.owner || '',
            data.frequency || '',
            data.risk || '',
            id,
          );
      } else {
        db.getDb()
          .prepare(
            `INSERT INTO sox_controls (id, company_id, code, description, owner, frequency, risk)
           VALUES (?,?,?,?,?,?,?)`,
          )
          .run(
            id,
            data.companyId,
            data.code || '',
            data.description || '',
            data.owner || '',
            data.frequency || '',
            data.risk || '',
          );
      }
      scheduleAutoBackup();
      return { id };
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  ipcMain.handle('sox:control-delete', (_e, { id }: any) => {
    try {
      db.getDb().prepare(`DELETE FROM sox_controls WHERE id = ?`).run(id);
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  ipcMain.handle('sox:tests-list', (_e, { controlId }: any) => {
    try {
      return db
        .getDb()
        .prepare(`SELECT * FROM sox_control_tests WHERE control_id = ? ORDER BY tested_at DESC`)
        .all(controlId);
    } catch {
      return [];
    }
  });
  ipcMain.handle('sox:test-save', (_e, data: any) => {
    try {
      const id = uuid();
      db.getDb()
        .prepare(
          `INSERT INTO sox_control_tests (id, control_id, company_id, tested_by, tested_at, result, evidence, notes)
         VALUES (?,?,?,?,?,?,?,?)`,
        )
        .run(
          id,
          data.controlId,
          data.companyId,
          data.testedBy || '',
          data.testedAt || localToday(),
          data.result || 'pass',
          data.evidence || '',
          data.notes || '',
        );
      db.getDb()
        .prepare(`UPDATE sox_controls SET last_reviewed_at = datetime('now') WHERE id = ?`)
        .run(data.controlId);
      scheduleAutoBackup();
      return { id };
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  // 24. Audit-letter data
  ipcMain.handle('compliance:audit-letter-data', (_e, { companyId, asOfDate }: any) => {
    try {
      const company = db.getById('companies', companyId);
      const balances = db
        .getDb()
        .prepare(
          `SELECT a.code, a.name, a.type,
                SUM(COALESCE(jel.debit,0) - COALESCE(jel.credit,0)) AS balance
         FROM accounts a
         LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
         LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
           AND je.company_id = ? AND je.is_posted = 1 AND date(je.date) <= date(?) /* DATE: Item #7 — wrap for inclusive end-of-day */
         WHERE a.company_id = ? GROUP BY a.id ORDER BY a.code`,
        )
        .all(companyId, asOfDate, companyId);
      return { company, asOfDate, balances };
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  // 26. Hash chain verify (heals missing hashes; flags tampering)
  ipcMain.handle('compliance:hash-chain-verify', (_e, { companyId, limit = 1000 }: any) => {
    try {
      const rows = db
        .getDb()
        .prepare(
          `SELECT id, entity_type, entity_id, action, changes, performed_by, timestamp,
                COALESCE(prev_hash,'') AS prev_hash, COALESCE(row_hash,'') AS row_hash
         FROM audit_log WHERE company_id = ? ORDER BY timestamp ASC, id ASC LIMIT ?`,
        )
        .all(companyId, limit) as any[];
      let prev = '';
      const issues: any[] = [];
      let healed = 0;
      for (const r of rows) {
        const payload = JSON.stringify({
          id: r.id,
          entity_type: r.entity_type,
          entity_id: r.entity_id,
          action: r.action,
          changes: r.changes,
          performed_by: r.performed_by,
          timestamp: r.timestamp,
        });
        const expected = crypto
          .createHash('sha256')
          .update(prev + payload)
          .digest('hex');
        if (!r.row_hash || !r.prev_hash) {
          db.getDb()
            .prepare(`UPDATE audit_log SET prev_hash = ?, row_hash = ? WHERE id = ?`)
            .run(prev, expected, r.id);
          healed++;
        } else if (r.row_hash !== expected || r.prev_hash !== prev) {
          issues.push({ id: r.id, expected, actual: r.row_hash });
        }
        prev = expected;
      }
      return { ok: issues.length === 0, total: rows.length, issues, healed };
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  // 27/28/29. Approval rules + approval recording
  ipcMain.handle('compliance:approval-rules-get', () => {
    try {
      const get = (k: string) =>
        (db.getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(k) as any)?.value;
      return {
        twoFactorThreshold: Number(get('je_two_factor_threshold') || 0),
        commentThreshold: Number(get('je_comment_threshold') || 0),
        blockSelfApproval: get('je_block_self_approval') !== '0',
      };
    } catch {
      return { twoFactorThreshold: 0, commentThreshold: 0, blockSelfApproval: true };
    }
  });
  ipcMain.handle('compliance:approval-rules-save', (_e, data: any) => {
    try {
      const set = (k: string, v: string) => {
        const existing = db.getDb().prepare(`SELECT key FROM settings WHERE key = ?`).get(k);
        if (existing) db.getDb().prepare(`UPDATE settings SET value = ? WHERE key = ?`).run(v, k);
        else db.getDb().prepare(`INSERT INTO settings (key, value) VALUES (?,?)`).run(k, v);
      };
      set('je_two_factor_threshold', String(data.twoFactorThreshold || 0));
      set('je_comment_threshold', String(data.commentThreshold || 0));
      set('je_block_self_approval', data.blockSelfApproval ? '1' : '0');
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  ipcMain.handle('compliance:approve-je', (_e, { journalEntryId, approver, comment }: any) => {
    try {
      const je = db.getById('journal_entries', journalEntryId);
      if (!je) return { error: 'JE not found' };
      const lines = db
        .getDb()
        .prepare(
          `SELECT SUM(COALESCE(debit,0)) AS total FROM journal_entry_lines WHERE journal_entry_id = ?`,
        )
        .get(journalEntryId) as any;
      const total = lines?.total || 0;
      const get = (k: string) =>
        (db.getDb().prepare(`SELECT value FROM settings WHERE key = ?`).get(k) as any)?.value;
      const twoFactor = Number(get('je_two_factor_threshold') || 0);
      const commentTh = Number(get('je_comment_threshold') || 0);
      const blockSelf = get('je_block_self_approval') !== '0';

      if (blockSelf && (je.created_by === approver || je.posted_by === approver)) {
        return { error: 'Self-approval blocked: creator/poster cannot approve.' };
      }
      if (commentTh > 0 && total >= commentTh && !(comment || '').trim()) {
        return { error: `Comment required for JEs ≥ $${commentTh}.` };
      }

      const existingApprovals = db
        .getDb()
        .prepare(`SELECT DISTINCT approver FROM je_approvals WHERE journal_entry_id = ?`)
        .all(journalEntryId) as any[];
      if (existingApprovals.some((a: any) => a.approver === approver)) {
        return { error: 'You have already approved this entry.' };
      }
      db.getDb()
        .prepare(
          `INSERT INTO je_approvals (id, journal_entry_id, approver, comment) VALUES (?,?,?,?)`,
        )
        .run(uuid(), journalEntryId, approver || '', comment || '');

      const approvers = new Set(existingApprovals.map((a: any) => a.approver).concat([approver]));
      const needTwo = twoFactor > 0 && total >= twoFactor;
      const fullyApproved = !needTwo || approvers.size >= 2;

      if (fullyApproved) {
        db.getDb()
          .prepare(
            `UPDATE journal_entries SET approval_status = 'approved', approved_by = ? WHERE id = ?`,
          )
          .run(Array.from(approvers).join(','), journalEntryId);
      } else {
        db.getDb()
          .prepare(`UPDATE journal_entries SET approval_status = 'partially_approved' WHERE id = ?`)
          .run(journalEntryId);
      }
      db.logAudit(je.company_id, 'journal_entry', journalEntryId, 'approve', {
        approver,
        comment,
        total,
        fullyApproved,
        approverCount: approvers.size,
      });
      scheduleAutoBackup();
      return { ok: true, fullyApproved, approverCount: approvers.size };
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  ipcMain.handle('email-tmpl:list', (_e, { companyId }: any) => {
    try {
      ensureDefaultEmailTemplates(companyId);
      return db
        .getDb()
        .prepare(`SELECT * FROM email_templates WHERE company_id = ? ORDER BY label`)
        .all(companyId);
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  ipcMain.handle('email-tmpl:save', (_e, { id, data, changedBy }: any) => {
    try {
      if (id) {
        const prev = db.getById('email_templates', id);
        if (prev) {
          const lastVer = db
            .getDb()
            .prepare(`SELECT MAX(version) AS v FROM email_template_history WHERE template_id = ?`)
            .get(id) as any;
          const nextVersion = (lastVer?.v || 0) + 1;
          db.getDb()
            .prepare(
              `INSERT INTO email_template_history (id, template_id, version, snapshot_json, changed_by) VALUES (?,?,?,?,?)`,
            )
            .run(uuid(), id, nextVersion, JSON.stringify(prev), changedBy || '');
        }
        db.update('email_templates', id, data);
      } else {
        db.create('email_templates', data);
      }
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  ipcMain.handle('email-tmpl:history', (_e, { templateId }: any) => {
    try {
      return db
        .getDb()
        .prepare(`SELECT * FROM email_template_history WHERE template_id = ? ORDER BY version DESC`)
        .all(templateId);
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  ipcMain.handle('email-tmpl:rollback', (_e, { templateId, version, changedBy }: any) => {
    try {
      const snap = db
        .getDb()
        .prepare(`SELECT * FROM email_template_history WHERE template_id = ? AND version = ?`)
        .get(templateId, version) as any;
      if (!snap) return { error: 'Version not found' };
      const data = JSON.parse(snap.snapshot_json);
      const current = db.getById('email_templates', templateId);
      const lastVer = db
        .getDb()
        .prepare(`SELECT MAX(version) AS v FROM email_template_history WHERE template_id = ?`)
        .get(templateId) as any;
      db.getDb()
        .prepare(
          `INSERT INTO email_template_history (id, template_id, version, snapshot_json, changed_by) VALUES (?,?,?,?,?)`,
        )
        .run(
          uuid(),
          templateId,
          (lastVer?.v || 0) + 1,
          JSON.stringify(current),
          changedBy || 'rollback',
        );
      db.update('email_templates', templateId, {
        subject: data.subject,
        body: data.body,
        body_format: data.body_format,
        available_tokens_json: data.available_tokens_json,
        default_to: data.default_to,
        default_cc: data.default_cc,
        default_bcc: data.default_bcc,
        label: data.label,
      });
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  ipcMain.handle(
    'email-tmpl:resolve',
    (_e, { companyId, templateKey, entityType, entityId, sampleCtx }: any) => {
      try {
        ensureDefaultEmailTemplates(companyId);
        const tmpl = db
          .getDb()
          .prepare(`SELECT * FROM email_templates WHERE company_id = ? AND key = ?`)
          .get(companyId, templateKey) as any;
        if (!tmpl) return { error: 'Template not found' };
        const ctx = sampleCtx || buildTemplateContext(companyId, entityType, entityId);
        return {
          subject: resolveTemplateTokens(tmpl.subject || '', ctx),
          body: resolveTemplateTokens(tmpl.body || '', ctx),
          bodyFormat: tmpl.body_format,
          defaultTo: tmpl.default_to,
          defaultCc: tmpl.default_cc,
          defaultBcc: tmpl.default_bcc,
          ctx,
        };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );
  ipcMain.handle('email-tmpl:validate', (_e, { body, subject, availableTokens }: any) => {
    try {
      const allTokens: string[] = JSON.parse(availableTokens || '[]');
      const re = /\{\{\s*([\w_]+)\s*\}\}/g;
      const used = new Set<string>();
      const text = `${subject || ''}\n${body || ''}`;
      let m;
      while ((m = re.exec(text)) !== null) used.add(m[1]);
      const unknown = Array.from(used).filter((t) => !allTokens.includes(t));
      return { ok: unknown.length === 0, unknown, used: Array.from(used) };
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  // 30. Compliance dashboard
  ipcMain.handle('compliance:dashboard', (_e, { companyId }: any) => {
    try {
      const openControls =
        (
          db
            .getDb()
            .prepare(
              `SELECT COUNT(*) AS c FROM sox_controls WHERE company_id = ?
           AND id NOT IN (SELECT control_id FROM sox_control_tests WHERE company_id = ? AND result = 'pass')`,
            )
            .get(companyId, companyId) as any
        )?.c || 0;
      const lastClose = db
        .getDb()
        .prepare(
          `SELECT period_end, closed_at FROM period_close_log WHERE company_id = ? ORDER BY closed_at DESC LIMIT 1`,
        )
        .get(companyId) as any;
      const lastRecon = db
        .getDb()
        .prepare(
          `SELECT as_of_date FROM account_reconciliations WHERE company_id = ? ORDER BY as_of_date DESC LIMIT 1`,
        )
        .get(companyId) as any;
      const dueRecons = db
        .getDb()
        .prepare(
          `SELECT COUNT(*) AS c FROM recon_schedule WHERE company_id = ? AND next_due <= date('now')`,
        )
        .get(companyId) as any;
      const auditCount =
        (
          db
            .getDb()
            .prepare(`SELECT COUNT(*) AS c FROM audit_log WHERE company_id = ?`)
            .get(companyId) as any
        )?.c || 0;
      const today = new Date();
      const nextEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      const daysUntilNextClose = Math.max(
        0,
        Math.ceil((nextEnd.getTime() - today.getTime()) / 86400000),
      );
      return {
        openControls,
        lastCloseDate: lastClose?.period_end || null,
        lastReconDate: lastRecon?.as_of_date || null,
        dueRecons: dueRecons?.c || 0,
        auditEntries: auditCount,
        daysUntilNextClose,
      };
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  // ───────────────────────────────────────────────────────
  // Universal Tags + Custom Fields (2026-04-23)
  // ───────────────────────────────────────────────────────

  // ── Custom Fields ──
  ipcMain.handle(
    'customFields:list',
    (_e, { companyId, entityType }: { companyId: string; entityType?: string }) => {
      try {
        const sql = entityType
          ? `SELECT * FROM custom_field_definitions WHERE company_id = ? AND entity_type = ? AND deleted_at IS NULL ORDER BY sort_order, label`
          : `SELECT * FROM custom_field_definitions WHERE company_id = ? AND deleted_at IS NULL ORDER BY entity_type, sort_order, label`;
        return entityType
          ? db.getDb().prepare(sql).all(companyId, entityType)
          : db.getDb().prepare(sql).all(companyId);
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );
  ipcMain.handle('customFields:create', (_e, data: any) => {
    try {
      const r = db.create('custom_field_definitions', data);
      scheduleAutoBackup();
      return r;
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  ipcMain.handle('customFields:update', (_e, { id, data }: any) => {
    try {
      const r = db.update('custom_field_definitions', id, data);
      scheduleAutoBackup();
      return r;
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  ipcMain.handle('customFields:delete', (_e, { id }: any) => {
    try {
      db.getDb()
        .prepare(`UPDATE custom_field_definitions SET deleted_at = datetime('now') WHERE id = ?`)
        .run(id);
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  ipcMain.handle(
    'customFields:get-values',
    (
      _e,
      {
        companyId,
        entityType,
        entityId,
      }: { companyId: string; entityType: string; entityId: string },
    ) => {
      try {
        return db
          .getDb()
          .prepare(
            `SELECT * FROM custom_field_values WHERE company_id = ? AND entity_type = ? AND entity_id = ?`,
          )
          .all(companyId, entityType, entityId);
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );
  ipcMain.handle(
    'customFields:set-values',
    (
      _e,
      {
        companyId,
        entityType,
        entityId,
        values,
      }: { companyId: string; entityType: string; entityId: string; values: Record<string, any> },
    ) => {
      try {
        const d = db.getDb();
        const defs = d
          .prepare(
            `SELECT * FROM custom_field_definitions WHERE company_id = ? AND entity_type = ? AND deleted_at IS NULL`,
          )
          .all(companyId, entityType) as any[];
        const errors: string[] = [];
        for (const def of defs) {
          if (def.required) {
            const v = values?.[def.key];
            if (v === undefined || v === null || v === '') errors.push(`${def.label} is required`);
          }
          let validation: any = {};
          try {
            validation = JSON.parse(def.validation_json || '{}');
          } catch {
            /* */
          }
          const v = values?.[def.key];
          if (v !== undefined && v !== null && v !== '') {
            if (validation.regex) {
              try {
                if (!new RegExp(validation.regex).test(String(v)))
                  errors.push(`${def.label} format invalid`);
              } catch {
                /* */
              }
            }
            if (typeof validation.min === 'number' && Number(v) < validation.min)
              errors.push(`${def.label} below min ${validation.min}`);
            if (typeof validation.max === 'number' && Number(v) > validation.max)
              errors.push(`${def.label} above max ${validation.max}`);
          }
        }
        if (errors.length) return { error: errors.join('; ') };

        const tx = d.transaction(() => {
          for (const def of defs) {
            if (!(def.key in (values || {}))) continue;
            const v = values[def.key];
            const existing = d
              .prepare(
                `SELECT id FROM custom_field_values WHERE company_id = ? AND entity_type = ? AND entity_id = ? AND field_key = ?`,
              )
              .get(companyId, entityType, entityId, def.key) as any;
            const cols = bucketCustomFieldValue(def.field_type, v);
            if (existing) {
              d.prepare(
                `UPDATE custom_field_values SET value_text = ?, value_number = ?, value_date = ?, value_json = ?, updated_at = datetime('now') WHERE id = ?`,
              ).run(
                cols.value_text,
                cols.value_number,
                cols.value_date,
                cols.value_json,
                existing.id,
              );
            } else {
              d.prepare(
                `INSERT INTO custom_field_values (id, company_id, entity_type, entity_id, field_key, value_text, value_number, value_date, value_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              ).run(
                uuid(),
                companyId,
                entityType,
                entityId,
                def.key,
                cols.value_text,
                cols.value_number,
                cols.value_date,
                cols.value_json,
              );
            }
          }
        });
        tx();
        scheduleAutoBackup();
        return { ok: true };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );
  ipcMain.handle(
    'customFields:usage-stats',
    (_e, { companyId, entityType }: { companyId: string; entityType: string }) => {
      try {
        const d = db.getDb();
        const defs = d
          .prepare(
            `SELECT * FROM custom_field_definitions WHERE company_id = ? AND entity_type = ? AND deleted_at IS NULL`,
          )
          .all(companyId, entityType) as any[];
        const tableMap: Record<string, string> = {
          invoice: 'invoices',
          expense: 'expenses',
          client: 'clients',
          vendor: 'vendors',
          project: 'projects',
          debt: 'debts',
          bill: 'bills',
          purchase_order: 'purchase_orders',
          employee: 'employees',
          account: 'accounts',
          journal_entry: 'journal_entries',
          asset: 'fixed_assets',
          inventory_item: 'inventory_items',
        };
        const table = tableMap[entityType];
        let total = 0;
        try {
          if (table) {
            total =
              (
                d
                  .prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE company_id = ?`)
                  .get(companyId) as any
              )?.c || 0;
          }
        } catch {
          /* table may not exist */
        }
        return defs.map((def: any) => {
          const filled =
            (
              d
                .prepare(
                  `SELECT COUNT(DISTINCT entity_id) AS c FROM custom_field_values WHERE company_id = ? AND entity_type = ? AND field_key = ?
           AND (value_text IS NOT NULL OR value_number IS NOT NULL OR value_date IS NOT NULL OR value_json IS NOT NULL)`,
                )
                .get(companyId, entityType, def.key) as any
            )?.c || 0;
          return {
            field_key: def.key,
            label: def.label,
            field_type: def.field_type,
            filled,
            total,
            fill_rate: total > 0 ? filled / total : 0,
          };
        });
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );
  ipcMain.handle(
    'customFields:bulk-fill',
    (
      _e,
      {
        companyId,
        entityType,
        fieldKey,
        value,
      }: { companyId: string; entityType: string; fieldKey: string; value: any },
    ) => {
      try {
        const d = db.getDb();
        const def = d
          .prepare(
            `SELECT * FROM custom_field_definitions WHERE company_id = ? AND entity_type = ? AND key = ?`,
          )
          .get(companyId, entityType, fieldKey) as any;
        if (!def) return { error: 'field not found' };
        const tableMap: Record<string, string> = {
          invoice: 'invoices',
          expense: 'expenses',
          client: 'clients',
          vendor: 'vendors',
          project: 'projects',
          debt: 'debts',
          bill: 'bills',
          purchase_order: 'purchase_orders',
          employee: 'employees',
          account: 'accounts',
          journal_entry: 'journal_entries',
          asset: 'fixed_assets',
          inventory_item: 'inventory_items',
        };
        const table = tableMap[entityType];
        if (!table) return { error: 'unsupported entity type' };
        const ids: any[] = d
          .prepare(
            `SELECT id FROM ${table} WHERE company_id = ? AND id NOT IN
         (SELECT entity_id FROM custom_field_values WHERE company_id = ? AND entity_type = ? AND field_key = ?
          AND (value_text IS NOT NULL OR value_number IS NOT NULL OR value_date IS NOT NULL OR value_json IS NOT NULL))`,
          )
          .all(companyId, companyId, entityType, fieldKey);
        const cols = bucketCustomFieldValue(def.field_type, value);
        const tx = d.transaction(() => {
          for (const row of ids) {
            d.prepare(
              `INSERT INTO custom_field_values (id, company_id, entity_type, entity_id, field_key, value_text, value_number, value_date, value_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).run(
              uuid(),
              companyId,
              entityType,
              row.id,
              fieldKey,
              cols.value_text,
              cols.value_number,
              cols.value_date,
              cols.value_json,
            );
          }
        });
        tx();
        if (ids.length > 0) scheduleAutoBackup();
        return { ok: true, updated: ids.length };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );
  ipcMain.handle(
    'customFields:search',
    (
      _e,
      {
        companyId,
        entityType,
        fieldKey,
        op,
        value,
      }: { companyId: string; entityType: string; fieldKey: string; op: string; value: any },
    ) => {
      try {
        const d = db.getDb();
        const def = d
          .prepare(
            `SELECT * FROM custom_field_definitions WHERE company_id = ? AND entity_type = ? AND key = ?`,
          )
          .get(companyId, entityType, fieldKey) as any;
        if (!def) return [];
        const col = ['number', 'currency'].includes(def.field_type)
          ? 'value_number'
          : ['date', 'datetime'].includes(def.field_type)
            ? 'value_date'
            : ['multi-select'].includes(def.field_type)
              ? 'value_json'
              : 'value_text';
        const ALLOWED_OPS: Record<string, string> = {
          contains: 'LIKE',
          '=': '=',
          '!=': '!=',
          '<': '<',
          '>': '>',
          '<=': '<=',
          '>=': '>=',
          LIKE: 'LIKE',
          'NOT LIKE': 'NOT LIKE',
        };
        const operator = op === 'contains' ? 'LIKE' : (ALLOWED_OPS[op] ?? '=');
        const param = op === 'contains' ? `%${value}%` : value;
        const rows = d
          .prepare(
            `SELECT entity_id FROM custom_field_values
         WHERE company_id = ? AND entity_type = ? AND field_key = ? AND ${col} ${operator} ?`,
          )
          .all(companyId, entityType, fieldKey, param) as any[];
        return rows.map((r) => r.entity_id);
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );
  // ─── E-Sign ───────────────────────────────────────────────
  const computeHash = (content: string): string => {
    return crypto
      .createHash('sha256')
      .update(content || '')
      .digest('hex');
  };
  ipcMain.handle('esign:list', (_event, filters?: any) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return [];
    let sql = 'SELECT * FROM esign_documents WHERE company_id = ?';
    const params: any[] = [companyId];
    if (filters?.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    sql += ' ORDER BY created_at DESC';
    return db
      .getDb()
      .prepare(sql)
      .all(...params);
  });
  ipcMain.handle('esign:get', (_event, { id }: { id: string }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    const doc = db
      .getDb()
      .prepare('SELECT * FROM esign_documents WHERE id = ? AND company_id = ?')
      .get(id, companyId) as any;
    if (!doc) return null;
    const signatures = db
      .getDb()
      .prepare('SELECT * FROM esign_signatures WHERE document_id = ? ORDER BY signed_at')
      .all(id);
    const permissions = db
      .getDb()
      .prepare('SELECT * FROM esign_permissions WHERE document_id = ?')
      .all(id);
    const auditLog = db
      .getDb()
      .prepare('SELECT * FROM esign_audit_log WHERE document_id = ? ORDER BY created_at DESC')
      .all(id);
    const currentHash = computeHash(doc.content);
    const verified = currentHash === doc.content_hash;
    const signedCount = signatures.length;
    return { ...doc, signatures, permissions, auditLog, verified, signedCount };
  });
  ipcMain.handle(
    'esign:create',
    (
      _event,
      { title, description, content }: { title: string; description: string; content: string },
    ) => {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return null;
      const id = uuid();
      const contentHash = computeHash(content);
      const userEmail = getLastLoginEmail() || 'unknown';
      db.getDb()
        .prepare(
          `
      INSERT INTO esign_documents (id, company_id, title, description, content, content_hash, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, datetime('now'), datetime('now'))
    `,
        )
        .run(id, companyId, title, description, content, contentHash, userEmail);
      db.getDb()
        .prepare(
          `
      INSERT INTO esign_audit_log (id, document_id, action, performed_by, new_hash, details, created_at)
      VALUES (?, ?, 'created', ?, ?, 'Document created', datetime('now'))
    `,
        )
        .run(uuid(), id, userEmail, contentHash);
      scheduleAutoBackup();
      return { id };
    },
  );
  ipcMain.handle(
    'esign:update',
    (
      _event,
      {
        id,
        title,
        description,
        content,
      }: { id: string; title: string; description: string; content: string },
    ) => {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return null;
      const existing = db
        .getDb()
        .prepare('SELECT * FROM esign_documents WHERE id = ? AND company_id = ?')
        .get(id, companyId) as any;
      if (!existing) return null;
      const previousHash = existing.content_hash;
      const newHash = computeHash(content);
      const userEmail = getLastLoginEmail() || 'unknown';
      // INTEGRITY: once a document has signatures, content_hash is the hash the
      // signatures were computed against. Do NOT overwrite it on edit, or
      // esign:verify's hashMatch (currentHash === content_hash) becomes a no-op
      // and a tampered signed document verifies as authentic. Keeping the signed
      // hash means an edit makes hashMatch fail, correctly flagging tampering.
      const sigCount =
        (
          db
            .getDb()
            .prepare('SELECT COUNT(*) AS c FROM esign_signatures WHERE document_id = ?')
            .get(id) as any
        )?.c || 0;
      const storedHash = sigCount > 0 ? previousHash : newHash;
      db.getDb()
        .prepare(
          `
      UPDATE esign_documents SET title = ?, description = ?, content = ?, content_hash = ?, updated_at = datetime('now') WHERE id = ?
    `,
        )
        .run(title, description, content, storedHash, id);
      const hashChanged = previousHash !== newHash;
      if (hashChanged) {
        db.getDb()
          .prepare(
            `
        INSERT INTO esign_audit_log (id, document_id, action, performed_by, previous_hash, new_hash, details, created_at)
        VALUES (?, ?, 'edited', ?, ?, ?, 'Content modified — signatures invalidated', datetime('now'))
      `,
          )
          .run(uuid(), id, userEmail, previousHash, newHash);
        if (existing.status === 'signed') {
          db.getDb()
            .prepare(
              `
          UPDATE esign_documents SET status = 'pending' WHERE id = ?
        `,
            )
            .run(id);
          db.getDb()
            .prepare(
              `
          INSERT INTO esign_audit_log (id, document_id, action, performed_by, details, created_at)
          VALUES (?, ?, 'status_changed', ?, 'Status changed to pending after content edit', datetime('now'))
        `,
            )
            .run(uuid(), id, userEmail);
        }
      }
      scheduleAutoBackup();
      return { success: true };
    },
  );
  ipcMain.handle('esign:delete', (_event, { id }: { id: string }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    const result = db
      .getDb()
      .prepare('DELETE FROM esign_documents WHERE id = ? AND company_id = ?')
      .run(id, companyId);
    scheduleAutoBackup();
    return { changes: result.changes };
  });
  ipcMain.handle(
    'esign:sign',
    (
      _event,
      {
        documentId,
        typedName,
        signerType,
        signerId,
        signerName,
        signedAt,
      }: {
        documentId: string;
        typedName: string;
        signerType: string;
        signerId: string;
        signerName: string;
        signedAt?: string;
      },
    ) => {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return null;
      const doc = db
        .getDb()
        .prepare('SELECT * FROM esign_documents WHERE id = ? AND company_id = ?')
        .get(documentId, companyId) as any;
      if (!doc) return { error: 'Document not found' };
      const userEmail = getLastLoginEmail() || 'unknown';
      // Effective signing timestamp — allow the caller to back-date to the
      // current OR a PAST date (e.g. signing paperwork after the fact).
      // Reject future dates: a signature can't be dated later than today.
      // Accepts 'YYYY-MM-DD' (stamped at noon to dodge TZ edge cases) or a
      // full ISO string. Falls back to now if absent/invalid.
      let effectiveSignedAt = new Date().toISOString();
      if (signedAt && typeof signedAt === 'string') {
        const iso = /^\d{4}-\d{2}-\d{2}$/.test(signedAt) ? signedAt + 'T12:00:00' : signedAt;
        const parsed = new Date(iso);
        if (!isNaN(parsed.getTime()) && parsed.getTime() <= Date.now() + 86400000) {
          effectiveSignedAt = parsed.toISOString();
        }
      }
      const hashInput = `${typedName}:${documentId}:${doc.content_hash}:${effectiveSignedAt}`;
      const signatureHash = crypto.createHash('sha256').update(hashInput).digest('hex');
      const sigId = uuid();
      db.getDb()
        .prepare(
          `
      INSERT INTO esign_signatures (id, document_id, signer_type, signer_id, signer_name, typed_name, signature_hash, signed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
        )
        .run(
          sigId,
          documentId,
          signerType || 'user',
          signerId || '',
          signerName || userEmail,
          typedName,
          signatureHash,
          effectiveSignedAt,
        );
      const _allSignatures = db
        .getDb()
        .prepare('SELECT COUNT(*) as cnt FROM esign_signatures WHERE document_id = ?')
        .get(documentId) as any;
      db.getDb()
        .prepare(
          `
      INSERT INTO esign_audit_log (id, document_id, action, performed_by, details, created_at)
      VALUES (?, ?, 'signed', ?, ?, datetime('now'))
    `,
        )
        .run(uuid(), documentId, userEmail, `${signerName || userEmail} signed as "${typedName}"`);
      db.getDb()
        .prepare(
          `
      UPDATE esign_documents SET status = CASE WHEN ? > 0 THEN 'signed' ELSE status END, updated_at = datetime('now') WHERE id = ?
    `,
        )
        .run(1, documentId);
      scheduleAutoBackup();
      return { id: sigId, signatureHash, status: 'signed', signedAt: effectiveSignedAt };
    },
  );
  ipcMain.handle('esign:revoke', (_event, { id, reason }: { id: string; reason?: string }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    const userEmail = getLastLoginEmail() || 'unknown';
    db.getDb()
      .prepare(
        "UPDATE esign_documents SET status = 'revoked', updated_at = datetime('now') WHERE id = ? AND company_id = ?",
      )
      .run(id, companyId);
    db.getDb()
      .prepare(
        `
      INSERT INTO esign_audit_log (id, document_id, action, performed_by, details, created_at)
      VALUES (?, ?, 'revoked', ?, ?, datetime('now'))
    `,
      )
      .run(uuid(), id, userEmail, reason || 'Document revoked');
    scheduleAutoBackup();
    return { success: true };
  });
  ipcMain.handle('esign:verify', (_event, { id }: { id: string }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { verified: false, error: 'No company' };
    const doc = db
      .getDb()
      .prepare('SELECT * FROM esign_documents WHERE id = ? AND company_id = ?')
      .get(id, companyId) as any;
    if (!doc) return { verified: false, error: 'Document not found' };
    const currentHash = computeHash(doc.content);
    const hashMatch = currentHash === doc.content_hash;
    const signatures = db
      .getDb()
      .prepare('SELECT * FROM esign_signatures WHERE document_id = ? ORDER BY signed_at')
      .all(id) as any[];
    // Re-derive each signature's hash (same recipe as esign:sign) and confirm it
    // still matches what was stored — not just that signatures exist.
    const signaturesIntact =
      signatures.length > 0 &&
      signatures.every((s) => {
        const expected = crypto
          .createHash('sha256')
          .update(`${s.typed_name}:${id}:${doc.content_hash}:${s.signed_at}`)
          .digest('hex');
        return expected === s.signature_hash;
      });
    const signatureValid = signaturesIntact;
    return {
      // A document is only verified if the content is unchanged, every
      // signature re-validates, and it hasn't been revoked / reset to pending.
      verified: hashMatch && signatureValid && doc.status === 'signed',
      hashMatch,
      signatureValid,
      signedCount: signatures.length,
      status: doc.status,
      contentHash: doc.content_hash,
      currentHash,
    };
  });
  ipcMain.handle(
    'esign:set-permissions',
    (
      _event,
      {
        documentId,
        permissions,
      }: { documentId: string; permissions: Array<{ userId: string; level: string }> },
    ) => {
      const companyId = db.getCurrentCompanyId();
      if (!companyId) return null;
      const userEmail = getLastLoginEmail() || 'unknown';
      const tx = db.getDb().transaction(() => {
        db.getDb().prepare('DELETE FROM esign_permissions WHERE document_id = ?').run(documentId);
        for (const perm of permissions) {
          db.getDb()
            .prepare(
              `
          INSERT INTO esign_permissions (id, document_id, user_id, permission_level, created_at)
          VALUES (?, ?, ?, ?, datetime('now'))
        `,
            )
            .run(uuid(), documentId, perm.userId, perm.level);
        }
      });
      tx();
      db.getDb()
        .prepare(
          `
      INSERT INTO esign_audit_log (id, document_id, action, performed_by, details, created_at)
      VALUES (?, ?, 'permission_changed', ?, 'Permissions updated', datetime('now'))
    `,
        )
        .run(uuid(), documentId, userEmail);
      scheduleAutoBackup();
      return { success: true };
    },
  );
  ipcMain.handle('esign:get-permissions', (_event, { documentId }: { documentId: string }) => {
    return db
      .getDb()
      .prepare('SELECT * FROM esign_permissions WHERE document_id = ?')
      .all(documentId);
  });
  ipcMain.handle('esign:get-audit-log', (_event, { documentId }: { documentId: string }) => {
    return db
      .getDb()
      .prepare('SELECT * FROM esign_audit_log WHERE document_id = ? ORDER BY created_at DESC')
      .all(documentId);
  });
  // ─── P1.13: Trash (soft-delete recovery) ──────────────
  // Read-side counterpart to db.remove() now that supported tables
  // soft-delete. The Trash UI calls these to list / restore / purge
  // records the user has deleted within the 30-day retention window.

  // ─── Orphan Detection ─────────────────────────────
  // INTEGRITY: scans for rows whose parent has been deleted out from under
  // them. SQLite's FK enforcement only catches new violations going forward;
  // historical data (pre-PRAGMA, manual deletes via raw SQL, etc.) can still
  // leave orphans. Reports counts only — does not auto-clean.
  ipcMain.handle('data:check-orphans', () => {
    try {
      const dbi = db.getDb();
      const checks: Array<{ kind: string; sql: string }> = [
        {
          kind: 'invoice_line_items_no_invoice',
          sql: `SELECT COUNT(*) AS c FROM invoice_line_items li
                 LEFT JOIN invoices i ON i.id = li.invoice_id
                 WHERE i.id IS NULL`,
        },
        {
          kind: 'journal_entry_lines_no_account',
          sql: `SELECT COUNT(*) AS c FROM journal_entry_lines jel
                 LEFT JOIN accounts a ON a.id = jel.account_id
                 WHERE a.id IS NULL`,
        },
        {
          kind: 'journal_entry_lines_no_entry',
          sql: `SELECT COUNT(*) AS c FROM journal_entry_lines jel
                 LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id
                 WHERE je.id IS NULL`,
        },
        {
          kind: 'payments_no_invoice',
          sql: `SELECT COUNT(*) AS c FROM payments p
                 LEFT JOIN invoices i ON i.id = p.invoice_id
                 WHERE i.id IS NULL`,
        },
        {
          kind: 'expense_line_items_no_expense',
          sql: `SELECT COUNT(*) AS c FROM expense_line_items eli
                 LEFT JOIN expenses e ON e.id = eli.expense_id
                 WHERE e.id IS NULL`,
        },
        {
          kind: 'debt_payments_no_debt',
          sql: `SELECT COUNT(*) AS c FROM debt_payments dp
                 LEFT JOIN debts d ON d.id = dp.debt_id
                 WHERE d.id IS NULL`,
        },
        {
          kind: 'debt_communications_no_debt',
          sql: `SELECT COUNT(*) AS c FROM debt_communications dc
                 LEFT JOIN debts d ON d.id = dc.debt_id
                 WHERE d.id IS NULL`,
        },
        {
          kind: 'bill_line_items_no_bill',
          sql: `SELECT COUNT(*) AS c FROM bill_line_items bli
                 LEFT JOIN bills b ON b.id = bli.bill_id
                 WHERE b.id IS NULL`,
        },
        {
          kind: 'bill_payments_no_bill',
          sql: `SELECT COUNT(*) AS c FROM bill_payments bp
                 LEFT JOIN bills b ON b.id = bp.bill_id
                 WHERE b.id IS NULL`,
        },
      ];
      const results: Record<string, number> = {};
      let total = 0;
      for (const chk of checks) {
        try {
          const row = dbi.prepare(chk.sql).get() as any;
          const n = Number(row?.c || 0);
          results[chk.kind] = n;
          total += n;
        } catch (_err) {
          // Table may not exist on older DBs — record -1 so caller can distinguish from 0.
          results[chk.kind] = -1;
        }
      }
      return { total, counts: results };
    } catch (err: any) {
      return { error: err?.message, total: 0, counts: {} };
    }
  });
  // ─── P1.15/P1.16/P1.17: Integrity check + cleanup ─────
  // These complement data:check-orphans with broader checks
  // (PRAGMA integrity_check, schema-drift validator, generic
  // FK-list orphan scanner). One-click cleanup endpoint NULLs
  // out the FK column on orphaned rows — irreversible, so the
  // UI confirms before invoking.
  ipcMain.handle('integrity:check', (_event, opts?: { skipOrphanScan?: boolean }) => {
    try {
      const { runIntegrityCheck } = require('../crons/integrity-check');
      return runIntegrityCheck(opts);
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  ipcMain.handle('integrity:cleanup-orphans', (_event, { target }: { target: string }) => {
    try {
      const { cleanupOrphans } = require('../crons/integrity-check');
      const r = cleanupOrphans(target);
      const cid = db.getCurrentCompanyId();
      if (cid) db.logAudit(cid, 'integrity', target, 'cleanup_orphans', { cleaned: r.cleaned });
      scheduleAutoBackup();
      return r;
    } catch (err: any) {
      return { cleaned: 0, error: err?.message };
    }
  });
  // ── Automation manual-trigger handlers ──────────────────────
  // Balance-aware invoice/bill status reconcile (also runs on a 6h cron).
  ipcMain.handle('maintenance:reconcile-status', () => {
    try {
      const { runStatusReconcile } = require('../crons/status-reconcile');
      const r = runStatusReconcile();
      scheduleAutoBackup();
      return r;
    } catch (err: any) {
      return { invoicesFixed: 0, billsFixed: 0, companiesScanned: 0, errors: [err?.message] };
    }
  });
  // ─── P6.70: Webhook subscriptions CRUD ─────────────────
  ipcMain.handle('webhooks:list', () => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return [];
      return db
        .getDb()
        .prepare(
          'SELECT id, event_type, target_url, enabled, last_fired_at, last_status, description FROM webhook_subscriptions WHERE company_id = ? ORDER BY created_at DESC',
        )
        .all(cid);
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  ipcMain.handle(
    'webhooks:save',
    (
      _event,
      payload: {
        id?: string;
        event_type: string;
        target_url: string;
        secret?: string;
        enabled?: number;
        description?: string;
      },
    ) => {
      try {
        const cid = db.getCurrentCompanyId();
        if (!cid) return { error: 'No active company' };
        if (!payload.event_type || !payload.target_url)
          return { error: 'event_type and target_url required' };
        // Reject non-https URLs except localhost.
        try {
          const u = new URL(payload.target_url);
          if (
            u.protocol !== 'https:' &&
            !(u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))
          ) {
            return { error: 'Webhook target must be HTTPS (or http://localhost for testing)' };
          }
        } catch {
          return { error: 'Invalid target_url' };
        }
        if (payload.id) {
          db.update('webhook_subscriptions', payload.id, {
            event_type: payload.event_type,
            target_url: payload.target_url,
            secret: payload.secret ?? '',
            enabled: payload.enabled ?? 1,
            description: payload.description ?? '',
          });
          scheduleAutoBackup();
          return { ok: true, id: payload.id };
        }
        const r = db.create('webhook_subscriptions', { ...payload, company_id: cid });
        scheduleAutoBackup();
        return { ok: true, id: r.id };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );
  ipcMain.handle('webhooks:delete', (_event, { id }: { id: string }) => {
    try {
      db.removeHard('webhook_subscriptions', id);
      scheduleAutoBackup();
      return { ok: true };
    } catch (err: any) {
      return { error: err?.message };
    }
  });
  ipcMain.handle('integrity:vacuum', () => {
    try {
      const { runVacuum } = require('../crons/integrity-check');
      const r = runVacuum();
      const cid = db.getCurrentCompanyId();
      if (cid)
        db.logAudit(cid, 'integrity', 'vacuum', 'vacuum', {
          sizeBefore: r.sizeBefore,
          sizeAfter: r.sizeAfter,
        });
      return r;
    } catch (err: any) {
      return { ok: false, error: err?.message };
    }
  });
  // ─── Settings get / set ───────────────────────────────────
  // Bug fix: settings module queried all companies' settings because
  // api.query('settings') had no company_id filter; also needed
  // a key-value interface to read/write individual settings cleanly.
  ipcMain.handle('settings:get', (_event, key: string) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return null;
    const dbInstance = db.getDb();
    const row = dbInstance
      .prepare('SELECT value FROM settings WHERE company_id = ? AND key = ?')
      .get(companyId, key) as any;
    return row?.value ?? null;
  });
  ipcMain.handle('settings:set', (_event, { key, value }: { key: string; value: string }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return;
    const dbInstance = db.getDb();
    const existing = dbInstance
      .prepare('SELECT id FROM settings WHERE company_id = ? AND key = ?')
      .get(companyId, key) as any;
    if (existing) {
      dbInstance
        .prepare("UPDATE settings SET value = ?, updated_at = datetime('now') WHERE id = ?")
        .run(value, existing.id);
    } else {
      db.create('settings', { company_id: companyId, key, value });
    }
    // Back up on BOTH paths — the first save of any setting for a company hit
    // the INSERT branch, which previously skipped scheduleAutoBackup(), so a
    // brand-new API key / SMTP config could be lost on restore until the next
    // unrelated write happened to trigger a backup.
    scheduleAutoBackup();
  });
  // ─── Settings list (company-scoped) ──────────────────────
  // Bug fix: api.query('settings') returned all companies' settings.
  // This handler scopes to the current company.
  ipcMain.handle('settings:list', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return [];
    return db.queryAll('settings', { company_id: companyId });
  });
  ipcMain.handle(
    'email:send-templated',
    async (_e, { companyId, templateKey, entityType, entityId, overrideTo }: any) => {
      try {
        ensureDefaultEmailTemplates(companyId);
        const tmpl = db
          .getDb()
          .prepare(`SELECT * FROM email_templates WHERE company_id = ? AND key = ?`)
          .get(companyId, templateKey) as any;
        if (!tmpl) return { error: 'Template not found' };
        const ctx = buildTemplateContext(companyId, entityType, entityId);
        const subject = resolveTemplateTokens(tmpl.subject || '', ctx);
        const body = resolveTemplateTokens(tmpl.body || '', ctx);
        let to = overrideTo;
        if (!to) {
          if ((tmpl.default_to || '').includes('client.email')) to = ctx.client_email || '';
          else to = tmpl.default_to || '';
        }
        const mailto = `mailto:${encodeURIComponent(to || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        try {
          shell.openExternal(mailto).catch((err) => console.error('ipc/index:', err));
        } catch {}
        try {
          db.create('email_log', {
            company_id: companyId,
            entity_type: entityType,
            entity_id: entityId,
            recipient: to || '',
            subject,
            status: 'opened_in_client',
            template_key: templateKey,
          });
          scheduleAutoBackup();
        } catch {}
        return { ok: true, to, subject, body };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );
  ipcMain.handle(
    'email:bulk-send-templated',
    async (_e, { companyId, templateKey, items }: any) => {
      try {
        const results: any[] = [];
        const tmpl = db
          .getDb()
          .prepare(`SELECT * FROM email_templates WHERE company_id = ? AND key = ?`)
          .get(companyId, templateKey) as any;
        for (const it of items) {
          if (!tmpl) {
            results.push({ ...it, error: 'no template' });
            continue;
          }
          const ctx = buildTemplateContext(companyId, it.entityType, it.entityId);
          const subject = resolveTemplateTokens(tmpl.subject || '', ctx);
          const body = resolveTemplateTokens(tmpl.body || '', ctx);
          const to =
            it.overrideTo ||
            ((tmpl.default_to || '').includes('client.email') ? ctx.client_email : tmpl.default_to);
          results.push({ ...it, to, subject, body });
        }
        return { ok: true, results };
      } catch (err: any) {
        return { error: err?.message };
      }
    },
  );
}
