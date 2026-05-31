import React from 'react';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Receipt,
  Landmark,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

const INCOME = 'var(--color-accent-income, #34d399)';
const EXPENSE = 'var(--color-accent-expense, #f87171)';
const WARNING = 'var(--color-accent-warning, #fbbf24)';
const MUTED = 'var(--color-text-muted, #64748b)';

function fmtMoney(n: number, currency = '$'): string {
  const neg = n < 0;
  const abs = Math.abs(n);
  const s = abs.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${neg ? '-' : ''}${currency}${s}`;
}

function fmtPct(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

/* ================================================================== *
 * PnLRow — Profit & Loss line with variance
 * ================================================================== */

export interface PnLRowProps {
  label?: string;
  actual?: number;
  budget?: number;
  /** Indent depth for nested line items. */
  depth?: number;
  /** Render as a bold subtotal/total row. */
  emphasis?: boolean;
  /** When true, a higher actual is "bad" (expense-style coloring). */
  inverse?: boolean;
  currency?: string;
  className?: string;
}

export function PnLRow({
  label = 'Net Revenue',
  actual = 124500,
  budget = 110000,
  depth = 0,
  emphasis = false,
  inverse = false,
  currency = '$',
  className,
}: PnLRowProps) {
  const variance = actual - budget;
  const favorable = inverse ? variance < 0 : variance > 0;
  const isZero = Math.abs(variance) < 0.005;
  const varColor = isZero ? MUTED : favorable ? INCOME : EXPENSE;

  return (
    <div
      className={`flex items-center text-sm ${className ?? ''}`}
      style={{
        padding: '8px 12px',
        borderBottom: '1px solid var(--color-border-secondary, #2a2a2a)',
        background: emphasis ? 'var(--color-bg-tertiary, #1c1c1c)' : 'transparent',
        borderRadius: emphasis ? 6 : 0,
      }}
    >
      <span
        className="flex-1 truncate"
        title={label}
        style={{
          paddingLeft: depth * 16,
          fontWeight: emphasis ? 700 : 500,
          color: 'var(--color-text-primary, #f1f5f9)',
        }}
      >
        {label}
      </span>
      <span
        className="font-mono text-right"
        style={{
          width: 120,
          fontWeight: emphasis ? 700 : 500,
          color: 'var(--color-text-primary, #f1f5f9)',
        }}
      >
        {fmtMoney(actual, currency)}
      </span>
      <span
        className="font-mono text-right"
        style={{ width: 120, color: 'var(--color-text-secondary, #94a3b8)' }}
      >
        {fmtMoney(budget, currency)}
      </span>
      <span
        className="font-mono text-right inline-flex items-center justify-end gap-1"
        style={{ width: 130, color: varColor, fontWeight: 600 }}
      >
        {!isZero &&
          (favorable ? (
            <TrendingUp size={13} strokeWidth={2.5} />
          ) : (
            <TrendingDown size={13} strokeWidth={2.5} />
          ))}
        {fmtMoney(variance, currency)}
      </span>
    </div>
  );
}

/* ================================================================== *
 * VarianceCell — variance $ and % cell
 * ================================================================== */

export interface VarianceCellProps {
  amount?: number;
  /** Percentage variance (already computed). If omitted, derived from base. */
  percent?: number;
  /** Base value used to derive percent when `percent` not given. */
  base?: number;
  /** When true, negative amounts are favorable (cost savings). */
  inverse?: boolean;
  currency?: string;
  /** Compact single-line layout. */
  compact?: boolean;
  className?: string;
}

export function VarianceCell({
  amount = -3850,
  percent,
  base = 42000,
  inverse = true,
  currency = '$',
  compact = false,
  className,
}: VarianceCellProps) {
  const pct =
    percent !== undefined
      ? percent
      : base !== 0
        ? (amount / Math.abs(base)) * 100
        : 0;
  const isZero = Math.abs(amount) < 0.005;
  const favorable = inverse ? amount < 0 : amount > 0;
  const color = isZero ? MUTED : favorable ? INCOME : EXPENSE;
  const Icon = isZero ? Minus : favorable ? TrendingUp : TrendingDown;

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-mono ${
        compact ? 'text-xs' : 'text-sm'
      } ${className ?? ''}`}
      style={{
        color,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 6,
        background: isZero
          ? 'transparent'
          : favorable
            ? 'var(--color-accent-income-bg, rgba(52,211,153,0.12))'
            : 'var(--color-accent-expense-bg, rgba(248,113,113,0.12))',
      }}
    >
      <Icon size={compact ? 12 : 14} strokeWidth={2.5} />
      <span>{fmtMoney(amount, currency)}</span>
      {!compact && <span style={{ opacity: 0.85 }}>({fmtPct(pct)})</span>}
    </span>
  );
}

/* ================================================================== *
 * TaxSummaryCard — tax collected / owed summary
 * ================================================================== */

export interface TaxSummaryCardProps {
  title?: string;
  period?: string;
  collected?: number;
  owed?: number;
  /** Tax already remitted/paid this period. */
  paid?: number;
  currency?: string;
  className?: string;
}

export function TaxSummaryCard({
  title = 'Sales Tax Summary',
  period = 'Q2 2026',
  collected = 18420.5,
  owed = 17985.0,
  paid = 12000.0,
  currency = '$',
  className,
}: TaxSummaryCardProps) {
  const remaining = owed - paid;
  const settled = remaining <= 0.005;

  const Stat = ({
    label,
    value,
    color,
  }: {
    label: string;
    value: number;
    color?: string;
  }) => (
    <div className="flex flex-col gap-0.5">
      <span
        className="text-xs uppercase tracking-wide"
        style={{ color: MUTED, letterSpacing: '0.05em' }}
      >
        {label}
      </span>
      <span
        className="font-mono text-base"
        style={{ color: color ?? 'var(--color-text-primary, #f1f5f9)', fontWeight: 700 }}
      >
        {fmtMoney(value, currency)}
      </span>
    </div>
  );

  return (
    <div className={`block-card ${className ?? ''}`} style={{ padding: 16, maxWidth: 360 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
        <div className="flex items-center gap-2">
          <Receipt size={18} style={{ color: 'var(--color-accent-blue, #3b82f6)' }} />
          <span
            className="text-sm"
            style={{ fontWeight: 700, color: 'var(--color-text-primary, #f1f5f9)' }}
          >
            {title}
          </span>
        </div>
        <span
          className="text-xs font-mono"
          style={{
            color: 'var(--color-text-secondary, #94a3b8)',
            padding: '2px 8px',
            borderRadius: 6,
            background: 'var(--color-bg-tertiary, #1c1c1c)',
          }}
        >
          {period}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-y-4">
        <Stat label="Collected" value={collected} color={INCOME} />
        <Stat label="Owed" value={owed} />
        <Stat label="Paid" value={paid} />
        <Stat
          label="Remaining"
          value={remaining}
          color={settled ? INCOME : WARNING}
        />
      </div>

      <div
        className="flex items-center gap-2 text-xs"
        style={{
          marginTop: 14,
          paddingTop: 12,
          borderTop: '1px solid var(--color-border-secondary, #2a2a2a)',
          color: settled ? INCOME : WARNING,
          fontWeight: 600,
        }}
      >
        {settled ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
        {settled
          ? 'Liability settled for this period'
          : `${fmtMoney(remaining, currency)} due to tax authority`}
      </div>
    </div>
  );
}

/* ================================================================== *
 * CategoryPill — expense category pill with color
 * ================================================================== */

export interface CategoryPillProps {
  label?: string;
  /** Dot/accent color — any CSS color or var() token. */
  color?: string;
  /** Optional amount shown to the right. */
  amount?: number;
  currency?: string;
  /** Solid filled style vs. subtle tinted style. */
  variant?: 'tint' | 'solid' | 'outline';
  className?: string;
}

export function CategoryPill({
  label = 'Office Supplies',
  color = 'var(--color-accent-purple, #a78bfa)',
  amount,
  currency = '$',
  variant = 'tint',
  className,
}: CategoryPillProps) {
  const tintBg = `color-mix(in srgb, ${color} 16%, transparent)`;
  const base: React.CSSProperties = {
    borderRadius: 6,
    padding: '3px 10px',
    fontWeight: 600,
    border: '1px solid transparent',
  };
  const styles: Record<string, React.CSSProperties> = {
    tint: { ...base, background: tintBg, color },
    solid: { ...base, background: color, color: '#0b1220' },
    outline: { ...base, borderColor: color, color },
  };

  return (
    <span
      className={`inline-flex items-center gap-2 text-xs ${className ?? ''}`}
      style={styles[variant]}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 6,
          background: variant === 'solid' ? '#0b1220' : color,
          flexShrink: 0,
        }}
      />
      <span className="truncate" title={label}>
        {label}
      </span>
      {amount !== undefined && (
        <span className="font-mono" style={{ opacity: 0.9 }}>
          {fmtMoney(amount, currency)}
        </span>
      )}
    </span>
  );
}

/* ================================================================== *
 * AccountBalanceRow — GL account balance row
 * ================================================================== */

export interface AccountBalanceRowProps {
  code?: string;
  name?: string;
  type?: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  balance?: number;
  /** Normal balance side; drives debit/credit hint. */
  normalSide?: 'debit' | 'credit';
  currency?: string;
  className?: string;
}

const TYPE_COLORS: Record<NonNullable<AccountBalanceRowProps['type']>, string> = {
  asset: 'var(--color-accent-blue, #3b82f6)',
  liability: 'var(--color-accent-expense, #f87171)',
  equity: 'var(--color-accent-purple, #a78bfa)',
  revenue: 'var(--color-accent-income, #34d399)',
  expense: 'var(--color-accent-warning, #fbbf24)',
};

export function AccountBalanceRow({
  code = '1010',
  name = 'Operating Cash',
  type = 'asset',
  balance = 84210.75,
  normalSide,
  currency = '$',
  className,
}: AccountBalanceRowProps) {
  const accent = TYPE_COLORS[type];
  const side: 'debit' | 'credit' =
    normalSide ?? (type === 'asset' || type === 'expense' ? 'debit' : 'credit');

  return (
    <div
      className={`flex items-center text-sm ${className ?? ''}`}
      style={{
        padding: '10px 12px',
        borderBottom: '1px solid var(--color-border-secondary, #2a2a2a)',
      }}
    >
      <span
        style={{
          width: 4,
          height: 28,
          borderRadius: 6,
          background: accent,
          marginRight: 12,
          flexShrink: 0,
        }}
      />
      <span
        className="font-mono text-xs"
        style={{ width: 56, color: 'var(--color-text-secondary, #94a3b8)' }}
      >
        {code}
      </span>
      <span
        className="flex-1 truncate"
        title={name}
        style={{ color: 'var(--color-text-primary, #f1f5f9)', fontWeight: 500 }}
      >
        {name}
      </span>
      <span
        className="text-xs uppercase mr-3"
        style={{
          color: accent,
          letterSpacing: '0.04em',
          padding: '1px 7px',
          borderRadius: 6,
          background: `color-mix(in srgb, ${accent} 14%, transparent)`,
          fontWeight: 600,
        }}
      >
        {type}
      </span>
      <span
        className="font-mono text-right"
        style={{
          width: 130,
          fontWeight: 700,
          color:
            balance < 0
              ? EXPENSE
              : 'var(--color-text-primary, #f1f5f9)',
        }}
      >
        {fmtMoney(balance, currency)}
        <span
          className="ml-1 text-xs"
          style={{ color: MUTED, fontWeight: 500 }}
        >
          {side === 'debit' ? 'DR' : 'CR'}
        </span>
      </span>
    </div>
  );
}
