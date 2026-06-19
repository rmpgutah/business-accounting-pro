import type { IndustryPreset } from './types';

const preset: IndustryPreset = {
  key: 'property-management',
  label: 'Property Management',
  description: 'Rental income, security deposits, maintenance, tenant tracking',
  icon: 'Building',
  coaTemplateKey: 'service',
  defaultCategories: [
    { name: 'Rental Income', type: 'income', color: '#22c55e', tax_deductible: false },
    { name: 'Late Fees', type: 'income', color: '#84cc16', tax_deductible: false },
    { name: 'Application Fees', type: 'income', color: '#16a34a', tax_deductible: false },
    { name: 'Pet Fees', type: 'income', color: '#10b981', tax_deductible: false },
    { name: 'Security Deposits Held', type: 'expense', color: '#06b6d4', tax_deductible: false },
    { name: 'Property Maintenance', type: 'expense', color: '#dc2626', tax_deductible: true },
    { name: 'HOA Fees', type: 'expense', color: '#b91c1c', tax_deductible: true },
    { name: 'Property Taxes', type: 'expense', color: '#f97316', tax_deductible: true },
    { name: 'Property Insurance', type: 'expense', color: '#f59e0b', tax_deductible: true },
    { name: 'Property Management Fee', type: 'expense', color: '#8b5cf6', tax_deductible: true },
    { name: 'Mortgage Interest', type: 'expense', color: '#6366f1', tax_deductible: true },
    { name: 'Depreciation', type: 'expense', color: '#a855f7', tax_deductible: true },
  ],
  defaultVendors: [
    { name: 'Plumber', type: 'maintenance' },
    { name: 'Electrician', type: 'maintenance' },
    { name: 'Landscaping Service', type: 'maintenance' },
    { name: 'HOA', type: 'service' },
  ],
  invoiceSettings: {
    accent_color: '#0891b2',
    default_due_days: 5,
    default_terms_text: 'Rent due on the 1st. Late fees apply after the 5th.',
  },
  defaultDeductions: [
    { name: 'Mortgage Interest', type: 'rental' },
    { name: 'Property Depreciation', type: 'depreciation' },
  ],
  industrySpecificFields: [
    { entity_type: 'projects', key: 'property_address', label: 'Property Address', field_type: 'text' },
    { entity_type: 'projects', key: 'unit_count', label: 'Unit Count', field_type: 'number' },
    { entity_type: 'clients', key: 'lease_start', label: 'Lease Start', field_type: 'date' },
    { entity_type: 'clients', key: 'lease_end', label: 'Lease End', field_type: 'date' },
    { entity_type: 'clients', key: 'security_deposit', label: 'Security Deposit', field_type: 'number' },
    { entity_type: 'clients', key: 'monthly_rent', label: 'Monthly Rent', field_type: 'number' },
  ],
  setupHints: [
    { key: 'recurring-rent', title: 'Set up recurring rent invoices', description: 'Auto-bill tenants on the 1st of each month.' },
    { key: 'deposit-tracking', title: 'Track security deposits', description: 'Held funds belong on the liability side until move-out.' },
  ],
  dashboardWidgets: [
    { key: 'occupancy_rate', label: 'Occupancy %', type: 'kpi' },
    { key: 'overdue_rent', label: 'Overdue Rent', type: 'kpi' },
  ],
};

export default preset;
