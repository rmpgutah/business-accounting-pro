# Prestige Monochrome UI/UX Redesign

**Date:** 2026-09-03  
**Branch:** `claude/ui-ux-pdf-forms-redesign-5b6ff2`  
**Scope:** Full system UI/UX (post-login) + all PDF form templates  
**Strategy:** Approach B — Token + shared component pass

---

## 1. Goals

- Replace the current "Platinum Finance cold-steel" dark theme with a **Prestige Monochrome** aesthetic: deep charcoal/near-black base, platinum/off-white surfaces, single royal-blue accent.
- The login screen is already correct and must not be changed.
- PDF forms remain strictly B&W (laser-safe), but gain refined typographic proportions.
- No business logic changes. No module-level component rewrites. All changes flow through `globals.css` and shared component files.

---

## 2. Color Token Changes (`globals.css` `@theme`)

| Token | Old | New | Notes |
|---|---|---|---|
| `--color-bg-primary` | `#0a0d12` | `#0c0d10` | App base — warmer near-black |
| `--color-bg-secondary` | `#10151d` | `#131519` | Cards, panels |
| `--color-bg-tertiary` | `#182029` | `#1a1c21` | Table headers, inset |
| `--color-bg-elevated` | `#1f2833` | `#202329` | Modals, dropdowns |
| `--color-bg-hover` | `#26313d` | `#272a31` | Row hover wash |
| `--color-border-primary` | `#232c38` | `#252830` | Hairline separators |
| `--color-border-secondary` | `#2f3b49` | `#32363f` | Panel edges |
| `--color-border-focus` | `#4a5a6d` | `#2563eb` | Focus rings — royal blue |
| `--color-text-primary` | `#eef1f6` | `#edeef2` | Body copy |
| `--color-text-secondary` | `#9aa7b8` | `#8a9099` | Labels, metadata |
| `--color-text-muted` | `#667180` | `#555b66` | Placeholders, hints |
| `--color-accent-blue` | `#3b82f6` | `#60a5fa` | Informational blue (lighter to distinguish from primary) |
| `--color-accent-income` | `#4ade80` | `#22c55e` | Income — semantics unchanged |
| `--color-accent-expense` | `#ef4444` | `#ef4444` | Expense — unchanged |
| `--color-accent-warning` | `#f59e0b` | `#f59e0b` | Warning — unchanged |
| `--color-accent-purple` | `#a855f7` | `#a855f7` | Purple — unchanged |

### New token: `--accent-primary`
Add `--accent-primary: #2563eb` (royal blue) to `:root` and `@theme`. This replaces emerald as the brand/primary-action/active-nav color. `--accent-primary-hover: #1d4ed8`. `--accent-primary-bg: rgba(37,99,235,0.10)`.

### Radius
`--app-radius` default: `2px` → `4px`. All `border-radius: 2px` hardcodes in `.block-*` classes updated to `4px`.

### Typography
- Heading `letter-spacing`: add `-0.01em` to `.module-title` and `.stat-value`.
- Table header `letter-spacing`: `0.05em` → `0.04em`.
- `.stat-value`: add `letter-spacing: -0.02em` for prestige mono feel.

---

## 3. Shared Component Class Changes (`globals.css`)

### `.block-card`
- `border-radius: 4px`
- Add `box-shadow: 0 1px 3px rgba(0,0,0,0.4)`

### `.block-card-elevated`
- `border-radius: 4px`

### `.block-btn`
- `padding: 0.5rem 1.25rem` (was `0.5rem 1rem`)
- `border-color`: use `var(--color-border-secondary)` (more visible)
- `border-radius: 4px`

### `.block-btn-primary`
- `background: #2563eb`
- `border-radius: 4px`
- Hover: `background: #1d4ed8; box-shadow: 0 1px 4px rgba(37,99,235,0.35)`

### `.block-btn-success`, `.block-btn-danger`
- `border-radius: 4px`

### `.block-input`, `.block-select`
- `border-radius: 4px`
- Focus: `border-color: #2563eb` (royal blue, matches focus token)

### `.block-table th`
- `color: var(--color-text-secondary)` (was muted — more legible)
- `border-bottom: 1px solid var(--color-border-secondary)` (heavier, more structured)
- `letter-spacing: 0.04em`

### `.block-badge-blue`
- Update to use new `--color-accent-blue` (`#60a5fa`) bg/text

### `.stat-card`
- `border-radius: 4px`
- Add `box-shadow: 0 1px 2px rgba(0,0,0,0.3)`

### `.stat-value`
- Add `letter-spacing: -0.02em`

### `.module-title`
- Add `letter-spacing: -0.01em`

### `.empty-state-icon`
- `border-radius: 4px`

---

## 4. Shell Layout Changes

### `AppShell.tsx` — main content area
- Remove the `linear-gradient(160deg, ...)` inline style on `<main>`.
- Replace with flat `background: var(--color-bg-primary)`.
- No other structural changes.

### `Sidebar.tsx` — navigation panel
- Background: `var(--color-bg-primary)` (same as app base — unified, no seam).
- Section title labels: `font-size: 0.625rem; letter-spacing: 0.08em` (was 0.75rem / 0.05em).
- **Active nav item**: `border-left: 3px solid #2563eb; background: var(--color-bg-secondary); color: var(--color-text-primary)`. Remove emerald active color.
- **Nav item hover**: `background: var(--color-bg-hover)`. No left border on hover.
- Collapsed sidebar icon active state: `color: #2563eb`.

### `TopBar.tsx` — top bar
- Background: `var(--color-bg-secondary)`.
- Add `border-bottom: 1px solid var(--color-border-primary)`.
- Remove any existing gradient or heavy shadow.
- No structural/layout changes.

### `StatusBar.tsx`
- Background: `var(--color-bg-tertiary)`.
- Text: `var(--color-text-muted)`.
- No changes if already matching.

---

## 5. PDF Form Changes (`src/main/services/pdf-generator.ts` — `CLASSIC_CSS`)

All changes are typographic/spacing only. The B&W structural skeleton (solid black borders, black table headers, black grand-total row) is preserved.

| Property | Old | New |
|---|---|---|
| `@page` margin | `0.5in 0.55in` | `0.65in 0.6in` |
| `body font-size` | `12px` | `11px` |
| `body line-height` | `1.4` | `1.45` |
| `.doc-header .co-name font-size` | `17px` | `16px` |
| `.doc-title font-size` | `27px` | `24px` |
| `.doc-title letter-spacing` | `3px` | `4px` |
| `table.ruled th font-size` | `10px` | `9.5px` |
| `table.ruled th letter-spacing` | `0.5px` | `1px` |
| `.totals-tbl td padding` | `6px 12px` | `5px 12px` |
| `.meta-strip font-size` | `11px` | `10px` |
| `.meta-strip .ml font-size` | `10px` | `9px` |
| `.footer-bar font-size` | `10px` | `9.5px` |
| `.footer-bar letter-spacing` | `0.3px` | `0.5px` |
| Interior structural borders | `2px solid #000` (some) | `1.5px solid #000` |

Add `font-variant-numeric: tabular-nums` to all `td.num` and `.totals-tbl td.val` selectors.

Notes/terms section footer separator: change from `border-top: 2px solid #000` to `border-top: 1px solid #ccc`.

---

## 6. Out of Scope

- Login / auth screen (`AuthScreen.tsx`) — explicitly excluded, already correct.
- Business logic in any module.
- IPC handlers, database schema, server code.
- Individual module `.tsx` files (they inherit changes through shared classes).
- Personalization store default accents (`DEFAULT_ACCENTS`) — leave for a follow-up; the token layer handles runtime color without touching that file.

---

## 7. Files Changed

1. `src/renderer/styles/globals.css` — tokens, all `.block-*` classes, shell helpers
2. `src/renderer/components/layout/AppShell.tsx` — remove gradient inline style
3. `src/renderer/components/layout/Sidebar.tsx` — active/hover state colors
4. `src/renderer/components/layout/TopBar.tsx` — background + border-bottom
5. `src/main/services/pdf-generator.ts` — `CLASSIC_CSS` typography/spacing pass

Total: **5 files**.
