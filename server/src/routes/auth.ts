import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../db';
import { v4 as uuidv4 } from 'uuid';

export const authRouter = Router();

// ─── Password hashing (mirrors desktop) ─────────────────
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(32).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const check = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(check));
  } catch {
    return false;
  }
}

// Ensure users table exists on server (called lazily on first request)
let usersTableReady = false;
function ensureUsersTable() {
  if (usersTableReady) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS server_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'owner',
      avatar_color TEXT DEFAULT '#3b82f6',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  usersTableReady = true;
}

// ─── POST /api/auth/register ────────────────────────────
authRouter.post('/register', (req, res) => {
  try {
    ensureUsersTable();
    const { email, password, displayName, userId } = req.body;
    if (!email || !password || !displayName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const existing = db.prepare('SELECT id FROM server_users WHERE email = ?').get(email) as any;
    if (existing) {
      return res.json({ ok: true, message: 'User already registered on server' });
    }

    const id = userId || uuidv4();
    const passwordHash = hashPassword(password);
    db.prepare(
      'INSERT INTO server_users (id, email, display_name, password_hash) VALUES (?, ?, ?, ?)'
    ).run(id, email, displayName, passwordHash);

    console.log(`Server auth: registered ${email}`);
    return res.json({ ok: true, id });
  } catch (err: any) {
    console.error('Server auth register error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/auth/login ───────────────────────────────
authRouter.post('/login', (req, res) => {
  try {
    ensureUsersTable();
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Missing email or password' });
    }

    const user = db.prepare('SELECT * FROM server_users WHERE email = ?').get(email) as any;
    if (!user) {
      return res.status(401).json({ error: 'User not found on server' });
    }

    if (!verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    console.log(`Server auth: login ${email}`);
    return res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        role: user.role,
        avatar_color: user.avatar_color,
      },
    });
  } catch (err: any) {
    console.error('Server auth login error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/auth/check ───────────────────────────────
authRouter.post('/check', (req, res) => {
  try {
    ensureUsersTable();
    const { email } = req.body;
    const user = db.prepare('SELECT id, email, display_name FROM server_users WHERE email = ?').get(email) as any;
    return res.json({ exists: !!user, user: user || null });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
