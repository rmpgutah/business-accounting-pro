import type { IndustryPreset } from './types';

const preset: IndustryPreset = {
  key: 'freelancer',
  label: 'Freelancer / Solo',
  description: 'Simplified setup, single bank account, minimal CoA',
  icon: 'User',
  coaTemplateKey: 'service',
  defaultCategories: [
    { name: 'Freelance Income', type: 'income', color: '#22c55e', tax_deductible: false, default_account_code: '4000' },
    { name: 'Contract Work', type: 'income', color: '#16a34a', tax_deductible: false },
    { name: 'Software & Subscriptions', type: 'expense', color: '#6366f1', tax_deductible: true },
    { name: 'Home Office', type: 'expense', color: '#f59e0b', tax_deductible: true },
    { name: 'Equipment', type: 'expense', color: '#0ea5e9', tax_deductible: true },
    { name: 'Internet & Phone', type: 'expense', color: '#8b5cf6', tax_deductible: true },
    { name: 'Professional Services', type: 'expense', color: '#a855f7', tax_deductible: true },
  ],
  defaultVendors: [
    { name: 'Software Subscriptions', type: 'subscription' },
  ],
  invoiceSettings: {
    accent_color: '#0ea5e9',
    default_due_days: 14,
    default_terms_text: 'Net 14. Thanks for your business!',
    default_notes: 'Please reference invoice number with payment.',
  },
  defaultDeductions: [
    { name: 'Home Office', type: 'business' },
    { name: 'Self-Employment Tax', type: 'tax' },
    { name: 'Health Insurance Premium', type: 'business' },
    { name: 'SEP-IRA Contribution', type: 'retirement' },
  ],
  industrySpecificFields: [
    { entity_type: 'clients', key: 'preferred_contact', label: 'Preferred Contact', field_type: 'select', options: ['Email', 'Phone', 'Slack'] },
  ],
  setupHints: [
    { key: 'estimated-tax', title: 'Plan for quarterly estimated taxes', description: 'Set aside ~25-30% of income for federal + SE tax.' },
    { key: 'separate-account', title: 'Separate business account', description: 'Use one dedicated bank account to keep books clean.' },
  ],
  dashboardWidgets: [
    { key: 'ytd_income', label: 'YTD Income', type: 'kpi' },
    { key: 'tax_set_aside', label: 'Tax Reserve', type: 'kpi' },
  ],
};

export default preset;
