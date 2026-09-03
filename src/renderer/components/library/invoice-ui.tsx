import React from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Send,
  CircleDashed,
  PieChart,
  Calendar,
  Clock,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

function fmtCurrency(n: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function clampPct(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (value / total) * 100));
}

/* ================================================================== */
/* InvoiceStatusBadge                                                  */
/* ================================================================== */

export type InvoiceStatus = 'paid' | 'overdue' | 'sent' | 'partial' | 'draft';

export interface InvoiceStatusBadgeProps {
  status?: InvoiceStatus;
  /** Render a compact (icon-tighter) variant. */
  compact?: boolean;
  className?: string;
}

const STATUS_CONFIG: Record<
  InvoiceStatus,
  { label: string; color: string; bg: string; Icon: typeof CheckCircle2 }
> = {
  paid: {
    label: 'Paid',
    color: 'var(--color-accent-income)',
    bg: 'var(--color-accent-income-bg)',
    Icon: CheckCircle2,
  },
  overdue: {
    label: 'Overdue',
    color: 'var(--color-accent-expense)',
    bg: 'var(--color-accent-expense-bg)',
    Icon: AlertTriangle,
  },
  sent: {
    label: 'Sent',
    color: 'var(--color-accent-blue)',
    bg: 'var(--color-accent-blue-bg)',
    Icon: Send,
  },
  partial: {
    label: 'Partial',
    color: 'var(--color-accent-warning)',
    bg: 'var(--color-accent-warning-bg)',
    Icon: PieChart,
  },
  draft: {
    label: 'Draft',
    color: 'var(--color-text-secondary)',
    bg: 'var(--color-bg-tertiary)',
    Icon: CircleDashed,
  },
};

export function InvoiceStatusBadge({
  status = 'paid',
  compact = false,
  className,
}: InvoiceStatusBadgeProps) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;
  const { Icon } = cfg;
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: compact ? 4 : 6,
        padding: compact ? '2px 8px' : '3px 10px',
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.4,
        color: cfg.color,
        background: cfg.bg,
        border: `1px solid ${cfg.color}33`,
        whiteSpace: 'nowrap',
      }}
    >
      <Icon size={compact ? 12 : 13} strokeWidth={2.2} />
      {cfg.label}
    </span>
  );
}

/* ================================================================== */
/* AgingBar                                                            */
/* ================================================================== */

export interface AgingBucket {
  label: string;
  value: number;
  color: string;
}

export interface AgingBarProps {
  buckets?: AgingBucket[];
  /** Bar height in px. */
  height?: number;
  /** Show the per-bucket legend below the bar. */
  showLegend?: boolean;
  className?: string;
}

const DEFAULT_AGING: AgingBucket[] = [
  { label: 'Current', value: 12400, color: 'var(--color-accent-income)' },
  { label: '1–30', value: 5200, color: 'var(--color-accent-blue)' },
  { label: '31–60', value: 2800, color: 'var(--color-accent-warning)' },
  { label: '61–90', value: 1450, color: 'var(--color-accent-purple)' },
  { label: '90+', value: 980, color: 'var(--color-accent-expense)' },
];

export function AgingBar({
  buckets = DEFAULT_AGING,
  height = 14,
  showLegend = true,
  className,
}: AgingBarProps) {
  const total = buckets.reduce((s, b) => s + Math.max(0, b.value), 0);
  return (
    <div className={className}>
      <div
        style={{
          display: 'flex',
          width: '100%',
          height,
          borderRadius: 6,
          overflow: 'hidden',
          background: 'var(--color-bg-tertiary)',
          border: '1px solid var(--color-glass-border)',
        }}
      >
        {total > 0 &&
          buckets.map((b, i) => {
            const pct = clampPct(Math.max(0, b.value), total);
            if (pct <= 0) return null;
            return (
              <div
                key={i}
                title={`${b.label}: ${fmtCurrency(b.value)}`}
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: b.color,
                  transition: 'width 0.3s ease',
                }}
              />
            );
          })}
      </div>
      {showLegend && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px 16px',
            marginTop: 10,
          }}
        >
          {buckets.map((b, i) => (
            <div
              key={i}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 'var(--app-radius)',
                  background: b.color,
                  flexShrink: 0,
                }}
              />
              <span className="text-text-secondary" style={{ fontSize: 12 }}>
                {b.label}
              </span>
              <span
                className="text-text-primary font-mono"
                style={{ fontSize: 12, fontWeight: 600 }}
              >
                {fmtCurrency(b.value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/* PaymentProgress                                                     */
/* ================================================================== */

export interface PaymentProgressProps {
  paid?: number;
  total?: number;
  currency?: string;
  /** Bar height in px. */
  height?: number;
  /** Show the "X of Y" caption row above the bar. */
  showCaption?: boolean;
  className?: string;
}

export function PaymentProgress({
  paid = 1750,
  total = 2500,
  currency = 'USD',
  height = 8,
  showCaption = true,
  className,
}: PaymentProgressProps) {
  const pct = clampPct(paid, total);
  const fullyPaid = total > 0 && paid >= total;
  const fill = fullyPaid
    ? 'var(--color-accent-income)'
    : 'var(--color-accent-blue)';
  return (
    <div className={className}>
      {showCaption && (
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            marginBottom: 6,
          }}
        >
          <span
            className="text-text-secondary"
            style={{ fontSize: 12, fontWeight: 600 }}
          >
            {fmtCurrency(paid, currency)}
            <span className="text-text-muted" style={{ fontWeight: 400 }}>
              {' '}
              of {fmtCurrency(total, currency)}
            </span>
          </span>
          <span
            className="font-mono"
            style={{ fontSize: 12, fontWeight: 700, color: fill }}
          >
            {pct.toFixed(0)}%
          </span>
        </div>
      )}
      <div
        style={{
          width: '100%',
          height,
          borderRadius: 6,
          background: 'var(--color-bg-tertiary)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: 6,
            background: fill,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </div>
  );
}

/* ================================================================== */
/* DueDateChip                                                         */
/* ================================================================== */

export interface DueDateChipProps {
  /** Due date — Date or ISO string. */
  dueDate?: Date | string;
  /** Treat the invoice as already settled (renders neutral "Paid"). */
  paid?: boolean;
  /** Override "today" for deterministic rendering. */
  now?: Date | string;
  className?: string;
}

function toDate(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d);
}

function daysBetween(from: Date, to: Date): number {
  const ms = 24 * 60 * 60 * 1000;
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / ms);
}

export function DueDateChip({
  dueDate,
  paid = false,
  now,
  className,
}: DueDateChipProps) {
  const today = now ? toDate(now) : new Date();
  const due = dueDate ? toDate(dueDate) : new Date(today.getTime() + 5 * 24 * 60 * 60 * 1000);
  const dueLabel = due.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  let color = 'var(--color-text-secondary)';
  let bg = 'var(--color-bg-tertiary)';
  let text = `Due ${dueLabel}`;
  let Icon: typeof Calendar = Calendar;

  if (paid) {
    color = 'var(--color-accent-income)';
    bg = 'var(--color-accent-income-bg)';
    text = 'Paid';
    Icon = CheckCircle2;
  } else {
    const days = daysBetween(today, due);
    Icon = days < 0 ? AlertTriangle : days <= 3 ? Clock : Calendar;
    if (days < 0) {
      color = 'var(--color-accent-expense)';
      bg = 'var(--color-accent-expense-bg)';
      const n = Math.abs(days);
      text = `${n} day${n === 1 ? '' : 's'} overdue`;
    } else if (days === 0) {
      color = 'var(--color-accent-warning)';
      bg = 'var(--color-accent-warning-bg)';
      text = 'Due today';
    } else if (days <= 3) {
      color = 'var(--color-accent-warning)';
      bg = 'var(--color-accent-warning-bg)';
      text = `Due in ${days} day${days === 1 ? '' : 's'}`;
    } else if (days <= 7) {
      color = 'var(--color-accent-blue)';
      bg = 'var(--color-accent-blue-bg)';
      text = `Due ${dueLabel}`;
    }
  }

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px',
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.4,
        color,
        background: bg,
        border: `1px solid ${color}33`,
        whiteSpace: 'nowrap',
      }}
    >
      <Icon size={13} strokeWidth={2.2} />
      {text}
    </span>
  );
}

/* ================================================================== */
/* BalanceSummary                                                      */
/* ================================================================== */

export interface BalanceSummaryProps {
  total?: number;
  paid?: number;
  /** If omitted, derived as total - paid. */
  balance?: number;
  currency?: string;
  /** Optional heading for the card. */
  title?: string;
  className?: string;
}

export function BalanceSummary({
  total = 2500,
  paid = 1750,
  balance,
  currency = 'USD',
  title = 'Balance Summary',
  className,
}: BalanceSummaryProps) {
  const due = balance ?? Math.max(0, total - paid);
  const settled = due <= 0;

  const Row = ({
    label,
    value,
    color,
    strong,
  }: {
    label: string;
    value: number;
    color?: string;
    strong?: boolean;
  }) => (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        padding: '6px 0',
      }}
    >
      <span
        className={strong ? 'text-text-primary' : 'text-text-secondary'}
        style={{ fontSize: strong ? 13 : 12, fontWeight: strong ? 600 : 500 }}
      >
        {label}
      </span>
      <span
        className="font-mono"
        style={{
          fontSize: strong ? 16 : 13,
          fontWeight: strong ? 700 : 600,
          color: color ?? 'var(--color-text-primary)',
        }}
      >
        {fmtCurrency(value, currency)}
      </span>
    </div>
  );

  return (
    <div
      className={`block-card ${className ?? ''}`}
      style={{ padding: 16, minWidth: 240 }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <span
          className="text-text-secondary"
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 0.6,
          }}
        >
          {title}
        </span>
        <InvoiceStatusBadge status={settled ? 'paid' : 'partial'} compact />
      </div>

      <Row label="Total" value={total} />
      <Row label="Paid" value={paid} color="var(--color-accent-income)" />

      <div
        style={{
          height: 1,
          background: 'var(--color-glass-border)',
          margin: '4px 0',
        }}
      />

      <Row
        label="Balance Due"
        value={due}
        strong
        color={
          settled
            ? 'var(--color-accent-income)'
            : 'var(--color-accent-expense)'
        }
      />
    </div>
  );
}
