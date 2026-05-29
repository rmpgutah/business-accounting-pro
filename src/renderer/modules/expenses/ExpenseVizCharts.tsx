// ExpenseVizCharts.tsx
// Shared, dependency-free SVG visualisations for expense reporting surfaces.
// Mirrors the print-template charts (expenseTimelineSVG / expenseHeatmapSVG in
// lib/print-templates.ts) so the on-screen Expense Detail Report, the Expense
// Analytics tab, and the printed PDF all show the same shapes.
import React, { useMemo } from 'react';
import { formatCurrency } from '../../lib/format';

interface VizExpense { date: string; amount: number }

const compact = (v: number) =>
  v >= 1000 ? `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `$${Math.round(v)}`;

// ── Monthly spending timeline (bars + trend line) ──────────────────────
export const SpendingTimeline: React.FC<{ expenses: VizExpense[] }> = ({ expenses }) => {
  const months = useMemo(() => {
    const byMonth = new Map<string, number>();
    for (const e of expenses) {
      const key = (e.date || '').slice(0, 7);
      if (!key) continue;
      byMonth.set(key, (byMonth.get(key) || 0) + (Number(e.amount) || 0));
    }
    return Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [expenses]);

  if (months.length === 0) return null;

  const vals = months.map(([, v]) => v);
  const max = Math.max(...vals, 1);
  const mean = vals.reduce((s, v) => s + v, 0) / months.length;
  const W = 720, H = 200, padT = 18, padB = 34, padX = 6;
  const chartH = H - padT - padB;
  const n = months.length;
  const slot = (W - padX * 2) / n;
  const barW = Math.min(slot * 0.5, 54);
  const cx = (i: number) => padX + slot * i + slot / 2;
  const cy = (v: number) => padT + chartH - (v / max) * chartH;

  const monthLabel = (ym: string) => {
    const [y, m] = ym.split('-');
    const lbl = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short' });
    return Number(m) === 1 ? `${lbl} '${y.slice(2)}` : lbl;
  };

  let peakI = 0, lowI = 0;
  vals.forEach((v, i) => { if (v > vals[peakI]) peakI = i; if (v < vals[lowI]) lowI = i; });
  const meanY = cy(mean);

  return (
    <div className="block-card p-4" style={{ borderRadius: '6px' }}>
      <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider mb-3 pb-2 border-b border-border-primary/40">Spending Over Time</h3>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
        {[0.25, 0.5, 0.75, 1].map((f) => {
          const y = padT + chartH - chartH * f;
          return <line key={f} x1={padX} y1={y} x2={W - padX} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />;
        })}
        {months.map(([m, v], i) => {
          const x = cx(i) - barW / 2;
          const y = cy(v);
          const h = Math.max(padT + chartH - y, 0);
          return (
            <g key={m}>
              <rect x={x} y={y} width={barW} height={h} fill="#64748b" />
              <text x={cx(i)} y={y - 5} textAnchor="middle" fontSize={9} fontWeight={600} fill="#cbd5e1" fontFamily="'SF Mono',Menlo,monospace">{compact(v)}</text>
              <text x={cx(i)} y={H - 12} textAnchor="middle" fontSize={9} fontWeight={600} fill="#94a3b8">{monthLabel(m)}</text>
            </g>
          );
        })}
        {n > 1 && (
          <>
            <line x1={padX} y1={meanY} x2={W - padX} y2={meanY} stroke="#94a3b8" strokeWidth={1} strokeDasharray="4 3" />
            <text x={W - padX} y={meanY - 4} textAnchor="end" fontSize={8} fontWeight={600} fill="#94a3b8" letterSpacing="0.5">{`AVG ${compact(mean)}`}</text>
          </>
        )}
      </svg>
      {n > 1 && (
        <p className="text-[10px] text-text-muted mt-2 pt-2 border-t border-border-primary/40 font-mono">
          Peak: {monthLabel(months[peakI][0])} ({formatCurrency(vals[peakI])}) · Lowest: {monthLabel(months[lowI][0])} ({formatCurrency(vals[lowI])}) · Monthly avg: {formatCurrency(mean)}
        </p>
      )}
    </div>
  );
};

// ── Daily spending heatmap (GitHub-style calendar) ─────────────────────
export const SpendingHeatmap: React.FC<{ expenses: VizExpense[] }> = ({ expenses }) => {
  const data = useMemo(() => {
    const byDay = new Map<string, number>();
    let min: string | null = null, max: string | null = null;
    for (const e of expenses) {
      const d = (e.date || '').slice(0, 10);
      if (!d) continue;
      byDay.set(d, (byDay.get(d) || 0) + (Number(e.amount) || 0));
      if (!min || d < min) min = d;
      if (!max || d > max) max = d;
    }
    return { byDay, min, max };
  }, [expenses]);

  if (!data.min || !data.max) return null;

  const start = new Date(data.min + 'T12:00:00');
  start.setDate(start.getDate() - start.getDay());
  const end = new Date(data.max + 'T12:00:00');
  const maxVal = Math.max(...Array.from(data.byDay.values()), 1);

  // Flat monochrome ramp (index 0 = no spend) — brighter = more spend
  const ramp = ['rgba(255,255,255,0.06)', '#334155', '#475569', '#64748b', '#94a3b8', '#cbd5e1'];
  const bucket = (v: number) => {
    if (v <= 0) return 0;
    const r = v / maxVal;
    if (r <= 0.2) return 1;
    if (r <= 0.4) return 2;
    if (r <= 0.6) return 3;
    if (r <= 0.8) return 4;
    return 5;
  };
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const cell = 12, gap = 3, step = cell + gap, padL = 26, padT = 16;
  const cells: React.ReactNode[] = [];
  const monthMarks: React.ReactNode[] = [];
  let lastMonth = -1;
  let activeDays = 0;
  let peakDay = ''; let peakVal = 0;
  const cur = new Date(start);
  let week = 0;
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow === 0) week = Math.round((cur.getTime() - start.getTime()) / (7 * 86400000));
    const key = iso(cur);
    const v = data.byDay.get(key) || 0;
    if (v > 0) activeDays++;
    if (v > peakVal) { peakVal = v; peakDay = key; }
    const x = padL + week * step;
    const y = padT + dow * step;
    cells.push(<rect key={key} x={x} y={y} width={cell} height={cell} rx={1} fill={ramp[bucket(v)]}><title>{`${key}: ${formatCurrency(v)}`}</title></rect>);
    if (cur.getMonth() !== lastMonth) {
      lastMonth = cur.getMonth();
      monthMarks.push(<text key={`m${key}`} x={x} y={padT - 5} fontSize={9} fontWeight={600} fill="#94a3b8">{cur.toLocaleDateString('en-US', { month: 'short' })}</text>);
    }
    cur.setDate(cur.getDate() + 1);
  }

  const totalWeeks = Math.round((end.getTime() - start.getTime()) / (7 * 86400000)) + 1;
  const W = padL + totalWeeks * step + 4;
  const H = padT + 7 * step + 4;
  const peakLabel = peakDay ? new Date(peakDay + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';

  return (
    <div className="block-card p-4" style={{ borderRadius: '6px' }}>
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-border-primary/40">
        <h3 className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Daily Spending Heatmap</h3>
        <span className="flex items-center gap-1.5 text-[9px] text-text-muted">
          Less
          <svg width={ramp.length * (cell + 2)} height={cell}>
            {ramp.map((c, i) => <rect key={i} x={i * (cell + 2)} y={0} width={cell} height={cell} rx={1} fill={c} />)}
          </svg>
          More
        </span>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} style={{ display: 'block', maxWidth: '100%' }}>
          {[['Mon', 1], ['Wed', 3], ['Fri', 5]].map(([lbl, d]) => (
            <text key={lbl as string} x={0} y={padT + (d as number) * step + cell - 2} fontSize={8} fill="#64748b">{lbl}</text>
          ))}
          {monthMarks}
          {cells}
        </svg>
      </div>
      <p className="text-[10px] text-text-muted mt-2 pt-2 border-t border-border-primary/40 font-mono">
        Busiest day: {peakLabel} ({formatCurrency(peakVal)}) · {activeDays} active spending day{activeDays === 1 ? '' : 's'}
      </p>
    </div>
  );
};
