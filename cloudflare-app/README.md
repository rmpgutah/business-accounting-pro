# BAP Cloud — Cloudflare Workers + D1 backend

The web companion to **Business Accounting Pro** (desktop app). Hosts at
**`accounting.rmpgutah.us`** as its own software system, separate from
**`rmpgutah.us`** (the marketing/main domain) and from the VPS Express server
under `/server`.

## What's in here

| Surface | Status |
| --- | --- |
| Auth (register/login/logout) | ✅ working |
| Dashboard (KPIs + recent activity) | ✅ working |
| Expense capture (mobile-friendly form + receipt upload to R2) | ✅ working |
| Expense / Invoice / Client / Vendor / Mileage listings | ✅ working (table links to detail/edit pages) |
| Client + Vendor full CRUD | ✅ working (new/edit/delete) |
| Mileage full CRUD with project/client + billable | ✅ working |
| Invoice full CRUD with dynamic line items + live totals | ✅ working |
| Client portal (magic-link, invoice viewing, Stripe Checkout) | ✅ working |
| Stripe webhook for `checkout.session.completed` (auto-reconciles payments) | ✅ working |
| Desktop ↔ Cloud sync (push + pull, scoped to an allowlist of tables) | ✅ wire-protocol ready |
| Expense edit page (current is capture-only) | 🟡 next iteration |

The listing pages are the extension points — each one is one `app.get` route
in `src/worker.ts`. Add a corresponding `/app/.../new` and `/app/.../[id]`
to flesh out CRUD for a table without changing the surrounding scaffold.

## One-time setup

You need a Cloudflare account, `wrangler` CLI installed (`npm i -g wrangler`),
and `accounting.rmpgutah.us` already on Cloudflare DNS.

```bash
cd cloudflare-app
npm install

# Authenticate wrangler
wrangler login

# Create the D1 database — copy the printed database_id into wrangler.toml
wrangler d1 create bap_db

# Create the R2 bucket for receipts
wrangler r2 bucket create bap-files

# Create the KV namespace for sessions — copy the id into wrangler.toml
wrangler kv:namespace create SESSIONS

# Edit wrangler.toml and paste the two IDs into the marked fields.

# Apply the schema
npm run db:migrate

# Set the secrets (you'll be prompted for each value)
wrangler secret put JWT_SECRET            # 32+ random bytes; openssl rand -hex 32
wrangler secret put DESKTOP_SYNC_TOKEN    # shared with the desktop app
wrangler secret put STRIPE_SECRET_KEY     # optional, enables portal payments
wrangler secret put STRIPE_WEBHOOK_SECRET # optional, see "Stripe webhook" below

# Deploy
npm run deploy
```

After `npm run deploy`, the Worker is live at every path on
`accounting.rmpgutah.us`. Visit it in a browser — you'll land on the sign-in
page; create an account; you're in.

## Local development

```bash
npm run db:migrate:local   # creates a local SQLite under .wrangler/state
npm run dev                # localhost:8787 with hot reload
```

The dev mode reads `[env.dev.vars]` from `wrangler.toml`; secrets need to be
in a `.dev.vars` file you create (gitignored):

```
JWT_SECRET=dev-secret-not-for-prod
DESKTOP_SYNC_TOKEN=dev-sync-token
```

## Wiring the desktop app to the cloud

The desktop app (Electron) needs two env values to push to the cloud:

```bash
# In the desktop's main process or a settings table:
BAP_CLOUD_URL=https://accounting.rmpgutah.us
BAP_SYNC_TOKEN=<same value you wrangler-secret-put as DESKTOP_SYNC_TOKEN>
```

The desktop's existing sync code (in `/server` and the desktop's main process)
points to the VPS. To repoint to the cloud:

1. Change the upload URL to `https://accounting.rmpgutah.us/api/sync/push`.
2. Set the `x-sync-token` header to `BAP_SYNC_TOKEN`.
3. Batch rows by `(company_id, table)` and POST as:
   ```json
   { "company_id": "...", "table": "expenses", "rows": [ ... ] }
   ```

The Worker upserts via SQLite's `ON CONFLICT(id) DO UPDATE`, so re-sending
the same row is safe.

## Client portal flow

From the desktop:

```bash
curl -X POST https://accounting.rmpgutah.us/api/portal/mint \
  -H "x-sync-token: $BAP_SYNC_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"company_id":"...","client_id":"...","ttl_hours":168}'
```

Response: `{"url":"https://accounting.rmpgutah.us/portal?token=…","expires_at":"…"}`.
Email that URL to the client. They click it → land on the portal index →
see their invoices → optionally pay via Stripe Checkout.

## Stripe webhook (optional)

To reconcile portal payments automatically:

1. In Stripe Dashboard → Webhooks, add an endpoint
   `https://accounting.rmpgutah.us/api/stripe/webhook` listening for
   `checkout.session.completed`.
2. `wrangler secret put STRIPE_WEBHOOK_SECRET` with the signing secret.
3. The handler is wired (`/api/stripe/webhook` in `src/worker.ts`):
   - Verifies the Stripe signature header (HMAC-SHA256, 5-min replay window).
   - On `checkout.session.completed`, inserts a `payments` row and bumps
     `invoices.amount_paid`, flipping status → `paid` or `partial` atomically.
   - Idempotent: a duplicate webhook delivery (same `payment_intent`) is a no-op.

## Architecture notes

- **One Worker, every path** on the subdomain. No CORS to manage because the
  HTML, the JSON API, and the portal share the same origin.
- **D1** for relational data, **R2** for receipt blobs, **KV** for sessions.
  All three are Cloudflare-native and within the free tier for typical
  small-business volume.
- **Auth**: HS256 JWT in an `HttpOnly` cookie. PBKDF2-SHA256 (200k iters) for
  password hashing — Web Crypto only, no Node deps, no WASM.
- **Sync**: pure upsert via desktop-supplied `id`. The Worker NEVER mints IDs
  for synced rows — the desktop is authoritative. The cloud is a mirror plus
  a UI.
- **Tenant isolation**: every API/UI route reads `company_id` from the JWT,
  never from the URL. Sync routes accept `company_id` but force-stamp every
  inserted row with it, so a compromised desktop can't cross tenants.
