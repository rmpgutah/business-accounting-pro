# Platinum Finance Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the app's default "Warm Structured Glass" theme (emerald/rose/amber, neutral-gray base) with "Platinum Finance" (blue/silver/red, cool-gray base), and clean up 5 files with stray hardcoded colors that would otherwise undermine the new palette.

**Architecture:** Token-only change. Two files define every color the app renders: `personalizationStore.ts` (`DEFAULT_ACCENTS`, applied at runtime via `applyPersonalization()`) and `globals.css` (`@theme` block, static fallback + dark-mode base neutrals). No component `.tsx` file needs its color *logic* touched — only literal hex values that bypass the token system in 5 specific files.

**Tech Stack:** React 19 + TypeScript, Tailwind CSS v4 (`@theme` token-to-utility generation), Zustand (personalization store), Vite dev server for visual verification.

**Spec:** `docs/superpowers/specs/2026-07-03-platinum-finance-theme-design.md`

**Note on scope:** During research for this plan, 2 of the 7 files originally flagged by `scripts/ui-leak-check.sh` turned out to be false positives, not app-theme leaks:
- `src/renderer/modules/settings/IndustryPresetSettings.tsx:162` — the matched `#2563eb` is inside a JSON string shown to the user as an example template for building a custom industry preset. It's example data, not a rendered color.
- `src/renderer/modules/invoices/InvoiceSettings.tsx` — the matched hex values are a 10-color swatch picker (`ACCENT_PRESETS`) letting the *business owner* choose their own invoice/PDF branding color for documents they send to *their* customers. This is user-configurable business data, unrelated to the app's internal theme, and must not be touched.

Both are left untouched. This plan covers the 5 genuine leaks plus one additional leak found while reading `ExpenseForm.tsx` in context (a hardcoded red badge sitting next to the flagged blue one) that the script's regex didn't catch because it only searches for blue hex values.

---

### Task 1: Update the core theme tokens

**Files:**
- Modify: `src/renderer/stores/personalizationStore.ts:48-55`
- Modify: `src/renderer/styles/globals.css:1-32`

- [ ] **Step 1: Update `DEFAULT_ACCENTS` in `personalizationStore.ts`**

Current code (lines 48-55):

```typescript
export const DEFAULT_ACCENTS: AccentSlots = {
  primary: '#10b981',   // emerald brand
  income: '#34d399',
  expense: '#fb7185',   // warm rose
  warning: '#f59e0b',   // amber
  blue: '#60a5fa',      // informational only
  purple: '#c084fc',
};
```

Replace with:

```typescript
export const DEFAULT_ACCENTS: AccentSlots = {
  primary: '#3b82f6',   // platinum blue
  income: '#4ade80',
  expense: '#ef4444',   // true red
  warning: '#f59e0b',   // amber
  blue: '#60a5fa',      // informational only
  purple: '#c084fc',
};
```

- [ ] **Step 2: Update the base neutral tokens and static accent fallbacks in `globals.css`**

Current code (lines 1-32):

```css
@import "tailwindcss";

@theme {
  /* Blocky dark theme palette */
  --color-bg-primary: #0a0a0a;
  --color-bg-secondary: #141414;
  --color-bg-tertiary: #1e1e1e;
  --color-bg-elevated: #252525;
  --color-bg-hover: #2a2a2a;

  --color-border-primary: #2e2e2e;
  --color-border-secondary: #3a3a3a;
  --color-border-focus: #525252;

  --color-text-primary: #f0f0f0;
  --color-text-secondary: #a0a0a0;
  --color-text-muted: #6b6b6b;

  --color-accent-income: #22c55e;
  --color-accent-income-bg: rgba(34, 197, 94, 0.08);
  --color-accent-expense: #ef4444;
  --color-accent-expense-bg: rgba(239, 68, 68, 0.08);
  --color-accent-blue: #3b82f6;
  --color-accent-blue-bg: rgba(59, 130, 246, 0.08);
  --color-accent-warning: #f59e0b;
  --color-accent-warning-bg: rgba(245, 158, 11, 0.08);
  --color-accent-purple: #a855f7;
  --color-accent-purple-bg: rgba(168, 85, 247, 0.08);

  --font-sans: 'Inter', 'SF Pro Display', -apple-system, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'SF Mono', 'Menlo', monospace;
}
```

Replace with:

```css
@import "tailwindcss";

@theme {
  /* Platinum Finance — cool-gray "silver" dark theme */
  --color-bg-primary: #0a0d12;
  --color-bg-secondary: #10151d;
  --color-bg-tertiary: #182029;
  --color-bg-elevated: #1f2833;
  --color-bg-hover: #26313d;

  --color-border-primary: #232c38;
  --color-border-secondary: #2f3b49;
  --color-border-focus: #4a5a6d;

  --color-text-primary: #eef1f6;
  --color-text-secondary: #9aa7b8;
  --color-text-muted: #667180;

  --color-accent-income: #4ade80;
  --color-accent-income-bg: rgba(74, 222, 128, 0.08);
  --color-accent-expense: #ef4444;
  --color-accent-expense-bg: rgba(239, 68, 68, 0.08);
  --color-accent-blue: #3b82f6;
  --color-accent-blue-bg: rgba(59, 130, 246, 0.08);
  --color-accent-warning: #f59e0b;
  --color-accent-warning-bg: rgba(245, 158, 11, 0.08);
  --color-accent-purple: #a855f7;
  --color-accent-purple-bg: rgba(168, 85, 247, 0.08);

  --font-sans: 'Inter', 'SF Pro Display', -apple-system, system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'SF Mono', 'Menlo', monospace;
}
```

Note: `--color-accent-blue` was already `#3b82f6` before this change (it's the same value as the new `primary`) — no edit needed there, it's shown above only because it's inside the block being replaced.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: passes with 0 errors (this is a pure CSS/constant value change, no type surface affected)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/stores/personalizationStore.ts src/renderer/styles/globals.css
git commit -m "feat(theme): switch default theme to Platinum Finance (blue/silver/red)"
```

---

### Task 2: Fix hardcoded radius in `ComplianceLog.tsx`

**Files:**
- Modify: `src/renderer/modules/debt-collection/ComplianceLog.tsx:398`

- [ ] **Step 1: Replace the hardcoded radius**

Current code (line 395-399):

```typescript
            <div
              key={entry.id || i}
              className={`flex items-start gap-3 px-3 py-2 text-xs border-l-2 ${entry.source === 'compliance' ? 'border-accent-blue' : 'border-border-primary'} hover:bg-bg-hover transition-colors`}
              style={{ borderRadius: '0 6px 6px 0' }}
            >
```

Replace with:

```typescript
            <div
              key={entry.id || i}
              className={`flex items-start gap-3 px-3 py-2 text-xs border-l-2 ${entry.source === 'compliance' ? 'border-accent-blue' : 'border-border-primary'} hover:bg-bg-hover transition-colors`}
              style={{ borderRadius: '0 var(--app-radius) var(--app-radius) 0' }}
            >
```

(This is a left-notch row style — square on the accent-stripe side, rounded on the other three corners. The shape is intentional; only the flat `6px` literal needs to become the theme radius variable.)

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: passes with 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/debt-collection/ComplianceLog.tsx
git commit -m "fix(ui): use --app-radius instead of hardcoded 6px in ComplianceLog row"
```

---

### Task 3: Fix hardcoded radius in `LegalToolkit.tsx`

**Files:**
- Modify: `src/renderer/modules/debt-collection/LegalToolkit.tsx:90,520`

- [ ] **Step 1: Replace both hardcoded radius occurrences**

Current code (line 90):

```typescript
              <div key={entry.id} className="flex items-start gap-3 px-3 py-2 border-l-2 border-border-primary text-xs hover:bg-bg-hover transition-colors" style={{ borderRadius: '0 6px 6px 0' }}>
```

Replace with:

```typescript
              <div key={entry.id} className="flex items-start gap-3 px-3 py-2 border-l-2 border-border-primary text-xs hover:bg-bg-hover transition-colors" style={{ borderRadius: '0 var(--app-radius) var(--app-radius) 0' }}>
```

Current code (lines 517-521):

```typescript
            <div
              key={a.id}
              className="flex items-start gap-3 px-3 py-3 border-l-2 border-accent-blue hover:bg-bg-hover transition-colors"
              style={{ borderRadius: '0 6px 6px 0' }}
            >
```

Replace with:

```typescript
            <div
              key={a.id}
              className="flex items-start gap-3 px-3 py-3 border-l-2 border-accent-blue hover:bg-bg-hover transition-colors"
              style={{ borderRadius: '0 var(--app-radius) var(--app-radius) 0' }}
            >
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: passes with 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/debt-collection/LegalToolkit.tsx
git commit -m "fix(ui): use --app-radius instead of hardcoded 6px in LegalToolkit rows"
```

---

### Task 4: Fix hardcoded white-overlay hovers in `CopilotPanel.tsx`

**Files:**
- Modify: `src/renderer/modules/copilot/CopilotPanel.tsx:389,396,417,425,491`

`bg-white/N` only works correctly in dark mode — it lightens whatever's underneath by a fixed white overlay, so in light mode (which this app supports) these hover states become nearly invisible against an already-light panel. `bg-bg-hover` is the existing token other components already use for this exact purpose (see `LegalToolkit.tsx` and `ComplianceLog.tsx`, both use `hover:bg-bg-hover`) and correctly resolves to the right shade in both modes.

- [ ] **Step 1: Replace all 5 occurrences**

Current code (line 389):
```typescript
            className="p-1.5 rounded hover:bg-white/5 transition-colors"
```
Replace with:
```typescript
            className="p-1.5 rounded hover:bg-bg-hover transition-colors"
```

Current code (line 396):
```typescript
            className="p-1.5 rounded hover:bg-white/5 transition-colors"
```
Replace with:
```typescript
            className="p-1.5 rounded hover:bg-bg-hover transition-colors"
```

Current code (line 417):
```typescript
                className={`flex items-center justify-between w-full px-4 py-2 text-left hover:bg-white/5 transition-colors ${t.id === threadId ? 'bg-white/5' : ''}`}
```
Replace with:
```typescript
                className={`flex items-center justify-between w-full px-4 py-2 text-left hover:bg-bg-hover transition-colors ${t.id === threadId ? 'bg-bg-hover' : ''}`}
```

Current code (line 425):
```typescript
                  className="p-1 rounded hover:bg-white/10 shrink-0"
```
Replace with:
```typescript
                  className="p-1 rounded hover:bg-bg-hover shrink-0"
```

Current code (line 491):
```typescript
              className="shrink-0 p-1.5 rounded transition-colors hover:bg-white/10"
```
Replace with:
```typescript
              className="shrink-0 p-1.5 rounded transition-colors hover:bg-bg-hover"
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: passes with 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/copilot/CopilotPanel.tsx
git commit -m "fix(ui): replace hardcoded bg-white overlays with bg-bg-hover token in CopilotPanel"
```

---

### Task 5: Fix hardcoded badge colors in `ExpenseForm.tsx`

**Files:**
- Modify: `src/renderer/modules/expenses/ExpenseForm.tsx:2189,2192`

Two adjacent badges — the flagged blue "1099-RELEVANT" tag, and an unflagged (the leak-check script only searches for blue hex) but equally hardcoded red "MISSING W-9" warning right next to it. Both fixed together since they're the same pattern in the same spot.

- [ ] **Step 1: Replace both hardcoded badges**

Current code (lines 2188-2196):

```typescript
                  {selectedVendor.is_1099_eligible ? (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: '#2563eb22', color: '#60a5fa' }}>1099-RELEVANT</span>
                  ) : null}
                  {selectedVendor.is_1099_eligible && selectedVendor.w9_status !== 'collected' && selectedVendor.w9_status !== 'on_file' && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: '#dc262622', color: '#f87171' }}
                      title="1099-eligible vendor without a W-9 on file — backup withholding may apply">
                      MISSING W-9 — BACKUP WITHHOLDING WARNING
```

Replace with:

```typescript
                  {selectedVendor.is_1099_eligible ? (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: 'var(--color-accent-blue-bg)', color: 'var(--color-accent-blue)' }}>1099-RELEVANT</span>
                  ) : null}
                  {selectedVendor.is_1099_eligible && selectedVendor.w9_status !== 'collected' && selectedVendor.w9_status !== 'on_file' && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: 'var(--color-accent-expense-bg)', color: 'var(--color-accent-expense)' }}
                      title="1099-eligible vendor without a W-9 on file — backup withholding may apply">
                      MISSING W-9 — BACKUP WITHHOLDING WARNING
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: passes with 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/expenses/ExpenseForm.tsx
git commit -m "fix(ui): use accent tokens instead of hardcoded hex in ExpenseForm 1099/W-9 badges"
```

---

### Task 6: Update print-report accent color in `BudgetVsActualReport.tsx`

**Files:**
- Modify: `src/renderer/modules/reports/BudgetVsActualReport.tsx:155`

This is a standalone, self-contained print/export HTML string (its own `<style>` block, white/paper background, independent of the app's runtime theme — appropriate for a printed report). It can't reliably reference the app's CSS custom properties in an exported/printed context, so the fix is to update the literal hex to the new brand blue rather than introduce a variable reference — keeping the print output's accent color aligned with the app's new identity.

- [ ] **Step 1: Replace the literal hex**

Current code (line 155):

```typescript
        <div class="stat" style="border-left:3px solid #2563eb;"><div class="stat-lbl">Actual Spend</div><div class="stat-val" style="color:#2563eb;">${fmt.format(totalActual)}</div></div>
```

Replace with:

```typescript
        <div class="stat" style="border-left:3px solid #3b82f6;"><div class="stat-lbl">Actual Spend</div><div class="stat-val" style="color:#3b82f6;">${fmt.format(totalActual)}</div></div>
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: passes with 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/renderer/modules/reports/BudgetVsActualReport.tsx
git commit -m "fix(ui): update Budget vs Actual print report accent to new brand blue"
```

---

### Task 7: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the leak-check script and confirm counts dropped**

Run: `bash scripts/ui-leak-check.sh`
Expected output:
```
== borderRadius: 0 / '0px' (files) ==
0
== bg-white / text-gray-* / border-gray-* (files) ==
0
== hard-coded blue hex 60a5fa/3b82f6/2563eb (module files) ==
2
```
(The blue-hex count won't hit 0 — `IndustryPresetSettings.tsx` and `InvoiceSettings.tsx` still legitimately contain hex values, as documented above. It must not exceed 2, and must not include any of the 3 files fixed in Tasks 2-5.)

- [ ] **Step 2: Start the dev server**

Use the `Vite Dev Server` preview config (or run `npm run dev` if working outside the preview tooling) and open the app.

- [ ] **Step 3: Visually verify the Dashboard**

Confirm: primary buttons/active nav render blue (`#3b82f6`), background reads as cool dark gray rather than neutral black, income figures are green, expense/negative figures are red.

- [ ] **Step 4: Visually verify Invoicing**

Confirm: "Paid" badges are green, "Overdue" badges are red, no leftover pink/rose tones anywhere.

- [ ] **Step 5: Visually verify Debt Collection**

Confirm: the audit-log rows in `ComplianceLog.tsx`/`LegalToolkit.tsx` still show the left-notch shape correctly (square left edge, rounded right edge) — this confirms the `--app-radius` substitution didn't break the shape.

- [ ] **Step 6: Visually verify the AI Copilot panel**

Open the Copilot panel, hover the new-conversation/close/history buttons, and confirm the hover highlight is visible and reads as a neutral lightening (not a stray white flash) — confirms the `bg-white/N` → `bg-bg-hover` fix.

- [ ] **Step 7: Spot-check light mode**

In Settings → Customization, switch theme mode to Light. Confirm the app still renders correctly (light mode's palette is untouched by this change, but the accent colors — now blue/red instead of emerald/rose — should still look correct against the light background).

- [ ] **Step 8: Final full-repo typecheck**

Run: `npm run typecheck`
Expected: passes with 0 errors
