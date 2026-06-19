import type { IndustryPreset } from './types';

const preset: IndustryPreset = {
  key: 'agency',
  label: 'Agency / Marketing',
  description: 'Retainers, project-based + hourly mix, media buying pass-through',
  icon: 'Megaphone',
  coaTemplateKey: 'service',
  defaultCategories: [
    { name: 'Retainer Revenue', type: 'income', color: '#22c55e', tax_deductible: false },
    { name: 'Project Fees', type: 'income', color: '#16a34a', tax_deductible: false },
    { name: 'Hourly Billing', type: 'income', color: '#10b981', tax_deductible: false },
    { name: 'Media Buying (Pass-through)', type: 'income', color: '#84cc16', tax_deductible: false },
    { name: 'Ad Spend (Client)', type: 'cogs', color: '#dc2626', tax_deductible: true },
    { name: 'Freelancers & Contractors', type: 'cogs', color: '#b91c1c', tax_deductible: true },
    { name: 'Stock Assets / Licenses', type: 'expense', color: '#f97316', tax_deductible: true },
    { name: 'Software & Tools', type: 'expense', color: '#6366f1', tax_deductible: true },
    { name: 'Professional Development', type: 'expense', color: '#8b5cf6', tax_deductible: true },
  ],
  defaultVendors: [
    { name: 'Google / Meta Ads', type: 'media' },
    { name: 'Freelance Designer', type: 'contractor' },
    { name: 'Stock Image Service', type: 'subscription' },
  ],
  invoiceSettings: {
    accent_color: '#ec4899',
    default_due_days: 15,
    default_terms_text: 'Net 15. Media buys billed at cost + 15% management fee unless agreed otherwise.',
  },
  defaultDeductions: [
    { name: 'Subcontractor 1099', type: 'business' },
  ],
  industrySpecificFields: [
    { entity_type: 'projects', key: 'campaign_type', label: 'Campaign Type', field_type: 'select', options: ['Brand', 'Performance', 'Content', 'PR', 'SEO'] },
    { entity_type: 'projects', key: 'media_budget', label: 'Media Budget', field_type: 'number' },
    { entity_type: 'invoices', key: 'pass_through_amount', label: 'Pass-through Amount', field_type: 'number' },
  ],
  setupHints: [
    { key: 'retainer', title: 'Set up retainer billing', description: 'Recurring monthly invoices for retainer clients with hour bank tracking.' },
    { key: 'media-passthrough', title: 'Configure media pass-through', description: 'Track ad spend separately so it flows through with the right markup.' },
  ],
  dashboardWidgets: [
    { key: 'retainer_mrr', label: 'Retainer MRR', type: 'kpi' },
    { key: 'utilization', label: 'Team Utilization', type: 'kpi' },
  ],
};

export default preset;
