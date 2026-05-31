import React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * loading.tsx — presentational loading / skeleton primitives for the glass/block theme.
 *
 * All components render with ZERO props (sensible mock defaults). Pure
 * presentational: no app imports, no data fetching. Imports limited to
 * 'react' + 'lucide-react'. A single inline <style> block injects the
 * shimmer/spin keyframes once (idempotent by id).
 */

const SHIMMER_STYLE_ID = 'bap-loading-shimmer-keyframes';

function ShimmerKeyframes() {
  // Inject keyframes only once per document.
  if (typeof document !== 'undefined' && !document.getElementById(SHIMMER_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = SHIMMER_STYLE_ID;
    style.textContent = `
@keyframes bapShimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
@keyframes bapPulse {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 0.85; }
}
@keyframes bapSpin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}`;
    document.head.appendChild(style);
  }
  return null;
}

const SHIMMER_BG =
  'linear-gradient(90deg, var(--color-bg-tertiary, #2e2e2e) 25%, var(--color-bg-secondary, #1e1e1e) 50%, var(--color-bg-tertiary, #2e2e2e) 75%)';

// ────────────────────────────────────────────────────────────────────────────
// ShimmerBlock
// ────────────────────────────────────────────────────────────────────────────

export interface ShimmerBlockProps {
  /** Width — number (px) or any CSS length. */
  width?: number | string;
  /** Height — number (px) or any CSS length. */
  height?: number | string;
  /** Corner radius in px. */
  radius?: number;
  /** Disable the animated sweep (static placeholder). */
  animated?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function ShimmerBlock({
  width = 160,
  height = 14,
  radius = 6,
  animated = true,
  className,
  style,
}: ShimmerBlockProps) {
  return (
    <>
      <ShimmerKeyframes />
      <div
        className={className}
        aria-hidden="true"
        style={{
          width: typeof width === 'number' ? `${width}px` : width,
          height: typeof height === 'number' ? `${height}px` : height,
          borderRadius: radius,
          background: animated ? SHIMMER_BG : 'var(--color-bg-tertiary, #2e2e2e)',
          backgroundSize: '200% 100%',
          animation: animated ? 'bapShimmer 1.4s ease-in-out infinite' : undefined,
          ...style,
        }}
      />
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SkeletonCard
// ────────────────────────────────────────────────────────────────────────────

export interface SkeletonCardProps {
  /** Number of body text lines under the title. */
  lines?: number;
  /** Show the small leading avatar/icon block in the header. */
  showAvatar?: boolean;
  /** Show a footer row (e.g. for action buttons). */
  showFooter?: boolean;
  className?: string;
}

export function SkeletonCard({
  lines = 3,
  showAvatar = true,
  showFooter = true,
  className,
}: SkeletonCardProps) {
  return (
    <div className={`block-card ${className ?? ''}`} style={{ padding: 16 }} aria-busy="true">
      <div className="flex items-center" style={{ gap: 12, marginBottom: 16 }}>
        {showAvatar && <ShimmerBlock width={40} height={40} radius={6} />}
        <div className="flex-1" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <ShimmerBlock width="55%" height={14} />
          <ShimmerBlock width="35%" height={10} />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {Array.from({ length: Math.max(0, lines) }).map((_, i) => (
          <ShimmerBlock
            key={i}
            width={i === lines - 1 ? '70%' : '100%'}
            height={12}
          />
        ))}
      </div>

      {showFooter && (
        <div
          className="flex items-center justify-between"
          style={{
            gap: 12,
            marginTop: 18,
            paddingTop: 14,
            borderTop: '1px solid var(--color-border-primary, #333)',
          }}
        >
          <ShimmerBlock width={90} height={28} radius={6} />
          <ShimmerBlock width={72} height={28} radius={6} />
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SkeletonTable
// ────────────────────────────────────────────────────────────────────────────

export interface SkeletonTableProps {
  /** Number of placeholder body rows. */
  rows?: number;
  /** Number of columns. */
  columns?: number;
  /** Render a header row of slightly stronger blocks. */
  showHeader?: boolean;
  className?: string;
}

export function SkeletonTable({
  rows = 6,
  columns = 4,
  showHeader = true,
  className,
}: SkeletonTableProps) {
  const cols = Math.max(1, columns);
  const gridTemplate = `1.4fr ${Array.from({ length: cols - 1 })
    .map(() => '1fr')
    .join(' ')}`.trim();

  return (
    <div
      className={`block-card ${className ?? ''}`}
      style={{ padding: 0, overflow: 'hidden' }}
      aria-busy="true"
    >
      {showHeader && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: gridTemplate,
            gap: 16,
            padding: '12px 16px',
            background: 'var(--color-bg-tertiary, #2e2e2e)',
            borderBottom: '1px solid var(--color-border-primary, #333)',
          }}
        >
          {Array.from({ length: cols }).map((_, c) => (
            <ShimmerBlock key={c} width={c === 0 ? '60%' : '45%'} height={11} animated={false} />
          ))}
        </div>
      )}

      {Array.from({ length: Math.max(0, rows) }).map((_, r) => (
        <div
          key={r}
          style={{
            display: 'grid',
            gridTemplateColumns: gridTemplate,
            gap: 16,
            padding: '14px 16px',
            borderBottom:
              r === rows - 1 ? 'none' : '1px solid var(--color-border-primary, #2a2a2a)',
          }}
        >
          {Array.from({ length: cols }).map((_, c) => (
            <ShimmerBlock
              key={c}
              width={c === 0 ? '80%' : `${50 + ((r + c) % 4) * 10}%`}
              height={12}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// SpinnerInline
// ────────────────────────────────────────────────────────────────────────────

export interface SpinnerInlineProps {
  /** Text shown beside the spinner. Pass '' to hide. */
  text?: string;
  /** Icon size in px. */
  size?: number;
  /** Spinner/text color — any CSS color or var token. */
  color?: string;
  className?: string;
}

export function SpinnerInline({
  text = 'Loading…',
  size = 16,
  color = 'var(--color-accent-blue, #3b82f6)',
  className,
}: SpinnerInlineProps) {
  return (
    <span
      className={`inline-flex items-center ${className ?? ''}`}
      style={{ gap: 8, color }}
      role="status"
      aria-live="polite"
    >
      <Loader2
        size={size}
        style={{ animation: 'bapSpin 0.9s linear infinite', flexShrink: 0 }}
      />
      {text ? (
        <span className="text-sm text-text-secondary" style={{ color: 'inherit' }}>
          {text}
        </span>
      ) : null}
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// ProgressOverlay
// ────────────────────────────────────────────────────────────────────────────

export interface ProgressOverlayProps {
  /** Whether the overlay is shown. */
  open?: boolean;
  /** Progress 0–100. Pass undefined for an indeterminate bar. */
  progress?: number;
  /** Primary status line. */
  title?: string;
  /** Secondary helper line. */
  subtitle?: string;
  /** Position fixed (full viewport) vs absolute (fills nearest positioned parent). */
  fullscreen?: boolean;
  className?: string;
}

export function ProgressOverlay({
  open = true,
  progress = 64,
  title = 'Processing…',
  subtitle = 'This will only take a moment',
  fullscreen = false,
  className,
}: ProgressOverlayProps) {
  if (!open) return null;

  const clamped =
    typeof progress === 'number'
      ? Math.max(0, Math.min(100, progress))
      : undefined;
  const indeterminate = clamped === undefined;

  return (
    <>
      <ShimmerKeyframes />
      <div
        className={className}
        role="status"
        aria-live="polite"
        style={{
          position: fullscreen ? 'fixed' : 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(0, 0, 0, 0.55)',
          backdropFilter: 'blur(4px)',
          WebkitBackdropFilter: 'blur(4px)',
          zIndex: 50,
        }}
      >
        <div
          className="block-card"
          style={{
            padding: 24,
            width: 340,
            maxWidth: '90%',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            textAlign: 'center',
          }}
        >
          <div className="flex items-center justify-center">
            <Loader2
              size={28}
              style={{
                animation: 'bapSpin 0.9s linear infinite',
                color: 'var(--color-accent-blue, #3b82f6)',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div className="text-sm font-medium text-text-primary">{title}</div>
            {subtitle ? (
              <div className="text-xs text-text-muted">{subtitle}</div>
            ) : null}
          </div>

          <div
            style={{
              width: '100%',
              height: 8,
              borderRadius: 6,
              overflow: 'hidden',
              background: 'var(--color-bg-tertiary, #2e2e2e)',
            }}
          >
            {indeterminate ? (
              <div
                style={{
                  width: '40%',
                  height: '100%',
                  borderRadius: 6,
                  background: SHIMMER_BG,
                  backgroundSize: '200% 100%',
                  animation: 'bapShimmer 1.2s ease-in-out infinite',
                }}
              />
            ) : (
              <div
                style={{
                  width: `${clamped}%`,
                  height: '100%',
                  borderRadius: 6,
                  background: 'var(--color-accent-blue, #3b82f6)',
                  transition: 'width 0.3s ease',
                }}
              />
            )}
          </div>

          {!indeterminate && (
            <div className="text-xs font-mono text-text-secondary">
              {Math.round(clamped)}%
            </div>
          )}
        </div>
      </div>
    </>
  );
}
