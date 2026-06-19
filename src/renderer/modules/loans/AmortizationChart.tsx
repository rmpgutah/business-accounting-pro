// src/renderer/modules/loans/AmortizationChart.tsx
//
// Pure-SVG amortization chart — principal vs interest stacked area
// over time + remaining-balance line overlay. No chart library
// dependency keeps the bundle small.
//
// Two visual stories on one chart:
//   1. The "interest cliff" — early payments are mostly interest;
//      late payments are mostly principal. This is the classic
//      reason early payoff matters so much.
//   2. The balance amortization curve — non-linear decline showing
//      how slowly the principal pays down in the early years.

import React from 'react';

interface ScheduleRow {
  payment_number: number;
  due_date: string;
  scheduled_payment: number;
  principal_amount: number;
  interest_amount: number;
  remaining_balance: number;
}

interface Props {
  schedule: ScheduleRow[];
  height?: number;
  showCumulative?: boolean;  // toggle cumulative vs per-payment view
}

export const AmortizationChart: React.FC<Props> = ({ schedule, height = 280, showCumulative = false }) => {
  if (!schedule || schedule.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 12 }}>
        No schedule to chart yet. Save the loan to generate the amortization.
      </div>
    );
  }

  const PADDING = { top: 10, right: 60, bottom: 30, left: 60 };
  const width = 800;
  const innerW = width - PADDING.left - PADDING.right;
  const innerH = height - PADDING.top - PADDING.bottom;

  const n = schedule.length;
  const dx = innerW / Math.max(1, n - 1);

  // Compute extents
  const maxPayment = Math.max(...schedule.map((r) => r.scheduled_payment));
  const maxBalance = Math.max(...schedule.map((r) => r.remaining_balance));

  // Cumulative variants
  let cumPrincipal = 0;
  let cumInterest = 0;
  const cumRows = schedule.map((r) => {
    cumPrincipal += r.principal_amount;
    cumInterest += r.interest_amount;
    return { ...r, cum_principal: cumPrincipal, cum_interest: cumInterest };
  });

  const yMax = showCumulative
    ? Math.max(cumPrincipal, cumInterest)
    : maxPayment;
  const yScale = (v: number) => innerH - (v / Math.max(1, yMax)) * innerH;

  // Build SVG path strings.
  // Stacked area: interest is bottom layer, principal stacks on top.
  const interestPath = schedule.map((r, i) => {
    const x = PADDING.left + i * dx;
    const v = showCumulative ? cumRows[i].cum_interest : r.interest_amount;
    const y = PADDING.top + yScale(v);
    return (i === 0 ? 'M' : 'L') + x + ',' + y;
  }).join(' ');
  const interestArea = interestPath +
    ' L' + (PADDING.left + (n - 1) * dx) + ',' + (PADDING.top + innerH) +
    ' L' + PADDING.left + ',' + (PADDING.top + innerH) + ' Z';

  const stackPath = schedule.map((r, i) => {
    const x = PADDING.left + i * dx;
    const interestVal = showCumulative ? cumRows[i].cum_interest : r.interest_amount;
    const principalVal = showCumulative ? cumRows[i].cum_principal : r.principal_amount;
    const y = PADDING.top + yScale(interestVal + principalVal);
    return (i === 0 ? 'M' : 'L') + x + ',' + y;
  }).join(' ');
  const stackArea = stackPath +
    ' L' + (PADDING.left + (n - 1) * dx) + ',' + (PADDING.top + innerH - (showCumulative ? 0 : 0)) +
    schedule.map((r, i) => {
      const idx = n - 1 - i;
      const row = schedule[idx];
      const x = PADDING.left + idx * dx;
      const v = showCumulative ? cumRows[idx].cum_interest : row.interest_amount;
      const y = PADDING.top + yScale(v);
      return ' L' + x + ',' + y;
    }).join('') + ' Z';

  // Balance line uses RIGHT y-axis.
  const balanceY = (v: number) => innerH - (v / Math.max(1, maxBalance)) * innerH;
  const balancePath = schedule.map((r, i) => {
    const x = PADDING.left + i * dx;
    const y = PADDING.top + balanceY(r.remaining_balance);
    return (i === 0 ? 'M' : 'L') + x + ',' + y;
  }).join(' ');

  // Y-axis ticks (4 marks)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((p) => ({
    val: yMax * p,
    y: PADDING.top + innerH - p * innerH,
  }));

  // X-axis ticks: ~6 evenly spaced
  const tickCount = Math.min(6, n);
  const xTicks = Array.from({ length: tickCount }, (_, i) => {
    const idx = Math.floor((i / (tickCount - 1)) * (n - 1));
    return { idx, x: PADDING.left + idx * dx, label: schedule[idx].due_date.slice(0, 7) };
  });

  return (
    <svg
      width="100%"
      height={height}
      viewBox={'0 0 ' + width + ' ' + height}
      preserveAspectRatio="none"
      style={{ display: 'block', background: 'var(--color-bg-secondary)' }}
    >
      {/* Y-axis grid lines */}
      {yTicks.map((t, i) => (
        <g key={'y' + i}>
          <line x1={PADDING.left} y1={t.y} x2={PADDING.left + innerW} y2={t.y}
            stroke="var(--color-border-primary)" strokeWidth="0.5" strokeDasharray="2,2" opacity="0.5" />
          <text x={PADDING.left - 6} y={t.y + 3} textAnchor="end"
            fontSize="9" fill="var(--color-text-muted)" fontFamily="SF Mono, Menlo, monospace">
            ${(t.val / 1000).toFixed(t.val < 1000 ? 1 : 0)}{t.val >= 1000 ? 'k' : ''}
          </text>
        </g>
      ))}

      {/* Stacked principal area (top layer) */}
      <path d={stackArea} fill="var(--color-accent-income)" fillOpacity="0.35" />
      {/* Interest area (bottom layer) */}
      <path d={interestArea} fill="var(--color-accent-expense)" fillOpacity="0.40" />

      {/* Balance line on right axis */}
      <path d={balancePath} fill="none" stroke="var(--accent-primary)" strokeWidth="1.5" />

      {/* Right Y-axis labels (balance) */}
      {[0, 0.25, 0.5, 0.75, 1].map((p, i) => {
        const v = maxBalance * p;
        const y = PADDING.top + innerH - p * innerH;
        return (
          <text key={'rb' + i} x={PADDING.left + innerW + 6} y={y + 3}
            fontSize="9" fill="var(--accent-primary)" fontFamily="SF Mono, Menlo, monospace">
            ${(v / 1000).toFixed(0)}k
          </text>
        );
      })}

      {/* X-axis */}
      <line x1={PADDING.left} y1={PADDING.top + innerH} x2={PADDING.left + innerW} y2={PADDING.top + innerH}
        stroke="var(--color-text-muted)" strokeWidth="0.5" />
      {xTicks.map((t, i) => (
        <g key={'x' + i}>
          <line x1={t.x} y1={PADDING.top + innerH} x2={t.x} y2={PADDING.top + innerH + 3}
            stroke="var(--color-text-muted)" strokeWidth="0.5" />
          <text x={t.x} y={PADDING.top + innerH + 16} textAnchor="middle"
            fontSize="9" fill="var(--color-text-muted)" fontFamily="SF Mono, Menlo, monospace">
            {t.label}
          </text>
        </g>
      ))}

      {/* Legend */}
      <g transform={'translate(' + (PADDING.left + 8) + ', 10)'}>
        <rect width="10" height="10" fill="var(--color-accent-expense)" fillOpacity="0.4" />
        <text x="14" y="9" fontSize="10" fill="var(--color-text-primary)">
          Interest {showCumulative ? '(cumulative)' : ''}
        </text>
        <rect x="100" width="10" height="10" fill="var(--color-accent-income)" fillOpacity="0.4" />
        <text x="114" y="9" fontSize="10" fill="var(--color-text-primary)">
          Principal {showCumulative ? '(cumulative)' : ''}
        </text>
        <line x1="208" y1="5" x2="218" y2="5" stroke="var(--accent-primary)" strokeWidth="2" />
        <text x="222" y="9" fontSize="10" fill="var(--color-text-primary)">Balance</text>
      </g>
    </svg>
  );
};

export default AmortizationChart;
