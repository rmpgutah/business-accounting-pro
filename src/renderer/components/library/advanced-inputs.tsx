import React, { useState } from 'react';
import { X, Plus, Minus, Check } from 'lucide-react';

/* ------------------------------------------------------------------ */
/* TagInput — free-form tag entry field                                */
/* ------------------------------------------------------------------ */

export interface TagInputProps {
  label?: string;
  tags?: string[];
  placeholder?: string;
  accentColor?: string;
}

export function TagInput({
  label = 'Tags',
  tags = ['invoice', 'q2', 'priority'],
  placeholder = 'Add a tag and press Enter…',
  accentColor = 'var(--color-accent-blue, #3b82f6)',
}: TagInputProps) {
  const [items, setItems] = useState<string[]>(tags);
  const [draft, setDraft] = useState('');

  const add = () => {
    const v = draft.trim();
    if (v && !items.includes(v)) setItems((prev) => [...prev, v]);
    setDraft('');
  };
  const remove = (t: string) => setItems((prev) => prev.filter((x) => x !== t));

  return (
    <div>
      {label && (
        <div className="text-xs text-text-secondary mb-1.5">{label}</div>
      )}
      <div
        className="block-input flex flex-wrap items-center gap-1.5"
        style={{ minHeight: 40, padding: '6px 8px' }}
      >
        {items.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 text-xs font-medium"
            style={{
              padding: '2px 8px',
              borderRadius: 6,
              backgroundColor: 'color-mix(in srgb, ' + accentColor + ' 18%, transparent)',
              color: accentColor,
              border: '1px solid color-mix(in srgb, ' + accentColor + ' 35%, transparent)',
            }}
          >
            {t}
            <button
              type="button"
              onClick={() => remove(t)}
              className="hover:opacity-70"
              style={{ lineHeight: 0 }}
              aria-label={`Remove ${t}`}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            } else if (e.key === 'Backspace' && !draft && items.length) {
              remove(items[items.length - 1]);
            }
          }}
          placeholder={items.length ? '' : placeholder}
          className="flex-1 bg-transparent outline-none text-sm text-text-primary"
          style={{ minWidth: 80, border: 'none', padding: 0 }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* RangeSlider — single-thumb range slider                             */
/* ------------------------------------------------------------------ */

export interface RangeSliderProps {
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  value?: number;
  accentColor?: string;
  formatValue?: (v: number) => string;
}

export function RangeSlider({
  label = 'Budget',
  min = 0,
  max = 100,
  step = 1,
  value = 65,
  accentColor = 'var(--color-accent-blue, #3b82f6)',
  formatValue = (v) => String(v),
}: RangeSliderProps) {
  const [val, setVal] = useState(value);
  const pct = max > min ? ((val - min) / (max - min)) * 100 : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        {label && <span className="text-xs text-text-secondary">{label}</span>}
        <span className="text-sm font-mono text-text-primary">
          {formatValue(val)}
        </span>
      </div>
      <div style={{ position: 'relative', height: 18 }}>
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: 0,
            right: 0,
            height: 6,
            transform: 'translateY(-50%)',
            borderRadius: 6,
            backgroundColor: 'var(--color-bg-tertiary, #2e2e2e)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: 0,
            width: `${pct}%`,
            height: 6,
            transform: 'translateY(-50%)',
            borderRadius: 6,
            backgroundColor: accentColor,
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: `${pct}%`,
            width: 16,
            height: 16,
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
            backgroundColor: accentColor,
            border: '2px solid var(--color-bg-primary, #1a1a1a)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
            pointerEvents: 'none',
          }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={val}
          onChange={(e) => setVal(Number(e.target.value))}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            margin: 0,
            opacity: 0,
            cursor: 'pointer',
          }}
        />
      </div>
      <div className="flex justify-between mt-1 text-[10px] text-text-muted">
        <span>{formatValue(min)}</span>
        <span>{formatValue(max)}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stepper — numeric increment/decrement control                       */
/* ------------------------------------------------------------------ */

export interface StepperProps {
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  value?: number;
  suffix?: string;
}

export function Stepper({
  label = 'Quantity',
  min = 0,
  max = 99,
  step = 1,
  value = 3,
  suffix = '',
}: StepperProps) {
  const [val, setVal] = useState(value);
  const clamp = (n: number) => Math.max(min, Math.min(max, n));

  return (
    <div>
      {label && (
        <div className="text-xs text-text-secondary mb-1.5">{label}</div>
      )}
      <div className="inline-flex items-stretch" style={{ borderRadius: 6 }}>
        <button
          type="button"
          onClick={() => setVal((v) => clamp(v - step))}
          disabled={val <= min}
          className="block-btn"
          style={{
            width: 34,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 'var(--app-radius) 0 0 var(--app-radius)',
            opacity: val <= min ? 0.4 : 1,
          }}
          aria-label="Decrease"
        >
          <Minus size={14} />
        </button>
        <input
          value={`${val}${suffix}`}
          onChange={(e) => {
            const n = parseInt(e.target.value.replace(/[^\d-]/g, ''), 10);
            if (!Number.isNaN(n)) setVal(clamp(n));
          }}
          className="block-input text-center font-mono text-sm"
          style={{
            width: 64,
            borderRadius: 0,
            borderLeft: 'none',
            borderRight: 'none',
          }}
        />
        <button
          type="button"
          onClick={() => setVal((v) => clamp(v + step))}
          disabled={val >= max}
          className="block-btn"
          style={{
            width: 34,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '0 var(--app-radius) var(--app-radius) 0',
            opacity: val >= max ? 0.4 : 1,
          }}
          aria-label="Increase"
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* DateRangePresets — quick date-range preset chips                    */
/* ------------------------------------------------------------------ */

export interface DateRangePresetsProps {
  label?: string;
  presets?: string[];
  selected?: string;
  accentColor?: string;
}

export function DateRangePresets({
  label = 'Period',
  presets = ['Today', '7D', '30D', 'QTD', 'YTD', 'All'],
  selected = '30D',
  accentColor = 'var(--color-accent-blue, #3b82f6)',
}: DateRangePresetsProps) {
  const [active, setActive] = useState(selected);

  return (
    <div>
      {label && (
        <div className="text-xs text-text-secondary mb-1.5">{label}</div>
      )}
      <div className="inline-flex flex-wrap gap-1.5">
        {presets.map((p) => {
          const on = p === active;
          return (
            <button
              key={p}
              type="button"
              onClick={() => setActive(p)}
              className="text-xs font-medium transition-colors"
              style={{
                padding: '5px 12px',
                borderRadius: 6,
                backgroundColor: on
                  ? 'color-mix(in srgb, ' + accentColor + ' 20%, transparent)'
                  : 'var(--color-bg-secondary, #242424)',
                color: on ? accentColor : 'var(--color-text-secondary, #9ca3af)',
                border: on
                  ? '1px solid color-mix(in srgb, ' + accentColor + ' 45%, transparent)'
                  : '1px solid var(--color-border-primary, #3a3a3a)',
              }}
            >
              {p}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* MultiSelectChips — toggleable multi-select chip field               */
/* ------------------------------------------------------------------ */

export interface MultiSelectChipsProps {
  label?: string;
  options?: string[];
  selected?: string[];
  accentColor?: string;
}

export function MultiSelectChips({
  label = 'Categories',
  options = ['Revenue', 'Payroll', 'Marketing', 'Software', 'Travel', 'Utilities'],
  selected = ['Revenue', 'Software'],
  accentColor = 'var(--color-accent-income, #22c55e)',
}: MultiSelectChipsProps) {
  const [picked, setPicked] = useState<string[]>(selected);

  const toggle = (o: string) =>
    setPicked((prev) =>
      prev.includes(o) ? prev.filter((x) => x !== o) : [...prev, o]
    );

  return (
    <div>
      {label && (
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-text-secondary">{label}</span>
          <span className="text-[10px] text-text-muted">
            {picked.length} selected
          </span>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = picked.includes(o);
          return (
            <button
              key={o}
              type="button"
              onClick={() => toggle(o)}
              className="inline-flex items-center gap-1.5 text-xs font-medium transition-colors"
              style={{
                padding: '5px 10px',
                borderRadius: 6,
                backgroundColor: on
                  ? 'color-mix(in srgb, ' + accentColor + ' 18%, transparent)'
                  : 'var(--color-bg-secondary, #242424)',
                color: on ? accentColor : 'var(--color-text-secondary, #9ca3af)',
                border: on
                  ? '1px solid color-mix(in srgb, ' + accentColor + ' 40%, transparent)'
                  : '1px solid var(--color-border-primary, #3a3a3a)',
              }}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 4,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: on ? accentColor : 'transparent',
                  border: on
                    ? 'none'
                    : '1px solid var(--color-border-primary, #3a3a3a)',
                  color: 'var(--color-bg-primary, #1a1a1a)',
                }}
              >
                {on && <Check size={10} strokeWidth={3} />}
              </span>
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}
