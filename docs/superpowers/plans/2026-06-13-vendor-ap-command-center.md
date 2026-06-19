# Vendor & AP Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new top-level `vendors-ap` module that surfaces the app's existing-but-dark vendor-360 (`vn:`) and AP/1099 (`feat:`) backend into a flagship Vendor & AP Command Center.

**Architecture:** A standalone, multi-tab React module under `src/renderer/modules/vendors-ap/`. Every panel is a thin surface over existing `api.ts` wrappers (`vn*`, `feat*`) following the proven `ExpenseInsights.tsx` pattern. Three internal waves (Vendor 360 → AP Automation → Compliance & Tax). Net-new files only; the sole shared edits are module registration (`App.tsx`, `Sidebar.tsx`, `personalizationStore.ts`) and append-only additions to `vendor-account-features.ts` / `ipc/index.ts` / `api.ts`.

**Tech Stack:** Electron 41, React 19, TypeScript, Vite, Tailwind (custom glass tokens), better-sqlite3, lucide-react icons. Spec: `docs/superpowers/specs/2026-06-13-vendor-ap-command-center-design.md`.

---

## Verification model (read first)

**This codebase has NO unit-test runner** (`package.json` scripts: `build`, `build:renderer`, `build:main`, `typecheck`, `dist*`; the only "test" is `test:loan`, a one-off node script). So the standard TDD "write a failing test" loop does not apply. The verification loop for every task is:

1. `npm run typecheck` → must pass (runs `tsc --noEmit` on both `tsconfig.main.json` and `tsconfig.json`).
2. `bash scripts/ui-leak-check.sh` → hard-coded-hex / white-leak / blocky-radius counts must **not rise** vs. baseline.
3. For UI tasks, a manual render check via the dev server / preview tooling (the module loads, the tab renders, no console errors).
4. `git commit`.

Capture the baseline leak counts **before Task 1**:
```bash
cd "/Users/rmpgutah/Business Accounting Pro/.claude/worktrees/romantic-lalande-ac2d3a"
bash scripts/ui-leak-check.sh | tee /tmp/leak-baseline.txt
```

**Hard rules (from spec + CLAUDE.md), apply to every task:**
- **No `Promise.all`** in panels — each `api` call fires independently with a `cancelled` guard, so one `{error}`-returning handler never blanks the page.
- **No hard-coded hex in `.tsx`.** Use tokens: `var(--color-accent-expense)` (negative/red), `var(--color-accent-income)` (positive/green), `var(--color-accent-warning)` (amber), `var(--color-accent-blue)` (info), `var(--accent-primary)` (brand), `var(--color-text-primary|secondary|muted)`, `var(--color-bg-secondary|tertiary)`, `var(--color-border-primary)`, `var(--app-radius)`. **Do NOT copy the inline hex from `ExpenseInsights.tsx`** (it has leaks like `#ef4444`); use the `TOK` palette defined in Task 1 instead.
- `feat:`/`vn:` handlers **return `{error}` on failure, they do not throw** — always inspect results; the `obj()`/`arr()` setter wrappers in Task 1 handle this.
- Company scoping is automatic in the backend (`db.getCurrentCompanyId()`); the renderer never passes `company_id` to `vn*`/`feat*` calls.

---

## File structure (locked)

```
src/renderer/modules/vendors-ap/
  index.tsx                 # shell: tab bar + view state ({tab, vendorId?}) + panel routing
  shared/ui.tsx             # Section, Empty, Th, Td, StatCard, MiniBar, TOK palette, grade color helper
  Overview.tsx              # Wave 1 — portfolio dashboard
  Directory.tsx             # Wave 1 — vendor list + filters + scorecards + VendorForm modal
  Vendor360.tsx             # Wave 1 — single-vendor deep view (vnFullSnapshot + per-vendor handlers)
  ApprovalsWorkbench.tsx    # Wave 2 — pending approvals + act + chain config
  PaymentsCenter.tsx        # Wave 2 — ACH batches / positive pay / check runs
  TaxCompliance1099.tsx     # Wave 3 — 1099 status/recalc/prep/runs + withholding
  ComplianceHub.tsx         # Wave 3 — health check, expiring docs, onboarding, disputes
  PortalAdmin.tsx           # Wave 3 — submitted invoices / PO responses / ACH-change approvals
```
Modified (registration + 3 backend readers): `src/renderer/App.tsx`, `src/renderer/components/layout/Sidebar.tsx`, `src/renderer/stores/personalizationStore.ts`, `src/main/services/vendor-account-features.ts`, `src/main/ipc/index.ts`, `src/renderer/lib/api.ts`.

---

## Task 1: Shared UI primitives

**Files:**
- Create: `src/renderer/modules/vendors-ap/shared/ui.tsx`

- [ ] **Step 1: Create the shared helpers file (token-clean port of the ExpenseInsights pattern)**

```tsx
// src/renderer/modules/vendors-ap/shared/ui.tsx
//
// Shared presentational primitives for the Vendor & AP Command Center.
// Token-clean port of the ExpenseInsights.tsx pattern — NO hard-coded hex.

import React from 'react';

// Token palette for charts/value coloring (string CSS vars only — no hex).
export const TOK = {
  expense: 'var(--color-accent-expense)',
  income: 'var(--color-accent-income)',
  warning: 'var(--color-accent-warning)',
  blue: 'var(--color-accent-blue)',
  brand: 'var(--accent-primary)',
  track: 'var(--color-bg-tertiary)',
  muted: 'var(--color-text-muted)',
  border: 'var(--color-border-primary)',
};

interface SectionProps { title: string; icon?: React.ReactNode; count?: number; right?: React.ReactNode; children: React.ReactNode }
export const Section: React.FC<SectionProps> = ({ title, icon, count, right, children }) => (
  <div className="block-card p-0 overflow-hidden">
    <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: `1px solid ${TOK.border}`, background: 'var(--color-bg-secondary)' }}>
      {icon}
      <span className="text-xs font-bold uppercase tracking-wider text-text-muted">{title}</span>
      {count !== undefined && (
        <span className="text-[10px] font-bold px-1.5 py-0.5 ml-1" style={{ borderRadius: 4, background: 'color-mix(in srgb, var(--color-accent-blue) 14%, transparent)', color: TOK.blue }}>{count}</span>
      )}
      {right && <div className="ml-auto">{right}</div>}
    </div>
    {children}
  </div>
);

export const Empty: React.FC<{ msg: string }> = ({ msg }) => (
  <div className="px-4 py-3 text-[11px] text-text-muted">{msg}</div>
);

export const Th: React.FC<{ children?: React.ReactNode; right?: boolean }> = ({ children, right }) => (
  <th style={{ padding: '5px 10px', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, color: TOK.muted, textAlign: right ? 'right' : 'left' }}>{children}</th>
);
export const Td: React.FC<{ children: React.ReactNode; right?: boolean; mono?: boolean; color?: string }> = ({ children, right, mono, color }) => (
  <td style={{ padding: '5px 10px', fontSize: 11, textAlign: right ? 'right' : 'left', fontFamily: mono ? 'SF Mono, Menlo, monospace' : undefined, color }}>{children}</td>
);

// KPI stat card for the top strip.
export const StatCard: React.FC<{ label: string; value: React.ReactNode; sub?: React.ReactNode; color?: string }> = ({ label, value, sub, color }) => (
  <div className="block-card p-3">
    <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">{label}</div>
    <div className="text-lg font-bold font-mono mt-1" style={{ color: color || 'var(--color-text-primary)' }}>{value}</div>
    {sub !== undefined && <div className="text-[10px] text-text-muted">{sub}</div>}
  </div>
);

// Horizontal bar row for simple distributions.
export const MiniBar: React.FC<{ label: string; value: number; max: number; valueLabel: React.ReactNode; barColor?: string }> = ({ label, value, max, valueLabel, barColor }) => (
  <div className="flex items-center gap-2 text-[11px]">
    <span style={{ width: 96 }} className="text-text-muted truncate" title={label}>{label}</span>
    <div style={{ flex: 1, height: 6, background: TOK.track, borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(100, (value / Math.max(1, max)) * 100)}%`, height: '100%', background: barColor || TOK.blue }} />
    </div>
    <span className="font-mono" style={{ width: 110, textAlign: 'right' }}>{valueLabel}</span>
  </div>
);

// A→D scorecard grade → token color.
export function gradeColor(grade: string): string {
  switch ((grade || '').toUpperCase()) {
    case 'A': return TOK.income;
    case 'B': return TOK.blue;
    case 'C': return TOK.warning;
    default: return TOK.expense;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors). The file is self-contained; only depends on React.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/vendors-ap/shared/ui.tsx
git commit -m "feat(vendors-ap): shared UI primitives (token-clean Section/StatCard/MiniBar)"
```

---

## Task 2: Module shell + registration + stub panels

Create the shell and minimal stubs for all 8 panels (so imports resolve and the module compiles), then register the module. Panels get fleshed out in later tasks.

**Files:**
- Create: `src/renderer/modules/vendors-ap/index.tsx`
- Create (stubs): `Overview.tsx`, `Directory.tsx`, `Vendor360.tsx`, `ApprovalsWorkbench.tsx`, `PaymentsCenter.tsx`, `TaxCompliance1099.tsx`, `ComplianceHub.tsx`, `PortalAdmin.tsx`
- Modify: `src/renderer/App.tsx`, `src/renderer/components/layout/Sidebar.tsx`, `src/renderer/stores/personalizationStore.ts`

- [ ] **Step 1: Create 8 stub panels**

Each stub is identical except name/title. Create all eight. Example for `Overview.tsx`:
```tsx
// src/renderer/modules/vendors-ap/Overview.tsx
import React from 'react';
import { Section, Empty } from './shared/ui';
const Overview: React.FC<{ onViewVendor?: (id: string) => void }> = () => (
  <Section title="Overview"><Empty msg="Coming up in this wave." /></Section>
);
export default Overview;
```
Create the other seven the same way with these names/props:
- `Directory.tsx` — `const Directory: React.FC<{ onViewVendor?: (id: string) => void }>`
- `Vendor360.tsx` — `const Vendor360: React.FC<{ vendorId: string; onBack: () => void }>` (stub ignores props, renders Section "Vendor 360")
- `ApprovalsWorkbench.tsx` — `const ApprovalsWorkbench: React.FC` (no props)
- `PaymentsCenter.tsx` — `const PaymentsCenter: React.FC`
- `TaxCompliance1099.tsx` — `const TaxCompliance1099: React.FC<{ onViewVendor?: (id: string) => void }>`
- `ComplianceHub.tsx` — `const ComplianceHub: React.FC<{ onViewVendor?: (id: string) => void }>`
- `PortalAdmin.tsx` — `const PortalAdmin: React.FC`

(For the stub of `Vendor360.tsx`, the signature is `({ vendorId, onBack })` but the body may ignore them: `() => (<Section title="Vendor 360"><Empty msg="Coming up." /></Section>)` — keep the typed props so the shell compiles.)

- [ ] **Step 2: Create the module shell**

```tsx
// src/renderer/modules/vendors-ap/index.tsx
//
// Vendor & AP Command Center — surfaces the dark vn:/feat: backend.
// Tabs: Overview · Directory · Approvals · Payments · 1099 & Tax · Compliance · Portal.
// Selecting a vendor from Overview/Directory opens the Vendor 360 detail view.

import React, { useState } from 'react';
import {
  LayoutDashboard, Building2, CheckSquare, Banknote, FileText, ShieldCheck, Inbox,
} from 'lucide-react';
import Overview from './Overview';
import Directory from './Directory';
import Vendor360 from './Vendor360';
import ApprovalsWorkbench from './ApprovalsWorkbench';
import PaymentsCenter from './PaymentsCenter';
import TaxCompliance1099 from './TaxCompliance1099';
import ComplianceHub from './ComplianceHub';
import PortalAdmin from './PortalAdmin';

type TabId = 'overview' | 'directory' | 'approvals' | 'payments' | 'tax1099' | 'compliance' | 'portal';
const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={14} /> },
  { id: 'directory', label: 'Directory', icon: <Building2 size={14} /> },
  { id: 'approvals', label: 'Approvals', icon: <CheckSquare size={14} /> },
  { id: 'payments', label: 'Payments', icon: <Banknote size={14} /> },
  { id: 'tax1099', label: '1099 & Tax', icon: <FileText size={14} /> },
  { id: 'compliance', label: 'Compliance', icon: <ShieldCheck size={14} /> },
  { id: 'portal', label: 'Vendor Portal', icon: <Inbox size={14} /> },
];

const VendorsApModule: React.FC = () => {
  const [tab, setTab] = useState<TabId>('overview');
  const [vendorId, setVendorId] = useState<string | null>(null);

  const viewVendor = (id: string) => { if (id) setVendorId(id); };
  const backToList = () => setVendorId(null);

  return (
    <div className="h-full flex flex-col">
      <div className="module-header">
        <h1 className="text-lg font-bold text-text-primary">Vendor &amp; AP Command Center</h1>
      </div>

      {vendorId ? (
        <div className="flex-1 overflow-y-auto p-4">
          <Vendor360 vendorId={vendorId} onBack={backToList} />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1 px-4 border-b" style={{ borderColor: 'var(--color-border-primary)' }}>
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="flex items-center gap-1.5 px-3 py-2.5 text-[13px] font-medium transition-colors"
                style={tab === t.id
                  ? { color: 'var(--accent-primary)', borderBottom: '2px solid var(--accent-primary)' }
                  : { color: 'var(--color-text-secondary)', borderBottom: '2px solid transparent' }}
              >
                {t.icon}{t.label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {tab === 'overview' && <Overview onViewVendor={viewVendor} />}
            {tab === 'directory' && <Directory onViewVendor={viewVendor} />}
            {tab === 'approvals' && <ApprovalsWorkbench />}
            {tab === 'payments' && <PaymentsCenter />}
            {tab === 'tax1099' && <TaxCompliance1099 onViewVendor={viewVendor} />}
            {tab === 'compliance' && <ComplianceHub onViewVendor={viewVendor} />}
            {tab === 'portal' && <PortalAdmin />}
          </div>
        </>
      )}
    </div>
  );
};

export default VendorsApModule;
```

- [ ] **Step 3: Register in `App.tsx`** (3 edits)

After line 50 (`const PurchaseOrdersModule = lazy(...)`), add:
```tsx
const VendorsApModule = lazy(() => import('./modules/vendors-ap'));
```
In `MODULE_NAMES` (after the `'purchase-orders': 'Purchase Orders',` line ~94), add:
```tsx
  'vendors-ap': 'Vendor & AP Command Center',
```
In the `renderModule()` switch (after `case 'purchase-orders': return <PurchaseOrdersModule />;` line ~146), add:
```tsx
      case 'vendors-ap': return <VendorsApModule />;
```

- [ ] **Step 4: Register in `Sidebar.tsx`** (1 edit)

In the `FINANCE` section items array (after the `{ id: 'loans', label: 'Loans', icon: Banknote },` line ~90), add (the `Building2` icon is already imported at line 30):
```tsx
      { id: 'vendors-ap', label: 'Vendors & AP', icon: Building2 },
```

- [ ] **Step 5: Register in `personalizationStore.ts`** (1 edit, fresh-install ordering)

In the `DEFAULT_SIDEBAR_ORDER` array (starts line ~100), add the string `'vendors-ap'` immediately after the `'bills'` entry. (Existing users are covered by the Sidebar runtime safety net at `Sidebar.tsx:167-169`, which auto-appends modules missing from a persisted order; this edit covers fresh installs.)

- [ ] **Step 6: Typecheck + build**

Run: `npm run typecheck && npm run build:renderer`
Expected: PASS. If `tsc` complains about an unused prop on a stub, ensure the stub's component type matches the signatures above.

- [ ] **Step 7: Manual render check**

Run the dev server (`npm run dev` after `npm rebuild better-sqlite3` if needed) or use the preview tooling. Confirm: a **Vendors & AP** item appears in the sidebar FINANCE group; clicking it shows the header + 7 tabs; each tab renders its stub "Coming up" card with no console error.

- [ ] **Step 8: Leak check + commit**

```bash
bash scripts/ui-leak-check.sh   # counts must not exceed /tmp/leak-baseline.txt
git add src/renderer/modules/vendors-ap src/renderer/App.tsx src/renderer/components/layout/Sidebar.tsx src/renderer/stores/personalizationStore.ts
git commit -m "feat(vendors-ap): module shell, 7-tab nav, registration + stub panels"
```

---

## Task 3: Overview dashboard (Wave 1)

Portfolio KPIs + top vendors + concentration + spend distributions + AP aging + health summary. Exemplar panel — fully coded; later panels follow this exact shape.

**Files:**
- Modify: `src/renderer/modules/vendors-ap/Overview.tsx`

- [ ] **Step 1: Replace the stub with the full Overview**

```tsx
// src/renderer/modules/vendors-ap/Overview.tsx
import React, { useEffect, useState } from 'react';
import { Building2, AlertTriangle, TrendingUp, Layers, Wallet } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import { Section, Empty, Th, Td, StatCard, MiniBar, TOK } from './shared/ui';

const Overview: React.FC<{ onViewVendor?: (id: string) => void }> = ({ onViewVendor }) => {
  const [counts, setCounts] = useState<any>(null);
  const [portfolio, setPortfolio] = useState<any>(null);
  const [concentration, setConcentration] = useState<any>(null);
  const [ranking, setRanking] = useState<any[]>([]);
  const [byType, setByType] = useState<any[]>([]);
  const [byLocation, setByLocation] = useState<any[]>([]);
  const [apAging, setApAging] = useState<any[]>([]);
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    const arr = (s: (v: any[]) => void) => (r: any) => { if (!cancelled && Array.isArray(r)) s(r); };
    const obj = (s: (v: any) => void) => (r: any) => { if (!cancelled && r && !r.error) s(r); };
    const quiet = () => {};
    api.vnCount().then(obj(setCounts)).catch(quiet);
    api.vnPortfolioSummary().then(obj(setPortfolio)).catch(quiet);
    api.vnConcentration().then(obj(setConcentration)).catch(quiet);
    api.vnRanking(12).then(arr(setRanking)).catch(quiet);
    api.vnByType().then(arr(setByType)).catch(quiet);
    api.vnByLocation().then(arr(setByLocation)).catch(quiet);
    api.featApAgingChart().then(arr(setApAging)).catch(quiet);
    api.vnHealthCheck().then(obj(setHealth)).catch(quiet);
    return () => { cancelled = true; };
  }, []);

  const open = (id: string) => { if (id && onViewVendor) onViewVendor(id); };
  const maxType = Math.max(1, ...byType.map((t: any) => t.count || 0));
  const maxLoc = Math.max(1, ...byLocation.map((t: any) => t.count || 0));
  const apTotal = apAging.reduce((s, b: any) => s + (b.total || b.amount || 0), 0);

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Vendors" value={counts?.total ?? '—'} sub={counts ? `${counts.approved} approved · ${counts.pending} pending` : undefined} />
        <StatCard label="Total Spend" value={portfolio ? formatCurrency(portfolio.totalSpend) : '—'} sub={portfolio ? `avg ${formatCurrency(portfolio.avgSpendPerVendor)}/vendor` : undefined} />
        <StatCard label="Top-3 Concentration" value={concentration ? `${concentration.top3Concentration}%` : '—'}
          sub="share of spend in top 3" color={concentration && concentration.top3Concentration > 60 ? TOK.warning : undefined} />
        <StatCard label="Open Compliance Issues" value={health?.totalIssues ?? '—'}
          sub={health?.healthy ? 'all clear' : 'needs attention'} color={health && health.totalIssues > 0 ? TOK.expense : TOK.income} />
      </div>

      {/* Top vendors */}
      <Section title="Top Vendors by Spend" icon={<Building2 size={13} style={{ color: TOK.blue }} />} count={ranking.length}>
        {ranking.length === 0 ? <Empty msg="No vendor spend recorded yet." /> : (
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: `1px solid ${TOK.border}` }}><Th>Vendor</Th><Th right>Txns</Th><Th right>Total Spend</Th><Th right>Last Txn</Th><Th /></tr></thead>
              <tbody>
                {ranking.map((v: any) => (
                  <tr key={v.id} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td>{v.name}</Td>
                    <Td right mono>{v.txn_count}</Td>
                    <Td right mono>{formatCurrency(v.total_spend)}</Td>
                    <Td right mono color={TOK.muted}>{v.last_txn || '—'}</Td>
                    <Td right><button className="block-btn text-[10px]" onClick={() => open(v.id)}>View</button></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Distributions + AP aging */}
      <div className="grid md:grid-cols-3 gap-4">
        <Section title="By Vendor Type" icon={<Layers size={13} style={{ color: TOK.blue }} />}>
          {byType.length === 0 ? <Empty msg="No data." /> : (
            <div className="p-3 space-y-1.5">
              {byType.map((t: any) => (
                <MiniBar key={t.type} label={String(t.type).replace(/_/g, ' ')} value={t.count} max={maxType} valueLabel={`${t.count}`} />
              ))}
            </div>
          )}
        </Section>
        <Section title="By Location" icon={<Layers size={13} style={{ color: TOK.blue }} />}>
          {byLocation.length === 0 ? <Empty msg="No data." /> : (
            <div className="p-3 space-y-1.5">
              {byLocation.map((t: any) => (
                <MiniBar key={t.location} label={String(t.location).replace(/_/g, ' ')} value={t.count} max={maxLoc} valueLabel={`${t.count}`} />
              ))}
            </div>
          )}
        </Section>
        <Section title="AP Aging" icon={<Wallet size={13} style={{ color: TOK.warning }} />} right={<span className="text-[10px] text-text-muted font-mono">{formatCurrency(apTotal)}</span>}>
          {apAging.length === 0 ? <Empty msg="No outstanding payables." /> : (
            <div className="p-3 space-y-1.5">
              {apAging.map((b: any, i: number) => {
                const amt = b.total ?? b.amount ?? 0;
                const label = b.bucket ?? b.label ?? b.range ?? `bucket ${i + 1}`;
                const late = String(label).includes('90') || String(label).includes('61');
                return <MiniBar key={i} label={String(label)} value={amt} max={Math.max(1, ...apAging.map((x: any) => x.total ?? x.amount ?? 0))} valueLabel={formatCurrency(amt)} barColor={late ? TOK.expense : TOK.warning} />;
              })}
            </div>
          )}
        </Section>
      </div>

      {/* Health issues */}
      <Section title="Compliance Health" icon={<AlertTriangle size={13} style={{ color: TOK.warning }} />} count={health?.issues?.length}>
        {!health || !health.issues || health.issues.length === 0 ? <Empty msg="No open compliance issues — vendor records are audit-ready." /> : (
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: `1px solid ${TOK.border}` }}><Th>Vendor</Th><Th>Issue</Th><Th right>Severity</Th></tr></thead>
              <tbody>
                {health.issues.map((iss: any, i: number) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td>{iss.vendor || iss.name || '—'}</Td>
                    <Td>{iss.issue}</Td>
                    <Td right color={iss.severity === 'high' ? TOK.expense : TOK.warning}>{iss.severity}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
};

export default Overview;
```

> Note on field names: the exact column keys returned by `featApAgingChart` (bucket label, amount) and `vnHealthCheck` issue rows are read defensively above (`b.total ?? b.amount`, `iss.vendor || iss.name`). When running the manual check, inspect one real row in the console and tighten the keys if the data shows different names.

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build:renderer`
Expected: PASS.

- [ ] **Step 3: Manual render check** — open Vendors & AP → Overview. Confirm KPI cards populate (or show "—" gracefully), the top-vendors table renders, and clicking **View** does nothing yet (Vendor360 is still a stub — that's fine).

- [ ] **Step 4: Leak check + commit**

```bash
bash scripts/ui-leak-check.sh
git add src/renderer/modules/vendors-ap/Overview.tsx
git commit -m "feat(vendors-ap): Overview portfolio dashboard (vn portfolio/ranking/concentration + AP aging)"
```

---

## Task 4: Vendor Directory (Wave 1)

Searchable/filterable vendor list with inline A–D scorecards, classification badges, and create/edit via the existing `VendorForm` modal.

**Files:**
- Modify: `src/renderer/modules/vendors-ap/Directory.tsx`

- [ ] **Step 1: Replace the stub with the full Directory**

```tsx
// src/renderer/modules/vendors-ap/Directory.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { Search, Plus, Download } from 'lucide-react';
import api from '../../lib/api';
import { Section, Empty, Th, Td, TOK, gradeColor } from './shared/ui';
import { VENDOR_TYPE, VENDOR_APPROVAL, ClassificationBadge } from '../../lib/classifications';
import VendorForm from '../expenses/VendorForm';

const Directory: React.FC<{ onViewVendor?: (id: string) => void }> = ({ onViewVendor }) => {
  const [vendors, setVendors] = useState<any[]>([]);
  const [scores, setScores] = useState<Record<string, any>>({});
  const [q, setQ] = useState('');
  const [formId, setFormId] = useState<string | null | undefined>(undefined); // undefined=closed, null=new, string=edit
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(() => {
    let cancelled = false;
    const run = (query: string) => {
      const p = query.trim() ? api.vnSearch(query.trim()) : api.vnList();
      p.then((r: any) => { if (!cancelled && Array.isArray(r)) setVendors(r); }).catch(() => {});
    };
    run(q);
    api.vnAllScores().then((r: any) => {
      if (cancelled || !Array.isArray(r)) return;
      const map: Record<string, any> = {};
      for (const s of r) map[s.vendorId || s.id] = s;
      setScores(map);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [q, reloadKey]);

  useEffect(() => load(), [load]);

  const open = (id: string) => { if (id && onViewVendor) onViewVendor(id); };
  const exportCsv = () => {
    api.vnExport().then((rows: any) => {
      if (!Array.isArray(rows) || rows.length === 0) return;
      const headers = Object.keys(rows[0]);
      const csv = [headers.join(','), ...rows.map((row: any) => headers.map(h => JSON.stringify(row[h] ?? '')).join(','))].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'vendors.csv';
      a.click();
    }).catch(() => {});
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 flex-1 max-w-md block-input px-2" style={{ borderRadius: 'var(--app-radius)' }}>
          <Search size={14} className="text-text-muted shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vendors by name, email, phone…"
            className="bg-transparent outline-none text-[13px] py-1.5 flex-1 text-text-primary" />
        </div>
        <button className="block-btn text-xs flex items-center gap-1" onClick={exportCsv}><Download size={13} /> Export</button>
        <button className="block-btn block-btn-primary text-xs flex items-center gap-1" onClick={() => setFormId(null)}><Plus size={13} /> New Vendor</button>
      </div>

      <Section title="Vendors" count={vendors.length}>
        {vendors.length === 0 ? <Empty msg={q ? 'No vendors match your search.' : 'No vendors yet. Click “New Vendor” to add one.'} /> : (
          <div style={{ maxHeight: 520, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: `1px solid ${TOK.border}` }}>
                <Th>Vendor</Th><Th>Type</Th><Th>Approval</Th><Th right>Grade</Th><Th>Terms</Th><Th /></tr></thead>
              <tbody>
                {vendors.map((v: any) => {
                  const sc = scores[v.id];
                  return (
                    <tr key={v.id} style={{ borderBottom: `1px solid ${TOK.border}`, cursor: 'pointer' }} onClick={() => open(v.id)}>
                      <Td>{v.name}</Td>
                      <Td><ClassificationBadge def={VENDOR_TYPE} value={v.vendor_type} size="xs" /></Td>
                      <Td><ClassificationBadge def={VENDOR_APPROVAL} value={v.approval_status} size="xs" /></Td>
                      <Td right><span className="font-bold font-mono" style={{ color: sc ? gradeColor(sc.grade) : TOK.muted }}>{sc ? `${sc.grade} · ${sc.score}` : '—'}</span></Td>
                      <Td>{v.payment_terms != null ? `Net ${v.payment_terms}` : '—'}</Td>
                      <Td right>
                        <button className="block-btn text-[10px]" onClick={(e) => { e.stopPropagation(); setFormId(v.id); }}>Edit</button>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {formId !== undefined && (
        <VendorForm
          vendorId={formId ?? undefined}
          onClose={() => setFormId(undefined)}
          onSaved={() => { setFormId(undefined); setReloadKey(k => k + 1); }}
        />
      )}
    </div>
  );
};

export default Directory;
```

> Confirm `VendorForm`'s prop names during the manual check — its docstring states `(vendorId, onClose, onSaved)`. If `vendorId` for "new" must be omitted vs. `null`, the `formId ?? undefined` coercion above already passes `undefined` for new. If `VendorForm` throws on an unexpected prop, open `src/renderer/modules/expenses/VendorForm.tsx` and match the exact prop contract.

- [ ] **Step 2: Typecheck + build** — `npm run typecheck && npm run build:renderer` → PASS.
- [ ] **Step 3: Manual check** — Directory lists vendors, search filters, grades render with color, **New Vendor**/**Edit** open the existing form modal and saving reloads the list.
- [ ] **Step 4: Leak check + commit**
```bash
bash scripts/ui-leak-check.sh
git add src/renderer/modules/vendors-ap/Directory.tsx
git commit -m "feat(vendors-ap): Vendor Directory (search, scorecards, badges, VendorForm reuse, CSV export)"
```

---

## Task 5: Vendor 360 detail (Wave 1)

The centerpiece. Driven primarily by `vnFullSnapshot`, with focused per-vendor handlers for spend analytics, payment behavior, compliance, and notes.

**Files:**
- Modify: `src/renderer/modules/vendors-ap/Vendor360.tsx`

- [ ] **Step 1: Replace the stub with the full Vendor 360**

```tsx
// src/renderer/modules/vendors-ap/Vendor360.tsx
import React, { useEffect, useState } from 'react';
import { ArrowLeft, Activity, Calendar, ShieldCheck, FileText, StickyNote } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import { Section, Empty, Th, Td, StatCard, MiniBar, TOK, gradeColor } from './shared/ui';
import { VENDOR_TYPE, VENDOR_APPROVAL, ClassificationBadge } from '../../lib/classifications';
import { useNavigation } from '../../lib/useNavigation';

const Vendor360: React.FC<{ vendorId: string; onBack: () => void }> = ({ vendorId, onBack }) => {
  const [snap, setSnap] = useState<any>(null);
  const [byMonth, setByMonth] = useState<any[]>([]);
  const [byCategory, setByCategory] = useState<any[]>([]);
  const [payHistory, setPayHistory] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [noteDraft, setNoteDraft] = useState('');
  const nav = useNavigation();

  const reloadNotes = () => { api.vnNotes(vendorId).then((r: any) => { if (Array.isArray(r)) setNotes(r); }).catch(() => {}); };

  useEffect(() => {
    let cancelled = false;
    const arr = (s: (v: any[]) => void) => (r: any) => { if (!cancelled && Array.isArray(r)) s(r); };
    const obj = (s: (v: any) => void) => (r: any) => { if (!cancelled && r && !r.error) s(r); };
    const quiet = () => {};
    api.vnFullSnapshot(vendorId).then(obj(setSnap)).catch(quiet);
    api.vnSpendByMonth(vendorId, 12).then(arr(setByMonth)).catch(quiet);
    api.vnSpendByCategory(vendorId).then(arr(setByCategory)).catch(quiet);
    api.vnPaymentHistory(vendorId).then(arr(setPayHistory)).catch(quiet);
    api.vnNotes(vendorId).then(arr(setNotes)).catch(quiet);
    api.vnActivityLog(vendorId).then(arr(setActivity)).catch(quiet);
    return () => { cancelled = true; };
  }, [vendorId]);

  const v = snap?.vendor || snap?.profile || {};
  const score = snap?.scorecard;
  const bill = snap?.billSummary || {};
  const tax = snap?.tax1099 || snap?.['1099'] || {};
  const ins = snap?.insurance || {};
  const contract = snap?.contract || {};
  const maxMonth = Math.max(1, ...byMonth.map((m: any) => m.total || 0));
  const maxCat = Math.max(1, ...byCategory.map((c: any) => c.total || 0));

  const addNote = () => {
    const text = noteDraft.trim();
    if (!text) return;
    api.vnNoteAdd(vendorId, text).then(() => { setNoteDraft(''); reloadNotes(); }).catch(() => {});
  };

  return (
    <div className="space-y-4">
      <button className="block-btn text-xs flex items-center gap-1" onClick={onBack}><ArrowLeft size={13} /> Back to directory</button>

      {/* Header */}
      <div className="block-card p-4 flex items-start justify-between">
        <div>
          <div className="text-xl font-bold text-text-primary">{v.name || 'Vendor'}</div>
          <div className="flex items-center gap-2 mt-1">
            <ClassificationBadge def={VENDOR_TYPE} value={v.vendor_type} size="xs" />
            <ClassificationBadge def={VENDOR_APPROVAL} value={v.approval_status} size="xs" />
            {v.email && <span className="text-[11px] text-text-muted">{v.email}</span>}
          </div>
        </div>
        {score && (
          <div className="text-right">
            <div className="text-3xl font-bold font-mono" style={{ color: gradeColor(score.grade) }}>{score.grade}</div>
            <div className="text-[10px] text-text-muted">score {score.score}/100</div>
          </div>
        )}
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Spend" value={snap ? formatCurrency(snap.totalSpend ?? 0) : '—'} sub={snap ? `YTD ${formatCurrency(snap.ytdSpend ?? 0)}` : undefined} />
        <StatCard label="Outstanding AP" value={bill.outstanding != null ? formatCurrency(bill.outstanding) : '—'} sub={bill.overdueBills != null ? `${bill.overdueBills} overdue` : undefined} color={bill.outstanding > 0 ? TOK.warning : undefined} />
        <StatCard label="1099 YTD Paid" value={tax.ytdPaid != null ? formatCurrency(tax.ytdPaid) : '—'} sub={tax.requiresFiling ? 'requires 1099 filing' : '1099 not required'} color={tax.requiresFiling ? TOK.warning : undefined} />
        <StatCard label="Transactions" value={snap?.expenseCount ?? '—'} sub={snap?.lastExpenseDate ? `last ${formatDate(snap.lastExpenseDate)}` : undefined} />
      </div>

      {/* Spend analytics */}
      <div className="grid md:grid-cols-2 gap-4">
        <Section title="Spend by Month (12mo)" icon={<Activity size={13} style={{ color: TOK.blue }} />}>
          {byMonth.length === 0 ? <Empty msg="No spend history." /> : (
            <div className="p-3 space-y-1.5">
              {byMonth.map((m: any) => <MiniBar key={m.month} label={m.month} value={m.total} max={maxMonth} valueLabel={formatCurrency(m.total)} barColor={TOK.blue} />)}
            </div>
          )}
        </Section>
        <Section title="Spend by Category" icon={<Activity size={13} style={{ color: TOK.blue }} />}>
          {byCategory.length === 0 ? <Empty msg="No categorized spend." /> : (
            <div className="p-3 space-y-1.5">
              {byCategory.map((c: any, i: number) => <MiniBar key={i} label={c.category || 'Uncategorized'} value={c.total} max={maxCat} valueLabel={formatCurrency(c.total)} />)}
            </div>
          )}
        </Section>
      </div>

      {/* Compliance snapshot */}
      <Section title="Compliance" icon={<ShieldCheck size={13} style={{ color: TOK.income }} />}>
        <div className="grid md:grid-cols-3 gap-3 p-3 text-[12px]">
          <div>
            <div className="text-[9px] font-bold uppercase text-text-muted">Insurance (COI)</div>
            <div style={{ color: ins.isExpired ? TOK.expense : 'var(--color-text-primary)' }}>{ins.coiExpiry ? `expires ${formatDate(ins.coiExpiry)}${ins.isExpired ? ' · EXPIRED' : ''}` : 'No COI on file'}</div>
          </div>
          <div>
            <div className="text-[9px] font-bold uppercase text-text-muted">Contract</div>
            <div style={{ color: contract.isExpired ? TOK.expense : 'var(--color-text-primary)' }}>{contract.endDate ? `ends ${formatDate(contract.endDate)}${contract.isExpired ? ' · EXPIRED' : ''}` : 'No contract dates'}</div>
          </div>
          <div>
            <div className="text-[9px] font-bold uppercase text-text-muted">W-9</div>
            <div>{tax.taxIdLast4 ? `TIN •••${tax.taxIdLast4}` : 'No TIN on file'}</div>
          </div>
        </div>
      </Section>

      {/* Payment history + bills deep-link */}
      <Section title="Recent Payments" icon={<Calendar size={13} style={{ color: TOK.blue }} />} count={payHistory.length}
        right={<button className="block-btn text-[10px]" onClick={() => nav.navigate('bills')}>Open Bills (AP)</button>}>
        {payHistory.length === 0 ? <Empty msg="No payment history." /> : (
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: `1px solid ${TOK.border}` }}><Th>Date</Th><Th>Bill #</Th><Th>Method</Th><Th right>Amount</Th></tr></thead>
              <tbody>
                {payHistory.map((p: any, i: number) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td mono>{formatDate(p.date)}</Td><Td>{p.bill_number || '—'}</Td>
                    <Td>{(p.payment_method || '').replace(/_/g, ' ')}</Td><Td right mono>{formatCurrency(p.amount)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Notes + activity */}
      <div className="grid md:grid-cols-2 gap-4">
        <Section title="Notes" icon={<StickyNote size={13} style={{ color: TOK.warning }} />} count={notes.length}>
          <div className="p-3 space-y-2">
            <div className="flex gap-2">
              <input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addNote(); }}
                placeholder="Add an internal note…" className="block-input flex-1 text-[12px]" />
              <button className="block-btn block-btn-primary text-xs" onClick={addNote}>Add</button>
            </div>
            {notes.length === 0 ? <Empty msg="No notes yet." /> : notes.map((n: any, i: number) => (
              <div key={i} className="text-[12px] border-l-2 pl-2" style={{ borderColor: TOK.warning }}>
                <div>{n.note || n.content}</div>
                <div className="text-[10px] text-text-muted">{formatDate(n.created_at)}{n.created_by ? ` · ${n.created_by}` : ''}</div>
              </div>
            ))}
          </div>
        </Section>
        <Section title="Activity" icon={<FileText size={13} style={{ color: TOK.blue }} />} count={activity.length}>
          {activity.length === 0 ? <Empty msg="No recorded activity." /> : (
            <div style={{ maxHeight: 240, overflowY: 'auto' }} className="p-3 space-y-1">
              {activity.map((a: any, i: number) => (
                <div key={i} className="text-[11px] text-text-secondary">
                  <span className="font-mono text-text-muted">{formatDate(a.created_at || a.timestamp)}</span> — {a.action || a.event || a.description}
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
};

export default Vendor360;
```

> Two things to confirm during the manual check: (1) the import path for the navigation hook — the contract refers to `useNavigation`; verify the actual path (search `grep -rn "export function useNavigation\|export const useNavigation" src/renderer/lib`). If it lives elsewhere (e.g. `../../lib/navigation`), fix the import. If no such hook exists, replace `nav.navigate('bills')` with the app store: `import { useAppStore } from '../../stores/appStore'` and `useAppStore.getState().setModule('bills')`. (2) `vnFullSnapshot`'s exact sub-object keys (`vendor` vs `profile`, `tax1099` vs `1099`) — the code reads both defensively; tighten after inspecting one real response.

- [ ] **Step 2: Typecheck + build** — `npm run typecheck && npm run build:renderer` → PASS.
- [ ] **Step 3: Manual check** — from Overview/Directory click **View** on a vendor → 360 opens: header + grade, KPI strip, spend bars, compliance row, payments table, notes (add one, it persists & reloads), activity. **Back** returns to the tabs.
- [ ] **Step 4: Leak check + commit**
```bash
bash scripts/ui-leak-check.sh
git add src/renderer/modules/vendors-ap/Vendor360.tsx
git commit -m "feat(vendors-ap): Vendor 360 detail (snapshot, spend analytics, compliance, payments, notes)"
```

**▶ Wave 1 checkpoint:** module is independently shippable here. Optional: `npm run build` (full) and a broader dev pass before continuing.

---

## Task 6: Approvals Workbench (Wave 2)

**Files:**
- Modify: `src/renderer/modules/vendors-ap/ApprovalsWorkbench.tsx`

- [ ] **Step 1: Implement the panel**

```tsx
// src/renderer/modules/vendors-ap/ApprovalsWorkbench.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { CheckSquare, Check, X } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import { Section, Empty, Th, Td, TOK } from './shared/ui';

const ApprovalsWorkbench: React.FC = () => {
  const [pending, setPending] = useState<any[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(() => {
    let cancelled = false;
    api.featApprovalPending().then((r: any) => { if (!cancelled && Array.isArray(r)) setPending(r); }).catch(() => {});
    return () => { cancelled = true; };
  }, [reloadKey]);
  useEffect(() => load(), [load]);

  const act = (instanceId: string, decision: 'approved' | 'rejected') => {
    api.featApprovalAct({ instance_id: instanceId, decision }).then(() => setReloadKey(k => k + 1)).catch(() => {});
  };

  return (
    <div className="space-y-4">
      <Section title="Pending Approvals" icon={<CheckSquare size={13} style={{ color: TOK.warning }} />} count={pending.length}>
        {pending.length === 0 ? <Empty msg="Nothing awaiting approval. Bills and POs above your chain thresholds appear here." /> : (
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: `1px solid ${TOK.border}` }}><Th>Type</Th><Th>Reference</Th><Th>Submitted</Th><Th right>Step</Th><Th right>Action</Th></tr></thead>
              <tbody>
                {pending.map((a: any) => (
                  <tr key={a.id} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td>{(a.entity_type || '').replace(/_/g, ' ')}</Td>
                    <Td>{a.entity_ref || a.entity_id}</Td>
                    <Td mono>{formatDate(a.submitted_at)}{a.submitted_by ? ` · ${a.submitted_by}` : ''}</Td>
                    <Td right mono>{a.current_step != null ? `#${a.current_step}` : '—'}</Td>
                    <Td right>
                      <div className="flex gap-1 justify-end">
                        <button className="block-btn text-[10px]" style={{ color: TOK.income }} onClick={() => act(a.id, 'approved')}><Check size={11} /> Approve</button>
                        <button className="block-btn text-[10px]" style={{ color: TOK.expense }} onClick={() => act(a.id, 'rejected')}><X size={11} /> Reject</button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
};

export default ApprovalsWorkbench;
```

> Confirm `api.featApprovalAct`'s exact argument shape against `api.ts` (channel `feat:approval:act`). It likely expects `{ instance_id, decision, actor?, note? }`. Adjust the `act()` payload to match the wrapper signature. Same for `featApprovalPending` (no args expected).

- [ ] **Step 2:** `npm run typecheck && npm run build:renderer` → PASS.
- [ ] **Step 3: Manual check** — Approvals tab lists pending items (or empty state); Approve/Reject calls the handler and the row clears on reload.
- [ ] **Step 4: Leak check + commit**
```bash
bash scripts/ui-leak-check.sh
git add src/renderer/modules/vendors-ap/ApprovalsWorkbench.tsx
git commit -m "feat(vendors-ap): Approvals workbench (pending queue + approve/reject)"
```

---

## Task 7: Payments Center (Wave 2)

ACH batches, positive-pay files, and check-print jobs — listing + create/mark actions only (no money movement).

**Files:**
- Modify: `src/renderer/modules/vendors-ap/PaymentsCenter.tsx`

- [ ] **Step 1: Implement the panel**

```tsx
// src/renderer/modules/vendors-ap/PaymentsCenter.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { Banknote, FileCheck2, Printer } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import { Section, Empty, Th, Td, TOK } from './shared/ui';

const PaymentsCenter: React.FC = () => {
  const [achBatches, setAchBatches] = useState<any[]>([]);
  const [posPay, setPosPay] = useState<any[]>([]);
  const [checks, setChecks] = useState<any[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(() => {
    let cancelled = false;
    const arr = (s: (v: any[]) => void) => (r: any) => { if (!cancelled && Array.isArray(r)) s(r); };
    api.featAchBatchList().then(arr(setAchBatches)).catch(() => {});
    api.featPositivePayList().then(arr(setPosPay)).catch(() => {});
    api.featCheckPrintList().then(arr(setChecks)).catch(() => {});
    return () => { cancelled = true; };
  }, [reloadKey]);
  useEffect(() => load(), [load]);

  const markAch = (id: string) => api.featAchBatchMarkSubmitted({ batch_id: id }).then(() => setReloadKey(k => k + 1)).catch(() => {});
  const markPos = (id: string) => api.featPositivePayMarkSubmitted({ file_id: id }).then(() => setReloadKey(k => k + 1)).catch(() => {});

  return (
    <div className="space-y-4">
      <Section title="ACH Batches" icon={<Banknote size={13} style={{ color: TOK.blue }} />} count={achBatches.length}>
        {achBatches.length === 0 ? <Empty msg="No ACH batches. Create one from approved bills to generate a NACHA file." /> : (
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: `1px solid ${TOK.border}` }}><Th>Batch Date</Th><Th>Effective</Th><Th right>Items</Th><Th right>Credit</Th><Th>Status</Th><Th right /></tr></thead>
              <tbody>
                {achBatches.map((b: any) => (
                  <tr key={b.id} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td mono>{formatDate(b.batch_date)}</Td><Td mono>{formatDate(b.effective_date)}</Td>
                    <Td right mono>{b.item_count}</Td><Td right mono>{formatCurrency(b.total_credit)}</Td>
                    <Td color={b.status === 'submitted' ? TOK.income : TOK.warning}>{b.status}</Td>
                    <Td right>{b.status !== 'submitted' && <button className="block-btn text-[10px]" onClick={() => markAch(b.id)}>Mark Submitted</button>}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Positive Pay Files" icon={<FileCheck2 size={13} style={{ color: TOK.blue }} />} count={posPay.length}>
        {posPay.length === 0 ? <Empty msg="No positive-pay files generated." /> : (
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: `1px solid ${TOK.border}` }}><Th>Created</Th><Th>File</Th><Th>Status</Th><Th right /></tr></thead>
              <tbody>
                {posPay.map((f: any) => (
                  <tr key={f.id} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td mono>{formatDate(f.created_at)}</Td><Td>{f.file_path || f.filename || '—'}</Td>
                    <Td color={f.status === 'submitted' ? TOK.income : TOK.warning}>{f.status}</Td>
                    <Td right>{f.status !== 'submitted' && <button className="block-btn text-[10px]" onClick={() => markPos(f.id)}>Mark Submitted</button>}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Check Print Runs" icon={<Printer size={13} style={{ color: TOK.blue }} />} count={checks.length}>
        {checks.length === 0 ? <Empty msg="No check-print jobs recorded." /> : (
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: `1px solid ${TOK.border}` }}><Th>Printed</Th><Th right>Range</Th><Th right>Count</Th><Th right>Total</Th></tr></thead>
              <tbody>
                {checks.map((c: any) => (
                  <tr key={c.id} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td mono>{formatDate(c.printed_at)}</Td>
                    <Td right mono>{c.check_number_start}–{c.check_number_end}</Td>
                    <Td right mono>{c.check_count}</Td><Td right mono>{formatCurrency(c.total_amount)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
};

export default PaymentsCenter;
```

> Confirm the `mark*` wrapper argument keys against `api.ts` (channels `feat:ach-batch:mark-submitted`, `feat:positive-pay:mark-submitted`). Adjust `{ batch_id }` / `{ file_id }` to the actual param names.

- [ ] **Step 2:** `npm run typecheck && npm run build:renderer` → PASS.
- [ ] **Step 3: Manual check** — Payments tab shows three sections with their lists/empty states; "Mark Submitted" updates status on reload.
- [ ] **Step 4: Leak check + commit**
```bash
bash scripts/ui-leak-check.sh
git add src/renderer/modules/vendors-ap/PaymentsCenter.tsx
git commit -m "feat(vendors-ap): Payments center (ACH batches, positive pay, check runs)"
```

---

## Task 8: New backend readers (disputes + multi-record W-9/insurance)

The only net-new backend. Add three read functions, wire IPC handlers after the existing `vn:` block, and add `api.ts` wrappers. Read-only → no `tablesWithoutCompanyId`/`tablesWithoutUpdatedAt` changes, no `scheduleAutoBackup()`.

**Files:**
- Modify: `src/main/services/vendor-account-features.ts` (append functions)
- Modify: `src/main/ipc/index.ts` (append handlers after line ~15316, end of the `vn:` block)
- Modify: `src/renderer/lib/api.ts` (append wrappers near the `vn*` block, before `export default api;`)

- [ ] **Step 1: Append the service functions** to `vendor-account-features.ts` (end of file). These mirror the existing `export function vendorX(cid, …)` pattern and use `db.getDb()`:

```ts
// ─── Vendor disputes (net-new reader) ─────────────────────
export function vendorDisputes(cid: string, vendorId?: string) {
  const dbi = db.getDb();
  if (vendorId) {
    return dbi.prepare(
      `SELECT d.*, v.name AS vendor_name, b.bill_number
         FROM vendor_disputes d
         LEFT JOIN vendors v ON v.id = d.vendor_id
         LEFT JOIN bills b ON b.id = d.bill_id
        WHERE d.company_id = ? AND d.vendor_id = ?
        ORDER BY d.opened_date DESC`
    ).all(cid, vendorId);
  }
  return dbi.prepare(
    `SELECT d.*, v.name AS vendor_name, b.bill_number
       FROM vendor_disputes d
       LEFT JOIN vendors v ON v.id = d.vendor_id
       LEFT JOIN bills b ON b.id = d.bill_id
      WHERE d.company_id = ?
      ORDER BY (d.status = 'open') DESC, d.opened_date DESC`
  ).all(cid);
}

// ─── Multi-record W-9 (richer than legacy vendors.w9_status) ──
export function vendorW9Records(cid: string, vendorId: string) {
  return db.getDb().prepare(
    `SELECT * FROM vendor_w9_records WHERE company_id = ? AND vendor_id = ? ORDER BY received_date DESC`
  ).all(cid, vendorId);
}

// ─── Multi-policy insurance (richer than legacy vendors.coi_*) ──
export function vendorInsurancePolicies(cid: string, vendorId: string) {
  return db.getDb().prepare(
    `SELECT * FROM vendor_insurance_policies WHERE company_id = ? AND vendor_id = ? ORDER BY expiration_date DESC`
  ).all(cid, vendorId);
}
```

> Verify the `db` import name at the top of `vendor-account-features.ts` (existing functions use `db.getDb()`), and confirm `vendor_disputes` / `vendor_w9_records` / `vendor_insurance_policies` physically carry a `company_id` column (per the backend contract they do, though they're listed in `TABLES_WITHOUT_COMPANY_ID` for the generic writer only — reads filtering on `company_id` are correct).

- [ ] **Step 2: Append IPC handlers** in `ipc/index.ts` immediately after the last `vn:` handler (around line 15316), using the established `vn()` accessor and company guard:

```ts
  ipcMain.handle('vn:disputes', (_e, { vendorId }: any) => { const c = db.getCurrentCompanyId(); return c ? vn().vendorDisputes(c, vendorId) : []; });
  ipcMain.handle('vn:w9-records', (_e, { vendorId }: any) => { const c = db.getCurrentCompanyId(); return c ? vn().vendorW9Records(c, vendorId) : []; });
  ipcMain.handle('vn:insurance-policies', (_e, { vendorId }: any) => { const c = db.getCurrentCompanyId(); return c ? vn().vendorInsurancePolicies(c, vendorId) : []; });
```

- [ ] **Step 3: Append `api.ts` wrappers** inside the `api` object (anywhere before `export default api;` at line 3608; put them right after the existing `vnHealthCheck` wrapper near line 809):

```ts
  vnDisputes: (vendorId?: string) => window.electronAPI.invoke('vn:disputes', { vendorId }),
  vnW9Records: (vendorId: string) => window.electronAPI.invoke('vn:w9-records', { vendorId }),
  vnInsurancePolicies: (vendorId: string) => window.electronAPI.invoke('vn:insurance-policies', { vendorId }),
```

- [ ] **Step 4: Typecheck (both projects)**

Run: `npm run typecheck`
Expected: PASS (this exercises `tsconfig.main.json`, covering the service + IPC edits).

- [ ] **Step 5: Build main**

Run: `npm run build:main`
Expected: PASS — compiles main process and copies schema.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/vendor-account-features.ts src/main/ipc/index.ts src/renderer/lib/api.ts
git commit -m "feat(vendors-ap): backend readers for disputes + multi-record W-9/insurance (vn:disputes/w9-records/insurance-policies)"
```

---

## Task 9: 1099 & Tax Compliance (Wave 3)

**Files:**
- Modify: `src/renderer/modules/vendors-ap/TaxCompliance1099.tsx`

- [ ] **Step 1: Implement the panel**

```tsx
// src/renderer/modules/vendors-ap/TaxCompliance1099.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { FileText, RefreshCw } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency } from '../../lib/format';
import { Section, Empty, Th, Td, StatCard, TOK } from './shared/ui';

const YEAR = new Date().getFullYear();

const TaxCompliance1099: React.FC<{ onViewVendor?: (id: string) => void }> = ({ onViewVendor }) => {
  const [needing, setNeeding] = useState<any[]>([]);
  const [withoutW9, setWithoutW9] = useState<any[]>([]);
  const [prep, setPrep] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    const arr = (s: (v: any[]) => void) => (r: any) => { if (!cancelled && Array.isArray(r)) s(r); };
    api.vnNeeding1099().then(arr(setNeeding)).catch(() => {});
    api.vnWithoutW9().then(arr(setWithoutW9)).catch(() => {});
    api.feat1099PrepReport(YEAR).then(arr(setPrep)).catch(() => {});
    api.feat1099RunList().then(arr(setRuns)).catch(() => {});
    return () => { cancelled = true; };
  }, [reloadKey]);
  useEffect(() => load(), [load]);

  const open = (id: string) => { if (id && onViewVendor) onViewVendor(id); };
  const recalc = () => { setBusy(true); api.featVendor1099Recalc({ tax_year: YEAR }).then(() => { setBusy(false); setReloadKey(k => k + 1); }).catch(() => setBusy(false)); };
  const createRun = () => { api.feat1099RunCreate({ tax_year: YEAR }).then(() => setReloadKey(k => k + 1)).catch(() => {}); };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard label={`Requires 1099 (${YEAR})`} value={needing.length} sub="paid ≥ $600" color={needing.length ? TOK.warning : TOK.income} />
        <StatCard label="Missing W-9" value={withoutW9.length} sub="1099-eligible, no W-9" color={withoutW9.length ? TOK.expense : TOK.income} />
        <StatCard label="Filing Runs" value={runs.length} />
      </div>

      <Section title={`Vendors Requiring 1099 (${YEAR})`} icon={<FileText size={13} style={{ color: TOK.warning }} />} count={needing.length}
        right={<div className="flex gap-1"><button className="block-btn text-[10px] flex items-center gap-1" onClick={recalc} disabled={busy}><RefreshCw size={11} /> {busy ? 'Recalculating…' : 'Recalc YTD'}</button><button className="block-btn block-btn-primary text-[10px]" onClick={createRun}>Create Filing Run</button></div>}>
        {needing.length === 0 ? <Empty msg="No vendors cross the $600 reporting threshold this year." /> : (
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: `1px solid ${TOK.border}` }}><Th>Vendor</Th><Th>TIN</Th><Th right>YTD Paid</Th><Th /></tr></thead>
              <tbody>
                {needing.map((v: any) => (
                  <tr key={v.id} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td>{v.name}</Td><Td mono>{v.tax_id_last4 ? `•••${v.tax_id_last4}` : <span style={{ color: TOK.expense }}>missing</span>}</Td>
                    <Td right mono>{formatCurrency(v.ytd_paid)}</Td>
                    <Td right><button className="block-btn text-[10px]" onClick={() => open(v.id)}>View</button></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <div className="grid md:grid-cols-2 gap-4">
        <Section title="Missing W-9" icon={<FileText size={13} style={{ color: TOK.expense }} />} count={withoutW9.length}>
          {withoutW9.length === 0 ? <Empty msg="Every 1099-eligible vendor has a current W-9." /> : (
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {withoutW9.map((v: any) => (
                    <tr key={v.id} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                      <Td>{v.name}</Td>
                      <Td right><button className="block-btn text-[10px]" onClick={() => open(v.id)}>Request W-9</button></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
        <Section title="Filing Runs" icon={<FileText size={13} style={{ color: TOK.blue }} />} count={runs.length}>
          {runs.length === 0 ? <Empty msg="No filing runs yet." /> : (
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ borderBottom: `1px solid ${TOK.border}` }}><Th>Year</Th><Th>Form</Th><Th right>Vendors</Th><Th right>Total</Th><Th>Status</Th></tr></thead>
                <tbody>
                  {runs.map((r: any) => (
                    <tr key={r.id} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                      <Td mono>{r.tax_year}</Td><Td>{r.form_type}</Td><Td right mono>{r.vendor_count}</Td>
                      <Td right mono>{formatCurrency(r.total_amount)}</Td><Td>{r.status}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </div>
  );
};

export default TaxCompliance1099;
```

> Confirm `featVendor1099Recalc`/`feat1099RunCreate`/`feat1099PrepReport`/`feat1099RunList` wrapper signatures in `api.ts`. Per the contract: `featVendor1099Recalc(tax_year, vendor_id?)`, `feat1099RunCreate({tax_year, form_type?})`, `feat1099PrepReport(tax_year)`, `feat1099RunList()`. Adjust call shapes accordingly (e.g. `featVendor1099Recalc(YEAR)` if it takes a positional arg rather than an object).

- [ ] **Step 2:** `npm run typecheck && npm run build:renderer` → PASS.
- [ ] **Step 3: Manual check** — 1099 tab shows KPI cards, the requiring-1099 list, missing-W9, and runs; Recalc YTD and Create Filing Run trigger reloads.
- [ ] **Step 4: Leak check + commit**
```bash
bash scripts/ui-leak-check.sh
git add src/renderer/modules/vendors-ap/TaxCompliance1099.tsx
git commit -m "feat(vendors-ap): 1099 & tax compliance (needing-1099, missing-W9, recalc, prep, filing runs)"
```

---

## Task 10: Compliance Hub (Wave 3)

Uses the new `vnDisputes` reader plus existing health/expiry handlers.

**Files:**
- Modify: `src/renderer/modules/vendors-ap/ComplianceHub.tsx`

- [ ] **Step 1: Implement the panel**

```tsx
// src/renderer/modules/vendors-ap/ComplianceHub.tsx
import React, { useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, FileWarning, Gavel } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import { Section, Empty, Th, Td, StatCard, TOK } from './shared/ui';

const ComplianceHub: React.FC<{ onViewVendor?: (id: string) => void }> = ({ onViewVendor }) => {
  const [health, setHealth] = useState<any>(null);
  const [expIns, setExpIns] = useState<any[]>([]);
  const [expContracts, setExpContracts] = useState<any[]>([]);
  const [disputes, setDisputes] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    const arr = (s: (v: any[]) => void) => (r: any) => { if (!cancelled && Array.isArray(r)) s(r); };
    const obj = (s: (v: any) => void) => (r: any) => { if (!cancelled && r && !r.error) s(r); };
    api.vnHealthCheck().then(obj(setHealth)).catch(() => {});
    api.vnExpiredInsurance().then(arr(setExpIns)).catch(() => {});
    api.vnExpiredContracts().then(arr(setExpContracts)).catch(() => {});
    api.vnDisputes().then(arr(setDisputes)).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const open = (id: string) => { if (id && onViewVendor) onViewVendor(id); };
  const openDisputes = disputes.filter((d: any) => d.status === 'open');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Open Issues" value={health?.totalIssues ?? '—'} color={health && health.totalIssues > 0 ? TOK.expense : TOK.income} />
        <StatCard label="Expired Insurance" value={expIns.length} color={expIns.length ? TOK.expense : TOK.income} />
        <StatCard label="Expired Contracts" value={expContracts.length} color={expContracts.length ? TOK.warning : TOK.income} />
        <StatCard label="Open Disputes" value={openDisputes.length} color={openDisputes.length ? TOK.warning : TOK.income} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Section title="Expired Insurance (COI)" icon={<ShieldAlert size={13} style={{ color: TOK.expense }} />} count={expIns.length}>
          {expIns.length === 0 ? <Empty msg="All certificates of insurance are current." /> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {expIns.map((v: any) => (
                  <tr key={v.id} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td>{v.name}</Td><Td mono color={TOK.expense}>{formatDate(v.coi_expiry)}</Td>
                    <Td right><button className="block-btn text-[10px]" onClick={() => open(v.id)}>View</button></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
        <Section title="Expired Contracts" icon={<FileWarning size={13} style={{ color: TOK.warning }} />} count={expContracts.length}>
          {expContracts.length === 0 ? <Empty msg="No expired vendor contracts." /> : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {expContracts.map((v: any) => (
                  <tr key={v.id} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td>{v.name}</Td><Td mono color={TOK.warning}>{formatDate(v.contract_end)}</Td>
                    <Td right><button className="block-btn text-[10px]" onClick={() => open(v.id)}>View</button></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>

      <Section title="Vendor Disputes" icon={<Gavel size={13} style={{ color: TOK.warning }} />} count={disputes.length}>
        {disputes.length === 0 ? <Empty msg="No vendor disputes on record." /> : (
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: `1px solid ${TOK.border}` }}><Th>Vendor</Th><Th>Bill #</Th><Th>Reason</Th><Th right>Amount</Th><Th>Status</Th><Th>Opened</Th><Th /></tr></thead>
              <tbody>
                {disputes.map((d: any) => (
                  <tr key={d.id} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td>{d.vendor_name || '—'}</Td><Td>{d.bill_number || '—'}</Td><Td>{(d.reason || '').slice(0, 40)}</Td>
                    <Td right mono>{formatCurrency(d.dispute_amount)}</Td>
                    <Td color={d.status === 'open' ? TOK.warning : TOK.income}>{d.status}</Td>
                    <Td mono>{formatDate(d.opened_date)}</Td>
                    <Td right><button className="block-btn text-[10px]" onClick={() => open(d.vendor_id)}>View</button></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Health Issues" icon={<ShieldCheck size={13} style={{ color: TOK.income }} />} count={health?.issues?.length}>
        {!health || !health.issues || health.issues.length === 0 ? <Empty msg="No open compliance issues." /> : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {health.issues.map((iss: any, i: number) => (
                <tr key={i} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                  <Td>{iss.vendor || iss.name || '—'}</Td><Td>{iss.issue}</Td>
                  <Td right color={iss.severity === 'high' ? TOK.expense : TOK.warning}>{iss.severity}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
};

export default ComplianceHub;
```

- [ ] **Step 2:** `npm run typecheck && npm run build:renderer` → PASS.
- [ ] **Step 3: Manual check** — Compliance tab shows KPI cards, expired insurance/contracts, the new disputes table, and health issues; "View" deep-links into Vendor 360.
- [ ] **Step 4: Leak check + commit**
```bash
bash scripts/ui-leak-check.sh
git add src/renderer/modules/vendors-ap/ComplianceHub.tsx
git commit -m "feat(vendors-ap): Compliance hub (health, expiring insurance/contracts, disputes)"
```

---

## Task 11: Vendor Portal Admin (Wave 3)

**Files:**
- Modify: `src/renderer/modules/vendors-ap/PortalAdmin.tsx`

- [ ] **Step 1: Implement the panel**

```tsx
// src/renderer/modules/vendors-ap/PortalAdmin.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { Inbox, Check, X } from 'lucide-react';
import api from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/format';
import { Section, Empty, Th, Td, TOK } from './shared/ui';

const PortalAdmin: React.FC = () => {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [poResponses, setPoResponses] = useState<any[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(() => {
    let cancelled = false;
    const arr = (s: (v: any[]) => void) => (r: any) => { if (!cancelled && Array.isArray(r)) s(r); };
    api.featVendorInvList().then(arr(setInvoices)).catch(() => {});
    api.featVendorPoListResponses().then(arr(setPoResponses)).catch(() => {});
    return () => { cancelled = true; };
  }, [reloadKey]);
  useEffect(() => load(), [load]);

  const review = (id: string, decision: 'approved' | 'rejected') =>
    api.featVendorInvReview({ submission_id: id, decision }).then(() => setReloadKey(k => k + 1)).catch(() => {});

  return (
    <div className="space-y-4">
      <Section title="Submitted Invoices (Vendor Portal)" icon={<Inbox size={13} style={{ color: TOK.blue }} />} count={invoices.length}>
        {invoices.length === 0 ? <Empty msg="No vendor-submitted invoices awaiting review." /> : (
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: `1px solid ${TOK.border}` }}><Th>Submitted</Th><Th>Vendor</Th><Th>Invoice #</Th><Th right>Amount</Th><Th>Status</Th><Th right /></tr></thead>
              <tbody>
                {invoices.map((s: any) => (
                  <tr key={s.id} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td mono>{formatDate(s.created_at || s.submitted_at)}</Td>
                    <Td>{s.vendor_name || s.vendor_id}</Td><Td>{s.invoice_number || '—'}</Td>
                    <Td right mono>{formatCurrency(s.amount)}</Td>
                    <Td color={s.status === 'approved' ? TOK.income : s.status === 'rejected' ? TOK.expense : TOK.warning}>{s.status || 'pending'}</Td>
                    <Td right>
                      {(!s.status || s.status === 'pending') && (
                        <div className="flex gap-1 justify-end">
                          <button className="block-btn text-[10px]" style={{ color: TOK.income }} onClick={() => review(s.id, 'approved')}><Check size={11} /></button>
                          <button className="block-btn text-[10px]" style={{ color: TOK.expense }} onClick={() => review(s.id, 'rejected')}><X size={11} /></button>
                        </div>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="PO Responses" icon={<Inbox size={13} style={{ color: TOK.blue }} />} count={poResponses.length}>
        {poResponses.length === 0 ? <Empty msg="No purchase-order responses from vendors." /> : (
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr style={{ borderBottom: `1px solid ${TOK.border}` }}><Th>Date</Th><Th>PO</Th><Th>Vendor</Th><Th>Response</Th></tr></thead>
              <tbody>
                {poResponses.map((p: any) => (
                  <tr key={p.id} style={{ borderBottom: `1px solid ${TOK.border}` }}>
                    <Td mono>{formatDate(p.created_at)}</Td><Td>{p.po_number || p.po_id}</Td>
                    <Td>{p.vendor_name || p.vendor_id}</Td><Td>{p.response || p.status}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
};

export default PortalAdmin;
```

> Confirm `featVendorInvReview` arg keys (channel `feat:vendor-inv:review`) — likely `{ submission_id, decision, matched_bill_id? }`. Adjust the `review()` payload to match `api.ts`.

- [ ] **Step 2:** `npm run typecheck && npm run build:renderer` → PASS.
- [ ] **Step 3: Manual check** — Vendor Portal tab lists submitted invoices and PO responses (or empty states); approve/reject updates status on reload.
- [ ] **Step 4: Leak check + commit**
```bash
bash scripts/ui-leak-check.sh
git add src/renderer/modules/vendors-ap/PortalAdmin.tsx
git commit -m "feat(vendors-ap): Vendor portal admin (submitted invoices, PO responses, review actions)"
```

---

## Task 12: Final integration pass

**Files:** none (verification only)

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: PASS (renderer + main).

- [ ] **Step 2: Final leak check vs. baseline**

Run: `bash scripts/ui-leak-check.sh`
Expected: hex/white/radius counts ≤ the `/tmp/leak-baseline.txt` baseline captured before Task 1.

- [ ] **Step 3: End-to-end manual pass** (dev server)

Walk all 7 tabs + Vendor 360 with real data. Confirm: no console errors; every panel renders an empty state rather than crashing when a handler returns `{error}`/`[]`; the Expenses module's own Vendors tab still works unchanged (regression check); the sidebar entry persists across a reload.

- [ ] **Step 4: Capture proof** — screenshot the Overview dashboard and a Vendor 360 view via the preview tooling for the PR.

- [ ] **Step 5: Commit any final fixes** discovered during the pass (field-name tightening, wrapper-signature corrections).

```bash
git add -A
git commit -m "fix(vendors-ap): final integration pass — field-name + wrapper-signature corrections"
```

---

## Self-review checklist (run before declaring done)

- **Spec coverage:** Overview (Task 3), Directory (4), Vendor 360 (5), Approvals (6), Payments (7), 1099 & Tax (9), Compliance + disputes (8+10), Portal admin (11), new readers (8), registration (2) — all spec sections mapped. ✓
- **No `Promise.all`** anywhere — every panel uses independent calls + `cancelled` guard. ✓
- **No hard-coded hex** — all color via `TOK`/tokens; `ui-leak-check.sh` gates each task. ✓
- **Type consistency:** shared helpers (`Section`, `Empty`, `Th`, `Td`, `StatCard`, `MiniBar`, `TOK`, `gradeColor`) are imported, not redefined; panel prop signatures (`onViewVendor`, `{vendorId,onBack}`) match the shell in Task 2. ✓
- **Parallel-safety:** only `App.tsx`/`Sidebar.tsx`/`personalizationStore.ts` registration lines + append-only backend additions touch shared files; no edits to `expenses/` or `ex:`/`eu:` handlers. ✓
- **Backend additions** are read-only (no `tablesWithoutCompanyId`/`tablesWithoutUpdatedAt`/`scheduleAutoBackup` changes needed). ✓
