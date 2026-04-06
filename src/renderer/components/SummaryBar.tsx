// src/renderer/components/SummaryBar.tsx
import React from 'react';
import { Tooltip } from './Tooltip';

export interface SummaryItem {
  label: string;
  value: string;
  accent?: 'red' | 'orange' | 'green' | 'default';
  tooltip?: string;
}

export const SummaryBar: React.FC<{ items: SummaryItem[] }> = ({ items }) => {
  const accentCls: Record<string, string> = {
    red: 'text-accent-expense',
    orange: 'text-accent-warning',
    green: 'text-accent-income',
    default: 'text-text-primary',
  };
  return (
    <div
      className="flex gap-6 px-6 py-3 flex-wrap"
      style={{
        background: 'rgba(18, 19, 24, 0.60)',
        backdropFilter: 'blur(12px) saturate(1.3)',
        WebkitBackdropFilter: 'blur(12px) saturate(1.3)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {items.map((item, i) => (
        <div key={i} className="flex flex-col">
          <span className="text-[10px] uppercase tracking-widest font-bold text-text-muted">{item.label}</span>
          {item.tooltip ? (
            <Tooltip content={item.tooltip}>
              <span className={`text-sm font-black cursor-help underline decoration-dotted decoration-text-muted/30 ${accentCls[item.accent ?? 'default']}`}>
                {item.value}
              </span>
            </Tooltip>
          ) : (
            <span className={`text-sm font-black ${accentCls[item.accent ?? 'default']}`}>{item.value}</span>
          )}
        </div>
      ))}
    </div>
  );
};
