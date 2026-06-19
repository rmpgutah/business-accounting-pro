import type { IndustryPreset } from './types';

const preset: IndustryPreset = {
  key: 'legal',
  label: 'Legal',
  description: 'Trust accounts (IOLTA), retainer billing, hourly + flat-fee, billable activity',
  icon: 'Scale',
  coaTemplateKey: 'service',
  defaultCategories: [
    { name: 'Hourly Fees Earned', type: 'income', color: '#22c55e', tax_deductible: false },
    { name: 'Flat Fee Earned', type: 'income', color: '#16a34a', tax_deductible: false },
    { name: 'Contingency Fees', type: 'income', color: '#10b981', tax_deductible: false },
    { name: 'Reimbursable Costs', type: 'income', color: '#84cc16', tax_deductible: false },
    { name: 'IOLTA Trust Liability', type: 'expense', color: '#06b6d4', tax_deductible: false },
    { name: 'Filing Fees', type: 'expense', color: '#f97316', tax_deductible: true },
    { name: 'Court Costs', type: 'expense', color: '#ea580c', tax_deductible: true },
    { name: 'Expert Witness Fees', type: 'expense', color: '#f59e0b', tax_deductible: true },
    { name: 'Bar Dues', type: 'expense', color: '#8b5cf6', tax_deductible: true },
    { name: 'Malpractice Insurance', type: 'expense', color: '#a855f7', tax_deductible: true },
    { name: 'Legal Research Subscriptions', type: 'expense', color: '#6366f1', tax_deductible: true },
  ],
  defaultVendors: [
    { name: 'Westlaw / LexisNexis', type: 'subscription' },
    { name: 'Court Reporter Service', type: 'service' },
    { name: 'Process Server', type: 'service' },
  ],
  invoiceSettings: {
    accent_color: '#7c3aed',
    default_due_days: 30,
    default_terms_text: 'Trust funds applied as earned per engagement letter. Net 30 on unpaid balances.',
    default_notes: 'Detailed time entries available upon request.',
  },
  defaultDeductions: [
    { name: 'Bar Dues', type: 'professional' },
    { name: 'CLE Education', type: 'professional' },
  ],
  industrySpecificFields: [
    { entity_type: 'clients', key: 'matter_number', label: 'Matter #', field_type: 'text' },
    { entity_type: 'clients', key: 'engagement_type', label: 'Engagement Type', field_type: 'select', options: ['Hourly', 'Flat Fee', 'Contingency', 'Retainer'] },
    { entity_type: 'clients', key: 'iolta_balance', label: 'IOLTA Balance', field_type: 'number' },
    { entity_type: 'time_entries', key: 'activity_code', label: 'Activity Code', field_type: 'text' },
  ],
  setupHints: [
    { key: 'iolta', title: 'Open IOLTA trust account', description: 'Create a separate bank account for client trust funds. Never commingle.' },
    { key: 'matter', title: 'Define matters per client', description: 'Each matter is a project — track time and costs per matter for accurate billing.' },
  ],
  dashboardWidgets: [
    { key: 'iolta_balance', label: 'IOLTA Balance', type: 'kpi' },
    { key: 'realization_rate', label: 'Realization Rate %', type: 'kpi' },
  ],
};

export default preset;
