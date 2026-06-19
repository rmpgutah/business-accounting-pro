# B2 — Intelligence Cockpit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `cockpit` module: a configurable widget home where the user arranges drag/resizable cards (KPIs, cash forecast, anomaly feed, AR/AP aging, top clients) on a grid whose layout persists per user+company.

**Architecture:** A 12-column CSS-grid canvas renders widgets from a layout array `{id, type, x, y, w, h}`. A Zustand `cockpitLayoutStore` (mirroring `personalizationStore`) holds the layout, persists to localStorage instantly and to the `settings` table (`cockpit-layout:<userId>:<companyId>`) via `api.getSetting/setSetting`. Each widget type is an entry in a widget registry that pairs a renderer component with a data loader calling existing `api.*` intelligence/report wrappers. Drag (native HTML5 DnD on the widget header) and resize (mouse-drag a corner handle) mutate the layout through pure grid-math helpers. No new dependencies.

**Tech Stack:** React 19 + TypeScript, Zustand (+persist), Recharts 3.8 (already present) + hand-rolled SVG, Warm Structured Glass tokens, `src/renderer/lib/chart-palette.ts` for chart hex.

**Spec:** `docs/superpowers/specs/2026-06-13-command-intelligence-layer-design.md` (B2 section). Depends on B1 (merged or on this branch).

**Testing convention:** pure grid math → `scripts/test-cockpit-layout.cjs` (repo `.cjs` idiom). UI → `npm run build` + `bash scripts/ui-leak-check.sh` + manual dev-app.

**Verified facts:**
- Module registration = 3 edits: `App.tsx` (lazy import + `MODULE_NAMES` entry + `ModuleView` switch case), `src/renderer/components/layout/Sidebar.tsx` (sections array entry — `{id,label,icon}` items). `appStore.setModule(string)` needs no change.
- **Deviation from spec (intentional):** the spec said "layout persisted in a new `dashboard_layouts` table." Recon shows the existing `settings` table + `api.getSetting/setSetting` is cleaner — no migration, and it mirrors the proven `personalizationStore` cloud pattern. This plan uses `settings` (key `cockpit-layout:<userId>:<companyId>`) instead of a new table. Same per-user+company persistence, less surface area.
- Persistence: `api.getSetting(key)` (api.ts:399) / `api.setSetting(key,value)` (api.ts:401) → `settings:get`/`settings:set` (ipc:7164/7174); `settings` table is `(company_id, key UNIQUE, value)`. `personalizationStore` is the persist template (`saveToCloud`/`loadFromCloud`).
- Data wrappers that EXIST: `api.dashboardStats(startDate,endDate)` (:58), `api.getCashProjection(days)` (:540, intelligence:cash-projection), `api.getAnomalies()` (intelligence:anomalies), `api.reportArAging(asOfDate)` (:411), `api.reportApAging(asOfDate)` (:413), `api.rptKpiCurrent(key)` (:3199). `api.rawQuery(sql,params)` for top-clients.
- Charts: `src/renderer/lib/chart-palette.ts` exports `CHART_INCOME`, `CHART_EXPENSE`, `CHART_NEUTRAL`, `CHART_SERIES[]`, a severity ramp. Recharts pattern: `ResponsiveContainer` + `AreaChart`. Hand-rolled SVG sparkline pattern in `modules/expenses/ExpenseVizCharts.tsx`.
- Theme: `.block-card` + `border-l-4 border-l-accent-{income|expense|warning|blue}`, `var(--app-radius)`, `text-text-*`, `text-accent-*`. KPI tile pattern in `components/KpiTile.tsx`.
- DnD precedent: native `draggable`/`onDragStart/Over/Drop` (e.g. `PersonalizationSettings.tsx`); no grid/dnd library in package.json — hand-roll.

**Scope guard (v1 / YAGNI):** single grid (no multi-tab), free placement with bounds-clamping (no auto-compaction/collision resolution — user arranges), fixed widget catalog below. Multi-tab + auto-layout are explicitly out of scope.

---

### Task 1: Grid math helpers (TDD via .cjs)

**Files:**
- Create: `src/renderer/modules/cockpit/layout-utils.ts`
- Create: `scripts/test-cockpit-layout.cjs`
- Modify: `package.json` (script `test:cockpit`)

- [ ] **Step 1: Write `layout-utils.ts`** — pure, dependency-free.

```ts
export const GRID_COLS = 12;
export interface WidgetPlacement { id: string; type: string; x: number; y: number; w: number; h: number; }

/** Clamp a placement to the grid: x in [0, COLS-w], w in [1, COLS], y,h >= 0/1. */
export function clampPlacement(p: WidgetPlacement, cols = GRID_COLS): WidgetPlacement {
  const w = Math.max(1, Math.min(p.w, cols));
  const x = Math.max(0, Math.min(p.x, cols - w));
  const h = Math.max(1, p.h);
  const y = Math.max(0, p.y);
  return { ...p, x, w, y, h };
}

/** Pixel offset → grid cell, given the canvas content width and current cols. */
export function pixelToCell(px: number, py: number, canvasW: number, rowH: number, cols = GRID_COLS): { x: number; y: number } {
  const cellW = canvasW / cols;
  return { x: Math.max(0, Math.round(px / cellW)), y: Math.max(0, Math.round(py / rowH)) };
}

/** First free row at full width for a new widget: place below the lowest occupied cell. */
export function nextFreeRow(layout: WidgetPlacement[]): number {
  return layout.reduce((max, p) => Math.max(max, p.y + p.h), 0);
}

/** Add a widget of `type` (default size) at the bottom; returns a new layout. */
export function addWidget(layout: WidgetPlacement[], type: string, id: string, w = 4, h = 2): WidgetPlacement[] {
  return [...layout, clampPlacement({ id, type, x: 0, y: nextFreeRow(layout), w, h })];
}

export function removeWidget(layout: WidgetPlacement[], id: string): WidgetPlacement[] {
  return layout.filter(p => p.id !== id);
}

export function updatePlacement(layout: WidgetPlacement[], id: string, patch: Partial<WidgetPlacement>): WidgetPlacement[] {
  return layout.map(p => (p.id === id ? clampPlacement({ ...p, ...patch }) : p));
}
```

- [ ] **Step 2: Write the failing test** `scripts/test-cockpit-layout.cjs`.

```js
// Pure grid-math tests for the cockpit layout. Run: npm run test:cockpit
const assert = require('node:assert');
const path = require('node:path');
// layout-utils is renderer TS — compile-free import via ts? No: test the compiled copy.
// Vite compiles the renderer, not tsc. So we transpile-on-the-fly with a tiny require hook:
// simplest path — the file is pure TS with types only; strip types by requiring the .ts through esbuild is overkill.
// Instead: keep layout-utils ALSO importable as plain JS by avoiding TS-only syntax beyond type annotations,
// and load it via the project's tsx/esbuild. Easiest portable approach: shell out to tsc for this one file.
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-'));
execSync(`npx tsc src/renderer/modules/cockpit/layout-utils.ts --outDir ${outDir} --module commonjs --target ES2022 --skipLibCheck`, { stdio: 'inherit' });
const u = require(path.join(outDir, 'layout-utils.js'));

let passed = 0;
const test = (n, f) => { f(); passed++; console.log(`  ✓ ${n}`); };
console.log('cockpit-layout tests\n');

test('clampPlacement keeps widgets in bounds', () => {
  assert.deepStrictEqual(u.clampPlacement({ id: 'a', type: 't', x: 11, y: -2, w: 6, h: 0 }), { id: 'a', type: 't', x: 6, y: 0, w: 6, h: 1 });
});
test('clampPlacement caps width to grid', () => {
  assert.strictEqual(u.clampPlacement({ id: 'a', type: 't', x: 0, y: 0, w: 99, h: 2 }).w, u.GRID_COLS);
});
test('nextFreeRow returns 0 for empty layout', () => {
  assert.strictEqual(u.nextFreeRow([]), 0);
});
test('nextFreeRow returns below lowest widget', () => {
  assert.strictEqual(u.nextFreeRow([{ id: 'a', type: 't', x: 0, y: 0, w: 4, h: 2 }, { id: 'b', type: 't', x: 4, y: 3, w: 4, h: 1 }]), 4);
});
test('addWidget places new widget at the bottom full-defaults', () => {
  const out = u.addWidget([{ id: 'a', type: 't', x: 0, y: 0, w: 12, h: 2 }], 'kpi', 'b');
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[1].y, 2);
});
test('removeWidget drops by id', () => {
  assert.strictEqual(u.removeWidget([{ id: 'a', type: 't', x: 0, y: 0, w: 4, h: 2 }], 'a').length, 0);
});
test('updatePlacement patches + re-clamps', () => {
  const out = u.updatePlacement([{ id: 'a', type: 't', x: 0, y: 0, w: 4, h: 2 }], 'a', { x: 99 });
  assert.strictEqual(out[0].x, u.GRID_COLS - 4);
});
test('pixelToCell maps offset to grid', () => {
  // canvas 1200px / 12 cols = 100px per col; 250px → col 3 (rounded)
  assert.strictEqual(u.pixelToCell(250, 0, 1200, 80).x, 3);
});

console.log(`\n${passed} passed`);
```

- [ ] **Step 3: Add script.** In `package.json` scripts: `"test:cockpit": "node scripts/test-cockpit-layout.cjs"`.

- [ ] **Step 4: Run — expect PASS** (`8 passed`). Run: `npm run test:cockpit`. If the on-the-fly `tsc` invocation is slow or flaky, the implementer may instead point the test at the Vite-built output — but the inline-tsc approach is self-contained. Fix until `8 passed`.

- [ ] **Step 5: Commit.**

```bash
git add src/renderer/modules/cockpit/layout-utils.ts scripts/test-cockpit-layout.cjs package.json
git commit -m "feat(cockpit): grid layout math + tests"
```

---

### Task 2: Layout store with settings-table persistence

**Files:**
- Create: `src/renderer/modules/cockpit/cockpitLayoutStore.ts`

- [ ] **Step 1: Write the store**, mirroring `personalizationStore`'s cloud pattern. Default layout = a sensible starter set.

```ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import api from '../../lib/api';
import { WidgetPlacement, addWidget as addW, removeWidget as removeW, updatePlacement as updateP } from './layout-utils';

const DEFAULT_LAYOUT: WidgetPlacement[] = [
  { id: 'w-kpis', type: 'kpis', x: 0, y: 0, w: 12, h: 2 },
  { id: 'w-cash', type: 'cash-forecast', x: 0, y: 2, w: 6, h: 3 },
  { id: 'w-anom', type: 'anomalies', x: 6, y: 2, w: 6, h: 3 },
  { id: 'w-ar', type: 'ar-aging', x: 0, y: 5, w: 6, h: 3 },
  { id: 'w-top', type: 'top-clients', x: 6, y: 5, w: 6, h: 3 },
];

interface CockpitState {
  layout: WidgetPlacement[];
  editing: boolean;
  setEditing: (v: boolean) => void;
  setLayout: (l: WidgetPlacement[]) => void;
  addWidget: (type: string) => void;
  removeWidget: (id: string) => void;
  updatePlacement: (id: string, patch: Partial<WidgetPlacement>) => void;
  resetLayout: () => void;
  loadFromCloud: (userId: string, companyId: string) => Promise<void>;
  saveToCloud: (userId: string, companyId: string) => Promise<void>;
}

const cloudKey = (u: string, c: string) => `cockpit-layout:${u}:${c}`;

export const useCockpitLayoutStore = create<CockpitState>()(
  persist(
    (set, get) => ({
      layout: DEFAULT_LAYOUT,
      editing: false,
      setEditing: (v) => set({ editing: v }),
      setLayout: (l) => set({ layout: l }),
      addWidget: (type) => set({ layout: addW(get().layout, type, `w-${type}-${get().layout.length}-${(get().layout.reduce((a,p)=>a+p.x+p.y,0))}`) }),
      removeWidget: (id) => set({ layout: removeW(get().layout, id) }),
      updatePlacement: (id, patch) => set({ layout: updateP(get().layout, id, patch) }),
      resetLayout: () => set({ layout: DEFAULT_LAYOUT }),
      loadFromCloud: async (userId, companyId) => {
        try {
          const raw = await api.getSetting(cloudKey(userId, companyId));
          if (!raw) return;
          const data = JSON.parse(raw);
          if (Array.isArray(data?.layout)) set({ layout: data.layout });
        } catch { /* keep current/default */ }
      },
      saveToCloud: async (userId, companyId) => {
        try { await api.setSetting(cloudKey(userId, companyId), JSON.stringify({ layout: get().layout })); }
        catch { /* best effort */ }
      },
    }),
    { name: 'bap-cockpit-layout', partialize: (s) => ({ layout: s.layout }) }
  )
);
```

Note: widget id generation must be deterministic-enough to avoid collisions but **must not use `Math.random()`/`Date.now()`** if this store is ever exercised in a workflow context — here it's renderer-only UI so `Date.now()` is acceptable; the version above derives a suffix from layout length + coordinate sum to stay dependency-free. If collisions ever surface, switch to `crypto.randomUUID()` (renderer has it).

- [ ] **Step 2: Build check.** `npm run build` → exit 0.

- [ ] **Step 3: Commit.**

```bash
git add src/renderer/modules/cockpit/cockpitLayoutStore.ts
git commit -m "feat(cockpit): layout store with settings-table persistence"
```

---

### Task 3: Widget registry + data loaders

**Files:**
- Create: `src/renderer/modules/cockpit/widgets/registry.ts`
- Create: `src/renderer/modules/cockpit/widgets/useWidgetData.ts`

- [ ] **Step 1: Registry** — pairs each widget type with display metadata + an async loader using only confirmed `api.*` wrappers.

```ts
import api from '../../../lib/api';

export interface WidgetDef {
  type: string;
  title: string;
  accent: 'income' | 'expense' | 'warning' | 'blue';
  /** loads the data object the widget renders; must never throw (catch → null) */
  load: (companyId: string) => Promise<any>;
}

const todayISO = () => new Date().toISOString().slice(0, 10);
const ytdStartISO = () => `${new Date().getFullYear()}-01-01`;

export const WIDGET_DEFS: WidgetDef[] = [
  { type: 'kpis', title: 'Key Metrics', accent: 'blue',
    load: () => api.dashboardStats(ytdStartISO(), todayISO()).catch(() => null) },
  { type: 'cash-forecast', title: 'Cash Forecast (90d)', accent: 'income',
    load: () => api.getCashProjection(90).catch(() => null) },
  { type: 'anomalies', title: 'Anomalies', accent: 'warning',
    load: () => api.getAnomalies().catch(() => []) },
  { type: 'ar-aging', title: 'AR Aging', accent: 'income',
    load: () => api.reportArAging(todayISO()).catch(() => null) },
  { type: 'ap-aging', title: 'AP Aging', accent: 'expense',
    load: () => api.reportApAging(todayISO()).catch(() => null) },
  { type: 'top-clients', title: 'Top Clients', accent: 'blue',
    load: (companyId) => api.rawQuery(
      `SELECT c.name, COALESCE(SUM(i.total),0) AS total
       FROM invoices i JOIN clients c ON c.id = i.client_id
       WHERE i.company_id = ? GROUP BY i.client_id ORDER BY total DESC LIMIT 6`,
      [companyId]).catch(() => []) },
];

export const widgetDef = (type: string) => WIDGET_DEFS.find(w => w.type === type);
```

(Before relying on `invoices.client_id`/`invoices.total`, confirm in schema.sql — both were confirmed present in B1's hint work. The aging/forecast wrappers' return shapes are consumed defensively in Task 5's widget bodies.)

- [ ] **Step 2: `useWidgetData` hook** — loads on mount + when company changes, with a manual `refresh`.

```ts
import { useEffect, useState, useCallback } from 'react';
import { useCompanyStore } from '../../../stores/companyStore';
import { widgetDef } from './registry';

export function useWidgetData(type: string) {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    const def = widgetDef(type);
    if (!def || !activeCompany) { setLoading(false); return; }
    setLoading(true);
    Promise.resolve(def.load(activeCompany.id)).then((d) => { setData(d); }).finally(() => setLoading(false));
  }, [type, activeCompany]);
  useEffect(() => { load(); }, [load]);
  return { data, loading, refresh: load };
}
```

- [ ] **Step 3: Build check.** `npm run build` → 0.

- [ ] **Step 4: Commit.**

```bash
git add src/renderer/modules/cockpit/widgets/registry.ts src/renderer/modules/cockpit/widgets/useWidgetData.ts
git commit -m "feat(cockpit): widget registry + data-loader hook"
```

---

### Task 4: Widget components

**Files:**
- Create: `src/renderer/modules/cockpit/widgets/WidgetFrame.tsx`
- Create: `src/renderer/modules/cockpit/widgets/WidgetBody.tsx`

- [ ] **Step 1: `WidgetFrame.tsx`** — the card chrome (title bar with accent strip, drag handle in edit mode, remove button, drill-through click). Theme tokens only.

```tsx
import React from 'react';
import { GripVertical, X, ArrowUpRight } from 'lucide-react';

const ACCENT: Record<string, string> = {
  income: 'border-l-accent-income', expense: 'border-l-accent-expense',
  warning: 'border-l-accent-warning', blue: 'border-l-accent-blue',
};

const WidgetFrame: React.FC<{
  title: string; accent: string; editing: boolean;
  onRemove?: () => void; onOpen?: () => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  children: React.ReactNode;
}> = ({ title, accent, editing, onRemove, onOpen, dragHandleProps, children }) => (
  <div className={`block-card h-full flex flex-col p-0 overflow-hidden border-l-4 ${ACCENT[accent] || 'border-l-accent-blue'}`}
       style={{ borderRadius: 'var(--app-radius)' }}>
    <div className="flex items-center justify-between px-3 py-2 border-b border-border-primary">
      <div className="flex items-center gap-1.5 min-w-0">
        {editing && <div {...dragHandleProps} className="cursor-grab text-text-muted"><GripVertical size={13} /></div>}
        <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider truncate">{title}</span>
      </div>
      <div className="flex items-center gap-1">
        {onOpen && !editing && <button onClick={onOpen} className="text-text-muted hover:text-text-primary"><ArrowUpRight size={13} /></button>}
        {editing && onRemove && <button onClick={onRemove} className="text-text-muted hover:text-accent-expense"><X size={13} /></button>}
      </div>
    </div>
    <div className="flex-1 min-h-0 overflow-auto p-3">{children}</div>
  </div>
);

export default WidgetFrame;
```

- [ ] **Step 2: `WidgetBody.tsx`** — switches on type, renders the data defensively. Reuse `chart-palette` + Recharts/sparklines.

```tsx
import React from 'react';
import { AreaChart, Area, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { CHART_INCOME, CHART_NEUTRAL } from '../../../lib/chart-palette';
import { formatCurrency } from '../../../lib/format';

const Empty = () => <div className="h-full flex items-center justify-center text-xs text-text-muted">No data</div>;

const WidgetBody: React.FC<{ type: string; data: any; loading: boolean }> = ({ type, data, loading }) => {
  if (loading) return <div className="h-full flex items-center justify-center text-xs text-text-muted">Loading…</div>;

  if (type === 'kpis') {
    const s = data || {};
    const tiles = [
      { label: 'Revenue', value: s.revenue, cls: 'text-accent-income' },
      { label: 'Expenses', value: s.expenses, cls: 'text-accent-expense' },
      { label: 'Net', value: (s.revenue || 0) - (s.expenses || 0), cls: 'text-text-primary' },
      { label: 'Outstanding', value: s.outstanding ?? s.outstandingInvoices, cls: 'text-accent-warning' },
    ];
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 h-full">
        {tiles.map(t => (
          <div key={t.label} className="flex flex-col justify-center">
            <div className="text-[10px] text-text-muted uppercase tracking-wider">{t.label}</div>
            <div className={`text-lg font-mono font-bold ${t.cls}`}>{formatCurrency(t.value || 0)}</div>
          </div>
        ))}
      </div>
    );
  }

  if (type === 'cash-forecast') {
    const rows = Array.isArray(data) ? data : (data?.points || data?.series || []);
    if (!rows.length) return <Empty />;
    const chartData = rows.map((r: any) => ({ label: r.date || r.label || '', value: r.predicted ?? r.value ?? r.amount ?? 0 }));
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData}>
          <defs><linearGradient id="cf" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={CHART_INCOME} stopOpacity={0.7} /><stop offset="95%" stopColor={CHART_INCOME} stopOpacity={0} /></linearGradient></defs>
          <XAxis dataKey="label" stroke={CHART_NEUTRAL} tick={{ fontSize: 9 }} hide />
          <YAxis stroke={CHART_NEUTRAL} tick={{ fontSize: 9 }} width={36} />
          <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
          <Area type="monotone" dataKey="value" stroke={CHART_INCOME} fill="url(#cf)" />
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  if (type === 'anomalies') {
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) return <div className="h-full flex items-center justify-center text-xs text-accent-income">No anomalies</div>;
    return (
      <ul className="space-y-1.5">
        {rows.slice(0, 6).map((a: any, i: number) => (
          <li key={i} className="text-xs text-text-secondary flex items-start gap-1.5">
            <span className="text-accent-warning mt-0.5">•</span>
            <span className="truncate">{a.description || a.message || a.title || 'Anomaly'}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (type === 'ar-aging' || type === 'ap-aging') {
    const buckets = data?.buckets || data?.rows || (Array.isArray(data) ? data : []);
    if (!buckets.length) return <Empty />;
    const max = Math.max(...buckets.map((b: any) => Math.abs(b.amount ?? b.total ?? 0)), 1);
    return (
      <div className="space-y-2">
        {buckets.map((b: any, i: number) => {
          const amt = b.amount ?? b.total ?? 0;
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[10px] text-text-muted w-16 truncate">{b.label || b.bucket || b.range}</span>
              <div className="flex-1 h-3" style={{ background: 'var(--color-bg-tertiary)', borderRadius: 'var(--app-radius)' }}>
                <div style={{ width: `${Math.max((Math.abs(amt) / max) * 100, 2)}%`, height: '100%', background: type === 'ar-aging' ? CHART_INCOME : 'var(--color-accent-expense)', borderRadius: 'var(--app-radius)' }} />
              </div>
              <span className="text-[10px] font-mono text-text-secondary w-20 text-right">{formatCurrency(amt)}</span>
            </div>
          );
        })}
      </div>
    );
  }

  if (type === 'top-clients') {
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) return <Empty />;
    const max = Math.max(...rows.map((r: any) => r.total || 0), 1);
    return (
      <div className="space-y-2">
        {rows.map((r: any, i: number) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-text-secondary w-24 truncate">{r.name || '—'}</span>
            <div className="flex-1 h-3" style={{ background: 'var(--color-bg-tertiary)', borderRadius: 'var(--app-radius)' }}>
              <div style={{ width: `${Math.max(((r.total || 0) / max) * 100, 2)}%`, height: '100%', background: CHART_INCOME, borderRadius: 'var(--app-radius)' }} />
            </div>
            <span className="text-[10px] font-mono text-text-secondary w-20 text-right">{formatCurrency(r.total || 0)}</span>
          </div>
        ))}
      </div>
    );
  }

  return <Empty />;
};

export default WidgetBody;
```

(The aging/forecast/stats return shapes are accessed with multiple fallbacks because their exact field names vary; the implementer should `console.log` one real response in dev and tighten the field access — but the defensive version renders something or "No data" rather than crashing.)

- [ ] **Step 3: Build check.** `npm run build` → 0.

- [ ] **Step 4: Commit.**

```bash
git add src/renderer/modules/cockpit/widgets/WidgetFrame.tsx src/renderer/modules/cockpit/widgets/WidgetBody.tsx
git commit -m "feat(cockpit): widget frame + body renderers"
```

---

### Task 5: Cockpit grid canvas (static render) + module registration

**Files:**
- Create: `src/renderer/modules/cockpit/Cockpit.tsx`
- Modify: `src/renderer/App.tsx` (lazy import, MODULE_NAMES, switch case)
- Modify: the Sidebar nav file (sections array)

- [ ] **Step 1: `Cockpit.tsx`** — renders the layout on a 12-col CSS grid (no drag yet), with an Edit toggle, per-widget data via `useWidgetData`, drill-through via `setModule`.

```tsx
import React, { useEffect } from 'react';
import { LayoutGrid, Pencil, RotateCcw, Plus } from 'lucide-react';
import { useCockpitLayoutStore } from './cockpitLayoutStore';
import { useWidgetData } from './widgets/useWidgetData';
import { widgetDef, WIDGET_DEFS } from './widgets/registry';
import WidgetFrame from './widgets/WidgetFrame';
import WidgetBody from './widgets/WidgetBody';
import { GRID_COLS } from './layout-utils';
import { useAppStore } from '../../stores/appStore';
import { useAuthStore } from '../../stores/authStore';
import { useCompanyStore } from '../../stores/companyStore';

const ROW_H = 88; // px per grid row

const DRILL: Record<string, string> = {
  'ar-aging': 'invoicing', 'ap-aging': 'bills', 'top-clients': 'clients',
  'anomalies': 'expenses', 'cash-forecast': 'reports', 'kpis': 'dashboard',
};

const WidgetSlot: React.FC<{ p: any; editing: boolean }> = ({ p, editing }) => {
  const def = widgetDef(p.type);
  const { data, loading } = useWidgetData(p.type);
  const setModule = useAppStore((s) => s.setModule);
  const removeWidget = useCockpitLayoutStore((s) => s.removeWidget);
  if (!def) return null;
  return (
    <div style={{ gridColumn: `${p.x + 1} / span ${p.w}`, gridRow: `${p.y + 1} / span ${p.h}` }}>
      <WidgetFrame title={def.title} accent={def.accent} editing={editing}
        onRemove={() => removeWidget(p.id)} onOpen={() => setModule(DRILL[p.type] || 'dashboard')}>
        <WidgetBody type={p.type} data={data} loading={loading} />
      </WidgetFrame>
    </div>
  );
};

const Cockpit: React.FC = () => {
  const { layout, editing, setEditing, addWidget, resetLayout, loadFromCloud, saveToCloud } = useCockpitLayoutStore();
  const user = useAuthStore((s) => s.user);
  const activeCompany = useCompanyStore((s) => s.activeCompany);

  useEffect(() => { if (user?.id && activeCompany?.id) loadFromCloud(user.id, activeCompany.id); }, [user?.id, activeCompany?.id]);

  const persist = () => { if (user?.id && activeCompany?.id) saveToCloud(user.id, activeCompany.id); };
  const rows = Math.max(6, ...layout.map(p => p.y + p.h));

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2 text-text-primary"><LayoutGrid size={18} /><h1 className="text-lg font-bold">Intelligence Cockpit</h1></div>
        <div className="flex items-center gap-2">
          {editing && (
            <select className="block-input text-xs" defaultValue="" onChange={(e) => { if (e.target.value) { addWidget(e.target.value); e.target.value = ''; } }}>
              <option value="" disabled>＋ Add widget…</option>
              {WIDGET_DEFS.map(w => <option key={w.type} value={w.type}>{w.title}</option>)}
            </select>
          )}
          {editing && <button className="block-btn flex items-center gap-1 text-xs" onClick={resetLayout}><RotateCcw size={12} /> Reset</button>}
          <button className={`block-btn flex items-center gap-1 text-xs ${editing ? 'text-accent-income' : ''}`}
            onClick={() => { if (editing) persist(); setEditing(!editing); }}>
            <Pencil size={12} /> {editing ? 'Done' : 'Edit'}
          </button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`, gridAutoRows: `${ROW_H}px`, gap: '12px' }}>
        {layout.map(p => <WidgetSlot key={p.id} p={p} editing={editing} />)}
      </div>
    </div>
  );
};

export default Cockpit;
```

- [ ] **Step 2: Register the module.** In `App.tsx`: add the lazy import `const CockpitModule = lazy(() => import('./modules/cockpit/Cockpit'));`, add `cockpit: 'Intelligence Cockpit',` to `MODULE_NAMES`, and `case 'cockpit': return <CockpitModule />;` to the `ModuleView` switch. (Match the exact existing patterns — read the file first.)

- [ ] **Step 3: Add the sidebar entry.** In the Sidebar nav file, add `{ id: 'cockpit', label: 'Intelligence Cockpit', icon: LayoutGrid }` (import `LayoutGrid` from lucide-react if not present) to the appropriate section array, near Dashboard/Analytics.

- [ ] **Step 4: Build + leak + manual.** `npm run build` → 0; `bash scripts/ui-leak-check.sh` not rising. Manual: Sidebar shows "Intelligence Cockpit"; clicking it renders the 5 default widgets with real data; drill-through arrows navigate; Edit toggles the add/remove/reset controls; removing a widget + Done persists (reload keeps it).

- [ ] **Step 5: Commit.**

```bash
git add src/renderer/modules/cockpit/Cockpit.tsx src/renderer/App.tsx src/renderer/components/layout/Sidebar.tsx
git commit -m "feat(cockpit): grid canvas + module registration"
```

---

### Task 6: Drag to reposition

**Files:**
- Modify: `src/renderer/modules/cockpit/Cockpit.tsx`

- [ ] **Step 1: Add native HTML5 drag** on the widget drag-handle. On drag start, stash the widget id; on drop onto the grid, compute the target cell from the cursor offset relative to the grid container and `updatePlacement`.

```tsx
// add a ref to the grid container and drag state
const gridRef = React.useRef<HTMLDivElement>(null);
const dragId = React.useRef<string | null>(null);
const { updatePlacement } = useCockpitLayoutStore();
const { pixelToCell } = require('./layout-utils'); // or import at top

const onGridDrop = (e: React.DragEvent) => {
  e.preventDefault();
  if (!dragId.current || !gridRef.current) return;
  const rect = gridRef.current.getBoundingClientRect();
  const { x, y } = pixelToCell(e.clientX - rect.left, e.clientY - rect.top, rect.width, ROW_H, GRID_COLS);
  updatePlacement(dragId.current, { x, y });
  dragId.current = null;
};
```

Wire `onDragOver={(e)=>e.preventDefault()}` and `onDrop={onGridDrop}` on the grid container (add `ref={gridRef}`), and pass `dragHandleProps={{ draggable: true, onDragStart: () => { dragId.current = p.id; } }}` into `WidgetFrame` (only when `editing`). Import `pixelToCell` properly at the top rather than `require`.

- [ ] **Step 2: Persist after drag.** On `onDrop`, after `updatePlacement`, call the same `persist()` used by the Edit toggle (so a moved widget survives reload even without pressing Done). Lift `persist` so it's reachable, or call `saveToCloud` directly.

- [ ] **Step 3: Build + manual.** `npm run build` → 0. Manual (Edit mode): drag a widget by its grip to a new cell; it snaps to the grid and stays after reload.

- [ ] **Step 4: Commit.**

```bash
git add src/renderer/modules/cockpit/Cockpit.tsx
git commit -m "feat(cockpit): drag widgets to reposition on the grid"
```

---

### Task 7: Resize widgets

**Files:**
- Modify: `src/renderer/modules/cockpit/widgets/WidgetFrame.tsx`
- Modify: `src/renderer/modules/cockpit/Cockpit.tsx`

- [ ] **Step 1: Add a resize handle** (bottom-right) to `WidgetFrame`, shown only in edit mode, exposing an `onResizeMouseDown` prop.

```tsx
// in WidgetFrame props: editing + onResizeStart?: (e: React.MouseEvent) => void
{editing && onResizeStart && (
  <div onMouseDown={onResizeStart}
    style={{ position: 'absolute', right: 2, bottom: 2, width: 14, height: 14, cursor: 'nwse-resize' }}
    className="text-text-muted">
    <svg width="14" height="14" viewBox="0 0 14 14"><path d="M13 5 L5 13 M13 9 L9 13" stroke="currentColor" strokeWidth="1.2" fill="none"/></svg>
  </div>
)}
```

(Make the frame's outer div `position: relative` so the handle anchors.)

- [ ] **Step 2: Resize logic in Cockpit.** On handle mousedown, capture start cursor + start w/h; on mousemove, convert pixel delta to grid-cell delta and `updatePlacement` with new w/h (clamped by `clampPlacement` inside the util); on mouseup, detach listeners + `persist()`.

```tsx
const startResize = (p: any) => (e: React.MouseEvent) => {
  e.preventDefault(); e.stopPropagation();
  if (!gridRef.current) return;
  const rect = gridRef.current.getBoundingClientRect();
  const cellW = rect.width / GRID_COLS;
  const startX = e.clientX, startY = e.clientY, startW = p.w, startH = p.h;
  const move = (ev: MouseEvent) => {
    const dw = Math.round((ev.clientX - startX) / cellW);
    const dh = Math.round((ev.clientY - startY) / ROW_H);
    updatePlacement(p.id, { w: startW + dw, h: startH + dh });
  };
  const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); persist(); };
  window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
};
```

Pass `onResizeStart={startResize(p)}` into `WidgetFrame` (edit mode only).

- [ ] **Step 3: Build + manual.** `npm run build` → 0. Manual: drag the corner handle to grow/shrink a widget by whole cells; clamps at grid edge; persists after reload.

- [ ] **Step 4: Commit.**

```bash
git add src/renderer/modules/cockpit/widgets/WidgetFrame.tsx src/renderer/modules/cockpit/Cockpit.tsx
git commit -m "feat(cockpit): resize widgets by grid cell"
```

---

### Task 8: B2 wrap-up

- [ ] **Step 1:** `npm run test:cockpit` → `8 passed`; `npm run test:search` → `8 passed` (B1 regression).
- [ ] **Step 2:** `npm run build` → 0; `bash scripts/ui-leak-check.sh` → counts not above baseline.
- [ ] **Step 3: Manual end-to-end.** Open Cockpit → 5 default widgets load real data. Edit → add an AP-aging widget, drag it, resize it, remove top-clients, Done. Reload app → layout persisted (settings table). Switch company → its own layout (or default) loads. Drill-through arrows navigate to the right modules.
- [ ] **Step 4: Push.** `git push`.

---

## Notes for implementers

- **No new dependencies** — native DnD + mouse events + existing Recharts.
- **Loaders never throw** — every `def.load` ends in `.catch`; widgets render "No data" rather than crash. Field access in `WidgetBody` is defensive because the aging/forecast/stats response shapes vary; verify against one real dev response and tighten.
- **Charts use `chart-palette.ts` hex** (the sanctioned exception); everything else is tokens (`.block-card`, `border-l-accent-*`, `var(--app-radius)`, `text-*`). No raw hex in component files.
- **Persistence** is per `userId+companyId` in the `settings` table, mirroring `personalizationStore`. localStorage gives instant restore; cloud gives cross-device.
- **Out of scope (v1):** multi-tab dashboards, collision/auto-compaction, custom KPI builder. These are B2.x follow-ups.
- B3 (AI Copilot) is the next pillar-B phase — separate spec/plan; consult the `claude-api` skill then.
