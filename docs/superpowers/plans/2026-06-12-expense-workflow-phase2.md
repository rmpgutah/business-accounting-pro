# Expense Workflow Overhaul — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Review inbox (duplicates, anomalies, subscriptions, stale-pending queues), wire dark features into the expense form (auto-categorize suggestion, save-time receipt prompt), and begin the ExpenseForm split — after repairing the broken void mechanism the queues depend on.

**Architecture:** New self-contained section components under `src/renderer/modules/expenses/review/`, each loading its own data and reporting a count to `ExpenseReview` via `onCount`. Backend repair in `expense-wave3-features.ts` switches void to `deleted_at` soft-delete (the `status` CHECK forbids `'void'`) and adds `deleted_at IS NULL` filters to queue-source queries.

**Tech Stack:** React 19 + TS, Electron IPC via `src/renderer/lib/api.ts`, Warm Structured Glass tokens.

**Spec:** `docs/superpowers/specs/2026-06-11-expense-workflow-overhaul-design.md` (Phase 2 scope).

**Verification per task:** `npm run build` exit 0; `bash scripts/ui-leak-check.sh` counts not rising; manual dev-app checks where noted.

**Verified facts this plan relies on:**
- `expenses.status` CHECK allows only `pending/approved/paid` (schema.sql); `expenses.deleted_at` exists via migration (`database/index.ts:1863`); `expenses.tags` is TEXT JSON array default `'[]'`.
- Service return shapes (`expense-wave3-features.ts`): `findDuplicateExpenses` → `id1, id2, amount, date, description, vendor_name`; `vendorAnomalies` → `id, amount, date, description, vendor_name, avg_amt, stddev, z_score`; `detectRecurringPatterns` → `vendor_id, description, avg_amount, occurrences, first_seen, last_seen, avg_days_apart`.
- `api.exVoidExpense(expenseId, reason)`, `api.exFindDuplicates()`, `api.exVendorAnomalies(threshold)`, `api.exDetectRecurring()`, `api.rawQuery`, `api.update`, `api.create` all exist in `api.ts`.
- ExpenseForm creates recurring templates via `api.create('recurring_templates', { company_id, type: 'expense', name, frequency, next_date, is_active: 1, template_data: payload })` (ExpenseForm.tsx ~L1296) — mirror that pattern exactly.
- Form already requires a lost-receipt affidavit when `!receiptPath && amount > IRS_RECEIPT_THRESHOLD` (=75). The new prompt covers the $25–$75 band.

---

### Task 1: Backend repair — void via deleted_at + queue hygiene filters

**Files:**
- Modify: `src/main/services/expense-wave3-features.ts`
- Modify: `src/main/ipc/index.ts` (only if `ex:void-expense` handler lacks `scheduleAutoBackup()`)

- [ ] **Step 1: Fix `voidExpense`** (~line 252). Replace the UPDATE with:

```ts
export function voidExpense(companyId: string, expenseId: string, reason: string) {
  db.getDb().prepare(`UPDATE expenses SET deleted_at = datetime('now'), notes = COALESCE(notes,'') || '\n[VOIDED] ' || ?, updated_at = datetime('now') WHERE id = ? AND company_id = ?`).run(reason, expenseId, companyId);
  return { voided: true };
}
```
Keep the function's existing return shape if it differs — preserve whatever callers expect (read the current body first).

- [ ] **Step 2: Add `deleted_at` filters.** In the same file, add `AND e.deleted_at IS NULL` (or `AND deleted_at IS NULL` for unaliased queries) to the WHERE clauses of: `detectRecurringPatterns`, `findDuplicateExpenses` (both e1 and e2), `vendorAnomalies` (both the stats subquery and outer select), `expenseAging`, `uncategorizedExpenses`, `missingReceiptsReport`.

- [ ] **Step 3: Add `e.tags` to `vendorAnomalies` SELECT** (needed for dismissal filtering in Task 3).

- [ ] **Step 4: `scheduleAutoBackup` on void.** In `src/main/ipc/index.ts` find the `ex:void-expense` handler (~line 3028). If it doesn't schedule a backup after the mutation, make it do so, following the exact pattern used by neighboring mutating handlers in that file.

- [ ] **Step 5: Build + commit**

Run: `npm run build` → exit 0.
```bash
git add src/main/services/expense-wave3-features.ts src/main/ipc/index.ts
git commit -m "fix(expenses): void via deleted_at (status CHECK forbids 'void') + exclude deleted rows from review queues"
```

---

### Task 2: Review sections — Duplicates + Stale pending

**Files:**
- Create: `src/renderer/modules/expenses/review/DuplicatesSection.tsx`
- Create: `src/renderer/modules/expenses/review/StalePendingSection.tsx`

Both follow the same contract: props `{ onCount: (n: number) => void; onViewExpense?: (id: string) => void }`, self-loading, optimistic row removal, theme tokens only.

- [ ] **Step 1: Create `review/DuplicatesSection.tsx`**

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { Copy, FolderOpen, Trash2 } from 'lucide-react';
import api from '../../../lib/api';
import { formatCurrency, formatDate } from '../../../lib/format';

interface Props {
  onCount: (n: number) => void;
  onViewExpense?: (id: string) => void;
}

interface DupPair {
  id1: string;
  id2: string;
  amount: number;
  date: string;
  description: string | null;
  vendor_name: string | null;
}

const DuplicatesSection: React.FC<Props> = ({ onCount, onViewExpense }) => {
  const [pairs, setPairs] = useState<DupPair[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    api.exFindDuplicates()
      .then((r: any) => setPairs(Array.isArray(r) ? r : []))
      .catch(() => setPairs([]));
  }, []);

  useEffect(() => { onCount(pairs.length); }, [pairs.length, onCount]);

  const voidOne = useCallback(async (pair: DupPair, voidId: string) => {
    const key = `${pair.id1}-${pair.id2}`;
    setBusyKey(key);
    try {
      await api.exVoidExpense(voidId, 'Duplicate (resolved from Review inbox)');
      setPairs((rows) => rows.filter((p) => `${p.id1}-${p.id2}` !== key));
    } finally {
      setBusyKey(null);
    }
  }, []);

  return (
    <div className="block-card p-0 overflow-hidden" style={{ borderRadius: 'var(--app-radius)' }}>
      <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between">
        <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider flex items-center gap-2">
          <Copy size={12} /> Possible Duplicates
        </div>
        <span className="text-xs font-mono font-bold text-text-primary">{pairs.length}</span>
      </div>
      {pairs.length === 0 ? (
        <div className="py-5 text-center text-xs text-text-muted">No suspected duplicate pairs.</div>
      ) : (
        <table className="block-table">
          <thead>
            <tr>
              <th>Date</th><th>Description</th><th>Vendor</th>
              <th className="text-right">Amount</th><th className="text-right">Resolve</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((p) => {
              const key = `${p.id1}-${p.id2}`;
              return (
                <tr key={key}>
                  <td className="font-mono text-text-secondary text-xs">{formatDate(p.date)}</td>
                  <td className="text-text-primary text-xs truncate max-w-[200px]">{p.description || '(no description)'}</td>
                  <td className="text-text-secondary text-xs truncate max-w-[120px]">{p.vendor_name || '-'}</td>
                  <td className="text-right font-mono text-accent-expense text-xs">{formatCurrency(p.amount)} ×2</td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {onViewExpense && (
                        <>
                          <button className="block-btn flex items-center gap-1 text-xs" onClick={() => onViewExpense(p.id1)}>
                            <FolderOpen size={12} /> #1
                          </button>
                          <button className="block-btn flex items-center gap-1 text-xs" onClick={() => onViewExpense(p.id2)}>
                            <FolderOpen size={12} /> #2
                          </button>
                        </>
                      )}
                      <button
                        className="block-btn flex items-center gap-1 text-xs text-accent-expense"
                        disabled={busyKey === key}
                        title="Keep the first, void the second"
                        onClick={() => voidOne(p, p.id2)}
                      >
                        <Trash2 size={12} /> Void dup
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default DuplicatesSection;
```

- [ ] **Step 2: Create `review/StalePendingSection.tsx`**

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { Clock, CheckCircle2, FolderOpen, Trash2 } from 'lucide-react';
import api from '../../../lib/api';
import { useCompanyStore } from '../../../stores/companyStore';
import { formatCurrency, formatDate } from '../../../lib/format';

interface Props {
  onCount: (n: number) => void;
  onViewExpense?: (id: string) => void;
}

interface StaleRow {
  id: string;
  date: string;
  amount: number;
  description: string | null;
  vendor_name: string | null;
}

const StalePendingSection: React.FC<Props> = ({ onCount, onViewExpense }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [rows, setRows] = useState<StaleRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeCompany) return;
    api.rawQuery(
      `SELECT e.id, e.date, e.amount, e.description, v.name AS vendor_name
       FROM expenses e LEFT JOIN vendors v ON v.id = e.vendor_id
       WHERE e.company_id = ? AND e.status = 'pending'
         AND e.date <= date('now', '-7 days') AND e.deleted_at IS NULL
       ORDER BY e.date ASC LIMIT 50`,
      [activeCompany.id]
    )
      .then((r: any) => setRows(Array.isArray(r) ? r : []))
      .catch(() => setRows([]));
  }, [activeCompany]);

  useEffect(() => { onCount(rows.length); }, [rows.length, onCount]);

  const approve = useCallback(async (id: string) => {
    setBusyId(id);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await api.update('expenses', id, { status: 'approved', approved_date: today });
      setRows((rs) => rs.filter((r) => r.id !== id));
    } finally {
      setBusyId(null);
    }
  }, []);

  const voidRow = useCallback(async (id: string) => {
    setBusyId(id);
    try {
      await api.exVoidExpense(id, 'Stale pending (resolved from Review inbox)');
      setRows((rs) => rs.filter((r) => r.id !== id));
    } finally {
      setBusyId(null);
    }
  }, []);

  return (
    <div className="block-card p-0 overflow-hidden" style={{ borderRadius: 'var(--app-radius)' }}>
      <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between">
        <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider flex items-center gap-2">
          <Clock size={12} /> Stale Pending (&gt;7 days)
        </div>
        <span className="text-xs font-mono font-bold text-text-primary">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className="py-5 text-center text-xs text-text-muted">Nothing has been sitting in pending.</div>
      ) : (
        <table className="block-table">
          <thead>
            <tr>
              <th>Date</th><th>Description</th><th>Vendor</th>
              <th className="text-right">Amount</th><th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className="font-mono text-text-secondary text-xs">{formatDate(e.date)}</td>
                <td className="text-text-primary text-xs truncate max-w-[220px]">{e.description || '(no description)'}</td>
                <td className="text-text-secondary text-xs truncate max-w-[120px]">{e.vendor_name || '-'}</td>
                <td className="text-right font-mono text-accent-expense text-xs">{formatCurrency(e.amount)}</td>
                <td className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button className="block-btn flex items-center gap-1 text-xs text-accent-income" disabled={busyId === e.id} onClick={() => approve(e.id)}>
                      <CheckCircle2 size={12} /> Approve
                    </button>
                    <button className="block-btn flex items-center gap-1 text-xs text-accent-expense" disabled={busyId === e.id} onClick={() => voidRow(e.id)}>
                      <Trash2 size={12} /> Void
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
    </div>
  );
};

export default StalePendingSection;
```

- [ ] **Step 3: Build + commit**

```bash
npm run build && bash scripts/ui-leak-check.sh
git add src/renderer/modules/expenses/review/
git commit -m "feat(expenses): Review inbox — duplicates and stale-pending sections"
```

---

### Task 3: Review sections — Vendor anomalies + Subscriptions

**Files:**
- Create: `src/renderer/modules/expenses/review/AnomaliesSection.tsx`
- Create: `src/renderer/modules/expenses/review/SubscriptionsSection.tsx`

- [ ] **Step 1: Create `review/AnomaliesSection.tsx`** — dismissal persists by appending `'anomaly_dismissed'` to the expense's `tags` JSON array; load filters dismissed rows out (requires Task 1's `e.tags` addition).

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, FolderOpen, EyeOff } from 'lucide-react';
import api from '../../../lib/api';
import { formatCurrency, formatDate } from '../../../lib/format';

interface Props {
  onCount: (n: number) => void;
  onViewExpense?: (id: string) => void;
}

interface AnomalyRow {
  id: string;
  amount: number;
  date: string;
  description: string | null;
  vendor_name: string | null;
  avg_amt: number;
  z_score: number;
  tags?: string | null;
}

const DISMISS_TAG = 'anomaly_dismissed';

function parseTags(raw: string | null | undefined): string[] {
  try {
    const t = JSON.parse(raw || '[]');
    return Array.isArray(t) ? t : [];
  } catch {
    return [];
  }
}

const AnomaliesSection: React.FC<Props> = ({ onCount, onViewExpense }) => {
  const [rows, setRows] = useState<AnomalyRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    api.exVendorAnomalies(2)
      .then((r: any) => {
        const list = Array.isArray(r) ? r : [];
        setRows(list.filter((a: AnomalyRow) => !parseTags(a.tags).includes(DISMISS_TAG)));
      })
      .catch(() => setRows([]));
  }, []);

  useEffect(() => { onCount(rows.length); }, [rows.length, onCount]);

  const dismiss = useCallback(async (row: AnomalyRow) => {
    setBusyId(row.id);
    try {
      const tags = parseTags(row.tags);
      tags.push(DISMISS_TAG);
      await api.update('expenses', row.id, { tags: JSON.stringify(tags) });
      setRows((rs) => rs.filter((r) => r.id !== row.id));
    } finally {
      setBusyId(null);
    }
  }, []);

  return (
    <div className="block-card p-0 overflow-hidden" style={{ borderRadius: 'var(--app-radius)' }}>
      <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between">
        <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider flex items-center gap-2">
          <AlertTriangle size={12} /> Vendor Anomalies
        </div>
        <span className="text-xs font-mono font-bold text-text-primary">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <div className="py-5 text-center text-xs text-text-muted">No unusual vendor charges detected.</div>
      ) : (
        <table className="block-table">
          <thead>
            <tr>
              <th>Date</th><th>Vendor</th><th>Description</th>
              <th className="text-right">Amount</th><th className="text-right">Vendor Avg</th>
              <th className="text-right">σ</th><th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td className="font-mono text-text-secondary text-xs">{formatDate(a.date)}</td>
                <td className="text-text-secondary text-xs truncate max-w-[120px]">{a.vendor_name || '-'}</td>
                <td className="text-text-primary text-xs truncate max-w-[180px]">{a.description || '(no description)'}</td>
                <td className="text-right font-mono text-accent-expense text-xs">{formatCurrency(a.amount)}</td>
                <td className="text-right font-mono text-text-muted text-xs">{formatCurrency(a.avg_amt)}</td>
                <td className="text-right font-mono text-accent-warning text-xs">{a.z_score.toFixed(1)}</td>
                <td className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button className="block-btn flex items-center gap-1 text-xs" disabled={busyId === a.id} onClick={() => dismiss(a)}>
                      <EyeOff size={12} /> Dismiss
                    </button>
                    {onViewExpense && (
                      <button className="block-btn flex items-center gap-1 text-xs" onClick={() => onViewExpense(a.id)}>
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
    </div>
  );
};

export default AnomaliesSection;
```

- [ ] **Step 2: Create `review/SubscriptionsSection.tsx`** — one-click recurring template; patterns already covered by an active expense template (matched on name) are filtered out.

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { Repeat, PlusCircle } from 'lucide-react';
import api from '../../../lib/api';
import { useCompanyStore } from '../../../stores/companyStore';
import { formatCurrency, formatDate } from '../../../lib/format';

interface Props {
  onCount: (n: number) => void;
}

interface Pattern {
  vendor_id: string | null;
  description: string | null;
  avg_amount: number;
  occurrences: number;
  first_seen: string;
  last_seen: string;
  avg_days_apart: number;
}

function freqFromDays(d: number): string {
  if (d <= 10) return 'weekly';
  if (d <= 20) return 'biweekly';
  if (d <= 45) return 'monthly';
  if (d <= 135) return 'quarterly';
  return 'annually';
}

function patternName(p: Pattern): string {
  return p.description || `Recurring expense (${p.avg_days_apart}d cycle)`;
}

const SubscriptionsSection: React.FC<Props> = ({ onCount }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    if (!activeCompany) return;
    Promise.all([
      api.exDetectRecurring().catch(() => []),
      api.query('recurring_templates', { company_id: activeCompany.id, type: 'expense' }).catch(() => []),
    ]).then(([pats, tpls]: any[]) => {
      const existing = new Set(
        (Array.isArray(tpls) ? tpls : [])
          .filter((t: any) => t.is_active)
          .map((t: any) => (t.name || '').toLowerCase())
      );
      const list = (Array.isArray(pats) ? pats : []).filter(
        (p: Pattern) => !existing.has(patternName(p).toLowerCase())
      );
      setPatterns(list);
    });
  }, [activeCompany]);

  useEffect(() => { onCount(patterns.length); }, [patterns.length, onCount]);

  const createTemplate = useCallback(async (p: Pattern) => {
    if (!activeCompany) return;
    const key = `${p.vendor_id}-${p.description}`;
    setBusyKey(key);
    try {
      const last = new Date(p.last_seen + 'T00:00:00');
      last.setDate(last.getDate() + Math.max(1, Math.round(p.avg_days_apart)));
      const nextIso = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
      await api.create('recurring_templates', {
        company_id: activeCompany.id,
        type: 'expense',
        name: patternName(p),
        frequency: freqFromDays(p.avg_days_apart),
        next_date: nextIso,
        is_active: 1,
        template_data: { vendor_id: p.vendor_id, description: p.description, amount: p.avg_amount },
      });
      setPatterns((ps) => ps.filter((x) => `${x.vendor_id}-${x.description}` !== key));
    } finally {
      setBusyKey(null);
    }
  }, [activeCompany]);

  return (
    <div className="block-card p-0 overflow-hidden" style={{ borderRadius: 'var(--app-radius)' }}>
      <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between">
        <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider flex items-center gap-2">
          <Repeat size={12} /> Detected Subscriptions
        </div>
        <span className="text-xs font-mono font-bold text-text-primary">{patterns.length}</span>
      </div>
      {patterns.length === 0 ? (
        <div className="py-5 text-center text-xs text-text-muted">No untracked recurring charges detected.</div>
      ) : (
        <table className="block-table">
          <thead>
            <tr>
              <th>Description</th><th className="text-right">Avg Amount</th>
              <th className="text-right">Seen</th><th>Cycle</th><th>Last</th><th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {patterns.map((p) => {
              const key = `${p.vendor_id}-${p.description}`;
              return (
                <tr key={key}>
                  <td className="text-text-primary text-xs truncate max-w-[240px]">{patternName(p)}</td>
                  <td className="text-right font-mono text-accent-expense text-xs">{formatCurrency(p.avg_amount)}</td>
                  <td className="text-right font-mono text-text-secondary text-xs">{p.occurrences}×</td>
                  <td className="text-text-secondary text-xs capitalize">{freqFromDays(p.avg_days_apart)}</td>
                  <td className="font-mono text-text-secondary text-xs">{formatDate(p.last_seen)}</td>
                  <td className="text-right">
                    <button
                      className="block-btn flex items-center gap-1 text-xs ml-auto"
                      disabled={busyKey === key}
                      onClick={() => createTemplate(p)}
                    >
                      <PlusCircle size={12} /> Create template
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default SubscriptionsSection;
```

- [ ] **Step 3: Build + commit**

```bash
npm run build && bash scripts/ui-leak-check.sh
git add src/renderer/modules/expenses/review/
git commit -m "feat(expenses): Review inbox — anomalies and subscriptions sections"
```

---

### Task 4: Wire the four sections into ExpenseReview

**Files:**
- Modify: `src/renderer/modules/expenses/ExpenseReview.tsx`

- [ ] **Step 1: Add imports**

```tsx
import DuplicatesSection from './review/DuplicatesSection';
import StalePendingSection from './review/StalePendingSection';
import AnomaliesSection from './review/AnomaliesSection';
import SubscriptionsSection from './review/SubscriptionsSection';
```

- [ ] **Step 2: Track child counts.** Add state and a stable per-key setter:

```tsx
const [childCounts, setChildCounts] = useState<Record<string, number>>({});
const setChildCount = useCallback((key: string, n: number) => {
  setChildCounts((c) => (c[key] === n ? c : { ...c, [key]: n }));
}, []);
```

- [ ] **Step 3: Update the total.** Replace `const total = missing.length + uncategorized.length;` with:

```tsx
const childTotal = Object.values(childCounts).reduce((s, n) => s + n, 0);
const total = missing.length + uncategorized.length + childTotal;
```
(The existing `onCountsChange` effect already depends on the pieces — update its dependency list to `[missing.length, uncategorized.length, childTotal, onCountsChange]` and its body to report `total`.)

- [ ] **Step 4: Render the sections** after the Uncategorized SectionCard, inside the existing `space-y-5` wrapper:

```tsx
<DuplicatesSection onCount={(n) => setChildCount('dups', n)} onViewExpense={onViewExpense} />
<AnomaliesSection onCount={(n) => setChildCount('anom', n)} onViewExpense={onViewExpense} />
<SubscriptionsSection onCount={(n) => setChildCount('subs', n)} />
<StalePendingSection onCount={(n) => setChildCount('stale', n)} onViewExpense={onViewExpense} />
```

- [ ] **Step 5: Fix the all-clear card.** It currently shows whenever `total === 0`; with self-loading children that's still correct, but the header strip only summarizes missing/uncategorized. Extend the header strip's "Open Items" tile to use the new `total` (it already will, via the variable) — no other strip changes required.

- [ ] **Step 6: Build + leak check + commit**

```bash
npm run build && bash scripts/ui-leak-check.sh
git add src/renderer/modules/expenses/ExpenseReview.tsx
git commit -m "feat(expenses): wire all six queues into the Review inbox"
```

---

### Task 5: Form — auto-categorize suggestion chip

**Files:**
- Modify: `src/renderer/modules/expenses/ExpenseForm.tsx`

- [ ] **Step 1: Add suggestion state + effect.** Near the other form state (after `receiptPath` state ~L434):

```tsx
const [suggestedCategory, setSuggestedCategory] = useState<{ id: string; name: string } | null>(null);
```

Add an effect (after the data-load effects). It runs when the vendor changes and no category is chosen; it suggests the vendor's historically most-used category:

```tsx
useEffect(() => {
  let cancelled = false;
  if (!activeCompany || !form.vendor_id || form.category_id) {
    setSuggestedCategory(null);
    return;
  }
  api.rawQuery(
    `SELECT e.category_id AS id, c.name AS name, COUNT(*) AS uses
     FROM expenses e JOIN categories c ON c.id = e.category_id
     WHERE e.company_id = ? AND e.vendor_id = ? AND e.category_id IS NOT NULL AND e.category_id != ''
       AND e.deleted_at IS NULL
     GROUP BY e.category_id ORDER BY uses DESC LIMIT 1`,
    [activeCompany.id, form.vendor_id]
  ).then((r: any) => {
    if (cancelled) return;
    const row = Array.isArray(r) ? r[0] : null;
    setSuggestedCategory(row?.id ? { id: row.id, name: row.name } : null);
  }).catch(() => {});
  return () => { cancelled = true; };
}, [activeCompany, form.vendor_id, form.category_id]);
```

Adapt the exact state names (`form.vendor_id`, `form.category_id`, the form-update setter) to what ExpenseForm actually uses — read the file first; the names above are from its `form` state object.

- [ ] **Step 2: Render the chip** directly below the category field (find the category `<select>`/picker in the JSX). One-click apply, never auto-applied:

```tsx
{suggestedCategory && (
  <button
    type="button"
    className="flex items-center gap-1 mt-1 px-2 py-1 text-[11px] text-accent-primary border border-border-primary hover:border-accent-primary transition-colors"
    style={{ borderRadius: 'var(--app-radius)' }}
    onClick={() => setForm((f: any) => ({ ...f, category_id: suggestedCategory.id }))}
  >
    <Sparkles size={11} /> Suggested: {suggestedCategory.name}
  </button>
)}
```
Import `Sparkles` from lucide-react if not already imported. Use the form's real setter (`setForm` or equivalent — match the surrounding code).

- [ ] **Step 3: Build + manual check + commit**

`npm run build`; dev app: pick a vendor with history while category empty → chip appears; click applies category and chip disappears (effect clears when `category_id` set).

```bash
git add src/renderer/modules/expenses/ExpenseForm.tsx
git commit -m "feat(expenses): suggested-category chip from vendor history in expense form"
```

---

### Task 6: Form — save-time receipt prompt ($25–$75 band)

**Files:**
- Modify: `src/renderer/modules/expenses/ExpenseForm.tsx`

- [ ] **Step 1: Add the prompt in the save handler.** Locate the validation section of the submit flow (near the `requiresAffidavit` check / `ex:check-policy` call ~L1101–1136). Add, before the save proceeds (constant 25 matches the Review queue threshold):

```tsx
const REVIEW_RECEIPT_THRESHOLD = 25;
// Save-time nudge for the $25–$75 band (≥$75 is already covered by the affidavit requirement)
if (!receiptPath && amountValue >= REVIEW_RECEIPT_THRESHOLD && amountValue <= IRS_RECEIPT_THRESHOLD) {
  const proceed = window.confirm(
    `No receipt attached for a ${formatCurrency(amountValue)} expense.\n\n` +
    'It will appear in the Review inbox until a receipt is attached.\n\n' +
    'Save anyway?'
  );
  if (!proceed) return;
}
```
Place the constant at module scope next to other constants if one exists; reuse the existing `amountValue` variable. If `formatCurrency` isn't imported in the handler scope, it already is at the top of the file (verify).

- [ ] **Step 2: Build + manual check + commit**

`npm run build`; dev app: save a $30 expense without receipt → confirm dialog; Cancel keeps the form open; OK saves.

```bash
git add src/renderer/modules/expenses/ExpenseForm.tsx
git commit -m "feat(expenses): save-time receipt prompt for the \$25–\$75 band"
```

---

### Task 7: ExpenseForm split — conservative move-only extraction

**Files:**
- Create: `src/renderer/modules/expenses/form/formConstants.ts` (and/or `form/formHelpers.ts`)
- Modify: `src/renderer/modules/expenses/ExpenseForm.tsx`

Same hard rules as the Phase 1 ExpenseList split: verbatim moves only, no logic/styling edits, default export and props (`expenseId`, `onBack`, `onSaved`) unchanged, partial extraction acceptable, leave tangled code in place and report it.

- [ ] **Step 1: Extract pure module-scope constants and helper functions.** Read ExpenseForm.tsx's module scope (everything above the component). Move cleanly separable pure constants/types/functions (e.g. option lists, parsing/formatting helpers, the initial-form-state object if it's a plain literal) into `form/formConstants.ts` / `form/formHelpers.ts`, exporting and importing back. Do NOT move anything that closes over component state, and do not move imports from `expense-helpers.ts` (already a shared module).

- [ ] **Step 2: Optionally extract one leaf JSX section** if (and only if) a clean candidate exists: a contiguous JSX block whose only dependencies are ≤8 props (e.g. a read-only summary strip or the affidavit panel). If nothing qualifies, skip and note it.

- [ ] **Step 3: Build + leak check + sanity + commit**

`npm run build && bash scripts/ui-leak-check.sh`; grep that each moved symbol has exactly one definition.

```bash
git add src/renderer/modules/expenses/form/ src/renderer/modules/expenses/ExpenseForm.tsx
git commit -m "refactor(expenses): extract pure helpers from ExpenseForm (move-only)"
```

---

### Task 8: Phase 2 wrap-up

- [ ] **Step 1:** `npm run build && bash scripts/ui-leak-check.sh` — clean, counts flat.
- [ ] **Step 2:** Manual end-to-end pass (dev app): all six Review queues render and resolve; badge tracks the full total after visiting the tab; form shows the suggestion chip and the receipt prompt; voiding a duplicate hides it from the Expenses list (deleted_at) and from all queues.
- [ ] **Step 3:** Push: `git push` (branch already tracks origin; PR #23 updates automatically).

---

## Notes for implementers

- **Void = `deleted_at`** after Task 1. The Phase 1 client-side `status !== 'void'` filter in ExpenseReview.tsx becomes redundant but harmless — leave it.
- **Badge undercount is known/accepted:** the cheap badge SQL in `index.tsx` only counts missing-receipts + uncategorized; `onCountsChange` corrects it to the full six-queue total once the tab is opened. Do not expand the badge SQL in this phase.
- **`recurring_templates.template_data`:** pass the object exactly as ExpenseForm does (`template_data: payload` style) — the db layer handles serialization; mirroring the existing call is the contract.
- **Theme rules** as ever: tokens only, `var(--app-radius)`, `.block-table` framing, no raw hex.
