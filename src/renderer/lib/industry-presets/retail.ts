import type { IndustryPreset } from './types';

const preset: IndustryPreset = {
  key: 'retail',
  label: 'Retail',
  description: 'Brick-and-mortar stores, sales tax, inventory and POS workflow',
  icon: 'Store',
  coaTemplateKey: 'retail',
  defaultCategories: [
    { name: 'Product Sales', type: 'income', color: '#22c55e', tax_deductible: false, default_account_code: '4000' },
    { name: 'Sales Tax Collected', type: 'income', color: '#84cc16', tax_deductible: false },
    { name: 'Cost of Goods Sold', type: 'cogs', color: '#dc2626', tax_deductible: true, default_account_code: '5000' },
    { name: 'Inventory Shrinkage', type: 'cogs', color: '#b91c1c', tax_deductible: true },
    { name: 'Merchant Processing Fees', type: 'expense', color: '#f97316', tax_deductible: true, default_account_code: '5300' },
    { name: 'Store Rent', type: 'expense', color: '#8b5cf6', tax_deductible: true, default_account_code: '6600' },
    { name: 'Store Utilities', type: 'expense', color: '#0ea5e9', tax_deductible: true, default_account_code: '6900' },
    { name: 'Packaging Supplies', type: 'expense', color: '#f59e0b', tax_deductible: true },
  ],
  defaultVendors: [
    { name: 'Wholesale Supplier', type: 'inventory' },
    { name: 'Payment Processor', type: 'service' },
  ],
  invoiceSettings: {
    accent_color: '#16a34a',
    default_due_days: 0,
    default_notes: 'All sales final. Returns accepted within 30 days with receipt.',
    default_terms_text: 'Payment due at point of sale.',
  },
  defaultDeductions: [
    { name: 'Cost of Goods', type: 'inventory' },
    { name: 'Store Operating Expenses', type: 'business' },
  ],
  industrySpecificFields: [
    { entity_type: 'inventory_items', key: 'sku', label: 'SKU', field_type: 'text' },
    { entity_type: 'inventory_items', key: 'reorder_point', label: 'Reorder Point', field_type: 'number' },
  ],
  setupHints: [
    { key: 'sales-tax', title: 'Configure sales tax', description: 'Set your state and local tax rates so invoices calculate the correct total.' },
    { key: 'inventory', title: 'Import your inventory', description: 'Bulk import SKUs with cost and price so COGS posts automatically.' },
  ],
  dashboardWidgets: [
    { key: 'gross_margin', label: 'Gross Margin %', type: 'kpi' },
    { key: 'inventory_turn', label: 'Inventory Turnover', type: 'kpi' },
  ],
};

export default preset;
