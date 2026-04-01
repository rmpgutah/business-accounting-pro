# Rules Engine, Information Placement & Data Creation — Design

**Date:** 2026-04-01
**Status:** Approved

---

## Section 1 — Overall Architecture

### Rules Engine Layout

```
src/main/rules/
  engine.ts          ← evaluateRules(category, context) — single entry point
  conditions.ts      ← condition evaluators (field comparisons, amount ranges, regex, etc.)
  actions.ts         ← action executors (discount, set_tax_rate, flag_approval, notify, etc.)
  index.ts           ← exports + rule CRUD helpers

src/renderer/modules/rules/
  index.tsx          ← Rules module — tabbed by category
  RuleForm.tsx       ← shared create/edit form, adapts fields by category
  RuleList.tsx       ← list with priority ordering, active toggle, run log link
  RuleLog.tsx        ← execution history table (shared component)
```

### Six Rule Categories — Two Evaluation Modes

| Category   | Trigger              | Where called                        |
|------------|----------------------|-------------------------------------|
| Bank       | Manual (Reconcile)   | BankRules (existing, migrated)      |
| Automation | Scheduled cron       | Existing cron (migrated)            |
| Pricing    | On save              | InvoiceForm IPC handler             |
| Tax        | On save              | InvoiceForm + ExpenseForm IPC handler |
| Approval   | On save + scheduled  | IPC handler + cron                  |
| Alert      | Scheduled + on save  | Cron + IPC handler                  |

### New Schema

```sql
CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  category TEXT NOT NULL CHECK(category IN ('bank','automation','pricing','tax','approval','alert')),
  name TEXT NOT NULL,
  priority INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  trigger TEXT NOT NULL CHECK(trigger IN ('on_save','scheduled','manual')),
  conditions TEXT DEFAULT '[]',
  actions TEXT DEFAULT '[]',
  applied_count INTEGER DEFAULT 0,
  last_run_at TEXT,
  last_alerted_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rules_company_category ON rules(company_id, category, is_active);

CREATE TABLE IF NOT EXISTS approval_queue (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  record_type TEXT NOT NULL CHECK(record_type IN ('invoice','expense','bill')),
  record_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_approval_queue_company ON approval_queue(company_id, status);
```

**Conditions and actions are typed JSON arrays:**

```json
// Pricing rule — condition
{ "field": "client_id", "op": "eq", "value": "abc123" }
// Pricing rule — action
{ "type": "discount", "method": "percent", "value": 10 }

// Alert rule — condition
{ "field": "cash_balance", "op": "lt", "value": 5000 }
// Alert rule — action
{ "type": "notify", "message": "Cash balance below $5,000" }
```

---

## Section 2 — Rules Engine (engine.ts)

### Core Contract

```typescript
type RuleContext = {
  category: 'pricing' | 'tax' | 'approval' | 'alert' | 'bank' | 'automation';
  record: Record<string, unknown>;
  company_id: string;
  db: Database;
};

type RuleResult = {
  ruleId: string;
  ruleName: string;
  matched: boolean;
  actions: ActionResult[];
};

function evaluateRules(ctx: RuleContext): RuleResult[]
```

### Condition Operators (conditions.ts)

| Op | Meaning |
|----|---------|
| `eq` / `neq` | equals / not equals |
| `lt` / `lte` / `gt` / `gte` | numeric comparisons |
| `contains` / `starts_with` / `ends_with` | string matching |
| `in` | value in array |
| `regex` | regex test |
| `between` | numeric range — value is `[min, max]` |

Conditions within a rule are **AND** (all must pass). Multiple rules use:
- **First-match-wins** for `pricing`, `tax`, `bank`
- **All-match** for `approval`, `alert`, `automation`

### Action Types (actions.ts)

| Action type | Categories | Effect |
|-------------|------------|--------|
| `discount` | pricing | Reduce invoice/line total by % or fixed $ |
| `markup` | pricing | Increase unit price by % or fixed $ |
| `set_unit_price` | pricing | Override to fixed amount |
| `set_tax_rate` | tax | Override line item `tax_rate` |
| `set_account` | bank | Set transaction `account_id` |
| `flag_approval` | approval | Insert row into `approval_queue` |
| `notify` | alert | Push via `notification:push` IPC channel |
| `send_email` | alert | Use existing email settings |
| `set_description` | bank, automation | Override description field |

### Engine Evaluation Flow

```
1. Load active rules for company + category, ordered by priority ASC
2. For each rule:
   a. Parse conditions JSON
   b. Evaluate all conditions against ctx.record
   c. If all pass → execute actions → log result
   d. If first-match category → stop after first match
3. Return array of RuleResults
4. Caller (IPC handler or cron) applies results to the record
```

### Callsites

```typescript
// InvoiceForm IPC handler (on_save):
const pricingResults = evaluateRules({ category: 'pricing', record: invoice, ... });
const taxResults     = evaluateRules({ category: 'tax', record: invoice, ... });

// Nightly cron:
evaluateRules({ category: 'alert',    record: { cash_balance, ... }, ... });
evaluateRules({ category: 'approval', record: overdueItems,          ... });
```

---

## Section 3 — Rule Types In Detail

### Pricing Rules
- **Trigger:** on_save (InvoiceForm IPC), first-match-wins
- **Conditions:** `client_id`, `client_tag`, `invoice_total`, `line_item_category`, `quantity`, `date_range`
- **Actions:** `discount`, `markup`, `set_unit_price`
- Applied **before** writing invoice to SQLite; saved record has adjusted prices
- `rules_applied` JSON field on invoice records which rules fired (audit trail)

### Tax Rules
- **Trigger:** on_save (InvoiceForm + ExpenseForm IPC), first-match-wins **per line item**
- **Conditions:** `client_state`, `client_country`, `line_item_description` (regex), `expense_category`, `account_code`
- **Actions:** `set_tax_rate` (overrides the line's `tax_rate` field)
- Each line item can match a different tax rule

### Approval Rules
- **Trigger:** on_save + scheduled (all-match)
- **Conditions:** `amount_gt`, `vendor_id`, `expense_category`, `invoice_total_gt`, `client_id`
- **Actions:** `flag_approval` → inserts into `approval_queue`
- Records flagged are saved with `status = 'pending_approval'`, blocked from sent/posted until resolved
- **Approval Queue panel** added to Dashboard — pending items with Approve/Reject buttons

### Alert Rules
- **Trigger:** scheduled nightly + on save for threshold triggers (all-match)
- **Conditions:** `cash_balance_lt`, `invoice_overdue_days_gt`, `expense_category_total_gt`, `account_balance_lt`, `receivables_total_gt`
- **Actions:** `notify`, `send_email`
- **Deduplication:** `last_alerted_at` on rule — re-fires after 7 days by default (configurable)

### Rules UI — Single Module with 6 Tabs

```
Rules
├── Bank          (migrated from BankRules.tsx)
├── Automation    (migrated from automations/index.tsx)
├── Pricing       ← new
├── Tax           ← new
├── Approval      ← new (includes queue panel at top)
└── Alert         ← new
```

`RuleForm.tsx` renders different condition/action fields based on active tab category.
`RuleList.tsx` and `RuleLog.tsx` are shared across all tabs.

---

## Section 4 — Information Placement & Data Creation

### Information Placement

**1. Contextual Sidebar Panels (inline in forms)**
- `InvoiceForm` → client's outstanding balance, last payment date, total invoiced YTD
- `ExpenseForm` → current month spend for selected category vs budget
- `JournalEntryForm` → current account balance next to each account picker
- `BankAccountForm` → last reconciled date + unreconciled transaction count
- Data fetched lazily on record selection — no cost on form open

**2. Dashboard — 3 New Widgets**
- **Approval Queue badge** — count of pending approvals, links to Rules → Approval tab
- **Alert feed** — last 5 fired alert rules with dismiss; merges financial intelligence alerts + alert rules into one feed (replaces static anomalies panel)
- **Rules activity strip** — "3 pricing rules applied today · 1 approval pending · 2 alerts fired this week"

**3. List View Summary Bars**
Pinned summary row at top of each list:
- Invoices → Total outstanding · Total overdue · Collected this month
- Expenses → Total this month · Largest category · Over-budget categories (red)
- Clients → Total receivables · Clients with overdue invoices count

**4. Inline Record Enrichment**
- Client picker (InvoiceForm, ExpenseForm) shows credit limit + current balance in dropdown option
- Account picker (JournalEntryForm, BankRules) shows account code + current balance inline

### Data Creation

**1. Quick-create Command Palette (`Cmd+K`)**
- Floating modal with search input in `App.tsx`
- Global `keydown` listener sets `quickCreateOpen` state
- Supports: Invoice, Expense, Client, Vendor, Employee, Journal Entry, Payment, Bill
- Navigates to relevant form on selection

**2. Clone Record**
- "Duplicate" button on Invoice detail, Expense detail, Bill detail
- Copies all fields into new draft with today's date
- Clears invoice number (auto-generates new), resets status to draft

**3. Create-from Flows**
- **Invoice from time entries** — Projects → Time → "Create Invoice" generates invoice pre-filled with all unbilled time entries for the project (grouped by employee, hours × rate as line items)
- **Expense from recurring template** — Recurring → "Run Now" creates expense/invoice immediately without waiting for schedule

**4. Bulk CSV Import (`ImportWizard`)**
Shared 3-step component (upload → map columns → confirm) added to:
- Clients
- Expenses
- Chart of Accounts
