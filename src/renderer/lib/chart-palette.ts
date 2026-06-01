// ─── Warm Structured Glass — data-visualization palette ──────────────
//
// SANCTIONED HEX EXCEPTION. Recharts renders colors into SVG slots
// (gradient stopColor, <Cell> / Treemap content fills, axis ticks) where
// CSS custom properties don't resolve reliably. So — like `globals.css
// @theme` and `personalizationStore` — this file is an allowed home for
// raw hex. Charts should import from here instead of inlining colors, so
// re-theming every chart is a one-file edit and the data identity stays
// cohesive across all 40 modules.
//
// Values mirror the warm token palette (emerald / amber / warm-rose) so
// charts read as part of the same surface, not a cold island.

/** Semantic money colors — keep these in sync with --color-accent-income/expense. */
export const CHART_INCOME = '#34d399';   // emerald
export const CHART_EXPENSE = '#fb7185';  // warm rose
export const CHART_NEUTRAL = '#9a948a';  // warm muted

/**
 * Categorical series palette (pie slices, treemap cells, multi-series).
 * Warm-led ordering: emerald first (brand), amber highlight, then a
 * differentiated spread. Reorder this array to restyle every categorical
 * chart at once — the first colors carry the most visual weight.
 */
export const CHART_SERIES = [
  '#34d399', // emerald
  '#f59e0b', // amber
  '#60a5fa', // info blue
  '#c084fc', // purple
  '#2dd4bf', // teal
  '#fb7185', // warm rose
  '#fb923c', // orange
  '#38bdf8', // cyan
];

/** Chrome for chart frames — warm graphite, matched to the structured-border tokens. */
export const CHART_GRID = 'rgba(255,255,255,0.06)';     // --hairline
export const CHART_AXIS = '#9a948a';                     // warm muted tick labels
export const CHART_TOOLTIP_BG = '#1d1e22';               // --color-bg-elevated-solid
export const CHART_TOOLTIP_BORDER = 'rgba(255,255,255,0.11)'; // --structure

/** Pick a categorical color by index (wraps). */
export const seriesColor = (i: number): string => CHART_SERIES[i % CHART_SERIES.length];
