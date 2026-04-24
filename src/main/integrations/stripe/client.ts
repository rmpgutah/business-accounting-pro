// src/main/integrations/stripe/client.ts
//
// Thin, dependency-free Stripe HTTP client for the Electron main process.
// We deliberately do not use `stripe` (the Node SDK) so we can target ANY
// Stripe API path — including beta/non-SDK resources listed in the
// developer portal (Claimable Sandboxes, Health Alerts, Vault, Money
// Movement v2, etc.) — without waiting for SDK support.
//
// Auth: secret key (sk_live_... or sk_test_...) from the `settings` table
// under key `stripe_api_key`. Per-company override supported.
//
// Body encoding: Stripe's REST API requires `application/x-www-form-urlencoded`
// with bracket notation for nested objects and arrays, e.g.
//   { line_items: [{ price: 'p', quantity: 1 }] }
//     → line_items[0][price]=p&line_items[0][quantity]=1
// `encodeForm` below implements that recursively.

const STRIPE_API = 'https://api.stripe.com';
const DEFAULT_API_VERSION = '2024-12-18.acacia'; // pinned; update deliberately

export type HttpMethod = 'GET' | 'POST' | 'DELETE';

export interface StripeRequestOptions {
  apiKey: string;
  path: string;                      // e.g. '/v1/charges' or '/v1/charges/ch_123'
  method?: HttpMethod;               // default GET
  params?: Record<string, unknown>;  // query for GET/DELETE, form body for POST
  idempotencyKey?: string;           // recommended for POSTs
  stripeAccount?: string;            // Connect: act as connected account
  apiVersion?: string;               // override pinned version
  expand?: string[];                 // convenience: ['data.customer']
}

export interface StripeError {
  type: string;
  code?: string;
  message: string;
  param?: string;
  doc_url?: string;
  request_log_url?: string;
}

export class StripeApiError extends Error {
  readonly status: number;
  readonly stripeError?: StripeError;
  constructor(status: number, message: string, stripeError?: StripeError) {
    super(message);
    this.name = 'StripeApiError';
    this.status = status;
    this.stripeError = stripeError;
  }
}

/**
 * Recursively URL-encode an object using Stripe's bracket convention.
 * Handles strings, numbers, booleans, nested objects, arrays, and null
 * (null becomes empty-string which Stripe treats as "unset"). Skips undefined.
 */
export function encodeForm(data: Record<string, unknown>): string {
  const pairs: string[] = [];

  const append = (key: string, value: unknown) => {
    if (value === undefined) return;
    if (value === null) {
      pairs.push(`${encodeURIComponent(key)}=`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => append(`${key}[${i}]`, v));
      return;
    }
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        append(`${key}[${k}]`, v);
      }
      return;
    }
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  };

  for (const [k, v] of Object.entries(data)) append(k, v);
  return pairs.join('&');
}

/**
 * Perform a single Stripe API request.
 * Retries once on 429 / 5xx with small backoff — keeps it simple for desktop.
 */
export async function stripeRequest<T = unknown>(opts: StripeRequestOptions): Promise<T> {
  if (!opts.apiKey) {
    throw new StripeApiError(0, 'Missing Stripe API key. Configure one in Settings → Stripe.');
  }

  const method = opts.method ?? 'GET';
  const params = { ...(opts.params ?? {}) };
  if (opts.expand && opts.expand.length) {
    params['expand'] = opts.expand;
  }

  let url = `${STRIPE_API}${opts.path}`;
  let body: string | undefined;

  if (method === 'POST') {
    body = encodeForm(params);
  } else if (Object.keys(params).length) {
    url += (url.includes('?') ? '&' : '?') + encodeForm(params);
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.apiKey}`,
    'Stripe-Version': opts.apiVersion ?? DEFAULT_API_VERSION,
  };
  if (method === 'POST') headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  if (opts.stripeAccount) headers['Stripe-Account'] = opts.stripeAccount;

  const doFetch = () => fetch(url, { method, headers, body });

  let resp = await doFetch();
  if ((resp.status === 429 || resp.status >= 500) && method !== 'POST') {
    await new Promise((r) => setTimeout(r, 400));
    resp = await doFetch();
  }

  const text = await resp.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error */ }

  if (!resp.ok) {
    const err: StripeError | undefined = json?.error;
    const message = err?.message || `Stripe ${resp.status} ${resp.statusText}`;
    throw new StripeApiError(resp.status, message, err);
  }

  return json as T;
}

/**
 * Auto-paginate a list endpoint. Stripe returns `{ has_more, data: [...] }`
 * and pages using `starting_after=<last id>`. Caps at `maxPages * limit`
 * items to avoid runaway fetches on accounts with millions of records.
 */
export async function stripeListAll<T extends { id: string }>(
  opts: StripeRequestOptions & { maxPages?: number; limit?: number }
): Promise<T[]> {
  const maxPages = opts.maxPages ?? 20;
  const limit = opts.limit ?? 100;
  const acc: T[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const resp = await stripeRequest<{ data: T[]; has_more: boolean }>({
      ...opts,
      method: 'GET',
      params: { ...(opts.params ?? {}), limit, starting_after: cursor },
    });
    acc.push(...resp.data);
    if (!resp.has_more || resp.data.length === 0) break;
    cursor = resp.data[resp.data.length - 1].id;
  }
  return acc;
}
