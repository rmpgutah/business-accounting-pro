# Dev Setup, Quality Gates & IPC Restructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ad-hoc test scripts and a 17,439-line `ipc/index.ts` with Vitest, ESLint gates, a declarative IPC core, a generated typed channel registry, and a snapshot-guarded extraction of every handler into domain files.

**Architecture:** Tooling lands first (Vitest with an Electron mock + in-memory DB, ESLint flat config with two custom design-token rules, hooks, CI). Then `ipc/core` introduces `defineHandler`/`featHandlers`/`deps` and a generator that emits `src/shared/ipc-channels.ts`; `api.ts`'s `invoke` is keyed on that union. Handlers are then moved out of `index.ts` prefix-by-prefix, each move gated by a test asserting the registered channel set equals the committed registry.

**Tech Stack:** Vitest 3, ESLint 9 flat config + typescript-eslint 8 + eslint-plugin-react-hooks, Prettier 3, lint-staged, better-sqlite3 (in-memory), Electron 41, TypeScript 6, Vite 8.

**Spec:** `docs/superpowers/specs/2026-10-10-dev-setup-quality-ipc-restructure-design.md`

## Global Constraints

- Both `npm run typecheck` configs (`tsconfig.json`, `tsconfig.main.json`) must stay at 0 errors after every task.
- Registered IPC channel set must be identical before and after every extraction task (set equality against `src/shared/ipc-channels.ts`; no duplicates).
- No `.tsx` may introduce a hard-coded hex colour or `borderRadius` other than `var(--app-radius)`, `'50%'`, `'9999px'`, or `1` (CLAUDE.md). Allowlisted files: `AccountAdvancedDialogs.tsx`, `InvoiceForm.tsx`, `InvoiceDetail.tsx`, `SignaturePad.tsx`, `TagPicker.tsx`.
- Every mutating handler must schedule a backup — expressed as `mutates: true` in the new core, never a hand-written `scheduleAutoBackup()` call.
- Lazy service loading (`require('../services/…')` at call time) is preserved.
- Git hooks stay under `scripts/git-hooks` via `core.hooksPath`; no husky. Escape hatch env var is `SKIP_HOOKS=1`.
- All workflows set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true`.
- Commit messages end with `Co-Authored-By: Claude Mythos 5.1 <noreply@anthropic.com>`.
- Each PR is independently mergeable; `main` stays shippable.

## Review Focus

1. **Async handler that rejects after `mutates: true`** — `defineHandler` must not schedule a backup when the promise rejects, and must still return `{ error }`. (Test in Task 7.)
2. **Handler returning `undefined`** (several `feat:*` return nothing) — `defineHandler` must pass `undefined` through, not coerce to `{ error }` or `null`. (Test in Task 7.)
3. **`requiresCompany: null` vs `[]` vs `{ error }`** — three empty values exist today; the wrong one breaks list UIs with `.map` on `null`. (Test in Task 7; transcription rule in Task 20.)
4. **Channel registered twice across two domain files** after a bad extraction — Electron throws at startup, app never opens. (Duplicate assertion in Task 10.)
5. **`gen:channels` output stale** after a channel is added but the generator wasn't re-run — typed `invoke` would reject a valid channel. (Up-to-date assertion in Task 10; pre-commit regeneration in Task 11.)

---

## File Map

**PR 1 — tooling**
- Create `vitest.config.ts`, `src/main/test/electron-mock.ts`, `src/main/test/createTestDb.ts`, `src/main/test/setup.ts`
- Create 8 ported tests next to their sources (listed in Task 3)
- Create `eslint.config.js`, `eslint-rules/index.js`, `eslint-rules/no-hardcoded-hex.js`, `eslint-rules/no-blocky-radius.js`, `eslint-rules/allowlist.json`, `eslint-rules/*.test.js`, `.prettierrc`, `.prettierignore`, `.editorconfig`
- Create `scripts/git-hooks/pre-commit`; modify `scripts/git-hooks/pre-push`
- Create `.github/workflows/ci.yml`
- Modify `package.json` (scripts, devDependencies), `src/main/database/index.ts` (`initDatabaseAt`)
- Delete `scripts/test-*.cjs`, `scripts/ui-leak-check.sh` (end of PR 1)

**PR 2 — IPC core + registry**
- Create `src/main/ipc/core/defineHandler.ts`, `core/featHandlers.ts`, `core/svc.ts`, `core/deps.ts`, `core/types.ts`
- Create `scripts/gen-ipc-channels.ts`, `src/shared/ipc-channels.ts` (generated), `src/shared/ipc-contract.ts`
- Create `src/main/ipc/ipc-registry.test.ts`, `src/shared/ipc-channels.test.ts`, `src/main/ipc/core/*.test.ts`
- Modify `src/renderer/lib/api.ts` (typed `invoke`), `src/main/ipc/index.ts` (use `createIpcDeps`)

**PR 3–7 — domain extraction** (`src/main/ipc/domains/*.ts`, one per spec §3.5 list)

**PR 8–10 — feat tables** (`src/main/ipc/feat/*.ts`, one per service accessor; `scripts/codemod-feat.ts`)

**PR 11 — finish** (`CONTRIBUTING.md`, `CLAUDE.md`, `index.ts` bootstrap only)

---

# PR 1 — Test runner, lint, hooks, CI

### Task 1: Vitest with Electron mock and in-memory DB

**Files:**
- Create: `vitest.config.ts`, `src/main/test/electron-mock.ts`, `src/main/test/setup.ts`, `src/main/test/createTestDb.ts`, `src/main/test/createTestDb.test.ts`
- Modify: `src/main/database/index.ts:105-110`, `package.json` (scripts + devDependencies)

**Interfaces:**
- Produces: `initDatabaseAt(dbPath: string): Database.Database` (in `database/index.ts`); `createTestDb(): { db: Database.Database; companyId: string; userId: string; close(): void }`; `electron-mock` exports `ipcMain` with `handle`, `removeHandler`, `invoke(channel, ...args)`, `channels(): string[]`, `reset()`.

- [ ] **Step 1: Install dependencies**

```bash
npm i -D vitest@^3 @vitest/coverage-v8@^3 jsdom
```

- [ ] **Step 2: Add `initDatabaseAt` to the database module**

In `src/main/database/index.ts`, replace the head of `initDatabase`:

```ts
export function initDatabase(): Database.Database {
  return initDatabaseAt(getDbPath());
}

// Test/alt-path entry: identical to initDatabase but with an explicit path
// (':memory:' in tests). Everything after opening the file is shared.
export function initDatabaseAt(dbPath: string): Database.Database {
  db = new Database(dbPath);
  applyPerformancePragmas(db);
  checkSchemaVersionOrThrow(db);
```

Leave the rest of the original function body unchanged (it now belongs to `initDatabaseAt`).

- [ ] **Step 3: Write the Electron mock**

`src/main/test/electron-mock.ts`:

```ts
import os from 'os';
import path from 'path';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();

export const ipcMain = {
  handle(channel: string, fn: Handler) {
    if (handlers.has(channel)) throw new Error(`Attempted to register a second handler for '${channel}'`);
    handlers.set(channel, fn);
  },
  removeHandler(channel: string) { handlers.delete(channel); },
  on() {}, once() {}, removeAllListeners() {},
  async invoke(channel: string, ...args: unknown[]) {
    const fn = handlers.get(channel);
    if (!fn) throw new Error(`No handler registered for '${channel}'`);
    return fn({ sender: { send() {} } }, ...args);
  },
  channels(): string[] { return [...handlers.keys()]; },
  reset() { handlers.clear(); },
};

export const app = {
  getPath: (_name: string) => path.join(os.tmpdir(), 'bap-test-userdata'),
  getVersion: () => '0.0.0-test',
  getName: () => 'Business Accounting Pro',
  isPackaged: false,
  on() {}, whenReady: () => Promise.resolve(), quit() {},
};

export class BrowserWindow {
  static getAllWindows() { return []; }
  static getFocusedWindow() { return null; }
  webContents = { send() {} };
}
export const dialog = { showSaveDialog: async () => ({ canceled: true }), showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showMessageBox: async () => ({ response: 0 }) };
export const shell = { openPath: async () => '', showItemInFolder() {}, openExternal: async () => {} };
export const contextBridge = { exposeInMainWorld() {} };
export const ipcRenderer = { invoke: async () => undefined, on() {}, removeListener() {} };
export const Notification = class { show() {} };
export const nativeImage = { createFromPath: () => ({}) };
export default { ipcMain, app, BrowserWindow, dialog, shell };
```

- [ ] **Step 4: Write `createTestDb`**

`src/main/test/createTestDb.ts`:

```ts
import { v4 as uuid } from 'uuid';
import * as db from '../database';

export interface TestDb {
  db: ReturnType<typeof db.getDb>;
  companyId: string;
  userId: string;
  close(): void;
}

export function createTestDb(): TestDb {
  const d = db.initDatabaseAt(':memory:');
  const companyId = uuid();
  const userId = uuid();
  d.prepare(
    `INSERT INTO companies (id, name, legal_name, created_at, updated_at)
     VALUES (?, 'Test Co', 'Test Co LLC', datetime('now'), datetime('now'))`,
  ).run(companyId);
  d.prepare(
    `INSERT INTO users (id, email, password_hash, name, role, created_at, updated_at)
     VALUES (?, 'test@example.com', 'x', 'Test User', 'owner', datetime('now'), datetime('now'))`,
  ).run(userId);
  db.switchCompany(companyId);
  db.setCurrentUser(userId, 'test@example.com');
  return { db: d, companyId, userId, close: () => d.close() };
}
```

If the `companies` or `users` INSERT fails because a NOT NULL column is missing, read the column list from `src/main/database/schema.sql` and add the missing columns with empty-string defaults — do not drop constraints.

- [ ] **Step 5: Write the setup file and Vitest config**

`src/main/test/setup.ts`:

```ts
import { afterEach } from 'vitest';
import { ipcMain } from 'electron';

afterEach(() => { (ipcMain as any).reset?.(); });
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import path from 'path';

const aliases = {
  '@': path.resolve(__dirname, 'src'),
  '@renderer': path.resolve(__dirname, 'src/renderer'),
  '@shared': path.resolve(__dirname, 'src/shared'),
  '@main': path.resolve(__dirname, 'src/main'),
};

export default defineConfig({
  test: {
    coverage: { provider: 'v8', reporter: ['text', 'html'], include: ['src/**/*.ts', 'src/**/*.tsx'] },
    projects: [
      {
        test: {
          name: 'main',
          environment: 'node',
          include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts', 'eslint-rules/**/*.test.js'],
          setupFiles: ['src/main/test/setup.ts'],
        },
        resolve: { alias: { ...aliases, electron: path.resolve(__dirname, 'src/main/test/electron-mock.ts') } },
      },
      {
        test: { name: 'renderer', environment: 'jsdom', include: ['src/renderer/**/*.test.{ts,tsx}'] },
        resolve: { alias: aliases },
      },
    ],
  },
});
```

- [ ] **Step 6: Add scripts**

In `package.json` `scripts`, add (keep all existing ones for now):

```json
"test": "ELECTRON_RUN_AS_NODE=1 electron node_modules/vitest/vitest.mjs run",
"test:watch": "ELECTRON_RUN_AS_NODE=1 electron node_modules/vitest/vitest.mjs",
"test:coverage": "ELECTRON_RUN_AS_NODE=1 electron node_modules/vitest/vitest.mjs run --coverage"
```

- [ ] **Step 7: Write the harness test**

`src/main/test/createTestDb.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createTestDb } from './createTestDb';
import * as db from '../database';

describe('createTestDb', () => {
  it('opens an in-memory DB with the schema applied and a company selected', () => {
    const t = createTestDb();
    const row = t.db.prepare('SELECT name FROM companies WHERE id = ?').get(t.companyId) as { name: string };
    expect(row.name).toBe('Test Co');
    expect(db.getCurrentCompanyId()).toBe(t.companyId);
    expect(t.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='invoices'").get()).toBeTruthy();
    t.close();
  });
});
```

- [ ] **Step 8: Run it**

Run: `npm test -- src/main/test/createTestDb.test.ts`
Expected: PASS. If better-sqlite3 fails to load with an ABI error, the `ELECTRON_RUN_AS_NODE` approach has failed — stop and implement the spec §3.2 fallback (`pretest: npm rebuild better-sqlite3`, `posttest: npx electron-builder install-app-deps`) before continuing.

- [ ] **Step 9: Commit**

```bash
git add vitest.config.ts src/main/test src/main/database/index.ts package.json package-lock.json
git commit -m "test: add Vitest with Electron mock and in-memory DB harness

Co-Authored-By: Claude Mythos 5.1 <noreply@anthropic.com>"
```

### Task 2: Port the four `dist/`-based regression scripts

**Files:**
- Create: `src/main/services/loan-calculator.test.ts`, `src/shared/payment-math.test.ts`, `src/main/services/depreciation.test.ts`, `src/main/services/document-storage.test.ts`
- Source scripts: `scripts/test-loan-calculator.cjs`, `scripts/test-payment-math.cjs`, `scripts/test-depreciation.cjs`, `scripts/test-document-storage.cjs`

**Interfaces:**
- Consumes: `generateSchedule, splitPayment, periodicPayment, periodicRate, paymentsForTerm` from `../services/loan-calculator`; `roundCents, computeInvoicePaidStatus, applyDebtPaymentDelta` from `@shared/payment-math`; `monthlyDepreciation` from `../services/depreciation`; whatever `scripts/test-document-storage.cjs` destructures from the module.

- [ ] **Step 1: Port loan-calculator**

For each `test('name', () => { … })` block in `scripts/test-loan-calculator.cjs`, write an `it('name', () => { … })` with `assert.ok(x)` → `expect(x).toBeTruthy()`, `assert.strictEqual(a, b)` → `expect(a).toBe(b)`, `assert.deepStrictEqual(a, b)` → `expect(a).toEqual(b)`, and keep the local `approx` helper. File header:

```ts
import { describe, it, expect } from 'vitest';
import { generateSchedule, splitPayment, periodicPayment, periodicRate, paymentsForTerm } from './loan-calculator';

const approx = (a: number, b: number, eps = 0.02) => Math.abs(a - b) <= eps;

describe('loan-calculator', () => {
  // one it() per original test(), bodies copied verbatim with the assertion mapping above
});
```

- [ ] **Step 2: Port payment-math, depreciation, document-storage** the same way. `document-storage` uses `os.tmpdir()` + `fs` — keep that; wrap temp-dir creation in `beforeEach` and removal in `afterEach`.

- [ ] **Step 3: Run the four files**

Run: `npm test -- loan-calculator payment-math depreciation document-storage`
Expected: all tests PASS with the same count as the original scripts printed (compare against `node scripts/test-loan-calculator.cjs` output run once before deletion — requires `npm run build:main` first).

- [ ] **Step 4: Commit**

```bash
git add src/main/services/*.test.ts src/shared/payment-math.test.ts
git commit -m "test: port loan, payment-math, depreciation, document-storage scripts to Vitest

Co-Authored-By: Claude Mythos 5.1 <noreply@anthropic.com>"
```

### Task 3: Port the tsc-on-the-fly scripts and the search-index script

**Files:**
- Create: `src/renderer/lib/classic-styles.test.ts`, `src/renderer/lib/micr.test.ts`, `src/renderer/modules/cockpit/layout-utils.test.ts`, `src/main/services/intelligence/searchIndex.test.ts`
- Source scripts: `scripts/test-classic-styles.cjs`, `scripts/test-micr.cjs`, `scripts/test-cockpit-layout.cjs`, `scripts/test-search-index.cjs`

- [ ] **Step 1: Port the three renderer-lib tests.** They compiled a single TS file with `tsc`; now import directly:

```ts
import { describe, it, expect } from 'vitest';
import { classicStyles, ruledTable } from './classic-styles';
```

(and `buildMicrCanonical` etc. from `./micr`, `clampPlacement` etc. from `./layout-utils`). These run in the `renderer` project (jsdom) because of their path — that is correct; they are pure functions.

- [ ] **Step 2: Port search-index.** It opened `better-sqlite3` directly; keep that but import source:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { ensureSearchIndex, reindexEntity, removeFromIndex, backfillCompany, search } from './searchIndex';
```

Copy the table-creation SQL and cases verbatim from the script.

- [ ] **Step 3: Run**

Run: `npm test`
Expected: 9 test files PASS (8 ported + harness).

- [ ] **Step 4: Replace the old scripts and aliases**

Delete `scripts/test-*.cjs`. In `package.json` replace the `test:loan … test:micr` scripts with filter aliases:

```json
"test:loan": "npm test -- loan-calculator",
"test:payment": "npm test -- payment-math",
"test:depreciation": "npm test -- depreciation",
"test:attachments": "npm test -- document-storage",
"test:search": "npm test -- searchIndex",
"test:cockpit": "npm test -- layout-utils",
"test:classic": "npm test -- classic-styles",
"test:micr": "npm test -- micr"
```

- [ ] **Step 5: Commit**

```bash
git add -A scripts src/renderer/lib/*.test.ts src/renderer/modules/cockpit/layout-utils.test.ts src/main/services/intelligence/searchIndex.test.ts package.json
git commit -m "test: port remaining regression scripts to Vitest; remove scripts/test-*.cjs

Co-Authored-By: Claude Mythos 5.1 <noreply@anthropic.com>"
```

### Task 4: ESLint + Prettier with custom design-token rules

**Files:**
- Create: `eslint.config.js`, `eslint-rules/index.js`, `eslint-rules/no-hardcoded-hex.js`, `eslint-rules/no-blocky-radius.js`, `eslint-rules/allowlist.json`, `eslint-rules/no-hardcoded-hex.test.js`, `eslint-rules/no-blocky-radius.test.js`, `.prettierrc`, `.prettierignore`, `.editorconfig`
- Modify: `package.json`

- [ ] **Step 1: Install**

```bash
npm i -D eslint@^9 typescript-eslint@^8 eslint-plugin-react-hooks@^5 eslint-config-prettier@^9 prettier@^3 @eslint/js globals
```

- [ ] **Step 2: Write the rule tests first**

`eslint-rules/no-hardcoded-hex.test.js`:

```js
import { RuleTester } from 'eslint';
import { it } from 'vitest';
import rule from './no-hardcoded-hex.js';

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } } });

it('no-hardcoded-hex', () => {
  tester.run('no-hardcoded-hex', rule, {
    valid: [
      { code: `<div style={{ color: 'var(--color-accent-income)' }} />`, filename: 'src/renderer/x.tsx' },
      { code: `const id = '#main';`, filename: 'src/renderer/x.tsx' },
      { code: `<div style={{ color: '#fff' }} />`, filename: 'src/renderer/components/SignaturePad.tsx' },
    ],
    invalid: [
      { code: `<div style={{ color: '#dc2626' }} />`, filename: 'src/renderer/x.tsx', errors: 1 },
      { code: `const s = { background: '#FFF' };`, filename: 'src/renderer/x.tsx', errors: 1 },
      { code: `<div color="#2563eb" />`, filename: 'src/renderer/x.tsx', errors: 1 },
    ],
  });
});
```

`eslint-rules/no-blocky-radius.test.js`:

```js
import { RuleTester } from 'eslint';
import { it } from 'vitest';
import rule from './no-blocky-radius.js';

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } } });

it('no-blocky-radius', () => {
  tester.run('no-blocky-radius', rule, {
    valid: [
      { code: `const s = { borderRadius: 'var(--app-radius)' };`, filename: 'a.tsx' },
      { code: `const s = { borderRadius: '50%' };`, filename: 'a.tsx' },
      { code: `const s = { borderRadius: '9999px' };`, filename: 'a.tsx' },
      { code: `const s = { borderRadius: 1 };`, filename: 'a.tsx' },
    ],
    invalid: [
      { code: `const s = { borderRadius: 0 };`, filename: 'a.tsx', errors: 1 },
      { code: `const s = { borderRadius: '2px' };`, filename: 'a.tsx', errors: 1 },
      { code: `const s = { borderRadius: 6 };`, filename: 'a.tsx', errors: 1 },
      { code: `const s = { borderRadius: '8px' };`, filename: 'a.tsx', errors: 1 },
    ],
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npm test -- eslint-rules`
Expected: FAIL (modules not found).

- [ ] **Step 4: Implement the rules**

`eslint-rules/allowlist.json`:

```json
{
  "no-hardcoded-hex": [
    "src/renderer/modules/accounts/AccountAdvancedDialogs.tsx",
    "src/renderer/modules/invoices/InvoiceForm.tsx",
    "src/renderer/modules/invoices/InvoiceDetail.tsx",
    "src/renderer/components/SignaturePad.tsx",
    "src/renderer/components/TagPicker.tsx"
  ],
  "no-blocky-radius": []
}
```

`eslint-rules/no-hardcoded-hex.js`:

```js
import { createRequire } from 'module';
const allow = createRequire(import.meta.url)('./allowlist.json')['no-hardcoded-hex'];
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_KEYS = /color|background|border|fill|stroke|shadow|outline/i;

export default {
  meta: { type: 'problem', docs: { description: 'Disallow hard-coded hex colours in .tsx; use CSS variables' }, schema: [] },
  create(ctx) {
    const file = ctx.filename.replace(/\\/g, '/');
    if (!file.endsWith('.tsx') || allow.some((a) => file.endsWith(a))) return {};
    const report = (node) => ctx.report({ node, message: `Hard-coded hex colour ${node.value}; use var(--color-*) / var(--accent-primary)` });
    return {
      Property(node) {
        const key = node.key.name ?? node.key.value;
        if (typeof key === 'string' && COLOR_KEYS.test(key) && node.value.type === 'Literal' && typeof node.value.value === 'string' && HEX.test(node.value.value)) report(node.value);
      },
      JSXAttribute(node) {
        if (node.value?.type === 'Literal' && typeof node.value.value === 'string' && HEX.test(node.value.value)) report(node.value);
      },
    };
  },
};
```

`eslint-rules/no-blocky-radius.js`:

```js
const OK_STRINGS = new Set(['var(--app-radius)', '50%', '9999px', 'inherit', 'initial']);

export default {
  meta: { type: 'problem', docs: { description: 'borderRadius must use var(--app-radius)' }, schema: [] },
  create(ctx) {
    if (!ctx.filename.endsWith('.tsx')) return {};
    return {
      Property(node) {
        const key = node.key.name ?? node.key.value;
        if (key !== 'borderRadius' || node.value.type !== 'Literal') return;
        const v = node.value.value;
        const ok = (typeof v === 'number' && v === 1) || (typeof v === 'string' && (OK_STRINGS.has(v) || v.startsWith('var(')));
        if (!ok) ctx.report({ node: node.value, message: `borderRadius: ${JSON.stringify(v)} — use 'var(--app-radius)' (1 is allowed for thin bars)` });
      },
    };
  },
};
```

`eslint-rules/index.js`:

```js
import noHardcodedHex from './no-hardcoded-hex.js';
import noBlockyRadius from './no-blocky-radius.js';
export default { rules: { 'no-hardcoded-hex': noHardcodedHex, 'no-blocky-radius': noBlockyRadius } };
```

- [ ] **Step 5: Run rule tests**

Run: `npm test -- eslint-rules`
Expected: PASS.

- [ ] **Step 6: Write the ESLint config**

`eslint.config.js`:

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import bap from './eslint-rules/index.js';

const warnAll = (rules) => Object.fromEntries(Object.entries(rules).map(([k, v]) => [k, Array.isArray(v) ? ['warn', ...v.slice(1)] : v === 'off' ? 'off' : 'warn']));

export default tseslint.config(
  { ignores: ['dist/**', 'release/**', 'cloudflare-app/dist/**', 'landing-page/**', 'node_modules/**', '.tmp-test/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((c) => ({ ...c, rules: c.rules ? warnAll(c.rules) : c.rules })),
  {
    files: ['src/**/*.{ts,tsx}', 'scripts/**/*.ts'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }, globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks, bap },
    rules: {
      ...warnAll(js.configs.recommended.rules),
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'bap/no-hardcoded-hex': 'error',
      'bap/no-blocky-radius': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  { files: ['**/*.test.{ts,tsx,js}', 'src/main/test/**'], rules: { '@typescript-eslint/no-floating-promises': 'off' } },
  prettier,
);
```

`.prettierrc`: `{ "singleQuote": true, "trailingComma": "all", "printWidth": 100, "semi": true }`
`.prettierignore`: `dist\nrelease\ncloudflare-app/dist\nlanding-page\n*.sql\n*.md`
`.editorconfig`:

```
root = true
[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true
```

Scripts in `package.json`:

```json
"lint": "eslint . --max-warnings=100000",
"lint:fix": "eslint . --fix",
"format": "prettier --write \"src/**/*.{ts,tsx,css}\" \"scripts/**/*.{ts,js}\"",
"format:check": "prettier --check \"src/**/*.{ts,tsx,css}\""
```

- [ ] **Step 7: Run lint and fix only errors**

Run: `npm run lint 2>&1 | grep -E "error" | grep -v "warning" | head -50`
Expected: a finite list. Fix every **error** (warnings are allowed). `no-floating-promises` errors are fixed with `void promise;` only when the promise's failure is already handled inside (e.g. `.catch(() => {})`); otherwise add `.catch((err) => console.error('<context>:', err))`. Do not add `eslint-disable` comments. Record the final warning count in the commit body.

- [ ] **Step 8: Verify the custom rules reproduce `ui-leak-check.sh`**

Run: `bash scripts/ui-leak-check.sh` and `npx eslint src/renderer --rule '{"bap/no-hardcoded-hex":"error","bap/no-blocky-radius":"error"}' -f json | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const r=JSON.parse(d).flatMap(f=>f.messages).filter(m=>m.ruleId?.startsWith('bap/'));console.log(r.length,'bap findings')})"`
Expected: the ESLint count is 0 (because PR #60 cleared the tree and the allowlist covers the intentional files). If it is not 0, the finding is either a real leak (fix it) or belongs on the allowlist with a one-line reason in the commit body. Then `git rm scripts/ui-leak-check.sh`.

- [ ] **Step 9: Commit**

```bash
git add eslint.config.js eslint-rules .prettierrc .prettierignore .editorconfig package.json package-lock.json src scripts
git commit -m "chore: add ESLint flat config, Prettier, and bap/* design-token rules

Replaces scripts/ui-leak-check.sh with bap/no-hardcoded-hex and bap/no-blocky-radius.

Co-Authored-By: Claude Mythos 5.1 <noreply@anthropic.com>"
```

### Task 5: Pre-commit / pre-push hooks and CI workflow

**Files:**
- Create: `scripts/git-hooks/pre-commit`, `.github/workflows/ci.yml`, `.lintstagedrc.json`
- Modify: `scripts/git-hooks/pre-push`, `package.json`

- [ ] **Step 1: Install lint-staged**

```bash
npm i -D lint-staged@^15
```

`.lintstagedrc.json`:

```json
{
  "*.{ts,tsx}": ["eslint --fix --max-warnings=100000", "prettier --write"],
  "*.{js,css,json,md}": ["prettier --write"]
}
```

- [ ] **Step 2: Write `pre-commit`**

`scripts/git-hooks/pre-commit`:

```sh
#!/bin/sh
# Pre-commit gate: lint-staged (eslint --fix + prettier on staged files),
# then the Vitest tests related to the staged files.
# Emergency override:  SKIP_HOOKS=1 git commit ...
if [ "$SKIP_HOOKS" = "1" ]; then echo "[pre-commit] SKIP_HOOKS=1 — skipping."; exit 0; fi
npx lint-staged || exit 1
STAGED=$(git diff --cached --name-only --diff-filter=ACMR | grep -E '\.(ts|tsx)$' | grep -v '\.test\.' | tr '\n' ' ')
if [ -n "$STAGED" ]; then
  ELECTRON_RUN_AS_NODE=1 npx electron node_modules/vitest/vitest.mjs related --run $STAGED || exit 1
fi
```

`chmod +x scripts/git-hooks/pre-commit`.

- [ ] **Step 3: Extend `pre-push`** — replace the `SKIP_TYPECHECK` check with `SKIP_HOOKS`, and after the typecheck passes add:

```sh
echo "[pre-push] Running npm test..."
npm test || { echo "[pre-push] ✗ tests FAILED — push blocked (override: SKIP_HOOKS=1)"; exit 1; }
```

- [ ] **Step 4: Write `ci.yml`**

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
      - run: npm run build
```

- [ ] **Step 5: Verify hooks locally**

Run: `touch src/main/services/loan-calculator.ts && git add -A && git commit -m "wip" ` → expect lint-staged + related tests to run; then `git reset --soft HEAD~1` to drop the wip commit (nothing changed). Run `npm run prepare` once to make sure `core.hooksPath` is set.

- [ ] **Step 6: Commit and open PR 1**

```bash
git add scripts/git-hooks .github/workflows/ci.yml .lintstagedrc.json package.json package-lock.json
git commit -m "chore: pre-commit lint-staged + related tests, pre-push tests, CI workflow

Co-Authored-By: Claude Mythos 5.1 <noreply@anthropic.com>"
git push -u origin HEAD
gh pr create --base main --title "chore: Vitest, ESLint gates, hooks, CI (revamp 1/11)" --body "Implements PR 1 of docs/superpowers/plans/2026-10-10-dev-setup-quality-ipc-restructure.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Wait for CI green and merge before starting PR 2.

---

# PR 2 — IPC core + typed channel registry

### Task 6: `svc`, `deps`, and types

**Files:**
- Create: `src/main/ipc/core/types.ts`, `src/main/ipc/core/svc.ts`, `src/main/ipc/core/deps.ts`
- Modify: `src/main/ipc/index.ts` (lift closures)

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  export interface HandlerCtx { cid: string | null; db: Database.Database; deps: IpcDeps }
  export interface IpcDeps {
    scheduleAutoBackup(): void;
    getLastLoginEmail(): string | null;
    findClosedPeriod(companyId: string, date: string): ClosedPeriod | null;
    postJournalEntry(dbi: Database.Database, companyId: string, date: string, description: string, lines: JournalLine[]): void;
    validateTable(table: string): boolean;
    cleanupReferencesBeforeDelete(table: string, id: string): void;
    isRawQueryAllowed(sql: string): { ok: boolean; reason?: string };
    buildInvoiceMetadata(invoice: any, company: any, client: any): PDFMetadata;
    buildBillMetadata(bill: any, company: any, vendor: any): PDFMetadata;
    buildPOMetadata(po: any, company: any, vendor: any): PDFMetadata;
    VALID_TABLES: Set<string>; PROTECTED_TABLES: Set<string>;
  }
  // svc.ts
  export function svc<T = any>(name: string): () => T   // () => require(`../../services/${name}`)
  // deps.ts
  export function createIpcDeps(): IpcDeps
  ```

- [ ] **Step 1: Write `types.ts`** with the interfaces above (`ClosedPeriod` = `{ id: string; period_start: string; period_end: string; close_reason: string }`, `JournalLine` = `{ nameHint: string; debit: number; credit: number; note?: string }`, `PDFMetadata` imported from `../../services/print-preview`).

- [ ] **Step 2: Write `svc.ts`**

```ts
export function svc<T = any>(name: string): () => T {
  let cached: T | undefined;
  return () => (cached ??= require(`../../services/${name}`) as T);
}
```

- [ ] **Step 3: Write `deps.ts` by moving code, not rewriting it.** Cut these from `src/main/ipc/index.ts` and paste into `deps.ts` unchanged, then export them through `createIpcDeps()`:
  - module-level: `SYNC_SERVER`, `autoBackupTimer`, `scheduleAutoBackup`, `_lastLoginEmail` + `getLastLoginEmail` + its setter, `postJournalEntry` (module-level helper)
  - from inside `registerIpcHandlers`: `VALID_TABLES`, `validateTable`, `PROTECTED_TABLES`, `cleanupReferencesBeforeDelete`, `findClosedPeriod`, `isRawQueryAllowed`, `buildInvoiceMetadata`, `buildBillMetadata`, `buildPOMetadata`

  `createIpcDeps()` returns a frozen object with all of them. At the top of `registerIpcHandlers` add `const deps = createIpcDeps(); const { scheduleAutoBackup, findClosedPeriod, … } = deps;` so every existing reference in the file still resolves. Where `index.ts` previously passed `{ scheduleAutoBackup, findClosedPeriod, postJournalEntry }` to `registerLoanIpc` etc., pass `deps`.

- [ ] **Step 4: Typecheck + run the DB tests**

Run: `npm run typecheck && npm test`
Expected: 0 errors; all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc/core src/main/ipc/index.ts
git commit -m "refactor(ipc): lift shared helpers into ipc/core/deps and add svc loader

Co-Authored-By: Claude Mythos 5.1 <noreply@anthropic.com>"
```

### Task 7: `defineHandler`

**Files:**
- Create: `src/main/ipc/core/defineHandler.ts`, `src/main/ipc/core/defineHandler.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface HandlerSpec<A extends unknown[] = any[], R = unknown> {
    call: (ctx: HandlerCtx, ...args: A) => R | Promise<R>;
    mutates?: boolean;
    requiresCompany?: unknown;   // present ⇒ when cid is null return this value
  }
  export function defineHandler(ipc: Pick<IpcMain, 'handle'>, deps: IpcDeps, channel: string, spec: HandlerSpec): void
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi } from 'vitest';
import { ipcMain } from 'electron';
import { defineHandler } from './defineHandler';
import { createTestDb } from '../../test/createTestDb';
import * as db from '../../database';

const deps = () => ({ scheduleAutoBackup: vi.fn() }) as any;

describe('defineHandler', () => {
  it('returns the call result and passes undefined through', async () => {
    createTestDb();
    defineHandler(ipcMain as any, deps(), 'x:read', { call: () => 42 });
    defineHandler(ipcMain as any, deps(), 'x:void', { call: () => undefined });
    expect(await (ipcMain as any).invoke('x:read')).toBe(42);
    expect(await (ipcMain as any).invoke('x:void')).toBeUndefined();
  });
  it('converts thrown errors to { error } and does not back up', async () => {
    createTestDb(); const d = deps();
    defineHandler(ipcMain as any, d, 'x:boom', { call: () => { throw new Error('nope'); }, mutates: true });
    expect(await (ipcMain as any).invoke('x:boom')).toEqual({ error: 'nope' });
    expect(d.scheduleAutoBackup).not.toHaveBeenCalled();
  });
  it('converts async rejections to { error } and does not back up', async () => {
    createTestDb(); const d = deps();
    defineHandler(ipcMain as any, d, 'x:rej', { call: async () => { throw new Error('later'); }, mutates: true });
    expect(await (ipcMain as any).invoke('x:rej')).toEqual({ error: 'later' });
    expect(d.scheduleAutoBackup).not.toHaveBeenCalled();
  });
  it('schedules exactly one backup after a successful mutate', async () => {
    createTestDb(); const d = deps();
    defineHandler(ipcMain as any, d, 'x:mut', { call: () => ({ ok: true }), mutates: true });
    await (ipcMain as any).invoke('x:mut');
    expect(d.scheduleAutoBackup).toHaveBeenCalledTimes(1);
  });
  it('short-circuits with the configured empty value when no company is active', async () => {
    createTestDb(); db.switchCompany(null as any);
    defineHandler(ipcMain as any, deps(), 'x:list', { call: () => ['should not run'], requiresCompany: [] });
    defineHandler(ipcMain as any, deps(), 'x:one', { call: () => 'x', requiresCompany: null });
    defineHandler(ipcMain as any, deps(), 'x:err', { call: () => 'x', requiresCompany: { error: 'No active company' } });
    expect(await (ipcMain as any).invoke('x:list')).toEqual([]);
    expect(await (ipcMain as any).invoke('x:one')).toBeNull();
    expect(await (ipcMain as any).invoke('x:err')).toEqual({ error: 'No active company' });
  });
  it('passes cid, db and args to call', async () => {
    const t = createTestDb();
    defineHandler(ipcMain as any, deps(), 'x:ctx', { call: (ctx, a: number, b: number) => ({ cid: ctx.cid, sum: a + b, hasDb: !!ctx.db }) });
    expect(await (ipcMain as any).invoke('x:ctx', 2, 3)).toEqual({ cid: t.companyId, sum: 5, hasDb: true });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -- defineHandler` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
import type { IpcMain } from 'electron';
import * as db from '../../database';
import type { HandlerCtx, IpcDeps } from './types';

export interface HandlerSpec<A extends unknown[] = any[], R = unknown> {
  call: (ctx: HandlerCtx, ...args: A) => R | Promise<R>;
  mutates?: boolean;
  requiresCompany?: unknown;
}

export function defineHandler(ipc: Pick<IpcMain, 'handle'>, deps: IpcDeps, channel: string, spec: HandlerSpec): void {
  ipc.handle(channel, async (_event, ...args: unknown[]) => {
    const cid = db.getCurrentCompanyId();
    if ('requiresCompany' in spec && !cid) return spec.requiresCompany;
    try {
      const result = await spec.call({ cid, db: db.getDb(), deps }, ...args);
      if (spec.mutates) deps.scheduleAutoBackup();
      return result;
    } catch (e: any) {
      return { error: e?.message ?? String(e) };
    }
  });
}
```

- [ ] **Step 4: Run** — `npm test -- defineHandler` → PASS (6 tests).

- [ ] **Step 5: Commit** — `git add src/main/ipc/core && git commit -m "feat(ipc): defineHandler with uniform error shape, mutate backup, company guard"` (+ trailer).

### Task 8: `featHandlers`

**Files:**
- Create: `src/main/ipc/core/featHandlers.ts`, `src/main/ipc/core/featHandlers.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface FeatSpec<S, A extends unknown[] = any[]> {
    call: (s: S, ...args: [...A, HandlerCtx]) => unknown;  // ctx is always the LAST argument
    mutates?: boolean;
    requiresCompany?: unknown;
  }
  export function featHandlers<S>(ipc: Pick<IpcMain,'handle'>, deps: IpcDeps, service: () => S, table: Record<string, FeatSpec<S>>): void
  ```
  Convention: `call: (s, payload, ctx) => …` — for handlers with no payload use `(s, _p, ctx)`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { ipcMain } from 'electron';
import { featHandlers } from './featHandlers';
import { createTestDb } from '../../test/createTestDb';

describe('featHandlers', () => {
  it('registers every key, loads the service lazily, and applies mutates/requiresCompany', async () => {
    const t = createTestDb();
    const loads = vi.fn(() => ({ list: (cid: string, c?: string) => [cid, c], apply: (id: string) => ({ ok: id }) }));
    const deps = { scheduleAutoBackup: vi.fn() } as any;
    featHandlers(ipcMain as any, deps, loads, {
      'feat:t:list': { call: (s, { client_id }: any = {}, ctx) => s.list(ctx.cid!, client_id), requiresCompany: [] },
      'feat:t:apply': { call: (s, { id }: any) => s.apply(id), mutates: true },
    });
    expect(loads).not.toHaveBeenCalled();
    expect((ipcMain as any).channels()).toEqual(['feat:t:list', 'feat:t:apply']);
    expect(await (ipcMain as any).invoke('feat:t:list', { client_id: 'c1' })).toEqual([t.companyId, 'c1']);
    expect(await (ipcMain as any).invoke('feat:t:apply', { id: 'i1' })).toEqual({ ok: 'i1' });
    expect(loads).toHaveBeenCalledTimes(1);
    expect(deps.scheduleAutoBackup).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
import type { IpcMain } from 'electron';
import { defineHandler } from './defineHandler';
import type { HandlerCtx, IpcDeps } from './types';

export interface FeatSpec<S, A extends unknown[] = any[]> {
  call: (s: S, ...args: [...A, HandlerCtx]) => unknown;
  mutates?: boolean;
  requiresCompany?: unknown;
}

export function featHandlers<S>(ipc: Pick<IpcMain, 'handle'>, deps: IpcDeps, service: () => S, table: Record<string, FeatSpec<S>>): void {
  let s: S | undefined;
  for (const [channel, spec] of Object.entries(table)) {
    const { call, ...rest } = spec;
    defineHandler(ipc, deps, channel, { ...rest, call: (ctx, ...args: unknown[]) => call((s ??= service()), ...(args as any[]), ctx) });
  }
}
```

- [ ] **Step 4: Run → PASS. Commit** `feat(ipc): featHandlers declarative table runner`.

### Task 9: Channel generator and generated registry

**Files:**
- Create: `scripts/gen-ipc-channels.ts`, `src/shared/ipc-channels.ts` (generated), `src/shared/ipc-contract.ts`
- Modify: `package.json` (`gen:channels`, add `tsx` devDependency)

**Interfaces:**
- Produces: `export type Channel = '…' | '…'`; `export const CHANNELS: readonly Channel[]`; `IpcContract`, `ArgsOf<C>`, `ResultOf<C>`.

- [ ] **Step 1: `npm i -D tsx`**

- [ ] **Step 2: Write the generator**

`scripts/gen-ipc-channels.ts`:

```ts
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['src/main/ipc', 'src/main/integrations'];
const LITERAL = /(?:ipcMain|ipc)\.handle\(\s*(['"`])([^'"`]+)\1/g;          // ipcMain.handle('x')
const DEFINE = /defineHandler\([^,]+,[^,]+,\s*(['"])([^'"]+)\1/g;              // defineHandler(ipc, deps, 'x', …)
const TABLE_KEY = /^\s*(['"])((?:feat|[a-z-]+):[^'"]+)\1\s*:\s*\{/gm;          // 'feat:x:y': { … }  (table rows)
const DYNAMIC = /(?:ipcMain|ipc)\.handle\(\s*(?!['"])/g;

const found = new Set<string>();
const walk = (dir: string) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) {
      const src = fs.readFileSync(p, 'utf8');
      const dyn = src.match(DYNAMIC);
      if (dyn) {
        // allow the single known indirection: ipc.handle(channel, …) inside defineHandler itself
        if (!p.endsWith(path.join('core', 'defineHandler.ts'))) throw new Error(`Non-literal channel in ${p}; gen-ipc-channels only supports string literals`);
      }
      for (const re of [LITERAL, DEFINE, TABLE_KEY]) for (const m of src.matchAll(re)) found.add(m[2]);
    }
  }
};
DIRS.forEach((d) => walk(path.join(ROOT, d)));

const channels = [...found].sort();
const out = `// GENERATED by scripts/gen-ipc-channels.ts — do not edit. Run: npm run gen:channels
export const CHANNELS = [
${channels.map((c) => `  '${c}',`).join('\n')}
] as const;
export type Channel = (typeof CHANNELS)[number];
`;
const target = path.join(ROOT, 'src/shared/ipc-channels.ts');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8') !== out) { console.error('src/shared/ipc-channels.ts is stale — run npm run gen:channels'); process.exit(1); }
} else {
  fs.writeFileSync(target, out);
  console.log(`wrote ${channels.length} channels`);
}
```

Scripts: `"gen:channels": "tsx scripts/gen-ipc-channels.ts"`, `"gen:channels:check": "tsx scripts/gen-ipc-channels.ts --check"`.

- [ ] **Step 3: Generate and record the count**

Run: `npm run gen:channels` → `wrote N channels`. Note N in the commit body. Sanity: `grep -c "'" src/shared/ipc-channels.ts` ≈ N.

- [ ] **Step 4: Write `ipc-contract.ts`**

```ts
import type { Channel } from './ipc-channels';

/** Opt-in per-channel typing. Channels not listed accept any args and return any. */
export interface IpcContract {
  'auth:has-users': { args: []; result: boolean };
}

export type ArgsOf<C extends Channel> = C extends keyof IpcContract ? IpcContract[C]['args'] : any[];
export type ResultOf<C extends Channel> = C extends keyof IpcContract ? IpcContract[C]['result'] : any;
```

(If `auth:has-users` does not return a boolean in `index.ts`, pick a channel whose result is unambiguous and use that as the single seed entry.)

- [ ] **Step 5: Commit** — `git add scripts/gen-ipc-channels.ts src/shared/ipc-channels.ts src/shared/ipc-contract.ts package.json package-lock.json` → `feat(ipc): generate typed channel registry from registered handlers`.

### Task 10: Registry and contract tests

**Files:**
- Create: `src/main/ipc/ipc-registry.test.ts`, `src/shared/ipc-channels.test.ts`

- [ ] **Step 1: Registry test**

```ts
import { describe, it, expect } from 'vitest';
import { ipcMain } from 'electron';
import { createTestDb } from '../test/createTestDb';
import { registerIpcHandlers } from './index';
import { CHANNELS } from '../../shared/ipc-channels';

describe('IPC registry', () => {
  it('registers exactly the generated channel set, with no duplicates', () => {
    createTestDb();
    registerIpcHandlers();
    const registered = (ipcMain as any).channels() as string[];
    expect(new Set(registered).size).toBe(registered.length);
    expect([...registered].sort()).toEqual([...CHANNELS]);
  });
});
```

Duplicates are also caught at registration time by the mock's `handle` (throws), which gives a precise channel name.

- [ ] **Step 2: Contract test**

```ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { CHANNELS } from './ipc-channels';

const set = new Set<string>(CHANNELS);
const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../..', p), 'utf8');

describe('ipc-channels', () => {
  it('is up to date with the handler sources', () => {
    expect(() => execFileSync('npx', ['tsx', 'scripts/gen-ipc-channels.ts', '--check'], { cwd: path.resolve(__dirname, '../..'), stdio: 'pipe' })).not.toThrow();
  });
  it('covers every channel api.ts invokes', () => {
    const missing = [...read('src/renderer/lib/api.ts').matchAll(/invoke\(\s*'([^']+)'/g)].map((m) => m[1]).filter((c) => !set.has(c));
    expect(missing).toEqual([]);
  });
  it('covers every channel the Cloudflare worker handles', () => {
    const missing = [...read('cloudflare-app/src/api-rpc.ts').matchAll(/case\s+'([^']+)'/g)].map((m) => m[1]).filter((c) => !set.has(c));
    expect(missing).toEqual([]);
  });
});
```

- [ ] **Step 3: Run** — `npm test -- ipc-registry ipc-channels`. Expected PASS. If `registerIpcHandlers()` throws at import/registration under the mock (e.g. a module-scope `app.getPath` call or `workflowEngine.start()` touching timers), fix by adding the missing stub to `electron-mock.ts` or guarding the call with `if (process.env.VITEST) return;` — record each such change in the commit body. If a lazy `require('../services/…')` fails under Vitest, switch `svc.ts` to `require` via `createRequire(__filename)` from `module`.

- [ ] **Step 4: Commit** `test(ipc): registry snapshot and channel contract tests`.

### Task 11: Typed `invoke` in `api.ts` and pre-commit regeneration

**Files:**
- Modify: `src/renderer/lib/api.ts:1-45`, `scripts/git-hooks/pre-commit`

- [ ] **Step 1: Change `invoke` and `webInvoke` signatures**

```ts
import type { Channel } from '@shared/ipc-channels';
import type { ArgsOf, ResultOf } from '@shared/ipc-contract';

const webInvoke = async <C extends Channel>(channel: C, ...args: ArgsOf<C>): Promise<ResultOf<C>> => { /* body unchanged */ };

const invoke = <C extends Channel>(channel: C, ...args: ArgsOf<C>): Promise<ResultOf<C>> =>
  (window as any).electronAPI?.invoke
    ? window.electronAPI.invoke(channel, ...args)
    : webInvoke(channel, ...args);
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors. Any error of the form `Argument of type '"foo:bar"' is not assignable to parameter of type Channel` is a real renderer→main drift — fix the channel name (do not add it to the registry by hand).

- [ ] **Step 3: Regenerate on pre-commit.** Append to `scripts/git-hooks/pre-commit` before lint-staged:

```sh
if git diff --cached --name-only | grep -qE '^src/main/(ipc|integrations)/'; then
  npm run -s gen:channels && git add src/shared/ipc-channels.ts
fi
```

- [ ] **Step 4: Commit, push, PR 2**

```bash
git add src/renderer/lib/api.ts scripts/git-hooks/pre-commit
git commit -m "feat(renderer): type invoke() on the generated Channel union

Co-Authored-By: Claude Mythos 5.1 <noreply@anthropic.com>"
git push && gh pr create --base main --title "feat(ipc): handler core + typed channel registry (revamp 2/11)" --body "Implements PR 2 of the plan. Registry snapshot: N channels.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

# PR 3–7 — Domain extraction

Each domain task follows the **same recipe**; the recipe is written out once here and every task below states only its prefixes, file, and anything special. Executors must apply the recipe in full for each task.

**Extraction recipe (for one domain file `src/main/ipc/domains/<name>.ts`):**

1. Locate blocks: `grep -n "ipcMain.handle('<prefix>:" src/main/ipc/index.ts` for each prefix. Handlers for a prefix are contiguous; also include the section banner comment above the first handler and any `const xx = svc(...)`-style accessor or helper defined immediately above and used only by that block.
2. Create the file:
   ```ts
   import type { IpcMain } from 'electron';
   import * as db from '../../database';
   import type { IpcDeps } from '../core/types';
   // + any imports the moved code used (copy them from index.ts; remove from index.ts only if nothing left there uses them)

   export function register<Name>Ipc(ipcMain: IpcMain, deps: IpcDeps): void {
     const { scheduleAutoBackup, findClosedPeriod /* only what this file uses */ } = deps;
     // ── moved handler blocks, verbatim ──
   }
   ```
3. Cut the blocks from `index.ts` and paste them into the function body **unchanged** (this PR series moves code; it does not rewrite handler bodies). Add `register<Name>Ipc(ipcMain, deps);` in `index.ts` at the exact position the first moved block occupied.
4. Run `npm run gen:channels` (count must be unchanged), `npm run typecheck`, `npm test -- ipc-registry`.
5. Add a smoke test `src/main/ipc/domains/<name>.test.ts` invoking one read handler and one mutate handler through the mock, asserting `error` is absent and (for the mutate) that a backup was scheduled — use `vi.spyOn(deps, 'scheduleAutoBackup')` by calling `register<Name>Ipc(ipcMain, deps)` directly with `const deps = createIpcDeps()`.
6. `npm run build` and launch the app once (`npm run dev`, open the module whose handlers moved, perform one read + one save).
7. Commit: `refactor(ipc): extract <name> handlers into domains/<name>.ts`.

Each PR: push, `gh pr create` titled `refactor(ipc): extract <domains> (revamp k/11)`, CI green, merge, then start the next PR from fresh `main`.

### Task 12 (PR 3): `db-crud` + `auth-company`
- `domains/db-crud.ts`: prefixes `db`, `trash`; keeps `validateTable`, `cleanupReferencesBeforeDelete`, `VALID_TABLES`, `PROTECTED_TABLES` usage via `deps`.
- `domains/auth-company.ts`: prefixes `auth`, `company`, plus `admin:invitation*` handlers. The `_lastLoginEmail` setter lives in `deps`; `auth:login` calls `deps.setLastLoginEmail(email)` — add `setLastLoginEmail` to `IpcDeps` in `types.ts` and `deps.ts` in this task.
- Smoke: `db:query` on `clients` returns `[]`; `db:create` on `clients` returns an `id` and schedules a backup; `auth:has-users` returns `true` with the harness user.

### Task 13 (PR 4): `accounts-gl` + `print-pdf`
- `domains/accounts-gl.ts`: prefixes `accounts`, `je`, `period`, `close`, `recon`, `numbering`.
- `domains/print-pdf.ts`: prefix `print`, plus every handler whose body calls `openPrintPreview`, `saveHTMLAsPDF`, `printHTML`, `htmlToPDFBuffer` (grep those names) and the three `build*Metadata` users.
- Smoke: `accounts:list` (or the actual list channel found by grep) returns an array; `je:create` with two balanced lines returns an id and schedules a backup.

### Task 14 (PR 5): `invoices` + `expenses` + `clients-vendors`
- `domains/invoices.ts`: prefixes `invoice`, `iv`, `iu`, `iw`, `iz`.
- `domains/expenses.ts`: prefixes `expense`, `ex`, `eu`, `reimbursement`, `mileage`.
- `domains/clients-vendors.ts`: prefixes `vn`, `vendor-locations`, `tags`.
- Smoke per file: one list, one save.

### Task 15 (PR 6): `hr-payroll` + `reports` + `debt-collection` + `loans-advanced`
- `domains/hr-payroll.ts`: prefixes `hr`, `payroll` (note `hr:` spans lines ~4945–16199 today — there are several `hr` blocks; move all of them, keeping their relative order).
- `domains/reports.ts`: prefixes `rpt`, `reports`, custom-report handlers (`report-builder`, `custom-report` if present under non-`feat` prefixes).
- `domains/debt-collection.ts`: prefixes `dc`, `debt`.
- `domains/loans-advanced.ts`: prefixes `la`, `lf`, `lk` (the existing `loans.ts` stays as is).

### Task 16 (PR 7): `workflows-automation` + `admin-settings` + `sync-backup`
- `domains/workflows-automation.ts`: prefixes `workflow`, `automations`, `rules`, `sw`, `command`, `intel`, `copilot` (the `copilotStreams` map moves with it).
- `domains/admin-settings.ts`: prefixes `admin` (remaining), `customFields`, `notification`, `email-tmpl`, `snippets`, `esign`, `sox`, `compliance`.
- `domains/sync-backup.ts`: every handler whose body references `SYNC_SERVER`, `syncPush`, or the backup upload — grep `backup`, `sync:` prefixes; `scheduleAutoBackup`'s implementation stays in `deps.ts`.
- After this task, run `grep -c "ipcMain.handle('" src/main/ipc/index.ts` — the remaining count must equal the number of `feat:` handlers (967) plus any `ipcMain.handle` lines not matched by a prefix above; list those leftovers in the PR description (they are handled in Task 17 by assigning each to the closest domain file).

### Task 17 (end of PR 7): leftovers
- For each remaining non-`feat` handler in `index.ts`, move it to the domain file that owns its table (decide by the first table name in its SQL). Snapshot test must stay green.

---

# PR 8–10 — `feat:*` tables

### Task 18: Codemod for one-line feat handlers

**Files:**
- Create: `scripts/codemod-feat.ts`, `scripts/codemod-feat.test.ts`

**Interfaces:**
- Produces: `transformFeatLine(line: string): { channel: string; entry: string; accessor: string } | null` and a CLI: `tsx scripts/codemod-feat.ts <accessorName>` that prints a `featHandlers` table for every one-line handler using that accessor (e.g. `ie`), and lists the lines it could not transform.

- [ ] **Step 1: Failing tests** — cover the five shapes that exist in `index.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { transformFeatLine } from './codemod-feat';

describe('transformFeatLine', () => {
  it('read, no cid', () => {
    const r = transformFeatLine(`  ipcMain.handle('feat:invoice:late-fee:compute', (_e, { invoice_id }: any) => { try { return ie().computeLateFee(invoice_id); } catch (e: any) { return { error: e?.message }; } });`);
    expect(r).toEqual({ accessor: 'ie', channel: 'feat:invoice:late-fee:compute', entry: `'feat:invoice:late-fee:compute': { call: (s, { invoice_id }: any) => s.computeLateFee(invoice_id) },` });
  });
  it('mutate with _r', () => {
    const r = transformFeatLine(`  ipcMain.handle('feat:invoice:late-fee:apply', (_e, { invoice_id }: any) => { try { const r = ie().applyLateFee(invoice_id); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });`);
    expect(r!.entry).toBe(`'feat:invoice:late-fee:apply': { call: (s, { invoice_id }: any) => s.applyLateFee(invoice_id), mutates: true },`);
  });
  it('list with cid guard returning []', () => {
    const r = transformFeatLine(`  ipcMain.handle('feat:credit-memo:list', (_e, { client_id }: any = {}) => { try { const cid = db.getCurrentCompanyId(); if (!cid) return []; return ie().listCreditMemos(cid, client_id); } catch (e: any) { return { error: e?.message }; } });`);
    expect(r!.entry).toBe(`'feat:credit-memo:list': { call: (s, { client_id }: any = {}, { cid }) => s.listCreditMemos(cid!, client_id), requiresCompany: [] },`);
  });
  it('create with cid injected into payload', () => {
    const r = transformFeatLine(`  ipcMain.handle('feat:credit-memo:create', (_e, memo: any) => { try { const cid = db.getCurrentCompanyId(); const r = ie().createCreditMemo({ ...memo, company_id: cid }); scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });`);
    expect(r!.entry).toBe(`'feat:credit-memo:create': { call: (s, memo: any, { cid }) => s.createCreditMemo({ ...memo, company_id: cid }), mutates: true },`);
  });
  it('wrapped result', () => {
    const r = transformFeatLine(`  ipcMain.handle('feat:invoice:reminders:mark-sent', (_e, { id }: any) => { try { const r = { ok: ie().markReminderSent(id) }; scheduleAutoBackup(); return r; } catch (e: any) { return { error: e?.message }; } });`);
    expect(r!.entry).toBe(`'feat:invoice:reminders:mark-sent': { call: (s, { id }: any) => ({ ok: s.markReminderSent(id) }), mutates: true },`);
  });
  it('returns null for multi-line or unrecognised handlers', () => {
    expect(transformFeatLine(`  ipcMain.handle('feat:x:y', (_e, a: any) => {`)).toBeNull();
  });
});
```

- [ ] **Step 2: Implement with a single regex over the canonical one-liner shape**

```ts
const SHAPE = /^\s*ipcMain\.handle\('(?<ch>feat:[^']+)',\s*\((?:_e|_event)(?:,\s*(?<args>[^)]*?))?\)\s*=>\s*\{\s*try\s*\{\s*(?<body>.*?)\s*\}\s*catch\s*\(e:\s*any\)\s*\{\s*return\s*\{\s*error:\s*e\?\.message\s*\};?\s*\}\s*\}\);\s*$/;

export function transformFeatLine(line: string) {
  const m = SHAPE.exec(line); if (!m?.groups) return null;
  let { ch, args = '', body } = m.groups as Record<string, string>;
  let requires: string | undefined; let mutates = false; let usesCid = false;
  body = body.replace(/const cid = db\.getCurrentCompanyId\(\);\s*/, () => { usesCid = true; return ''; });
  body = body.replace(/if \(!cid\) return (\[\]|null|\{[^}]*\});\s*/, (_, v) => { requires = v; return ''; });
  if (/scheduleAutoBackup\(\);/.test(body)) { mutates = true; body = body.replace(/\s*scheduleAutoBackup\(\);/, ''); }
  // "const r = EXPR; return r;"  or  "return EXPR;"
  const ret = /^(?:const _?r = (?<e1>.*?); return _?r;|return (?<e2>.*?);)$/.exec(body.trim());
  if (!ret?.groups) return null;
  let expr = (ret.groups.e1 ?? ret.groups.e2).trim();
  const acc = /^(?:\{\s*\w+:\s*)?(?<acc>[a-z0-9_]+)\(\)\./i.exec(expr)?.groups?.acc;
  if (!acc) return null;
  expr = expr.replace(new RegExp(`\\b${acc}\\(\\)\\.`, 'g'), 's.');
  if (/^\{/.test(expr)) expr = `(${expr})`;                 // wrapped object literal needs parens in arrow body
  if (requires) expr = expr.replace(/\bcid\b(?!!)/g, 'cid!'); // guard guarantees non-null
  const params = ['s', args.trim() || '_p: any', ...(usesCid ? ['{ cid }'] : [])].join(', ');
  const tail = [mutates ? 'mutates: true' : '', requires ? `requiresCompany: ${requires}` : ''].filter(Boolean).map((t) => `, ${t}`).join('');
  return { accessor: acc, channel: ch, entry: `'${ch}': { call: (${params}) => ${expr}${tail} },` };
}

if (require.main === module) {
  const fs = require('fs'); const target = process.argv[2];
  const lines = fs.readFileSync('src/main/ipc/index.ts', 'utf8').split('\n');
  const ok: string[] = []; const bad: string[] = [];
  for (const l of lines) if (l.includes("ipcMain.handle('feat:") && new RegExp(`\\b${target}\\(\\)`).test(l)) { const r = transformFeatLine(l); (r ? ok : bad).push(r ? r.entry : l); }
  console.log(ok.join('\n')); console.error(`\n# ${bad.length} lines need manual transcription:\n${bad.join('\n')}`);
}
```

Adjust the regexes until all six tests pass; do not special-case test inputs.

- [ ] **Step 3: Run → PASS. Commit** `chore(ipc): codemod for one-line feat handlers`.

### Task 19 (PR 8–10): Transcribe each service accessor into `feat/<service>.ts`

Service accessors in `index.ts` (name → service module): `ie`→invoice-expense-features, `bp`→banking-payroll-features, `ra`→reports-analytics-features, `cvd`→client-vendor-doc-features, `am`→automation-features, `tr`→treasury-features, `ip`→inventory-projects-features, `cs`→crm-sales-features, `cm`→compliance-security-features, `ag`→accounting-gl-features, `aa`→accounting-analytics-features, `ds`→dynamic-search-bulk-features, `dp`→dynamic-power-features, `ptc`→payroll-tax-consolidation-features, `ptd`→portal-time-doc-features, `ci`→collab-integration-features, `inp`→invoice-payment-features, `ef`→expense-finance-features, `epc`→expense-policy-card-features, `ecm`→expense-custom-mobile-features, `rpd`→reporting-dashboards-features (the `feat:` ones), plus any accessor found by `grep -n "= () => require('../services/" src/main/ipc/index.ts` not listed here.

**Per accessor (one commit each; ~7 accessors per PR):**

- [ ] 1. `npx tsx scripts/codemod-feat.ts <acc> > /tmp/<acc>.table 2> /tmp/<acc>.manual`
- [ ] 2. Create `src/main/ipc/feat/<service>.ts`:
   ```ts
   import type { IpcMain } from 'electron';
   import type { IpcDeps } from '../core/types';
   import { featHandlers } from '../core/featHandlers';
   import { svc } from '../core/svc';

   export function register<Service>Feat(ipcMain: IpcMain, deps: IpcDeps): void {
     featHandlers(ipcMain, deps, svc('<service-module>'), {
       // paste /tmp/<acc>.table here
     });
   }
   ```
- [ ] 3. Transcribe each line in `/tmp/<acc>.manual` by hand into a table entry following the same conventions (`mutates` iff the body called `scheduleAutoBackup()`; `requiresCompany` set to the exact value the `if (!cid) return …` used; ctx last). Multi-statement bodies become a block arrow: `call: (s, p, { cid }) => { …; return …; }`.
- [ ] 4. Delete the moved `ipcMain.handle('feat:…')` lines and the `const <acc> = () => require(…)` line from `index.ts`; add `register<Service>Feat(ipcMain, deps);` at the same position.
- [ ] 5. `npm run gen:channels` (unchanged count) && `npm run typecheck` && `npm test -- ipc-registry`.
- [ ] 6. Add `src/main/ipc/feat/<service>.test.ts`: register the file alone with `createIpcDeps()` spied, invoke **every `mutates: true` entry** with a minimal payload (`{}` is acceptable — the point is the backup spy, and `{ error }` results are allowed) and assert `scheduleAutoBackup` was called once per non-error result; invoke two read entries and assert no throw.
- [ ] 7. Commit: `refactor(ipc): feat table for <service>` with the count of codemodded vs hand-transcribed entries in the body.

### Task 20: Transcription rules (apply during Task 19; reviewer checks these)

- `requiresCompany` is copied **exactly**: `[]` → `[]`, `null` → `null`, `{ error: '…' }` → that object. Never normalise.
- A body that returned `undefined` implicitly (no `return`) becomes `call: (s, p) => { s.x(p); }` — keep the `void` return.
- Handlers that call `db.*` directly in addition to the service keep those calls inside `call` using `ctx.db` / `db` import.
- Any handler that **did not** call `scheduleAutoBackup()` but whose service method name starts with `upsert|create|delete|apply|record|mark|set|rotate|revoke` gets `mutates: true` **and** a line in the PR description under "backup calls added" — this is the intended fix of the bug class, made visible.

---

# PR 11 — Finish

### Task 21: Bootstrap-only `index.ts`, docs, CLAUDE.md

**Files:**
- Modify: `src/main/ipc/index.ts`, `CLAUDE.md`
- Create: `CONTRIBUTING.md`

- [ ] **Step 1:** Confirm `grep -c "ipcMain.handle('" src/main/ipc/index.ts` is `0` and `wc -l` ≤ 200. If handlers remain, they go to the owning domain file (Task 17 rule).
- [ ] **Step 2:** `index.ts` keeps only: imports, `_ipcHandlersRegistered` guard, `createIpcDeps()`, the ordered list of `register*Ipc(ipcMain, deps)` / `register*Feat(ipcMain, deps)` calls, `registerStripeIpc`, `registerEntityGraphIpc`, and the `__assertNotInClosedPeriod` test hook.
- [ ] **Step 3:** `CONTRIBUTING.md` (≤ 60 lines): setup (`npm ci`, `npm run prepare`), scripts table (`dev`, `test`, `test:watch`, `lint`, `format`, `gen:channels`, `typecheck`, `build`), "adding an IPC channel" (define in a domain/feat file → `npm run gen:channels` → add wrapper in `api.ts` → optional `IpcContract` entry), test placement, hook override `SKIP_HOOKS=1`.
- [ ] **Step 4:** `CLAUDE.md`: under **Commands** add `npm test`, `npm run lint`, `npm run gen:channels`; under **Gotchas** replace the better-sqlite3 rebuild bullet with "Tests run under `ELECTRON_RUN_AS_NODE=1 electron` so one native build serves app and tests" (only if Task 1 Step 8 succeeded — otherwise document the fallback); replace the `ui-leak-check.sh` bullet with the two ESLint rule names and the allowlist path; under **Data Patterns** replace "New IPC handlers need `scheduleAutoBackup()`" with "Mutating handlers set `mutates: true` in `defineHandler`/`featHandlers`"; update the `ipc/index.ts` architecture line to describe `core/`, `domains/`, `feat/`.
- [ ] **Step 5:** `npm run typecheck && npm run lint && npm test && npm run build`, launch the app, exercise Dashboard, Invoices, Expenses, Loans, Payroll once each.
- [ ] **Step 6:** Commit `refactor(ipc): index.ts is bootstrap only; add CONTRIBUTING; update CLAUDE.md`, push, `gh pr create` titled `refactor(ipc): finish extraction + docs (revamp 11/11)`.

---

## Self-review (done at authoring time)

- **Spec coverage:** §3.1 → Tasks 1–3; §3.2 → Task 1 Step 8; §3.3 → Task 4; §3.4 → Task 5 + Task 11 Step 3; §3.5 → Tasks 6–8, 12–17, 19; §3.6 → Tasks 9–11; §3.7 → Task 10 + per-domain smoke steps; §3.8 → Task 21; §4 sequencing → PR headings; §5 edge cases → Task 7 tests and Task 20 rules; §6 testing matrix → Tasks 4 (rule tests), 7, 8, 10, 18, 19 step 6.
- **Deviation from spec, deliberate:** `ResultOf` defaults to `any` (spec said `unknown`) so the 2,536 existing `api.ts` return annotations compile unchanged; channel-name safety is unaffected.
- **Type consistency:** `createIpcDeps`, `IpcDeps`, `HandlerCtx`, `defineHandler(ipc, deps, channel, spec)`, `featHandlers(ipc, deps, service, table)`, `svc(name)`, `CHANNELS`/`Channel`, `ArgsOf`/`ResultOf`, `register<Name>Ipc(ipcMain, deps)`, `register<Service>Feat(ipcMain, deps)` are used with the same names/arity throughout. `setLastLoginEmail` is added to `IpcDeps` in Task 12.
- **Review Focus:** items 1–3 pinned by Task 7 tests; 4 by Task 10 (set + mock throw); 5 by Task 10 (`--check`) and Task 11 Step 3.
