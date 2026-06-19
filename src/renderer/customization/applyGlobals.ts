// src/renderer/customization/applyGlobals.ts
//
// Bridges the persisted customization store to the live DOM for the subset of
// options that have a GLOBAL, CSS-expressible effect. Mirrors how
// applyPersonalization() pushes preferences onto :root CSS variables, so any
// component can honor a customization option just by reading the variable —
// no per-component store subscription required. Subscribed to the store so
// changes in the Customization Center apply instantly, app-wide.
//
// This is the read-side foundation for "making options functional": adding a
// new global option = one line here + using its CSS var in the target markup.

import { useCustomizationStore } from '../stores/customizationStore';
import { optionKey } from './registry';

type Value = boolean | string | number;

function val(section: string, id: string): Value | undefined {
  return useCustomizationStore.getState().get(optionKey(section, id));
}
function num(section: string, id: string, fallback: number): number {
  const v = Number(val(section, id));
  return Number.isFinite(v) ? v : fallback;
}
function bool(section: string, id: string): boolean {
  return Boolean(val(section, id));
}
function str(section: string, id: string, fallback: string): string {
  const v = val(section, id);
  return v == null ? fallback : String(v);
}

/** Push the global-impact customization options onto :root CSS variables. */
export function applyCustomizationGlobals(): void {
  const root = document.documentElement;
  if (!root) return;

  // ── App content width (Dashboard › Layout) ───────────────────────────
  // full-width-content overrides the max-content-width cap. AppShell centers
  // #main-content within this width.
  const fullWidth = bool('dashboard', 'full-width-content');
  const maxW = num('dashboard', 'max-content-width', 1440);
  root.style.setProperty('--app-content-max-width', fullWidth ? 'none' : `${maxW}px`);

  // ── Dashboard tile/grid appearance (Dashboard › Layout) ──────────────
  root.style.setProperty('--cust-grid-cols', String(Math.max(1, num('dashboard', 'grid-columns', 3))));
  root.style.setProperty('--cust-tile-gap', `${num('dashboard', 'tile-gap', 16)}px`);
  root.style.setProperty('--cust-tile-radius', `${num('dashboard', 'tile-corner-radius', 6)}px`);
  root.style.setProperty(
    '--cust-tile-shadow',
    bool('dashboard', 'tile-shadow') ? '0 1px 3px rgba(0,0,0,0.35)' : 'none',
  );

  // ── Density (Dashboard › Layout) → a scale other spacing can multiply ─
  const density = str('dashboard', 'layout-density', 'comfortable');
  root.setAttribute('data-density', density);
  root.style.setProperty(
    '--cust-density-scale',
    density === 'compact' ? '0.85' : density === 'spacious' ? '1.15' : '1',
  );

  // ── Section dividers (Dashboard › Layout) ────────────────────────────
  root.setAttribute('data-section-dividers', bool('dashboard', 'section-dividers') ? 'on' : 'off');

  // ── Accent / chart colors (Dashboard › Colors & Theme) ───────────────
  // The accent color drives `--color-accent-blue`, which is referenced by
  // active sidebar items, primary buttons, focus rings, and KPI highlights.
  // Only push if the value looks like a valid #RRGGBB to avoid corrupting
  // the variable with an empty / partial input mid-edit.
  const isHex = (v: unknown): v is string =>
    typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

  const accent = val('dashboard', 'accent-color');
  if (isHex(accent)) root.style.setProperty('--color-accent-blue', accent);

  const tileBg = val('dashboard', 'tile-background-color');
  if (isHex(tileBg)) root.style.setProperty('--cust-tile-bg', tileBg);

  const dashBg = val('dashboard', 'dashboard-background-color');
  if (isHex(dashBg)) root.style.setProperty('--cust-dashboard-bg', dashBg);

  const gridLine = val('dashboard', 'grid-line-color');
  if (isHex(gridLine)) root.style.setProperty('--cust-grid-line', gridLine);

  // Chart series — exposed for any chart component that wants to honor the
  // user's color choices (e.g. AmortizationChart, KPI sparklines).
  const series: Array<[string, string]> = [
    ['revenue-color', '--cust-series-revenue'],
    ['expense-color', '--cust-series-expense'],
    ['profit-color', '--cust-series-profit'],
    ['cash-color', '--cust-series-cash'],
    ['kpi-color-positive', '--cust-series-positive'],
    ['kpi-color-negative', '--cust-series-negative'],
    ['kpi-color-neutral', '--cust-series-neutral'],
    ['overdue-highlight-color', '--cust-overdue'],
  ];
  for (const [id, cssVar] of series) {
    const c = val('dashboard', id);
    if (isHex(c)) root.style.setProperty(cssVar, c);
  }

  // ── Invoicing accessibility & global affordances ─────────────────────
  // These are scoped to the invoicing section in the Customization Center
  // but their effect is most useful when applied app-wide — they're CSS-
  // expressible and the user almost certainly wants them everywhere.
  const fontScale = Number(val('invoicing', 'a11y-font-scale'));
  if (Number.isFinite(fontScale) && fontScale >= 50 && fontScale <= 250) {
    root.style.setProperty('--cust-font-scale', String(fontScale / 100));
  }
  // Reduced motion → matches the data attribute pattern other features use
  // (see existing `data-density`). Components and Tailwind classes can key
  // off this with a sibling selector like `[data-reduce-motion="on"] *`.
  root.setAttribute(
    'data-reduce-motion',
    bool('invoicing', 'a11y-reduce-motion') ? 'on' : 'off',
  );
  root.setAttribute(
    'data-high-contrast',
    bool('invoicing', 'a11y-high-contrast') ? 'on' : 'off',
  );
  root.setAttribute(
    'data-focus-visible',
    bool('invoicing', 'a11y-focus-outline') ? 'on' : 'off',
  );
}

let unsubscribe: (() => void) | null = null;

/**
 * Apply once and keep applying on every customization change. Idempotent —
 * safe to call multiple times (only one subscription is ever created).
 */
export function subscribeCustomizationGlobals(): void {
  applyCustomizationGlobals();
  if (unsubscribe) return;
  unsubscribe = useCustomizationStore.subscribe(() => applyCustomizationGlobals());
}
