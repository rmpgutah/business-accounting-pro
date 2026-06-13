# Expense Workflow Overhaul — Design

**Date:** 2026-06-11
**Status:** Approved by user
**Context:** Owner-operated (single user). Goal: organize the Expense module, surface dark `ex:*` backend features as workflow actions, and add small high-value capabilities. Sequencing: UX-first phased plan.

## Goals

1. Restructure the Expenses module tabs into an inbox-driven workflow.
2. Convert dark backend intelligence (missing receipts, duplicates, anomalies, recurring detection, uncategorized, aging) into actionable queues instead of read-only stats.
3. Wire dark features into the create/edit form (auto-categorize suggestion, save-time receipt prompt).
4. Refactor the two oversized files (ExpenseForm 2,608 lines; ExpenseList 1,716 lines) as they are touched — behavior-preserving.
5. Consolidate duplicate bulk-op IPC handlers without breaking existing channels.
6. Add a "Duplicate expense" action.

## Non-goals

- Approval chains / multi-approver routing (solo owner; keep approvals lightweight).
- OCR receipt auto-fill, bulk receipt attach (future session).
- Any schema redesign of the `expenses` table.

## 1. Tab structure (`src/renderer/modules/expenses/index.tsx`)

New tab set: **Expenses · Review · Insights · Compliance · Vendors · Settings**

| Tab | Contents |
|---|---|
| Expenses | Current List tab (behavior unchanged; file split per §4). |
| Review | New action inbox (§2). Tab badge shows total open-item count. |
| Insights | Current ExpenseInsights + charts from ExpenseAnalytics merged in (ExpenseVizCharts reused). ExpenseAnalytics ceases to be a separate destination. |
| Compliance | Current ExpenseCompliance, plus ExpenseAuditReport content folded in. |
| Vendors | Unchanged. |
| Settings | ExpenseCategorySettings + new policy admin UI (`feat:exp-policy:upsert/list`) + expense templates (`feat:exp-tpl:*`) + Credit-Card Import entry point. |

## 2. Review inbox (new `ExpenseReview.tsx`)

Sectioned queue; each row has inline actions. Header strip shows per-section counts; all-clear empty state.

| Section | Source channel | Inline actions |
|---|---|---|
| Missing receipts | `ex:missing-receipts` | Drag-drop attach in row; "lost receipt" affidavit. |
| Uncategorized | `ex:uncategorized` | Inline category picker; "apply suggestion" via auto-categorizer/vendor history. |
| Possible duplicates | `ex:find-duplicates` | Side-by-side pair; keep one / void other (`ex:void-expense`). |
| Vendor anomalies | `ex:vendor-anomalies` | Review; dismiss (dismissal persisted via tag so it doesn't reappear). |
| Detected subscriptions | `ex:detect-recurring` | One-click "create recurring template" (recurring_templates / `feat:exp-tpl`). |
| Stale pending | `ex:expense-aging` | One-click approve or void — no chains. |

All mutations call `scheduleAutoBackup()`; list refresh uses the `listKey` increment pattern.

## 3. Form integration (`ExpenseForm`)

- **Auto-categorize suggestion:** when vendor is set and category empty, show suggested-category chip (vendor history / auto-tag rules). One click to accept; never auto-applied.
- **Receipt prompt on save:** amount ≥ receipt threshold and no attachment → save-time prompt: attach now / mark lost / save anyway.
- **Duplicate expense:** "Duplicate" action on list rows and detail view — opens form prefilled (date = today, receipt cleared).

## 4. Refactor (behavior-preserving, done as files are touched)

- `ExpenseList.tsx` → `list/` folder: `ExpenseListTable`, `ExpenseListFilters`, `BulkActionsBar`, `GroupingControls`.
- `ExpenseForm.tsx` → `form/` folder: core state/submit, standard fields, capture-modes wrapper, receipt manager.
- IPC dedup: one canonical channel for bulk recategorize, bulk tag, and bulk approval; legacy channels (`feat:expense:bulk-recategorize` vs `eu:bulk:recategorize`, etc.) forward to the canonical one. No channel removed.

## 5. Phasing

1. **Phase 1:** Tab restructure + Review inbox with Missing receipts + Uncategorized sections + ExpenseList split.
2. **Phase 2:** Remaining Review sections (duplicates, anomalies, subscriptions, stale) + form integration (§3) + ExpenseForm split.
3. **Phase 3:** Settings consolidation, IPC dedup, Duplicate-expense action, Insights/Analytics merge.

Each phase must build (`npm run build`) and ship independently.

## 6. Verification

No renderer test suite exists. Per phase:
- `npm run build` clean.
- Manual run-through of each touched tab (dev app).
- `bash scripts/ui-leak-check.sh` — leak counts must not rise.

## Constraints (from CLAUDE.md)

- Theme tokens only — no hard-coded hex, no `bg-white`/`text-gray-*`; radius via `var(--app-radius)`.
- `.block-table` supplies table framing; don't restyle borders inline.
- New mutation IPC handlers call `scheduleAutoBackup()`.
- New columns (if any) need try/catch ALTER migration + `tablesWithoutUpdatedAt` listing.
- Module routing stays in `App.tsx` switch (no router) — tabs are internal to the expenses module, so no App.tsx change expected.
