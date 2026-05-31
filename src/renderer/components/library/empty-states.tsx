import React from 'react';
import {
  Inbox,
  SearchX,
  AlertTriangle,
  RefreshCw,
  WifiOff,
  Clock,
  type LucideIcon,
} from 'lucide-react';

/**
 * Empty / placeholder state components for the glass-block theme.
 *
 * All components are pure presentational and render with zero props.
 * Allowed imports: react + lucide-react only.
 */

/* ------------------------------------------------------------------ */
/* Shared shell                                                       */
/* ------------------------------------------------------------------ */

interface StateShellProps {
  icon: LucideIcon;
  iconColor?: string;
  iconBg?: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
}

function StateShell({
  icon: Icon,
  iconColor = 'var(--color-text-secondary)',
  iconBg = 'var(--color-bg-tertiary)',
  title,
  description,
  children,
}: StateShellProps) {
  return (
    <div
      className="block-card flex flex-col items-center justify-center text-center"
      style={{ padding: '40px 28px', gap: 14, borderRadius: 6 }}
    >
      <div
        className="flex items-center justify-center"
        style={{
          width: 56,
          height: 56,
          borderRadius: 6,
          background: iconBg,
          border: '1px solid var(--color-border-secondary)',
        }}
      >
        <Icon size={26} strokeWidth={1.75} style={{ color: iconColor }} />
      </div>
      <div style={{ maxWidth: 360 }}>
        <h3
          className="text-text-primary"
          style={{ fontSize: 16, fontWeight: 600, margin: 0 }}
        >
          {title}
        </h3>
        {description && (
          <p
            className="text-text-secondary"
            style={{ fontSize: 13, lineHeight: 1.5, margin: '6px 0 0' }}
          >
            {description}
          </p>
        )}
      </div>
      {children && (
        <div className="flex items-center" style={{ gap: 10, marginTop: 4 }}>
          {children}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* EmptyStatePanel                                                    */
/* ------------------------------------------------------------------ */

export interface EmptyStatePanelProps {
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: LucideIcon;
}

export function EmptyStatePanel({
  title = 'Nothing here yet',
  description = 'Records you create will show up in this view. Get started by adding your first entry.',
  actionLabel = 'Add entry',
  onAction,
  icon = Inbox,
}: EmptyStatePanelProps) {
  return (
    <StateShell
      icon={icon}
      iconColor="var(--color-accent-blue)"
      iconBg="var(--color-accent-blue-bg)"
      title={title}
      description={description}
    >
      {actionLabel && (
        <button type="button" className="block-btn-primary" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </StateShell>
  );
}

/* ------------------------------------------------------------------ */
/* NoResultsState                                                     */
/* ------------------------------------------------------------------ */

export interface NoResultsStateProps {
  query?: string;
  title?: string;
  description?: string;
  clearLabel?: string;
  onClear?: () => void;
}

export function NoResultsState({
  query = 'invoice #1042',
  title = 'No matching results',
  description,
  clearLabel = 'Clear search',
  onClear,
}: NoResultsStateProps) {
  const desc =
    description ??
    `We couldn't find anything for “${query}”. Try a different term or check your filters.`;
  return (
    <StateShell
      icon={SearchX}
      iconColor="var(--color-text-secondary)"
      iconBg="var(--color-bg-tertiary)"
      title={title}
      description={desc}
    >
      {clearLabel && (
        <button type="button" className="block-btn" onClick={onClear}>
          {clearLabel}
        </button>
      )}
    </StateShell>
  );
}

/* ------------------------------------------------------------------ */
/* ErrorState                                                         */
/* ------------------------------------------------------------------ */

export interface ErrorStateProps {
  title?: string;
  message?: string;
  retryLabel?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = 'Something went wrong',
  message = 'We hit an unexpected error while loading this data. You can try again.',
  retryLabel = 'Retry',
  onRetry,
}: ErrorStateProps) {
  return (
    <StateShell
      icon={AlertTriangle}
      iconColor="var(--color-accent-expense)"
      iconBg="var(--color-accent-expense-bg)"
      title={title}
      description={message}
    >
      {retryLabel && (
        <button
          type="button"
          className="block-btn-danger flex items-center"
          style={{ gap: 6 }}
          onClick={onRetry}
        >
          <RefreshCw size={14} strokeWidth={2} />
          {retryLabel}
        </button>
      )}
    </StateShell>
  );
}

/* ------------------------------------------------------------------ */
/* OfflineState                                                       */
/* ------------------------------------------------------------------ */

export interface OfflineStateProps {
  title?: string;
  message?: string;
  retryLabel?: string;
  onRetry?: () => void;
}

export function OfflineState({
  title = 'You’re offline',
  message = 'We can’t reach the sync server right now. Changes are saved locally and will upload once the connection returns.',
  retryLabel = 'Try again',
  onRetry,
}: OfflineStateProps) {
  return (
    <StateShell
      icon={WifiOff}
      iconColor="var(--color-accent-warning)"
      iconBg="var(--color-accent-warning-bg)"
      title={title}
      description={message}
    >
      {retryLabel && (
        <button type="button" className="block-btn" onClick={onRetry}>
          {retryLabel}
        </button>
      )}
    </StateShell>
  );
}

/* ------------------------------------------------------------------ */
/* ComingSoonState                                                    */
/* ------------------------------------------------------------------ */

export interface ComingSoonStateProps {
  feature?: string;
  description?: string;
  badgeLabel?: string;
}

export function ComingSoonState({
  feature = 'This feature',
  description = 'We’re putting the finishing touches on it. Check back in a future release.',
  badgeLabel = 'Coming soon',
}: ComingSoonStateProps) {
  return (
    <StateShell
      icon={Clock}
      iconColor="var(--color-accent-purple)"
      iconBg="var(--color-accent-purple-bg)"
      title={`${feature} is on the way`}
      description={description}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          padding: '4px 10px',
          borderRadius: 6,
          color: 'var(--color-accent-purple)',
          background: 'var(--color-accent-purple-bg)',
          border: '1px solid var(--color-border-secondary)',
        }}
      >
        {badgeLabel}
      </span>
    </StateShell>
  );
}
