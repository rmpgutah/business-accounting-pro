import React from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';

/**
 * AR / AP presentational components — glass/block theme.
 *
 * Pure presentational: every prop is optional with sensible defaults so each
 * component renders a believable mock with zero props. Imports limited to
 * 'react' and 'lucide-react'; charts are hand-rolled inline SVG.
 */

const fmtMoney = (n: number): string =>
  (n < 0 ? '-' : '') +
  '$' +
  Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });

// ---------------------------------------------------------------------------
// ArAgingChart — AR aging bucket bars
// ---------------------------------------------------------------------------

export interface ArAgingBucket {
  label: string;
  amount: number;
  /** CSS color or var(--…) token for the bar fill. */
  color?: string;
}

export interface ArAgingChartProps {
  title?: string;
  buckets?: ArAgingBucket[];
  className?: string;
}

export function ArAgingChart({
  title = 'AR Aging',
  buckets = [
    { label: 'Current', amount: 18400, color: 'var(--color-accent-income)' },
    { label: '1–30', amount: 9200, color: 'var(--color-accent-blue)' },
    { label: '31–60', amount: 4750, color: 'var(--color-accent-warning)' },
    { label: '61–90', amount: 2100, color: 'var(--color-accent-purple)' },
    { label: '90+', amount: 3680, color: 'var(--color-accent-expense)' },
  ],
  className,
}: ArAgingChartProps) {
  const total = buckets.reduce((s, b) => s + Math.max(0, b.amount), 0);
  const max = Math.max(1, ...buckets.map((b) => Math.max(0, b.amount)));

  return (
    <div className={`block-card ${className ?? ''}`} style={{ padding: 16 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
        <span className="text-sm font-semibold text-text-primary">{title}</span>
        <span className="text-xs font-mono text-text-secondary">{fmtMoney(total)}</span>
      </div>
      <div className="flex flex-col" style={{ gap: 12 }}>
        {buckets.map((b, i) => {
          const pct = (Math.max(0, b.amount) / max) * 100;
          const color = b.color ?? 'var(--color-accent-blue)';
          return (
            <div key={i}>
              <div
                className="flex items-center justify-between text-xs"
                style={{ marginBottom: 4 }}
              >
                <span className="text-text-secondary">{b.label}</span>
                <span className="font-mono text-text-primary">{fmtMoney(b.amount)}</span>
              </div>
              <div
                style={{
                  width: '100%',
                  height: 8,
                  backgroundColor: 'var(--color-bg-tertiary-solid)',
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
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CashFlowTile — cash in / out tile
// ---------------------------------------------------------------------------

export interface CashFlowTileProps {
  title?: string;
  cashIn?: number;
  cashOut?: number;
  period?: string;
  className?: string;
}

export function CashFlowTile({
  title = 'Cash Flow',
  cashIn = 42850,
  cashOut = 31200,
  period = 'This month',
  className,
}: CashFlowTileProps) {
  const net = cashIn - cashOut;
  const positive = net >= 0;
  const denom = Math.max(1, cashIn + cashOut);
  const inPct = (cashIn / denom) * 100;

  return (
    <div className={`block-card ${className ?? ''}`} style={{ padding: 16 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
        <span className="text-sm font-semibold text-text-primary">{title}</span>
        <span className="text-xs text-text-muted">{period}</span>
      </div>

      <div className="flex items-baseline" style={{ gap: 8, marginBottom: 14 }}>
        <span
          className="text-2xl font-bold font-mono"
          style={{
            color: positive
              ? 'var(--color-accent-income)'
              : 'var(--color-accent-expense)',
          }}
        >
          {fmtMoney(net)}
        </span>
        <span className="text-xs text-text-secondary">net</span>
      </div>

      <div
        style={{
          display: 'flex',
          width: '100%',
          height: 6,
          borderRadius: 6,
          overflow: 'hidden',
          backgroundColor: 'var(--color-bg-tertiary-solid)',
          marginBottom: 14,
        }}
      >
        <div
          style={{
            width: `${inPct}%`,
            backgroundColor: 'var(--color-accent-income)',
          }}
        />
        <div style={{ flex: 1, backgroundColor: 'var(--color-accent-expense)' }} />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center" style={{ gap: 8 }}>
          <ArrowDownLeft size={16} style={{ color: 'var(--color-accent-income)' }} />
          <div className="flex flex-col">
            <span className="text-xs text-text-muted">In</span>
            <span className="text-sm font-mono text-text-primary">{fmtMoney(cashIn)}</span>
          </div>
        </div>
        <div className="flex items-center" style={{ gap: 8 }}>
          <ArrowUpRight size={16} style={{ color: 'var(--color-accent-expense)' }} />
          <div className="flex flex-col items-end">
            <span className="text-xs text-text-muted">Out</span>
            <span className="text-sm font-mono text-text-primary">{fmtMoney(cashOut)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OverdueBannerCard — overdue alert banner (balance-aware)
// ---------------------------------------------------------------------------

export interface OverdueBannerCardProps {
  /** Total overdue balance. 0 or less renders the "all clear" variant. */
  overdueAmount?: number;
  invoiceCount?: number;
  oldestDays?: number;
  className?: string;
}

export function OverdueBannerCard({
  overdueAmount = 5780,
  invoiceCount = 3,
  oldestDays = 47,
  className,
}: OverdueBannerCardProps) {
  const clear = overdueAmount <= 0;
  const accent = clear ? 'var(--color-accent-income)' : 'var(--color-accent-expense)';
  const accentBg = clear
    ? 'var(--color-accent-income-bg)'
    : 'var(--color-accent-expense-bg)';
  const Icon = clear ? CheckCircle2 : AlertTriangle;

  return (
    <div
      className={`block-card ${className ?? ''}`}
      style={{
        padding: 16,
        borderColor: accent,
        background: accentBg,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
      }}
    >
      <div
        style={{
          flexShrink: 0,
          width: 40,
          height: 40,
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: accentBg,
          border: `1px solid ${accent}`,
        }}
      >
        <Icon size={20} style={{ color: accent }} />
      </div>
      <div className="flex flex-col" style={{ flex: 1 }}>
        {clear ? (
          <>
            <span className="text-sm font-semibold text-text-primary">No overdue invoices</span>
            <span className="text-xs text-text-secondary">All receivables are current.</span>
          </>
        ) : (
          <>
            <span className="text-sm font-semibold text-text-primary">
              {fmtMoney(overdueAmount)} overdue
            </span>
            <span className="text-xs text-text-secondary">
              {invoiceCount} invoice{invoiceCount === 1 ? '' : 's'} · oldest {oldestDays} days
            </span>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CollectionScore — collection likelihood ring
// ---------------------------------------------------------------------------

export interface CollectionScoreProps {
  /** Likelihood 0–100. */
  score?: number;
  label?: string;
  size?: number;
  className?: string;
}

export function CollectionScore({
  score = 82,
  label = 'Collection likelihood',
  size = 132,
  className,
}: CollectionScoreProps) {
  const pct = Math.max(0, Math.min(100, score));
  const stroke = 10;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;

  const color =
    pct >= 75
      ? 'var(--color-accent-income)'
      : pct >= 50
        ? 'var(--color-accent-warning)'
        : 'var(--color-accent-expense)';

  return (
    <div
      className={`block-card ${className ?? ''}`}
      style={{
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <svg width={size} height={size} aria-hidden="true">
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="var(--color-bg-tertiary-solid)"
          strokeWidth={stroke}
        />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: 'stroke-dasharray 0.4s ease' }}
        />
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={size * 0.24}
          fontWeight={700}
          fill="var(--color-text-primary)"
        >
          {pct}%
        </text>
      </svg>
      <span className="text-xs text-text-secondary">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DsoTile — days-sales-outstanding tile
// ---------------------------------------------------------------------------

export interface DsoTileProps {
  /** Current DSO in days. */
  days?: number;
  /** Prior-period DSO for trend comparison. */
  priorDays?: number;
  /** Target / benchmark DSO. */
  target?: number;
  className?: string;
}

export function DsoTile({
  days = 38,
  priorDays = 44,
  target = 30,
  className,
}: DsoTileProps) {
  const delta = days - priorDays;
  // Lower DSO is better, so a negative delta is an improvement.
  const improving = delta < 0;
  const flat = delta === 0;
  const trendColor = flat
    ? 'var(--color-text-secondary)'
    : improving
      ? 'var(--color-accent-income)'
      : 'var(--color-accent-expense)';
  const TrendIcon = improving ? TrendingDown : TrendingUp;
  const onTarget = days <= target;

  return (
    <div className={`block-card ${className ?? ''}`} style={{ padding: 16 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
        <div className="flex items-center" style={{ gap: 8 }}>
          <Clock size={16} style={{ color: 'var(--color-accent-blue)' }} />
          <span className="text-sm font-semibold text-text-primary">Days Sales Outstanding</span>
        </div>
      </div>

      <div className="flex items-baseline" style={{ gap: 8, marginBottom: 8 }}>
        <span className="text-3xl font-bold font-mono text-text-primary">{days}</span>
        <span className="text-xs text-text-secondary">days</span>
        {!flat && (
          <span
            className="flex items-center text-xs font-mono"
            style={{ gap: 2, color: trendColor }}
          >
            <TrendIcon size={13} />
            {Math.abs(delta)}d
          </span>
        )}
      </div>

      <div
        className="text-xs"
        style={{ color: onTarget ? 'var(--color-accent-income)' : 'var(--color-text-muted)' }}
      >
        {onTarget ? 'On target' : `Target ${target}d`}
      </div>
    </div>
  );
}
