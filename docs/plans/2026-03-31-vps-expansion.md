# VPS Expansion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add real-time desktop↔VPS sync, client invoice portal with Stripe payments, workflow automation engine, and financial intelligence to Business Accounting Pro.

**Architecture:** Desktop SQLite remains the single source of truth. Every IPC write pushes a payload to a VPS Express server via HTTP + WebSocket. The VPS hosts a read replica plus all outward-facing services (client portal, Stripe webhooks, automation cron jobs, nightly intelligence runs).

**Tech Stack:** Electron 41 + better-sqlite3 (desktop), Express 5 + better-sqlite3 + ws + node-cron (VPS server), React 19 + Vite (client portal SPA), Stripe SDK (payments), Tailwind CSS (portal UI), TypeScript throughout.

---

## Task 1: Server — Project scaffold

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/src/index.ts`
- Create: `server/.env.example`

**Step 1: Create server directory**

```bash
mkdir -p server/src server/data
```

**Step 2: Create server/package.json**

```json
{
  "name": "bap-sync-server",
  "version": "1.0.0",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "dev": "ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "better-sqlite3": "^12.8.0",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^5.2.1",
    "node-cron": "^3.0.3",
    "stripe": "^16.0.0",
    "uuid": "^13.0.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13",
    "@types/cors": "^2.8.17",
    "@types/express": "^5.0.6",
    "@types/node": "^20.0.0",
    "@types/node-cron": "^3.0.11",
    "@types/ws": "^8.5.13",
    "ts-node": "^10.9.2",
    "typescript": "^5.4.0"
  }
}
```

**Step 3: Create server/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

**Step 4: Create server/.env.example**

```
PORT=3001
SYNC_SECRET=change-me-32-chars-minimum
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
DESKTOP_WS_TOKEN=change-me-desktop-token
```

**Step 5: Create server/src/index.ts**

```typescript
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { initDb } from './db';
import { initWebSocket } from './ws';
import { syncRouter } from './routes/sync';
import { portalRouter } from './routes/portal';
import { stripeRouter } from './routes/stripe';
import { startCrons } from './crons';

const app = express();
app.use(cors());
app.use(express.json());

initDb();

app.use('/api/sync', syncRouter);
app.use('/portal', portalRouter);
app.use('/api/stripe', stripeRouter);
app.get('/health', (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);
initWebSocket(server);
startCrons();

const PORT = Number(process.env.PORT) || 3001;
server.listen(PORT, () => console.log(`BAP sync server listening on :${PORT}`));
```

**Step 6: Install dependencies**

```bash
cd server && npm install
```

**Step 7: Commit**

```bash
git add server/
git commit -m "feat: scaffold VPS sync server (Express + TS + ws + node-cron)"
```

---

## Task 2: Server — SQLite replica database

**Files:**
- Create: `server/src/db.ts`

**Step 1: Create server/src/db.ts**

```typescript
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

export let db: Database.Database;

export function initDb() {
  db = new Database(path.join(DATA_DIR, 'replica.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_log (
      id TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      operation TEXT NOT NULL CHECK(operation IN ('create','update','delete')),
      record_id TEXT NOT NULL,
      company_id TEXT,
      payload TEXT,
      synced_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS invoice_tokens (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL UNIQUE,
      company_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS financial_anomalies (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      anomaly_type TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL,
      category TEXT,
      detected_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      dismissed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS automation_rules (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      name TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      trigger_type TEXT NOT NULL,
      trigger_config TEXT NOT NULL DEFAULT '{}',
      conditions TEXT NOT NULL DEFAULT '[]',
      actions TEXT NOT NULL DEFAULT '[]',
      last_run_at INTEGER,
      run_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS automation_run_log (
      id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL,
      ran_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      status TEXT NOT NULL CHECK(status IN ('pass','fail','skip')),
      detail TEXT
    );
  `);

  console.log('Server DB initialized');
}

export function applySync(payload: {
  table: string;
  operation: 'create' | 'update' | 'delete';
  id: string;
  data: Record<string, unknown>;
  companyId: string;
  timestamp: number;
}) {
  const { table, operation, id, data } = payload;

  ensureTable(table, data);

  if (operation === 'delete') {
    db.prepare(`DELETE FROM "${table}" WHERE id = ?`).run(id);
    return;
  }

  const cols = Object.keys(data);
  if (cols.length === 0) return;

  if (operation === 'create') {
    const placeholders = cols.map(() => '?').join(', ');
    db.prepare(
      `INSERT OR REPLACE INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`
    ).run(...cols.map(c => data[c] as any));
  } else {
    const sets = cols.filter(c => c !== 'id').map(c => `"${c}" = ?`).join(', ');
    const vals = cols.filter(c => c !== 'id').map(c => data[c]);
    db.prepare(`UPDATE "${table}" SET ${sets} WHERE id = ?`).run(...vals, id);
  }

  db.prepare(
    `INSERT INTO sync_log (id, table_name, operation, record_id, company_id, payload)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(uuidv4(), table, operation, id, payload.companyId, JSON.stringify(data));
}

const createdTables = new Set<string>();

function ensureTable(table: string, sample: Record<string, unknown>) {
  if (createdTables.has(table)) return;
  const cols = Object.keys(sample).map(c => `"${c}" TEXT`).join(', ');
  db.exec(`CREATE TABLE IF NOT EXISTS "${table}" (${cols || '"id" TEXT PRIMARY KEY'})`);
  createdTables.add(table);
}
```

**Step 2: Commit**

```bash
git add server/src/db.ts
git commit -m "feat: server SQLite replica db with applySync and schema bootstrap"
```

---

## Task 3: Server — WebSocket hub

**Files:**
- Create: `server/src/ws.ts`

**Step 1: Create server/src/ws.ts**

```typescript
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';

const desktopClients = new Set<WebSocket>();

export function initWebSocket(server: http.Server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url!, `http://localhost`);
    const token = url.searchParams.get('token');
    if (token !== process.env.DESKTOP_WS_TOKEN) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    desktopClients.add(ws);
    console.log(`Desktop client connected (${desktopClients.size} total)`);

    ws.on('close', () => {
      desktopClients.delete(ws);
    });

    ws.on('error', (err: Error) => console.error('WS error:', err.message));

    ws.on('message', (data: Buffer) => {
      if (data.toString() === 'ping') ws.send('pong');
    });
  });
}

export function pushToDesktop(event: { type: string; [key: string]: unknown }) {
  const msg = JSON.stringify(event);
  for (const ws of desktopClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}
```

**Step 2: Commit**

```bash
git add server/src/ws.ts
git commit -m "feat: WebSocket hub for desktop push notifications"
```

---

## Task 4: Server — Sync API route

**Files:**
- Create: `server/src/routes/sync.ts`

**Step 1: Create server/src/routes/sync.ts**

```typescript
import express, { Router } from 'express';
import crypto from 'crypto';
import { applySync } from '../db';

export const syncRouter = Router();

function verifySignature(body: string, signature: string): boolean {
  const secret = process.env.SYNC_SECRET!;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// POST /api/sync — desktop pushes every write
syncRouter.post('/', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-bap-signature'] as string;
  if (!signature || !verifySignature(req.body.toString(), signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let payload: any;
  try { payload = JSON.parse(req.body.toString()); }
  catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  try {
    applySync(payload);
    res.json({ ok: true });
  } catch (err: any) {
    console.error('applySync error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sync/batch — offline queue drain
syncRouter.post('/batch', express.raw({ type: 'application/json' }), (req, res) => {
  const signature = req.headers['x-bap-signature'] as string;
  if (!signature || !verifySignature(req.body.toString(), signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let items: any[];
  try { items = JSON.parse(req.body.toString()); }
  catch { return res.status(400).json({ error: 'Invalid JSON' }); }

  let applied = 0;
  for (const item of items) {
    try { applySync(item); applied++; } catch (e: any) {
      console.error('batch item failed:', e.message);
    }
  }
  res.json({ ok: true, applied, total: items.length });
});
```

**Step 2: Commit**

```bash
git add server/src/routes/sync.ts
git commit -m "feat: POST /api/sync route with HMAC signature verification"
```

---

## Task 5: Server — Client portal route

**Files:**
- Create: `server/src/routes/portal.ts`

**Step 1: Create server/src/routes/portal.ts**

```typescript
import { Router } from 'express';
import path from 'path';
import { db } from '../db';

export const portalRouter = Router();

portalRouter.get('/:token/data', (req, res) => {
  const row = db.prepare(
    `SELECT invoice_id, company_id, expires_at FROM invoice_tokens WHERE token = ?`
  ).get(req.params.token) as any;

  if (!row) return res.status(404).json({ error: 'Invoice not found' });
  if (row.expires_at < Math.floor(Date.now() / 1000)) {
    return res.status(410).json({ error: 'Link expired' });
  }

  const invoice = db.prepare(`SELECT * FROM invoices WHERE id = ?`).get(row.invoice_id) as any;
  if (!invoice) return res.status(404).json({ error: 'Invoice not found in replica' });

  const lineItems = db.prepare(
    `SELECT * FROM invoice_line_items WHERE invoice_id = ?`
  ).all(row.invoice_id);

  const company = db.prepare(`SELECT * FROM companies WHERE id = ?`).get(row.company_id);

  res.json({ invoice, lineItems, company });
});

portalRouter.get('/:token', (_req, res) => {
  res.sendFile('index.html', {
    root: path.join(__dirname, '..', '..', 'portal', 'dist')
  });
});
```

**Step 2: Commit**

```bash
git add server/src/routes/portal.ts
git commit -m "feat: portal route serves invoice data from replica"
```

---

## Task 6: Server — Stripe webhook route

**Files:**
- Create: `server/src/routes/stripe.ts`

**Step 1: Create server/src/routes/stripe.ts**

```typescript
import express, { Router } from 'express';
import Stripe from 'stripe';
import { db } from '../db';
import { pushToDesktop } from '../ws';
import { v4 as uuidv4 } from 'uuid';

export const stripeRouter = Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });

stripeRouter.post('/checkout', async (req, res) => {
  const { token } = req.body as { token: string };
  const row = db.prepare(
    `SELECT invoice_id, company_id FROM invoice_tokens WHERE token = ?`
  ).get(token) as any;

  if (!row) return res.status(404).json({ error: 'Invalid token' });

  const invoice = db.prepare(`SELECT * FROM invoices WHERE id = ?`).get(row.invoice_id) as any;
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

  const amountCents = Math.round(Number(invoice.total) * 100);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: `Invoice ${invoice.invoice_number}` },
          unit_amount: amountCents,
        },
        quantity: 1,
      }],
      success_url: `${req.headers.origin}/portal/${token}?paid=1`,
      cancel_url: `${req.headers.origin}/portal/${token}`,
      metadata: { invoice_id: row.invoice_id, company_id: row.company_id, token },
    });
    res.json({ url: session.url });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

stripeRouter.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const sig = req.headers['stripe-signature'] as string;
    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!
      );
    } catch (err: any) {
      return res.status(400).send(`Webhook error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const { invoice_id, company_id } = session.metadata!;
      const amount = (session.amount_total || 0) / 100;
      const stripePaymentId = session.payment_intent as string;

      db.prepare(`UPDATE invoices SET status = 'paid' WHERE id = ?`).run(invoice_id);
      db.prepare(`
        INSERT OR IGNORE INTO payments
          (id, invoice_id, company_id, amount, payment_date, payment_method, reference, created_at)
        VALUES (?, ?, ?, ?, strftime('%Y-%m-%d','now'), 'stripe', ?, strftime('%s','now'))
      `).run(uuidv4(), invoice_id, company_id, amount, stripePaymentId);

      pushToDesktop({ type: 'invoice:paid', invoiceId: invoice_id, companyId: company_id, amount, stripePaymentId });
    }

    res.json({ received: true });
  }
);
```

**Step 2: Commit**

```bash
git add server/src/routes/stripe.ts
git commit -m "feat: Stripe checkout session creation + webhook handler"
```

---

## Task 7: Server — Cron jobs

**Files:**
- Create: `server/src/crons/index.ts`
- Create: `server/src/crons/automation.ts`
- Create: `server/src/crons/intelligence.ts`

**Step 1: Create server/src/crons/index.ts**

```typescript
import cron from 'node-cron';
import { runAutomations } from './automation';
import { runIntelligence } from './intelligence';

export function startCrons() {
  cron.schedule('*/15 * * * *', () => {
    runAutomations().catch(err => console.error('automation error:', err));
  });
  cron.schedule('0 2 * * *', () => {
    runIntelligence().catch(err => console.error('intelligence error:', err));
  });
  console.log('Cron jobs started');
}
```

**Step 2: Create server/src/crons/automation.ts**

```typescript
import { db } from '../db';
import { pushToDesktop } from '../ws';
import { v4 as uuidv4 } from 'uuid';

export async function runAutomations() {
  const rules = db.prepare(`SELECT * FROM automation_rules WHERE is_active = 1`).all() as any[];

  for (const rule of rules) {
    const config = JSON.parse(rule.trigger_config || '{}');
    const actions: any[] = JSON.parse(rule.actions || '[]');

    try {
      const triggered = await evaluateTrigger(rule.trigger_type, config);

      if (triggered) {
        for (const action of actions) await executeAction(action, rule);
      }

      db.prepare(
        `UPDATE automation_rules SET last_run_at = strftime('%s','now'), run_count = run_count + 1 WHERE id = ?`
      ).run(rule.id);

      db.prepare(
        `INSERT INTO automation_run_log (id, rule_id, status) VALUES (?, ?, ?)`
      ).run(uuidv4(), rule.id, triggered ? 'pass' : 'skip');
    } catch (err: any) {
      db.prepare(
        `INSERT INTO automation_run_log (id, rule_id, status, detail) VALUES (?, ?, 'fail', ?)`
      ).run(uuidv4(), rule.id, err.message);
    }
  }
}

async function evaluateTrigger(type: string, config: any): Promise<boolean> {
  switch (type) {
    case 'invoice_overdue': {
      const days = config.days_overdue ?? 1;
      const row = db.prepare(
        `SELECT COUNT(*) as n FROM invoices WHERE status NOT IN ('paid','void') AND due_date < date('now', '-${Number(days)} days')`
      ).get() as any;
      return row.n > 0;
    }
    case 'bill_due_soon': {
      const days = config.days_ahead ?? 3;
      const row = db.prepare(
        `SELECT COUNT(*) as n FROM bills WHERE status NOT IN ('paid','void') AND due_date BETWEEN date('now') AND date('now', '+${Number(days)} days')`
      ).get() as any;
      return row.n > 0;
    }
    case 'payment_received': {
      const row = db.prepare(
        `SELECT COUNT(*) as n FROM payments WHERE created_at > strftime('%s','now') - 900`
      ).get() as any;
      return row.n > 0;
    }
    case 'schedule':
      return true;
    default:
      return false;
  }
}

async function executeAction(action: any, rule: any) {
  switch (action.type) {
    case 'create_notification':
      pushToDesktop({
        type: 'notification:create',
        title: action.title ?? rule.name,
        message: action.message ?? `Automation "${rule.name}" triggered`,
        companyId: rule.company_id,
      });
      break;
    case 'update_status': {
      const { table, where_status, set_status } = action;
      if (table && where_status && set_status) {
        db.prepare(`UPDATE "${table}" SET status = ? WHERE status = ?`).run(set_status, where_status);
      }
      break;
    }
    default:
      console.warn(`Unknown action type: ${action.type}`);
  }
}
```

**Step 3: Create server/src/crons/intelligence.ts**

```typescript
import { db } from '../db';
import { pushToDesktop } from '../ws';
import { v4 as uuidv4 } from 'uuid';

export async function runIntelligence() {
  await detectAnomalies();
}

async function detectAnomalies() {
  const companies = db.prepare(`SELECT DISTINCT company_id FROM invoices`).all() as any[];

  for (const { company_id } of companies) {
    const baselines = db.prepare(`
      SELECT category_id,
             AVG(amount) as avg_amount,
             COUNT(*) as n
      FROM expenses
      WHERE company_id = ?
        AND date >= date('now', '-90 days')
        AND date < date('now', '-7 days')
      GROUP BY category_id
      HAVING n >= 3
    `).all(company_id) as any[];

    for (const baseline of baselines) {
      const recent = db.prepare(`
        SELECT SUM(amount) as total
        FROM expenses
        WHERE company_id = ? AND category_id = ? AND date >= date('now', '-7 days')
      `).get(company_id, baseline.category_id) as any;

      if (!recent?.total) continue;

      const ratio = recent.total / baseline.avg_amount;
      if (ratio < 2.5) continue;

      const exists = db.prepare(`
        SELECT id FROM financial_anomalies
        WHERE company_id = ? AND category = ? AND detected_at > strftime('%s','now') - 86400
      `).get(company_id, baseline.category_id);

      if (!exists) {
        db.prepare(`
          INSERT INTO financial_anomalies (id, company_id, anomaly_type, description, amount, category)
          VALUES (?, ?, 'expense_spike', ?, ?, ?)
        `).run(
          uuidv4(), company_id,
          `Expense ${ratio.toFixed(1)}x above 90-day average in this category`,
          recent.total, baseline.category_id
        );

        pushToDesktop({
          type: 'notification:create',
          title: 'Unusual Expense Detected',
          message: `Spend is ${ratio.toFixed(1)}x above average for a category this week`,
          companyId: company_id,
        });
      }
    }
  }
}
```

**Step 4: Commit**

```bash
git add server/src/crons/
git commit -m "feat: automation + financial intelligence cron jobs"
```

---

## Task 8: Desktop — new schema tables

**Files:**
- Modify: `src/main/database/schema.sql`

**Step 1: Append to end of schema.sql**

```sql
-- Sync queue (offline support)
CREATE TABLE IF NOT EXISTS sync_queue (
  id TEXT PRIMARY KEY,
  table_name TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('create','update','delete')),
  record_id TEXT NOT NULL,
  company_id TEXT,
  payload TEXT NOT NULL,
  queued_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  attempts INTEGER NOT NULL DEFAULT 0
);

-- Invoice tokens (portal links)
CREATE TABLE IF NOT EXISTS invoice_tokens (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL UNIQUE,
  company_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- Automation rules
CREATE TABLE IF NOT EXISTS automation_rules (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  trigger_type TEXT NOT NULL,
  trigger_config TEXT NOT NULL DEFAULT '{}',
  conditions TEXT NOT NULL DEFAULT '[]',
  actions TEXT NOT NULL DEFAULT '[]',
  last_run_at INTEGER,
  run_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS automation_run_log (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL,
  ran_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  status TEXT NOT NULL CHECK(status IN ('pass','fail','skip')),
  detail TEXT
);

CREATE TABLE IF NOT EXISTS financial_anomalies (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  anomaly_type TEXT NOT NULL,
  description TEXT NOT NULL,
  amount REAL,
  category TEXT,
  detected_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  dismissed INTEGER NOT NULL DEFAULT 0
);
```

**Step 2: Commit**

```bash
git add src/main/database/schema.sql
git commit -m "feat: schema — sync_queue, invoice_tokens, automation_rules, anomalies"
```

---

## Task 9: Desktop — sync push client

**Files:**
- Create: `src/main/sync/queue.ts`
- Create: `src/main/sync/client.ts`
- Create: `src/main/sync/index.ts`

**Step 1: Create src/main/sync/queue.ts**

```typescript
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

let db: Database.Database;

export function initQueue(database: Database.Database) {
  db = database;
}

export interface QueueItem {
  table: string;
  operation: 'create' | 'update' | 'delete';
  id: string;
  data: Record<string, unknown>;
  companyId: string;
  timestamp: number;
}

export function enqueue(item: QueueItem) {
  db.prepare(`
    INSERT INTO sync_queue (id, table_name, operation, record_id, company_id, payload)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), item.table, item.operation, item.id, item.companyId, JSON.stringify(item));
}

export function dequeueAll(): Array<QueueItem & { rowId: number }> {
  return db.prepare(
    `SELECT rowid as rowId, * FROM sync_queue ORDER BY queued_at ASC LIMIT 100`
  ).all() as any[];
}

export function removeFromQueue(rowIds: number[]) {
  if (rowIds.length === 0) return;
  const placeholders = rowIds.map(() => '?').join(',');
  db.prepare(`DELETE FROM sync_queue WHERE rowid IN (${placeholders})`).run(...rowIds);
}

export function incrementAttempts(rowIds: number[]) {
  if (rowIds.length === 0) return;
  const placeholders = rowIds.map(() => '?').join(',');
  db.prepare(`UPDATE sync_queue SET attempts = attempts + 1 WHERE rowid IN (${placeholders})`).run(...rowIds);
}
```

**Step 2: Create src/main/sync/client.ts**

```typescript
import crypto from 'crypto';
import WebSocket from 'ws';
import { enqueue, dequeueAll, removeFromQueue, incrementAttempts, QueueItem } from './queue';

const SERVER_URL = process.env.SYNC_SERVER_URL || 'http://187.124.243.230:3001';
const SYNC_SECRET = process.env.SYNC_SECRET || '';
const WS_TOKEN = process.env.DESKTOP_WS_TOKEN || '';

let reconnectDelay = 1000;
let drainInterval: NodeJS.Timeout | null = null;

function sign(body: string): string {
  return crypto.createHmac('sha256', SYNC_SECRET).update(body).digest('hex');
}

export async function syncPush(item: QueueItem): Promise<void> {
  const body = JSON.stringify(item);
  try {
    const res = await fetch(`${SERVER_URL}/api/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bap-signature': sign(body) },
      body,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    enqueue(item);
  }
}

async function drainQueue() {
  const items = dequeueAll();
  if (items.length === 0) return;
  const body = JSON.stringify(items);
  try {
    const res = await fetch(`${SERVER_URL}/api/sync/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bap-signature': sign(body) },
      body,
    });
    if (res.ok) {
      removeFromQueue(items.map(i => i.rowId));
    } else {
      incrementAttempts(items.map(i => i.rowId));
    }
  } catch {
    incrementAttempts(items.map(i => i.rowId));
  }
}

export function connectWebSocket(
  onMessage: (event: { type: string; [key: string]: unknown }) => void
) {
  const wsUrl = SERVER_URL.replace(/^http/, 'ws') + `/ws?token=${WS_TOKEN}`;

  const connect = () => {
    const ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      console.log('Sync WS connected');
      reconnectDelay = 1000;
      if (drainInterval) clearInterval(drainInterval);
      drainInterval = setInterval(drainQueue, 30_000);
      drainQueue();
    });

    ws.on('message', (data: Buffer) => {
      const msg = data.toString();
      if (msg === 'pong') return;
      try { onMessage(JSON.parse(msg)); } catch {}
    });

    ws.on('close', () => {
      if (drainInterval) { clearInterval(drainInterval); drainInterval = null; }
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 60_000);
    });

    ws.on('error', (err: Error) => console.error('Sync WS error:', err.message));

    setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('ping'); }, 30_000);
  };

  connect();
}
```

**Step 3: Create src/main/sync/index.ts**

```typescript
export { syncPush, connectWebSocket } from './client';
export { initQueue } from './queue';
```

**Step 4: Commit**

```bash
git add src/main/sync/
git commit -m "feat: desktop sync push client with offline queue and WS reconnect"
```

---

## Task 10: Desktop — wire sync into IPC + main.ts

**Files:**
- Modify: `src/main/ipc/index.ts`
- Modify: `src/main/main.ts`

**Step 1: Add import to src/main/ipc/index.ts**

At the top with other imports, add:
```typescript
import { syncPush } from '../sync';
```

**Step 2: After each successful db:create INSERT, add fire-and-forget push**

Locate the `db:create` handler. After the INSERT runs and before `return result`, add:
```typescript
syncPush({
  table, operation: 'create', id: result.id as string,
  data: finalData, companyId: (finalData.company_id as string) ?? '',
  timestamp: Date.now(),
}).catch(() => {});
```

**Step 3: After each successful db:update, add push**

Locate the `db:update` handler. After the UPDATE runs, add:
```typescript
syncPush({
  table, operation: 'update', id,
  data: { id, ...data }, companyId: (data.company_id as string) ?? '',
  timestamp: Date.now(),
}).catch(() => {});
```

**Step 4: After each successful db:delete, add push**

Locate the `db:delete` handler. After the DELETE runs, add:
```typescript
syncPush({
  table, operation: 'delete', id,
  data: { id }, companyId: '',
  timestamp: Date.now(),
}).catch(() => {});
```

**Step 5: Wire up in src/main/main.ts**

In the `app.whenReady()` block, after `initializeDatabase()`, add:
```typescript
import { initQueue, connectWebSocket } from './sync';

initQueue(db);
connectWebSocket((event) => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;

  if (event.type === 'invoice:paid') {
    const { invoiceId, companyId, amount, stripePaymentId } = event as any;
    try {
      db.prepare(`UPDATE invoices SET status = 'paid' WHERE id = ?`).run(invoiceId);
      win.webContents.send('sync:invoice-paid', { invoiceId, companyId, amount, stripePaymentId });
    } catch (e) {
      console.error('Failed to apply remote payment:', e);
    }
  }

  if (event.type === 'notification:create') {
    win.webContents.send('notification:push', event);
  }
});
```

**Step 6: Commit**

```bash
git add src/main/ipc/index.ts src/main/main.ts
git commit -m "feat: wire syncPush into IPC handlers and connect WebSocket in main"
```

---

## Task 11: Desktop — invoice token + portal link

**Files:**
- Modify: `src/main/ipc/index.ts`
- Modify: `src/renderer/lib/api.ts`

**Step 1: Add invoice:generate-token handler in src/main/ipc/index.ts**

```typescript
ipcMain.handle('invoice:generate-token', (_event, invoiceId: string) => {
  const existing = db.prepare(
    `SELECT token FROM invoice_tokens WHERE invoice_id = ?`
  ).get(invoiceId) as any;
  if (existing) return { token: existing.token };

  const token = require('crypto').randomBytes(32).toString('hex');
  const invoice = db.prepare(`SELECT due_date FROM invoices WHERE id = ?`).get(invoiceId) as any;
  const dueTs = invoice?.due_date
    ? new Date(invoice.due_date).getTime()
    : Date.now();
  const expiresAt = Math.floor(dueTs / 1000) + 90 * 86400;

  db.prepare(`
    INSERT INTO invoice_tokens (id, invoice_id, company_id, token, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(require('uuid').v4(), invoiceId, activeCompanyId ?? '', token, expiresAt);

  return { token };
});
```

**Step 2: Add to src/renderer/lib/api.ts**

```typescript
generateInvoiceToken: (invoiceId: string): Promise<{ token: string }> =>
  window.electronAPI.invoke('invoice:generate-token', invoiceId),
```

**Step 3: Add "Copy Portal Link" button to invoice detail view**

In `src/renderer/modules/invoices/` (invoice detail component), add a button that:
1. Calls `api.generateInvoiceToken(invoiceId)`
2. Constructs `https://accounting.rmpgutah.us/portal/${token}`
3. Copies to clipboard with `navigator.clipboard.writeText(url)`
4. Shows a toast "Portal link copied!"

**Step 4: Commit**

```bash
git add src/main/ipc/index.ts src/renderer/lib/api.ts src/renderer/modules/invoices/
git commit -m "feat: invoice portal link generation + copy button in invoice detail"
```

---

## Task 12: Client portal SPA

**Files:**
- Create: `server/portal/` (Vite React project)

**Step 1: Scaffold**

```bash
cd server
npm create vite@latest portal -- --template react-ts
cd portal && npm install
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

**Step 2: Configure tailwind.config.js**

```js
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
}
```

**Step 3: Update server/portal/src/index.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

**Step 4: Replace server/portal/src/App.tsx with a portal component**

The portal component should:
- Extract `token` from `window.location.pathname` (path: `/portal/:token`)
- On mount, `fetch('/portal/:token/data')` to load invoice + line items + company
- Show: company header, invoice number, status badge, line items table, total
- Show "Pay Now" button if status !== paid — calls `POST /api/stripe/checkout` → redirects to `session.url`
- Show green "Payment Received" banner if URL contains `?paid=1` or status is `paid`
- Match the blocky UI aesthetic: sharp corners, gray-900 borders, `font-black` headings

**Step 5: Build**

```bash
cd server/portal && npm run build
```

Expected output: `server/portal/dist/index.html`

**Step 6: Commit**

```bash
git add server/portal/
git commit -m "feat: client invoice portal SPA with Stripe Pay Now"
```

---

## Task 13: Desktop — Automations module

**Files:**
- Modify: `src/main/ipc/index.ts`
- Modify: `src/renderer/lib/api.ts`
- Create: `src/renderer/modules/automations/index.tsx`
- Modify: `src/renderer/App.tsx`

**Step 1: Add IPC handlers**

```typescript
ipcMain.handle('automations:list', () =>
  db.prepare(
    `SELECT * FROM automation_rules WHERE company_id = ? ORDER BY created_at DESC`
  ).all(activeCompanyId)
);

ipcMain.handle('automations:toggle', (_e, ruleId: string) =>
  db.prepare(
    `UPDATE automation_rules SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?`
  ).run(ruleId)
);

ipcMain.handle('automations:run-log', (_e, ruleId: string) =>
  db.prepare(
    `SELECT * FROM automation_run_log WHERE rule_id = ? ORDER BY ran_at DESC LIMIT 50`
  ).all(ruleId)
);
```

**Step 2: Add to api.ts**

```typescript
listAutomations: () => window.electronAPI.invoke('automations:list'),
toggleAutomation: (ruleId: string) => window.electronAPI.invoke('automations:toggle', ruleId),
automationRunLog: (ruleId: string) => window.electronAPI.invoke('automations:run-log', ruleId),
```

**Step 3: Create automations/index.tsx**

Two-panel layout:
- **Left panel**: list of rules — name, trigger type badge (colored pill), last run time, active/inactive toggle
- **Right panel** (on rule select): shows trigger type, conditions, actions in read-only JSON display blocks; run log table (date, status: PASS/FAIL/SKIP badge, detail)
- Blocky UI: `border-2 border-gray-900`, `font-black` section headers

**Step 4: Register in App.tsx**

```typescript
const Automations = React.lazy(() => import('./modules/automations'));
```

Add to sidebar nav and route switch.

**Step 5: Commit**

```bash
git add src/main/ipc/index.ts src/renderer/lib/api.ts src/renderer/modules/automations/ src/renderer/App.tsx
git commit -m "feat: Automations UI — rule list, detail, run log"
```

---

## Task 14: Desktop — Financial intelligence dashboard

**Files:**
- Modify: `src/main/ipc/index.ts`
- Modify: `src/renderer/lib/api.ts`
- Modify: `src/renderer/modules/dashboard/` (dashboard component)

**Step 1: Add IPC handlers**

```typescript
ipcMain.handle('intelligence:anomalies', () =>
  db.prepare(
    `SELECT * FROM financial_anomalies WHERE company_id = ? AND dismissed = 0 ORDER BY detected_at DESC LIMIT 20`
  ).all(activeCompanyId)
);

ipcMain.handle('intelligence:dismiss-anomaly', (_e, id: string) =>
  db.prepare(`UPDATE financial_anomalies SET dismissed = 1 WHERE id = ?`).run(id)
);

ipcMain.handle('intelligence:cash-projection', (_e, { days }: { days: number }) => {
  const d = Math.min(Math.max(Number(days), 1), 90); // clamp 1-90
  const inflow = db.prepare(`
    SELECT SUM(total) as amount, due_date
    FROM invoices
    WHERE company_id = ? AND status NOT IN ('paid','void','draft')
      AND due_date BETWEEN date('now') AND date('now', '+${d} days')
    GROUP BY due_date ORDER BY due_date
  `).all(activeCompanyId);

  const outflow = db.prepare(`
    SELECT SUM(total_amount) as amount, due_date
    FROM bills
    WHERE company_id = ? AND status NOT IN ('paid','void','draft')
      AND due_date BETWEEN date('now') AND date('now', '+${d} days')
    GROUP BY due_date ORDER BY due_date
  `).all(activeCompanyId);

  return { inflow, outflow };
});
```

**Step 2: Add to api.ts**

```typescript
listAnomalies: (): Promise<any[]> =>
  window.electronAPI.invoke('intelligence:anomalies'),
dismissAnomaly: (id: string): Promise<void> =>
  window.electronAPI.invoke('intelligence:dismiss-anomaly', id),
cashProjection: (days: number): Promise<{ inflow: any[]; outflow: any[] }> =>
  window.electronAPI.invoke('intelligence:cash-projection', { days }),
```

**Step 3: Add AnomaliesPanel to dashboard**

Add a new section to the dashboard below the cashflow chart:
- Title: "Intelligence Alerts"
- Each anomaly: orange-bordered card, description text, dismiss button (×)
- Dismiss calls `api.dismissAnomaly(id)` then removes card from state
- Empty state: "No anomalies detected" in gray

**Step 4: Add projected cashflow line**

The dashboard's existing cashflow chart uses recharts `LineChart`. Add a second line:
- Fetch `api.cashProjection(30)` on mount
- Merge inflow/outflow into a `projected` series by date
- Render as `<Line strokeDasharray="5 5" stroke="#9ca3af" name="Projected" />`

**Step 5: Commit**

```bash
git add src/main/ipc/index.ts src/renderer/lib/api.ts src/renderer/modules/dashboard/
git commit -m "feat: financial intelligence — anomalies panel + projected cashflow line"
```

---

## Task 15: Deploy server to VPS

**Files:**
- Modify: `deploy/setup-vps.sh`
- Modify: `deploy/nginx.conf`
- Modify: `.github/workflows/deploy-vps.yml`

**Step 1: Add Node.js + PM2 install to setup-vps.sh**

```bash
# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2
pm2 startup systemd -u $USER --hp $HOME | tail -1 | sudo bash

# Prepare server directory
sudo mkdir -p /opt/bap-server
sudo chown $USER:$USER /opt/bap-server
```

**Step 2: Add proxy locations to deploy/nginx.conf**

Inside the `server { }` block, add:
```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}

location /portal/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
}

location /ws {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

**Step 3: Add server deploy step to .github/workflows/deploy-vps.yml**

After the landing page rsync step, add:
```yaml
- name: Deploy sync server
  run: |
    rsync -az --delete server/ "$VPS_USER@$VPS_HOST:/opt/bap-server/"
    ssh "$VPS_USER@$VPS_HOST" 'cd /opt/bap-server && npm ci --omit=dev && npm run build && (pm2 restart bap-server || pm2 start dist/index.js --name bap-server) && pm2 save'
  env:
    VPS_USER: ${{ secrets.VPS_USER }}
    VPS_HOST: ${{ secrets.VPS_HOST }}
```

**Step 4: Create /opt/bap-server/.env on VPS (manual — do this once)**

SSH in and run:
```bash
openssl rand -hex 32   # use output as SYNC_SECRET
openssl rand -hex 16   # use output as DESKTOP_WS_TOKEN
```

Create `/opt/bap-server/.env`:
```
PORT=3001
SYNC_SECRET=<output from above>
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
DESKTOP_WS_TOKEN=<output from above>
```

**Step 5: Set env vars in Electron app**

In project root `.env` (gitignored):
```
SYNC_SERVER_URL=https://accounting.rmpgutah.us
SYNC_SECRET=<same as VPS>
DESKTOP_WS_TOKEN=<same as VPS>
```

Load in `src/main/main.ts` with `dotenv/config` import at top.

**Step 6: Commit**

```bash
git add deploy/ .github/
git commit -m "feat: VPS deploy pipeline — PM2 server + Nginx proxy for sync + portal + WS"
```

---

## Final Checklist

- [ ] `cd server && npm run build` completes without TypeScript errors
- [ ] VPS server starts: `pm2 start dist/index.js --name bap-server`
- [ ] Health check: `curl https://accounting.rmpgutah.us/api/health` → `{"ok":true}`
- [ ] Desktop creates a record → check `/opt/bap-server/data/replica.db` has the row
- [ ] Invoice token generated → `https://accounting.rmpgutah.us/portal/<token>` shows invoice in browser
- [ ] Stripe test payment → desktop receives toast notification "Payment received via Stripe"
- [ ] Automation rule with `invoice_overdue` trigger → notification appears after cron runs
- [ ] Dashboard shows anomaly card (inject test row into `financial_anomalies`)
- [ ] Dashboard cashflow chart shows dashed projected line alongside actual line
