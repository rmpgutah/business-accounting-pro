import React from 'react';
import { X, Check, AlertTriangle, Clock, Ban, Bell } from 'lucide-react';

/**
 * Badges & pills — small presentational status indicators for the
 * glass/block theme. All props optional; every component renders bare.
 */

type ToneKey = 'income' | 'expense' | 'blue' | 'warning' | 'purple' | 'neutral';

interface ToneStyle {
  fg: string;
  bg: string;
  border: string;
}

function tone(key: ToneKey): ToneStyle {
  switch (key) {
    case 'income':
      return {
        fg: 'var(--color-accent-income, #34d399)',
        bg: 'var(--color-accent-income-bg, rgba(52,211,153,0.12))',
        border: 'rgba(52,211,153,0.30)',
      };
    case 'expense':
      return {
        fg: 'var(--color-accent-expense, #f87171)',
        bg: 'var(--color-accent-expense-bg, rgba(248,113,113,0.12))',
        border: 'rgba(248,113,113,0.30)',
      };
    case 'warning':
      return {
        fg: 'var(--color-accent-warning, #fbbf24)',
        bg: 'var(--color-accent-warning-bg, rgba(251,191,36,0.12))',
        border: 'rgba(251,191,36,0.30)',
      };
    case 'purple':
      return {
        fg: 'var(--color-accent-purple, #c084fc)',
        bg: 'var(--color-accent-purple-bg, rgba(192,132,252,0.12))',
        border: 'rgba(192,132,252,0.30)',
      };
    case 'neutral':
      return {
        fg: 'var(--color-text-secondary, #9a9db0)',
        bg: 'var(--color-bg-tertiary, rgba(28,30,38,0.65))',
        border: 'var(--color-glass-border, rgba(255,255,255,0.08))',
      };
    case 'blue':
    default:
      return {
        fg: 'var(--color-accent-blue, #60a5fa)',
        bg: 'var(--color-accent-blue-bg, rgba(96,165,250,0.12))',
        border: 'rgba(96,165,250,0.30)',
      };
  }
}

/* ---------------------------------------------------------------- StatusPill */

export type StatusPillStatus =
  | 'paid'
  | 'pending'
  | 'overdue'
  | 'draft'
  | 'active'
  | 'void';

export interface StatusPillProps {
  /** Predefined status drives label + color + icon when label omitted. */
  status?: StatusPillStatus;
  /** Override the displayed text. */
  label?: string;
  /** Show a small leading dot instead of an icon. */
  dot?: boolean;
  /** Hide the leading icon entirely. */
  hideIcon?: boolean;
  className?: string;
}

const STATUS_MAP: Record<
  StatusPillStatus,
  { label: string; tone: ToneKey; Icon: React.ComponentType<{ size?: number }> }
> = {
  paid: { label: 'Paid', tone: 'income', Icon: Check },
  active: { label: 'Active', tone: 'income', Icon: Check },
  pending: { label: 'Pending', tone: 'warning', Icon: Clock },
  draft: { label: 'Draft', tone: 'neutral', Icon: Clock },
  overdue: { label: 'Overdue', tone: 'expense', Icon: AlertTriangle },
  void: { label: 'Void', tone: 'neutral', Icon: Ban },
};

export function StatusPill({
  status = 'paid',
  label,
  dot = false,
  hideIcon = false,
  className,
}: StatusPillProps) {
  const cfg = STATUS_MAP[status] ?? STATUS_MAP.paid;
  const t = tone(cfg.tone);
  const Icon = cfg.Icon;
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 10px',
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.2,
        color: t.fg,
        background: t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: 6,
        whiteSpace: 'nowrap',
      }}
    >
      {dot ? (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: t.fg,
            flexShrink: 0,
          }}
        />
      ) : hideIcon ? null : (
        <Icon size={12} />
      )}
      {label ?? cfg.label}
    </span>
  );
}

/* ------------------------------------------------------------------- TagChip */

export interface TagChipProps {
  /** Chip text. */
  label?: string;
  /** Color tone for the chip. */
  toneKey?: ToneKey;
  /** Show the removable (x) affordance. */
  removable?: boolean;
  /** Called when the remove button is clicked. */
  onRemove?: () => void;
  className?: string;
}

export function TagChip({
  label = 'Marketing',
  toneKey = 'blue',
  removable = true,
  onRemove,
  className,
}: TagChipProps) {
  const t = tone(toneKey);
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: removable ? '3px 6px 3px 10px' : '3px 10px',
        fontSize: 12,
        fontWeight: 500,
        lineHeight: 1.2,
        color: t.fg,
        background: t.bg,
        border: `1px solid ${t.border}`,
        borderRadius: 6,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
      {removable && (
        <button
          type="button"
          aria-label={`Remove ${label}`}
          onClick={onRemove}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 16,
            height: 16,
            padding: 0,
            margin: 0,
            color: t.fg,
            background: 'transparent',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            opacity: 0.75,
          }}
        >
          <X size={12} />
        </button>
      )}
    </span>
  );
}

/* ---------------------------------------------------------------- CountBadge */

export interface CountBadgeProps {
  /** Numeric value. Values above `max` render as `max+`. */
  count?: number;
  max?: number;
  toneKey?: ToneKey;
  /** Solid filled style (accent background) vs. subtle tinted style. */
  solid?: boolean;
  className?: string;
}

export function CountBadge({
  count = 12,
  max = 99,
  toneKey = 'blue',
  solid = false,
  className,
}: CountBadgeProps) {
  const t = tone(toneKey);
  const display = count > max ? `${max}+` : `${count}`;
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 20,
        height: 20,
        padding: '0 6px',
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1,
        fontVariantNumeric: 'tabular-nums',
        color: solid ? '#08090c' : t.fg,
        background: solid ? t.fg : t.bg,
        border: solid ? 'none' : `1px solid ${t.border}`,
        borderRadius: 6,
      }}
    >
      {display}
    </span>
  );
}

/* -------------------------------------------------------------- RibbonBadge */

export interface RibbonBadgeProps {
  /** Ribbon text. */
  label?: string;
  toneKey?: ToneKey;
  /** Which corner to anchor the ribbon to. */
  corner?: 'top-right' | 'top-left';
  /** Content the ribbon overlays (defaults to a sample card). */
  children?: React.ReactNode;
  className?: string;
}

export function RibbonBadge({
  label = 'NEW',
  toneKey = 'income',
  corner = 'top-right',
  children,
  className,
}: RibbonBadgeProps) {
  const t = tone(toneKey);
  const isRight = corner === 'top-right';
  return (
    <div
      className={className}
      style={{ position: 'relative', overflow: 'hidden', borderRadius: 6 }}
    >
      {children ?? (
        <div
          style={{
            minWidth: 180,
            minHeight: 90,
            padding: 16,
            background: 'var(--color-bg-secondary, rgba(18,19,24,0.80))',
            border: '1px solid var(--color-glass-border, rgba(255,255,255,0.08))',
            borderRadius: 6,
            color: 'var(--color-text-secondary, #9a9db0)',
            fontSize: 13,
          }}
        >
          Featured item
        </div>
      )}
      <span
        style={{
          position: 'absolute',
          top: 14,
          [isRight ? 'right' : 'left']: -34,
          transform: `rotate(${isRight ? 45 : -45}deg)`,
          width: 130,
          textAlign: 'center',
          padding: '3px 0',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: '#08090c',
          background: t.fg,
          boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
        }}
      >
        {label}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------ NotificationDot */

export interface NotificationDotProps {
  /** Optional numeric count rendered inside the indicator. */
  count?: number;
  max?: number;
  toneKey?: ToneKey;
  /** Animated ping ring around the dot. */
  pulse?: boolean;
  /** Element the dot is anchored to (defaults to a bell icon). */
  children?: React.ReactNode;
  className?: string;
}

export function NotificationDot({
  count,
  max = 9,
  toneKey = 'expense',
  pulse = false,
  children,
  className,
}: NotificationDotProps) {
  const t = tone(toneKey);
  const hasCount = typeof count === 'number' && count > 0;
  const display = hasCount ? (count! > max ? `${max}+` : `${count}`) : '';
  return (
    <span
      className={className}
      style={{ position: 'relative', display: 'inline-flex' }}
    >
      {children ?? (
        <Bell size={20} style={{ color: 'var(--color-text-secondary, #9a9db0)' }} />
      )}
      {pulse && (
        <span
          style={{
            position: 'absolute',
            top: -3,
            right: -3,
            width: hasCount ? 16 : 9,
            height: hasCount ? 16 : 9,
            borderRadius: 999,
            background: t.fg,
            opacity: 0.5,
            animation: 'ping 1.2s cubic-bezier(0,0,0.2,1) infinite',
          }}
        />
      )}
      <span
        style={{
          position: 'absolute',
          top: -4,
          right: -4,
          minWidth: hasCount ? 16 : 9,
          height: hasCount ? 16 : 9,
          padding: hasCount ? '0 4px' : 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 10,
          fontWeight: 700,
          lineHeight: 1,
          color: '#08090c',
          background: t.fg,
          border: '1.5px solid var(--color-bg-primary-solid, #08090c)',
          borderRadius: 999,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {display}
      </span>
    </span>
  );
}
