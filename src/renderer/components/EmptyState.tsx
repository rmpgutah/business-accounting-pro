import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface Props {
  icon: LucideIcon;
  message: string;
  hint?: string;
}

/**
 * Shared empty state. Consumers should prefer this over ad-hoc
 * "No records found" blocks for visual consistency.
 */
export const EmptyState: React.FC<Props> = ({ icon: Icon, message, hint }) => (
  <div className="empty-state" role="status" aria-live="polite">
    <div className="empty-state-icon">
      <Icon size={24} className="text-text-muted" aria-hidden="true" />
    </div>
    <p className="text-sm font-semibold text-text-secondary mb-1">{message}</p>
    {hint && <p className="text-xs text-text-muted">{hint}</p>}
  </div>
);

export default EmptyState;
