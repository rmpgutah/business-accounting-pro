# Business Accounting Pro — 150+ System Improvement Roadmap

## Opencode agent execution plan
## 2026-05-21

---

### Phase Structure

| Phase | Items | Effort | Status |
|-------|-------|--------|--------|
| **Phase 0**: Foundation | 4 | 2 days | ✅ In progress |
| **Phase 1**: Critical Accuracy Fixes | 12 | 5-8 days | ⬜ |
| **Phase 2**: Financial Reporting Accuracy | 15 | 6-10 days | ⬜ |
| **Phase 3**: Tax Form Accuracy | 10 | 5-8 days | ⬜ |
| **Phase 4**: PDF & Print Excellence | 16 | 5-8 days | ⬜ |
| **Phase 5**: Reports & Export Upgrades | 15 | 5-8 days | ⬜ |
| **Phase 6**: UI Foundation — Shared Components | 14 | 8-12 days | ⬜ |
| **Phase 6.5**: Advanced & Dynamic OCR Capture | **20** | **10-15 days** | ⬜ Added |
| **Phase 7**: UI Navigation & Layout | 12 | 5-8 days | ⬜ |
| **Phase 8**: UI Polish & Power Features | 18 | 6-10 days | ⬜ |
| **Phase 9**: Data Visualization | 8 | 4-6 days | ⬜ |
| **Phase 10**: Enterprise Architecture — IPC Split, Multi-Currency, RBAC | 3 | 15-25 days | ⬜ |
| **Phase 11**: Enterprise Features | 8 | 12-20 days | ⬜ |
| **Phase 12**: Intelligence & ML | 7 | 10-18 days | ⬜ |
| **Phase 13**: Platform & Testing | 7 | 8-15 days | ⬜ |

**Total items: 170 (150 original + 20 advanced OCR mega upgrade)**

---

## Phase 0: Foundation (✅ Done)

| # | Item | Files | Status |
|---|---|---|---|
| 0.1 | Shared `roundCurrency()` utility with banker's rounding | `src/shared/utils.ts` | ✅ |
| 0.2 | Fix `tablesWithoutCompanyId` / `tablesWithoutUpdatedAt` desync (state_tax_brackets, federal_tax_brackets, state_tax_rates, exchange_rates, automation_run_log) | `src/main/ipc/index.ts:644-688` | ✅ |
| 0.3 | Typed IPC channel contracts | `src/shared/ipc-channels.ts` | ✅ |
| 0.4 | Configurable date timezone in format.ts | `src/renderer/lib/format.ts` | ✅ |

---

## Phase 6.5: Advanced & Dynamic OCR Capture System (MEGA UPGRADE, ⬜ Planned)

**Files:** `src/main/services/receipt-ocr-advanced.ts`, multiple IPC handlers, new renderer components

### Feature breakdown

#### OCR Engine & Image Pipeline

| # | Item | Description |
|---|---|---|
| OCR-1 | **Multi-engine OCR dispatch** | Auto-select between tesseract.js (offline), Google Vision, and OpenAI Vision based on image quality and confidence thresholds. Pluggable engine architecture. |
| OCR-2 | **Scanned PDF rasterization** | Convert scanned image-only PDFs to high-DPI PNG images for OCR (sharp + pdf2pic). Current code returns empty for scanned PDFs — this closes the gap. |
| OCR-3 | **Multi-page document OCR** | Process all pages of a multi-page receipt/invoice document. Aggregate results across pages. |
| OCR-4 | **Image enhancement pipeline** | Auto-deskew, contrast normalization, shadow removal, adaptive binarization (sharp-based). Dramatically improves tesseract accuracy on poor-quality photos. |
| OCR-5 | **Batch multi-receipt scanning** | Process multiple receipts from a single uploaded scan. Auto-detect individual receipt boundaries via whitespace analysis. |

#### Field Extraction

| # | Item | Description |
|---|---|---|
| OCR-6 | **Business card scanning** | Extract name, phone, email, company, title from business card images. Auto-create vendor record with one click. |
| OCR-7 | **Sales tax jurisdiction detection** | Detect sales tax rates and amounts by jurisdiction using vendor address + tax amount parsing. Auto-classify for filing purposes. |
| OCR-8 | **Barcode/QR decoding** | Detect and decode Code128, Code39, EAN-13, UPC-A, PDF417, QR codes on receipts. Auto-populate receipt number and tracking info. |
| OCR-9 | **ML-powered field extraction** | Train weighted pattern matcher from user corrections. Store in `ocr_correction_feedback` table. Auto-improve vendor, date, total extraction over time. |
| OCR-10 | **Multi-language receipt OCR** | Auto-detect language on receipt (English, Spanish, French, Chinese, Japanese, Portuguese, German). Route to correct tesseract language pack. |
| OCR-11 | **Currency auto-detection** | Detect currency from symbols ($, €, £, ¥, R$, etc.), formatting conventions, and digit grouping. Auto-convert to company base currency. |
| OCR-12 | **Line-item category suggestion** | Suggest expense categories for each line item based on description keywords, vendor, and historical categorization patterns. |

#### User Experience

| # | Item | Description |
|---|---|---|
| OCR-13 | **Real-time streaming OCR preview** | Show OCR results progressively as tesseract processes each page/line. Updates in real time. |
| OCR-14 | **Confidence heatmap overlay** | Visual heatmap on the receipt image showing which regions have high/low OCR confidence. Users can target corrections. |
| OCR-15 | **User correction feedback loop** | Every user correction is saved to `ocr_correction_feedback` table. Weighted pattern matcher improves extraction from user's history. |
| OCR-16 | **Receipt matching to existing entities** | Match newly scanned receipt against existing expenses, invoices, and bills by amount + vendor + date proximity. Prevents duplicate entry. |
| OCR-17 | **Mobile app QR capture** | QR code on desktop pairs with phone camera. Snap receipt photos from phone, auto-upload to desktop via VPS WebSocket. |
| OCR-18 | **Wallet/app receipt import** | Parse Apple/Google Wallet passes, banking app exported receipts (PDF), and email receipt summaries. |
| OCR-19 | **Receipt image auto-crop & straighten** | Auto-detect receipt boundaries in a photo of a receipt on a desk. Crop to receipt only, perspective correct, and straighten. |
| OCR-20 | **Vendor dedup from OCR** | When OCR extracts a vendor name, fuzzy match against existing vendors. Suggest "Use existing vendor [name]" or "Create new vendor [OCR name]". |
