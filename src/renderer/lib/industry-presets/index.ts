// Industry preset registry — aggregates all built-in presets and exposes
// helpers for the onboarding wizard and IndustryPresetSettings page.

import type { IndustryPreset } from './types';
import service from './service';
import retail from './retail';
import restaurant from './restaurant';
import construction from './construction';
import manufacturing from './manufacturing';
import healthcare from './healthcare';
import legal from './legal';
import realEstate from './real-estate';
import nonprofit from './nonprofit';
import saas from './saas';
import agency from './agency';
import freelancer from './freelancer';
import propertyManagement from './property-management';
import ecommerce from './ecommerce';
import education from './education';

export type { IndustryPreset } from './types';

export const INDUSTRY_PRESETS: IndustryPreset[] = [
  service,
  retail,
  restaurant,
  construction,
  manufacturing,
  healthcare,
  legal,
  realEstate,
  nonprofit,
  saas,
  agency,
  freelancer,
  propertyManagement,
  ecommerce,
  education,
];

export function getPreset(key: string): IndustryPreset | undefined {
  return INDUSTRY_PRESETS.find((p) => p.key === key);
}

// Diff a preset against existing data — returns what would be added vs skipped.
export interface PresetDiff {
  categoriesAdd: number;
  categoriesSkip: number;
  vendorsAdd: number;
  vendorsSkip: number;
  fieldsAdd: number;
  fieldsSkip: number;
  accountsAdd: number;
  accountsSkip: number;
}

export function diffPreset(
  preset: IndustryPreset,
  existing: {
    categoryNames: Set<string>;
    vendorNames: Set<string>;
    fieldKeys: Set<string>; // entity_type:key
    accountCodes: Set<string>;
  },
  coaAccountCodes: string[],
): PresetDiff {
  let categoriesAdd = 0, categoriesSkip = 0;
  for (const c of preset.defaultCategories) {
    if (existing.categoryNames.has(c.name.toLowerCase())) categoriesSkip++;
    else categoriesAdd++;
  }
  let vendorsAdd = 0, vendorsSkip = 0;
  for (const v of preset.defaultVendors) {
    if (existing.vendorNames.has(v.name.toLowerCase())) vendorsSkip++;
    else vendorsAdd++;
  }
  let fieldsAdd = 0, fieldsSkip = 0;
  for (const f of preset.industrySpecificFields) {
    const k = `${f.entity_type}:${f.key}`;
    if (existing.fieldKeys.has(k)) fieldsSkip++;
    else fieldsAdd++;
  }
  let accountsAdd = 0, accountsSkip = 0;
  for (const code of coaAccountCodes) {
    if (existing.accountCodes.has(code)) accountsSkip++;
    else accountsAdd++;
  }
  return { categoriesAdd, categoriesSkip, vendorsAdd, vendorsSkip, fieldsAdd, fieldsSkip, accountsAdd, accountsSkip };
}

// Export a preset to JSON (for import/export feature).
export function exportPresetJson(preset: IndustryPreset): string {
  return JSON.stringify(preset, null, 2);
}

// Validate JSON-shaped preset.
export function parsePresetJson(json: string): { ok: true; preset: IndustryPreset } | { ok: false; error: string } {
  try {
    const obj = JSON.parse(json);
    const required = ['key', 'label', 'description', 'icon', 'coaTemplateKey'];
    for (const r of required) {
      if (typeof obj[r] !== 'string') return { ok: false, error: `Missing field: ${r}` };
    }
    obj.defaultCategories ??= [];
    obj.defaultVendors ??= [];
    obj.invoiceSettings ??= {};
    obj.defaultDeductions ??= [];
    obj.industrySpecificFields ??= [];
    obj.setupHints ??= [];
    return { ok: true, preset: obj as IndustryPreset };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Invalid JSON' };
  }
}
