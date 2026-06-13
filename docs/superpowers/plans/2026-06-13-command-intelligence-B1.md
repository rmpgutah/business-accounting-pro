# B1 — Intelligence Core + Command Palette Elevation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared Intelligence Core (FTS5 search index across ~12 entity types + a typed action registry with role checks) and elevate the existing ⌘K Command Palette to use it, with inline intelligence hints.

**Architecture:** A new main-process `searchIndex` service backed by a SQLite FTS5 virtual table, kept fresh at the existing `db:create/update/delete` choke point. A shared typed action registry (`src/shared/action-registry.ts`) consumed by the palette; mutation actions execute through a new `action:invoke` IPC handler that enforces the user's role in the main process. The existing palette UI is repointed at these instead of its 3-table LIKE query and renderer-only command list.

**Tech Stack:** Electron + React 19 + TypeScript, better-sqlite3 (FTS5 confirmed available), Zustand, Warm Structured Glass theme tokens.

**Spec:** `docs/superpowers/specs/2026-06-13-command-intelligence-layer-design.md` (B1 section).

**Testing convention (repo has no test runner):** main-process logic is tested with dependency-free `scripts/test-*.cjs` assertion scripts (pattern: `scripts/test-loan-calculator.cjs`, run after `npm run build:main`, require compiled output from `dist/`). UI/wiring is verified with `npm run build` + `bash scripts/ui-leak-check.sh` + manual dev-app checks. Use TDD where a `.cjs` test is feasible (the index service); build+manual elsewhere.

**Verified integration facts:**
- Migrations: idempotent `migrations: string[]` array at `database/index.ts:119`, executed in a try/catch loop at `:9346`. Add new `CREATE VIRTUAL TABLE` / `CREATE TABLE` strings there.
- Choke point: `db:create` handler `ipc/index.ts:761` (after `db.create` + `db.logAudit`), `db:update` `:826`, `db:delete` (`db.remove` near `:790+`). `scheduleAutoBackup()` already called in create/update.
- Helpers: `db.runQuery(sql, params)` (`database/index.ts:10059`), `db.execQuery(sql, params)` (`:10063`), `db.getById(table,id)` (`:9822`), `db.getCurrentCompanyId()` (`:9756`), `db.getCurrentUserId()` (`:9738`). User role: `SELECT role FROM users WHERE id = ?`.
- Palette: `src/renderer/components/CommandPalette.tsx` (entity search effect L44-62 uses a 3-table UNION LIKE; results assembly L66-92; `executeResult` L94-118). Commands: `src/renderer/components/CommandPaletteCommands.ts` (45 cmds, `RENDERER_COMMANDS`, `findCommands`). Parser: `src/renderer/lib/commandParser.ts`.
- API wrapper file: `src/renderer/lib/api.ts` (add new wrappers near `globalSearch` L64 / `intelligence*` L531).
- Insight: `src/main/services/IntelligenceService.ts` (`intelligenceService` singleton); channels `intelligence:anomalies|cash-projection|dismiss-anomaly`.
- `validateTable`/`VALID_TABLES` at `ipc/index.ts:666-701`.

---

### Task 1: Search index schema + index config

**Files:**
- Modify: `src/main/database/index.ts` (migrations array ~L119; `tablesWithoutCompanyId` / `tablesWithoutUpdatedAt` lists)
- Create: `src/main/services/intelligence/indexConfig.ts`

- [ ] **Step 1: Add the FTS5 migration.** In `database/index.ts`, inside the `migrations` array (anywhere after L119, e.g. at the end before the closing `]`), add:

```ts
  // Intelligence Core — full-text search index (B1)
  `CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
    entity_type UNINDEXED,
    entity_id UNINDEXED,
    company_id UNINDEXED,
    title,
    subtitle,
    body,
    tokenize = 'porter unicode61'
  )`,
```

- [ ] **Step 2: Exempt `search_index` from company/updated_at injection.** Find the `tablesWithoutCompanyId` set and the `tablesWithoutUpdatedAt` set in `database/index.ts` (grep `tablesWithoutCompanyId`). Add `'search_index'` to BOTH. (FTS5 virtual table has only the declared columns; injecting `company_id`/`updated_at` columns would corrupt inserts.)

- [ ] **Step 3: Create `indexConfig.ts`** — the single source of truth for which tables are indexed and how a row maps to title/subtitle/body. Each entry: the table, the module to route to, and a `toDoc(row)` mapper.

```ts
// Which entities are searchable, and how each row projects into the FTS index.
// Adding a table here is the ONLY change needed to make it searchable.
export interface IndexDoc { title: string; subtitle: string; body: string; }

export interface IndexEntry {
  table: string;
  /** appStore module to navigate to when this result is chosen */
  module: string;
  /** entity-type label used by setFocusEntity + result grouping */
  entityType: string;
  toDoc: (row: any) => IndexDoc;
}

const s = (v: any) => (v == null ? '' : String(v));

export const INDEX_ENTRIES: IndexEntry[] = [
  { table: 'clients', module: 'clients', entityType: 'client',
    toDoc: r => ({ title: s(r.name), subtitle: s(r.email), body: `${s(r.phone)} ${s(r.notes)}` }) },
  { table: 'vendors', module: 'vendors', entityType: 'vendor',
    toDoc: r => ({ title: s(r.name), subtitle: s(r.email), body: `${s(r.phone)} ${s(r.notes)}` }) },
  { table: 'invoices', module: 'invoicing', entityType: 'invoice',
    toDoc: r => ({ title: `Invoice ${s(r.invoice_number)}`, subtitle: s(r.status), body: s(r.notes) }) },
  { table: 'bills', module: 'bills', entityType: 'bill',
    toDoc: r => ({ title: `Bill ${s(r.bill_number)}`, subtitle: s(r.status), body: s(r.notes) }) },
  { table: 'expenses', module: 'expenses', entityType: 'expense',
    toDoc: r => ({ title: s(r.description) || 'Expense', subtitle: s(r.amount), body: s(r.reference) }) },
  { table: 'quotes', module: 'quotes', entityType: 'quote',
    toDoc: r => ({ title: `Quote ${s(r.quote_number)}`, subtitle: s(r.status), body: s(r.notes) }) },
  { table: 'projects', module: 'projects', entityType: 'project',
    toDoc: r => ({ title: s(r.name), subtitle: s(r.status), body: s(r.description) }) },
  { table: 'accounts', module: 'accounts', entityType: 'account',
    toDoc: r => ({ title: s(r.name), subtitle: s(r.account_type), body: s(r.account_number) }) },
  { table: 'employees', module: 'payroll', entityType: 'employee',
    toDoc: r => ({ title: `${s(r.first_name)} ${s(r.last_name)}`.trim(), subtitle: s(r.email), body: s(r.title) }) },
  { table: 'debts', module: 'debt-collection', entityType: 'debt',
    toDoc: r => ({ title: s(r.debtor_name), subtitle: s(r.status), body: s(r.reference) }) },
  { table: 'purchase_orders', module: 'purchase-orders', entityType: 'purchase_order',
    toDoc: r => ({ title: `PO ${s(r.po_number)}`, subtitle: s(r.status), body: s(r.notes) }) },
  { table: 'payments', module: 'invoicing', entityType: 'payment',
    toDoc: r => ({ title: `Payment ${s(r.reference) || s(r.id).slice(0, 8)}`, subtitle: s(r.amount), body: s(r.method) }) },
];

export const INDEXED_TABLES = new Set(INDEX_ENTRIES.map(e => e.table));
export const entryFor = (table: string) => INDEX_ENTRIES.find(e => e.table === table);
```

Note: before relying on a column (e.g. `bills.bill_number`, `debts.debtor_name`), the implementer must confirm it exists in `schema.sql`; if a real column name differs, fix the mapper (do NOT invent columns — a missing column makes `toDoc` emit empty strings, which is acceptable but wasteful). Confirm each table is in `VALID_TABLES`.

- [ ] **Step 4: Build check.** Run: `npm run build:main` → exit 0.

- [ ] **Step 5: Commit.**

```bash
git add src/main/database/index.ts src/main/services/intelligence/indexConfig.ts
git commit -m "feat(intel): search_index FTS5 table + index config"
```

---

### Task 2: Search index service (TDD via .cjs)

**Files:**
- Create: `src/main/services/intelligence/searchIndex.ts`
- Create: `scripts/test-search-index.cjs`
- Modify: `package.json` (scripts: add `test:search`)

- [ ] **Step 1: Write the service** `searchIndex.ts`. Pure functions take an explicit `Database` handle (so the test can pass an in-memory DB; production callers pass `db.getDb()`).

```ts
import type { Database } from 'better-sqlite3';
import { INDEX_ENTRIES, entryFor, type IndexEntry } from './indexConfig';

export interface SearchHit {
  entity_type: string;
  entity_id: string;
  title: string;
  subtitle: string;
  score: number;
}

/** Create the FTS5 table if missing (used by tests; prod uses the migration). */
export function ensureSearchIndex(d: Database): void {
  d.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
    entity_type UNINDEXED, entity_id UNINDEXED, company_id UNINDEXED,
    title, subtitle, body, tokenize = 'porter unicode61')`);
}

function removeRow(d: Database, table: string, id: string): void {
  const e = entryFor(table);
  if (!e) return;
  d.prepare(`DELETE FROM search_index WHERE entity_type = ? AND entity_id = ?`).run(e.entityType, id);
}

/** Re-index a single row by reading it back from its source table. */
export function reindexEntity(d: Database, table: string, id: string): void {
  const e = entryFor(table);
  if (!e) return;
  removeRow(d, table, id);
  const row: any = d.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) return; // deleted or missing → stays removed
  // Skip soft-deleted rows so they leave search.
  if (row.deleted_at != null && row.deleted_at !== '') return;
  const doc = e.toDoc(row);
  d.prepare(`INSERT INTO search_index(entity_type, entity_id, company_id, title, subtitle, body)
             VALUES(?,?,?,?,?,?)`)
    .run(e.entityType, id, String(row.company_id ?? ''), doc.title, doc.subtitle, doc.body);
}

export function removeFromIndex(d: Database, table: string, id: string): void {
  removeRow(d, table, id);
}

/** Full (re)build for one company across all indexed tables. Idempotent. */
export function backfillCompany(d: Database, companyId: string): number {
  let n = 0;
  for (const e of INDEX_ENTRIES) {
    let rows: any[] = [];
    try { rows = d.prepare(`SELECT id FROM ${e.table} WHERE company_id = ?`).all(companyId) as any[]; }
    catch { continue; } // table may not exist in a given build — skip
    for (const r of rows) { reindexEntity(d, e.table, r.id); n++; }
  }
  return n;
}

/** Escape an FTS5 query: wrap each term as a prefix match, drop FTS operators. */
function toMatch(query: string): string {
  const terms = query.toLowerCase().replace(/["*()]/g, ' ').split(/\s+/).filter(Boolean);
  if (!terms.length) return '';
  return terms.map(t => `"${t}"*`).join(' ');
}

export function search(d: Database, companyId: string, query: string, limit = 20): SearchHit[] {
  const match = toMatch(query);
  if (!match) return [];
  const rows = d.prepare(
    `SELECT entity_type, entity_id, title, subtitle, bm25(search_index) AS rank
     FROM search_index
     WHERE company_id = ? AND search_index MATCH ?
     ORDER BY rank LIMIT ?`
  ).all(companyId, match, limit) as any[];
  return rows.map(r => ({
    entity_type: r.entity_type, entity_id: r.entity_id,
    title: r.title, subtitle: r.subtitle, score: -r.rank, // bm25 lower=better → negate
  }));
}
```

- [ ] **Step 2: Write the failing test** `scripts/test-search-index.cjs` (mirrors `test-loan-calculator.cjs` style — loads compiled `dist/` output, uses in-memory DB).

```js
// Dependency-free assertion tests for the FTS5 search index service.
// Run with: npm run test:search  (builds main first, then executes against dist/).
const assert = require('node:assert');
const path = require('node:path');
const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));

const svc = require(path.join(__dirname, '..', 'dist', 'main', 'main', 'services', 'intelligence', 'searchIndex.js'));
const { ensureSearchIndex, reindexEntity, removeFromIndex, backfillCompany, search } = svc;

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`  ✓ ${name}`); };

function freshDb() {
  const d = new Database(':memory:');
  d.exec(`CREATE TABLE clients (id TEXT PRIMARY KEY, company_id TEXT, name TEXT, email TEXT, phone TEXT, notes TEXT, deleted_at TEXT)`);
  d.exec(`CREATE TABLE invoices (id TEXT PRIMARY KEY, company_id TEXT, invoice_number TEXT, status TEXT, notes TEXT, deleted_at TEXT)`);
  ensureSearchIndex(d);
  return d;
}

console.log('search-index tests\n');

test('indexes a client and finds it by name prefix', () => {
  const d = freshDb();
  d.prepare(`INSERT INTO clients(id,company_id,name,email) VALUES(?,?,?,?)`).run('c1', 'co1', 'Acme Corp', 'a@acme.com');
  reindexEntity(d, 'clients', 'c1');
  const hits = search(d, 'co1', 'acm', 10);
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].entity_type, 'client');
  assert.strictEqual(hits[0].entity_id, 'c1');
});

test('scopes results by company', () => {
  const d = freshDb();
  d.prepare(`INSERT INTO clients(id,company_id,name) VALUES(?,?,?)`).run('c1', 'co1', 'Acme');
  d.prepare(`INSERT INTO clients(id,company_id,name) VALUES(?,?,?)`).run('c2', 'co2', 'Acme');
  reindexEntity(d, 'clients', 'c1');
  reindexEntity(d, 'clients', 'c2');
  assert.strictEqual(search(d, 'co1', 'acme', 10).length, 1);
});

test('reindex reflects updates and removes stale text', () => {
  const d = freshDb();
  d.prepare(`INSERT INTO clients(id,company_id,name) VALUES(?,?,?)`).run('c1', 'co1', 'Globex');
  reindexEntity(d, 'clients', 'c1');
  d.prepare(`UPDATE clients SET name=? WHERE id=?`).run('Initech', 'c1');
  reindexEntity(d, 'clients', 'c1');
  assert.strictEqual(search(d, 'co1', 'globex', 10).length, 0);
  assert.strictEqual(search(d, 'co1', 'initech', 10).length, 1);
});

test('soft-deleted rows leave the index', () => {
  const d = freshDb();
  d.prepare(`INSERT INTO clients(id,company_id,name,deleted_at) VALUES(?,?,?,?)`).run('c1', 'co1', 'Acme', null);
  reindexEntity(d, 'clients', 'c1');
  d.prepare(`UPDATE clients SET deleted_at=datetime('now') WHERE id=?`).run('c1');
  reindexEntity(d, 'clients', 'c1');
  assert.strictEqual(search(d, 'co1', 'acme', 10).length, 0);
});

test('removeFromIndex deletes the row', () => {
  const d = freshDb();
  d.prepare(`INSERT INTO clients(id,company_id,name) VALUES(?,?,?)`).run('c1', 'co1', 'Acme');
  reindexEntity(d, 'clients', 'c1');
  removeFromIndex(d, 'clients', 'c1');
  assert.strictEqual(search(d, 'co1', 'acme', 10).length, 0);
});

test('backfillCompany indexes all existing rows', () => {
  const d = freshDb();
  d.prepare(`INSERT INTO clients(id,company_id,name) VALUES(?,?,?)`).run('c1', 'co1', 'Acme');
  d.prepare(`INSERT INTO invoices(id,company_id,invoice_number,status) VALUES(?,?,?,?)`).run('i1', 'co1', '1024', 'open');
  const n = backfillCompany(d, 'co1');
  assert.ok(n >= 2);
  assert.strictEqual(search(d, 'co1', '1024', 10).length, 1);
});

console.log(`\n${passed} passed`);
```

- [ ] **Step 3: Add the npm script.** In `package.json` `scripts`, add: `"test:search": "npm run build:main && node scripts/test-search-index.cjs"`.

- [ ] **Step 4: Run — verify it FAILS first** (service not yet compiled / before writing it, the require throws). If you wrote the service in Step 1 already, this step instead verifies PASS. Run: `npm run test:search`.
Expected after service exists: `6 passed`.

- [ ] **Step 5: Make it pass.** Fix any column/assumption mismatches until `npm run test:search` prints `6 passed`.

- [ ] **Step 6: Commit.**

```bash
git add src/main/services/intelligence/searchIndex.ts scripts/test-search-index.cjs package.json
git commit -m "feat(intel): FTS5 search index service + assertion tests"
```

---

### Task 3: Wire incremental index sync at the mutation choke point

**Files:**
- Modify: `src/main/ipc/index.ts` (`db:create` ~L761, `db:update` ~L826, `db:delete` ~L790s)

- [ ] **Step 1: Add a debounced reindex helper** near the top of the IPC module (after imports, alongside `scheduleAutoBackup`). Import the service and config:

```ts
import { reindexEntity, removeFromIndex } from '../services/intelligence/searchIndex';
import { INDEXED_TABLES } from '../services/intelligence/indexConfig';

// Coalesce rapid re-index calls per (table,id) onto a microtask-ish timer so
// bulk writes don't thrash FTS. Best-effort; never throws into the write path.
const reindexTimers = new Map<string, NodeJS.Timeout>();
function scheduleReindex(table: string, id: string, op: 'upsert' | 'delete'): void {
  if (!INDEXED_TABLES.has(table)) return;
  const key = `${table}:${id}`;
  const existing = reindexTimers.get(key);
  if (existing) clearTimeout(existing);
  reindexTimers.set(key, setTimeout(() => {
    reindexTimers.delete(key);
    try {
      const d = db.getDb();
      if (op === 'delete') removeFromIndex(d, table, id);
      else reindexEntity(d, table, id);
    } catch (e) { console.warn('[search-index] reindex failed', table, id, e); }
  }, 150));
}
```

- [ ] **Step 2: Call it in `db:create`.** Right after `if (companyId) db.logAudit(companyId, table, record.id, 'create');` (~L762):

```ts
      scheduleReindex(table, record.id as string, 'upsert');
```

- [ ] **Step 3: Call it in `db:update`.** After the audit-log block in `db:update` (after `db.logAudit(companyId, table, id, 'update', changes)`):

```ts
      scheduleReindex(table, id, 'upsert');
```

(A soft-delete is an update that sets `deleted_at`; `reindexEntity` already drops such rows.)

- [ ] **Step 4: Call it in `db:delete`.** After `db.remove(table, id);`:

```ts
      scheduleReindex(table, id, 'delete');
```

- [ ] **Step 5: Build check.** Run: `npm run build:main` → exit 0.

- [ ] **Step 6: Commit.**

```bash
git add src/main/ipc/index.ts
git commit -m "feat(intel): keep search index fresh at the db mutation choke point"
```

---

### Task 4: Search + backfill IPC; rewrite `search:global` to delegate

**Files:**
- Modify: `src/main/ipc/index.ts` (new `search:index`, `search:backfill`; rewrite `search:global` ~L4635)
- Modify: `src/renderer/lib/api.ts` (wrappers)

- [ ] **Step 1: Add `search:index` and `search:backfill` handlers** (near the existing `search:global` at L4635):

```ts
  ipcMain.handle('search:index', (_e, { query, limit }: { query: string; limit?: number }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId || !query) return [];
    try {
      const { search } = require('../services/intelligence/searchIndex');
      return search(db.getDb(), companyId, query, Math.min(limit || 20, 50));
    } catch (e) { console.warn('[search:index] failed', e); return []; }
  });

  ipcMain.handle('search:backfill', () => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId) return { indexed: 0 };
    try {
      const { backfillCompany } = require('../services/intelligence/searchIndex');
      return { indexed: backfillCompany(db.getDb(), companyId) };
    } catch (e) { console.warn('[search:backfill] failed', e); return { indexed: 0, error: String(e) }; }
  });
```

- [ ] **Step 2: Rewrite `search:global`** to delegate (back-compat shape `{ type, id, title, subtitle }`). Replace the existing handler body (L4635-4675) with:

```ts
  ipcMain.handle('search:global', (_event, query) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId || !query || String(query).length > 200) return [];
    try {
      const { search } = require('../services/intelligence/searchIndex');
      return search(db.getDb(), companyId, String(query), 20).map((h: any) => ({
        type: h.entity_type, id: h.entity_id, title: h.title, subtitle: h.subtitle || '',
      }));
    } catch (e) { console.warn('[search:global] failed', e); return []; }
  });
```

- [ ] **Step 3: Add renderer wrappers** in `api.ts` near `globalSearch` (L64):

```ts
  searchIndex: (query: string, limit?: number) =>
    window.electronAPI.invoke('search:index', { query, limit }),
  searchBackfill: () => window.electronAPI.invoke('search:backfill'),
```

- [ ] **Step 4: Trigger a one-time backfill on company load.** Find where the renderer sets the active company (grep `companyStore` for `setActiveCompany` / where `activeCompany` is first set after login). Add a fire-and-forget `api.searchBackfill()` call there, guarded so it runs once per session per company (e.g. a `Set<string>` of backfilled company ids in the store or a module-level set in `api` consumer). Keep it non-blocking. If a clean single call site isn't obvious, add it to the existing post-login effect in `App.tsx` that already runs once `authUser` + `activeCompany` are set.

- [ ] **Step 5: Build + manual smoke.** `npm run build` → 0. Manual: `npm run dev`, log in, run `api.searchBackfill()` once (happens automatically), then ⌘K still works via the old path (palette not yet repointed — that's Task 6).

- [ ] **Step 6: Commit.**

```bash
git add src/main/ipc/index.ts src/renderer/lib/api.ts
git commit -m "feat(intel): search:index + backfill IPC; search:global delegates to FTS"
```

---

### Task 5: Action registry (shared) + role-checked invoke

**Files:**
- Create: `src/shared/action-registry.ts`
- Modify: `src/main/ipc/index.ts` (new `action:invoke`)
- Modify: `src/renderer/lib/api.ts` (wrapper)

- [ ] **Step 1: Create `src/shared/action-registry.ts`** — typed catalog. Navigation actions carry a `module` (+ optional focus); mutation actions carry a `mutate` id resolved in the main process.

```ts
export type Role = 'owner' | 'admin' | 'accountant' | 'viewer';

export interface AppAction {
  id: string;
  label: string;
  keywords: string[];
  /** 'navigate' actions run in the renderer; 'mutate' actions run in main via action:invoke */
  kind: 'navigate' | 'mutate';
  module?: string;            // for navigate
  requiredRole?: Role;        // for mutate (default: any logged-in user)
}

// Role rank for permission checks (higher = more privileged).
export const ROLE_RANK: Record<Role, number> = { viewer: 0, accountant: 1, admin: 2, owner: 3 };

// Navigation actions migrated from CommandPaletteCommands.ts (same ids/modules).
export const NAV_ACTIONS: AppAction[] = [
  { id: 'goto.dashboard', label: 'Go to Dashboard', keywords: ['home', 'dashboard'], kind: 'navigate', module: 'dashboard' },
  { id: 'invoice.create', label: 'Create New Invoice', keywords: ['new', 'invoice'], kind: 'navigate', module: 'invoicing' },
  { id: 'expense.create', label: 'Create New Expense', keywords: ['new', 'expense'], kind: 'navigate', module: 'expenses' },
  { id: 'client.createForm', label: 'Add Client', keywords: ['new', 'client'], kind: 'navigate', module: 'clients' },
  { id: 'reports.profit-loss', label: 'Open Profit & Loss', keywords: ['p&l', 'pl', 'income'], kind: 'navigate', module: 'reports' },
  // … the implementer migrates ALL 45 entries from CommandPaletteCommands.ts here, preserving id + module.
];

// First mutation actions — small, safe set. Money-moving stays proposal-only (navigate).
export const MUTATE_ACTIONS: AppAction[] = [
  { id: 'invoice.markPaid', label: 'Mark Invoice Paid…', keywords: ['mark', 'paid', 'invoice'], kind: 'mutate', requiredRole: 'accountant' },
  { id: 'client.create', label: 'Create Client (quick)', keywords: ['quick', 'add', 'client'], kind: 'mutate', requiredRole: 'accountant' },
];

export const ALL_ACTIONS: AppAction[] = [...NAV_ACTIONS, ...MUTATE_ACTIONS];

/** Lightweight keyword/label fuzzy match for the palette. */
export function findActions(query: string): AppAction[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return ALL_ACTIONS.filter(a =>
    a.label.toLowerCase().includes(q) || a.keywords.some(k => k.includes(q)) || a.id.includes(q)
  ).slice(0, 8);
}
```

(The implementer MUST migrate all 45 nav entries from `CommandPaletteCommands.ts` verbatim by id + module; the 5 shown are examples. Cross-check each `module` value against `App.tsx`'s switch so navigation still resolves.)

- [ ] **Step 2: Add `action:invoke` handler** in `ipc/index.ts`. It enforces role in the main process and dispatches mutation actions. Params are validated per action.

```ts
  ipcMain.handle('action:invoke', (_e, { actionId, params }: { actionId: string; params?: any }) => {
    const companyId = db.getCurrentCompanyId();
    const userId = db.getCurrentUserId();
    if (!companyId || !userId) return { error: 'Not authenticated' };
    const { MUTATE_ACTIONS, ROLE_RANK } = require('../../shared/action-registry');
    const action = MUTATE_ACTIONS.find((a: any) => a.id === actionId);
    if (!action) return { error: 'Unknown or non-mutating action' };
    // Role check — never trust the renderer.
    const userRow: any = db.runQuery('SELECT role FROM users WHERE id = ?', [userId])[0];
    const role = (userRow?.role || 'viewer');
    if (action.requiredRole && (ROLE_RANK[role] ?? 0) < ROLE_RANK[action.requiredRole]) {
      return { error: `Requires ${action.requiredRole} role` };
    }
    try {
      let result: any;
      if (actionId === 'invoice.markPaid') {
        if (!params?.invoiceId) return { error: 'invoiceId required' };
        result = db.update('invoices', params.invoiceId, { status: 'paid' });
        db.logAudit(companyId, 'invoices', params.invoiceId, 'update', { status: { new: 'paid' } });
      } else if (actionId === 'client.create') {
        if (!params?.name) return { error: 'name required' };
        result = db.create('clients', { company_id: companyId, name: params.name, email: params.email || '' });
        db.logAudit(companyId, 'clients', result.id, 'create');
      } else {
        return { error: 'No handler' };
      }
      scheduleReindex(actionId.startsWith('invoice') ? 'invoices' : 'clients',
        (params.invoiceId || result.id), 'upsert');
      scheduleAutoBackup();
      return { ok: true, result };
    } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  });
```

(Note: `scheduleReindex` is defined in Task 3 in the same module — reference it directly.)

- [ ] **Step 3: Add the renderer wrapper** in `api.ts`:

```ts
  invokeAction: (actionId: string, params?: any) =>
    window.electronAPI.invoke('action:invoke', { actionId, params }),
```

- [ ] **Step 4: Build check.** `npm run build` → 0.

- [ ] **Step 5: Commit.**

```bash
git add src/shared/action-registry.ts src/main/ipc/index.ts src/renderer/lib/api.ts
git commit -m "feat(intel): shared action registry + role-checked action:invoke"
```

---

### Task 6: Repoint the Command Palette at the Core

**Files:**
- Modify: `src/renderer/components/CommandPalette.tsx`
- Modify: `src/renderer/components/CommandPaletteCommands.ts` (becomes thin shim)

- [ ] **Step 1: Replace the entity-search effect** (L44-62) to use `api.searchIndex` instead of the 3-table raw SQL:

```tsx
  useEffect(() => {
    if (!query.trim() || !activeCompany) { setEntities([]); return; }
    const q = query.trim();
    if (q.length < 2) { setEntities([]); return; }
    let cancelled = false;
    api.searchIndex(q, 12).then((rows: any[]) => {
      if (!cancelled) setEntities(Array.isArray(rows) ? rows.map(r => ({
        type: r.entity_type, id: r.entity_id, label: r.title, subtitle: r.subtitle,
      })) : []);
    }).catch(() => { if (!cancelled) setEntities([]); });
    return () => { cancelled = true; };
  }, [query, activeCompany]);
```

- [ ] **Step 2: Point command matching at the registry.** Change the import at L8 from `CommandPaletteCommands` to the shared registry and adapt `findCommands` usage. Replace L8 and the `cmds` line (L67):

```tsx
import { findActions, type AppAction } from '../../shared/action-registry';
```
```tsx
    const cmds: SearchResult[] = findActions(query).map(c => ({ type: 'command' as const, command: c as any }));
```

Update `SearchResult.command` typing to `AppAction` and `executeResult`'s command branch (L96-105):

```tsx
    if (r.type === 'command' && r.command) {
      const a = r.command as AppAction;
      if (a.kind === 'navigate' && a.module) {
        setModule(a.module);
      } else if (a.kind === 'mutate') {
        // B1: mutation actions that need params open their module form (proposal-first).
        // Param-less safe mutations could call api.invokeAction(a.id) here in a later pass.
        if (a.module) setModule(a.module);
      }
      try { await api.logCommandExecution({ command_id: a.id, params: {}, result: 'success', duration_ms: performance.now() - t0 }); } catch {}
    }
```

(Keep the entity and parsed branches as-is, but extend the entity `moduleMap` to cover the new types: add `bill: 'bills', account: 'accounts', employee: 'payroll', project: 'projects', purchase_order: 'purchase-orders', payment: 'invoicing'`.)

- [ ] **Step 3: Convert `CommandPaletteCommands.ts` to a shim** so any other importer keeps working: re-export from the registry.

```ts
// Back-compat shim — the command catalog now lives in src/shared/action-registry.ts.
import { NAV_ACTIONS, findActions } from '../../shared/action-registry';
export const RENDERER_COMMANDS = NAV_ACTIONS;
export const findCommands = findActions;
export type RendererCommand = typeof NAV_ACTIONS[number];
```

(First grep for other importers of `CommandPaletteCommands`; if none beyond the palette, you may delete it instead and drop the palette's old import. The shim is the safe default.)

- [ ] **Step 4: Build + leak check.** `npm run build` → 0; `bash scripts/ui-leak-check.sh` → counts not rising.

- [ ] **Step 5: Manual verification.** `npm run dev`: ⌘K opens; typing a client/vendor/invoice/employee name returns grouped results across the new types; Enter on an entity navigates + focuses; Enter on a command navigates; recent commands still show.

- [ ] **Step 6: Commit.**

```bash
git add src/renderer/components/CommandPalette.tsx src/renderer/components/CommandPaletteCommands.ts
git commit -m "feat(intel): palette uses FTS search index + shared action registry"
```

---

### Task 7: Inline intelligence hints in the palette

**Files:**
- Modify: `src/main/ipc/index.ts` (new `intelligence:entity-hint`)
- Modify: `src/main/services/IntelligenceService.ts` (add `entityHint` if a clean home; else inline in handler)
- Modify: `src/renderer/components/CommandPalette.tsx`

- [ ] **Step 1: Add `intelligence:entity-hint` handler.** Returns a short string for an entity, or `''`.

```ts
  ipcMain.handle('intelligence:entity-hint', (_e, { entityType, id }: { entityType: string; id: string }) => {
    const companyId = db.getCurrentCompanyId();
    if (!companyId || !id) return '';
    try {
      if (entityType === 'client') {
        const row: any = db.runQuery(
          `SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS amt FROM invoices
           WHERE company_id = ? AND client_id = ? AND status NOT IN ('paid','void','draft')
             AND COALESCE(due_date,'') <> '' AND date(due_date) < date('now')`,
          [companyId, id])[0];
        if (row?.n > 0) return `${row.n} overdue invoice${row.n > 1 ? 's' : ''} ($${Math.round(row.amt).toLocaleString()})`;
      } else if (entityType === 'vendor') {
        const row: any = db.runQuery(
          `SELECT COUNT(*) AS n FROM expenses WHERE company_id = ? AND vendor_id = ?
             AND COALESCE(deleted_at,'') = '' AND instr(COALESCE(tags,''),'anomaly') > 0`,
          [companyId, id])[0];
        if (row?.n > 0) return `${row.n} flagged charge${row.n > 1 ? 's' : ''}`;
      }
      return '';
    } catch { return ''; }
  });
```

(Before relying on `invoices.client_id` / `invoices.due_date` / `invoices.total` / `expenses.vendor_id`, confirm those columns in `schema.sql`; adjust names if needed. Keep it best-effort — any miss returns `''`.)

- [ ] **Step 2: Add the wrapper** in `api.ts`:

```ts
  entityHint: (entityType: string, id: string) =>
    window.electronAPI.invoke('intelligence:entity-hint', { entityType, id }),
```

- [ ] **Step 3: Fetch + render hints in the palette.** After entities load, fetch hints for the visible entity rows and display them inline (append to the entity subtitle, in `text-accent-warning`). Add state + effect:

```tsx
  const [hints, setHints] = useState<Record<string, string>>({});
  useEffect(() => {
    const targets = entities.filter(e => e.type === 'client' || e.type === 'vendor');
    if (!targets.length) { return; }
    let cancelled = false;
    Promise.all(targets.map(e =>
      api.entityHint(e.type, e.id).then((h: string) => [`${e.type}:${e.id}`, h] as const).catch(() => [`${e.type}:${e.id}`, ''] as const)
    )).then(pairs => { if (!cancelled) setHints(Object.fromEntries(pairs.filter(p => p[1]))); });
    return () => { cancelled = true; };
  }, [entities]);
```

In the entity `ResultRow`, when a hint exists for `${entity.type}:${entity.id}`, render it as a small `text-accent-warning` span after the subtitle. (Pass the hint into `ResultRow` via a new optional `badge` prop rendered with token color only — no raw hex.)

- [ ] **Step 4: Build + leak check + manual.** `npm run build` → 0; leak check flat. Manual: searching a client with overdue invoices shows the amber hint inline.

- [ ] **Step 5: Commit.**

```bash
git add src/main/ipc/index.ts src/renderer/lib/api.ts src/renderer/components/CommandPalette.tsx
git commit -m "feat(intel): inline entity intelligence hints in the command palette"
```

---

### Task 8: B1 wrap-up

- [ ] **Step 1:** `npm run test:search` → `6 passed`.
- [ ] **Step 2:** `npm run build` → 0; `bash scripts/ui-leak-check.sh` → counts not above baseline.
- [ ] **Step 3: Manual end-to-end.** Create a new client → it appears in ⌘K search within ~1s (incremental index). Edit its name → search reflects it. Soft-delete (void) an expense → it leaves search. Mark an invoice paid via the registry path (or confirm the role gate blocks a viewer). Inline hint shows for an overdue client.
- [ ] **Step 4: Push.** `git push` (PR #23 is a different branch — create/confirm the working branch first; if this work is on the same branch, just push).

---

## Notes for implementers

- **FTS5 is confirmed available** in this better-sqlite3 build.
- **Never throw into the write path** — `scheduleReindex` is best-effort and wrapped in try/catch; a failed index update must never fail a `db:create`.
- **Money never moves headlessly in B1.** `invoice.markPaid` is a status change (reversible, audited), explicitly allowed; anything that creates a payment/transfer stays navigate-only.
- **Role checks live in main** (`action:invoke`), never the renderer.
- **Theme:** token classes only (`text-accent-warning`, `text-text-*`, `bg-bg-*`), `var(--app-radius)`, `.block-*`. No raw hex.
- **Column-name caution:** several `toDoc` mappers and the hint SQL reference columns that must be confirmed against `schema.sql` first; a wrong name degrades gracefully (empty text) but should be fixed when spotted.
- B2 (Cockpit) and B3 (Copilot) get their own plans after B1 ships.
