# Readability & Understanding Output — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate 221 raw `.toFixed(2)` currency calls, 13 duplicate `STATUS_BADGE` maps, and ~40 scattered date calls; add shared `<Tooltip>`, `<FieldLabel>`, and `<EmptyState>` components; wire tooltips into SummaryBar and key form labels.

**Architecture:** Utility-first — create `src/renderer/lib/format.ts` (three functions: formatCurrency, formatDate, formatStatus), then three shared components (Tooltip, FieldLabel, EmptyState), then mechanically sweep all consumer files. No behavior changes — formatting output only.

**Tech Stack:** TypeScript, React, Tailwind CSS, Lucide icons, existing `block-badge-*` CSS classes from `src/renderer/styles/globals.css`.

---

## Task 1: format.ts — currency, date, status utilities

**Files:**
- Create: `src/renderer/lib/format.ts`

**Step 1: Create the file**

```typescript
// src/renderer/lib/format.ts

// ─── Currency ────────────────────────────────────────────
const _currencyFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCurrency(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (isNaN(n)) return '$0.00';
  return _currencyFmt.format(n);
}

// ─── Date ────────────────────────────────────────────────
const _mediumFmt  = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const _shortFmt   = new Intl.DateTimeFormat('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' });
const _relFmt     = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });

export function formatDate(
  isoString: string | null | undefined,
  opts?: { style?: 'short' | 'medium' | 'relative' }
): string {
  if (!isoString) return '—';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '—';
  const style = opts?.style ?? 'medium';
  if (style === 'short')  return _shortFmt.format(d);
  if (style === 'medium') return _mediumFmt.format(d);
  // relative
  const diffMs  = d.getTime() - Date.now();
  const diffDays = Math.round(diffMs / 86_400_000);
  if (Math.abs(diffDays) < 1)   return 'today';
  if (Math.abs(diffDays) < 30)  return _relFmt.format(diffDays, 'day');
  if (Math.abs(diffDays) < 365) return _relFmt.format(Math.round(diffDays / 30), 'month');
  return _relFmt.format(Math.round(diffDays / 365), 'year');
}

// ─── Status ──────────────────────────────────────────────
const STATUS_MAP: Record<string, { label: string; className: string }> = {
  // Invoices / Bills
  draft:            { label: 'Draft',            className: 'block-badge block-badge-blue' },
  sent:             { label: 'Sent',             className: 'block-badge block-badge-warning' },
  paid:             { label: 'Paid',             className: 'block-badge block-badge-income' },
  overdue:          { label: 'Overdue',          className: 'block-badge block-badge-expense' },
  partial:          { label: 'Partial',          className: 'block-badge block-badge-purple' },
  void:             { label: 'Void',             className: 'block-badge' },
  cancelled:        { label: 'Cancelled',        className: 'block-badge' },
  // Approvals / Rules
  pending:          { label: 'Pending',          className: 'block-badge block-badge-warning' },
  pending_approval: { label: 'Pending Approval', className: 'block-badge block-badge-warning' },
  approved:         { label: 'Approved',         className: 'block-badge block-badge-income' },
  rejected:         { label: 'Rejected',         className: 'block-badge block-badge-expense' },
  // Clients / Vendors
  active:           { label: 'Active',           className: 'block-badge block-badge-income' },
  inactive:         { label: 'Inactive',         className: 'block-badge block-badge-expense' },
  prospect:         { label: 'Prospect',         className: 'block-badge block-badge-blue' },
  // Projects / Budgets
  open:             { label: 'Open',             className: 'block-badge block-badge-blue' },
  closed:           { label: 'Closed',           className: 'block-badge' },
  in_progress:      { label: 'In Progress',      className: 'block-badge block-badge-warning' },
  completed:        { label: 'Completed',        className: 'block-badge block-badge-income' },
};

export function formatStatus(status: string | null | undefined): { label: string; className: string } {
  return STATUS_MAP[status ?? ''] ?? { label: status ?? '—', className: 'block-badge' };
}
```

**Step 2: Build check**
```bash
cd "/Users/rmpgutah/Business Accounting Pro" && npx tsc --noEmit 2>&1 | grep -v "baseUrl\|TS5101" | head -10
```
Expected: no errors.

**Step 3: Commit**
```bash
git add src/renderer/lib/format.ts
git commit -m "feat: formatCurrency, formatDate, formatStatus utilities"
```

---

## Task 2: Tooltip + FieldLabel components

**Files:**
- Create: `src/renderer/components/Tooltip.tsx`
- Create: `src/renderer/components/FieldLabel.tsx`

**Step 1: Create Tooltip.tsx**

```typescript
// src/renderer/components/Tooltip.tsx
import React, { useState } from 'react';

interface Props {
  content: React.ReactNode;
  children: React.ReactNode;
  placement?: 'top' | 'bottom';
}

export const Tooltip: React.FC<Props> = ({ content, children, placement = 'top' }) => {
  const [visible, setVisible] = useState(false);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span
          className={`
            absolute z-50 left-1/2 -translate-x-1/2 w-max max-w-xs
            bg-gray-900 text-white text-xs px-2.5 py-1.5 pointer-events-none
            whitespace-pre-wrap leading-relaxed
            ${placement === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'}
          `}
        >
          {content}
          <span
            className={`
              absolute left-1/2 -translate-x-1/2 border-4 border-transparent
              ${placement === 'top' ? 'top-full border-t-gray-900' : 'bottom-full border-b-gray-900'}
            `}
          />
        </span>
      )}
    </span>
  );
};
```

**Step 2: Create FieldLabel.tsx**

```typescript
// src/renderer/components/FieldLabel.tsx
import React from 'react';
import { HelpCircle } from 'lucide-react';
import { Tooltip } from './Tooltip';

interface Props {
  label: string;
  tooltip?: string;
  required?: boolean;
  htmlFor?: string;
}

export const FieldLabel: React.FC<Props> = ({ label, tooltip, required, htmlFor }) => (
  <label
    htmlFor={htmlFor}
    className="text-xs font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1 mb-1.5"
  >
    {label}
    {required && <span className="text-red-500">*</span>}
    {tooltip && (
      <Tooltip content={tooltip}>
        <HelpCircle size={11} className="text-gray-400 cursor-help" />
      </Tooltip>
    )}
  </label>
);
```

**Step 3: Build check**
```bash
npx tsc --noEmit 2>&1 | grep -v "baseUrl\|TS5101" | head -10
```

**Step 4: Commit**
```bash
git add src/renderer/components/Tooltip.tsx src/renderer/components/FieldLabel.tsx
git commit -m "feat: Tooltip and FieldLabel components"
```

---

## Task 3: EmptyState component

**Files:**
- Create: `src/renderer/components/EmptyState.tsx`

**Step 1: Create the file**

```typescript
// src/renderer/components/EmptyState.tsx
import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface Props {
  icon: LucideIcon;
  message: string;
}

export const EmptyState: React.FC<Props> = ({ icon: Icon, message }) => (
  <div className="empty-state">
    <div className="empty-state-icon">
      <Icon size={24} className="text-text-muted" />
    </div>
    <p className="text-sm font-semibold text-text-secondary mb-1">{message}</p>
  </div>
);
```

**Step 2: Build check + commit**
```bash
npx tsc --noEmit 2>&1 | grep -v "baseUrl\|TS5101" | head -5
git add src/renderer/components/EmptyState.tsx
git commit -m "feat: EmptyState shared component"
```

---

## Task 4: SummaryBar — add tooltip prop + wire formatCurrency

**Files:**
- Modify: `src/renderer/components/SummaryBar.tsx`
- Modify: `src/renderer/modules/invoices/InvoiceList.tsx`
- Modify: `src/renderer/modules/expenses/ExpenseList.tsx`
- Modify: `src/renderer/modules/clients/ClientList.tsx`

**Step 1: Update SummaryBar.tsx**

Replace the entire file:

```typescript
// src/renderer/components/SummaryBar.tsx
import React from 'react';
import { Tooltip } from './Tooltip';

export interface SummaryItem {
  label: string;
  value: string;
  accent?: 'red' | 'orange' | 'green' | 'default';
  tooltip?: string;
}

export const SummaryBar: React.FC<{ items: SummaryItem[] }> = ({ items }) => {
  const accentCls: Record<string, string> = {
    red: 'text-red-600', orange: 'text-orange-600', green: 'text-green-600', default: 'text-gray-900',
  };
  return (
    <div className="flex gap-6 bg-white border-b border-gray-200 px-6 py-2.5 flex-wrap">
      {items.map((item, i) => (
        <div key={i} className="flex flex-col">
          <span className="text-[10px] uppercase tracking-widest font-bold text-gray-400">{item.label}</span>
          {item.tooltip ? (
            <Tooltip content={item.tooltip}>
              <span className={`text-sm font-black cursor-help underline decoration-dotted decoration-gray-300 ${accentCls[item.accent ?? 'default']}`}>
                {item.value}
              </span>
            </Tooltip>
          ) : (
            <span className={`text-sm font-black ${accentCls[item.accent ?? 'default']}`}>{item.value}</span>
          )}
        </div>
      ))}
    </div>
  );
};
```

**Step 2: Update InvoiceList.tsx SummaryBar items**

Read the file. Find the `SummaryBar items={[...]}` block. Add `tooltip` strings and swap raw currency strings for `formatCurrency`:

Import at top of file: `import { formatCurrency } from '../../lib/format';`

Replace the items array:
```tsx
items={[
  { label: 'Outstanding', value: formatCurrency(invoiceSummary.outstanding), accent: 'orange', tooltip: 'Total unpaid invoices not yet overdue' },
  { label: 'Overdue', value: formatCurrency(invoiceSummary.overdue), accent: 'red', tooltip: 'Invoices past their due date with remaining balance' },
  { label: 'Collected This Month', value: formatCurrency(invoiceSummary.collected_month), accent: 'green', tooltip: 'Payments received in the current calendar month' },
]}
```

**Step 3: Update ExpenseList.tsx SummaryBar items**

Import formatCurrency. Replace items:
```tsx
items={[
  { label: 'This Month', value: formatCurrency(expenseSummary.month_total), tooltip: 'Total expenses recorded in the current calendar month' },
  { label: 'Top Category', value: expenseSummary.top_category ?? '—' },
  ...(Number(expenseSummary.over_budget_count) > 0
    ? [{ label: 'Over Budget', value: `${expenseSummary.over_budget_count} categories`, accent: 'red' as const, tooltip: 'Categories where spending this month exceeds the budget line' }]
    : []),
]}
```

**Step 4: Update ClientList.tsx SummaryBar items**

Import formatCurrency. Replace items:
```tsx
items={[
  { label: 'Total Receivables', value: formatCurrency(clientSummary.total_receivables), accent: 'orange', tooltip: 'Sum of all outstanding invoice balances across overdue clients' },
  { label: 'Clients Overdue', value: String(clientSummary.overdue_clients ?? 0), accent: Number(clientSummary.overdue_clients) > 0 ? 'red' as const : 'default' as const, tooltip: 'Number of clients with at least one overdue invoice' },
]}
```

**Step 5: Build check + commit**
```bash
npx tsc --noEmit 2>&1 | grep -v "baseUrl\|TS5101" | head -10
git add src/renderer/components/SummaryBar.tsx src/renderer/modules/invoices/InvoiceList.tsx src/renderer/modules/expenses/ExpenseList.tsx src/renderer/modules/clients/ClientList.tsx
git commit -m "feat: SummaryBar tooltip prop + formatCurrency on summary items"
```

---

## Task 5: Sweep currency + date — Group A (invoices, bills, clients)

**Files:**
- Modify: `src/renderer/modules/invoices/InvoiceList.tsx`
- Modify: `src/renderer/modules/invoices/InvoiceDetail.tsx`
- Modify: `src/renderer/modules/bills/index.tsx`
- Modify: `src/renderer/modules/clients/ClientList.tsx`
- Modify: `src/renderer/modules/clients/ClientDetail.tsx`
- Modify: `src/renderer/components/ContextPanel.tsx`

**For each file:**

1. Add import: `import { formatCurrency, formatDate } from '../../lib/format';` (adjust relative path as needed)
2. Replace every `$${Number(x).toFixed(2)}` → `formatCurrency(x)`
3. Replace every `` `$${(x).toFixed(2)}` `` → `formatCurrency(x)`
4. Replace every `new Date(x).toLocaleDateString()` → `formatDate(x)`
5. Replace every `new Date(x).toLocaleString()` → `formatDate(x)`

**Build check after each file.** Fix errors before moving on.

```bash
npx tsc --noEmit 2>&1 | grep -v "baseUrl\|TS5101" | head -10
```

**Commit:**
```bash
git add src/renderer/modules/invoices/ src/renderer/modules/bills/ src/renderer/modules/clients/ src/renderer/components/ContextPanel.tsx
git commit -m "refactor: formatCurrency + formatDate in invoices, bills, clients"
```

---

## Task 6: Sweep currency + date — Group B (expenses, projects, dashboard, rules)

**Files:**
- Modify: `src/renderer/modules/expenses/ExpenseList.tsx`
- Modify: `src/renderer/modules/projects/ProjectList.tsx`
- Modify: `src/renderer/modules/projects/ProjectDetail.tsx`
- Modify: `src/renderer/modules/dashboard/Dashboard.tsx`
- Modify: `src/renderer/modules/rules/RuleList.tsx`
- Modify: `src/renderer/modules/rules/RuleLog.tsx`
- Modify: `src/renderer/modules/rules/index.tsx`

Same mechanical swap as Task 5. After each file: `npx tsc --noEmit`.

**Commit:**
```bash
git add src/renderer/modules/expenses/ src/renderer/modules/projects/ src/renderer/modules/dashboard/ src/renderer/modules/rules/
git commit -m "refactor: formatCurrency + formatDate in expenses, projects, dashboard, rules"
```

---

## Task 7: Sweep currency + date — Group C (remaining modules)

**Files:**
- Modify: `src/renderer/modules/purchase-orders/index.tsx`
- Modify: `src/renderer/modules/time/TimeEntryList.tsx`
- Modify: `src/renderer/modules/taxes/TaxConfiguration.tsx`
- Modify: `src/renderer/modules/taxes/TaxDashboard.tsx`
- Modify: `src/renderer/modules/kpi/index.tsx`
- Modify: `src/renderer/modules/automations/index.tsx`
- Modify: `src/renderer/modules/payroll/PayStubView.tsx`
- Modify: `src/renderer/modules/forecasting/index.tsx`
- Modify: `src/renderer/modules/reports/APAgingReport.tsx`
- Modify: `src/renderer/modules/reports/GeneralLedger.tsx`
- Modify: `src/renderer/modules/reports/TrialBalance.tsx`
- Modify: `src/renderer/modules/stripe/index.tsx`
- Modify: `src/renderer/modules/multi-company/index.tsx`

Same mechanical swap. Note: `purchase-orders/index.tsx` uses `.toFixed(2)` for internal math calculations — do NOT replace those (e.g., `parseFloat((qty * price).toFixed(2))`). Only replace display-side currency strings.

```bash
npx tsc --noEmit 2>&1 | grep -v "baseUrl\|TS5101" | head -10
git add src/renderer/modules/purchase-orders/ src/renderer/modules/time/ src/renderer/modules/taxes/ src/renderer/modules/kpi/ src/renderer/modules/automations/ src/renderer/modules/payroll/ src/renderer/modules/forecasting/ src/renderer/modules/reports/ src/renderer/modules/stripe/ src/renderer/modules/multi-company/
git commit -m "refactor: formatCurrency + formatDate in remaining modules"
```

---

## Task 8: Sweep STATUS_BADGE → formatStatus

**Files (all 13 with local STATUS_BADGE):**
- `src/renderer/modules/invoices/InvoiceList.tsx`
- `src/renderer/modules/invoices/InvoiceDetail.tsx`
- `src/renderer/modules/bills/index.tsx`
- `src/renderer/modules/clients/ClientList.tsx`
- `src/renderer/modules/clients/ClientDetail.tsx`
- `src/renderer/modules/expenses/ExpenseList.tsx`
- `src/renderer/modules/expenses/VendorList.tsx`
- `src/renderer/modules/projects/ProjectList.tsx`
- `src/renderer/modules/projects/ProjectDetail.tsx`
- `src/renderer/modules/purchase-orders/index.tsx`
- `src/renderer/modules/budgets/BudgetList.tsx`
- `src/renderer/modules/stripe/index.tsx`
- `src/renderer/modules/payroll/EmployeeForm.tsx`

**For each file:**

1. Add to format import: `import { formatStatus } from '../../lib/format';`
2. Delete the local `const STATUS_BADGE = { ... }` block
3. Replace `STATUS_BADGE[x] ?? STATUS_BADGE.draft` → `formatStatus(x)`
4. Replace `STATUS_BADGE[x]` → `formatStatus(x)` (all occurrences)
5. Usage pattern: `const badge = formatStatus(invoice.status);` then `badge.label` and `badge.className` — same as before

**Build check after each file.** Fix TypeScript errors (often the deleted type guard).

```bash
npx tsc --noEmit 2>&1 | grep -v "baseUrl\|TS5101" | head -10
git add src/renderer/modules/
git commit -m "refactor: replace 13 local STATUS_BADGE maps with formatStatus()"
```

---

## Task 9: EmptyState sweep

**Files with ad-hoc empty states (replace with `<EmptyState>`):**
- `src/renderer/modules/invoices/InvoiceList.tsx`
- `src/renderer/modules/expenses/ExpenseList.tsx`
- `src/renderer/modules/clients/ClientList.tsx`
- `src/renderer/modules/clients/ClientDetail.tsx`
- `src/renderer/modules/projects/ProjectList.tsx`
- `src/renderer/modules/time/TimeEntryList.tsx`
- `src/renderer/modules/bills/index.tsx`
- `src/renderer/modules/accounts/AccountsList.tsx`
- `src/renderer/modules/purchase-orders/index.tsx`

**Pattern to find and replace:**

Old:
```tsx
<div className="empty-state">
  <div className="empty-state-icon"><SomeIcon size={...} /></div>
  <p className="text-sm ...">No invoices found</p>
</div>
```

New:
```tsx
import { EmptyState } from '../../components/EmptyState';
// ...
<EmptyState icon={SomeIcon} message="No invoices found" />
```

For files that have plain text empty states without the icon block:
```tsx
// Old:
<div className="text-xs text-gray-400 p-4">No entries yet.</div>
// New:
<EmptyState icon={Clock} message="No time entries yet" />
```

Pick the most contextually appropriate Lucide icon per module:
- Invoices → `FileText`
- Expenses → `Receipt`
- Clients → `Users`
- Projects → `FolderOpen`
- Time entries → `Clock`
- Bills → `FileText`
- Accounts → `BookOpen`
- Purchase Orders → `ShoppingCart`

**Build check + commit:**
```bash
npx tsc --noEmit 2>&1 | grep -v "baseUrl\|TS5101" | head -10
git add src/renderer/modules/
git commit -m "refactor: standardize empty states with <EmptyState> component"
```

---

## Task 10: FieldLabel tooltips in InvoiceForm

**Files:**
- Modify: `src/renderer/modules/invoices/InvoiceForm.tsx`

**Step 1:** Add import
```typescript
import { FieldLabel } from '../../components/FieldLabel';
```

**Step 2:** Replace key `<label>` tags with `<FieldLabel>`. Read the file first — labels have class `text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1.5`. Replace each:

```tsx
// Old:
<label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1.5">
  Client
</label>

// New:
<FieldLabel label="Client" tooltip="The client this invoice will be billed to" htmlFor="client_id" />
```

Tooltip text per field:
- **Client** — "The client this invoice will be billed to"
- **Issue Date** — "The date the invoice is created and sent"
- **Due Date** — "Payment is expected by this date; overdue status triggers after this date"
- **Currency** — "Invoice currency — affects how amounts are displayed on the client portal"
- **Notes** — "Optional notes printed at the bottom of the invoice PDF"
- **Tax Rate** (line item) — "Percentage applied to the line item subtotal"
- **Discount** — "Amount or percentage deducted from the invoice total before tax"

**Step 3: Build check + commit**
```bash
npx tsc --noEmit 2>&1 | grep -v "baseUrl\|TS5101" | head -10
git add src/renderer/modules/invoices/InvoiceForm.tsx
git commit -m "feat: FieldLabel with tooltips in InvoiceForm"
```

---

## Task 11: FieldLabel tooltips in ExpenseForm + RuleForm

**Files:**
- Modify: `src/renderer/modules/expenses/ExpenseForm.tsx`
- Modify: `src/renderer/modules/rules/RuleForm.tsx`

**ExpenseForm — import FieldLabel, replace labels. Tooltip text:**
- **Vendor** — "The supplier or vendor this expense was paid to"
- **Date** — "The date the expense was incurred, not necessarily when paid"
- **Amount** — "Total amount of the expense including any taxes"
- **Category** — "Expense category used for reporting and budget tracking"
- **Account** — "The chart of accounts account this expense is posted to"
- **Description** — "Brief description for your records — appears in expense reports"
- **Receipt** — "Attach a photo or scan of the receipt for audit purposes"

**RuleForm — import FieldLabel, replace labels. Tooltip text:**
- **Rule Name** — "A descriptive name shown in the Rules list and in audit logs"
- **Priority** — "Lower numbers are evaluated first; use 0 for highest priority"
- **Conditions** — "All conditions must match for the rule to fire (AND logic)"
- **Actions** — "What happens when all conditions match"

**Build check + commit:**
```bash
npx tsc --noEmit 2>&1 | grep -v "baseUrl\|TS5101" | head -10
git add src/renderer/modules/expenses/ src/renderer/modules/rules/RuleForm.tsx
git commit -m "feat: FieldLabel with tooltips in ExpenseForm + RuleForm"
```

---

## Final: Full build + push

```bash
cd "/Users/rmpgutah/Business Accounting Pro"
npm run build:main 2>&1 | tail -5
npx tsc --noEmit 2>&1 | grep -v "baseUrl\|TS5101" | head -10
git push origin main
```

Expected: both clean, all commits pushed.
