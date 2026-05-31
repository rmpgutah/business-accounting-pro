import React from 'react';
import { TrendingUp } from 'lucide-react';

/**
 * Line / area chart primitives — pure presentational, hand-rolled inline SVG.
 *
 * No chart library, no data fetching. Every prop is optional with a sensible
 * default so each component renders a believable preview with zero props.
 * Geometry is committed at render time (no resize observers) so these print
 * cleanly inside Electron's print window.
 */

const ACCENT_BLUE = 'var(--color-accent-blue, #60a5fa)';
const ACCENT_INCOME = 'var(--color-accent-income, #34d399)';
const ACCENT_PURPLE = 'var(--color-accent-purple, #c084fc)';
const GRID = 'var(--color-glass-border, rgba(255,255,255,0.08))';

/** Map a numeric series to evenly spaced SVG points within a padded box. */
function seriesToPoints(
  data: number[],
  width: number,
  height: number,
  pad: number,
): Array<{ x: number; y: number }> {
  if (data.length === 0) return [];
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const step = data.length > 1 ? innerW / (data.length - 1) : 0;
  return data.map((v, i) => ({
    x: pad + i * step,
    y: pad + innerH - ((v - min) / span) * innerH,
  }));
}

function toPath(points: Array<{ x: number; y: number }>): string {
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(' ');
}

const DEFAULT_SERIES = [12, 18, 15, 24, 22, 30, 27, 36, 33, 42];

/* ------------------------------------------------------------------ */
/* LineChartMini                                                       */
/* ------------------------------------------------------------------ */
export interface LineChartMiniProps {
  data?: number[];
  width?: number;
  height?: number;
  color?: string;
  /** Draw faint horizontal gridlines. */
  showGrid?: boolean;
  /** Draw a dot on each data point. */
  showDots?: boolean;
  strokeWidth?: number;
  className?: string;
}

export function LineChartMini({
  data = DEFAULT_SERIES,
  width = 220,
  height = 96,
  color = ACCENT_BLUE,
  showGrid = true,
  showDots = false,
  strokeWidth = 2,
  className,
}: LineChartMiniProps) {
  const pad = 8;
  const points = seriesToPoints(data, width, height, pad);
  const gridLines = [0.25, 0.5, 0.75];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label="Line chart"
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
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* AreaChartMini                                                       */
/* ------------------------------------------------------------------ */
export interface AreaChartMiniProps {
  data?: number[];
  width?: number;
  height?: number;
  color?: string;
  /** Opacity of the filled area under the line. */
  fillOpacity?: number;
  strokeWidth?: number;
  className?: string;
}

export function AreaChartMini({
  data = DEFAULT_SERIES,
  width = 220,
  height = 96,
  color = ACCENT_INCOME,
  fillOpacity = 0.18,
  strokeWidth = 2,
  className,
}: AreaChartMiniProps) {
  const pad = 8;
  const points = seriesToPoints(data, width, height, pad);
  const gradId = React.useId();
  const baseY = height - pad;
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
      aria-label="Area chart"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={fillOpacity * 2} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} stroke="none" />
      <path d={toPath(points)} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
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
  /** Highlight the final point with a dot. */
  endDot?: boolean;
  className?: string;
}

export function Sparkline({
  data = [4, 6, 5, 8, 7, 9, 8, 11, 10, 13, 12, 15],
  width = 96,
  height = 28,
  color = ACCENT_BLUE,
  strokeWidth = 1.5,
  endDot = true,
  className,
}: SparklineProps) {
  const pad = 3;
  const points = seriesToPoints(data, width, height, pad);
  const last = points[points.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label="Sparkline"
    >
      <path d={toPath(points)} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      {endDot && last && <circle cx={last.x} cy={last.y} r={2} fill={color} />}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* TrendLine                                                           */
/* ------------------------------------------------------------------ */
export interface TrendLineProps {
  data?: number[];
  width?: number;
  height?: number;
  color?: string;
  /** Label rendered next to the end-point dot. */
  label?: string;
  strokeWidth?: number;
  className?: string;
}

export function TrendLine({
  data = [20, 24, 22, 28, 31, 29, 35, 40],
  width = 240,
  height = 100,
  color = ACCENT_INCOME,
  label,
  strokeWidth = 2,
  className,
}: TrendLineProps) {
  const pad = 10;
  const labelW = label ? 56 : 14;
  const points = seriesToPoints(data, width - labelW, height, pad);
  const last = points[points.length - 1];
  const first = data[0] ?? 0;
  const final = data[data.length - 1] ?? 0;
  const up = final >= first;
  const resolvedLabel =
    label ?? `${up ? '+' : ''}${(((final - first) / (first || 1)) * 100).toFixed(0)}%`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label="Trend line"
    >
      <path d={toPath(points)} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      {last && (
        <>
          <circle cx={last.x} cy={last.y} r={4} fill={color} />
          <circle cx={last.x} cy={last.y} r={7} fill="none" stroke={color} strokeOpacity={0.35} strokeWidth={2} />
          <text
            x={last.x + 10}
            y={last.y}
            dominantBaseline="central"
            fontSize={12}
            fontWeight={600}
            fill="var(--color-text-primary, #e8eaf0)"
          >
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
  labelA?: string;
  labelB?: string;
  colorA?: string;
  colorB?: string;
  width?: number;
  height?: number;
  showGrid?: boolean;
  showLegend?: boolean;
  className?: string;
}

export function MultiSeriesLine({
  seriesA = [18, 22, 20, 28, 26, 34, 31, 40],
  seriesB = [12, 14, 17, 16, 21, 24, 23, 27],
  labelA = 'Revenue',
  labelB = 'Expenses',
  colorA = ACCENT_BLUE,
  colorB = ACCENT_PURPLE,
  width = 260,
  height = 120,
  showGrid = true,
  showLegend = true,
  className,
}: MultiSeriesLineProps) {
  const pad = 10;
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
      x: pad + i * step,
      y: pad + innerH - ((v - min) / span) * innerH,
    }));
  };

  const ptsA = scale(seriesA);
  const ptsB = scale(seriesB);
  const gridLines = [0.25, 0.5, 0.75];

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
      </svg>
      {showLegend && (
        <div className="flex items-center gap-4 text-xs text-text-secondary" style={{ marginTop: 6 }}>
          <span className="inline-flex items-center gap-1.5">
            <span style={{ width: 10, height: 2, borderRadius: 1, backgroundColor: colorA, display: 'inline-block' }} />
            {labelA}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span style={{ width: 10, height: 2, borderRadius: 1, backgroundColor: colorB, display: 'inline-block' }} />
            {labelB}
          </span>
          <TrendingUp size={12} className="text-text-muted ml-auto" />
        </div>
      )}
    </div>
  );
}
