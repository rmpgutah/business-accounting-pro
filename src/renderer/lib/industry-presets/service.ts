import type { IndustryPreset } from './types';

const preset: IndustryPreset = {
  key: 'service',
  label: 'Service / Consulting',
  description: 'Hourly billing, Net 30, project-based engagements',
  icon: 'Briefcase',
  coaTemplateKey: 'service',
  defaultCategories: [
    { name: 'Consulting Revenue', type: 'income', color: '#22c55e', tax_deductible: false, default_account_code: '4100' },
    { name: 'Retainer Revenue', type: 'income', color: '#16a34a', tax_deductible: false, default_account_code: '4000' },
    { name: 'Subcontractor Fees', type: 'expense', color: '#ef4444', tax_deductible: true, default_account_code: '6200' },
    { name: 'Software & Subscriptions', type: 'expense', color: '#6366f1', tax_deductible: true, default_account_code: '6700' },
    { name: 'Professional Development', type: 'expense', color: '#f59e0b', tax_deductible: true },
    { name: 'Travel & Meals', type: 'expense', color: '#06b6d4', tax_deductible: true, default_account_code: '6800' },
    { name: 'Client Entertainment', type: 'expense', color: '#a855f7', tax_deductible: true },
  ],
  defaultVendors: [
    { name: 'Cloud Infrastructure', type: 'service' },
    { name: 'Coworking Space', type: 'service' },
  ],
  invoiceSettings: {
    accent_color: '#2563eb',
    default_due_days: 30,
    default_notes: 'Thank you for your business.',
    default_terms_text: 'Payment due within 30 days. 1.5% late fee on overdue balances.',
  },
  defaultDeductions: [
    { name: 'Home Office', type: 'business' },
    { name: 'Professional Liability Insurance', type: 'insurance' },
  ],
  industrySpecificFields: [
    { entity_type: 'projects', key: 'engagement_type', label: 'Engagement Type', field_type: 'select', options: ['Hourly', 'Fixed Fee', 'Retainer'] },
    { entity_type: 'invoices', key: 'billable_hours', label: 'Billable Hours', field_type: 'number' },
  ],
  setupHints: [
    { key: 'time-tracking', title: 'Set up time tracking', description: 'Track billable hours per client and project to feed your invoices.' },
    { key: 'rate-card', title: 'Define your rate card', description: 'Add hourly rates per project so estimates and invoices auto-fill.' },
  ],
  dashboardWidgets: [
    { key: 'utilization', label: 'Utilization %', type: 'kpi' },
    { key: 'avg_rate', label: 'Avg Hourly Rate', type: 'kpi' },
  ],
};

export default preset;
