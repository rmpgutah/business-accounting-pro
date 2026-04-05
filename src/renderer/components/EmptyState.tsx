// src/renderer/components/EmptyState.tsx
import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface Props {
  icon: LucideIcon;
  message: string;
}

export const EmptyState: React.FC<Props> = ({ icon: Icon, message }) => (
  <div className="empty-state">
    <div className="empty-state-icon">
      <Icon size={24} className="text-text-muted" />
    </div>
    <p className="text-sm font-semibold text-text-secondary mb-1">{message}</p>
  </div>
);
