// src/renderer/components/Tooltip.tsx
import React, { useState } from 'react';

interface Props {
  content: React.ReactNode;
  children: React.ReactNode;
  placement?: 'top' | 'bottom';
}

export const Tooltip: React.FC<Props> = ({ content, children, placement = 'top' }) => {
  const [visible, setVisible] = useState(false);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          className={`
            absolute z-50 left-1/2 -translate-x-1/2 w-max max-w-xs
            text-text-primary text-xs px-2.5 py-1.5 pointer-events-none
            whitespace-pre-wrap leading-relaxed
            ${placement === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'}
          `}
          style={{
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border-primary)',
            borderRadius: '2px',
          }}
        >
          {content}
        </span>
      )}
    </span>
  );
};
