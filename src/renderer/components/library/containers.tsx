import React, { useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';

/* ============================================================================
 * Shared theme helpers
 * ========================================================================== */

const PANEL_RADIUS = 6;

/* ============================================================================
 * Accordion — vertical list of expandable items (single-open by default)
 * ========================================================================== */

export interface AccordionItem {
  id?: string;
  title?: string;
  subtitle?: string;
  content?: React.ReactNode;
}

export interface AccordionProps {
  items?: AccordionItem[];
  /** Allow multiple panels open at once. */
  multiple?: boolean;
  /** Index of the item open on first render. */
  defaultOpenIndex?: number;
  className?: string;
}

const DEFAULT_ACCORDION_ITEMS: AccordionItem[] = [
  {
    title: 'Revenue Recognition',
    subtitle: '3 policies',
    content:
      'Income is recognized when goods are delivered or services are rendered, net of returns and allowances.',
  },
  {
    title: 'Expense Categorization',
    subtitle: '12 categories',
    content:
      'Operating expenses are grouped by department and mapped to the chart of accounts for monthly close.',
  },
  {
    title: 'Tax Treatment',
    subtitle: 'Updated for FY 2026',
    content:
      'Estimated quarterly payments are calculated from net taxable income using the current filing status.',
  },
];

export function Accordion({
  items = DEFAULT_ACCORDION_ITEMS,
  multiple = false,
  defaultOpenIndex = 0,
  className = '',
}: AccordionProps) {
  const [open, setOpen] = useState<number[]>(
    defaultOpenIndex >= 0 ? [defaultOpenIndex] : []
  );

  const toggle = (i: number) => {
    setOpen((prev) => {
      const isOpen = prev.includes(i);
      if (multiple) {
        return isOpen ? prev.filter((x) => x !== i) : [...prev, i];
      }
      return isOpen ? [] : [i];
    });
  };

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {items.map((item, i) => {
        const isOpen = open.includes(i);
        return (
          <div
            key={item.id ?? i}
            className="block-card"
            style={{ padding: 0, overflow: 'hidden', borderRadius: PANEL_RADIUS }}
          >
            <button
              type="button"
              onClick={() => toggle(i)}
              className="w-full flex items-center justify-between text-left"
              style={{
                padding: '12px 16px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-text-primary)',
              }}
            >
              <span className="flex flex-col">
                <span className="text-sm font-medium text-text-primary">
                  {item.title}
                </span>
                {item.subtitle && (
                  <span className="text-xs text-text-muted">{item.subtitle}</span>
                )}
              </span>
              <ChevronDown
                size={16}
                className="text-text-secondary"
                style={{
                  transition: 'transform 0.2s ease',
                  transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                  flexShrink: 0,
                }}
              />
            </button>
            {isOpen && (
              <div
                className="text-sm text-text-secondary"
                style={{
                  padding: '0 16px 14px',
                  borderTop: '1px solid var(--color-glass-border)',
                  paddingTop: 12,
                }}
              >
                {item.content ?? 'No content.'}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================================
 * CollapsibleSection — single titled panel that expands/collapses
 * ========================================================================== */

export interface CollapsibleSectionProps {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  /** Optional badge/count shown on the right of the header. */
  badge?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export function CollapsibleSection({
  title = 'Advanced Settings',
  description,
  icon,
  defaultOpen = true,
  badge,
  children,
  className = '',
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      className={`block-card ${className}`}
      style={{ padding: 0, overflow: 'hidden', borderRadius: PANEL_RADIUS }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 text-left"
        style={{
          padding: '14px 16px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--color-text-primary)',
        }}
      >
        {open ? (
          <ChevronDown size={16} className="text-text-secondary" style={{ flexShrink: 0 }} />
        ) : (
          <ChevronRight size={16} className="text-text-secondary" style={{ flexShrink: 0 }} />
        )}
        {icon && <span className="text-text-secondary flex items-center">{icon}</span>}
        <span className="flex flex-col flex-1 min-w-0">
          <span className="text-sm font-medium text-text-primary truncate">{title}</span>
          {description && (
            <span className="text-xs text-text-muted truncate">{description}</span>
          )}
        </span>
        {badge != null && (
          <span
            className="text-xs text-text-secondary"
            style={{
              padding: '2px 8px',
              borderRadius: PANEL_RADIUS,
              background: 'var(--color-bg-tertiary)',
              border: '1px solid var(--color-glass-border)',
            }}
          >
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div
          className="text-sm text-text-secondary"
          style={{
            padding: '14px 16px',
            borderTop: '1px solid var(--color-glass-border)',
          }}
        >
          {children ?? (
            <p>
              Configure how this module behaves. These options apply to the current
              company only and take effect immediately.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * DrawerPanel — side drawer body (header / scrollable content / footer)
 * ========================================================================== */

export interface DrawerPanelProps {
  title?: string;
  subtitle?: string;
  /** Which edge the drawer is anchored to (affects border placement). */
  side?: 'left' | 'right';
  width?: number;
  onClose?: () => void;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export function DrawerPanel({
  title = 'Transaction Details',
  subtitle = 'Invoice #INV-2026-0142',
  side = 'right',
  width = 380,
  onClose,
  footer,
  children,
  className = '',
}: DrawerPanelProps) {
  return (
    <div
      className={`block-card-elevated flex flex-col ${className}`}
      style={{
        width,
        maxWidth: '100%',
        height: '100%',
        padding: 0,
        overflow: 'hidden',
        borderRadius: PANEL_RADIUS,
        [side === 'right' ? 'borderRight' : 'borderLeft']: 'none',
      }}
    >
      <div
        className="flex items-center justify-between"
        style={{
          padding: '16px 18px',
          borderBottom: '1px solid var(--color-glass-border)',
        }}
      >
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-semibold text-text-primary truncate">{title}</span>
          {subtitle && (
            <span className="text-xs text-text-muted truncate">{subtitle}</span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close drawer"
          className="flex items-center justify-center"
          style={{
            width: 28,
            height: 28,
            borderRadius: PANEL_RADIUS,
            background: 'var(--color-bg-tertiary)',
            border: '1px solid var(--color-glass-border)',
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <X size={15} />
        </button>
      </div>

      <div
        className="flex-1 text-sm text-text-secondary"
        style={{ padding: '16px 18px', overflowY: 'auto' }}
      >
        {children ?? (
          <div className="flex flex-col gap-3">
            <DrawerRow label="Amount" value="$4,250.00" />
            <DrawerRow label="Status" value="Paid" />
            <DrawerRow label="Date" value="May 14, 2026" />
            <DrawerRow label="Client" value="Northwind Traders" />
          </div>
        )}
      </div>

      <div
        style={{
          padding: '12px 18px',
          borderTop: '1px solid var(--color-glass-border)',
        }}
      >
        {footer ?? (
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="block-btn">
              Cancel
            </button>
            <button type="button" className="block-btn block-btn-primary">
              Save
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DrawerRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-text-muted">{label}</span>
      <span className="text-text-primary font-medium">{value}</span>
    </div>
  );
}

/* ============================================================================
 * ModalShell — centered modal frame with overlay
 * ========================================================================== */

export interface ModalShellProps {
  title?: string;
  description?: string;
  width?: number;
  /** Render the dimmed backdrop behind the modal. */
  showOverlay?: boolean;
  onClose?: () => void;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export function ModalShell({
  title = 'Delete Account',
  description = 'This action cannot be undone.',
  width = 440,
  showOverlay = true,
  onClose,
  footer,
  children,
  className = '',
}: ModalShellProps) {
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        minHeight: 280,
        ...(showOverlay
          ? { background: 'rgba(0, 0, 0, 0.55)', borderRadius: PANEL_RADIUS }
          : {}),
      }}
    >
      <div
        className={`block-card-elevated flex flex-col ${className}`}
        style={{
          width,
          maxWidth: '100%',
          padding: 0,
          overflow: 'hidden',
          borderRadius: PANEL_RADIUS,
        }}
      >
        <div
          className="flex items-start justify-between gap-3"
          style={{ padding: '18px 20px 12px' }}
        >
          <div className="flex flex-col min-w-0">
            <span className="text-base font-semibold text-text-primary">{title}</span>
            {description && (
              <span className="text-xs text-text-muted" style={{ marginTop: 2 }}>
                {description}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="flex items-center justify-center"
            style={{
              width: 28,
              height: 28,
              borderRadius: PANEL_RADIUS,
              background: 'var(--color-bg-tertiary)',
              border: '1px solid var(--color-glass-border)',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            <X size={15} />
          </button>
        </div>

        <div
          className="text-sm text-text-secondary"
          style={{ padding: '0 20px 18px' }}
        >
          {children ?? (
            <p>
              Are you sure you want to remove this account? All associated
              transactions will be permanently detached.
            </p>
          )}
        </div>

        <div
          className="flex items-center justify-end gap-2"
          style={{
            padding: '12px 20px',
            borderTop: '1px solid var(--color-glass-border)',
            background: 'var(--color-bg-tertiary)',
          }}
        >
          {footer ?? (
            <>
              <button type="button" className="block-btn">
                Cancel
              </button>
              <button type="button" className="block-btn block-btn-danger">
                Delete
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================================
 * BottomSheet — bottom sheet body (grab handle / header / content)
 * ========================================================================== */

export interface BottomSheetProps {
  title?: string;
  description?: string;
  /** Show the draggable grab handle at the top. */
  showHandle?: boolean;
  onClose?: () => void;
  footer?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export function BottomSheet({
  title = 'Quick Actions',
  description,
  showHandle = true,
  onClose,
  footer,
  children,
  className = '',
}: BottomSheetProps) {
  return (
    <div
      className={`block-card-elevated flex flex-col ${className}`}
      style={{
        width: '100%',
        padding: 0,
        overflow: 'hidden',
        borderTopLeftRadius: 14,
        borderTopRightRadius: 14,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
      }}
    >
      {showHandle && (
        <div className="flex justify-center" style={{ paddingTop: 10, paddingBottom: 4 }}>
          <div
            style={{
              width: 40,
              height: 4,
              borderRadius: PANEL_RADIUS,
              background: 'var(--color-border-secondary)',
            }}
          />
        </div>
      )}

      <div
        className="flex items-center justify-between"
        style={{ padding: '8px 18px 12px' }}
      >
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-semibold text-text-primary truncate">{title}</span>
          {description && (
            <span className="text-xs text-text-muted truncate">{description}</span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close sheet"
          className="flex items-center justify-center"
          style={{
            width: 28,
            height: 28,
            borderRadius: PANEL_RADIUS,
            background: 'var(--color-bg-tertiary)',
            border: '1px solid var(--color-glass-border)',
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <X size={15} />
        </button>
      </div>

      <div
        className="text-sm text-text-secondary"
        style={{
          padding: '4px 18px 16px',
          borderTop: '1px solid var(--color-glass-border)',
          paddingTop: 14,
        }}
      >
        {children ?? (
          <div className="flex flex-col gap-2">
            <button type="button" className="block-btn w-full" style={{ justifyContent: 'flex-start' }}>
              New Invoice
            </button>
            <button type="button" className="block-btn w-full" style={{ justifyContent: 'flex-start' }}>
              Record Expense
            </button>
            <button type="button" className="block-btn w-full" style={{ justifyContent: 'flex-start' }}>
              Add Client
            </button>
          </div>
        )}
      </div>

      {footer && (
        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid var(--color-glass-border)',
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
