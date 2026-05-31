import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

/**
 * Utility components — small presentational helpers for the glass/block
 * theme. Allowed imports: react + lucide-react only. Every prop is optional
 * so each component renders correctly with zero props.
 */

const GLASS_BORDER = 'var(--color-glass-border, rgba(255,255,255,0.08))';
const BG_TERTIARY = 'var(--color-bg-tertiary, rgba(28,30,38,0.65))';
const BG_ELEVATED = 'var(--color-bg-elevated, rgba(40,42,52,0.9))';
const TEXT_PRIMARY = 'var(--color-text-primary, #e6e7ee)';
const TEXT_SECONDARY = 'var(--color-text-secondary, #9a9db0)';
const TEXT_MUTED = 'var(--color-text-muted, #6b6e80)';
const ACCENT_GREEN = 'var(--color-accent-income, #34d399)';

/* ------------------------------------------------------------- CopyButton */

export interface CopyButtonProps {
  /** Text copied to the clipboard when clicked. */
  value?: string;
  /** Label shown next to the icon. Omit for icon-only. */
  label?: string;
  /** Show the value itself as the label. */
  showValue?: boolean;
  className?: string;
}

export function CopyButton({
  value = 'INV-2026-0042',
  label,
  showValue = false,
  className,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    try {
      navigator.clipboard?.writeText(value);
    } catch {
      /* clipboard unavailable — still flash the confirmation */
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const text = label ?? (showValue ? value : undefined);

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'Copied!' : `Copy ${value}`}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: text ? '5px 10px' : 6,
        fontSize: 12,
        fontWeight: 500,
        color: copied ? ACCENT_GREEN : TEXT_SECONDARY,
        background: BG_TERTIARY,
        border: `1px solid ${GLASS_BORDER}`,
        borderRadius: 6,
        cursor: 'pointer',
        transition: 'color 0.15s ease, background 0.15s ease',
      }}
    >
      {copied ? (
        <Check size={14} strokeWidth={2.4} />
      ) : (
        <Copy size={14} strokeWidth={2} />
      )}
      {text && (
        <span style={{ fontFamily: showValue ? 'monospace' : undefined }}>
          {copied ? 'Copied' : text}
        </span>
      )}
    </button>
  );
}

/* ------------------------------------------------------------- ColorSwatch */

export interface ColorSwatchProps {
  /** Any CSS color or var(--…) token. */
  color?: string;
  /** Caption under/next to the swatch. */
  label?: string;
  /** Show the color string beneath the label. */
  showHex?: boolean;
  /** Swatch square size in px. */
  size?: number;
  className?: string;
}

export function ColorSwatch({
  color = 'var(--color-accent-blue, #60a5fa)',
  label = 'Accent Blue',
  showHex = true,
  size = 36,
  className,
}: ColorSwatchProps) {
  return (
    <div
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}
    >
      <span
        title={color}
        style={{
          width: size,
          height: size,
          flexShrink: 0,
          background: color,
          borderRadius: 6,
          border: `1px solid ${GLASS_BORDER}`,
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
        }}
      />
      {(label || showHex) && (
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
          {label && (
            <span style={{ fontSize: 12, fontWeight: 500, color: TEXT_PRIMARY }}>
              {label}
            </span>
          )}
          {showHex && (
            <span
              style={{ fontSize: 11, fontFamily: 'monospace', color: TEXT_MUTED }}
            >
              {color}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- TooltipChip */

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface TooltipChipProps {
  /** Visible chip label. */
  label?: string;
  /** Tooltip text revealed on hover. */
  tooltip?: string;
  placement?: TooltipPlacement;
  className?: string;
}

export function TooltipChip({
  label = 'MRR',
  tooltip = 'Monthly Recurring Revenue — normalized monthly subscription income.',
  placement = 'top',
  className,
}: TooltipChipProps) {
  const [open, setOpen] = useState(false);

  const pos: React.CSSProperties = (() => {
    switch (placement) {
      case 'bottom':
        return { top: '100%', left: '50%', transform: 'translate(-50%, 6px)' };
      case 'left':
        return { right: '100%', top: '50%', transform: 'translate(-6px, -50%)' };
      case 'right':
        return { left: '100%', top: '50%', transform: 'translate(6px, -50%)' };
      case 'top':
      default:
        return { bottom: '100%', left: '50%', transform: 'translate(-50%, -6px)' };
    }
  })();

  return (
    <span
      className={className}
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '3px 9px',
          fontSize: 12,
          fontWeight: 500,
          color: TEXT_SECONDARY,
          background: BG_TERTIARY,
          border: `1px dashed ${GLASS_BORDER}`,
          borderRadius: 6,
          cursor: 'help',
        }}
      >
        {label}
      </span>
      {open && (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            zIndex: 50,
            ...pos,
            width: 'max-content',
            maxWidth: 220,
            padding: '6px 9px',
            fontSize: 11,
            lineHeight: 1.4,
            color: TEXT_PRIMARY,
            background: BG_ELEVATED,
            border: `1px solid ${GLASS_BORDER}`,
            borderRadius: 6,
            boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
            pointerEvents: 'none',
          }}
        >
          {tooltip}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------- KeyboardKey */

export interface KeyboardKeyProps {
  /** Single key, e.g. "K". For combos pass `keys`. */
  keyName?: string;
  /** Ordered list of keys rendered as a combo (joined by +). */
  keys?: string[];
  className?: string;
}

export function KeyboardKey({
  keyName = 'K',
  keys,
  className,
}: KeyboardKeyProps) {
  const list = keys && keys.length > 0 ? keys : [keyName];

  return (
    <span
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
    >
      {list.map((k, i) => (
        <React.Fragment key={`${k}-${i}`}>
          {i > 0 && (
            <span style={{ fontSize: 11, color: TEXT_MUTED }}>+</span>
          )}
          <kbd
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 22,
              height: 22,
              padding: '0 6px',
              fontSize: 11,
              fontWeight: 600,
              fontFamily: 'monospace',
              color: TEXT_PRIMARY,
              background: BG_ELEVATED,
              border: `1px solid ${GLASS_BORDER}`,
              borderBottomWidth: 2,
              borderRadius: 6,
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
            }}
          >
            {k}
          </kbd>
        </React.Fragment>
      ))}
    </span>
  );
}

/* ------------------------------------------------------------- ThemePreview */

export interface ThemeColor {
  name: string;
  color: string;
}

export interface ThemePreviewProps {
  /** Theme name shown as the row heading. */
  title?: string;
  /** Ordered list of named colors. */
  colors?: ThemeColor[];
  className?: string;
}

const DEFAULT_THEME: ThemeColor[] = [
  { name: 'Primary', color: 'var(--color-bg-primary-solid, #14161d)' },
  { name: 'Surface', color: 'var(--color-bg-secondary-solid, #1c1e26)' },
  { name: 'Blue', color: 'var(--color-accent-blue, #60a5fa)' },
  { name: 'Income', color: 'var(--color-accent-income, #34d399)' },
  { name: 'Expense', color: 'var(--color-accent-expense, #f87171)' },
  { name: 'Warning', color: 'var(--color-accent-warning, #fbbf24)' },
  { name: 'Purple', color: 'var(--color-accent-purple, #c084fc)' },
];

export function ThemePreview({
  title = 'Glass Dark',
  colors = DEFAULT_THEME,
  className,
}: ThemePreviewProps) {
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 12,
        background: BG_TERTIARY,
        border: `1px solid ${GLASS_BORDER}`,
        borderRadius: 6,
      }}
    >
      {title && (
        <span style={{ fontSize: 12, fontWeight: 600, color: TEXT_PRIMARY }}>
          {title}
        </span>
      )}
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 6 }}>
        {colors.map((c, i) => (
          <div
            key={`${c.name}-${i}`}
            title={`${c.name} — ${c.color}`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              flex: 1,
              minWidth: 0,
            }}
          >
            <span
              style={{
                width: '100%',
                height: 28,
                background: c.color,
                borderRadius: 6,
                border: `1px solid ${GLASS_BORDER}`,
              }}
            />
            <span
              style={{
                fontSize: 10,
                color: TEXT_SECONDARY,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '100%',
              }}
            >
              {c.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
