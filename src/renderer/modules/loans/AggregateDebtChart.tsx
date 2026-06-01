// src/renderer/modules/loans/AggregateDebtChart.tsx
//
// Pure-SVG aggregated cross-loan debt projection.
// Shows total monthly principal + interest payments across ALL active
// loans + the running aggregate balance.
//
// Differs from per-loan AmortizationChart in that it answers:
// "If I make every payment as scheduled, how does my TOTAL debt
// position evolve over time?"

import React from 'react';

interface MonthRow {
  month: string;        // YYYY-MM
  principal: number;
  interest: number;
  payment: number;
  balance: number;
}

interface Props {
  data: MonthRow[];
  height?: number;
}

const AggregateDebtChart: React.FC<Props> = ({ data, height = 200 }) => {
  if (!data || data.length === 0) {
    return null;
  }

  const PADDING = { top: 8, right: 56, bottom: 24, left: 56 };
  const width = 800;
  const innerW = width - PADDING.left - PADDING.right;
  const innerH = height - PADDING.top - PADDING.bottom;

  const n = data.length;
  const dx = innerW / Math.max(1, n - 1);

  // Two scales: bars use payment magnitude, line uses balance.
  const maxPayment = Math.max(...data.map((r) => r.principal + r.interest), 1);
  const maxBalance = Math.max(...data.map((r) => r.balance), 1);

  const barWidth = Math.max(2, dx * 0.7);
  const balanceY = (v: number) => innerH - (v / maxBalance) * innerH;
  const balancePath = data.map((r, i) => {
    const x = PADDING.left + i * dx;
    const y = PADDING.top + balanceY(r.balance);
    return (i === 0 ? 'M' : 'L') + x + ',' + y;
  }).join(' ');

  // X-axis ticks: every 6 months for readability
  const tickStep = Math.max(1, Math.ceil(n / 8));
  const xTicks = data.filter((_, i) => i % tickStep === 0).map((r, i) => ({
    label: r.month,
    x: PADDING.left + (data.indexOf(r)) * dx,
  }));

  return (
    <svg width="100%" height={height} viewBox={'0 0 ' + width + ' ' + height} preserveAspectRatio="none" style={{ display: 'block' }}>
      {/* Y-axis grid */}
      {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
        const y = PADDING.top + innerH - p * innerH;
        const v = maxPayment * p;
        return (
          <g key={'y' + i}>
            <line x1={PADDING.left} y1={y} x2={PADDING.left + innerW} y2={y}
              stroke="var(--color-border-primary)" strokeWidth="0.5" strokeDasharray="2,2" opacity="0.5" />
            <text x={PADDING.left - 6} y={y + 3} textAnchor="end"
              fontSize="9" fill="var(--color-text-muted)" fontFamily="SF Mono, Menlo, monospace">
              ${(v / 1000).toFixed(v < 1000 ? 1 : 0)}{v >= 1000 ? 'k' : ''}
            </text>
          </g>
        );
      })}

      {/* Stacked bars: green principal on bottom, red interest on top */}
      {data.map((r, i) => {
        const x = PADDING.left + i * dx - barWidth / 2;
        const totalH = ((r.principal + r.interest) / maxPayment) * innerH;
        const principalH = (r.principal / maxPayment) * innerH;
        const interestH = (r.interest / maxPayment) * innerH;
        const yBottom = PADDING.top + innerH;
        return (
          <g key={'bar' + i}>
            <rect x={x} y={yBottom - principalH} width={barWidth} height={principalH}
              fill="var(--color-accent-income)" fillOpacity="0.7" />
            <rect x={x} y={yBottom - principalH - interestH} width={barWidth} height={interestH}
              fill="var(--color-accent-expense)" fillOpacity="0.7" />
          </g>
        );
      })}

      {/* Balance line on right axis */}
      <path d={balancePath} fill="none" stroke="var(--accent-primary)" strokeWidth="1.5" />

      {/* Right Y-axis labels for balance */}
      {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
        const v = maxBalance * p;
        const y = PADDING.top + innerH - p * innerH;
        return (
          <text key={'rb' + i} x={PADDING.left + innerW + 4} y={y + 3}
            fontSize="9" fill="var(--accent-primary)" fontFamily="SF Mono, Menlo, monospace">
            ${(v / 1000).toFixed(0)}k
          </text>
        );
      })}

      {/* X-axis */}
      <line x1={PADDING.left} y1={PADDING.top + innerH} x2={PADDING.left + innerW} y2={PADDING.top + innerH}
        stroke="var(--color-text-muted)" strokeWidth="0.5" />
      {xTicks.map((t, i) => (
        <text key={'x' + i} x={t.x} y={PADDING.top + innerH + 14} textAnchor="middle"
          fontSize="9" fill="var(--color-text-muted)" fontFamily="SF Mono, Menlo, monospace">
          {t.label}
        </text>
      ))}

      {/* Legend */}
      <g transform={'translate(' + (PADDING.left + 8) + ', 8)'}>
        <rect width="9" height="9" fill="var(--color-accent-income)" fillOpacity="0.7" />
        <text x="13" y="8" fontSize="9" fill="var(--color-text-primary)">Principal</text>
        <rect x="76" width="9" height="9" fill="var(--color-accent-expense)" fillOpacity="0.7" />
        <text x="89" y="8" fontSize="9" fill="var(--color-text-primary)">Interest</text>
        <line x1="148" y1="4" x2="158" y2="4" stroke="var(--accent-primary)" strokeWidth="2" />
        <text x="162" y="8" fontSize="9" fill="var(--color-text-primary)">Total Balance</text>
      </g>
    </svg>
  );
};

export default AggregateDebtChart;
