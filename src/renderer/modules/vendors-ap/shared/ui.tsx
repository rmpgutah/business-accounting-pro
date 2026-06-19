// src/renderer/modules/vendors-ap/shared/ui.tsx
//
// Shared presentational primitives for the Vendor & AP Command Center.
// Token-clean port of the ExpenseInsights.tsx pattern — NO hard-coded hex.

import React from 'react';

// Token palette for charts/value coloring (string CSS vars only — no hex).
export const TOK = {
  expense: 'var(--color-accent-expense)',
  income: 'var(--color-accent-income)',
  warning: 'var(--color-accent-warning)',
  blue: 'var(--color-accent-blue)',
  brand: 'var(--accent-primary)',
  track: 'var(--color-bg-tertiary)',
  muted: 'var(--color-text-muted)',
  border: 'var(--color-border-primary)',
};

interface SectionProps { title: string; icon?: React.ReactNode; count?: number; right?: React.ReactNode; children: React.ReactNode }
export const Section: React.FC<SectionProps> = ({ title, icon, count, right, children }) => (
  <div className="block-card p-0 overflow-hidden">
    <div className="px-4 py-2.5 flex items-center gap-2" style={{ borderBottom: `1px solid ${TOK.border}`, background: 'var(--color-bg-secondary)' }}>
      {icon}
      <span className="text-xs font-bold uppercase tracking-wider text-text-muted">{title}</span>
      {count !== undefined && (
        <span className="text-[10px] font-bold px-1.5 py-0.5 ml-1" style={{ borderRadius: 4, background: 'color-mix(in srgb, var(--color-accent-blue) 14%, transparent)', color: TOK.blue }}>{count}</span>
      )}
      {right && <div className="ml-auto">{right}</div>}
    </div>
    {children}
  </div>
);

export const Empty: React.FC<{ msg: string }> = ({ msg }) => (
  <div className="px-4 py-3 text-[11px] text-text-muted">{msg}</div>
);

export const Th: React.FC<{ children?: React.ReactNode; right?: boolean }> = ({ children, right }) => (
  <th style={{ padding: '5px 10px', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.8, color: TOK.muted, textAlign: right ? 'right' : 'left' }}>{children}</th>
);
export const Td: React.FC<{ children: React.ReactNode; right?: boolean; mono?: boolean; color?: string }> = ({ children, right, mono, color }) => (
  <td style={{ padding: '5px 10px', fontSize: 11, textAlign: right ? 'right' : 'left', fontFamily: mono ? 'SF Mono, Menlo, monospace' : undefined, color }}>{children}</td>
);

// KPI stat card for the top strip.
export const StatCard: React.FC<{ label: string; value: React.ReactNode; sub?: React.ReactNode; color?: string }> = ({ label, value, sub, color }) => (
  <div className="block-card p-3">
    <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">{label}</div>
    <div className="text-lg font-bold font-mono mt-1" style={{ color: color || 'var(--color-text-primary)' }}>{value}</div>
    {sub !== undefined && <div className="text-[10px] text-text-muted">{sub}</div>}
  </div>
);

// Horizontal bar row for simple distributions.
export const MiniBar: React.FC<{ label: string; value: number; max: number; valueLabel: React.ReactNode; barColor?: string }> = ({ label, value, max, valueLabel, barColor }) => (
  <div className="flex items-center gap-2 text-[11px]">
    <span style={{ width: 96 }} className="text-text-muted truncate" title={label}>{label}</span>
    <div style={{ flex: 1, height: 6, background: TOK.track, borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: `${Math.min(100, (value / Math.max(1, max)) * 100)}%`, height: '100%', background: barColor || TOK.blue }} />
    </div>
    <span className="font-mono" style={{ width: 110, textAlign: 'right' }}>{valueLabel}</span>
  </div>
);

// A→D scorecard grade → token color.
export function gradeColor(grade: string): string {
  switch ((grade || '').toUpperCase()) {
    case 'A': return TOK.income;
    case 'B': return TOK.blue;
    case 'C': return TOK.warning;
    default: return TOK.expense;
  }
}
