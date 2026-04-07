# Full Invoice Studio Design

**Date:** 2026-04-07
**Approach:** C — Full Invoice Studio
**Scope:** Rich line item types, advanced visual customization, PDF extras

---

## Overview

Elevate the invoice system from a functional form into a full design studio. The user can compose invoices with rich content rows (section headers, subtotals, notes, images, spacers), customize every visual aspect of the output (5 templates, column configurator, branding controls, fonts, watermark), and enrich the PDF with payment QR codes and milestone payment schedules.

---

## Part 1: Rich Line Item Types

### 1.1 Line Item Row Schema

Add `row_type` to the `invoice_lines` table and `LineItem` TypeScript type:

```sql
ALTER TABLE invoice_lines ADD COLUMN row_type TEXT DEFAULT 'item';
ALTER TABLE invoice_lines ADD COLUMN unit_label TEXT DEFAULT '';
ALTER TABLE invoice_lines ADD COLUMN item_code TEXT DEFAULT '';
ALTER TABLE invoice_lines ADD COLUMN line_discount REAL DEFAULT 0;
ALTER TABLE invoice_lines ADD COLUMN line_discount_type TEXT DEFAULT 'percent';
```

Row types and their behavior:

| `row_type` | Form editor | PDF output |
|---|---|---|
| `item` | Full row: code, description, qty, unit, price, discount, tax, amount | Standard line |
| `section` | Bold full-width text input, no pricing columns | Bold heading, spans full width, shaded background |
| `note` | Italic textarea, no pricing | Italic text, indented, muted color |
| `subtotal` | Read-only subtotal of `item` rows since last subtotal/start | Subtotal line with separator above |
| `image` | File picker (base64, max 200KB) + caption input | Inline image with caption |
| `spacer` | Empty row, no inputs | Blank vertical gap |

### 1.2 Per-Item Enhancements (on `item` rows)

- **Unit label**: dropdown selector — `hrs`, `days`, `units`, `ea`, `mo`, `flat`, or custom freetext. Shown after Qty column in PDF.
- **Item code/SKU**: short alphanumeric code shown as a small prefix badge on the description in PDF. Optional.
- **Per-line discount**: optional discount field (toggle to show). Type: `percent` (%) or `flat` ($). Applied before tax. Stored as `line_discount` + `line_discount_type`.
- **Drag reorder**: drag handle (`GripVertical` icon) on each row for reordering. Uses `@dnd-kit/core` (already a standard approach, or manual drag with `onDragStart`/`onDrop`).

### 1.3 Row Type Toolbar

Replace the single "Add Line" button with a row type picker:

```
[+ Item]  [— Section]  [✎ Note]  [∑ Subtotal]  [⎘ Image]  [· Spacer]
```

Each button appends a new row of the given type.

### 1.4 Catalog Enhancement

- Catalog items gain `item_code` and `unit_label` fields
- Saved catalog items include these per-item fields
- Catalog dropdown shows item code badge and unit label

---

## Part 2: Visual Customization

### 2.1 Five Template Designs

Replace the current 3 templates with 5 in `print-templates.ts`:

| Template | Description |
|---|---|
| **Classic** | Accent-colored header bar, clean table, accent-colored totals border |
| **Modern** | Bold colored left panel, alternating row stripes, colored table headers |
| **Minimal** | Ultra-clean, hairline borders only, no background fills, maximum whitespace |
| **Executive** | Two-tone split header (accent top-half, white bottom-half), large company name watermark behind totals, serif-adjacent feel |
| **Compact** | Dense layout for multi-page invoices, smaller font size (11px base), tighter row padding, fits more line items per page |

### 2.2 Column Configurator

New `invoice_column_config` JSON blob in `invoice_settings`:

```json
{
  "columns": [
    { "key": "item_code", "label": "Code",   "visible": true,  "order": 0 },
    { "key": "description","label": "Description","visible": true, "order": 1 },
    { "key": "quantity",  "label": "Qty",    "visible": true,  "order": 2 },
    { "key": "unit_label","label": "Unit",   "visible": false, "order": 3 },
    { "key": "unit_price","label": "Rate",   "visible": true,  "order": 4 },
    { "key": "tax_rate",  "label": "Tax %",  "visible": true,  "order": 5 },
    { "key": "amount",    "label": "Amount", "visible": true,  "order": 6 }
  ]
}
```

- Rendered in Settings as a drag-reorder list with show/hide toggles and editable label fields
- `generateInvoiceHTML` reads column config to build table headers and cells dynamically
- `InvoiceForm.tsx` line item table also respects column visibility/order

### 2.3 Advanced Branding

New fields on `invoice_settings`:

```sql
ALTER TABLE invoice_settings ADD COLUMN secondary_color TEXT DEFAULT '#64748b';
ALTER TABLE invoice_settings ADD COLUMN watermark_text TEXT DEFAULT '';
ALTER TABLE invoice_settings ADD COLUMN watermark_opacity REAL DEFAULT 0.06;
ALTER TABLE invoice_settings ADD COLUMN font_family TEXT DEFAULT 'system';
ALTER TABLE invoice_settings ADD COLUMN header_layout TEXT DEFAULT 'logo-left';
ALTER TABLE invoice_settings ADD COLUMN column_config TEXT DEFAULT '{}';
```

**Secondary color** — used for alternating row backgrounds and section header fills in templates that support it.

**Watermark** — text rendered as a fixed, rotated, ultra-low-opacity overlay behind the invoice body (e.g. company name, "CONFIDENTIAL"). Controlled by `watermark_text` + `watermark_opacity` (0.02–0.15 range).

**Font family** — 4 options embedded in PDF via web-safe font stacks:
- `system` — system-ui, -apple-system, sans-serif (current)
- `inter` — 'Segoe UI', Optima, Arial, sans-serif (clean sans-serif)
- `georgia` — Georgia, 'Times New Roman', serif (professional serif)
- `mono` — 'Courier New', Courier, monospace (techy/tech invoices)

**Header layout** — 3 options:
- `logo-left` — logo + company info on left, invoice title/number on right (current)
- `logo-center` — centered logo above full-width company info bar
- `logo-right` — invoice title on left, logo + company info on right

### 2.4 Settings UI Changes

`InvoiceSettings.tsx` gains new sections:

1. **Template** — 5 cards (was 3), each shows a mini visual preview thumbnail
2. **Columns** — drag-reorder list: each column has visibility toggle + editable label
3. **Branding** — primary accent (existing) + secondary accent + watermark text + watermark opacity slider
4. **Font & Layout** — font family selector (4 options) + header layout selector (3 options)
5. **Footer & Defaults** — unchanged from current

---

## Part 3: PDF Extras

### 3.1 QR Code Payment Link

- New field `payment_qr_url` in `invoice_settings` (configurable base URL)
- New field `show_payment_qr` boolean toggle
- When enabled, a QR code SVG is rendered inline in the PDF footer area
- QR code links to `{payment_qr_url}/{invoice_number}` (e.g. stripe payment page)
- QR generated client-side using a tiny SVG-based QR library (`qrcode-svg` or inline pure-JS implementation — no large deps)

### 3.2 Payment Schedule Table

- New DB table: `invoice_payment_schedule` (invoice_id, milestone_label, due_date, amount)
- New UI tab in InvoiceForm: **Payment Schedule** sub-section (only shown when enabled)
- Toggle: "Split into payment milestones"
- When active: renders a milestone table in the PDF between the totals box and footer
- Example: "Deposit 50% — due 2026-04-15 — $1,325.00", "Balance — due 2026-05-06 — $1,325.00"

---

## Database Migrations

```sql
-- Line items
ALTER TABLE invoice_lines ADD COLUMN row_type TEXT DEFAULT 'item';
ALTER TABLE invoice_lines ADD COLUMN unit_label TEXT DEFAULT '';
ALTER TABLE invoice_lines ADD COLUMN item_code TEXT DEFAULT '';
ALTER TABLE invoice_lines ADD COLUMN line_discount REAL DEFAULT 0;
ALTER TABLE invoice_lines ADD COLUMN line_discount_type TEXT DEFAULT 'percent';

-- Invoice settings
ALTER TABLE invoice_settings ADD COLUMN secondary_color TEXT DEFAULT '#64748b';
ALTER TABLE invoice_settings ADD COLUMN watermark_text TEXT DEFAULT '';
ALTER TABLE invoice_settings ADD COLUMN watermark_opacity REAL DEFAULT 0.06;
ALTER TABLE invoice_settings ADD COLUMN font_family TEXT DEFAULT 'system';
ALTER TABLE invoice_settings ADD COLUMN header_layout TEXT DEFAULT 'logo-left';
ALTER TABLE invoice_settings ADD COLUMN column_config TEXT DEFAULT '{}';
ALTER TABLE invoice_settings ADD COLUMN payment_qr_url TEXT DEFAULT '';
ALTER TABLE invoice_settings ADD COLUMN show_payment_qr INTEGER DEFAULT 0;

-- Catalog items
ALTER TABLE catalog_items ADD COLUMN item_code TEXT DEFAULT '';
ALTER TABLE catalog_items ADD COLUMN unit_label TEXT DEFAULT '';

-- Payment schedule
CREATE TABLE IF NOT EXISTS invoice_payment_schedule (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  milestone_label TEXT NOT NULL,
  due_date TEXT NOT NULL,
  amount REAL NOT NULL,
  paid INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
```

---

## Files to Create / Modify

### New Files
- `src/renderer/modules/invoices/RowTypeToolbar.tsx` — row type picker button group
- `src/renderer/modules/invoices/LineItemRow.tsx` — single row component (replaces inline JSX in form)
- `src/renderer/modules/invoices/ColumnConfigurator.tsx` — drag-reorder column settings UI
- `src/renderer/modules/invoices/PaymentScheduleEditor.tsx` — milestone schedule editor

### Modified Files
- `src/renderer/lib/print-templates.ts` — 5 templates, column-aware table builder, watermark, QR, payment schedule, font/layout/secondary color support
- `src/renderer/modules/invoices/InvoiceForm.tsx` — row_type support, per-item fields, drag reorder, payment schedule section
- `src/renderer/modules/invoices/InvoiceSettings.tsx` — new branding/font/layout/column sections
- `src/main/database/index.ts` — add all migrations above to migrations array + tablesWithoutUpdatedAt
- `src/main/ipc/index.ts` — invoice_payment_schedule in tablesWithoutCompanyId if needed; payment schedule CRUD handlers
- `src/renderer/lib/api.ts` — payment schedule API methods
- `src/shared/types.ts` — updated LineItem, InvoiceSettings types

---

## Implementation Order

1. DB migrations
2. Type updates (`shared/types.ts`)
3. `print-templates.ts` — 5 templates + column config + branding extras
4. `LineItemRow.tsx` + `RowTypeToolbar.tsx` — row type system
5. `InvoiceForm.tsx` — wire row types, per-item fields, drag reorder
6. `ColumnConfigurator.tsx` + wire into `InvoiceSettings.tsx`
7. New branding/font/layout settings in `InvoiceSettings.tsx`
8. `PaymentScheduleEditor.tsx` + IPC handlers
9. QR code in PDF
10. End-to-end smoke test + build verify
