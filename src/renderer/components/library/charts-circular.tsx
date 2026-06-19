import React from 'react';
import { TrendingUp } from 'lucide-react';

/**
 * charts-circular — pure presentational circular chart primitives.
 *
 * All charts are hand-rolled inline SVG (no chart library). Every component
 * renders correctly with zero props via sensible mock defaults, and matches
 * the app's glass/block theme (color tokens via var(--color-…)).
 */

const TEXT_PRIMARY = 'var(--color-text-primary, #e6e9ef)';
const TEXT_SECONDARY = 'var(--color-text-secondary, #9aa3b2)';
const TEXT_MUTED = 'var(--color-text-muted, #6b7280)';
const TRACK = 'var(--color-bg-tertiary, #2e2e2e)';
const ACCENT_BLUE = 'var(--color-accent-blue, #3b82f6)';
const ACCENT_INCOME = 'var(--color-accent-income, #22c55e)';
const ACCENT_WARNING = 'var(--color-accent-warning, #f59e0b)';
const ACCENT_EXPENSE = 'var(--color-accent-expense, #ef4444)';
const ACCENT_PURPLE = 'var(--color-accent-purple, #a855f7)';

function polar(cx: number, cy: number, r: number, angleRad: number): [number, number] {
  return [cx + r * Math.cos(angleRad), cy + r * Math.sin(angleRad)];
}

function arcPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  start: number,
  end: number,
): string {
  const large = end - start > Math.PI ? 1 : 0;
  const [x1, y1] = polar(cx, cy, rOuter, start);
  const [x2, y2] = polar(cx, cy, rOuter, end);
  const [x3, y3] = polar(cx, cy, rInner, end);
  const [x4, y4] = polar(cx, cy, rInner, start);
  return [
    `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `L ${x3.toFixed(2)} ${y3.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)}`,
    'Z',
  ].join(' ');
}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/* ───────────────────────── DonutChart ───────────────────────── */

export interface DonutDatum {
  label: string;
  value: number;
  color: string;
}

export interface DonutChartProps {
  data?: DonutDatum[];
  size?: number;
  /** Inner-radius ratio (0–1). 0.62 ≈ classic donut. */
  innerRatio?: number;
  /** Big number shown in the center. */
  centerLabel?: string;
  /** Smaller caption under the center label. */
  centerSubLabel?: string;
  /** Show the legend below the chart. */
  showLegend?: boolean;
  className?: string;
}

const DEFAULT_DONUT: DonutDatum[] = [
  { label: 'Revenue', value: 48, color: 'var(--color-accent-income, #22c55e)' },
  { label: 'Payroll', value: 26, color: 'var(--color-accent-blue, #3b82f6)' },
  { label: 'Expenses', value: 18, color: 'var(--color-accent-warning, #f59e0b)' },
  { label: 'Taxes', value: 8, color: 'var(--color-accent-purple, #a855f7)' },
];

export function DonutChart({
  data = DEFAULT_DONUT,
  size = 180,
  innerRatio = 0.62,
  centerLabel = '$128.4k',
  centerSubLabel = 'Total',
  showLegend = true,
  className,
}: DonutChartProps) {
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 2;
  const rInner = rOuter * innerRatio;
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0);
  let cursor = -Math.PI / 2;

  return (
    <div className={className} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={cx} cy={cy} r={rOuter} fill="none" stroke={TRACK} strokeWidth={1} />
        {total > 0 &&
          data.map((d, i) => {
            const value = Math.max(0, d.value);
            if (value <= 0) return null;
            const sweep = (value / total) * Math.PI * 2;
            const start = cursor;
            const end = cursor + sweep;
            cursor = end;
            if (Math.abs(sweep - Math.PI * 2) < 1e-6) {
              return (
                <g key={i}>
                  <circle cx={cx} cy={cy} r={rOuter} fill={d.color} />
                  <circle cx={cx} cy={cy} r={rInner} fill="var(--color-bg-secondary-solid, #1a1a1a)" />
                </g>
              );
            }
            return <path key={i} d={arcPath(cx, cy, rOuter, rInner, start, end)} fill={d.color} />;
          })}
        {centerLabel && (
          <text x={cx} y={centerSubLabel ? cy - size * 0.04 : cy} textAnchor="middle" dominantBaseline="central" fontSize={size * 0.15} fontWeight={700} fill={TEXT_PRIMARY}>
            {centerLabel}
          </text>
        )}
        {centerSubLabel && (
          <text x={cx} y={cy + size * 0.1} textAnchor="middle" dominantBaseline="central" fontSize={size * 0.075} fill={TEXT_MUTED}>
            {centerSubLabel}
          </text>
        )}
      </svg>
      {showLegend && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', justifyContent: 'center', maxWidth: size + 60 }}>
          {data.map((d, i) => (
            <span key={i} className="text-xs" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: TEXT_SECONDARY }}>
              <span style={{ width: 9, height: 9, borderRadius: 6, backgroundColor: d.color, display: 'inline-block' }} />
              {d.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── PieMini ───────────────────────── */

export interface PieMiniProps {
  data?: DonutDatum[];
  size?: number;
  className?: string;
}

const DEFAULT_PIE: DonutDatum[] = [
  { label: 'Paid', value: 62, color: 'var(--color-accent-income, #22c55e)' },
  { label: 'Pending', value: 24, color: 'var(--color-accent-warning, #f59e0b)' },
  { label: 'Overdue', value: 14, color: 'var(--color-accent-expense, #ef4444)' },
];

export function PieMini({ data = DEFAULT_PIE, size = 64, className }: PieMiniProps) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 1;
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0);
  let cursor = -Math.PI / 2;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className} aria-hidden="true">
      <circle cx={cx} cy={cy} r={r} fill={TRACK} />
      {total > 0 &&
        data.map((d, i) => {
          const value = Math.max(0, d.value);
          if (value <= 0) return null;
          const sweep = (value / total) * Math.PI * 2;
          const start = cursor;
          const end = cursor + sweep;
          cursor = end;
          if (Math.abs(sweep - Math.PI * 2) < 1e-6) {
            return <circle key={i} cx={cx} cy={cy} r={r} fill={d.color} />;
          }
          // wedge (rInner = 0)
          return <path key={i} d={arcPath(cx, cy, r, 0, start, end)} fill={d.color} />;
        })}
    </svg>
  );
}

/* ───────────────────────── RadialProgress ───────────────────────── */

export interface RadialProgressProps {
  /** 0–100 percentage. */
  value?: number;
  size?: number;
  thickness?: number;
  color?: string;
  /** Show the percentage text in the center. */
  showLabel?: boolean;
  /** Caption under the percentage. */
  caption?: string;
  className?: string;
}

export function RadialProgress({
  value = 72,
  size = 120,
  thickness = 10,
  color = ACCENT_BLUE,
  showLabel = true,
  caption,
  className,
}: RadialProgressProps) {
  const pct = clampPct(value);
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - thickness) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className} aria-hidden="true">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={TRACK} strokeWidth={thickness} />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={thickness}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circ - dash}`}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      {showLabel && (
        <text x={cx} y={caption ? cy - size * 0.04 : cy} textAnchor="middle" dominantBaseline="central" fontSize={size * 0.22} fontWeight={700} fill={TEXT_PRIMARY}>
          {Math.round(pct)}%
        </text>
      )}
      {caption && (
        <text x={cx} y={cy + size * 0.13} textAnchor="middle" dominantBaseline="central" fontSize={size * 0.1} fill={TEXT_MUTED}>
          {caption}
        </text>
      )}
    </svg>
  );
}

/* ───────────────────────── ScoreRing ───────────────────────── */

export interface ScoreBand {
  /** Inclusive lower bound (0–100). */
  min: number;
  color: string;
  label: string;
}

export interface ScoreRingProps {
  /** 0–100 score. */
  score?: number;
  size?: number;
  thickness?: number;
  /** Bands ordered low→high; the matching band colors the ring. */
  bands?: ScoreBand[];
  /** Show the band label under the score. */
  showBandLabel?: boolean;
  className?: string;
}

const DEFAULT_BANDS: ScoreBand[] = [
  { min: 0, color: ACCENT_EXPENSE, label: 'Poor' },
  { min: 40, color: ACCENT_WARNING, label: 'Fair' },
  { min: 70, color: ACCENT_BLUE, label: 'Good' },
  { min: 85, color: ACCENT_INCOME, label: 'Excellent' },
];

function bandFor(score: number, bands: ScoreBand[]): ScoreBand {
  let chosen = bands[0];
  for (const b of bands) {
    if (score >= b.min) chosen = b;
  }
  return chosen;
}

export function ScoreRing({
  score = 78,
  size = 120,
  thickness = 10,
  bands = DEFAULT_BANDS,
  showBandLabel = true,
  className,
}: ScoreRingProps) {
  const val = clampPct(score);
  const band = bandFor(val, bands);
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - thickness) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (val / 100) * circ;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className} aria-hidden="true">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={TRACK} strokeWidth={thickness} />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={band.color}
        strokeWidth={thickness}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circ - dash}`}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <text x={cx} y={showBandLabel ? cy - size * 0.05 : cy} textAnchor="middle" dominantBaseline="central" fontSize={size * 0.26} fontWeight={700} fill={TEXT_PRIMARY}>
        {Math.round(val)}
      </text>
      {showBandLabel && (
        <text x={cx} y={cy + size * 0.16} textAnchor="middle" dominantBaseline="central" fontSize={size * 0.1} fontWeight={600} fill={band.color}>
          {band.label}
        </text>
      )}
    </svg>
  );
}

/* ───────────────────────── HalfGauge ───────────────────────── */

export interface HalfGaugeProps {
  /** Current value within [min, max]. */
  value?: number;
  min?: number;
  max?: number;
  size?: number;
  thickness?: number;
  color?: string;
  /** Big value text below the arc. */
  label?: string;
  /** Caption under the value. */
  caption?: string;
  className?: string;
}

export function HalfGauge({
  value = 6.8,
  min = 0,
  max = 10,
  size = 180,
  thickness = 14,
  color = ACCENT_INCOME,
  label,
  caption = 'Cash runway (months)',
  className,
}: HalfGaugeProps) {
  const span = max - min || 1;
  const frac = Math.max(0, Math.min(1, (value - min) / span));
  const w = size;
  const h = size / 2 + thickness;
  const cx = w / 2;
  const cy = size / 2;
  const r = size / 2 - thickness / 2;

  // Half circle from 180° (left) to 360°/0° (right), going over the top.
  const startA = Math.PI;
  const endA = 2 * Math.PI;
  const valA = startA + frac * (endA - startA);

  const halfArc = (a0: number, a1: number) => {
    const [x0, y0] = polar(cx, cy, r, a0);
    const [x1, y1] = polar(cx, cy, r, a1);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };

  const display = label ?? value.toLocaleString(undefined, { maximumFractionDigits: 1 });

  return (
    <div className={className} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
        <path d={halfArc(startA, endA)} fill="none" stroke={TRACK} strokeWidth={thickness} strokeLinecap="round" />
        {frac > 0 && (
          <path d={halfArc(startA, valA)} fill="none" stroke={color} strokeWidth={thickness} strokeLinecap="round" />
        )}
        <text x={cx} y={cy - size * 0.06} textAnchor="middle" dominantBaseline="central" fontSize={size * 0.18} fontWeight={700} fill={TEXT_PRIMARY}>
          {display}
        </text>
        <text x={thickness} y={cy + thickness * 0.4} textAnchor="middle" fontSize={size * 0.06} fill={TEXT_MUTED}>
          {min}
        </text>
        <text x={w - thickness} y={cy + thickness * 0.4} textAnchor="middle" fontSize={size * 0.06} fill={TEXT_MUTED}>
          {max}
        </text>
      </svg>
      {caption && (
        <span className="text-xs" style={{ color: TEXT_SECONDARY, display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
          <TrendingUp size={13} style={{ color }} />
          {caption}
        </span>
      )}
    </div>
  );
}
