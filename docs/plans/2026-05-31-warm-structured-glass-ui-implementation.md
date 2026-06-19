# Warm Structured Glass — UI Upgrade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Apply a cohesive "Warm Structured Glass" visual upgrade to every post-login screen of Business Accounting Pro — warm-graphite base, emerald/amber/rose accents, a real structured-border system with table grid lines, denser layout, bolder data typography, and consistent motion — without breaking the runtime personalization engine. The login/AuthScreen is left exactly as-is.

**Architecture:** Foundation-first. (1) Retarget design tokens in `globals.css` `@theme` + `:root` and in `personalizationStore.ts` (`DEFAULT_ACCENTS`, `applyPersonalization`). (2) Overhaul the shared utility layer (`block-*` + V1–V150) so changes propagate to all modules at once. (3) Upgrade the existing shell (AppShell/Sidebar/TopBar/StatusBar) and the existing library primitives (`PageHeader`, `Toolbar`, `DataTableLite`, `StatCard`/`KpiCard`) in place. (4) Sweep all 40 module directories in 5 batches, each applying the same adoption checklist, verified by dev-preview screenshots.

**Tech Stack:** Electron 41, React 19, TypeScript, Vite, Tailwind CSS v4 (`@theme`), Zustand, lucide-react, recharts.

---

## Conventions & verification protocol (read once, applies to every task)

**This is a visual upgrade — pixels can't be unit-tested, so "the test" is a layered gate:**

1. **Type/build gate (hard, automated):** `npm run build` must succeed (runs Vite + `tsc`). Never commit a task that breaks the build.
2. **Leak guard (automated):** a grep that must not increase. Baseline is captured in Task 0.2. Command:
   ```bash
   bash scripts/ui-leak-check.sh
   ```
3. **Visual gate (preview screenshot):** start the dev preview once, then after a change reload and screenshot the affected screen. Use the `preview_*` tools (preview_start → preview_eval `window.location.reload()` → preview_screenshot / preview_snapshot / preview_console_logs). Confirm: no console errors, no light-mode color leaks on dark surfaces, grid lines render in tables.

**Token rule (non-negotiable):** never hard-code a color in a component. Reference CSS vars (`var(--color-...)`, `var(--accent-primary)`, `var(--structure)`, etc.) or `block-*`/utility classes. This is what keeps the Customization Center working.

**Commit rule:** one commit per task, present tense, end every message with:
```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

**Scope guard:** do not touch `src/renderer/components/auth/**` (login left as-is). Do not change IPC, SQL, or data flow — visual only.

---

## Phase 0 — Setup & baseline

### Task 0.1: Confirm dev preview runs

**Step 1:** Rebuild the native module (per CLAUDE.md, required after any dist):
```bash
npm rebuild better-sqlite3
```
**Step 2:** Start the dev preview (Vite renderer + Electron):
```bash
npm run dev
```
Use `preview_start` if the preview harness manages the server. Expected: app boots to login, then dashboard after auth.
**Step 3:** Screenshot the Dashboard and one table-heavy module (Invoicing) as the **before** baseline (`preview_screenshot`). Save mentally/region for later comparison.
**Step 4:** No commit (read-only).

### Task 0.2: Add the leak-guard script

**Files:**
- Create: `scripts/ui-leak-check.sh`

**Step 1:** Write the script:
```bash
#!/usr/bin/env bash
# Fails if banned visual patterns appear in renderer source (excludes auth + library reference).
set -euo pipefail
ROOT="src/renderer"
EXCLUDE="--exclude-dir=auth"
banned=0
echo "== borderRadius: 0 / '0px' =="
grep -rn $EXCLUDE "borderRadius: *'\?0" "$ROOT/modules" "$ROOT/components/layout" || true
echo "== bg-white / text-gray-* / border-gray-* =="
grep -rn $EXCLUDE "bg-white\|text-gray-\|border-gray-" "$ROOT/modules" "$ROOT/components/layout" || true
echo "== hard-coded blue hex (60a5fa/3b82f6/2563eb) =="
grep -rn $EXCLUDE "60a5fa\|3b82f6\|2563eb" "$ROOT/modules" || true
echo "(informational counts — compare against baseline in the plan)"
```
**Step 2:** Make it executable and capture the baseline counts:
```bash
chmod +x scripts/ui-leak-check.sh
bash scripts/ui-leak-check.sh | tee docs/plans/.ui-leak-baseline.txt
```
Expected baseline (from planning): ~7 borderRadius:0 files, ~2 bg-white/gray files, ~84 blue-hex files. **These must only ever go DOWN.**
**Step 3:** Commit:
```bash
git add scripts/ui-leak-check.sh docs/plans/.ui-leak-baseline.txt
git commit -m "chore: add UI leak-guard script + baseline"
```

---

## Phase 1 — Tokens & palette (the foundation everything inherits)

### Task 1.1: Warm the base ramp + add structured-border tokens in globals.css

**Files:**
- Modify: `src/renderer/styles/globals.css:3-56` (the `@theme` block + `:root`)

**Step 1:** In the `@theme` block, replace the dark base + text + border values with the warm-graphite set:
```css
  /* Warm graphite base */
  --color-bg-primary: #0f1012;
  --color-bg-secondary: rgba(22, 23, 26, 0.80);
  --color-bg-tertiary: rgba(30, 31, 36, 0.65);
  --color-bg-elevated: rgba(29, 30, 34, 0.85);
  --color-bg-hover: rgba(36, 37, 42, 0.60);

  --color-bg-primary-solid: #0f1012;
  --color-bg-secondary-solid: #16171a;
  --color-bg-tertiary-solid: #1d1e22;
  --color-bg-elevated-solid: #1d1e22;

  /* Structured border system */
  --color-border-primary: rgba(255, 255, 255, 0.06);
  --color-border-secondary: rgba(255, 255, 255, 0.11);
  --color-border-focus: rgba(255, 255, 255, 0.18);
  --color-glass-border: rgba(255, 255, 255, 0.08);
  --color-glass-border-hover: rgba(255, 255, 255, 0.14);
  --color-glass-shine: rgba(255, 255, 255, 0.04);

  /* Warm off-white text */
  --color-text-primary: #ECEAE4;
  --color-text-secondary: #A8A39A;
  --color-text-muted: #6B665D;

  /* Accent semantics — emerald primary, amber highlight, warm rose negative */
  --color-accent-income: #34d399;
  --color-accent-income-bg: rgba(52, 211, 153, 0.12);
  --color-accent-expense: #fb7185;
  --color-accent-expense-bg: rgba(251, 113, 133, 0.12);
  --color-accent-blue: #60a5fa;            /* informational only now */
  --color-accent-blue-bg: rgba(96, 165, 250, 0.12);
  --color-accent-warning: #f59e0b;
  --color-accent-warning-bg: rgba(245, 158, 11, 0.12);
  --color-accent-purple: #c084fc;
  --color-accent-purple-bg: rgba(192, 132, 252, 0.12);
```
**Step 2:** In the `:root` personalization-defaults block (around line 49), add the three structured-border aliases + brand var so utilities can reference them:
```css
  --accent-primary: #10b981;          /* emerald brand */
  --hairline: rgba(255, 255, 255, 0.06);
  --structure: rgba(255, 255, 255, 0.11);
  --grid: rgba(255, 255, 255, 0.05);
```
**Step 3:** Build gate: `npm run build` → PASS.
**Step 4:** Visual gate: reload preview, screenshot Dashboard. Expected: background reads warm/graphite, text warm off-white, expense figures rose. (Buttons/nav still blue until Task 1.2/Phase 2 — that's fine.)
**Step 5:** Commit: `git commit -am "feat(ui): warm-graphite base + structured-border tokens"`

### Task 1.2: Retarget brand accents to emerald/amber/rose in the store

**Files:**
- Modify: `src/renderer/stores/personalizationStore.ts:48-55` (`DEFAULT_ACCENTS`)
- Modify: `src/renderer/stores/personalizationStore.ts:507-519` (light-mode branch in `applyPersonalization`)

**Step 1:** Update `DEFAULT_ACCENTS`:
```ts
export const DEFAULT_ACCENTS: AccentSlots = {
  primary: '#10b981',   // emerald brand (was #60a5fa)
  income:  '#34d399',
  expense: '#fb7185',   // warm rose (was #f87171)
  warning: '#f59e0b',   // amber (was #fbbf24)
  blue:    '#60a5fa',   // informational only
  purple:  '#c084fc',
};
```
**Step 2:** Add the new structured-border vars to BOTH branches of `applyPersonalization` so light mode gets warm-appropriate values and dark falls back to `@theme`. In the `if (!isDark)` branch add:
```ts
    root.style.setProperty('--hairline', 'rgba(0,0,0,0.06)');
    root.style.setProperty('--structure', 'rgba(0,0,0,0.12)');
    root.style.setProperty('--grid', 'rgba(0,0,0,0.05)');
```
and in the `else` (dark) branch add:
```ts
    root.style.removeProperty('--hairline');
    root.style.removeProperty('--structure');
    root.style.removeProperty('--grid');
```
**Step 3:** Note for existing users: persisted Zustand state may still hold the old blue `primary`. Add a one-time migration — in the store's `persist` config, bump `version` and add a `migrate` that resets `accents` to `DEFAULT_ACCENTS` if `accents.primary === '#60a5fa'`. (Read the existing `persist({...})` options first; follow its style.)
**Step 4:** Build gate: `npm run build` → PASS.
**Step 5:** Visual gate: reload, confirm focus rings / `--accent-primary` consumers shift toward emerald.
**Step 6:** Commit: `git commit -am "feat(ui): retarget brand accents to emerald/amber/rose"`

---

## Phase 2 — Utility-layer overhaul (propagates to all modules)

> Work inside `src/renderer/styles/globals.css`. After each task: `npm run build`, reload preview, screenshot the Component Library module (it renders these utilities densely), commit.

### Task 2.1: Buttons → token-driven emerald primary

**Step 1:** Replace the hard-coded blue gradients in `.block-btn-primary` (≈line 157) and the active/focus states so they use `var(--accent-primary)`:
```css
.block-btn-primary {
  background: linear-gradient(135deg, var(--accent-primary), color-mix(in srgb, var(--accent-primary) 80%, black));
  border: 1px solid color-mix(in srgb, var(--accent-primary) 45%, transparent);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--accent-primary) 25%, transparent);
  /* keep existing padding/weight/radius */
}
```
Apply the same `color-mix` pattern to `.block-btn-success` (income green) and confirm `.block-btn-danger` uses `--color-accent-expense`.
**Step 2:** Replace the `.block-input:focus` / `.block-select:focus` blue ring (≈line 233) with `var(--accent-primary)`-derived ring.
**Step 3:** Build + screenshot + commit `feat(ui): token-driven emerald button & focus system`.

### Task 2.2: Tables → structured frame + grid lines + density

**Step 1:** Rewrite `.block-table` (≈line 257) so the table reads as *structured*:
```css
.block-table { width:100%; text-align:left; font-size:0.875rem; border-collapse:separate; border-spacing:0;
  border:1px solid var(--structure); border-radius: var(--app-radius); overflow:hidden; }
.block-table th { padding: var(--row-padding-y) var(--row-padding-x);
  background: var(--color-bg-tertiary); border-bottom:1px solid var(--structure);
  color:var(--color-text-secondary); font-weight:600; text-transform:uppercase;
  font-size:0.6875rem; letter-spacing:0.04em; position:sticky; top:0; z-index:1; }
.block-table td { padding: var(--row-padding-y) var(--row-padding-x);
  border-bottom:1px solid var(--grid); border-right:1px solid var(--grid);
  font-variant-numeric: tabular-nums; }
.block-table td:last-child, .block-table th:last-child { border-right:0; }
.block-table tr:last-child td { border-bottom:0; }
.block-table tr:hover td { background: var(--color-bg-hover); }
```
**Step 2:** Build + screenshot the Invoicing table + commit `feat(ui): structured table frame with grid lines`.

### Task 2.3: Cards, stat-cards, KPI tiles → warm structure + bold data

**Step 1:** Update `.block-card`, `.block-card-elevated`, `.stat-card`, `.kpi-tile` borders to `var(--structure)` for outer edges (keep `--glass-border` for subtle inner). Bump `.stat-value`/`.kpi-value` weight to 700 and ensure `font-variant-numeric: tabular-nums`.
**Step 2:** Update `.module-title` gradient (≈line 369) to warm off-white range (`#ECEAE4` → `#A8A39A`).
**Step 3:** Build + screenshot Dashboard KPIs + commit `feat(ui): bold tabular stat/KPI typography + structured cards`.

### Task 2.4: Badges, tabs, motion baseline

**Step 1:** Confirm `.block-badge-*`, `.badge.is-*`, `.tab-btn[aria-selected]` reference accent vars (emerald active tab, not blue).
**Step 2:** Ensure interactive utilities use the existing motion tokens (`--motion-base var(--ease-out-quart)`); add a global `@media (prefers-reduced-motion: reduce)` block that zeroes animations/transitions.
**Step 3:** Build + screenshot Component Library + commit `feat(ui): emerald tab/badge accents + reduced-motion safety`.

---

## Phase 3 — Shell

### Task 3.1: Sidebar — emerald active rail, token-driven, no inline leaks

**Files:**
- Modify: `src/renderer/components/layout/Sidebar.tsx`

**Step 1:** Read the file first. Replace the active-item inline style (lines ≈195-199, the blue gradient + blue inset shadow + `borderRadius:'0px'`) with an emerald left-rail treatment driven by tokens:
```tsx
style={isActive ? {
  background: 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent-primary) 10%, transparent))',
  boxShadow: 'inset 2px 0 0 var(--accent-primary)',
} : undefined}
```
Change the active text/border classes from `text-accent-blue`/`border-accent-blue` to an emerald token class (add a `--accent-primary`-driven class or use inline `color: var(--accent-primary)`). Remove the remaining `borderRadius:'0px'` inline styles (let the surface be flat via class).
**Step 2:** Set the `aside` border to `var(--structure)` for a crisp right edge; keep warm-graphite glass background via tokens (`var(--color-bg-secondary)`), not the hard-coded `rgba(14,15,20,...)`.
**Step 3:** Build gate, leak guard (borderRadius:0 count must drop), screenshot sidebar (active + collapsed), commit `feat(ui): emerald structured sidebar, token-driven`.

### Task 3.2: TopBar — structured toolbar

**Files:** Modify `src/renderer/components/layout/TopBar.tsx` (read first).
**Step 1:** Give it a defined bottom edge (`border-bottom:1px solid var(--structure)`), `--structure` dividers between control groups, warm-graphite glass bg via tokens. Ensure search/quick-create/command-palette triggers use `block-btn-ghost`/`block-btn-icon`.
**Step 2:** Build + screenshot + commit `feat(ui): structured top toolbar`.

### Task 3.3: StatusBar + AppShell canvas

**Files:** Modify `src/renderer/components/layout/StatusBar.tsx`, `src/renderer/components/layout/AppShell.tsx:34`.
**Step 1:** StatusBar: slim, `font-mono`, `tabular-nums`, top edge `var(--structure)`, muted-warm text.
**Step 2:** AppShell: warm the content gradient: `linear-gradient(160deg,#0f1012 0%,#121319 45%,#141520 100%)`.
**Step 3:** Build + screenshot full shell + commit `feat(ui): warm canvas + structured status bar`.

---

## Phase 4 — Upgrade & consolidate shared primitives

> These already exist in `src/renderer/components/library/`. **Read each file before editing**; preserve prop signatures and the barrel exports in `index.ts` (modules import from `../../components/library`). Goal: make them the canonical structured-glass building blocks.

### Task 4.1: PageHeader + SectionHeader + Toolbar (headers.tsx)

**Step 1:** Read `headers.tsx`. Ensure `PageHeader` renders: title (bold, warm, `module-title` gradient), optional breadcrumb slot, right-aligned action cluster, optional tab row, bottom `var(--structure)` edge. `Toolbar`/`FilterToolbar` get `--structure` dividers between groups. No hard-coded colors.
**Step 2:** Build + render in Component Library + commit `feat(ui): structured PageHeader/Toolbar primitives`.

### Task 4.2: DataTable (tables.tsx — `DataTableLite`, `LedgerRow`, `ComparisonTable`)

**Step 1:** Read `tables.tsx`. Make `DataTableLite` the structured centerpiece: outer `var(--structure)` frame, `var(--grid)` row/col lines, sticky tabular-num header, hover wash, sort-indicator slot, and a `loading` prop that renders `SkeletonTable` (from `loading.tsx`). Keep the existing prop names; add only optional props.
**Step 2:** Build + screenshot in Component Library + commit `feat(ui): structured DataTable centerpiece`.

### Task 4.3: Stat/KPI primitives (stat-cards.tsx) + SectionCard (cards.tsx)

**Step 1:** Read both. `StatCard`/`KpiCard`/`MetricTile`: bold tabular value, emerald-up / rose-down `DeltaBadge`, optional sparkline slot. Confirm `cards.tsx` `PanelCard`/`GlassCard` use `var(--structure)` outer borders (this is the de-facto `SectionCard`). No new colliding component — reuse `PanelCard` as the standard section panel.
**Step 2:** Build + screenshot + commit `feat(ui): bold KPI/stat primitives + structured panels`.

### Task 4.4: Component Library reference page

**Files:** Modify `src/renderer/modules/component-library/ComponentLibrary.tsx` (read first).
**Step 1:** Ensure it showcases the upgraded primitives in one scroll (it's the living reference we verify against). Add any missing showcases for `PageHeader`, `DataTableLite`, KPI tiles.
**Step 2:** Build + screenshot the whole library page + commit `docs(ui): refresh component library reference`.

---

## Phase 5 — Per-module adoption sweep (the "every module, evenly" pass)

**Repeatable checklist — apply to each module's top-level files in `src/renderer/modules/<id>/`:**

1. Replace ad-hoc page headers with `<PageHeader>`; ad-hoc filter/search rows with `<Toolbar>`/`<FilterToolbar>`.
2. Replace hand-built `<table>`/`.block-table` markup with `<DataTableLite>` where it fits (keep custom tables that have special interactions, but apply the structured `.block-table` class so grid lines render).
3. **Strip leaks:** remove `borderRadius:'0px'`/`borderRadius:0` inline styles; replace `bg-white`/`text-gray-*`/`border-gray-*` with `bg-bg-*`/`text-text-*`/`border-border-*`; replace hard-coded blue hex (`#60a5fa`/`#3b82f6`/`#2563eb`) with `var(--accent-primary)` (actions/active) or `var(--color-accent-blue)` (informational) or recharts series via shared chart palette.
4. Apply bold-data typography (`tabular-nums` on money, `stat-value`/`kpi-value` for headline figures) and current density tokens.
5. Charts (recharts): swap series colors to the warm token palette and enable the entrance animation (`isAnimationActive`).

**Per-batch task structure (one commit per batch, screenshot every module in the batch):**

### Task 5.1: Batch 1 — Money/list-heavy
Modules: `dashboard`, `invoices`, `expenses`, `bills`, `quotes`, `clients`.
- Apply checklist to each. After the batch: `npm run build` → PASS; `bash scripts/ui-leak-check.sh` (counts must drop vs baseline); screenshot each of the 6 modules; verify no console errors.
- Commit: `feat(ui): warm structured glass — batch 1 (money/list modules)`

### Task 5.2: Batch 2 — Finance/ledger
Modules: `accounts`, `loans`, `purchase-orders`, `bank-recon`, `stripe`, `budgets`, `taxes`, `debt-collection`.
- Same checklist + verification. Commit: `feat(ui): warm structured glass — batch 2 (finance/ledger)`

### Task 5.3: Batch 3 — Operations
Modules: `payroll`, `time`, `projects`, `inventory`, `fixed-assets`.
- Same checklist + verification. Commit: `feat(ui): warm structured glass — batch 3 (operations)`

### Task 5.4: Batch 4 — Analytics
Modules: `reports`, `kpi`, `forecasting`, `custom-reports`.
- Heavy chart focus — apply warm chart palette + animated reveals. Same verification. Commit: `feat(ui): warm structured glass — batch 4 (analytics)`

### Task 5.5: Batch 5 — Platform/System
Modules: `esign`, `documents`, `recurring`, `email`, `notifications`, `audit`, `rules`, `automations`, `multi-company`, `api`, `portal`, `mobile`, `settings`, `customization`. (`component-library` already done in 4.4.)
- Same checklist + verification. Pay attention to `settings`/`customization` so the personalization controls still preview correctly. Commit: `feat(ui): warm structured glass — batch 5 (platform/system)`

---

## Phase 6 — Final verification & sign-off

### Task 6.1: Full sweep verification

**Step 1:** `npm run build` → PASS.
**Step 2:** `bash scripts/ui-leak-check.sh` — confirm blue-hex / borderRadius:0 / bg-white counts are at or near zero and strictly below the Task 0.2 baseline. Document remaining intentional exceptions.
**Step 3:** With the preview running, screenshot every module once more (use the sidebar to navigate). Scan each for: light-mode color leaks, missing grid lines, console errors.
**Step 4:** Smoke-test the personalization engine still works: open Customization/Settings, change density + radius + an accent + toggle light mode, confirm the whole app responds (tokens still wired).
**Step 5:** Confirm login (AuthScreen) is visually unchanged.

### Task 6.2: Close out

**Step 1:** Update CLAUDE.md's UI gotchas to reflect the warm palette + structured-border tokens + emerald brand (so future work stays consistent).
**Step 2:** Final commit: `git commit -am "docs: note warm-structured-glass tokens in CLAUDE.md"`.
**Step 3:** Report the before/after screenshot set.

---

## Notes for the executor
- **Read before you edit.** Every component/store file referenced here should be read first — line numbers are approximate and the codebase is large.
- **Token discipline is the whole game.** If you're typing a hex color into a `.tsx`, stop and use a var. The only place raw hex belongs is `globals.css` `@theme` and `personalizationStore.ts`.
- **Don't regress personalization.** After any token change, the dark branch of `applyPersonalization` must still *fall back* to `@theme` (it removes overrides), and light mode must set explicit values.
- **Screenshots are the deliverable proof.** Per the design's Section 5, the user wants to see results, not promises.
- Relevant skills: @superpowers:test-driven-development (adapted: build+leak+screenshot gate), @superpowers:verification-before-completion.
