import React from 'react';

/**
 * <DataBar> — small horizontal bar visual.
 *
 * Pure CSS (no SVG/recharts), so it survives print without any
 * fallback dance. Use anywhere a horizontal "% of total" indicator
 * is helpful (top-vendor lists, top-client breakdowns, working-capital
 * splits, etc.).
 */
export interface DataBarProps {
  value: number;
  total: number;
  label?: string;
  /** Bar fill color — accepts any CSS color or var(--…) token. */
  color?: string;
  /** Render as a thin (default) or thicker bar. */
  thickness?: number;
  /** Show numeric value to the right of the label. */
  rightText?: string;
  className?: string;
}

const DataBar: React.FC<DataBarProps> = ({
  value,
  total,
  label,
  color = 'var(--color-accent-blue, #3b82f6)',
  thickness = 6,
  rightText,
  className,
}) => {
  const pct = total > 0 ? Math.max(0, Math.min(100, (value / total) * 100)) : 0;
  return (
    <div className={className}>
      {(label || rightText) && (
        <div
          className="flex items-center justify-between text-xs"
          style={{ marginBottom: 4 }}
        >
          {label && (
            <span className="text-text-secondary truncate" title={label}>
              {label}
            </span>
          )}
          {rightText && (
            <span className="font-mono text-text-primary ml-2">{rightText}</span>
          )}
        </div>
      )}
      <div
        style={{
          width: '100%',
          height: thickness,
          backgroundColor: 'var(--color-bg-tertiary, #2e2e2e)',
          borderRadius: 1,
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            backgroundColor: color,
            borderRadius: 1,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
    </div>
  );
};

export default DataBar;
