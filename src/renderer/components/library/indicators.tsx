import React from 'react';
import {
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Star,
  Flag,
} from 'lucide-react';

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

type Tone = 'green' | 'amber' | 'red' | 'blue' | 'muted';

const TONE_VARS: Record<Tone, string> = {
  green: 'var(--color-accent-green, #22c55e)',
  amber: 'var(--color-accent-amber, #f59e0b)',
  red: 'var(--color-accent-red, #ef4444)',
  blue: 'var(--color-accent-blue, #3b82f6)',
  muted: 'var(--color-text-muted, #94a3b8)',
};

/* ================================================================== *
 * ChangeIndicator — up/down value change
 * ================================================================== */

export interface ChangeIndicatorProps {
  /** Numeric delta. Positive renders up, negative down, 0 flat. */
  value?: number;
  /** Optional explicit display text (overrides formatted value). */
  label?: string;
  /** Render as a percentage (appends %). */
  percent?: boolean;
  /** If true, a negative value is "good" (green) — e.g. expenses down. */
  invert?: boolean;
  /** Size variant. */
  size?: 'sm' | 'md';
  className?: string;
}

export function ChangeIndicator({
  value = 4.2,
  label,
  percent = true,
  invert = false,
  size = 'md',
  className,
}: ChangeIndicatorProps) {
  const dir = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  const positive = invert ? value < 0 : value > 0;
  const tone: Tone = dir === 'flat' ? 'muted' : positive ? 'green' : 'red';
  const color = TONE_VARS[tone];

  const Icon = dir === 'up' ? ArrowUpRight : dir === 'down' ? ArrowDownRight : Minus;
  const fontSize = size === 'sm' ? 11 : 13;
  const iconSize = size === 'sm' ? 12 : 14;

  const text =
    label ??
    `${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}${
      percent ? '%' : ''
    }`;

  return (
    <span
      className={`inline-flex items-center font-mono font-semibold ${className ?? ''}`}
      style={{ color, fontSize, gap: 3 }}
    >
      <Icon size={iconSize} strokeWidth={2.5} />
      {text}
    </span>
  );
}

/* ================================================================== *
 * RatingStars — star rating
 * ================================================================== */

export interface RatingStarsProps {
  /** Current value (supports halves, e.g. 3.5). */
  value?: number;
  /** Maximum number of stars. */
  max?: number;
  /** Star pixel size. */
  size?: number;
  /** Show numeric value to the right. */
  showValue?: boolean;
  /** Fill color for active stars. */
  color?: string;
  className?: string;
}

export function RatingStars({
  value = 4.5,
  max = 5,
  size = 16,
  showValue = true,
  color = TONE_VARS.amber,
  className,
}: RatingStarsProps) {
  const empty = 'var(--color-border-secondary, #3a3a3a)';
  return (
    <span className={`inline-flex items-center ${className ?? ''}`} style={{ gap: 4 }}>
      <span className="inline-flex" style={{ gap: 2 }}>
        {Array.from({ length: max }).map((_, i) => {
          const fillRatio = Math.max(0, Math.min(1, value - i));
          const gradId = `rs-grad-${i}-${size}`;
          return (
            <span key={i} style={{ position: 'relative', lineHeight: 0 }}>
              {fillRatio > 0 && fillRatio < 1 ? (
                <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
                  <defs>
                    <linearGradient id={gradId}>
                      <stop offset={`${fillRatio * 100}%`} stopColor={color} />
                      <stop offset={`${fillRatio * 100}%`} stopColor={empty} />
                    </linearGradient>
                  </defs>
                  <path
                    d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                    fill={`url(#${gradId})`}
                  />
                </svg>
              ) : (
                <Star
                  size={size}
                  fill={fillRatio >= 1 ? color : empty}
                  color={fillRatio >= 1 ? color : empty}
                  strokeWidth={0}
                />
              )}
            </span>
          );
        })}
      </span>
      {showValue && (
        <span className="font-mono text-text-secondary" style={{ fontSize: size * 0.75 }}>
          {value.toFixed(1)}
        </span>
      )}
    </span>
  );
}

/* ================================================================== *
 * HealthDot — green/amber/red health dot + label
 * ================================================================== */

export type HealthStatus = 'healthy' | 'warning' | 'critical' | 'unknown';

export interface HealthDotProps {
  status?: HealthStatus;
  /** Optional override label; defaults to a status-derived string. */
  label?: string;
  /** Hide the text label, showing just the dot. */
  hideLabel?: boolean;
  /** Dot diameter in px. */
  size?: number;
  className?: string;
}

const HEALTH_MAP: Record<HealthStatus, { tone: Tone; label: string }> = {
  healthy: { tone: 'green', label: 'Healthy' },
  warning: { tone: 'amber', label: 'Warning' },
  critical: { tone: 'red', label: 'Critical' },
  unknown: { tone: 'muted', label: 'Unknown' },
};

export function HealthDot({
  status = 'healthy',
  label,
  hideLabel = false,
  size = 9,
  className,
}: HealthDotProps) {
  const meta = HEALTH_MAP[status] ?? HEALTH_MAP.unknown;
  const color = TONE_VARS[meta.tone];
  return (
    <span className={`inline-flex items-center ${className ?? ''}`} style={{ gap: 7 }}>
      <span
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          backgroundColor: color,
          boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 22%, transparent)`,
          flexShrink: 0,
        }}
      />
      {!hideLabel && (
        <span className="text-text-secondary" style={{ fontSize: 12 }}>
          {label ?? meta.label}
        </span>
      )}
    </span>
  );
}

/* ================================================================== *
 * PriorityFlag — priority flag chip
 * ================================================================== */

export type Priority = 'critical' | 'high' | 'medium' | 'low';

export interface PriorityFlagProps {
  priority?: Priority;
  /** Optional override label. */
  label?: string;
  className?: string;
}

const PRIORITY_MAP: Record<Priority, { tone: Tone; label: string }> = {
  critical: { tone: 'red', label: 'Critical' },
  high: { tone: 'amber', label: 'High' },
  medium: { tone: 'blue', label: 'Medium' },
  low: { tone: 'muted', label: 'Low' },
};

export function PriorityFlag({ priority = 'high', label, className }: PriorityFlagProps) {
  const meta = PRIORITY_MAP[priority] ?? PRIORITY_MAP.medium;
  const color = TONE_VARS[meta.tone];
  return (
    <span
      className={`inline-flex items-center font-semibold uppercase ${className ?? ''}`}
      style={{
        gap: 4,
        fontSize: 10,
        letterSpacing: '0.05em',
        padding: '3px 8px',
        borderRadius: 6,
        color,
        backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
      }}
    >
      <Flag size={11} fill={color} strokeWidth={0} />
      {label ?? meta.label}
    </span>
  );
}

/* ================================================================== *
 * LiveDot — pulsing live indicator
 * ================================================================== */

export interface LiveDotProps {
  /** Label text next to the dot. */
  label?: string;
  /** Tone of the indicator. */
  tone?: 'green' | 'red' | 'amber' | 'blue';
  /** Disable the pulse animation. */
  paused?: boolean;
  /** Dot diameter in px. */
  size?: number;
  className?: string;
}

export function LiveDot({
  label = 'Live',
  tone = 'green',
  paused = false,
  size = 8,
  className,
}: LiveDotProps) {
  const color = TONE_VARS[tone];
  const animName = 'bap-livedot-pulse';
  return (
    <span className={`inline-flex items-center ${className ?? ''}`} style={{ gap: 7 }}>
      <style>{`
        @keyframes ${animName} {
          0%   { transform: scale(1);   opacity: 0.7; }
          70%  { transform: scale(2.6); opacity: 0; }
          100% { transform: scale(2.6); opacity: 0; }
        }
      `}</style>
      <span style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        {!paused && (
          <span
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              backgroundColor: color,
              animation: `${animName} 1.8s ease-out infinite`,
            }}
          />
        )}
        <span
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            backgroundColor: color,
          }}
        />
      </span>
      {label && (
        <span
          className="font-semibold uppercase text-text-secondary"
          style={{ fontSize: 10, letterSpacing: '0.06em' }}
        >
          {label}
        </span>
      )}
    </span>
  );
}
