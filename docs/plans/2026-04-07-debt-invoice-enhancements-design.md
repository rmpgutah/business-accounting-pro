# Debt Collections & Invoice Enhancements Design

**Date:** 2026-04-07
**Approach:** C — Two parallel tracks with integration bridge
**Scope:** Invoice Customization/Data Entry + Debt Collection (Collector Workflow, Payment Plans, Settlement, FDCPA Compliance, Automation, Risk Scoring) + Invoice→Debt Bridge

---

## Overview

Two parallel tracks:

**Track 1 (Invoice Customization):**
- New invoice-level fields: PO number, job reference, internal notes, late fee config, invoice-level discount
- New line-item fields: per-line discount %, per-line tax rate override
- Client defaults: default payment terms, default late fee %

**Track 2 (Debt Collection Enhancements):**
- Collector assignment + PipelineView collector badges
- Payment plans with installment tracking
- Settlement offers with accept/counter/reject workflow
- FDCPA compliance log (validation notice, disputes, cease & desist, etc.)
- Risk scoring badge (calculated, not stored)
- Auto-stage progression on app launch
- Invoice → Debt bridge (overdue invoice conversion with InvoiceList banner)

---

## Track 1: Invoice Customization & Data Entry

### 1.1 New Invoice-Level Fields

```sql
ALTER TABLE invoices ADD COLUMN po_number TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN job_reference TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN internal_notes TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN late_fee_pct REAL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN late_fee_grace_days INTEGER DEFAULT 0;
ALTER TABLE invoices ADD COLUMN discount_pct REAL DEFAULT 0;
```

### 1.2 New Line-Item Fields

```sql
ALTER TABLE invoice_line_items ADD COLUMN discount_pct REAL DEFAULT 0;
ALTER TABLE invoice_line_items ADD COLUMN tax_rate_override REAL DEFAULT -1;
```

`tax_rate_override = -1` means "use invoice-level rate." Any non-negative value overrides it.

### 1.3 Client Default Fields

```sql
ALTER TABLE clients ADD COLUMN default_payment_terms TEXT DEFAULT '';
ALTER TABLE clients ADD COLUMN default_late_fee_pct REAL DEFAULT 0;
```

### 1.4 UI Changes

**InvoiceForm:**
- New "Settings & References" collapsible section:
  - PO Number (text input)
  - Job / Project Reference (text input)
  - Late Fee % (number input) + Grace Days (number input, inline)
  - Invoice-Level Discount % (number input)
- Notes section splits into two fields:
  - "Client Notes" (existing `notes` field, printed on invoice)
  - "Internal Notes" (`internal_notes`, muted label, never printed)
- Line item rows: add Discount % column (0 by default, shown when > 0 or when column enabled)
- Line item rows: add Tax Override column (blank = use invoice rate)
- When a client is selected: auto-fill `payment_terms` from `default_payment_terms`, `late_fee_pct` from `default_late_fee_pct`

**ClientForm:**
- Add "Default Invoice Settings" subsection:
  - Default Payment Terms (text input, e.g. "Net 30")
  - Default Late Fee % (number input)

**InvoiceDetail / PDF:**
- PO Number shown in invoice header block if set
- Job Reference shown in invoice header block if set
- Internal Notes never rendered in print-templates
- Per-line discounts reflected in line subtotal calculation
- Tax override reflected per line in tax column
- Invoice-level discount shown as a subtotal row: "Discount (X%)"
- Late fee shown as informational line in footer if late_fee_pct > 0

---

## Track 2: Debt Collection Enhancements

### 2.1 Collector Assignment

**New field on `debts`:**
```sql
ALTER TABLE debts ADD COLUMN assigned_collector_id TEXT DEFAULT NULL;
ALTER TABLE debts ADD COLUMN auto_advance_enabled INTEGER DEFAULT 0;
```

**IPC:**
- `debt:assign-collector` — updates `assigned_collector_id` on a debt
- Reuse existing `auth:list-users` for collector dropdown data

**UI:**
- DebtDetail header: "Assigned To" dropdown (lists users by display name)
- DebtList: "Collector" filter dropdown
- PipelineView kanban cards: show collector initials badge (2-letter, colored by user index)

### 2.2 Payment Plans

**New tables:**
```sql
CREATE TABLE IF NOT EXISTS debt_payment_plans (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  installment_amount REAL NOT NULL DEFAULT 0,
  frequency TEXT NOT NULL DEFAULT 'monthly',
  start_date TEXT NOT NULL DEFAULT '',
  total_installments INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS debt_plan_installments (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES debt_payment_plans(id) ON DELETE CASCADE,
  due_date TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  paid INTEGER NOT NULL DEFAULT 0,
  paid_date TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
```

**IPC:**
- `debt:payment-plan-get` — fetch plan + installments for a debt
- `debt:payment-plan-save` — create/update plan, regenerate installments
- `debt:plan-installment-toggle` — mark installment paid/unpaid

**UI (DebtDetail):**
- "Payment Plan" card: set frequency, amount, start date, count
- Auto-generates installment rows on save
- Each installment row: due date, amount, paid checkbox
- Summary line: X of Y installments paid, remaining balance

### 2.3 Settlement Offers

**New table:**
```sql
CREATE TABLE IF NOT EXISTS debt_settlements (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  offer_amount REAL NOT NULL DEFAULT 0,
  offer_pct REAL NOT NULL DEFAULT 0,
  offered_date TEXT NOT NULL DEFAULT '',
  response TEXT NOT NULL DEFAULT 'pending',
  counter_amount REAL DEFAULT 0,
  accepted_date TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
```

**IPC:**
- `debt:settlements-list` — list settlements for a debt
- `debt:settlement-save` — create/update settlement offer
- `debt:settlement-accept` — marks accepted, updates debt status to 'resolved', sets balance to offer_amount

**UI (DebtDetail):**
- "Settlement Offers" card: log a new offer (amount auto-calculates %)
- Offer row: amount, %, date, response badge (Pending / Accepted / Rejected / Countered)
- "Accept & Close" button: resolves debt at settlement amount
- "Counter" button: log counter-offer amount

### 2.4 FDCPA Compliance Log

**New table:**
```sql
CREATE TABLE IF NOT EXISTS debt_compliance_log (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL DEFAULT '',
  event_date TEXT NOT NULL DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
```

Event types: `validation_notice_sent`, `dispute_received`, `cease_desist_received`, `mini_miranda_delivered`, `right_to_cure_sent`, `payment_plan_agreed`, `other`

**IPC:**
- `debt:compliance-list` — list compliance events for a debt
- `debt:compliance-save` — add compliance event

**UI (DebtDetail):**
- "FDCPA Compliance" card: chronological log
- Add event: type dropdown + date + notes
- Each event shows type label, date, notes
- Warning banner if `cease_desist_received` is in log (red, "Communications restricted")

### 2.5 Risk Scoring (Calculated)

No DB storage — calculated at render time.

**Formula (0–100, higher = higher risk):**
- Days delinquent: 0–30 → +10, 31–90 → +20, 91–180 → +30, 180+ → +40
- Balance tier: <$500 → +5, $500–$2k → +10, $2k–$10k → +20, >$10k → +30
- Stage weight: reminder → +5, warning → +10, final_notice → +15, demand_letter → +20, collections_agency → +25, legal_action → +30, judgment/garnishment → +35
- Broken promises: count × 5 pts (capped at 20)
- Cap at 100

**Badges:** 0–30 Low (green), 31–55 Medium (yellow), 56–80 High (orange), 81–100 Critical (red)

**UI:** Badge shown in DebtDetail header and DebtList card (next to aging badge)

### 2.6 Auto-Stage Progression

**New field on `debts`:**
Already added in 2.1: `auto_advance_enabled`

**Logic (runs on app launch in ipc handler):**
- `debt:check-auto-advance` — called once on app ready
- For each debt where `auto_advance_enabled = 1`: check `last_activity_date` (or `updated_at`)
- If days since last activity > configured threshold (default 30), advance stage by one step
- Stage order: reminder → warning → final_notice → demand_letter → collections_agency → legal_action
- Does NOT advance past `legal_action` automatically
- Inserts a communication log entry: "Auto-advanced from X to Y"

**Settings UI:** Automation tab in debt module — global threshold (days), toggle all/individual debts

### 2.7 Invoice → Debt Bridge

**New table:**
```sql
CREATE TABLE IF NOT EXISTS invoice_debt_links (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL,
  debt_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
```

**IPC:**
- `invoice:overdue-candidates` — returns invoices WHERE status IN ('overdue') AND days overdue >= threshold (configurable, default 30)
- `invoice:convert-to-debt` — creates a new debt record from invoice data, inserts into `invoice_debt_links`, updates invoice status to 'in_collections'

**UI (InvoiceList):**
- Banner at top (dismissible per session): "X overdue invoices eligible for debt collection — Review"
- Clicking "Review" opens a modal listing candidates with client name, amount, days overdue
- Each row: "Convert" button — one-click creates debt account pre-filled with client info and invoice amount
- Converted invoices show "In Collections" badge

**UI (InvoiceDetail):**
- If invoice has a linked debt: "View in Debt Collection →" link

**UI (DebtDetail):**
- If debt has a linked invoice: "Source Invoice: INV-XXXX →" link

---

## Database Migrations Summary

```sql
-- Track 1: Invoice customization
ALTER TABLE invoices ADD COLUMN po_number TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN job_reference TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN internal_notes TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN late_fee_pct REAL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN late_fee_grace_days INTEGER DEFAULT 0;
ALTER TABLE invoices ADD COLUMN discount_pct REAL DEFAULT 0;

ALTER TABLE invoice_line_items ADD COLUMN discount_pct REAL DEFAULT 0;
ALTER TABLE invoice_line_items ADD COLUMN tax_rate_override REAL DEFAULT -1;

ALTER TABLE clients ADD COLUMN default_payment_terms TEXT DEFAULT '';
ALTER TABLE clients ADD COLUMN default_late_fee_pct REAL DEFAULT 0;

-- Track 2: Debt enhancements
ALTER TABLE debts ADD COLUMN assigned_collector_id TEXT DEFAULT NULL;
ALTER TABLE debts ADD COLUMN auto_advance_enabled INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS debt_payment_plans (...);
CREATE TABLE IF NOT EXISTS debt_plan_installments (...);
CREATE TABLE IF NOT EXISTS debt_settlements (...);
CREATE TABLE IF NOT EXISTS debt_compliance_log (...);
CREATE TABLE IF NOT EXISTS invoice_debt_links (...);
```

---

## Files to Create / Modify

### New Files
- `src/renderer/modules/debt-collection/PaymentPlanCard.tsx`
- `src/renderer/modules/debt-collection/SettlementCard.tsx`
- `src/renderer/modules/debt-collection/ComplianceLog.tsx`

### Modified Files
- `src/main/database/index.ts` — all migrations above
- `src/main/ipc/index.ts` — new IPC handlers
- `src/renderer/lib/api.ts` — new API methods
- `src/renderer/modules/invoices/InvoiceForm.tsx` — Settings & References section, split notes, line-item discount/tax-override columns, client-default auto-fill
- `src/renderer/modules/invoices/InvoiceDetail.tsx` — PO number, job reference in header; late fee in footer; source debt link
- `src/renderer/modules/invoices/InvoiceList.tsx` — overdue conversion banner + modal
- `src/renderer/lib/print-templates.ts` — PO number, job reference, per-line discounts, tax overrides, invoice-level discount row
- `src/renderer/modules/clients/ClientForm.tsx` — default invoice settings subsection
- `src/renderer/modules/debt-collection/DebtDetail.tsx` — PaymentPlanCard, SettlementCard, ComplianceLog, risk badge, collector dropdown, source invoice link
- `src/renderer/modules/debt-collection/DebtList.tsx` — risk badge, collector filter
- `src/renderer/modules/debt-collection/PipelineView.tsx` — collector initials badge on cards

---

## Implementation Order

### Track 1
1. DB migrations (invoice + line_items + clients columns)
2. InvoiceForm — Settings & References section + split notes
3. InvoiceForm — line-item discount % + tax rate override columns
4. InvoiceForm — client-default auto-fill on client select
5. InvoiceDetail — PO number + job reference in header, late fee footer line
6. print-templates — per-line discounts, tax override, invoice-level discount row, PO/job reference
7. ClientForm — default invoice settings subsection

### Track 2
1. DB migrations (debt columns + 5 new tables)
2. tablesWithoutUpdatedAt / tablesWithoutCompanyId set updates
3. Collector assignment: IPC + DebtDetail dropdown + DebtList filter + PipelineView badge
4. PaymentPlanCard: IPC + UI (plan setup + installment rows)
5. SettlementCard: IPC + UI (offer log + accept/counter/reject)
6. ComplianceLog: IPC + UI (event log + cease-desist warning banner)
7. Risk scoring badge: calculation helper + DebtDetail + DebtList
8. Auto-stage progression: IPC handler + Automation tab settings toggle
9. Invoice→Debt bridge: IPC + InvoiceList banner + convert modal + InvoiceDetail/DebtDetail cross-links
