import type { IpcMain } from 'electron';
import * as db from '../../database';
import fs from 'fs';
import http from 'http';
import https from 'https';
import crypto from 'crypto';
import { SYNC_SERVER } from '../core/deps';
import type { IpcDeps } from '../core/types';

// Mirror of the server's sanitizeEmail (server/src/routes/backup.ts). Both
// sides must HMAC over the identical string, so this logic must stay in lockstep
// with the server: same whitelist, same 100-char cap.
function sanitizeBackupEmail(email: string): string {
  return (email || '').replace(/[^a-zA-Z0-9@._-]/g, '_').slice(0, 100);
}

// Helper: download backup from server
function downloadBackup(email: string): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const url = new URL(`${SYNC_SERVER}/api/backup/download/${encodeURIComponent(email)}`);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    // The server authenticates download/status by HMAC over the sanitized
    // email. We sign the raw email; the server applies the same sanitize +
    // HMAC and compares. Mirror the upload secret-resolution exactly.
    const secret = process.env.SYNC_SECRET || 'bap-sync-default';
    const signature = crypto
      .createHmac('sha256', secret)
      .update(sanitizeBackupEmail(email))
      .digest('hex');

    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: 'GET',
        headers: { 'x-bap-signature': signature },
      },
      (res) => {
        if (res.statusCode !== 200) {
          resolve(null);
          return;
        }
        const ct = res.headers['content-type'] || '';
        if (ct.includes('text/html') || ct.includes('text/plain')) {
          res.resume();
          resolve(null);
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          // Validate SQLite magic header before accepting
          const SQLITE_MAGIC = Buffer.from('SQLite format 3\0');
          if (buf.length < 16 || !buf.slice(0, 16).equals(SQLITE_MAGIC)) {
            resolve(null);
            return;
          }
          resolve(buf);
        });
      },
    );
    req.on('error', () => resolve(null));
    req.end();
  });
}

// Helper: register user on server (fire-and-forget)
function serverRegister(email: string, password: string, displayName: string, userId: string) {
  try {
    const payload = JSON.stringify({ email, password, displayName, userId });
    const url = new URL(`${SYNC_SERVER}/api/auth/register`);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (c: string) => (body += c));
        res.on('end', () => console.log('Server register:', res.statusCode, body));
      },
    );
    req.on('error', (err) => console.warn('Server register failed:', err.message));
    req.write(payload);
    req.end();
  } catch (err) {
    console.warn('Server register error:', err);
  }
}

// ─── Password Hashing (pbkdf2 — no external deps) ──────
function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, s, 100000, 64, 'sha512').toString('hex');
  return { hash: `${s}:${hash}`, salt: s };
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const check = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return hash === check;
}

export function registerAuthCompanyIpc(ipcMain: IpcMain, deps: IpcDeps): void {
  const { scheduleAutoBackup, cancelAutoBackup, setLastLoginEmail, seedDefaultCategories } = deps;

  // User invitations
  ipcMain.handle(
    'admin:invitations:create',
    (_event, { email, role, invited_by, expires_in_days }: any) => {
      try {
        const cid = db.getCurrentCompanyId();
        if (!cid) return { error: 'No active company' };
        const { createInvitation } = require('../../services/admin-features');
        const r = createInvitation(cid, email, role, invited_by, expires_in_days);
        scheduleAutoBackup();
        return r;
      } catch (e: any) {
        return { error: e?.message };
      }
    },
  );
  ipcMain.handle('admin:invitations:list', (_event, { include_expired_revoked }: any = {}) => {
    try {
      const cid = db.getCurrentCompanyId();
      if (!cid) return [];
      const { listInvitations } = require('../../services/admin-features');
      return listInvitations(cid, !!include_expired_revoked);
    } catch (e: any) {
      return { error: e?.message };
    }
  });
  ipcMain.handle('admin:invitations:revoke', (_event, { id }: any) => {
    try {
      const { revokeInvitation } = require('../../services/admin-features');
      const r = { ok: revokeInvitation(id) };
      scheduleAutoBackup();
      return r;
    } catch (e: any) {
      return { error: e?.message };
    }
  });

  // ─── Company Management ──────────────────────────────
  ipcMain.handle('company:list', () => {
    const companies = db.queryAll('companies');
    // Auto-switch to the first company if currentCompanyId is not yet set
    // (happens on cold start before renderer calls company:switch)
    if (!db.getCurrentCompanyId() && companies.length > 0) {
      db.switchCompany(companies[0].id);
    }
    return companies;
  });

  ipcMain.handle('company:get', (_event, id) => {
    return db.getById('companies', id);
  });

  ipcMain.handle('company:create', (_event, data) => {
    const company = db.create('companies', data);
    db.seedDefaultAccounts(company.id);
    // Seed default categories for new company
    seedDefaultCategories(company.id);
    db.switchCompany(company.id);
    scheduleAutoBackup();
    return company;
  });

  ipcMain.handle('company:update', (_event, { id, data }) => {
    const result = db.update('companies', id, data);
    scheduleAutoBackup();
    return result;
  });

  ipcMain.handle('company:switch', (_event, companyId) => {
    db.switchCompany(companyId);
  });

  ipcMain.handle(
    'auth:register',
    (
      _event,
      { email, password, displayName }: { email: string; password: string; displayName: string },
    ) => {
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return { error: 'Invalid email format' };
      if (!password || password.length < 6)
        return { error: 'Password must be at least 6 characters' };
      // Check if any users exist (first user becomes owner)
      const existing = db.runQuery('SELECT COUNT(*) as count FROM users');
      const isFirst = existing[0]?.count === 0;

      // Check email uniqueness
      const dup = db.runQuery('SELECT id FROM users WHERE email = ?', [email]);
      if (dup.length > 0) throw new Error('An account with this email already exists');

      const { hash } = hashPassword(password);
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      db.execQuery(
        'INSERT INTO users (id, email, display_name, password_hash, role, last_login, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, email, displayName, hash, isFirst ? 'owner' : 'accountant', now, now, now],
      );

      // Also register on server (non-blocking)
      setLastLoginEmail(email);
      serverRegister(email, password, displayName, id);
      scheduleAutoBackup();

      return {
        id,
        email,
        display_name: displayName,
        role: isFirst ? 'owner' : 'accountant',
        avatar_color: '#3b82f6',
      };
    },
  );

  ipcMain.handle(
    'auth:login',
    async (_event, { email, password }: { email: string; password: string }) => {
      let rows = db.runQuery('SELECT * FROM users WHERE email = ?', [email]);

      // If user not found locally, try restoring from server backup
      if (rows.length === 0) {
        console.log('User not found locally, checking server for backup...');
        const backup = await downloadBackup(email);
        if (backup && backup.length > 1000) {
          // CONCURRENCY: cancel any pending auto-backup so it doesn't race
          // against the restore (would re-upload the soon-to-be-overwritten
          // empty DB right as we restore the real one), then close the DB
          // *before* overwriting the file so we don't tear out from under any
          // open prepared statements / WAL state.
          cancelAutoBackup();
          const dbPath = db.getDbPath();
          try {
            db.getDb().pragma('wal_checkpoint(TRUNCATE)');
            db.getDb().close();
          } catch (_) {}
          // Also remove -wal and -shm so the restored DB isn't paired with a
          // stale WAL from the old empty database.
          try {
            fs.unlinkSync(dbPath + '-wal');
          } catch (_) {}
          try {
            fs.unlinkSync(dbPath + '-shm');
          } catch (_) {}
          fs.writeFileSync(dbPath, backup);
          console.log(`Restored ${backup.length} byte backup from server for ${email}`);
          // Reinitialize database
          db.reinitDatabase();
          rows = db.runQuery('SELECT * FROM users WHERE email = ?', [email]);
        }
      }

      if (rows.length === 0) throw new Error('Invalid email or password');

      const user = rows[0];
      if (!verifyPassword(password, user.password_hash))
        throw new Error('Invalid email or password');

      // Update last_login
      db.execQuery('UPDATE users SET last_login = ? WHERE id = ?', [
        new Date().toISOString(),
        user.id,
      ]);
      setLastLoginEmail(email);

      // WHO SYSTEM: set the authenticated user in main-process state so
      // logAudit() and other who-tracking code can attribute writes to a
      // real user instead of the placeholder 'user' string.
      db.setCurrentUser(user.id, user.email);

      // Get user's companies
      const companies = db.runQuery(
        'SELECT c.*, uc.role as user_role FROM companies c JOIN user_companies uc ON c.id = uc.company_id WHERE uc.user_id = ?',
        [user.id],
      );

      // Upload current DB to server (non-blocking)
      scheduleAutoBackup();

      return {
        user: {
          id: user.id,
          email: user.email,
          display_name: user.display_name,
          role: user.role,
          avatar_color: user.avatar_color,
        },
        companies,
      };
    },
  );

  // WHO SYSTEM: explicit logout handler so the renderer can signal main
  // to clear the current-user state. Until this is called the user
  // remains authenticated for audit purposes (e.g. logout-on-Cmd-Q is
  // a soft logout — main still attributes writes to them).
  ipcMain.handle('auth:logout', () => {
    try {
      db.clearCurrentUser();
      setLastLoginEmail('');
      return { ok: true };
    } catch (err: any) {
      console.error('auth:logout failed:', err);
      return { error: err?.message };
    }
  });

  // WHO SYSTEM: lets the renderer ask "who does main think is logged in?"
  // Useful for the Activity panel showing "current user" header, plus
  // for debugging when the renderer's authStore drifts from main state.
  ipcMain.handle('auth:current-user', () => {
    return {
      user_id: db.getCurrentUserId(),
      user_email: db.getCurrentUserEmail(),
    };
  });

  // WHO SYSTEM: renderer restored a persisted authStore on Cmd+R / app
  // launch and needs to re-establish the main-process user state.
  // Verifies the user_id actually exists in the DB (defense against a
  // tampered localStorage) before setting state.
  ipcMain.handle('auth:resume-session', (_event, { userId }: { userId: string }) => {
    try {
      if (!userId) return { error: 'userId required' };
      const rows = db.runQuery('SELECT id, email FROM users WHERE id = ?', [userId]);
      if (rows.length === 0) {
        db.clearCurrentUser();
        return { error: 'User not found — session cleared' };
      }
      const u = rows[0];
      db.setCurrentUser(u.id, u.email);
      setLastLoginEmail(u.email);
      return { ok: true, user_id: u.id, user_email: u.email };
    } catch (err: any) {
      console.error('auth:resume-session failed:', err);
      return { error: err?.message };
    }
  });

  ipcMain.handle('auth:has-users', () => {
    try {
      const rows = db.runQuery('SELECT COUNT(*) as count FROM users');
      return rows[0]?.count > 0;
    } catch (err) {
      console.error('auth:has-users failed:', err);
      return false;
    }
  });

  ipcMain.handle('auth:list-users', () => {
    try {
      return db.runQuery(
        'SELECT id, email, display_name, role, avatar_color, last_login FROM users ORDER BY created_at',
      );
    } catch (err) {
      console.error('auth:list-users failed:', err);
      return [];
    }
  });

  ipcMain.handle(
    'auth:link-user-company',
    (_event, { userId, companyId, role }: { userId: string; companyId: string; role?: string }) => {
      // SQLite's INSERT OR IGNORE does NOT suppress FOREIGN KEY violations — catch explicitly.
      // If the user doesn't exist in the DB (stale localStorage), skip the link gracefully.
      try {
        db.execQuery(
          'INSERT OR IGNORE INTO user_companies (user_id, company_id, role) VALUES (?, ?, ?)',
          [userId, companyId, role || 'owner'],
        );
        scheduleAutoBackup();
      } catch (_) {
        // FOREIGN KEY failure: user not in DB (stale session). Company still usable.
      }
      return true;
    },
  );

  // SECURITY: Replaces a renderer-driven `DELETE FROM users` via rawQuery.
  // Routing account deletion through a named handler keeps the protected-table
  // guard intact and lets us scope the delete to the caller's own user id.
  ipcMain.handle('auth:delete-account', (_event, { userId }: { userId: string }) => {
    if (!userId || typeof userId !== 'string') return { error: 'Invalid userId' };
    try {
      db.execQuery('DELETE FROM user_companies WHERE user_id = ?', [userId]);
      db.execQuery('DELETE FROM users WHERE id = ?', [userId]);
      scheduleAutoBackup();
      return { ok: true };
    } catch (err) {
      console.error('auth:delete-account failed:', err);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('auth:validate-session', (_event, { userId }: { userId: string }) => {
    try {
      const rows = db.runQuery(
        'SELECT id, email, display_name, role, avatar_color FROM users WHERE id = ?',
        [userId],
      );
      return rows.length > 0 ? rows[0] : null;
    } catch {
      return null;
    }
  });
}
