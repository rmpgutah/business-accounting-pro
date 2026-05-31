import React from 'react';
import {
  Check,
  Cloud,
  CloudOff,
  RefreshCw,
  Loader2,
  AlertCircle,
  AlertTriangle,
  Info,
  CheckCircle2,
  FileText,
  X,
} from 'lucide-react';

/**
 * status-feedback.tsx — presentational status / feedback widgets.
 *
 * Pure presentational. Imports only react + lucide-react. Every prop is
 * optional with a sensible default so each component renders bare (<Name />).
 * Matches the glass/block theme via CSS var color tokens.
 */

/* ------------------------------------------------------------------ */
/* SuccessCheck                                                        */
/* ------------------------------------------------------------------ */

export interface SuccessCheckProps {
  /** Diameter of the circle in px. */
  size?: number;
  /** Optional message rendered below the check. */
  label?: string;
  /** Accent color for the ring + check. */
  color?: string;
  className?: string;
}

export function SuccessCheck({
  size = 64,
  label = 'Done',
  color = 'var(--color-accent-income, #34d399)',
  className,
}: SuccessCheckProps) {
  return (
    <div
      className={className}
      style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}
    >
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          color,
          background: 'var(--color-accent-income-bg, rgba(52,211,153,0.12))',
          border: `2px solid ${color}`,
          animation: 'sf-pop 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.4)',
        }}
      >
        <Check size={Math.round(size * 0.5)} strokeWidth={3} />
      </div>
      {label && (
        <span className="text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
          {label}
        </span>
      )}
      <style>{`
        @keyframes sf-pop {
          0% { transform: scale(0.4); opacity: 0; }
          60% { transform: scale(1.08); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SavingIndicator                                                     */
/* ------------------------------------------------------------------ */

export type SavingState = 'idle' | 'saving' | 'saved' | 'error';

export interface SavingIndicatorProps {
  state?: SavingState;
  /** Override the auto label for the current state. */
  label?: string;
  className?: string;
}

export function SavingIndicator({ state = 'saved', label, className }: SavingIndicatorProps) {
  const map: Record<SavingState, { text: string; color: string; icon: React.ReactNode }> = {
    idle: {
      text: 'No changes',
      color: 'var(--color-text-muted)',
      icon: <Info size={14} />,
    },
    saving: {
      text: 'Saving…',
      color: 'var(--color-accent-blue, #60a5fa)',
      icon: <Loader2 size={14} className="sf-spin" />,
    },
    saved: {
      text: 'All changes saved',
      color: 'var(--color-accent-income, #34d399)',
      icon: <CheckCircle2 size={14} />,
    },
    error: {
      text: 'Save failed',
      color: 'var(--color-accent-expense, #f87171)',
      icon: <AlertCircle size={14} />,
    },
  };
  const cur = map[state];
  return (
    <div
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 13,
        color: cur.color,
      }}
    >
      {cur.icon}
      <span>{label ?? cur.text}</span>
      <style>{`
        .sf-spin { animation: sf-spin 0.9s linear infinite; }
        @keyframes sf-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SyncStatus                                                          */
/* ------------------------------------------------------------------ */

export type SyncState = 'synced' | 'syncing' | 'offline' | 'error';

export interface SyncStatusProps {
  state?: SyncState;
  /** Relative time string, e.g. "2 min ago". */
  lastSynced?: string;
  className?: string;
}

export function SyncStatus({ state = 'synced', lastSynced = '2 min ago', className }: SyncStatusProps) {
  const map: Record<SyncState, { text: string; color: string; bg: string; icon: React.ReactNode }> = {
    synced: {
      text: 'Synced',
      color: 'var(--color-accent-income, #34d399)',
      bg: 'var(--color-accent-income-bg, rgba(52,211,153,0.12))',
      icon: <Cloud size={15} />,
    },
    syncing: {
      text: 'Syncing…',
      color: 'var(--color-accent-blue, #60a5fa)',
      bg: 'var(--color-accent-blue-bg, rgba(96,165,250,0.12))',
      icon: <RefreshCw size={15} className="sf-spin" />,
    },
    offline: {
      text: 'Offline',
      color: 'var(--color-text-muted)',
      bg: 'var(--color-bg-tertiary, #2e2e2e)',
      icon: <CloudOff size={15} />,
    },
    error: {
      text: 'Sync error',
      color: 'var(--color-accent-expense, #f87171)',
      bg: 'var(--color-accent-expense-bg, rgba(248,113,113,0.12))',
      icon: <AlertCircle size={15} />,
    },
  };
  const cur = map[state];
  return (
    <div
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 12px',
        borderRadius: 6,
        background: cur.bg,
        border: '1px solid var(--color-border-primary)',
      }}
    >
      <span style={{ color: cur.color, display: 'inline-flex' }}>{cur.icon}</span>
      <span className="text-sm font-medium" style={{ color: cur.color }}>
        {cur.text}
      </span>
      {lastSynced && state !== 'syncing' && (
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          · {lastSynced}
        </span>
      )}
      <style>{`
        .sf-spin { animation: sf-spin 0.9s linear infinite; }
        @keyframes sf-spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* UploadProgress                                                      */
/* ------------------------------------------------------------------ */

export type UploadState = 'uploading' | 'done' | 'error';

export interface UploadProgressProps {
  fileName?: string;
  /** 0–100. */
  progress?: number;
  state?: UploadState;
  /** Human-readable size, e.g. "1.4 MB". */
  size?: string;
  onCancel?: () => void;
  className?: string;
}

export function UploadProgress({
  fileName = 'Q1-statement.pdf',
  progress = 64,
  state = 'uploading',
  size = '1.4 MB',
  onCancel,
  className,
}: UploadProgressProps) {
  const pct = Math.max(0, Math.min(100, progress));
  const barColor =
    state === 'error'
      ? 'var(--color-accent-expense, #f87171)'
      : state === 'done'
      ? 'var(--color-accent-income, #34d399)'
      : 'var(--color-accent-blue, #60a5fa)';

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        borderRadius: 6,
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border-primary)',
      }}
    >
      <span
        style={{
          flexShrink: 0,
          width: 34,
          height: 34,
          borderRadius: 6,
          display: 'grid',
          placeItems: 'center',
          color: barColor,
          background: 'var(--color-bg-tertiary, #2e2e2e)',
        }}
      >
        <FileText size={17} />
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 5 }}>
          <span
            className="text-sm truncate"
            style={{ color: 'var(--color-text-primary)' }}
            title={fileName}
          >
            {fileName}
          </span>
          <span className="text-xs font-mono" style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>
            {state === 'done' ? size : state === 'error' ? 'Failed' : `${pct}%`}
          </span>
        </div>
        <div
          style={{
            width: '100%',
            height: 6,
            borderRadius: 6,
            overflow: 'hidden',
            background: 'var(--color-bg-tertiary, #2e2e2e)',
          }}
        >
          <div
            style={{
              width: `${state === 'done' ? 100 : pct}%`,
              height: '100%',
              borderRadius: 6,
              background: barColor,
              transition: 'width 0.3s ease',
            }}
          />
        </div>
      </div>

      {state === 'done' ? (
        <CheckCircle2 size={18} style={{ color: barColor, flexShrink: 0 }} />
      ) : state === 'error' ? (
        <AlertCircle size={18} style={{ color: barColor, flexShrink: 0 }} />
      ) : (
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel upload"
          style={{
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            width: 24,
            height: 24,
            borderRadius: 6,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-text-muted)',
          }}
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ValidationHint                                                      */
/* ------------------------------------------------------------------ */

export type ValidationLevel = 'error' | 'warning' | 'success' | 'info';

export interface ValidationHintProps {
  level?: ValidationLevel;
  message?: string;
  className?: string;
}

export function ValidationHint({
  level = 'error',
  message = 'Amount must be greater than zero.',
  className,
}: ValidationHintProps) {
  const map: Record<ValidationLevel, { color: string; icon: React.ReactNode }> = {
    error: { color: 'var(--color-accent-expense, #f87171)', icon: <AlertCircle size={13} /> },
    warning: { color: 'var(--color-accent-warning, #fbbf24)', icon: <AlertTriangle size={13} /> },
    success: { color: 'var(--color-accent-income, #34d399)', icon: <CheckCircle2 size={13} /> },
    info: { color: 'var(--color-accent-blue, #60a5fa)', icon: <Info size={13} /> },
  };
  const cur = map[level];
  return (
    <div
      className={className}
      role={level === 'error' ? 'alert' : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 12,
        lineHeight: 1.3,
        color: cur.color,
      }}
    >
      <span style={{ display: 'inline-flex', flexShrink: 0, marginTop: 1 }}>{cur.icon}</span>
      <span>{message}</span>
    </div>
  );
}
