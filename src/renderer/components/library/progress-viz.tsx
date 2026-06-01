import React from 'react';
import { Check, Target } from 'lucide-react';

/**
 * progress-viz.tsx — pure presentational progress / gauge visualizations.
 *
 * All components render correctly with ZERO props (sensible mock defaults).
 * Allowed imports: react + lucide-react only. No app modules, no data fetching.
 * Theme: glass/block tokens (bg-bg-*, text-text-*, border-border-*) + CSS vars.
 */

const ACCENT_BLUE = 'var(--color-accent-blue, #3b82f6)';
const ACCENT_GREEN = 'var(--color-accent-income, #22c55e)';
const TRACK = 'var(--color-bg-tertiary, #2e2e2e)';

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/* ------------------------------------------------------------------ */
/* ProgressRing — circular SVG progress                                */
/* ------------------------------------------------------------------ */
export interface ProgressRingProps {
  /** 0–100 */
  value?: number;
  size?: number;
  thickness?: number;
  color?: string;
  trackColor?: string;
  /** Override the big center label (defaults to "{value}%"). */
  label?: string;
  sublabel?: string;
  className?: string;
}

export function ProgressRing({
  value = 72,
  size = 140,
  thickness = 12,
  color = ACCENT_BLUE,
  trackColor = TRACK,
  label,
  sublabel = 'Complete',
  className,
}: ProgressRingProps) {
  const pct = clampPct(value);
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - thickness) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;

  return (
    <div
      className={className}
      style={{ position: 'relative', width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={trackColor} strokeWidth={thickness} />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={`${dash.toFixed(2)} ${circ.toFixed(2)}`}
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: 'stroke-dasharray 0.4s ease' }}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          className="text-text-primary font-mono"
          style={{ fontSize: size * 0.22, fontWeight: 700, lineHeight: 1 }}
        >
          {label ?? `${Math.round(pct)}%`}
        </span>
        {sublabel && (
          <span className="text-text-muted" style={{ fontSize: size * 0.09, marginTop: 4 }}>
            {sublabel}
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ProgressBarLabeled — labeled linear progress                        */
/* ------------------------------------------------------------------ */
export interface ProgressBarLabeledProps {
  label?: string;
  /** 0–100 */
  value?: number;
  color?: string;
  trackColor?: string;
  thickness?: number;
  /** Right-side numeric text (defaults to "{value}%"). */
  rightText?: string;
  className?: string;
}

export function ProgressBarLabeled({
  label = 'Q3 Revenue Target',
  value = 64,
  color = ACCENT_GREEN,
  trackColor = TRACK,
  thickness = 8,
  rightText,
  className,
}: ProgressBarLabeledProps) {
  const pct = clampPct(value);
  return (
    <div className={className} style={{ width: '100%' }}>
      <div className="flex items-center justify-between text-xs" style={{ marginBottom: 6 }}>
        <span className="text-text-secondary truncate" title={label}>
          {label}
        </span>
        <span className="font-mono text-text-primary ml-2">
          {rightText ?? `${Math.round(pct)}%`}
        </span>
      </div>
      <div
        style={{
          width: '100%',
          height: thickness,
          backgroundColor: trackColor,
          borderRadius: 6,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            backgroundColor: color,
            borderRadius: 6,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* StepProgress — numbered step dots                                   */
/* ------------------------------------------------------------------ */
export interface StepProgressProps {
  steps?: string[];
  /** Index of the currently active step (0-based). */
  current?: number;
  color?: string;
  className?: string;
}

export function StepProgress({
  steps = ['Draft', 'Review', 'Approve', 'Filed'],
  current = 2,
  color = ACCENT_BLUE,
  className,
}: StepProgressProps) {
  return (
    <div className={className} style={{ display: 'flex', alignItems: 'flex-start', width: '100%' }}>
      {steps.map((step, i) => {
        const done = i < current;
        const active = i === current;
        const isLast = i === steps.length - 1;
        const dotBg = done || active ? color : TRACK;
        return (
          <React.Fragment key={i}>
            <div
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0 }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  backgroundColor: dotBg,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#fff',
                  border: active ? `2px solid ${color}` : '2px solid transparent',
                  boxShadow: active ? `0 0 0 3px var(--color-bg-tertiary, #2e2e2e)` : 'none',
                  flexShrink: 0,
                }}
              >
                {done ? <Check size={14} strokeWidth={3} /> : i + 1}
              </div>
              <span
                className={active ? 'text-text-primary' : 'text-text-muted'}
                style={{ fontSize: 11, marginTop: 6, textAlign: 'center' }}
              >
                {step}
              </span>
            </div>
            {!isLast && (
              <div
                style={{
                  flex: 1,
                  height: 2,
                  marginTop: 13,
                  backgroundColor: i < current ? color : TRACK,
                  alignSelf: 'flex-start',
                }}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* GaugeMeter — semicircle gauge SVG                                   */
/* ------------------------------------------------------------------ */
export interface GaugeMeterProps {
  /** 0–100 */
  value?: number;
  size?: number;
  thickness?: number;
  color?: string;
  trackColor?: string;
  label?: string;
  sublabel?: string;
  className?: string;
}

export function GaugeMeter({
  value = 58,
  size = 180,
  thickness = 16,
  color = ACCENT_BLUE,
  trackColor = TRACK,
  label,
  sublabel = 'Cash runway',
  className,
}: GaugeMeterProps) {
  const pct = clampPct(value);
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const height = size / 2 + thickness;

  // Semicircle from 180° (left) to 0° (right), going over the top.
  const toXY = (angleDeg: number) => {
    const a = (angleDeg * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  };
  const [sx, sy] = toXY(180);
  const [ex, ey] = toXY(0);
  const trackPath = `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 0 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;

  const endAngle = 180 - (pct / 100) * 180;
  const [vx, vy] = toXY(endAngle);
  const valuePath = `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 0 1 ${vx.toFixed(2)} ${vy.toFixed(2)}`;

  return (
    <div className={className} style={{ width: size }}>
      <svg width={size} height={height} viewBox={`0 0 ${size} ${height}`} aria-hidden="true">
        <path d={trackPath} fill="none" stroke={trackColor} strokeWidth={thickness} strokeLinecap="round" />
        <path
          d={valuePath}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          style={{ transition: 'd 0.4s ease' }}
        />
      </svg>
      <div style={{ textAlign: 'center', marginTop: -size * 0.18 }}>
        <div className="text-text-primary font-mono" style={{ fontSize: size * 0.16, fontWeight: 700 }}>
          {label ?? `${Math.round(pct)}%`}
        </div>
        {sublabel && (
          <div className="text-text-muted" style={{ fontSize: size * 0.07 }}>
            {sublabel}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* BulletGraph — bullet chart vs target                                */
/* ------------------------------------------------------------------ */
export interface BulletGraphProps {
  label?: string;
  /** Actual measured value. */
  value?: number;
  /** Comparative target (rendered as a vertical marker). */
  target?: number;
  /** Scale maximum. */
  max?: number;
  /** Qualitative band thresholds within [0, max], ascending. */
  ranges?: number[];
  color?: string;
  /** Format the right-side value/target readout. */
  format?: (n: number) => string;
  className?: string;
}

export function BulletGraph({
  label = 'Monthly Revenue',
  value = 84000,
  target = 95000,
  max = 120000,
  ranges = [50000, 85000],
  color = ACCENT_BLUE,
  format = (n) => `$${(n / 1000).toFixed(0)}k`,
  className,
}: BulletGraphProps) {
  const safeMax = max > 0 ? max : 1;
  const vPct = clampPct((value / safeMax) * 100);
  const tPct = clampPct((target / safeMax) * 100);

  const bandShades = [
    'var(--color-bg-tertiary, #2e2e2e)',
    'var(--color-bg-secondary, #1f1f1f)',
    'var(--color-bg-tertiary, #2e2e2e)',
  ];
  // Build band segments from range thresholds.
  const bounds = [0, ...ranges.filter((r) => r > 0 && r <= safeMax).sort((a, b) => a - b), safeMax];

  return (
    <div className={className} style={{ width: '100%' }}>
      <div className="flex items-center justify-between text-xs" style={{ marginBottom: 6 }}>
        <span className="text-text-secondary truncate" title={label}>
          {label}
        </span>
        <span className="font-mono text-text-primary ml-2">
          {format(value)} <span className="text-text-muted">/ {format(target)}</span>
        </span>
      </div>
      <div style={{ position: 'relative', width: '100%', height: 22 }}>
        {/* qualitative bands */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            borderRadius: 6,
            overflow: 'hidden',
            border: '1px solid var(--color-border-primary, #3a3a3a)',
          }}
        >
          {bounds.slice(0, -1).map((b, i) => {
            const w = ((bounds[i + 1] - b) / safeMax) * 100;
            return (
              <div
                key={i}
                style={{
                  width: `${w}%`,
                  height: '100%',
                  backgroundColor: bandShades[i % bandShades.length],
                }}
              />
            );
          })}
        </div>
        {/* measure bar */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: '50%',
            transform: 'translateY(-50%)',
            height: 8,
            width: `${vPct}%`,
            backgroundColor: color,
            borderRadius: 6,
            transition: 'width 0.3s ease',
          }}
        />
        {/* target marker */}
        <div
          title="Target"
          style={{
            position: 'absolute',
            left: `${tPct}%`,
            top: 2,
            bottom: 2,
            width: 3,
            backgroundColor: ACCENT_GREEN,
            transform: 'translateX(-50%)',
            borderRadius: 2,
          }}
        />
      </div>
      <div className="flex items-center text-text-muted" style={{ fontSize: 10, marginTop: 4, gap: 4 }}>
        <Target size={11} />
        <span>Target {format(target)}</span>
      </div>
    </div>
  );
}
