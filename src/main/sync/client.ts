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
