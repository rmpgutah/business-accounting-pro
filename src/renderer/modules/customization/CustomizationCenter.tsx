// src/renderer/modules/customization/CustomizationCenter.tsx
//
// Generic UI for the data-driven customization system: pick a section, search
// and toggle/edit any of its options. Every control is bound to the persisted
// customizationStore (keyed by `${section}.${id}`), falling back to the
// descriptor default.

import React, { useMemo, useState } from 'react';
import { Search, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { SECTIONS, TOTAL_OPTIONS, optionKey } from '../../customization/registry';
import { CustomizationOption } from '../../customization/types';
import { useCustomizationStore } from '../../stores/customizationStore';

function Control({ opt }: { opt: CustomizationOption }) {
  const key = optionKey(opt.section, opt.id);
  const value = useCustomizationStore((s) => s.get(key));
  const setValue = useCustomizationStore((s) => s.set);

  if (opt.type === 'toggle') {
    const on = Boolean(value);
    return (
      <button
        type="button"
        onClick={() => setValue(key, !on)}
        className="relative inline-flex items-center"
        style={{
          width: 38,
          height: 22,
          borderRadius: 6,
          background: on ? 'var(--color-accent-blue)' : 'var(--color-bg-tertiary)',
          border: '1px solid var(--color-border-primary)',
          transition: 'background 0.15s',
          cursor: 'pointer',
        }}
        aria-pressed={on}
        aria-label={opt.label}
        title={opt.id}
      >
        <span
          style={{
            position: 'absolute',
            left: on ? 18 : 2,
            width: 16,
            height: 16,
            borderRadius: 4,
            background: '#fff',
            transition: 'left 0.15s',
          }}
        />
      </button>
    );
  }
  if (opt.type === 'select') {
    return (
      <select
        className="block-input text-xs"
        value={String(value ?? opt.default)}
        onChange={(e) => setValue(key, e.target.value)}
        style={{ maxWidth: 180 }}
      >
        {(opt.options || []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  if (opt.type === 'number') {
    // Clamp to descriptor min/max on commit so invalid values can't sneak in
    // via keyboard or paste. The intermediate edit state is allowed (browser
    // accepts the typed digits) — clamping happens on the resolved number.
    const commit = (raw: string) => {
      let n = Number(raw);
      if (!Number.isFinite(n)) n = Number(opt.default);
      if (typeof opt.min === 'number' && n < opt.min) n = opt.min;
      if (typeof opt.max === 'number' && n > opt.max) n = opt.max;
      setValue(key, n);
    };
    return (
      <input
        type="number"
        className="block-input text-xs"
        value={Number(value ?? opt.default)}
        min={opt.min}
        max={opt.max}
        step={opt.step}
        onChange={(e) => commit(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        style={{ maxWidth: 100 }}
      />
    );
  }
  if (opt.type === 'color') {
    // Guard against undefined — controlled <input type="color"> must have a
    // valid 7-char hex string at all times to avoid React's controlled/
    // uncontrolled warning.
    const v = typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
      ? value
      : String(opt.default);
    return (
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={v}
          onChange={(e) => setValue(key, e.target.value)}
          style={{ width: 34, height: 26, borderRadius: 6, background: 'transparent', border: 'none', cursor: 'pointer' }}
          aria-label={opt.label}
        />
        <span className="text-[10px] font-mono text-text-muted">{v}</span>
      </div>
    );
  }
  return (
    <input
      type="text"
      className="block-input text-xs"
      value={String(value ?? opt.default ?? '')}
      onChange={(e) => setValue(key, e.target.value)}
      style={{ maxWidth: 180 }}
    />
  );
}

// "Edited" pill — surfaces which rows have been overridden from default.
function EditedPill({ onReset }: { onReset: () => void }) {
  return (
    <button
      type="button"
      onClick={onReset}
      className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5"
      style={{
        borderRadius: 4,
        background: 'rgba(96,165,250,0.12)',
        color: 'var(--color-accent-blue)',
        border: '1px solid rgba(96,165,250,0.25)',
        cursor: 'pointer',
      }}
      title="Edited — click to reset this option"
    >
      Edited ↺
    </button>
  );
}

export default function CustomizationCenter() {
  const [activeSection, setActiveSection] = useState(SECTIONS[0]?.section ?? '');
  const [query, setQuery] = useState('');
  const resetSection = useCustomizationStore((s) => s.resetSection);
  const resetOne = useCustomizationStore((s) => s.reset);
  const overrides = useCustomizationStore((s) => s.values);
  const overrideCount = Object.keys(overrides).length;

  // Per-section override counts for the rail badge — computed once per
  // overrides change rather than per render.
  const sectionOverrideCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const k of Object.keys(overrides)) {
      const dot = k.indexOf('.');
      if (dot < 0) continue;
      const sec = k.slice(0, dot);
      m[sec] = (m[sec] || 0) + 1;
    }
    return m;
  }, [overrides]);

  const resetAll = () => {
    if (!overrideCount) return;
    if (!confirm(`Reset all ${overrideCount} customized option${overrideCount === 1 ? '' : 's'} back to defaults?`)) return;
    useCustomizationStore.setState({ values: {} });
  };

  const section = useMemo(
    () => SECTIONS.find((s) => s.section === activeSection) ?? SECTIONS[0],
    [activeSection]
  );

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const opts = section.options.filter(
      (o) => !q || o.label.toLowerCase().includes(q) || o.group.toLowerCase().includes(q) || o.id.includes(q)
    );
    const map = new Map<string, CustomizationOption[]>();
    for (const o of opts) {
      if (!map.has(o.group)) map.set(o.group, []);
      map.get(o.group)!.push(o);
    }
    return Array.from(map.entries());
  }, [section, query]);

  const shown = grouped.reduce((n, [, items]) => n + items.length, 0);

  return (
    <div className="flex h-full">
      {/* Section rail */}
      <aside
        className="w-56 shrink-0 overflow-y-auto p-3 space-y-1"
        style={{ borderRight: '1px solid var(--color-border-primary)' }}
      >
        <div className="flex items-center gap-2 px-2 py-3">
          <SlidersHorizontal size={16} className="text-accent-blue" />
          <span className="text-sm font-bold text-text-primary">Customization</span>
        </div>
        {SECTIONS.map((s) => (
          <button
            key={s.section}
            onClick={() => setActiveSection(s.section)}
            className="w-full text-left px-3 py-2 text-sm flex items-center justify-between"
            style={{
              borderRadius: 6,
              background: s.section === activeSection ? 'var(--color-bg-tertiary)' : 'transparent',
              color: s.section === activeSection ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
            }}
          >
            <span className="truncate">{s.label}</span>
            <span className="flex items-center gap-1.5 ml-2">
              {sectionOverrideCounts[s.section] ? (
                <span
                  className="text-[9px] font-bold px-1 py-0.5"
                  style={{
                    borderRadius: 4,
                    background: 'rgba(96,165,250,0.15)',
                    color: 'var(--color-accent-blue)',
                  }}
                  title={`${sectionOverrideCounts[s.section]} customized in this section`}
                >
                  {sectionOverrideCounts[s.section]}
                </span>
              ) : null}
              <span className="text-[10px] text-text-muted">{s.options.length}</span>
            </span>
          </button>
        ))}
      </aside>

      {/* Options panel */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-text-primary">{section.label}</h1>
            <p className="text-sm text-text-muted">
              {shown} of {section.options.length} options
              {query ? ` matching “${query}”` : ''} · {TOTAL_OPTIONS.toLocaleString()} total across {SECTIONS.length} sections · {overrideCount} customized
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                className="block-input pl-9 text-sm"
                placeholder="Search options…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ minWidth: 220 }}
              />
            </div>
            <button
              className="block-btn text-xs flex items-center gap-1.5"
              onClick={() => resetSection(section.section)}
              disabled={!sectionOverrideCounts[section.section]}
              title="Reset this section to defaults"
              style={{ opacity: sectionOverrideCounts[section.section] ? 1 : 0.45 }}
            >
              <RotateCcw size={12} /> Reset section
            </button>
            <button
              className="block-btn text-xs flex items-center gap-1.5"
              onClick={resetAll}
              disabled={!overrideCount}
              title="Reset every customized option across all sections"
              style={{ opacity: overrideCount ? 1 : 0.45 }}
            >
              <RotateCcw size={12} /> Reset all
            </button>
          </div>
        </div>

        {grouped.map(([group, items]) => (
          <section key={group} className="space-y-2">
            <h2
              className="text-xs font-semibold uppercase tracking-wider text-text-muted pb-1"
              style={{ borderBottom: '1px solid var(--color-border-primary)' }}
            >
              {group} <span className="text-text-muted">({items.length})</span>
            </h2>
            <div className="space-y-1">
              {items.map((opt) => {
                const k = optionKey(opt.section, opt.id);
                const isEdited = Object.prototype.hasOwnProperty.call(overrides, k);
                return (
                  <div
                    key={opt.id}
                    className="flex items-center justify-between gap-4 px-3 py-2"
                    style={{
                      borderRadius: 6,
                      background: isEdited ? 'rgba(96,165,250,0.04)' : 'transparent',
                    }}
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <div className="min-w-0">
                        <div className="text-sm text-text-primary truncate flex items-center gap-2">
                          {opt.label}
                          {isEdited && <EditedPill onReset={() => resetOne(k)} />}
                        </div>
                        {opt.description && (
                          <div className="text-xs text-text-muted truncate">{opt.description}</div>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0">
                      <Control opt={opt} />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
