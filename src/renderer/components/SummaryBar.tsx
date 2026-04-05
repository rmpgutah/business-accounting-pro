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
    red: 'text-red-600', orange: 'text-orange-600', green: 'text-green-600', default: 'text-gray-900',
  };
  return (
    <div className="flex gap-6 bg-white border-b border-gray-200 px-6 py-2.5 flex-wrap">
      {items.map((item, i) => (
        <div key={i} className="flex flex-col">
          <span className="text-[10px] uppercase tracking-widest font-bold text-gray-400">{item.label}</span>
          {item.tooltip ? (
            <Tooltip content={item.tooltip}>
              <span className={`text-sm font-black cursor-help underline decoration-dotted decoration-gray-300 ${accentCls[item.accent ?? 'default']}`}>
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
