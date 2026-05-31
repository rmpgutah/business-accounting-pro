import React from 'react';
import {
  Search,
  Filter,
  Plus,
  Download,
  RefreshCw,
  ChevronDown,
  X,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';

/* ------------------------------------------------------------------ *
 * Shared types
 * ------------------------------------------------------------------ */

export interface HeaderAction {
  label: string;
  icon?: LucideIcon;
  onClick?: () => void;
  /** 'primary' renders the accent button, anything else the ghost variant. */
  variant?: 'primary' | 'ghost';
}

const RADIUS = 6;

function ActionButton({ action }: { action: HeaderAction }) {
  const Icon = action.icon;
  const primary = action.variant === 'primary';
  return (
    <button
      type="button"
      onClick={action.onClick}
      className={
        'inline-flex items-center gap-2 text-sm font-medium transition-colors ' +
        (primary
          ? 'text-white'
          : 'text-text-secondary hover:text-text-primary')
      }
      style={{
        borderRadius: RADIUS,
        padding: '7px 12px',
        backgroundColor: primary
          ? 'var(--color-accent-blue, #3b82f6)'
          : 'var(--color-bg-tertiary, #2e2e2e)',
        border: primary
          ? '1px solid var(--color-accent-blue, #3b82f6)'
          : '1px solid var(--color-border-primary, #3a3a3a)',
      }}
    >
      {Icon && <Icon size={15} strokeWidth={2} />}
      <span>{action.label}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * PageHeader — page title + actions
 * ------------------------------------------------------------------ */

export interface PageHeaderProps {
  title?: string;
  subtitle?: string;
  icon?: LucideIcon;
  actions?: HeaderAction[];
  className?: string;
}

export function PageHeader({
  title = 'Dashboard',
  subtitle = 'Overview of your business at a glance',
  icon: Icon,
  actions = [
    { label: 'Export', icon: Download, variant: 'ghost' },
    { label: 'New Entry', icon: Plus, variant: 'primary' },
  ],
  className,
}: PageHeaderProps) {
  return (
    <div
      className={'flex items-start justify-between gap-4 ' + (className ?? '')}
      style={{ marginBottom: 20 }}
    >
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <div
            className="flex items-center justify-center shrink-0"
            style={{
              width: 38,
              height: 38,
              borderRadius: RADIUS,
              backgroundColor: 'var(--color-bg-tertiary, #2e2e2e)',
              border: '1px solid var(--color-border-primary, #3a3a3a)',
            }}
          >
            <Icon size={20} className="text-text-secondary" />
          </div>
        )}
        <div className="min-w-0">
          <h1
            className="text-text-primary font-semibold truncate"
            style={{ fontSize: 22, lineHeight: 1.2 }}
          >
            {title}
          </h1>
          {subtitle && (
            <p className="text-text-muted text-sm truncate" style={{ marginTop: 2 }}>
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {actions.length > 0 && (
        <div className="flex items-center gap-2 shrink-0">
          {actions.map((a, i) => (
            <ActionButton key={i} action={a} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * SectionHeader — section heading + subtitle
 * ------------------------------------------------------------------ */

export interface SectionHeaderProps {
  title?: string;
  subtitle?: string;
  icon?: LucideIcon;
  /** Optional trailing slot (e.g. a "View all" button). */
  action?: HeaderAction;
  className?: string;
}

export function SectionHeader({
  title = 'Recent Transactions',
  subtitle = 'Last 30 days of activity',
  icon: Icon,
  action,
  className,
}: SectionHeaderProps) {
  return (
    <div
      className={'flex items-center justify-between gap-3 ' + (className ?? '')}
      style={{
        marginBottom: 12,
        paddingBottom: 10,
        borderBottom: '1px solid var(--color-border-primary, #3a3a3a)',
      }}
    >
      <div className="flex items-center gap-2 min-w-0">
        {Icon && <Icon size={16} className="text-text-muted shrink-0" />}
        <div className="min-w-0">
          <h2 className="text-text-primary font-semibold text-sm truncate">
            {title}
          </h2>
          {subtitle && (
            <p className="text-text-muted text-xs truncate" style={{ marginTop: 1 }}>
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {action && <ActionButton action={action} />}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Toolbar — action toolbar
 * ------------------------------------------------------------------ */

export interface ToolbarProps {
  actions?: HeaderAction[];
  /** Optional left-aligned label/title for the toolbar. */
  label?: string;
  className?: string;
}

export function Toolbar({
  label,
  actions = [
    { label: 'Add', icon: Plus, variant: 'primary' },
    { label: 'Import', icon: Download, variant: 'ghost' },
    { label: 'Refresh', icon: RefreshCw, variant: 'ghost' },
  ],
  className,
}: ToolbarProps) {
  return (
    <div
      className={'flex items-center justify-between gap-3 ' + (className ?? '')}
      style={{
        padding: '8px 12px',
        borderRadius: RADIUS,
        backgroundColor: 'var(--color-bg-secondary, #1f1f1f)',
        border: '1px solid var(--color-border-primary, #3a3a3a)',
      }}
    >
      {label ? (
        <span className="text-text-secondary text-sm font-medium">{label}</span>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-2">
        {actions.map((a, i) => (
          <ActionButton key={i} action={a} />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * CommandBar — search + filter bar
 * ------------------------------------------------------------------ */

export interface CommandBarProps {
  placeholder?: string;
  value?: string;
  filterLabel?: string;
  /** Number of active filters, shown as a badge on the filter button. */
  activeFilters?: number;
  actions?: HeaderAction[];
  onChange?: (value: string) => void;
  className?: string;
}

export function CommandBar({
  placeholder = 'Search transactions, vendors, invoices…',
  value = '',
  filterLabel = 'Filters',
  activeFilters = 0,
  actions = [{ label: 'New', icon: Plus, variant: 'primary' }],
  onChange,
  className,
}: CommandBarProps) {
  return (
    <div className={'flex items-center gap-2 ' + (className ?? '')}>
      <div
        className="flex items-center gap-2 flex-1 min-w-0"
        style={{
          padding: '7px 11px',
          borderRadius: RADIUS,
          backgroundColor: 'var(--color-bg-tertiary, #2e2e2e)',
          border: '1px solid var(--color-border-primary, #3a3a3a)',
        }}
      >
        <Search size={15} className="text-text-muted shrink-0" />
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange?.(e.target.value)}
          className="flex-1 min-w-0 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
        />
      </div>

      <button
        type="button"
        className="inline-flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors shrink-0"
        style={{
          padding: '7px 12px',
          borderRadius: RADIUS,
          backgroundColor: 'var(--color-bg-tertiary, #2e2e2e)',
          border: '1px solid var(--color-border-primary, #3a3a3a)',
        }}
      >
        <Filter size={15} />
        <span>{filterLabel}</span>
        {activeFilters > 0 && (
          <span
            className="inline-flex items-center justify-center text-white text-xs font-semibold"
            style={{
              minWidth: 18,
              height: 18,
              padding: '0 5px',
              borderRadius: 9,
              backgroundColor: 'var(--color-accent-blue, #3b82f6)',
            }}
          >
            {activeFilters}
          </span>
        )}
      </button>

      {actions.map((a, i) => (
        <ActionButton key={i} action={a} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * FilterToolbar — filter row toolbar
 * ------------------------------------------------------------------ */

export interface FilterChip {
  label: string;
  value?: string;
  active?: boolean;
}

export interface FilterToolbarProps {
  filters?: FilterChip[];
  /** Show a "Clear all" affordance when any filter is active. */
  onClear?: () => void;
  className?: string;
}

export function FilterToolbar({
  filters = [
    { label: 'Status', value: 'All', active: false },
    { label: 'Date', value: 'This month', active: true },
    { label: 'Category', value: 'Any', active: false },
    { label: 'Amount', value: '> $0', active: false },
  ],
  onClear,
  className,
}: FilterToolbarProps) {
  const hasActive = filters.some((f) => f.active);
  return (
    <div
      className={'flex items-center flex-wrap gap-2 ' + (className ?? '')}
      style={{
        padding: '8px 12px',
        borderRadius: RADIUS,
        backgroundColor: 'var(--color-bg-secondary, #1f1f1f)',
        border: '1px solid var(--color-border-primary, #3a3a3a)',
      }}
    >
      <SlidersHorizontal size={15} className="text-text-muted shrink-0" />
      {filters.map((f, i) => (
        <button
          key={i}
          type="button"
          className={
            'inline-flex items-center gap-1.5 text-sm transition-colors ' +
            (f.active
              ? 'text-text-primary'
              : 'text-text-secondary hover:text-text-primary')
          }
          style={{
            padding: '5px 10px',
            borderRadius: RADIUS,
            backgroundColor: f.active
              ? 'var(--color-bg-tertiary, #2e2e2e)'
              : 'transparent',
            border: f.active
              ? '1px solid var(--color-accent-blue, #3b82f6)'
              : '1px solid var(--color-border-primary, #3a3a3a)',
          }}
        >
          <span className="text-text-muted">{f.label}:</span>
          <span className="font-medium">{f.value}</span>
          <ChevronDown size={13} className="text-text-muted" />
        </button>
      ))}
      {hasActive && (
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center gap-1 text-xs text-text-muted hover:text-text-primary transition-colors"
          style={{ padding: '5px 8px', borderRadius: RADIUS }}
        >
          <X size={13} />
          <span>Clear all</span>
        </button>
      )}
    </div>
  );
}
