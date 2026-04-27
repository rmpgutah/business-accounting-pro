// src/renderer/components/EmptyState.tsx
import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface Props {
  icon: LucideIcon;
  message: string;
  // UX: optional actionable CTA — turns flat empty states into clear next steps
  actionLabel?: string;
  onAction?: () => void;
  hint?: string;
}

export const EmptyState: React.FC<Props> = ({ icon: Icon, message, actionLabel, onAction, hint }) => (
  <div className="empty-state">
    <div className="empty-state-icon">
      <Icon size={24} className="text-text-muted" />
    </div>
    <p className="text-sm font-semibold text-text-secondary mb-1">{message}</p>
    {hint && <p className="text-xs text-text-muted mb-2">{hint}</p>}
    {actionLabel && onAction && (
      <button
        type="button"
        onClick={onAction}
        className="block-btn-primary text-xs px-3 py-1.5 mt-2"
        style={{ borderRadius: 6 }}
      >
        {actionLabel}
      </button>
    )}
  </div>
);
