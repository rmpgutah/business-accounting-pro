import type { IndustryPreset } from './types';

const preset: IndustryPreset = {
  key: 'saas',
  label: 'Tech / SaaS',
  description: 'Subscription revenue, deferred revenue, MRR tracking, customer acquisition',
  icon: 'Cloud',
  coaTemplateKey: 'service',
  defaultCategories: [
    { name: 'Subscription Revenue', type: 'income', color: '#22c55e', tax_deductible: false, default_account_code: '4000' },
    { name: 'Setup / Onboarding Fees', type: 'income', color: '#16a34a', tax_deductible: false },
    { name: 'Professional Services', type: 'income', color: '#10b981', tax_deductible: false },
    { name: 'Deferred Revenue', type: 'income', color: '#84cc16', tax_deductible: false },
    { name: 'Hosting & Infrastructure', type: 'cogs', color: '#dc2626', tax_deductible: true },
    { name: 'Third-Party APIs', type: 'cogs', color: '#b91c1c', tax_deductible: true },
    { name: 'Customer Support', type: 'cogs', color: '#991b1b', tax_deductible: true },
    { name: 'Sales & Marketing', type: 'expense', color: '#f97316', tax_deductible: true },
    { name: 'R&D / Engineering', type: 'expense', color: '#8b5cf6', tax_deductible: true },
    { name: 'Customer Acquisition', type: 'expense', color: '#a855f7', tax_deductible: true },
  ],
  defaultVendors: [
    { name: 'AWS / Cloud Provider', type: 'infrastructure' },
    { name: 'Stripe / Payment Processor', type: 'service' },
    { name: 'Ad Platform', type: 'marketing' },
  ],
  invoiceSettings: {
    accent_color: '#6366f1',
    default_due_days: 30,
    default_terms_text: 'Subscription auto-renews. Cancel anytime per Master Service Agreement.',
    default_notes: 'Charge is for the upcoming subscription period.',
  },
  defaultDeductions: [
    { name: 'R&D Tax Credit', type: 'credit' },
    { name: 'Stock-Based Compensation', type: 'employee' },
  ],
  industrySpecificFields: [
    { entity_type: 'clients', key: 'mrr', label: 'MRR ($)', field_type: 'number' },
    { entity_type: 'clients', key: 'plan_tier', label: 'Plan Tier', field_type: 'select', options: ['Free', 'Starter', 'Pro', 'Enterprise'] },
    { entity_type: 'clients', key: 'churn_risk', label: 'Churn Risk', field_type: 'select', options: ['Low', 'Medium', 'High'] },
    { entity_type: 'invoices', key: 'subscription_period_start', label: 'Period Start', field_type: 'date' },
    { entity_type: 'invoices', key: 'subscription_period_end', label: 'Period End', field_type: 'date' },
  ],
  setupHints: [
    { key: 'mrr', title: 'Track MRR & ARR', description: 'Tag every subscription invoice so the dashboard can compute MRR, ARR, churn.' },
    { key: 'deferred', title: 'Recognize revenue ratably', description: 'Annual prepayments post to deferred revenue and amortize monthly.' },
  ],
  dashboardWidgets: [
    { key: 'mrr', label: 'MRR', type: 'kpi' },
    { key: 'arr', label: 'ARR', type: 'kpi' },
    { key: 'churn', label: 'Net Revenue Churn', type: 'kpi' },
    { key: 'cac', label: 'CAC', type: 'kpi' },
  ],
};

export default preset;
