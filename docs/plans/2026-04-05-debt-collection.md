# Debt Collection Module — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a unified Debt Collection module with receivables/payables tracking, automated escalation pipeline, full litigation toolkit, and analytics dashboard.

**Architecture:** Single lazy-loaded module (`src/renderer/modules/debt-collection/`) with 5 tabs (Receivables, Payables, Pipeline, Legal Toolkit, Analytics) plus a Debt Detail view. Data stored in 8 new SQLite tables. IPC handlers for interest calculations and escalation automation. Integrates with existing Invoicing, Bills, Clients, and Notifications modules.

**Tech Stack:** React 19 + TypeScript, Zustand (existing stores), Tailwind CSS 4, better-sqlite3, Recharts, Lucide icons. Follows existing blocky dark-theme design system (2px border-radius, `block-*` CSS classes).

**Design Doc:** `docs/plans/2026-04-05-debt-collection-design.md`

---

## Task 1: Database Schema

**Files:**
- Modify: `src/main/database/schema.sql` (append before final line)

**Step 1: Add all debt collection tables**

Append these tables to `schema.sql` before the closing line:

```sql
-- ─── Debt Collection ────────────────────────────────────
CREATE TABLE IF NOT EXISTS debts (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  type TEXT NOT NULL CHECK(type IN ('receivable','payable')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','in_collection','legal','settled','written_off','disputed','bankruptcy')),
  debtor_id TEXT,
  debtor_type TEXT DEFAULT 'custom' CHECK(debtor_type IN ('client','vendor','custom')),
  debtor_name TEXT NOT NULL DEFAULT '',
  debtor_email TEXT DEFAULT '',
  debtor_phone TEXT DEFAULT '',
  debtor_address TEXT DEFAULT '',
  source_type TEXT DEFAULT 'manual' CHECK(source_type IN ('invoice','bill','manual')),
  source_id TEXT,
  original_amount REAL NOT NULL DEFAULT 0,
  interest_accrued REAL NOT NULL DEFAULT 0,
  fees_accrued REAL NOT NULL DEFAULT 0,
  payments_made REAL NOT NULL DEFAULT 0,
  balance_due REAL NOT NULL DEFAULT 0,
  interest_rate REAL DEFAULT 0,
  interest_type TEXT DEFAULT 'simple' CHECK(interest_type IN ('simple','compound')),
  interest_start_date TEXT,
  compound_frequency INTEGER DEFAULT 12,
  due_date TEXT,
  delinquent_date TEXT,
  statute_of_limitations_date TEXT,
  statute_years INTEGER,
  jurisdiction TEXT DEFAULT '',
  priority TEXT DEFAULT 'medium' CHECK(priority IN ('low','medium','high','critical')),
  current_stage TEXT DEFAULT 'reminder' CHECK(current_stage IN ('reminder','warning','final_notice','demand_letter','collections_agency','legal_action','judgment','garnishment')),
  assigned_to TEXT DEFAULT '',
  hold INTEGER DEFAULT 0,
  hold_reason TEXT DEFAULT '',
  agency_name TEXT DEFAULT '',
  agency_contact TEXT DEFAULT '',
  agency_reference TEXT DEFAULT '',
  agency_commission_rate REAL DEFAULT 0,
  settlement_amount REAL,
  write_off_reason TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_debts_company_type ON debts(company_id, type);
CREATE INDEX IF NOT EXISTS idx_debts_company_status ON debts(company_id, status);
CREATE INDEX IF NOT EXISTS idx_debts_company_stage ON debts(company_id, current_stage);
CREATE INDEX IF NOT EXISTS idx_debts_debtor ON debts(debtor_id, debtor_type);

CREATE TABLE IF NOT EXISTS debt_contacts (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('debtor','guarantor','attorney','witness','collections_agent','judge','mediator')),
  name TEXT NOT NULL DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  company TEXT DEFAULT '',
  bar_number TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_debt_contacts_debt ON debt_contacts(debt_id);

CREATE TABLE IF NOT EXISTS debt_communications (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('email','phone','letter','in_person','legal_filing','text','fax')),
  direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound')),
  subject TEXT DEFAULT '',
  body TEXT DEFAULT '',
  outcome TEXT DEFAULT '',
  contact_id TEXT REFERENCES debt_contacts(id),
  template_used TEXT DEFAULT '',
  attachments_json TEXT DEFAULT '[]',
  logged_by TEXT DEFAULT '',
  logged_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_debt_comms_debt ON debt_communications(debt_id);

CREATE TABLE IF NOT EXISTS debt_payments (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  amount REAL NOT NULL DEFAULT 0,
  method TEXT DEFAULT 'other' CHECK(method IN ('cash','check','card','wire','ach','garnishment','settlement','other')),
  reference_number TEXT DEFAULT '',
  received_date TEXT NOT NULL,
  applied_to_principal REAL DEFAULT 0,
  applied_to_interest REAL DEFAULT 0,
  applied_to_fees REAL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_debt_payments_debt ON debt_payments(debt_id);

CREATE TABLE IF NOT EXISTS debt_pipeline_stages (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  entered_at TEXT NOT NULL DEFAULT (datetime('now')),
  exited_at TEXT,
  auto_advanced INTEGER DEFAULT 0,
  advanced_by TEXT DEFAULT '',
  notes TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_debt_stages_debt ON debt_pipeline_stages(debt_id);

CREATE TABLE IF NOT EXISTS debt_evidence (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('contract','invoice','communication','payment_record','delivery_proof','signed_agreement','witness_statement','photo','other')),
  title TEXT NOT NULL DEFAULT '',
  description TEXT DEFAULT '',
  file_path TEXT DEFAULT '',
  file_name TEXT DEFAULT '',
  date_of_evidence TEXT,
  court_relevance TEXT DEFAULT 'medium' CHECK(court_relevance IN ('high','medium','low')),
  admitted INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_debt_evidence_debt ON debt_evidence(debt_id);

CREATE TABLE IF NOT EXISTS debt_legal_actions (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK(action_type IN ('demand_letter','small_claims','civil_suit','arbitration','mediation','garnishment_order','lien')),
  filing_date TEXT,
  court_name TEXT DEFAULT '',
  court_address TEXT DEFAULT '',
  case_number TEXT DEFAULT '',
  hearing_date TEXT,
  hearing_time TEXT DEFAULT '',
  judge_name TEXT DEFAULT '',
  status TEXT DEFAULT 'preparing' CHECK(status IN ('preparing','filed','served','hearing_scheduled','in_progress','judgment','appeal','closed')),
  outcome TEXT DEFAULT '',
  judgment_amount REAL,
  judgment_date TEXT,
  attorney_id TEXT REFERENCES debt_contacts(id),
  court_costs REAL DEFAULT 0,
  checklist_json TEXT DEFAULT '[]',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_debt_legal_debt ON debt_legal_actions(debt_id);

CREATE TABLE IF NOT EXISTS debt_automation_rules (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  debt_id TEXT,
  from_stage TEXT NOT NULL,
  to_stage TEXT NOT NULL,
  days_after_entry INTEGER NOT NULL DEFAULT 14,
  condition_json TEXT DEFAULT '{}',
  action TEXT NOT NULL DEFAULT 'advance_stage' CHECK(action IN ('advance_stage','send_template','create_notification','flag_review')),
  template_name TEXT DEFAULT '',
  require_review INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_debt_auto_company ON debt_automation_rules(company_id);

CREATE TABLE IF NOT EXISTS debt_templates (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('reminder','warning','final_notice','demand_letter','custom')),
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  severity TEXT DEFAULT 'formal' CHECK(severity IN ('friendly','formal','final')),
  is_default INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_debt_templates_company ON debt_templates(company_id);
```

**Step 2: Commit**

```bash
git add src/main/database/schema.sql
git commit -m "feat(debt-collection): add database schema for 9 debt tables"
```

---

## Task 2: Module Registration (App.tsx, Sidebar.tsx, format.ts)

**Files:**
- Modify: `src/renderer/App.tsx` — add lazy import + route case + module name
- Modify: `src/renderer/components/layout/Sidebar.tsx` — add nav item to FINANCE section
- Modify: `src/renderer/lib/format.ts` — add debt-specific status mappings

**Step 1: Add lazy import to App.tsx**

After line 44 (`const RulesModule = ...`), add:
```typescript
const DebtCollectionModule = lazy(() => import('./modules/debt-collection'));
```

**Step 2: Add module name to MODULE_NAMES**

Add to the MODULE_NAMES object:
```typescript
'debt-collection': 'Debt Collection',
```

**Step 3: Add route case**

In the `renderModule()` switch, add before `default:`:
```typescript
case 'debt-collection': return <DebtCollectionModule />;
```

**Step 4: Add sidebar nav item**

In `Sidebar.tsx`, add `Scale` to the lucide-react import. Add to the FINANCE section items array after `purchase-orders`:
```typescript
{ id: 'debt-collection', label: 'Debt Collection', icon: Scale },
```

**Step 5: Add debt statuses to format.ts**

Add to the `STATUS_MAP` in `format.ts`:
```typescript
// Debt Collection
in_collection:    { label: 'In Collection',    className: 'block-badge block-badge-warning' },
legal:            { label: 'Legal',            className: 'block-badge block-badge-expense' },
settled:          { label: 'Settled',          className: 'block-badge block-badge-income' },
written_off:      { label: 'Written Off',      className: 'block-badge' },
disputed:         { label: 'Disputed',         className: 'block-badge block-badge-purple' },
bankruptcy:       { label: 'Bankruptcy',       className: 'block-badge block-badge-expense' },
// Debt Pipeline Stages
reminder:         { label: 'Reminder',         className: 'block-badge block-badge-blue' },
warning:          { label: 'Warning',          className: 'block-badge block-badge-warning' },
final_notice:     { label: 'Final Notice',     className: 'block-badge block-badge-expense' },
demand_letter:    { label: 'Demand Letter',    className: 'block-badge block-badge-expense' },
collections_agency: { label: 'Collections',    className: 'block-badge block-badge-purple' },
legal_action:     { label: 'Legal Action',     className: 'block-badge block-badge-expense' },
judgment:         { label: 'Judgment',         className: 'block-badge block-badge-income' },
garnishment:      { label: 'Garnishment',      className: 'block-badge block-badge-warning' },
// Legal Action Status
preparing:        { label: 'Preparing',        className: 'block-badge block-badge-blue' },
filed:            { label: 'Filed',            className: 'block-badge block-badge-warning' },
served:           { label: 'Served',           className: 'block-badge block-badge-warning' },
hearing_scheduled:{ label: 'Hearing Set',      className: 'block-badge block-badge-purple' },
appeal:           { label: 'Appeal',           className: 'block-badge block-badge-expense' },
```

**Step 6: Commit**

```bash
git add src/renderer/App.tsx src/renderer/components/layout/Sidebar.tsx src/renderer/lib/format.ts
git commit -m "feat(debt-collection): register module in router, sidebar, and format utils"
```

---

## Task 3: Module Shell (index.tsx with tab navigation)

**Files:**
- Create: `src/renderer/modules/debt-collection/index.tsx`

**Step 1: Create module index with 5-tab structure**

Follow the exact pattern from `modules/expenses/index.tsx`: TabBtn component, useState for active tab, sub-view state for detail views, callback handlers.

Tabs: `receivables` | `payables` | `pipeline` | `legal` | `analytics`

Icons from lucide-react: `Scale`, `ArrowDownCircle`, `ArrowUpCircle`, `GitBranch`, `Gavel`, `BarChart3`

The module must manage view state for navigating into DebtDetail from any list tab. Use:
- `activeTab` state
- `view` state: `'list' | 'detail' | 'form'`
- `activeDebtId` state
- `listKey` for refresh

Handlers: `handleViewDebt(id)`, `handleNewDebt(type)`, `handleBack()`, `handleSaved()`

**Step 2: Commit**

```bash
git add src/renderer/modules/debt-collection/index.tsx
git commit -m "feat(debt-collection): module shell with 5-tab navigation"
```

---

## Task 4: API Helpers + IPC Handlers

**Files:**
- Modify: `src/renderer/lib/api.ts` — add debt-specific API methods
- Modify: `src/main/ipc/index.ts` — add IPC handlers for debt operations

**Step 1: Add debt API methods to api.ts**

Add a new `// ─── Debt Collection ─────────────────────────` section:

```typescript
// ─── Debt Collection ─────────────────────────
debtStats: (companyId: string): Promise<{
  total_outstanding: number;
  in_collection: number;
  legal_active: number;
  collected_this_month: number;
  writeoffs_ytd: number;
}> => window.electronAPI.invoke('debt:stats', { companyId }),

debtCalculateInterest: (debtId: string): Promise<{ interest: number; total: number }> =>
  window.electronAPI.invoke('debt:calculate-interest', { debtId }),

debtAdvanceStage: (debtId: string, notes?: string): Promise<void> =>
  window.electronAPI.invoke('debt:advance-stage', { debtId, notes }),

debtHoldToggle: (debtId: string, hold: boolean, reason?: string): Promise<void> =>
  window.electronAPI.invoke('debt:hold-toggle', { debtId, hold, reason }),

debtImportOverdueInvoices: (companyId: string, daysThreshold: number): Promise<{ imported: number }> =>
  window.electronAPI.invoke('debt:import-overdue', { companyId, daysThreshold }),

debtGenerateDemandLetter: (debtId: string, templateId: string): Promise<{ html: string }> =>
  window.electronAPI.invoke('debt:generate-demand-letter', { debtId, templateId }),

debtExportBundle: (debtId: string): Promise<{ path?: string; cancelled?: boolean }> =>
  window.electronAPI.invoke('debt:export-bundle', { debtId }),

debtSeedDefaultAutomation: (companyId: string): Promise<void> =>
  window.electronAPI.invoke('debt:seed-automation', { companyId }),

debtSeedDefaultTemplates: (companyId: string): Promise<void> =>
  window.electronAPI.invoke('debt:seed-templates', { companyId }),

debtRunEscalation: (companyId: string): Promise<{ advanced: number; flagged: number }> =>
  window.electronAPI.invoke('debt:run-escalation', { companyId }),

debtAnalytics: (companyId: string, startDate: string, endDate: string): Promise<any> =>
  window.electronAPI.invoke('debt:analytics', { companyId, startDate, endDate }),
```

**Step 2: Add IPC handlers in ipc/index.ts**

Register handlers for each channel listed above. Key logic:

- `debt:stats` — raw SQL aggregation query across debts table
- `debt:calculate-interest` — fetch debt row, compute interest using simple/compound formula, update `interest_accrued` and `balance_due`
- `debt:advance-stage` — determine next stage from ordered array, insert `debt_pipeline_stages` row, update `debts.current_stage`
- `debt:hold-toggle` — update `hold` and `hold_reason` on debt
- `debt:import-overdue` — query invoices WHERE status='overdue' AND days_overdue > threshold AND no existing debt with that source_id, create debt rows
- `debt:generate-demand-letter` — fetch template + debt data, replace merge fields, return HTML
- `debt:export-bundle` — generate comprehensive HTML document, use `saveHTMLAsPDF` (existing service)
- `debt:seed-automation` — insert default automation rules (the 8-stage pipeline config)
- `debt:seed-templates` — insert 3 default demand letter templates (friendly, formal, final)
- `debt:run-escalation` — query debts not on hold, check each against automation rules, auto-advance or flag
- `debt:analytics` — aggregate queries for charts (aging, recovery, velocity)

Interest calculation formulas:
```typescript
// Simple: principal * rate * (days / 365)
// Compound: principal * ((1 + rate/n) ^ (n * years)) - principal
function calculateInterest(principal: number, rate: number, type: string, startDate: string, compoundFreq: number): number {
  const days = Math.max(0, Math.floor((Date.now() - new Date(startDate).getTime()) / 86400000));
  if (type === 'compound') {
    const years = days / 365;
    return principal * Math.pow(1 + rate / compoundFreq, compoundFreq * years) - principal;
  }
  return principal * rate * (days / 365);
}
```

Stage order constant (used by advance logic):
```typescript
const STAGE_ORDER = ['reminder','warning','final_notice','demand_letter','collections_agency','legal_action','judgment','garnishment'];
```

**Step 3: Commit**

```bash
git add src/renderer/lib/api.ts src/main/ipc/index.ts
git commit -m "feat(debt-collection): API helpers and IPC handlers for debt operations"
```

---

## Task 5: Receivables List (DebtList component)

**Files:**
- Create: `src/renderer/modules/debt-collection/DebtList.tsx`

**Step 1: Build the DebtList component**

Follow the exact pattern from `ExpenseList.tsx`:
- Props: `{ type: 'receivable' | 'payable'; onNew: () => void; onView: (id: string) => void; onEdit: (id: string) => void }`
- Load debts via `api.query('debts', { company_id, type })` + stats via `api.debtStats(company_id)`
- SummaryBar at top with 5 stats
- Search input + filter dropdowns (status, stage, priority, date range)
- `block-table` with columns: Debtor | Source | Original | Balance | Age (days) | Stage | Priority | Actions
- Age calculated as: `Math.floor((Date.now() - new Date(row.delinquent_date).getTime()) / 86400000)`
- Priority color: low=green, medium=blue, high=orange, critical=red
- Stage badge using `formatStatus()`
- Row click → `onView(id)`
- Action buttons: View, Edit, Advance Stage (calls `api.debtAdvanceStage`)
- Batch operations: mark as written_off, change priority
- "Import Overdue Invoices" button (only on receivables) — modal with days threshold input
- CSV export via `downloadCSVBlob`

**Step 2: Commit**

```bash
git add src/renderer/modules/debt-collection/DebtList.tsx
git commit -m "feat(debt-collection): receivables/payables list with filters and batch actions"
```

---

## Task 6: Debt Form (Create/Edit)

**Files:**
- Create: `src/renderer/modules/debt-collection/DebtForm.tsx`

**Step 1: Build the DebtForm component**

Props: `{ debtId?: string | null; debtType: 'receivable' | 'payable'; onBack: () => void; onSaved: () => void }`

Form sections (using `block-card` containers with section headers):

**Section 1 — Debtor Information:**
- `debtor_type` select (client | vendor | custom)
- If client/vendor: searchable dropdown populated from `api.query('clients')` or `api.query('vendors')` — auto-fills name, email, phone, address
- If custom: manual text inputs for name, email, phone, address

**Section 2 — Debt Details:**
- `source_type` select + `source_id` (if invoice/bill: dropdown of existing records)
- `original_amount` (number input)
- `due_date`, `delinquent_date` (date inputs)
- `priority` select
- `assigned_to` text input
- `notes` textarea

**Section 3 — Interest Configuration:**
- `interest_rate` (percentage input, e.g. 12 for 12%)
- `interest_type` select (simple | compound)
- `compound_frequency` (if compound — select: 12=monthly, 4=quarterly, 1=annually)
- `interest_start_date` (date, defaults to delinquent_date)

**Section 4 — Legal/Jurisdiction:**
- `jurisdiction` — state dropdown (US states) + freeform option
- `statute_years` — number input
- Auto-calculate `statute_of_limitations_date` from `delinquent_date + statute_years`

Validation using `validateForm` from `lib/validation.ts`: require debtor_name, original_amount > 0, due_date.

On save: `api.create('debts', data)` or `api.update('debts', id, data)`. Auto-set `balance_due = original_amount` on create. Also create initial `debt_pipeline_stages` row for 'reminder' stage.

**Step 2: Commit**

```bash
git add src/renderer/modules/debt-collection/DebtForm.tsx
git commit -m "feat(debt-collection): debt create/edit form with debtor lookup and interest config"
```

---

## Task 7: Debt Detail View

**Files:**
- Create: `src/renderer/modules/debt-collection/DebtDetail.tsx`

**Step 1: Build the DebtDetail component**

Props: `{ debtId: string; onBack: () => void; onEdit: () => void; onRefresh: () => void }`

This is the case-file view. Two-column layout:

**Header bar:**
- Debtor name (large), balance due, current stage badge, priority indicator
- Action buttons row: Log Communication | Record Payment | Advance Stage | Generate Demand Letter | Add Evidence | Write Off
- Hold toggle button (if on hold, show yellow banner with reason)

**Left Column (60%):**

*Debt Info Card:*
- Type, status, source link, original amount, interest accrued, fees, payments made, balance due
- Interest rate + type display
- Due date, delinquent date, age in days

*Interest Calculator Card:*
- Show current accrued interest (call `api.debtCalculateInterest()` on mount)
- "Recalculate" button
- Display formula used and breakdown

*Payment History Table:*
- Load from `api.query('debt_payments', { debt_id })` sorted by received_date desc
- Columns: Date | Amount | Method | Reference | Applied To | Notes

**Right Column (40%):**

*Communication Log Timeline:*
- Load from `api.query('debt_communications', { debt_id })` sorted by logged_at desc
- Timeline-style rendering: icon per type, direction indicator (→ outbound, ← inbound), subject, truncated body, outcome
- Click to expand full body

*Evidence List:*
- Load from `api.query('debt_evidence', { debt_id })` sorted by date_of_evidence
- Cards with: type badge, title, relevance badge, date
- Click to view details

*Legal Actions:*
- Load from `api.query('debt_legal_actions', { debt_id })`
- Each action as a card with: type, status, case number, hearing date, checklist progress bar

*Pipeline History:*
- Load from `api.query('debt_pipeline_stages', { debt_id })` sorted by entered_at
- Visual timeline showing stages traversed with dates and durations

**Step 2: Commit**

```bash
git add src/renderer/modules/debt-collection/DebtDetail.tsx
git commit -m "feat(debt-collection): debt detail case-file view with timeline and payments"
```

---

## Task 8: Communication Logger Modal

**Files:**
- Create: `src/renderer/modules/debt-collection/CommunicationForm.tsx`

**Step 1: Build modal form**

Props: `{ debtId: string; onClose: () => void; onSaved: () => void }`

Modal overlay (same pattern as VendorForm in expenses module) with fields:
- `type` select (email, phone, letter, in_person, legal_filing, text, fax)
- `direction` select (inbound, outbound)
- `subject` text input
- `body` textarea (large, 6 rows)
- `outcome` text input
- `contact_id` select (populated from `debt_contacts` for this debt, or "Other")
- `logged_at` datetime input (defaults to now)

On save: `api.create('debt_communications', data)`

**Step 2: Commit**

```bash
git add src/renderer/modules/debt-collection/CommunicationForm.tsx
git commit -m "feat(debt-collection): communication logger modal"
```

---

## Task 9: Payment Recorder Modal

**Files:**
- Create: `src/renderer/modules/debt-collection/PaymentForm.tsx`

**Step 1: Build payment modal**

Props: `{ debtId: string; balanceDue: number; interestAccrued: number; feesAccrued: number; onClose: () => void; onSaved: () => void }`

Fields:
- `amount` number input (with "Pay Full Balance" quick-fill button)
- `method` select (cash, check, card, wire, ach, garnishment, settlement, other)
- `reference_number` text
- `received_date` date (default today)
- Auto-allocation display: show how payment splits across fees → interest → principal (fees first, then interest, then principal — standard allocation order)
- `notes` textarea

On save:
1. `api.create('debt_payments', data)` with calculated allocation
2. `api.update('debts', debtId, { payments_made: new_total, balance_due: new_balance })` — recalculate balance
3. If `balance_due <= 0`: auto-update debt status to 'settled'

**Step 2: Commit**

```bash
git add src/renderer/modules/debt-collection/PaymentForm.tsx
git commit -m "feat(debt-collection): payment recorder with auto-allocation"
```

---

## Task 10: Pipeline View

**Files:**
- Create: `src/renderer/modules/debt-collection/PipelineView.tsx`

**Step 1: Build stage-column pipeline**

Props: `{ onViewDebt: (id: string) => void }`

Load all debts for company, group by `current_stage`.

Render 8 columns (one per stage) in a horizontally scrollable container:
- Column header: stage label + count badge
- Each card: debtor name, `formatCurrency(balance_due)`, days in stage (from `debt_pipeline_stages` current entry), priority color stripe on left edge
- "Advance" button on each card → calls `api.debtAdvanceStage(id)`
- "Hold" toggle button → calls `api.debtHoldToggle(id, !hold)`
- Cards with `hold=1` show a yellow left border and "HOLD" label
- Click card body → `onViewDebt(id)`

Use `block-card` for each column, `block-card-elevated` for each debt card inside.

Color-code priority: low=`border-green-600`, medium=`border-accent-blue`, high=`border-orange-500`, critical=`border-red-600`

**Step 2: Commit**

```bash
git add src/renderer/modules/debt-collection/PipelineView.tsx
git commit -m "feat(debt-collection): pipeline stage-column view with advance and hold"
```

---

## Task 11: Evidence Builder

**Files:**
- Create: `src/renderer/modules/debt-collection/EvidenceForm.tsx`
- Create: `src/renderer/modules/debt-collection/EvidenceTimeline.tsx`

**Step 1: Build EvidenceForm modal**

Props: `{ debtId: string; evidenceId?: string; onClose: () => void; onSaved: () => void }`

Fields:
- `type` select (contract, invoice, communication, payment_record, delivery_proof, signed_agreement, witness_statement, photo, other)
- `title` text
- `description` textarea
- `date_of_evidence` date
- `court_relevance` select (high, medium, low)
- `file_path` — "Attach File" button using `api.openFileDialog()`, display selected filename
- `notes` textarea

**Step 2: Build EvidenceTimeline component**

Props: `{ debtId: string; onAdd: () => void; onEdit: (id: string) => void }`

Load evidence items sorted by `date_of_evidence`. Render as horizontal timeline:
- Each item is a node on a horizontal line, positioned by date
- Color per type: blue=contract, green=payment_record, orange=communication, red=legal_filing, gray=other
- Hover/click shows detail popover (title, description, relevance badge)
- "Export Timeline" button → generates formatted HTML timeline for court, calls `api.saveToPDF(html, 'Evidence Timeline')`

**Step 3: Commit**

```bash
git add src/renderer/modules/debt-collection/EvidenceForm.tsx src/renderer/modules/debt-collection/EvidenceTimeline.tsx
git commit -m "feat(debt-collection): evidence builder with timeline view"
```

---

## Task 12: Legal Toolkit Tab

**Files:**
- Create: `src/renderer/modules/debt-collection/LegalToolkit.tsx`
- Create: `src/renderer/modules/debt-collection/DemandLetterGenerator.tsx`
- Create: `src/renderer/modules/debt-collection/CourtFilingTracker.tsx`
- Create: `src/renderer/modules/debt-collection/StatuteTracker.tsx`

**Step 1: Build LegalToolkit container**

Sub-tab navigation within the Legal tab: Evidence | Demand Letters | Court Filings | Statute Tracker | Export Bundle

Renders the appropriate sub-component based on selected sub-tab.

If no debt is selected, show a prompt: "Select a debt from Receivables or Payables to use the Legal Toolkit."

Needs a debt selector dropdown at top if accessed from tab directly (lists all debts in legal or in_collection status).

**Step 2: Build DemandLetterGenerator**

Props: `{ debtId: string }`

- Load templates from `api.query('debt_templates', { company_id })`
- Template selector cards (friendly, formal, final)
- Preview pane: show template with merge fields replaced by actual debt data
- Merge field replacement: fetch debt + debtor info, replace `{{field}}` patterns
- "Generate & Log" button: saves the generated letter as a communication record AND as an evidence item, shows success confirmation
- "Save as PDF" button: uses `api.saveToPDF(html, 'Demand Letter')`

**Step 3: Build CourtFilingTracker**

Props: `{ debtId: string }`

- Load legal actions from `api.query('debt_legal_actions', { debt_id: debtId })`
- "New Filing" button → inline form or modal for: action_type, court_name, court_address, case_number, hearing_date, attorney (from debt_contacts)
- Each filing displayed as a card with:
  - Type badge, status badge, case number
  - Hearing date with countdown (days until)
  - Checklist: render `checklist_json` as interactive checkbox list
  - Progress bar: `completedItems / totalItems`
  - "Add Checklist Item" button
- Default checklists auto-populated per action_type (small_claims gets 9 items, etc.)

**Step 4: Build StatuteTracker**

Props: `{ companyId: string }`

- Load all debts with `statute_of_limitations_date` set
- Sort by expiration date (soonest first)
- Each debt shown as a row with:
  - Debtor name, balance, jurisdiction
  - Days remaining (or "EXPIRED" badge)
  - Color indicator: green (>365 days), yellow (180-365), orange (90-180), red (<90), black (expired)
  - Progress bar from delinquent_date to statute_date

**Step 5: Commit**

```bash
git add src/renderer/modules/debt-collection/LegalToolkit.tsx src/renderer/modules/debt-collection/DemandLetterGenerator.tsx src/renderer/modules/debt-collection/CourtFilingTracker.tsx src/renderer/modules/debt-collection/StatuteTracker.tsx
git commit -m "feat(debt-collection): legal toolkit with demand letters, court filings, statute tracker"
```

---

## Task 13: Analytics Tab

**Files:**
- Create: `src/renderer/modules/debt-collection/AnalyticsView.tsx`

**Step 1: Build analytics dashboard**

Props: `{ companyId: string }`

Date range selector (default: current year) at top.

6 chart cards in a 2x3 grid using `block-card`:

1. **Collection Rate Over Time** — `AreaChart` (Recharts): X=month, Y=amount collected. Query: sum `debt_payments.amount` grouped by month.

2. **Aging Breakdown** — `BarChart`: buckets of 0-30, 31-60, 61-90, 91-120, 121-180, 180+ days. Query: count and sum debts by age bucket.

3. **Recovery by Stage** — `BarChart` horizontal: for each stage, count debts that were resolved (settled/written_off) at that stage. Shows where most debts get resolved.

4. **Top Debtors** — `BarChart` horizontal: top 10 debtors by outstanding balance.

5. **Interest Accrued vs Collected** — `BarChart` grouped: compare total interest_accrued vs total payments applied_to_interest per month.

6. **Pipeline Velocity** — stat cards: average days spent in each stage. Query: avg duration from `debt_pipeline_stages` where `exited_at` is not null, grouped by stage.

Use existing color scheme: `--color-accent-income` for positive metrics, `--color-accent-expense` for negative/overdue.

**Step 2: Commit**

```bash
git add src/renderer/modules/debt-collection/AnalyticsView.tsx
git commit -m "feat(debt-collection): analytics dashboard with 6 charts"
```

---

## Task 14: Debt Contacts Manager

**Files:**
- Create: `src/renderer/modules/debt-collection/ContactForm.tsx`
- Create: `src/renderer/modules/debt-collection/ContactList.tsx`

**Step 1: Build ContactList**

Props: `{ debtId: string; onAdd: () => void; onEdit: (id: string) => void }`

Load contacts from `api.query('debt_contacts', { debt_id })`. Render as compact list within DebtDetail right column:
- Role badge, name, email, phone
- Edit/delete buttons per row

**Step 2: Build ContactForm modal**

Props: `{ debtId: string; contactId?: string; onClose: () => void; onSaved: () => void }`

Fields: role (select), name, email, phone, address, company, bar_number (shown only if role=attorney), notes.

**Step 3: Commit**

```bash
git add src/renderer/modules/debt-collection/ContactForm.tsx src/renderer/modules/debt-collection/ContactList.tsx
git commit -m "feat(debt-collection): debt contacts manager"
```

---

## Task 15: Automation Settings & Default Templates Seeding

**Files:**
- Create: `src/renderer/modules/debt-collection/AutomationSettings.tsx`

**Step 1: Build automation settings panel**

Accessible from a "Settings" gear icon in the module header.

Displays the 8-stage escalation pipeline as editable rows:
- From Stage → To Stage | Days | Action | Template | Require Review | Enabled toggle
- Each row editable inline
- "Reset to Defaults" button calls `api.debtSeedDefaultAutomation(companyId)`
- "Seed Default Templates" button calls `api.debtSeedDefaultTemplates(companyId)`

Load from `api.query('debt_automation_rules', { company_id })`.

On first open (no rules exist): auto-call seed methods to populate defaults.

**Step 2: Build default template content in IPC handler**

The `debt:seed-templates` handler inserts 3 templates:

1. **Friendly Reminder** (type=reminder, severity=friendly):
   Subject: "Friendly Reminder — Payment Due for Invoice {{source_id}}"
   Body: Professional but warm reminder about overdue payment, current balance, payment link placeholder.

2. **Formal Warning** (type=warning, severity=formal):
   Subject: "Important Notice — Past Due Balance of {{total_due}}"
   Body: Formal tone, mentions interest accrual, sets 14-day deadline.

3. **Final Demand** (type=demand_letter, severity=final):
   Subject: "Final Demand — Immediate Payment Required"
   Body: Legal language, threatens legal action, demands payment within 10 days, includes company legal name and address.

All templates use merge fields: `{{debtor_name}}`, `{{debtor_address}}`, `{{original_amount}}`, `{{interest_accrued}}`, `{{fees_accrued}}`, `{{total_due}}`, `{{due_date}}`, `{{demand_deadline}}`, `{{days_overdue}}`, `{{company_name}}`, `{{company_address}}`, `{{company_phone}}`, `{{company_email}}`

**Step 3: Commit**

```bash
git add src/renderer/modules/debt-collection/AutomationSettings.tsx src/main/ipc/index.ts
git commit -m "feat(debt-collection): automation settings and default template seeding"
```

---

## Task 16: Document Bundle Export

**Files:**
- Create: `src/renderer/modules/debt-collection/BundleExport.tsx` (or integrate into LegalToolkit)

**Step 1: Build the export bundle IPC handler**

The `debt:export-bundle` handler generates a comprehensive HTML document containing:

1. **Cover Page**: "Debt Collection Case File — [Debtor Name]", company info, date
2. **Table of Contents**: links to each section
3. **Debt Summary**: all debt fields in a formatted table
4. **Payment History**: all `debt_payments` in chronological table
5. **Communication Log**: all `debt_communications` in chronological format with full body text
6. **Evidence Timeline**: all `debt_evidence` items with descriptions, sorted by date
7. **Demand Letters**: all communications where `template_used` is not empty, full body
8. **Interest Calculation Breakdown**: formula used, start date, rate, current accrual
9. **Legal Actions**: all `debt_legal_actions` with status and checklist state

Uses existing `saveHTMLAsPDF(html, title)` service.

Style the HTML with inline CSS for PDF rendering (print-friendly: white background, black text, tables with borders).

**Step 2: Build BundleExport component**

Props: `{ debtId: string }`

"Generate Court Bundle" button → calls `api.debtExportBundle(debtId)` → shows save dialog → success confirmation with file path.

Preview pane: shows what will be included (section list with item counts).

**Step 3: Commit**

```bash
git add src/renderer/modules/debt-collection/BundleExport.tsx src/main/ipc/index.ts
git commit -m "feat(debt-collection): court-ready document bundle PDF export"
```

---

## Task 17: Wire Up Module Index + Integration Points

**Files:**
- Modify: `src/renderer/modules/debt-collection/index.tsx` — wire all sub-components into tabs
- Modify: `src/renderer/modules/invoices/InvoiceDetail.tsx` (if exists) or `InvoiceList.tsx` — add "Send to Collections" action

**Step 1: Complete module index wiring**

Import all components and render them in the correct tabs:
- Tab `receivables` → `<DebtList type="receivable" ... />`
- Tab `payables` → `<DebtList type="payable" ... />`
- Tab `pipeline` → `<PipelineView ... />`
- Tab `legal` → `<LegalToolkit ... />`
- Tab `analytics` → `<AnalyticsView ... />`
- View `detail` → `<DebtDetail ... />`
- View `form` → `<DebtForm ... />`

Modal overlays (rendered at module level, controlled by state):
- `<CommunicationForm />` when logging communication from detail view
- `<PaymentForm />` when recording payment from detail view
- `<EvidenceForm />` when adding evidence from detail view
- `<ContactForm />` when managing contacts from detail view

**Step 2: Add "Send to Collections" to invoice actions**

In the invoicing module, find overdue invoice action buttons and add:
```typescript
<button onClick={() => sendToCollections(invoice.id)} className="block-btn text-xs">
  <Scale size={14} /> Send to Collections
</button>
```

The `sendToCollections` function: navigates to debt-collection module with the invoice ID stored in sessionStorage (`nav:source_invoice`), which DebtForm reads to pre-fill source_type='invoice' and source_id.

**Step 3: Commit**

```bash
git add src/renderer/modules/debt-collection/index.tsx src/renderer/modules/invoices/
git commit -m "feat(debt-collection): wire all components and add invoice integration"
```

---

## Task 18: Final Polish — Keyboard Shortcuts, Quick Create, Context Panel

**Files:**
- Modify: `src/renderer/components/QuickCreate.tsx` — add debt creation shortcut
- Modify: `src/renderer/lib/keyboard-shortcuts.ts` — add debt-collection to MODULE_ORDER

**Step 1: Add to QuickCreate**

Add a new quick-create command:
```typescript
{ id: 'debt', icon: Scale, label: 'New Debt', shortcut: 'dbt', module: 'debt-collection' }
```

**Step 2: Add to keyboard shortcuts MODULE_ORDER**

Add `'debt-collection'` to the MODULE_ORDER array.

**Step 3: Add to export table map in App.tsx**

In the `tableMap` for CSV export, add:
```typescript
'debt-collection': 'debts',
```

**Step 4: Commit**

```bash
git add src/renderer/components/QuickCreate.tsx src/renderer/lib/keyboard-shortcuts.ts src/renderer/App.tsx
git commit -m "feat(debt-collection): quick create, keyboard shortcuts, CSV export"
```

---

## Summary

18 tasks total. Creates ~15 new files, modifies ~6 existing files. Adds 9 database tables, 12 IPC handlers, and a full 5-tab module with detail views, modals, charts, and PDF export.
