import React, { useId } from 'react';
import { Search, X, AlertCircle, DollarSign } from 'lucide-react';

/**
 * Presentational form-field primitives matching the glass/block theme.
 * Every prop is optional with a sensible default so each component
 * renders correctly with zero props.
 */

// ---------------------------------------------------------------------------
// LabeledInput
// ---------------------------------------------------------------------------
export interface LabeledInputProps {
  label?: string;
  value?: string;
  placeholder?: string;
  hint?: string;
  error?: string;
  type?: string;
  disabled?: boolean;
  required?: boolean;
  onChange?: (value: string) => void;
  className?: string;
}

export function LabeledInput({
  label = 'Field label',
  value,
  placeholder = 'Enter a value…',
  hint = 'A short helper hint goes here.',
  error,
  type = 'text',
  disabled = false,
  required = false,
  onChange,
  className,
}: LabeledInputProps) {
  const id = useId();
  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label
        htmlFor={id}
        className="text-xs font-medium text-text-secondary"
        style={{ letterSpacing: 0.2 }}
      >
        {label}
        {required && <span style={{ color: 'var(--color-accent-expense)', marginLeft: 3 }}>*</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange?.(e.target.value)}
        className={`block-input${error ? ' is-invalid' : ''}`}
        style={{ borderRadius: 6, opacity: disabled ? 0.55 : 1 }}
      />
      {error ? (
        <span
          className="text-xs flex items-center gap-1"
          style={{ color: 'var(--color-accent-expense)' }}
        >
          <AlertCircle size={12} /> {error}
        </span>
      ) : (
        hint && <span className="text-xs text-text-muted">{hint}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AmountInput
// ---------------------------------------------------------------------------
export interface AmountInputProps {
  label?: string;
  value?: number | string;
  placeholder?: string;
  currencySymbol?: string;
  hint?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
  className?: string;
}

export function AmountInput({
  label = 'Amount',
  value = '',
  placeholder = '0.00',
  currencySymbol = '$',
  hint,
  disabled = false,
  onChange,
  className,
}: AmountInputProps) {
  const id = useId();
  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label && (
        <label htmlFor={id} className="text-xs font-medium text-text-secondary" style={{ letterSpacing: 0.2 }}>
          {label}
        </label>
      )}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <span
          className="text-text-muted"
          style={{
            position: 'absolute',
            left: 10,
            display: 'flex',
            alignItems: 'center',
            pointerEvents: 'none',
            fontFamily: 'ui-monospace, monospace',
            fontSize: 13,
          }}
        >
          {currencySymbol || <DollarSign size={14} />}
        </span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange?.(e.target.value)}
          className="block-input font-mono"
          style={{
            borderRadius: 6,
            paddingLeft: 26,
            textAlign: 'right',
            opacity: disabled ? 0.55 : 1,
          }}
        />
      </div>
      {hint && <span className="text-xs text-text-muted">{hint}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SearchBox
// ---------------------------------------------------------------------------
export interface SearchBoxProps {
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
  onClear?: () => void;
  className?: string;
}

export function SearchBox({
  value = '',
  placeholder = 'Search…',
  disabled = false,
  onChange,
  onClear,
  className,
}: SearchBoxProps) {
  return (
    <div
      className={className}
      style={{ position: 'relative', display: 'flex', alignItems: 'center', width: '100%' }}
    >
      <Search
        size={15}
        className="text-text-muted"
        style={{ position: 'absolute', left: 10, pointerEvents: 'none' }}
      />
      <input
        type="text"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange?.(e.target.value)}
        className="block-input"
        style={{
          borderRadius: 6,
          paddingLeft: 32,
          paddingRight: value ? 30 : 12,
          width: '100%',
          opacity: disabled ? 0.55 : 1,
        }}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onClear?.()}
          className="text-text-muted"
          style={{
            position: 'absolute',
            right: 8,
            display: 'flex',
            alignItems: 'center',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 2,
          }}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TextareaField
// ---------------------------------------------------------------------------
export interface TextareaFieldProps {
  label?: string;
  value?: string;
  placeholder?: string;
  hint?: string;
  rows?: number;
  maxLength?: number;
  disabled?: boolean;
  onChange?: (value: string) => void;
  className?: string;
}

export function TextareaField({
  label = 'Notes',
  value = '',
  placeholder = 'Add a note…',
  hint,
  rows = 4,
  maxLength,
  disabled = false,
  onChange,
  className,
}: TextareaFieldProps) {
  const id = useId();
  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label && (
        <label htmlFor={id} className="text-xs font-medium text-text-secondary" style={{ letterSpacing: 0.2 }}>
          {label}
        </label>
      )}
      <textarea
        id={id}
        rows={rows}
        value={value}
        disabled={disabled}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => onChange?.(e.target.value)}
        className="block-input"
        style={{ borderRadius: 6, resize: 'vertical', minHeight: 72, opacity: disabled ? 0.55 : 1 }}
      />
      <div className="flex items-center justify-between">
        {hint ? <span className="text-xs text-text-muted">{hint}</span> : <span />}
        {typeof maxLength === 'number' && (
          <span className="text-xs text-text-muted font-mono">
            {value.length}/{maxLength}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SelectField
// ---------------------------------------------------------------------------
export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectFieldProps {
  label?: string;
  value?: string;
  options?: SelectOption[];
  hint?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
  className?: string;
}

export function SelectField({
  label = 'Category',
  value,
  options = [
    { value: 'income', label: 'Income' },
    { value: 'expense', label: 'Expense' },
    { value: 'transfer', label: 'Transfer' },
  ],
  hint,
  disabled = false,
  onChange,
  className,
}: SelectFieldProps) {
  const id = useId();
  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {label && (
        <label htmlFor={id} className="text-xs font-medium text-text-secondary" style={{ letterSpacing: 0.2 }}>
          {label}
        </label>
      )}
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.value)}
        className="block-select"
        style={{ borderRadius: 'var(--app-radius)', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.55 : 1 }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {hint && <span className="text-xs text-text-muted">{hint}</span>}
    </div>
  );
}
