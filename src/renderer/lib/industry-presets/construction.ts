import type { IndustryPreset } from './types';

const preset: IndustryPreset = {
  key: 'construction',
  label: 'Construction',
  description: 'Job costing, lien tracking, retainage, equipment depreciation',
  icon: 'HardHat',
  coaTemplateKey: 'manufacturing',
  defaultCategories: [
    { name: 'Contract Revenue', type: 'income', color: '#22c55e', tax_deductible: false },
    { name: 'Change Order Revenue', type: 'income', color: '#16a34a', tax_deductible: false },
    { name: 'Materials', type: 'cogs', color: '#dc2626', tax_deductible: true },
    { name: 'Subcontractor Costs', type: 'cogs', color: '#b91c1c', tax_deductible: true },
    { name: 'Direct Labor', type: 'cogs', color: '#991b1b', tax_deductible: true },
    { name: 'Equipment Rental', type: 'expense', color: '#f97316', tax_deductible: true },
    { name: 'Equipment Depreciation', type: 'expense', color: '#ea580c', tax_deductible: true },
    { name: 'Permits & Fees', type: 'expense', color: '#f59e0b', tax_deductible: true },
    { name: 'Workers Compensation', type: 'expense', color: '#8b5cf6', tax_deductible: true },
    { name: 'Retainage Receivable', type: 'income', color: '#06b6d4', tax_deductible: false },
  ],
  defaultVendors: [
    { name: 'Lumber Yard', type: 'inventory' },
    { name: 'Concrete Supplier', type: 'inventory' },
    { name: 'Equipment Rental Co', type: 'service' },
  ],
  invoiceSettings: {
    accent_color: '#f59e0b',
    default_due_days: 30,
    default_terms_text: 'Net 30. 10% retainage held until project completion and inspection.',
  },
  defaultDeductions: [
    { name: 'Equipment Section 179', type: 'depreciation' },
    { name: 'Vehicle Mileage', type: 'business' },
  ],
  industrySpecificFields: [
    { entity_type: 'projects', key: 'job_number', label: 'Job #', field_type: 'text' },
    { entity_type: 'projects', key: 'lien_filed', label: 'Lien Filed', field_type: 'boolean' },
    { entity_type: 'projects', key: 'retainage_pct', label: 'Retainage %', field_type: 'number' },
    { entity_type: 'invoices', key: 'aia_form', label: 'AIA G702/G703', field_type: 'boolean' },
  ],
  setupHints: [
    { key: 'job-cost', title: 'Set up job costing', description: 'Tag every expense with a project so you can run job profitability reports.' },
    { key: 'retainage', title: 'Configure retainage tracking', description: 'Hold-back amounts post to a separate receivable until released.' },
  ],
  dashboardWidgets: [
    { key: 'job_profit', label: 'Job Profitability', type: 'chart' },
    { key: 'retainage_outstanding', label: 'Retainage Outstanding', type: 'kpi' },
  ],
};

export default preset;
