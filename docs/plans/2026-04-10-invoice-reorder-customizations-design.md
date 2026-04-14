# Invoice Line Item Reordering & Customization Pass

**Status:** Approved
**Date:** 2026-04-10
**Author:** Brainstorming session (rmpgutah + Claude)

## Problem

Two related gaps in the invoicing module:

1. **Line items are not reorderable.** A `<GripVertical>` icon is rendered on every row in `InvoiceForm.tsx`, suggesting drag-and-drop works, but no handlers are attached. Users who want to reorder items today must delete and re-add rows. The `sort_order` column already exists on `invoice_line_items` — the data model supports reordering, only the UI is missing.
2. **Customization has known gaps.** InvoiceSettings already covers a lot (5 template styles, 4 fonts, 3 header layouts, accent/secondary colors, logo, watermark, footer, column config, QR codes) but lacks: per-line visual styling, a UI for managing reusable catalog items, user-definable custom header fields, and tax breakdown by rate for compliance with multi-rate jurisdictions.

## Goals

- Users can reorder line items by dragging the grip handle OR clicking up/down arrows.
- Users can mark individual line items bold, italic, or highlighted with one of 4 preset colors.
- Users can create, edit, and delete reusable catalog items from a dedicated management screen.
- Users can define up to 4 custom header fields per company (labels in settings, values per invoice) that appear on the PDF.
- Invoices with mixed tax rates automatically show a per-rate breakdown in the totals section (compliance requirement in many jurisdictions).

## Non-goals

- Drag-and-drop between separate invoices (cross-invoice reorder).
- More than 4 custom header fields (EAV/child-table pattern — deferred until a real customer needs it).
- Free-form hex color pickers for line highlighting (limited to 4 print-safe presets).
- Subtotal-per-rate display (standard practice is per-rate TAX lines with a single subtotal; QuickBooks/FreshBooks/Xero all follow this).

## Design

### Section 1: Line item reordering (drag + arrows)

**Approach:** Native HTML5 drag-and-drop (`draggable`, `onDragStart`, `onDragOver`, `onDrop`) combined with up/down arrow buttons. No new library dependencies.

**State additions in `InvoiceForm.tsx`:**
- `dragIndex: number | null` — index of the row currently being dragged
- `overIndex: number | null` — index of the row the dragged row is hovering over (for drop indicator)
- `rowDraggable: Record<number, boolean>` — per-row flag toggled by `onMouseDown` on the grip cell

**Handlers:**
- `handleDragStart(idx)` — set `dragIndex`, set `e.dataTransfer.effectAllowed = 'move'`
- `handleDragOver(idx, e)` — `e.preventDefault()`, set `overIndex`
- `handleDragLeave` — clear `overIndex` when leaving a row
- `handleDrop(idx)` — splice `lines[dragIndex]` out, insert at new position, clear both indexes
- `handleDragEnd` — clear `dragIndex`, `overIndex`, and `rowDraggable` (handles cancelled drags)
- `moveLine(fromIdx, toIdx)` — shared helper used by drop handler and arrow buttons
- `moveLineUp(idx)` — `moveLine(idx, idx - 1)` when `idx > 0`
- `moveLineDown(idx)` — `moveLine(idx, idx + 1)` when `idx < lines.length - 1`

**Critical UX detail:** `<tr>` must only be `draggable={true}` while the user is actively pressing the grip cell. Otherwise, clicking inside any `<input>` would trigger row drag instead of placing the cursor. The grip cell uses `onMouseDown={() => setRowDraggable(idx, true)}` and the row has `onDragEnd={() => setRowDraggable(idx, false)}`. This is the standard workaround for HTML5 drag-in-table with nested inputs.

**Grip cell UI:**
```tsx
<td className="cursor-grab" onMouseDown={() => setRowDraggable(idx, true)}>
  <div className="flex flex-col items-center">
    <button onClick={() => moveLineUp(idx)} disabled={idx === 0}><ChevronUp size={10} /></button>
    <GripVertical size={11} />
    <button onClick={() => moveLineDown(idx)} disabled={idx === lines.length - 1}><ChevronDown size={10} /></button>
  </div>
</td>
```

**Drop indicator:** When `overIndex === idx`, the row gets a `border-top: 2px solid var(--color-accent-blue)` to show where the dragged row will land.

**Save path is already correct.** The existing save logic does `lines.map((l, idx) => ({ ..., sort_order: idx }))`, so array position is automatically persisted as `sort_order`. No backend changes.

### Section 2: Per-line styling

**Schema migrations** (additive, backward compatible):
```sql
ALTER TABLE invoice_line_items ADD COLUMN bold INTEGER DEFAULT 0;
ALTER TABLE invoice_line_items ADD COLUMN italic INTEGER DEFAULT 0;
ALTER TABLE invoice_line_items ADD COLUMN highlight_color TEXT DEFAULT '';
```

Three separate columns instead of a JSON blob because (a) they're simple scalars, (b) the print template's conditional rendering is cleaner (`if (l.bold)` vs `JSON_EXTRACT(...)`), and (c) SQLite handles additive column migrations natively.

`highlight_color` stores one of 5 values: `''` (none), `'#fef9c3'` (pastel yellow), `'#dbeafe'` (pastel blue), `'#fecaca'` (pastel red), `'#dcfce7'` (pastel green). Limiting to 4 presets ensures print-safe contrast in grayscale and prevents users from picking colors that render poorly.

**LineItem interface update** in `InvoiceForm.tsx`:
```ts
interface LineItem {
  // ... existing fields ...
  bold: number;
  italic: number;
  highlight_color: string;
}
```

**UI:** On-hover toolbar popover next to the grip cell, showing Bold / Italic toggles and 5 color swatches (first swatch = clear / no highlight).

**Print template update** in `src/renderer/lib/print-templates.ts`:
```ts
const styleAttr = [
  l.bold ? 'font-weight:700' : '',
  l.italic ? 'font-style:italic' : '',
  l.highlight_color ? `background:${l.highlight_color}` : '',
].filter(Boolean).join(';');
```

### Section 3: Reusable catalog items UI

**No schema changes.** `invoice_catalog_items` table already exists with: `id`, `company_id`, `name`, `description`, `default_price`, `default_quantity`, `default_unit`, `default_tax_rate`, `account_id`, `sku`, `created_at`.

**New component:** `src/renderer/modules/invoices/CatalogManager.tsx` (~250 lines).

**Layout:**
- Header: Back button + "Catalog Items" title + "+ New Item" button + search input
- Left column (40%): Scrollable filtered list. Each row shows name, description preview, price, delete icon. Click row to load into form.
- Right column (60%): Form with fields: name, description, SKU, default_price, default_quantity, default_unit, default_tax_rate, account (dropdown from existing accounts).

**Wire-up:**
- Add "Catalog" button to `InvoiceList.tsx` header actions next to "Customize".
- Add `'catalog'` to the `InvoiceView` union in `src/renderer/modules/invoices/index.tsx`.
- Render `<CatalogManager onBack={() => setView('list')} />` when view is `'catalog'`.

**Existing `CatalogDropdown` in `InvoiceForm.tsx` stays unchanged** — it already queries the same table and will pick up new items automatically on the next form mount.

### Section 4: Custom header fields

**Two-part schema**, separating company-level labels from per-invoice values:

```sql
-- Labels live on invoice_settings (per-company config)
ALTER TABLE invoice_settings ADD COLUMN custom_field_1_label TEXT DEFAULT '';
ALTER TABLE invoice_settings ADD COLUMN custom_field_2_label TEXT DEFAULT '';
ALTER TABLE invoice_settings ADD COLUMN custom_field_3_label TEXT DEFAULT '';
ALTER TABLE invoice_settings ADD COLUMN custom_field_4_label TEXT DEFAULT '';

-- Values live on invoices (per-invoice data)
ALTER TABLE invoices ADD COLUMN custom_field_1 TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN custom_field_2 TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN custom_field_3 TEXT DEFAULT '';
ALTER TABLE invoices ADD COLUMN custom_field_4 TEXT DEFAULT '';
```

**Why 4 fixed slots instead of a child table:** For N ≤ 4, fixed columns are strictly simpler (no joins, column indexes work automatically). Upgrading to a child table later is cheap if ever needed. This matches how enterprise ERPs (SAP, Oracle) handle custom fields on common transactions — fixed slots first, flex tables only when cardinality demands it.

**Why labels in settings, not per-invoice:** The labels are a *company convention*. If they lived on each invoice, users would retype them for every invoice, and the PDF output would be inconsistent. Company-level labels → each invoice just fills in values.

**UI in `InvoiceSettings.tsx`:** New "Custom Fields" card with 4 label inputs. Placeholder text suggests common examples ("Purchase Order", "Department", "Contract #", "Cost Center"). Leaving a label blank hides that field from all invoices.

**UI in `InvoiceForm.tsx`:** Only render custom field inputs where the corresponding label is non-empty, so unused slots don't clutter the form.

**Print template update:** Custom fields render in the meta-row section of the invoice HTML, but only when both label and value exist for a given slot.

**Backward compatibility:** The existing `po_number` and `job_reference` columns remain unchanged. Companies can migrate gradually or use both.

### Section 5: Tax breakdown by rate

**No schema changes** — pure compute logic at render time.

**Compute step** (shared between InvoiceForm live preview, InvoiceDetail view, and print-templates):
```ts
const taxByRate = lines.reduce<Record<string, { taxable: number; tax: number }>>((acc, l) => {
  if ((l.row_type || 'item') !== 'item') return acc;
  const rate = l.tax_rate_override >= 0 ? l.tax_rate_override : l.tax_rate;
  if (rate <= 0) return acc;
  const base = l.quantity * l.unit_price * (1 - (l.discount_pct || 0) / 100);
  const key = rate.toFixed(2); // normalize "7" and "7.00" to same key
  if (!acc[key]) acc[key] = { taxable: 0, tax: 0 };
  acc[key].taxable += base;
  acc[key].tax += base * (rate / 100);
  return acc;
}, {});

const taxRates = Object.keys(taxByRate).sort((a, b) => parseFloat(a) - parseFloat(b));
const hasMultipleRates = taxRates.length > 1;
```

**Render logic:**
- **Single-rate invoices** (backward compatible): one `Tax: $X.XX` line, same as today.
- **Multi-rate invoices:** one line per rate showing `Tax (4.00% on $500.00): $20.00`, sorted by rate ascending.

**Edge cases:**
- Zero-rate items excluded from breakdown
- `tax_rate_override >= 0` takes precedence over `tax_rate` (matches existing per-line calculation)
- Line discounts applied to taxable base BEFORE multiplying by rate (matches existing logic)
- Each rate's tax is rounded to cents during display; per-rate calculation is required for jurisdictional compliance (EU VAT Directive 2006/112/EC Art. 226; Texas Tax Code §151.005; etc.)

**Compliance rationale:** Many jurisdictions require invoices to show tax separately per rate when items are taxed at different rates. An invoice that displays only `Tax: $82.50` on a mixed-rate invoice is technically non-compliant in the EU (VAT) and several US states. This isn't a "feature" — it's filling a legal gap.

## Data Model Summary

**7 ALTER TABLE migrations** (all additive, all `DEFAULT ''` or `DEFAULT 0`):

| Table | Columns added |
|---|---|
| `invoice_line_items` | `bold INTEGER DEFAULT 0`, `italic INTEGER DEFAULT 0`, `highlight_color TEXT DEFAULT ''` |
| `invoice_settings` | `custom_field_{1..4}_label TEXT DEFAULT ''` |
| `invoices` | `custom_field_{1..4} TEXT DEFAULT ''` |

**0 new tables.** All 5 features either use compute logic (reordering, tax breakdown) or extend existing tables.

## Files Changed

| File | Change |
|---|---|
| `src/main/database/index.ts` | Add 7 migrations to `migrations[]` |
| `src/renderer/modules/invoices/InvoiceForm.tsx` | Drag+arrows, per-line styling toolbar, custom field inputs, tax breakdown compute, LineItem/InvoiceFormData interface updates |
| `src/renderer/modules/invoices/InvoiceDetail.tsx` | Tax breakdown compute+render |
| `src/renderer/modules/invoices/InvoiceList.tsx` | "Catalog" button wiring |
| `src/renderer/modules/invoices/InvoiceSettings.tsx` | Custom fields card with 4 label inputs |
| `src/renderer/modules/invoices/index.tsx` | `'catalog'` view in router |
| `src/renderer/modules/invoices/CatalogManager.tsx` | **NEW** — full CRUD component |
| `src/renderer/lib/print-templates.ts` | Per-line styles, custom fields in meta-row, tax breakdown in totals-box |

**Total:** 1 new file + 7 modified files + 7 schema migrations.

## Error Handling

- **Reordering:** drag cancellation is handled by `onDragEnd` clearing all state. Arrow buttons are disabled at list boundaries. No backend calls during reorder — only affects local state until save.
- **Per-line styling:** invalid colors default to `''`. Missing `bold`/`italic` default to `0`. Existing invoices load with all styles off.
- **Catalog manager:** save failures show a toast and leave the form editable. Delete prompts for confirmation.
- **Custom fields:** blank labels hide the field entirely (no error). Unicode is supported in both labels and values.
- **Tax breakdown:** single-rate fallback handles all zero-tax and zero-line edge cases.

## Testing Plan

- **Reordering:** Drag row 3 above row 1 → verify order on save and reload. Click up arrow on row 5 → moves to row 4. Arrow buttons disabled at boundaries.
- **Per-line styling:** Toggle bold on a line → verify on save, reload, print preview, PDF export, emailed PDF.
- **Catalog manager:** Create 3 items, edit one, delete one. Open new invoice, insert from catalog dropdown, verify defaults populate correctly.
- **Custom fields:** Set 2 labels in settings, leave 2 blank. Create invoice, fill in the 2 labeled fields. Verify only labeled fields show on form, invoice detail, and PDF.
- **Tax breakdown:** Single-rate invoice → one tax line (unchanged). Mix 4%, 8.25%, 10% items → three tax lines in the totals box. Zero-rate line → excluded.
- `npx tsc --noEmit` — type check clean.
- Full build + install + smoke test.

## Rollout

Single commit, all 5 features shipped together. Rationale: each feature is independently testable locally, so the "one broken feature blocks everything" risk is low, and the user explicitly requested single-commit delivery.
