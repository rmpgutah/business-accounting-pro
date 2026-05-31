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
        onClick={() => setValue(key, !on)}
        className="relative inline-flex items-center"
        style={{
          width: 38,
          height: 22,
          borderRadius: 6,
          background: on ? 'var(--color-accent-blue)' : 'var(--color-bg-tertiary)',
          border: '1px solid var(--color-border-primary)',
          transition: 'background 0.15s',
        }}
        aria-pressed={on}
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
        value={String(value)}
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
    return (
      <input
        type="number"
        className="block-input text-xs"
        value={Number(value)}
        min={opt.min}
        max={opt.max}
        step={opt.step}
        onChange={(e) => setValue(key, Number(e.target.value))}
        style={{ maxWidth: 100 }}
      />
    );
  }
  if (opt.type === 'color') {
    return (
      <input
        type="color"
        value={String(value)}
        onChange={(e) => setValue(key, e.target.value)}
        style={{ width: 34, height: 26, borderRadius: 6, background: 'transparent', border: 'none' }}
      />
    );
  }
  return (
    <input
      type="text"
      className="block-input text-xs"
      value={String(value ?? '')}
      onChange={(e) => setValue(key, e.target.value)}
      style={{ maxWidth: 180 }}
    />
  );
}

export default function CustomizationCenter() {
  const [activeSection, setActiveSection] = useState(SECTIONS[0]?.section ?? '');
  const [query, setQuery] = useState('');
  const resetSection = useCustomizationStore((s) => s.resetSection);
  const overrideCount = useCustomizationStore((s) => Object.keys(s.values).length);

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
            <span className="text-[10px] text-text-muted ml-2">{s.options.length}</span>
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
              title="Reset this section to defaults"
            >
              <RotateCcw size={12} /> Reset section
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
              {items.map((opt) => (
                <div
                  key={opt.id}
                  className="flex items-center justify-between gap-4 px-3 py-2"
                  style={{ borderRadius: 6 }}
                >
                  <div className="min-w-0">
                    <div className="text-sm text-text-primary truncate">{opt.label}</div>
                    {opt.description && (
                      <div className="text-xs text-text-muted truncate">{opt.description}</div>
                    )}
                  </div>
                  <div className="shrink-0">
                    <Control opt={opt} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
