// Standard Chart of Accounts templates by industry
export interface CoaTemplateAccount {
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  subtype?: string;
}

export interface CoaTemplate {
  id: string;
  name: string;
  description: string;
  accounts: CoaTemplateAccount[];
}

const COMMON_BASE: CoaTemplateAccount[] = [
  { code: '1000', name: 'Cash', type: 'asset', subtype: 'Cash and Cash Equivalents' },
  { code: '1010', name: 'Checking Account', type: 'asset', subtype: 'Cash and Cash Equivalents' },
  { code: '1020', name: 'Savings Account', type: 'asset', subtype: 'Cash and Cash Equivalents' },
  { code: '1100', name: 'Accounts Receivable', type: 'asset', subtype: 'Accounts Receivable' },
  { code: '2000', name: 'Accounts Payable', type: 'liability', subtype: 'Accounts Payable' },
  { code: '2100', name: 'Credit Card Payable', type: 'liability', subtype: 'Credit Card' },
  { code: '2300', name: 'Sales Tax Payable', type: 'liability', subtype: 'Current Liabilities' },
  { code: '3000', name: "Owner's Equity", type: 'equity', subtype: "Owner's Equity" },
  { code: '3200', name: 'Retained Earnings', type: 'equity', subtype: 'Retained Earnings' },
  { code: '3900', name: 'Opening Balance Equity', type: 'equity', subtype: "Owner's Equity" },
];

export const COA_TEMPLATES: CoaTemplate[] = [
  {
    id: 'service',
    name: 'Service Business',
    description: 'Consultancies, agencies, freelancers, professional services',
    accounts: [
      ...COMMON_BASE,
      { code: '1200', name: 'Prepaid Expenses', type: 'asset', subtype: 'Prepaid Expenses' },
      { code: '4000', name: 'Service Revenue', type: 'revenue', subtype: 'Service Revenue' },
      { code: '4100', name: 'Consulting Revenue', type: 'revenue', subtype: 'Service Revenue' },
      { code: '4900', name: 'Other Income', type: 'revenue', subtype: 'Other Income' },
      { code: '6000', name: 'Advertising & Marketing', type: 'expense', subtype: 'Operating Expenses' },
      { code: '6200', name: 'Contractors', type: 'expense', subtype: 'Operating Expenses' },
      { code: '6300', name: 'Insurance', type: 'expense', subtype: 'Operating Expenses' },
      { code: '6500', name: 'Professional Fees', type: 'expense', subtype: 'Operating Expenses' },
      { code: '6600', name: 'Rent', type: 'expense', subtype: 'Rent & Utilities' },
      { code: '6700', name: 'Software & Subscriptions', type: 'expense', subtype: 'Operating Expenses' },
      { code: '6800', name: 'Travel & Meals', type: 'expense', subtype: 'Operating Expenses' },
      { code: '6900', name: 'Utilities', type: 'expense', subtype: 'Rent & Utilities' },
    ],
  },
  {
    id: 'retail',
    name: 'Retail / E-commerce',
    description: 'Stores, online sellers, product-based businesses',
    accounts: [
      ...COMMON_BASE,
      { code: '1300', name: 'Inventory', type: 'asset', subtype: 'Inventory' },
      { code: '1400', name: 'Merchant Account Receivable', type: 'asset', subtype: 'Accounts Receivable' },
      { code: '4000', name: 'Sales Revenue', type: 'revenue', subtype: 'Sales Revenue' },
      { code: '4100', name: 'Online Sales', type: 'revenue', subtype: 'Sales Revenue' },
      { code: '4200', name: 'Shipping Income', type: 'revenue', subtype: 'Sales Revenue' },
      { code: '4500', name: 'Sales Returns & Allowances', type: 'revenue', subtype: 'Sales Revenue' },
      { code: '5000', name: 'Cost of Goods Sold', type: 'expense', subtype: 'Cost of Goods Sold' },
      { code: '5100', name: 'Inventory Adjustments', type: 'expense', subtype: 'Cost of Goods Sold' },
      { code: '5200', name: 'Shipping & Freight', type: 'expense', subtype: 'Cost of Goods Sold' },
      { code: '5300', name: 'Merchant Processing Fees', type: 'expense', subtype: 'Operating Expenses' },
      { code: '6000', name: 'Advertising', type: 'expense', subtype: 'Operating Expenses' },
      { code: '6600', name: 'Rent', type: 'expense', subtype: 'Rent & Utilities' },
      { code: '6900', name: 'Utilities', type: 'expense', subtype: 'Rent & Utilities' },
    ],
  },
  {
    id: 'manufacturing',
    name: 'Manufacturing',
    description: 'Production, fabrication, assembly operations',
    accounts: [
      ...COMMON_BASE,
      { code: '1300', name: 'Raw Materials Inventory', type: 'asset', subtype: 'Inventory' },
      { code: '1310', name: 'Work-in-Process Inventory', type: 'asset', subtype: 'Inventory' },
      { code: '1320', name: 'Finished Goods Inventory', type: 'asset', subtype: 'Inventory' },
      { code: '1500', name: 'Equipment', type: 'asset', subtype: 'Fixed Assets' },
      { code: '1510', name: 'Accumulated Depreciation', type: 'asset', subtype: 'Fixed Assets' },
      { code: '4000', name: 'Product Sales', type: 'revenue', subtype: 'Sales Revenue' },
      { code: '5000', name: 'Direct Materials', type: 'expense', subtype: 'Cost of Goods Sold' },
      { code: '5100', name: 'Direct Labor', type: 'expense', subtype: 'Cost of Goods Sold' },
      { code: '5200', name: 'Manufacturing Overhead', type: 'expense', subtype: 'Cost of Goods Sold' },
      { code: '5300', name: 'Factory Rent', type: 'expense', subtype: 'Cost of Goods Sold' },
      { code: '5400', name: 'Factory Utilities', type: 'expense', subtype: 'Cost of Goods Sold' },
      { code: '7200', name: 'Depreciation Expense', type: 'expense', subtype: 'Depreciation' },
    ],
  },
  {
    id: 'nonprofit',
    name: 'Nonprofit',
    description: '501(c)(3) organizations, charities, foundations',
    accounts: [
      ...COMMON_BASE.filter(a => a.code !== '3000'),
      { code: '3000', name: 'Net Assets - Without Donor Restrictions', type: 'equity', subtype: "Owner's Equity" },
      { code: '3100', name: 'Net Assets - With Donor Restrictions', type: 'equity', subtype: "Owner's Equity" },
      { code: '4000', name: 'Contributions - Unrestricted', type: 'revenue', subtype: 'Other Income' },
      { code: '4100', name: 'Contributions - Restricted', type: 'revenue', subtype: 'Other Income' },
      { code: '4200', name: 'Grant Revenue', type: 'revenue', subtype: 'Other Income' },
      { code: '4300', name: 'Program Service Revenue', type: 'revenue', subtype: 'Service Revenue' },
      { code: '4400', name: 'Fundraising Income', type: 'revenue', subtype: 'Other Income' },
      { code: '4500', name: 'Membership Dues', type: 'revenue', subtype: 'Other Income' },
      { code: '6000', name: 'Program Expenses', type: 'expense', subtype: 'Operating Expenses' },
      { code: '6100', name: 'Fundraising Expenses', type: 'expense', subtype: 'Operating Expenses' },
      { code: '6200', name: 'Management & General', type: 'expense', subtype: 'Operating Expenses' },
      { code: '6300', name: 'Grants Awarded', type: 'expense', subtype: 'Operating Expenses' },
    ],
  },
];
