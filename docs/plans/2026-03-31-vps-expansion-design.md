# VPS Expansion Design
**Date:** 2026-03-31
**Status:** Approved

## Overview

Expand Business Accounting Pro with four interconnected systems: a real-time sync layer between the desktop app and VPS, a client-facing invoice portal with Stripe payments, a workflow automation engine, and a financial intelligence layer. The desktop SQLite database remains the single source of truth; the VPS hosts a read replica plus all outward-facing services.

---

## Section 1 — Overall Architecture

```
Desktop Electron App (Mac)                VPS: 187.124.243.230
SQLite (primary / source of truth) ──push──▶ Express server (server/)
                                  ◀──push─── SQLite replica (server/data/)
                                             WebSocket server
                                             /portal/:token  Client portal
                                             /api/sync       Sync API
                                             /api/stripe     Payments
                                             cron jobs       Automations
                                             nightly jobs    Intelligence
```

New directories:
- `server/` — VPS Node.js app (Express + SQLite + WebSocket + node-cron)
- `server/portal/` — Client portal React SPA
- `src/main/sync/` — Desktop-side push client + WebSocket receiver + offline queue

---

## Section 2 — Sync System

### Write flow (desktop → VPS)

Every successful `db:create`, `db:update`, `db:delete` fires a non-blocking `syncPush({ table, operation, id, data, companyId, timestamp })`. A FIFO queue backed by a `sync_queue` SQLite table on the desktop drains automatically when connectivity resumes.

```
Desktop write completes
       │
       ▼
syncPush({ table, op, data })
       │
  VPS reachable?
  ├─ yes ──▶ POST /api/sync  ──▶ VPS applies to replica ──▶ 200 OK
  └─ no  ──▶ INSERT INTO sync_queue ──▶ retry on reconnect
```

### Conflict resolution

Desktop is always source of truth. VPS replica is read-only from the desktop's perspective. The only writes that flow VPS → Desktop are Stripe payment confirmations (invoice paid webhooks), handled by a dedicated `handleRemotePayment(invoiceId, stripePaymentId)` function — not the generic sync path.

### Scope

All company-scoped tables are synced. Excluded: `users`, `user_companies`, `sync_queue`. Schema migrations are not synced — the VPS runs its own `CREATE TABLE IF NOT EXISTS` on startup.

### WebSocket reconnection

Desktop sync client uses exponential backoff (1s → 2s → 4s → … → 60s cap). Authentication uses a per-company HMAC token derived from a shared secret stored in Electron's `safeStorage`.

---

## Section 3 — Client Portal

### URL structure

```
https://accounting.rmpgutah.us/portal/:token
```

Each invoice gets a unique 32-byte random hex token stored in an `invoice_tokens` table. No login required — the token is the auth. Tokens expire 90 days after the invoice due date.

### Client view

- Invoice details: line items, totals, due date, company branding
- Payment status badge (Unpaid / Partially Paid / Paid)
- **Pay Now** button → Stripe Checkout (hosted, no card data on your server)
- Download PDF button

### Payment flow

```
Client clicks Pay Now
       │
       ▼
VPS creates Stripe Checkout Session (server-side)
       │
       ▼
Client redirected to stripe.com/pay/...
       │
  Payment succeeds → Stripe POST /api/stripe/webhook (VPS verifies signature)
       │
       ▼
VPS updates replica → WebSocket push to desktop: { type: 'invoice:paid', invoiceId, amount }
       │
       ▼
Desktop records payment in SQLite, updates invoice status
```

### Branding

Portal reads `settings` (company name, logo URL, accent color) from VPS replica.

### Out of scope (v1)

Client accounts/logins, dispute filing, partial payment negotiation, multi-currency.

---

## Section 4 — Workflow Automation

### Rule engine schema

```sql
automation_rules (
  id, name, is_active,
  trigger_type TEXT,   -- 'invoice_overdue' | 'bill_due_soon' | 'payment_received'
                       --   | 'low_balance' | 'expense_threshold' | 'schedule'
  trigger_config TEXT, -- JSON: e.g. { days_overdue: 7 } or { cron: '0 9 * * 1' }
  conditions TEXT,     -- JSON: e.g. [{ field: 'amount', op: '>', value: 500 }]
  actions TEXT,        -- JSON: e.g. [{ type: 'send_email', template: 'overdue_reminder' }]
  last_run_at, run_count
)
```

### Available actions (v1)

| Action | Description |
|---|---|
| `send_email` | Invoice reminder, overdue notice, payment receipt via SMTP |
| `create_notification` | Internal app notification |
| `update_status` | e.g. auto-mark invoice `overdue` when past due date |
| `create_journal_entry` | Recurring accruals triggered on schedule |

### Execution

VPS `node-cron` evaluates all active rules every 15 minutes against replica data. Desktop runs a lighter pass on startup and company-switch for `update_status` actions only.

### UI

New `Automations` sidebar module:
- Rule list with name, trigger type, last run timestamp, active toggle
- Rule editor: trigger picker → condition builder (field / operator / value rows) → action picker
- Run log: last 50 executions per rule with pass/fail status

### Out of scope (v1)

Multi-step branching, external webhooks, approval workflows, custom code actions.

---

## Section 5 — Financial Intelligence

### Anomaly Detection

Nightly VPS cron. Compares each transaction against a 90-day rolling baseline (mean + standard deviation per category). Flags outliers at 2.5σ. Results stored in `financial_anomalies` table, pushed to desktop as notifications.

Examples:
- *"Utilities expense $847 — 3.1× your monthly average"*
- *"No revenue recorded in 8 days — unusual for this period"*

### Cash Flow Prediction

14-day and 30-day forward projection using:
- Confirmed unpaid invoices (expected inflow by due date)
- Confirmed unpaid bills (expected outflow by due date)
- Recurring transaction averages from past 90 days

Displayed as a "Projected" line on the existing dashboard cashflow chart alongside the "Actual" line.

### Spend Analysis

Monthly category-vs-budget variance report, auto-generated on the 1st of each month as a notification summary. New "Spend Analysis" card in Reports showing top 5 over-budget categories with trend arrows.

### Privacy

All intelligence runs on your VPS against your own replica. No third-party ML API calls.

### Out of scope (v1)

Revenue forecasting models, inventory predictions, industry benchmarking, natural language query.

---

## Implementation Sequence

1. `server/` — Express + SQLite + WebSocket foundation
2. `src/main/sync/` — Desktop sync push client + offline queue
3. `server/portal/` — Client portal React SPA + Stripe integration
4. Automation engine (schema + VPS cron + desktop UI)
5. Financial intelligence (anomaly detection + cashflow prediction + spend analysis)
