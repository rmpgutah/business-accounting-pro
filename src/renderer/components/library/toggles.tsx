import React, { useState } from 'react';
import { Check, type LucideIcon } from 'lucide-react';

/* ------------------------------------------------------------------ *
 * Shared presentational toggle/selector components.
 * All props optional — each renders correctly as <Name /> with zero props.
 * Pure presentational: only 'react' + 'lucide-react' imports.
 * ------------------------------------------------------------------ */

const ACCENT = 'var(--color-accent-blue, #3b82f6)';

/* ============================ ToggleSwitch ============================ */

export interface ToggleSwitchProps {
  checked?: boolean;
  /** Uncontrolled default when `checked` is not provided. */
  defaultChecked?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** Fill color when on. */
  color?: string;
  onChange?: (next: boolean) => void;
  className?: string;
  'aria-label'?: string;
}

export function ToggleSwitch({
  checked,
  defaultChecked = true,
  disabled = false,
  size = 'md',
  color = ACCENT,
  onChange,
  className,
  'aria-label': ariaLabel = 'Toggle',
}: ToggleSwitchProps) {
  const [internal, setInternal] = useState(defaultChecked);
  const isControlled = checked !== undefined;
  const on = isControlled ? checked : internal;

  const dims = {
    sm: { w: 32, h: 18, knob: 14 },
    md: { w: 42, h: 24, knob: 18 },
    lg: { w: 52, h: 30, knob: 24 },
  }[size];

  const pad = (dims.h - dims.knob) / 2;

  function toggle() {
    if (disabled) return;
    const next = !on;
    if (!isControlled) setInternal(next);
    onChange?.(next);
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={toggle}
      className={className}
      style={{
        position: 'relative',
        width: dims.w,
        height: dims.h,
        borderRadius: dims.h,
        border: '1px solid var(--color-border-primary, #3a3a3a)',
        backgroundColor: on ? color : 'var(--color-bg-tertiary, #2e2e2e)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background-color 0.2s ease',
        flexShrink: 0,
        padding: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: pad,
          left: on ? dims.w - dims.knob - pad - 1 : pad,
          width: dims.knob,
          height: dims.knob,
          borderRadius: '50%',
          backgroundColor: '#fff',
          boxShadow: '0 1px 2px rgba(0,0,0,0.4)',
          transition: 'left 0.2s ease',
        }}
      />
    </button>
  );
}

/* ========================== SegmentedControl ========================== */

export interface SegmentOption {
  value: string;
  label: string;
  icon?: LucideIcon;
}

export interface SegmentedControlProps {
  options?: SegmentOption[];
  value?: string;
  defaultValue?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  onChange?: (value: string) => void;
  className?: string;
}

export function SegmentedControl({
  options = [
    { value: 'day', label: 'Day' },
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
    { value: 'year', label: 'Year' },
  ],
  value,
  defaultValue,
  disabled = false,
  size = 'md',
  onChange,
  className,
}: SegmentedControlProps) {
  const first = options[0]?.value ?? '';
  const [internal, setInternal] = useState(defaultValue ?? first);
  const isControlled = value !== undefined;
  const active = isControlled ? value : internal;

  function select(v: string) {
    if (disabled) return;
    if (!isControlled) setInternal(v);
    onChange?.(v);
  }

  const padY = size === 'sm' ? 4 : 6;

  return (
    <div
      role="tablist"
      className={className}
      style={{
        display: 'inline-flex',
        padding: 3,
        gap: 2,
        borderRadius: 6,
        backgroundColor: 'var(--color-bg-tertiary, #2e2e2e)',
        border: '1px solid var(--color-border-primary, #3a3a3a)',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {options.map((opt) => {
        const isActive = opt.value === active;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={disabled}
            onClick={() => select(opt.value)}
            className={isActive ? 'text-text-primary' : 'text-text-secondary'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: `${padY}px 12px`,
              fontSize: size === 'sm' ? 12 : 13,
              fontWeight: 500,
              borderRadius: 4,
              border: 'none',
              cursor: disabled ? 'not-allowed' : 'pointer',
              backgroundColor: isActive
                ? 'var(--color-bg-secondary, #1f1f1f)'
                : 'transparent',
              boxShadow: isActive ? '0 1px 2px rgba(0,0,0,0.3)' : 'none',
              transition: 'background-color 0.15s ease, color 0.15s ease',
              whiteSpace: 'nowrap',
            }}
          >
            {Icon && <Icon size={14} />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* ============================ CheckboxCard ============================ */

export interface CheckboxCardProps {
  title?: string;
  description?: string;
  icon?: LucideIcon;
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  color?: string;
  onChange?: (next: boolean) => void;
  className?: string;
}

export function CheckboxCard({
  title = 'Enable auto-backup',
  description = 'Automatically upload an encrypted copy of your books after every change.',
  icon: Icon,
  checked,
  defaultChecked = false,
  disabled = false,
  color = ACCENT,
  onChange,
  className,
}: CheckboxCardProps) {
  const [internal, setInternal] = useState(defaultChecked);
  const isControlled = checked !== undefined;
  const on = isControlled ? checked : internal;

  function toggle() {
    if (disabled) return;
    const next = !on;
    if (!isControlled) setInternal(next);
    onChange?.(next);
  }

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      disabled={disabled}
      onClick={toggle}
      className={`block-card text-left ${className ?? ''}`}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        width: '100%',
        padding: 14,
        borderRadius: 6,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        border: `1px solid ${on ? color : 'var(--color-border-primary, #3a3a3a)'}`,
        backgroundColor: on
          ? 'color-mix(in srgb, ' + color + ' 12%, var(--color-bg-secondary, #1f1f1f))'
          : 'var(--color-bg-secondary, #1f1f1f)',
        transition: 'border-color 0.15s ease, background-color 0.15s ease',
      }}
    >
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          width: 20,
          height: 20,
          marginTop: 1,
          borderRadius: 4,
          backgroundColor: on ? color : 'transparent',
          border: `1.5px solid ${on ? color : 'var(--color-border-primary, #5a5a5a)'}`,
          transition: 'background-color 0.15s ease, border-color 0.15s ease',
        }}
      >
        {on && <Check size={14} color="#fff" strokeWidth={3} />}
      </span>
      <span style={{ minWidth: 0 }}>
        <span
          className="text-text-primary"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          {Icon && <Icon size={15} />}
          {title}
        </span>
        {description && (
          <span
            className="text-text-secondary"
            style={{ display: 'block', marginTop: 3, fontSize: 12.5, lineHeight: 1.4 }}
          >
            {description}
          </span>
        )}
      </span>
    </button>
  );
}

/* ============================= RadioCards ============================= */

export interface RadioCardOption {
  value: string;
  title: string;
  description?: string;
  icon?: LucideIcon;
}

export interface RadioCardsProps {
  options?: RadioCardOption[];
  value?: string;
  defaultValue?: string;
  disabled?: boolean;
  color?: string;
  /** Layout direction. */
  direction?: 'vertical' | 'horizontal';
  onChange?: (value: string) => void;
  className?: string;
}

export function RadioCards({
  options = [
    {
      value: 'monthly',
      title: 'Monthly',
      description: 'Billed every month. Cancel anytime.',
    },
    {
      value: 'annual',
      title: 'Annual',
      description: 'Two months free. Best value.',
    },
    {
      value: 'lifetime',
      title: 'Lifetime',
      description: 'One payment, yours forever.',
    },
  ],
  value,
  defaultValue,
  disabled = false,
  color = ACCENT,
  direction = 'vertical',
  onChange,
  className,
}: RadioCardsProps) {
  const first = options[0]?.value ?? '';
  const [internal, setInternal] = useState(defaultValue ?? first);
  const isControlled = value !== undefined;
  const selected = isControlled ? value : internal;

  function select(v: string) {
    if (disabled) return;
    if (!isControlled) setInternal(v);
    onChange?.(v);
  }

  return (
    <div
      role="radiogroup"
      className={className}
      style={{
        display: 'flex',
        flexDirection: direction === 'vertical' ? 'column' : 'row',
        gap: 8,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {options.map((opt) => {
        const isSel = opt.value === selected;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isSel}
            disabled={disabled}
            onClick={() => select(opt.value)}
            className="text-left"
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              flex: direction === 'horizontal' ? 1 : undefined,
              padding: 14,
              borderRadius: 6,
              cursor: disabled ? 'not-allowed' : 'pointer',
              border: `1px solid ${isSel ? color : 'var(--color-border-primary, #3a3a3a)'}`,
              backgroundColor: isSel
                ? 'color-mix(in srgb, ' + color + ' 12%, var(--color-bg-secondary, #1f1f1f))'
                : 'var(--color-bg-secondary, #1f1f1f)',
              transition: 'border-color 0.15s ease, background-color 0.15s ease',
            }}
          >
            <span
              aria-hidden
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                width: 18,
                height: 18,
                marginTop: 1,
                borderRadius: '50%',
                border: `1.5px solid ${isSel ? color : 'var(--color-border-primary, #5a5a5a)'}`,
                transition: 'border-color 0.15s ease',
              }}
            >
              {isSel && (
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: '50%',
                    backgroundColor: color,
                  }}
                />
              )}
            </span>
            <span style={{ minWidth: 0 }}>
              <span
                className="text-text-primary"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                {Icon && <Icon size={15} />}
                {opt.title}
              </span>
              {opt.description && (
                <span
                  className="text-text-secondary"
                  style={{ display: 'block', marginTop: 3, fontSize: 12.5, lineHeight: 1.4 }}
                >
                  {opt.description}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ============================== SwitchRow ============================== */

export interface SwitchRowProps {
  label?: string;
  description?: string;
  icon?: LucideIcon;
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  color?: string;
  onChange?: (next: boolean) => void;
  className?: string;
}

export function SwitchRow({
  label = 'Email notifications',
  description = 'Receive a summary when invoices are paid.',
  icon: Icon,
  checked,
  defaultChecked = true,
  disabled = false,
  color = ACCENT,
  onChange,
  className,
}: SwitchRowProps) {
  const [internal, setInternal] = useState(defaultChecked);
  const isControlled = checked !== undefined;
  const on = isControlled ? checked : internal;

  function toggle(next: boolean) {
    if (disabled) return;
    if (!isControlled) setInternal(next);
    onChange?.(next);
  }

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '12px 14px',
        borderRadius: 6,
        backgroundColor: 'var(--color-bg-secondary, #1f1f1f)',
        border: '1px solid var(--color-border-primary, #3a3a3a)',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        {Icon && (
          <span className="text-text-secondary" style={{ flexShrink: 0 }}>
            <Icon size={18} />
          </span>
        )}
        <div style={{ minWidth: 0 }}>
          <div className="text-text-primary" style={{ fontSize: 14, fontWeight: 500 }}>
            {label}
          </div>
          {description && (
            <div
              className="text-text-secondary"
              style={{ fontSize: 12.5, marginTop: 2, lineHeight: 1.4 }}
            >
              {description}
            </div>
          )}
        </div>
      </div>
      <ToggleSwitch
        checked={on}
        disabled={disabled}
        color={color}
        aria-label={label}
        onChange={toggle}
      />
    </div>
  );
}
