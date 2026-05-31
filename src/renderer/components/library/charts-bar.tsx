import React from 'react';

/**
 * charts-bar.tsx — pure presentational bar/column chart primitives.
 *
 * Hand-rolled inline SVG (no chart library). Each component renders with
 * zero props using believable mock defaults, and matches the glass/block
 * theme via var(--color-…) tokens and theme utility classes.
 */

const ACCENT = 'var(--color-accent-blue, #3b82f6)';
const ACCENT_GREEN = 'var(--color-accent-green, #22c55e)';
const ACCENT_RED = 'var(--color-accent-red, #ef4444)';
const TRACK = 'var(--color-bg-tertiary, #2e2e2e)';

/* ------------------------------------------------------------------ */
/* BarChartMini — vertical bars SVG                                    */
/* ------------------------------------------------------------------ */

export interface BarChartMiniDatum {
  label: string;
  value: number;
}

export interface BarChartMiniProps {
  data?: BarChartMiniDatum[];
  title?: string;
  color?: string;
  height?: number;
  showLabels?: boolean;
  valueFormat?: (v: number) => string;
  className?: string;
}

export function BarChartMini({
  data = [
    { label: 'Jan', value: 4200 },
    { label: 'Feb', value: 3800 },
    { label: 'Mar', value: 5100 },
    { label: 'Apr', value: 4600 },
    { label: 'May', value: 6200 },
    { label: 'Jun', value: 5400 },
  ],
  title = 'Monthly Revenue',
  color = ACCENT,
  height = 140,
  showLabels = true,
  valueFormat = (v) => `$${(v / 1000).toFixed(1)}k`,
  className,
}: BarChartMiniProps) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const gap = 8;
  const barW = 28;
  const w = data.length * (barW + gap) + gap;
  const chartH = height;

  return (
    <div className={`block-card ${className ?? ''}`} style={{ padding: 16 }}>
      {title && (
        <div className="text-sm font-semibold text-text-primary" style={{ marginBottom: 12 }}>
          {title}
        </div>
      )}
      <svg width="100%" viewBox={`0 0 ${w} ${chartH + (showLabels ? 22 : 0)}`} aria-hidden="true">
        {data.map((d, i) => {
          const h = (d.value / max) * (chartH - 8);
          const x = gap + i * (barW + gap);
          const y = chartH - h;
          return (
            <g key={i}>
              <rect x={x} y={0} width={barW} height={chartH} rx={4} fill={TRACK} opacity={0.4} />
              <rect x={x} y={y} width={barW} height={h} rx={4} fill={color}>
                <title>{`${d.label}: ${valueFormat(d.value)}`}</title>
              </rect>
              {showLabels && (
                <text
                  x={x + barW / 2}
                  y={chartH + 15}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--color-text-muted, #9ca3af)"
                >
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* HorizontalBarChart — horizontal bars with labels                    */
/* ------------------------------------------------------------------ */

export interface HorizontalBarDatum {
  label: string;
  value: number;
  color?: string;
}

export interface HorizontalBarChartProps {
  data?: HorizontalBarDatum[];
  title?: string;
  valueFormat?: (v: number) => string;
  barHeight?: number;
  className?: string;
}

export function HorizontalBarChart({
  data = [
    { label: 'Office Supplies', value: 8200 },
    { label: 'Software', value: 6400 },
    { label: 'Travel', value: 4100 },
    { label: 'Marketing', value: 3300 },
    { label: 'Utilities', value: 1900 },
  ],
  title = 'Top Expense Categories',
  valueFormat = (v) => `$${v.toLocaleString()}`,
  barHeight = 22,
  className,
}: HorizontalBarChartProps) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const palette = [ACCENT, ACCENT_GREEN, '#a855f7', '#f59e0b', '#06b6d4'];

  return (
    <div className={`block-card ${className ?? ''}`} style={{ padding: 16 }}>
      {title && (
        <div className="text-sm font-semibold text-text-primary" style={{ marginBottom: 14 }}>
          {title}
        </div>
      )}
      <div className="flex flex-col" style={{ gap: 12 }}>
        {data.map((d, i) => {
          const pct = Math.max(2, (d.value / max) * 100);
          const fill = d.color ?? palette[i % palette.length];
          return (
            <div key={i}>
              <div className="flex items-center justify-between text-xs" style={{ marginBottom: 4 }}>
                <span className="text-text-secondary truncate" title={d.label}>
                  {d.label}
                </span>
                <span className="font-mono text-text-primary ml-2">{valueFormat(d.value)}</span>
              </div>
              <div style={{ width: '100%', height: barHeight, backgroundColor: TRACK, borderRadius: 6 }}>
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    backgroundColor: fill,
                    borderRadius: 6,
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* StackedBar — single stacked bar                                     */
/* ------------------------------------------------------------------ */

export interface StackedBarSegment {
  label: string;
  value: number;
  color?: string;
}

export interface StackedBarProps {
  segments?: StackedBarSegment[];
  title?: string;
  height?: number;
  showLegend?: boolean;
  valueFormat?: (v: number) => string;
  className?: string;
}

export function StackedBar({
  segments = [
    { label: 'Paid', value: 42000 },
    { label: 'Pending', value: 18000 },
    { label: 'Overdue', value: 9500 },
  ],
  title = 'Invoice Status',
  height = 28,
  showLegend = true,
  valueFormat = (v) => `$${v.toLocaleString()}`,
  className,
}: StackedBarProps) {
  const palette = [ACCENT_GREEN, ACCENT, ACCENT_RED, '#a855f7', '#f59e0b'];
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0) || 1;

  return (
    <div className={`block-card ${className ?? ''}`} style={{ padding: 16 }}>
      {title && (
        <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
          <span className="text-sm font-semibold text-text-primary">{title}</span>
          <span className="font-mono text-xs text-text-muted">{valueFormat(total)}</span>
        </div>
      )}
      <div
        style={{
          display: 'flex',
          width: '100%',
          height,
          borderRadius: 6,
          overflow: 'hidden',
          backgroundColor: TRACK,
        }}
      >
        {segments.map((s, i) => {
          const pct = (Math.max(0, s.value) / total) * 100;
          if (pct <= 0) return null;
          return (
            <div
              key={i}
              title={`${s.label}: ${valueFormat(s.value)}`}
              style={{
                width: `${pct}%`,
                height: '100%',
                backgroundColor: s.color ?? palette[i % palette.length],
                transition: 'width 0.3s ease',
              }}
            />
          );
        })}
      </div>
      {showLegend && (
        <div className="flex flex-wrap" style={{ gap: 12, marginTop: 12 }}>
          {segments.map((s, i) => (
            <div key={i} className="flex items-center" style={{ gap: 6 }}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 3,
                  backgroundColor: s.color ?? palette[i % palette.length],
                  display: 'inline-block',
                }}
              />
              <span className="text-xs text-text-secondary">{s.label}</span>
              <span className="text-xs font-mono text-text-muted">{valueFormat(s.value)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ColumnSpark — tiny column sparkline                                 */
/* ------------------------------------------------------------------ */

export interface ColumnSparkProps {
  values?: number[];
  color?: string;
  width?: number;
  height?: number;
  label?: string;
  rightText?: string;
  className?: string;
}

export function ColumnSpark({
  values = [3, 5, 4, 6, 5, 7, 6, 8, 7, 9, 8, 11],
  color = ACCENT,
  width = 120,
  height = 32,
  label,
  rightText,
  className,
}: ColumnSparkProps) {
  const max = Math.max(1, ...values);
  const n = values.length;
  const gap = 2;
  const barW = n > 0 ? (width - gap * (n - 1)) / n : width;

  const svg = (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {values.map((v, i) => {
        const h = Math.max(1, (v / max) * height);
        const x = i * (barW + gap);
        const y = height - h;
        return <rect key={i} x={x} y={y} width={barW} height={h} rx={1} fill={color} />;
      })}
    </svg>
  );

  if (!label && !rightText) {
    return <span className={className}>{svg}</span>;
  }

  return (
    <div className={`flex items-center justify-between ${className ?? ''}`} style={{ gap: 10 }}>
      {label && <span className="text-xs text-text-secondary truncate">{label}</span>}
      {svg}
      {rightText && <span className="text-xs font-mono text-text-primary">{rightText}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* WaterfallChart — waterfall bars SVG                                 */
/* ------------------------------------------------------------------ */

export interface WaterfallStep {
  label: string;
  /** Signed delta; positive = gain, negative = loss. */
  value: number;
  /** Mark as an absolute total column (e.g. starting/ending balance). */
  isTotal?: boolean;
}

export interface WaterfallChartProps {
  steps?: WaterfallStep[];
  title?: string;
  height?: number;
  valueFormat?: (v: number) => string;
  className?: string;
}

export function WaterfallChart({
  steps = [
    { label: 'Opening', value: 20000, isTotal: true },
    { label: 'Revenue', value: 18500 },
    { label: 'COGS', value: -7200 },
    { label: 'Opex', value: -6100 },
    { label: 'Tax', value: -2300 },
    { label: 'Closing', value: 22900, isTotal: true },
  ],
  title = 'Cash Flow Waterfall',
  height = 180,
  valueFormat = (v) => `$${Math.abs(v / 1000).toFixed(1)}k`,
  className,
}: WaterfallChartProps) {
  // Compute running cumulative for each column.
  let running = 0;
  const cols = steps.map((s) => {
    let start: number;
    let end: number;
    if (s.isTotal) {
      start = 0;
      end = s.value;
      running = s.value;
    } else {
      start = running;
      end = running + s.value;
      running = end;
    }
    return { ...s, start, end };
  });

  const minVal = Math.min(0, ...cols.map((c) => Math.min(c.start, c.end)));
  const maxVal = Math.max(0, ...cols.map((c) => Math.max(c.start, c.end)));
  const span = maxVal - minVal || 1;

  const gap = 10;
  const barW = 40;
  const labelH = 22;
  const w = cols.length * (barW + gap) + gap;
  const plotH = height;
  const scale = (v: number) => plotH - ((v - minVal) / span) * plotH;
  const zeroY = scale(0);

  return (
    <div className={`block-card ${className ?? ''}`} style={{ padding: 16 }}>
      {title && (
        <div className="text-sm font-semibold text-text-primary" style={{ marginBottom: 12 }}>
          {title}
        </div>
      )}
      <svg
        width="100%"
        viewBox={`0 0 ${w} ${plotH + labelH}`}
        aria-hidden="true"
      >
        {/* zero baseline */}
        <line
          x1={0}
          x2={w}
          y1={zeroY}
          y2={zeroY}
          stroke="var(--color-border-primary, #444)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
        {cols.map((c, i) => {
          const x = gap + i * (barW + gap);
          const top = Math.min(scale(c.start), scale(c.end));
          const h = Math.max(2, Math.abs(scale(c.start) - scale(c.end)));
          let fill: string;
          if (c.isTotal) fill = ACCENT;
          else if (c.value >= 0) fill = ACCENT_GREEN;
          else fill = ACCENT_RED;
          return (
            <g key={i}>
              {/* connector to previous column */}
              {i > 0 && (
                <line
                  x1={x - gap}
                  x2={x}
                  y1={scale(cols[i - 1].end)}
                  y2={scale(cols[i - 1].end)}
                  stroke="var(--color-border-primary, #444)"
                  strokeWidth={1}
                  opacity={0.6}
                />
              )}
              <rect x={x} y={top} width={barW} height={h} rx={3} fill={fill}>
                <title>{`${c.label}: ${c.value >= 0 ? '+' : '-'}${valueFormat(c.value)}`}</title>
              </rect>
              <text
                x={x + barW / 2}
                y={plotH + 15}
                textAnchor="middle"
                fontSize={9}
                fill="var(--color-text-muted, #9ca3af)"
              >
                {c.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
