// src/renderer/customization/types.ts
//
// Shared types for the data-driven customization system. Each section
// contributes a file under ./sections/<section>.ts exporting a
// `customizations: CustomizationOption[]` array. A generic Customization
// Center renders these, and a persisted preferences store holds the values
// keyed by `${section}.${id}`.

export type CustomizationType = 'toggle' | 'select' | 'number' | 'text' | 'color';

export interface CustomizationOption {
  /** Unique within the section. kebab-case. */
  id: string;
  /** Section/module id this belongs to (e.g. 'invoicing'). */
  section: string;
  /** Grouping label for the UI (e.g. 'Display', 'Columns', 'Formatting'). */
  group: string;
  /** Human label shown next to the control. */
  label: string;
  /** Optional helper text. */
  description?: string;
  /** Control type. */
  type: CustomizationType;
  /** Default value; type depends on `type`. */
  default: boolean | string | number;
  /** For type 'select': the choices. */
  options?: Array<{ value: string; label: string }>;
  /** For type 'number': bounds/step. */
  min?: number;
  max?: number;
  step?: number;
}

export interface SectionCustomizations {
  section: string;
  label: string;
  options: CustomizationOption[];
}
