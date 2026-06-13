// src/renderer/modules/subscriptions/shared/ui.tsx
//
// Shared presentational primitives for the Subscriptions module.
// Token-clean — NO hard-coded hex.

import React from 'react';

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

export const StatCard: React.FC<{ label: string; value: React.ReactNode; sub?: React.ReactNode; color?: string }> = ({ label, value, sub, color }) => (
  <div className="block-card p-3">
    <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">{label}</div>
    <div className="text-lg font-bold font-mono mt-1" style={{ color: color || 'var(--color-text-primary)' }}>{value}</div>
    {sub !== undefined && <div className="text-[10px] text-text-muted">{sub}</div>}
  </div>
);

export function statusColor(status: string): string {
  switch ((status || '').toLowerCase()) {
    case 'active': return TOK.income;
    case 'trial':
    case 'trialing': return TOK.blue;
    case 'paused': return TOK.warning;
    case 'canceled':
    case 'cancelled': return TOK.expense;
    default: return TOK.muted;
  }
}
