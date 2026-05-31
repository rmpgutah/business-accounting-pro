import React from 'react';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowUpRight,
  ArrowDownRight,
  DollarSign,
  Target,
  type LucideIcon,
} from 'lucide-react';

/**
 * Presentational stat-card library. All components render with zero props
 * using believable mock defaults. Pure presentational — only react +
 * lucide-react imports.
 */

type Direction = 'up' | 'down' | 'flat';

function directionFromDelta(delta: number): Direction {
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';
  return 'flat';
}

const DIR_COLOR: Record<Direction, string> = {
  up: 'var(--color-accent-income, #22c55e)',
  down: 'var(--color-accent-expense, #ef4444)',
  flat: 'var(--color-text-muted, #94a3b8)',
};

const DIR_BG: Record<Direction, string> = {
  up: 'var(--color-accent-income-bg, rgba(34,197,94,0.12))',
  down: 'var(--color-accent-expense-bg, rgba(239,68,68,0.12))',
  flat: 'var(--color-bg-tertiary, rgba(148,163,184,0.12))',
};

/* ------------------------------------------------------------------ */
/* DeltaBadge                                                          */
/* ------------------------------------------------------------------ */

export interface DeltaBadgeProps {
  /** Numeric change. Sign drives color/icon unless `direction` is set. */
  value?: number;
  /** Force a direction regardless of value sign. */
  direction?: Direction;
  /** Render as percentage (appends %). */
  percent?: boolean;
  /** Decimal places for the displayed number. */
  decimals?: number;
  className?: string;
}

export function DeltaBadge({
  value = 12.4,
  direction,
  percent = true,
  decimals = 1,
  className,
}: DeltaBadgeProps) {
  const dir = direction ?? directionFromDelta(value);
  const Icon = dir === 'up' ? ArrowUpRight : dir === 'down' ? ArrowDownRight : Minus;
  const sign = value > 0 ? '+' : '';
  const display = `${sign}${value.toFixed(decimals)}${percent ? '%' : ''}`;

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 8px',
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.4,
        color: DIR_COLOR[dir],
        backgroundColor: DIR_BG[dir],
      }}
    >
      <Icon size={13} strokeWidth={2.5} />
      {display}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* TrendIndicator                                                      */
/* ------------------------------------------------------------------ */

export interface TrendIndicatorProps {
  /** Percent trend. Sign drives arrow + color unless `direction` is set. */
  value?: number;
  direction?: Direction;
  /** Hide the percent text, show arrow only. */
  iconOnly?: boolean;
  decimals?: number;
  size?: number;
  className?: string;
}

export function TrendIndicator({
  value = 8.2,
  direction,
  iconOnly = false,
  decimals = 1,
  size = 14,
  className,
}: TrendIndicatorProps) {
  const dir = direction ?? directionFromDelta(value);
  const Icon = dir === 'up' ? TrendingUp : dir === 'down' ? TrendingDown : Minus;
  const sign = value > 0 ? '+' : '';

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: size,
        fontWeight: 600,
        color: DIR_COLOR[dir],
      }}
    >
      <Icon size={size + 1} strokeWidth={2.25} />
      {!iconOnly && (
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {sign}
          {value.toFixed(decimals)}%
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* StatCard                                                            */
/* ------------------------------------------------------------------ */

export interface StatCardProps {
  label?: string;
  /** Pre-formatted headline value (e.g. "$124,580"). */
  value?: string;
  icon?: LucideIcon;
  /** Optional delta — renders a DeltaBadge under the value. */
  delta?: number;
  deltaPercent?: boolean;
  /** Caption shown next to the delta. */
  caption?: string;
  /** Accent color for the icon chip. */
  accent?: string;
  className?: string;
}

export function StatCard({
  label = 'Total Revenue',
  value = '$124,580',
  icon: Icon = DollarSign,
  delta = 12.4,
  deltaPercent = true,
  caption = 'vs last month',
  accent = 'var(--color-accent-blue, #60a5fa)',
  className,
}: StatCardProps) {
  return (
    <div className={`block-card ${className ?? ''}`} style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div className="text-text-muted" style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.3, textTransform: 'uppercase' }}>
            {label}
          </div>
          <div
            className="text-text-primary"
            style={{ fontSize: 28, fontWeight: 700, marginTop: 6, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}
          >
            {value}
          </div>
        </div>
        <div
          style={{
            flexShrink: 0,
            width: 40,
            height: 40,
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'var(--color-accent-blue-bg, rgba(96,165,250,0.12))',
            color: accent,
          }}
        >
          <Icon size={20} strokeWidth={2} />
        </div>
      </div>
      {delta !== undefined && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14 }}>
          <DeltaBadge value={delta} percent={deltaPercent} />
          {caption && (
            <span className="text-text-muted" style={{ fontSize: 12 }}>
              {caption}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* MetricTile                                                          */
/* ------------------------------------------------------------------ */

export interface MetricTileProps {
  label?: string;
  value?: string;
  delta?: number;
  deltaPercent?: boolean;
  icon?: LucideIcon;
  className?: string;
}

export function MetricTile({
  label = 'Active Invoices',
  value = '342',
  delta = -3.1,
  deltaPercent = true,
  icon: Icon,
  className,
}: MetricTileProps) {
  return (
    <div
      className={`block-card ${className ?? ''}`}
      style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {Icon && <Icon size={14} className="text-text-muted" strokeWidth={2} />}
        <span className="text-text-muted" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>
          {label}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span
          className="text-text-primary"
          style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}
        >
          {value}
        </span>
        {delta !== undefined && <TrendIndicator value={delta} size={12} decimals={deltaPercent ? 1 : 0} />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* KpiCard                                                             */
/* ------------------------------------------------------------------ */

export interface KpiCardProps {
  label?: string;
  /** Current numeric value. */
  current?: number;
  /** Target numeric value. */
  target?: number;
  /** Formatter for displayed numbers. */
  format?: (n: number) => string;
  icon?: LucideIcon;
  /** Progress bar accent color. */
  accent?: string;
  className?: string;
}

export function KpiCard({
  label = 'Monthly Sales Goal',
  current = 78400,
  target = 100000,
  format = (n) => `$${n.toLocaleString('en-US')}`,
  icon: Icon = Target,
  accent = 'var(--color-accent-blue, #60a5fa)',
  className,
}: KpiCardProps) {
  const pct = target > 0 ? Math.max(0, Math.min(100, (current / target) * 100)) : 0;
  const reached = pct >= 100;

  return (
    <div className={`block-card ${className ?? ''}`} style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Icon size={16} style={{ color: accent }} strokeWidth={2} />
        <span className="text-text-secondary" style={{ fontSize: 13, fontWeight: 600 }}>
          {label}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span
          className="text-text-primary"
          style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}
        >
          {format(current)}
        </span>
        <span className="text-text-muted" style={{ fontSize: 13 }}>
          / {format(target)}
        </span>
      </div>

      <div
        style={{
          marginTop: 12,
          width: '100%',
          height: 8,
          borderRadius: 6,
          backgroundColor: 'var(--color-bg-tertiary, #2e2e2e)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: 6,
            backgroundColor: reached ? 'var(--color-accent-income, #22c55e)' : accent,
            transition: 'width 0.3s ease',
          }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
        <span className="text-text-muted" style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
          {pct.toFixed(0)}% of target
        </span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: reached ? 'var(--color-accent-income, #22c55e)' : 'var(--color-text-muted, #94a3b8)',
          }}
        >
          {reached ? 'Goal reached' : `${format(Math.max(0, target - current))} to go`}
        </span>
      </div>
    </div>
  );
}
