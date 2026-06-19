import React from 'react';
import { ChevronRight } from 'lucide-react';

/**
 * structure.tsx — presentational layout/structure primitives for the
 * glass/block theme. Every component renders correctly with zero props.
 */

/* ───────────────────────── DividerLabeled ───────────────────────── */

export interface DividerLabeledProps {
  label?: string;
  /** Horizontal alignment of the label within the divider. */
  align?: 'left' | 'center' | 'right';
  className?: string;
}

export function DividerLabeled({
  label = 'Section',
  align = 'center',
  className,
}: DividerLabeledProps) {
  const line = (
    <div
      style={{
        flex: 1,
        height: 1,
        background: 'var(--color-border-secondary, rgba(255,255,255,0.10))',
      }}
    />
  );
  return (
    <div
      className={className}
      style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}
    >
      {align !== 'left' && line}
      <span
        className="text-text-muted"
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      {align !== 'right' && line}
    </div>
  );
}

/* ───────────────────────── ScrollAreaBox ───────────────────────── */

export interface ScrollAreaBoxProps {
  children?: React.ReactNode;
  /** Max height before scrolling kicks in. */
  maxHeight?: number | string;
  /** Optional header label rendered above the scroll region. */
  title?: string;
  className?: string;
}

export function ScrollAreaBox({
  children,
  maxHeight = 220,
  title,
  className,
}: ScrollAreaBoxProps) {
  const content =
    children ??
    Array.from({ length: 12 }).map((_, i) => (
      <div
        key={i}
        className="text-text-secondary"
        style={{
          padding: '8px 12px',
          fontSize: 13,
          borderBottom: '1px solid var(--color-border-primary, rgba(255,255,255,0.06))',
        }}
      >
        Scrollable item {i + 1}
      </div>
    ));

  return (
    <div className={`block-card ${className ?? ''}`.trim()} style={{ padding: 0, overflow: 'hidden' }}>
      {title && (
        <div
          className="text-text-primary"
          style={{
            padding: '10px 12px',
            fontSize: 12,
            fontWeight: 600,
            borderBottom: '1px solid var(--color-border-secondary, rgba(255,255,255,0.10))',
            background: 'var(--color-bg-tertiary, rgba(28,30,38,0.65))',
          }}
        >
          {title}
        </div>
      )}
      <div style={{ maxHeight, overflowY: 'auto' }}>{content}</div>
    </div>
  );
}

/* ───────────────────────── StickyHeaderBar ───────────────────────── */

export interface StickyHeaderBarProps {
  title?: string;
  subtitle?: string;
  /** Right-aligned content (e.g. actions). */
  actions?: React.ReactNode;
  /** Offset from the top of the scroll container. */
  top?: number;
  className?: string;
}

export function StickyHeaderBar({
  title = 'Overview',
  subtitle,
  actions,
  top = 0,
  className,
}: StickyHeaderBarProps) {
  return (
    <div
      className={className}
      style={{
        position: 'sticky',
        top,
        zIndex: 5,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '12px 16px',
        borderRadius: 6,
        background: 'var(--color-bg-elevated, rgba(32,34,44,0.85))',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--color-border-secondary, rgba(255,255,255,0.10))',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          className="text-text-primary"
          style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.2 }}
        >
          {title}
        </div>
        {subtitle && (
          <div className="text-text-muted" style={{ fontSize: 12, marginTop: 2 }}>
            {subtitle}
          </div>
        )}
      </div>
      {actions ? (
        <div style={{ flexShrink: 0 }}>{actions}</div>
      ) : (
        <button className="block-btn" style={{ flexShrink: 0 }}>
          Action
        </button>
      )}
    </div>
  );
}

/* ───────────────────────── TwoColLayout ───────────────────────── */

export interface TwoColLayoutProps {
  left?: React.ReactNode;
  right?: React.ReactNode;
  /** Width of the left column (CSS grid track). */
  leftWidth?: string;
  gap?: number;
  /** Collapse to a single column below this breakpoint width (px). */
  className?: string;
}

export function TwoColLayout({
  left,
  right,
  leftWidth = '260px',
  gap = 16,
  className,
}: TwoColLayoutProps) {
  const placeholder = (label: string) => (
    <div
      className="block-card text-text-secondary"
      style={{ minHeight: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}
    >
      {label}
    </div>
  );
  return (
    <div
      className={className}
      style={{
        display: 'grid',
        gridTemplateColumns: `${leftWidth} 1fr`,
        gap,
        width: '100%',
      }}
    >
      <div>{left ?? placeholder('Left column')}</div>
      <div>{right ?? placeholder('Right column')}</div>
    </div>
  );
}

/* ───────────────────────── ListRowItem ───────────────────────── */

export interface ListRowItemProps {
  /** Leading element (icon, avatar, swatch). */
  leading?: React.ReactNode;
  title?: string;
  subtitle?: string;
  /** Trailing element (value, badge, chevron). */
  trailing?: React.ReactNode;
  /** Show a chevron when no trailing is provided. */
  showChevron?: boolean;
  onClick?: () => void;
  className?: string;
}

export function ListRowItem({
  leading,
  title = 'List item',
  subtitle = 'Supporting detail',
  trailing,
  showChevron = true,
  onClick,
  className,
}: ListRowItemProps) {
  const defaultLeading = (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: 6,
        flexShrink: 0,
        background: 'var(--color-accent-blue-bg, rgba(96,165,250,0.12))',
        color: 'var(--color-accent-blue, #60a5fa)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 13,
        fontWeight: 700,
      }}
    >
      A
    </div>
  );

  return (
    <div
      className={className}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        borderRadius: 6,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background 0.15s ease',
        background: 'transparent',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background =
          'var(--color-bg-hover, rgba(42,44,56,0.60))';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = 'transparent';
      }}
    >
      {leading ?? defaultLeading}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="text-text-primary truncate"
          style={{ fontSize: 13, fontWeight: 500 }}
        >
          {title}
        </div>
        {subtitle && (
          <div className="text-text-muted truncate" style={{ fontSize: 12 }}>
            {subtitle}
          </div>
        )}
      </div>
      {trailing ?? (
        showChevron && (
          <ChevronRight size={16} className="text-text-muted" style={{ flexShrink: 0 }} />
        )
      )}
    </div>
  );
}
