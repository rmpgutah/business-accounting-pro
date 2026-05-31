// src/renderer/stores/customizationStore.ts
//
// Persisted per-section customization preferences. Values are keyed by
// `${section}.${id}` (see registry.optionKey). Only values that differ from
// their descriptor default are stored, so the footprint stays small even with
// thousands of available options. Reads fall back to the descriptor default.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ALL_OPTIONS, optionKey } from '../customization/registry';

type Value = boolean | string | number;

// Default lookup built once from the descriptor registry.
const DEFAULTS: Record<string, Value> = (() => {
  const m: Record<string, Value> = {};
  for (const o of ALL_OPTIONS) m[optionKey(o.section, o.id)] = o.default;
  return m;
})();

interface CustomizationState {
  /** Only overrides (value !== default) are kept here. */
  values: Record<string, Value>;
  /** Get the effective value for a key (override or descriptor default). */
  get: (key: string) => Value | undefined;
  /** Set a value; clears the override when it equals the default. */
  set: (key: string, value: Value) => void;
  /** Reset one key to its default. */
  reset: (key: string) => void;
  /** Reset every key in a section to defaults. */
  resetSection: (section: string) => void;
  /** Count of active (non-default) overrides. */
  overrideCount: () => number;
}

export const useCustomizationStore = create<CustomizationState>()(
  persist(
    (set, get) => ({
      values: {},
      get: (key) => {
        const v = get().values[key];
        return v !== undefined ? v : DEFAULTS[key];
      },
      set: (key, value) =>
        set((state) => {
          const next = { ...state.values };
          if (value === DEFAULTS[key]) {
            delete next[key]; // back to default → drop the override
          } else {
            next[key] = value;
          }
          return { values: next };
        }),
      reset: (key) =>
        set((state) => {
          const next = { ...state.values };
          delete next[key];
          return { values: next };
        }),
      resetSection: (section) =>
        set((state) => {
          const prefix = `${section}.`;
          const next: Record<string, Value> = {};
          for (const [k, v] of Object.entries(state.values)) {
            if (!k.startsWith(prefix)) next[k] = v;
          }
          return { values: next };
        }),
      overrideCount: () => Object.keys(get().values).length,
    }),
    { name: 'customization-preferences' }
  )
);

/** Non-hook accessor for use outside React (e.g. formatters, services). */
export function getCustomization(section: string, id: string): Value | undefined {
  return useCustomizationStore.getState().get(optionKey(section, id));
}
