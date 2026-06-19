// Industry Preset type definitions
// A preset is a pure-data bundle that primes a new company with industry-relevant
// categories, vendors, custom fields, deductions, invoice defaults, and setup hints.

export type CategoryType = 'income' | 'expense' | 'cogs';
export type FieldType = 'text' | 'number' | 'date' | 'select' | 'boolean';

export interface PresetCategory {
  name: string;
  type: CategoryType;
  color: string;
  tax_deductible: boolean;
  default_account_code?: string;
  description?: string;
  icon?: string;
}

export interface PresetVendor {
  name: string;
  type: string;
  notes?: string;
}

export interface PresetInvoiceSettings {
  accent_color?: string;
  template_style?: string;
  footer_text?: string;
  default_notes?: string;
  default_terms_text?: string;
  default_due_days?: number;
}

export interface PresetDeduction {
  name: string;
  type: string;
  description?: string;
}

export interface PresetCustomField {
  entity_type: string;
  key: string;
  label: string;
  field_type: FieldType;
  options?: string[];
}

export interface PresetSetupHint {
  key: string;
  title: string;
  description: string;
}

export interface PresetDashboardWidget {
  key: string;
  label: string;
  type: 'kpi' | 'chart' | 'list';
}

export interface IndustryPreset {
  key: string;
  label: string;
  description: string;
  icon: string;
  coaTemplateKey: string;
  defaultCategories: PresetCategory[];
  defaultVendors: PresetVendor[];
  invoiceSettings: PresetInvoiceSettings;
  defaultDeductions: PresetDeduction[];
  industrySpecificFields: PresetCustomField[];
  setupHints: PresetSetupHint[];
  dashboardWidgets?: PresetDashboardWidget[];
}
