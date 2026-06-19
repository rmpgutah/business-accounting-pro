# Classic PDF Forms Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign every generated document form to a classic Arial, pure-black-and-white, lines-and-boxes look; render them all as real PDFs previewable in an embedded in-app PDF viewer; and give checks an authentic MICR E-13B line.

**Architecture:** All "PDFs" are HTML strings Chromium renders to PDF via `webContents.printToPDF` ([print-preview.ts](../../../src/main/services/print-preview.ts)). We introduce one shared classic style module ([classic-styles.ts](../../../src/renderer/lib/classic-styles.ts)) that every `generate*HTML()` composes from, a pure MICR encoder + embedded E-13B font, a new `print:render` IPC that returns the rendered PDF as base64, and a `<PdfPreview>` React component that displays it in an `<embed type="application/pdf">`. Legacy `window.open()`/`window.print()` and HTML-only preview surfaces are retired (except the live-edit editor iframe, which stays HTML for responsiveness + DOM page analysis).

**Tech Stack:** Electron 41, React 19, TypeScript, Vite. No test framework — verification is `npm run typecheck`, `npm run build`, dependency-free `node:assert` scripts under `scripts/` (the repo idiom, see `scripts/test-loan-calculator.cjs`), and visual checks in the embedded preview.

**Reference spec:** [2026-06-13-classic-pdf-forms-redesign-design.md](../specs/2026-06-13-classic-pdf-forms-redesign-design.md)

---

## File Structure

**New files:**
- `src/renderer/lib/classic-styles.ts` — shared classic CSS + box/table HTML builders. Pure, no renderer imports (unit-testable in isolation).
- `src/renderer/lib/micr.ts` — pure MICR E-13B line encoder (symbol grammar + glyph map). No imports.
- `src/renderer/lib/micr-font.ts` — base64 data-URI of the bundled E-13B font + `@font-face` builder.
- `src/renderer/components/PdfPreview.tsx` — embedded real-PDF viewer with Save/Print.
- `scripts/test-classic-styles.cjs` — assertion script for the style helpers.
- `scripts/test-micr.cjs` — assertion script for the MICR encoder.
- `docs/licenses/MICR-E13B-LICENSE.txt` — license of the bundled font.

**Modified files (high level):**
- `src/renderer/lib/print-templates.ts` — every `generate*HTML()` composes classic helpers; `generateInvoiceHTML` forces Arial.
- `src/renderer/lib/payroll-check-template.ts` — classic styling + real MICR line.
- `src/renderer/lib/je-helpers.ts`, `src/renderer/modules/debt-collection/DebtInvoiceFormatter.tsx`, `src/main/services/pdf-generator.ts` — restyle their generators.
- `src/renderer/modules/invoices/InvoiceSettings.tsx` — remove font picker.
- `src/main/ipc/index.ts`, `src/renderer/lib/api.ts` — `print:render` IPC + `api.renderPdf`.
- Preview/print call sites (see Phase 6) — migrate to `<PdfPreview>` / real-PDF APIs.
- `package.json` — add `test:micr`, `test:classic` scripts.

---

## Phase 1 — Classic style system

### Task 1: Create the classic style module

**Files:**
- Create: `src/renderer/lib/classic-styles.ts`

- [ ] **Step 1: Write the module**

```typescript
// Shared "classic" document styling — Arial, pure black & white, ruled
// tables and boxed sections. Every generate*HTML() form template composes
// these. Pure string builders, NO renderer imports, so they are unit-
// testable in isolation (scripts/test-classic-styles.cjs).
//
// Escaping contract: fields named `label`/`title`/plain text args ARE
// escaped here. Fields named `*Html` / `rows` cells are caller-supplied
// TRUSTED HTML and are NOT escaped — the caller must esc() any user text.

const CLASSIC_FONT = "Arial, 'Helvetica Neue', Helvetica, sans-serif";

export function esc(s: unknown): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function classicStyles(): string {
  return `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: letter; margin: 0.5in 0.55in; }
  body { font-family: ${CLASSIC_FONT}; color: #000; background: #fff;
    font-size: 12px; line-height: 1.4;
    -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .doc-frame { border: 2px solid #000; position: relative; }
  .doc-header { display: flex; border-bottom: 2px solid #000; }
  .doc-header .co { flex: 1; padding: 14px 16px; border-right: 2px solid #000; }
  .doc-header .co-name { font-size: 17px; font-weight: bold; letter-spacing: 0.5px; }
  .doc-header .co-detail { font-size: 11px; margin-top: 5px; line-height: 1.5; }
  .doc-header .doc-meta { width: 230px; padding: 14px 16px; text-align: right; }
  .doc-title { font-size: 27px; font-weight: bold; letter-spacing: 3px; text-transform: uppercase; }
  .doc-number { font-size: 12px; margin-top: 6px; }
  .meta-strip { width: 100%; border-collapse: collapse; border-bottom: 2px solid #000;
    font-size: 11px; text-align: center; }
  .meta-strip td { border-right: 1px solid #000; padding: 7px 6px; }
  .meta-strip td:last-child { border-right: none; }
  .meta-strip .ml { font-weight: bold; letter-spacing: 1px; font-size: 10px; text-transform: uppercase; }
  .meta-strip .mv { margin-top: 3px; }
  .box-row { display: flex; border-bottom: 2px solid #000; }
  .box-row .box { flex: 1; padding: 10px 16px; border-right: 1px solid #000; }
  .box-row .box:last-child { border-right: none; }
  .sec-label { font-size: 10px; font-weight: bold; letter-spacing: 1px; text-transform: uppercase; }
  table.ruled { width: 100%; border-collapse: collapse; font-size: 11px; }
  table.ruled th { background: #000; color: #fff; border: 1px solid #000; padding: 7px 8px;
    text-align: left; letter-spacing: 0.5px; text-transform: uppercase; font-size: 10px; }
  table.ruled td { border: 1px solid #000; padding: 7px 8px; }
  table.ruled td.num { text-align: right; font-variant-numeric: tabular-nums; }
  table.ruled td.ctr { text-align: center; }
  .totals { border-collapse: collapse; font-size: 12px; width: 262px; }
  .totals td { padding: 6px 12px; text-align: right; border-bottom: 1px solid #000; }
  .totals td.val { border-left: 1px solid #000; font-variant-numeric: tabular-nums; width: 96px; }
  .totals tr.grand td { background: #000; color: #fff; font-weight: bold; letter-spacing: 1px;
    padding: 9px 12px; border-bottom: none; }
  .totals tr.grand td.val { border-left: 1px solid #fff; }
  .footer-bar { border-top: 2px solid #000; padding: 8px 16px; font-size: 10px;
    text-align: center; letter-spacing: 0.3px; }
  .draft-wm { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%) rotate(-30deg);
    font-size: 90px; font-weight: bold; color: rgba(0,0,0,0.07); letter-spacing: 12px;
    pointer-events: none; z-index: 0; }
  @media print { .no-break { page-break-inside: avoid; }
    table.ruled { page-break-inside: auto; } tr { page-break-inside: avoid; } }
  `;
}

export interface MetaCell { label: string; value: string; }
export function metaStrip(cells: MetaCell[]): string {
  return `<table class="meta-strip"><tr>${cells.map(c =>
    `<td><div class="ml">${esc(c.label)}</div><div class="mv">${esc(c.value)}</div></td>`).join('')}</tr></table>`;
}

export interface DocBox { label: string; html: string; }
export function boxRow(boxes: DocBox[]): string {
  return `<div class="box-row">${boxes.map(b =>
    `<div class="box"><div class="sec-label">${esc(b.label)}</div>` +
    `<div style="margin-top:5px;">${b.html}</div></div>`).join('')}</div>`;
}

export interface DocHeaderOpts { coName: string; coDetailHtml: string; title: string; number?: string; }
export function docHeader(o: DocHeaderOpts): string {
  return `<div class="doc-header">` +
    `<div class="co"><div class="co-name">${esc(o.coName)}</div>` +
    `<div class="co-detail">${o.coDetailHtml}</div></div>` +
    `<div class="doc-meta"><div class="doc-title">${esc(o.title)}</div>` +
    `${o.number ? `<div class="doc-number">${esc(o.number)}</div>` : ''}</div></div>`;
}

export interface RuledColumn { label: string; align?: 'left' | 'right' | 'center'; width?: string; }
export function ruledTable(columns: RuledColumn[], rows: string[][]): string {
  const cls = (a?: string) => a === 'right' ? ' class="num"' : a === 'center' ? ' class="ctr"' : '';
  const head = `<tr>${columns.map(c =>
    `<th${c.width ? ` style="width:${c.width}"` : ''}>${esc(c.label)}</th>`).join('')}</tr>`;
  const body = rows.map(r => `<tr>${r.map((cell, i) =>
    `<td${cls(columns[i]?.align)}>${cell}</td>`).join('')}</tr>`).join('');
  return `<table class="ruled"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

export interface TotalRow { label: string; value: string; grand?: boolean; }
export function totalsBox(rows: TotalRow[]): string {
  return `<table class="totals">${rows.map(r =>
    `<tr${r.grand ? ' class="grand"' : ''}><td>${esc(r.label)}</td>` +
    `<td class="val">${esc(r.value)}</td></tr>`).join('')}</table>`;
}

export function docFrame(inner: string, opts?: { draft?: boolean }): string {
  return `<div class="doc-frame">${opts?.draft ? '<div class="draft-wm">DRAFT</div>' : ''}${inner}</div>`;
}

export function footerBar(text: string): string {
  return `<div class="footer-bar">${esc(text)}</div>`;
}

export function classicDocument(o: { title: string; bodyHtml: string; extraHead?: string }): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(o.title)}</title>` +
    `${o.extraHead || ''}<style>${classicStyles()}</style></head><body>${o.bodyHtml}</body></html>`;
}
```

- [ ] **Step 2: Add npm test script**

In `package.json` `scripts`, add after `"test:loan"`:

```json
"test:classic": "node scripts/test-classic-styles.cjs",
"test:micr": "node scripts/test-micr.cjs",
```

- [ ] **Step 3: Write the assertion script**

Create `scripts/test-classic-styles.cjs`:

```javascript
// Dependency-free assertions for the classic style helpers. The repo has
// no test runner; this compiles the single pure TS module with tsc and
// requires the JS output. Run: npm run test:classic
const assert = require('node:assert');
const { execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const out = path.join(root, '.tmp-test');
fs.rmSync(out, { recursive: true, force: true });
execSync(`npx tsc src/renderer/lib/classic-styles.ts --outDir .tmp-test ` +
  `--module commonjs --target ES2019 --moduleResolution node --skipLibCheck`,
  { cwd: root, stdio: 'inherit' });

const m = require(path.join(out, 'classic-styles.js'));
let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok -', name); };

t('classicStyles uses Arial, black, ruled tables', () => {
  const css = m.classicStyles();
  assert.ok(css.includes('Arial'), 'has Arial');
  assert.ok(css.includes('#000'), 'has black');
  assert.ok(css.includes('border-collapse'), 'has ruled tables');
  assert.ok(!/Inter|#2563eb|Source Serif/.test(css), 'no glass-era styles');
});
t('ruledTable emits one th per column and num class on right cols', () => {
  const html = m.ruledTable(
    [{ label: 'Desc' }, { label: 'Amt', align: 'right' }],
    [['Widget', '$1.00']]);
  assert.ok(html.includes('<table class="ruled">'));
  assert.strictEqual((html.match(/<th/g) || []).length, 2);
  assert.ok(html.includes('<td class="num">$1.00</td>'));
});
t('metaStrip escapes labels', () => {
  const html = m.metaStrip([{ label: '<x>', value: 'v' }]);
  assert.ok(html.includes('&lt;x&gt;'), 'label escaped');
});
t('totalsBox marks grand row', () => {
  const html = m.totalsBox([{ label: 'Total', value: '$5', grand: true }]);
  assert.ok(html.includes('<tr class="grand">'));
});

fs.rmSync(out, { recursive: true, force: true });
console.log(`\n${passed} passed`);
```

- [ ] **Step 4: Run the test**

Run: `npm run test:classic`
Expected: `4 passed`

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/lib/classic-styles.ts scripts/test-classic-styles.cjs package.json
git commit -m "feat(pdf): classic style system (Arial, B&W, ruled boxes) + test"
```

---

### Task 2: Restyle the invoice (reference form) + force Arial

**Files:**
- Modify: `src/renderer/lib/print-templates.ts` (`generateInvoiceHTML`, line ~1029)

This is the worked example that establishes the pattern for all other generators. `generateInvoiceHTML(invoice, company, client, lineItems, settings?, paymentSchedule?)` currently emits a glass-styled document with a per-form `<style>` and uses `settings.font`/`accent`/etc.

- [ ] **Step 1: Import the helpers**

At the top of `print-templates.ts`, add:

```typescript
import {
  classicStyles, docFrame, docHeader, metaStrip, boxRow,
  ruledTable, totalsBox, footerBar, esc as cesc,
} from './classic-styles';
```

(There is already an `esc` in this file; import the classic one aliased as `cesc` to avoid a clash, or reuse the existing `esc` — confirm which `esc` is in scope and use one consistently within the function you edit.)

- [ ] **Step 2: Replace the invoice `<style>` + `<body>` with classic composition**

Inside `generateInvoiceHTML`, **force Arial and drop accent/font usage**:
- Delete/ignore `accent`, `secondary`, `settings?.font`. Keep `logoData`, `cols`, totals math, `paymentSchedule`, currency `fmt`, custom fields, watermark text.
- Build the document body from helpers:

```typescript
const coDetail = [companyAddr, [companyEmail, companyPhone].filter(Boolean).join(' · '),
  company?.website ? cesc(company.website) : '']
  .filter(Boolean).join('<br>');

const header = docHeader({
  coName: companyName,
  coDetailHtml: (logoData ? `<img src="${logoData}" style="max-height:48px;max-width:220px;display:block;margin-bottom:6px;" />` : '') + coDetail,
  title: isQuote ? 'Quote' : 'Invoice',          // isQuote: existing branch flag, if present; else 'Invoice'
  number: `No. ${cesc(invoice.invoice_number || '')}`,
});

const meta = metaStrip([
  { label: isQuote ? 'Quote Date' : 'Invoice Date', value: invoice.issue_date || '' },
  { label: isQuote ? 'Valid Until' : 'Due Date', value: invoice.due_date || '' },
  { label: 'Terms', value: invoice.terms || 'Net 30' },
  ...(invoice.po_number ? [{ label: 'Purchase Order', value: String(invoice.po_number) }] : []),
]);

const parties = boxRow([
  { label: 'Bill To', html: `<b>${clientName}</b><br>${[clientAddr, clientEmail, clientPhone].filter(Boolean).join('<br>')}` },
  ...(invoice.shipping_address ? [{ label: 'Ship To', html: cesc(invoice.shipping_address) }] : []),
]);

// Build line rows respecting resolved `cols`; numeric cells right-aligned.
const rows: string[][] = (lineItems || []).map(l => [
  cesc(l.description || ''),
  String(Number(l.quantity) || 0),
  fmt(Number(l.unit_price) || 0),
  fmt(lineDiscountedBase(l)),       // existing per-line math helper in this fn
]);
const table = ruledTable([
  { label: 'Description' },
  { label: 'Qty', align: 'center', width: '46px' },
  { label: 'Unit Price', align: 'right', width: '92px' },
  { label: 'Amount', align: 'right', width: '100px' },
], rows);

const totals = totalsBox([
  { label: 'Subtotal', value: fmt(invoice.subtotal || 0) },
  ...(invoice.discount_amount ? [{ label: 'Discount', value: '-' + fmt(invoice.discount_amount) }] : []),
  ...(taxAmount ? [{ label: 'Tax', value: fmt(taxAmount) }] : []),
  ...(invoice.shipping_amount ? [{ label: 'Shipping', value: fmt(invoice.shipping_amount) }] : []),
  { label: 'Total Due', value: fmt(invoice.total || 0), grand: true },
  ...(invoice.amount_paid > 0 ? [
    { label: 'Amount Paid', value: fmt(invoice.amount_paid) },
    { label: 'Balance Due', value: fmt((invoice.total || 0) - (invoice.amount_paid || 0)) },
  ] : []),
]);

const notesBox = (invoice.notes || footerText) ? boxRow([
  ...(invoice.notes ? [{ label: 'Notes', html: cesc(invoice.notes).replace(/\n/g, '<br>') }] : []),
  ...(footerText ? [{ label: 'Terms & Conditions', html: cesc(footerText).replace(/\n/g, '<br>') }] : []),
]) : '';

const body = docFrame(
  header + meta + parties + table +
  `<div style="display:flex;justify-content:flex-end;padding:10px 16px;">${totals}</div>` +
  notesBox +
  footerBar(`${companyName} · Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`),
  { draft: invoice.status === 'draft' }
);

return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ${cesc(invoice.invoice_number || '')}</title><style>${classicStyles()}</style></head><body>${body}</body></html>`;
```

Notes:
- If `generateInvoiceHTML` does **not** already define an `isQuote` flag, the quote callers pass distinguishing data — check the existing branch logic near the top of the function and reuse it; otherwise default `title: 'Invoice'`.
- Preserve every existing math helper (`lineDiscountedBase`, `fmt`, `taxAmount`) — only the presentation changes.
- `settings.font` is now unused; leave `FONT_OPTIONS` exported but add a comment `// @deprecated — output is always Arial (classic theme)`.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: builds clean.

- [ ] **Step 5: Visual check (manual)**

Run the app (`npm run dev`), open an invoice, open its preview. Confirm: Arial, pure black/white, boxed header, bordered meta strip, full-grid line table with black header bar, bordered totals box, footer bar. No emerald/blue/rounded corners.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/lib/print-templates.ts
git commit -m "feat(pdf): classic invoice/quote template, forced Arial"
```

---

## Phase 2 — Restyle the remaining generators

Each task composes the same helpers; the per-form mapping below is specific. After each: `npm run typecheck` + visual check + commit. Keep math/content identical — change only presentation. All in `src/renderer/lib/print-templates.ts` unless noted.

### Task 3: Bill + Purchase Order
- `generateBillHTML(bill, company, vendor, lines, _, accounts)`: header `title: 'Bill'`, number = bill number; `metaStrip` = Bill Date / Due Date / Terms; `boxRow` = From (vendor) / Bill To (company); `ruledTable` columns Description/Qty/Unit/Amount (+ Account column if accounts present); `totalsBox` subtotal/tax/total.
- `generatePurchaseOrderHTML(po, company, vendor, lines, settings?)`: `title: 'Purchase Order'`; `metaStrip` = PO Date / Required By / Terms; `boxRow` = Vendor / Ship To; same table/totals shape.
- [ ] Implement both, typecheck, visual check, commit: `feat(pdf): classic bill + purchase order`.

### Task 4: Expense receipt + expense report
- `generateExpenseReceiptHTML(...)`: `title: 'Expense Receipt'` (or 'Affidavit' when watermarked — preserve the existing watermark arg); single `boxRow` for payee/category, `metaStrip` for date/amount/method, `ruledTable` if itemized, `footerBar`.
- `generateExpenseReportHTML(...)`: `title: 'Expense Report'`; `ruledTable` of Date/Vendor/Category/Amount; `totalsBox` total; group subtotals as `<tr>` section rows (bold label spanning row) — add a `sectionRow(label)` inline if needed.
- [ ] Implement both, typecheck, visual check, commit: `feat(pdf): classic expense receipt + report`.

### Task 5: Generic report + debt portfolio report
- `generateReportHTML(title, columns: ReportColumn[], rows, summary?: ReportSummary)`: wrap in `docFrame`, `docHeader` with the passed title, `ruledTable` from `columns`/`rows`, `totalsBox` or a summary `metaStrip` from `summary`. This is the generic frame other reports reuse.
- `generateDebtPortfolioReportHTML(debts, collectedYtd, company)`: `title: 'Debt Portfolio'`; `metaStrip` for totals (count, outstanding, collected YTD); `ruledTable` of debtor/balance/status/age.
- [ ] Implement both, typecheck, visual check, commit: `feat(pdf): classic generic report + debt portfolio`.

### Task 6: Pay stub + employee record + wage-withholding agreement
- `generatePayStubHTML(data: PayStubData, ytd?: YtdData)`: `title: 'Pay Statement'`; `metaStrip` = Pay Date / Period / Net Pay; two `ruledTable`s (Earnings, Deductions) side by side via a flex wrapper; `totalsBox` for gross/deductions/net; YTD `ruledTable`.
- `generateEmployeeRecordHTML(data)`: `title: 'Employee Record'`; stacked `boxRow`s for identity / employment / tax sections; `ruledTable` for pay history if present.
- `generateWageWithholdingAgreementHTML(data)`: letter/agreement layout — `docHeader`, body paragraphs in a bordered block, signature `boxRow` (Employee / Date) at the bottom.
- [ ] Implement all three, typecheck, visual check, commit: `feat(pdf): classic pay stub + employee record + withholding agreement`.

### Task 7: Demand letter + collection letter
- `generateDemandLetterHTML(...)` and `generateCollectionLetterHTML(...)`: these are correspondence, not grids. Use `docHeader` as letterhead, then a normal-flow letter body (date, recipient block in a `boxRow` labeled "To", paragraphs, amount-demanded in a small bordered `totalsBox`, signature line). Arial, black rules, no color. Keep all legal wording verbatim.
- [ ] Implement both, typecheck, visual check, commit: `feat(pdf): classic demand + collection letters`.

### Task 8: Court packet + verification affidavit
- `generateCourtPacketHTML(data)`: preserve the legal **caption** (centered, double-rule under it), **jurat**, and **exhibit cover** structure, but switch fonts to Arial and rules to black; wrap sections in bordered blocks. Reuse existing `.legal-*` semantics but recolor to B&W.
- `generateVerificationAffidavitHTML(debt, company, notary)`: affidavit body in a bordered block + jurat `boxRow` (signature / notary). Black rules, Arial.
- [ ] Implement both, typecheck, visual check, commit: `feat(pdf): classic court packet + affidavit`.

### Task 9: Satellite generators
- `generateJeCoverSheetHTML(args)` in `src/renderer/lib/je-helpers.ts`: import helpers from `../lib/classic-styles` (adjust relative path), `title: 'Journal Entry'`, `metaStrip` = Entry # / Date / Status, `ruledTable` of Account/Debit/Credit, `totalsBox` debit/credit/balance.
- `buildStatementHTML(...)` in `src/renderer/modules/debt-collection/DebtInvoiceFormatter.tsx`: `title: 'Statement'`, `ruledTable` of date/description/charge/payment/balance, `totalsBox` balance due.
- `buildInvoiceHTML(company, client, invoice, lineItems)` in `src/main/services/pdf-generator.ts` (headless fallback): replicate the classic invoice look. Since this is the **main** process and cannot import the renderer module, copy the minimal classic CSS inline (or extract the CSS string to a shared location both can import — simplest: inline a trimmed `classicStyles()` copy here with a comment pointing at the source of truth).
- [ ] Implement all three, typecheck, build, visual check, commit: `feat(pdf): classic JE cover, statement, headless fallback`.

---

## Phase 3 — Remove the invoice font picker

### Task 10: Delete font selector UI

**Files:**
- Modify: `src/renderer/modules/invoices/InvoiceSettings.tsx`

- [ ] **Step 1:** Remove the `FONT_OPTIONS_FROM_TEMPLATES` import and the font `<select>`/picker block from the settings form. Remove any `settings.font` form state wiring. Leave other settings (logo, columns, footer) intact.
- [ ] **Step 2:** Typecheck: `npm run typecheck` — fix any now-unused vars.
- [ ] **Step 3:** Build: `npm run build`.
- [ ] **Step 4:** Visual check: open Invoice Settings — no font picker; preview is Arial regardless of any previously stored `settings.font`.
- [ ] **Step 5:** Commit: `git commit -am "feat(pdf): remove invoice font picker (output is always Arial)"`

---

## Phase 4 — MICR E-13B for checks

### Task 11: Pure MICR encoder + test

**Files:**
- Create: `src/renderer/lib/micr.ts`
- Create: `scripts/test-micr.cjs`

- [ ] **Step 1: Write the encoder**

```typescript
// MICR E-13B line builder. Pure, no imports — unit-tested in
// scripts/test-micr.cjs. The font (data URI) lives in micr-font.ts; this
// module only sequences characters per the ANSI X9 / ABA MICR grammar.
//
// Canonical symbol tokens (data is digit-only, so these letters never clash):
export const TRANSIT = 'T';   // routing flank
export const ONUS    = 'O';   // on-us field delimiter (account / check no)
export const AMOUNT  = 'A';   // amount flank (bank adds later — NOT emitted here)
export const DASH    = 'D';   // sub-field separator

// Maps a canonical token to the character the bundled E-13B font draws as
// that symbol. PIN to the chosen font in Task 12 (most E-13B fonts: A/B/C/D).
export const MICR_GLYPH_MAP: Record<string, string> = {
  [TRANSIT]: 'A',
  [AMOUNT]: 'B',
  [ONUS]: 'C',
  [DASH]: 'D',
};

function onlyDigits(s: string | undefined): string { return (s || '').replace(/\D/g, ''); }

export interface MicrFields { routing: string; account: string; checkNumber?: string; }

// Issued-check layout: aux on-us (check no) ⑈, transit ⑆routing⑆, on-us account⑈.
export function buildMicrCanonical(f: MicrFields): string {
  const routing = onlyDigits(f.routing).padStart(9, '0').slice(0, 9);
  const account = onlyDigits(f.account);
  const chk = onlyDigits(f.checkNumber);
  const aux = chk ? `${ONUS}${chk}${ONUS} ` : '';
  return `${aux}${TRANSIT}${routing}${TRANSIT} ${account}${ONUS}`;
}

export function toFontGlyphs(canonical: string): string {
  return canonical.replace(/[TOAD]/g, (c) => MICR_GLYPH_MAP[c] ?? c);
}

export function buildMicrLine(f: MicrFields): string {
  return toFontGlyphs(buildMicrCanonical(f));
}
```

- [ ] **Step 2: Write the test**

Create `scripts/test-micr.cjs`:

```javascript
// Dependency-free assertions for the MICR encoder. Run: npm run test:micr
const assert = require('node:assert');
const { execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const root = path.join(__dirname, '..');
const out = path.join(root, '.tmp-test');
fs.rmSync(out, { recursive: true, force: true });
execSync(`npx tsc src/renderer/lib/micr.ts --outDir .tmp-test ` +
  `--module commonjs --target ES2019 --moduleResolution node --skipLibCheck`,
  { cwd: root, stdio: 'inherit' });
const m = require(path.join(out, 'micr.js'));

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('  ok -', name); };

t('canonical layout with check number', () => {
  assert.strictEqual(
    m.buildMicrCanonical({ routing: '123456789', account: '0001234567', checkNumber: '1042' }),
    'O1042O T123456789T 0001234567O');
});
t('routing padded to 9 digits', () => {
  assert.ok(m.buildMicrCanonical({ routing: '12345', account: '99' }).includes('T000012345T'));
});
t('no aux field when checkNumber absent', () => {
  assert.ok(!m.buildMicrCanonical({ routing: '123456789', account: '5' }).startsWith('O'));
});
t('amount field never emitted', () => {
  assert.ok(!m.buildMicrCanonical({ routing: '123456789', account: '5', checkNumber: '1' }).includes('A'));
});
t('glyph map converts tokens (T->A, O->C)', () => {
  const g = m.buildMicrLine({ routing: '123456789', account: '0001234567', checkNumber: '1042' });
  assert.ok(!/[TO]/.test(g), 'no raw tokens left');
  assert.ok(g.startsWith('C1042C A123456789A'), 'mapped glyphs');
});

fs.rmSync(out, { recursive: true, force: true });
console.log(`\n${passed} passed`);
```

- [ ] **Step 3: Run the test**

Run: `npm run test:micr`
Expected: `5 passed`

- [ ] **Step 4: Commit**

```bash
git add src/renderer/lib/micr.ts scripts/test-micr.cjs
git commit -m "feat(check): pure MICR E-13B line encoder + tests"
```

### Task 12: Bundle + embed the E-13B font

**Files:**
- Create: `src/renderer/lib/micr-font.ts`
- Create: `docs/licenses/MICR-E13B-LICENSE.txt`

- [ ] **Step 1: Obtain a redistributable E-13B font.** Source a permissive/public-domain MICR E-13B `.ttf` (E-13B glyph shapes are ISO 1004; in the US typeface *designs* aren't copyrightable). Save its license text to `docs/licenses/MICR-E13B-LICENSE.txt`. **Verify the license permits redistribution before bundling.**

- [ ] **Step 2: Confirm the font's symbol encoding.** Open the font (e.g. in a font viewer) and confirm which characters render the transit/amount/on-us/dash symbols. If it is NOT A/B/C/D, update `MICR_GLYPH_MAP` in `src/renderer/lib/micr.ts` and re-run `npm run test:micr` (fix the expected strings in the test to match the real mapping).

- [ ] **Step 3: Convert to woff2 and base64-encode.**

```bash
# If the source is .ttf, convert to woff2 (smaller); else base64 the ttf directly.
# Example using fonttools (pip install fonttools[woff]):
#   fonttools ttLib.woff2 compress micr-e13b.ttf -o micr-e13b.woff2
base64 -i micr-e13b.woff2 | tr -d '\n' > /tmp/micr-b64.txt
echo "bytes: $(wc -c < /tmp/micr-b64.txt)"
```

- [ ] **Step 4: Write `micr-font.ts`** with the encoded font (paste the contents of `/tmp/micr-b64.txt` in place of the base64 below; adjust mime to `font/ttf` if not converted):

```typescript
// MICR E-13B font embedded as a base64 data URI so the check HTML is
// self-contained and renders inside the sandboxed printToPDF window (which
// has no filesystem access). Deliberate exception to the "system fonts
// only" note in print-templates.ts — no OS ships E-13B.
// License: docs/licenses/MICR-E13B-LICENSE.txt
export const MICR_FONT_DATA_URI =
  'data:font/woff2;base64,<PASTE_BASE64_FROM_STEP_3>';

export function micrFontFace(): string {
  return `@font-face{font-family:'MICRE13B';` +
    `src:url(${MICR_FONT_DATA_URI}) format('woff2');` +
    `font-weight:normal;font-style:normal;}`;
}
```

- [ ] **Step 5: Typecheck + build:** `npm run typecheck && npm run build`. (Confirm Vite inlines the large string without error.)

- [ ] **Step 6: Commit**

```bash
git add src/renderer/lib/micr-font.ts docs/licenses/MICR-E13B-LICENSE.txt
git commit -m "feat(check): bundle redistributable MICR E-13B font (embedded)"
```

### Task 13: Render the real MICR line on the check

**Files:**
- Modify: `src/renderer/lib/payroll-check-template.ts` (CHECK styles ~lines 47-70 + 120; MICR block ~lines 348-355)

- [ ] **Step 1: Import** at top of file:

```typescript
import { buildMicrLine } from './micr';
import { micrFontFace } from './micr-font';
```

- [ ] **Step 2: Replace the `.micr-bar` CSS** (the `.micr-bar`, `.micr-seg`, `.micr-lbl`, `.micr-num`, `.micr-spacer` rules) with the font-face + a single MICR line rule, and switch the check body to Arial:

```css
/* prepend the @font-face via micrFontFace() — see Step 4 */
.micr-line { position:absolute; bottom:0.375in; left:0.5in; right:0.5in;
  font-family:'MICRE13B','Courier New',monospace; font-size:16px;
  letter-spacing:2px; color:#000; white-space:nowrap; }
```

Also change the check's base `font-family` to `Arial, 'Helvetica Neue', Helvetica, sans-serif`.

- [ ] **Step 3: Replace the MICR markup** (lines ~348-355) with:

```typescript
    <!-- MICR E-13B line (clear band, no labels) -->
    <div class="micr-line">${buildMicrLine({ routing: coRouting, account: coAcct, checkNumber: chk })}</div>
```

- [ ] **Step 4: Inject the font-face.** Find where the check's `<style>` block is assembled (the `CHECK_STYLES` constant / the `<head>` of the returned HTML) and prepend `micrFontFace()` to it, e.g. `<style>${micrFontFace()} ${CHECK_STYLES}</style>`.

- [ ] **Step 5: Typecheck + build:** `npm run typecheck && npm run build`.

- [ ] **Step 6: Visual check:** generate a paycheck for an employee whose company has routing/account set. Confirm the bottom line renders in the blocky E-13B face with transit/on-us symbols, sits in the clear band, and visually matches a real check. Confirm blank routing/account still renders zeros without crashing.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/lib/payroll-check-template.ts
git commit -m "feat(check): authentic MICR E-13B line + Arial check styling"
```

---

## Phase 5 — Real-PDF render IPC + embedded viewer

### Task 14: `print:render` IPC + `api.renderPdf`

**Files:**
- Modify: `src/main/ipc/index.ts` (near the other `print:*` handlers, ~line 7142)
- Modify: `src/renderer/lib/api.ts` (Print/Preview section, ~line 300)

- [ ] **Step 1: Add the IPC handler.** `htmlToPDFBuffer` is already imported (top of `ipc/index.ts`). Add:

```typescript
  ipcMain.handle('print:render', async (
    _event,
    { html, pdfOptions }: { html: string; pdfOptions?: import('../services/print-preview').PDFOptions }
  ): Promise<{ base64?: string; error?: string }> => {
    try {
      const buf = await htmlToPDFBuffer(html, pdfOptions);
      return { base64: buf.toString('base64') };
    } catch (err: any) {
      return { error: err?.message || 'PDF render failed' };
    }
  });
```

- [ ] **Step 2: Add the API wrapper** in `api.ts` after `print`:

```typescript
  renderPdf: (
    html: string,
    pdfOptions?: { pageSize?: 'A4' | 'Letter' | 'Legal' | 'Tabloid'; landscape?: boolean; printBackground?: boolean }
  ): Promise<{ base64?: string; error?: string }> =>
    window.electronAPI.invoke('print:render', { html, pdfOptions }),
```

- [ ] **Step 3: Typecheck:** `npm run typecheck`.
- [ ] **Step 4: Commit:** `git commit -am "feat(pdf): print:render IPC returns rendered PDF as base64"`

### Task 15: `<PdfPreview>` component

**Files:**
- Create: `src/renderer/components/PdfPreview.tsx`

- [ ] **Step 1: Write the component**

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

interface PdfPreviewProps {
  html: string;
  title: string;
  pdfOptions?: { pageSize?: 'A4' | 'Letter' | 'Legal' | 'Tabloid'; landscape?: boolean; printBackground?: boolean };
  className?: string;
  style?: React.CSSProperties;
}

export const PdfPreview: React.FC<PdfPreviewProps> = ({ html, title, pdfOptions, className, style }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.renderPdf(html, pdfOptions).then((res) => {
      if (cancelled) return;
      if (res.error || !res.base64) {
        setError(res.error || 'Failed to render PDF');
        setLoading(false);
        return;
      }
      const bytes = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const obj = URL.createObjectURL(blob);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = obj;
      setUrl(obj);
      setLoading(false);
    }).catch((e) => {
      if (!cancelled) { setError(String(e?.message || e)); setLoading(false); }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, JSON.stringify(pdfOptions), nonce]);

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, ...style }}>
      <div style={{ display: 'flex', gap: 8, padding: 8, borderBottom: '1px solid var(--hairline)' }}>
        <button className="block-btn" onClick={() => api.saveToPDF(html, title)}>Save as PDF</button>
        <button className="block-btn" onClick={() => api.print(html)}>Print</button>
      </div>
      {error && (
        <div style={{ padding: 16, color: 'var(--color-accent-expense)' }}>
          PDF error: {error}{' '}
          <button className="block-btn" onClick={() => setNonce((n) => n + 1)}>Retry</button>
        </div>
      )}
      {loading && !error && <div style={{ padding: 16, color: 'var(--color-text-muted)' }}>Rendering PDF…</div>}
      {url && !error && (
        <embed src={url} type="application/pdf" style={{ flex: 1, width: '100%', border: 'none', minHeight: 480 }} />
      )}
    </div>
  );
};

export default PdfPreview;
```

- [ ] **Step 2: Typecheck + build:** `npm run typecheck && npm run build`.
- [ ] **Step 3: Commit:** `git add src/renderer/components/PdfPreview.tsx && git commit -m "feat(pdf): embedded PdfPreview component (real PDF + save/print)"`

---

## Phase 6 — Migrate call sites, retire legacy paths

### Task 16: Migrate standalone preview modals to `<PdfPreview>`

For each site, replace the HTML `<iframe srcDoc=...>` (or `window.open`+`print`) **preview surface** with `<PdfPreview html={...} title={...} />`. Keep the underlying `generate*HTML(...)` call that builds the HTML.

**Files & sites:**
- `src/renderer/modules/quotes/QuoteDetail.tsx`, `QuoteForm.tsx` — preview modal → `PdfPreview`.
- `src/renderer/modules/accounts/JournalEntryForm.tsx:1248` — JE preview iframe → `PdfPreview`.
- `src/renderer/modules/debt-collection/DemandLetterGenerator.tsx:374` (iframe) and `:233` (`window.open`+`w.print()`) → `PdfPreview` modal; delete the `window.open` print path.
- `src/renderer/modules/debt-collection/DebtInvoiceFormatter.tsx:498` (iframe) → `PdfPreview`.
- `src/renderer/modules/invoices/InvoiceSettings.tsx:656` (template preview iframe) → `PdfPreview` (debounced; this re-renders on settings change — acceptable, it's not per-keystroke).

- [ ] Migrate each, `npm run typecheck` after each file, visual check, commit per logical group:
  - `feat(pdf): quotes + JE previews use embedded PdfPreview`
  - `feat(pdf): debt-collection previews use embedded PdfPreview; drop window.open print`
  - `feat(pdf): invoice-settings preview uses embedded PdfPreview`

### Task 17: Retire the legacy `printHTML` helpers

**Files:**
- `src/renderer/modules/invoices/upgrades/InvoicesUpgrades.part4.tsx:173` — local `printHTML` (statement, register, invoice at :728/:836/:1091).
- `src/renderer/modules/clients/upgrades/ClientsUpgrades.part4.tsx:87` — local `printHTML` (6 call sites).

- [ ] **Step 1:** Replace each local `printHTML(title, body)` call with `api.print(fullHtmlDoc)` where `fullHtmlDoc` wraps `body` in a classic document (use `classicDocument({ title, bodyHtml: body })` from `classic-styles.ts`, or `api.printPreview`/`PdfPreview` if the site shows a preview). Delete the local `printHTML` function once unused.
- [ ] **Step 2:** Typecheck + build.
- [ ] **Step 3:** Visual check each affected action (statement, register, etc.).
- [ ] **Step 4:** Commit: `feat(pdf): retire legacy window.open print helpers (invoices, clients)`

### Task 18: Live-edit iframe — keep HTML, route output to PDF (documented exception)

**Files:**
- `src/renderer/modules/invoices/InvoiceDetail.tsx:1492`, `InvoiceForm.tsx:2035`

- [ ] **Step 1:** Leave the live-edit `<iframe srcDoc={inlinePreviewHTML}>` as HTML — it powers `analyzePages` (DOM page-straddler analysis) and per-keystroke responsiveness; a PDF embed has no inspectable DOM.
- [ ] **Step 2:** Ensure the **Preview / Print / Save** actions (`api.printPreview` :294 / `api.print` :300 / `api.saveToPDF` :317) remain wired and produce the classic PDF (they already call `generateInvoiceHTML`, now restyled). Optionally add a "Preview as PDF" button opening a `PdfPreview` modal.
- [ ] **Step 3:** Add a code comment at each iframe explaining the deliberate HTML exception.
- [ ] **Step 4:** Commit: `docs(pdf): document live-edit HTML iframe exception; output stays PDF`

---

## Phase 7 — Final verification

### Task 19: Audit + full verification

- [ ] **Step 1: Grep for remaining legacy form paths**

```bash
grep -rnE "window\.print\(\)|window\.open\([^)]*_blank" src/renderer/modules \
  | grep -viE "Dashboard|kpi/index|ExpenseByCategory"   # these are app-view prints, out of scope
```
Expected: no remaining **document-form** print paths (only the out-of-scope app-view prints, if any).

- [ ] **Step 2: Grep for leftover glass styling in templates**

```bash
grep -nE "Inter|Source Serif|#2563eb|border-radius|var\(--accent" \
  src/renderer/lib/print-templates.ts src/renderer/lib/payroll-check-template.ts \
  src/renderer/lib/je-helpers.ts
```
Expected: none in the generators (helper-driven Arial/B&W only).

- [ ] **Step 3: Run all checks**

```bash
npm run test:classic && npm run test:micr && npm run typecheck && npm run build
```
Expected: all pass, build clean.

- [ ] **Step 4: Visual smoke test (manual)** — in `npm run dev`, open and preview one of each form type (invoice, quote, bill, PO, expense receipt, pay stub, paycheck w/ MICR, demand letter, court packet, JE). Confirm classic look, embedded PDF preview renders, Save + Print work.

- [ ] **Step 5: Final commit** (if any audit fixes): `git commit -am "chore(pdf): final classic-redesign audit fixes"`

---

## Self-Review

**Spec coverage:**
- Decision 1 (Arial) → Task 2 (force in invoice) + all of Phase 2 (helpers hard-code Arial) + Task 10 (remove picker). ✓
- Decision 2 (pure B&W) → `classicStyles()` Task 1; verified Task 19 Step 2. ✓
- Decision 3 (embedded PDF viewer) → Tasks 14–15, migrated in Phase 6. ✓
- Decision 4 (all forms + retire legacy) → Phase 2 inventory (all 18) + Tasks 16–17 + audit Task 19. ✓
- Decision 5 (real MICR) → Tasks 11–13. ✓
- Decision 6 (bundle redistributable font) → Task 12. ✓
- Decision 7 (remove picker) → Task 10. ✓
- Headless `buildInvoiceHTML` restyle → Task 9. ✓

**Placeholder scan:** The only fill-in is the font base64 in Task 12 — that is a real binary asset produced by Step 3's exact command and pasted in Step 4, not a vague TODO. `MICR_GLYPH_MAP` is concrete (A/B/C/D) with an explicit re-pin step. No "TBD"/"add error handling"/"similar to Task N".

**Type consistency:** `esc`/`cesc`, `classicStyles`, `docFrame`, `docHeader`, `metaStrip`, `boxRow`, `ruledTable`, `totalsBox`, `footerBar`, `classicDocument` (classic-styles.ts) used consistently. `buildMicrLine`/`buildMicrCanonical`/`MICR_GLYPH_MAP` (micr.ts) and `micrFontFace`/`MICR_FONT_DATA_URI` (micr-font.ts) consistent. `api.renderPdf` ↔ `print:render` ↔ `{ base64?, error? }` consistent across Tasks 14–15.
