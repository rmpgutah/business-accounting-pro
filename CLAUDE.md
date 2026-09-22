# Business Accounting Pro

Electron 41 + React 19 + TypeScript + SQLite (better-sqlite3) desktop accounting app.

## Commands

```bash
npm run dev              # Vite dev server + Electron (requires npm rebuild better-sqlite3 first after dist)
npm run build            # Build renderer (Vite) + main (tsc)
npm run dist:mac         # Package macOS DMGs (arm64 + x64)
npm run dist:win         # Package Windows installer
bash scripts/codesign-mac.sh "release/mac-arm64/Business Accounting Pro.app"  # Ad-hoc codesign
```

## Architecture

- `src/renderer/` — React frontend (Vite-compiled, lazy-loaded modules)
- `src/main/` — Electron main process (IPC handlers, SQLite, services)
- `src/main/database/schema.sql` — All table definitions (~1200 lines, 40+ tables)
- `src/main/ipc/index.ts` — All IPC handlers (~2900 lines, 110+ handlers)
- `src/renderer/lib/api.ts` — Frontend API wrapper (maps to IPC channels)
- `src/shared/types.ts` — Shared TypeScript types
- `landing-page/` — Static site at accounting.rmpgutah.us

## Key Patterns

- **Module routing**: `App.tsx` switch statement on `currentModule`, NOT React Router
- **Data flow**: Renderer → `window.electronAPI.invoke(channel)` → `ipcMain.handle` → `db.getDb().prepare(sql)`
- **Styling**: Tailwind CSS + custom glass theme in `globals.css` (`.block-card`, `.block-btn`, `.block-input`, `.block-table`)
- **State**: Zustand stores (appStore, companyStore, authStore) — authStore persists user but NOT isAuthenticated
- **Company scoping**: All queries filtered by `company_id` via `db.getCurrentCompanyId()`

## Gotchas

- **tablesWithoutCompanyId** in `ipc/index.ts`: child/junction tables MUST be listed here or db:create injects a nonexistent company_id column → crash
- **tablesWithoutUpdatedAt** in `database/index.ts`: tables without updated_at MUST be listed or update() appends invalid SQL → crash
- **better-sqlite3 arch mismatch**: After `dist:mac` (builds x64+arm64), run `npm rebuild better-sqlite3` before `npm run dev`
- **Auth store persistence**: Only `user` is persisted (for Remember Me), NOT `isAuthenticated` — forces login on every app launch
- **Default auth mode**: useState defaults to `'register'` — useEffect switches to `'login'` only if users confirmed in DB
- **App Translocation**: macOS Gatekeeper moves apps to temp paths; `xattr -cr` after install prevents this
- **Light-mode color leaks**: Never use `bg-white`, `text-gray-*`, `border-gray-*` — use `bg-bg-*`, `text-text-*`, `border-border-*`
- **borderRadius**: Use `var(--app-radius)` (theme radius, defaults 6px), never `0`/`2px` (old blocky theme)
- **Design language = "Warm Structured Glass"**: warm-graphite base, emerald brand, amber highlight, warm-rose negative. Defined in `globals.css` `@theme` + `:root`, retargeted at runtime by `applyPersonalization()`. NEVER hard-code a hex in a `.tsx` — the only places raw hex belongs are `globals.css @theme` and `personalizationStore.ts` (`DEFAULT_ACCENTS`).
- **Accent tokens**: brand/primary actions/active nav = `var(--accent-primary)` (emerald); income = `var(--color-accent-income)`; expense/negative = `var(--color-accent-expense)` (warm rose); warning = `var(--color-accent-warning)` (amber); informational only = `var(--color-accent-blue)`. There is NO `--color-accent-green`/`--color-accent-red` — use income/expense.
- **Structured borders**: `--hairline` (subtle separators), `--structure` (panel edges, toolbar/table outer frame), `--grid` (table row/column lines). The `.block-table` class already supplies the structured frame + grid lines + sticky header + hover wash — don't re-style table borders inline.
- **Leak guard**: `bash scripts/ui-leak-check.sh` reports hard-coded hex / blocky-radius / white-leak counts; keep them from rising.

## Data Patterns

- **`db:query` returns flat rows** — no JOINs. For vendor_name, category_name etc., use `api.rawQuery()` with explicit JOINs
- **Table name: `categories` NOT `expense_categories`** — SQL referencing `expense_categories` will crash silently in Promise.all
- **List refresh after save**: Parent module must increment a `listKey` state and pass as `key` to list component (pattern: `setListKey(k => k + 1)`)
- **New IPC handlers need `scheduleAutoBackup()`** after any data mutation or backup won't trigger
- **Filing status mapping**: DB stores `married_jointly`, UI uses `married_filing_jointly` — IPC handlers must map between them
- **New columns need migration in `database/index.ts`** (try/catch ALTER TABLE) AND listing in `tablesWithoutUpdatedAt` if no `updated_at` column
- **New modules must be added to BOTH `App.tsx` (MODULE_NAMES + switch case) AND `Sidebar.tsx`** — missing either causes invisible or unroutable modules

## Deploy

```bash
# Push to GitHub
npm run deploy

# Mac app install (always delete first — cp -R onto existing .app won't replace it)
npm run build && npx electron-builder --mac --arm64
bash scripts/codesign-mac.sh "release/mac-arm64/Business Accounting Pro.app"
rm -rf "/Applications/Business Accounting Pro.app"
cp -R "release/mac-arm64/Business Accounting Pro.app" "/Applications/Business Accounting Pro.app"
xattr -cr "/Applications/Business Accounting Pro.app"
npm rebuild better-sqlite3
```

## Deploy Gotchas

- **Always build + install locally after code changes**: `npm run build && npx electron-builder --mac --arm64 && bash scripts/codesign-mac.sh ... && rm -rf /Applications/... && cp -R ... && xattr -cr ... && npm rebuild better-sqlite3`
- **GitHub Actions Node.js deprecation**: All workflows use `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` env var
