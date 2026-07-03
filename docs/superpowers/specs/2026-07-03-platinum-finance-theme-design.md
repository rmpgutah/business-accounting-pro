# Platinum Finance theme — corporate blue/silver/red retheme

**Date:** 2026-07-03
**Status:** Approved, ready for implementation plan

## Problem

The app's current default theme ("Warm Structured Glass" — emerald brand, warm-rose negative, amber warning, neutral dark-gray base) does not read as "standard, corporate, professional" to the user. They want a blue/silver/red, glass-themed, corporate look instead.

## Decision

Adopt **"Platinum Finance"** (one of three mocked-up directions — Corporate Steel and Executive Glass were the alternatives) as the new **app-wide default theme**, replacing Warm Structured Glass as the baseline for every company/user. Individual users can still override via Settings → Customization, same mechanism as today — this only changes the *default*.

## Why this approach

The app already has a token-driven theming architecture purpose-built for exactly this change:
- `personalizationStore.ts` → `DEFAULT_ACCENTS` defines the brand/income/expense/warning/blue/purple accent colors, applied at runtime via `applyPersonalization()` which calls `root.style.setProperty(...)` on `document.documentElement`.
- `globals.css` `@theme` defines the base neutral palette (backgrounds, borders, text) for dark mode, plus static fallback values for the same accent tokens (used before JS personalization runs, and as the source-of-truth default).
- Light mode has its own separate inline palette in `applyPersonalization()`, untouched by this change.

This means the retheme is a **token value change, not a component rewrite** — no `.tsx` files need their color logic touched, only the two files that define the tokens (plus a small unrelated cleanup, see below). This matches the existing project convention (CLAUDE.md: "NEVER hard-code a hex in a `.tsx`").

## New color values

### Accent tokens (`personalizationStore.ts` → `DEFAULT_ACCENTS`)

| Slot | Old (Warm Structured Glass) | New (Platinum Finance) | Role |
|---|---|---|---|
| `primary` | `#10b981` (emerald) | `#3b82f6` (platinum blue) | Brand, primary buttons, active nav, links |
| `income` | `#34d399` | `#4ade80` | Positive amounts, "Paid" badges |
| `expense` | `#fb7185` (warm rose) | `#ef4444` (true red) | Negative amounts, "Overdue" badges |
| `warning` | `#f59e0b` (amber) | unchanged | Pending / due-soon — kept distinct from red so "needs attention" ≠ "overdue" |
| `blue` | `#60a5fa` | unchanged | Informational-only accent (distinct, lighter than primary) |
| `purple` | `#c084fc` | unchanged | Out of scope — not part of the blue/silver/red ask |

### Base neutrals (`globals.css` `@theme`, dark mode only)

Subtle cool tint — same lightness steps as today (no contrast/accessibility regression), shifted from pure neutral gray toward blue-gray ("silver"/"brushed steel" read rather than a visibly different app):

| Token | Old | New |
|---|---|---|
| `--color-bg-primary` | `#0a0a0a` | `#0a0d12` |
| `--color-bg-secondary` | `#141414` | `#10151d` |
| `--color-bg-tertiary` | `#1e1e1e` | `#182029` |
| `--color-bg-elevated` | `#252525` | `#1f2833` |
| `--color-bg-hover` | `#2a2a2a` | `#26313d` |
| `--color-border-primary` | `#2e2e2e` | `#232c38` |
| `--color-border-secondary` | `#3a3a3a` | `#2f3b49` |
| `--color-border-focus` | `#525252` | `#4a5a6d` |
| `--color-text-primary` | `#f0f0f0` | `#eef1f6` |
| `--color-text-secondary` | `#a0a0a0` | `#9aa7b8` |
| `--color-text-muted` | `#6b6b6b` | `#667180` |

Light mode's separate palette (inline in `applyPersonalization()`, lines ~525-539) is unchanged — out of scope for this pass.

### Static accent fallbacks (`globals.css` `@theme`)

The same `@theme` block also declares static `--color-accent-income/expense/blue/warning/purple` values (and `-bg` rgba tints) as the pre-JS/default source of truth. These must be updated to match the new `DEFAULT_ACCENTS` values above, or the app will flash/fall back to the old emerald-rose palette before `applyPersonalization()` runs.

## Secondary scope: leak cleanup

Approved as part of this pass since stray hardcoded colors would visibly undermine the new palette. Seven files flagged by `scripts/ui-leak-check.sh`, all small/contained token substitutions — no logic changes:

- `src/renderer/modules/debt-collection/ComplianceLog.tsx`, `LegalToolkit.tsx` — hardcoded `borderRadius: 0`/`2px` → `var(--app-radius)`
- `src/renderer/modules/copilot/CopilotPanel.tsx` — hardcoded `bg-white`/`text-gray-*`/`border-gray-*` → token classes (`bg-bg-*`/`text-text-*`/`border-border-*`)
- `src/renderer/modules/settings/IndustryPresetSettings.tsx`, `src/renderer/modules/invoices/InvoiceSettings.tsx`, `src/renderer/modules/expenses/ExpenseForm.tsx`, `src/renderer/modules/reports/BudgetVsActualReport.tsx` — hardcoded blue hex (`60a5fa`/`3b82f6`/`2563eb`) → `var(--color-accent-blue)` / token class

## Out of scope

- Light mode palette
- `purple` and `blue` accent slot values
- Any component-level color logic (this is tokens only)
- Per-company/per-user overrides (existing Customization UI is untouched, still works exactly as before — it just starts from a new default)

## Verification plan

1. `npm run typecheck` — must pass clean
2. `bash scripts/ui-leak-check.sh` — counts must drop (0/0/0 for the three categories touched), never increase
3. Visual pass in the browser preview across Dashboard, Invoicing, Debt Collection, and the Copilot panel (the areas already manually audited this session) to confirm the new palette renders correctly and nothing regressed
4. Spot-check light mode still renders (untouched code path, but confirm no accidental breakage)
