# Invoice Reorder + Customizations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add drag-and-drop + arrow reordering for invoice line items, per-line styling (bold/italic/highlight), a reusable catalog manager, custom header fields (4 slots), and tax breakdown by rate.

**Architecture:** All changes are additive. 7 `ALTER TABLE` migrations (all `DEFAULT ''` or `DEFAULT 0`), 1 new React component (`CatalogManager.tsx`), 6 modified files. No new dependencies. Uses native HTML5 drag-and-drop. The existing `moveLine()` helper in InvoiceForm.tsx is already defined but unused — it will be wired to both drag and arrow buttons. The existing `sort_order` column handles persistence automatically via the save logic.

**Tech Stack:** Electron 41, React 19, TypeScript, better-sqlite3, Tailwind CSS, lucide-react icons.

**Design doc:** `docs/plans/2026-04-10-invoice-reorder-customizations-design.md`

---

## Task 0: Schema migrations + backend prep

**Why first:** Other tasks depend on these columns existing. Pure backend, zero UI, easy to verify.

**Files:**
- Modify: `src/main/database/index.ts:329` (append to migrations array)
- Modify: `src/main/database/index.ts:414` (append to tablesWithoutUpdatedAt if any new child tables — none here)
- Modify: `src/main/ipc/index.ts:400` (no changes — invoice_catalog_items already present)

**Step 1: Add 7 ALTER TABLE migrations**

Open `src/main/database/index.ts`, locate line 333 (the `"ALTER TABLE payroll_runs ADD COLUMN run_type TEXT DEFAULT 'regular'"` line), and insert the following AFTER it but BEFORE the closing `];`:

```typescript
  // Invoice reorder + customizations (2026-04-10)
  // Per-line styling
  "ALTER TABLE invoice_line_items ADD COLUMN bold INTEGER DEFAULT 0",
  "ALTER TABLE invoice_line_items ADD COLUMN italic INTEGER DEFAULT 0",
  "ALTER TABLE invoice_line_items ADD COLUMN highlight_color TEXT DEFAULT ''",
  // Custom header field labels (per-company, stored on invoice_settings)
  "ALTER TABLE invoice_settings ADD COLUMN custom_field_1_label TEXT DEFAULT ''",
  "ALTER TABLE invoice_settings ADD COLUMN custom_field_2_label TEXT DEFAULT ''",
  "ALTER TABLE invoice_settings ADD COLUMN custom_field_3_label TEXT DEFAULT ''",
  "ALTER TABLE invoice_settings ADD COLUMN custom_field_4_label TEXT DEFAULT ''",
  // Custom header field values (per-invoice)
  "ALTER TABLE invoices ADD COLUMN custom_field_1 TEXT DEFAULT ''",
  "ALTER TABLE invoices ADD COLUMN custom_field_2 TEXT DEFAULT ''",
  "ALTER TABLE invoices ADD COLUMN custom_field_3 TEXT DEFAULT ''",
  "ALTER TABLE invoices ADD COLUMN custom_field_4 TEXT DEFAULT ''",
```

**Step 2: Type check**

Run: `npx tsc --noEmit 2>&1 | head -5`
Expected: Only the pre-existing `baseUrl` deprecation warning. Zero other errors.

**Step 3: Commit**

```bash
git add src/main/database/index.ts
git commit -m "feat(db): add invoice reorder + customization migrations

- invoice_line_items: bold, italic, highlight_color
- invoice_settings: custom_field_{1..4}_label
- invoices: custom_field_{1..4}

All additive, all DEFAULT 0 or DEFAULT ''. Backward compatible."
```

---

## Task 1: Wire drag-and-drop + arrow buttons to existing moveLine()

**Why second:** This is the explicit user ask. Standalone feature — doesn't touch DB, doesn't touch print templates. Good self-contained task.

**Files:**
- Modify: `src/renderer/modules/invoices/InvoiceForm.tsx` — add drag state + handlers, update grip cell rendering

**Step 1: Add ChevronUp/ChevronDown to lucide imports**

Find the lucide-react import line (around line 2) and add `ChevronUp`, `ChevronDown`:

```typescript
import { ... existing icons ..., ChevronUp, ChevronDown } from 'lucide-react';
```

**Step 2: Add drag state after the existing state declarations**

Find the state block around line 296 (`const [lines, setLines] = useState<LineItem[]>([newLineItem()]);`) and add just after:

```typescript
// Drag-and-drop state for line reordering
const [dragIndex, setDragIndex] = useState<number | null>(null);
const [overIndex, setOverIndex] = useState<number | null>(null);
const [rowDraggable, setRowDraggableState] = useState<Record<number, boolean>>({});

const setRowDraggable = useCallback((idx: number, value: boolean) => {
  setRowDraggableState((prev) => ({ ...prev, [idx]: value }));
}, []);
```

**Step 3: Add drag handlers after the existing `moveLine` (around line 522)**

```typescript
const moveLineUp = useCallback((idx: number) => {
  if (idx > 0) moveLine(idx, idx - 1);
}, [moveLine]);

const moveLineDown = useCallback((idx: number) => {
  setLines((prev) => {
    if (idx >= prev.length - 1) return prev;
    const next = [...prev];
    const [item] = next.splice(idx, 1);
    next.splice(idx + 1, 0, item);
    return next;
  });
}, []);

const handleDragStart = useCallback((idx: number) => (e: React.DragEvent) => {
  setDragIndex(idx);
  e.dataTransfer.effectAllowed = 'move';
  // Required for Firefox
  e.dataTransfer.setData('text/plain', String(idx));
}, []);

const handleDragOver = useCallback((idx: number) => (e: React.DragEvent) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  if (dragIndex !== null && dragIndex !== idx) setOverIndex(idx);
}, [dragIndex]);

const handleDragLeave = useCallback(() => {
  setOverIndex(null);
}, []);

const handleDrop = useCallback((idx: number) => (e: React.DragEvent) => {
  e.preventDefault();
  if (dragIndex !== null && dragIndex !== idx) {
    moveLine(dragIndex, idx);
  }
  setDragIndex(null);
  setOverIndex(null);
}, [dragIndex, moveLine]);

const handleDragEnd = useCallback(() => {
  setDragIndex(null);
  setOverIndex(null);
  setRowDraggableState({});
}, []);
```

**Step 4: Replace all 5 grip-cell renderings with a shared helper component**

Scroll to the line rendering block (line 870). Currently there are 5 different row-type renderers that each have their own `<td>` with `<GripVertical>`. To avoid duplication, add this helper component just above the `<table>` or at the top of the component body:

```typescript
// Inside InvoiceForm component body, before return
const GripCell: React.FC<{ idx: number }> = ({ idx }) => (
  <td
    className="p-1 text-center"
    style={{ cursor: 'grab', color: 'var(--color-text-muted)', width: 28 }}
    onMouseDown={() => setRowDraggable(idx, true)}
    onMouseUp={() => setRowDraggable(idx, false)}
  >
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
      <button
        type="button"
        onClick={() => moveLineUp(idx)}
        disabled={idx === 0}
        title="Move up"
        style={{ background: 'none', border: 'none', padding: 0, cursor: idx === 0 ? 'not-allowed' : 'pointer', opacity: idx === 0 ? 0.3 : 1 }}
      >
        <ChevronUp size={9} />
      </button>
      <GripVertical size={11} />
      <button
        type="button"
        onClick={() => moveLineDown(idx)}
        disabled={idx === lines.length - 1}
        title="Move down"
        style={{ background: 'none', border: 'none', padding: 0, cursor: idx === lines.length - 1 ? 'not-allowed' : 'pointer', opacity: idx === lines.length - 1 ? 0.3 : 1 }}
      >
        <ChevronDown size={9} />
      </button>
    </div>
  </td>
);
```

**Step 5: Apply drag attributes to each `<tr>` in the 5 row-type renderers**

For each `<tr>` inside `lines.map((line, idx) => {...})` (rows at approximately lines 881, 894, 916, 942, 963, 996), add these attributes to the `<tr>` element:

```tsx
<tr
  key={line.id}
  draggable={!!rowDraggable[idx]}
  onDragStart={handleDragStart(idx)}
  onDragOver={handleDragOver(idx)}
  onDragLeave={handleDragLeave}
  onDrop={handleDrop(idx)}
  onDragEnd={handleDragEnd}
  style={{
    ...(existing styles for that row type),
    borderTop: overIndex === idx && dragIndex !== null && dragIndex !== idx ? '2px solid var(--color-accent-blue)' : undefined,
    opacity: dragIndex === idx ? 0.4 : undefined,
  }}
>
```

Replace the existing grip `<td>` in each row type with `<GripCell idx={idx} />`. The 5 rows affected:
- spacer row (~line 881): has no grip cell today — add `<GripCell idx={idx} />` as the first `<td>` if you want it draggable, OR leave as-is and skip drag for spacers (acceptable; spacers are usually adjusted via buttons)
- section row (~line 894): replace existing grip `<td>` with `<GripCell idx={idx} />`
- note row (~line 916): replace existing grip `<td>` with `<GripCell idx={idx} />`
- subtotal row (~line 942): replace empty `<td></td>` with `<GripCell idx={idx} />`
- image row (~line 963): replace existing grip `<td>` with `<GripCell idx={idx} />`
- item row (the main one, ~line 996): find its grip cell and replace

**Step 6: Type check**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: Only the pre-existing `baseUrl` deprecation warning.

**Step 7: Commit**

```bash
git add src/renderer/modules/invoices/InvoiceForm.tsx
git commit -m "feat(invoice): add drag-and-drop + arrow reordering for line items

- Native HTML5 drag with grip handle cursor-grab affordance
- Up/Down arrow buttons for precision + accessibility
- Drop indicator shows blue top-border on hover target
- Dragged row fades to 40% opacity during drag
- Grip cell extracted to shared GripCell component (DRY)
- Wires up the previously-dead moveLine() helper
- Data persistence unchanged (sort_order reassigned on save)"
```

---

## Task 2: Per-line styling (bold/italic/highlight)

**Why third:** Depends on Task 0's schema. Touches the same lines rendering as Task 1, so doing them back-to-back reduces merge friction.

**Files:**
- Modify: `src/renderer/modules/invoices/InvoiceForm.tsx` — LineItem interface, newLineItem, edit-loader, save payload, UI toolbar
- Modify: `src/renderer/lib/print-templates.ts` — apply styles in `lineRows.map`

**Step 1: Add fields to LineItem interface (line 43)**

```typescript
interface LineItem {
  // ... existing fields ...
  bold: number;
  italic: number;
  highlight_color: string;
}
```

**Step 2: Update newLineItem() defaults (line 114)**

Add at the end of the object literal:

```typescript
  bold: 0,
  italic: 0,
  highlight_color: '',
```

**Step 3: Update the edit-mode line loader (around line 400)**

Find where existing invoice lines are mapped to state. Add the three fields to the mapping:

```typescript
setLines(result.map((l: any) => ({
  // ... existing fields ...
  bold: l.bold ?? 0,
  italic: l.italic ?? 0,
  highlight_color: l.highlight_color ?? '',
})));
```

**Step 4: Update the save payload (around line 660-670)**

Find the save logic that builds `line_items` for `api.saveInvoice(...)`. Ensure these fields are included:

```typescript
lineItemsPayload.push({
  // ... existing fields ...
  bold: l.bold || 0,
  italic: l.italic || 0,
  highlight_color: l.highlight_color || '',
  sort_order: idx,
});
```

**Step 5: Add Bold/Italic icons to imports**

```typescript
import { ..., Bold, Italic } from 'lucide-react';
```

**Step 6: Add hover-toolbar state**

After the drag state from Task 1:

```typescript
const [hoveredLineIdx, setHoveredLineIdx] = useState<number | null>(null);
```

**Step 7: Add the style toolbar to item rows**

Inside the item row rendering (not section/note/subtotal/spacer/image — just the main item row around line 996), add inside the first `<td>` (or next to GripCell) an absolutely-positioned popover:

```tsx
{hoveredLineIdx === idx && (
  <div style={{
    position: 'absolute',
    left: '30px',
    top: '2px',
    zIndex: 20,
    display: 'flex',
    gap: 2,
    padding: '3px 4px',
    background: 'var(--color-bg-elevated)',
    border: '1px solid var(--color-border-primary)',
    borderRadius: 4,
  }}>
    <button
      type="button"
      title="Bold"
      onClick={() => updateLine(idx, 'bold', line.bold ? 0 : 1)}
      style={{
        background: line.bold ? 'var(--color-accent-blue)' : 'transparent',
        color: line.bold ? '#fff' : 'var(--color-text-muted)',
        border: 'none', padding: '2px 4px', cursor: 'pointer', borderRadius: 2,
      }}
    >
      <Bold size={10} />
    </button>
    <button
      type="button"
      title="Italic"
      onClick={() => updateLine(idx, 'italic', line.italic ? 0 : 1)}
      style={{
        background: line.italic ? 'var(--color-accent-blue)' : 'transparent',
        color: line.italic ? '#fff' : 'var(--color-text-muted)',
        border: 'none', padding: '2px 4px', cursor: 'pointer', borderRadius: 2,
      }}
    >
      <Italic size={10} />
    </button>
    <div style={{ width: 1, background: 'var(--color-border-primary)', margin: '0 2px' }} />
    {['', '#fef9c3', '#dbeafe', '#fecaca', '#dcfce7'].map((color) => (
      <button
        key={color || 'none'}
        type="button"
        title={color ? `Highlight ${color}` : 'No highlight'}
        onClick={() => updateLine(idx, 'highlight_color', color)}
        style={{
          background: color || 'transparent',
          border: line.highlight_color === color
            ? '2px solid var(--color-accent-blue)'
            : '1px solid var(--color-border-primary)',
          width: 14, height: 14, cursor: 'pointer', borderRadius: 2,
          backgroundImage: color ? 'none' : 'linear-gradient(45deg, transparent 45%, #ef4444 45%, #ef4444 55%, transparent 55%)',
        }}
      />
    ))}
  </div>
)}
```

Add `onMouseEnter={() => setHoveredLineIdx(idx)}` and `onMouseLeave={() => setHoveredLineIdx(null)}` to the item `<tr>`. Make the first item cell `position: relative` so the popover positions correctly.

**Step 8: Apply styles to the item row description input**

When bold/italic/highlight are set, the visual preview in the form should reflect them. Find the description input in the item row and apply inline styles:

```tsx
<input
  className="block-input"
  style={{
    fontWeight: line.bold ? 700 : undefined,
    fontStyle: line.italic ? 'italic' : undefined,
    background: line.highlight_color || undefined,
  }}
  value={line.description}
  onChange={(e) => updateLine(idx, 'description', e.target.value)}
/>
```

**Step 9: Update print template**

Open `src/renderer/lib/print-templates.ts`, find the `lineRows.map` function inside `generateInvoiceHTML` (around line 224 where `rowType` is extracted), and within the item row rendering (the default case, not spacer/section/note/subtotal/image), add the style computation:

```typescript
const lineStyleAttr = [
  l.bold ? 'font-weight:700' : '',
  l.italic ? 'font-style:italic' : '',
  l.highlight_color ? `background:${l.highlight_color}` : '',
].filter(Boolean).join(';');
```

Apply this to the description `<td>` in the item row template (the `<td>` that contains the description text). Append to any existing style attribute:

```typescript
return `<tr ${l.highlight_color ? `style="background:${l.highlight_color}"` : ''}>
  <td style="${existingStyle};${lineStyleAttr}">${desc}</td>
  ...
</tr>`;
```

If the existing template uses class-based styling without inline styles, add `style="${lineStyleAttr}"` to the `<tr>` or the description `<td>`.

**Step 10: Type check**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: Only the pre-existing deprecation.

**Step 11: Commit**

```bash
git add src/renderer/modules/invoices/InvoiceForm.tsx src/renderer/lib/print-templates.ts
git commit -m "feat(invoice): per-line styling (bold/italic/highlight)

- 3 new columns on invoice_line_items (bold, italic, highlight_color)
- Inline hover toolbar with Bold/Italic toggles + 4 highlight presets
- Live preview in form (input shows bold/italic/highlight immediately)
- PDF template applies same styles via inline style attribute
- Presets: pastel yellow/blue/red/green (print-safe in grayscale)"
```

---

## Task 3: Custom header fields (4 slots)

**Why fourth:** Depends on Task 0's schema. Touches InvoiceSettings, InvoiceForm, and print-templates — 3 files but small changes each.

**Files:**
- Modify: `src/renderer/modules/invoices/InvoiceSettings.tsx` — add 4 label inputs in a new "Custom Fields" card
- Modify: `src/renderer/modules/invoices/InvoiceForm.tsx` — InvoiceFormData interface, loader, save payload, conditional render
- Modify: `src/renderer/lib/print-templates.ts` — InvoiceSettings interface, render custom fields in meta-row
- Modify: `src/renderer/modules/invoices/InvoiceDetail.tsx` — display custom fields if labels set

**Step 1: Update `FullSettings` type in InvoiceSettings.tsx (line 38)**

```typescript
type FullSettings = ISettings & {
  footer_text: string;
  default_notes: string;
  default_terms_text: string;
  default_due_days: number;
  show_payment_terms: boolean;
  payment_qr_url: string;
  show_payment_qr: boolean;
  custom_field_1_label: string;
  custom_field_2_label: string;
  custom_field_3_label: string;
  custom_field_4_label: string;
};
```

**Step 2: Add defaults to `DEFAULT_SETTINGS` (line 48)**

```typescript
  custom_field_1_label: '',
  custom_field_2_label: '',
  custom_field_3_label: '',
  custom_field_4_label: '',
```

**Step 3: Add loader mappings (line 133)**

Inside `setSettings({...})` in the load useEffect, add:

```typescript
  custom_field_1_label: data.custom_field_1_label || '',
  custom_field_2_label: data.custom_field_2_label || '',
  custom_field_3_label: data.custom_field_3_label || '',
  custom_field_4_label: data.custom_field_4_label || '',
```

**Step 4: Add Custom Fields card to the settings UI**

Find the existing "Footer Text" or "Defaults" card. After it, add a new card:

```tsx
<div className="block-card p-4 space-y-3" style={{ borderRadius: '6px' }}>
  <h3 className="text-sm font-bold text-text-primary">Custom Fields</h3>
  <p className="text-xs text-text-muted">
    Define up to 4 custom fields that appear on every invoice header. Leave a label blank to hide that field.
  </p>
  {[1, 2, 3, 4].map((n) => {
    const key = `custom_field_${n}_label` as keyof FullSettings;
    const placeholders = ['e.g. Purchase Order', 'e.g. Department', 'e.g. Contract #', 'e.g. Cost Center'];
    return (
      <div key={n}>
        <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
          Field {n} Label
        </label>
        <input
          className="block-input"
          placeholder={placeholders[n - 1]}
          value={(settings[key] as string) || ''}
          onChange={(e) => setSettings((s) => ({ ...s, [key]: e.target.value }))}
        />
      </div>
    );
  })}
</div>
```

**Step 5: Update InvoiceFormData in InvoiceForm.tsx (line 83)**

```typescript
interface InvoiceFormData {
  // ... existing fields ...
  custom_field_1: string;
  custom_field_2: string;
  custom_field_3: string;
  custom_field_4: string;
}
```

**Step 6: Add to EMPTY_FORM defaults and edit-loader**

Find the default form state (likely near the top of the component) and add:

```typescript
custom_field_1: '',
custom_field_2: '',
custom_field_3: '',
custom_field_4: '',
```

In the edit-loader, add the mappings from the loaded invoice:

```typescript
custom_field_1: inv.custom_field_1 || '',
custom_field_2: inv.custom_field_2 || '',
custom_field_3: inv.custom_field_3 || '',
custom_field_4: inv.custom_field_4 || '',
```

In the save payload, include them explicitly.

**Step 7: Render custom field inputs conditionally in the form**

Find the header/meta section where PO Number and Job Reference already render. Add after them:

```tsx
{[1, 2, 3, 4].map((n) => {
  const label = (invoiceSettings as any)?.[`custom_field_${n}_label`];
  if (!label) return null;
  const key = `custom_field_${n}` as keyof InvoiceFormData;
  return (
    <div key={n}>
      <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1">
        {label}
      </label>
      <input
        className="block-input"
        value={(form[key] as string) || ''}
        onChange={(e) => updateField(key, e.target.value)}
      />
    </div>
  );
})}
```

**Step 8: Update print-templates.ts**

In the `InvoiceSettings` interface (around line 100), add:

```typescript
  custom_field_1_label?: string;
  custom_field_2_label?: string;
  custom_field_3_label?: string;
  custom_field_4_label?: string;
```

Inside `generateInvoiceHTML`, compute custom field rows:

```typescript
const customFieldRows = [1, 2, 3, 4]
  .map(n => ({
    label: settings?.[`custom_field_${n}_label` as keyof InvoiceSettings] as string | undefined,
    value: invoice[`custom_field_${n}`] as string | undefined,
  }))
  .filter(f => f.label && f.value)
  .map(f => `<div class="meta-item"><span class="meta-label">${escapeHTML(f.label!)}</span><span class="meta-value">${escapeHTML(f.value!)}</span></div>`)
  .join('');
```

Inject `${customFieldRows}` into the meta-row section of the HTML template, after the existing Invoice Date / Due Date / Payment Terms items.

If there's no `escapeHTML` helper, inline it as: `String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')`.

**Step 9: Type check**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: Only the pre-existing deprecation.

**Step 10: Commit**

```bash
git add src/renderer/modules/invoices/InvoiceSettings.tsx src/renderer/modules/invoices/InvoiceForm.tsx src/renderer/lib/print-templates.ts
git commit -m "feat(invoice): custom header fields (4 slots)

- Labels stored on invoice_settings (per-company config)
- Values stored on invoices (per-invoice data)
- Settings card: 4 label inputs with placeholder examples
- Form: custom field inputs only render when label is set
- PDF template: custom fields appear in meta-row, filtered by label+value"
```

---

## Task 4: Tax breakdown by rate

**Why fifth:** Pure compute logic, no schema changes. Touches InvoiceForm, InvoiceDetail, print-templates. Can be done independently but benefits from being near Task 3 since print-templates is open already.

**Files:**
- Modify: `src/renderer/modules/invoices/InvoiceForm.tsx` — compute taxByRate, render in totals sidebar
- Modify: `src/renderer/modules/invoices/InvoiceDetail.tsx` — same compute + render
- Modify: `src/renderer/lib/print-templates.ts` — same compute + render in totals-box

**Step 1: Add compute helper to InvoiceForm.tsx**

After the `taxTotal` useMemo (find it — likely around line 440 using `lines.filter(l => row_type === 'item').reduce`), add:

```typescript
const taxByRate = useMemo(() => {
  const map: Record<string, { taxable: number; tax: number }> = {};
  for (const l of lines) {
    if ((l.row_type || 'item') !== 'item') continue;
    const rate = l.tax_rate_override >= 0 ? l.tax_rate_override : l.tax_rate;
    if (rate <= 0) continue;
    const base = l.quantity * l.unit_price * (1 - (l.discount_pct || 0) / 100);
    const key = rate.toFixed(2);
    if (!map[key]) map[key] = { taxable: 0, tax: 0 };
    map[key].taxable += base;
    map[key].tax += base * (rate / 100);
  }
  return map;
}, [lines]);

const sortedTaxRates = useMemo(
  () => Object.keys(taxByRate).sort((a, b) => parseFloat(a) - parseFloat(b)),
  [taxByRate]
);
```

**Step 2: Render breakdown in the totals sidebar**

Find the totals section in the form (where `Subtotal`, `Tax`, `Total` are rendered — likely a sticky sidebar or a section below the lines table). Replace the single Tax line with:

```tsx
{sortedTaxRates.length > 1 ? (
  sortedTaxRates.map((rate) => (
    <div key={rate} className="flex justify-between text-sm">
      <span className="text-text-muted">Tax ({rate}% on {fmt.format(taxByRate[rate].taxable)})</span>
      <span className="font-mono">{fmt.format(taxByRate[rate].tax)}</span>
    </div>
  ))
) : (
  taxTotal > 0 && (
    <div className="flex justify-between text-sm">
      <span className="text-text-muted">Tax</span>
      <span className="font-mono">{fmt.format(taxTotal)}</span>
    </div>
  )
)}
```

Match the styling of the existing totals row markup (the JSX around the old Tax row).

**Step 3: Add same compute to InvoiceDetail.tsx**

InvoiceDetail reads `lines` from state. Add the same `taxByRate` and `sortedTaxRates` useMemos and update the totals display. Look for where the existing tax is rendered and apply the same conditional render pattern.

**Step 4: Add same compute to print-templates.ts**

Inside `generateInvoiceHTML`, after `lineRows` is computed, add:

```typescript
const taxByRate: Record<string, { taxable: number; tax: number }> = {};
for (const l of lineItems) {
  if ((l.row_type || 'item') !== 'item') continue;
  const rate = l.tax_rate_override >= 0 ? l.tax_rate_override : l.tax_rate;
  if (rate <= 0) continue;
  const base = l.quantity * l.unit_price * (1 - (l.discount_pct || 0) / 100);
  const key = rate.toFixed(2);
  if (!taxByRate[key]) taxByRate[key] = { taxable: 0, tax: 0 };
  taxByRate[key].taxable += base;
  taxByRate[key].tax += base * (rate / 100);
}
const sortedRates = Object.keys(taxByRate).sort((a, b) => parseFloat(a) - parseFloat(b));
const hasMultipleRates = sortedRates.length > 1;

const taxBreakdownHTML = hasMultipleRates
  ? sortedRates.map(rate =>
      `<div class="totals-row"><span>Tax (${rate}% on ${fmt(taxByRate[rate].taxable)})</span><span>${fmt(taxByRate[rate].tax)}</span></div>`
    ).join('')
  : (Number(invoice.tax_amount || 0) > 0
      ? `<div class="totals-row"><span>Tax</span><span>${fmt(invoice.tax_amount)}</span></div>`
      : '');
```

In the totals-box template section, replace the existing Tax row with `${taxBreakdownHTML}`.

**Step 5: Type check**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: Only the pre-existing deprecation.

**Step 6: Commit**

```bash
git add src/renderer/modules/invoices/InvoiceForm.tsx src/renderer/modules/invoices/InvoiceDetail.tsx src/renderer/lib/print-templates.ts
git commit -m "feat(invoice): tax breakdown by rate in totals section

- Pure compute logic, no schema changes
- Single-rate invoices render identically to before
- Multi-rate invoices show one line per distinct rate sorted ascending
- Format: 'Tax (4.00% on \$500.00): \$20.00'
- Compliance requirement (EU VAT Directive Art. 226, Texas Tax Code 151.005)
- Applied consistently across Form, Detail, and PDF template"
```

---

## Task 5: Catalog manager component

**Why last:** Biggest standalone addition. New file with no dependencies on earlier tasks. Easier to keep review focused.

**Files:**
- Create: `src/renderer/modules/invoices/CatalogManager.tsx` — new component
- Modify: `src/renderer/modules/invoices/index.tsx` — add 'catalog' view to router
- Modify: `src/renderer/modules/invoices/InvoiceList.tsx` — add "Catalog" button

**Step 1: Create CatalogManager.tsx**

Create `src/renderer/modules/invoices/CatalogManager.tsx` with:

```tsx
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { ArrowLeft, Plus, Search, Trash2, Package, CheckCircle } from 'lucide-react';
import api from '../../lib/api';
import { useCompanyStore } from '../../stores/companyStore';
import { formatCurrency } from '../../lib/format';

// ─── Types ──────────────────────────────────────────────
interface CatalogItem {
  id: string;
  company_id: string;
  name: string;
  description: string;
  default_price: number;
  default_quantity: number;
  default_unit: string;
  default_tax_rate: number;
  account_id: string;
  sku: string;
  created_at: string;
}

interface Account {
  id: string;
  name: string;
  code: string;
}

interface FormState {
  name: string;
  description: string;
  sku: string;
  default_price: number;
  default_quantity: number;
  default_unit: string;
  default_tax_rate: number;
  account_id: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  sku: '',
  default_price: 0,
  default_quantity: 1,
  default_unit: '',
  default_tax_rate: 0,
  account_id: '',
};

interface CatalogManagerProps {
  onBack: () => void;
}

const CatalogManager: React.FC<CatalogManagerProps> = ({ onBack }) => {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const reload = useCallback(async () => {
    if (!activeCompany) return;
    try {
      const [itemRows, accountRows] = await Promise.all([
        api.query('invoice_catalog_items', { company_id: activeCompany.id }),
        api.query('accounts', { company_id: activeCompany.id, type: 'revenue' }),
      ]);
      setItems(Array.isArray(itemRows) ? (itemRows as CatalogItem[]) : []);
      setAccounts(Array.isArray(accountRows) ? (accountRows as Account[]) : []);
    } catch (err) {
      console.error('Failed to load catalog:', err);
    } finally {
      setLoading(false);
    }
  }, [activeCompany]);

  useEffect(() => {
    reload();
  }, [reload]);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q) ||
        (i.sku || '').toLowerCase().includes(q)
    );
  }, [items, search]);

  const handleNew = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const handleEdit = (item: CatalogItem) => {
    setEditingId(item.id);
    setForm({
      name: item.name,
      description: item.description || '',
      sku: item.sku || '',
      default_price: item.default_price || 0,
      default_quantity: item.default_quantity || 1,
      default_unit: item.default_unit || '',
      default_tax_rate: item.default_tax_rate || 0,
      account_id: item.account_id || '',
    });
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        await api.update('invoice_catalog_items', editingId, form);
      } else {
        const result = await api.create('invoice_catalog_items', {
          ...form,
          company_id: activeCompany?.id,
        });
        if (result?.id) setEditingId(result.id);
      }
      await reload();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save catalog item:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete catalog item "${name}"? This cannot be undone.`)) return;
    try {
      await api.remove('invoice_catalog_items', id);
      if (editingId === id) {
        setEditingId(null);
        setForm(EMPTY_FORM);
      }
      await reload();
    } catch (err) {
      console.error('Failed to delete catalog item:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-text-muted text-sm">
        Loading catalog...
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 h-full overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <button className="block-btn flex items-center gap-2 px-3 py-2" onClick={onBack}>
            <ArrowLeft size={14} /> Back
          </button>
          <div>
            <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
              <Package size={18} /> Catalog Items
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              Save frequently-used invoice line items for one-click reuse.
            </p>
          </div>
        </div>
        <button className="block-btn-primary flex items-center gap-2" onClick={handleNew}>
          <Plus size={14} /> New Item
        </button>
      </div>

      {/* Split view */}
      <div className="flex-1 grid grid-cols-5 gap-4 overflow-hidden">
        {/* Left: list */}
        <div className="col-span-2 flex flex-col overflow-hidden">
          <div className="relative mb-2 flex-shrink-0">
            <Search size={14} className="absolute left-2 top-2.5 text-text-muted" />
            <input
              className="block-input pl-8"
              placeholder="Search by name, SKU, description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex-1 overflow-y-auto space-y-1.5">
            {filtered.length === 0 ? (
              <div className="text-center py-8 text-text-muted text-xs">
                {items.length === 0 ? 'No catalog items yet. Click "New Item" to add one.' : 'No matches for search.'}
              </div>
            ) : (
              filtered.map((item) => (
                <div
                  key={item.id}
                  className={`p-2.5 border cursor-pointer transition-colors ${
                    editingId === item.id
                      ? 'border-accent-blue bg-accent-blue/5'
                      : 'border-border-primary hover:bg-bg-hover'
                  }`}
                  style={{ borderRadius: '6px' }}
                  onClick={() => handleEdit(item)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-text-primary truncate">{item.name}</p>
                      {item.description && (
                        <p className="text-xs text-text-muted truncate">{item.description}</p>
                      )}
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs font-mono text-accent-income">
                          {formatCurrency(item.default_price)}
                        </span>
                        {item.default_unit && (
                          <span className="text-[10px] text-text-muted">/ {item.default_unit}</span>
                        )}
                        {item.sku && (
                          <span className="text-[10px] font-mono text-text-muted">SKU: {item.sku}</span>
                        )}
                      </div>
                    </div>
                    <button
                      className="text-text-muted hover:text-accent-expense transition-colors p-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(item.id, item.name);
                      }}
                      title="Delete"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: form */}
        <div className="col-span-3 flex flex-col overflow-y-auto">
          <div className="block-card p-5 space-y-4" style={{ borderRadius: '6px' }}>
            <div className="flex items-center justify-between pb-2 border-b border-border-primary">
              <h3 className="text-sm font-bold text-text-primary">
                {editingId ? 'Edit Item' : 'New Item'}
              </h3>
              {saved && (
                <span className="text-xs text-accent-income flex items-center gap-1">
                  <CheckCircle size={12} /> Saved
                </span>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Name <span className="text-accent-expense">*</span>
              </label>
              <input
                className="block-input"
                placeholder="e.g. Web Design — Hourly"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Description
              </label>
              <textarea
                className="block-input"
                rows={3}
                placeholder="Detailed description that auto-fills on invoices..."
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                style={{ resize: 'vertical' }}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  SKU / Item Code
                </label>
                <input
                  className="block-input"
                  placeholder="e.g. WEB-DESIGN-001"
                  value={form.sku}
                  onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Default Unit
                </label>
                <input
                  className="block-input"
                  placeholder="hrs, ea, kg, etc."
                  value={form.default_unit}
                  onChange={(e) => setForm((f) => ({ ...f, default_unit: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Default Price
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="block-input font-mono"
                  value={form.default_price}
                  onChange={(e) => setForm((f) => ({ ...f, default_price: parseFloat(e.target.value) || 0 }))}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Default Qty
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="block-input font-mono"
                  value={form.default_quantity}
                  onChange={(e) => setForm((f) => ({ ...f, default_quantity: parseFloat(e.target.value) || 0 }))}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                  Tax Rate %
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="block-input font-mono"
                  value={form.default_tax_rate}
                  onChange={(e) => setForm((f) => ({ ...f, default_tax_rate: parseFloat(e.target.value) || 0 }))}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                Revenue Account
              </label>
              <select
                className="block-select w-full"
                value={form.account_id}
                onChange={(e) => setForm((f) => ({ ...f, account_id: e.target.value }))}
              >
                <option value="">— None —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-3 pt-2 border-t border-border-primary">
              <button
                className="block-btn-primary flex items-center gap-2"
                onClick={handleSave}
                disabled={saving || !form.name.trim()}
              >
                {saving ? 'Saving...' : editingId ? 'Update Item' : 'Save Item'}
              </button>
              {editingId && (
                <button className="block-btn" onClick={handleNew}>
                  Clear / New
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CatalogManager;
```

**Step 2: Wire up in invoices/index.tsx**

Open `src/renderer/modules/invoices/index.tsx`. Add import:

```typescript
import CatalogManager from './CatalogManager';
```

Update the view union type:

```typescript
type InvoiceView = 'list' | 'detail' | 'form' | 'settings' | 'catalog';
```

Add handler:

```typescript
const handleOpenCatalog = useCallback(() => setView('catalog'), []);
```

Add render branch:

```tsx
{view === 'catalog' && (
  <CatalogManager onBack={() => setView('list')} />
)}
```

Pass `onCatalog={handleOpenCatalog}` to `<InvoiceList>`.

**Step 3: Add Catalog button to InvoiceList.tsx**

Add to InvoiceListProps:

```typescript
interface InvoiceListProps {
  // ... existing props ...
  onCatalog?: () => void;
}
```

Destructure and add button next to Customize:

```tsx
{onCatalog && (
  <button className="block-btn flex items-center gap-2" onClick={onCatalog} title="Manage catalog items">
    <Package size={16} /> Catalog
  </button>
)}
```

Add `Package` to lucide imports:

```typescript
import { ..., Package } from 'lucide-react';
```

**Step 4: Type check**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: Only the pre-existing deprecation.

**Step 5: Commit**

```bash
git add src/renderer/modules/invoices/CatalogManager.tsx src/renderer/modules/invoices/index.tsx src/renderer/modules/invoices/InvoiceList.tsx
git commit -m "feat(invoice): catalog items manager UI

- NEW CatalogManager.tsx with split-view layout
- Left: searchable filtered list, click row to edit
- Right: full form with name, description, SKU, pricing, unit, tax, account
- 'Saved' flash indicator on successful save
- Uses existing invoice_catalog_items table (no schema changes)
- Wired into invoices module router as new 'catalog' view
- 'Catalog' button added to InvoiceList header actions"
```

---

## Task 6: Final verification and bundle

**Why last:** Smoke test everything together before building/installing.

**Files:** None

**Step 1: Full type check**

Run: `npx tsc --noEmit 2>&1`
Expected: Only the pre-existing `baseUrl` deprecation.

**Step 2: Build**

Run: `npm run build 2>&1 | tail -10`
Expected: `✓ built in XXXms` with no errors.

**Step 3: Package**

Run: `npx electron-builder --mac --arm64 2>&1 | tail -5`
Expected: Build succeeds. Codesign may be skipped (that's normal).

**Step 4: Codesign**

Run: `bash scripts/codesign-mac.sh "release/mac-arm64/Business Accounting Pro.app" 2>&1 | tail -3`
Expected: `✓ Signature valid — all binaries share the same identity`

**Step 5: Install**

```bash
rm -rf "/Applications/Business Accounting Pro.app"
cp -R "release/mac-arm64/Business Accounting Pro.app" "/Applications/Business Accounting Pro.app"
xattr -cr "/Applications/Business Accounting Pro.app"
npm rebuild better-sqlite3
```

Expected: `rebuilt dependencies successfully`

**Step 6: Push**

```bash
git push origin main
```

**Step 7: Deploy**

Run: `npm run deploy 2>&1 | tail -10`
Expected: GitHub up-to-date + `Deploy complete.` for VPS.

---

## Rollback plan

If any migration causes issues, the `try/catch` in `database/index.ts:335-337` silently ignores failed migrations ("column already exists — ignore"). To fully roll back, manually drop the added columns via SQLite CLI — but this is rarely needed because all defaults are `0` / `''` and don't break existing code paths.

For renderer issues, `git revert <commit-sha>` undoes the specific task that broke.
