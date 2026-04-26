import type { IndustryPreset } from './types';

const preset: IndustryPreset = {
  key: 'ecommerce',
  label: 'E-commerce',
  description: 'Online sellers, shipping, returns, marketplace fees',
  icon: 'ShoppingCart',
  coaTemplateKey: 'retail',
  defaultCategories: [
    { name: 'Online Sales', type: 'income', color: '#22c55e', tax_deductible: false, default_account_code: '4100' },
    { name: 'Marketplace Sales', type: 'income', color: '#16a34a', tax_deductible: false },
    { name: 'Shipping Income', type: 'income', color: '#10b981', tax_deductible: false, default_account_code: '4200' },
    { name: 'Returns & Allowances', type: 'income', color: '#84cc16', tax_deductible: false, default_account_code: '4500' },
    { name: 'Cost of Goods Sold', type: 'cogs', color: '#dc2626', tax_deductible: true, default_account_code: '5000' },
    { name: 'Shipping & Fulfillment', type: 'cogs', color: '#b91c1c', tax_deductible: true, default_account_code: '5200' },
    { name: 'Marketplace Fees', type: 'cogs', color: '#991b1b', tax_deductible: true },
    { name: 'Payment Processing', type: 'cogs', color: '#7c2d12', tax_deductible: true, default_account_code: '5300' },
    { name: 'Advertising / Ads', type: 'expense', color: '#f97316', tax_deductible: true, default_account_code: '6000' },
    { name: 'Packaging Supplies', type: 'expense', color: '#f59e0b', tax_deductible: true },
    { name: '3PL / Warehouse', type: 'expense', color: '#8b5cf6', tax_deductible: true },
  ],
  defaultVendors: [
    { name: 'Amazon FBA', type: 'marketplace' },
    { name: 'Shopify', type: 'platform' },
    { name: 'Shipping Carrier', type: 'service' },
    { name: '3PL Provider', type: 'service' },
  ],
  invoiceSettings: {
    accent_color: '#16a34a',
    default_due_days: 0,
    default_terms_text: 'Payment due at checkout. Returns within 30 days.',
  },
  defaultDeductions: [
    { name: 'Cost of Goods', type: 'inventory' },
    { name: 'Home Office', type: 'business' },
  ],
  industrySpecificFields: [
    { entity_type: 'invoices', key: 'order_number', label: 'Order #', field_type: 'text' },
    { entity_type: 'invoices', key: 'sales_channel', label: 'Sales Channel', field_type: 'select', options: ['Shopify', 'Amazon', 'Etsy', 'eBay', 'Direct'] },
    { entity_type: 'inventory_items', key: 'asin', label: 'ASIN', field_type: 'text' },
    { entity_type: 'inventory_items', key: 'sku', label: 'SKU', field_type: 'text' },
  ],
  setupHints: [
    { key: 'channels', title: 'Connect sales channels', description: 'Sync orders from Shopify, Amazon, and Etsy so all revenue is captured.' },
    { key: 'sales-tax-nexus', title: 'Review nexus / sales tax', description: 'Track which states require you to collect and remit sales tax.' },
  ],
  dashboardWidgets: [
    { key: 'revenue_by_channel', label: 'Revenue by Channel', type: 'chart' },
    { key: 'gross_margin', label: 'Gross Margin %', type: 'kpi' },
  ],
};

export default preset;
