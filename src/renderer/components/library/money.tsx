import React from 'react';
import {
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  TrendingUp,
  TrendingDown,
  Flame,
  Wallet,
  Repeat,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Shared formatting helpers                                           */
/* ------------------------------------------------------------------ */

function formatCurrency(
  value: number,
  currency = 'USD',
  fractionDigits = 0,
): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value);
  } catch {
    return `$${value.toFixed(fractionDigits)}`;
  }
}

const INCOME = 'var(--color-accent-income, #34d399)';
const EXPENSE = 'var(--color-accent-expense, #f87171)';
const MUTED = 'var(--color-text-muted, #8a8a8a)';

/* ================================================================== */
/* MoneyDelta — money change with direction color                      */
/* ================================================================== */

export interface MoneyDeltaProps {
  /** Signed delta value. */
  value?: number;
  currency?: string;
  /** Render a percentage instead of an absolute currency figure. */
  asPercent?: boolean;
  /** When true, a positive delta is treated as bad (e.g. expenses up). */
  invert?: boolean;
  /** Show the directional arrow icon. */
  showIcon?: boolean;
  fractionDigits?: number;
  className?: string;
}

export function MoneyDelta({
  value = 1240.5,
  currency = 'USD',
  asPercent = false,
  invert = false,
  showIcon = true,
  fractionDigits = asPercent ? 1 : 0,
  className,
}: MoneyDeltaProps) {
  const isZero = Math.abs(value) < 1e-9;
  const isUp = value > 0;
  const good = invert ? !isUp : isUp;
  const color = isZero ? MUTED : good ? INCOME : EXPENSE;

  const Icon = isZero ? Minus : isUp ? ArrowUpRight : ArrowDownRight;

  const magnitude = Math.abs(value);
  const text = asPercent
    ? `${magnitude.toFixed(fractionDigits)}%`
    : formatCurrency(magnitude, currency, fractionDigits);

  return (
    <span
      className={`inline-flex items-center gap-1 font-mono text-sm font-semibold ${className ?? ''}`}
      style={{ color }}
    >
      {showIcon && <Icon size={14} strokeWidth={2.5} />}
      <span>
        {isZero ? '' : isUp ? '+' : '−'}
        {text}
      </span>
    </span>
  );
}

/* ================================================================== */
/* CurrencyCell — formatted currency cell                              */
/* ================================================================== */

export interface CurrencyCellProps {
  value?: number;
  currency?: string;
  fractionDigits?: number;
  /** Color negative amounts red and positive green. */
  colorize?: boolean;
  /** Wrap negatives in parentheses (accounting style). */
  accounting?: boolean;
  /** Optional secondary label under the amount. */
  subLabel?: string;
  align?: 'left' | 'right';
  className?: string;
}

export function CurrencyCell({
  value = 8450.75,
  currency = 'USD',
  fractionDigits = 2,
  colorize = false,
  accounting = true,
  subLabel,
  align = 'right',
  className,
}: CurrencyCellProps) {
  const negative = value < 0;
  const magnitude = Math.abs(value);
  const formatted = formatCurrency(magnitude, currency, fractionDigits);
  const display = negative
    ? accounting
      ? `(${formatted})`
      : `−${formatted}`
    : formatted;

  const color = colorize
    ? negative
      ? EXPENSE
      : INCOME
    : 'var(--color-text-primary, #f5f5f5)';

  return (
    <div
      className={`flex flex-col ${align === 'right' ? 'items-end text-right' : 'items-start text-left'} ${className ?? ''}`}
    >
      <span className="font-mono text-sm tabular-nums" style={{ color }}>
        {display}
      </span>
      {subLabel && (
        <span className="text-xs text-text-muted mt-0.5">{subLabel}</span>
      )}
    </div>
  );
}

/* ================================================================== */
/* RunwayGauge — cash runway gauge                                     */
/* ================================================================== */

export interface RunwayGaugeProps {
  /** Cash on hand. */
  cash?: number;
  /** Average monthly net burn (positive number). */
  monthlyBurn?: number;
  currency?: string;
  /** Number of months considered "healthy" — caps the arc. */
  healthyMonths?: number;
  size?: number;
  className?: string;
}

export function RunwayGauge({
  cash = 184000,
  monthlyBurn = 23500,
  currency = 'USD',
  healthyMonths = 18,
  size = 180,
  className,
}: RunwayGaugeProps) {
  const months = monthlyBurn > 0 ? cash / monthlyBurn : Infinity;
  const finite = Number.isFinite(months);
  const pct = finite ? Math.max(0, Math.min(1, months / healthyMonths)) : 1;

  // Semicircle gauge geometry
  const stroke = Math.max(10, size * 0.075);
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = Math.PI * r; // half circle

  const color =
    !finite || months >= 12
      ? INCOME
      : months >= 6
        ? 'var(--color-accent-warning, #fbbf24)'
        : EXPENSE;

  const monthsLabel = !finite
    ? '∞'
    : months >= 24
      ? `${Math.floor(months)}`
      : months.toFixed(1);

  // Half-circle arc path from left to right (top semicircle)
  const startX = cx - r;
  const endX = cx + r;
  const arc = `M ${startX} ${cy} A ${r} ${r} 0 0 1 ${endX} ${cy}`;

  return (
    <div
      className={`block-card flex flex-col items-center ${className ?? ''}`}
      style={{ padding: 16, borderRadius: 6 }}
    >
      <div className="flex items-center gap-2 self-start mb-2">
        <Wallet size={16} style={{ color: MUTED }} />
        <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
          Cash Runway
        </span>
      </div>

      <svg
        width={size}
        height={size / 2 + stroke}
        viewBox={`0 0 ${size} ${size / 2 + stroke}`}
        style={{ maxWidth: '100%', height: 'auto' }}
        aria-hidden="true"
      >
        <path
          d={arc}
          fill="none"
          stroke="var(--color-bg-tertiary, #2e2e2e)"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <path
          d={arc}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
          style={{ transition: 'stroke-dashoffset 0.4s ease' }}
        />
        <text
          x={cx}
          y={cy - r * 0.18}
          textAnchor="middle"
          fontSize={size * 0.18}
          fontWeight={700}
          fill="var(--color-text-primary, #f5f5f5)"
        >
          {monthsLabel}
        </text>
        <text
          x={cx}
          y={cy + r * 0.04}
          textAnchor="middle"
          fontSize={size * 0.07}
          fill={MUTED}
        >
          months left
        </text>
      </svg>

      <div className="flex items-center justify-between w-full mt-2 text-xs">
        <span className="text-text-muted">
          {formatCurrency(cash, currency)} cash
        </span>
        <span className="text-text-muted">
          {formatCurrency(monthlyBurn, currency)}/mo
        </span>
      </div>
    </div>
  );
}

/* ================================================================== */
/* BurnRateTile — monthly burn tile                                    */
/* ================================================================== */

export interface BurnRateTileProps {
  /** Current monthly net burn (positive number = spending down cash). */
  burn?: number;
  /** Prior period burn for trend comparison. */
  priorBurn?: number;
  currency?: string;
  /** Sparkline series, most-recent last. */
  trend?: number[];
  className?: string;
}

export function BurnRateTile({
  burn = 23500,
  priorBurn = 21800,
  currency = 'USD',
  trend = [18200, 19400, 20100, 21800, 22600, 23500],
  className,
}: BurnRateTileProps) {
  const delta = burn - priorBurn;
  const deltaPct = priorBurn !== 0 ? (delta / priorBurn) * 100 : 0;
  // Burn going UP is bad → invert.
  const worse = delta > 0;

  // Sparkline geometry
  const w = 120;
  const h = 32;
  const series = trend.length > 1 ? trend : [burn, burn];
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const points = series
    .map((v, i) => {
      const x = (i / (series.length - 1)) * w;
      const y = h - ((v - min) / span) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div
      className={`block-card flex flex-col ${className ?? ''}`}
      style={{ padding: 16, borderRadius: 6 }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="inline-flex items-center justify-center"
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            background: 'var(--color-accent-expense-bg, rgba(248,113,113,0.12))',
          }}
        >
          <Flame size={15} style={{ color: EXPENSE }} />
        </span>
        <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
          Monthly Burn
        </span>
      </div>

      <div className="flex items-end justify-between" style={{ gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div className="font-mono text-2xl font-bold text-text-primary tabular-nums">
            {formatCurrency(burn, currency)}
          </div>
          <div className="mt-1">
            <MoneyDelta value={deltaPct} asPercent invert />
            <span className="text-xs text-text-muted ml-1">vs prior</span>
          </div>
        </div>

        {/* viewBox + shrinkable flex basis: the trend gives up width before
            overflowing the card (same fix as MetricHero). */}
        <svg viewBox={`0 0 ${w} ${h}`} aria-hidden="true" style={{ flex: `0 1 ${w}px`, minWidth: 0, maxWidth: w, height: h }}>
          <polyline
            points={points}
            fill="none"
            stroke={worse ? EXPENSE : INCOME}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
}

/* ================================================================== */
/* MrrTile — MRR / ARR tile                                            */
/* ================================================================== */

export interface MrrTileProps {
  /** Monthly recurring revenue. */
  mrr?: number;
  /** Month-over-month growth as a percentage. */
  growthPct?: number;
  currency?: string;
  /** Active subscriptions count. */
  activeSubs?: number;
  className?: string;
}

export function MrrTile({
  mrr = 47200,
  growthPct = 8.4,
  currency = 'USD',
  activeSubs = 312,
  className,
}: MrrTileProps) {
  const arr = mrr * 12;
  const up = growthPct >= 0;
  const Trend = up ? TrendingUp : TrendingDown;

  return (
    <div
      className={`block-card flex flex-col ${className ?? ''}`}
      style={{ padding: 16, borderRadius: 6 }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center justify-center"
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: 'var(--color-accent-income-bg, rgba(52,211,153,0.12))',
            }}
          >
            <Repeat size={15} style={{ color: INCOME }} />
          </span>
          <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
            MRR
          </span>
        </div>
        <span
          className="inline-flex items-center gap-1 text-xs font-semibold font-mono"
          style={{ color: up ? INCOME : EXPENSE }}
        >
          <Trend size={13} strokeWidth={2.5} />
          {up ? '+' : '−'}
          {Math.abs(growthPct).toFixed(1)}%
        </span>
      </div>

      <div className="font-mono text-2xl font-bold text-text-primary tabular-nums">
        {formatCurrency(mrr, currency)}
      </div>

      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border-primary text-xs">
        <span className="text-text-muted">
          ARR{' '}
          <span className="font-mono text-text-secondary">
            {formatCurrency(arr, currency)}
          </span>
        </span>
        <span className="text-text-muted">
          <span className="font-mono text-text-secondary">{activeSubs}</span> active
        </span>
      </div>
    </div>
  );
}
