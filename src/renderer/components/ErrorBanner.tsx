import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface ErrorBannerProps {
  message: string;
  onDismiss?: () => void;
  title?: string;
}

/**
 * Shared error banner for module/report failures.
 * Use this instead of ad-hoc red divs so error surfaces look consistent.
 */
export const ErrorBanner: React.FC<ErrorBannerProps> = ({ message, onDismiss, title }) => {
  if (!message) return null;
  return (
    <div
      className="flex items-start gap-3 mb-4"
      style={{
        padding: '12px 16px',
        background: 'var(--color-accent-expense-bg)',
        border: '1px solid var(--color-accent-expense)',
        borderRadius: '2px',
      }}
      role="alert"
    >
      <AlertTriangle size={16} className="text-accent-expense shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        {title && (
          <div className="text-accent-expense font-semibold text-sm mb-1">{title}</div>
        )}
        <div className="text-accent-expense text-xs leading-relaxed break-words">
          {message}
        </div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="text-accent-expense/70 hover:text-accent-expense shrink-0"
          aria-label="Dismiss error"
          style={{ borderRadius: '2px' }}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
};

export default ErrorBanner;
