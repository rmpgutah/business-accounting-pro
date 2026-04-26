import type { IndustryPreset } from './types';

const preset: IndustryPreset = {
  key: 'nonprofit',
  label: 'Nonprofit',
  description: '501(c)(3) restricted funds, grants, donor categories, Form 990 mappings',
  icon: 'HeartHandshake',
  coaTemplateKey: 'nonprofit',
  defaultCategories: [
    { name: 'Unrestricted Contributions', type: 'income', color: '#22c55e', tax_deductible: false, default_account_code: '4000' },
    { name: 'Restricted Contributions', type: 'income', color: '#16a34a', tax_deductible: false, default_account_code: '4100' },
    { name: 'Grant Revenue', type: 'income', color: '#10b981', tax_deductible: false, default_account_code: '4200' },
    { name: 'Membership Dues', type: 'income', color: '#84cc16', tax_deductible: false, default_account_code: '4500' },
    { name: 'Fundraising Income', type: 'income', color: '#a3e635', tax_deductible: false, default_account_code: '4400' },
    { name: 'Program Services', type: 'expense', color: '#dc2626', tax_deductible: true, default_account_code: '6000' },
    { name: 'Management & General', type: 'expense', color: '#b91c1c', tax_deductible: true, default_account_code: '6200' },
    { name: 'Fundraising Expense', type: 'expense', color: '#991b1b', tax_deductible: true, default_account_code: '6100' },
    { name: 'Grants Awarded', type: 'expense', color: '#f97316', tax_deductible: true, default_account_code: '6300' },
  ],
  defaultVendors: [
    { name: 'Grant Funder', type: 'donor' },
    { name: 'Major Donor', type: 'donor' },
    { name: 'Donation Platform', type: 'service' },
  ],
  invoiceSettings: {
    accent_color: '#16a34a',
    default_due_days: 30,
    default_terms_text: 'Tax-deductible contribution. EIN provided on request.',
    default_notes: 'Thank you for your generous support.',
  },
  defaultDeductions: [
    { name: 'Designated Restricted Funds', type: 'restricted' },
  ],
  industrySpecificFields: [
    { entity_type: 'clients', key: 'donor_type', label: 'Donor Type', field_type: 'select', options: ['Individual', 'Corporate', 'Foundation', 'Government'] },
    { entity_type: 'projects', key: 'grant_number', label: 'Grant #', field_type: 'text' },
    { entity_type: 'projects', key: 'restriction_type', label: 'Restriction', field_type: 'select', options: ['Unrestricted', 'Temporarily Restricted', 'Permanently Restricted'] },
    { entity_type: 'expenses', key: 'functional_classification', label: 'Functional Class (990)', field_type: 'select', options: ['Program', 'Management', 'Fundraising'] },
  ],
  setupHints: [
    { key: 'restricted', title: 'Configure fund restrictions', description: 'Track restricted vs unrestricted net assets to satisfy donor and IRS requirements.' },
    { key: 'form-990', title: 'Map accounts to Form 990', description: 'Tag categories by functional class so your annual filing is one click away.' },
  ],
  dashboardWidgets: [
    { key: 'program_ratio', label: 'Program Expense %', type: 'kpi' },
    { key: 'restricted_balance', label: 'Restricted Net Assets', type: 'kpi' },
  ],
};

export default preset;
