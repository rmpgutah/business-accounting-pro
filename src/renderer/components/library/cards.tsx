import React from 'react';
import {
  TrendingUp,
  TrendingDown,
  Info,
  type LucideIcon,
} from 'lucide-react';

/**
 * Presentational card primitives for the glass/block theme.
 *
 * Every component renders correctly with ZERO props (sensible mock
 * defaults). Pure presentational — no app imports, no data fetching.
 */

/* ------------------------------------------------------------------ */
/* GlassCard — glass card container                                    */
/* ------------------------------------------------------------------ */

export interface GlassCardProps {
  children?: React.ReactNode;
  /** Use the more prominent elevated background. */
  elevated?: boolean;
  /** Inner padding (px). */
  padding?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function GlassCard({
  children,
  elevated = false,
  padding = 16,
  className = '',
  style,
}: GlassCardProps) {
  return (
    <div
      className={`${elevated ? 'block-card-elevated' : 'block-card'} ${className}`}
      style={{ borderRadius: 6, padding, ...style }}
    >
      {children ?? (
        <div className="text-sm text-text-secondary">Glass card content</div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PanelCard — panel with header                                       */
/* ------------------------------------------------------------------ */

export interface PanelCardProps {
  title?: string;
  subtitle?: string;
  /** Optional node rendered on the right of the header (e.g. a button). */
  action?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export function PanelCard({
  title = 'Panel Title',
  subtitle,
  action,
  children,
  className = '',
}: PanelCardProps) {
  return (
    <div
      className={`block-card ${className}`}
      style={{ borderRadius: 6, padding: 0, overflow: 'hidden' }}
    >
      <div
        className="flex items-center justify-between"
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--color-border-primary)',
        }}
      >
        <div>
          <div className="text-sm font-semibold text-text-primary">{title}</div>
          {subtitle && (
            <div className="text-xs text-text-muted" style={{ marginTop: 2 }}>
              {subtitle}
            </div>
          )}
        </div>
        {action && <div className="ml-2 flex-shrink-0">{action}</div>}
      </div>
      <div style={{ padding: 16 }}>
        {children ?? (
          <div className="text-sm text-text-secondary">Panel body content</div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* StatGrid — grid of stat tiles                                       */
/* ------------------------------------------------------------------ */

type StatTrend = 'up' | 'down' | 'flat';

export interface StatTile {
  label: string;
  value: string;
  delta?: string;
  trend?: StatTrend;
  /** Accent color token, e.g. var(--color-accent-blue). */
  accent?: string;
}

export interface StatGridProps {
  stats?: StatTile[];
  /** Number of columns. */
  columns?: number;
  className?: string;
}

const DEFAULT_STATS: StatTile[] = [
  {
    label: 'Total Revenue',
    value: '$128,450',
    delta: '+12.4%',
    trend: 'up',
    accent: 'var(--color-accent-income)',
  },
  {
    label: 'Total Expenses',
    value: '$74,120',
    delta: '+3.1%',
    trend: 'down',
    accent: 'var(--color-accent-expense)',
  },
  {
    label: 'Net Profit',
    value: '$54,330',
    delta: '+21.8%',
    trend: 'up',
    accent: 'var(--color-accent-blue)',
  },
  {
    label: 'Outstanding AR',
    value: '$19,275',
    delta: '-5.6%',
    trend: 'down',
    accent: 'var(--color-accent-warning)',
  },
];

export function StatGrid({
  stats = DEFAULT_STATS,
  columns = 4,
  className = '',
}: StatGridProps) {
  return (
    <div
      className={className}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: 12,
      }}
    >
      {stats.map((s, i) => {
        const accent = s.accent ?? 'var(--color-accent-blue)';
        const trend: StatTrend = s.trend ?? 'flat';
        const TrendIcon = trend === 'down' ? TrendingDown : TrendingUp;
        const deltaColor =
          trend === 'up'
            ? 'var(--color-accent-income)'
            : trend === 'down'
              ? 'var(--color-accent-expense)'
              : 'var(--color-text-muted)';
        return (
          <div
            key={i}
            className="block-card"
            style={{
              borderRadius: 6,
              padding: 14,
              borderLeft: `2px solid ${accent}`,
            }}
          >
            <div className="text-xs text-text-secondary truncate" title={s.label}>
              {s.label}
            </div>
            <div
              className="font-semibold text-text-primary"
              style={{ fontSize: 22, marginTop: 6 }}
            >
              {s.value}
            </div>
            {s.delta && (
              <div
                className="flex items-center text-xs"
                style={{ marginTop: 6, color: deltaColor, gap: 4 }}
              >
                {trend !== 'flat' && <TrendIcon size={13} />}
                <span className="font-mono">{s.delta}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SplitPanel — two-pane split                                         */
/* ------------------------------------------------------------------ */

export interface SplitPanelProps {
  left?: React.ReactNode;
  right?: React.ReactNode;
  leftTitle?: string;
  rightTitle?: string;
  /** Left pane fraction (0–1). */
  ratio?: number;
  /** Stack vertically below this many px is not handled; use vertical prop. */
  vertical?: boolean;
  className?: string;
}

export function SplitPanel({
  left,
  right,
  leftTitle = 'Overview',
  rightTitle = 'Details',
  ratio = 0.5,
  vertical = false,
  className = '',
}: SplitPanelProps) {
  const clamped = Math.max(0.15, Math.min(0.85, ratio));
  const leftFr = clamped;
  const rightFr = 1 - clamped;

  const pane = (title: string, content: React.ReactNode, fallback: string) => (
    <div
      className="block-card"
      style={{ borderRadius: 6, padding: 0, overflow: 'hidden', minWidth: 0 }}
    >
      <div
        className="text-xs font-semibold text-text-secondary"
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--color-border-primary)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {title}
      </div>
      <div style={{ padding: 14 }}>
        {content ?? <div className="text-sm text-text-secondary">{fallback}</div>}
      </div>
    </div>
  );

  return (
    <div
      className={className}
      style={{
        display: 'grid',
        gridTemplateColumns: vertical ? '1fr' : `${leftFr}fr ${rightFr}fr`,
        gap: 12,
      }}
    >
      {pane(leftTitle, left, 'Left pane content')}
      {pane(rightTitle, right, 'Right pane content')}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* InfoCard — icon + title + body card                                 */
/* ------------------------------------------------------------------ */

export interface InfoCardProps {
  icon?: LucideIcon;
  title?: string;
  body?: string;
  /** Accent color token used for the icon chip. */
  accent?: string;
  children?: React.ReactNode;
  className?: string;
}

export function InfoCard({
  icon: Icon = Info,
  title = 'Did you know?',
  body = 'This card surfaces a helpful tip, status note, or contextual detail with an accent icon chip.',
  accent = 'var(--color-accent-blue)',
  children,
  className = '',
}: InfoCardProps) {
  return (
    <div
      className={`block-card ${className}`}
      style={{ borderRadius: 6, padding: 16 }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div
          style={{
            flexShrink: 0,
            width: 36,
            height: 36,
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: accent,
            background:
              'color-mix(in srgb, ' + accent + ' 14%, transparent)',
          }}
        >
          <Icon size={18} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="text-sm font-semibold text-text-primary">{title}</div>
          <div
            className="text-sm text-text-secondary"
            style={{ marginTop: 4, lineHeight: 1.45 }}
          >
            {children ?? body}
          </div>
        </div>
      </div>
    </div>
  );
}
