// src/main/services/webhook-dispatcher.ts
//
// P6.70 — Outbound webhooks
//
// Subscribes to the EventBus and POSTs JSON payloads to user-
// configured endpoints when matching events fire (invoice.created,
// payment.received, invoice.overdue, etc.). Lets external systems
// (Zapier, n8n, custom integrations) react to BAP state changes
// without polling.
//
// Configuration: per-company `webhook_subscriptions` table.
//   id, company_id, event_type, target_url, secret, enabled,
//   last_fired_at, last_status, retries
//
// Security:
//   • HTTPS-only (rejects http://) unless localhost
//   • Optional HMAC-SHA256 signature in X-BAP-Signature header
//     so the receiver can verify the payload wasn't tampered with
//   • Per-call 10s timeout — slow webhooks don't block the app
//
// Reliability:
//   • Best-effort — failures are logged but don't fail the
//     originating operation
//   • Failed deliveries are NOT retried in this MVP — future
//     enhancement: exponential backoff queue

import * as crypto from 'crypto';
import * as db from '../database';
import { eventBus, type EventPayload, type EventType } from './EventBus';

interface WebhookSubscription {
  id: string;
  company_id: string;
  event_type: string;       // EventType OR '*' for all
  target_url: string;
  secret: string;
  enabled: number;
}

function listSubscriptions(companyId: string, eventType: EventType): WebhookSubscription[] {
  try {
    return db.getDb().prepare(
      "SELECT * FROM webhook_subscriptions WHERE company_id = ? AND enabled = 1 AND (event_type = ? OR event_type = '*')"
    ).all(companyId, eventType) as WebhookSubscription[];
  } catch {
    // webhook_subscriptions table may not exist yet — fail soft.
    return [];
  }
}

function signPayload(secret: string, body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function isAllowedUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return true;
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) return true;
    return false;
  } catch {
    return false;
  }
}

async function dispatchOne(sub: WebhookSubscription, payload: EventPayload): Promise<void> {
  if (!isAllowedUrl(sub.target_url)) return;
  const body = JSON.stringify({
    event: payload.type,
    occurredAt: payload.occurredAt,
    companyId: payload.companyId,
    entityType: payload.entityType,
    entityId: payload.entityId,
    data: payload.data,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'BusinessAccountingPro-Webhook/1.0',
    'X-BAP-Event': String(payload.type),
  };
  if (sub.secret) {
    headers['X-BAP-Signature'] = signPayload(sub.secret, body);
  }

  const start = Date.now();
  let status = 'unknown';
  try {
    const res = await fetch(sub.target_url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(10_000),
    });
    status = 'http_' + res.status;
    if (!res.ok) {
      console.warn('[webhook] non-2xx:', sub.target_url, res.status);
    }
  } catch (err: any) {
    status = 'error';
    console.warn('[webhook] failed:', sub.target_url, err?.message);
  }

  // Update last_fired metadata. Best-effort — table may not exist.
  try {
    db.getDb().prepare(
      "UPDATE webhook_subscriptions SET last_fired_at = datetime('now'), last_status = ? WHERE id = ?"
    ).run(status, sub.id);
  } catch { /* ignore */ }

  const elapsed = Date.now() - start;
  if (elapsed > 5000) {
    console.warn('[webhook] slow delivery (' + elapsed + 'ms):', sub.target_url);
  }
}

let dispatcherInstalled = false;

// Install a single onAny EventBus subscriber that fans out to any
// matching webhook_subscriptions rows. Idempotent — safe to call
// multiple times.
export function initWebhookDispatcher(): void {
  if (dispatcherInstalled) return;
  dispatcherInstalled = true;

  eventBus.onAny(async (payload) => {
    const subs = listSubscriptions(payload.companyId, payload.type);
    if (subs.length === 0) return;
    // Fire all matching subs in parallel (each has its own 10s timeout).
    await Promise.allSettled(subs.map((s) => dispatchOne(s, payload)));
  });
}
