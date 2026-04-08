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
- `server/` — Express sync server (deployed to VPS at 194.113.64.90)
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
- **borderRadius**: Use `6px` (glass theme), never `2px` (old blocky theme)

## VPS / Server

- Host: `194.113.64.90` (SSH: `root` with `~/.ssh/id_ed25519_deploy`)
- Landing page: `/var/www/accounting.rmpgutah.us/`
- Sync server: `/opt/bap-server/` (PM2: `bap-server`, port 3001)
- Nginx proxies `/api/` and `/ws` to port 3001
- DNS: `accounting.rmpgutah.us` → `194.113.64.90`
- Auto-backup: desktop uploads DB to `/api/backup/upload` after every data write (30s debounce)

## Deploy

```bash
# Everything (GitHub push + VPS server deploy)
npm run deploy

# Landing page only
npm run deploy:landing

# VPS server manually
rsync -az --delete --exclude='node_modules' --exclude='dist' --exclude='.env' --exclude='data' -e "ssh -i ~/.ssh/id_ed25519_deploy" server/ root@194.113.64.90:/opt/bap-server/
ssh -i ~/.ssh/id_ed25519_deploy root@194.113.64.90 "cd /opt/bap-server && npm run build && pm2 restart bap-server --update-env"

# Mac app install
npm run build && npm run dist:mac -- --arm64
bash scripts/codesign-mac.sh "release/mac-arm64/Business Accounting Pro.app"
cp -R "release/mac-arm64/Business Accounting Pro.app" "/Applications/Business Accounting Pro.app"
xattr -cr "/Applications/Business Accounting Pro.app"
```

## VPS Server Notes

- pm2 manages `bap-server` — `pm2 list` to check status
- `.env` lives at `/opt/bap-server/.env` (never in git); must set `SYNC_SECRET`, `DESKTOP_WS_TOKEN`
- pm2 started with `--cwd /opt/bap-server` so dotenv finds `.env`
- After VPS reboot: pm2 should auto-start (run `pm2 startup` once to configure systemd hook)
