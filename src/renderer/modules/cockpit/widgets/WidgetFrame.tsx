import React from 'react';
import { GripVertical, X, ArrowUpRight } from 'lucide-react';

const ACCENT: Record<string, string> = {
  income: 'border-l-accent-income', expense: 'border-l-accent-expense',
  warning: 'border-l-accent-warning', blue: 'border-l-accent-blue',
};

const WidgetFrame: React.FC<{
  title: string; accent: string; editing: boolean;
  onRemove?: () => void; onOpen?: () => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  children: React.ReactNode;
}> = ({ title, accent, editing, onRemove, onOpen, dragHandleProps, children }) => (
  <div className={`block-card h-full flex flex-col p-0 overflow-hidden border-l-4 ${ACCENT[accent] || 'border-l-accent-blue'}`}
       style={{ borderRadius: 'var(--app-radius)' }}>
    <div className="flex items-center justify-between px-3 py-2 border-b border-border-primary">
      <div className="flex items-center gap-1.5 min-w-0">
        {editing && <div {...dragHandleProps} className="cursor-grab text-text-muted"><GripVertical size={13} /></div>}
        <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider truncate">{title}</span>
      </div>
      <div className="flex items-center gap-1">
        {onOpen && !editing && <button onClick={onOpen} className="text-text-muted hover:text-text-primary"><ArrowUpRight size={13} /></button>}
        {editing && onRemove && <button onClick={onRemove} className="text-text-muted hover:text-accent-expense"><X size={13} /></button>}
      </div>
    </div>
    <div className="flex-1 min-h-0 overflow-auto p-3">{children}</div>
  </div>
);

export default WidgetFrame;
