# Debt Collection Immersive Workspace — Design Doc

**Status:** Approved
**Date:** 2026-04-12
**Author:** Brainstorming session (rmpgutah + Claude)

## Problem

The Debt Collection module has grown organically to 23 components, 14+ DB tables, and 34 IPC handlers across 6 tabs. While feature-rich, it has two gaps:

1. **Fragmented navigation.** Clicking a debt replaces the entire tab content with DebtDetail, losing the list context. Switching between tabs loses the active debt context. Collectors doing 40-60 calls/day waste time re-finding their place.

2. **Missing court-readiness infrastructure.** When a debt goes to legal proceedings, attorneys need: provable chain of custody (every change logged immutably), organized evidence with admissibility ratings, FDCPA compliance proof, and a single exportable "court packet" PDF. The module has pieces of each but no unified court-grade data story.

Additionally, four automation gaps reduce operational efficiency: manual interest recalculation, no smart stage recommendations, no automatic audit trail, and no bank-payment matching.

## Goals

- Persistent debt list visible across all tabs (no losing context when switching)
- Immutable chain-of-custody audit log on every debt mutation
- One-click court packet PDF export (judge-ready format with TOC)
- Verification affidavit generator (FDCPA section 1692g compliance)
- Batch interest recalculation
- Rule-based smart stage recommendations (nudges, not auto-actions)
- Bank transaction → debt payment matching (auto + suggested)

## Non-Goals

- Full UI rewrite (Approach B: enhance existing tabs, not replace them)
- Witness/subpoena tracker (excluded by user — most collections don't reach trial)
- ML-based prediction (rule-based recommendations are sufficient)
- Real-time push notifications (desktop app, user-initiated refresh is fine)
- SMTP email integration (mailto: workflow is established and working)

## Design

### Section 1: Persistent Left-Panel Debt List

**Layout change in `index.tsx`:**

```
+------------------+------------------------------------------+
| DEBT MINI-LIST   | [Receivables] [Payables] [Pipeline] ...  |
| (280px, fixed)   |                                          |
|                  | ACTIVE TAB CONTENT                       |
| Search [____]    | (DebtDetail, PipelineView, LegalToolkit,  |
| Filter [▾]       |  AnalyticsView, Dashboard, etc.)          |
|                  |                                          |
| * Smith  $4,200  |                                          |
| * Jones  $1,800  |                                          |
| * Acme   $9,400  |                                          |
+------------------+------------------------------------------+
```

**New component:** `DebtMiniList.tsx` (~180 lines)
- Compact scrollable list with search input and status/stage filter dropdown
- Each row: debtor name, balance amount, risk-score color dot, stage badge
- Clicking a row sets `activeDebtId` in the parent — this ID persists across tab switches
- Currently selected debt highlighted with blue left border
- When Receivables/Payables tab is active AND `activeDebtId` is set, the tab content shows `DebtDetail` for that debt instead of the full list
- Other tabs (Pipeline, Legal, Analytics, Dashboard) show normal content but can reference `activeDebtId` for context filtering

**`index.tsx` change:** Wrap the tab content area in a `grid grid-cols-[280px_1fr]` layout. Left column = `DebtMiniList`, right column = current tab content. The DebtMiniList loads all debts (both receivable and payable) regardless of which tab is active.

**State flow:** `activeDebtId` lives in `index.tsx` (already exists). `DebtMiniList` receives `activeDebtId` and `onSelect` as props. Tab switches do NOT clear `activeDebtId` — the selected debt persists until the user explicitly clears it or selects a different one.

### Section 2: Court-Readiness Features

#### 2A: Chain-of-Custody Audit Log

**New table:**
```sql
CREATE TABLE IF NOT EXISTS debt_audit_log (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  field_name TEXT DEFAULT '',
  old_value TEXT DEFAULT '',
  new_value TEXT DEFAULT '',
  performed_by TEXT DEFAULT 'user',
  performed_at TEXT DEFAULT (datetime('now')),
  ip_address TEXT DEFAULT '',
  notes TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_debt_audit_debt ON debt_audit_log(debt_id);
```

Action types: `stage_advance`, `hold_toggle`, `assignment_change`, `fee_added`, `settlement_accepted`, `settlement_offered`, `compliance_event`, `plan_created`, `promise_recorded`, `promise_updated`, `note_added`, `field_edit`, `payment_recorded`, `communication_logged`, `dispute_filed`, `record_deleted`, `interest_recalculated`.

**Population mechanism:** Helper function `logDebtAudit(dbInstance, debtId, action, fieldName, oldValue, newValue, performedBy)` defined once in `ipc/index.ts`. Every existing debt-mutating IPC handler (14 handlers) gets a 1-3 line call appended after the primary mutation.

For the generic `db:update` on the `debts` table: a pre-read of the current row, diff the changed fields, and log each changed field as a separate audit entry.

**Critical design rule:** The `try/catch` in `logDebtAudit` silently catches errors. Audit logging MUST NEVER crash the primary operation. Courts accept "best effort" logging; they don't accept "we couldn't record the payment because the audit table was full."

**UI:**
- New "Audit Log" card in DebtDetail (read-only, NO edit/delete buttons — immutability is the point)
- Scrollable timestamped list: `Apr 10, 2026 2:15 PM — Stage advanced from Reminder → Warning by user`
- Full filterable view in Legal Toolkit sub-tab "Audit Trail"

#### 2B: Court Packet Export

**Enhanced `BundleExport.tsx`** — extends the existing bundle export into a comprehensive court-ready document.

**Court packet sections:**
1. Cover page — company, debtor, case reference, date, "Confidential — Prepared for Legal Proceedings"
2. Table of Contents — auto-generated
3. Statement of Account — reuses DebtInvoiceFormatter HTML
4. Communication Log — full debt_communications chronological
5. Payment History — all debt_payments with allocation breakdown
6. Evidence Inventory — all debt_evidence with admissibility and court relevance
7. Compliance Timeline — all debt_compliance_log (proves FDCPA/TCPA compliance)
8. Audit Trail — full debt_audit_log (proves chain of custody)
9. Settlement History — all offers, responses, counter-offers
10. Contact Directory — all debt_contacts with roles
11. Dispute History — all debt_disputes with resolutions

**New IPC handler:** `debt:generate-court-packet` — aggregates data from 8+ tables, generates multi-section HTML, converts to PDF via `htmlToPDFBuffer`.

**UI:** "Generate Court Packet" button in DebtDetail action bar AND Legal Toolkit tab.

#### 2C: Verification Affidavit Generator

**New print template:** `generateVerificationAffidavitHTML(debt, company, signatoryName)` in `print-templates.ts`.

Template includes:
- Header: "VERIFICATION OF DEBT — AFFIDAVIT"
- Sworn statement body with merge fields (debtor name, amounts, dates, source reference)
- Debt details table (original amount, current balance, interest, fees, date of obligation)
- Signature block with notary acknowledgment area
- Date line

**UI:** "Generate Affidavit" button in Legal Toolkit and DebtDetail action bar. Opens print preview.

### Section 3: Automations

#### 3A: Auto-Log Every State Change

This IS Section 2A's population mechanism. Every debt-mutating handler gets `logDebtAudit` calls injected. See Section 2A for the handler list.

#### 3B: Interest Auto-Recalculation

**New IPC handler:** `debt:batch-recalc-interest`

Queries all active debts with `interest_rate > 0`, recalculates using the debt's rate/type/compound_frequency from `interest_start_date` to today. Uses simple interest (`P * r * t`) or compound interest (`P * (1 + r/n)^(n*t) - P`) based on `interest_type`. Updates `interest_accrued` and `balance_due`. Logs each recalculation to audit trail.

Runs inside a single SQLite transaction. Not scheduled automatically — user clicks "Recalc Interest" button in DebtList toolbar or can set up via automation settings.

#### 3C: Smart Stage Recommendations

**New IPC handler:** `debt:smart-recommendations`

Returns `{ debtId, debtorName, recommendation, reason, priority }[]`.

Rule-based logic:

| Condition | Recommendation | Priority |
|---|---|---|
| Days in stage > 2x avg for that stage | "Consider advancing to next stage" | medium |
| Risk score >= 80 AND no legal action filed | "Recommend legal action" | high |
| Balance > $5K AND delinquent > 120d AND no settlement | "Consider settlement offer at 70%" | medium |
| Broken promises >= 2 AND pre-legal stage | "Escalate — multiple broken promises" | high |
| Statute expires within 90 days AND no legal action | "URGENT: File before statute expires" | critical |
| Payment plan active AND 2+ missed installments | "Plan failing — renegotiate or escalate" | high |
| Cease & desist active AND no legal counsel | "Legal counsel needed — C&D limits options" | high |

**UI:** "Recommendations" card in CollectorDashboard tab. Each recommendation has one-click action buttons (Advance Stage, Create Settlement, File Legal Action) that invoke existing handlers.

#### 3D: Payment Matching from Bank Imports

**New table:**
```sql
CREATE TABLE IF NOT EXISTS debt_payment_matches (
  id TEXT PRIMARY KEY,
  bank_transaction_id TEXT NOT NULL,
  debt_id TEXT NOT NULL,
  match_type TEXT NOT NULL CHECK(match_type IN ('auto','suggested')),
  confidence REAL DEFAULT 0,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dpm_debt ON debt_payment_matches(debt_id);
CREATE INDEX IF NOT EXISTS idx_dpm_txn ON debt_payment_matches(bank_transaction_id);
```

**New IPC handler:** `debt:match-bank-payments`

Logic:
1. Query unmatched credit-side `bank_transactions`
2. For each, search `debts` by: (a) reference number in memo → auto-match, (b) amount + date proximity → suggested match
3. Auto-matches create `debt_payments` records immediately
4. Suggested matches create `debt_payment_matches` with `status='pending'`
5. Return `{ auto_matched: N, suggested: N }`

**New component:** `PaymentMatchReview.tsx` (~150 lines) — modal listing suggested matches with Accept/Reject buttons. Accepted matches create `debt_payments`.

**UI:** "Match Payments" button in DebtList toolbar. After running, opens the review modal if there are suggested matches.

### Section 4: Data Model Summary

**New tables:** 2 (`debt_audit_log`, `debt_payment_matches`)
**New IPC handlers:** 5
**New components:** 2 (`DebtMiniList.tsx`, `PaymentMatchReview.tsx`)
**New print templates:** 2 (`generateCourtPacketHTML`, `generateVerificationAffidavitHTML`)
**Modified IPC handlers:** 14 (each gets `logDebtAudit` calls)
**Modified components:** 6 (`index.tsx`, `DebtDetail.tsx`, `LegalToolkit.tsx`, `DebtList.tsx`, `CollectorDashboard.tsx`, `BundleExport.tsx`)

### Delivery Phases

| Phase | Scope | Est. tasks |
|---|---|---|
| 1: Foundation | `debt_audit_log` table + `logDebtAudit` helper + inject into 14 handlers + audit log UI | 3 |
| 2: Court Features | Court packet export + verification affidavit + print templates | 3 |
| 3: Automations + Layout | Interest recalc + recommendations + payment matching + DebtMiniList panel | 4 |

Total: ~10 implementation tasks.

### Error Handling

- **Audit log:** Silent fail on insert (never blocks primary operation)
- **Court packet:** If any table query fails, that section renders "Data unavailable" instead of crashing the whole export
- **Interest recalc:** Transaction-wrapped — if any debt fails, entire batch rolls back. Error reported to user.
- **Payment matching:** Auto-matches that fail to create debt_payments are demoted to suggested matches for manual review
- **DebtMiniList:** Falls back to empty state if query fails. Does not block tab content from rendering.

### Testing Plan

- **Audit log:** Advance stage → verify audit entry created. Hold toggle → verify. Add fee → verify. Check that audit entries have correct old/new values.
- **Court packet:** Generate for a debt with data in all 8+ tables → verify all sections render. Generate for a debt with no communications → verify that section shows "No communications recorded."
- **Affidavit:** Generate → verify merge fields populated. Print preview → verify layout.
- **Interest recalc:** Create 3 debts with different rates/types. Run batch recalc. Verify interest_accrued and balance_due updated correctly. Verify audit entries logged.
- **Recommendations:** Create debts matching each rule condition. Run recommendations. Verify each rule triggers the correct suggestion.
- **Payment matching:** Import bank transactions with memo containing an invoice number. Run matching. Verify auto-match creates debt_payment. Verify fuzzy match creates pending suggestion.
- **DebtMiniList:** Click a debt → verify detail loads. Switch tab → verify debt stays selected. Search → verify filter works.
- `npx tsc --noEmit` clean after each task.
