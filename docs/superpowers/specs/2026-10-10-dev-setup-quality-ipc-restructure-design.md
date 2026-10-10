# Developer Setup, Quality Gates & IPC Restructure — Design

**Date:** 2026-10-10
**Sub-project:** 1 of 4 in the Business Accounting Pro revamp
(1 dev setup & quality → 2 build & release pipeline → 3 first-run/installer → 4 app features & UX)
**Approach chosen:** B — deep restructure (tooling + declarative IPC + typed channel registry)

## 1. Intent

Make the codebase safe to change at speed. Today the only gate is a pre-push
`tsc`; tests are eight ad-hoc `node:assert` scripts that require compiled
`dist/` output; there is no lint; and `src/main/ipc/index.ts` is a 17,439-line
file holding 2,398 handlers. The last audit found 395 mutation handlers missing
`scheduleAutoBackup()` — a bug class that exists only because the boilerplate is
copy-pasted 2,398 times.

**Success criteria**

- `npm test` runs a real suite under Vitest with no prior build step; CI runs it on every PR.
- A hard-coded hex colour, a floating promise, or an unused variable blocks a commit.
- `ipc/index.ts` is ≤ 200 lines of bootstrap; every handler lives in a domain file.
- A renderer call to a channel that no handler registers is a **compile error**.
- Handler count is provably unchanged across the whole refactor (snapshot test).
- The eight existing regression scripts pass, ported, with no behaviour change.

**Out of scope** (later sub-projects): release automation, notarization,
auto-update, dependency vulnerability remediation, onboarding UX, new features.

## 2. Constraints discovered

| Fact | Consequence |
|---|---|
| Vite 7, TS strict, Node 22, Electron 41 | Vitest fits with zero config; two tsconfigs (`tsconfig.json` ESM/bundler for renderer, `tsconfig.main.json` CJS for main) must both stay green. |
| `postinstall` runs `electron-builder install-app-deps` → better-sqlite3 is built for the **Electron** ABI | Plain `node`/Vitest cannot load it. See §3.2. |
| `feat:*` handlers (967) are **not** uniform: each has bespoke arg destructuring, `company_id` injection, null-cid guards returning `[]` vs `null`, and result wrapping (`{ ok }`, `{ scheduled }`) | A name-based "magic dispatcher" cannot derive this. Mappings stay explicit; only the boilerplate is factored out. |
| Renderer never calls `electronAPI.invoke` outside `src/renderer/lib/api.ts` (2,536 wrappers) | A typed channel registry is contained to `api.ts` + main. |
| Cloudflare web host (`cloudflare-app/src/api-rpc.ts`) reimplements a subset of channels against D1 independently | Registry can **check** the worker (its channels ⊆ union) but must not become a runtime dependency of it. |
| Helpers sub-modules need (`findClosedPeriod`, `postJournalEntry`, `validateTable`, `cleanupReferencesBeforeDelete`, `isRawQueryAllowed`, PDF metadata builders) are closures *inside* `registerIpcHandlers` | They must be lifted to a module before domains can be extracted. `loans.ts` already shows the `deps` injection pattern to follow. |
| Services are loaded lazily via `const ie = () => require('../services/…')` | Preserve laziness (startup time, circular-import safety) in the new `svc()` helper. |

## 3. Design

### 3.1 Test infrastructure

- **Runner:** Vitest. Config in `vitest.config.ts` (extends the renderer Vite aliases `@`, `@renderer`, `@shared`, `@main`). Two projects: `main` (node environment, `src/main/**/*.test.ts`, `src/shared/**/*.test.ts`) and `renderer` (jsdom, `src/renderer/**/*.test.ts(x)`). Renderer project is scaffolded but has no tests in this sub-project.
- **Location:** tests sit next to source as `*.test.ts`. `scripts/test-*.cjs` are deleted after porting.
- **Ported tests** (import TS source directly, no `dist/`):
  `loan-calculator`, `payment-math`, `depreciation`, `document-storage`, `search-index`, `cockpit-layout`, `classic-styles`, `micr`. Assertions move from `node:assert` to `expect`; test names and cases are preserved 1:1.
- **DB harness:** `src/main/test/createTestDb.ts` — opens better-sqlite3 `:memory:`, executes `schema.sql`, runs the same migrations `database/index.ts` applies, seeds one company + one user, and installs itself as the active DB (`db.getDb()` / `db.getCurrentCompanyId()` return it). Returns `{ db, companyId, userId, close() }`.
- **Fake ipcMain:** `src/main/test/fakeIpcMain.ts` — records `handle(channel, fn)` into a `Map` and exposes `invoke(channel, ...args)` so IPC tests call handlers without Electron.
- **Scripts:** `test` → `vitest run`; `test:watch`; `test:coverage` (v8, reported not gated); existing `test:loan`, `test:micr` etc. become `vitest run -t <pattern>` aliases so muscle memory keeps working.

### 3.2 Native-module ABI decision

Run Vitest through Electron's bundled Node so one native build serves app, dev and tests:

```
"test": "ELECTRON_RUN_AS_NODE=1 electron node_modules/vitest/vitest.mjs run"
```

This removes the "`npm rebuild better-sqlite3` before `npm run dev`" gotcha from CLAUDE.md. PR 1 verifies this on macOS and in the Ubuntu CI runner (Electron needs no display when `ELECTRON_RUN_AS_NODE=1`). **Fallback** if it proves unreliable on CI: a `pretest` step that rebuilds better-sqlite3 for Node into a side path, and `posttest` that restores the Electron build. The fallback is not implemented unless the primary fails.

### 3.3 Lint & format

- **ESLint 9 flat config** (`eslint.config.js`): `typescript-eslint` (type-aware for `src/main`, `src/shared`, `src/renderer`), `eslint-plugin-react-hooks`, `eslint-config-prettier`.
- **Prettier** with `.prettierrc` (single quotes, trailing commas, 100 cols — matching the dominant existing style) and `.editorconfig`.
- **Error-level rules (block commits):**
  - `@typescript-eslint/no-floating-promises`
  - `@typescript-eslint/no-unused-vars` (`argsIgnorePattern: '^_'`)
  - `react-hooks/rules-of-hooks`
  - `bap/no-hardcoded-hex` — in `.tsx`, flags string literals matching `#[0-9a-f]{3,8}` inside JSX attributes, `style` objects and `.css`-like template literals.
  - `bap/no-blocky-radius` — in `.tsx`, flags `borderRadius: 0 | '0px' | '2px' | <number ≥ 2>` and any `borderRadius: '<n>px'`; allowed values are `var(--app-radius)`, `'50%'`, `'9999px'`, `1` (thin bars).
  Both custom rules live in `eslint-rules/` as a local plugin and carry an **allowlist** file (`eslint-rules/allowlist.json`) seeded with the four known-intentional sites: `AccountAdvancedDialogs.tsx` (MICR optical values), `InvoiceForm.tsx` / `InvoiceDetail.tsx` (paper-white print iframes), `SignaturePad.tsx` (canvas ink), `TagPicker.tsx` (user-selectable palette data). `scripts/ui-leak-check.sh` is deleted once the rules are green.
- **Everything else** from the recommended presets is `warn`. A follow-up PR can ratchet rules to `error` once their warning count is zero.
- Scripts: `lint`, `lint:fix`, `format`, `format:check`.

### 3.4 Git hooks & CI

- Keep `core.hooksPath = scripts/git-hooks` (committed, set by `prepare`). No husky.
- **`pre-commit`** (new): `lint-staged` → `eslint --fix --max-warnings=-1` and `prettier --write` on staged files; then `vitest related --run <staged>` so a change to `loan-calculator.ts` runs its tests. Override: `SKIP_HOOKS=1`.
- **`pre-push`** (existing, extended): typecheck, then `npm test`. Same `SKIP_TYPECHECK=1` escape renamed to `SKIP_HOOKS=1`.
- **`.github/workflows/ci.yml`** (new) on `pull_request` and `push` to `main`: `npm ci` → `npm run typecheck` → `npm run lint` → `npm test` → `npm run build`. Uses `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` like the other workflows. `release.yml` is untouched.

### 3.5 IPC decomposition

Target layout:

```
src/main/ipc/
  index.ts              # bootstrap + ordered registration list (≤ 200 lines)
  core/
    defineHandler.ts    # uniform wrapper (see below)
    deps.ts             # IpcDeps type + factory lifting today's closures
    featHandlers.ts     # declarative table runner for feat:* channels
    svc.ts              # lazy service loader
  domains/
    db-crud.ts          # db:*, trash:*
    auth-company.ts     # auth:*, company:*, admin invitations
    accounts-gl.ts      # accounts:*, je:*, period:*, close:*, recon:*
    invoices.ts         # invoice:*, iv:*, iu:*, iw:*, iz:*, numbering:*
    expenses.ts         # expense:*, ex:*, eu:*, reimbursement:*, mileage:*
    clients-vendors.ts  # vn:*, vendor-locations:*, tags:*
    hr-payroll.ts       # hr:*, payroll:*
    reports.ts          # rpt:*, reports:*, custom reports
    debt-collection.ts  # dc:*, debt:*
    loans-advanced.ts   # la:*, lf:*, lk:*
    workflows-automation.ts  # workflow:*, automations:*, rules:*, sw:*, command:*, intel:*, copilot:*
    admin-settings.ts   # admin:*, customFields:*, notification:*, email-tmpl:*, snippets:*, esign:*, sox:*, compliance:*
    print-pdf.ts        # print:*, PDF metadata builders
    sync-backup.ts      # backup/sync channels + scheduleAutoBackup owner
  feat/
    invoice-expense.ts  # one file per service module behind feat:* (≈25 files)
    treasury.ts
    …
  loans.ts, tax.ts, compliance.ts, …   # existing sub-modules, unchanged
```

**`defineHandler`**

```ts
type HandlerSpec<A extends unknown[], R> = {
  call: (ctx: HandlerCtx, ...args: A) => R | Promise<R>;
  mutates?: boolean;            // true ⇒ scheduleAutoBackup() after success
  requiresCompany?: unknown;    // if set, cid null ⇒ return this value (e.g. [] or null)
};
defineHandler(ipcMain, deps, 'invoice:save', { call: …, mutates: true });
```

`HandlerCtx` carries `cid`, `db`, and `deps`. The wrapper owns the single `try/catch → { error: e.message }` shape today's handlers all hand-roll. Handlers that intentionally throw (none found) would opt out with `raw: true`.

**`featHandlers`** — a table runner over `defineHandler` for the 967 `feat:*` channels:

```ts
featHandlers(ipcMain, deps, svc('invoice-expense-features'), {
  'feat:invoice:late-fee:compute': { call: (s, { invoice_id }) => s.computeLateFee(invoice_id) },
  'feat:invoice:late-fee:apply':   { call: (s, { invoice_id }) => s.applyLateFee(invoice_id), mutates: true },
  'feat:credit-memo:list':         { call: (s, { client_id }, { cid }) => s.listCreditMemos(cid, client_id), requiresCompany: [] },
});
```

Each mapping is transcribed from the existing one-liner — the adapter logic is kept, the boilerplate is not. The `mutates` flag replaces the easy-to-forget `scheduleAutoBackup()` call.

**`deps.ts`** — `createIpcDeps()` returns `{ scheduleAutoBackup, getLastLoginEmail, findClosedPeriod, postJournalEntry, validateTable, cleanupReferencesBeforeDelete, isRawQueryAllowed, buildInvoiceMetadata, buildBillMetadata, buildPOMetadata, VALID_TABLES, PROTECTED_TABLES }`. Existing sub-modules (`loans.ts` etc.) keep their narrower `deps` interfaces; they are structurally satisfied by the full object.

**Registration order** in `index.ts` is preserved from today's file order. Electron throws on a duplicate `handle`, so order cannot silently change behaviour; the snapshot test additionally asserts no duplicates. The `_ipcHandlersRegistered` once-only guard stays.

### 3.6 Typed channel registry

- `src/shared/ipc-channels.ts` — **generated**, committed, contains
  `export type Channel = 'auth:login' | … ;` and `export const CHANNELS: readonly Channel[]`.
- `scripts/gen-ipc-channels.ts` — scans `src/main/ipc/**` for `ipcMain.handle('…'`, `defineHandler(…, '…'`, and `featHandlers` table keys, plus `integrations/*` registrations; sorts; writes the file. `npm run gen:channels`. A CI/test step asserts the committed file is up to date (`git diff --exit-code` after regeneration).
- `src/shared/ipc-contract.ts` — hand-written, opt-in:
  ```ts
  export interface IpcContract {
    'auth:login': { args: [LoginPayload]; result: LoginResult };
    // … add per channel as domains are typed
  }
  type ArgsOf<C extends Channel> = C extends keyof IpcContract ? IpcContract[C]['args'] : unknown[];
  type ResultOf<C extends Channel> = C extends keyof IpcContract ? IpcContract[C]['result'] : unknown;
  ```
- `api.ts`: `invoke` becomes `invoke<C extends Channel>(channel: C, ...args: ArgsOf<C>): Promise<ResultOf<C>>`. Where a wrapper already declares a return type (e.g. `Promise<any[]>`) it is kept and widened by `as` only when `ResultOf` is `unknown` — i.e. no existing call site changes type. The web `webInvoke` bridge keeps the same signature.
- Main side: `defineHandler` and `featHandlers` key parameters are `Channel`, so registering an unknown channel is also a compile error (after `gen:channels` is re-run — the generator runs on pre-commit for `src/main/ipc/**` changes).
- `src/shared/ipc-channels.test.ts` asserts: (a) `CHANNELS.length === 2398` at the start of the refactor (updated deliberately when channels are added), (b) every `invoke('…')` literal in `api.ts` ∈ `CHANNELS` (belt-and-braces for the type check), (c) every channel string handled in `cloudflare-app/src/api-rpc.ts` ∈ `CHANNELS`.

### 3.7 Refactor safety net

- `src/main/ipc/ipc-registry.test.ts`: `createTestDb()` + `fakeIpcMain` → `registerIpcHandlers()` → assert the registered channel **set** deep-equals `CHANNELS`. Runs on every PR of the extraction series; any dropped, renamed or duplicated handler fails.
- Per-domain smoke test: invoke 2–3 representative handlers (one read, one mutate) through `fakeIpcMain` against the in-memory DB and assert shape (`{ error }` absent, `mutates` triggered the backup spy).
- The eight ported tests, `npm run typecheck`, `npm run build`, and a manual launch of the packaged app before each extraction PR merges.

### 3.8 Developer onboarding

- `CONTRIBUTING.md` (≤ 1 page): setup, scripts, hook escape hatch, how to add a channel (`defineHandler` → `gen:channels` → `api.ts`), where tests go.
- `npm run setup` = `npm ci` + hooks install (hooks already come from `prepare`). CLAUDE.md gotchas updated: remove the rebuild dance if §3.2 succeeds; add the "run `gen:channels`" rule and the ESLint rule names.

## 4. Sequencing

| PR | Content | Gate |
|---|---|---|
| 1 | Vitest + 8 ported tests + `createTestDb` + `fakeIpcMain`; ESLint/Prettier/editorconfig + custom rules + allowlist; pre-commit/pre-push; `ci.yml`; ABI decision (§3.2) | CI green; `ui-leak-check.sh` numbers reproduced by ESLint before deletion |
| 2 | `ipc/core/*`, `deps.ts` lifting closures (handlers still in `index.ts`, now calling the lifted helpers); `gen-ipc-channels` + committed `ipc-channels.ts`; typed `invoke`; `ipc-registry.test.ts`; contract test | Snapshot = 2,398; tsc green on both configs; app launches |
| 3–7 | Domain extraction, 2–3 domains per PR, in dependency order: `db-crud` + `auth-company` → `accounts-gl` + `print-pdf` → `invoices` + `expenses` + `clients-vendors` → `hr-payroll` + `reports` + `debt-collection` + `loans-advanced` → `workflows-automation` + `admin-settings` + `sync-backup` | Snapshot test per PR |
| 8–10 | `feat/*` tables, ~8 service modules per PR | Snapshot test; backup-spy test for every `mutates: true` |
| 11 | `index.ts` reduced to bootstrap; `CONTRIBUTING.md`; CLAUDE.md updates; delete `scripts/test-*.cjs` and `ui-leak-check.sh` | All of the above |

Each PR is independently mergeable; main stays shippable throughout.

## 5. Error handling & edge cases

- A handler that previously returned a non-`{ error }` failure shape (e.g. `{ ok: false, reason }`) keeps it — `defineHandler` only catches *thrown* errors.
- `requiresCompany` empty value is per-handler (`[]`, `null`, `{ error: 'No active company' }`) to match today's behaviour exactly; the transcription records whichever the original used.
- `scheduleAutoBackup` ownership moves to `sync-backup.ts`; `deps` exposes it, so no handler imports it directly.
- Generator robustness: channels built dynamically at runtime (none found; `grep` for `` ipcMain.handle(` `` returns 0) would be unsupported — the generator fails loudly if it encounters a non-literal first argument.
- If a Cloudflare worker channel is found outside `CHANNELS` the contract test fails with the list — it is a signal to fix the worker, not the registry.

## 6. Testing strategy summary

| Layer | Test |
|---|---|
| Services | 8 ported regression suites (pure functions + in-memory DB) |
| IPC core | `defineHandler` unit tests: error shape, `mutates` ⇒ backup spy called once, `requiresCompany` short-circuit, async handlers |
| IPC registry | Snapshot equality; per-domain smoke invokes |
| Contract | `api.ts` literals ⊆ `CHANNELS`; worker channels ⊆ `CHANNELS`; generated file up to date |
| Lint rules | Unit tests for `no-hardcoded-hex` / `no-blocky-radius` with valid/invalid fixtures and the allowlist |
| CI | typecheck → lint → test → build on every PR |

## 7. Risks

- **ABI (§3.2)** — resolved in PR 1 before anything depends on it.
- **Type-aware ESLint cost** on a 300k-line repo — mitigate with `projectService: true` and scoping type-aware rules to `src/main` + `src/shared` first; measure in PR 1.
- **Transcription errors in `feat/*` tables** — mitigated by the backup-spy test (catches a missed `mutates`) and the snapshot (catches a missed channel); argument-adapter mistakes are caught only by smoke tests, so each `feat/*` PR includes one invoke per table.
- **Merge conflicts with concurrent feature work in `index.ts`** — extraction PRs are small and frequent; each announces the line ranges it moves.
