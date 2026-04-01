// src/renderer/components/SummaryBar.tsx
import React from 'react';

export interface SummaryItem { label: string; value: string; accent?: 'red' | 'orange' | 'green' | 'default'; }

export const SummaryBar: React.FC<{ items: SummaryItem[] }> = ({ items }) => {
  const accentCls: Record<string, string> = {
    red: 'text-red-600', orange: 'text-orange-600', green: 'text-green-600', default: 'text-gray-900',
  };
  return (
    <div className="flex gap-6 bg-white border-b border-gray-200 px-6 py-2.5 flex-wrap">
      {items.map((item, i) => (
        <div key={i} className="flex flex-col">
          <span className="text-[10px] uppercase tracking-widest font-bold text-gray-400">{item.label}</span>
          <span className={`text-sm font-black ${accentCls[item.accent ?? 'default']}`}>{item.value}</span>
        </div>
      ))}
    </div>
  );
};
