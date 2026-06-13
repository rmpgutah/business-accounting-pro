# Classic PDF Forms Redesign — Design Spec

- **Date:** 2026-06-13
- **Status:** Approved direction, pending written-spec review
- **Branch:** `claude/heuristic-hypatia-220d39`

## Summary

Redesign every generated document ("PDF output form") in Business Accounting Pro
to a **classic** look: **Arial** typeface, **pure black & white**, ruled tables and
boxed sections. Going forward, every form is **rendered as a real PDF** (Electron
`webContents.printToPDF`) and **previewed as that actual PDF inside the app**
(embedded viewer), retiring the legacy browser-print and HTML-only preview paths.
Checks additionally gain a **standards-compliant MICR E-13B line** using a bundled,
embedded E-13B font.

## Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Typeface | **Force Arial on all forms** (no per-form font choice) |
| 2 | Color | **Pure black & white** (no accent color; logo prints grayscale) |
| 3 | Preview UX | **Embedded in-app PDF viewer** (true rendered-PDF, not HTML) |
| 4 | Scope | **All forms + retire legacy `window.open()`/`window.print()` paths** |
| 5 | Checks | **Real MICR E-13B line** with transit/on-us symbols |
| 6 | MICR font source | **Bundle a redistributable E-13B font**, embedded as base64 `@font-face` |
| 7 | Invoice font picker | **Remove the picker UI** from Invoice Settings |

## Goals

- One consistent classic visual language across all document forms.
- Every user-facing form goes through the real `printToPDF` pipeline.
- The preview shows the exact bytes that will be saved/printed (WYSIWYG).
- Checks render an authentic, scannable MICR line.

## Non-goals / out of scope

- "Print this screen" actions that print the live app view rather than a generated
  document (`Dashboard.tsx`, `kpi/index.tsx`, `reports/ExpenseByCategory.tsx`
  `window.print()`). These are app-view prints, not document forms; leave as-is.
- Guaranteeing magnetic-reader (read-head) MICR processing — that requires MICR
  magnetic toner + check stock, which is hardware/consumables, not software. The
  E-13B font delivers a **visually correct and image/OCR-scannable** line only.
- Changing the underlying data, totals math, or document content/wording.
- Reworking the sync server or portal HTML.

## Current architecture (as-is)

PDFs are not drawn with a PDF library — they are **HTML strings rendered to PDF by
Chromium**. Three output paths coexist today:

1. ✅ **Real-PDF path** — `api.printPreview(html, title)` → IPC `print:preview` →
   `openPrintPreview()` (separate Electron window w/ Close · Save-as-PDF · Print);
   `api.saveToPDF(html, title, opts)` → `print:save-pdf` → `saveHTMLAsPDF()`;
   `api.print(html)` → `print:print` → `printHTML()`. Headless buffer rendering via
   `htmlToPDFBuffer()`. All in [`src/main/services/print-preview.ts`](../../../src/main/services/print-preview.ts).
2. ⚠️ **HTML-only previews** — `<iframe srcDoc={html}>` shows the HTML page, not the
   actual PDF (InvoiceDetail, InvoiceForm, InvoiceSettings, QuoteDetail/Form, JE form,
   DemandLetterGenerator, DebtInvoiceFormatter).
3. ❌ **Legacy browser print** — `window.open()` + `window.print()`
   (DemandLetterGenerator, the local `printHTML` helpers in
   `InvoicesUpgrades.part4.tsx` and `ClientsUpgrades.part4.tsx`).

Form HTML is produced by `generate*HTML()` functions, almost all in
[`src/renderer/lib/print-templates.ts`](../../../src/renderer/lib/print-templates.ts)
(~281 KB), plus satellites. Current styling is the modern "glass" look: `Inter`/
`Source Serif Pro`, color washes, rounded corners. Invoices expose a font picker via
`FONT_OPTIONS`. **Note:** the CLAUDE.md "no hard-coded hex / Warm Structured Glass"
rule governs `.tsx` app UI, **not** these print templates — classic black-line styling
is legitimate here.

## Target architecture

### 1. Classic style system (`print-templates.ts`)

Add a single shared source of truth that every generator composes from:

- `classicStyles()` → returns the shared `<style>` string:
  - Font: `font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif;` everywhere.
  - Color: `#000` text and borders on `#fff`; **no** other colors. Black header bars
    use white text (`#000` bg / `#fff` text) — photocopy-safe.
  - Tables: `border-collapse: collapse;` with full `1px solid #000` cell gridlines;
    `2px solid #000` for outer frame and section dividers.
  - Boxed sections, bordered totals box, uppercase letter-spaced section labels.
  - Draft watermark in light gray (`rgba(0,0,0,0.07)`).
  - `@page { size: letter; margin: ...; }` + `print-color-adjust: exact;`.
- HTML builder helpers (small, pure, string-returning):
  - `docFrame(innerHTML)` — outer `2px` ruled frame wrapper.
  - `docHeader({ company, docTitle, docNumber, logo? })` — boxed two-column header.
  - `metaStrip(cells: {label, value}[])` — bordered horizontal label/value cells.
  - `boxRow(boxes: {label, html}[])` — side-by-side bordered boxes (Bill To / Ship To).
  - `ruledTable({ columns, rows })` — full-grid line-items table w/ black header bar.
  - `totalsBox(rows, { totalRow })` — bordered totals block; total row inverted.
  - `sectionLabel(text)`, `footerBar(text)`.

These deliberately mirror the approved mockup (boxed header, bordered meta strip,
full-grid line table with black header, bordered totals box, footer bar).

### 2. Restyle every generator (full inventory)

Each generator is refactored to compose the helpers above. Inventory:

| Generator | File | Notes |
|-----------|------|-------|
| `generateInvoiceHTML` | print-templates.ts | also used by quotes (branch flag) |
| `generateBillHTML` | print-templates.ts | |
| `generatePurchaseOrderHTML` | print-templates.ts | |
| `generateExpenseReceiptHTML` | print-templates.ts | |
| `generateExpenseReportHTML` | print-templates.ts | |
| `generateReportHTML` | print-templates.ts | generic report frame |
| `generatePayStubHTML` | print-templates.ts | |
| `generateEmployeeRecordHTML` | print-templates.ts | |
| `generateWageWithholdingAgreementHTML` | print-templates.ts | |
| `generateDemandLetterHTML` | print-templates.ts | letter format |
| `generateCollectionLetterHTML` | print-templates.ts | letter format |
| `generateCourtPacketHTML` | print-templates.ts | legal; keep caption/jurat structure |
| `generateVerificationAffidavitHTML` | print-templates.ts | legal |
| `generateDebtPortfolioReportHTML` | print-templates.ts | |
| `generatePaycheckHTML` | payroll-check-template.ts | **+ MICR module (§4)**; keep functional check layout |
| `generateJeCoverSheetHTML` | je-helpers.ts | |
| `buildStatementHTML` | debt-collection/DebtInvoiceFormatter.tsx | |
| `buildInvoiceHTML` | main/services/pdf-generator.ts | headless fallback; **restyle to classic** so cron/automation PDFs match |

Letters (demand/collection) and legal packets keep their semantic structure
(letterhead, caption, jurat, exhibit covers) but adopt Arial + black rules + boxed
blocks. `buildInvoiceHTML` in the main process is a headless fallback and **will be restyled
to the classic look** (sharing the same classic CSS) so cron/automation PDFs match.

### 3. Force Arial + remove font picker

- `generateInvoiceHTML` ignores `settings.font` and always emits the Arial stack.
- `FONT_OPTIONS` export remains (to avoid breaking imports) but is no longer wired to
  output; mark deprecated in a comment.
- Remove the font-selector UI block from
  [`InvoiceSettings.tsx`](../../../src/renderer/modules/invoices/InvoiceSettings.tsx)
  and the `FONT_OPTIONS_FROM_TEMPLATES` import/usage there.

### 4. MICR E-13B module (checks)

Replace the simulated monospace MICR bar in
[`payroll-check-template.ts`](../../../src/renderer/lib/payroll-check-template.ts)
(currently `'OCR B'`/Courier with CHK/RTN/ACCT labels) with an authentic E-13B line.

- **Font:** bundle a freely-redistributable MICR E-13B font (ISO 1004 glyph shapes;
  in the US, typeface *designs* are not copyrightable — only the font file is — so a
  permissive/public-domain file is safe). Verify and record the license in the repo.
- **Embedding:** export the font as a base64 data-URI from a new
  `src/renderer/lib/micr-font.ts`, injected as `@font-face { font-family: 'MICR';
  src: url(data:font/woff2;base64,...) }` directly in the generated check HTML. This is
  a deliberate, documented exception to the "system fonts only, no `@font-face`" note
  at [print-templates.ts:940](../../../src/renderer/lib/print-templates.ts) — required
  because no OS ships E-13B. Self-contained so it survives the sandboxed `printToPDF`
  window (which has no file access).
- **MICR line grammar** (issued check; bank adds the amount field later, so amount
  symbols are NOT pre-printed):
  - Auxiliary on-us (check number) for business checks: `⑈ {checkNo} ⑈`
  - Transit / routing: `⑆ {9-digit routing} ⑆`
  - On-us / account: `{account} ⑈`
  - Map the four symbols (transit ⑆, amount ⑇, on-us ⑈, dash ⑊) to the bundled
    font's specific glyph-encoding characters (pin per the chosen font).
- **Placement:** position in the MICR clear band ~5/8" from the bottom edge, left-
  aligned, with E-13B pitch (8 chars/in nominal); drop the small grey RTN/ACCT/CHK
  labels (real checks have none in the band).
- **Caveat (documented in code comment):** font yields a visually correct,
  image/OCR-scannable line; true magnetic processing still needs MICR toner + stock.
- Keep a graceful fallback: if routing/account are blank, render zeros as today.

### 5. PDF output unification + embedded preview

**New IPC + API:** add a buffer-returning render call (none exists today):

- Main: `ipcMain.handle('print:render', async (_e, { html, pdfOptions }) =>
  ({ base64: (await htmlToPDFBuffer(html, pdfOptions)).toString('base64') }))`
  in [`src/main/ipc/index.ts`](../../../src/main/ipc/index.ts) (reusing the existing
  `htmlToPDFBuffer`). Serialize like the existing batch handler note (printToPDF is heavy).
- Renderer: `api.renderPdf(html, pdfOptions?) => Promise<{ base64?: string; error?: string }>`
  in [`api.ts`](../../../src/renderer/lib/api.ts).

**New component:** `<PdfPreview html={...} title={...} pdfOptions={...} />` (e.g.
`src/renderer/components/PdfPreview.tsx`):

- On mount/`html` change, calls `api.renderPdf`, converts base64 → `Blob` →
  object URL, displays in `<embed type="application/pdf">` (Electron's Chromium has a
  native PDF viewer). Revokes the URL on unmount/update.
- Toolbar buttons wired to existing APIs: **Save as PDF** → `api.saveToPDF(html, title, opts)`;
  **Print** → `api.print(html)`. Loading + error states.

**Migrate call sites** (replace path 2 & 3 with `<PdfPreview>` / the real-PDF APIs):

- HTML `srcDoc` iframes → `<PdfPreview>`: `InvoiceDetail.tsx`, `InvoiceForm.tsx`,
  `InvoiceSettings.tsx` (template preview), `QuoteDetail.tsx`, `QuoteForm.tsx`,
  `JournalEntryForm.tsx`, `DemandLetterGenerator.tsx`, `DebtInvoiceFormatter.tsx`.
- Legacy `window.open()`+`window.print()` → `api.print` / `<PdfPreview>`:
  `DemandLetterGenerator.tsx`, local `printHTML` in `InvoicesUpgrades.part4.tsx`
  (statement, register, invoice) and `ClientsUpgrades.part4.tsx` (6 call sites).
- Already-correct paths (bills, account history, debt case file, `print:*` handlers)
  keep working; their previews can adopt `<PdfPreview>` for consistency.
- **Audit task:** grep for remaining `window.print(`, `srcDoc=`, and `window.open(`
  in form/document code paths and confirm none ship a document form after this work.

## Data flow (new preview)

```
Renderer module → generate*HTML(...) → <PdfPreview html=...>
  → api.renderPdf(html) → IPC print:render
  → htmlToPDFBuffer(html)  [headless BrowserWindow + printToPDF]
  → base64 → renderer → Blob URL → <embed application/pdf>
Save → api.saveToPDF(html, title, opts)   Print → api.print(html)
```

## Error handling

- `print:render` failures return `{ error }`; `<PdfPreview>` shows an inline error with
  a retry, never a blank embed.
- MICR font embed: if the data-URI is missing/oversized, fall back to a monospace
  approximation (do not crash check generation).
- Save/print already return `{ error }` / `{ cancelled }` — surface to the user.

## Testing / verification

- `npm run build` clean.
- For each form: render via `<PdfPreview>` and visually confirm classic look (Arial,
  B&W, ruled boxes) and pagination in the embedded viewer; Save and Print work.
- Check: confirm E-13B glyphs render (digits + transit/on-us symbols), sit in the clear
  band, and the line scans (image/OCR) in a reader test.
- Confirm the Invoice Settings font picker is gone and output is Arial regardless of any
  legacy stored `settings.font`.
- Confirm no document form still routes through `window.print()`/`window.open()`.

## Risks & open items

- **Font license:** must verify the chosen E-13B file is genuinely redistributable;
  record the license file in-repo. (Fallback options: user-licensed `.ttf`, or vector
  glyphs — deferred unless licensing blocks.)
- **MICR symbol encoding** varies per font; pin the exact character map to the bundled
  font during implementation.
- **`<embed>` print** behavior differs from rendering source HTML; that's why Save/Print
  re-send the HTML to the proven `saveToPDF`/`print` handlers rather than printing the
  embed.
- **281 KB file size:** refactor incrementally, one generator at a time, to keep diffs
  reviewable and avoid a single massive rewrite.

## Build order (high level)

1. Classic style system + helpers (§1) with a couple of forms as the pattern.
2. Roll classic styling across the remaining generators (§2).
3. Force Arial + remove font picker (§3).
4. MICR module (§4).
5. `print:render` IPC + `api.renderPdf` + `<PdfPreview>` (§5 infra).
6. Migrate all preview/print call sites to `<PdfPreview>`/real-PDF APIs; retire legacy
   paths; final audit (§5 migration).
7. Build + verify all forms.
