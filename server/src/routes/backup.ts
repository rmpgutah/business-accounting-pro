import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const backupRouter = Router();

const BACKUP_DIR_UNRESOLVED = path.resolve(__dirname, '..', '..', 'data', 'backups');
if (!fs.existsSync(BACKUP_DIR_UNRESOLVED)) fs.mkdirSync(BACKUP_DIR_UNRESOLVED, { recursive: true });
const BACKUP_DIR = fs.realpathSync(BACKUP_DIR_UNRESOLVED);

/** Sanitize email into a safe filename component and validate resulting path is inside BACKUP_DIR */
function safePath(email: string, suffix: string): string {
  const safeEmail = email.replace(/[^a-zA-Z0-9@._-]/g, '_').slice(0, 100);
  const resolved = path.resolve(BACKUP_DIR, `${safeEmail}${suffix}`);
  // Ensure the resolved path is exactly BACKUP_DIR or a descendant of it
  if (!(resolved === BACKUP_DIR || resolved.startsWith(BACKUP_DIR + path.sep))) {
    throw new Error('Path traversal attempt blocked');
  }
  return safe;
}

function verifySignature(body: Buffer, signature: string): boolean {
  const secret = process.env.SYNC_SECRET!;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// ─── POST /api/backup/upload ────────────────────────────
backupRouter.post('/upload', (req, res) => {
  try {
    const signature = req.headers['x-bap-signature'] as string;
    const email = req.headers['x-bap-email'] as string;

    if (!email) {
      return res.status(400).json({ error: 'Missing x-bap-email header' });
    }

    const safeEmail = sanitizeEmail(email);

    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);

      if (signature && !verifySignature(body, signature)) {
        return res.status(403).json({ error: 'Invalid signature' });
      }

      if (body.length < 100) {
        return res.status(400).json({ error: 'Database file too small' });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFilename = `${safeEmail}_${timestamp}.db`;
      const latestFilename = `${safeEmail}_latest.db`;

      // Write files using only sanitized filenames joined to the fixed BACKUP_DIR
      fs.writeFileSync(path.join(BACKUP_DIR, backupFilename), body);
      fs.writeFileSync(path.join(BACKUP_DIR, latestFilename), body);

      // Clean old backups (keep last 20)
      const allBackups = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith(safeEmail) && f !== latestFilename)
        .sort()
        .reverse();
      for (let i = 20; i < allBackups.length; i++) {
        // Only delete files that match the safe prefix pattern
        const fname = allBackups[i];
        if (/^[A-Za-z0-9@._-]+\.db$/.test(fname)) {
          fs.unlinkSync(path.join(BACKUP_DIR, fname));
        }
      }

      console.log(`Backup uploaded for ${safeEmail}: ${body.length} bytes`);
      return res.json({ ok: true, size: body.length, timestamp });
    });
  } catch (err: any) {
    console.error('Backup upload error:', err);
    return res.status(500).json({ error: 'Backup upload failed' });
  }
});

// ─── GET /api/backup/download/:email ────────────────────
backupRouter.get('/download/:email', (req, res) => {
  try {
    const safeEmail = sanitizeEmail(req.params.email);
    const latestFilename = `${safeEmail}_latest.db`;
    const fullPath = path.join(BACKUP_DIR, latestFilename);

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'No backup found for this user' });
    }

    const stats = fs.statSync(fullPath);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('X-Backup-Size', stats.size);
    fs.createReadStream(fullPath).pipe(res);
  } catch (err: any) {
    console.error('Backup download error:', err);
    return res.status(500).json({ error: 'Backup download failed' });
  }
});

// ─── GET /api/backup/status/:email ──────────────────────
backupRouter.get('/status/:email', (req, res) => {
  try {
    const safeEmail = sanitizeEmail(req.params.email);
    const latestFilename = `${safeEmail}_latest.db`;
    const fullPath = path.join(BACKUP_DIR, latestFilename);

    if (!fs.existsSync(fullPath)) {
      return res.json({ exists: false });
    }

    const stats = fs.statSync(fullPath);
    return res.json({
      exists: true,
      size: stats.size,
      lastModified: stats.mtime.toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Status check failed' });
  }
});
