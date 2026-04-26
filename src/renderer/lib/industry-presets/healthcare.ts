import type { IndustryPreset } from './types';

const preset: IndustryPreset = {
  key: 'healthcare',
  label: 'Healthcare',
  description: 'Insurance billing, patient privacy, HSA tracking',
  icon: 'Stethoscope',
  coaTemplateKey: 'service',
  defaultCategories: [
    { name: 'Patient Service Revenue', type: 'income', color: '#22c55e', tax_deductible: false },
    { name: 'Insurance Reimbursement', type: 'income', color: '#16a34a', tax_deductible: false },
    { name: 'Self-Pay Revenue', type: 'income', color: '#10b981', tax_deductible: false },
    { name: 'Contractual Adjustments', type: 'expense', color: '#dc2626', tax_deductible: false },
    { name: 'Bad Debt Write-off', type: 'expense', color: '#b91c1c', tax_deductible: true },
    { name: 'Medical Supplies', type: 'expense', color: '#f97316', tax_deductible: true },
    { name: 'Lab Fees', type: 'expense', color: '#f59e0b', tax_deductible: true },
    { name: 'Malpractice Insurance', type: 'expense', color: '#8b5cf6', tax_deductible: true },
    { name: 'CME / Continuing Education', type: 'expense', color: '#06b6d4', tax_deductible: true },
  ],
  defaultVendors: [
    { name: 'Medical Supply Co', type: 'inventory' },
    { name: 'Insurance Clearinghouse', type: 'service' },
    { name: 'Lab Reference Service', type: 'service' },
  ],
  invoiceSettings: {
    accent_color: '#0891b2',
    default_due_days: 30,
    default_terms_text: 'Confidential — protected health information. Pay your portion within 30 days.',
  },
  defaultDeductions: [
    { name: 'HSA Contribution', type: 'employee' },
    { name: 'Health Insurance Premium', type: 'employee' },
  ],
  industrySpecificFields: [
    { entity_type: 'clients', key: 'mrn', label: 'Medical Record #', field_type: 'text' },
    { entity_type: 'invoices', key: 'cpt_codes', label: 'CPT Codes', field_type: 'text' },
    { entity_type: 'invoices', key: 'insurance_payer', label: 'Insurance Payer', field_type: 'text' },
  ],
  setupHints: [
    { key: 'hipaa', title: 'Review HIPAA settings', description: 'Patient PHI never appears on exports. Confirm your privacy policy is enabled.' },
    { key: 'fee-schedule', title: 'Load your fee schedule', description: 'Map CPT codes to billable amounts and contractual allowances per payer.' },
  ],
  dashboardWidgets: [
    { key: 'days_in_ar', label: 'Days in A/R', type: 'kpi' },
    { key: 'collection_rate', label: 'Net Collection %', type: 'kpi' },
  ],
};

export default preset;
