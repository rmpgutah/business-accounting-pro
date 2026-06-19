# Expense Workflow Overhaul — Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the Expenses module's tail: a unified Settings tab (categories + policies + templates + CC import), Analytics merged into Insights, Audit Log folded into Compliance, and the duplicate bulk-op IPC handlers unified onto one implementation.

**Architecture:** Tab count drops from 12 to 10 (`analytics` and `audit` removed; their content reachable via sub-view toggles inside Insights and Compliance — lazy-rendered so only the active sub-view fetches). New `ExpenseSettings.tsx` wraps the existing ExpenseCategorySettings plus two new thin admin sections (policies, templates) backed by existing `feat:exp-policy:*` / `feat:exp-tpl:*` channels. Dead IPC twins are rewired to forward to the `eu()` service (the only implementation with live callers) — no channel removed.

**Spec:** `docs/superpowers/specs/2026-06-11-expense-workflow-overhaul-design.md` (Phase 3 scope).
**Dropped from scope:** "Duplicate expense" action — already shipped (ExpenseList row `Dup` button via `api.cloneRecord`, ExpenseList.tsx:954-960; ExpenseDetail `Duplicate` button L332). Nothing to build.

**Verification per task:** `npm run build` exit 0; `bash scripts/ui-leak-check.sh` counts not rising; manual dev-app checks at wrap-up.

**Verified facts:**
- `expense_policies` columns: `id, company_id, policy_name, scope, category_id, vendor_id, employee_id, max_per_expense, max_per_day, max_per_month, requires_receipt, requires_approval_over, enforcement('warn'), is_active` (database/index.ts:7398).
- `expense_templates_v2` columns: `id, company_id, user_id, template_name, vendor_id, category_id, project_id, default_amount, description, is_tax_deductible, is_billable, use_count, last_used_at, is_active` (database/index.ts:7442).
- API wrappers exist: `featExpPolicyUpsert(p)`, `featExpPolicyList(opts)`, `featExpTplSave(t)`, `featExpTplList(user_id?)` (api.ts:3001-3013); `api.update(table, id, data)` generic.
- Bulk-op channels: live = `eu:bulk:approval|tag|recategorize` (called from ExpenseUpgradesUI.tsx); dead twins = `feat:expense:bulk-recategorize` (ipc:1642), `feat:exp:bulk-tag` (ipc:2770), `ex:batch-approve`/`ex:batch-reject` (ipc:3025-3026).
- `ExpenseCategorySettings` props `{ onBack: () => void }`, flat stacked-cards layout (263 lines).
- `CreditCardImportModal` props `{ onClose: () => void; onDone: () => void }` (currently opened from ExpenseList).
- `ExpenseAnalytics` is prop-less and self-contained; `ExpenseAuditReport` props `{ onBack: () => void }`.
- Dashboard quick-action "View Analytics" button calls `switchTab('analytics')` (index.tsx ~L370) — must be retargeted.

---

### Task 1: IPC dedup — forward dead twins to the `eu()` implementation

**Files:**
- Modify: `src/main/ipc/index.ts`

No channel is removed (sync server / older callers may invoke them); the four dead handlers become forwards so there is exactly one implementation per operation.

- [ ] **Step 1: Read the four handlers and the `eu()` service signatures.** Confirm payload shapes: `eu().bulkRecategorize(expense_ids, category_id)`, `eu().bulkTag(expense_ids, add, remove)`, `eu().bulkSetApprovalStatus({ expense_ids, status, comment, actor_user_id })`.

- [ ] **Step 2: Rewire each handler body, preserving its external payload contract:**

```ts
// ipc ~1642 — was ie().bulkRecategorizeExpenses(...)
ipcMain.handle('feat:expense:bulk-recategorize', (_e, { expense_ids, category_id }: any) => { const r = eu().bulkRecategorize(expense_ids || [], category_id); scheduleAutoBackup(); return r; });

// ipc ~2770 — was ecm().bulkTagExpenses(...). Old payload used tag_ids; map to eu's add-list.
ipcMain.handle('feat:exp:bulk-tag', (_e, opts: any = {}) => { const r = eu().bulkTag(opts.expense_ids || [], opts.tag_ids || opts.add || [], opts.remove || []); scheduleAutoBackup(); return r; });

// ipc ~3025-3026 — were ex3().batchApprove/batchReject
ipcMain.handle('ex:batch-approve', (_e, { expenseIds, approvedBy }: any) => { const r = eu().bulkSetApprovalStatus({ expense_ids: expenseIds || [], status: 'approved', actor_user_id: approvedBy }); scheduleAutoBackup(); return r; });
ipcMain.handle('ex:batch-reject', (_e, { expenseIds, reason }: any) => { const r = eu().bulkSetApprovalStatus({ expense_ids: expenseIds || [], status: 'rejected', comment: reason }); scheduleAutoBackup(); return r; });
```

Adapt to the file's exact one-liner style and to `eu()`'s real signatures (Step 1) — if `bulkSetApprovalStatus` takes a different shape, match it. Keep `scheduleAutoBackup()` (add if the originals lacked it).

- [ ] **Step 3: Check the orphaned service functions.** If `ie().bulkRecategorizeExpenses`, `ecm().bulkTagExpenses`, `ex3().batchApprove`, `ex3().batchReject` now have zero callers, leave the functions in place (other waves may use them) — just note it in the report. Do NOT delete service code in this task.

- [ ] **Step 4: Build + commit**

```bash
npm run build
git add src/main/ipc/index.ts
git commit -m "refactor(ipc): unify duplicate expense bulk-op handlers onto eu() service"
```

---

### Task 2: Policies + Templates admin sections

**Files:**
- Create: `src/renderer/modules/expenses/settings/PolicyAdmin.tsx`
- Create: `src/renderer/modules/expenses/settings/TemplateAdmin.tsx`

- [ ] **Step 1: Create `settings/PolicyAdmin.tsx`** — list active policies + add/edit form (minimal fields: name, scope-category, max_per_expense, requires_receipt, enforcement).

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Plus, Power } from 'lucide-react';
import api from '../../../lib/api';
import { useCompanyStore } from '../../../stores/companyStore';
import { formatCurrency } from '../../../lib/format';

interface Policy {
  id: string;
  policy_name: string;
  scope: string;
  category_id: string | null;
  max_per_expense: number | null;
  requires_receipt: number;
  enforcement: string;
  is_active: number;
}

const emptyDraft = {
  policy_name: '',
  category_id: '',
  max_per_expense: '',
  requires_receipt: true,
  enforcement: 'warn',
};

const PolicyAdmin: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [draft, setDraft] = useState({ ...emptyDraft });
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!activeCompany) return;
    const [pols, cats] = await Promise.all([
      api.featExpPolicyList({}).catch(() => []),
      api.query('categories', { company_id: activeCompany.id, type: 'expense' }).catch(() => []),
    ]);
    setPolicies(Array.isArray(pols) ? pols : []);
    setCategories(Array.isArray(cats) ? cats : []);
  }, [activeCompany]);

  useEffect(() => { reload(); }, [reload]);

  const save = useCallback(async () => {
    if (!draft.policy_name.trim()) return;
    setBusy(true);
    try {
      await api.featExpPolicyUpsert({
        policy_name: draft.policy_name.trim(),
        scope: draft.category_id ? 'category' : 'global',
        category_id: draft.category_id || null,
        max_per_expense: draft.max_per_expense ? parseFloat(draft.max_per_expense) : null,
        requires_receipt: draft.requires_receipt ? 1 : 0,
        enforcement: draft.enforcement,
        is_active: 1,
      });
      setDraft({ ...emptyDraft });
      setShowForm(false);
      await reload();
    } finally {
      setBusy(false);
    }
  }, [draft, reload]);

  const toggleActive = useCallback(async (p: Policy) => {
    setBusy(true);
    try {
      await api.update('expense_policies', p.id, { is_active: p.is_active ? 0 : 1 });
      await reload();
    } finally {
      setBusy(false);
    }
  }, [reload]);

  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name || 'All categories';

  return (
    <div className="block-card p-0 overflow-hidden" style={{ borderRadius: 'var(--app-radius)' }}>
      <div className="px-4 py-3 border-b border-border-primary flex items-center justify-between">
        <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider flex items-center gap-2">
          <ShieldCheck size={12} /> Expense Policies
        </div>
        <button className="block-btn flex items-center gap-1 text-xs" onClick={() => setShowForm((v) => !v)}>
          <Plus size={12} /> New Policy
        </button>
      </div>

      {showForm && (
        <div className="px-4 py-3 border-b border-border-primary grid grid-cols-5 gap-3 items-end">
          <label className="text-xs text-text-secondary col-span-2">
            Name
            <input className="block-input w-full mt-1" value={draft.policy_name}
              onChange={(e) => setDraft((d) => ({ ...d, policy_name: e.target.value }))} placeholder="e.g. Meals cap" />
          </label>
          <label className="text-xs text-text-secondary">
            Category
            <select className="block-input w-full mt-1" value={draft.category_id}
              onChange={(e) => setDraft((d) => ({ ...d, category_id: e.target.value }))}>
              <option value="">All</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="text-xs text-text-secondary">
            Max / expense
            <input className="block-input w-full mt-1" type="number" min="0" step="0.01" value={draft.max_per_expense}
              onChange={(e) => setDraft((d) => ({ ...d, max_per_expense: e.target.value }))} placeholder="No cap" />
          </label>
          <div className="flex items-center gap-3">
            <label className="text-xs text-text-secondary flex items-center gap-1.5">
              <input type="checkbox" checked={draft.requires_receipt}
                onChange={(e) => setDraft((d) => ({ ...d, requires_receipt: e.target.checked }))} />
              Receipt
            </label>
            <select className="block-input text-xs" value={draft.enforcement}
              onChange={(e) => setDraft((d) => ({ ...d, enforcement: e.target.value }))}>
              <option value="warn">Warn</option>
              <option value="block">Block</option>
            </select>
            <button className="block-btn-primary text-xs" disabled={busy || !draft.policy_name.trim()} onClick={save}>Save</button>
          </div>
        </div>
      )}

      {policies.length === 0 ? (
        <div className="py-5 text-center text-xs text-text-muted">No policies defined. Policies gate expense saves (warn or block).</div>
      ) : (
        <table className="block-table">
          <thead>
            <tr><th>Name</th><th>Applies To</th><th className="text-right">Max / Expense</th><th>Receipt</th><th>Mode</th><th>Status</th><th className="text-right">Actions</th></tr>
          </thead>
          <tbody>
            {policies.map((p) => (
              <tr key={p.id}>
                <td className="text-text-primary text-xs">{p.policy_name}</td>
                <td className="text-text-secondary text-xs">{catName(p.category_id)}</td>
                <td className="text-right font-mono text-text-primary text-xs">{p.max_per_expense != null ? formatCurrency(p.max_per_expense) : '—'}</td>
                <td className="text-text-secondary text-xs">{p.requires_receipt ? 'Required' : 'Optional'}</td>
                <td className="text-text-secondary text-xs capitalize">{p.enforcement}</td>
                <td className="text-xs">
                  <span className={p.is_active ? 'text-accent-income' : 'text-text-muted'}>{p.is_active ? 'Active' : 'Inactive'}</span>
                </td>
                <td className="text-right">
                  <button className="block-btn flex items-center gap-1 text-xs ml-auto" disabled={busy} onClick={() => toggleActive(p)}>
                    <Power size={12} /> {p.is_active ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default PolicyAdmin;
```

Note: verify `featExpPolicyList({})` returns ALL policies (not just active) — check `listExpensePolicies`; if it filters to active-only by default, pass the documented opt (`{ active_only: false }`).
Also verify `expense_policies` is covered by the generic `db:update` (it has `updated_at`; if it's missing from company-scoping or `tablesWithoutUpdatedAt` handling, adapt: use `featExpPolicyUpsert({ id, ...row, is_active: 0 })` for the toggle instead of `api.update`).

- [ ] **Step 2: Create `settings/TemplateAdmin.tsx`** — read-only list of saved expense templates with enable/disable (creation happens from the form/save flows that already call `feat:exp-tpl:save`).

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { FileText, Power } from 'lucide-react';
import api from '../../../lib/api';
import { useCompanyStore } from '../../../stores/companyStore';
import { formatCurrency, formatDate } from '../../../lib/format';

interface Tpl {
  id: string;
  template_name: string;
  default_amount: number | null;
  description: string | null;
  use_count: number;
  last_used_at: string | null;
  is_active: number;
}

const TemplateAdmin: React.FC = () => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [tpls, setTpls] = useState<Tpl[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!activeCompany) return;
    const r = await api.featExpTplList().catch(() => []);
    setTpls(Array.isArray(r) ? r : []);
  }, [activeCompany]);

  useEffect(() => { reload(); }, [reload]);

  const toggleActive = useCallback(async (t: Tpl) => {
    setBusy(true);
    try {
      await api.update('expense_templates_v2', t.id, { is_active: t.is_active ? 0 : 1 });
      await reload();
    } finally {
      setBusy(false);
    }
  }, [reload]);

  return (
    <div className="block-card p-0 overflow-hidden" style={{ borderRadius: 'var(--app-radius)' }}>
      <div className="px-4 py-3 border-b border-border-primary">
        <div className="text-[10px] font-semibold text-text-muted uppercase tracking-wider flex items-center gap-2">
          <FileText size={12} /> Expense Templates
        </div>
      </div>
      {tpls.length === 0 ? (
        <div className="py-5 text-center text-xs text-text-muted">No saved templates yet. Save one from the expense form.</div>
      ) : (
        <table className="block-table">
          <thead>
            <tr><th>Name</th><th>Description</th><th className="text-right">Default Amount</th><th className="text-right">Uses</th><th>Last Used</th><th>Status</th><th className="text-right">Actions</th></tr>
          </thead>
          <tbody>
            {tpls.map((t) => (
              <tr key={t.id}>
                <td className="text-text-primary text-xs">{t.template_name}</td>
                <td className="text-text-secondary text-xs truncate max-w-[220px]">{t.description || '-'}</td>
                <td className="text-right font-mono text-text-primary text-xs">{t.default_amount != null ? formatCurrency(t.default_amount) : '—'}</td>
                <td className="text-right font-mono text-text-secondary text-xs">{t.use_count}</td>
                <td className="font-mono text-text-secondary text-xs">{t.last_used_at ? formatDate(t.last_used_at) : '—'}</td>
                <td className="text-xs">
                  <span className={t.is_active ? 'text-accent-income' : 'text-text-muted'}>{t.is_active ? 'Active' : 'Inactive'}</span>
                </td>
                <td className="text-right">
                  <button className="block-btn flex items-center gap-1 text-xs ml-auto" disabled={busy} onClick={() => toggleActive(t)}>
                    <Power size={12} /> {t.is_active ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default TemplateAdmin;
```

Same `api.update` caveat as PolicyAdmin: verify `expense_templates_v2` works with generic `db:update` (it has `updated_at`); fall back to `featExpTplSave({ id, ...t, is_active: 0 })` if not.

- [ ] **Step 3: Build + commit**

```bash
npm run build && bash scripts/ui-leak-check.sh
git add src/renderer/modules/expenses/settings/
git commit -m "feat(expenses): policy and template admin sections"
```

---

### Task 3: Unified Settings tab

**Files:**
- Create: `src/renderer/modules/expenses/settings/ExpenseSettings.tsx`
- Modify: `src/renderer/modules/expenses/index.tsx` (settings tab render only)

- [ ] **Step 1: Create `settings/ExpenseSettings.tsx`** — stacks the existing category settings with the new sections and a CC-import entry point.

```tsx
import React, { useState } from 'react';
import { CreditCard } from 'lucide-react';
import ExpenseCategorySettings from '../ExpenseCategorySettings';
import CreditCardImportModal from '../CreditCardImportModal';
import PolicyAdmin from './PolicyAdmin';
import TemplateAdmin from './TemplateAdmin';

interface Props {
  onBack: () => void;
}

const ExpenseSettings: React.FC<Props> = ({ onBack }) => {
  const [showCcImport, setShowCcImport] = useState(false);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end">
        <button className="block-btn flex items-center gap-2 text-xs" onClick={() => setShowCcImport(true)}>
          <CreditCard size={14} /> Import Credit-Card Statement
        </button>
      </div>
      <PolicyAdmin />
      <TemplateAdmin />
      <ExpenseCategorySettings onBack={onBack} />
      {showCcImport && (
        <CreditCardImportModal onClose={() => setShowCcImport(false)} onDone={() => setShowCcImport(false)} />
      )}
    </div>
  );
};

export default ExpenseSettings;
```

- [ ] **Step 2: Swap the settings render in `index.tsx`.** Replace `{tab === 'settings' && (<ExpenseCategorySettings onBack={() => setTab('expenses')} />)}` with `{tab === 'settings' && (<ExpenseSettings onBack={() => setTab('expenses')} />)}`, importing `ExpenseSettings` from `./settings/ExpenseSettings` (the `ExpenseCategorySettings` import in index.tsx can be dropped if now unused there).

- [ ] **Step 3: Build + commit**

```bash
npm run build && bash scripts/ui-leak-check.sh
git add src/renderer/modules/expenses/settings/ExpenseSettings.tsx src/renderer/modules/expenses/index.tsx
git commit -m "feat(expenses): unified Settings tab (policies, templates, categories, CC import)"
```

---

### Task 4: Merge Analytics into Insights; fold Audit into Compliance

**Files:**
- Modify: `src/renderer/modules/expenses/index.tsx`

Navigational merge only — the components stay intact; sub-view toggles lazy-render exactly one at a time (no double fetching).

- [ ] **Step 1: Add sub-view state** near the other view state in `ExpensesModule`:

```tsx
const [insightsView, setInsightsView] = useState<'overview' | 'charts'>('overview');
const [complianceView, setComplianceView] = useState<'compliance' | 'audit'>('compliance');
```

- [ ] **Step 2: Remove the `analytics` and `audit` TabBtns** and remove `'analytics' | 'audit'` from the `Tab` type. Remove their render lines (`{tab === 'analytics' && <ExpenseAnalytics />}` and the audit block).

- [ ] **Step 3: Retarget stale references.** Dashboard quick-action "View Analytics" (`switchTab('analytics')` ~L370): change to `{ switchTab('insights'); setInsightsView('charts'); }` and relabel if desired (keep "View Analytics"). Search the file for any other `'analytics'`/`'audit'` tab references (e.g. `setTab('audit')`) and retarget them the same way.

- [ ] **Step 4: New Insights render** (replace the existing insights line):

```tsx
{tab === 'insights' && (
  <div className="space-y-4">
    <div className="flex items-center gap-2">
      <button className={`block-btn text-xs ${insightsView === 'overview' ? 'text-text-primary' : 'text-text-muted'}`}
        onClick={() => setInsightsView('overview')}>Overview</button>
      <button className={`block-btn text-xs ${insightsView === 'charts' ? 'text-text-primary' : 'text-text-muted'}`}
        onClick={() => setInsightsView('charts')}>Charts</button>
    </div>
    {insightsView === 'overview' ? <ExpenseInsights onViewExpense={handleEditExpense} /> : <ExpenseAnalytics />}
  </div>
)}
```

- [ ] **Step 5: New Compliance render** (replace the existing compliance line):

```tsx
{tab === 'compliance' && (
  <div className="space-y-4">
    <div className="flex items-center gap-2">
      <button className={`block-btn text-xs ${complianceView === 'compliance' ? 'text-text-primary' : 'text-text-muted'}`}
        onClick={() => setComplianceView('compliance')}>Compliance</button>
      <button className={`block-btn text-xs ${complianceView === 'audit' ? 'text-text-primary' : 'text-text-muted'}`}
        onClick={() => setComplianceView('audit')}>Audit Log</button>
    </div>
    {complianceView === 'compliance'
      ? <ExpenseCompliance onViewExpense={handleEditExpense} />
      : <ExpenseAuditReport onBack={() => setComplianceView('compliance')} />}
  </div>
)}
```

- [ ] **Step 6: Build + leak check + commit**

```bash
npm run build && bash scripts/ui-leak-check.sh
git add src/renderer/modules/expenses/index.tsx
git commit -m "feat(expenses): merge Analytics into Insights, fold Audit Log into Compliance"
```

---

### Task 5: Phase 3 wrap-up

- [ ] **Step 1:** `npm run build && bash scripts/ui-leak-check.sh` — clean, counts flat.
- [ ] **Step 2:** Grep sanity: no remaining `'analytics'`/`'audit'` Tab references in index.tsx; `ExpenseAnalytics`, `ExpenseAuditReport` still imported and rendered via sub-views.
- [ ] **Step 3:** Push (`git push`) — PR #23 updates.

---

## Notes for implementers

- Tab bar after Phase 3: Dashboard · Expenses · Review · Vendors · Approval Queue · Reimbursement · Insights · Compliance · Settings · Upgrades.
- The plan deliberately keeps `ExpenseCategorySettings` intact inside the new Settings wrapper (its `onBack` still works); no rewrite.
- `eu()` bulk handlers already passed review in their live form; Task 1 only redirects the dead twins.
- Theme rules as ever. `block-btn` for the sub-view toggles keeps them consistent with existing secondary buttons.
