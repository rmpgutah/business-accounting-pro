// src/renderer/components/ToastProvider.tsx
//
// P3.29 — Toast notification system
//
// Replaces the scatter of alert() calls with a non-blocking toast
// pattern. Mount <ToastProvider> at the app root; call useToast()
// from any descendant.
//
// Usage:
//
//   const toast = useToast();
//   toast.success('Invoice saved');
//   toast.error('Connection failed: ' + err.message);
//   toast.info('Auto-saving…', { duration: 1500 });
//
// Auto-dismisses after `duration` ms (default 4000). Click to dismiss
// early. Stacks bottom-right with newest on top.

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

type ToastKind = 'success' | 'error' | 'warning' | 'info';
interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  duration: number;
}

interface ToastContextValue {
  show: (message: string, kind?: ToastKind, opts?: { duration?: number }) => void;
  success: (message: string, opts?: { duration?: number }) => void;
  error: (message: string, opts?: { duration?: number }) => void;
  warning: (message: string, opts?: { duration?: number }) => void;
  info: (message: string, opts?: { duration?: number }) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

let idCounter = 0;
function nextId(): string { return 't' + (++idCounter) + '-' + Date.now().toString(36); }

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((message: string, kind: ToastKind = 'info', opts?: { duration?: number }) => {
    const id = nextId();
    const duration = opts?.duration ?? (kind === 'error' ? 6000 : 4000);
    setToasts((prev) => [{ id, kind, message, duration }, ...prev].slice(0, 5));
  }, []);

  const ctx: ToastContextValue = {
    show,
    success: (msg, opts) => show(msg, 'success', opts),
    error: (msg, opts) => show(msg, 'error', opts),
    warning: (msg, opts) => show(msg, 'warning', opts),
    info: (msg, opts) => show(msg, 'info', opts),
    dismiss,
  };

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <ToastStack toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
};

// ── Internal: stack + per-toast component ──────────────────────────

const ToastStack: React.FC<{ toasts: Toast[]; dismiss: (id: string) => void }> = ({ toasts, dismiss }) => {
  if (toasts.length === 0) return null;
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column-reverse',
        gap: 8,
        pointerEvents: 'none',
        maxWidth: 400,
      }}
      aria-live="polite"
    >
      {toasts.map((t) => <ToastBubble key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />)}
    </div>
  );
};

const ToastBubble: React.FC<{ toast: Toast; onDismiss: () => void }> = ({ toast, onDismiss }) => {
  useEffect(() => {
    if (toast.duration <= 0) return;
    const t = setTimeout(onDismiss, toast.duration);
    return () => clearTimeout(t);
  }, [toast.duration, onDismiss]);

  const palette = (() => {
    switch (toast.kind) {
      case 'success': return { bg: 'rgba(22, 163, 74, 0.12)', fg: '#16a34a', border: 'rgba(22, 163, 74, 0.4)', Icon: CheckCircle2 };
      case 'error':   return { bg: 'rgba(220, 38, 38, 0.12)', fg: '#dc2626', border: 'rgba(220, 38, 38, 0.4)', Icon: AlertCircle };
      case 'warning': return { bg: 'rgba(217, 119, 6, 0.12)', fg: '#d97706', border: 'rgba(217, 119, 6, 0.4)', Icon: AlertCircle };
      default:        return { bg: 'rgba(37, 99, 235, 0.12)', fg: '#2563eb', border: 'rgba(37, 99, 235, 0.4)', Icon: Info };
    }
  })();
  const Icon = palette.Icon;

  return (
    <div
      role="status"
      onClick={onDismiss}
      style={{
        pointerEvents: 'auto',
        cursor: 'pointer',
        background: 'var(--color-bg-primary, #1a1a1a)',
        border: '1px solid ' + palette.border,
        borderLeft: '3px solid ' + palette.fg,
        borderRadius: 6,
        padding: '10px 12px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
        animation: 'bap-toast-slide-in 200ms ease-out',
      }}
    >
      <Icon size={16} style={{ color: palette.fg, marginTop: 1, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: 'var(--color-text-primary)', lineHeight: 1.4, wordBreak: 'break-word' }}>
          {toast.message}
        </div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); onDismiss(); }}
        style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 0, lineHeight: 0 }}
        title="Dismiss"
      >
        <X size={12} />
      </button>
    </div>
  );
};

// Inject animation keyframes once.
if (typeof document !== 'undefined' && !document.getElementById('bap-toast-keyframes')) {
  const style = document.createElement('style');
  style.id = 'bap-toast-keyframes';
  style.textContent = '@keyframes bap-toast-slide-in { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }';
  document.head.appendChild(style);
}
