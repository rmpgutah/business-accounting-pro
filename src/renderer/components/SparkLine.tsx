import React from 'react';

/**
 * <SparkLine> — pure SVG sparkline (no recharts dependency).
 *
 * Works in print since we render a real <svg> with inline coords —
 * Chromium prints these reliably even when ResponsiveContainer collapses
 * to 0×0 in the headless print window.
 */
export interface SparkLineProps {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  /** Show the last data point as a small dot. */
  showLastDot?: boolean;
  className?: string;
}

const SparkLine: React.FC<SparkLineProps> = ({
  data,
  width = 100,
  height = 28,
  stroke = 'var(--color-accent-blue, #3b82f6)',
  strokeWidth = 1.5,
  fill = 'none',
  showLastDot = false,
  className,
}) => {
  if (!data || data.length === 0) {
    return (
      <svg width={width} height={height} className={className} aria-hidden="true" />
    );
  }

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;

  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * height;
    return [x, y] as [number, number];
  });

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(2)},${p[1].toFixed(2)}`)
    .join(' ');

  // Fill area path (close to baseline)
  let areaPath = '';
  if (fill !== 'none' && points.length > 1) {
    areaPath =
      `M${points[0][0].toFixed(2)},${height} ` +
      points
        .map((p) => `L${p[0].toFixed(2)},${p[1].toFixed(2)}`)
        .join(' ') +
      ` L${points[points.length - 1][0].toFixed(2)},${height} Z`;
  }

  const last = points[points.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {areaPath && <path d={areaPath} fill={fill} stroke="none" />}
      <path d={path} fill="none" stroke={stroke} strokeWidth={strokeWidth} />
      {showLastDot && last && (
        <circle cx={last[0]} cy={last[1]} r={2} fill={stroke} />
      )}
    </svg>
  );
};

export default SparkLine;
