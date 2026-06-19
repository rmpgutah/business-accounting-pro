// src/renderer/components/PortalShareModal.tsx
//
// PORTAL: shared share-link modal for any "linkable" entity (invoice, debt).
// Built for the desktop-side portal UX:
//   - shows the live URL with a Copy button (Cmd+Enter triggers Copy)
//   - displays expiry, last-viewed, and a privacy preview of public fields
//   - exposes Regenerate / Disable / Open-as-client controls
// The modal is intentionally entity-agnostic — the parent provides token
// fetch / regenerate / disable callbacks plus the URL builder. That keeps
// invoice and debt share flows on a single component without coupling
// the modal to either schema.
//
// Audit-log note: "Last viewed" is sourced from the local audit_log, but
// portal_view rows are written on the VPS replica when a recipient opens
// the link. They only land on the desktop after the next server→desktop
// sync, so this view shows "Not available yet" until that arrives.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Copy, ExternalLink, RefreshCw, Ban, Check, Eye } from 'lucide-react';
import { useModalBehavior, trapFocusOnKeyDown } from '../lib/use-modal-behavior';
import { formatDate } from '../lib/format';
import api from '../lib/api';
import ErrorBanner from './ErrorBanner';

export interface PortalShareModalProps {
  title: string;                       // e.g. "Share invoice INV-0042"
  buildUrl: (token: string) => string; // token → full portal URL
  fetchInfo: () => Promise<{ token: string | null; expiresAt: number; lastView: any | null; error?: string }>;
  generateToken: () => Promise<{ token?: string; error?: string }>;
  regenerate: () => Promise<{ token?: string; expiresAt?: number; error?: string }>;
  disable: () => Promise<{ ok?: boolean; error?: string }>;
  // Stripped-down preview of what the public portal exposes — this is the
  // "what the recipient sees" pane. Parent passes a JSX node so the modal
  // doesn't need to know about invoice vs debt schema.
  previewNode: React.ReactNode;
  onClose: () => void;
}

export const PortalShareModal: React.FC<PortalShareModalProps> = ({
  title,
  buildUrl,
  fetchInfo,
  generateToken,
  regenerate,
  disable,
  previewNode,
  onClose,
}) => {
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number>(0);
  const [lastView, setLastView] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const urlInputRef = useRef<HTMLInputElement>(null);

  const url = useMemo(() => (token ? buildUrl(token) : ''), [token, buildUrl]);
  const isDisabled = !!token && expiresAt === 0;
  const isLive = !!token && expiresAt > 0;

  // Initial load: fetch any existing token, otherwise mint one so the URL
  // is immediately usable. Idempotent on the backend.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let info = await fetchInfo();
        if (info.error) throw new Error(info.error);
        if (!info.token || info.expiresAt === 0) {
          const gen = await generateToken();
          if (gen.error) throw new Error(gen.error);
          info = await fetchInfo();
        }
        if (!alive) return;
        setToken(info.token);
        setExpiresAt(info.expiresAt);
        setLastView(info.lastView);
      } catch (err: any) {
        if (alive) setError(err?.message ?? String(err));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [fetchInfo, generateToken]);

  const handleCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err: any) {
      setError(`Copy failed: ${err?.message ?? String(err)}`);
    }
  };

  const handleRegenerate = async () => {
    // CONFIRM: regeneration invalidates already-shared links. Worth a prompt.
    if (!confirm("Regenerating will invalidate any links you've already shared. Continue?")) return;
    setBusy(true);
    setError('');
    try {
      const res = await regenerate();
      if (res.error) throw new Error(res.error);
      const info = await fetchInfo();
      setToken(info.token);
      setExpiresAt(info.expiresAt);
      setLastView(info.lastView);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    if (!confirm('Disable this portal link? Anyone holding the URL will see "Link expired".')) return;
    setBusy(true);
    setError('');
    try {
      const res = await disable();
      if (res.error) throw new Error(res.error);
      const info = await fetchInfo();
      setToken(info.token);
      setExpiresAt(info.expiresAt);
      setLastView(info.lastView);
    } catch (err: any) {
      setError(err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleOpenAsClient = async () => {
    if (!url) return;
    await api.shellOpenExternal(url);
  };

  // KEYBOARD: Cmd/Ctrl+Enter = Copy. Modal-scoped so it doesn't fight
  // global shortcuts when the modal is closed.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleCopy();
    }
    // Delegate Tab trapping to the existing helper.
    trapFocusOnKeyDown(containerRef)(e);
  };

  const { containerRef } = useModalBehavior({ onClose });

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="portal-share-title"
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="bg-bg-secondary w-full max-w-xl border border-border-primary"
      >
        <div className="flex justify-between items-center p-4 border-b border-border-primary">
          <h2 id="portal-share-title" className="font-black uppercase tracking-wider text-sm">{title}</h2>
          <button onClick={onClose} aria-label="Close share modal"><X size={18} /></button>
        </div>

        <div className="p-4 space-y-4">
          {error && <ErrorBanner message={error} onDismiss={() => setError('')} />}

          {loading ? (
            <div className="text-xs text-text-muted py-6 text-center">Loading token…</div>
          ) : (
            <>
              {/* URL row */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-text-muted block mb-1">
                  Portal URL
                </label>
                <div className="flex items-stretch gap-2">
                  <input
                    ref={urlInputRef}
                    type="text"
                    readOnly
                    value={isDisabled ? '(link disabled)' : url}
                    onFocus={e => e.currentTarget.select()}
                    className="flex-1 border border-border-secondary px-2 py-1.5 text-xs font-mono bg-bg-primary text-text-primary focus:outline-none focus:border-accent-blue"
                    aria-label="Portal URL"
                  />
                  <button
                    onClick={handleCopy}
                    disabled={!isLive}
                    className="px-3 py-1.5 border-2 border-border-primary text-xs font-bold uppercase tracking-wider hover:bg-bg-primary hover:text-white transition-colors disabled:opacity-40"
                    title="Copy (Cmd/Ctrl+Enter)"
                  >
                    {copied ? <><Check size={12} className="inline mr-1" />Copied</> : <><Copy size={12} className="inline mr-1" />Copy</>}
                  </button>
                </div>
                {/* A11Y: announce copy success to screen readers */}
                <div aria-live="polite" className="sr-only">{copied ? 'Link copied to clipboard' : ''}</div>
              </div>

              {/* Status row */}
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <div className="text-text-muted uppercase tracking-wider font-bold mb-1">Status</div>
                  <div className={isLive ? 'text-accent-success font-bold' : 'text-accent-expense font-bold'}>
                    {isLive ? 'Live' : isDisabled ? 'Disabled' : 'No token'}
                  </div>
                </div>
                <div>
                  <div className="text-text-muted uppercase tracking-wider font-bold mb-1">Expires</div>
                  <div className="text-text-primary">
                    {isLive
                      ? `Expires ${formatDate(new Date(expiresAt * 1000).toISOString(), { style: 'medium' })}`
                      : '—'}
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="text-text-muted uppercase tracking-wider font-bold mb-1">Last viewed</div>
                  <div className="text-text-primary">
                    {lastView?.timestamp
                      ? formatDate(lastView.timestamp, { style: 'medium' })
                      : <span className="text-text-muted italic">Not available yet (waits for next server sync)</span>}
                  </div>
                </div>
              </div>

              {/* Action row */}
              <div className="flex flex-wrap gap-2 pt-2 border-t border-border-primary">
                <button
                  onClick={handleOpenAsClient}
                  disabled={!isLive}
                  className="flex items-center gap-2 px-3 py-1.5 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue hover:text-accent-blue transition-colors disabled:opacity-40"
                >
                  <ExternalLink size={12} />
                  Open as client
                </button>
                <button
                  onClick={handleRegenerate}
                  disabled={busy}
                  className="flex items-center gap-2 px-3 py-1.5 border border-border-primary text-xs font-bold uppercase hover:border-yellow-400 hover:text-yellow-400 transition-colors disabled:opacity-40"
                >
                  <RefreshCw size={12} />
                  Regenerate
                </button>
                <button
                  onClick={handleDisable}
                  disabled={busy || !isLive}
                  className="flex items-center gap-2 px-3 py-1.5 border border-border-primary text-xs font-bold uppercase hover:border-red-400 hover:text-red-400 transition-colors disabled:opacity-40"
                >
                  <Ban size={12} />
                  Disable
                </button>
                <button
                  onClick={() => setShowPreview(v => !v)}
                  className="flex items-center gap-2 px-3 py-1.5 border border-border-primary text-xs font-bold uppercase hover:border-accent-blue hover:text-accent-blue transition-colors ml-auto"
                  aria-expanded={showPreview}
                >
                  <Eye size={12} />
                  {showPreview ? 'Hide' : 'Show'} recipient preview
                </button>
              </div>

              {/* Recipient preview pane */}
              {showPreview && (
                <div className="border border-border-primary bg-bg-primary p-3">
                  <div className="text-xs text-text-muted uppercase tracking-wider font-bold mb-2">
                    What the recipient sees
                  </div>
                  <div className="text-xs text-text-primary">
                    {previewNode}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default PortalShareModal;
