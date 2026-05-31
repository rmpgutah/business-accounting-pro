import React, { useState } from 'react';
import {
  LayoutDashboard,
  Receipt,
  FileText,
  Settings,
  CreditCard,
  Banknote,
  Users,
  Building2,
  TrendingUp,
  Mail,
  Bell,
  ShieldCheck,
} from 'lucide-react';

/**
 * Tabs — presentational tab navigation primitives for the glass/block
 * theme. Every prop is optional with sensible defaults, so each component
 * renders correctly with zero props.
 *
 * Allowed imports: react + lucide-react only. No app modules.
 */

const ACCENT = 'var(--color-accent-blue, #60a5fa)';
const ACCENT_BG = 'var(--color-accent-blue-bg, rgba(96,165,250,0.12))';

interface TabItem {
  /** Stable key/value for the tab. */
  id: string;
  /** Visible label. */
  label: string;
  /** Optional lucide icon component. */
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
  /** Optional count for badge variants. */
  count?: number;
  /** Disabled tabs are dimmed and unselectable. */
  disabled?: boolean;
}

/* ------------------------------------------------------------------ */
/* TabBar — underline tabs                                            */
/* ------------------------------------------------------------------ */

export interface TabBarProps {
  tabs?: TabItem[];
  /** Controlled active id. If omitted, the component manages its own state. */
  active?: string;
  /** Called when a tab is selected. */
  onChange?: (id: string) => void;
  className?: string;
}

const DEFAULT_BAR_TABS: TabItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'expenses', label: 'Expenses', icon: Receipt },
  { id: 'invoices', label: 'Invoices', icon: FileText },
  { id: 'settings', label: 'Settings', icon: Settings, disabled: true },
];

export function TabBar({
  tabs = DEFAULT_BAR_TABS,
  active,
  onChange,
  className,
}: TabBarProps) {
  const [internal, setInternal] = useState(tabs[0]?.id ?? '');
  const current = active ?? internal;

  const select = (t: TabItem) => {
    if (t.disabled) return;
    if (active === undefined) setInternal(t.id);
    onChange?.(t.id);
  };

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        gap: 4,
        borderBottom: '1px solid var(--color-border-primary, rgba(255,255,255,0.06))',
      }}
    >
      {tabs.map((t) => {
        const isActive = t.id === current;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => select(t)}
            disabled={t.disabled}
            className="text-sm"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              background: 'transparent',
              border: 'none',
              borderBottom: '2px solid',
              borderBottomColor: isActive ? ACCENT : 'transparent',
              marginBottom: -1,
              color: isActive
                ? 'var(--color-text-primary, #e8eaf0)'
                : 'var(--color-text-secondary, #9a9db0)',
              fontWeight: isActive ? 600 : 500,
              cursor: t.disabled ? 'not-allowed' : 'pointer',
              opacity: t.disabled ? 0.4 : 1,
              transition: 'color 0.15s ease, border-color 0.15s ease',
            }}
          >
            {Icon && <Icon size={15} />}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PillTabs — pill / segmented tabs                                   */
/* ------------------------------------------------------------------ */

export interface PillTabsProps {
  tabs?: TabItem[];
  active?: string;
  onChange?: (id: string) => void;
  className?: string;
}

const DEFAULT_PILL_TABS: TabItem[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
];

export function PillTabs({
  tabs = DEFAULT_PILL_TABS,
  active,
  onChange,
  className,
}: PillTabsProps) {
  const [internal, setInternal] = useState(
    tabs.find((t) => !t.disabled)?.id ?? tabs[0]?.id ?? '',
  );
  const current = active ?? internal;

  const select = (t: TabItem) => {
    if (t.disabled) return;
    if (active === undefined) setInternal(t.id);
    onChange?.(t.id);
  };

  return (
    <div
      className={className}
      style={{
        display: 'inline-flex',
        gap: 4,
        padding: 4,
        borderRadius: 6,
        background: 'var(--color-bg-tertiary, rgba(28,30,38,0.65))',
        border: '1px solid var(--color-border-primary, rgba(255,255,255,0.06))',
      }}
    >
      {tabs.map((t) => {
        const isActive = t.id === current;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => select(t)}
            disabled={t.disabled}
            className="text-sm"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 14px',
              borderRadius: 6,
              border: 'none',
              background: isActive ? ACCENT_BG : 'transparent',
              boxShadow: isActive
                ? 'inset 0 0 0 1px rgba(96,165,250,0.35)'
                : 'none',
              color: isActive
                ? 'var(--color-accent-blue, #60a5fa)'
                : 'var(--color-text-secondary, #9a9db0)',
              fontWeight: isActive ? 600 : 500,
              cursor: t.disabled ? 'not-allowed' : 'pointer',
              opacity: t.disabled ? 0.4 : 1,
              transition: 'background 0.15s ease, color 0.15s ease',
            }}
          >
            {Icon && <Icon size={14} />}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* VerticalTabs — vertical tab list                                   */
/* ------------------------------------------------------------------ */

export interface VerticalTabsProps {
  tabs?: TabItem[];
  active?: string;
  onChange?: (id: string) => void;
  className?: string;
}

const DEFAULT_VERTICAL_TABS: TabItem[] = [
  { id: 'general', label: 'General', icon: Settings },
  { id: 'billing', label: 'Billing', icon: CreditCard },
  { id: 'banking', label: 'Banking', icon: Banknote },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'security', label: 'Security', icon: ShieldCheck },
];

export function VerticalTabs({
  tabs = DEFAULT_VERTICAL_TABS,
  active,
  onChange,
  className,
}: VerticalTabsProps) {
  const [internal, setInternal] = useState(tabs[0]?.id ?? '');
  const current = active ?? internal;

  const select = (t: TabItem) => {
    if (t.disabled) return;
    if (active === undefined) setInternal(t.id);
    onChange?.(t.id);
  };

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        minWidth: 180,
      }}
    >
      {tabs.map((t) => {
        const isActive = t.id === current;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => select(t)}
            disabled={t.disabled}
            className="text-sm"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '9px 12px',
              borderRadius: 6,
              border: 'none',
              borderLeft: '2px solid',
              borderLeftColor: isActive ? ACCENT : 'transparent',
              background: isActive ? ACCENT_BG : 'transparent',
              color: isActive
                ? 'var(--color-text-primary, #e8eaf0)'
                : 'var(--color-text-secondary, #9a9db0)',
              fontWeight: isActive ? 600 : 500,
              textAlign: 'left',
              cursor: t.disabled ? 'not-allowed' : 'pointer',
              opacity: t.disabled ? 0.4 : 1,
              transition: 'background 0.15s ease, color 0.15s ease',
            }}
          >
            {Icon && (
              <Icon
                size={16}
                className=""
              />
            )}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* TabWithBadge — tab with count badge                                */
/* ------------------------------------------------------------------ */

export interface TabWithBadgeProps {
  tabs?: TabItem[];
  active?: string;
  onChange?: (id: string) => void;
  className?: string;
}

const DEFAULT_BADGE_TABS: TabItem[] = [
  { id: 'inbox', label: 'Inbox', icon: Mail, count: 12 },
  { id: 'overdue', label: 'Overdue', icon: Bell, count: 3 },
  { id: 'drafts', label: 'Drafts', icon: FileText, count: 0 },
  { id: 'archived', label: 'Archived', icon: Building2 },
];

export function TabWithBadge({
  tabs = DEFAULT_BADGE_TABS,
  active,
  onChange,
  className,
}: TabWithBadgeProps) {
  const [internal, setInternal] = useState(tabs[0]?.id ?? '');
  const current = active ?? internal;

  const select = (t: TabItem) => {
    if (t.disabled) return;
    if (active === undefined) setInternal(t.id);
    onChange?.(t.id);
  };

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        gap: 4,
        borderBottom: '1px solid var(--color-border-primary, rgba(255,255,255,0.06))',
      }}
    >
      {tabs.map((t) => {
        const isActive = t.id === current;
        const Icon = t.icon;
        const hasBadge = typeof t.count === 'number';
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => select(t)}
            disabled={t.disabled}
            className="text-sm"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '8px 14px',
              background: 'transparent',
              border: 'none',
              borderBottom: '2px solid',
              borderBottomColor: isActive ? ACCENT : 'transparent',
              marginBottom: -1,
              color: isActive
                ? 'var(--color-text-primary, #e8eaf0)'
                : 'var(--color-text-secondary, #9a9db0)',
              fontWeight: isActive ? 600 : 500,
              cursor: t.disabled ? 'not-allowed' : 'pointer',
              opacity: t.disabled ? 0.4 : 1,
              transition: 'color 0.15s ease, border-color 0.15s ease',
            }}
          >
            {Icon && <Icon size={15} />}
            {t.label}
            {hasBadge && (
              <span
                className="font-mono"
                style={{
                  minWidth: 18,
                  height: 18,
                  padding: '0 5px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 6,
                  fontSize: 11,
                  lineHeight: 1,
                  fontWeight: 600,
                  background: isActive
                    ? ACCENT_BG
                    : 'var(--color-bg-tertiary, rgba(28,30,38,0.65))',
                  color: isActive
                    ? 'var(--color-accent-blue, #60a5fa)'
                    : 'var(--color-text-muted, #5e6178)',
                }}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ScrollTabs — horizontally scrollable tab strip                     */
/* ------------------------------------------------------------------ */

export interface ScrollTabsProps {
  tabs?: TabItem[];
  active?: string;
  onChange?: (id: string) => void;
  className?: string;
}

const DEFAULT_SCROLL_TABS: TabItem[] = [
  { id: 'jan', label: 'January', icon: TrendingUp },
  { id: 'feb', label: 'February' },
  { id: 'mar', label: 'March' },
  { id: 'apr', label: 'April' },
  { id: 'may', label: 'May' },
  { id: 'jun', label: 'June' },
  { id: 'jul', label: 'July' },
  { id: 'aug', label: 'August' },
  { id: 'sep', label: 'September' },
  { id: 'oct', label: 'October' },
  { id: 'nov', label: 'November' },
  { id: 'dec', label: 'December' },
];

export function ScrollTabs({
  tabs = DEFAULT_SCROLL_TABS,
  active,
  onChange,
  className,
}: ScrollTabsProps) {
  const [internal, setInternal] = useState(tabs[0]?.id ?? '');
  const current = active ?? internal;

  const select = (t: TabItem) => {
    if (t.disabled) return;
    if (active === undefined) setInternal(t.id);
    onChange?.(t.id);
  };

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        gap: 6,
        overflowX: 'auto',
        padding: '2px 2px 8px',
        scrollbarWidth: 'thin',
        borderBottom: '1px solid var(--color-border-primary, rgba(255,255,255,0.06))',
      }}
    >
      {tabs.map((t) => {
        const isActive = t.id === current;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => select(t)}
            disabled={t.disabled}
            className="text-sm"
            style={{
              flex: '0 0 auto',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid',
              borderColor: isActive
                ? 'rgba(96,165,250,0.35)'
                : 'var(--color-border-primary, rgba(255,255,255,0.06))',
              background: isActive
                ? ACCENT_BG
                : 'var(--color-bg-tertiary, rgba(28,30,38,0.65))',
              color: isActive
                ? 'var(--color-accent-blue, #60a5fa)'
                : 'var(--color-text-secondary, #9a9db0)',
              fontWeight: isActive ? 600 : 500,
              whiteSpace: 'nowrap',
              cursor: t.disabled ? 'not-allowed' : 'pointer',
              opacity: t.disabled ? 0.4 : 1,
              transition: 'background 0.15s ease, color 0.15s ease',
            }}
          >
            {Icon && <Icon size={14} />}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
