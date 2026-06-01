# Warm Structured Glass — Full UI Visual Upgrade

**Date:** 2026-05-31
**Scope:** All post-login screens (the login/AuthScreen is explicitly left as-is).
**Goal:** A large, cohesive visual upgrade across all 40+ modules — keep the frosted-glass depth but make it crisp, dense, deliberate, and warm.

## Decisions (from brainstorming)

- **Direction:** Hybrid *structured glass* — frosted depth, but crisper borders, grid lines, tighter density, bolder data.
- **Scope:** Every module, evenly — built on a shared foundation first so modules don't drift.
- **Execution path:** Foundation (tokens + utilities + shell) → new structured primitives → per-module adoption sweep (option "A then B").
- **Signature moves (all four):** crisp structure + grid lines · denser data-rich layout · bolder data/typography · motion & micro-interactions.
- **Palette:** Warmer & professional — warm-graphite/charcoal base, emerald primary, amber highlight, warm rose for negatives.
- **Hard constraint:** Stay **token-driven** — the personalization engine (Customization Center, per-module accents, density, radius, glass-intensity) must keep working. We replace values/structure, not the engine.

## Section 1 — Design language & palette

### Base ramp (warm graphite, replacing cool near-black)

| Token | Now | Proposed | Use |
|---|---|---|---|
| canvas | `#08090c` | `#0f1012` | app background |
| panel | `rgba(18,19,24,.8)` | `#16171a` glass | cards, sidebar |
| elevated | `#20222c` | `#1d1e22` glass | modals, drawers, menus |
| hover | — | `#24252a` | row/control hover |

### Accent semantics
- **Emerald `#10b981`** — primary actions, active nav, focus rings, income/positive.
- **Amber `#f59e0b`** — highlights, pending, warnings, brand spark.
- **Warm rose `#fb7185`** — expenses/negative (warmer than current `#f87171`).
- **Blue** — demoted to informational only (links, info badges).

### Text (warm off-white)
- primary `#ECEAE4` · secondary `#A8A39A` · muted `#6B665D`.

### Structured border system (replaces single hairline)
- `--hairline` `rgba(255,255,255,.06)` — subtle separators
- `--structure` `rgba(255,255,255,.11)` — panel edges, toolbar bottoms, table outer frame
- `--grid` `rgba(255,255,255,.05)` — **visible row/column grid lines inside tables** (signature move)

### Typography
- Bolder hierarchy, heavier section headers, larger KPI values.
- Tabular numerals everywhere money appears. Keep Inter + JetBrains Mono.

## Section 2 — The shell

- **Sidebar** ([src/renderer/components/layout/Sidebar.tsx](../../src/renderer/components/layout/Sidebar.tsx)): warm-graphite glass, crisp `--structure` right edge; active item = emerald left rail + soft emerald wash (replaces blue); tighter muted-warm section labels; remove hard-coded `borderRadius:0`/blue inline styles → tokens; collapsed mode centered icons + hover tooltips.
- **TopBar**: structured toolbar — company switcher + global search + quick-create + command palette trigger, separated by `--structure` dividers, defined bottom edge (content scrolls under it).
- **StatusBar**: slim mono tabular strip — sync status, active company, last-backup, keyboard hint.
- **Content canvas**: keep soft top-down gradient, warmed; panels float on a graphite field.

## Section 3 — Shared primitives & utility overhaul

**(a) Rewrite the existing layer** in [src/renderer/styles/globals.css](../../src/renderer/styles/globals.css) so the ~150 utilities + `block-*` classes carry new tokens, borders, density, motion. Most modules render through these, so the bulk of the change propagates instantly.

**(b) Add missing structured primitives** in `components/library/`:
- `PageHeader` — title + breadcrumb + action cluster + optional tabs (replaces divergent per-module `module-header`).
- `Toolbar` — search / filters / view-switch / actions, with `--structure` dividers.
- `DataTable` — centerpiece: outer `--structure` frame, visible `--grid` lines, sticky tabular-num header, dense rows, hover wash, sort affordances, skeleton loading.
- `StatCluster` / upgraded `KpiTile` — bold tabular value, emerald/rose delta, sparkline slot.
- `SectionCard` — standard structured-glass panel with defined header.

**Motion baseline:** unify on existing easing/motion tokens — hover/press feedback, modal/drawer entrances, skeleton shimmer, animated chart reveals — applied via the shared layer.

## Section 4 — Per-module sweep (even coverage)

Each module gets the same checklist pass:
1. Ad-hoc headers → `PageHeader`; toolbars → `Toolbar`.
2. Hand-built tables → `DataTable` (grid lines + tabular nums).
3. Strip inline-style leaks (`borderRadius:0`, `bg-white`, `text-gray-*`, hard-coded blues) → tokens/utilities.
4. Apply density + bold-data typography; emerald/amber/rose semantics.
5. Charts → warm palette + animated reveal.

Batches grouped by similarity:
- **Batch 1 — Money/list-heavy:** Dashboard, Invoicing, Expenses, Bills, Quotes, Clients.
- **Batch 2 — Finance/ledger:** Accounts/GL, Loans, Purchase Orders, Bank Recon, Stripe, Budgets, Taxes, Debt Collection.
- **Batch 3 — Ops:** Employee/Payroll, Time, Projects, Inventory, Fixed Assets.
- **Batch 4 — Analytics:** Reports, KPI, Forecasting, Report Builder.
- **Batch 5 — Platform/System:** E-Sign, Documents, Recurring, Email, Notifications, Audit, Rules, Automations, Companies, API, Portal, Mobile, Settings, Component Library, Customization.

## Section 5 — Verification

- Run the Vite/Electron dev preview; screenshot the shell first, then each batch/module.
- Check console for errors, scan dark surfaces for color leaks, verify table grid-line treatment.
- The Component Library module is the living reference for the primitives.

## Out of scope
- Login / AuthScreen (left exactly as-is).
- Functional/behavioral changes — this is a visual upgrade; data flow and IPC unchanged.
- Removing or rearchitecting the personalization engine.
