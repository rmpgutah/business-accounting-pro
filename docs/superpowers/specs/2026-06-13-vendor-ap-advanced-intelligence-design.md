# Vendor & AP — Advanced Intelligence Wave — Design Spec

**Date:** 2026-06-13
**Branch:** `claude/romantic-lalande-ac2d3a` (continues the shipped Vendor & AP Command Center, PR #27; base tip `d495cb2`)
**Status:** Approved scope — all 3 phases incl. the 3-way-match migration

---

## 1. Summary

Add an advanced-intelligence wave to the existing Vendor & AP Command Center (`src/renderer/modules/vendors-ap/`), in three new tabs:
- **Intelligence** — risk, fraud, anomaly, duplicate detection, composite vendor risk score.
- **Optimization** — spend-savings intelligence (off-contract spend, price variance, contract renewals, subscriptions).
- **Matching** — 3-way match (bill ↔ PO ↔ receipt) with exceptions and touchless auto-approve.

Phases A (Intelligence) and B (Optimization) are **read-only, no schema changes** — mostly surfacing existing handlers plus a few new read-only `vn:` functions over columns that already exist. Phase C (Matching) is **BUILD-HEAVY**: it adds a bill↔PO link via `ALTER TABLE` migration, a match engine, and write actions (link, auto-approve). Phases ordered so A/B are independently mergeable before C.

Maps to the competitive frontier from prior research: NetSuite Financial Exception Management + Bill Capture 3-way match, BILL fraud detection, Ramp spend optimization.

## 2. Goals / Non-goals

**Goals**
- Three new tabs surfacing risk/optimization/matching intelligence, built on the existing token-clean `shared/ui` pattern.
- New backend is **append-only** after the `vn:` block (`ipc/index.ts:15612`); Phase C adds two nullable columns via try/catch `ALTER`.
- No regressions; tab bar handles 10 tabs gracefully (wrap/scroll).

**Non-goals**
- No new OCR/document-capture (bill capture ingestion is out of scope; matching operates on already-entered bills/POs).
- No changes to the Expenses module (`expenses/`, `ex:`/`eu:` handlers) beyond *reading* existing `ex:` handlers already wrapped in `api.ts`.
- No ML model training — "intelligence" = deterministic heuristics over existing data (z-score, fuzzy match, variance), consistent with the app's existing `ex:`/`intel:` style.

## 3. Architecture

New tab files under `src/renderer/modules/vendors-ap/`:
```
Intelligence.tsx     # Phase A
Optimization.tsx     # Phase B
Matching.tsx         # Phase C
```
Module shell (`index.tsx`) gains 3 `TabId`s, 3 `TABS` entries, 3 render arms. Tab bar updated to `flex-wrap` (10 tabs) so it doesn't overflow on narrow windows.

New backend (all in `vendor-account-features.ts` + `ipc/index.ts` `vn:` block + `api.ts` wrappers, following the Task-8 precedent):
- **Phase A readers (read-only):** `vn:ach-risk-flags`, `vn:duplicate-vendors`, `vn:risk-score`.
- **Phase B readers (read-only):** `vn:off-contract-spend`, `vn:price-variance`.
- **Phase C (migration + engine):** migration adds `bills.po_id` + `bill_line_items.po_line_id`; new fns `vn:link-bill-po` (WRITE — calls `scheduleAutoBackup()`), `vn:match-results`, `vn:match-exceptions`, `vn:unmatched-bills`, `vn:pos-for-vendor` (helper for the link picker), `vn:auto-approve-matched` (WRITE — calls `scheduleAutoBackup()`).

Data flow unchanged: panel → `api.vnX()` → `ipcMain.handle('vn:…')` → service → SQLite, company-scoped via `db.getCurrentCompanyId()`.

## 4. Phase A — Intelligence tab

KPI strip + Section cards (copy `Overview.tsx` structure: per-slice `useState`, one `useEffect` with `cancelled` guard, no `Promise.all`).

**Surfaced (existing wrappers):**
- Spend anomalies — `api.exVendorAnomalies(2)` → z-score outliers (vendor_name, amount, avg_amt, z_score).
- Concentration/dependency — `api.vnConcentration()` + `api.vnPortfolioSummary()`.
- Forecast context — `api.vnSpendForecast(vendorId)` (used in drilldown; optional here).

**New readers:**
1. **`vn:ach-risk-flags`** → `vendorAchRiskFlags(cid, withinDays = 14)`: join `vendor_ach_updates` (`submitted_at`, `status`, `vendor_id`) to `bills` (open: `status IN ('pending','received','approved','partial')`, `due_date`) for the same vendor, flagging vendors whose ACH bank-detail change `submitted_at` is within `withinDays` of (or after) an open bill's `due_date` — the classic "bank details changed right before we pay them" fraud signal. Return `[{vendor_id, vendor_name, ach_submitted_at, ach_status, bill_id, bill_number, due_date, balance, reason}]`. **Gotcha: column is `submitted_at`, not `created_at`.**
2. **`vn:duplicate-vendors`** → `duplicateVendors(cid)`: candidate pairs among non-deleted vendors matching on `lower(trim(name))`, or equal non-null `tax_id`, or equal non-null `email`, or equal non-null `ach_account`. Return `[{id_a, name_a, id_b, name_b, match_reason}]`. Mirrors the `feat:client:find-duplicates` precedent (`ipc:1718`).
3. **`vn:risk-score`** → `vendorRiskScore(cid)`: composite 0–100 per vendor (grade A–F) folding payment timeliness (`on_time_payment_count`/`late_payment_count`/`avg_days_to_pay`), `dispute_count`, spend concentration share, and compliance gaps (expired insurance/contract, missing W-9/1099-no-TIN). Return `[{vendorId, name, score, grade, factors[]}]` sorted riskiest-first. All inputs are existing `vendors` columns + `vendor_disputes` (no migration).

UI: KPIs (high-risk vendors, ACH risk flags, duplicate pairs, top-3 concentration). Sections: **Payment-Risk Flags** (ach-risk-flags, severity-colored), **Duplicate Vendors** (pairs with Merge deep-link to existing `ex:merge-vendor` or just a "Review" → Vendor 360), **Spend Anomalies** (exVendorAnomalies), **Risk Leaderboard** (risk-score grades). Rows deep-link to Vendor 360 via `onViewVendor`.

## 5. Phase B — Optimization tab

**Surfaced:**
- Contract renewals — `api.featVendorExpiringContracts(60)` (id, name, contract_end_date, auto_renew, renewal_notice_days).
- Subscriptions/recurring — `api.exDetectRecurring()` (vendor_id, description, avg_amount, occurrences, avg_days_apart) → client-side roll-up to per-vendor monthly/annual estimate (same math as `ExpenseInsights.tsx`).
- Spend trends — `api.vnGrowthTrend(vendorId)` / `api.vnYoySpend(vendorId)` (in drilldown).

**New readers:**
1. **`vn:off-contract-spend`** → `vendorOffContractSpend(cid)`: total spend (sum over `expenses` + `bills`) for vendors where `approval_status != 'approved'` OR contract expired (`COALESCE(contract_end_date, contract_end) < date('now')`). Return `[{vendor_id, name, approval_status, total_spend, reason}]`, highest first. (`approval_status` is free-text, default `'approved'`.)
2. **`vn:price-variance`** → `vendorPriceVariance(cid, minOccurrences = 3)`: group `bill_line_items` (joined to `bills` for `vendor_id`/`vendor name`) by `vendor_id` + `lower(trim(description))`, compute `COUNT`, `MIN`/`MAX`/`AVG(unit_price)`, and variance % = `(max-min)/nullif(avg,0)`. Return rows with `occurrences >= minOccurrences` and meaningful variance, highest variance first. (Description-level, since bill lines have no SKU/item_id — noted limitation.)

UI: KPIs (off-contract spend total, est. annual subscription commitment, vendors with price drift, contracts expiring ≤60d). Sections: **Savings Opportunities** (off-contract spend), **Price Drift** (price-variance), **Subscriptions** (recurring roll-up with annualized cost), **Contract Renewals** (expiring contracts, sorted by date).

## 6. Phase C — Matching tab + 3-way match (migration)

**Migration** (`src/main/database/index.ts`, try/catch `ALTER`, idempotent):
```sql
ALTER TABLE bills ADD COLUMN po_id TEXT;              -- nullable FK-by-convention to purchase_orders.id
ALTER TABLE bill_line_items ADD COLUMN po_line_id TEXT; -- nullable, links to po_line_items.id
```
No `tableConfig` changes needed (`bills` has `company_id`+`updated_at`; `bill_line_items` already in `TABLES_WITHOUT_UPDATED_AT`; both columns nullable so existing rows are unaffected).

**Backend:**
- **`vn:pos-for-vendor`** → `posForVendor(cid, vendorId)`: open/approved POs for a vendor (id, po_number, total, status) — feeds the link picker.
- **`vn:link-bill-po`** (WRITE) → `linkBillToPo(cid, billId, poId)`: set `bills.po_id`; best-effort auto-map bill lines to PO lines by matching `lower(trim(description))` (set `bill_line_items.po_line_id`). Calls `scheduleAutoBackup()`. Returns `{ok, linkedLines}`.
- **`vn:match-results`** → `threeWayMatch(cid, billId?)`: for bills with `po_id` set, per bill compute line-level match: qty variance (`bill_line_items.quantity` vs `po_line_items.quantity_received`), price variance (`unit_price` delta), and a per-line status (`matched` | `qty_over` | `qty_under` | `price_mismatch` | `unlinked`) plus a bill-level rollup status + total variance $. Return `[{bill_id, bill_number, vendor_name, po_number, status, totalVarianceAmount, lines:[…]}]`.
- **`vn:match-exceptions`** → bills whose rollup status ≠ `matched` (variance beyond a tolerance constant, default $0.01 / 0 qty). Convenience filter over `threeWayMatch`.
- **`vn:unmatched-bills`** → `unmatchedBills(cid)`: bills with `po_id IS NULL` and a vendor that has at least one PO (candidates for linking).
- **`vn:auto-approve-matched`** (WRITE) → `autoApproveMatched(cid, maxAmount)`: for bills that are cleanly `matched` AND `total <= maxAmount` AND `status` in (`pending`,`received`), set `status='approved'`. Calls `scheduleAutoBackup()`. Returns `{approvedCount, billIds[]}`. "Touchless AP under threshold." Conservative: only fully-matched bills.

**UI (Matching tab):**
- KPIs: matched bills, exceptions, unmatched (linkable), total variance $.
- **Unmatched Bills** section: each row has a "Link PO" control → fetches `vn:pos-for-vendor`, pick one → `vn:link-bill-po`, reload.
- **Match Exceptions** section: bills with qty/price variance, expandable to line detail with variance highlighting; deep-link to the bill (via `useNavigation().goTo('bills')`).
- **Touchless Auto-Approve** control: numeric threshold input + "Auto-approve clean matches ≤ $X" button → `vn:auto-approve-matched` (with a confirm), shows result count.
- Note on the existing `approval_chains` (entity_type already allows `'bill'`): surfaced as informational ("auto-approve respects your bill approval chain thresholds"); the explicit threshold action above is the v1 touchless mechanism.

## 7. Cross-cutting rules (must honor)

- Copy `Overview.tsx`/`shared/ui` pattern: per-slice `useState`, one `useEffect` + `cancelled` guard, independent `api` calls (**no `Promise.all`**), `arr()`/`obj()` setter wrappers that check `!r.error`.
- **No hard-coded hex** — `TOK` palette + tokens only; run `bash scripts/ui-leak-check.sh` (must not rise).
- New `vn:` readers: company-scoped via `db.getCurrentCompanyId()`, return `[]`/`{}` on no-company, never throw. WRITE handlers (`link-bill-po`, `auto-approve-matched`) call `scheduleAutoBackup()`.
- Tab bar → `flex-wrap` so 10 tabs don't overflow.
- Reuse `useNavigation().goTo(...)`, `formatCurrency`/`formatDate`, classification badges, `gradeColor`.

## 8. Testing & verification

No unit-test runner exists. Per task: `npm run typecheck` (both projects) + `npm run build` + `bash scripts/ui-leak-check.sh` (counts must not rise) + a final manual dev pass. Phase C additionally: confirm the migration runs idempotently (re-launch doesn't error), a bill links to a PO, match results compute, and auto-approve only touches clean matches under threshold. Every panel must render an empty state (not crash) on `{error}`/`[]`.

## 9. Phasing

1. **Phase A — Intelligence:** 3 new readers + Intelligence.tsx + tab registration. No migration.
2. **Phase B — Optimization:** 2 new readers + Optimization.tsx + tab registration. No migration.
3. **Phase C — Matching:** migration + 6 backend fns (2 write) + Matching.tsx + tab registration.

Each phase: build → typecheck → build → leak-check → manual pass → commit. A/B independently mergeable before C.

## 10. Open questions / assumptions

- Assumes dev DB has bills/POs/vendor_ach_updates data to exercise matching/risk; otherwise panels show empty states (acceptable).
- 3-way match is description-based for line mapping (bill lines lack SKU/item_id); a future enhancement could add `bill_line_items.item_id` for SKU-accurate matching — out of scope here.
- `vn:auto-approve-matched` sets `bills.status='approved'` directly (simple touchless v1); deeper integration with `approval_instances` workflow is a possible follow-up.
