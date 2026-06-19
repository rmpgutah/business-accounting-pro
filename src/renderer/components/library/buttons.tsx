import React, { useState } from 'react';
import {
  Plus,
  Download,
  ChevronDown,
  MoreVertical,
  LayoutGrid,
  List,
  Calendar,
  FileText,
  Send,
  type LucideIcon,
} from 'lucide-react';

/**
 * Presentational button library — pure, theme-aware controls.
 * All components render with zero props using believable defaults.
 *
 * Theme tokens used: --color-bg-*, --color-text-*, --color-border-*,
 * --color-accent-* (mirrors the glass/block theme in styles/globals.css).
 */

/* ------------------------------------------------------------------ */
/* IconButton                                                          */
/* ------------------------------------------------------------------ */

export interface IconButtonProps {
  icon?: LucideIcon;
  /** Accessible label / tooltip. */
  label?: string;
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: number;
  disabled?: boolean;
  onClick?: () => void;
}

const VARIANT_STYLES: Record<
  NonNullable<IconButtonProps['variant']>,
  React.CSSProperties
> = {
  default: {
    background: 'var(--color-bg-tertiary)',
    border: '1px solid var(--color-border-secondary)',
    color: 'var(--color-text-primary)',
  },
  primary: {
    background: 'var(--color-accent-blue-bg)',
    border: '1px solid var(--color-accent-blue)',
    color: 'var(--color-accent-blue)',
  },
  danger: {
    background: 'var(--color-accent-expense-bg)',
    border: '1px solid var(--color-accent-expense)',
    color: 'var(--color-accent-expense)',
  },
  ghost: {
    background: 'transparent',
    border: '1px solid transparent',
    color: 'var(--color-text-secondary)',
  },
};

export function IconButton(props: IconButtonProps) {
  const {
    icon: Icon = MoreVertical,
    label = 'More',
    variant = 'default',
    size = 36,
    disabled = false,
    onClick,
  } = props;
  const [hover, setHover] = useState(false);

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        ...VARIANT_STYLES[variant],
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transition: 'all 0.15s ease',
        filter: hover && !disabled ? 'brightness(1.25)' : 'none',
      }}
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={2} />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* ButtonGroup — segmented control                                    */
/* ------------------------------------------------------------------ */

export interface ButtonGroupItem {
  id: string;
  label?: string;
  icon?: LucideIcon;
}

export interface ButtonGroupProps {
  items?: ButtonGroupItem[];
  value?: string;
  onChange?: (id: string) => void;
}

export function ButtonGroup(props: ButtonGroupProps) {
  const {
    items = [
      { id: 'grid', label: 'Grid', icon: LayoutGrid },
      { id: 'list', label: 'List', icon: List },
      { id: 'calendar', label: 'Calendar', icon: Calendar },
    ],
    value,
    onChange,
  } = props;

  const [internal, setInternal] = useState(value ?? items[0]?.id);
  const active = value ?? internal;

  const select = (id: string) => {
    setInternal(id);
    onChange?.(id);
  };

  return (
    <div
      role="group"
      style={{
        display: 'inline-flex',
        padding: 3,
        gap: 2,
        background: 'var(--color-bg-tertiary)',
        border: '1px solid var(--color-border-secondary)',
        borderRadius: 6,
      }}
    >
      {items.map((item) => {
        const isActive = item.id === active;
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={isActive}
            onClick={() => select(item.id)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              fontSize: 13,
              fontWeight: 500,
              borderRadius: 6,
              border: '1px solid transparent',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              background: isActive
                ? 'var(--color-bg-elevated)'
                : 'transparent',
              color: isActive
                ? 'var(--color-text-primary)'
                : 'var(--color-text-secondary)',
              borderColor: isActive
                ? 'var(--color-border-focus)'
                : 'transparent',
            }}
          >
            {Icon && <Icon size={15} strokeWidth={2} />}
            {item.label && <span>{item.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* QuickActionButton — icon + label tile                              */
/* ------------------------------------------------------------------ */

export interface QuickActionButtonProps {
  icon?: LucideIcon;
  label?: string;
  description?: string;
  accent?: 'blue' | 'income' | 'expense' | 'warning' | 'purple';
  onClick?: () => void;
}

const ACCENT_MAP: Record<
  NonNullable<QuickActionButtonProps['accent']>,
  { fg: string; bg: string }
> = {
  blue: { fg: 'var(--color-accent-blue)', bg: 'var(--color-accent-blue-bg)' },
  income: {
    fg: 'var(--color-accent-income)',
    bg: 'var(--color-accent-income-bg)',
  },
  expense: {
    fg: 'var(--color-accent-expense)',
    bg: 'var(--color-accent-expense-bg)',
  },
  warning: {
    fg: 'var(--color-accent-warning)',
    bg: 'var(--color-accent-warning-bg)',
  },
  purple: {
    fg: 'var(--color-accent-purple)',
    bg: 'var(--color-accent-purple-bg)',
  },
};

export function QuickActionButton(props: QuickActionButtonProps) {
  const {
    icon: Icon = Plus,
    label = 'New Invoice',
    description = 'Create a draft invoice',
    accent = 'blue',
    onClick,
  } = props;
  const [hover, setHover] = useState(false);
  const colors = ACCENT_MAP[accent];

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        textAlign: 'left',
        padding: '12px 14px',
        borderRadius: 6,
        cursor: 'pointer',
        background: hover
          ? 'var(--color-bg-elevated)'
          : 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border-secondary)',
        transition: 'all 0.15s ease',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 38,
          height: 38,
          flexShrink: 0,
          borderRadius: 6,
          background: colors.bg,
          color: colors.fg,
        }}
      >
        <Icon size={19} strokeWidth={2} />
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            lineHeight: 1.3,
          }}
        >
          {label}
        </span>
        {description && (
          <span
            style={{
              fontSize: 12,
              color: 'var(--color-text-muted)',
              lineHeight: 1.3,
            }}
          >
            {description}
          </span>
        )}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* SplitButton — primary action + caret menu                         */
/* ------------------------------------------------------------------ */

export interface SplitMenuItem {
  id: string;
  label: string;
  icon?: LucideIcon;
}

export interface SplitButtonProps {
  label?: string;
  icon?: LucideIcon;
  items?: SplitMenuItem[];
  onClick?: () => void;
  onSelect?: (id: string) => void;
}

export function SplitButton(props: SplitButtonProps) {
  const {
    label = 'Export',
    icon: Icon = Download,
    items = [
      { id: 'pdf', label: 'Export as PDF', icon: FileText },
      { id: 'csv', label: 'Export as CSV', icon: FileText },
      { id: 'send', label: 'Email report', icon: Send },
    ],
    onClick,
    onSelect,
  } = props;
  const [open, setOpen] = useState(false);

  const baseBtn: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 14px',
    fontSize: 13,
    fontWeight: 600,
    background: 'var(--color-accent-blue-bg)',
    color: 'var(--color-accent-blue)',
    border: '1px solid var(--color-accent-blue)',
    cursor: 'pointer',
    transition: 'filter 0.15s ease',
  };

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        onClick={onClick}
        style={{
          ...baseBtn,
          borderTopLeftRadius: 6,
          borderBottomLeftRadius: 6,
          borderRight: 'none',
        }}
      >
        <Icon size={15} strokeWidth={2} />
        <span>{label}</span>
      </button>
      <button
        type="button"
        aria-label="More options"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          ...baseBtn,
          padding: '8px 8px',
          borderTopRightRadius: 6,
          borderBottomRightRadius: 6,
          borderLeft: '1px solid var(--color-accent-blue)',
        }}
      >
        <ChevronDown
          size={15}
          strokeWidth={2}
          style={{
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s ease',
          }}
        />
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 200,
            zIndex: 20,
            padding: 4,
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border-secondary)',
            borderRadius: 6,
            boxShadow: '0 8px 28px rgba(0, 0, 0, 0.45)',
          }}
        >
          {items.map((item) => {
            const ItemIcon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onSelect?.(item.id);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 10px',
                  fontSize: 13,
                  borderRadius: 6,
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--color-text-secondary)',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--color-bg-hover)';
                  e.currentTarget.style.color = 'var(--color-text-primary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--color-text-secondary)';
                }}
              >
                {ItemIcon && <ItemIcon size={15} strokeWidth={2} />}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* FabButton — floating action button                                 */
/* ------------------------------------------------------------------ */

export interface FabButtonProps {
  icon?: LucideIcon;
  label?: string;
  /** Show the label inline (extended FAB) instead of icon-only. */
  extended?: boolean;
  size?: number;
  accent?: 'blue' | 'income' | 'expense' | 'warning' | 'purple';
  onClick?: () => void;
}

export function FabButton(props: FabButtonProps) {
  const {
    icon: Icon = Plus,
    label = 'New',
    extended = false,
    size = 52,
    accent = 'blue',
    onClick,
  } = props;
  const [hover, setHover] = useState(false);
  const colors = ACCENT_MAP[accent];

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: extended ? 9 : 0,
        height: size,
        width: extended ? 'auto' : size,
        padding: extended ? '0 20px' : 0,
        borderRadius: extended ? 6 : '50%',
        background: colors.bg,
        color: colors.fg,
        border: `1px solid ${colors.fg}`,
        cursor: 'pointer',
        fontSize: 14,
        fontWeight: 600,
        boxShadow: hover
          ? '0 10px 30px rgba(0, 0, 0, 0.5)'
          : '0 6px 18px rgba(0, 0, 0, 0.4)',
        transform: hover ? 'translateY(-2px)' : 'none',
        transition: 'all 0.18s ease',
      }}
    >
      <Icon size={Math.round(size * 0.42)} strokeWidth={2.2} />
      {extended && <span>{label}</span>}
    </button>
  );
}
