import React from 'react';

/**
 * <HeatCell> — single colored cell for a heat-map grid (working-TB,
 * posting-frequency, etc.). Pure CSS — works in print thanks to the
 * `.heatmap-cell` print rule in globals.css that forces color preservation.
 */
export interface HeatCellProps {
  value: number;
  /** Optional max for normalization; defaults to 1. */
  max?: number;
  /** Hue palette: blue (default), red, green, purple. */
  palette?: 'blue' | 'red' | 'green' | 'purple';
  /** Optional cell label override (otherwise the value is shown). */
  label?: string;
  size?: number;
  title?: string;
}

const PALETTES: Record<NonNullable<HeatCellProps['palette']>, string> = {
  blue: '37, 99, 235',
  red: '220, 38, 38',
  green: '22, 163, 74',
  purple: '147, 51, 234',
};

export const HeatCell: React.FC<HeatCellProps> = ({
  value,
  max = 1,
  palette = 'blue',
  label,
  size = 28,
  title,
}) => {
  const intensity = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const rgb = PALETTES[palette];
  const bg = `rgba(${rgb}, ${0.08 + intensity * 0.85})`;
  const fg = intensity > 0.55 ? '#ffffff' : '#0b1220';
  return (
    <div
      className="heatmap-cell"
      data-heatmap-cell="true"
      title={title ?? `${value}`}
      style={{
        width: size,
        height: size,
        background: bg,
        color: fg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 10,
        fontFamily: 'monospace',
        fontWeight: 600,
        border: '1px solid rgba(255,255,255,0.04)',
      }}
    >
      {label ?? (value === 0 ? '' : value)}
    </div>
  );
};

export interface HeatGridProps {
  rows: { label: string; cells: number[] }[];
  columns?: string[];
  max?: number;
  palette?: HeatCellProps['palette'];
  cellSize?: number;
}

export const HeatGrid: React.FC<HeatGridProps> = ({
  rows,
  columns,
  max,
  palette = 'blue',
  cellSize = 28,
}) => {
  const computedMax =
    max ?? Math.max(1, ...rows.flatMap((r) => r.cells));
  return (
    <div style={{ display: 'inline-block' }}>
      {columns && (
        <div style={{ display: 'flex', marginLeft: 80 }}>
          {columns.map((c, i) => (
            <div
              key={i}
              style={{
                width: cellSize,
                fontSize: 9,
                color: 'var(--color-text-muted, #6b7280)',
                textAlign: 'center',
              }}
            >
              {c}
            </div>
          ))}
        </div>
      )}
      {rows.map((r, ri) => (
        <div key={ri} style={{ display: 'flex', alignItems: 'center' }}>
          <div
            style={{
              width: 80,
              fontSize: 11,
              color: 'var(--color-text-secondary, #475569)',
              paddingRight: 8,
              textAlign: 'right',
            }}
          >
            {r.label}
          </div>
          {r.cells.map((v, ci) => (
            <HeatCell key={ci} value={v} max={computedMax} palette={palette} size={cellSize} />
          ))}
        </div>
      ))}
    </div>
  );
};

export default HeatCell;
