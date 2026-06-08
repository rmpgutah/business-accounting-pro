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
