// src/renderer/components/SummaryBar.tsx
import React from 'react';

export interface SummaryItem { label: string; value: string; accent?: 'red' | 'orange' | 'green' | 'default'; }

export const SummaryBar: React.FC<{ items: SummaryItem[] }> = ({ items }) => {
  const accentCls: Record<string, string> = {
    red: 'text-accent-expense',
    orange: 'text-accent-warning',
    green: 'text-accent-income',
    default: 'text-text-primary',
  };
  return (
    <div
      className="flex gap-6 px-6 py-2.5 flex-wrap bg-bg-secondary"
      style={{ borderBottom: '1px solid var(--color-border-primary)', borderRadius: '0' }}
    >
      {items.map((item, i) => (
        <div key={i} className="flex flex-col font-mono" style={{ fontVariantNumeric: 'tabular-nums' }}>
          <span className="text-[10px] uppercase tracking-widest font-bold text-text-muted">{item.label}</span>
          <span className={`text-sm font-black ${accentCls[item.accent ?? 'default']}`}>{item.value}</span>
        </div>
      ))}
    </div>
  );
};
