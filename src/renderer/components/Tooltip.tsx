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
    >
      {children}
      {visible && (
        <span
          className={`
            absolute z-50 left-1/2 -translate-x-1/2 w-max max-w-xs
            bg-bg-primary text-white text-xs px-2.5 py-1.5 pointer-events-none
            whitespace-pre-wrap leading-relaxed
            ${placement === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'}
          `}
        >
          {content}
          <span
            className={`
              absolute left-1/2 -translate-x-1/2 border-4 border-transparent
              ${placement === 'top' ? 'top-full border-t-gray-900' : 'bottom-full border-b-gray-900'}
            `}
          />
        </span>
      )}
    </span>
  );
};
