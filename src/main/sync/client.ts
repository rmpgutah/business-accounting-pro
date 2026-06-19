import crypto from 'crypto';
import WebSocket from 'ws';
import { enqueue, dequeueAll, removeFromQueue, incrementAttempts, QueueItem } from './queue';

const SERVER_URL = process.env.SYNC_SERVER_URL || 'http://187.124.243.230:3001';
const SYNC_SECRET = process.env.SYNC_SECRET || '';
const WS_TOKEN = process.env.DESKTOP_WS_TOKEN || '';

let reconnectDelay = 1000;
let drainInterval: NodeJS.Timeout | null = null;
let pingInterval: NodeJS.Timeout | null = null;
// Serialize drain calls — prevents the on-open call and the 30s interval from
// racing each other (which would have both SELECT'd the same rows and double-posted).
let drainInFlight = false;

function sign(body: string): string {
  return crypto.createHmac('sha256', SYNC_SECRET).update(body).digest('hex');
}

// SECURITY: Refuse to send any sync payload (which contains the entire database
// row — clients, debts, invoices, etc.) without a configured HMAC secret AND
// over plain HTTP. Without these guards, an attacker on the local network can
// MITM the upload and either read or alter sync payloads. Falling back to
// queueing keeps the data safe locally until the secret/URL is configured.
function syncTransportSafe(): { ok: boolean; reason?: string } {
  if (!SYNC_SECRET) return { ok: false, reason: 'SYNC_SECRET not configured' };
  if (!/^https:\/\//i.test(SERVER_URL) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(SERVER_URL)) {
    return { ok: false, reason: 'SYNC_SERVER_URL must be HTTPS (HTTP only allowed for localhost)' };
  }
  return { ok: true };
}

export async function syncPush(item: QueueItem): Promise<void> {
  const safe = syncTransportSafe();
  if (!safe.ok) {
    // Don't transmit unsigned/cleartext to a public host — keep queued locally.
    enqueue(item);
    return;
  }
  try {
    const body = JSON.stringify(item);
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
  if (drainInFlight) return;
  // SECURITY: Same guard as syncPush — refuse to drain over HTTP without a secret.
  const safe = syncTransportSafe();
  if (!safe.ok) return;
  drainInFlight = true;
  try {
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
        // Only drain rows that the server actually accepted. If the response
        // includes a per-row breakdown, honor it — otherwise the whole batch
        // is treated as sent (server-side guarantees all-or-nothing on 2xx).
        let acceptedRowIds: number[] | null = null;
        try {
          const parsed = await res.clone().json() as { accepted?: number[]; rejected?: number[] } | undefined;
          if (parsed && Array.isArray(parsed.accepted)) acceptedRowIds = parsed.accepted;
        } catch { /* response is not JSON — treat as full success */ }
        if (acceptedRowIds && acceptedRowIds.length >= 0) {
          const acceptedSet = new Set(acceptedRowIds);
          const drained = items.filter(i => acceptedSet.has(i.rowId)).map(i => i.rowId);
          const failed = items.filter(i => !acceptedSet.has(i.rowId)).map(i => i.rowId);
          if (drained.length) removeFromQueue(drained);
          if (failed.length) incrementAttempts(failed);
        } else {
          removeFromQueue(items.map(i => i.rowId));
        }
      } else {
        incrementAttempts(items.map(i => i.rowId));
      }
    } catch {
      incrementAttempts(items.map(i => i.rowId));
    }
  } finally {
    drainInFlight = false;
  }
}

function clearTimers() {
  if (drainInterval) { clearInterval(drainInterval); drainInterval = null; }
  if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
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
      clearTimers();
      drainInterval = setInterval(drainQueue, 30_000);
      // Track ping interval so reconnects don't leak a new one each time.
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('ping');
      }, 30_000);
      drainQueue();
    });

    ws.on('message', (data: Buffer) => {
      const msg = data.toString();
      if (msg === 'pong') return;
      try { onMessage(JSON.parse(msg)); } catch {}
    });

    ws.on('close', () => {
      clearTimers();
      // Backoff with jitter to avoid thundering-herd reconnect storms when
      // the server bounces and every desktop client reconnects simultaneously.
      const jitter = Math.random() * Math.min(reconnectDelay, 5_000);
      const delay = Math.min(reconnectDelay + jitter, 60_000);
      setTimeout(connect, delay);
      reconnectDelay = Math.min(reconnectDelay * 2, 60_000);
    });

    ws.on('error', (err: Error) => console.error('Sync WS error:', err.message));
  };

  connect();
}
