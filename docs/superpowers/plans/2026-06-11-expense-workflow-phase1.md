# Expense Workflow Overhaul — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Review" action-inbox tab to the Expenses module with two live queues (missing receipts, uncategorized), and split the 1,716-line ExpenseList.tsx into focused files — behavior-preserving.

**Architecture:** New `ExpenseReview.tsx` component consumes existing dark IPC channels (`ex:missing-receipts`, `ex:uncategorized`) as queue sources and pairs each row with a mutation (`api.update('expenses', …)` via generic `db:update`). Tab badge count loads in the module shell. ExpenseList split is a mechanical extraction into a `list/` folder.

**Tech Stack:** React 19 + TypeScript, Electron IPC via `src/renderer/lib/api.ts`, Tailwind with the Warm Structured Glass tokens (no raw hex, `var(--app-radius)`, `.block-table`/`.block-card`/`.block-btn`).

**Spec:** `docs/superpowers/specs/2026-06-11-expense-workflow-overhaul-design.md` (this plan = Phase 1 only; Phases 2–3 get separate plans).

**Verification per task (no renderer test suite exists):**
- `npm run build` → must exit 0.
- `bash scripts/ui-leak-check.sh` → counts must not rise vs. before the task.
- Manual check in dev app where noted.

---

### Task 1: ExpenseReview component — skeleton + missing-receipts queue

**Files:**
- Create: `src/renderer/modules/expenses/ExpenseReview.tsx`

- [ ] **Step 1: Create `ExpenseReview.tsx`**

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { Paperclip, FolderOpen, CheckCircle2, Tag } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency, formatDate } from '../../lib/format';

interface Props {
  onViewExpense?: (id: string) => void;
  onCountsChange?: (total: number) => void;
}

interface MissingReceiptRow {
  id: string;
  date: string;
  amount: number;
  description: string | null;
  vendor_name: string | null;
}

interface UncategorizedRow {
  id: string;
  date: string;
  amount: number;
  description: string | null;
  vendor_id: string | null;
}

const RECEIPT_THRESHOLD = 25;

const SectionCard: React.FC<{ title: string; count: number; children: React.ReactNode }> = ({ title, count, children }) => (
  <div className="block-card p-0 overflow-hidden" style={{ borderRadius: 'var(--app-radius)' }}>
    <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between">
      <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">{title}</div>
      <span className="text-xs font-mono font-bold text-text-primary">{count}</span>
    </div>
    {children}
  </div>
);

const EmptyRow: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex items-center justify-center gap-2 py-5 text-xs text-text-muted">
    <CheckCircle2 size={14} className="text-accent-income" /> {label}
  </div>
);

const ExpenseReview: React.FC<Props> = ({ onViewExpense, onCountsChange }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState<MissingReceiptRow[]>([]);
  const [uncategorized, setUncategorized] = useState<UncategorizedRow[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    try {
      const [miss, uncat, cats] = await Promise.all([
        api.exMissingReceipts(RECEIPT_THRESHOLD).catch(() => []),
        api.exUncategorized().catch(() => []),
        api.query('categories', { company_id: activeCompany.id, type: 'expense' }).catch(() => []),
      ]);
      setMissing(Array.isArray(miss) ? miss : []);
      setUncategorized(Array.isArray(uncat) ? uncat : []);
      setCategories(Array.isArray(cats) ? cats : []);
    } finally {
      setLoading(false);
    }
  }, [activeCompany]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    onCountsChange?.(missing.length + uncategorized.length);
  }, [missing.length, uncategorized.length, onCountsChange]);

  const attachReceipt = useCallback(async (expenseId: string) => {
    const res: any = await api.openFileDialog({
      filters: [{ name: 'Receipts', extensions: ['png', 'jpg', 'jpeg', 'pdf', 'heic', 'webp'] }],
    });
    if (!res?.filePath) return;
    setBusyId(expenseId);
    try {
      await api.update('expenses', expenseId, { receipt_path: res.filePath });
      setMissing((rows) => rows.filter((r) => r.id !== expenseId));
    } finally {
      setBusyId(null);
    }
  }, []);

  const setCategory = useCallback(async (expenseId: string, categoryId: string) => {
    if (!categoryId) return;
    setBusyId(expenseId);
    try {
      await api.update('expenses', expenseId, { category_id: categoryId });
      setUncategorized((rows) => rows.filter((r) => r.id !== expenseId));
    } finally {
      setBusyId(null);
    }
  }, []);

  const total = missing.length + uncategorized.length;

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-text-muted text-sm">Loading review queue...</div>;
  }

  return (
    <div className="space-y-5">
      {/* Header strip */}
      <div className="grid grid-cols-3 gap-4">
        <div className="block-card p-4 text-center" style={{ borderRadius: 'var(--app-radius)' }}>
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Open Items</div>
          <div className={`text-xl font-mono font-bold mt-1 ${total > 0 ? 'text-accent-warning' : 'text-accent-income'}`}>{total}</div>
        </div>
        <div className="block-card p-4 text-center" style={{ borderRadius: 'var(--app-radius)' }}>
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Missing Receipts (≥{formatCurrency(RECEIPT_THRESHOLD)})</div>
          <div className="text-xl font-mono font-bold text-text-primary mt-1">{missing.length}</div>
        </div>
        <div className="block-card p-4 text-center" style={{ borderRadius: 'var(--app-radius)' }}>
          <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Uncategorized</div>
          <div className="text-xl font-mono font-bold text-text-primary mt-1">{uncategorized.length}</div>
        </div>
      </div>

      {total === 0 && (
        <div className="block-card p-8 text-center" style={{ borderRadius: 'var(--app-radius)' }}>
          <CheckCircle2 size={28} className="text-accent-income mx-auto mb-2" />
          <div className="text-sm font-semibold text-text-primary">All clear</div>
          <div className="text-xs text-text-muted mt-1">No expenses need attention right now.</div>
        </div>
      )}

      {/* Missing receipts queue */}
      <SectionCard title="Missing Receipts" count={missing.length}>
        {missing.length === 0 ? (
          <EmptyRow label="Every expense over the threshold has a receipt." />
        ) : (
          <table className="block-table">
            <thead>
              <tr>
                <th>Date</th><th>Description</th><th>Vendor</th>
                <th className="text-right">Amount</th><th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {missing.map((e) => (
                <tr key={e.id}>
                  <td className="font-mono text-text-secondary text-xs">{formatDate(e.date)}</td>
                  <td className="text-text-primary text-xs truncate max-w-[220px]">{e.description || '(no description)'}</td>
                  <td className="text-text-secondary text-xs truncate max-w-[140px]">{e.vendor_name || '-'}</td>
                  <td className="text-right font-mono text-accent-expense text-xs">{formatCurrency(e.amount)}</td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        className="block-btn flex items-center gap-1 text-xs"
                        disabled={busyId === e.id}
                        onClick={() => attachReceipt(e.id)}
                      >
                        <Paperclip size={12} /> Attach
                      </button>
                      {onViewExpense && (
                        <button className="block-btn flex items-center gap-1 text-xs" onClick={() => onViewExpense(e.id)}>
                          <FolderOpen size={12} /> Open
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      {/* Uncategorized queue */}
      <SectionCard title="Uncategorized Expenses" count={uncategorized.length}>
        {uncategorized.length === 0 ? (
          <EmptyRow label="Every expense has a category." />
        ) : (
          <table className="block-table">
            <thead>
              <tr>
                <th>Date</th><th>Description</th>
                <th className="text-right">Amount</th><th>Assign Category</th><th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {uncategorized.map((e) => (
                <tr key={e.id}>
                  <td className="font-mono text-text-secondary text-xs">{formatDate(e.date)}</td>
                  <td className="text-text-primary text-xs truncate max-w-[260px]">{e.description || '(no description)'}</td>
                  <td className="text-right font-mono text-accent-expense text-xs">{formatCurrency(e.amount)}</td>
                  <td>
                    <select
                      className="block-input text-xs py-1"
                      defaultValue=""
                      disabled={busyId === e.id}
                      onChange={(ev) => setCategory(e.id, ev.target.value)}
                    >
                      <option value="" disabled>Pick category…</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </td>
                  <td className="text-right">
                    {onViewExpense && (
                      <button className="block-btn flex items-center gap-1 text-xs" onClick={() => onViewExpense(e.id)}>
                        <Tag size={12} /> Open
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>
    </div>
  );
};

export default ExpenseReview;
```

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: exit 0 (component not yet imported anywhere, but must compile).

- [ ] **Step 3: Leak check**

Run: `bash scripts/ui-leak-check.sh`
Expected: counts unchanged from before this task.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/expenses/ExpenseReview.tsx
git commit -m "feat(expenses): Review inbox component — missing receipts + uncategorized queues"
```

---

### Task 2: Wire the Review tab into the module shell, with badge count

**Files:**
- Modify: `src/renderer/modules/expenses/index.tsx`

- [ ] **Step 1: Add import** (after line 8, with the other component imports)

```tsx
import ExpenseReview from './ExpenseReview';
```

- [ ] **Step 2: Extend the Tab type** (line 23)

```tsx
type Tab = 'dashboard' | 'expenses' | 'review' | 'vendors' | 'approvals' | 'reimbursement' | 'audit' | 'settings' | 'analytics' | 'insights' | 'compliance' | 'upgrades';
```

- [ ] **Step 3: Add badge support to TabBtn** (replace the `TabBtn` component at lines 27–45)

```tsx
const TabBtn: React.FC<{
  active: boolean;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  onClick: () => void;
}> = ({ active, icon, label, badge, onClick }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold transition-colors ${
      active
        ? 'bg-bg-tertiary text-text-primary border-b-2 border-accent-blue'
        : 'text-text-muted hover:text-text-secondary transition-colors'
    }`}
    style={{ borderRadius: 'var(--app-radius) var(--app-radius) 0 0' }}
  >
    {icon}
    {label}
    {badge != null && badge > 0 && (
      <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 bg-bg-tertiary text-accent-warning border border-border-primary" style={{ borderRadius: 'var(--app-radius)' }}>
        {badge}
      </span>
    )}
  </button>
);
```

- [ ] **Step 4: Add review badge state + count loader** (inside `ExpensesModule`, after the dashboard state block around line 60)

```tsx
const [reviewCount, setReviewCount] = useState<number>(0);

// Lightweight badge count (single query, not the full queues)
useEffect(() => {
  if (!activeCompany) return;
  let cancelled = false;
  api.rawQuery(
    `SELECT
       SUM(CASE WHEN (receipt_path IS NULL OR receipt_path = '') AND amount >= 25 THEN 1 ELSE 0 END) +
       SUM(CASE WHEN category_id IS NULL OR category_id = '' THEN 1 ELSE 0 END) AS c
     FROM expenses
     WHERE company_id = ? AND status != 'void' AND (deleted_at IS NULL)`,
    [activeCompany.id]
  ).then((r: any) => {
    if (!cancelled) setReviewCount(Array.isArray(r) ? (r[0]?.c ?? 0) : 0);
  }).catch(() => {});
  return () => { cancelled = true; };
}, [activeCompany, tab, expenseKey]);
```

Note: depends on `tab` and `expenseKey` on purpose, so the badge refreshes after saves and tab switches.

- [ ] **Step 5: Add the tab button** — insert between the "Expenses" TabBtn (ends line 273) and the "Vendors" TabBtn (starts line 274):

```tsx
<TabBtn
  active={tab === 'review'}
  icon={<CheckSquare size={16} />}
  label="Review"
  badge={reviewCount}
  onClick={() => switchTab('review')}
/>
```

(`CheckSquare` is already imported on line 2.)

- [ ] **Step 6: Render the tab** — after the `{tab === 'expenses' && expenseView === 'detail' ...}` block (ends line 660), add:

```tsx
{tab === 'review' && (
  <ExpenseReview
    onViewExpense={(id) => { setTab('expenses'); handleEditExpense(id); }}
    onCountsChange={setReviewCount}
  />
)}
```

- [ ] **Step 7: Build + leak check**

Run: `npm run build && bash scripts/ui-leak-check.sh`
Expected: build exit 0; leak counts unchanged.

- [ ] **Step 8: Manual verification (dev app)**

Run: `npm run dev`
Check: Review tab appears after Expenses with a badge when there are missing-receipt/uncategorized rows; attaching a receipt removes the row and decrements the badge; picking a category removes the row; "Open" jumps to the expense form; empty state shows "All clear".

- [ ] **Step 9: Commit**

```bash
git add src/renderer/modules/expenses/index.tsx
git commit -m "feat(expenses): wire Review inbox tab with badge count"
```

---

### Task 3: Split ExpenseList.tsx into a `list/` folder (behavior-preserving)

**Files:**
- Create: `src/renderer/modules/expenses/list/columns.ts`
- Create: `src/renderer/modules/expenses/list/ExpenseListFilters.tsx`
- Create: `src/renderer/modules/expenses/list/GroupingControls.tsx`
- Modify: `src/renderer/modules/expenses/ExpenseList.tsx` (shrinks; stays the entry point so `index.tsx` import is untouched)

This is a mechanical move-only refactor. Rules: copy code verbatim, convert captured state into props, no logic edits, no styling edits. If a piece resists clean extraction (tangled state), leave it in place rather than rewriting logic.

- [ ] **Step 1: Extract column definitions to `list/columns.ts`**

Move from `ExpenseList.tsx` (around lines 95–146): the `ColKey` type, `ALL_COLS` array, `DEFAULT_VISIBLE_COLS`, and the `expenseDisplayTotal()` helper. Export all four. In `ExpenseList.tsx`, replace them with:

```ts
import { ColKey, ALL_COLS, DEFAULT_VISIBLE_COLS, expenseDisplayTotal } from './list/columns';
```

- [ ] **Step 2: Build check**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 3: Extract the filter bar to `list/ExpenseListFilters.tsx`**

Locate the filter-controls JSX in `ExpenseList.tsx` (the block rendering search input, category select, date from/to, amount min/max, reimbursable toggle — driven by the state at lines ~168–177). Create a component whose props are the filter values plus their setters, copied verbatim:

```tsx
import React from 'react';

export interface ExpenseListFiltersProps {
  search: string; setSearch: (v: string) => void;
  categoryFilter: string; setCategoryFilter: (v: string) => void;
  dateFrom: string; setDateFrom: (v: string) => void;
  dateTo: string; setDateTo: (v: string) => void;
  reimbursableOnly: boolean; setReimbursableOnly: (v: boolean) => void;
  amountMin: string; setAmountMin: (v: string) => void;
  amountMax: string; setAmountMax: (v: string) => void;
  categories: { id: string; name: string }[];
}

const ExpenseListFilters: React.FC<ExpenseListFiltersProps> = (props) => {
  // <paste the existing filter-bar JSX verbatim, replacing direct state refs with props.*>
  return null as any; // replaced by pasted JSX
};

export default ExpenseListFilters;
```

(Adjust the props list to exactly match the state actually referenced by the pasted JSX — add or drop fields as the copied code requires; do not rename anything.)

In `ExpenseList.tsx`, replace the moved JSX with `<ExpenseListFilters …all props… />`.

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 5: Extract grouping controls to `list/GroupingControls.tsx`**

Same procedure for the group-by selector + collapse logic UI (state `groupBy`, `collapsedGroups`, `setGroupBy`, `setCollapsedGroups` at lines ~188–191): move the JSX verbatim into a component taking those four as props; replace in place.

- [ ] **Step 6: Build + leak check + manual verification**

Run: `npm run build && bash scripts/ui-leak-check.sh`
Expected: build exit 0; leak counts unchanged (code was moved, not written).
Manual (dev app): Expenses tab — filters work, grouping works, column picker works, bulk select works, totals match before/after.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/modules/expenses/list/ src/renderer/modules/expenses/ExpenseList.tsx
git commit -m "refactor(expenses): split ExpenseList into list/ components (move-only)"
```

---

### Task 4: Phase 1 wrap-up verification

- [ ] **Step 1: Full build + leak check**

Run: `npm run build && bash scripts/ui-leak-check.sh`
Expected: clean build; leak counts at or below pre-phase baseline.

- [ ] **Step 2: Manual end-to-end pass (dev app)**

1. Dashboard loads. 2. Expenses list: filter/group/bulk unchanged. 3. Review tab: both queues actionable, badge accurate, all-clear state reachable by clearing items. 4. Creating an expense without receipt ≥ $25 makes it appear in Review after save (badge refreshes via `expenseKey` dependency).

- [ ] **Step 3: Commit any fixups, then push**

```bash
git push -u origin claude/relaxed-bassi-7ac568
```

---

## Notes for implementers

- **Generic `db:update` on `expenses` is safe**: `expenses` has `updated_at` and `company_id`; the generic handler scopes by current company and triggers auto-backup. Do not add new IPC handlers in this phase.
- **`ex:missing-receipts` returns `e.* + vendor_name`** — the `MissingReceiptRow` interface intentionally lists only the fields the UI reads.
- **`ex:uncategorized` returns `id, date, amount, description, vendor_id`** — no vendor name; the queue shows description only.
- **Theme rules**: only token classes (`text-accent-*`, `bg-bg-*`, `border-border-*`), radius via `var(--app-radius)`, `.block-table` handles table framing. Never `bg-white`/`text-gray-*`/raw hex.
- Phases 2–3 (remaining queues, form integration, ExpenseForm split, Settings consolidation, IPC dedup, Insights/Analytics merge) are planned separately after this ships.
