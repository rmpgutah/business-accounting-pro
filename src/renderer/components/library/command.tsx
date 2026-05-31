import React, { useState } from 'react';
import {
  Search,
  ArrowRight,
  Check,
  ChevronDown,
  X,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  FileText,
  type LucideIcon,
} from 'lucide-react';

/* ------------------------------------------------------------------ *
 * Shared style helpers (mirror the glass/block theme via CSS vars)    *
 * ------------------------------------------------------------------ */

const cardStyle: React.CSSProperties = {
  background: 'var(--color-bg-elevated, #20222c)',
  border: '1px solid var(--color-glass-border, rgba(255,255,255,0.08))',
  borderRadius: 6,
  boxShadow: '0 1px 0 var(--color-glass-shine, rgba(255,255,255,0.04)) inset',
};

/* ------------------------------------------------------------------ *
 * ShortcutHint — keyboard shortcut hint                               *
 * ------------------------------------------------------------------ */

export interface ShortcutHintProps {
  /** Individual keys, e.g. ['⌘', 'K']. */
  keys?: string[];
  /** Optional leading label, e.g. "Open palette". */
  label?: string;
  className?: string;
}

export function ShortcutHint({
  keys = ['⌘', 'K'],
  label,
  className,
}: ShortcutHintProps) {
  return (
    <span
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
    >
      {label && (
        <span className="text-text-muted" style={{ fontSize: 12 }}>
          {label}
        </span>
      )}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
        {keys.map((k, i) => (
          <kbd
            key={`${k}-${i}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              minWidth: 18,
              height: 18,
              padding: '0 5px',
              fontSize: 11,
              fontFamily:
                'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              lineHeight: 1,
              color: 'var(--color-text-secondary, #9a9db0)',
              background: 'var(--color-bg-tertiary, #1c1e26)',
              border: '1px solid var(--color-glass-border, rgba(255,255,255,0.08))',
              borderRadius: 6,
            }}
          >
            {k}
          </kbd>
        ))}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * CommandItem — a single command-palette row                          *
 * ------------------------------------------------------------------ */

export interface CommandItemProps {
  label?: string;
  description?: string;
  icon?: LucideIcon;
  shortcut?: string[];
  /** Visual selected/active state (e.g. keyboard-highlighted row). */
  active?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  className?: string;
}

export function CommandItem({
  label = 'Create Invoice',
  description = 'Start a new customer invoice',
  icon: Icon = FileText,
  shortcut = ['⌘', 'I'],
  active = false,
  disabled = false,
  onSelect,
  className,
}: CommandItemProps) {
  const [hover, setHover] = useState(false);
  const highlighted = (active || hover) && !disabled;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        padding: '9px 12px',
        textAlign: 'left',
        borderRadius: 6,
        border: '1px solid transparent',
        background: highlighted
          ? 'var(--color-bg-hover, rgba(42,44,56,0.6))'
          : 'transparent',
        borderColor: active
          ? 'var(--color-glass-border-hover, rgba(255,255,255,0.14))'
          : 'transparent',
        color: 'var(--color-text-primary, #e8eaf0)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        transition: 'background 0.12s ease, border-color 0.12s ease',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          flexShrink: 0,
          borderRadius: 6,
          background: 'var(--color-bg-tertiary, #1c1e26)',
          color: 'var(--color-accent-blue, #60a5fa)',
        }}
      >
        <Icon size={15} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: 'block',
            fontSize: 13,
            fontWeight: 500,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {label}
        </span>
        {description && (
          <span
            className="text-text-muted"
            style={{
              display: 'block',
              fontSize: 11,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {description}
          </span>
        )}
      </span>
      {shortcut && shortcut.length > 0 && <ShortcutHint keys={shortcut} />}
      {highlighted && !shortcut?.length && (
        <ArrowRight
          size={14}
          style={{ color: 'var(--color-text-muted, #5e6178)' }}
        />
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * FilterChipGroup — togglable filter chips                            *
 * ------------------------------------------------------------------ */

export interface FilterChip {
  id: string;
  label: string;
  count?: number;
}

export interface FilterChipGroupProps {
  chips?: FilterChip[];
  /** IDs of selected chips. */
  selected?: string[];
  /** Show a clear-all control when at least one chip is active. */
  showClear?: boolean;
  onToggle?: (id: string) => void;
  onClear?: () => void;
  className?: string;
}

const DEFAULT_CHIPS: FilterChip[] = [
  { id: 'all', label: 'All', count: 248 },
  { id: 'paid', label: 'Paid', count: 132 },
  { id: 'open', label: 'Open', count: 84 },
  { id: 'overdue', label: 'Overdue', count: 32 },
];

export function FilterChipGroup({
  chips = DEFAULT_CHIPS,
  selected = ['all'],
  showClear = true,
  onToggle,
  onClear,
  className,
}: FilterChipGroupProps) {
  const [internal, setInternal] = useState<string[]>(selected);
  const active = onToggle ? selected : internal;

  const toggle = (id: string) => {
    if (onToggle) {
      onToggle(id);
    } else {
      setInternal((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      );
    }
  };

  const clear = () => {
    if (onClear) onClear();
    else setInternal([]);
  };

  return (
    <div
      className={className}
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}
    >
      {chips.map((chip) => {
        const isOn = active.includes(chip.id);
        return (
          <button
            key={chip.id}
            type="button"
            onClick={() => toggle(chip.id)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              fontSize: 12,
              fontWeight: 500,
              borderRadius: 6,
              cursor: 'pointer',
              color: isOn
                ? 'var(--color-accent-blue, #60a5fa)'
                : 'var(--color-text-secondary, #9a9db0)',
              background: isOn
                ? 'var(--color-accent-blue-bg, rgba(96,165,250,0.12))'
                : 'var(--color-bg-tertiary, #1c1e26)',
              border: `1px solid ${
                isOn
                  ? 'var(--color-accent-blue, #60a5fa)'
                  : 'var(--color-glass-border, rgba(255,255,255,0.08))'
              }`,
              transition: 'all 0.12s ease',
            }}
          >
            {isOn && <Check size={12} />}
            <span>{chip.label}</span>
            {typeof chip.count === 'number' && (
              <span
                style={{
                  fontSize: 11,
                  opacity: 0.75,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {chip.count}
              </span>
            )}
          </button>
        );
      })}
      {showClear && active.length > 0 && (
        <button
          type="button"
          onClick={clear}
          className="text-text-muted"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 8px',
            fontSize: 12,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          <X size={12} />
          Clear
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * DropdownMenu — generic dropdown menu                                *
 * ------------------------------------------------------------------ */

export interface DropdownMenuItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  shortcut?: string[];
  danger?: boolean;
  disabled?: boolean;
}

export interface DropdownMenuProps {
  /** Trigger button label. */
  label?: string;
  triggerIcon?: LucideIcon;
  items?: DropdownMenuItem[];
  /** Render the menu open by default (useful for showcases). */
  defaultOpen?: boolean;
  align?: 'left' | 'right';
  onSelect?: (id: string) => void;
  className?: string;
}

const DEFAULT_MENU_ITEMS: DropdownMenuItem[] = [
  { id: 'edit', label: 'Edit', shortcut: ['⌘', 'E'] },
  { id: 'duplicate', label: 'Duplicate', shortcut: ['⌘', 'D'] },
  { id: 'export', label: 'Export PDF', icon: FileText },
  { id: 'delete', label: 'Delete', icon: X, danger: true },
];

export function DropdownMenu({
  label = 'Actions',
  triggerIcon: TriggerIcon,
  items = DEFAULT_MENU_ITEMS,
  defaultOpen = true,
  align = 'left',
  onSelect,
  className,
}: DropdownMenuProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      className={className}
      style={{ position: 'relative', display: 'inline-block' }}
    >
      <button
        type="button"
        className="block-btn"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
        }}
      >
        {TriggerIcon && <TriggerIcon size={14} />}
        <span>{label}</span>
        <ChevronDown
          size={14}
          style={{
            transition: 'transform 0.15s ease',
            transform: open ? 'rotate(180deg)' : 'none',
            color: 'var(--color-text-muted, #5e6178)',
          }}
        />
      </button>
      {open && (
        <div
          role="menu"
          style={{
            ...cardStyle,
            position: 'absolute',
            top: 'calc(100% + 6px)',
            [align]: 0,
            minWidth: 200,
            padding: 4,
            zIndex: 50,
          }}
        >
          {items.map((item) => {
            const ItemIcon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  if (item.disabled) return;
                  onSelect?.(item.id);
                  setOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '7px 10px',
                  fontSize: 13,
                  textAlign: 'left',
                  borderRadius: 6,
                  border: 'none',
                  background: 'transparent',
                  cursor: item.disabled ? 'not-allowed' : 'pointer',
                  opacity: item.disabled ? 0.45 : 1,
                  color: item.danger
                    ? 'var(--color-accent-expense, #f87171)'
                    : 'var(--color-text-primary, #e8eaf0)',
                  transition: 'background 0.12s ease',
                }}
                onMouseEnter={(e) => {
                  if (item.disabled) return;
                  e.currentTarget.style.background = item.danger
                    ? 'var(--color-accent-expense-bg, rgba(248,113,113,0.12))'
                    : 'var(--color-bg-hover, rgba(42,44,56,0.6))';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                {ItemIcon && <ItemIcon size={14} style={{ flexShrink: 0 }} />}
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.shortcut && item.shortcut.length > 0 && (
                  <ShortcutHint keys={item.shortcut} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * SortMenu — sort dropdown with direction toggle                      *
 * ------------------------------------------------------------------ */

export interface SortOption {
  id: string;
  label: string;
}

export interface SortMenuProps {
  options?: SortOption[];
  /** Currently active sort field id. */
  activeId?: string;
  direction?: 'asc' | 'desc';
  defaultOpen?: boolean;
  onChange?: (id: string, direction: 'asc' | 'desc') => void;
  className?: string;
}

const DEFAULT_SORT_OPTIONS: SortOption[] = [
  { id: 'date', label: 'Date' },
  { id: 'amount', label: 'Amount' },
  { id: 'name', label: 'Name' },
  { id: 'status', label: 'Status' },
];

export function SortMenu({
  options = DEFAULT_SORT_OPTIONS,
  activeId = 'date',
  direction = 'desc',
  defaultOpen = true,
  onChange,
  className,
}: SortMenuProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [field, setField] = useState(activeId);
  const [dir, setDir] = useState<'asc' | 'desc'>(direction);

  const current = onChange ? activeId : field;
  const currentDir = onChange ? direction : dir;
  const activeLabel = options.find((o) => o.id === current)?.label ?? 'Sort';

  const select = (id: string) => {
    const nextDir: 'asc' | 'desc' =
      id === current ? (currentDir === 'asc' ? 'desc' : 'asc') : currentDir;
    if (onChange) {
      onChange(id, nextDir);
    } else {
      setField(id);
      setDir(nextDir);
    }
  };

  return (
    <div
      className={className}
      style={{ position: 'relative', display: 'inline-block' }}
    >
      <button
        type="button"
        className="block-btn"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 13,
        }}
      >
        <ArrowUpDown size={14} style={{ color: 'var(--color-text-muted, #5e6178)' }} />
        <span>
          Sort:{' '}
          <span style={{ color: 'var(--color-accent-blue, #60a5fa)' }}>
            {activeLabel}
          </span>
        </span>
        {currentDir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
      </button>
      {open && (
        <div
          role="menu"
          style={{
            ...cardStyle,
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            minWidth: 180,
            padding: 4,
            zIndex: 50,
          }}
        >
          {options.map((opt) => {
            const isActive = opt.id === current;
            return (
              <button
                key={opt.id}
                type="button"
                role="menuitem"
                onClick={() => select(opt.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '7px 10px',
                  fontSize: 13,
                  textAlign: 'left',
                  borderRadius: 6,
                  border: 'none',
                  cursor: 'pointer',
                  background: isActive
                    ? 'var(--color-bg-hover, rgba(42,44,56,0.6))'
                    : 'transparent',
                  color: isActive
                    ? 'var(--color-accent-blue, #60a5fa)'
                    : 'var(--color-text-primary, #e8eaf0)',
                  transition: 'background 0.12s ease',
                }}
                onMouseEnter={(e) => {
                  if (!isActive)
                    e.currentTarget.style.background =
                      'var(--color-bg-hover, rgba(42,44,56,0.6))';
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'transparent';
                }}
              >
                <span style={{ flex: 1 }}>{opt.label}</span>
                {isActive &&
                  (currentDir === 'asc' ? (
                    <ArrowUp size={13} />
                  ) : (
                    <ArrowDown size={13} />
                  ))}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Re-export an icon used in a default so consumers needn't import it. *
 * (Search is referenced to keep the import meaningful for palettes.)  *
 * ------------------------------------------------------------------ */

/** Optional decorative search affordance for command palettes. */
export function CommandSearchAffordance() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        color: 'var(--color-text-muted, #5e6178)',
      }}
    >
      <Search size={14} />
      <span style={{ fontSize: 13 }}>Search commands…</span>
    </span>
  );
}
