import React from 'react';
import { formatCurrency } from '../lib/format';

/**
 * <KpiTile> — universal KPI tile.
 *
 * Renders as a chunky `.block-card` on screen and collapses to inline
 * summary text inside the `.report-summary-tiles` print container.
 *
 * Set `printVariant="inline"` to render inline summary text on screen too
 * (handy when stacking many KPIs in a tight strip), or omit for the default
 * card rendering.
 */
export interface KpiTileProps {
  label: string;
  /** Numeric value (rendered with `formatCurrency` if `format="currency"`). */
  value: number | string;
  /** "currency" | "number" | "percent" | "text". Default "currency". */
  format?: 'currency' | 'number' | 'percent' | 'text';
  /** Trend %. Positive renders ↑ green, negative ↓ red. */
  trendPct?: number | null;
  /** Sub-text below the value (e.g. "as of Apr 23, 2026"). */
  subtext?: string;
  /** Tailwind border-l accent class (e.g. "border-l-accent-income"). */
  accentClass?: string;
  /** "card" (default) | "inline" — inline = compact label/value pair, used in summary strips. */
  printVariant?: 'card' | 'inline';
  icon?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

function formatValue(value: number | string, fmt: KpiTileProps['format']): string {
  if (typeof value === 'string') return value;
  switch (fmt) {
    case 'percent':
      return `${value.toFixed(1)}%`;
    case 'number':
      return Number.isInteger(value) ? String(value) : value.toFixed(1);
    case 'text':
      return String(value);
    case 'currency':
    default:
      return formatCurrency(value);
  }
}

const KpiTile: React.FC<KpiTileProps> = ({
  label,
  value,
  format = 'currency',
  trendPct,
  subtext,
  accentClass,
  printVariant = 'card',
  icon,
  onClick,
  className,
}) => {
  const display = formatValue(value, format);

  // Trend rendering — uses the existing variance-over / variance-under
  // print classes so PDF output gets the same color + arrow.
  const trendNode =
    trendPct == null || !Number.isFinite(trendPct) ? null : (
      <span
        className={`text-xs font-mono inline-block ${
          trendPct >= 0
            ? 'text-accent-income variance-under'
            : 'text-accent-expense variance-over'
        }`}
      >
        {trendPct >= 0 ? '+' : ''}
        {trendPct.toFixed(1)}%
      </span>
    );

  if (printVariant === 'inline') {
    return (
      <div className={`flex flex-col ${className ?? ''}`}>
        <span className="text-[10px] uppercase tracking-wider text-text-muted">
          {label}
        </span>
        <span className="text-sm font-mono font-semibold text-text-primary">
          {display}
          {trendNode && <span className="ml-2">{trendNode}</span>}
        </span>
        {subtext && (
          <span className="text-[10px] text-text-muted">{subtext}</span>
        )}
      </div>
    );
  }

  return (
    <div
      className={`block-card py-6 px-5 ${
        accentClass ? `border-l-4 ${accentClass}` : ''
      } ${onClick ? 'cursor-pointer hover:bg-bg-hover hover:scale-[1.02] transition-all duration-200' : ''} ${className ?? ''}`}
      style={{ borderRadius: '6px' }}
      onClick={onClick}
    >
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
          {label}
        </span>
      </div>
      <p className="text-3xl font-mono text-text-primary">{display}</p>
      <div className="mt-1 flex items-center gap-2">
        {trendNode}
        {subtext && (
          <span className="text-[11px] text-text-muted">{subtext}</span>
        )}
      </div>
    </div>
  );
};

export default KpiTile;
