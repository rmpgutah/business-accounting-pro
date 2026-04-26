import type { IndustryPreset } from './types';

const preset: IndustryPreset = {
  key: 'restaurant',
  label: 'Restaurant / Hospitality',
  description: 'Tip handling, food cost categories, labor categories',
  icon: 'Utensils',
  coaTemplateKey: 'retail',
  defaultCategories: [
    { name: 'Food Sales', type: 'income', color: '#22c55e', tax_deductible: false },
    { name: 'Beverage Sales', type: 'income', color: '#16a34a', tax_deductible: false },
    { name: 'Catering Revenue', type: 'income', color: '#10b981', tax_deductible: false },
    { name: 'Tips Received', type: 'income', color: '#84cc16', tax_deductible: false },
    { name: 'Food Cost', type: 'cogs', color: '#dc2626', tax_deductible: true },
    { name: 'Beverage Cost', type: 'cogs', color: '#b91c1c', tax_deductible: true },
    { name: 'Front-of-House Labor', type: 'expense', color: '#f97316', tax_deductible: true },
    { name: 'Back-of-House Labor', type: 'expense', color: '#ea580c', tax_deductible: true },
    { name: 'Kitchen Supplies', type: 'expense', color: '#f59e0b', tax_deductible: true },
    { name: 'Tips Payable', type: 'expense', color: '#a855f7', tax_deductible: false },
  ],
  defaultVendors: [
    { name: 'Food Distributor', type: 'inventory' },
    { name: 'Linen Service', type: 'service' },
    { name: 'Pest Control', type: 'service' },
  ],
  invoiceSettings: {
    accent_color: '#dc2626',
    default_due_days: 0,
    default_terms_text: 'Gratuity not included. 18% added for parties of 6 or more.',
  },
  defaultDeductions: [
    { name: 'Food Cost', type: 'cogs' },
    { name: 'Tip Pool', type: 'payroll' },
  ],
  industrySpecificFields: [
    { entity_type: 'employees', key: 'tipped_position', label: 'Tipped Position', field_type: 'boolean' },
    { entity_type: 'invoices', key: 'table_number', label: 'Table #', field_type: 'text' },
  ],
  setupHints: [
    { key: 'tip-policy', title: 'Set tip pool policy', description: 'Decide whether tips are pooled or individual and configure payroll rules.' },
    { key: 'menu-cost', title: 'Cost your menu', description: 'Track food cost per dish to measure plate margin.' },
  ],
  dashboardWidgets: [
    { key: 'food_cost_pct', label: 'Food Cost %', type: 'kpi' },
    { key: 'labor_cost_pct', label: 'Labor Cost %', type: 'kpi' },
  ],
};

export default preset;
