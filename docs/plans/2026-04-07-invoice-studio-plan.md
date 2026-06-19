# Full Invoice Studio Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the invoice system into a full design studio with rich line item types, 5 visual templates, column configurator, advanced branding controls, QR payment links, and milestone payment schedules.

**Architecture:** New `row_type` field on `invoice_lines` drives per-row rendering logic in both the React form and `generateInvoiceHTML`. Settings are extended with branding/font/column JSON stored in `invoice_settings`. All PDF output is self-contained HTML in `print-templates.ts`.

**Tech Stack:** React 19, TypeScript, SQLite (better-sqlite3), Electron IPC, inline CSS in HTML string templates.

> **No test runner.** Verification = `npm run build` (TypeScript compile check) + visual inspection in the running Electron app. Each task ends with a build verify step and a commit.

---

### Task 1: DB Migrations + tablesWithout* Updates

**Files:**
- Modify: `src/main/database/index.ts` (migrations array + tablesWithoutUpdatedAt)
- Modify: `src/main/ipc/index.ts` (tablesWithoutCompanyId)

**Step 1: Add migrations to `src/main/database/index.ts`**

Find the `migrations` array (around line 41). Append these entries **before** the closing `];`:

```typescript
    // Invoice Studio (2026-04-07) — line item enhancements
    "ALTER TABLE invoice_line_items ADD COLUMN row_type TEXT DEFAULT 'item'",
    "ALTER TABLE invoice_line_items ADD COLUMN unit_label TEXT DEFAULT ''",
    "ALTER TABLE invoice_line_items ADD COLUMN item_code TEXT DEFAULT ''",
    "ALTER TABLE invoice_line_items ADD COLUMN line_discount REAL DEFAULT 0",
    "ALTER TABLE invoice_line_items ADD COLUMN line_discount_type TEXT DEFAULT 'percent'",
    // Invoice Studio — settings enhancements
    "ALTER TABLE invoice_settings ADD COLUMN secondary_color TEXT DEFAULT '#64748b'",
    "ALTER TABLE invoice_settings ADD COLUMN watermark_text TEXT DEFAULT ''",
    "ALTER TABLE invoice_settings ADD COLUMN watermark_opacity REAL DEFAULT 0.06",
    "ALTER TABLE invoice_settings ADD COLUMN font_family TEXT DEFAULT 'system'",
    "ALTER TABLE invoice_settings ADD COLUMN header_layout TEXT DEFAULT 'logo-left'",
    "ALTER TABLE invoice_settings ADD COLUMN column_config TEXT DEFAULT '{}'",
    "ALTER TABLE invoice_settings ADD COLUMN payment_qr_url TEXT DEFAULT ''",
    "ALTER TABLE invoice_settings ADD COLUMN show_payment_qr INTEGER DEFAULT 0",
    // Invoice Studio — catalog enhancements
    "ALTER TABLE invoice_catalog_items ADD COLUMN item_code TEXT DEFAULT ''",
    "ALTER TABLE invoice_catalog_items ADD COLUMN unit_label TEXT DEFAULT ''",
    // Invoice Studio — payment schedule table
    `CREATE TABLE IF NOT EXISTS invoice_payment_schedule (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      milestone_label TEXT NOT NULL DEFAULT '',
      due_date TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      paid INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
```

**Step 2: Add `invoice_payment_schedule` to `tablesWithoutUpdatedAt`**

In `src/main/database/index.ts` around line 180, find `const tablesWithoutUpdatedAt = new Set([` and add `'invoice_payment_schedule'` to the set.

**Step 3: Add `invoice_payment_schedule` to `tablesWithoutCompanyId`**

In `src/main/ipc/index.ts` around line 400, find `const tablesWithoutCompanyId = new Set([` and add `'invoice_payment_schedule'` to the set (it links to `invoices` which carries `company_id`).

**Step 4: Build verify**

```bash
cd "/Users/rmpgutah/Business Accounting Pro" && npm run build 2>&1 | tail -20
```

Expected: no TypeScript errors (warnings OK).

**Step 5: Commit**

```bash
git add src/main/database/index.ts src/main/ipc/index.ts
git commit -m "feat: invoice studio DB migrations — line item types, settings branding, payment schedule"
```

---

### Task 2: Update Shared Types + API Methods

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/lib/api.ts`

**Step 1: Update `LineItem` type in `src/shared/types.ts`**

Find the `Invoice` or `InvoiceLineItem` interface (search for `invoice_line_items` or `InvoiceLine`). If none exists as a shared type, add one. Add the new fields:

```typescript
export type LineRowType = 'item' | 'section' | 'note' | 'subtotal' | 'image' | 'spacer';

export interface InvoiceLineItem {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  amount: number;
  account_id: string | null;
  sort_order: number;
  // Invoice Studio additions
  row_type: LineRowType;
  unit_label: string;
  item_code: string;
  line_discount: number;
  line_discount_type: 'percent' | 'flat';
}

export interface InvoicePaymentMilestone {
  id: string;
  invoice_id: string;
  milestone_label: string;
  due_date: string;
  amount: number;
  paid: boolean;
  sort_order: number;
}

export interface InvoiceColumnConfig {
  key: string;
  label: string;
  visible: boolean;
  order: number;
}
```

**Step 2: Add payment schedule API methods to `src/renderer/lib/api.ts`**

Find the `saveInvoice` area (around line 80–100 based on prior context). Add these before or after the invoice settings methods:

```typescript
  listPaymentSchedule: (invoiceId: string): Promise<any[]> =>
    window.electronAPI.invoke('invoice:payment-schedule-list', invoiceId),
  savePaymentSchedule: (invoiceId: string, milestones: any[]): Promise<void> =>
    window.electronAPI.invoke('invoice:payment-schedule-save', { invoiceId, milestones }),
```

**Step 3: Build verify**

```bash
npm run build 2>&1 | tail -20
```

**Step 4: Commit**

```bash
git add src/shared/types.ts src/renderer/lib/api.ts
git commit -m "feat: invoice studio types — LineRowType, InvoicePaymentMilestone, column config"
```

---

### Task 3: IPC Handlers for Payment Schedule

**Files:**
- Modify: `src/main/ipc/index.ts`

**Step 1: Add payment schedule handlers**

Find the invoice IPC section (search for `invoice:get-settings` in `src/main/ipc/index.ts`). Add these handlers nearby:

```typescript
  ipcMain.handle('invoice:payment-schedule-list', (_event, invoiceId: string) => {
    try {
      return db.getDb()
        .prepare('SELECT * FROM invoice_payment_schedule WHERE invoice_id = ? ORDER BY sort_order ASC')
        .all(invoiceId);
    } catch (err) {
      return [];
    }
  });

  ipcMain.handle('invoice:payment-schedule-save', (_event, { invoiceId, milestones }: { invoiceId: string; milestones: any[] }) => {
    try {
      const database = db.getDb();
      database.prepare('DELETE FROM invoice_payment_schedule WHERE invoice_id = ?').run(invoiceId);
      const insert = database.prepare(
        'INSERT INTO invoice_payment_schedule (id, invoice_id, milestone_label, due_date, amount, paid, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      const run = database.transaction(() => {
        milestones.forEach((m, i) => {
          insert.run(
            require('uuid').v4(),
            invoiceId,
            m.milestone_label || '',
            m.due_date || '',
            Number(m.amount) || 0,
            m.paid ? 1 : 0,
            i
          );
        });
      });
      run();
      return { ok: true };
    } catch (err: any) {
      return { error: err.message };
    }
  });
```

**Step 2: Build verify**

```bash
npm run build 2>&1 | tail -20
```

**Step 3: Commit**

```bash
git add src/main/ipc/index.ts
git commit -m "feat: invoice payment schedule IPC handlers"
```

---

### Task 4: Extend `print-templates.ts` — 5 Templates + Column Config + Branding

**Files:**
- Modify: `src/renderer/lib/print-templates.ts`

This is the biggest task. Replace/extend the `InvoiceSettings` interface and `generateInvoiceHTML` function.

**Step 1: Extend the `InvoiceSettings` interface**

Find `export interface InvoiceSettings` and replace it:

```typescript
export type InvoiceColumnKey = 'item_code' | 'description' | 'quantity' | 'unit_label' | 'unit_price' | 'tax_rate' | 'amount';

export interface InvoiceColumnConfig {
  key: InvoiceColumnKey;
  label: string;
  visible: boolean;
  order: number;
}

export const DEFAULT_COLUMNS: InvoiceColumnConfig[] = [
  { key: 'item_code',   label: 'Code',    visible: false, order: 0 },
  { key: 'description', label: 'Description', visible: true, order: 1 },
  { key: 'quantity',    label: 'Qty',     visible: true,  order: 2 },
  { key: 'unit_label',  label: 'Unit',    visible: false, order: 3 },
  { key: 'unit_price',  label: 'Rate',    visible: true,  order: 4 },
  { key: 'tax_rate',    label: 'Tax %',   visible: true,  order: 5 },
  { key: 'amount',      label: 'Amount',  visible: true,  order: 6 },
];

export interface InvoiceSettings {
  accent_color?: string;
  secondary_color?: string;
  logo_data?: string | null;
  template_style?: 'classic' | 'modern' | 'minimal' | 'executive' | 'compact';
  show_logo?: boolean | number;
  show_tax_column?: boolean | number;
  show_payment_terms?: boolean | number;
  footer_text?: string;
  watermark_text?: string;
  watermark_opacity?: number;
  font_family?: 'system' | 'inter' | 'georgia' | 'mono';
  header_layout?: 'logo-left' | 'logo-center' | 'logo-right';
  column_config?: InvoiceColumnConfig[] | string;
  payment_qr_url?: string;
  show_payment_qr?: boolean | number;
}
```

**Step 2: Add a column resolver helper** (right after the interface):

```typescript
export function resolveColumns(settings?: InvoiceSettings): InvoiceColumnConfig[] {
  let cols: InvoiceColumnConfig[] = DEFAULT_COLUMNS;
  if (settings?.column_config) {
    try {
      const raw = typeof settings.column_config === 'string'
        ? JSON.parse(settings.column_config)
        : settings.column_config;
      if (Array.isArray(raw) && raw.length > 0) cols = raw;
    } catch { /* use defaults */ }
  }
  // Legacy: if show_tax_column is false, hide tax_rate
  if (settings?.show_tax_column === 0 || settings?.show_tax_column === false) {
    cols = cols.map(c => c.key === 'tax_rate' ? { ...c, visible: false } : c);
  }
  return [...cols].sort((a, b) => a.order - b.order);
}
```

**Step 3: Add QR code SVG generator** (pure inline, no library):

```typescript
function simpleQrSvg(text: string, size = 80): string {
  // Minimal: just render the URL as a styled text block with border.
  // For a real QR, integrate qrcode-svg. For now this is a placeholder block.
  return `<div style="display:inline-flex;flex-direction:column;align-items:center;gap:4px;">
    <div style="width:${size}px;height:${size}px;border:2px solid #0f172a;display:flex;align-items:center;justify-content:center;font-size:8px;color:#64748b;text-align:center;padding:4px;word-break:break-all;">
      ${text.slice(0, 40)}
    </div>
    <span style="font-size:9px;color:#94a3b8;">Scan to pay</span>
  </div>`;
}
```

> **Note:** Replace with `qrcode-svg` package for production QR codes. The placeholder renders the URL text in a bordered box until then.

**Step 4: Add watermark CSS helper**:

```typescript
function watermarkCSS(text: string, opacity: number): string {
  if (!text) return '';
  return `
  .invoice-watermark {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-35deg);
    font-size: 72px;
    font-weight: 900;
    letter-spacing: 8px;
    text-transform: uppercase;
    color: #0f172a;
    opacity: ${Math.min(0.15, Math.max(0.01, opacity || 0.06))};
    pointer-events: none;
    white-space: nowrap;
    z-index: 0;
  }
  @media print { .invoice-watermark { position: fixed; } }
  `;
}
```

**Step 5: Add font stack helper**:

```typescript
function fontStack(family?: string): string {
  switch (family) {
    case 'inter':   return "'Segoe UI', Optima, 'Helvetica Neue', Arial, sans-serif";
    case 'georgia': return "Georgia, 'Palatino Linotype', 'Book Antiqua', Palatino, serif";
    case 'mono':    return "'Courier New', Courier, 'Lucida Console', monospace";
    default:        return "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  }
}
```

**Step 6: Rebuild `generateInvoiceHTML` to support all 5 templates + column config + row types + watermark + header layout**

This is a full replacement of the function body. The function signature stays the same. Key changes:
- Parse columns via `resolveColumns(settings)`
- Build table header dynamically from visible columns
- Build line rows by `row_type`:
  - `item` → standard row, apply `line_discount` before amount
  - `section` → full-width bold header row (`colspan` of all columns)
  - `note` → italic full-width row
  - `subtotal` → auto-calculated partial subtotal row
  - `image` → full-width image row (base64 src from `unit_price` field, caption from `description`)
  - `spacer` → empty row with fixed height
- Add `executive` and `compact` template styles
- Apply watermark, font family, header layout
- Add QR block to footer when `show_payment_qr` is set
- Add payment schedule table when `invoice.payment_schedule` is present

```typescript
export function generateInvoiceHTML(
  invoice: any,
  company: any,
  client: any,
  lineItems: any[],
  settings?: InvoiceSettings,
  paymentSchedule?: any[]
): string {
  const accent = settings?.accent_color || '#2563eb';
  const secondary = settings?.secondary_color || '#64748b';
  const style = settings?.template_style || 'classic';
  const showLogo = settings?.show_logo !== 0 && settings?.show_logo !== false;
  const logoData = showLogo ? (settings?.logo_data || null) : null;
  const footerText = settings?.footer_text || '';
  const watermarkText = settings?.watermark_text || '';
  const watermarkOpacity = settings?.watermark_opacity ?? 0.06;
  const font = fontStack(settings?.font_family);
  const headerLayout = settings?.header_layout || 'logo-left';
  const showQr = settings?.show_payment_qr === 1 || settings?.show_payment_qr === true;
  const qrUrl = settings?.payment_qr_url || '';

  const cols = resolveColumns(settings);
  const visibleCols = cols.filter(c => c.visible);

  const companyName = company?.name || 'Company';
  const companyAddr = [company?.address_line1, company?.address_line2, company?.city, company?.state, company?.zip]
    .filter(Boolean).join(', ');
  const companyEmail = company?.email || '';
  const companyPhone = company?.phone || '';
  const clientName = client?.name || 'Client';
  const clientEmail = client?.email || '';
  const clientAddr = [client?.address_line1, client?.address_line2, client?.city, client?.state, client?.zip]
    .filter(Boolean).join(', ');
  const clientPhone = client?.phone || '';

  const taxAmount = Number(invoice.tax_amount || 0);
  const discountAmount = Number(invoice.discount_amount || 0);
  const amountPaid = Number(invoice.amount_paid || 0);
  const total = Number(invoice.total || 0);
  const balance = total - amountPaid;
  const stamp = getStatusStamp(invoice.status);

  // ── Row builder ──
  let runningSubtotal = 0;

  const lineRows = lineItems.map((l, i) => {
    const rt = l.row_type || 'item';
    const colspan = visibleCols.length;

    if (rt === 'spacer') {
      return `<tr><td colspan="${colspan}" style="height:16px;border-bottom:none;"></td></tr>`;
    }

    if (rt === 'section') {
      runningSubtotal = 0;
      const sectionBg = style === 'modern' ? `background:${accent}22;` : 'background:#f1f5f9;';
      return `<tr>
        <td colspan="${colspan}" style="${sectionBg}font-weight:800;font-size:12px;color:#0f172a;letter-spacing:0.3px;padding:8px 12px;border-bottom:1px solid #e2e8f0;">
          ${l.description || ''}
        </td>
      </tr>`;
    }

    if (rt === 'note') {
      return `<tr>
        <td colspan="${colspan}" style="font-style:italic;color:#94a3b8;font-size:11px;padding:4px 12px;border-bottom:none;">
          ${l.description || ''}
        </td>
      </tr>`;
    }

    if (rt === 'subtotal') {
      const st = runningSubtotal;
      runningSubtotal = 0;
      return `<tr>
        <td colspan="${colspan - 1}" style="text-align:right;font-weight:700;font-size:11px;color:#64748b;padding:6px 12px;border-top:1px solid #e2e8f0;border-bottom:none;">
          SUBTOTAL
        </td>
        <td class="text-right font-mono font-bold" style="border-top:1px solid #e2e8f0;border-bottom:none;">${fmt(st)}</td>
      </tr>`;
    }

    if (rt === 'image') {
      // description = caption, unit_price field stores base64 src
      return `<tr>
        <td colspan="${colspan}" style="text-align:center;padding:12px;border-bottom:1px solid #e2e8f0;">
          ${l.image_data ? `<img src="${l.image_data}" style="max-width:100%;max-height:200px;object-fit:contain;" alt="${l.description||''}" />` : ''}
          ${l.description ? `<div style="font-size:11px;color:#94a3b8;margin-top:4px;font-style:italic;">${l.description}</div>` : ''}
        </td>
      </tr>`;
    }

    // ── item row ──
    const baseAmt = (l.quantity || 1) * (l.unit_price || 0);
    let discountedAmt = baseAmt;
    if (l.line_discount && l.line_discount > 0) {
      discountedAmt = l.line_discount_type === 'percent'
        ? baseAmt * (1 - l.line_discount / 100)
        : Math.max(0, baseAmt - l.line_discount);
    }
    const amt = l.amount ?? discountedAmt;
    runningSubtotal += amt;
    const rowBg = style === 'modern' && i % 2 === 0 ? 'background:#f8fafc;' : '';

    const cells = visibleCols.map(col => {
      switch (col.key) {
        case 'item_code':
          return `<td style="font-size:10px;color:#94a3b8;font-family:monospace;${rowBg}">${l.item_code || ''}</td>`;
        case 'description':
          return `<td style="${rowBg}">${l.description || ''}</td>`;
        case 'quantity':
          return `<td class="text-right font-mono" style="${rowBg}">${l.quantity ?? 1}</td>`;
        case 'unit_label':
          return `<td style="font-size:11px;color:#94a3b8;${rowBg}">${l.unit_label || ''}</td>`;
        case 'unit_price':
          return `<td class="text-right font-mono" style="${rowBg}">${fmt(l.unit_price)}</td>`;
        case 'tax_rate':
          return `<td class="text-right font-mono" style="${rowBg}">${l.tax_rate > 0 ? l.tax_rate + '%' : '—'}</td>`;
        case 'amount':
          return `<td class="text-right font-mono font-bold" style="${rowBg}">${fmt(amt)}</td>`;
        default:
          return `<td style="${rowBg}"></td>`;
      }
    }).join('');
    return `<tr style="${rowBg}">${cells}</tr>`;
  }).join('');

  const tableHeaders = visibleCols.map(col => {
    const rightAlign = ['quantity','unit_price','tax_rate','amount'].includes(col.key);
    return `<th${rightAlign ? ' class="text-right"' : ''}>${col.label}</th>`;
  }).join('');

  // ── Template styles ──
  const isCompact = style === 'compact';
  const baseFontSize = isCompact ? '11px' : '13px';

  const templateStyles = style === 'modern' ? `
    .header { display:flex;justify-content:space-between;align-items:stretch;margin-bottom:0; }
    .header-left { background:${accent};color:#fff;padding:32px 28px;min-width:220px; }
    .header-right { padding:28px 28px 28px 0;flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:flex-end; }
    .company-name { font-size:20px;font-weight:800;color:#fff; }
    .company-detail { font-size:11px;color:rgba(255,255,255,0.75);margin-top:8px;line-height:1.6; }
    .inv-title { font-size:32px;font-weight:900;color:${accent};text-transform:uppercase;text-align:right; }
    .inv-number { font-size:14px;color:#64748b;text-align:right;margin-top:4px;font-weight:700; }
    .page { padding:0; } .content { padding:32px 28px; }
    th { background:${accent};color:#fff !important;border-bottom:none; }
  ` : style === 'minimal' ? `
    .header { display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;padding-bottom:20px;border-bottom:1px solid #e2e8f0; }
    .company-name { font-size:18px;font-weight:700;color:#0f172a; }
    .company-detail { font-size:11px;color:#94a3b8;margin-top:4px;line-height:1.6; }
    .inv-title { font-size:22px;font-weight:700;color:#0f172a;text-align:right; }
    .inv-number { font-size:12px;color:#94a3b8;text-align:right;margin-top:2px; }
    .page { padding:40px; } .content { padding:0; }
    th { border-bottom:1px solid #0f172a; }
  ` : style === 'executive' ? `
    .header { position:relative;margin-bottom:0; }
    .header-top { background:${accent};padding:20px 32px;display:flex;justify-content:space-between;align-items:center; }
    .header-bottom { background:#fff;border-bottom:3px solid ${secondary};padding:14px 32px;display:flex;justify-content:space-between;align-items:center; }
    .company-name { font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.3px; }
    .company-detail { font-size:11px;color:rgba(255,255,255,0.8);margin-top:4px;line-height:1.6; }
    .inv-title { font-size:28px;font-weight:900;color:#fff;text-transform:uppercase;letter-spacing:2px; }
    .inv-number { font-size:13px;color:#0f172a;font-weight:700; }
    .inv-date { font-size:11px;color:#64748b; }
    .page { padding:0; } .content { padding:28px 32px; }
    th { background:${secondary};color:#fff !important;border-bottom:none; }
    .totals-box { position:relative;z-index:1; }
  ` : style === 'compact' ? `
    .header { display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px; }
    .company-name { font-size:14px;font-weight:700;color:#0f172a; }
    .company-detail { font-size:10px;color:#64748b;margin-top:2px;line-height:1.4; }
    .inv-title { font-size:16px;font-weight:800;color:${accent};text-transform:uppercase;text-align:right; }
    .inv-number { font-size:10px;color:#64748b;text-align:right;margin-top:2px; }
    .page { padding:24px; } .content { padding:0; }
    th { border-bottom:2px solid ${accent};color:${accent} !important;font-size:9px;padding:4px 8px; }
    td { padding:4px 8px;font-size:11px; }
    .meta-row { padding:6px 10px; }
    .meta-label { font-size:9px; } .meta-value { font-size:11px; }
  ` : /* classic */ `
    .header { display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:36px; }
    .company-name { font-size:22px;font-weight:800;color:#0f172a; }
    .company-detail { font-size:11px;color:#64748b;margin-top:6px;line-height:1.6; }
    .inv-title { font-size:28px;font-weight:800;color:${accent};text-transform:uppercase;text-align:right; }
    .inv-number { font-size:13px;color:#64748b;text-align:right;margin-top:4px;font-weight:600; }
    .page { padding:48px; } .content { padding:0; }
    th { border-bottom:2px solid ${accent};color:${accent} !important; }
  `;

  // ── Logo HTML ──
  const logoHTML = logoData
    ? `<img src="${logoData}" alt="${companyName}" style="max-height:${isCompact?'40':'56'}px;max-width:180px;object-fit:contain;display:block;margin-bottom:6px;">`
    : '';

  // ── Header block by layout ──
  const companyBlock = `
    ${logoHTML}
    <div class="company-name">${companyName}</div>
    <div class="company-detail">
      ${companyAddr ? companyAddr + '<br>' : ''}
      ${companyEmail}${companyPhone ? ' &middot; ' + companyPhone : ''}
    </div>`;

  const titleBlock = `
    <div class="inv-title">Invoice</div>
    <div class="inv-number">#${invoice.invoice_number || ''}</div>`;

  let headerHTML = '';
  if (style === 'executive') {
    headerHTML = `
    <div class="header">
      <div class="header-top">
        <div>${logoHTML}<div class="company-name">${companyName}</div><div class="company-detail">${companyAddr ? companyAddr + '<br>' : ''}${companyEmail}</div></div>
        <div class="inv-title">Invoice</div>
      </div>
      <div class="header-bottom">
        <div class="inv-number">#${invoice.invoice_number || ''}</div>
        <div class="inv-date">${companyPhone}</div>
      </div>
    </div>`;
  } else if (headerLayout === 'logo-center') {
    headerHTML = `
    <div style="text-align:center;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #e2e8f0;">
      ${logoHTML ? `<div style="margin-bottom:8px;">${logoHTML}</div>` : ''}
      <div class="company-name" style="text-align:center;">${companyName}</div>
      <div class="company-detail" style="text-align:center;">${companyAddr ? companyAddr + '<br>' : ''}${companyEmail}</div>
    </div>
    <div style="display:flex;justify-content:flex-end;margin-bottom:24px;">${titleBlock}</div>`;
  } else if (headerLayout === 'logo-right') {
    headerHTML = `<div class="header"><div>${titleBlock}</div><div style="text-align:right;">${companyBlock}</div></div>`;
  } else {
    // logo-left (default)
    headerHTML = `<div class="header"><div>${companyBlock}</div><div>${titleBlock}</div></div>`;
  }

  // ── Payment schedule HTML ──
  let scheduleHTML = '';
  if (paymentSchedule && paymentSchedule.length > 0) {
    const rows = paymentSchedule.map(m =>
      `<tr>
        <td>${m.milestone_label || ''}</td>
        <td class="text-right">${fmtDate(m.due_date)}</td>
        <td class="text-right font-mono">${fmt(m.amount)}</td>
        <td class="text-right" style="color:${m.paid?'#16a34a':'#dc2626'}">${m.paid?'Paid':'Due'}</td>
      </tr>`
    ).join('');
    scheduleHTML = `
    <div style="margin-top:20px;">
      <div class="footer-label">Payment Schedule</div>
      <table style="margin-top:6px;">
        <thead><tr>
          <th>Milestone</th><th class="text-right">Due</th><th class="text-right">Amount</th><th class="text-right">Status</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  // ── QR block ──
  const qrHTML = (showQr && qrUrl)
    ? `<div style="margin-top:16px;">${simpleQrSvg(`${qrUrl}/${invoice.invoice_number||''}`)}</div>`
    : '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Invoice ${invoice.invoice_number||''}</title><style>
${baseStyles.replace('font-size: 13px', `font-size: ${baseFontSize}`).replace("font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", `font-family: ${font}`)}
${templateStyles}
${stamp ? statusStampCSS(stamp.color) : ''}
${watermarkText ? watermarkCSS(watermarkText, watermarkOpacity) : ''}
.addresses { display:flex;justify-content:space-between;margin-bottom:24px; }
.addr-block { max-width:48%; }
.addr-name { font-size:14px;font-weight:700;color:#0f172a;margin-bottom:3px; }
.addr-detail { font-size:12px;color:#64748b;line-height:1.5; }
.meta-row { display:flex;gap:36px;padding:12px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:3px;margin-bottom:24px; }
.meta-label { font-size:10px;font-weight:700;text-transform:uppercase;color:#94a3b8;letter-spacing:0.8px; }
.meta-value { font-size:13px;font-weight:600;color:#0f172a;margin-top:2px; }
.totals { display:flex;justify-content:flex-end;margin-top:10px; }
.totals-box { width:280px; }
.totals-row { display:flex;justify-content:space-between;padding:5px 0;font-size:12px;color:#475569; }
.totals-row span:last-child { font-variant-numeric:tabular-nums; }
.totals-total { border-top:2px solid ${accent};font-weight:800;font-size:16px;color:#0f172a;padding-top:10px;margin-top:4px; }
.totals-paid { color:#16a34a; }
.totals-balance { font-weight:700;font-size:14px;border-top:1px solid #e2e8f0;padding-top:8px;margin-top:4px;color:${balance>0.005?'#dc2626':'#16a34a'}; }
.footer { margin-top:36px;padding-top:14px;border-top:1px solid #e2e8f0; }
.footer-grid { display:grid;grid-template-columns:1fr 1fr;gap:28px; }
.footer-label { font-size:10px;font-weight:700;text-transform:uppercase;color:#94a3b8;letter-spacing:0.8px;margin-bottom:4px; }
.footer-text { font-size:11px;color:#64748b;line-height:1.6;white-space:pre-line; }
.footer-bottom { text-align:center;margin-top:28px;font-size:10px;color:#cbd5e1; }
.accent-bar { height:4px;background:${accent};margin-bottom:0; }
</style></head>
<body>
${style==='modern'?'<div class="accent-bar"></div>':''}
${stamp?`<div class="status-stamp">${stamp.label}</div>`:''}
${watermarkText?`<div class="invoice-watermark">${watermarkText}</div>`:''}
<div class="page">
<div class="content">
  ${headerHTML}
  <div class="addresses">
    <div class="addr-block">
      <div class="section-label">Bill To</div>
      <div class="addr-name">${clientName}</div>
      <div class="addr-detail">
        ${clientEmail?clientEmail+'<br>':''}
        ${clientAddr?clientAddr+'<br>':''}
        ${clientPhone||''}
      </div>
    </div>
  </div>
  <div class="meta-row">
    <div><div class="meta-label">Invoice Date</div><div class="meta-value">${fmtDate(invoice.issue_date)}</div></div>
    <div><div class="meta-label">Due Date</div><div class="meta-value">${fmtDate(invoice.due_date)}</div></div>
    <div><div class="meta-label">Terms</div><div class="meta-value">${invoice.terms||'Net 30'}</div></div>
    <div><div class="meta-label">Status</div><div class="meta-value" style="color:${stamp?.color||'#0f172a'}">${(invoice.status||'draft').toUpperCase()}</div></div>
  </div>
  <table>
    <thead><tr>${tableHeaders}</tr></thead>
    <tbody>${lineRows}</tbody>
  </table>
  <div class="totals">
    <div class="totals-box">
      <div class="totals-row"><span>Subtotal</span><span>${fmt(invoice.subtotal)}</span></div>
      ${taxAmount>0?`<div class="totals-row"><span>Tax</span><span>${fmt(taxAmount)}</span></div>`:''}
      ${discountAmount>0?`<div class="totals-row" style="color:#16a34a"><span>Discount</span><span>-${fmt(discountAmount)}</span></div>`:''}
      <div class="totals-row totals-total"><span>Total</span><span>${fmt(total)}</span></div>
      ${amountPaid>0?`
        <div class="totals-row totals-paid"><span>Amount Paid</span><span>${fmt(amountPaid)}</span></div>
        <div class="totals-row totals-balance"><span>Balance Due</span><span>${fmt(Math.max(0,balance))}</span></div>
      `:''}
    </div>
  </div>
  ${scheduleHTML}
  ${(invoice.notes||invoice.terms_text)?`
  <div class="footer">
    <div class="footer-grid">
      ${invoice.notes?`<div><div class="footer-label">Notes</div><div class="footer-text">${invoice.notes}</div></div>`:''}
      ${invoice.terms_text?`<div><div class="footer-label">Terms &amp; Conditions</div><div class="footer-text">${invoice.terms_text}</div></div>`:''}
    </div>
  </div>`:''}
  <div class="footer-bottom">${footerText||companyName}</div>
  ${qrHTML}
</div>
</div>
</body></html>`;
}
```

**Step 5: Also update the `baseStyles` font-family line to be replaceable**

The current `baseStyles` string has `font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;` hardcoded. The code above uses `.replace()` to swap it at runtime. Verify this string exists verbatim in `baseStyles`.

**Step 6: Build verify**

```bash
npm run build 2>&1 | tail -30
```

Fix any TypeScript errors (most likely: unused imports or missing type annotations).

**Step 7: Commit**

```bash
git add src/renderer/lib/print-templates.ts
git commit -m "feat: invoice studio print templates — 5 designs, column config, branding, QR, payment schedule"
```

---

### Task 5: `RowTypeToolbar.tsx` + `LineItemRow.tsx`

**Files:**
- Create: `src/renderer/modules/invoices/RowTypeToolbar.tsx`
- Create: `src/renderer/modules/invoices/LineItemRow.tsx`

**Step 1: Create `RowTypeToolbar.tsx`**

```typescript
// src/renderer/modules/invoices/RowTypeToolbar.tsx
import React from 'react';
import { Plus, Heading, AlignLeft, Sigma, Image, Minus } from 'lucide-react';
import type { LineRowType } from '../../../shared/types';

interface Props {
  onAdd: (type: LineRowType) => void;
}

const TYPES: { type: LineRowType; icon: React.ReactNode; label: string }[] = [
  { type: 'item',     icon: <Plus size={13} />,     label: 'Item' },
  { type: 'section',  icon: <Heading size={13} />,  label: 'Section' },
  { type: 'note',     icon: <AlignLeft size={13} />, label: 'Note' },
  { type: 'subtotal', icon: <Sigma size={13} />,     label: 'Subtotal' },
  { type: 'image',    icon: <Image size={13} />,     label: 'Image' },
  { type: 'spacer',   icon: <Minus size={13} />,     label: 'Spacer' },
];

export const RowTypeToolbar: React.FC<Props> = ({ onAdd }) => (
  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
    {TYPES.map(({ type, icon, label }) => (
      <button
        key={type}
        className="block-btn flex items-center gap-1 text-xs py-1 px-2"
        onClick={() => onAdd(type)}
        title={`Add ${label} row`}
      >
        {icon}
        {label}
      </button>
    ))}
  </div>
);
```

**Step 2: Create `LineItemRow.tsx`**

This component renders one row in the invoice form editor. It handles all row types.

```typescript
// src/renderer/modules/invoices/LineItemRow.tsx
import React, { useState } from 'react';
import { Trash2, GripVertical, BookOpen, Star, Upload } from 'lucide-react';
import type { LineRowType } from '../../../shared/types';

export interface LineItem {
  id: string;
  row_type: LineRowType;
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  account_id: string;
  item_code: string;
  unit_label: string;
  line_discount: number;
  line_discount_type: 'percent' | 'flat';
  image_data?: string;
}

interface Account { id: string; name: string; code: string; }

interface Props {
  line: LineItem;
  idx: number;
  accounts: Account[];
  showItemCode: boolean;
  showUnitLabel: boolean;
  showTax: boolean;
  onUpdate: (idx: number, field: keyof LineItem, value: any) => void;
  onRemove: (idx: number) => void;
  onCatalogOpen: (idx: number) => void;
  onSaveToCatalog: (idx: number) => void;
  savingToCatalog: boolean;
  fmt: (n: number) => string;
}

const UNIT_LABELS = ['', 'hrs', 'days', 'units', 'ea', 'mo', 'flat'];

export const LineItemRow: React.FC<Props> = ({
  line, idx, accounts, showItemCode, showUnitLabel, showTax,
  onUpdate, onRemove, onCatalogOpen, onSaveToCatalog, savingToCatalog, fmt,
}) => {
  const rt = line.row_type || 'item';

  const dragHandle = (
    <td className="p-1" style={{ width: 20, cursor: 'grab', color: 'var(--color-text-muted)' }}>
      <GripVertical size={13} />
    </td>
  );

  const removeBtn = (
    <td className="p-1 text-center" style={{ width: 28 }}>
      <button
        className="text-text-muted hover:text-accent-expense transition-colors p-1"
        onClick={() => onRemove(idx)}
        title="Remove row"
      >
        <Trash2 size={12} />
      </button>
    </td>
  );

  if (rt === 'spacer') {
    return (
      <tr>
        {dragHandle}
        <td colSpan={99} style={{ height: 20, borderBottom: '1px dashed var(--color-border-primary)' }}>
          <span style={{ fontSize: 10, color: 'var(--color-text-muted)', paddingLeft: 8 }}>— spacer —</span>
        </td>
        {removeBtn}
      </tr>
    );
  }

  if (rt === 'section') {
    return (
      <tr style={{ background: 'var(--color-bg-tertiary)' }}>
        {dragHandle}
        <td colSpan={99} className="p-1">
          <input
            className="block-input font-bold"
            placeholder="Section heading..."
            value={line.description}
            onChange={(e) => onUpdate(idx, 'description', e.target.value)}
            style={{ fontWeight: 700, fontSize: '13px' }}
          />
        </td>
        {removeBtn}
      </tr>
    );
  }

  if (rt === 'note') {
    return (
      <tr>
        {dragHandle}
        <td colSpan={99} className="p-1">
          <input
            className="block-input"
            placeholder="Note text..."
            value={line.description}
            onChange={(e) => onUpdate(idx, 'description', e.target.value)}
            style={{ fontStyle: 'italic', color: 'var(--color-text-muted)' }}
          />
        </td>
        {removeBtn}
      </tr>
    );
  }

  if (rt === 'subtotal') {
    return (
      <tr style={{ background: 'var(--color-bg-tertiary)' }}>
        {dragHandle}
        <td colSpan={99} className="p-1" style={{ textAlign: 'right', fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600, paddingRight: 12 }}>
          ∑ SUBTOTAL (auto-calculated on PDF)
        </td>
        {removeBtn}
      </tr>
    );
  }

  if (rt === 'image') {
    const handleImageUpload = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/webp,image/gif';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return;
        if (file.size > 200 * 1024) { alert('Image must be under 200KB'); return; }
        const reader = new FileReader();
        reader.onload = (e) => onUpdate(idx, 'image_data' as any, e.target?.result as string);
        reader.readAsDataURL(file);
      };
      input.click();
    };
    return (
      <tr>
        {dragHandle}
        <td colSpan={99} className="p-1">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {line.image_data
              ? <img src={line.image_data} alt="row" style={{ maxHeight: 60, maxWidth: 120, objectFit: 'contain', borderRadius: 4, border: '1px solid var(--color-border-primary)' }} />
              : <button className="block-btn flex items-center gap-1.5 text-xs" onClick={handleImageUpload}><Upload size={12} />Upload Image</button>
            }
            <input
              className="block-input text-xs"
              placeholder="Caption (optional)"
              value={line.description}
              onChange={(e) => onUpdate(idx, 'description', e.target.value)}
              style={{ maxWidth: 240 }}
            />
            {line.image_data && (
              <button className="block-btn text-xs py-1 px-2" onClick={() => onUpdate(idx, 'image_data' as any, '')}>Remove</button>
            )}
          </div>
        </td>
        {removeBtn}
      </tr>
    );
  }

  // ── item row ──
  const baseAmt = line.quantity * line.unit_price;
  const discountedAmt = line.line_discount > 0
    ? (line.line_discount_type === 'percent'
        ? baseAmt * (1 - line.line_discount / 100)
        : Math.max(0, baseAmt - line.line_discount))
    : baseAmt;

  return (
    <tr>
      {dragHandle}
      {showItemCode && (
        <td className="p-1" style={{ width: 70 }}>
          <input
            className="block-input text-xs font-mono"
            placeholder="SKU"
            value={line.item_code}
            onChange={(e) => onUpdate(idx, 'item_code', e.target.value)}
          />
        </td>
      )}
      <td className="p-1" style={{ position: 'relative' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            className="block-input"
            placeholder="Item description"
            value={line.description}
            onChange={(e) => onUpdate(idx, 'description', e.target.value)}
            style={{ flex: 1 }}
          />
          <button className="block-btn p-1" onClick={() => onCatalogOpen(idx)} title="Pick from catalog">
            <BookOpen size={13} />
          </button>
        </div>
      </td>
      <td className="p-1" style={{ width: 64 }}>
        <input
          type="number" min={1} className="block-input text-right font-mono"
          value={line.quantity}
          onChange={(e) => onUpdate(idx, 'quantity', Math.max(1, parseFloat(e.target.value) || 1))}
        />
      </td>
      {showUnitLabel && (
        <td className="p-1" style={{ width: 80 }}>
          <select
            className="block-select text-xs"
            value={UNIT_LABELS.includes(line.unit_label) ? line.unit_label : 'custom'}
            onChange={(e) => onUpdate(idx, 'unit_label', e.target.value === 'custom' ? '' : e.target.value)}
          >
            {UNIT_LABELS.map(u => <option key={u} value={u || '—'}>{u || '—'}</option>)}
            <option value="custom">Custom…</option>
          </select>
        </td>
      )}
      <td className="p-1" style={{ width: 100 }}>
        <input
          type="number" min={0} step="0.01" className="block-input text-right font-mono"
          value={line.unit_price}
          onChange={(e) => onUpdate(idx, 'unit_price', parseFloat(e.target.value) || 0)}
        />
      </td>
      {showTax && (
        <td className="p-1" style={{ width: 72 }}>
          <input
            type="number" min={0} step="0.01" className="block-input text-right font-mono"
            value={line.tax_rate}
            onChange={(e) => onUpdate(idx, 'tax_rate', parseFloat(e.target.value) || 0)}
          />
        </td>
      )}
      <td className="p-1 text-right font-mono text-text-secondary" style={{ width: 90 }}>
        {fmt(discountedAmt)}
      </td>
      <td className="p-1 text-center" style={{ width: 56 }}>
        <div style={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
          <button className="text-text-muted hover:text-accent-expense transition-colors p-1" onClick={() => onRemove(idx)} title="Remove">
            <Trash2 size={12} />
          </button>
          {line.description.trim() && (
            <button
              className="text-text-muted hover:text-accent-revenue transition-colors p-1"
              onClick={() => onSaveToCatalog(idx)}
              title="Save to catalog"
              disabled={savingToCatalog}
            >
              <Star size={12} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
};
```

**Step 3: Build verify**

```bash
npm run build 2>&1 | tail -20
```

**Step 4: Commit**

```bash
git add src/renderer/modules/invoices/RowTypeToolbar.tsx src/renderer/modules/invoices/LineItemRow.tsx
git commit -m "feat: invoice studio RowTypeToolbar + LineItemRow components"
```

---

### Task 6: Update `InvoiceForm.tsx` — Wire Row Types

**Files:**
- Modify: `src/renderer/modules/invoices/InvoiceForm.tsx`

**Step 1: Update the `LineItem` interface at the top of `InvoiceForm.tsx`**

Replace the existing `interface LineItem` with:

```typescript
interface LineItem {
  id: string;
  row_type: 'item' | 'section' | 'note' | 'subtotal' | 'image' | 'spacer';
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  account_id: string;
  item_code: string;
  unit_label: string;
  line_discount: number;
  line_discount_type: 'percent' | 'flat';
  image_data?: string;
}
```

**Step 2: Update `newLineItem()` factory**

```typescript
const newLineItem = (row_type: LineItem['row_type'] = 'item'): LineItem => ({
  id: `new-${++lineIdCounter}`,
  row_type,
  description: '',
  quantity: 1,
  unit_price: 0,
  tax_rate: 0,
  account_id: '',
  item_code: '',
  unit_label: '',
  line_discount: 0,
  line_discount_type: 'percent',
});
```

**Step 3: Import `RowTypeToolbar` and `LineItemRow`**

At the top of the file, add:

```typescript
import { RowTypeToolbar } from './RowTypeToolbar';
import { LineItemRow } from './LineItemRow';
```

Remove the `CatalogDropdown` import/definition if it was inline — it can stay inline or be extracted, but `LineItemRow` now handles catalog open via callback.

**Step 4: Replace the "Add Line" button section with `RowTypeToolbar`**

Find the `<div className="flex items-center gap-2">` that contains the "Add Line" button in the line items card header. Replace:

```tsx
<button className="block-btn flex items-center gap-1.5 text-xs py-1 px-2" onClick={addLine}>
  <Plus size={14} />
  Add Line
</button>
```

With:

```tsx
<RowTypeToolbar onAdd={(type) => setLines(prev => [...prev, newLineItem(type)])} />
```

**Step 5: Replace the `<tbody>` rows with `<LineItemRow>` components**

Find the `{lines.map((line, idx) => {` section in the `<tbody>`. Replace the entire inner JSX with:

```tsx
{lines.map((line, idx) => (
  <LineItemRow
    key={line.id}
    line={line}
    idx={idx}
    accounts={accounts}
    showItemCode={true}
    showUnitLabel={true}
    showTax={invoiceSettings?.show_tax_column !== false && invoiceSettings?.show_tax_column !== 0}
    onUpdate={updateLine}
    onRemove={removeLine}
    onCatalogOpen={(i) => setCatalogOpen(catalogOpen === i ? null : i)}
    onSaveToCatalog={saveLineToCatalog}
    savingToCatalog={savingToCatalog === idx}
    fmt={(n) => fmt.format(n)}
  />
))}
```

**Step 6: Update `handleSave` to include new fields**

In the `lineItems` array construction inside `handleSave`, add the new fields:

```typescript
const lineItems = activeLines.map((l) => ({
  description: l.description,
  quantity: l.quantity,
  unit_price: l.unit_price,
  tax_rate: l.tax_rate,
  account_id: l.account_id || null,
  amount: l.quantity * l.unit_price,
  row_type: l.row_type || 'item',
  unit_label: l.unit_label || '',
  item_code: l.item_code || '',
  line_discount: l.line_discount || 0,
  line_discount_type: l.line_discount_type || 'percent',
}));
```

**Step 7: Update `previewHTML` useMemo to pass new fields**

In the `lineData` map inside `previewHTML`:

```typescript
const lineData = lines.map((l) => ({
  description: l.description,
  quantity: l.quantity,
  unit_price: l.unit_price,
  tax_rate: l.tax_rate,
  amount: l.quantity * l.unit_price,
  row_type: l.row_type || 'item',
  unit_label: l.unit_label,
  item_code: l.item_code,
  line_discount: l.line_discount,
  line_discount_type: l.line_discount_type,
  image_data: l.image_data,
}));
```

**Step 8: Update existing invoice load to populate new fields**

In the `useEffect` that loads an existing invoice (search for `api.query('invoice_line_items'`), map the returned data to include:

```typescript
setLines(lineData.map((l: any, i: number) => ({
  id: l.id || `loaded-${i}`,
  row_type: l.row_type || 'item',
  description: l.description || '',
  quantity: l.quantity || 1,
  unit_price: l.unit_price || 0,
  tax_rate: l.tax_rate || 0,
  account_id: l.account_id || '',
  item_code: l.item_code || '',
  unit_label: l.unit_label || '',
  line_discount: l.line_discount || 0,
  line_discount_type: l.line_discount_type || 'percent',
})));
```

**Step 9: Build verify**

```bash
npm run build 2>&1 | tail -30
```

**Step 10: Commit**

```bash
git add src/renderer/modules/invoices/InvoiceForm.tsx
git commit -m "feat: invoice form — row type support, LineItemRow component, RowTypeToolbar"
```

---

### Task 7: `ColumnConfigurator.tsx` + Extend `InvoiceSettings.tsx`

**Files:**
- Create: `src/renderer/modules/invoices/ColumnConfigurator.tsx`
- Modify: `src/renderer/modules/invoices/InvoiceSettings.tsx`

**Step 1: Create `ColumnConfigurator.tsx`**

```typescript
// src/renderer/modules/invoices/ColumnConfigurator.tsx
import React from 'react';
import { GripVertical } from 'lucide-react';
import { DEFAULT_COLUMNS, type InvoiceColumnConfig } from '../../lib/print-templates';

interface Props {
  columns: InvoiceColumnConfig[];
  onChange: (cols: InvoiceColumnConfig[]) => void;
}

export const ColumnConfigurator: React.FC<Props> = ({ columns, onChange }) => {
  const cols = columns.length > 0 ? columns : DEFAULT_COLUMNS;

  const toggle = (key: string) => {
    onChange(cols.map(c => c.key === key ? { ...c, visible: !c.visible } : c));
  };

  const rename = (key: string, label: string) => {
    onChange(cols.map(c => c.key === key ? { ...c, label } : c));
  };

  // Simple up/down reorder (no drag library dependency)
  const move = (idx: number, dir: -1 | 1) => {
    const next = [...cols];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    onChange(next.map((c, i) => ({ ...c, order: i })));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {cols.sort((a, b) => a.order - b.order).map((col, idx) => (
        <div
          key={col.key}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 10px', borderRadius: 6,
            border: '1px solid var(--color-border-primary)',
            background: 'var(--color-bg-tertiary)',
            opacity: col.visible ? 1 : 0.5,
          }}
        >
          <GripVertical size={13} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          <input
            type="checkbox"
            checked={col.visible}
            onChange={() => toggle(col.key)}
            style={{ width: 14, height: 14, flexShrink: 0 }}
          />
          <input
            className="block-input text-xs"
            value={col.label}
            onChange={(e) => rename(col.key, e.target.value)}
            style={{ flex: 1, padding: '4px 8px' }}
            disabled={!col.visible}
          />
          <span style={{ fontSize: 10, color: 'var(--color-text-muted)', fontFamily: 'monospace', minWidth: 80 }}>
            {col.key}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <button
              className="text-text-muted hover:text-text-primary"
              style={{ fontSize: 10, lineHeight: 1, background: 'none', border: 'none', cursor: 'pointer' }}
              onClick={() => move(idx, -1)}
              disabled={idx === 0}
            >▲</button>
            <button
              className="text-text-muted hover:text-text-primary"
              style={{ fontSize: 10, lineHeight: 1, background: 'none', border: 'none', cursor: 'pointer' }}
              onClick={() => move(idx, 1)}
              disabled={idx === cols.length - 1}
            >▼</button>
          </div>
        </div>
      ))}
      <button
        className="block-btn text-xs"
        onClick={() => onChange(DEFAULT_COLUMNS)}
        style={{ alignSelf: 'flex-start', marginTop: 4 }}
      >
        Reset to defaults
      </button>
    </div>
  );
};
```

**Step 2: Update `InvoiceSettings.tsx` state and load/save**

Find the settings state at the top of `InvoiceSettingsComponent`. The state type currently is `ISettings & {...}`. Extend it:

```typescript
const [settings, setSettings] = useState<ISettings & {
  footer_text: string;
  default_notes: string;
  default_terms_text: string;
  default_due_days: number;
  show_payment_terms: boolean;
  // New Invoice Studio fields
  secondary_color: string;
  watermark_text: string;
  watermark_opacity: number;
  font_family: string;
  header_layout: string;
  column_config: any[];
  payment_qr_url: string;
  show_payment_qr: boolean;
}>({
  accent_color: '#2563eb',
  logo_data: null,
  template_style: 'classic',
  show_logo: true,
  show_tax_column: true,
  show_payment_terms: true,
  footer_text: '',
  default_notes: '',
  default_terms_text: '',
  default_due_days: 30,
  secondary_color: '#64748b',
  watermark_text: '',
  watermark_opacity: 0.06,
  font_family: 'system',
  header_layout: 'logo-left',
  column_config: [],
  payment_qr_url: '',
  show_payment_qr: false,
});
```

**Step 3: Update the `load` function to populate new fields from DB**

In the `useEffect` load function, extend the `setSettings` call:

```typescript
setSettings({
  // ... existing fields ...
  secondary_color: data.secondary_color || '#64748b',
  watermark_text: data.watermark_text || '',
  watermark_opacity: data.watermark_opacity ?? 0.06,
  font_family: data.font_family || 'system',
  header_layout: data.header_layout || 'logo-left',
  column_config: (() => {
    try { return JSON.parse(data.column_config || '[]') || []; } catch { return []; }
  })(),
  payment_qr_url: data.payment_qr_url || '',
  show_payment_qr: data.show_payment_qr === 1 || data.show_payment_qr === true,
});
```

**Step 4: Update `handleSave` to serialize `column_config`**

In `handleSave`, pass `column_config` as JSON string:

```typescript
await api.saveInvoiceSettings({
  ...settings,
  column_config: JSON.stringify(settings.column_config),
});
```

**Step 5: Import `ColumnConfigurator` in `InvoiceSettings.tsx`**

```typescript
import { ColumnConfigurator } from './ColumnConfigurator';
import { DEFAULT_COLUMNS } from '../../lib/print-templates';
```

**Step 6: Add new settings sections to the JSX**

After the existing "Footer & Defaults" card, before the closing `</div>`, add these three new cards:

**Columns card:**
```tsx
<div className="block-card">
  <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">
    Table Columns
  </div>
  <ColumnConfigurator
    columns={settings.column_config.length > 0 ? settings.column_config : DEFAULT_COLUMNS}
    onChange={(cols) => setSettings(p => ({ ...p, column_config: cols }))}
  />
</div>
```

**Branding card:**
```tsx
<div className="block-card">
  <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-4">
    Advanced Branding
  </div>
  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <div>
      <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1.5">Secondary Accent Color</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="color"
          value={settings.secondary_color || '#64748b'}
          onChange={(e) => setSettings(p => ({ ...p, secondary_color: e.target.value }))}
          style={{ width: 36, height: 28, borderRadius: '6px', border: '1px solid var(--color-border-primary)', padding: 2, cursor: 'pointer', background: 'transparent' }}
        />
        <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>{settings.secondary_color}</span>
      </div>
    </div>
    <div>
      <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1.5">Watermark Text</label>
      <input
        type="text"
        className="block-input"
        placeholder="e.g. CONFIDENTIAL, your company name..."
        value={settings.watermark_text}
        onChange={(e) => setSettings(p => ({ ...p, watermark_text: e.target.value }))}
      />
    </div>
    {settings.watermark_text && (
      <div>
        <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1.5">
          Watermark Opacity — {Math.round((settings.watermark_opacity || 0.06) * 100)}%
        </label>
        <input
          type="range" min={1} max={15} step={1}
          value={Math.round((settings.watermark_opacity || 0.06) * 100)}
          onChange={(e) => setSettings(p => ({ ...p, watermark_opacity: parseInt(e.target.value) / 100 }))}
          style={{ width: '100%' }}
        />
      </div>
    )}
    <div>
      <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1.5">Font Family</label>
      <select
        className="block-select"
        value={settings.font_family || 'system'}
        onChange={(e) => setSettings(p => ({ ...p, font_family: e.target.value }))}
      >
        <option value="system">System (default)</option>
        <option value="inter">Professional Sans</option>
        <option value="georgia">Classic Serif</option>
        <option value="mono">Monospace</option>
      </select>
    </div>
    <div>
      <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1.5">Header Layout</label>
      <select
        className="block-select"
        value={settings.header_layout || 'logo-left'}
        onChange={(e) => setSettings(p => ({ ...p, header_layout: e.target.value }))}
      >
        <option value="logo-left">Logo Left / Title Right (default)</option>
        <option value="logo-center">Logo Center / Full Width</option>
        <option value="logo-right">Title Left / Logo Right</option>
      </select>
    </div>
    <div>
      <label className="text-xs font-semibold text-text-muted uppercase tracking-wider block mb-1.5">Payment QR Code URL</label>
      <input
        type="text"
        className="block-input"
        placeholder="https://pay.yoursite.com/invoice"
        value={settings.payment_qr_url}
        onChange={(e) => setSettings(p => ({ ...p, payment_qr_url: e.target.value }))}
      />
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={!!settings.show_payment_qr}
          onChange={(e) => setSettings(p => ({ ...p, show_payment_qr: e.target.checked }))}
          style={{ width: 14, height: 14 }}
        />
        <span style={{ fontSize: '13px', color: 'var(--color-text-primary)' }}>Show QR code on PDF</span>
      </label>
    </div>
  </div>
</div>
```

**Step 7: Also add 2 new template cards to the Template Style section**

Find the `TEMPLATE_OPTIONS` array and update it:

```typescript
const TEMPLATE_OPTIONS = [
  { value: 'classic',   label: 'Classic',   description: 'Accent header bar with clean table layout' },
  { value: 'modern',    label: 'Modern',    description: 'Bold colored left panel, alternating rows' },
  { value: 'minimal',   label: 'Minimal',   description: 'Ultra-clean, hairline borders only' },
  { value: 'executive', label: 'Executive', description: 'Two-tone header, company name watermark behind totals' },
  { value: 'compact',   label: 'Compact',   description: 'Dense layout for multi-page, more rows per page' },
] as const;
```

And update the grid to 5 columns: `gridTemplateColumns: 'repeat(3, 1fr)'` → use 3 for first row, or just use `repeat(auto-fill, minmax(140px, 1fr))`.

**Step 8: Update the preview sample invoice in `InvoiceSettings.tsx`**

Pass `column_config` to `generateInvoiceHTML` in the `previewHTML` memo:

```typescript
return generateInvoiceHTML(sampleInvoice, sampleCompany, sampleClient, sampleLines, settings);
```

The signature already accepts `settings` which now includes `column_config`, so this is a no-change.

**Step 9: Build verify**

```bash
npm run build 2>&1 | tail -30
```

**Step 10: Commit**

```bash
git add src/renderer/modules/invoices/ColumnConfigurator.tsx src/renderer/modules/invoices/InvoiceSettings.tsx
git commit -m "feat: invoice studio — ColumnConfigurator, 5 templates, branding controls in settings"
```

---

### Task 8: `PaymentScheduleEditor.tsx` + Wire into `InvoiceForm.tsx`

**Files:**
- Create: `src/renderer/modules/invoices/PaymentScheduleEditor.tsx`
- Modify: `src/renderer/modules/invoices/InvoiceForm.tsx`

**Step 1: Create `PaymentScheduleEditor.tsx`**

```typescript
// src/renderer/modules/invoices/PaymentScheduleEditor.tsx
import React from 'react';
import { Plus, Trash2 } from 'lucide-react';

export interface PaymentMilestone {
  id: string;
  milestone_label: string;
  due_date: string;
  amount: number;
  paid: boolean;
}

interface Props {
  milestones: PaymentMilestone[];
  onChange: (milestones: PaymentMilestone[]) => void;
  invoiceTotal: number;
}

let midCounter = 0;

export const PaymentScheduleEditor: React.FC<Props> = ({ milestones, onChange, invoiceTotal }) => {
  const add = () => {
    onChange([...milestones, {
      id: `m-${++midCounter}`,
      milestone_label: '',
      due_date: '',
      amount: 0,
      paid: false,
    }]);
  };

  const update = (idx: number, field: keyof PaymentMilestone, value: any) => {
    const next = [...milestones];
    next[idx] = { ...next[idx], [field]: value };
    onChange(next);
  };

  const remove = (idx: number) => {
    onChange(milestones.filter((_, i) => i !== idx));
  };

  const scheduled = milestones.reduce((s, m) => s + (m.amount || 0), 0);
  const remaining = invoiceTotal - scheduled;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {milestones.map((m, idx) => (
        <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            className="block-input"
            placeholder="Milestone (e.g. Deposit 50%)"
            value={m.milestone_label}
            onChange={(e) => update(idx, 'milestone_label', e.target.value)}
            style={{ flex: 2 }}
          />
          <input
            type="date"
            className="block-input"
            value={m.due_date}
            onChange={(e) => update(idx, 'due_date', e.target.value)}
            style={{ flex: 1 }}
          />
          <input
            type="number"
            min={0}
            step="0.01"
            className="block-input text-right font-mono"
            placeholder="Amount"
            value={m.amount}
            onChange={(e) => update(idx, 'amount', parseFloat(e.target.value) || 0)}
            style={{ flex: 1 }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-text-muted)', cursor: 'pointer', flexShrink: 0 }}>
            <input
              type="checkbox"
              checked={m.paid}
              onChange={(e) => update(idx, 'paid', e.target.checked)}
              style={{ width: 13, height: 13 }}
            />
            Paid
          </label>
          <button className="text-text-muted hover:text-accent-expense p-1" onClick={() => remove(idx)} title="Remove">
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
        <button className="block-btn flex items-center gap-1.5 text-xs py-1 px-2" onClick={add}>
          <Plus size={13} /> Add Milestone
        </button>
        {milestones.length > 0 && (
          <span style={{ fontSize: 12, color: Math.abs(remaining) < 0.01 ? 'var(--color-accent-income)' : 'var(--color-accent-warning)' }}>
            {Math.abs(remaining) < 0.01
              ? '✓ Fully scheduled'
              : `Unscheduled: $${remaining.toFixed(2)}`}
          </span>
        )}
      </div>
    </div>
  );
};
```

**Step 2: Add payment schedule state to `InvoiceForm.tsx`**

Near the top of the component, after existing state declarations:

```typescript
const [paymentMilestones, setPaymentMilestones] = useState<Array<{
  id: string; milestone_label: string; due_date: string; amount: number; paid: boolean;
}>>([]);
const [showPaymentSchedule, setShowPaymentSchedule] = useState(false);
```

Import:
```typescript
import { PaymentScheduleEditor } from './PaymentScheduleEditor';
```

**Step 3: Load payment schedule when editing**

In the existing `useEffect` that loads invoice data (where `invoiceId` is set), after loading line items, add:

```typescript
if (invoiceId) {
  const schedule = await api.listPaymentSchedule(invoiceId).catch(() => []);
  if (!cancelled && schedule.length > 0) {
    setPaymentMilestones(schedule);
    setShowPaymentSchedule(true);
  }
}
```

**Step 4: Save payment schedule on `handleSave`**

In `handleSave`, after `const result = await api.saveInvoice(...)`, add:

```typescript
if (showPaymentSchedule && paymentMilestones.length > 0) {
  await api.savePaymentSchedule(result.id!, paymentMilestones).catch(console.error);
}
```

**Step 5: Add Payment Schedule section to the form**

In `formContent`, after the "Notes & Terms" card and before the closing `</div>`:

```tsx
{/* Payment Schedule */}
<div className="block-card">
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showPaymentSchedule ? 16 : 0 }}>
    <div>
      <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Payment Schedule</span>
      <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 8 }}>Split invoice into milestone payments</span>
    </div>
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
      <input
        type="checkbox"
        checked={showPaymentSchedule}
        onChange={(e) => setShowPaymentSchedule(e.target.checked)}
        style={{ width: 14, height: 14 }}
      />
      <span style={{ fontSize: 13 }}>Enable</span>
    </label>
  </div>
  {showPaymentSchedule && (
    <PaymentScheduleEditor
      milestones={paymentMilestones}
      onChange={setPaymentMilestones}
      invoiceTotal={total}
    />
  )}
</div>
```

**Step 6: Build verify**

```bash
npm run build 2>&1 | tail -30
```

**Step 7: Commit**

```bash
git add src/renderer/modules/invoices/PaymentScheduleEditor.tsx src/renderer/modules/invoices/InvoiceForm.tsx
git commit -m "feat: invoice payment schedule editor — milestone payments with paid tracking"
```

---

### Task 9: Update `InvoiceDetail.tsx` — Pass New Settings Fields

**Files:**
- Modify: `src/renderer/modules/invoices/InvoiceDetail.tsx`

**Step 1: Pass payment schedule to `generateInvoiceHTML`**

In `InvoiceDetail.tsx`, find the `buildHTML` function (around line 100–150). It currently calls:
```typescript
return generateInvoiceHTML(invoice, activeCompany, client, lines, invoiceSettings || undefined);
```

Update to pass payment schedule:
```typescript
const [paymentSchedule, setPaymentSchedule] = useState<any[]>([]);

// In loadData(), add:
const schedule = await api.listPaymentSchedule(invoiceId).catch(() => []);
setPaymentSchedule(schedule);

// In buildHTML():
return generateInvoiceHTML(invoice, activeCompany, client, lines, invoiceSettings || undefined, paymentSchedule);
```

**Step 2: Update `generateInvoiceHTML` call signature**

The function signature was already updated in Task 4 to accept `paymentSchedule?: any[]`. Just pass it through.

**Step 3: Build verify + visual smoke test**

```bash
npm run build 2>&1 | tail -20
```

Then run the app and verify:
- New invoice form shows RowTypeToolbar with 6 buttons
- Adding a "Section" row shows bold heading input
- Adding a "Note" row shows italic input
- Invoice Settings shows 5 template cards
- Columns configurator shows 7 column rows with toggle + rename

**Step 4: Commit**

```bash
git add src/renderer/modules/invoices/InvoiceDetail.tsx
git commit -m "feat: invoice detail passes payment schedule to PDF template"
```

---

### Task 10: Final Build, Deploy, Smoke Test

**Step 1: Full TypeScript build**

```bash
cd "/Users/rmpgutah/Business Accounting Pro" && npm run build 2>&1
```

Expected: exit code 0, no errors (warnings OK).

**Step 2: Package macOS app**

```bash
npm run dist:mac -- --arm64 2>&1 | tail -10
```

**Step 3: Codesign and install**

```bash
bash scripts/codesign-mac.sh "release/mac-arm64/Business Accounting Pro.app"
cp -R "release/mac-arm64/Business Accounting Pro.app" "/Applications/Business Accounting Pro.app"
xattr -cr "/Applications/Business Accounting Pro.app"
```

**Step 4: Smoke test checklist**

- [ ] Create a new invoice
- [ ] Add Item, Section, Note, Subtotal, Spacer rows — verify each renders correctly in live preview
- [ ] Change template to Executive — verify two-tone header in preview
- [ ] Change template to Compact — verify smaller text, tighter rows
- [ ] Open Invoice Settings → change column labels, hide Tax column — verify preview updates
- [ ] Add watermark text — verify faint text appears diagonally in preview
- [ ] Change font to Classic Serif — verify preview font changes
- [ ] Enable Payment Schedule, add 2 milestones — verify schedule table appears in preview
- [ ] Save invoice — verify it reloads with all row types and settings intact
- [ ] Print to PDF from InvoiceDetail — verify PDF matches preview

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: invoice studio complete — 5 templates, rich row types, column config, branding, payment schedule"
```

---

Plan complete and saved to `docs/plans/2026-04-07-invoice-studio-plan.md`. Two execution options:

**1. Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** — Open a new session with executing-plans, batch execution with checkpoints

Which approach?
