import type { IndustryPreset } from './types';

const preset: IndustryPreset = {
  key: 'real-estate',
  label: 'Real Estate',
  description: 'Property accounts, commission splits, escrow',
  icon: 'Home',
  coaTemplateKey: 'service',
  defaultCategories: [
    { name: 'Commission Income', type: 'income', color: '#22c55e', tax_deductible: false },
    { name: 'Referral Income', type: 'income', color: '#16a34a', tax_deductible: false },
    { name: 'Listing Fees', type: 'income', color: '#10b981', tax_deductible: false },
    { name: 'Commission Splits Paid', type: 'expense', color: '#dc2626', tax_deductible: true },
    { name: 'Brokerage Fees', type: 'expense', color: '#b91c1c', tax_deductible: true },
    { name: 'MLS Fees', type: 'expense', color: '#f97316', tax_deductible: true },
    { name: 'Marketing & Signage', type: 'expense', color: '#f59e0b', tax_deductible: true },
    { name: 'Vehicle / Mileage', type: 'expense', color: '#8b5cf6', tax_deductible: true },
    { name: 'E&O Insurance', type: 'expense', color: '#06b6d4', tax_deductible: true },
    { name: 'Escrow Liability', type: 'expense', color: '#a855f7', tax_deductible: false },
  ],
  defaultVendors: [
    { name: 'MLS Service', type: 'subscription' },
    { name: 'Title Company', type: 'service' },
    { name: 'Photographer / Drone', type: 'service' },
  ],
  invoiceSettings: {
    accent_color: '#0891b2',
    default_due_days: 0,
    default_terms_text: 'Commission due at closing per listing agreement.',
  },
  defaultDeductions: [
    { name: 'Vehicle Mileage', type: 'business' },
    { name: 'Home Office', type: 'business' },
  ],
  industrySpecificFields: [
    { entity_type: 'projects', key: 'property_address', label: 'Property Address', field_type: 'text' },
    { entity_type: 'projects', key: 'mls_number', label: 'MLS #', field_type: 'text' },
    { entity_type: 'projects', key: 'list_price', label: 'List Price', field_type: 'number' },
    { entity_type: 'projects', key: 'commission_split', label: 'Commission Split %', field_type: 'number' },
  ],
  setupHints: [
    { key: 'splits', title: 'Define commission splits', description: 'Set default broker / agent split percentages so paychecks calculate automatically.' },
    { key: 'escrow', title: 'Track earnest money / escrow', description: 'Use the escrow liability category for funds held on behalf of buyers.' },
  ],
  dashboardWidgets: [
    { key: 'closings_this_month', label: 'Closings (MTD)', type: 'kpi' },
    { key: 'pipeline_value', label: 'Pipeline Value', type: 'kpi' },
  ],
};

export default preset;
