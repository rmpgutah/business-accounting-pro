import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const backupRouter = Router();

const BACKUP_DIR = path.join(__dirname, '..', '..', 'data', 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

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
// Receives raw SQLite database file, stores as latest backup
backupRouter.post('/upload', (req, res) => {
  try {
    const signature = req.headers['x-bap-signature'] as string;
    const email = req.headers['x-bap-email'] as string;

    if (!email) {
      return res.status(400).json({ error: 'Missing x-bap-email header' });
    }

    // Collect raw body
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

      // Sanitize email for filename
      const safeEmail = email.replace(/[^a-zA-Z0-9@._-]/g, '_');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

      // Save timestamped backup
      const backupPath = path.join(BACKUP_DIR, `${safeEmail}_${timestamp}.db`);
      fs.writeFileSync(backupPath, body);

      // Save as latest
      const latestPath = path.join(BACKUP_DIR, `${safeEmail}_latest.db`);
      fs.writeFileSync(latestPath, body);

      // Clean old backups for this email (keep last 20)
      const allBackups = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith(safeEmail) && f !== `${safeEmail}_latest.db`)
        .sort()
        .reverse();
      for (let i = 20; i < allBackups.length; i++) {
        fs.unlinkSync(path.join(BACKUP_DIR, allBackups[i]));
      }

      console.log(`Backup uploaded for ${email}: ${body.length} bytes`);
      return res.json({ ok: true, size: body.length, timestamp });
    });
  } catch (err: any) {
    console.error('Backup upload error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/backup/download/:email ────────────────────
// Returns latest database backup for this email
backupRouter.get('/download/:email', (req, res) => {
  try {
    const email = req.params.email;
    const safeEmail = email.replace(/[^a-zA-Z0-9@._-]/g, '_');
    const latestPath = path.join(BACKUP_DIR, `${safeEmail}_latest.db`);

    if (!fs.existsSync(latestPath)) {
      return res.status(404).json({ error: 'No backup found for this user' });
    }

    const stats = fs.statSync(latestPath);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', stats.size);
    res.setHeader('X-Backup-Size', stats.size);
    fs.createReadStream(latestPath).pipe(res);
  } catch (err: any) {
    console.error('Backup download error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/backup/status/:email ──────────────────────
// Check if a backup exists
backupRouter.get('/status/:email', (req, res) => {
  try {
    const email = req.params.email;
    const safeEmail = email.replace(/[^a-zA-Z0-9@._-]/g, '_');
    const latestPath = path.join(BACKUP_DIR, `${safeEmail}_latest.db`);

    if (!fs.existsSync(latestPath)) {
      return res.json({ exists: false });
    }

    const stats = fs.statSync(latestPath);
    return res.json({
      exists: true,
      size: stats.size,
      lastModified: stats.mtime.toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
