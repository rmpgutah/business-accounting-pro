# Readability & Understanding Output — Design

**Date:** 2026-04-05
**Approach:** Option A — Utility-first

## Goal

Eliminate 221 raw `.toFixed(2)` currency calls, 13 duplicate `STATUS_BADGE` maps, and ~40 raw date formatting calls scattered across the renderer. Add a shared `<Tooltip>` component for summary bar numbers and form field labels. Standardize empty states with a single `<EmptyState>` component.

---

## Section 1 — Format Utilities

**File:** `src/renderer/lib/format.ts`

Three exported functions:

```typescript
formatCurrency(value: number | string, opts?: { symbol?: string }): string
// "$1,234.50" — Intl.NumberFormat, USD, 2 decimal places

formatDate(isoString: string, opts?: { style?: 'short' | 'medium' | 'relative' }): string
// medium (default): "Apr 1, 2026"
// short:            "04/01/26"
// relative:         "3 days ago"

formatStatus(status: string): { label: string; className: string }
// Maps every app status to a human label + block-badge-* class
```

**Status map covers:** draft, sent, paid, overdue, pending, pending_approval, approved, rejected, active, inactive, prospect, void, cancelled, open, closed.

No new CSS required — uses existing `block-badge`, `block-badge-income`, `block-badge-expense`, `block-badge-warning`, `block-badge-blue`, `block-badge-purple` classes.

---

## Section 2 — Tooltip Component

**Files:**
- `src/renderer/components/Tooltip.tsx` — hover popover wrapper
- `src/renderer/components/FieldLabel.tsx` — label + `?` icon for forms

### Tooltip
```tsx
<Tooltip content="Plain string or JSX">
  {children}
</Tooltip>
```
CSS-positioned, `group-hover` reveal, defaults to `top` placement. No library, no portal — desktop Electron, z-index not a concern.

### FieldLabel
```tsx
<FieldLabel label="Tax Rate" tooltip="Applied to subtotal before payment" required />
```
Replaces raw `<label>` tags in forms. Renders label text + `?` icon that triggers `<Tooltip>` on hover. `required` prop adds the asterisk.

### SummaryBar integration
`SummaryItem` gets an optional `tooltip?: string` field. `<SummaryBar>` wraps each value in `<Tooltip>` when present. Non-breaking — `tooltip` is optional.

---

## Section 3 — Empty State Standardization

**File:** `src/renderer/components/EmptyState.tsx`

```tsx
<EmptyState icon={FileText} message="No invoices yet" />
```

Wraps existing `.empty-state` / `.empty-state-icon` CSS — no new styles. Replaces ad-hoc empty state markup across all modules.

---

## Code Sweep

| What | Scope | Change |
|---|---|---|
| `$${Number(x).toFixed(2)}` | 221 instances | → `formatCurrency(x)` |
| `new Date(x).toLocaleDateString()` | ~40 instances | → `formatDate(x)` |
| `STATUS_BADGE` local maps | 13 files | → `formatStatus(x)` |
| Ad-hoc empty state markup | all modules | → `<EmptyState>` |
| `SummaryBar` items | 3 list views | add `tooltip` string to each item |
| Raw `<label>` in forms | InvoiceForm, ExpenseForm, RuleForm, BillForm, etc. | → `<FieldLabel tooltip="...">` |

Sweep is purely mechanical — no behavior changes, only output formatting.

---

## Implementation Order

1. `src/renderer/lib/format.ts` — utilities first (everything depends on this)
2. `src/renderer/components/Tooltip.tsx` + `FieldLabel.tsx`
3. `src/renderer/components/EmptyState.tsx`
4. Sweep: currency + date formatting across all modules
5. Sweep: STATUS_BADGE → formatStatus across 13 files
6. Sweep: empty states
7. Add tooltips to SummaryBar items
8. Add FieldLabel to key forms (InvoiceForm, ExpenseForm, RuleForm)
