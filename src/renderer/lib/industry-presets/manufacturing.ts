import type { IndustryPreset } from './types';

const preset: IndustryPreset = {
  key: 'manufacturing',
  label: 'Manufacturing',
  description: 'WIP, raw materials, finished goods, BOM',
  icon: 'Factory',
  coaTemplateKey: 'manufacturing',
  defaultCategories: [
    { name: 'Product Sales', type: 'income', color: '#22c55e', tax_deductible: false, default_account_code: '4000' },
    { name: 'Scrap Sales', type: 'income', color: '#84cc16', tax_deductible: false },
    { name: 'Raw Materials', type: 'cogs', color: '#dc2626', tax_deductible: true, default_account_code: '5000' },
    { name: 'Direct Labor', type: 'cogs', color: '#b91c1c', tax_deductible: true, default_account_code: '5100' },
    { name: 'Manufacturing Overhead', type: 'cogs', color: '#991b1b', tax_deductible: true, default_account_code: '5200' },
    { name: 'Factory Rent', type: 'cogs', color: '#7c2d12', tax_deductible: true, default_account_code: '5300' },
    { name: 'Quality Control', type: 'expense', color: '#f97316', tax_deductible: true },
    { name: 'R&D', type: 'expense', color: '#8b5cf6', tax_deductible: true },
    { name: 'Equipment Depreciation', type: 'expense', color: '#0ea5e9', tax_deductible: true, default_account_code: '7200' },
  ],
  defaultVendors: [
    { name: 'Raw Material Supplier', type: 'inventory' },
    { name: 'Equipment Manufacturer', type: 'capital' },
    { name: 'Freight Carrier', type: 'service' },
  ],
  invoiceSettings: {
    accent_color: '#0ea5e9',
    default_due_days: 30,
    default_terms_text: 'Net 30. FOB shipping point unless otherwise noted.',
  },
  defaultDeductions: [
    { name: 'Equipment Section 179', type: 'depreciation' },
    { name: 'R&D Tax Credit', type: 'credit' },
  ],
  industrySpecificFields: [
    { entity_type: 'inventory_items', key: 'bom_id', label: 'Bill of Materials ID', field_type: 'text' },
    { entity_type: 'inventory_items', key: 'lead_time_days', label: 'Lead Time (days)', field_type: 'number' },
    { entity_type: 'inventory_items', key: 'stock_stage', label: 'Stock Stage', field_type: 'select', options: ['Raw', 'WIP', 'Finished'] },
  ],
  setupHints: [
    { key: 'bom', title: 'Build your BOMs', description: 'Define bill-of-materials for each product so production runs auto-deduct components.' },
    { key: 'wip', title: 'Track WIP', description: 'Move costs from raw materials to WIP to finished goods as they progress.' },
  ],
  dashboardWidgets: [
    { key: 'wip_value', label: 'WIP Value', type: 'kpi' },
    { key: 'production_yield', label: 'Yield %', type: 'kpi' },
  ],
};

export default preset;
