# Vendor & AP Command Center — Design Spec

**Date:** 2026-06-13
**Branch:** `claude/romantic-lalande-ac2d3a` (works side-by-side with `claude/relaxed-bassi-7ac568`, which owns the Expenses overhaul)
**Status:** Approved scope — full module, 3 internal waves

---

## 1. Summary

Build a new top-level module, **Vendor & AP Command Center** (`vendors-ap`), that surfaces an existing-but-dark backend into a flagship vendor-management and accounts-payable workspace. The app already ships a 150-function vendor service (`src/main/services/vendor-account-features.ts`), 54 of which are wired to IPC and have `api.ts` wrappers (`api.ts:763–816`), plus dozens of AP/1099/payment `feat:` handlers — none of which are surfaced beyond a thin vendor sub-tab in the Expenses module.

This module lights that capability up, mapped to what the market leaders (Bill.com, Ramp, NetSuite Bill Capture, QuickBooks 1099, Sage compliance) win on: vendor 360, spend/concentration analytics, AP approval routing, payment runs (ACH/positive-pay/check), and 1099/insurance/contract compliance with audit-grade traceability.

### Why this, why now (competitive context)
- **Spend/AP is the hottest unbundled lane** (Bill.com, Ramp, Brex, Expensify). A clean vendor + AP + compliance story is now table-stakes for a serious accounting product.
- **Audit-grade traceability is the credibility gate for AI/automation.** Every compliance and 1099 surface ties back to source records.
- The backend is **already built** — the work is surfacing, not inventing. Highest leverage available.

## 2. Goals / Non-goals

**Goals**
- A standalone, navigable `vendors-ap` module delivering: portfolio dashboard, vendor directory, Vendor 360 detail, AP approvals workbench, payments center, and 1099/compliance/portal-admin surfaces.
- Surface the dark `vn:` (54 handlers) and AP-relevant `feat:` handlers with **zero regression** to existing modules.
- Two small, well-scoped new backend readers (disputes; multi-policy W-9/insurance).
- Strict adherence to "Warm Structured Glass" design tokens; net-zero increase in UI leak-guard counts.

**Non-goals**
- No re-implementation of bill / PO CRUD — deep-link into the existing `bills` and `purchase-orders` modules via `useNavigation`.
- No edits to the Expenses module (`relaxed-bassi`'s lane). The existing `expenses/Vendor*` components stay as-is. Repointing them at a shared layer is **deferred** (post-merge cleanup).
- No new payment *execution* (no actually moving money) — we record/generate batches and files exactly as the existing handlers do.

## 3. Architecture

**Approach A — standalone tabbed Command Center** (chosen over scatter-into-bills and over a shared-layer refactor, both of which touch other branches' files).

```
src/renderer/modules/vendors-ap/
  index.tsx                 # module shell: tab bar + routing between panels & detail
  Overview.tsx              # Wave 1 — portfolio dashboard
  Directory.tsx             # Wave 1 — searchable/filterable vendor list w/ scorecards
  Vendor360.tsx             # Wave 1 — single-vendor deep view (vnFullSnapshot)
  ApprovalsWorkbench.tsx    # Wave 2 — pending approvals + chain config
  PaymentsCenter.tsx        # Wave 2 — ACH batches / positive pay / check runs
  TaxCompliance1099.tsx     # Wave 3 — 1099 status, recalc, prep, filing runs
  ComplianceHub.tsx         # Wave 3 — health check, expiring docs, onboarding, disputes
  PortalAdmin.tsx           # Wave 3 — review submitted invoices / PO responses / ACH changes
  shared/                   # local Section/Empty/Th/Td helpers + small charts (copied from ExpenseInsights pattern, token-clean)
```

**Routing/registration** (per CLAUDE.md "both files" rule; no React Router):
- `App.tsx`: (1) `const VendorsApModule = lazy(() => import('./modules/vendors-ap'))`; (2) `MODULE_NAMES['vendors-ap'] = 'Vendor & AP Command Center'`; (3) switch case `case 'vendors-ap': return <VendorsApModule />;`.
- `Sidebar.tsx`: add `{ id: 'vendors-ap', label: 'Vendors & AP', icon: Building2 }` to the **FINANCE** section (`Building2` already imported).

**Data flow:** Renderer panel → `api.vnX()` / `api.featX()` (existing wrappers in `api.ts`) → `ipcMain.handle('vn:…'|'feat:…')` → service → SQLite. New readers add handlers + wrappers following the same pattern.

**In-module navigation:** the shell holds `view = {tab, vendorId?}` state. Directory rows and dashboard drilldowns set `vendorId` and switch to the `Vendor360` view. Cross-module jumps (open a bill, a PO) use the existing `useNavigation` helper, not local CRUD.

## 4. Component design

Each panel copies the **`ExpenseInsights.tsx` precedent** exactly: a top KPI strip of `.block-card` stat cards, then themed `Section` cards in a responsive grid. Per-slice `useState`; a single `useEffect` with a `cancelled` guard firing each `api` call **independently** (no `Promise.all`, so one `{error}`-returning handler never blanks the page); `arr()`/`obj()` setter wrappers that check `!cancelled && !r.error`.

### Wave 1 — Vendor 360
- **Overview.tsx** — KPIs: total vendors, total spend, outstanding AP, overdue, 1099-required count, open compliance issues. Cards: top vendors by spend (`vnRanking`), concentration risk + top-3 % (`vnConcentration`/`vnPortfolioSummary`), spend by type/diversity/location (`vnByType`/`vnByLocation`/`vnDiversity`), **AP aging buckets** (`featApAgingChart`), health-check summary (`vnHealthCheck`).
- **Directory.tsx** — search (`vnSearch`) + filters (`vnByStatus`/`vnByApproval`/`vnByType`); table with inline A–D scorecard grade (`vnAllScores`), classification badges (`lib/classifications.ts`), payment terms. New/Edit reuse the existing `VendorForm`. Row click → Vendor360. Export via `vnExport` → CSV.
- **Vendor360.tsx** — driven by `vnFullSnapshot(vendorId)` with the per-vendor handlers as needed: profile header + scorecard (`vnScorecard`); spend analytics (`vnSpendByMonth`, `vnSpendByCategory`, `vnQuarterlySpend`, `vnYoYSpend`, `vnGrowthTrend`, `vnSpendForecast`); payment behavior (`vnBillSummary`, `vnPaymentHistory`, `vnAvgPaymentDays`, `vnUpcomingBills`); compliance snapshot (`vn1099Status`, `vnW9Status`, `vnInsuranceInfo`, `vnContractInfo`); related counts (`vnRelated`); notes (`vnNotes`/`vnNoteAdd`), activity (`vnActivityLog`), email history (`vnEmailHistory`). Bills/POs deep-link out.

### Wave 2 — AP Automation
- **ApprovalsWorkbench.tsx** — pending approvals queue (`featApprovalPending`), approve/reject (`featApprovalAct`), chain config editor (`featApprovalChainUpsert`) for `entity_type ∈ {bill, purchase_order}`.
- **PaymentsCenter.tsx** — three sub-sections: ACH batches (`featAchBatchCreate/List/Items/MarkSubmitted`), positive pay (`featPositivePayGenerate/List/MarkSubmitted`), check runs (`featCheckPrintRecord/List`). Read-only listing + create/mark actions only (no money movement).

### Wave 3 — Compliance & Tax
- **TaxCompliance1099.tsx** — 1099 readiness (`vn1099Status`, `vnNeeding1099`, `vnWithoutW9`), recalc YTD (`featVendor1099Recalc`), prep report (`feat1099PrepReport`), filing runs (`feat1099RunCreate/List`), backup-withholding view (`withholding_tracking` via `rawQuery`).
- **ComplianceHub.tsx** — `vnHealthCheck` issue list, expiring insurance/contracts (`vnExpiredInsurance`/`vnExpiredContracts` + `featVendorExpiringContracts`), missing W-9 (`vnWithoutW9`), onboarding checklists (`vendor_onboarding_checklists`), and **disputes** (new reader — see §5). Remediation actions: request W-9, log attestation (`featVendorAttestSubmit`).
- **PortalAdmin.tsx** — review vendor-submitted invoices (`featVendorInvList`/`featVendorInvReview`), PO responses (`featVendorPoListResponses`), ACH-change approvals (`featVendorAchApprove`).

## 5. New backend (small, well-scoped)

Two readers are genuinely missing. Add to `vendor-account-features.ts` + handler in `ipc/index.ts` + wrapper in `api.ts`, following the existing `vn:` pattern (company-scoped, return rows, no throw).

1. **`vn:disputes`** `(vendorId?)` → rows from `vendor_disputes` (optionally filtered by vendor), joined to `bills.bill_number` and `vendors.name`. `vendor_disputes` is in `TABLES_WITHOUT_COMPANY_ID`/`TABLES_WITHOUT_UPDATED_AT` — read-only here, so no write-path config change. Optional `vn:dispute-upsert` if we allow opening/resolving disputes from the hub (writes must pass `company_id` explicitly).
2. **`vn:w9-records`** `(vendorId)` → `vendor_w9_records` rows (richer than the legacy `vendors.w9_status`); **`vn:insurance-policies`** `(vendorId)` → `vendor_insurance_policies` rows (multi-policy). The existing `vn:w9-status`/`vn:insurance-info` read legacy single-value columns; Vendor360 prefers the dedicated tables and shows the legacy values as a fallback/summary.

All new handlers must `require()` the service via the existing `vn()` accessor and return `[]`/`null` on no-company.

## 6. Cross-cutting rules & gotchas (must honor)

- **No `Promise.all`** in panels; independent calls + `cancelled` flag (matches precedent; mitigates `feat:`/`vn:` returning `{error}` instead of throwing — every result is inspected).
- **Design tokens only.** No hard-coded hex (the precedent `ExpenseInsights.tsx` has leaks like `#ef4444` — do **not** copy those; use `var(--color-accent-expense/income/warning/blue)`). `borderRadius: var(--app-radius)`. Use `.block-card`/`.block-btn`/`.block-table`/`.module-header`/`.empty-state`. Run `bash scripts/ui-leak-check.sh` and keep counts from rising.
- **AP aging reconciliation:** `featApAgingChart` reads `bills.balance`; `vn:` outstanding logic uses `total - amount_paid`. Pick one definition for the Overview AP card and label it; note the discrepancy in code.
- **Derived TIN:** there is no `tin`/`tax_id_last4` column on `vendors`; last-4 is `substr(tax_id,-4)`. Don't query a `tin` column.
- **W-9/insurance live in two places** (legacy `vendors.*` columns vs dedicated tables). Prefer dedicated tables in new surfaces.
- **Company scoping** via `db.getCurrentCompanyId()`; respect `TABLES_WITHOUT_COMPANY_ID` / `TABLES_WITHOUT_UPDATED_AT` (`src/main/database/tableConfig.ts`) for any write.
- **`scheduleAutoBackup()`** after any new write handler (disputes upsert, if added).
- **Reuse, don't duplicate:** `VendorForm` (create/edit), `lib/classifications.ts` badges, `lib/format.ts` `formatCurrency`/`formatDate`, `EntityChip`/`RelatedPanel`/`useNavigation`.

## 7. Coordination with `relaxed-bassi` (parallel-safe)

- All new files under `src/renderer/modules/vendors-ap/` — no overlap with `expenses/`.
- Only shared edits: 3 lines in `App.tsx`, 1 line in `Sidebar.tsx` (trivial merge), plus appended handlers/wrappers at the **end** of `ipc/index.ts` / `api.ts` and `vendor-account-features.ts` (append-only → conflict-free).
- Do **not** touch `expenses/Vendor*`, `ex:`/`eu:` handlers, or expense components.

## 8. Testing & verification

- **Build:** `npm run build` must pass (renderer + tsc) before any completion claim.
- **Manual dev pass:** `npm run dev` (after `npm rebuild better-sqlite3`); verify the module loads from the sidebar, each tab renders with seeded data, and no console errors. Use the preview tooling to capture the Overview dashboard and a Vendor 360 view.
- **Leak guard:** `bash scripts/ui-leak-check.sh` — counts must not rise.
- **No-data resilience:** every panel must render an `Empty` state (not crash) when a handler returns `{error}` or `[]`.
- **Regression:** Expenses module's vendor tab still works unchanged.

## 9. Phasing (all on this branch)

1. **Wave 1 — Vendor 360:** module skeleton + registration + Overview + Directory + Vendor360. Shippable on its own; surfaces the bulk of `vn:`.
2. **Wave 2 — AP Automation:** ApprovalsWorkbench + PaymentsCenter.
3. **Wave 3 — Compliance & Tax:** TaxCompliance1099 + ComplianceHub (+ new disputes/W-9/insurance readers) + PortalAdmin.

Each wave: build → `npm run build` → manual dev pass → leak check → commit.

## 10. Open questions / assumptions

- Assumes seeded vendor/bill data exists in the dev DB to exercise the dashboards; if not, a small seed step may be needed for the manual pass.
- Whether disputes should be editable (open/resolve) from the hub or read-only first — defaulting to **read-only in Wave 3**, with an optional `vn:dispute-upsert` if time allows.
