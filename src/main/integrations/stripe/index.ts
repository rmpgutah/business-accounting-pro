// src/main/integrations/stripe/index.ts
//
// Top-level orchestrator that ties the HTTP client to the local SQLite cache
// so the UI can be used offline and display live data as soon as the network
// returns. Public surface is the three IPC handlers registered in
// `registerStripeIpc()`:
//
//   stripe:call    { resource, action, id?, params?, companyId? }
//                  → always tries the network; on success, upserts cache;
//                    on failure (offline / 5xx), falls back to cache for
//                    list/retrieve and queues for mutations.
//
//   stripe:listCached { resource, companyId, limit? }
//                  → read-only; never touches the network. Feeds the offline
//                    explorer UI.
//
//   stripe:sync    { resource, companyId, since? }
//                  → full refresh of a single resource. Uses auto-pagination.
//                    Also drains pending queued mutations.
//
// Every cache row is scoped by `company_id` so multi-tenant users can't see
// another company's Stripe data if they switch active company.

import type { IpcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { getDb } from '../../database';
import { stripeRequest, stripeListAll } from './client';
import { STRIPE_RESOURCES, resolveRoute, resourcesByGroup } from './resources';

// ─── Settings helpers ──────────────────────────────────────────────────────

function getApiKey(companyId: string | undefined): string {
  const db = getDb();
  // Prefer company-scoped key if set, else global
  if (companyId) {
    const scoped = db.prepare(
      `SELECT value FROM settings WHERE company_id = ? AND key = 'stripe_api_key' LIMIT 1`,
    ).get(companyId) as { value?: string } | undefined;
    if (scoped?.value) return scoped.value;
  }
  const global = db.prepare(
    `SELECT value FROM settings WHERE key = 'stripe_api_key' AND (company_id IS NULL OR company_id = '') LIMIT 1`,
  ).get() as { value?: string } | undefined;
  return global?.value ?? '';
}

// ─── Cache operations ──────────────────────────────────────────────────────

interface StripeObject { id: string; object?: string; created?: number; [k: string]: unknown }

function upsertCache(companyId: string, resource: string, obj: StripeObject): void {
  if (!obj?.id) return;
  const db = getDb();
  db.prepare(`
    INSERT INTO stripe_cache (id, company_id, resource, stripe_id, data, stripe_created, synced_at, is_stale)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), 0)
    ON CONFLICT(company_id, resource, stripe_id) DO UPDATE SET
      data = excluded.data,
      stripe_created = excluded.stripe_created,
      synced_at = datetime('now'),
      is_stale = 0
  `).run(
    randomUUID(),
    companyId,
    resource,
    obj.id,
    JSON.stringify(obj),
    typeof obj.created === 'number' ? obj.created : null,
  );
}

function readCache(companyId: string, resource: string, limit = 200): StripeObject[] {
  const rows = getDb().prepare(`
    SELECT data FROM stripe_cache
    WHERE company_id = ? AND resource = ?
    ORDER BY COALESCE(stripe_created, 0) DESC, synced_at DESC
    LIMIT ?
  `).all(companyId, resource, limit) as Array<{ data: string }>;
  return rows.map((r) => {
    try { return JSON.parse(r.data) as StripeObject; } catch { return { id: '?' } as StripeObject; }
  });
}

function readCacheOne(companyId: string, resource: string, stripeId: string): StripeObject | null {
  const row = getDb().prepare(`
    SELECT data FROM stripe_cache
    WHERE company_id = ? AND resource = ? AND stripe_id = ?
    LIMIT 1
  `).get(companyId, resource, stripeId) as { data?: string } | undefined;
  if (!row?.data) return null;
  try { return JSON.parse(row.data) as StripeObject; } catch { return null; }
}

function updateSyncState(companyId: string, resource: string, ok: boolean, error?: string) {
  const db = getDb();
  const now = "datetime('now')";
  const existing = db.prepare(`SELECT id FROM stripe_sync_state WHERE company_id = ? AND resource = ?`)
    .get(companyId, resource) as { id?: string } | undefined;
  if (existing?.id) {
    if (ok) {
      db.prepare(`UPDATE stripe_sync_state SET last_synced_at = ${now}, last_ok_at = ${now}, last_error = NULL WHERE id = ?`)
        .run(existing.id);
    } else {
      db.prepare(`UPDATE stripe_sync_state SET last_synced_at = ${now}, last_error = ? WHERE id = ?`)
        .run(error ?? 'unknown', existing.id);
    }
  } else {
    db.prepare(`
      INSERT INTO stripe_sync_state (id, company_id, resource, last_synced_at, last_ok_at, last_error)
      VALUES (?, ?, ?, datetime('now'), ${ok ? "datetime('now')" : 'NULL'}, ?)
    `).run(randomUUID(), companyId, resource, ok ? null : (error ?? 'unknown'));
  }
}

// ─── Offline queue ─────────────────────────────────────────────────────────

function enqueueMutation(args: {
  companyId: string; resource: string; action: string; stripeId?: string; params?: Record<string, unknown>;
}): string {
  const key = `bap-${args.resource}-${args.action}-${randomUUID()}`;
  getDb().prepare(`
    INSERT INTO stripe_offline_queue (id, company_id, resource, action, stripe_id, params, idempotency_key)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    args.companyId,
    args.resource,
    args.action,
    args.stripeId ?? null,
    args.params ? JSON.stringify(args.params) : null,
    key,
  );
  return key;
}

async function drainQueue(companyId: string): Promise<{ drained: number; failed: number }> {
  const db = getDb();
  const apiKey = getApiKey(companyId);
  if (!apiKey) return { drained: 0, failed: 0 };

  const rows = db.prepare(`
    SELECT * FROM stripe_offline_queue WHERE company_id = ? AND status = 'pending' ORDER BY created_at ASC LIMIT 50
  `).all(companyId) as Array<{
    id: string; resource: string; action: string; stripe_id: string | null; params: string | null; idempotency_key: string; attempts: number;
  }>;

  let drained = 0, failed = 0;
  for (const r of rows) {
    try {
      const params = r.params ? JSON.parse(r.params) : {};
      const route = resolveRoute(r.resource, r.action, r.stripe_id ?? undefined);
      const resp = await stripeRequest<StripeObject>({
        apiKey, method: route.method, path: route.path, params,
        idempotencyKey: r.idempotency_key,
        apiVersion: route.apiVersion,
      });
      if (resp?.id) upsertCache(companyId, r.resource, resp);
      db.prepare(`UPDATE stripe_offline_queue SET status = 'done', last_attempt_at = datetime('now'), attempts = attempts + 1 WHERE id = ?`)
        .run(r.id);
      drained++;
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const shouldGiveUp = err?.status && err.status >= 400 && err.status < 500 && err.status !== 429;
      db.prepare(`
        UPDATE stripe_offline_queue
        SET status = ?, last_attempt_at = datetime('now'), attempts = attempts + 1, last_error = ?
        WHERE id = ?
      `).run(shouldGiveUp ? 'failed' : 'pending', msg, r.id);
      failed++;
    }
  }
  return { drained, failed };
}

// ─── The main resolver — online-first, cache-fallback ─────────────────────

export interface CallArgs {
  resource: string;
  action: string;
  id?: string;
  params?: Record<string, unknown>;
  companyId: string;
  idempotencyKey?: string;
}

export interface CallResult<T = unknown> {
  ok: boolean;
  source: 'network' | 'cache' | 'queued';
  data?: T;
  error?: string;
  warning?: string;
}

const READ_ACTIONS = new Set(['list', 'retrieve', 'search']);

export async function stripeCall<T = unknown>(args: CallArgs): Promise<CallResult<T>> {
  const spec = STRIPE_RESOURCES[args.resource];
  if (!spec) return { ok: false, source: 'network', error: `Unknown Stripe resource: ${args.resource}` };

  const route = resolveRoute(args.resource, args.action, args.id);
  const apiKey = getApiKey(args.companyId);

  // No API key configured? Only reads from cache can succeed.
  if (!apiKey) {
    if (READ_ACTIONS.has(args.action)) {
      const data = args.action === 'retrieve' && args.id
        ? readCacheOne(args.companyId, args.resource, args.id)
        : { data: readCache(args.companyId, args.resource), has_more: false };
      return { ok: true, source: 'cache', data: data as T, warning: 'Stripe API key not configured — showing cached data.' };
    }
    return { ok: false, source: 'network', error: 'Stripe API key not configured.' };
  }

  // Try the network.
  try {
    const resp = await stripeRequest<any>({
      apiKey, method: route.method, path: route.path, params: args.params ?? {},
      idempotencyKey: args.idempotencyKey,
      apiVersion: route.apiVersion,
    });

    // Populate cache for reads and single-object writes.
    if (resp?.object === 'list' && Array.isArray(resp.data)) {
      for (const obj of resp.data) upsertCache(args.companyId, args.resource, obj);
    } else if (resp?.id) {
      upsertCache(args.companyId, args.resource, resp);
    }
    updateSyncState(args.companyId, args.resource, true);
    return { ok: true, source: 'network', data: resp as T };
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    updateSyncState(args.companyId, args.resource, false, msg);

    // 4xx that's not a rate limit is a real error — don't mask it with cached data.
    const isNetworkOrServerFault = !err?.status || err.status === 429 || err.status >= 500;

    if (READ_ACTIONS.has(args.action) && isNetworkOrServerFault) {
      const data = args.action === 'retrieve' && args.id
        ? readCacheOne(args.companyId, args.resource, args.id)
        : { data: readCache(args.companyId, args.resource), has_more: false };
      return { ok: true, source: 'cache', data: data as T, warning: `Using cached data — ${msg}` };
    }

    // Writes while offline → queue for later (only idempotent-by-key operations).
    if (isNetworkOrServerFault) {
      const queueKey = enqueueMutation({
        companyId: args.companyId, resource: args.resource, action: args.action,
        stripeId: args.id, params: args.params,
      });
      return { ok: true, source: 'queued', warning: `Offline — operation queued (${queueKey}). Will retry when online.` };
    }

    return { ok: false, source: 'network', error: msg };
  }
}

export async function stripeSync(companyId: string, resource: string): Promise<{ count: number; drained: number }> {
  const spec = STRIPE_RESOURCES[resource];
  if (!spec) throw new Error(`Unknown resource ${resource}`);
  const apiKey = getApiKey(companyId);
  if (!apiKey) throw new Error('Stripe API key not configured.');
  if (!spec.actions.includes('list')) throw new Error(`Resource ${resource} does not support list.`);

  const list = await stripeListAll<StripeObject>({
    apiKey, path: spec.path, apiVersion: spec.apiVersion, maxPages: 10, limit: 100,
  });
  for (const obj of list) upsertCache(companyId, resource, obj);
  updateSyncState(companyId, resource, true);

  const drain = await drainQueue(companyId);
  return { count: list.length, drained: drain.drained };
}

// ─── IPC wiring ────────────────────────────────────────────────────────────

export function registerStripeIpc(ipcMain: IpcMain): void {
  ipcMain.handle('stripe:call', async (_e, args: CallArgs) => stripeCall(args));

  ipcMain.handle('stripe:listCached', async (_e, args: { resource: string; companyId: string; limit?: number }) => {
    return readCache(args.companyId, args.resource, args.limit ?? 200);
  });

  ipcMain.handle('stripe:retrieveCached', async (_e, args: { resource: string; companyId: string; stripeId: string }) => {
    return readCacheOne(args.companyId, args.resource, args.stripeId);
  });

  ipcMain.handle('stripe:sync', async (_e, args: { resource: string; companyId: string }) => {
    return stripeSync(args.companyId, args.resource);
  });

  ipcMain.handle('stripe:syncState', async (_e, args: { companyId: string }) => {
    return getDb().prepare(`
      SELECT resource, last_synced_at, last_ok_at, last_error
      FROM stripe_sync_state WHERE company_id = ?
    `).all(args.companyId);
  });

  ipcMain.handle('stripe:queueStatus', async (_e, args: { companyId: string }) => {
    return getDb().prepare(`
      SELECT status, COUNT(*) AS count FROM stripe_offline_queue
      WHERE company_id = ? GROUP BY status
    `).all(args.companyId);
  });

  ipcMain.handle('stripe:drainQueue', async (_e, args: { companyId: string }) => drainQueue(args.companyId));

  ipcMain.handle('stripe:resources', async () => ({
    byGroup: resourcesByGroup(),
    all: Object.fromEntries(Object.entries(STRIPE_RESOURCES).map(([k, v]) => [
      k,
      { label: v.label ?? k, group: v.group, actions: v.actions, custom: Object.keys(v.custom ?? {}), preview: !!v.requiresPreview },
    ])),
  }));

  ipcMain.handle('stripe:testConnection', async (_e, args: { companyId: string }) => {
    const apiKey = getApiKey(args.companyId);
    if (!apiKey) return { ok: false, error: 'No API key configured.' };
    try {
      const account = await stripeRequest<any>({ apiKey, path: '/v1/account' });
      return { ok: true, account: { id: account?.id, business_profile: account?.business_profile, country: account?.country, default_currency: account?.default_currency } };
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  });
}
