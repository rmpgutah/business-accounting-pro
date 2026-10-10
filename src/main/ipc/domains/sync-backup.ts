import type { IpcMain } from 'electron';
import * as db from '../../database';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { IpcDeps } from '../core/types';

export function registerSyncBackupIpc(ipcMain: IpcMain, _deps: IpcDeps): void {
  // ─── Cloud bootstrap ────────────────────────────────────
  // Push local users + companies + user_companies up to the configured cloud
  // sync URL so the customer can sign in to the cloud with the SAME email +
  // password they already use on the desktop. The cloud verifies password
  // hashes in BOTH formats (pbkdf2-SHA256 cloud-native, pbkdf2-SHA512 from
  // here), so the hashes transfer 1:1 — no password reset needed.
  // Idempotent on the cloud side; safe to re-run after adding new local users.
  ipcMain.handle('cloud:bootstrap-users', async () => {
    try {
      const rawDb = db.getDb();
      const companyId = db.getCurrentCompanyId();
      // Settings are company-scoped. Cloud Sync settings live on whichever
      // company is currently active when the user clicks Save in the UI.
      const readSetting = (k: string): string => {
        const row = rawDb
          .prepare('SELECT value FROM settings WHERE company_id = ? AND key = ?')
          .get(companyId, k) as any;
        return row?.value || '';
      };
      const url = readSetting('cloud_sync_url').trim().replace(/\/$/, '');
      const token = readSetting('cloud_sync_token').trim();
      if (!url) return { error: 'Cloud Sync URL not set in API & Integrations.' };
      if (!token) return { error: 'Cloud Sync Token not set in API & Integrations.' };
      const users = rawDb
        .prepare(
          `
        SELECT id, email, display_name, password_hash, role
        FROM users
      `,
        )
        .all() as any[];
      const companies = rawDb
        .prepare(
          `
        SELECT id, name, email, phone, address, tax_id, currency
        FROM companies
      `,
        )
        .all() as any[];
      const userCompanies = rawDb
        .prepare(
          `
        SELECT user_id, company_id, role
        FROM user_companies
      `,
        )
        .all() as any[];

      if (users.length === 0) {
        return { error: 'No local users to push. Register an account on the desktop first.' };
      }

      const res = await fetch(url + '/api/auth/bootstrap', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ users, companies, user_companies: userCompanies }),
      });
      const text = await res.text();
      let body: any;
      try {
        body = JSON.parse(text);
      } catch {
        body = { error: text || 'Non-JSON response' };
      }
      if (!res.ok) {
        return { error: body?.error || 'Cloud responded with HTTP ' + res.status };
      }
      return { ok: true, imported: body?.imported, status: res.status };
    } catch (err: any) {
      return { error: err?.message || 'Bootstrap failed' };
    }
  });
  // ─── Database Backup to VPS ────────────────────────────
  ipcMain.handle('backup:to-vps', async () => {
    try {
      const dbPath = db.getDbPath();
      if (!fs.existsSync(dbPath)) return { error: 'Database file not found' };

      // Checkpoint WAL to ensure all data is in the main file
      try {
        db.getDb().pragma('wal_checkpoint(TRUNCATE)');
      } catch (_) {}

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T').join('_');
      const remotePath = `/var/www/accounting.rmpgutah.us/backups/accounting_${timestamp}.db`;
      const latestPath = `/var/www/accounting.rmpgutah.us/backups/accounting_latest.db`;
      const sshKey = path.join(os.homedir(), '.ssh', 'id_ed25519_deploy');
      const vpsHost = '194.113.64.90';
      const vpsUser = 'root';

      const { execFileSync } = require('child_process');

      // Ensure remote backup directory exists
      execFileSync(
        'ssh',
        [
          '-i',
          sshKey,
          '-o',
          'StrictHostKeyChecking=no',
          `${vpsUser}@${vpsHost}`,
          'mkdir -p /var/www/accounting.rmpgutah.us/backups',
        ],
        { timeout: 10000 },
      );

      // Upload timestamped backup
      execFileSync(
        'scp',
        [
          '-i',
          sshKey,
          '-o',
          'StrictHostKeyChecking=no',
          dbPath,
          `${vpsUser}@${vpsHost}:${remotePath}`,
        ],
        { timeout: 30000 },
      );

      // Copy as "latest" for easy restore
      execFileSync(
        'ssh',
        [
          '-i',
          sshKey,
          '-o',
          'StrictHostKeyChecking=no',
          `${vpsUser}@${vpsHost}`,
          `cp '${remotePath}' '${latestPath}'`,
        ],
        { timeout: 10000 },
      );

      // Clean old backups (keep last 30)
      execFileSync(
        'ssh',
        [
          '-i',
          sshKey,
          '-o',
          'StrictHostKeyChecking=no',
          `${vpsUser}@${vpsHost}`,
          'cd /var/www/accounting.rmpgutah.us/backups && ls -t accounting_*.db | tail -n +31 | xargs -r rm --',
        ],
        { timeout: 10000 },
      );

      const stats = fs.statSync(dbPath);
      return { success: true, size: stats.size, timestamp, remotePath };
    } catch (err: any) {
      console.error('VPS backup failed:', err);
      return { error: err?.message || 'Backup failed' };
    }
  });
  ipcMain.handle('backup:restore-from-vps', async () => {
    try {
      const dbPath = db.getDbPath();
      const sshKey = path.join(os.homedir(), '.ssh', 'id_ed25519_deploy');
      const vpsHost = '194.113.64.90';
      const vpsUser = 'root';
      const remotePath = `/var/www/accounting.rmpgutah.us/backups/accounting_latest.db`;
      const localBackup = dbPath + '.pre-restore-backup';

      const { execFileSync } = require('child_process');

      // Make local backup first
      if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, localBackup);

      // Download latest from VPS
      execFileSync(
        'scp',
        [
          '-i',
          sshKey,
          '-o',
          'StrictHostKeyChecking=no',
          `${vpsUser}@${vpsHost}:${remotePath}`,
          dbPath,
        ],
        { timeout: 30000 },
      );

      return { success: true, message: 'Database restored from VPS. Restart app to apply.' };
    } catch (err: any) {
      console.error('VPS restore failed:', err);
      return { error: err?.message || 'Restore failed' };
    }
  });
}
