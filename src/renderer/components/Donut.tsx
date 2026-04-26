import React from 'react';

/**
 * <Donut> — pure SVG donut chart.
 *
 * No recharts dependency, prints cleanly in Electron's print window
 * since geometry is committed at render time (no JS resize observer).
 */
export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

export interface DonutProps {
  slices: DonutSlice[];
  size?: number;
  /** Inner-radius ratio (0–1). 0.6 ≈ classic donut. */
  innerRatio?: number;
  /** Optional center text (e.g. total). */
  centerText?: string;
  /** Optional sub-label rendered under centerText. */
  centerSubtext?: string;
  className?: string;
}

function polar(cx: number, cy: number, r: number, angleRad: number): [number, number] {
  return [cx + r * Math.cos(angleRad), cy + r * Math.sin(angleRad)];
}

function arcPath(cx: number, cy: number, rOuter: number, rInner: number, start: number, end: number): string {
  const large = end - start > Math.PI ? 1 : 0;
  const [x1, y1] = polar(cx, cy, rOuter, start);
  const [x2, y2] = polar(cx, cy, rOuter, end);
  const [x3, y3] = polar(cx, cy, rInner, end);
  const [x4, y4] = polar(cx, cy, rInner, start);
  return [
    `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `L ${x3.toFixed(2)} ${y3.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)}`,
    'Z',
  ].join(' ');
}

const Donut: React.FC<DonutProps> = ({
  slices,
  size = 160,
  innerRatio = 0.6,
  centerText,
  centerSubtext,
  className,
}) => {
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2;
  const rInner = rOuter * innerRatio;

  const total = slices.reduce((s, x) => s + Math.max(0, x.value), 0);

  if (total <= 0) {
    return (
      <svg width={size} height={size} className={className} aria-hidden="true">
        <circle cx={cx} cy={cy} r={rOuter} fill="none" stroke="#cbd5e1" strokeWidth={1} />
        <circle cx={cx} cy={cy} r={rInner} fill="none" stroke="#cbd5e1" strokeWidth={1} />
      </svg>
    );
  }

  let cursor = -Math.PI / 2; // start at 12 o'clock

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      aria-hidden="true"
    >
      {slices.map((s, i) => {
        const value = Math.max(0, s.value);
        if (value <= 0) return null;
        const sweep = (value / total) * Math.PI * 2;
        const start = cursor;
        const end = cursor + sweep;
        cursor = end;
        // Single-slice (100%) needs full circle path workaround
        if (Math.abs(sweep - Math.PI * 2) < 1e-6) {
          return (
            <g key={i}>
              <circle cx={cx} cy={cy} r={rOuter} fill={s.color} />
              <circle cx={cx} cy={cy} r={rInner} fill="#ffffff" />
            </g>
          );
        }
        return (
          <path
            key={i}
            d={arcPath(cx, cy, rOuter, rInner, start, end)}
            fill={s.color}
            stroke="#ffffff"
            strokeWidth={1}
          />
        );
      })}
      {centerText && (
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={size * 0.14}
          fontWeight={700}
          fill="#0b1220"
        >
          {centerText}
        </text>
      )}
      {centerSubtext && (
        <text
          x={cx}
          y={cy + size * 0.12}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={size * 0.07}
          fill="#475569"
        >
          {centerSubtext}
        </text>
      )}
    </svg>
  );
};

export default Donut;
