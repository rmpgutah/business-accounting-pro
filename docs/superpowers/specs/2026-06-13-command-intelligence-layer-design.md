# Pillar B — Command & Intelligence Layer: Design

**Date:** 2026-06-13
**Status:** Approved (architecture + B1 scope)
**Initiative:** Enterprise-grade upgrade program for Business Accounting Pro. This is **Pillar B** of four (A Financial Integrity Core, B Command & Intelligence, C Automation & Workflow, D Compliance & Reporting). Pillar B chosen first.

## Goal

Turn the app's navigation and intelligence into a flagship experience: instant command/search from anywhere, a configurable intelligence home, and a conversational AI copilot — all on one shared core.

## Architecture: one Core, three Surfaces

A shared **Intelligence Core** (new code under `src/main/services/intelligence/` + IPC) with three components:

1. **Search Index** — fast, typed, ranked search across all major entities (clients, vendors, invoices, bills, expenses, quotes, projects, accounts, employees, debts, purchase_orders, payments). Implemented as a SQLite **FTS5** virtual table, populated from existing rows and kept fresh at the mutation choke point. Replaces today's 3-table palette search and 4-table `search:global`.
2. **Action Registry** — a single catalog of everything the app can do. Each action: `id`, `label`, `keywords`, optional `params` schema, `requiredRole`, and a `handler` (renderer-navigation or main-process mutation). All three surfaces invoke the *same* registry.
3. **Insight Engine** — anomaly detection, cash-flow forecasting, KPI computation. Reuses the existing `IntelligenceService` (`forecastCashFlow`, `detectDuplicateInvoices`, `detectPayrollAnomaly`, `predictPaymentDate`) and the expense-module anomaly work; consolidated behind one interface. Fully local/deterministic.

Three thin surfaces consume the Core:
- **Command Palette** (B1) — search + actions + inline intelligence.
- **Intelligence Cockpit** (B2) — configurable widget home reading insights + index.
- **AI Copilot** (B3) — Claude API with the Core exposed as tools.

**Build order:** B1 → B2 → B3. Each ships independently with its own implementation plan. **This spec details the full architecture + B1 in depth; B2 and B3 are scoped here and planned later.**

## What already exists (B1 is elevation, not greenfield)

- `src/renderer/components/CommandPalette.tsx` — ⌘K overlay, keyboard nav, recent commands, theme-correct. Wired in `App.tsx` (⌘K / ⌘⇧K).
- `src/renderer/components/CommandPaletteCommands.ts` — 45 commands, all **navigation/create shortcuts** (module-level, no params, no permissions, renderer-only).
- `src/renderer/lib/commandParser.ts` — 70-line NL intent parser (`$45 lunch`, `inv 1024`, `pay 100 invoice X`).
- `src/main/services/IntelligenceService.ts` — forecasting + anomaly functions, wired to `intelligence:anomalies | cash-projection | dismiss-anomaly`.
- Entity search today: palette does 3-table raw LIKE; `search:global` does 4-table LIKE (`src/main/ipc/index.ts:4635`).
- Cross-module focus: `appStore.setFocusEntity` / `consumeFocusEntity`; module routing via `appStore.setModule` (`App.tsx` switch).
- Mutation + audit choke point: `db.create/update/remove` + `db.logAudit` invoked from `db:create`/`db:update` handlers (`ipc/index.ts:760+`).

## B1 — Intelligence Core + Command Palette (first shippable)

### B1.1 Search Index
- New FTS5 virtual table `search_index(entity_type, entity_id UNINDEXED, company_id UNINDEXED, title, subtitle, body)`.
- **Backfill**: a builder that scans the indexed tables for the current company and populates rows (idempotent; safe to re-run).
- **Incremental sync**: a single `reindexEntity(table, id)` called from the `db:create`/`db:update`/`db:remove` handlers right after `logAudit` (same choke point), debounced. Delete → remove row. Only the ~12 indexed tables trigger it (guard list).
- New IPC `search:index` (query, limit) → ranked typed results `{ entity_type, entity_id, title, subtitle, score }`, company-scoped, FTS5 `bm25` ranking, <50ms target. `search:global` is rewritten to delegate here (back-compat).
- Migration: `CREATE VIRTUAL TABLE` guarded try/catch in `database/index.ts`; `search_index` added to `tablesWithoutCompanyId` + `tablesWithoutUpdatedAt` (FTS virtual table, no standard columns).

### B1.2 Action Registry
- New `src/shared/action-registry.ts`: typed `AppAction { id, label, keywords, params?, requiredRole?, surface: 'navigate' | 'mutate' }`.
- Navigation actions (the existing 45) migrate in with no behavior change — palette keeps working throughout.
- Mutation actions (new) carry a `params` schema and a main-process handler invoked via a new `action:invoke` IPC channel, which **checks `requiredRole`** against `currentUserId`'s role before executing and calls `scheduleAutoBackup()` after. First mutation actions (small, safe set): `expense.quickAdd`, `invoice.markPaid`, `client.create`. Money-moving actions are **proposal-only** in B1 (navigate to the form pre-filled) — never executed headless.
- `findCommands` is repointed at the registry; `CommandPaletteCommands.ts` becomes a thin re-export during migration, then is removed.

### B1.3 Inline intelligence
- When the query resolves to an entity, the palette shows a contextual hint pulled from the Insight Engine via a new `intelligence:entity-hint(entity_type, id)` channel — e.g. client → "2 overdue invoices ($3.6k)"; vendor → "anomalous charge flagged". Cached per entity for the palette session.

### B1.4 Palette UI changes
- Search section now spans all indexed types (grouped headers by type), powered by `search:index`.
- A "Quick Actions" group surfaces parameterized registry actions matched by the NL parser (extend `commandParser` to emit registry action ids + params).
- Keep existing keyboard model, recent-commands, theme tokens, `block-card-elevated` overlay.

### B1 verification
No renderer test suite. Per task: `npm run build` clean; `bash scripts/ui-leak-check.sh` not rising; manual: ⌘K searches across new entity types, executes a nav action, executes one mutation action (with a role check), shows an inline hint; index stays correct after creating/editing/deleting a record.

## B2 — Intelligence Cockpit (scoped; planned later)
Configurable widget home. New `dashboard_layouts` table (per user/company, JSON layout). Widget types: cash runway, forecast curve, anomaly feed, KPI tile, aging, top-entities — each reads the Insight Engine + index and is drillable via `setModule`/`setFocusEntity`. Drag/resize/save grid. New module `cockpit` added to `App.tsx` + `Sidebar.tsx`.

## B3 — AI Copilot (scoped; planned later)
Docked panel. Renderer → `copilot:ask` (main process) → **Claude API with tool-use**, exposing the Core as read tools (`search_records`, `get_pnl`, `list_anomalies`, `forecast_cash`, scoped ledger queries) and registry actions as **proposal** tools. Claude reasons, calls tools, answers with drill-downs. **Safety (hard rule): human-in-the-loop — the Copilot may draft/propose any action but never executes a data mutation or money movement without an explicit user confirm.** API key stored in main process (never renderer); only minimal tool-return data leaves the machine. New `copilot_threads` table for history. **At B3 plan time, consult the `claude-api` skill** for model id, tool-use shape, streaming, and pricing.

## Cross-cutting
- **Theme:** existing Warm Structured Glass tokens only — no new visual language. No raw hex, `var(--app-radius)`, `.block-*` classes.
- **New tables:** `search_index` (FTS5), `dashboard_layouts` (B2), `copilot_threads` (B3). Each via guarded migration in `database/index.ts` with correct `tablesWithoutCompanyId` / `tablesWithoutUpdatedAt` listing.
- **Permissions:** mutation actions check the existing role model (owner/admin/accountant/viewer) in the main process — never trust the renderer.
- **Performance:** index sync debounced off the write path; palette search <50ms; backfill runs once and is resumable.
- **New IPC mutation handlers** call `scheduleAutoBackup()`.

## Non-goals (this pillar)
- Pillars A/C/D. Multi-currency, double-entry enforcement, RBAC beyond the existing 4 roles, XBRL — all out of scope here.
- B1 does not let the Copilot or palette move money headlessly.
