import React from 'react';
import {
  Info,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  X,
  Bell,
  Lightbulb,
  ShieldAlert,
} from 'lucide-react';

/**
 * alerts.tsx — presentational alert/notice/toast/callout/dialog primitives.
 *
 * Pure presentational. Imports only 'react' and 'lucide-react'.
 * Every component renders with zero props using sensible defaults.
 */

export type AlertVariant = 'info' | 'success' | 'warning' | 'error';

interface VariantStyle {
  color: string;
  bg: string;
  border: string;
  Icon: React.ComponentType<{ size?: number; style?: React.CSSProperties; className?: string }>;
}

const VARIANTS: Record<AlertVariant, VariantStyle> = {
  info: {
    color: 'var(--color-accent-blue, #3b82f6)',
    bg: 'rgba(59, 130, 246, 0.12)',
    border: 'rgba(59, 130, 246, 0.35)',
    Icon: Info,
  },
  success: {
    color: 'var(--color-accent-green, #22c55e)',
    bg: 'rgba(34, 197, 94, 0.12)',
    border: 'rgba(34, 197, 94, 0.35)',
    Icon: CheckCircle2,
  },
  warning: {
    color: 'var(--color-accent-warning, #f59e0b)',
    bg: 'rgba(245, 158, 11, 0.12)',
    border: 'rgba(245, 158, 11, 0.35)',
    Icon: AlertTriangle,
  },
  error: {
    color: 'var(--color-accent-expense, #ef4444)',
    bg: 'rgba(239, 68, 68, 0.12)',
    border: 'rgba(239, 68, 68, 0.35)',
    Icon: XCircle,
  },
};

const RADIUS = 6;

/* ------------------------------------------------------------------ */
/* InlineAlert — compact inline colored alert                          */
/* ------------------------------------------------------------------ */

export interface InlineAlertProps {
  variant?: AlertVariant;
  title?: string;
  message?: string;
  onDismiss?: () => void;
  className?: string;
}

export function InlineAlert({
  variant = 'info',
  title = 'Heads up',
  message = 'This is an informational message about the current view.',
  onDismiss,
  className,
}: InlineAlertProps) {
  const v = VARIANTS[variant];
  const Icon = v.Icon;
  return (
    <div
      className={className}
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '10px 12px',
        backgroundColor: v.bg,
        border: `1px solid ${v.border}`,
        borderRadius: RADIUS,
      }}
    >
      <Icon size={16} style={{ color: v.color, flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && (
          <div className="text-text-primary" style={{ fontSize: 13, fontWeight: 600 }}>
            {title}
          </div>
        )}
        {message && (
          <div className="text-text-secondary" style={{ fontSize: 12, marginTop: title ? 2 : 0 }}>
            {message}
          </div>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="text-text-muted"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, lineHeight: 0 }}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* BannerNotice — full-width banner                                    */
/* ------------------------------------------------------------------ */

export interface BannerNoticeProps {
  variant?: AlertVariant;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  className?: string;
}

export function BannerNotice({
  variant = 'warning',
  message = 'Your subscription renews in 5 days. Update your payment method to avoid interruption.',
  actionLabel = 'Manage',
  onAction,
  onDismiss,
  className,
}: BannerNoticeProps) {
  const v = VARIANTS[variant];
  const Icon = v.Icon;
  return (
    <div
      className={className}
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        padding: '10px 16px',
        backgroundColor: v.bg,
        borderTop: `1px solid ${v.border}`,
        borderBottom: `1px solid ${v.border}`,
        borderLeft: `3px solid ${v.color}`,
        borderRadius: RADIUS,
      }}
    >
      <Icon size={18} style={{ color: v.color, flexShrink: 0 }} />
      <span className="text-text-primary" style={{ flex: 1, fontSize: 13, minWidth: 0 }}>
        {message}
      </span>
      {actionLabel && (
        <button
          type="button"
          onClick={onAction}
          style={{
            background: 'none',
            border: `1px solid ${v.border}`,
            color: v.color,
            fontSize: 12,
            fontWeight: 600,
            padding: '4px 12px',
            borderRadius: RADIUS,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          {actionLabel}
        </button>
      )}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="text-text-muted"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, lineHeight: 0, flexShrink: 0 }}
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ToastCard — toast notification card                                 */
/* ------------------------------------------------------------------ */

export interface ToastCardProps {
  variant?: AlertVariant;
  title?: string;
  message?: string;
  onClose?: () => void;
  className?: string;
}

export function ToastCard({
  variant = 'success',
  title = 'Saved',
  message = 'Your invoice was saved successfully.',
  onClose,
  className,
}: ToastCardProps) {
  const v = VARIANTS[variant];
  const Icon = v.Icon;
  return (
    <div
      className={`block-card ${className ?? ''}`}
      role="status"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        width: 340,
        maxWidth: '100%',
        padding: '12px 14px',
        borderRadius: RADIUS,
        borderLeft: `3px solid ${v.color}`,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          borderRadius: RADIUS,
          backgroundColor: v.bg,
          flexShrink: 0,
        }}
      >
        <Icon size={16} style={{ color: v.color }} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && (
          <div className="text-text-primary" style={{ fontSize: 13, fontWeight: 600 }}>
            {title}
          </div>
        )}
        {message && (
          <div className="text-text-secondary" style={{ fontSize: 12, marginTop: 2 }}>
            {message}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="text-text-muted"
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, lineHeight: 0, flexShrink: 0 }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* CalloutBox — info callout                                           */
/* ------------------------------------------------------------------ */

export interface CalloutBoxProps {
  variant?: AlertVariant | 'tip';
  title?: string;
  children?: React.ReactNode;
  body?: string;
  className?: string;
}

export function CalloutBox({
  variant = 'info',
  title = 'Did you know?',
  children,
  body = 'You can reconcile multiple bank transactions at once by selecting them and using the bulk match action.',
  className,
}: CalloutBoxProps) {
  const isTip = variant === 'tip';
  const v = isTip
    ? {
        color: 'var(--color-accent-purple, #a855f7)',
        bg: 'rgba(168, 85, 247, 0.10)',
        border: 'rgba(168, 85, 247, 0.30)',
      }
    : VARIANTS[variant];
  const Icon = isTip ? Lightbulb : VARIANTS[variant as AlertVariant].Icon;
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        gap: 12,
        padding: 14,
        backgroundColor: v.bg,
        border: `1px solid ${v.border}`,
        borderRadius: RADIUS,
      }}
    >
      <Icon size={18} style={{ color: v.color, flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && (
          <div className="text-text-primary" style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
            {title}
          </div>
        )}
        <div className="text-text-secondary" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          {children ?? body}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ConfirmDialog — confirm modal body                                  */
/* ------------------------------------------------------------------ */

export interface ConfirmDialogProps {
  variant?: AlertVariant;
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
  className?: string;
}

export function ConfirmDialog({
  variant,
  title = 'Delete this invoice?',
  message = 'This action cannot be undone. The invoice and its line items will be permanently removed.',
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  destructive = true,
  onConfirm,
  onCancel,
  className,
}: ConfirmDialogProps) {
  const resolved: AlertVariant = variant ?? (destructive ? 'error' : 'info');
  const v = VARIANTS[resolved];
  const Icon = destructive ? ShieldAlert : Bell;
  const confirmColor = v.color;
  return (
    <div
      className={`block-card ${className ?? ''}`}
      role="alertdialog"
      aria-modal="true"
      style={{ width: 400, maxWidth: '100%', padding: 20, borderRadius: RADIUS }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            borderRadius: RADIUS,
            backgroundColor: v.bg,
            flexShrink: 0,
          }}
        >
          <Icon size={18} style={{ color: v.color }} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="text-text-primary" style={{ fontSize: 15, fontWeight: 600 }}>
            {title}
          </div>
          <div className="text-text-secondary" style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>
            {message}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
        <button
          type="button"
          onClick={onCancel}
          className="text-text-primary border-border-primary"
          style={{
            background: 'transparent',
            border: '1px solid var(--color-border-primary, #3a3a3a)',
            fontSize: 13,
            fontWeight: 500,
            padding: '7px 16px',
            borderRadius: RADIUS,
            cursor: 'pointer',
          }}
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          style={{
            background: confirmColor,
            border: `1px solid ${confirmColor}`,
            color: '#fff',
            fontSize: 13,
            fontWeight: 600,
            padding: '7px 16px',
            borderRadius: RADIUS,
            cursor: 'pointer',
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
