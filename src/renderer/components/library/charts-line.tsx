import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

/**
 * Line / area chart primitives — pure presentational, hand-rolled inline SVG.
 *
 * Design goals (upgraded): every chart is INFORMATIONAL (shows real values via
 * visible axis labels + a last-value readout + per-point hover tooltips),
 * ACCURATE (honest scaling — area charts baseline at zero so the filled area
 * reflects true magnitude; correct handling of flat series, single points, and
 * negatives), and DYNAMIC (data-driven; native <title> tooltips reveal the
 * exact value at each point). Every prop is optional with a sensible default so
 * each component still renders a believable preview with zero props. Geometry
 * is committed at render time (no resize observers) so these print cleanly
 * inside Electron's print window.
 */

const ACCENT_BLUE = 'var(--color-accent-blue, #60a5fa)';
const ACCENT_INCOME = 'var(--color-accent-income, #34d399)';
const ACCENT_EXPENSE = 'var(--color-accent-expense, #f87171)';
const ACCENT_PURPLE = 'var(--color-accent-purple, #c084fc)';
const GRID = 'var(--color-glass-border, rgba(255,255,255,0.08))';
const TEXT_MUTED = 'var(--color-text-muted, #8b91a1)';
const TEXT_PRIMARY = 'var(--color-text-primary, #e8eaf0)';

/** Compact, human-readable number: 1.2K, 3.4M, 12, 0.8. */
export function formatCompact(n: number): string {
  if (!isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`;
  if (abs >= 100 || Number.isInteger(n)) return `${Math.round(n)}`;
  return `${n.toFixed(1)}`;
}

export type Baseline = 'auto' | 'zero';

/**
 * Map a numeric series to evenly spaced SVG points within a padded box.
 *
 * `baseline='zero'` floors the y-scale at 0 (honest magnitude — the right
 * choice for area fills). `baseline='auto'` floors at the data min (maximizes
 * visible variation — fine for sparklines/line charts WHEN the axis is
 * labeled). A flat series renders as a centered horizontal line rather than
 * pinned to an edge; a single point renders centered.
 */
function seriesToPoints(
  data: number[],
  width: number,
  height: number,
  pad: number,
  baseline: Baseline = 'auto',
): { points: Array<{ x: number; y: number }>; min: number; max: number } {
  if (data.length === 0) return { points: [], min: 0, max: 0 };
  const dMin = Math.min(...data);
  const dMax = Math.max(...data);
  // Floor at zero for honest area fills (only when data doesn't go negative).
  const min = baseline === 'zero' && dMin >= 0 ? 0 : dMin;
  const max = dMax;
  const flat = max - min === 0;
  const span = flat ? 1 : max - min;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const step = data.length > 1 ? innerW / (data.length - 1) : 0;
  const points = data.map((v, i) => ({
    x: data.length > 1 ? pad + i * step : pad + innerW / 2,
    // Flat series → center vertically (0.5) instead of pinning to the floor.
    y: flat ? pad + innerH / 2 : pad + innerH - ((v - min) / span) * innerH,
  }));
  return { points, min: dMin, max: dMax };
}

function toPath(points: Array<{ x: number; y: number }>): string {
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(' ');
}

/** Invisible-but-hoverable hit dots that surface each value as a native tooltip. */
function HoverDots({
  points,
  data,
  color,
  labels,
  valueFormat,
}: {
  points: Array<{ x: number; y: number }>;
  data: number[];
  color: string;
  labels?: string[];
  valueFormat: (n: number) => string;
}) {
  return (
    <>
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={8} fill="transparent" style={{ cursor: 'pointer' }}>
          <title>{`${labels?.[i] ? labels[i] + ': ' : ''}${valueFormat(data[i])}`}</title>
        </circle>
      ))}
      {/* faint visible dots so points are discoverable */}
      {points.map((p, i) => (
        <circle key={`v${i}`} cx={p.x} cy={p.y} r={1.6} fill={color} fillOpacity={0.55} pointerEvents="none" />
      ))}
    </>
  );
}

const DEFAULT_SERIES = [12, 18, 15, 24, 22, 30, 27, 36, 33, 42];

/* ------------------------------------------------------------------ */
/* LineChartMini                                                       */
/* ------------------------------------------------------------------ */
export interface LineChartMiniProps {
  data?: number[];
  labels?: string[];
  width?: number;
  height?: number;
  color?: string;
  showGrid?: boolean;
  showDots?: boolean;
  /** Show min/max y-axis labels + the latest value (default true). */
  showValues?: boolean;
  baseline?: Baseline;
  valueFormat?: (n: number) => string;
  strokeWidth?: number;
  className?: string;
}

export function LineChartMini({
  data = DEFAULT_SERIES,
  labels,
  width = 220,
  height = 96,
  color = ACCENT_BLUE,
  showGrid = true,
  showDots = false,
  showValues = true,
  baseline = 'auto',
  valueFormat = formatCompact,
  strokeWidth = 2,
  className,
}: LineChartMiniProps) {
  const pad = showValues ? 12 : 8;
  const { points, min, max } = seriesToPoints(data, width, height, pad, baseline);
  const gridLines = [0.25, 0.5, 0.75];
  const last = data[data.length - 1] ?? 0;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={`Line chart, latest ${valueFormat(last)}`}
    >
      {showGrid &&
        gridLines.map((g) => (
          <line
            key={g}
            x1={pad}
            x2={width - pad}
            y1={pad + (height - pad * 2) * g}
            y2={pad + (height - pad * 2) * g}
            stroke={GRID}
            strokeWidth={1}
          />
        ))}
      <path d={toPath(points)} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      {showDots &&
        points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={color} />)}
      <HoverDots points={points} data={data} color={color} labels={labels} valueFormat={valueFormat} />
      {showValues && (
        <>
          {/* y-axis range so the scale is honest/legible */}
          <text x={2} y={pad} fontSize={9} fill={TEXT_MUTED} dominantBaseline="hanging">{valueFormat(max)}</text>
          <text x={2} y={height - 2} fontSize={9} fill={TEXT_MUTED}>{valueFormat(min)}</text>
          {/* latest value pinned at the end point */}
          {points.length > 0 && (
            <>
              <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={3} fill={color} />
              <text
                x={width - pad}
                y={pad}
                fontSize={11}
                fontWeight={700}
                textAnchor="end"
                dominantBaseline="hanging"
                fill={TEXT_PRIMARY}
              >
                {valueFormat(last)}
              </text>
            </>
          )}
        </>
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* AreaChartMini                                                       */
/* ------------------------------------------------------------------ */
export interface AreaChartMiniProps {
  data?: number[];
  labels?: string[];
  width?: number;
  height?: number;
  color?: string;
  fillOpacity?: number;
  /** Honest magnitude: area fills from zero by default. */
  baseline?: Baseline;
  showValues?: boolean;
  valueFormat?: (n: number) => string;
  strokeWidth?: number;
  className?: string;
}

export function AreaChartMini({
  data = DEFAULT_SERIES,
  labels,
  width = 220,
  height = 96,
  color = ACCENT_INCOME,
  fillOpacity = 0.18,
  baseline = 'zero',
  showValues = true,
  valueFormat = formatCompact,
  strokeWidth = 2,
  className,
}: AreaChartMiniProps) {
  const pad = showValues ? 12 : 8;
  const { points, min, max } = seriesToPoints(data, width, height, pad, baseline);
  const gradId = React.useId();
  const baseY = height - pad;
  const last = data[data.length - 1] ?? 0;
  const areaPath =
    points.length > 0
      ? `${toPath(points)} L ${points[points.length - 1].x.toFixed(2)} ${baseY} L ${points[0].x.toFixed(2)} ${baseY} Z`
      : '';

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={`Area chart, latest ${valueFormat(last)}`}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={fillOpacity * 2} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} stroke="none" />
      <path d={toPath(points)} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      <HoverDots points={points} data={data} color={color} labels={labels} valueFormat={valueFormat} />
      {showValues && (
        <>
          <text x={2} y={pad} fontSize={9} fill={TEXT_MUTED} dominantBaseline="hanging">{valueFormat(max)}</text>
          <text x={2} y={height - 2} fontSize={9} fill={TEXT_MUTED}>{baseline === 'zero' ? '0' : valueFormat(min)}</text>
          {points.length > 0 && (
            <>
              <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r={3} fill={color} />
              <text x={width - pad} y={pad} fontSize={11} fontWeight={700} textAnchor="end" dominantBaseline="hanging" fill={TEXT_PRIMARY}>
                {valueFormat(last)}
              </text>
            </>
          )}
        </>
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Sparkline                                                           */
/* ------------------------------------------------------------------ */
export interface SparklineProps {
  data?: number[];
  width?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
  endDot?: boolean;
  valueFormat?: (n: number) => string;
  className?: string;
}

export function Sparkline({
  data = [4, 6, 5, 8, 7, 9, 8, 11, 10, 13, 12, 15],
  width = 96,
  height = 28,
  color = ACCENT_BLUE,
  strokeWidth = 1.5,
  endDot = true,
  valueFormat = formatCompact,
  className,
}: SparklineProps) {
  const pad = 3;
  const { points } = seriesToPoints(data, width, height, pad, 'auto');
  const last = points[points.length - 1];
  const first = data[0] ?? 0;
  const final = data[data.length - 1] ?? 0;
  // Color the end dot by direction so a bare sparkline still conveys trend.
  const dotColor = final >= first ? ACCENT_INCOME : ACCENT_EXPENSE;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={`Sparkline, latest ${valueFormat(final)}`}
    >
      <title>{`${valueFormat(first)} → ${valueFormat(final)}`}</title>
      <path d={toPath(points)} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      {endDot && last && <circle cx={last.x} cy={last.y} r={2} fill={dotColor} />}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* TrendLine                                                           */
/* ------------------------------------------------------------------ */
export interface TrendLineProps {
  data?: number[];
  labels?: string[];
  width?: number;
  height?: number;
  color?: string;
  label?: string;
  /** Color the line by direction (up=income, down=expense). */
  directional?: boolean;
  valueFormat?: (n: number) => string;
  strokeWidth?: number;
  className?: string;
}

export function TrendLine({
  data = [20, 24, 22, 28, 31, 29, 35, 40],
  labels,
  width = 240,
  height = 100,
  color,
  label,
  directional = true,
  valueFormat = formatCompact,
  strokeWidth = 2,
  className,
}: TrendLineProps) {
  const pad = 10;
  const labelW = 56;
  const { points } = seriesToPoints(data, width - labelW, height, pad, 'auto');
  const last = points[points.length - 1];
  const first = data[0] ?? 0;
  const final = data[data.length - 1] ?? 0;
  const up = final >= first;
  const pct = (((final - first) / (first || 1)) * 100);
  const lineColor = color ?? (directional ? (up ? ACCENT_INCOME : ACCENT_EXPENSE) : ACCENT_INCOME);
  const resolvedLabel = label ?? `${up ? '+' : ''}${pct.toFixed(0)}%`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={`Trend line ${resolvedLabel}, latest ${valueFormat(final)}`}
    >
      <path d={toPath(points)} fill="none" stroke={lineColor} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      <HoverDots points={points} data={data} color={lineColor} labels={labels} valueFormat={valueFormat} />
      {last && (
        <>
          <circle cx={last.x} cy={last.y} r={4} fill={lineColor} />
          <circle cx={last.x} cy={last.y} r={7} fill="none" stroke={lineColor} strokeOpacity={0.35} strokeWidth={2} />
          <text x={last.x + 12} y={last.y - 5} dominantBaseline="central" fontSize={12} fontWeight={700} fill={TEXT_PRIMARY}>
            {valueFormat(final)}
          </text>
          <text x={last.x + 12} y={last.y + 9} dominantBaseline="central" fontSize={10} fontWeight={600} fill={lineColor}>
            {resolvedLabel}
          </text>
        </>
      )}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* MultiSeriesLine                                                     */
/* ------------------------------------------------------------------ */
export interface MultiSeriesLineProps {
  seriesA?: number[];
  seriesB?: number[];
  labels?: string[];
  labelA?: string;
  labelB?: string;
  colorA?: string;
  colorB?: string;
  width?: number;
  height?: number;
  showGrid?: boolean;
  showLegend?: boolean;
  /** Show min/max y-axis labels + each series' latest value in the legend. */
  showValues?: boolean;
  valueFormat?: (n: number) => string;
  className?: string;
}

export function MultiSeriesLine({
  seriesA = [18, 22, 20, 28, 26, 34, 31, 40],
  seriesB = [12, 14, 17, 16, 21, 24, 23, 27],
  labels,
  labelA = 'Revenue',
  labelB = 'Expenses',
  colorA = ACCENT_BLUE,
  colorB = ACCENT_PURPLE,
  width = 260,
  height = 120,
  showGrid = true,
  showLegend = true,
  showValues = true,
  valueFormat = formatCompact,
  className,
}: MultiSeriesLineProps) {
  const pad = showValues ? 14 : 10;
  const chartH = showLegend ? height - 22 : height;
  // Share a common scale across both series so they're visually comparable.
  const all = [...seriesA, ...seriesB];
  const min = all.length ? Math.min(...all) : 0;
  const max = all.length ? Math.max(...all) : 1;
  const span = max - min || 1;
  const innerW = width - pad * 2;
  const innerH = chartH - pad * 2;

  const scale = (data: number[]) => {
    const step = data.length > 1 ? innerW / (data.length - 1) : 0;
    return data.map((v, i) => ({
      x: data.length > 1 ? pad + i * step : pad + innerW / 2,
      y: pad + innerH - ((v - min) / span) * innerH,
    }));
  };

  const ptsA = scale(seriesA);
  const ptsB = scale(seriesB);
  const gridLines = [0.25, 0.5, 0.75];
  const lastA = seriesA[seriesA.length - 1] ?? 0;
  const lastB = seriesB[seriesB.length - 1] ?? 0;

  return (
    <div className={className} style={{ width }}>
      <svg width={width} height={chartH} viewBox={`0 0 ${width} ${chartH}`} role="img" aria-label="Multi-series line chart">
        {showGrid &&
          gridLines.map((g) => (
            <line
              key={g}
              x1={pad}
              x2={width - pad}
              y1={pad + innerH * g}
              y2={pad + innerH * g}
              stroke={GRID}
              strokeWidth={1}
            />
          ))}
        <path d={toPath(ptsA)} fill="none" stroke={colorA} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <path d={toPath(ptsB)} fill="none" stroke={colorB} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <HoverDots points={ptsA} data={seriesA} color={colorA} labels={labels} valueFormat={valueFormat} />
        <HoverDots points={ptsB} data={seriesB} color={colorB} labels={labels} valueFormat={valueFormat} />
        {showValues && (
          <>
            <text x={2} y={pad} fontSize={9} fill={TEXT_MUTED} dominantBaseline="hanging">{valueFormat(max)}</text>
            <text x={2} y={chartH - 2} fontSize={9} fill={TEXT_MUTED}>{valueFormat(min)}</text>
          </>
        )}
      </svg>
      {showLegend && (
        <div className="flex items-center gap-4 text-xs text-text-secondary" style={{ marginTop: 6 }}>
          <span className="inline-flex items-center gap-1.5">
            <span style={{ width: 10, height: 2, borderRadius: 1, backgroundColor: colorA, display: 'inline-block' }} />
            {labelA}{showValues ? <strong className="text-text-primary ml-1">{valueFormat(lastA)}</strong> : null}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span style={{ width: 10, height: 2, borderRadius: 1, backgroundColor: colorB, display: 'inline-block' }} />
            {labelB}{showValues ? <strong className="text-text-primary ml-1">{valueFormat(lastB)}</strong> : null}
          </span>
          {lastA >= lastB
            ? <TrendingUp size={12} className="text-accent-income ml-auto" />
            : <TrendingDown size={12} className="text-accent-expense ml-auto" />}
        </div>
      )}
    </div>
  );
}
